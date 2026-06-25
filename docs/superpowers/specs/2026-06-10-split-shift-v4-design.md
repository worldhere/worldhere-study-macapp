# 分班视图 v4：切割模型 + 视觉连续

## 背景

经过 v1（双轨行）、v2（独立双轴）、v3（完全独立面板）三次失败后，核心教训是：**不能改造时间轴坐标系**。每次引入新的坐标变换（absToSplitMin、splitMinToAbs）都会在数据层、显示层、交互层引发连锁 bug。

v4 的核心思路：**不改坐标系，改数据**。时间轴永远工作在标准 absMin 体系下。

## 核心机制：溢出卷绕

### 窗口边界

班次窗口以**另一班次的开始时间**为界：

| 班次 | 窗口范围 | 示例（默认配置） |
|------|---------|----------------|
| 白班 | `day.start` ~ `night.start` | 09:00 ~ 21:00（含加班，12h） |
| 夜班 | `night.start` ~ `day.start + 1440` | 21:00 ~ 次日 09:00（含加班+跨午夜，12h） |

### 溢出行为

任务超出对方班次开始时间时，在边界处切断。溢出部分卷到**下一个同类班次窗口的开头**。

```
任务A：06-09 16:00~次日05:00（13h），起始在白班

连续模式：一条连续块 [16:00══════05:00(+1)]

分班模式（白班轴）：
  06-09 白班窗口 [16:00═══21:00]  ← 切在 night.start（21:00）
  06-10 白班窗口 [09:00═══17:00]  ← 剩余 8h 卷到第二天白班开头
```

## 数据模型：1 task + N schedules

每条 schedule 落在**一个班次窗口内**。同 task 的多条 schedule 通过 `split_group` 关联。

```
tasks:     id=1, name="任务A"
schedules: sid=101, task_id=1, date=06-09, start=960, end=1260, split_group="abc", machine_id=3
           sid=102, task_id=1, date=06-10, start=540, end=1020, split_group="abc", machine_id=3
```

**间隙天然空闲**：schedule 之间有空隙，其他任务可分配。

### 为什么不用 JSON segments

最初考虑在 schedule 上加 `segments` JSON 字段记录段落，但一个 task 只对应一条 schedule 会导致 DB 看到一条大占用，间隙无法分配给其他任务。因此采用"1 task + N schedules"。

## 视觉渲染

同 task_id 的多条 schedule 在时间轴上渲染为同色块，视觉上像一条被拉长的任务。渲染逻辑不变，只是多看一个字段判断颜色。

## 模式切换

### 端点

`POST /switch_display_mode`，body `{mode: "split"|"continuous"}`，返回 `{ok: true, affected: N}`。

### 连续 → 分班（拆）

扫描所有 `status != 'completed'` 的 schedule：

1. 根据 `start_min` 判断任务归属班次（落在哪个窗口内）
2. 如果 `start_min` 到 `end_min` 跨过了对方班次边界，在边界处切开
3. 每段建新 schedule，同 task_id，新 UUID 作为 split_group
4. 删原 schedule
5. 不跨边界的不动

已完成任务不处理。

### 分班 → 连续（合）

扫描所有带 split_group 的 schedule，按 split_group 分组：

- **合并条件**：同 machine_id + 段间无任何其他任务（不管相隔多远）
- 满足 → 合并回一条 schedule（取最早 start，最晚 end）
- 不满足 → 拆散 split_group（设 NULL），各段独立

### 撤回

整个模式切换作为一个 undo 单元，复用现有 `/undo_cut` 机制。

## 分配/移动：自动切分

分班模式下 `assign_task`、`move_task`、`update_task_bounds` 自动检测是否跨对方班次边界，跨了就在边界处切开，建多条 schedule。

## 拖拽联动

移动同 split_group 的一段时，其他段自动联动偏移。`stopMove` 检测 `split_group` → 批量更新。

拉伸边界时检测是否越过对方班次边界，越过则自动切出新段。

## 任务库展示

同 task_id 的多条 schedule 在任务库合并显示为一行。分配时段列显示最早段开始 ~ 最晚段结束，工作时长按各段之和计算。

## 需要改动的文件

| 文件 | 改动 | 复杂度 |
|------|------|--------|
| `routes/schedule_cut.py` | 新增 `POST /switch_display_mode`：批量切/合 schedule | 中 |
| `routes/schedule_ops.py` | assign/move/resize 分班模式下自动按窗口切分 | 小 |
| `static/timeline-render.js` | 同 task_id 块渲染同色；task 行可折叠 | 小 |
| `static/timeline-drag.js` | split_group 段联动移动 | 中 |
| `static/timeline.js` | 分班模式 view-mode 扩展 + 切换入口 | 小 |
| `static/task-table.js` | 同 task 多 schedule 合并显示一行 | 小 |
| `static/layout.css` | 分班模式下非本班窗口视觉淡化 | 小 |

## 零改动的文件

- **coordinate-system.js** — absMin / minToPx / pxToMin / getViewRange 全部不变
- **schedule.html** — DOM 结构不变
- **数据库表结构** — split_group 已存在，不新增字段
- **_renderAllTaskBlocks** — 逻辑不变
- **renderShiftOverlaySegments** — 逻辑不变
- **normalize_machine_schedule** — 逻辑不变

## 验证方式

1. 连续模式 → 分班模式切换：跨班任务在对方班次边界处切开，两端各自入对应窗口
2. 分班模式 → 连续模式切换：同机器无插入段 → 合并；有插入 → 拆散
3. 时间轴任务块同色渲染，视觉连续
4. 间隙可分配：白班任务之间的夜班时段可为夜班任务分配
5. 拖拽：split_group 段联动
6. 已完成任务不受模式切换影响
7. 连续模式零退化
