# 可视化总结面板 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Visual Summary" panel next to history, with a shared computation layer (`models/summary.py`) consumed by both the web UI and Feishu cards.

**Architecture:** 4 new files + 3 modified files. New `models/summary.py` holds 13 pure data functions. New `routes/summary.py` serves them via API. New `templates/panels/summary.html` + `static/summary.js` render the panel with Chart.js. `cards.py` is refactored to consume `shift_report_data()` instead of running its own SQL.

**Tech Stack:** Python/Flask (backend), Chart.js (frontend charts), SQLite (data)

---

### Task 1: Create `models/summary.py` — shared data layer

**Files:**
- Create: `models/summary.py`
- Create: `tests/test_summary.py`

This is the largest task. We build 13 pure functions that query the DB and return dicts/lists. Each function receives a `conn` from its caller.

The key migration: move `_build_shift_where`, `_query_package_progress`, `_query_package_schedule_stats`, `_query_collect_total` from `feishu/events/cards.py` into this file (they become private helpers).

- [ ] **Step 1: Create `models/summary.py` with the helper functions migrated from cards.py**

```python
# -*- coding: utf-8 -*-
"""可视化总结数据层：纯数据函数，输入 conn + 参数 → 输出 dict/list"""
import datetime
from feishu.events.shared import _parse_minutes


def _build_shift_where(conn, shift, date_str):
    """用班次时间区间（start_min）构造 WHERE 子句。
    返回 (where_clause, where_params)。"""
    now = datetime.datetime.now()
    today_str = now.strftime("%Y-%m-%d")
    yesterday_str = (now - datetime.timedelta(days=1)).strftime("%Y-%m-%d")

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
        clause = "((s.date = ? AND s.start_min >= ?) OR (s.date = ? AND s.start_min < ?))"
        params = (yesterday_str, night_start, today_str, day_start)
    else:
        clause = "(s.date = ? AND s.start_min >= ? AND s.start_min < ?)"
        params = (date_str, day_start, night_start)

    return clause, params


def _query_package_progress(conn, where_clause, where_params):
    """查询任务包进度"""
    rows = conn.execute(
        f"""SELECT p.id, p.name,
                   COUNT(DISTINCT t.id) AS total,
                   COUNT(DISTINCT CASE WHEN t.status='已完成' THEN t.id END) AS completed
            FROM schedules s
            JOIN tasks t ON s.task_id = t.id
            JOIN task_packages p ON t.package_id = p.id
            WHERE {where_clause} AND t.package_id IS NOT NULL
            GROUP BY p.id ORDER BY p.name""",
        where_params
    ).fetchall()
    return rows


def _query_package_schedule_stats(conn, where_clause, where_params):
    """按排班维度统计包排班数"""
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
    """统计已完成任务的采集总数（按 task_id 去重）"""
    row = conn.execute(
        f"""SELECT COALESCE(SUM(ti.collect_count), 0) AS total
            FROM (
              SELECT DISTINCT s.task_id
              FROM schedules s
              WHERE {where_clause} AND s.status='completed' AND s.task_id IS NOT NULL
            ) done
            JOIN tasks ti ON done.task_id = ti.id""",
        where_params
    ).fetchone()
    return row["total"] if row else 0
```

- [ ] **Step 2: Add `shift_report_data()` to `models/summary.py`**

```python
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
```

- [ ] **Step 3: Add remaining 12 data functions**

Due to length, these are summarized. Each follows the pattern: receive `conn`, run SQL, return dict/list.

