# 飞书多维表格双向同步 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将排班系统与飞书多维表格打通，一机器一表，双向近实时同步排班数据。

**Architecture:** 新增 `feishu_token.py`（Token 管理）、`feishu_sync.py`（核心同步逻辑）、`routes/feishu.py`（API 路由）、`static/feishu-sync.js`（前端防抖/轮询）。在现有排班变更点插入 `markDirty` 调用，设置页面增加同步开关。系统是唯一数据源，飞书是操作窗口。

**Tech Stack:** Python 3.14 / Flask / SQLite / requests / 原生 JavaScript

---

## File Structure

```
golden/
├── feishu_token.py          # NEW - Token 缓存与自动续期
├── feishu_sync.py           # NEW - 核心同步引擎（表管理、推送、拉取、校验）
├── routes/
│   └── feishu.py            # NEW - REST API 路由
├── static/
│   └── feishu-sync.js       # NEW - 前端同步管理器
├── app.py                   # MODIFY - 注册蓝图
├── db.py                    # MODIFY - 新增表结构迁移
├── routes/
│   ├── schedule_ops.py      # MODIFY - 插入 markDirty 调用
│   ├── machines.py          # MODIFY - 机器生命周期联动
│   └── schedule_cut.py      # MODIFY - 切割后 markDirty
├── templates/
│   └── panels/
│       └── settings.html    # MODIFY - 飞书同步开关 UI
└── static/
    └── settings.js          # MODIFY - 开关交互逻辑
```

---

### Task 1: 数据库迁移

**Files:**
- Modify: `db.py` - 在 `init_db()` 末尾添加迁移

- [ ] **Step 1: 添加 schedules 表新字段和 feishu_sync_mapping 表**

在 `db.py` 的 `init_db()` 函数末尾、`conn.close()` 之前添加：

```python
    # 飞书同步：schedules 新增实际时间字段
    try:
        cur.execute("ALTER TABLE schedules ADD COLUMN actual_start_min INTEGER")
        conn.commit()
    except sqlite3.OperationalError:
        pass
    try:
        cur.execute("ALTER TABLE schedules ADD COLUMN actual_end_min INTEGER")
        conn.commit()
    except sqlite3.OperationalError:
        pass

    # 飞书同步：映射表
    cur.execute("""
        CREATE TABLE IF NOT EXISTS feishu_sync_mapping (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            machine_id INTEGER NOT NULL UNIQUE,
            machine_name TEXT NOT NULL,
            app_token TEXT NOT NULL,
            table_id TEXT NOT NULL,
            last_pull_at TEXT,
            last_push_at TEXT
        )
    """)
    conn.commit()

    # 飞书同步：默认开关（关）
    cur.execute("SELECT COUNT(*) AS c FROM config WHERE category='feishu' AND key='sync_enabled'")
    if int(cur.fetchone()["c"]) == 0:
        cur.execute(
            "INSERT INTO config(category, key, value, sort_order) VALUES ('feishu', 'sync_enabled', '0', 0)"
        )
        conn.commit()

    # 飞书同步：默认异常标记选项
    cur.execute("SELECT COUNT(*) AS c FROM config WHERE category='feishu' AND key='exception_options'")
    if int(cur.fetchone()["c"]) == 0:
        cur.execute(
            "INSERT INTO config(category, key, value, sort_order) VALUES (?, ?, ?, 1)",
            ("feishu", "exception_options", '["正常", "机器故障", "缺少物料", "无法执行"]'),
        )
        conn.commit()
```

- [ ] **Step 2: 验证迁移**

重启应用，检查 SQLite 数据库中新字段和表是否存在。

---

### Task 2: Token 管理模块

**Files:**
- Create: `feishu_token.py`

- [ ] **Step 1: 创建 token 缓存模块**

```python
"""飞书 tenant_access_token 管理"""
import time
import requests

APP_ID = "YOUR_APP_ID"
APP_SECRET = "YOUR_APP_SECRET"
TOKEN_URL = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal"

_cache = {"token": None, "expires_at": 0}


def get_token() -> str:
    """获取有效 token，自动续期（提前 5 分钟刷新）"""
    now = time.time()
    if _cache["token"] and now < _cache["expires_at"] - 300:
        return _cache["token"]

    try:
        resp = requests.post(
            TOKEN_URL,
            json={"app_id": APP_ID, "app_secret": APP_SECRET},
            timeout=10,
        )
        data = resp.json()
        if data.get("code") == 0:
            _cache["token"] = data["tenant_access_token"]
            _cache["expires_at"] = now + data.get("expire", 7200)
            return _cache["token"]
    except Exception:
        pass

    return _cache["token"] if _cache["token"] else ""


def refresh_token() -> str:
    """强制刷新 token"""
    _cache["expires_at"] = 0
    return get_token()
```

---

### Task 3: 核心同步引擎

**Files:**
- Create: `feishu_sync.py`

- [ ] **Step 1: 创建模块骨架和常量**

