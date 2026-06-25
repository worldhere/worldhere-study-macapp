# Merge "已确认" → "已完成" Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the dual status ("已完成" / "已确认") by fixing the one write path that creates "已确认", running a DB migration, and updating UI copy — all while keeping frontend defensive guards.

**Architecture:** Three independent changes across three files. No new functions, no API changes, no tests needed (data normalization + string changes). The migration is a single idempotent UPDATE added to init_db().

**Tech Stack:** Python/Flask (backend), vanilla JS (frontend), SQLite (DB)

---

### Task 1: Fix the write path — routes/schedule_ops.py

**Files:**
- Modify: `routes/schedule_ops.py:612,616`

- [ ] **Step 1: Change the status value written on confirm_overdue**

Replace line 612 from `"已确认"` to `"已完成"`:

```python
# Line 612: Before
                        conn.execute("UPDATE tasks SET status=? WHERE id=?", ("已确认", int(tid)))

# After
                        conn.execute("UPDATE tasks SET status=? WHERE id=?", ("已完成", int(tid)))
```

Replace line 616 toast message:

```python
# Line 616: Before
            return jsonify({"msg": f"已确认 {confirmed} 个过时任务"})

# After
            return jsonify({"msg": f"已标记完成 {confirmed} 个过时任务"})
```

- [ ] **Step 2: Verify no other write paths produce "已确认"**

```bash
grep -rn '"已确认"' routes/ *.py models/ *.py
```

Expected: Only the line we just changed (line 612) should have shown. After the edit, zero occurrences in Python files.

- [ ] **Step 3: Commit**

```bash
git add routes/schedule_ops.py
git commit -m "fix: write 已完成 instead of 已确认 on confirm_overdue

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Database migration — db.py

**Files:**
- Modify: `db.py` (add after line 644, before `conn.close()`)

- [ ] **Step 1: Add idempotent data migration in init_db()**

Insert after the feishu default config block (after line 644, before `conn.close()` on line 646):

```python
    # 数据迁移：统一历史遗留的 "已确认" 状态为 "已完成"
    cur.execute("UPDATE tasks SET status='已完成' WHERE status='已确认'")
    conn.commit()
```

The UPDATE is naturally idempotent — after first execution, no rows with `status='已确认'` remain, so subsequent runs are no-ops.

- [ ] **Step 2: Commit**

```bash
git add db.py
git commit -m "feat: add data migration to merge 已确认 into 已完成

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Update frontend copy — static/timeline-ops.js

**Files:**
- Modify: `static/timeline-ops.js:188,258`

- [ ] **Step 1: Update the button description text (line 188)**

```javascript
// Line 188: Before
            '<span class="qo-btn-desc">将已过期但未完成的任务标记为"已确认"，排班同步标记为已完成。维修停用机器上的任务会跳过。</span>'+

// After
            '<span class="qo-btn-desc">将已过期但未完成的任务标记为"已完成"，排班同步标记为已完成。维修停用机器上的任务会跳过。</span>'+
```

- [ ] **Step 2: Update the confirmation dialog text (line 258)**

```javascript
// Line 258: Before
            '<p style="font-size:12px;color:var(--text-muted);">过期未完成且机器非维修停用的任务将被标记为"已确认"，排班标记为已完成。维修停用机器上的任务会跳过。</p>');

// After
            '<p style="font-size:12px;color:var(--text-muted);">过期未完成且机器非维修停用的任务将被标记为"已完成"，排班标记为已完成。维修停用机器上的任务会跳过。</p>');
```

- [ ] **Step 3: Confirm no other "已确认" text remains in JS**

```bash
grep -n '已确认' static/*.js
```

Expected: Only hits in `task-table.js:89` and `task-status.js:81,91` (the defensive guards we're keeping). Zero hits in `timeline-ops.js`.

- [ ] **Step 4: Commit**

```bash
git add static/timeline-ops.js
git commit -m "fix: update confirm_overdue UI copy from 已确认 to 已完成

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Final verification

- [ ] **Step 1: Run grep to confirm zero "已确认" in production code (excluding defensive guards)**

```bash
grep -rn '"已确认"' routes/ models/ db.py
```

Expected: Zero matches.

```bash
grep -n '已确认' static/*.js
```

Expected: Only `task-table.js:89` and `task-status.js:81,91` (defensive guards kept intentionally).

- [ ] **Step 2: Start the app and verify it boots without errors**

```bash
python app.py
```

Expected: App starts, DB migration runs without error, homepage loads.

- [ ] **Step 3: Verify migration was applied**

Open the DB and check:

```sql
SELECT COUNT(*) FROM tasks WHERE status = '已确认';
```

Expected: `0`.

- [ ] **Step 4: Verify task package stats work**

Create or find a task package that previously had mis-counted stats. Check that the package card shows correct completed/total numbers.

---

## Summary

| Task | File | Change |
|------|------|--------|
| 1 | `routes/schedule_ops.py:612,616` | Write `"已完成"` instead of `"已确认"`, update toast |
| 2 | `db.py` ~line 645 | Idempotent `UPDATE tasks SET status='已完成' WHERE status='已确认'` |
| 3 | `static/timeline-ops.js:188,258` | Update UI copy in two places |
| 4 | Verification | grep checks + app smoke test |

**Not changed (intentionally):**
- `static/task-table.js:89` — `'已确认'` guard kept
- `static/task-status.js:81,91` — `'已确认'` guard kept
- All backend `status='已完成'` checks — already correct, no changes needed
