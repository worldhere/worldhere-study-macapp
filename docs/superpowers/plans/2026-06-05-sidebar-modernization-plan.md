# 侧边栏现代化 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将侧边栏从老旧两态升级为现代化三态（顶部模式 / 侧边栏展开 240px / 侧边栏折叠 56px），加入毛玻璃风格、实时时钟、工具栏卡片、设置手风琴子导航和水滴展开动画。

**Architecture:** 保留 `sidebar-mode` body class 控制模式切换，新增 `sidebar-collapsed` class 控制折叠态。侧边栏/顶部栏显隐从 `display:none` 改为 `clip-path` + `opacity` + `pointer-events` 以支持动画。

**Tech Stack:** Vanilla HTML/CSS/JS，Flask Jinja2 模板，localStorage 持久化。

**Files:**
- Modify: `static/theme.css` — 新增 CSS 变量
- Modify: `templates/index.html` — 侧边栏 HTML 重构
- Modify: `static/layout.css` — 重写 sidebar 样式、动画关键帧
- Modify: `static/core.js` — 新增函数、修复 rebuildNavUI、重写 toggleLayoutMode
- Modify: `static/timeline.js` — 修复 switchTab class 覆写
- Modify: `static/settings.js` — 同步侧边栏子导航
- Modify: `static/app.js` — 恢复折叠状态

---

### Task 1: 新增 CSS 过渡变量

**Files:**
- Modify: `static/theme.css:68-74`

在 `:root` 的 `--transition` 后追加四个粒度更细的过渡变量：

- [ ] **Step 1: 在 theme.css 的 `:root` 块末尾追加变量**

定位到 `--transition: 150ms cubic-bezier(0.4, 0, 0.2, 1);` 后面，在 `}` 前追加：

```css
    --transition-fast:   150ms ease;
    --transition-normal: 200ms ease;
    --transition-slow:   250ms cubic-bezier(0.4, 0, 0.2, 1);
    --transition-layout: 300ms ease;
    --sidebar-w: 240px;
    --sidebar-collapsed-w: 56px;
```

注意：`--sidebar-w` 从原来的 `220px` 改为 `240px`，需要修改同文件中已有的定义（`:root` 第 7 行 `--sidebar-w: 220px;` → `--sidebar-w: 240px;`），暗色主题中的 `--sidebar-w: 220px;` 不需要重复（暗色 `[data-theme="dark"]` 只在需要覆盖时才设）。

- [ ] **Step 2: 修改 layout.css 中所有引用 `var(--sidebar-w)` 的地方**

搜索 `var(--sidebar-w)` 确保宽度从 220px 迁移到 240px — CSS 变量改过一次即可全局生效。

- [ ] **Step 3: Commit**

```bash
git add static/theme.css
git commit -m "feat: add CSS transition variables and sidebar width 240px

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: 重构侧边栏 HTML

**Files:**
- Modify: `templates/index.html:15-47`

完全替换现有的 `<aside class="sidebar">` 内容。

- [ ] **Step 1: 替换侧边栏 HTML**

将 `index.html` 第 15-47 行（`<!-- ========== 侧边栏导航 (V1) ========== -->` 到 `</aside>` 之间）替换为：

```html
<!-- ========== 侧边栏导航 ========== -->
<aside class="sidebar">
    <!-- 品牌区 -->
    <div class="sidebar-brand">
        <div class="sidebar-brand-icon">&#128197;</div>
        <div class="sidebar-brand-text">
            <div class="sidebar-brand-title">排班系统</div>
            <div class="sidebar-brand-sub">Task Scheduler</div>
        </div>
    </div>

    <!-- 时钟 -->
    <div class="sidebar-clock" id="sidebar-clock-card">
        <div class="sidebar-clock-label">当前时间</div>
        <div class="sidebar-clock-time" id="sidebar-clock-time">00:00:00</div>
    </div>

    <!-- 排班日期 -->
    <div class="sidebar-toolbar-card" id="sidebar-date-card">
        <div class="sidebar-card-label">排班日期</div>
        <input id="sidebar-schedule-date" type="date" value="{{selected_date}}" onchange="syncSidebarDate()">
    </div>

    <!-- 一键快速操作 -->
    <div class="sidebar-toolbar-card" id="sidebar-quickops-card">
        <button class="sidebar-btn sidebar-btn-danger" onclick="openQuickOpsDialog()">&#9889; 一键快速操作</button>
    </div>

    <!-- 导出 Excel -->
    <div class="sidebar-toolbar-card" id="sidebar-export-card">
        <div class="sidebar-card-label">导出 Excel</div>
        <div class="sidebar-export-row"><span>从</span><input id="sidebar-export-from" type="date" placeholder="不选=全部"></div>
        <div class="sidebar-export-row"><span>到</span><input id="sidebar-export-to" type="date" placeholder="不选=全部"></div>
        <button class="sidebar-btn sidebar-btn-export" onclick="sidebarExport()">&#128230; 导出 Excel</button>
    </div>

    <!-- 主菜单导航 -->
    <nav class="sidebar-nav">
        <div class="nav-label">主菜单</div>
        <!-- 由 rebuildNavUI() 动态填充 -->
    </nav>

    <!-- 设置子导航（手风琴，由 renderSettingsSubNav() 动态填充） -->
    <div class="sidebar-settings-subnav" id="sidebar-settings-subnav" style="display:none;"></div>

    <!-- 底部操作区 -->
    <div class="sidebar-footer">
        <div class="sidebar-footer-db" title="{{db_path}}">{{db_path}}</div>
        <div class="sidebar-footer-actions">
            <button id="theme-toggle-sidebar" onclick="toggleTheme()" title="切换主题">&#9789;</button>
            <button id="sidebar-collapse-btn" onclick="toggleSidebarCollapse()" title="折叠侧边栏">&#9664;</button>
            <button onclick="toggleLayoutMode()" title="切换到顶部导航模式">&#8646;</button>
        </div>
    </div>
