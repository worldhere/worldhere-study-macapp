# -*- coding: utf-8 -*-
"""业务逻辑：任务回收、切割段处理、任务字段抽取"""
import re as _re
from utils import num_to_cn as _num_to_cn

# ========== 任务字段统一抽取 ==========

TASK_INSERT_FIELDS = (
    "name, type, task_kind, priority, difficulty, duration, "
    "est_mode, op_min, reset_min, collect_count, redundancy_min, "
    "est_minutes, est_seconds, remark, status, "
    "rbp_task_id, scene, general_category, source_link, expected_count, "
    "collection_req_id, collection_req_type"
)

TASK_INSERT_PLACEHOLDERS = "?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?"


def task_insert_values(src, status):
    """从 dict-like 源提取任务 INSERT 参数元组。src 可以是 request JSON dict 或 DB Row。"""
    return (
        src.get("name"), src.get("type"),
        src.get("task_kind", "常规"),
        src.get("priority"), src.get("difficulty"),
        src.get("duration"),
        src.get("est_mode", "blank"),
        src.get("op_min"), src.get("reset_min"),
        src.get("collect_count"), src.get("redundancy_min"),
        src.get("est_minutes"), src.get("est_seconds"),
        src.get("remark", ""), status,
        src.get("rbp_task_id", ""), src.get("scene", ""),
        src.get("general_category", ""), src.get("source_link", ""),
        src.get("expected_count"),
        src.get("collection_req_id", ""), src.get("collection_req_type", ""),
    )


def recycle_schedules(conn, schedule_ids=None, task_ids=None, machine_id=None, date=None, all_dates=False):
    """统一回收：删除排班 + 任务状态改为待分配。返回 (count, affected_task_ids)。"""
    affected = []

    if all_dates:
        rows = conn.execute(
            "SELECT id, task_id FROM schedules WHERE status IS NULL OR status!='completed'"
        ).fetchall()
        sids = [r["id"] for r in rows]
        affected = [int(r["task_id"]) for r in rows if r["task_id"] is not None]
        if sids:
            placeholders = ",".join("?" * len(sids))
            conn.execute(f"DELETE FROM schedules WHERE id IN ({placeholders})", sids)

    elif schedule_ids:
        placeholders = ",".join("?" * len(schedule_ids))
        rows = conn.execute(
            f"SELECT id, task_id FROM schedules WHERE id IN ({placeholders})",
            [int(x) for x in schedule_ids],
        ).fetchall()
        sids = [r["id"] for r in rows]
        affected = [int(r["task_id"]) for r in rows if r["task_id"] is not None]
        if sids:
            sid_placeholders = ",".join("?" * len(sids))
            conn.execute(f"DELETE FROM schedules WHERE id IN ({sid_placeholders})", sids)

    elif task_ids:
        placeholders = ",".join("?" * len(task_ids))
        ids = [int(x) for x in task_ids]
        rows = conn.execute(
            f"SELECT task_id FROM schedules WHERE task_id IN ({placeholders})",
            ids,
        ).fetchall()
        conn.execute(f"DELETE FROM schedules WHERE task_id IN ({placeholders})", ids)
        affected = list(set(int(r["task_id"]) for r in rows if r["task_id"] is not None))

    elif date:
        query = "SELECT id, task_id FROM schedules WHERE date=? AND (status IS NULL OR status!='completed')"
        params = [date]
        if machine_id is not None:
            query += " AND machine_id=?"
            params.append(int(machine_id))
        rows = conn.execute(query, params).fetchall()
        sids = [r["id"] for r in rows]
        affected = [int(r["task_id"]) for r in rows if r["task_id"] is not None]
        if sids:
            placeholders = ",".join("?" * len(sids))
            conn.execute(f"DELETE FROM schedules WHERE id IN ({placeholders})", sids)

    else:
        return 0, []

    if affected:
        conn.executemany(
            "UPDATE tasks SET status='待分配' WHERE id=? AND status!='已完成'",
            [(tid,) for tid in affected],
        )

    return len(affected), affected


def recycle_split_segment(conn, task_row):
    """处理切割段删除：条数回收 → 剩余段重编号 → 单段后缀清理。
    返回 (recovered_to, exp_val)。调用方负责 DELETE task 本身。
    """
    group = task_row["split_group"]
    order = int(task_row["split_order"])
    exp = task_row["expected_count"]
    exp_val = int(exp) if exp and int(exp) > 0 else 0
    recovered_to = None

    # 条数回收：优先下一段，其次前一段（未完成）
    next_task = conn.execute(
        "SELECT id, name, status, expected_count FROM tasks"
        " WHERE split_group=? AND split_order>? ORDER BY split_order ASC LIMIT 1",
        (group, order),
    ).fetchone()
    prev_task = conn.execute(
        "SELECT id, name, status, expected_count FROM tasks"
        " WHERE split_group=? AND split_order<? ORDER BY split_order DESC LIMIT 1",
        (group, order),
    ).fetchone()

    if next_task:
        new_exp = (int(next_task["expected_count"]) if next_task["expected_count"] else 0) + exp_val
        conn.execute("UPDATE tasks SET expected_count=? WHERE id=?", (new_exp, next_task["id"]))
        recovered_to = next_task["name"]
    elif prev_task and prev_task["status"] != "已完成":
        new_exp = (int(prev_task["expected_count"]) if prev_task["expected_count"] else 0) + exp_val
        conn.execute("UPDATE tasks SET expected_count=? WHERE id=?", (new_exp, prev_task["id"]))
        recovered_to = prev_task["name"]

    # 对剩余段重新编号
    higher = conn.execute(
        "SELECT id, name, split_order FROM tasks WHERE split_group=? AND split_order>? ORDER BY split_order ASC",
        (group, order),
    ).fetchall()
    for t in higher:
        new_order = int(t["split_order"]) - 1
        new_name = _re.sub(r'（第[一二三四五六七八九十]+段）$', '', t["name"]) + '（第' + _num_to_cn(new_order) + '段）'
        conn.execute("UPDATE tasks SET split_order=?, name=? WHERE id=?", (new_order, new_name, int(t["id"])))
        conn.execute("UPDATE schedules SET task_name=? WHERE task_id=?", (new_name, int(t["id"])))

    # 仅剩一段时去掉后缀
    remaining = conn.execute(
        "SELECT COUNT(*) AS c, MIN(id) AS sole_id FROM tasks WHERE split_group=?", (group,)
    ).fetchone()
    if remaining and remaining["c"] == 1:
        sole = conn.execute("SELECT id, name FROM tasks WHERE id=?", (remaining["sole_id"],)).fetchone()
        if sole:
            clean_name = _re.sub(r'（第[一二三四五六七八九十]+段）$', '', sole["name"])
            conn.execute("UPDATE tasks SET name=? WHERE id=?", (clean_name, sole["id"]))
            conn.execute("UPDATE schedules SET task_name=? WHERE task_id=?", (clean_name, sole["id"]))

    return recovered_to, exp_val
