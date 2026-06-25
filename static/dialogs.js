// ===================== 批量延迟 =====================
function openMassDelayDialog(){
    document.getElementById('dialog-backdrop').style.display = 'block';
    document.getElementById('mass-delay-dialog').style.display = 'block';
    loadMDMachines();
    _onMDTimeSrcChange(); // 初始化时间来源显示
    _onMDHelpToggle(); // 初始化帮助显示
}

function closeMassDelayDialog(){
    document.getElementById('mass-delay-dialog').style.display = 'none';
    document.getElementById('dialog-backdrop').style.display = 'none';
}

function loadMDMachines(){
    var container = document.getElementById('md-machine-list');
    if (!container) return;
    container.innerHTML = '加载中...';
    fetch('/api/machines').then(function(r) { return r.json(); }).then(function(data) {
        if (!data.machines) { container.innerHTML = '无机器'; return; }
        container.innerHTML = data.machines.map(function(m) {
            return '<label style="margin:2px;font-size:13px;white-space:nowrap;"><input type="checkbox" class="md-machine-check" value="' + m.id + '" data-type="' + escHtml(m.type) + '" checked> ' + escHtml(m.name) + '(' + escHtml(m.type) + '/' + (m.task_kind || '') + ')</label>';
        }).join('') || '无机器';
    }).catch(function() { container.innerHTML = '加载失败（网络错误）'; });
}

function _onMDTimeSrcChange(){
    const isNow = document.querySelector('input[name="md-time-src"]:checked').value === 'now';
    document.getElementById('md-from-wrap').style.display = isNow ? 'none' : '';
    document.getElementById('md-now-hint').style.display = isNow ? '' : 'none';
}

function _onMDHelpToggle(){
    const show = document.getElementById('md-show-help').checked;
    document.querySelectorAll('.md-help').forEach(el=>{ el.style.display = show ? '' : 'none'; });
}

function _getMDParams(){
    const date = document.getElementById('md-date').value;
    const delay = parseInt(document.getElementById('md-delay').value||'0',10) || 0;
    const mode = document.querySelector('input[name="md-mode"]:checked').value;
    const strategy = document.querySelector('input[name="md-strategy"]:checked').value;
    const timeSrc = document.querySelector('input[name="md-time-src"]:checked').value;
    let fromMin = 0;
    if(timeSrc === 'now'){
        const now = new Date();
        fromMin = now.getHours() * 60 + now.getMinutes();
    } else {
        const fromStr = (document.getElementById('md-from').value||'').trim();
        fromMin = fromStr ? (hhmmToMin(fromStr)||0) : 0;
    }
    const includeCompleted = document.getElementById('md-include-completed').checked;
    var extendOverBreaks = true;
    var mdeobEl = document.getElementById('md-extend-over-breaks');
    if(mdeobEl) extendOverBreaks = mdeobEl.checked;
    const machineIds = [];
    document.querySelectorAll('.md-machine-check:checked').forEach(c=>{ machineIds.push(parseInt(c.value,10)); });
    return {date, delay, mode, strategy, fromMin, machineIds, includeCompleted, extend_over_breaks: extendOverBreaks};
}

