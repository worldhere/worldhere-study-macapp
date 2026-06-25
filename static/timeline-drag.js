// golden scheduling app — timeline drag & drop, move, resize

// ========== 休息段吸附 ==========
function _applyBreakSnap(absMin, isStart){
    if(isStart && !window._snapStartToBreak) return absMin;
    if(!isStart && !window._snapEndToBreak) return absMin;

    var localMin = ((absMin % 1440) + 1440) % 1440;

    var breaks = [];
    if(SHIFT.day_shift && SHIFT.day_shift.breaks) breaks = breaks.concat(SHIFT.day_shift.breaks);
    if(SHIFT.night_shift && SHIFT.night_shift.breaks) breaks = breaks.concat(SHIFT.night_shift.breaks);

    for(var i = 0; i < breaks.length; i++){
        var bs = breaks[i][0];
        var be = breaks[i][1];
        if(localMin >= bs && localMin < be){
            if(isStart){
                return absMin + (be - localMin);
            } else {
                return absMin + (bs - localMin);
            }
        }
    }
    return absMin;
}

// ========== 拖拽基础 ==========
var currentDragKind = null;
function dragStart(e){
    var target = e.currentTarget || e.target;
    e.dataTransfer.setData("text/plain", target.dataset.tid);
    currentDragSid = null; currentDragTid = target.dataset.tid; currentDragType = target.dataset.type; currentDragKind = target.dataset.kind || '';
    const blockRect = target.getBoundingClientRect();
    dragOffsetX = e.clientX - blockRect.left;
    document.addEventListener('dragover', _onDragOverPage, true);
}
function allowDrop(e){
    e.preventDefault();e.stopPropagation();
    // 支持连续模式 (.timeline-container) 和分班模式 (.split-timeline-container)
    const container = (e.currentTarget || e.target).closest('.timeline-container, .split-timeline-container');
    if(!container) return;
    const rect = container.getBoundingClientRect();
    const x = e.clientX;
    if(x < rect.left + SCROLL_ZONE){
        container.scrollLeft -= SCROLL_SPEED;
    } else if(x > rect.right - SCROLL_ZONE){
        container.scrollLeft += SCROLL_SPEED;
    }
}
function dragScheduledTask(e){
    if(_movePendingCleanup){ _movePendingCleanup(); _movePendingCleanup = null; _movePendingSid = null; }
    if(movingSid){
        document.removeEventListener('mousemove',handleMove,true);
        document.removeEventListener('mouseup',stopMove,true);
        movingSid=null;
    }
    var target = e.currentTarget || e.target;
    e.dataTransfer.setData("text/plain", target.dataset.sid);
    currentDragSid = target.dataset.sid; currentDragTid = target.dataset.tid; currentDragType = target.dataset.type; currentDragKind = target.dataset.kind || '';
    const blockRect = e.target.getBoundingClientRect();
    dragOffsetX = e.clientX - blockRect.left;
    document.addEventListener('dragover', _onDragOverPage, true);
}
function dragEnd(e){
    _stopPageAutoScroll();
    document.removeEventListener('dragover', _onDragOverPage, true);
    if(_movePendingCleanup){ _movePendingCleanup(); _movePendingCleanup = null; _movePendingSid = null; }
    if(movingSid){
        document.removeEventListener('mousemove',handleMove,true);
        document.removeEventListener('mouseup',stopMove,true);
        movingSid=null;
    }
}

// ========== 放置任务 ==========

function _pxToAbsMinForBlock(block, px) {
    // 分班模式：用轴容器的 splitStart + splitMinToAbs 反算
    var dm = '';
    try { dm = localStorage.getItem('displayMode') || 'continuous'; } catch(e) {}
    if (dm === 'split') {
        var parentTrack = block.closest('.timeline-track');
        var trackType = parentTrack ? (parentTrack.dataset.trackType || 'day') : 'day';
        var cont = block.closest('.split-timeline-container') || block.closest('.timeline-container');
        var ss = cont ? (parseInt(cont.dataset.splitStart, 10) || 0) : 0;
        return splitMinToAbs(ss + pxToMin(px), trackType);
    }
    return _getViewStartMin() + pxToMin(px);
}

