"""
自动分配任务算法
- 贪心按优先级分配到兼容机器的空闲时段
- 批量延迟（应对大规模停机）
"""
import datetime
from typing import List, Dict, Optional, Tuple
from db import get_db
from utils import parse_duration_to_minutes, normalize_machine_schedule, abs_min_to_label, parse_hhmm


def _hhmm_to_min(s: str) -> int:
    """将 HH:MM 字符串转为分钟数"""
    try:
        parts = str(s).strip().split(":")
        return int(parts[0]) * 60 + int(parts[1])
    except Exception:
        return 0


def find_free_slots(conn, date: str, machine_id: int, start_min: int, end_min: int) -> List[Tuple[int, int]]:
    """返回指定机器在 [start_min, end_min] 连续时间窗内的空闲时段（支持跨日期）"""
    import datetime as _dt

    base_date = _dt.date.fromisoformat(date)
    start_day = start_min // 1440
    end_day = (end_min - 1) // 1440 if end_min > start_min else start_day

    all_occupied = []
    for day_offset in range(start_day, end_day + 1):
        cur_date = (base_date + _dt.timedelta(days=day_offset)).isoformat()
        rows = conn.execute(
            """
            SELECT start_min, end_min FROM schedules
            WHERE date=? AND machine_id=? AND status!='completed'
            ORDER BY start_min ASC
            """,
            (cur_date, machine_id),
        ).fetchall()
        for r in rows:
            s = int(r["start_min"]) + day_offset * 1440
            e = int(r["end_min"]) + day_offset * 1440
            all_occupied.append((s, e))

    all_occupied.sort(key=lambda x: x[0])

    free = []
    cursor = start_min
    for s, e in all_occupied:
        if s > cursor:
            free.append((cursor, min(s, end_min)))
        cursor = max(cursor, e)
        if cursor >= end_min:
            break
    if cursor < end_min:
        free.append((cursor, end_min))
    return [(a, b) for a, b in free if b - a >= 1]


def _exclude_from_slots(slots: List[Tuple[int, int]],
                        exclusions: List[Tuple[int, int]]) -> List[Tuple[int, int]]:
    """从空闲时段中移除排除时段"""
    if not exclusions:
        return slots
    result = []
    for a, b in slots:
        seg_start = a
        for ex_a, ex_b in sorted(exclusions):
            ex_a = max(a, ex_a)
            ex_b = min(b, ex_b)
            if ex_a < ex_b:
                if seg_start < ex_a:
                    result.append((seg_start, ex_a))
                seg_start = max(seg_start, ex_b)
        if seg_start < b:
            result.append((seg_start, b))
    return [(a, b) for a, b in result if b - a >= 1]


