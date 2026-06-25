# 飞书机器表任务字段重设计

**日期**: 2026-06-01
**状态**: 已确认

## 概述

将飞书机器表的任务字段拆分为「排班」「预估」两套概念，改名、加字段、改类型，共 18 字段。

**核心区分**：
- **排班（Scheduled）**：系统实际安排在机器上的时段，会因压实/延后/手动调整而变化
- **预估（Estimated）**：任务本来的预估时段和时长，不随排班变动

## 最终字段清单（18 字段）

| # | 字段名 | 飞书类型 | 方向 | 数据来源 | 说明 |
|---|--------|----------|------|----------|------|
| 1 | 任务名 | 文本 | 系统→飞书 | tasks.name | 不变 |
| 2 | **所属来源** 🆕 | 文本 | 系统→飞书 | task_packages.name | 通过 tasks.package_id 关联，无包时为空 |
| 3 | 任务类型 | 文本 | 系统→飞书 | tasks.type | 不变 |
| 4 | 优先级 | 文本 | 系统→飞书 | tasks.priority | 不变 |
| 5 | 难度 | 文本 | 系统→飞书 | tasks.difficulty | 不变 |
| 6 | **排班开始** 🔄 | DateTime | 双向 | schedules.start_min | 原"预估开始"改名 |
| 7 | **排班结束** 🔄 | DateTime | 双向 | schedules.end_min | 原"预估结束"改名 |
| 8 | **排班时长** 🔄 | 文本 | 系统→飞书 | 系统计算推送 "XhYm" | 原"预估时长"改名，系统每次推送计算值 |
| 9 | 实际开始 | DateTime | 飞书→系统 | schedules.actual_start_min | 不变 |
| 10 | 实际结束 | DateTime | 飞书→系统 | schedules.actual_end_min | 不变 |
| 11 | 状态 | 单选(7选项) | 系统→飞书 | 动态计算 | 新增"待开始"，暂停改为任务级 |
| 12 | 排班备注 | 文本 | 双向 | schedules.remark | 不变 |
| 13 | 异常标记 | 单选(4选项) | 双向 | schedules.exception_mark | 不变 |
| 14 | 异常备注 | 文本 | 双向 | schedules.exception_note | 不变 |
| 15 | **异常耗时** 🆕 | 文本 | 系统→飞书 | 维修记录时长 | 格式 "2h15m" |
| 16 | **预估时段** 🆕 | 文本 | 记录只写 | schedules.estimated_window | 排班漂移前窗口 "06/01 09:00~10:30" |
| 17 | **预估时长** 🆕 | 文本 | 系统→飞书 | 任务预估耗时 | 格式 "1h30m"，优先 est_seconds → 推算 → 空 |
| 18 | **修改与同步时间** 🆕 | DateTime | 系统→飞书 | schedules.updated_at | 该行最后一次同步时间 |

### 变更汇总

| 类型 | 内容 |
|------|------|
| 🔄 改名 | 预估开始→排班开始, 预估结束→排班结束, 预估时长→排班时长 |
| 🔀 改类型 | 排班时长：文本 → 文本（系统推送计算值，后续可改为飞书公式） |
| 🆕 新增 | 所属来源, 异常耗时, 预估时段, 预估时长, 修改与同步时间 |
| ❌ 删除 | _记录ID → 本地映射表替代 |

## 新建字段行为详述

### 所属来源

- 取 schedule 关联的 task 所属任务包名
- 推送时写入，飞书端只读
- 无任务包时为空

### 异常耗时

- 查询该排班时段内重叠的维修记录（复用 `_get_repair_for_schedule`）
- 多条维修记录重叠时合计总时长
- 格式化输出 "XhYm"（用 `format_elapsed`），无重叠时为空
- 推送时写入，飞书端只读

### 预估时段

- 格式：`"MM/dd HH:MM~HH:MM"`，跨天 `"MM/dd HH:MM~MM/dd HH:MM"`
- 初始为空
- 排班开始/结束发生漂移时（压实、手动调整等），记录**变动前**的排班窗口
- 后续每次漂移覆盖前值（记录最近一次变动前的窗口）
- 首次分配不算漂移，不写入
- 飞书端只读，系统单向写入

### 预估时长

- 数据来源优先级：schedules 关联 task 的 `est_seconds` → 自动推算 → 空
- 统一格式化为 "XhYm" 人类可读
- 推送时写入，飞书端只读

### 修改与同步时间

- 取 `schedules.updated_at` 转换为 DateTime
- 全量推送时每行都带（不比较是否变化）
- 反映该行最后一次被系统修改或同步的时间