function dropTask(e){
    e.preventDefault();e.stopPropagation();
    let targetTrack = e.currentTarget;
    let mid = targetTrack.dataset.mid; let mtype = targetTrack.dataset.mtype;
    let rect = targetTrack.getBoundingClientRect();
    let leftPx = Math.max(0, Math.min(e.clientX - rect.left - dragOffsetX, rect.width - 20));
    var _dm = '';
    try { _dm = localStorage.getItem('displayMode') || 'continuous'; } catch(e) {}
    let absStartMin;
    if (_dm === 'split') {
        var _trackType = targetTrack.dataset.trackType || 'day';
        var _cont = targetTrack.closest('.split-timeline-container') || targetTrack.closest('.timeline-container');
        var _ss = _cont ? (parseInt(_cont.dataset.splitStart, 10) || 0) : 0;
        absStartMin = splitMinToAbs(_ss + pxToMin(leftPx), _trackType);
    } else {
        absStartMin = _getViewStartMin() + pxToMin(leftPx);
    }
    absStartMin = clampAbsMin(absStartMin);
    // 切割约束：检查是否切割段，限制不能拖到前段之前
    if (currentDragSid) {
        var _sidSch = schedules.find(function(item){ return item.id == currentDragSid; });
        if (_sidSch && _sidSch.task_id) {
            var _sc = getSplitConstraint(_sidSch.task_id);
            if (_sc && _sc.min_abs_start != null) absStartMin = Math.max(absStartMin, _sc.min_abs_start);
        }
    }
    if (currentDragTid) {
        var _tc = getSplitConstraint(currentDragTid);
        if (_tc && _tc.min_abs_start != null) absStartMin = Math.max(absStartMin, _tc.min_abs_start);
    }
    const {date: targetDate, min: startMin} = _absMinToDateMin(absStartMin);

    var mkind = targetTrack.dataset.mkind || '';
    var taskKind = currentDragKind || '';
    var typeMismatch = !!(currentDragType && mtype && currentDragType !== mtype);
    var kindMismatch = !!(taskKind && mkind && taskKind !== mkind);

    if(typeMismatch || kindMismatch){
        // 从待分配任务区拖过来的：检查是否开启拦截
        if(!currentDragSid && currentDragTid && window._crossTypeBlockSetting === true){
            showToast('任务类型/机器类型不匹配，放置已拦截');
            return;
        }

        var machineName = targetTrack.closest('.machine-row') ? (targetTrack.closest('.machine-row').querySelector('.machine-name-col')||{}).textContent||'' : '';

        function getTaskId(){
            if(currentDragSid){
                var s = schedules.find(function(s){return s.id==currentDragSid;});
                return s ? s.task_id : null;
            }
            return currentDragTid;
        }

        function doChangeMachineType(cb){
            fetch('/update_machine_type', {
                method:'POST', headers:{'Content-Type':'application/json'},
                body:JSON.stringify({id: parseInt(mid), type: currentDragType})
            }).then(function(r){ return r.json(); }).then(function(d){
                targetTrack.dataset.mtype = currentDragType;
                showToast(d.msg);
                cb();
            });
        }

        function doChangeMachineKind(cb){
            fetch('/update_machine_task_kind', {
                method:'POST', headers:{'Content-Type':'application/json'},
                body:JSON.stringify({id: parseInt(mid), task_kind: taskKind})
            }).then(function(r){ return r.json(); }).then(function(d){
                targetTrack.dataset.mkind = taskKind;
                showToast(d.msg);
                cb();
            });
        }

        function doChangeTaskType(cb){
            var taskId = getTaskId();
            if(!taskId){ cb(); return; }
            fetch('/update_task',{
                method:'POST', headers:{'Content-Type':'application/json'},
                body:JSON.stringify({id: parseInt(taskId), type: mtype, pri: '', diff: ''})
            }).then(function(r){ return r.json(); }).then(function(d){
                currentDragType = mtype;
                showToast(d.msg);
                cb();
            });
        }

        function doChangeTaskKind(cb){
            var taskId = getTaskId();
            if(!taskId){ cb(); return; }
            fetch('/update_task',{
                method:'POST', headers:{'Content-Type':'application/json'},
                body:JSON.stringify({id: parseInt(taskId), task_kind: mkind, pri: '', diff: ''})
            }).then(function(r){ return r.json(); }).then(function(d){
                currentDragKind = mkind;
                showToast(d.msg);
                cb();
            });
        }

        function doDrop(force){
            _performDrop(currentDragSid, currentDragTid, mid, targetDate, startMin, targetTrack, force);
        }

        showCrossTypeDialog({
            taskType: currentDragType, machineType: mtype,
            taskKind: taskKind, machineKind: mkind,
            typeMismatch: typeMismatch, kindMismatch: kindMismatch,
            machineName: machineName, mid: mid,
            callbacks: {
                force: function(){ doDrop(true); },
                'change-mtype': function(){ doChangeMachineType(function(){ doDrop(false); }); },
                'change-ttype': function(){ doChangeTaskType(function(){ doDrop(false); }); },
                'change-mkind': function(){ doChangeMachineKind(function(){ doDrop(false); }); },
                'change-tkind': function(){ doChangeTaskKind(function(){ doDrop(false); }); },
                'change-mboth': function(){
                    fetch('/update_machine_type', {
                        method:'POST', headers:{'Content-Type':'application/json'},
                        body:JSON.stringify({id: parseInt(mid), type: currentDragType})
                    }).then(function(r){ return r.json(); }).then(function(d1){
                        fetch('/update_machine_task_kind', {
                            method:'POST', headers:{'Content-Type':'application/json'},
                            body:JSON.stringify({id: parseInt(mid), task_kind: taskKind})
                        }).then(function(r){ return r.json(); }).then(function(d2){
                            // 两个请求都成功后才更新 DOM
                            targetTrack.dataset.mtype = currentDragType;
                            targetTrack.dataset.mkind = taskKind;
                            showToast(d1.msg + '；' + d2.msg);
                            doDrop(false);
                        });
                    });
                },
                'change-tboth': function(){
                    var taskId = getTaskId();
                    if(!taskId){ doDrop(false); return; }
                    fetch('/update_task',{
                        method:'POST', headers:{'Content-Type':'application/json'},
                        body:JSON.stringify({id: parseInt(taskId), type: mtype, task_kind: mkind, pri: '', diff: ''})
                    }).then(function(r){ return r.json(); }).then(function(d){
                        currentDragType = mtype;
                        currentDragKind = mkind;
                        showToast(d.msg);
                        doDrop(false);
                    });
                },
                cancel: function(){}
            }
        });
        return;
    }

    _performDrop(currentDragSid, currentDragTid, mid, targetDate, startMin, targetTrack, false);
}

