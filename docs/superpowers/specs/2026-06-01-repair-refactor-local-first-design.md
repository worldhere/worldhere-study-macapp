# 维修模块重构：本地为主、飞书为客

## 目标

将维修起止逻辑收归到本地系统，飞书异常标记变更不再直接写 `repair_log`，而是调用与手动按钮完全相同的本地函数。确保维修记录格式统一、流程一致，消除双写源头导致的多段短修理问题。

## 当前架构（问题所在）

```
飞书 pull ──▶ _handle_exception_events() ──▶ INSERT/UPDATE repair_log (strftime格式)
                                                     │
手动按钮 ──▶ set_machine_status()            ──▶ INSERT/UPDATE repair_log (isoformat格式)
                                                     │
                                              repair_log 表（两种格式共存）
```

两个入口各自实现了一套维修起止逻辑，导致：
1. **时间格式不一致**：isoformat vs strftime
2. **逻辑不统一**：手动入口有 auto_extend + 返回 repair_info，飞书入口缺返回值和一些边界检查
3. **飞书入口绕过本地一切守卫**：不检查 `old_status`，直接 UPDATE + INSERT

## 目标架构

```
飞书 pull ──▶ _handle_exception_events() ──▶ start_repair() / end_repair()
                                                     │
手动按钮 ──▶ set_machine_status()            ──▶ start_repair() / end_repair()
                                                     │
                                              repair_log 表（唯一格式）
```

## 详细设计

### 1. 提取共享函数 `start_repair()` / `end_repair()`

在 `utils.py` 中新增两个函数，作为维修起止的**唯一入口**：

```python
def start_repair(conn, machine_id: int) -> dict:
    """开始维修。返回 repair_info dict。
    调用方负责 conn.commit()。
    要求：调用前 conn 中的 machines.status 已更新为"维修停用"，
         调用方应当已确认 old_status != "维修停用"。
    """
    now = datetime.datetime.now()
    conn.execute(
        "INSERT INTO repair_log (machine_id, start_datetime, created_at) VALUES (?, ?, ?)",
        (machine_id, now.isoformat(timespec="seconds"), now.isoformat(timespec="seconds")),
    )
    repair_id = conn.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]
    return {
        "action": "repair_start",
        "repair_id": repair_id,
        "start_datetime": now.isoformat(timespec="seconds"),
    }


def end_repair(conn, machine_id: int) -> dict:
    """结束维修，并自动延长受影响的任务。返回 repair_info dict。
    调用方负责 conn.commit()。
    要求：调用前 conn 中的 machines.status 已更新为非维修状态，
         调用方应当已确认 old_status == "维修停用"。
    """
    open_repair = conn.execute(
        "SELECT id, start_datetime FROM repair_log WHERE machine_id=? AND end_datetime IS NULL ORDER BY id DESC LIMIT 1",
        (machine_id,),
    ).fetchone()
    if not open_repair:
        return {"action": "repair_end_no_start", "msg": "维修无开始时间，本次不记录"}

    now = datetime.datetime.now()
    conn.execute(
        "UPDATE repair_log SET end_datetime=? WHERE id=?",
        (now.isoformat(timespec="seconds"), int(open_repair["id"])),
    )
    start_dt = datetime.datetime.fromisoformat(open_repair["start_datetime"])
    duration_seconds = (now - start_dt).total_seconds()
    duration_str = format_elapsed(int(duration_seconds // 60))

    repair_info = {
        "action": "repair_end",
        "repair_id": int(open_repair["id"]),
        "start_datetime": open_repair["start_datetime"],
        "end_datetime": now.isoformat(timespec="seconds"),
        "duration": duration_str,
    }

    extended, total_minutes = auto_extend_tasks_after_repair(conn, machine_id, start_dt, now)
    if extended > 0:
        repair_info["auto_extended"] = {"tasks": extended, "total_minutes": total_minutes}

    return repair_info
```

### 2. 改造 `set_machine_status()`（routes/machines.py）

