import re
import uuid
from datetime import datetime, timedelta
from flask import Blueprint, request, jsonify

from db import get_db
from utils import parse_date, normalize_machine_schedule, num_to_cn, machine_full_name
from models import task_insert_values, TASK_INSERT_FIELDS, TASK_INSERT_PLACEHOLDERS

bp = Blueprint('schedule_cut', __name__)


@bp.route('/cut_task', methods=['POST'])
def cut_task():
    d = request.get_json()
    sid = int(d.get("schedule_id", 0))
    ratio = max(0.05, min(0.95, float(d.get("ratio", 0.5))))
    items_done = d.get("items_done")

    conn = get_db()
    sch = conn.execute("SELECT * FROM schedules WHERE id=?", (sid,)).fetchone()
    if not sch:
        conn.close()
        return jsonify({"error": "排班记录不存在"})
    if sch["status"] == "completed":
        conn.close()
        return jsonify({"error": "已完成的任务不能切割"})

    task = conn.execute("SELECT * FROM tasks WHERE id=?", (sch["task_id"],)).fetchone()
    if not task:
        conn.close()
        return jsonify({"error": "关联任务不存在"})

    machine = conn.execute("SELECT * FROM machines WHERE id=?", (sch["machine_id"],)).fetchone()
    machine_name_full = machine_full_name(machine['name'], machine['type'], machine['task_kind']) if machine else sch["machine_name"]

    exp_count = task["expected_count"]
    if items_done is not None and exp_count and int(exp_count) > 0:
        ratio = max(0.05, min(0.95, int(items_done or 0) / int(exp_count)))

    total_dur = int(sch["end_min"]) - int(sch["start_min"])
    seg1_dur = max(1, round(total_dur * ratio))
    seg2_dur = max(1, total_dur - seg1_dur)
    seg1_start = int(sch["start_min"])
    seg1_end = seg1_start + seg1_dur
    seg2_start = seg1_end
    seg2_end = seg2_start + seg2_dur

    seg1_exp = None
    seg2_exp = None
    if exp_count and int(exp_count) > 0:
        if items_done is not None:
            seg1_exp = int(items_done)
            seg2_exp = max(0, int(exp_count) - int(items_done))
        else:
            seg1_exp = max(1, round(int(exp_count) * ratio))
            seg2_exp = max(0, int(exp_count) - seg1_exp)

    seg1_est = None
    seg2_est = None
    if task["est_seconds"] and int(task["est_seconds"]) > 0:
        seg1_est = max(1, round(int(task["est_seconds"]) * ratio))
        seg2_est = max(1, int(task["est_seconds"]) - seg1_est)

    base_name = re.sub(r'（第[一二三四五六七八九十]+段）$', '', task["name"])
    split_group = task["split_group"] if task["split_group"] else str(uuid.uuid4())

    orig_order = int(task["split_order"]) if task["split_group"] else 1

    try:
        conn.execute("BEGIN")

        seg1_name = base_name + "（第" + num_to_cn(orig_order) + "段）"
        cur = conn.execute(
            """INSERT INTO tasks(name, type, task_kind, priority, difficulty, duration,
               est_mode, op_min, reset_min, collect_count, redundancy_min,
               est_minutes, est_seconds, remark, status, rbp_task_id, scene,
               general_category, source_link, expected_count,
               collection_req_id, collection_req_type,
               split_group, split_order, split_total_items)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                seg1_name, task["type"], task["task_kind"],
                task["priority"], task["difficulty"], "",
                task["est_mode"], task["op_min"], task["reset_min"],
                task["collect_count"], task["redundancy_min"],
                task["est_minutes"], seg1_est,
                (task["remark"] or ""), "已分配",
                (task["rbp_task_id"] or ""), (task["scene"] or ""),
                (task["general_category"] or ""), (task["source_link"] or ""),
                seg1_exp,
                (task["collection_req_id"] or ""), (task["collection_req_type"] or ""),
                split_group, orig_order, exp_count,
            ),
        )
        seg1_tid = cur.lastrowid

        cur_s1 = conn.execute(
            "INSERT INTO schedules(date, machine_id, machine_name, task_id, task_name,"
            " task_type, task_kind, duration, remark, start_min, end_min, status, created_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now','localtime'))",
            (
                sch["date"], sch["machine_id"], machine_name_full,
                seg1_tid, seg1_name,
                task["type"], task["task_kind"], "",
                (task["remark"] or ""),
                seg1_start, seg1_end, "executing",
            ),
        )
        seg1_sid = cur_s1.lastrowid

        seg2_name = base_name + "（第" + num_to_cn(orig_order + 1) + "段）"
        seg2_status = "待分配"
        cur.execute(
            """INSERT INTO tasks(name, type, task_kind, priority, difficulty, duration,
               est_mode, op_min, reset_min, collect_count, redundancy_min,
               est_minutes, est_seconds, remark, status, rbp_task_id, scene,
               general_category, source_link, expected_count,
               collection_req_id, collection_req_type,
               split_group, split_order, split_total_items)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                seg2_name, task["type"], task["task_kind"],
                task["priority"], task["difficulty"], "",
                task["est_mode"], task["op_min"], task["reset_min"],
                task["collect_count"], task["redundancy_min"],
                task["est_minutes"], seg2_est,
                (task["remark"] or ""), seg2_status,
                (task["rbp_task_id"] or ""), (task["scene"] or ""),
                (task["general_category"] or ""), (task["source_link"] or ""),
                seg2_exp,
                (task["collection_req_id"] or ""), (task["collection_req_type"] or ""),
                split_group, orig_order + 1, exp_count,
            ),
        )
        seg2_tid = cur.lastrowid

        seg2_sid = None
        placement_row = conn.execute(
            "SELECT value FROM config WHERE category='schedule_settings' AND key='split_placement'"
        ).fetchone()
        placement = placement_row["value"] if placement_row else "inline"

        if placement == "inline":
            seg2_status = "已分配"
            conn.execute("UPDATE tasks SET status=? WHERE id=?", (seg2_status, seg2_tid))
            cur_s2 = conn.execute(
                "INSERT INTO schedules(date, machine_id, machine_name, task_id, task_name,"
                " task_type, task_kind, duration, remark, start_min, end_min, status, created_at)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now','localtime'))",
                (
                    sch["date"], sch["machine_id"], machine_name_full,
                    seg2_tid, seg2_name,
                    task["type"], task["task_kind"], "",
                    (task["remark"] or ""),
                    seg2_start, seg2_end, "executing",
                ),
            )
            seg2_sid = cur_s2.lastrowid

        conn.execute("DELETE FROM schedules WHERE id=?", (sid,))

        if placement == "inline":
            normalize_machine_schedule(conn, sch["date"], int(sch["machine_id"]))

        conn.execute("DELETE FROM tasks WHERE id=?", (task["id"],))

        # 整体重编号：去除重复order，1-based连续编号
        conn.execute(
            "UPDATE tasks SET split_order = split_order + 1"
            " WHERE split_group=? AND split_order > ? AND id NOT IN (?, ?)",
            (split_group, orig_order, seg1_tid, seg2_tid),
        )
        all_segs = conn.execute(
            "SELECT id FROM tasks WHERE split_group=? ORDER BY split_order ASC",
            (split_group,),
        ).fetchall()
        for i, row in enumerate(all_segs, 1):
            new_name = base_name + "（第" + num_to_cn(i) + "段）"
            conn.execute(
                "UPDATE tasks SET split_order=?, name=? WHERE id=?",
                (i, new_name, row["id"]),
            )
            conn.execute(
                "UPDATE schedules SET task_name=? WHERE task_id=?",
                (new_name, row["id"]),
            )

        conn.commit()
        seg_names = []
        for row in conn.execute(
            "SELECT name FROM tasks WHERE id IN (?, ?) ORDER BY split_order ASC",
            (seg1_tid, seg2_tid),
        ).fetchall():
            seg_names.append("「" + row["name"] + "」")
        result = {
            "msg": "切割完成：已创建 " + " ".join(seg_names),
            "split_group": split_group,
            "created": [
                {"task_id": seg1_tid, "schedule_id": seg1_sid},
                {"task_id": seg2_tid, "schedule_id": seg2_sid},
            ],
        }
    except Exception as e:
        conn.rollback()
        result = {"error": f"切割失败: {e}"}
    finally:
        conn.close()
    return jsonify(result)


