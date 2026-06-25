# 飞书机器表任务字段重设计 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将飞书机器表 14 字段重构为 18 字段，拆分「排班/预估」概念，全量重建飞书表，_记录ID 改为本地映射。

**Architecture:** 核心改动集中在 `feishu_sync.py`（字段常量、push、pull、状态计算）和 `db.py`（migration）。models.py 的 `_get_repair_for_schedule` 复用于任务级暂停判断和异常耗时计算。迁移策略为全量删表重建 → 从本地 DB 恢复数据。

**Tech Stack:** Python 3, SQLite, 飞书 Bitable API v1

---

### Task 1: DB Migration

**Files:**
- Modify: `db.py:565-600`（在现有 migration 区域追加）

- [ ] **Step 1: 在 schedules 表加 estimated_window 字段**

在 `db.py` 的 `ensure_schema` 函数中，`exception_note` migration 之后追加：

```python
    # 飞书字段重设计：排班漂移前窗口
    try:
        cur.execute("ALTER TABLE schedules ADD COLUMN estimated_window TEXT")
        conn.commit()
    except sqlite3.OperationalError:
        pass
```

- [ ] **Step 2: 创建 feishu_record_mapping 表**

在 `feishu_sync_mapping` 建表之后追加：

```python
    # 飞书字段重设计：本地 schedule_id ↔ feishu_record_id 映射（替代飞书 _记录ID 字段）
    cur.execute("""
        CREATE TABLE IF NOT EXISTS feishu_record_mapping (
            schedule_id INTEGER PRIMARY KEY,
            machine_id INTEGER NOT NULL,
            feishu_record_id TEXT NOT NULL
        )
    """)
    conn.commit()
```

- [ ] **Step 3: 验证 migration**

```bash
python -c "from db import get_db; conn=get_db(); print(list(conn.execute('PRAGMA table_info(schedules)'))); print(list(conn.execute('PRAGMA table_info(feishu_record_mapping)'))); conn.close()"
```

Expected: `estimated_window` 出现在 schedules 列中，`feishu_record_mapping` 表存在。

- [ ] **Step 4: Commit**

```bash
git add db.py
git commit -m "feat: add estimated_window to schedules, feishu_record_mapping table"
```

---

### Task 2: 更新 TABLE_FIELDS 常量为 18 字段

**Files:**
- Modify: `feishu_sync.py:20-56`

- [ ] **Step 1: 替换 TABLE_FIELDS 常量**

将旧的 14 字段 TABLE_FIELDS 替换为：

```python
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
    {"field_name": "排班时长", "type": 20, "ui_type": "Formula",
     "property": {"formula_expression": "([排班结束]-[排班开始])/60000", "formatter": "0.0\" min\""}},
    {"field_name": "实际开始", "type": 5, "ui_type": "DateTime",
     "property": {"auto_fill": False, "date_formatter": "yyyy/MM/dd HH:mm"}},
    {"field_name": "实际结束", "type": 5, "ui_type": "DateTime",
     "property": {"auto_fill": False, "date_formatter": "yyyy/MM/dd HH:mm"}},
    {"field_name": "状态", "type": 3, "ui_type": "SingleSelect",
     "property": {"options": [
         {"name": "待开始", "color": 7},
         {"name": "待分配", "color": 1},
         {"name": "采集中", "color": 2},
         {"name": "采集即将完成", "color": 3},
         {"name": "暂停中", "color": 4},
         {"name": "暂停即将超时", "color": 5},
         {"name": "过时待确认", "color": 6}]}},
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
```

注意：排班时长公式表达式 `([排班结束]-[排班开始])/60000` 是试探性语法（飞书 DateTime 字段减法返回毫秒差，除以 60000 得分钟）。若建表时报错，则改为 Text 类型回退。

- [ ] **Step 2: 更新 SYSTEM_FIELDS / USER_FIELDS / LOCAL_USER_FIELDS**

```python
SYSTEM_FIELDS = {"任务名", "所属来源", "任务类型", "优先级", "难度",
                 "排班开始", "排班结束", "预估时长", "状态",
                 "异常耗时", "修改与同步时间"}
USER_FIELDS = {"实际开始", "实际结束", "排班备注"}
LOCAL_USER_FIELDS = {"异常标记": "exception_mark", "异常备注": "exception_note",
                     "预估时段": "estimated_window"}
```

