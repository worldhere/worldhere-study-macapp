# -*- coding: utf-8 -*-
"""可视化总结数据层：纯数据函数，输入 conn + 参数 → 输出 dict/list。
飞书和 Web 面板各自消费同一份数据。"""
import datetime


def _parse_minutes(t_str):
    """'HH:MM' -> 绝对分钟数（内联以避免循环导入 feishu.events.shared）"""
    if not t_str:
        return None
    try:
        parts = str(t_str).strip().replace('：', ':').split(":")
        return int(parts[0]) * 60 + int(parts[1])
    except Exception:
        return None


def _date_range(days, end_date=None):
    """根据截止日期和天数计算起始日期（YYYY-MM-DD 字符串）。
    end_date 为 None 时默认今天。
    返回 (start_date_str, end_date_str)"""
    if end_date:
        try:
            end_dt = datetime.date.fromisoformat(end_date)
        except (ValueError, TypeError):
            end_dt = datetime.date.today()
    else:
        end_dt = datetime.date.today()
    start_dt = end_dt - datetime.timedelta(days=days)
    return start_dt.strftime("%Y-%m-%d"), end_dt.strftime("%Y-%m-%d")


# ========== 迁移自 cards.py 的辅助函数 ==========

def _build_shift_where(conn, shift, date_str):
    """用班次时间区间（start_min）构造 WHERE 子句，替代纯日历日期过滤。

    返回 (where_clause, where_params)。

    白班：当天 day_start ≤ start_min < night_start
    夜班：昨天 night_start ≤ start_min < 24:00 + 今天 00:00 ≤ start_min < day_start

    这避免了用 date 字段过滤时混入不属于该班次的排班
    （如白班报告混入凌晨的夜班排班、夜班报告混入白班排班）。
    """
    try:
        base_date = datetime.date.fromisoformat(date_str) if date_str else datetime.date.today()
    except (ValueError, TypeError):
        base_date = datetime.date.today()
    tomorrow_str = (base_date + datetime.timedelta(days=1)).strftime("%Y-%m-%d")

    shift_rows = conn.execute(
        "SELECT key, start FROM shift_config WHERE key IN ('day_shift', 'night_shift')"
    ).fetchall()
    _ds = _ns = None
    for r in shift_rows:
        t = _parse_minutes(r["start"])
        if r["key"] == "day_shift":
            _ds = t
        elif r["key"] == "night_shift":
            _ns = t
    day_start = _ds if _ds is not None else 540   # 默认 09:00
    night_start = _ns if _ns is not None else 1260  # 默认 21:00

    if shift == "夜班":
        if day_start < night_start:
            # 正常：夜班跨天 [night_start, 1440) + [0, day_start)
            clause = "((s.date = ? AND s.start_min >= ?) OR (s.date = ? AND s.start_min < ?))"
            params = (date_str, night_start, tomorrow_str, day_start)
        else:
            # 防御：白班开始晚于夜班开始，夜班变为不跨天段 [night_start, day_start)
            clause = "(s.date = ? AND s.start_min >= ? AND s.start_min < ?)"
            params = (date_str, night_start, day_start)
    else:
        if day_start < night_start:
            # 正常：白班 [day_start, night_start)
            clause = "(s.date = ? AND s.start_min >= ? AND s.start_min < ?)"
            params = (date_str, day_start, night_start)
        else:
            # 防御：白班开始晚于夜班开始，白班变为跨天段 [day_start, 1440) + [0, night_start)
            clause = "((s.date = ? AND s.start_min >= ?) OR (s.date = ? AND s.start_min < ?))"
            params = (date_str, day_start, tomorrow_str, night_start)

    return clause, params


def _query_package_progress(conn, where_clause, where_params):
    """查询任务包进度：
    - 显示条件：包内至少一个任务在本班次有排班，或有已完成任务
    - 进度数据：包内全部任务的完成情况（不限班次）
    """
    # Step 1: 找出需要显示的任务包 ID —— 本班次有排班 或 有已完成任务
    candidate_rows = conn.execute(
        f"""SELECT DISTINCT p.id
            FROM task_packages p
            JOIN tasks t ON t.package_id = p.id
            LEFT JOIN schedules s ON s.task_id = t.id
               AND {where_clause.replace('s.', 's.')}
            WHERE (s.id IS NOT NULL) OR (t.status = '已完成')
            GROUP BY p.id""",
        where_params
    ).fetchall()
    candidate_ids = [r["id"] for r in candidate_rows]

    if not candidate_ids:
        return []

    # Step 2: 对这些包，统计全部任务的完成进度
    placeholders = ",".join("?" * len(candidate_ids))
    rows = conn.execute(
        f"""SELECT p.id, p.name,
                   COUNT(t.id) AS total,
                   SUM(CASE WHEN t.status = '已完成' THEN 1 ELSE 0 END) AS completed
            FROM task_packages p
            JOIN tasks t ON t.package_id = p.id
            WHERE p.id IN ({placeholders})
            GROUP BY p.id ORDER BY p.name""",
        candidate_ids
    ).fetchall()
    return rows


