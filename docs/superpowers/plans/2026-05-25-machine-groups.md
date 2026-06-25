# 机器分组功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为机器管理增加分组标签功能——设置面板管分组，机器管理筛选+指派，时间轴自然跟随。

**Architecture:** 沿用现有 config 表 + TEXT 列模式（与 task_kind 一致）。分组名存 config 表 category=`machine_groups`，machines 表新增 `group_name` 列。机器列表使用现有客户端筛选机制（`_filterMachinesByUI`），无需改服务端筛选逻辑。

**Tech Stack:** Flask + SQLite + vanilla JS + Jinja2

---

## File Structure

| 文件 | 职责 |
|------|------|
| `db.py` | `get_allowed_machine_groups()` 辅助函数；DB 迁移 |
| `models.py` | `list_machines()` 增加 `filter_group` 参数（服务端渲染路径用） |
| `routes/machines.py` | 分组 CRUD；现有路由增加 group_name 支持 |
| `routes/views.py` | index 路由传入 `m_group` 参数 + `machine_groups` 配置 |
| `templates/panels/machines.html` | 折叠模块结构；分组管理区；筛选栏加分組；表格加分組列 |
| `templates/dialogs/all.html` | 移除旧弹窗；新增合并批量添加弹窗 |
| `static/core.js` | `_filterMachinesByUI` 加 group 过滤；`_groupOptions` 辅助函数 |
| `static/machines.js` | 分组管理交互；分组列保存；合并弹窗全部 JS |
| `static/timeline.js` | `_renderMachineTable` 加分组列；`changeMachineFilter` 加 group 参数 |

---

### Task 1: Database Layer

**Files:**
- Modify: `db.py:260-560` (init_db around migration area)
- Modify: `db.py:48-61` (after `get_allowed_machine_statuses`)

- [ ] **Step 1: Add `get_allowed_machine_groups()` in db.py**

Insert after `get_allowed_machine_statuses()` (line ~93):

```python
def get_allowed_machine_groups():
    """从 config 表读取允许的机器分组；表不存在或为空时回退到空列表"""
    try:
        conn = get_db()
        rows = conn.execute(
            "SELECT key FROM config WHERE category='machine_groups' ORDER BY sort_order, key"
        ).fetchall()
        conn.close()
        kinds = tuple(r["key"] for r in rows)
        return kinds
    except Exception:
        pass
    return tuple()
```

- [ ] **Step 2: Add `group_name` column migration in `init_db()`**

Insert before the `conn.close()` at end of `init_db()` (around line 545, before the forum settings section):

```python
    # 兼容旧库：补上 machines.group_name
    try:
        cur.execute("ALTER TABLE machines ADD COLUMN group_name TEXT NOT NULL DEFAULT ''")
        conn.commit()
    except sqlite3.OperationalError:
        pass
```

- [ ] **Step 3: Verify migration**

Run the app once to trigger `init_db()`, then check the schema:

```powershell
python -c "from db import get_db; conn=get_db(); rows=conn.execute('PRAGMA table_info(machines)').fetchall(); conn.close(); print([r['name'] for r in rows])"
```

Expected: `group_name` appears in the column list.

- [ ] **Step 4: Commit**

```bash
git add db.py
git commit -m "feat: add get_allowed_machine_groups helper and group_name column migration"
```

---

### Task 2: Backend API — Group CRUD + Existing Route Updates

**Files:**
- Modify: `routes/machines.py`

- [ ] **Step 1: Add `/api/machine_groups` GET route**

At the top of `routes/machines.py`, insert after the imports:

```python
from db import get_db, get_allowed_task_kinds, recycle_schedules, get_allowed_machine_groups
```

Then add route before `api_machines`:

```python
@bp.route('/api/machine_groups')
def api_machine_groups():
    try:
        conn = get_db()
        rows = conn.execute(
            "SELECT key, sort_order FROM config WHERE category='machine_groups' ORDER BY sort_order, key"
        ).fetchall()
        conn.close()
        return jsonify({"groups": [dict(r) for r in rows]})
    except Exception as e:
        return jsonify({"msg": f"加载分组列表失败: {e}"}), 500
```

- [ ] **Step 2: Add `/add_machine_group` POST route**

```python
@bp.route('/add_machine_group', methods=['POST'])
def add_machine_group():
    d = request.get_json()
    name = (d.get("name") or "").strip()
    if not name:
        return jsonify({"msg": "分组名不能为空"}), 400
    conn = get_db()
    existing = conn.execute(
        "SELECT COUNT(*) AS c FROM config WHERE category='machine_groups' AND key=?", (name,)
    ).fetchone()["c"]
    if existing:
        conn.close()
        return jsonify({"msg": "该分组名已存在"}), 400
    max_order = conn.execute(
        "SELECT COALESCE(MAX(sort_order), 0) AS m FROM config WHERE category='machine_groups'"
    ).fetchone()["m"]
    conn.execute(
        "INSERT INTO config(category, key, value, sort_order) VALUES ('machine_groups', ?, '', ?)",
        (name, max_order + 1),
    )
    conn.commit()
    conn.close()
    return jsonify({"msg": "分组已创建", "group": {"key": name, "sort_order": max_order + 1}})
```

- [ ] **Step 3: Add `/update_machine_group` POST route**

```python
@bp.route('/update_machine_group', methods=['POST'])
def update_machine_group():
    d = request.get_json()
    old_name = (d.get("old_name") or "").strip()
    new_name = (d.get("new_name") or "").strip()
    if not old_name or not new_name:
        return jsonify({"msg": "分组名不能为空"}), 400
    conn = get_db()
    if old_name != new_name:
        dup = conn.execute(
            "SELECT COUNT(*) AS c FROM config WHERE category='machine_groups' AND key=?",
            (new_name,)
        ).fetchone()["c"]
        if dup:
            conn.close()
            return jsonify({"msg": "该分组名已存在"}), 400
        conn.execute(
            "UPDATE config SET key=? WHERE category='machine_groups' AND key=?",
            (new_name, old_name),
        )
        conn.execute(
            "UPDATE machines SET group_name=? WHERE group_name=?",
            (new_name, old_name),
        )
    conn.commit()
    conn.close()
    return jsonify({"msg": "分组已更新"})
```

- [ ] **Step 4: Add `/delete_machine_group` POST route**

```python
@bp.route('/delete_machine_group', methods=['POST'])
def delete_machine_group():
    d = request.get_json()
    name = (d.get("name") or "").strip()
    if not name:
        return jsonify({"msg": "分组名不能为空"}), 400
    conn = get_db()
    conn.execute(
        "DELETE FROM config WHERE category='machine_groups' AND key=?", (name,)
    )
    conn.execute(
        "UPDATE machines SET group_name='' WHERE group_name=?", (name,)
    )
    conn.commit()
    conn.close()
    return jsonify({"msg": "分组已删除，该分组下的机器已变为未分组"})
```

- [ ] **Step 5: Add `/update_machine_groups_order` POST route**