function executeMassDelay(){
    var params = _getMDParams();
    var date = params.date, delay = params.delay, mode = params.mode, strategy = params.strategy;
    var fromMin = params.fromMin, machineIds = params.machineIds, includeCompleted = params.includeCompleted;
    var extendOverBreaks = params.extend_over_breaks;

    if(machineIds.length === 0){ showToast('请至少选择一台机器'); return; }
    if(!delay && delay !== 0){ showToast('请输入有效的提前/延迟分钟数'); return; }
    if(delay === 0){ showToast('提前/延迟分钟数不能为0'); return; }

    var modeLabel = mode==='shift'?'平移延迟':'拉伸延迟';
    var strategyLabel = strategy==='block'?'整体后移':'智能填充';
    var timeLabel = document.querySelector('input[name="md-time-src"]:checked').value==='now' ?
        '当前时间('+String(Math.floor(fromMin/60)).padStart(2,'0')+':'+String(fromMin%60).padStart(2,'0')+')' :
        (fromMin>0 ? String(Math.floor(fromMin/60)).padStart(2,'0')+':'+String(fromMin%60).padStart(2,'0') : '全部');

    // 单台机器场景：检测冲突（所有策略）
    if(machineIds.length === 1){
        _checkDelayConflict(date, machineIds[0], delay, mode, fromMin, includeCompleted).then(function(action){
            if(action === 'cancel') return;
            if(action === 'recall' || action === 'delete' || action === 'move_end'){
                _handleSmartConflictAction(date, machineIds[0], action, fromMin, includeCompleted);
                return;
            }
            _doMassDelay(date, delay, mode, strategy, fromMin, machineIds, includeCompleted, extendOverBreaks);
        });
        return;
    }

    var actionWord = delay < 0 ? '提前' : '延迟';
    var absDelay = Math.abs(delay);
    var msg = '确定将 ' + machineIds.length + ' 台机器上从' + timeLabel + '开始的任务' +
        '<br>延迟方式：' + modeLabel + ' / 填充策略：' + strategyLabel +
        (includeCompleted ? ' / 含已完成' : '') +
        '<br>' + actionWord + ' ' + absDelay + ' 分钟？';
    showConfirm('批量延迟', '<p>'+msg+'</p>').then(function(ok){
        if(!ok) return;
        _doMassDelay(date, delay, mode, strategy, fromMin, machineIds, includeCompleted, extendOverBreaks);
    });
}

function _checkDelayConflict(date, mid, delay, mode, fromMin, includeCompleted){
    return fetch('/machine_schedules?date='+encodeURIComponent(date)+'&mid='+mid)
    .then(function(r){ return r.json(); }).then(function(d){
        var tasks = d.schedules;
        if(!Array.isArray(tasks) || tasks.length===0) return 'ok';
        // 找到受影响的任务
        var affected;
        if(includeCompleted){
            affected = tasks.filter(function(t){
                return t.start_min >= fromMin || (t.start_min < fromMin && t.end_min > fromMin);
            });
        } else {
            affected = tasks.filter(function(t){
                return t.status !== 'completed' && (t.start_min >= fromMin || (t.start_min < fromMin && t.end_min > fromMin));
            });
        }
        if(affected.length !== 1) return 'ok';
        var task = affected[0];
        var dur = task.end_min - task.start_min;
        var newStart, newEnd;
        if(mode === 'shift'){
            newStart = task.start_min + delay;
            newEnd = newStart + dur;
        } else {
            newStart = task.start_min;
            newEnd = task.end_min + delay;
        }
        // 检查是否与其他任务完全重合（start和end完全相同）
        var others = includeCompleted ?
            tasks.filter(function(t){ return t.id !== task.id; }) :
            tasks.filter(function(t){ return t.id !== task.id && t.status !== 'completed'; });
        var exactMatchName = null;
        for(var i = 0; i < others.length; i++){
            var o = others[i];
            if(o.start_min === newStart && o.end_min === newEnd){
                exactMatchName = o.task_name;
                break;
            }
        }
        if(exactMatchName){
            return new Promise(function(resolve){
                _showExactOverlapOptions(exactMatchName, resolve);
            });
        }
        // 检查是否与其他任务重叠（仅smart策略需要弹窗，block由normalize处理）
        var conflictName = null;
        for(var j = 0; j < others.length; j++){
            var o2 = others[j];
            if(newStart < o2.end_min && newEnd > o2.start_min){
                conflictName = o2.task_name;
                break;
            }
        }
        if(!conflictName) return 'ok';
        return new Promise(function(resolve){
            _showSmartConflictOptions(conflictName, resolve);
        });
    });
}

