# 指派任务弹窗重设计 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将指派弹窗从纯表单替换为混合模式：智能预填+推荐算法+mini时间轴预览

**Architecture:** 新弹窗 HTML 替换旧模板，新增推荐算法函数（槽位扫描、负载均衡排序），mini 时间轴复用主时间轴坐标系和 `_createTaskBlock()`，去交互化纯展示。CSS 对齐 drawer-header 风格。

**Tech Stack:** Vanilla JS + CSS + Flask Jinja2 模板

---

### Task 1: 替换弹窗 HTML

**Files:**
- Modify: `templates/dialogs/all.html:243-261`

- [ ] **Step 1: 用新弹窗 HTML 替换旧 assign-dialog**

```html
<!-- 指派任务弹窗 -->
<div id="assign-dialog" style="display:none;position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2000;width:680px;max-width:95vw;max-height:90vh;overflow-y:auto;background:var(--bg-card);border-radius:12px;box-shadow:var(--shadow-xl);">
    <!-- 标题栏：对齐 drawer-header -->
    <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 24px;border-bottom:1px solid var(--border-light);">
        <h2 style="font-size:16px;font-weight:700;display:flex;align-items:center;gap:8px;margin:0;">
            <span style="width:32px;height:32px;background:linear-gradient(135deg,var(--primary),var(--primary-hover));border-radius:8px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px;">&#128204;</span>
            指派任务
        </h2>
        <button onclick="closeAssignDialog()" style="width:32px;height:32px;border-radius:6px;border:none;background:var(--bg-body);font-size:16px;cursor:pointer;color:var(--text-muted);">&times;</button>
    </div>

    <div style="padding:20px 24px;font-size:13px;">
        <!-- 任务信息条 -->
        <div id="assign-task-info" style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--bg-body);border:1px solid var(--border);border-radius:8px;margin-bottom:16px;"></div>

        <!-- 机器选择 -->
        <div style="margin-bottom:14px;">
            <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px;">目标机器</label>
            <div style="display:flex;border:1px solid var(--border);border-radius:8px;overflow:hidden;" id="assign-machine-wrap">
                <select id="assign-machine" onchange="onAssignMachineChange()" style="flex:1;padding:9px 12px;border:none;outline:none;font-size:13px;background:var(--bg-card);"></select>
                <span id="assign-machine-badge" style="display:none;background:#ecfdf5;color:#059669;padding:4px 12px;font-size:10px;font-weight:700;">★推荐</span>
            </div>
        </div>

        <!-- 开始 + 结束 同一行 -->
        <div style="display:flex;gap:16px;margin-bottom:14px;">
            <div style="flex:1;" id="assign-start-group">
                <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px;">开始时间 <span id="assign-start-badge" style="color:#10b981;display:none;">★推荐空档</span></label>
                <div style="display:flex;gap:6px;">
                    <input type="date" id="assign-start-date" onchange="onAssignTimeChange()" style="flex:1;padding:8px 10px;border:2px solid var(--border);border-radius:6px;font-size:13px;min-width:0;">
                    <input type="time" id="assign-start-time" onchange="onAssignTimeChange()" style="flex:1;padding:8px 10px;border:2px solid var(--border);border-radius:6px;font-size:13px;min-width:0;">
                </div>
            </div>
            <div style="flex:1;" id="assign-end-group">
                <label style="font-size:11px;color:var(--text-muted);display:block;margin-bottom:4px;">结束时间 <span style="color:var(--text-muted);">自动</span></label>
                <div style="display:flex;gap:6px;">
                    <input type="date" id="assign-end-date" onchange="onAssignTimeChange()" style="flex:1;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;color:var(--text-muted);min-width:0;">
                    <input type="time" id="assign-end-time" onchange="onAssignTimeChange()" style="flex:1;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;color:var(--text-muted);min-width:0;">
                </div>
            </div>
        </div>

        <!-- 切换推荐 -->
        <button onclick="cycleRecommend()" style="width:100%;padding:7px;font-size:11px;background:var(--bg-body);border:1px dashed var(--border);border-radius:6px;color:var(--text-muted);cursor:pointer;margin-bottom:14px;" id="assign-cycle-btn">🔄 切换推荐组合</button>

        <!-- Mini 时间轴 -->
        <div style="border-top:1px solid var(--border-light);padding-top:14px;margin-bottom:16px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <span style="font-size:12px;font-weight:600;" id="assign-timeline-title">排班预览 <span style="color:var(--text-muted);font-weight:400;">跟随主视图</span></span>
                <span style="font-size:10px;color:var(--text-muted);">← 滚动 →</span>
            </div>
            <div id="assign-mini-timeline" style="overflow-x:auto;border:1px solid var(--border);border-radius:8px;background:var(--bg-body);"></div>
        </div>

        <!-- 冲突提醒 -->
        <div id="assign-conflict-warn" style="display:none;align-items:flex-start;gap:8px;padding:10px 14px;background:#fffbeb;border:1px solid #fde68a;border-radius:6px;font-size:12px;margin-bottom:14px;">
            <span>⚠️</span>
            <div id="assign-conflict-text"></div>
        </div>

        <!-- 按钮 -->
        <div style="display:flex;gap:10px;justify-content:flex-end;">
            <button onclick="closeAssignDialog()" style="padding:9px 22px;border:1px solid var(--border);border-radius:8px;background:var(--bg-card);font-size:13px;cursor:pointer;">取消</button>
            <button onclick="submitAssign()" style="padding:9px 22px;background:linear-gradient(135deg,var(--primary),var(--primary-hover));color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;box-shadow:0 2px 8px rgba(37,99,235,0.3);cursor:pointer;">确认指派 · 覆盖冲突</button>
        </div>
    </div>
    <input type="hidden" id="assign-tid">
</div>
```

