import datetime
import re
import sqlite3
from typing import Optional


def today() -> datetime.date:
    """统一获取当天日期——跨天相关逻辑统一入口，方便审计和排查。"""
    return datetime.date.today()


def parse_date(s: Optional[str]) -> str:
    if not s:
        return today().isoformat()
    try:
        return datetime.date.fromisoformat(s).isoformat()
    except ValueError:
        return today().isoformat()


def find_best_default_date() -> str:
    """默认日期：当天有排班 → 当天；否则 → 最近有排班的日期；都没有 → 今天。"""
    try:
        from db import get_db
        conn = get_db()
        today_str = today().isoformat()
        # 当天有排班：直接返回当天
        has_today = conn.execute(
            "SELECT 1 FROM schedules WHERE date = ? LIMIT 1",
            (today_str,)
        ).fetchone()
        if has_today:
            conn.close()
            return today_str
        # 当天无排班：找最近有排班的日期
        row = conn.execute(
            "SELECT date FROM schedules WHERE date >= ? ORDER BY date ASC LIMIT 1",
            (today_str,)
        ).fetchone()
        if row:
            conn.close()
            return row["date"]
        row = conn.execute(
            "SELECT date FROM schedules WHERE date < ? ORDER BY date DESC LIMIT 1",
            (today_str,)
        ).fetchone()
        conn.close()
        if row:
            return row["date"]
    except Exception:
        pass
    return today()


def parse_duration_to_minutes(duration: Optional[str], default_minutes: int = 120) -> int:
    if not duration:
        return default_minutes
    s = str(duration).strip().lower()
    m = re.match(r"^\s*(\d+(?:\.\d+)?)\s*h\s*$", s)
    if m:
        return max(1, int(float(m.group(1)) * 60))
    m = re.match(r"^\s*(\d+)\s*m(in)?\s*$", s)
    if m:
        return max(1, int(m.group(1)))
    m = re.match(r"^\s*(\d+(?:\.\d+)?)\s*小时\s*$", s)
    if m:
        return max(1, int(float(m.group(1)) * 60))
    m = re.match(r"^\s*(\d+)\s*分钟\s*$", s)
    if m:
        return max(1, int(m.group(1)))
    return default_minutes


def min_to_hhmm(m: int) -> str:
    m = max(0, min(28 * 1440, int(m)))
    hh = m // 60
    mm = m % 60
    return f"{hh:02d}:{mm:02d}"