@bp.route('/undo_cut', methods=['POST'])
def undo_cut():
    d = request.get_json()
    split_group = d.get("split_group")
    original = d.get("original")
    created = d.get("created") or []

    if not split_group or not original:
        return jsonify({"error": "参数不足"})

    conn = get_db()
    try:
        conn.execute("BEGIN")

        for item in created:
            if item.get("schedule_id"):
                conn.execute("DELETE FROM schedules WHERE id=?", (int(item["schedule_id"]),))
            if item.get("task_id"):
                conn.execute("DELETE FROM tasks WHERE id=?", (int(item["task_id"]),))

        ot = original.get("task", {})
        if not ot.get("task_kind"):
            ot["task_kind"] = "常规"
        cur = conn.execute(
            f"INSERT INTO tasks({TASK_INSERT_FIELDS}) VALUES ({TASK_INSERT_PLACEHOLDERS})",
            task_insert_values(ot, "已分配"),
        )
        new_tid = cur.lastrowid

        os_ = original.get("schedule", {})
        conn.execute(
            "INSERT INTO schedules(date, machine_id, machine_name, task_id, task_name,"
            " task_type, task_kind, duration, remark, start_min, end_min, status, created_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now','localtime'))",
            (
                os_.get("date"), os_.get("machine_id"), os_.get("machine_name"),
                new_tid, os_.get("task_name"),
                os_.get("task_type"), os_.get("task_kind", "常规"),
                os_.get("duration", ""), os_.get("remark", ""),
                os_.get("start_min"), os_.get("end_min"), "executing",
            ),
        )

        conn.commit()
        result = {"msg": "切割已撤销"}
    except Exception as e:
        conn.rollback()
        result = {"error": f"撤销失败: {e}"}
    finally:
        conn.close()
    return jsonify(result)