</aside>
```

- [ ] **Step 2: 添加隐藏的折叠态时钟元素**

在 `</aside>` 之后、顶部导航之前，添加折叠态专用元素（仅在折叠时可见）：

```html
<!-- 侧边栏折叠态图标 + 竖排时钟（通过 CSS 控制可见性） -->
<div class="sidebar-collapsed-icons" id="sidebar-collapsed-icons" style="display:none;">
    <div class="sci-brand">&#128197;</div>
    <div class="sci-clock" id="sci-clock">00:00</div>
    <div class="sci-divider"></div>
    <div class="sci-nav" id="sci-nav"><!-- 由 rebuildNavUI 填充 --></div>
    <div class="sci-divider"></div>
    <button id="theme-toggle-sidebar-collapsed" onclick="toggleTheme()" title="切换主题">&#9789;</button>
    <button onclick="toggleSidebarCollapse()" title="展开侧边栏">&#9654;</button>
    <button onclick="toggleLayoutMode()" title="切换到顶部导航模式">&#8646;</button>
</div>
```

- [ ] **Step 3: Commit**

```bash
git add templates/index.html
git commit -m "feat: restructure sidebar HTML with clock, toolbar, settings subnav, collapse

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: 重写侧边栏 CSS

**Files:**
- Modify: `static/layout.css:166-306`（整个 sidebar 和 layout modes 区域）

- [ ] **Step 1: 完全替换 sidebar CSS 区域**

删除 `layout.css` 第 166-306 行（从 `/* ========== SIDEBAR (V1 legacy...` 到 `.toast-container` 那行），替换为以下新 CSS：

