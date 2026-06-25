# Filter Unification Design

**日期：** 2026-06-01
**状态：** 已确认

## 背景

任务库和历史记录的筛选目前使用普通 `<select>` 下拉框（单选），与机器管理和自动分配弹窗的多选 tag-panel 体验差距明显。需要统一。

## 参考标杆

- **机器管理**：filter-dim trigger 按钮 + 下拉 tag-panel 多选 + 条件标签栏 + 重置按钮
- **自动分配弹窗**：内联 tab 多选（交互不同，但多选理念一致）

## 方案

采用**机器管理风格**的 tag-panel 多选，将 core.js 中已有的 `_filterState` 机制扩展为多面板共享。

### 任务库

**改造前：** 折叠面板里的 `<select>` 单选下拉框（机型/任务类型/状态/时长单位）
**改造后：**

- 筛选栏内联在搜索框旁：`搜索 | 机型: [全部 ▾] | 任务类型: [全部 ▾] | 状态: [全部 ▾] | ↺ 重置`
- 每个 filter-dim trigger 点击弹出 tag-panel，点击 tag 切换多选
- 条件标签栏显示已激活的筛选条件（如"机型: BR2 ✕"）
- **时长单位**从筛选面板分离，作为独立控件放在操作列附近

### 历史记录

**改造前：** 折叠面板里的 `<select>` 单选下拉框（机型/任务类型，无状态维度）
**改造后：**

- 筛选栏内联：`搜索 | 日期区间 | 机型: [全部 ▾] | 任务类型: [全部 ▾] | ↺ 重置`
- 交互与任务库一致，多选 tag-panel
- 日期区间保持独立 toggle 面板不变
- **不新增状态维度**（历史记录中的任务均为已完成状态）

### 关键决策

| 决策 | 结论 | 原因 |
|------|------|------|
| 历史是否加状态筛选 | 不加 | 历史记录均为已完成，无筛选意义 |
| 筛选是否持久化 | 不持久化 | 切换面板时重置，简单直观 |
| 时长单位 | 分离 | 从筛选面板移除，作为独立控件 |
| URL 同步 | 不同步 | 仅机器管理需要（影响时间轴） |

## 代码改动

| 文件 | 改动 |
|------|------|
| `static/core.js` | 新增 `_taskFilterState` / `_histFilterState`，提取公共筛选面板渲染函数 |
| `templates/panels/tasks.html` | 删除旧 select，换 filter-dim trigger + panel + 条件标签栏；时长单位分离 |
| `templates/panels/history.html` | 删除旧 select，换 filter-dim trigger + panel + 条件标签栏 |
| `static/task-table.js` | `_getFilteredAndSortedTasks()` 从 `_taskFilterState` 读取多选值 |
| `static/history.js` | `_getFilteredAndSortedHistory()` 从 `_histFilterState` 读取多选值 |

## 数据流

```
用户点击 tag → _toggleFilterTag(dim, value)
  → _taskFilterState[dim].push(value)
  → _syncFilterUI(state)
  → applyTaskFilters()
    → _getFilteredAndSortedTasks()
    → _renderTaskPage()
```

- 纯客户端过滤，数据一次从 `/api/tasks` 拉全量
- 三套 filterState 互不干扰：`_filterState`(机器) / `_taskFilterState` / `_histFilterState`
- 不持久化，不写 localStorage，不写 URL

## 不影响的部分

搜索框、简易/详细切换、分页、排序、批量操作 — 全部保持不变。
