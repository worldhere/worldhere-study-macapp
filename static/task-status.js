// golden scheduling app — task status & split index
// 依赖：core.js（坐标系统、工具函数）

function _statusColor(status) {
    if (status === '采集中') return '#2e7d32';
    if (status === '过时待确认') return '#e65100';
    if (status === '暂停中') return '#d84315';
    if (status === '采集即将完成') return '#f57c00';
    if (status === '暂停即将超时') return '#b71c1c';
    return '';
}

// ========== 切割段顺序约束 ==========
var splitIndex = {}; // { split_group: [{tid, order, start_min, end_min, mid, date, abs_start, abs_end}] }

function buildSplitIndex(){
    splitIndex = {};
    schedules.forEach(function(s){
        var tid = s.task_id;
        if(!tid) return;
        var t = getTaskById(tid);
        if(!t) return;
        var group = t.split_group;
        if(!group) return;
        var order = t.split_order || 0;
        if(!splitIndex[group]) splitIndex[group] = [];
        var abs_start = _dateMinToAbs(s.date, s.start_min);
        var abs_end = _dateMinToAbs(s.date, s.end_min);
        if (abs_end <= abs_start) abs_end += MINS_PER_DAY;
        splitIndex[group].push({
            tid: tid, order: order,
            start_min: s.start_min, end_min: s.end_min,
            mid: s.machine_id, date: s.date,
            abs_start: abs_start, abs_end: abs_end
        });
    });
    // 排序
    Object.keys(splitIndex).forEach(function(g){
        splitIndex[g].sort(function(a, b){ return a.order - b.order; });
    });
}

function getSplitConstraint(tid){
    // 返回该切割段的时间边界：{min_start, max_end}
    var t = getTaskById(tid);
    if(!t) return null;
    var group = t.split_group;
    if(!group) return null;
    var order = t.split_order || 0;
    var segments = splitIndex[group];
    if(!segments || segments.length < 2) return null;
    var constraint = {};
    // 前一段的结束时间 = 本段最早开始时间
    if(order > 1){
        var prev = segments.find(function(s){ return s.order === order - 1; });
        if(prev) constraint.min_abs_start = prev.abs_end;
    }
    // 后一段的开始时间 = 本段最晚结束时间
    var next = segments.find(function(s){ return s.order === order + 1; });
    if(next) constraint.max_abs_end = next.abs_start;
    return (constraint.min_abs_start || constraint.max_abs_end) ? constraint : null;
}

function dateToAbsMin(dateStr){
    var d = new Date(dateStr + 'T00:00:00');
    var base = new Date('2020-01-01T00:00:00');
    return Math.round((d - base) / 60000);
}

// ========== 实时状态轮询 ==========
function refreshLiveStatus(){
    fetch('/current_status').then(function(r){ return r.json(); }).then(function(data){
        var ts = data.task_statuses || {};
        var ms = data.machine_statuses || {};

        // 先更新 TASKS_DATA 中全部任务的状态（不受分页影响）
        for (var i = 0; i < TASKS_DATA.length; i++) {
            var task = TASKS_DATA[i];
            var tid = task.id;
            var dyn = ts[tid];
            if (dyn && task.status !== '已完成' && task.status !== '已确认') {
                task.status = dyn;
            }
        }

        // 再更新当前页 DOM 中的状态显示
        document.querySelectorAll('.task-status-text').forEach(function(el){
            var tid = parseInt(el.dataset.tid, 10);
            var orig = el.dataset.orig || '';
            var dyn = ts[tid];
            if (dyn && orig !== '已完成' && orig !== '已确认'){
                el.textContent = dyn;
                el.style.color = _statusColor(dyn);
            } else {
                el.textContent = orig;
                el.style.color = '';
            }
        });

        // Re-apply filters if a status filter is active
        var fsEl = document.getElementById('task-filter-status');
        if (fsEl && fsEl.value) {
            applyTaskFilters();
        }
        // 更新机器管理中的机器状态
        document.querySelectorAll('.machine-status-text').forEach(function(el){
            var mid = parseInt(el.dataset.mid, 10);
            if(ms[mid]){
                el.textContent = ms[mid];
            }
        });
        // 更新时间轴上机器轨道的样式
        document.querySelectorAll('.timeline-track').forEach(function(track){
            var mid = parseInt(track.dataset.mid, 10);
            if(ms[mid] === '工作'){
                track.classList.remove('repair-track');
            } else if(ms[mid] === '维修停用'){
                track.classList.add('repair-track');
            }
            if(ms[mid] === '维修停用'){
                var blocks = track.querySelectorAll('.task-block:not(.task-completed)');
                blocks.forEach(function(block){
                    block.classList.remove('task-paused', 'task-post-pause');
                    var tid = parseInt(block.dataset.tid, 10);
                    if(ts[tid] === '暂停中'){
                        block.classList.add('task-paused');
                    } else {
                        block.classList.add('task-post-pause');
                    }
                });
            } else {
                track.querySelectorAll('.task-block').forEach(function(block){
                    block.classList.remove('task-paused', 'task-post-pause');
                });
            }
            var mtype = track.dataset.mtype || '';
            var mkind = track.dataset.mkind || '';
            track.querySelectorAll('.task-block:not(.task-completed)').forEach(function(block){
                var btype = block.dataset.type || '';
                var bkind = block.dataset.kind || '';
                var typeBad = !!(mtype && btype && btype !== mtype);
                var kindBad = !!(mkind && bkind && bkind !== mkind);
                if(typeBad || kindBad){
                    block.classList.add('task-incompatible');
                } else {
                    block.classList.remove('task-incompatible');
                }
            });
        });
        _syncAllTaskTableTimes();
    }).catch(function(){}); // 静默失败
}