def _query_package_schedule_stats(conn, where_clause, where_params):
    """按排班维度统计包排班数（用于汇总段的排班完成率）。"""
    row = conn.execute(
        f"""SELECT COUNT(*) AS total,
                   SUM(CASE WHEN s.status='completed' THEN 1 ELSE 0 END) AS completed
            FROM schedules s
            JOIN tasks t ON s.task_id = t.id
            WHERE {where_clause} AND t.package_id IS NOT NULL""",
        where_params
    ).fetchone()
    return (row["total"] or 0, row["completed"] or 0) if row else (0, 0)


def _query_collect_total(conn, where_clause, where_params):
    """统计已完成任务的采集总数（按 task_id 去重，避免多机器排班重复累加）。
    优先使用 expected_count，回退到 collect_count。"""
    row = conn.execute(
        f"""SELECT COALESCE(SUM(COALESCE(ti.expected_count, ti.collect_count, 0)), 0) AS total
            FROM (
              SELECT DISTINCT s.task_id
              FROM schedules s
              WHERE {where_clause} AND s.status='completed' AND s.task_id IS NOT NULL
            ) done
            JOIN tasks ti ON done.task_id = ti.id""",
        where_params
    ).fetchone()
    return row["total"] if row else 0


# ========== 13 个 Widget 数据函数 ==========

# ① 班次报告
def shift_report_data(conn, date_str, shift):
    """班次报告核心数据。返回 dict。"""
    where_clause, where_params = _build_shift_where(conn, shift, date_str)

    all_total = conn.execute(
        f"SELECT COUNT(*) AS c FROM schedules s WHERE {where_clause}", where_params
    ).fetchone()

    total_normal = conn.execute(
        f"""SELECT COUNT(*) AS c FROM schedules s
           LEFT JOIN tasks t ON s.task_id = t.id
           WHERE {where_clause} AND s.status='completed' AND t.package_id IS NULL""",
        where_params
    ).fetchone()

    pkg_rows = _query_package_progress(conn, where_clause, where_params)
    pkg_sch_total, pkg_sch_completed = _query_package_schedule_stats(conn, where_clause, where_params)
    collect_total = _query_collect_total(conn, where_clause, where_params)

    total_normal_val = total_normal["c"] if total_normal else 0
    completed_all = pkg_sch_completed + total_normal_val
    all_count = pkg_sch_total + total_normal_val
    completion_pct = round(completed_all / all_count * 100) if all_count > 0 else 0

    packages = []
    for r in pkg_rows:
        t = r["total"] or 0
        c = r["completed"] or 0
        packages.append({
            "name": r["name"],
            "total": t,
            "completed": c,
            "pct": round(c / t * 100) if t > 0 else 0,
        })

    return {
        "total_schedules": all_total["c"] if all_total else 0,
        "completed_standalone": total_normal_val,
        "packages": packages,
        "pkg_sch_total": pkg_sch_total,
        "pkg_sch_completed": pkg_sch_completed,
        "collect_total": collect_total,
        "completion_pct": completion_pct,
        "pending_count": (all_total["c"] if all_total else 0) - completed_all,
    }


# ② 每日完成趋势
def daily_trend_data(conn, days=14, end_date=None, machine_type=None):
    """每日完成趋势。返回 list[dict]"""
    from_date, to_date = _date_range(days, end_date)
    if machine_type:
        rows = conn.execute(
            """SELECT s.date, COUNT(*) as total,
                      SUM(CASE WHEN s.status='completed' THEN 1 ELSE 0 END) as completed
               FROM schedules s JOIN machines m ON s.machine_id=m.id
               WHERE s.date >= ? AND s.date <= ? AND m.type=?
               GROUP BY s.date ORDER BY s.date""",
            (from_date, to_date, machine_type)
        ).fetchall()
    else:
        rows = conn.execute(
            """SELECT date, COUNT(*) as total,
                      SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed
               FROM schedules WHERE date >= ? AND date <= ?
               GROUP BY date ORDER BY date""",
            (from_date, to_date)
        ).fetchall()
    return [{"date": r["date"], "completed": r["completed"] or 0, "total": r["total"] or 0} for r in rows]