```css
/* ========== SIDEBAR ========== */
.sidebar {
    position: fixed;
    top: 0; left: 0; bottom: 0;
    width: var(--sidebar-w);
    background: linear-gradient(180deg, rgba(15,23,42,0.94) 0%, rgba(15,23,42,0.88) 100%);
    backdrop-filter: blur(24px) saturate(120%);
    -webkit-backdrop-filter: blur(24px) saturate(120%);
    color: #b0bec5;
    z-index: 600;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    overflow-x: hidden;
    box-shadow: 4px 0 32px rgba(0,0,0,0.3);
    border-right: 1px solid rgba(255,255,255,0.06);
    clip-path: inset(0 0 0 0);
    opacity: 1;
    transition: width var(--transition-slow), clip-path var(--transition-layout), opacity var(--transition-layout);
}

/* ========== SIDEBAR BRAND ========== */
.sidebar-brand {
    padding: 18px 18px 14px;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
    border-bottom: 1px solid rgba(255,255,255,0.06);
}
.sidebar-brand-icon {
    width: 36px; height: 36px;
    background: linear-gradient(135deg, var(--primary), #8b5cf6);
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    flex-shrink: 0;
}
.sidebar-brand-title {
    font-size: 15px; font-weight: 700; color: #f1f5f9;
    line-height: 1.2;
}
.sidebar-brand-sub {
    font-size: 9px; color: #64748b;
}

/* ========== SIDEBAR CLOCK ========== */
.sidebar-clock {
    margin: 6px 14px;
    padding: 10px 14px;
    background: rgba(255,255,255,0.03);
    border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.05);
    flex-shrink: 0;
}
.sidebar-clock-label {
    font-size: 9px; color: #64748b;
    text-transform: uppercase; letter-spacing: 1px;
    margin-bottom: 2px;
}
.sidebar-clock-time {
    font-size: 24px; font-weight: 700;
    color: #93c5fd;
    font-family: 'SF Mono', Consolas, 'Courier New', monospace;
    font-variant-numeric: tabular-nums;
}

/* ========== SIDEBAR TOOLBAR CARDS ========== */
.sidebar-toolbar-card {
    margin: 4px 14px;
    padding: 10px 14px;
    background: rgba(255,255,255,0.02);
    border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.04);
    flex-shrink: 0;
    transition: opacity var(--transition-slow), max-height var(--transition-slow);
}
.sidebar-card-label {
    font-size: 9px; color: #64748b;
    text-transform: uppercase; letter-spacing: 1px;
    margin-bottom: 6px;
}
.sidebar-toolbar-card input[type="date"] {
    width: 100%;
    padding: 5px 8px;
    border-radius: 6px;
    border: 1px solid rgba(255,255,255,0.1);
    background: rgba(255,255,255,0.04);
    color: #e2e8f0;
    font-size: 11px;
    box-sizing: border-box;
}
.sidebar-toolbar-card input[type="date"]:focus {
    outline: none;
    border-color: var(--primary);
}
.sidebar-export-row {
    display: flex; align-items: center; gap: 4px;
    margin-bottom: 4px;
}
.sidebar-export-row span {
    font-size: 10px; color: #64748b;
    flex-shrink: 0; width: 20px;
}
.sidebar-export-row input[type="date"] {
    flex: 1; min-width: 0;
    padding: 5px 6px;
    font-size: 10px;
}
.sidebar-btn {
    width: 100%;
    padding: 8px;
    border-radius: 8px;
    border: none;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    text-align: center;
    transition: all var(--transition-fast);
}
.sidebar-btn:hover { filter: brightness(1.1); }
.sidebar-btn-danger {
    background: rgba(239,68,68,0.12);
    color: #fca5a5;
    border: 1px solid rgba(239,68,68,0.2);
}
.sidebar-btn-export {
    background: rgba(245,158,11,0.12);
    color: #fcd34d;
    margin-top: 6px;
}

/* ========== SIDEBAR NAV ========== */
.sidebar-nav {
    flex: 1;
    padding: 6px 0;
    overflow-y: auto;
    min-height: 0;
}
.sidebar-nav .nav-label {
    padding: 6px 18px 6px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    color: #475569;
}
.nav-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    margin: 2px 10px;
    border: none;
    background: transparent;
    color: #94a3b8;
    font-size: 13.5px;
    cursor: pointer;
    border-radius: 8px;
    text-align: left;
    font-family: inherit;
    width: calc(100% - 20px);
    transition: background var(--transition-fast), color var(--transition-fast);
}
.nav-item:hover {
    background: rgba(255,255,255,0.04);
    color: #cbd5e1;
}
.nav-item.active {
    background: rgba(59,130,246,0.15);
    color: #bfdbfe;
    font-weight: 600;
}
.nav-item .nav-icon {
    font-size: 16px;
    width: 22px;
    text-align: center;
    flex-shrink: 0;
}

/* ========== SETTINGS SUB-NAV IN SIDEBAR ========== */
.sidebar-settings-subnav {
    padding: 2px 10px 6px;
    border-left: 2px solid rgba(59,130,246,0.3);
    margin: 0 10px 0 22px;
    overflow: hidden;
    max-height: 0;
    transition: max-height var(--transition-normal);
}
.sidebar-settings-subnav.expanded {
    max-height: 400px;
}
.settings-sub-item {
    display: block;
    width: 100%;
    padding: 6px 12px 6px 12px;
    border: none;
    background: transparent;
    color: #64748b;
    font-size: 12px;
    cursor: pointer;
    border-radius: 6px;
    margin: 1px 6px;
    text-align: left;
    font-family: inherit;
    transition: background var(--transition-fast), color var(--transition-fast);
}
.settings-sub-item:hover {
    background: rgba(255,255,255,0.03);
    color: #94a3b8;
}
.settings-sub-item.active {
    background: rgba(59,130,246,0.08);
    color: #94a3b8;
    font-weight: 500;
}

/* ========== SIDEBAR FOOTER ========== */
.sidebar-footer {
    padding: 10px 14px;
    border-top: 1px solid rgba(255,255,255,0.06);
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
    gap: 6px;
}
.sidebar-footer-db {
    font-size: 10px;
    color: #475569;
    max-width: 100px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.sidebar-footer-actions {
    display: flex;
    gap: 4px;
}
.sidebar-footer-actions button {
    width: 30px; height: 30px;
    border: none;
    background: rgba(255,255,255,0.04);
    color: #64748b;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all var(--transition-fast);
}
.sidebar-footer-actions button:hover {
    background: rgba(255,255,255,0.1);
    color: #b0bec5;
}

/* ========== LAYOUT MODES ========== */
/* Default: top-navigation mode, sidebar hidden */
.sidebar {
    clip-path: inset(0 100% 0 0);
    opacity: 0;
    pointer-events: none;
}
.app-header {
    transform: translateY(0);
    opacity: 1;
    transition: transform var(--transition-layout), opacity var(--transition-layout);
}
.app-toolbar {
    transform: translateY(0);
    opacity: 1;
    transition: transform var(--transition-layout), opacity var(--transition-layout);
}
.tab {
    transform: translateY(0);
    opacity: 1;
    transition: transform var(--transition-layout), opacity var(--transition-layout);
}
.app-content { margin-left: 0; transition: margin-left var(--transition-layout); }

/* Sidebar mode: sidebar shown, top elements slide up */
body.sidebar-mode .sidebar {
    clip-path: inset(0 0 0 0);
    opacity: 1;
    pointer-events: auto;
}
body.sidebar-mode .app-header {
    transform: translateY(-100%);
    opacity: 0;
    pointer-events: none;
}
body.sidebar-mode .app-toolbar {
    transform: translateY(-100%);
    opacity: 0;
    pointer-events: none;
}
body.sidebar-mode .tab {
    transform: translateY(-100%);
    opacity: 0;
    pointer-events: none;
}
body.sidebar-mode .app-content { margin-left: var(--sidebar-w); }
body.sidebar-mode .toast-container { top: 20px; }

/* Sidebar collapsed state */
body.sidebar-mode.sidebar-collapsed .sidebar {
    width: var(--sidebar-collapsed-w);
}
body.sidebar-mode.sidebar-collapsed .sidebar-brand-sub,
body.sidebar-mode.sidebar-collapsed .sidebar-brand-title,
body.sidebar-mode.sidebar-collapsed .sidebar-clock,
body.sidebar-mode.sidebar-collapsed .sidebar-toolbar-card,
body.sidebar-mode.sidebar-collapsed .sidebar-nav .nav-label,
body.sidebar-mode.sidebar-collapsed .nav-item,
body.sidebar-mode.sidebar-collapsed .nav-item .nav-icon,
body.sidebar-mode.sidebar-collapsed .sidebar-settings-subnav,
body.sidebar-mode.sidebar-collapsed .sidebar-footer-db {
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transition: opacity var(--transition-slow), visibility var(--transition-slow);
}
body.sidebar-mode.sidebar-collapsed .sidebar-brand-icon {
    margin: 0 auto;
}
body.sidebar-mode.sidebar-collapsed .sidebar-brand {
    justify-content: center;
    padding: 14px 8px;
}
body.sidebar-mode.sidebar-collapsed .sidebar-footer {
    justify-content: center;
}
body.sidebar-mode.sidebar-collapsed .sidebar-footer-actions {
    flex-direction: column;
    gap: 4px;
}
body.sidebar-mode.sidebar-collapsed .app-content { margin-left: var(--sidebar-collapsed-w); }

/* Collapsed clock (vertical) */
.sidebar-collapsed-clock {
    display: none;
}
body.sidebar-mode.sidebar-collapsed .sidebar-collapsed-clock {
    display: block;
    text-align: center;
    font-size: 10px;
    font-weight: 700;
    color: #93c5fd;
    font-family: 'SF Mono', Consolas, monospace;
    writing-mode: vertical-lr;
    padding: 6px 0;
    flex-shrink: 0;
}

/* ========== TABS ========== */
.tab {
    background: var(--bg-card);
    border-bottom: 1px solid var(--border);
    display: flex;
    padding: 0 24px;
    gap: 2px;
    box-shadow: var(--shadow-xs);
    overflow-x: auto;
}
.tab button {
    padding: 14px 22px;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    border-bottom: 3px solid transparent;
    transition: all var(--transition);
    white-space: nowrap;
    border-radius: 0;
    margin-right: 0;
}
.tab button:hover {
    color: var(--primary);
    background: var(--primary-light);
}
.tab button.active {
    color: var(--primary);
    font-weight: 600;
    border-bottom-color: var(--primary);
}
```

