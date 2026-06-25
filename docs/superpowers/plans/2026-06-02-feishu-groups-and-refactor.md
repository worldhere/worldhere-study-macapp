# 飞书机器分组表 & 代码拆分 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建飞书「机器分组表」+ 本地 `groups` 表 + 机器配置表字段修正 + `feishu_sync.py` 拆分为 `feishu/` 包

**Architecture:** 从 `feishu_sync.py` 拆分出 10 个模块到 `feishu/` 包，公共工具放 `common.py`，业务模块不交叉 import。`routes/feishu.py` 改为从 `feishu` 包导入。

**Tech Stack:** Python 3.14, Flask, SQLite, requests, 飞书 Bitable API

---

## 文件结构

```
feishu/                          (新建目录)
├── __init__.py                  (新建 - 统一出口)
├── common.py                    (新建 - API请求/token/批处理/常量)
├── table_utils.py               (新建 - 建表/查表/字段管理)
├── schedule_sync.py             (新建 - 排班推送/拉取/状态计算)
├── config_table.py              (新建 - 机器配置表同步)
├── groups.py                    (新建 - 机器分组表同步)
├── init_engine.py               (新建 - incremental_init)
├── status.py                    (新建 - 状态聚合/事件/active_operation)
├── lifecycle.py                 (新建 - 机器生命周期钩子)
└── sync_loop.py                 (新建 - 后台同步线程)

feishu_sync.py                   (删除 - 内容分散到 feishu/ 各模块)
db.py                            (修改 - 新增 groups 表)
routes/feishu.py                 (修改 - import 路径改为 feishu)
routes/machines.py               (修改 - lifecycle 钩子 import 路径)
```

---

### Task 1: 本地 groups 表

**Files:**
- Modify: `db.py`

- [ ] **Step 1: 在 init_db() 中添加 groups 表创建逻辑**

在 `db.py` 的 `init_db()` 函数中，找到合适位置（在 `task_packages` 表之后、`shift_posts` 表附近），添加：

```python
    # 机器分组表
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS groups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            day_leader TEXT NOT NULL DEFAULT '',
            night_leader TEXT NOT NULL DEFAULT '',
            remark TEXT NOT NULL DEFAULT ''
        )
        """
    )
    conn.commit()
```

- [ ] **Step 2: 添加种子数据逻辑**

在上述建表语句后添加：

```python
    # 种子分组数据：从 machines.group_name 去重生成
    cur.execute("SELECT COUNT(*) AS c FROM groups")
    if int(cur.fetchone()["c"]) == 0:
        cur.execute(
            "INSERT OR IGNORE INTO groups (name) SELECT DISTINCT group_name FROM machines WHERE group_name IS NOT NULL AND group_name != ''"
        )
        conn.commit()
```

- [ ] **Step 3: 添加 groups 表到 get_db_info 统计**

在 `get_db_info()` 的 tables 列表中追加 `"groups"`:

```python
tables = ["machines", "tasks", "schedules", "config", "deletion_log", "repair_log", "shift_config", "groups"]
```

- [ ] **Step 4: 验证**

```bash
python -c "from db import init_db; init_db(); print('OK')"
```

预期：无报错，数据库文件中出现 groups 表。

- [ ] **Step 5: Commit**

```bash
git add db.py && git commit -m "feat: add groups table to local database"
```

---

### Task 2: feishu/ 包骨架 + common.py

**Files:**
- Create: `feishu/__init__.py`
- Create: `feishu/common.py`
- Modify: `feishu_sync.py` (提取公共代码)

- [ ] **Step 1: 创建目录和 __init__.py**

```bash
mkdir feishu
```

`feishu/__init__.py`（暂时为空，后续逐步填充）：

```python
# -*- coding: utf-8 -*-
"""飞书同步包 — 统一出口"""
```

- [ ] **Step 2: 创建 common.py**

从 `feishu_sync.py` 提取公共部分到 `feishu/common.py`：

```python
# -*- coding: utf-8 -*-
"""飞书同步公共模块：API 请求、token、批处理、常量"""
import time
import requests
from feishu_token import get_token, refresh_token

BASE_URL = "https://open.feishu.cn/open-apis/bitable/v1"
APP_TOKEN = "I7IzbOlscajHJZscWOtcYcs6nLf"
BATCH_SIZE = 100
ROW_LIMIT = 200

# 白名单表（不被 init/cleanup 删除的持久化总表）
MACHINE_CONFIG_TABLE = "机器配置表"
GROUPS_TABLE = "机器分组表"
WHITELIST_TABLES = {MACHINE_CONFIG_TABLE, GROUPS_TABLE}

_session = requests.Session()
_session.mount("https://", requests.adapters.HTTPAdapter(pool_connections=20, pool_maxsize=20))


def _feishu_data(method, path, json_data=None, retry_count=3):
    """飞书 API 请求，返回响应中的 data 字段（已解包）。失败时返回空 dict。"""
    resp = _feishu_request(method, path, json_data, retry_count)
    if resp.get("code") == 0:
        return resp.get("data", {})
    return {}


def _feishu_raw(method, path, json_data=None, retry_count=3):
    """飞书 API 请求，返回完整响应体。"""
    return _feishu_request(method, path, json_data, retry_count)


def _feishu_request(method, path, json_data=None, retry_count=3):
    """带 token 管理和重试的飞书 API 请求"""
    url = f"{BASE_URL}{path}"
    token = get_token()
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    for attempt in range(retry_count):
        try:
            if method == "GET":
                resp = _session.get(url, headers=headers, timeout=15)
            elif method == "POST":
                resp = _session.post(url, headers=headers, json=json_data, timeout=15)
            elif method == "DELETE":
                resp = _session.delete(url, headers=headers, timeout=15)
            elif method == "PUT":
                resp = _session.put(url, headers=headers, json=json_data, timeout=15)
            else:
                return {"code": -1, "msg": f"Unknown method: {method}"}

            if resp.status_code == 401:
                refresh_token()
                headers["Authorization"] = f"Bearer {get_token()}"
                continue
            if resp.status_code == 429:
                retry_after = int(resp.headers.get("Retry-After", "5"))
                time.sleep(retry_after)
                continue
            if 400 <= resp.status_code < 500:
                return {"code": resp.status_code, "msg": resp.text}
            if resp.status_code >= 500:
                if attempt < retry_count - 1:
                    time.sleep(2 ** attempt)
                    continue
                return {"code": resp.status_code, "msg": resp.text}

            return resp.json()
        except (requests.Timeout, requests.ConnectionError):
            if attempt < retry_count - 1:
                time.sleep(2 ** attempt)
                continue
            return {"code": -1, "msg": "Network error after retries"}

    return {"code": -1, "msg": "Max retries exceeded"}


# ========== 批量操作 ==========

from concurrent.futures import ThreadPoolExecutor, as_completed


def _batch_create_records(table_id, records):
    """批量创建记录，超 BATCH_SIZE 条自动分片并发。
    返回 (success_count, record_ids, errors)"""
    if not records:
        return 0, [], []
    chunks = [records[i:i + BATCH_SIZE] for i in range(0, len(records), BATCH_SIZE)]
    total = 0
    all_record_ids = []
    all_errors = []

    def _create_chunk(chunk):
        resp = _feishu_request(
            "POST",
            f"/apps/{APP_TOKEN}/tables/{table_id}/records/batch_create",
            {"records": chunk},
        )
        if resp.get("code") == 0:
            rids = [r.get("record_id", "") for r in resp.get("data", {}).get("records", [])]
            return len(chunk), rids, []
        return 0, [], [{"op": "batch_create", "count": len(chunk),
                        "code": resp.get("code"), "msg": resp.get("msg", "")[:200]}]

    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {executor.submit(_create_chunk, c): c for c in chunks}
        for future in as_completed(futures):
            try:
                n, rids, errs = future.result()
                total += n
                all_record_ids.extend(rids)
                all_errors.extend(errs)
            except Exception as e:
                all_errors.append({"op": "batch_create", "error": str(e)[:200]})
    return total, all_record_ids, all_errors


def _batch_update_records(table_id, records):
    """批量更新记录，超 BATCH_SIZE 条自动分片并发。返回 (success_count, errors)"""
    if not records:
        return 0, []
    chunks = [records[i:i + BATCH_SIZE] for i in range(0, len(records), BATCH_SIZE)]
    total = 0
    all_errors = []

    def _update_chunk(chunk):
        resp = _feishu_request(
            "POST",
            f"/apps/{APP_TOKEN}/tables/{table_id}/records/batch_update",
            {"records": chunk},
        )
        if resp.get("code") == 0:
            return len(chunk), []
        return 0, [{"op": "batch_update", "count": len(chunk),
                     "code": resp.get("code"), "msg": resp.get("msg", "")[:200]}]

    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {executor.submit(_update_chunk, c): c for c in chunks}
        for future in as_completed(futures):
            try:
                n, errs = future.result()
                total += n
                all_errors.extend(errs)
            except Exception as e:
                all_errors.append({"op": "batch_update", "error": str(e)[:200]})
    return total, all_errors


def _batch_delete_records(table_id, record_ids):
    """批量删除记录，超 BATCH_SIZE 条自动分片并发。返回 (success_count, errors)"""
    if not record_ids:
        return 0, []
    chunks = [record_ids[i:i + BATCH_SIZE] for i in range(0, len(record_ids), BATCH_SIZE)]
    total = 0
    all_errors = []

    def _delete_chunk(chunk):
        resp = _feishu_request(
            "POST",
            f"/apps/{APP_TOKEN}/tables/{table_id}/records/batch_delete",
            {"records": chunk},
        )
        if resp.get("code") == 0:
            return len(chunk), []
        return 0, [{"op": "batch_delete", "count": len(chunk),
                     "code": resp.get("code"), "msg": resp.get("msg", "")[:200]}]

    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {executor.submit(_delete_chunk, c): c for c in chunks}
        for future in as_completed(futures):
            try:
                n, errs = future.result()
                total += n
                all_errors.extend(errs)
            except Exception as e:
                all_errors.append({"op": "batch_delete", "error": str(e)[:200]})
    return total, all_errors
```

- [ ] **Step 3: 验证 common.py 无语法错误**

```bash
python -c "from feishu.common import _feishu_request; print('common OK')"
```

- [ ] **Step 4: Commit**

```bash
git add feishu/ && git commit -m "feat: add feishu/ package skeleton with common.py"
```

---

### Task 3: table_utils.py 模块

**Files:**
- Create: `feishu/table_utils.py`
- Modify: `feishu_sync.py` (删除提取的部分)

- [ ] **Step 1: 创建 table_utils.py**

从 `feishu_sync.py` 提取表管理相关代码到 `feishu/table_utils.py`：

