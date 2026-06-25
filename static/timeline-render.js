// golden scheduling app — timeline rendering (grid, blocks, overlays, markers, tooltips)

// 静默刷新：重新拉取 schedules 数组并重建时间轴（不刷新页面）
function silentRefreshSchedules(callback){
    var date = document.getElementById('schedule-date').value;
    var urlParams = new URLSearchParams(window.location.search);
    var viewMode = 'default';
    try { viewMode = localStorage.getItem('viewMode') || 'default'; } catch(e) {}
    var fetchUrl;
    if (viewMode === 'custom') {
        var csd = document.getElementById('custom-start-date');
        var ced = document.getElementById('custom-end-date');
        if (csd && ced && csd.value && ced.value) {
            fetchUrl = '/api/view_schedules?date=' + encodeURIComponent(date) + '&date_from=' + encodeURIComponent(csd.value) + '&date_to=' + encodeURIComponent(ced.value);
        } else {
            var spanDays = parseInt(urlParams.get('span_days') || '2', 10) || 2;
            fetchUrl = '/api/view_schedules?date=' + encodeURIComponent(date) + '&span_days=' + spanDays;
        }
    } else {
        var spanDays = parseInt(urlParams.get('span_days') || '2', 10) || 2;
        fetchUrl = '/api/view_schedules?date=' + encodeURIComponent(date) + '&span_days=' + spanDays;
    }
    fetch(fetchUrl)
        .then(function(r){ return r.json(); })
        .then(function(data){
            schedules = data.schedules;
            window._repairLogs = data.repair_logs || {};
            rebuildTimelineGrid();
            _renderAllTaskBlocks();
            if(callback) callback();
        });
}

// 根据 schedules 数组在所有机台轨道上重新渲染任务块
function _renderAllTaskBlocks(){
    document.querySelectorAll('.timeline-track').forEach(function(track){
        // 清除已有任务块（保留 shift-overlay）
        track.querySelectorAll('.task-block').forEach(function(b){ b.remove(); });
    });
    var date = document.getElementById('schedule-date').value;
    schedules.forEach(function(s){
        var track = document.querySelector('.timeline-track[data-mid="' + s.machine_id + '"]');
        if(!track) return;
        var absStart = s.abs_start_min != null ? s.abs_start_min : _dateMinToAbs(s.date, s.start_min);
        var absEnd = s.abs_end_min != null ? s.abs_end_min : _dateMinToAbs(s.date, s.end_min);
        var blk = _createTaskBlock({
            sid: s.id, tid: s.task_id,
            name: s.task_name, type: s.task_type, task_kind: s.task_kind,
            priority: s.priority, difficulty: s.difficulty, remark: s.remark,
            abs_start_min: absStart, abs_end_min: absEnd,
            status: s.status,
            split_group: s.split_group,
            package_id: s.package_id,
            package_name: s.package_name,
            machineType: track.dataset.mtype || '',
            machineKind: track.dataset.mkind || '',
            machineStatus: track.dataset.mstatus || '',
            machineId: s.machine_id,
        });
        track.appendChild(blk);
        _checkTaskBlockStacked(blk);
        syncTaskTableTime(blk, absStart, absEnd);
    });
}

