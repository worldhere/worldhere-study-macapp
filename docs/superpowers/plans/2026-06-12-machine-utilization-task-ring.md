# Machine Utilization Task Ring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the machine utilization piegrid (80x80 doughnut per machine, colored by type) with SVG task-segment rings (each machine one ring, segments colored by schedule status, synced with timeline colors).

**Architecture:** Backend `machine_utilization_data` expanded to return per-task data and per-machine repair periods. Frontend `renderTaskRing` draws SVG rings using Chart.js-independent canvas-free rendering, reading colors from CSS variables / localStorage each render pass.

**Tech Stack:** Python (Flask backend), JavaScript (vanilla), SVG (no Chart.js dependency for this widget)

---

### Task 1: Extend `machine_utilization_data` backend to return task list

**Files:**
- Modify: `models/summary.py` (function `machine_utilization_data`)

- [ ] **Step 1: Add per-task detail to the return data**

Read the current function at `models/summary.py:317-424`. After the existing machine aggregation loop (line 411-412), add task-level detail to each machine dict.

In `machine_utilization_data`, after `machines[mid]["task_count"] += 1` (line ~412), store each task's computed `wm` alongside its metadata. Then include it in the result.

Replace lines 404-424 (from `# 按机器聚合` to end of function) with:

```python
    # 按机器聚合（任务级明细）
    machines = {}
    for r in rows:
        mid = r["machine_id"]
        wm = _working_minutes(int(r["start_min"] or 0), int(r["end_min"] or 0))
        task_info = {
            "name": r["machine_name"] + " task",  # placeholder, see step 2
            "start_min": int(r["start_min"] or 0),
            "end_min": int(r["end_min"] or 0),
            "working_min": wm,
            "status": "executing",
            "split_group": None,
        }
        if mid not in machines:
            machines[mid] = {
                "machine_name": r["machine_name"],
                "type": r["type"],
                "working_min": 0,
                "task_count": 0,
                "tasks": [],
            }
        machines[mid]["working_min"] += wm
        machines[mid]["task_count"] += 1
        machines[mid]["tasks"].append(task_info)

    result = []
    for v in machines.values():
        result.append({
            "machine_name": v["machine_name"],
            "type": v["type"],
            "total_min": v["working_min"],
            "utilization_pct": round(v["working_min"] / available * 100, 1),
            "task_count": v["task_count"],
            "tasks": sorted(v["tasks"], key=lambda t: t["start_min"]),
        })
    result.sort(key=lambda x: x["total_min"], reverse=True)
    return result
```

- [ ] **Step 2: Fill real task metadata (name, status, split_group)**

The SELECT query at line 365-371 only fetches `s.machine_name, s.machine_id, m.type, s.start_min, s.end_min`. Expand it to also fetch task name, schedule status, and split_group:

```python
    rows = conn.execute(
        f"""SELECT s.machine_name, s.machine_id, m.type, m.status as machine_status,
                   s.task_name, s.start_min, s.end_min, s.status as schedule_status,
                   s.split_group
            FROM schedules s
            JOIN machines m ON s.machine_id=m.id
            WHERE {where_clause}""",
        where_params
    ).fetchall()
```

Then in the aggregation loop, use:

```python
        task_info = {
            "name": r["task_name"] or "",
            "start_min": int(r["start_min"] or 0),
            "end_min": int(r["end_min"] or 0),
            "working_min": wm,
            "status": r["schedule_status"] or "executing",
            "split_group": r["split_group"] or None,
        }
```

And store `machine_status`:

```python
        if mid not in machines:
            machines[mid] = {
                "machine_name": r["machine_name"],
                "type": r["type"],
                "machine_status": r["machine_status"] or "空闲",
                "working_min": 0,
                "task_count": 0,
                "tasks": [],
            }
```

Add `"machine_status": v["machine_status"]` to the result dict.

- [ ] **Step 3: Add repair periods per machine**

After the task aggregation loop and before building `result`, query `repair_log` for the shift window:

```python
    # 查询本班次窗口内的维修记录
    from datetime import date as _date, timedelta as _td
    shift_start_dt = _date.fromisoformat(date_str)
    shift_end_dt = shift_start_dt
    if key == "night_shift":
        # night spans two calendar days
        pass  # handled by time range below

    # Build absolute minute boundaries for repair_log query
    # Day shift: date_str 09:00 to date_str 21:00
    # Night shift: date_str 21:00 to next_day 08:30
    if key == "night_shift":
        abs_start = f"{date_str} 21:00:00"
        abs_end = f"{(shift_start_dt + _td(days=1)).isoformat()} 08:30:00"
    else:
        abs_start = f"{date_str} 09:00:00"
        abs_end = f"{date_str} 21:00:00"
    # use strftime to convert back to absolute minutes

    repair_rows = conn.execute(
        """SELECT machine_id,
                  CAST((julianday(start_datetime) - julianday(?)) * 1440 AS INTEGER) as abs_start_min,
                  CASE WHEN end_datetime IS NOT NULL
                    THEN CAST((julianday(end_datetime) - julianday(?)) * 1440 AS INTEGER)
                    ELSE CAST((julianday('now', 'localtime') - julianday(?)) * 1440 AS INTEGER)
                  END as abs_end_min
           FROM repair_log
           WHERE start_datetime < ? AND (end_datetime > ? OR end_datetime IS NULL)
             AND machine_id IN ({placeholders})""",
        (date_str, date_str, date_str, abs_end, abs_start) + tuple(machines.keys())
    ).fetchall()
```

Simplify: compute absolute epoch reference once, then for each machine, collect repairs that overlap the shift window, converting to shift-relative minutes.

Actually, a simpler approach — compute shift-relative repair minutes directly:

```python
    # 维修记录：查询本班次内与机器相关的维修时段
    machine_ids = list(machines.keys())
    repairs_by_machine = {}
    if machine_ids:
        ph = ",".join("?" * len(machine_ids))
        # Get repair_log rows for these machines that overlap the shift
        # Shift absolute time range
        shift_start_abs = _dt.datetime.fromisoformat(date_str + " 09:00:00")
        if key == "night_shift":
            shift_start_abs = _dt.datetime.fromisoformat(date_str + " 21:00:00")
            shift_end_abs = shift_start_abs + _td(hours=11, minutes=30)  # to 08:30 next day
        else:
            shift_end_abs = shift_start_abs + _td(hours=12)  # to 21:00

        repair_rows = conn.execute(
            f"""SELECT machine_id, start_datetime, end_datetime
                FROM repair_log
                WHERE machine_id IN ({ph})
                  AND start_datetime < ?
                  AND (end_datetime > ? OR end_datetime IS NULL)""",
            machine_ids + (shift_end_abs.isoformat(), shift_start_abs.isoformat()),
        ).fetchall()
        for rr in repair_rows:
            mid = rr["machine_id"]
            rs = rr["start_datetime"]
            re = rr["end_datetime"]
            # Convert to shift-relative minutes
            rs_dt = _dt.datetime.fromisoformat(rs)
            rs_min = (rs_dt - shift_start_abs).total_seconds() // 60
            if re:
                re_dt = _dt.datetime.fromisoformat(re)
                re_min = (re_dt - shift_start_abs).total_seconds() // 60
            else:
                re_min = ot_end  # ongoing repair, clamp to shift end
            # Clamp to shift window
            rs_min = max(rs_min, 0)
            re_min = min(re_min, ot_end - s if key != "night_shift" else raw_window)
            if re_min > rs_min:
                if mid not in repairs_by_machine:
                    repairs_by_machine[mid] = []
                repairs_by_machine[mid].append({"start_min": int(rs_min), "end_min": int(re_min)})
    ```

Then add to each result entry:

```python
    for v in machines.values():
        mid_key = [k for k, val in machines.items() if val is v][0]  # find the machine_id
        # ...existing code...
        result.append({
            # ...existing fields...
            "repairs": repairs_by_machine.get(mid_key, []),
        })
```

Better: store machine_id in the dict so we can look it up directly.

Actually, restructure the machines dict to key by `(machine_id)` and store mid in the value:

```python
    machines = {}  # keyed by machine_id
    for r in rows:
        mid = r["machine_id"]
        ...
        if mid not in machines:
            machines[mid] = {
                "machine_id": mid,
                "machine_name": r["machine_name"],
                ...
            }
```

Then in result building:

```python
    for v in machines.values():
        result.append({
            ...
            "repairs": repairs_by_machine.get(v["machine_id"], []),
        })
```

And pass `machines.keys()` to the repair query.

- [ ] **Step 4: Verify backend output**

Run a quick test script:

```python
from db import get_db
from models.summary import machine_utilization_data

conn = get_db()
data = machine_utilization_data(conn, "2026-06-12", "白班")
conn.close()

# Check first machine
m = data[0]
assert "tasks" in m, "missing tasks key"
assert "repairs" in m, "missing repairs key"
assert "machine_status" in m, "missing machine_status key"
print(f"OK: {m['machine_name']} - {len(m['tasks'])} tasks, {len(m['repairs'])} repairs, status={m['machine_status']}")
print(f"First task: {m['tasks'][0]}")
```

- [ ] **Step 5: Commit**

```bash
git add models/summary.py
git commit -m "feat: extend machine_utilization_data with tasks[], repairs[], machine_status

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Add `renderTaskRing` SVG rendering function

**Files:**
- Modify: `static/summary.js`

- [ ] **Step 1: Add color helper functions**

At the end of `summary.js` (before any closing code), add:

```javascript
// ── 任务段环形颜色工具 ──

// 从 CSS 变量读颜色，带兜底
function _readCSSColor(varName, fallback) {
  try {
    var v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    if (v) return v;
  } catch (e) {}
  return fallback;
}

var _TASK_RING_COLORS = {
  get completed()  { return _readCSSColor('--state-color-completed', '#84cc16'); },
  get split()      { return _readCSSColor('--state-color-split', '#a78bfa'); },
  get paused()     { return _readCSSColor('--state-color-paused', '#fca5a5'); },
  get postPause()  { return _readCSSColor('--state-color-post-pause', '#fbcfe8'); },
  get repairOverlay() { return 'rgba(219,39,119,0.45)'; },
  get idleBg()     { return '#f3f4f6'; },
  get redLine()    { return '#ef4444'; },
  idleBgColor: '#f3f4f6',
  redLineColor: '#ef4444',
  repairOverlayColor: 'rgba(219,39,119,0.45)',
};
```

Note: since `get` accessor properties don't work with the way `_TASK_RING_COLORS` is used in old JS, use plain function calls instead:

```javascript
function _ringColorCompleted() { return _readCSSColor('--state-color-completed', '#84cc16'); }
function _ringColorSplit()     { return _readCSSColor('--state-color-split', '#a78bfa'); }
function _ringColorPaused()    { return _readCSSColor('--state-color-paused', '#fca5a5'); }
function _ringColorPostPause() { return _readCSSColor('--state-color-post-pause', '#fbcfe8'); }

function _readCSSColor(varName, fallback) {
  try {
    var v = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    if (v) return v;
  } catch (e) {}
  return fallback;
}
```

- [ ] **Step 2: Add task status → color mapping function**

```javascript
function _getTaskRingColor(task, machineStatus, hasRepairOverlay) {
  // 已完成 → always green
  if (task.status === 'completed') return _ringColorCompleted();

  // 维修停用 → paused or post-pause
  if (machineStatus === '维修停用') {
    if (task.status === '暂停中') return _ringColorPaused();
    return _ringColorPostPause();
  }

  // 正常 / 工作 → type color for executing, split color for split
  if (task.split_group) return _ringColorSplit();
  // 进行中 → machine type color
  var tc = _readTypeColors();
  return tc[task.type] || tc._fallback || '#3b82f6';
}

