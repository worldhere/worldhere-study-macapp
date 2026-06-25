# -*- coding: utf-8 -*-
"""本地事件源：扫描本地 DB，检测场景 10-11 及补发事件"""
import json
import datetime
from db import get_db
from feishu.schedule_sync import _schedule_is_active
from feishu.events.shared import (
    _get_shift_context, _schedule_in_current_shift,
)


def detect_from_local():
    """查本地 DB，检测场景 10（任务包完成）、场景 11（班次报告）、
    以及补发场景：未来排班标记异常现在到时间了、task_confirm_start 到时间了、任务回收"""
    conn = get_db()
    events = []
    now = datetime.datetime.now()
    now_min = now.hour * 60 + now.minute
    today_str = now.strftime("%Y-%m-%d")
    yesterday_str = (now - datetime.timedelta(days=1)).strftime("%Y-%m-%d")

    # 加载班次上下文
    current_shift, day_oe, night_oe, day_start, night_start = _get_shift_context(conn)

    # ---- 本地补发：已到时间但还没发过通知的事件 ----
    events.extend(_detect_local_backfill_active(conn, now, now_min, today_str, yesterday_str,
                                                  current_shift, day_oe, night_oe, day_start, night_start))

    # ---- 补发 task_confirm_end ----
    events.extend(_detect_local_confirm_end_backfill(conn, yesterday_str, today_str))

    # ---- 补发 task_recycled ----
    events.extend(_detect_local_recycled_backfill(conn))

    # ---- 场景 10: 任务包完成 ----
    events.extend(_detect_package_complete(conn, today_str))

    # ---- 场景 11: 班次报告 ----
    events.extend(_detect_shift_report(conn, now, now_min, day_oe, night_oe, day_start, night_start))

    conn.close()
    return events


def _detect_local_backfill_active(conn, now, now_min, today_str, yesterday_str,
                                   current_shift, day_oe, night_oe, day_start, night_start):
    """补发活跃排班的事件：exception_start、task_confirm_start"""
    events = []
    sch_rows = conn.execute(
        """SELECT s.*, m.group_name, m.type AS machine_type, t.priority,
                  pkg.name AS package_name
           FROM schedules s
           LEFT JOIN machines m ON s.machine_id = m.id
           LEFT JOIN tasks t ON s.task_id = t.id
           LEFT JOIN task_packages pkg ON t.package_id = pkg.id
           WHERE s.date IN (?, ?) AND s.status != 'completed'
           ORDER BY s.date, s.start_min""",
        (yesterday_str, today_str)
    ).fetchall()

    for sch in sch_rows:
        if not _schedule_is_active(sch):
            continue
        if not _schedule_in_current_shift(sch["start_min"], current_shift, day_start, day_oe, night_start, night_oe):
            continue

        sid = sch["id"]
        date_str = sch["date"]
        start_min = sch["start_min"]
        end_min = sch["end_min"]
        duration_minutes = (end_min - start_min) if (start_min is not None and end_min is not None) else None

        base_info = {
            "schedule_id": sid,
            "machine_id": sch["machine_id"],
            "machine_name": sch["machine_name"],
            "task_name": sch["task_name"] or "",
            "date": date_str,
            "start_min": start_min,
            "end_min": end_min,
            "actual_start_min": sch["actual_start_min"],
            "actual_end_min": sch["actual_end_min"],
            "group_name": sch["group_name"] or "",
            "package_name": sch["package_name"] or "",
            "duration_minutes": duration_minutes,
            "priority": sch["priority"] or "",
            "machine_type": sch["machine_type"] or "",
            "collector": sch["collector"] or "",
        }

        # 补发 exception_start
        exc_mark = sch["exception_mark"]
        if exc_mark and exc_mark != "" and exc_mark != "正常":
            dedup_key = f"exc_{sid}_start"
            sent = conn.execute(
                "SELECT COUNT(*) AS c FROM push_log WHERE dedup_key=? AND event_type='exception_start'",
                (dedup_key,)
            ).fetchone()
            if not sent or sent["c"] == 0:
                events.append({
                    **base_info,
                    "event_type": "exception_start",
                    "exception_reason": exc_mark,
                    "exception_note": sch["exception_note"] or "",
                })

        # 补发 task_confirm_start
        if sch["actual_start_min"] is not None:
            dedup_key = f"confirm_start_{sid}"
            sent = conn.execute(
                "SELECT COUNT(*) AS c FROM push_log WHERE dedup_key=? AND event_type='task_confirm_start'",
                (dedup_key,)
            ).fetchone()
            if not sent or sent["c"] == 0:
                events.append({**base_info, "event_type": "task_confirm_start"})

    return events


