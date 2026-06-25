# Event Detection Fix: Cross-Day Catch-up & Card Date Labels

## Problem

BR1-02's first schedule ("常规采集任务", date 2026-06-03) had `actual_end` filled at 22:30 but the `task_confirm_end` event was never pushed to the group chat. Root cause: Phase 1 date filter `date_str != today_str` blocks yesterday's schedules; Phase 2 has no catch-up for `task_confirm_end` on completed schedules.

## Design

Three changes in `feishu/push_events.py`:

---

### 1. Phase 1 Date Filter: Block Future Only

**Current (line 254):**
```python
if date_str != today_str:
    continue
```

**Change to:**
```python
if date_str > today_str:
    continue
```

**Why safe:** Time-based events (impending start/end) are protected by their own time-window checks (`0 <= minutes_until_start <= 15` — negative for past). Data-change events (confirm_start/end, exception, schedule changes) explicitly check `data_changed` — only fire when Feishu was actually modified. Past schedules with stale data won't fire.

**Affected scenarios:** All 9 Phase 1 scenarios now process today + past schedules. Future schedules remain blocked.

---

### 2. Phase 2 Catch-up: `task_confirm_end`

**Insert after line 517** (after the `task_confirm_start` catch-up block, before `task_recycled`):

```python
    # ---- 补发 task_confirm_end：已完成排班有 actual_end，但还没发过卡片 ----
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
```

**Scope:** Today + yesterday only. Older completions are irrelevant. Uses `push_log` dedup mechanism same as other catch-up events.

**Why not `task_end` (leader early-fill):** `task_end` requires `now_min < end_min` (current time before scheduled end). For cross-day catch-up, this condition is always false, so `task_end` naturally never fires. No catch-up needed.

---

### 3. Card Date Labels for Non-Today Events

**New helper function:**

```python
def _format_task_label(event):
    """任务名，非今天的排班加日期前缀"""
    task_name = event.get("task_name", "")
    date_str = event.get("date", "")
    today_str = datetime.datetime.now().strftime("%Y-%m-%d")
    if date_str and date_str != today_str:
        # 06-03 格式
        short_date = date_str[-5:]  # "YYYY-MM-DD" -> "MM-DD"
        return f"{short_date} {task_name}"
    return task_name
```

**Apply to all card builders where `task_name` is displayed:**

| Line | Function | Current | Change |
|------|----------|---------|--------|
| 632 | `_build_reminder_card` | `event["task_name"]` | `_format_task_label(event)` |
| 693 | `_build_announcement_card` | `e.get("task_name", "")` | `_format_task_label(e)` |
| 770 | `_build_changes_card` | `ev.get("task_name", "")` | `_format_task_label(ev)` |
| 1074 | `_build_exception_card` | `event.get("task_name", "")` | `_format_task_label(event)` |
| 1247 | `_build_merged_reminder_card` | `ev["task_name"]` | `_format_task_label(ev)` |

**Effect:** When a schedule's date is not today, cards show e.g. "06-03 常规采集任务" instead of just "常规采集任务". This applies to both leader and group cards.

---

## Files Modified

| File | Changes |
|------|---------|
| `feishu/push_events.py` | 1. Line 254: `!=` → `>` |
| `feishu/push_events.py` | 2. After line 517: Add `task_confirm_end` catch-up block |
| `feishu/push_events.py` | 3. New helper `_format_task_label()` + update 5 call sites |

## Verification

1. Run sync → check `task_confirm_end` events now fire for past-day completed schedules
2. Push a test: fill actual_end on Feishu for yesterday's schedule → next sync cycle sends group card
3. Check card format: non-today event shows "MM-DD" prefix on task name
4. Future schedules (date > today) still blocked: no false alerts
5. Today's schedules work as before: no behavior change
