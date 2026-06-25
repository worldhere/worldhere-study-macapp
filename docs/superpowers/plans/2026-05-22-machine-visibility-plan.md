# 机器可见性交互重构 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将机器管理"可见"列从 checkbox 改为眼睛图标，新增独立隐藏机器表格模块，筛选优先+手动隐藏叠加。

**Architecture:** `_filterMachinesByUI` 不再过滤隐藏机器（仅负责下拉筛选），调用方自行决定是否需要隐藏过滤。`_refreshMachineList` 将筛选结果拆为 visible/hidden 两组，分别渲染主表格和隐藏表格。隐藏表格是可折叠的完整功能表格。

**Tech Stack:** Vanilla JS + CSS，无新增依赖

**文件变更：** 修改 5 个文件，无新建文件

---

### Task 1: `_filterMachinesByUI` — 移除隐藏机器过滤

**Files:**
- Modify: `static/core.js:118-121`

- [ ] **Step 1: 删除隐藏机器过滤逻辑**

删除 `_filterMachinesByUI` 函数末尾的隐藏机器过滤代码（第118-121行）：

```javascript
// 删除以下4行：
    // 过滤用户手动隐藏的机器
    if (_hiddenMachineIds.size > 0) {
        result = result.filter(function(m) { return !_hiddenMachineIds.has(m.id); });
    }
```

改后函数以 `return result;` 直接结束（在状态/类型筛选之后）。

- [ ] **Step 2: 验证 — `_refreshTimelineFromServer` 需要补回隐藏过滤**

`static/tasks.js:312` 的 `_refreshTimelineFromServer` 调用了 `_filterMachinesByUI`，现在需要在调用后手动过滤隐藏机器。在 `_filterMachinesByUI(machines)` 之后插入：

```javascript
// 在 static/tasks.js 第312行之后插入：
machines = machines.filter(function(m) { return !_hiddenMachineIds.has(m.id); });
```

完整上下文（tasks.js:308-312）：
```javascript
var machines = results[0].machines;
var freshData = results[1];
schedules = freshData.schedules;
window._repairLogs = freshData.repair_logs || {};
machines = _sortMachinesByURL(_filterMachinesByUI(machines));
// 插入这行 ↓
machines = machines.filter(function(m) { return !_hiddenMachineIds.has(m.id); });
```

- [ ] **Step 3: Commit**

---

### Task 2: 机器表格渲染 — 主表格眼睛图标 + 隐藏表格新函数

**Files:**
- Modify: `static/timeline.js:124-168`

- [ ] **Step 1: 拆分 `_refreshMachineList`，分离 visible/hidden**

将 `_refreshMachineList`（第124-133行）改为：

```javascript
function _refreshMachineList(){
    fetch('/api/machines')
    .then(function(r){return r.json();})
    .then(function(d){
        var machines = d.machines;
        var filtered = _filterMachinesByUI(machines);
        var sorted = _sortMachinesByURL(filtered);
        var visible = sorted.filter(function(m) { return !_hiddenMachineIds.has(m.id); });
        var hidden = sorted.filter(function(m) { return _hiddenMachineIds.has(m.id); });
        _renderMachineTable(visible);
        _renderHiddenMachineTable(hidden);
    }).catch(function(){
        showToast('机器列表加载失败，请检查网络或刷新页面');
    });
}
```

- [ ] **Step 2: 修改 `_renderMachineTable` — 眼睛图标替代 checkbox**

将第154-156行的 checkbox 替换为眼睛图标：

```javascript
// 旧（第154-156行）：
            '<td><input type="checkbox" class="machine-visible-check" data-mid="' + m.id + '" ' +
                (_hiddenMachineIds.has(m.id) ? '' : 'checked') +
                ' onchange="_toggleMachineVisibility(' + m.id + ')"></td>'+

// 新：
            '<td style="text-align:center">' +
                '<span class="eye-toggle" data-mid="' + m.id + '" onclick="_toggleMachineVisibility(' + m.id + ')" title="在时间轴隐藏">&#x1F441;</span>' +
            '</td>'+
```

表头的"可见"列也改为眼睛图标符号：

