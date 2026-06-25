# 任务包功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为排班系统新增任务包功能——将任务捆绑管理，跟踪进度，支持 Excel 导入、从任务库打包、自动分配筛选。

**Architecture:** 新增 `task_packages` 表 + `tasks.package_id` 字段。后端在 `models.py` 和 `routes/tasks.py` 中新增 CRUD API。前端在任务库页面表格下方新增卡片网格模块，待分配池和时间轴加包名标记，自动分配弹窗加任务包筛选 Tab。

**Tech Stack:** Python Flask + SQLite + Vanilla JS (existing stack)

---

### Task 1: 数据库 — task_packages 表 + tasks.package_id 字段

**Files:**
- Modify: `db.py:276-490`

- [ ] **Step 1: 在 `init_db` 中新增 `task_packages` 表**

在 `db.py` 的 `init_db` 函数中，`# 论坛帖子表` 之前插入：

```python
    # 任务包表
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS task_packages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            deadline TEXT,
            priority TEXT NOT NULL DEFAULT 'P1',
            machine_type TEXT NOT NULL DEFAULT 'BR2',
            created_at TEXT NOT NULL
        )
        """
    )
    conn.commit()
```

- [ ] **Step 2: 新增 `tasks.package_id` 兼容字段**

在 `db.py` 的 `init_db` 函数中，其他兼容字段区域加入：

```python
    # 兼容旧库：补上 tasks.package_id
    try:
        cur.execute("ALTER TABLE tasks ADD COLUMN package_id INTEGER DEFAULT NULL")
        conn.commit()
    except sqlite3.OperationalError:
        pass
```

- [ ] **Step 3: 验证**

启动应用，确认 `task_packages` 表被创建且 `tasks` 表有 `package_id` 列：

```bash
python -c "from db import init_db, get_db; init_db(); conn = get_db(); print(conn.execute(\"PRAGMA table_info(task_packages)\").fetchall()); print(conn.execute(\"PRAGMA table_info(tasks)\").fetchall()[-3:]); conn.close()"
```

应看到 `task_packages` 表有 id/name/deadline/priority/machine_type/created_at 列，`tasks` 表末尾有 package_id 列。

---

### Task 2: 后端模型 — list/create/update/delete 任务包

**File:** Modify: `models.py`

- [ ] **Step 1: 在 models.py 末尾新增任务包模型函数**

```python
def list_task_packages() -> List[Dict]:
    """返回所有任务包，附带已分配/已完成/总数统计"""
    conn = get_db()
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


def create_task_package(name, deadline=None, machine_type="BR2", priority="P1") -> int:
    """创建空任务包，返回 id"""
    import datetime
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO task_packages(name, deadline, priority, machine_type, created_at) VALUES (?,?,?,?,?)",
        (name, deadline, priority, machine_type,
         datetime.datetime.now().isoformat(timespec="seconds")),
    )
    conn.commit()
    pid = cur.lastrowid
    conn.close()
    return pid


def update_task_package(package_id, name=None, deadline=None, machine_type=None, priority=None):
    """更新任务包字段（只更新传入的非 None 字段）"""
    conn = get_db()
    fields = {}
    if name is not None:
        fields["name"] = name
    if deadline is not None:
        fields["deadline"] = deadline
    if machine_type is not None:
        fields["machine_type"] = machine_type
    if priority is not None:
        fields["priority"] = priority
    if fields:
        sets = ", ".join(f"{k}=?" for k in fields)
        vals = list(fields.values()) + [int(package_id)]
        conn.execute(f"UPDATE task_packages SET {sets} WHERE id=?", vals)
        conn.commit()
    conn.close()


def delete_task_package(package_id, cascade=False):
    """删除任务包。cascade=true: 级联删除未完成子任务+排班。cascade=false: 回收子任务到待分配。
    已完成任务始终保持，仅清除 package_id。"""
    conn = get_db()

    if cascade:
        # 删除未完成子任务的排班记录
        conn.execute(
            "DELETE FROM schedules WHERE task_id IN (SELECT id FROM tasks WHERE package_id=? AND status!='已完成')",
            (int(package_id),),
        )
        # 删除未完成子任务
        conn.execute(
            "DELETE FROM tasks WHERE package_id=? AND status!='已完成'",
            (int(package_id),),
        )
    else:
        # 将未完成子任务回收到待分配，清除排班
        conn.execute(
            "DELETE FROM schedules WHERE task_id IN (SELECT id FROM tasks WHERE package_id=? AND status!='已完成')",
            (int(package_id),),
        )
        conn.execute(
            "UPDATE tasks SET status='待分配' WHERE package_id=? AND status!='已完成'",
            (int(package_id),),
        )

    # 已完成任务仅清除 package_id
    conn.execute("UPDATE tasks SET package_id=NULL WHERE package_id=?", (int(package_id),))

    # 删除任务包
    conn.execute("DELETE FROM task_packages WHERE id=?", (int(package_id),))
    conn.commit()
    conn.close()


def add_tasks_to_package(package_id, task_ids):
    """将已有任务加入任务包"""
    if not task_ids:
        return
    conn = get_db()
    placeholders = ",".join("?" * len(task_ids))
    conn.execute(
        f"UPDATE tasks SET package_id=? WHERE id IN ({placeholders})",
        [int(package_id)] + [int(t) for t in task_ids],
    )
    conn.commit()
    conn.close()


def get_package_tasks(package_id):
    """获取某任务包内所有任务"""
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM tasks WHERE package_id=? ORDER BY id",
        (int(package_id),),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]
```

