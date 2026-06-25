# 自动分配跨班次支持

## 背景

自动分配功能目前将工时窗口硬钳在 `[0, 1440]`（单自然日），`find_free_slots` 也只查当天排班。但系统是班次驱动而非日期驱动的——夜班天然跨午夜（如 20:00~次日 08:00），导致：

1. 工时窗口被 1440 截断，夜班后半段（00:00~08:00）无法分配
2. 当天所有班次排满后无法延到次日班次

## 设计

### 核心思路

将工时窗口从"单日 1440"扩展为"跨班次连续时间窗"，复用系统已有的跨天基础设施。

### 后端改动

#### 1. `auto_assign.py` — 放开 `work_end_min` 钳制

```python
# 当前（第 121 行）
we = max(ws + 1, min(24 * 60, we))
# 改为
we = max(ws + 1, we)
```

`we` 可以 >1440，如 1920 表示次日 08:00。

#### 2. `auto_assign.py` — `find_free_slots` 跨日期查询

当前只查 `WHERE date=?`。改为：根据窗口 `[ws, we]` 计算跨越的自然日范围，一次性查出所有相关日期的排班，映射到连续分钟轴后计算空闲段。

```
窗口 [ws, we] → 跨越 [date, date+1, ..., date+N]
查询所有 date ∈ 范围的 schedules → 每条记录的 start_min/end_min 加上 day_offset * 1440
得到连续分钟轴上的占用段 → 按现有逻辑找空隙
结果空隙的分钟值带有 day_offset（如 start_min=1560 表示次日 02:00）
```

#### 3. `auto_assign.py` — 写入时处理跨天

`best_start` / `best_end` 可能 >1440。根据实际分钟数反推 `date`：

```python
day_offset = best_start // 1440
actual_date = base_date + day_offset
actual_start = best_start % 1440
actual_end = best_end - day_offset * 1440  # 保持跨夜的 end_min 大值
```

`normalize_machine_schedule` 已处理 `end_min > 1440` 的级联，无需额外改动。

#### 4. `auto_assign.py` — `_extend_end_over_breaks` 适配

该函数已遍历 `range(-1, 3)` 的 day offset 来检测休息段（第 81 行），传入的 `start_min`/`end_min` 可能 >1440 时应正确处理。需确保 `date_str` 传的是任务实际开始的日期。

### 不需要改的

- `normalize_machine_schedule` — 已支持 `end_min > 1440` 级联
- `utils.py` 的 `abs_min_to_label`、`abs_min_to_datetime`、`format_abs_range` — 已处理跨天
- `models.py`、`db.py` — 无关联
- 前端时间轴渲染 — 已支持跨天显示

### 前端改动

#### `templates/dialogs/all.html`

- "工时结束"输入框提示文字更新，暗示可输入 >24:00
- 新增"允许跨天"复选框（`id="aa-allow-cross-day"`），控制是否放开 1440 限制

#### `static/dialogs.js`

- `_getAutoAssignParams()`：读取"允许跨天"复选框，传给后端
- `hhmmToMin` 本身支持 "26:00" → 1560，无需改动
- 预览结果渲染：根据返回的 `date` 字段区分显示

### API 改动

`routes/schedules.py` 的 `/auto_assign_preview` 和 `/auto_assign`：

- 接收 `allow_cross_day: bool`（默认 false，向后兼容）
- 不钳制 `work_end_min`
- 透传给 `auto_assign_tasks`

### 数据流

```
前端勾选"允许跨天" → work_end_min 可设 >1440
→ POST /auto_assign_preview { allow_cross_day: true, work_end_min: 1920, ... }
→ auto_assign_tasks(work_end_min=1920, ...)
→ find_free_slots 跨日期查询 → 返回跨越班次的空闲时段
→ 分配 → best_start/end 可能 >1440
→ 写入 schedule(date=实际日期, start_min, end_min)
→ normalize_machine_schedule 处理级联
→ 前端时间轴正常渲染跨天任务
```

### 验证方式

1. 设置工时窗口为 20:00~28:00（即次日 04:00），勾选允许跨天
2. 创建测试任务，预览分配 → 确认任务可分配到 24:00~28:00 时段
3. 确认分配 → 检查数据库 schedule 记录的 end_min > 1440
4. 切换到次日面板 → 确认时间轴正确显示跨天任务
5. 切换回当日面板 → 确认任务也正确显示