# ③ 预估 vs 实际时长
def estimate_vs_actual_data(conn, days=14, end_date=None):
    """预估 vs 实际时长对比。返回 list[dict]"""
    from_date, to_date = _date_range(days, end_date)
    rows = conn.execute(
        """SELECT s.task_name, s.machine_name, s.task_type as type,
                  (s.end_min - s.start_min) as est_min,
                  (s.actual_end_min - s.actual_start_min) as actual_min
           FROM schedules s
           WHERE s.date >= ? AND s.date <= ? AND s.status='completed'
             AND s.actual_start_min IS NOT NULL AND s.actual_end_min IS NOT NULL
           ORDER BY s.date DESC""",
        (from_date, to_date)
    ).fetchall()
    result = []
    for r in rows:
        est = r["est_min"] or 0
        act = r["actual_min"] or 0
        result.append({
            "task_name": r["task_name"],
            "machine_name": r["machine_name"],
            "type": r["type"],
            "est_min": est,
            "actual_min": act,
            "delta_min": act - est,
        })
    return result


# ④ 完成时段热力图
def completion_heatmap_data(conn, days=14, end_date=None):
    """完成时段热力图。返回 list[dict]"""
    from_date, to_date = _date_range(days, end_date)
    rows = conn.execute(
        """SELECT s.date,
                  CAST(strftime('%H', s.completed_at) AS INTEGER) as hour,
                  COUNT(*) as count
           FROM schedules s
           WHERE s.date >= ? AND s.date <= ? AND s.status='completed' AND s.completed_at IS NOT NULL
           GROUP BY s.date, hour ORDER BY s.date, hour""",
        (from_date, to_date)
    ).fetchall()
    return [{"date": r["date"], "hour": r["hour"], "count": r["count"]} for r in rows]


# ⑤ 星期负载分布
def weekday_load_data(conn, days=28, end_date=None):
    """星期负载分布。返回 list[dict]。days 为回溯天数，内部换算为周数。"""
    from_date, to_date = _date_range(days, end_date)
    num_weeks = max(days / 7.0, 1.0)
    labels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
    rows = conn.execute(
        """SELECT CAST(strftime('%w', date) AS INTEGER) as weekday,
                  COUNT(*) as total,
                  SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed
           FROM schedules WHERE date >= ? AND date <= ?
           GROUP BY weekday ORDER BY weekday""",
        (from_date, to_date)
    ).fetchall()
    day_counts = {}
    for r in rows:
        wd = r["weekday"]  # SQLite: 0=Sunday, 1=Monday, ..., 6=Saturday
        py_wd = (wd + 6) % 7  # Python: 0=Monday, ..., 6=Sunday
        day_counts[py_wd] = {"total": r["total"] or 0, "completed": r["completed"] or 0}
    result = []
    for i in range(7):
        dc = day_counts.get(i, {"total": 0, "completed": 0})
        result.append({
            "weekday": i,
            "label": labels[i],
            "total": dc["total"],
            "completed": dc["completed"],
            "avg_per_day": round(dc["total"] / num_weeks, 1),
        })
    return result


def _parse_break_minutes(breaks_str):
    """解析 breaks 字符串 → 休息总分钟数"""
    periods = _parse_break_periods(breaks_str)
    return sum(e - s for s, e in periods)


def _parse_break_periods(breaks_str):
    """解析 breaks 字符串（如 '12:00-13:30,16:00-16:30'）→ [(start_min, end_min), ...]。兼容中文标点。"""
    if not breaks_str:
        return []
    periods = []
    normalized = str(breaks_str).replace('：', ':').replace('，', ',').replace('、', ',').replace('。', ',').replace('－', '-')
    for part in normalized.split(","):
        part = part.strip()
        if "-" in part:
            segs = part.split("-")
            if len(segs) == 2:
                s = _parse_minutes(segs[0].strip())
                e = _parse_minutes(segs[1].strip())
                if s is not None and e is not None and e > s:
                    periods.append((s, e))
    return periods


