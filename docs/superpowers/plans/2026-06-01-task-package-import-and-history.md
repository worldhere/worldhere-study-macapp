# 任务包导入优化 & 历史记录任务包模块 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 三个独立优化：任务包导入默认P1优先级、导入预览展示勾选表格、历史记录新增已完成任务包卡片面板

**Architecture:** 三处改动互不耦合，由简到繁依次实现。后端改 `import_utils.py`（P1默认）+ `models.py`/`routes/tasks.py`（已完成包查询），前端改 `task-edit.js`（导入勾选表格）+ `history.js`+`history.html`（卡片面板），全部复用现有 CSS

**Tech Stack:** Python Flask + SQLite + Vanilla JS

**Spec:** `docs/superpowers/specs/2026-06-01-task-package-import-and-history-design.md`

---

## 文件结构

| 文件 | 职责 | 本次改动 |
|------|------|----------|
| `import_utils.py` | Excel 解析 + 导入分析 + 执行 | 改 `execute_import`: priority 默认 P1 |
| `models.py` | 数据访问层 | 改 `list_task_packages`: 支持 completed_only 过滤 |
| `routes/tasks.py` | 任务/任务包 API | 改 `api_task_packages`: 支持 `?completed=true` |
| `static/task-edit.js` | 任务包编辑/导入对话框 | 改 `_showPkgImportDialog`: 展示勾选表格 |
| `static/history.js` | 历史记录面板逻辑 | 新增加载/渲染已完成任务包函数 |
| `templates/panels/history.html` | 历史记录面板 HTML | 新增 `#history-packages-section` |
| `static/components.css` | 全局样式 | **不改**（全部复用） |

---

### Task 1: 任务包导入默认 P1 优先级

**Files:**
- Modify: `import_utils.py:501-502`

- [ ] **Step 1: 修改 execute_import 中的 priority 取值逻辑**

将 `import_utils.py` 第 502 行：
```python
_safe_str(item.get("priority")),
```
替换为：
```python
_safe_str(item.get("priority")) or ("P1" if package_name else ""),
```

完整上下文（第 497-503 行）：
```python
"VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
(
    name,
    row_type,
    task_kind,
    _safe_str(item.get("priority")) or ("P1" if package_name else ""),
    difficulty_str,
    duration_str,
```

- [ ] **Step 2: 验证**

启动应用，用任务包导入一个不含 priority 列的 Excel，检查入库后任务优先级是否为 P1。用普通导入同样不含 priority 列，检查是否为空白（不变）。

- [ ] **Step 3: Commit**

