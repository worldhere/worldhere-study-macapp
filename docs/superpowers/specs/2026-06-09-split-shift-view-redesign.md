# 分班视图（重设计）

## 背景与目标

连续模式下时间轴按真实时钟流动（白班→夜班→第二天白班…）。真实场景中白班和夜班人员不同，任务只在同类班次之间延续——白班任务今天没做完是第二天白班接着做，不是交给夜班。

因此新增**分班显示模式**，将时间轴按班次类型拆开。与 2026-06-09 初版 spec 的核心区别：**放弃双轨行（一台机器一行内上下两轨）**，改为独立时间轴上下堆叠。每轴管理一种班次、各自压缩拼接、各自独立滚动。

## 整体架构

### 显示模式

全局状态 `displayMode`，两个值，存 `localStorage`，不写数据库：

| displayMode | 含义 |
|---|---|
| `continuous` | 连续模式（现有行为，4 视图：double / day / night / custom）|
| `split` | 分班模式（5 视图：double / day / night / custom-day / custom-night）|

### 视图矩阵

```
连续模式 (displayMode=continuous):
  view-mode: double | day | night | custom
  （完全不变）

分班模式 (displayMode=split):
  view-mode: double | day | night | custom-day | custom-night
  - double:       上下两个独立时间轴，各自压缩拼接，独立滚动
  - day:          单轴，白班窗口 ×3（上/当/下）压缩拼接
  - night:        单轴，夜班窗口 ×3（上/当/下）压缩拼接
  - custom-day:   单轴，自定义范围，白班窗口压缩拼接
  - custom-night: 单轴，自定义范围，夜班窗口压缩拼接
```

### 切换入口

设置页 → 班次设置子页面（`settings-sub-0`）→ "切换显示模式"按钮 → 二次确认弹窗 → `POST /switch_display_mode` 批量操作 → 刷新时间轴。

---

## 1. 坐标系：单轨压缩

每轴只管理一种班次窗口。同类窗口首尾相接，另一种班次时段被跳过：

```
白班轴（上一天/当天/下一天，09:00~18:30）：

绝对分钟:  [-900]──────[-330]  [540]──────[1110]  [1980]──────[2550]
窗口:       Day-1 白班        Day0 白班         Day+1 白班
               ↓ 压缩拼接        ↓                 ↓
压缩分钟:  [0]────────[570] [570]────────[1140] [1140]────────[1710]
```

夜班轴同理（21:00~06:30 跨午夜，窗口首尾相接）。

### 核心函数（加在 `static/lib/coordinate-system.js`）

```javascript
// 返回 [startAbsMin, endAbsMin] 范围内所有同类班次窗口
// 每个窗口 { absStart, absEnd, windowIndex }
function getShiftWindows(startAbs, endAbs, trackType)
```

`absToSplitMin(absMin, trackType)` — 绝对分钟 → 压缩轨分钟偏移。找到所属窗口，累加前面窗口宽度。

`splitMinToAbs(splitMin, trackType)` — 压缩轨分钟 → 绝对分钟。逆映射。

### 修改 `getViewRange()`

分班模式下返回压缩后视图范围（起点 0），设置 `--viewStartMin: 0`。

---

## 2. 双班视图渲染

### 2.1 HTML 结构

`schedule.html` 外层加 wrapper，JS 动态构建第二个容器：

```html
<div class="timeline-axes-wrapper">
  <div class="timeline-axis" id="axis-day">
    <!-- 现有 .timeline-container 内容 -->
  </div>
  <div class="timeline-axis" id="axis-night" style="display:none;">
    <!-- 双班模式下 JS 动态构建 -->
  </div>
</div>
```

- 双班视图：两个 axis 都显示，各自独立滚动
- 单轨视图：只用 `#axis-day`，`#axis-night` 隐藏

### 2.2 `rebuildTimelineGrid()` 分班分支

```
rebuildTimelineGrid():
  if displayMode === 'split':
    if viewMode === 'double':
      buildAxis('axis-day', 'day')
      buildAxis('axis-night', 'night')
    elif viewMode in ('day', 'custom-day'):
      buildAxis('axis-day', 'day')
    elif viewMode in ('night', 'custom-night'):
      buildAxis('axis-day', 'night')
  else:
    // 现有连续模式逻辑（不变）
```

