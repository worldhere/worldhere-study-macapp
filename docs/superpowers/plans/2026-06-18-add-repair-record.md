# 增加维修时间段 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在历史编辑弹窗的维修记录区域增加"添加维修时间段"功能，用户可以手动补录维修记录。

**Architecture:** 前端 `history.js` 增加按钮和空白行逻辑，后端 `schedule_ops.py` 新增 `POST /api/repair_log/create` 端点。遵循现有 CRUD 模式（update/delete/create），不改变 machine 状态。

**Tech Stack:** Python Flask + vanilla JS + SQLite

---

### 文件结构

| 文件 | 职责 | 改动类型 |
|------|------|----------|
| `routes/schedule_ops.py` | 新增 `POST /api/repair_log/create` 端点 | 修改 |
| `static/history.js` | 添加按钮、空白行、保存时调 create API | 修改 |
| `templates/dialogs/all.html` | 添加隐藏字段 `#he_machine_id` | 修改 |
| `tests/test_repair_log.py` | 新测试文件，覆盖 create API | 新建 |

---

### Task 1: 后端 — 新增 POST /api/repair_log/create 端点

**Files:**
- Modify: `routes/schedule_ops.py` (在 delete 端点之后插入)
- Create: `tests/test_repair_log.py`

- [ ] **Step 1: 编写失败测试**

```python
# tests/test_repair_log.py
# -*- coding: utf-8 -*-
"""维修记录 API 测试 — create"""


def test_repair_log_create_success(app):
    """POST /api/repair_log/create 成功创建维修记录"""
    resp = app.post('/api/repair_log/create', json={
        "machine_id": 1,
        "start_datetime": "2026-06-18T09:00",
        "end_datetime": "2026-06-18T11:30",
    })
    assert resp.status_code == 200
    data = resp.get_json()
    assert data.get('ok') is True
    assert isinstance(data.get('id'), int)
    assert data['id'] > 0


def test_repair_log_create_missing_machine_id(app):
    """缺少 machine_id 返回 400"""
    resp = app.post('/api/repair_log/create', json={
        "start_datetime": "2026-06-18T09:00",
        "end_datetime": "2026-06-18T11:30",
    })
    assert resp.status_code == 400


def test_repair_log_create_missing_start(app):
    """缺少 start_datetime 返回 400"""
    resp = app.post('/api/repair_log/create', json={
        "machine_id": 1,
        "end_datetime": "2026-06-18T11:30",
    })
    assert resp.status_code == 400


def test_repair_log_create_end_null(app):
    """end_datetime 为 null 时仍可创建（进行中的维修）"""
    resp = app.post('/api/repair_log/create', json={
        "machine_id": 1,
        "start_datetime": "2026-06-18T09:00",
        "end_datetime": None,
    })
    assert resp.status_code == 200
    data = resp.get_json()
    assert data.get('ok') is True


def test_repair_log_create_created_at_auto(app):
    """created_at 由后端自动设置，不依赖前端传入"""
    resp = app.post('/api/repair_log/create', json={
        "machine_id": 1,
        "start_datetime": "2026-06-18T09:00",
        "end_datetime": "2026-06-18T10:00",
    })
    assert resp.status_code == 200
    data = resp.get_json()
    rid = data['id']

    # 读回验证 created_at 不为空
    import os
    from db import get_db
    conn = get_db()
    row = conn.execute("SELECT created_at FROM repair_log WHERE id=?", (rid,)).fetchone()
    conn.close()
    assert row is not None
    assert row["created_at"] is not None
```

- [ ] **Step 2: 运行测试，确认全部 FAIL**

```bash
python -m pytest tests/test_repair_log.py -v
```
预期：5 个测试全部失败（端点不存在，返回 404 或 500）

- [ ] **Step 3: 实现 POST /api/repair_log/create 端点**

在 `routes/schedule_ops.py` 的 delete 端点之后（第 896 行之后）插入：

```python
@bp.route('/api/repair_log/create', methods=['POST'])
def create_repair_log():
    """创建 repair_log 记录（手动补录维修时间段）"""
    d = request.get_json()
    mid = int(d.get("machine_id", 0))
    start_dt = (d.get("start_datetime") or "").strip()
    end_dt = d.get("end_datetime")  # 允许 None（进行中）

    if not mid:
        return jsonify({"msg": "缺少机器ID"}), 400
    if not start_dt:
        return jsonify({"msg": "缺少开始时间"}), 400

    conn = get_db()
    now = datetime.datetime.now().isoformat(timespec="seconds")
    cur = conn.execute(
        "INSERT INTO repair_log (machine_id, start_datetime, end_datetime, created_at) VALUES (?,?,?,?)",
        (mid, start_dt, end_dt if end_dt else None, now),
    )
    conn.commit()
    new_id = cur.lastrowid
    conn.close()
    return jsonify({"ok": True, "id": new_id, "msg": "维修记录已创建"})
```

