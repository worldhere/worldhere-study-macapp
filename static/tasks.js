// golden scheduling app — 协调层：跨模块操作 + 班次设置 + 初始化
// 依赖：core.js, task-status.js, task-pool.js, task-table.js, task-edit.js

// ========== 班次设置 ==========
function validateShiftFormat(t){
    var warnEl = document.getElementById(t+'_warn');
    if(!warnEl) return;
    var overVal = (document.getElementById(t+'_over').value || '').trim().replace(/[：]/g, ':');
    var breaksVal = (document.getElementById(t+'_breaks') ? document.getElementById(t+'_breaks').value : '').trim().replace(/[：]/g, ':').replace(/[，、。]/g, ',');
    var warnings = [];

    if(overVal){
        var parts = overVal.split(/[,，;；]+/).map(function(x){ return x.trim(); }).filter(Boolean);
        var badParts = parts.filter(function(p){ return !p.match(/^\d{1,2}:\d{2}\s*-\s*(\d{1,2}:\d{2}|24:00)$/); });
        if(badParts.length > 0){
            warnings.push('加班格式有误：应为"HH:MM-HH:MM"，逗号分隔，如 20:00-24:00');
        }else{
            var allOk = parts.every(function(p){
                var m = p.match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2}|24:00)$/);
                if(!m) return false;
                var a = hhmmToMin(m[1]), b = m[2]==='24:00' ? MINS_PER_DAY : hhmmToMin(m[2]);
                return a !== null && b !== null;
            });
            if(!allOk) warnings.push('加班格式有误：时间无法解析');
        }
    }

    if(breaksVal){
        var parts = breaksVal.split(/[,，;；]+/).map(function(x){ return x.trim(); }).filter(Boolean);
        var badParts = parts.filter(function(p){
            var m1 = p.match(/^\d{1,2}:\d{2}\s*\/\s*\d+$/);
            var m2 = p.match(/^\d{1,2}:\d{2}\s*[-\/]\s*\d{1,2}:\d{2}$/);
            return !(m1 || m2);
        });
        if(badParts.length > 0){
            warnings.push('休息段格式有误：应为"HH:MM/分钟"或"HH:MM-HH:MM"，如 12:00/30 或 12:00-12:30');
        }
    }

    if(warnings.length > 0){
        warnEl.textContent = warnings.join('；');
        warnEl.style.display = '';
    }else{
        warnEl.textContent = '';
        warnEl.style.display = 'none';
    }
}

function saveShift(t){
    var startVal = document.getElementById(t+'_start').value;
    var endVal = document.getElementById(t+'_end').value;
    var overVal = document.getElementById(t+'_over').value;
    var breaksVal = document.getElementById(t+'_breaks') ? document.getElementById(t+'_breaks').value : '';
    fetch('/save_shift',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
            type:t,
            start: startVal,
            end: endVal,
            over: overVal,
            breaks: breaksVal
        })
    }).then(function(r){ return r.json(); }).then(function(d){
        showToast(d.msg);
        var key = t === 'day' ? 'day_shift' : 'night_shift';
        SHIFT[key] = {
            start: startVal, end: endVal,
            overtime: parseTimeRangeList(overVal),
            breaks: parseBreakList(breaksVal)
        };
        renderShiftOverlaySegments();
    });
}

// ========== 统合刷新入口 ==========
function _silentRefresh(opts){
    opts = opts || {};
    if(opts.machines) _refreshMachineList();
    _refreshTaskList();
    if(_getActiveTab()===3) {
        var _srdm = '';
        try { _srdm = localStorage.getItem('displayMode') || 'continuous'; } catch(e) {}
        if (_srdm === 'split' && typeof splitRefreshTimeline === 'function') splitRefreshTimeline();
        else _refreshTimelineFromServer();
    }
    if(_getActiveTab()===4 && typeof _refreshHistory === 'function') _refreshHistory();
}

// ========== 统一回收入口 ==========
function recycleTasks(opts) {
    opts = opts || {};
    var payload = {};
    if (opts.scheduleIds && opts.scheduleIds.length) payload.schedule_ids = opts.scheduleIds;
    if (opts.taskIds && opts.taskIds.length) payload.task_ids = opts.taskIds;
    if (opts.machineId != null) {
        payload.machine_id = opts.machineId;
        payload.date = opts.date || document.getElementById('schedule-date').value;
    }

    // 捕获回收前的位置信息（用于压实）
    var _compactTargets = [];
    if (window._autoCompactRecycle && !opts.skipLocalCleanup) {
        if (opts.scheduleIds) {
            opts.scheduleIds.forEach(function(sid) {
                var s = schedules.find(function(item){ return item.id == sid; });
                if (s) _compactTargets.push({mid: s.machine_id, date: s.date, start: s.start_min, end: s.end_min});
            });
        } else if (opts.taskIds) {
            opts.taskIds.forEach(function(tid) {
                var matching = schedules.filter(function(item){ return item.task_id == tid; });
                matching.forEach(function(s) {
                    _compactTargets.push({mid: s.machine_id, date: s.date, start: s.start_min, end: s.end_min});
                });
            });
        }
    }

    function execute() {
        if (!opts.skipLocalCleanup) {
            if (opts.scheduleIds) {
                opts.scheduleIds.forEach(function(sid) {
                    var b = document.querySelector('.task-block[data-sid="' + sid + '"]');
                    if (b) b.remove();
                });
                schedules = schedules.filter(function(s) {
                    return opts.scheduleIds.indexOf(s.id) === -1;
                });
            }
            if (opts.taskIds) {
                opts.taskIds.forEach(function(tid) {
                    document.querySelectorAll('.task-block[data-tid="' + tid + '"]').forEach(function(b) { b.remove(); });
                    _updateTaskStatusText(tid, '待分配');
                });
                schedules = schedules.filter(function(s) {
                    return s.task_id == null || opts.taskIds.indexOf(s.task_id) === -1;
                });
            }
            if (opts.machineId != null) {
                var _date = payload.date;
                document.querySelectorAll('.machine-row .timeline-track[data-mid="' + opts.machineId + '"] .task-block').forEach(function(b) { b.remove(); });
                schedules = schedules.filter(function(s) {
                    return !(s.machine_id == opts.machineId && s.date == _date);
                });
            }
        }

        fetch('/api/recycle', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        }).then(function(r) { return r.json(); }).then(function(d) {
            showToast(d.msg);
            function afterCompact() {
                if (opts.onSuccess) {
                    opts.onSuccess(d);
                } else {
                    _silentRefresh();
                }
                refreshLiveStatus();
            }
            if (_compactTargets.length > 0) {
                var done = 0;
                _compactTargets.forEach(function(t) {
                    _compactAfterRecycle(t.mid, t.date, t.start, t.end, function(){
                        done++;
                        if (done >= _compactTargets.length) afterCompact();
                    });
                });
            } else {
                afterCompact();
            }
        });
    }

    if (opts.skipConfirm) {
        execute();
    } else {
        var msg = opts.confirmMsg || '<p>确定回收任务？</p>';
        var title = opts.confirmTitle || '回收任务';
        showConfirm(title, msg).then(function(ok) {
            if (ok) execute();
        });
    }
}