- [ ] **Step 3: Commit**

```bash
git add feishu_sync.py
git commit -m "feat: update TABLE_FIELDS to 18-field schema"
```

---

### Task 3: 统一动态状态计算，放 feishu_sync.py

**Files:**
- Modify: `feishu_sync.py:683-710`（替换 buggy `_compute_dynamic_status` 为正确版本）
- Modify: `routes/views.py:88-123`（从 feishu_sync 引入）

- [ ] **Step 1: 替换 _compute_dynamic_status 为正确的 compute_task_statuses**

删除旧的 `_compute_dynamic_status` 和 `_get_pending_alert_minutes`，添加从 `views.py:current_status()` 移植的正确逻辑：

```python
def compute_task_statuses(conn, alert_minutes=15):
    """返回 {task_id: computed_status}。与前端 timeline 同逻辑。"""
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
```

- [ ] **Step 2: views.py 从 feishu_sync 引入**

```python
# current_status() 中的计算部分替换为:
from feishu_sync import compute_task_statuses

def current_status():
    now = datetime.datetime.now()
    conn = get_db()
    alert_row = conn.execute(
        "SELECT value FROM config WHERE category='schedule_settings' AND key='pending_alert_minutes'"
    ).fetchone()
    alert_minutes = int(alert_row["value"]) if alert_row else 15

    task_statuses = compute_task_statuses(conn, alert_minutes)
    conn.close()
    # ... rest unchanged
```

- [ ] **Step 3: push 中状态直推 + 动态状态补充**

在 push_machine_schedules 的 sys_fields 中：

```python
        tid = r.get("task_id")
        local_task_status = r.get("task_status") or ""  # t.status from LEFT JOIN
        if local_task_status == "已分配":
            feishu_status = "待开始"
        elif local_task_status == "已完成":
            feishu_status = "已完成"
        elif tid is not None and int(tid) in dynamic_statuses:
            feishu_status = dynamic_statuses[int(tid)]
        else:
            feishu_status = local_task_status  # 兜底
```

- [ ] **Step 4: SQL 查询加 t.status as task_status**

改 push 的 SQL（见 Task 4 Step 1）。

- [ ] **Step 5: Commit**

```bash
git add feishu_sync.py routes/views.py
git commit -m "feat: replace buggy _compute_dynamic_status with correct compute_task_statuses from views.py"
```

- [ ] **Step 2: Commit**

```bash
git add feishu_sync.py
git commit -m "feat: per-task pause detection + 待开始 status in _compute_dynamic_status"
```

---

### Task 4: 重写 push_machine_schedules（去掉 _记录ID，加全部新字段）

**Files:**
- Modify: `feishu_sync.py:531-668`

- [ ] **Step 1: 更新 SQL 查询，JOIN task_packages 获取所属来源**

替换 `push_machine_schedules` 中的 SQL 查询（`rows = conn.execute(...)` 部分）：

```python
    rows = conn.execute(
        """SELECT s.id, s.date, s.task_name, s.task_type, s.task_kind,
                  s.start_min, s.end_min, s.duration, s.status, s.remark,
                  s.actual_start_min, s.actual_end_min,
                  s.exception_mark, s.exception_note,
                  s.estimated_window, s.updated_at,
                  t.priority, t.difficulty, t.est_seconds,
                  pkg.name as package_name
           FROM schedules s
           LEFT JOIN tasks t ON s.task_id = t.id
           LEFT JOIN task_packages pkg ON t.package_id = pkg.id
           WHERE s.machine_id=? AND s.date >= ? AND s.date <= ?
           ORDER BY s.date ASC, s.start_min ASC""",
        (machine_id, date_from, date_to),
    ).fetchall()
```

- [ ] **Step 2: 替换 feishu_map 构建逻辑（从 _记录ID → record_mapping）**

替换读取飞书端现有记录的部分。旧逻辑用 `_记录ID` 建 `feishu_map`，新逻辑用本地 `feishu_record_mapping` 表：

