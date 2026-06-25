# 导出列选择弹窗重构 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构导出 Excel 列选择弹窗：左右分栏 UI、新增 6 个字段、分组折叠、toggle 开关、拖拽排序、搜索过滤、两套默认预设。

**Architecture:** 纯前端 JS 驱动（`timeline-ops.js`），HTML 弹窗骨架（`dialogs/all.html`），后端补 SQL 字段 + `ALL_COLUMNS`（`routes/schedules.py`）。localStorage 持久化格式不变。

**Tech Stack:** Vanilla JS, Python Flask, SQLite, openpyxl

**Spec:** `docs/superpowers/specs/2026-06-11-export-dialog-redesign.md`

---

## 文件结构

| 文件 | 职责 | 改动类型 |
|------|------|----------|
| `routes/schedules.py:207-308` | SQL SELECT + ALL_COLUMNS + 字段格式化 | 修改 |
| `templates/dialogs/all.html:486-506` | 弹窗 HTML 骨架（左右双栏） | 重写 |
| `static/timeline-ops.js:367-537` | EXPORT_COLUMNS 常量、渲染、交互、持久化 | 重写 |

---

### Task 1: 后端 — 补全 SQL 字段 + ALL_COLUMNS

**文件:** `routes/schedules.py`

- [ ] **Step 1: 更新 SQL SELECT 查询**

将 `export_schedules()` 中的 SQL（第 207-216 行）替换为包含新字段的版本：

```python
sql = """
    SELECT s.id, s.date, s.machine_id, s.machine_name, s.task_name, s.task_type, s.task_kind,
           s.start_min, s.end_min, s.duration, s.status, s.remark,
           s.completed_at, s.actual_start_min, s.actual_end_min,
           s.estimated_window,
           t.rbp_task_id, t.priority, t.difficulty, t.scene,
           t.general_category, t.source_link, t.expected_count,
           t.collection_req_id, t.collection_req_type, t.est_mode,
           t.package_id
    FROM schedules s
    LEFT JOIN tasks t ON s.task_id = t.id
    WHERE s.status=?
"""
```

- [ ] **Step 2: 更新 ALL_COLUMNS 列表**

删除旧版第 280-308 行的 `ALL_COLUMNS`，替换为新版（含分组排序和新增 6 列）：

```python
EST_MODE_LABELS = {"blank": "不填", "direct": "直接预估", "calc": "计算预估"}

ALL_COLUMNS = [
    # === 基本信息（7列）===
    ("date",            "排班日期",     lambda r: r["date"] or ""),
    ("completed_at",    "完成时间",     lambda r: r["completed_at"] or ""),
    ("task_name",       "任务名称",     lambda r: r["task_name"]),
    ("machine_name",    "机器名称",     lambda r: r["machine_name"]),
    ("task_type",       "机型",         lambda r: r["task_type"]),
    ("task_kind",       "任务类型",     lambda r: r["task_kind"]),
    ("status",          "状态",         lambda r: status_map.get(r["status"], r["status"])),
    # === 时间与时长（9列）===
    ("start_time",      "开始时间",     lambda r: abs_min_to_datetime(int(r["start_min"]), r["date"])),
    ("end_time",        "结束时间",     lambda r: abs_min_to_datetime(int(r["end_min"]), r["date"])),
    ("actual_start",    "实际开始",
     lambda r: abs_min_to_datetime(int(r["actual_start_min"]), r["date"]) if r["actual_start_min"] is not None else ""),
    ("actual_end",      "实际结束",
     lambda r: abs_min_to_datetime(int(r["actual_end_min"]), r["date"]) if r["actual_end_min"] is not None else ""),
    ("duration",        "预估时长",     lambda r: r["duration"] or ""),
    ("elapsed",         "排班时长",
     lambda r: format_elapsed(max(0, int(r["end_min"]) - int(r["start_min"])))),
    ("working",         "工作时长",
     lambda r: format_elapsed(calc_working_minutes(
         int(r["start_min"]), int(r["end_min"]), r["date"], shift_config))),
    ("est_mode",        "预估模式",
     lambda r: EST_MODE_LABELS.get(r["est_mode"], r["est_mode"] or "不填")),
    ("est_window",      "预估窗口",     lambda r: r["estimated_window"] or ""),
    # === 任务详情（11列）===
    ("priority",        "优先级",       lambda r: r["priority"] or ""),
    ("difficulty",      "难度",         lambda r: r["difficulty"] or ""),
    ("rbp_task_id",     "RBP数采任务ID", lambda r: r["rbp_task_id"] or ""),
    ("scene",           "场景",         lambda r: r["scene"] or ""),
    ("general_category","通用类别",     lambda r: r["general_category"] or ""),
    ("source_link",     "来源链接",     lambda r: r["source_link"] or ""),
    ("expected_count",  "预期采集量",
     lambda r: str(r["expected_count"]) if r["expected_count"] is not None else ""),
    ("collection_req_id","数采需求ID",  lambda r: r["collection_req_id"] or ""),
    ("collection_req_type","数采需求类型", lambda r: r["collection_req_type"] or ""),
    ("remark",          "备注",         lambda r: r["remark"] or ""),
    ("package_name",    "所属任务包",
     lambda r: _export_package_names.get(r["package_id"], "")),
    # === 维修相关（2列）===
    ("repair_duration", "维修时长",
     lambda r: repair_data_map.get(int(r["id"]), {}).get("duration", "")),
    ("repair_periods",  "维修时间段",
     lambda r: repair_data_map.get(int(r["id"]), {}).get("periods", "")),
]
```

