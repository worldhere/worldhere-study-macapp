# Task Library & History Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor task library and history tables from DOM-driven rendering to array-driven rendering with client-side pagination, sequence numbers, and cross-page batch selection.

**Architecture:** Replace direct DOM manipulation with a pipeline: API data → JS arrays → filter/search/sort (pure array ops) → slice(page) → render current page to DOM. Expose `getTaskById(tid)` so timeline code reads task data from the array instead of querying table DOM.

**Tech Stack:** Vanilla JS (ES5-compatible), Flask/Jinja2 templates, SQLite

---

## File Structure

| File | Role |
|------|------|
| `static/tasks.js` | Task data array, pipeline, pagination, rendering, batch selection, pool extraction |
| `static/history.js` | History data array, same pipeline + pagination pattern |
| `templates/panels/tasks.html` | `#` column in theads, pagination control container |
| `templates/panels/history.html` | `#` column in theads, pagination control container |
| `static/timeline-render.js` | `syncTaskTableTime()` → use `getTaskById()` |
| `static/timeline-ops.js` | Edit dialog populate → use `getTaskById()` |
| `static/timeline-drag.js` | Drag assign → use `getTaskById()` |
| `static/core.js` | Batch status update, status text → use `getTaskById()` |
| `static/style.css` | Pagination bar, `#` column, page size select styles |

---

### Task 1: Add TASKS_DATA array, getTaskById(), and pagination state to tasks.js

**Files:**
- Modify: `static/tasks.js` (near top, after existing var declarations)

- [ ] **Step 1: Add module-level variables**

At the top of `tasks.js` (after line 1 comment, before any function), add:

```js
// ========== 数据与分页状态 ==========
var TASKS_DATA = [];
var _taskPage = 0;
var _taskPageSize = (function(){
    try { var v = parseInt(localStorage.getItem('taskPageSize'), 10); return (v === 20 || v === 50 || v === 100) ? v : 20; }
    catch(e) { return 20; }
})();
var _taskBatchSet = new Set();

/** 根据 id 从 TASKS_DATA 中查找任务对象，供时间轴等外部模块使用 */
function getTaskById(tid) {
    for (var i = 0; i < TASKS_DATA.length; i++) {
        if (TASKS_DATA[i].id === tid) return TASKS_DATA[i];
    }
    return null;
}
```

- [ ] **Step 2: Verify the file still loads without errors**

Start the app, open browser console, type `getTaskById` — should return the function. Type `TASKS_DATA` — should return `[]`.

---

### Task 2: Build the filter+search+sort pipeline (array operations)

**Files:**
- Modify: `static/tasks.js`

- [ ] **Step 1: Add `_taskMatchesSearch()` — pure function on task object**

```js
function _taskMatchesSearch(t, term) {
    if (!term) return true;
    var fields = [t.name, t.type, t.task_kind, t.rbp_task_id, t.priority || '', t.difficulty || '', t.remark || '', t.scene || '', t.general_category || ''];
    for (var i = 0; i < fields.length; i++) {
        if (fields[i].toLowerCase().indexOf(term) !== -1) return true;
    }
    return false;
}
```

- [ ] **Step 2: Add `_sortTaskData()` — sort array of task objects by column**

```js
function _sortTaskData(arr, colKey, dir) {
    if (!arr.length || dir === 0) return;
    var STATUS_ORDER = ['待分配','已分配','采集中','采集即将完成','暂停中','暂停即将超时','过时待确认','已完成'];
    arr.sort(function(a, b) {
        var av, bv;
        if (colKey === 'status') {
            av = STATUS_ORDER.indexOf(a.status); if (av === -1) av = 999;
            bv = STATUS_ORDER.indexOf(b.status); if (bv === -1) bv = 999;
        } else if (colKey === 'dur') {
            av = a.est_seconds != null ? a.est_seconds : (a.est_minutes != null ? a.est_minutes * 60 : 0);
            bv = b.est_seconds != null ? b.est_seconds : (b.est_minutes != null ? b.est_minutes * 60 : 0);
        } else if (colKey === 'name') { av = a.name || ''; bv = b.name || ''; }
        else if (colKey === 'type') { av = a.type || ''; bv = b.type || ''; }
        else if (colKey === 'kind') { av = a.task_kind || ''; bv = b.task_kind || ''; }
        else if (colKey === 'pri') { av = a.priority || ''; bv = b.priority || ''; }
        else if (colKey === 'diff') { av = a.difficulty || ''; bv = b.difficulty || ''; }
        else { av = a[colKey] || ''; bv = b[colKey] || ''; }
        if (typeof av === 'string') { var cmp = av.localeCompare(bv); return dir === 1 ? cmp : -cmp; }
        return dir === 1 ? av - bv : bv - av;
    });
}
```

- [ ] **Step 3: Add `_getFilteredAndSortedTasks()` — the pipeline**