// ========== 时间轴全量重建 ==========
function _refreshTimelineFromServer() {
    if (typeof _abortCurrentAnim === 'function') { _abortCurrentAnim(); }
    if (window.AA && AA._state.previewData) {
        AA._hidePreviewBar();
        AA._unmarkPoolPreview();
        AA._state.previewData = null;
        AA._state.previewParams = null;
        showToast('时间轴已变更，已自动退出预览模式');
    }
    var fullDate = document.getElementById('schedule-date').value;
    var urlParams = new URLSearchParams(window.location.search);
    var spanDays = parseInt(urlParams.get('span_days') || '2', 10) || 2;
    var viewMode = 'default';
    try { viewMode = localStorage.getItem('viewMode') || 'default'; } catch(e) {}
    var schedUrl;
    if (viewMode === 'custom') {
        var csd = document.getElementById('custom-start-date');
        var ced = document.getElementById('custom-end-date');
        if (csd && ced && csd.value && ced.value) {
            schedUrl = '/api/view_schedules?date=' + encodeURIComponent(fullDate) + '&date_from=' + encodeURIComponent(csd.value) + '&date_to=' + encodeURIComponent(ced.value);
        } else {
            schedUrl = '/api/view_schedules?date=' + encodeURIComponent(fullDate) + '&span_days=' + spanDays;
        }
    } else {
        schedUrl = '/api/view_schedules?date=' + encodeURIComponent(fullDate) + '&span_days=' + spanDays;
    }
    Promise.all([
        fetch('/api/machines').then(function(r) { return r.json(); }),
        fetch(schedUrl).then(function(r) { return r.json(); })
    ]).then(function(results) {
        var machines = results[0].machines;
        var freshData = results[1];
        schedules = freshData.schedules;
        window._repairLogs = freshData.repair_logs || {};
        machines = _sortMachinesByURL(_filterMachinesByUI(machines));
        machines = machines.filter(function(m) { return !_hiddenMachineIds.has(m.id); });
        var container = document.querySelector('.timeline-container');
        if (!container) return;
        container.querySelectorAll('.machine-row').forEach(function(row) { row.remove(); });
        machines.forEach(function(m) {
            _syncTimelineMachineRow(m);
        });
        if (document.getElementById('sticky-machine-col') && document.getElementById('sticky-machine-col').checked) {
            document.querySelectorAll('.machine-row .machine-name-col').forEach(function(el) {
                el.classList.add('sticky-col');
            });
        }
        rebuildTimelineGrid();
        _renderAllTaskBlocks();
        renderShiftOverlaySegments();
        renderViewMask();
        renderCurrentTimeMarker();
        refreshLiveStatus();
    }).catch(function(e){
        console.error('排班数据加载失败:', e);
        showToast('排班数据加载失败，请检查网络或刷新页面');
    });
}

// ========== 初始化 ==========
document.addEventListener("DOMContentLoaded", function(){
    // 恢复任务库模式
    try{
        var saved = localStorage.getItem("taskMode");
        if(saved === "detail"){
            switchTaskModeBtn("detail");
        }
    }catch(e){}
    // 恢复时长显示单位
    try{
        var savedUnit = localStorage.getItem("durationUnit");
        if(savedUnit){
            document.getElementById("duration-unit").value = savedUnit;
            toggleDurationUnit();
        }
    }catch(e){}
    // 表头排序点击
    document.querySelectorAll('#task-table th.sortable, #task-table-detail th.sortable').forEach(function(th) {
        th.addEventListener('click', function() {
            var col = th.dataset.sort;
            if (taskSortState.column === col) {
                taskSortState.direction = (taskSortState.direction + 1) % 3;
            } else {
                taskSortState.column = col;
                taskSortState.direction = 1;
            }
            _updateSortIndicators();
            applyTaskFilters();
        });
    });
    // 构建切割段索引
    buildSplitIndex();
    // 启动实时状态轮询
    refreshLiveStatus();
    setInterval(refreshLiveStatus, 30000);
});