function updateBlockDisplay(block, absStart, absEnd){
    block.style.setProperty('--start', String(absStart));
    block.style.setProperty('--dur', String(Math.max(1, absEnd-absStart)));

    var dm = '';
    try { dm = localStorage.getItem('displayMode') || 'continuous'; } catch(e) {}
    if (dm === 'split') {
        // 分班模式：绝对分钟 → 压缩坐标 → 用轴 splitStart 定位
        var parentTrack = block.closest('.timeline-track');
        var trackType = parentTrack ? (parentTrack.dataset.trackType || 'day') : 'day';
        var cont = block.closest('.split-timeline-container');
        var ss = cont ? (parseInt(cont.dataset.splitStart, 10) || 0) : 0;
        var displayStart = absToSplitMin(absStart, trackType);
        var displayEnd = absToSplitMin(absEnd, trackType);
        block.style.left = minToPx(displayStart - ss) + 'px';
        block.style.width = minToPx(Math.max(1, displayEnd - displayStart)) + 'px';
    } else {
        const vs = _getViewStartMin();
        block.style.left = minToPx(absStart - vs) + 'px';
        block.style.width = minToPx(Math.max(1, absEnd - absStart)) + 'px';
    }

    const timeSpan = block.querySelector('.task-time');
    if (timeSpan) {
        var isCustom = false;
        try { isCustom = localStorage.getItem('viewMode') === 'custom'; } catch(e) {}
        if (isCustom) {
            timeSpan.textContent = _formatAbsRangeCustom(absStart, absEnd);
        } else {
            timeSpan.textContent = _formatAbsMin(absStart) + '-' + _formatAbsMin(absEnd);
        }
    }
    _checkTaskBlockStacked(block);
}
function _checkTaskBlockStacked(block) {
    if (!block) return;
    // 暂切回单行模式测量，避免双行模式下 label 原始宽度撑大 scrollWidth
    var wasStacked = block.classList.contains('task-stacked');
    if (wasStacked) block.classList.remove('task-stacked');
    var overflowing = block.scrollWidth > block.clientWidth;
    if (overflowing && !wasStacked) {
        block.classList.add('task-stacked');
    } else if (!overflowing && wasStacked) {
        // 已移除，保持单行
    } else if (overflowing && wasStacked) {
        block.classList.add('task-stacked');
    }
}
function _checkAllTaskBlocksStacked() {
    document.querySelectorAll('.task-block').forEach(function(block) {
        _checkTaskBlockStacked(block);
    });
}
function syncTaskTableTime(block, absStart, absEnd){
    const tid = block.dataset.tid;
    if(!tid) return;
    const row = document.querySelector('#task-table tr[data-tid="'+tid+'"]');
    if(!row) return;
    const machineRow = block.closest('.machine-row');
    const nameEl = machineRow ? machineRow.querySelector('.machine-name-col') : null;
    const machineName = nameEl ? nameEl.textContent.trim() : '';
    const timeStr = _formatAbsRange(absStart, absEnd);
    const cell = row.children[9]; // 分配时段 列（#列+1）
    if(cell) cell.textContent = machineName ? machineName+' '+timeStr : timeStr;
}
function rebuildTimelineGrid(autoScroll){
    const [vs, ve] = getViewRange();
    const headerDate = document.getElementById('timeline-header-date');
    const headerHour = document.getElementById('timeline-header-hour');
    if(!headerDate || !headerHour) return;
    var viewMode = 'default';
    try { viewMode = localStorage.getItem('viewMode') || 'default'; } catch(e) {}
    var showDayOffset = viewMode !== 'custom';
    const {labels, startMin} = _hourLabelsForRange(vs, ve, showDayOffset);
    const cols = labels.length || 24;

    document.documentElement.style.setProperty('--viewStartMin', String(startMin));

    // hour header：清空并重建小时格
    while(headerHour.children.length > 1) headerHour.removeChild(headerHour.lastElementChild);
    labels.forEach(t=>{
        const div = document.createElement('div');
        div.className = 'timeline-hour';
        div.textContent = t;
        headerHour.appendChild(div);
    });

    // date header：按天跨度合并显示（更贴近日期）
    while(headerDate.children.length > 1) headerDate.removeChild(headerDate.lastElementChild);
    const base = (document.getElementById('schedule-date') ? document.getElementById('schedule-date').value : SELECTED_DATE);
    function addDays(iso, days){
        const m = String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if(!m) return iso;
        const dt = new Date(parseInt(m[1],10), parseInt(m[2],10)-1, parseInt(m[3],10));
        dt.setDate(dt.getDate() + (days|0));
        const y = dt.getFullYear();
        const mon = String(dt.getMonth()+1).padStart(2,'0');
        const d = String(dt.getDate()).padStart(2,'0');
        return `${y}-${mon}-${d}`;
    }
    const startHourIndex = Math.floor(startMin / MINS_PER_HOUR);
    const endHourIndex = startHourIndex + cols; // exclusive
    let cur = startHourIndex;
    while(cur < endHourIndex){
        const dayOff = Math.floor(cur / 24);
        const dayStart = dayOff * 24;
        const dayEnd = dayStart + 24;
        const segStart = Math.max(cur, dayStart);
        const segEnd = Math.min(endHourIndex, dayEnd);
        const div = document.createElement('div');
        div.className = 'timeline-date';
        div.textContent = addDays(base, dayOff);
        // gridColumn：+2 因为第1列是 machine-name-col
        div.style.gridColumn = `${(segStart-startHourIndex)+2} / ${(segEnd-startHourIndex)+2}`;
        headerDate.appendChild(div);
        cur = segEnd;
    }

    // header + 每一行：动态列数与 track 跨度
    headerDate.style.gridTemplateColumns = `130px repeat(${cols}, var(--hourWidth))`;
    headerHour.style.gridTemplateColumns = `130px repeat(${cols}, var(--hourWidth))`;
    document.querySelectorAll('.timeline-grid.machine-row').forEach(row=>{
        row.style.gridTemplateColumns = `130px repeat(${cols}, var(--hourWidth))`;
        const track = row.querySelector('.timeline-track');
        if(track) track.style.gridColumn = `2 / ${cols + 2}`;
    });

    renderCurrentTimeMarker();
    renderShiftOverlaySegments();

    if(autoScroll){
        const container = document.querySelector('.timeline-container');
        if(container) container.scrollLeft = 0;
    }
}

