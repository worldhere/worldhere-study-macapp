# 分组-任务包约束 & 双面板弹窗重构

## 概述

两个关联改动：
1. **分组-任务包约束**：自动分配时，任务包可被约束到指定分组，该包内的任务只能分配给该分组的机器。支持手动拖拽和自动均衡分配。
2. **弹窗改为双面板**：解决弹窗内容过长无法触及按钮的问题。左侧自动分配，右侧按需弹出约束面板，各自独立滚动。

---

## 架构

### 数据模型（无新表）

约束关系仅存在于前端弹窗生命周期内，不持久化：

```js
// 前端 constraints: 分组名 → 任务包ID列表
{ "A组": [1, 3], "B组": [2] }

// 传给后端的扁平形式: 任务包ID → 分组名
// {pkgId: groupName, ...}
```

### 数据流

```
弹窗打开 → 加载分组列表 + 任务包列表
       ↓
用户拖拽/自动均衡 → 更新 constraints 对象
       ↓
点击预览/确认 → 扁平化为 package_group_map 传入后端
       ↓
后端 auto_assign_tasks → 按任务包的 group_name 过滤兼容机器
```

---

## 后端改动

### `auto_assign.py` — `auto_assign_tasks()`

函数签名新增参数：`package_group_map: Optional[Dict[int, str]] = None`

在任务循环中（构建 compatible 列表后，约第262行之后），插入分组过滤：

```python
compatible = [m for m in machines
    if m["type"] == task_type
    and (m.get("task_kind") or "") == task_kind
    and m["status"] != "维修停用"]

# 新增：分组约束过滤
pkg_id = task.get("package_id")
if pkg_id and package_group_map:
    constrained_group = package_group_map.get(int(pkg_id))
    if constrained_group:
        compatible = [m for m in compatible
                      if (m.get("group_name") or "") == constrained_group]
```

### `routes/schedule_ops.py`

`/auto_assign_preview` 和 `/auto_assign` 从请求 body 读取 `package_group_map`，类型转换为 `{int(k): v for k, v in ...}` 后传入 `auto_assign_tasks()`。

---

## 前端改动

### 弹窗布局：单面板 → 双面板

**HTML** (`templates/dialogs/auto_assign.html`)：

- 整体容器改为 flex row，内含左面板（`.aa-left`）和右面板（`.aa-right`）
- 左面板容纳现有4个折叠区 + footer
- 右面板默认隐藏（`display:none`），点击左面板 header 中的"分组-任务包约束"按钮打开
- 每个面板各自 `max-height: 72vh; overflow-y: auto`，footer 在左面板内吸底

**CSS** (`static/auto-assign.css`)：

- 弹窗容器宽度从 `680px` 扩大到 `~1060px`
- 新增 `.aa-left` / `.aa-right` 样式
- 右面板滑出动画（可选，先用 display 切换）

### 右面板：框+包约束系统

**HTML 结构**：

```
右面板 header: "分组 — 任务包约束" + ×关闭
右面板 body:
  ├── 工具栏: [⚡自动均衡] [清除全部]
  ├── 分组框列表（从 machine_groups 动态渲染）
  │   └── 每个框: 组名 + 机器数/可用时长 + 已放入的任务包chip + 负载率条
  └── 待分配任务包池（拖拽源）
```

**JS 逻辑** (`static/auto-assign.js`)：

新增状态：
```js
_constraints: {}  // {groupName: [pkgId, ...]}
```

新增方法：
- `_renderConstraintPanel()` — 渲染右面板分组框和包池
- `_autoBalance()` — 按时长贪心均衡分配包到分组
- `_clearConstraints()` — 清除全部约束
- `toggleConstraintPanel()` — 打开/关闭右面板
- 拖拽事件：dragstart/dragover/drop，更新 `_constraints` 并重渲染

**自动均衡算法**：

1. 计算每个分组当前负载：`已分配包总时长 / 机器可用总时长`
2. 任务包按总时长从大到小排序
3. 贪心：每个包放入当前负载率最低的分组
4. 机器可用总时长 = 机器数 × 该组默认工时范围（从时间范围参数取）

### 预览流程修复

**Bug**：`returnToAdjust()` 调用 `open()`，`open()` 无条件调用 `_resetTimeUI()`，导致时间范围丢失。

**修复**：`open()` 拆分为两个路径：

```js
open: function(preserveState) {
    // 显示弹窗
    if (!preserveState) {
        // 首次打开：重置所有状态
        AA._resetFilters();
        AA._resetTimeUI();
        AA._loadMachines();
        AA._loadTasks();
    } else {
        // 从预览返回：保持时间、筛选、约束不变，仅恢复 UI 显示
        AA._restoreTimeUI();       // 从 _state.previewParams 恢复时间控件
        AA._restoreFiltersUI();    // 保持 _activeXxxFilters 不变，重渲染
        AA._renderConstraintPanel(); // 恢复约束面板
    }
    AA._loadAdvanced();
    AA._updateAdvancedSummary();
},

returnToAdjust: function() {
    AA._clearTimelinePreview();
    AA._hidePreviewBar();
    AA.open(true);  // preserveState = true
},
```

`_state.previewParams` 已在 `preview()` 中存储，包含完整的时间参数和 `package_group_map`。

### 状态保存

预览时 `AA._state.previewParams` 新增字段：`package_group_map`（扁平形式）。

确认时 `AA.confirm()` 从 `_constraints` 重新构建 `package_group_map`（防止 previewParams 过期）。

---

## 预览浮动栏

预览栏（`#aa-preview-bar`）在右面板打开时位置可能冲突。处理方式：

- 预览时关闭右面板（`AA.closeConstraintPanel()`），预览栏正常显示
- 返回调整时重新打开右面板（如果之前是打开状态），通过 `_state._panelWasOpen` 标记

---

## 涉及文件

| 文件 | 改动 |
|------|------|
| `auto_assign.py` | `auto_assign_tasks()` 新增 `package_group_map` 参数，加分组过滤逻辑 |
| `routes/schedule_ops.py` | `/auto_assign_preview` 和 `/auto_assign` 读取并传递 `package_group_map` |
| `templates/dialogs/auto_assign.html` | 单面板改双面板结构，新增右面板 HTML |
| `static/auto-assign.css` | 双面板样式，右面板样式，分组框样式，负载条样式 |
| `static/auto-assign.js` | 约束状态管理，拖拽交互，自动均衡算法，预览流程修复 |

---

## 边界情况

- **未分组机器**：`group_name = ""` 的机器不会被任何分组约束匹配到，只能分配无约束的任务包
- **任务包无约束**：`package_group_map` 中不存在的包，其任务按现有逻辑正常分配给所有兼容机器
- **约束分组无兼容机器**：任务进入 unassigned，原因标记为"分组约束无匹配机器"
- **预览后参数保留**：`returnToAdjust` 恢复时间范围、筛选状态、约束面板
- **右面板关闭再打开**：约束状态保持在 `_constraints` 中，重渲染即可恢复
- **未分组任务**：`package_id = NULL` 的任务不受任何分组约束，正常分配
- **分组被删除**：约束面板加载分组列表时自动过滤掉已删除的分组
- **独立滚动**：左右面板各自 `overflow-y: auto`，键盘 Escape 关闭弹窗，Enter 触发预览
