# 多选筛选 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将机器管理页面的 4 个单选 `<select>` 筛选改为多选标签面板模式，不符合筛选的机器自动隐藏，支持即时生效和重置。

**Architecture:** 纯前端改造 — 用自定义触发按钮 + 标签面板替换原生 `<select>`。筛选状态存 JS 对象 `_filterState`，维度间 AND 关系。不符合条件的机器进隐藏区，手动恢复后不受后续筛选变更影响。

**Tech Stack:** vanilla JS + CSS，Flask/Jinja2 后端仅需 `get()` → `getlist()` 适配

---

## File Structure

| 文件 | 职责 |
|------|------|
| `templates/panels/machines.html` | 筛选栏 DOM 改造：触发按钮 + 标签面板容器 + 条件标签条 + 重置按钮 |
| `static/style.css` | 标签面板、条件标签、触发按钮、重置按钮、维度颜色 |
| `static/timeline.js` | `changeMachineFilter` 重写为多值 URL 同步；`_refreshMachineList` 增加筛选隐藏逻辑 |
| `static/core.js` | `_filterMachinesByUI` 重写为多值；新增 `_filterState` 管理 + `_filterForceVisibleIds` |
| `routes/views.py` | `m_type`/`m_kind` 等参数从 `get()` 改为 `getlist()` |

---

### Task 1: 筛选栏 HTML 结构改造

**Files:**
- Modify: `templates/panels/machines.html:46-72`

- [ ] **Step 1: 替换筛选栏 HTML**

将 `templates/panels/machines.html` 第 46-72 行的筛选栏替换为：

```html
<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:8px;">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;" id="filter-bar-row">
        <!-- 机型 -->
        <b>筛选机型：</b>
        <div class="filter-dim" data-dim="type">
            <button class="filter-trigger" id="filter-trigger-type" onclick="toggleFilterPanel('type')" type="button">全部 ▾</button>
            <div class="filter-panel" id="filter-panel-type"></div>
        </div>
        <!-- 状态 -->
        <b>状态：</b>
        <div class="filter-dim" data-dim="status">
            <button class="filter-trigger" id="filter-trigger-status" onclick="toggleFilterPanel('status')" type="button">全部 ▾</button>
            <div class="filter-panel" id="filter-panel-status"></div>
        </div>
        <!-- 任务类型 -->
        <b>任务类型：</b>
        <div class="filter-dim" data-dim="kind">
            <button class="filter-trigger" id="filter-trigger-kind" onclick="toggleFilterPanel('kind')" type="button">全部 ▾</button>
            <div class="filter-panel" id="filter-panel-kind"></div>
        </div>
        <!-- 分组 -->
        <b>分组：</b>
        <div class="filter-dim" data-dim="group">
            <button class="filter-trigger" id="filter-trigger-group" onclick="toggleFilterPanel('group')" type="button">全部 ▾</button>
            <div class="filter-panel" id="filter-panel-group"></div>
        </div>
    </div>
    <!-- 重置按钮 -->
    <button class="btn filter-reset-btn" id="filter-reset-btn" onclick="resetAllFilters()" disabled type="button">↺ 重置</button>
</div>
<!-- 条件标签条 -->
<div class="filter-conditions" id="filter-conditions" style="display:none;align-items:center;gap:6px;flex-wrap:wrap;padding:6px 0;border-top:1px solid var(--border-light);margin-bottom:12px;">
    <span style="font-size:11px;color:var(--text-muted);">条件：</span>
    <span id="filter-condition-tags" style="display:inline-flex;gap:4px;flex-wrap:wrap;"></span>
</div>
```

- [ ] **Step 2: 初始化标签面板数据**

在 `machines.html` 底部（`</div>` 关闭 panel 前）追加一段 inline script，把后端数据灌入 JS 变量供面板渲染：

```html
<script>
window._filterPanelData = {
    type: [{% for mt in app_config.machine_types %}"{{mt.key}}"{% if not loop.last %},{% endif %}{% endfor %}],
    status: ["空闲","工作","维修停用","隐藏维修"],
    kind: [{% for tk in app_config.task_kinds %}"{{tk.key}}"{% if not loop.last %},{% endif %}{% endfor %}],
    group: [{% for mg in app_config.get('machine_groups', []) %}"{{mg.key}}"{% if not loop.last %},{% endif %}{% endfor %}]
};
</script>
```