def _task_duration_min(task: Dict) -> int:
    """从任务记录中获取预估时长（分钟），默认120"""
    est_seconds = task.get("est_seconds")
    if est_seconds:
        return max(1, int(est_seconds) // 60)
    return parse_duration_to_minutes(task.get("duration"), default_minutes=120)


def _adjust_start_over_breaks(desired_start: int, breaks: List[Tuple[int, int]]) -> int:
    """若 desired_start 落入休息段，推到休息段结束后"""
    for bs, be in breaks:
        if bs <= desired_start < be:
            desired_start = be
    return desired_start


def _extend_end_over_breaks(start_min: int, end_min: int, date_str: str,
                            shift_config: dict) -> int:
    """时间线推进模拟：逐段消耗休息段，返回正确结束时间。

    - 若开始时间落在休息段内，先跳到休息段末尾
    - 逐段检查：在下一个休息段前能否做完？能→返回；不能→跳过休息段继续
    """
    duration = max(1, end_min - start_min)

    # 收集所有休息段（覆盖任务可能跨越多天的场景）
    breaks = []
    start_day = start_min // 1440
    for d in range(start_day - 1, start_day + 4):
        base = d * 1440
        for a, b in shift_config["day_shift"].get("breaks", []):
            breaks.append((base + a, base + b))
        for a, b in shift_config["night_shift"].get("breaks", []):
            breaks.append((base + a, base + b))
    breaks.sort()

    current = start_min
    remaining = duration

    for bs, be in breaks:
        if be <= current:
            continue

        # 当前位置落在休息段内 → 跳到休息段之后
        if bs <= current < be:
            current = be

        if bs <= current:
            continue

        # 在下一个休息段之前能否做完
        work_before_break = bs - current
        if remaining <= work_before_break:
            return current + remaining

        # 做不到休息段就消耗掉，跳到休息段后继续
        remaining -= work_before_break
        current = be

    # 所有休息段遍历完，做完剩余时长
    return current + remaining


def auto_assign_tasks(
    task_ids: List[int],
    machine_ids: List[int],
    date: str,
    gap_minutes: int = 0,
    work_start_min: Optional[int] = None,
    work_end_min: Optional[int] = None,
    exclusion_periods: Optional[List[Tuple[int, int]]] = None,
    avoid_break_start: bool = False,
    avoid_break_end: bool = False,
    extend_over_breaks: bool = True,
    dry_run: bool = False,
    package_group_map: Optional[Dict[int, str]] = None,
) -> Dict:
    """
    自动分配任务到机器。按优先级(P0>P1>P2)贪心分配。

    avoid_break_start: True=任务开始时间若落入休息段则推到休息段后
    avoid_break_end: True=任务不能在休息期间结束
    返回: {"assigned": [...], "unassigned": [...], "total": N, "dry_run": bool}
    """
    conn = get_db()
    exclusion_periods = exclusion_periods or []

    # 默认工时：0:00-24:00（全天），允许跨天绝对分钟
    ws = work_start_min if work_start_min is not None else 0
    we = work_end_min if work_end_min is not None else 24 * 60
    ws = max(0, ws)
    we = max(ws + 1, we)

    # 获取任务
    if task_ids:
        placeholders = ",".join("?" * len(task_ids))
        rows = conn.execute(
            f"SELECT * FROM tasks WHERE id IN ({placeholders}) AND status='待分配'",
            [int(t) for t in task_ids],
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM tasks WHERE status='待分配'"
        ).fetchall()

    tasks = [dict(r) for r in rows]
    pri_rows = conn.execute(
        "SELECT key, sort_order FROM config WHERE category='priorities' ORDER BY sort_order"
    ).fetchall()
    pri_order = {r["key"]: r["sort_order"] for r in pri_rows}
    if not pri_order:
        pri_order = {"P0": 0, "P1": 1, "P2": 2}
    default_pri = max(pri_order.values()) + 1 if pri_order else 99
    tasks.sort(key=lambda t: pri_order.get(str(t.get("priority") or ""), default_pri))

    # 获取机器
    if machine_ids:
        placeholders_m = ",".join("?" * len(machine_ids))
        machines = conn.execute(
            f"SELECT * FROM machines WHERE id IN ({placeholders_m})",
            [int(m) for m in machine_ids],
        ).fetchall()
    else:
        machines = conn.execute("SELECT * FROM machines WHERE status!='维修停用'").fetchall()
    machines = [dict(m) for m in machines]

    # 构建兼容机器列表（用于批量预加载）
    all_mids = set()
    for task in tasks:
        task_type = str(task["type"])
        task_kind = str(task.get("task_kind") or "常规")
        for m in machines:
            if m["type"] == task_type and (m.get("task_kind") or "") == task_kind and m["status"] != "维修停用":
                all_mids.add(int(m["id"]))

    # 批量预加载所有兼容机器×相关日期的排班数据
    import datetime as _dt
    base_dt = _dt.date.fromisoformat(date)
    start_day = ws // 1440
    end_day = (we - 1) // 1440 if we > ws else start_day
    all_dates = []
    for doff in range(start_day, end_day + 1):
        all_dates.append((base_dt + _dt.timedelta(days=doff)).isoformat())

    machine_schedules = {}  # {machine_id: [(start_abs, end_abs), ...]}
    for mid in all_mids:
        machine_schedules[mid] = []
        for di, d in enumerate(all_dates):
            rows = conn.execute(
                """SELECT start_min, end_min FROM schedules
                   WHERE date=? AND machine_id=? AND status!='completed'
                   ORDER BY start_min ASC""",
                (d, mid),
            ).fetchall()
            for r in rows:
                machine_schedules[mid].append(
                    (int(r["start_min"]) + di * 1440, int(r["end_min"]) + di * 1440)
                )
        machine_schedules[mid].sort(key=lambda x: x[0])

    def _free_slots_from_cache(occupied, start_min, end_min):
        free = []
        cursor = start_min
        for s, e in occupied:
            if s > cursor:
                free.append((cursor, min(s, end_min)))
            cursor = max(cursor, e)
            if cursor >= end_min:
                break
        if cursor < end_min:
            free.append((cursor, end_min))
        return [(a, b) for a, b in free if b - a >= 1]

    assigned = []
    unassigned = []

    shift_config = None
    all_breaks = []
    need_breaks = extend_over_breaks or avoid_break_start or avoid_break_end
    if need_breaks:
        from models import load_shift_config
        shift_config = load_shift_config()
    if avoid_break_start or avoid_break_end:
        # 收集一天内所有非工作时间 = 在班休息段 + 班次间隙
        raw_rest = []
        for a, b in shift_config.get("day_shift", {}).get("breaks", []):
            raw_rest.append((a, b))
        for a, b in shift_config.get("night_shift", {}).get("breaks", []):
            raw_rest.append((a, b))

        # 计算班次间隙：取工作时段的反
        ds = shift_config.get("day_shift", {})
        ns = shift_config.get("night_shift", {})
        ds_start = parse_hhmm(ds.get("start", "09:00"))
        ds_end = parse_hhmm(ds.get("end", "18:30"))
        ns_start = parse_hhmm(ns.get("start", "21:00"))
        ns_end = parse_hhmm(ns.get("end", "06:30"))

        working = []
        if ds_end > ds_start:
            working.append((ds_start, ds_end))
        for a, b in ds.get("overtime", []):
            working.append((a, b))
        working.append((ns_start, 1440))
        working.append((0, ns_end))
        for a, b in ns.get("overtime", []):
            working.append((a, b))

        working.sort()
        merged = []
        for a, b in working:
            if merged and a <= merged[-1][1]:
                merged[-1] = (merged[-1][0], max(merged[-1][1], b))
            else:
                merged.append((a, b))
        cursor = 0
        for a, b in merged:
            if a > cursor:
                raw_rest.append((cursor, a))
            cursor = max(cursor, b)
        if cursor < 1440:
            raw_rest.append((cursor, 1440))

        raw_rest.sort()
        # 跨天展开：覆盖整个时间窗口
        start_day = ws // 1440
        end_day = (we - 1) // 1440 if we > ws else start_day
        for d in range(start_day - 1, end_day + 2):
            base = d * 1440
            for a, b in raw_rest:
                all_breaks.append((base + a, base + b))
        all_breaks.sort()

    for task in tasks:
        tid = int(task["id"])
        task_type = str(task["type"])
        task_name = str(task["name"])
        task_kind = str(task.get("task_kind") or "常规")
        dur_min = _task_duration_min(task)
        total_needed = dur_min + max(0, gap_minutes)

        compatible = [m for m in machines
            if m["type"] == task_type
            and (m.get("task_kind") or "") == task_kind
            and m["status"] != "维修停用"]

        compatible_all_type = compatible

        # 分组约束：若任务属于被约束的任务包，只保留对应分组的机器
        pkg_id = task.get("package_id")
        if pkg_id is not None and package_group_map:
            constrained_group = package_group_map.get(int(pkg_id))
            if constrained_group:
                compatible = [m for m in compatible
                              if (m.get("group_name") or "") == constrained_group]

        best_start = None
        best_machine = None

        for m in compatible:
            mid = int(m["id"])
            occupied = machine_schedules.get(mid, [])
            free_slots = _free_slots_from_cache(occupied, ws, we)
            if exclusion_periods:
                free_slots = _exclude_from_slots(free_slots, exclusion_periods)
            if avoid_break_start and avoid_break_end and all_breaks:
                free_slots = _exclude_from_slots(free_slots, all_breaks)

            for slot_start, slot_end in free_slots:
                candidate = slot_start

                # 开始时间避开休息段
                if avoid_break_start:
                    candidate = _adjust_start_over_breaks(candidate, all_breaks)

                if candidate + total_needed > slot_end:
                    continue

                # 结束时间避开休息段：不断把落入休息段的结束时间推到休息段后
                if avoid_break_end:
                    for _ in range(len(all_breaks) + 1):
                        end_candidate = candidate + dur_min
                        pushed = False
                        for bs, be in all_breaks:
                            if bs < end_candidate <= be:
                                candidate = be
                                pushed = True
                                break
                        if not pushed:
                            break
                    # 推完后重新检查开始时间
                    if avoid_break_start:
                        candidate = _adjust_start_over_breaks(candidate, all_breaks)
                    if candidate + total_needed > slot_end:
                        continue

                if slot_end - candidate >= total_needed:
                    if best_start is None or candidate < best_start:
                        best_start = candidate
                        best_machine = m
                        break  # 该机器已找到最早可用时段

        if best_start is not None and best_machine is not None:
            best_end = best_start + dur_min
            if extend_over_breaks and shift_config is not None:
                best_end = _extend_end_over_breaks(best_start, best_end, date, shift_config)
            # 将本次分配加入缓存（使用延长后的 best_end）
            actual_slot_end = best_end + max(0, gap_minutes)
            mid_assigned = int(best_machine["id"])
            if mid_assigned not in machine_schedules:
                machine_schedules[mid_assigned] = []
            machine_schedules[mid_assigned].append((best_start, actual_slot_end))
            machine_schedules[mid_assigned].sort(key=lambda x: x[0])

            import datetime as _dt_base
            base_dt = _dt_base.date.fromisoformat(date)
            day_offset = best_start // 1440
            actual_date = (base_dt + _dt_base.timedelta(days=day_offset)).isoformat()
            actual_start = best_start - day_offset * 1440
            actual_end = best_end - day_offset * 1440

            if not dry_run:
                conn.execute(
                    "DELETE FROM schedules WHERE task_id=?", (tid,),
                )
                cur = conn.execute(
                    """
                    INSERT INTO schedules(date, machine_id, machine_name, task_id,
                    task_name, task_type, task_kind, duration, remark, start_min, end_min,
                    status, created_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                    """,
                    (
                        actual_date,
                        int(best_machine["id"]),
                        best_machine["name"],
                        tid,
                        task_name,
                        task_type,
                        task_kind,
                        task.get("duration") or "",
                        (task.get("remark") or ""),
                        actual_start,
                        actual_end,
                        "executing",
                        datetime.datetime.now().isoformat(timespec="seconds"),
                    ),
                )
                # 已完成的任务不覆盖状态
                existing_status = conn.execute("SELECT status FROM tasks WHERE id=?", (tid,)).fetchone()
                if not existing_status or existing_status["status"] != "已完成":
                    conn.execute("UPDATE tasks SET status='已分配' WHERE id=?", (tid,))
                normalize_machine_schedule(conn, actual_date, int(best_machine["id"]))
                schedule_id = cur.lastrowid
            else:
                schedule_id = None

            assigned.append({
                "task_id": tid,
                "task_name": task_name,
                "task_type": task_type,
                "task_kind": task_kind,
                "priority": task.get("priority"),
                "duration_min": dur_min,
                "machine_id": int(best_machine["id"]),
                "machine_name": best_machine["name"],
                "schedule_id": schedule_id,
                "date": actual_date,
                "start_min": actual_start,
                "end_min": actual_end,
                "start_str": abs_min_to_label(best_start),
                "end_str": abs_min_to_label(best_end),
            })
        else:
            if not compatible_all_type:
                same_type = [m for m in machines if m["type"] == task_type and m["status"] != "维修停用"]
                if not same_type:
                    reason = f"无{task_type}类型机器可用"
                else:
                    reason = f"无{task_type}/{task_kind}机器可用（有{task_type}机器但任务类型不匹配）"
            elif not compatible:
                constrained_group = package_group_map.get(int(pkg_id)) if pkg_id is not None and package_group_map else None
                if constrained_group:
                    reason = f"分组约束「{constrained_group}」内无兼容机器空闲时段"
                else:
                    reason = "兼容机器无空闲时段"
            else:
                reason = "兼容机器无空闲时段"
            unassigned.append({
                "task_id": tid,
                "task_name": task_name,
                "task_type": task_type,
                "priority": task.get("priority"),
                "duration_min": dur_min,
                "reason": reason,
            })

    try:
        if not dry_run:
            conn.commit()
        return {
            "assigned": assigned,
            "unassigned": unassigned,
            "total": len(tasks),
            "dry_run": dry_run,
        }
    finally:
        conn.close()



def mass_delay(
    machine_ids: List[int],
    date: str,
    delay_minutes: int,
    from_start_min: int = 0,
    mode: str = "shift",
    strategy: str = "block",
    include_completed: bool = False,
    extend_over_breaks: bool = True,
) -> Dict:
    """
    批量延迟：将指定机器上 from_start_min 之后的任务延迟。

    mode: "shift" (平移) | "extend" (拉伸)
    strategy: "block" (整体后移) | "smart" (智能填充)
    include_completed: 是否同时延迟已完成任务

    返回: {"affected": N, "warnings": [...]}
    """
    conn = get_db()
    affected = 0
    affected_ids = []
    warnings = []

    shift_config = None
    if extend_over_breaks:
        from models import load_shift_config
        shift_config = load_shift_config()

    for mid in machine_ids:
        # 获取该机器上 from_start_min 之后及跨越该时刻的任务
        status_filter = "" if include_completed else "AND status!='completed'"
        rows = conn.execute(
            f"""
            SELECT id, start_min, end_min, status
            FROM schedules
            WHERE date=? AND machine_id=? {status_filter}
              AND (start_min >= ? OR (start_min < ? AND end_min > ?))
            ORDER BY start_min ASC
            """,
            (date, int(mid), from_start_min, from_start_min, from_start_min),
        ).fetchall()

        if not rows:
            continue

        if strategy == "block":
            # 整体后移：直接对每个任务应用延迟
            for r in rows:
                sid = int(r["id"])
                if mode == "shift":
                    new_start = int(r["start_min"]) + delay_minutes
                    new_end = int(r["end_min"]) + delay_minutes
                else:  # extend
                    new_start = int(r["start_min"])
                    new_end = int(r["end_min"]) + delay_minutes
                if extend_over_breaks and shift_config is not None:
                    new_end = _extend_end_over_breaks(new_start, new_end, date, shift_config)
                new_start = max(0, min(28 * 1440 - 1, new_start))
                new_end = max(new_start + 1, min(28 * 1440, new_end))
                conn.execute(
                    "UPDATE schedules SET start_min=?, end_min=? WHERE id=?",
                    (new_start, new_end, sid),
                )
                affected += 1
                affected_ids.append(sid)

        else:  # strategy == "smart"
            # 获取该机器上全部任务（含已完成，作为占用时间线障碍）
            all_tasks = conn.execute(
                """
                SELECT id, start_min, end_min FROM schedules
                WHERE date=? AND machine_id=?
                ORDER BY start_min ASC
                """,
                (date, int(mid)),
            ).fetchall()

            delayed_ids = {int(r["id"]) for r in rows}

            # 构建非延迟任务的占用槽位（已完成任务不在延迟范围时自动成为障碍）
            occupied = []
            for t in all_tasks:
                tid = int(t["id"])
                if tid not in delayed_ids:
                    occupied.append([int(t["start_min"]), int(t["end_min"])])

            # 处理每个被延迟的任务
            for r in rows:
                sid = int(r["id"])
                dur = max(1, int(r["end_min"]) - int(r["start_min"]))

                if mode == "shift":
                    desired_start = int(r["start_min"]) + delay_minutes
                    # 智能找空隙
                    actual_start = desired_start
                    # 与已占用槽位比较，找到第一个足够大的空隙
                    occupied.sort(key=lambda x: x[0])
                    # 合并 occupied 用于扫描
                    merged_occ = []
                    for a, b in occupied:
                        if merged_occ and a <= merged_occ[-1][1]:
                            merged_occ[-1][1] = max(merged_occ[-1][1], b)
                        else:
                            merged_occ.append([a, b])
                    for a, b in merged_occ:
                        if actual_start + dur <= a:
                            break  # 空隙足够
                        if actual_start < b:
                            actual_start = b  # 被占用，跳到槽位后
                    actual_end = actual_start + dur

                else:  # extend: 开始不变，延长结束时间
                    actual_start = int(r["start_min"])
                    actual_end = int(r["end_min"]) + delay_minutes
                    # 检查是否与已有任务重叠，给出警告
                    for a, b in occupied:
                        if actual_start < b and actual_end > a:
                            warnings.append(
                                f"机器{mid}任务{sid}拉伸后与已有任务重叠，已由归一化处理"
                            )

                if extend_over_breaks and shift_config is not None:
                    actual_end = _extend_end_over_breaks(actual_start, actual_end, date, shift_config)
                actual_start = max(0, min(28 * 1440 - 1, actual_start))
                actual_end = max(actual_start + 1, min(28 * 1440, actual_end))

                conn.execute(
                    "UPDATE schedules SET start_min=?, end_min=? WHERE id=?",
                    (actual_start, actual_end, sid),
                )
                affected += 1
                affected_ids.append(sid)
                # 将当前任务加入占用列表
                occupied.append([actual_start, actual_end])

        normalize_machine_schedule(conn, date, int(mid))

    try:
        conn.commit()
        return {"affected": affected, "affected_ids": affected_ids, "warnings": warnings}
    finally:
        conn.close()
