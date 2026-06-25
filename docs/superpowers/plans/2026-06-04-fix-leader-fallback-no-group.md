# 修复无分组事件的小组长推送路由 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 `_get_targets_for_event()` 在事件无 `group_name` 时无法路由到 leader 的问题，改为收集所有分组的当前班次 leader 去重后返回。

**Architecture:** 单函数改动。在 `feishu/events/dispatch.py` 的 `_get_targets_for_event()` 中，将 `if group_name → group_row` 之后的三路分支补齐：有 group_name 且有匹配行（现有逻辑）、有 group_name 但无匹配行（fallthrough）、无 group_name（新增，查所有分组 leader 去重）。后续班次选择 + split + 遍历逻辑完全不动。

**Tech Stack:** Python 3, SQLite (groups 表), 飞书 IM API

---

### Task 1: 修改 `_get_targets_for_event()` 添加 leader fallback

**Files:**
- Modify: `feishu/events/dispatch.py:83-91`

- [ ] **Step 1: 替换 leader 查找逻辑**

将第 83-91 行：

```python
    group_row = None
    if group_name:
        group_row = conn.execute(
            "SELECT day_leader, night_leader FROM groups WHERE name=?",
            (group_name,)
        ).fetchone()

    day_leader = group_row["day_leader"] if group_row else ""
    night_leader = group_row["night_leader"] if group_row else ""
```

替换为：

```python
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
        # group_name 有值但 DB 中无匹配行
        day_leader = ""
        night_leader = ""
```

注意：替换后第 93 行起（`chat_row = ...`）的代码不动。

- [ ] **Step 2: 验证语法正确**

```powershell
python -c "import py_compile; py_compile.compile('feishu/events/dispatch.py', doraise=True); print('OK')"
```

- [ ] **Step 3: 提交**

```bash
git add feishu/events/dispatch.py
git commit -m "fix: leader routing fallback for events without group_name

Events without group_name (shift_report, package_complete) now collect
all groups' current-shift leaders with dedup by open_id, instead of
returning empty leader targets.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