```js
function _getFilteredAndSortedTasks() {
    var ft = document.getElementById('task-filter-type').value;
    var fk = document.getElementById('task-filter-kind').value;
    var fs = document.getElementById('task-filter-status').value;
    var searchTerm = _getTaskSearchTerm();

    // 1. Filter: active tasks + dropdown filters
    var filtered = [];
    for (var i = 0; i < TASKS_DATA.length; i++) {
        var t = TASKS_DATA[i];
        if (t.status === '已完成' || t.status === '已确认') continue;
        if (ft && t.type !== ft) continue;
        if (fk && t.task_kind !== fk) continue;
        if (fs && t.status !== fs) continue;
        filtered.push(t);
    }

    // 2. Search: matching first, then non-matching
    var matching = [];
    var nonMatching = [];
    if (searchTerm) {
        for (var i = 0; i < filtered.length; i++) {
            if (_taskMatchesSearch(filtered[i], searchTerm)) {
                matching.push(filtered[i]);
            } else {
                nonMatching.push(filtered[i]);
            }
        }
    } else {
        matching = filtered;
    }

    // 3. Sort matching group
    if (taskSortState.direction > 0 && taskSortState.column) {
        _sortTaskData(matching, taskSortState.column, taskSortState.direction);
    }

    return matching.concat(nonMatching);
}
```

---

### Task 3: Build pagination render function and controls UI

**Files:**
- Modify: `static/tasks.js`

- [ ] **Step 1: Add `_renderTaskPage()` — render current page rows to both tables**

This replaces the body of `_renderTaskTable()`. It writes rows to both simple and detail tbody.

```js
function _renderTaskPage() {
    var filtered = _getFilteredAndSortedTasks();
    var totalFiltered = filtered.length;
    var totalPages = Math.max(1, Math.ceil(totalFiltered / _taskPageSize));

    // Clamp page
    if (_taskPage >= totalPages) _taskPage = totalPages - 1;
    if (_taskPage < 0) _taskPage = 0;

    var start = _taskPage * _taskPageSize;
    var end = Math.min(start + _taskPageSize, totalFiltered);
    var pageItems = filtered.slice(start, end);

    _renderTaskTableRows(pageItems, start, totalFiltered);
    _renderPaginationBar(totalFiltered, totalPages);
}
```

- [ ] **Step 2: Add `_renderTaskTableRows()` — write rows to simple + detail tbodies**

