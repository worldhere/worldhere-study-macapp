# Auto-Assign: Multi-Select Filter + Preview Animation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace single-select filter tabs with multi-select toggle groups (AND/OR logic) and add synchronized preview card flash animation linked to the animation settings toggle.

**Architecture:** Pure frontend changes. Filter state moves from single string to two per-section arrays (type + kind). Selection state persists across filter changes via ID Sets. Animation is CSS keyframe on existing `.aa-preview-card` / `.aa-pool-preview` classes, suppressed by existing `body.no-animations` CSS rule.

**Tech Stack:** Vanilla JS, CSS

---

### Task 1: Track selected item IDs to fix filter-reset bug

**Files:**
- Modify: `static/auto-assign.js`

**Problem:** `_renderMachines()` / `_renderTasks()` rebuild HTML from scratch on every filter change, hardcoding `.on` on all non-disabled items. This resets any manual deselection. With multi-select toggling, users will switch filters frequently, so this must be fixed.

- [ ] **Step 1: Add selected-ID Sets to state and initialize in load functions**

In `AA._state` (line 3-10), add two new fields:

```javascript
_selectedMachineIds: null,  // null = all non-disabled selected; populated on first toggle
_selectedTaskIds: null,
```

In `_loadMachines()` (after line 170 `AA._state.machines = data.machines || [];`), add:

```javascript
AA._state._selectedMachineIds = null;
// Initialize with all non-disabled machine IDs
var ids = {};
AA._state.machines.forEach(function(m) {
    if (m.status !== '维修停用') ids[m.id] = true;
});
AA._state._selectedMachineIds = ids;
```

In `_loadTasks()` (after line 266 sorting), add:

```javascript
AA._state._selectedTaskIds = null;
var ids = {};
AA._state.tasks.forEach(function(t) { ids[t.id] = true; });
AA._state._selectedTaskIds = ids;
```

- [ ] **Step 2: Update `_renderMachines` to use the selected-ID set**

Replace the `.on` logic in `_renderMachines` (line 215-218):

Old:
```javascript
var cls = 'aa-item';
if (disabled) cls += ' disabled';
if (!disabled) cls += ' on';
```

New:
```javascript
var cls = 'aa-item';
if (disabled) cls += ' disabled';
var sel = AA._state._selectedMachineIds || {};
if (!disabled && sel[m.id]) cls += ' on';
```

- [ ] **Step 3: Update `_renderTasks` to use the selected-ID set**

Replace `.on` logic in `_renderTasks` (line 309):

Old:
```javascript
html += '<div class="aa-item on" data-id="' + t.id + '" onclick="AA.toggleTask(this)">';
```

New:
```javascript
var sel = AA._state._selectedTaskIds || {};
var taskOn = sel[t.id] ? ' on' : '';
html += '<div class="aa-item' + taskOn + '" data-id="' + t.id + '" onclick="AA.toggleTask(this)">';
```

- [ ] **Step 4: Update `toggleMachine` and `toggleTask` to maintain the Sets**

Replace `toggleMachine` (lines 231-235):

```javascript
toggleMachine: function(el) {
    var id = parseInt(el.getAttribute('data-id'), 10);
    el.classList.toggle('on');
    var sel = AA._state._selectedMachineIds || {};
    if (el.classList.contains('on')) {
        sel[id] = true;
    } else {
        delete sel[id];
    }
    AA._updateMachineSummary();
    AA._clearPreview();
},
```

Replace `toggleTask` (lines 322-326):

```javascript
toggleTask: function(el) {
    var id = parseInt(el.getAttribute('data-id'), 10);
    el.classList.toggle('on');
    var sel = AA._state._selectedTaskIds || {};
    if (el.classList.contains('on')) {
        sel[id] = true;
    } else {
        delete sel[id];
    }
    AA._updateTaskSummary();
    AA._clearPreview();
},
```

- [ ] **Step 5: Update `_updateMachineSummary` and `_updateTaskSummary` to count from Sets**