---

### Task 2: 重写 JS 逻辑 — 推荐算法 + 弹窗交互

**Files:**
- Modify: `static/task-edit.js:119-197`

- [ ] **Step 1: 槽位扫描函数**

```js
// 扫描某台机器在指定日期范围内，从当前时间开始的可用槽位
// 返回 [{absStart, absEnd}, ...]
function _scanMachineSlots(machineId, date, estMin) {
    var now = new Date();
    var nowAbsMin = _dateMinToAbs(date, now.getHours() * 60 + now.getMinutes());
    // 如果 date 不是今天，从 0 开始
    var todayStr = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
    var startAbs = (date === todayStr) ? Math.max(0, nowAbsMin) : 0;
    var endAbs = startAbs + 2 * MINS_PER_DAY;

    // 取该机器日程
    var machineScheds = [];
    for (var i = 0; i < schedules.length; i++) {
        var s = schedules[i];
        if (s.machine_id !== machineId) continue;
        var a = s.abs_start_min != null ? s.abs_start_min : _dateMinToAbs(s.date, s.start_min);
        var b = s.abs_end_min != null ? s.abs_end_min : _dateMinToAbs(s.date, s.end_min);
        machineScheds.push({absStart: a, absEnd: b, name: s.task_name});
    }
    machineScheds.sort(function(x, y) { return x.absStart - y.absStart; });

    var slots = [];
    var cursor = startAbs;
    for (var i = 0; i < machineScheds.length; i++) {
        var gap = machineScheds[i].absStart - cursor;
        if (gap >= estMin) {
            slots.push({absStart: cursor, absEnd: cursor + estMin, conflict: false});
        }
        cursor = Math.max(cursor, machineScheds[i].absEnd);
    }
    // 末尾到 endAbs
    if (endAbs - cursor >= estMin) {
        slots.push({absStart: cursor, absEnd: cursor + estMin, conflict: false});
    }
    return slots;
}
```

- [ ] **Step 2: 推荐排序函数**

```js
// 负载均衡排序：当日任务数 ASC → slot开始时间 ASC
function _rankRecommendations(taskType, estMin) {
    var date = document.getElementById('assign-start-date').value;
    var result = [];
    for (var i = 0; i < MACHINES_DATA.length; i++) {
        var m = MACHINES_DATA[i];
        if (m.type !== taskType) continue;
        if (m.status === '维修停用') continue;
        // 计算当日任务数
        var taskCount = 0;
        for (var j = 0; j < schedules.length; j++) {
            if (schedules[j].machine_id === m.id) taskCount++;
        }
        var slots = _scanMachineSlots(m.id, date, estMin);
        for (var k = 0; k < slots.length; k++) {
            result.push({machine: m, slot: slots[k], taskCount: taskCount});
        }
    }
    result.sort(function(a, b) {
        if (a.taskCount !== b.taskCount) return a.taskCount - b.taskCount;
        return a.slot.absStart - b.slot.absStart;
    });
    return result;
}
```

- [ ] **Step 3: 重写 openAssignDialog**

