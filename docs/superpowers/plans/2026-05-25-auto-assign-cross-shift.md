# 自动分配跨班次支持 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让自动分配支持跨班次——放开 work_end_min 的 1440 硬钳制，find_free_slots 跨日期查询空闲时段

**Architecture:** 后端改 `auto_assign.py` 两个函数（放开钳制 + 跨日期查空闲），API 路由透传参数，前端加一个"允许跨天"复选框。复用已有的 `normalize_machine_schedule` 级联和前端跨天渲染能力。

**Tech Stack:** Python Flask 后端 + Vanilla JS 前端 + SQLite

---

### Task 1: 放开 `work_end_min` 钳制

**Files:**
- Modify: `auto_assign.py:121`

- [ ] **Step 1: 去掉 `min(24 * 60, we)`**

`auto_assign.py` 第 121 行，当前：

```python
we = max(ws + 1, min(24 * 60, we))
```

改为：

```python
we = max(ws + 1, we)
```

- [ ] **Step 2: 验证修改**

```powershell
python -c "import ast; ast.parse(open('auto_assign.py').read()); print('syntax OK')"
```

Expected: `syntax OK`

---

### Task 2: `find_free_slots` 跨日期查询

**Files:**
- Modify: `auto_assign.py:21-44`

- [ ] **Step 1: 重写 `find_free_slots` 支持跨日期**

将 `auto_assign.py` 第 21-44 行的 `find_free_slots` 函数替换为：

```python
def find_free_slots(conn, date: str, machine_id: int, start_min: int, end_min: int) -> List[Tuple[int, int]]:
    """返回指定机器在 [start_min, end_min] 连续时间窗内的空闲时段（支持跨日期）"""
    import datetime as _dt

    base_date = _dt.date.fromisoformat(date)
    start_day = start_min // 1440
    end_day = (end_min - 1) // 1440 if end_min > start_min else start_day

    all_occupied = []
    for day_offset in range(start_day, end_day + 1):
        cur_date = (base_date + _dt.timedelta(days=day_offset)).isoformat()
        rows = conn.execute(
            """
            SELECT start_min, end_min FROM schedules
            WHERE date=? AND machine_id=? AND status!='completed'
            ORDER BY start_min ASC
            """,
            (cur_date, machine_id),
        ).fetchall()
        for r in rows:
            s = int(r["start_min"]) + day_offset * 1440
            e = int(r["end_min"]) + day_offset * 1440
            all_occupied.append((s, e))

    all_occupied.sort(key=lambda x: x[0])

    free = []
    cursor = start_min
    for s, e in all_occupied:
        if s > cursor:
            free.append((cursor, min(s, end_min)))
        cursor = max(cursor, e)
        if cursor >= end_min:
            break
    if cursor < end_min:
        free.append((cursor, end_min))
    return [(a, b) for a, b in free if b - a >= 1]
```

- [ ] **Step 2: 验证语法**

```powershell
python -c "import ast; ast.parse(open('auto_assign.py').read()); print('syntax OK')"
```

Expected: `syntax OK`

---

### Task 3: 分配写入时处理跨天日期

**Files:**
- Modify: `auto_assign.py:182-218`（best_end 计算 + schedule 写入部分）

- [ ] **Step 1: 修改 best_end 计算和写入逻辑**

`auto_assign.py` 第 182-218 行，当前：

```python
        if best_start is not None and best_machine is not None:
            best_end = min(we, best_start + dur_min)
            if extend_over_breaks:
                from models import load_shift_config
                shift_config = load_shift_config()
                best_end = _extend_end_over_breaks(best_start, best_end, date, shift_config)
                best_end = min(we, best_end)

            if not dry_run:
                conn.execute(
                    "DELETE FROM schedules WHERE task_id=?", (tid,),
                )
                conn.execute(
                    """
                    INSERT INTO schedules(date, machine_id, machine_name, task_id,
                    task_name, task_type, task_kind, duration, remark, start_min, end_min,
                    status, created_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                    """,
                    (
                        date,
                        int(best_machine["id"]),
                        best_machine["name"],
                        tid,
                        task_name,
                        task_type,
                        task_kind,
                        task.get("duration") or "",
                        (task.get("remark") or ""),
                        best_start,
                        best_end,
                        "executing",
                        datetime.datetime.now().isoformat(timespec="seconds"),
                    ),
                )
                conn.execute("UPDATE tasks SET status='已分配' WHERE id=?", (tid,))
                normalize_machine_schedule(conn, date, int(best_machine["id"]))
```