`buildAxis(axisId, trackType)` — 将现有 `rebuildTimelineGrid` 的逻辑参数化：
1. 计算视图范围：`getShiftWindows`
2. 构建日期 header + 小时 header
3. 渲染机器行（每台机器一个 `.timeline-track`，`data-track-type` 标记 day/night）
4. 渲染叠加层（shift overlay segments）

### 2.3 `_renderAllTaskBlocks()` 分班分支

每个 schedule 按 `abs_start_min` 判定落在哪个班次窗口：
- 白班窗口 → 渲染到 day axis 的对应 track
- 夜班窗口 → 渲染到 night axis 的对应 track

双班视图两个 axis 都查；单轨视图只查对应类型。

### 2.4 渲染路径一致性

以下三条路径都需正确重建分班网格：

| 路径 | 触发 | 行为 |
|---|---|---|
| `silentRefreshSchedules()` | schedule 变更后 | 重建网格 + 渲染 task blocks |
| `_refreshTimelineFromServer()` | 面板切换 | 全量重建 |
| `applyViewSettings()` | 视图切换 | 重建网格 + 渲染 blocks + 叠加层 |

参考 [[变更后检查自动刷新]](feedback_auto_refresh_after_mutation.md)。

---

## 3. 拖拽、拉伸：整组联动

（保留 2026-06-09 spec §5 设计）

- 同一 `split_group` 的段在压缩轨上视觉连续
- 拖拽/拉伸时整组联动：所有段统一偏移，冲突检测逐段进行
- 拉伸右边界：最后一段 end_min 增长，在班次分界处自动切出新段
- 坐标反算通过 `splitMinToAbs` 完成

拖拽函数（`timeline-drag.js`）中 `pxToMin` + `_getViewStartMin` 路径改为压缩轨 min → `splitMinToAbs` → 绝对 min。

Drop 到正确机台/轨道：通过 `e.target.closest('.timeline-track')` 的 `data-track-type` 判断 day/night。

---

## 4. 模式切换

（保留 2026-06-09 spec §3 设计）

切换端点：`POST /switch_display_mode`，body `{mode: "split"|"continuous"}`，返回 `{ok: true, affected: N}`。

### 连续 → 分班（拆）

扫描所有 schedules，若 start_min 到 end_min 跨过班次分界（如 18:30），在分界处切开：

```
原任务: 16:00~22:00（白班 16:00~18:30，跨入夜班 18:30~22:00）

切开后:
  段1: 16:00~18:30 → 白班轴
  段2: 18:30~22:00 → 夜班轴
```

- 切点：班次边界时间，按真实时钟
- 段共享 `split_group` UUID，`split_order` 递增
- 原 task/schedule 删除，创建新记录

### 分班 → 连续（合）

扫描所有带 `split_group` 的 task：

- **合并条件**：同 split_group + 同机器 + 段间无任何其他任务（不管相隔多远）
- 满足 → 拼回一个连续 task/schedule
- 不满足 → 拆散 split_group，各段独立

### 撤回

整个模式切换作为一个 undo 单元，复用现有 `/undo_cut` 机制。

---

## 5. 任务库折叠

（保留 2026-06-09 spec §9 设计）

### 父行汇总

同 `split_group` 的段在任务库表格中收拢为一个可折叠行。

```
▼ 任务A（3段）  B型  中  执行中  机器X 06/09~06/11  总采集1500
  └ 第一段      B型  中  已完成  机器X 06/09 16:00~18:30  采集500
  └ 第二段      B型  中  已完成  机器X 06/10 09:00~12:30  采集500
  └ 第三段      B型  中  执行中  机器X 06/11 09:00~14:00  采集500
```

### 父行字段汇总规则

| 字段 | 规则 |
|------|------|
| 任务名 | 去后缀基名 + `（N 段）` |
| 机型/优先级/难度/任务类型 | 取第一段 |
| 状态 | 见状态聚合表 |
| 分配时段 | 最早段开始 ~ 最晚段结束 |
| 预期采集量 | 各段之和 |
| 所属任务包 | 取第一段 |

### 父行状态聚合

