# 分班视图：三版对比 & 实现复盘

## 文档概览

| 版本 | 路径 | 时间 |
|---|---|---|
| 初版 | `排班系统/2.28.1缓慢推进中/回溯/2026-06-09-split-shift-view-design.md` | 2026-06-09 |
| 重设计版 | `golden/docs/superpowers/specs/2026-06-09-split-shift-view-redesign.md` | 2026-06-09（同日） |
| 当前实现 | `golden/` 代码库 + 本次会话改动 | 2026-06-10 |

---

## 1. 架构：双轨行 vs 独立双轴

| | 初版 | 重设计版 | 当前实现 |
|---|---|---|---|
| 结构 | **双轨行**：一台机器一行，行内上下两轨（白班上/夜班下） | **独立双轴**：两个完全独立的 panel，各自创建机器行 | **独立双轴** ✅ |
| DOM 共享 | 同机器行内共享 DOM | 零 DOM 共享 | 零 DOM 共享 ✅ |
| Header | 顶部白班 header + 底部夜班 header | 每轴自带 header | 每轴自带 header ✅ |
| 独立滚动 | 未明确 | 各自独立滚动 | 各自独立滚动 ✅ |
| 文件拆分 | 改 `timeline-render.js` | 改原文件 + 新增 `schedule-split.html` | 新增 `timeline-split.js` + `schedule-split.html`，完全独立 ✅ |

**变更原因**：初版"一行两轨"在同一 DOM 行内操作两套坐标，`--viewStartMin` 冲突导致白班/夜班轴无法各自独立计算。commit `1b9bcdf` 决定"split view as completely independent panel with own HTML/JS/CSS, zero DOM sharing"。

---

## 2. 视图模式

| | 初版 | 重设计版 | 当前实现 |
|---|---|---|---|
| 连续模式视图 | double / day / night / custom | 同上 ✅ | 同上 ✅ |
| 分班模式视图 | 双轨行 × (day/night/double) | double / day / night / custom-day / custom-night | double / day / night / custom-day / custom-night ✅ |
| 聚焦开关 | "只看白班"/"只看夜班"按钮 | 没提（用 view-mode 下拉替代） | view-mode 下拉 ✅ |
| 视图切换 | 工具栏 | 工具栏 | `split-view-mode` select + `splitApplyViewSettings()` ✅ |

---

## 3. 坐标系

| | 初版 | 重设计版 | 当前实现 |
|---|---|---|---|
| `absToSplitMin` | 提出 | 明确参数 `(absMin, trackType)` | 已实现 ✅ |
| `splitMinToAbs` | 提出 | 明确参数 `(splitMin, trackType)` | 已实现 ✅ |
| `getShiftWindows` | 未命名但隐含 | 明确接口 `(startAbs, endAbs, trackType)` | 已实现 ✅ |
| `_getTrackConfig` | 隐含 | 隐含 | 已实现，返回 `{ws, we, dwEnd, dw, crosses}` ✅ |
| `getViewRange` 分班分支 | 没提 | 分班返回压缩后视图范围 | `_splitGetViewRange` 独立实现 ✅ |
| 窗口边界穿越检测 | 没提 | 没提 | 本次新增 `_absToWindowIndex` + `getWindowsCrossed` ✅ |
| 分班坐标反算（拖拽中） | 提了 `splitMinToAbs` | 提了 `splitMinToAbs` | `_pxToAbsMinForBlock` 分支实现 ✅ |
| 加班纳入窗口宽度 | 没提 | 没提 | 前端 `_getTrackConfig.dwEnd` 包含 overtime ✅；后端 `_window_days_for_range` 通过 `day_dw_end`/`night_dw_end` 参数支持 ✅ |

---

## 4. DOM & 渲染

| | 初版 | 重设计版 | 当前实现 |
|---|---|---|---|
| HTML 结构 | 一个 schedule.html 内嵌 | `schedule-split.html` 独立面板 | `schedule-split.html` 独立面板 ✅ |
| 白班轴 ID | `#axis-day` | `#split-axis-day` | `#split-axis-day` ✅ |
| 夜班轴 ID | `#axis-night`（默认隐藏） | `#split-axis-night` | `#split-axis-night` ✅ |
| 机器行创建 | `rebuildTimelineGrid` 改 | `buildAxis` 参数化 | `_splitCreateMachineRows(containerId, machines)` ✅ |
| 任务块渲染 | `_renderAllTaskBlocks` 改 | `_renderAllTaskBlocks` 按 trackType 分发 | `splitRenderTaskBlocks()` 独立函数 ✅ |
| 任务分类 | 没提 | `_splitClassifyTask` | `_splitClassifyTask(absMin)`：minOfDay 判定 day/night ✅ |
| 叠加层渲染 | `renderShiftOverlaySegments` | `renderShiftOverlaySegments` 改 | `_splitRenderOverlay(axis, trackType, windows, splitStart)` ✅ |
| 面板切换 | `switchTab` 改 | `switchTab` 改 | `switchTab(3)` 判断 `displayMode==='split'` ✅ |
| 静默刷新 | 覆盖所有路径 | 三条路径 | `_silentRefresh` → `splitRefreshTimeline` ✅ |

