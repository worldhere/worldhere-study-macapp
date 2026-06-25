# Filter Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify task library and history record filters to use the same multi-select tag-panel pattern as machine management.

**Architecture:** Add generic filter state/UI functions to `core.js` alongside existing machine-specific ones, then wire them into task and history panels. Keep machine management's existing `_filterState` unchanged to avoid regressions.

**Tech Stack:** Vanilla JS (no framework), Jinja2 templates, Flask backend (unchanged)

---

### Task 1: Add reusable filter functions to core.js

**Files:**
- Modify: `static/core.js` (append after line 220)

- [ ] **Step 1: Add task and history filter state objects**

Append after the last line (after `_isFilterActive()`):

```javascript
// ========== 任务库 & 历史记录 筛选状态 ==========
var _taskFilterState = { type: [], kind: [], status: [] };
var _taskFilterDimLabels = {
    type: '机型', kind: '任务类型', status: '状态',
    _ns: 'task',
    _trigPrefix: 'task-filter-trigger-',
    _panelPrefix: 'task-filter-panel-',
    _condCtn: 'task-filter-condition-tags',
    _condBar: 'task-filter-conditions',
    _resetBtn: 'task-filter-reset-btn',
};
var _histFilterState = { type: [], kind: [] };
var _histFilterDimLabels = {
    type: '机型', kind: '任务类型',
    _ns: 'hist',
    _trigPrefix: 'hist-filter-trigger-',
    _panelPrefix: 'hist-filter-panel-',
    _condCtn: 'hist-filter-condition-tags',
    _condBar: 'hist-filter-conditions',
    _resetBtn: 'hist-filter-reset-btn',
};

// ========== 通用筛选函数（接受 state/config 参数） ==========

// 通用 tag 切换
function _genericToggleFilterTag(state, dim, value, dims, dimLabels, panelData, applyFn) {
    var arr = state[dim];
    var idx = arr.indexOf(value);
    if (idx >= 0) { arr.splice(idx, 1); } else { arr.push(value); }
    _genericSyncFilterUI(state, dims, dimLabels, panelData);
    if (applyFn) applyFn();
}

// 通用条件标签移除
function _genericRemoveFilterCondition(state, dim, value, dims, dimLabels, panelData, applyFn) {
    var arr = state[dim];
    var idx = arr.indexOf(value);
    if (idx >= 0) { arr.splice(idx, 1); }
    _genericSyncFilterUI(state, dims, dimLabels, panelData);
    if (applyFn) applyFn();
}

// 通用重置
function _genericResetFilter(state, dims, dimLabels, panelData, applyFn) {
    dims.forEach(function(dim) { state[dim] = []; });
    _genericSyncFilterUI(state, dims, dimLabels, panelData);
    document.querySelectorAll('.filter-panel.open').forEach(function(p) { p.classList.remove('open'); });
    if (applyFn) applyFn();
}

// 通用 UI 同步：更新 trigger 按钮文字 + 面板 tag 高亮 + 条件标签栏
function _genericSyncFilterUI(state, dims, dimLabels, panelData) {
    var hasAny = false;
    dims.forEach(function(dim) {
        var sel = state[dim];
        var trigId = dimLabels._trigPrefix + dim;
        var panelId = dimLabels._panelPrefix + dim;
        var btn = document.getElementById(trigId);
        var panel = document.getElementById(panelId);

        if (btn) {
            if (sel.length === 0) { btn.textContent = '全部 ▾'; btn.classList.remove('active'); }
            else { btn.textContent = '已选 ' + sel.length + ' 项 ▾'; btn.classList.add('active'); }
        }

        if (panel && panelData && panelData[dim]) {
            var html = '<div class="filter-tag-list">';
            panelData[dim].forEach(function(v) {
                var isSel = sel.indexOf(v) >= 0;
                html += '<span class="filter-tag' + (isSel ? ' selected' : '') + '" data-value="' + escHtml(v) + '" onclick="_toggleFilterTag_' + dimLabels._ns + '(\'' + dim + '\',\'' + escHtml(v) + '\')">' + escHtml(v) + '</span>';
            });
            html += '</div>';
            panel.innerHTML = html;
        }

        if (sel.length > 0) hasAny = true;
    });

    _genericRenderConditionTags(state, dims, dimLabels);

    var resetBtn = document.getElementById(dimLabels._resetBtn);
    if (resetBtn) { resetBtn.disabled = !hasAny; resetBtn.style.opacity = hasAny ? '' : '0.4'; }
}

// 通用条件标签渲染
function _genericRenderConditionTags(state, dims, dimLabels) {
    var container = document.getElementById(dimLabels._condCtn);
    var bar = document.getElementById(dimLabels._condBar);
    if (!container || !bar) return;
    var html = '';
    dims.forEach(function(dim) {
        state[dim].forEach(function(v) {
            html += '<span class="filter-condition-tag" data-dim="' + dim + '" data-value="' + escHtml(v) + '">' + escHtml(dimLabels[dim]) + ': ' + escHtml(v) + ' <span class="remove-cond" onclick="_removeFilterCond_' + dimLabels._ns + '(\'' + dim + '\',\'' + escHtml(v) + '\')">&times;</span></span>';
        });
    });
    container.innerHTML = html;
    bar.style.display = html ? 'flex' : 'none';
}

// 通用面板切换
function _genericToggleFilterPanel(panelId) {
    var panel = document.getElementById(panelId);
    if (!panel) return;
    var wasOpen = panel.classList.contains('open');
    document.querySelectorAll('.filter-panel.open').forEach(function(p) { p.classList.remove('open'); });
    if (!wasOpen) {
        panel.classList.add('open');
        if (!panel.querySelector('.filter-tag-list')) {
            var ns = panel.dataset.ns;
            if (ns === 'task') _taskSyncFilterUI();
            else if (ns === 'hist') _histSyncFilterUI();
        }
    }
}
```