function _performDrop(sid, tid, mid, targetDate, startMin, targetTrack, force){
    if(sid){
        let blk = document.querySelector('.task-block[data-sid="'+sid+'"]');
        let oldMid = blk ? blk.closest('.timeline-track').dataset.mid : null;
        fetch('/move_task',{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({date:targetDate,schedule_id:sid,new_machine_id:mid,new_start_min:startMin,force:force})
        }).then(r=>r.json()).then(d=>{
            if(d.msg==='ok'){
                _silentRefresh();
                showToast('移动成功');
            } else {
                showToast(d.msg);
            }
        });
        return;
    }
    if(tid){
        var doAssign = function(){
            let poolEl = document.querySelector('.task-draggable[data-tid="'+tid+'"]');
            var estSec = poolEl ? (parseInt(poolEl.dataset.sec,10) || 0) : 0;
            if (!estSec) {
                var t0 = typeof getTaskById === 'function' ? getTaskById(tid) : null;
                if (t0 && t0.est_seconds) estSec = t0.est_seconds;
            }
            var durMin = estSec > 0 ? Math.max(1, Math.round(estSec / 60)) : 0;
            var endMin = startMin + (durMin > 0 ? durMin : 120);
            // 休息段吸附
            var snappedStart = _applyBreakSnap(startMin, true);
            var snappedEnd = _applyBreakSnap(endMin, false);
            if(window._snapStartToBreak && window._snapEndToBreak && snappedEnd <= snappedStart){
                showToast('任务完全落在休息时段内，放置已取消');
                return;
            }
            startMin = snappedStart;
            endMin = snappedEnd;
            durMin = endMin - startMin;
            var endDate = targetDate;
            if (endMin >= MINS_PER_DAY) {
                var dayOver = Math.floor(endMin / MINS_PER_DAY);
                endMin = endMin % MINS_PER_DAY;
                endDate = _dateAddDays(targetDate, dayOver);
            }
            // 切割约束：结束时间不能晚于后段开始时间
            var _tc2 = getSplitConstraint(tid);
            if (_tc2 && _tc2.max_abs_end != null) {
                var maxAbs = _tc2.max_abs_end;
                var curAbsEnd = _dateMinToAbs(endDate, endMin);
                if (curAbsEnd > maxAbs) {
                    var _dmE = _absMinToDateMin(maxAbs);
                    endDate = _dmE.date;
                    endMin = _dmE.min;
                }
            }
            fetch('/assign_task',{method:'POST',headers:{'Content-Type':'application/json'},
                body:JSON.stringify({date:targetDate,end_date:endDate,task_id:tid,machine_id:mid,start_min:startMin,end_min:endMin,force:force})
            }).then(r=>r.json()).then(d=>{
                if(d.schedule_id){
                    _silentRefresh();
                    showToast(d.msg);
                } else {
                    showToast(d.msg);
                }
            });
        };

        // 非自定义视图下，检查是否会导致后续任务顺延出可见范围
        var viewModeEl = document.getElementById('view-mode');
        if(!viewModeEl){ doAssign(); return; }
        var viewMode = viewModeEl.value;
        if(viewMode !== 'custom'){
            var t1 = typeof getTaskById === 'function' ? getTaskById(tid) : null;
            var estSec = t1 ? (t1.est_seconds || 0) : 0;
            if(estSec > 0){
                var durMin = Math.max(1, Math.round(estSec / 60));
                var vr = getViewRange();
                var ve = vr[1];
                // 模拟同机器同日期的顺延
                var simTasks = [];
                for(var si=0; si<schedules.length; si++){
                    var s = schedules[si];
                    if(s.machine_id == mid && s.date == targetDate && s.status !== 'completed'){
                        simTasks.push({id:s.id, start:s.start_min, end:s.end_min, name:s.task_name, isNew:false});
                    }
                }
                simTasks.push({start:startMin, end:startMin+durMin, isNew:true});
                simTasks.sort(function(a,b){ return a.start - b.start; });
                var prevEnd = 0;
                var pushedOut = [];
                for(var si=0; si<simTasks.length; si++){
                    var st = simTasks[si];
                    var ns = st.start;
                    var nd = Math.max(1, st.end - st.start);
                    if(ns < prevEnd) ns = prevEnd;
                    var ne = Math.min(28*1440, ns+nd);
                    prevEnd = Math.max(prevEnd, ne);
                    if(!st.isNew && st.start !== ns){
                        var absNs = _dateMinToAbs(targetDate, ns);
                        if(absNs > ve){
                            pushedOut.push({name:st.name, time:_formatAbsMin(absNs)});
                        }
                    }
                }
                if(pushedOut.length > 0){
                    var confirmMsg = '<p>该操作将导致 <b>'+pushedOut.length+'</b> 个任务顺延至当前班次可见范围外：</p>';
                    confirmMsg += '<p style="font-size:13px;">';
                    for(var pi=0; pi<pushedOut.length; pi++){
                        confirmMsg += escHtml(pushedOut[pi].name) + ' → ' + pushedOut[pi].time;
                        if(pi < pushedOut.length-1) confirmMsg += '<br>';
                    }
                    confirmMsg += '</p><p>是否继续分配？</p>';
                    showConfirm('任务顺延提醒', confirmMsg).then(function(ok){
                        if(!ok) return;
                        doAssign();
                    });
                    return;
                }
            }
        }
        doAssign();
    }
}

