# -*- coding: utf-8 -*-
"""数据查询层：机器、任务、排班、维修日志的 SQL 查询"""
import datetime
import re
from typing import Optional, List, Dict
from db import get_db, get_config
from utils import abs_min_to_label, parse_time_range_list, parse_break_list, \
    datetime_to_abs_min, format_elapsed, format_datetime_label, overlap_minutes, \
    calc_working_minutes
from db import get_allowed_task_kinds, get_allowed_machine_types, \
    get_allowed_machine_statuses, get_allowed_machine_groups


def list_machines(sort_by: str = "name", sort_dir: str = "asc",
                  filter_type: Optional[str] = None,
                  filter_status: Optional[str] = None,
                  filter_kind: Optional[str] = None,
                  filter_group: Optional[str] = None) -> List[Dict]:
    conn = get_db()
    rows = conn.execute("SELECT id,sort_order,name,type,status,area,task_kind,group_name FROM machines").fetchall()
    conn.close()
    machines = [dict(r) for r in rows]

    sort_by = (sort_by or "sort_order").strip().lower()
    sort_dir = (sort_dir or "asc").strip().lower()
    reverse = sort_dir == "desc"

    if filter_type:
        ft = str(filter_type).strip()
        if ft in get_allowed_machine_types():
            machines = [m for m in machines if m.get("type") == ft]
    if filter_status:
        fs = str(filter_status).strip()
        if fs in get_allowed_machine_statuses():
            machines = [m for m in machines if m.get("status") == fs]
        elif fs == "隐藏维修":
            machines = [m for m in machines if m.get("status") != "维修停用"]
    if filter_kind:
        fk = str(filter_kind).strip()
        if fk in get_allowed_task_kinds():
            machines = [m for m in machines if (m.get("task_kind") or "") == fk]
    if filter_group:
        fg = str(filter_group).strip()
        allowed = get_allowed_machine_groups()
        if fg in allowed:
            machines = [m for m in machines if (m.get("group_name") or "") == fg]
        elif fg == "未分组":
            machines = [m for m in machines if not (m.get("group_name") or "")]

    def natural_key_name(x: str):
        m = re.findall(r"\d+", x or "")
        nums = tuple(int(n) for n in m) if m else tuple()
        return (re.sub(r"\d+", "", (x or "")).lower(), nums, (x or ""))

    status_rank = {"空闲": 1, "工作": 2, "维修停用": 3}
    type_cfg = get_config("machine_types")
    type_rank = {}
    for idx, item in enumerate(type_cfg):
        type_rank[item["key"]] = item["sort_order"] if item["sort_order"] and item["sort_order"] > 0 else idx + 1

    if sort_by in ("name", "名称"):
        machines.sort(key=lambda m: natural_key_name(m.get("name")), reverse=reverse)
    elif sort_by in ("type", "机型"):
        machines.sort(
            key=lambda m: (type_rank.get(m.get("type"), 999), natural_key_name(m.get("name"))),
            reverse=reverse,
        )
    elif sort_by in ("status", "状态"):
        machines.sort(
            key=lambda m: (status_rank.get(m.get("status"), 999), natural_key_name(m.get("name"))),
            reverse=reverse,
        )
    elif sort_by in ("task_kind", "任务类型", "kind"):
        machines.sort(key=lambda m: ((m.get("task_kind") or ""), natural_key_name(m.get("name"))), reverse=reverse)
    elif sort_by in ("area", "区域"):
        machines.sort(key=lambda m: ((m.get("task_kind") or m.get("area") or ""), natural_key_name(m.get("name"))), reverse=reverse)
    else:
        machines.sort(key=lambda m: natural_key_name(m.get("name")))
    return machines


