# 分班功能 v5：化繁为简

## 背景

v1~v4 的演进中，分班视图的交互（双轴拖拽、独立滚动、坐标反算）是 bug 的主要来源。

用户重新审视需求后，将问题拆为两个独立场景，各自用最简方式解决。

---

## 场景一：自动分配时按班次切分

### 问题

手动分配时用户可以直接切任务，不需要自动分班。只有**自动分配**需要系统替用户判断：任务会不会跨班次？跨了怎么处理？

### 方案

在自动分配面板新增一个**选项**："分班模式分配"。

- **关闭**（默认）：自动分配行为不变，任务可能在时间轴上跨班次
- **开启**：自动分配时，如果分配结果跨越对方班次边界，自动切割成多条 schedule

### 窗口边界（不变）

| 班次 | 窗口范围 |
|------|---------|
| 白班 | `day.start` ~ `night.start` |
| 夜班 | `night.start` ~ `day.start + 1440` |

### 切割行为

```
任务A：预估 13h，自动分配到机器3 06-09 白班 16:00

不分班模式：1条 schedule [16:00~05:00(+1)]
分班模式：
  段1: 06-09 16:00~21:00（白班窗口，5h）
  段2: 06-10 09:00~17:00（下一白班窗口，续 8h）
  共 2 条 schedule，同 task_id，split_group 关联
```

间隙（21:00~09:00）空闲，后续可被夜班任务分配。

### 涉及改动

| 文件 | 改动 |
|------|------|
| `static/auto-assign.js` | 新增"分班模式分配"选项 UI；分配结果自动切分 |
| `routes/schedule_ops.py`（或 `schedule_cut.py`） | `assign_task` 接收分班标记，按窗口边界切 schedule |
| `static/task-table.js` | 同 task 多 schedule 合并显示一行 |
| `static/timeline-render.js` | 同 task_id 块渲染同色 |
| `static/timeline-drag.js` | split_group 段联动（轻量：只做 stopMove 批量更新） |

### 后续：分段计算合并

分段任务在以下场景需要"合二为一"计算：

- **工作时长**：各段之和（跳过间隙）
- **任务库显示**：一个 task 一行，分配时段 = 最早段开始 ~ 最晚段结束
- **完成判定**：所有段完成才算完成
- **回收**：回收所有段

---

## 场景二：导出图片的分班可视化

### 问题

用户希望在图片里看到分班视图（白班-白班连续，夜班-夜班连续），但不需要在交互式时间轴上做。

### 方案

在导出图片功能中新增**弹窗选项**，让用户选择导出模式：

| 选项 | 说明 |
|------|------|
| 连续视图（默认） | 现有导出逻辑，不变 |
| 分班白班视图 | 白班窗口压缩拼接，中间跳过夜班 |
| 分班夜班视图 | 夜班窗口压缩拼接，中间跳过白班 |
| 分班双班视图 | 上下两条：白班轴 + 夜班轴 |

### 分班导出渲染

采用 v3 的压缩拼接思路，但**只在导出时作为静态渲染**：

- 构建白班轴：按白班窗口拼接，每个窗口 `day.start~night.start`，窗口之间无间隙
- 构建夜班轴：按夜班窗口拼接，每个窗口 `night.start~day.start+1440`，窗口之间无间隙
- 任务块在对应轴上按窗口内时间定位
- 没有交互（不涉及拖拽、滚动、实时刷新）
- 渲染到独立的离屏容器 → html2canvas 截图 → 销毁容器

### 导出渲染实现细节（v3 教训集成）

#### 坐标系：压缩拼接（独立模块）

新增三个函数，仅在导出模块使用，不影响主时间轴：

```javascript
// 返回 [startAbs, endAbs] 范围内所有同类班次窗口
getShiftWindows(startAbs, endAbs, trackType)

// 绝对分钟 → 压缩轨分钟偏移
absToSplitMin(absMin, trackType)

// 压缩轨分钟 → 绝对分钟
splitMinToAbs(splitMin, trackType)
```

窗口宽度含加班。夜班跨午夜时 `dwEnd` 含 `+1440` 偏移。参考 v3 `_getTrackConfig` 的 `{ws, we, dwEnd, dw, crosses}` 接口。

#### 网格列：按窗口独立构建（v3 问题 3）

