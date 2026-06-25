// golden scheduling app — timeline settings, machine list, tab navigation

function setZoom(){
    const hw = parseInt(document.getElementById('zoom-hour').value, 10);
    const rh = parseInt(document.getElementById('zoom-row').value, 10);
    document.documentElement.style.setProperty('--hourWidth', hw+'px');
    document.documentElement.style.setProperty('--rowHeight', rh+'px');
    try{
        localStorage.setItem('zoomHour', String(hw));
        localStorage.setItem('zoomRow', String(rh));
    }catch(e){}
    renderCurrentTimeMarker();
    renderViewMask();
    rebuildTimelineGrid();
    requestAnimationFrame(function() {
        if (typeof _checkAllTaskBlocksStacked === 'function') _checkAllTaskBlocksStacked();
    });
}

function applyViewSettings(){
    const mode = document.getElementById('view-mode').value;
    const csd = document.getElementById('custom-start-date') ? document.getElementById('custom-start-date').value : '';
    const cst = document.getElementById('custom-start-time') ? document.getElementById('custom-start-time').value : '';
    const ced = document.getElementById('custom-end-date') ? document.getElementById('custom-end-date').value : '';
    const cet = document.getElementById('custom-end-time') ? document.getElementById('custom-end-time').value : '';
    try{
        localStorage.setItem('viewMode', mode);
        localStorage.setItem('customStartDate', csd);
        localStorage.setItem('customStartTime', cst);
        localStorage.setItem('customEndDate', ced);
        localStorage.setItem('customEndTime', cet);
    }catch(e){}
    var isCustomMode = mode === 'custom' || mode === 'custom-day' || mode === 'custom-night';
    const crc = document.getElementById('custom-range-controls');
    if(crc) crc.style.display = isCustomMode ? '' : 'none';
    renderViewMask(true);
    rebuildTimelineGrid(true);
    _renderAllTaskBlocks();
    renderShiftOverlaySegments();
    updateNightOffsetToggle();
    setTimeout(function(){
        silentRefreshSchedules();
        if (window.AA && AA._state.previewData) {
            setTimeout(function() {
                if (typeof window._renderPreviewCards === 'function') {
                    window._renderPreviewCards(AA._state.previewData.assigned || []);
                }
            }, 100);
        }
    }, 50);
    try{
        var curMode = document.getElementById('view-mode').value;
        var url = new URL(window.location.href);
        if(curMode === 'custom' || curMode === 'custom-day' || curMode === 'custom-night'){
            var sd = document.getElementById('custom-start-date') ? document.getElementById('custom-start-date').value : '';
            var ed = document.getElementById('custom-end-date') ? document.getElementById('custom-end-date').value : '';
            if(sd && ed){
                var base = document.getElementById('schedule-date').value;
                var days = Math.max(1, Math.min(14, Math.ceil((new Date(ed).getTime() - new Date(sd).getTime()) / (24*60*60*1000)) + 2));
                url.searchParams.set('span_days', String(days));
            }else{
                url.searchParams.set('span_days', '3');
            }
        }else{
            url.searchParams.delete('span_days');
        }
        if(url.toString() !== window.location.href){
            history.replaceState(null, '', url.toString());
        }
    }catch(e){}
}

function setNightOffset(offset){
    _setLS('nightOffset', String(offset));
    updateNightOffsetToggle();
    renderViewMask(true);
    rebuildTimelineGrid(true);
    renderShiftOverlaySegments();
    // 夜班偏移切换后重绘预览卡片
    if (window.AA && AA._state.previewData) {
        setTimeout(function() {
            if (typeof window._renderPreviewCards === 'function') {
                window._renderPreviewCards(AA._state.previewData.assigned || []);
            }
        }, 100);
    }
}

function updateNightOffsetToggle(){
    const toggle = document.getElementById('night-offset-toggle');
    if(!toggle) return;
    const mode = document.getElementById('view-mode').value;
    const style = localStorage.getItem('nightViewStyle') || 'simple';
    if(mode === 'night' && style === 'simple'){
        toggle.style.display = '';
        const offset = parseInt(localStorage.getItem('nightOffset') || '0', 10);
        const track = toggle.querySelector('.night-offset-track');
        const labels = toggle.querySelectorAll('.night-offset-label');
        if(offset === -1){
            track.className = 'night-offset-track left';
            labels.forEach(function(l){ l.classList.toggle('active', l.dataset.offset === '-1'); });
        } else {
            track.className = 'night-offset-track right';
            labels.forEach(function(l){ l.classList.toggle('active', l.dataset.offset === '0'); });
        }
    } else {
        toggle.style.display = 'none';
    }
}