- [ ] **Step 3: 在 repair_data_map 构建之前添加 package 名称映射**

在 `repair_data_map = {}` 之后、`for r in rows:` 之前插入：

```python
# 构建 package_id -> package_name 映射
_export_package_names = {}
if rows:
    pkg_ids = set()
    for r in rows:
        pid = r["package_id"]
        if pid is not None:
            pkg_ids.add(int(pid))
    if pkg_ids:
        placeholders = ",".join("?" * len(pkg_ids))
        pkg_rows = conn.execute(
            f"SELECT id, name FROM task_packages WHERE id IN ({placeholders})",
            list(pkg_ids),
        ).fetchall()
        for pr in pkg_rows:
            _export_package_names[int(pr["id"])] = pr["name"] or ""
```

- [ ] **Step 4: 验证后端**

启动 Flask 应用，在浏览器打开排班页面，点击导出 Excel，确认生成的 xlsx 包含新列且数据正确。

- [ ] **Step 5: Commit**

```bash
git add routes/schedules.py
git commit -m "feat: add 6 new export columns (date, actual times, est mode, est window, package name)"
```

---

### Task 2: 前端 — 更新 EXPORT_COLUMNS 常量

**文件:** `static/timeline-ops.js`

- [ ] **Step 1: 替换 EXPORT_COLUMNS 常量**

删除旧版第 368-392 行的 `EXPORT_COLUMNS`，替换为含分组信息的新版：

```javascript
const EXPORT_COLUMNS = [
    // === 基本信息（7列）===
    {key: "date",            label: "排班日期",     group: "基本信息"},
    {key: "completed_at",    label: "完成时间",     group: "基本信息"},
    {key: "task_name",       label: "任务名称",     group: "基本信息"},
    {key: "machine_name",    label: "机器名称",     group: "基本信息"},
    {key: "task_type",       label: "机型",         group: "基本信息"},
    {key: "task_kind",       label: "任务类型",     group: "基本信息"},
    {key: "status",          label: "状态",         group: "基本信息"},
    // === 时间与时长（9列）===
    {key: "start_time",      label: "开始时间",     group: "时间与时长"},
    {key: "end_time",        label: "结束时间",     group: "时间与时长"},
    {key: "actual_start",    label: "实际开始",     group: "时间与时长"},
    {key: "actual_end",      label: "实际结束",     group: "时间与时长"},
    {key: "duration",        label: "预估时长",     group: "时间与时长"},
    {key: "elapsed",         label: "排班时长",     group: "时间与时长"},
    {key: "working",         label: "工作时长",     group: "时间与时长"},
    {key: "est_mode",        label: "预估模式",     group: "时间与时长"},
    {key: "est_window",      label: "预估窗口",     group: "时间与时长"},
    // === 任务详情（11列）===
    {key: "priority",        label: "优先级",       group: "任务详情"},
    {key: "difficulty",      label: "难度",         group: "任务详情"},
    {key: "rbp_task_id",     label: "RBP数采任务ID", group: "任务详情"},
    {key: "scene",           label: "场景",         group: "任务详情"},
    {key: "general_category",label: "通用类别",     group: "任务详情"},
    {key: "source_link",     label: "来源链接",     group: "任务详情"},
    {key: "expected_count",  label: "预期采集量",   group: "任务详情"},
    {key: "collection_req_id",label: "数采需求ID",  group: "任务详情"},
    {key: "collection_req_type",label: "数采需求类型", group: "任务详情"},
    {key: "remark",          label: "备注",         group: "任务详情"},
    {key: "package_name",    label: "所属任务包",   group: "任务详情"},
    // === 维修相关（2列）===
    {key: "repair_duration", label: "维修时长",     group: "维修相关"},
    {key: "repair_periods",  label: "维修时间段",   group: "维修相关"},
];

// 默认勾选预设：执行中
const EXPORT_DEFAULTS_EXECUTING = new Set([
    "task_name","task_kind","machine_name","task_type","priority",
    "difficulty","date","start_time","end_time","duration","status"
]);

// 默认勾选预设：已完成（状态默认关）
const EXPORT_DEFAULTS_COMPLETED = new Set([
    "task_name","task_kind","machine_name","task_type","priority",
    "difficulty","date","completed_at","start_time","end_time",
    "elapsed","remark"
]);
```