# ========== 显示模式切换 ==========

def _get_shift_boundaries(conn):
    """读取班次边界，返回 {day_start, day_end, night_start, night_end}（分钟）。"""
    rows = conn.execute("SELECT key,start,end FROM shift_config").fetchall()
    cfg = {r["key"]: (r["start"], r["end"]) for r in rows}
    day_s = cfg.get("day_shift", ("09:00", "18:30"))
    night_s = cfg.get("night_shift", ("21:00", "06:30"))

    def _to_min(s):
        m = re.match(r"^(\d{1,2}):(\d{2})$", str(s).strip())
        return int(m.group(1)) * 60 + int(m.group(2)) if m else 0

    return {
        "day_start": _to_min(day_s[0]) or 540,
        "day_end": _to_min(day_s[1]) or 1110,
        "night_start": _to_min(night_s[0]) or 1260,
        "night_end": _to_min(night_s[1]) or 390,
    }


def _classify_shift(min_of_day, b):
    """判断一天中的某分钟落在哪个班次。返回 'day' / 'night' / 'gap'。"""
    if b["day_start"] <= min_of_day < b["day_end"]:
        return "day"
    if min_of_day >= b["night_start"] or min_of_day < b["night_end"]:
        return "night"
    return "gap"


def _resolve_segment_track(start_min, end_min, b):
    """确定从 start_min 开始的段属于哪个轨道（'day' 或 'night'）。"""
    s = _classify_shift(start_min % 1440, b)
    if s != "gap":
        return s
    t = start_min
    while t < end_min and _classify_shift(t % 1440, b) == "gap":
        t += 1
    if t < end_min:
        return _classify_shift(t % 1440, b)
    t = start_min - 1
    while t >= 0 and _classify_shift(t % 1440, b) == "gap":
        t -= 1
    if t >= 0:
        return _classify_shift(t % 1440, b)
    return "day"


def _cut_points_in_range(start_min, end_min, b):
    """返回 (start_min, end_min) 内所有切点（已排序），不含起止点本身。"""
    points = []
    day_end = b["day_end"]
    night_end_cross = 1440 + b["night_end"]

    t = day_end
    while t < end_min:
        if t > start_min:
            points.append(t)
        t += 1440

    t = night_end_cross
    while t < end_min:
        if t > start_min:
            points.append(t)
        t += 1440

    points.sort()
    return points


