# 切割命名修正 & 删除条数回收 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复再切割命名叠加问题，删除分段任务时回收 expected_count，删除到仅剩一段时清理命名后缀

**Architecture:** 纯后端改动，三个文件各自独立。`schedule_cut.py` 处理切割重命名，`schedule_ops.py` 和 `tasks.py` 各自处理删除路径的条数回收。两个删除入口共享相同的回收逻辑（下一段优先，前一端未完成可回收，已完成则丢弃）。

**Tech Stack:** Python, Flask, SQLite

---

### Task 1: 切割命名修正 + 整体重编号（`routes/schedule_cut.py`）

**Files:**
- Modify: `routes/schedule_cut.py:62-177`

- [ ] **Step 1: 修改 base_name 和 split_group 的确定逻辑**

替换第 62-63 行：

```python
    split_group = str(uuid.uuid4())
    base_name = task["name"]
```

为：

```python
    import re as _re
    base_name = _re.sub(r'（第[一二三四五六七八九十]+段）$', '', task["name"])
    split_group = task["split_group"] if task["split_group"] else str(uuid.uuid4())
```

- [ ] **Step 2: 在 seg2 插入后、原任务删除前，加入整体重编号逻辑**

在第 131 行 `seg2_tid = cur.lastrowid` 之后、第 133 行 `seg2_sid = None` 之前，插入：

```python
        # 整体重编号：对该 group 内所有段按时间顺序重新分配 split_order 和名称
        all_segs = conn.execute(
            "SELECT id, start_min FROM schedules WHERE task_id IN ("
            "SELECT id FROM tasks WHERE split_group=? AND id != ?"
            ") ORDER BY start_min ASC",
            (split_group, task["id"]),
        ).fetchall()
        # 加上新插入的两段
        new_segs = [(seg1_tid, seg1_start), (seg2_tid, seg2_start)]
        all_segs_data = [(r["id"], r["start_min"]) for r in all_segs] + new_segs
        all_segs_data.sort(key=lambda x: x[1])
        for i, (tid, _) in enumerate(all_segs_data, 1):
            new_order = i
            new_name = base_name + "（第" + _num_to_cn_simple(i) + "段）"
            conn.execute(
                "UPDATE tasks SET split_order=?, name=? WHERE id=?",
                (new_order, new_name, tid),
            )
```

- [ ] **Step 3: 在文件顶部添加 `_num_to_cn_simple` 辅助函数**

在 `bp = Blueprint(...)` 之后插入：

```python
def _num_to_cn_simple(n):
    cn = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"]
    if 1 <= n <= 10:
        return cn[n - 1]
    return str(n)
```

或直接复用 `schedule_ops.py` 中已有的 `_num_to_cn`（需要 import）。

- [ ] **Step 4: 修改 return msg**

将 `result` 中的 msg 从 `"切割完成"` 改为动态拼接：

```python
        # 收集新段名称用于 toast
        seg_names = []
        for tid, _ in [(seg1_tid, seg1_start), (seg2_tid, seg2_start)]:
            row = conn.execute("SELECT name FROM tasks WHERE id=?", (tid,)).fetchone()
            if row:
                seg_names.append("「" + row["name"] + "」")
        result = {
            "msg": "切割完成：已创建 " + " ".join(seg_names),
            "split_group": split_group,
            "created": [
                {"task_id": seg1_tid, "schedule_id": seg1_sid},
                {"task_id": seg2_tid, "schedule_id": seg2_sid},
            ],
        }
```

---

### Task 2: 删除排班时条数回收（`routes/schedule_ops.py` `delete_schedule`）

**Files:**
- Modify: `routes/schedule_ops.py:325-366`

- [ ] **Step 1: 改造 delete_schedule 中的 split_group 处理逻辑**

替换第 345-361 行（当前 split_group 处理块）：

