# Task Table UX Overhaul

## Scope

Three areas of the task library panel: filter bar, data table, and edit panel.

## 1. Filter Bar

### Search Box
- Text input at top of filter bar, full width, placeholder "搜索任务名、机型、类型..."
- Client-side real-time filtering across: name, type, task_kind, rbp_task_id
- Matching rows sorted to top of table; non-matching rows below, respecting current sort order
- Matched text in cells highlighted with `<mark>` (yellow background)

### Collapsed Filters
- Existing dropdowns (view, type, kind, status, duration unit) moved into a collapsible "筛选条件" toggle button
- Click to expand a dropdown panel with the filter selects
- Active filter count shown as badge on the toggle (e.g. "筛选条件 (2)")

### Mode Switch
- Simple/Detail mode changed from `<select>` to two toggle buttons: `简易 | 详细`
- Active button highlighted with primary color

### Row Count
- Display "共 X 条任务，当前筛选显示 Y 条" below the filter bar
- Updates live as filters/search change

### Column Visibility Toggle
- Checkbox "显示操作列" — unchecked hides the action buttons column entirely
- Checked by default

## 2. Table

### Structure
- Replace flat `<tr>` rows with proper `<thead>` and `<tbody>` elements
- Header row in `<thead>`, data rows in `<tbody>`

### Column Sorting
- Click column header to cycle: ascending → descending → unsorted
- Sort indicator: ▲ (asc) or ▼ (desc) appended to header text
- Text columns: localeCompare
- Numeric columns (duration): numeric comparison
- Status column: custom order (待分配 → 已分配 → 采集中 → 采集即将完成 → 暂停中 → 暂停即将超时 → 过时待确认 → 已完成)
- Search-matching rows always sort to top before sort order is applied

### Simple Mode Table (9 columns)
```
任务名 | 机型 | 任务类型 | 优先级 | 难度 | 预估时长 | 状态 | 分配时段 | 操作
```
- Name column: min-width 120px, text-overflow ellipsis, title attribute for full name
- All 5 action buttons visible when "显示操作列" is checked
- Action buttons: 指派, 回收, 已完成, 修改, 删除

### Detail Mode Table (14 columns)
```
任务名 | 机型 | 优先级 | RBP数采任务ID | 任务状态 | 任务场景 | 任务类型 | 通用任务类别 | 任务来源链接 | 预期采集量/条 | 数采需求ID | 数采需求类型 | 操作
```
- Horizontal scroll with sticky first column (task name) and last column (actions)
- Column groups: basic info → collection fields → source fields

### Search Highlight
- Input text matched case-insensitively in visible cell content
- Matching substring wrapped in `<mark class="search-highlight">` with yellow background
- Rows with more matches sort higher among the search-matched group

## 3. Edit Panel — Side Drawer

### Layout
- Replaces centered modal dialog
- Slides in from right edge, width 420px
- Table visible underneath with translucent dark overlay
- Drawer has header (title + close X), scrollable body, fixed footer (Save + Cancel)

### Field Groups
**Basic fields** (always visible):
- 任务名, 机型, 任务类型, 优先级, 难度
- 预估时长 section (mode radio: 不填 / 直接预估 / 计算预估, with conditional inputs)

**Detail fields** (separated by divider):
- RBP任务ID, 场景, 通用类别
- 来源链接, 预期采集量
- 数采需求ID, 数采需求类型
- 备注

### Animation
- Slide-in: 200ms ease from right
- Slide-out: 150ms ease to right
- Overlay fade: 200ms

### Shared Usage
- `#edit-dialog` is used by BOTH the task library table (`tasks.js:openEditDialog`) AND the timeline double-click (`timeline-ops.js:editTask`)
- Timeline entry: populates basic fields from schedule data, tries to read detail fields from `#task-table tr[data-tid]`, falls back to empty detail fields
- Both call `submitEditTask()` for save
- The side drawer must work for both entry points — timeline caller should also trigger drawer open

### Behavior
- Open: "修改" button click or timeline double-click → populate fields → slide drawer in
- Save: POST /update_task → on success close drawer → refresh task list → update table row
- Cancel: close drawer, no changes
- Clicking overlay also closes drawer (with confirm if fields modified)

## Data Flow

- No backend changes
- `_refreshTaskList()` fetches all tasks as before
- `_renderTaskTable()` builds table rows with data attributes
- `applyTaskFilters()` handles search matching, column sorting, and row visibility in one pass
- Search and sort are client-side only

## Files to Modify

| File | Changes |
|---|---|
| `templates/panels/tasks.html` | Filter bar restructure, table thead/tbody, drawer HTML |
| `static/tasks.js` | Search logic, sort logic, highlight, drawer open/close, drawer save |
| `static/style.css` | Drawer styles, search highlight, filter bar layout, sort indicators |

## Non-Goals

- Server-side search or pagination
- Inline editing
- Multi-column sort
- Column resize/drag-reorder
