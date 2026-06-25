# 飞书设置页面优化 — 设计文档

**日期**: 2026-06-04
**状态**: 已确认

---

## 1. 概述

飞书同步子页面（settings-sub-7）经过多轮迭代积累了一些冗余、可合并、风格不一致的元素。本轮优化目标：**精简 + 统一状态区 + 解除不必要的依赖**。

## 2. 改动清单

### 2.1 删除：自动推送间隔 box

- **位置**：`templates/panels/settings.html` 第 571-579 行
- **原因**：功能预留从未实现，置灰占位
- **影响**：仅删 HTML，无 JS/后端联动

### 2.2 删除：立刻推送行为提示 box

- **位置**：`templates/panels/settings.html` 第 583-585 行
- **原因**：纯信息提示，独立 box 浪费空间
- **替代**：将提示文字移到"推送"/"拉取"按钮的 title 属性或旁边小字 tooltip

### 2.3 删除：扫描结果区域

- **位置**：`templates/panels/settings.html` 第 588-592 行
- **原因**：扫描结果与 KPI 仪表盘信息重复，平时不用
- **影响**：`scanFeishuTables()` 函数保留（扫描按钮仍可用），但扫描结果改用 toast 简要提示，不再渲染独立 box

### 2.4 合并：进度条 + 安静条 → 统一状态区

- **位置**：`templates/panels/settings.html` 第 467-481 行（进度条 + 安静条）
- **当前行为**：两个独立 DOM，通过 `display:none` 互斥切换
- **问题**：
  - 手动操作完成到状态更新之间有延迟，进度条残留
  - 快速连续操作时安静条"抢跑"
  - 自动同步在后台运行但安静条说"无进行中的操作"
- **新设计**：
  - 合并为一个 `#fs-status-area` DOM 容器
  - 三种内容状态：**进度中**（有 active_operation）、**空闲**（无操作）、**异常**（有错误但无操作）
  - 自动同步运行时也视为"进度中"状态，显示同步进度
  - JS 逻辑：`updateFeishuStatusUI` 中移除进度条/安静条的独立显隐控制，改为统一渲染函数

### 2.5 解除枷锁：推送设置始终可编辑

- **当前行为**：飞书同步关闭时，推送 box 设置 `opacity:0.5; pointer-events:none`
- **问题**：用户想先配好群聊和事件再开同步，但 UI 阻止
- **新设计**：
  - 推送设置 box 始终全功能可用
  - 飞书同步关闭时，在推送 box 底部显示一行小字："飞书同步未开启，推送不会生效"
  - 删除 `updateFeishuStatusUI` 中对 `#feishu-push-box` 的 opacity/pointer-events 控制
  - `loadPushConfig` 不再等待 `status.enabled`

### 2.6 Bug 修复：事件开关初始化覆盖默认值

- **位置**：`static/settings.js` `toggleEventItem()` 函数
- **Bug**：硬编码 `{ leader: false, group: false }` 初始化，覆盖 EVENT_ITEMS 默认值
- **修复**：已应用 — 从 EVENT_ITEMS 查找该 key 的默认 leader/group 值作为初始状态

## 3. 影响范围

| 文件 | 改动类型 |
|------|---------|
| `templates/panels/settings.html` | 删 3 个 box，合并 2 个 box 为 1 个，删除推送 box 的 inline style |
| `static/settings.js` | 合并进度条/安静条渲染逻辑，删除推送联动代码，已修 bug |

## 4. 不涉及

- 后端路由（无改动）
- 数据库（无改动）
- 其他设置子页面
- 推送事件开关矩阵的结构变更（仅修 bug，不改 UI）