- [ ] **Step 3: 保留旧的隐藏下拉框用于 URL 初始化**

在筛选栏下方添加 4 个 `display:none` 的原始 select，用于从 URL 参数初始化多选状态（不改后端模板渲染逻辑）：

```html
<div style="display:none;">
    <select id="machine-filter">{% for mt in app_config.machine_types %}<option value="{{mt.key}}">{{mt.key}}</option>{% endfor %}</select>
    <select id="machine-status-filter"><option value="空闲">空闲</option><option value="工作">工作</option><option value="维修停用">维修停用</option><option value="隐藏维修">隐藏维修</option></select>
    <select id="machine-kind-filter">{% for tk in app_config.task_kinds %}<option value="{{tk.key}}">{{tk.key}}</option>{% endfor %}</select>
    <select id="machine-group-filter">{% for mg in app_config.get('machine_groups', []) %}<option value="{{mg.key}}">{{mg.key}}</option>{% endfor %}<option value="未分组">未分组</option></select>
</div>
```

这些隐藏 select 仅在页面加载时用于 `initFilterStateFromURL()` 解析旧的单值 URL 参数。

- [ ] **Step 4: Commit**

```bash
git add templates/panels/machines.html
git commit -m "feat: replace filter select dropdowns with tag panel trigger buttons"
```

---

### Task 2: 标签面板和条件标签 CSS

**Files:**
- Modify: `static/style.css` (末尾追加)

- [ ] **Step 1: 追加筛选标签面板 CSS**

在 `static/style.css` 末尾追加：

```css
/* ========== 多选筛选标签面板 ========== */
.filter-dim { position: relative; display: inline-block; }
.filter-trigger {
    padding: 4px 10px; font-size: 12px; border: 1px solid var(--border);
    border-radius: var(--radius-xs); background: var(--bg-card);
    color: var(--text-primary); cursor: pointer; white-space: nowrap;
    min-width: 60px; text-align: left;
}
.filter-trigger:hover { border-color: var(--primary); }
.filter-trigger.active { border-color: var(--primary); background: var(--primary-light); color: var(--primary); }
.filter-trigger:disabled, .filter-trigger.disabled { opacity: 0.5; cursor: not-allowed; }

.filter-panel {
    display: none; position: absolute; top: 100%; left: 0; z-index: 100;
    background: var(--bg-card); border: 1px solid var(--border);
    border-radius: var(--radius-sm); padding: 10px 12px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.08); min-width: 180px;
    margin-top: 4px;
}
.filter-panel.open { display: block; }

.filter-tag {
    display: inline-block; padding: 3px 10px; border: 1px solid var(--border);
    border-radius: 4px; font-size: 12px; cursor: pointer; user-select: none;
    background: var(--bg-card); color: var(--text-muted);
    transition: all 0.15s; white-space: nowrap;
}
.filter-tag:hover { border-color: var(--primary); color: var(--text-primary); }

/* 维度颜色 — 机型(橙) */
.filter-dim[data-dim="type"] .filter-tag.selected,
.filter-condition-tag[data-dim="type"] {
    background: #fffbeb; color: #92400e; border-color: #fcd34d;
}
.filter-dim[data-dim="type"] .filter-trigger.active { border-color: #d97706; background: #fffbeb; color: #92400e; }

/* 维度颜色 — 状态(绿) */
.filter-dim[data-dim="status"] .filter-tag.selected,
.filter-condition-tag[data-dim="status"] {
    background: #ecfdf5; color: #065f46; border-color: #6ee7b7;
}
.filter-dim[data-dim="status"] .filter-trigger.active { border-color: #059669; background: #ecfdf5; color: #065f46; }

/* 维度颜色 — 任务类型(紫) */
.filter-dim[data-dim="kind"] .filter-tag.selected,
.filter-condition-tag[data-dim="kind"] {
    background: #f5f3ff; color: #5b21b6; border-color: #c4b5fd;
}
.filter-dim[data-dim="kind"] .filter-trigger.active { border-color: #7c3aed; background: #f5f3ff; color: #5b21b6; }

/* 维度颜色 — 分组(蓝) */
.filter-dim[data-dim="group"] .filter-tag.selected,
.filter-condition-tag[data-dim="group"] {
    background: #eff6ff; color: #1e40af; border-color: #93c5fd;
}
.filter-dim[data-dim="group"] .filter-trigger.active { border-color: #2563eb; background: #eff6ff; color: #1e40af; }

/* 条件标签条 */
.filter-condition-tag {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 2px 8px; border-radius: 3px; font-size: 11px;
    border: 1px solid;
}
.filter-condition-tag .remove-cond { cursor: pointer; opacity: 0.5; font-size: 13px; line-height: 1; }
.filter-condition-tag .remove-cond:hover { opacity: 1; }

/* 重置按钮 */
.filter-reset-btn { padding: 4px 12px; font-size: 12px; white-space: nowrap; }
.filter-reset-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* 标签面板内标签列表 */
.filter-tag-list { display: flex; gap: 6px; flex-wrap: wrap; }
```