# ⑥ 机器利用率
def machine_utilization_data(conn, date_str, shift):
    """机器利用率。分子 = Σ(排班时长 - 任务与休息时段重叠部分)，分母 = 班次工作时长。
    衡量单班次内任务在各机器上是否均匀分配。"""
    where_clause, where_params = _build_shift_where(conn, shift, date_str)

    shift_rows = conn.execute(
        "SELECT key, start, end, overtime, breaks FROM shift_config WHERE key IN ('day_shift', 'night_shift')"
    ).fetchall()
    cfg = {}
    for r in shift_rows:
        cfg[r["key"]] = {
            "start": _parse_minutes(r["start"]),
            "end": _parse_minutes(r["end"]),
            "overtime": r["overtime"] or "",
            "breaks": _parse_break_periods(r["breaks"]),
        }

    key = "night_shift" if shift == "夜班" else "day_shift"
    sc = cfg.get(key, {})
    s = sc.get("start")
    e = sc.get("end")
    overtime_str = sc.get("overtime", "")
    break_periods = sc.get("breaks", [])

    # 解析加班结束时间，作为窗口的实际结束边界（兼容中文标点）
    _ot_end = None
    ot_normalized = str(overtime_str).replace('：', ':').replace('－', '-') if overtime_str else ''
    if ot_normalized and "-" in ot_normalized:
        _ot_end = _parse_minutes(ot_normalized.split("-")[1].strip())

    # 可用工作时长 = 班次窗口（含加班） - 休息总时长
    if key == "night_shift":
        s = s if s is not None else 1260
        e = e if e is not None else 390
        ot_end = _ot_end if _ot_end is not None else e
        raw_window = (1440 - s) + ot_end
    else:
        s = s if s is not None else 540
        e = e if e is not None else 1110
        ot_end = _ot_end if _ot_end is not None else e
        raw_window = ot_end - s
    # 只扣窗口内实际覆盖到的休息段
    break_total = sum(
        max(0, min(be, ot_end) - max(bs, s))
        for bs, be in break_periods
    )
    available = max(raw_window - break_total, 1)

    # 逐任务查询，在 Python 中计算扣除休息后的有效工作时长
    rows = conn.execute(
        f"""SELECT s.machine_name, s.machine_id, m.type, m.status as machine_status,
                   s.task_id, s.task_name, s.start_min, s.end_min,
                   s.status as schedule_status, t.split_group
            FROM schedules s
            JOIN machines m ON s.machine_id=m.id
            LEFT JOIN tasks t ON s.task_id=t.id
            WHERE {where_clause}""",
        where_params
    ).fetchall()

    # 计算每任务与休息时段的重叠（任务先裁剪到班次窗口）
    def _overlap(a_start, a_end, b_start, b_end):
        o = min(a_end, b_end) - max(a_start, b_start)
        return max(o, 0)

    def _working_minutes(task_start, task_end):
        # 裁剪到班次窗口内（含加班）
        if key == "night_shift":
            # 夜班跨天：窗口 [s, 1440) + [0, ot_end]
            total = 0
            # 上半段（昨天）：[s, 1440)
            seg1_s, seg1_e = max(task_start, s), min(task_end, 1440)
            if seg1_s < seg1_e:
                total += _clip_duration(seg1_s, seg1_e)
            # 下半段（今天）：[0, ot_end]
            seg2_s, seg2_e = max(task_start, 0), min(task_end, ot_end)
            if seg2_s < seg2_e:
                total += _clip_duration(seg2_s, seg2_e)
            # 如果 task_end > 1440，还要检查 task 映射到 [0, ot_end] 那部分
            if task_end > 1440:
                seg3_s, seg3_e = max(task_start - 1440, 0), min(task_end - 1440, ot_end)
                if seg3_s < seg3_e:
                    total += _clip_duration(seg3_s, seg3_e)
            return total
        else:
            # 白班：窗口 [s, ot_end]
            cs = max(task_start, s)
            ce = min(task_end, ot_end)
            if cs >= ce:
                return 0
            return _clip_duration(cs, ce)

    def _clip_duration(seg_start, seg_end):
        """计算 [seg_start, seg_end] 与休息时段重叠后的净工作时长"""
        raw = seg_end - seg_start
        overlap_total = 0
        for bs, be in break_periods:
            overlap_total += _overlap(seg_start, seg_end, bs, be)
            # 跨天偏移
            if seg_end > 1440:
                overlap_total += _overlap(seg_start, seg_end, bs + 1440, be + 1440)
        return max(raw - overlap_total, 0)

    # 按机器聚合（含任务级明细）
    machines = {}
    for r in rows:
        mid = r["machine_id"]
        wm = _working_minutes(int(r["start_min"] or 0), int(r["end_min"] or 0))
        task_info = {
            "task_id": r["task_id"],
            "name": r["task_name"] or "",
            "start_min": int(r["start_min"] or 0),
            "end_min": int(r["end_min"] or 0),
            "working_min": wm,
            "status": r["schedule_status"] or "executing",
            "split_group": r["split_group"] or None,
        }
        if mid not in machines:
            machines[mid] = {
                "machine_name": r["machine_name"],
                "type": r["type"],
                "machine_status": r["machine_status"] or "空闲",
                "working_min": 0,
                "task_count": 0,
                "tasks": [],
            }
        machines[mid]["working_min"] += wm
        machines[mid]["task_count"] += 1
        machines[mid]["tasks"].append(task_info)

    # 查询本班次窗口内的维修记录
    import datetime as _dt
    machine_ids = list(machines.keys())
    repairs_by_machine = {}
    if machine_ids:
        # 构建班次绝对时间范围（从已解析的分钟数动态计算）
        base_dt = _dt.date.fromisoformat(date_str)
        s_val = s if s is not None else (1260 if key == "night_shift" else 540)
        shift_start_abs = _dt.datetime.fromisoformat(date_str + " 00:00:00") + _dt.timedelta(minutes=s_val)
        shift_end_abs = shift_start_abs + _dt.timedelta(minutes=max(raw_window, 1))

        ph = ",".join("?" * len(machine_ids))
        repair_rows = conn.execute(
            f"""SELECT machine_id, start_datetime, end_datetime
                FROM repair_log
                WHERE machine_id IN ({ph})
                  AND start_datetime < ?
                  AND (end_datetime > ? OR end_datetime IS NULL)""",
            machine_ids + [shift_end_abs.isoformat(), shift_start_abs.isoformat()],
        ).fetchall()
        for rr in repair_rows:
            mid = rr["machine_id"]
            rs_dt = _dt.datetime.fromisoformat(rr["start_datetime"])
            rs_min = (rs_dt - shift_start_abs).total_seconds() // 60
            if rr["end_datetime"]:
                re_dt = _dt.datetime.fromisoformat(rr["end_datetime"])
                re_min = (re_dt - shift_start_abs).total_seconds() // 60
            else:
                re_min = raw_window  # 进行中的维修，截止到班次窗口结束
            rs_min = max(int(rs_min), 0)
            re_min = min(int(re_min), raw_window)
            if re_min > rs_min:
                if mid not in repairs_by_machine:
                    repairs_by_machine[mid] = []
                repairs_by_machine[mid].append(
                    {"start_min": rs_min, "end_min": re_min}
                )

    result = []
    for mid_key, v in machines.items():
        result.append({
            "machine_name": v["machine_name"],
            "type": v["type"],
            "machine_status": v["machine_status"],
            "total_min": v["working_min"],
            "utilization_pct": round(v["working_min"] / available * 100, 1),
            "task_count": v["task_count"],
            "tasks": sorted(v["tasks"], key=lambda t: t["start_min"]),
            "repairs": repairs_by_machine.get(mid_key, []),
        })
    result.sort(key=lambda x: x["total_min"], reverse=True)
    return {"machines": result, "available": available}


