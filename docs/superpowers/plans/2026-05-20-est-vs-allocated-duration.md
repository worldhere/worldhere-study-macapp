# 预估时长与排班时长分离 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将"预估时长"（任务纯耗时）与"排班时长"（含休息段的时间窗）分离为两个独立概念

**Architecture:** 利用现有 `tasks.est_seconds` 存储预估时长，`schedules.end_min - start_min` 天然就是排班时长。核心改动：拖拽调整不再覆盖预估时长；自动分配/批量延迟增加"跨休息段自动延长"开关

**Tech Stack:** Python Flask + SQLite + 原生 JavaScript

---

### Task 1: 时间轴拖拽调整大小 — 不再覆盖 `tasks.est_seconds`

**Files:**
- Modify: `routes/schedules.py:219-228`

- [ ] **Step 1: 删除覆盖 est_seconds 的 UPDATE 语句**

`routes/schedules.py` 第 219-228 行，删除 `UPDATE tasks SET est_seconds` 这段：

```python
# 删除以下 4 行（第 224-228 行）：
    if sch["task_id"] is not None:
        conn.execute(
            "UPDATE tasks SET est_seconds=? WHERE id=?",
            (new_dur_sec, int(sch["task_id"])),
        )
```

同时删除上方不再需要的 `new_dur_sec` 变量（第 219 行）：

```python
# 删除第 219 行：
    new_dur_sec = (end_min - start_min) * 60
```

最终 `update_task_bounds` 的 schedule UPDATE 之后直接接 `normalize_machine_schedule`：

```python
    conn.execute(
        "UPDATE schedules SET date=?, start_min=?, end_min=? WHERE id=?",
        (date, start_min, end_min, sid),
    )
    normalize_machine_schedule(conn, date, mid)
```

- [ ] **Step 2: 验证** — 启动服务器，拖拽调整任务条大小，检查 `tasks` 表中 `est_seconds` 不变

---

### Task 2: 自动分配 — 跨休息段延长逻辑（后端）

**Files:**
- Modify: `auto_assign.py:67-73`（修改 `_task_duration_min` 附近，新增辅助函数）
- Modify: `auto_assign.py:75-85`（修改 `auto_assign_tasks` 签名，新增 `extend_over_breaks` 参数）

- [ ] **Step 1: 新增辅助函数 `_extend_end_over_breaks`**

在 `auto_assign.py` 的 `_task_duration_min` 之后添加：

```python
def _extend_end_over_breaks(start_min: int, end_min: int, date_str: str,
                            shift_config: dict) -> int:
    """检测 [start_min, end_min] 覆盖的休息段，返回延长后的 end_min"""
    from utils import parse_hhmm
    day_s = parse_hhmm(shift_config["day_shift"]["start"])
    day_e = parse_hhmm(shift_config["day_shift"]["end"])
    night_s = parse_hhmm(shift_config["night_shift"]["start"])
    night_e = parse_hhmm(shift_config["night_shift"]["end"])
    night_crosses = night_e <= night_s

    breaks = []
    # 收集当天及前后各一天的休息段（覆盖跨天场景）
    for d in range(-1, 3):
        base = d * 1440
        for a, b in shift_config["day_shift"].get("breaks", []):
            breaks.append((base + a, base + b))
        for a, b in shift_config["night_shift"].get("breaks", []):
            breaks.append((base + a, base + b))

    total_overlap = 0
    for bs, be in breaks:
        overlap = max(0, min(end_min + total_overlap, be) - max(start_min, bs))
        if overlap > 0:
            total_overlap += overlap

    return end_min + total_overlap
```

- [ ] **Step 2: 修改 `auto_assign_tasks` 签名和逻辑**

修改函数签名（第 75-85 行），在 `allow_cross_exclusion` 后新增参数：

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

在分配逻辑中找到 `best_end = min(we, best_start + dur_min)` 这一行（约第 160 行），在其后添加休息段延长逻辑：

```python
                best_end = min(we, best_start + dur_min)
                if extend_over_breaks:
                    from models import load_shift_config
                    shift_config = load_shift_config()
                    best_end = _extend_end_over_breaks(best_start, best_end, date, shift_config)
                    best_end = min(we, best_end)  # 不超出工作结束时间
```