```python
def daily_trend_data(conn, days=14, machine_type=None):
    """每日完成趋势"""
    from_date = (datetime.datetime.now() - datetime.timedelta(days=days)).strftime("%Y-%m-%d")
    if machine_type:
        rows = conn.execute(
            """SELECT s.date, COUNT(*) as total,
                      SUM(CASE WHEN s.status='completed' THEN 1 ELSE 0 END) as completed
               FROM schedules s JOIN machines m ON s.machine_id=m.id
               WHERE s.date >= ? AND m.type=?
               GROUP BY s.date ORDER BY s.date""",
            (from_date, machine_type)
        ).fetchall()
    else:
        rows = conn.execute(
            """SELECT date, COUNT(*) as total,
                      SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed
               FROM schedules WHERE date >= ?
               GROUP BY date ORDER BY date""",
            (from_date,)
        ).fetchall()
    return [{"date": r["date"], "completed": r["completed"] or 0, "total": r["total"] or 0} for r in rows]


def estimate_vs_actual_data(conn, days=14):
    """预估 vs 实际时长对比"""
    from_date = (datetime.datetime.now() - datetime.timedelta(days=days)).strftime("%Y-%m-%d")
    rows = conn.execute(
        """SELECT s.task_name, s.machine_name, s.task_type as type,
                  (s.end_min - s.start_min) as est_min,
                  (s.actual_end_min - s.actual_start_min) as actual_min
           FROM schedules s
           WHERE s.date >= ? AND s.status='completed'
             AND s.actual_start_min IS NOT NULL AND s.actual_end_min IS NOT NULL
           ORDER BY s.date DESC""",
        (from_date,)
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


def completion_heatmap_data(conn, days=14):
    """完成时段热力图"""
    from_date = (datetime.datetime.now() - datetime.timedelta(days=days)).strftime("%Y-%m-%d")
    rows = conn.execute(
        """SELECT s.date,
                  CAST(strftime('%H', s.completed_at) AS INTEGER) as hour,
                  COUNT(*) as count
           FROM schedules s
           WHERE s.date >= ? AND s.status='completed' AND s.completed_at IS NOT NULL
           GROUP BY s.date, hour ORDER BY s.date, hour""",
        (from_date,)
    ).fetchall()
    return [{"date": r["date"], "hour": r["hour"], "count": r["count"]} for r in rows]


def weekday_load_data(conn, weeks=4):
    """星期负载分布"""
    from_date = (datetime.datetime.now() - datetime.timedelta(weeks=weeks * 7)).strftime("%Y-%m-%d")
    labels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
    rows = conn.execute(
        """SELECT CAST(strftime('%w', date) AS INTEGER) as weekday,
                  COUNT(*) as total,
                  SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed
           FROM schedules WHERE date >= ?
           GROUP BY weekday ORDER BY weekday""",
        (from_date,)
    ).fetchall()
    day_counts = {}
    for r in rows:
        wd = r["weekday"]  # SQLite: 0=Sunday, 1=Monday, ..., 6=Saturday
        # Convert to Python weekday: 0=Monday, 6=Sunday
        py_wd = (wd + 6) % 7
        day_counts[py_wd] = {"total": r["total"] or 0, "completed": r["completed"] or 0}
    result = []
    num_weeks = max(weeks, 1)
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


def machine_utilization_data(conn, date_str, shift):
    """机器利用率"""
    where_clause, where_params = _build_shift_where(conn, shift, date_str)
    # 计算班次可用时长
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
        available = (1440 - night_start) + day_start  # 跨天可用时长
    else:
        available = night_start - day_start

    rows = conn.execute(
        f"""SELECT s.machine_name, m.type,
                   SUM(s.end_min - s.start_min) as total_min,
                   COUNT(*) as task_count
            FROM schedules s
            JOIN machines m ON s.machine_id=m.id
            WHERE {where_clause}
            GROUP BY s.machine_id ORDER BY total_min DESC""",
        where_params
    ).fetchall()
    result = []
    for r in rows:
        total = r["total_min"] or 0
        result.append({
            "machine_name": r["machine_name"],
            "type": r["type"],
            "total_min": total,
            "utilization_pct": round(total / available * 100, 1) if available > 0 else 0,
            "task_count": r["task_count"],
        })
    return result


def machine_status_distribution(conn):
    """机器状态分布"""
    rows = conn.execute(
        "SELECT type, status, COUNT(*) as cnt FROM machines GROUP BY type, status ORDER BY type, status"
    ).fetchall()
    by_type = {}
    totals = {}
    for r in rows:
        t = r["type"] or "未知"
        s = r["status"] or "未知"
        cnt = r["cnt"]
        if t not in by_type:
            by_type[t] = {}
        by_type[t][s] = cnt
        totals[s] = totals.get(s, 0) + cnt
    return {"by_type": by_type, "total": totals}


def repair_summary_data(conn, days=30):
    """维修频率 & 时长"""
    from_date = (datetime.datetime.now() - datetime.timedelta(days=days)).strftime("%Y-%m-%d")
    rows = conn.execute(
        """SELECT m.name, m.type, COUNT(r.id) as repair_count,
                  COALESCE(SUM(
                    CASE WHEN r.end_datetime IS NOT NULL
                    THEN ROUND((julianday(r.end_datetime) - julianday(r.start_datetime)) * 1440)
                    ELSE ROUND((julianday('now') - julianday(r.start_datetime)) * 1440)
                    END
                  ), 0) as total_duration_min,
                  MAX(r.start_datetime) as last_repair_at
           FROM repair_log r
           JOIN machines m ON r.machine_id=m.id
           WHERE r.start_datetime >= ?
           GROUP BY r.machine_id ORDER BY total_duration_min DESC""",
        (from_date + " 00:00:00",)
    ).fetchall()
    result = []
    for r in rows:
        cnt = r["repair_count"]
        total = r["total_duration_min"]
        result.append({
            "machine_name": r["name"],
            "type": r["type"],
            "repair_count": cnt,
            "total_duration_min": total,
            "avg_duration_min": round(total / cnt, 1) if cnt > 0 else 0,
            "last_repair_at": r["last_repair_at"],
        })
    return result


def exception_summary_data(conn, days=14):
    """异常汇总"""
    from_date = (datetime.datetime.now() - datetime.timedelta(days=days)).strftime("%Y-%m-%d")
    # 异常类型分布
    by_type_rows = conn.execute(
        """SELECT exception_mark, COUNT(*) as cnt
           FROM schedules
           WHERE date >= ? AND exception_mark IS NOT NULL
             AND exception_mark != '' AND exception_mark != '正常'
           GROUP BY exception_mark""",
        (from_date,)
    ).fetchall()
    by_type = {r["exception_mark"]: r["cnt"] for r in by_type_rows}

    # 班次分布
    shift_config_rows = conn.execute(
        "SELECT key, start FROM shift_config WHERE key IN ('day_shift', 'night_shift')"
    ).fetchall()
    ds = ns = None
    for r in shift_config_rows:
        t = _parse_minutes(r["start"])
        if r["key"] == "day_shift": ds = t
        elif r["key"] == "night_shift": ns = t
    day_start = ds if ds is not None else 540
    night_start = ns if ns is not None else 1260
    day_exc = conn.execute(
        """SELECT COUNT(*) as cnt FROM schedules
           WHERE date >= ? AND exception_mark IS NOT NULL
             AND exception_mark != '' AND exception_mark != '正常'
             AND start_min >= ? AND start_min < ?""",
        (from_date, day_start, night_start)
    ).fetchone()
    night_exc = conn.execute(
        """SELECT COUNT(*) as cnt FROM schedules
           WHERE date >= ? AND exception_mark IS NOT NULL
             AND exception_mark != '' AND exception_mark != '正常'
             AND (start_min >= ? OR start_min < ?)""",
        (from_date, night_start, day_start)
    ).fetchone()

    # 总量和趋势
    total_sch = conn.execute(
        "SELECT COUNT(*) as cnt FROM schedules WHERE date >= ?", (from_date,)
    ).fetchone()
    total_exc = sum(by_type.values())
    total_cnt = total_sch["cnt"] if total_sch else 1
    trend_rows = conn.execute(
        """SELECT date, COUNT(*) as cnt FROM schedules
           WHERE date >= ? AND exception_mark IS NOT NULL
             AND exception_mark != '' AND exception_mark != '正常'
           GROUP BY date ORDER BY date""",
        (from_date,)
    ).fetchall()

    return {
        "by_type": by_type,
        "by_shift": {
            "白班": day_exc["cnt"] if day_exc else 0,
            "夜班": night_exc["cnt"] if night_exc else 0,
        },
        "rate": round(total_exc / total_cnt, 3) if total_cnt > 0 else 0,
        "trend": [{"date": r["date"], "count": r["cnt"]} for r in trend_rows],
    }


def overdue_tasks_data(conn):
    """过时任务清单"""
    now = datetime.datetime.now()
    now_str = now.strftime("%Y-%m-%d %H:%M:%S")
    rows = conn.execute(
        """SELECT s.task_name, s.machine_name, s.date, s.start_min, s.end_min, s.status
           FROM schedules s
           WHERE s.status != 'completed'
           ORDER BY s.date, s.start_min"""
    ).fetchall()
    result = []
    for r in rows:
        try:
            base = datetime.datetime.combine(datetime.date.fromisoformat(r["date"]), datetime.time.min)
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


def cross_day_tasks_data(conn, days=7):
    """跨天任务一览"""
    from_date = (datetime.datetime.now() - datetime.timedelta(days=days)).strftime("%Y-%m-%d")
    rows = conn.execute(
        """SELECT task_name, machine_name, date, start_min, end_min
           FROM schedules
           WHERE date >= ? AND end_min > 1440
           ORDER BY date, start_min""",
        (from_date,)
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


def time_deviation_data(conn, days=14):
    """提前/延迟模式"""
    from_date = (datetime.datetime.now() - datetime.timedelta(days=days)).strftime("%Y-%m-%d")
    rows = conn.execute(
        """SELECT task_name, machine_name, start_min, end_min,
                  actual_start_min, actual_end_min
           FROM schedules
           WHERE date >= ? AND status='completed'
             AND actual_start_min IS NOT NULL AND actual_end_min IS NOT NULL""",
        (from_date,)
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


def push_stats_data(conn, days=7):
    """推送事件统计"""
    from_date = (datetime.datetime.now() - datetime.timedelta(days=days)).strftime("%Y-%m-%d")
    by_type_rows = conn.execute(
        """SELECT event_type, COUNT(*) as total,
                  SUM(CASE WHEN success=1 THEN 1 ELSE 0 END) as success_cnt
           FROM push_log
           WHERE sent_at >= ?
           GROUP BY event_type""",
        (from_date,)
    ).fetchall()
    by_type = {}
    for r in by_type_rows:
        by_type[r["event_type"]] = {"total": r["total"], "success": r["success_cnt"] or 0}

    daily_rows = conn.execute(
        """SELECT substr(sent_at, 1, 10) as date, COUNT(*) as total,
                  SUM(CASE WHEN success=1 THEN 1 ELSE 0 END) as success
           FROM push_log
           WHERE sent_at >= ?
           GROUP BY date ORDER BY date""",
        (from_date,)
    ).fetchall()

    total_all = sum(v["total"] for v in by_type.values())
    total_success = sum(v["success"] for v in by_type.values())
    return {
        "by_type": by_type,
        "success_rate": round(total_success / total_all, 3) if total_all > 0 else 0,
        "daily": [{"date": r["date"], "total": r["total"], "success": r["success"]} for r in daily_rows],
    }


# WIDGET_REGISTRY: 函数名 → 函数引用，供 API 层按名调用
WIDGET_REGISTRY = {
    "shift_report": shift_report_data,
    "daily_trend": daily_trend_data,
    "estimate_vs_actual": estimate_vs_actual_data,
    "completion_heatmap": completion_heatmap_data,
    "weekday_load": weekday_load_data,
    "machine_utilization": machine_utilization_data,
    "machine_status": machine_status_distribution,
    "repair_summary": repair_summary_data,
    "exception_summary": exception_summary_data,
    "overdue_tasks": overdue_tasks_data,
    "cross_day_tasks": cross_day_tasks_data,
    "time_deviation": time_deviation_data,
    "push_stats": push_stats_data,
}
```

