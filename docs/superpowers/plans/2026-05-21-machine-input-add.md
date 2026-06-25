# Machine Input Add Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "输入增加" button to machine management that opens a textarea dialog, parses pasted machine names (detecting type prefix + optional task_kind suffix in parentheses), previews results, and batch adds them.

**Architecture:** Frontend adds a dialog with textarea + preview table in `all.html`, parsing logic in `machines.js` to split each line into {name, type, task_kind}, backend `/add_machines_batch` extended to support per-machine task_kind via mixed string/object names array. Backward compatible — existing batch dialog still works.

**Tech Stack:** Jinja2 HTML, vanilla JavaScript, Python Flask + SQLite

---

### Task 1: Add "输入增加" button to machine panel

**Files:**
- Modify: `templates/panels/machines.html:9-10`

Add a third button next to "新增" and "批量添加":

```html
<button class="btn" onclick="addMachine()">新增</button>
<button class="btn" onclick="openBatchMachineDialog()">批量添加</button>
<button class="btn" onclick="openInputAddMachineDialog()">输入增加</button>
```

---

### Task 2: Add input-add dialog HTML

**Files:**
- Modify: `templates/dialogs/all.html` — after `batch-machine-dialog` closing `</div>` (currently around line 438)

Add the new dialog:

```html
<!-- 输入增加机器弹窗 -->
<div id="input-add-machine-dialog" style="display:none;position:fixed;left:50%;top:10%;transform:translateX(-50%);z-index:2000;min-width:550px;max-width:95vw;background:var(--bg-card);border-radius:var(--radius);padding:20px;box-shadow:var(--shadow-xl);">
    <h3 style="margin:0 0:12px 0;">输入增加机器</h3>
    <div style="margin-bottom:10px;">
        <label style="display:block;margin-bottom:4px;font-size:13px;">粘贴机器列表（每行一台，如 BR2-11 或 BR2-11(DAgger)）：</label>
        <textarea id="iam-input" style="width:100%;height:180px;font-family:monospace;font-size:13px;padding:8px;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--bg-card);color:var(--text-primary);resize:vertical;" placeholder="BR2-10&#10;BR2-11(DAgger)&#10;BR2-15（ASR）&#10;Mini-03" oninput="previewInputAddMachines()"></textarea>
    </div>
    <div style="margin-bottom:10px;font-size:12px;color:var(--text-muted);">
        <span>解析规则：自动识别机型前缀（BR1/BR2/Mini），括号内容匹配任务类型时自动提取</span>
    </div>
    <div id="iam-preview" style="max-height:200px;overflow-y:auto;margin-bottom:12px;font-size:13px;color:var(--text-primary);background:var(--bg-deep);padding:8px 12px;border-radius:var(--radius-xs);min-height:40px;">
        <span style="color:#94a3b8;">预览区 — 输入内容后自动显示</span>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn" onclick="closeInputAddMachineDialog()">取消</button>
        <button class="btn btn-primary" id="iam-confirm-btn" onclick="executeInputAddMachines()">确认添加</button>
    </div>
</div>
```

---

### Task 3: Add JS functions for input-add dialog

**Files:**
- Modify: `static/machines.js` — append after existing code

Add the following functions at the end of the file:

```javascript
// ========== 输入增加机器 ==========

function openInputAddMachineDialog(){
    document.getElementById('iam-input').value = '';
    document.getElementById('iam-preview').innerHTML = '<span style="color:#94a3b8;">预览区 — 输入内容后自动显示</span>';
    document.getElementById('input-add-machine-dialog').style.display = 'block';
    document.getElementById('iam-input').focus();
}

function closeInputAddMachineDialog(){
    document.getElementById('input-add-machine-dialog').style.display = 'none';
}

function _parseMachineInputLine(line){
    line = line.trim();
    if (!line) return null;

    // Get configured machine types and task kinds from DOM select options
    var typeSelect = document.getElementById('m_type');
    var machineTypes = [];
    if (typeSelect) {
        for (var i = 0; i < typeSelect.options.length; i++) {
            machineTypes.push(typeSelect.options[i].value);
        }
    }
    // Sort by length descending to match longest prefix first (e.g. BR2 before B)
    machineTypes.sort(function(a,b){ return b.length - a.length; });

    var kindSelect = document.getElementById('m_kind');
    var taskKinds = [];
    if (kindSelect) {
        for (var i = 0; i < kindSelect.options.length; i++) {
            taskKinds.push(kindSelect.options[i].value);
        }
    }

    // Detect machine type prefix
    var detectedType = null;
    for (var t = 0; t < machineTypes.length; t++) {
        if (line.indexOf(machineTypes[t]) === 0) {
            detectedType = machineTypes[t];
            break;
        }
    }
    if (!detectedType) return {error: '无法识别机型前缀', raw: line};

    // Detect parenthesized suffix — match (...) or （...） at end of line
    var parenMatch = line.match(/[\(（]([^\)）]+)[\)）]$/);
    var taskKind = null;
    var name = line;

    if (parenMatch) {
        var parenContent = parenMatch[1].trim();
        // Check if paren content matches a configured task kind
        for (var k = 0; k < taskKinds.length; k++) {
            if (taskKinds[k] === parenContent) {
                taskKind = parenContent;
                name = line.substring(0, parenMatch.index).trim();
                break;
            }
        }
    }

    return {name: name, type: detectedType, task_kind: taskKind};
}

function previewInputAddMachines(){
    var raw = document.getElementById('iam-input').value;
    var lines = raw.split(/[\r\n]+/);
    var results = [];
    var defaultKind = '';
    var kindSelect = document.getElementById('m_kind');
    if (kindSelect && kindSelect.options.length > 0) {
        defaultKind = kindSelect.options[0].value;
    }

    for (var i = 0; i < lines.length; i++) {
        var parsed = _parseMachineInputLine(lines[i]);
        if (!parsed) continue;
        if (parsed.error) {
            results.push({_error: true, raw: parsed.raw});
        } else {
            results.push(parsed);
        }
    }

    if (results.length === 0) {
        document.getElementById('iam-preview').innerHTML = '<span style="color:#94a3b8;">预览区 — 输入内容后自动显示</span>';
        return;
    }

    var html = '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
    html += '<tr style="border-bottom:1px solid var(--border);color:var(--text-muted);"><th style="text-align:left;padding:4px;">机器名</th><th style="text-align:left;padding:4px;">机型</th><th style="text-align:left;padding:4px;">任务类型</th></tr>';
    for (var j = 0; j < results.length; j++) {
        var r = results[j];
        if (r._error) {
            html += '<tr style="color:var(--danger);"><td colspan="3" style="padding:4px;">⚠ 跳过：' + escHtml(r.raw) + '（无法识别机型）</td></tr>';
        } else {
            html += '<tr style="border-bottom:1px solid rgba(128,128,128,0.15);">';
            html += '<td style="padding:4px;">' + escHtml(r.name) + '</td>';
            html += '<td style="padding:4px;">' + escHtml(r.type) + '</td>';
            html += '<td style="padding:4px;">' + escHtml(r.task_kind || defaultKind) + (r.task_kind ? ' <span style="color:var(--primary);font-size:11px;">← 括号识别</span>' : '') + '</td>';
            html += '</tr>';
        }
    }
    html += '</table>';
    document.getElementById('iam-preview').innerHTML = html;
}

function executeInputAddMachines(){
    var raw = document.getElementById('iam-input').value;
    var lines = raw.split(/[\r\n]+/);
    var machines = [];
    var defaultKind = '';
    var kindSelect = document.getElementById('m_kind');
    if (kindSelect && kindSelect.options.length > 0) {
        defaultKind = kindSelect.options[0].value;
    }

    for (var i = 0; i < lines.length; i++) {
        var parsed = _parseMachineInputLine(lines[i]);
        if (!parsed || parsed.error) continue;
        machines.push({
            name: parsed.name,
            type: parsed.type,
            task_kind: parsed.task_kind || defaultKind
        });
    }

    if (machines.length === 0) {
        showToast('未解析到有效机器');
        return;
    }

    fetch('/add_machines_batch', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({machines: machines})
    }).then(function(r){ return r.json(); }).then(function(d){
        showToast(d.msg);
        closeInputAddMachineDialog();
        _refreshMachines();
    }).catch(function(){
        showToast('添加失败，请检查网络');
    });
}
```

---

### Task 4: Extend backend /add_machines_batch for per-machine task_kind

**Files:**
- Modify: `routes/machines.py:56-96`

Replace the existing `add_machines_batch()` function with extended version:

```python
@bp.route('/add_machines_batch', methods=['POST'])
def add_machines_batch():
    d = request.get_json() or {}
    allowed = get_allowed_task_kinds()
    default_kind = allowed[0] if allowed else "常规"
    conn = get_db()

    # New format: {machines: [{name, type, task_kind}, ...]}
    machine_list = d.get("machines")
    if machine_list and isinstance(machine_list, list):
        added = 0
        skipped = []
        for item in machine_list:
            if isinstance(item, str):
                name = item.strip()
                mtype = ""
                task_kind = default_kind
            else:
                name = (item.get("name") or "").strip()
                mtype = (item.get("type") or "").strip()
                task_kind = (item.get("task_kind") or "").strip()
            if not name:
                continue
            if not task_kind or task_kind not in allowed:
                task_kind = default_kind
            if not mtype:
                continue
            existing = conn.execute("SELECT COUNT(*) AS c FROM machines WHERE name=?", (name,)).fetchone()
            if existing and existing["c"] > 0:
                skipped.append(name)
                continue
            conn.execute(
                "INSERT INTO machines(sort_order,name,type,status,area) VALUES (?,?,?,?,?)",
                (
                    int(conn.execute("SELECT COALESCE(MAX(sort_order),0)+1 AS v FROM machines").fetchone()["v"]),
                    name,
                    mtype,
                    "空闲",
                    "站桩",
                ),
            )
            new_id = conn.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]
            conn.execute("UPDATE machines SET task_kind=? WHERE id=?", (task_kind, int(new_id)))
            added += 1
        conn.commit()
        conn.close()
        msg = f"成功添加 {added} 台机器"
        if skipped:
            msg += f"，{len(skipped)} 台跳过（名称已存在：{', '.join(skipped)}）"
        return jsonify({"msg": msg, "added": added, "skipped": skipped})

    # Old format (backward compatible): {type, task_kind, names: [...]}
    mtype = (d.get("type") or "").strip()
    task_kind = (d.get("task_kind") or "").strip()
    names = d.get("names") or []
    if not mtype or not isinstance(names, list) or len(names) == 0:
        return jsonify({"msg": "参数错误"})
    if not task_kind or task_kind not in allowed:
        task_kind = default_kind
    added = 0
    skipped = []
    for name in names:
        # Support mixed string/object in old-format names array
        if isinstance(name, dict):
            item_name = (name.get("name") or "").strip()
            item_kind = (name.get("task_kind") or "").strip()
            if not item_kind or item_kind not in allowed:
                item_kind = task_kind
            name = item_name
        else:
            name = (name or "").strip()
            item_kind = task_kind
        if not name:
            continue
        existing = conn.execute("SELECT COUNT(*) AS c FROM machines WHERE name=?", (name,)).fetchone()
        if existing and existing["c"] > 0:
            skipped.append(name)
            continue
        conn.execute(
            "INSERT INTO machines(sort_order,name,type,status,area) VALUES (?,?,?,?,?)",
            (
                int(conn.execute("SELECT COALESCE(MAX(sort_order),0)+1 AS v FROM machines").fetchone()["v"]),
                name,
                mtype,
                "空闲",
                "站桩",
            ),
        )
        new_id = conn.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]
        conn.execute("UPDATE machines SET task_kind=? WHERE id=?", (item_kind, int(new_id)))
        added += 1
    conn.commit()
    conn.close()
    msg = f"成功添加 {added} 台机器"
    if skipped:
        msg += f"，{len(skipped)} 台跳过（名称已存在：{', '.join(skipped)}）"
    return jsonify({"msg": msg, "added": added, "skipped": skipped})
```

---

### Task 5: Ensure _refreshMachines function exists

**Files:**
- Check: `static/machines.js`

The `executeInputAddMachines()` function calls `_refreshMachines()` after successful add. Verify this function exists. If not, add a simple page reload fallback:

```javascript
function _refreshMachines(){
    // Reload the machine list from server
    fetch('/api/machines')
    .then(function(r){ return r.json(); }).then(function(d){
        var tbody = document.querySelector('#machine-list tbody');
        if (tbody) {
            tbody.innerHTML = '';
            (d.machines || []).forEach(function(m){
                _appendMachineRow(m);
            });
        }
    }).catch(function(){
        location.reload();
    });
}
```

If `_refreshMachines` does not already exist, add it. If a similar refresh mechanism already exists (e.g., `loadMachineList()`), use that name instead in Task 3's `executeInputAddMachines`.