```js
function openAssignDialog(tid) {
    var t = getTaskById(tid);
    if (!t) return;
    var dlg = document.getElementById('assign-dialog');
    dlg.style.display = 'block';
    document.getElementById('assign-tid').value = String(tid);

    var estMin = t.est_seconds ? Math.round(t.est_seconds / 60) : 30;

    // 任务信息条
    var infoEl = document.getElementById('assign-task-info');
    infoEl.innerHTML = '<span style="font-weight:600;">' + escHtml(t.name) + '</span>' +
        '<span style="font-size:11px;color:var(--text-muted);">' + escHtml(t.type) + ' / ' + escHtml(t.task_kind||'') + ' / ' + escHtml(t.priority||'') + '</span>' +
        '<span style="margin-left:auto;font-size:11px;background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:4px;">' + estMin + '分</span>';

    // 日期默认今天
    var now = new Date();
    var todayStr = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
    document.getElementById('assign-start-date').value = todayStr;
    document.getElementById('assign-end-date').value = todayStr;

    window._assignTid = tid;
    window._assignEstMin = estMin;
    window._assignRecommendList = [];
    window._assignRecommendIdx = -1;
    window._assignManualMode = false;

    // 填充机器下拉
    _populateMachineSelect(t.type);

    // 跑推荐
    window._assignRecommendList = _rankRecommendations(t.type || '', estMin);
    if (window._assignRecommendList.length > 0) {
        _applyRecommend(0);
    } else {
        // 无可用机器
        document.getElementById('assign-machine').innerHTML = '<option value="">无可用机器</option>';
    }

    // 渲染 mini 时间轴（延迟等机器选定后）
    setTimeout(function() { _renderAssignTimeline(); }, 100);
}
```

- [ ] **Step 4: _applyRecommend 函数**

```js
function _applyRecommend(idx) {
    if (idx < 0 || idx >= window._assignRecommendList.length) idx = 0;
    window._assignRecommendIdx = idx;
    window._assignManualMode = false;
    var rec = window._assignRecommendList[idx];
    var m = rec.machine;
    var slot = rec.slot;

    // 更新机器下拉
    document.getElementById('assign-machine').value = String(m.id);
    document.getElementById('assign-machine-badge').style.display = 'inline-block';

    // 更新开始时间
    var startH = Math.floor(minuteInDay(slot.absStart) / 60);
    var startM = minuteInDay(slot.absStart) % 60;
    document.getElementById('assign-start-time').value = String(startH).padStart(2,'0') + ':' + String(startM).padStart(2,'0');
    // 日期跟随 absStart 的偏移
    var startDayOff = dayOffset(slot.absStart);
    var startDate = _dateAddDays(document.getElementById('assign-start-date').value, startDayOff);
    document.getElementById('assign-start-date').value = startDate;

    // 更新结束时间（自动 = 开始 + estMin）
    var endAbs = slot.absStart + window._assignEstMin;
    var endH = Math.floor(minuteInDay(endAbs) / 60);
    var endM = minuteInDay(endAbs) % 60;
    document.getElementById('assign-end-time').value = String(endH).padStart(2,'0') + ':' + String(endM).padStart(2,'0');
    var endDayOff = dayOffset(endAbs);
    var endDate = _dateAddDays(startDate, endDayOff);
    document.getElementById('assign-end-date').value = endDate;

    // 样式：开始绿色高亮
    document.getElementById('assign-start-date').style.border = '2px solid #10b981';
    document.getElementById('assign-start-time').style.border = '2px solid #10b981';
    document.getElementById('assign-start-date').style.background = '#f0fdf4';
    document.getElementById('assign-start-time').style.background = '#f0fdf4';
    document.getElementById('assign-start-badge').style.display = 'inline';
    // 结束灰色
    document.getElementById('assign-end-date').style.border = '1px solid var(--border)';
    document.getElementById('assign-end-time').style.border = '1px solid var(--border)';

    _updateConflictWarn(slot);
    _renderAssignTimeline();

    // 切换按钮
    var btn = document.getElementById('assign-cycle-btn');
    btn.style.display = (window._assignRecommendList.length > 1) ? '' : 'none';
}
```

- [ ] **Step 5: cycleRecommend + 手动变更回调**