- [ ] **Step 2: Commit**

```bash
git add static/style.css
git commit -m "feat: add tag panel and condition tag CSS for multi-select filter"
```

---

### Task 3: 筛选状态管理 + 面板交互（core.js）

**Files:**
- Modify: `static/core.js` (替换 `_filterMachinesByUI`，新增状态管理函数)

- [ ] **Step 1: 新增筛选状态变量和初始化函数**

在 `static/core.js` 的 `_filterMachinesByUI` 函数之前（约第 100 行），插入：

```javascript
// ========== 多选筛选状态管理 ==========
var _filterState = { type: [], status: [], kind: [], group: [] };
var _filterForceVisibleIds = new Set();

// 维度中文标签映射
var _filterDimLabels = { type: '机型', status: '状态', kind: '任务类型', group: '分组' };

function initFilterStateFromURL() {
    var url = new URL(window.location.href);
    var vals = {};
    ['type','status','kind','group'].forEach(function(dim) {
        var paramName = 'm_' + dim;
        var raw = url.searchParams.getAll(paramName);
        // 兼容旧单值 URL（使用 get 兜底）
        if (raw.length === 0) {
            var single = url.searchParams.get(paramName);
            if (single) raw = [single];
        }
        // 过滤掉不在可选值中的无效参数
        var validOptions = (_filterPanelData && _filterPanelData[dim]) ? _filterPanelData[dim] : [];
        vals[dim] = raw.filter(function(v) { return validOptions.indexOf(v) >= 0; });
    });
    _filterState = vals;
    _syncFilterUI();
}

function _syncFilterUI() {
    var hasAny = false;
    ['type','status','kind','group'].forEach(function(dim) {
        var sel = _filterState[dim];
        var btn = document.getElementById('filter-trigger-' + dim);
        var panel = document.getElementById('filter-panel-' + dim);

        // 更新触发按钮文字
        if (btn) {
            if (sel.length === 0) { btn.textContent = '全部 ▾'; btn.classList.remove('active'); }
            else { btn.textContent = '已选 ' + sel.length + ' 项 ▾'; btn.classList.add('active'); }
        }

        // 更新面板内标签
        if (panel && _filterPanelData && _filterPanelData[dim]) {
            var html = '<div class="filter-tag-list">';
            _filterPanelData[dim].forEach(function(v) {
                var isSel = sel.indexOf(v) >= 0;
                html += '<span class="filter-tag' + (isSel ? ' selected' : '') + '" data-value="' + escHtml(v) + '" onclick="_toggleFilterTag(\'' + dim + '\',\'' + escHtml(v) + '\')">' + escHtml(v) + '</span>';
            });
            html += '</div>';
            panel.innerHTML = html;
        }

        if (sel.length > 0) hasAny = true;
    });

    // 更新条件标签条
    _renderConditionTags();

    // 更新重置按钮
    var resetBtn = document.getElementById('filter-reset-btn');
    if (resetBtn) { resetBtn.disabled = !hasAny; resetBtn.style.opacity = hasAny ? '' : '0.4'; }
}

function _renderConditionTags() {
    var container = document.getElementById('filter-condition-tags');
    var bar = document.getElementById('filter-conditions');
    if (!container || !bar) return;
    var html = '';
    ['type','status','kind','group'].forEach(function(dim) {
        _filterState[dim].forEach(function(v) {
            html += '<span class="filter-condition-tag" data-dim="' + dim + '" data-value="' + escHtml(v) + '">' + escHtml(_filterDimLabels[dim]) + ': ' + escHtml(v) + ' <span class="remove-cond" onclick="_removeFilterCondition(\'' + dim + '\',\'' + escHtml(v) + '\')">&times;</span></span>';
        });
    });
    container.innerHTML = html;
    bar.style.display = html ? 'flex' : 'none';
}

function _toggleFilterTag(dim, value) {
    var arr = _filterState[dim];
    var idx = arr.indexOf(value);
    if (idx >= 0) { arr.splice(idx, 1); } else { arr.push(value); }
    _syncFilterUI();
    _applyFilterAndRefresh();
}

function _removeFilterCondition(dim, value) {
    var arr = _filterState[dim];
    var idx = arr.indexOf(value);
    if (idx >= 0) { arr.splice(idx, 1); }
    _syncFilterUI();
    _applyFilterAndRefresh();
}

function resetAllFilters() {
    _filterState = { type: [], status: [], kind: [], group: [] };
    _filterForceVisibleIds.clear();
    _syncFilterUI();
    // 关闭所有面板
    document.querySelectorAll('.filter-panel.open').forEach(function(p) { p.classList.remove('open'); });
    _applyFilterAndRefresh();
}

// 面板开关
function toggleFilterPanel(dim) {
    var panel = document.getElementById('filter-panel-' + dim);
    if (!panel) return;
    var wasOpen = panel.classList.contains('open');
    // 关掉其他面板
    document.querySelectorAll('.filter-panel.open').forEach(function(p) { p.classList.remove('open'); });
    if (!wasOpen) {
        panel.classList.add('open');
        // 确保面板数据已渲染
        if (!panel.querySelector('.filter-tag-list')) _syncFilterUI();
    }
}

// 点击面板外部关闭
document.addEventListener('click', function(e) {
    if (!e.target.closest('.filter-dim')) {
        document.querySelectorAll('.filter-panel.open').forEach(function(p) { p.classList.remove('open'); });
    }
});

function _applyFilterAndRefresh() {
    // 更新 URL
    var url = new URL(window.location.href);
    ['type','status','kind','group'].forEach(function(dim) {
        url.searchParams.delete('m_' + dim);
        _filterState[dim].forEach(function(v) { url.searchParams.append('m_' + dim, v); });
    });
    try { history.replaceState(null, '', url.toString()); } catch(e) {}
    _refreshMachineList();
}
```