function toggleNightOffset(){
    const cur = parseInt(localStorage.getItem('nightOffset') || '0', 10);
    setNightOffset(cur === 0 ? -1 : 0);
}

function toggleStickyMachineCol(){
    const checked = document.getElementById('sticky-machine-col').checked;
    document.querySelectorAll('.machine-row .machine-name-col').forEach(function(el){
        el.classList.toggle('sticky-col', checked);
    });
    _setLS('stickyMachineCol', checked?'1':'0');
}

function _toggleCheckboxSetting(elementId, windowFlag, lsKey, serverKey) {
    var checked = document.getElementById(elementId).checked;
    window[windowFlag] = checked;
    _setLS(lsKey, checked ? '1' : '0');
    fetch('/save_schedule_setting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: serverKey, value: checked ? '1' : '0' })
    }).catch(function() {});
}
function toggleAutoCompactRecycle() { _toggleCheckboxSetting('auto-compact-recycle', '_autoCompactRecycle', 'autoCompactRecycle', 'auto_compact_recycle'); }
function toggleAutoExtendRepair()   { _toggleCheckboxSetting('auto-extend-repair',    '_autoExtendRepair',   'autoExtendRepair',   'auto_extend_after_repair'); }

function changeDate(){
    const v = document.getElementById('schedule-date').value;
    const url = new URL(window.location.href);
    url.searchParams.set('date', v);
    history.replaceState(null, '', url.toString());
    _silentRefresh();
}

function changeMachineFilter(){
    _applyFilterAndRefresh();
}
function _refreshMachineList(){
    fetch('/api/machines')
    .then(function(r){return r.json();})
    .then(function(d){
        var machines = d.machines;
        var filtered = _filterMachinesByUI(machines);
        var sorted = _sortMachinesByURL(filtered);

        if (_isFilterActive()) {
            var matchingSet = new Set();
            sorted.forEach(function(m) { matchingSet.add(m.id); });

            var allSorted = _sortMachinesByURL(machines);
            var visible = [];
            var hidden = [];
            allSorted.forEach(function(m) {
                var manualHidden = _hiddenMachineIds.has(m.id);
                var forceVisible = _filterForceVisibleIds.has(m.id);
                var matches = matchingSet.has(m.id);

                if (manualHidden) {
                    hidden.push(m);
                } else if (matches || forceVisible) {
                    visible.push(m);
                } else {
                    hidden.push(m);
                }
            });
            _renderMachineTable(visible);
            _renderHiddenMachineTable(hidden);
        } else {
            var visible = sorted.filter(function(m) { return !_hiddenMachineIds.has(m.id); });
            var hidden = sorted.filter(function(m) { return _hiddenMachineIds.has(m.id); });
            _renderMachineTable(visible);
            _renderHiddenMachineTable(hidden);
        }
    }).catch(function(){
        showToast('机器列表加载失败，请检查网络或刷新页面');
    });
}
function _renderMachineTable(machines){
    var table = document.getElementById('machine-list-table');
    if(!table) return;
    var html = '<tr><th>'+_sortLink('机型','type')+'</th><th>'+_sortLink('名称','name')+'</th><th>'+_sortLink('状态','status')+'</th><th>'+_sortLink('任务类型','task_kind')+'</th><th>分组</th><th style="text-align:center;width:40px">&#x1F441;</th><th>操作</th></tr>';
    for(var i=0; i<machines.length; i++){
        var m = machines[i];
        html += '<tr data-mid="'+m.id+'">'+
            '<td>'+escHtml(m.type)+'</td>'+
            '<td>'+
                '<input style="width:140px" value="'+escHtml(m.name)+'" id="mn_'+m.id+'" data-orig="'+escHtml(m.name)+'" oninput="toggleMachineRowSave('+m.id+')">'+
                '<button class="btn" id="ms_'+m.id+'" style="display:none;padding:4px 8px;" onclick="saveMachineName('+m.id+')">保存</button>'+
            '</td>'+
            '<td><span class="machine-status-text" data-mid="'+m.id+'">'+escHtml(m.status)+'</span></td>'+
            '<td>'+
                '<select id="mk_'+m.id+'" data-orig="'+escHtml(m.task_kind||'常规')+'" onchange="saveMachineName('+m.id+')">'+
                    _taskKindOptions(m.task_kind)+
                '</select>'+
            '</td>'+
            '<td>'+
                '<select id="mg_'+m.id+'" data-orig="'+escHtml(m.group_name||'')+'" onchange="saveMachineName('+m.id+')">'+
                    _groupOptions(m.group_name)+
                '</select>'+
            '</td>'+
            '<td style="text-align:center">' +
                '<span class="eye-toggle" data-mid="' + m.id + '" onclick="_toggleMachineVisibility(' + m.id + ')" title="在时间轴隐藏">&#x1F441;</span>' +
            '</td>'+
            '<td>'+
                (m.status === '维修停用'
                    ? '<button onclick="setMachineStatus('+m.id+',\'空闲\')">恢复运行</button>'
                    : '<button onclick="setMachineStatus('+m.id+',\'维修停用\')">标记维修</button>')+
                '<button class="btn-danger" onclick="recallMachineTasks('+m.id+')">回收该机任务</button>'+
                '<button class="btn-danger" onclick="delMachine('+m.id+')">删除</button>'+
            '</td>'+
        '</tr>';
    }
    table.innerHTML = html;
}