改为：

```python
        if best_start is not None and best_machine is not None:
            best_end = best_start + dur_min
            if extend_over_breaks:
                from models import load_shift_config
                shift_config = load_shift_config()
                best_end = _extend_end_over_breaks(best_start, best_end, date, shift_config)

            # 根据 best_start 反推实际日期和日内分钟
            import datetime as _dt_base
            base_dt = _dt_base.date.fromisoformat(date)
            day_offset = best_start // 1440
            actual_date = (base_dt + _dt_base.timedelta(days=day_offset)).isoformat()
            actual_start = best_start - day_offset * 1440
            actual_end = best_end - day_offset * 1440

            if not dry_run:
                conn.execute(
                    "DELETE FROM schedules WHERE task_id=?", (tid,),
                )
                conn.execute(
                    """
                    INSERT INTO schedules(date, machine_id, machine_name, task_id,
                    task_name, task_type, task_kind, duration, remark, start_min, end_min,
                    status, created_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                    """,
                    (
                        actual_date,
                        int(best_machine["id"]),
                        best_machine["name"],
                        tid,
                        task_name,
                        task_type,
                        task_kind,
                        task.get("duration") or "",
                        (task.get("remark") or ""),
                        actual_start,
                        actual_end,
                        "executing",
                        datetime.datetime.now().isoformat(timespec="seconds"),
                    ),
                )
                conn.execute("UPDATE tasks SET status='已分配' WHERE id=?", (tid,))
                normalize_machine_schedule(conn, actual_date, int(best_machine["id"]))
```

同时更新 assigned 结果字典中的 `date` 字段（第 220-233 行）：

```python
            assigned.append({
                "task_id": tid,
                "task_name": task_name,
                "task_type": task_type,
                "task_kind": task_kind,
                "priority": task.get("priority"),
                "duration_min": dur_min,
                "machine_id": int(best_machine["id"]),
                "machine_name": best_machine["name"],
                "date": actual_date,
                "start_min": actual_start,
                "end_min": actual_end,
                "start_str": _min_to_hhmm_str(best_start),
                "end_str": _min_to_hhmm_str(best_end),
            })
```

- [ ] **Step 2: 验证语法**

```powershell
python -c "import ast; ast.parse(open('auto_assign.py').read()); print('syntax OK')"
```

Expected: `syntax OK`

---

### Task 4: 添加 `allow_cross_day` 参数到 `auto_assign_tasks`

**Files:**
- Modify: `auto_assign.py:97-108`（函数签名 + docstring）

- [ ] **Step 1: 新增参数**

`auto_assign.py` 第 97-108 行，当前：

```python
def auto_assign_tasks(
    task_ids: List[int],
    machine_ids: List[int],
    date: str,
    gap_minutes: int = 0,
    work_start_min: Optional[int] = None,
    work_end_min: Optional[int] = None,
    exclusion_periods: Optional[List[Tuple[int, int]]] = None,
    allow_cross_exclusion: bool = True,
    extend_over_breaks: bool = True,
    dry_run: bool = False,
) -> Dict:
```

改为（新增 `allow_cross_day` 参数，修改 ws 初始值计算逻辑）：

```python
def auto_assign_tasks(
    task_ids: List[int],
    machine_ids: List[int],
    date: str,
    gap_minutes: int = 0,
    work_start_min: Optional[int] = None,
    work_end_min: Optional[int] = None,
    exclusion_periods: Optional[List[Tuple[int, int]]] = None,
    allow_cross_exclusion: bool = True,
    extend_over_breaks: bool = True,
    dry_run: bool = False,
    allow_cross_day: bool = False,
) -> Dict:
```

然后在第 117-121 行附近，`ws`/`we` 计算后，不加 1440 限制（已在 Task 1 中移除 clamp），但需确保非跨天模式下 we 仍被限制。在第 121 行后新增：

```python
    if not allow_cross_day:
        we = max(ws + 1, min(24 * 60, we))
```

- [ ] **Step 2: 验证语法**

```powershell
python -c "import ast; ast.parse(open('auto_assign.py').read()); print('syntax OK')"
```

Expected: `syntax OK`

---

### Task 5: API 路由透传 `allow_cross_day`