```bash
git add import_utils.py
git commit -m "fix: default priority to P1 when importing tasks into a package

When package_name is provided, tasks without an explicit priority
now default to 'P1'. Regular imports (no package_name) are unchanged.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: 任务包导入预览展示勾选表格

**Files:**
- Modify: `static/task-edit.js:799-846` (`_showPkgImportDialog`)

**问题：** 当前单工作表导入只用 `showConfirm` 弹窗，对 `d.items` 做 `filter(status==='ok')` 静默丢弃 confirm 项。需改为和普通导入（`import-export.js:renderImportPreview`）一样的勾选表格。

- [ ] **Step 1: 重写 `_showPkgImportDialog`，加入 items 勾选表格**

替换 `static/task-edit.js` 第 799-846 行的 `_showPkgImportDialog` 函数：

```javascript
function _showPkgImportDialog(file, d) {
    var pkgName = d.package_name || '';
    var sheets = d.sheets || [];
    var activeSheet = d.active_sheet || '';
    var items = d.items || [];

    var html = '<div style="text-align:left;max-height:65vh;overflow-y:auto;">';

    // 工作表选择器
    if (sheets.length > 1) {
        html += '<div style="margin-bottom:8px;"><b>工作表：</b><select id="pkg-import-sheet" style="width:100%" onchange="_onPkgImportSheetChange(this.value)">';
        for (var i = 0; i < sheets.length; i++) {
            html += '<option value="' + escHtml(sheets[i]) + '"' + (sheets[i] === activeSheet ? ' selected' : '') + '>' + escHtml(sheets[i]) + '</option>';
        }
        html += '</select></div>';
    }

    // 任务包名称 + 截止时间 + 机型
    html += '<div style="margin-bottom:8px;"><b>任务包名称：</b><input id="pkg-import-name" style="width:100%" value="' + escHtml(pkgName) + '" placeholder="输入任务包名称"></div>';
    if (d.package_deadline) {
        html += '<div style="margin-bottom:8px;"><b>截止时间：</b><input id="pkg-import-deadline" type="date" style="width:100%" value="' + escHtml(d.package_deadline) + '"></div>';
    } else {
        html += '<div style="margin-bottom:8px;"><b>截止时间：</b><input id="pkg-import-deadline" type="date" style="width:100%"></div>';
    }
    html += '<div style="margin-bottom:8px;"><b>机型：</b><select id="pkg-import-machine-type" style="width:100%">';
    var mtypes = (APP_CONFIG && APP_CONFIG.machine_types) ? APP_CONFIG.machine_types : [];
    mtypes.forEach(function(mt) {
        html += '<option value="' + escHtml(mt.key) + '"' + (mt.key === 'BR2' ? ' selected' : '') + '>' + escHtml(mt.key) + '</option>';
    });
    html += '</select></div>';

    // 统计摘要
    var okCount = d.ok_count || 0;
    var rbpDupCount = d.rbp_dup_count || 0;
    var nameTypeDupCount = d.name_type_dup_count || 0;
    html += '<div style="margin-bottom:8px;font-size:12px;">';
    html += '共 <b>' + d.valid_items + '</b> 条 | ';
    html += '<span style="color:#67c23a;">可导入 ' + okCount + '</span> | ';
    html += '<span style="color:#f56c6c;">ID重复 ' + rbpDupCount + '</span> | ';
    html += '<span style="color:#e6a23c;">疑似重复 ' + nameTypeDupCount + '</span>';
    html += '</div>';

    // 全选/取消按钮
    html += '<div style="margin-bottom:6px;display:flex;gap:10px;">';
    html += '<button type="button" class="tool-btn" onclick="var cbs=document.querySelectorAll(\'.pkg-import-item-check\');cbs.forEach(function(cb){cb.checked=!cb.disabled;});">全选</button>';
    html += '<button type="button" onclick="var cbs=document.querySelectorAll(\'.pkg-import-item-check\');cbs.forEach(function(cb){cb.checked=false;});">取消全选</button>';
    html += '<button type="button" onclick="var cbs=document.querySelectorAll(\'.pkg-import-item-check\');cbs.forEach(function(cb){cb.checked=cb.dataset.status===\'ok\'||cb.dataset.status===\'confirm\';});">仅选可导入</button>';
    html += '</div>';

    // Items 勾选表格
    html += '<div style="max-height:300px;overflow-y:auto;border:1px solid var(--border);border-radius:4px;">';
    html += '<table style="font-size:12px;width:100%;border-collapse:collapse;">';
    html += '<thead><tr style="position:sticky;top:0;background:var(--bg-card);">';
    html += '<th style="padding:6px;">导入</th><th style="padding:6px;text-align:left;">任务名</th><th style="padding:6px;">机型</th><th style="padding:6px;">任务类型</th><th style="padding:6px;">优先级</th><th style="padding:6px;">预估时长</th><th style="padding:6px;">状态</th><th style="padding:6px;text-align:left;">提示</th>';
    html += '</tr></thead><tbody>';

    items.forEach(function(it, i) {
        var statusText = '', statusColor = '', rowBg = '';
        var checked = false;
        var disabled = false;

        if (it.status === 'ok') {
            statusText = '可导入'; statusColor = '#67c23a';
            checked = true;
        } else if (it.status === 'rejected') {
            statusText = 'ID重复'; statusColor = '#f56c6c';
            rowBg = 'background:#fef0f0;';
            checked = false;
            disabled = true;
        } else if (it.status === 'confirm') {
            statusText = '疑似重复'; statusColor = '#e6a23c';
            rowBg = 'background:#fdf6ec;';
            checked = true;
        }

        html += '<tr style="border-bottom:1px solid var(--border-light);' + rowBg + '">';
        html += '<td style="padding:4px;text-align:center;"><input type="checkbox" class="pkg-import-item-check" data-idx="' + i + '" data-status="' + escHtml(it.status) + '"' + (checked ? ' checked' : '') + (disabled ? ' disabled' : '') + '></td>';
        html += '<td style="padding:4px;">' + escHtml(it.name) + '</td>';
        html += '<td style="padding:4px;text-align:center;">' + escHtml(it.type) + '</td>';
        html += '<td style="padding:4px;text-align:center;">' + escHtml(it.task_kind) + '</td>';
        html += '<td style="padding:4px;text-align:center;">' + escHtml(it.priority) + '</td>';
        html += '<td style="padding:4px;text-align:center;">' + escHtml(it.duration) + '</td>';
        html += '<td style="padding:4px;text-align:center;color:' + statusColor + ';font-weight:600;">' + statusText + '</td>';
        html += '<td style="padding:4px;color:#e6a23c;font-size:11px;">' + (it.warnings || []).join('; ') + '</td>';
        html += '</tr>';
    });

    html += '</tbody></table></div>';
    html += '</div>';

    window._pkgImportFile = file;

    showConfirm('导入任务包', html).then(function(ok) {
        if (!ok) { window._pkgImportFile = null; return; }
        var finalName = (document.getElementById('pkg-import-name').value || '').trim() || '未命名任务包';
        var finalDeadline = document.getElementById('pkg-import-deadline').value || null;
        var finalMachineType = document.getElementById('pkg-import-machine-type').value || 'BR2';

        // 收集被勾选的 items
        var selected = [];
        document.querySelectorAll('.pkg-import-item-check:checked').forEach(function(cb) {
            var idx = parseInt(cb.dataset.idx, 10);
            if (!isNaN(idx) && items[idx]) {
                selected.push(items[idx]);
            }
        });

        if (selected.length === 0) { showToast('没有勾选任何任务'); return; }

        fetch('/import_task_package/execute', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                items: selected,
                package_name: finalName,
                package_deadline: finalDeadline,
                machine_type: finalMachineType,
            })
        }).then(function(r) { return r.json(); }).then(function(res) {
            showToast(res.msg);
            _silentRefresh();
        });
        window._pkgImportFile = null;
    });
}
```

- [ ] **Step 2: 同样修复批量导入中的 confirm 项处理**

在 `static/task-edit.js` 第 912 行，当前代码：
```javascript
var items = (r.items || []).filter(function(it) { return it.status === 'ok' || it.status === 'confirm'; });
```
保持这行不变——批量导入已经正确包含了 confirm 项。但检查一下：批量导入在 `_showPkgBulkImportDialog` 中，confirm 项现在应该被默认勾选。当前批量导入对整个 sheet 是全选/取消，没有逐项勾选。保持现有行为即可——用户选整个 sheet，confirm 项一并导入。

- [ ] **Step 3: 验证**

用含重复任务的 Excel 导入任务包：检查 rejected 项默认不勾选、confirm 项默认勾选黄色高亮、ok 项默认勾选。只勾选部分项提交，确认只有勾选的被导入。

- [ ] **Step 4: Commit**

```bash
git add static/task-edit.js
git commit -m "feat: show checkbox table in package import preview for duplicate filtering