function renderShiftOverlaySegments(){
    // 逻辑视图范围（决定生成哪些天）
    const [logicVs, logicVeRaw] = getViewRange();
    const logicVe = (logicVeRaw <= logicVs) ? (logicVs + MINS_PER_DAY) : logicVeRaw;
    const mode = document.getElementById('view-mode').value;

    let workRanges = [];
    let otRanges = [];
    let breakRanges = [];

    // 计算需要遍历的天范围
    var startDay, endDay;
    if (mode === 'day') {
        startDay = 0; endDay = 0;
    } else if (mode === 'night') {
        const nightStyle = localStorage.getItem('nightViewStyle') || 'simple';
        if (nightStyle === 'simple') {
            const offset = parseInt(localStorage.getItem('nightOffset') || '0', 10);
            startDay = offset; endDay = offset;
        } else {
            startDay = -1; endDay = 0;
        }
    } else if (mode === 'double') {
        // 双班：前一日夜班(凌晨) + 当日白班 + 当日夜班(跨天)
        startDay = -1;
        endDay = 0;
    } else {
        // custom
        startDay = dayOffset(logicVs);
        endDay = dayOffset(logicVe - 1);
    }

    const ns = hhmmToMin(SHIFT.night_shift.start)||1260;
    const ne = hhmmToMin(SHIFT.night_shift.end)||390;
    const nightCrosses = ne <= ns;

    for (let d = startDay; d <= endDay; d++) {
        const base = d * MINS_PER_DAY;

        // double 模式 d=-1 只加夜班不加白班（前一天只有夜班覆盖凌晨）
        var skipDayForDouble = (mode === 'double' && d < 0);
        // custom 模式等同于"多天双班"：每天都有白班+夜班
        var showDay = (mode === 'day' || mode === 'double' || mode === 'custom') && !skipDayForDouble;
        var showNight = (mode === 'night' || mode === 'double' || mode === 'custom');

        if (showDay) {
            // 白班工作（day/double/custom 都加）
            const ds = hhmmToMin(SHIFT.day_shift.start)||540;
            const de = hhmmToMin(SHIFT.day_shift.end)||1110;
            workRanges.push([base + ds, base + de]);
            // 白班加班（SHIFT 已由后端预解析为数组）
            (SHIFT.day_shift.overtime || []).forEach(function(p){
                otRanges.push([base + p[0], base + (p[1] <= p[0] ? MINS_PER_DAY : p[1])]);
            });
            // 白班休息
            (SHIFT.day_shift.breaks || []).forEach(function(p){
                breakRanges.push([base + p[0], base + p[1]]);
            });
        }

        if (showNight) {
            // 夜班工作
            workRanges.push([base + ns, base + (nightCrosses ? MINS_PER_DAY + ne : ne)]);
            // 夜班加班
            _shiftAbsifyRanges(ns, SHIFT.night_shift.overtime || [], nightCrosses).forEach(function(p){
                otRanges.push([base + p[0], base + p[1]]);
            });
            // 夜班休息
            _shiftAbsifyRanges(ns, SHIFT.night_shift.breaks || [], nightCrosses).forEach(function(p){
                breakRanges.push([base + p[0], base + p[1]]);
            });
        }
    }

    // 自动补全空隙为休息段：工作时间段之间的间隔视为休息
    let autoBreaks = [];
    if (workRanges.length > 0) {
        const allOccupied = [...workRanges, ...otRanges, ...breakRanges]
            .filter(function(p){ return p[1] > p[0]; })
            .sort(function(a,b){ return a[0] - b[0]; });
        let cursor = -1;
        for (var i = 0; i < allOccupied.length; i++) {
            var a = allOccupied[i][0], b = allOccupied[i][1];
            if (cursor >= 0 && a > cursor){
                autoBreaks.push([cursor, a]);
            }
            cursor = Math.max(cursor, b);
        }
    }

    // 夜班扩展模式：计算两段夜班之间的白班收折区
    var dayFoldRanges = [];
    if (mode === 'night' && (localStorage.getItem('nightViewStyle') || 'simple') !== 'simple' && workRanges.length > 0) {
        var sortedWork = workRanges.slice().sort(function(a,b){ return a[0] - b[0]; });
        for (var wi = 1; wi < sortedWork.length; wi++) {
            var gapStart = sortedWork[wi-1][1];
            var gapEnd = sortedWork[wi][0];
            if (gapEnd - gapStart > 120) {
                dayFoldRanges.push([gapStart, gapEnd]);
            }
        }
    }

    // 渲染到每个 track — 直接走 _renderSeg，无中间钳制（链路A已砍）
    document.querySelectorAll('.timeline-track').forEach(function(track){
        var ov = track.querySelector('.shift-overlay');
        if (!ov) return;
        ov.innerHTML = '';

        workRanges.forEach(function(p){ _renderSeg(ov, p[0], p[1], 'seg-work'); });
        otRanges.forEach(function(p){ _renderSeg(ov, p[0], p[1], 'seg-ot'); });
        breakRanges.forEach(function(p){ _renderSeg(ov, p[0], p[1], 'seg-break'); });
        autoBreaks.forEach(function(p){ _renderSeg(ov, p[0], p[1], 'seg-gap'); });
        dayFoldRanges.forEach(function(p){ _renderSeg(ov, p[0], p[1], 'seg-day-fold'); });
    });
}

