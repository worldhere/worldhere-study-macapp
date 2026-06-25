# Large File Refactoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split 4 oversized files (index.html 1201行, schedules.py 1239行, settings.js 1230行, tasks.js 1506行) into focused modules to reduce cognitive burden and merge conflict risk.

**Architecture:** Four independent phases ordered by risk (lowest first). Each phase produces a working, testable app. Phases share no dependencies — any subset can ship. Vanilla JS keeps global function pattern (no bundler); Python uses separate Flask blueprints; HTML uses Jinja2 `{% include %}`.

**Tech Stack:** Flask + Jinja2 + Vanilla JS (ES5 globals) + SQLite

---

## Phase 1: Split `templates/index.html` (1201行 → 主模板~100行 + 6面板 + 对话框)

### Task 1.1: Extract 班次设置 panel

**Files:**
- Create: `templates/panels/shifts.html`
- Modify: `templates/index.html:78-114`

- [ ] **Step 1: Create panel file**

Read `templates/index.html` lines 78-114 (from `<!-- ==================== 班次设置 ==================== -->` to the line before `<!-- ==================== 机器管理 ==================== -->`). Move that HTML block into `templates/panels/shifts.html`.

- [ ] **Step 2: Replace with include**

In `templates/index.html`, replace the extracted block with:
```jinja2
{% include 'panels/shifts.html' %}
```

- [ ] **Step 3: Verify app loads**

```bash
python app.py
```
Open browser, confirm the 班次设置 panel renders correctly.

- [ ] **Step 4: Commit**

```bash
git add templates/panels/shifts.html templates/index.html
git commit -m "refactor: extract shifts panel into separate template include"
```

### Task 1.2: Extract 机器管理 panel

**Files:**
- Create: `templates/panels/machines.html`
- Modify: `templates/index.html`

- [ ] **Step 1: Extract panel HTML**