```python
    # 读取本地 schedule_id → feishu_record_id 映射
    conn2 = get_db()
    record_mapping = {}
    for rm in conn2.execute(
        "SELECT schedule_id, feishu_record_id FROM feishu_record_mapping WHERE machine_id=?",
        (machine_id,)
    ).fetchall():
        record_mapping[rm["schedule_id"]] = rm["feishu_record_id"]
    conn2.close()

    # 读取飞书端现有记录（全量，用于 diff）
    feishu_record_map = {}  # record_id → item
    orphan_record_ids = []  # 无对应映射的记录
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
    feishu_map = {}  # schedule_id → feishu_item
    for sid, rid in record_mapping.items():
        if rid in feishu_record_map:
            feishu_map[sid] = feishu_record_map.pop(rid)

    # 剩余飞书记录 = 无本地映射的孤儿行
    orphan_record_ids = list(feishu_record_map.keys())

    total_feishu_before = len(feishu_map) + len(orphan_record_ids)
```

- [ ] **Step 3: 替换 sys_fields 构建逻辑**

替换循环内 `sys_fields` 部分：

```python
    for r in sorted_rows:
        sid = r["id"]
        est_start_ts, est_end_ts = _date_min_to_timestamps(r["date"], r["start_min"], r["end_min"])

        # 预估时长：格式化任务预估耗时
        from utils import format_elapsed
        est_duration_text = ""
        if r.get("est_seconds"):
            est_duration_text = format_elapsed(r["est_seconds"] // 60)

        # 异常耗时：查询维修记录重叠时长
        repair_duration_text = ""
        repairs = _get_repair_for_schedule(
            conn, int(machine_id), r["date"],
            int(r["start_min"]), int(r["end_min"])
        )
        total_repair_min = sum(p["duration_minutes"] for p in repairs)
        if total_repair_min > 0:
            repair_duration_text = format_elapsed(total_repair_min)

        # 同步时间：updated_at 毫秒时间戳转 DateTime
        sync_ts = None
        if r.get("updated_at"):
            sync_ts = int(r["updated_at"])

        sys_fields = {
            "任务名": r["task_name"],
            "所属来源": r.get("package_name") or "",
            "任务类型": r["task_type"],
            "优先级": r.get("priority") or "",
            "难度": r.get("difficulty") or "",
            "排班开始": est_start_ts,
            "排班结束": est_end_ts,
            # 排班时长是飞书公式字段，不推送
            "状态": _compute_dynamic_status(conn, r, machine_id),
            "排班备注": r.get("remark") or "",
            "异常标记": r.get("exception_mark") or "正常",
            "异常备注": r.get("exception_note") or "",
            "异常耗时": repair_duration_text,
            "预估时段": r.get("estimated_window") or "",
            "预估时长": est_duration_text,
            "修改与同步时间": sync_ts,
        }
```

- [ ] **Step 4: 替换匹配逻辑（从 _记录ID → record_mapping 查表）**

```python
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
            to_create.append({"fields": sys_fields})
```

这里逻辑不变——`feishu_map` 现在是 `schedule_id → feishu_item`，匹配方式一样。

- [ ] **Step 5: 创建/更新后写回 record_mapping**

在批量操作完成后，写回映射：

```python
    # 写回 schedule_id ↔ feishu_record_id 映射
    try:
        conn3 = get_db()
        # 从 batch_create 响应中提取新 record_id（需要改造 _batch_create_records 返回 record_ids）
        # 这里简化处理：下一轮 pull 或 push 时自动通过 full diff 重建
        # 实际：create 时飞书返回的 record_id 需要写入 mapping
        conn3.close()
    except Exception:
        pass
```

注意：`_batch_create_records` 目前只返回 count，不返回 record_ids。需要改造它返回飞书返回的 record IDs 以便写入映射。如果改造量大，可另开一个 Task 或在创建逻辑中逐条处理。

实际上 push 后更新的 `updated_at` 逻辑也需要保留但简化（不再批量清 timestamp，只保留 last_push_at 更新）：

```python
    # 更新最后推送时间
    now_ms = int(time.time() * 1000)
    try:
        conn4 = get_db()
        conn4.execute(
            "UPDATE feishu_sync_mapping SET last_push_at=? WHERE machine_id=?",
            (datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"), machine_id),
        )
        # 将推送窗口内所有记录标记为已同步时间戳
        conn4.execute(
            "UPDATE schedules SET updated_at=? WHERE machine_id=? AND date >= ? AND date <= ?",
            (now_ms, machine_id, date_from, date_to),
        )
        conn4.commit()
        conn4.close()
    except Exception:
        pass
```