```js
function _renderTaskTableRows(pageItems, startOffset, totalFiltered) {
    var batchOn = document.getElementById('task-batch-mode') && document.getElementById('task-batch-mode').checked;

    // === 简易表格 ===
    var simpleHtml = '';
    for (var i = 0; i < pageItems.length; i++) {
        var t = pageItems[i];
        var seq = startOffset + i + 1;
        var durDisplay = '';
        if (t.est_seconds != null) { durDisplay = Math.round(t.est_seconds / 60); }
        else if (t.est_minutes != null) { durDisplay = t.est_minutes; }
        var schInfo = _taskScheduleMap && _taskScheduleMap[t.id];
        var assignedDisplay = '';
        if (schInfo && schInfo.absStart !== undefined && schInfo.absEnd !== undefined) {
            assignedDisplay = schInfo.machine_name + ' ' + (typeof _formatAbsRange === 'function' ? _formatAbsRange(schInfo.absStart, schInfo.absEnd) : '');
        }
        var checked = _taskBatchSet.has(t.id) ? ' checked' : '';
        simpleHtml += '<tr data-tid="' + t.id + '" data-orig-index="' + i + '" data-status="' + escHtml(t.status||'') + '" data-type="' + escHtml(t.type||'') + '" data-kind="' + escHtml(t.task_kind||'') + '" data-sec="' + (t.est_seconds||'') + '" data-name="' + escHtml(t.name||'') + '" data-pri="' + escHtml(t.priority||'') + '" data-diff="' + escHtml(t.difficulty||'') + '" data-dur="' + escHtml(t.duration||'') + '" data-estmode="' + (t.est_mode||'blank') + '" data-op="' + (t.op_min||'') + '" data-reset="' + (t.reset_min||'') + '" data-cnt="' + _valOr(t.collect_count) + '" data-red="' + (t.redundancy_min||'') + '" data-remark="' + escHtml(t.remark||'') + '" data-rbp="' + escHtml(t.rbp_task_id||'') + '" data-scene="' + escHtml(t.scene||'') + '" data-gcat="' + escHtml(t.general_category||'') + '" data-slink="' + escHtml(t.source_link||'') + '" data-expcnt="' + _valOr(t.expected_count) + '" data-creqid="' + escHtml(t.collection_req_id||'') + '" data-creqtype="' + escHtml(t.collection_req_type||'') + '" data-split-group="' + escHtml(t.split_group||'') + '" data-split-order="' + (t.split_order||'') + '">' +
            '<td class="batch-col" style="display:' + (batchOn?'':'none') + ';"><input type="checkbox" class="batch-check" data-tid="' + t.id + '" onchange="updateTaskBatchCount()"' + checked + '></td>' +
            '<td class="seq-col">' + seq + '</td>' +
            '<td>' + escHtml(t.name) + '</td>' +
            '<td>' + escHtml(t.type) + '</td>' +
            '<td>' + escHtml(t.task_kind) + '</td>' +
            '<td>' + escHtml(t.priority||'') + '</td>' +
            '<td>' + escHtml(t.difficulty||'') + '</td>' +
            '<td class="dur-cell" data-sec="' + (t.est_seconds||'') + '">' + durDisplay + '</td>' +
            '<td><span class="task-status-text" data-tid="' + t.id + '" data-orig="' + escHtml(t.status||'') + '">' + escHtml(t.status) + '</span></td>' +
            '<td>' + escHtml(assignedDisplay) + '</td>' +
            '<td class="action-btns">' +
                '<button class="btn" onclick="openAssignDialog(' + t.id + ')">指派</button>' +
                '<button onclick="recallTaskToPool(' + t.id + ')">回收</button>' +
                '<button onclick="finishTaskFromList(' + t.id + ')">已完成</button>' +
                '<button onclick="openEditDrawer(' + t.id + ')">修改</button>' +
                '<button class="btn-danger" onclick="delTask(' + t.id + ')">删除</button>' +
            '</td></tr>';
    }
    var simpleTbody = document.querySelector('#task-table tbody');
    if (simpleTbody) { simpleTbody.innerHTML = simpleHtml; }

    // === 详细表格 ===
    var detailHtml = '';
    for (var i = 0; i < pageItems.length; i++) {
        var t = pageItems[i];
        var seq = startOffset + i + 1;
        var checked = _taskBatchSet.has(t.id) ? ' checked' : '';
        detailHtml += '<tr data-tid="' + t.id + '" data-orig-index="' + i + '" data-status="' + escHtml(t.status||'') + '" data-type="' + escHtml(t.type||'') + '" data-kind="' + escHtml(t.task_kind||'') + '" data-sec="' + (t.est_seconds||'') + '" data-name="' + escHtml(t.name||'') + '" data-pri="' + escHtml(t.priority||'') + '" data-diff="' + escHtml(t.difficulty||'') + '" data-dur="' + escHtml(t.duration||'') + '" data-estmode="' + (t.est_mode||'blank') + '" data-op="' + (t.op_min||'') + '" data-reset="' + (t.reset_min||'') + '" data-cnt="' + _valOr(t.collect_count) + '" data-red="' + (t.redundancy_min||'') + '" data-remark="' + escHtml(t.remark||'') + '" data-rbp="' + escHtml(t.rbp_task_id||'') + '" data-scene="' + escHtml(t.scene||'') + '" data-gcat="' + escHtml(t.general_category||'') + '" data-slink="' + escHtml(t.source_link||'') + '" data-expcnt="' + _valOr(t.expected_count) + '" data-creqid="' + escHtml(t.collection_req_id||'') + '" data-creqtype="' + escHtml(t.collection_req_type||'') + '" data-split-group="' + escHtml(t.split_group||'') + '" data-split-order="' + (t.split_order||'') + '">' +
            '<td class="batch-col" style="display:' + (batchOn?'':'none') + ';"><input type="checkbox" class="batch-check" data-tid="' + t.id + '" onchange="updateTaskBatchCount()"' + checked + '></td>' +
            '<td class="seq-col">' + seq + '</td>' +
            '<td>' + escHtml(t.name) + '</td>' +
            '<td>' + escHtml(t.type) + '</td>' +
            '<td>' + escHtml(t.priority||'') + '</td>' +
            '<td>' + escHtml(t.rbp_task_id||'') + '</td>' +
            '<td><span class="task-status-text" data-tid="' + t.id + '" data-orig="' + escHtml(t.status||'') + '">' + escHtml(t.status) + '</span></td>' +
            '<td>' + escHtml(t.scene||'') + '</td>' +
            '<td>' + escHtml(t.task_kind) + '</td>' +
            '<td>' + escHtml(t.general_category||'') + '</td>' +
            '<td>' + (t.source_link ? '<a href="' + escHtml(t.source_link) + '" target="_blank" style="color:#1976d2;">链接</a>' : '') + '</td>' +
            '<td>' + (t.expected_count || '') + '</td>' +
            '<td>' + (t.collection_req_id || '') + '</td>' +
            '<td>' + (t.collection_req_type || '') + '</td>' +
            '<td class="action-btns">' +
                '<button class="btn" onclick="openAssignDialog(' + t.id + ')">指派</button>' +
                '<button onclick="recallTaskToPool(' + t.id + ')">回收</button>' +
                '<button onclick="finishTaskFromList(' + t.id + ')">已完成</button>' +
                '<button onclick="openEditDrawer(' + t.id + ')">修改</button>' +
                '<button class="btn-danger" onclick="delTask(' + t.id + ')">删除</button>' +
            '</td></tr>';
    }
    var detailTbody = document.querySelector('#task-table-detail tbody');
    if (detailTbody) { detailTbody.innerHTML = detailHtml; }
}
```

- [ ] **Step 3: Add `_renderPaginationBar()` — page controls + row count**

