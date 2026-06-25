# 飞书机器表构建重构 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构 `incremental_init`，一次拉取飞书全量表到内存快照，本地完成所有比对和清理，消除建表→删表→重建的竞态。

**Architecture:** 在 `feishu_sync.py` 单文件内改动。新增 `_fetch_all_tables_snapshot` 一次性拉取全量表，新增 `_create_table` 纯建表函数，重写 `incremental_init` 为五步流程（清场+快照 → 对齐 → 残留检测 → 清理废弃映射 → 推数据），删除 `_cleanup_orphan_conflict_tables`。

**Tech Stack:** Python 3, Flask, requests, SQLite

---

### Task 1: 添加 `_fetch_all_tables_snapshot` 函数

**Files:**
- Modify: `feishu_sync.py`（在 `_find_table_by_name` 之后插入）

- [ ] **Step 1: 在 `_find_table_by_name` 之后插入新函数**

```python
def _fetch_all_tables_snapshot():
    """一次性分页拉取 Base 全部表。
    返回 (snapshot: {name: table_id}, conflicts: [(name, table_id), ...])
    snapshot 不含 _conflict 表和机器配置表。
    """
    snapshot = {}
    conflicts = []
    page_token = None
    while True:
        p = f"&page_token={page_token}" if page_token else ""
        data = _feishu_data("GET", f"/apps/{APP_TOKEN}/tables?page_size=200{p}")
        if not data:
            break
        for item in data.get("items", []):
            name = item.get("name", "")
            tid = item.get("table_id", "")
            if not name or not tid:
                continue
            if "_conflict" in name:
                conflicts.append((name, tid))
            elif name != MACHINE_CONFIG_TABLE:
                snapshot[name] = tid
        if not data.get("has_more"):
            break
        page_token = data.get("page_token")
    return snapshot, conflicts
```

- [ ] **Step 2: 验证语法**

```bash
cd "C:\Users\Admin\Desktop\大家的Draft\zyh\golden" && python -c "from feishu_sync import _fetch_all_tables_snapshot; print('OK')"
```

- [ ] **Step 3: Commit**

```bash
git add feishu_sync.py
git commit -m "feat: add _fetch_all_tables_snapshot to pull full Base table list"
```

---

### Task 2: 添加 `_create_table` 纯建表函数

**Files:**
- Modify: `feishu_sync.py`（替换 `create_feishu_table`）

- [ ] **Step 1: 在 `_fetch_all_tables_snapshot` 之后、`_cleanup_orphan_conflict_tables` 之前插入**

```python
def _create_table(machine_name):
    """纯建表：POST 创建飞书表，失败重试 3 次。
    不做名校验、不删冲突表、不调 _find_table_by_name。
    返回 (table_id, None) 或 (None, error_msg)。
    """
    fields = []
    for f in TABLE_FIELDS:
        fcopy = dict(f)
        if fcopy["field_name"] == "异常标记":
            fcopy["property"] = _build_exception_options_property()
        fields.append(fcopy)

    payload = {
        "table": {
            "name": machine_name,
            "default_view_name": "默认视图",
            "fields": fields,
        }
    }

    for attempt in range(3):
        resp = _feishu_request("POST", f"/apps/{APP_TOKEN}/tables", payload)
        if resp.get("code") == 0:
            table_id = resp.get("data", {}).get("table_id")
            if table_id:
                return table_id, None
        if resp.get("code") == 1254013:
            return None, "table name conflict"
        time.sleep(0.5)

    return None, "Failed after 3 retries"
```

- [ ] **Step 2: 验证语法**

```bash
cd "C:\Users\Admin\Desktop\大家的Draft\zyh\golden" && python -c "from feishu_sync import _create_table; print('OK')"
```

- [ ] **Step 3: Commit**

```bash
git add feishu_sync.py
git commit -m "feat: add _create_table pure create function"
```

---