```python
# -*- coding: utf-8 -*-
"""飞书表管理工具：建表、查表、字段管理、表定义"""
import json
import time
from db import get_db
from feishu.common import (
    _feishu_data, _feishu_raw, _feishu_request,
    APP_TOKEN, WHITELIST_TABLES,
)

# 18字段定义（建表用）
TABLE_FIELDS = [
    {"field_name": "任务名", "type": 1, "ui_type": "Text"},
    {"field_name": "所属来源", "type": 1, "ui_type": "Text"},
    {"field_name": "任务类型", "type": 1, "ui_type": "Text"},
    {"field_name": "优先级", "type": 1, "ui_type": "Text"},
    {"field_name": "难度", "type": 1, "ui_type": "Text"},
    {"field_name": "排班开始", "type": 5, "ui_type": "DateTime",
     "property": {"auto_fill": False, "date_formatter": "yyyy/MM/dd HH:mm"}},
    {"field_name": "排班结束", "type": 5, "ui_type": "DateTime",
     "property": {"auto_fill": False, "date_formatter": "yyyy/MM/dd HH:mm"}},
    {"field_name": "排班时长", "type": 1, "ui_type": "Text"},
    {"field_name": "实际开始", "type": 5, "ui_type": "DateTime",
     "property": {"auto_fill": False, "date_formatter": "yyyy/MM/dd HH:mm"}},
    {"field_name": "实际结束", "type": 5, "ui_type": "DateTime",
     "property": {"auto_fill": False, "date_formatter": "yyyy/MM/dd HH:mm"}},
    {"field_name": "状态", "type": 3, "ui_type": "SingleSelect",
     "property": {"options": [
         {"name": "待开始", "color": 7},
         {"name": "采集中", "color": 2},
         {"name": "采集即将完成", "color": 3},
         {"name": "暂停中", "color": 4},
         {"name": "暂停即将超时", "color": 5},
         {"name": "过时待确认", "color": 6},
         {"name": "已完成", "color": 0}]}},
    {"field_name": "排班备注", "type": 1, "ui_type": "Text"},
    {"field_name": "异常标记", "type": 3, "ui_type": "SingleSelect",
     "property": {"options": [
         {"name": "正常", "color": 1}, {"name": "机器故障", "color": 2},
         {"name": "缺少物料", "color": 3}, {"name": "无法执行", "color": 4}]}},
    {"field_name": "异常备注", "type": 1, "ui_type": "Text"},
    {"field_name": "异常耗时", "type": 1, "ui_type": "Text"},
    {"field_name": "预估时段", "type": 1, "ui_type": "Text"},
    {"field_name": "预估时长", "type": 1, "ui_type": "Text"},
    {"field_name": "修改与同步时间", "type": 5, "ui_type": "DateTime",
     "property": {"auto_fill": False, "date_formatter": "yyyy/MM/dd HH:mm"}},
]

SYSTEM_FIELDS = {"任务名", "所属来源", "任务类型", "优先级", "难度",
                 "排班开始", "排班结束", "预估时长", "状态",
                 "异常耗时", "修改与同步时间"}
USER_FIELDS = {"排班备注"}
LOCAL_USER_FIELDS = {"异常标记": "exception_mark", "异常备注": "exception_note",
                     "预估时段": "estimated_window"}


def _build_exception_options_property():
    """从 config 表读取异常标记选项，构造单选字段 options"""
    raw = None
    try:
        conn = get_db()
        row = conn.execute(
            "SELECT value FROM config WHERE category='feishu' AND key='exception_options'"
        ).fetchone()
        conn.close()
        if row:
            raw = row["value"]
    except Exception:
        pass

    if not raw:
        raw = '["正常", "机器故障", "缺少物料", "无法执行"]'

    try:
        options = json.loads(raw)
    except json.JSONDecodeError:
        options = ["正常", "机器故障", "缺少物料", "无法执行"]

    colors = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    return {"options": [{"name": opt, "color": colors[i % len(colors)]}
                        for i, opt in enumerate(options)]}


def _find_table_by_name(name):
    """在 Base 中按名称查找表格（仅精确匹配，支持分页）。返回 table_id 或 None。"""
    page_token = None
    while True:
        p = f"&page_token={page_token}" if page_token else ""
        data = _feishu_data("GET", f"/apps/{APP_TOKEN}/tables?page_size=200{p}")
        if not data:
            return None
        for item in data.get("items", []):
            if item.get("name") == name:
                return item.get("table_id")
        if not data.get("has_more"):
            break
        page_token = data.get("page_token")
    return None


def _fetch_all_tables_snapshot():
    """一次性分页拉取 Base 全部表。
    返回 (snapshot: {name: table_id}, conflicts: [(name, table_id), ...])
    snapshot 不含 _conflict 表和白名单表。
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
            elif name not in WHITELIST_TABLES:
                snapshot[name] = tid
        if not data.get("has_more"):
            break
        page_token = data.get("page_token")
    return snapshot, conflicts


def _lookup_table_name(table_id):
    """从列表接口查找指定 table_id 的表名。找不到返回 None。"""
    data = _feishu_data("GET", f"/apps/{APP_TOKEN}/tables")
    for item in data.get("items", []):
        if item.get("table_id") == table_id:
            return item.get("name")
    return None


def _create_table(machine_name):
    """建表 + 名校验：POST 创建飞书表，验证返回的表名与期望一致。
    飞书可能因重名自动改名（如 BR1-02 → BR1-02 (1)），此时删掉改名表并重试。
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
        code = resp.get("code")
        if code == 0:
            table_id = resp.get("data", {}).get("table_id")
            if not table_id:
                continue
            actual_name = _lookup_table_name(table_id)
            if actual_name == machine_name:
                return table_id, None
            if actual_name:
                _feishu_raw("DELETE", f"/apps/{APP_TOKEN}/tables/{table_id}")
                time.sleep(0.5)
                continue
            return table_id, None
        if code == 1254013:
            return None, "table name conflict"
        time.sleep(0.5)

    return None, "Failed after 3 retries"


def ensure_table_fields(table_id):
    """检查飞书表字段完整性，缺字段则补加。返回缺失的字段名列表。"""
    data = _feishu_data("GET", f"/apps/{APP_TOKEN}/tables/{table_id}/fields")
    if not data:
        return ["API error: no data returned"]

    existing_names = {f["field_name"] for f in data.get("items", [])}
    expected_names = {f["field_name"] for f in TABLE_FIELDS}
    missing = [n for n in expected_names if n not in existing_names]

    if not missing:
        return []

    missing_defs = [dict(f) for f in TABLE_FIELDS if f["field_name"] in missing]
    for fdef in missing_defs:
        if fdef["field_name"] == "异常标记":
            fdef["property"] = _build_exception_options_property()

    for fdef in missing_defs:
        payload = {"field": fdef}
        _feishu_request("POST", f"/apps/{APP_TOKEN}/tables/{table_id}/fields", payload)
        time.sleep(0.2)

    return missing
```

- [ ] **Step 2: 从 feishu_sync.py 删除对应的旧代码**

删除 `feishu_sync.py` 中以下内容：
- `BASE_URL`、`APP_TOKEN` 常量（已移入 common.py）
- `_session`（已移入 common.py）
- `TABLE_FIELDS`、`SYSTEM_FIELDS`、`USER_FIELDS`、`LOCAL_USER_FIELDS`（已移入 table_utils.py）
- `_build_exception_options_property`（已移入 table_utils.py）
- `_find_table_by_name`（已移入 table_utils.py）
- `_fetch_all_tables_snapshot`（已移入 table_utils.py）
- `_lookup_table_name`（已移入 table_utils.py）
- `_create_table`（已移入 table_utils.py）
- `ensure_table_fields`（已移入 table_utils.py）
- `_batch_create_records`、`_batch_update_records`、`_batch_delete_records`（已移入 common.py）
- `_feishu_data`、`_feishu_raw`、`_feishu_request`（已移入 common.py）
- `PUSH_DAYS_BEFORE`、`PUSH_DAYS_AFTER`、`ROW_LIMIT`、`BATCH_SIZE`（已移入 common.py）
- `MACHINE_CONFIG_TABLE`（已移入 common.py）

在 `feishu_sync.py` 顶部添加 import：
```python
from feishu.common import (
    _feishu_data, _feishu_raw, _feishu_request,
    _batch_create_records, _batch_update_records, _batch_delete_records,
    APP_TOKEN, BATCH_SIZE, ROW_LIMIT, MACHINE_CONFIG_TABLE,
)
from feishu.table_utils import (
    TABLE_FIELDS, SYSTEM_FIELDS, USER_FIELDS, LOCAL_USER_FIELDS,
    _build_exception_options_property, _find_table_by_name,
    _fetch_all_tables_snapshot, _lookup_table_name, _create_table,
    ensure_table_fields,
)
```

注意：保留 `CONFIG_TABLE_FIELDS` 等配置表相关定义在 `feishu_sync.py`（稍后移入 config_table.py）。

- [ ] **Step 3: 验证 import 正常**

```bash
python -c "from feishu.table_utils import TABLE_FIELDS; print(len(TABLE_FIELDS))"
```

预期输出: `18`

- [ ] **Step 4: Commit**

```bash
git add feishu/table_utils.py feishu_sync.py && git commit -m "refactor: extract table_utils.py from feishu_sync.py"
```

---

### Task 4: config_table.py 模块

**Files:**
- Create: `feishu/config_table.py`
- Modify: `feishu_sync.py` (删除配置表相关代码)

- [ ] **Step 1: 创建 config_table.py**