Replaced silent status-based filtering with a per-item checkbox table
matching the regular import dialog. ok/confirm items checked by default,
rejected items unchecked and disabled.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: 后端——已完成任务包查询 API

**Files:**
- Modify: `models.py:305-327` (`list_task_packages`)
- Modify: `routes/tasks.py:517-520` (`api_task_packages`)

- [ ] **Step 1: 给 `list_task_packages` 增加 `completed_only` 参数**

修改 `models.py` 第 305-327 行：

```python
def list_task_packages(completed_only: bool = False) -> List[Dict]:
    """返回所有任务包，附带已分配/已完成/总数统计。
    当 completed_only=True 时，只返回全部任务均完成的包。"""
    conn = get_db()
    if completed_only:
        packages = conn.execute(
            """SELECT id, name, deadline, priority, machine_type, created_at FROM task_packages p
               WHERE (SELECT COUNT(*) FROM tasks WHERE package_id=p.id) > 0
                 AND (SELECT COUNT(*) FROM tasks WHERE package_id=p.id)
                   = (SELECT COUNT(*) FROM tasks WHERE package_id=p.id AND status='已完成')
               ORDER BY id DESC"""
        ).fetchall()
    else:
        packages = conn.execute(
            "SELECT id, name, deadline, priority, machine_type, created_at FROM task_packages ORDER BY id DESC"
        ).fetchall()
    result = []
    for p in packages:
        pid = int(p["id"])
        total = conn.execute("SELECT COUNT(*) AS c FROM tasks WHERE package_id=?", (pid,)).fetchone()["c"]
        completed = conn.execute(
            "SELECT COUNT(*) AS c FROM tasks WHERE package_id=? AND status='已完成'", (pid,)
        ).fetchone()["c"]
        assigned = conn.execute(
            "SELECT COUNT(*) AS c FROM tasks WHERE package_id=? AND status NOT IN ('待分配','已完成')", (pid,)
        ).fetchone()["c"]
        item = dict(p)
        item["total"] = total
        item["completed"] = completed
        item["assigned"] = assigned
        result.append(item)
    conn.close()
    return result
```

