# 本地完成任务时自动填写 actual_end_min

## 背景

当前本地完成任务（5 个入口）只设置 `status='completed'` 和 `completed_at`，但从 **不设置 `actual_end_min`**。导致推送飞书时 `实际结束` 字段永远为空，`task_confirm_end` 通知也永远不会因本地完成而触发。

## 方案

在完成时写入 `actual_end_min`（方案 A），推送路径零改动。同时保证撤销完成时清除该值。

## 影响范围

### 一、设置 `actual_end_min`（6 处）

| # | 文件 | 行 | 端点 | 操作 |
|---|------|----|------|------|
| 1 | `routes/schedule_ops.py` | ~240 | `complete_task` split_group 路径 | SET 加 `actual_end_min` |
| 2 | `routes/schedule_ops.py` | ~247 | `complete_task` 普通路径 | SET 加 `actual_end_min` |
| 3 | `routes/schedule_ops.py` | ~296 | `complete_split_task` | SET 加 `actual_end_min` |
| 4 | `routes/tasks.py` | ~150 | `batch_tasks` complete | SET 加 `actual_end_min` + `completed_at`（补漏） |
| 5 | `routes/tasks.py` | ~334 | `finish_task` | SET 加 `actual_end_min` + `completed_at`（补漏） |
| 6 | `routes/schedule_ops.py` | ~613 | `confirm_overdue` | SET 加 `actual_end_min` + `completed_at`（补漏） |

### 二、清除 `actual_end_min`（1 处）

| # | 文件 | 行 | 端点 | 操作 |
|---|------|----|------|------|
| 7 | `routes/schedule_ops.py` | ~308 | `uncomplete_task` | SET 加 `actual_end_min=NULL` |

### 三、无需改动

- **删除操作**（`recycle_schedules`、`delete_schedule`、`clear_all`）：行直接删除，字段随之消失
- **飞书拉取**（`schedule_sync.py:_apply_pull_changes`）：飞书端填 `实际结束` 时已正确写入
- **飞书推送**（`schedule_sync.py:push_machine_schedules`）：现有逻辑自动将 `actual_end_min` 转为飞书时间戳
- **事件检测**（`push_events.py`）：补发逻辑和场景 8/9 直接从 `actual_end_min` 驱动

## 计算方式

`actual_end_min` = 当前时间相对于 schedule.date 当天零点的分钟数。

逐个排班场景（`complete_task`、`complete_split_task`、`confirm_overdue`）：Python 计算
```python
base = datetime.date.fromisoformat(schedule_date)
now = datetime.datetime.now()
delta = now - datetime.datetime.combine(base, datetime.time(0, 0))
actual_end_min = int(delta.total_seconds() / 60)
```

批量场景（`batch_tasks`、`finish_task`）：SQL 表达式
```sql
actual_end_min = CAST(strftime('%H','now','localtime') AS INTEGER)*60 + CAST(strftime('%M','now','localtime') AS INTEGER)
```
批量操作不逐行查 schedule date，用当天零点分钟数近似。跨天完成概率极低，且用户容许分钟级误差。

## 不变量

- `actual_end_min IS NOT NULL` ⇔ 排班已完成（status='completed'）
- `actual_end_min IS NULL` ⇔ 排班未完成
- 撤销完成 (`uncomplete_task`) 必须同时清除 `actual_end_min`