```javascript
// 旧（第139行）：
    var html = '<tr><th>'+_sortLink('机型','type')+'</th><th>'+_sortLink('名称','name')+'</th><th>'+_sortLink('状态','status')+'</th><th>'+_sortLink('任务类型','task_kind')+'</th><th>可见</th><th>操作</th></tr>';

// 新：
    var html = '<tr><th>'+_sortLink('机型','type')+'</th><th>'+_sortLink('名称','name')+'</th><th>'+_sortLink('状态','status')+'</th><th>'+_sortLink('任务类型','task_kind')+'</th><th style="text-align:center;width:40px">&#x1F441;</th><th>操作</th></tr>';
```

- [ ] **Step 3: 删除 `_updateVisToggleAllButton()` 调用**

`_renderMachineTable` 末尾的 `_updateVisToggleAllButton();`（第167行）改为无操作或删除（该按钮将被移除）。

- [ ] **Step 4: 新增 `_renderHiddenMachineTable` 函数**

在 `_renderMachineTable` 下方新增：

```javascript
function _renderHiddenMachineTable(machines) {
    var container = document.getElementById('hidden-machines-module');
    if (!container) return;
    if (!machines || machines.length === 0) {
        container.style.display = 'none';
        return;
    }
    container.style.display = '';
    var tbody = document.getElementById('hidden-machines-tbody');
    if (!tbody) return;
    var html = '';
    for (var i = 0; i < machines.length; i++) {
        var m = machines[i];
        html += '<tr data-mid="' + m.id + '">' +
            '<td>' + escHtml(m.type) + '</td>' +
            '<td>' +
                '<input style="width:140px" value="' + escHtml(m.name) + '" id="hmn_' + m.id + '" data-orig="' + escHtml(m.name) + '" oninput="toggleMachineRowSave(' + m.id + ')">' +
                '<button class="btn" id="hms_' + m.id + '" style="display:none;padding:4px 8px;" onclick="saveMachineName(' + m.id + ')">保存</button>' +
            '</td>' +
            '<td><span class="machine-status-text" data-mid="' + m.id + '">' + escHtml(m.status) + '</span></td>' +
            '<td>' +
                '<select id="hmk_' + m.id + '" data-orig="' + escHtml(m.task_kind || '常规') + '" onchange="saveMachineName(' + m.id + ')">' +
                    _taskKindOptions(m.task_kind) +
                '</select>' +
            '</td>' +
            '<td style="text-align:center">' +
                '<span class="eye-toggle eye-hidden" data-mid="' + m.id + '" onclick="_toggleMachineVisibility(' + m.id + ')" title="恢复到时间轴">&#x1F441;&#x200D;&#x1F5E8;</span>' +
            '</td>' +
            '<td>' +
                '<button onclick="setMachineStatus(' + m.id + ',\'工作\')">工作</button>' +
                '<button onclick="setMachineStatus(' + m.id + ',\'维修停用\')">维修</button>' +
                '<button onclick="setMachineStatus(' + m.id + ',\'空闲\')">空闲</button>' +
                '<button class="btn-danger" onclick="recallMachineTasks(' + m.id + '">回收该机任务</button>' +
                '<button class="btn-danger" onclick="delMachine(' + m.id + ')">删除</button>' +
            '</td>' +
        '</tr>';
    }
    tbody.innerHTML = html;
    // 更新计数
    var countEl = document.getElementById('hidden-machines-count');
    if (countEl) countEl.textContent = machines.length;
    // 更新全部恢复按钮显隐
    var restoreBtn = document.getElementById('hidden-restore-all-btn');
    if (restoreBtn) restoreBtn.style.display = machines.length > 0 ? '' : 'none';
}
```

**注意：** 隐藏表格中的输入框/下拉框使用 `hmn_`/`hms_`/`hmk_` 前缀（多加了一个 `h`）避免与主表格的元素 ID 冲突。但 `saveMachineName` 和 `toggleMachineRowSave` 使用的是 `mn_`/`ms_`/`mk_` 前缀。需要确保两个表都能正常工作。

最简单的方案：隐藏表格的元素 ID 保持和主表格一样的命名规则（`mn_`, `ms_`, `mk_`），因为同一台机器不会同时出现在两个表中。这样 `saveMachineName` 和 `toggleMachineRowSave` 直接就能用。