- [ ] **Step 4: Run a quick smoke test**

```bash
python -c "from models.summary import WIDGET_REGISTRY; print(len(WIDGET_REGISTRY))"
```
Expected: 13

- [ ] **Step 5: Commit**

```bash
git add models/summary.py
git commit -m "feat: add models/summary.py — shared data layer with 13 pure data functions"
```

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>

---

### Task 2: Refactor `feishu/events/cards.py` — use `shift_report_data()`

**Files:**
- Modify: `feishu/events/cards.py`

- [ ] **Step 1: Import `shift_report_data` from summary.py**

Add this import at the top of `feishu/events/cards.py`:

```python
from models.summary import shift_report_data
```

- [ ] **Step 2: Replace `build_report_card()` body**

Replace the function (lines 391-509) with the simplified version that calls `shift_report_data()`:

```python
def build_report_card(event):
    """模板 5: 班次报告卡片（紫色）— 给群。三段结构：包进度 → 汇总 → 未完成"""
    conn = get_db()
    date_str = event["date"]
    display_date = event.get("display_date", date_str)
    shift = event["shift"]

    data = shift_report_data(conn, date_str, shift)
    conn.close()

    elements = []

    # ── 段 1: 任务包进度 ──
    if data["packages"]:
        elements.append({
            "tag": "div",
            "text": {"tag": "lark_md", "content": "**📦 任务包进度**"},
        })
        for pkg in data["packages"]:
            bar_len = 10
            filled = round(pkg["pct"] / 100 * bar_len) if pkg["pct"] > 0 else 0
            bar = "█" * filled + "░" * (bar_len - filled)
            remaining = pkg["total"] - pkg["completed"]
            elements.append({
                "tag": "div",
                "text": {
                    "tag": "lark_md",
                    "content": f"{pkg['name']}\n{bar} {pkg['pct']}%  ({pkg['completed']}/{pkg['total']}) 剩余 {remaining}"
                },
            })
        elements.append({"tag": "hr"})

    # ── 段 2: 汇总 ──
    completed_all = data["pkg_sch_completed"] + data["completed_standalone"]
    all_count = data["pkg_sch_total"] + data["completed_standalone"]
    summary_lines = [
        f"**📊 汇总**",
        f"包完成: {data['pkg_sch_completed']}/{data['pkg_sch_total']}（{len(data['packages'])} 个包）",
        f"独立任务完成: {data['completed_standalone']}",
        f"排班完成率: {completed_all}/{all_count}（{data['completion_pct']}%）",
        f"采集总数: {data['collect_total']:,}",
    ]
    elements.append({
        "tag": "div",
        "text": {"tag": "lark_md", "content": "\n".join(summary_lines)},
    })
    elements.append({"tag": "hr"})

    # ── 段 3: 未完成 ──
    if data["pending_count"] > 0:
        elements.append({
            "tag": "div",
            "text": {"tag": "lark_md", "content": f"**⏳ 未完成**\n还有 {data['pending_count']} 项排班未完成"},
        })
    else:
        elements.append({
            "tag": "div",
            "text": {"tag": "lark_md", "content": "**✅ 全部完成**"},
        })

    card = {
        "config": {"wide_screen_mode": True},
        "header": {
            "title": {"tag": "plain_text", "content": "{}  {}".format(display_date, shift)},
            "template": "purple",
        },
        "elements": elements,
    }
    return json.dumps(card, ensure_ascii=False)
```

- [ ] **Step 3: Delete migrated helper functions from cards.py**