function _showExactOverlapOptions(conflictName, resolve){
    // 隐藏可能冲突的大弹窗遮罩层，关闭时恢复
    var prevBackdrop = document.getElementById('dialog-backdrop');
    var prevBackdropDisplay = prevBackdrop ? prevBackdrop.style.display : '';
    if (prevBackdrop) prevBackdrop.style.display = 'none';

    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,var(--dialog-overlay-opacity,0.5));z-index:20000;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = '<div style="background:var(--bg-card);border-radius:var(--radius);padding:24px;max-width:420px;box-shadow:var(--shadow-xl);">'+
        '<b style="font-size:15px;">时间段完全重合</b>'+
        '<p style="margin:12px 0;">延迟后时间段与 <b>'+escHtml(conflictName)+'</b> 完全重合</p>'+
        '<p style="font-size:12px;color:var(--text-muted);margin-bottom:12px;">两个任务的开始和结束时间将完全相同，请选择处理方式：</p>'+
        '<div style="display:flex;flex-direction:column;gap:6px;">'+
            '<button class="btn" style="text-align:left;" id="eo-opt-recall">回收任务（回到未分配列表）</button>'+
            '<button class="btn btn-danger" style="text-align:left;" id="eo-opt-delete">删除任务</button>'+
            '<button class="btn" style="text-align:left;" id="eo-opt-force">仍然延迟（保留两个相同时间段的任务）</button>'+
            '<button class="btn" style="text-align:left;margin-top:6px;" id="eo-opt-cancel">取消</button>'+
        '</div>'+
    '</div>';
    document.body.appendChild(overlay);
    function cleanup(val){
        overlay.remove();
        if (prevBackdrop && prevBackdropDisplay) prevBackdrop.style.display = prevBackdropDisplay;
        resolve(val);
    }
    overlay.querySelector('#eo-opt-recall').onclick = function(){ cleanup('recall'); };
    overlay.querySelector('#eo-opt-delete').onclick = function(){ cleanup('delete'); };
    overlay.querySelector('#eo-opt-force').onclick = function(){ cleanup('ok'); };
    overlay.querySelector('#eo-opt-cancel').onclick = function(){ cleanup('cancel'); };
    overlay.addEventListener('click', function(e){ if(e.target===overlay) cleanup('cancel'); });
}

function _showSmartConflictOptions(conflictName, resolve){
    // 隐藏可能冲突的大弹窗遮罩层，关闭时恢复
    var prevBackdrop = document.getElementById('dialog-backdrop');
    var prevBackdropDisplay = prevBackdrop ? prevBackdrop.style.display : '';
    if (prevBackdrop) prevBackdrop.style.display = 'none';

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,var(--dialog-overlay-opacity,0.5));z-index:20000;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = '<div style="background:var(--bg-card);border-radius:var(--radius);padding:24px;max-width:420px;box-shadow:var(--shadow-xl);">'+
        '<b style="font-size:15px;">智能填充-冲突处理</b>'+
        '<p style="margin:12px 0;">延迟后与 <b>'+escHtml(conflictName)+'</b> 重叠</p>'+
        '<div style="display:flex;flex-direction:column;gap:6px;">'+
            '<button class="btn" style="text-align:left;" id="sm-opt-move">移到最后（排在当天所有任务之后）</button>'+
            '<button class="btn" style="text-align:left;" id="sm-opt-recall">回收任务（回到未分配列表）</button>'+
            '<button class="btn btn-danger" style="text-align:left;" id="sm-opt-delete">删除任务</button>'+
            '<button class="btn" style="text-align:left;" id="sm-opt-force">仍然延迟（由归一化自动调整）</button>'+
            '<button class="btn" style="text-align:left;margin-top:6px;" id="sm-opt-cancel">取消</button>'+
        '</div>'+
    '</div>';
    document.body.appendChild(overlay);
    function cleanup(val){
        overlay.remove();
        if (prevBackdrop && prevBackdropDisplay) prevBackdrop.style.display = prevBackdropDisplay;
        resolve(val);
    }
    overlay.querySelector('#sm-opt-move').onclick = ()=>{ cleanup('move_end'); };
    overlay.querySelector('#sm-opt-recall').onclick = ()=>{ cleanup('recall'); };
    overlay.querySelector('#sm-opt-delete').onclick = ()=>{ cleanup('delete'); };
    overlay.querySelector('#sm-opt-force').onclick = ()=>{ cleanup('ok'); };
    overlay.querySelector('#sm-opt-cancel').onclick = ()=>{ cleanup('cancel'); };
    overlay.addEventListener('click', function(e){ if(e.target===overlay) cleanup('cancel'); });
}