```js
function _renderPaginationBar(totalFiltered, totalPages) {
    var bar = document.getElementById('task-pagination-bar');
    if (!bar) return;

    var totalAll = TASKS_DATA.length;
    var html = '';

    // Prev button
    html += '<button class="page-btn" onclick="taskGoToPage(' + (_taskPage - 1) + ')"' + (_taskPage <= 0 ? ' disabled' : '') + '>← 上一页</button>';

    // Page numbers (max 7 visible, collapse middle with ...)
    var maxVisible = 7;
    if (totalPages <= maxVisible) {
        for (var p = 0; p < totalPages; p++) {
            html += '<button class="page-btn' + (p === _taskPage ? ' page-current' : '') + '" onclick="taskGoToPage(' + p + ')">' + (p + 1) + '</button>';
        }
    } else {
        // Always show first page
        html += '<button class="page-btn' + (0 === _taskPage ? ' page-current' : '') + '" onclick="taskGoToPage(0)">1</button>';
        var startP = Math.max(1, _taskPage - 2);
        var endP = Math.min(totalPages - 2, _taskPage + 2);
        if (startP > 1) html += '<span class="page-ellipsis">...</span>';
        for (var p = startP; p <= endP; p++) {
            html += '<button class="page-btn' + (p === _taskPage ? ' page-current' : '') + '" onclick="taskGoToPage(' + p + ')">' + (p + 1) + '</button>';
        }
        if (endP < totalPages - 2) html += '<span class="page-ellipsis">...</span>';
        // Always show last page
        var lastP = totalPages - 1;
        html += '<button class="page-btn' + (lastP === _taskPage ? ' page-current' : '') + '" onclick="taskGoToPage(' + lastP + ')">' + (lastP + 1) + '</button>';
    }

    // Next button
    html += '<button class="page-btn" onclick="taskGoToPage(' + (_taskPage + 1) + ')"' + (_taskPage >= totalPages - 1 ? ' disabled' : '') + '>下一页 →</button>';

    // Page size selector
    html += ' 每页 <select class="page-size-select" onchange="taskSetPageSize(this.value)">';
    html += '<option value="20"' + (_taskPageSize === 20 ? ' selected' : '') + '>20</option>';
    html += '<option value="50"' + (_taskPageSize === 50 ? ' selected' : '') + '>50</option>';
    html += '<option value="100"' + (_taskPageSize === 100 ? ' selected' : '') + '>100</option>';
    html += '</select>';

    // Row count summary
    html += ' <span class="page-summary">共 ' + totalAll + ' 条任务，筛选显示 ' + totalFiltered + ' 条，第 ' + (_taskPage + 1) + '/共 ' + totalPages + ' 页</span>';

    bar.innerHTML = html;
}

function taskGoToPage(p) {
    _taskPage = p;
    _renderTaskPage();
}

function taskSetPageSize(size) {
    _taskPageSize = parseInt(size, 10);
    _taskPage = 0;
    try { localStorage.setItem('taskPageSize', String(_taskPageSize)); } catch(e) {}
    _renderTaskPage();
}
```

---

### Task 4: Refactor `_refreshTaskList()` and `_renderTaskTable()` to use new pipeline

**Files:**
- Modify: `static/tasks.js`

- [ ] **Step 1: Rewrite `_refreshTaskList()` to populate TASKS_DATA and call new render**

Replace the existing `_refreshTaskList()` function (line 541-553) with:

```js
function _refreshTaskList(){
    fetch('/api/tasks')
    .then(function(r){ return r.json(); })
    .then(function(d){
        TASKS_DATA = d.tasks;
        _taskPage = 0;
        _taskScheduleMap = _buildTaskScheduleMap();
        _renderTaskPage();
        _renderTaskPool();
        buildSplitIndex();
        refreshLiveStatus();
        toggleDurationUnit();
    }).catch(function(){
        showToast('任务列表加载失败，请检查网络或刷新页面');
    });
}
```

- [ ] **Step 2: Rewrite `_renderTaskTable()` to delegate to pipeline**

Replace the existing `_renderTaskTable()` (line 556-658) with a stub that delegates:

```js
function _renderTaskTable(tasks){
    // Called from outside with fetched data; use array directly
    TASKS_DATA = tasks;
    _taskPage = 0;
    _taskScheduleMap = _buildTaskScheduleMap();
    _renderTaskPage();
    _renderTaskPool();
    buildSplitIndex();
}
```

---

### Task 5: Extract `_renderTaskPool()` and keep existing pool pagination

**Files:**
- Modify: `static/tasks.js`

- [ ] **Step 1: Add standalone `_renderTaskPool()` function**

Take the pool rendering code from the old `_renderTaskTable()` (lines 637-654) and make it a separate function reading from `TASKS_DATA`:

```js
function _renderTaskPool() {
    var itemsEl = document.getElementById('pool-task-items');
    if (!itemsEl) return;

    var pending = [];
    for (var i = 0; i < TASKS_DATA.length; i++) {
        if (TASKS_DATA[i].status === '待分配') pending.push(TASKS_DATA[i]);
    }
    var itemsHtml = '';
    for (var i = 0; i < pending.length; i++) {
        var t = pending[i];
        var typeIdx = typeof _typeIndex === 'function' ? _typeIndex(t.type) : 0;
        var durMin = t.est_seconds ? Math.round(t.est_seconds / 60) : 0;
        var durText = durMin > 0 ? ' ' + durMin + '分钟' : '';
        itemsHtml += '<div class="task-draggable task-type-' + typeIdx + '" draggable="true" data-tid="' + t.id + '" data-type="' + escHtml(t.type) + '" data-kind="' + escHtml(t.task_kind || '') + '" data-pri="' + escHtml(t.priority || '') + '" data-diff="' + escHtml(t.difficulty || '') + '" data-sec="' + (t.est_seconds || '') + '" ondragstart="dragStart(event)" ondblclick="openEditDialog(' + t.id + ')">' + escHtml(t.name) + '(' + escHtml(t.type) + '/' + escHtml(t.task_kind) + ') ' + (t.priority ? '[' + escHtml(t.priority) + ']' : '') + durText + '</div>';
    }
    itemsEl.innerHTML = itemsHtml;
    _restorePoolModeState();

    // 重新应用池区筛选
    filterTaskPool();
    // 重新应用池区分页
    if (typeof _renderPoolPagination === 'function') _renderPoolPagination();
}
```