```python
# -*- coding: utf-8 -*-
"""飞书机器配置表同步"""
from db import get_db
from feishu.common import (
    _feishu_data, _feishu_raw, _feishu_request,
    _batch_create_records, _batch_update_records, _batch_delete_records,
    APP_TOKEN, MACHINE_CONFIG_TABLE,
)

CONFIG_TABLE_FIELDS = [
    {"field_name": "机器名", "type": 1, "ui_type": "Text"},
    {"field_name": "机型", "type": 1, "ui_type": "Text"},
    {"field_name": "分组名", "type": 1, "ui_type": "Text"},
    {"field_name": "任务类型", "type": 1, "ui_type": "Text"},
    {"field_name": "状态", "type": 3, "ui_type": "SingleSelect",
     "property": {"options": [
         {"name": "运行中", "color": 1},
         {"name": "维修停用", "color": 2},
         {"name": "空闲", "color": 3},
     ]}},
    {"field_name": "备注", "type": 1, "ui_type": "Text"},
]

STATUS_TRANSLATE = {
    "工作": "运行中",
    "空闲": "空闲",
    "维修停用": "维修停用",
}


def ensure_config_table_fields(table_id):
    """检查机器配置表字段完整性，缺字段则补加。返回缺失的字段名列表。"""
    data = _feishu_data("GET", f"/apps/{APP_TOKEN}/tables/{table_id}/fields")
    if not data:
        return ["API error: no data returned"]

    existing_names = {f["field_name"] for f in data.get("items", [])}
    expected_names = {f["field_name"] for f in CONFIG_TABLE_FIELDS}
    missing = [n for n in expected_names if n not in existing_names]

    if not missing:
        return []

    missing_defs = [dict(f) for f in CONFIG_TABLE_FIELDS if f["field_name"] in missing]
    for fdef in missing_defs:
        _feishu_request("POST", f"/apps/{APP_TOKEN}/tables/{table_id}/fields", {"field": fdef})
        import time
        time.sleep(0.2)

    return missing


def ensure_machine_config_table():
    """确保飞书机器配置表存在。返回 table_id 或 None。"""
    from feishu.table_utils import _find_table_by_name
    existing = _find_table_by_name(MACHINE_CONFIG_TABLE)
    if existing:
        ensure_config_table_fields(existing)
        return existing

    fields = [
        {"field_name": "机器名", "type": 1, "ui_type": "Text"},
        {"field_name": "机型", "type": 1, "ui_type": "Text"},
        {"field_name": "分组名", "type": 1, "ui_type": "Text"},
        {"field_name": "任务类型", "type": 1, "ui_type": "Text"},
        {"field_name": "状态", "type": 3, "ui_type": "SingleSelect",
         "property": {"options": [
             {"name": "运行中", "color": 1},
             {"name": "维修停用", "color": 2},
             {"name": "空闲", "color": 3},
         ]}},
        {"field_name": "备注", "type": 1, "ui_type": "Text"},
    ]
    resp = _feishu_request("POST", f"/apps/{APP_TOKEN}/tables", {
        "table": {"name": MACHINE_CONFIG_TABLE, "default_view_name": "默认视图", "fields": fields},
    })
    if resp.get("code") == 0:
        return resp.get("data", {}).get("table_id")
    return None


def push_machine_config():
    """同步本地 machines 表到飞书机器配置表。返回变更计数。"""
    from feishu.table_utils import _find_table_by_name
    table_id = _find_table_by_name(MACHINE_CONFIG_TABLE)
    if not table_id:
        return {"error": "Config table not found"}

    ensure_config_table_fields(table_id)

    conn = get_db()
    machines = conn.execute(
        "SELECT id, name, type, status, task_kind, group_name, remark FROM machines ORDER BY sort_order ASC"
    ).fetchall()
    conn.close()

    # 读飞书全量
    feishu_map = {}
    orphan_record_ids = []
    page_token = None
    while True:
        p = f"&page_token={page_token}" if page_token else ""
        data = _feishu_data(
            "GET", f"/apps/{APP_TOKEN}/tables/{table_id}/records?page_size=500&automatic_fields=true{p}"
        )
        if data:
            for item in data.get("items", []):
                fname = _parse_feishu_text(item.get("fields", {}).get("机器名"))
                if fname:
                    feishu_map[fname] = item
                elif item.get("record_id"):
                    orphan_record_ids.append(item["record_id"])
        if not data or not data.get("has_more"):
            break
        page_token = data.get("page_token")

    to_create = []
    to_update = []
    matched_names = set()

    for mc in machines:
        name = mc["name"]
        matched_names.add(name)
        raw_status = mc["status"] or ""
        fields = {
            "机器名": name,
            "机型": mc["type"] or "",
            "分组名": mc["group_name"] or "",
            "任务类型": mc["task_kind"] or "",
            "状态": STATUS_TRANSLATE.get(raw_status, raw_status),
            "备注": mc["remark"] or "",
        }
        if name in feishu_map:
            to_update.append({
                "record_id": feishu_map[name]["record_id"],
                "fields": fields,
            })
        else:
            to_create.append({"fields": fields})

    to_delete = [
        feishu_map[n]["record_id"] for n in feishu_map if n not in matched_names
    ] + orphan_record_ids

    created, _rids, ce = _batch_create_records(table_id, to_create)
    updated, ue = _batch_update_records(table_id, to_update)
    deleted, de = _batch_delete_records(table_id, to_delete)

    result = {"created": created, "updated": updated, "deleted": deleted}
    errors = ce + ue + de
    if errors:
        result["errors"] = errors
    return result


def _parse_feishu_text(val):
    """解析飞书文本/单选字段值"""
    if val is None:
        return None
    if isinstance(val, str):
        return val
    if isinstance(val, list) and len(val) > 0:
        return val[0].get("text", "")
    return None
```

- [ ] **Step 2: 从 feishu_sync.py 删除配置表相关代码**

删除 `feishu_sync.py` 中的：
- `CONFIG_TABLE_FIELDS`
- `ensure_config_table_fields`
- `ensure_machine_config_table`
- `push_machine_config`
- `STATUS_TRANSLATE`

并在顶部添加 import：
```python
from feishu.config_table import (
    ensure_machine_config_table, push_machine_config,
)
```

- [ ] **Step 3: 验证**

```bash
python -c "from feishu.config_table import CONFIG_TABLE_FIELDS; print([f['field_name'] for f in CONFIG_TABLE_FIELDS])"
```

预期输出字段名包含：`['机器名', '机型', '分组名', '任务类型', '状态', '备注']`

- [ ] **Step 4: Commit**

```bash
git add feishu/config_table.py feishu_sync.py && git commit -m "refactor: extract config_table.py from feishu_sync.py"
```

---

### Task 5: schedule_sync.py 模块

**Files:**
- Create: `feishu/schedule_sync.py`
- Modify: `feishu_sync.py` (删除排班同步相关代码)

- [ ] **Step 1: 创建 schedule_sync.py**

