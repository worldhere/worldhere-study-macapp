# Task Library & History Pagination

## Scope

Add client-side pagination to the task library table and history records table. Refactor both from DOM-driven rendering to array-driven rendering. Task pool pagination is left as-is.

## 1. Data Flow Refactoring

### Before
```
API → render all rows to DOM → search/filter/sort operate on DOM tr elements
```

### After
```
API → TASKS_DATA[] → search/filter/sort (pure array) → slice(page) → render current page to DOM
```

Two module-level arrays:
- `TASKS_DATA` — raw task objects from `/api/tasks`
- `SCHEDULES_HISTORY` — raw history objects from `/api/history_schedules`

Search, filter, sort, and batch selection all operate on these arrays. DOM rendering only writes the current page.

### getTaskById(tid)

Expose `function getTaskById(tid)` that searches `TASKS_DATA` for a task by id. Three timeline functions currently read task data from `#task-table tr[data-tid]` — they will call `getTaskById()` instead:

| File | Line | What changes |
|------|------|-------------|
| `timeline-render.js:60` | `syncTaskTableTime()` | Read `getTaskById(tid)`, skip DOM write if row not on current page |
| `timeline-ops.js:95` | Edit dialog populate | Read `getTaskById(tid).est_mode / .duration / .op_min` etc. |
| `timeline-drag.js:242,291` | Drag assign est_seconds | Read `getTaskById(tid).est_seconds` |

## 2. Pagination Controls

Placed below the filter bar, above the table. Layout:

```
[← 上一页]  1  2  3  ...  8  [下一页 →]    每页 [20 ▼]    共 X 条，筛选显示 Y 条，第 Z/共 N 页
```

- Page numbers: current page highlighted. When > 7 pages, middle pages collapsed with `...`
- Prev/Next disabled at boundaries
- Page size dropdown: `20 / 50 / 100`
- Row count merged into the pagination bar
- Each panel (tasks, history) has independent pagination state

### Persistence

Page size stored in `localStorage`:
- `taskPageSize` / `historyPageSize`

Page number resets to 1 on: search input change, filter change, data refresh, page size change.

## 3. Sequence Number Column

Add `#` column as the first column in both simple and detail tables:

- Header: `<th>#</th>`, width ~40px, not sortable
- Cell value: `(page - 1) * pageSize + rowIndex + 1`
- Applies to both task library tables and both history tables

## 4. Search / Filter / Sort — Array Operations

All three become pure functions on `TASKS_DATA` (or `SCHEDULES_HISTORY`):

1. **Filter**: build a filtered array from the raw data based on type/kind/status selects
2. **Search**: split filtered array into matching and non-matching; sort matching first by match count
3. **Sort**: apply column sort within matching group
4. **Slice**: return `page * pageSize` to `(page + 1) * pageSize`
5. **Render**: write sliced rows to DOM with highlights

The combined pipeline: `filter → search → sort → paginate → render`

## 5. Batch Selection Across Pages

- Maintain `Set taskBatchSelection` (Set of selected task IDs)
- Checkbox state restored from Set when rendering a page
- "Select all" only selects currently visible (filtered) items, not across pages
- Batch action bar shows count from Set, operates on IDs from Set
- Same pattern for history batch selection

## 6. Task Pool — No Change

The task pool (`#pool-task-items`) already has its own pagination via show/hide. It renders from JS objects in `_renderTaskTable()` and does not read from table DOM. Extract pool rendering into `_renderTaskPool()` as a standalone function, but keep its existing pagination approach.

## 7. Files to Modify

| File | Changes |
|------|---------|
| `static/tasks.js` | Add `TASKS_DATA`, `getTaskById()`, refactor `_renderTaskTable` to array-driven, extract `_renderTaskPool`, new pagination render/control functions, add `#` column, refactor search/filter/sort to array ops, batch selection across pages |
| `static/history.js` | Add `SCHEDULES_HISTORY`, same array-driven refactoring, pagination controls, `#` column, refactor `_renderHistoryTable`/`filterHistoryTable` |
| `templates/panels/tasks.html` | Add `#` column to both table theads, add pagination control container |
| `templates/panels/history.html` | Add `#` column to both table theads, add pagination control container |
| `static/timeline-render.js` | `syncTaskTableTime()` use `getTaskById()`, skip DOM write if row not on page |
| `static/timeline-ops.js` | Edit dialog read task data via `getTaskById()` |
| `static/timeline-drag.js` | Drag assignment read est_seconds via `getTaskById()` |
| `static/style.css` | Pagination bar styles, `#` column width |

## 8. Non-Goals

- Server-side pagination
- Settings page toggle (pagination always on)
- Task pool pagination refactoring
- Timeline pagination
- Page number in URL