// golden scheduling app — task editing (add/edit/delete/recycle/assign)
// 依赖：core.js, task-table.js, task-status.js

var _taskEditMode = 'blank';

function _getEstMode(){
    var el = document.querySelector('input[name="t_est_mode"]:checked');
    return el ? el.value : 'blank';
}
function toggleEstMode(){
    var mode = _getEstMode();
    document.getElementById('est-direct').style.display = (mode==='direct') ? 'inline-block' : 'none';
    document.getElementById('est-calc').style.display = (mode==='calc') ? 'inline-block' : 'none';
    if(mode!=='calc'){
        var pv = document.getElementById('calc-preview');
        if(pv) pv.textContent = '';
    }
}
function applyCountQuick(){
    var v = document.getElementById('t_count_quick').value;
    if(v) {
        document.getElementById('t_count').value = v;
        document.getElementById('t_expcnt').value = v;
    }
}
function syncCountToExpcnt(srcId, dstId){
    var el = document.getElementById(srcId);
    var v = parseInt(el.value, 10);
    if (isNaN(v)) return;
    if (v < 0) { v = Math.abs(v); el.value = v; }
    if (v) document.getElementById(dstId).value = String(v);
}
function previewCalc(){
    var op = parseInt(document.getElementById('t_op').value||'0',10) || 0;
    var rs = parseInt(document.getElementById('t_reset').value||'0',10) || 0;
    var cnt = parseInt(document.getElementById('t_count').value||'0',10) || 0;
    var red = parseInt(document.getElementById('t_red').value||'0',10) || 0;
    var est = (op+rs)*cnt + red*60;
    document.getElementById('calc-preview').textContent = '预估：' + est + ' 秒 (' + Math.round(est/60) + ' 分钟)';
    return est;
}
function previewEditCalc() {
    var op = parseInt(document.getElementById('ed_op').value || '0', 10) || 0;
    var rs = parseInt(document.getElementById('ed_reset').value || '0', 10) || 0;
    var cnt = parseInt(document.getElementById('ed_count').value || '0', 10) || 0;
    var red = parseInt(document.getElementById('ed_red').value || '0', 10) || 0;
    var est = (op + rs) * cnt + red * 60;
    document.getElementById('ed-calc-preview').textContent = '预估：' + est + ' 秒 (' + Math.round(est / 60) + ' 分钟)';
    return est;
}

function addTask(){
    var name = (document.getElementById('t_name').value || '').trim();
    var rbpId = (document.getElementById('t_rbp_id') ? document.getElementById('t_rbp_id').value : '').trim();
    if (!name && !rbpId) {
        showToast('任务名和RBP任务ID至少需要填写一个');
        return;
    }
    if (!name && rbpId) {
        showConfirm('创建任务', '<p>任务名为空，将仅使用RBP任务ID作为标识，确认创建？</p>').then(function(ok){
            if(!ok) return;
            doAddTask(name);
        });
        return;
    }
    doAddTask(name);
}

function doAddTask(name){
    var mode = _getEstMode();
    var tExpcntRaw = parseInt((document.getElementById('t_expcnt')||{}).value||'0',10);
    var payload = {
        name: name,
        type: document.getElementById('t_type').value,
        task_kind: document.getElementById('t_kind').value,
        pri: document.getElementById('t_pri').value,
        diff: document.getElementById('t_diff').value,
        remark: (document.getElementById('t_remark').value || '').trim(),
        est_mode: mode,
        rbp_task_id: (document.getElementById('t_rbp_id') ? document.getElementById('t_rbp_id').value : '').trim(),
        scene: (document.getElementById('t_scene') ? document.getElementById('t_scene').value : '').trim(),
        general_category: (document.getElementById('t_gcat') ? document.getElementById('t_gcat').value : '').trim(),
        source_link: (document.getElementById('t_slink') ? document.getElementById('t_slink').value : '').trim(),
        expected_count: isNaN(tExpcntRaw) ? null : tExpcntRaw,
        collection_req_id: (document.getElementById('t_creqid') ? document.getElementById('t_creqid').value : '').trim(),
        collection_req_type: (document.getElementById('t_creqtype') ? document.getElementById('t_creqtype').value : '').trim()
    };
    if(mode === 'direct'){
        payload.duration = (document.getElementById('t_duration').value || '').trim();
    }else if(mode === 'calc'){
        payload.op_min = parseInt(document.getElementById('t_op').value||'0',10) || 0;
        payload.reset_min = parseInt(document.getElementById('t_reset').value||'0',10) || 0;
        payload.collect_count = parseInt(document.getElementById('t_count').value||'0',10) || 0;
        payload.redundancy_min = parseInt(document.getElementById('t_red').value||'0',10) || 0;
    }
    fetch('/add_task',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
        .then(function(r){ return r.json(); }).then(function(d){
            showToast(d.msg);
            _silentRefresh();
        });
}

function delTask(id){
    showConfirm('删除任务', '<p>确定删除此任务？删除后可在"删除记录"中恢复。</p>').then(function(ok){
        if(!ok) return;
        document.querySelectorAll('.task-block[data-tid="'+id+'"]').forEach(function(b){ b.remove(); });
        document.querySelectorAll('.task-draggable[data-tid="'+id+'"]').forEach(function(b){ b.remove(); });
        TASKS_DATA = TASKS_DATA.filter(function(t){ return t.id !== id; });
        schedules = schedules.filter(function(s){ return s.task_id != id; });
        fetch('/del_task/'+id).then(function(r){ return r.json(); }).then(function(d){
            showToast(d.msg);
            _silentRefresh();
        });
    });
}

function assignTask(id){ alert("请直接拖拽任务到时间轴！"); }

// ========== 指派任务（新版：推荐算法 + mini 时间轴） ==========

// 扫描某台机器从指定日期当前时间开始的可用槽位
function _scanMachineSlots(machineId, date, estMin) {
    var now = new Date();
    var nowAbsMin = now.getHours() * 60 + now.getMinutes();
    var todayStr = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
    var startAbs = (date === todayStr) ? _dateMinToAbs(date, Math.max(0, nowAbsMin)) : _dateMinToAbs(date, 0);
    var endAbs = startAbs + 2 * MINS_PER_DAY;

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
            slots.push({absStart: cursor, absEnd: cursor + estMin});
        }
        cursor = Math.max(cursor, machineScheds[i].absEnd);
    }
    if (endAbs - cursor >= estMin) {
        slots.push({absStart: cursor, absEnd: cursor + estMin});
    }
    return slots;
}