```python
# -*- coding: utf-8 -*-
"""飞书排班同步：推送、拉取、状态计算"""
import datetime
from feishu.common import (
    _feishu_data, _feishu_raw, _feishu_request,
    _batch_create_records, _batch_update_records, _batch_delete_records,
    APP_TOKEN, BATCH_SIZE,
)
from feishu.table_utils import SYSTEM_FIELDS, USER_FIELDS
from db import get_db
from models import recycle_schedules, _get_repair_for_schedule
from utils import format_elapsed, normalize_machine_schedule, today

PUSH_DAYS_BEFORE = 3
PUSH_DAYS_AFTER = 7


def compute_task_statuses(conn, alert_minutes=15):
    """返回 {task_id: computed_status}。与前端 timeline 同逻辑。
    仅返回有活跃排班（status != 'completed'）的任务状态。
    """
    now = datetime.datetime.now()

    schedules_rows = conn.execute(
        "SELECT id, date, machine_id, task_id, start_min, end_min "
        "FROM schedules WHERE status != 'completed'"
    ).fetchall()

    machines_rows = conn.execute("SELECT id, status FROM machines").fetchall()
    machine_statuses = {int(m["id"]): m["status"] for m in machines_rows}

    task_statuses = {}

    for s in schedules_rows:
        mid = int(s["machine_id"])
        tid = s["task_id"]
        if tid is None:
            continue

        try:
            base_date = datetime.date.fromisoformat(s["date"])
            start_dt = datetime.datetime.combine(base_date, datetime.time(0, 0)) + datetime.timedelta(minutes=int(s["start_min"]))
            end_dt = datetime.datetime.combine(base_date, datetime.time(0, 0)) + datetime.timedelta(minutes=int(s["end_min"]))
        except ValueError:
            continue

        if start_dt <= now < end_dt:
            remaining_sec = (end_dt - now).total_seconds()
            nearing = remaining_sec <= alert_minutes * 60
            if machine_statuses.get(mid) == "维修停用":
                task_statuses[int(tid)] = "暂停即将超时" if nearing else "暂停中"
            else:
                task_statuses[int(tid)] = "采集即将完成" if nearing else "采集中"
        elif end_dt <= now:
            if int(tid) not in task_statuses or task_statuses[int(tid)] != "采集中":
                task_statuses[int(tid)] = "过时待确认"

    return task_statuses


def _sort_by_priority(rows, today_str):
    """按时间优先级排序：今天 > ±1天 > 其余按日期距离"""
    today = datetime.date.fromisoformat(today_str)

    def _pri(r):
        d = datetime.date.fromisoformat(r["date"])
        dist = abs((d - today).days)
        if dist == 0:
            return 0
        if dist == 1:
            return 1
        return dist

    return sorted(rows, key=_pri)


def _date_min_to_timestamps(date_str, start_min, end_min):
    """将 date + 绝对分钟 转为两个毫秒级时间戳"""
    try:
        dt = datetime.date.fromisoformat(date_str)
        base = datetime.datetime.combine(dt, datetime.time.min)
        start_ts = int((base + datetime.timedelta(minutes=start_min)).timestamp() * 1000)
        end_ts = int((base + datetime.timedelta(minutes=end_min)).timestamp() * 1000)
        return start_ts, end_ts
    except Exception:
        return None, None


def push_machine_schedules(machine_id):
    """将一台机器的排班推送到其飞书表。返回变更计数。"""
    conn = get_db()
    mapping = conn.execute(
        "SELECT * FROM feishu_sync_mapping WHERE machine_id=?", (machine_id,)
    ).fetchone()
    if not mapping:
        conn.close()
        return {"error": "No mapping", "machine_id": machine_id}

    table_id = mapping["table_id"]

    dt_today = today()
    date_from = (dt_today - datetime.timedelta(days=PUSH_DAYS_BEFORE)).isoformat()
    date_to = (dt_today + datetime.timedelta(days=PUSH_DAYS_AFTER)).isoformat()

    rows = conn.execute(
        """SELECT s.id, s.date, s.task_id, s.task_name, s.task_type, s.task_kind,
                  s.start_min, s.end_min, s.duration, s.status, s.remark,
                  s.actual_start_min, s.actual_end_min,
                  s.exception_mark, s.exception_note,
                  s.estimated_window, s.updated_at,
                  t.priority, t.difficulty, t.est_seconds, t.status AS task_status,
                  pkg.name AS package_name
           FROM schedules s
           LEFT JOIN tasks t ON s.task_id = t.id
           LEFT JOIN task_packages pkg ON t.package_id = pkg.id
           WHERE s.machine_id=? AND s.date >= ? AND s.date <= ?
           ORDER BY s.date ASC, s.start_min ASC""",
        (machine_id, date_from, date_to),
    ).fetchall()
    conn.close()

    # 读取本地 schedule_id → feishu_record_id 映射
    conn2 = get_db()
    record_mapping = {}
    for rm in conn2.execute(
        "SELECT schedule_id, feishu_record_id FROM feishu_record_mapping WHERE machine_id=?",
        (machine_id,)
    ).fetchall():
        record_mapping[rm["schedule_id"]] = rm["feishu_record_id"]
    conn2.close()

    # 获取动态计算状态
    conn3 = get_db()
    dynamic_statuses = compute_task_statuses(conn3)
    conn3.close()

    # 维修查询用连接
    repair_conn = get_db()

    sorted_rows = _sort_by_priority(rows, dt_today.isoformat())

    # 读取飞书端现有记录
    feishu_record_map = {}
    page_token = None
    while True:
        p = f"&page_token={page_token}" if page_token else ""
        data = _feishu_data(
            "GET", f"/apps/{APP_TOKEN}/tables/{table_id}/records?page_size=500&automatic_fields=true{p}"
        )
        if data:
            for item in data.get("items", []):
                feishu_record_map[item["record_id"]] = item
        if not data or not data.get("has_more"):
            break
        page_token = data.get("page_token")

    # 按 schedule_id 索引飞书记录
    feishu_map = {}
    for sid, rid in record_mapping.items():
        if rid in feishu_record_map:
            feishu_map[sid] = feishu_record_map.pop(rid)

    orphan_record_ids = list(feishu_record_map.keys())
    total_feishu_before = len(feishu_map) + len(orphan_record_ids)

    to_create = []
    to_update = []
    errors = []

    for row in sorted_rows:
        r = dict(row)
        sid = r["id"]
        est_start_ts, est_end_ts = _date_min_to_timestamps(r["date"], r["start_min"], r["end_min"])

        local_task_status = r.get("task_status") or ""
        tid = r.get("task_id")
        if r.get("status") == "completed":
            feishu_status = "已完成"
        elif tid is not None and int(tid) in dynamic_statuses:
            feishu_status = dynamic_statuses[int(tid)]
        elif local_task_status == "已完成":
            feishu_status = "已完成"
        elif local_task_status == "已分配":
            feishu_status = "待开始"
        else:
            feishu_status = ""

        est_duration_text = ""
        if r.get("est_seconds"):
            est_duration_text = format_elapsed(r["est_seconds"] // 60)

        repair_duration_text = ""
        repairs = _get_repair_for_schedule(
            repair_conn, machine_id, r["date"],
            int(r["start_min"]), int(r["end_min"])
        )
        if isinstance(repairs, list):
            total_repair_min = sum(p.get("duration_minutes", 0) for p in repairs)
            if total_repair_min > 0:
                repair_duration_text = format_elapsed(total_repair_min)

        sync_ts = None
        if r.get("updated_at"):
            sync_ts = int(r["updated_at"])

        actual_start_ts = None
        actual_end_ts = None
        if r.get("actual_start_min") is not None:
            actual_start_ts, _ = _date_min_to_timestamps(r["date"], int(r["actual_start_min"]), 0)
        if r.get("actual_end_min") is not None:
            actual_end_ts, _ = _date_min_to_timestamps(r["date"], int(r["actual_end_min"]), 0)

        sys_fields = {
            "任务名": r["task_name"],
            "所属来源": r.get("package_name") or "",
            "任务类型": r["task_type"],
            "优先级": r.get("priority") or "",
            "难度": r.get("difficulty") or "",
            "排班开始": est_start_ts,
            "排班结束": est_end_ts,
            "实际开始": actual_start_ts,
            "实际结束": actual_end_ts,
            "排班时长": format_elapsed(r["end_min"] - r["start_min"]) if r.get("end_min") and r.get("start_min") else "",
            "状态": feishu_status,
            "排班备注": r.get("remark") or "",
            "异常标记": r.get("exception_mark") or "正常",
            "异常备注": r.get("exception_note") or "",
            "异常耗时": repair_duration_text,
            "预估时段": r.get("estimated_window") or "",
            "预估时长": est_duration_text,
            "修改与同步时间": sync_ts,
        }

        if sid in feishu_map:
            existing = feishu_map[sid]
            ex_fields = existing.get("fields", {})
            for uf in USER_FIELDS:
                val = ex_fields.get(uf)
                if val is not None and val != "":
                    sys_fields[uf] = val
            to_update.append({
                "record_id": existing["record_id"],
                "fields": sys_fields,
            })
            del feishu_map[sid]
        else:
            to_create.append({"fields": sys_fields, "_schedule_id": sid})

    to_delete = [item["record_id"] for item in feishu_map.values()] + orphan_record_ids
    repair_conn.close()

    # 批量操作
    created, created_record_ids, create_errors = _batch_create_records(table_id, to_create)
    errors.extend(create_errors)
    updated, update_errors = _batch_update_records(table_id, to_update)
    errors.extend(update_errors)
    deleted, delete_errors = _batch_delete_records(table_id, to_delete)
    errors.extend(delete_errors)

    # 写入新创建的 schedule_id ↔ feishu_record_id 映射
    if created > 0 and created_record_ids:
        try:
            conn4 = get_db()
            for item, rid in zip(to_create, created_record_ids):
                sid = item["_schedule_id"]
                conn4.execute(
                    "INSERT OR REPLACE INTO feishu_record_mapping (schedule_id, machine_id, feishu_record_id) VALUES (?, ?, ?)",
                    (int(sid), machine_id, rid),
                )
            conn4.commit()
            conn4.close()
        except Exception:
            pass

    # 清理已删除 schedule 的映射记录
    if deleted > 0:
        try:
            conn5 = get_db()
            deleted_rids = set(to_delete)
            for rid in deleted_rids:
                conn5.execute(
                    "DELETE FROM feishu_record_mapping WHERE feishu_record_id=? AND machine_id=?",
                    (rid, machine_id),
                )
            conn5.commit()
            conn5.close()
        except Exception:
            pass

    # 更新最后推送时间
    try:
        conn6 = get_db()
        conn6.execute(
            "UPDATE feishu_sync_mapping SET last_push_at=? WHERE machine_id=?",
            (datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"), machine_id),
        )
        conn6.commit()
        conn6.close()
    except Exception:
        pass

    result = {
        "created": created, "updated": updated, "deleted": deleted,
        "total_system": len(sorted_rows), "total_feishu_before": total_feishu_before,
    }
    if errors:
        result["errors"] = errors
    return result


def _parse_feishu_datetime_for_pull(val, date_str):
    """将飞书 DateTime 毫秒时间戳转为相对 schedule.date 的绝对分钟数。支持跨天。"""
    if val is None:
        return None
    try:
        if isinstance(val, (int, float)):
            ts = val / 1000.0
            dt = datetime.datetime.fromtimestamp(ts)
            base = datetime.datetime.combine(
                datetime.date.fromisoformat(date_str),
                datetime.time.min,
            )
            return int((dt - base).total_seconds() / 60)
    except Exception:
        pass
    return None


def _format_drift_window(date_str, start_min, end_min):
    """将 date + 绝对分钟 格式化为人类可读的漂移窗口字符串。"""
    try:
        dt = datetime.date.fromisoformat(date_str)
        base = datetime.datetime.combine(dt, datetime.time.min)
        start_dt = base + datetime.timedelta(minutes=int(start_min))
        end_dt = base + datetime.timedelta(minutes=int(end_min))
        if start_dt.date() == end_dt.date():
            return f"{start_dt:%m/%d %H:%M}~{end_dt:%H:%M}"
        else:
            return f"{start_dt:%m/%d %H:%M}~{end_dt:%m/%d %H:%M}"
    except Exception:
        return ""


def _parse_feishu_text(val):
    """解析飞书文本/单选字段值"""
    if val is None:
        return None
    if isinstance(val, str):
        return val
    if isinstance(val, list) and len(val) > 0:
        return val[0].get("text", "")
    return None


def _pull_one_machine(table_id, machine_id, machine_name):
    """拉取单台机器的飞书变更。返回 (machine_changes, exception_events, error)。"""
    all_items = []
    page_token = None
    while True:
        p = f"&page_token={page_token}" if page_token else ""
        data = _feishu_data(
            "GET", f"/apps/{APP_TOKEN}/tables/{table_id}/records?page_size=500&automatic_fields=true{p}"
        )
        if not data:
            return None, None, {"machine": machine_name, "error": "API returned no data"}
        all_items.extend(data.get("items", []))
        if not data.get("has_more"):
            break
        page_token = data.get("page_token")

    machine_changes = _apply_pull_changes(machine_id, machine_name, all_items)
    _handle_exception_events(machine_id, machine_name, machine_changes.get("exception_events", []))
    return machine_changes, None, None


def _apply_pull_changes(machine_id, machine_name, feishu_items):
    """将飞书记录变更应用到本地 schedules 表。返回变更详情和异常事件。"""
    conn = get_db()
    updated = 0
    detail = []
    exception_events = []

    record_to_schedule = {}
    for rm in conn.execute(
        "SELECT schedule_id, feishu_record_id FROM feishu_record_mapping WHERE machine_id=?",
        (machine_id,)
    ).fetchall():
        record_to_schedule[rm["feishu_record_id"]] = rm["schedule_id"]

    for item in feishu_items:
        fields = item.get("fields", {})
        record_id = item.get("record_id")

        schedule_id = record_to_schedule.get(record_id)
        if not schedule_id:
            continue

        existing = conn.execute(
            "SELECT * FROM schedules WHERE id=?", (schedule_id,)
        ).fetchone()
        if not existing:
            continue

        actual_start = _parse_feishu_datetime_for_pull(fields.get("实际开始"), existing["date"])
        actual_end = _parse_feishu_datetime_for_pull(fields.get("实际结束"), existing["date"])
        remark = _parse_feishu_text(fields.get("排班备注"))
        exception = _parse_feishu_text(fields.get("异常标记"))
        feishu_ms = item.get("last_modified_time", 0) or 0
        changed = False

        validation_error = None
        if actual_start is not None and actual_end is not None:
            if actual_start > actual_end:
                validation_error = "实际开始晚于实际结束"

        if remark is not None and remark != (existing["remark"] or ""):
            conn.execute(
                "UPDATE schedules SET remark=? WHERE id=?",
                (remark, schedule_id),
            )
            detail.append({
                "machine": machine_name, "schedule_id": schedule_id,
                "field": "remark", "value": remark,
            })
            changed = True

        if actual_start is not None and actual_start != (existing["actual_start_min"] or 0):
            if not validation_error:
                conn.execute(
                    "UPDATE schedules SET actual_start_min=? WHERE id=?",
                    (actual_start, schedule_id),
                )
                detail.append({
                    "machine": machine_name, "schedule_id": schedule_id,
                    "field": "actual_start_min", "value": actual_start,
                })
                changed = True

        if actual_end is not None and actual_end != (existing["actual_end_min"] or 0):
            if validation_error:
                detail.append({
                    "machine": machine_name, "schedule_id": schedule_id,
                    "field": "actual_end_min", "error": validation_error,
                })
            else:
                conn.execute(
                    "UPDATE schedules SET actual_end_min=? WHERE id=?",
                    (actual_end, schedule_id),
                )
                detail.append({
                    "machine": machine_name, "schedule_id": schedule_id,
                    "field": "actual_end_min", "value": actual_end,
                })
                changed = True
                if existing["status"] != "completed":
                    conn.execute(
                        "UPDATE schedules SET status='completed', completed_at=? WHERE id=?",
                        (datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"), schedule_id),
                    )
                    detail.append({
                        "machine": machine_name, "schedule_id": schedule_id,
                        "field": "status", "value": "completed (auto from feishu)",
                    })
                    tid = existing["task_id"]
                    if tid is not None:
                        remaining = conn.execute(
                            "SELECT COUNT(*) AS c FROM schedules WHERE task_id=? AND status!='completed'",
                            (int(tid),),
                        ).fetchone()
                        if not remaining or remaining["c"] == 0:
                            conn.execute("UPDATE tasks SET status=? WHERE id=?", ("已完成", int(tid)))

        sched_start = _parse_feishu_datetime_for_pull(fields.get("排班开始"), existing["date"])
        sched_end = _parse_feishu_datetime_for_pull(fields.get("排班结束"), existing["date"])
        if sched_start is not None and sched_end is not None:
            old_start = existing["start_min"]
            old_end = existing["end_min"]
            if sched_start != (old_start or 0) or sched_end != (old_end or 0):
                if old_start is not None and old_end is not None:
                    drift_window = _format_drift_window(
                        existing["date"], old_start, old_end
                    )
                    conn.execute(
                        "UPDATE schedules SET estimated_window=? WHERE id=?",
                        (drift_window, schedule_id),
                    )
                conn.execute(
                    "UPDATE schedules SET start_min=?, end_min=? WHERE id=?",
                    (sched_start, sched_end, schedule_id),
                )
                from utils import normalize_machine_schedule
                normalize_machine_schedule(conn, existing["date"], machine_id)
                detail.append({
                    "machine": machine_name, "schedule_id": schedule_id,
                    "field": "scheduled_time", "value": f"{sched_start}-{sched_end}",
                })
                changed = True

        exception = _parse_feishu_text(fields.get("异常标记"))
        exception_note = _parse_feishu_text(fields.get("异常备注")) or ""
        local_exc = existing["exception_mark"] if "exception_mark" in existing.keys() else None
        if exception is not None and exception != local_exc:
            conn.execute(
                "UPDATE schedules SET exception_mark=?, exception_note=? WHERE id=?",
                (exception, exception_note, schedule_id),
            )
            detail.append({
                "machine": machine_name, "schedule_id": schedule_id,
                "field": "exception_mark", "value": exception,
            })
            changed = True

        if exception and exception != "正常" and exception != local_exc:
            exception_events.append({
                "machine_id": machine_id,
                "machine_name": machine_name,
                "schedule_id": schedule_id,
                "exception": exception,
                "exception_note": _parse_feishu_text(fields.get("异常备注")) or "",
            })
        elif exception == "正常" and local_exc and local_exc not in (None, "正常"):
            exception_events.append({
                "machine_id": machine_id,
                "machine_name": machine_name,
                "schedule_id": schedule_id,
                "exception": "正常",
            })

        if changed:
            conn.execute(
                "UPDATE schedules SET updated_at=? WHERE id=?",
                (feishu_ms, schedule_id),
            )
            updated += 1

    conn.commit()
    conn.close()

    return {
        "records_updated": updated,
        "detail": detail,
        "exception_events": exception_events,
    }


def _handle_exception_events(machine_id, machine_name, events):
    """处理异常标记变更 → 调用本地共享维修函数"""
    if not events:
        return

    from utils import start_repair, end_repair

    conn = get_db()
    for event in events:
        exception = event["exception"]

        if exception in ("机器故障", "缺少物料"):
            machine = conn.execute(
                "SELECT status FROM machines WHERE id=?", (machine_id,)
            ).fetchone()
            if machine and machine["status"] != "维修停用":
                conn.execute(
                    "UPDATE machines SET status='维修停用' WHERE id=?", (machine_id,)
                )
                start_repair(conn, machine_id)
                conn.commit()

        elif exception == "无法执行":
            schedule_id = event["schedule_id"]
            schedule = conn.execute(
                "SELECT date, task_id FROM schedules WHERE id=?", (schedule_id,)
            ).fetchone()
            if schedule:
                recycle_schedules(conn, schedule_ids=[schedule_id])
                conn.commit()
                normalize_machine_schedule(conn, schedule["date"], machine_id)
                conn.commit()

        elif exception == "正常":
            machine = conn.execute(
                "SELECT status FROM machines WHERE id=?", (machine_id,)
            ).fetchone()
            if machine and machine["status"] == "维修停用":
                conn.execute(
                    "UPDATE machines SET status='空闲' WHERE id=?", (machine_id,)
                )
                end_repair(conn, machine_id)
                conn.commit()

    conn.close()


def pull_all_machines():
    """并行从飞书拉取所有已映射机器的变更。"""
    from concurrent.futures import ThreadPoolExecutor, as_completed
    conn = get_db()
    mappings = conn.execute("SELECT * FROM feishu_sync_mapping").fetchall()
    conn.close()

    result = {"machines_checked": 0, "records_updated": 0, "errors": [], "detail": []}

    if not mappings:
        return result

    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {
            executor.submit(
                _pull_one_machine,
                m["table_id"], m["machine_id"], m["machine_name"],
            ): m
            for m in mappings
        }
        for future in as_completed(futures):
            try:
                changes, _, error = future.result()
                if error:
                    result["errors"].append(error)
                else:
                    result["machines_checked"] += 1
                    result["records_updated"] += changes["records_updated"]
                    if changes.get("detail"):
                        result["detail"].extend(changes["detail"])
            except Exception:
                pass

    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    try:
        conn2 = get_db()
        for mapping in mappings:
            conn2.execute(
                "UPDATE feishu_sync_mapping SET last_pull_at=? WHERE machine_id=?",
                (now, mapping["machine_id"]),
            )
        conn2.commit()
        conn2.close()
    except Exception:
        pass

    return result
```