简化为调用共享函数：

```python
@bp.route('/set_machine_status', methods=['POST'])
def set_machine_status():
    d = request.get_json()
    mid = int(d["id"])
    new_status = d["status"]
    conn = get_db()

    old = conn.execute("SELECT status FROM machines WHERE id=?", (mid,)).fetchone()
    if not old:
        conn.close()
        return jsonify({"msg": "机器不存在"})
    old_status = old["status"]

    conn.execute("UPDATE machines SET status=? WHERE id=?", (new_status, mid))

    repair_info = None

    if new_status == "维修停用" and old_status != "维修停用":
        repair_info = start_repair(conn, mid)

    elif old_status == "维修停用" and new_status != "维修停用":
        repair_info = end_repair(conn, mid)

    conn.commit()
    conn.close()

    response = {"msg": "状态已更新"}
    if repair_info:
        response["repair"] = repair_info
    return jsonify(response)
```

### 3. 改造 `_handle_exception_events()`（feishu_sync.py）

删除直接写库逻辑，改为调共享函数：

```python
def _handle_exception_events(machine_id, machine_name, events):
    if not events:
        return

    conn = get_db()
    for event in events:
        exception = event["exception"]

        if exception in ("机器故障", "缺少物料"):
            machine = conn.execute(
                "SELECT status FROM machines WHERE id=?", (machine_id,)
            ).fetchone()
            if machine and machine["status"] != "维修停用":
                conn.execute("UPDATE machines SET status='维修停用' WHERE id=?", (machine_id,))
                start_repair(conn, machine_id)
                conn.commit()

        elif exception == "无法执行":
            schedule_id = event["schedule_id"]
            schedule = conn.execute(
                "SELECT date, task_id FROM schedules WHERE id=?", (schedule_id,)
            ).fetchone()
            if schedule:
                recycle_schedules(conn, schedule_ids=[schedule_id])
                conn.commit()
                normalize_machine_schedule(conn, schedule["date"], machine_id)
                conn.commit()

        elif exception == "正常":
            machine = conn.execute(
                "SELECT status FROM machines WHERE id=?", (machine_id,)
            ).fetchone()
            if machine and machine["status"] == "维修停用":
                conn.execute("UPDATE machines SET status='空闲' WHERE id=?", (machine_id,))
                end_repair(conn, machine_id)
                conn.commit()

    conn.close()
```

### 4. 顺便修 exception_events 收集 bug

`_apply_pull_changes()` 第 1119 行当前逻辑每次 sync 都会对每个非正常异常产生事件，不管异常是否真的变了。加变化检测：

```python
# 改前：
if exception and exception != "正常":
    exception_events.append({...})

# 改后：
if exception and exception != "正常" and exception != local_exc:
    exception_events.append({...})
```

这样只有异常标记真正发生变化的 sync 才会触发维修操作，不再每 30 秒重复触发。

### 5. 推送方向（已有，无需改动）

`push_machine_schedules()` 已从本地 `repair_log` 计算"异常耗时"字段并推回飞书。维修后的状态（空闲/维修停用）通过 `compute_task_statuses()` 反映在各任务的状态字段中。不需要额外改动。

## 影响范围

| 文件 | 改动类型 |
|------|---------|
| `utils.py` | 新增 `start_repair()`、`end_repair()` |
| `routes/machines.py` | `set_machine_status()` 简化为调共享函数 |
| `feishu_sync.py` | `_handle_exception_events()` 改调共享函数；`_apply_pull_changes()` 修 event 收集 bug |

## 不变的部分

- `repair_log` 表结构不变
- `auto_extend_tasks_after_repair()` 不变
- 前端按钮和 UI 不变
- 飞书 push 逻辑不变
- "无法执行"异常回收逻辑不变

## 风险

- **低**：共享函数是纯提取，不改变业务逻辑
- **低**：两个调用方已各自处理好 status 更新和 commit，共享函数只负责 repair_log 写入