def _cut_schedule_at_boundaries(conn, sch, b, split_group):
    """在班次边界处切割一条排班。返回 created 列表。"""
    import uuid as _uuid

    s_min = int(sch["start_min"])
    e_min = int(sch["end_min"])
    points = _cut_points_in_range(s_min, e_min, b)
    if not points:
        return []

    task = conn.execute("SELECT * FROM tasks WHERE id=?", (sch["task_id"],)).fetchone()
    if not task:
        return []

    machine = conn.execute("SELECT * FROM machines WHERE id=?", (sch["machine_id"],)).fetchone()
    mname = machine_full_name(machine["name"], machine["type"], machine["task_kind"]) if machine else sch["machine_name"]

    base_name = re.sub(r"（第[一二三四五六七八九十]+段）$", "", task["name"])
    group = split_group or str(_uuid.uuid4())

    def _do_cut(seg_start, seg_end, order, total):
        seg_name = base_name + "（第" + num_to_cn(order) + "段）"
        seg_status = "已分配"

        cur = conn.execute(
            f"INSERT INTO tasks({TASK_INSERT_FIELDS}) VALUES ({TASK_INSERT_PLACEHOLDERS})",
            task_insert_values({
                "name": seg_name, "type": task["type"], "task_kind": task["task_kind"] or "常规",
                "priority": task["priority"], "difficulty": task["difficulty"],
                "duration": "", "est_mode": task["est_mode"], "op_min": task["op_min"],
                "reset_min": task["reset_min"], "collect_count": task["collect_count"],
                "redundancy_min": task["redundancy_min"],
                "est_minutes": task["est_minutes"], "est_seconds": None,
                "remark": task["remark"] or "",
                "rbp_task_id": task["rbp_task_id"] or "", "scene": task["scene"] or "",
                "general_category": task["general_category"] or "",
                "source_link": task["source_link"] or "",
                "expected_count": task["expected_count"],
                "collection_req_id": task["collection_req_id"] or "",
                "collection_req_type": task["collection_req_type"] or "",
            }, seg_status),
        )
        seg_tid = cur.lastrowid

        conn.execute(
            "UPDATE tasks SET split_group=?, split_order=?, split_total_items=? WHERE id=?",
            (group, order, total, seg_tid),
        )

        cur_s = conn.execute(
            "INSERT INTO schedules(date, machine_id, machine_name, task_id, task_name,"
            " task_type, task_kind, duration, remark, start_min, end_min, status, created_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now','localtime'))",
            (
                sch["date"], sch["machine_id"], mname, seg_tid, seg_name,
                task["type"], task["task_kind"] or "常规", "",
                task["remark"] or "", seg_start, seg_end, "executing",
            ),
        )
        seg_sid = cur_s.lastrowid
        return {"task_id": seg_tid, "schedule_id": seg_sid}

    segments = [s_min] + points + [e_min]
    total = len(segments) - 1
    created = []
    for i in range(total):
        seg_s = segments[i]
        seg_e = segments[i + 1]
        if seg_e <= seg_s:
            continue
        item = _do_cut(seg_s, seg_e, i + 1, total)
        if item:
            created.append(item)

    return created


def _expect_count_for_segment(expected_count, seg_dur, total_dur):
    """按比例分配预期数量。"""
    if expected_count is None or not expected_count:
        return None
    ec = int(expected_count)
    if ec <= 0 or total_dur <= 0:
        return None
    return max(0, round(ec * seg_dur / total_dur))