- [ ] **Step 2: 验证**

```bash
python -c "from models import list_task_packages, create_task_package; print(create_task_package('测试包', '2026-06-30')); print(list_task_packages())"
```

---

### Task 3: 后端路由 — /api/task_packages/* 端点

**File:** Modify: `routes/tasks.py`

- [ ] **Step 1: 在 `routes/tasks.py` 中添加导入**

在已有的 `from models import list_tasks` 之后添加：

```python
from models import list_task_packages, create_task_package, update_task_package, delete_task_package, add_tasks_to_package, get_package_tasks
```

- [ ] **Step 2: 在文件末尾添加路由**

```python
@bp.route('/api/task_packages')
def api_task_packages():
    packages = list_task_packages()
    return jsonify({"packages": packages})


@bp.route('/api/task_packages', methods=['POST'])
def api_create_task_package():
    d = request.get_json() or {}
    name = (d.get("name") or "").strip()
    if not name:
        return jsonify({"msg": "任务包名称不能为空"}), 400
    pid = create_task_package(
        name=name,
        deadline=d.get("deadline") or None,
        machine_type=d.get("machine_type") or "BR2",
        priority=d.get("priority") or "P1",
    )
    return jsonify({"msg": "创建成功", "id": pid})


@bp.route('/api/task_packages/<int:pid>', methods=['PUT'])
def api_update_task_package(pid):
    d = request.get_json() or {}
    update_task_package(
        package_id=pid,
        name=d.get("name"),
        deadline=d.get("deadline"),
        machine_type=d.get("machine_type"),
        priority=d.get("priority"),
    )
    return jsonify({"msg": "修改成功"})


@bp.route('/api/task_packages/<int:pid>', methods=['DELETE'])
def api_delete_task_package(pid):
    cascade = request.args.get("cascade", "false").lower() == "true"
    delete_task_package(pid, cascade=cascade)
    return jsonify({"msg": "任务包已删除"})


@bp.route('/api/task_packages/<int:pid>/add_tasks', methods=['POST'])
def api_add_tasks_to_package(pid):
    d = request.get_json() or {}
    task_ids = d.get("task_ids") or []
    if not isinstance(task_ids, list) or len(task_ids) == 0:
        return jsonify({"msg": "请选择至少一个任务"}), 400
    add_tasks_to_package(pid, task_ids)
    return jsonify({"msg": f"已添加 {len(task_ids)} 个任务"})


@bp.route('/api/task_packages/<int:pid>/tasks')
def api_get_package_tasks(pid):
    tasks = get_package_tasks(pid)
    return jsonify({"tasks": tasks})
```

- [ ] **Step 3: 验证 API**

启动应用后，用 curl 测试：

```bash
# 创建
curl -X POST http://localhost:5000/api/task_packages -H "Content-Type: application/json" -d "{\"name\":\"测试包\",\"deadline\":\"2026-06-30\"}"
# 列表
curl http://localhost:5000/api/task_packages
# 添加任务（假设任务 id=1,2）
curl -X POST http://localhost:5000/api/task_packages/1/add_tasks -H "Content-Type: application/json" -d "{\"task_ids\":[1,2]}"
# 查看包内任务
curl http://localhost:5000/api/task_packages/1/tasks
```

---

### Task 4: Excel导入 — 任务包字段支持

**Files:**
- Modify: `import_utils.py`

- [ ] **Step 1: 在 FIELD_ALIASES 中新增"所属任务包"字段**

在 `import_utils.py` 的 `FIELD_ALIASES` 字典末尾添加：

```python
    "package_name": [
        "所属任务包", "任务包", "package", "package_name", "所属包", "包名",
        "任务包名称",
    ],
```

- [ ] **Step 2: 在 `analyze_import` 中传递 package_name**

在 `analyze_import` 函数的 items 构建循环中，新增一行提取 `package_name`：

```python
        pkg_name = _safe_str(row.get("package_name"))
```

在 items.append 的字典中加字段：

```python
            "package_name": pkg_name,
```

- [ ] **Step 3: 在 `execute_import` 中接收 package_name 参数**

修改 `execute_import` 函数签名，接收可选的 `package_name` 参数：

```python
def execute_import(items_to_import: List[Dict], package_name: Optional[str] = None, package_deadline: Optional[str] = None) -> Dict:
```

在函数开头，如果传入了 `package_name`，先创建任务包：

```python
    package_id = None
    if package_name:
        from db import get_db as _get_db
        import datetime as _dt
        pconn = _get_db()
        pcur = pconn.execute(
            "INSERT INTO task_packages(name, deadline, priority, machine_type, created_at) VALUES (?,?,?,?,?)",
            (package_name, package_deadline, "P1", "BR2", _dt.datetime.now().isoformat(timespec="seconds")),
        )
        pconn.commit()
        package_id = pcur.lastrowid
        pconn.close()
```

在 INSERT tasks 语句中加上 `package_id`：

```python
            conn.execute(
                "INSERT INTO tasks(name,type,task_kind,priority,difficulty,duration,est_mode,est_seconds,"
                "remark,status,rbp_task_id,scene,general_category,source_link,"
                "expected_count,collection_req_id,collection_req_type,package_id) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    name, row_type, task_kind, ...existing fields...,
                    package_id,  # NEW
                ),
            )
```