// ========== 拖出回收 ==========
function dropToPool(e){e.preventDefault();e.stopPropagation();if(currentDragSid) recycleTasks({scheduleIds:[currentDragSid],skipConfirm:true});}

// ========== 任务移动 ==========
var _movePendingSid = null, _movePendingX = 0, _movePendingLeft = 0;
var _movePendingCleanup = null;
function startMove(e,sid){
    if(e.target.classList.contains('resize-left')||e.target.classList.contains('resize-right')||e.target.classList.contains('recall-btn')||e.target.classList.contains('complete-btn')) return;
    var block = document.querySelector('.task-block[data-sid="'+sid+'"]');
    if (!block) return;
    var startX = e.clientX;
    var startY = e.clientY;
    var startLeft = block.offsetLeft;
    var thresholdMet = false;
    function onMouseMove(ev){
        var dx = Math.abs(ev.clientX - startX);
        var dy = Math.abs(ev.clientY - startY);
        if(dy > 8 && dy > dx){
            document.removeEventListener('mousemove', onMouseMove, true);
            document.removeEventListener('mouseup', onMouseUp, true);
            if (_movePendingSid === sid){ _movePendingSid = null; _movePendingCleanup = null; }
            return;
        }
        if (!thresholdMet && dx < 5) return;
        if (!thresholdMet){
            thresholdMet = true;
            movingSid = sid; moveStartX = startX; moveStartLeft = startLeft;
        }
        handleMove(ev);
    }
    function onMouseUp(ev){
        document.removeEventListener('mousemove', onMouseMove, true);
        document.removeEventListener('mouseup', onMouseUp, true);
        if (_movePendingSid === sid){ _movePendingSid = null; _movePendingCleanup = null; }
        if (!thresholdMet){ movingSid = null; return; }
        stopMove();
    }
    if (_movePendingCleanup) _movePendingCleanup();
    _movePendingSid = sid; _movePendingX = startX; _movePendingLeft = startLeft;
    _movePendingCleanup = function(){
        document.removeEventListener('mousemove', onMouseMove, true);
        document.removeEventListener('mouseup', onMouseUp, true);
    };
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('mouseup', onMouseUp, true);
}
function handleMove(e){
    if(!movingSid) return;
    let block=document.querySelector(`.task-block[data-sid="${movingSid}"]`);
    let track=block.parentElement;
    let newLeft=Math.max(0,Math.min(moveStartLeft+e.clientX-moveStartX,track.offsetWidth-block.offsetWidth));
    block.style.left=newLeft+'px';
}
function stopMove(){
    if(!movingSid) return;
    let block=document.querySelector(`.task-block[data-sid="${movingSid}"]`);
    // 如果位置没有真正改变（只是点击/双击），跳过请求，避免不必要的页面刷新
    if(Math.abs(block.offsetLeft - moveStartLeft) < 3){
        document.removeEventListener('mousemove',handleMove,true);
        document.removeEventListener('mouseup',stopMove,true);
        movingSid=null;
        return;
    }
    var absStartMin = clampAbsMin(_pxToAbsMinForBlock(block, block.offsetLeft));
    var durMin = Math.max(1, pxToMin(block.offsetWidth));
    // 切割约束
    var _mvSch = schedules.find(function(item){ return item.id == movingSid; });
    if (_mvSch && _mvSch.task_id) {
        var _mvC = getSplitConstraint(_mvSch.task_id);
        if (_mvC) {
            if (_mvC.min_abs_start != null) absStartMin = Math.max(absStartMin, _mvC.min_abs_start);
            if (_mvC.max_abs_end != null) durMin = Math.max(1, Math.min(durMin, _mvC.max_abs_end - absStartMin));
        }
    }
    var absEndMin = clampAbsMin(absStartMin + durMin);

    // 分班模式：跨班任务整组联动（同一 task 的多条 schedule）
    var _mdm = '';
    try { _mdm = localStorage.getItem('displayMode') || 'continuous'; } catch(e) {}
    if (_mdm === 'split' && _mvSch && _mvSch.task_id) {
        var _mvTid = _mvSch.task_id;
        var _mvSchedules = schedules.filter(function(s){ return s.task_id == _mvTid; });
        if (_mvSchedules.length > 1) {
            var oldAbs = clampAbsMin(_pxToAbsMinForBlock(block, moveStartLeft));
            var deltaAbs = absStartMin - oldAbs;
            if (Math.abs(deltaAbs) > 0) {
                var _mvBase = document.getElementById('schedule-date').value;
                fetch('/move_split_group', {
                    method:'POST', headers:{'Content-Type':'application/json'},
                    body: JSON.stringify({
                        task_id: _mvTid,
                        delta_abs: deltaAbs,
                        base_date: _mvBase
                    })
                }).then(function(r){ return r.json(); }).then(function(d){
                    if (d.ok) {
                        _silentRefresh();
                        showToast('整组移动成功');
                    } else {
                        showToast(d.error || '移动失败');
                    }
                }).catch(function(){ showToast('移动请求失败'); });

                document.removeEventListener('mousemove',handleMove,true);
                document.removeEventListener('mouseup',stopMove,true);
                movingSid=null;
                return;
            }
        }
    }

    // 休息段吸附
    absStartMin = _applyBreakSnap(absStartMin, true);
    absEndMin = _applyBreakSnap(absEndMin, false);
    if(window._snapStartToBreak && window._snapEndToBreak && absEndMin <= absStartMin){
        document.removeEventListener('mousemove',handleMove,true);
        document.removeEventListener('mouseup',stopMove,true);
        movingSid=null;
        showToast('任务完全落在休息时段内，移动已取消');
        return;
    }
    updateBlockDisplay(block, absStartMin, absEndMin);
    syncTaskTableTime(block, absStartMin, absEndMin);
    const {date: targetDate, min: startMin} = _absMinToDateMin(absStartMin);
    const mid = block.closest('.timeline-track').dataset.mid;
    fetch('/update_task_pos',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({date:targetDate,schedule_id:movingSid,start_min:startMin})
    }).then(r=>r.json()).then(d=>{
        if(d.msg==='ok'){
            _silentRefresh();
            showToast('移动成功');
        }
        else showToast(d.msg);
    });
    document.removeEventListener('mousemove',handleMove,true);
    document.removeEventListener('mouseup',stopMove,true);
    movingSid=null;
}