v3 中夜班 `ceil(总分钟/60)` 个均匀列导致**列跨窗口边界**——第 12 列前半是当天 08:00、后半是下一天 21:00，任务位置与网格不对齐。

导出改为**每个窗口独立构建列**：

```
每个窗口：floor(dw / 60) 个完整列 + 1 个比例列（宽 = hourWidth * remainder / 60）
```

窗口边界对齐列边界。不同窗口列数可不同。日期 header 通过 `splitMinToAbs` 反算真实日期后分组。

#### 叠加层：分钟空间计算（v3 问题 1 & 2）

v3 两个叠加层 bug：
- **问题 1**：`_renderSeg` 内部读 `_getViewStartMin()` CSS 变量，分班轴不设该变量 → 偏移
- **问题 2**：空隙读 `style.left`（像素）直接当分钟传给 `_renderSeg` → `minToPx(px)` 二次转换

导出时叠加层全程在**压缩分钟空间**计算。`_renderSeg` 增加可选第五参数 `vsOverride`，分班轴显式传 `splitStart`，不依赖 CSS 变量。空隙直接按分钟差计算，不经过像素。

#### 任务块渲染：绝对 → 压缩 → 像素

每个 schedule 按 `abs_start_min` 的 `minOfDay` 判定归属班次，只渲染到对应轴：

```javascript
const splitMin = absToSplitMin(s.abs_start_min, trackType);
const splitEnd = absToSplitMin(s.abs_end_min, trackType);
const leftPx = minToPx(splitMin - axisSplitStart);
const widthPx = minToPx(splitEnd - splitMin);
```

走独立定位路径，不依赖 `_getViewStartMin()` 和 `updateBlockDisplay`。

#### 不需要的功能（v3 问题 4~7 全部跳过）

| v3 问题 | 导出需要？ | 原因 |
|---------|-----------|------|
| 问题 4: showTimeTooltip 时间不准 | ❌ | 静态图片无 hover |
| 问题 5: allowDrop 容器滚动 | ❌ | 无拖拽 |
| 问题 6: updateBlockDisplay 坐标 | ❌ | 无实时更新 |
| 问题 7: 当前时间红线位置 | 可选 | 可画静态红线（快照），无需定时器 |

#### 容器生命周期

```
点击导出 → 弹窗选模式 → 
  创建离屏容器（position:absolute; left:-9999px）→
  构建双轴 DOM（网格+叠加层+任务块）→
  html2canvas 截图 →
  销毁容器
```

DOM 不与主时间轴共享，截图完即销毁，零残留。

### 涉及改动

| 文件 | 改动 |
|------|------|
| `static/export-image.js` | 新增导出模式弹窗；分班轴静态渲染（网格列构建、叠加层分钟空间计算、任务块压缩定位）；容器生命周期管理 |
| `static/lib/coordinate-system.js` | 新增 `getShiftWindows`、`absToSplitMin`、`splitMinToAbs`（仅导出模块调用）；`_renderSeg` 增加可选第五参数 `vsOverride` |
| `static/layout.css` | 导出弹窗样式；离屏容器基础样式 |

---

## 与 v4 的核心区别

| | v4 | v5 |
|---|---|---|
| 分班时间轴 | 交互式，双轴可拖拽滚动 | ❌ 不做 |
| 模式切换 | POST /switch_display_mode 全局切换 | ❌ 不做 |
| 自动分配分班 | 始终自动切 | ✅ 选项控制 |
| 分班可视化 | 在主时间轴上 | ✅ 导出图片时静态渲染 |
| 坐标系统改动 | 零改动 | ✅ 仅导出模块使用，不影响主时间轴 |
| 风险 | 拖拽/刷新等交互边界多 | ✅ 交互路径极短 |

---

## 零改动

- **schedule.html** — DOM 不变
- **数据库表结构** — split_group 已存在
- **_renderAllTaskBlocks** — 逻辑不变
- **renderShiftOverlaySegments** — 逻辑不变
- **normalize_machine_schedule** — 逻辑不变

## 验证方式

1. 自动分配：开启分班模式 → 任务跨班自动切 → 各段同 task_id + split_group
2. 自动分配：关闭分班模式 → 行为不变（一条 schedule）
3. 任务库：同 task 多 schedule 合并显示，工时求和
4. 导出：连续视图不变
5. 导出：分班白班/夜班/双班各生成正确的静态画面
6. 主时间轴交互：零退化
