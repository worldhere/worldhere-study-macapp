# -*- coding: utf-8 -*-
"""飞书事件源：扫描飞书排班表，检测场景 1-9 的事件"""
import json
import datetime
from db import get_db
from feishu.common import (
    _feishu_data, _parse_feishu_text,
    _get_app_token,
)
from feishu.schedule_sync import _schedule_is_active
from feishu.events.shared import (
    IMPENDING_MINUTES, DetectContext,
    _get_shift_context, _schedule_in_current_shift,
    _ts_to_minutes, _cross_midnight_diff,
)


# ========== 飞书表拉取 ==========

def _fetch_feishu_schedules(table_id):
    """拉取飞书排班表全量记录。返回 [{record_id, fields, ...}]"""
    all_items = []
    page_token = None
    while True:
        p = f"&page_token={page_token}" if page_token else ""
        data = _feishu_data(
            "GET",
            f"/apps/{_get_app_token()}/tables/{table_id}/records?page_size=500&automatic_fields=true{p}"
        )
        if data:
            all_items.extend(data.get("items", []))
        if not data or not data.get("has_more"):
            break
        page_token = data.get("page_token")
    return all_items


# ========== 上下文构建 ==========

def _build_context(conn, machine_id, snapshot):
    """构建检测器共享上下文"""
    now = datetime.datetime.now()
    now_min = now.hour * 60 + now.minute
    today_str = now.strftime("%Y-%m-%d")

    current_shift, day_oe, night_oe, day_start, night_start = _get_shift_context(conn)

    # 一次性加载该机器的 record_id -> schedule_id 映射
    record_to_sid = {}
    for rm in conn.execute(
        "SELECT schedule_id, feishu_record_id FROM feishu_record_mapping WHERE machine_id=?",
        (machine_id,)
    ).fetchall():
        record_to_sid[rm["feishu_record_id"]] = rm["schedule_id"]

    sch_map = {}
    if record_to_sid:
        sid_list = list(record_to_sid.values())
        placeholders = ",".join("?" for _ in sid_list)
        sch_rows = conn.execute(
            f"""SELECT s.*, m.group_name, m.type AS machine_type, t.package_id, t.priority,
                       pkg.name AS package_name
                FROM schedules s
                LEFT JOIN machines m ON s.machine_id = m.id
                LEFT JOIN tasks t ON s.task_id = t.id
                LEFT JOIN task_packages pkg ON t.package_id = pkg.id
                WHERE s.id IN ({placeholders})""",
            sid_list
        ).fetchall()
        sch_map = {row["id"]: row for row in sch_rows}

    return DetectContext(
        conn=conn, now=now, now_min=now_min, today_str=today_str,
        current_shift=current_shift, day_oe=day_oe, night_oe=night_oe,
        day_start=day_start, night_start=night_start,
        record_to_sid=record_to_sid, sch_map=sch_map, snapshot=snapshot,
    )


def _check_data_changed(item, ctx):
    """快照短路：数据没变则跳过变更类场景"""
    feishu_ms = item.get("last_modified_time", 0) or 0
    snap_ms = ctx.snapshot.get(item.get("record_id"))
    return (snap_ms is None) or (feishu_ms != snap_ms)


# ========== 场景检测器 ==========

def _detect_impending_start(item, ctx, base_info, fields_info):
    """场景 1: 任务即将开始。跳过已有人开始操作的排班。"""
    start_min = base_info["start_min"]
    if start_min is None:
        return []
    if fields_info["status_text"] == "已完成" or base_info["actual_start_min"] is not None:
        return []
    minutes_until_start = _cross_midnight_diff(start_min, ctx.now_min)
    if minutes_until_start is not None and 0 <= minutes_until_start <= IMPENDING_MINUTES:
        return [{
            **base_info,
            "event_type": "task_impending_start",
            "minutes_remaining": minutes_until_start,
        }]
    return []


def _detect_actual_start(item, ctx, base_info, fields_info):
    """场景 2+3: 实际开始被填写（同源双发）。
    若同时填写了 actual_end，跳过——只推已确定完成。"""
    data_changed = fields_info["data_changed"]
    actual_start_min = base_info["actual_start_min"]
    if not data_changed or actual_start_min is None:
        return []
    # 同时填了实际结束 → 只推完成，不推开始
    if base_info["actual_end_min"] is not None:
        return []
    events = []
    start_min = base_info["start_min"]
    # 场景 2: 给小组长（提早填写判断）
    if start_min is not None and actual_start_min < start_min:
        events.append({**base_info, "event_type": "task_start", "early_fill": True})
    # 场景 3: 给群（结果通知）
    events.append({**base_info, "event_type": "task_confirm_start"})
    return events