---

### Task 6: Update tasks.html — add `#` column and pagination bar

**Files:**
- Modify: `templates/panels/tasks.html`

- [ ] **Step 1: Add `#` column to simple table header**

In the simple table `#task-table` thead (line 123-133), add `<th style="width:40px;">#</th>` as the first column inside the `<tr>`, after `<th class="batch-col" ...>` and before `<th class="sortable" data-sort="name">`:

```html
<th style="width:40px;">#</th>
```

- [ ] **Step 2: Add `#` column to detail table header**

In `#task-table-detail` thead (line 142-157), add the same `<th style="width:40px;">#</th>` after the batch-col th.

- [ ] **Step 3: Replace the row-count div with pagination bar**

Replace lines 116-118:
```html
<div style="margin-bottom:8px;">
    <div class="row-count" id="task-row-count">共 0 条任务</div>
</div>
```

With:
```html
<div id="task-pagination-bar" class="pagination-bar" style="margin-bottom:8px;"></div>
```

---

### Task 7: Refactor `applyTaskFilters()` and search — delegate to pipeline

**Files:**
- Modify: `static/tasks.js`

- [ ] **Step 1: Rewrite `applyTaskFilters()`**

Replace the existing function body (lines 775-863) with:

```js
function applyTaskFilters(){
    var searchInput = document.getElementById('task-search');
    var clearBtn = searchInput ? searchInput.parentElement.querySelector('.search-clear') : null;
    if (clearBtn) {
        clearBtn.classList.toggle('visible', (searchInput.value || '').trim().length > 0);
    }

    // Reset to page 0 on filter/search change
    _taskPage = 0;
    _renderTaskPage();

    // Update filter badge
    var ft = document.getElementById('task-filter-type').value;
    var fk = document.getElementById('task-filter-kind').value;
    var fs = document.getElementById('task-filter-status').value;
    var activeFilters = 0;
    if (ft) activeFilters++;
    if (fk) activeFilters++;
    if (fs) activeFilters++;
    var badge = document.getElementById('task-filter-badge');
    if (activeFilters > 0) {
        badge.textContent = String(activeFilters);
        badge.style.display = '';
    } else {
        badge.style.display = 'none';
    }

    // Update column visibility
    var showActionCol = document.getElementById('show-action-col').checked;
    document.querySelectorAll('#task-table .action-col, #task-table .action-btns').forEach(function(el){
        el.style.display = showActionCol ? '' : 'none';
    });
    document.querySelectorAll('#task-table-detail .action-col, #task-table-detail .action-btns').forEach(function(el){
        el.style.display = showActionCol ? '' : 'none';
    });
}
```

- [ ] **Step 2: Remove old sort functions that operated on DOM rows**

Remove `_sortTaskRows()` (lines 101-145 if they exist) and `_sortTaskRowsInArray()` (lines 149-180) — they are replaced by `_sortTaskData()` from Task 2.

- [ ] **Step 3: Update sort header click handler**

Find where sort click handlers are added (around line 1252). Change the callback to use `_renderTaskPage()` instead of the old DOM-based sort+append flow. The handler should set `taskSortState`, then call `_renderTaskPage()`.

```js
// In the sort header click setup, change callback to:
th.addEventListener('click', function() {
    var col = this.dataset.sort;
    if (taskSortState.column === col) {
        taskSortState.direction = (taskSortState.direction + 1) % 3;
    } else {
        taskSortState.column = col;
        taskSortState.direction = 1;
    }
    _updateSortIndicators();
    _renderTaskPage();
});
```

---

### Task 8: Refactor batch selection to use Set

**Files:**
- Modify: `static/tasks.js`

- [ ] **Step 1: Update `updateTaskBatchCount()`**

Find the existing function and replace:

```js
function updateTaskBatchCount() {
    // Sync DOM checkboxes into the Set
    document.querySelectorAll('.batch-check').forEach(function(cb) {
        var tid = parseInt(cb.dataset.tid, 10);
        if (cb.checked) {
            _taskBatchSet.add(tid);
        } else {
            _taskBatchSet.delete(tid);
        }
    });
    document.getElementById('task-batch-count').textContent = '已选 ' + _taskBatchSet.size + ' 项';
}
```

- [ ] **Step 2: Update `toggleSelectAll()`**

Replace with version that only selects currently visible (filtered) items:

```js
function toggleSelectAll() {
    var masterChecked = document.getElementById('batch-check-all').checked;
    var filtered = _getFilteredAndSortedTasks();
    document.querySelectorAll('.batch-check').forEach(function(cb) {
        cb.checked = masterChecked;
    });
    if (masterChecked) {
        for (var i = 0; i < filtered.length; i++) {
            _taskBatchSet.add(filtered[i].id);
        }
    } else {
        for (var i = 0; i < filtered.length; i++) {
            _taskBatchSet.delete(filtered[i].id);
        }
    }
    updateTaskBatchCount();
}
```

- [ ] **Step 3: Update `batchAction()` to read from Set**

Find `batchAction()` and change `ids` source from reading checked DOM checkboxes to `Array.from(_taskBatchSet)`:

```js
function batchAction(action){
    var ids = Array.from(_taskBatchSet);
    if (ids.length === 0) { showToast('请先选择任务'); return; }
    // ... rest of function unchanged
}
```

- [ ] **Step 4: Clear batch set on data refresh**

Add `_taskBatchSet.clear();` at the start of `_refreshTaskList()` before the fetch.

---

### Task 9: Refactor `openEditDrawer()` and `openAssignDialog()` to use `getTaskById()`

**Files:**
- Modify: `static/tasks.js`

- [ ] **Step 1: Refactor `openEditDrawer()`**

Find the function (around line 949). Replace the `querySelector` + `dataset` reads with `getTaskById()`:

```js
function openEditDrawer(tid){
    var t = getTaskById(tid);
    if (!t) { showToast('任务数据未加载，请刷新页面'); return; }

    document.getElementById('ed_id').value = String(tid);
    document.getElementById('ed_name').value = t.name || '';
    document.getElementById('ed_type').value = t.type || (APP_CONFIG.machine_types[0] && APP_CONFIG.machine_types[0].key) || '';
    document.getElementById('ed_kind').value = t.task_kind || '常规';
    document.getElementById('ed_pri').value = t.priority || 'P1';
    document.getElementById('ed_diff').value = t.difficulty || '普通';
    document.getElementById('ed_remark').value = t.remark || '';

    var radio = document.querySelector('input[name="ed_est_mode"][value="' + (t.est_mode || 'blank') + '"]');
    if (radio) radio.checked = true;
    document.getElementById('ed_duration').value = t.duration || '';
    document.getElementById('ed_op').value = t.op_min || '';
    document.getElementById('ed_reset').value = t.reset_min || '';
    document.getElementById('ed_count').value = t.collect_count || '';
    document.getElementById('ed_red').value = t.redundancy_min || '0';

    document.getElementById('ed_rbp_id').value = t.rbp_task_id || '';
    document.getElementById('ed_scene').value = t.scene || '';
    document.getElementById('ed_gcat').value = t.general_category || '';
    document.getElementById('ed_slink').value = t.source_link || '';
    document.getElementById('ed_expcnt').value = t.expected_count || '';
    document.getElementById('ed_creqid').value = t.collection_req_id || '';
    document.getElementById('ed_creqtype').value = t.collection_req_type || '';

    toggleEstMode();
    // Open drawer
    document.getElementById('edit-drawer').classList.add('open');
    document.getElementById('edit-overlay').style.display = '';
}
```

- [ ] **Step 2: Refactor `openAssignDialog()`**

Replace the `querySelector` read of `dataset.type` and `dataset.sec`:

```js
function openAssignDialog(tid){
    var t = getTaskById(tid);
    var estSec = t ? (t.est_seconds || 0) : 0;
    // ... rest of function uses estSec
}
```

---

### Task 10: Refactor split constraint functions to read from TASKS_DATA

**Files:**
- Modify: `static/tasks.js`

- [ ] **Step 1: Refactor `buildSplitIndex()`**

Replace DOM row iteration with `TASKS_DATA` iteration:

```js
var _splitIndex = {};

function buildSplitIndex(){
    _splitIndex = {};
    for (var i = 0; i < TASKS_DATA.length; i++) {
        var t = TASKS_DATA[i];
        var sg = t.split_group;
        if (!sg) continue;
        if (!_splitIndex[sg]) _splitIndex[sg] = [];
        _splitIndex[sg].push({ id: t.id, order: t.split_order || 0 });
    }
    // Sort each group by split_order
    for (var key in _splitIndex) {
        _splitIndex[key].sort(function(a, b) { return (a.order || 0) - (b.order || 0); });
    }
}
```

- [ ] **Step 2: Refactor `getSplitConstraint()`**

Replace DOM querySelector with `_splitIndex` lookup (it now reads from index built above, no DOM needed):

```js
function getSplitConstraint(tid){
    // Find which group this task belongs to
    var group = null;
    for (var key in _splitIndex) {
        for (var i = 0; i < _splitIndex[key].length; i++) {
            if (_splitIndex[key][i].id === tid) { group = key; break; }
        }
        if (group) break;
    }
    if (!group) return null;
    // ... rest of logic unchanged
}
```

---

### Task 11: Refactor `refreshLiveStatus()`, `delTask()`, `finishTaskFromList()`

**Files:**
- Modify: `static/tasks.js`

- [ ] **Step 1: Refactor `refreshLiveStatus()` to operate on TASKS_DATA + current page DOM**

