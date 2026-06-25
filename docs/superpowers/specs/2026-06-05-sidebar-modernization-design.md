# 侧边栏现代化设计

## 目标

侧边栏模式（V1）长期未维护，视觉老旧，缺少时钟、动画、折叠能力和设置子导航。本次改造在不改变双模式架构的前提下，对侧边栏进行全面现代化升级。

### 参考

- 动画与排版：cnblogs.com/bndong
- UI 风格：xinghuisama.top + 当前系统顶部栏
- 水滴动画：cnblogs.com/leixixi

---

## 架构：侧边栏三态模型

侧边栏从"显示/隐藏"两态升级为三态：

| 状态 | 触发 | 侧边栏 | 顶部栏/工具栏/标签栏 | 主内容 |
|------|------|--------|---------------------|--------|
| ① 顶部模式（默认） | `layoutMode = "topnav"` | 隐藏 | 可见 | margin-left: 0 |
| ② 侧边栏展开 | 从①按 ⇆ 切换 | 240px 全功能 | 隐藏 | margin-left: 240px |
| ③ 侧边栏折叠 | 从②按 ◀ 折叠 | 56px 纯图标 | 隐藏 | margin-left: 56px |

状态转换：
- ① ⇄ ②：`toggleLayoutMode()` — 水滴展开/收起动画，300ms
- ② ⇄ ③：`toggleSidebarCollapse()` — 宽度过渡，250ms
- ③ 不出现顶部栏 —— 时钟以竖排 `HH:MM` 形式嵌在折叠侧边栏内

### 持久化

- `localStorage.layoutMode`：`"topnav"` | `"sidebar"`（已有，不变）
- `localStorage.sidebarCollapsed`：`"1"` | `"0"`（新增，仅在 sidebar 模式下生效）

---

## 视觉风格

### 毛玻璃侧边栏

```css
/* 暗色 */
background: linear-gradient(180deg, rgba(15,23,42,0.94), rgba(15,23,42,0.88));
backdrop-filter: blur(24px) saturate(120%);
border-right: 1px solid rgba(255,255,255,0.06);

/* 亮色 */
background: linear-gradient(180deg, rgba(248,250,252,0.94), rgba(241,245,249,0.88));
backdrop-filter: blur(24px) saturate(120%);
border-right: 1px solid rgba(0,0,0,0.06);
```

### 导航项

- 8px 圆角卡片式，左右留白 10px
- 默认：灰文字 `#94a3b8`，无背景
- Hover：`rgba(255,255,255,0.04)` 背景，文字提亮，150ms 过渡
- Active：`rgba(59,130,246,0.15)` 蓝色半透明背景，文字 `#bfdbfe` 加粗
- 不再使用左边框指示器（`border-left: 3px solid`）

### 设置子导航（手风琴）

- 仅在"设置"为活动项时展开
- `max-height` 过渡，200ms ease
- 左侧 2px 蓝色细竖线 + 32px 缩进
- 字号 12px，比主导航小一档
- 当前活动子项：蓝色半透明背景

---

## 侧边栏布局（从上到下）

```
┌─────────────────────┐
│ 🏷 品牌区            │  图标 + "排班系统" + English subtitle
├─────────────────────┤
│ 🕐 当前时间          │  实时时钟 HH:MM:SS，等宽字体 #93c5fd
├─────────────────────┤
│ 📅 排班日期          │  <input type="date">，控制排班面板
├─────────────────────┤
│ ⚡ 一键快速操作       │  红色调按钮，打开快速操作弹窗
├─────────────────────┤
│ 📤 导出 Excel        │  从/到日期范围 + 导出按钮
├─────────────────────┤
│ 🧭 主菜单            │
│   班次设置            │
│   机器管理            │
│   任务库              │
│   排班面板 [active]   │
│   历史记录            │
│   设置                │
│   ┊ 班次设置          │  ← 手风琴展开（仅设置 active 时）
│   ┊ 机器管理设置       │
│   ┊ ...              │
├─────────────────────┤
│ ⚙ 底部               │  DB 路径 + ☾主题 ◀折叠 ⇆切换
└─────────────────────┘
```

### 折叠态（56px）

```
┌────┐
│ 📅 │  品牌图标
│14:3│  竖排时钟 HH:MM
│────│
│ ⚙  │  导航（纯图标）
│ 🖥  │
│ 📅  │  [active: 蓝色背景]
│ ⚙  │
│────│
│ ☾  │
│ ▶  │  展开按钮
│ ⇆  │  切回顶部
└────┘
```

折叠时：工具栏区块全部隐藏，设置子导航不展开。

---

## 动画

### CSS 变量

```css
:root {
  --transition-fast:   150ms ease;   /* 导航悬停 */
  --transition-normal: 200ms ease;   /* 手风琴展开 */
  --transition-slow:   250ms ease;   /* 折叠/展开宽度 */
  --transition-layout: 300ms ease;   /* 模式切换 */
}
```

### 模式切换（顶部 ⇄ 侧边栏，300ms）

- **顶部栏 → 侧边栏**：
  - 顶部栏：`transform: translateY(-100%); opacity: 0;` 向上收起
  - 工具栏 + 标签栏：同上
  - 侧边栏：`clip-path` 水滴扩散 `circle(0) → circle(300px) → inset(0)`，从左上角品牌图标处展开
  - 主内容：`margin-left` 从 0 过渡到 240px