def list_tasks(sort_by: str = "id", sort_dir: str = "asc") -> List[Dict]:
    conn = get_db()
    sort_by = (sort_by or "id").strip().lower()
    sort_dir = (sort_dir or "asc").strip().lower()
    col_map = {
        "name": "name", "task_name": "name",
        "type": "type", "task_type": "type",
        "task_kind": "task_kind", "kind": "task_kind",
        "priority": "priority", "pri": "priority",
        "difficulty": "difficulty", "diff": "difficulty",
        "duration": "est_seconds", "est": "est_seconds",
        "status": "status",
        "id": "id",
    }
    col = col_map.get(sort_by, "id")
    direction = "DESC" if sort_dir == "desc" else "ASC"
    rows = conn.execute(
        f"SELECT id,name,type,task_kind,priority,difficulty,duration,est_mode,op_min,reset_min,collect_count,redundancy_min,est_minutes,est_seconds,remark,status,split_group,split_order,split_total_items,package_id,rbp_task_id,scene,general_category,source_link,expected_count,collection_req_id,collection_req_type FROM tasks ORDER BY {col} {direction}"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def list_schedules(date: str) -> List[Dict]:
    conn = get_db()
    rows = conn.execute(
        """
        SELECT s.id,s.date,s.machine_id,s.machine_name,s.task_id,s.task_name,s.task_type,s.task_kind,
               s.duration,s.remark,s.start_min,s.end_min,s.status,
               t.priority, t.difficulty, t.split_group
        FROM schedules s LEFT JOIN tasks t ON s.task_id = t.id
        WHERE s.date=?
        ORDER BY s.machine_id ASC, s.start_min ASC, s.id ASC
        """,
        (date,),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_repair_logs(machine_ids: List[int], base_date_str: str) -> Dict[int, List[Dict]]:
    """查询指定机器的维修日志，转换为相对 base_date 的 abs_min 坐标"""
    if not machine_ids:
        return {}
    conn = get_db()
    placeholders = ",".join("?" * len(machine_ids))
    rows = conn.execute(
        f"SELECT id, machine_id, start_datetime, end_datetime FROM repair_log "
        f"WHERE machine_id IN ({placeholders}) ORDER BY machine_id, start_datetime",
        [int(m) for m in machine_ids],
    ).fetchall()
    conn.close()
    result = {}
    for r in rows:
        mid = int(r["machine_id"])
        start_dt = datetime.datetime.fromisoformat(r["start_datetime"])
        start_abs = datetime_to_abs_min(start_dt, base_date_str)
        end_abs = None
        if r["end_datetime"]:
            end_dt = datetime.datetime.fromisoformat(r["end_datetime"])
            end_abs = datetime_to_abs_min(end_dt, base_date_str)
        if mid not in result:
            result[mid] = []
        result[mid].append({
            "id": r["id"],
            "abs_start": start_abs,
            "abs_end": end_abs,
            "start_datetime": r["start_datetime"],
            "end_datetime": r["end_datetime"],
        })
    return result


def _get_repair_for_schedule(conn, machine_id: int, date_str: str, start_min: int, end_min: int) -> List[Dict]:
    """查询与指定排班时间段重叠的维修记录，返回维修段列表"""
    s_date = datetime.date.fromisoformat(date_str)
    s_start_dt = datetime.datetime.combine(s_date, datetime.time(0, 0)) + datetime.timedelta(minutes=int(start_min))
    s_end_dt = datetime.datetime.combine(s_date, datetime.time(0, 0)) + datetime.timedelta(minutes=int(end_min))
    rows = conn.execute(
        """SELECT id, start_datetime, end_datetime FROM repair_log
           WHERE machine_id=? AND start_datetime < ? AND (end_datetime > ? OR end_datetime IS NULL)
           ORDER BY start_datetime""",
        (int(machine_id), s_end_dt.isoformat(), s_start_dt.isoformat()),
    ).fetchall()
    periods = []
    for r in rows:
        start_dt = datetime.datetime.fromisoformat(r["start_datetime"])
        end_dt = datetime.datetime.fromisoformat(r["end_datetime"]) if r["end_datetime"] else None
        duration_minutes = overlap_minutes(s_start_dt, s_end_dt, start_dt, end_dt)
        start_label = format_datetime_label(start_dt)
        end_label = format_datetime_label(end_dt) if end_dt else "至今"
        periods.append({
            "id": r["id"],
            "start_datetime": r["start_datetime"],
            "end_datetime": r["end_datetime"],
            "duration_minutes": duration_minutes,
            "label": f"{start_label}~{end_label}",
        })
    return periods


def list_history_schedules(date_from: Optional[str] = None, date_to: Optional[str] = None) -> List[Dict]:
    conn = get_db()
    base_sql = """
        SELECT s.id,s.date,s.machine_id,s.machine_name,s.task_id,s.task_name,s.task_type,s.task_kind,s.duration,s.remark,s.start_min,s.end_min,s.status,s.created_at,
               t.priority, t.difficulty, t.split_group, t.rbp_task_id, t.scene, t.general_category, t.source_link, t.expected_count, t.collection_req_id, t.collection_req_type
        FROM schedules s
        LEFT JOIN tasks t ON s.task_id = t.id
        WHERE s.status='completed'
    """
    if date_from and date_to:
        rows = conn.execute(
            base_sql + """
                AND julianday(s.date) + CAST(s.start_min AS REAL) / 1440.0 < julianday(?) + 1
                AND julianday(s.date) + CAST(s.end_min AS REAL) / 1440.0 > julianday(?)
            ORDER BY s.date DESC, s.id DESC
            """,
            (date_to, date_from),
        ).fetchall()
    elif date_from:
        rows = conn.execute(
            base_sql + """
                AND julianday(s.date) + CAST(s.end_min AS REAL) / 1440.0 > julianday(?)
            ORDER BY s.date DESC, s.id DESC
            """,
            (date_from,),
        ).fetchall()
    elif date_to:
        rows = conn.execute(
            base_sql + """
                AND julianday(s.date) + CAST(s.start_min AS REAL) / 1440.0 < julianday(?) + 1
            ORDER BY s.date DESC, s.id DESC
            """,
            (date_to,),
        ).fetchall()
    else:
        rows = conn.execute(
            base_sql + " ORDER BY s.date DESC, s.id DESC LIMIT 500"
        ).fetchall()
    result = []
    for r in rows:
        s = dict(r)
        s["record_type"] = "schedule"
        s["start_str"] = abs_min_to_label(int(s["start_min"]))
        s["end_str"] = abs_min_to_label(min(28 * 1440, int(s["end_min"])))
        repair_periods = _get_repair_for_schedule(
            conn, int(s["machine_id"]), s["date"],
            int(s["start_min"]), int(s["end_min"]),
        )
        s["repair_periods"] = repair_periods
        total_repair_min = sum(p["duration_minutes"] for p in repair_periods)
        s["repair_duration"] = format_elapsed(total_repair_min) if total_repair_min > 0 else ""
        s["repair_periods_str"] = "; ".join(p["label"] for p in repair_periods) if repair_periods else ""
        result.append(s)

    # 补充：已完成但从未分配过的任务（无 schedule 记录）
    no_sched_rows = conn.execute("""
        SELECT NULL as id, NULL as date, NULL as machine_id, NULL as machine_name,
               t.id as task_id, t.name as task_name, t.type as task_type, t.task_kind,
               NULL as duration, t.remark, NULL as start_min, NULL as end_min,
               t.status, NULL as created_at,
               t.priority, t.difficulty, t.split_group, t.rbp_task_id, t.scene,
               t.general_category, t.source_link, t.expected_count, t.collection_req_id, t.collection_req_type
        FROM tasks t
        WHERE t.status = '已完成'
          AND t.id NOT IN (SELECT DISTINCT task_id FROM schedules WHERE task_id IS NOT NULL)
        ORDER BY t.id DESC
    """).fetchall()
    for r in no_sched_rows:
        s = dict(r)
        s["record_type"] = "task_only"
        s["start_str"] = ""
        s["end_str"] = ""
        s["repair_periods"] = []
        s["repair_duration"] = ""
        s["repair_periods_str"] = ""
        result.append(s)

    conn.close()
    return result