- [ ] **Step 6: 改造 _batch_create_records 返回 record_ids**

将 `_batch_create_records` 的返回值从 `(count, errors)` 改为 `(count, record_ids, errors)`：

```python
def _batch_create_records(table_id, records):
    """批量创建记录，返回 (success_count, record_ids, errors)"""
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
```

- [ ] **Step 7: 在 push 中创建后写入 feishu_record_mapping**

在 `push_machine_schedules` 的批量创建之后，将新 record_id 写入映射表：

```python
    created, created_record_ids, create_errors = _batch_create_records(table_id, to_create)
    errors.extend(create_errors)

    # 写入新创建的 schedule_id ↔ feishu_record_id 映射
    if created > 0 and created_record_ids:
        try:
            conn3 = get_db()
            for i, fields_dict in enumerate(to_create):
                if i < len(created_record_ids):
                    # 从 sorted_rows 中反查 schedule_id（to_create 顺序与 sorted_rows 一致）
                    pass  # 需要保留 sorted_rows 中对应 create 项的索引
            conn3.commit()
            conn3.close()
        except Exception:
            pass
```

由于 to_create 和 sorted_rows 不是一一对应（只有未命中的才进 to_create），需要保留索引。更简洁的方案：在 `to_create` 中附带 `schedule_id`：

修改构建逻辑：

```python
        if sid in feishu_map:
            ...
        else:
            to_create.append({"fields": sys_fields, "_schedule_id": sid})
```

然后在写入映射时：

```python
    if created > 0 and created_record_ids:
        try:
            conn3 = get_db()
            for item, rid in zip(to_create, created_record_ids):
                sid = item["_schedule_id"]
                conn3.execute(
                    "INSERT OR REPLACE INTO feishu_record_mapping (schedule_id, machine_id, feishu_record_id) VALUES (?, ?, ?)",
                    (int(sid), machine_id, rid),
                )
            conn3.commit()
            conn3.close()
        except Exception:
            pass
```

- [ ] **Step 8: 更新所有调用 _batch_create_records 的地方**

`push_machine_config` 中也有 `_batch_create_records` 调用，需要适配新的返回值（取 `total, _, errs`）：

```python
    created, _, ce = _batch_create_records(table_id, to_create)
```

- [ ] **Step 9: 确认 _compute_dynamic_status 调用处无需改动**

签名保持 `(r, machine_status)` 不变，push 中已有 `machine_status` 变量，调用不变。

- [ ] **Step 10: Commit**

```bash
git add feishu_sync.py
git commit -m "feat: rewrite push_machine_schedules for 18-field schema + record_mapping"
```

---

### Task 5: 更新 pull 逻辑（_apply_pull_changes）

**Files:**
- Modify: `feishu_sync.py:813-968`

- [ ] **Step 1: 替换 _记录ID 匹配为 record_mapping 匹配**

```python
def _apply_pull_changes(machine_id, machine_name, feishu_items):
    """将飞书记录变更应用到本地 schedules 表。返回变更详情和异常事件。"""
    conn = get_db()
    updated = 0
    detail = []
    exception_events = []

    # 读取本地 record_id → schedule_id 映射
    record_to_schedule = {}
    for rm in conn.execute(
        "SELECT schedule_id, feishu_record_id FROM feishu_record_mapping WHERE machine_id=?",
        (machine_id,)
    ).fetchall():
        record_to_schedule[rm["feishu_record_id"]] = rm["schedule_id"]

    for item in feishu_items:
        fields = item.get("fields", {})
        record_id = item.get("record_id")

        # 通过映射表查找 schedule_id
        schedule_id = record_to_schedule.get(record_id)
        if not schedule_id:
            continue

        existing = conn.execute(
            "SELECT * FROM schedules WHERE id=?", (schedule_id,)
        ).fetchone()
        if not existing:
            continue

        # 时间戳仲裁：飞书记录没变动（<= 本地已确认时间戳）则跳过整条
        feishu_ms = item.get("last_modified_time", 0) or 0
        local_updated = existing["updated_at"] or 0
        if feishu_ms <= local_updated:
            continue

        # 解析飞书字段（字段名已改为排班开始/结束）
        actual_start = _parse_feishu_datetime_for_pull(fields.get("实际开始"), existing["date"])
        actual_end = _parse_feishu_datetime_for_pull(fields.get("实际结束"), existing["date"])
        remark = _parse_feishu_text(fields.get("排班备注"))
        exception = _parse_feishu_text(fields.get("异常标记"))
```

