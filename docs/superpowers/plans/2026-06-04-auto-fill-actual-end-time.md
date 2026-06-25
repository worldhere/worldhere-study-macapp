# Auto-fill actual_end_min on Local Task Completion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a schedule is completed locally, automatically populate `actual_end_min` so Feishu's `实际结束` field is filled on next push. Clear the value on uncomplete.

**Architecture:** Modify only the completion/uncompletion endpoints in `routes/schedule_ops.py` and `routes/tasks.py`. No changes to push, pull, or event detection code — they already handle `actual_end_min` correctly.

**Tech Stack:** Python 3, Flask, SQLite

---

## Files Modified

| File | Scope |
|------|-------|
| `routes/schedule_ops.py` | `complete_task`, `complete_split_task`, `uncomplete_task`, `confirm_overdue` |
| `routes/tasks.py` | `batch_tasks` complete action, `finish_task` |

---

### Task 1: `complete_task` — add `actual_end_min`

**File:** `routes/schedule_ops.py:210-260`

This function has two completion paths (split_group at line 239-241, normal at line 246-248). Both need `actual_end_min`. The initial `sch` query must also fetch `date`.

- [ ] **Step 1: Modify the `sch` query to include `date`**

Line 213:
```python
sch = conn.execute("SELECT task_id FROM schedules WHERE id=?", (sid,)).fetchone()
```

Change to:
```python
sch = conn.execute("SELECT task_id, date FROM schedules WHERE id=?", (sid,)).fetchone()
```

- [ ] **Step 2: Add `actual_end_min` computation before the split_group UPDATE**

After line 238 (closing of the `else` block inside split_group), insert:
```python
            now = datetime.datetime.now()
            sch_date = datetime.date.fromisoformat(sch["date"])
            actual_end_min = int((now - datetime.datetime.combine(sch_date, datetime.time(0, 0))).total_seconds() / 60)
```

- [ ] **Step 3: Modify the split_group UPDATE to include `actual_end_min`**

Lines 239-241:
```python
            conn.execute(
                "UPDATE schedules SET status=?, completed_at=? WHERE id=?",
                ("completed", datetime.datetime.now().isoformat(timespec="seconds"), sid),
            )
```

Change to:
```python
            conn.execute(
                "UPDATE schedules SET status=?, completed_at=?, actual_end_min=? WHERE id=?",
                ("completed", now.isoformat(timespec="seconds"), actual_end_min, sid),
            )
```

- [ ] **Step 4: Add `actual_end_min` computation before the normal-path UPDATE**

After line 245 (`return jsonify({"msg":"ok"})`) and before line 246 (`conn.execute(...`), insert:
```python
    now = datetime.datetime.now()
    if sch is None:
        sch = conn.execute("SELECT date FROM schedules WHERE id=?", (sid,)).fetchone()
    if sch:
        sch_date = datetime.date.fromisoformat(sch["date"])
        actual_end_min = int((now - datetime.datetime.combine(sch_date, datetime.time(0, 0))).total_seconds() / 60)
    else:
        actual_end_min = None
```

- [ ] **Step 5: Modify the normal-path UPDATE to include `actual_end_min`**

Lines 246-249:
```python
    conn.execute(
        "UPDATE schedules SET status=?, completed_at=? WHERE id=?",
        ("completed", datetime.datetime.now().isoformat(timespec="seconds"), sid),
    )
```

Change to:
```python
    conn.execute(
        "UPDATE schedules SET status=?, completed_at=?, actual_end_min=? WHERE id=?",
        ("completed", now.isoformat(timespec="seconds"), actual_end_min, sid),
    )
```

- [ ] **Step 6: Commit**

```bash
git add routes/schedule_ops.py
git commit -m "feat: set actual_end_min when completing a task via complete_task

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `complete_split_task` — add `actual_end_min`

**File:** `routes/schedule_ops.py:263-301`

- [ ] **Step 1: Modify the `sch` query to include `date`**

Line 271:
```python
sch = conn.execute("SELECT task_id FROM schedules WHERE id=?", (sid,)).fetchone()
```

Change to:
```python
sch = conn.execute("SELECT task_id, date FROM schedules WHERE id=?", (sid,)).fetchone()
```

- [ ] **Step 2: Compute `actual_end_min` and add to UPDATE**

Lines 295-298:
```python
    conn.execute(
        "UPDATE schedules SET status=?, completed_at=? WHERE id=?",
        ("completed", datetime.datetime.now().isoformat(timespec="seconds"), sid),
    )
```

Replace with:
```python
    now = datetime.datetime.now()
    sch_date = datetime.date.fromisoformat(sch["date"])
    actual_end_min = int((now - datetime.datetime.combine(sch_date, datetime.time(0, 0))).total_seconds() / 60)
    conn.execute(
        "UPDATE schedules SET status=?, completed_at=?, actual_end_min=? WHERE id=?",
        ("completed", now.isoformat(timespec="seconds"), actual_end_min, sid),
    )
```

- [ ] **Step 3: Commit**

```bash
git add routes/schedule_ops.py
git commit -m "feat: set actual_end_min when completing a split task

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `uncomplete_task` — clear `actual_end_min`

**File:** `routes/schedule_ops.py:304-316`

- [ ] **Step 1: Add `actual_end_min=NULL` to the UPDATE**

