# 飞书同步：初始化两阶段 + conflict 安全清理 + 快照清除

## 问题

`incremental_init` 建表时可能产生 `_conflict` 后缀的残留表，数据推入后被删，主表变空。旧快照未清除导致后续 push 被跳过。

## 设计

### 1. incremental_init 分两阶段

**阶段一：建表**
- 遍历机器，创建/校验飞书表（不推数据）
- 记录新建/重建的机器到 `affected_machines`

**阶段二：导数据**
- 所有表和映射就绪后，对 `affected_machines` 逐一 `push_machine_schedules`

### 2. _upsert_mapping 清除快照

更新映射时强制清空 `last_push_snapshot`，防止旧快照锁死新表。

### 3. _cleanup_conflict_tables → _cleanup_orphan_conflict_tables

删除 conflict 表前检查：是否被任何 `feishu_sync_mapping.table_id` 引用，被引用则跳过。

### 4. conflict 清理时机

移到阶段一末尾（所有机器表创建完成、废弃映射清理之前）。
