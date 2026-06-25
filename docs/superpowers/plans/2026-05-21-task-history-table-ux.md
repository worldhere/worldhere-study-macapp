# Task & History Table UX Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add search, column sorting, search highlighting, and visual polish to both the task library table and history table, plus redesign the task edit dialog as a side drawer and the history edit dialog as a styled card.

**Architecture:** CSS styles are written first as a shared foundation. Task table HTML/JS and history table HTML/JS are then updated independently, each following the same visual patterns. The task edit drawer replaces the existing `#edit-dialog` in `dialogs/all.html` and is used by both the task library "修改" button and the timeline double-click (`timeline-ops.js:editTask`). No backend changes.

**Tech Stack:** Vanilla JS, Flask/Jinja2 templates, CSS custom properties

**Specs:**
- `docs/superpowers/specs/2026-05-21-task-table-ux-design.md`
- `docs/superpowers/specs/2026-05-21-history-table-ux-design.md`

---

### Task 1: CSS — Search highlight + Sort indicators + Row count

**Files:**
- Modify: `static/style.css` (append)

- [ ] **Step 1: Add search highlight and sort indicator styles**

Append to `static/style.css`:

```css
/* ========== SEARCH HIGHLIGHT ========== */
.search-highlight {
    background: #fde68a;
    color: #1e293b;
    border-radius: 2px;
    padding: 0 1px;
}
[data-theme="dark"] .search-highlight {
    background: #854d0e;
    color: #fef3c7;
}

/* ========== SORT INDICATOR ========== */
.sort-indicator {
    font-size: 10px;
    margin-left: 2px;
    color: var(--primary);
}
th.sortable {
    cursor: pointer;
    user-select: none;
    transition: color var(--transition);
}
th.sortable:hover {
    color: var(--primary);
}

/* ========== ROW COUNT ========== */
.row-count {
    font-size: 12px;
    color: var(--text-muted);
    margin-bottom: 8px;
}
```

- [ ] **Step 2: Commit**

```bash
git add static/style.css
git commit -m "feat: add search highlight, sort indicator, and row count CSS"
```

---

### Task 2: CSS — Filter bar layout

**Files:**
- Modify: `static/style.css` (append)

- [ ] **Step 1: Add filter bar layout styles**

Append to `static/style.css`:

```css
/* ========== FILTER BAR ========== */
.filter-bar {
    display: flex; flex-wrap: wrap; gap: 10px; align-items: center;
    margin-bottom: 8px;
}
.filter-bar .search-input {
    flex: 1;
    min-width: 220px;
    padding: 8px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius-xs);
    font-size: 14px;
    color: var(--text-primary);
    background: var(--bg-card);
}
.filter-bar .search-input:focus {
    outline: none;
    border-color: var(--primary);
    box-shadow: 0 0 0 3px rgba(59,130,246,0.1);
}

/* Collapsed filter toggle */
.filter-toggle {
    padding: 8px 14px;
    font-size: 13px;
    font-weight: 500;
    border: 1px solid var(--border);
    background: var(--bg-card);
    color: var(--text-primary);
    border-radius: var(--radius-xs);
    cursor: pointer;
    white-space: nowrap;
    transition: all var(--transition);
}
.filter-toggle:hover { border-color: var(--primary); color: var(--primary); }
.filter-toggle .badge {
    display: inline-block;
    background: var(--primary);
    color: #fff;
    border-radius: 10px;
    padding: 1px 7px;
    font-size: 11px;
    margin-left: 4px;
}

/* Filter dropdown panel */
.filter-drop-panel {
    display: none;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    padding: 10px 14px;
    background: #f8fafc;
    border: 1px solid var(--border);
    border-radius: var(--radius-xs);
    width: 100%;
}
.filter-drop-panel.open { display: flex; }
[data-theme="dark"] .filter-drop-panel { background: var(--bg-sidebar); }

/* Mode button group */
.mode-btn-group {
    display: inline-flex;
    gap: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-xs);
    overflow: hidden;
}
.mode-btn {
    padding: 7px 16px;
    border: none;
    background: var(--bg-card);
    color: var(--text-secondary);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all var(--transition);
    border-radius: 0;
    margin: 0;
}
.mode-btn.active {
    background: var(--primary);
    color: #fff;
}
.mode-btn:not(.active):hover {
    background: var(--primary-light);
    color: var(--primary);
}
```

- [ ] **Step 2: Commit**

```bash
git add static/style.css
git commit -m "feat: add filter bar layout CSS"
```

---

### Task 3: CSS — Side drawer (task edit)

**Files:**
- Modify: `static/style.css` (append)

- [ ] **Step 1: Add side drawer styles**

Append to `static/style.css`:

```css
/* ========== SIDE DRAWER ========== */
.drawer-overlay {
    position: fixed; inset: 0;
    background: rgba(15,23,42,0.35);
    z-index: 1999;
    animation: fadeIn 0.2s ease;
}
.drawer-panel {
    position: fixed;
    top: 0; right: 0; bottom: 0;
    width: 420px;
    background: var(--bg-card);
    z-index: 2000;
    box-shadow: var(--shadow-xl);
    display: flex;
    flex-direction: column;
    animation: drawerSlideIn 0.2s ease;
}
.drawer-panel.closing {
    animation: drawerSlideOut 0.15s ease forwards;
}
@keyframes drawerSlideIn {
    from { transform: translateX(100%); }
    to { transform: translateX(0); }
}
@keyframes drawerSlideOut {
    from { transform: translateX(0); }
    to { transform: translateX(100%); }
}
.drawer-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 18px 24px;
    border-bottom: 1px solid var(--border-light);
    flex-shrink: 0;
}
.drawer-header h2 {
    font-size: 16px; font-weight: 700;
    display: flex; align-items: center; gap: 8px;
}
.drawer-header .drawer-icon {
    width: 32px; height: 32px;
    background: linear-gradient(135deg, var(--primary), var(--primary-hover));
    border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    color: #fff; font-size: 14px;
}
.drawer-close {
    width: 32px; height: 32px;
    border: none; background: var(--border-light);
    border-radius: 8px; cursor: pointer;
    font-size: 16px; color: var(--text-muted);
    display: flex; align-items: center; justify-content: center;
    transition: all var(--transition);
}
.drawer-close:hover { background: var(--border); color: var(--text-primary); }
.drawer-body {
    flex: 1; overflow-y: auto;
    padding: 20px 24px;
}
.drawer-footer {
    display: flex; gap: 10px; justify-content: flex-end;
    padding: 14px 24px;
    border-top: 1px solid var(--border-light);
    flex-shrink: 0;
}

.drawer-section {
    margin-bottom: 20px;
}
.drawer-section-title {
    font-size: 11px; font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
    margin-bottom: 12px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border-light);
}
.drawer-field {
    display: flex; flex-direction: column; gap: 4px;
    margin-bottom: 12px;
}
.drawer-field label {
    font-size: 12px; font-weight: 600; color: var(--text-secondary);
}
.drawer-field input, .drawer-field select {
    width: 100%;
    padding: 8px 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-xs);
    font-size: 14px; color: var(--text-primary);
    background: var(--bg-card);
}
.drawer-field input:focus, .drawer-field select:focus {
    outline: none;
    border-color: var(--primary);
    box-shadow: 0 0 0 3px rgba(59,130,246,0.1);
}
.drawer-field-row {
    display: flex; gap: 12px;
}
.drawer-field-row .drawer-field { flex: 1; }

.btn-drawer-primary {
    padding: 10px 24px;
    background: linear-gradient(135deg, var(--primary), var(--primary-hover));
    color: #fff; border: none;
    border-radius: var(--radius-xs); font-size: 14px; font-weight: 600;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(59,130,246,0.25);
}
.btn-drawer-primary:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(59,130,246,0.35);
}
.btn-drawer-cancel {
    padding: 10px 24px;
    background: var(--bg-card); color: var(--text-secondary);
    border: 1px solid var(--border);
    border-radius: var(--radius-xs); font-size: 14px; font-weight: 500;
    cursor: pointer;
}
.btn-drawer-cancel:hover { background: var(--border-light); }
```

- [ ] **Step 2: Commit**

```bash
git add static/style.css
git commit -m "feat: add side drawer CSS for task edit panel"
```

---

### Task 4: CSS — History edit dialog card

**Files:**
- Modify: `static/style.css` (append)

- [ ] **Step 1: Add history edit dialog styles**

Append to `static/style.css`:

```css
/* ========== HISTORY EDIT DIALOG ========== */
.hist-dialog-overlay {
    position: fixed; inset: 0;
    background: rgba(15,23,42,0.4);
    backdrop-filter: blur(2px);
    z-index: 2000;
    display: flex; align-items: center; justify-content: center;
    animation: fadeIn 0.2s ease;
}
.hist-dialog-card {
    background: var(--bg-card);
    border-radius: 14px;
    width: 720px;
    max-height: 85vh;
    overflow-y: auto;
    box-shadow: 0 20px 60px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05);
    animation: drawerSlideIn 0.2s ease;
}
.hist-dialog-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 20px 28px 16px;
    border-bottom: 1px solid var(--border-light);
}
.hist-dialog-header h2 {
    font-size: 17px; font-weight: 700;
    display: flex; align-items: center; gap: 10px;
}
.hist-dialog-header .hist-dialog-icon {
    width: 34px; height: 34px;
    background: linear-gradient(135deg, #6366f1, #8b5cf6);
    border-radius: 9px;
    display: flex; align-items: center; justify-content: center;
    color: #fff; font-size: 15px;
}
.hist-dialog-body { padding: 24px 28px; }
.hist-dialog-footer {
    display: flex; gap: 10px; justify-content: flex-end;
    padding: 16px 28px 22px;
    border-top: 1px solid var(--border-light);
}

/* Time range section */
.hist-time-section {
    border: 1px solid var(--border);
    border-radius: 12px;
    overflow: hidden;
    margin-bottom: 8px;
}
.hist-time-section-header {
    background: #f8fafc;
    padding: 14px 20px;
    font-size: 12px; font-weight: 700;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border-bottom: 1px solid var(--border);
}
[data-theme="dark"] .hist-time-section-header { background: var(--bg-sidebar); }
.hist-time-section-body { padding: 20px; }
.hist-time-grid {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: 16px;
    align-items: end;
}
.hist-time-block { display: flex; flex-direction: column; gap: 10px; }
.hist-time-block-label {
    font-size: 13px; font-weight: 600;
    color: var(--text-primary);
}
.hist-time-block-fields { display: flex; gap: 10px; }
.hist-time-block-fields input {
    padding: 9px 14px;
    border: 1px solid var(--border);
    border-radius: 8px;
    font-size: 14px; color: var(--text-primary);
    background: var(--bg-card);
    flex: 1; min-width: 0;
}
.hist-time-block-fields input:focus {
    outline: none;
    border-color: var(--primary);
    box-shadow: 0 0 0 3px rgba(59,130,246,0.1);
}
.hist-time-arrow {
    font-size: 20px; color: var(--text-muted);
    padding-bottom: 10px;
}

/* Collapse toggle */
.hist-collapse-toggle {
    display: flex; align-items: center; gap: 8px;
    width: 100%; padding: 18px 0 0;
    border: none; background: none;
    cursor: pointer;
    font-size: 14px; font-weight: 600;
    color: var(--primary);
}
.hist-collapse-toggle:hover { color: var(--primary-hover); }
.hist-collapse-toggle .arrow {
    transition: transform 0.2s;
    font-size: 12px;
}
.hist-collapse-toggle.open .arrow { transform: rotate(90deg); }

/* More fields section */
.hist-fields-section {
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px;
    margin-top: 18px;
}
.hist-fields-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
}
.hist-field-group { display: flex; flex-direction: column; gap: 5px; }
.hist-field-group label {
    font-size: 12px; font-weight: 600; color: var(--text-secondary);
}
.hist-field-group input, .hist-field-group select {
    padding: 9px 14px;
    border: 1px solid var(--border);
    border-radius: 8px;
    font-size: 14px; color: var(--text-primary);
    background: var(--bg-card);
}
.hist-field-group input:focus, .hist-field-group select:focus {
    outline: none;
    border-color: var(--primary);
    box-shadow: 0 0 0 3px rgba(59,130,246,0.1);
}
```

- [ ] **Step 2: Commit**

```bash
git add static/style.css
git commit -m "feat: add history edit dialog card CSS"
```

---

### Task 5: Task table — Filter bar HTML

**Files:**
- Modify: `templates/panels/tasks.html:58-101`

- [ ] **Step 1: Replace the filter bar and mode controls**