function _renderHiddenMachineTable(machines) {
    var container = document.getElementById('hidden-machines-module');
    if (!container) return;
    if (!machines || machines.length === 0) {
        container.style.display = 'none';
        return;
    }
    container.style.display = '';
    var tbody = document.getElementById('hidden-machines-tbody');
    if (!tbody) return;
    var html = '';
    for (var i = 0; i < machines.length; i++) {
        var m = machines[i];
        html += '<tr data-mid="' + m.id + '">' +
            '<td>' + escHtml(m.type) + '</td>' +
            '<td>' +
                '<input style="width:140px" value="' + escHtml(m.name) + '" id="mn_' + m.id + '" data-orig="' + escHtml(m.name) + '" oninput="toggleMachineRowSave(' + m.id + ')">' +
                '<button class="btn" id="ms_' + m.id + '" style="display:none;padding:4px 8px;" onclick="saveMachineName(' + m.id + ')">保存</button>' +
            '</td>' +
            '<td><span class="machine-status-text" data-mid="' + m.id + '">' + escHtml(m.status) + '</span></td>' +
            '<td>' +
                '<select id="mk_' + m.id + '" data-orig="' + escHtml(m.task_kind || '常规') + '" onchange="saveMachineName(' + m.id + ')">' +
                    _taskKindOptions(m.task_kind) +
                '</select>' +
            '</td>' +
            '<td>' +
                '<select id="mg_' + m.id + '" data-orig="' + escHtml(m.group_name || '') + '" onchange="saveMachineName(' + m.id + ')">' +
                    _groupOptions(m.group_name) +
                '</select>' +
            '</td>' +
            '<td style="text-align:center">' +
                '<span class="eye-toggle eye-hidden" data-mid="' + m.id + '" onclick="_restoreHiddenMachine(' + m.id + ')" title="恢复到时间轴">&#x1F441;&#x200D;&#x1F5E8;</span>' +
            '</td>' +
            '<td>' +
                (m.status === '维修停用'
                    ? '<button onclick="setMachineStatus(' + m.id + ',\'空闲\')">恢复运行</button>'
                    : '<button onclick="setMachineStatus(' + m.id + ',\'维修停用\')">标记维修</button>') +
                '<button class="btn-danger" onclick="recallMachineTasks(' + m.id + '">回收该机任务</button>' +
                '<button class="btn-danger" onclick="delMachine(' + m.id + ')">删除</button>' +
            '</td>' +
        '</tr>';
    }
    tbody.innerHTML = html;
    var countEl = document.getElementById('hidden-machines-count');
    if (countEl) countEl.textContent = machines.length;
    var restoreBtn = document.getElementById('hidden-restore-all-btn');
    if (restoreBtn) restoreBtn.style.display = machines.length > 0 ? '' : 'none';
}