- [ ] **Step 2: 保留现有的 header / toolbar / content / panel / responsive / print 样式不变**

确认 `layout.css` 中 Headers（第 1-60 行）、Toolbar（第 62-109 行）、Main Content（第 308-316 行）、Panels（第 318-329 行）、Responsive（第 331-347 行）、Print（第 349-366 行）部分保持不变。

- [ ] **Step 3: 亮色主题侧边栏覆盖（追加到 layout.css 末尾或 theme.css）**

在 `layout.css` 末尾追加亮色主题下侧边栏的样式覆盖：

```css
/* ========== SIDEBAR LIGHT THEME OVERRIDES ========== */
[data-theme="light"] .sidebar {
    background: linear-gradient(180deg, rgba(248,250,252,0.94) 0%, rgba(241,245,249,0.88) 100%);
    border-right: 1px solid rgba(0,0,0,0.06);
    box-shadow: 2px 0 24px rgba(0,0,0,0.04);
}
[data-theme="light"] .sidebar-brand-title { color: #0f172a; }
[data-theme="light"] .sidebar-brand-sub { color: #94a3b8; }
[data-theme="light"] .sidebar-clock { background: rgba(0,0,0,0.02); border-color: rgba(0,0,0,0.04); }
[data-theme="light"] .sidebar-clock-label { color: #94a3b8; }
[data-theme="light"] .sidebar-clock-time { color: #2563eb; }
[data-theme="light"] .sidebar-toolbar-card { background: rgba(0,0,0,0.02); border-color: rgba(0,0,0,0.04); }
[data-theme="light"] .sidebar-toolbar-card .sidebar-card-label { color: #94a3b8; }
[data-theme="light"] .sidebar-toolbar-card input[type="date"] {
    background: #fff;
    color: #334155;
    border-color: rgba(0,0,0,0.1);
}
[data-theme="light"] .sidebar-btn-danger { color: #dc2626; background: rgba(239,68,68,0.06); border-color: rgba(239,68,68,0.12); }
[data-theme="light"] .sidebar-btn-export { color: #d97706; background: rgba(245,158,11,0.06); }
[data-theme="light"] .nav-item { color: #64748b; }
[data-theme="light"] .nav-item:hover { background: rgba(0,0,0,0.04); color: #334155; }
[data-theme="light"] .nav-item.active { background: rgba(59,130,246,0.08); color: #2563eb; }
[data-theme="light"] .sidebar-nav .nav-label { color: #94a3b8; }
[data-theme="light"] .sidebar-settings-subnav { border-left-color: rgba(59,130,246,0.2); }
[data-theme="light"] .settings-sub-item { color: #94a3b8; }
[data-theme="light"] .settings-sub-item:hover { background: rgba(0,0,0,0.03); color: #64748b; }
[data-theme="light"] .settings-sub-item.active { background: rgba(59,130,246,0.06); color: #2563eb; }
[data-theme="light"] .sidebar-footer-db { color: #94a3b8; }
[data-theme="light"] .sidebar-footer-actions button { background: rgba(0,0,0,0.04); color: #94a3b8; }
[data-theme="light"] .sidebar-footer-actions button:hover { background: rgba(0,0,0,0.08); color: #64748b; }
[data-theme="light"] .sidebar-collapsed-clock { color: #2563eb; }
```