```python
            if task["split_group"] and task["split_order"] is not None:
                group = task["split_group"]
                order = int(task["split_order"])
                exp = task["expected_count"]
                exp_val = int(exp) if exp and int(exp) > 0 else 0

                # 查找回收目标：下一段 / 前一段
                next_task = conn.execute(
                    "SELECT id, name, status, expected_count FROM tasks WHERE split_group=? AND split_order>? ORDER BY split_order ASC LIMIT 1",
                    (group, order),
                ).fetchone()
                prev_task = conn.execute(
                    "SELECT id, name, status, expected_count FROM tasks WHERE split_group=? AND split_order<? ORDER BY split_order DESC LIMIT 1",
                    (group, order),
                ).fetchone()

                recovered_to = None
                if next_task:
                    # 有下一段 → 条数加到下一段
                    new_exp = (int(next_task["expected_count"]) if next_task["expected_count"] else 0) + exp_val
                    conn.execute("UPDATE tasks SET expected_count=? WHERE id=?", (new_exp, next_task["id"]))
                    recovered_to = next_task["name"]
                elif prev_task and prev_task["status"] != "已完成":
                    # 无下一段，前一段未完成 → 加到前一段
                    new_exp = (int(prev_task["expected_count"]) if prev_task["expected_count"] else 0) + exp_val
                    conn.execute("UPDATE tasks SET expected_count=? WHERE id=?", (new_exp, prev_task["id"]))
                    recovered_to = prev_task["name"]

                # 对剩余段重新编号
                higher = conn.execute(
                    "SELECT id, name, split_order FROM tasks WHERE split_group=? AND split_order>? ORDER BY split_order ASC",
                    (group, order),
                ).fetchall()
                for t in higher:
                    new_order = int(t["split_order"]) - 1
                    new_name = re.sub(r'（第\d+段）', '（第' + _num_to_cn(new_order) + '段）', t["name"])
                    if '（第' not in new_name:
                        new_name = new_name + '（第' + _num_to_cn(new_order) + '段）'
                    conn.execute(
                        "UPDATE tasks SET split_order=?, name=? WHERE id=?",
                        (new_order, new_name, int(t["id"])),
                    )

                # 仅剩一段时去掉后缀
                remaining = conn.execute(
                    "SELECT COUNT(*) AS c, MIN(id) AS sole_id FROM tasks WHERE split_group=?",
                    (group,),
                ).fetchone()
                if remaining and remaining["c"] == 1:
                    sole = conn.execute("SELECT id, name FROM tasks WHERE id=?", (remaining["sole_id"],)).fetchone()
                    if sole:
                        clean_name = re.sub(r'（第[一二三四五六七八九十]+段）$', '', sole["name"])
                        conn.execute("UPDATE tasks SET name=? WHERE id=?", (clean_name, sole["id"]))
```

- [ ] **Step 2: 传递回收信息到响应 msg**

删除原任务后，修改 `return jsonify` 行，将 `recovered_to` 和 `exp_val` 信息加入 msg：

```python
    # 在 conn.execute("DELETE FROM tasks WHERE id=?", (tid,)) 之后
    conn.execute("DELETE FROM schedules WHERE id=?", (sid,))
    conn.commit()
    conn.close()

    if recovered_to and exp_val > 0:
        return jsonify({"msg": "已删除，" + str(exp_val) + " 条数据已回收至「" + recovered_to + "」", "log_id": log_id, "task_id": tid})
    return jsonify({"msg": "已删除", "log_id": log_id, "task_id": tid})
```

注意：需要将 `recovered_to` 和 `exp_val` 变量的声明移到 `if task["split_group"]` 块之外（初始化为 None/0），以便在函数末尾访问。

---

### Task 3: 删除任务时条数回收（`routes/tasks.py` `del_task`）

**Files:**
- Modify: `routes/tasks.py:238-254`

- [ ] **Step 1: 在 del_task 中添加 split_group 处理**

在 `routes/tasks.py` 顶部添加 import：

```python
import re
```

替换 `del_task` 函数体（第 238-254 行）：