- [ ] **Step 2: Commit**

```bash
git add static/timeline-ops.js
git commit -m "feat: update EXPORT_COLUMNS with 29 fields, 4 groups, default presets"
```

---

### Task 3: 前端 — 重写弹窗 HTML 骨架

**文件:** `templates/dialogs/all.html`

- [ ] **Step 1: 替换弹窗 HTML**

将第 486-506 行替换为左右分栏结构：

```html
<!-- 导出列选择弹窗 -->
<div id="export-columns-dialog" class="confirm-overlay" style="display:none;">
    <div class="confirm-box" style="max-width:850px;">
        <div class="confirm-header">
            <span id="export-columns-title">选择导出列</span>
            <button class="confirm-close" onclick="closeExportColumnsDialog()">×</button>
        </div>
        <div class="confirm-body" style="max-height:65vh;overflow:hidden;padding:0;">
            <div style="display:flex;min-height:400px;">
                <!-- 左侧：列池 -->
                <div style="flex:6;padding:14px;border-right:1px solid var(--border);overflow-y:auto;max-height:65vh;">
                    <input id="export-column-search" placeholder="🔍 搜索列名..." style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:8px;font-size:12px;box-sizing:border-box;margin-bottom:10px;" oninput="_filterExportColumns()">
                    <div style="margin-bottom:10px;display:flex;gap:8px;font-size:12px;">
                        <span style="cursor:pointer;color:var(--primary);font-weight:500;" onclick="toggleAllExportColumns(true)">全选</span>
                        <span style="cursor:pointer;color:var(--primary);font-weight:500;" onclick="toggleAllExportColumns(false)">取消全选</span>
                        <span style="cursor:pointer;color:var(--primary);font-weight:500;" onclick="resetDefaultExportColumns()">恢复默认</span>
                    </div>
                    <div id="export-columns-left"></div>
                </div>
                <!-- 右侧：已选排序 -->
                <div style="flex:4;padding:14px;background:var(--bg-body);overflow-y:auto;max-height:65vh;" id="export-columns-right-container">
                    <div style="font-weight:600;font-size:13px;margin-bottom:4px;display:flex;align-items:center;justify-content:space-between;">
                        <span>✅ 已选列 · 拖拽排序</span>
                        <span style="font-size:11px;color:var(--text-muted);" id="export-selected-count">0 列</span>
                    </div>
                    <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px;">拖拽 ⠿ 调整顺序，✕ 移除</div>
                    <div id="export-columns-right"></div>
                    <div id="export-columns-empty" style="padding:20px 12px;border-radius:6px;border:1.5px dashed var(--border);text-align:center;font-size:12px;color:var(--text-muted);display:none;">
                        在左侧勾选列添加到此处
                    </div>
                </div>
            </div>
        </div>
        <div class="confirm-footer">
            <button class="btn confirm-cancel" onclick="closeExportColumnsDialog()">取消</button>
            <button class="btn confirm-ok" onclick="executeExport()">确认导出</button>
        </div>
    </div>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add templates/dialogs/all.html
git commit -m "feat: rewrite export dialog HTML with left-right two-column layout"
```

---

### Task 4: 前端 — 重写渲染逻辑

**文件:** `static/timeline-ops.js`

- [ ] **Step 1: 添加分组辅助函数**

