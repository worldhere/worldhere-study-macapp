# 回收后自动压实 设计文档

## 目标

回收模式下双击回收（或任务库回收）一个任务后，同机器同日期后续任务自动左移填补空档，遵循自动分配高级设置。

## 开关

- 位置：时间轴工具栏 `置顶机器列` checkbox 右侧
- 标签：`回收后自动压实`
- 存储：`localStorage.auto_compact_recycle`，全局变量 `window._autoCompactRecycle`
- 作用范围：时间轴双击回收 + 任务库回收操作，统一受控

## 核心流程

```
回收任务 → 删除排班记录 → [开关开启?] → 读取 aa_advanced 参数
                                            → POST /compact_tasks
                                            → 后续任务前移
                                            → _silentRefresh
```

## 前端改动

### schedule.html
- 在 `sticky-machine-col` checkbox 后新增 `auto-compact-recycle` checkbox
- onchange 调 `toggleAutoCompactRecycle()` 保存到 localStorage

### settings.js
- 初始化时从 localStorage 读取 `auto_compact_recycle`，设置全局变量
- 初始化 checkbox 状态

### timeline-ops.js — recycleWithAnim
- `doRecycle()` 中 `recycleTasks` 的 onSuccess 回调：若开关开启，收集被回收任务的位置信息 (mid, date, start_min, end_min)，调用 `/compact_tasks`

### tasks.js — recycleTasks
- `execute()` 中 fetch 成功后：若开关开启且传了 scheduleIds，从当前 schedules 数组中取已删除任务的位置信息，调用 `/compact_tasks`
- 读取 `localStorage.aa_advanced` 获取 gap/coverBreaks/extendBreaks

## 后端改动

### 新路由 POST /compact_tasks

**参数**：
```json
{
  "machine_id": 1,
  "date": "2026-05-28",
  "hole_start_min": 480,
  "hole_end_min": 600,
  "gap_minutes": 0,
  "cover_breaks": true,
  "extend_over_breaks": true
}
```

**算法**（位于 routes/schedules.py，复用 auto_assign.py 的 `_extend_end_over_breaks`）：

1. 查询该机器该日期 `start_min >= hole_start_min` 的非完成排班，按 start_min 升序
2. 设 cursor = hole_start_min
3. 遍历每个后续任务：
   - desired_start = max(task.original_start, cursor + gap_minutes)
   - cover_breaks=false 时，若 desired_start 落入休息段，推到休息段后
   - dur = end_min - start_min (任务原时长)
   - end = desired_start + dur
   - extend_over_breaks=true 时，end = _extend_end_over_breaks(desired_start, end, date, shift_config)
   - UPDATE schedules SET start_min=desired_start, end_min=end WHERE id=task.id
   - cursor = end
4. normalize_machine_schedule(conn, date, machine_id)

## 涉及文件

| 文件 | 改动 |
|---|---|
| `templates/panels/schedule.html` | 新增 checkbox |
| `static/settings.js` | 加载/持久化开关状态 |
| `static/timeline-ops.js` | recycleWithAnim 成功后调压实 |
| `static/tasks.js` | recycleTasks 成功后调压实 |
| `routes/schedules.py` | 新增 /compact_tasks 路由 |

## 边界情况

- 回收后无后续任务：/compact_tasks 查不到任务，空操作
- 任务库回收（按 task_id）：可能涉及多台机器多个日期，需要按 (machine_id, date) 分组后分别压实
- cover_breaks=false 时 desired_start 完全落在休息段：推到该休息段结束后
- cursor + gap 超过 hole_end_min：任务位置不变（不产生负位移）
