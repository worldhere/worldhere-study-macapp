# 修复无分组事件的小组长推送路由

**日期**: 2026-06-04
**状态**: 已确认

---

## 1. 问题

`_get_targets_for_event()` 依赖 `event.group_name` 查找对应分组的 leader。`shift_report`（班次报告）和 `package_complete`（任务包完成）事件不携带 `group_name`，导致 leader 目标列表永远为空——前端矩阵的"发给小组长"开关形同虚设。

## 2. 修复

**只改一个函数**：`feishu/events/dispatch.py` 的 `_get_targets_for_event()`。

当 `group_name` 为空时，不再让 `day_leader` / `night_leader` 为空，改为查询**所有分组的当前班次 leader**，按 open_id 去重。后续逻辑完全不动。

### 核心 diff

```python
# 第 83-91 行
group_row = None
if group_name:
    group_row = conn.execute(
        "SELECT day_leader, night_leader FROM groups WHERE name=?",
        (group_name,)
    ).fetchone()

if group_row:
    day_leader = group_row["day_leader"] or ""
    night_leader = group_row["night_leader"] or ""
elif not group_name:
    # 无分组归属 → 收集所有分组的当前班次 leader，按 open_id 去重
    all_rows = conn.execute(
        "SELECT day_leader, night_leader FROM groups"
    ).fetchall()
    day_set, night_set = set(), set()
    for r in all_rows:
        for lid in (r["day_leader"] or "").split(","):
            lid = lid.strip()
            if lid:
                day_set.add(lid)
        for lid in (r["night_leader"] or "").split(","):
            lid = lid.strip()
            if lid:
                night_set.add(lid)
    day_leader = ",".join(sorted(day_set))
    night_leader = ",".join(sorted(night_set))
else:
    # group_name 有值但 DB 中没有对应行
    day_leader = ""
    night_leader = ""
```

### 行为变化

| 场景 | 改前 | 改后 |
|------|------|------|
| 有 `group_name` 的事件 | 找对应分组 leader | **不变** |
| 无 `group_name` 的事件 | leader 目标为空 | 找所有分组的当前班次 leader（去重） |
| 无 `group_name` 且所有分组都没配 leader | 空 | 空（不影响） |

## 3. 不在范围内

- 默认开关不变（`shift_report` 和 `package_complete` 维持 `leader: false`）
- 前端矩阵 UI 不改
- API 不改
- 卡片模板不改（用现有模板即可）