# ⑦ 机器状态分布
def machine_status_distribution(conn):
    """机器状态分布（动态计算：有进行中排班→工作，维修停用保持，其余→空闲）。返回 dict"""
    # 基线归一化：非维修→空闲
    machines_rows = conn.execute(
        "SELECT id, type, status FROM machines"
    ).fetchall()
    status_map = {}
    for r in machines_rows:
        mid = int(r["id"])
        status_map[mid] = {
            "type": r["type"] or "未知",
            "status": "空闲" if r["status"] != "维修停用" else "维修停用",
        }

    # 有进行中排班的提升为"工作"
    now = datetime.datetime.now()
    schedules_rows = conn.execute(
        "SELECT machine_id, date, start_min, end_min FROM schedules WHERE status != 'completed'"
    ).fetchall()
    for s in schedules_rows:
        mid = int(s["machine_id"])
        if mid not in status_map or status_map[mid]["status"] == "维修停用":
            continue
        try:
            base_date = datetime.date.fromisoformat(s["date"])
            start_dt = datetime.datetime.combine(base_date, datetime.time.min) + datetime.timedelta(minutes=int(s["start_min"]))
            end_dt = datetime.datetime.combine(base_date, datetime.time.min) + datetime.timedelta(minutes=int(s["end_min"]))
        except (ValueError, TypeError):
            continue
        if start_dt <= now < end_dt:
            status_map[mid]["status"] = "工作"

    by_type = {}
    totals = {}
    for v in status_map.values():
        t = v["type"]
        s = v["status"]
        if t not in by_type:
            by_type[t] = {}
        by_type[t][s] = by_type[t].get(s, 0) + 1
        totals[s] = totals.get(s, 0) + 1
    return {"by_type": by_type, "total": totals}