function renderViewMask(autoScroll){
    const [vs, ve] = getViewRange();
    const container = document.querySelector('.timeline-container');
    const left = document.getElementById('mask-left');
    const right = document.getElementById('mask-right');
    if(!container || !left || !right) return;
    // 动态网格模式下：视图范围以"列数"裁剪，遮罩不再需要
    if(!(vs <= 0 && ve >= MINS_PER_DAY)){
        left.style.display='none';
        right.style.display='none';
        return;
    }
    if(vs <= 0 && ve >= MINS_PER_DAY){
        left.style.display='none';
        right.style.display='none';
        return;
    }
    const hw = getHourWidth();
    const fullW = 24*hw;
    const leftW = Math.max(0, minToPx(vs));
    const rightW = Math.max(0, fullW - minToPx(ve));
    left.style.display='block';
    right.style.display='block';
    left.style.left = MACHINE_NAME_WIDTH+'px';
    left.style.width = leftW+'px';
    right.style.right = '';
    right.style.left = (MACHINE_NAME_WIDTH + minToPx(ve)) + 'px';
    right.style.width = rightW+'px';
    if(autoScroll){
        container.scrollLeft = Math.max(0, leftW - hw); // 让起点附近可见
    }
}

function _createTaskBlock(data){
    let block = document.createElement('div');
    var typeName = data.type || (APP_CONFIG.machine_types[0] && APP_CONFIG.machine_types[0].key) || '';
    let typeIdx = (typeof TYPE_INDEX_MAP !== 'undefined' && TYPE_INDEX_MAP[typeName] !== undefined) ? TYPE_INDEX_MAP[typeName] : 0;
    let typeCls = 'type-' + typeIdx;
    let isCompleted = data.status === 'completed';
    let isSplit = data.split_group ? true : false;
    let isIncompatible = !isCompleted && (
        (data.machineType && data.type && data.type !== data.machineType)
        || (data.machineKind && data.task_kind && data.task_kind !== data.machineKind)
    );
    block.className = 'task-block task-'+typeCls +
        (isCompleted ? ' task-completed' : '') +
        (isSplit ? ' task-split' : '') +
        (isIncompatible ? ' task-incompatible' : '');
    block.draggable = !isCompleted;
    block.dataset.sid = data.sid;
    block.dataset.tid = data.tid;
    block.dataset.type = data.type;
    block.dataset.kind = data.task_kind || '';
    let durMin = Math.max(1, data.abs_end_min - data.abs_start_min);
    block.style.setProperty('--start', data.abs_start_min);
    block.style.setProperty('--dur', durMin);

    var _isCustomView = false;
    try { _isCustomView = localStorage.getItem('viewMode') === 'custom'; } catch(e) {}

    let _fmt = function(amin){
        let d = dayOffset(amin);
        let min = minuteInDay(amin);
        let h = Math.floor(min / MINS_PER_HOUR);
        let m = min - h * MINS_PER_HOUR;
        let s = String(h).padStart(2,'0')+':'+String(m).padStart(2,'0');
        return d>0 ? '(+'+d+')'+s : s;
    };

    block.addEventListener('mousedown', function(ev){ startMove(ev, data.sid); });
    block.addEventListener('dragstart', function(ev){ dragScheduledTask(ev); });
    block.addEventListener('dragend', function(ev){ dragEnd(ev); });
    block.addEventListener('dblclick', function(ev){ handleTimelineDblClick(ev, data.sid); });
    block.addEventListener('mouseenter', function(ev){ startTaskTooltipTimer(ev, data.sid); });
    block.addEventListener('mousemove', function(ev){ resetTaskTooltipTimer(ev, data.sid); });
    block.addEventListener('mouseleave', function(){ clearTaskTooltipTimer(); });

    let rl = document.createElement('div'); rl.className='resize-left';
    rl.addEventListener('mousedown', function(ev){ startResize(ev, data.sid,'left'); });
    block.appendChild(rl);

    var compact = window._compactTaskLabel;
    // 优先级：独立 span，继承任务条样式；开启着色时用 CSS 变量颜色
    var priClass = 'pri-tag';
    var priColorStyle = '';
    try {
        if (localStorage.getItem('priority_color_enabled') === '1' && data.priority) {
            var pc = getComputedStyle(document.documentElement).getPropertyValue('--pri-color-' + data.priority).trim();
            if (pc) priColorStyle = pc;
        }
    } catch(e) {}
    var priTag = data.priority
        ? ' <span class="' + priClass + '"' + (priColorStyle ? ' style="color:' + priColorStyle + '"' : '') + '>[' + data.priority + ']</span>'
        : '';
    var txt;
    if (compact) {
        // 精简模式不显示优先级
        txt = data.name + ' ';
    } else {
        txt = data.name+'('+data.type+')' + priTag;
        if(data.difficulty) txt += '['+data.difficulty+']';
        txt += ' ';
    }
    if (data.package_name && window._showPackageName !== false) {
        var pkgLabel = document.createElement('span');
        pkgLabel.className = 'pkg-tag-inline';
        pkgLabel.textContent = '📦 ' + data.package_name;
        block.appendChild(pkgLabel);
    }

    let label = document.createElement('span');
    label.className = 'task-label';
    label.innerHTML = txt;
    block.appendChild(label);

    let ts = document.createElement('span'); ts.className='task-time';
    // 分班模式用原始绝对分钟显示时间，非压缩坐标
    var _fmtStart = data._fmt_start_min != null ? data._fmt_start_min : data.abs_start_min;
    var _fmtEnd = data._fmt_end_min != null ? data._fmt_end_min : data.abs_end_min;
    if (_isCustomView) {
        ts.textContent = _formatAbsRangeCustom(_fmtStart, _fmtEnd);
    } else {
        ts.textContent = _fmt(_fmtStart) + '-' + _fmt(_fmtEnd);
    }
    block.appendChild(ts);

    if(data.remark){
        let rm = document.createElement('span'); rm.className='task-remark';
        rm.textContent = ' ('+data.remark+')';
        block.appendChild(rm);
    }

    let cb = document.createElement('button'); cb.className='complete-btn'; cb.textContent='完成';
    cb.onclick = function(){ completeTask(data.sid); };
    block.appendChild(cb);

    let rb = document.createElement('button'); rb.className='recall-btn'; rb.textContent='回收';
    rb.onclick = function(){ recallTask(data.sid); };
    block.appendChild(rb);

    let rr = document.createElement('div'); rr.className='resize-right';
    rr.addEventListener('mousedown', function(ev){ startResize(ev, data.sid,'right'); });
    block.appendChild(rr);

    // 渲染维修覆盖层（维修状态机器上不显示）
    if (data.machineStatus !== '维修停用') {
        var mid = data.machineId;
        var repairPeriods = (window._repairLogs && window._repairLogs[mid]) || [];
        _renderRepairOverlays(block, repairPeriods, data.abs_start_min, data.abs_end_min, isCompleted);
    }

    return block;
}