同时在 `FIELD_ALIASES` 加 deadline 相关别名供任务包导入使用：

```python
    "package_deadline": [
        "截止时间", "截止日期", "deadline", "due", "到期",
    ],
```

- [ ] **Step 4: 新增任务包导入端点**

在 `routes/tasks.py` 中新增：

```python
@bp.route('/import_task_package/preview', methods=['POST'])
def import_task_package_preview():
    """上传 Excel → 解析 → 检测或确认任务包名 → 返回预览"""
    f = request.files.get('file')
    if not f:
        return jsonify({"msg": "请选择文件"}), 400
    ext = os.path.splitext(f.filename or "")[1].lower()
    if ext not in ('.xlsx', '.xls'):
        return jsonify({"msg": "仅支持 .xlsx / .xls 格式"}), 400

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=ext)
    try:
        f.save(tmp.name)
        tmp.close()
        field_map, rows, headers = parse_excel(tmp.name)
        if not rows:
            return jsonify({"msg": "未读取到任何数据行"}), 400
        if "name" not in field_map:
            return jsonify({"msg": "未识别到「任务名」相关列"}), 400

        result = analyze_import(rows, field_map)

        # 检测任务包名称
        package_name = None
        package_deadline = None
        if "package_name" in field_map:
            vals = [r.get("package_name") for r in rows if r.get("package_name")]
            v = str(vals[0]).strip() if vals else ""
            if v:
                package_name = v
        if "package_deadline" in field_map:
            dl_vals = [r.get("package_deadline") for r in rows if r.get("package_deadline")]
            dl = str(dl_vals[0]).strip() if dl_vals else ""
            if dl:
                package_deadline = dl

        if not package_name:
            fname = f.filename or ""
            # 检查文件名是否含"任务包"
            if "任务包" in fname:
                fn_noext = os.path.splitext(fname)[0]
                package_name = fn_noext

        result["package_name"] = package_name
        result["package_deadline"] = package_deadline
        result["msg"] = f"解析完成：{result['valid_items']} 条有效数据"
        result["headers"] = headers
        return jsonify(result)
    finally:
        try:
            os.unlink(tmp.name)
        except Exception:
            pass


@bp.route('/import_task_package/execute', methods=['POST'])
def import_task_package_execute():
    d = request.get_json() or {}
    items = d.get("items") or []
    if not isinstance(items, list) or len(items) == 0:
        return jsonify({"msg": "没有可导入的任务"}), 400

    package_name = (d.get("package_name") or "").strip()
    if not package_name:
        package_name = "未命名任务包"
    package_deadline = (d.get("package_deadline") or "").strip() or None

    result = execute_import(items, package_name=package_name, package_deadline=package_deadline)
    result["msg"] = f"导入完成：成功 {result['imported']} 条到任务包「{package_name}」，跳过 {result['skipped']} 条"
    return jsonify(result)
```

---

### Task 5: 前端 — tasks.html 任务包模块 HTML

**File:** Modify: `templates/panels/tasks.html`

- [ ] **Step 1: 在 `</details>` (删除记录) 之前插入任务包模块 HTML**

在 `<details class="box" style="margin-top:16px;" id="deletion-log-panel">` 之前新增：

```html
            <!-- ==================== 任务包模块 ==================== -->
            <div class="box" id="task-packages-section" style="margin-top:16px;">
                <h3>任务包</h3>
                <div class="filter-bar" style="margin-bottom:8px;">
                    <button class="btn" style="background:var(--warning);" onclick="openCreatePackageDialog()">+ 新建空包</button>
                    <button class="btn" style="background:var(--warning);" onclick="document.getElementById('pkg-import-file-input').click()">导入 Excel</button>
                    <input id="pkg-import-file-input" type="file" accept=".xlsx,.xls" style="display:none;" onchange="handlePackageImportFile(this)">
                </div>
                <div id="task-packages-grid" class="pkg-grid">
                    加载中...
                </div>
            </div>
```

- [ ] **Step 2: 确认验证**

刷新任务库页面，任务表格下方应出现"任务包"模块。

---

### Task 6: 前端 — components.css 任务包卡片样式

**File:** Modify: `static/components.css`

- [ ] **Step 1: 在 `components.css` 末尾追加任务包样式**