- [ ] **Step 2: 替换 `_filterMachinesByUI` 函数（core.js 第 101-122 行）**

```javascript
function _filterMachinesByUI(machines) {
    var result = machines;
    // 多选 AND 逻辑：每个维度如果选了值，则机器的值必须在该维度的选中列表中
    if (_filterState.type.length > 0) {
        result = result.filter(function(m) { return _filterState.type.indexOf(m.type) >= 0; });
    }
    if (_filterState.status.length > 0) {
        result = result.filter(function(m) {
            for (var i = 0; i < _filterState.status.length; i++) {
                var s = _filterState.status[i];
                if (s === '隐藏维修') { if (m.status !== '维修停用') return true; }
                else { if (m.status === s) return true; }
            }
            return false;
        });
    }
    if (_filterState.kind.length > 0) {
        result = result.filter(function(m) { return _filterState.kind.indexOf(m.task_kind) >= 0; });
    }
    if (_filterState.group.length > 0) {
        result = result.filter(function(m) {
            for (var i = 0; i < _filterState.group.length; i++) {
                var g = _filterState.group[i];
                if (g === '未分组') { if (!m.group_name) return true; }
                else { if (m.group_name === g) return true; }
            }
            return false;
        });
    }
    return result;
}
```

- [ ] **Step 3: 新增 `_isFilterActive` 辅助函数**

在 `_filterMachinesByUI` 后追加：

```javascript
function _isFilterActive() {
    return _filterState.type.length > 0 || _filterState.status.length > 0 || _filterState.kind.length > 0 || _filterState.group.length > 0;
}
```