- [ ] **Step 2: 从 feishu_sync.py 删除排班同步相关代码**

删除 `feishu_sync.py` 中：
- `push_machine_schedules`、`compute_task_statuses`、`_sort_by_priority`、`_date_min_to_timestamps`
- `_pull_one_machine`、`pull_all_machines`、`_apply_pull_changes`、`_handle_exception_events`
- `_parse_feishu_datetime_for_pull`、`_format_drift_window`、`_parse_feishu_text`
- `PUSH_DAYS_BEFORE`、`PUSH_DAYS_AFTER`

添加 import：
```python
from feishu.schedule_sync import (
    push_machine_schedules, pull_all_machines, compute_task_statuses,
)
```

- [ ] **Step 3: 验证**

```bash
python -c "from feishu.schedule_sync import push_machine_schedules; print('schedule_sync OK')"
```

- [ ] **Step 4: Commit**

```bash
git add feishu/schedule_sync.py feishu_sync.py && git commit -m "refactor: extract schedule_sync.py from feishu_sync.py"
```

---

### Task 6: status.py 模块

**Files:**
- Create: `feishu/status.py`
- Modify: `feishu_sync.py` (删除状态相关代码)

- [ ] **Step 1: 创建 status.py**

```python
# -*- coding: utf-8 -*-
"""飞书同步状态聚合 & 事件缓冲区"""
import datetime
import time
import threading
from db import get_db
from feishu.common import APP_TOKEN
from feishu.config_table import MACHINE_CONFIG_TABLE

_event_buffer = []
_event_lock = threading.Lock()
MAX_EVENTS = 100
_active_operation = None


def write_event(level, machine, msg, percent=None):
    """操作过程中写入事件。level: info|warn|error。线程安全。"""
    with _event_lock:
        _event_buffer.append({
            "time": datetime.datetime.now().strftime("%H:%M:%S"),
            "level": level,
            "machine": (machine or "")[:50],
            "msg": (msg or "")[:200],
            "percent": percent,
        })
        if len(_event_buffer) > MAX_EVENTS:
            _event_buffer.pop(0)


def get_sync_status(_last_loop_at=None, _last_push_result=None, SYNC_INTERVAL_SEC=30,
                    _consecutive_failures=0, _sync_thread=None, _thread_health=None):
    """聚合同步状态（含完整性检查）
    参数来自 sync_loop 模块的全局变量，传入以避免循环 import。
    """
    try:
        conn = get_db()
        enabled_row = conn.execute(
            "SELECT value FROM config WHERE category='feishu' AND key='sync_enabled'"
        ).fetchone()
        mappings = conn.execute("SELECT * FROM feishu_sync_mapping").fetchall()
        machines = conn.execute(
            "SELECT id, name FROM machines ORDER BY sort_order ASC"
        ).fetchall()
        conn.close()
    except Exception:
        return {
            "enabled": False, "connected": False, "initialized": False,
            "mapping_count": 0, "last_pull_at": None, "last_push_at": None,
            "base_info": APP_TOKEN, "integrity": {"total_machines": 0},
            "db_integrity_ok": True,
        }

    enabled_val = (enabled_row["value"] == "1") if enabled_row else False

    connected = False
    try:
        from feishu.common import _feishu_data
        data = _feishu_data("GET", f"/apps/{APP_TOKEN}/tables")
        connected = bool(data)
    except Exception:
        pass

    mapped_ids = {m["machine_id"]: m for m in mappings}
    machine_map = {m["id"]: m["name"] for m in machines}
    missing_tables = []
    stale_mappings = 0

    for mc in machines:
        if mc["id"] not in mapped_ids:
            missing_tables.append(mc["name"])

    for mid in mapped_ids:
        if mid not in machine_map:
            stale_mappings += 1

    per_machine = []
    for mc in machines:
        mid = mc["id"]
        mname = mc["name"]
        mapping = mapped_ids.get(mid)
        info = {"name": mname, "mapped": mapping is not None, "last_sync": None}
        if mapping:
            pull_at = mapping["last_pull_at"] if "last_pull_at" in mapping.keys() else None
            push_at = mapping["last_push_at"] if "last_push_at" in mapping.keys() else None
            if pull_at and push_at:
                info["last_sync"] = max(pull_at, push_at)
            else:
                info["last_sync"] = pull_at or push_at
        per_machine.append(info)

    next_loop_in_sec = None
    if _last_loop_at and enabled_val:
        elapsed = time.time() - _last_loop_at
        remaining = SYNC_INTERVAL_SEC - elapsed
        next_loop_in_sec = max(0, int(remaining)) if enabled_val else None

    try:
        from db import is_db_integrity_ok
        db_ok = is_db_integrity_ok()
    except Exception:
        db_ok = True

    with _event_lock:
        recent_events = list(_event_buffer[-20:])

    return {
        "enabled": enabled_val,
        "connected": connected,
        "initialized": len(mappings) > 0,
        "initializing": _is_init_locked(),
        "sync_mode": _get_sync_mode(),
        "mapping_count": len(mappings),
        "total_machines": len(machines),
        "last_pull_at": mappings[0]["last_pull_at"] if mappings else None,
        "last_push_at": mappings[0]["last_push_at"] if mappings else None,
        "last_loop_at": _last_loop_at,
        "next_loop_in_sec": next_loop_in_sec,
        "sync_interval_sec": SYNC_INTERVAL_SEC,
        "last_push_result": _last_push_result,
        "base_info": APP_TOKEN,
        "events": recent_events,
        "active_operation": _active_operation,
        "db_integrity_ok": db_ok,
        "sync_health": {
            "consecutive_failures": _consecutive_failures,
            "degraded_level": "normal",
            "thread_alive": _sync_thread is not None and _sync_thread.is_alive() if _sync_thread else False,
            "last_heartbeat": _thread_health.get("last_heartbeat", 0) if _thread_health else 0,
            "restart_count": _thread_health.get("restart_count", 0) if _thread_health else 0,
        },
        "integrity": {
            "total_machines": len(machines),
            "mapped_machines": len(mappings),
            "missing_tables": missing_tables,
            "missing_fields": {},
            "stale_mappings": stale_mappings,
            "validation_errors": [],
            "per_machine": per_machine,
        },
    }


def _is_init_locked():
    """检查 init_lock 状态 — 由 sync_loop 模块设置"""
    # 由 sync_loop 模块设置引用
    return _init_lock_ref is not None and _init_lock_ref.locked()


_init_lock_ref = None


def _get_sync_mode():
    try:
        conn = get_db()
        row = conn.execute(
            "SELECT value FROM config WHERE category='feishu' AND key='sync_mode'"
        ).fetchone()
        conn.close()
        return row["value"] if row else "local"
    except Exception:
        return "local"
```

- [ ] **Step 2: 从 feishu_sync.py 删除对应代码**

删除：`get_sync_status`、`write_event`、`_event_buffer`、`_event_lock`、`MAX_EVENTS`、`_active_operation`、`_is_sync_enabled`、`_get_sync_mode`

添加 import：
```python
from feishu.status import get_sync_status, write_event, _event_buffer, _event_lock, _active_operation
```

- [ ] **Step 3: Commit**

```bash
git add feishu/status.py feishu_sync.py && git commit -m "refactor: extract status.py from feishu_sync.py"
```

---

### Task 7: lifecycle.py 模块

**Files:**
- Create: `feishu/lifecycle.py`
- Modify: `feishu_sync.py` (删除生命周期钩子)

- [ ] **Step 1: 创建 lifecycle.py**