Lines 308-310:
```python
    conn.execute(
        "UPDATE schedules SET status=?, completed_at=NULL WHERE id=?",
        ("executing", sid),
    )
```

Change to:
```python
    conn.execute(
        "UPDATE schedules SET status=?, completed_at=NULL, actual_end_min=NULL WHERE id=?",
        ("executing", sid),
    )
```

- [ ] **Step 2: Commit**

```bash
git add routes/schedule_ops.py
git commit -m "fix: clear actual_end_min when uncompleting a task

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `confirm_overdue` — add `actual_end_min` and `completed_at`

**File:** `routes/schedule_ops.py:580-616`

The `confirm_overdue` action currently sets `status='completed'` but omits both `completed_at` and `actual_end_min`. Fix both gaps.

- [ ] **Step 1: Modify the UPDATEs to include `actual_end_min` and `completed_at`**

Lines 612-613:
```python
                        conn.execute("UPDATE tasks SET status=? WHERE id=?", ("已完成", int(tid)))
                        conn.execute("UPDATE schedules SET status=? WHERE id=?", ("completed", int(s["id"])))
```

Replace with:
```python
                        conn.execute("UPDATE tasks SET status=? WHERE id=?", ("已完成", int(tid)))
                        sch_date_obj = datetime.date.fromisoformat(s_date)
                        actual_end_min = int((now - datetime.datetime.combine(sch_date_obj, datetime.time(0, 0))).total_seconds() / 60)
                        conn.execute(
                            "UPDATE schedules SET status=?, completed_at=?, actual_end_min=? WHERE id=?",
                            ("completed", now.isoformat(timespec="seconds"), actual_end_min, int(s["id"])),
                        )
```

Note: `s_date` is already available from line 596 (`s_date = s["date"]`), and `now` from line 581 (`now = datetime.datetime.now()`).

- [ ] **Step 2: Commit**

```bash
git add routes/schedule_ops.py
git commit -m "fix: set actual_end_min and completed_at when confirming overdue tasks

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `batch_tasks` complete — add `actual_end_min` and `completed_at`

**File:** `routes/tasks.py:137-169`

The batch complete action (line 148-152) currently sets only `status='completed'` on schedules, missing both `completed_at` and `actual_end_min`. Use a SQL expression for `actual_end_min` to avoid per-row queries in a batch operation.

- [ ] **Step 1: Modify the complete action to include both fields**

Lines 148-152:
```python
    elif action == "complete":
        for tid in ids:
            conn.execute("UPDATE schedules SET status='completed' WHERE task_id=?", (int(tid),))
        conn.executemany("UPDATE tasks SET status='已完成' WHERE id=?", [(int(tid),) for tid in ids])
        msg = f"已完成 {len(ids)} 个任务"
```

Replace with:
```python
    elif action == "complete":
        now = datetime.datetime.now().isoformat(timespec="seconds")
        for tid in ids:
            conn.execute(
                "UPDATE schedules SET status='completed', completed_at=?,"
                " actual_end_min=CAST(strftime('%H','now','localtime') AS INTEGER)*60"
                " + CAST(strftime('%M','now','localtime') AS INTEGER)"
                " WHERE task_id=?",
                (now, int(tid)),
            )
        conn.executemany("UPDATE tasks SET status='已完成' WHERE id=?", [(int(tid),) for tid in ids])
        msg = f"已完成 {len(ids)} 个任务"
```

- [ ] **Step 2: Commit**

```bash
git add routes/tasks.py
git commit -m "fix: set actual_end_min and completed_at in batch_tasks complete action

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: `finish_task` — add `actual_end_min` and `completed_at`

**File:** `routes/tasks.py:325-338`

The `finish_task` endpoint sets schedules to completed but omits both `completed_at` and `actual_end_min`. Use the same SQL expression approach.

- [ ] **Step 1: Modify the UPDATE to include both fields**

Lines 334:
```python
    conn.execute("UPDATE schedules SET status='completed' WHERE task_id=? AND status!='completed'", (tid,))
```

Replace with:
```python
    now = datetime.datetime.now().isoformat(timespec="seconds")
    conn.execute(
        "UPDATE schedules SET status='completed', completed_at=?,"
        " actual_end_min=CAST(strftime('%H','now','localtime') AS INTEGER)*60"
        " + CAST(strftime('%M','now','localtime') AS INTEGER)"
        " WHERE task_id=? AND status!='completed'",
        (now, tid),
    )
```

- [ ] **Step 2: Commit**

```bash
git add routes/tasks.py
git commit -m "fix: set actual_end_min and completed_at in finish_task

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Final verification

- [ ] **Step 1: Restart the app and smoke test**

Start the app, then test each completion path:
1. Complete a single task via UI → verify `actual_end_min` is non-null in DB
2. Uncomplete it → verify `actual_end_min` is null
3. Complete a split task → verify `actual_end_min` is set
4. Batch complete → verify all schedules have `actual_end_min` and `completed_at`
5. Finish task → verify all schedules have `actual_end_min` and `completed_at`
6. Confirm overdue → verify completed schedules have both fields

- [ ] **Step 2: Verify Feishu push**

After completing a task locally, wait for sync cycle (or trigger manually). Verify the Feishu `实际结束` field is populated with a timestamp.

- [ ] **Step 3: Commit any fixes if needed**