// 在任务块上渲染维修时间段覆盖层
function _renderRepairOverlays(block, repairPeriods, taskAbsStart, taskAbsEnd, isCompleted){
    if (!repairPeriods || repairPeriods.length === 0) return;
    var taskDur = taskAbsEnd - taskAbsStart;
    if (taskDur <= 0) return;
    var hasOverlap = false;
    repairPeriods.forEach(function(rp){
        var oStart = Math.max(taskAbsStart, rp.abs_start);
        var oEnd = rp.abs_end !== null ? Math.min(taskAbsEnd, rp.abs_end) : taskAbsEnd;
        if (oEnd > oStart){
            hasOverlap = true;
            var ov = document.createElement('div');
            ov.className = 'repair-overlay';
            ov.style.left = ((oStart - taskAbsStart) / taskDur * 100) + '%';
            ov.style.width = ((oEnd - oStart) / taskDur * 100) + '%';
            block.appendChild(ov);
        }
    });
    if (hasOverlap && isCompleted){
        block.classList.add('has-repair');
    }
}

// ========== 工具提示 ==========
function showTimeTooltip(e){
    clearTimeout(taskTooltipHideTimeout);
    taskTooltipHideTimeout = null;
    // 支持连续模式和分班模式的容器
    const splitCont = e.target.closest('.split-timeline-container');
    const containerEl = splitCont || e.target.closest('.timeline-container');
    if (!containerEl) return;
    const rect = containerEl.getBoundingClientRect();
    const cs = getComputedStyle(containerEl);
    const borderLeft = parseFloat(cs.borderLeftWidth) || 0;
    const paddingLeft = parseFloat(cs.paddingLeft) || 0;
    let x = e.clientX - rect.left - borderLeft - paddingLeft - MACHINE_NAME_WIDTH + containerEl.scrollLeft;
    if (x < 0) return;
    let totalMin;
    if (splitCont) {
        // 分班模式：用轴的 splitStart + trackType 做压缩坐标反算
        var ss = parseInt(splitCont.dataset.splitStart, 10) || 0;
        var trackType = splitCont.id === 'split-tc-night' ? 'night' : 'day';
        totalMin = splitMinToAbs(ss + pxToMin(x), trackType);
    } else {
        totalMin = _getViewStartMin() + pxToMin(x);
    }
    totalMin = Math.max(MIN_ABS_MIN, Math.min(MAX_ABS_MIN, totalMin));
    const tip = document.getElementById('tooltip');
    if (!tip) return;
    tip.style.opacity = '1';
    tip.style.transition = '';
    tip.textContent = _formatAbsMin(totalMin);
    tip.style.display = 'block';
    tip.style.left = (e.clientX + 10) + 'px';
    tip.style.top = (e.clientY + 10) + 'px';
}
// ========== 任务悬浮提示（3秒静止后渐入） ==========
var taskTooltipTimer = null;
var taskTooltipHideTimeout = null;
var taskTooltipVisible = false;
var taskTooltipSid = null;
var taskTooltipX = 0, taskTooltipY = 0;