- [ ] **Step 4: 运行测试，确认全部 PASS**

```bash
python -m pytest tests/test_repair_log.py -v
```
预期：5 passed

- [ ] **Step 5: 提交**

```bash
git add routes/schedule_ops.py tests/test_repair_log.py
git commit -m "feat: add POST /api/repair_log/create endpoint for manual repair records

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: 前端 — 添加按钮和空白行逻辑

**Files:**
- Modify: `templates/dialogs/all.html:167` (在 he_machine_name 之前加入隐藏字段)
- Modify: `static/history.js` — `openHistoryEdit()`, `_renderRepairRecords()`, 新增 `_addRepairRow()`, 修改 `_saveRepairRecords()`

- [ ] **Step 1: 添加隐藏字段 `#he_machine_id`**

在 `templates/dialogs/all.html` 第 167 行的 `<input id="he_machine_name" ...>` 之前插入：

```html
<input type="hidden" id="he_machine_id">
```

- [ ] **Step 2: 在 `openHistoryEdit()` 中写入 machine_id**

在 `static/history.js` 的 `openHistoryEdit()` 函数中，第 544 行 `document.getElementById('he_machine_name').value = s.machine_name || '';` 之前增加：

```javascript
document.getElementById('he_machine_id').value = s.machine_id || '';
```

- [ ] **Step 3: 修改 `_renderRepairRecords()` — 始终显示"添加"按钮**

替换整个 `_renderRepairRecords` 函数（第 429-453 行）：

```javascript
function _renderRepairRecords(s) {
    var container = document.getElementById('he-repair-records');
    if (!container) return;
    var periods = s.repair_periods || [];
    var html = '';
    if (!periods.length) {
        html += '<span style="color:var(--text-muted);font-size:12px;">无维修记录</span>';
    }
    for (var i = 0; i < periods.length; i++) {
        var p = periods[i];
        var rid = p.id || 0;
        var startVal = (p.start_datetime || '').substring(0, 16);
        var endVal = (p.end_datetime || '').substring(0, 16);
        var durLabel = p.label || (p.duration_minutes ? p.duration_minutes + 'min' : '进行中');
        html += '<div class="repair-record-row" data-rid="' + rid + '" style="display:flex;gap:6px;align-items:center;margin-bottom:4px;padding:4px;background:var(--bg-sidebar);border-radius:4px;">' +
            '<input class="repair-start" type="datetime-local" value="' + escHtml(startVal) + '" style="flex:1;font-size:11px;padding:2px 4px;" step="60">' +
            '<span style="color:var(--text-muted);">→</span>' +
            '<input class="repair-end" type="datetime-local" value="' + escHtml(endVal) + '" style="flex:1;font-size:11px;padding:2px 4px;" step="60">' +
            '<span class="repair-dur-label" style="font-size:11px;color:var(--text-muted);min-width:50px;text-align:right;">' + escHtml(durLabel) + '</span>' +
            '<button class="repair-del-btn" onclick="_deleteRepairRow(this)" style="font-size:11px;padding:1px 6px;color:#c62828;background:none;border:1px solid #c62828;border-radius:3px;cursor:pointer;">×</button>' +
            '</div>';
    }
    html += '<button onclick="_addRepairRow()" style="font-size:11px;padding:4px 12px;color:#1976d2;background:#e3f2fd;border:1px solid #90caf9;border-radius:4px;cursor:pointer;margin-top:4px;">➕ 添加维修时间段</button>';
    container.innerHTML = html;
}
```

- [ ] **Step 4: 新增 `_addRepairRow()` 函数**

在 `_deleteRepairRow()` 之后（第 466 行之后）插入：