```python
"""飞书多维表格同步引擎"""
import datetime
import json
import time
import requests
from db import get_db, get_config
from utils import format_elapsed

from feishu_token import get_token, refresh_token

BASE_URL = "https://open.feishu.cn/open-apis/bitable/v1"
APP_TOKEN = "I7IzbOlscajHJZscWOtcYcs6nLf"

# 14 字段定义（建表/校验用）
TABLE_FIELDS = [
    {"field_name": "任务名", "type": 1, "ui_type": "Text"},
    {"field_name": "任务类型", "type": 1, "ui_type": "Text"},
    {"field_name": "优先级", "type": 1, "ui_type": "Text"},
    {"field_name": "难度", "type": 1, "ui_type": "Text"},
    {"field_name": "预估开始", "type": 5, "ui_type": "DateTime",
     "property": {"auto_fill": False, "date_formatter": "yyyy/MM/dd HH:mm"}},
    {"field_name": "预估结束", "type": 5, "ui_type": "DateTime",
     "property": {"auto_fill": False, "date_formatter": "yyyy/MM/dd HH:mm"}},
    {"field_name": "预估时长", "type": 1, "ui_type": "Text"},
    {"field_name": "实际开始", "type": 5, "ui_type": "DateTime",
     "property": {"auto_fill": False, "date_formatter": "yyyy/MM/dd HH:mm"}},
    {"field_name": "实际结束", "type": 5, "ui_type": "DateTime",
     "property": {"auto_fill": False, "date_formatter": "yyyy/MM/dd HH:mm"}},
    {"field_name": "状态", "type": 3, "ui_type": "SingleSelect",
     "property": {"options": [{"name": "执行中", "color": 1}, {"name": "已完成", "color": 3}]}},
    {"field_name": "排班备注", "type": 1, "ui_type": "Text"},
    {"field_name": "异常标记", "type": 3, "ui_type": "SingleSelect",
     "property": {"options": [{"name": "正常", "color": 1}, {"name": "机器故障", "color": 2},
                              {"name": "缺少物料", "color": 3}, {"name": "无法执行", "color": 4}]}},
    {"field_name": "异常备注", "type": 1, "ui_type": "Text"},
    {"field_name": "_记录ID", "type": 1, "ui_type": "Text"},
]

SYSTEM_FIELDS = {"任务名", "任务类型", "优先级", "难度", "预估开始", "预估结束", "预估时长", "状态", "_记录ID"}
USER_FIELDS = {"实际开始", "实际结束", "异常标记", "异常备注"}
BIDI_FIELDS = {"排班备注"}
PULL_COMPARE_FIELDS = {"实际开始", "实际结束", "状态", "排班备注", "异常标记"}

# 推送日期窗口
PUSH_DAYS_BEFORE = 3
PUSH_DAYS_AFTER = 7
ROW_LIMIT = 200
```

- [ ] **Step 2: 飞书 API 请求封装**

```python
def _feishu_request(method, path, json_data=None, retry_count=3):
    """带 token 管理和重试的飞书 API 请求"""
    url = f"{BASE_URL}{path}"
    token = get_token()
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    for attempt in range(retry_count):
        try:
            if method == "GET":
                resp = requests.get(url, headers=headers, timeout=15)
            elif method == "POST":
                resp = requests.post(url, headers=headers, json=json_data, timeout=15)
            elif method == "DELETE":
                resp = requests.delete(url, headers=headers, timeout=15)
            elif method == "PATCH":
                resp = requests.patch(url, headers=headers, json=json_data, timeout=15)
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
```

- [ ] **Step 3: 表管理 — 创建表**

```python
def create_feishu_table(machine_name):
    """为一台机器创建飞书表，返回 (table_id, table_name) 或 (None, error_msg)"""
    payload = {
        "table": {
            "name": machine_name,
            "default_view_name": "默认视图",
            "fields": TABLE_FIELDS,
        }
    }
    resp = _feishu_request("POST", f"/apps/{APP_TOKEN}/tables", payload)

    if resp.get("code") != 0:
        return None, resp.get("msg", "Unknown error")

    return resp.get("table_id"), None


def _build_exception_options_property():
    """从 config 表读取异常标记选项，构造单选字段 property"""
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
```

- [ ] **Step 4: 表管理 — 校验/补字段**

```python
def ensure_table_fields(table_id):
    """检查飞书表字段完整性，缺字段则补加。返回缺失字段列表。"""
    resp = _feishu_request("GET", f"/apps/{APP_TOKEN}/tables/{table_id}/fields")
    if resp.get("code") != 0:
        return [f"API error: {resp.get('msg')}"]

    existing_names = {f["field_name"] for f in resp.get("items", [])}
    expected_names = {f["field_name"] for f in TABLE_FIELDS}
    missing = [n for n in expected_names if n not in existing_names]

    if not missing:
        return []

    missing_defs = [f for f in TABLE_FIELDS if f["field_name"] in missing]

    # 异常标记需要从系统配置读取动态选项
    for fdef in missing_defs:
        if fdef["field_name"] == "异常标记":
            fdef = dict(fdef)
            fdef["property"] = _build_exception_options_property()

    for fdef in missing_defs:
        payload = {"field": fdef}
        resp = _feishu_request("POST", f"/apps/{APP_TOKEN}/tables/{table_id}/fields", payload)
        time.sleep(0.2)  # 逐个加字段，避免频控

    return missing
```

- [ ] **Step 5: 增量初始化（全时段校验）**

```python
def incremental_init():
    """增量校验：对齐所有机器的飞书表。返回校验摘要 dict。"""
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
        "missing_tables": [],
        "missing_fields": {},
        "stale_mappings": 0,
        "new_tables_created": 0,
    }

    mapped_ids = set()

    for mc in machines:
        mid = mc["id"]
        mname = mc["name"]

        if mid in mappings:
            existing = mappings[mid]
            mapped_ids.add(mid)
            # 验证表是否存在
            resp = _feishu_request(
                "GET", f"/apps/{APP_TOKEN}/tables/{existing['table_id']}"
            )
            if resp.get("code") != 0:
                # 表已删除，重建
                result["missing_tables"].append(mname)
                table_id, err = create_feishu_table(mname)
                if table_id:
                    _upsert_mapping(mid, mname, table_id)
                    result["new_tables_created"] += 1
                    result["mapped_machines"] += 1
                continue

            # 检查字段完整性
            missing = ensure_table_fields(existing["table_id"])
            if missing:
                result["missing_fields"][mname] = missing
            result["mapped_machines"] += 1
        else:
            # 无映射，创建新表
            table_id, err = create_feishu_table(mname)
            if not table_id:
                continue
            _upsert_mapping(mid, mname, table_id)
            result["new_tables_created"] += 1
            result["mapped_machines"] += 1

    # 检查废弃映射
    for mid in mappings:
        if mid not in mapped_ids:
            result["stale_mappings"] += 1

    return result


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
            "INSERT INTO feishu_sync_mapping(machine_id, machine_name, app_token, table_id) VALUES (?,?,?,?)",
            (machine_id, machine_name, APP_TOKEN, table_id),
        )
    conn.commit()
    conn.close()
```