注意：需要传入 `shift_config`，可以在函数开头加载一次。

- [ ] **Step 3: 验证** — 创建跨越休息段的任务，确认自动分配的 `end_min` 被延长

---

### Task 3: 自动分配 API 接口 — 传递 `extend_over_breaks`

**Files:**
- Modify: `routes/schedules.py:652-706`（`auto_assign_preview` 和 `api_auto_assign`）

- [ ] **Step 1: 两个端点新增参数读取**

`auto_assign_preview`（第 652 行）新增一行：

```python
    extend_over_breaks = d.get("extend_over_breaks", True)
```

在调用 `auto_assign_tasks` 时传入：

```python
    result = auto_assign_tasks(
        ...
        allow_cross_exclusion=allow_cross if isinstance(allow_cross, bool) else True,
        extend_over_breaks=extend_over_breaks if isinstance(extend_over_breaks, bool) else True,
        dry_run=True,
    )
```

`api_auto_assign`（第 680 行）同样新增参数读取和传入。

- [ ] **Step 2: 验证** — curl 测试 API 传入 `extend_over_breaks: false` 确认可关闭

---

### Task 4: 自动分配弹窗 UI — 复选框

**Files:**
- Modify: `templates/index.html`（在自动分配弹窗 HTML 中添加复选框）
- Modify: `static/dialogs.js:245-278`（`_getAutoAssignParams` 读取复选框值）
- Modify: `static/dialogs.js:294-315`（`previewAutoAssign` 传递参数）
- Modify: `static/dialogs.js:347-371`（`confirmAutoAssign` 传递参数）

- [ ] **Step 1: 在自动分配弹窗 HTML 中添加复选框**

找到 `index.html` 中的 `auto-assign-dialog`，在 `aa-allow-cross-exclusion` 复选框附近添加：

```html
<label style="margin-left:12px;font-size:12px;">
    <input type="checkbox" id="aa-extend-over-breaks" checked> 跨休息段自动延长排班时长
</label>
```

- [ ] **Step 2: `_getAutoAssignParams` 读取复选框**

在 `dialogs.js` 的 `_getAutoAssignParams` 函数末尾（`return` 语句之前）添加：

```javascript
    var extendOverBreaks = true;
    var eobEl = document.getElementById('aa-extend-over-breaks');
    if(eobEl) extendOverBreaks = eobEl.checked;

    return {date, gap, ws, we, machineIds, taskIds, exclusions,
            allow_cross_exclusion: allowCrossExclusion,
            extend_over_breaks: extendOverBreaks};
```

- [ ] **Step 3: `previewAutoAssign` 和 `confirmAutoAssign` 传递参数**

在 `previewAutoAssign` 的 fetch body 中添加：

```javascript
    extend_over_breaks: params.extend_over_breaks
```

在 `confirmAutoAssign` 的 fetch body 中同样添加。

- [ ] **Step 4: 验证** — 打开自动分配弹窗，确认复选框可见且默认勾选

---

### Task 5: 批量延迟 — 跨休息段延长逻辑（后端）

**Files:**
- Modify: `auto_assign.py:243-373`（`mass_delay` 函数）
- Modify: `routes/schedules.py:709-740`（`api_mass_delay` 端点）

- [ ] **Step 1: `mass_delay` 新增 `extend_over_breaks` 参数**

修改函数签名（第 243-251 行）：

```python
def mass_delay(
    machine_ids: List[int],
    date: str,
    delay_minutes: int,
    from_start_min: int = 0,
    mode: str = "shift",
    strategy: str = "block",
    include_completed: bool = False,
    extend_over_breaks: bool = True,
) -> Dict:
```

在 "shift" 模式和 "extend" 模式设置 `new_end` 后，添加休息段延长逻辑。找到 mode == "shift" 分支中的 `new_end = int(r["end_min"]) + delay_minutes`（第 289 行）和 extend 分支中的 `new_end = int(r["end_min"]) + delay_minutes`（第 292 行），在 `new_end = max(new_start + 1, min(28 * 1440, new_end))`（第 294 行）之前插入：