在 `EXPORT_COLUMNS` 定义之后、`let _exportColumns` 之前添加：

```javascript
// 从 EXPORT_COLUMNS 提取分组列表（保持声明顺序）
function _getExportGroups() {
    const groups = [];
    const seen = new Set();
    for (const col of EXPORT_COLUMNS) {
        if (!seen.has(col.group)) {
            seen.add(col.group);
            groups.push(col.group);
        }
    }
    return groups;
}
```

- [ ] **Step 2: 重写 _loadExportColumns 兼容旧数据**

替换 `_loadExportColumns`（第 398-418 行）：

```javascript
function _loadExportColumns() {
    let order = null, checked = null;
    try { order = JSON.parse(localStorage.getItem('exportColumnsOrder')); } catch(e) {}
    try { checked = JSON.parse(localStorage.getItem('exportColumnsChecked')); } catch(e) {}

    // 确定默认勾选：根据当前导出状态
    const status = _currentExportStatus || 'completed';
    const defaultSet = status === 'executing' ? EXPORT_DEFAULTS_EXECUTING : EXPORT_DEFAULTS_COMPLETED;

    const result = [];
    const keySet = new Set();

    // 先按保存的顺序
    if (Array.isArray(order)) {
        for (const k of order) {
            const def = EXPORT_COLUMNS.find(c => c.key === k);
            if (def) {
                let ck;
                if (checked && k in checked) {
                    ck = !!checked[k];
                } else {
                    // 新字段无历史 → 用默认预设
                    ck = defaultSet.has(k);
                }
                result.push({key: def.key, label: def.label, group: def.group, checked: ck});
                keySet.add(k);
            }
        }
    }
    // 补上没在保存顺序中的列
    for (const def of EXPORT_COLUMNS) {
        if (!keySet.has(def.key)) {
            let ck;
            if (checked && def.key in checked) {
                ck = !!checked[def.key];
            } else {
                ck = defaultSet.has(def.key);
            }
            result.push({key: def.key, label: def.label, group: def.group, checked: ck});
        }
    }
    return result;
}
```

- [ ] **Step 3: 重写 _renderExportColumnList 为左右分栏**

替换 `_renderExportColumnList`（第 428-472 行）：

