# 飞书排班同步：最后写入胜出机制

2026-06-03

## 问题

同步循环 pull-before-push 顺序下，快照用 `==` 比较飞书 LMT 和本地时间，不同时钟永远不等 → 快照过滤失效 → pull 每轮都处理所有记录 → 发现本地有未推送的修改时直接用飞书值覆盖 → 本地改动丢失。

已做的修复（`<=` 替代 `==`）让快照过滤在飞书没有人改动时正常工作，但没有处理"两边都改了"的冲突裁决。

## 目标

实现真正的 Last Write Wins：无论修改来自本地还是飞书，**最晚修改的数据保留**。

## 设计

### 1. 数据模型

`schedules` 表新增：

```sql
ALTER TABLE schedules ADD COLUMN local_modified_at INTEGER NOT NULL DEFAULT 0;
```

- 毫秒级 Unix 时间戳
- `0` = 已与飞书同步，无本地未推送修改
- `> 0` = 本地有修改，时间戳标记

### 2. 自动打戳触发器

```sql
CREATE TRIGGER schedules_local_modified_touch
AFTER UPDATE ON schedules
WHEN OLD.local_modified_at = NEW.local_modified_at
BEGIN
    UPDATE schedules SET local_modified_at = CAST(
        (julianday('now') - 2440587.5) * 86400000 AS INTEGER
    ) WHERE id = NEW.id;
END;
```

`WHEN OLD = NEW` 意味着：push/pull 代码显式写 `local_modified_at` 时，新旧值不同 → 触发器不执行。业务代码（拖拽、自动分配、延后等）不改这个字段 → 新旧值都是当前值、相等 → 触发器执行 → 自动盖上当前时间。

**零侵入**：不需要修改任何业务代码。

### 3. Pull 冲突裁决

```
for each 飞书记录:
  feishu_ms     = record.last_modified_time
  snap_ms       = snapshot[record_id]

  // 第一层：快照快通道 —— 飞书端没人动过
  if snap_ms and feishu_ms ≤ snap_ms:
    skip

  // 第二层：逐字段比较，有差异时裁决
  for each 业务字段:
    if 飞书值 != 本地值:
      local_ts = schedule.local_modified_at
      if local_ts > 0 and local_ts ≥ feishu_ms:
        // 本地有未推送修改，且不比飞书旧 → 保留本地
        skip this field
      else:
        // 飞书端更新 → 写入本地
        write 飞书值 to local
        schedule.local_modified_at = feishu_ms
```

### 4. Push 成功后清零

```sql
-- push_machine_schedules 中，batch_update 成功后
UPDATE schedules SET local_modified_at = 0
WHERE id IN (<pushed schedule ids>);
```

已同步的记录标记为 0，不再被触发器更新（下次业务操作更新时触发器重新打戳）。

### 5. 裁决表

| local_modified_at | feishu vs snap | 结果 |
|:---:|:---:|------|
| `0` | `feishu_ms ≤ snap` | 快通道跳过 |
| `0` | `feishu_ms > snap` | 飞书胜 → 拉取，local_modified_at=feishu_ms |
| `>0` | `feishu_ms ≤ snap` | 快通道跳过，下轮 push 推上去 |
| `>0` | `feishu_ms > snap` 且 `local_ts ≥ feishu_ms` | 本地胜 → 保留 |
| `>0` | `feishu_ms > snap` 且 `local_ts < feishu_ms` | 飞书胜 → 拉取 |

### 6. 时钟假设

本地时间和飞书服务端时间比较，假设两者偏差 ≤ 1 秒。两个来源都走 NTP 对时，满足假设。不满足时提醒用户检查系统时间。

## 要改的文件

| 文件 | 改动 |
|------|------|
| `db.py` | `init_db` 中加 `local_modified_at` 列 + 创建触发器 |
| `feishu/schedule_sync.py` | pull: `_apply_pull_changes` 加冲突裁决逻辑；push: `push_machine_schedules` 推送成功后置零 `local_modified_at` |

## 不影响的

- 机器配置表（`push_machine_config`）——本地为权威源，不涉及 pull 覆盖
- 机器分组表（`sync_groups`）——结构变化时全量重建，不变时只拉负责人
- 所有业务代码——触发器自动维护时间戳