function _getTaskRingHasRepairOverlay(task, machineStatus) {
  // 维修停用：无粉疊
  if (machineStatus === '维修停用') return false;
  // 已完成：无粉疊（和时间轴 has-repair 逻辑一致，completed stays green）
  if (task.status === 'completed') return false;
  // 工作机器有维修记录 → 需要检查 task 时间段是否与 repair 重叠
  // This is checked in the rendering loop
  return true; // will be checked per-segment in render
}
```

Wait — the repair overlay should only apply to the portion of the task that overlaps with a repair period. The above function is too coarse. Let me refine in the rendering logic.

Actually, keep it simple: draw the task segment normally, then check each repair period — if it overlaps the task's time range, draw a pink overlay arc on that portion.

- [ ] **Step 3: Add SVG ring drawing function for one machine**

```javascript
function _drawTaskRingSVG(machine, shiftAvailable, currentTimeMin, showRedLine) {
  // machine: { machine_name, type, machine_status, tasks[], repairs[], utilization_pct }
  // shiftAvailable: total available minutes (570)
  // currentTimeMin: current time as minutes from shift start, or null if red line disabled
  // showRedLine: boolean

  var tasks = machine.tasks || [];
  var repairs = machine.repairs || [];
  var machineStatus = machine.machine_status || '空闲';
  var pct = machine.utilization_pct || 0;

  var svgNs = 'http://www.w3.org/2000/svg';
  var svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('width', '100');
  svg.setAttribute('height', '100');

  var cx = 50, cy = 50, r = 40, sw = 11;
  var circumference = 2 * Math.PI * r; // ~251.3

  // 1. Background idle ring
  var bg = document.createElementNS(svgNs, 'circle');
  bg.setAttribute('cx', cx);
  bg.setAttribute('cy', cy);
  bg.setAttribute('r', r);
  bg.setAttribute('fill', 'none');
  bg.setAttribute('stroke', '#f3f4f6');
  bg.setAttribute('stroke-width', sw);
  svg.appendChild(bg);

  // 2. Task segments (contiguous, sorted by start_min)
  var cumulOffset = 0; // cumulative dash offset

  for (var i = 0; i < tasks.length; i++) {
    var task = tasks[i];
    var wm = task.working_min || 0;
    if (wm <= 0) continue;

    var dashLen = (wm / shiftAvailable) * circumference;
    var color = _getTaskRingColor(task, machineStatus, false);

    var seg = document.createElementNS(svgNs, 'circle');
    seg.setAttribute('cx', cx);
    seg.setAttribute('cy', cy);
    seg.setAttribute('r', r);
    seg.setAttribute('fill', 'none');
    seg.setAttribute('stroke', color);
    seg.setAttribute('stroke-width', sw);
    seg.setAttribute('stroke-dasharray', dashLen.toFixed(1) + ' ' + (circumference - dashLen).toFixed(1));
    seg.setAttribute('transform', 'rotate(-90 ' + cx + ' ' + cy + ')');

    if (cumulOffset > 0) {
      seg.setAttribute('stroke-dashoffset', (-cumulOffset).toFixed(1));
    }
    svg.appendChild(seg);

    // 3. Repair overlay on this task segment (if applicable)
    if (machineStatus !== '维修停用' && task.status !== 'completed') {
      for (var ri = 0; ri < repairs.length; ri++) {
        var rp = repairs[ri];
        // Check overlap between task [task.start_min, task.end_min] and repair [rp.start_min, rp.end_min]
        var ovStart = Math.max(task.start_min, rp.start_min);
        var ovEnd = Math.min(task.end_min, rp.end_min);
        if (ovEnd > ovStart) {
          var ovDashLen = ((ovEnd - ovStart) / shiftAvailable) * circumference;
          var ovOffset = cumulOffset + ((ovStart - task.start_min) / wm) * dashLen;
          var ov = document.createElementNS(svgNs, 'circle');
          ov.setAttribute('cx', cx);
          ov.setAttribute('cy', cy);
          ov.setAttribute('r', r - 6); // inner ring for overlay effect
          ov.setAttribute('fill', 'none');
          ov.setAttribute('stroke', 'rgba(219,39,119,0.45)');
          ov.setAttribute('stroke-width', '7');
          ov.setAttribute('stroke-dasharray', ovDashLen.toFixed(1) + ' ' + (circumference - ovDashLen).toFixed(1));
          ov.setAttribute('stroke-dashoffset', (-ovOffset).toFixed(1));
          ov.setAttribute('transform', 'rotate(-90 ' + cx + ' ' + cy + ')');
          svg.appendChild(ov);
        }
      }
    }

    cumulOffset += dashLen;

    // hover tooltip data
    seg.setAttribute('data-task-name', task.name || '');
    seg.setAttribute('data-task-status', task.status || '');
    seg.setAttribute('data-task-start', task.start_min || 0);
    seg.setAttribute('data-task-end', task.end_min || 0);
  }

  // 4. Current time red line
  if (showRedLine && currentTimeMin !== null && currentTimeMin >= 0 && currentTimeMin <= shiftAvailable) {
    var angleDeg = (currentTimeMin / shiftAvailable) * 360;
    var line = document.createElementNS(svgNs, 'line');
    line.setAttribute('x1', cx);
    line.setAttribute('y1', cy);
    line.setAttribute('x2', cx);
    line.setAttribute('y2', cy - r + 3); // outer edge minus a bit
    line.setAttribute('stroke', '#ef4444');
    line.setAttribute('stroke-width', '1.5');
    line.setAttribute('stroke-dasharray', '2 2');
    line.setAttribute('opacity', '0.85');
    line.setAttribute('transform', 'rotate(' + angleDeg + ' ' + cx + ' ' + cy + ')');
    svg.appendChild(line);

    var dot = document.createElementNS(svgNs, 'circle');
    dot.setAttribute('cx', cx);
    dot.setAttribute('cy', cy - r + 3);
    dot.setAttribute('r', '2.5');
    dot.setAttribute('fill', '#ef4444');
    dot.setAttribute('transform', 'rotate(' + angleDeg + ' ' + cx + ' ' + cy + ')');
    svg.appendChild(dot);
  }

  // 5. Center percentage text
  var pctText = document.createElementNS(svgNs, 'text');
  pctText.setAttribute('x', cx);
  pctText.setAttribute('y', cy + 3);
  pctText.setAttribute('text-anchor', 'middle');
  pctText.setAttribute('font-size', '20');
  pctText.setAttribute('font-weight', '800');
  pctText.setAttribute('fill', '#1f2937');
  pctText.textContent = Math.round(pct) + '%';
  svg.appendChild(pctText);

  return svg;
}
```

- [ ] **Step 4: Add `renderTaskRing` widget renderer**

```javascript
function renderTaskRing(w, data) {
  destroyWidgetChart(w.id);
  var card = document.getElementById("widget-" + w.id);
  var body = card ? card.querySelector(".summary-widget-body") : null;
  if (body) { body.innerHTML = ""; }

  if (!data || data.length === 0) {
    if (body) body.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;padding:8px;">暂无数据</p>';
    return;
  }

  // Filter: only machines with utilization > 0
  var items = data.filter(function(d) { return (d.utilization_pct || 0) > 0; });
  if (items.length === 0) {
    if (body) body.innerHTML = '<p style="color:var(--text-secondary);font-size:13px;padding:8px;">无排班数据</p>';
    return;
  }

  // Sort by utilization descending
  items.sort(function(a, b) { return (b.utilization_pct || 0) - (a.utilization_pct || 0); });

  // Shift available time (from data or default)
  var available = 570; // Default, can be passed from backend

  // Current time red line: check if timeline red line is enabled
  var showRedLine = false;
  var currentTimeMin = null;
  try {
    showRedLine = localStorage.getItem('showCurrentTimeLine') === '1';
  } catch(e) {}
  if (showRedLine) {
    var now = new Date();
    var dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0);
    currentTimeMin = (now - dayStart) / 60000; // minutes from 09:00
    if (currentTimeMin < 0 || currentTimeMin > available) {
      currentTimeMin = null; // outside shift
    }
  }

  // Layout: flex-wrap grid
  var grid = document.createElement("div");
  grid.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;justify-content:center;align-items:flex-start;";
  body.appendChild(grid);

  for (var i = 0; i < items.length; i++) {
    var m = items[i];

    var wrapper = document.createElement("div");
    wrapper.style.cssText = "display:flex;flex-direction:column;align-items:center;width:100px;";

    // Machine name
    var label = document.createElement("span");
    label.style.cssText = "font-size:10px;color:var(--text-secondary);text-align:center;line-height:1.2;margin-bottom:2px;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    label.textContent = m.machine_name;
    label.title = m.machine_name;
    wrapper.appendChild(label);

    // Ring SVG
    var svg = _drawTaskRingSVG(m, available, currentTimeMin, showRedLine);
    wrapper.appendChild(svg);

    grid.appendChild(wrapper);
  }
}
```

- [ ] **Step 5: Wire up the new chart type**

In `REPORT_WIDGETS` (line ~7), change chartType:

```javascript
{ id: "machine_utilization", title: "🏭 机器利用率", chartType: "taskring", span: 2, region: "report" },
```

In `renderWidget` (line ~200), add case:

```javascript
case "taskring": renderTaskRing(w, data); break;
```

- [ ] **Step 6: Commit**

```bash
git add static/summary.js
git commit -m "feat: add renderTaskRing with SVG task-segment rings

