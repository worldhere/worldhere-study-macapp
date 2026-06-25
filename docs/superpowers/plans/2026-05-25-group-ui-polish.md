# 分组功能 UI 优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复分组功能的 4 个 UI 问题：折叠模块样式、分组下拉高亮色、双击内联编辑、分组变更后自动刷新下拉框。

**Architecture:** 4 个独立修复，互不依赖，可并行执行。涉及 CSS 样式覆盖、JS 交互替换、DOM 同步逻辑。

**Tech Stack:** vanilla JS + CSS

---

## File Structure

| 文件 | 职责 |
|------|------|
| `static/style.css` | 折叠模块样式修复；移除 highlight-select 黄色；内联编辑输入框样式 |
| `static/machines.js` | 内联编辑替换 prompt()；_refreshGroupSelects 同步所有下拉框 |
| `templates/panels/machines.html` | 移除 highlight-select class |

---

### Task 1: 修复折叠模块样式

**Files:**
- Modify: `static/style.css:2462-2474`

**问题：** `.collapsible-box` 叠加了 `.box` 的 border/padding，造成双边框；header 背景无圆角，标题与其他行内元素错位。

- [ ] **Step 1: 替换折叠模块 CSS**

将 `static/style.css` 中的折叠模块 CSS 块（约 2462-2474 行）替换为：

```css
/* ========== 折叠模块 ========== */
.collapsible-box { overflow: hidden; }
.collapsible-box.box { padding: 0; }
.collapsible-header {
    display: flex; align-items: center; gap: 8px;
    padding: 12px 20px; background: var(--bg-body); cursor: pointer;
    user-select: none; border-bottom: 1px solid var(--border);
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
}
.collapsible-header h3 { font-size: 14px; margin: 0; flex-shrink: 0; }
.collapsible-body { padding: 16px 20px; }
.collapsible-box.collapsed .collapsible-body { display: none; }
.collapsible-box.collapsed .collapsible-header {
    border-bottom: none;
    border-radius: var(--radius-sm);
}
.collapse-arrow {
    display: inline-block; transition: transform var(--transition); font-size: 12px;
    flex-shrink: 0; width: 14px; text-align: center;
}
.collapsible-box.collapsed .collapse-arrow { transform: rotate(-90deg); }
```

关键变化：
- `.collapsible-box.box { padding: 0; }` — 覆盖 `.box` 的 padding，让 header/body 各自控制间距
- `.collapsible-header` 加上 `border-radius: var(--radius-sm) var(--radius-sm) 0 0`（展开时顶部圆角）
- `.collapsible-box.collapsed .collapsible-header` 加上 `border-radius: var(--radius-sm)`（折叠时四角圆角）
- `.collapse-arrow` 加上固定宽度 `width: 14px` 防止旋转时挤动标题
- 移除 `.collapsible-box` 上的 `border` — 由外层 `.box` 统一提供

- [ ] **Step 2: 重启验证**

```powershell
python app.py
```

打开浏览器，检查机器管理页面的折叠模块：展开/折叠时圆角正确，标题对齐，无双边框。

- [ ] **Step 3: Commit**

```bash
git add static/style.css
git commit -m "fix: collapsible box double-border and border-radius styling"
```

---

### Task 2: 移除分组下拉框黄色高亮

**Files:**
- Modify: `templates/panels/machines.html:15`
- Modify: `templates/panels/machines.html:67`
- Modify: `static/style.css:2481-2485` (删除 highlight-select 样式块)

**问题：** `m_group` 和 `machine-group-filter` 两个 select 有 `highlight-select` class，显示黄色背景边框。

- [ ] **Step 1: 移除 machines.html 中的 highlight-select class**

第 15 行，`m_group` select：
```html
<!-- 改前 -->
分组：<select id="m_group" class="highlight-select">
<!-- 改后 -->
分组：<select id="m_group">
```

第 67 行，`machine-group-filter` select：
```html
<!-- 改前 -->
<select id="machine-group-filter" onchange="changeMachineFilter()" class="highlight-select">
<!-- 改后 -->
<select id="machine-group-filter" onchange="changeMachineFilter()">
```