```python
@bp.route('/update_machine_groups_order', methods=['POST'])
def update_machine_groups_order():
    d = request.get_json()
    keys = d.get("keys") or []
    if not keys:
        return jsonify({"msg": "排序列表不能为空"}), 400
    conn = get_db()
    for i, key in enumerate(keys):
        conn.execute(
            "UPDATE config SET sort_order=? WHERE category='machine_groups' AND key=?",
            (i + 1, key),
        )
    conn.commit()
    conn.close()
    return jsonify({"msg": "排序已保存"})
```

- [ ] **Step 6: Update `/add_machine` to accept `group_name`**

In `add_machine()`, after `task_kind` handling, add:

```python
    group_name = (d.get("group_name") or "").strip()
    groups = get_allowed_machine_groups()
    if group_name and group_name not in groups:
        group_name = ""
    conn.execute("UPDATE machines SET group_name=? WHERE id=?", (group_name, int(new_id)))
```

And update the return json to include `group_name`:

```python
    return jsonify({"msg": "新增成功", "machine": {"id": new_id, "name": name, "type": mtype, "status": "空闲", "task_kind": task_kind, "group_name": group_name}})
```

- [ ] **Step 7: Update `/update_machine` to accept `group_name`**

In `update_machine()`, add before the UPDATE:

```python
    group_name = (d.get("group_name") or "").strip()
    groups = get_allowed_machine_groups()
    if group_name and group_name not in groups:
        group_name = ""
```

And change the UPDATE to include group_name:

```python
    conn.execute(
        "UPDATE machines SET sort_order=?, name=?, task_kind=?, group_name=? WHERE id=?",
        (sort_order, name, task_kind, group_name, mid),
    )
```

- [ ] **Step 8: Update `/add_machines_batch` to accept `group_name`**

In the `machine_list` branch (new format), add after `task_kind` handling:

```python
                group_name = (item.get("group_name") or "").strip()
                if group_name and group_name not in allowed_groups:
                    group_name = ""
```

And update the UPDATE to include group_name:

```python
                conn.execute("UPDATE machines SET task_kind=?, group_name=? WHERE id=?", (task_kind, group_name, int(new_id)))
```

Also update the old format branch similarly. Add `allowed_groups = get_allowed_machine_groups()` near the top.

- [ ] **Step 9: Commit**

```bash
git add routes/machines.py
git commit -m "feat: add machine group CRUD routes and group_name support to existing endpoints"
```

---

### Task 3: Models and Views

**Files:**
- Modify: `models.py:55` (`list_machines` signature)
- Modify: `routes/views.py:13-58` (index route)

- [ ] **Step 1: Update `list_machines()` for group filter**

Change the function signature to add `filter_group`:

```python
def list_machines(sort_by: str = "name", sort_dir: str = "asc", filter_type: Optional[str] = None, filter_status: Optional[str] = None, filter_kind: Optional[str] = None, filter_group: Optional[str] = None) -> List[Dict]:
```

After the `filter_kind` block (around line 79), add:

```python
    if filter_group:
        fg = str(filter_group).strip()
        allowed = get_allowed_machine_groups()
        if fg in allowed:
            machines = [m for m in machines if (m.get("group_name") or "") == fg]
        elif fg == "未分组":
            machines = [m for m in machines if not (m.get("group_name") or "")]
```

Also import `get_allowed_machine_groups` at top of models.py:

```python
from db import get_db, get_config, get_allowed_task_kinds, get_allowed_machine_types, get_allowed_machine_statuses, get_allowed_machine_groups
```

- [ ] **Step 2: Update index route to pass group config and filter**

In `routes/views.py`, add `m_group` from query params:

```python
    m_group = (request.args.get("m_group") or "").strip()
```

Pass it to the template and also add `machine_groups` to app_config (already handled by `load_app_config()` which reads all config categories). No extra code needed for that.

Add `m_group=m_group` to the `render_template` call.

- [ ] **Step 3: Add `machine_groups` to APP_CONFIG in index.html**

The `load_app_config()` reads ALL categories from config table, so `app_config.machine_groups` will automatically be available. Verify by checking the template:

No change needed — `app_config` already contains all config categories dynamically.

- [ ] **Step 4: Commit**

```bash
git add models.py routes/views.py
git commit -m "feat: add group filter support to list_machines and index route"
```

---

### Task 4: Machine Panel HTML Restructure

**Files:**
- Modify: `templates/panels/machines.html`

- [ ] **Step 1: Rewrite machines.html with collapsible sections, group support**

Replace the entire content of `templates/panels/machines.html`:

```html
    <!-- ==================== 机器管理 ==================== -->
    <div class="panel">
        <!-- 1. 新增机器（折叠模块） -->
        <div class="box collapsible-box" id="add-machine-box">
            <div class="collapsible-header" onclick="toggleCollapsible('add-machine-box')">
                <span class="collapse-arrow" id="add-machine-arrow">&#x25BC;</span>
                <h3>新增机器</h3>
                <span style="font-size:11px;color:var(--text-muted);">— 名称、机型、任务类型、分组</span>
            </div>
            <div class="collapsible-body" id="add-machine-body">
                <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
                    名称：<input id="m_name">
                    机型：<select id="m_type" onchange="onMachineTypeChange()">{% for mt in app_config.machine_types %}<option>{{mt.key}}</option>{% endfor %}</select>
                    任务类型：<select id="m_kind">{% for tk in app_config.task_kinds %}<option>{{tk.key}}</option>{% endfor %}</select>
                    分组：<select id="m_group" class="highlight-select">{% for mg in app_config.get('machine_groups', []) %}<option>{{mg.key}}</option>{% endfor %}<option value="" selected>未分组</option></select>
                    <button class="btn" onclick="addMachine()">新增</button>
                    <button class="btn" onclick="openBatchMachineDialog()">批量添加</button>
                </div>
            </div>
        </div>

        <!-- 2. 分组管理（折叠模块） -->
        <div class="box collapsible-box" id="group-manage-box">
            <div class="collapsible-header" onclick="toggleCollapsible('group-manage-box')">
                <span class="collapse-arrow" id="group-manage-arrow">&#x25BC;</span>
                <h3>&#x1F4C2; 分组管理</h3>
                <span id="group-count-badge" style="background:var(--warning);color:#fff;font-size:11px;padding:1px 8px;border-radius:10px;">{{ app_config.get('machine_groups', [])|length }}</span>
                <span style="font-size:11px;color:var(--text-muted);">— 拖拽排序，双击名称编辑</span>
            </div>
            <div class="collapsible-body" id="group-manage-body">
                <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;">
                    <input id="new-group-name" placeholder="输入新分组名称" style="width:160px;">
                    <button class="btn" onclick="addMachineGroup()">新建分组</button>
                </div>
                <div id="group-tags-container" style="display:flex;gap:8px;flex-wrap:wrap;">
                    {% for mg in app_config.get('machine_groups', []) %}
                    <span class="group-tag" draggable="true" data-group-name="{{mg.key}}" ondragstart="handleGroupDragStart(event)" ondragover="handleGroupDragOver(event)" ondragend="handleGroupDragEnd(event)" ondblclick="editGroupName(this)" style="display:inline-flex;align-items:center;gap:4px;background:var(--primary-light);color:var(--primary);padding:4px 12px;border-radius:4px;font-size:12px;cursor:grab;user-select:none;">⋮⋮ {{mg.key}} <span onclick="deleteMachineGroup(this)" style="cursor:pointer;margin-left:2px;">✕</span></span>
                    {% endfor %}
                </div>
                <div id="group-empty-hint" style="display:{{'none' if app_config.get('machine_groups', []) else 'block'}};color:var(--text-muted);font-size:12px;margin-top:8px;">暂无分组，在上方输入框中创建第一个分组</div>
            </div>
        </div>

        <!-- 3. 筛选栏 + 机器表格 -->
        <div class="box">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                    <b>筛选机型：</b>
                    <select id="machine-filter" onchange="changeMachineFilter()">
                        <option value="" {{'selected' if not m_type else ''}}>全部</option>
                        {% for mt in app_config.machine_types %}<option value="{{mt.key}}" {{'selected' if m_type==mt.key else ''}}>{{mt.key}}</option>{% endfor %}
                    </select>
                    <b>状态：</b>
                    <select id="machine-status-filter" onchange="changeMachineFilter()">
                        <option value="" {{'selected' if not m_status else ''}}>全部</option>
                        <option value="空闲" {{'selected' if m_status=='空闲' else ''}}>空闲</option>
                        <option value="工作" {{'selected' if m_status=='工作' else ''}}>工作</option>
                        <option value="维修停用" {{'selected' if m_status=='维修停用' else ''}}>维修停用</option>
                        <option value="隐藏维修" {{'selected' if m_status=='隐藏维修' else ''}}>隐藏维修</option>
                    </select>
                    <b>任务类型：</b>
                    <select id="machine-kind-filter" onchange="changeMachineFilter()">
                        <option value="" {{'selected' if not m_kind else ''}}>全部</option>
                        {% for tk in app_config.task_kinds %}<option value="{{tk.key}}" {{'selected' if m_kind==tk.key else ''}}>{{tk.key}}</option>{% endfor %}
                    </select>
                    <b style="color:var(--warning);">分组：</b>
                    <select id="machine-group-filter" onchange="changeMachineFilter()" class="highlight-select">
                        <option value="" {{'selected' if not m_group else ''}}>全部</option>
                        {% for mg in app_config.get('machine_groups', []) %}<option value="{{mg.key}}" {{'selected' if m_group==mg.key else ''}}>{{mg.key}}</option>{% endfor %}
                        <option value="未分组" {{'selected' if m_group=='未分组' else ''}}>未分组</option>
                    </select>
                </div>
            </div>
            <table>
                <tr>
                    <th><a href="?date={{selected_date}}&m_type={{m_type}}&m_sort=type&m_dir={{'desc' if m_sort=='type' and m_dir=='asc' else 'asc'}}">机型{% if m_sort=='type' %}({{m_dir}}){% endif %}</a></th>
                    <th><a href="?date={{selected_date}}&m_type={{m_type}}&m_sort=name&m_dir={{'desc' if m_sort=='name' and m_dir=='asc' else 'asc'}}">名称{% if m_sort=='name' %}({{m_dir}}){% endif %}</a></th>
                    <th><a href="?date={{selected_date}}&m_type={{m_type}}&m_sort=status&m_dir={{'desc' if m_sort=='status' and m_dir=='asc' else 'asc'}}">状态{% if m_sort=='status' %}({{m_dir}}){% endif %}</a></th>
                    <th><a href="?date={{selected_date}}&m_type={{m_type}}&m_sort=task_kind&m_dir={{'desc' if m_sort=='task_kind' and m_dir=='asc' else 'asc'}}">任务类型{% if m_sort=='task_kind' %}({{m_dir}}){% endif %}</a></th>
                    <th>分组</th>
                    <th>操作</th>
                </tr>
            </table>
            <!-- 已隐藏机器表格模块 -->
            <div id="hidden-machines-module" class="table-module" style="display:none;margin-top:16px;">
                <div class="table-module-header" onclick="toggleHiddenMachinesSection()" style="display:flex;align-items:center;gap:8px;padding:10px 16px;background:#f8fafc;border:1px solid var(--border);border-radius:8px 8px 0 0;cursor:pointer;user-select:none;">
                    <span style="font-size:14px;font-weight:600;">&#x1F441;&#x200D;&#x1F5E8; 已隐藏的机器</span>
                    <span id="hidden-machines-count" style="background:#e5e7eb;color:#6b7280;font-size:12px;padding:2px 8px;border-radius:10px;">0</span>
                    <span style="font-size:12px;color:#9ca3af;">— 不在时间轴上显示，但任务仍在进行</span>
                    <span class="collapse-arrow" style="margin-left:auto;font-size:12px;color:#9ca3af;">&#x25B4;</span>
                </div>
                <div class="table-module-body" style="border:1px solid var(--border);border-top:none;border-radius:0 0 8px 8px;overflow:hidden;">
                    <table>
                        <thead>
                            <tr>
                                <th>机型</th>
                                <th>名称</th>
                                <th>状态</th>
                                <th>任务类型</th>
                                <th>分组</th>
                                <th style="text-align:center;width:40px">&#x1F441;</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody id="hidden-machines-tbody"></tbody>
                    </table>
                    <div style="text-align:right;padding:8px 12px;border-top:1px solid var(--border-light);">
                        <button id="hidden-restore-all-btn" onclick="restoreAllHiddenMachines()" style="font-size:12px;padding:4px 12px;">全部恢复显示</button>
                    </div>
                </div>
            </div>
        </div>
    </div>
```

- [ ] **Step 2: Add collapsible CSS to style.css**

Append to `static/style.css`:

```css
/* 折叠模块 */
.collapsible-box { border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.collapsible-header {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 16px; background: var(--bg-body); cursor: pointer;
    user-select: none; border-bottom: 1px solid var(--border);
}
.collapsible-header h3 { font-size: 14px; margin: 0; }
.collapsible-body { padding: 12px 16px; }
.collapsible-box.collapsed .collapsible-body { display: none; }
.collapsible-box.collapsed .collapsible-header { border-bottom: none; }
.collapsible-box.collapsed .collapse-arrow { transform: rotate(-90deg); }
.collapse-arrow { display: inline-block; transition: transform var(--transition); font-size: 12px; }

/* 分组标签 */
.group-tag { transition: var(--transition); }
.group-tag:hover { filter: brightness(0.95); }
.group-tag.drag-over { outline: 2px dashed var(--primary); outline-offset: 2px; }

/* 黄色高亮下拉 */
select.highlight-select {
    border-color: var(--warning) !important;
    background: var(--warning-light) !important;
}
```

- [ ] **Step 3: Commit**

```bash
git add templates/panels/machines.html static/style.css
git commit -m "feat: restructure machine panel with collapsible sections and group management area"
```

---

### Task 5: Machine Panel JS — Filter, Table Column, Group Management