**Files:**
- Modify: `routes/schedules.py:25-81`

- [ ] **Step 1: 修改 `/auto_assign_preview`**

`routes/schedules.py` 第 25-51 行，在参数解析部分增加 `allow_cross_day` 读取并传递给 `auto_assign_tasks`：

```python
@bp.route('/auto_assign_preview', methods=['POST'])
def auto_assign_preview():
    d = request.get_json() or {}
    date = parse_date(d.get("date"))
    task_ids = d.get("task_ids") or []
    machine_ids = d.get("machine_ids") or []
    gap = int(d.get("gap", 0)) if d.get("gap") else 0
    ws = d.get("work_start_min")
    we = d.get("work_end_min")
    exclusion = d.get("exclusion_periods") or []
    exclusion = [(int(e[0]), int(e[1])) for e in exclusion if len(e) == 2]
    allow_cross = d.get("allow_cross_exclusion", True)
    extend_over_breaks = d.get("extend_over_breaks", True)
    allow_cross_day = d.get("allow_cross_day", False)

    result = auto_assign_tasks(
        task_ids=task_ids,
        machine_ids=machine_ids,
        date=date,
        gap_minutes=max(0, min(120, gap)),
        work_start_min=int(ws) if ws is not None else None,
        work_end_min=int(we) if we is not None else None,
        exclusion_periods=exclusion,
        allow_cross_exclusion=allow_cross if isinstance(allow_cross, bool) else True,
        extend_over_breaks=extend_over_breaks if isinstance(extend_over_breaks, bool) else True,
        dry_run=True,
        allow_cross_day=bool(allow_cross_day),
    )
    return jsonify(result)
```

- [ ] **Step 2: 修改 `/auto_assign`**

`routes/schedules.py` 第 54-81 行，同样增加：

```python
@bp.route('/auto_assign', methods=['POST'])
def api_auto_assign():
    d = request.get_json() or {}
    date = parse_date(d.get("date"))
    task_ids = d.get("task_ids") or []
    machine_ids = d.get("machine_ids") or []
    gap = int(d.get("gap", 0)) if d.get("gap") else 0
    ws = d.get("work_start_min")
    we = d.get("work_end_min")
    exclusion = d.get("exclusion_periods") or []
    exclusion = [(int(e[0]), int(e[1])) for e in exclusion if len(e) == 2]
    allow_cross = d.get("allow_cross_exclusion", True)
    extend_over_breaks = d.get("extend_over_breaks", True)
    allow_cross_day = d.get("allow_cross_day", False)

    result = auto_assign_tasks(
        task_ids=task_ids,
        machine_ids=machine_ids,
        date=date,
        gap_minutes=max(0, min(120, gap)),
        work_start_min=int(ws) if ws is not None else None,
        work_end_min=int(we) if we is not None else None,
        exclusion_periods=exclusion,
        allow_cross_exclusion=allow_cross if isinstance(allow_cross, bool) else True,
        extend_over_breaks=extend_over_breaks if isinstance(extend_over_breaks, bool) else True,
        dry_run=False,
        allow_cross_day=bool(allow_cross_day),
    )
    result["msg"] = f"分配完成：成功 {len(result['assigned'])} 个，未分配 {len(result['unassigned'])} 个"
    return jsonify(result)
```

- [ ] **Step 3: 验证语法**

```powershell
python -c "import ast; ast.parse(open('routes/schedules.py').read()); print('syntax OK')"
```

Expected: `syntax OK`

---

### Task 6: 前端 — 对话框 HTML 新增"允许跨天"复选框

**Files:**
- Modify: `templates/dialogs/all.html:270-320`

- [ ] **Step 1: 在"工时结束"下方新增复选框**

在 `templates/dialogs/all.html` 中，找到第 289 行 `aa-work-end` 输入框后面，新增一行：

```html
<label style="display:block;margin-top:4px;"><input type="checkbox" id="aa-allow-cross-day" checked> 允许跨天分配（工时结束可超过 24:00）</label>
```

同时更新"工时结束"的 placeholder 提示：

当前第 289 行附近：
```html
工时结束 <input id="aa-work-end" type="text" value="24:00" style="width:60px;">
```

将 `value="24:00"` 改为 `value=""` 并将 placeholder 改为：
```html
工时结束 <input id="aa-work-end" type="text" placeholder="如 24:00 或 28:00" value="24:00" style="width:70px;">
```