### 排班时长

- 飞书公式字段：`= 排班结束 - 排班开始`
- 飞书端自动计算，系统不推送此字段
- 若公式效果不佳，后续可改回系统推送

## 状态字段

### 原则

**不再动态计算。** 砍掉 `_compute_dynamic_status`。本地 `schedules.status` 直推飞书，唯一翻译：`"已分配"` → `"待开始"`。

### 选项（4 个）

| 选项 | 颜色 | 对应本地状态 |
|------|------|-------------|
| 待开始 🆕 | 7 | 已分配 |
| 采集中 | 1 | （系统赋值） |
| 暂停中 | 3 | （系统赋值） |
| 已完成 | 6 | completed |

砍掉的动态计算产物：采集即将完成、暂停即将超时、过时待确认。

## 数据库改动

### schedules 表新增字段

```sql
ALTER TABLE schedules ADD COLUMN estimated_window TEXT;
```

已有字段不变：`exception_mark`, `exception_note`, `actual_start_min`, `actual_end_min`, `start_min`, `end_min`, `updated_at`。

### 新增 feishu_record_mapping 表

替代飞书表里的 `_记录ID` 字段，映射关系存本地。

```sql
CREATE TABLE IF NOT EXISTS feishu_record_mapping (
    schedule_id INTEGER PRIMARY KEY,
    machine_id INTEGER NOT NULL,
    feishu_record_id TEXT NOT NULL
);
```

**推送流程**：
- 创建新行 → 飞书返回 `record_id` → 写入此表
- 已存在行 → 通过此表找到 `feishu_record_id` → 更新

**拉取流程**：
- 飞书返回每行的 `record_id` → 通过此表反查 `schedule_id` → 更新本地

## 迁移方案：全量重建

选择方案 A（全量重建），原因：
- 飞书不支持字段类型变更（Text → Formula），原地迁移需删字段，本质上也是半重建
- 系统飞书表本就是全量对比+推送，重建不影响数据一致性
- 用户侧字段（实际时间、异常标记等）从本地 DB 恢复

### 重建流程

1. 删除旧飞书表
2. 用新字段定义建表（18 字段）
3. 写入 `feishu_sync_mapping` 更新 table_id
4. 从本地 schedules 表恢复数据推送到飞书（含用户侧字段）
5. 清理 `feishu_record_mapping` 旧记录，重建新映射

## 字段常量更新

`feishu_sync.py` 的 `TABLE_FIELDS` 常量需更新为 18 字段定义。公式字段示例：

```python
{"field_name": "排班时长", "type": 20, "ui_type": "Formula",
 "property": {
     "formula_expression": "[排班结束]-[排班开始]",
     "formatter": "0.0\"h\""
 }},
```

注意：公式字段的具体 expression 语法需查阅飞书 API 文档确认，若不行则改用系统推送文本。

## SYSTEM_FIELDS / USER_FIELDS 重新划分

```python
SYSTEM_FIELDS = {"任务名", "所属来源", "任务类型", "优先级", "难度",
                 "排班开始", "排班结束", "预估时长", "状态",
                 "异常耗时", "修改与同步时间"}
USER_FIELDS = {"实际开始", "实际结束", "排班备注"}
LOCAL_USER_FIELDS = {"异常标记": "exception_mark", "异常备注": "exception_note",
                     "预估时段": "estimated_window"}
BIDI_FIELDS = {"排班开始", "排班结束", "排班备注", "异常标记", "异常备注"}
```

## 影响文件

| 文件 | 变动 |
|------|------|
| `feishu_sync.py` | TABLE_FIELDS 常量、push 逻辑（去掉 _记录ID、加新字段）、_compute_dynamic_status（加待开始、任务级暂停） |
| `db.py` | schedules 表加 estimated_window 字段 migration、新增 feishu_record_mapping 表 |
| `routes/feishu.py` | init 改为全量重建逻辑 |
| `models.py` | 无需改（_get_repair_for_schedule 已有） |

## 不变项

- `feishu_sync_mapping` 表结构不变
- v2 统一后台线程 30s 全量同步架构不变
- Base/App Token 不变
- 设置页面不变（新字段不涉及配置项）
- 飞书拉取逻辑不变（pull 端字段映射适配新名）

## 边界与限制

- 排班时长公式表达式需查阅飞书 API 文档确认语法，若不支持则回退为系统推送文本
- 全量重建时用户正在飞书端编辑的数据可能短暂丢失（重建间隙），建议在低操作频率时段执行
- 异常耗时为 0 时显示为空而非 "0m"