**Files:**
- Modify: `static/core.js:101-137` (`_filterMachinesByUI`)
- Modify: `static/core.js:230-238` (add `_groupOptions` helper)
- Modify: `static/timeline.js:111-121` (`changeMachineFilter`)
- Modify: `static/timeline.js:137-215` (`_renderMachineTable`, `_renderHiddenMachineTable`)
- Modify: `static/machines.js:1-65` (`addMachine`, `_appendMachineRow`)
- Modify: `static/machines.js:171-186` (`saveMachineName`)
- Modify: `static/machines.js:187-212` (`saveAllMachines`)

- [ ] **Step 1: Add `_groupOptions` helper in core.js**

After `_taskKindOptions` (core.js line ~238):

```javascript
function _groupOptions(selected) {
    var groups = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.machine_groups && APP_CONFIG.machine_groups.length) ? APP_CONFIG.machine_groups : [];
    var html = '<option value="">未分组</option>';
    for (var i = 0; i < groups.length; i++) {
        var g = groups[i].key;
        html += '<option' + (g === selected ? ' selected' : '') + '>' + escHtml(g) + '</option>';
    }
    html += '<option value="__new_group__">+ 新建分组...</option>';
    return html;
}
```

- [ ] **Step 2: Add group filter in `_filterMachinesByUI` in core.js**

In `_filterMachinesByUI` (core.js line ~101), add after `filterKind`:

```javascript
    var filterGroup = document.getElementById('machine-group-filter') ? document.getElementById('machine-group-filter').value : '';
```

And in the filter block, add after the `filterKind` check:

```javascript
            if (filterGroup) {
                if (filterGroup === '未分组') { if (m.group_name) return false; }
                else { if (m.group_name !== filterGroup) return false; }
            }
```

- [ ] **Step 3: Add group to `changeMachineFilter` in timeline.js**

In `changeMachineFilter()` (timeline.js line ~111), add after `vk`:

```javascript
    var vg = document.getElementById('machine-group-filter') ? document.getElementById('machine-group-filter').value : '';
```

And in the URL update, add:

```javascript
    if(vg) url.searchParams.set('m_group', vg); else url.searchParams.delete('m_group');
```

- [ ] **Step 4: Add group column to `_renderMachineTable` in timeline.js**

After the task_kind cell (line ~155), insert before the eye-toggle cell:

```javascript
            '<td>'+
                '<select id="mg_'+m.id+'" data-orig="'+escHtml(m.group_name||'')+'" onchange="saveMachineName('+m.id+')">'+
                    _groupOptions(m.group_name)+
                '</select>'+
            '</td>'+
```

And update the header row (line ~142) to include `<th>分组</th>` between task_kind and the eye column:

Change:
```javascript
    var html = '<tr><th>'+_sortLink('机型','type')+'</th><th>'+_sortLink('名称','name')+'</th><th>'+_sortLink('状态','status')+'</th><th>'+_sortLink('任务类型','task_kind')+'</th><th style="text-align:center;width:40px">&#x1F441;</th><th>操作</th></tr>';
```
To:
```javascript
    var html = '<tr><th>'+_sortLink('机型','type')+'</th><th>'+_sortLink('名称','name')+'</th><th>'+_sortLink('状态','status')+'</th><th>'+_sortLink('任务类型','task_kind')+'</th><th>分组</th><th style="text-align:center;width:40px">&#x1F441;</th><th>操作</th></tr>';
```

- [ ] **Step 5: Add group column to `_renderHiddenMachineTable` in timeline.js**

Apply the same changes to `_renderHiddenMachineTable` (timeline.js ~line 167-196). Add group cell after task_kind, and update the header.

- [ ] **Step 6: Update `addMachine` to send group_name in machines.js**

In `addMachine()` (machines.js line ~1), add group element and include in request:

```javascript
function addMachine(){
    const nameEl = document.getElementById('m_name');
    const typeEl = document.getElementById('m_type');
    const kindEl = document.getElementById('m_kind');
    const groupEl = document.getElementById('m_group');
    const name = (nameEl.value || '').trim();
    const mtype = typeEl.value;
    const mkind = kindEl.value;
    const mgroup = groupEl ? groupEl.value : '';

    function doAdd(){
        fetch('/add_machine',{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({name: name, type: mtype, task_kind: mkind, group_name: mgroup})
        }).then(r=>r.json()).then(d=>{
            if(d.machine){
                _appendMachineRow(d.machine);
                nameEl.value = mtype + '-';
                nameEl.focus();
                showToast(d.msg);
            } else {
                showToast(d.msg);
            }
        });
    }
    // ... rest unchanged
```

- [ ] **Step 7: Update `_appendMachineRow` to include group column in machines.js**

In `_appendMachineRow()` (machines.js line ~31), add group cell after task_kind cell:

After the task_kind `</td>` (line ~48), insert:

```javascript
        '<td>'+
            '<select id=\"mg_'+m.id+'\" data-orig=\"'+escHtml(m.group_name||'')+'\" onchange=\"saveMachineName('+m.id+')\">'+
                _groupOptions(m.group_name)+
            '</select>'+
        '</td>'+
```

- [ ] **Step 8: Update `saveMachineName` to include group_name in machines.js**

In `saveMachineName()` (machines.js line ~171), add:

```javascript
    var group_name = document.getElementById('mg_'+id) ? document.getElementById('mg_'+id).value : '';
```

And update the fetch body:

```javascript
        body:JSON.stringify({id:id,name:name,task_kind:task_kind,group_name:group_name})
```

Also add group dropdown data-orig update after save (around line ~182):

```javascript
        var groupSel = document.getElementById('mg_'+id);
        if(groupSel) groupSel.dataset.orig = groupSel.value;
```

Same updates for `saveAllMachines()` — include `group_name` field.

- [ ] **Step 9: Add group management JS functions to machines.js**

Append to `static/machines.js`:

```javascript
// ========== 分组管理 ==========

function toggleCollapsible(boxId) {
    var box = document.getElementById(boxId);
    if (!box) return;
    box.classList.toggle('collapsed');
    try { localStorage.setItem('ui_collapse_' + boxId, box.classList.contains('collapsed') ? '1' : '0'); } catch(e) {}
}

function initCollapsibleState() {
    ['add-machine-box', 'group-manage-box'].forEach(function(id) {
        var box = document.getElementById(id);
        if (!box) return;
        try { if (localStorage.getItem('ui_collapse_' + id) === '1') box.classList.add('collapsed'); } catch(e) {}
    });
}

function addMachineGroup() {
    var input = document.getElementById('new-group-name');
    var name = (input.value || '').trim();
    if (!name) { showToast('分组名不能为空'); return; }
    fetch('/add_machine_group', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({name: name})
    }).then(function(r) { return r.json(); }).then(function(d) {
        showToast(d.msg);
        if (d.group) {
            _appendGroupTag(d.group.key);
            _refreshGroupSelects();
            input.value = '';
            _updateGroupCount();
            _updateGroupEmptyHint();
        }
    });
}

function _appendGroupTag(name) {
    var container = document.getElementById('group-tags-container');
    var span = document.createElement('span');
    span.className = 'group-tag';
    span.setAttribute('draggable', 'true');
    span.dataset.groupName = name;
    span.ondragstart = handleGroupDragStart;
    span.ondragover = handleGroupDragOver;
    span.ondragend = handleGroupDragEnd;
    span.ondblclick = function() { editGroupName(this); };
    span.style.cssText = 'display:inline-flex;align-items:center;gap:4px;background:var(--primary-light);color:var(--primary);padding:4px 12px;border-radius:4px;font-size:12px;cursor:grab;user-select:none;';
    span.innerHTML = '⋮⋮ ' + escHtml(name) + ' <span style="cursor:pointer;margin-left:2px;">✕</span>';
    span.querySelector('span').onclick = function(e) { e.stopPropagation(); deleteMachineGroup(span.querySelector('span')); };
    container.appendChild(span);
}

function editGroupName(tagEl) {
    var oldName = tagEl.dataset.groupName;
    var newName = prompt('修改分组名称：', oldName);
    if (!newName || newName.trim() === oldName) return;
    newName = newName.trim();
    fetch('/update_machine_group', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({old_name: oldName, new_name: newName})
    }).then(function(r) { return r.json(); }).then(function(d) {
        showToast(d.msg);
        if (d.msg.indexOf('成功') >= 0 || d.msg.indexOf('已更新') >= 0) {
            tagEl.dataset.groupName = newName;
            tagEl.childNodes[1].textContent = ' ' + newName + ' ';
            var xSpan = document.createElement('span');
            xSpan.style.cssText = 'cursor:pointer;margin-left:2px;';
            xSpan.textContent = '✕';
            xSpan.onclick = function(e) { e.stopPropagation(); deleteMachineGroup(xSpan); };
            tagEl.appendChild(xSpan);
            _refreshGroupSelects();
        }
    });
}

function deleteMachineGroup(xEl) {
    var tag = xEl.parentElement;
    var name = tag.dataset.groupName;
    showConfirm('删除分组', '<p>确定删除分组 "<b>' + escHtml(name) + '</b>"？</p><p style="font-size:12px;color:var(--text-muted);">该分组下的机器将变为"未分组"</p>').then(function(ok) {
        if (!ok) return;
        fetch('/delete_machine_group', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({name: name})
        }).then(function(r) { return r.json(); }).then(function(d) {
            showToast(d.msg);
            tag.remove();
            _refreshGroupSelects();
            _updateGroupCount();
            _updateGroupEmptyHint();
            _refreshMachineList();
        });
    });
}

var _groupDragSrc = null;

function handleGroupDragStart(e) {
    _groupDragSrc = this;
    this.style.opacity = '0.5';
    e.dataTransfer.effectAllowed = 'move';
}

function handleGroupDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    this.classList.add('drag-over');
}

function handleGroupDragEnd(e) {
    this.style.opacity = '1';
    this.classList.remove('drag-over');
    if (!_groupDragSrc || _groupDragSrc === this) return;
    var container = document.getElementById('group-tags-container');
    var tags = Array.from(container.querySelectorAll('.group-tag'));
    tags.forEach(function(t) { t.classList.remove('drag-over'); });
    var srcIdx = tags.indexOf(_groupDragSrc);
    var destIdx = tags.indexOf(this);
    if (srcIdx < 0 || destIdx < 0) return;
    if (srcIdx < destIdx) {
        container.insertBefore(_groupDragSrc, this.nextSibling);
    } else {
        container.insertBefore(_groupDragSrc, this);
    }
    _groupDragSrc = null;
    _saveGroupOrder();
}

function _saveGroupOrder() {
    var container = document.getElementById('group-tags-container');
    var tags = container.querySelectorAll('.group-tag');
    var keys = Array.from(tags).map(function(t) { return t.dataset.groupName; });
    fetch('/update_machine_groups_order', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({keys: keys})
    });
}

function _refreshGroupSelects() {
    fetch('/api/machine_groups').then(function(r) { return r.json(); }).then(function(d) {
        // Update APP_CONFIG
        if (typeof APP_CONFIG !== 'undefined') APP_CONFIG.machine_groups = d.groups;
        // Refresh machine list table
        _refreshMachineList();
    });
}

function _updateGroupCount() {
    var container = document.getElementById('group-tags-container');
    var badge = document.getElementById('group-count-badge');
    if (badge && container) {
        badge.textContent = container.querySelectorAll('.group-tag').length;
    }
}

function _updateGroupEmptyHint() {
    var container = document.getElementById('group-tags-container');
    var hint = document.getElementById('group-empty-hint');
    if (hint && container) {
        hint.style.display = container.querySelectorAll('.group-tag').length === 0 ? 'block' : 'none';
    }
}
```

- [ ] **Step 10: Add `__new_group__` handling to `saveMachineName`**

In `saveMachineName()`, after reading `group_name`, handle the special value:

```javascript
    if (group_name === '__new_group__') {
        var newName = prompt('输入新分组名称：');
        if (!newName || !(newName = newName.trim())) {
            var gsel = document.getElementById('mg_'+id);
            if (gsel) gsel.value = gsel.dataset.orig;
            return;
        }
        fetch('/add_machine_group', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({name: newName})
        }).then(function(r) { return r.json(); }).then(function(d) {
            if (d.group) {
                group_name = newName;
                _appendGroupTag(newName);
                _refreshGroupSelects();
                _updateGroupCount();
                _updateGroupEmptyHint();
                _continueSaveMachine(id, name, task_kind, group_name);
            } else {
                showToast(d.msg);
            }
        });
        return;
    }
    _continueSaveMachine(id, name, task_kind, group_name);
```

And refactor the existing fetch call into `_continueSaveMachine`:

```javascript
function _continueSaveMachine(id, name, task_kind, group_name) {
    fetch('/update_machine',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({id:id,name:name,task_kind:task_kind,group_name:group_name})
    }).then(function(r){return r.json();}).then(function(d){
        showToast(d.msg);
        var inp = document.getElementById('mn_'+id);
        var btn = document.getElementById('ms_'+id);
        var kindSel = document.getElementById('mk_'+id);
        var groupSel = document.getElementById('mg_'+id);
        if(inp) inp.dataset.orig = inp.value;
        if(kindSel) kindSel.dataset.orig = kindSel.value;
        if(groupSel) groupSel.dataset.orig = groupSel.value;
        if(btn) btn.style.display = 'none';
        _refreshTimelineFromServer();
    });
}
```

Update `saveMachineName()` to call `_continueSaveMachine` at the end for normal (non-new-group) path.

- [ ] **Step 11: Call `initCollapsibleState()` on page load**

Add call in `static/core.js` at the end or in the DOMContentLoaded handler. Find where initial tab load happens and add:

```javascript
    initCollapsibleState();
```

- [ ] **Step 12: Commit**

```bash
git add static/core.js static/timeline.js static/machines.js
git commit -m "feat: add group filter, table column, and group management JS logic"
```

---

### Task 6: Merged Batch Add Dialog HTML

**Files:**
- Modify: `templates/dialogs/all.html`

- [ ] **Step 1: Remove old dialogs and add merged batch dialog**

