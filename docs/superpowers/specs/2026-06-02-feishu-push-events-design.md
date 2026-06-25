# 飞书定点推送事件 — 设计文档

**日期**: 2026-06-02
**状态**: 已确认

---

## 1. 概述

在现有飞书推送设置模块（chat_groups 配置 + 总开关 + 测试发送）基础上，新增**事件驱动推送**能力。在每次 push/pull 同步完成后扫描飞书排班表，检测变更事件，生成飞书卡片消息推送到指定群聊和小组长。

### 核心原则

- **飞书为主，本地补位** — 任务级事件（场景 1-9）看飞书表，系统级概念（任务包完成、班次报告）看本地 DB
- **去重防刷** — push_log 表记录每次发送，同一事件不重复推
- **同类合并** — 多个任务变动 / 多条公告合并为一张卡片

---

## 2. 架构

```
push_machine_schedules() → 写飞书表 → ┐
                                       ├→ detect_and_push_events()
pull_all_machines()     → 写本地库 → ┘       │
                                             ├── 阶段一：扫描飞书排班表（场景 1-9）
                                             │     ├── 逐条判断应触发的事件
                                             │     └── 收集事件
                                             ├── 阶段二：查询本地 DB（场景 10-11）
                                             │     ├── 任务包完成检查
                                             │     └── 班次报告检查
                                             ├── 合并同类事件
                                             ├── 对照 push_log 去重
                                             ├── 对照开关矩阵过滤
                                             ├── 生成飞书卡片 → send_im_message
                                             └── 写入 push_log
```

- Push/pull 代码本身不动，仅在调用方末尾各加一行 `detect_and_push_events()`
- `detect_and_push_events()` 是独立函数，放在 `feishu/` 目录下（新文件或 schedule_sync.py 末尾）

---

## 3. 数据模型

### 3.1 push_log 表

```sql
CREATE TABLE IF NOT EXISTS push_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dedup_key TEXT NOT NULL,
    event_type TEXT NOT NULL,
    target_type TEXT NOT NULL,       -- "leader" | "group"
    target_id TEXT NOT NULL,          -- open_id 或 chat_id
    notify_value TEXT,                -- 通知时的值快照(JSON)，用于检测"又变了"
    sent_at TEXT NOT NULL,
    success INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_push_log_dedup ON push_log(dedup_key, target_id);
```

### 3.2 事件开关矩阵

存储在现有 config 表，一条 JSON：

```json
// category='feishu_push', key='event_toggles'
{
  "task_impending_start":  {"leader": true,  "group": false},
  "task_start":            {"leader": true,  "group": false},
  "task_confirm_start":    {"leader": false, "group": true},
  "schedule_changes":      {"leader": false, "group": true},
  "exception_start":       {"leader": false, "group": true},
  "exception_end":         {"leader": false, "group": true},
  "task_impending_end":    {"leader": true,  "group": false},
  "task_end":              {"leader": true,  "group": false},
  "task_confirm_end":      {"leader": false, "group": true},
  "package_complete":      {"leader": false, "group": true},
  "shift_report":          {"leader": false, "group": true}
}
```

默认全部为 `true`（新系统首次安装时写入）。后续用户通过前端调整。

### 3.3 小组长数据来源

飞书"机器分组表"维护白班/夜班负责人，同步到本地 `groups` 表的 `day_leader` / `night_leader`，值为飞书 open_id。推送时：

- 白班事件 → 取 `day_leader` 发私信
- 夜班事件 → 取 `night_leader` 发私信
- 机器所属分组 → 从 `machines.group_name` 关联到 `groups.name`

---

## 4. 卡片模板（5 种）

### 4.1 任务提醒（蓝色）— 给小组长

覆盖场景：任务即将开始、任务开始、任务即将结束、任务结束

```
┌─────────────────────────────────┐
│  ⏰ 任务提醒              蓝色  │
│                                 │
│  机器：BR1-03                   │
│  任务：日常巡逻                  │
│  时间：14:00 - 16:00            │
│  状态：即将开始（提前15分钟）      │
│                                 │
│  分组：A组                      │
└─────────────────────────────────┘
```

- 单条发送，不合并
- 去重键：`remind_{schedule_id}_{impending_start|impending_end|start|end}`

### 4.2 任务公告（绿色）— 给群

覆盖场景：任务确定开始、任务确定结束、任务包全部完成

```
┌─────────────────────────────────┐
│  ✅ 任务动态              绿色  │
│                                 │
│  BR1-03  日常巡逻  已确定开始    │
│  BR2-01  设备检查  已确定完成    │
│  ─────────────────────          │
│  📦 数据采集包  全部任务已完成   │
└─────────────────────────────────┘
```

- 合并发送：同次检测中的多条公告合并为一张卡片
- 单卡片上限 10 条，超出显示"…等共 N 条"
- 去重键：`confirm_start_{schedule_id}` / `confirm_end_{schedule_id}` / `pkg_done_{package_id}`

### 4.3 变动汇总（橙色）— 给群

覆盖场景：排班时间延后、提前、自动分配

