# Fix Filter失效 and Batch操作失效 After Task Operations

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two systemic bugs: (1) filter UI becomes stale after data operations because render functions are called without filter-sync in data-load paths; (2) batch selection breaks due to HID type mismatch and missing batch count updates after clear.

**Architecture:** Bug 1 root cause: `_loadHistory()` renders data with `_renderHistoryPage()` but never calls `filterHistoryTable()`, leaving filter UI stale after data reload. Same pattern in `finishTaskFromList`'s optimistic render. Bug 2 root cause: `_histBatchSet` mixes integers, strings, NaN, and null because `updateBatchCount` parseInt-s task-only HIDs and `toggleHistSelectAll` uses `null` for task-only records. Fix each call site precisely. No backend changes.

**Tech Stack:** Vanilla JavaScript (no libraries)

---

## Complete Call-Site Audit

Before writing fixes, every call site was audited:

### history.js — `_renderHistoryPage()` callers:

| Caller | Line | Does it sync filter UI? | Verdict |
|--------|------|------------------------|---------|
| `_loadHistory` | 355 | ❌ | **BUG** — data reload without filter sync |
| `filterHistoryTable` | 379 | ✅ (calls `_histSyncFilterUI` first) | OK |
| `histGoToPage` | 335 | ❌ | OK — pagination, filter state unchanged |
| `histSetPageSize` | 342 | ❌ | OK — pagination, filter state unchanged |

### task-table.js / task-edit.js — `_renderTaskPage()` callers:

| Caller | Line | Does it sync filter UI? | Verdict |
|--------|------|------------------------|---------|
| `_refreshTaskList` | 283 | ❌ (but `applyTaskFilters` at 286 covers) | Redundant — remove |
| `_refreshTaskList` | 286 (via `applyTaskFilters`) | ✅ | OK |
| `taskGoToPage` | 264 | ❌ | OK — pagination, filter state unchanged |
| `taskSetPageSize` | 271 | ❌ | OK — pagination, filter state unchanged |
| `finishTaskFromList` | 592 | ❌ | **BUG** — status change should trigger re-filter |
| `_renderTaskTable` | 300 | ❌ | Dead code (zero callers) — ignore |

**Key insight:** Pagination functions are fine calling `_render*Page()` directly because filter state hasn't changed — the UI is already correct from the last `filterHistoryTable()`/`applyTaskFilters()` call. Only data-load and data-mutation paths need fixing.

### history.js — `_histBatchSet` manipulation:

| Function | Line | Writes to set | Verdict |
|----------|------|---------------|---------|
| `updateBatchCount` | 602 | `parseInt(data-hid)` → NaN for "t123" | **BUG** |
| `toggleHistSelectAll` | 591 | `filtered[i].id` → null for task-only | **BUG** |
| `_loadHistory` | 346 | `.clear()` without `updateBatchCount()` | **BUG** |
| `toggleHistoryBatchMode` | 572 | `.clear()` then `updateBatchCount()` | OK |

### task-table.js — `_taskBatchSet` manipulation:

| Function | Line | Writes to set | Verdict |
|----------|------|---------------|---------|
| `_refreshTaskList` | 275 | `.clear()` without `updateTaskBatchCount()` | **BUG** |
| `toggleTaskBatchMode` | 355 | `.clear()` then `updateTaskBatchCount()` | OK |

---

### Task 1: Fix `_loadHistory` to sync filter UI after data load

**Files:**
- Modify: `static/history.js:345-361`

- [ ] **Step 1: Replace `_renderHistoryPage()` with `filterHistoryTable()` in `_loadHistory`**

`_loadHistory` is the primary data-load path for history. It fetches new data and needs to sync the filter UI. Change the `.then()` callback:

```javascript
// Before (lines 351-358):
fetch('/api/history_schedules'+qs)
.then(function(r){return r.json();}).then(function(d){
    SCHEDULES_HISTORY = d.history || [];
    _histPage = 0;
    _renderHistoryPage();
    switchHistoryModeBtn(currentHistoryMode);
    _loadHistoryPackages();
})

// After:
fetch('/api/history_schedules'+qs)
.then(function(r){return r.json();}).then(function(d){
    SCHEDULES_HISTORY = d.history || [];
    _histPage = 0;
    filterHistoryTable();
    switchHistoryModeBtn(currentHistoryMode);
    _loadHistoryPackages();
})
```

`filterHistoryTable()` does everything `_renderHistoryPage()` does PLUS:
- `_histSyncFilterUI()` — syncs trigger buttons, condition tags, reset button
- Search clear button visibility
- Date badge

This also fixes `filterHistory` (line 367) transitively — it delegates to `_loadHistory`.

Note: `filterHistoryTable()` sets `_histPage = 0` at line 377, which is redundant with the existing `_histPage = 0` at line 354. Not a problem — we can optionally remove the duplicate. Let's keep both for safety (defense in depth).

- [ ] **Step 2: Commit**

```bash
git add static/history.js
git commit -m "fix: sync history filter UI after data reload in _loadHistory

_loadHistory now calls filterHistoryTable() instead of bare
_renderHistoryPage(), so filter condition tags, trigger button
labels, search clear button, and date badge are re-synced after
every history data fetch (including after recycle operations).

This also transitively fixes filterHistory() which delegates
to _loadHistory().

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Fix `finishTaskFromList` optimistic render to sync filter

**Files:**
- Modify: `static/task-edit.js:585-603`

- [ ] **Step 1: Replace `_renderTaskPage()` with `applyTaskFilters()`**

When a task is marked "已完成", it should immediately disappear from the table (because `_getFilteredAndSortedTasks` excludes "已完成" status). The current code calls `_renderTaskPage()` which re-renders WITH the filter applied but WITHOUT syncing the filter UI. Change to `applyTaskFilters()`:

```javascript
// Before (task-edit.js lines 585-603):
function finishTaskFromList(tid){
    showConfirm('完成任务', '<p>标记该任务已完成？</p>').then(function(ok){
        if(!ok) return;
        var t = getTaskById(tid);
        if (t) t.status = '已完成';
        document.querySelectorAll('.task-block[data-tid="'+tid+'"]').forEach(function(b){ b.classList.add('task-completed'); });
        schedules.forEach(function(s){ if(s.task_id == tid) s.status = 'completed'; });
        _renderTaskPage();
        _renderTaskPool();
        refreshLiveStatus();
        fetch('/finish_task',{
            method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({task_id: tid})
        }).then(function(r){ return r.json(); }).then(function(d){
            showToast(d.msg);
            _silentRefresh();
        });
    });
}

// After:
function finishTaskFromList(tid){
    showConfirm('完成任务', '<p>标记该任务已完成？</p>').then(function(ok){
        if(!ok) return;
        var t = getTaskById(tid);
        if (t) t.status = '已完成';
        document.querySelectorAll('.task-block[data-tid="'+tid+'"]').forEach(function(b){ b.classList.add('task-completed'); });
        schedules.forEach(function(s){ if(s.task_id == tid) s.status = 'completed'; });
        applyTaskFilters();
        _renderTaskPool();
        refreshLiveStatus();
        fetch('/finish_task',{
            method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({task_id: tid})
        }).then(function(r){ return r.json(); }).then(function(d){
            showToast(d.msg);
            _silentRefresh();
        });
    });
}
```

`applyTaskFilters()` sets `_taskPage = 0`, calls `_taskSyncFilterUI()` (syncs trigger buttons, condition tags), then calls `_renderTaskPage()` (re-renders filtered data). Since "已完成" is excluded by `_getFilteredAndSortedTasks`, the completed task disappears immediately.

- [ ] **Step 2: Commit**

```bash
git add static/task-edit.js
git commit -m "fix: sync task filter UI on optimistic complete render