```css
/* ========== 任务包卡片 ========== */
.pkg-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
}
.pkg-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 14px;
    border-left: 4px solid var(--warning);
    cursor: pointer;
    transition: box-shadow var(--transition);
}
.pkg-card:hover { box-shadow: var(--shadow-sm); }
.pkg-card.pkg-completed {
    border-left-color: var(--success);
    opacity: 0.7;
}
.pkg-card.pkg-expanded {
    border-color: var(--warning);
    grid-column: 1 / -1;
}
.pkg-card-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
}
.pkg-card-title {
    font-weight: 600;
    font-size: 14px;
    color: var(--text-primary);
}
.pkg-card-meta {
    font-size: 11px;
    color: var(--text-muted);
    margin-top: 2px;
}
.pkg-card-toggle {
    font-size: 11px;
    color: var(--text-muted);
}
.pkg-progress-section {
    margin-top: 10px;
    display: flex;
    flex-direction: column;
    gap: 5px;
}
.pkg-progress-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    color: var(--text-secondary);
}
.pkg-progress-label {
    width: 48px;
    text-align: right;
    flex-shrink: 0;
}
.pkg-progress-bar-wrap {
    flex: 1;
    background: var(--border-light);
    height: 6px;
    border-radius: 3px;
    overflow: hidden;
}
.pkg-progress-bar {
    height: 6px;
    border-radius: 3px;
}
.pkg-progress-bar.assigned { background: var(--primary); }
.pkg-progress-bar.completed { background: var(--success); }
.pkg-progress-count {
    width: 48px;
    font-weight: 600;
    color: var(--text-primary);
    flex-shrink: 0;
}
.pkg-card-dashed {
    border: 1px dashed var(--border);
    background: var(--bg-card);
    border-radius: var(--radius-sm);
    padding: 14px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100px;
    cursor: pointer;
    color: var(--text-muted);
    font-size: 13px;
}
.pkg-card-dashed:hover {
    border-color: var(--primary);
    color: var(--primary);
}
.pkg-expanded-body {
    border-top: 1px solid var(--border-light);
    padding-top: 12px;
    margin-top: 12px;
}
.pkg-expanded-toolbar {
    display: flex;
    gap: 8px;
    margin-bottom: 8px;
    flex-wrap: wrap;
    align-items: center;
}
.pkg-expanded-toolbar input {
    flex: 1;
    min-width: 150px;
}
.pkg-tag {
    display: inline-block;
    font-size: 10px;
    padding: 1px 5px;
    border-radius: 3px;
    margin-right: 4px;
    font-weight: 500;
}
.pkg-tag-inline {
    font-size: 10px;
    color: var(--text-muted);
    display: block;
    line-height: 1.2;
}
```

---

### Task 7: 前端 — task-table.js 任务包渲染与交互

**File:** Modify: `static/task-table.js`

- [ ] **Step 1: 在文件顶部声明全局变量，在 `_refreshTaskList` 中加入加载任务包**

在文件开头的全局变量声明后添加：

```javascript
var TASK_PACKAGES = [];
var _expandedPackageId = null;
```

修改 `_refreshTaskList` 函数，在加载任务后追加加载任务包：

在 `_refreshTaskList` 的 fetch 链末尾（`.catch` 之前）的最后一个 `.then` 中，`refreshLiveStatus()` 之后添加：

```javascript
        _refreshTaskPackages();
```

新增函数：

