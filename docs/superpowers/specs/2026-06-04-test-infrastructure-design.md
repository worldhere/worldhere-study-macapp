# 测试基础设施设计

## 背景

当前项目零测试基础设施：没有 pytest、没有 seed 数据、没有 conftest。每次改动后靠手工操作 + 等 30 秒同步循环验证，反馈慢且不可重复。

架构优化（`push_events.py` → `feishu/events/`）完成后，现在是为核心模块建立回归测试的最佳时机。

## 目标

建立可重复、一键运行的测试体系，覆盖核心数据变更路径和事件检测逻辑。每次改动后跑 `pytest` 即可知道旧功能是否正常、新功能是否能运行。

## 技术选型

- **pytest** — Python 测试事实标准
- **真实 SQLite DB 做 fixture** — 从开发环境拷一份 test.db，测试跑在真实数据上
- **mock 飞书 HTTP + IM** — 不调真实 API，毫秒级反馈

## 文件结构

```
tests/
├── conftest.py            # 共享 fixture：app + db + mock_feishu
├── data/
│   └── test.db            # 从开发环境 DB 拷贝（git 追踪）
├── test_schedule_ops.py   # 完成/撤销/逾期确认/批量操作
├── test_events_feishu.py  # feishu_source：7 个检测器
├── test_events_local.py   # local_source：场景 10-11 + 补发
├── test_dispatch.py       # 派发引擎：开关/去重/合并
├── test_sync_push.py      # push：diff 计算、字段映射、快照
└── test_sync_pull.py      # pull：字段回写、状态联动、异常处理
```

## conftest.py — 共享 Fixture

### `app` fixture

- 设置环境变量 `TASK_SCHEDULE_DB_PATH` 指向临时测试 DB
- 创建 Flask test client
- 作用域：`function`（每个测试独立）

### `db` fixture

- 从 `tests/data/test.db`（只读模板）复制到临时文件
- 每次测试前执行复制，测试对临时文件读写
- 测试结束后自动清理临时文件
- 保证测试之间完全隔离，互相不污染

### `mock_feishu` fixture

- `unittest.mock.patch` 拦截 `feishu.common._feishu_request`
- `unittest.mock.patch` 拦截 `feishu.common.send_im_message`
- `unittest.mock.patch` 拦截 `feishu.common.send_im_message_to_user`
- 返回预定义的成功响应
- 作用域：`function`，自动在测试结束时恢复

### 依赖安装

需要新增 `pytest` 依赖（项目中当前无 requirements.txt）。

## Mock 策略

| 层 | Mock？ | 原因 |
|---|---|---|
| `feishu.common._feishu_request` | ✅ Mock | 所有飞书 API 调用（读表/写表/删表） |
| `feishu.common.send_im_message` | ✅ Mock | 群消息发送 |
| `feishu.common.send_im_message_to_user` | ✅ Mock | 私信发送 |
| SQLite | ❌ 真实 | 核心业务逻辑依赖，必须真跑 |
| 所有业务逻辑函数 | ❌ 真实 | 检测器、diff、卡片构建 |
| Flask test client | ❌ 真实 | 端点测试走完整 HTTP 栈 |

Mock 在 conftest 中全局生效，各测试文件无需手动设置。

## 测试模块

### 1. `test_schedule_ops.py` — 数据变更端点

覆盖最近修改的 `actual_end_min` 逻辑，防止回归。

```
完成操作
  ✓ complete_task 普通完成 → status=completed, actual_end_min 非空
  ✓ complete_task 拆分完成 → 同上
  ✓ complete_task sch=None 时 fallback 查询 date
  ✓ batch_tasks complete → 所有排班 actual_end_min 非空 + completed_at 设置
  ✓ finish_task → 同上
  ✓ 重复完成同一排班 → 幂等
  ✓ 跨天完成 → actual_end_min 相对 schedule.date 零点

撤销操作
  ✓ uncomplete_task → status=executing, actual_end_min=NULL
  ✓ 已完成排班撤销 → 状态回 executing
  ✓ 非完成状态撤销 → 不意外改数据

逾期确认
  ✓ confirm_overdue → actual_end_min + completed_at 都被设置
  ✓ confirm_overdue 多排班 → 每个独立计算 actual_end_min

批量操作
  ✓ 批量完成时部分排班已不存在 → 不崩溃，剩余继续
```