- Replace piegrid with per-machine SVG rings
- Task segments colored by schedule status (completed/split/paused/executing)
- Repair overlay as inner pink ring on non-completed task portions
- Current-time red line when timeline setting enabled
- Colors from CSS variables with hardcoded fallbacks
- Only renders machines with utilization > 0

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Add hover tooltip on task segments

**Files:**
- Modify: `static/summary.js`

- [ ] **Step 1: Add mouseenter/mouseleave handlers to SVG segments**

In `_drawTaskRingSVG`, after creating each task segment circle, add event listeners:

```javascript
    seg.addEventListener('mouseenter', function(ev) {
      var name = this.getAttribute('data-task-name');
      var status = this.getAttribute('data-task-status');
      var startMin = parseInt(this.getAttribute('data-task-start'));
      var endMin = parseInt(this.getAttribute('data-task-end'));
      var sh = Math.floor(startMin / 60), sm = startMin % 60;
      var eh = Math.floor(endMin / 60), em = endMin % 60;
      var timeStr = String(sh).padStart(2,'0') + ':' + String(sm).padStart(2,'0') +
                    ' - ' + String(eh).padStart(2,'0') + ':' + String(em).padStart(2,'0');

      _showRingTooltip(ev, name, status, timeStr);
    });
    seg.addEventListener('mouseleave', function() {
      _hideRingTooltip();
    });
    seg.style.cursor = 'pointer';
```