- [ ] **Step 2: 删除 highlight-select CSS 规则**

删除 `static/style.css` 第 2481-2485 行：
```css
/* 删除这整个块 */
select.highlight-select {
    border-color: var(--warning) !important;
    background: var(--warning-light) !important;
}
```

同时检查 `templates/dialogs/all.html` 中批量弹窗的 `bm_group` 和 `bp_group` 是否也有 `highlight-select`：

```powershell
grep -n "highlight-select" "templates/dialogs/all.html"
```

如有，一并移除。

- [ ] **Step 3: Commit**

```bash
git add templates/panels/machines.html static/style.css
git commit -m "fix: remove yellow highlight from group select dropdowns"
```

---

### Task 3: 双击分组标签改为内联编辑

**Files:**
- Modify: `static/machines.js:521-542` (`editGroupName` 函数)
- Modify: `static/style.css` (追加内联编辑输入框样式)

**问题：** `editGroupName()` 使用浏览器 `prompt()` 弹窗，交互体验差。

- [ ] **Step 1: 替换 editGroupName 为内联编辑**

在 `static/machines.js` 中，将 `editGroupName` 函数（约 521-542 行）替换为：

```javascript
function editGroupName(tagEl) {
    // 防止重复进入编辑态
    if (tagEl.querySelector('input')) return;
    var oldName = tagEl.dataset.groupName;
    var originalHTML = tagEl.innerHTML;

    // 用 input 替换标签内容
    var input = document.createElement('input');
    input.type = 'text';
    input.value = oldName;
    input.className = 'group-tag-edit-input';
    input.style.cssText = 'width:80px;padding:2px 6px;font-size:12px;border:1px solid var(--primary);border-radius:3px;outline:none;background:var(--bg-card);color:var(--text-primary);';
    tagEl.innerHTML = '';
    tagEl.appendChild(input);
    tagEl.style.cursor = 'text';
    input.focus();
    input.select();

    function finishEdit(save) {
        var newName = input.value.trim();
        if (!save || !newName || newName === oldName) {
            // 取消：恢复原始内容
            tagEl.innerHTML = originalHTML;
            tagEl.style.cursor = 'grab';
            // 重新绑定删除按钮事件
            var xSpan = tagEl.querySelector('span');
            if (xSpan) xSpan.onclick = function(e) { e.stopPropagation(); deleteMachineGroup(xSpan); };
            return;
        }
        fetch('/update_machine_group', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({old_name: oldName, new_name: newName})
        }).then(function(r) { return r.json(); }).then(function(d) {
            showToast(d.msg);
            if (d.msg.indexOf('成功') >= 0 || d.msg.indexOf('已更新') >= 0) {
                tagEl.dataset.groupName = newName;
                tagEl.innerHTML = '⋮⋮ ' + escHtml(newName) + ' <span style="cursor:pointer;margin-left:2px;">✕</span>';
                tagEl.style.cursor = 'grab';
                var xSpan = tagEl.querySelector('span');
                if (xSpan) xSpan.onclick = function(e) { e.stopPropagation(); deleteMachineGroup(xSpan); };
                _refreshGroupSelects();
            } else {
                // 保存失败，恢复
                tagEl.innerHTML = originalHTML;
                tagEl.style.cursor = 'grab';
                var xSpan = tagEl.querySelector('span');
                if (xSpan) xSpan.onclick = function(e) { e.stopPropagation(); deleteMachineGroup(xSpan); };
            }
        });
    }

    input.addEventListener('blur', function() { finishEdit(true); });
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { e.preventDefault(); finishEdit(false); }
    });
}
```

- [ ] **Step 2: 追加内联编辑输入框样式**

在 `static/style.css` 末尾追加：

```css
/* 分组标签内联编辑 */
.group-tag-edit-input:focus { box-shadow: 0 0 0 2px rgba(59,130,246,0.2); }
```