@bp.route('/switch_display_mode', methods=['POST'])
def switch_display_mode():
    """切换显示模式：continuous ↔ split"""
    d = request.get_json() or {}
    target = d.get("mode")

    if target not in ("split", "continuous"):
        return jsonify({"error": "mode 参数必须为 split 或 continuous"})

    conn = get_db()
    b = _get_shift_boundaries(conn)
    affected = 0

    if target == "split":
        schedules = conn.execute(
            "SELECT * FROM schedules WHERE status != 'completed' AND end_min > start_min"
        ).fetchall()

        try:
            conn.execute("BEGIN")
            for sch in schedules:
                points = _cut_points_in_range(int(sch["start_min"]), int(sch["end_min"]), b)
                if not points:
                    continue
                group = str(uuid.uuid4())
                created = _cut_schedule_at_boundaries(conn, sch, b, group)
                if created:
                    affected += 1
                    conn.execute("DELETE FROM schedules WHERE id=?", (sch["id"],))
                    conn.execute("DELETE FROM tasks WHERE id=?", (sch["task_id"],))
            conn.commit()
        except Exception as e:
            conn.rollback()
            conn.close()
            return jsonify({"error": f"切换失败: {e}"})

    else:
        groups = conn.execute(
            "SELECT DISTINCT split_group FROM tasks WHERE split_group IS NOT NULL AND split_group != ''"
        ).fetchall()

        try:
            conn.execute("BEGIN")
            for (grp,) in groups:
                segs = conn.execute(
                    """SELECT t.id AS tid, t.name, t.status, t.expected_count,
                       s.id AS sid, s.machine_id, s.date, s.start_min, s.end_min,
                       s.status AS s_status, t.split_order
                       FROM tasks t LEFT JOIN schedules s ON s.task_id = t.id
                       WHERE t.split_group = ? ORDER BY t.split_order ASC""",
                    (grp,),
                ).fetchall()

                if len(segs) < 2:
                    continue

                # 只处理已分配且有 schedule 的段
                assigned = [s for s in segs if s["sid"] is not None and s["machine_id"] is not None]
                if len(assigned) < 2:
                    continue

                mids = set(int(s["machine_id"]) for s in assigned)
                can_merge = len(mids) == 1

                if can_merge:
                    mid = mids.pop()
                    seg_ranges = sorted(
                        [(int(s["start_min"]), int(s["end_min"])) for s in assigned],
                        key=lambda x: x[0],
                    )
                    for i in range(len(seg_ranges) - 1):
                        gap_end = seg_ranges[i + 1][0]
                        gap_start = seg_ranges[i][1]
                        if gap_end <= gap_start:
                            continue
                        intruder = conn.execute(
                            "SELECT COUNT(*) AS c FROM schedules"
                            " WHERE machine_id=? AND status != 'completed'"
                            " AND start_min < ? AND end_min > ?"
                            " AND id NOT IN (" + ",".join(str(s["sid"]) for s in assigned) + ")",
                            (mid, gap_end, gap_start),
                        ).fetchone()
                        if intruder and intruder["c"] > 0:
                            can_merge = False
                            break

                if can_merge:
                    first = assigned[0]
                    last = assigned[-1]
                    merged_start = min(int(s["start_min"]) for s in assigned)
                    merged_end = max(int(s["end_min"]) for s in assigned)
                    merged_date = first["date"]

                    base_name = re.sub(r"（第[一二三四五六七八九十]+段）$", "", first["name"])
                    tinfo = conn.execute("SELECT * FROM tasks WHERE id=?", (first["tid"],)).fetchone()

                    total_exp = sum(
                        int(s["expected_count"] or 0) for s in assigned if s["expected_count"]
                    ) or None

                    cur = conn.execute(
                        f"INSERT INTO tasks({TASK_INSERT_FIELDS}) VALUES ({TASK_INSERT_PLACEHOLDERS})",
                        task_insert_values({
                            "name": base_name, "type": tinfo["type"],
                            "task_kind": tinfo["task_kind"] or "常规",
                            "priority": tinfo["priority"], "difficulty": tinfo["difficulty"],
                            "duration": "", "est_mode": tinfo["est_mode"],
                            "op_min": tinfo["op_min"], "reset_min": tinfo["reset_min"],
                            "collect_count": tinfo["collect_count"],
                            "redundancy_min": tinfo["redundancy_min"],
                            "est_minutes": tinfo["est_minutes"], "est_seconds": None,
                            "remark": tinfo["remark"] or "",
                            "rbp_task_id": tinfo["rbp_task_id"] or "",
                            "scene": tinfo["scene"] or "",
                            "general_category": tinfo["general_category"] or "",
                            "source_link": tinfo["source_link"] or "",
                            "expected_count": total_exp,
                            "collection_req_id": tinfo["collection_req_id"] or "",
                            "collection_req_type": tinfo["collection_req_type"] or "",
                        }, "已分配"),
                    )
                    new_tid = cur.lastrowid

                    mrow = conn.execute("SELECT * FROM machines WHERE id=?", (first["machine_id"],)).fetchone()
                    mname = machine_full_name(mrow["name"], mrow["type"], mrow["task_kind"]) if mrow else ""

                    conn.execute(
                        "INSERT INTO schedules(date, machine_id, machine_name, task_id, task_name,"
                        " task_type, task_kind, duration, remark, start_min, end_min, status, created_at)"
                        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now','localtime'))",
                        (
                            merged_date, first["machine_id"], mname or "",
                            new_tid, base_name, tinfo["type"],
                            tinfo["task_kind"] or "常规", "",
                            tinfo["remark"] or "",
                            merged_start, merged_end, "executing",
                        ),
                    )

                    for s in assigned:
                        conn.execute("DELETE FROM schedules WHERE id=?", (s["sid"],))
                    for s in segs:
                        conn.execute("DELETE FROM tasks WHERE id=?", (s["tid"],))
                    affected += 1

                else:
                    for s in segs:
                        conn.execute(
                            "UPDATE tasks SET split_group='', split_order=0, split_total_items=0 WHERE id=?",
                            (s["tid"],),
                        )
                        base_name = re.sub(r"（第[一二三四五六七八九十]+段）$", "", s["name"])
                        conn.execute("UPDATE tasks SET name=? WHERE id=?", (base_name, s["tid"]))
                        conn.execute(
                            "UPDATE schedules SET task_name=? WHERE task_id=?",
                            (base_name, s["tid"]),
                        )

            conn.commit()
        except Exception as e:
            conn.rollback()
            conn.close()
            return jsonify({"error": f"切换失败: {e}"})

    conn.close()
    return jsonify({"ok": True, "affected": affected})