# ⑧ 维修频率 & 时长
def repair_summary_data(conn, days=30, end_date=None):
    """维修频率 & 时长。返回 list[dict]，每台机器含每次维修的独立时长。"""
    from_date, to_date = _date_range(days, end_date)
    rows = conn.execute(
        """SELECT m.name, m.type, r.id as repair_id, r.start_datetime,
                  CASE WHEN r.end_datetime IS NOT NULL
                    THEN ROUND((julianday(r.end_datetime) - julianday(r.start_datetime)) * 1440)
                    ELSE ROUND((julianday('now') - julianday(r.start_datetime)) * 1440)
                  END as duration_min
           FROM repair_log r
           JOIN machines m ON r.machine_id=m.id
           WHERE r.start_datetime >= ? AND r.start_datetime <= ?
           ORDER BY m.name, r.start_datetime""",
        (from_date + " 00:00:00", to_date + " 23:59:59")
    ).fetchall()

    # 按机器分组
    machines = {}
    for r in rows:
        name = r["name"]
        if name not in machines:
            machines[name] = {"machine_name": name, "type": r["type"], "repairs": [], "total_duration_min": 0}
        dur = max(int(r["duration_min"] or 0), 1)
        machines[name]["repairs"].append(dur)
        machines[name]["total_duration_min"] += dur

    result = sorted(machines.values(), key=lambda x: x["total_duration_min"], reverse=True)
    return result


# ⑧-2 维修频率气泡图
def repair_frequency_data(conn, days=30, end_date=None):
    """维修频率气泡散点图。返回 {machines: [...], events: [...]}"""
    from_date, to_date = _date_range(days, end_date)
    rows = conn.execute(
        """SELECT m.name as machine_name, DATE(r.start_datetime) as date,
                  CASE WHEN r.end_datetime IS NOT NULL
                    THEN ROUND((julianday(r.end_datetime) - julianday(r.start_datetime)) * 1440)
                    ELSE ROUND((julianday('now') - julianday(r.start_datetime)) * 1440)
                  END as duration_min
           FROM repair_log r
           JOIN machines m ON r.machine_id=m.id
           WHERE r.start_datetime >= ? AND r.start_datetime <= ?
           ORDER BY r.start_datetime""",
        (from_date + " 00:00:00", to_date + " 23:59:59")
    ).fetchall()

    # 收集所有出现过的机器名（保持出现顺序）
    machine_order = []
    seen = set()
    for r in rows:
        if r["machine_name"] not in seen:
            machine_order.append(r["machine_name"])
            seen.add(r["machine_name"])

    events = []
    for r in rows:
        dur = max(int(r["duration_min"] or 0), 1)
        events.append({
            "date": r["date"],
            "machine_name": r["machine_name"],
            "duration_min": dur,
        })

    return {"machines": machine_order, "events": events}


# ⑩ 异常汇总
def exception_summary_data(conn, days=14, end_date=None):
    """异常汇总 → 总维修次数折线图。返回 list[dict]，每日维修次数。"""
    from_date, to_date = _date_range(days, end_date)

    rows = conn.execute(
        """SELECT DATE(start_datetime) as date, COUNT(*) as cnt
           FROM repair_log
           WHERE DATE(start_datetime) >= ? AND DATE(start_datetime) <= ?
           GROUP BY DATE(start_datetime)
           ORDER BY date""",
        (from_date, to_date)
    ).fetchall()

    return [{"date": r["date"], "count": r["cnt"]} for r in rows]


