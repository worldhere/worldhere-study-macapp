# 飞书机器分组表 & 代码拆分重构 设计文档

日期：2026-06-02

## 1. 背景与目标

当前 golden 项目的飞书同步模块（`feishu_sync.py`）已接近 2000 行，承载了排班表同步、机器配置表同步、后台循环、状态聚合等全部职责。随着卡片推送等新功能即将加入，需要在飞书端创建更多持久化总表，代码结构需要拆分以保持可维护性。

**本次目标：**

1. 飞书新建「机器分组表」——类似「机器配置表」，是一张不被 init/cleanup 删除的持久化总表
2. 本地新增 `groups` 表，管理分组名、白班负责人、夜班负责人、备注
3. 机器配置表字段修正：「分组」→「机型」，新增「分组名」
4. `feishu_sync.py` 拆分为 `feishu/` 包，各模块职责清晰

## 2. 本地数据库变更

### 2.1 新增 `groups` 表

```sql
CREATE TABLE groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,            -- 分组名
    day_leader TEXT NOT NULL DEFAULT '',   -- 白班负责人 open_id
    night_leader TEXT NOT NULL DEFAULT '', -- 夜班负责人 open_id
    remark TEXT NOT NULL DEFAULT ''        -- 备注
);
```

### 2.2 现有表不变

- `machines.group_name` 已存在，语义上引用 `groups.name`
- `machines.group_name` 仍需保留（用于机器配置表同步和前端筛选）

### 2.3 种子数据

首次建表时，从现有 `machines.group_name` 去重自动生成初始分组记录，负责人和备注为空。

## 3. 飞书端变更

### 3.1 新建「机器分组表」

| 字段名 | 类型 | ui_type | 说明 |
|--------|------|---------|------|
| 分组名 | Text (1) | Text | 主标识，与本地 `groups.name` 对应 |
| 白班负责人 | User (11) | User | 飞书人员字段，API 返回 open_id |
| 夜班负责人 | User (11) | User | 飞书人员字段，API 返回 open_id |
| 备注 | Text (1) | Text | 说明文字 |

- 表名：`机器分组表`
- 加入白名单（init/cleanup 不删）
- 建表逻辑与 `ensure_machine_config_table()` 同模式

### 3.2 机器配置表字段改造

| 旧 | 新 | 说明 |
|----|-----|------|
| 分组 | 机型 | 原本字段实际存的是 BR1/BR2/Mini，现正名 |
| — | 分组名 | 新增字段，引用分组表的「分组名」 |

### 3.3 白名单更新

```python
WHITELIST_TABLES = {MACHINE_CONFIG_TABLE, GROUPS_TABLE}
```

init 扫表时跳过白名单，cleanup 删表时跳过白名单。

## 4. 代码拆分：feishu/ 包

### 4.1 模块列表

```
feishu/
├── __init__.py          → 对外统一出口，re-export 所有公共 API
├── common.py            → API 请求（_feishu_request/_feishu_data/_feishu_raw）、
│                          token 管理、批处理（_batch_create/update/delete_records）、
│                          常量（APP_TOKEN、BASE_URL、WHITELIST_TABLES）
├── table_utils.py       → 建表（_create_table）、查表（_find_table_by_name、
│                          _fetch_all_tables_snapshot、_lookup_table_name）、
│                          字段管理（ensure_table_fields、_build_exception_options_property）、
│                          表定义（TABLE_FIELDS）
├── schedule_sync.py     → 排班推送（push_machine_schedules）、拉取
│                          （_apply_pull_changes、_pull_one_machine）、
│                          状态计算（compute_task_statuses）、排序（_sort_by_priority）、
│                          时间工具（_date_min_to_timestamps、_parse_feishu_datetime_for_pull）
├── config_table.py      → 机器配置表：字段定义、建表（ensure_machine_config_table）、
│                          推送（push_machine_config）
├── groups.py            → 【新】机器分组表：字段定义（GROUPS_TABLE_FIELDS）、
│                          建表（ensure_groups_table）、同步（sync_groups）
├── init_engine.py       → incremental_init、_incremental_init_impl
├── status.py            → get_sync_status、事件缓冲区（write_event）、
│                          active_operation 管理
├── lifecycle.py         → on_machine_created/renamed/deleted 钩子
└── sync_loop.py         → 后台同步线程（_sync_loop、start_pull_thread、
│                          stop_pull_thread）、_async_init/push/pull/toggle_on、
│                          降级策略
```

