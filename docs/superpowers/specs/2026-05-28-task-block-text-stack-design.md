# 任务条名时间并行显示（窄条两行堆叠）

**日期:** 2026-05-28
**状态:** 设计中

---

## 需求

任务条较窄时，时间文字被 `text-overflow: ellipsis` 截断不可见。要求时间始终可见。方案：条够宽时原样单行；条太窄时切换为两行堆叠，名称在上、时间在下，整体垂直居中。

## 触发时机

每次任务条渲染/刷新后检测，包括：
- 时间轴初次渲染（`_renderAllTaskBlocks`）
- 任务条缩放/拖拽后（`updateBlockDisplay`）
- 窗口大小变化
- 列宽调整后
- 名称修改、任务属性变更后

## 检测方法

在 `static/timeline-render.js` 新增 `_checkTaskBlockStacked(block)` 函数：

1. 获取 bar 的实际内容区宽度（`clientWidth - 水平padding`）
2. 用一个离屏 `<span>`，设置相同字体、相同文字内容，测量 `offsetWidth`
3. 文字宽度 > 内容区宽度 → 添加 `task-stacked` class
4. 文字宽度 <= 内容区宽度 → 移除 `task-stacked` class

## CSS 变更

```css
/* 两行堆叠模式 */
.task-block.task-stacked {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    line-height: 1.3;
}
.task-block.task-stacked .task-time {
    flex-shrink: 0;
}
```

## JS 变更

| 文件 | 改动 |
|------|------|
| `static/timeline-render.js` | 新增 `_checkTaskBlockStacked(block)`；在 `_renderAllTaskBlocks` 每块 append 后调用；在 `updateBlockDisplay` 末尾调用 |
| `static/timeline.css` | 新增 `.task-block.task-stacked` 相关样式 |
| `static/core.js` 或 `static/timeline.js` | 窗口 resize 和列宽调整后遍历所有 `.task-block` 重检 |

## 边界处理

- bar 极窄（连时间都放不下）：时间行不缩，只截名称行
- remark 备注：两行模式下不显示备注（释放空间），单行模式保持原样
- 两行模式不影响拖拽、双击编辑、右键等交互