function showCrossTypeDialog(opts){
    // opts: { taskType, machineType, taskKind, machineKind, typeMismatch, kindMismatch, machineName, mid, callbacks }
    // callbacks: { force, changeMachineType, changeTaskType, changeMachineKind, changeTaskKind, changeMachineBoth, changeTaskBoth, cancel }
    // 隐藏可能冲突的大弹窗遮罩层，关闭时恢复
    var prevBackdrop = document.getElementById('dialog-backdrop');
    var prevBackdropDisplay = prevBackdrop ? prevBackdrop.style.display : '';
    if (prevBackdrop) prevBackdrop.style.display = 'none';

    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,var(--dialog-overlay-opacity,0.5));z-index:20000;display:flex;align-items:center;justify-content:center;';

    var mismatchParts = [];
    if(opts.typeMismatch) mismatchParts.push('机型：任务<b style="color:#ef4444;">'+escHtml(opts.taskType)+'</b> ≠ 机器<b style="color:#ef4444;">'+escHtml(opts.machineType)+'</b>');
    if(opts.kindMismatch) mismatchParts.push('任务类型：任务<b style="color:#ef4444;">'+escHtml(opts.taskKind)+'</b> ≠ 机器<b style="color:#ef4444;">'+escHtml(opts.machineKind)+'</b>');

    var buttons = '';
    buttons += '<button class="btn" style="text-align:left;" id="xt-opt-force">确认指派（保留不匹配）</button>';

    if(opts.typeMismatch && opts.kindMismatch){
        // Both mismatch: 8 options
        buttons += '<button class="btn" style="text-align:left;" id="xt-opt-change-mtype">改变机器机型为"'+escHtml(opts.taskType)+'"</button>';
        buttons += '<button class="btn" style="text-align:left;" id="xt-opt-change-mkind">改变机器任务类型为"'+escHtml(opts.taskKind)+'"</button>';
        buttons += '<button class="btn" style="text-align:left;" id="xt-opt-change-mboth">改变机器机型+任务类型为"'+escHtml(opts.taskType)+'/'+escHtml(opts.taskKind)+'"</button>';
        buttons += '<button class="btn" style="text-align:left;" id="xt-opt-change-ttype">改变任务机型为"'+escHtml(opts.machineType)+'"</button>';
        buttons += '<button class="btn" style="text-align:left;" id="xt-opt-change-tkind">改变任务任务类型为"'+escHtml(opts.machineKind)+'"</button>';
        buttons += '<button class="btn" style="text-align:left;" id="xt-opt-change-tboth">改变任务机型+任务类型为"'+escHtml(opts.machineType)+'/'+escHtml(opts.machineKind)+'"</button>';
    } else if(opts.typeMismatch){
        // Only type mismatch: 4 options
        buttons += '<button class="btn" style="text-align:left;" id="xt-opt-change-mtype">改变机器机型为"'+escHtml(opts.taskType)+'"</button>';
        buttons += '<button class="btn" style="text-align:left;" id="xt-opt-change-ttype">改变任务机型为"'+escHtml(opts.machineType)+'"</button>';
    } else if(opts.kindMismatch){
        // Only kind mismatch: 4 options
        buttons += '<button class="btn" style="text-align:left;" id="xt-opt-change-mkind">改变机器任务类型为"'+escHtml(opts.taskKind)+'"</button>';
        buttons += '<button class="btn" style="text-align:left;" id="xt-opt-change-tkind">改变任务任务类型为"'+escHtml(opts.machineKind)+'"</button>';
    }
    buttons += '<button class="btn" style="text-align:left;margin-top:6px;" id="xt-opt-cancel">取消</button>';

    overlay.innerHTML = '<div style="background:var(--bg-card);border-radius:var(--radius);padding:24px;max-width:460px;box-shadow:var(--shadow-xl);">'+
        '<b style="font-size:15px;">类型不匹配</b>'+
        '<p style="margin:12px 0;">目标机器：<b>'+escHtml(opts.machineName)+'</b></p>'+
        '<p style="margin:0 0 12px 0;">'+mismatchParts.join('<br>')+'</p>'+
        '<p style="font-size:12px;color:var(--text-muted);margin-bottom:12px;">类型不匹配的任务可能无法正常采集，请选择处理方式：</p>'+
        '<div style="display:flex;flex-direction:column;gap:6px;max-height:50vh;overflow-y:auto;">'+
            buttons+
        '</div>'+
    '</div>';
    document.body.appendChild(overlay);
    var callbacks = opts.callbacks || {};
    function cleanup(val){
        overlay.remove();
        // 恢复大弹窗遮罩层
        if (prevBackdrop && prevBackdropDisplay) prevBackdrop.style.display = prevBackdropDisplay;
        if (callbacks[val]) callbacks[val]();
    }
    overlay.querySelector('#xt-opt-force').onclick = function(){ cleanup('force'); };
    var typeBtns = ['xt-opt-change-mtype','xt-opt-change-ttype','xt-opt-change-mkind','xt-opt-change-tkind','xt-opt-change-mboth','xt-opt-change-tboth'];
    typeBtns.forEach(function(id){
        var el = overlay.querySelector('#'+id);
        if(el) el.onclick = function(){ cleanup(id.replace('xt-opt-','')); };
    });
    overlay.querySelector('#xt-opt-cancel').onclick = function(){ cleanup('cancel'); };
    overlay.addEventListener('click', function(e){ if(e.target===overlay) cleanup('cancel'); });
}

