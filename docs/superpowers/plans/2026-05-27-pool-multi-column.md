# 任务池多列布局实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为"新版任务池样式"增加列数设置（range slider 1-8，默认2），下方跟随/底部固定模式使用 CSS Grid 多列，浮动窗口固定1列

**Architecture:** CSS 自定义属性 `--pool-columns` 驱动 Grid 列数。JS 在加载设置和切换模式时同步该变量。浮动模式强制 `--pool-columns: 1`。

**Tech Stack:** Vanilla JS + CSS Grid + Flask (模板)

---

### Task 1: 修改 CSS — Grid 多列布局替换 flex-wrap

**Files:**
- Modify: `static/timeline.css:312-322`

- [ ] **Step 1: 替换 pool-style-modern 样式**

将当前 `.task-pool.pool-style-modern` 的 flex-wrap 改为 block 容器，新增 `#pool-task-items` 的 Grid 规则，浮动窗口覆写。

```css
/* 新版任务池样式（开关启用） */
.task-pool.pool-style-modern {
    /* 不再使用 flex-wrap；由内部 #pool-task-items 控制布局 */
}
.task-pool.pool-style-modern:not(.pool-mode-floating) #pool-task-items {
    display: grid;
    grid-template-columns: repeat(var(--pool-columns, 1), 1fr);
    gap: 4px;
}
.task-pool.pool-style-modern.pool-mode-floating #pool-task-items {
    display: block;
}
.task-pool.pool-style-modern .task-draggable {
    display: block;
    margin: 0;
}
```

- [ ] **Step 2: 刷新浏览器确认默认 2 列效果**

---

### Task 2: 修改设置模板 — 增加 range slider

**Files:**
- Modify: `templates/panels/settings.html:123-127`

- [ ] **Step 1: 在 checkbox 下方增加 slider**

```html
<div class="box">
    <h3>任务池样式</h3>
    <p class="settings-hint">初版为简单的行内自动换行布局；新版为 CSS Grid 多列弹性布局</p>
    <label><input type="checkbox" id="s-pool-modern-style" onchange="applyScheduleSetting('pool_modern_style', this.checked?'1':'0')"> 新版任务池样式（Grid 多列布局）</label>
    <div id="pool-columns-row" style="display:none;align-items:center;gap:8px;margin-top:8px;">
        <span style="font-size:12px;color:var(--text-muted);">列数：</span>
        <input type="range" id="s-pool-modern-columns" min="1" max="8" value="2" oninput="document.getElementById('pool-cols-display').textContent=this.value; applyScheduleSetting('pool_modern_columns', this.value)" style="width:140px;">
        <span id="pool-cols-display" style="font-size:12px;font-weight:600;">2</span>
    </div>
</div>
```

---

### Task 3: 修改 settings.js — 读取并应用列数设置

**Files:**
- Modify: `static/settings.js:370-374` 和 `static/settings.js:457-459`

- [ ] **Step 1: 初始化时读取并应用 pool_modern_columns**

在 `pool_modern_style` 初始化代码块中追加列数逻辑：

```js
// pool_modern_style（schedule_settings）
var poolModern = ss['pool_modern_style'] === '1';
var poolEl = document.getElementById('task-pool');
if (poolEl) { poolEl.classList.toggle('pool-style-modern', poolModern); }
var pmsCheck = document.getElementById('s-pool-modern-style');
if (pmsCheck) pmsCheck.checked = poolModern;
// 列数
var poolColsRow = document.getElementById('pool-columns-row');
if (poolColsRow) poolColsRow.style.display = poolModern ? 'flex' : 'none';
var poolCols = parseInt(ss['pool_modern_columns'], 10) || 2;
var pmsSlider = document.getElementById('s-pool-modern-columns');
if (pmsSlider) pmsSlider.value = poolCols;
var pmsDisplay = document.getElementById('pool-cols-display');
if (pmsDisplay) pmsDisplay.textContent = poolCols;
if (poolEl) poolEl.style.setProperty('--pool-columns', poolCols);
```

- [ ] **Step 2: applyScheduleSetting 中追加 pool_modern_columns 处理**

```js
if (key === 'pool_modern_style') {
    var poolEl = document.getElementById('task-pool');
    if (poolEl) poolEl.classList.toggle('pool-style-modern', value === '1');
    var row = document.getElementById('pool-columns-row');
    if (row) row.style.display = (value === '1') ? 'flex' : 'none';
}
if (key === 'pool_modern_columns') {
    var poolEl = document.getElementById('task-pool');
    if (poolEl) poolEl.style.setProperty('--pool-columns', value);
}
```

---

### Task 4: 修改 core.js — 浮动模式强制 1 列

**Files:**
- Modify: `static/core.js:323-324`

- [ ] **Step 1: _applyTaskPoolMode 中浮动模式强制 1 列，非浮动恢复用户设置**

```js
if (_taskPoolMode === 'floating') {
    pool.style.setProperty('--pool-columns', '1');
    // ... 其余浮动模式逻辑不变
} else {
    // 非浮动恢复用户设置的列数
    try {
        var ss = JSON.parse(localStorage.getItem('schedule_settings') || '{}');
        var cols = parseInt(ss['pool_modern_columns'], 10) || 2;
        pool.style.setProperty('--pool-columns', cols);
    } catch(e) {
        pool.style.setProperty('--pool-columns', '2');
    }
    // ... 其余非浮动模式逻辑不变
}
```

---

### 验证步骤

- [ ] 打开设置 → 排班子设置 → 勾选"新版任务池样式"，列数 slider 出现，默认 2
- [ ] 拖动 slider 到 3/4/5，观察下方跟随模式实时变化
- [ ] 切到底部固定模式，确认分页仍正常工作
- [ ] 切到浮动窗口模式，确认始终 1 列
- [ ] 关闭新版样式，slider 隐藏
- [ ] 刷新页面，列数设置保持