// 负载均衡排序：机器当日任务数 ASC → 槽位开始时间 ASC
function _rankRecommendations(machines, taskType, estMin) {
    var date = document.getElementById('assign-start-date').value;
    var result = [];
    for (var i = 0; i < machines.length; i++) {
        var m = machines[i];
        if (m.type !== taskType) continue;
        if (m.status === '维修停用') continue;
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

function _applyRecommend(idx) {
    var list = window._assignRecommendList;
    if (!list || list.length === 0) return;
    if (idx < 0 || idx >= list.length) idx = 0;
    window._assignRecommendIdx = idx;
    window._assignManualMode = false;
    var rec = list[idx];
    var m = rec.machine;
    var slot = rec.slot;
    var startDate = document.getElementById('assign-start-date').value;

    document.getElementById('assign-machine').value = String(m.id);
    document.getElementById('assign-machine-badge').style.display = 'inline-block';

    var startH = Math.floor(minuteInDay(slot.absStart) / 60);
    var startM = minuteInDay(slot.absStart) % 60;
    document.getElementById('assign-start-time').value = String(startH).padStart(2,'0') + ':' + String(startM).padStart(2,'0');
    var startDayOff = dayOffset(slot.absStart);
    document.getElementById('assign-start-date').value = _dateAddDays(startDate, startDayOff);

    var endAbs = slot.absStart + window._assignEstMin;
    var endH = Math.floor(minuteInDay(endAbs) / 60);
    var endM = minuteInDay(endAbs) % 60;
    document.getElementById('assign-end-time').value = String(endH).padStart(2,'0') + ':' + String(endM).padStart(2,'0');
    var endDayOff = dayOffset(endAbs);
    document.getElementById('assign-end-date').value = _dateAddDays(startDate, endDayOff);

    // 开始绿色高亮
    var sdEl = document.getElementById('assign-start-date');
    var stEl = document.getElementById('assign-start-time');
    sdEl.style.border = '2px solid #10b981';
    stEl.style.border = '2px solid #10b981';
    sdEl.style.background = '#f0fdf4';
    stEl.style.background = '#f0fdf4';
    document.getElementById('assign-start-badge').style.display = 'inline';
    var edEl = document.getElementById('assign-end-date');
    var etEl = document.getElementById('assign-end-time');
    edEl.style.border = '1px solid var(--border)';
    etEl.style.border = '1px solid var(--border)';
    edEl.style.background = '';
    etEl.style.background = '';

    _updateConflictWarn();
    _renderAssignTimeline();

    var btn = document.getElementById('assign-cycle-btn');
    if (btn) btn.style.display = (list.length > 1) ? '' : 'none';
}

function cycleRecommend() {
    var list = window._assignRecommendList;
    if (!list || list.length === 0) return;
    var next = (window._assignRecommendIdx + 1) % list.length;
    _applyRecommend(next);
}

function onAssignMachineChange() {
    if (window._assignManualMode) return;
    var mid = parseInt(document.getElementById('assign-machine').value, 10);
    var list = window._assignRecommendList;
    for (var i = 0; i < list.length; i++) {
        if (list[i].machine.id === mid) { _applyRecommend(i); return; }
    }
    window._assignManualMode = true;
    document.getElementById('assign-machine-badge').style.display = 'none';
    document.getElementById('assign-start-badge').style.display = 'none';
    _renderAssignTimeline();
}

function onAssignTimeChange() {
    if (window._assignManualMode) { _updateConflictWarn(); _renderAssignTimeline(); return; }
    window._assignManualMode = true;
    var sdEl = document.getElementById('assign-start-date');
    var stEl = document.getElementById('assign-start-time');
    sdEl.style.border = '1px solid var(--border)';
    stEl.style.border = '1px solid var(--border)';
    sdEl.style.background = '';
    stEl.style.background = '';
    document.getElementById('assign-start-badge').style.display = 'none';
    document.getElementById('assign-machine-badge').style.display = 'none';
    _updateConflictWarn();
    _renderAssignTimeline();
}

function _updateConflictWarn() {
    var warnEl = document.getElementById('assign-conflict-warn');
    var textEl = document.getElementById('assign-conflict-text');
    var mid = parseInt(document.getElementById('assign-machine').value, 10);
    var startDate = document.getElementById('assign-start-date').value;
    var endDate = document.getElementById('assign-end-date').value;
    var s = hhmmToMin(document.getElementById('assign-start-time').value);
    var e = hhmmToMin(document.getElementById('assign-end-time').value);
    if (s === null || e === null || !mid) { warnEl.style.display = 'none'; return; }
    var absStart = _dateMinToAbs(startDate, s);
    var absEnd = _dateMinToAbs(endDate, e);
    var conflicts = [];
    for (var i = 0; i < schedules.length; i++) {
        var sch = schedules[i];
        if (sch.machine_id !== mid) continue;
        var a = sch.abs_start_min != null ? sch.abs_start_min : _dateMinToAbs(sch.date, sch.start_min);
        var b = sch.abs_end_min != null ? sch.abs_end_min : _dateMinToAbs(sch.date, sch.end_min);
        if (a < absEnd && b > absStart) {
            conflicts.push(sch.task_name || ('任务#' + sch.task_id));
        }
    }
    if (conflicts.length > 0) {
        warnEl.style.display = 'flex';
        textEl.innerHTML = '<strong>冲突提醒：</strong>该时段与<strong>' + escHtml(conflicts.join('、')) + '</strong>重叠，确认后将自动消除并顺延后续任务。';
    } else {
        warnEl.style.display = 'none';
    }
}

function _renderAssignTimeline() {
    var container = document.getElementById('assign-mini-timeline');
    if (!container) return;
    var mid = parseInt(document.getElementById('assign-machine').value, 10);
    var range = getViewRange();
    var vs = range[0], ve = range[1];
    if (ve <= vs) ve = vs + MINS_PER_DAY;
    var totalMin = ve - vs;
    var hw = getHourWidth();
    var totalPx = (totalMin / MINS_PER_HOUR) * hw + 100;

    var labels = _hourLabelsForRange(vs, ve);
    var headerHtml = '<div style="display:flex;border-bottom:1px solid var(--border);font-size:10px;color:var(--text-muted);min-width:' + totalPx + 'px;">';
    headerHtml += '<span style="min-width:100px;padding:4px 8px;border-right:1px solid var(--border);flex-shrink:0;"></span>';
    for (var i = 0; i < labels.labels.length; i++) {
        headerHtml += '<span style="flex:1;min-width:' + hw + 'px;padding:4px 2px;text-align:center;border-right:1px solid var(--border-light);">' + labels.labels[i] + '</span>';
    }
    headerHtml += '</div>';

    var trackHtml = '<div style="position:relative;height:52px;min-width:' + totalPx + 'px;">';
    trackHtml += '<div style="position:absolute;top:0;left:0;right:0;bottom:0;display:flex;">';
    trackHtml += '<div style="min-width:100px;flex-shrink:0;"></div>';
    for (var i = 0; i < labels.labels.length; i++) {
        trackHtml += '<div style="flex:1;min-width:' + hw + 'px;border-right:1px solid var(--border-light);"></div>';
    }
    trackHtml += '</div>';

    // 已有任务块
    if (mid) {
        for (var i = 0; i < schedules.length; i++) {
            var s = schedules[i];
            if (s.machine_id !== mid) continue;
            var a = s.abs_start_min != null ? s.abs_start_min : _dateMinToAbs(s.date, s.start_min);
            var b = s.abs_end_min != null ? s.abs_end_min : _dateMinToAbs(s.date, s.end_min);
            var leftPx = minToPx(a - vs) + 100;
            var widthPx = Math.max(4, minToPx(Math.max(1, b - a)));
            var typeIdx = (typeof TYPE_INDEX_MAP !== 'undefined' && TYPE_INDEX_MAP[s.task_type] !== undefined) ? TYPE_INDEX_MAP[s.task_type] : 0;
            var blockText = escHtml((s.task_name||'') + ' ' + _formatAbsMin(a) + '-' + _formatAbsMin(b));
            trackHtml += '<div class="task-block task-type-' + typeIdx + '" style="position:absolute;top:8px;left:' + leftPx + 'px;width:' + widthPx + 'px;height:16px;line-height:16px;font-size:9px;white-space:nowrap;overflow:hidden;pointer-events:none;">' + blockText + '</div>';
        }
    }

    // 绿色虚线框
    var startH = hhmmToMin(document.getElementById('assign-start-time').value);
    var startDate = document.getElementById('assign-start-date').value;
    var endH = hhmmToMin(document.getElementById('assign-end-time').value);
    var endDate = document.getElementById('assign-end-date').value;
    if (startH !== null && endH !== null && startDate && endDate) {
        var asgnAbsStart = _dateMinToAbs(startDate, startH);
        var asgnAbsEnd = _dateMinToAbs(endDate, endH);
        var greenLeft = minToPx(asgnAbsStart - vs) + 100;
        var greenW = Math.max(4, minToPx(Math.max(1, asgnAbsEnd - asgnAbsStart)));
        var estMin = window._assignEstMin || 0;
        trackHtml += '<div style="position:absolute;top:4px;left:' + greenLeft + 'px;width:' + greenW + 'px;height:44px;background:rgba(16,185,129,0.12);border:2px dashed #10b981;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:10px;color:#059669;font-weight:600;pointer-events:none;">' + estMin + '分</div>';
    }

    // now 红线
    var now = new Date();
    var nowMin = now.getHours() * 60 + now.getMinutes();
    var schedDate = document.getElementById('schedule-date');
    var baseDate = schedDate ? schedDate.value : startDate;
    var nowAbs = _dateMinToAbs(baseDate, nowMin);
    if (nowAbs >= vs && nowAbs <= ve) {
        var nowPx = minToPx(nowAbs - vs) + 100;
        trackHtml += '<div style="position:absolute;top:0;bottom:0;left:' + nowPx + 'px;width:1px;background:#ef4444;z-index:5;pointer-events:none;"></div>';
    }

    trackHtml += '</div>';
    container.innerHTML = headerHtml + trackHtml;
}

function openAssignDialog(tid){
    var t = getTaskById(tid);
    if (!t) return;
    var dlg = document.getElementById('assign-dialog');
    dlg.style.display = 'block';
    document.getElementById('assign-tid').value = String(tid);

    var estMin = t.est_seconds ? Math.round(t.est_seconds / 60) : 30;
    var now = new Date();
    var todayStr = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');

    var infoEl = document.getElementById('assign-task-info');
    infoEl.innerHTML = '<span style="font-weight:600;">' + escHtml(t.name) + '</span>' +
        '<span style="font-size:11px;color:var(--text-muted);">' + escHtml(t.type||'') + ' / ' + escHtml(t.task_kind||'') + ' / ' + escHtml(t.priority||'') + '</span>' +
        '<span style="margin-left:auto;font-size:11px;background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:4px;">' + estMin + '分</span>';

    document.getElementById('assign-start-date').value = todayStr;
    document.getElementById('assign-end-date').value = todayStr;

    window._assignTid = tid;
    window._assignEstMin = estMin;
    window._assignRecommendList = [];
    window._assignRecommendIdx = -1;
    window._assignManualMode = false;

    // 填充机器下拉
    var sel = document.getElementById('assign-machine');
    sel.innerHTML = '<option value="">加载中...</option>';
    fetch('/api/machines').then(function(r){ return r.json(); }).then(function(data){
        if (!data.machines) {
            sel.innerHTML = '<option value="">' + escHtml(data.msg || '加载失败') + '</option>';
            return;
        }
        sel.innerHTML = '';
        var filtered = data.machines.filter(function(m){ return !t.type || m.type === t.type; });
        filtered.forEach(function(m){
            var opt = document.createElement('option');
            opt.value = String(m.id);
            var repairTag = (m.status === '维修停用') ? ' [维修]' : '';
            opt.textContent = m.name + '(' + m.type + ')' + repairTag;
            if (m.status === '维修停用') opt.style.color = '#f56c6c';
            sel.appendChild(opt);
        });
        if (filtered.length === 0) {
            var opt = document.createElement('option');
            opt.value = ''; opt.textContent = '无可用机器'; sel.appendChild(opt);
        }

        // 跑推荐
        window._assignRecommendList = _rankRecommendations(data.machines, t.type || '', estMin);
        if (window._assignRecommendList.length > 0) {
            _applyRecommend(0);
        }
        _renderAssignTimeline();
    }).catch(function(e){
        sel.innerHTML = '<option value="">加载失败（网络错误）</option>';
    });

    // 开始时间变更时自动计算结束时间
    var startInp = document.getElementById('assign-start-time');
    var endInp = document.getElementById('assign-end-time');
    var startDateInp = document.getElementById('assign-start-date');
    var endDateInp = document.getElementById('assign-end-date');
    if (startInp && endInp && estMin > 0) {
        startInp.oninput = function() {
            var sm = hhmmToMin(this.value);
            if (sm !== null) {
                var em = sm + estMin;
                var hh = String(Math.floor(minuteInDay(em) / MINS_PER_HOUR)).padStart(2,'0');
                var mm = String(minuteInDay(em) % MINS_PER_HOUR).padStart(2,'0');
                endInp.value = hh + ':' + mm;
                if (em >= MINS_PER_DAY) {
                    endDateInp.value = _dateAddDays(startDateInp.value, 1);
                } else {
                    endDateInp.value = startDateInp.value;
                }
                onAssignTimeChange();
            }
        };
    }
}

function closeAssignDialog(){
    document.getElementById('assign-dialog').style.display = 'none';
}

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

function openEditDrawer(tid) {
    var t = getTaskById(tid);
    if (!t) return;
    document.getElementById('edit-tid').value = String(tid);
    document.getElementById('ed_name').value = t.name || '';
    document.getElementById('ed_type').value = t.type || (APP_CONFIG.machine_types[0] && APP_CONFIG.machine_types[0].key) || '';
    document.getElementById('ed_kind').value = t.task_kind || '常规';
    document.getElementById('ed_pri').value = t.priority || 'P1';
    document.getElementById('ed_diff').value = t.difficulty || '普通';
    var estMode = t.est_mode || 'auto';
    var radio = document.querySelector('input[name="ed_est_mode"][value="' + estMode + '"]');
    if (radio) { radio.checked = true; }
    else { document.querySelector('input[name="ed_est_mode"][value="auto"]').checked = true; }
    document.getElementById('ed_duration').value = t.duration || '';
    document.getElementById('ed_op').value = t.op_min || '';
    document.getElementById('ed_reset').value = t.reset_min || '';
    document.getElementById('ed_count').value = t.collect_count || '';
    document.getElementById('ed_red').value = t.redundancy_min || '0';
    document.getElementById('ed_remark').value = t.remark || '';
    document.getElementById('ed_rbp_id').value = t.rbp_task_id || '';
    document.getElementById('ed_scene').value = t.scene || '';
    document.getElementById('ed_gcat').value = t.general_category || '';
    document.getElementById('ed_slink').value = t.source_link || '';
    document.getElementById('ed_expcnt').value = t.expected_count || '';
    document.getElementById('ed_creqid').value = t.collection_req_id || '';
    document.getElementById('ed_creqtype').value = t.collection_req_type || '';
    toggleEditEstMode();
    document.getElementById('task-edit-drawer').style.display = 'block';
}

function closeEditDrawer() {
    var panel = document.getElementById('drawer-panel');
    panel.classList.add('closing');
    setTimeout(function() {
        document.getElementById('task-edit-drawer').style.display = 'none';
        panel.classList.remove('closing');
    }, 150);
}

// 保持旧函数名兼容
function openEditDialog(tid) { openEditDrawer(tid); }
function closeEditDialog() { closeEditDrawer(); }

function toggleEditEstMode(){
    var mode = (document.querySelector('input[name="ed_est_mode"]:checked')||{}).value || 'auto';
    document.getElementById('ed-direct').style.display = (mode==='direct') ? 'inline-block' : 'none';
    document.getElementById('ed-calc').style.display = (mode==='calc') ? 'inline-block' : 'none';
    // auto/blank: hide calc inputs
    if (mode !== 'calc') {
        var pv = document.getElementById('ed-calc-preview');
        if (pv) pv.textContent = '';
    }
    // auto: hide direct inputs too
    if (mode === 'auto') {
        document.getElementById('ed-direct').style.display = 'none';
    }
}

function submitEditDrawer() {
    var name = (document.getElementById('ed_name').value || '').trim();
    var rbpId = (document.getElementById('ed_rbp_id').value || '').trim();
    if (!name && !rbpId) {
        showToast('任务名和RBP任务ID至少需要填写一个');
        return;
    }
    if (!name && rbpId) {
        showConfirm('修改任务', '<p>任务名为空，将仅使用RBP任务ID作为标识，确认修改？</p>').then(function(ok) {
            if (!ok) return;
            doSubmitEditDrawer();
        });
        return;
    }
    doSubmitEditDrawer();
}

function doSubmitEditDrawer() {
    var tid = parseInt(document.getElementById('edit-tid').value || '0', 10);
    var name = (document.getElementById('ed_name').value || '').trim();
    var mode = (document.querySelector('input[name="ed_est_mode"]:checked') || {}).value || 'blank';
    var taskType = document.getElementById('ed_type').value;
    var taskKind = document.getElementById('ed_kind').value;
    var priority = document.getElementById('ed_pri').value;
    var difficulty = document.getElementById('ed_diff').value;
    var remark = (document.getElementById('ed_remark').value || '').trim();
    var edExpcntRaw = parseInt(document.getElementById('ed_expcnt').value, 10);
    var payload = {
        id: tid,
        name: name,
        type: taskType,
        task_kind: taskKind,
        pri: priority,
        diff: difficulty,
        est_mode: mode,
        rbp_task_id: document.getElementById('ed_rbp_id').value.trim(),
        scene: document.getElementById('ed_scene').value.trim(),
        general_category: document.getElementById('ed_gcat').value.trim(),
        source_link: document.getElementById('ed_slink').value.trim(),
        expected_count: isNaN(edExpcntRaw) ? null : edExpcntRaw,
        collection_req_id: document.getElementById('ed_creqid').value.trim(),
        collection_req_type: document.getElementById('ed_creqtype').value.trim()
    };
    payload.remark = remark;
    if (mode === 'direct') {
        payload.duration = (document.getElementById('ed_duration').value || '').trim();
    } else if (mode === 'calc') {
        payload.op_min = parseInt(document.getElementById('ed_op').value || '0', 10) || 0;
        payload.reset_min = parseInt(document.getElementById('ed_reset').value || '0', 10) || 0;
        payload.collect_count = parseInt(document.getElementById('ed_count').value || '0', 10) || 0;
        payload.redundancy_min = parseInt(document.getElementById('ed_red').value || '0', 10) || 0;
    }
    fetch('/update_task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        .then(function(r) { return r.json(); }).then(function(d) {
            showToast(d.msg);
            closeEditDrawer();
            _silentRefresh();
        });
}

function submitEditTask() { submitEditDrawer(); }

function recallTaskToPool(tid){
    recycleTasks({taskIds: [tid], confirmMsg: '<p>确定回收该任务到未分配？</p>'});
}

function finishTaskFromList(tid){
    showConfirm('完成任务', '<p>标记该任务已完成？</p>').then(function(ok){
        if(!ok) return;
        var t = getTaskById(tid);
        if (t) t.status = '已完成';
        document.querySelectorAll('.task-block[data-tid="'+tid+'"]').forEach(function(b){ b.classList.add('task-completed'); });
        schedules.forEach(function(s){ if(s.task_id == tid) s.status = 'completed'; });
        applyTaskFilters();
        _renderTaskPool();
        refreshLiveStatus();
        fetch('/finish_task',{
            method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({task_id: tid})
        }).then(function(r){ return r.json(); }).then(function(d){
            showToast(d.msg);
            _silentRefresh();
        });
    });
}

// ========== 任务包对话框 ==========

function openCreatePackageDialog() {
    showConfirm('新建任务包',
        '<div style="text-align:left">' +
        '<div style="margin-bottom:6px;"><b>名称：</b><input id="pkg-dlg-name" style="width:100%" placeholder="输入任务包名称"></div>' +
        '<div style="margin-bottom:6px;"><b>截止时间：</b><input id="pkg-dlg-deadline" type="date" style="width:100%"></div>' +
        '<div style="margin-bottom:6px;"><b>机型：</b><select id="pkg-dlg-type" style="width:100%">' + _pkgMachineTypeOptions() + '</select></div>' +
        '<div><b>优先级：</b><select id="pkg-dlg-priority" style="width:100%">' + _pkgPriorityOptions() + '</select></div>' +
        '</div>'
    ).then(function(ok) {
        if (!ok) return;
        var name = (document.getElementById('pkg-dlg-name').value || '').trim();
        if (!name) { showToast('名称不能为空'); return; }
        fetch('/api/task_packages', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                name: name,
                deadline: document.getElementById('pkg-dlg-deadline').value || null,
                machine_type: document.getElementById('pkg-dlg-type').value,
                priority: document.getElementById('pkg-dlg-priority').value,
            })
        }).then(function(r) { return r.json(); }).then(function(d) {
            showToast(d.msg);
            _silentRefresh();
        });
    });
}