# ========== 分班模式：拉伸跨窗口自动切段 ==========

def _window_days_for_range(abs_start, abs_end, b, track_type):
    """返回 [abs_start, abs_end) 覆盖的所有窗口的 day index 列表。"""
    if track_type == "day":
        ws = b["day_start"]
        dw_end = b.get("day_dw_end", b["day_end"])
        if dw_end <= ws:
            dw_end += 1440
    else:
        ws = b["night_start"]
        dw_end = b.get("night_dw_end", b["night_end"] + 1440 if b["night_end"] <= ws else b["night_end"])

    d_first = (abs_start - ws) // 1440
    d_last = (abs_end - 1 - ws) // 1440

    days = []
    for d in range(d_first, d_last + 1):
        w_abs_start = d * 1440 + ws
        w_abs_end = d * 1440 + dw_end
        seg_start = max(abs_start, w_abs_start)
        seg_end = min(abs_end, w_abs_end)
        if seg_end > seg_start:
            days.append({
                "day_index": d,
                "seg_start": seg_start,
                "seg_end": seg_end,
            })
    return days


def _abs_to_date_min(abs_min, base_date_str):
    """绝对分钟 → {date, min}，相对于 base_date。"""
    base_dt = datetime.strptime(base_date_str, "%Y-%m-%d")
    day_off = abs_min // 1440
    minute = abs_min % 1440
    dt = base_dt + timedelta(days=day_off)
    return {"date": dt.strftime("%Y-%m-%d"), "min": minute}