```js
function cycleRecommend() {
    if (!window._assignRecommendList || window._assignRecommendList.length === 0) return;
    var next = (window._assignRecommendIdx + 1) % window._assignRecommendList.length;
    _applyRecommend(next);
}

function onAssignMachineChange() {
    if (window._assignManualMode) return;
    // 手动改机器 → 重置为该机器的第一个推荐
    var mid = parseInt(document.getElementById('assign-machine').value, 10);
    for (var i = 0; i < window._assignRecommendList.length; i++) {
        if (window._assignRecommendList[i].machine.id === mid) {
            _applyRecommend(i);
            return;
        }
    }
    // 没找到 → 退出推荐模式
    window._assignManualMode = true;
    document.getElementById('assign-machine-badge').style.display = 'none';
    document.getElementById('assign-start-badge').style.display = 'none';
    _renderAssignTimeline();
}

function onAssignTimeChange() {
    if (window._assignManualMode) {
        _renderAssignTimeline();
        return;
    }
    window._assignManualMode = true;
    document.getElementById('assign-start-date').style.border = '1px solid var(--border)';
    document.getElementById('assign-start-time').style.border = '1px solid var(--border)';
    document.getElementById('assign-start-date').style.background = '';
    document.getElementById('assign-start-time').style.background = '';
    document.getElementById('assign-start-badge').style.display = 'none';
    document.getElementById('assign-machine-badge').style.display = 'none';
    _renderAssignTimeline();
}
```

- [ ] **Step 6: 冲突检测**

```js
function _updateConflictWarn(slot) {
    var warnEl = document.getElementById('assign-conflict-warn');
    var textEl = document.getElementById('assign-conflict-text');
    // 扫描同一机器该时段的冲突
    var mid = parseInt(document.getElementById('assign-machine').value, 10);
    var conflicts = [];
    for (var i = 0; i < schedules.length; i++) {
        var s = schedules[i];
        if (s.machine_id !== mid) continue;
        var a = s.abs_start_min != null ? s.abs_start_min : _dateMinToAbs(s.date, s.start_min);
        var b = s.abs_end_min != null ? s.abs_end_min : _dateMinToAbs(s.date, s.end_min);
        if (a < slot.absEnd && b > slot.absStart) {
            conflicts.push(s.task_name || ('任务#' + s.task_id));
        }
    }
    if (conflicts.length > 0) {
        warnEl.style.display = 'flex';
        textEl.innerHTML = '<strong>冲突提醒：</strong>该时段与<strong>' + escHtml(conflicts.join('、')) + '</strong>重叠，确认后将自动消除并顺延后续任务。';
    } else {
        warnEl.style.display = 'none';
    }
}
```

---

### Task 3: Mini 时间轴渲染

**Files:**
- Modify: `static/task-edit.js` (新增函数)

- [ ] **Step 1: 渲染 mini 时间轴函数**