function _handleSmartConflictAction(date, mid, action, fromMin, includeCompleted){
    var statusFilter = includeCompleted ? function(t){ return true; } : function(t){ return t.status !== 'completed'; };
    if(action === 'move_end'){
        fetch('/machine_schedules?date='+encodeURIComponent(date)+'&mid='+mid)
        .then(function(r){ return r.json(); }).then(function(d){
            var tasks = d.schedules;
            var affected = tasks.filter(function(t){
                return statusFilter(t) && (t.start_min >= fromMin || (t.start_min < fromMin && t.end_min > fromMin));
            });
            if(affected.length !== 1){ _silentRefreshDelay(date, [mid]); return; }
            var task = affected[0];
            var others = tasks.filter(function(t){ return t.id !== task.id && statusFilter(t); });
            var lastEnd = Math.max(0, others.length ? others.map(function(t){ return t.end_min; }).reduce(function(a,b){ return Math.max(a,b); }) : 0);
            var dur = task.end_min - task.start_min;
            var newStart = Math.max(lastEnd, fromMin);
            var newEnd = newStart + dur;
            fetch('/update_task_bounds', {
                method:'POST',
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify({date:date, schedule_id:task.id, start_min:newStart, end_min:newEnd})
            }).then(function(r){ return r.json(); }).then(function(d){
                showToast(d.msg||'已移到最后');
                _silentRefreshDelay(date, [mid]);
            });
        });
    } else if(action === 'recall'){
        fetch('/machine_schedules?date='+encodeURIComponent(date)+'&mid='+mid)
        .then(function(r){ return r.json(); }).then(function(d){
            var tasks = d.schedules;
            var affected = tasks.filter(function(t){
                return statusFilter(t) && (t.start_min >= fromMin || (t.start_min < fromMin && t.end_min > fromMin));
            });
            if(affected.length !== 1){ _silentRefreshDelay(date, [mid]); return; }
            recycleTasks({
                scheduleIds: [affected[0].id],
                skipConfirm: true,
                onSuccess: function(){ _silentRefreshDelay(date, [mid]); }
            });
        });
    } else if(action === 'delete'){
        fetch('/machine_schedules?date='+encodeURIComponent(date)+'&mid='+mid)
        .then(function(r){ return r.json(); }).then(function(d){
            var tasks = d.schedules;
            var affected = tasks.filter(function(t){
                return statusFilter(t) && (t.start_min >= fromMin || (t.start_min < fromMin && t.end_min > fromMin));
            });
            if(affected.length !== 1){ _silentRefreshDelay(date, [mid]); return; }
            fetch('/del_schedule/'+affected[0].id).then(function(r){ return r.json(); }).then(function(d){
                showToast(d.msg||'已删除');
                _silentRefreshDelay(date, [mid]);
            });
        });
    }
}