In `templates/panels/tasks.html`, replace lines 58-101 (the second `.box` div's header area, from `<div class="box">` through the batch mode toggle before the table) with:

```html
        <div class="box">
            <!-- Filter bar -->
            <div class="filter-bar">
                <input type="text" id="task-search" class="search-input" placeholder="搜索任务名、机型、类型..." oninput="applyTaskFilters()">
                <button class="filter-toggle" id="task-filter-toggle" onclick="toggleTaskFilterPanel()">
                    筛选条件 <span id="task-filter-badge" class="badge" style="display:none;">0</span>
                </button>
                <button class="btn" style="margin-left:auto;" onclick="document.getElementById('import-file-input').click()">导入Excel</button>
                <input id="import-file-input" type="file" accept=".xlsx,.xls" style="display:none;" onchange="handleImportFile(this)">
            </div>

            <!-- Filter dropdown panel -->
            <div class="filter-drop-panel" id="task-filter-panel">
                <b>显示：</b>
                <select id="task-view" onchange="applyTaskFilters()">
                    <option value="all">全部</option>
                    <option value="assigned">已分配</option>
                    <option value="unassigned">未分配</option>
                </select>
                <b>机型：</b>
                <select id="task-filter-type" onchange="applyTaskFilters()">
                    <option value="">全部</option>
                    {% for mt in app_config.machine_types %}<option value="{{mt.key}}">{{mt.key}}</option>{% endfor %}
                </select>
                <b>任务类型：</b>
                <select id="task-filter-kind" onchange="applyTaskFilters()">
                    <option value="">全部</option>
                    {% for tk in app_config.task_kinds %}<option>{{tk.key}}</option>{% endfor %}
                </select>
                <b>状态：</b>
                <select id="task-filter-status" onchange="applyTaskFilters()">
                    <option value="">全部</option>
                    <option value="待分配">待分配</option>
                    <option value="已分配">已分配</option>
                    <option value="采集中">采集中</option>
                    <option value="采集即将完成">采集即将完成</option>
                    <option value="暂停中">暂停中</option>
                    <option value="暂停即将超时">暂停即将超时</option>
                    <option value="过时待确认">过时待确认</option>
                </select>
                <b>时长：</b>
                <select id="duration-unit" onchange="toggleDurationUnit()">
                    <option value="min">分钟</option>
                    <option value="sec">秒</option>
                    <option value="hour">小时</option>
                </select>
                <label><input type="checkbox" id="show-action-col" checked onchange="applyTaskFilters()"> 显示操作列</label>
            </div>

            <!-- Mode switch + row count -->
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
                <div class="mode-btn-group" id="task-mode-btns">
                    <button class="mode-btn active" data-mode="simple" onclick="switchTaskModeBtn('simple')">简易</button>
                    <button class="mode-btn" data-mode="detail" onclick="switchTaskModeBtn('detail')">详细</button>
                </div>
                <div class="row-count" id="task-row-count">共 0 条任务</div>
                <label style="margin-left:auto;"><input type="checkbox" id="task-batch-mode" onchange="toggleTaskBatchMode()"> 批量操作</label>
                <span id="task-batch-actions" style="display:none;">
                    <button class="btn" onclick="batchAction('recycle')">批量回收</button>
                    <button onclick="batchAction('complete')">批量完成</button>
                    <button class="btn-danger" onclick="batchAction('delete')">批量删除</button>
                    <span id="task-batch-count" style="font-weight:600;">已选 0 项</span>
                </span>
            </div>
```

- [ ] **Step 2: Commit**

```bash
git add templates/panels/tasks.html
git commit -m "feat: restructure task table filter bar with search, collapsible filters, mode buttons"
```

---

### Task 6: Task table — thead/tbody + drawer HTML

**Files:**
- Modify: `templates/panels/tasks.html:112-155`

- [ ] **Step 1: Replace both tables with thead/tbody versions, add drawer HTML**

Replace lines 112-155 (both `<table>` elements and the deletion log panel's `<details>`) with:

```html
            <table id="task-table">
                <thead>
                    <tr>
                        <th class="batch-col" style="display:none;"><input type="checkbox" id="batch-check-all" onchange="toggleSelectAll()"></th>
                        <th class="sortable" data-sort="name">任务名 <span class="sort-indicator"></span></th>
                        <th class="sortable" data-sort="type">机型 <span class="sort-indicator"></span></th>
                        <th class="sortable" data-sort="kind">任务类型 <span class="sort-indicator"></span></th>
                        <th class="sortable" data-sort="pri">优先级 <span class="sort-indicator"></span></th>
                        <th class="sortable" data-sort="diff">难度 <span class="sort-indicator"></span></th>
                        <th class="sortable" data-sort="dur"><span id="dur-header-label">预估时长(分钟)</span> <span class="sort-indicator"></span></th>
                        <th class="sortable" data-sort="status">状态 <span class="sort-indicator"></span></th>
                        <th>分配时段</th>
                        <th class="action-col">操作</th>
                    </tr>
                </thead>
                <tbody></tbody>
            </table>

            <!-- 详细模式表格 -->
            <table id="task-table-detail" style="display:none;">
                <thead>
                    <tr>
                        <th class="batch-col" style="display:none;"><input type="checkbox" id="detail-batch-check-all" onchange="toggleSelectAll()"></th>
                        <th class="sortable" data-sort="name">任务名 <span class="sort-indicator"></span></th>
                        <th class="sortable" data-sort="type">机型 <span class="sort-indicator"></span></th>
                        <th class="sortable" data-sort="pri">优先级 <span class="sort-indicator"></span></th>
                        <th>RBP数采任务ID</th>
                        <th class="sortable" data-sort="status">任务状态 <span class="sort-indicator"></span></th>
                        <th>任务场景</th>
                        <th class="sortable" data-sort="kind">任务类型 <span class="sort-indicator"></span></th>
                        <th>通用任务类别</th>
                        <th>任务来源链接</th>
                        <th>预期采集量/条</th>
                        <th>数采需求ID</th>
                        <th>数采需求类型</th>
                        <th class="action-col">操作</th>
                    </tr>
                </thead>
                <tbody></tbody>
            </table>
```

Then after the detail table, append the side drawer HTML (before `</div></div>`):

```html
            <!-- 任务编辑侧边抽屉 -->
            <div id="task-edit-drawer" style="display:none;">
                <div class="drawer-overlay" onclick="closeEditDrawer()"></div>
                <div class="drawer-panel" id="drawer-panel">
                    <div class="drawer-header">
                        <h2><span class="drawer-icon">&#9998;</span> 修改任务</h2>
                        <button class="drawer-close" onclick="closeEditDrawer()">&times;</button>
                    </div>
                    <div class="drawer-body">
                        <div class="drawer-section">
                            <div class="drawer-section-title">基本字段</div>
                            <div class="drawer-field-row">
                                <div class="drawer-field">
                                    <label>任务名</label>
                                    <input id="ed_name">
                                </div>
                                <div class="drawer-field">
                                    <label>机型</label>
                                    <select id="ed_type">{% for mt in app_config.machine_types %}<option>{{mt.key}}</option>{% endfor %}</select>
                                </div>
                            </div>
                            <div class="drawer-field-row">
                                <div class="drawer-field">
                                    <label>任务类型</label>
                                    <select id="ed_kind">{% for tk in app_config.task_kinds %}<option>{{tk.key}}</option>{% endfor %}</select>
                                </div>
                                <div class="drawer-field">
                                    <label>优先级</label>
                                    <select id="ed_pri">{% for p in app_config.priorities %}<option>{{p.key}}</option>{% endfor %}</select>
                                </div>
                            </div>
                            <div class="drawer-field-row">
                                <div class="drawer-field">
                                    <label>难度</label>
                                    <select id="ed_diff">{% for d in app_config.difficulties %}<option value="{{'' if d.key=='无' else d.key}}">{{d.key}}</option>{% endfor %}</select>
                                </div>
                                <div class="drawer-field">
                                    <label>备注</label>
                                    <input id="ed_remark" placeholder="备注信息">
                                </div>
                            </div>
                        </div>
                        <div class="drawer-section">
                            <div class="drawer-section-title">预估时长</div>
                            <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
                                <label><input type="radio" name="ed_est_mode" value="blank" onchange="toggleEditEstMode()">不填</label>
                                <label><input type="radio" name="ed_est_mode" value="direct" onchange="toggleEditEstMode()">直接预估</label>
                                <label><input type="radio" name="ed_est_mode" value="calc" onchange="toggleEditEstMode()">计算预估</label>
                            </div>
                            <div id="ed-direct" style="display:none;margin-top:8px;">
                                <div class="drawer-field">
                                    <label>时长</label>
                                    <input id="ed_duration" placeholder="如 2h / 90min">
                                </div>
                            </div>
                            <div id="ed-calc" style="display:none;margin-top:8px;">
                                <div class="drawer-field-row">
                                    <div class="drawer-field"><label>操作(秒)</label><input id="ed_op"></div>
                                    <div class="drawer-field"><label>复位(秒)</label><input id="ed_reset"></div>
                                </div>
                                <div class="drawer-field-row">
                                    <div class="drawer-field"><label>条数</label><input id="ed_count" oninput="syncCountToExpcnt('ed_count','ed_expcnt')"></div>
                                    <div class="drawer-field"><label>冗余(分钟)</label><input id="ed_red" value="0"></div>
                                </div>
                            </div>
                        </div>
                        <div class="drawer-section">
                            <div class="drawer-section-title">详细字段</div>
                            <div class="drawer-field-row">
                                <div class="drawer-field"><label>RBP任务ID</label><input id="ed_rbp_id"></div>
                                <div class="drawer-field"><label>场景</label><input id="ed_scene"></div>
                            </div>
                            <div class="drawer-field-row">
                                <div class="drawer-field"><label>通用类别</label><input id="ed_gcat"></div>
                                <div class="drawer-field"><label>来源链接</label><input id="ed_slink" placeholder="http://..."></div>
                            </div>
                            <div class="drawer-field-row">
                                <div class="drawer-field"><label>预期采集量</label><input id="ed_expcnt" type="number" oninput="syncCountToExpcnt('ed_expcnt','ed_count')"></div>
                                <div class="drawer-field"><label>数采需求ID</label><input id="ed_creqid"></div>
                            </div>
                            <div class="drawer-field-row">
                                <div class="drawer-field"><label>数采需求类型</label><input id="ed_creqtype"></div>
                                <div class="drawer-field"></div>
                            </div>
                        </div>
                    </div>
                    <div class="drawer-footer">
                        <button class="btn-drawer-cancel" onclick="closeEditDrawer()">取消</button>
                        <button class="btn-drawer-primary" onclick="submitEditDrawer()">确认修改</button>
                    </div>
                </div>
                <input type="hidden" id="edit-tid">
            </div>
```

Also, add a wrapper div with `overflow-x: auto` around the detail table area. Wrap the detail table in:
```html
            <div style="overflow-x:auto;" id="task-table-detail-wrapper" style="display:none;">
```
And close the `</div>` after the detail table's closing tag.

Then keep the deletion log panel `<details>` that was originally there, unchanged.

- [ ] **Step 2: Commit**

```bash
git add templates/panels/tasks.html
git commit -m "feat: add thead/tbody to task tables, add side drawer HTML for task editing"
```

---

### Task 7: Task table — Search + highlight + sort utilities

**Files:**
- Modify: `static/tasks.js` (add new functions near top of file)

- [ ] **Step 1: Add sort state and helper functions**

Insert after `_silentRefresh` (after line 82) in `static/tasks.js`:

```javascript
// ========== 搜索、排序、高亮 ==========
var taskSortState = { column: null, direction: 0 }; // 0=none, 1=asc, 2=desc
var taskSearchTerm = '';

function _getTaskSearchTerm() {
    var inp = document.getElementById('task-search');
    return inp ? inp.value.trim().toLowerCase() : '';
}

var STATUS_SORT_ORDER = ['待分配','已分配','采集中','采集即将完成','暂停中','暂停即将超时','过时待确认','已完成'];

function _sortTaskRows(tbody, colKey, dir) {
    var rows = Array.from(tbody.querySelectorAll('tr[data-tid]'));
    rows.sort(function(a, b) {
        var av, bv;
        if (colKey === 'dur') {
            av = parseInt(a.dataset.sec, 10) || 0;
            bv = parseInt(b.dataset.sec, 10) || 0;
            return dir === 1 ? av - bv : bv - av;
        }
        if (colKey === 'status') {
            av = (a.querySelector('.task-status-text') || {}).textContent || a.dataset.status || '';
            bv = (b.querySelector('.task-status-text') || {}).textContent || b.dataset.status || '';
            var ai = STATUS_SORT_ORDER.indexOf(av);
            var bi = STATUS_SORT_ORDER.indexOf(bv);
            if (ai === -1) ai = 999;
            if (bi === -1) bi = 999;
            return dir === 1 ? ai - bi : bi - ai;
        }
        if (colKey === 'pri') {
            av = a.dataset.pri || '';
            bv = b.dataset.pri || '';
            return dir === 1 ? av.localeCompare(bv) : bv.localeCompare(av);
        }
        if (colKey === 'diff') {
            av = a.dataset.diff || '';
            bv = b.dataset.diff || '';
            return dir === 1 ? av.localeCompare(bv) : bv.localeCompare(av);
        }
        if (colKey === 'name') {
            av = a.dataset.name || '';
            bv = b.dataset.name || '';
            return dir === 1 ? av.localeCompare(bv) : bv.localeCompare(av);
        }
        if (colKey === 'type') {
            av = a.dataset.type || '';
            bv = b.dataset.type || '';
            return dir === 1 ? av.localeCompare(bv) : bv.localeCompare(av);
        }
        if (colKey === 'kind') {
            av = a.dataset.kind || '';
            bv = b.dataset.kind || '';
            return dir === 1 ? av.localeCompare(bv) : bv.localeCompare(av);
        }
        return 0;
    });
    // Reorder DOM in-place
    rows.forEach(function(r) { tbody.appendChild(r); });
}

function _highlightCell(cell, term) {
    if (!term) {
        // Restore text: remove mark tags
        var marks = cell.querySelectorAll('mark.search-highlight');
        marks.forEach(function(m) {
            m.replaceWith(m.textContent);
        });
        return;
    }
    // Already has marks? restore first
    var marks = cell.querySelectorAll('mark.search-highlight');
    marks.forEach(function(m) {
        m.replaceWith(m.textContent);
    });
    var text = cell.textContent || '';
    var lower = text.toLowerCase();
    var idx = lower.indexOf(term);
    if (idx === -1) return;
    var before = text.slice(0, idx);
    var match = text.slice(idx, idx + term.length);
    var after = text.slice(idx + term.length);
    // Only wrap if the cell only contains text nodes (not buttons/inputs)
    if (cell.querySelector('button, input, select, a')) return;
    cell.textContent = '';
    cell.appendChild(document.createTextNode(before));
    var m = document.createElement('mark');
    m.className = 'search-highlight';
    m.textContent = match;
    cell.appendChild(m);
    cell.appendChild(document.createTextNode(after));
}

function _rowMatchesSearch(tr, term) {
    if (!term) return true;
    var cells = tr.querySelectorAll('td');
    for (var i = 0; i < cells.length; i++) {
        var text = (cells[i].textContent || '').toLowerCase();
        if (text.indexOf(term) !== -1) return true;
    }
    return false;
}
```

- [ ] **Step 2: Add sort header click handler setup**

In the `DOMContentLoaded` handler at the bottom of `tasks.js`, add after the existing initialization:

```javascript
    // 表头排序点击
    document.querySelectorAll('#task-table th.sortable, #task-table-detail th.sortable').forEach(function(th) {
        th.addEventListener('click', function() {
            var col = th.dataset.sort;
            if (taskSortState.column === col) {
                taskSortState.direction = (taskSortState.direction + 1) % 3;
            } else {
                taskSortState.column = col;
                taskSortState.direction = 1;
            }
            _updateSortIndicators();
            applyTaskFilters();
        });
    });
```

- [ ] **Step 3: Add sort indicator update function**

Insert before `applyTaskFilters`:

```javascript
function _updateSortIndicators() {
    document.querySelectorAll('#task-table th.sortable .sort-indicator, #task-table-detail th.sortable .sort-indicator').forEach(function(sp) {
        sp.textContent = '';
    });
    if (taskSortState.direction === 0) return;
    var arrow = taskSortState.direction === 1 ? ' ▲' : ' ▼';
    document.querySelectorAll('#task-table th.sortable[data-sort="' + taskSortState.column + '"] .sort-indicator, #task-table-detail th.sortable[data-sort="' + taskSortState.column + '"] .sort-indicator').forEach(function(sp) {
        sp.textContent = arrow;
    });
}
```

- [ ] **Step 4: Commit**

```bash
git add static/tasks.js
git commit -m "feat: add search, sort, and highlight utility functions for task table"
```

---

### Task 8: Task table — Rewrite applyTaskFilters with search/sort/highlight

**Files:**
- Modify: `static/tasks.js:632-656` (the existing `applyTaskFilters`)

- [ ] **Step 1: Replace `applyTaskFilters` and `_renderTaskTable`**

Replace the existing `applyTaskFilters` function (lines 632-656) with:

```javascript
function applyTaskFilters(){
    var view = document.getElementById('task-view').value;
    var ft = document.getElementById('task-filter-type').value;
    var fk = document.getElementById('task-filter-kind').value;
    var fs = document.getElementById('task-filter-status').value;
    var showActionCol = document.getElementById('show-action-col').checked;
    var searchTerm = _getTaskSearchTerm();
    taskSearchTerm = searchTerm;

    // Update action column visibility
    document.querySelectorAll('#task-table .action-col, #task-table-detail .action-col').forEach(function(th) {
        th.style.display = showActionCol ? '' : 'none';
    });
    document.querySelectorAll('#task-table .action-btns, #task-table-detail .action-btns').forEach(function(td) {
        td.style.display = showActionCol ? '' : 'none';
    });

    var totalVisible = 0;
    [document.querySelector('#task-table tbody'), document.querySelector('#task-table-detail tbody')].forEach(function(tbody) {
        if (!tbody) return;
        var rows = Array.from(tbody.querySelectorAll('tr[data-tid]'));
        if (rows.length === 0) return;

        // Separate: match search vs not
        var matching = [];
        var nonMatching = [];
        rows.forEach(function(tr) {
            var st = tr.dataset.status || '';
            var ty = tr.dataset.type || '';
            var kd = tr.dataset.kind || '';
            var ok = true;
            if (view === 'assigned') ok = ok && (st === '已分配');
            if (view === 'unassigned') ok = ok && (st === '待分配');
            if (ft) ok = ok && (ty === ft);
            if (fk) ok = ok && (kd === fk);
            if (fs) {
                if (fs === '采集中' || fs === '过时待确认' || fs === '采集即将完成' || fs === '暂停中' || fs === '暂停即将超时') {
                    var span = tr.querySelector('.task-status-text');
                    ok = ok && (span && span.textContent.trim() === fs);
                } else {
                    ok = ok && (st === fs);
                }
            }
            if (!ok) { tr.style.display = 'none'; return; }
            var matches = _rowMatchesSearch(tr, searchTerm);
            if (matches) { matching.push(tr); } else { nonMatching.push(tr); }
        });

        // Sort matching rows
        if (taskSortState.direction > 0 && taskSortState.column) {
            _sortTaskRowsInArray(matching, taskSortState.column, taskSortState.direction);
            _sortTaskRowsInArray(nonMatching, taskSortState.column, taskSortState.direction);
        }

        // Append matching first, then non-matching (hide non-matching if search active)
        matching.forEach(function(tr) {
            tbody.appendChild(tr);
            tr.style.display = '';
            if (searchTerm) {
                tr.querySelectorAll('td').forEach(function(td) { _highlightCell(td, searchTerm); });
            }
            totalVisible++;
        });
        nonMatching.forEach(function(tr) {
            tbody.appendChild(tr);
            tr.style.display = searchTerm ? 'none' : '';
            totalVisible++;
        });
    });

    // Update row count
    var totalAll = document.querySelectorAll('#task-table tr[data-tid], #task-table-detail tr[data-tid]').length;
    document.getElementById('task-row-count').textContent = '共 ' + totalAll + ' 条任务，当前筛选显示 ' + totalVisible + ' 条';

    // Update filter badge
    var activeFilters = 0;
    if (view !== 'all') activeFilters++;
    if (ft) activeFilters++;
    if (fk) activeFilters++;
    if (fs) activeFilters++;
    var badge = document.getElementById('task-filter-badge');
    if (activeFilters > 0) {
        badge.textContent = String(activeFilters);
        badge.style.display = '';
    } else {
        badge.style.display = 'none';
    }
}
```

- [ ] **Step 2: Add helper that sorts an array in-place**

Add after `_sortTaskRows`:

```javascript
function _sortTaskRowsInArray(arr, colKey, dir) {
    if (!arr.length || dir === 0 || !colKey) return;
    arr.sort(function(a, b) {
        var av, bv;
        if (colKey === 'dur') {
            av = parseInt(a.dataset.sec, 10) || 0;
            bv = parseInt(b.dataset.sec, 10) || 0;
            return dir === 1 ? av - bv : bv - av;
        }
        if (colKey === 'status') {
            av = (a.querySelector('.task-status-text') || {}).textContent || a.dataset.status || '';
            bv = (b.querySelector('.task-status-text') || {}).textContent || b.dataset.status || '';
            var ai = STATUS_SORT_ORDER.indexOf(av);
            var bi = STATUS_SORT_ORDER.indexOf(bv);
            if (ai === -1) ai = 999;
            if (bi === -1) bi = 999;
            return dir === 1 ? ai - bi : bi - ai;
        }
        if (colKey === 'pri') { av = a.dataset.pri || ''; bv = b.dataset.pri || ''; return dir === 1 ? av.localeCompare(bv) : bv.localeCompare(av); }
        if (colKey === 'diff') { av = a.dataset.diff || ''; bv = b.dataset.diff || ''; return dir === 1 ? av.localeCompare(bv) : bv.localeCompare(av); }
        if (colKey === 'name') { av = a.dataset.name || ''; bv = b.dataset.name || ''; return dir === 1 ? av.localeCompare(bv) : bv.localeCompare(av); }
        if (colKey === 'type') { av = a.dataset.type || ''; bv = b.dataset.type || ''; return dir === 1 ? av.localeCompare(bv) : bv.localeCompare(av); }
        if (colKey === 'kind') { av = a.dataset.kind || ''; bv = b.dataset.kind || ''; return dir === 1 ? av.localeCompare(bv) : bv.localeCompare(av); }
        return 0;
    });
}
```

- [ ] **Step 3: Update `_renderTaskTable` to write to `<tbody>` instead of inserting after header**

In `_renderTaskTable`, change the simple table population (around lines 451-456) from:
```javascript
    var simpleTable = document.getElementById('task-table');
    if(simpleTable){
        var oldRows = simpleTable.querySelectorAll('tr[data-tid]');
        for(var r=0; r<oldRows.length; r++) oldRows[r].remove();
        var headerRow = simpleTable.querySelector('tr');
        if(headerRow) headerRow.insertAdjacentHTML('afterend', simpleHtml);
    }
```
To:
```javascript
    var simpleTbody = document.querySelector('#task-table tbody');
    if(simpleTbody){
        simpleTbody.innerHTML = simpleHtml;
    }
```

And similarly for the detail table (around lines 486-492), change from:
```javascript
    var detailTable = document.getElementById('task-table-detail');
    if(detailTable){
        var oldRows = detailTable.querySelectorAll('tr[data-tid]');
        for(var r=0; r<oldRows.length; r++) oldRows[r].remove();
        var headerRow = detailTable.querySelector('tr');
        if(headerRow) headerRow.insertAdjacentHTML('afterend', detailHtml);
    }
```
To:
```javascript
    var detailTbody = document.querySelector('#task-table-detail tbody');
    if(detailTbody){
        detailTbody.innerHTML = detailHtml;
    }
```

- [ ] **Step 4: Add `toggleTaskFilterPanel` function and `switchTaskModeBtn` function**

Insert near `applyTaskFilters`:

```javascript
function toggleTaskFilterPanel() {
    var panel = document.getElementById('task-filter-panel');
    panel.classList.toggle('open');
}

function switchTaskModeBtn(mode) {
    currentTaskMode = mode;
    document.getElementById('task-table').style.display = mode === 'simple' ? '' : 'none';
    document.getElementById('task-table-detail').style.display = mode === 'detail' ? '' : 'none';
    document.querySelectorAll('#task-mode-btns .mode-btn').forEach(function(b) {
        b.classList.toggle('active', b.dataset.mode === mode);
    });
    if (document.getElementById('task-batch-mode').checked) {
        document.getElementById('task-batch-mode').checked = false;
        toggleTaskBatchMode();
    }
    if (typeof loadDeletionLog === 'function') loadDeletionLog();
    try { localStorage.setItem('taskMode', mode); } catch(e) {}
}
```

- [ ] **Step 5: Remove the old `switchTaskMode` function and the old mode select handler**

Delete `switchTaskMode` (lines 312-321) since `switchTaskModeBtn` replaces it. Also remove the old `onchange="switchTaskMode()"` reference from the HTML (already removed in Task 5).

- [ ] **Step 6: Commit**

```bash
git add static/tasks.js
git commit -m "feat: rewrite applyTaskFilters with search/sort/highlight, update render to use tbody"
```

---

### Task 9: Task table — Side drawer JS (open/close/submit)

**Files:**
- Modify: `static/tasks.js` (replace `openEditDialog`, `closeEditDialog`, `submitEditTask`)

- [ ] **Step 1: Replace `openEditDialog` with drawer version**

Replace `openEditDialog` (lines 717-751) with:

```javascript
function openEditDrawer(tid) {
    var tr = document.querySelector('#task-table tr[data-tid="' + tid + '"]');
    if (!tr) tr = document.querySelector('#task-table-detail tr[data-tid="' + tid + '"]');
    if (!tr) return;
    document.getElementById('edit-tid').value = String(tid);
    document.getElementById('ed_name').value = tr.dataset.name || '';
    document.getElementById('ed_type').value = tr.dataset.type || (APP_CONFIG.machine_types[0] && APP_CONFIG.machine_types[0].key) || '';
    document.getElementById('ed_kind').value = tr.dataset.kind || '常规';
    document.getElementById('ed_pri').value = tr.dataset.pri || 'P1';
    document.getElementById('ed_diff').value = tr.dataset.diff || '普通';
    var estMode = tr.dataset.estmode || 'blank';
    document.querySelector('input[name="ed_est_mode"][value="' + estMode + '"]').checked = true;
    document.getElementById('ed_duration').value = tr.dataset.dur || '';
    document.getElementById('ed_op').value = tr.dataset.op || '';
    document.getElementById('ed_reset').value = tr.dataset.reset || '';
    document.getElementById('ed_count').value = tr.dataset.cnt || '';
    document.getElementById('ed_red').value = tr.dataset.red || '0';
    document.getElementById('ed_remark').value = tr.dataset.remark || '';
    document.getElementById('ed_rbp_id').value = tr.dataset.rbp || '';
    document.getElementById('ed_scene').value = tr.dataset.scene || '';
    document.getElementById('ed_gcat').value = tr.dataset.gcat || '';
    document.getElementById('ed_slink').value = tr.dataset.slink || '';
    document.getElementById('ed_expcnt').value = tr.dataset.expcnt || '';
    document.getElementById('ed_creqid').value = tr.dataset.creqid || '';
    document.getElementById('ed_creqtype').value = tr.dataset.creqtype || '';
    toggleEditEstMode();
    document.getElementById('task-edit-drawer').style.display = 'block';
}

function closeEditDrawer() {
    var panel = document.getElementById('drawer-panel');
    panel.classList.add('closing');
    setTimeout(function() {
        document.getElementById('task-edit-drawer').style.display = 'none';
        panel.classList.remove('closing');
    }, 150);
}

// Keep old function names as aliases for backward compatibility with timeline-ops.js
function openEditDialog(tid) { openEditDrawer(tid); }
function closeEditDialog() { closeEditDrawer(); }
```

- [ ] **Step 2: Update `submitEditTask` → `submitEditDrawer`**

Rename `submitEditTask` to `submitEditDrawer` and add backward compat alias:

```javascript
function submitEditDrawer() {
    var name = (document.getElementById('ed_name').value || '').trim();
    var rbpId = (document.getElementById('ed_rbp_id').value || '').trim();
    if (!name && !rbpId) {
        showToast('任务名和RBP任务ID至少需要填写一个');
        return;
    }
    if (!name && rbpId) {
        showConfirm('修改任务', '<p>任务名为空，将仅使用RBP任务ID作为标识，确认修改？</p>').then(function(ok) {
            if (!ok) return;
            doSubmitEditDrawer();
        });
        return;
    }
    doSubmitEditDrawer();
}

function doSubmitEditDrawer() {
    var tid = parseInt(document.getElementById('edit-tid').value || '0', 10);
    var name = (document.getElementById('ed_name').value || '').trim();
    var mode = (document.querySelector('input[name="ed_est_mode"]:checked') || {}).value || 'blank';
    var taskType = document.getElementById('ed_type').value;
    var taskKind = document.getElementById('ed_kind').value;
    var priority = document.getElementById('ed_pri').value;
    var difficulty = document.getElementById('ed_diff').value;
    var remark = (document.getElementById('ed_remark').value || '').trim();
    var payload = {
        id: tid,
        name: name,
        type: taskType,
        task_kind: taskKind,
        pri: priority,
        diff: difficulty,
        est_mode: mode,
        rbp_task_id: document.getElementById('ed_rbp_id').value.trim(),
        scene: document.getElementById('ed_scene').value.trim(),
        general_category: document.getElementById('ed_gcat').value.trim(),
        source_link: document.getElementById('ed_slink').value.trim(),
        expected_count: parseInt(document.getElementById('ed_expcnt').value || '0', 10) || null,
        collection_req_id: document.getElementById('ed_creqid').value.trim(),
        collection_req_type: document.getElementById('ed_creqtype').value.trim()
    };
    payload.remark = remark;
    if (mode === 'direct') {
        payload.duration = (document.getElementById('ed_duration').value || '').trim();
    } else if (mode === 'calc') {
        payload.op_min = parseInt(document.getElementById('ed_op').value || '0', 10) || 0;
        payload.reset_min = parseInt(document.getElementById('ed_reset').value || '0', 10) || 0;
        payload.collect_count = parseInt(document.getElementById('ed_count').value || '0', 10) || 0;
        payload.redundancy_min = parseInt(document.getElementById('ed_red').value || '0', 10) || 0;
    }
    fetch('/update_task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        .then(function(r) { return r.json(); }).then(function(d) {
            showToast(d.msg);
            closeEditDrawer();
            _silentRefresh();
        });
}

function submitEditTask() { submitEditDrawer(); }
```

- [ ] **Step 3: Update button onclick references in `_renderTaskTable`**

In the simple and detail table row rendering, change `onclick="openEditDialog(` to `onclick="openEditDrawer(`.

- [ ] **Step 4: Remove old edit dialog from dialogs/all.html**

In `templates/dialogs/all.html`, delete lines 75-123 (the `#edit-dialog` div). The drawer is now in `tasks.html`.

- [ ] **Step 5: Commit**

```bash
git add static/tasks.js templates/panels/tasks.html templates/dialogs/all.html
git commit -m "feat: replace task edit dialog with side drawer"
```

---

### Task 10: Timeline — Update editTask for drawer compatibility

**Files:**
- Modify: `static/timeline-ops.js:58-117`

The drawer still uses the same field IDs (`ed_name`, `ed_type`, etc.) and the same `submitEditTask()` alias, so the timeline's `editTask` function works with no changes. Just verify:

- [ ] **Step 1: Verify timeline editTask compatibility**

In `static/timeline-ops.js`, the `editTask` function at line 86 does:
```javascript
var dlg = document.getElementById('edit-dialog');
if(!dlg){ showToast('编辑弹窗未找到'); return; }
```

Since `#edit-dialog` was removed, update this check to use the drawer:

```javascript
var dlg = document.getElementById('task-edit-drawer');
if(!dlg){ showToast('编辑弹窗未找到'); return; }
```

And change line 116 from:
```javascript
dlg.style.display = 'block';
```
To:
```javascript
dlg.style.display = 'block';
```
(The property name is the same, just the element ID changed.)

- [ ] **Step 2: Commit**

```bash
git add static/timeline-ops.js
git commit -m "fix: update timeline editTask to use side drawer instead of old edit-dialog"
```

---

### Task 11: History table — Filter bar HTML

**Files:**
- Modify: `templates/panels/history.html:4-28` (the filter bar area)

- [ ] **Step 1: Replace history filter bar**

Replace lines 4-28 in `templates/panels/history.html` with:

```html
        <div class="box">
            <!-- Filter bar -->
            <div class="filter-bar">
                <input type="text" id="history-search" class="search-input" placeholder="搜索任务名、机器名、类型..." oninput="filterHistoryTable()">
                <button class="filter-toggle" id="history-date-toggle" onclick="toggleHistoryDatePanel()">
                    日期区间 <span id="history-date-badge" class="badge" style="display:none;"></span>
                </button>
                <button class="filter-toggle" id="history-filter-toggle" onclick="toggleHistoryFilterPanel()">
                    筛选条件 <span id="history-filter-badge" class="badge" style="display:none;">0</span>
                </button>
                <div class="mode-btn-group">
                    <button class="mode-btn active" data-mode="simple" onclick="switchHistoryModeBtn('simple')">简易</button>
                    <button class="mode-btn" data-mode="detail" onclick="switchHistoryModeBtn('detail')">详细</button>
                </div>
                <button class="tool-btn export-btn" onclick="exportHistory()">导出Excel</button>
                <button class="btn" onclick="openHistoryNameSync()" title="将历史记录中的类型名称更新为当前设置" style="background:var(--warning);">同步历史名称</button>
            </div>

            <!-- Date range panel -->
            <div class="filter-drop-panel" id="history-date-panel">
                <b>日期区间：</b>
                <input id="history-date-from" type="date" value="{{history_date_from or ''}}" style="width:140px">
                <span>→</span>
                <input id="history-date-to" type="date" value="{{history_date_to or ''}}" style="width:140px">
                <button onclick="document.getElementById('history-date-from').value='';document.getElementById('history-date-to').value='';filterHistory();">清除日期</button>
                <span style="font-size:12px;color:var(--text-muted);">（不选日期则显示最近完成的在前）</span>
            </div>

            <!-- Filter dropdown panel -->
            <div class="filter-drop-panel" id="history-filter-panel">
                <b>机型：</b>
                <select id="history-filter-type" onchange="filterHistoryTable()" style="width:120px">
                    <option value="">全部</option>
                    {% for mt in app_config.machine_types %}<option value="{{mt.key}}">{{mt.key}}</option>{% endfor %}
                </select>
                <b>任务类型：</b>
                <select id="history-filter-kind" onchange="filterHistoryTable()" style="width:120px">
                    <option value="">全部</option>
                    {% for tk in app_config.task_kinds %}<option value="{{tk.key}}">{{tk.key}}</option>{% endfor %}
                </select>
            </div>

            <!-- Row count + batch toggle -->
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
                <div class="row-count" id="history-row-count">共 0 条记录</div>
                <button id="batch-toggle-btn" class="btn" style="margin-left:auto;" onclick="toggleHistoryBatchMode()">批量操作</button>
            </div>
```

- [ ] **Step 2: Commit**

```bash
git add templates/panels/history.html
git commit -m "feat: restructure history filter bar with search, collapsible filters, mode buttons"
```

---

### Task 12: History table — thead/tbody + edit dialog HTML

**Files:**
- Modify: `templates/panels/history.html:31-55`

- [ ] **Step 1: Replace both history tables with thead/tbody versions**

Replace the simple table (lines 31-38) with:

```html
            <table id="history-table">
                <thead>
                    <tr>
                        <th class="hist-batch-col" style="display:none;"><input type="checkbox" id="hist-check-all" onchange="toggleHistSelectAll()"></th>
                        <th class="sortable" data-sort="name">任务 <span class="sort-indicator"></span></th>
                        <th class="sortable" data-sort="machine">机器 <span class="sort-indicator"></span></th>
                        <th>完成时间段</th>
                        <th class="sortable" data-sort="kind">任务类型 <span class="sort-indicator"></span></th>
                        <th>备注</th>
                        <th>维修时长</th>
                        <th id="hist-op-header">操作</th>
                    </tr>
                </thead>
                <tbody></tbody>
            </table>
```

Replace the detail table (lines 40-48) with:

```html
            <table id="history-table-detail" style="display:none;">
                <thead>
                    <tr>
                        <th class="hist-batch-col" style="display:none;"><input type="checkbox" id="hist-check-all-detail" onchange="toggleHistSelectAll()"></th>
                        <th class="sortable" data-sort="name">任务 <span class="sort-indicator"></span></th>
                        <th class="sortable" data-sort="machine">机器 <span class="sort-indicator"></span></th>
                        <th>完成时间段</th>
                        <th class="sortable" data-sort="kind">任务类型 <span class="sort-indicator"></span></th>
                        <th>备注</th>
                        <th>维修时长</th>
                        <th>RBP任务ID</th>
                        <th>场景</th>
                        <th>通用类别</th>
                        <th>来源链接</th>
                        <th>预期采集量</th>
                        <th>数采需求ID</th>
                        <th>数采需求类型</th>
                        <th>维修时间段</th>
                        <th id="hist-op-header-detail">操作</th>
                    </tr>
                </thead>
                <tbody></tbody>
            </table>
```

- [ ] **Step 2: Replace the old history edit dialog with redesigned version**

Replace the old `#history-edit-dialog` in `templates/dialogs/all.html` lines 3-53 with:

```html
<!-- 修改历史记录弹窗 -->
<div id="history-edit-dialog" style="display:none;">
    <div class="hist-dialog-overlay" onclick="closeHistoryEdit()">
        <div class="hist-dialog-card" onclick="event.stopPropagation()">
            <div class="hist-dialog-header">
                <h2><span class="hist-dialog-icon">&#9998;</span> 修改历史记录</h2>
                <button class="drawer-close" onclick="closeHistoryEdit()">&times;</button>
            </div>
            <div class="hist-dialog-body">
                <!-- 时间段区 -->
                <div class="hist-time-section">
                    <div class="hist-time-section-header">实际完成时间段</div>
                    <div class="hist-time-section-body">
                        <div class="hist-time-grid">
                            <div class="hist-time-block">
                                <div class="hist-time-block-label">开始</div>
                                <div class="hist-time-block-fields">
                                    <input type="date" id="he_start_date">
                                    <input type="time" id="he_start_time" value="00:00">
                                </div>
                            </div>
                            <div class="hist-time-arrow">→</div>
                            <div class="hist-time-block">
                                <div class="hist-time-block-label">结束</div>
                                <div class="hist-time-block-fields">
                                    <input type="date" id="he_end_date">
                                    <input type="time" id="he_end_time" value="00:00">
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 更多字段 -->
                <button class="hist-collapse-toggle" onclick="toggleHistMoreFields(this)">
                    <span class="arrow">▶</span> 更多字段
                </button>
                <div class="hist-fields-section" id="hist-more-fields" style="display:none;">
                    <div class="hist-fields-grid">
                        <div class="hist-field-group">
                            <label>任务名</label>
                            <input id="he_task_name">
                        </div>
                        <div class="hist-field-group">
                            <label>机型</label>
                            <select id="he_type">{% for mt in app_config.machine_types %}<option>{{mt.key}}</option>{% endfor %}</select>
                        </div>
                        <div class="hist-field-group">
                            <label>任务类型</label>
                            <select id="he_kind">{% for tk in app_config.task_kinds %}<option>{{tk.key}}</option>{% endfor %}</select>
                        </div>
                        <div class="hist-field-group">
                            <label>维修时长</label>
                            <input id="he_repair_dur" placeholder="如 30min">
                        </div>
                        <div class="hist-field-group" style="grid-column:1/-1;">
                            <label>备注</label>
                            <input id="he_remark" placeholder="备注信息">
                        </div>
                    </div>
                </div>
            </div>
            <div class="hist-dialog-footer">
                <button class="btn-drawer-cancel" onclick="closeHistoryEdit()">取消</button>
                <button class="btn-drawer-primary" onclick="submitHistoryEdit()">保存修改</button>
            </div>
        </div>
    </div>
    <input type="hidden" id="he-sid">
</div>
```

- [ ] **Step 3: Commit**

```bash
git add templates/panels/history.html templates/dialogs/all.html
git commit -m "feat: add thead/tbody to history tables, redesign history edit dialog as card"
```

---

### Task 13: History table — Search + highlight + sort + filter panel JS

**Files:**
- Modify: `static/history.js` (add new functions)

- [ ] **Step 1: Add history sort state, toggle functions, and helpers**

Insert at the top of `static/history.js` (after line 1):

```javascript
// ========== 搜索、排序、折叠面板 ==========
var histSortState = { column: null, direction: 0 };
var histSearchTerm = '';

function toggleHistoryDatePanel() {
    var panel = document.getElementById('history-date-panel');
    panel.classList.toggle('open');
    var badge = document.getElementById('history-date-badge');
    var from = document.getElementById('history-date-from').value;
    var to = document.getElementById('history-date-to').value;
    if (from || to) {
        badge.textContent = '●';
        badge.style.display = '';
    } else {
        badge.style.display = 'none';
    }
}

function toggleHistoryFilterPanel() {
    var panel = document.getElementById('history-filter-panel');
    panel.classList.toggle('open');
}

function toggleHistMoreFields(btn) {
    btn.classList.toggle('open');
    var arrow = btn.querySelector('.arrow');
    var body = document.getElementById('hist-more-fields');
    var isOpen = body.style.display !== 'none';
    if (isOpen) {
        body.style.display = 'none';
        arrow.innerHTML = '▶';
        btn.classList.remove('open');
    } else {
        body.style.display = 'block';
        arrow.innerHTML = '▼';
        btn.classList.add('open');
    }
}

function _rowMatchesHistorySearch(tr, term) {
    if (!term) return true;
    var cells = tr.querySelectorAll('td');
    for (var i = 0; i < cells.length; i++) {
        var text = (cells[i].textContent || '').toLowerCase();
        if (text.indexOf(term) !== -1) return true;
    }
    return false;
}

function _highlightHistoryCell(cell, term) {
    if (!term) {
        cell.querySelectorAll('mark.search-highlight').forEach(function(m) { m.replaceWith(m.textContent); });
        return;
    }
    cell.querySelectorAll('mark.search-highlight').forEach(function(m) { m.replaceWith(m.textContent); });
    var text = cell.textContent || '';
    var lower = text.toLowerCase();
    var idx = lower.indexOf(term);
    if (idx === -1) return;
    if (cell.querySelector('button, input, select, a')) return;
    var before = text.slice(0, idx);
    var match = text.slice(idx, idx + term.length);
    var after = text.slice(idx + term.length);
    cell.textContent = '';
    cell.appendChild(document.createTextNode(before));
    var m = document.createElement('mark');
    m.className = 'search-highlight';
    m.textContent = match;
    cell.appendChild(m);
    cell.appendChild(document.createTextNode(after));
}

function _sortHistoryRows(arr, colKey, dir) {
    if (!arr.length || dir === 0 || !colKey) return;
    arr.sort(function(a, b) {
        var av, bv;
        if (colKey === 'name') {
            av = (a.querySelector('td:first-child') || {}).textContent || '';
            bv = (b.querySelector('td:first-child') || {}).textContent || '';
        } else if (colKey === 'machine') {
            av = (a.querySelectorAll('td')[1] || {}).textContent || '';
            bv = (b.querySelectorAll('td')[1] || {}).textContent || '';
        } else if (colKey === 'kind') {
            av = (a.querySelectorAll('td')[3] || {}).textContent || '';
            bv = (b.querySelectorAll('td')[3] || {}).textContent || '';
        } else {
            av = a.dataset[colKey] || '';
            bv = b.dataset[colKey] || '';
        }
        if (typeof av === 'string') {
            return dir === 1 ? av.localeCompare(bv) : bv.localeCompare(av);
        }
        return dir === 1 ? av - bv : bv - av;
    });
}

function switchHistoryModeBtn(mode) {
    currentHistoryMode = mode;
    document.getElementById('history-table').style.display = mode === 'simple' ? '' : 'none';
    document.getElementById('history-table-detail').style.display = mode === 'detail' ? '' : 'none';
    document.querySelectorAll('#history-filter-bar .mode-btn, .mode-btn-group .mode-btn').forEach(function(b) {
        b.classList.toggle('active', b.dataset.mode === mode);
    });
    if (histBatchMode) {
        document.getElementById('batch-toggle-btn').textContent = '批量操作';
        document.getElementById('history-batch-actions').style.display = 'none';
        histBatchMode = false;
    }
    try { localStorage.setItem('historyMode', mode); } catch(e) {}
}
```

- [ ] **Step 2: Add sort header click handlers to DOMContentLoaded**

In the DOMContentLoaded handler at the bottom of `history.js`, add:

```javascript
    document.querySelectorAll('#history-table th.sortable, #history-table-detail th.sortable').forEach(function(th) {
        th.addEventListener('click', function() {
            var col = th.dataset.sort;
            if (histSortState.column === col) {
                histSortState.direction = (histSortState.direction + 1) % 3;
            } else {
                histSortState.column = col;
                histSortState.direction = 1;
            }
            _updateHistSortIndicators();
            filterHistoryTable();
        });
    });
```

And add the indicator update function before `filterHistoryTable`:

```javascript
function _updateHistSortIndicators() {
    document.querySelectorAll('#history-table th.sortable .sort-indicator, #history-table-detail th.sortable .sort-indicator').forEach(function(sp) {
        sp.textContent = '';
    });
    if (histSortState.direction === 0) return;
    var arrow = histSortState.direction === 1 ? ' ▲' : ' ▼';
    document.querySelectorAll('#history-table th.sortable[data-sort="' + histSortState.column + '"] .sort-indicator, #history-table-detail th.sortable[data-sort="' + histSortState.column + '"] .sort-indicator').forEach(function(sp) {
        sp.textContent = arrow;
    });
}
```

- [ ] **Step 3: Commit**

```bash
git add static/history.js
git commit -m "feat: add search, sort, highlight, and filter panel functions for history table"
```

---

### Task 14: History table — Rewrite filterHistoryTable + update render

**Files:**
- Modify: `static/history.js` (replace `filterHistoryTable` and update `_renderHistoryTable`)

- [ ] **Step 1: Replace `filterHistoryTable` with search/sort/highlight version**

Replace `filterHistoryTable` (lines 79-103) with:

```javascript
function filterHistoryTable() {
    var ft = document.getElementById('history-filter-type').value;
    var fk = document.getElementById('history-filter-kind').value;
    var from = document.getElementById('history-date-from').value;
    var to = document.getElementById('history-date-to').value;
    var filterEndMs = to ? new Date(to + 'T00:00:00').getTime() + 86400000 : Infinity;
    var filterStartMs = from ? new Date(from + 'T00:00:00').getTime() : -Infinity;
    var searchTerm = (document.getElementById('history-search').value || '').trim().toLowerCase();
    histSearchTerm = searchTerm;

    var totalVisible = 0;
    [document.querySelector('#history-table tbody'), document.querySelector('#history-table-detail tbody')].forEach(function(tbody) {
        if (!tbody) return;
        var rows = Array.from(tbody.querySelectorAll('tr[data-hid]'));
        if (rows.length === 0) return;

        var matching = [];
        var nonMatching = [];
        rows.forEach(function(tr) {
            var ty = tr.dataset.type || '';
            var kd = tr.dataset.kind || '';
            var ok = true;
            if (ft) ok = ok && (ty === ft);
            if (fk) ok = ok && (kd === fk);
            if (ok && (from || to)) {
                var d = tr.dataset.date;
                var sm = parseInt(tr.dataset.start, 10) || 0;
                var em = parseInt(tr.dataset.end, 10) || 0;
                var baseMs = new Date(d + 'T00:00:00').getTime();
                var taskEndMs = baseMs + em * 60000;
                var taskStartMs = baseMs + sm * 60000;
                ok = taskStartMs < filterEndMs && taskEndMs > filterStartMs;
            }
            if (!ok) { tr.style.display = 'none'; return; }
            var matches = _rowMatchesHistorySearch(tr, searchTerm);
            if (matches) { matching.push(tr); } else { nonMatching.push(tr); }
        });

        if (histSortState.direction > 0 && histSortState.column) {
            _sortHistoryRows(matching, histSortState.column, histSortState.direction);
            _sortHistoryRows(nonMatching, histSortState.column, histSortState.direction);
        }

        matching.forEach(function(tr) {
            tbody.appendChild(tr);
            tr.style.display = '';
            if (searchTerm) {
                tr.querySelectorAll('td').forEach(function(td) { _highlightHistoryCell(td, searchTerm); });
            }
            totalVisible++;
        });
        nonMatching.forEach(function(tr) {
            tbody.appendChild(tr);
            tr.style.display = searchTerm ? 'none' : '';
            totalVisible++;
        });
    });

    // Row count
    var totalAll = document.querySelectorAll('#history-table tr[data-hid], #history-table-detail tr[data-hid]').length;
    document.getElementById('history-row-count').textContent = '共 ' + totalAll + ' 条记录，当前筛选显示 ' + totalVisible + ' 条';

    // Filter badge
    var activeFilters = 0;
    if (ft) activeFilters++;
    if (fk) activeFilters++;
    var badge = document.getElementById('history-filter-badge');
    if (activeFilters > 0) {
        badge.textContent = String(activeFilters);
        badge.style.display = '';
    } else {
        badge.style.display = 'none';
    }
}
```

- [ ] **Step 2: Update `_renderHistoryTable` to write to `<tbody>`**

In `_renderHistoryTable`, change the table population logic. Replace the current `table.innerHTML = headerHTML + bodyHTML;` (line 60) with header-only and write body to tbody:

Replace lines 19-62 of `_renderHistoryTable` with:

```javascript
function _renderHistoryTable(data, mode) {
    var id = mode === 'detail' ? 'history-table-detail' : 'history-table';
    var table = document.getElementById(id);
    if (!table) return;
    var isDetail = mode === 'detail';
    var tbody = table.querySelector('tbody');
    if (!tbody) return;

    var bodyHTML = '';
    for (var i = 0; i < data.length; i++) {
        var s = data[i];
        var hasRepair = (s.repair_periods && s.repair_periods.length > 0) ? '1' : '0';
        bodyHTML += '<tr data-hid="' + s.id + '" data-type="' + escHtml(s.task_type) + '" data-kind="' + escHtml(s.task_kind) + '" data-date="' + escHtml(s.date) + '" data-start="' + s.start_min + '" data-end="' + s.end_min + '" data-has-repair="' + hasRepair + '">' +
            '<td class="hist-batch-col" style="display:none;"><input type="checkbox" class="hist-check" data-hid="' + s.id + '"></td>' +
            '<td>' + escHtml(s.task_name) + '(' + escHtml(s.task_type) + '/' + escHtml(s.task_kind) + ')</td>' +
            '<td>' + escHtml(s.machine_name) + '</td>' +
            '<td>' + escHtml(s.date) + ' ' + escHtml(s.start_str) + '-' + escHtml(s.end_str) + '</td>' +
            '<td>' + escHtml(s.task_kind || '') + '</td>' +
            '<td>' + (s.remark || '') + '</td>' +
            '<td>' + (s.repair_duration || '') + '</td>';
        if (isDetail) {
            bodyHTML += '<td>' + (s.rbp_task_id || '') + '</td>' +
                '<td>' + (s.scene || '') + '</td>' +
                '<td>' + (s.general_category || '') + '</td>' +
                '<td>' + (s.source_link ? '<a href="' + escHtml(s.source_link) + '" target="_blank" style="color:#1976d2;">链接</a>' : '') + '</td>' +
                '<td>' + (s.expected_count || '') + '</td>' +
                '<td>' + (s.collection_req_id || '') + '</td>' +
                '<td>' + (s.collection_req_type || '') + '</td>' +
                '<td>' + (s.repair_periods_str || '') + '</td>';
        }
        bodyHTML += '<td class="hist-op-cell">' +
            '<button class="btn" onclick="openHistoryEdit(' + s.id + ')">修改</button>' +
            '<button class="btn-danger" onclick="delHistorySchedule(' + s.id + ')">删除</button>' +
            '<button onclick="recallHistoryTask(' + s.id + ')">回收</button>' +
            '</td></tr>';
    }
    tbody.innerHTML = bodyHTML;
    tbody.querySelectorAll('.hist-check').forEach(function(c) { c.addEventListener('change', updateBatchCount); });
    filterHistoryTable();
}
```

- [ ] **Step 3: Commit**

```bash
git add static/history.js
git commit -m "feat: rewrite history filterHistoryTable with search/sort/highlight, update render to use tbody"
```

---

### Task 15: History table — Edit dialog JS

**Files:**
- Modify: `static/history.js` (update `openHistoryEdit`, `closeHistoryEdit`, `submitHistoryEdit`)

- [ ] **Step 1: Update `openHistoryEdit` to populate more fields**

Replace `openHistoryEdit` (lines 120-143) with:

```javascript
function openHistoryEdit(sid) {
    var s = null;
    try { s = SCHEDULES_HISTORY.find(function(item) { return item.id === sid; }); } catch(e) {}
    if (!s) return;
    document.getElementById('he-sid').value = String(sid);
    // Time range
    var startParsed = _parseTimeStr(s.start_str || _formatAbsMin(s.start_min));
    document.getElementById('he_start_date').value = s.date || '';
    document.getElementById('he_start_time').value = startParsed ? String(Math.floor(startParsed.min / 60)).padStart(2, '0') + ':' + String(startParsed.min % 60).padStart(2, '0') : '00:00';
    var endParsed = _parseTimeStr(s.end_str || _formatAbsMin(Math.min(MAX_ABS_MIN, s.end_min)));
    document.getElementById('he_end_time').value = endParsed ? String(Math.floor(endParsed.min / 60)).padStart(2, '0') + ':' + String(endParsed.min % 60).padStart(2, '0') : '00:00';
    if (endParsed && endParsed.dayOff !== 0) {
        document.getElementById('he_end_date').value = _dateAddDays(s.date, endParsed.dayOff);
    } else if (endParsed && endParsed.min < (startParsed ? startParsed.min : 0) && endParsed.dayOff === 0) {
        document.getElementById('he_end_date').value = _dateAddDays(s.date, 1);
    } else {
        document.getElementById('he_end_date').value = s.date || '';
    }
    // More fields
    document.getElementById('he_task_name').value = s.task_name || '';
    document.getElementById('he_type').value = s.task_type || '';
    document.getElementById('he_kind').value = s.task_kind || '';
    document.getElementById('he_repair_dur').value = s.repair_duration || '';
    document.getElementById('he_remark').value = s.remark || '';
    // Collapse more fields by default
    var fieldsDiv = document.getElementById('hist-more-fields');
    var toggleBtn = document.querySelector('.hist-collapse-toggle');
    if (fieldsDiv) fieldsDiv.style.display = 'none';
    if (toggleBtn) {
        toggleBtn.classList.remove('open');
        toggleBtn.querySelector('.arrow').innerHTML = '▶';
    }
    document.getElementById('history-edit-dialog').style.display = 'block';
}
```

- [ ] **Step 2: Update `closeHistoryEdit`**

```javascript
function closeHistoryEdit() {
    document.getElementById('history-edit-dialog').style.display = 'none';
}
```
(No change needed — already works with the new HTML structure since it just hides the outer div.)

- [ ] **Step 3: Update `submitHistoryEdit` to include more fields**

Replace `submitHistoryEdit` (lines 148-171) with:

```javascript
function submitHistoryEdit() {
    var sid = parseInt(document.getElementById('he-sid').value || '0', 10);
    var startDate = document.getElementById('he_start_date').value;
    var startTime = document.getElementById('he_start_time').value.trim();
    var endDate = document.getElementById('he_end_date').value;
    var endTime = document.getElementById('he_end_time').value.trim();
    if (!sid || !startDate || !startTime || !endDate || !endTime) { showToast('参数不完整'); return; }
    var sm = hhmmToMin(startTime);
    var em = hhmmToMin(endTime);
    if (sm === null || em === null) { showToast('时间格式错误（HH:MM）'); return; }
    var endMin = em;
    var dayDiff = Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000);
    if (dayDiff > 0) { endMin = em + dayDiff * MINS_PER_DAY; }
    endMin = Math.max(sm + 1, Math.min(MAX_VIEW_SPAN, endMin));

    // Collect more-field data for payload
    var payload = {
        date: startDate,
        schedule_id: sid,
        start_min: sm,
        end_min: endMin
    };

    var taskName = document.getElementById('he_task_name').value.trim();
    var taskType = document.getElementById('he_type').value;
    var taskKind = document.getElementById('he_kind').value;
    var repairDur = document.getElementById('he_repair_dur').value.trim();
    var remark = document.getElementById('he_remark').value.trim();
    if (taskName) payload.task_name = taskName;
    if (taskType) payload.task_type = taskType;
    if (taskKind) payload.task_kind = taskKind;
    if (repairDur) payload.repair_duration = repairDur;
    if (remark) payload.remark = remark;

    fetch('/update_task_bounds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    }).then(function(r) { return r.json(); }).then(function(d) {
        showToast(d.msg || '已修改');
        closeHistoryEdit();
        _refreshHistory();
    });
}
```

- [ ] **Step 4: Commit**

```bash
git add static/history.js
git commit -m "feat: update history edit dialog JS with more fields and new styling"
```

---

## Self-Review

**Spec coverage check:**
- Task spec §1 (Filter bar): Tasks 5, 7, 8 ✓
- Task spec §2 (Table): Tasks 6, 7, 8 ✓
- Task spec §3 (Drawer): Tasks 3, 6, 9, 10 ✓
- History spec §1 (Filter bar): Tasks 11, 13, 14 ✓
- History spec §2 (Table): Tasks 12, 13, 14 ✓
- History spec §3 (Edit dialog): Tasks 4, 12, 15 ✓

**Placeholder scan:** No TBD, TODO, or vague instructions. All code is concrete.

**Type consistency:** 
- `currentTaskMode` used in both old code and new `switchTaskModeBtn` ✓
- `currentHistoryMode` used in both old code and new `switchHistoryModeBtn` ✓
- Field IDs preserved: `ed_name`, `ed_type`, etc. ✓
- `he_start_date`, `he_end_date`, `he_start_time`, `he_end_time`, `he-sid` kept same ✓
- `submitEditTask()` kept as alias for `submitEditDrawer()` ✓
- `openEditDialog` kept as alias for `openEditDrawer` ✓