- [ ] **Step 6: 推送逻辑（系统 → 飞书）**

```python
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

    today = datetime.date.today()
    date_from = (today - datetime.timedelta(days=PUSH_DAYS_BEFORE)).isoformat()
    date_to = (today + datetime.timedelta(days=PUSH_DAYS_AFTER)).isoformat()

    # 查询该机器在日期窗口内的排班
    rows = conn.execute(
        """SELECT s.id, s.date, s.task_name, s.task_type, s.task_kind,
                  s.start_min, s.end_min, s.duration, s.status, s.remark,
                  s.actual_start_min, s.actual_end_min,
                  t.priority, t.difficulty
           FROM schedules s LEFT JOIN tasks t ON s.task_id = t.id
           WHERE s.machine_id=? AND s.date >= ? AND s.date <= ?
           ORDER BY s.date ASC, s.start_min ASC""",
        (machine_id, date_from, date_to),
    ).fetchall()
    conn.close()

    # 按优先级排序（今天 > ±1天 > 其余按日期距离）
    sorted_rows = _sort_by_priority(rows, today.isoformat())

    # 读取飞书端现有记录
    feishu_resp = _feishu_request(
        "GET", f"/apps/{APP_TOKEN}/tables/{table_id}/records?page_size=500"
    )
    feishu_map = {}
    if feishu_resp.get("code") == 0:
        for item in feishu_resp.get("items", []):
            fid = item.get("fields", {}).get("_记录ID", "")
            if isinstance(fid, list) and fid:
                fid = fid[0].get("text", "")
            if fid:
                feishu_map[fid] = item

    sys_ids = {f"schedule_{r['id']}" for r in sorted_rows}

    created = 0
    updated = 0
    deleted = 0

    for r in sorted_rows:
        if len(feishu_map) + created - deleted >= ROW_LIMIT:
            # 超出行上限，跳过最低优先级
            continue

        sid = f"schedule_{r['id']}"
        date_dt = datetime.date.fromisoformat(r["date"])
        est_start_ts = int(datetime.datetime.combine(
            date_dt, datetime.time.min
        ).timestamp() * 1000) + r["start_min"] * 60 * 1000
        est_end_ts = int(datetime.datetime.combine(
            date_dt, datetime.time.min
        ).timestamp() * 1000) + r["end_min"] * 60 * 1000

        sys_fields = {
            "任务名": r["task_name"],
            "任务类型": r["task_type"],
            "优先级": r["priority"] or "",
            "难度": r["difficulty"] or "",
            "预估开始": est_start_ts,
            "预估结束": est_end_ts,
            "预估时长": r["duration"] or "",
            "状态": "已完成" if r["status"] == "completed" else "执行中",
            "排班备注": r["remark"] or "",
            "_记录ID": sid,
        }

        if sid in feishu_map:
            existing = feishu_map[sid]
            ex_fields = existing.get("fields", {})
            # 保留用户侧字段
            for uf in USER_FIELDS:
                if uf in ex_fields and ex_fields[uf] is not None:
                    sys_fields[uf] = ex_fields[uf]
            # 保留双向字段如果用户有改动（飞书端值不等于系统端值才保留）
            record_id = existing["record_id"]
            # 只更新系统侧字段 + 双向字段
            update_payload = {"fields": sys_fields}
            resp = _feishu_request(
                "PATCH",
                f"/apps/{APP_TOKEN}/tables/{table_id}/records/{record_id}",
                update_payload,
            )
            if resp.get("code") == 0:
                updated += 1
        else:
            resp = _feishu_request(
                "POST",
                f"/apps/{APP_TOKEN}/tables/{table_id}/records",
                {"fields": sys_fields},
            )
            if resp.get("code") == 0:
                created += 1

    # 删除飞书有但系统没有的行
    for fid, item in feishu_map.items():
        if fid not in sys_ids:
            resp = _feishu_request(
                "DELETE",
                f"/apps/{APP_TOKEN}/tables/{table_id}/records/{item['record_id']}",
            )
            if resp.get("code") == 0:
                deleted += 1

    # 更新最后推送时间
    conn2 = get_db()
    conn2.execute(
        "UPDATE feishu_sync_mapping SET last_push_at=? WHERE machine_id=?",
        (datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"), machine_id),
    )
    conn2.commit()
    conn2.close()

    return {"created": created, "updated": updated, "deleted": deleted}


def _sort_by_priority(rows, today_str):
    """按时间优先级排序：今天 > ±1天 > 其余按日期距离"""
    today = datetime.date.fromisoformat(today_str)

    def priority(r):
        d = datetime.date.fromisoformat(r["date"])
        dist = abs((d - today).days)
        if dist == 0:
            return 0  # 今天
        if dist == 1:
            return 1  # ±1 天
        return dist  # 其余按距离

    return sorted(rows, key=priority)
```

- [ ] **Step 7: 拉取逻辑（飞书 → 系统）**

