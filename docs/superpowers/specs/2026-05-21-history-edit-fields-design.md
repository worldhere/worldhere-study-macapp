# 历史记录修改弹窗 — 字段扩展

## Context

历史记录修改弹窗的"更多字段"当前只有 5 个字段，且存在 bug：提交时调的是 `/update_task_bounds`（只存时间），字段值实际上不生效。需要扩充为完整字段集，并修复提交逻辑。

## 更多字段最终清单（15 个）

### 保留字段（可编辑）
1. 任务名 (name) — text input
2. 机型 (task_type) — select，源：app_config.machine_types
3. 任务类型 (task_kind) — select，源：app_config.task_kinds
4. 备注 (remark) — text input，全宽

### 只读展示
5. 维修时长 (repair_duration) — 计算值，只读
6. 机器 (machine_name) — 自动拼接值 "机器名(机型/类型)"，只读

### 新增字段
7. 优先级 (priority) — select，源：app_config.priorities
8. 难度 (difficulty) — select，源：app_config.difficulties
9. RBP任务ID (rbp_task_id) — text input
10. 场景 (scene) — text input
11. 通用类别 (general_category) — text input
12. 来源链接 (source_link) — text input
13. 预期采集量 (expected_count) — number input
14. 数采需求ID (collection_req_id) — text input
15. 数采需求类型 (collection_req_type) — text input

## 前端改动

### HTML (`templates/dialogs/all.html`)
- "更多字段"区域从 5 个字段扩展到 15 个
- 新增 select 使用 Jinja2 模板循环渲染
- 维修时长和机器设 `readonly` 样式

### JS (`static/history.js`)
- `openHistoryEdit()`: 填充新增字段
- `submitHistoryEdit()`: 
  - 调用 `/update_task_bounds` 存时间（已有）
  - 同时调用 `/edit_task` 存其他字段（新增）
  - 两个 endpoint 都成功后关闭弹窗并刷新

## 后端改动

### `/edit_task` (`routes/schedule_ops.py`)
扩展支持新增字段的写入：
- tasks 表：rbp_task_id, scene, general_category, source_link, expected_count, collection_req_id, collection_req_type

## Verification
- 打开历史记录修改弹窗，展开更多字段，确认 15 个字段全部显示
- 编辑可编辑字段，保存后刷新确认值已更新
- 维修时长和机器显示为只读灰色，不可编辑
- 时间修改仍然正常生效