Replace `_updateMachineSummary` (line 244-248):

```javascript
_updateMachineSummary: function() {
    var sel = AA._state._selectedMachineIds || {};
    var count = Object.keys(sel).length;
    var el = document.getElementById('aa-summary-machine');
    if (el) el.textContent = '已选 ' + count + ' 台';
},
```

Replace `_updateTaskSummary` (line 335-339):

```javascript
_updateTaskSummary: function() {
    var sel = AA._state._selectedTaskIds || {};
    var count = Object.keys(sel).length;
    var el = document.getElementById('aa-summary-task');
    if (el) el.textContent = count + ' 个待分配 · 按优先级排列';
},
```

- [ ] **Step 6: Commit**

```
git add static/auto-assign.js
git commit -m "fix: preserve item selection across filter changes in auto-assign dialog"
```

---

### Task 2: Add multi-select filter state arrays

**Files:**
- Modify: `static/auto-assign.js`

- [ ] **Step 1: Add filter arrays to AA._state**

In `AA._state` object, add:

```javascript
_activeMachineTypeFilters: [],
_activeMachineKindFilters: [],
_activeTaskTypeFilters: [],
_activeTaskKindFilters: [],
```

- [ ] **Step 2: Reset filter arrays in open()**

In `AA.open()` (after line 20 `AA._state.previewParams = null;`), add:

```javascript
AA._state._activeMachineTypeFilters = [];
AA._state._activeMachineKindFilters = [];
AA._state._activeTaskTypeFilters = [];
AA._state._activeTaskKindFilters = [];
```

- [ ] **Step 3: Commit**

```
git add static/auto-assign.js
git commit -m "feat: add multi-select filter state arrays to auto-assign"
```

---

### Task 3: Rewrite tab rendering with groups

**Files:**
- Modify: `static/auto-assign.js`
- Modify: `templates/dialogs/auto_assign.html` (remove default tab HTML since JS now renders everything)

- [ ] **Step 1: Rewrite `_renderMachineTabs` with two groups**

Replace `_renderMachineTabs` (lines 180-199) with:

```javascript
_renderMachineTabs: function() {
    var types = {};
    var kinds = {};
    AA._state.machines.forEach(function(m) {
        if (m.type) types[m.type] = true;
        if (m.task_kind) kinds[m.task_kind] = true;
    });
    AA._state.machineTypes = Object.keys(types);
    AA._state.taskKinds = Object.keys(kinds);

    var activeTypes = AA._state._activeMachineTypeFilters;
    var activeKinds = AA._state._activeMachineKindFilters;
    var html = '';

    // 机型组
    html += '<div class="aa-tab-group"><span class="aa-tag" style="font-size:11px;color:#94a3b8;font-weight:600;margin-right:4px;">机型</span>';
    html += '<span class="aa-tab' + (activeTypes.length === 0 ? ' on' : '') + '" data-group="type" data-filter="all" onclick="AA.toggleMachineFilter(\'all\', \'type\', this)">全部</span>';
    AA._state.machineTypes.forEach(function(t) {
        html += '<span class="aa-tab' + (activeTypes.indexOf(t) >= 0 ? ' on' : '') + '" data-group="type" data-filter="type:' + escHtml(t) + '" onclick="AA.toggleMachineFilter(\'type:' + escHtml(t) + '\', \'type\', this)">' + escHtml(t) + '</span>';
    });
    html += '</div>';

    // 任务类型组
    html += '<div class="aa-tab-group" style="margin-top:2px;"><span class="aa-tag" style="font-size:11px;color:#94a3b8;font-weight:600;margin-right:4px;">任务类型</span>';
    html += '<span class="aa-tab' + (activeKinds.length === 0 ? ' on' : '') + '" data-group="kind" data-filter="all" onclick="AA.toggleMachineFilter(\'all\', \'kind\', this)">全部</span>';
    AA._state.taskKinds.forEach(function(k) {
        html += '<span class="aa-tab' + (activeKinds.indexOf(k) >= 0 ? ' on' : '') + '" data-group="kind" data-filter="kind:' + escHtml(k) + '" onclick="AA.toggleMachineFilter(\'kind:' + escHtml(k) + '\', \'kind\', this)">' + escHtml(k) + '</span>';
    });
    html += '</div>';

    var el = document.getElementById('aa-machine-tabs');
    if (el) el.innerHTML = html;
},
```