```python
def pull_all_machines():
    """从飞书拉取所有已映射机器的变更。返回变更摘要。"""
    conn = get_db()
    mappings = conn.execute("SELECT * FROM feishu_sync_mapping").fetchall()
    conn.close()

    result = {"machines_checked": 0, "records_updated": 0, "errors": [], "detail": []}

    for mapping in mappings:
        table_id = mapping["table_id"]
        machine_id = mapping["machine_id"]

        resp = _feishu_request(
            "GET", f"/apps/{APP_TOKEN}/tables/{table_id}/records?page_size=500"
        )
        if resp.get("code") != 0:
            result["errors"].append({
                "machine": mapping["machine_name"],
                "error": resp.get("msg", "API error"),
            })
            continue

        result["machines_checked"] += 1
        machine_changes = _apply_pull_changes(machine_id, mapping["machine_name"], resp.get("items", []))
        result["records_updated"] += machine_changes["records_updated"]
        if machine_changes.get("detail"):
            result["detail"].extend(machine_changes["detail"])

        if machine_changes.get("exception_events"):
            _handle_exception_events(machine_id, mapping["machine_name"], machine_changes["exception_events"])

    # 更新最后拉取时间
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    conn2 = get_db()
    for mapping in mappings:
        conn2.execute(
            "UPDATE feishu_sync_mapping SET last_pull_at=? WHERE machine_id=?",
            (now, mapping["machine_id"]),
        )
    conn2.commit()
    conn2.close()

    return result


def _apply_pull_changes(machine_id, machine_name, feishu_items):
    """将飞书记录变更应用到本地 schedules 表"""
    conn = get_db()
    updated = 0
    detail = []
    exception_events = []

    for item in feishu_items:
        fields = item.get("fields", {})
        record_id = fields.get("_记录ID", "")
        if isinstance(record_id, list) and record_id:
            record_id = record_id[0].get("text", "")
        if not record_id or not record_id.startswith("schedule_"):
            continue

        try:
            schedule_id = int(record_id.replace("schedule_", ""))
        except ValueError:
            continue

        existing = conn.execute(
            "SELECT * FROM schedules WHERE id=?", (schedule_id,)
        ).fetchone()
        if not existing:
            continue

        # 解析飞书字段
        actual_start = _parse_feishu_datetime(fields.get("实际开始"))
        actual_end = _parse_feishu_datetime(fields.get("实际结束"))
        status_raw = _parse_feishu_text(fields.get("状态"))
        remark = _parse_feishu_text(fields.get("排班备注"))
        exception = _parse_feishu_text(fields.get("异常标记"))

        # 校验：实际开始 > 实际结束
        validation_error = None
        if actual_start is not None and actual_end is not None:
            if actual_start > actual_end:
                validation_error = "实际开始晚于实际结束"

        # 更新排班备注（双向字段）
        if remark is not None and remark != (existing["remark"] or ""):
            conn.execute(
                "UPDATE schedules SET remark=? WHERE id=?",
                (remark, schedule_id),
            )

        # 更新实际开始
        if actual_start is not None and actual_start != existing["actual_start_min"]:
            if not validation_error:
                conn.execute(
                    "UPDATE schedules SET actual_start_min=? WHERE id=?",
                    (actual_start, schedule_id),
                )
                detail.append({
                    "machine": machine_name, "schedule_id": schedule_id,
                    "field": "actual_start_min", "value": actual_start,
                })

        # 更新实际结束 — 并触发状态联动
        if actual_end is not None and actual_end != existing["actual_end_min"]:
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

        # 状态联动：飞书填了实际结束 → 状态必须变为已完成
        if actual_end is not None and status_raw != "已完成":
            conn.execute(
                "UPDATE schedules SET status='completed', completed_at=? WHERE id=?",
                (datetime.datetime.now().isoformat(), schedule_id),
            )
            detail.append({
                "machine": machine_name, "schedule_id": schedule_id,
                "field": "status", "value": "completed",
            })

        # 更新状态（飞书侧手动改状态的情况）
        if status_raw == "已完成" and existing["status"] != "completed":
            conn.execute(
                "UPDATE schedules SET status='completed', completed_at=? WHERE id=?",
                (datetime.datetime.now().isoformat(), schedule_id),
            )
            detail.append({
                "machine": machine_name, "schedule_id": schedule_id,
                "field": "status", "value": "completed",
            })

        # 检测异常标记变化
        prev_exception = _get_prev_exception(schedule_id, conn)
        if exception and exception != prev_exception:
            exception_events.append({
                "machine_id": machine_id,
                "machine_name": machine_name,
                "schedule_id": schedule_id,
                "from": prev_exception,
                "to": exception,
            })

        updated += 1

    conn.commit()
    conn.close()

    return {
        "records_updated": updated,
        "detail": detail,
        "exception_events": exception_events,
    }


def _get_prev_exception(schedule_id, conn):
    """获取上一次同步时的异常标记状态（存储在 remark 或单独字段可扩展）"""
    # 简化：通过 schedules 表本身没有异常标记字段，异常信息在飞书端
    # 第一次检测到异常变化时，prev 为 None
    row = conn.execute(
        "SELECT id FROM schedules WHERE id=?", (schedule_id,)
    ).fetchone()
    return None  # 首次检测


def _parse_feishu_datetime(val):
    """将飞书 DateTime 值（毫秒时间戳）转为本地绝对分钟数"""
    if val is None:
        return None
    if isinstance(val, (int, float)):
        ts_s = val / 1000
        dt = datetime.datetime.fromtimestamp(ts_s)
        return dt.hour * 60 + dt.minute
    return None


def _parse_feishu_text(val):
    """解析飞书文本字段"""
    if val is None:
        return None
    if isinstance(val, str):
        return val
    if isinstance(val, list) and val:
        return val[0].get("text", "")
    return None
```

- [ ] **Step 8: 异常联动维修模块**

