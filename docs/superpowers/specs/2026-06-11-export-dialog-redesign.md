# 导出列选择弹窗重构设计

**日期**: 2026-06-11
**状态**: 已确认

## 概述

重构导出 Excel 的列选择弹窗：UI 从 500px 单列拖拽列表改为 850px 左右分栏，新增 6 个字段，优化默认勾选预设。

## UI 布局

### 弹窗尺寸
- 宽度：~850px（原 500px）
- 高度：自适应，最大 70vh

### 左右分栏（6:4）

| 左侧（60%） | 右侧（40%） |
|---|---|
| 列池：分组折叠 + 搜索 + toggle 开关 | 已选列：拖拽排序 + ✕ 移除 |

### 左侧 — 列池

- **搜索栏**：顶部输入框，实时过滤列名，分组随之折叠/显示
- **操作行**：全选 / 取消全选 / 恢复默认
- **分组折叠**：4 组，点击标题展开/收起（默认全部展开）
- **列行样式**：
  - 选中：浅蓝底（`#eff6ff`）+ 蓝色边框（`1.5px solid #bfdbfe`），圆角 10px
  - 未选中：白底灰边框（`1px solid var(--border)`），圆角 10px
  - 右侧 toggle 开关：38×22px 胶囊，蓝底=开 / 灰底=关
- **交互**：toggle 打开 → 右侧末尾追加；toggle 关闭 → 从右侧移除

### 右侧 — 已选列排序

- **标题**：`✅ 已选列 · 拖拽排序` + 列数计数
- **列行样式**：
  - 左侧 3px 主题色竖条
  - ⠿ 拖拽手柄（弱化灰色 `#cbd5e1`）
  - ✕ 移除按钮
  - 圆角 6px，灰边框
- **交互**：纯拖拽排序（无上下移动按钮），✕ 移除（左侧 toggle 自动关闭）
- **空状态**：虚线提示"在左侧勾选列添加到此处"

### 底部按钮
- 取消 / 确认导出

## 字段分组（4 组，29 列）

### 基本信息（7 列）
排班日期 🆕、完成时间、任务名称、机器名称、机型、任务类型、状态

### 时间与时长（9 列）
开始时间、结束时间、实际开始 🆕、实际结束 🆕、预估时长、排班时长、工作时长、预估模式 🆕、预估窗口 🆕

### 任务详情（11 列）
优先级、难度、RBP任务ID、场景、通用类别、来源链接、预期采集量、数采需求ID、数采需求类型、备注、所属任务包 🆕

### 维修相关（2 列）
维修时长、维修时间段

> 🆕 = 新增字段（共 6 个）

## 默认预设（方案 A — 精简实用派）

### 默认排序（前 5 固定）
```
1. 任务名称    2. 任务类型    3. 机器名称    4. 机型    5. 优先级
6. 难度        7. 排班日期    8. 完成时间    9. 开始时间  10. 结束时间
11. 预估时长   12. 排班时长   13. 工作时长   14. 实际开始  15. 实际结束
16. 预估模式   17. 预估窗口   18. 状态       19. 备注      20. RBP任务ID
21. 场景       22. 通用类别   23. 来源链接   24. 预期采集量 25. 数采需求ID
26. 数采需求类型 27. 所属任务包 28. 维修时长 29. 维修时间段
```

### 执行中默认勾选（11 开）
☑ 1-7（前7列，不含完成时间），☑ 9-11（开始/结束/预估时长），☑ 18（状态）
☐ 其余默认关

### 已完成默认勾选（12 开）
☑ 1-7（前7列，含完成时间），☑ 9-10（开始/结束时间），☑ 12（排班时长），☑ 19（备注）
☐ 状态默认关（已完成全部一样，无意义）
☐ 其余默认关

## 交互细节

1. **左侧 toggle ↔ 右侧同步**：toggle 状态和右侧列表双向绑定
2. **✕ 移除**：右侧点 ✕ → 左侧对应 toggle 自动关闭
3. **拖拽排序**：HTML5 Drag & Drop，⠿ 手柄触发
4. **分组折叠**：点击分组标题切换，默认全部展开
5. **搜索过滤**：左侧搜索实时过滤列名，匹配的分组保持展开
6. **全选/取消全选/恢复默认**：一键操作左侧所有 toggle

## 持久化

- **localStorage key 不变**：`exportColumnsOrder`（顺序数组）、`exportColumnsChecked`（勾选对象）
- **兼容旧数据**：旧版只有 `key` 没有分组，新字段在旧数据中不存在 → 默认按预设值
- **首次使用**：无 localStorage → 按默认预设（执行中/已完成各一套）
- **用户改过一次后**：记住偏好，不再使用默认值
- **恢复默认按钮**：重置为当前模式的默认预设

## 后端改动

### SQL 补全字段
```sql
SELECT s.id, s.date, s.machine_id, s.machine_name, s.task_name, s.task_type, s.task_kind,
       s.start_min, s.end_min, s.duration, s.status, s.remark,
       s.completed_at, s.actual_start_min, s.actual_end_min,
       s.exception_mark, s.exception_note, s.estimated_window,
       t.rbp_task_id, t.priority, t.difficulty, t.scene,
       t.general_category, t.source_link, t.expected_count,
       t.collection_req_id, t.collection_req_type, t.est_mode,
       t.package_id
FROM schedules s
LEFT JOIN tasks t ON s.task_id = t.id
WHERE s.status = ?
```

### ALL_COLUMNS 新增项
```python
("date",            "排班日期",     lambda r: r["date"]),
("actual_start",    "实际开始",     lambda r: abs_min_to_datetime(...)),
("actual_end",      "实际结束",     lambda r: abs_min_to_datetime(...)),
("est_mode",        "预估模式",     lambda r: {...}[r["est_mode"]]),
("est_window",      "预估窗口",     lambda r: r["estimated_window"] or ""),
("package_name",    "所属任务包",   lambda r: package_name_map.get(r["package_id"], "")),
```

## 前端文件改动

| 文件 | 改动 |
|------|------|
| `static/timeline-ops.js` | 重写 `EXPORT_COLUMNS` 常量（29项+分组）、`_renderExportColumnList`（左右分栏）、拖拽逻辑、toggle 双向绑定、搜索过滤 |
| `templates/dialogs/all.html` | 弹窗宽度、左右双栏结构 |
| `routes/schedules.py` | SQL 补字段、ALL_COLUMNS 补 6 项、新增字段格式化 |

## 不变项

- 导出流程：`executeExport()` → `/export_schedules` → Blob 下载，逻辑不变
- `_saveExportColumns` / `_loadExportColumns`：localStorage 格式不变
- 历史面板 `exportHistory()` 和工具条 `exportSchedule()` 入口不变
- 列选择弹窗的调用方式不变（`openExportColumnsDialog(status)`）