```python
@bp.route('/del_task/<int:tid>')
def del_task(tid):
    conn = get_db()
    row = conn.execute("SELECT * FROM tasks WHERE id=?", (tid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"msg": "任务不存在"})
    record_json = json.dumps(dict(row), ensure_ascii=False)
    conn.execute(
        "INSERT INTO deletion_log(deleted_at, table_name, record_id, record_json) VALUES (?,?,?,?)",
        (datetime.datetime.now().isoformat(timespec="seconds"), "tasks", tid, record_json),
    )

    recovered_to = None
    exp_val = 0

    if row["split_group"] and row["split_order"] is not None:
        group = row["split_group"]
        order = int(row["split_order"])
        exp = row["expected_count"]
        exp_val = int(exp) if exp and int(exp) > 0 else 0

        # 查找回收目标
        next_task = conn.execute(
            "SELECT id, name, status, expected_count FROM tasks WHERE split_group=? AND split_order>? ORDER BY split_order ASC LIMIT 1",
            (group, order),
        ).fetchone()
        prev_task = conn.execute(
            "SELECT id, name, status, expected_count FROM tasks WHERE split_group=? AND split_order<? ORDER BY split_order DESC LIMIT 1",
            (group, order),
        ).fetchone()

        if next_task:
            new_exp = (int(next_task["expected_count"]) if next_task["expected_count"] else 0) + exp_val
            conn.execute("UPDATE tasks SET expected_count=? WHERE id=?", (new_exp, next_task["id"]))
            recovered_to = next_task["name"]
        elif prev_task and prev_task["status"] != "已完成":
            new_exp = (int(prev_task["expected_count"]) if prev_task["expected_count"] else 0) + exp_val
            conn.execute("UPDATE tasks SET expected_count=? WHERE id=?", (new_exp, prev_task["id"]))
            recovered_to = prev_task["name"]

    conn.execute("DELETE FROM tasks WHERE id=?", (tid,))

    if row["split_group"] and row["split_order"] is not None:
        # 对剩余段重新编号
        higher = conn.execute(
            "SELECT id, name, split_order FROM tasks WHERE split_group=? AND split_order>? ORDER BY split_order ASC",
            (row["split_group"], int(row["split_order"])),
        ).fetchall()
        for t in higher:
            new_order = int(t["split_order"]) - 1
            new_name = re.sub(r'（第\d+段）', '（第' + _num_to_cn(new_order) + '段）', t["name"])
            if '（第' not in new_name:
                new_name = new_name + '（第' + _num_to_cn(new_order) + '段）'
            conn.execute(
                "UPDATE tasks SET split_order=?, name=? WHERE id=?",
                (new_order, new_name, int(t["id"])),
            )

        # 仅剩一段时去掉后缀
        remaining = conn.execute(
            "SELECT COUNT(*) AS c, MIN(id) AS sole_id FROM tasks WHERE split_group=?",
            (row["split_group"],),
        ).fetchone()
        if remaining and remaining["c"] == 1:
            sole = conn.execute("SELECT id, name FROM tasks WHERE id=?", (remaining["sole_id"],)).fetchone()
            if sole:
                clean_name = re.sub(r'（第[一二三四五六七八九十]+段）$', '', sole["name"])
                conn.execute("UPDATE tasks SET name=? WHERE id=?", (clean_name, sole["id"]))

    conn.execute("DELETE FROM schedules WHERE task_id=?", (tid,))
    conn.commit()
    conn.close()

    if recovered_to and exp_val > 0:
        return jsonify({"msg": "已删除，" + str(exp_val) + " 条数据已回收至「" + recovered_to + "」"})
    return jsonify({"msg": "删除成功，可在删除记录中恢复"})
```

- [ ] **Step 2: 确认 `_num_to_cn` 可用**

`tasks.py` 需要 `_num_to_cn` 函数。该函数在 `schedule_ops.py` 中定义。需要将其提取到共享位置或复制到 `tasks.py`。

在 `routes/tasks.py` 顶部（import 区域之后）添加：

```python
def _num_to_cn(n):
    cn = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"]
    if 1 <= n <= 10:
        return cn[n - 1]
    return str(n)
```

---

### Task 4: 验证

- [ ] **Step 1: 启动服务**

```bash
python app.py
```

- [ ] **Step 2: 测试首次切割命名**

1. 在排班面板找一个未分段任务，执行切割
2. 验证两个新任务命名为 `XXX（第一段）` 和 `XXX（第二段）`
3. toast 提示 `切割完成：已创建「XXX（第一段）」「XXX（第二段）」`

- [ ] **Step 3: 测试再切割命名**

1. 对 `XXX（第二段）` 再次切割
2. 验证三段命名为 `XXX（第一段）` `XXX（第二段）` `XXX（第三段）`
3. 不应出现 `XXX（第二段）（第一段）`

- [ ] **Step 4: 测试删除条数回收**

1. 给三段任务分别设置 expected_count（如 30/30/40）
2. 从时间轴删除第二段
3. 验证第三段的 expected_count 增加 30 → 70
4. toast 提示条数已回收

- [ ] **Step 5: 测试前一段已完成时不回收**

1. 第一段标记完成，第二段有 50 条
2. 删除第二段
3. 验证第一段条数不变
4. toast 提示 `已删除`

- [ ] **Step 6: 测试仅剩一段清后缀**

1. 删除到只剩一段
2. 验证名称后缀 `（第X段）` 被清除

- [ ] **Step 7: 测试任务库删除**

1. 从任务库删除一个分段任务
2. 验证条数回收和重编号同样生效