```python
def _handle_exception_events(machine_id, machine_name, events):
    """处理异常标记变更 → 触发维修模块"""
    from models import start_repair, end_repair  # noqa: F811

    for event in events:
        from_mark = event["from"]
        to_mark = event["to"]

        # 正常 → 异常（开始维修）
        if from_mark in (None, "正常") and to_mark in ("机器故障", "缺少物料"):
            category = "机器故障" if to_mark == "机器故障" else "缺少物料"
            start_repair(machine_id, category=category)

        # 异常 → 正常（结束维修）
        if from_mark in ("机器故障", "缺少物料") and to_mark == "正常":
            end_repair(machine_id)
```

- [ ] **Step 9: status 接口数据聚合**

```python
def get_sync_status():
    """聚合同步状态（含完整性检查）"""
    conn = get_db()
    enabled = conn.execute(
        "SELECT value FROM config WHERE category='feishu' AND key='sync_enabled'"
    ).fetchone()
    mappings = conn.execute("SELECT * FROM feishu_sync_mapping").fetchall()
    machines = conn.execute("SELECT id, name FROM machines ORDER BY sort_order ASC").fetchall()
    conn.close()

    enabled_val = enabled["value"] == "1" if enabled else False

    # 检测连接
    connected = False
    try:
        resp = _feishu_request("GET", f"/apps/{APP_TOKEN}/tables")
        connected = resp.get("code") == 0
    except Exception:
        pass

    # 完整性检查
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

    return {
        "enabled": enabled_val,
        "connected": connected,
        "initialized": len(mappings) > 0,
        "mapping_count": len(mappings),
        "last_pull_at": mappings[0]["last_pull_at"] if mappings else None,
        "last_push_at": mappings[0]["last_push_at"] if mappings else None,
        "base_info": APP_TOKEN,
        "integrity": {
            "total_machines": len(machines),
            "mapped_machines": len(mappings),
            "missing_tables": missing_tables,
            "missing_fields": {},
            "stale_mappings": stale_mappings,
            "validation_errors": [],
        },
    }
```

---

### Task 4: API 路由

**Files:**
- Create: `routes/feishu.py`

- [ ] **Step 1: 创建蓝图和所有路由**

```python
"""飞书同步 API 路由"""
from flask import Blueprint, request, jsonify

from db import get_db
from feishu_sync import (
    incremental_init, push_machine_schedules, pull_all_machines,
    get_sync_status, _upsert_mapping, APP_TOKEN,
)

bp = Blueprint('feishu', __name__)


@bp.route('/api/feishu/init', methods=['POST'])
def api_feishu_init():
    result = incremental_init()
    return jsonify(result)


@bp.route('/api/feishu/push', methods=['POST'])
def api_feishu_push():
    """推送 dirty 机器。body: {"machine_ids": [1, 2, 3]}"""
    d = request.get_json() or {}
    machine_ids = d.get("machine_ids", [])

    # 如果没有传 machine_ids，推送所有已映射机器
    if not machine_ids:
        conn = get_db()
        mappings = conn.execute("SELECT machine_id FROM feishu_sync_mapping").fetchall()
        conn.close()
        machine_ids = [m["machine_id"] for m in mappings]

    summary = {}
    for mid in machine_ids:
        r = push_machine_schedules(mid)
        summary[mid] = r

    return jsonify({"summary": summary})


@bp.route('/api/feishu/pull', methods=['POST'])
def api_feishu_pull():
    result = pull_all_machines()
    return jsonify(result)


@bp.route('/api/feishu/status', methods=['GET'])
def api_feishu_status():
    return jsonify(get_sync_status())


@bp.route('/api/feishu/toggle', methods=['POST'])
def api_feishu_toggle():
    d = request.get_json()
    enabled = bool(d.get("enabled"))
    conn = get_db()
    conn.execute(
        "UPDATE config SET value=? WHERE category='feishu' AND key='sync_enabled'",
        ("1" if enabled else "0",),
    )
    conn.commit()
    conn.close()

    # 开关打开时触发增量初始化
    init_result = None
    if enabled:
        init_result = incremental_init()

    return jsonify({"enabled": enabled, "init_result": init_result})


@bp.route('/api/feishu/exception-options', methods=['GET', 'POST'])
def api_feishu_exception_options():
    conn = get_db()
    if request.method == 'GET':
        row = conn.execute(
            "SELECT value FROM config WHERE category='feishu' AND key='exception_options'"
        ).fetchone()
        conn.close()
        import json
        options = json.loads(row["value"]) if row else ["正常", "机器故障", "缺少物料", "无法执行"]
        return jsonify({"options": options})

    # POST
    d = request.get_json()
    options = d.get("options", [])
    if not options or len(options) < 1:
        conn.close()
        return jsonify({"msg": "至少保留一个选项"}), 400

    import json
    conn.execute(
        "UPDATE config SET value=? WHERE category='feishu' AND key='exception_options'",
        (json.dumps(options, ensure_ascii=False),),
    )
    conn.commit()
    conn.close()

    return jsonify({"msg": "异常标记选项已更新"})
```

- [ ] **Step 2: 注册蓝图**

在 `app.py` 中添加：

```python
from routes.feishu import bp as feishu_bp
# ...
app.register_blueprint(feishu_bp)
```

---

### Task 5: 机器生命周期联动

**Files:**
- Modify: `routes/machines.py`

- [ ] **Step 1: 新增机器时创建飞书表**

在 `add_machine()` 返回值之前添加：

```python
    # 飞书联动：创建对应表格
    try:
        from feishu_sync import create_feishu_table, _upsert_mapping
        enabled = conn.execute(
            "SELECT value FROM config WHERE category='feishu' AND key='sync_enabled'"
        ).fetchone()
        if enabled and enabled["value"] == "1":
            table_id, err = create_feishu_table(name)
            if table_id:
                _upsert_mapping(int(new_id), name, table_id)
    except Exception:
        pass
```

- [ ] **Step 2: 重命名机器时更新飞书表名**

在 `update_machine()` 路由中添加（如果有重命名逻辑），或在 `update_machine` 的 POST 处理末尾：