- [ ] **Step 4: Commit**

```bash
git add static/core.js
git commit -m "feat: add multi-select filter state management and tag panel interaction"
```

---

### Task 4: timeline.js — 筛选隐藏联动 + URL 初始化

**Files:**
- Modify: `static/timeline.js:111-123` (`changeMachineFilter`)
- Modify: `static/timeline.js:124-138` (`_refreshMachineList`)

- [ ] **Step 1: 替换 `changeMachineFilter`（timeline.js 第 111-123 行）**

弃用旧单选逻辑，改为调用新的 `_applyFilterAndRefresh`：

```javascript
function changeMachineFilter(){
    // 多选筛选模式：此函数不再从 select 读取，保留兼容旧调用
    _applyFilterAndRefresh();
}
```

- [ ] **Step 2: 替换 `_refreshMachineList`（timeline.js 第 124-138 行）**

增加筛选隐藏联动：

```javascript
function _refreshMachineList(){
    fetch('/api/machines')
    .then(function(r){return r.json();})
    .then(function(d){
        var machines = d.machines;
        var filtered = _filterMachinesByUI(machines);
        var sorted = _sortMachinesByURL(filtered);

        if (_isFilterActive()) {
            // 筛选激活时：不符合条件的进隐藏区
            var matchingSet = new Set();
            sorted.forEach(function(m) { matchingSet.add(m.id); });

            var allSorted = _sortMachinesByURL(machines);
            var visible = [];
            var hidden = [];
            allSorted.forEach(function(m) {
                var manualHidden = _hiddenMachineIds.has(m.id);
                var forceVisible = _filterForceVisibleIds.has(m.id);
                var matches = matchingSet.has(m.id);

                if (manualHidden) {
                    hidden.push(m);  // 手动隐藏的永远在隐藏区
                } else if (matches || forceVisible) {
                    visible.push(m);  // 符合筛选 或 强制可见
                } else {
                    hidden.push(m);  // 不符合筛选 → 隐藏区
                }
            });
            _renderMachineTable(visible);
            _renderHiddenMachineTable(hidden);
        } else {
            // 无筛选时：仅手动眼睛隐藏生效
            var visible = sorted.filter(function(m) { return !_hiddenMachineIds.has(m.id); });
            var hidden = sorted.filter(function(m) { return _hiddenMachineIds.has(m.id); });
            _renderMachineTable(visible);
            _renderHiddenMachineTable(hidden);
        }
    }).catch(function(){
        showToast('机器列表加载失败，请检查网络或刷新页面');
    });
}
```

- [ ] **Step 3: 修改 `_renderHiddenMachineTable`—隐藏区内恢复逻辑**

在 `_renderHiddenMachineTable` 函数（约第 177 行）中，眼睛点击逻辑需要区分手动隐藏和筛选隐藏。眼睛恢复时如果是筛选隐藏的机器，需要加入 `_filterForceVisibleIds`。但由于眼睛点击走的是 `_toggleMachineVisibility`（在 core.js），我们需要修改它。

在 `core.js` 的 `_toggleMachineVisibility` 函数（第 141-148 行）替换为：

```javascript
function _toggleMachineVisibility(mid) {
    mid = parseInt(mid, 10);
    if (_hiddenMachineIds.has(mid)) {
        _hiddenMachineIds.delete(mid);
    } else if (_isFilterActive() && !_filterMachinesByUI([ALL_MACHINES_CACHE.get(mid)]).length && !_filterForceVisibleIds.has(mid)) {
        // 机器不符合筛选条件 → 不是传统隐藏，而是强制可见
        _filterForceVisibleIds.add(mid);
    } else if (_filterForceVisibleIds.has(mid)) {
        _filterForceVisibleIds.delete(mid);
    } else {
        _hiddenMachineIds.add(mid);
    }
    _saveHiddenMachines();
    _refreshMachineList();
    _refreshTimelineFromServer();
}
```

这里有个问题：`_toggleMachineVisibility` 需要判断该机器是否符合筛选。需要在 core.js 中加一个轻量的机器缓存。更简单的方式是直接在 timeline.js 的 `_renderHiddenMachineTable` 里覆盖眼睛的 onclick 逻辑。