```javascript
function _renderExportColumnList() {
    const searchTerm = (document.getElementById('export-column-search')?.value || '').toLowerCase();

    // === 渲染左侧：分组列池 ===
    const leftEl = document.getElementById('export-columns-left');
    if (!leftEl) return;
    leftEl.innerHTML = '';

    const groups = _getExportGroups();
    for (const group of groups) {
        const groupCols = _exportColumns.filter(c => c.group === group);
        // 搜索模式下过滤
        const visibleCols = searchTerm
            ? groupCols.filter(c => c.label.toLowerCase().includes(searchTerm))
            : groupCols;

        if (visibleCols.length === 0) continue;

        // 分组标题
        const groupDiv = document.createElement('div');
        groupDiv.style.marginBottom = '8px';

        const allChecked = visibleCols.every(c => c.checked);
        const anyChecked = visibleCols.some(c => c.checked);

        const header = document.createElement('div');
        header.style.cssText = 'font-weight:600;font-size:13px;padding:6px 0;cursor:pointer;display:flex;align-items:center;gap:4px;';
        header.innerHTML = '<span style="font-size:10px;">▼</span> ' + group +
            ' <span style="font-size:10px;color:var(--text-muted);">(' + groupCols.filter(c => c.checked).length + '/' + groupCols.length + ')</span>';
        header.onclick = function() {
            const body = this.nextElementSibling;
            if (body) {
                const arrow = this.querySelector('span');
                body.style.display = body.style.display === 'none' ? '' : 'none';
                arrow.textContent = body.style.display === 'none' ? '▶' : '▼';
            }
            // 记住折叠状态
            try { localStorage.setItem('export_group_' + group, body.style.display === 'none' ? '1' : '0'); } catch(e) {}
        };
        groupDiv.appendChild(header);

        const body = document.createElement('div');
        body.style.paddingLeft = '4px';
        // 恢复折叠状态
        try {
            if (localStorage.getItem('export_group_' + group) === '1') {
                body.style.display = 'none';
                header.querySelector('span').textContent = '▶';
            }
        } catch(e) {}

        for (const col of visibleCols) {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:7px 12px;margin:3px 0;border-radius:10px;font-size:13px;' +
                (col.checked
                    ? 'background:#eff6ff;border:1.5px solid #bfdbfe;'
                    : 'background:var(--bg-card);border:1px solid var(--border);');

            const label = document.createElement('span');
            label.style.flex = '1';
            label.textContent = col.label;
            row.appendChild(label);

            // Toggle 开关
            const toggle = document.createElement('div');
            toggle.style.cssText = 'width:38px;height:22px;border-radius:11px;position:relative;cursor:pointer;flex-shrink:0;' +
                (col.checked ? 'background:var(--primary);' : 'background:#cbd5e1;');
            toggle.onclick = function(e) {
                e.stopPropagation();
                col.checked = !col.checked;
                _renderExportColumnList();
            };

            const knob = document.createElement('div');
            knob.style.cssText = 'width:18px;height:18px;background:white;border-radius:50%;position:absolute;top:2px;' +
                (col.checked ? 'right:2px;' : 'left:2px;') +
                'box-shadow:0 1px 3px rgba(0,0,0,' + (col.checked ? '0.15);' : '0.1);');
            toggle.appendChild(knob);
            row.appendChild(toggle);

            body.appendChild(row);
        }
        groupDiv.appendChild(body);
        leftEl.appendChild(groupDiv);
    }

    // === 渲染右侧：已选列排序 ===
    const rightEl = document.getElementById('export-columns-right');
    const emptyEl = document.getElementById('export-columns-empty');
    const countEl = document.getElementById('export-selected-count');
    if (!rightEl) return;

    const selected = _exportColumns.filter(c => c.checked);
    if (countEl) countEl.textContent = selected.length + ' 列';

    if (selected.length === 0) {
        rightEl.innerHTML = '';
        if (emptyEl) emptyEl.style.display = '';
    } else {
        if (emptyEl) emptyEl.style.display = 'none';
        rightEl.innerHTML = '';
        for (let i = 0; i < selected.length; i++) {
            const col = selected[i];
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 10px;margin:3px 0;border-radius:6px;font-size:13px;background:var(--bg-card);border-left:3px solid var(--primary);border-top:1px solid var(--border);border-right:1px solid var(--border);border-bottom:1px solid var(--border);';
            row.draggable = true;
            row.setAttribute('data-col-key', col.key);

            const handle = document.createElement('span');
            handle.style.cssText = 'cursor:grab;color:#cbd5e1;font-size:14px;';
            handle.textContent = '⠿';
            row.appendChild(handle);

            const label = document.createElement('span');
            label.style.flex = '1';
            label.textContent = col.label;
            row.appendChild(label);

            const removeBtn = document.createElement('span');
            removeBtn.style.cssText = 'cursor:pointer;color:var(--text-muted);font-size:16px;';
            removeBtn.textContent = '✕';
            removeBtn.title = '移除';
            removeBtn.onclick = function(e) {
                e.stopPropagation();
                col.checked = false;
                _renderExportColumnList();
            };
            row.appendChild(removeBtn);

            // Drag events
            row.addEventListener('dragstart', function(e) {
                _exportDragIdx = i;
                e.dataTransfer.effectAllowed = 'move';
                row.style.opacity = '0.4';
            });
            row.addEventListener('dragend', function(e) {
                row.style.opacity = '1';
                _exportDragIdx = -1;
            });
            row.addEventListener('dragover', function(e) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                row.style.borderTop = '2px solid var(--accent)';
            });
            row.addEventListener('dragleave', function(e) {
                row.style.borderTop = '1px solid var(--border)';
            });
            row.addEventListener('drop', function(e) {
                e.preventDefault();
                row.style.borderTop = '1px solid var(--border)';
                const fromIdx = _exportDragIdx;
                const toIdx = i;
                if (fromIdx >= 0 && fromIdx !== toIdx) {
                    // 重新排列 selected 在原数组中的顺序
                    const fromKey = selected[fromIdx].key;
                    const toKey = selected[toIdx].key;
                    const fromGlobalIdx = _exportColumns.findIndex(c => c.key === fromKey);
                    const toGlobalIdx = _exportColumns.findIndex(c => c.key === toKey);
                    if (fromGlobalIdx >= 0 && toGlobalIdx >= 0) {
                        const [moved] = _exportColumns.splice(fromGlobalIdx, 1);
                        const newToIdx = _exportColumns.findIndex(c => c.key === toKey);
                        _exportColumns.splice(newToIdx, 0, moved);
                        _renderExportColumnList();
                    }
                }
                _exportDragIdx = -1;
            });

            rightEl.appendChild(row);
        }
    }
}
```