- [ ] **Step 2: Rewrite `_renderTaskTabs` with two groups**

Replace `_renderTaskTabs` (lines 276-292) with:

```javascript
_renderTaskTabs: function() {
    var types = {};
    var kinds = {};
    AA._state.tasks.forEach(function(t) {
        if (t.type) types[t.type] = true;
        if (t.task_kind) kinds[t.task_kind] = true;
    });

    var activeTypes = AA._state._activeTaskTypeFilters;
    var activeKinds = AA._state._activeTaskKindFilters;
    var html = '';

    // 机型组
    html += '<div class="aa-tab-group"><span class="aa-tag" style="font-size:11px;color:#94a3b8;font-weight:600;margin-right:4px;">机型</span>';
    html += '<span class="aa-tab' + (activeTypes.length === 0 ? ' on' : '') + '" data-group="type" data-filter="all" onclick="AA.toggleTaskFilter(\'all\', \'type\', this)">全部</span>';
    Object.keys(types).forEach(function(tp) {
        html += '<span class="aa-tab' + (activeTypes.indexOf(tp) >= 0 ? ' on' : '') + '" data-group="type" data-filter="type:' + escHtml(tp) + '" onclick="AA.toggleTaskFilter(\'type:' + escHtml(tp) + '\', \'type\', this)">' + escHtml(tp) + '</span>';
    });
    html += '</div>';

    // 任务类型组
    html += '<div class="aa-tab-group" style="margin-top:2px;"><span class="aa-tag" style="font-size:11px;color:#94a3b8;font-weight:600;margin-right:4px;">任务类型</span>';
    html += '<span class="aa-tab' + (activeKinds.length === 0 ? ' on' : '') + '" data-group="kind" data-filter="all" onclick="AA.toggleTaskFilter(\'all\', \'kind\', this)">全部</span>';
    Object.keys(kinds).forEach(function(k) {
        html += '<span class="aa-tab' + (activeKinds.indexOf(k) >= 0 ? ' on' : '') + '" data-group="kind" data-filter="kind:' + escHtml(k) + '" onclick="AA.toggleTaskFilter(\'kind:' + escHtml(k) + '\', \'kind\', this)">' + escHtml(k) + '</span>';
    });
    html += '</div>';

    var el = document.getElementById('aa-task-tabs');
    if (el) el.innerHTML = html;
},
```

- [ ] **Step 3: Update default tab HTML in auto_assign.html**

Replace the default tab placeholders at lines 53-54:

Old:
```html
<div class="aa-tabs" id="aa-machine-tabs">
    <span class="aa-tab on" data-filter="all" onclick="AA.filterMachines('all', this)">全部</span>
</div>
```

New:
```html
<div class="aa-tabs" id="aa-machine-tabs"></div>
```

And lines 68-69:

Old:
```html
<div class="aa-tabs" id="aa-task-tabs">
    <span class="aa-tab on" data-filter="all" onclick="AA.filterTasks('all', this)">全部</span>
</div>
```

New:
```html
<div class="aa-tabs" id="aa-task-tabs"></div>
```

- [ ] **Step 4: Commit**

```
git add static/auto-assign.js templates/dialogs/auto_assign.html
git commit -m "feat: render filter tabs as two groups with labels in auto-assign dialog"
```

---

### Task 4: Implement multi-select toggle + combined filter logic

**Files:**
- Modify: `static/auto-assign.js`

- [ ] **Step 1: Replace `filterMachines` with `toggleMachineFilter`**

Replace `filterMachines` (lines 237-242) with:

```javascript
toggleMachineFilter: function(filter, group, tabEl) {
    var arr = group === 'type' ? AA._state._activeMachineTypeFilters : AA._state._activeMachineKindFilters;
    if (filter === 'all') {
        arr.length = 0;
    } else {
        var val = filter.slice(5); // remove "type:" or "kind:" prefix
        var idx = arr.indexOf(val);
        if (idx >= 0) {
            arr.splice(idx, 1);
        } else {
            arr.push(val);
        }
    }
    AA._renderMachineTabs();
    AA._renderMachines();
},
```

- [ ] **Step 2: Replace `filterTasks` with `toggleTaskFilter`**

Replace `filterTasks` (lines 328-333) with:

```javascript
toggleTaskFilter: function(filter, group, tabEl) {
    var arr = group === 'type' ? AA._state._activeTaskTypeFilters : AA._state._activeTaskKindFilters;
    if (filter === 'all') {
        arr.length = 0;
    } else {
        var val = filter.slice(5);
        var idx = arr.indexOf(val);
        if (idx >= 0) {
            arr.splice(idx, 1);
        } else {
            arr.push(val);
        }
    }
    AA._renderTaskTabs();
    AA._renderTasks();
},
```

- [ ] **Step 3: Rewrite `_renderMachines` with combined AND/OR filter**

Replace `_renderMachines` (lines 201-229) with:

```javascript
_renderMachines: function() {
    var activeTypes = AA._state._activeMachineTypeFilters;
    var activeKinds = AA._state._activeMachineKindFilters;
    var list = AA._state.machines.slice();

    // Combined filter: type-group OR, kind-group OR, cross-group AND
    if (activeTypes.length > 0 || activeKinds.length > 0) {
        list = list.filter(function(m) {
            var typeOk = activeTypes.length === 0 || activeTypes.indexOf(m.type) >= 0;
            var kindOk = activeKinds.length === 0 || activeKinds.indexOf(m.task_kind) >= 0;
            return typeOk && kindOk;
        });
    }

    var sel = AA._state._selectedMachineIds || {};
    var html = '';
    list.forEach(function(m) {
        var disabled = m.status === '维修停用';
        var cls = 'aa-item';
        if (disabled) cls += ' disabled';
        if (!disabled && sel[m.id]) cls += ' on';
        html += '<div class="' + cls + '" data-id="' + m.id + '" onclick="' + (disabled ? '' : 'AA.toggleMachine(this)') + '">';
        html += '<span class="aa-cb">' + (disabled ? '' : '✓') + '</span>';
        html += '<span class="aa-name">' + escHtml(m.name) + '</span>';
        html += '<span class="aa-meta">' + escHtml(m.type || '') + ' · ' + escHtml(m.task_kind || '') + '</span>';
        html += '</div>';
    });
    if (!list.length) html = '<div style="padding:12px;color:#999;text-align:center;">暂无可选机器</div>';
    var el = document.getElementById('aa-machine-list');
    if (el) el.innerHTML = html;
    AA._updateMachineSummary();
},
```

Note: Removes the `filter` parameter — function now reads filter state internally.

- [ ] **Step 4: Rewrite `_renderTasks` with combined AND/OR filter**

Replace `_renderTasks` (lines 294-320) with:

```javascript
_renderTasks: function() {
    var activeTypes = AA._state._activeTaskTypeFilters;
    var activeKinds = AA._state._activeTaskKindFilters;
    var list = AA._state.tasks.slice();

    if (activeTypes.length > 0 || activeKinds.length > 0) {
        list = list.filter(function(tk) {
            var typeOk = activeTypes.length === 0 || activeTypes.indexOf(tk.type) >= 0;
            var kindOk = activeKinds.length === 0 || activeKinds.indexOf(tk.task_kind) >= 0;
            return typeOk && kindOk;
        });
    }

    var sel = AA._state._selectedTaskIds || {};
    var html = '';
    list.forEach(function(t) {
        var pri = t.priority || '';
        var durText = t.est_seconds ? Math.round(t.est_seconds / 60) + 'min' : (t.duration || '');
        var taskOn = sel[t.id] ? ' on' : '';
        html += '<div class="aa-item' + taskOn + '" data-id="' + t.id + '" onclick="AA.toggleTask(this)">';
        html += '<span class="aa-cb">✓</span>';
        if (pri) html += '<span class="aa-pri" style="' + AA._priStyle(pri) + '">' + escHtml(pri) + '</span>';
        html += '<span class="aa-name">' + escHtml(t.name || '') + '</span>';
        html += '<span class="aa-meta">' + escHtml(t.type || '') + ' · ' + escHtml(durText) + '</span>';
        html += '</div>';
    });
    if (!list.length) html = '<div style="padding:12px;color:#999;text-align:center;">没有待分配任务</div>';
    var el = document.getElementById('aa-task-list');
    if (el) el.innerHTML = html;
    AA._updateTaskSummary();
},
```

- [ ] **Step 5: Update `_loadMachines` and `_loadTasks` call sites**

In `_loadMachines` (line 172), change:
```javascript
AA._renderMachines('all');
```
to:
```javascript
AA._renderMachines();
```

In `_loadTasks` (line 268), change:
```javascript
AA._renderTasks('all');
```
to:
```javascript
AA._renderTasks();
```

- [ ] **Step 6: Commit**

```
git add static/auto-assign.js
git commit -m "feat: implement multi-select toggle filter with AND/OR logic"
```

---

### Task 5: Add preview sync-flash animation CSS

**Files:**
- Modify: `static/auto-assign.css`

- [ ] **Step 1: Add keyframe and apply to preview classes**

Append to `static/auto-assign.css`:

```css
/* 预览闪烁动画 */
@keyframes aa-preview-flash {
    0%, 100% { background-color: rgba(16, 185, 129, 0.08); }
    50%      { background-color: rgba(16, 185, 129, 0.28); }
}

.aa-preview-card {
    animation: aa-preview-flash 2s ease-in-out infinite;
}

.aa-pool-preview {
    animation: aa-preview-flash 2s ease-in-out infinite;
}
```

- [ ] **Step 2: Commit**

```
git add static/auto-assign.css
git commit -m "feat: add sync-flash animation to preview cards and pool items"
```

---

### Task 6: Link animation to settings toggle

**Files:**
- Modify: `static/style.css`

- [ ] **Step 1: Add preview classes to `body.no-animations` rule**

In `style.css` at the `body.no-animations` block (line 1685-1691), add `.aa-preview-card` and `.aa-pool-preview`:

```css
body.no-animations .task-block,
body.no-animations .task-draggable,
body.no-animations .task-complete-spread,
body.no-animations .task-delete-ripple,
body.no-animations .aa-preview-card,
body.no-animations .aa-pool-preview {
    animation: none !important;
    transition: none !important;
}
```

Note: No JS check needed in `timeline-render.js` — the animation is applied via CSS class, so the `body.no-animations` override rule suppresses it automatically.

- [ ] **Step 2: Commit**

```
git add static/style.css
git commit -m "fix: suppress preview flash animation when animations are disabled"
```

---

## Verification

1. Open dialog → machine and task tabs render as two labeled groups, each with "全部" lit
2. Click `BR1` type tab → "全部" in type group goes dark, list shows only BR1 items
3. Click `常规` kind tab → list shows only (BR1 AND 常规) items
4. Click `BR2` type tab → list shows ((BR1 OR BR2) AND 常规) items
5. Click `BR1` again to deselect → BR1 darkens, list adjusts
6. Click type group "全部" → all type tabs clear, "全部" lights
7. Deselect a few machines manually → switch filter tabs → deselection preserved
8. "已选 X 台" count reflects actual selections, not filtered count
9. Click preview → timeline preview cards pulse synchronously, pool items pulse synchronously
10. Disable animations in settings → preview cards stop flashing (static dashed)
11. Confirm assignment → preview cards disappear, schedule blocks appear