- [ ] **Step 2: Add namespaced bridge functions for task and history**

Append after step 1 code:

```javascript
// ========== 任务库筛选桥接函数 ==========
window._taskFilterPanelData = window._taskFilterPanelData || { type: [], kind: [], status: [] };

function _taskSyncFilterUI() {
    _genericSyncFilterUI(
        _taskFilterState,
        ['type', 'kind', 'status'],
        _taskFilterDimLabels,
        window._taskFilterPanelData
    );
}

window._toggleFilterTag_task = function(dim, value) {
    _genericToggleFilterTag(
        _taskFilterState, dim, value,
        ['type', 'kind', 'status'],
        _taskFilterDimLabels,
        window._taskFilterPanelData,
        function() { if (typeof applyTaskFilters === 'function') applyTaskFilters(); }
    );
};

window._removeFilterCond_task = function(dim, value) {
    _genericRemoveFilterCondition(
        _taskFilterState, dim, value,
        ['type', 'kind', 'status'],
        _taskFilterDimLabels,
        window._taskFilterPanelData,
        function() { if (typeof applyTaskFilters === 'function') applyTaskFilters(); }
    );
};

function resetTaskFilters() {
    _genericResetFilter(
        _taskFilterState,
        ['type', 'kind', 'status'],
        _taskFilterDimLabels,
        window._taskFilterPanelData,
        function() { if (typeof applyTaskFilters === 'function') applyTaskFilters(); }
    );
}

// ========== 历史记录筛选桥接函数 ==========
window._histFilterPanelData = window._histFilterPanelData || { type: [], kind: [] };

function _histSyncFilterUI() {
    _genericSyncFilterUI(
        _histFilterState,
        ['type', 'kind'],
        _histFilterDimLabels,
        window._histFilterPanelData
    );
}

window._toggleFilterTag_hist = function(dim, value) {
    _genericToggleFilterTag(
        _histFilterState, dim, value,
        ['type', 'kind'],
        _histFilterDimLabels,
        window._histFilterPanelData,
        function() { if (typeof filterHistoryTable === 'function') filterHistoryTable(); }
    );
};

window._removeFilterCond_hist = function(dim, value) {
    _genericRemoveFilterCondition(
        _histFilterState, dim, value,
        ['type', 'kind'],
        _histFilterDimLabels,
        window._histFilterPanelData,
        function() { if (typeof filterHistoryTable === 'function') filterHistoryTable(); }
    );
};

function resetHistFilters() {
    _genericResetFilter(
        _histFilterState,
        ['type', 'kind'],
        _histFilterDimLabels,
        window._histFilterPanelData,
        function() { if (typeof filterHistoryTable === 'function') filterHistoryTable(); }
    );
}
```