def abs_min_to_label(m: int) -> str:
    """
    把"相对选中日期 00:00 的绝对分钟"格式化为 HH:MM 或 HH:MM(±n)。
    0-1439 => 当日；1440- => (+n)；负数 => (-n)
    """
    mm = int(m)
    day_off = 0
    if mm < 0:
        # 例如 -1 => (-1) 的 23:59
        day_off = -((abs(mm) - 1) // (24 * 60) + 1)
        mm = mm - day_off * (24 * 60)
    elif mm >= 24 * 60:
        day_off = mm // (24 * 60)
        mm = mm % (24 * 60)
    hh = mm // 60
    mi = mm % 60
    base = f"{hh:02d}:{mi:02d}"
    if day_off == 0:
        return base
    sign = "+" if day_off > 0 else ""
    return f"{base}({sign}{day_off})"


def abs_min_to_datetime(abs_min: int, base_date_str: str) -> str:
    """绝对分钟 → MM-DD HH:MM"""
    mm = int(abs_min)
    day_off = mm // (24 * 60)
    minute = mm % (24 * 60)
    base = datetime.date.fromisoformat(base_date_str)
    actual = base + datetime.timedelta(days=day_off)
    hh = minute // 60
    mi = minute % 60
    return f"{actual.month:02d}-{actual.day:02d} {hh:02d}:{mi:02d}"


def format_abs_range(abs_start: int, abs_end: int, base_date_str: str) -> str:
    """绝对分钟范围 → 可读时间区间。同天 HH:MM~HH:MM，跨天 MM-DD HH:MM~MM-DD HH:MM"""
    s_day = int(abs_start) // (24 * 60)
    e_day = int(abs_end) // (24 * 60)
    if s_day == e_day:
        return f"{abs_min_to_label(abs_start)}~{abs_min_to_label(abs_end)}"
    return f"{abs_min_to_datetime(abs_start, base_date_str)}~{abs_min_to_datetime(abs_end, base_date_str)}"


def normalize_machine_schedule(conn: sqlite3.Connection, date: str, machine_id: int, _depth: int = 0):
    """
    同一机器按日期级联归一化：按开始时间排序，确保不重叠；发生重叠时将后续任务顺延。
    感知所有之前日期跨午夜的任务（end_min > day_diff * 1440），当前日期有跨越时自动级联到次日。
    """
    if _depth > 10:
        return
    # 检查所有之前日期中 end_min 延伸到当天的任务，取最大重叠量作为 prev_end 起点
    prev_rows = conn.execute(
        "SELECT date, end_min FROM schedules WHERE machine_id=? AND end_min > 1440 AND date < ?",
        (machine_id, date),
    ).fetchall()
    prev_end = 0
    cur_dt = datetime.date.fromisoformat(date)
    for pr in prev_rows:
        pr_date = pr["date"]
        pr_end = int(pr["end_min"])
        day_diff = (cur_dt - datetime.date.fromisoformat(pr_date)).days
        overlap = pr_end - day_diff * 1440
        if overlap > 0:
            prev_end = max(prev_end, overlap)

    rows = conn.execute(
        """
        SELECT id, start_min, end_min
        FROM schedules
        WHERE date=? AND machine_id=?
        ORDER BY start_min ASC, id ASC
        """,
        (date, machine_id),
    ).fetchall()
    for r in rows:
        sid = int(r["id"])
        start_min = int(r["start_min"])
        end_min = int(r["end_min"])
        dur = max(1, end_min - start_min)
        if start_min < prev_end:
            start_min = prev_end
            end_min = min(28 * 1440, start_min + dur)
            conn.execute(
                "UPDATE schedules SET start_min=?, end_min=? WHERE id=?",
                (start_min, end_min, sid),
            )
        prev_end = max(prev_end, end_min)
        if prev_end >= 28 * 1440:
            break

    if prev_end > 1440:
        next_dt = cur_dt + datetime.timedelta(days=1)
        normalize_machine_schedule(conn, next_dt.isoformat(), machine_id, _depth + 1)


def compact_machine_tasks(conn, machine_id, date, hole_start_min, hole_end_min=0,
                          gap_minutes=0, avoid_break_start=False, avoid_break_end=False,
                          extend_over_breaks=True, now_min=None):
    """回收后压实：将空洞之后的未完成任务逐任务前移。
    如果 now_min 不为 None，光标从 max(hole_start_min, now_min) 开始，防止压到过去。
    返回 shifted 数量。调用方负责 commit。"""
    effective_start = hole_start_min
    if now_min is not None and now_min > effective_start:
        effective_start = now_min

    # 压实起点之后有已完成任务 → 受阻，不压实
    has_completed = conn.execute(
        """SELECT COUNT(*) as cnt FROM schedules
           WHERE date=? AND machine_id=? AND status='completed'
           AND start_min >= ?""",
        (date, machine_id, effective_start),
    ).fetchone()
    if has_completed and has_completed["cnt"] > 0:
        return 0

    rows = conn.execute(
        """SELECT id, start_min, end_min FROM schedules
           WHERE date=? AND machine_id=? AND status!='completed'
           AND start_min >= ?
           ORDER BY start_min ASC""",
        (date, machine_id, effective_start),
    ).fetchall()
    if not rows:
        return 0

    from models import load_shift_config
    from auto_assign import _extend_end_over_breaks

    need_avoid = avoid_break_start or avoid_break_end
    shift_config = None
    if extend_over_breaks or need_avoid:
        shift_config = load_shift_config()

    breaks = []
    if need_avoid and shift_config:
        for a, b in shift_config.get("day_shift", {}).get("breaks", []):
            breaks.append((a, b))
        for a, b in shift_config.get("night_shift", {}).get("breaks", []):
            breaks.append((a, b))
        breaks.sort()

    def _adjust_start_over_breaks(desired_start, breaks_list, cursor):
        for bs, be in breaks_list:
            if bs <= desired_start < be:
                desired_start = be
        return max(cursor, desired_start)

    shifted = 0
    cursor = effective_start

    for r in rows:
        sid = int(r["id"])
        orig_start = int(r["start_min"])
        orig_end = int(r["end_min"])
        dur = max(1, orig_end - orig_start)

        desired_start = cursor + gap_minutes

        if avoid_break_start and breaks:
            desired_start = _adjust_start_over_breaks(desired_start, breaks, cursor)

        if avoid_break_end and breaks:
            for _ in range(len(breaks) + 1):
                end_candidate = desired_start + dur
                pushed = False
                for bs, be in breaks:
                    if bs < end_candidate <= be:
                        desired_start = be
                        pushed = True
                        break
                if not pushed:
                    break
            if avoid_break_start and breaks:
                desired_start = _adjust_start_over_breaks(desired_start, breaks, cursor)

        if desired_start >= orig_start:
            cursor = orig_end + gap_minutes
            continue

        end_min = desired_start + dur
        if extend_over_breaks and shift_config:
            end_min = _extend_end_over_breaks(desired_start, end_min, date, shift_config)

        conn.execute(
            "UPDATE schedules SET start_min=?, end_min=? WHERE id=?",
            (desired_start, end_min, sid),
        )
        cursor = end_min + gap_minutes
        shifted += 1

    normalize_machine_schedule(conn, date, machine_id)
    return shifted


def schedule_to_datetime(schedule_row, min_field):
    """将 schedule 的 date + start_min / end_min 转为真实的 datetime 对象。
    处理跨午夜：end_min 可能超过 1440，按天偏移。
    """
    base = datetime.date.fromisoformat(schedule_row["date"])
    minutes = int(schedule_row[min_field])
    days = minutes // 1440
    remainder = minutes % 1440
    return datetime.datetime.combine(base, datetime.time(0, 0)) + datetime.timedelta(days=days, minutes=remainder)


def auto_extend_tasks_after_repair(conn, machine_id, repair_start_dt, repair_end_dt):
    """维修结束后自动延长受影响的任务，并级联后移后续任务避免重叠。
    返回 (extended_count, total_minutes)。
    受排班面板设置"维修后自动延长任务"开关控制。
    """
    config_row = conn.execute(
        "SELECT value FROM config WHERE category='schedule_settings' AND key='auto_extend_after_repair'"
    ).fetchone()
    if config_row and config_row["value"] == "0":
        return 0, 0

    # 按开始时间排序，保证级联后移的顺序正确
    tasks = conn.execute(
        "SELECT id, date, start_min, end_min FROM schedules"
        " WHERE machine_id=? AND status='executing'"
        " ORDER BY start_min",
        (machine_id,),
    ).fetchall()

    extended = 0
    total_minutes = 0
    shift_minutes = 0  # 累积偏移量：前面的任务延长了多久，后面的就要后移多久

    for task in tasks:
        tid = task["id"]
        # 应用累积偏移
        cur_start = task["start_min"] + shift_minutes
        cur_end = task["end_min"] + shift_minutes

        task_start = schedule_to_datetime(task, "start_min") + datetime.timedelta(minutes=shift_minutes)
        task_end = schedule_to_datetime(task, "end_min") + datetime.timedelta(minutes=shift_minutes)

        overlap_start = max(task_start, repair_start_dt)
        overlap_end = min(task_end, repair_end_dt)
        overlap_seconds = int((overlap_end - overlap_start).total_seconds())
        if overlap_seconds > 0:
            overlap_minutes = max(1, (overlap_seconds + 59) // 60)
            new_end = task_end + datetime.timedelta(minutes=overlap_minutes)

            # 转换回绝对分钟（允许跨天 >1440）
            new_end_date = new_end.date()
            base_date = datetime.date.fromisoformat(task["date"])
            day_offset = (new_end_date - base_date).days
            minute_of_day = new_end.hour * 60 + new_end.minute
            new_end_min = day_offset * 1440 + minute_of_day

            conn.execute(
                "UPDATE schedules SET end_min=? WHERE id=?",
                (new_end_min, tid),
            )
            # 如果该任务被前面的扩展后移过，同步更新其 start_min
            if shift_minutes > 0:
                conn.execute(
                    "UPDATE schedules SET start_min=? WHERE id=?",
                    (cur_start, tid),
                )
            extended += 1
            total_minutes += overlap_minutes
            shift_minutes += overlap_minutes
        elif shift_minutes > 0:
            # 没有与维修重叠，但被前面的扩展推后了
            conn.execute(
                "UPDATE schedules SET start_min=?, end_min=? WHERE id=?",
                (cur_start, cur_end, tid),
            )

    return extended, total_minutes


def start_repair(conn, machine_id: int) -> dict:
    """开始维修，写入 repair_log。返回 repair_info dict。
    调用方负责 conn.commit() 和预先更新 machines.status。
    """
    now = datetime.datetime.now()
    conn.execute(
        "INSERT INTO repair_log (machine_id, start_datetime, created_at) VALUES (?, ?, ?)",
        (machine_id, now.isoformat(timespec="seconds"), now.isoformat(timespec="seconds")),
    )
    repair_id = conn.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]
    return {
        "action": "repair_start",
        "repair_id": repair_id,
        "start_datetime": now.isoformat(timespec="seconds"),
    }


def end_repair(conn, machine_id: int) -> dict:
    """结束维修，关闭 repair_log 并自动延长受影响的任务。
    返回 repair_info dict。
    调用方负责 conn.commit() 和预先更新 machines.status。
    """
    open_repair = conn.execute(
        "SELECT id, start_datetime FROM repair_log WHERE machine_id=? AND end_datetime IS NULL ORDER BY id DESC LIMIT 1",
        (machine_id,),
    ).fetchone()
    if not open_repair:
        return {"action": "repair_end_no_start", "msg": "维修无开始时间，本次不记录"}

    now = datetime.datetime.now()
    conn.execute(
        "UPDATE repair_log SET end_datetime=? WHERE id=?",
        (now.isoformat(timespec="seconds"), int(open_repair["id"])),
    )
    start_dt = datetime.datetime.fromisoformat(open_repair["start_datetime"])
    duration_seconds = (now - start_dt).total_seconds()
    import math
    duration_minutes = max(1, math.ceil(duration_seconds / 60)) if duration_seconds > 0 else 0
    duration_str = format_elapsed(duration_minutes)

    repair_info = {
        "action": "repair_end",
        "repair_id": int(open_repair["id"]),
        "start_datetime": open_repair["start_datetime"],
        "end_datetime": now.isoformat(timespec="seconds"),
        "duration": duration_str,
    }

    extended, total_minutes = auto_extend_tasks_after_repair(conn, machine_id, start_dt, now)
    if extended > 0:
        repair_info["auto_extended"] = {"tasks": extended, "total_minutes": total_minutes}

    return repair_info


def parse_hhmm(s: str) -> int:
    """ "08:00" → 480。兼容中文冒号"""
    s = str(s).replace('：', ':')
    m = re.match(r"^(\d{1,2}):(\d{2})$", s.strip())
    if not m:
        return 0
    return int(m.group(1)) * 60 + int(m.group(2))


def parse_time_range_list(s: str):
    """ "20:00-24:00,08:00-12:00" → [(1200,1440),(480,720)]。兼容中文标点"""
    s = str(s).replace('：', ':').replace('，', ',').replace('、', ',').replace('。', ',')
    out = []
    for part in str(s).split(","):
        part = part.strip()
        if not part:
            continue
        m = re.match(r"^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2}|24:00)$", part)
        if not m:
            continue
        a = parse_hhmm(m.group(1))
        b = 1440 if m.group(2) == "24:00" else parse_hhmm(m.group(2))
        out.append((a, b))
    return out


def parse_break_list(s: str):
    """解析休息段字符串 → [(start_min, end_min), ...]。兼容中文标点"""
    out = []
    raw = str(s or "").strip()
    raw = raw.replace('：', ':').replace('，', ',').replace('、', ',').replace('。', ',')
    if not raw:
        return out
    for part in re.split(r"[,，;；]+", raw):
        part = part.strip()
        if not part:
            continue
        # 格式1: start/duration（如 12:00/30）
        m = re.match(r"^(\d{1,2}:\d{2})\s*/\s*(\d+)$", part)
        if m:
            st = parse_hhmm(m.group(1))
            dur = max(1, int(m.group(2)) or 0)
            out.append((st, min(st + dur, 1440)))
            continue
        # 格式2: start-end（如 12:00-12:30 或 12:00/12:30）
        m = re.match(r"^(\d{1,2}:\d{2})\s*[-\/]\s*(\d{1,2}:\d{2}|24:00)$", part)
        if m:
            st = parse_hhmm(m.group(1))
            ed = 1440 if m.group(2) == "24:00" else parse_hhmm(m.group(2))
            if ed <= st:
                ed += 1440
            out.append((st, min(ed, 40320)))
    return out


def calc_working_minutes(start_min: int, end_min: int, base_date: str,
                         shift_config: dict) -> int:
    """任务在班次工作期间内的实际分钟数（扣除休息段）"""
    # 跨午夜归一化：DB 中 end_min 可能不带 day offset（如 1380→70）
    if end_min <= start_min:
        end_min += 1440

    # 班次数据已由 load_shift_config 预解析
    day_s = parse_hhmm(shift_config["day_shift"]["start"])
    day_e = parse_hhmm(shift_config["day_shift"]["end"])
    day_ot = shift_config["day_shift"]["overtime"]
    day_breaks = shift_config["day_shift"].get("breaks", [])

    night_s = parse_hhmm(shift_config["night_shift"]["start"])
    night_e = parse_hhmm(shift_config["night_shift"]["end"])
    night_crosses = night_e <= night_s
    night_ot = shift_config["night_shift"]["overtime"]
    night_breaks = shift_config["night_shift"].get("breaks", [])

    start_day = start_min // 1440
    end_day = (end_min - 1) // 1440

    work_intervals = []
    break_intervals = []
    for d in range(start_day - 1, end_day + 1):
        base = d * 1440
        # 白班工作区间
        work_intervals.append((base + day_s, base + day_e))
        for a, b in day_ot:
            work_intervals.append((base + a, base + b))
        # 白班休息区间
        for a, b in day_breaks:
            break_intervals.append((base + a, base + b))
        # 夜班工作区间
        ns = base + night_s
        ne = base + night_e
        if night_crosses:
            ne += 1440
        work_intervals.append((ns, ne))
        # 夜班加班
        for a, b in night_ot:
            oa = base + a
            ob = base + b
            if night_crosses and a < night_s:
                oa += 1440
                ob += 1440
            if ob <= oa:
                ob += 1440
            work_intervals.append((oa, ob))
        # 夜班休息区间
        for a, b in night_breaks:
            ba = base + a
            bb = base + b
            if night_crosses and a < night_s:
                ba += 1440
                bb += 1440
            if bb <= ba:
                bb += 1440
            break_intervals.append((ba, bb))

    # 合并工作区间
    work_intervals.sort()
    merged_work = []
    for a, b in work_intervals:
        if merged_work and a <= merged_work[-1][1]:
            merged_work[-1] = (merged_work[-1][0], max(merged_work[-1][1], b))
        else:
            merged_work.append((a, b))

    # 合并休息区间
    break_intervals.sort()
    merged_break = []
    for a, b in break_intervals:
        if merged_break and a <= merged_break[-1][1]:
            merged_break[-1] = (merged_break[-1][0], max(merged_break[-1][1], b))
        else:
            merged_break.append((a, b))

    # 计算总工作时间（工作区间 ∩ 任务区间）
    total = 0
    for a, b in merged_work:
        lo = max(a, start_min)
        hi = min(b, end_min)
        if hi > lo:
            total += hi - lo

    # 扣除休息时间（休息区间 ∩ 任务区间）
    for a, b in merged_break:
        lo = max(a, start_min)
        hi = min(b, end_min)
        if hi > lo:
            total -= hi - lo

    return max(0, total)


def format_elapsed(minutes: int) -> str:
    """分钟 → 可读耗时：720→"12h", 90→"1h30m", 30→"30m" """
    m = max(0, minutes)
    if m == 0:
        return "0m"
    h = m // 60
    r = m % 60
    if h == 0:
        return f"{r}m"
    if r == 0:
        return f"{h}h"
    return f"{h}h{r}m"


def datetime_to_abs_min(dt: datetime.datetime, base_date_str: str) -> int:
    """将 Python datetime 转换为相对 base_date 的绝对分钟（day_off * 1440 + minute_of_day）"""
    base_date = datetime.date.fromisoformat(base_date_str)
    day_off = (dt.date() - base_date).days
    return day_off * 1440 + dt.hour * 60 + dt.minute


def compute_repair_overlap(sched_start: int, sched_end: int,
                           repair_start: int, repair_end: int):
    """返回 (overlap_start, overlap_end) 或 None（无重叠）"""
    overlap_start = max(sched_start, repair_start)
    overlap_end = min(sched_end, repair_end)
    if overlap_end > overlap_start:
        return (overlap_start, overlap_end)
    return None


# ====================== 任务时长自动推算 ======================

# 关键词系数：值 < 1.0 表示简单位移，> 1.0 表示精细/费力操作
# 排在前面的优先匹配（长关键词优先，避免 "放" 误匹配 "放入"）
_KEYWORD_COEFFICIENTS = [
    # 1.4 — 精细/费力操作
    (1.4, ["插入", "挤出", "挤压", "拧紧", "摇晃", "晃动", "翻转", "整理"]),
    # 1.0 — 普通操作（基准）
    (1.0, ["放入", "放进", "放到", "放中间", "抽出", "倒出", "打开", "合上",
           "推出", "推回", "拿起", "轻推", "挤出一点", "朝下", "朝上", "瓶口",
           "叠", "盖上"]),
    # 0.75 — 简单位移
    (0.75, ["并排", "紧贴", "移到", "推向", "横放", "右移", "左移",
            "推到", "移药品", "放在", "立", "向右", "向左"]),
]


def _get_rate_per_shift(default: int = 150) -> int:
    """从 config 表读取每班次采集条数，读取失败返回默认值。"""
    try:
        from db import get_db
        conn = get_db()
        row = conn.execute(
            "SELECT value FROM config WHERE category='schedule_settings' AND key='rate_per_shift'"
        ).fetchone()
        conn.close()
        if row and row["value"]:
            return max(100, int(row["value"]))
    except Exception:
        pass
    return default


def estimate_duration_from_name(name: str, count: int = 25,
                                rate_per_shift: int = None) -> int:
    """根据任务名称和条数推算预估时长（分钟）。

    formula: count * (420 / rate_per_shift) * coefficient

    - 420 = 白班有效工作分钟（扣除休息）
    - rate_per_shift = 每台机器每班次采集条数（默认 150，可从设置页调整）
    - coefficient = 名称关键词系数
    """
    if not name or not str(name).strip():
        return count

    name_str = str(name).strip()
    count = max(1, int(count)) if count else 25

    max_coef = 0.0
    complex_kw_matched = set()
    for coef, keywords in _KEYWORD_COEFFICIENTS:
        for kw in keywords:
            if kw in name_str:
                if coef > max_coef:
                    max_coef = coef
                if coef >= 1.4:
                    complex_kw_matched.add(kw)

    if max_coef == 0.0:
        max_coef = 1.0

    if len(complex_kw_matched) >= 2:
        max_coef = 1.8

    if rate_per_shift is None:
        rate_per_shift = _get_rate_per_shift()

    effective_minutes = 420
    per_item_min = effective_minutes / max(1, rate_per_shift)
    base_min = count * per_item_min

    result = round(base_min * max_coef)
    return max(1, result)


def estimate_difficulty_from_name(name: str) -> str:
    """根据名称关键词推断难度等级。"""
    if not name or not str(name).strip():
        return ""
    name_str = str(name).strip()

    max_coef = 0.0
    complex_count = 0
    for coef, keywords in _KEYWORD_COEFFICIENTS:
        for kw in keywords:
            if kw in name_str:
                if coef > max_coef:
                    max_coef = coef
                if coef >= 1.4:
                    complex_count += 1

    if complex_count >= 2 or max_coef >= 1.4:
        return "困难"
    elif max_coef >= 1.0:
        return "普通"
    elif max_coef >= 0.75:
        return "简单"
    return ""


# ====================== 通用工具函数 ======================

def num_to_cn(n: int) -> str:
    """数字 → 中文序数：1→一, 10→十"""
    cn = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"]
    if 1 <= n <= 10:
        return cn[n - 1]
    return str(n)


def machine_full_name(name: str, mtype: str, task_kind: str) -> str:
    """统一机器全名格式：名称(机型/任务类型)"""
    return f"{name}({mtype}/{task_kind})"


def px_to_abs_min(left_px: float, hour_col_width: int = 80) -> int:
    """像素偏移 → 绝对分钟"""
    return int(round((left_px / hour_col_width) * 60))


def format_datetime_label(dt: "datetime.datetime") -> str:
    """datetime → MM-DD HH:MM 紧凑标签"""
    return f"{dt.month:02d}-{dt.day:02d} {dt.hour:02d}:{dt.minute:02d}"


def overlap_minutes(a_start: "datetime.datetime", a_end: "datetime.datetime",
                    b_start: "datetime.datetime", b_end: "datetime.datetime | None") -> int:
    """两个时间区间的重叠分钟数。b_end 为 None 表示 b 持续至今。
    不足1分钟按1分钟计，确保极短维修也能体现在统计中。"""
    import datetime as _dt
    import math
    o_start = max(a_start, b_start)
    o_end = min(a_end, b_end) if b_end is not None else min(a_end, _dt.datetime.now())
    seconds = (o_end - o_start).total_seconds()
    if seconds <= 0:
        return 0
    return max(1, math.ceil(seconds / 60))