- [ ] **Step 4: Commit**

```bash
git add static/layout.css
git commit -m "feat: rewrite sidebar CSS with glassmorphism, clock, toolbar, sub-nav, light theme

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: 添加水滴动画关键帧

**Files:**
- Modify: `static/layout.css`（在 sidebar 区域末尾追加）

- [ ] **Step 1: 追加动画关键帧**

在 `layout.css` sidebar 相关样式区域后追加：

```css
/* ========== SIDEBAR ANIMATION KEYFRAMES ========== */
/* Water-drop drip-in from brand icon */
@keyframes sidebarDripIn {
    0%   { clip-path: circle(0 at 38px 36px); opacity: 0; }
    60%  { clip-path: circle(380px at 38px 36px); opacity: 0.9; }
    100% { clip-path: inset(0 0 0 0); opacity: 1; }
}
@keyframes sidebarDripOut {
    0%   { clip-path: inset(0 0 0 0); opacity: 1; }
    40%  { clip-path: circle(380px at 38px 36px); opacity: 0.9; }
    100% { clip-path: circle(0 at 38px 36px); opacity: 0; }
}

/* Top bar slide-up / slide-down */
@keyframes headerSlideUp {
    from { transform: translateY(0); opacity: 1; }
    to   { transform: translateY(-100%); opacity: 0; }
}
@keyframes headerSlideDown {
    from { transform: translateY(-100%); opacity: 0; }
    to   { transform: translateY(0); opacity: 1; }
}
```

- [ ] **Step 2: Commit**

```bash
git add static/layout.css
git commit -m "feat: add water-drop drip and header slide animation keyframes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: 核心 JS — 新增函数与修复

**Files:**
- Modify: `static/core.js`（多处修改）

这是改动最大的文件。需要新增 4 个函数，重写 1 个函数，修复 1 个函数。

- [ ] **Step 1: 修复 `rebuildNavUI()` — 不再 touch 设置子导航容器**