// ========== 任务拉伸 ==========
function startResize(e,sid,dir){
    e.preventDefault();e.stopPropagation();
    resizingSid=sid;resizeDir=dir;resizeStartX=e.clientX;
    let block=document.querySelector(`.task-block[data-sid="${sid}"]`);
    resizeStartLeft=block.offsetLeft;resizeStartWidth=block.offsetWidth;
    document.addEventListener('mousemove',handleResize,{capture:true,passive:false});
    document.addEventListener('mouseup',stopResize,{capture:true});
}
function handleResize(e){
    e.preventDefault();if(!resizingSid) return;
    let block=document.querySelector(`.task-block[data-sid="${resizingSid}"]`);
    let track=block.parentElement;let deltaX=e.clientX-resizeStartX;
    if(resizeDir==='right'){
        block.style.width=Math.max(20,Math.min(resizeStartWidth+deltaX,track.offsetWidth-resizeStartLeft))+'px';
    }else{
        let newL=resizeStartLeft+deltaX,newW=resizeStartWidth-deltaX;
        if(newL>=0&&newW>=20&&(newL+newW)<=track.offsetWidth){block.style.left=newL+'px';block.style.width=newW+'px';}
    }
}
function stopResize(){
    if(!resizingSid) return;
    let block=document.querySelector(`.task-block[data-sid="${resizingSid}"]`);
    var absStartMin = clampAbsMin(_pxToAbsMinForBlock(block, block.offsetLeft));
    var durMin = Math.max(1, pxToMin(block.offsetWidth));
    // 切割约束：拉伸不能越过前段结束或后段开始
    var _rsSch = schedules.find(function(item){ return item.id == resizingSid; });
    if (_rsSch && _rsSch.task_id) {
        var _rsC = getSplitConstraint(_rsSch.task_id);
        if (_rsC) {
            if (_rsC.min_abs_start != null) absStartMin = Math.max(absStartMin, _rsC.min_abs_start);
            if (_rsC.max_abs_end != null) durMin = Math.max(1, Math.min(durMin, _rsC.max_abs_end - absStartMin));
        }
    }
    var absEndMin = clampAbsMin(absStartMin + durMin);
    // 休息段吸附
    absStartMin = _applyBreakSnap(absStartMin, true);
    absEndMin = _applyBreakSnap(absEndMin, false);
    if(window._snapStartToBreak && window._snapEndToBreak && absEndMin <= absStartMin){
        document.removeEventListener('mousemove',handleResize,{capture:true});
        document.removeEventListener('mouseup',stopResize,{capture:true});
        resizingSid=null;
        showToast('任务完全落在休息时段内，拉伸已取消');
        return;
    }

    // 分班模式：检测是否跨越了压缩轴窗口边界
    var _rdm = '';
    try { _rdm = localStorage.getItem('displayMode') || 'continuous'; } catch(e) {}
    if (_rdm === 'split') {
        var _rTrack = block.closest('.timeline-track');
        var _rTrackType = _rTrack ? (_rTrack.dataset.trackType || 'day') : 'day';
        var oldAbsStart = clampAbsMin(_pxToAbsMinForBlock(block, resizeStartLeft));
        var oldAbsEnd = clampAbsMin(oldAbsStart + pxToMin(resizeStartWidth));

        var startCrossed = getWindowsCrossed(oldAbsStart, absStartMin, _rTrackType);
        var endCrossed = getWindowsCrossed(oldAbsEnd, absEndMin, _rTrackType);

        if (startCrossed.length > 0 || endCrossed.length > 0) {
            // 跨窗口 → 自动切段
            var _rBase = document.getElementById('schedule-date').value;
            var _rCfg = typeof _getTrackConfig === 'function' ? _getTrackConfig(_rTrackType) : null;
            var _rDwEnd = _rCfg ? _rCfg.dwEnd : null;
            var _rBody = {
                schedule_id: resizingSid,
                new_abs_start: absStartMin,
                new_abs_end: absEndMin,
                base_date: _rBase,
                track_type: _rTrackType
            };
            if (_rDwEnd != null) {
                _rBody[_rTrackType === 'night' ? 'night_dw_end' : 'day_dw_end'] = _rDwEnd;
            }
            fetch('/stretch_across_windows', {
                method:'POST', headers:{'Content-Type':'application/json'},
                body: JSON.stringify(_rBody)
            }).then(function(r){ return r.json(); }).then(function(d){
                if (d.ok && !d.no_split) {
                    _silentRefresh();
                    showToast(d.total > 1 ? '已自动分段（'+d.total+'段）' : '拉伸成功');
                    document.removeEventListener('mousemove',handleResize,{capture:true});
                    document.removeEventListener('mouseup',stopResize,{capture:true});
                    resizingSid=null;
                } else if (d.no_split) {
                    // 切分后只剩单段，回退到常规拉伸
                    _doNormalResize(block, absStartMin, absEndMin);
                } else {
                    showToast(d.error || '拉伸失败');
                    document.removeEventListener('mousemove',handleResize,{capture:true});
                    document.removeEventListener('mouseup',stopResize,{capture:true});
                    resizingSid=null;
                }
            }).catch(function(){
                showToast('拉伸请求失败');
                document.removeEventListener('mousemove',handleResize,{capture:true});
                document.removeEventListener('mouseup',stopResize,{capture:true});
                resizingSid=null;
            });

            return;
        }
    }

    _doNormalResize(block, absStartMin, absEndMin);
}

function _doNormalResize(block, absStartMin, absEndMin) {
    updateBlockDisplay(block, absStartMin, absEndMin);
    syncTaskTableTime(block, absStartMin, absEndMin);
    const startObj = _absMinToDateMin(absStartMin);
    const endObj = _absMinToDateMin(absEndMin);
    const startMin = startObj.min;
    let endMin = endObj.min;
    if (endObj.date !== startObj.date) {
        const dayDiff = Math.round((new Date(endObj.date).getTime() - new Date(startObj.date).getTime()) / 86400000);
        endMin = endMin + dayDiff * MINS_PER_DAY;
    }
    endMin = Math.max(startMin + 1, Math.min(MAX_COORD, endMin));
    const mid = block.closest('.timeline-track').dataset.mid;
    fetch('/update_task_bounds',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({date:startObj.date,schedule_id:resizingSid,start_min:startMin,end_min:endMin})
    }).then(r=>r.json()).then(d=>{
        if(d.msg==='ok'){
            _silentRefresh();
            showToast('拉伸成功');
        }
        else showToast(d.msg);
    });
    document.removeEventListener('mousemove',handleResize,{capture:true});
    document.removeEventListener('mouseup',stopResize,{capture:true});
    resizingSid=null;
}