function _getTooltipDelayMs(){
    var el = document.getElementById('s-tooltip-delay');
    if(el){
        var sec = parseFloat(el.value);
        if(!isNaN(sec) && sec >= 0.5) return Math.round(sec * 1000);
    }
    return 3000;
}

function startTaskTooltipTimer(e, sid){
    taskTooltipSid = sid;
    taskTooltipX = e.clientX;
    taskTooltipY = e.clientY;
    clearTimeout(taskTooltipTimer);
    taskTooltipVisible = false;
    taskTooltipTimer = setTimeout(function(){
        _showTaskTooltipNow(taskTooltipSid, taskTooltipX, taskTooltipY);
        taskTooltipVisible = true;
    }, _getTooltipDelayMs());
}
function resetTaskTooltipTimer(e, sid){
    taskTooltipSid = sid;
    taskTooltipX = e.clientX;
    taskTooltipY = e.clientY;
    if(taskTooltipVisible){
        _hideTaskTooltip();
        taskTooltipVisible = false;
    }
    clearTimeout(taskTooltipTimer);
    taskTooltipTimer = setTimeout(function(){
        _showTaskTooltipNow(taskTooltipSid, taskTooltipX, taskTooltipY);
        taskTooltipVisible = true;
    }, _getTooltipDelayMs());
}
function clearTaskTooltipTimer(){
    clearTimeout(taskTooltipTimer);
    taskTooltipTimer = null;
    clearTimeout(taskTooltipHideTimeout);
    taskTooltipHideTimeout = null;
    if(taskTooltipVisible){
        _hideTaskTooltip();
        taskTooltipVisible = false;
    }
}
function _showTaskTooltipNow(sid, x, y){
    clearTimeout(taskTooltipHideTimeout);
    taskTooltipHideTimeout = null;
    var s = schedules.find(function(item){ return item.id == sid; });
    if(!s) return;
    var tip = document.getElementById('tooltip');
    var rowStyle = 'font-size:12px;line-height:1.6;';
    var html = '<div style="font-weight:bold;margin-bottom:4px;font-size:13px;">'+escHtml(s.task_name||'')+'</div>';
    html += '<div style="'+rowStyle+'">机型：'+escHtml(s.task_type||'')+'</div>';
    if(s.task_kind) html += '<div style="'+rowStyle+'">任务类型：'+escHtml(s.task_kind)+'</div>';
    if(s.priority) html += '<div style="'+rowStyle+'">优先级：'+escHtml(s.priority)+'</div>';
    if(s.difficulty) html += '<div style="'+rowStyle+'">难度：'+escHtml(s.difficulty)+'</div>';
    html += '<div style="'+rowStyle+'">时间：'+escHtml(s.abs_start_str||'')+' - '+escHtml(s.abs_end_str||'')+'</div>';
    var schedStartMin = parseInt(s.start_min) || 0;
    var schedEndMin = parseInt(s.end_min) || 0;
    var allocatedMin = schedEndMin - schedStartMin;
    if(allocatedMin > 0){
        var workingMin = allocatedMin;
        var dayBreaks = (SHIFT.day_shift && SHIFT.day_shift.breaks) ? SHIFT.day_shift.breaks : [];
        var nightBreaks = (SHIFT.night_shift && SHIFT.night_shift.breaks) ? SHIFT.night_shift.breaks : [];
        // 跨天任务可能跨越 +1440/-1440 偏移后的休息段，展开3个 day offset
        var allBreaks = [];
        var startDay = Math.floor(schedStartMin / 1440);
        var endDay = Math.floor((schedEndMin - 1) / 1440);
        for (var d = startDay - 1; d <= endDay + 1; d++) {
            var base = d * 1440;
            for (var bi = 0; bi < dayBreaks.length; bi++) {
                allBreaks.push([base + dayBreaks[bi][0], base + dayBreaks[bi][1]]);
            }
            for (var bi = 0; bi < nightBreaks.length; bi++) {
                allBreaks.push([base + nightBreaks[bi][0], base + nightBreaks[bi][1]]);
            }
        }
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
    html += '<div style="'+rowStyle+'">状态：'+(s.status==='completed'?'已完成':'执行中')+'</div>';
    if(s.package_name) html += '<div style="'+rowStyle+'">所属任务包：'+escHtml(s.package_name)+'</div>';
    if(s.remark) html += '<div style="'+rowStyle+'">备注：'+escHtml(s.remark)+'</div>';
    tip.innerHTML = html;
    tip.style.display = 'block';
    tip.style.left = (x + 12) + 'px';
    tip.style.top = (y + 12) + 'px';
    // 渐入动画
    var animCb = document.getElementById('s-enable-tooltip-anim');
    if(animCb && animCb.checked){
        tip.style.transition = 'opacity 0.3s ease';
        tip.style.opacity = '0';
        void tip.offsetWidth;
        tip.style.opacity = '1';
    }
}
function _hideTaskTooltip(){
    clearTimeout(taskTooltipHideTimeout);
    var tip = document.getElementById('tooltip');
    var animCb = document.getElementById('s-enable-tooltip-anim');
    if(animCb && animCb.checked){
        tip.style.transition = 'opacity 0.15s ease';
        tip.style.opacity = '0';
        taskTooltipHideTimeout = setTimeout(function(){
            if(tip.style.opacity === '0'){
                tip.style.display = 'none';
                tip.style.opacity = '1';
                tip.style.transition = '';
            }
            taskTooltipHideTimeout = null;
        }, 160);
    } else {
        tip.style.display = 'none';
        tip.style.opacity = '1';
        tip.style.transition = '';
    }
}
function hideTooltip(){document.getElementById('tooltip').style.display='none';}

// ========== 当前时间标记 ==========
function renderCurrentTimeMarker(){
    let now=new Date();let h=now.getHours();let m=now.getMinutes();let s=now.getSeconds();

    // 更新时钟 — 最先执行，确保始终更新
    let y=now.getFullYear(),mon=String(now.getMonth()+1).padStart(2,'0'),d=String(now.getDate()).padStart(2,'0');
    let hh=String(h).padStart(2,'0'),mm=String(m).padStart(2,'0'),ss=String(s).padStart(2,'0');
    var clockEl = document.getElementById('current-time-display');
    if(clockEl) clockEl.textContent=`${y}-${mon}-${d} ${hh}:${mm}:${ss}`;

    // 当前时间标记 — 用 try 包裹，避免标记不存在时阻断时钟更新
    try {
        let hw = getHourWidth();
        const marker = document.getElementById('current-marker');
        if(!marker) return;
        const toggle = document.getElementById('show-current-marker');
        const enabled = toggle ? toggle.checked : true;
        const viewStart = _getViewStartMin();
        const nowMin = h*MINS_PER_HOUR + m + (s/MINS_PER_HOUR);
        const [vs, ve] = getViewRange();
        const viewEnd = (ve <= vs) ? MINS_PER_DAY : ve;
        function parseISO(iso){
            const mm = String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if(!mm) return null;
            return new Date(parseInt(mm[1],10), parseInt(mm[2],10)-1, parseInt(mm[3],10));
        }
        let nowAbs = nowMin;
        const baseDateStr = document.getElementById('schedule-date') ? document.getElementById('schedule-date').value : SELECTED_DATE;
        const baseDt = parseISO(baseDateStr);
        if(baseDt){
            const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const diffDays = Math.round((today0.getTime() - baseDt.getTime()) / (24*60*60*1000));
            nowAbs = diffDays*MINS_PER_DAY + nowMin;
        }
        const offsetMin = nowAbs - viewStart;
        if(!enabled || nowAbs < vs || nowAbs > viewEnd || offsetMin < 0){
            marker.style.display = 'none';
        }else{
            marker.style.display = 'block';
            let offset = minToPx(offsetMin);
            marker.style.left = (MACHINE_NAME_WIDTH+offset)+'px';
        }
    } catch(e) {}

    // 班次高亮：按配置
    const dayS = hhmmToMin(SHIFT.day_shift.start)||540;
    const dayE = hhmmToMin(SHIFT.day_shift.end)||1110;
    const cur = h*60+m;
    document.querySelectorAll('.timeline-track').forEach(track=>{
        track.classList.remove('day-shift','night-shift');
        if(cur>=dayS && cur<dayE) track.classList.add('day-shift');
        else track.classList.add('night-shift');
    });
}

// ========== 自动分配预览卡片 ==========

function _renderPreviewCards(assigned) {
    _clearPreviewCards();
    var date = document.getElementById('schedule-date');
    var baseDate = date ? date.value : '';
    var vs = _getViewStartMin();
    assigned.forEach(function(a) {
        // 找到对应的机器行（timeline-track）
        var track = document.querySelector('.timeline-track[data-mid="' + a.machine_id + '"]');
        if (!track) return;

        var absStart = a.start_min;
        var absEnd = a.end_min;
        // 如果任务在跨天日期，计算绝对分钟偏移
        if (a.date && baseDate && a.date !== baseDate) {
            var taskDate = new Date(a.date + 'T00:00');
            var baseDt = new Date(baseDate + 'T00:00');
            if (!isNaN(taskDate.getTime()) && !isNaN(baseDt.getTime())) {
                var dayDiff = Math.round((taskDate - baseDt) / 86400000);
                absStart = a.start_min + dayDiff * 1440;
                absEnd = a.end_min + dayDiff * 1440;
            }
        }

        var leftPx = minToPx(absStart - vs);
        var widthPx = minToPx(Math.max(1, absEnd - absStart));

        var el = document.createElement('div');
        el.className = 'aa-preview-card';
        el.setAttribute('data-preview-task', a.task_id);
        el.style.left = leftPx + 'px';
        el.style.width = widthPx + 'px';
        el.textContent = (a.task_name || '') + ' ' + (a.start_str || '') + '-' + (a.end_str || '');
        track.appendChild(el);
    });
}
window._renderPreviewCards = _renderPreviewCards;

function _clearPreviewCards() {
    document.querySelectorAll('.aa-preview-card').forEach(function(el) { el.remove(); });
}
window._clearPreviewCards = _clearPreviewCards;

// Debounced window resize → recheck all task block stacking
var _stackedResizeTimer = null;
window.addEventListener('resize', function() {
    if (_stackedResizeTimer) clearTimeout(_stackedResizeTimer);
    _stackedResizeTimer = setTimeout(function() {
        requestAnimationFrame(function() {
            if (typeof _checkAllTaskBlocksStacked === 'function') _checkAllTaskBlocksStacked();
        });
    }, 150);
});
