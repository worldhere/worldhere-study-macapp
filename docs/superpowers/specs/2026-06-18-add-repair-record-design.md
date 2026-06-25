# 增加维修时间段功能 — 设计文档

**日期**: 2026-06-18
**状态**: 已批准
**范围**: 历史编辑弹窗中新增"添加维修时间段"按钮 + 后端 API

## 背景

当前系统支持：
- 通过"标记维修"自动创建 repair_log 记录
- 在历史编辑弹窗中编辑已有维修时间段的开始/结束时间
- 在历史编辑弹窗中删除维修时间段（× 按钮）

**缺失能力**：用户无法手动新增一条维修时间记录。如果漏记了某段维修，无法补录。

## 设计

### 前端：history.js

在 `_renderRepairRecords()` 渲染的维修记录列表底部，添加一个"➕ 添加维修时间段"按钮。

**交互流程**：

1. 用户打开历史编辑弹窗 → 看到已有维修记录 + 底部按钮
2. 点击"➕ 添加维修时间段" → 在列表末尾插入空白行
   - 两个 `datetime-local` 输入框为空
   - 行用 `data-rid="new_N"` 标识（临时 ID）
   - 绿色虚线边框区分于已有记录
   - 右侧显示 ✓ 按钮可取消该行
3. 用户点击输入框 → 浏览器弹出原生日期时间选择器，选择日期和时间
4. 点击弹窗"保存" → `_saveRepairRecords()` 中：
   - 收集所有 `data-rid^="new_"` 的行
   - 跳过开始/结束时间未填写的空行
   - 调用 `POST /api/repair_log/create` 逐条创建
   - 已有记录的更新和删除逻辑不变
5. 保存成功后自动刷新时间轴

### 后端：schedule_ops.py

新增 `POST /api/repair_log/create` 端点：

**请求**：
```json
{
  "machine_id": 3,
  "start_datetime": "2026-06-18T09:00",
  "end_datetime": "2026-06-18T11:30"
}
```

**响应**：
```json
{ "ok": true, "id": 42, "msg": "维修记录已创建" }
```

**逻辑**：
- 在 `repair_log` 表中插入一行
- `machine_id` 从前端传入（自动取自当前排程关联的机器）
- `created_at` 自动设为当前时间
- 不影响 `machines.status`（仅操作 repair_log 表）

### 不影响

- 机器当前状态不变
- 飞书同步逻辑不变（push 时 repair_log 会被正常读取）
- 已有编辑/删除功能不变

## 涉及文件

| 文件 | 改动 |
|------|------|
| `static/history.js` | `_renderRepairRecords()` 加按钮；新增 `_addRepairRow()` 函数；`_saveRepairRecords()` 加创建逻辑 |
| `routes/schedule_ops.py` | 新增 `POST /api/repair_log/create` 端点 |

## 自检

- [x] 无 TBD / TODO
- [x] 前后端一致：前端发 `machine_id` + 两个时间，后端接收并写入
- [x] 范围聚焦：仅历史编辑弹窗，不涉及时间轴拖拽等
- [x] 无歧义：空行自动忽略，machine_id 来自排程上下文