- [ ] **Step 4: 更新 _onColCheck（不再需要，被 toggle 替代）**

删除 `_onColCheck` 函数（第 474-478 行），功能已内联到 toggle onclick 中。

- [ ] **Step 5: 添加搜索过滤函数**

在 `_onColCheck` 删除后添加：

```javascript
function _filterExportColumns() {
    _renderExportColumnList();
}
```

- [ ] **Step 6: 更新 openExportColumnsDialog**

替换 `openExportColumnsDialog`（第 480-485 行）：

```javascript
function openExportColumnsDialog(status) {
    _currentExportStatus = status || 'completed';
    _exportColumns = _loadExportColumns();
    _renderExportColumnList();
    document.getElementById('export-columns-dialog').style.display = 'flex';
    // 清空搜索
    const searchInput = document.getElementById('export-column-search');
    if (searchInput) searchInput.value = '';
    // 更新标题
    const title = document.getElementById('export-columns-title');
    if (title) title.textContent = (status === 'executing') ? '导出排班执行中 — 选择列' : '导出已完成排班 — 选择列';
}
```

- [ ] **Step 7: 更新 resetDefaultExportColumns**

替换 `resetDefaultExportColumns`（第 496-499 行）：

```javascript
function resetDefaultExportColumns() {
    const status = _currentExportStatus || 'completed';
    const defaultSet = status === 'executing' ? EXPORT_DEFAULTS_EXECUTING : EXPORT_DEFAULTS_COMPLETED;
    _exportColumns = EXPORT_COLUMNS.map(function(def) {
        return {key: def.key, label: def.label, group: def.group, checked: defaultSet.has(def.key)};
    });
    _renderExportColumnList();
    showToast('已恢复默认');
}
```

- [ ] **Step 8: 更新 executeExport 中的 _saveExportColumns**

确认 `executeExport` 中的 `_saveExportColumns`（第 420-426 行）仍正常工作——逻辑未变，只是 `_exportColumns` 结构多了 `group` 字段。

```javascript
function _saveExportColumns() {
    const order = _exportColumns.map(c => c.key);
    const checked = {};
    _exportColumns.forEach(c => { checked[c.key] = c.checked; });
    try { localStorage.setItem('exportColumnsOrder', JSON.stringify(order)); } catch(e) {}
    try { localStorage.setItem('exportColumnsChecked', JSON.stringify(checked)); } catch(e) {}
}
```

- [ ] **Step 9: Commit**

```bash
git add static/timeline-ops.js
git commit -m "feat: rewrite export dialog rendering with left-right panel, toggle, drag, search, groups"
```

---

### Task 5: 验证与测试

- [ ] **Step 1: 启动应用验证弹窗 UI**

```bash
python app.py
```

打开 `http://localhost:5000`，验证：
1. 点击工具栏「导出Excel」→ 弹窗 850px 左右分栏
2. 左侧分组折叠/展开正常
3. Toggle 开关切换，右侧同步增减
4. 右侧拖拽排序，✕ 移除
5. 搜索过滤正常
6. 「恢复默认」按钮恢复当前模式的默认预设
7. 点击「确认导出」→ 下载 xlsx 包含新列

- [ ] **Step 2: 验证执行中导出默认勾选**

首次打开（清除 localStorage），工具栏导出应默认勾选 11 列：
任务名称、任务类型、机器名称、机型、优先级、难度、排班日期、开始时间、结束时间、预估时长、状态

- [ ] **Step 3: 验证已完成导出默认勾选**

切换到历史面板，导出 Excel，应默认勾选 12 列（状态默认关，有完成时间、排班时长、备注）。

- [ ] **Step 4: 验证 localStorage 持久化**

改动勾选和排序后关闭弹窗，再次打开应保持修改。清除 localStorage 后恢复默认预设。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: verify export dialog UI, defaults, persistence all working"
```

---

### 完成检查

- [ ] Task 1: 后端 SQL + ALL_COLUMNS ✅
- [ ] Task 2: EXPORT_COLUMNS 常量 ✅
- [ ] Task 3: 弹窗 HTML ✅
- [ ] Task 4: 渲染逻辑 ✅
- [ ] Task 5: 验证测试 ✅
