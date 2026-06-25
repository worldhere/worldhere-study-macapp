# push_events.py 架构优化

## 背景

`feishu/push_events.py` 已增长到 1499 行，包含四类职责混杂在一起：
- 事件检测（飞书表扫描 + 本地 DB 扫描，11 种场景）
- 卡片构建（6 种模板）
- 派发引擎（开关过滤 + 去重 + 合并 + 发送）
- 共享工具函数

每个新场景都要钻回大函数里插入判断链，认知负载饱和。未来的功能扩展（飞书设置增多、事件源增多）需要一个可插拔的检测器架构。

## 目标

不改变任何现有功能，将 `push_events.py` 拆分为 6 个模块，每个模块有单一明确的职责。加新场景只需写一个新检测函数并注入列表，不动已有代码。

## 架构

### 文件结构

```
feishu/push_events.py (1499行) → 删除
feishu/events/                 → 新建目录
├── __init__.py              # 公开接口 + 向后兼容 re-export
├── shared.py                # 工具函数 + 常量 + DetectContext
├── feishu_source.py         # 场景 1-9 检测器（飞书表扫描）
├── local_source.py          # 场景 10-11 检测器 + 本地补发（本地 DB 扫描）
├── cards.py                 # 卡片构建（6 种模板 + 合并逻辑）
└── dispatch.py              # 派发引擎（开关 + 去重 + 合并 + 发送）
```

### 调用关系

```
sync_loop.py / routes/feishu.py
    ↓ from feishu.events import detect_and_push_events
__init__.py
    ├─→ feishu_source.detect_from_feishu(machine_id, name, items, snapshot)
    │     └─ 遍历 7 个 DETECTOR 函数 → 收集 Event dicts
    ├─→ local_source.detect_from_local()
    │     └─ 场景 10/11 + 补发 → 收集 Event dicts
    ├─→ dispatch.dispatch_events(all_events)
    │     ├─ 事件分组 → 开关过滤 → 去重
    │     ├─ 调用 cards.py 构建卡片
    │     └─ 调用 common.py 发送消息
    └─ shared.py ← 所有模块的共享依赖
```

### 原则

1. 每个模块只暴露一个入口函数，内部实现细节不泄露
2. 调用方只改 import 路径，调用方式不变
3. 所有函数逻辑原样迁移，不修改功能
4. 现有 `feishu/` 扁平结构不变，`events/` 作为唯一的子包

---

## 各模块详细设计

### 1. `shared.py` — 共享层（~120 行）

**职责：** 存放所有检测器和卡片构建器共用的工具函数和常量。

从 `push_events.py` 移入，逻辑不变：

| 原函数/变量 | 新名称 | 说明 |
|---|---|---|
| `IMPENDING_MINUTES = 15` | 同 | 即将开始/结束提前量 |
| `MIN_DETECT_INTERVAL_SEC = 60` | 同 | 两次检测最小间隔 |
| `_last_detect_at = 0` | 同 | 上次检测时间戳 |
| `CARD_COLORS = {...}` | 同 | 卡片颜色映射 |
| `_parse_minutes(t_str)` | 同 | `'HH:MM'` → 绝对分钟数 |
| `_parse_overtime_latest_end(overtime_str)` | 同 | 解析加班最晚结束时间 |
| `_get_shift_context(conn)` | 同 | 读取班次配置，返回班次上下文 |
| `_schedule_in_current_shift(...)` | 同 | 判断排班是否属于当前班次 |
| `_ts_to_minutes(ts_val, date_str)` | 同 | 飞书毫秒时间戳 → 相对日期的绝对分钟 |
| `_minutes_to_readable(date_str, abs_min)` | 同 | 绝对分钟 → `'HH:MM'` |
| `_format_duration(minutes)` | 同 | 分钟数 → `'1h10m'` |
| `_get_machine_type_color(machine_id, conn)` | 同 | 根据机器类型查配色 |

**DetectContext：**

