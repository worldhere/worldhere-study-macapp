# -*- coding: utf-8 -*-
"""飞书排班同步：推送（系统到飞书）/ 拉取（飞书到系统）"""
import datetime
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from feishu.common import (
    _feishu_data, _feishu_raw, _feishu_request,
    _batch_create_records, _batch_update_records, _batch_delete_records,
    _parse_feishu_text,
    _get_app_token, BATCH_SIZE,
)
from feishu.table_utils import SYSTEM_FIELDS, USER_FIELDS
from feishu.groups import _parse_feishu_user
from db import get_db
from models import recycle_schedules, _get_repair_for_schedule
from utils import format_elapsed, normalize_machine_schedule, today

PUSH_DAYS_BEFORE = 3
PUSH_DAYS_AFTER = 7


def _schedule_is_active(existing):
    """排班是否当前正在执行中（已开始、未完成、在时间窗口内）。
    只有活跃排班的异常标记才触发机器状态变更。"""
    try:
        if existing["status"] == "completed":
            return False
        now = datetime.datetime.now()
        base = datetime.datetime.combine(
            datetime.date.fromisoformat(existing["date"]),
            datetime.time.min,
        )
        start_dt = base + datetime.timedelta(minutes=int(existing["start_min"]))
        end_dt = base + datetime.timedelta(minutes=int(existing["end_min"]))
        return start_dt <= now < end_dt
    except Exception:
        return False


def on_local_recycle(conn, schedule_ids=None, task_ids=None, machine_id=None, date=None):
    """本地回收前：检查活跃任务（采集中/暂停中），写 push_log 触发飞书回收卡片。
    由 routes/tasks.py 的回收接口在 recycle_schedules 之前调用。
    """
    from db import get_db as _get_db
    now = datetime.datetime.now()
    own_conn = False
    rows = []

    # 收集将被回收的 schedule 行
    if schedule_ids:
        ids = [int(x) for x in schedule_ids]
        placeholders = ",".join("?" * len(ids))
        rows = conn.execute(
            f"""SELECT s.*, m.group_name, m.type AS machine_type
                FROM schedules s
                LEFT JOIN machines m ON s.machine_id=m.id
                WHERE s.id IN ({placeholders})""",
            ids,
        ).fetchall()
    elif task_ids:
        ids = [int(x) for x in task_ids]
        placeholders = ",".join("?" * len(ids))
        rows = conn.execute(
            f"""SELECT s.*, m.group_name, m.type AS machine_type
                FROM schedules s
                LEFT JOIN machines m ON s.machine_id=m.id
                WHERE s.task_id IN ({placeholders})""",
            ids,
        ).fetchall()
    elif date:
        query = ("SELECT s.*, m.group_name, m.type AS machine_type FROM schedules s "
                 "LEFT JOIN machines m ON s.machine_id=m.id "
                 "WHERE s.date=? AND s.status!='completed'")
        params = [date]
        if machine_id is not None:
            query += " AND s.machine_id=?"
            params.append(int(machine_id))
        rows = conn.execute(query, params).fetchall()

    for s in rows:
        sid = int(s["id"])
        mid = int(s["machine_id"])

        # 只对当前活跃（采集中/暂停中）的任务发卡片
        if not _schedule_is_active(s):
            continue

        now_str = now.strftime("%Y-%m-%d %H:%M:%S")
        recycle_data = json.dumps({
            "event_type": "task_recycled",
            "schedule_id": sid,
            "machine_id": mid,
            "machine_name": s["machine_name"] or "",
            "group_name": s["group_name"] or "",
            "machine_type": s.get("machine_type") or "",
            "collector": s.get("collector") or "",
            "task_name": s["task_name"] or "",
            "date": s["date"],
            "recycle_reason": "手动回收",
            "recycle_time": now_str,
        }, ensure_ascii=False)
        conn.execute(
            """INSERT INTO push_log (dedup_key, event_type, target_type, target_id, notify_value, sent_at, success)
               VALUES (?, 'task_recycled', '', '', ?, ?, 0)""",
            (f"recycle_{sid}", recycle_data, now_str),
        )


def compute_task_statuses(conn, alert_minutes=15):
    """返回 {task_id: computed_status}。与前端 timeline 同逻辑。
    仅返回有活跃排班（status != 'completed'）的任务状态。
    """
    now = datetime.datetime.now()

    schedules_rows = conn.execute(
        "SELECT id, date, machine_id, task_id, start_min, end_min "
        "FROM schedules WHERE status != 'completed'"
    ).fetchall()

    machines_rows = conn.execute("SELECT id, status FROM machines").fetchall()
    machine_statuses = {int(m["id"]): m["status"] for m in machines_rows}

    task_statuses = {}

    for s in schedules_rows:
        mid = int(s["machine_id"])
        tid = s["task_id"]
        if tid is None:
            continue

        try:
            base_date = datetime.date.fromisoformat(s["date"])
            start_dt = datetime.datetime.combine(base_date, datetime.time(0, 0)) + datetime.timedelta(minutes=int(s["start_min"]))
            end_dt = datetime.datetime.combine(base_date, datetime.time(0, 0)) + datetime.timedelta(minutes=int(s["end_min"]))
        except ValueError:
            continue

        if start_dt <= now < end_dt:
            remaining_sec = (end_dt - now).total_seconds()
            nearing = remaining_sec <= alert_minutes * 60
            if machine_statuses.get(mid) == "维修停用":
                task_statuses[int(tid)] = "暂停即将超时" if nearing else "暂停中"
            else:
                task_statuses[int(tid)] = "采集即将完成" if nearing else "采集中"
        elif end_dt <= now:
            if int(tid) not in task_statuses or task_statuses[int(tid)] != "采集中":
                task_statuses[int(tid)] = "过时待确认"

    return task_statuses