```python
# -*- coding: utf-8 -*-
"""机器生命周期钩子：创建/改名/删除时同步飞书"""
import time
from db import get_db
from feishu.common import (
    _feishu_data, _feishu_raw, _feishu_request, APP_TOKEN,
)


def _is_sync_enabled():
    try:
        conn = get_db()
        row = conn.execute(
            "SELECT value FROM config WHERE category='feishu' AND key='sync_enabled'"
        ).fetchone()
        conn.close()
        return row and row["value"] == "1"
    except Exception:
        return False


def _upsert_mapping(machine_id, machine_name, table_id):
    conn = get_db()
    existing = conn.execute(
        "SELECT id FROM feishu_sync_mapping WHERE machine_id=?", (machine_id,)
    ).fetchone()
    if existing:
        conn.execute(
            "UPDATE feishu_sync_mapping SET machine_name=?, table_id=? WHERE machine_id=?",
            (machine_name, table_id, machine_id),
        )
    else:
        conn.execute(
            "INSERT INTO feishu_sync_mapping(machine_id, machine_name, app_token, table_id) "
            "VALUES (?,?,?,?)",
            (machine_id, machine_name, APP_TOKEN, table_id),
        )
    conn.commit()
    conn.close()


def on_machine_created(machine_id, machine_name):
    """新增机器时创建飞书表并记录映射。失败不抛异常。"""
    if not _is_sync_enabled():
        return
    try:
        from feishu.table_utils import _create_table
        table_id, err = _create_table(machine_name)
        if table_id:
            _upsert_mapping(int(machine_id), machine_name, table_id)
    except Exception:
        pass


def on_machine_renamed(machine_id, new_name):
    """机器改名时同步更新飞书表名和映射。失败不抛异常。"""
    if not _is_sync_enabled():
        return
    try:
        conn = get_db()
        mapping = conn.execute(
            "SELECT table_id FROM feishu_sync_mapping WHERE machine_id=?", (int(machine_id),)
        ).fetchone()
        conn.close()
        if mapping:
            _feishu_request(
                "PATCH",
                f"/apps/{APP_TOKEN}/tables/{mapping['table_id']}",
                {"name": new_name},
            )
            conn = get_db()
            conn.execute(
                "UPDATE feishu_sync_mapping SET machine_name=? WHERE machine_id=?",
                (new_name, int(machine_id)),
            )
            conn.commit()
            conn.close()
    except Exception:
        pass


def on_machine_deleted(machine_id):
    """删除机器时清理飞书表和映射。失败不抛异常。"""
    try:
        conn = get_db()
        mapping = conn.execute(
            "SELECT table_id FROM feishu_sync_mapping WHERE machine_id=?", (int(machine_id),)
        ).fetchone()
        conn.close()
        if mapping:
            _feishu_raw("DELETE", f"/apps/{APP_TOKEN}/tables/{mapping['table_id']}")
            conn = get_db()
            conn.execute("DELETE FROM feishu_sync_mapping WHERE machine_id=?", (int(machine_id),))
            conn.commit()
            conn.close()
    except Exception:
        pass
```

- [ ] **Step 2: 从 feishu_sync.py 删除对应代码**

删除：`on_machine_created`、`on_machine_renamed`、`on_machine_deleted`、`_upsert_mapping`

添加 import：
```python
from feishu.lifecycle import (
    on_machine_created, on_machine_renamed, on_machine_deleted, _upsert_mapping,
)
```

- [ ] **Step 3: Commit**

```bash
git add feishu/lifecycle.py feishu_sync.py && git commit -m "refactor: extract lifecycle.py from feishu_sync.py"
```

---

### Task 8: init_engine.py 模块

**Files:**
- Create: `feishu/init_engine.py`
- Modify: `feishu_sync.py` (删除 init 相关代码)

- [ ] **Step 1: 创建 init_engine.py**

```python
# -*- coding: utf-8 -*-
"""飞书同步初始化引擎"""
import datetime
import time
from db import get_db
from feishu.common import (
    _feishu_data, _feishu_raw, _feishu_request,
    APP_TOKEN, GROUPS_TABLE,
)
from feishu.table_utils import (
    _create_table, _fetch_all_tables_snapshot, ensure_table_fields,
)
from feishu.lifecycle import _upsert_mapping


def incremental_init(_init_lock, _init_cancel, _active_operation_ref, write_event_func):
    """增量初始化：只建缺失的表，不删已有的正常表。"""
    if not _init_lock.acquire(blocking=False):
        return {"error": "初始化正在进行中，请稍后再试"}

    try:
        conn = get_db()
        machines = conn.execute(
            "SELECT id, name FROM machines ORDER BY sort_order ASC"
        ).fetchall()
        conn.close()
        act = {"type": "init", "total": len(machines), "done": 0,
               "phase": 1, "phase_total": 2, "phase_label": "建表"}
        if _active_operation_ref is not None:
            _active_operation_ref[0] = act
        write_event_func("info", "", "开始初始化 {} 台机器".format(len(machines)))

        result = _incremental_init_impl(_init_cancel, _active_operation_ref, write_event_func)

        if _active_operation_ref is not None:
            _active_operation_ref[0] = None
        mapped = result.get("mapped_machines", 0)
        total = result.get("total_machines", 0)
        write_event_func("info", "", "初始化完成: {}/{} 台已映射".format(mapped, total))
        return result
    finally:
        _init_cancel.clear()
        if _active_operation_ref is not None:
            _active_operation_ref[0] = None
        _init_lock.release()


def _incremental_init_impl(_init_cancel, _active_operation_ref, write_event_func):
    from feishu.config_table import ensure_machine_config_table
    from feishu.groups import ensure_groups_table

    conn = get_db()
    machines = conn.execute(
        "SELECT id, name FROM machines ORDER BY sort_order ASC"
    ).fetchall()
    conn.close()

    result = {
        "total_machines": len(machines),
        "mapped_machines": 0,
        "new_tables_created": 0,
        "skipped_existing": 0,
        "conflicts_deleted": 0,
        "stale_mappings": 0,
        "records_pushed": 0,
    }

    # ==== 0. 确保白名单总表存在 ====
    ensure_machine_config_table()
    ensure_groups_table()
    if _init_cancel.is_set():
        result["cancelled"] = True
        return result

    # ==== 1. 获取线上现有表快照，只删冲突表 ====
    snapshot, conflicts = _fetch_all_tables_snapshot()
    for tname, tid in conflicts:
        if _init_cancel.is_set(): break
        _feishu_raw("DELETE", f"/apps/{APP_TOKEN}/tables/{tid}")
        result["conflicts_deleted"] += 1
        time.sleep(0.15)
    if _init_cancel.is_set():
        result["cancelled"] = True
        return result
    online_table_ids = {tid: tname for tname, tid in snapshot.items()}

    # ==== 2. 获取本地已有映射 ====
    conn2 = get_db()
    existing = {}
    rows = conn2.execute(
        "SELECT machine_id, machine_name, table_id FROM feishu_sync_mapping"
    ).fetchall()
    for r in rows:
        existing[r["machine_id"]] = {"name": r["machine_name"], "table_id": r["table_id"]}
    conn2.close()

    # ==== 3. 为每台机器检查是否需要建表 ====
    machine_ids = {mc["id"] for mc in machines}

    for mc in machines:
        mid = mc["id"]
        mname = mc["name"]
        existing_info = existing.get(mid)

        if existing_info and existing_info["table_id"] in online_table_ids:
            result["skipped_existing"] += 1
            result["mapped_machines"] += 1
            if _active_operation_ref is not None and _active_operation_ref[0]:
                _active_operation_ref[0]["done"] = _active_operation_ref[0]["done"] + 1
            write_event_func("info", mname, "已存在，跳过")
            continue

        if _init_cancel.is_set(): break
        table_id, err = _create_table(mname)
        if not table_id:
            if _active_operation_ref is not None and _active_operation_ref[0]:
                _active_operation_ref[0]["done"] = _active_operation_ref[0]["done"] + 1
            continue
        _upsert_mapping(mid, mname, table_id)
        result["new_tables_created"] += 1
        result["mapped_machines"] += 1
        if _active_operation_ref is not None and _active_operation_ref[0]:
            _active_operation_ref[0]["done"] = _active_operation_ref[0]["done"] + 1
        write_event_func("info", mname, "建表完成")
        time.sleep(0.5)
    if _init_cancel.is_set():
        result["cancelled"] = True
        return result

    # ==== 3.5 确保字段完整性 ====
    conn3a = get_db()
    all_mappings_check = conn3a.execute(
        "SELECT machine_id, machine_name, table_id FROM feishu_sync_mapping"
    ).fetchall()
    conn3a.close()
    for m in all_mappings_check:
        if _init_cancel.is_set(): break
        try:
            missing = ensure_table_fields(m["table_id"])
            if missing and not (len(missing) == 1 and "API error" in missing[0]):
                result.setdefault("fields_fixed", {})[m["machine_name"]] = missing
        except Exception:
            pass

    # ==== 4. 推数据到所有已映射机器 ====
    from feishu.schedule_sync import push_machine_schedules
    conn3 = get_db()
    all_mappings = conn3.execute(
        "SELECT machine_id, machine_name FROM feishu_sync_mapping"
    ).fetchall()
    conn3.close()
    if _active_operation_ref is not None and _active_operation_ref[0] and all_mappings:
        _active_operation_ref[0]["phase"] = 2
        _active_operation_ref[0]["phase_label"] = "推送"
        _active_operation_ref[0]["total"] = _active_operation_ref[0]["total"] + len(all_mappings)
    for m in all_mappings:
        if _init_cancel.is_set(): break
        try:
            push_result = push_machine_schedules(m["machine_id"])
            if not push_result.get("error") and not push_result.get("skipped"):
                result["records_pushed"] += (
                    push_result.get("created", 0) + push_result.get("updated", 0)
                )
            if _active_operation_ref is not None and _active_operation_ref[0]:
                _active_operation_ref[0]["done"] = _active_operation_ref[0]["done"] + 1
            write_event_func("info", m["machine_name"], "推送完成")
        except Exception:
            if _active_operation_ref is not None and _active_operation_ref[0]:
                _active_operation_ref[0]["done"] = _active_operation_ref[0]["done"] + 1
            pass
        time.sleep(0.3)

    # ==== 5. 推送机器配置表 ====
    from feishu.lifecycle import _is_sync_enabled
    if _is_sync_enabled():
        try:
            from feishu.config_table import push_machine_config
            push_machine_config()
        except Exception:
            pass

    # ==== 6. 推送分组表 ====
    if _is_sync_enabled():
        try:
            from feishu.groups import sync_groups
            sync_groups()
        except Exception:
            pass

    # ==== 7. 清理飞书端孤立表 + 废弃本地映射 ====
    conn4 = get_db()
    valid_mappings = conn4.execute(
        "SELECT machine_id, table_id FROM feishu_sync_mapping"
    ).fetchall()
    valid_table_ids = {m["table_id"] for m in valid_mappings}

    for tid, tname in online_table_ids.items():
        if tid not in valid_table_ids:
            _feishu_raw("DELETE", f"/apps/{APP_TOKEN}/tables/{tid}")
            result["stale_mappings"] += 1
            time.sleep(0.15)

    for s in valid_mappings:
        if s["machine_id"] not in machine_ids:
            _feishu_raw("DELETE", f"/apps/{APP_TOKEN}/tables/{s['table_id']}")
            conn4.execute(
                "DELETE FROM feishu_sync_mapping WHERE machine_id=?",
                (s["machine_id"],),
            )
            conn4.execute(
                "DELETE FROM feishu_record_mapping WHERE machine_id=?",
                (s["machine_id"],),
            )
            result["stale_mappings"] += 1
    conn4.commit()
    conn4.close()

    return result
```

- [ ] **Step 2: 从 feishu_sync.py 删除** `incremental_init`、`_incremental_init_impl`

添加 import：
```python
from feishu.init_engine import incremental_init
```

- [ ] **Step 3: Commit**

```bash
git add feishu/init_engine.py feishu_sync.py && git commit -m "refactor: extract init_engine.py from feishu_sync.py"
```

---

### Task 9: groups.py — 机器分组表（核心新功能）

**Files:**
- Create: `feishu/groups.py`

- [ ] **Step 1: 创建 groups.py**