Remove these functions (they now live in `models/summary.py`):
- `_build_shift_where()` (line 307-344)
- `_query_package_progress()` (line 347-360)
- `_query_package_schedule_stats()` (line 363-373)
- `_query_collect_total()` (line 376-388)

Check that no other code in `cards.py` calls these functions.

- [ ] **Step 4: Verify no broken imports**

```bash
python -c "from feishu.events.cards import build_report_card, build_reminder_card, build_announcement_card, build_changes_card, build_exception_card, build_recycled_card; print('OK')"
```

- [ ] **Step 5: Commit**

```bash
git add feishu/events/cards.py
git commit -m "refactor: simplify build_report_card to use shift_report_data from summary.py"
```

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>

---

### Task 3: Create `routes/summary.py` — API endpoints

**Files:**
- Create: `routes/summary.py`
- Modify: `app.py` (register blueprint)

- [ ] **Step 1: Create `routes/summary.py`**

```python
# -*- coding: utf-8 -*-
"""可视化总结面板 API"""
from flask import Blueprint, request, jsonify
from db import get_db
from models.summary import WIDGET_REGISTRY, shift_report_data
from feishu.events.cards import build_report_card
from feishu.common import send_im_message

bp = Blueprint("summary", __name__)


@bp.route("/api/summary/data")
def api_summary_data():
    """批量获取 widget 数据"""
    widget_names = (request.args.get("widgets") or "").split(",")
    widget_names = [w.strip() for w in widget_names if w.strip()]

    days = request.args.get("days", "14")
    try:
        days = int(days)
    except ValueError:
        days = 14

    date_str = request.args.get("date") or None
    shift = request.args.get("shift") or "白班"

    conn = get_db()
    result = {}
    errors = []

    for name in widget_names:
        if name not in WIDGET_REGISTRY:
            errors.append({"widget": name, "error": "unknown widget"})
            continue
        try:
            func = WIDGET_REGISTRY[name]
            # 根据函数签名决定传参
            if name == "shift_report":
                if date_str:
                    result[name] = func(conn, date_str, shift)
                else:
                    result[name] = {"error": "date required for shift_report"}
            elif name in ("machine_utilization",):
                if date_str:
                    result[name] = func(conn, date_str, shift)
                else:
                    result[name] = {"error": "date required"}
            elif name == "machine_status":
                result[name] = func(conn)
            elif name == "overdue_tasks":
                result[name] = func(conn)
            else:
                result[name] = func(conn, days)
        except Exception as e:
            errors.append({"widget": name, "error": str(e)})
            result[name] = None

    conn.close()

    resp = {"data": result}
    if errors:
        resp["errors"] = errors
    return jsonify(resp)


@bp.route("/api/summary/report-status")
def api_report_status():
    """检查报告是否已发送"""
    date_str = request.args.get("date") or ""
    shift = request.args.get("shift") or "白班"

    conn = get_db()
    dedup_key = f"shift_report_{date_str}_{shift}"
    row = conn.execute(
        "SELECT sent_at, success FROM push_log WHERE dedup_key=? AND event_type='shift_report' ORDER BY id DESC LIMIT 1",
        (dedup_key,)
    ).fetchone()
    conn.close()

    if row:
        return jsonify({
            "generated": True,
            "sent": bool(row["success"]),
            "sent_at": row["sent_at"],
        })
    return jsonify({"generated": False, "sent": False, "sent_at": None})


@bp.route("/api/summary/send-report", methods=["POST"])
def api_send_report():
    """手动发送班次报告到飞书群"""
    body = request.get_json() or {}
    date_str = body.get("date") or ""
    shift = body.get("shift") or "白班"
    chat_ids = body.get("chat_ids") or []

    if not date_str:
        return jsonify({"success": False, "error": "date required"}), 400

    conn = get_db()
    try:
        data = shift_report_data(conn, date_str, shift)
    except Exception as e:
        conn.close()
        return jsonify({"success": False, "error": str(e)}), 500

    # 构建报告事件数据
    event = {"date": date_str, "shift": shift, "display_date": date_str}
    try:
        card_json = build_report_card(event)
    except Exception as e:
        conn.close()
        return jsonify({"success": False, "error": f"card build failed: {e}"}), 500

    # 发送到每个群
    import datetime as _dt
    now_str = _dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    sent_to = []
    send_errors = []

    for cid in chat_ids:
        success, err = send_im_message(str(cid), card_json, "interactive")
        if success:
            sent_to.append(cid)
        else:
            send_errors.append({"chat_id": cid, "error": err})

    # 写 push_log 记录
    dedup_key = f"shift_report_{date_str}_{shift}"
    conn.execute(
        """INSERT OR REPLACE INTO push_log (dedup_key, event_type, target_type, target_id, notify_value, sent_at, success)
           VALUES (?, 'shift_report', 'group', ?, ?, ?, 1)""",
        (dedup_key, ",".join(sent_to), card_json[:500], now_str),
    )
    conn.commit()
    conn.close()

    return jsonify({
        "success": len(send_errors) == 0,
        "sent_to": sent_to,
        "errors": send_errors,
    })
```

- [ ] **Step 2: Register blueprint in `app.py`**

Find the blueprint registration section and add:

```python
from routes.summary import bp as summary_bp
app.register_blueprint(summary_bp)
```

- [ ] **Step 3: Verify endpoints load**

```bash
python -c "from routes.summary import bp; print('OK')"
```

- [ ] **Step 4: Commit**

```bash
git add routes/summary.py app.py
git commit -m "feat: add summary API endpoints — /api/summary/data, /report-status, /send-report"
```

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>

---

### Task 4: Create `templates/panels/summary.html`

**Files:**
- Create: `templates/panels/summary.html`

- [ ] **Step 1: Create the panel HTML**