Move lines 115-162 (from `<!-- 机器管理 -->` through the end of that panel's `</div>`) into `templates/panels/machines.html`.

- [ ] **Step 2: Replace with `{% include 'panels/machines.html' %}`**

- [ ] **Step 3: Verify and commit**

```bash
git add templates/panels/machines.html templates/index.html
git commit -m "refactor: extract machines panel into separate template include"
```

### Task 1.3: Extract 任务库 panel

**Files:**
- Create: `templates/panels/tasks.html`
- Modify: `templates/index.html`

- [ ] **Step 1: Extract panel HTML**

Move lines 163-320 (from `<!-- 任务库 -->` through the end of that panel) into `templates/panels/tasks.html`.

- [ ] **Step 2: Replace with `{% include 'panels/tasks.html' %}`**

- [ ] **Step 3: Verify and commit**

### Task 1.4: Extract 排班面板 panel

**Files:**
- Create: `templates/panels/schedule.html`
- Modify: `templates/index.html`

- [ ] **Step 1: Extract panel HTML**

Move lines 321-418 (from `<!-- 排班面板 -->` through the end of that panel) into `templates/panels/schedule.html`.

- [ ] **Step 2: Replace with `{% include 'panels/schedule.html' %}`**

- [ ] **Step 3: Verify and commit**

### Task 1.5: Extract 历史记录 panel

**Files:**
- Create: `templates/panels/history.html`
- Modify: `templates/index.html`

- [ ] **Step 1: Extract panel HTML**

Move lines 419-475 (from `<!-- 历史记录 -->` through the end of that panel) into `templates/panels/history.html`.

- [ ] **Step 2: Replace with `{% include 'panels/history.html' %}`**

- [ ] **Step 3: Verify and commit**

### Task 1.6: Extract 设置 panel

**Files:**
- Create: `templates/panels/settings.html`
- Modify: `templates/index.html`

- [ ] **Step 1: Extract panel HTML**

Move lines 476-829 (from `<!-- 设置 -->` through the end of settings panel, before `<!-- 弹窗 -->`) into `templates/panels/settings.html`.

- [ ] **Step 2: Replace with `{% include 'panels/settings.html' %}`**

- [ ] **Step 3: Verify and commit**

### Task 1.7: Extract dialogs

**Files:**
- Create: `templates/dialogs/import.html`
- Create: `templates/dialogs/assign.html`
- Create: `templates/dialogs/edit.html`
- Create: `templates/dialogs/auto_assign.html`
- Create: `templates/dialogs/mass_delay.html`
- Create: `templates/dialogs/cut.html`
- Create: `templates/dialogs/export_columns.html`
- Create: `templates/dialogs/batch_machine.html`
- Create: `templates/dialogs/confirm.html`
- Modify: `templates/index.html`

- [ ] **Step 1: Extract each dialog into its own file**

Read lines 830-1201 of index.html. Split each modal dialog block (delimited by `<!-- 模态框: XXX -->` style comments or outer `<div class="modal-overlay" id="...">`...`</div>` pairs) into `templates/dialogs/<name>.html`.

- [ ] **Step 2: Replace dialog section with includes**

```jinja2
{% include 'dialogs/import.html' %}
{% include 'dialogs/assign.html' %}
{% include 'dialogs/edit.html' %}
{% include 'dialogs/auto_assign.html' %}
{% include 'dialogs/mass_delay.html' %}
{% include 'dialogs/cut.html' %}
{% include 'dialogs/export_columns.html' %}
{% include 'dialogs/batch_machine.html' %}
{% include 'dialogs/confirm.html' %}
```

- [ ] **Step 3: Full app smoke test**

Click through all 6 panels, open each dialog type, confirm everything renders.

- [ ] **Step 4: Commit**

```bash
git add templates/panels/ templates/dialogs/ templates/index.html
git commit -m "refactor: extract all panels and dialogs into separate template includes"
```

---

## Phase 2: Split `routes/schedules.py` (1239行 → 3个蓝图文件)

### Task 2.1: Create `routes/schedule_ops.py` — Core scheduling operations

**Files:**
- Create: `routes/schedule_ops.py`
- Modify: `routes/schedules.py:1-936`
- Modify: `app.py:8`

- [ ] **Step 1: Create schedule_ops.py with core routes**

Extract these functions from `routes/schedules.py` into the new file:
- `assign_task()` (line 29)
- `move_task()` (line 125)
- `update_task_pos()` (line 165)
- `update_task_bounds()` (line 193)
- `complete_task()` (line 230)
- `complete_split_task()` (line 279)
- `uncomplete_task()` (line 322)
- `delete_schedule()` (line 337)
- `restore_deleted_and_assign()` (line 381)
- `edit_task()` (line 455)
- `quick_ops()` (line 502)
- `clear_all()` (line 605)
- `del_schedule()` (line 620)
- `recall_task()` (line 629)
- `machine_schedules()` (line 903)
- `api_view_schedules()` (line 935)

New file header:
```python
import datetime
import io
import json
from flask import Blueprint, request, jsonify

from db import get_db, get_allowed_task_kinds, recycle_schedules
from utils import parse_date, parse_duration_to_minutes, normalize_machine_schedule, min_to_hhmm
from utils import abs_min_to_datetime, abs_min_to_label, calc_working_minutes
from models import load_shift_config, get_repair_logs

bp = Blueprint('schedule_ops', __name__)
```

- [ ] **Step 2: Remove extracted functions from schedules.py**

Delete the functions listed above from `routes/schedules.py`, keeping only:
- `api_history_schedules()`
- `auto_assign_preview()`
- `api_auto_assign()`
- `api_mass_delay()`
- `export_schedules()`
- `cut_task()`
- `undo_cut()`
- `_num_to_cn()`

- [ ] **Step 3: Register new blueprint in app.py**

Add import:
```python
from routes.schedule_ops import bp as schedule_ops_bp
```
Add registration:
```python
app.register_blueprint(schedule_ops_bp)
```

- [ ] **Step 4: Run tests to verify**

```bash
python test_all.py
```
All API tests should pass.

- [ ] **Step 5: Commit**

```bash
git add routes/schedule_ops.py routes/schedules.py app.py
git commit -m "refactor: extract core schedule operations into separate blueprint"
```

### Task 2.2: Create `routes/schedule_cut.py` — Cut/undo operations

**Files:**
- Create: `routes/schedule_cut.py`
- Modify: `routes/schedules.py`
- Modify: `app.py`

- [ ] **Step 1: Extract cut/undo functions**

Move `_num_to_cn()`, `cut_task()`, and `undo_cut()` into `routes/schedule_cut.py`:
```python
from flask import Blueprint, request, jsonify
from db import get_db
from utils import parse_date, parse_duration_to_minutes, normalize_machine_schedule

bp = Blueprint('schedule_cut', __name__)

# ... _num_to_cn, cut_task, undo_cut functions ...
```

- [ ] **Step 2: Remove from schedules.py and register in app.py**

```python
from routes.schedule_cut import bp as schedule_cut_bp
app.register_blueprint(schedule_cut_bp)
```

- [ ] **Step 3: Run tests and commit**

### Task 2.3: Clean up remaining `routes/schedules.py`

**Files:**
- Modify: `routes/schedules.py`

- [ ] **Step 1: Rename or clean up schedules.py**

After extraction, `routes/schedules.py` only contains these routes:
- `api_history_schedules()`
- `auto_assign_preview()`
- `api_auto_assign()`
- `api_mass_delay()`
- `export_schedules()`

Strip unused imports (`re`, `openpyxl`, `send_file`, `calc_working_minutes`, etc. — keep only what the remaining functions need).

Rename blueprint to reflect its reduced scope (or keep as-is since it's already registered).

- [ ] **Step 2: Run test_all.py and verify all endpoints**

- [ ] **Step 3: Commit**

---

## Phase 3: Split `static/settings.js` (1230行 → 3个文件)

### Task 3.1: Extract save system into `static/save-system.js`

**Files:**
- Create: `static/save-system.js`
- Modify: `static/settings.js:950-1230`
- Modify: `templates/index.html` (add script tag)

- [ ] **Step 1: Create save-system.js**

Extract these functions (lines ~950-1230) from `settings.js`:
- `loadSaveList()`
- `renderDbInfo(dbInfo)`
- `renderDbLocationInfo(info)`
- `renderSaveTable(saves)`
- `_renderSaveGroup(group, isAuto)`
- `quickSave()`
- `loadSave(filename, saveAppMtime)`
- `deleteSave(filename)`
- `downloadSave(filename)`
- `uploadSaveFile(input)`
- `transferDatabase()`
- `switchDatabase()`
- `changeSaveDirectory()`
- `resetDatabase()`

- [ ] **Step 2: Add script tag in index.html**

Insert `<script src="/static/save-system.js"></script>` **after** the settings.js script tag (line ~1136) and **before** app.js (line ~1137).

Load order becomes: `... settings.js → save-system.js → app.js`

- [ ] **Step 3: Adjust settings.js — remove extracted functions**

Delete the save-system functions from `settings.js`. These functions are only called from settings panel UI event handlers, which are all within settings.js or save-system.js — no other files call them.

- [ ] **Step 4: Smoke test**

```bash
python app.py
```
Open settings panel → test quick save, load save, delete save, database transfer, switch, reset.

- [ ] **Step 5: Commit**

### Task 3.2: Extract color management into `static/colors.js`

**Files:**
- Create: `static/colors.js`
- Modify: `static/settings.js:786-949`
- Modify: `templates/index.html`

- [ ] **Step 1: Create colors.js**

Extract these functions from `settings.js`:
- `hexToRgba(hex, alpha)`
- `darkenHex(hex, factor)`
- `_readColorGroup(groupKey)`
- `_saveColorGroup(groupKey, obj)`
- `_getTypeIndex(typeName)`
- `_sanitizeId(name)`
- `applyColorSetting(colorKey, hexValue)`
- `applyTypeColor(typeName, hexValue)`
- `_applyStoredColors()`
- `_populateColorInputs(overlayColors, stateColors, typeColors)`
- `_renderTypeColorInputs(typeColors)`

- [ ] **Step 2: Add script tag**

Insert `<script src="/static/colors.js"></script>` **after** save-system.js and **before** app.js.

Load order: `... settings.js → save-system.js → colors.js → app.js`

- [ ] **Step 3: Verify colors work**

Open settings → color sub-page. Change overlay/state/type colors. Verify timeline block colors update. Refresh page, verify colors persist.

- [ ] **Step 4: Commit**

---

## Phase 4: Split `static/tasks.js` (1506行 → 3个文件)

### Task 4.1: Extract history management into `static/history.js`

**Files:**
- Create: `static/history.js`
- Modify: `static/tasks.js:1093-1375`
- Modify: `templates/index.html`

- [ ] **Step 1: Create history.js**

Extract these functions from `tasks.js`:
- `_loadHistory(dateFrom, dateTo)`
- `_renderHistoryTable(data, mode)`
- `_refreshHistory()`
- `filterHistory()`
- `filterHistoryTable()`
- `delHistorySchedule(sid)`
- `recallHistoryTask(sid)`
- `openHistoryEdit(sid)`
- `closeHistoryEdit()`
- `submitHistoryEdit()`
- `_getHistoryTableId()`
- `switchHistoryMode()`
- `toggleHistoryBatchMode()`
- `toggleHistSelectAll()`
- `updateBatchCount()`
- `_getCheckedHistIds()`
- `batchRecallHistory()`
- `batchDeleteHistory()`

These depend on: `showToast`, `showConfirm`, `escHtml`, `_formatAbsMin`, `_parseTimeStr` (from core.js, loaded before), `_silentRefresh` (from tasks.js, loaded before), and `SCHEDULES_HISTORY`, `SELECTED_DATE` (globals from inline script).

- [ ] **Step 2: Add script tag**

Insert `<script src="/static/history.js"></script>` **after** tasks.js and **before** import-export.js.

Load order: `... tasks.js → history.js → import-export.js → dialogs.js → ...`

- [ ] **Step 3: Fix cross-references**

In `settings.js`, the functions `refreshAfterSettingsChange()` and `openHistoryNameSync()` call `filterHistoryTable()` and `_refreshHistory()` with a `typeof === 'function'` guard — this guard already handles the case where the function doesn't exist yet. Since `settings.js` loads AFTER `history.js`, these calls will work. No changes needed.

- [ ] **Step 4: Delete extracted functions from tasks.js**

- [ ] **Step 5: Smoke test history panel**

Open history panel, load history, filter, batch recall, batch delete, edit history entry.

- [ ] **Step 6: Commit**

### Task 4.2: Extract machine management into `static/machines.js`

**Files:**
- Create: `static/machines.js`
- Modify: `static/tasks.js:77-461`
- Modify: `templates/index.html`

- [ ] **Step 1: Create machines.js**

Extract these functions from `tasks.js`:
- `addMachine()`
- `_appendMachineRow(m)`
- `_syncTimelineMachineRow(m)`
- `onMachineTypeChange()`
- `openBatchMachineDialog()`
- `closeBatchMachineDialog()`
- `_previewBatchMachines()`
- `_parseMachineRange(type, raw)`
- `executeBatchAdd()`
- `saveMachineName(id)`
- `saveAllMachines()`
- `setMachineStatus(id, s)`
- `delMachine(id)`
- `recallMachineTasks(mid)`

Note: `addMachine()` contains an inline `doAdd()` function. Extract it as-is — it's only called from within `addMachine()`.

These depend on: `showToast`, `showConfirm`, `escHtml` (core.js), `_silentRefresh`, `recycleTasks` (tasks.js — still in tasks.js since it's used elsewhere too, keep it there).

- [ ] **Step 2: Add script tag**

Insert `<script src="/static/machines.js"></script>` **after** tasks.js and **before** history.js.

Load order: `... tasks.js → machines.js → history.js → import-export.js → ...`

- [ ] **Step 3: Fix `task-pool.js` reference (from tasks.js)**

After extracting machines and history, `tasks.js` shrinks from 1506 lines to roughly:
- validateShiftFormat, saveShift (~50 lines)
- _silentRefresh, recycleTasks, _refreshTimelineFromServer (~100 lines)
- _getEstMode, toggleEstMode, applyCountQuick, syncCountToExpcnt, previewCalc (~30 lines)
- addTask, doAddTask, delTask, assignTask (~60 lines)
- toggleDurationUnit, _getTaskTableId, switchTaskMode, toggleTaskBatchMode, toggleSelectAll, updateTaskBatchCount, batchAction (~80 lines)
- _buildTaskScheduleMap, _refreshTaskList, _renderTaskTable (~100 lines)
- filterTaskPool, _restorePoolModeState, _enablePoolDrag, _disablePoolDrag, _renderPoolPagination, poolPrevPage, poolNextPage, applyTaskFilters (~120 lines)
- openAssignDialog, closeAssignDialog, openEditDialog, closeEditDialog, toggleEditEstMode, submitEditTask, doSubmitEdit, submitAssign, recallTaskToPool, finishTaskFromList (~180 lines)
- refreshLiveStatus, buildSplitIndex, getSplitConstraint, dateToAbsMin (~150 lines)

Remaining: ~870 lines. Still large but much improved. The remaining code is all task-related (task CRUD, task pool filtering/drag, split constraints, live status).

- [ ] **Step 4: Delete extracted functions from tasks.js**

- [ ] **Step 5: Smoke test machine management**

Open machine panel. Add machine, batch add, rename, change status, delete machine. Verify timeline machine rows update.

- [ ] **Step 6: Commit**

### Task 4.3: Final verification — full regression test

- [ ] **Step 1: Run test_all.py**

```bash
python test_all.py
```
All tests must pass.

- [ ] **Step 2: Manual smoke test checklist**

- [ ] 班次设置: save day/night shifts
- [ ] 机器管理: add/batch add/rename/delete machines
- [ ] 任务库: add/edit/delete/filter tasks, drag to pool, assign to machine
- [ ] 排班面板: drag tasks on timeline, move, resize, complete, recall, cut, undo
- [ ] 历史记录: load history, filter, batch recall/delete, edit history
- [ ] 设置: enum management, UI settings, colors, save/load, database management
- [ ] 对话框: auto assign, mass delay, import, export

- [ ] **Step 3: Commit final state**

```bash
git add -A
git commit -m "refactor: split tasks.js into tasks + machines + history modules"
```

---

## File Structure After Refactoring

```
static/
├── app.js              (118 lines, unchanged)
├── core.js             (679 lines, unchanged)
├── particles.js        (139 lines, unchanged)
├── ribbons.js          (133 lines, unchanged)
├── tasks.js            (1506→~870 lines, task CRUD + pool + split)
├── machines.js         (NEW ~400 lines, machine management)
├── history.js          (NEW ~280 lines, history panel)
├── import-export.js    (372 lines, unchanged)
├── dialogs.js          (787 lines, unchanged)
├── timeline-render.js  (588 lines, unchanged)
├── timeline-drag.js    (516 lines, unchanged)
├── timeline-ops.js     (979 lines, unchanged)
├── timeline.js         (118 lines, unchanged)
├── settings.js         (1230→~650 lines, settings CRUD + UI prefs)
├── save-system.js      (NEW ~280 lines, save/db management)
├── colors.js           (NEW ~160 lines, color management)
├── shift-posts.js      (168 lines, unchanged)

routes/
├── __init__.py
├── views.py
├── machines.py
├── tasks.py
├── schedules.py        (1239→~350 lines, kept: history/auto/export routes)
├── schedule_ops.py     (NEW ~700 lines, core scheduling operations)
├── schedule_cut.py     (NEW ~200 lines, cut/undo operations)
├── settings.py
├── saves.py
├── shift_posts.py

templates/
├── index.html          (1201→~120 lines, layout shell + includes)
├── panels/
│   ├── shifts.html     (NEW)
│   ├── machines.html   (NEW)
│   ├── tasks.html      (NEW)
│   ├── schedule.html   (NEW)
│   ├── history.html    (NEW)
│   └── settings.html   (NEW)
├── dialogs/
│   ├── import.html     (NEW)
│   ├── assign.html     (NEW)
│   ├── edit.html       (NEW)
│   ├── auto_assign.html(NEW)
│   ├── mass_delay.html (NEW)
│   ├── cut.html        (NEW)
│   ├── export_columns.html (NEW)
│   ├── batch_machine.html  (NEW)
│   └── confirm.html    (NEW)
```

---

## Script Load Order (After Refactoring)

```html
<!-- Inline: SELECTED_DATE, schedules, SCHEDULES_HISTORY, SHIFT, APP_CONFIG, TYPE_INDEX_MAP -->
<script src="/static/core.js"></script>
<script src="/static/particles.js"></script>
<script src="/static/ribbons.js"></script>
<script src="/static/tasks.js"></script>
<script src="/static/machines.js"></script>      <!-- NEW: after tasks.js -->
<script src="/static/history.js"></script>       <!-- NEW: after machines.js -->
<script src="/static/import-export.js"></script>
<script src="/static/dialogs.js"></script>
<script src="/static/timeline-render.js"></script>
<script src="/static/timeline-drag.js"></script>
<script src="/static/timeline-ops.js"></script>
<script src="/static/timeline.js"></script>
<script src="/static/settings.js"></script>
<script src="/static/save-system.js"></script>   <!-- NEW: after settings.js -->
<script src="/static/colors.js"></script>        <!-- NEW: after save-system.js -->
<script src="/static/app.js"></script>
<script src="/static/shift-posts.js"></script>
```
