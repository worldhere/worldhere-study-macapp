# 采集员字段 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "采集员" (collector) User field to Feishu schedule tables, pull-only sync to `schedules.collector`, and six-branch routing in event dispatch.

**Architecture:** Feishu-first — the collector field is defined in the Feishu table schema, pulled into `schedules.collector`, never pushed from local. Events carry `collector` in `base_info`, and `_get_targets_for_event` uses it alongside group leaders for notification routing.

**Tech Stack:** Python Flask, SQLite, Feishu Open API

---

### Task 1: DB migration — add collector column to schedules

**Files:**
- Modify: `db.py` (append after `local_modified_at` ALTER TABLE block)

- [ ] **Step 1: Add ALTER TABLE migration**

In `db.py`, after the `local_modified_at` migration block (around line 670), add:

```python
    # 采集员字段：飞书拉取的排班级用户，逗号分隔 open_id
    try:
        cur.execute("ALTER TABLE schedules ADD COLUMN collector TEXT NOT NULL DEFAULT ''")
        conn.commit()
    except sqlite3.OperationalError:
        pass
```

- [ ] **Step 2: Verify migration runs**

Restart the server and confirm no errors:

Run: `python app.py` (briefly start and check it boots without DB errors)
Expected: Server starts normally, no migration errors

- [ ] **Step 3: Verify column exists**

Query the DB:

```bash
python3 -c "import sqlite3; conn = sqlite3.connect('golden.db'); print([c[1] for c in conn.execute('PRAGMA table_info(schedules)').fetchall() if c[1] == 'collector'])"
```

Expected: `['collector']`

- [ ] **Step 4: Commit**

```bash
git add db.py
git commit -m "feat: add collector column to schedules table"
```

---

### Task 2: Feishu table definition — add 采集员 field

**Files:**
- Modify: `feishu/table_utils.py:12-47` (TABLE_FIELDS)
- Modify: `feishu/table_utils.py:52` (USER_FIELDS)

- [ ] **Step 1: Add 采集员 to TABLE_FIELDS**

In `feishu/table_utils.py`, insert after "预估时长" (line 44) and before "修改与同步时间" (line 45):

```python
    {"field_name": "预估时长", "type": 1, "ui_type": "Text"},
    {"field_name": "采集员", "type": 11, "ui_type": "User",
     "property": {"multiple": True}},
    {"field_name": "修改与同步时间", "type": 5, "ui_type": "DateTime",
     "property": {"auto_fill": False, "date_formatter": "yyyy/MM/dd HH:mm"}},
```

- [ ] **Step 2: Add "采集员" to USER_FIELDS**

In `feishu/table_utils.py`, update line 52:

```python
USER_FIELDS = {"排班备注", "异常备注", "采集员"}
```

- [ ] **Step 3: Verify field creation on existing tables**

`ensure_table_fields()` at line 180 will auto-detect missing "采集员" and create it on all existing machine tables during the next sync cycle. Verify by checking one table's fields after restart:

```bash
# After server starts and has run one sync cycle:
python3 -c "
import requests
r = requests.get('http://localhost:5000/api/feishu/status')
print(r.json())
"
```

- [ ] **Step 4: Commit**

```bash
git add feishu/table_utils.py
git commit -m "feat: add 采集员 (collector) User field to Feishu table definition"
```

---

### Task 3: Pull sync — parse collector from Feishu to local

**Files:**
- Modify: `feishu/schedule_sync.py:557-745` (`_apply_pull_changes`)
- Reference: `feishu/groups.py:63-78` (`_parse_feishu_user`)

- [ ] **Step 1: Import _parse_feishu_user in schedule_sync.py**

At the top of `feishu/schedule_sync.py`, find the existing imports from `feishu.groups` (if any) or add:

```python
from feishu.groups import _parse_feishu_user
```

(If this creates a circular import, import inline at the point of use instead.)

- [ ] **Step 2: Add collector parsing and update in _apply_pull_changes**