```python
    # 飞书联动：更新表名
    if old_name != new_name:
        try:
            from feishu_sync import _feishu_request, APP_TOKEN
            mapping = conn.execute(
                "SELECT table_id FROM feishu_sync_mapping WHERE machine_id=?", (mid,)
            ).fetchone()
            if mapping:
                _feishu_request(
                    "PATCH",
                    f"/apps/{APP_TOKEN}/tables/{mapping['table_id']}",
                    {"name": new_name},
                )
                conn.execute(
                    "UPDATE feishu_sync_mapping SET machine_name=? WHERE machine_id=?",
                    (new_name, mid),
                )
        except Exception:
            pass
```

---

### Task 6: 排班变更点插入 markDirty

**Files:**
- Modify: `routes/schedule_ops.py` — 在每个会变更排班的路由末尾返回 dirty 标记
- Modify: `routes/schedule_cut.py` — 切割后标记

分析 `schedule_ops.py` 中所有变更排班的路由，为每个返回添加 `dirty_machine_ids` 字段。

- [ ] **Step 1: 识别所有排班变更路由及其涉及的 machine_id**

主要变更点：
| 路由 | 函数 | machine_id 来源 |
|---|---|---|
| `/assign_task` | `assign_task()` | `d.get("machine_id")` |
| `/move_task` | `move_task()` | 需要查 schedules 表 |
| `/complete_task/<int:sid>` | `complete_task()` | 需要查 schedules 表 |
| `/recycle_task/<int:sid>` | `recycle_task()` | 需要查 schedules 表 |
| `/edit_schedule/<int:sid>` | `edit_schedule()` | 需要查 schedules 表 |
| `/delete_schedule/<int:sid>` | `delete_schedule()` | 需要查 schedules 表 |

- [ ] **Step 2: 创建辅助函数获取 machine_id**

在 `routes/schedule_ops.py` 末尾添加：

```python
def _schedule_machine_ids(sid_list):
    """根据 schedule ID 列表返回涉及的 machine_id 集合"""
    if not sid_list:
        return set()
    conn = get_db()
    placeholders = ",".join("?" for _ in sid_list)
    rows = conn.execute(
        f"SELECT DISTINCT machine_id FROM schedules WHERE id IN ({placeholders})",
        sid_list,
    ).fetchall()
    conn.close()
    return {r["machine_id"] for r in rows}
```

- [ ] **Step 3: 修改每个变更路由的返回值**

以 `assign_task` 为例，在 `return jsonify(result)` 前添加 dirty 信息：

```python
    result["dirty_machine_ids"] = [mid]
```

以 `complete_task` 为例：

```python
    dirty = _schedule_machine_ids([sid])
    result["dirty_machine_ids"] = list(dirty)
```

在每个变更路由的返回中添加相同模式：`result["dirty_machine_ids"] = [...]`。

变更路由完整列表（来自 `schedule_ops.py` 和 `schedule_cut.py`）：
- `assign_task` — 已知 mid
- `complete_task` — 由 sid 查
- `uncomplete_task` — 由 sid 查
- `recycle_task` — 由 sid 查
- `move_task` — 已知 mid 或由 sid 查
- `edit_schedule` — 由 sid 查
- `delete_schedule` — 由 sid 查
- `cut_schedule` — 由 sid 查
- `uncut_schedule` — 由 sid 查
- `mass_delay` — 批量 delay 涉及多台机器

---

### Task 7: 前端同步管理器

**Files:**
- Create: `static/feishu-sync.js`

- [ ] **Step 1: 创建同步管理器**

```javascript
// 飞书同步管理器 — 防抖推送 + 定时轮询
var FeishuSync = {
    // 状态
    _enabled: false,
    _dirty: {},           // {machine_id: true}
    _debounceTimer: null,
    _maxTimer: null,
    _pullInterval: null,
    _firstDirtyTime: 0,

    // 防抖配置
    DEBOUNCE_MS: 10000,   // 10 秒
    MAX_WAIT_MS: 30000,   // 30 秒上限
    PULL_INTERVAL_MS: 30000, // 30 秒轮询

    init: function() {
        var self = this;
        // 读取开关状态
        fetch('/api/feishu/status')
            .then(function(r) { return r.json(); })
            .then(function(s) {
                self._enabled = s.enabled;
                if (self._enabled) {
                    self._startPull();
                }
                // 暴露给 settings 面板使用
                if (typeof updateFeishuStatusUI === 'function') {
                    updateFeishuStatusUI(s);
                }
            })
            .catch(function() {});
    },

    /** 标记一台机器为"脏"，需要推送 */
    markDirty: function(machineId) {
        if (!this._enabled) return;
        this._dirty[machineId] = true;

        if (!this._firstDirtyTime) {
            this._firstDirtyTime = Date.now();
        }

        // 刷新防抖定时器
        clearTimeout(this._debounceTimer);
        this._debounceTimer = setTimeout(function() {
            FeishuSync._doPush();
        }, this.DEBOUNCE_MS);

        // 上限定时器
        if (!this._maxTimer) {
            this._maxTimer = setTimeout(function() {
                FeishuSync._doPush();
            }, this.MAX_WAIT_MS);
        }
    },

    /** 执行推送 */
    _doPush: function() {
        var ids = Object.keys(this._dirty);
        if (ids.length === 0) return;

        clearTimeout(this._debounceTimer);
        clearTimeout(this._maxTimer);
        this._debounceTimer = null;
        this._maxTimer = null;
        this._firstDirtyTime = 0;

        var dirty = this._dirty;
        this._dirty = {};

        fetch('/api/feishu/push', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({machine_ids: ids.map(Number)}),
        }).then(function(r) { return r.json(); })
          .then(function(data) {
              console.log('[Feishu] Push done:', data);
          })
          .catch(function(err) {
              // 失败时合并回 dirty 队列
              for (var k in dirty) { FeishuSync._dirty[k] = true; }
              console.error('[Feishu] Push failed:', err);
          });
    },

    /** 执行拉取 */
    _doPull: function() {
        if (!this._enabled) return;
        fetch('/api/feishu/pull', {method: 'POST'})
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.records_updated > 0) {
                    console.log('[Feishu] Pull updated:', data.records_updated,
                                'records. Refreshing timeline.');
                    // 刷新时间线
                    _silentRefresh();
                }
            })
            .catch(function(err) {
                console.error('[Feishu] Pull failed:', err);
            });
    },

    /** 开始定时拉取 */
    _startPull: function() {
        var self = this;
        if (this._pullInterval) {
            clearInterval(this._pullInterval);
        }
        this._pullInterval = setInterval(function() {
            self._doPull();
        }, this.PULL_INTERVAL_MS);
    },

    /** 开关切换 */
    toggle: function(enabled) {
        var self = this;
        fetch('/api/feishu/toggle', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({enabled: enabled}),
        }).then(function(r) { return r.json(); })
          .then(function(data) {
              self._enabled = enabled;
              if (enabled) {
                  self._startPull();
              } else {
                  clearInterval(self._pullInterval);
                  self._pullInterval = null;
                  clearTimeout(self._debounceTimer);
                  clearTimeout(self._maxTimer);
                  self._dirty = {};
              }
              if (typeof updateFeishuStatusUI === 'function') {
                  updateFeishuStatusUI(data);
              }
          });
    },
};
```