finishTaskFromList now calls applyTaskFilters() instead of bare
_renderTaskPage(), so the completed task is immediately filtered
out and the filter UI stays in sync during the optimistic update.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Remove redundant unsynced render in `_refreshTaskList`

**Files:**
- Modify: `static/task-table.js:274-293`

- [ ] **Step 1: Remove the first `_renderTaskPage()` call (line 283)**

`_refreshTaskList` currently renders twice — once unsynced at line 283, then correctly at line 286 via `applyTaskFilters()`. Remove the first call:

```javascript
// Before (.then callback, lines 279-289):
.then(function(d){
    TASKS_DATA = d.tasks;
    for (var i = 0; i < TASKS_DATA.length; i++) { TASKS_DATA[i]._origStatus = TASKS_DATA[i].status; }
    _taskPage = 0;
    _taskScheduleMap = _buildTaskScheduleMap();
    _renderTaskPage();
    _renderTaskPool();
    buildSplitIndex();
    applyTaskFilters();
    refreshLiveStatus();
    toggleDurationUnit();
    _refreshTaskPackages();
})

// After:
.then(function(d){
    TASKS_DATA = d.tasks;
    for (var i = 0; i < TASKS_DATA.length; i++) { TASKS_DATA[i]._origStatus = TASKS_DATA[i].status; }
    _taskPage = 0;
    _taskScheduleMap = _buildTaskScheduleMap();
    _renderTaskPool();
    buildSplitIndex();
    applyTaskFilters();
    refreshLiveStatus();
    toggleDurationUnit();
    _refreshTaskPackages();
})
```

Only one line removed: `_renderTaskPage();` at old line 283. `applyTaskFilters()` at old line 286 now handles the single correct render.

- [ ] **Step 2: Commit**

```bash
git add static/task-table.js
git commit -m "refactor: remove redundant unsynced render in _refreshTaskList

_refreshTaskList was calling _renderTaskPage() twice per refresh —
once unsynced (without filter UI sync), then again via
applyTaskFilters(). Remove the first call; applyTaskFilters()
handles the single correct render with full filter UI sync.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Fix history batch selection HID type mismatch

**Files:**
- Modify: `static/history.js:600-610` (updateBatchCount)
- Modify: `static/history.js:581-598` (toggleHistSelectAll)

- [ ] **Step 1: Fix `updateBatchCount` — remove `parseInt`**

```javascript
// Before (lines 600-610):
function updateBatchCount(){
    document.querySelectorAll('.hist-check').forEach(function(cb) {
        var hid = parseInt(cb.dataset.hid, 10);
        if (cb.checked) {
            _histBatchSet.add(hid);
        } else {
            _histBatchSet.delete(hid);
        }
    });
    document.getElementById('batch-count').textContent = '已选 ' + _histBatchSet.size + ' 条';
}

// After:
function updateBatchCount(){
    document.querySelectorAll('.hist-check').forEach(function(cb) {
        var hid = cb.dataset.hid;
        if (cb.checked) {
            _histBatchSet.add(hid);
        } else {
            _histBatchSet.delete(hid);
        }
    });
    document.getElementById('batch-count').textContent = '已选 ' + _histBatchSet.size + ' 条';
}
```

One-word change: `parseInt(cb.dataset.hid, 10)` → `cb.dataset.hid`. The `_histBatchSet` now consistently contains string HIDs: `"123"` for regular records, `"t123"` for task-only.

- [ ] **Step 2: Fix `toggleHistSelectAll` — compute correct HID**

```javascript
// Before (lines 589-596):
    if (all) {
        for (var i = 0; i < filtered.length; i++) {
            _histBatchSet.add(filtered[i].id);
        }
    } else {
        for (var i = 0; i < filtered.length; i++) {
            _histBatchSet.delete(filtered[i].id);
        }
    }