将 `core.js` 第 13-22 行的侧边栏部分改为：

```javascript
    // 侧边栏
    var sidebarNav = document.querySelector('.sidebar-nav');
    if (sidebarNav) {
        var html = '<div class="nav-label">主菜单</div>';
        for (var i = 0; i < navOrder.length; i++) {
            var name = navOrder[i].key;
            var idx = NAV_TAB_MAP[name];
            if (idx === undefined) continue;
            html += '<button class="nav-item" onclick="switchTab(' + idx + ')"><span class="nav-icon">' + NAV_ICONS[idx] + '</span> ' + name + '</button>';
        }
        sidebarNav.innerHTML = html;
        // 如果当前在设置页，渲染子导航
        if (_getActiveTab() === 5) {
            renderSettingsSubNav();
        }
    }
```

- [ ] **Step 2: 新增 `renderSettingsSubNav()`**

在 `rebuildNavUI()` 函数之后（约第 37 行后）追加：

```javascript
// 在侧边栏中渲染设置子导航（手风琴）
function renderSettingsSubNav() {
    var container = document.getElementById('sidebar-settings-subnav');
    if (!container) return;
    // 只在侧边栏模式且设置 tab 激活时显示
    var isSidebar = document.body.classList.contains('sidebar-mode');
    if (!isSidebar || _getActiveTab() !== 5) {
        container.style.display = 'none';
        container.classList.remove('expanded');
        return;
    }
    container.style.display = '';
    var subTabs = ['班次设置', '机器管理设置', '任务库设置', '排班面板设置', '历史记录设置', '系统设置', '数据管理', '飞书同步'];
    var activeSub = parseInt(localStorage.getItem('activeSettingsSub') || '0');
    var html = '';
    for (var i = 0; i < subTabs.length; i++) {
        var cls = (i === activeSub) ? 'settings-sub-item active' : 'settings-sub-item';
        html += '<button class="' + cls + '" onclick="switchSettingsSub(' + i + ')">' + subTabs[i] + '</button>';
    }
    container.innerHTML = html;
    // 触发展开动画
    requestAnimationFrame(function() {
        container.classList.add('expanded');
    });
}
```

- [ ] **Step 3: 新增 `updateSidebarClock()`**

在 `renderSettingsSubNav` 之后追加：

```javascript
// 更新侧边栏时钟
function updateSidebarClock() {
    var timeEl = document.getElementById('sidebar-clock-time');
    if (!timeEl) return;
    var now = new Date();
    var hh = String(now.getHours()).padStart(2, '0');
    var mm = String(now.getMinutes()).padStart(2, '0');
    var ss = String(now.getSeconds()).padStart(2, '0');
    timeEl.textContent = hh + ':' + mm + ':' + ss;
    // 折叠态竖排时钟
    var sciEl = document.getElementById('sci-clock');
    if (sciEl) {
        sciEl.textContent = hh + ':' + mm;
    }
}
```

- [ ] **Step 4: 新增 `toggleSidebarCollapse()`**

```javascript
// 折叠/展开侧边栏
function toggleSidebarCollapse() {
    var body = document.body;
    if (!body.classList.contains('sidebar-mode')) return;
    var isCollapsed = body.classList.toggle('sidebar-collapsed');
    try { localStorage.setItem('sidebarCollapsed', isCollapsed ? '1' : '0'); } catch(e) {}
    // 更新折叠按钮图标
    var collapseBtn = document.getElementById('sidebar-collapse-btn');
    if (collapseBtn) {
        collapseBtn.innerHTML = isCollapsed ? '&#9654;' : '&#9664;';
        collapseBtn.title = isCollapsed ? '展开侧边栏' : '折叠侧边栏';
    }
    // 折叠时收起设置子导航
    if (isCollapsed) {
        var subnav = document.getElementById('sidebar-settings-subnav');
        if (subnav) { subnav.classList.remove('expanded'); }
    } else {
        // 展开时如果设置 tab 激活，重新显示子导航
        if (_getActiveTab() === 5) {
            renderSettingsSubNav();
        }
    }
}
```

- [ ] **Step 5: 重写 `toggleLayoutMode()` 支持动画**

替换 `core.js` 第 356-360 行的旧函数：