```html
<div class="panel" id="panel-summary">
  <!-- 顶部横幅：班次报告 -->
  <div class="summary-banner" id="summary-banner">
    <div class="summary-banner-left">
      <h3>📊 班次报告</h3>
      <div class="summary-banner-controls">
        <input type="date" id="summary-date" class="form-input" style="width:140px;">
        <select id="summary-shift" class="form-input" style="width:100px;">
          <option value="白班">白班</option>
          <option value="夜班">夜班</option>
        </select>
        <button class="btn btn-primary btn-sm" onclick="summaryLoadReport()">查看</button>
      </div>
      <div class="summary-banner-stats" id="summary-banner-stats" style="display:none;margin-top:8px;font-size:13px;color:var(--text-secondary);">
        包进度 <strong id="stat-packages">0</strong> 个 | 完成率 <strong id="stat-pct">0</strong>% | 未完成 <strong id="stat-pending">0</strong> 项 | 采集总数 <strong id="stat-collect">0</strong>
      </div>
    </div>
    <div class="summary-banner-right">
      <button class="btn btn-primary" id="btn-send-report" onclick="summarySendReport()" disabled>📤 发送到飞书</button>
      <span id="summary-sent-badge" style="display:none;font-size:12px;color:#10b981;">✅ 已发送</span>
    </div>
  </div>

  <!-- 时间范围选择 -->
  <div class="summary-toolbar">
    <label style="font-size:13px;margin-right:8px;">时间范围:</label>
    <select id="summary-days" class="form-input" style="width:120px;" onchange="summaryRefreshAll()">
      <option value="7">近 7 天</option>
      <option value="14" selected>近 14 天</option>
      <option value="30">近 30 天</option>
      <option value="90">近 90 天</option>
    </select>
    <button class="btn btn-sm" onclick="summaryRefreshAll()" style="margin-left:8px;">🔄 刷新</button>
  </div>

  <!-- Widget 网格 -->
  <div class="summary-grid" id="summary-grid">
    <!-- JS 动态填充 -->
  </div>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add templates/panels/summary.html
git commit -m "feat: add visual summary panel HTML template"
```

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>

---

### Task 5: Create `static/summary.js`

**Files:**
- Create: `static/summary.js`

This is the frontend logic. Loads data from `/api/summary/data`, renders Chart.js charts, handles send dialog.

- [ ] **Step 1: Create widget definitions and core data loading**

```javascript
// 可视化总结面板 JS
var SUMMARY_CACHE = {};  // widget_name → data

const SUMMARY_WIDGETS = [
  { id: "daily_trend", title: "📈 每日完成趋势", chartType: "line", span: 1 },
  { id: "estimate_vs_actual", title: "⏱ 预估 vs 实际时长", chartType: "bar", span: 1 },
  { id: "completion_heatmap", title: "🔥 完成时段热力图", chartType: "heatmap", span: 1 },
  { id: "weekday_load", title: "📅 星期负载分布", chartType: "bar", span: 1 },
  { id: "machine_utilization", title: "🏭 机器利用率", chartType: "hbar", span: 1 },
  { id: "machine_status", title: "🖥 机器状态分布", chartType: "doughnut", span: 1 },
  { id: "repair_summary", title: "🔧 维修频率 & 时长", chartType: "hbar", span: 1 },
  { id: "exception_summary", title: "⚠️ 异常汇总", chartType: "mixed", span: 1 },
  { id: "overdue_tasks", title: "⏰ 过时任务清单", chartType: "table", span: 1 },
  { id: "cross_day_tasks", title: "🔄 跨天任务一览", chartType: "table", span: 1 },
  { id: "time_deviation", title: "⏳ 提前/延迟模式", chartType: "histogram", span: 1 },
  { id: "push_stats", title: "📡 推送事件统计", chartType: "bar", span: 1 },
];

var SUMMARY_CHARTS = {};  // widgetId → Chart instance

function summaryGetDays() {
  var el = document.getElementById("summary-days");
  return el ? parseInt(el.value) || 14 : 14;
}

function summaryGetDate() {
  var el = document.getElementById("summary-date");
  return el ? el.value : "";
}

function summaryGetShift() {
  var el = document.getElementById("summary-shift");
  return el ? el.value : "白班";
}

async function summaryLoadData(widgetNames) {
  var days = summaryGetDays();
  var date = summaryGetDate();
  var shift = summaryGetShift();
  var params = new URLSearchParams({ widgets: widgetNames.join(","), days: days, shift: shift });
  if (date) params.set("date", date);
  var resp = await fetch("/api/summary/data?" + params.toString());
  var json = await resp.json();
  if (json.data) {
    for (var key in json.data) {
      SUMMARY_CACHE[key] = json.data[key];
    }
  }
  return json;
}

async function summaryLoadReport() {
  var date = summaryGetDate();
  var shift = summaryGetShift();
  if (!date) return;
  await summaryLoadData(["shift_report", "machine_utilization"]);
  var data = SUMMARY_CACHE["shift_report"];
  var bannerStats = document.getElementById("summary-banner-stats");
  var sendBtn = document.getElementById("btn-send-report");
  if (data && !data.error) {
    bannerStats.style.display = "";
    document.getElementById("stat-packages").textContent = data.packages.length;
    document.getElementById("stat-pct").textContent = data.completion_pct;
    document.getElementById("stat-pending").textContent = data.pending_count;
    document.getElementById("stat-collect").textContent = (data.collect_total || 0).toLocaleString();
    sendBtn.disabled = false;
    // 检查是否已发送
    var statusResp = await fetch("/api/summary/report-status?date=" + date + "&shift=" + shift);
    var status = await statusResp.json();
    var badge = document.getElementById("summary-sent-badge");
    if (status.sent) {
      badge.style.display = "";
      badge.textContent = "✅ 已发送 " + (status.sent_at || "");
      sendBtn.textContent = "📤 重新发送";
    } else {
      badge.style.display = "none";
      sendBtn.textContent = "📤 发送到飞书";
    }
    // 同时渲染机器利用率
    renderMachineUtilization();
  } else {
    bannerStats.style.display = "none";
    sendBtn.disabled = true;
  }
}

function summaryRefreshAll() {
  var allIds = SUMMARY_WIDGETS.map(function(w) { return w.id; });
  summaryLoadData(allIds).then(function() {
    for (var i = 0; i < SUMMARY_WIDGETS.length; i++) {
      renderWidget(SUMMARY_WIDGETS[i]);
    }
  });
}
```

- [ ] **Step 2: Add Chart.js rendering functions**