- [ ] **Step 3: Commit**

```bash
git add static/core.js
git commit -m "feat: add reusable multi-select filter state and UI functions for task/history panels"
```

---

### Task 2: Replace task library filter UI in tasks.html

**Files:**
- Modify: `templates/panels/tasks.html` (lines 58-113, the filter-bar and filter-drop-panel section)

- [ ] **Step 1: Replace filter bar and dropdown panel**

Replace the existing filter-bar (starting from `<div class="filter-bar">` around line 60) and filter-drop-panel (`<div class="filter-drop-panel" id="task-filter-panel">` around line 85) with the new inline filter structure:

```html
            <!-- Filter bar -->
            <div class="filter-bar">
                <span class="search-input-wrapper">
                    <input type="text" id="task-search" class="search-input" placeholder="搜索任务名、机型、类型..." oninput="applyTaskFilters()">
                    <button class="search-clear" onclick="clearTaskSearch()">&times;</button>
                </span>
                <b>机型：</b>
                <div class="filter-dim" data-dim="type">
                    <button class="filter-trigger" id="task-filter-trigger-type" onclick="_genericToggleFilterPanel('task-filter-panel-type')" type="button">全部 ▾</button>
                    <div class="filter-panel" id="task-filter-panel-type" data-ns="task"></div>
                </div>
                <b>任务类型：</b>
                <div class="filter-dim" data-dim="kind">
                    <button class="filter-trigger" id="task-filter-trigger-kind" onclick="_genericToggleFilterPanel('task-filter-panel-kind')" type="button">全部 ▾</button>
                    <div class="filter-panel" id="task-filter-panel-kind" data-ns="task"></div>
                </div>
                <b>状态：</b>
                <div class="filter-dim" data-dim="status">
                    <button class="filter-trigger" id="task-filter-trigger-status" onclick="_genericToggleFilterPanel('task-filter-panel-status')" type="button">全部 ▾</button>
                    <div class="filter-panel" id="task-filter-panel-status" data-ns="task"></div>
                </div>
                <button class="btn filter-reset-btn" id="task-filter-reset-btn" onclick="resetTaskFilters()" disabled type="button">↺ 重置</button>
                <div class="mode-btn-group" id="task-mode-btns">
                    <button class="mode-btn active" data-mode="simple" onclick="switchTaskModeBtn('simple')">简易</button>
                    <button class="mode-btn" data-mode="detail" onclick="switchTaskModeBtn('detail')">详细</button>
                </div>
                <span id="task-batch-actions" style="display:none;white-space:nowrap;">
                    <button class="btn" onclick="batchAction('recycle')">批量回收</button>
                    <button onclick="batchAction('complete')">批量完成</button>
                    <button class="btn-danger" onclick="batchAction('delete')">批量删除</button>
                    <span id="task-batch-count" style="font-weight:600;">已选 0 项</span>
                </span>
                <span style="font-size:12px;margin-left:8px;">显示时长：</span>
                <select id="duration-unit" onchange="toggleDurationUnit()" style="padding:4px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;">
                    <option value="min">分钟</option>
                    <option value="sec">秒</option>
                    <option value="hour">小时</option>
                </select>
                <label style="white-space:nowrap;flex-shrink:0;"><input type="checkbox" id="show-action-col" checked onchange="applyTaskFilters()"> 显示操作列</label>
                <label style="white-space:nowrap;flex-shrink:0;margin-left:auto;"><input type="checkbox" id="task-batch-mode" onchange="toggleTaskBatchMode()"> 批量操作</label>
                <button class="btn" style="background:var(--warning);" onclick="document.getElementById('import-file-input').click()">导入Excel</button>
                <input id="import-file-input" type="file" accept=".xlsx,.xls" style="display:none;" onchange="handleImportFile(this)">
            </div>

            <!-- Filter condition tags -->
            <div class="filter-conditions" id="task-filter-conditions" style="display:none;align-items:center;gap:6px;flex-wrap:wrap;padding:6px 0;border-top:1px solid var(--border-light);margin-bottom:12px;">
                <span style="font-size:11px;color:var(--text-muted);">条件：</span>
                <span id="task-filter-condition-tags" style="display:inline-flex;gap:4px;flex-wrap:wrap;"></span>
            </div>
```

