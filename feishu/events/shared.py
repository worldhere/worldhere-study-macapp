# -*- coding: utf-8 -*-
"""飞书事件检测共享模块：工具函数、常量、检测上下文"""
import json
import datetime
import re
from db import get_db

IMPENDING_MINUTES = 15  # "即将开始/结束"提前量（分钟）
MIN_DETECT_INTERVAL_SEC = 60  # 两次检测最小间隔（秒）
_last_detect_at = 0
CARD_COLORS = {
    "reminder": "blue",
    "announcement": "green",
    "changes": "orange",
    "exception": "red",
    "report": "purple",
}


class DetectContext:
    """飞书检测器的只读上下文，避免每个检测器传 8 个参数"""
    def __init__(self, conn, now, now_min, today_str,
                 current_shift, day_oe, night_oe, day_start, night_start,
                 record_to_sid, sch_map, snapshot):
        self.conn = conn
        self.now = now
        self.now_min = now_min
        self.today_str = today_str
        self.current_shift = current_shift
        self.day_oe = day_oe
        self.night_oe = night_oe
        self.day_start = day_start
        self.night_start = night_start
        self.record_to_sid = record_to_sid
        self.sch_map = sch_map
        self.snapshot = snapshot


def _parse_minutes(t_str):
    """'HH:MM' -> 绝对分钟数"""
    if not t_str:
        return None
    try:
        parts = str(t_str).strip().replace('：', ':').split(":")
        return int(parts[0]) * 60 + int(parts[1])
    except Exception:
        return None


def _parse_overtime_latest_end(overtime_str):
    """解析 overtime 字符串如 '19:00-21:00,06:30-08:30'，返回最晚结束分钟数"""
    if not overtime_str:
        return None
    max_end = 0
    normalized = str(overtime_str).replace('：', ':').replace('－', '-')
    for part in re.split(r"[,，]+", normalized):
        m = re.match(r"(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})", part.strip())
        if m:
            end = _parse_minutes(m.group(2))
            if end is not None:
                max_end = max(max_end, end)
    return max_end if max_end > 0 else None


def _get_shift_context(conn=None):
    """读取班次配置，返回 (current_shift, day_overtime_end, night_overtime_end, day_start, night_start)
    current_shift: 'day' | 'night' | None"""
    if conn is None:
        conn = get_db()
        own_conn = True
    else:
        own_conn = False
    shift_rows = conn.execute(
        "SELECT key, start, overtime FROM shift_config"
    ).fetchall()
    day_start = night_start = None
    day_overtime_end = 1260   # 默认 21:00
    night_overtime_end = 510  # 默认 08:30
    for r in shift_rows:
        t = _parse_minutes(r["start"])
        oe = _parse_overtime_latest_end(r["overtime"])
        if r["key"] == "day_shift":
            day_start = t
            if oe is not None:
                day_overtime_end = oe
        elif r["key"] == "night_shift":
            night_start = t
            if oe is not None:
                night_overtime_end = oe

    now_min = datetime.datetime.now().hour * 60 + datetime.datetime.now().minute
    current_shift = None
    if day_start is not None and night_start is not None:
        if day_start <= now_min < night_start:
            current_shift = "day"
        else:
            current_shift = "night"
    if own_conn:
        conn.close()
    return current_shift, day_overtime_end, night_overtime_end, day_start, night_start


def _schedule_in_current_shift(start_min, current_shift, day_start, day_overtime_end, night_start, night_overtime_end):
    """判断排班 start_min 是否属于当前班次"""
    if current_shift is None or start_min is None:
        return True  # 无法判断时不过滤
    if current_shift == "day":
        return day_start is not None and day_start <= start_min < day_overtime_end
    else:
        # 夜班窗口：[night_start, 1440) 或 [0, night_overtime_end)
        return (night_start is not None and start_min >= night_start) or start_min < night_overtime_end


def _ts_to_minutes(ts_val, date_str):
    """飞书毫秒时间戳 -> 相对 date_str 00:00 的绝对分钟数"""
    if ts_val is None:
        return None
    try:
        if isinstance(ts_val, (int, float)):
            dt_val = datetime.datetime.fromtimestamp(ts_val / 1000.0)
            base = datetime.datetime.combine(
                datetime.date.fromisoformat(date_str),
                datetime.time.min,
            )
            return round((dt_val - base).total_seconds() / 60)
    except Exception:
        pass
    return None


def _minutes_to_readable(date_str, abs_min):
    """date + 绝对分钟 -> 'HH:MM' 字符串"""
    if abs_min is None:
        return ""
    try:
        dt_val = datetime.date.fromisoformat(date_str)
        base = datetime.datetime.combine(dt_val, datetime.time.min)
        result = base + datetime.timedelta(minutes=int(abs_min))
        return result.strftime("%H:%M")
    except Exception:
        return ""


def _format_duration(minutes):
    """绝对分钟差 -> '1h10m' / '52m' 字符串"""
    if minutes is None:
        return ""
    m = int(minutes)
    if m <= 0:
        return ""
    h = m // 60
    r = m % 60
    if h > 0:
        return f"{h}h{r}m" if r > 0 else f"{h}h"
    return f"{m}m"


def _cross_midnight_diff(target_min, now_min):
    """跨午夜纠正时分差。target_min - now_min 的差值超过 ±12 小时时，
    认为目标在"另一天"，加/减 1440（一天分钟数）纠正。
    用于即将开始/结束的剩余分钟判断。"""
    if target_min is None or now_min is None:
        return None
    diff = target_min - now_min
    if diff < -720:       # 超过12小时负数 → 明天凌晨（如 23:55 vs 00:10 → 10-1435=-1425→15）
        return diff + 1440
    if diff > 720:        # 超过12小时正数 → 反向跨天
        return diff - 1440
    return diff


def _get_machine_type_color(machine_id, conn=None):
    """根据机器 ID 查 type_colors 获取对应颜色，未配置返回 'blue'"""
    own_conn = False
    if conn is None:
        conn = get_db()
        own_conn = True
    try:
        machine = conn.execute(
            "SELECT type FROM machines WHERE id=?", (machine_id,)
        ).fetchone()
        if not machine or not machine["type"]:
            return "blue"
        row = conn.execute(
            "SELECT value FROM config WHERE category='color_settings' AND key='type_colors'"
        ).fetchone()
        if row:
            try:
                colors = json.loads(row["value"])
                color = colors.get(machine["type"])
                if color:
                    return color
            except (json.JSONDecodeError, TypeError):
                pass
        return "blue"
    finally:
        if own_conn:
            conn.close()