```js
function refreshLiveStatus(){
    if (!TASKS_DATA.length) return;
    var now = new Date();
    // Only update DOM elements on the current page (they exist in DOM)
    document.querySelectorAll('.task-status-text').forEach(function(el){
        var tid = parseInt(el.dataset.tid, 10);
        var t = getTaskById(tid);
        if (!t) return;
        // ... existing status-check logic, update t.status in TASKS_DATA, el.textContent
    });
}
```

- [ ] **Step 2: Refactor `delTask()`**

Replace `querySelectorAll('tr[data-tid=...]').forEach(r=>r.remove())` with remove from `TASKS_DATA` + re-render:

```js
// In delTask success callback, replace DOM removal with:
TASKS_DATA = TASKS_DATA.filter(function(t){ return t.id !== tid; });
_renderTaskPage();
_renderTaskPool();
```

- [ ] **Step 3: Refactor `finishTaskFromList()`**

Replace DOM row removal with data update:

```js
// In success callback:
var t = getTaskById(tid);
if (t) t.status = '已完成';
TASKS_DATA = TASKS_DATA.filter(function(t){ return t.id !== tid; });
_renderTaskPage();
_renderTaskPool();
```

---

### Task 12: Fix timeline-render.js `syncTaskTableTime()`

**Files:**
- Modify: `static/timeline-render.js:57-68`

- [ ] **Step 1: Rewrite using `getTaskById()`, skip DOM write if row not on page**

```js
function syncTaskTableTime(block, absStart, absEnd){
    var tid = block.dataset.tid;
    if (!tid) return;
    // Data is already correct in TASKS_DATA; only update DOM if row is visible
    var t = typeof getTaskById === 'function' ? getTaskById(parseInt(tid, 10)) : null;
    if (!t) return;
    var row = document.querySelector('#task-table tr[data-tid="' + tid + '"]');
    if (!row) return; // not on current page, skip
    var machineRow = block.closest('.machine-row');
    var nameEl = machineRow ? machineRow.querySelector('.machine-name-col') : null;
    var machineName = nameEl ? nameEl.textContent.trim() : '';
    var timeStr = _formatAbsRange(absStart, absEnd);
    var cell = row.children[9]; // "分配时段" column shifted by 1 due to # column
    if (cell) cell.textContent = machineName ? machineName + ' ' + timeStr : timeStr;
}
```

Note: `row.children[8]` becomes `row.children[9]` because the `#` column is now at index 1 (index 0 = batch-col).

---

### Task 13: Fix timeline-ops.js edit dialog

**Files:**
- Modify: `static/timeline-ops.js:95-103`

- [ ] **Step 1: Rewrite using `getTaskById()`**

Replace the `document.querySelector('#task-table tr[data-tid=...]')` block:

```js
// Replace lines 95-107:
var taskData = typeof getTaskById === 'function' ? getTaskById(tid) : null;
if (taskData) {
    var radio = document.querySelector('input[name="ed_est_mode"][value="' + (taskData.est_mode || 'blank') + '"]');
    if (radio) radio.checked = true;
    document.getElementById('ed_duration').value = taskData.duration || '';
    document.getElementById('ed_op').value = taskData.op_min || '';
    document.getElementById('ed_reset').value = taskData.reset_min || '';
    document.getElementById('ed_count').value = taskData.collect_count || '';
    document.getElementById('ed_red').value = taskData.redundancy_min || '0';
} else {
    var radio = document.querySelector('input[name="ed_est_mode"][value="blank"]');
    if (radio) radio.checked = true;
}
```

---

### Task 14: Fix timeline-drag.js drag assignment

**Files:**
- Modify: `static/timeline-drag.js`

- [ ] **Step 1: Replace both fallback DOM reads with `getTaskById()`**

Find the two occurrences at lines 242 and 291. Replace:

```js
// Line 242 area — change from:
var estTr = document.querySelector('#task-table tr[data-tid="'+tid+'"]');
if (estTr) estSec = parseInt(estTr.dataset.sec,10) || 0;

// To:
var t = typeof getTaskById === 'function' ? getTaskById(tid) : null;
if (t && t.est_seconds) estSec = t.est_seconds;

// Line 291 area — same change:
var t = typeof getTaskById === 'function' ? getTaskById(tid) : null;
var estSec = t ? (t.est_seconds || 0) : 0;
```

---

### Task 15: Fix core.js task table DOM interactions

**Files:**
- Modify: `static/core.js`

- [ ] **Step 1: Fix the batch schedule-time update (line 522-533)**

Replace the `querySelectorAll('#task-table tr[data-tid]')` loop with using `getTaskById()`:

```js
// Old approach iterated all DOM rows to write children[8]
// New approach: update TASKS_DATA via getTaskById, then re-render
function _updateTaskAssignedTime(tid, machineName, timeStr) {
    var t = typeof getTaskById === 'function' ? getTaskById(tid) : null;
    if (!t) return;
    // Data updated in TASKS_DATA by _refreshTaskList → render cycle
    // Just re-render the table
    if (typeof _renderTaskPage === 'function') _renderTaskPage();
}
```

(Check the actual function name and signature in core.js; adapt accordingly.)

- [ ] **Step 2: Fix `_updateTaskStatusText()` (line 538-542)**

Replace DOM query with updating `TASKS_DATA` entry via `getTaskById()` and then re-render:

```js
function _updateTaskStatusText(tid, newStatus) {
    var t = typeof getTaskById === 'function' ? getTaskById(tid) : null;
    if (t) t.status = newStatus;
    // Re-render current page
    if (typeof _renderTaskPage === 'function') _renderTaskPage();
}
```

---

### Task 16: Add pagination bar CSS

**Files:**
- Modify: `static/style.css`

- [ ] **Step 1: Add pagination bar styles**

Append to `style.css`:

```css
/* ========== Pagination Bar ========== */
.pagination-bar {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
    font-size: 13px;
    color: var(--text-muted);
}

.page-btn {
    padding: 3px 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-card);
    color: var(--text-primary);
    cursor: pointer;
    font-size: 12px;
    min-width: 28px;
    text-align: center;
}

.page-btn:hover:not(:disabled):not(.page-current) {
    background: var(--bg-hover);
    border-color: var(--primary);
}

.page-btn:disabled {
    opacity: 0.4;
    cursor: default;
}

.page-btn.page-current {
    background: var(--primary);
    color: #fff;
    border-color: var(--primary);
    font-weight: 600;
}

.page-ellipsis {
    padding: 3px 4px;
    color: var(--text-muted);
}

.page-size-select {
    padding: 2px 4px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-card);
    color: var(--text-primary);
    font-size: 12px;
}

.page-summary {
    margin-left: 8px;
    font-size: 12px;
    color: var(--text-muted);
}

.seq-col {
    width: 40px;
    text-align: center;
    color: var(--text-muted);
    font-size: 12px;
}
```

---

### Task 17: Apply same refactoring to history.js

**Files:**
- Modify: `static/history.js`
- Modify: `templates/panels/history.html`

Apply Tasks 1–6, 11 patterns to history:

- [ ] **Step 1: Add `SCHEDULES_HISTORY` array and pagination state**

```js
var SCHEDULES_HISTORY = [];
var _histPage = 0;
var _histPageSize = (function(){
    try { var v = parseInt(localStorage.getItem('historyPageSize'), 10); return (v === 20 || v === 50 || v === 100) ? v : 20; }
    catch(e) { return 20; }
})();
var _histBatchSet = new Set();
```

- [ ] **Step 2: Add `_getFilteredAndSortedHistory()` pipeline**

Following the same `filter → search → sort` pattern as tasks, but with history-specific fields (date range, type, kind from history filter dropdowns).

- [ ] **Step 3: Add `_renderHistoryPage()` and `_renderHistoryTableRows()`**

Same pattern as `_renderTaskPage()`, rendering to both `#history-table` and `#history-table-detail`. Add `#` column with sequence numbers.

- [ ] **Step 4: Add `_renderHistoryPaginationBar()`**

Same as task pagination bar but with id `history-pagination-bar` and functions `histGoToPage()`, `histSetPageSize()`.

- [ ] **Step 5: Update `_loadHistory()` to populate `SCHEDULES_HISTORY` and call `_renderHistoryPage()` + `_renderHistoryPaginationBar()`**

- [ ] **Step 6: Update `filterHistoryTable()` to reset page to 0 and call `_renderHistoryPage()`**

- [ ] **Step 7: Update `history.html`**

Add `<th style="width:40px;">#</th>` after batch-col in both table headers. Replace row-count div with `<div id="history-pagination-bar" class="pagination-bar" style="margin-bottom:8px;"></div>`.

---

### Task 18: Final integration test

**Files:**
- No new files. Manual verification.

- [ ] **Step 1: Start the app and verify task library**

1. Open task library panel
2. Verify `#` column appears, rows numbered from 1
3. Verify page controls show: prev/next, page numbers, page size selector, row count
4. Click page 2 — verify different rows, numbering continues (21, 22...)
5. Change page size to 50 — verify 50 rows, page resets to 1
6. Type in search box — verify page resets to 1, matching rows shown
7. Change filter — verify page resets to 1
8. Click column header to sort — verify sort works, stays on page 1
9. Select checkboxes across pages — verify selection persists when flipping pages
10. Click "批量回收" — verify only selected IDs get recycled

- [ ] **Step 2: Verify timeline interactions**

1. Assign a task from pool to a machine — verify time block appears
2. Drag a time block — verify no console errors about getTaskById
3. Double-click a time block to edit — verify dialog populates correctly
4. From task library, click "修改" on a task — verify drawer opens with correct data

- [ ] **Step 3: Verify history records**

1. Open history panel
2. Verify `#` column, pagination controls work
3. Test search, filter, sort same as tasks
4. Test batch operations across pages
5. Test export (should export all filtered data, not just current page — verify this is unchanged)

- [ ] **Step 4: Verify task pool**

1. Verify pool items render from `TASKS_DATA`
2. Verify pool pagination still works (show/hide approach)
3. Verify pool filtering still works

---

## Self-Review Notes

- All DOM reads of `#task-table tr[data-tid]` replaced with `getTaskById()`
- `children[8]` → `children[9]` for "分配时段" column due to `#` column shift
- Batch selection uses `Set` — survives page changes
- Page always resets to 0 on filter/search/refresh changes
- Pool extracted but pagination approach unchanged
- Timeline 3 locations + core.js 2 locations adapted
- History gets identical treatment
- `taskSortState` variable preserved (existing), sort now operates on array