- [ ] **Step 3: Commit**

```bash
git add static/machines.js static/style.css
git commit -m "feat: replace browser prompt with inline editing for group rename"
```

---

### Task 4: 分组变更后自动刷新所有下拉框

**Files:**
- Modify: `static/machines.js:606-611` (`_refreshGroupSelects` 函数)

**问题：** `_refreshGroupSelects` 只更新 APP_CONFIG 和机器表格，不更新页面上的分组下拉框（`m_group`、`machine-group-filter`、`bm_group`、`bp_group`），导致下拉框选项与实际分组不同步。

- [ ] **Step 1: 增强 _refreshGroupSelects 同步所有下拉框**

将 `static/machines.js` 中的 `_refreshGroupSelects` 函数（约 606-611 行）替换为：

```javascript
function _refreshGroupSelects() {
    fetch('/api/machine_groups').then(function(r) { return r.json(); }).then(function(d) {
        if (typeof APP_CONFIG !== 'undefined') APP_CONFIG.machine_groups = d.groups;

        var groups = d.groups;
        var groupOpts = '<option value="">未分组</option>';
        for (var i = 0; i < groups.length; i++) {
            groupOpts += '<option>' + escHtml(groups[i].key) + '</option>';
        }
        var filterOpts = '<option value="">全部</option>';
        for (var i = 0; i < groups.length; i++) {
            filterOpts += '<option>' + escHtml(groups[i].key) + '</option>';
        }
        filterOpts += '<option value="未分组">未分组</option>';

        // 更新 m_group（新增机器区）
        var mGroup = document.getElementById('m_group');
        if (mGroup) { var sv = mGroup.value; mGroup.innerHTML = groupOpts; if (sv) mGroup.value = sv; }

        // 更新 machine-group-filter（筛选栏）
        var filterSel = document.getElementById('machine-group-filter');
        if (filterSel) { var fv = filterSel.value; filterSel.innerHTML = filterOpts; if (fv) filterSel.value = fv; }

        // 更新 bm_group（批量弹窗-范围标签页）
        var bmGroup = document.getElementById('bm_group');
        if (bmGroup) { var bv = bmGroup.value; bmGroup.innerHTML = groupOpts; if (bv) bmGroup.value = bv; }

        // 更新 bp_group（批量弹窗-粘贴标签页）
        var bpGroup = document.getElementById('bp_group');
        if (bpGroup) { var pv = bpGroup.value; bpGroup.innerHTML = groupOpts; if (pv) bpGroup.value = pv; }

        // 更新所有机器行中的分组下拉框
        var mgSelects = document.querySelectorAll('select[id^="mg_"]');
        mgSelects.forEach(function(sel) {
            var curVal = sel.value;
            var isNewGroup = (curVal === '__new_group__');
            sel.innerHTML = _groupOptions(isNewGroup ? '__new_group__' : curVal);
            if (!isNewGroup) sel.value = curVal;
        });

        _refreshMachineList();
    });
}
```

关键变化：
- 构建 `groupOpts` 和 `filterOpts` 两份选项 HTML
- 分别更新 4 个固定位置的 select（`m_group`、`machine-group-filter`、`bm_group`、`bp_group`）
- 保留各 select 当前选中值
- 遍历所有 `mg_*` 元素（机器行中的分组下拉），用 `_groupOptions` 重建选项
- 最后调用 `_refreshMachineList()` 刷新表格

- [ ] **Step 2: Commit**

```bash
git add static/machines.js
git commit -m "fix: auto-refresh all group dropdowns after group CRUD operations"
```

---

## Self-Review

1. **Spec coverage:** 4 个问题各对应一个任务，全部覆盖。
2. **Placeholder scan:** 无 TBD/TODO/占位符。
3. **Type consistency:** `_groupOptions` 在 core.js 中定义，在 machines.js 中引用 — 确认已存在且签名一致。`_refreshGroupSelects` 被 `addMachineGroup`、`editGroupName`、`deleteMachineGroup`、`saveMachineName` 调用，替换后签名不变。
