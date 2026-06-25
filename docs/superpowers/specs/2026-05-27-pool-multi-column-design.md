# 任务池多列布局设计

## 背景

"新版任务池样式"（`pool-style-modern`）使用 `display: flex; flex-wrap: wrap` + `display: block` 使每个任务条撑满整行，形成单列垂直堆叠。在浮动窗口模式（420px 宽）下表现正常，但在下方跟随和底部固定模式（全宽）下只有一列，右侧大量空白浪费。

## 目标

- 将新版任务池样式从单列 flex 改为 CSS Grid 多列布局
- 浮动窗口不受影响，始终 1 列
- 列数可由用户在设置中调整

## 设置

| 项 | 值 |
|---|---|
| 位置 | 排班面板子设置 → 任务池样式 box，checkbox 下方 |
| 控件 | `<input type="range" min="1" max="8">` |
| 默认值 | 2 |
| 存储 key | `pool_modern_columns`（schedule_settings） |

## CSS 方案

使用 CSS 自定义属性，一条规则覆盖所有列数：

```css
/* 替换现有 flex-wrap */
.task-pool.pool-style-modern:not(.pool-mode-floating) #pool-task-items {
    display: grid;
    grid-template-columns: repeat(var(--pool-columns, 1), 1fr);
    gap: 4px;
}

/* 浮动窗口覆写：始终 1 列 */
.task-pool.pool-style-modern.pool-mode-floating #pool-task-items {
    display: block;
}
```

## 影响范围

| 模式 | 新版 OFF | 新版 ON |
|---|---|---|
| 浮动窗口 | inline-block 自然换行 | block 单列（不受列数影响） |
| 下方跟随 | inline-block 自然换行 | Grid N 列 |
| 底部固定 | inline-block 自然换行 | Grid N 列（分页仍生效） |

## 涉及文件

1. **`templates/panels/settings.html`** — 在 checkbox 后增加 range slider
2. **`static/settings.js`** — 读取并应用 `pool_modern_columns`；新版样式关闭时隐藏 slider
3. **`static/timeline.css`** — 替换 `.pool-style-modern` 的 flex-wrap 为 Grid + CSS 变量
4. **`static/core.js`** — `_applyTaskPoolMode()` 中浮动模式下强制 `--pool-columns: 1`

## 交互细节

- 关闭新版样式 checkbox 时，列数 slider 隐藏（灰掉）
- 浮动模式下，列数设置不生效，始终 1 列
- 底部固定模式的分页逻辑不变，分页在 Grid 多列之上继续工作
- 滑块拖拽时实时更新池区布局