```javascript
function renderWidget(w) {
  var data = SUMMARY_CACHE[w.id];
  if (!data || data.error) {
    renderEmptyWidget(w, data ? data.error : "暂无数据");
    return;
  }
  switch (w.chartType) {
    case "line": renderLineChart(w, data); break;
    case "bar": renderBarChart(w, data); break;
    case "hbar": renderHBarChart(w, data); break;
    case "doughnut": renderDoughnutChart(w, data); break;
    case "mixed": renderMixedChart(w, data); break;
    case "histogram": renderHistogramChart(w, data); break;
    case "heatmap": renderHeatmap(w, data); break;
    case "table": renderTableWidget(w, data); break;
  }
}

function getOrCreateCanvas(w) {
  var grid = document.getElementById("summary-grid");
  var card = document.getElementById("widget-" + w.id);
  if (!card) {
    card = document.createElement("div");
    card.className = "summary-widget";
    card.id = "widget-" + w.id;
    card.style.gridColumn = "span " + (w.span || 1);
    card.innerHTML = '<div class="summary-widget-header" onclick="toggleWidget(\'' + w.id + '\')">' +
      '<span>' + w.title + '</span><span class="summary-widget-toggle">▼</span></div>' +
      '<div class="summary-widget-body"><canvas></canvas></div>';
    grid.appendChild(card);
  }
  // 确保 canvas 存在
  var body = card.querySelector(".summary-widget-body");
  if (!body.querySelector("canvas")) {
    body.innerHTML = '<canvas></canvas>';
  }
  return card.querySelector("canvas");
}

function destroyWidgetChart(widgetId) {
  if (SUMMARY_CHARTS[widgetId]) {
    SUMMARY_CHARTS[widgetId].destroy();
    delete SUMMARY_CHARTS[widgetId];
  }
}

function renderLineChart(w, data) {
  destroyWidgetChart(w.id);
  var canvas = getOrCreateCanvas(w);
  var ctx = canvas.getContext("2d");
  SUMMARY_CHARTS[w.id] = new Chart(ctx, {
    type: "line",
    data: {
      labels: data.map(function(d) { return d.date; }),
      datasets: [
        { label: "总排班", data: data.map(function(d) { return d.total; }), borderColor: "#3b82f6", tension: 0.2 },
        { label: "已完成", data: data.map(function(d) { return d.completed; }), borderColor: "#10b981", tension: 0.2 },
      ]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } }
  });
}

function renderBarChart(w, data) {
  destroyWidgetChart(w.id);
  var canvas = getOrCreateCanvas(w);
  var ctx = canvas.getContext("2d");
  if (w.id === "weekday_load") {
    SUMMARY_CHARTS[w.id] = new Chart(ctx, {
      type: "bar",
      data: {
        labels: data.map(function(d) { return d.label; }),
        datasets: [
          { label: "总排班", data: data.map(function(d) { return d.total; }), backgroundColor: "#93c5fd" },
          { label: "已完成", data: data.map(function(d) { return d.completed; }), backgroundColor: "#6ee7b7" },
        ]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } }
    });
  } else if (w.id === "estimate_vs_actual") {
    var labels = data.map(function(d) { return d.task_name + "@" + d.machine_name; });
    SUMMARY_CHARTS[w.id] = new Chart(ctx, {
      type: "bar",
      data: {
        labels: labels,
        datasets: [
          { label: "预估(min)", data: data.map(function(d) { return d.est_min; }), backgroundColor: "#93c5fd" },
          { label: "实际(min)", data: data.map(function(d) { return d.actual_min; }), backgroundColor: "#fca5a5" },
        ]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } }
    });
  } else if (w.id === "push_stats") {
    var daily = data.daily || [];
    var types = Object.keys(data.by_type || {});
    var datasets = types.map(function(t, i) {
      return { label: t, data: daily.map(function(d) { return (data.by_type[t] || {}).total || 0; }), backgroundColor: COLORS[i % COLORS.length] };
    });
    SUMMARY_CHARTS[w.id] = new Chart(ctx, {
      type: "bar",
      data: { labels: daily.map(function(d) { return d.date; }), datasets: datasets },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } }, scales: { x: { stacked: true }, y: { stacked: true } } }
    });
  }
}

function renderHBarChart(w, data) {
  destroyWidgetChart(w.id);
  var canvas = getOrCreateCanvas(w);
  var ctx = canvas.getContext("2d");
  var labels, values, bgColors;
  if (w.id === "machine_utilization") {
    labels = data.map(function(d) { return d.machine_name; });
    values = data.map(function(d) { return d.utilization_pct; });
  } else if (w.id === "repair_summary") {
    labels = data.map(function(d) { return d.machine_name; });
    values = data.map(function(d) { return d.total_duration_min; });
  }
  SUMMARY_CHARTS[w.id] = new Chart(ctx, {
    type: "bar",
    data: {
      labels: labels,
      datasets: [{ label: w.id === "machine_utilization" ? "利用率 %" : "维修总时长(min)", data: values, backgroundColor: "#93c5fd" }]
    },
    options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
  });
}

function renderDoughnutChart(w, data) {
  destroyWidgetChart(w.id);
  var canvas = getOrCreateCanvas(w);
  var ctx = canvas.getContext("2d");
  var totals = data.total || {};
  var labels = Object.keys(totals);
  var values = labels.map(function(k) { return totals[k]; });
  SUMMARY_CHARTS[w.id] = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: labels,
      datasets: [{ data: values, backgroundColor: ["#10b981", "#f59e0b", "#ef4444", "#3b82f6", "#8b5cf6"] }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } }
  });
}

function renderMixedChart(w, data) {
  // 异常汇总：堆叠柱状图 + 趋势折线
  destroyWidgetChart(w.id);
  var canvas = getOrCreateCanvas(w);
  var ctx = canvas.getContext("2d");
  var trend = data.trend || [];
  var byType = data.by_type || {};
  var typeKeys = Object.keys(byType);
  var datasets = typeKeys.map(function(t, i) {
    return { type: "bar", label: t, data: trend.map(function(d) { return 0; }), backgroundColor: COLORS[i % COLORS.length] };
  });
  // 简单版：只用柱状图展示 by_type
  SUMMARY_CHARTS[w.id] = new Chart(ctx, {
    type: "bar",
    data: {
      labels: ["异常分布"],
      datasets: typeKeys.map(function(t, i) {
        return { label: t, data: [byType[t]], backgroundColor: COLORS[i % COLORS.length] };
      })
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } }, scales: { x: { stacked: true }, y: { stacked: true } } }
  });
}

function renderHistogramChart(w, data) {
  destroyWidgetChart(w.id);
  var canvas = getOrCreateCanvas(w);
  var ctx = canvas.getContext("2d");
  var startDeltas = (data.start_deviations || []).map(function(d) { return d.delta; });
  var endDeltas = (data.end_deviations || []).map(function(d) { return d.delta; });
  // 简单分组
  function bucket(arr) {
    var b = {};
    for (var i = 0; i < arr.length; i++) {
      var key = Math.floor(arr[i] / 10) * 10;
      b[key] = (b[key] || 0) + 1;
    }
    return b;
  }
  var sB = bucket(startDeltas);
  var eB = bucket(endDeltas);
  var allKeys = Object.keys(sB).concat(Object.keys(eB)).map(Number);
  allKeys = Array.from(new Set(allKeys)).sort(function(a, b) { return a - b; });
  SUMMARY_CHARTS[w.id] = new Chart(ctx, {
    type: "bar",
    data: {
      labels: allKeys.map(function(k) { return k + "min"; }),
      datasets: [
        { label: "开始偏差", data: allKeys.map(function(k) { return sB[k] || 0; }), backgroundColor: "#93c5fd" },
        { label: "结束偏差", data: allKeys.map(function(k) { return eB[k] || 0; }), backgroundColor: "#fca5a5" },
      ]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } }
  });
}

function renderHeatmap(w, data) {
  destroyWidgetChart(w.id);
  var canvas = getOrCreateCanvas(w);
  // 热力图改为用简单的 div grid 展示
  var body = canvas.parentElement;
  body.innerHTML = "";
  // 构建日期 × 小时的矩阵
  var dates = [];
  var dateSet = {};
  for (var i = 0; i < data.length; i++) {
    if (!dateSet[data[i].date]) {
      dates.push(data[i].date);
      dateSet[data[i].date] = true;
    }
  }
  var matrix = {};
  for (var i = 0; i < data.length; i++) {
    matrix[data[i].date + "|" + data[i].hour] = data[i].count;
  }
  var maxCount = 0;
  for (var i = 0; i < data.length; i++) {
    if (data[i].count > maxCount) maxCount = data[i].count;
  }
  var table = document.createElement("table");
  table.style.cssText = "width:100%;border-collapse:collapse;font-size:10px;";
  var thead = document.createElement("thead");
  var headerRow = document.createElement("tr");
  var th = document.createElement("th"); th.textContent = ""; th.style.cssText = "padding:2px 4px;"; headerRow.appendChild(th);
  for (var h = 0; h < 24; h++) {
    var th2 = document.createElement("th"); th2.textContent = h; th2.style.cssText = "padding:2px 4px;font-weight:400;"; headerRow.appendChild(th2);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);
  var tbody = document.createElement("tbody");
  for (var di = 0; di < dates.length; di++) {
    var tr = document.createElement("tr");
    var td = document.createElement("td"); td.textContent = dates[di].slice(5); td.style.cssText = "padding:2px 4px;font-size:10px;"; tr.appendChild(td);
    for (var h2 = 0; h2 < 24; h2++) {
      var td2 = document.createElement("td");
      var count = matrix[dates[di] + "|" + h2] || 0;
      var intensity = maxCount > 0 ? count / maxCount : 0;
      td2.style.cssText = "padding:2px 4px;text-align:center;background:rgba(59,130,246," + intensity.toFixed(2) + ");color:" + (intensity > 0.5 ? "#fff" : "#333") + ";";
      td2.textContent = count || "";
      tr.appendChild(td2);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  body.appendChild(table);
}

function renderTableWidget(w, data) {
  destroyWidgetChart(w.id);
  var canvas = getOrCreateCanvas(w);
  var body = canvas.parentElement;
  body.innerHTML = "";
  if (!data || data.length === 0) {
    body.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;padding:8px;">暂无数据</p>';
    return;
  }
  var table = document.createElement("table");
  table.style.cssText = "width:100%;border-collapse:collapse;font-size:12px;";
  if (w.id === "overdue_tasks") {
    var head = "<tr style='border-bottom:1px solid var(--border);'>" +
      "<th style='text-align:left;padding:4px;'>任务</th><th style='text-align:left;padding:4px;'>机器</th>" +
      "<th style='text-align:left;padding:4px;'>日期</th><th style='text-align:left;padding:4px;'>超时</th></tr>";
    var rows = data.slice(0, 20).map(function(r) {
      var h = Math.floor(r.overdue_min / 60);
      var m = r.overdue_min % 60;
      return "<tr style='border-bottom:1px solid var(--border);'>" +
        "<td style='padding:4px;'>" + r.task_name + "</td><td style='padding:4px;'>" + r.machine_name + "</td>" +
        "<td style='padding:4px;'>" + r.date + "</td><td style='padding:4px;color:#ef4444;'>" + h + "h" + m + "m</td></tr>";
    }).join("");
    table.innerHTML = "<thead>" + head + "</thead><tbody>" + rows + "</tbody>";
  } else if (w.id === "cross_day_tasks") {
    var head2 = "<tr style='border-bottom:1px solid var(--border);'>" +
      "<th style='text-align:left;padding:4px;'>任务</th><th style='text-align:left;padding:4px;'>机器</th>" +
      "<th style='text-align:left;padding:4px;'>排班时间</th><th style='text-align:left;padding:4px;'>跨天</th></tr>";
    var rows2 = data.map(function(r) {
      return "<tr style='border-bottom:1px solid var(--border);'>" +
        "<td style='padding:4px;'>" + r.task_name + "</td><td style='padding:4px;'>" + r.machine_name + "</td>" +
        "<td style='padding:4px;font-size:11px;'>" + r.start_str + "~" + r.end_str + "</td>" +
        "<td style='padding:4px;'>" + r.span_days + "天</td></tr>";
    }).join("");
    table.innerHTML = "<thead>" + head2 + "</thead><tbody>" + rows2 + "</tbody>";
  }
  body.appendChild(table);
}

function renderEmptyWidget(w, msg) {
  destroyWidgetChart(w.id);
  var canvas = getOrCreateCanvas(w);
  var body = canvas.parentElement;
  body.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;padding:8px;">' + (msg || "暂无数据") + '</p>';
}

function toggleWidget(widgetId) {
  var card = document.getElementById("widget-" + widgetId);
  if (!card) return;
  var body = card.querySelector(".summary-widget-body");
  var toggle = card.querySelector(".summary-widget-toggle");
  if (body.style.display === "none") {
    body.style.display = "";
    if (toggle) toggle.textContent = "▼";
  } else {
    body.style.display = "none";
    if (toggle) toggle.textContent = "▶";
  }
}

var COLORS = ["#3b82f6","#ef4444","#10b981","#f59e0b","#8b5cf6","#ec4899","#06b6d4","#84cc16","#f97316","#6366f1"];

function renderMachineUtilization() {
  var w = SUMMARY_WIDGETS.find(function(wi) { return wi.id === "machine_utilization"; });
  if (w && SUMMARY_CACHE["machine_utilization"]) {
    renderWidget(w);
  }
}
```