```python
class DetectContext:
    """飞书检测器的只读上下文，避免每个检测器传 8 个参数"""
    conn: any
    now: datetime.datetime
    now_min: int
    today_str: str
    current_shift: str | None
    day_oe: int
    night_oe: int
    day_start: int | None
    night_start: int | None
    record_to_sid: dict   # record_id → schedule_id
    sch_map: dict         # schedule_id → schedule row dict
    snapshot: dict        # {record_id: last_modified_time}
```

所有飞书检测器函数签名为：
```python
def _detect_X(item: dict, ctx: DetectContext, base_info: dict) -> list[dict]
```

---

### 2. `feishu_source.py` — 飞书事件源（~280 行）

**入口函数：** `detect_from_feishu(machine_id, machine_name, feishu_items, snapshot) -> list[dict]`

**内部结构：** 7 个检测器函数，通过 DETECTORS 列表串联：

```python
DETECTORS = [
    _detect_impending_start,     # 场景 1: 任务即将开始
    _detect_actual_start,        # 场景 2+3: 实际开始被填（同源双发）
    _detect_time_change,         # 场景 4: 排班时间变动
    _detect_exception_start,     # 场景 5+5b: 异常开始 + 异常备注补充
    _detect_exception_end,       # 场景 6: 异常恢复
    _detect_impending_end,       # 场景 7: 任务即将结束
    _detect_actual_end,          # 场景 8+9: 实际结束被填（同源双发）
]
```

**编排器逻辑：**

```python
def detect_from_feishu(machine_id, machine_name, feishu_items, snapshot):
    conn = get_db()
    ctx = _build_context(conn, machine_id, machine_name, snapshot)
    
    events = []
    for item in feishu_items:
        # 过滤：无 record_id / 无对应 schedule / 未来日期 / 非当前班次
        if not _should_process(item, ctx):
            continue
        base_info = _build_base_info(item, ctx)
        # 快照短路：数据没变则只走时间类场景
        data_changed = _check_data_changed(item, ctx)
        
        for detector in DETECTORS:
            try:
                result = detector(item, ctx, base_info)
                if result:
                    events.extend(result)
            except Exception:
                pass  # 单个检测器失败不阻塞其他
    conn.close()
    return events
```

**每个场景函数示例（场景 1）：**

```python
def _detect_impending_start(item, ctx, base_info):
    """场景 1: 任务即将开始。跳过已有人开始操作的排班。"""
    start_min = base_info["start_min"]
    if start_min is None:
        return []
    status_text = _parse_feishu_text(item.get("fields", {}).get("状态"))
    if status_text == "已完成" or base_info["actual_start_min"] is not None:
        return []
    minutes_until_start = start_min - ctx.now_min
    if 0 <= minutes_until_start <= IMPENDING_MINUTES:
        return [{**base_info, "event_type": "task_impending_start",
                 "minutes_remaining": minutes_until_start}]
    return []
```

**`_fetch_feishu_schedules` 保留在此模块中**（它是飞书表扫描的前置步骤）。

---

### 3. `local_source.py` — 本地事件源（~200 行）

**入口函数：** `detect_from_local() -> list[dict]`

**内部拆分为多个 `_detect_local_*` 函数：**

| 内部函数 | 覆盖原逻辑 |
|---|---|
| `_detect_local_exception_backfill(conn, ctx)` | 补发 exception_start：活跃排班有异常标记未发过 |
| `_detect_local_confirm_start_backfill(conn, ctx)` | 补发 task_confirm_start：有 actual_start 未发过 |
| `_detect_local_confirm_end_backfill(conn, ctx)` | 补发 task_confirm_end：已完成有 actual_end 未发过 |
| `_detect_local_recycled_backfill(conn)` | 补发 task_recycled：push_log 中未发出的回收记录 |
| `_detect_package_complete(conn, today_str)` | 场景 10：任务包完成 |
| `_detect_shift_report(conn, ctx, now, now_min)` | 场景 11：班次报告 |

---

### 4. `cards.py` — 卡片构建（~500 行）

**公开函数（去掉下划线前缀，表示公开 API）：**