改回标准命名：

```javascript
// hidden table 中的元素 ID 使用标准前缀（与主表格一致）
'<input style="width:140px" value="' + escHtml(m.name) + '" id="mn_' + m.id + '" ...'
'<button ... id="ms_' + m.id + '" ...'
'<select id="mk_' + m.id + '" ...'
```

- [ ] **Step 5: 新增 `restoreAllHiddenMachines` 函数**

在 `_renderHiddenMachineTable` 下方新增，替换旧的 `toggleAllMachineVisibility`：

```javascript
function restoreAllHiddenMachines() {
    if (_hiddenMachineIds.size === 0) return;
    _hiddenMachineIds.clear();
    _saveHiddenMachines();
    _refreshMachineList();
    _refreshTimelineFromServer();
}
```

- [ ] **Step 6: 新增 `toggleHiddenMachinesSection` 函数**

```javascript
function toggleHiddenMachinesSection() {
    var body = document.querySelector('#hidden-machines-module .table-module-body');
    var header = document.querySelector('#hidden-machines-module .table-module-header');
    if (!body || !header) return;
    var collapsed = body.style.display === 'none';
    body.style.display = collapsed ? '' : 'none';
    header.className = collapsed ? 'table-module-header' : 'table-module-header collapsed';
    var arrow = header.querySelector('.collapse-arrow');
    if (arrow) arrow.textContent = collapsed ? '▴' : '▾';
}
```

- [ ] **Step 7: Commit**

---

### Task 3: `changeMachineFilter` — 移除清空隐藏的调用

**Files:**
- Modify: `static/timeline.js:111-122`

- [ ] **Step 1: 删除 `_clearHiddenMachines()` 和 `_updateVisToggleAllButton()`**

```javascript
// 旧：
function changeMachineFilter(){
    _clearHiddenMachines();
    _updateVisToggleAllButton();
    // ... 其余代码
}

// 新：
function changeMachineFilter(){
    // _clearHiddenMachines() 删除 — 筛选切换不再清空手动隐藏
    // _updateVisToggleAllButton() 删除 — 按钮已移除
    var v = document.getElementById('machine-filter').value;
    var vs = document.getElementById('machine-status-filter') ? document.getElementById('machine-status-filter').value : '';
    var vk = document.getElementById('machine-kind-filter') ? document.getElementById('machine-kind-filter').value : '';
    var url = new URL(window.location.href);
    if(v) url.searchParams.set('m_type', v); else url.searchParams.delete('m_type');
    if(vs) url.searchParams.set('m_status', vs); else url.searchParams.delete('m_status');
    if(vk) url.searchParams.set('m_kind', vk); else url.searchParams.delete('m_kind');
    try{ history.replaceState(null, '', url.toString()); }catch(e){}
    _refreshMachineList();
}
```

- [ ] **Step 2: 删除 `toggleAllMachineVisibility` 和 `_updateVisToggleAllButton` 函数**

删除 `static/timeline.js:170-189` 的两个函数（已被 `restoreAllHiddenMachines` 替代）。

- [ ] **Step 3: Commit**

---

### Task 4: `_appendMachineRow` — 眼睛图标替代 checkbox

**Files:**
- Modify: `static/machines.js:49`

- [ ] **Step 1: 替换 checkbox 为眼睛图标**

```javascript
// 旧（第49行）：
        '<td><input type=\"checkbox\" class=\"machine-visible-check\" data-mid=\"' + m.id + '\" checked onchange=\"_toggleMachineVisibility(' + m.id + ')\"></td>'+

// 新：
        '<td style=\"text-align:center\">' +
            '<span class=\"eye-toggle\" data-mid=\"' + m.id + '\" onclick=\"_toggleMachineVisibility(' + m.id + ')\" title=\"在时间轴隐藏\">&#x1F441;</span>' +
        '</td>'+
```

- [ ] **Step 2: Commit**

---

### Task 5: HTML 模板 — 移除旧按钮 + 添加隐藏表格容器

**Files:**
- Modify: `templates/panels/machines.html`

- [ ] **Step 1: 删除"全选可见"按钮（第36行）**