```
┌─────────────────────────────────┐
│  📋 排班变动汇总          橙色  │
│                                 │
│  ⏰ 延后（2项）                  │
│   BR1-03  日常巡逻              │
│   14:00→15:30  (+90分钟)        │
│   BR2-01  设备检查              │
│   14:00→14:45  (+45分钟)        │
│  ─────────────────────          │
│  ⏫ 提前（1项）                  │
│   Mini-05 数据回传  16:00→15:00 │
│  ─────────────────────          │
│  🤖 自动分配（3项）              │
│   接管-08 / 站桩-12 / 常规-03   │
│   → 分配到 BR1-02, Mini-05...   │
└─────────────────────────────────┘
```

- 按变动类型分组展示
- 去重键：`shift_changes_{date}_{白班|夜班}`
- notify_value：变动明细 JSON，用于检测是否有新变动

### 4.4 异常通知（红色）— 给群

覆盖场景：异常开始、异常结束

```
┌──────────────────────┐      ┌──────────────────────────┐
│  ⚠️ 异常开始   红色   │      │  ✅ 异常恢复        红色  │
│                      │      │                          │
│  机器：BR1-03        │      │  机器：BR1-03            │
│  原因：机器故障       │      │  原因：机器故障           │
│  开始：14:23         │      │  开始：14:23  结束：15:10 │
│                      │      │  持续：47 分钟            │
└──────────────────────┘      └──────────────────────────┘
```

- 单条发送，紧急事件不合并
- 去重键：`exc_{repair_log_id}_{start|end}`

### 4.5 班次报告（紫色）— 给群

覆盖场景：白班/夜班总结报告

```
┌─────────────────────────────────┐
│  📊 白班总结报告          紫色  │
│  2026-06-02  白班               │
│  ─────────────────────          │
│  ✅ 任务完成情况                 │
│  已完成普通任务    12 个         │
│  已完成任务包任务   3 个         │
│  任务完成率        78%           │
│  ─────────────────────          │
│  ⚠️ 预警情况                    │
│  未完成普通任务     4 个         │
│  未完成任务包任务   1 个         │
│  逾期任务           2 个         │
└─────────────────────────────────┘
```

- 去重键：`shift_report_{date}_{白班|夜班}`
- 每班次只发一次

---

## 5. 事件检测逻辑

### 5.1 双数据源

| 数据源 | 覆盖场景 | 原因 |
|--------|---------|------|
| **飞书排班表** | 场景 1-9（任务级事件） | 实际开始/结束、状态、异常标记、排班时间都在飞书表上 |
| **本地 SQLite** | 场景 10（任务包完成）、11（班次报告） | 任务包、班次是系统概念，飞书表上不完整 |

### 5.2 检测入口

```python
def detect_and_push_events():
    """在 push/pull 完成后调用。分两阶段检测。"""
    all_events = []

    # 阶段一：扫描飞书表，检测任务级事件（场景 1-9）
    conn = get_db()
    mappings = conn.execute("SELECT * FROM feishu_sync_mapping").fetchall()
    conn.close()
    for m in mappings:
        feishu_schedules = _fetch_feishu_schedules(m["table_id"])
        events = _detect_feishu_events(m, feishu_schedules)
        all_events.extend(events)

    # 阶段二：查本地 DB，检测系统级事件（场景 10-11）
    system_events = _detect_local_events()
    all_events.extend(system_events)

    # 合并同类事件，去重，过滤，发送
    _dispatch_events(all_events)
```

### 5.3 各事件检测条件

> **注意：** "提前 N 分钟"阈值第一版硬编码为 15 分钟，后续可做成可配置项。

#### 飞书数据源（场景 1-9）

| 事件 | 检测条件 | 去重键 | notify_value |
|------|---------|--------|:---:|
| 任务即将开始 | `排班开始` - now ≤ 15min，`状态`≠已完成 | `remind_{sid}_impending_start` | — |
| 任务开始 | `实际开始` 有值 且 其时间戳 < `排班开始`（提早填写）；如果该时间戳 ≤ now 则当场发送 | `task_start_{sid}` | ✅ `actual_start_ts` |
| 任务确定开始 | `实际开始` 有值（不管何时填的，结果即通知） | `confirm_start_{sid}` | ✅ `actual_start_ts` |
| 排班时间变动 | `排班开始`或`排班结束` vs push_log 中的值不同 | `time_change_{sid}` | ✅ `{start_ts, end_ts}` |
| 异常开始 | `异常标记`≠"正常" 且 push_log 无 `exc_{sid}_start` | `exc_{sid}_start` | — |
| 异常结束 | `异常标记`="正常" 且 push_log 有 `exc_{sid}_start` 无 `exc_{sid}_end` | `exc_{sid}_end` | — |
| 任务即将结束 | `排班结束` - now ≤ 15min，`状态`≠已完成 | `remind_{sid}_impending_end` | — |
| 任务结束 | `实际结束` 有值 且 其时间戳 < `排班结束`（提早填写）；如果该时间戳 ≤ now 则当场发送 | `task_end_{sid}` | ✅ `actual_end_ts` |
| 任务确定结束 | `实际结束` 有值（不管何时填的，结果即通知） | `confirm_end_{sid}` | ✅ `actual_end_ts` |

