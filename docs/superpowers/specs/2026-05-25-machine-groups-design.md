# 机器分组功能

## Context

小组长对机器有分组管理需求：有的组长负责单一任务类型，有的负责多种。需要给机器增加分组标签，作为筛选维度管理机器可见范围。

一台机器只能属于一个分组（一对一）。时间轴不直接感知分组，仅通过机器管理的筛选结果自然影响显示。

## Data Model

**config 表** — 新增 category `machine_groups`

```sql
-- 已有表，新增数据行
INSERT INTO config(category, key, value, sort_order) VALUES ('machine_groups', 'A组', '', 1);
```

**machines 表** — 新增列

```sql
ALTER TABLE machines ADD COLUMN group_name TEXT NOT NULL DEFAULT '';
```

空字符串 = 未分组。与 `task_kind` 模式一致，存值不存外键。

**后端辅助函数** — `db.py` 新增 `get_allowed_machine_groups()`，从 config 表读取分组列表，行为与 `get_allowed_task_kinds()` 一致。

## Machine Management Page

机器管理页面从上到下四个区域：

### 1. 新增机器（折叠模块）

- 默认展开，折叠状态存 localStorage
- 在现有行尾增加一个"分组"下拉框（黄色高亮边框，与筛选栏分组色一致）
- 下拉列表从 `machine_groups` 读取，含"未分组"选项和"+ 新建分组..."

### 2. 分组管理（新增折叠模块）

- 默认展开，折叠状态存 localStorage
- 标签式展示所有分组：`⋮⋮ A组 ✕`
- 输入框 + "新建分组"按钮
- 拖拽排序、双击名称编辑、点击 ✕ 删除
- 删除分组时确认弹窗，该分组下的机器自动变为 `group_name = ''`
- 分组数量 badge 显示在标题栏

### 3. 筛选栏

- 在现有机型/状态/任务类型筛选后增加"分组"下拉
- 黄色高亮样式（`border-color: var(--warning); background: var(--warning-light)`）
- 选项：全部 / 各分组名 / 未分组

### 4. 机器表格

- 新增"分组"列（在任务类型列之后）
- 每行一个 dropdown，列出所有分组 + "未分组" + "+ 新建分组..."
- 选择"+ 新建分组..."时弹出小输入框，创建后自动选中
- 修改后保存逻辑与现有 `saveMachineName` 一致（字段变更触发保存按钮显示）

## Merged Batch Add Dialog

合并现有"批量添加"和"输入增加"两个弹窗为一个"批量添加机器"弹窗。

### 结构

- 上方：两个 tab 切换输入方式
- 下方：共享的可编辑结果表格
- 切换 tab 不清空表格，可交替使用追加行

### Tab 1：范围生成

一行输入区：机型 + 任务类型 + 分组 + 名称范围 + "生成列表"按钮

- 名称范围支持 `01-12`、`01,03,05`、混合 `01-05, 07`
- 自动补全为 "机型-编号"
- 生成的新行使用该 tab 的机型/任务类型/分组设定

### Tab 2：粘贴列表

默认值行（机型/任务类型/分组）+ textarea + "解析并添加至列表"按钮

解析规则（括号内逗号分隔）：
| 输入 | 机器名 | 任务类型 | 分组 |
|------|--------|----------|------|
| `BR1-01` | BR1-01 | 默认 | 默认 |
| `BR1-01(接管)` | BR1-01 | 接管 | 默认 |
| `BR1-01(A组)` | BR1-01 | 默认 | A组 |
| `BR1-01(接管, A组)` | BR1-01 | 接管 | A组 |
| `BR1-01(, A组)` | BR1-01 | 默认 | A组 |

括号内第一项匹配任务类型则设为任务类型，匹配分组名则设为分组。无法匹配时保留为任务类型（兼容现有行为）。

### 结果表格

- 每行：序号、机器名、机型、任务类型、分组、删除按钮
- 下拉框默认透明无边框，hover 出现边框
- 与默认设定不同的字段黄底高亮（`changed` class）
- 行内任意字段被修改时行号旁显示橙色圆点
- 底部"+ 手动添加一行"虚线按钮
- 与已有机器重名的行整行标红，提交时跳过

### 入口

机器管理页面按钮从三个简化为两个：**新增** + **批量添加**。

## API Routes

| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/machine_groups` | GET | 返回分组列表 |
| `/add_machine_group` | POST | 新建分组 `{name}` |
| `/update_machine_group` | POST | 更新分组 `{old_name, new_name, sort_order}` |
| `/delete_machine_group` | POST | 删除分组 `{name}`，同时清空该分组下机器的 group_name |
| `/update_machine` | POST | 已有路由，body 增加 `group_name` 字段 |
| `/add_machine` | POST | 已有路由，body 增加 `group_name` 字段 |
| `/add_machines_batch` | POST | 已有路由，machines 数组中每项增加 `group_name` |

分组排序通过 `config.sort_order` 字段，与现有机型、任务类型管理一致。

## Affected Files

| 文件 | 变更 |
|------|------|
| `db.py` | 新增 `get_allowed_machine_groups()`；`init_db()` 增加 `group_name` 列迁移 |
| `models.py` | `list_machines()` 增加 `filter_group` 参数 |
| `routes/machines.py` | 新增分组 CRUD 路由；`add_machine`/`update_machine`/`add_machines_batch` 支持 group_name |
| `static/machines.js` | 分组管理模块逻辑；新增机器分组下拉；表格分组列；合并弹窗全部逻辑 |
| `templates/panels/machines.html` | 新增机器行加分組下拉；新增分组管理折叠模块；筛选栏加分組；表格加分組列；按钮从三个减为两个 |
| `templates/dialogs/all.html` | 移除旧的 `batch-machine-dialog` 和 `input-add-machine-dialog`；新增合并后的 `batch-machine-dialog` |

## Edge Cases

- 删除分组时，该分组下所有机器的 `group_name` 置为空字符串
- 分组名为空或重复时拒绝创建
- 批量添加弹窗中，同一批次内机器名重复的行标红
- 与数据库中已有机器重名的行标红，提交时跳过（与现有行为一致）
- 分组筛选为"全部"时不过滤；为"未分组"时筛选 `group_name = ''`
- 分组管理模块无分组时显示空状态提示