function openEditPackageDialog(pid) {
    var p = TASK_PACKAGES.find(function(pk) { return pk.id === pid; });
    if (!p) return;
    showConfirm('编辑任务包',
        '<div style="text-align:left">' +
        '<div style="margin-bottom:6px;"><b>名称：</b><input id="pkg-dlg-name" style="width:100%" value="' + escHtml(p.name) + '"></div>' +
        '<div style="margin-bottom:6px;"><b>截止时间：</b><input id="pkg-dlg-deadline" type="date" style="width:100%" value="' + escHtml(p.deadline||'') + '"></div>' +
        '<div style="margin-bottom:6px;"><b>机型：</b><select id="pkg-dlg-type" style="width:100%">' + _pkgMachineTypeOptions(p.machine_type) + '</select></div>' +
        '<div><b>优先级：</b><select id="pkg-dlg-priority" style="width:100%">' + _pkgPriorityOptions(p.priority) + '</select></div>' +
        '</div>'
    ).then(function(ok) {
        if (!ok) return;
        var name = (document.getElementById('pkg-dlg-name').value || '').trim();
        if (!name) { showToast('名称不能为空'); return; }
        fetch('/api/task_packages/' + pid, {
            method: 'PUT', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                name: name,
                deadline: document.getElementById('pkg-dlg-deadline').value || null,
                machine_type: document.getElementById('pkg-dlg-type').value,
                priority: document.getElementById('pkg-dlg-priority').value,
            })
        }).then(function(r) { return r.json(); }).then(function(d) {
            showToast(d.msg);
            _silentRefresh();
        });
    });
}