- **侧边栏 → 顶部栏**：
  - 侧边栏：`clip-path` 反向收起至原点
  - 顶部栏：`translateY(0); opacity: 1;` 向下延伸
  - 主内容：`margin-left` 复位

### 折叠/展开（② ⇄ ③，250ms）

- 侧边栏宽度：`width` transition，240px ⇄ 56px
- 内容（文字、工具栏卡片）：`opacity + visibility` 渐隐
- 时钟：`HH:MM:SS` → 竖排 `HH:MM`（通过切换 DOM 内容实现）
- 主内容 `margin-left` 同步过渡
- 使用 `cubic-bezier(0.4, 0, 0.2, 1)` 标准缓动

### 设置手风琴（200ms）

- `max-height` 过渡 + 箭头旋转 `transform: rotate(180deg)`
- 子项逐个 `translateX` 微偏移淡入

### 保留：按钮涟漪

- 现有 `theme.css` 中的 `::after` 涟漪动画不动
- 新按钮自动继承

---

## 实现范围

### 改动的文件

| 文件 | 改动 |
|------|------|
| `static/layout.css` | 重写 sidebar 全部样式，新增 sidebar-collapsed 状态，玻璃效果，折叠态 CSS，动画关键帧 |
| `static/theme.css` | 新增 CSS 变量：`--transition-fast/normal/slow/layout` |
| `templates/index.html` | 侧边栏 HTML 重构：加时钟、工具栏卡片、设置子导航占位、折叠按钮 |
| `static/core.js` | 新增 `toggleSidebarCollapse()`、`updateSidebarClock()`、`renderSettingsSubNav()`；修改 `toggleLayoutMode()` 支持动画；修改 `rebuildNavUI()` 支持侧边栏手风琴 |
| `static/app.js` | 初始化时恢复 `sidebarCollapsed` 状态 |
| `static/settings.js` | `switchSettingsSub()` 在侧边栏模式下同步更新侧边栏子导航高亮 |

### 不改动的文件

- `static/style.css` — 只导入了其他 CSS，不动
- `static/components.css` — 设置子导航的 `.settings-subnav` 样式保留（面板内仍然需要）
- `routes/` — 纯前端改动，后端不变
- `db.py` — 不改 schema
- 所有 Python 文件

---

## 数据流

```
localStorage.layoutMode ("topnav" | "sidebar")
        │
        ▼
app.js onload ──→ document.body.classList.add("sidebar-mode")
        │
        ▼
rebuildNavUI() ──→ 填充 .sidebar-nav（主导航）
                  └── 填充 .tab（顶部标签栏，当 topnav 模式时）
        │
        ▼
switchTab(5) ──→ 设置面板激活时
        │         renderSettingsSubNav() 在侧边栏渲染子导航
        ▼
switchSettingsSub(i) ──→ 更新侧边栏子导航 active 状态
                         + 更新面板内 .settings-subnav 状态
```

---

## 错误处理

- `localStorage` 读取失败 → 使用默认值，侧边栏展开
- 时钟 DOM 不存在 → `updateSidebarClock()` 静默跳过
- 设置子导航容器缺失 → `renderSettingsSubNav()` 静默跳过
- 动画被中断（快速连点切换）→ 使用 `transitionend` 事件或直接设置最终状态

---

## 已知冲突与处理

### 1. `switchTab()` 重置 className（`timeline.js:323-328`）

`b.className = base + ' active'` 直接覆写整个 class 属性。

**处理**：改为 `classList.add/remove`，保留其他 class 不动。

### 2. `rebuildNavUI()` 清空 `.sidebar-nav`（`core.js:22`）

`sidebarNav.innerHTML = html` 会清除内部元素。

**处理**：设置子导航用独立容器 `.sidebar-settings-subnav`，位于 `.sidebar-nav` 外部。

### 3. `toggleLayoutMode()` 不兼容动画（`core.js:358`）

`classList.toggle` 瞬间切换，无动画时序。

**处理**：重写为动画驱动版本 — 入场时先设置初始 clip-path，下一帧触发展开；出场时反向播放，300ms 后移除 body class。

### 4. `_syncThemeToggleIcons()` 依赖 `#theme-toggle-sidebar`（`core.js:405`）

**处理**：新侧边栏 HTML 保留 `id="theme-toggle-sidebar"`。

### 5. `switchSettingsSub()` 不更新侧边栏子导航（`settings.js:7-18`）

只更新面板内元素。

**处理**：末尾追加侧边栏子导航高亮逻辑。

### 6. 旧 CSS `display:none` 规则与动画冲突（`layout.css:258-270`）

display 切换不支持过渡动画。

**处理**：侧边栏/顶部栏改为 `clip-path` + `opacity` + `pointer-events` 控制显隐，不再依赖 `display:none`。

### 7. 涟漪动画 — 无冲突 ✅

`theme.css:204-217` 基于事件委托注入 `<span>`，新按钮自动继承。

---

## 验证

1. 侧边栏模式：点击 ⇆ → 顶部栏向上收起，侧边栏水滴展开，时钟显示正确
2. 折叠：点击 ◀ → 侧边栏缩至 56px 图标模式，点击 ▶ 展开
3. 设置子导航：点击"设置" → 子项展开，点击其他导航 → 子项收起
4. 日期选择器、快速操作、导出在侧边栏中功能正常
5. 亮/暗主题切换正常，毛玻璃效果适配
6. 顶部模式一切功能不受影响（回归）
7. 浏览器刷新后保持布局状态和折叠状态
8. 按钮涟漪动画正常