def _sort_by_priority(rows, today_str):
    """按时间优先级排序：今天 > ±1天 > 其余按日期距离"""
    today = datetime.date.fromisoformat(today_str)

    def _pri(r):
        d = datetime.date.fromisoformat(r["date"])
        dist = abs((d - today).days)
        if dist == 0:
            return 0
        if dist == 1:
            return 1
        return dist

    return sorted(rows, key=_pri)


def _date_min_to_timestamps(date_str, start_min, end_min):
    """将 date + 绝对分钟 转为两个毫秒级时间戳"""
    try:
        dt = datetime.date.fromisoformat(date_str)
        base = datetime.datetime.combine(dt, datetime.time.min)
        start_ts = int((base + datetime.timedelta(minutes=start_min)).timestamp() * 1000)
        end_ts = int((base + datetime.timedelta(minutes=end_min)).timestamp() * 1000)
        return start_ts, end_ts
    except Exception:
        return None, None


def _normalize_for_comparison(val):
    """标准化飞书 API 返回的字段值，使其可与 push 值直接比较。
    - DateTime: 毫秒 int → 直接返回
    - Text/Select: 可能是 string、number 或 list-of-dict → 提取纯文本
    """
    if val is None:
        return None
    if isinstance(val, (int, float)):
        return int(val)
    return _parse_feishu_text(val)


def _fields_differ(sys_val, existing_val):
    """比较系统计算值 sys_val 与飞书当前值 existing_val。
    None / 空字符串 / 0 视为等价空值。
    """
    ex = _normalize_for_comparison(existing_val)

    def _empty(v):
        return v is None or v == "" or v == 0

    if _empty(sys_val) and _empty(ex):
        return False
    if _empty(sys_val) or _empty(ex):
        return True
    return sys_val != ex


def _clean_stale_mapping(machine_id, machine_name, reason):
    """清理失效映射：表已被删除时，删除 feishu_sync_mapping 和 feishu_record_mapping，
    让后续 auto_fix_missing_mappings 自动重建。"""
    from feishu.status import write_event
    try:
        conn = get_db()
        conn.execute("DELETE FROM feishu_sync_mapping WHERE machine_id=?", (machine_id,))
        conn.execute("DELETE FROM feishu_record_mapping WHERE machine_id=?", (machine_id,))
        conn.commit()
        conn.close()
        write_event("info", machine_name, "映射已清除（{}），等待自动重建".format(reason))
    except Exception:
        pass