- [ ] **Step 2: 修改 `api_task_packages` 支持查询参数**

修改 `routes/tasks.py` 第 517-520 行：

```python
@bp.route('/api/task_packages')
def api_task_packages():
    completed_only = request.args.get("completed", "").lower() == "true"
    packages = list_task_packages(completed_only=completed_only)
    return jsonify({"packages": packages})
```

- [ ] **Step 3: 验证**

用 curl 测试：
```bash
curl http://localhost:5000/api/task_packages           # 返回全部
curl http://localhost:5000/api/task_packages?completed=true  # 只返回全部完成的
```

确认部分完成的包不出现在 `completed=true` 结果中，空的包（无任务）也不出现。

- [ ] **Step 4: Commit**

```bash
git add models.py routes/tasks.py
git commit -m "feat: add completed-only filter to task packages API

GET /api/task_packages?completed=true returns only packages
where all tasks have status '已完成'.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: 前端——历史记录已完成任务包子面板

**Files:**
- Modify: `templates/panels/history.html`（底部新增）
- Modify: `static/history.js`（新增加载/渲染函数）

- [ ] **Step 1: 在 history.html 底部添加已完成任务包子面板**

在 `templates/panels/history.html` 第 110 行（`</div>` 闭合 `box` 之前）插入：

```html
            <!-- ==================== 已完成任务包 ==================== -->
            <div class="box" id="history-packages-section" style="margin-top:16px;">
                <h3>📦 已完成任务包</h3>
                <div id="history-packages-grid" class="pkg-grid">
                    加载中...
                </div>
            </div>
```

插入位置：第 110 行的 `</div>`（即 `history-table-detail` wrapper 的闭合标签）之后、第 111 行的 `</div>`（box 闭合）之前。

- [ ] **Step 2: 在 history.js 中添加加载和渲染函数**

在 `static/history.js` 末尾添加以下函数：

```javascript
// ========== 已完成任务包 ==========
var HISTORY_PACKAGES = [];

function _loadHistoryPackages() {
    fetch('/api/task_packages?completed=true')
        .then(function(r) { return r.json(); })
        .then(function(d) {
            HISTORY_PACKAGES = d.packages || [];
            _renderHistoryPackages();
        })
        .catch(function() {
            // 静默失败，历史记录主表格不受影响
        });
}