```html
<!-- 删除这一行： -->
                <button id="machine-vis-toggle-all" class="btn" style="margin-left:8px;font-size:12px;" onclick="toggleAllMachineVisibility()">全选可见</button>
```

- [ ] **Step 2: 在机器表格的 `</table>` 之后、`</div>`（box闭合）之前，添加隐藏表格容器**

定位到 `machines.html` 第46行 `</table>` 之后，插入：

```html
            </table>
            <!-- 已隐藏机器表格模块 -->
            <div id="hidden-machines-module" class="table-module" style="display:none;margin-top:16px;">
                <div class="table-module-header" onclick="toggleHiddenMachinesSection()" style="display:flex;align-items:center;gap:8px;padding:10px 16px;background:#f8fafc;border:1px solid var(--border);border-radius:8px 8px 0 0;cursor:pointer;user-select:none;">
                    <span style="font-size:14px;font-weight:600;">&#x1F441;&#x200D;&#x1F5E8; 已隐藏的机器</span>
                    <span id="hidden-machines-count" style="background:#e5e7eb;color:#6b7280;font-size:12px;padding:2px 8px;border-radius:10px;">0</span>
                    <span style="font-size:12px;color:#9ca3af;">— 不在时间轴上显示，但任务仍在进行</span>
                    <span class="collapse-arrow" style="margin-left:auto;font-size:12px;color:#9ca3af;">&#x25B4;</span>
                </div>
                <div class="table-module-body" style="border:1px solid var(--border);border-top:none;border-radius:0 0 8px 8px;overflow:hidden;">
                    <table>
                        <thead>
                            <tr>
                                <th style="width:40px">机型</th>
                                <th>名称</th>
                                <th>状态</th>
                                <th>任务类型</th>
                                <th style="text-align:center;width:40px">&#x1F441;</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody id="hidden-machines-tbody"></tbody>
                    </table>
                    <div style="text-align:right;padding:8px 12px;border-top:1px solid var(--border-light);">
                        <button id="hidden-restore-all-btn" onclick="restoreAllHiddenMachines()" style="font-size:12px;padding:4px 12px;">全部恢复显示</button>
                    </div>
                </div>
            </div>
```

- [ ] **Step 3: Commit**

---

### Task 6: CSS 样式 — 眼睛图标 + 暗色主题

**Files:**
- Modify: `static/style.css`（在末尾追加）

- [ ] **Step 1: 在 style.css 末尾追加样式**

```css
/* ========== EYE TOGGLE ========== */
.eye-toggle {
    cursor: pointer;
    font-size: 16px;
    opacity: 0.5;
    transition: opacity var(--transition);
    user-select: none;
}
.eye-toggle:hover {
    opacity: 1;
}
.eye-hidden {
    opacity: 0.25;
}
.eye-hidden:hover {
    opacity: 0.7;
}

/* ========== HIDDEN MACHINES MODULE ========== */
#hidden-machines-module .table-module-header:hover {
    background: #eef0f4;
}
#hidden-machines-module .table-module-header.collapsed {
    border-radius: 8px;
}

[data-theme="dark"] #hidden-machines-module .table-module-header {
    background: var(--bg-sidebar);
}
[data-theme="dark"] #hidden-machines-module .table-module-header:hover {
    background: #252830;
}
```

- [ ] **Step 2: Commit**

---

### 验证清单

1. 启动应用：`python app.py`
2. 加载页面，确认机器管理表格中"可见"列显示眼睛图标而非 checkbox
3. 点击某台机器的 👁 → 机器从主表格消失，出现在下方隐藏表格中，图标变为闭眼
4. 点击隐藏表格中的闭眼图标 → 机器回到主表格
5. 点击"全部恢复显示" → 所有隐藏机器回到主表格
6. 切换筛选条件（机型/状态/任务类型）→ 两个表格同步更新，手动隐藏保持
7. 在隐藏表格中修改机器状态/任务类型 → 正常生效
8. 删除隐藏表格中的机器 → 正常删除，同时清理 `_hiddenMachineIds`
9. 新增机器 → 默认眼睛图标睁开
10. 折叠/展开隐藏表格 → 正常工作
11. 切换暗色主题 → 样式正常
12. 无隐藏机器时刷新 → 隐藏表格不显示