Remove both `batch-machine-dialog` (line ~419-437) and `input-add-machine-dialog` (line ~439-456).

Insert the merged dialog in their place:

```html
<!-- 批量添加机器弹窗（合并版） -->
<div id="batch-machine-dialog" style="display:none;position:fixed;left:50%;top:5%;transform:translateX(-50%);z-index:2000;min-width:680px;max-width:95vw;max-height:88vh;overflow-y:auto;background:var(--bg-card);border-radius:var(--radius);padding:0;box-shadow:var(--shadow-xl);">
    <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 24px;border-bottom:1px solid var(--border);">
        <h3 style="margin:0;font-size:16px;">&#x1F4E6; 批量添加机器</h3>
        <button onclick="closeBatchMachineDialog()" style="font-size:20px;background:none;border:none;cursor:pointer;color:var(--text-muted);">&times;</button>
    </div>
    <div style="padding:20px 24px;">

        <!-- Tabs -->
        <div style="display:flex;gap:0;margin-bottom:14px;border-bottom:2px solid var(--border);">
            <button class="batch-tab active" onclick="switchBatchTab('range')" id="batch-tab-range" style="padding:8px 18px;font-size:12px;font-weight:600;cursor:pointer;background:var(--bg-card);color:var(--primary);border:2px solid var(--border);border-bottom:2px solid var(--bg-card);border-radius:var(--radius-xs) var(--radius-xs) 0 0;margin-bottom:-2px;margin-right:2px;">&#x1F4D0; 范围生成</button>
            <button class="batch-tab" onclick="switchBatchTab('paste')" id="batch-tab-paste" style="padding:8px 18px;font-size:12px;font-weight:600;cursor:pointer;background:var(--bg-deep);color:var(--text-muted);border:none;border-radius:var(--radius-xs) var(--radius-xs) 0 0;margin-right:2px;">&#x1F4DD; 粘贴列表</button>
        </div>

        <!-- Tab 1: 范围生成 -->
        <div class="batch-input-method" id="batch-method-range" style="display:block;">
            <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;background:var(--bg-body);padding:14px 16px;border-radius:var(--radius-sm);border:1px solid var(--border);">
                <div class="field-group"><label>机型</label><select id="bm_type">{% for mt in app_config.machine_types %}<option>{{mt.key}}</option>{% endfor %}</select></div>
                <div class="field-group"><label>任务类型</label><select id="bm_kind">{% for tk in app_config.task_kinds %}<option>{{tk.key}}</option>{% endfor %}</select></div>
                <div class="field-group"><label>分组</label><select id="bm_group" class="highlight-select">{% for mg in app_config.get('machine_groups', []) %}<option>{{mg.key}}</option>{% endfor %}<option value="" selected>未分组</option></select></div>
                <div class="field-group" style="flex:1;min-width:160px;"><label>名称范围</label><input id="bm_range" placeholder="如 01-12 或 01,03,05" style="width:100%;"></div>
                <button class="btn btn-primary" onclick="generateBatchFromRange()">生成列表</button>
            </div>
            <p style="font-size:11px;color:var(--text-muted);margin-top:6px;">自动补全为 "机型-编号"，新行使用左侧设定的机型/任务类型/分组</p>
        </div>

        <!-- Tab 2: 粘贴列表 -->
        <div class="batch-input-method" id="batch-method-paste" style="display:none;">
            <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;background:var(--bg-body);padding:10px 16px;border-radius:var(--radius-sm);border:1px solid var(--border);margin-bottom:10px;">
                <div class="field-group"><label>默认机型</label><select id="bp_type">{% for mt in app_config.machine_types %}<option>{{mt.key}}</option>{% endfor %}</select></div>
                <div class="field-group"><label>默认任务类型</label><select id="bp_kind">{% for tk in app_config.task_kinds %}<option>{{tk.key}}</option>{% endfor %}</select></div>
                <div class="field-group"><label>默认分组</label><select id="bp_group" class="highlight-select">{% for mg in app_config.get('machine_groups', []) %}<option>{{mg.key}}</option>{% endfor %}<option value="" selected>未分组</option></select></div>
                <span style="font-size:11px;color:var(--text-muted);padding-bottom:8px;">未指定字段用此默认值</span>
            </div>
            <textarea id="bp_textarea" style="width:100%;height:130px;font-family:monospace;font-size:12px;line-height:1.7;padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);resize:vertical;background:var(--bg-card);color:var(--text-primary);" placeholder="每行一台机器，支持格式：&#10;BR1-01&#10;BR2-10(接管)&#10;Mini-03(移动, A组)&#10;BR1-05(A组)"></textarea>
            <div style="font-size:11px;color:var(--text-muted);margin-top:6px;">解析规则：<code>名称(任务类型)</code> · <code>名称(, 分组)</code> · <code>名称(任务类型, 分组)</code></div>
            <button class="btn btn-primary" onclick="generateBatchFromPaste()" style="margin-top:8px;">解析并添加至列表</button>
        </div>

        <!-- 结果表格 -->
        <div style="border-top:1px dashed var(--border);margin:16px 0;"></div>
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--bg-body);border-radius:var(--radius-xs);margin-bottom:6px;font-size:12px;">
            <span>共 <b id="batch-row-count" style="color:var(--primary);">0</b> 台机器</span>
            <span style="font-size:11px;color:var(--text-muted);">下拉框可逐台覆盖 · 黄底 = 不同于默认设定</span>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
                <tr style="border-bottom:2px solid var(--border);"><th style="text-align:left;padding:8px 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);background:var(--bg-body);">#</th><th style="text-align:left;padding:8px 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);background:var(--bg-body);">机器名</th><th style="text-align:left;padding:8px 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);background:var(--bg-body);">机型</th><th style="text-align:left;padding:8px 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);background:var(--bg-body);">任务类型</th><th style="text-align:left;padding:8px 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted);background:var(--bg-body);">分组</th><th style="width:30px;"></th></tr>
            </thead>
            <tbody id="batch-machines-tbody"></tbody>
        </table>
        <div style="text-align:center;margin-top:10px;">
            <button class="btn btn-sm" onclick="addBatchManualRow()" style="color:var(--primary);border-style:dashed;">+ 手动添加一行</button>
        </div>

    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end;padding:14px 24px;border-top:1px solid var(--border);background:var(--bg-body);">
        <button class="btn" onclick="closeBatchMachineDialog()">取消</button>
        <button class="btn btn-primary" onclick="executeBatchAdd()">确认添加 <span id="batch-confirm-count">0</span> 台</button>
    </div>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add templates/dialogs/all.html
git commit -m "feat: replace old batch/input dialogs with merged batch add dialog"
```

---

### Task 7: Merged Batch Dialog JS

**Files:**
- Modify: `static/machines.js` (replace old batch/input functions)

- [ ] **Step 1: Remove old batch and input add functions from machines.js**

Delete: `openBatchMachineDialog`, `closeBatchMachineDialog`, `_previewBatchMachines`, `_parseMachineRange`, `executeBatchAdd` (old version), `openInputAddMachineDialog`, `closeInputAddMachineDialog`, `_parseMachineInputLine`, `previewInputAddMachines`, `executeInputAddMachines`.