- [ ] **Step 2: Add filter panel data script block**

Insert after the filter-conditions div, before the pagination bar:

```html
            <script>
            window._taskFilterPanelData = {
                type: [{% for mt in app_config.machine_types %}"{{mt.key}}"{% if not loop.last %},{% endif %}{% endfor %}],
                kind: [{% for tk in app_config.task_kinds %}"{{tk.key}}"{% if not loop.last %},{% endif %}{% endfor %}],
                status: ["待分配","已分配","采集中","采集即将完成","暂停中","暂停即将超时","过时待确认"]
            };
            </script>
```

- [ ] **Step 3: Initialize task filter state on DOMContentLoaded**

The task filter state needs to be initialized. Since task mode and duration unit restore already happens in `tasks.js`'s `DOMContentLoaded`, add there. But we can also do it here — simpler to just set filter triggers to "全部" on page load. The `_genericSyncFilterUI` will handle it. The task init will happen when `_refreshTaskList` first calls `applyTaskFilters` which triggers `_taskSyncFilterUI`.

No additional code needed here — the first render will sync the UI.

- [ ] **Step 4: Remove the old hidden select elements if they exist for URL params**

The old tasks.html had `<select>` elements in the filter panel but no URL params for task filters (unlike machines). The existing `initFilterStateFromURL()` only reads `m_` params which are machine-specific. No cleanup needed for task selects as they were in the filter-drop-panel element that's being replaced.

- [ ] **Step 5: Commit**

```bash
git add templates/panels/tasks.html
git commit -m "feat: replace task library filter selects with multi-select tag-panel UI"
```

---

### Task 3: Replace history filter UI in history.html

**Files:**
- Modify: `templates/panels/history.html` (lines 41-52, the filter-drop-panel section)

- [ ] **Step 1: Replace the history filter dropdown panel**

Replace the existing `<div class="filter-drop-panel" id="history-filter-panel">` (lines 41-52) with the new inline filter structure. Insert it into the filter-bar after the date-toggle button:

First, remove the old filter-drop-panel block:

```html
            <!-- Filter dropdown panel -->
            <div class="filter-drop-panel" id="history-filter-panel">
                <b>机型：</b>
                <select id="history-filter-type" onchange="filterHistoryTable()" style="width:120px">
                    <option value="">全部</option>
                    {% for mt in app_config.machine_types %}<option value="{{mt.key}}">{{mt.key}}</option>{% endfor %}
                </select>
                <b>任务类型：</b>
                <select id="history-filter-kind" onchange="filterHistoryTable()" style="width:120px">
                    <option value="">全部</option>
                    {% for tk in app_config.task_kinds %}<option value="{{tk.key}}">{{tk.key}}</option>{% endfor %}
                </select>
            </div>
```

Then, inside the filter-bar div, after the date-toggle button and before the mode-btn-group, add:

```html
                <b>机型：</b>
                <div class="filter-dim" data-dim="type">
                    <button class="filter-trigger" id="hist-filter-trigger-type" onclick="_genericToggleFilterPanel('hist-filter-panel-type')" type="button">全部 ▾</button>
                    <div class="filter-panel" id="hist-filter-panel-type" data-ns="hist"></div>
                </div>
                <b>任务类型：</b>
                <div class="filter-dim" data-dim="kind">
                    <button class="filter-trigger" id="hist-filter-trigger-kind" onclick="_genericToggleFilterPanel('hist-filter-panel-kind')" type="button">全部 ▾</button>
                    <div class="filter-panel" id="hist-filter-panel-kind" data-ns="hist"></div>
                </div>
                <button class="btn filter-reset-btn" id="hist-filter-reset-btn" onclick="resetHistFilters()" disabled type="button">↺ 重置</button>
```

And add the condition tags bar and filter-conditions div after the filter bar:

```html
            <!-- Filter condition tags -->
            <div class="filter-conditions" id="hist-filter-conditions" style="display:none;align-items:center;gap:6px;flex-wrap:wrap;padding:6px 0;border-top:1px solid var(--border-light);margin-bottom:12px;">
                <span style="font-size:11px;color:var(--text-muted);">条件：</span>
                <span id="hist-filter-condition-tags" style="display:inline-flex;gap:4px;flex-wrap:wrap;"></span>
            </div>
```

- [ ] **Step 2: Add filter panel data script block for history**

Insert after the filter-conditions div, before the pagination bar:

```html
            <script>
            window._histFilterPanelData = {
                type: [{% for mt in app_config.machine_types %}"{{mt.key}}"{% if not loop.last %},{% endif %}{% endfor %}],
                kind: [{% for tk in app_config.task_kinds %}"{{tk.key}}"{% if not loop.last %},{% endif %}{% endfor %}]
            };
            </script>
```

- [ ] **Step 3: Commit**

```bash
git add templates/panels/history.html
git commit -m "feat: replace history filter selects with multi-select tag-panel UI"
```

---

### Task 4: Update task-table.js filtering logic

**Files:**
- Modify: `static/task-table.js` (lines 80-112, `_getFilteredAndSortedTasks()` and `applyTaskFilters()`)

- [ ] **Step 1: Update `_getFilteredAndSortedTasks()` to read from `_taskFilterState`**

Replace lines 80-112 with:

```javascript
function _getFilteredAndSortedTasks() {
    var ft = _taskFilterState.type;
    var fk = _taskFilterState.kind;
    var fs = _taskFilterState.status;
    var searchTerm = _getTaskSearchTerm();

    var filtered = [];
    for (var i = 0; i < TASKS_DATA.length; i++) {
        var t = TASKS_DATA[i];
        if (t.status === '已完成' || t.status === '已确认') continue;
        if (ft.length > 0 && ft.indexOf(t.type) < 0) continue;
        if (fk.length > 0 && fk.indexOf(t.task_kind) < 0) continue;
        if (fs.length > 0 && fs.indexOf(t.status) < 0) continue;
        filtered.push(t);
    }

    var matching = [];
    if (searchTerm) {
        for (var i = 0; i < filtered.length; i++) {
            if (_taskMatchesSearch(filtered[i], searchTerm)) {
                matching.push(filtered[i]);
            }
        }
    } else {
        matching = filtered;
    }

    if (taskSortState.direction > 0 && taskSortState.column) {
        _sortTaskData(matching, taskSortState.column, taskSortState.direction);
    }

    return matching;
}
```

- [ ] **Step 2: Update `applyTaskFilters()` to use generic filter badge counting and UI sync**

Replace lines 305-337 with:

```javascript
function applyTaskFilters(){
    var searchInput = document.getElementById('task-search');
    var clearBtn = searchInput ? searchInput.parentElement.querySelector('.search-clear') : null;
    if (clearBtn) {
        clearBtn.classList.toggle('visible', (searchInput.value || '').trim().length > 0);
    }

    _taskPage = 0;
    _taskSyncFilterUI();
    _renderTaskPage();

    var showActionCol = document.getElementById('show-action-col').checked;
    document.querySelectorAll('#task-table .action-col, #task-table-detail .action-col').forEach(function(th) {
        th.style.display = showActionCol ? '' : 'none';
    });
    document.querySelectorAll('#task-table .action-btns, #task-table-detail .action-btns').forEach(function(td) {
        td.style.display = showActionCol ? '' : 'none';
    });
}
```

- [ ] **Step 3: Remove the old `toggleTaskFilterPanel()` function**

The old `toggleTaskFilterPanel()` at line 339-346 is no longer needed — the panels are now toggled by `_genericToggleFilterPanel()`. Remove it:

```javascript
// Remove: function toggleTaskFilterPanel() { ... }
```

- [ ] **Step 4: Commit**

```bash
git add static/task-table.js
git commit -m "feat: wire task library filter to multi-select _taskFilterState"
```

---

### Task 5: Update history.js filtering logic