### Task 3: 重写 `incremental_init` 五步流程

**Files:**
- Modify: `feishu_sync.py:285-386`（替换整个函数）

- [ ] **Step 1: 替换 `incremental_init`**

```python
def incremental_init():
    """新五步初始化：清场+快照 → 对齐 → 残留检测 → 清理废弃映射 → 推数据"""
    conn = get_db()
    machines = conn.execute(
        "SELECT id, name FROM machines ORDER BY sort_order ASC"
    ).fetchall()
    mappings = {
        m["machine_id"]: m
        for m in conn.execute("SELECT * FROM feishu_sync_mapping").fetchall()
    }
    conn.close()

    result = {
        "total_machines": len(machines),
        "mapped_machines": 0,
        "new_tables_created": 0,
        "conflicts_deleted": [],
        "orphan_tables": {},
        "missing_tables": [],
        "missing_fields": {},
        "stale_mappings": 0,
        "records_pushed": 0,
    }

    affected_machines = []

    # ==== 0. 确保机器配置表存在 ====
    ensure_machine_config_table()

    # ==== 1. 清场 + 快照 ====
    snapshot, conflicts = _fetch_all_tables_snapshot()
    for cname, ctid in conflicts:
        _feishu_raw("DELETE", f"/apps/{APP_TOKEN}/tables/{ctid}")
        result["conflicts_deleted"].append(cname)
        time.sleep(0.15)

    # ==== 2. 对齐：遍历本地机器，用快照比对 ====
    for mc in machines:
        mid = mc["id"]
        mname = mc["name"]

        if mname in snapshot:
            # 快照命中：直接复用
            table_id = snapshot.pop(mname)
            _upsert_mapping(mid, mname, table_id)
            result["mapped_machines"] += 1
            # 检查字段完整性
            missing = ensure_table_fields(table_id)
            if missing:
                result["missing_fields"][mname] = missing
        elif mid in mappings:
            # 有旧映射但快照里没有（表可能被手动删除）
            result["missing_tables"].append(mname)
            table_id, err = _create_table(mname)
            if table_id:
                _upsert_mapping(mid, mname, table_id)
                result["new_tables_created"] += 1
                result["mapped_machines"] += 1
                affected_machines.append((mid, mname))
            time.sleep(0.5)
        else:
            # 无映射、快照无命中：全新创建
            table_id, err = _create_table(mname)
            if not table_id:
                continue
            _upsert_mapping(mid, mname, table_id)
            result["new_tables_created"] += 1
            result["mapped_machines"] += 1
            affected_machines.append((mid, mname))
            time.sleep(0.5)

    # ==== 3. 残留检测：快照里还剩的 = 飞书端孤立表 ====
    result["orphan_tables"] = dict(snapshot)

    # ==== 4. 清理废弃映射：机器已删的 ====
    machine_ids = {mc["id"] for mc in machines}
    for mid in list(mappings.keys()):
        if mid not in machine_ids:
            table_id = mappings[mid]["table_id"]
            _feishu_raw("DELETE", f"/apps/{APP_TOKEN}/tables/{table_id}")
            conn2 = get_db()
            conn2.execute("DELETE FROM feishu_sync_mapping WHERE machine_id=?", (mid,))
            conn2.commit()
            conn2.close()
            result["stale_mappings"] += 1
            time.sleep(0.15)

    # ==== 5. 推数据：只为新映射/重建的机器推送 ====
    for mid, mname in affected_machines:
        try:
            push_result = push_machine_schedules(mid)
            if not push_result.get("error") and not push_result.get("skipped"):
                result["records_pushed"] += (
                    push_result.get("created", 0) + push_result.get("updated", 0)
                )
        except Exception:
            pass
        time.sleep(0.3)

    if _is_sync_enabled():
        try:
            push_machine_config()
        except Exception:
            pass

    return result
```

- [ ] **Step 2: 验证语法**