function deletePackage(pid) {
    var p = TASK_PACKAGES.find(function(pk) { return pk.id === pid; });
    if (!p) return;
    var html = '<div style="text-align:left">';
    html += '<p>删除任务包「<b>' + escHtml(p.name) + '</b>」？</p>';
    var pendingCount = p.total - p.assigned - p.completed;
    html += '<p style="font-size:12px;color:var(--text-muted)">' + p.total + ' 个子任务中：' + p.assigned + ' 已分配、' + pendingCount + ' 待分配、' + p.completed + ' 已完成</p>';
    html += '<p style="font-size:11px;color:var(--text-muted)">已完成的任务不会被影响</p>';
    html += '</div>';

    var dialog = document.createElement('div');
    dialog.className = 'dialog-overlay';
    dialog.style.display = 'flex';
    dialog.style.zIndex = '9999';
    dialog.innerHTML = '<div class="dialog-box" style="max-width:440px">' +
        '<h3>删除任务包</h3>' + html +
        '<div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end;">' +
        '<button class="btn" id="pkg-del-cancel">取消</button>' +
        '<button class="btn" style="background:var(--danger);color:white;" id="pkg-del-recycle">回收子任务</button>' +
        '<button class="btn btn-danger" id="pkg-del-cascade">级联删除</button>' +
        '</div></div>';
    document.body.appendChild(dialog);

    function close() { dialog.remove(); }

    document.getElementById('pkg-del-cancel').onclick = close;
    document.getElementById('pkg-del-recycle').onclick = function() {
        close();
        fetch('/api/task_packages/' + pid + '?cascade=false', { method: 'DELETE' })
            .then(function(r) { return r.json(); }).then(function(d) {
                showToast(d.msg); _expandedPackageId = null;
                _silentRefresh();
            });
    };
    document.getElementById('pkg-del-cascade').onclick = function() {
        close();
        fetch('/api/task_packages/' + pid + '?cascade=true', { method: 'DELETE' })
            .then(function(r) { return r.json(); }).then(function(d) {
                showToast(d.msg); _expandedPackageId = null;
                _silentRefresh();
            });
    };
    dialog.onclick = function(ev) { if (ev.target === dialog) close(); };
}