function restoreAllHiddenMachines() {
    if (_hiddenMachineIds.size === 0 && _filterForceVisibleIds.size === 0) return;
    _hiddenMachineIds.clear();
    _filterForceVisibleIds.clear();
    _saveHiddenMachines();
    _refreshMachineList();
    _refreshTimelineFromServer();
}

function toggleHiddenMachinesSection() {
    var body = document.querySelector('#hidden-machines-module .table-module-body');
    var header = document.querySelector('#hidden-machines-module .table-module-header');
    if (!body || !header) return;
    var collapsed = body.style.display === 'none';
    body.style.display = collapsed ? '' : 'none';
    header.className = collapsed ? 'table-module-header' : 'table-module-header collapsed';
    var arrow = header.querySelector('.collapse-arrow');
    if (arrow) arrow.textContent = collapsed ? '▴' : '▾';
}

function toggleMachineRowSave(id){
    const inp = document.getElementById('mn_'+id);
    const btn = document.getElementById('ms_'+id);
    const kind = document.getElementById('mk_'+id);
    const group = document.getElementById('mg_'+id);
    if(!inp || !btn) return;
    const orig = inp.dataset.orig || '';
    const cur = inp.value || '';
    const kindOrig = kind ? (kind.dataset.orig||'') : '';
    const kindCur = kind ? (kind.value||'') : '';
    const groupOrig = group ? (group.dataset.orig||'') : '';
    const groupCur = group ? (group.value||'') : '';
    const changed = (cur.trim() && cur !== orig) || (kind && kindCur !== kindOrig) || (group && groupCur !== groupOrig);
    btn.style.display = changed ? 'inline-block' : 'none';
}

// ========== 切换标签 ==========
function switchTab(i){
    _setLS('activeTabIndex', String(i));
    if(i==4){ var hdf=document.getElementById('history-date-from'), hdt=document.getElementById('history-date-to'); _loadHistory(hdf?hdf.value:'', hdt?hdt.value:''); }
    document.querySelectorAll('.tab-btn, .nav-item').forEach(function(b){
        var match = b.getAttribute('onclick').match(/switchTab\((\d+)\)/);
        var tabIdx = match ? parseInt(match[1], 10) : -1;
        if (tabIdx === i) {
            b.classList.add('active');
        } else {
            b.classList.remove('active');
        }
    });
    document.querySelectorAll('.panel').forEach((p,k)=>p.className=k==i?'panel active':'panel');
    // 分班面板：已禁用，始终隐藏
    var splitPanel = document.getElementById('panel-split-schedule');
    if (splitPanel) { splitPanel.style.display = 'none'; }
    if(i==1){ if(typeof initFilterStateFromURL==='function') initFilterStateFromURL(); _refreshMachineList(); }
    if(i==2) _refreshTaskList();
    if(i==3){
        renderCurrentTimeMarker(); _refreshTimelineFromServer(); _refreshTaskList();
    }
    if(i==1) refreshLiveStatus();
    if(i==6){ loadSettings(); }
    if(i==5 && typeof summaryOnActivate==='function'){ setTimeout(function(){ summaryOnActivate(); }, 100); }
    // 侧边栏模式下：切换到设置时展开子导航，离开设置时收起
    if (document.body.classList.contains('sidebar-mode')) {
        if (i === 6) {
            if (typeof renderSettingsSubNav === 'function') renderSettingsSubNav();
        } else {
            var subnav = document.querySelector('.sidebar-settings-subnav');
            if (subnav) { subnav.classList.remove('expanded'); }
        }
    }
    // 离开排班面板时清空撤回/重做栈并退出预览
    if(i !== 3){
        undoStack = [];
        redoStack = [];
        updateUndoRedoUI();
        if (window.AA && typeof AA.cancelPreview === 'function') {
            AA.cancelPreview();
        }
    }
}

// ========== 自动分配预览事件监听 ==========

document.addEventListener('aa-preview', function(e) {
    if (typeof _renderPreviewCards === 'function') {
        _renderPreviewCards(e.detail.assigned || []);
    }
});
document.addEventListener('aa-preview-clear', function() {
    if (typeof _clearPreviewCards === 'function') {
        _clearPreviewCards();
    }
});