- [ ] **Step 2: Add merged batch dialog JS**

Append to `static/machines.js`:

```javascript
// ========== 合并批量添加弹窗 ==========

var _batchMachineRows = [];  // {name, type, task_kind, group_name}

function openBatchMachineDialog() {
    var dlg = document.getElementById('batch-machine-dialog');
    if (!dlg) return;
    // Sync type/kind/group from main page defaults
    var typeEl = document.getElementById('m_type');
    var kindEl = document.getElementById('m_kind');
    var groupEl = document.getElementById('m_group');
    if (typeEl) document.getElementById('bm_type').value = typeEl.value;
    if (kindEl) document.getElementById('bm_kind').value = kindEl.value;
    if (groupEl) document.getElementById('bm_group').value = groupEl.value;
    document.getElementById('bm_range').value = '';
    document.getElementById('bp_textarea').value = '';
    _batchMachineRows = [];
    _renderBatchTable();
    // Reset to range tab
    switchBatchTab('range');
    dlg.style.display = 'block';
}

function closeBatchMachineDialog() {
    document.getElementById('batch-machine-dialog').style.display = 'none';
}

function switchBatchTab(tab) {
    var rangeTab = document.getElementById('batch-tab-range');
    var pasteTab = document.getElementById('batch-tab-paste');
    var rangeMethod = document.getElementById('batch-method-range');
    var pasteMethod = document.getElementById('batch-method-paste');
    if (tab === 'range') {
        rangeTab.className = 'batch-tab active';
        pasteTab.className = 'batch-tab';
        rangeTab.style.cssText = 'padding:8px 18px;font-size:12px;font-weight:600;cursor:pointer;background:var(--bg-card);color:var(--primary);border:2px solid var(--border);border-bottom:2px solid var(--bg-card);border-radius:var(--radius-xs) var(--radius-xs) 0 0;margin-bottom:-2px;margin-right:2px;';
        pasteTab.style.cssText = 'padding:8px 18px;font-size:12px;font-weight:600;cursor:pointer;background:var(--bg-deep);color:var(--text-muted);border:none;border-radius:var(--radius-xs) var(--radius-xs) 0 0;margin-right:2px;';
        rangeMethod.style.display = 'block';
        pasteMethod.style.display = 'none';
    } else {
        pasteTab.className = 'batch-tab active';
        rangeTab.className = 'batch-tab';
        pasteTab.style.cssText = 'padding:8px 18px;font-size:12px;font-weight:600;cursor:pointer;background:var(--bg-card);color:var(--primary);border:2px solid var(--border);border-bottom:2px solid var(--bg-card);border-radius:var(--radius-xs) var(--radius-xs) 0 0;margin-bottom:-2px;margin-right:2px;';
        rangeTab.style.cssText = 'padding:8px 18px;font-size:12px;font-weight:600;cursor:pointer;background:var(--bg-deep);color:var(--text-muted);border:none;border-radius:var(--radius-xs) var(--radius-xs) 0 0;margin-right:2px;';
        pasteMethod.style.display = 'block';
        rangeMethod.style.display = 'none';
    }
}

function generateBatchFromRange() {
    var type = document.getElementById('bm_type').value;
    var kind = document.getElementById('bm_kind').value;
    var group = document.getElementById('bm_group').value;
    var raw = document.getElementById('bm_range').value.trim();
    var names = _parseMachineRange(type, raw);
    if (names.length === 0) {
        showToast('请输入有效的名称范围');
        return;
    }
    for (var i = 0; i < names.length; i++) {
        _batchMachineRows.push({name: names[i], type: type, task_kind: kind, group_name: group});
    }
    _renderBatchTable();
    document.getElementById('bm_range').value = '';
}

function generateBatchFromPaste() {
    var type = document.getElementById('bp_type').value;
    var kind = document.getElementById('bp_kind').value;
    var group = document.getElementById('bp_group').value;
    var raw = document.getElementById('bp_textarea').value;
    var lines = raw.split(/[\r\n]+/);
    // Get group names for parsing
    var groupNames = [];
    var groupSelect = document.getElementById('bp_group');
    if (groupSelect) {
        for (var i = 0; i < groupSelect.options.length; i++) {
            if (groupSelect.options[i].value) groupNames.push(groupSelect.options[i].value);
        }
    }
    var kindNames = [];
    var kindSelect = document.getElementById('bp_kind');
    if (kindSelect) {
        for (var i = 0; i < kindSelect.options.length; i++) {
            kindNames.push(kindSelect.options[i].value);
        }
    }
    var machineTypes = [];
    var typeSelect = document.getElementById('bp_type');
    if (typeSelect) {
        for (var i = 0; i < typeSelect.options.length; i++) {
            machineTypes.push(typeSelect.options[i].value);
        }
    }
    machineTypes.sort(function(a,b){ return b.length - a.length; });

    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line) continue;

        // Detect type prefix
        var detectedType = null;
        for (var t = 0; t < machineTypes.length; t++) {
            if (line.indexOf(machineTypes[t]) === 0) {
                detectedType = machineTypes[t];
                break;
            }
        }
        if (!detectedType) continue;

        var machineName = line;
        var taskKind = kind;
        var groupName = group;

        // Parse parentheses: name(thing1, thing2)
        var parenMatch = line.match(/[\(（]([^\)）]+)[\)）]$/);
        if (parenMatch) {
            machineName = line.substring(0, parenMatch.index).trim();
            var parts = parenMatch[1].split(/[,，]/);
            var first = (parts[0] || '').trim();
            var second = (parts[1] || '').trim();

            // Try to match first part
            if (first) {
                if (kindNames.indexOf(first) >= 0) {
                    taskKind = first;
                } else if (groupNames.indexOf(first) >= 0) {
                    groupName = first;
                } else {
                    taskKind = first; // fallback: treat as task kind
                }
            }
            // Try to match second part
            if (second) {
                if (groupNames.indexOf(second) >= 0) {
                    groupName = second;
                } else if (kindNames.indexOf(second) >= 0 && taskKind === kind) {
                    taskKind = second;
                }
            }
        }

        _batchMachineRows.push({name: machineName, type: detectedType, task_kind: taskKind, group_name: groupName});
    }
    _renderBatchTable();
    document.getElementById('bp_textarea').value = '';
}

function addBatchManualRow() {
    var type = document.getElementById('bm_type').value;
    var kind = document.getElementById('bm_kind').value;
    _batchMachineRows.push({name: '', type: type, task_kind: kind, group_name: ''});
    _renderBatchTable();
}

function _removeBatchRow(index) {
    _batchMachineRows.splice(index, 1);
    _renderBatchTable();
}

function _renderBatchTable() {
    var tbody = document.getElementById('batch-machines-tbody');
    var totalCount = document.getElementById('batch-row-count');
    var confirmCount = document.getElementById('batch-confirm-count');
    if (!tbody) return;

    // Get defaults for highlighting
    var defaultType = document.getElementById('bm_type') ? document.getElementById('bm_type').value : '';
    var defaultKind = document.getElementById('bm_kind') ? document.getElementById('bm_kind').value : '';
    var defaultGroup = (document.getElementById('bm_group') || document.getElementById('bp_group') || {}).value || '';

    var machineTypes = [];
    var typeSelect = document.getElementById('bm_type') || document.getElementById('bp_type');
    if (typeSelect) { for (var i=0; i<typeSelect.options.length; i++) machineTypes.push(typeSelect.options[i].value); }

    var taskKinds = [];
    var kindSelect = document.getElementById('bm_kind') || document.getElementById('bp_kind');
    if (kindSelect) { for (var i=0; i<kindSelect.options.length; i++) taskKinds.push(kindSelect.options[i].value); }

    var groupNames = [];
    var groupSelect = document.getElementById('bm_group') || document.getElementById('bp_group');
    if (groupSelect) { for (var i=0; i<groupSelect.options.length; i++) { if (groupSelect.options[i].value) groupNames.push(groupSelect.options[i].value); } }

    var html = '';
    for (var i = 0; i < _batchMachineRows.length; i++) {
        var row = _batchMachineRows[i];
        var typeChanged = row.type !== defaultType;
        var kindChanged = row.task_kind !== defaultKind;
        var groupChanged = row.group_name !== defaultGroup;
        var rowModified = typeChanged || kindChanged || groupChanged;

        html += '<tr' + (rowModified ? ' style="background:var(--warning-light);"' : '') + '>';
        html += '<td style="padding:7px 10px;font-size:11px;color:var(--text-muted);width:30px;text-align:center;">' + (i+1) + (rowModified ? '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--warning);margin-left:4px;"></span>' : '') + '</td>';
        html += '<td style="padding:7px 10px;"><input value="' + escHtml(row.name) + '" onchange="_updateBatchRow(' + i + ', \'name\', this.value)" style="width:120px;font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:var(--radius-xs);"></td>';
        html += '<td style="padding:7px 10px;"><select onchange="_updateBatchRow(' + i + ', \'type\', this.value)" style="font-size:12px;padding:5px 8px;border:1px solid ' + (typeChanged ? 'var(--warning)' : 'transparent') + ';border-radius:var(--radius-xs);background:' + (typeChanged ? 'var(--warning-light)' : 'transparent') + ';">' + _optionsHtml(machineTypes, row.type) + '</select></td>';
        html += '<td style="padding:7px 10px;"><select onchange="_updateBatchRow(' + i + ', \'task_kind\', this.value)" style="font-size:12px;padding:5px 8px;border:1px solid ' + (kindChanged ? 'var(--warning)' : 'transparent') + ';border-radius:var(--radius-xs);background:' + (kindChanged ? 'var(--warning-light)' : 'transparent') + ';">' + _optionsHtml(taskKinds, row.task_kind) + '</select></td>';
        html += '<td style="padding:7px 10px;"><select onchange="_updateBatchRow(' + i + ', \'group_name\', this.value)" style="font-size:12px;padding:5px 8px;border:1px solid ' + (groupChanged ? 'var(--warning)' : 'transparent') + ';border-radius:var(--radius-xs);background:' + (groupChanged ? 'var(--warning-light)' : 'transparent') + ';"><option value="">未分组</option>' + _optionsHtml(groupNames, row.group_name) + '</select></td>';
        html += '<td style="padding:7px 10px;"><button onclick="_removeBatchRow(' + i + ')" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:16px;" title="移除">&times;</button></td>';
        html += '</tr>';
    }

    tbody.innerHTML = html;
    if (totalCount) totalCount.textContent = _batchMachineRows.length;
    if (confirmCount) confirmCount.textContent = _batchMachineRows.length;
}

function _optionsHtml(options, selected) {
    var html = '';
    for (var i = 0; i < options.length; i++) {
        html += '<option' + (options[i] === selected ? ' selected' : '') + '>' + escHtml(options[i]) + '</option>';
    }
    return html;
}

function _updateBatchRow(index, field, value) {
    _batchMachineRows[index][field] = value;
    _renderBatchTable();
}

function executeBatchAdd() {
    if (_batchMachineRows.length === 0) {
        showToast('没有要添加的机器');
        return;
    }
    // Filter out rows with empty names
    var valid = _batchMachineRows.filter(function(r) { return (r.name || '').trim(); });
    if (valid.length === 0) {
        showToast('请填写机器名称');
        return;
    }
    var machines = valid.map(function(r) {
        return {name: r.name.trim(), type: r.type, task_kind: r.task_kind, group_name: r.group_name || ''};
    });
    showConfirm('批量添加', '<p>确认添加 <b>' + machines.length + '</b> 台机器？</p>').then(function(ok) {
        if (!ok) return;
        fetch('/add_machines_batch', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({machines: machines})
        }).then(function(r) { return r.json(); }).then(function(d) {
            showToast(d.msg);
            closeBatchMachineDialog();
            _silentRefresh({machines: true});
        });
    });
}
```