> **关于场景 2+3（以及 8+9）的同源触发：** `实际开始` 被填写这一件事，同时触发两条消息——给小组长的确认（场景 2/8，用 task_start/task_end）和给群的公告（场景 3/9，用 task_confirm_start/confirm_end）。检测到同一个飞书字段变化后，分别按各自的去重键和开关判断是否发送。

#### 本地数据源（场景 10-11）

| 事件 | 检测条件 | 去重键 | 数据来源 |
|------|---------|--------|---------|
| 任务包完成 | 本地 schedules 表中某任务包下所有排班 `status`="completed" | `pkg_done_{package_name}_{date}` | `schedules` + `task_packages` 表 |
| 班次报告 | 当前时间超出 shift_config 中白班/夜班结束时间 | `report_{date}_{白班\|夜班}` | `shift_config` + `schedules` 表 |

> **关于任务包去重键：** 飞书表上只有 `所属来源`（package_name 文本），没有 package_id。去重键改用 `package_name + date`。

> **关于班次报告：** 统计口径（完成数/未完成数/逾期数/完成率）由本地 schedules 表按日期和班次时间段计算。

### 5.4 异常持续时长

异常结束卡片需要展示"持续多久"。数据来源：

- **维修起止时间**：本地 `repair_log` 表的 `start_datetime` / `end_datetime`
- **维修重叠时长**：`_get_repair_for_schedule()` 已有现成逻辑，计算维修记录与排班窗口的重叠分钟数

### 5.5 去重逻辑

```python
def _should_send(dedup_key, target_id, current_value=None):
    row = db.execute(
        "SELECT notify_value FROM push_log WHERE dedup_key=? AND target_id=?",
        (dedup_key, target_id)
    ).fetchone()
    if row is None:
        return True  # 从未发过
    if current_value is not None:
        old_value = (row["notify_value"] or "").strip()
        if old_value != json.dumps(current_value, ensure_ascii=False):
            return True  # 值变了，需要重发
    return False  # 已发过且值未变
```

---

## 6. UI — 推送事件开关矩阵

### 6.1 位置

放在现有推送设置 box 内，chat_groups 配置区域之后、测试发送按钮之前。

### 6.2 布局

```
┌──────────────────────────────────────────┐
│  📨 推送事件设置                          │
│                                          │
│  场景                  │ 发给小组长 │ 发给群 │
│                        │ [全选]    │ [全选] │
│  ──────────────────────┼──────────┼───────│
│  任务即将开始           │    ✅    │  —    │
│  任务开始               │    ✅    │  —    │
│  任务确定开始           │    —    │  ✅    │
│  排班任务变动           │    —    │  ✅    │
│  异常情况开始           │    —    │  ✅    │
│  异常情况结束           │    —    │  ✅    │
│  任务即将结束           │    ✅    │  —    │
│  任务结束               │    ✅    │  —    │
│  任务确定结束           │    —    │  ✅    │
│  任务包全部完成         │    —    │  ✅    │
│  白班/夜班总结报告      │    —    │  ✅    │
└──────────────────────────────────────────┘
```

- 每列顶部有 `[全选]` 按钮，点击切换该列全部开关（全选 ↔ 全不选）
- 每个格子里是 iOS 风格的小 toggle
- 保存时整个矩阵提交

---

## 7. API 设计

### 7.1 GET /api/feishu/push-config（扩展）

在现有返回中增加 `event_toggles` 字段：

```json
{
  "enabled": true,
  "chat_groups": [{"name": "A组", "chat_id": "oc_xxx"}],
  "event_toggles": {
    "task_impending_start": {"leader": true, "group": false},
    ...
  }
}
```

### 7.2 POST /api/feishu/push-config/save（扩展）

请求体增加 `event_toggles` 字段，后端写入 config 表。

### 7.3 无需新增路由

现有路由扩展即可，无需新建。

---

## 8. 文件改动范围

| 文件 | 改动 |
|------|------|
| `feishu/schedule_sync.py` | 新增 `detect_and_push_events()` 及辅助函数；push/pull 末尾调用 |
| `feishu/common.py` | `send_im_message` 扩展支持飞书卡片消息（增加 `msg_type` 参数，`"text"` 或 `"interactive"`） |
| `routes/feishu.py` | push-config/save 扩展 `event_toggles` 读写 |
| `templates/panels/settings.html` | 推送设置 box 内新增事件开关矩阵 |
| `static/settings.js` | 加载/保存 event_toggles；全选按钮逻辑 |
| `db.py` | `init_db` 中新增 `push_log` 表；seed 默认 event_toggles |

---

## 9. 不在范围内的

- 飞书卡片高级布局（第一版用基础卡片元素：markdown 文本块 + 分割线 + 字段列表，不做复杂嵌套）
- 推送历史查看 UI
- 推送失败重试（send_im_message 已有 3 次重试，够用）
- 小组长之外的个人推送目标