- [ ] **Step 2: 验证 HTML**

用浏览器打开检查 syntax 或直接确认改动无误（HTML 无语法检查，人工确认即可）。

---

### Task 7: 前端 — JS 读取复选框并传参

**Files:**
- Modify: `static/dialogs.js:229-285`（`_getAutoAssignParams`）
- Modify: `static/dialogs.js:300-323`（`previewAutoAssign`）

- [ ] **Step 1: 在 `_getAutoAssignParams` 中读取复选框**

在 `static/dialogs.js` 的 `_getAutoAssignParams` 函数末尾（第 282 行 return 语句前），新增：

```javascript
    var allowCrossDay = true;
    var acdEl = document.getElementById('aa-allow-cross-day');
    if(acdEl) allowCrossDay = acdEl.checked;
```

修改 return 语句（第 282-284 行）：

当前：
```javascript
    return {date, gap, ws, we, machineIds, taskIds, exclusions,
            allow_cross_exclusion: allowCrossExclusion,
            extend_over_breaks: extendOverBreaks};
```

改为：
```javascript
    return {date, gap, ws, we, machineIds, taskIds, exclusions,
            allow_cross_exclusion: allowCrossExclusion,
            extend_over_breaks: extendOverBreaks,
            allow_cross_day: allowCrossDay};
```

- [ ] **Step 2: 在 `previewAutoAssign` 中传参**

在 `static/dialogs.js` 第 300-323 行的 `previewAutoAssign` 函数中，fetch body 新增 `allow_cross_day`：

```javascript
        body:JSON.stringify({
            date: params.date,
            task_ids: params.taskIds,
            machine_ids: params.machineIds,
            gap: params.gap,
            work_start_min: params.ws,
            work_end_min: params.we,
            exclusion_periods: params.exclusions,
            allow_cross_exclusion: params.allow_cross_exclusion,
            extend_over_breaks: params.extend_over_breaks,
            allow_cross_day: params.allow_cross_day
        })
```

- [ ] **Step 3: 修改 `confirmAutoAssign` 同样传参**

在 `static/dialogs.js` 中找到 `confirmAutoAssign` 函数（约第 354 行），对其中的 fetch body 做同样修改（新增 `allow_cross_day` 字段）。

- [ ] **Step 4: 更新预览结果渲染**

在 `renderAutoAssignResult` 函数中（约第 325 行），为分配到非当日的任务增加日期标识。找到构建任务行的代码，修改 start_str/end_str 的显示：

在渲染每个 assigned 任务时，如果 `item.date !== params.date`，则在显示中添加日期后缀。找到 `renderAutoAssignResult` 中遍历 `data.assigned` 的部分，修改如下：

```javascript
    for(var i = 0; i < data.assigned.length; i++){
        var item = data.assigned[i];
        var dateLabel = '';
        if(item.date && item.date !== params.date){
            dateLabel = ' <span style="color:#909399;font-size:11px;">(' + item.date.slice(5) + ')</span>';
        }
        // ... 现有渲染代码中用到 item.start_str / item.end_str 的地方后面加上 dateLabel
    }
```

---

### Task 8: 端到端验证

- [ ] **Step 1: 启动后端检查无导入错误**

```powershell
python -c "from auto_assign import auto_assign_tasks, find_free_slots; from routes.schedules import bp; print('all imports OK')"
```

Expected: `all imports OK`

- [ ] **Step 2: 启动 Flask 服务**

```powershell
python app.py
```

Expected: Flask 启动在 127.0.0.1:5000

- [ ] **Step 3: 前端验证**

1. 打开浏览器访问 `http://127.0.0.1:5000`
2. 进入排班面板，点击"自动分配任务"
3. 确认"允许跨天分配"复选框存在且默认勾选
4. 设置工时结束为 "28:00"（次日 04:00）
5. 选择任务和机器，点击"预览分配"
6. 确认跨天任务在预览结果中显示了日期标记
7. 点击"确认分配"
8. 切换到次日面板，确认跨天任务正确显示在时间轴上

- [ ] **Step 4: 回归验证 — 关闭跨天时行为不变**

1. 取消勾选"允许跨天分配"
2. 设置工时结束为 "24:00"
3. 预览分配 → 确认所有任务 end_min ≤ 1440
4. 确认分配 → 行为与改动前一致