```javascript
function toggleLayoutMode() {
    var body = document.body;
    var isCurrentlySidebar = body.classList.contains('sidebar-mode');
    var sidebar = document.querySelector('.sidebar');
    var header = document.querySelector('.app-header');
    var toolbar = document.querySelector('.app-toolbar');
    var tab = document.querySelector('.tab');

    if (isCurrentlySidebar) {
        // 侧边栏 → 顶部模式：水滴收起 + 顶部向下延伸
        if (sidebar) {
            sidebar.style.animation = 'sidebarDripOut 300ms ease forwards';
        }
        if (header) {
            header.style.animation = 'headerSlideDown 300ms ease forwards';
        }
        if (toolbar) {
            toolbar.style.animation = 'headerSlideDown 300ms ease forwards';
        }
        if (tab) {
            tab.style.animation = 'headerSlideDown 300ms ease forwards';
        }
        // 动画结束后移除类
        setTimeout(function() {
            body.classList.remove('sidebar-mode');
            if (sidebar) { sidebar.style.animation = ''; }
            if (header) { header.style.animation = ''; }
            if (toolbar) { toolbar.style.animation = ''; }
            if (tab) { tab.style.animation = ''; }
        }, 300);
        try { localStorage.setItem('layoutMode', 'topnav'); } catch(e) {}
    } else {
        // 顶部模式 → 侧边栏：水滴展开 + 顶部向上收起
        if (header) {
            header.style.animation = 'headerSlideUp 300ms ease forwards';
        }
        if (toolbar) {
            toolbar.style.animation = 'headerSlideUp 300ms ease forwards';
        }
        if (tab) {
            tab.style.animation = 'headerSlideUp 300ms ease forwards';
        }
        body.classList.add('sidebar-mode');
        if (sidebar) {
            sidebar.style.animation = 'sidebarDripIn 300ms ease forwards';
            setTimeout(function() { sidebar.style.animation = ''; }, 300);
        }
        try { localStorage.setItem('layoutMode', 'sidebar'); } catch(e) {}
        // 如果设置 tab 激活，渲染子导航
        if (_getActiveTab() === 5) {
            setTimeout(function() { renderSettingsSubNav(); }, 300);
        }
    }
}
```

- [ ] **Step 6: 新增 `syncSidebarDate()` 和 `sidebarExport()` 桥接函数**

追加到文件末尾：

```javascript
// 同步侧边栏日期选择器到主页日期
function syncSidebarDate() {
    var sd = document.getElementById('sidebar-schedule-date');
    var md = document.getElementById('schedule-date');
    if (sd && md) { md.value = sd.value; }
    if (typeof changeDate === 'function') changeDate();
}

// 同步导出日期并触发导出
function sidebarExport() {
    var ef = document.getElementById('sidebar-export-from');
    var et = document.getElementById('sidebar-export-to');
    var mef = document.getElementById('export-date-from');
    var met = document.getElementById('export-date-to');
    if (ef && mef) mef.value = ef.value;
    if (et && met) met.value = et.value;
    if (typeof exportSchedule === 'function') exportSchedule();
}
```

- [ ] **Step 7: 提交修改到 `rebuildNavUI` 和 `updateSidebarClock` 到 `_syncThemeToggleIcons`**

确认 `_syncThemeToggleIcons`（`core.js:401-408`）仍然能通过 `#theme-toggle-sidebar` 找到侧边栏主题按钮 — 新 HTML 已保留此 ID，无需修改此函数。

- [ ] **Step 8: Commit**

```bash
git add static/core.js
git commit -m "feat: add sidebar collapse, clock, settings subnav, drip animation, bridge fns

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: 修复 `switchTab()` 的 class 覆写

**Files:**
- Modify: `static/timeline.js:323-328`

- [ ] **Step 1: 改为 `classList.add/remove`**

将：

```javascript
    document.querySelectorAll('.tab-btn, .nav-item').forEach(function(b){
        var match = b.getAttribute('onclick').match(/switchTab\((\d+)\)/);
        var tabIdx = match ? parseInt(match[1], 10) : -1;
        var base = b.classList.contains('nav-item') ? 'nav-item' : 'tab-btn';
        b.className = tabIdx === i ? base + ' active' : base;
    });
```

替换为：

```javascript
    document.querySelectorAll('.tab-btn, .nav-item').forEach(function(b){
        var match = b.getAttribute('onclick').match(/switchTab\((\d+)\)/);
        var tabIdx = match ? parseInt(match[1], 10) : -1;
        if (tabIdx === i) {
            b.classList.add('active');
        } else {
            b.classList.remove('active');
        }
    });