- [ ] **Step 2: 更新预估时间双向同步（字段名适配）**

```python
        # 预估时间双向同步：飞书改排班时间 → 更新排班 + 压实
        sched_start = _parse_feishu_datetime_for_pull(fields.get("排班开始"), existing["date"])
        sched_end = _parse_feishu_datetime_for_pull(fields.get("排班结束"), existing["date"])
        if sched_start is not None and sched_end is not None:
            if sched_start != (existing["start_min"] or 0) or sched_end != (existing["end_min"] or 0):
                # 检测漂移：记录变动前的排班窗口到 estimated_window
                old_start = existing["start_min"]
                old_end = existing["end_min"]
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
```

- [ ] **Step 3: 新增 _format_drift_window 辅助函数**

在 `feishu_sync.py` 中添加：

```python
def _format_drift_window(date_str, start_min, end_min):
    """将 date + 绝对分钟 格式化为人类可读的漂移窗口字符串。
    格式: "MM/dd HH:MM~HH:MM"，跨天则 "MM/dd HH:MM~MM/dd HH:MM"
    """
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
```

- [ ] **Step 4: Commit**

```bash
git add feishu_sync.py
git commit -m "feat: update pull logic for 18-field schema + drift window detection"
```

---

### Task 6: 更新 incremental_init 为全量重建

**Files:**
- Modify: `feishu_sync.py:322-431`

- [ ] **Step 1: 将 incremental_init 改为全量删表重建**

所有已映射的机器表全部删除重建，确保新字段生效：

```python
def incremental_init():
    """全量重建初始化：删除所有旧表 → 用新字段建表 → 推送数据"""
    conn = get_db()
    machines = conn.execute(
        "SELECT id, name FROM machines ORDER BY sort_order ASC"
    ).fetchall()
    conn.close()

    result = {
        "total_machines": len(machines),
        "mapped_machines": 0,
        "new_tables_created": 0,
        "conflicts_deleted": [],
        "orphan_tables": {},
        "records_pushed": 0,
    }

    # ==== 0. 确保机器配置表存在 ====
    ensure_machine_config_table()

    # ==== 1. 清场：删除所有旧表（含残留表和配置表以外的全部表）====
    snapshot, conflicts = _fetch_all_tables_snapshot()
    all_tables_to_delete = list(snapshot.items()) + conflicts
    for tname, tid in all_tables_to_delete:
        _feishu_raw("DELETE", f"/apps/{APP_TOKEN}/tables/{tid}")
        if "_conflict" in tname:
            result["conflicts_deleted"].append(tname)
        time.sleep(0.15)

    # ==== 2. 清理旧的 record_mapping（表已删除，映射作废）====
    try:
        conn2 = get_db()
        conn2.execute("DELETE FROM feishu_record_mapping")
        conn2.commit()
        conn2.close()
    except Exception:
        pass

    # ==== 3. 为每台机器新建表 ====
    for mc in machines:
        mid = mc["id"]
        mname = mc["name"]
        table_id, err = _create_table(mname)
        if not table_id:
            continue
        _upsert_mapping(mid, mname, table_id)
        result["new_tables_created"] += 1
        result["mapped_machines"] += 1
        time.sleep(0.5)

    # ==== 4. 推数据 ====
    for mc in machines:
        try:
            push_result = push_machine_schedules(mc["id"])
            if not push_result.get("error") and not push_result.get("skipped"):
                result["records_pushed"] += (
                    push_result.get("created", 0) + push_result.get("updated", 0)
                )
        except Exception:
            pass
        time.sleep(0.3)

    # ==== 5. 推送机器配置表 ====
    if _is_sync_enabled():
        try:
            push_machine_config()
        except Exception:
            pass

    # ==== 6. 清理废弃映射（机器已删的） ====
    machine_ids = {mc["id"] for mc in machines}
    conn3 = get_db()
    stale = conn3.execute(
        "SELECT machine_id, table_id FROM feishu_sync_mapping"
    ).fetchall()
    for s in stale:
        if s["machine_id"] not in machine_ids:
            _feishu_raw("DELETE", f"/apps/{APP_TOKEN}/tables/{s['table_id']}")
            conn3.execute(
                "DELETE FROM feishu_sync_mapping WHERE machine_id=?",
                (s["machine_id"],),
            )
            result["stale_mappings"] += 1
    conn3.commit()
    conn3.close()

    return result
```

