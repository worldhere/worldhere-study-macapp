# 进行中维修的异常耗时计算修复

## 问题

`overlap_minutes()` 的 docstring 写明 `b_end=None` 表示"持续至今"，但代码实际用了 `a_end`（schedule 结束时间）。导致进行中的维修段计算出的异常耗时被任务时长"撑大"，并且污染了所有未来待开始任务。

## 根因

`utils.py:595`：
```python
o_end = min(a_end, b_end) if b_end is not None else a_end  # 错：用了 a_end 而非 now
```

## 修复

```python
o_end = min(a_end, b_end) if b_end is not None else min(a_end, _dt.datetime.now())
```

`import datetime as _dt` 已在函数体第 592 行存在，无需新增 import。

## 影响分析

| 场景 | 改前 | 改后 |
|------|------|------|
| 已结束维修 + 已过去任务 | 正常 | 不变 |
| 进行中维修 + 进行中任务 | schedule_end - repair_start（偏大） | now - repair_start（实际） |
| 进行中维修 + 未来任务 | schedule_end - repair_start（不应该有） | 0 |
| 多段维修合计 | 旧段正确 + 新段偏大 = 总偏大 | 旧段正确 + 新段按实际 = 正确 |

## 调用链

```
push_machine_schedules() [feishu_sync.py]
  → _get_repair_for_schedule() [models.py:208]
    → overlap_minutes() [utils.py:595]  ← 修复点
```

仅此一处调用 `overlap_minutes`，无其他影响。

## 不变

- repair_log 表结构不变
- 已结束维修的计算不变
- 飞书 push/pull 逻辑不变
