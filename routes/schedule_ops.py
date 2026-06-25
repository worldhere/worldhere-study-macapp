import datetime
import json
import re
from flask import Blueprint, request, jsonify

from db import get_db, get_allowed_task_kinds
from utils import parse_date, parse_duration_to_minutes, normalize_machine_schedule, min_to_hhmm
from utils import abs_min_to_label, machine_full_name, px_to_abs_min
from models import get_repair_logs, task_insert_values, TASK_INSERT_FIELDS, TASK_INSERT_PLACEHOLDERS, recycle_split_segment, recycle_schedules

bp = Blueprint('schedule_ops', __name__)


@bp.route('/assign_task', methods=['POST'])
def assign_task():
    d = request.get_json()
    date = parse_date(d.get("date"))
    tid, mid = int(d["task_id"]), int(d["machine_id"])
    if d.get("start_min") is not None:
        start_min = int(d.get("start_min"))
    else:
        left_px, width_px = float(d.get("left", 0)), float(d.get("width", 160))
        start_min = px_to_abs_min(left_px)
    start_min = max(0, min(28 * 1440 - 1, start_min))

    conn = get_db()
    task = conn.execute("SELECT * FROM tasks WHERE id=?", (tid,)).fetchone()
    machine = conn.execute("SELECT * FROM machines WHERE id=?", (mid,)).fetchone()
    if not task or not machine:
        conn.close()
        return jsonify({"msg": "不存在"})
    type_mismatch = task["type"] != machine["type"]
    kind_mismatch = (task["task_kind"] or "") != (machine["task_kind"] or "")
    if (type_mismatch or kind_mismatch) and not d.get("force"):
        conn.close()
        return jsonify({"msg": "机型或任务类型不匹配"})
    end_date_str = d.get("end_date") or d.get("date")
    end_date_val = parse_date(end_date_str)

    if d.get("end_min") is not None:
        end_min = int(d.get("end_min"))
        if end_date_val != date:
            end_min = 24 * 60 + end_min
        else:
            end_min = max(start_min + 1, min(28 * 1440, end_min))
        dur_min = end_min - start_min
    else:
        est_seconds = task["est_seconds"]
        if est_seconds is not None:
            dur_min = max(1, int(est_seconds) // 60)
        else:
            dur_min = parse_duration_to_minutes(
                task["duration"], default_minutes=max(1, px_to_abs_min(float(d.get("width", 160))))
            )
        end_min = min(28 * 1440, start_min + dur_min)
        if end_date_val != date:
            end_min = 24 * 60 + (end_min - start_min)
            dur_min = end_min - start_min

    conn.execute("DELETE FROM schedules WHERE task_id=? AND machine_id=?", (tid, mid))

    # 已完成的任务不应被重新分配覆盖状态
    existing = conn.execute("SELECT status FROM tasks WHERE id=?", (tid,)).fetchone()
    if not existing or existing["status"] != "已完成":
        conn.execute("UPDATE tasks SET status=? WHERE id=?", ("已分配", tid))
    conn.execute(
        """
        INSERT INTO schedules(date,machine_id,machine_name,task_id,task_name,task_type,task_kind,duration,remark,start_min,end_min,status,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        """,
        (
            date,
            mid,
            machine_full_name(machine['name'], machine['type'], machine['task_kind']),
            tid,
            task["name"],
            task["type"],
            task["task_kind"],
            task["duration"],
            (task["remark"] or "") if "remark" in task.keys() else "",
            start_min,
            end_min,
            "executing",
            datetime.datetime.now().isoformat(timespec="seconds"),
        ),
    )
    normalize_machine_schedule(conn, date, mid)
    conn.commit()

    new_id_row = conn.execute("SELECT last_insert_rowid()").fetchone()
    new_id = new_id_row[0]
    new_sch = conn.execute("SELECT * FROM schedules WHERE id=?", (new_id,)).fetchone()
    conn.close()

    return jsonify({
        "msg": "指派成功（已自动消除重叠并顺延后续任务）",
        "schedule_id": new_id,
        "task_name": new_sch["task_name"],
        "task_type": new_sch["task_type"],
        "task_kind": new_sch["task_kind"],
        "priority": (task["priority"] or ""),
        "difficulty": (task["difficulty"] or ""),
        "remark": (task["remark"] or ""),
        "start_min": new_sch["start_min"],
        "end_min": new_sch["end_min"],
        "date": new_sch["date"],
    })


@bp.route('/move_task', methods=['POST'])
def move_task():
    d = request.get_json()
    date = parse_date(d.get("date"))
    sid, new_mid = int(d["schedule_id"]), int(d["new_machine_id"])
    if d.get("new_start_min") is not None:
        new_start_min = int(d.get("new_start_min"))
    else:
        new_left_px = float(d.get("new_left", 0))
        new_start_min = px_to_abs_min(new_left_px)
    new_start_min = max(0, min(28 * 1440 - 1, new_start_min))

    conn = get_db()
    sch = conn.execute("SELECT * FROM schedules WHERE id=?", (sid,)).fetchone()
    new_m = conn.execute("SELECT * FROM machines WHERE id=?", (new_mid,)).fetchone()
    if not sch or not new_m:
        conn.close()
        return jsonify({"msg": "不存在"})
    type_mismatch = sch["task_type"] != new_m["type"]
    kind_mismatch = (sch["task_kind"] or "") != (new_m["task_kind"] or "")
    if (type_mismatch or kind_mismatch) and not d.get("force"):
        conn.close()
        return jsonify({"msg": "机型或任务类型不匹配"})
    dur = max(1, int(sch["end_min"]) - int(sch["start_min"]))
    new_end_min = min(28 * 1440, new_start_min + dur)
    old_mid = int(sch["machine_id"])
    old_date = sch["date"]
    conn.execute(
        "UPDATE schedules SET date=?, machine_id=?, machine_name=?, start_min=?, end_min=? WHERE id=?",
        (date, new_mid, machine_full_name(new_m['name'], new_m['type'], new_m['task_kind']), new_start_min, new_end_min, sid),
    )
    normalize_machine_schedule(conn, date, new_mid)
    if old_mid != new_mid or old_date != date:
        normalize_machine_schedule(conn, old_date, old_mid)
    conn.commit()
    conn.close()
    mids = [new_mid]
    if old_mid != new_mid:
        mids.append(old_mid)
    return jsonify({"msg": "ok"})


@bp.route('/update_task_pos', methods=['POST'])
def update_task_pos():
    d = request.get_json()
    date = parse_date(d.get("date"))
    sid = int(d["schedule_id"])
    if d.get("start_min") is not None:
        start_min = int(d.get("start_min"))
    else:
        start_min = px_to_abs_min(float(d.get("left", 0)))
    start_min = max(0, min(28 * 1440 - 1, start_min))

    conn = get_db()
    sch = conn.execute("SELECT machine_id,start_min,end_min,date FROM schedules WHERE id=?", (sid,)).fetchone()
    if not sch:
        conn.close()
        return jsonify({"msg": "不存在"})
    dur = max(1, int(sch["end_min"]) - int(sch["start_min"]))
    end_min = min(28 * 1440, start_min + dur)
    mid = int(sch["machine_id"])
    conn.execute("UPDATE schedules SET date=?, start_min=?, end_min=? WHERE id=?", (date, start_min, end_min, sid))
    normalize_machine_schedule(conn, date, mid)
    conn.commit()
    conn.close()
    return jsonify({"msg":"ok"})


@bp.route('/update_task_bounds', methods=['POST'])
def update_task_bounds():
    d = request.get_json()
    date = parse_date(d.get("date"))
    sid = int(d["schedule_id"])
    if d.get("start_min") is not None:
        start_min = int(d.get("start_min"))
    else:
        start_min = px_to_abs_min(float(d.get("left", 0)))
    start_min = max(0, min(28 * 1440 - 1, start_min))
    if d.get("end_min") is not None:
        end_min = int(d.get("end_min"))
        end_min = max(start_min + 1, min(28 * 1440, end_min))
    else:
        dur_min = max(1, px_to_abs_min(float(d.get("width", 20))))
        end_min = min(28 * 1440, start_min + dur_min)

    conn = get_db()
    sch = conn.execute("SELECT machine_id,date,task_id FROM schedules WHERE id=?", (sid,)).fetchone()
    if not sch:
        conn.close()
        return jsonify({"msg": "不存在"})
    mid = int(sch["machine_id"])
    conn.execute(
        "UPDATE schedules SET date=?, start_min=?, end_min=? WHERE id=?",
        (date, start_min, end_min, sid),
    )
    normalize_machine_schedule(conn, date, mid)
    conn.commit()
    conn.close()
    return jsonify({"msg":"ok"})


@bp.route('/complete_task/<int:sid>')
def complete_task(sid):
    conn = get_db()
    sch = conn.execute("SELECT task_id, date FROM schedules WHERE id=?", (sid,)).fetchone()
    if sch and sch["task_id"] is not None:
        task = conn.execute("SELECT split_group, expected_count, split_total_items, name FROM tasks WHERE id=?",
                            (int(sch["task_id"]),)).fetchone()
        if task and task["split_group"]:
            exp = task["expected_count"]
            total = task["split_total_items"]
            tid = int(sch["task_id"])
            if exp and int(exp) > 0 and total and int(total) > 0:
                pct = min(100, round(int(exp) / int(total) * 100))
                new_name = task["name"] + "（" + str(pct) + "%）"
                conn.execute(
                    "UPDATE tasks SET status=?, split_items_done=?, expected_count=?, name=? WHERE id=?",
                    ("已完成", int(exp), int(exp), new_name, tid),
                )
            elif exp and int(exp) > 0:
                new_name = task["name"] + "（100%）"
                conn.execute(
                    "UPDATE tasks SET status=?, split_items_done=?, expected_count=?, name=? WHERE id=?",
                    ("已完成", int(exp), int(exp), new_name, tid),
                )
            else:
                conn.execute(
                    "UPDATE tasks SET status=?, split_items_done=?, split_total_items=? WHERE id=?",
                    ("已完成", 0, 0, tid),
                )
            now = datetime.datetime.now()
            sch_date = datetime.date.fromisoformat(sch["date"])
            actual_end_min = int((now - datetime.datetime.combine(sch_date, datetime.time(0, 0))).total_seconds() / 60)
            conn.execute(
                "UPDATE schedules SET status=?, completed_at=?, actual_end_min=? WHERE id=?",
                ("completed", now.isoformat(timespec="seconds"), actual_end_min, sid),
            )
            conn.commit()
            conn.close()
            return jsonify({"msg":"ok"})
    now = datetime.datetime.now()
    if sch is None:
        sch = conn.execute("SELECT date FROM schedules WHERE id=?", (sid,)).fetchone()
    if sch:
        sch_date = datetime.date.fromisoformat(sch["date"])
        actual_end_min = int((now - datetime.datetime.combine(sch_date, datetime.time(0, 0))).total_seconds() / 60)
    else:
        actual_end_min = None
    conn.execute(
        "UPDATE schedules SET status=?, completed_at=?, actual_end_min=? WHERE id=?",
        ("completed", now.isoformat(timespec="seconds"), actual_end_min, sid),
    )
    if sch and sch["task_id"] is not None:
        tid = int(sch["task_id"])
        # 检查该任务是否还有其他未完成的排班，全部完成才标记为"已完成"
        remaining = conn.execute(
            "SELECT COUNT(*) AS c FROM schedules WHERE task_id=? AND status!='completed'", (tid,)
        ).fetchone()
        if not remaining or remaining["c"] == 0:
            conn.execute("UPDATE tasks SET status=? WHERE id=?", ("已完成", tid))
    conn.commit()
    conn.close()
    return jsonify({"msg":"ok"})


@bp.route('/complete_split_task', methods=['POST'])
def complete_split_task():
    d = request.get_json()
    sid = int(d.get("schedule_id", 0))
    items_done = int(d.get("items_done", 0))
    expected_count = int(d.get("expected_count", 0))

    conn = get_db()
    sch = conn.execute("SELECT task_id, date FROM schedules WHERE id=?", (sid,)).fetchone()
    if not sch or sch["task_id"] is None:
        conn.close()
        return jsonify({"error": "记录不存在"})

    tid = int(sch["task_id"])
    task = conn.execute("SELECT * FROM tasks WHERE id=?", (tid,)).fetchone()
    if not task:
        conn.close()
        return jsonify({"error": "任务不存在"})

    split_total = task["split_total_items"]
    pct = 0
    if expected_count > 0 and split_total and int(split_total) > 0:
        pct = round(min(100, int(expected_count) / int(split_total) * 100))

    base_name = task["name"]
    new_name = base_name + "（" + str(pct) + "%）" if pct > 0 else base_name

    conn.execute("BEGIN")
    conn.execute(
        "UPDATE tasks SET status=?, split_items_done=?, expected_count=?, name=? WHERE id=?",
        ("已完成", items_done, expected_count, new_name, tid),
    )
    now = datetime.datetime.now()
    sch_date = datetime.date.fromisoformat(sch["date"])
    actual_end_min = int((now - datetime.datetime.combine(sch_date, datetime.time(0, 0))).total_seconds() / 60)
    conn.execute(
        "UPDATE schedules SET status=?, completed_at=?, actual_end_min=? WHERE id=?",
        ("completed", now.isoformat(timespec="seconds"), actual_end_min, sid),
    )
    conn.commit()
    conn.close()
    return jsonify({"msg": "完成", "new_name": new_name, "pct": pct})


@bp.route('/uncomplete_task/<int:sid>')
def uncomplete_task(sid):
    conn = get_db()
    sch = conn.execute("SELECT task_id FROM schedules WHERE id=?", (sid,)).fetchone()
    conn.execute(
        "UPDATE schedules SET status=?, completed_at=NULL, actual_end_min=NULL WHERE id=?",
        ("executing", sid),
    )
    if sch and sch["task_id"] is not None:
        conn.execute("UPDATE tasks SET status=? WHERE id=?", ("已分配", int(sch["task_id"])))
    conn.commit()
    conn.close()
    return jsonify({"msg":"ok"})


@bp.route('/delete_schedule/<int:sid>')
def delete_schedule(sid):
    conn = get_db()
    sch = conn.execute("SELECT * FROM schedules WHERE id=?", (sid,)).fetchone()
    if not sch:
        conn.close()
        return jsonify({"msg": "不存在"})

    log_id = None
    tid = None
    recovered_to = None
    exp_val = 0
    if sch["task_id"] is not None:
        tid = int(sch["task_id"])
        task = conn.execute("SELECT * FROM tasks WHERE id=?", (tid,)).fetchone()
        if task:
            record_json = json.dumps(dict(task), ensure_ascii=False)
            cur = conn.execute(
                "INSERT INTO deletion_log(deleted_at, table_name, record_id, record_json) VALUES (?,?,?,?)",
                (datetime.datetime.now().isoformat(timespec="seconds"), "tasks", tid, record_json),
            )
            log_id = cur.lastrowid
            if task["split_group"] and task["split_order"] is not None:
                recovered_to, exp_val = recycle_split_segment(conn, task)

        conn.execute("DELETE FROM tasks WHERE id=?", (tid,))

    conn.execute("DELETE FROM schedules WHERE id=?", (sid,))
    mid_dirty = int(sch["machine_id"]) if sch else 0
    conn.commit()
    conn.close()
    if recovered_to and exp_val > 0:
        return jsonify({"msg": "已删除，" + str(exp_val) + " 条数据已回收至「" + recovered_to + "」", "log_id": log_id, "task_id": tid})
    return jsonify({"msg": "已删除", "log_id": log_id, "task_id": tid})


@bp.route('/restore_deleted_and_assign', methods=['POST'])
def restore_deleted_and_assign():
    d = request.get_json()
    log_id = int(d.get("log_id", 0))
    date = parse_date(d.get("date"))
    mid = int(d.get("machine_id", 0))
    start_min = int(d.get("start_min", 0))
    end_min = int(d.get("end_min", start_min + 60))

    conn = get_db()
    row = conn.execute("SELECT * FROM deletion_log WHERE id=?", (log_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"msg": "删除记录不存在"})

    record = json.loads(row["record_json"])
    try:
        allowed_kinds = get_allowed_task_kinds()
        if not record.get("task_kind"):
            record["task_kind"] = allowed_kinds[0] if allowed_kinds else "常规"
        cur = conn.execute(
            f"INSERT INTO tasks({TASK_INSERT_FIELDS}) VALUES ({TASK_INSERT_PLACEHOLDERS})",
            task_insert_values(record, "已分配"),
        )
        new_tid = cur.lastrowid

        machine = conn.execute("SELECT * FROM machines WHERE id=?", (mid,)).fetchone()
        machine_name_full = machine_full_name(machine['name'], machine['type'], machine['task_kind']) if machine else ""

        conn.execute(
            """INSERT INTO schedules(date, machine_id, machine_name, task_id, task_name,
               task_type, task_kind, duration, remark, start_min, end_min, status, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now','localtime'))""",
            (
                date, mid, machine_name_full, new_tid, record.get("name"),
                record.get("type"), record.get("task_kind") or "常规",
                record.get("duration", ""), record.get("remark", ""),
                start_min, end_min, "executing",
            ),
        )

        conn.execute("DELETE FROM deletion_log WHERE id=?", (log_id,))
        normalize_machine_schedule(conn, date, mid)
        conn.commit()
        msg = "已撤回删除"
    except Exception as e:
        conn.rollback()
        msg = f"撤回失败: {e}"
    finally:
        conn.close()
    return jsonify({"msg": msg})


@bp.route('/edit_task', methods=['POST'])
def edit_task():
    d = request.get_json()
    sid = int(d["schedule_id"])
    name = d.get("name") or ""
    duration = d.get("duration") or ""
    remark = d.get("remark") or ""
    _has_remark = "remark" in d  # 区分 "未提供" 与 "提供为空"
    conn = get_db()
    sch = conn.execute("SELECT * FROM schedules WHERE id=?", (sid,)).fetchone()
    if not sch:
        conn.close()
        return jsonify({"msg": "排班不存在"})

    conn.execute(
        "UPDATE schedules SET task_name=?, duration=?, remark=? WHERE id=?",
        (name, duration, remark, sid),
    )

    if sch["task_id"] is not None:
        tid = int(sch["task_id"])

        # ── 辅助：仅当 key 存在于 JSON 中才提取，避免 "未提供" 与 "清空" 混淆 ──
        def _str(key):
            """key 存在时返回 strip 后的字符串（允许空串）；不存在返回 None"""
            if key in d:
                return (d[key] or "").strip()
            return None

        tk = _str("task_kind")
        tt = _str("task_type")
        pri = _str("priority")
        diff = _str("difficulty")
        rbp = _str("rbp_task_id")
        sc = _str("scene")
        gc = _str("general_category")
        sl = _str("source_link")
        cri = _str("collection_req_id")
        crt = _str("collection_req_type")

        if tk is not None and tk in get_allowed_task_kinds():
            conn.execute("UPDATE tasks SET task_kind=? WHERE id=?", (tk, tid))
        if tt is not None:
            conn.execute("UPDATE tasks SET type=? WHERE id=?", (tt, tid))
        if name:
            conn.execute("UPDATE tasks SET name=? WHERE id=?", (name, tid))
        if pri is not None:
            conn.execute("UPDATE tasks SET priority=? WHERE id=?", (pri, tid))
        if diff is not None:
            conn.execute("UPDATE tasks SET difficulty=? WHERE id=?", (diff, tid))
        if _has_remark:
            conn.execute("UPDATE tasks SET remark=? WHERE id=?", (remark, tid))
        if rbp is not None:
            conn.execute("UPDATE tasks SET rbp_task_id=? WHERE id=?", (rbp, tid))
        if sc is not None:
            conn.execute("UPDATE tasks SET scene=? WHERE id=?", (sc, tid))
        if gc is not None:
            conn.execute("UPDATE tasks SET general_category=? WHERE id=?", (gc, tid))
        if sl is not None:
            conn.execute("UPDATE tasks SET source_link=? WHERE id=?", (sl, tid))
        if cri is not None:
            conn.execute("UPDATE tasks SET collection_req_id=? WHERE id=?", (cri, tid))
        if crt is not None:
            conn.execute("UPDATE tasks SET collection_req_type=? WHERE id=?", (crt, tid))

        # expected_count：显式区分 None/''（清空为 NULL）与数值（含 0）
        if "expected_count" in d:
            ec = d["expected_count"]
            if ec is None or (isinstance(ec, str) and ec.strip() == ''):
                conn.execute("UPDATE tasks SET expected_count=NULL WHERE id=?", (tid,))
            else:
                conn.execute("UPDATE tasks SET expected_count=? WHERE id=?", (max(0, int(ec)), tid))

        if name:
            conn.execute("UPDATE schedules SET task_name=? WHERE task_id=?", (name, tid))
        if tt is not None:
            conn.execute("UPDATE schedules SET task_type=? WHERE task_id=?", (tt, tid))
        if tk is not None and tk in get_allowed_task_kinds():
            conn.execute("UPDATE schedules SET task_kind=? WHERE task_id=?", (tk, tid))

    conn.commit()
    conn.close()
    mid_dirty = int(sch["machine_id"]) if sch else 0
    return jsonify({"msg":"已修改"})


@bp.route('/quick_ops', methods=['POST'])
def quick_ops():
    d = request.get_json()
    action = d.get("action", "")
    date = parse_date(d.get("date"))
    date_from = d.get("date_from") or ""
    date_to = d.get("date_to") or ""
    span_days = max(1, int(d.get("span_days", 2) or 2))
    conn = get_db()

    # Build date list for multi-day operations
    # Supports both custom range (date_from/date_to) and span-based (date + span_days)
    def _dates_in_range():
        if date_from and date_to:
            base = datetime.date.fromisoformat(date_from)
            end = datetime.date.fromisoformat(date_to)
            result = []
            current = base
            while current <= end:
                result.append(current)
                current += datetime.timedelta(days=1)
            return result
        else:
            base = datetime.date.fromisoformat(date)
            return [base + datetime.timedelta(days=i) for i in range(span_days)]

    try:
        if action == "delete_completed":
            all_dates = d.get("all_dates", False)
            if all_dates:
                cur = conn.execute(
                    "DELETE FROM schedules WHERE status='completed'").rowcount
                total = cur
            else:
                total = 0
                for dt in _dates_in_range():
                    cur = conn.execute(
                        "DELETE FROM schedules WHERE date=? AND status='completed'",
                        (dt.isoformat(),)).rowcount
                    total += cur
            conn.commit()
            return jsonify({"msg": f"已删除 {total} 条已完成的任务"})

        elif action == "clear_all":
            all_dates = d.get("all_dates", False)
            if all_dates:
                completed = conn.execute(
                    "DELETE FROM schedules WHERE status='completed'").rowcount
                conn.execute(
                    "UPDATE tasks SET status='待分配' WHERE id IN ("
                    "SELECT task_id FROM schedules WHERE (status IS NULL OR status!='completed') AND task_id IS NOT NULL"
                    ")")
                cur = conn.execute(
                    "DELETE FROM schedules WHERE (status IS NULL OR status!='completed')").rowcount
                total = cur + completed
            else:
                total = 0
                for dt in _dates_in_range():
                    ds = dt.isoformat()
                    completed = conn.execute(
                        "DELETE FROM schedules WHERE date=? AND status='completed'", (ds,)).rowcount
                    conn.execute(
                        "UPDATE tasks SET status='待分配' WHERE id IN ("
                        "SELECT task_id FROM schedules WHERE date=? AND (status IS NULL OR status!='completed') AND task_id IS NOT NULL"
                        ")", (ds,))
                    cur = conn.execute(
                        "DELETE FROM schedules WHERE date=? AND (status IS NULL OR status!='completed')", (ds,)).rowcount
                    total += cur + completed
            conn.commit()
            return jsonify({"msg": f"已清空 {total} 条任务"})

        elif action == "recycle_pending":
            now = datetime.datetime.now()
            to_recycle = []
            all_dates = d.get("all_dates", False)
            if all_dates:
                schedules_rows = conn.execute(
                    "SELECT id, date, start_min, end_min FROM schedules"
                    " WHERE (status IS NULL OR status!='completed') AND task_id IS NOT NULL"
                ).fetchall()
            else:
                schedules_rows = []
                for dt in _dates_in_range():
                    rows = conn.execute(
                        "SELECT id, date, start_min, end_min FROM schedules WHERE date=? AND (status IS NULL OR status!='completed') AND task_id IS NOT NULL",
                        (dt.isoformat(),)).fetchall()
                    schedules_rows.extend(rows)
            for s in schedules_rows:
                try:
                    s_date = s["date"]
                    s_start = int(s["start_min"])
                    s_end = int(s["end_min"])
                    base_date = datetime.date.fromisoformat(s_date)
                    start_dt = datetime.datetime.combine(base_date, datetime.time(0, 0)) + datetime.timedelta(minutes=s_start)
                    # Handle cross-midnight: if end <= start, the task spans to the next day
                    if s_end <= s_start:
                        end_dt = datetime.datetime.combine(base_date, datetime.time(0, 0)) + datetime.timedelta(days=1, minutes=s_end)
                    else:
                        end_dt = datetime.datetime.combine(base_date, datetime.time(0, 0)) + datetime.timedelta(minutes=s_end)
                except ValueError:
                    continue
                is_active = start_dt <= now < end_dt
                if not is_active:
                    to_recycle.append(int(s["id"]))
            if to_recycle:
                recycle_schedules(conn, schedule_ids=to_recycle)
            conn.commit()
            return jsonify({"msg": f"已回收 {len(to_recycle)} 个待开始的任务"})

        elif action == "recycle_uncompleted":
            all_dates = d.get("all_dates", False)
            if all_dates:
                # 全库回收：不限日期
                count, _ = recycle_schedules(conn, all_dates=True)
            else:
                total = 0
                for dt in _dates_in_range():
                    c, _ = recycle_schedules(conn, date=dt.isoformat())
                    total += c
                count = total
            conn.commit()
            return jsonify({"msg": f"已回收 {count} 个未完成的任务"})

        elif action == "delete_all":
            all_dates = d.get("all_dates", False)
            if all_dates:
                conn.execute(
                    "UPDATE tasks SET status='待分配' WHERE id IN ("
                    "SELECT task_id FROM schedules WHERE task_id IS NOT NULL"
                    ")")
                cur = conn.execute("DELETE FROM schedules").rowcount
                total = cur
            else:
                total = 0
                for dt in _dates_in_range():
                    ds = dt.isoformat()
                    conn.execute(
                        "UPDATE tasks SET status='待分配' WHERE id IN ("
                        "SELECT task_id FROM schedules WHERE date=? AND task_id IS NOT NULL"
                        ")", (ds,))
                    cur = conn.execute("DELETE FROM schedules WHERE date=?", (ds,)).rowcount
                    total += cur
            conn.commit()
            return jsonify({"msg": f"已删除 {total} 条任务"})

        elif action == "confirm_overdue":
            now = datetime.datetime.now()
            machine_rows = conn.execute("SELECT id, status FROM machines").fetchall()
            machine_statuses = {int(m["id"]): m["status"] for m in machine_rows}
            confirmed = 0
            all_dates = d.get("all_dates", False)
            if all_dates:
                schedules_all = conn.execute(
                    "SELECT id, date, machine_id, task_id, start_min, end_min FROM schedules"
                    " WHERE (status IS NULL OR status!='completed') AND task_id IS NOT NULL"
                ).fetchall()
            else:
                schedules_all = []
                for dt in _dates_in_range():
                    rows = conn.execute(
                        "SELECT id, date, machine_id, task_id, start_min, end_min FROM schedules"
                        " WHERE date=? AND (status IS NULL OR status!='completed')",
                        (dt.isoformat(),)
                    ).fetchall()
                    schedules_all.extend(rows)
            for s in schedules_all:
                    tid = s["task_id"]
                    if tid is None:
                        continue
                    try:
                        s_date = s["date"]
                        s_start = int(s["start_min"])
                        s_end = int(s["end_min"])
                        base_date = datetime.date.fromisoformat(s_date)
                        start_dt = datetime.datetime.combine(base_date, datetime.time(0, 0)) + datetime.timedelta(minutes=s_start)
                        # Handle cross-midnight: if end <= start, the task spans to the next day
                        if s_end <= s_start:
                            end_dt = datetime.datetime.combine(base_date, datetime.time(0, 0)) + datetime.timedelta(days=1, minutes=s_end)
                        else:
                            end_dt = datetime.datetime.combine(base_date, datetime.time(0, 0)) + datetime.timedelta(minutes=s_end)
                    except ValueError:
                        continue
                    if end_dt <= now:
                        # Skip tasks on machines currently in repair — may be stalled, not genuinely overdue
                        if machine_statuses.get(int(s["machine_id"])) == "维修停用":
                            continue
                        conn.execute("UPDATE tasks SET status=? WHERE id=?", ("已完成", int(tid)))
                        sch_date_obj = datetime.date.fromisoformat(s_date)
                        actual_end_min = int((now - datetime.datetime.combine(sch_date_obj, datetime.time(0, 0))).total_seconds() / 60)
                        conn.execute(
                            "UPDATE schedules SET status=?, completed_at=?, actual_end_min=? WHERE id=?",
                            ("completed", now.isoformat(timespec="seconds"), actual_end_min, int(s["id"])),
                        )
                        confirmed += 1
            conn.commit()
            return jsonify({"msg": f"已标记完成 {confirmed} 个过时任务"})

        else:
            return jsonify({"msg": f"未知操作: {action}"}), 400

    except Exception as e:
        conn.rollback()
        return jsonify({"msg": f"操作失败: {e}"}), 500
    finally:
        conn.close()


@bp.route('/clear_all')
def clear_all():
    date = parse_date(request.args.get("date"))
    conn = get_db()
    rows = conn.execute("SELECT task_id FROM schedules WHERE date=? AND task_id IS NOT NULL", (date,)).fetchall()
    task_ids = [int(r["task_id"]) for r in rows if r["task_id"] is not None]
    if task_ids:
        conn.executemany("UPDATE tasks SET status=? WHERE id=?", [("待分配", tid) for tid in task_ids])
    conn.execute("DELETE FROM schedules WHERE date=?", (date,))
    conn.commit()
    conn.close()
    return jsonify({"msg":"已清空所有排班"})


@bp.route('/del_schedule/<int:sid>')
def del_schedule(sid):
    conn = get_db()
    conn.execute("DELETE FROM schedules WHERE id=?", (sid,))
    conn.commit()
    conn.close()
    return jsonify({"msg": "删除成功"})


@bp.route('/recall_task/<int:sid>')
def recall_task(sid):
    conn = get_db()
    count, affected = recycle_schedules(conn, schedule_ids=[sid])
    conn.commit()
    task_info = None
    if affected:
        tid = affected[0]
        t = conn.execute("SELECT id, name, type, task_kind, priority, difficulty, est_seconds FROM tasks WHERE id=?", (tid,)).fetchone()
        if t:
            task_info = {"id": t["id"], "name": t["name"], "type": t["type"], "task_kind": t["task_kind"], "priority": t["priority"] or "", "difficulty": t["difficulty"] or "", "est_seconds": t["est_seconds"] or 0}
    conn.close()
    result = {"msg": "回收成功"}
    if task_info:
        result["task"] = task_info
    return jsonify(result)


@bp.route('/machine_schedules')
def machine_schedules():
    date = request.args.get("date", "")
    mid = int(request.args.get("mid", 0))
    if not date or not mid:
        return jsonify({"schedules": []})
    conn = get_db()
    rows = conn.execute(
        "SELECT s.id, s.task_id, s.task_name, s.task_type, s.task_kind,"
        " s.start_min, s.end_min, s.status, s.remark,"
        " t.priority, t.difficulty, t.split_group"
        " FROM schedules s LEFT JOIN tasks t ON s.task_id = t.id"
        " WHERE s.machine_id=? AND s.date=?"
        " ORDER BY s.start_min ASC",
        (mid, date),
    ).fetchall()
    conn.close()
    result = []
    for r in rows:
        result.append({
            "id": r["id"], "task_id": r["task_id"],
            "task_name": r["task_name"], "task_type": r["task_type"],
            "task_kind": r["task_kind"], "start_min": r["start_min"],
            "end_min": r["end_min"], "status": r["status"],
            "remark": r["remark"] or "",
            "priority": r["priority"] or "",
            "difficulty": r["difficulty"] or "",
            "split_group": r["split_group"] or None,
        })
    return jsonify({"schedules": result})


@bp.route('/api/view_schedules')
def api_view_schedules():
    base_date = parse_date(request.args.get("date"))
    date_from = request.args.get("date_from")
    date_to = request.args.get("date_to")

    conn = get_db()
    all_rows = []
    base_dt = datetime.date.fromisoformat(base_date)
    MINS_PER_DAY = 1440
    MAX_TASK_DAYS = 28

    if date_from and date_to:
        from_dt = datetime.date.fromisoformat(date_from)
        start_date = (from_dt - datetime.timedelta(days=MAX_TASK_DAYS)).isoformat()
        end_date = date_to
    else:
        try:
            span_days = int(str(request.args.get("span_days") or "2").strip())
        except ValueError:
            span_days = 2
        span_days = max(1, min(14, span_days))
        start_date = (base_dt - datetime.timedelta(days=MAX_TASK_DAYS)).isoformat()
        end_date = (base_dt + datetime.timedelta(days=span_days - 1)).isoformat()

    rows = conn.execute(
        "SELECT s.id, s.date, s.machine_id, s.machine_name,"
        " s.task_id, s.task_name, s.task_type, s.task_kind,"
        " s.duration, s.remark, s.start_min, s.end_min, s.status,"
        " t.priority, t.difficulty, t.split_group, t.package_id,"
        " COALESCE(pkg.name, '') AS package_name"
        " FROM schedules s LEFT JOIN tasks t ON s.task_id = t.id"
        " LEFT JOIN task_packages pkg ON t.package_id = pkg.id"
        " WHERE s.date >= ? AND s.date <= ?"
        " ORDER BY s.machine_id ASC, s.start_min ASC",
        (start_date, end_date),
    ).fetchall()
    for r in rows:
        item = dict(r)
        start_min = int(item.get("start_min", 0))
        end_min = int(item.get("end_min", start_min + 60))
        item["start_str"] = min_to_hhmm(start_min)
        item["end_str"] = min_to_hhmm(min(MAX_TASK_DAYS * MINS_PER_DAY, end_min))

        sched_dt = datetime.date.fromisoformat(item["date"])
        day_off = (sched_dt - base_dt).days
        abs_start = start_min + day_off * MINS_PER_DAY
        abs_end = end_min + day_off * MINS_PER_DAY
        item["abs_start_min"] = abs_start
        item["abs_end_min"] = abs_end
        item["abs_start_str"] = abs_min_to_label(abs_start)
        item["abs_end_str"] = abs_min_to_label(abs_end)
        item["priority"] = item.get("priority") or ""
        item["difficulty"] = item.get("difficulty") or ""
        item["split_group"] = item.get("split_group") or None
        item["package_id"] = item.get("package_id")
        item["package_name"] = (item.get("package_name") or "")
        all_rows.append(item)
    conn.close()

    machine_ids = list(set(item["machine_id"] for item in all_rows))
    repair_logs = get_repair_logs(machine_ids, base_date)
    return jsonify({"schedules": all_rows, "repair_logs": repair_logs})


# ========== 维修记录编辑 ==========

@bp.route('/api/repair_log/update', methods=['POST'])
def update_repair_log():
    """更新 repair_log 记录的开始/结束时间"""
    d = request.get_json()
    rid = int(d.get("id", 0))
    if not rid:
        return jsonify({"msg": "缺少维修记录ID"}), 400
    conn = get_db()
    rec = conn.execute("SELECT * FROM repair_log WHERE id=?", (rid,)).fetchone()
    if not rec:
        conn.close()
        return jsonify({"msg": "维修记录不存在"}), 404

    updates = []
    params = []
    if "start_datetime" in d and d["start_datetime"]:
        updates.append("start_datetime=?")
        params.append(d["start_datetime"])
    if "end_datetime" in d:
        updates.append("end_datetime=?")
        params.append(d["end_datetime"] if d["end_datetime"] else None)

    if updates:
        params.append(rid)
        conn.execute(f"UPDATE repair_log SET {', '.join(updates)} WHERE id=?", params)
        conn.commit()
    conn.close()
    return jsonify({"msg": "更新成功"})


@bp.route('/api/repair_log/delete', methods=['POST'])
def delete_repair_log():
    """删除 repair_log 记录"""
    d = request.get_json()
    rid = int(d.get("id", 0))
    if not rid:
        return jsonify({"msg": "缺少维修记录ID"}), 400
    conn = get_db()
    conn.execute("DELETE FROM repair_log WHERE id=?", (rid,))
    conn.commit()
    conn.close()
    return jsonify({"msg": "删除成功"})


@bp.route('/api/repair_log/create', methods=['POST'])
def create_repair_log():
    """创建 repair_log 记录（手动补录维修时间段）"""
    d = request.get_json()
    try:
        mid = int(d.get("machine_id", 0))
    except (ValueError, TypeError):
        return jsonify({"msg": "机器ID格式错误"}), 400
    start_dt = (d.get("start_datetime") or "").strip()
    end_dt = d.get("end_datetime")  # 允许 None（进行中）

    if not mid:
        return jsonify({"msg": "缺少机器ID"}), 400
    if not start_dt:
        return jsonify({"msg": "缺少开始时间"}), 400

    conn = get_db()
    now = datetime.datetime.now().isoformat(timespec="seconds")
    cur = conn.execute(
        "INSERT INTO repair_log (machine_id, start_datetime, end_datetime, created_at) VALUES (?,?,?,?)",
        (mid, start_dt, end_dt if end_dt else None, now),
    )
    conn.commit()
    new_id = cur.lastrowid
    conn.close()
    return jsonify({"ok": True, "id": new_id, "msg": "维修记录已创建"})


# ========== 班次设置（从 views.py 迁移）==========

def _parse_shift_minutes(t_str):
    """'HH:MM' -> 绝对分钟数，非法时返回 None"""
    if not t_str:
        return None
    try:
        parts = str(t_str).strip().replace('：', ':').split(":")
        return int(parts[0]) * 60 + int(parts[1])
    except Exception:
        return None


def _validate_shift_input(t, start, end, over, breaks):
    """校验班次输入，返回错误列表（空列表表示通过）"""
    errs = []

    # 中文标点归一化（用户常用中文输入法）
    start = str(start).replace('：', ':').strip() if start else ''
    end = str(end).replace('：', ':').strip() if end else ''
    over = str(over).replace('：', ':').replace('，', ',').replace('、', ',').replace('－', '-') if over else ''
    breaks = str(breaks).replace('：', ':').replace('，', ',').replace('、', ',').replace('。', ',').replace('－', '-') if breaks else ''

    # 1. 上下班格式与存在性
    if not start or not re.match(r'^\d{1,2}:\d{2}$', str(start).strip()):
        errs.append('上班时间格式错误（应为 HH:MM）')
    if not end or not re.match(r'^\d{1,2}:\d{2}$', str(end).strip()):
        errs.append('下班时间格式错误（应为 HH:MM）')

    sm = _parse_shift_minutes(start)
    em = _parse_shift_minutes(end)

    # 2. 非零校验
    if sm is not None and em is not None and sm == em:
        errs.append('上班时间与下班时间不能相同')

    # 3. 下班必须晚于上班（白班必须；夜班跨午夜属正常，不强制）
    if sm is not None and em is not None and em < sm and t == 'day':
        errs.append('白班下班时间（{}）早于上班时间（{}），请检查是否填反了'.format(end, start))

    # 4. 加班格式
    if over:
        bad = False
        for part in re.split(r'[,，]+', str(over)):
            part = part.strip()
            if not part:
                continue
            if not re.match(r'^\d{1,2}:\d{2}\s*-\s*(\d{1,2}:\d{2}|24:00)$', part):
                bad = True
                break
        if bad:
            errs.append('加班格式错误（应为 HH:MM-HH:MM，逗号分隔）')

    # 5. 休息段格式
    if breaks:
        bad = False
        for part in re.split(r'[,，]+', str(breaks)):
            part = part.strip()
            if not part:
                continue
            if not (re.match(r'^\d{1,2}:\d{2}\s*/\s*\d+$', part) or
                    re.match(r'^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$', part)):
                bad = True
                break
        if bad:
            errs.append('休息段格式错误（应为 HH:MM/分钟 或 HH:MM-HH:MM）')

    return errs


def _check_shift_order(conn, t, start):
    """跨班次校验：确保 day_start < night_start。返回错误字符串或 None"""
    sm = _parse_shift_minutes(start)
    if sm is None:
        return None  # 格式错误已在 _validate_shift_input 报告
    if t == 'day':
        row = conn.execute(
            "SELECT start FROM shift_config WHERE key='night_shift'"
        ).fetchone()
        other_start = row['start'] if row else None
        om = _parse_shift_minutes(other_start) if other_start else None
        if om is not None and sm >= om:
            return '白班上班时间（{}）必须早于夜班上班时间（{}）'.format(start, other_start)
    else:
        row = conn.execute(
            "SELECT start FROM shift_config WHERE key='day_shift'"
        ).fetchone()
        other_start = row['start'] if row else None
        om = _parse_shift_minutes(other_start) if other_start else None
        if om is not None and sm <= om:
            return '夜班上班时间（{}）必须晚于白班上班时间（{}）'.format(start, other_start)
    return None


@bp.route('/save_shift', methods=['POST'])
def save_shift():
    d = request.get_json()
    t = d['type']
    start = d['start']
    end = d['end']
    over = d['over']
    breaks = d.get("breaks") or ""

    # ── 校验 ──
    errs = _validate_shift_input(t, start, end, over, breaks)
    if errs:
        return jsonify({"msg": "；".join(errs)}), 400

    conn = get_db()
    order_err = _check_shift_order(conn, t, start)
    if order_err:
        conn.close()
        return jsonify({"msg": order_err}), 400

    key = 'day_shift' if t == 'day' else 'night_shift'
    # 入库前归一化中文标点（验证时已归一化但存的是原始值，这里确保 DB 中永远是 ASCII）
    start = str(start).replace('：', ':').strip()
    end = str(end).replace('：', ':').strip()
    over = str(over).replace('：', ':').replace('，', ',').replace('、', ',').replace('－', '-') if over else ''
    breaks = str(breaks).replace('：', ':').replace('，', ',').replace('、', ',').replace('。', ',').replace('－', '-') if breaks else ''
    conn.execute(
        "INSERT INTO shift_config(key,start,end,overtime,breaks) VALUES (?,?,?,?,?) "
        "ON CONFLICT(key) DO UPDATE SET start=excluded.start,end=excluded.end,overtime=excluded.overtime,breaks=excluded.breaks",
        (key, start, end, over, breaks),
    )
    conn.commit()
    conn.close()
    return jsonify({"msg": "保存成功"})