- [ ] **Step 3: Add send dialog function**

```javascript
async function summarySendReport() {
  var date = summaryGetDate();
  var shift = summaryGetShift();
  if (!date) { showToast("请先选择日期和班次"); return; }

  // 获取群组列表
  var chatIds = [];
  try {
    var resp = await fetch("/api/settings/config?category=feishu_push&key=chat_ids");
    var json = await resp.json();
    if (json.value) {
      var chats = JSON.parse(json.value);
      chatIds = chats.map(function(c) { return c.chat_id; });
    }
  } catch(e) {}

  if (chatIds.length === 0) {
    showToast("未配置飞书群组，请在设置中配置 feishu_push.chat_ids");
    return;
  }

  if (!confirm("确认发送 " + date + " " + shift + " 报告到 " + chatIds.length + " 个群？")) return;

  var sendResp = await fetch("/api/summary/send-report", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({date: date, shift: shift, chat_ids: chatIds})
  });
  var result = await sendResp.json();
  if (result.success) {
    showToast("✅ 报告已发送到 " + result.sent_to.length + " 个群");
    document.getElementById("summary-sent-badge").style.display = "";
    document.getElementById("summary-sent-badge").textContent = "✅ 已发送";
  } else {
    showToast("❌ 发送失败: " + (result.errors || []).map(function(e) { return e.error; }).join(", "));
  }
}
```

