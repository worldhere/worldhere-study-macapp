# 飞书同步：批量 API 优化删除性能 & 快照修复

## 问题

`push_machine_schedules` 中创建/更新/删除全部串行单条调用。极限场景（500条回收+重新分配）下：
- 创建 500 条约 2-3 分钟
- 删除 500 条约十几分钟（串行 DELETE 逐条请求 + 飞书限流）
- 删除失败后快照顾更新，失败记录永久残留

## 根因

1. **串行删除**：每条 DELETE 一次 HTTP 请求，500 条 = 500 次串行调用
2. **快照顾更新**：无论成败都写 `last_push_snapshot`，失败记录下次被跳过

## 设计

### 1. 批量 API 替换串行循环

`push_machine_schedules` 内改三阶段：

**阶段 1：分组（不调 API）**
- 遍历 `sorted_rows`，匹配 `feishu_map`
- 新记录 → `to_create` 列表
- 已有记录 → `to_update` 列表（保留飞书端 USER_FIELDS）
- 匹配到的从 `feishu_map` 移除
- `feishu_map` 剩余 → `to_delete` 列表

**阶段 2：批量发送**
- `batch_create`：`POST .../records/batch_create`，body `{"records": [{"fields": {...}}, ...]}`
- `batch_update`：`POST .../records/batch_update`，body `{"records": [{"record_id": "rec_xxx", "fields": {...}}, ...]}`
- `batch_delete`：`POST .../records/batch_delete`，body `{"records": ["rec_xxx", ...]}`

**阶段 3：分片（100 条/批）**
- 任一操作超 100 条，按 100 条分片
- 片内并发（ThreadPoolExecutor）

### 2. 快照修复

- 快照结构扩展：`{"records": {...}, "feishu_total": N}`
- 全部批次成功 → 更新快照
- 任何批次失败 → 不更新快照，下次同步重走全流程
- `feishu_total` 与当前飞书记录数不一致 → 即使 records 部分相同也触发同步

### 3. 新增辅助函数

```python
def _batch_create_records(table_id, records):
    """批量创建记录，超 100 条自动分片并发。返回 (success_count, errors)"""

def _batch_update_records(table_id, records):
    """批量更新记录，超 100 条自动分片并发。返回 (success_count, errors)"""

def _batch_delete_records(table_id, record_ids):
    """批量删除记录，超 100 条自动分片并发。返回 (success_count, errors)"""
```

每个函数内部：按 100 条分片 → ThreadPoolExecutor 并发 → 汇总结果。

## 影响范围

- `feishu_sync.py`：`push_machine_schedules` 函数重构 + 新增 3 个 batch 辅助函数
- 无数据库变更
- 无前端变更