function openAddTasksToPackageDialog(pid) {
    var p = TASK_PACKAGES.find(function(pk) { return pk.id === pid; });
    if (!p) return;
    var candidates = TASKS_DATA.filter(function(t) {
        return t.status === '待分配' && (t.package_id == null);
    });
    if (candidates.length === 0) {
        showToast('没有可添加的待分配任务');
        return;
    }
    var html = '<div style="text-align:left;max-height:300px;overflow-y:auto;">';
    html += '<p style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">勾选任务添加到「<b>' + escHtml(p.name) + '</b>」</p>';
    for (var i = 0; i < candidates.length; i++) {
        var t = candidates[i];
        html += '<label style="display:flex;align-items:center;gap:6px;padding:4px 0;cursor:pointer;">';
        html += '<input type="checkbox" class="pkg-add-task-cb" value="' + t.id + '">';
        html += '<span>' + escHtml(t.name) + ' <span style="color:var(--text-muted);font-size:11px;">' + escHtml(t.type) + ' · ' + escHtml(t.task_kind||'') + '</span></span>';
        html += '</label>';
    }
    html += '</div>';
    showConfirm('从任务库添加任务', html).then(function(ok) {
        if (!ok) return;
        var cbs = document.querySelectorAll('.pkg-add-task-cb:checked');
        var ids = [];
        cbs.forEach(function(cb) { ids.push(parseInt(cb.value, 10)); });
        if (ids.length === 0) return;
        fetch('/api/task_packages/' + pid + '/add_tasks', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({task_ids: ids})
        }).then(function(r) { return r.json(); }).then(function(d) {
            showToast(d.msg);
            _silentRefresh();
        });
    });
}

function _pkgMachineTypeOptions(selected) {
    var types = (APP_CONFIG && APP_CONFIG.machine_types) ? APP_CONFIG.machine_types : [];
    var html = '';
    for (var i = 0; i < types.length; i++) {
        var t = types[i].key;
        html += '<option value="' + escHtml(t) + '"' + (t === (selected || 'BR2') ? ' selected' : '') + '>' + escHtml(t) + '</option>';
    }
    return html;
}

function handlePackageImportFile(input) {
    var file = input.files[0];
    if (!file) return;
    _doPkgImportPreviewAll(file);
    input.value = '';
}