```

- [ ] **Step 2: 添加设置子导航的联动（switchTab 末尾）**

在 `switchTab()` 函数体中（`if(i==5){ loadSettings(); }` 那行之后，`if(i !== 3){` 之前）追加：

```javascript
    // 侧边栏模式下：切换到设置时展开子导航，离开设置时收起
    if (document.body.classList.contains('sidebar-mode')) {
        if (i === 5) {
            renderSettingsSubNav();
        } else {
            var subnav = document.getElementById('sidebar-settings-subnav');
            if (subnav) { subnav.classList.remove('expanded'); }
        }
    }
```

- [ ] **Step 3: Commit**

```bash
git add static/timeline.js
git commit -m "fix: use classList instead of className in switchTab, add sidebar subnav sync

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: 修复 `switchSettingsSub()` 同步侧边栏子导航

**Files:**
- Modify: `static/settings.js:7-18`

- [ ] **Step 1: 在函数末尾追加侧边栏子导航高亮逻辑**

在 `switchSettingsSub()` 函数内部、`if (i === 6) { loadSaveList(); }` 之后、`}` 之前，追加：

```javascript
    // 同步侧边栏子导航高亮
    var subItems = document.querySelectorAll('#sidebar-settings-subnav .settings-sub-item');
    subItems.forEach(function(b, k) {
        if (k === i) {
            b.classList.add('active');
        } else {
            b.classList.remove('active');
        }
    });
```

- [ ] **Step 2: Commit**

```bash
git add static/settings.js
git commit -m "fix: sync sidebar settings sub-nav highlight in switchSettingsSub

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: 初始化恢复折叠状态 + 启动侧边栏时钟

**Files:**
- Modify: `static/app.js:38-41`

- [ ] **Step 1: 恢复 `sidebarCollapsed` 状态**

在 `app.js` 的布局模式恢复代码（第 38-41 行）后面追加：

```javascript
    // 恢复侧边栏折叠状态
    try {
        var sc = localStorage.getItem('sidebarCollapsed');
        if (sc === '1' && document.body.classList.contains('sidebar-mode')) {
            document.body.classList.add('sidebar-collapsed');
            var collapseBtn = document.getElementById('sidebar-collapse-btn');
            if (collapseBtn) {
                collapseBtn.innerHTML = '&#9654;';
                collapseBtn.title = '展开侧边栏';
            }
        }
    } catch(e) {}
```

- [ ] **Step 2: 启动侧边栏时钟更新**

在 `app.js` 的 `setInterval` 行（`setInterval(()=>{renderCurrentTimeMarker();},1000);`）之后追加：

```javascript
    setInterval(function() { updateSidebarClock(); }, 1000);
    updateSidebarClock(); // 立即执行一次
```

- [ ] **Step 3: Commit**

```bash
git add static/app.js
git commit -m "feat: restore sidebar collapsed state and start sidebar clock on init

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: 端到端验证

**不需要修改代码，纯手动验证。**

- [ ] **Step 1: 启动应用**

```bash
cd C:\Users\Admin\Desktop\大家的Draft\zyh\golden
python app.py
```

打开浏览器访问应用。

- [ ] **Step 2: 验证模式切换**

1. 点击 ⇆ 按钮 → 顶部栏向上收起，侧边栏水滴展开
2. 再次点击 ⇆ → 侧边栏水滴收起，顶部栏向下延伸
3. 刷新页面 → 保持上次选择的模式

- [ ] **Step 3: 验证折叠/展开**

1. 在侧边栏模式下点击 ◀ → 侧边栏缩至 56px，仅显示图标
2. 点击 ▶ → 侧边栏恢复 240px
3. 刷新页面 → 保持折叠状态

- [ ] **Step 4: 验证时钟**

1. 侧边栏展开：时钟显示 HH:MM:SS 实时更新
2. 侧边栏折叠：竖排 HH:MM 实时更新

- [ ] **Step 5: 验证工具栏卡片**

1. 排班日期：修改侧边栏日期 → 主页日期同步更新
2. 一键快速操作：点击 → 弹窗正常打开
3. 导出：设置日期范围 → 点击导出 → 正常导出

- [ ] **Step 6: 验证设置子导航**

1. 点击侧边栏"设置" → 子导航手风琴展开 8 项
2. 点击子项 → 面板内容切换，侧边栏子项高亮同步
3. 点击其他主导航 → 子导航收起
4. 返回"设置" → 子导航重新展开，上次选中项保持高亮

- [ ] **Step 7: 验证亮/暗主题**

1. 点击 ☾/☀ 切换主题 → 侧边栏玻璃效果适配
2. 亮色主题下侧边栏背景变浅色半透明

- [ ] **Step 8: 验证顶部模式回归**

1. 切换回顶部模式 → 所有功能正常
2. 日期选择、快速操作、导出、导航切换均无异常

- [ ] **Step 9: 验证涟漪动画**

1. 点击侧边栏按钮 → 涟漪效果正常
2. `no-ripple` class 设置正常禁用涟漪

---

### 实施顺序

严格按照 Task 1 → Task 9 的顺序执行。Task 2 (HTML) 依赖 Task 3 (CSS) 才能正确渲染，但 CSS 在 Task 1 后已具备所有变量，Task 2 可在 Task 3 之前先创建 DOM 结构。建议顺序：**1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9**。
