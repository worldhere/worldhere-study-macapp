# 任务包功能设计

## 概述

任务包是将一批任务捆绑管理的功能。一个任务包包含若干子任务，跟踪整体进度（已分配/已完成），有独立的截止时间（仅展示，不强制校验）。任务包是季节性功能，偶尔启用。

---

## 数据库

### 新表 `task_packages`

```sql
CREATE TABLE task_packages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    deadline TEXT,              -- "2026-06-30"，仅展示
    priority TEXT NOT NULL DEFAULT 'P1',
    machine_type TEXT NOT NULL DEFAULT 'BR2',
    created_at TEXT NOT NULL
);
```

### tasks 表新增字段

```sql
ALTER TABLE tasks ADD COLUMN package_id INTEGER DEFAULT NULL;
```

### 统计规则

进度不从数据库存，每次实时计算：
- **已分配**：`package_id=X AND status != '待分配'` 的任务数（含已完成，语义为"曾分配过"）
- **已完成**：`package_id=X AND status='已完成'` 的任务数
- **总数**：`package_id=X` 的任务数

---

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/task_packages` | 列表，含每个包的完成/分配统计 |
| POST | `/api/task_packages` | 创建空包 |
| PUT | `/api/task_packages/<id>` | 编辑名称/截止/机型/优先级 |
| DELETE | `/api/task_packages/<id>` | 删除包，`?cascade=true` 级联删除未完成的子任务和排班；`false` 则回收未完成的子任务到待分配并清 package_id |
| POST | `/api/task_packages/<id>/add_tasks` | 从任务库追加任务 `{task_ids: [...]}` |
| GET | `/api/task_packages/<id>/tasks` | 获取某包内所有子任务 |

### DELETE 级联规则

已完成的任务不受影响（仅清除 `package_id`）。未完成的任务：
- `cascade=false`：回收到待分配，清除 `package_id`，删除关联排班
- `cascade=true`：任务和排班一并删除

---

## 导入 Excel 创建任务包

1. 在任务包模块点击"导入 Excel"
2. 上传 → 复用现有 `parse_excel` 解析
3. 识别任务包名：
   - 检查 Excel 中是否有"所属任务包"相关列 → 取该列值
   - 如果没有 → 检查文件名/Sheet名是否含"任务包"
   - 都没有 → 弹窗让用户输入包名（可跳过，默认"未命名任务包"）
4. 确认后：创建 `task_package` 记录 → 批量创建子任务，每个设置 `package_id`
5. 子任务默认值：优先级 P1、机型 BR2、任务类型"常规"

---

## UI

### 位置

任务库页面（导航第3项），在现有任务表格下方新增"任务包模块"，用 `.box` 包裹。

### 卡片网格

- 2列网格，每个卡片显示：任务包名称、机型、优先级、截止时间、进度条
- 进度条两行：蓝色"已分配 X/总数" + 绿色"已完成 X/总数"
- 左边框颜色：未完成用黄色/蓝色（随机分配），已完成用绿色 + 半透明
- 底部虚线卡片："+ 新建任务包"
- 工具栏：`+ 新建空包`、`导入 Excel`、`从任务库打包`

### 展开视图

点击卡片展开，显示：
- 包信息行（名称/机型/优先级/截止/进度）
- 编辑、删除按钮
- 搜索框（过滤包内任务）
- 子任务表格（任务名、机型、优先级、状态、预估时长）
- 每个任务名上方有 `📦 包名` 小标记

### 从任务库打包

仅在展开的任务包内部操作：点击"从任务库添加" → 弹出任务选择器，勾选已有任务 → 批量更新 `package_id`。

### 删除确认弹窗

```
删除任务包「XXX」？
  · 50 个子任务中：12 已分配、23 待分配、15 已完成
  ○ 仅删除任务包，子任务回收为普通任务
  ○ 连同所有子任务一起删除
```

---

## 待分配池 & 时间轴标记

### 待分配池

任务名前面加紧凑标签：`📦季`（图标 + 首字），单行不换行。背景色和任务包卡片左边框颜色对应。无 `package_id` 的任务不显示标签。

### 时间轴

任务块渲染时，任务名上方加一小行灰色包名标记。鼠标悬停 tooltip 包含"所属任务包：XXX"字段。

---

## 自动分配集成

自动分配弹窗的任务筛选区新增"任务包"Tab组：

```
任务  ▼
  机型     [全部] [BR1] [BR2] [Mini]
  任务类型  [全部] [常规] [接管] [站桩]
  任务包   [全部] [季度采集包] [专项补充包]
```

选中任务包后只显示/分配该包的待分配任务。配合已有的机器分组筛选，实现"某组机器分配某任务包"。后端 `auto_assign_tasks` 不需要改动，前端传 `task_ids` 即可。

---

## 涉及文件

| 层 | 文件 | 改动 |
|---|---|---|
| DB | `db.py` | `init_db` 新增 `task_packages` 表 + `tasks.package_id` |
| 后端 | `models.py` | 新增 `list_task_packages()` 等 |
| 后端 | `routes/tasks.py` | 新增 `/api/task_packages/*` 路由 |
| 后端 | `import_utils.py` | Excel 导入支持"所属任务包"字段识别 |
| 前端 | `templates/panels/tasks.html` | 任务表下方新增任务包模块 HTML |
| 前端 | `static/task-table.js` | 卡片渲染、展开交互、从任务库打包 |
| 前端 | `static/task-pool.js` | 待分配池内任务包标签 |
| 前端 | `static/timeline-render.js` | 时间轴任务块包名标记 |
| 前端 | `static/auto-assign.js` | 任务筛选新增"任务包"Tab 组 |
| 前端 | `static/components.css` | 卡片、进度条样式（沿用现有 CSS 变量） |
| 前端 | `static/tasks.js` | 任务包操作协调层 / `_silentRefresh` 同步 |

---

## 非功能需求

- 创建/编辑/删除任务包后自动 `_silentRefresh` 更新 UI
- 子任务状态变更（完成/回收/分配）后进度自动重新计算
- 切换面板（如从排班切回任务库）时从服务端重拉数据
- 样式沿用现有 CSS 变量和 `.box` / 表格风格，支持亮色/暗色双主题