**Files:**
- Modify: `static/history.js` (lines 161-190, `_getFilteredAndSortedHistory()` and `filterHistoryTable()`)

- [ ] **Step 1: Update `_getFilteredAndSortedHistory()` to read from `_histFilterState`**

Replace lines 161-190 with:

```javascript
function _getFilteredAndSortedHistory() {
    var ft = _histFilterState.type;
    var fk = _histFilterState.kind;
    var searchTerm = (document.getElementById('history-search').value || '').trim().toLowerCase();

    var filtered = [];
    for (var i = 0; i < SCHEDULES_HISTORY.length; i++) {
        var s = SCHEDULES_HISTORY[i];
        if (ft.length > 0 && ft.indexOf(s.task_type) < 0) continue;
        if (fk.length > 0 && fk.indexOf(s.task_kind) < 0) continue;
        filtered.push(s);
    }

    var matching = [];
    if (searchTerm) {
        for (var i = 0; i < filtered.length; i++) {
            if (_histMatchesSearch(filtered[i], searchTerm)) {
                matching.push(filtered[i]);
            }
        }
    } else {
        matching = filtered;
    }

    if (histSortState.direction > 0 && histSortState.column) {
        _sortHistData(matching, histSortState.column, histSortState.direction);
    }

    return matching;
}
```

- [ ] **Step 2: Update `filterHistoryTable()` to use generic filter badge counting and remove old select-based badge logic**

Replace the badge-counting portion of `filterHistoryTable()` (currently reads from `#history-filter-type` and `#history-filter-kind` single selects). The function should now be:

```javascript
function filterHistoryTable() {
    _histPage = 0;
    _histSyncFilterUI();
    _renderHistoryPage();

    var searchTerm = (document.getElementById('history-search').value || '').trim().toLowerCase();
    var searchInput = document.getElementById('history-search');
    var clearBtn = searchInput ? searchInput.parentElement.querySelector('.search-clear') : null;
    if (clearBtn) {
        clearBtn.classList.toggle('visible', searchTerm.length > 0);
    }

    // Date badge
    var from = document.getElementById('history-date-from').value;
    var to = document.getElementById('history-date-to').value;
    var dateBadge = document.getElementById('history-date-badge');
    if (from || to) {
        dateBadge.textContent = '●';
        dateBadge.style.display = '';
    } else {
        dateBadge.style.display = 'none';
    }
}
```

- [ ] **Step 3: Remove the old `toggleHistoryFilterPanel()` function**

The old function at lines 37-44 is no longer needed:

```javascript
// Remove: function toggleHistoryFilterPanel() { ... }
```

- [ ] **Step 4: Commit**

```bash
git add static/history.js
git commit -m "feat: wire history filter to multi-select _histFilterState"
```

---

### Task 6: Verification

- [ ] **Step 1: Start the app and test manually**

```bash
cd "C:\Users\Admin\Desktop\大家的Draft\zyh\golden"
python app.py
```

Navigate to http://127.0.0.1:5000 and verify:

1. **任务库 tab:**
   - [ ] Filter triggers show "全部 ▾" initially
   - [ ] Clicking a trigger opens the tag panel
   - [ ] Clicking a tag selects it (highlights) and the trigger updates to "已选 1 项 ▾"
   - [ ] Multiple tags in the same dimension can be selected
   - [ ] Condition tags bar appears with active filters
   - [ ] Clicking ✕ on a condition tag removes it
   - [ ] Reset button clears all filters
   - [ ] Search still works independently
   - [ ] Duration unit selector still works
   - [ ] 简易/详细 mode toggle still works
   - [ ] Sorting still works

2. **历史记录 tab:**
   - [ ] Filter triggers show "全部 ▾" initially
   - [ ] Same multi-select behavior as task library
   - [ ] Date range panel still works independently
   - [ ] Search still works
   - [ ] 简易/详细 mode toggle still works

3. **机器管理 tab (regression check):**
   - [ ] All existing filter functionality still works unchanged
   - [ ] Filter panels open/close normally
   - [ ] Multi-select, condition tags, reset all work

- [ ] **Step 2: Commit any fixes if needed**

```bash
git add -A
git commit -m "fix: address verification findings"
```