function _doPkgImportPreviewAll(file) {
    var formData = new FormData();
    formData.append('file', file);
    showToast('正在解析 Excel...', 2000);
    fetch('/import_task_package/preview_all', { method: 'POST', body: formData })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            if (d.msg && !d.results) { showToast(d.msg); return; }
            var results = d.results || [];
            if (results.length <= 1) {
                // Single sheet: use existing single-sheet dialog
                var single = results[0];
                if (!single) { showToast('未读取到任何数据'); return; }
                if (single.error) { showToast(single.error); return; }
                // Reshape to match old single-sheet format
                single.sheets = d.sheets || [];
                single.active_sheet = (single.sheet_name || '');
                _showPkgImportDialog(file, single);
            } else {
                // Multi-sheet: show bulk dialog
                _showPkgBulkImportDialog(file, results);
            }
        })
        .catch(function(e) { showToast('导入失败: ' + e.message); });
}

function _doPkgImportPreview(file, sheet) {
    var formData = new FormData();
    formData.append('file', file);
    if (sheet) formData.append('sheet', sheet);
    fetch('/import_task_package/preview', { method: 'POST', body: formData })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            if (d.msg && !d.items) { showToast(d.msg); return; }
            _showPkgImportDialog(file, d);
        });
}

function _showPkgImportDialog(file, d) {
    var pkgName = d.package_name || '';
    var sheets = d.sheets || [];
    var activeSheet = d.active_sheet || '';
    var items = d.items || [];

    var html = '<div style="text-align:left;max-height:65vh;overflow-y:auto;">';

    // 工作表选择器
    if (sheets.length > 1) {
        html += '<div style="margin-bottom:8px;"><b>工作表：</b><select id="pkg-import-sheet" style="width:100%" onchange="_onPkgImportSheetChange(this.value)">';
        for (var i = 0; i < sheets.length; i++) {
            html += '<option value="' + escHtml(sheets[i]) + '"' + (sheets[i] === activeSheet ? ' selected' : '') + '>' + escHtml(sheets[i]) + '</option>';
        }
        html += '</select></div>';
    }

    // 任务包名称 + 截止时间 + 机型
    html += '<div style="margin-bottom:8px;"><b>任务包名称：</b><input id="pkg-import-name" style="width:100%" value="' + escHtml(pkgName) + '" placeholder="输入任务包名称"></div>';
    if (d.package_deadline) {
        html += '<div style="margin-bottom:8px;"><b>截止时间：</b><input id="pkg-import-deadline" type="date" style="width:100%" value="' + escHtml(d.package_deadline) + '"></div>';
    } else {
        html += '<div style="margin-bottom:8px;"><b>截止时间：</b><input id="pkg-import-deadline" type="date" style="width:100%"></div>';
    }
    html += '<div style="margin-bottom:8px;"><b>机型：</b><select id="pkg-import-machine-type" style="width:100%">';
    var mtypes = (APP_CONFIG && APP_CONFIG.machine_types) ? APP_CONFIG.machine_types : [];
    mtypes.forEach(function(mt) {
        html += '<option value="' + escHtml(mt.key) + '"' + (mt.key === 'BR2' ? ' selected' : '') + '>' + escHtml(mt.key) + '</option>';
    });
    html += '</select></div>';

    // 统计摘要
    var okCount = d.ok_count || 0;
    var rbpDupCount = d.rbp_dup_count || 0;
    var nameTypeDupCount = d.name_type_dup_count || 0;
    html += '<div style="margin-bottom:8px;font-size:12px;">';
    html += '共 <b>' + (d.valid_items || 0) + '</b> 条 | ';
    html += '<span style="color:#67c23a;">可导入 ' + okCount + '</span> | ';
    html += '<span style="color:#f56c6c;">ID重复 ' + rbpDupCount + '</span> | ';
    html += '<span style="color:#e6a23c;">疑似重复 ' + nameTypeDupCount + '</span>';
    html += '</div>';

    // 全选/取消按钮
    html += '<div style="margin-bottom:6px;display:flex;gap:10px;">';
    html += '<button type="button" class="tool-btn" onclick="var cbs=document.querySelectorAll(\'.pkg-import-item-check\');cbs.forEach(function(cb){cb.checked=!cb.disabled;});">全选</button>';
    html += '<button type="button" onclick="var cbs=document.querySelectorAll(\'.pkg-import-item-check\');cbs.forEach(function(cb){cb.checked=false;});">取消全选</button>';
    html += '<button type="button" onclick="var cbs=document.querySelectorAll(\'.pkg-import-item-check\');cbs.forEach(function(cb){cb.checked=cb.dataset.status===\'ok\'||cb.dataset.status===\'confirm\';});">仅选可导入</button>';
    html += '</div>';

    // Items 勾选表格
    html += '<div style="max-height:300px;overflow-y:auto;border:1px solid var(--border);border-radius:4px;">';
    html += '<table style="font-size:12px;width:100%;border-collapse:collapse;">';
    html += '<thead><tr style="position:sticky;top:0;background:var(--bg-card);">';
    html += '<th style="padding:6px;">导入</th><th style="padding:6px;text-align:left;">任务名</th><th style="padding:6px;">机型</th><th style="padding:6px;">任务类型</th><th style="padding:6px;">优先级</th><th style="padding:6px;">预估时长</th><th style="padding:6px;">状态</th><th style="padding:6px;text-align:left;">提示</th>';
    html += '</tr></thead><tbody>';

    items.forEach(function(it, i) {
        var statusText = '', statusColor = '', rowBg = '';
        var checked = false;
        var disabled = false;

        if (it.status === 'ok') {
            statusText = '可导入'; statusColor = '#67c23a';
            checked = true;
        } else if (it.status === 'rejected') {
            statusText = 'ID重复'; statusColor = '#f56c6c';
            rowBg = 'background:#fef0f0;';
            checked = false;
            disabled = true;
        } else if (it.status === 'confirm') {
            statusText = '疑似重复'; statusColor = '#e6a23c';
            rowBg = 'background:#fdf6ec;';
            checked = true;
        }

        html += '<tr style="border-bottom:1px solid var(--border-light);' + rowBg + '">';
        html += '<td style="padding:4px;text-align:center;"><input type="checkbox" class="pkg-import-item-check" data-idx="' + i + '" data-status="' + escHtml(it.status) + '"' + (checked ? ' checked' : '') + (disabled ? ' disabled' : '') + '></td>';
        html += '<td style="padding:4px;">' + escHtml(it.name) + '</td>';
        html += '<td style="padding:4px;text-align:center;">' + escHtml(it.type) + '</td>';
        html += '<td style="padding:4px;text-align:center;">' + escHtml(it.task_kind) + '</td>';
        html += '<td style="padding:4px;text-align:center;">' + escHtml(it.priority) + '</td>';
        html += '<td style="padding:4px;text-align:center;">' + escHtml(it.duration) + '</td>';
        html += '<td style="padding:4px;text-align:center;color:' + statusColor + ';font-weight:600;">' + statusText + '</td>';
        html += '<td style="padding:4px;color:#e6a23c;font-size:11px;">' + (it.warnings || []).map(function(w) { return escHtml(w); }).join('; ') + '</td>';
        html += '</tr>';
    });

    html += '</tbody></table></div>';
    html += '</div>';

    window._pkgImportFile = file;

    showConfirm('导入任务包', html).then(function(ok) {
        if (!ok) { window._pkgImportFile = null; return; }
        var finalName = (document.getElementById('pkg-import-name').value || '').trim() || '未命名任务包';
        var finalDeadline = document.getElementById('pkg-import-deadline').value || null;
        var finalMachineType = document.getElementById('pkg-import-machine-type').value || 'BR2';

        // 收集被勾选的 items
        var selected = [];
        document.querySelectorAll('.pkg-import-item-check:checked').forEach(function(cb) {
            var idx = parseInt(cb.dataset.idx, 10);
            if (!isNaN(idx) && items[idx]) {
                selected.push(items[idx]);
            }
        });

        if (selected.length === 0) { showToast('没有勾选任何任务'); return; }

        fetch('/import_task_package/execute', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                items: selected,
                package_name: finalName,
                package_deadline: finalDeadline,
                machine_type: finalMachineType,
            })
        }).then(function(r) { return r.json(); }).then(function(res) {
            showToast(res.msg);
            _silentRefresh();
        }).catch(function(e) {
            showToast('导入失败: ' + e.message);
        });
        window._pkgImportFile = null;
    });
}