换一种更简单的做法：在 `_renderHiddenMachineTable` 渲染隐藏区行时，眼睛按钮不走 `_toggleMachineVisibility`，而走一个新的 `_restoreHiddenMachine(mid)` 函数：

修改 `_renderHiddenMachineTable` 中眼睛那列的渲染（第 207-208 行）：

```javascript
// 替换原眼睛 td
'<td style="text-align:center">' +
    '<span class="eye-toggle eye-hidden" data-mid="' + m.id + '" onclick="_restoreHiddenMachine(' + m.id + ')" title="恢复到时间轴">&#x1F441;&#x200D;&#x1F5E8;</span>' +
'</td>' +
```

同时在 `_renderMachineTable` 中，可见机器的眼睛保持调用 `_toggleMachineVisibility`（不变）。

然后在 core.js 中新增：

```javascript
function _restoreHiddenMachine(mid) {
    mid = parseInt(mid, 10);
    // 如果机器在手动隐藏集合中，移除它
    if (_hiddenMachineIds.has(mid)) {
        _hiddenMachineIds.delete(mid);
    }
    // 如果机器不在手动隐藏集合中，说明是筛选隐藏 → 强制可见
    if (!_hiddenMachineIds.has(mid)) {
        _filterForceVisibleIds.add(mid);
    }
    _saveHiddenMachines();
    _refreshMachineList();
    _refreshTimelineFromServer();
}
```

- [ ] **Step 4: 添加页面加载初始化调用**

在 `timeline.js` 中找到 DOMContentLoaded 或 switchTab 相关初始化代码，在机器面板切换到可见时调用 `initFilterStateFromURL()` 和 `_syncFilterUI()`。查找合适的挂载点。

查找 `switchTab` 函数中机器管理面板（tab index 1）的初始化：

```bash
grep -n "switchTab\|case 1:\|tabIndex.*1" static/timeline.js
```

在机器管理面板激活时追加：

```javascript
if (typeof initFilterStateFromURL === 'function') {
    initFilterStateFromURL();
}
```

- [ ] **Step 5: 修改 `restoreAllHiddenMachines`**

`restoreAllHiddenMachines`（timeline.js 第 226-232 行）需要在清除手动隐藏的同时清除筛选强制可见标记：

```javascript
function restoreAllHiddenMachines() {
    if (_hiddenMachineIds.size === 0 && _filterForceVisibleIds.size === 0) return;
    _hiddenMachineIds.clear();
    _filterForceVisibleIds.clear();
    _saveHiddenMachines();
    _refreshMachineList();
    _refreshTimelineFromServer();
}
```

- [ ] **Step 6: Commit**

```bash
git add static/timeline.js static/core.js
git commit -m "feat: integrate multi-select filter with hidden machine section"
```

---

### Task 5: 后端 views.py — getlist 适配

**Files:**
- Modify: `routes/views.py:18-21`

- [ ] **Step 1: 将单值参数改为多值列表**

```python
# 改前 (line 18-21):
m_type = (request.args.get("m_type") or "").strip()
m_status = (request.args.get("m_status") or "").strip()
m_kind = (request.args.get("m_kind") or "").strip()
m_group = (request.args.get("m_group") or "").strip()

# 改后:
m_type_list = request.args.getlist("m_type")
m_status_list = request.args.getlist("m_status")
m_kind_list = request.args.getlist("m_kind")
m_group_list = request.args.getlist("m_group")
```

同时更新模板传参（约第 49-52 行），改为传列表：

```python
m_type_list=m_type_list,
m_status_list=m_status_list,
m_kind_list=m_kind_list,
m_group_list=m_group_list,
```

保留旧的 `m_type`、`m_status` 等变量在模板中作为兼容（或直接移除 — Jinja2 模板中按名称引用这些变量）。检查模板中对这些变量的引用。

当前模板 `machines.html` 中 `m_type`、`m_status`、`m_kind`、`m_group` 用于设置 select 的 `selected` 属性。现在改为触发按钮模式后，这些旧变量不再需要。但模板中可能有其他地方引用。

- [ ] **Step 2: 检查并更新模板变量引用**