- [ ] **Step 2: Add tooltip DOM helpers**

```javascript
var _ringTooltipEl = null;

function _showRingTooltip(ev, name, status, timeStr) {
  _hideRingTooltip();
  var tip = document.createElement('div');
  tip.className = 'ring-tooltip';
  var statusMap = { 'completed': '已完成', 'executing': '采集中', 'split': '切割', 'paused': '暂停中' };
  var statusText = statusMap[status] || status;
  tip.innerHTML = '<b>' + escHtml(name) + '</b><br>' +
                  '<span style="font-size:10px;color:#9ca3af;">' + timeStr + ' · ' + statusText + '</span>';
  tip.style.cssText = 'position:fixed;z-index:9999;background:#1f2937;color:#fff;padding:6px 10px;' +
                      'border-radius:6px;font-size:11px;line-height:1.5;pointer-events:none;' +
                      'left:' + (ev.clientX + 10) + 'px;top:' + (ev.clientY - 10) + 'px;' +
                      'box-shadow:0 4px 12px rgba(0,0,0,0.3);';
  document.body.appendChild(tip);
  _ringTooltipEl = tip;
}

function _hideRingTooltip() {
  if (_ringTooltipEl) { _ringTooltipEl.remove(); _ringTooltipEl = null; }
}
```

- [ ] **Step 3: Commit**