### 2. `test_events_feishu.py` — 飞书事件源检测器

每个场景一个测试类，用构造的飞书记录 dict 作为输入。

```
场景 1: 即将开始
  ✓ 距开始 10 分钟 → 触发 task_impending_start
  ✓ 已有人开始（actual_start_min 已填）→ 不触发
  ✓ 状态已是已完成 → 不触发
  ✓ start_min 为 None → 不触发

场景 2+3: 实际开始
  ✓ actual_start_min 被填 + data_changed → 触发双发
  ✓ 提早填写（actual_start < start）→ 带 early_fill=True
  ✓ data_changed=False → 不触发

场景 4: 排班时间变动
  ✓ 首次看到 → 只写基线，不触发事件
  ✓ 值与基线不同 → 触发 schedule_changes
  ✓ 值与基线相同 → 不触发
  ✓ 旧值为非法 JSON → 不崩溃

场景 5: 异常开始
  ✓ 异常标记非正常 + 排班活跃 → 触发 exception_start
  ✓ 异常标记非正常 + 排班未活跃 → 不触发

场景 5b: 异常备注补充
  ✓ 已发过异常开始 + 原因没变 + 有备注 → 触发 exception_update
  ✓ 未发过异常开始 → 不触发

场景 6: 异常恢复
  ✓ 标记变正常 + 之前有异常记录 → 触发 exception_end
  ✓ 之前无异常记录 → 不触发

场景 7: 即将结束
  ✓ 同场景 1 逻辑，检查 end_min

场景 8+9: 实际结束
  ✓ 同场景 2+3 逻辑，检查 actual_end_min

快照短路
  ✓ data_changed=False → 变更类场景（2-6, 8-9）跳过
  ✓ data_changed=True → 时间类场景（1, 7）永远执行

过滤链路
  ✓ 飞书记录无对应 schedule_id → 跳过
  ✓ schedule.date > 今天 → 跳过（未来排班）
  ✓ 排班不属当前班次 → 跳过
  ✓ 机器无任何 record_mapping → 整机跳过

批量场景
  ✓ 一台机器多条排班 → 各自独立检测
  ✓ 空输入 → 返回空列表不崩溃
```

### 3. `test_events_local.py` — 本地事件源检测器

```
补发 exception_start
  ✓ 活跃排班有异常标记 + push_log 无记录 → 补发
  ✓ push_log 已有记录 → 不重复

补发 task_confirm_start
  ✓ 活跃排班有 actual_start + push_log 无记录 → 补发
  ✓ push_log 已有记录 → 不重复

补发 task_confirm_end
  ✓ 已完成排班有 actual_end + push_log 无记录 → 补发
  ✓ push_log 已有记录 → 不重复

补发 task_recycled
  ✓ push_log 中有 success=0 的回收记录 → 补发
  ✓ 回收记录为非法 JSON → 跳过不崩溃
  ✓ 无待补发记录 → 返回空

场景 10: 任务包完成
  ✓ 所有排班完成 → 触发 package_complete
  ✓ 仍有未完成排班 → 不触发
  ✓ 任务包存在但无排班 → 不触发
  ✓ 无任务包 → 不触发

场景 11: 班次报告
  ✓ 在白班触发窗口内 → 只发白班报告
  ✓ 在夜班触发窗口内 → 只发夜班报告
  ✓ 不在任何窗口内 → 不发

无数据场景
  ✓ 今天+昨天无可检测排班 → 返回空列表
```

### 4. `test_dispatch.py` — 派发引擎

