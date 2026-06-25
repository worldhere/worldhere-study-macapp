# History Table UX Overhaul

## Relationship to Task Table Spec

The history table follows the same visual style as the task library table (search, sorting, thead/tbody, filter bar layout, mode switch) but is implemented independently — different JS files, different DOM elements, different data sources. See `2026-05-21-task-table-ux-design.md` for the style reference.

Key differences from task table:
- Data source: `/api/history_schedules` (schedules with machine info) vs `/api/tasks`
- Fewer action buttons: 3 (修改/删除/回收) vs 5
- No status column (all records are completed)
- Has repair duration and repair periods columns
- Edit dialog is simpler (time range primary, field edit secondary)

## 1. Filter Bar

Same layout as task table:

```
[🔍 搜索任务名、机器名、类型...    ] [日期区间 ▸] [筛选条件 ▸] [简易|详细] [导出Excel] [同步历史名称]
```

- Search box: real-time client-side filter across task_name, machine_name, task_kind, rbp_task_id
- "日期区间 ▸": collapsible toggle, opens the existing from→to date inputs
- "筛选条件 ▸": collapsible toggle, opens 机型 + 任务类型 dropdowns
- Mode switch: `简易 | 详细` button group (replaces `<select>`)
- Row count: "共 X 条记录，当前筛选显示 Y 条"

## 2. Table

### Structure
- Proper `<thead>` and `<tbody>` in both simple and detail tables
- Column sorting: click header → asc → desc → unsorted, with ▲/▼ indicator
- Search highlight: matched text wrapped in `<mark class="search-highlight">` (yellow)
- Search-matching rows sorted to top

### Simple Mode (7 columns)
```
任务 | 机器 | 完成时间段 | 任务类型 | 备注 | 维修时长 | 操作
```
- Task name column: fixed min-width, text-overflow ellipsis
- Action buttons: 修改, 删除, 回收

### Detail Mode (14 columns)
```
任务 | 机器 | 完成时间段 | 任务类型 | 备注 | 维修时长 | RBP任务ID | 场景 | 通用类别 | 来源链接 | 预期采集量 | 数采需求ID | 数采需求类型 | 维修时间段 | 操作
```
- Horizontal scroll with sticky first column (task name) and last column (actions)

### Batch Operations
- "批量操作" toggle button → shows checkboxes + batch actions bar
- Batch actions: 批量回收, 批量删除
- Same toggle pattern as task table

## 3. Edit Dialog

### Layout
- Centered modal, 720px wide
- Card-style with rounded corners, shadow, slide-up animation
- Header (icon + title + close X), scrollable body, fixed footer

### Content
**Time range section** (always visible):
- Section with light background block and "实际完成时间段" header
- Grid layout: `开始 | → | 结束`
- Each side has date input + time input, flex-equal width

**More fields** (collapsed by default):
- Toggle button "▶ 更多字段"
- When expanded: bordered section with 2-column grid:
  - 任务名, 机型, 任务类型, 维修时长, 备注 (full width)
- Save submits all fields (time range + more fields)

### Behavior
- Open from "修改" button or batch selection → fetch data from `SCHEDULES_HISTORY` → populate fields → show dialog
- Save: POST `/update_task_bounds` (time range) + optionally update field data
- Cancel: close dialog, no changes
- Clicking overlay closes dialog

## Data Flow

- No backend changes required
- `_loadHistory(from, to)` fetches data from `/api/history_schedules`
- `_renderHistoryTable(data, mode)` builds table with data attributes
- `filterHistoryTable()` extended to handle search matching and column sorting
- Search and sort are client-side only

## Files to Modify

| File | Changes |
|---|---|
| `templates/panels/history.html` | Filter bar restructure, table thead/tbody, edit dialog redesign |
| `static/history.js` | Search logic, sort logic, highlight, dialog open/close/submit |
| `static/style.css` | Dialog styles, search highlight, sort indicators (same visual style as task table) |

## Non-Goals

- Server-side search or pagination
- Inline editing for history records
- Merging history edit dialog with task edit drawer (different purposes)