```python
                if extend_over_breaks:
                    from models import load_shift_config
                    shift_config = load_shift_config()
                    new_end = _extend_end_over_breaks(new_start, new_end, date, shift_config)
                    new_end = min(28 * 1440, new_end)
```

同样，在 extend 模式下（第 292 行之后）也添加类似逻辑，但 `new_start` 保持不变：

```python
                else:  # extend
                    new_start = int(r["start_min"])
                    new_end = int(r["end_min"]) + delay_minutes
                if extend_over_breaks:
                    from models import load_shift_config
                    shift_config = load_shift_config()
                    new_end = _extend_end_over_breaks(new_start, new_end, date, shift_config)
                    new_end = min(28 * 1440, new_end)
```

为了减少重复，可以在 mode 判断之后统一处理：

```python
                # 在 new_start/new_end 计算完成后，统一处理休息段延长
                if extend_over_breaks:
                    from models import load_shift_config
                    shift_config = load_shift_config()
                    new_end = _extend_end_over_breaks(new_start, new_end, date, shift_config)
                    new_end = min(28 * 1440, new_end)
```

将这段逻辑放在 `new_start = max(0, min(28 * 1440 - 1, new_start))` 和 `new_end = max(new_start + 1, min(28 * 1440, new_end))` 这两行之前。

对 "smart" 策略也需要类似处理（约第 357 行）。

- [ ] **Step 2: `api_mass_delay` 端点读取参数**

在 `routes/schedules.py` 的 `api_mass_delay`（第 709 行）中新增：

```python
    extend_over_breaks = d.get("extend_over_breaks", True)
```

传入 `mass_delay` 调用：

```python
    result = mass_delay(
        ...
        include_completed=include_completed,
        extend_over_breaks=extend_over_breaks if isinstance(extend_over_breaks, bool) else True,
    )
```

- [ ] **Step 3: 验证** — 调用 API 测试批量延迟带休息段延长

---

### Task 6: 批量延迟弹窗 UI — 复选框

**Files:**
- Modify: `templates/index.html`（在批量延迟弹窗 HTML 中添加复选框）
- Modify: `static/dialogs.js:398-416`（`_getMDParams` 读取复选框值）
- Modify: `static/dialogs.js:674-693`（`_doMassDelay` 传递参数）

- [ ] **Step 1: 在批量延迟弹窗 HTML 中添加复选框**

找到 `index.html` 中的 `mass-delay-dialog`，在合适位置添加：

```html
<label style="margin-left:12px;font-size:12px;">
    <input type="checkbox" id="md-extend-over-breaks" checked> 跨休息段自动延长排班时长
</label>
```

- [ ] **Step 2: `_getMDParams` 读取复选框**

在 `_getMDParams` 的 return 语句中添加：

```javascript
    var extendOverBreaks = true;
    var mdeobEl = document.getElementById('md-extend-over-breaks');
    if(mdeobEl) extendOverBreaks = mdeobEl.checked;

    return {date, delay, mode, strategy, fromMin, machineIds,
            includeCompleted, extend_over_breaks: extendOverBreaks};
```

- [ ] **Step 3: `executeMassDelay` 和 `_doMassDelay` 传递参数**

在 `executeMassDelay` 中解构 `extendOverBreaks` 并传递给 `_doMassDelay`：

```javascript
    var extendOverBreaks = params.extend_over_breaks;
    // ... 在调用 _doMassDelay 和 showConfirm 分支中都传入
    _doMassDelay(date, delay, mode, strategy, fromMin, machineIds, includeCompleted, extendOverBreaks);
```

修改 `_doMassDelay` 函数签名和 body：

```javascript
function _doMassDelay(date, delay, mode, strategy, fromMin, machineIds, includeCompleted, extendOverBreaks){
    fetch('/mass_delay', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
            date: date, machine_ids: machineIds, delay_minutes: delay,
            from_start_min: fromMin,
            mode: mode, strategy: strategy,
            include_completed: includeCompleted || false,
            extend_over_breaks: extendOverBreaks !== false
        })
```

