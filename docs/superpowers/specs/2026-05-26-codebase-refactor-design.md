# 代码库优化重构 — 设计文档

> 对现有代码库进行中等程度重构：拆分大文件、消除代码重复、IIFE 隔离作用域，不改变核心架构和加载方式。

## 目标

- 拆分 `style.css`（2585行）按功能为 5 个文件
- 拆分 `tasks.js`（1494行）按职责为 4 个模块
- 消除 JS 中的排序函数重复（3 处）
- 所有 JS 文件用 IIFE 包裹，通过 `window._appState` 共享状态

## 架构保持不变

- Flask + Jinja2 模板引擎，不变
- 18 个 `<script>` 标签顺序加载，不变
- CSS 通过 `@import` 组装，`index.html` 只引用 `style.css`，不变
- 不引入打包工具或 ES modules

---

## CSS 拆分方案

| 新文件 | 内容 | 约行数 |
|--------|------|--------|
| `theme.css` | CSS 变量（:root + [data-theme="dark"]）、主题切换按钮、滚动条、动画 keyframes | 250 |
| `layout.css` | Header、Sidebar、Toolbar、Tab、主内容区、响应式、打印、布局模式切换 | 350 |
| `timeline.css` | 时间轴网格、机器行、任务块(.task-block)、叠加层(.seg-*)、拖拽手柄、切割、维修覆盖、当前时间标记、视图控制 | 600 |
| `dialogs.css` | 确认框、抽屉(.drawer-*)、编辑弹窗、历史编辑对话框、Toast、Tooltip、模式切换按钮组 | 500 |
| `components.css` | 表格(含 sticky 列)、按钮、表单、标签、筛选面板(含维度颜色)、分页、便签板、搜索高亮、折叠模块、排序指示器 | 900 |

原 `style.css` 改为：

```css
@import 'theme.css';
@import 'layout.css';
@import 'timeline.css';
@import 'dialogs.css';
@import 'components.css';
```

**约束**：只移动代码块，不修改任何选择器或属性值。CSS 的级联行为不变。所有文件在同一个目录下，`@import` 不需要路径前缀。

---

## JS 拆分方案

### tasks.js → 4 个模块

| 文件 | 职责 | 暴露接口 |
|------|------|----------|
| `task-pool.js` | 池区渲染、拖拽、分页、池区模式(below/fixed/floating) | `window._taskPool` |
| `task-table.js` | 表格渲染(简易+详细)、排序、搜索、筛选、分页 | `window._taskTable` |
| `task-edit.js` | 新增任务、编辑抽屉、删除、回收、指派对话框 | `window._taskEdit` |
| `task-status.js` | 状态轮询、颜色映射、切割段索引、任务调度映射 | `window._taskStatus` |

> 当前 BUG-CONF: 以实际情况为准

**协调层**：保留精简版 `tasks.js`（约 50 行），作为 4 个模块的加载入口，包含：
- `_silentRefresh()` — 统合刷新入口
- `_refreshTaskList()` — 从服务端拉数据后分发给 table/pool
- `_refreshTimelineFromServer()` — 时间轴全量重建
- `recycleTasks()` — 跨模块依赖，暂时保留在协调层

**DOMContentLoaded**：初始化逻辑分拆到各模块自己的 IIFE 尾部。

### IIFE 作用域隔离

每个 JS 文件统一用此模式包裹：

```js
(function() {
  var S = window._appState;  // 共享状态
  // ... 私有变量和函数 ...
  
  // 暴露公共接口
  window._taskPool = {
    render: _renderTaskPool,
    filter: filterTaskPool,
    setMode: setTaskPoolMode,
  };
})();
```

### 共享状态对象

在 `core.js` 开头定义：

```js
window._appState = {
  tasks: [],        // TASKS_DATA
  schedules: [],    // schedules
  repairLogs: {},   // _repairLogs
  hiddenMachines: new Set(),  // _hiddenMachineIds
  sortState: { column: null, direction: 0 },  // taskSortState
};
```

### 消除排序重复

提取到 `core.js`：

```js
var STATUS_SORT_ORDER = ['待分配','已分配','采集中','采集即将完成','暂停中','暂停即将超时','过时待确认','已完成'];

function _sortByColumn(arr, colKey, dir, accessorMap) {
  if (!arr.length || !dir) return;
  arr.sort(function(a, b) {
    var av, bv;
    if (accessorMap[colKey]) {
      av = accessorMap[colKey](a);
      bv = accessorMap[colKey](b);
    } else {
      av = a[colKey] || '';
      bv = b[colKey] || '';
    }
    if (typeof av === 'string') {
      var cmp = av.localeCompare(bv);
      return dir === 1 ? cmp : -cmp;
    }
    return dir === 1 ? av - bv : bv - av;
  });
}
```

---

## 后端清理（Python）

小幅清理，不拆文件：

- `add_task` 和 `update_task` 提取公共的 est_mode 解析为 `_parse_est_payload(d)` 函数
- `list_tasks` 中的 ORDER BY 使用白名单验证（已有 `col_map`，加注释说明安全）

---

## 加载顺序

`index.html` 中 JS 加载顺序保持不变，新增文件插入原 `tasks.js` 位置：

```
core.js → particles.js → ribbons.js →
  task-status.js → task-pool.js → task-table.js → task-edit.js → tasks.js →
  machines.js → history.js → ... → app.js
```

---

## 验证方式

1. 启动 Flask 应用，打开浏览器
2. 逐个面板切换，确认 6 个标签页正常显示
3. 任务池区拖拽、筛选、分页
4. 任务表格排序、搜索、批量操作
5. 时间轴拖拽、回收、完成动画
6. 暗色/亮色主题切换
7. 检查 Console 无 JS 报错
