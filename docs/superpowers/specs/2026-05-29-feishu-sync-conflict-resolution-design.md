# 飞书双向同步时间戳仲裁

**日期**: 2026-05-29
**状态**: 已确认

## 背景

当前 `_sync_loop` 先 pull 后 push，`_apply_pull_changes` 对预估时间等字段不做任何改动源头判断——只要飞书值跟本地不一样就覆盖本地。导致本地修改完预估时间后，30 秒同步周期一到就被飞书旧值覆盖。

根本问题：系统不知道"这条记录是谁改的"。

## 核心思路

schedules 加 `updated_at` 列，但**不记录本地修改时间**。而是记录**"最后一次从飞书确认的时间戳"**。

只在两个地方写 `updated_at`：
- push 完成后：回读飞书 `last_modified_time`，写入本地 `updated_at`
- pull 应用飞书变更后：写入飞书 `last_modified_time`

本地任何写操作（拖拽、切割、弹窗改值...）**不碰** `updated_at`。

## 判断逻辑

飞书记录元数据自带 `last_modified_time`（毫秒 Unix 时间戳）。

pull 时：
```
如果 feishu.last_modified_time > schedule.updated_at:
    → 飞书有人改过 → 应用飞书值到本地 → 更新 updated_at
否则：
    → 飞书没变 → 跳过，保留本地值
```

## 三种场景

**场景一：系统改，飞书没改**
本地改了预估时间 → `updated_at` 不变 → push 推送到飞书 → 回读飞书时间写入 `updated_at`
→ 下一轮 pull：`feishu_ms == updated_at` → 跳过 ✓

**场景二：飞书改，系统没改**
飞书改了预估时间 → `last_modified_time` 推进 → pull：`feishu_ms > updated_at` → 应用 ✓

**场景三：两边同时改**
随机，不影响。概率极低。

## 改动范围

### 1. DB 迁移
```sql
ALTER TABLE schedules ADD COLUMN updated_at TEXT
```

### 2. `_apply_pull_changes`（pull 路径）

每次字段覆盖前检查时间戳：
```python
feishu_ms = int(item.get("last_modified_time", 0))
local_updated = _parse_updated_at_ms(existing["updated_at"])

if feishu_ms > local_updated:
    # 飞书有改动，应用
    conn.execute("UPDATE schedules SET field=?, updated_at=? WHERE id=?", (val, feishu_dt, sid))
else:
    # 飞书没动，跳过
```

### 3. `push_machine_schedules`（push 路径）

推送完成后，拉取飞书记录回读 `last_modified_time`：
```python
# 推送成功后
record = _feishu_data("GET", f"/apps/{APP_TOKEN}/tables/{table_id}/records/{record_id}")
if record:
    feishu_ts = record.get("last_modified_time")
    conn.execute("UPDATE schedules SET updated_at=? WHERE id=?", (to_local_dt(feishu_ts), schedule_id))
```

### 4. 本地写路径

**全部不动**——拖拽、切割、合并、批量延后、自动分配、弹窗修改等均不碰 `updated_at`。

## 不变项

- `_sync_loop` pull/push 顺序不变
- `create_feishu_table` / `_create_table` 不变
- `_fetch_all_tables_snapshot` 不变
- 前端飞书同步 UI 不变