```javascript
function _refreshTaskPackages() {
    fetch('/api/task_packages')
        .then(function(r) { return r.json(); })
        .then(function(d) {
            TASK_PACKAGES = d.packages || [];
            _renderTaskPackages();
        });
}

function _renderTaskPackages() {
    var grid = document.getElementById('task-packages-grid');
    if (!grid) return;
    if (TASK_PACKAGES.length === 0) {
        grid.innerHTML = '<div class="pkg-card-dashed" onclick="openCreatePackageDialog()">+ 新建任务包<div style="font-size:11px;color:var(--text-muted);margin-top:4px;">导入 Excel · 手动创建 · 从任务库打包</div></div>';
        return;
    }
    var html = '';
    var colors = ['var(--warning)', 'var(--primary)', '#8b5cf6', '#06b6d4', '#f97316'];
    for (var i = 0; i < TASK_PACKAGES.length; i++) {
        var p = TASK_PACKAGES[i];
        var color = colors[i % colors.length];
        var isCompleted = p.total > 0 && p.completed >= p.total;
        var isExpanded = _expandedPackageId === p.id;
        var cls = 'pkg-card';
        if (isCompleted) cls += ' pkg-completed';
        if (isExpanded) cls += ' pkg-expanded';
        var assignedPct = p.total > 0 ? Math.round(p.assigned / p.total * 100) : 0;
        var completedPct = p.total > 0 ? Math.round(p.completed / p.total * 100) : 0;
        html += '<div class="' + cls + '" style="border-left-color:' + color + '" onclick="togglePackageCard(event, ' + p.id + ')">';
        html += '<div class="pkg-card-header">';
        html += '<div><div class="pkg-card-title">' + escHtml(p.name) + '</div>';
        html += '<div class="pkg-card-meta">' + escHtml(p.machine_type) + ' · ' + escHtml(p.priority||'') + (p.deadline ? ' · 截止 ' + escHtml(p.deadline) : ' · 无截止') + '</div></div>';
        html += '<div class="pkg-card-toggle">' + (isCompleted ? '已完成' : (isExpanded ? '收起 ▲' : '展开 ▼')) + '</div></div>';
        html += '<div class="pkg-progress-section">';
        html += '<div class="pkg-progress-row"><span class="pkg-progress-label">已分配</span><div class="pkg-progress-bar-wrap"><div class="pkg-progress-bar assigned" style="width:' + assignedPct + '%"></div></div><span class="pkg-progress-count">' + p.assigned + '/' + p.total + '</span></div>';
        html += '<div class="pkg-progress-row"><span class="pkg-progress-label">已完成</span><div class="pkg-progress-bar-wrap"><div class="pkg-progress-bar completed" style="width:' + completedPct + '%"></div></div><span class="pkg-progress-count">' + p.completed + '/' + p.total + '</span></div></div>';
        if (isExpanded) {
            html += '<div class="pkg-expanded-body" id="pkg-body-' + p.id + '">';
            html += '<div class="pkg-expanded-toolbar">';
            html += '<button class="btn" onclick="event.stopPropagation();openEditPackageDialog(' + p.id + ')">编辑</button>';
            html += '<button style="background:var(--danger);color:white;border-color:var(--danger);" onclick="event.stopPropagation();deletePackage(' + p.id + ')">删除</button>';
            html += '<button class="btn" onclick="event.stopPropagation();openAddTasksToPackageDialog(' + p.id + ')" style="margin-left:auto;">+ 从任务库添加</button>';
            html += '<input type="text" placeholder="搜索此包内任务..." style="max-width:200px;" oninput="filterPackageTasks(' + p.id + ', this.value)" onclick="event.stopPropagation();">';
            html += '</div>';
            html += '<div id="pkg-tasks-table-' + p.id + '">加载中...</div>';
            html += '</div>';
        }
        html += '</div>';
    }
    html += '<div class="pkg-card-dashed" onclick="openCreatePackageDialog()">+ 新建任务包</div>';
    grid.innerHTML = html;

    // 展开的任务包加载任务列表
    if (_expandedPackageId !== null) {
        _loadPackageTasks(_expandedPackageId);
    }
}

function togglePackageCard(ev, packageId) {
    // 忽略按钮点击
    if (ev.target.tagName === 'BUTTON' || ev.target.tagName === 'INPUT') return;
    if (_expandedPackageId === packageId) {
        _expandedPackageId = null;
    } else {
        _expandedPackageId = packageId;
    }
    _renderTaskPackages();
}

function _loadPackageTasks(packageId) {
    fetch('/api/task_packages/' + packageId + '/tasks')
        .then(function(r) { return r.json(); })
        .then(function(d) {
            var tasks = d.tasks || [];
            var tableEl = document.getElementById('pkg-tasks-table-' + packageId);
            if (!tableEl) return;
            var html = '<table style="width:100%;font-size:12px;border-collapse:collapse;"><thead><tr style="color:var(--text-muted);border-bottom:1px solid var(--border);">';
            html += '<th style="text-align:left;padding:6px">任务名</th><th>机型</th><th>优先级</th><th>状态</th><th>预估</th></tr></thead><tbody>';
            for (var i = 0; i < tasks.length; i++) {
                var t = tasks[i];
                var durDisplay = t.est_seconds ? Math.round(t.est_seconds / 60) + '分' : (t.duration || '');
                var pkg = TASK_PACKAGES.find(function(pk) { return pk.id === packageId; });
                var pkgTag = pkg ? '<span class="pkg-tag-inline">📦 ' + escHtml(pkg.name) + '</span>' : '';
                html += '<tr style="border-bottom:1px solid var(--border-light);">';
                html += '<td style="padding:6px">' + pkgTag + escHtml(t.name) + '</td>';
                html += '<td>' + escHtml(t.type) + '</td>';
                html += '<td>' + escHtml(t.priority||'') + '</td>';
                html += '<td><span style="color:' + (_statusColor(t.status)) + '">' + escHtml(t.status) + '</span></td>';
                html += '<td>' + durDisplay + '</td></tr>';
            }
            html += '</tbody></table>';
            if (tasks.length === 0) html = '<div style="padding:12px;color:var(--text-muted);text-align:center;">此包暂无任务</div>';
            tableEl.innerHTML = html;
        });
}

function filterPackageTasks(packageId, term) {
    var tableEl = document.getElementById('pkg-tasks-table-' + packageId);
    if (!tableEl) return;
    var rows = tableEl.querySelectorAll('tbody tr');
    var t = (term||'').toLowerCase();
    rows.forEach(function(row) {
        row.style.display = t ? (row.textContent.toLowerCase().indexOf(t) >= 0 ? '' : 'none') : '';
    });
}
```

- [ ] **Step 2: 验证**

刷新任务库页面，如果已有任务包数据，卡片网格应正常渲染。否则显示空状态虚线卡片。

---

### Task 8: 任务包对话框 — 创建/编辑/删除/从任务库添加

**File:** Modify: `static/task-edit.js`

- [ ] **Step 1: 在 `task-edit.js` 末尾新增任务包对话框函数**