### 4.2 依赖规则

- 各业务模块（schedule_sync、config_table、groups、init_engine、status、lifecycle、sync_loop）**只依赖 common.py**
- `__init__.py` 从各模块 import 并 re-export
- 业务模块之间**不交叉 import**
- `routes/feishu.py` import 路径从 `feishu_sync` 改为 `feishu`

### 4.3 公共部分（common.py）

从 `feishu_sync.py` 提取以下内容到 `common.py`：

- `_session`、`BASE_URL`、`APP_TOKEN`
- `_feishu_data`、`_feishu_raw`、`_feishu_request`
- `_batch_create_records`、`_batch_update_records`、`_batch_delete_records`
- 白名单管理：`WHITELIST_TABLES` 集合
- `BATCH_SIZE`、`ROW_LIMIT` 等常量

## 5. 分组表同步策略

### 5.1 整体模式：混合方向同步

- **分组名 & 分组内机器列表 → 本地为准**，推送到飞书
- **负责人（白班/夜班）→ 飞书为准**，拉取到本地

### 5.2 sync_groups() 流程

```
sync_groups()
  1. 拉飞书「机器分组表」全量记录
  2. 构建本地快照：
     a. 分组名列表（SELECT name FROM groups ORDER BY name）
     b. 每个分组下的机器列表（SELECT name FROM machines WHERE group_name=? ORDER BY name）
  3. 构建飞书快照：
     a. 分组名列表
     b. 每条记录的字段值（分组名、负责人）
  4. 判断分支：
     ├─ 分组名列表不同 或 某分组内机器列表不同
     │   → 清空飞书「机器分组表」所有记录
     │   → 全量推送本地分组数据（分组名 + 备注）
     │   → 负责人字段留空（等飞书端填写后下拉）
     │   → 不清除本地负责人数据（保留上次从飞书拉到的值）
     │
     └─ 分组名及机器列表完全一致
         → 只拉取负责人字段
         → 飞书每条记录的「白班负责人」「夜班负责人」写回本地
         → groups.day_leader / night_leader 以飞书为准
```

### 5.3 User 字段解析

飞书 User 字段在 API 中返回格式为 `[{"id": "ou_xxx", "name": "张三", ...}]`。pull 时提取 `id`（open_id）存入本地 `groups.day_leader` / `night_leader`。

### 5.4 调用时机

- `sync_loop` 后台每轮循环自动执行
- 机器分组发生变更时（新增/删除/重命名分组，机器改组）立即触发 `sync_groups()`
- 手动操作：前端可触发（后续在 UI 中暴露）

## 6. 机器配置表字段迁移

### 6.1 飞书端

`push_machine_config()` 中字段映射变更：

```python
# 旧
"分组": mc["type"] or "",

# 新
"机型": mc["type"] or "",
"分组名": mc["group_name"] or "",
```

`CONFIG_TABLE_FIELDS` 定义更新为「机型」+「分组名」。`ensure_config_table_fields()` 只补缺字段，不删旧字段，所以已存在的「分组」字段会残留在飞书端——push 不会再写入该字段，用户可在飞书端手动删除旧列。新表直接按新字段定义创建，不存在此问题。

### 6.2 本地

无需变更，`machines.group_name` 和 `machines.type` 字段已存在且语义正确。

## 7. 错误处理

- 飞书 API 调用失败：沿用 `common.py` 的 3 次重试 + 401 自动刷新 token 机制
- 分组表同步失败：不阻断排班同步循环，独立记录错误事件
- 白名单表不存在：init 时自动创建（与 `ensure_machine_config_table()` 同模式）
- groups 表与 machines.group_name 不一致：以 groups 表为准，`machines.group_name` 仅在编辑机器时由用户选择更新

## 8. 前端影响

- 设置面板新增「机器分组」管理区域（后续单独设计）
- 机器编辑对话框的「分组」下拉选项改为从 `groups` 表读取
- 飞书同步 dashboard 新增分组表同步状态（可选）

## 9. 测试要点

- 分组表建表/字段校验
- 分组名变更 → 清空重推
- 机器改组 → 清空重推
- 仅负责人变更 → 不重推，下次 pull 拉回
- cleanup 不删分组表
- 代码拆分后所有现有功能不变（init/push/pull/status toggle）