// After:
    if (all) {
        for (var i = 0; i < filtered.length; i++) {
            var s = filtered[i];
            var hid = (s.record_type === 'task_only') ? ('t' + s.task_id) : String(s.id);
            _histBatchSet.add(hid);
        }
    } else {
        for (var i = 0; i < filtered.length; i++) {
            var s = filtered[i];
            var hid = (s.record_type === 'task_only') ? ('t' + s.task_id) : String(s.id);
            _histBatchSet.delete(hid);
        }
    }
```

This mirrors the HID computation in `_renderHistoryTableRows` (line 209): `var hid = isTaskOnly ? ('t' + s.task_id) : s.id`. Note: `String(s.id)` wraps regular record IDs in String for consistency with `data-hid` attribute (which is always a string).

- [ ] **Step 3: Commit**

```bash
git add static/history.js
git commit -m "fix: history batch selection with consistent HID types

updateBatchCount: removed parseInt so 't123' task-only HIDs are
preserved instead of becoming NaN.
toggleHistSelectAll: now computes correct HID for task-only records
(record_type === 'task_only' ? 't' + task_id : String(id)) instead
of using null (filtered[i].id is NULL for task-only DB rows).

_histBatchSet now consistently contains string HIDs matching the
data-hid attribute format for all record types.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Fix `batchRecallHistory` to split schedule_ids and task_ids

**Files:**
- Modify: `static/history.js:614-622`

- [ ] **Step 1: Implement split logic**

```javascript
// Before (lines 614-622):
function batchRecallHistory(){
    var ids = _getCheckedHistIds();
    if(ids.length===0){ showToast('请先选择记录'); return; }
    recycleTasks({
        scheduleIds: ids,
        confirmTitle: '批量回收',
        confirmMsg: '确定回收 '+ids.length+' 条排班记录？',
        onSuccess: _refreshHistory
    });
}

// After:
function batchRecallHistory(){
    var ids = _getCheckedHistIds();
    if(ids.length===0){ showToast('请先选择记录'); return; }
    var scheduleIds = [];
    var taskIds = [];
    ids.forEach(function(hid) {
        // hid is a string: "123" for regular, "t123" for task-only
        if (typeof hid === 'string' && hid.charAt(0) === 't') {
            taskIds.push(parseInt(hid.substring(1), 10));
        } else {
            scheduleIds.push(parseInt(hid, 10));
        }
    });
    var totalCount = scheduleIds.length + taskIds.length;
    if (totalCount === 0) { showToast('请先选择记录'); return; }
    var payload = {};
    if (scheduleIds.length > 0) payload.scheduleIds = scheduleIds;
    if (taskIds.length > 0) payload.taskIds = taskIds;
    payload.confirmTitle = '批量回收';
    payload.confirmMsg = '确定回收 ' + totalCount + ' 条记录？';
    payload.onSuccess = _refreshHistory;
    recycleTasks(payload);
}
```

The `/api/recycle` endpoint (routes/tasks.py:116) accepts both `schedule_ids` and `task_ids` in one request:

```python
schedule_ids = d.get("schedule_ids")
task_ids = d.get("task_ids")
...
on_local_recycle(conn, schedule_ids=schedule_ids, task_ids=task_ids, ...)
count, affected = recycle_schedules(conn, schedule_ids=..., task_ids=..., ...)
```

No backend changes needed. The `on_local_recycle` call already handles both parameter types.

- [ ] **Step 2: Commit**