def _detect_time_change(item, ctx, base_info, fields_info):
    """场景 4: 排班时间变动"""
    data_changed = fields_info["data_changed"]
    start_min = base_info["start_min"]
    end_min = base_info["end_min"]
    if not data_changed or start_min is None or end_min is None:
        return []
    schedule_id = base_info["schedule_id"]
    dedup_key = f"time_change_{schedule_id}"
    current_val = {"start_min": start_min, "end_min": end_min}
    current_val_json = json.dumps(current_val, ensure_ascii=False, sort_keys=True)
    existing = ctx.conn.execute(
        "SELECT notify_value FROM push_log WHERE dedup_key=?",
        (dedup_key,)
    ).fetchone()
    events = []
    if existing:
        old_val = (existing["notify_value"] or "").strip()
        if old_val != current_val_json:
            try:
                old_data = json.loads(old_val)
                events.append({
                    **base_info,
                    "event_type": "schedule_changes",
                    "old_start_min": old_data.get("start_min"),
                    "old_end_min": old_data.get("end_min"),
                })
            except json.JSONDecodeError:
                pass
            # 更新基线为新值
            ctx.conn.execute(
                "UPDATE push_log SET notify_value=? WHERE dedup_key=?",
                (current_val_json, dedup_key),
            )
            ctx.conn.commit()
    else:
        # 首次记录基线，不触发事件
        ctx.conn.execute(
            "INSERT INTO push_log (dedup_key, event_type, target_type, target_id, notify_value, sent_at, success)"
            " VALUES (?, 'time_change_baseline', 'system', '', ?, ?, 1)",
            (dedup_key, current_val_json,
             datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")),
        )
        ctx.conn.commit()
    return events


def _detect_exception_start(item, ctx, base_info, fields_info):
    """场景 5+5b: 异常开始 + 异常备注补充"""
    data_changed = fields_info["data_changed"]
    exception_mark = fields_info["exception_mark"]
    if not data_changed or not exception_mark or exception_mark == "正常":
        return []
    sch = ctx.sch_map.get(base_info["schedule_id"])
    events = []
    schedule_id = base_info["schedule_id"]

    # 场景 5: 异常开始（仅排班活跃时触发）
    if _schedule_is_active(sch):
        events.append({
            **base_info,
            "event_type": "exception_start",
            "exception_reason": exception_mark,
            "exception_note": fields_info["exception_note"],
        })

    # 场景 5b: 异常备注补充（已发过异常开始，后续又有编辑）
    current_note = fields_info["exception_note"]
    exc_sent = ctx.conn.execute(
        "SELECT notify_value FROM push_log WHERE dedup_key=? AND event_type='exception_start' ORDER BY sent_at DESC LIMIT 1",
        (f"exc_{schedule_id}_start",)
    ).fetchone()
    if exc_sent and (exc_sent["notify_value"] or "").strip() == exception_mark and current_note:
        events.append({
            **base_info,
            "event_type": "exception_update",
            "exception_reason": exception_mark,
            "exception_note": current_note,
        })

    return events


def _detect_exception_end(item, ctx, base_info, fields_info):
    """场景 6: 异常恢复"""
    data_changed = fields_info["data_changed"]
    exception_mark = fields_info["exception_mark"]
    if not data_changed or exception_mark != "正常":
        return []
    schedule_id = base_info["schedule_id"]
    exc_record = ctx.conn.execute(
        "SELECT sent_at, notify_value FROM push_log WHERE dedup_key=? AND event_type='exception_start'",
        (f"exc_{schedule_id}_start",)
    ).fetchone()
    if exc_record:
        now = datetime.datetime.now()
        start_str = exc_record["sent_at"] or ""
        start_fmt = ""
        duration_str = ""
        try:
            if start_str:
                start_dt = datetime.datetime.strptime(start_str, "%Y-%m-%d %H:%M:%S")
                start_fmt = start_dt.strftime("%m-%d %H:%M")
                seconds = max(0, int((now - start_dt).total_seconds()))
                hours = seconds // 3600
                minutes = (seconds % 3600) // 60
                if hours > 0:
                    duration_str = f"{hours}小时{minutes}分钟"
                else:
                    duration_str = f"{minutes}分钟"
        except (ValueError, TypeError):
            start_fmt = start_str
        return [{
            **base_info,
            "event_type": "exception_end",
            "start_time": start_fmt,
            "end_time": now.strftime("%m-%d %H:%M"),
            "exception_reason": (exc_record["notify_value"] or ""),
            "duration": duration_str,
        }]
    return []


def _detect_impending_end(item, ctx, base_info, fields_info):
    """场景 7: 任务即将结束"""
    end_min = base_info["end_min"]
    if end_min is None:
        return []
    if fields_info["status_text"] == "已完成":
        return []
    minutes_until_end = _cross_midnight_diff(end_min, ctx.now_min)
    if minutes_until_end is not None and 0 <= minutes_until_end <= IMPENDING_MINUTES:
        return [{
            **base_info,
            "event_type": "task_impending_end",
            "minutes_remaining": minutes_until_end,
        }]
    return []


def _detect_actual_end(item, ctx, base_info, fields_info):
    """场景 8+9: 实际结束被填写（同源双发）"""
    data_changed = fields_info["data_changed"]
    actual_end_min = base_info["actual_end_min"]
    if not data_changed or actual_end_min is None:
        return []
    events = []
    end_min = base_info["end_min"]
    # 场景 8: 给小组长（提早填写判断）
    if end_min is not None and actual_end_min < end_min:
        events.append({**base_info, "event_type": "task_end", "early_fill": True})
    # 场景 9: 给群（结果通知）
    events.append({**base_info, "event_type": "task_confirm_end"})
    return events


# 检测器列表：按顺序执行，每个检测器独立
DETECTORS = [
    _detect_impending_start,
    _detect_actual_start,
    _detect_time_change,
    _detect_exception_start,
    _detect_exception_end,
    _detect_impending_end,
    _detect_actual_end,
]


# ========== 入口 ==========

def detect_from_feishu(machine_id, machine_name, feishu_items, snapshot=None):
    """扫描一台机器的飞书排班记录，检测场景 1-9 的事件。
    返回事件列表: [{event_type, schedule_id, machine_name, ...}]
    snapshot: {record_id: last_modified_time} 用于快照短路"""
    if snapshot is None:
        snapshot = {}
    conn = get_db()
    ctx = _build_context(conn, machine_id, snapshot)

    if not ctx.record_to_sid:
        conn.close()
        return []

    events = []

    for item in feishu_items:
        fields = item.get("fields", {})
        record_id = item.get("record_id")
        if not record_id:
            continue

        schedule_id = ctx.record_to_sid.get(record_id)
        if not schedule_id:
            continue

        sch = ctx.sch_map.get(schedule_id)
        if not sch:
            continue

        date_str = sch["date"]
        # 日期过滤：允许昨天/今天/明天（覆盖夜班跨天），拦截更早和更远的
        yesterday_str = (ctx.now - datetime.timedelta(days=1)).strftime("%Y-%m-%d")
        tomorrow_str = (ctx.now + datetime.timedelta(days=1)).strftime("%Y-%m-%d")
        if date_str < yesterday_str or date_str > tomorrow_str:
            continue

        task_name = sch["task_name"] or ""
        start_ts = fields.get("排班开始")
        end_ts = fields.get("排班结束")
        actual_start_ts = fields.get("实际开始")
        actual_end_ts = fields.get("实际结束")
        status_text = _parse_feishu_text(fields.get("状态"))
        exception_mark = _parse_feishu_text(fields.get("异常标记")) or "正常"

        start_min = _ts_to_minutes(start_ts, date_str)
        end_min = _ts_to_minutes(end_ts, date_str)
        actual_start_min = _ts_to_minutes(actual_start_ts, date_str)
        actual_end_min = _ts_to_minutes(actual_end_ts, date_str)

        # 班次过滤：不属当前班次的排班不推送
        if not _schedule_in_current_shift(start_min, ctx.current_shift, ctx.day_start, ctx.day_oe, ctx.night_start, ctx.night_oe):
            continue

        data_changed = _check_data_changed(item, ctx)

        base_info = {
            "schedule_id": schedule_id,
            "machine_id": machine_id,
            "machine_name": machine_name,
            "task_name": task_name,
            "date": date_str,
            "start_min": start_min,
            "end_min": end_min,
            "actual_start_min": actual_start_min,
            "actual_end_min": actual_end_min,
            "group_name": sch["group_name"] or "",
            "package_name": sch["package_name"] or "",
            "duration_minutes": (end_min - start_min) if (start_min is not None and end_min is not None) else None,
            "priority": sch["priority"] or "",
            "machine_type": sch["machine_type"] or "",
            "collector": sch["collector"] or "",
        }

        fields_info = {
            "status_text": status_text,
            "exception_mark": exception_mark,
            "exception_note": _parse_feishu_text(fields.get("异常备注")) or "",
            "data_changed": data_changed,
        }

        for detector in DETECTORS:
            try:
                result = detector(item, ctx, base_info, fields_info)
                if result:
                    events.extend(result)
            except Exception:
                pass  # 单个检测器失败不阻塞其他

    conn.close()
    return events