def push_machine_schedules(machine_id):
    """将一台机器的排班推送到其飞书表。返回变更计数。"""
    conn = get_db()
    mapping = conn.execute(
        "SELECT * FROM feishu_sync_mapping WHERE machine_id=?", (machine_id,)
    ).fetchone()
    if not mapping:
        conn.close()
        return {"error": "No mapping", "machine_id": machine_id}

    table_id = mapping["table_id"]

    # 推送前检查字段完整性：缺列自动补，同时记日志避免静默丢失
    from feishu.table_utils import ensure_table_fields
    from feishu.status import write_event
    fixed, failed = ensure_table_fields(table_id)
    if fixed:
        write_event("warn", mapping["machine_name"],
                    "缺字段已补: {}".format(", ".join(fixed)))
    for fname, code, msg in failed:
        write_event("error", mapping["machine_name"],
                    "补字段失败: {} (code={} {})".format(fname, code, msg))
        # 表已被删除（飞书错误码 1254002=表不存在）→ 清除映射，下次 auto_fix 自动重建
        if code in (1254002, 1254003):
            _clean_stale_mapping(machine_id, mapping["machine_name"],
                                 "表已在飞书端被删除 (error={})".format(code))

    dt_today = today()
    date_from = (dt_today - datetime.timedelta(days=PUSH_DAYS_BEFORE)).isoformat()
    date_to = (dt_today + datetime.timedelta(days=PUSH_DAYS_AFTER)).isoformat()

    rows = conn.execute(
        """SELECT s.id, s.date, s.task_id, s.task_name, s.task_type, s.task_kind,
                  s.start_min, s.end_min, s.duration, s.status, s.remark,
                  s.actual_start_min, s.actual_end_min,
                  s.exception_mark, s.exception_note,
                  s.estimated_window, s.updated_at,
                  t.priority, t.difficulty, t.est_seconds, t.status AS task_status,
                  pkg.name AS package_name
           FROM schedules s
           LEFT JOIN tasks t ON s.task_id = t.id
           LEFT JOIN task_packages pkg ON t.package_id = pkg.id
           WHERE s.machine_id=?
             AND (
                 (s.date >= ? AND s.date <= ?)
                 OR (
                     s.end_min > 1440
                     AND s.date < ?
                     AND date(s.date, '+' || (s.end_min / 1440) || ' days') >= ?
                 )
             )
           ORDER BY s.date ASC, s.start_min ASC""",
        (machine_id, date_from, date_to, date_from, date_from),
    ).fetchall()
    conn.close()

    # 读取本地 schedule_id -> feishu_record_id 映射
    conn2 = get_db()
    record_mapping = {}
    for rm in conn2.execute(
        "SELECT schedule_id, feishu_record_id FROM feishu_record_mapping WHERE machine_id=?",
        (machine_id,)
    ).fetchall():
        record_mapping[rm["schedule_id"]] = rm["feishu_record_id"]
    conn2.close()

    # 获取动态计算状态（复用 views.py 同逻辑）
    conn3 = get_db()
    dynamic_statuses = compute_task_statuses(conn3)
    conn3.close()

    # 维修查询用连接（push 循环内复用）
    repair_conn = get_db()

    sorted_rows = _sort_by_priority(rows, dt_today.isoformat())

    # 读取飞书端现有记录（全量，跟本地做 diff）
    feishu_record_map = {}
    page_token = None
    while True:
        p = f"&page_token={page_token}" if page_token else ""
        data = _feishu_data(
            "GET", f"/apps/{_get_app_token()}/tables/{table_id}/records?page_size=500&automatic_fields=true{p}"
        )
        if data:
            for item in data.get("items", []):
                feishu_record_map[item["record_id"]] = item
        if not data or not data.get("has_more"):
            break
        page_token = data.get("page_token")

    # 按 schedule_id 索引飞书记录
    feishu_map = {}  # schedule_id -> feishu_item
    for sid, rid in record_mapping.items():
        if rid in feishu_record_map:
            feishu_map[sid] = feishu_record_map.pop(rid)

    # 剩余飞书记录 = 无本地映射的孤儿行
    orphan_record_ids = list(feishu_record_map.keys())

    # 保存原始飞书状态（record_id → last_modified_time），用于 post-push 快照
    _pre_push_lmt = {}
    for item in feishu_map.values():
        _pre_push_lmt[item["record_id"]] = item.get("last_modified_time", 0) or 0
    for item in feishu_record_map.values():
        _pre_push_lmt[item["record_id"]] = item.get("last_modified_time", 0) or 0

    total_feishu_before = len(feishu_map) + len(orphan_record_ids)

    # 分组：创建 / 更新 / 删除
    to_create = []
    to_update = []
    errors = []

    for row in sorted_rows:
        r = dict(row)
        sid = r["id"]
        est_start_ts, est_end_ts = _date_min_to_timestamps(r["date"], r["start_min"], r["end_min"])

        # 状态：schedule 自身状态优先 -> 动态计算 -> tasks.status fallback
        local_task_status = r.get("task_status") or ""
        tid = r.get("task_id")
        if r.get("status") == "completed":
            feishu_status = "已完成"
        elif tid is not None and int(tid) in dynamic_statuses:
            feishu_status = dynamic_statuses[int(tid)]
        elif local_task_status == "已完成":
            feishu_status = "已完成"
        elif local_task_status == "已分配":
            feishu_status = "待开始"
        else:
            feishu_status = ""

        # 预估时长：格式化任务预估耗时
        est_duration_text = ""
        if r.get("est_seconds"):
            est_duration_text = format_elapsed(r["est_seconds"] // 60)

        # 异常耗时：查询维修记录重叠时长
        repair_duration_text = ""
        repairs = _get_repair_for_schedule(
            repair_conn, machine_id, r["date"],
            int(r["start_min"]), int(r["end_min"])
        )
        if isinstance(repairs, list):
            total_repair_min = sum(p.get("duration_minutes", 0) for p in repairs)
            if total_repair_min > 0:
                repair_duration_text = format_elapsed(total_repair_min)

        # 实际开始/结束：本地分钟数 -> 飞书毫秒时间戳，空时推 None 以清空飞书字段
        actual_start_ts = None
        actual_end_ts = None
        if r.get("actual_start_min") is not None:
            actual_start_ts, _ = _date_min_to_timestamps(r["date"], int(r["actual_start_min"]), 0)
        if r.get("actual_end_min") is not None:
            actual_end_ts, _ = _date_min_to_timestamps(r["date"], int(r["actual_end_min"]), 0)

        # 同步时间：当前 push 时刻的毫秒时间戳
        sync_ts = int(datetime.datetime.now().timestamp() * 1000)

        sys_fields = {
            "任务名": r["task_name"],
            "所属来源": r.get("package_name") or "",
            "任务类型": r["task_type"],
            "优先级": r.get("priority") or "",
            "难度": r.get("difficulty") or "",
            "排班开始": est_start_ts,
            "排班结束": est_end_ts,
            "实际开始": actual_start_ts,
            "实际结束": actual_end_ts,
            "排班时长": format_elapsed(r["end_min"] - r["start_min"]) if r.get("end_min") and r.get("start_min") else "",
            "状态": feishu_status,
            "排班备注": r.get("remark") or "",
            "异常标记": r.get("exception_mark") or "正常",
            "异常备注": r.get("exception_note") or "",
            "异常耗时": repair_duration_text,
            "预估时段": r.get("estimated_window") or "",
            "预估时长": est_duration_text,
            "修改与同步时间": sync_ts,
        }

        if sid in feishu_map:
            existing = feishu_map[sid]
            ex_fields = existing.get("fields", {})
            # 保护飞书端用户编辑的字段不被覆盖
            for uf in USER_FIELDS:
                val = ex_fields.get(uf)
                if val is not None and val != "":
                    sys_fields[uf] = val
            # Diff：只推实际变化的字段（"修改与同步时间"不参与比较，只在有真实变更时附带推送）
            diff_fields = {}
            for key, sys_val in sys_fields.items():
                if key == "修改与同步时间":
                    continue
                ex_val = ex_fields.get(key)
                if _fields_differ(sys_val, ex_val):
                    diff_fields[key] = sys_val
            if diff_fields:
                # 有真实业务字段变更，附带更新同步时间戳
                diff_fields["修改与同步时间"] = sys_fields["修改与同步时间"]
                to_update.append({
                    "record_id": existing["record_id"],
                    "fields": diff_fields,
                })
            del feishu_map[sid]
        else:
            to_create.append({"fields": sys_fields, "_schedule_id": sid})

    to_delete = [item["record_id"] for item in feishu_map.values()] + orphan_record_ids

    repair_conn.close()

    # 批量操作
    created, created_record_ids, create_errors = _batch_create_records(table_id, to_create)
    errors.extend(create_errors)
    updated, update_errors = _batch_update_records(table_id, to_update)
    errors.extend(update_errors)
    deleted, delete_errors = _batch_delete_records(table_id, to_delete)
    errors.extend(delete_errors)

    # 写入新创建的 schedule_id <-> feishu_record_id 映射
    if created > 0 and created_record_ids:
        try:
            conn4 = get_db()
            for item, rid in zip(to_create, created_record_ids):
                sid = item["_schedule_id"]
                conn4.execute(
                    "INSERT OR REPLACE INTO feishu_record_mapping (schedule_id, machine_id, feishu_record_id) VALUES (?, ?, ?)",
                    (int(sid), machine_id, rid),
                )
            conn4.commit()
            conn4.close()
        except Exception:
            pass

    # 清理已删除 schedule 的映射记录
    if deleted > 0:
        try:
            conn5 = get_db()
            deleted_rids = set(to_delete)
            for rid in deleted_rids:
                conn5.execute(
                    "DELETE FROM feishu_record_mapping WHERE feishu_record_id=? AND machine_id=?",
                    (rid, machine_id),
                )
            conn5.commit()
            conn5.close()
        except Exception:
            pass

    # 更新最后推送时间
    try:
        conn6 = get_db()
        conn6.execute(
            "UPDATE feishu_sync_mapping SET last_push_at=? WHERE machine_id=?",
            (datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"), machine_id),
        )
        conn6.commit()
        conn6.close()
    except Exception:
        pass

    # 推送成功后清零 local_modified_at（标记已同步）
    rid_to_sid = {v: int(k) for k, v in record_mapping.items()}
    pushed_sids = set(int(item["_schedule_id"]) for item in to_create)
    for upd in to_update:
        sid = rid_to_sid.get(upd["record_id"])
        if sid:
            pushed_sids.add(sid)
    if pushed_sids:
        try:
            conn8 = get_db()
            placeholders = ",".join("?" * len(pushed_sids))
            conn8.execute(
                f"UPDATE schedules SET local_modified_at=0 WHERE id IN ({placeholders})",
                list(pushed_sids),
            )
            conn8.commit()
            conn8.close()
        except Exception:
            pass

    # 写入 post-push 快照：记录每条飞书记录的 last_modified_time，
    # 供下次 pull 区分"系统 push 改的"和"用户改的"
    now_ms = int(datetime.datetime.now().timestamp() * 1000)
    snapshot = dict(_pre_push_lmt)
    for item, rid in zip(to_create, created_record_ids):
        snapshot[rid] = now_ms
    for upd in to_update:
        snapshot[upd["record_id"]] = now_ms
    for rid in to_delete:
        snapshot.pop(rid, None)

    conn7 = get_db()
    conn7.execute(
        "UPDATE feishu_sync_mapping SET last_push_snapshot=? WHERE machine_id=?",
        (json.dumps(snapshot, ensure_ascii=False), machine_id),
    )
    conn7.commit()
    conn7.close()

    result = {
        "created": created, "updated": updated, "deleted": deleted,
        "total_system": len(sorted_rows), "total_feishu_before": total_feishu_before,
    }
    if errors:
        result["errors"] = errors
    return result


# ========== 拉取（飞书 -> 系统） ==========

def _parse_feishu_datetime_for_pull(val, date_str):
    """将飞书 DateTime 毫秒时间戳转为相对 schedule.date 的绝对分钟数。支持跨天。"""
    if val is None:
        return None
    try:
        if isinstance(val, (int, float)):
            ts = val / 1000.0
            dt = datetime.datetime.fromtimestamp(ts)
            base = datetime.datetime.combine(
                datetime.date.fromisoformat(date_str),
                datetime.time.min,
            )
            return round((dt - base).total_seconds() / 60)
    except Exception:
        pass
    return None


def _format_drift_window(date_str, start_min, end_min):
    """将 date + 绝对分钟 格式化为人类可读的漂移窗口字符串。
    格式: "MM/dd HH:MM~HH:MM"，跨天则 "MM/dd HH:MM~MM/dd HH:MM"
    """
    try:
        dt = datetime.date.fromisoformat(date_str)
        base = datetime.datetime.combine(dt, datetime.time.min)
        start_dt = base + datetime.timedelta(minutes=int(start_min))
        end_dt = base + datetime.timedelta(minutes=int(end_min))
        if start_dt.date() == end_dt.date():
            return f"{start_dt:%m/%d %H:%M}~{end_dt:%H:%M}"
        else:
            return f"{start_dt:%m/%d %H:%M}~{end_dt:%m/%d %H:%M}"
    except Exception:
        return ""


def _pull_one_machine(table_id, machine_id, machine_name):
    """拉取单台机器的飞书变更。返回 (machine_changes, exception_events, error)。"""
    all_items = []
    page_token = None
    while True:
        p = f"&page_token={page_token}" if page_token else ""
        data = _feishu_data(
            "GET", f"/apps/{_get_app_token()}/tables/{table_id}/records?page_size=500&automatic_fields=true{p}"
        )
        if not data:
            return None, None, {"machine": machine_name, "error": "API returned no data"}
        all_items.extend(data.get("items", []))
        if not data.get("has_more"):
            break
        page_token = data.get("page_token")

    machine_changes = _apply_pull_changes(machine_id, machine_name, all_items)
    _handle_exception_events(machine_id, machine_name, machine_changes.get("exception_events", []))
    _audit_active_exceptions_for_repair(machine_id, machine_name)
    return machine_changes, None, None


def _apply_pull_changes(machine_id, machine_name, feishu_items):
    """将飞书记录变更应用到本地 schedules 表。返回变更详情和异常事件。"""
    conn = get_db()
    updated = 0
    detail = []
    exception_events = []

    # 读取本地 record_id -> schedule_id 映射
    record_to_schedule = {}
    for rm in conn.execute(
        "SELECT schedule_id, feishu_record_id FROM feishu_record_mapping WHERE machine_id=?",
        (machine_id,)
    ).fetchall():
        record_to_schedule[rm["feishu_record_id"]] = rm["schedule_id"]

    # 加载 post-push 快照，用于区分"系统 push 改的"和"用户改的"
    snap_raw = conn.execute(
        "SELECT last_push_snapshot FROM feishu_sync_mapping WHERE machine_id=?",
        (machine_id,)
    ).fetchone()
    snapshot = {}
    if snap_raw and snap_raw["last_push_snapshot"]:
        try:
            snapshot = json.loads(snap_raw["last_push_snapshot"])
        except (json.JSONDecodeError, TypeError):
            snapshot = {}

    for item in feishu_items:
        fields = item.get("fields", {})
        record_id = item.get("record_id")

        # 快照过滤：push 后飞书 LMT ≤ 本地快照时间 → 系统自己改的，pull 跳过。
        # push 时序保证飞书处理(设 LMT) 先于本地记录 now_ms，所以 S < T 天然成立。
        feishu_ms = item.get("last_modified_time", 0) or 0
        snap_ms = snapshot.get(record_id)
        if snap_ms is not None and feishu_ms <= snap_ms:
            continue

        # 通过映射表查找 schedule_id（替代旧 _记录ID 解析）
        schedule_id = record_to_schedule.get(record_id)
        if not schedule_id:
            continue

        existing = conn.execute(
            "SELECT * FROM schedules WHERE id=?", (schedule_id,)
        ).fetchone()
        if not existing:
            continue

        # Last Write Wins：本地有未推送修改且不比飞书旧 → 保留本地，等 push 推上去
        local_ts = existing["local_modified_at"] or 0
        if local_ts > 0 and local_ts >= feishu_ms:
            continue

        # 解析飞书字段
        actual_start = _parse_feishu_datetime_for_pull(fields.get("实际开始"), existing["date"])
        actual_end = _parse_feishu_datetime_for_pull(fields.get("实际结束"), existing["date"])
        remark = _parse_feishu_text(fields.get("排班备注"))
        exception = _parse_feishu_text(fields.get("异常标记"))
        changed = False

        # 校验：实际开始 > 实际结束
        validation_error = None
        if actual_start is not None and actual_end is not None:
            if actual_start > actual_end:
                validation_error = "实际开始晚于实际结束"

        # 排班备注备份：飞书端有值则写入备份表（列被删后可恢复）
        if remark is not None:
            conn.execute(
                "INSERT OR REPLACE INTO feishu_field_backup (schedule_id, machine_id, field_name, field_value, recorded_at) VALUES (?,?,?,?,?)",
                (schedule_id, machine_id, "排班备注", remark, datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")),
            )

        # 更新排班备注（双向字段）
        if remark is not None and remark != (existing["remark"] or ""):
            conn.execute(
                "UPDATE schedules SET remark=? WHERE id=?",
                (remark, schedule_id),
            )
            detail.append({
                "machine": machine_name, "schedule_id": schedule_id,
                "field": "remark", "value": remark,
            })
            changed = True

        # 更新实际开始
        existing_as = existing["actual_start_min"]
        if actual_start is not None and (existing_as is None or actual_start != existing_as):
            if not validation_error:
                conn.execute(
                    "UPDATE schedules SET actual_start_min=? WHERE id=?",
                    (actual_start, schedule_id),
                )
                detail.append({
                    "machine": machine_name, "schedule_id": schedule_id,
                    "field": "actual_start_min", "value": actual_start,
                })
                changed = True

        # 更新实际结束 + 状态联动
        existing_ae = existing["actual_end_min"]
        if actual_end is not None and (existing_ae is None or actual_end != existing_ae):
            if validation_error:
                detail.append({
                    "machine": machine_name, "schedule_id": schedule_id,
                    "field": "actual_end_min", "error": validation_error,
                })
            else:
                conn.execute(
                    "UPDATE schedules SET actual_end_min=? WHERE id=?",
                    (actual_end, schedule_id),
                )
                detail.append({
                    "machine": machine_name, "schedule_id": schedule_id,
                    "field": "actual_end_min", "value": actual_end,
                })
                changed = True
                # 状态联动：飞书填了实际结束 -> 自动变已完成
                if existing["status"] != "completed":
                    conn.execute(
                        "UPDATE schedules SET status='completed', completed_at=? WHERE id=?",
                        (datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"), schedule_id),
                    )
                    detail.append({
                        "machine": machine_name, "schedule_id": schedule_id,
                        "field": "status", "value": "completed (auto from feishu)",
                    })
                    # 全部排班完成后同步标记任务状态
                    tid = existing["task_id"]
                    if tid is not None:
                        remaining = conn.execute(
                            "SELECT COUNT(*) AS c FROM schedules WHERE task_id=? AND status!='completed'",
                            (int(tid),),
                        ).fetchone()
                        if not remaining or remaining["c"] == 0:
                            conn.execute("UPDATE tasks SET status=? WHERE id=?", ("已完成", int(tid)))

        # 排班时间双向同步：飞书改排班时间 -> 记录漂移 + 更新排班 + 压实
        sched_start = _parse_feishu_datetime_for_pull(fields.get("排班开始"), existing["date"])
        sched_end = _parse_feishu_datetime_for_pull(fields.get("排班结束"), existing["date"])
        if sched_start is not None and sched_end is not None:
            old_start = existing["start_min"]
            old_end = existing["end_min"]
            if sched_start != (old_start or 0) or sched_end != (old_end or 0):
                # 漂移检测：记录变动前的排班窗口
                if old_start is not None and old_end is not None:
                    drift_window = _format_drift_window(
                        existing["date"], old_start, old_end
                    )
                    conn.execute(
                        "UPDATE schedules SET estimated_window=? WHERE id=?",
                        (drift_window, schedule_id),
                    )
                conn.execute(
                    "UPDATE schedules SET start_min=?, end_min=? WHERE id=?",
                    (sched_start, sched_end, schedule_id),
                )
                from utils import normalize_machine_schedule
                normalize_machine_schedule(conn, existing["date"], machine_id)
                detail.append({
                    "machine": machine_name, "schedule_id": schedule_id,
                    "field": "scheduled_time", "value": f"{sched_start}-{sched_end}",
                })
                changed = True

        # 异常标记/备注写回本地
        exception = _parse_feishu_text(fields.get("异常标记"))
        exception_note = _parse_feishu_text(fields.get("异常备注")) or ""
        local_exc = existing["exception_mark"] if "exception_mark" in existing.keys() else None
        if exception is not None and exception != local_exc:
            conn.execute(
                "UPDATE schedules SET exception_mark=?, exception_note=? WHERE id=?",
                (exception, exception_note, schedule_id),
            )
            detail.append({
                "machine": machine_name, "schedule_id": schedule_id,
                "field": "exception_mark", "value": exception,
            })
            changed = True

        # 独立处理 exception_note 变更（即使 exception_mark 没变）
        if exception_note != (existing["exception_note"] or ""):
            conn.execute(
                "UPDATE schedules SET exception_note=? WHERE id=?",
                (exception_note, schedule_id),
            )
            changed = True

        # 采集员：飞书 User 字段，只拉不推
        collector_raw = fields.get("采集员")
        if collector_raw is not None:
            collector = _parse_feishu_user(collector_raw)
            # 采集员备份：飞书端有值则写入备份表
            conn.execute(
                "INSERT OR REPLACE INTO feishu_field_backup (schedule_id, machine_id, field_name, field_value, recorded_at) VALUES (?,?,?,?,?)",
                (schedule_id, machine_id, "采集员", collector, datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")),
            )
            if collector != (existing["collector"] or ""):
                conn.execute(
                    "UPDATE schedules SET collector=? WHERE id=?",
                    (collector, schedule_id),
                )
                detail.append({
                    "machine": machine_name, "schedule_id": schedule_id,
                    "field": "collector", "value": collector,
                })
                changed = True

        # 检测异常标记变化（仅异常真正变化且排班活跃时才触发事件）
        # 已完成/未开始/过时的排班改异常标记 → 只同步数据，不触发机器状态变更
        if exception and exception != "正常" and exception != local_exc:
            if _schedule_is_active(existing):
                exception_events.append({
                    "machine_id": machine_id,
                    "machine_name": machine_name,
                    "schedule_id": schedule_id,
                    "exception": exception,
                    "exception_note": _parse_feishu_text(fields.get("异常备注")) or "",
                })
        elif exception == "正常" and local_exc and local_exc not in (None, "正常"):
            # 异常恢复为正常 → 触发维修结束（仅活跃排班）
            if _schedule_is_active(existing):
                exception_events.append({
                    "machine_id": machine_id,
                    "machine_name": machine_name,
                    "schedule_id": schedule_id,
                    "exception": "正常",
                })

        if changed:
            conn.execute(
                "UPDATE schedules SET local_modified_at=?, updated_at=? WHERE id=?",
                (feishu_ms, feishu_ms, schedule_id),
            )
            updated += 1

    conn.commit()
    conn.close()

    return {
        "records_updated": updated,
        "detail": detail,
        "exception_events": exception_events,
    }


def _get_exception_categories():
    """从 config 表读取异常标记列表，按位置推断语义。
    返回 (normal_option, fault_options, recycle_option)。
    约定：第一个=正常，最后一个=回收，中间=维修。"""
    try:
        conn = get_db()
        row = conn.execute(
            "SELECT value FROM config WHERE category='feishu' AND key='exception_options'"
        ).fetchone()
        conn.close()
        if row:
            opts = json.loads(row["value"])
            if len(opts) >= 2:
                return opts[0], opts[1:-1], opts[-1]
    except Exception:
        pass
    return "正常", ["机器故障", "缺少物料"], "无法执行"


def _handle_exception_events(machine_id, machine_name, events):
    """处理异常标记变更 -> 调用本地共享维修函数（与手动按钮走同一条路径）。
    二次校验排班状态：已完成/未开始/过时的排班不触发状态变更。"""
    if not events:
        return

    from utils import start_repair, end_repair

    normal_opt, fault_opts, recycle_opt = _get_exception_categories()

    conn = get_db()
    for event in events:
        exception = event["exception"]

        if exception in fault_opts:
            # 二次校验：排班必须当前活跃
            schedule = conn.execute(
                "SELECT * FROM schedules WHERE id=?", (event["schedule_id"],)
            ).fetchone()
            if not schedule or not _schedule_is_active(schedule):
                continue
            machine = conn.execute(
                "SELECT status FROM machines WHERE id=?", (machine_id,)
            ).fetchone()
            if machine and machine["status"] != "维修停用":
                conn.execute(
                    "UPDATE machines SET status='维修停用' WHERE id=?", (machine_id,)
                )
                start_repair(conn, machine_id)
                conn.commit()

        elif exception == recycle_opt:
            schedule = conn.execute(
                "SELECT s.*, m.group_name FROM schedules s LEFT JOIN machines m ON s.machine_id=m.id WHERE s.id=?",
                (event["schedule_id"],)
            ).fetchone()
            if not schedule or not _schedule_is_active(schedule):
                continue
            # 写入 push_log 供 _detect_local_events 扫描，生成回收推送卡片
            now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            recycle_data = json.dumps({
                "event_type": "task_recycled",
                "schedule_id": schedule["id"],
                "machine_id": machine_id,
                "machine_name": machine_name,
                "group_name": schedule["group_name"] or "",
                "task_name": schedule["task_name"] or "",
                "date": schedule["date"],
                "recycle_reason": exception,
                "exception_note": event.get("exception_note", ""),
                "recycle_time": now_str,
            }, ensure_ascii=False)
            conn.execute(
                """INSERT INTO push_log (dedup_key, event_type, target_type, target_id, notify_value, sent_at, success)
                   VALUES (?, 'task_recycled', '', '', ?, ?, 0)""",
                (f"recycle_{schedule['id']}", recycle_data, now_str),
            )
            conn.commit()
            # 回收
            recycle_schedules(conn, schedule_ids=[event["schedule_id"]])
            conn.commit()

            # 检查机器是否在维修中→如果这是唯一异常的排班→退出维修
            machine = conn.execute(
                "SELECT status FROM machines WHERE id=?", (machine_id,)
            ).fetchone()
            if machine and machine["status"] == "维修停用":
                remaining_exc = conn.execute(
                    """SELECT COUNT(*) AS c FROM schedules
                       WHERE machine_id=? AND status != 'completed'
                       AND exception_mark IS NOT NULL
                       AND exception_mark != '' AND exception_mark != ?""",
                    (machine_id, normal_opt),
                ).fetchone()
                if not remaining_exc or remaining_exc["c"] == 0:
                    from utils import end_repair
                    end_repair(conn, machine_id)
                    conn.commit()

            # 压实（受配置开关控制，默认开启）
            auto_compact_row = conn.execute(
                "SELECT value FROM config WHERE category='schedule_settings' AND key='auto_compact_recycle'"
            ).fetchone()
            auto_compact = True
            if auto_compact_row and auto_compact_row["value"] == "0":
                auto_compact = False
            if auto_compact:
                from utils import compact_machine_tasks
                schedule_date = schedule["date"]
                hole_start = int(schedule["start_min"])
                hole_end = int(schedule["end_min"])
                compact_machine_tasks(conn, machine_id, schedule_date, hole_start, hole_end)
                conn.commit()

        elif exception == normal_opt:
            # 检查机器上是否还有活跃排班处于异常状态，有则不结束维修
            machine = conn.execute(
                "SELECT status FROM machines WHERE id=?", (machine_id,)
            ).fetchone()
            if not machine or machine["status"] != "维修停用":
                continue
            # 查是否有其他活跃排班仍处于异常
            active_exc = conn.execute(
                """SELECT COUNT(*) AS c FROM schedules
                   WHERE machine_id=? AND status != 'completed'
                   AND exception_mark IS NOT NULL
                   AND exception_mark != '' AND exception_mark != ?""",
                (machine_id, normal_opt),
            ).fetchone()
            if active_exc and active_exc["c"] > 0:
                continue  # 还有其他异常排班，不结束维修
            conn.execute(
                "UPDATE machines SET status='空闲' WHERE id=?", (machine_id,)
            )
            end_repair(conn, machine_id)
            conn.commit()

    conn.close()


def _audit_active_exceptions_for_repair(machine_id, machine_name):
    """审计：检查当前活跃排班是否有异常标记，用于延后激活提前标记的异常。
    当排班开始后（从未来变为活跃），上次 pull 已同步了 exception_mark 但没触发事件。
    此审计在每次 pull 后执行，确保活跃排班的异常标记能激活维修状态。"""
    from utils import start_repair

    normal_opt, fault_opts, recycle_opt = _get_exception_categories()

    conn = get_db()
    try:
        now = datetime.datetime.now()
        active_exc_rows = conn.execute(
            f"""SELECT id, date, start_min, end_min, exception_mark, status
               FROM schedules
               WHERE machine_id=? AND status != 'completed'
               AND exception_mark IS NOT NULL
               AND exception_mark != '' AND exception_mark != ?
               AND exception_mark != ?""",
            (machine_id, normal_opt, recycle_opt),
        ).fetchall()

        for row in active_exc_rows:
            if not _schedule_is_active(row):
                continue  # 未开始或已结束，跳过

            # 活跃排班有异常 → 确保机器在维修状态
            machine = conn.execute(
                "SELECT status FROM machines WHERE id=?", (machine_id,)
            ).fetchone()
            if machine and machine["status"] != "维修停用":
                conn.execute(
                    "UPDATE machines SET status='维修停用' WHERE id=?", (machine_id,)
                )
                start_repair(conn, machine_id)
                conn.commit()
                break  # 一次只处理一条，避免重复创建维修记录
    except Exception:
        pass
    finally:
        conn.close()


def pull_all_machines():
    """并行从飞书拉取所有已映射机器的变更。"""
    conn = get_db()
    mappings = conn.execute("SELECT * FROM feishu_sync_mapping").fetchall()
    conn.close()

    result = {"machines_checked": 0, "records_updated": 0, "errors": [], "detail": []}

    if not mappings:
        return result

    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {
            executor.submit(
                _pull_one_machine,
                m["table_id"], m["machine_id"], m["machine_name"],
            ): m
            for m in mappings
        }
        for future in as_completed(futures):
            try:
                changes, _, error = future.result()
                if error:
                    result["errors"].append(error)
                else:
                    result["machines_checked"] += 1
                    result["records_updated"] += changes["records_updated"]
                    if changes.get("detail"):
                        result["detail"].extend(changes["detail"])
            except Exception:
                pass

    # 更新最后拉取时间
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    try:
        conn2 = get_db()
        for mapping in mappings:
            conn2.execute(
                "UPDATE feishu_sync_mapping SET last_pull_at=? WHERE machine_id=?",
                (now, mapping["machine_id"]),
            )
        conn2.commit()
        conn2.close()
    except Exception:
        pass

    return result