- [ ] **Step 2: 初始化 FeishuSync**

在 `core.js` 末尾添加：

```javascript
// 页面加载后初始化飞书同步
document.addEventListener('DOMContentLoaded', function() {
    if (typeof FeishuSync !== 'undefined') {
        FeishuSync.init();
    }
});
```

- [ ] **Step 3: 在排班操作完成后调用 markDirty**

在 `static/timeline-ops.js` 和 `static/timeline-drag.js` 中，每个排班变更操作的 fetch 成功回调里添加：

```javascript
// 在每个排班变更成功回调末尾添加：
if (typeof FeishuSync !== 'undefined' && d.dirty_machine_ids) {
    d.dirty_machine_ids.forEach(function(mid) {
        FeishuSync.markDirty(mid);
    });
}
```

具体操作点：
- `completeTask()` — 完成后
- `recycleWithAnim()` — 回收后
- `deleteWithAnim()` — 删除后
- 拖拽分配/移动完成回调
- 切割完成回调
- 编辑排班弹窗保存回调

---

### Task 8: 设置页面 UI

**Files:**
- Modify: `templates/panels/settings.html` — 系统设置子页面
- Modify: `static/settings.js` — 交互逻辑

- [ ] **Step 1: 在系统设置子页面添加飞书同步区域**

在 `templates/panels/settings.html` 的 `<!-- ===== 子页面4：系统设置 ===== -->` 区域的 `<div class="box">` 旁边，添加一个新的 box：

```html
            <div class="box" id="feishu-sync-box">
                <h3>飞书数据同步</h3>
                <p class="settings-hint">开启后将排班数据同步到飞书多维表格。关闭不会丢失已同步的数据。</p>
                <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
                    <label class="toggle-switch">
                        <input type="checkbox" id="s-feishu-sync" onchange="toggleFeishuSync(this.checked)">
                        <span class="toggle-slider"></span>
                    </label>
                    <span>飞书数据同步</span>
                </div>
                <div id="feishu-status-area" style="display:none;font-size:13px;">
                    <div id="feishu-status-indicator"></div>
                    <div id="feishu-status-detail" style="margin-top:6px;color:var(--text-muted);"></div>
                    <button class="btn-sm" id="feishu-init-btn" style="margin-top:8px;display:none;" onclick="initFeishuSync()">初始化同步</button>
                    <button class="btn-sm" id="feishu-refresh-status-btn" style="margin-top:8px;" onclick="refreshFeishuStatus()">刷新状态</button>
                </div>
            </div>
            <div class="box" id="feishu-exception-box" style="display:none;">
                <h3>异常标记选项</h3>
                <p class="settings-hint">管理飞书表格中"异常标记"列的可选值。修改后下次同步自动生效。</p>
                <div class="settings-crud-bar">
                    <input id="s-fs-exc-opt" placeholder="新选项名称" style="width:160px">
                    <button class="btn" onclick="addExceptionOption()">添加</button>
                </div>
                <ul id="s-feishu-exception-options" class="sortable-list"></ul>
                <button class="btn" style="margin-top:10px;" onclick="saveExceptionOptions()">保存选项</button>
            </div>
```

- [ ] **Step 2: 在 settings.js 中添加交互函数**

