# 飞书机器表构建重构

**日期**: 2026-05-29
**状态**: 已确认

## 背景

当前 `incremental_init` 采用两阶段初始化（先建表后推数据），在 `create_feishu_table` 内部有创建→校验→删→重试循环，再配合 `_cleanup_orphan_conflict_tables` 按名清理。两套逻辑互相踩脚，导致：

- 刚建好的正确表在下一台机器建表过程中被误删
- 重建的新 table_id 与本地旧映射脱节，后续排班操作写不到新表
- 每台机器各自调一次 `_find_table_by_name`（分页遍历全量表），N 台机器 = N 次全量 API 扫表，串行耗时巨大

## 核心原则

**把网络难题拉到本地解决**：一次拉取飞书 Base 全量表清单到内存快照，所有比对、查重、冲突检测、残留排查都在本地完成。失败重试仅在建表 POST 发生。

## 新流程

```
incremental_init():
  ├─ 0. 确保机器配置表存在（不变）
  │
  ├─ 1. 清场 + 快照：一次性分页拉取 Base 全部表
  │     ├─ 删除所有 _conflict 表，记入 conflicts_deleted 列表
  │     └─ 剩余表（排除配置表）建 name → table_id 快照
  │
  ├─ 2. 对齐：遍历本地机器列表
  │     ├─ 快照命中 → 直接 _upsert_mapping → 从快照移除
  │     └─ 快照未命中 → POST 建表（纯创建，无校验删表逻辑，失败重试3次）
  │                     → _upsert_mapping → 追加快照
  │
  ├─ 3. 残留检测：快照有剩 → 标记 orphan_tables 报警（飞书端孤立表）
  │
  ├─ 4. 清理废弃映射：机器已删 → 删飞书表 + 删 DB 映射行（不变）
  │
  └─ 5. 推数据：对新映射的机器 push_machine_schedules（不变）
```

## 具体变更

### `create_feishu_table` → 重写为 `_create_table`

```python
def _create_table(machine_name):
    """纯创建：POST 建表，失败重试 3 次。不校验名、不删冲突表。"""
    payload = {"table": {"name": machine_name, ...}}
    for attempt in range(3):
        resp = _feishu_request("POST", f"/apps/{APP_TOKEN}/tables", payload)
        if resp.get("code") == 0:
            tid = resp.get("data", {}).get("table_id")
            if tid:
                return tid, None
        if resp.get("code") == 1254013:  # 同名表已存在
            return None, "table name conflict"
        time.sleep(0.5)
    return None, "Failed after 3 retries"
```

去掉原有的：
- `_find_table_by_name` 调用
- 创建后 GET 校验表名
- 校验不通过删表重试

### 新增 `_fetch_all_tables_snapshot`

```python
def _fetch_all_tables_snapshot():
    """一次性分页拉取 Base 全部表，返回 {name: table_id} 和 conflict 表列表"""
```

### 新增步骤 1：清场 + 快照

内联到 `incremental_init`：遍历全部表 → `_conflict` 的直接删 → 其余建快照。

### 步骤 2：对齐

遍历本地机器 → 快照命中直接映射 → 快照未命中调 `_create_table` 纯创建 → 追加快照（防后续同名重复建表）。

### 步骤 3：残留检测

快照里剩下的 name → table_id 就是飞书端有但本地机器没有的孤立表，写入 `result.orphan_tables`。

### 删除项

- `_cleanup_orphan_conflict_tables()` 函数完全移除
- `create_feishu_table` 内部校验/删表/重试逻辑完全移除
- `_find_table_by_name` 保留（其他地方可能引用）

### result 返回值增加

```python
result = {
    "total_machines": N,
    "mapped_machines": N,
    "new_tables_created": N,
    "conflicts_deleted": ["BR2-15_conflict_20260529...", ...],
    "orphan_tables": {"孤表名": "table_id", ...},
    "records_pushed": N,
    ...
}
```

## API 调用对比

| | 旧方案 | 新方案 |
|---|---|---|
| 拉表列表 | N 次（每台机器一次） | 1 次 |
| POST 建表 | 最多 N×3 次（含删表重建） | 最多 N×3 次（纯创建） |
| GET 校验表名 | 每次新建后 | 无 |
| DELETE conflict | N 次（循环末尾扫一次） | 1 次（建表前扫一次） |

## 不变项

- `ensure_machine_config_table` 逻辑不变
- `_upsert_mapping` 逻辑不变
- 废弃映射清理逻辑不变
- 阶段二推数据逻辑不变
- 机器配置表推送逻辑不变