| 各段状态组合 | 父行显示 |
|-------------|---------|
| 全部相同 | 那个状态 |
| 有任意段采集中 | 采集中 |
| 有任意段暂停中 | 暂停中 |
| 有任意段暂停即将超时 | 暂停即将超时 |
| 有任意段采集即将完成 | 采集即将完成 |
| 混合（上述之外） | 执行中 |

### 操作按钮

| 行 | 按钮 |
|----|------|
| 父行 | 展开/折叠、批量回收、批量完成 |
| 子行 | 编辑、回收（单段）、完成（单段）、删除 |

### 排序和筛选

- 父行参与排序，按基名排序（不含段数标记）
- 子行不参与排序，始终跟在父行下面
- 筛选命中任意一段 → 父行 + 全部子行一起显示
- 父行仅展示，不参与其他函数计算

### 已完成子段

- 已完成子段单独出现在历史记录中（不折叠）
- 任务库父行只收拢**未完成**的子段
- 全部子段完成 → 父行整体移至历史记录，任务库不再显示

---

## 6. 自动分配

（保留 2026-06-09 spec §6 设计）

- 多传"目标班次"参数
- `exclusion_periods` 自动包含所有另一种班次窗口
- 分配逻辑本身不变——在连续绝对分钟坐标系中找空位

---

## 7. 其他

### 7.1 机器显示/隐藏

`_hiddenMachineIds` 控制整台机器。分班模式下机器在两个轴同时隐藏，逻辑不变（参考 spec §7）。

### 7.2 连续模式零影响

连续模式代码路径完全不变。`displayMode === 'continuous'` 时所有分支走到现有逻辑。

### 7.3 跨电脑兼容性

- 每台电脑视图模式独立（存 localStorage），不写数据库
- 分班模式产生的数据就是标准切割段（带 split_group），连续模式天然能正确渲染
- 连续模式产生的跨班任务在分班模式下按真实时钟落在各自班次轴上，不需切

---

## 需要改动的文件

### 前端

| 文件 | 改动 |
|------|------|
| `static/lib/coordinate-system.js` | 新增 `getShiftWindows`、`absToSplitMin`、`splitMinToAbs`；修改 `getViewRange` |
| `static/timeline-render.js` | `rebuildTimelineGrid` 分班分支（`buildAxis` 参数化）；`_renderAllTaskBlocks` 按 trackType 分发；双轴容器构建 |
| `static/timeline.js` | `applyViewSettings` 适配分班模式 |
| `static/timeline-drag.js` | 拖拽/拉伸走 `splitMinToAbs` 反算；整组联动 |
| `static/task-table.js` | 折叠行渲染（父行汇总 + 子段展开/折叠）；状态聚合；split_group 分组逻辑 |
| `static/auto-assign.js` | 目标班次参数 |
| `static/settings.js` | 班次设置子页面新增模式切换按钮；二次确认弹窗；调用切换 API |
| `static/layout.css` | 双轴布局样式、独立滚动样式 |
| `templates/panels/schedule.html` | 双轴 DOM 结构（`.timeline-axes-wrapper`） |
| `templates/panels/settings.html` | 班次设置子页面新增"切换显示模式"按钮 |

### 后端

| 文件 | 改动 |
|------|------|
| `routes/schedule_cut.py` | 新增 `POST /switch_display_mode` 端点：批量拆段 + 批量合并 |

### 不需要改的

- 数据库表结构（复用现有 `split_group` / `split_order` / `split_total_items`）
- 所有统计 API
- 飞书同步核心逻辑
- 机器管理、任务库 CRUD 底层
- undo/redo 基础机制
- `normalize_machine_schedule`
- `models/recycle.py`

## 验证方式

1. 连续模式 → 分班模式切换：跨班任务在分界处切开，两端各自入对应轴
2. 分班模式 → 连续模式切换：同机器无插入段 → 合并；有插入 → 拆散
3. 双班视图双轴独立滚动，各自压缩窗口显示正确
4. 白班/夜班/自定义视图单轴渲染正确
5. 拖拽/拉伸：压缩坐标反算正确，整组联动
6. 自动分配在分班模式下：只在目标班次窗口内分配
7. 任务库：split_group 段折叠/展开，状态聚合正确
8. 已完成子段单独进历史，全部完成 → 父行进历史
9. 机器隐藏：两个轴同时隐藏
10. 连续模式：零退化，现有功能不受影响