---

## 5. 拖拽、拉伸（§3 / §5 整组联动）

### 5.1 Spec 要求

| 初版 §5 要求 | 重设计 §3 要求 | 当前状态 |
|---|---|---|
| 同 split_group 段在压缩轨视觉连续 | 保留 | ✅ 压缩坐标天然保证 |
| 拖拽/拉伸时整组联动 | 保留 | ✅ 本次实现（`stopMove` 检测同 task 多 schedule → `/move_split_group`） |
| 拉伸右边界最后一段 end_min 增长，在班次分界处自动切出新段 | 保留 | ✅ 本次实现（`stopResize` 检测 `getWindowsCrossed` → `/stretch_across_windows`） |
| `splitMinToAbs` 坐标反算 | 保留 | ✅ `_pxToAbsMinForBlock` 分支 |
| Drop 到正确机台/轨道 | 新增 | ✅ `dropTask` 通过 `data-track-type` 判断 |
| 冲突检测逐段进行 | 保留 | 🟡 `getSplitConstraint` 提供约束（前段结束 ≤ 本段开始 ≤ 后段开始），但仅限切割模型；跨班分段模型无需此约束（schedule 天然不重叠） |

### 5.2 关键问题与解决

#### 问题 1：`_renderSeg` 叠加层偏移

**现象**：分班模式不设置 `--viewStartMin`，但 `_renderSeg` 内部调用 `_getViewStartMin()` 读取该 CSS 变量。旧值残留导致背景叠加层整体偏移。

**解决**：`_renderSeg(el, a, b, cls, vsOverride)` 增加可选参数，分班模式下 `_splitRenderOverlay` 传入轴的 `splitStart`。

**影响文件**：`coordinate-system.js`（改 `_renderSeg`）、`timeline-split.js`（改 `_splitRenderOverlay` 所有调用点）。

#### 问题 2：`_splitRenderOverlay` 空隙计算双重转换

**现象**：原空隙代码读 `style.left`（像素），直接传给 `_renderSeg` 当作分钟，产生 `minToPx(px)` 的二次转换错误。当 `hourWidth != 60` 时空隙段完全错位。

**解决**：空隙计算从像素空间改为 split-minute 空间，`splitStart + pxToMin(leftPx)` → `_renderSeg(ov, leftMin, rightMin, 'seg-gap', splitStart)`。

**影响文件**：`timeline-split.js`。

#### 问题 3：网格列跨窗口边界

**现象**：夜班 21:00~08:30（dw=690），`ceil(2070/60)=35` 个均匀列。第 12 列标记"08:00"但宽 `hourWidth`，前半段是当天 08:00-08:30、后半段是下一天 21:00-21:30。任务在此列内视觉位置与网格不对齐。

**解决**：改为按窗口独立构建列——`floor(dw/60)` 个完整列 + 1 个 `calc(var(--hourWidth) * remainder / 60)` 比例列。窗口边界对齐列边界。

**影响文件**：`timeline-split.js`（完全重写 `_splitBuildHeaders`）。

#### 问题 4：`showTimeTooltip` 分班模式下时间不准

**现象**：`showTimeTooltip` 用 `_getViewStartMin()` 算时间，分班轴有自己的 `splitStart`。

**解决**：检测 `e.target.closest('.split-timeline-container')`，若在分班容器内，用 `splitMinToAbs(ss + pxToMin(x), trackType)` 替代 `_getViewStartMin() + pxToMin(x)`。

**影响文件**：`timeline-render.js`。

#### 问题 5：`allowDrop` 水平自动滚动不工作

**现象**：`allowDrop` 硬编码 `document.querySelector('.timeline-container')`，分班容器是 `.split-timeline-container`。

**解决**：`(e.currentTarget || e.target).closest('.timeline-container, .split-timeline-container')`。

**影响文件**：`timeline-drag.js`。

#### 问题 6：`updateBlockDisplay` 分班模式下坐标错误