def _detect_local_confirm_end_backfill(conn, yesterday_str, today_str):
    """补发 task_confirm_end：已完成排班有 actual_end，但还没发过卡片"""
    events = []
    completed_rows = conn.execute(
        """SELECT s.*, m.group_name, m.type AS machine_type, t.priority,
                  pkg.name AS package_name
           FROM schedules s
           LEFT JOIN machines m ON s.machine_id = m.id
           LEFT JOIN tasks t ON s.task_id = t.id
           LEFT JOIN task_packages pkg ON t.package_id = pkg.id
           WHERE s.date IN (?, ?) AND s.status = 'completed' AND s.actual_end_min IS NOT NULL
           ORDER BY s.date, s.start_min""",
        (yesterday_str, today_str)
    ).fetchall()

    for sch in completed_rows:
        sid = sch["id"]
        dedup_key = f"confirm_end_{sid}"
        sent = conn.execute(
            "SELECT COUNT(*) AS c FROM push_log WHERE dedup_key=? AND event_type='task_confirm_end'",
            (dedup_key,)
        ).fetchone()
        if not sent or sent["c"] == 0:
            start_min = sch["start_min"]
            end_min = sch["end_min"]
            duration_minutes = (end_min - start_min) if (start_min is not None and end_min is not None) else None
            events.append({
                "schedule_id": sid,
                "machine_id": sch["machine_id"],
                "machine_name": sch["machine_name"],
                "task_name": sch["task_name"] or "",
                "date": sch["date"],
                "start_min": start_min,
                "end_min": end_min,
                "actual_start_min": sch["actual_start_min"],
                "actual_end_min": sch["actual_end_min"],
                "group_name": sch["group_name"] or "",
                "package_name": sch["package_name"] or "",
                "duration_minutes": duration_minutes,
                "priority": sch["priority"] or "",
                "machine_type": sch["machine_type"] or "",
                "event_type": "task_confirm_end",
            })
    return events


def _detect_local_recycled_backfill(conn):
    """补发 task_recycled：push_log 中有未发送的回收记录"""
    events = []
    recycled_rows = conn.execute(
        "SELECT id, dedup_key, notify_value FROM push_log WHERE event_type='task_recycled' AND success=0"
    ).fetchall()
    for rr in recycled_rows:
        try:
            data = json.loads(rr["notify_value"])
            data["push_log_id"] = rr["id"]
            data["dedup_key"] = rr["dedup_key"]
            events.append(data)
        except (json.JSONDecodeError, TypeError):
            pass
    return events


def _detect_package_complete(conn, today_str):
    """场景 10: 任务包完成"""
    events = []
    pkgs = conn.execute(
        "SELECT id, name FROM task_packages"
    ).fetchall()
    for pkg in pkgs:
        pkg_id = pkg["id"]
        pkg_name = pkg["name"]
        remaining = conn.execute(
            """SELECT COUNT(*) AS c FROM schedules s
               JOIN tasks t ON s.task_id = t.id
               WHERE t.package_id=? AND s.status != 'completed'""",
            (pkg_id,)
        ).fetchone()
        if remaining and remaining["c"] == 0:
            has_any = conn.execute(
                """SELECT COUNT(*) AS c FROM schedules s
                   JOIN tasks t ON s.task_id = t.id
                   WHERE t.package_id=?""",
                (pkg_id,)
            ).fetchone()
            if has_any and has_any["c"] > 0:
                events.append({
                    "event_type": "package_complete",
                    "package_id": pkg_id,
                    "package_name": pkg_name,
                    "date": today_str,
                })
    return events


def _detect_shift_report(conn, now, now_min, day_oe, night_oe, day_start, night_start):
    """场景 11: 班次报告

    触发窗口扩大：报告在班次结束后可持续触发，由 push_log 去重保证同班次只发一次。
    避免原先夜班仅 30 分钟窗口（08:30-09:00）导致的漏报，
    同时修复白班报告的跨夜盲区（00:00 到 day_overtime_end 之间无法触发昨天的白班报告）。"""
    events = []
    yesterday = now - datetime.timedelta(days=1)
    today_str = now.strftime("%Y-%m-%d")
    yesterday_str = yesterday.strftime("%Y-%m-%d")

    _day_start = day_start or 540
    _day_oe = day_oe or 1260
    _night_oe = night_oe or 510

    # 白班报告：白班结束后即可触发（含跨夜补报）
    report_date = None
    if now_min < _day_start:
        # 凌晨 → 报告昨天的白班
        report_date = yesterday_str
        display_date = yesterday.strftime("%m/%d")
    elif now_min >= _day_oe:
        # 晚间 → 报告今天的白班
        report_date = today_str
        display_date = now.strftime("%m/%d")

    if report_date:
        base_report = {
            "shift": "白班",
            "date": report_date,
            "display_date": display_date,
        }
        events.append({**base_report, "event_type": "shift_report"})
        events.append({**base_report, "event_type": "shift_table_screenshot",
                        "shift_key": "day_shift"})

    # 夜班报告：夜班加班结束后即可触发（原仅 30 分钟窗口，现扩大至全天）
    if now_min >= _night_oe:
        base_report = {
            "shift": "夜班",
            "date": yesterday_str,
            "display_date": f"{yesterday.strftime('%m/%d')}-{now.strftime('%m/%d')}",
        }
        events.append({**base_report, "event_type": "shift_report"})
        events.append({**base_report, "event_type": "shift_table_screenshot",
                        "shift_key": "night_shift"})
    return events