注意：删除了旧的"对齐"逻辑（快照匹配 → 复用），改为全删全建。`affected_machines` 概念不再需要。

- [ ] **Step 2: Commit**

```bash
git add feishu_sync.py
git commit -m "feat: full rebuild init for 18-field migration"
```

---

### Task 7: 清理残留引用 + 边界处理

**Files:**
- Modify: `feishu_sync.py`（多处）

- [ ] **Step 1: 移除 _cleanup_orphan_conflict_tables 调用**

`_sync_loop` 中 `_cleanup_orphan_conflict_tables()` 已不存在（函数未定义），删除该调用：

```python
def _sync_loop():
    """统一后台循环：pull → push，再等 30 秒"""
    global _last_loop_at
    while not _sync_stop_event.is_set():
        if _is_sync_enabled():
            try:
                pull_all_machines()
            except Exception:
                pass

            try:
                push_all_machines_parallel()
            except Exception:
                pass

            try:
                push_machine_config()
            except Exception:
                pass

            _last_loop_at = time.time()

        for _ in range(SYNC_INTERVAL_SEC):
            if _sync_stop_event.is_set():
                return
            time.sleep(1)
```

- [ ] **Step 2: 确保 _batch_create_records 旧调用处适配**

`push_machine_config` 中（约 1164 行）：

```python
    created, _, ce = _batch_create_records(table_id, to_create)
```

- [ ] **Step 3: Commit**

```bash
git add feishu_sync.py
git commit -m "chore: remove stale _cleanup_orphan_conflict_tables, adapt batch_create callers"
```

---

### Task 8: 处理排班时长公式字段（容错回退）

**Files:**
- Modify: `feishu_sync.py:_create_table`

- [ ] **Step 1: 建表时若公式字段失败，回退为 Text 推送**

在 `_create_table` 中，建表成功后检查字段是否创建完整。若公式字段报错，将 `排班时长` 改为 Text 类型单独补加，并在 push 时由系统计算推送：

在 `TABLE_FIELDS` 中先尝试公式类型。若飞书 API 报错（通常 code 1260003 等），则在 `ensure_table_fields` 或建表后的校验中自动将排班时长作为 Text 补加。

为简单，直接在 `push_machine_schedules` 的 `sys_fields` 中同时计算排班时长（不管飞书是公式还是文本，都推送一份备用值）：

```python
        # 排班时长：备选值（飞书公式失败时用）
        sched_duration = format_elapsed(r["end_min"] - r["start_min"]) if r.get("end_min") and r.get("start_min") else ""
```

在 sys_fields 中加上 `"排班时长": sched_duration` 作为备选推送值。如果是飞书公式字段，飞书侧会忽略这个值；如果是文本字段，则正常显示。

- [ ] **Step 2: Commit**

```bash
git add feishu_sync.py
git commit -m "feat: fallback push for 排班时长 if formula unsupported"
```

---

### 影响文件汇总

| 文件 | 变动 |
|------|------|
| `db.py` | schedules 加 estimated_window、新增 feishu_record_mapping 表 |
| `feishu_sync.py` | TABLE_FIELDS、SYSTEM/USER_FIELDS、_compute_dynamic_status、push_machine_schedules、_apply_pull_changes、_batch_create_records、incremental_init、_sync_loop、新辅助函数 |

models.py 无需改动（`_get_repair_for_schedule` 已存在）。routes 无需改动。

### 不变项

- v2 统一后台线程 30s 全量同步架构
- Base/App Token
- 设置页面
- feishu_sync_mapping 表结构
- 异常标记联动维修模块逻辑