```
开关过滤
  ✓ leader 开 group 关 → 只发 leader
  ✓ leader 关 group 开 → 只发 group
  ✓ 都关 → 不发送

去重
  ✓ 相同 dedup_key + 相同 notify_value → 跳过
  ✓ 相同 dedup_key + 不同 notify_value → 发送
  ✓ 从未发过 → 发送

提醒合并
  ✓ 多条提醒同一目标 → build_merged_reminder_card 被调用
  ✓ 单条提醒 → build_reminder_card 被调用

边界
  ✓ 空事件列表 → 不崩溃
  ✓ 事件无 group_name → leader 回退逻辑正常
  ✓ leader_id 逗号分隔多人 → 各自发送
  ✓ 无 chat_ids 配置 → group 目标为空不崩溃

开关配置
  ✓ DB 中 event_toggles 缺失某 key → DEFAULT_TOGGLES 回退
  ✓ DB 中值为非法 JSON → 使用默认值不崩溃
```

### 5. `test_sync_push.py` — Push 同步

```
字段 diff
  ✓ None vs None → 不 diff
  ✓ "" vs None → 不 diff（空值等价）
  ✓ "" vs 0 → 不 diff（空值等价）
  ✓ 相同值 → 不 diff
  ✓ 不同值 → diff
  ✓ 飞书 DateTime 毫秒 vs 本地 int → 同值不 diff

字段保护
  ✓ USER_FIELDS 飞书端有值 → 不被系统覆盖
  ✓ 修改与同步时间 → 有真实变更时才附带推送

映射管理
  ✓ 新创建的记录 → feishu_record_mapping 写入
  ✓ 删除的记录 → feishu_record_mapping 清理
  ✓ 孤儿记录 → 删除

快照
  ✓ last_push_snapshot 正确更新
  ✓ created 记录快照 = now_ms
  ✓ updated 记录快照 = now_ms
  ✓ deleted 记录从快照移除

动态状态
  ✓ schedule 自己 completed → 状态=已完成
  ✓ 机器维修停用中 → 状态=暂停中/暂停即将超时
```

### 6. `test_sync_pull.py` — Pull 同步

```
Last Write Wins
  ✓ local_modified_at > feishu_ms → 保留本地
  ✓ local_modified_at < feishu_ms → 飞书覆盖
  ✓ local_modified_at = 0 → 接受飞书变更

快照过滤
  ✓ feishu_ms ≤ snap_ms → 系统 push 改的，pull 跳过
  ✓ feishu_ms > snap_ms → 用户编辑的，pull 处理

字段回写
  ✓ 实际开始写入 → actual_start_min 正确
  ✓ 实际结束写入 → actual_end_min 正确 + 状态联动变已完成
  ✓ 实际开始 > 实际结束 → 记录错误不写入
  ✓ 飞书排班时间变动 → 写回 start_min/end_min + 记录漂移窗口
  ✓ 全部排班完成后 → tasks.status 同步变已完成

异常联动
  ✓ "机器故障" + 排班活跃 → 机器变维修停用
  ✓ "缺少物料" + 排班活跃 → 同上
  ✓ "无法执行" → 回收排班 + 自动压实（开关开时）
  ✓ 异常标记变"正常" + 无其他异常排班 → 结束维修
  ✓ 异常标记变"正常" + 还有其他异常 → 维修继续
  ✓ 已完成排班改异常标记 → 只同步数据不触发机器状态变更
  ✓ 异常标记 null/空 → 视为正常
```

## 运行方式

```bash
# 全部测试
pytest tests/ -v

# 只跑事件检测器
pytest tests/test_events_feishu.py tests/test_events_local.py -v

# 只跑一个函数
pytest tests/test_schedule_ops.py::test_complete_task -v

# 只跑失败的（修复后快速验证）
pytest tests/ --lf -v
```

## 缺点 & 改进方向（未来）

- test.db 需要随 schema 变更手动更新
- 飞书 mock 返回固定预设响应，复杂场景（分页、限流）暂不覆盖
- 卡片构建函数暂不在本次范围（纯 JSON 生成，回归风险低）
- 前端 JS 暂不覆盖（需要 Playwright/Selenium，成本高）