@bp.route('/stretch_across_windows', methods=['POST'])
def stretch_across_windows():
    """
    分班模式拉伸跨窗口：同一 task，多 schedule。
    Body: {schedule_id, new_abs_start, new_abs_end, base_date, track_type, day_dw_end?, night_dw_end?}
    """
    import uuid as _uuid

    d = request.get_json() or {}
    sid = int(d.get("schedule_id", 0))
    new_abs_start = int(d.get("new_abs_start", 0))
    new_abs_end = int(d.get("new_abs_end", 0))
    base_date = d.get("base_date", "")
    track_type = d.get("track_type", "day")

    if not sid or not base_date:
        return jsonify({"error": "缺少必要参数"})

    conn = get_db()
    sch = conn.execute("SELECT * FROM schedules WHERE id=?", (sid,)).fetchone()
    if not sch:
        conn.close()
        return jsonify({"error": "排班记录不存在"})

    task = conn.execute("SELECT * FROM tasks WHERE id=?", (sch["task_id"],)).fetchone()
    if not task:
        conn.close()
        return jsonify({"error": "关联任务不存在"})

    machine = conn.execute("SELECT * FROM machines WHERE id=?", (sch["machine_id"],)).fetchone()
    mname = machine_full_name(machine["name"], machine["type"], machine["task_kind"]) if machine else sch["machine_name"]

    b = _get_shift_boundaries(conn)
    if d.get("day_dw_end"):
        b["day_dw_end"] = int(d["day_dw_end"])
    if d.get("night_dw_end"):
        b["night_dw_end"] = int(d["night_dw_end"])
    windows = _window_days_for_range(new_abs_start, new_abs_end, b, track_type)

    if not windows:
        conn.close()
        return jsonify({"error": "时间范围不覆盖任何班次窗口"})

    tid = sch["task_id"]
    task_name = task["name"]
    task_type = task["type"]
    task_kind = task["task_kind"] or "常规"
    group = task["split_group"] if task["split_group"] else str(_uuid.uuid4())

    try:
        conn.execute("BEGIN")

        # 1) 清理该 task 的所有已有 schedule（不再需要的旧段）
        conn.execute("DELETE FROM schedules WHERE task_id=?", (tid,))

        # 2) 每个窗口创建一条 schedule，全部指向同一个 task_id
        created = []
        for w in windows:
            sd = _abs_to_date_min(w["seg_start"], base_date)
            ed = _abs_to_date_min(w["seg_end"], base_date)
            seg_start_min = sd["min"]
            seg_end_min = ed["min"]
            seg_date = sd["date"]

            if ed["date"] != sd["date"]:
                day_diff = (datetime.strptime(ed["date"], "%Y-%m-%d") -
                            datetime.strptime(sd["date"], "%Y-%m-%d")).days
                seg_end_min = ed["min"] + day_diff * 1440

            cur_s = conn.execute(
                "INSERT INTO schedules(date, machine_id, machine_name, task_id, task_name,"
                " task_type, task_kind, duration, remark, start_min, end_min, status, created_at)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now','localtime'))",
                (
                    seg_date, sch["machine_id"], mname, tid, task_name,
                    task_type, task_kind, "",
                    task["remark"] or "", seg_start_min, seg_end_min, "executing",
                ),
            )
            created.append({
                "schedule_id": cur_s.lastrowid,
                "task_id": tid,
                "start_min": seg_start_min,
                "end_min": seg_end_min,
                "date": seg_date,
            })

        # 3) 标记 task 为跨班任务
        conn.execute(
            "UPDATE tasks SET split_group=? WHERE id=?",
            (group, tid),
        )

        conn.commit()
        conn.close()
        return jsonify({
            "ok": True,
            "split_group": group,
            "total": len(windows),
            "task_id": tid,
            "task_name": task_name,
            "segments": created,
        })
    except Exception as e:
        conn.rollback()
        conn.close()
        return jsonify({"error": f"拉伸切段失败: {e}"})


# ========== 分班模式：整组联动移动 ==========

@bp.route('/move_split_group', methods=['POST'])
def move_split_group():
    """
    分班模式整组联动：移动同 task 的所有 schedule。
    Body: {task_id, delta_abs, base_date}
    """
    d = request.get_json() or {}
    tid = int(d.get("task_id", 0))
    delta_abs = int(d.get("delta_abs", 0))
    base_date = d.get("base_date", "")

    if not tid or not base_date:
        return jsonify({"error": "缺少必要参数"})

    conn = get_db()

    # 查找该 task 的所有 schedule
    segs = conn.execute(
        "SELECT id, date, start_min FROM schedules WHERE task_id=?",
        (tid,),
    ).fetchall()

    if len(segs) < 2:
        conn.close()
        return jsonify({"ok": True, "no_group": True})

    updated = []
    try:
        conn.execute("BEGIN")
        for seg in segs:
            old_date = seg["date"]
            sdt = datetime.strptime(old_date, "%Y-%m-%d")
            bdt = datetime.strptime(base_date, "%Y-%m-%d")
            day_off = (sdt - bdt).days
            old_abs = day_off * 1440 + int(seg["start_min"])

            new_abs = old_abs + delta_abs
            nd = _abs_to_date_min(new_abs, base_date)
            new_start = nd["min"]

            conn.execute(
                "UPDATE schedules SET date=?, start_min=? WHERE id=?",
                (nd["date"], new_start, seg["id"]),
            )
            updated.append({
                "schedule_id": seg["id"],
                "new_date": nd["date"],
                "new_start_min": new_start,
            })

        conn.commit()
        conn.close()
        return jsonify({
            "ok": True,
            "updated": updated,
        })
    except Exception as e:
        conn.rollback()
        conn.close()
        return jsonify({"error": f"整组移动失败: {e}"})