**现象**：`stopMove`/`stopResize` 后调用 `updateBlockDisplay` 即时回显，但它用 `_getViewStartMin()` 定位。分班模式下 `absStartMin` 是绝对分钟，需先转回压缩坐标。

**解决**：`updateBlockDisplay` 检测 `displayMode==='split'` → `absToSplitMin` 转回压缩坐标 → 用轴的 `splitStart` 定位。

**影响文件**：`timeline-render.js`。

#### 问题 7：当前时间红线无位置计算

**现象**：`splitRenderCurrentMarker` 只做显示/隐藏切换，不计算位置。

**解决**：为每轴独立计算：`nowAbs` → `absToSplitMin` → `minToPx(splitMin - ss)` → 设置 `marker.style.left`。仅在当前时间属于该班次时显示（调用 `_splitClassifyTask(nowAbs)` 判定）。在 `app.js` 的 1 秒定时器中加入 `splitRenderCurrentMarker()`。

**影响文件**：`timeline-split.js`、`app.js`。

#### 问题 8：跨班分段 vs 切割任务——数据模型纠正

**现象**：最初实现的 `stretch_across_windows` 走的是切割逻辑：删除原 task、创建 N 个新 task、各自加"（第N段）"命名、设置 `split_order`/`split_total_items`。但用户指出跨班分段任务本质是 **同一个 task**。

**解决**：`stretch_across_windows` 重写为：
- 保留原 task（不删、不改名）
- 每个窗口创建一条新 schedule，全部指向 `task_id`
- 仅设置 `split_group` 标记，不设置 `split_order`/`split_total_items`
- `move_split_group` 改为 `task_id` 驱动（不依赖 `split_group`）

**影响文件**：`routes/schedule_cut.py`（`stretch_across_windows` 完全重写，`move_split_group` 改为 task_id 查询）。

**数据模型对比**：

| | 切割模型 | 跨班分段模型 |
|---|---|---|
| tasks 表 | N 行（各自独立） | 1 行（不变） |
| task 名字 | 自动加"（第N段）" | 不变 |
| schedules 表 | 每段指各自己的 task_id | 每段指同一个 task_id |
| split_group 用途 | 关联多个 task + 排段序 | 仅标记，供模式切换使用 |
| split_order | 需要 | 不需要 |
| 任务库 | N 行（或折叠） | 1 行 |

---

## 6. 跨班分段数据模型（本次澄清的核心）

### 真实场景

```
Day1白班 09:00...任务A开始...18:30 [夜班干别的] Day2白班 09:00...任务A继续...18:30

分班模式白班轴（压缩）：
[Day1 ═══任务A═══][Day2 ═══任务A═══]  ← 视觉连续，同 task，2 条 schedule
```

### 数据层

```
tasks:     id=1, name="任务A", split_group="xxx"
schedules: sid=1, task_id=1, date=06-09, 09:00→21:00  (Day1窗口)
           sid=2, task_id=1, date=06-10, 09:00→18:30  (Day2窗口)
```

### 与切割的本质区别

- **切割**：物理拆分 task，变成多个独立任务（不同 task_id、不同名字）
- **跨班分段**：task 不变（同 task_id、同名字），只是 schedule 按窗口拆分。`split_group` 仅用于模式切换时代的拆/合标记

---

## 7. 模式切换

| | 初版 | 重设计版 | 当前实现 |
|---|---|---|---|
| 入口 | 设置页→班次设置 | 同上 | 同上 ✅ |
| 二次确认弹窗 | 有 | 有 | 有 ✅ |
| API | `POST /switch_display_mode` | 同上 | 同上 ✅ |
| 连续→分班（拆） | 按班次分界切 task | 同上 | 同上 ✅ |
| 分班→连续（合） | 同 split_group + 同机器 + 无插入任务 | 同上 | 同上 ✅ |
| 撤回 | 整单元 undo | 复用 `/undo_cut` | 复用 `/undo_cut` ✅ |

**待解决**：模式切换目前基于"切割模型"（N 个 task + split_group）。跨班分段模型下，同 task 的多条 schedule 如何被合并/拆分，逻辑需要调整。

---

## 8. 任务库折叠显示（§5 / §9）

| | 初版 | 重设计版 | 当前实现 |
|---|---|---|---|
| 父行汇总 | 有完整 spec | 保留 | 🟡 部分（分组显示有，折叠不全） |
| 状态聚合 | 有完整规则 | 保留 | 🟡 |
| 操作按钮 | 父行（展开/折叠/批量回收/批量完成）、子行 | 保留 | 🟡 |
| 排序筛选 | 父行参与排序、子行不参与 | 保留 | 🟡 |

