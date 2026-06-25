# 飞书同步 v2 — 设计规格

## 概述

v1 的推送依赖前端在各 API 响应中手动返回 `dirty_machine_ids`，操作点多容易漏。v2 改为 pull 和 push 合并到统一后台线程，每 30s 全量对比同步，不再依赖前端挂钩。

**核心变化**：前端不再负责触发推送，统一走后端线程全量同步。

## 架构变化

### 旧（v1）

```
Pull:  后台线程 每30s → pull_all_machines() → 飞书 → 系统
Push:  前端 handleResponse → 10s防抖 → POST /api/feishu/push → 系统 → 飞书
```

### 新（v2）

```
统一后台线程 每30s：
  1. pull_all_machines()          — 飞书 → 系统
  2. 遍历所有映射机器 push_machine_schedules() — 系统 → 飞书（全量对比）

手动触发：
  设置页点「立刻推送」→ 立即执行一次 push_machine_schedules()（不走线程，直接同步）
```

全量对比推送无性能问题：每台机器推送窗口为 `[今天-3天, 今天+7天]`（10天），每天最多十几条，单台机器几十行。4台机器 × 几十条 = 每30s不到百次 API 调用，远低于飞书 100次/s 限制。

## 字段双向同步矩阵

| 字段 | 方向 | 行为 |
|------|------|------|
| 预估开始 | **双向** | 系统改→push；飞书改→pull更新schedule+压实 |
| 预估结束 | **双向** | 同上 |
| 任务名/类型/优先级/难度/预估时长 | 系统→飞书 | push时写入，飞书端只读 |
| 实际开始 | 飞书→系统 | 记录 actual_start_min（既定事实，与排班位置无关） |
| 实际结束 | 飞书→系统 | 记录 actual_end_min + 状态变completed |
| 状态 | 系统→飞书 | push时计算动态状态，飞书端只读 |
| 排班备注 | **双向** | 系统改→push；飞书改→pull |
| 异常标记/备注 | **双向** | 拉回写入本地 schedules 表+触发联动；push时从本地读回 |

### 飞书状态字段扩展

v1 只有 `执行中` / `已完成`，v2 映射系统全部动态状态：

| 系统动态状态 | 判断条件 |
|------|------|
| 采集中 | 在排班窗口内，机器正常 |
| 采集即将完成 | 距结束 < N分钟，机器正常 |
| 暂停中 | 在排班窗口内，机器维修 |
| 暂停即将超时 | 暂停 + 距结束 < N分钟 |
| 过时待确认 | 排班已过期，未完成 |
| 已完成 | status=completed |

动态状态在 push 时根据当前时间实时计算。30s 轮询保证状态最多滞后 30s。

## schedules 表新增字段

```sql
ALTER TABLE schedules ADD COLUMN exception_mark TEXT;
ALTER TABLE schedules ADD COLUMN exception_note TEXT;
```

pull 拉回异常标记/备注时写入本地，push 时从本地读回。飞书表即使删了重建，用户数据不丢。

## 数据恢复

初始化（toggle ON / 点初始化）重建飞书表时，非系统字段（实际开始、实际结束、异常标记、异常备注、排班备注）从本地 schedules 表恢复到飞书。

## 砍掉

- 飞书手动改状态 → 系统自动完成（只保留"实际结束 → 完成"这一条联动）
- 前端 `feishu-sync.js` 的 `markDirty` / `handleResponse` / 防抖 / 定时器
- 各 route 返回值中的 `dirty_machine_ids`
- SQLite 触发器 / `schedules_dirty` 表 / 10s 定时器（全量对比不需要这些）

## 预估时间双向同步

pull 时检测飞书预估开始/结束是否与本地不同：

```
飞书预估开始 ≠ 本地 start_min 或 飞书预估结束 ≠ 本地 end_min
  ↓
UPDATE schedules SET start_min=?, end_min=? WHERE _记录ID=sid
  ↓
normalize_machine_schedule(conn, date, machine_id)  -- 复用强制指派压实逻辑
  ↓
下次 push 全量对比自然会把压实结果推回飞书
```

与实际结束独立：已完成的排班改预估时间不受影响，完成状态不丢。

## 设置页面 UI

在"刷新状态"按钮旁加一个"立刻推送"按钮：

```
[刷新状态]  [立刻推送]
```

点击后调用 `POST /api/feishu/push`（不传 machine_ids，默认推送全部映射机器），显示 toast 结果。

## 影响文件

| 文件 | 变动 |
|------|------|
| `feishu_sync.py` | 统一线程（pull + 全量 push）、pull 加预估时间处理、状态字段扩展、砍掉单独状态联动、异常标记/备注读回本地 |
| `routes/feishu.py` | push API 保留（手动/立刻推送用），toggle 不变 |
| `db.py` | schedules 表加 exception_mark / exception_note 字段 migration |
| `static/feishu-sync.js` | 删掉防抖/脏标记/定时器，只保留开关初始化 |
| `static/settings.js` | 加"立刻推送"按钮，飞书状态 UI 不变 |
| 各 routes | 去掉返回值的 `dirty_machine_ids` |

## 兼容性

- `feishu_sync_mapping` 表结构不变
- schedules 表新增 `exception_mark` 和 `exception_note` 字段（向后兼容）
- 飞书 Base/App Token 不变
- 设置页面 UI 布局不变
- `/api/feishu/status` 返回结构向后兼容

## 边界与限制

- 动态状态最多滞后 30s
- 全量对比无性能问题（10天窗口，几十行/机器）
- 飞书 API 频率不受影响
- 30s 延迟对操作员完全可接受
