# 任务包导入优化 & 历史记录任务包模块

## 概述

三个独立改动：
1. 任务包导入时，未指定优先级的任务默认 P1
2. 导入预览中的重复/可疑项在确认后正确过滤
3. 历史记录新增「已完成任务包」子面板，展示全部任务已完成的包

---

## 改动一：任务包导入默认 P1

### 问题

`execute_import` 直接取 Excel 中的 raw priority 值，空则入库空字符串。普通导入允许空优先级，但任务包导入应有明确默认值。

### 方案

`execute_import` 函数签名不变，仅增加逻辑：当 `package_name` 不为空且 `item.get("priority")` 为空时，自动填 `"P1"`。

### 涉及文件

| 文件 | 改动 |
|------|------|
| `import_utils.py` | `execute_import`: 第502行附近，`_safe_str(item.get("priority"))` 改为 `_safe_str(item.get("priority")) or ("P1" if package_name else "")` |

### 影响范围

仅影响通过任务包 Excel 导入（`/import_task_package/execute` 和 `/import_task_package/execute_all`）的任务。普通导入不受影响。

---

## 改动二：导入时过滤重复/可疑项

### 问题

`analyze_import` 已正确识别三类状态：
- `ok` — 可安全导入
- `confirm` — 疑似重复（任务名+机型与已有任务重合）
- `rejected` — RBP 任务 ID 已存在，不可导入

但 `execute_import` 不做任何过滤，所有 items 照导。后端二次检查 RBP ID 会拦住 rejected，但 confirm 项不经用户确认就入库。

### 方案

**前端处理，后端不做改动。** analyze 返回的 items 携带 status，前端导入确认对话框中：
- `ok` 项：默认勾选
- `confirm` 项：默认勾选，行背景黄色高亮，标注"疑似重复"
- `rejected` 项：默认不勾选，行背景灰色，标注"RBP任务ID已存在"

用户提交时只发送勾选的 items。

### 涉及文件

| 文件 | 改动 |
|------|------|
| 任务包导入预览相关 JS/HTML | 根据 status 渲染勾选状态和行样式 |

### 影响范围

任务包 Excel 导入的预览→执行流程。普通导入（`/import_tasks/preview` + `/import_tasks/execute`）如已有同样逻辑则一并受益。

---

## 改动三：历史记录——已完成任务包模块

### 需求

- 在历史记录表格下方，新增「已完成任务包」子面板
- 卡片式展示，和任务库的 `.pkg-grid` / `.pkg-card` 完全复用
- 包内**全部任务**都是「已完成」→ 卡片出现在此面板
- 包内**任意任务**被回收/重置/取消完成 → 不再满足条件，卡片从面板消失，回到任务库

### 数据库

无需改库。利用现有 `task_packages` 表 + `tasks` 表实时统计。

### 后端 API

在现有 `GET /api/task_packages` 端点上加查询参数，避免与 `<int:pid>` 路由冲突：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/task_packages?completed=true` | 返回所有全部完成的包列表 |

在 `list_task_packages` 或调用处增加过滤参数 `completed_only=False`。SQL 逻辑：
```sql
SELECT p.* FROM task_packages p
WHERE (SELECT COUNT(*) FROM tasks WHERE package_id=p.id) > 0
  AND (SELECT COUNT(*) FROM tasks WHERE package_id=p.id)
    = (SELECT COUNT(*) FROM tasks WHERE package_id=p.id AND status='已完成')
```

返回格式与现有列表相同（含 total/assigned/completed 统计），前端可直接复用渲染逻辑。

### 前端

#### 模板（`templates/panels/history.html`）

在历史记录表格的 `</table>` 或 `</div>` 之后插入：

```html
<div class="box" id="history-packages-section" style="margin-top:16px;">
    <h3>📦 已完成任务包</h3>
    <div id="history-packages-grid" class="pkg-grid">
        加载中...
    </div>
</div>
```

#### JS（`static/history.js`）

新增函数，逻辑与 `_renderTaskPackages` 几乎相同：

- 调用 `/api/task_packages/completed` 获取数据
- 复用 `_renderTaskPackages` 的 HTML 构建逻辑，或提取共用函数
- 差异：不渲染「+ 新建任务包」虚线卡片；无编辑/删除按钮

#### 自动回退检测

不需要前端轮询。每次切换面板或刷新时重新获取，后端实时计算——包内有未完成任务时不会出现在返回列表中。

### 卡片内容

与任务库完全一致：
- 彩色左边框（不同包不同颜色）
- 包名、机型·优先级·截止
- 双进度条：已分配 / 已完成
- 标签：**已完成**
- **无操作按钮**

### 涉及文件

| 文件 | 改动 |
|------|------|
| `routes/tasks.py` | `api_task_packages` 增加 `?completed=true` 查询参数 |
| `models.py` | 新增 `list_completed_task_packages` 函数 |
| `templates/panels/history.html` | 新增 `#history-packages-section` 子面板 |
| `static/history.js` | 新增 `_loadHistoryPackages` + `_renderHistoryPackages` |
| `static/components.css` | 无需改动，全部复用 |

---

## 测试要点

### 改动一
- [ ] Excel 导入任务包，priority 列空 → 入库后 priority = "P1"
- [ ] Excel 导入任务包，priority 列有值（如 P2）→ 入库后 priority = "P2"
- [ ] 普通导入（非任务包），priority 列空 → 入库后 priority = ""（不变）

### 改动二
- [ ] 预览中 rejected 项默认不勾选
- [ ] 预览中 confirm 项默认勾选，有黄色标记
- [ ] 预览中 ok 项默认勾选
- [ ] 执行时只导入勾选的项

### 改动三
- [ ] 全部任务完成的包出现在历史记录
- [ ] 部分完成的包不出现在历史记录
- [ ] 回收包内某个已完成任务 → 包从历史记录消失
- [ ] 空包不出现在历史记录
- [ ] 卡片样式与任务库一致
- [ ] 无按钮、无可操作元素

---

## 实现顺序

改动一、二、三互相独立，可任意顺序实现。建议：一 → 二 → 三（由简到繁）。