- [ ] **Step 4: 验证** — 打开批量延迟弹窗，确认复选框可见且默认勾选

---

### Task 7: 历史记录表格 — "总耗时"改名为"排班时长"

**Files:**
- Modify: `static/timeline-ops.js:212`（前端导出列标签）
- Modify: `routes/schedules.py:852`（后端导出列标签）

- [ ] **Step 1: 前端导出列标签**

`static/timeline-ops.js` 第 212 行：

```javascript
// 改前：
    {key: "elapsed", label: "总耗时"},
// 改后：
    {key: "elapsed", label: "排班时长"},
```

- [ ] **Step 2: 后端导出列标签**

`routes/schedules.py` 第 852 行：

```python
# 改前：
        ("elapsed", "总耗时",
# 改后：
        ("elapsed", "排班时长",
```

- [ ] **Step 3: 验证** — 导出历史记录 Excel，确认列名为"排班时长"

---

### Task 8: 时间轴 tooltip — 显示工作时长 / 排班时长

**Files:**
- Modify: `static/timeline-render.js:462-490`（`_showTaskTooltipNow` 函数）

- [ ] **Step 1: 修改 tooltip 内容**

当前 tooltip 的第 475 行显示原始 `s.duration` 字符串，将其替换为计算后的工作时长和排班时长。

由于 tooltip 在客户端运行，需要从 schedule 数据中获取 `start_min`、`end_min`、`date`，以及 SHIFT 配置来计算。

在 `_showTaskTooltipNow` 函数中，将第 475 行：

```javascript
    if(s.duration) html += '<div style="'+rowStyle+'">时长：'+escHtml(s.duration)+'</div>';
```

替换为：

```javascript
    var schedStartMin = parseInt(s.start_min) || 0;
    var schedEndMin = parseInt(s.end_min) || 0;
    var allocatedMin = schedEndMin - schedStartMin;
    if(allocatedMin > 0){
        var workingMin = allocatedMin;  // 默认 = 排班时长，以下尝试扣除休息段
        // 收集当日休息段（简化版，仅处理当天）
        var allBreaks = [];
        var dayBreaks = (SHIFT.day_shift && SHIFT.day_shift.breaks) ? SHIFT.day_shift.breaks : [];
        var nightBreaks = (SHIFT.night_shift && SHIFT.night_shift.breaks) ? SHIFT.night_shift.breaks : [];
        allBreaks = allBreaks.concat(dayBreaks, nightBreaks);
        for(var bi = 0; bi < allBreaks.length; bi++){
            var bs = allBreaks[bi][0], be = allBreaks[bi][1];
            var overlap = Math.max(0, Math.min(schedEndMin, be) - Math.max(schedStartMin, bs));
            if(overlap > 0) workingMin -= overlap;
        }
        workingMin = Math.max(0, workingMin);
        var workingH = (workingMin / 60).toFixed(1);
        var allocatedH = (allocatedMin / 60).toFixed(1);
        html += '<div style="'+rowStyle+'">工作时长：'+workingH+'h / 排班时长：'+allocatedH+'h</div>';
    }
```

- [ ] **Step 2: 验证** — 悬停时间轴任务条，确认 tooltip 显示 "工作时长 Xh / 排班时长 Yh"

---

### Task 9: 端到端验证

- [ ] **Step 1:** 启动 `python app.py`，打开 `http://127.0.0.1:5000/`
- [ ] **Step 2:** 创建预估 2h 任务，自动分配到跨越中午休息段的机器 → 排班时长 > 2h
- [ ] **Step 3:** 取消"跨休息段自动延长"复选框，重新分配 → 排班时长 = 2h
- [ ] **Step 4:** 时间轴拖拽调整任务条 → 任务库中预估时长不变
- [ ] **Step 5:** 打开历史记录表格 → 列名为"排班时长"
- [ ] **Step 6:** 悬停时间轴任务 → tooltip 显示工作时长 / 排班时长
- [ ] **Step 7:** 批量延迟弹窗复选框可见默认勾选，功能正常