```javascript
// ========== 飞书同步 UI 控制 ==========

function toggleFeishuSync(enabled) {
    if (typeof FeishuSync !== 'undefined') {
        FeishuSync.toggle(enabled);
    }
    // 显示状态区域
    var statusArea = document.getElementById('feishu-status-area');
    var excBox = document.getElementById('feishu-exception-box');
    if (statusArea) statusArea.style.display = enabled ? 'block' : 'none';
    if (excBox) excBox.style.display = enabled ? 'block' : 'none';
}

function updateFeishuStatusUI(status) {
    var indicator = document.getElementById('feishu-status-indicator');
    var detail = document.getElementById('feishu-status-detail');
    var initBtn = document.getElementById('feishu-init-btn');

    if (!indicator) return;

    if (status.connected) {
        indicator.innerHTML = '<span style="color:#22c55e;">● 已连接</span> (Base: ' + (status.base_info || '').substring(0,10) + '...)';
        if (initBtn) initBtn.style.display = 'none';
    } else if (!status.initialized) {
        indicator.innerHTML = '<span style="color:#f59e0b;">● 未初始化</span>';
        if (initBtn) initBtn.style.display = 'inline-block';
    } else {
        indicator.innerHTML = '<span style="color:#ef4444;">● 连接失败</span>';
        if (initBtn) initBtn.style.display = 'none';
    }

    if (detail) {
        var parts = [];
        if (status.mapping_count) parts.push(status.mapping_count + ' 台机器已映射');
        if (status.last_pull_at) parts.push('上次拉取: ' + status.last_pull_at);
        if (status.last_push_at) parts.push('上次推送: ' + status.last_push_at);
        detail.textContent = parts.join(' | ');
    }

    // 开关状态同步
    var toggle = document.getElementById('s-feishu-sync');
    if (toggle) toggle.checked = status.enabled;
    var statusArea = document.getElementById('feishu-status-area');
    var excBox = document.getElementById('feishu-exception-box');
    if (statusArea) statusArea.style.display = status.enabled ? 'block' : 'none';
    if (excBox) excBox.style.display = status.enabled ? 'block' : 'none';
}

function initFeishuSync() {
    var btn = document.getElementById('feishu-init-btn');
    if (btn) { btn.disabled = true; btn.textContent = '初始化中...'; }
    fetch('/api/feishu/init', {method: 'POST'})
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (btn) { btn.disabled = false; btn.textContent = '初始化同步'; }
            refreshFeishuStatus();
        })
        .catch(function() {
            if (btn) { btn.disabled = false; btn.textContent = '初始化同步'; }
        });
}

function refreshFeishuStatus() {
    fetch('/api/feishu/status')
        .then(function(r) { return r.json(); })
        .then(function(s) {
            if (typeof updateFeishuStatusUI === 'function') {
                updateFeishuStatusUI(s);
            }
        });
}

function addExceptionOption() {
    var input = document.getElementById('s-fs-exc-opt');
    var val = input.value.trim();
    if (!val) return;
    var list = document.getElementById('s-feishu-exception-options');
    if (!list) return;
    var li = document.createElement('li');
    li.textContent = val;
    li.style.cssText = 'padding:4px 8px;border:1px solid var(--border);margin:2px 0;border-radius:4px;cursor:grab;';
    list.appendChild(li);
    input.value = '';
}

function saveExceptionOptions() {
    var list = document.getElementById('s-feishu-exception-options');
    if (!list) return;
    var options = [];
    list.querySelectorAll('li').forEach(function(li) {
        var name = li.textContent.trim();
        if (name) options.push(name);
    });
    if (options.length === 0) return;

    fetch('/api/feishu/exception-options', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({options: options}),
    }).then(function(r) { return r.json(); })
      .then(function(d) {
          if (typeof showToast === 'function') showToast(d.msg);
      });
}

// 从服务端加载当前异常标记选项
function loadExceptionOptions() {
    fetch('/api/feishu/exception-options')
        .then(function(r) { return r.json(); })
        .then(function(d) {
            var list = document.getElementById('s-feishu-exception-options');
            if (!list) return;
            list.innerHTML = '';
            (d.options || []).forEach(function(opt) {
                var li = document.createElement('li');
                li.textContent = opt;
                li.style.cssText = 'padding:4px 8px;border:1px solid var(--border);margin:2px 0;border-radius:4px;cursor:grab;';
                list.appendChild(li);
            });
        });
}
```

---

### Task 9: 集成与验证

- [ ] **Step 1: 确保所有蓝图已注册**

`app.py` 完整注册列表应包含：

```python
from routes.feishu import bp as feishu_bp
app.register_blueprint(feishu_bp)
```

- [ ] **Step 2: 验证后端启动无报错**

```bash
python app.py
```

检查启动日志无异常。

- [ ] **Step 3: 验证数据迁移**

```sql
SELECT * FROM schedules LIMIT 1;
-- 应包含 actual_start_min, actual_end_min 列

SELECT * FROM feishu_sync_mapping;
-- 空表但结构正确

SELECT * FROM config WHERE category='feishu';
-- 应返回 sync_enabled='0' 和 exception_options
```

- [ ] **Step 4: 测试增量初始化**

```bash
# 先手动创建映射
curl -X POST http://localhost:5000/api/feishu/toggle -H "Content-Type: application/json" -d '{"enabled":true}'
# 应返回 init_result 包含 total_machines 和 new_tables_created
```

- [ ] **Step 5: 测试推送和拉取**

```bash
# 推送指定机器
curl -X POST http://localhost:5000/api/feishu/push -H "Content-Type: application/json" -d '{"machine_ids":[1]}'

# 拉取
curl -X POST http://localhost:5000/api/feishu/pull

# 状态
curl http://localhost:5000/api/feishu/status
```

- [ ] **Step 6: 前端 E2E 测试**

- 打开设置页面 → 开启飞书同步开关 → 检查指示灯变绿
- 做一次排班操作（分配任务）→ 等待 10 秒 → 检查飞书表是否有新增行
- 在飞书表填实际结束时间 → 等待 30 秒 → 检查系统排班面板是否更新
- 标记"无法执行" → 等待 30 秒 → 检查任务是否回收、飞书行是否消失
```

---

## 验证清单

完成所有任务后：

- [ ] 开关关闭时，排班操作不触发任何飞书调用
- [ ] 开关打开后，连接状态正确显示
- [ ] 10 秒防抖 + 30 秒上限推送正常
- [ ] 30 秒定时拉取正常
- [ ] 飞书填实际结束 → 系统自动完成
- [ ] 飞书填实际开始晚于结束 → 校验拦截
- [ ] 异常标记"无法执行" → 系统回收+压实+飞书行消失
- [ ] 异常标记"机器故障" → 维修模块启动
- [ ] 增量初始化补建缺失的表和字段
- [ ] 200 行上限裁剪按优先级执行