```javascript
// ========== 任务包对话框 ==========

function openCreatePackageDialog() {
    showConfirm('新建任务包',
        '<div style="text-align:left">' +
        '<div style="margin-bottom:6px;"><b>名称：</b><input id="pkg-dlg-name" style="width:100%" placeholder="输入任务包名称"></div>' +
        '<div style="margin-bottom:6px;"><b>截止时间：</b><input id="pkg-dlg-deadline" type="date" style="width:100%"></div>' +
        '<div style="margin-bottom:6px;"><b>机型：</b><select id="pkg-dlg-type" style="width:100%">' + _machineTypeOptions() + '</select></div>' +
        '<div><b>优先级：</b><select id="pkg-dlg-priority" style="width:100%">' + _priorityOptions() + '</select></div>' +
        '</div>'
    ).then(function(ok) {
        if (!ok) return;
        var name = (document.getElementById('pkg-dlg-name').value || '').trim();
        if (!name) { showToast('名称不能为空'); return; }
        fetch('/api/task_packages', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                name: name,
                deadline: document.getElementById('pkg-dlg-deadline').value || null,
                machine_type: document.getElementById('pkg-dlg-type').value,
                priority: document.getElementById('pkg-dlg-priority').value,
            })
        }).then(function(r) { return r.json(); }).then(function(d) {
            showToast(d.msg);
            _refreshTaskPackages();
        });
    });
}

function openEditPackageDialog(pid) {
    var p = TASK_PACKAGES.find(function(pk) { return pk.id === pid; });
    if (!p) return;
    showConfirm('编辑任务包',
        '<div style="text-align:left">' +
        '<div style="margin-bottom:6px;"><b>名称：</b><input id="pkg-dlg-name" style="width:100%" value="' + escHtml(p.name) + '"></div>' +
        '<div style="margin-bottom:6px;"><b>截止时间：</b><input id="pkg-dlg-deadline" type="date" style="width:100%" value="' + escHtml(p.deadline||'') + '"></div>' +
        '<div style="margin-bottom:6px;"><b>机型：</b><select id="pkg-dlg-type" style="width:100%">' + _machineTypeOptions(p.machine_type) + '</select></div>' +
        '<div><b>优先级：</b><select id="pkg-dlg-priority" style="width:100%">' + _priorityOptions(p.priority) + '</select></div>' +
        '</div>'
    ).then(function(ok) {
        if (!ok) return;
        var name = (document.getElementById('pkg-dlg-name').value || '').trim();
        if (!name) { showToast('名称不能为空'); return; }
        fetch('/api/task_packages/' + pid, {
            method: 'PUT', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                name: name,
                deadline: document.getElementById('pkg-dlg-deadline').value || null,
                machine_type: document.getElementById('pkg-dlg-type').value,
                priority: document.getElementById('pkg-dlg-priority').value,
            })
        }).then(function(r) { return r.json(); }).then(function(d) {
            showToast(d.msg);
            _refreshTaskPackages();
        });
    });
}

function deletePackage(pid) {
    var p = TASK_PACKAGES.find(function(pk) { return pk.id === pid; });
    if (!p) return;
    var html = '<div style="text-align:left">';
    html += '<p>删除任务包「<b>' + escHtml(p.name) + '</b>」？</p>';
    html += '<p style="font-size:12px;color:var(--text-muted)">' + p.total + ' 个子任务中：' + p.assigned + ' 已分配、' + (p.total - p.assigned - p.completed) + ' 待分配、' + p.completed + ' 已完成</p>';
    html += '<p style="font-size:11px;color:var(--text-muted)">已完成的任务不会被影响</p>';
    html += '</div>';

    var dialog = document.createElement('div');
    dialog.className = 'dialog-overlay';
    dialog.style.display = 'flex';
    dialog.innerHTML = '<div class="dialog-box" style="max-width:440px">' +
        '<h3>删除任务包</h3>' + html +
        '<div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end;">' +
        '<button class="btn" id="pkg-del-cancel">取消</button>' +
        '<button class="btn" style="background:var(--danger);color:white;" id="pkg-del-recycle">回收子任务</button>' +
        '<button class="btn btn-danger" id="pkg-del-cascade">级联删除</button>' +
        '</div></div>';
    document.body.appendChild(dialog);

    function close() { document.body.removeChild(dialog); }

    document.getElementById('pkg-del-cancel').onclick = close;
    document.getElementById('pkg-del-recycle').onclick = function() {
        close();
        fetch('/api/task_packages/' + pid + '?cascade=false', { method: 'DELETE' })
            .then(function(r) { return r.json(); }).then(function(d) {
                showToast(d.msg); _expandedPackageId = null;
                _silentRefresh();
            });
    };
    document.getElementById('pkg-del-cascade').onclick = function() {
        close();
        fetch('/api/task_packages/' + pid + '?cascade=true', { method: 'DELETE' })
            .then(function(r) { return r.json(); }).then(function(d) {
                showToast(d.msg); _expandedPackageId = null;
                _silentRefresh();
            });
    };
    dialog.onclick = function(ev) { if (ev.target === dialog) close(); };
}

function openAddTasksToPackageDialog(pid) {
    var p = TASK_PACKAGES.find(function(pk) { return pk.id === pid; });
    if (!p) return;
    // 收集待分配且未归属任务包的任务
    var candidates = TASKS_DATA.filter(function(t) {
        return t.status === '待分配' && (t.package_id == null);
    });
    if (candidates.length === 0) {
        showToast('没有可添加的待分配任务');
        return;
    }
    var html = '<div style="text-align:left;max-height:300px;overflow-y:auto;">';
    html += '<p style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">勾选任务添加到「<b>' + escHtml(p.name) + '</b>」</p>';
    for (var i = 0; i < candidates.length; i++) {
        var t = candidates[i];
        html += '<label style="display:flex;align-items:center;gap:6px;padding:4px 0;cursor:pointer;">';
        html += '<input type="checkbox" class="pkg-add-task-cb" value="' + t.id + '">';
        html += '<span>' + escHtml(t.name) + ' <span style="color:var(--text-muted);font-size:11px;">' + escHtml(t.type) + ' · ' + escHtml(t.task_kind||'') + '</span></span>';
        html += '</label>';
    }
    html += '</div>';
    showConfirm('从任务库添加任务', html).then(function(ok) {
        if (!ok) return;
        var cbs = document.querySelectorAll('.pkg-add-task-cb:checked');
        var ids = [];
        cbs.forEach(function(cb) { ids.push(parseInt(cb.value, 10)); });
        if (ids.length === 0) return;
        fetch('/api/task_packages/' + pid + '/add_tasks', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({task_ids: ids})
        }).then(function(r) { return r.json(); }).then(function(d) {
            showToast(d.msg);
            _silentRefresh();
        });
    });
}

function _machineTypeOptions(selected) {
    var types = (APP_CONFIG && APP_CONFIG.machine_types) ? APP_CONFIG.machine_types : [];
    var html = '';
    for (var i = 0; i < types.length; i++) {
        var t = types[i].key;
        html += '<option value="' + escHtml(t) + '"' + (t === (selected || 'BR2') ? ' selected' : '') + '>' + escHtml(t) + '</option>';
    }
    return html;
}

function _priorityOptions(selected) {
    var priorities = (APP_CONFIG && APP_CONFIG.priorities) ? APP_CONFIG.priorities : [];
    var html = '';
    for (var i = 0; i < priorities.length; i++) {
        var p = priorities[i].key;
        html += '<option value="' + escHtml(p) + '"' + (p === (selected || 'P1') ? ' selected' : '') + '>' + escHtml(p) + '</option>';
    }
    return html;
}
```

