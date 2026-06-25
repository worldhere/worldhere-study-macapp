# 修复：修改弹窗修改备注后时间轴任务块和悬浮提示不更新

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修改任务备注后，时间轴上的任务块文字和鼠标悬浮 tooltip 能立即显示更新后的备注。

**Architecture:** 单行服务端修复。`POST /update_task` 更新 `tasks.remark` 后同步更新 `schedules.remark` 时漏掉了 `remark` 字段。时间轴和 tooltip 都从 `schedules` 表读取备注，所以服务端不传播这个字段的话，前端无论怎么刷新都拿不到新值。

**Tech Stack:** Flask + SQLite

---

## 根因分析

数据流：

```
用户编辑备注 → POST /update_task → 更新 tasks.remark ✓
                                  → 更新 schedules (task_name, task_type, task_kind) ← 漏了 remark!

时间轴渲染 → /api/view_schedules → SELECT s.remark FROM schedules → 拿到旧值
```

`routes/tasks.py:229-232` 更新 `schedules` 表时只写了 `task_name, task_type, task_kind`，没有包含 `remark`。对比 `routes/schedule_ops.py:449-452`（`/edit_task` 端点），那里正确地写了 `remark`。

---

### Task 1: 在 `/update_task` 中把 `remark` 同步到 `schedules` 表

**Files:**
- Modify: `routes/tasks.py:229-232`

- [ ] **Step 1: 修改 schedules UPDATE 语句，加入 remark 字段**

`routes/tasks.py` 第 229-232 行，当前代码：

```python
    conn.execute(
        "UPDATE schedules SET task_name=?, task_type=?, task_kind=? WHERE task_id=?",
        (d["name"], d["type"], task_kind, tid),
    )
```

改为：

```python
    conn.execute(
        "UPDATE schedules SET task_name=?, task_type=?, task_kind=?, remark=? WHERE task_id=?",
        (d["name"], d["type"], task_kind, (d.get("remark") or "").strip(), tid),
    )
```

- [ ] **Step 2: 验证修复 — 手动测试**

1. 启动应用，打开排班时间轴
2. 双击某个任务条，打开编辑抽屉
3. 修改备注字段，点击提交
4. 确认：任务条上的备注文字立即更新
5. 鼠标悬浮在任务条上，确认 tooltip 中显示新的备注

- [ ] **Step 3: Commit**

```bash
git add routes/tasks.py
git commit -m "fix: propagate remark to schedules table on task update

POST /update_task was updating tasks.remark but not schedules.remark,
so the timeline blocks and hover tooltips (which read from schedules)
showed stale remark values after editing."
```