```python
# -*- coding: utf-8 -*-
"""飞书机器分组表同步"""
import time
from db import get_db
from feishu.common import (
    _feishu_data, _feishu_raw, _feishu_request,
    _batch_create_records, _batch_delete_records,
    APP_TOKEN, GROUPS_TABLE,
)
from feishu.table_utils import _find_table_by_name

GROUPS_TABLE_FIELDS = [
    {"field_name": "分组名", "type": 1, "ui_type": "Text"},
    {"field_name": "白班负责人", "type": 11, "ui_type": "User"},
    {"field_name": "夜班负责人", "type": 11, "ui_type": "User"},
    {"field_name": "备注", "type": 1, "ui_type": "Text"},
]


def _ensure_groups_table_fields(table_id):
    """检查分组表字段完整性，缺字段则补加。"""
    data = _feishu_data("GET", f"/apps/{APP_TOKEN}/tables/{table_id}/fields")
    if not data:
        return ["API error: no data returned"]

    existing_names = {f["field_name"] for f in data.get("items", [])}
    expected_names = {f["field_name"] for f in GROUPS_TABLE_FIELDS}
    missing = [n for n in expected_names if n not in existing_names]

    if not missing:
        return []

    missing_defs = [dict(f) for f in GROUPS_TABLE_FIELDS if f["field_name"] in missing]
    for fdef in missing_defs:
        _feishu_request("POST", f"/apps/{APP_TOKEN}/tables/{table_id}/fields", {"field": fdef})
        time.sleep(0.2)

    return missing


def ensure_groups_table():
    """确保飞书机器分组表存在。返回 table_id 或 None。"""
    existing = _find_table_by_name(GROUPS_TABLE)
    if existing:
        _ensure_groups_table_fields(existing)
        return existing

    fields = [
        {"field_name": "分组名", "type": 1, "ui_type": "Text"},
        {"field_name": "白班负责人", "type": 11, "ui_type": "User"},
        {"field_name": "夜班负责人", "type": 11, "ui_type": "User"},
        {"field_name": "备注", "type": 1, "ui_type": "Text"},
    ]
    resp = _feishu_request("POST", f"/apps/{APP_TOKEN}/tables", {
        "table": {"name": GROUPS_TABLE, "default_view_name": "默认视图", "fields": fields},
    })
    if resp.get("code") == 0:
        return resp.get("data", {}).get("table_id")
    return None


def _parse_feishu_text(val):
    """解析飞书文本字段值"""
    if val is None:
        return None
    if isinstance(val, str):
        return val
    if isinstance(val, list) and len(val) > 0:
        return val[0].get("text", "")
    return None


def _parse_feishu_user(val):
    """解析飞书 User 字段，返回 open_id 字符串。格式: [{"id":"ou_xxx","name":"张三",...}]"""
    if val is None:
        return ""
    if isinstance(val, list) and len(val) > 0:
        return val[0].get("id", "")
    return ""


def _build_local_snapshot():
    """构建本地快照：{分组名: [机器名列表]} + 分组备注"""
    conn = get_db()
    groups_rows = conn.execute("SELECT name, remark FROM groups ORDER BY name").fetchall()
    group_names = [r["name"] for r in groups_rows]
    group_remarks = {r["name"]: r["remark"] for r in groups_rows}

    group_machines = {}
    for gname in group_names:
        machines = conn.execute(
            "SELECT name FROM machines WHERE group_name=? ORDER BY name",
            (gname,)
        ).fetchall()
        group_machines[gname] = [m["name"] for m in machines]
    conn.close()
    return group_names, group_machines, group_remarks


def _build_feishu_snapshot():
    """构建飞书快照：{分组名: {"record_id": ..., "day_leader": ..., "night_leader": ...}}"""
    table_id = _find_table_by_name(GROUPS_TABLE)
    if not table_id:
        return {}, None

    feishu_map = {}
    page_token = None
    while True:
        p = f"&page_token={page_token}" if page_token else ""
        data = _feishu_data(
            "GET", f"/apps/{APP_TOKEN}/tables/{table_id}/records?page_size=500&automatic_fields=true{p}"
        )
        if data:
            for item in data.get("items", []):
                fields = item.get("fields", {})
                gname = _parse_feishu_text(fields.get("分组名"))
                if gname:
                    feishu_map[gname] = {
                        "record_id": item["record_id"],
                        "day_leader": _parse_feishu_user(fields.get("白班负责人")),
                        "night_leader": _parse_feishu_user(fields.get("夜班负责人")),
                    }
        if not data or not data.get("has_more"):
            break
        page_token = data.get("page_token")

    return feishu_map, table_id


def _structure_changed(local_names, local_machines, feishu_map):
    """判断分组名列表或分组内机器列表是否与飞书不同"""
    feishu_names = sorted(feishu_map.keys())
    if local_names != feishu_names:
        return True

    # 分组名相同，检查每个分组下的机器列表
    # 飞书端没有直接存机器列表，这里只要分组名一致就认为结构未变
    # 机器列表的变化通过机器配置表的分组名字段提现
    # 实际判断：只要分组名列表一致，就是结构未变
    return False


def sync_groups():
    """同步机器分组表：结构变→清空重推；结构不变→只拉负责人。
    返回 dict: {"action": "pull_leaders"|"rebuild", ...}
    """
    from feishu.status import write_event

    # 1. 确保表存在
    table_id = ensure_groups_table()
    if not table_id:
        write_event("warn", "", "分组表不存在且创建失败")
        return {"error": "Groups table not found and could not be created"}

    _ensure_groups_table_fields(table_id)

    # 2. 构建双端快照
    local_names, local_machines, local_remarks = _build_local_snapshot()
    feishu_map, _ = _build_feishu_snapshot()

    feishu_names = sorted(feishu_map.keys())

    # 3. 判断结构是否变化
    if local_names != feishu_names:
        # === 分支 A：分组名列表不同 → 清空飞书表，全量重推 ===
        write_event("info", "", "分组结构变化，清空飞书分组表并重推")

        # 删除所有现有记录
        all_record_ids = [v["record_id"] for v in feishu_map.values()]
        if all_record_ids:
            _batch_delete_records(table_id, all_record_ids)
            time.sleep(0.3)

        # 全量推送本地分组
        to_create = []
        for gname in local_names:
            to_create.append({"fields": {
                "分组名": gname,
                "备注": local_remarks.get(gname, ""),
                # 负责人留空，等飞书端填写
            }})

        if to_create:
            created, _, errors = _batch_create_records(table_id, to_create)
            if errors:
                write_event("warn", "", "分组表重推错误: {}".format(str(errors)[:100]))

        write_event("info", "", "分组表重推完成: {} 个分组".format(len(local_names)))
        return {"action": "rebuild", "groups_pushed": len(local_names)}

    else:
        # === 分支 B：结构一致 → 只拉取负责人 ===
        updated = 0
        conn = get_db()
        for gname, feishu_info in feishu_map.items():
            day = feishu_info.get("day_leader", "")
            night = feishu_info.get("night_leader", "")

            existing = conn.execute(
                "SELECT day_leader, night_leader FROM groups WHERE name=?",
                (gname,)
            ).fetchone()

            if existing:
                if day != existing["day_leader"] or night != existing["night_leader"]:
                    conn.execute(
                        "UPDATE groups SET day_leader=?, night_leader=? WHERE name=?",
                        (day, night, gname),
                    )
                    updated += 1
            else:
                # 飞书有但本地没有的分组（不应该出现在这里，但防御性处理）
                pass
        conn.commit()
        conn.close()

        if updated > 0:
            write_event("info", "", "从飞书拉取负责人更新: {} 个分组".format(updated))

        return {"action": "pull_leaders", "leaders_updated": updated}
```

- [ ] **Step 2: 验证**

```bash
python -c "from feishu.groups import GROUPS_TABLE_FIELDS; print([f['field_name'] for f in GROUPS_TABLE_FIELDS])"
```

预期输出: `['分组名', '白班负责人', '夜班负责人', '备注']`

- [ ] **Step 3: Commit**

```bash
git add feishu/groups.py && git commit -m "feat: add feishu groups table sync module"
```

---

### Task 10: sync_loop.py 模块

**Files:**
- Create: `feishu/sync_loop.py`
- Modify: `feishu_sync.py` (删除后台循环相关代码)

- [ ] **Step 1: 创建 sync_loop.py**