---

### Task 9: 任务包 Excel 导入前端对接

**File:** Modify: `static/task-table.js` (或放在 `task-edit.js`)

- [ ] **Step 1: 新增 `handlePackageImportFile`**

```javascript
function handlePackageImportFile(input) {
    var file = input.files[0];
    if (!file) return;
    var formData = new FormData();
    formData.append('file', file);
    fetch('/import_task_package/preview', { method: 'POST', body: formData })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            if (d.msg && !d.items) { showToast(d.msg); return; }
            var pkgName = d.package_name || '';
            var html = '<div style="text-align:left">';
            html += '<div style="margin-bottom:8px;"><b>任务包名称：</b><input id="pkg-import-name" style="width:100%" value="' + escHtml(pkgName) + '" placeholder="输入任务包名称"></div>';
            if (d.package_deadline) {
                html += '<div style="margin-bottom:8px;"><b>截止时间：</b><input id="pkg-import-deadline" type="date" style="width:100%" value="' + escHtml(d.package_deadline) + '"></div>';
            } else {
                html += '<div style="margin-bottom:8px;"><b>截止时间：</b><input id="pkg-import-deadline" type="date" style="width:100%"></div>';
            }
            html += '<p style="font-size:12px;color:var(--text-muted);">共 ' + d.valid_items + ' 条任务，' + d.ok_count + ' 条可导入</p>';
            html += '</div>';
            showConfirm('导入任务包', html).then(function(ok) {
                if (!ok) return;
                var finalName = (document.getElementById('pkg-import-name').value || '').trim() || '未命名任务包';
                var finalDeadline = document.getElementById('pkg-import-deadline').value || null;
                fetch('/import_task_package/execute', {
                    method: 'POST', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        items: d.items.filter(function(it) { return it.status === 'ok'; }),
                        package_name: finalName,
                        package_deadline: finalDeadline,
                    })
                }).then(function(r) { return r.json(); }).then(function(res) {
                    showToast(res.msg);
                    _silentRefresh();
                });
            });
        });
    input.value = '';
}
```

---

### Task 10: 任务池 — 任务包标签

**File:** Modify: `static/task-pool.js`

- [ ] **Step 1: 在 `_renderTaskPool` 中修改任务条渲染**

修改渲染逻辑，在任务名前面加上标签。找到构造 `itemsHtml` 的循环，在 `escHtml(t.name)` 前面加上：

```javascript
// 在 _renderTaskPool 的渲染循环中：
var pkgTag = '';
if (t.package_id) {
    var pkg = TASK_PACKAGES.find(function(pk) { return pk.id === t.package_id; });
    if (pkg) {
        var firstChar = pkg.name.charAt(0);
        var colors = ['#f59e0b','#3b82f6','#8b5cf6','#06b6d4','#f97316'];
        var ci = TASK_PACKAGES.findIndex(function(pk){return pk.id===pkg.id;}) % colors.length;
        pkgTag = '<span class="pkg-tag" style="background:' + colors[ci] + '15;color:' + colors[ci] + ';">📦' + escHtml(firstChar) + '</span>';
    }
}
// 然后在 itemsHtml 中改为:
itemsHtml += '...' + pkgTag + escHtml(t.name) + '...';
```

具体修改 `_renderTaskPool` 中第 18 行，将：

```javascript
itemsHtml += '<div class="task-draggable task-type-' + typeIdx + '" ...
```

改为包裹 pkgTag 后拼接。

---

### Task 11: 时间轴 — 任务块包名标记 + Tooltip

**File:** Modify: `static/timeline-render.js`

- [ ] **Step 1: 在 `_createTaskBlock` 中加包名标记**

在 `_createTaskBlock` 函数创建 `label` span 之前，检查是否有 package_id 并插入小标记。

需要从 schedules 数据中读取 package_id。修改 `_renderAllTaskBlocks` 中的数据传递，在调用 `_createTaskBlock` 时传入 `package_id`：

```javascript
var blk = _createTaskBlock({
    // ...existing fields...
    package_id: s.package_id,
    package_name: s.package_name,
});
```

后端 API `/api/view_schedules` 在 `routes/schedule_ops.py:766-775` 需要修改 SQL，加入 `package_id` 和 `package_name`：

```python
rows = conn.execute(
    "SELECT s.id, s.date, s.machine_id, s.machine_name,"
    " s.task_id, s.task_name, s.task_type, s.task_kind,"
    " s.duration, s.remark, s.start_min, s.end_min, s.status,"
    " t.priority, t.difficulty, t.split_group, t.package_id,"
    " COALESCE(pkg.name, '') AS package_name"
    " FROM schedules s LEFT JOIN tasks t ON s.task_id = t.id"
    " LEFT JOIN task_packages pkg ON t.package_id = pkg.id"
    " WHERE s.date >= ? AND s.date <= ?"
    " ORDER BY s.machine_id ASC, s.start_min ASC",
    (start_date, end_date),
).fetchall()
```：