After the exception_note block (around line 737, before line 739's `# 检测异常标记变化`), add:

```python
        # 采集员：飞书 User 字段，只拉不推
        collector_raw = fields.get("采集员")
        if collector_raw is not None:
            collector = _parse_feishu_user(collector_raw)
            if collector != (existing["collector"] or ""):
                conn.execute(
                    "UPDATE schedules SET collector=? WHERE id=?",
                    (collector, schedule_id),
                )
                detail.append({
                    "machine": machine_name, "schedule_id": schedule_id,
                    "field": "collector", "value": collector,
                })
                changed = True
```

- [ ] **Step 3: Verify pull by checking DB after manual Feishu edit**

1. In Feishu, manually set a collector on one schedule record in any machine table
2. Trigger a pull: `POST /api/feishu/pull`
3. Query the DB:

```bash
python3 -c "import sqlite3; conn = sqlite3.connect('golden.db'); rows = conn.execute('SELECT id, task_name, collector FROM schedules WHERE collector IS NOT NULL AND collector != \"\"').fetchall(); print(rows)"
```

Expected: The record with the Feishu collector shows up.

- [ ] **Step 4: Commit**

```bash
git add feishu/schedule_sync.py
git commit -m "feat: pull collector field from Feishu schedules"
```

---

### Task 4: Event sources — carry collector in base_info

**Files:**
- Modify: `feishu/events/feishu_source.py:60-66` (sch_rows JOIN) and `feishu/events/feishu_source.py:345-360` (base_info)
- Modify: `feishu/events/local_source.py:49-58` (sch_rows JOIN) and `feishu/events/local_source.py:73-88` (base_info)

- [ ] **Step 1: Add s.collector to feishu_source.py JOIN**

Update the `sch_rows` query (around line 61):

```python
        sch_rows = conn.execute(
            f"""SELECT s.*, m.group_name, m.type AS machine_type, t.package_id, t.priority,
                       pkg.name AS package_name
                FROM schedules s
                ...
```

Change to include `s.collector` (already included via `s.*` — no change needed for the SQL). Verify `s.*` already catches `collector`.

- [ ] **Step 2: Add collector to feishu_source.py base_info**

In `feishu/events/feishu_source.py`, after `"machine_type"` line, add:

```python
            "machine_type": sch["machine_type"] or "",
            "collector": sch.get("collector") or "",
        }
```

The `sch` dict from `s.*` already includes `collector` since we added the column. Use `.get()` with default for safety.

- [ ] **Step 3: Add s.collector to local_source.py JOIN**

The local_source query at line 50 uses `SELECT s.*, m.group_name, m.type AS machine_type, t.priority, pkg.name AS package_name` — `s.*` already covers `collector`. No change needed.

- [ ] **Step 4: Add collector to local_source.py base_info**

In `feishu/events/local_source.py`, after `"machine_type"` line, add:

```python
            "machine_type": sch["machine_type"] or "",
            "collector": sch.get("collector") or "",
        }
```

Also check if there are other `base_info` dictionaries in `local_source.py` (e.g., for `task_confirm` or `package_complete` events). Add `"collector": sch.get("collector") or ""` to each one.

- [ ] **Step 5: Check for other base_info dictionaries in local_source.py**

Search for all `base_info` dicts in `feishu/events/local_source.py` and ensure each includes `collector`.

- [ ] **Step 6: Commit**

```bash
git add feishu/events/feishu_source.py feishu/events/local_source.py
git commit -m "feat: carry collector field in event base_info"
```

---

### Task 5: Dispatch routing — six-branch logic

**Files:**
- Modify: `feishu/events/dispatch.py:75-169` (`_get_targets_for_event`)

- [ ] **Step 1: Rewrite _get_targets_for_event**

Replace the function from line 75 to line 169 with the six-branch logic:

```python
def _get_targets_for_event(event):
    """根据事件分组/采集员/机型，返回 [(target_type, target_id), ...] + leader_id"""
    conn = get_db()
    targets = []

    group_name = event.get("group_name", "")
    collector_str = event.get("collector", "")
    machine_name = event.get("machine_name", "")

    # ── 解析 shift 时间（提前，因为机型匹配也要用） ──
    shift_rows = conn.execute(
        "SELECT key, start FROM shift_config WHERE key IN ('day_shift', 'night_shift')"
    ).fetchall()

    now_min = datetime.datetime.now().hour * 60 + datetime.datetime.now().minute

    def _parse_shift_time(t):
        try:
            parts = t.split(":")
            return int(parts[0]) * 60 + int(parts[1])
        except Exception:
            return None

    day_start = None
    night_start = None
    for r in shift_rows:
        t = _parse_shift_time(r["start"])
        if r["key"] == "day_shift":
            day_start = t
        elif r["key"] == "night_shift":
            night_start = t

    def _current_shift():
        if day_start is not None and night_start is not None:
            return "day" if day_start <= now_min < night_start else "night"
        return "day"

    def _pick_leader(group_row):
        """从 group 行提取当前班次的 leader 集合"""
        if not group_row:
            return set()
        raw = group_row["day_leader"] if _current_shift() == "day" else group_row["night_leader"]
        if not raw:
            return set()
        return {lid.strip() for lid in raw.split(",") if lid.strip()}

    def _resolve_leader_set(leader_ids):
        """将逗号分隔的 leader 字符串转为 targets"""
        for lid in leader_ids:
            lid = lid.strip()
            if lid:
                targets.append(("leader", lid))

    # ── 本组的 leader ──
    group_row = None
    if group_name:
        group_row = conn.execute(
            "SELECT day_leader, night_leader FROM groups WHERE name=?",
            (group_name,)
        ).fetchone()

    group_leader_ids = _pick_leader(group_row) if group_row else set()

    # ── 采集员 set ──
    collector_ids = set()
    if collector_str:
        for cid in collector_str.split(","):
            cid = cid.strip()
            if cid:
                collector_ids.add(cid)

    # ── 机型匹配 leader ──
    type_match_ids = set()
    if not group_leader_ids and not collector_ids:
        # 任务已排到机器 → 用机器 type 找同机型分组的 leader
        machine_type = event.get("machine_type", "")
        if machine_type:
            type_rows = conn.execute(
                """SELECT DISTINCT g.day_leader, g.night_leader
                   FROM machines m
                   JOIN groups g ON m.group_name = g.name
                   WHERE m.type = ? AND m.group_name != ''
                     AND m.group_name != ?""",
                (machine_type, group_name or ""),
            ).fetchall()
            for r in type_rows:
                type_match_ids |= _pick_leader(r)

    # ── 路由决策 ──
    if group_leader_ids:
        # 有组 leader → 用它
        _resolve_leader_set(group_leader_ids)
    elif collector_ids:
        # 无组 leader 但有采集员 → 发给采集员
        _resolve_leader_set(collector_ids)
    elif type_match_ids:
        # 无组 leader 无采集员，有同机型匹配 → 发给匹配组 leader
        _resolve_leader_set(type_match_ids)
    else:
        # 最后回退：所有组的 leader
        all_rows = conn.execute(
            "SELECT day_leader, night_leader FROM groups"
        ).fetchall()
        all_ids = set()
        shift = _current_shift()
        for r in all_rows:
            raw = r["day_leader"] if shift == "day" else r["night_leader"]
            if raw:
                for lid in raw.split(","):
                    lid = lid.strip()
                    if lid:
                        all_ids.add(lid)
        _resolve_leader_set(all_ids)

    # ── 群聊目标 ──
    chat_row = conn.execute(
        "SELECT value FROM config WHERE category='feishu_push' AND key='chat_ids'"
    ).fetchone()
    chat_groups = []
    if chat_row:
        raw = (chat_row["value"] or "").strip()
        if raw.startswith("["):
            try:
                chat_groups = json.loads(raw)
            except json.JSONDecodeError:
                pass

    for cg in chat_groups:
        cid = cg.get("chat_id", "")
        if cid:
            targets.append(("group", cid))

    conn.close()
    return targets, ",".join(t["target_id"] for t in targets if t["target_type"] == "leader")
```

- [ ] **Step 2: Verify dispatch routing manual test**

After server restart, check that the function doesn't crash by triggering a sync or checking logs.

- [ ] **Step 3: Commit**

```bash
git add feishu/events/dispatch.py
git commit -m "feat: six-branch dispatch routing with collector and type-matching fallback"
```

---

### Task 6: Verify end-to-end

- [ ] **Step 1: Restart server and check sync loop**

Start server: `python app.py`
Wait for one sync cycle (~30 seconds). Check logs for any errors.

- [ ] **Step 2: Verify Feishu field exists**

Check a known machine table for the "采集员" field:

```bash
# Use MCP tool: bitable_v1_appTableField_list for one machine table
```

Expected: "采集员" field appears among the fields.

- [ ] **Step 3: Test routing logic path**

Create a test schedule with:
- `group_name = ""`
- `collector = "ou_test123"`

Verify `_get_targets_for_event` returns `[("leader", "ou_test123")]`.

- [ ] **Step 4: Commit any remaining changes**

```bash
git add -A
git commit -m "chore: final verification and cleanup"
```

---

### Summary of changed files

| File | Change |
|------|--------|
| `db.py` | ALTER TABLE schedules ADD COLUMN collector |
| `feishu/table_utils.py` | TABLE_FIELDS + 采集员, USER_FIELDS + 采集员 |
| `feishu/schedule_sync.py` | Parse collector in _apply_pull_changes |
| `feishu/events/feishu_source.py` | Add collector to base_info |
| `feishu/events/local_source.py` | Add collector to base_info (all occurrences) |
| `feishu/events/dispatch.py` | Rewrite _get_targets_for_event with six-branch routing |