# ⑪ 过时任务清单
def overdue_tasks_data(conn):
    """过时任务清单。返回 list[dict]"""
    now = datetime.datetime.now()
    rows = conn.execute(
        """SELECT s.task_name, s.machine_name, s.date, s.start_min, s.end_min, s.status
           FROM schedules s
           WHERE s.status != 'completed'
           ORDER BY s.date, s.start_min"""
    ).fetchall()
    result = []
    for r in rows:
        try:
            base = datetime.datetime.combine(
                datetime.date.fromisoformat(r["date"]), datetime.time.min
            )
            end_dt = base + datetime.timedelta(minutes=int(r["end_min"]))
            if end_dt < now:
                overdue_sec = (now - end_dt).total_seconds()
                result.append({
                    "task_name": r["task_name"],
                    "machine_name": r["machine_name"],
                    "date": r["date"],
                    "end_str": end_dt.strftime("%H:%M"),
                    "overdue_min": int(overdue_sec // 60),
                    "status": r["status"],
                })
        except Exception:
            pass
    result.sort(key=lambda x: x["overdue_min"], reverse=True)
    return result


# ⑫ 跨天任务一览
def cross_day_tasks_data(conn, days=7, end_date=None):
    """跨天任务一览。返回 list[dict]"""
    from_date, to_date = _date_range(days, end_date)
    rows = conn.execute(
        """SELECT task_name, machine_name, date, start_min, end_min
           FROM schedules
           WHERE date >= ? AND date <= ? AND end_min > 1440
           ORDER BY date, start_min""",
        (from_date, to_date)
    ).fetchall()
    result = []
    for r in rows:
        span = int(r["end_min"]) // 1440
        base = datetime.date.fromisoformat(r["date"])
        start_dt = datetime.datetime.combine(base, datetime.time.min) + datetime.timedelta(minutes=int(r["start_min"]))
        end_dt = datetime.datetime.combine(base, datetime.time.min) + datetime.timedelta(minutes=int(r["end_min"]))
        result.append({
            "task_name": r["task_name"],
            "machine_name": r["machine_name"],
            "date": r["date"],
            "start_str": start_dt.strftime("%m/%d %H:%M"),
            "end_str": end_dt.strftime("%m/%d %H:%M"),
            "span_days": span,
        })
    return result


# ⑬ 提前/延迟模式
def time_deviation_data(conn, days=14, end_date=None):
    """提前/延迟模式。返回 dict"""
    from_date, to_date = _date_range(days, end_date)
    rows = conn.execute(
        """SELECT task_name, machine_name, start_min, end_min,
                  actual_start_min, actual_end_min
           FROM schedules
           WHERE date >= ? AND date <= ? AND status='completed'
             AND actual_start_min IS NOT NULL AND actual_end_min IS NOT NULL""",
        (from_date, to_date)
    ).fetchall()
    start_deltas = []
    end_deltas = []
    for r in rows:
        start_deltas.append({
            "task_name": r["task_name"],
            "machine_name": r["machine_name"],
            "delta": int(r["actual_start_min"]) - int(r["start_min"]),
        })
        end_deltas.append({
            "task_name": r["task_name"],
            "machine_name": r["machine_name"],
            "delta": int(r["actual_end_min"]) - int(r["end_min"]),
        })
    avg_start = round(sum(d["delta"] for d in start_deltas) / len(start_deltas), 1) if start_deltas else 0
    avg_end = round(sum(d["delta"] for d in end_deltas) / len(end_deltas), 1) if end_deltas else 0
    return {
        "start_deviations": start_deltas,
        "end_deviations": end_deltas,
        "avg_start_delta": avg_start,
        "avg_end_delta": avg_end,
    }


# ⑱ 推送事件统计（跟报告日期联动，散点图展示当天推送时间分布）

EVENT_TYPE_LABELS = {
    "task_confirm_start":    "任务确认开始",
    "task_confirm_end":      "任务确认完成",
    "task_impending_start":  "任务即将开始",
    "task_impending_end":    "任务即将结束",
    "task_start":            "任务开始",
    "task_end":              "任务结束",
    "task_recycled":         "任务回收",
    "exception_start":       "异常开始",
    "exception_end":         "异常结束",
    "exception_update":      "异常更新",
    "package_complete":      "任务包完成",
    "schedule_changes":      "排班变更",
    "shift_report":          "班次报告",
    "time_change_baseline":  "时间基线变更",
}


def push_stats_data(conn, date_str, shift=None):
    """推送事件统计。返回散点图所需的事件级数据 + 汇总。
    shift 为班次名（白班/夜班），用于按班次时间段过滤推送事件。"""
    import datetime as _dt

    # 读取班次时间配置
    shift_rows = conn.execute(
        "SELECT key, start FROM shift_config WHERE key IN ('day_shift', 'night_shift')"
    ).fetchall()
    _ds = _ns = None
    for r in shift_rows:
        t = _parse_minutes(r["start"])
        if r["key"] == "day_shift":
            _ds = t
        elif r["key"] == "night_shift":
            _ns = t
    day_start = _ds if _ds is not None else 540
    night_start = _ns if _ns is not None else 1260

    if shift == "夜班":
        tomorrow_str = (_dt.date.fromisoformat(date_str) + _dt.timedelta(days=1)).strftime("%Y-%m-%d")
        # 当天 night_start~24:00 + 次日 00:00~day_start
        where = (
            "(substr(sent_at, 1, 10) = ? AND CAST(substr(sent_at, 12, 2) AS INTEGER)*60 + CAST(substr(sent_at, 15, 2) AS INTEGER) >= ?) OR "
            "(substr(sent_at, 1, 10) = ? AND CAST(substr(sent_at, 12, 2) AS INTEGER)*60 + CAST(substr(sent_at, 15, 2) AS INTEGER) < ?)"
        )
        params = (date_str, night_start, tomorrow_str, day_start)
    else:
        # 白班：当天 day_start ~ night_start
        where = (
            "substr(sent_at, 1, 10) = ? AND "
            "CAST(substr(sent_at, 12, 2) AS INTEGER)*60 + CAST(substr(sent_at, 15, 2) AS INTEGER) >= ? AND "
            "CAST(substr(sent_at, 12, 2) AS INTEGER)*60 + CAST(substr(sent_at, 15, 2) AS INTEGER) < ?"
        )
        params = (date_str, day_start, night_start)

    # 单条事件（散点图用）
    event_rows = conn.execute(
        f"""SELECT substr(sent_at, 12, 8) as time_str, event_type, success,
                  CAST(substr(sent_at, 12, 2) AS INTEGER) * 60 +
                  CAST(substr(sent_at, 15, 2) AS INTEGER) as minute_of_day
           FROM push_log
           WHERE {where}
           ORDER BY sent_at""",
        params
    ).fetchall()

    events = []
    # 按中文标签字母序分配 y 行号，保证可读
    seen_types = set()
    for r in event_rows:
        seen_types.add(r["event_type"])
    sorted_types = sorted(seen_types, key=lambda et: EVENT_TYPE_LABELS.get(et, et))
    type_y = {et: i for i, et in enumerate(sorted_types)}

    # X 轴范围 & 分钟偏移（夜班需要把今天凌晨的事件 +1440 以形成连续时间轴）
    x_min = day_start
    x_max = night_start
    if shift == "夜班":
        x_min = night_start
        x_max = 1440 + day_start
        events = [{
            "time": r["time_str"],
            "minute": r["minute_of_day"] + (1440 if r["minute_of_day"] < day_start else 0),
            "event_type": EVENT_TYPE_LABELS.get(r["event_type"], r["event_type"]),
            "y_row": type_y[r["event_type"]],
            "success": bool(r["success"]),
        } for r in event_rows]
    else:
        events = [{
            "time": r["time_str"],
            "minute": r["minute_of_day"],
            "event_type": EVENT_TYPE_LABELS.get(r["event_type"], r["event_type"]),
            "y_row": type_y[r["event_type"]],
            "success": bool(r["success"]),
        } for r in event_rows]

    # by_type 汇总
    by_type = {}
    for et, y in type_y.items():
        label = EVENT_TYPE_LABELS.get(et, et)
        by_type[label] = {
            "y_row": y,
            "total": sum(1 for e in events if e["event_type"] == label),
            "success": sum(1 for e in events if e["event_type"] == label and e["success"]),
        }

    total_all = len(events)
    total_success = sum(1 for e in events if e["success"])

    return {
        "date": date_str,
        "shift": shift or "白班",
        "x_min": x_min,
        "x_max": x_max,
        "events": events,
        "type_list": [EVENT_TYPE_LABELS.get(et, et) for et in sorted_types],
        "by_type": by_type,
        "success_rate": round(total_success / total_all, 3) if total_all > 0 else 0,
        "total": total_all,
    }


# Widget 注册表：函数名 → 函数引用，供 API 层按名调用
WIDGET_REGISTRY = {
    "shift_report": shift_report_data,
    "daily_trend": daily_trend_data,
    "estimate_vs_actual": estimate_vs_actual_data,
    "completion_heatmap": completion_heatmap_data,
    "machine_utilization": machine_utilization_data,
    "machine_status": machine_status_distribution,
    "repair_summary": repair_summary_data,
    "repair_frequency": repair_frequency_data,
    "exception_summary": exception_summary_data,
    "overdue_tasks": overdue_tasks_data,
    "time_deviation": time_deviation_data,
    "push_stats": push_stats_data,
}