```bash
git add static/summary.js
git commit -m "feat: add hover tooltip on task ring segments

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Integration — update `summaryOnActivate` to support taskring

**Files:**
- Modify: `static/summary.js`

- [ ] **Step 1: Update widget card creation for taskring**

In `summaryOnActivate`, the REPORT_WIDGETS are iterated to create initial cards. The `machine_utilization` widget now has `chartType: "taskring"` but the canvas-based setup won't work. We need to ensure the widget card body is empty (taskring uses SVG, no canvas).

In `ensureWidgetCard`, when `chartType === "taskring"`, do NOT create a canvas inside:

Actually, `ensureWidgetCard` already doesn't create a canvas - it creates a `.summary-widget-body` div. The canvas is created later in `ensureCanvas`. Since `renderTaskRing` clears `body.innerHTML` and creates SVG directly, no changes needed to `ensureWidgetCard`.

But `ensureCanvas` is called by `renderWidget` before dispatching — wait, no. `renderWidget` dispatches to `renderTaskRing` directly. Let's check the flow:

```javascript
function renderWidget(w) {
  var data = SUMMARY_CACHE[w.id];
  if (!data || data.error) { renderEmptyWidget(w, data ? data.error : "暂无数据"); return; }
  switch(w.chartType) {
    ...
    case "taskring": renderTaskRing(w, data); break;
  }
}
```

`renderTaskRing` doesn't call `ensureCanvas` — it directly manipulates `body`. Good.

- [ ] **Step 2: Update `ensureWidgetCard` to handle taskring card template**

The widget card was previously created with `<canvas></canvas>` inside. For taskring, we don't need canvas. Update the template:

In `ensureWidgetCard`, line ~227:
```javascript
card.innerHTML = '<div class="summary-widget-header" ...><span>' + w.title + '</span>...' +
                 '<div class="summary-widget-body"></div>';
```

Remove the `<canvas></canvas>` from the innerHTML. The body should be empty by default.

Actually, looking at the current code, `ensureWidgetCard` does include `<canvas></canvas>`:
```javascript
card.innerHTML = '...<div class="summary-widget-body"><canvas></canvas></div>';
```

Change to:
```javascript
var bodyContent = (w.chartType === 'taskring') ? '' : '<canvas></canvas>';
card.innerHTML = '<div class="summary-widget-header" onclick="toggleWidget(\'' + w.id + '\')"><span>' + w.title + '</span><span class="summary-widget-toggle">▼</span></div><div class="summary-widget-body">' + bodyContent + '</div>';
```

Similarly, in `summaryOnActivate` where report widgets are created, use the same logic.

- [ ] **Step 3: Update `summaryOnActivate` card creation**

Lines ~1074-1083 in summary.js:
```javascript
card.innerHTML = '<div class="summary-widget-header" ...><span>' + w.title + '</span>...<div class="summary-widget-body"><canvas></canvas></div>';
```

Change the canvas inclusion to be conditional on `w.chartType !== 'taskring'`.

- [ ] **Step 4: Commit**

```bash
git add static/summary.js
git commit -m "fix: update widget card creation for taskring (no canvas needed)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: End-to-end verification

**Files:**
- Verify: `models/summary.py`, `static/summary.js`

- [ ] **Step 1: Start the app and verify the widget renders**

```bash
python app.py
```

Open browser, navigate to summary panel, select today's date and 白班. Verify:
- Machine rings appear in the widget area
- Task segments use correct colors (completed=green, executing=type color, split=purple)
- Hover shows task name and time
- Red line appears if timeline setting is on
- Repair overlay appears on machines with repair records
- 维修停用 machines with tasks show paused/post-pause colors
- Zero-utilization machines are hidden

- [ ] **Step 2: Verify color sync with settings**

Change a machine type color in settings, reload summary. Verify ring task segments update color.

- [ ] **Step 3: Verify no regression on other widgets**

Check that shift_report, machine_status, push_stats, and all trend widgets still render correctly.

- [ ] **Step 4: Commit any fixes**

```bash
git add [fixed files]
git commit -m "fix: end-to-end verification fixes for task ring

Co-Authored-By: Claude <noreply@anthropic.com>"
```