- [ ] **Step 4: Add panel activation hook**

```javascript
// summaryOnActivate — 切换到面板时调用
function summaryOnActivate() {
  var dateEl = document.getElementById("summary-date");
  if (dateEl && !dateEl.value) {
    dateEl.value = new Date().toISOString().slice(0, 10);
  }
  var grid = document.getElementById("summary-grid");
  if (grid && grid.children.length === 0) {
    // 首次加载
    for (var i = 0; i < SUMMARY_WIDGETS.length; i++) {
      var w = SUMMARY_WIDGETS[i];
      var card = document.createElement("div");
      card.className = "summary-widget";
      card.id = "widget-" + w.id;
      card.style.gridColumn = "span " + (w.span || 1);
      card.innerHTML = '<div class="summary-widget-header" onclick="toggleWidget(\'' + w.id + '\')">' +
        '<span>' + w.title + '</span><span class="summary-widget-toggle">▼</span></div>' +
        '<div class="summary-widget-body"><canvas></canvas></div>';
      grid.appendChild(card);
    }
  }
  summaryRefreshAll();
}
```

- [ ] **Step 5: Commit**

```bash
git add static/summary.js
git commit -m "feat: add summary panel JS — Chart.js rendering + send dialog"
```

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>

---

### Task 6: Modify `templates/index.html` — add tab + panel include

**Files:**
- Modify: `templates/index.html`

- [ ] **Step 1: Add tab button**

After line 97 (history tab), insert:

```html
<button class="tab-btn" onclick="switchTab(6)">可视化总结</button>
```

- [ ] **Step 2: Add panel include**

After line 113 (settings panel include), insert:

```html
{% include 'panels/summary.html' %}
```

- [ ] **Step 3: Commit**

```bash
git add templates/index.html
git commit -m "feat: add visual summary tab and panel include to index.html"
```

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>

---

### Task 7: Modify `static/core.js` — register new tab

**Files:**
- Modify: `static/core.js`

- [ ] **Step 1: Add tab to NAV_TAB_MAP and NAV_ICONS**

```javascript
var NAV_TAB_MAP = { "班次设置": 0, "机器管理": 1, "任务库": 2, "排班面板": 3, "历史记录": 4, "设置": 5, "可视化总结": 6 };
var NAV_ICONS = ["&#9881;", "&#128421;", "&#128203;", "&#128197;", "&#128220;", "&#9881;", "&#128202;"];
```

- [ ] **Step 2: Add switchTab hook for panel activation**

Find `switchTab()` in `core.js`. After the tab switch logic, add:

```javascript
if (idx === 6 && typeof summaryOnActivate === "function") {
  setTimeout(function() { summaryOnActivate(); }, 100);
}
```

- [ ] **Step 3: Commit**

```bash
git add static/core.js
git commit -m "feat: register visual summary tab (index 6) in core.js"
```

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>

---

### Task 8: Add Chart.js CDN and panel CSS

**Files:**
- Modify: `templates/index.html` (add Chart.js script)
- Modify: `static/layout.css` (add panel CSS)

- [ ] **Step 1: Add Chart.js CDN to index.html**

In the `<head>` or before closing `</body>`, add:

```html
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
```

- [ ] **Step 2: Add panel CSS to `static/layout.css`**

```css
/* ========== 可视化总结面板 ========== */
.summary-banner {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  background: var(--bg-card);
  border: 2px solid #8b5cf6;
  border-radius: 12px;
  padding: 16px 20px;
  margin-bottom: 16px;
}
.summary-banner-left h3 { margin: 0 0 8px 0; font-size: 16px; }
.summary-banner-controls { display: flex; gap: 8px; align-items: center; }
.summary-banner-right { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
.summary-toolbar {
  display: flex;
  align-items: center;
  margin-bottom: 16px;
  gap: 8px;
}
.summary-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
.summary-widget {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
}
.summary-widget-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
  border-bottom: 1px solid var(--border);
}
.summary-widget-header:hover { background: var(--bg-hover); }
.summary-widget-toggle { font-size: 10px; color: var(--text-secondary); }
.summary-widget-body {
  padding: 12px;
  min-height: 180px;
  max-height: 350px;
  overflow-y: auto;
  position: relative;
}
.summary-widget-body canvas { max-height: 320px; }
.form-input {
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 13px;
  background: var(--bg-input);
  color: var(--text-main);
}
@media (max-width: 1024px) {
  .summary-grid { grid-template-columns: 1fr; }
}
```

- [ ] **Step 3: Commit**

```bash
git add templates/index.html static/layout.css
git commit -m "feat: add Chart.js CDN and visual summary panel CSS"
```

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>

---

### Task 9: Integration test — run the app and verify

- [ ] **Step 1: Start the app**

```bash
python app.py
```

- [ ] **Step 2: Open browser and verify**

Navigate to the app. Click "可视化总结" tab. Verify:
- Panel loads without JS errors
- Date selector defaults to today
- Widgets render with data (or empty states)
- "发送到飞书" button appears after selecting date + shift and clicking "查看"
- Charts render (at minimum, machine status doughnut chart should work)

- [ ] **Step 3: Fix any issues found**
