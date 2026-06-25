# 采集员字段设计

## 背景

无分组机器的事件通知当前发给所有小组长（按班次过滤后去重），粒度太粗。需要在排班粒度增加一个可选的"采集员"字段，用于精确路由事件通知。

## 需求

1. 每台机器的飞书排班表增加"采集员"字段（User 类型，多选）
2. 采集员只从飞书拉取到本地 schedules 表，不反向推送
3. 事件分发按采集员/小组长/机型匹配的六分支优先规则路由

## 数据模型

### 本地 schedules 表

```sql
ALTER TABLE schedules ADD COLUMN collector TEXT NOT NULL DEFAULT ''
```

逗号分隔飞书 open_id，格式同 `groups.day_leader`。空字符串表示未设置。

### 飞书排班表

在 `TABLE_FIELDS` 中新增字段，插入到"预估时长"和"修改与同步时间"之间：

```python
{"field_name": "采集员", "type": 11, "ui_type": "User",
 "property": {"multiple": True}},
```

类型 11 = User，`multiple: true`。用户字段在飞书端存储为 `[{"id":"ou_xxx","name":"张三"}, ...]`，拉取时通过 `_parse_feishu_user()` 解析为逗号分隔的 open_id 字符串。

## 同步规则

### 分类

采集员属于 `USER_FIELDS`（飞书优先，系统不覆盖）：

```python
USER_FIELDS = {"排班备注", "异常备注", "采集员"}
```

### 拉取（feishu/schedule_sync.py `_apply_pull_changes`）

新增步骤：从飞书记录中读取"采集员"字段，用 `_parse_feishu_user()` 解析，写入 `schedules.collector`。不与 LWW 逻辑耦合——直接从飞书覆盖本地值。

### 推送

不处理。`USER_FIELDS` 中的字段在推送时原样保留飞书端的现有值，不会被本地数据覆盖。新建排班时采集员留空（飞书端默认无值）。

### 建表

`feishu/table_utils.py` 中 `TABLE_FIELDS` 和 `_ensure_table_fields()` 自动处理新字段的创建/补全。

## 事件分发路由

### 事件携带

`feishu_source.py` 和 `local_source.py` 的 `base_info` 字典新增 `collector` 字段：

```python
base_info = {
    ...
    "collector": sch["collector"] or "",
}
```

### 路由规则（dispatch.py `_get_targets_for_event`）

```
有 group_name 且有此组
  ├─ 此组 day_leader/night_leader 非空 → 发给对应 leader （忽略 collector）
  ├─ 此组 leader 为空，collector 非空    → 发给 collector
  └─ 此组 leader 为空，collector 亦空    → 机型匹配
无 group_name
  ├─ collector 非空                    → 发给 collector
  ├─ collector 为空，机型匹配成功        → 发给匹配组 leader
  └─ collector 为空，匹配失败            → 发给所有组 leader（现有回退）
```

机型匹配：任务已排到具体机器，用该机器的 `type`（如 BR2）。查询 `machines` 表中同机型且有 `group_name` 的机器所属的分组，取这些分组的 leader 并去重。按当前班次（白/夜）筛选。

## 改动清单

| 层 | 文件 | 改动 |
|----|------|------|
| DB | `db.py` | `ALTER TABLE schedules ADD COLUMN collector` |
| 建表 | `feishu/table_utils.py` | TABLE_FIELDS 加采集员，USER_FIELDS 加"采集员" |
| 拉取 | `feishu/schedule_sync.py` | `_apply_pull_changes()` 解析采集员字段，写入 schedules.collector |
| 推送 | `feishu/schedule_sync.py` | 无需改动 |
| 事件源 | `feishu_source.py` + `local_source.py` | JOIN 加 s.collector，base_info 加 collector |
| 分发 | `feishu/events/dispatch.py` | `_get_targets_for_event()` 六分支路由 |
| 前端 | — | 无需改动（纯飞书侧操作） |

## 非功能需求

- 审计：暂不实现，本地只存当前值
- 兼容：旧排班 collector 默认为空字符串，不影响现有逻辑