```python
SELECT s.id,..., t.package_id,
       COALESCE(pkg.name, '') AS package_name
FROM schedules s
LEFT JOIN tasks t ON s.task_id = t.id
LEFT JOIN task_packages pkg ON t.package_id = pkg.id
```

在 `_createTaskBlock` 中，`task-label` 之前插入：

```javascript
if (data.package_name) {
    var pkgLabel = document.createElement('span');
    pkgLabel.className = 'pkg-tag-inline';
    pkgLabel.textContent = '📦 ' + data.package_name;
    pkgLabel.style.cssText = 'display:block;font-size:10px;color:var(--text-muted);line-height:1.2;';
    block.appendChild(pkgLabel);
}
```

- [ ] **Step 2: 在 tooltip 中加包名**

修改 `_showTaskTooltipNow`（line 491），在 priority 行之后加：

```javascript
var pkgName = '';
var t = TASKS_DATA.find(function(tk) { return tk.id === s.task_id; });
if (t && t.package_id) {
    var pkg = TASK_PACKAGES.find(function(pk) { return pk.id === t.package_id; });
    if (pkg) pkgName = pkg.name;
}
if (pkgName) html += '<div style="'+rowStyle+'">所属任务包：' + escHtml(pkgName) + '</div>';
```

---

### Task 12: 自动分配 — 任务包筛选 Tab 组

**File:** Modify: `static/auto-assign.js`

- [ ] **Step 1: 在 `_renderTaskTabs` 中新增"任务包"Tab 组**

在 `_renderTaskTabs` 函数中，任务类型 Tab 组之后（`el.innerHTML = html` 之前）添加：

```javascript
// 任务包组
html += '<div class="aa-tab-group" style="margin-top:2px;"><span class="aa-tab-label">任务包</span>';
html += '<span class="aa-tab' + (activePackages.length === 0 ? ' on' : '') + '" data-group="package" data-filter="all" onclick="AA.toggleTaskFilter(\'all\', \'package\', this)">全部</span>';
fetch('/api/task_packages')
    .then(function(r) { return r.json(); })
    .then(function(d) {
        (d.packages || []).forEach(function(pkg) {
            html += '<span class="aa-tab' + (activePackages.indexOf(pkg.id) >= 0 ? ' on' : '') + '" data-group="package" data-filter="package:' + pkg.id + '" onclick="AA.toggleTaskFilter(\'package:' + pkg.id + '\', \'package\', this)">' + escHtml(pkg.name) + '</span>';
        });
        var el2 = document.getElementById('aa-task-tabs');
        if (el2) el2.innerHTML = html;
    });
```

- [ ] **Step 2: 扩展状态和渲染**

需要在 state 中加 `_activePackageFilters: []`，在 `open()` 中清空。在 `_loadTasks` 中确保任务数据包含 `package_id`。

在 `_renderTasks` 中加 package 筛选：

```javascript
var list = AA._state.tasks.slice();
// existing type/kind filtering...
// add package filtering:
var activePackages = AA._state._activePackageFilters;
if (activePackages.length > 0) {
    list = list.filter(function(tk) {
        return activePackages.indexOf(tk.package_id) >= 0;
    });
}
```

在 `toggleTaskFilter` 中处理 `group === 'package'` 分支：

```javascript
} else if (group === 'package') {
    var pid = parseInt(filter.slice(8), 10);
    var idx = arr.indexOf(pid);
    if (idx >= 0) { arr.splice(idx, 1); }
    else { arr.push(pid); }
}
```

---

### Task 13: 协调层 — tasks.js 全量同步

**File:** Modify: `static/tasks.js`

- [ ] **Step 1: 在 `_silentRefresh` 后确保任务包同步**

`_silentRefresh` 调用 `_refreshTaskList`，后者已加入 `_refreshTaskPackages()` 调用（Task 7中）。无需额外修改。

- [ ] **Step 2: 确保 `switchTab` 时任务包数据重新加载**

在 `core.js` 的 `switchTab(2)` 时 `_silentRefresh` 被调用，已覆盖。

---

### Task 14: 端到端验证

- [ ] **Step 1: 启动应用 → 打开任务库页面 → 创建空包 → 确认卡片出现**

- [ ] **Step 2: 展开包 → 编辑 → 修改名称 → 确认刷新**

- [ ] **Step 3: 从任务库添加任务 → 确认进度条更新**

- [ ] **Step 4: 将包内任务拖到时间轴 → 确认时间轴显示包名标记**

- [ ] **Step 5: 待分配池确认有包名标签**

- [ ] **Step 6: 鼠标悬停时间轴任务块 → 确认 tooltip 有"所属任务包"**

- [ ] **Step 7: 自动分配弹窗 → 任务包 Tab 出现 → 选择包后只显示该包任务**

- [ ] **Step 8: 删除任务包 → 选择回收 → 确认子任务回到待分配**

- [ ] **Step 9: 删除任务包 → 选择级联 → 确认子任务和排班删除**

- [ ] **Step 10: 导入 Excel 创建任务包 → 全程验证**