function _doMassDelay(date, delay, mode, strategy, fromMin, machineIds, includeCompleted, extendOverBreaks){
    fetch('/mass_delay', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
            date: date, machine_ids: machineIds, delay_minutes: delay, from_start_min: fromMin,
            mode: mode, strategy: strategy, include_completed: includeCompleted || false,
            extend_over_breaks: extendOverBreaks !== false
        })
    }).then(function(r){ return r.json(); }).then(function(d){
        closeMassDelayDialog();
        showToast(d.msg||'延迟完成');
        var affectedIds = d.affected_ids || [];
        var currentDate = (document.getElementById('schedule-date')||{}).value || '';
        if (affectedIds.length > 0 && date === currentDate) {
            _animateDelayBlocks(date, machineIds, affectedIds);
        } else {
            _silentRefreshDelay(date, machineIds);
        }
    });
}

function _animateDelayBlocks(date, machineIds, affectedIds){
    var affectedSet = {};
    affectedIds.forEach(function(id){ affectedSet[id] = true; });

    var fetches = machineIds.map(function(mid){
        return fetch('/machine_schedules?mid=' + mid + '&date=' + encodeURIComponent(date))
            .then(function(r){ return r.json(); })
            .then(function(d){ return d.schedules; });
    });

    Promise.all(fetches).then(function(results){
        var newPositions = {};
        results.forEach(function(schedules){
            schedules.forEach(function(s){
                if (!affectedSet[s.id]) return;
                newPositions[s.id] = {
                    absStart: _dateMinToAbs(date, s.start_min),
                    absEnd: _dateMinToAbs(date, s.end_min)
                };
            });
        });

        var blocks = [];
        var vs = _getViewStartMin();
        var blockEls = document.querySelectorAll('.task-block[data-sid]');
        blockEls.forEach(function(block){
            var sid = parseInt(block.dataset.sid);
            if (!affectedSet[sid]) return;
            var np = newPositions[sid];
            if (!np) return;
            var track = block.closest('.timeline-track');
            if (!track) return;
            var trackRect = track.getBoundingClientRect();
            var blockRect = block.getBoundingClientRect();
            // Snap current position to inline styles
            block.style.left = (blockRect.left - trackRect.left) + 'px';
            block.style.width = blockRect.width + 'px';
            block.style.setProperty('--start', String(np.absStart));
            block.style.setProperty('--dur', String(Math.max(1, np.absEnd - np.absStart)));
            blocks.push({
                el: block,
                newLeft: minToPx(np.absStart - vs) + 'px',
                newWidth: minToPx(Math.max(1, np.absEnd - np.absStart)) + 'px'
            });
        });

        if (blocks.length === 0) { _silentRefreshDelay(date, machineIds); return; }

        // Force reflow so the browser registers the initial inline positions
        void document.body.offsetHeight;

        var animating = true;
        function finish(){
            if (!animating) return;
            animating = false;
            document.removeEventListener('click', finish, true);
            _silentRefreshDelay(date, machineIds);
        }
        document.addEventListener('click', finish, true);

        blocks.forEach(function(b){
            b.el.classList.add('md-animating', 'md-highlight');
            b.el.style.left = b.newLeft;
            b.el.style.width = b.newWidth;
        });

        // After transition ends, silent refresh
        var maxBlock = blocks[blocks.length - 1].el;
        maxBlock.addEventListener('transitionend', function(){
            if (animating) finish();
        });
    });
}

function _silentRefreshDelay(date, machineIds){
    silentRefreshSchedules(function(){
        refreshLiveStatus();
    });
}