```javascript
var _repairNewCounter = 0;

function _addRepairRow() {
    var container = document.getElementById('he-repair-records');
    if (!container) return;
    _repairNewCounter++;
    var newId = 'new_' + _repairNewCounter;
    var row = document.createElement('div');
    row.className = 'repair-record-row';
    row.setAttribute('data-rid', newId);
    row.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:4px;padding:4px;background:#f0fdf4;border:1px dashed #a5d6a7;border-radius:4px;';
    row.innerHTML =
        '<input class="repair-start" type="datetime-local" value="" style="flex:1;font-size:11px;padding:2px 4px;border:1px solid #a5d6a7;border-radius:3px;" step="60">' +
        '<span style="color:var(--text-muted);">→</span>' +
        '<input class="repair-end" type="datetime-local" value="" style="flex:1;font-size:11px;padding:2px 4px;border:1px solid #a5d6a7;border-radius:3px;" step="60">' +
        '<span class="repair-dur-label" style="font-size:11px;color:#4caf50;min-width:50px;text-align:right;">新增</span>' +
        '<button onclick="_deleteRepairRow(this)" style="font-size:11px;padding:1px 6px;color:#4caf50;background:none;border:1px solid #4caf50;border-radius:3px;cursor:pointer;">✓</button>';
    // Insert before the add button (last child)
    var addBtn = container.querySelector('button[onclick="_addRepairRow()"]');
    if (addBtn) {
        container.insertBefore(row, addBtn);
    } else {
        container.appendChild(row);
    }
}
```

- [ ] **Step 5: 修改 `_saveRepairRecords()` — 处理新建行**

替换整个 `_saveRepairRecords` 函数（第 468-518 行）：

```javascript
function _saveRepairRecords() {
    var container = document.getElementById('he-repair-records');
    if (!container) return Promise.resolve();
    var machineId = parseInt(document.getElementById('he_machine_id')?.value || '0', 10);
    var rows = container.querySelectorAll('.repair-record-row');
    var promises = [];

    // Handle deletions
    var deletedRows = container.querySelectorAll('.repair-record-row.repair-deleted');
    deletedRows.forEach(function(row) {
        var ridStr = row.getAttribute('data-rid') || '0';
        // Only delete real records (numeric IDs), skip unsaved new rows
        if (ridStr.indexOf('new_') === 0) {
            row.remove();
            return;
        }
        var rid = parseInt(ridStr, 10);
        if (rid > 0) {
            promises.push(
                fetch('/api/repair_log/delete', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({id: rid})
                })
            );
        }
    });

    // Handle updates and creates (for visible rows)
    rows.forEach(function(row) {
        if (row.classList.contains('repair-deleted')) return;
        var ridStr = row.getAttribute('data-rid') || '0';
        var startInput = row.querySelector('.repair-start');
        var endInput = row.querySelector('.repair-end');
        if (!startInput || !endInput) return;

        var newStart = startInput.value;
        var newEnd = endInput.value;

        // Skip empty new rows (user clicked add but didn't fill anything)
        if (ridStr.indexOf('new_') === 0) {
            if (!newStart) return;  // empty row, silently skip
            if (!machineId) return; // safety: can't create without machine
            promises.push(
                fetch('/api/repair_log/create', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        machine_id: machineId,
                        start_datetime: newStart,
                        end_datetime: newEnd || null
                    })
                })
            );
            return;
        }

        // Existing record: update if changed
        var rid = parseInt(ridStr, 10);
        if (!rid) return;
        var origStart = (startInput.defaultValue || '').substring(0, 16);
        var origEnd = (endInput.defaultValue || '').substring(0, 16);

        if (newStart !== origStart || newEnd !== origEnd) {
            var payload = {id: rid};
            if (newStart) payload.start_datetime = newStart;
            payload.end_datetime = newEnd || null;
            promises.push(
                fetch('/api/repair_log/update', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(payload)
                })
            );
        }
    });

    return Promise.all(promises);
}
```

- [ ] **Step 6: 验证 — 手动检查**

启动应用，打开历史记录页面：
1. 点击某个已完成排程的"编辑"按钮
2. 确认维修记录区域底部出现"➕ 添加维修时间段"按钮
3. 点击按钮，确认出现绿色虚线空白行
4. 点击日期时间输入框，确认浏览器弹出日期选择器
5. 填写开始/结束时间，保存
6. 确认保存成功，时间轴刷新后显示新增的维修覆盖

- [ ] **Step 7: 提交**

```bash
git add static/history.js templates/dialogs/all.html
git commit -m "feat: add repair record creation UI in history edit dialog

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: 运行全部测试，确保无回归

- [ ] **Step 1: 运行完整测试套件**

```bash
python -m pytest tests/ -v
```
预期：所有已有测试 + 5 个新测试全部通过

- [ ] **Step 2: 如果有失败，排查修复后重新运行**

---

### 自检

1. **Spec coverage:** 设计文档的三个要求全部覆盖 — API 端点 (Task 1)、前端按钮和空白行 (Task 2)、保存时调 create (Task 2 Step 5)
2. **Placeholder scan:** 无 TBD/TODO，所有代码步骤包含完整实现
3. **Type consistency:** `data-rid` 命名一致（`new_N` 前缀 vs 数字 ID），`machine_id` 来源明确（隐藏字段 `#he_machine_id`）