function _renderHistoryPackages() {
    var grid = document.getElementById('history-packages-grid');
    if (!grid) return;

    if (HISTORY_PACKAGES.length === 0) {
        grid.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px;font-size:13px;">暂无已完成的任务包</div>';
        return;
    }

    var colors = ['#f59e0b', '#3b82f6', '#8b5cf6', '#06b6d4', '#f97316'];
    var html = '';

    for (var i = 0; i < HISTORY_PACKAGES.length; i++) {
        var p = HISTORY_PACKAGES[i];
        var color = colors[i % colors.length];
        var assignedPct = p.total > 0 ? Math.round(p.assigned / p.total * 100) : 0;
        var completedPct = p.total > 0 ? Math.round(p.completed / p.total * 100) : 0;

        html += '<div class="pkg-card pkg-completed" style="border-left-color:' + color + '">';
        html += '<div class="pkg-card-header">';
        html += '<div><div class="pkg-card-title">' + escHtml(p.name) + '</div>';
        html += '<div class="pkg-card-meta">' + escHtml(p.machine_type) + ' · ' + escHtml(p.priority || '') + (p.deadline ? ' · 截止 ' + escHtml(p.deadline) : ' · 无截止') + '</div></div>';
        html += '<div class="pkg-card-toggle">已完成</div></div>';
        html += '<div class="pkg-progress-section">';
        html += '<div class="pkg-progress-row"><span class="pkg-progress-label">已分配</span><div class="pkg-progress-bar-wrap"><div class="pkg-progress-bar assigned" style="width:' + assignedPct + '%"></div></div><span class="pkg-progress-count">' + p.assigned + '/' + p.total + '</span></div>';
        html += '<div class="pkg-progress-row"><span class="pkg-progress-label">已完成</span><div class="pkg-progress-bar-wrap"><div class="pkg-progress-bar completed" style="width:' + completedPct + '%"></div></div><span class="pkg-progress-count">' + p.completed + '/' + p.total + '</span></div></div>';
        html += '</div>';
    }

    grid.innerHTML = html;
}
```

- [ ] **Step 3: 在 `_loadHistory` 末尾调用 `_loadHistoryPackages`**

修改 `static/history.js` 第 345-359 行的 `_loadHistory` 函数，在 `.then` 链末尾加上 `_loadHistoryPackages()`：

```javascript
function _loadHistory(dateFrom, dateTo){
    _histBatchSet.clear();
    var params = [];
    if(dateFrom) params.push('date_from='+encodeURIComponent(dateFrom));
    if(dateTo) params.push('date_to='+encodeURIComponent(dateTo));
    var qs = params.length > 0 ? '?'+params.join('&') : '';
    fetch('/api/history_schedules'+qs)
    .then(function(r){return r.json();}).then(function(d){
        SCHEDULES_HISTORY = d.history || [];
        _histPage = 0;
        _renderHistoryPage();
        switchHistoryModeBtn(currentHistoryMode);
        _loadHistoryPackages();   // <-- 新增
    }).catch(function(){
        showToast('历史记录加载失败，请检查网络或刷新页面');
    });
}
```

- [ ] **Step 4: 验证**

启动应用，切换到历史记录面板：
- 确认全部任务完成的包出现在「已完成任务包」卡片中
- 确认部分完成的包不出现
- 确认空包不出现
- 确认卡片样式与任务库一致（彩色左边框、双进度条、已完成标签）
- 确认卡片无按钮、无可操作元素
- 回收某个包内已完成任务 → 刷新 → 卡片消失

- [ ] **Step 5: Commit**

```bash
git add templates/panels/history.html static/history.js
git commit -m "feat: add completed task packages sub-panel to history page

Shows completed packages as cards below the history table,
reusing .pkg-grid/.pkg-card CSS from the task pool. Auto-detects
completion when all tasks in a package are '已完成'.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## 自审清单

1. **Spec 覆盖:**
   - 改动一（P1默认）→ Task 1 ✓
   - 改动二（导入过滤）→ Task 2 ✓
   - 改动三（历史任务包）→ Task 3 + Task 4 ✓
   - 所有测试要点在验证步骤中覆盖 ✓

2. **占位符检查:** 无 TBD/TODO，所有步骤包含完整代码 ✓

3. **类型一致性:** `list_task_packages(completed_only: bool)` 签名在 models.py 和 routes/tasks.py 中一致；前端 `HISTORY_PACKAGES` 数组结构匹配 `_renderHistoryPackages` 渲染 ✓

4. **路由冲突:** `?completed=true` 使用查询参数而非路径参数，不与 `<int:pid>` 路由冲突 ✓