```js
function _renderAssignTimeline() {
    var container = document.getElementById('assign-mini-timeline');
    if (!container) return;
    var mid = parseInt(document.getElementById('assign-machine').value, 10);

    // 获取视图范围
    var range = getViewRange();
    var vs = range[0], ve = range[1];
    if (ve <= vs) ve = vs + MINS_PER_DAY;
    var totalMin = ve - vs;
    var hw = getHourWidth();
    var totalPx = (totalMin / MINS_PER_HOUR) * hw + 100; // +100 for date label

    // 获取小时标签
    var labels = _hourLabelsForRange(vs, ve);
    var headerHtml = '<div style="display:flex;border-bottom:1px solid var(--border);font-size:10px;color:var(--text-muted);min-width:' + totalPx + 'px;">';
    headerHtml += '<span style="min-width:100px;padding:4px 8px;border-right:1px solid var(--border);flex-shrink:0;">日期</span>';
    for (var i = 0; i < labels.labels.length; i++) {
        headerHtml += '<span style="flex:1;min-width:' + hw + 'px;padding:4px 2px;text-align:center;border-right:1px solid var(--border-light);">' + labels.labels[i] + '</span>';
    }
    headerHtml += '</div>';

    // 轨道
    var trackHtml = '<div style="position:relative;height:52px;min-width:' + totalPx + 'px;">';
    // 竖线
    trackHtml += '<div style="position:absolute;top:0;left:0;right:0;bottom:0;display:flex;">';
    trackHtml += '<div style="min-width:100px;flex-shrink:0;"></div>';
    for (var i = 0; i < labels.labels.length; i++) {
        trackHtml += '<div style="flex:1;min-width:' + hw + 'px;border-right:1px solid var(--border-light);"></div>';
    }
    trackHtml += '</div>';

    // 已有任务块
    for (var i = 0; i < schedules.length; i++) {
        var s = schedules[i];
        if (s.machine_id !== mid) continue;
        var a = s.abs_start_min != null ? s.abs_start_min : _dateMinToAbs(s.date, s.start_min);
        var b = s.abs_end_min != null ? s.abs_end_min : _dateMinToAbs(s.date, s.end_min);
        var leftPx = minToPx(a - vs) + 100;
        var widthPx = minToPx(Math.max(1, b - a));
        var typeIdx = (typeof TYPE_INDEX_MAP !== 'undefined' && TYPE_INDEX_MAP[s.task_type] !== undefined) ? TYPE_INDEX_MAP[s.task_type] : 0;
        var nameHtml = escHtml((s.task_name||'') + '(' + (s.task_type||'') + ') ' + _formatAbsMin(a) + '-' + _formatAbsMin(b));
        trackHtml += '<div class="task-block task-type-' + typeIdx + '" style="position:absolute;top:8px;left:' + leftPx + 'px;width:' + widthPx + 'px;height:16px;white-space:nowrap;overflow:hidden;font-size:9px;line-height:16px;pointer-events:none;">' + nameHtml + '</div>';
    }

    // 绿色虚线框（新任务）
    var startH = hhmmToMin(document.getElementById('assign-start-time').value);
    var startDate = document.getElementById('assign-start-date').value;
    var endH = hhmmToMin(document.getElementById('assign-end-time').value);
    var endDate = document.getElementById('assign-end-date').value;
    if (startH !== null && endH !== null) {
        var absStart = _dateMinToAbs(startDate, startH);
        var absEnd = _dateMinToAbs(endDate, endH);
        var greenLeft = minToPx(absStart - vs) + 100;
        var greenWidth = minToPx(Math.max(1, absEnd - absStart));
        trackHtml += '<div style="position:absolute;top:4px;left:' + greenLeft + 'px;width:' + greenWidth + 'px;height:44px;background:rgba(16,185,129,0.12);border:2px dashed #10b981;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:10px;color:#059669;font-weight:600;pointer-events:none;">' + window._assignEstMin + '分</div>';
    }

    // now 红线
    var now = new Date();
    var nowMin = now.getHours() * 60 + now.getMinutes();
    var nowAbs = _dateMinToAbs(document.getElementById('schedule-date').value, nowMin);
    if (nowAbs >= vs && nowAbs <= ve) {
        var nowPx = minToPx(nowAbs - vs) + 100;
        trackHtml += '<div style="position:absolute;top:0;bottom:0;left:' + nowPx + 'px;width:1px;background:#ef4444;z-index:5;pointer-events:none;"></div>';
    }

    trackHtml += '</div>';

    container.innerHTML = headerHtml + trackHtml;
}
```

- [ ] **Step 2: 在机器变更/时间变更时自动调用 `_renderAssignTimeline`** 已在上述函数中处理

---

### Task 4: 更新 submitAssign

**Files:**
- Modify: `static/task-edit.js:178-197`

- [ ] **Step 1: 更新 submitAssign 适配新字段名**

```js
function submitAssign(){
    var tid = parseInt(document.getElementById('assign-tid').value||'0',10);
    var mid = parseInt(document.getElementById('assign-machine').value||'0',10);
    var startDate = document.getElementById('assign-start-date').value;
    var endDate = document.getElementById('assign-end-date').value;
    var s = hhmmToMin(document.getElementById('assign-start-time').value);
    var e = hhmmToMin(document.getElementById('assign-end-time').value);
    if(!tid || !mid || !startDate || s===null || e===null){ alert('参数不完整'); return; }
    var start = s, end = e;
    if(end <= start && startDate === endDate) end = start + 1;
    fetch('/assign_task',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({date: startDate, end_date: endDate, task_id: tid, machine_id: mid, start_min: start, end_min: end})
    }).then(function(r){ return r.json(); }).then(function(d){
        showToast(d.msg);
        closeAssignDialog();
        _silentRefresh();
    });
}
```

---

### 验证步骤

- [ ] 从任务库点击"指派"，弹窗打开，标题栏风格与修改抽屉一致
- [ ] 机器自动推荐（★推荐标记），时间自动填充最早空档（绿色高亮）
- [ ] 拖动主时间轴缩放 → mini 时间轴同步变化
- [ ] 切换视图模式（日班/夜班/双班）→ mini 时间轴同步
- [ ] 🔄 切换推荐 → 机器+时间循环切换，绿色框更新
- [ ] 手动修改时间 → 退出推荐模式，绿色框实时更新
- [ ] 切换到浮动窗口等池区模式不影响弹窗
- [ ] 冲突时黄色警告条显示，无冲突时隐藏
- [ ] 确认指派 → 任务正确分配到指定机器和时间
