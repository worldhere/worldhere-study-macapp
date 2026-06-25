# 预估时长与排班时长分离 — 设计文档

日期：2026-05-20

## 背景

系统中一直只有"预估时长"一个概念，既表示任务的纯耗时，也被当作排班的起止时间窗口。当任务时间窗跨越休息段时，`end_min - start_min` 应该等于"预估时长 + 休息时长"，但当前 `end = start + 预估`，没有休息段补偿。另外，时间轴上拖拽调整任务条大小会覆盖 `tasks.est_seconds`，导致调整排班窗口后预估时长丢失。

## 术语定义

| 概念 | 存储 | 含义 |
|------|------|------|
| **预估时长** | `tasks.est_seconds` | 任务纯耗时，不受休息/维修影响 |
| **排班时长** | `schedules.end_min - schedules.start_min` | 实际排班时间窗口跨度，含休息段 |

## 不改动的部分

- `tasks` 表结构不变
- `schedules` 表结构不变
- 任务编辑/创建表单不变
- 设置面板已有"开始时间跳过休息"和"结束时间避开休息"开关，本次不处理其 bug

## 改动清单

### 1. 时间轴拖拽调整大小 — 不再覆盖预估时长

**文件**: `routes/schedules.py`，函数 `update_task_bounds`

**现状**: 拖拽时间轴任务条两端时，新的 `end_min - start_min` 写入 `tasks.est_seconds`

**改为**: 只更新 `schedules.end_min`，不更新 `tasks.est_seconds`

---

### 2. 自动分配弹窗 — 跨休息段自动延长

**文件**: `static/dialogs.js`（弹窗 UI）+ `auto_assign.py`（算法）

**UI 新增**: 自动分配弹窗新增复选框 `☑ 跨休息段自动延长排班时长`，默认勾选

**逻辑**（勾选时）:
1. 按预估时长找到最佳 `start_min`
2. 检测 `[start_min, start_min + 预估]` 是否覆盖 SHIFT 配置的休息段
3. 若覆盖，将重合的休息段时长累加到 `end_min`
4. `end_min = start_min + 预估 + 休息段总时长`

**逻辑**（取消勾选时）: 保持现有行为，`end = start + 预估`

**API**: 请求体新增字段 `extend_over_breaks: boolean`

---

### 3. 批量延迟弹窗 — 跨休息段自动延长

**文件**: `static/timeline-ops.js`（弹窗 UI）+ `routes/schedules.py` mass_delay（后端）

同改动 2，批量延迟弹窗也加同样的复选框和逻辑。

---

### 4. 历史记录表格 — "总耗时"列改名为"排班时长"

**文件**: `static/timeline-ops.js` 导出列定义 + `routes/schedules.py` 导出列定义

**改动**: 列标题 `"总耗时"` → `"排班时长"`，值来源 `end_min - start_min` 不变

---

### 5. 时间轴 tooltip

**文件**: `static/timeline-render.js`

**改动**: 悬浮 tooltip 显示 `工作时长 Xh / 排班时长 Yh`

工作时长 = `calc_working_minutes(start_min, end_min, date, shift_config)`（已存在）

排班时长 = `end_min - start_min`

---

### 6. 任务库表格

**文件**: `static/tasks.js`

**不改动**: 已有"预估时长"列，值来自 `est_seconds`，保持不变

---

## 验证方式

1. 创建任务预估 2h，自动分配到跨越中午休息段的机器 → 排班时长应 > 2h
2. 取消"跨休息段自动延长"复选框 → 排班时长 = 2h
3. 时间轴拖拽调整任务条 → 检查任务库中预估时长不变
4. 历史记录表格确认列名"排班时长"
5. 时间轴 tooltip 显示两个时长