function _onPkgImportSheetChange(sheetName) {
    var file = window._pkgImportFile;
    if (!file) return;
    _doPkgImportPreview(file, sheetName);
}

function _showPkgBulkImportDialog(file, results) {
    window._pkgBulkResults = results;
    window._pkgBulkFile = file;

    var totalItems = 0;
    results.forEach(function(r) { totalItems += (r.valid_items || 0); });

    var mtypes = (APP_CONFIG && APP_CONFIG.machine_types) ? APP_CONFIG.machine_types : [];
    function mtOptions(sheetIdx) {
        var h = '';
        mtypes.forEach(function(mt) {
            h += '<option value="' + escHtml(mt.key) + '"' + (mt.key === 'BR2' ? ' selected' : '') + '>' + escHtml(mt.key) + '</option>';
        });
        return h;
    }

    // Build custom overlay
    var overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(15,23,42,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;';
    overlay.id = 'pkg-bulk-overlay';

    var html = '';
    html += '<div class="confirm-box" style="max-width:1100px;width:95vw;max-height:90vh;display:flex;flex-direction:column;">';
    // Header
    html += '<div class="confirm-header" style="display:flex;align-items:center;justify-content:space-between;">';
    html += '<span style="font-weight:600;">批量导入任务包</span>';
    html += '<span style="font-size:12px;color:var(--text-muted);">共 <b>' + results.length + '</b> 个工作表，<b>' + totalItems + '</b> 条有效数据</span>';
    html += '<button style="width:28px;height:28px;border:none;background:none;font-size:18px;cursor:pointer;color:var(--text-muted);" onclick="document.getElementById(\'pkg-bulk-overlay\').remove();window._pkgBulkResults=null;window._pkgBulkFile=null;">&times;</button>';
    html += '</div>';

    // Body
    html += '<div class="confirm-body" style="overflow-y:auto;flex:1;padding:16px 22px;">';

    // Global selection buttons
    html += '<div style="margin-bottom:10px;display:flex;gap:8px;">';
    html += '<button type="button" class="tool-btn" onclick="_pkgBulkSelectAll()">全选</button>';
    html += '<button type="button" onclick="_pkgBulkSelectNone()">取消全选</button>';
    html += '<button type="button" onclick="_pkgBulkSelectOk()">仅选可导入</button>';
    html += '</div>';

    // Per-sheet sections
    for (var i = 0; i < results.length; i++) {
        var r = results[i];
        var hasError = !!r.error;
        var okCount = r.ok_count || 0;
        var dupCount = (r.rbp_dup_count || 0) + (r.name_type_dup_count || 0);
        var sheetName = r.sheet_name || ('Sheet' + (i + 1));
        var pkgName = escHtml(r.package_name || '');
        var greyStyle = hasError ? 'opacity:0.5;' : '';

        html += '<div class="bulk-sheet-section" style="border:1px solid var(--border);border-radius:6px;margin-bottom:8px;' + greyStyle + '">';
        // Sheet header
        html += '<div class="bulk-sheet-header" style="display:flex;align-items:center;gap:10px;padding:10px 12px;cursor:pointer;background:var(--bg-body);border-radius:6px 6px 0 0;" onclick="var body=this.nextElementSibling;var arrow=this.querySelector(\'.bulk-sheet-arrow\');if(body.style.display===\'none\'){body.style.display=\'\';arrow.textContent=\'▲\';}else{body.style.display=\'none\';arrow.textContent=\'▼\';}">';
        html += '<input type="checkbox" class="pkg-bulk-sheet-check" data-sheet="' + i + '" onchange="_pkgBulkUpdateSheetChecks(' + i + ', this.checked)" onclick="event.stopPropagation();"' + (hasError ? ' disabled' : ' checked') + '>';
        html += '<span style="font-weight:600;min-width:60px;">' + escHtml(sheetName) + '</span>';
        if (hasError) {
            html += '<span style="color:#f56c6c;font-size:12px;flex:1;">' + escHtml(r.error) + '</span>';
        } else {
            html += '<span style="font-size:12px;color:#67c23a;">' + okCount + ' 可导入</span>';
            if (dupCount > 0) {
                html += '<span style="font-size:12px;color:#e6a23c;">' + dupCount + ' 需确认</span>';
            }
            html += '<input class="pkg-bulk-pkg-name" data-sheet="' + i + '" value="' + pkgName + '" placeholder="任务包名称" style="width:160px;" onclick="event.stopPropagation();">';
            html += '<select class="pkg-bulk-machine-type" data-sheet="' + i + '" style="width:90px;" onclick="event.stopPropagation();">' + mtOptions(i) + '</select>';
        }
        html += '<span class="bulk-sheet-arrow" style="font-size:11px;color:var(--text-muted);margin-left:auto;">▼</span>';
        html += '</div>';

        // Sheet body (collapsed by default)
        if (!hasError) {
            html += '<div class="bulk-sheet-body" style="display:none;max-height:250px;overflow-y:auto;border-top:1px solid var(--border-light);">';
            html += '<table style="font-size:11px;width:100%;border-collapse:collapse;">';
            html += '<thead><tr style="position:sticky;top:0;background:var(--bg-card);color:var(--text-muted);">';
            html += '<th style="padding:4px;">导入</th><th style="padding:4px;text-align:left;">任务名</th><th style="padding:4px;">机型</th><th style="padding:4px;">类型</th><th style="padding:4px;">优先级</th><th style="padding:4px;">时长</th><th style="padding:4px;">状态</th><th style="padding:4px;text-align:left;">提示</th>';
            html += '</tr></thead><tbody>';

            var items = r.items || [];
            for (var j = 0; j < items.length; j++) {
                var it = items[j];
                var statusText = '', statusColor = '', rowBg = '';
                var checked = false;
                var disabled = false;

                if (it.status === 'ok') {
                    statusText = '可导入'; statusColor = '#67c23a';
                    checked = true;
                } else if (it.status === 'rejected') {
                    statusText = 'ID重复'; statusColor = '#f56c6c';
                    rowBg = 'background:#fef0f0;';
                    checked = false;
                    disabled = true;
                } else if (it.status === 'confirm') {
                    statusText = '疑似重复'; statusColor = '#e6a23c';
                    rowBg = 'background:#fdf6ec;';
                    checked = true;
                }

                html += '<tr style="border-bottom:1px solid var(--border-light);' + rowBg + '">';
                html += '<td style="padding:3px;text-align:center;"><input type="checkbox" class="pkg-bulk-item-check" data-sheet="' + i + '" data-idx="' + j + '" data-status="' + escHtml(it.status) + '"' + (checked ? ' checked' : '') + (disabled ? ' disabled' : '') + ' onchange="_pkgBulkUpdateCount()"></td>';
                html += '<td style="padding:3px;">' + escHtml(it.name) + '</td>';
                html += '<td style="padding:3px;text-align:center;">' + escHtml(it.type) + '</td>';
                html += '<td style="padding:3px;text-align:center;">' + escHtml(it.task_kind) + '</td>';
                html += '<td style="padding:3px;text-align:center;">' + escHtml(it.priority) + '</td>';
                html += '<td style="padding:3px;text-align:center;">' + escHtml(it.duration) + '</td>';
                html += '<td style="padding:3px;text-align:center;color:' + statusColor + ';font-weight:600;font-size:10px;">' + statusText + '</td>';
                html += '<td style="padding:3px;color:#e6a23c;font-size:10px;">' + (it.warnings || []).map(function(w) { return escHtml(w); }).join('; ') + '</td>';
                html += '</tr>';
            }

            html += '</tbody></table></div>';
        }

        html += '</div>'; // bulk-sheet-section
    }

    html += '</div>'; // confirm-body

    // Footer
    html += '<div class="confirm-footer" style="display:flex;align-items:center;justify-content:space-between;">';
    html += '<span style="font-size:13px;color:var(--text-muted);">已选 <b id="pkg-bulk-selected-count" style="color:var(--primary);">0</b> 条</span>';
    html += '<div style="display:flex;gap:8px;">';
    html += '<button class="btn confirm-cancel" onclick="document.getElementById(\'pkg-bulk-overlay\').remove();window._pkgBulkResults=null;window._pkgBulkFile=null;">取消</button>';
    html += '<button class="btn confirm-ok" onclick="_pkgBulkConfirmImport()">确认导入</button>';
    html += '</div></div>';

    html += '</div>'; // confirm-box

    overlay.innerHTML = html;
    document.body.appendChild(overlay);

    // Update count after DOM is ready
    setTimeout(_pkgBulkUpdateCount, 50);
}

// Helper: Select all non-disabled items
function _pkgBulkSelectAll() {
    document.querySelectorAll('.pkg-bulk-item-check').forEach(function(cb) {
        if (!cb.disabled) cb.checked = true;
    });
    // Also check all sheet checkboxes
    document.querySelectorAll('.pkg-bulk-sheet-check').forEach(function(cb) {
        if (!cb.disabled) cb.checked = true;
    });
    _pkgBulkUpdateCount();
}

// Helper: Deselect all
function _pkgBulkSelectNone() {
    document.querySelectorAll('.pkg-bulk-item-check').forEach(function(cb) { cb.checked = false; });
    document.querySelectorAll('.pkg-bulk-sheet-check').forEach(function(cb) { cb.checked = false; });
    _pkgBulkUpdateCount();
}

// Helper: Select only ok + confirm
function _pkgBulkSelectOk() {
    document.querySelectorAll('.pkg-bulk-item-check').forEach(function(cb) {
        cb.checked = (cb.dataset.status === 'ok' || cb.dataset.status === 'confirm');
    });
    _pkgBulkUpdateCount();
}

// Update sheet-level checkbox when individual items change
function _pkgBulkUpdateSheetChecks(sheetIdx, checked) {
    document.querySelectorAll('.pkg-bulk-item-check[data-sheet="' + sheetIdx + '"]').forEach(function(cb) {
        if (!cb.disabled) cb.checked = checked;
    });
    _pkgBulkUpdateCount();
}

// Count selected items
function _pkgBulkUpdateCount() {
    var count = document.querySelectorAll('.pkg-bulk-item-check:checked').length;
    var el = document.getElementById('pkg-bulk-selected-count');
    if (el) el.textContent = count;
}

// Confirm: build packages and import
function _pkgBulkConfirmImport() {
    var results = window._pkgBulkResults;
    if (!results) return;

    var packages = [];
    for (var i = 0; i < results.length; i++) {
        var r = results[i];
        if (r.error) continue;

        // Collect checked items for this sheet
        var selected = [];
        document.querySelectorAll('.pkg-bulk-item-check[data-sheet="' + i + '"]:checked').forEach(function(cb) {
            var idx = parseInt(cb.dataset.idx, 10);
            if (!isNaN(idx) && r.items && r.items[idx]) {
                selected.push(r.items[idx]);
            }
        });

        if (selected.length === 0) continue;

        var pkgNameInput = document.querySelector('.pkg-bulk-pkg-name[data-sheet="' + i + '"]');
        var mtSelect = document.querySelector('.pkg-bulk-machine-type[data-sheet="' + i + '"]');
        var pkgName = (pkgNameInput ? pkgNameInput.value.trim() : '') || r.package_name || r.sheet_name || '未命名任务包';
        var machineType = mtSelect ? mtSelect.value : 'BR2';

        packages.push({
            package_name: pkgName,
            package_deadline: r.package_deadline || null,
            machine_type: machineType,
            items: selected,
        });
    }

    if (packages.length === 0) { showToast('没有勾选任何任务'); return; }

    // Remove overlay
    var overlay = document.getElementById('pkg-bulk-overlay');
    if (overlay) overlay.remove();
    window._pkgBulkResults = null;
    window._pkgBulkFile = null;

    // Auto-save then import
    fetch('/api/saves/auto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        .catch(function() {})
        .then(function() {
            return fetch('/import_task_package/execute_all', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ packages: packages }),
            });
        })
        .then(function(r) { return r.json(); })
        .then(function(res) {
            showToast(res.msg);
            _silentRefresh();
        })
        .catch(function(e) {
            showToast('导入失败: ' + e.message);
        });
}

function _pkgPriorityOptions(selected) {
    var priorities = (APP_CONFIG && APP_CONFIG.priorities) ? APP_CONFIG.priorities : [];
    var html = '';
    for (var i = 0; i < priorities.length; i++) {
        var p = priorities[i].key;
        html += '<option value="' + escHtml(p) + '"' + (p === (selected || 'P1') ? ' selected' : '') + '>' + escHtml(p) + '</option>';
    }
    return html;
}