| 新名称 | 原名称 | 说明 |
|---|---|---|
| `build_reminder_card(event)` | `_build_reminder_card` | 单条提醒卡片 |
| `build_announcement_card(events_list)` | `_build_announcement_card` | 公告合并卡片 |
| `build_changes_card(events_list, for_leader)` | `_build_changes_card` | 变动汇总卡片 |
| `build_exception_card(event, is_end, is_update)` | `_build_exception_card` | 异常卡片 |
| `build_report_card(event)` | `_build_report_card` | 班次报告卡片 |
| `build_recycled_card(event)` | `_build_recycled_card` | 回收通知卡片 |
| `build_merged_reminder_card(events_list, count)` | `_build_merged_reminder_card` | 提醒合并卡片 |

辅助函数 `_format_task_label` 也移入此模块（保持私有）。

---

### 5. `dispatch.py` — 派发引擎（~420 行）

**入口函数：** `dispatch_events(all_events: list[dict])`

**常量与公开函数：**

| 元素 | 说明 |
|---|---|
| `DEFAULT_TOGGLES` | 12 种事件类型的 leader/group 开关矩阵 |
| `_load_toggles()` | 从 config 表加载开关，合并默认值 |
| `_should_send(conn, key, target, value)` | 去重检查 |
| `_record_push(conn, ...)` | 写入 push_log |
| `_get_targets_for_event(event)` | 根据分组解析 leader_id + chat_ids |

**事件分组逻辑（从原 `_dispatch_events` 迁移，不变）：**

```
all_events
  ├─ reminder 类 → 按 (target_type, target_id) 合并 → build_merged_reminder_card → 发送
  ├─ exception 类 → 独立发送 → build_exception_card → 发送
  ├─ recycled 类 → 独立发送 → build_recycled_card → 发送
  ├─ announcement 类 → 按 target 合并 → build_announcement_card → 发送
  ├─ report 类 → 独立发送 → build_report_card → 发送
  └─ changes 类 → 按 target 合并 → build_changes_card → 发送
```

---

### 6. `__init__.py` — 入口（~80 行）

**公开 API：**

```python
from feishu.events.shared import MIN_DETECT_INTERVAL_SEC, _last_detect_at
from feishu.events.feishu_source import detect_from_feishu, _fetch_feishu_schedules
from feishu.events.local_source import detect_from_local
from feishu.events.dispatch import dispatch_events
from feishu.events.cards import build_report_card

def detect_and_push_events(old_snapshots=None):
    """主入口：两阶段检测 + 派发。功能与原 push_events.detect_and_push_events 完全一致。"""
    # 1. 最小间隔检查
    # 2. 总开关检查
    # 3. 阶段一：飞书表扫描（场景 1-9）
    # 4. 阶段二：本地 DB 扫描（场景 10-11 + 补发）
    # 5. 阶段三：派发

# 向后兼容别名
_build_report_card = build_report_card
```

### 外部调用方迁移

只需改 import 路径，不改调用方式：

| 文件 | 旧 import | 新 import |
|---|---|---|
| `feishu/sync_loop.py:105,197` | `from feishu.push_events import detect_and_push_events` | `from feishu.events import detect_and_push_events` |
| `routes/feishu.py:373` | `from feishu.push_events import _build_report_card` | `from feishu.events import _build_report_card` |

---

## 错误处理

与原实现保持一致：
- 单台机器的检测器异常 → 捕获后跳过，继续下一台
- 单个场景检测失败 → 捕获后跳过，继续下个场景
- 单个卡片构建/发送失败 → 捕获后记录失败，继续下一条
- 整体 `detect_and_push_events` 异常 → 捕获后记录 warn，不影响 push/pull 主流程

---

## 不变更范围

- `feishu/schedule_sync.py` — 不改
- `feishu/sync_loop.py` — 只改 import 路径
- `feishu/common.py` — 不改
- `routes/feishu.py` — 只改 import 路径（或通过向后兼容别名不改也行）
- `routes/tasks.py` — 不改
- `routes/schedule_ops.py` — 不改
- 所有事件检测逻辑、卡片构建逻辑、派发逻辑 — 原样迁移，功能零变化
