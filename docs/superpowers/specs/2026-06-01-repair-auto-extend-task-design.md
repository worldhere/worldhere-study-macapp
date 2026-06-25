# 维修暂停自动延长任务结束时间

## Context

当机器在任务执行期间进入维修暂停，任务实际可用工时被维修占用。当前系统需要用户手动去编辑弹窗里修改结束时间，才能反映真实情况。这个功能让系统在维修结束时自动把受影响任务的结束时间往后推，消除手动操作。

触发源包括手动按钮和飞书同步——两者都走同一个后端路径 `set_machine_status`。

## 行为定义

### 触发条件（三个条件同时满足）

1. 机器从"维修停用"状态切换到其他状态（即维修结束）
2. 排班面板设置子页面的"维修后自动延长任务"开关为**开启**（默认开启）
3. 该机器上存在状态为 `executing` 的任务，且任务时间与维修时间有重叠

### 延长计算

对于每个受影响的任务：

```
overlap_minutes = min(task.end, repair.end) - max(task.start, repair.start)
if overlap_minutes > 0:
    task.end_min = task.end_min + overlap_minutes
```

- 任务和维修的 start/end 均以 `abs_min`（相对基准日期的绝对分钟数）计算
- 每个任务独立延长，不级联、不压实
- 一次性处理，维修结束后只执行一次

### 不会延长的情况

- 任务已在维修期间被用户标记为 `completed`
- 任务已在维修期间被用户回收（schedule 不存在了）
- 维修完全在任务结束后（repair.start >= task.end）
- 维修完全在任务开始前（repair.end <= task.start）
- 开关关闭

## 实现方案

### 核心：在 `routes/machines.py` 的 `set_machine_status()` 中增加延长逻辑

该函数已有 `repair_start` / `repair_end` 的分支。在 `repair_end` 分支（机器从维修恢复时），`conn.commit()` 之前插入：

```python
# 维修后自动延长受影响的任务
auto_extend_enabled = True  # 默认开启，从 config 表读取
config_row = conn.execute(
    "SELECT value FROM config WHERE category='schedule_settings' AND key='auto_extend_after_repair'"
).fetchone()
if config_row:
    auto_extend_enabled = (config_row.get("value") or "1") == "1"

if auto_extend_enabled:
    # 找到本次维修的起止时间
    repair_start_dt = datetime.datetime.fromisoformat(repair_log["start_datetime"])
    repair_end_dt = datetime.datetime.fromisoformat(end_time)

    # 找该机器上所有 executing 状态的任务
    tasks = conn.execute(
        "SELECT id, date, start_min, end_min FROM schedules"
        " WHERE machine_id=? AND status='executing'",
        (machine_id,)
    ).fetchall()

    extended = 0
    for task in tasks:
        task_start = _schedule_to_datetime(task, "start_min")
        task_end = _schedule_to_datetime(task, "end_min")
        # 计算重叠分钟数
        overlap_start = max(task_start, repair_start_dt)
        overlap_end = min(task_end, repair_end_dt)
        if overlap_end > overlap_start:
            overlap_minutes = (overlap_end - overlap_start).total_seconds() // 60
            new_end = task_end + datetime.timedelta(minutes=overlap_minutes)
            # 将 datetime 转回 date + end_min 并更新
            new_end_date = new_end.date().isoformat()
            new_end_min = (new_end - datetime.datetime.combine(new_end.date(), datetime.time(0,0))).total_seconds() // 60
            # 如果跨了天，end_min 需要加上跨天的分钟数
            base_date = datetime.date.fromisoformat(task["date"])
            day_offset = (new_end.date() - base_date).days
            new_end_min = int(new_end_min + day_offset * 1440)
            conn.execute(
                "UPDATE schedules SET end_min=? WHERE id=?",
                (new_end_min, task["id"])
            )
            extended += 1
    if extended > 0:
        msg_parts.append(f"已自动延长 {extended} 个任务的结束时间")
```

### 关键辅助函数

需要新增一个将 schedule 的 `date + start_min/end_min` 转换为实际 datetime 的辅助函数，用于和维修的 datetime 做比较：

```python
def _schedule_to_datetime(schedule_row, min_field):
    """将 schedule 的 date + start_min/end_min 转为 datetime"""
    base = datetime.date.fromisoformat(schedule_row["date"])
    minutes = int(schedule_row[min_field])
    days = minutes // 1440
    remainder = minutes % 1440
    dt = datetime.datetime.combine(base, datetime.time(0, 0))
    dt += datetime.timedelta(days=days, minutes=remainder)
    return dt
```

### 设置开关

在排班面板设置子页面添加开关：

- **位置**：设置面板（`templates/panels/settings.html` 或现有设置区域），与现有 `autoCompactRecycle` 开关同级
- **UI**：复选框 + 标签 "维修结束后自动延长任务时间"
- **默认值**：勾选（开启）
- **存储**：`config` 表 `schedule_settings` 分类，key = `auto_extend_after_repair`
- **读取**：后端 `set_machine_status` 里从 config 表读取
- **前端也可读**：用于显示当前状态（可选，不是必须）

### 改动文件

| 文件 | 改动内容 |
|------|---------|
| `routes/machines.py` | 在 `set_machine_status()` 的 repair_end 分支中加入自动延长逻辑（~40行） |
| `utils.py` | 新增 `schedule_to_datetime()` 辅助函数（~15行） |
| `templates/panels/settings.html` 或设置面板 | 新增一个 checkbox 开关（~5行 HTML） |
| `db.py` | `_seed_config` 中补一条默认配置（1行） |

## 数据流

```
机器状态变更（按钮 or 飞书）
  → POST /set_machine_status/{id}
  → set_machine_status() 后端函数
    → 判断 old_status == "维修停用" and new_status != "维修停用"
      → 查询 repair_log（取最近一条未关闭的，写入 end_datetime）
      → 检查 config: auto_extend_after_repair == "1"?
        → YES: 扫该机器的 executing 任务，计算重叠，更新 end_min
        → NO:  跳过
      → commit
    → 返回 JSON（包含 repair 信息 + 延长摘要）
  → 前端 _refreshTimelineFromServer()
  → 时间轴自动刷新，任务块变长
```

## 边界情况

1. **跨午夜任务**：`schedule_to_datetime()` 处理 day offset，`end_min` 跨越 1440 的倍数正确转换为次日时间
2. **多次维修**：每次维修结束独立计算本次维修的重叠，不累积
3. **维修期间任务被修改**：只处理 `status='executing'` 的任务，已完成/回收的已被过滤
4. **飞书自动触发**：飞书同步将机器设为维修停用或恢复运行时，同样走 `set_machine_status`，延长逻辑自动生效
5. **开关关闭**：延长逻辑直接跳过，行为与现在完全一致

## 验证方式

1. 创建任务 08:00-12:00，机器 09:00 标记维修，10:00 恢复 → 任务自动延长到 13:00
2. 维修覆盖多个任务 → 每个任务独立延长各自的重叠时间
3. 维修期间手动完成任务 → 维修结束后该任务不被延长
4. 维修期间回收任务 → 维修结束后该任务不存在，不延长
5. 开关关闭 → 恢复运行不延长任何任务
6. 飞书同步触发维修 + 恢复 → 延长逻辑同样生效