- [ ] **Step 2: Commit**

```bash
git add static/machines.js
git commit -m "feat: add merged batch add dialog JS with tab switching and paste parsing"
```

---

### Task 8: Integration — CSS Fixes and Final Verification

**Files:**
- Modify: `static/style.css` (add any missing styles)

- [ ] **Step 1: Add missing CSS styles**

Ensure `static/style.css` has:

```css
/* 批量添加弹窗 */
.batch-tab { transition: var(--transition); }
.batch-tab:hover:not(.active) { color: var(--text-secondary); }
.batch-input-method { display: none; }

/* 字段组 */
.field-group { display: flex; flex-direction: column; gap: 4px; }
.field-group label { font-size: 11px; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.4px; }
.field-group input, .field-group select {
    font-size: 13px; padding: 7px 10px; border: 1px solid var(--border);
    border-radius: var(--radius-xs); background: var(--bg-card); color: var(--text-primary);
    outline: none; transition: var(--transition);
}
.field-group input:focus, .field-group select:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(59,130,246,0.1); }
```

- [ ] **Step 2: Start the app and verify manually**

```powershell
python app.py
```

Verify these scenarios:
1. **分组管理**: Create a group → see tag appear → double-click rename → drag reorder → delete (confirms clearing machines)
2. **新增机器 with group**: Add a machine directly to a group → check table shows correct group
3. **机器表格分组列**: Change group via dropdown → save → verify persisted on reload
4. **分组筛选**: Select a group in filter → only machines in that group shown → "未分组" filter working
5. **批量添加-范围生成**: Open dialog → set defaults → enter range → generate → verify table → modify individual rows → confirm
6. **批量添加-粘贴列表**: Switch tab → paste text with various formats → parse → verify parsing correct → add to list
7. **切换 tab 追加**: Generate from range → switch to paste → paste more → both sets in table
8. **时间轴跟随**: Filter by group → switch to schedule tab → only filtered machines shown

- [ ] **Step 3: Commit any remaining fixes**

```bash
git add static/style.css
git commit -m "fix: add batch dialog CSS and integration polish"
```
