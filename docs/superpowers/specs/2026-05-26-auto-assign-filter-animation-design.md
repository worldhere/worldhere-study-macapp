# 自动分配弹窗：多选标签筛选 + 预览闪烁动画

**日期:** 2026-05-26
**状态:** 已确认

---

## 背景

当前自动分配弹窗（`auto_assign.html`）的机器和任务筛选 tab 是单选模式：点击一个，其他全部熄灭。用户无法组合筛选（如"BR1 且 常规"），只能逐个维度查看。

另外，预览模式下的虚线卡片是静态的，和正式排班卡片的视觉差异不够强。

## Feature 1: 多选标签筛选

### 当前行为

- 机器和任务区域各有一排 tab：`全部 | BR1 | BR2 | Mini | 常规 | 接管 | ...`
- 点一个 tab → 其他全灭，列表只显示匹配该单一条件的项
- 不能同时选 `BR1` + `常规` 做交集筛选

### 目标行为

- 每个 tab 是独立 toggle：点一下点亮，再点一下熄灭，多个可同时点亮
- 机型类 tab 和任务类型类 tab 分开成两个小组，每组有自己的"全部"
- 同组内 OR，跨组 AND

### 筛选逻辑

```
同组内: type IN [BR1, BR2]        → OR
跨组:   (type IN [...]) AND (kind IN [...])  → AND
```

示例：
- 点亮 `BR1` + `常规` → `type=BR1 AND kind=常规`
- 点亮 `BR1` + `BR2` + `常规` → `(type=BR1 OR type=BR2) AND kind=常规`
- 点亮 `BR1` + `常规` + `接管` → `type=BR1 AND (kind=常规 OR kind=接管)`
- 机型组仅"全部"亮 + 任务类型组 `常规` + `接管` 亮 → `kind=常规 OR kind=接管`（机型不限）

### Tab 布局

每个筛选区域（机器/任务）的 tab 栏拆为两行：

```
[机型]     全部  BR1  BR2  Mini
[任务类型]  全部  常规  接管  站桩  真实场景  移动
```

每个小组有独立的"全部"标签。

任务区域同理，标签来自任务的 `type` 和 `task_kind` 字段。

### 交互规则

1. **点亮/熄灭**：点具体标签 → toggle 其状态
2. **"全部"自动管理**：
   - 某小组没有任何具体标签被选中 → 该小组的"全部"自动点亮
   - 点亮任意具体标签 → 该小组的"全部"自动熄灭
3. **点"全部"**：清空该小组所有具体标签，只有"全部"点亮
4. **两组独立**：机型组和任务类型组互不影响
5. **筛选仅影响显示**：`.on` 选中状态不受筛选影响。摘要计数（"已选 X 台"）始终统计 `.on` 元素数

### 实现方案

改动文件：`static/auto-assign.js`

**状态变更**：

当前单个 filter 字符串 → 改为每个区域两组数组：

```javascript
// 机器筛选
AA._state._activeMachineTypeFilters = [];  // e.g. ["BR1", "BR2"]
AA._state._activeMachineKindFilters = [];  // e.g. ["常规"]

// 任务筛选
AA._state._activeTaskTypeFilters = [];
AA._state._activeTaskKindFilters = [];
```

**函数改动**：

| 函数 | 改动 |
|------|------|
| `_renderMachineTabs()` | 分组渲染：先机型组（含"全部"），再任务类型组（含"全部"）。toggle 逻辑改为维护数组 |
| `_renderTaskTabs()` | 同上，针对任务 |
| `_renderMachines(filter)` | 参数改为空（内部读 `_activeMachineTypeFilters` + `_activeMachineKindFilters`），筛选逻辑改为 AND/OR 组合 |
| `_renderTasks(filter)` | 同上 |
| `filterMachines(filter, tabEl)` | 改为 `toggleMachineFilter(filter, tabEl)`：根据 filter 前缀 toggle 到对应数组，然后重渲染 |
| `filterTasks(filter, tabEl)` | 同上 |

**`_renderMachines` 核心筛选逻辑**：

```javascript
list = AA._state.machines.filter(function(m) {
    var typeOk = activeTypeFilters.length === 0 || activeTypeFilters.includes(m.type);
    var kindOk = activeKindFilters.length === 0 || activeKindFilters.includes(m.task_kind);
    return typeOk && kindOk;
});
```

任务同理。

## Feature 2: 预览同步闪烁动画

### 目标

预览模式下的虚线卡片（`.aa-preview-card`）和任务池中对应任务（`.aa-pool-preview`）同步播放背景色呼吸动画，强化"待确认"的临时感。

### 动画规格

- 类型：背景色脉冲
- 颜色范围：`rgba(16,185,129,0.08)` ↔ `rgba(16,185,129,0.28)`
- 周期：2s，ease-in-out
- 所有卡片**同步**（不设延迟），像一个整体的"心跳"信号
- 关联设置页的"动画开关"：开关关闭时动画不播放

### 实现方案

**改动文件**：`static/auto-assign.css` + `static/style.css` + `static/timeline-render.js`

**CSS**（auto-assign.css）：

```css
@keyframes aa-preview-flash {
    0%, 100% { background-color: rgba(16, 185, 129, 0.08); }
    50%      { background-color: rgba(16, 185, 129, 0.28); }
}

.aa-preview-card {
    animation: aa-preview-flash 2s ease-in-out infinite;
}

.aa-pool-preview {
    animation: aa-preview-flash 2s ease-in-out infinite;
}
```

**动画开关关联**：

1. `style.css` 的 `body.no-animations` 规则追加：

```css
body.no-animations .aa-preview-card,
body.no-animations .aa-pool-preview {
    animation: none !important;
}
```

2. `timeline-render.js` 渲染预览卡片时，检查 `body.classList.contains('no-animations')` — 如果动画关闭，不设置 animation 样式。

## 非目标

- 不改变后端 API 或算法
- 不改变预览/确认/撤销的流程
- 不改变"全部"以外任何 tab 的标签文字或排序
- 不改变 `.on` 选中状态的持久化方式

## 验证

1. 打开弹窗 → 机器和任务 tab 均为分组布局，各小组"全部"点亮
2. 点亮 `BR1` → "全部"自动灭，列表只显示 BR1 机器
3. 再点亮 `常规` → 列表只显示 BR1 且常规的机器
4. 再点亮 `BR2` → 列表显示 (BR1 或 BR2) 且常规的机器
5. 熄灭 `常规` → 机型组两个亮，任务类型组"全部"自动亮回，列表显示 BR1 或 BR2
6. 点机型组"全部" → 该组清空，"全部"亮，等价于不限机型
7. 选中/取消机器 → "已选 X 台"计数正确，切换筛选不改变选中状态
8. 任务区域同样逻辑
9. 点"预览分配" → 时间轴预览卡片 + 任务池对应条目同步闪烁
10. 关闭动画开关 → 预览卡片停止闪烁（静态虚线）
11. 确认分配 → 闪烁卡片消失，正式排班卡片出现