```bash
cd "C:\Users\Admin\Desktop\大家的Draft\zyh\golden" && python -c "from feishu_sync import incremental_init; print('OK')"
```

- [ ] **Step 3: Commit**

```bash
git add feishu_sync.py
git commit -m "feat: rewrite incremental_init with snapshot-driven five-step flow"
```

---

### Task 4: 删除废弃的旧函数

**Files:**
- Modify: `feishu_sync.py`

- [ ] **Step 1: 删除 `create_feishu_table` 和 `_cleanup_orphan_conflict_tables`**

删除 `create_feishu_table` 函数（`feishu_sync.py:145-192`，已被 `_create_table` 替代）

删除 `_cleanup_orphan_conflict_tables` 函数（`feishu_sync.py:212-236`，清场逻辑已内联到步骤 1）

- [ ] **Step 2: 确认无残留引用**

```bash
cd "C:\Users\Admin\Desktop\大家的Draft\zyh\golden" && python -c "
from feishu_sync import incremental_init, _create_table, _fetch_all_tables_snapshot
# 确认旧函数名不存在
import feishu_sync
assert not hasattr(feishu_sync, 'create_feishu_table'), 'create_feishu_table should be removed'
assert not hasattr(feishu_sync, '_cleanup_orphan_conflict_tables'), '_cleanup_orphan_conflict_tables should be removed'
print('All checks passed')
"
```

- [ ] **Step 3: 验证整体导入**

```bash
cd "C:\Users\Admin\Desktop\大家的Draft\zyh\golden" && python -c "from app import app; print('App OK')"
```

- [ ] **Step 4: Commit**

```bash
git add feishu_sync.py
git commit -m "refactor: remove deprecated create_feishu_table and _cleanup_orphan_conflict_tables"
```

---

### Task 5: 更新 routes/feishu.py 中的引用（如有）

**Files:**
- Check: `routes/feishu.py`

- [ ] **Step 1: 确认 routes 中没有引用旧函数名**

```bash
cd "C:\Users\Admin\Desktop\大家的Draft\zyh\golden" && python -c "from routes.feishu import bp; print('Routes OK')"
```

`routes/feishu.py` 的 import 只引用了 `incremental_init`、`push_machine_schedules`、`pull_all_machines`、`push_all_machines_parallel`、`get_sync_status`、`_upsert_mapping`、`APP_TOKEN`、`start_pull_thread`、`stop_pull_thread`，不涉及被删除的函数。无需改动。

- [ ] **Step 2: 确认通过**

```bash
cd "C:\Users\Admin\Desktop\大家的Draft\zyh\golden" && python -c "from routes.feishu import bp; print('Routes OK')"
```

---

### Task 6: 完整性测试

**Files:**
- Test: 手动调用 `get_sync_status` 验证整体连通

- [ ] **Step 1: 验证状态 API 正常返回**

```bash
cd "C:\Users\Admin\Desktop\大家的Draft\zyh\golden" && python -c "
from feishu_sync import get_sync_status
import json
s = get_sync_status()
print('enabled:', s.get('enabled'))
print('connected:', s.get('connected'))
print('initialized:', s.get('initialized'))
print('mapping_count:', s.get('mapping_count'))
print('total_machines:', s.get('total_machines'))
print('integrity.mapped:', s.get('integrity', {}).get('mapped_machines'))
print('integrity.total:', s.get('integrity', {}).get('total_machines'))
"
```

- [ ] **Step 2: 验证新函数可独立调用**

```bash
cd "C:\Users\Admin\Desktop\大家的Draft\zyh\golden" && python -c "
from feishu_sync import _fetch_all_tables_snapshot
snap, conflicts = _fetch_all_tables_snapshot()
print('Snapshot tables:', len(snap))
print('Conflicts found:', len(conflicts))
for c in conflicts:
    print('  conflict:', c[0])
"
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "test: verify snapshot and status APIs work after refactor"
```
