# 机器利用率任务段环形设计

## 概述

将 `machine_utilization` widget 从 piegrid（每台机器一个小环形，按机器类型着色）改为任务段环形（每台机器一个环形，按时间顺序排列任务段，颜色和时间轴状态联动）。

## 环形渲染规则

### 环形结构

- 一个圆环代表一台机器在一个班次内的利用率
- 环形总弧长 = 可用工作时长（分母）= 班次窗口（含加班）− 休息段 = **570min**（白班/夜班相同）
- 任务段弧长 = 各任务 `working_min`（已扣除休息重叠的有效工时）
- 任务段紧密排列，忽略间隙
- 未填充部分 = 灰色底环（空闲/维修时间）
- 中心显示利用率百分比，无其他文字

### 零排班处理

- 机器 `utilization_pct === 0` 且无任务 → **不渲染**（和当前 piegrid 行为一致，过滤 >0 的机器）
- 维修停用但有任务的机器 → 渲染

### 任务段颜色（和时间轴完全一致）

| 任务状态 | 正常机器 | 工作+维修记录 | 维修停用 |
|---------|---------|-------------|---------|
| 已完成 | 绿 `completed` | 绿 `completed` | 绿 `completed` |
| 进行中 | 机型色 `type-color-N` | 机型色 + 粉疊 | 浅粉 `post_pause` |
| 切割 | 紫 `split` | 紫 + 粉疊 | 浅粉 `post_pause` |
| 暂停中 | — | — | 浅红 `paused` |

- `completed`：`var(--state-color-completed)`
- `split`：`var(--state-color-split)`
- `type-color-N`：`var(--type-color-N)` （来自设置页面的机器类型颜色）
- `post_pause`：`var(--state-color-post-pause)`，默认 `#fbcfe8`
- `paused`：`var(--state-color-paused)`，默认 `#fca5a5`

### 维修叠加（粉色 overlay）

- 仅当机器**不是**维修停用、但有 `repair_log` 记录时生效
- 在对应时间位置的环形段上叠加半透明粉色：`rgba(219, 39, 119, 0.45)`（和时间轴 `.repair-overlay` 同色）
- 已完成任务段上**不叠加**粉色（和时间轴一致：`has-repair` 类只改背景为绿）
- 维修停用机器无粉疊（时间轴也跳过 `_renderRepairOverlays`）

### 当前时间红线

- 读取时间轴"显示当前时间红线"开关状态（localStorage 或全局变量）
- 开 → 在环形对应角度画红色虚线径向线（和时间轴红线同色 `#ef4444`）
- 关 → 不画
- 打在正在采集中的任务段上

### hover 交互

- hover 某任务段 → tooltip 显示任务名 + 时段 + 状态 + 工时占比

## 颜色来源

- 不在 summary.js 中硬编码颜色
- 全部从 CSS 变量读取：`getComputedStyle(document.documentElement).getPropertyValue(...)`
- 机器类型颜色沿用之前改的 `_readTypeColors()`（从 localStorage 读）

## 数据层改动

### 后端 `machine_utilization_data` 扩展

返回值从单层 list 扩展为每台机器含 `tasks[]`：

```python
[
  {
    "machine_name": "BR2-26",
    "type": "BR2",
    "machine_status": "工作",         # 新增
    "total_min": 537,
    "utilization_pct": 94.2,
    "task_count": 6,
    "tasks": [                        # 新增
      {
        "name": "物品标签归回笼子",
        "start_min": 542,
        "end_min": 626,
        "working_min": 84,
        "status": "已完成",
        "split_group": None,          # 切割分组
      },
      ...
    ],
    "repairs": [                      # 新增：该机器在本班次内的维修记录
      {"start_min": 800, "end_min": 860},
      ...
    ]
  },
  ...
]
```

- `machine_status`：从 `machines` 表读
- `tasks[].status`：从 `schedules.status` 映射（`completed` → 已完成, `executing` → 采集中, `split` → 切割, `paused` → 暂停中）
- `repairs`：从 `repair_log` 表查该机器在本班次时间窗口内的维修记录

### 休息时段

- 后端返回 `shift_info`：包含 `breaks` 列表和 `available` 可用时长，前端不需要重复计算

## 前端改动

### `summary.js`

- 删 `renderPieGrid`，新增 `renderTaskRing` 函数
- `REPORT_WIDGETS` 中 `machine_utilization` 的 `chartType` 从 `"piegrid"` 改为 `"taskring"`
- `renderWidget` 派发加 `case "taskring"`

### `renderTaskRing` 实现要点

1. 取数据 `SUMMARY_CACHE["machine_utilization"]`
2. 过滤 `utilization_pct > 0` 的机器
3. 按利用率降序排列
4. 每台机器画一个 SVG 环形：
   - 底环灰色
   - 任务段按 `start_min` 排序逐一叠加 `<circle stroke-dasharray>`
   - 颜色按上表规则
   - 维修叠加段额外画内环
   - 红线按当前时间角度画 `<line>`
   - 中心 `<text>` 显示百分比

### 颜色默认值

每次渲染时从 CSS 变量 / localStorage 实时读取，若读取失败使用硬编码兜底：

| 颜色用途 | 读取来源 | 兜底值 |
|---------|---------|-------|
| 机型色 | `_readTypeColors()` → localStorage | `#3b82f6` |
| 已完成 | `var(--state-color-completed)` | `#84cc16` |
| 切割 | `var(--state-color-split)` | `#a78bfa` |
| 暂停中 | `var(--state-color-paused)` | `#fca5a5` |
| post-pause | `var(--state-color-post-pause)` | `#fbcfe8` |
| 维修粉疊 | 硬编码 | `rgba(219,39,119,0.45)` |

### 颜色更新

- 每次 `renderTaskRing` 调用时重新读取颜色（不缓存）
- 设置页修改颜色后 → `applyTypeColor()` / `applyColorSetting()` 已写 CSS 变量和 localStorage
- 环形不需要额外监听，下次 `summaryLoadReport()` 触发重渲染时自动拿到新颜色

## 不涉及

- 夜班逻辑：环形渲染逻辑和班次无关，只是数据不同
- treemap：保持现有 `renderTreemap` 不变
- 其他 widget：不受影响