**原因**：任务库折叠设计基于"多 task 同 split_group"的切割模型。跨班分段模型下 task 只有 1 行，不需要折叠。此 spec 需要重新评估。

---

## 9. 自动分配（§6）

| | 初版 | 重设计版 | 当前实现 |
|---|---|---|---|
| 目标班次参数 | 提出 | 保留 | ❌ 未实现 |
| exclusion_periods | 提出 | 保留 | ❌ 未实现 |

---

## 10. 聚焦开关

| | 初版 | 重设计版 | 当前实现 |
|---|---|---|---|
| 按钮 UI | 工具栏"只看白班"/"只看夜班" | 没提 | ❌ 未实现 |
| 效果 | 另一轨隐藏，行高拉满 | 没提 | ❌ 未实现 |

**注**：当前用 `split-view-mode` 下拉实现类似效果（选"白班"只显示白班轴），但非一键切换。

---

## 11. 底部 Header

| | 初版 | 重设计版 | 当前实现 |
|---|---|---|---|
| 底部时间轴 header | 顶部白班 + 底部夜班 | 没提（架构改了） | ❌ 不需要（每轴自带 header） |

**注**：独立双轴架构下每轴有自己独立的 header，不需要"底部 header"设计。

---

## 12. 待解决问题

| # | 问题 | 优先级 | 备注 |
|---|---|---|---|
| 1 | **模式切换适配跨班分段模型** | 高 | `switch_display_mode` 基于"切割模型"（多 task），需要支持"跨班分段模型"（同 task、多 schedule） |
| 2 | **任务库折叠重新评估** | 中 | 跨班分段模型下 task 只有 1 行，初版/重设计的折叠 spec 可能不再适用 |
| 3 | **自动分配支持分班模式** | 中 | 需传目标班次参数 + exclusion_periods |
| 4 | **拉伸收缩段（右边界左移）** | 中 | 当前 `stretch_across_windows` 假设 `new_abs_end >= old_abs_end`（扩张），收缩时需删除多余的 schedule |
| 5 | **跨班分段任务在连续模式下的显示** | 中 | 同 task 多条 schedule 在连续时间轴上如何展示（一条连续块 vs 多条） |
| 6 | **聚焦开关** | 低 | 工具栏加"只看白班"/"只看夜班"一键切换 |

---

## 13. 文件改动汇总

### 本次会话（2026-06-10）新增改动

| 文件 | 改动内容 |
|---|---|
| `routes/schedule_cut.py` | `_window_days_for_range`（窗口计算函数）；`_abs_to_date_min`（abs→date+min）；`POST /stretch_across_windows`（跨班拉伸，1 task + N schedules 模型）；`POST /move_split_group`（改为 task_id 驱动） |
| `static/lib/coordinate-system.js` | `_absToWindowIndex` + `getWindowsCrossed`（窗口边界穿越检测）；`_renderSeg` 增加 `vsOverride` 参数 |
| `static/timeline-drag.js` | `stopMove`：整组联动（检测同 task 多 schedule）；`stopResize`：跨窗口自动分段（`getWindowsCrossed` → `/stretch_across_windows`）；`allowDrop`：分班容器水平滚动；`_pxToAbsMinForBlock`：已有分班分支 |
| `static/timeline-render.js` | `updateBlockDisplay`：分班坐标适配；`showTimeTooltip`：分班容器时间反算 |
| `static/timeline-split.js` | `splitRenderCurrentMarker`：真实位置计算 + 班次过滤；`_splitBuildHeaders`：按窗口独立构建列（比例列）；`_splitRenderOverlay`：所有 `_renderSeg` 传入 `splitStart` + 空隙 min-space 计算 |
| `static/app.js` | 定时器增加 `splitRenderCurrentMarker()` 调用 |

### 之前已实现

| 文件 | 改动内容 |
|---|---|
| `static/timeline-split.js`（新建） | 完整分班视图逻辑（入口、网格、渲染、标记、缩放） |
| `templates/panels/schedule-split.html`（新建） | 分班视图 HTML 结构（双轴、独立 header、独立容器） |
| `static/timeline.js` | `switchTab` 分班面板切换 |
| `static/tasks.js` | `_silentRefresh` → `splitRefreshTimeline` 分支 |
| `static/settings.js` | `switchDisplayMode` + `_updateDisplayModeUI` |
| `templates/index.html` | 引入 `schedule-split.html` |