```python
# -*- coding: utf-8 -*-
"""飞书后台同步循环 & 异步操作"""
import datetime
import time
import threading
import gc
from concurrent.futures import ThreadPoolExecutor, as_completed
from db import get_db
from feishu.status import write_event, _active_operation, _init_lock_ref

SYNC_INTERVAL_SEC = 30
_last_loop_at = None
_last_push_result = None
_consecutive_failures = 0
_thread_health = {"alive": True, "last_heartbeat": 0, "restart_count": 0}

_sync_thread = None
_sync_stop_event = threading.Event()
_init_lock = threading.Lock()
_init_cancel = threading.Event()

# 将 _init_lock 注入 status 模块
_init_lock_ref = _init_lock


def _is_sync_enabled():
    try:
        conn = get_db()
        row = conn.execute(
            "SELECT value FROM config WHERE category='feishu' AND key='sync_enabled'"
        ).fetchone()
        conn.close()
        return row and row["value"] == "1"
    except Exception:
        return False


def is_initializing():
    return _init_lock.locked()


def cancel_init():
    _init_cancel.set()
    for _ in range(50):
        if not _init_lock.locked():
            break
        time.sleep(0.1)


def start_pull_thread():
    global _sync_thread, _sync_stop_event, _last_loop_at
    if _sync_thread and _sync_thread.is_alive():
        return
    _sync_stop_event.clear()
    _last_loop_at = time.time()
    _sync_thread = threading.Thread(target=_sync_loop, daemon=True, name="feishu-sync")
    _sync_thread.start()


def stop_pull_thread():
    global _sync_thread, _sync_stop_event
    _sync_stop_event.set()
    if _sync_thread:
        _sync_thread.join(timeout=5)
    _sync_thread = None


def push_all_machines_parallel():
    global _last_push_result
    from feishu.schedule_sync import push_machine_schedules
    conn = get_db()
    mappings = conn.execute("SELECT machine_id FROM feishu_sync_mapping").fetchall()
    conn.close()
    if not mappings:
        _last_push_result = {"total": 0, "success": 0, "fail": 0}
        return
    success = 0
    fail = 0
    total = len(mappings)
    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(push_machine_schedules, m["machine_id"]): m["machine_id"] for m in mappings}
        for future in as_completed(futures):
            try:
                r = future.result()
                if r and "error" not in r:
                    success += 1
                else:
                    fail += 1
            except Exception:
                fail += 1
    _last_push_result = {"total": total, "success": success, "fail": fail}


def _get_degraded_level():
    if _consecutive_failures <= 2:
        return "normal"
    elif _consecutive_failures <= 5:
        return "reduced"
    elif _consecutive_failures <= 9:
        return "minimal"
    else:
        return "paused"


def _get_sync_interval():
    if _consecutive_failures <= 2:
        return SYNC_INTERVAL_SEC
    elif _consecutive_failures <= 5:
        return 120
    else:
        return 300


def _sync_loop():
    global _last_loop_at, _consecutive_failures, _thread_health
    from feishu.schedule_sync import pull_all_machines
    from feishu.config_table import push_machine_config
    from feishu.groups import sync_groups
    _consecutive_failures = 0
    _thread_health = {"alive": True, "last_heartbeat": time.time(), "restart_count": 0}
    _last_loop_at = time.time()

    while not _sync_stop_event.is_set():
        if not _is_sync_enabled():
            for _ in range(10):
                if _sync_stop_event.is_set():
                    return
                time.sleep(1)
            continue

        cycle_errors = 0
        degraded_level = _get_degraded_level()

        if degraded_level in ("normal", "reduced"):
            try:
                pull_all_machines()
            except Exception:
                cycle_errors += 1
                write_event("warn", "", "pull 拉取异常")

        if degraded_level in ("normal", "reduced"):
            try:
                push_all_machines_parallel()
            except Exception:
                cycle_errors += 1
                write_event("warn", "", "push 推送异常")

        if degraded_level in ("normal", "reduced", "minimal") and _is_sync_enabled():
            try:
                push_machine_config()
            except Exception:
                cycle_errors += 1
                write_event("warn", "", "push_config 配置推送异常")

        # 同步分组表（每轮都做）
        if degraded_level in ("normal", "reduced", "minimal") and _is_sync_enabled():
            try:
                sync_groups()
            except Exception:
                cycle_errors += 1
                write_event("warn", "", "sync_groups 分组同步异常")

        if cycle_errors > 0:
            _consecutive_failures += 1
            write_event("warn", "", "同步循环异常 (连续{}次)".format(_consecutive_failures))
        else:
            _consecutive_failures = 0

        _last_loop_at = time.time()
        _thread_health["last_heartbeat"] = _last_loop_at

        if _consecutive_failures >= 10:
            write_event("error", "", "同步连续失败10次，暂停5分钟后重试")
            for _ in range(300):
                if _sync_stop_event.is_set():
                    return
                time.sleep(1)
            _consecutive_failures = 0
            _thread_health["restart_count"] += 1
            write_event("info", "", "同步恢复，重置计数器")
            continue

        try:
            gc.collect()
        except Exception:
            pass

        interval = _get_sync_interval()
        for _ in range(interval):
            if _sync_stop_event.is_set():
                return
            time.sleep(1)


def _async_init():
    global _active_operation
    try:
        from feishu.init_engine import incremental_init
        incremental_init(_init_lock, _init_cancel, [_active_operation], write_event)
    except Exception as e:
        _active_operation = None
        write_event("error", "", "初始化失败: {}".format(str(e)[:80]))


def _async_push():
    global _active_operation, _last_push_result
    from feishu.schedule_sync import push_machine_schedules
    try:
        conn = get_db()
        mappings = conn.execute(
            "SELECT machine_id, machine_name FROM feishu_sync_mapping"
        ).fetchall()
        conn.close()
        if not mappings:
            write_event("info", "", "无已映射机器，跳过推送")
            return
        total = len(mappings)
        _active_operation = {"type": "push", "total": total, "done": 0,
                             "phase": 1, "phase_total": 1, "phase_label": "推送"}
        write_event("info", "", "开始推送 {} 台机器".format(total))

        success = 0
        fail = 0
        for i, m in enumerate(mappings):
            try:
                r = push_machine_schedules(m["machine_id"])
                if r and "error" not in r:
                    success += 1
                    write_event("info", m["machine_name"], "推送完成", percent=round((i+1)/total*100))
                else:
                    fail += 1
                    err_msg = r.get("error", "未知错误") if isinstance(r, dict) else str(r)[:60]
                    write_event("error", m["machine_name"], err_msg, percent=round((i+1)/total*100))
            except Exception as e:
                fail += 1
                write_event("error", m["machine_name"], str(e)[:60], percent=round((i+1)/total*100))
            _active_operation["done"] = i + 1

        _last_push_result = {"total": total, "success": success, "fail": fail}
        _active_operation = None
        write_event("info", "", "推送完成: {}/{} 成功".format(success, total))
    except Exception as e:
        _active_operation = None
        write_event("error", "", "推送失败: {}".format(str(e)[:80]))


def _async_pull():
    global _active_operation
    from feishu.schedule_sync import pull_all_machines
    try:
        conn = get_db()
        mappings = conn.execute(
            "SELECT machine_id, machine_name FROM feishu_sync_mapping"
        ).fetchall()
        conn.close()
        if not mappings:
            write_event("info", "", "无已映射机器，跳过拉取")
            return
        total = len(mappings)
        _active_operation = {"type": "pull", "total": total, "done": 0,
                             "phase": 1, "phase_total": 1, "phase_label": "拉取"}
        write_event("info", "", "开始拉取 {} 台机器".format(total))

        result = pull_all_machines()
        checked = result.get("machines_checked", 0)
        errors = result.get("errors", [])
        updated = result.get("records_updated", 0)
        _active_operation = None
        if errors:
            write_event("warn", "", "拉取完成: {} 台更新 {} 条, {} 个错误".format(checked, updated, len(errors)))
        else:
            write_event("info", "", "拉取完成: {} 台更新 {} 条".format(checked, updated))
    except Exception as e:
        _active_operation = None
        write_event("error", "", "拉取失败: {}".format(str(e)[:80]))


def _async_toggle_on(mode="local"):
    global _active_operation
    from feishu.init_engine import incremental_init
    from feishu.schedule_sync import pull_all_machines
    try:
        init_result = incremental_init(_init_lock, _init_cancel, [_active_operation], write_event)
        if mode == "cloud":
            _active_operation = {"type": "pull", "total": 1, "done": 0}
            write_event("info", "", "云端对齐：拉取飞书端改动...")
            try:
                pull_all_machines()
            except Exception:
                pass
            _active_operation = None
            write_event("info", "", "云端对齐完成")
        start_pull_thread()
        try:
            push_all_machines_parallel()
        except Exception:
            pass
    except Exception as e:
        _active_operation = None
        write_event("error", "", "初始化失败: {}".format(str(e)[:80]))
```

- [ ] **Step 2: 从 feishu_sync.py 清理剩余代码**

此时 `feishu_sync.py` 应该只剩下 import 语句（全部改成从 `feishu` 包导入）。

验证 feishu_sync.py 除了 import 没有其他代码：

```bash
python -c "import feishu_sync; print('feishu_sync OK')"
```

- [ ] **Step 3: Commit**

```bash
git add feishu/sync_loop.py feishu_sync.py && git commit -m "refactor: extract sync_loop.py, finalize feishu/ package"
```

---

### Task 11: __init__.py 统一出口 & routes 适配

**Files:**
- Modify: `feishu/__init__.py`
- Modify: `routes/feishu.py`
- Modify: `routes/machines.py`

- [ ] **Step 1: 更新 __init__.py**

```python
# -*- coding: utf-8 -*-
"""飞书同步包 — 统一出口"""

from feishu.common import APP_TOKEN

from feishu.table_utils import (
    TABLE_FIELDS, SYSTEM_FIELDS, USER_FIELDS, LOCAL_USER_FIELDS,
    _build_exception_options_property, _find_table_by_name,
    _fetch_all_tables_snapshot, _create_table, ensure_table_fields,
)

from feishu.schedule_sync import (
    push_machine_schedules, pull_all_machines, compute_task_statuses,
)

from feishu.config_table import (
    CONFIG_TABLE_FIELDS, ensure_machine_config_table, push_machine_config,
    MACHINE_CONFIG_TABLE,
)

from feishu.groups import (
    GROUPS_TABLE_FIELDS, ensure_groups_table, sync_groups,
    GROUPS_TABLE,
)

from feishu.init_engine import incremental_init

from feishu.status import (
    get_sync_status, write_event, _active_operation,
)

from feishu.lifecycle import (
    on_machine_created, on_machine_renamed, on_machine_deleted,
    _upsert_mapping,
)

from feishu.sync_loop import (
    start_pull_thread, stop_pull_thread, is_initializing, cancel_init,
    _async_init, _async_push, _async_pull, _async_toggle_on,
)
```

- [ ] **Step 2: 更新 routes/feishu.py import**

将 `routes/feishu.py` 头部的：
```python
from feishu_sync import (
    ...
)
```
改为：
```python
from feishu import (
    incremental_init, push_machine_schedules, pull_all_machines,
    push_all_machines_parallel,
    get_sync_status, _upsert_mapping, APP_TOKEN,
    start_pull_thread, stop_pull_thread,
    is_initializing, cancel_init,
    _async_init, _async_push, _async_pull,
    _async_toggle_on,
    _active_operation,
)
```

注意：`push_all_machines_parallel` 在 sync_loop 中未被导出到 `__init__.py`。需要补充：

在 `feishu/__init__.py` 末尾添加：
```python
from feishu.sync_loop import push_all_machines_parallel
```

- [ ] **Step 3: 更新 routes/machines.py**

找到 machines.py 中引用 `feishu_sync` 生命周期钩子的地方：

```python
# 旧
from feishu_sync import on_machine_created, on_machine_renamed, on_machine_deleted

# 新
from feishu import on_machine_created, on_machine_renamed, on_machine_deleted
```

- [ ] **Step 4: 删除旧 feishu_sync.py**（可选——保留作向后兼容的 re-export 文件）

为安全起见，保留 `feishu_sync.py` 作为一层薄兼容层，只做 re-export：

```python
# -*- coding: utf-8 -*-
"""向后兼容：所有符号从 feishu 包重新导出。新代码应直接 from feishu import xxx。"""
from feishu import *
```

- [ ] **Step 5: 验证所有 import 正常**

```bash
python -c "
from feishu import (
    incremental_init, push_machine_schedules, pull_all_machines,
    push_all_machines_parallel,
    get_sync_status, APP_TOKEN,
    start_pull_thread, stop_pull_thread,
    is_initializing, cancel_init,
    _async_init, _async_push, _async_pull, _async_toggle_on,
    _active_operation, on_machine_created, on_machine_renamed, on_machine_deleted,
    sync_groups, ensure_groups_table,
)
print('All imports OK')
"
```

- [ ] **Step 6: 验证 app 启动**

```bash
python -c "from app import app; print('App imports OK')"
```

- [ ] **Step 7: Commit**

```bash
git add feishu/__init__.py routes/feishu.py routes/machines.py feishu_sync.py && git commit -m "refactor: wire up feishu/ package, update all imports"
```

---

### Task 12: 端到端测试

**Files:** 无

- [ ] **Step 1: 数据库迁移测试**

```bash
python -c "
from db import init_db, get_db
init_db()
conn = get_db()
tables = conn.execute(\"SELECT name FROM sqlite_master WHERE type='table'\").fetchall()
print([t['name'] for t in tables])
conn.close()
"
```

预期：输出中包含 `groups`

- [ ] **Step 2: 种子数据测试**

```bash
python -c "
from db import init_db, get_db
init_db()
conn = get_db()
groups = conn.execute('SELECT * FROM groups').fetchall()
print('Groups:', [(g['name'], g['day_leader'], g['night_leader']) for g in groups])
conn.close()
"
```

预期：如果 machines 表有 group_name 数据，groups 表有对应初始记录（负责人为空）

- [ ] **Step 3: 飞书 API 连接测试（可选，需要网络）**

```bash
python -c "
from feishu.common import _feishu_data, APP_TOKEN
data = _feishu_data('GET', f'/apps/{APP_TOKEN}/tables')
print('Connected:', bool(data))
"
```

- [ ] **Step 4: 生成完整 pyc 验证无语法错误**

```bash
python -m compileall feishu/ -q
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "test: verify end-to-end after feishu/ refactor"
```

---

> **Note:** 前端影响（设置面板分组管理、机器编辑分组下拉）将在后续单独 plan 中处理。