```bash
git add static/history.js
git commit -m "fix: batch recall from history splits schedule_ids and task_ids

batchRecallHistory now separates the batch set into scheduleIds
(plain numeric HIDs like '123') and taskIds (extracted from 'tXXX'
HIDs like 't456') before calling recycleTasks. The /api/recycle
endpoint already handles mixed schedule_ids + task_ids in one call.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Fix batch count display after clearing batch sets

**Files:**
- Modify: `static/task-table.js:274-293` (_refreshTaskList)
- Modify: `static/history.js:345-361` (_loadHistory)

- [ ] **Step 1: Fix `_refreshTaskList` (task-table.js)**

After `_taskBatchSet.clear()`, call `updateTaskBatchCount()` so the display resets to "已选 0 项":

```javascript
// Before:
function _refreshTaskList(){
    _taskBatchSet.clear();
    fetch('/api/tasks')

// After:
function _refreshTaskList(){
    _taskBatchSet.clear();
    updateTaskBatchCount();
    fetch('/api/tasks')
```

`updateTaskBatchCount` is defined in the same file (task-table.js:383), so no guard needed.

- [ ] **Step 2: Fix `_loadHistory` (history.js)**

After `_histBatchSet.clear()`, call `updateBatchCount()` so the display resets to "已选 0 条":

```javascript
// Before:
function _loadHistory(dateFrom, dateTo){
    _histBatchSet.clear();
    var params = [];

// After:
function _loadHistory(dateFrom, dateTo){
    _histBatchSet.clear();
    updateBatchCount();
    var params = [];
```

`updateBatchCount` is defined in the same file (history.js:600), so no guard needed.

- [ ] **Step 3: Commit**

```bash
git add static/task-table.js static/history.js
git commit -m "fix: update batch count display after clearing batch sets

_refreshTaskList and _loadHistory now call updateTaskBatchCount /
updateBatchCount immediately after clearing their batch sets, so
the count display resets to 0 instead of showing stale selection
counts from before the refresh.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Verification

### Bug 1 — Filter UI correct after operations:

**History tab:**
1. Apply a type filter (e.g., "BR2") → condition tag "机型: BR2" visible, table filtered
2. Recycle a history record → **verify** condition tag still shows, trigger button "已选 1 项 ▾", table still filtered
3. Click × to remove condition → **verify** all records shown, condition tags cleared
4. Change date range → **verify** data reloads, filter UI still synced

**Task library tab:**
5. Apply a type filter, then mark a task "已完成" → **verify** task immediately disappears from table (filtered out), condition tag unchanged
6. Recycle a task → **verify** filter survives refresh

### Bug 2 — Batch operations work:

**History tab:**
1. Switch to batch mode
2. Check a regular (scheduled) record → count "已选 1 条"
3. Check a task-only record (灰色行, "无分配记录") → count "已选 2 条"
4. Check both are correctly counted
5. Click "全选" → all records selected (including task-only)
6. Click "批量回收" → confirm both types go to server (check browser Network tab — payload should have both `schedule_ids` and `task_ids`)

**Task library tab:**
7. Switch to batch mode, select 3 tasks → count "已选 3 项"
8. Recycle one via individual button → **verify** count resets to "已选 0 项", all unchecked

---

### Self-Review

**1. Spec coverage:**
- ✅ Bug 1 "筛选失效" → Task 1 (_loadHistory → filterHistoryTable), Task 2 (finishTaskFromList → applyTaskFilters), Task 3 (remove redundant render)
- ✅ Bug 2 "批量操作失去作用" → Task 4 (HID type fix), Task 5 (split schedule/task IDs), Task 6 (batch count after clear)

**2. Placeholder scan:**
- No TBD, TODO, or "implement later"
- All code changes shown inline with before/after
- `_renderTaskTable` (dead code) documented as intentionally skipped
- Pagination functions documented as intentionally kept as-is (filter state unchanged)

**3. Type consistency:**
- `_histBatchSet`: `Set<string>` — `"123"` for regular, `"t123"` for task-only
- `_taskBatchSet`: `Set<number>` (unchanged)
- `data-hid`: always string from DOM attribute
- `updateBatchCount`: reads string, stores string — consistent
- `toggleHistSelectAll`: computes string HID — consistent with `_renderHistoryTableRows` line 209
- `batchRecallHistory`: splits by `'t'` prefix — consistent with HID encoding