```bash
grep -n "m_type\|m_status\|m_kind\|m_group" templates/panels/machines.html
```

如果模板中仍有引用，将其替换为列表版本或移除（因为筛选 UI 已改为 JS 驱动）。

- [ ] **Step 3: Commit**

```bash
git add routes/views.py templates/panels/machines.html
git commit -m "feat: support multi-value filter params via request.args.getlist"
```

---

### Task 6: 集成验证和收尾

**Files:**
- Modify: `static/machines.js` (确保 `_refreshGroupSelects` 不破坏新的筛选 UI)
- Modify: `static/machines.js` (确保 `_appendMachineRow` 与新的筛选兼容)

- [ ] **Step 1: 更新 `_refreshGroupSelects` 同步分组标签面板**

`_refreshGroupSelects`（machines.js 第 636-678 行）在分组 CRUD 后刷新所有下拉框。现在需要同步更新筛选面板和面板数据：

在 `_refreshGroupSelects` 的 `.then()` 回调末尾（`_refreshMachineList()` 调用后）追加：

```javascript
// 同步分组标签面板数据
if (typeof _filterPanelData !== 'undefined') {
    _filterPanelData.group = groups.map(function(g) { return g.key; });
    // 清理 _filterState.group 中不存在的新分组名
    var validKeys = _filterPanelData.group;
    _filterState.group = _filterState.group.filter(function(v) { return validKeys.indexOf(v) >= 0; });
    _syncFilterUI();
}
```

- [ ] **Step 2: 验证流程**

启动应用：

```powershell
python app.py
```

测试用例：
1. 打开机器管理页面，筛选栏显示 4 个触发按钮 + 重置按钮（灰色）
2. 点击"分组"触发按钮 → 展开标签面板，显示所有分组
3. 点击 2 个分组标签 → 即时选中变色，触发按钮变为"已选 2 项"
4. 关闭面板 → 条件标签条显示 `分组: A ×  分组: B ×`
5. 机器列表只显示选中分组的机器，其余进隐藏区
6. 在隐藏区点击眼睛 → 机器恢复到可见列表（即使不符合筛选）
7. 点击条件标签 ✕ → 条件移除，列表更新
8. 点击重置 → 所有条件清除，所有机器显示（手动隐藏的除外）
9. 同时打开两个维度面板 → 各自独立操作
10. 刷新页面 → URL 参数恢复筛选状态

- [ ] **Step 3: Commit**

```bash
git add static/machines.js
git commit -m "fix: update group refresh to sync with multi-select filter panels"
```

---

## Self-Review

1. **Spec coverage:**
   - 下拉点击展开标签面板 → Task 1 (HTML) + Task 3 (JS toggleFilterPanel)
   - 标签即时切换选中 → Task 3 (_toggleFilterTag → _applyFilterAndRefresh)
   - 多面板同时展开 → Task 3 (toggleFilterPanel 逻辑)
   - 条件标签条 + ✕ 删除 → Task 1 (HTML) + Task 2 (CSS) + Task 3 (_renderConditionTags, _removeFilterCondition)
   - 重置按钮 → Task 1 (HTML) + Task 2 (CSS) + Task 3 (resetAllFilters)
   - 维度间 AND → Task 3 (_filterMachinesByUI 重写)
   - 维度颜色区分 → Task 2 (CSS .filter-dim[data-dim="..."] .filter-tag.selected)
   - 不符合条件进隐藏区 → Task 4 (_refreshMachineList 重写)
   - 隐藏区眼睛恢复 → Task 4 (_restoreHiddenMachine + _filterForceVisibleIds)
   - URL 同步 → Task 3 (_applyFilterAndRefresh) + Task 5 (getlist)
   - 启动时从 URL 恢复 → Task 3 (initFilterStateFromURL)
   - 分组 CRUD 后同步面板 → Task 6

2. **Placeholder scan:** 无 TBD/TODO，所有步骤都有具体代码。

3. **Type consistency:** `_filterState` 结构为 `{type:[], status:[], kind:[], group:[]}`，所有函数引用一致。`_filterPanelData` 在 HTML inline script 中定义，在 `initFilterStateFromURL` 和 `_syncFilterUI` 中引用，key 名称一致。
