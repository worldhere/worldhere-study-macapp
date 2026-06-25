function addMachine(){
    const nameEl = document.getElementById('m_name');
    const typeEl = document.getElementById('m_type');
    const kindEl = document.getElementById('m_kind');
    const groupEl = document.getElementById('m_group');
    const name = (nameEl.value || '').trim();
    const mtype = typeEl.value;
    const mkind = kindEl.value;
    const mgroup = groupEl ? groupEl.value : '';

    function doAdd(){
        fetch('/add_machine',{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({name: name, type: mtype, task_kind: mkind, group_name: mgroup})
        }).then(r=>r.json()).then(d=>{
            if(d.machine){
                _appendMachineRow(d.machine);
                nameEl.value = mtype + '-';
                nameEl.focus();
                showToast(d.msg);
            } else {
                showToast(d.msg);
            }
        });
    }

    if(!name){
        showConfirm('新增机器', '<p>机器名为空，将自动生成 \"'+mtype+'-未命名\"，确认添加？</p>').then(ok=>{ if(ok) doAdd(); });
        return;
    }
    doAdd();
}

function _appendMachineRow(m){
    const table = document.getElementById('machine-list-table');
    if(!table) return;
    const tr = document.createElement('tr');
    tr.setAttribute('data-mid', String(m.id));
    tr.innerHTML =
        '<td>'+escHtml(m.type)+'</td>'+
        '<td>'+
            '<input style=\"width:140px\" value=\"'+escHtml(m.name)+'\" id=\"mn_'+m.id+'\" data-orig=\"'+escHtml(m.name)+'\" oninput=\"toggleMachineRowSave('+m.id+')\" onkeydown=\"if(event.key==\'Enter\')saveMachineName('+m.id+')\">'+
            '<button class=\"btn\" id=\"ms_'+m.id+'\" style=\"display:none;padding:4px 8px;\" onclick=\"saveMachineName('+m.id+')\">保存</button>'+
        '</td>'+
        '<td><span class=\"machine-status-text\" data-mid=\"'+m.id+'\">'+escHtml(m.status)+'</span></td>'+
        '<td>'+
            '<select id=\"mk_'+m.id+'\" data-orig=\"'+escHtml(m.task_kind||'常规')+'\" onchange=\"saveMachineName('+m.id+')\">'+
                _taskKindOptions(m.task_kind)+
            '</select>'+
        '</td>'+
        '<td>'+
            '<select id=\"mg_'+m.id+'\" data-orig=\"'+escHtml(m.group_name||'')+'\" onchange=\"saveMachineName('+m.id+')\">'+
                _groupOptions(m.group_name)+
            '</select>'+
        '</td>'+
        '<td style=\"text-align:center\">' +
            '<span class=\"eye-toggle\" data-mid=\"' + m.id + '\" onclick=\"_toggleMachineVisibility(' + m.id + ')\" title=\"在时间轴隐藏\">&#x1F441;</span>' +
        '</td>'+
        '<td>'+
            (m.status === '维修停用'
                ? '<button onclick=\"setMachineStatus('+m.id+',\'空闲\')\">恢复运行</button>'
                : '<button onclick=\"setMachineStatus('+m.id+',\'维修停用\')\">标记维修</button>')+
            '<button class=\"btn-danger\" onclick=\"recallMachineTasks('+m.id+')\">回收该机任务</button>'+
            '<button class=\"btn-danger\" onclick=\"delMachine('+m.id+')\">删除</button>'+
        '</td>';
    table.appendChild(tr);
    _refreshTimelineFromServer();
    try{
        localStorage.setItem('lastMType', m.type);
        localStorage.setItem('lastMKind', m.task_kind);
    }catch(e){}
}

function _syncTimelineMachineRow(m) {
    var container = document.querySelector('.timeline-container');
    if (!container) return;
    var row = document.createElement('div');
    row.className = 'timeline-grid machine-row';
    row.innerHTML =
        '<div class="machine-name-col" title="' + escHtml(m.name) + '(' + escHtml(m.type) + '/' + escHtml(m.task_kind) + ')">' + escHtml(m.name) + '(' + escHtml(m.type) + '/' + escHtml(m.task_kind) + ')</div>' +
        '<div class="timeline-track ' + (m.status === '维修停用' ? 'repair-track' : '') + '"' +
        ' data-mid="' + m.id + '" data-mtype="' + escHtml(m.type) + '" data-mkind="' + escHtml(m.task_kind || '') + '" data-mstatus="' + escHtml(m.status) + '"' +
        ' ondrop="dropTask(event)" ondragover="allowDrop(event)">' +
        '<div class="shift-overlay"></div>' +
        '</div>';
    var showOverlay = (localStorage.getItem('ui_show_shift_overlay') || '1') !== '0';
    row.querySelector('.shift-overlay').style.display = showOverlay ? '' : 'none';
    var taskPool = container.querySelector('.task-pool');
    if (taskPool) {
        container.insertBefore(row, taskPool);
    } else {
        container.appendChild(row);
    }
}

function onMachineTypeChange(){
    const type = document.getElementById('m_type').value;
    document.getElementById('m_name').value = type + '-';
    document.getElementById('m_name').focus();
}

// ========== 合并批量添加弹窗 ==========

var _batchMachineRows = [];  // {name, type, task_kind, group_name}

function _parseMachineRange(type, raw){
    const names = [];
    const parts = raw.split(/[,，]+/);
    parts.forEach(function(part){
        part = part.trim();
        if(!part) return;
        const rangeMatch = part.match(/^(\d+)\s*-\s*(\d+)$/);
        if(rangeMatch){
            let start = parseInt(rangeMatch[1], 10);
            let end = parseInt(rangeMatch[2], 10);
            if(start > end){ var tmp = start; start = end; end = tmp; }
            const w = rangeMatch[1].length;
            for(let i = start; i <= end; i++){
                names.push(type + '-' + String(i).padStart(w, '0'));
            }
        } else if(part.match(/^\d+$/)){
            names.push(type + '-' + part);
        }
    });
    return names;
}

function openBatchMachineDialog(){
    var dlg = document.getElementById('batch-machine-dialog');
    if (!dlg) return;
    var typeEl = document.getElementById('m_type');
    var kindEl = document.getElementById('m_kind');
    var groupEl = document.getElementById('m_group');
    if (typeEl) document.getElementById('bm_type').value = typeEl.value;
    if (kindEl) document.getElementById('bm_kind').value = kindEl.value;
    if (groupEl) document.getElementById('bm_group').value = groupEl.value;
    document.getElementById('bm_range').value = '';
    document.getElementById('bp_textarea').value = '';
    _batchMachineRows = [];
    _renderBatchTable();
    switchBatchTab('range');
    dlg.style.display = 'block';
}

function closeBatchMachineDialog(){
    document.getElementById('batch-machine-dialog').style.display = 'none';
}

function switchBatchTab(tab) {
    var rangeTab = document.getElementById('batch-tab-range');
    var pasteTab = document.getElementById('batch-tab-paste');
    var rangeMethod = document.getElementById('batch-method-range');
    var pasteMethod = document.getElementById('batch-method-paste');
    if (tab === 'range') {
        rangeTab.className = 'batch-tab active';
        pasteTab.className = 'batch-tab';
        rangeTab.style.cssText = 'padding:8px 18px;font-size:12px;font-weight:600;cursor:pointer;background:var(--bg-card);color:var(--primary);border:2px solid var(--border);border-bottom:2px solid var(--bg-card);border-radius:var(--radius-xs) var(--radius-xs) 0 0;margin-bottom:-2px;margin-right:2px;';
        pasteTab.style.cssText = 'padding:8px 18px;font-size:12px;font-weight:600;cursor:pointer;background:var(--bg-body);color:var(--text-muted);border:none;border-radius:var(--radius-xs) var(--radius-xs) 0 0;margin-right:2px;';
        rangeMethod.style.display = 'block';
        pasteMethod.style.display = 'none';
    } else {
        pasteTab.className = 'batch-tab active';
        rangeTab.className = 'batch-tab';
        pasteTab.style.cssText = 'padding:8px 18px;font-size:12px;font-weight:600;cursor:pointer;background:var(--bg-card);color:var(--primary);border:2px solid var(--border);border-bottom:2px solid var(--bg-card);border-radius:var(--radius-xs) var(--radius-xs) 0 0;margin-bottom:-2px;margin-right:2px;';
        rangeTab.style.cssText = 'padding:8px 18px;font-size:12px;font-weight:600;cursor:pointer;background:var(--bg-body);color:var(--text-muted);border:none;border-radius:var(--radius-xs) var(--radius-xs) 0 0;margin-right:2px;';
        pasteMethod.style.display = 'block';
        rangeMethod.style.display = 'none';
    }
}

function generateBatchFromRange() {
    var type = document.getElementById('bm_type').value;
    var kind = document.getElementById('bm_kind').value;
    var group = document.getElementById('bm_group').value;
    var raw = document.getElementById('bm_range').value.trim();
    var names = _parseMachineRange(type, raw);
    if (names.length === 0) {
        showToast('请输入有效的名称范围');
        return;
    }
    for (var i = 0; i < names.length; i++) {
        _batchMachineRows.push({name: names[i], type: type, task_kind: kind, group_name: group});
    }
    _renderBatchTable();
    document.getElementById('bm_range').value = '';
}

function generateBatchFromPaste() {
    var type = document.getElementById('bp_type').value;
    var kind = document.getElementById('bp_kind').value;
    var group = document.getElementById('bp_group').value;
    var raw = document.getElementById('bp_textarea').value;
    var lines = raw.split(/[\r\n]+/);

    var groupNames = [];
    var groupSelect = document.getElementById('bp_group');
    if (groupSelect) {
        for (var i = 0; i < groupSelect.options.length; i++) {
            if (groupSelect.options[i].value) groupNames.push(groupSelect.options[i].value);
        }
    }
    var kindNames = [];
    var kindSelect = document.getElementById('bp_kind');
    if (kindSelect) {
        for (var i = 0; i < kindSelect.options.length; i++) {
            kindNames.push(kindSelect.options[i].value);
        }
    }
    var machineTypes = [];
    var typeSelect = document.getElementById('bp_type');
    if (typeSelect) {
        for (var i = 0; i < typeSelect.options.length; i++) {
            machineTypes.push(typeSelect.options[i].value);
        }
    }
    machineTypes.sort(function(a,b){ return b.length - a.length; });

    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line) continue;

        var detectedType = null;
        for (var t = 0; t < machineTypes.length; t++) {
            if (line.indexOf(machineTypes[t]) === 0) {
                detectedType = machineTypes[t];
                break;
            }
        }
        if (!detectedType) continue;

        var machineName = line;
        var taskKind = kind;
        var groupName = group;

        var parenMatch = line.match(/[\(（]([^\)）]+)[\)）]$/);
        if (parenMatch) {
            machineName = line.substring(0, parenMatch.index).trim();
            var parts = parenMatch[1].split(/[,，]/);
            var first = (parts[0] || '').trim();
            var second = (parts[1] || '').trim();

            if (first) {
                if (kindNames.indexOf(first) >= 0) {
                    taskKind = first;
                } else if (groupNames.indexOf(first) >= 0) {
                    groupName = first;
                } else {
                    taskKind = first;
                }
            }
            if (second) {
                if (groupNames.indexOf(second) >= 0) {
                    groupName = second;
                } else if (kindNames.indexOf(second) >= 0 && taskKind === kind) {
                    taskKind = second;
                }
            }
        }

        _batchMachineRows.push({name: machineName, type: detectedType, task_kind: taskKind, group_name: groupName});
    }
    _renderBatchTable();
    document.getElementById('bp_textarea').value = '';
}

function addBatchManualRow() {
    var type = document.getElementById('bm_type').value;
    var kind = document.getElementById('bm_kind').value;
    _batchMachineRows.push({name: '', type: type, task_kind: kind, group_name: ''});
    _renderBatchTable();
}

function _removeBatchRow(index) {
    _batchMachineRows.splice(index, 1);
    _renderBatchTable();
}

function _renderBatchTable() {
    var tbody = document.getElementById('batch-machines-tbody');
    var totalCount = document.getElementById('batch-row-count');
    var confirmCount = document.getElementById('batch-confirm-count');
    if (!tbody) return;

    var defaultType = document.getElementById('bm_type') ? document.getElementById('bm_type').value : '';
    var defaultKind = document.getElementById('bm_kind') ? document.getElementById('bm_kind').value : '';
    var defaultGroup = (document.getElementById('bm_group') || document.getElementById('bp_group') || {}).value || '';

    var machineTypes = [];
    var typeSelect = document.getElementById('bm_type') || document.getElementById('bp_type');
    if (typeSelect) { for (var i=0; i<typeSelect.options.length; i++) machineTypes.push(typeSelect.options[i].value); }

    var taskKinds = [];
    var kindSelect = document.getElementById('bm_kind') || document.getElementById('bp_kind');
    if (kindSelect) { for (var i=0; i<kindSelect.options.length; i++) taskKinds.push(kindSelect.options[i].value); }

    var groupNames = [];
    var groupSelect = document.getElementById('bm_group') || document.getElementById('bp_group');
    if (groupSelect) { for (var i=0; i<groupSelect.options.length; i++) { if (groupSelect.options[i].value) groupNames.push(groupSelect.options[i].value); } }

    var html = '';
    for (var i = 0; i < _batchMachineRows.length; i++) {
        var row = _batchMachineRows[i];
        var typeChanged = row.type !== defaultType;
        var kindChanged = row.task_kind !== defaultKind;
        var groupChanged = row.group_name !== defaultGroup;
        var rowModified = typeChanged || kindChanged || groupChanged;

        html += '<tr' + (rowModified ? ' style="background:var(--warning-light);"' : '') + '>';
        html += '<td style="padding:7px 10px;font-size:11px;color:var(--text-muted);width:30px;text-align:center;">' + (i+1) + (rowModified ? '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--warning);margin-left:4px;"></span>' : '') + '</td>';
        html += '<td style="padding:7px 10px;"><input value="' + escHtml(row.name) + '" onchange="_updateBatchRow(' + i + ', \'name\', this.value)" style="width:120px;font-size:12px;padding:5px 8px;border:1px solid var(--border);border-radius:var(--radius-xs);"></td>';
        html += '<td style="padding:7px 10px;"><select onchange="_updateBatchRow(' + i + ', \'type\', this.value)" style="font-size:12px;padding:5px 8px;border:1px solid ' + (typeChanged ? 'var(--warning)' : 'transparent') + ';border-radius:var(--radius-xs);background:' + (typeChanged ? 'var(--warning-light)' : 'transparent') + ';">' + _optionsHtml(machineTypes, row.type) + '</select></td>';
        html += '<td style="padding:7px 10px;"><select onchange="_updateBatchRow(' + i + ', \'task_kind\', this.value)" style="font-size:12px;padding:5px 8px;border:1px solid ' + (kindChanged ? 'var(--warning)' : 'transparent') + ';border-radius:var(--radius-xs);background:' + (kindChanged ? 'var(--warning-light)' : 'transparent') + ';">' + _optionsHtml(taskKinds, row.task_kind) + '</select></td>';
        html += '<td style="padding:7px 10px;"><select onchange="_updateBatchRow(' + i + ', \'group_name\', this.value)" style="font-size:12px;padding:5px 8px;border:1px solid ' + (groupChanged ? 'var(--warning)' : 'transparent') + ';border-radius:var(--radius-xs);background:' + (groupChanged ? 'var(--warning-light)' : 'transparent') + ';"><option value="">未分组</option>' + _optionsHtml(groupNames, row.group_name) + '</select></td>';
        html += '<td style="padding:7px 10px;"><button onclick="_removeBatchRow(' + i + ')" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:16px;" title="移除">&times;</button></td>';
        html += '</tr>';
    }

    tbody.innerHTML = html;
    if (totalCount) totalCount.textContent = _batchMachineRows.length;
    if (confirmCount) confirmCount.textContent = _batchMachineRows.length;
}

function _optionsHtml(options, selected) {
    var html = '';
    for (var i = 0; i < options.length; i++) {
        html += '<option' + (options[i] === selected ? ' selected' : '') + '>' + escHtml(options[i]) + '</option>';
    }
    return html;
}

function _updateBatchRow(index, field, value) {
    _batchMachineRows[index][field] = value;
    _renderBatchTable();
}

function executeBatchAdd() {
    if (_batchMachineRows.length === 0) {
        showToast('没有要添加的机器');
        return;
    }
    var valid = _batchMachineRows.filter(function(r) { return (r.name || '').trim(); });
    if (valid.length === 0) {
        showToast('请填写机器名称');
        return;
    }
    var machines = valid.map(function(r) {
        return {name: r.name.trim(), type: r.type, task_kind: r.task_kind, group_name: r.group_name || ''};
    });
    showConfirm('批量添加', '<p>确认添加 <b>' + machines.length + '</b> 台机器？</p>').then(function(ok) {
        if (!ok) return;
        fetch('/add_machines_batch', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({machines: machines})
        }).then(function(r) { return r.json(); }).then(function(d) {
            showToast(d.msg);
            closeBatchMachineDialog();
            _silentRefresh({machines: true});
        });
    });
}
function saveMachineName(id){
    var name = document.getElementById('mn_'+id).value;
    var task_kind = document.getElementById('mk_'+id).value;
    var group_name = document.getElementById('mg_'+id) ? document.getElementById('mg_'+id).value : '';

    if (group_name === '__new_group__') {
        showPrompt('新建分组', '输入新分组名称：', '例如：渲染组').then(function(newName) {
            if (!newName || !(newName = newName.trim())) {
                var gsel = document.getElementById('mg_'+id);
                if (gsel) gsel.value = gsel.dataset.orig;
                return;
            }
            fetch('/add_machine_group', {
                method: 'POST', headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({name: newName})
            }).then(function(r) { return r.json(); }).then(function(d) {
                if (d.group) {
                    group_name = newName;
                    _appendGroupTag(newName);
                    _refreshGroupSelects();
                    _updateGroupCount();
                    _updateGroupEmptyHint();
                    _continueSaveMachine(id, name, task_kind, group_name);
                } else {
                    showToast(d.msg);
                }
            });
        });
        return;
    }
    _continueSaveMachine(id, name, task_kind, group_name);
}

function _continueSaveMachine(id, name, task_kind, group_name) {
    fetch('/update_machine',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({id:id,name:name,task_kind:task_kind,group_name:group_name})
    }).then(function(r){return r.json();}).then(function(d){
        showToast(d.msg);
        var inp = document.getElementById('mn_'+id);
        var btn = document.getElementById('ms_'+id);
        var kindSel = document.getElementById('mk_'+id);
        var groupSel = document.getElementById('mg_'+id);
        if(inp) inp.dataset.orig = inp.value;
        if(kindSel) kindSel.dataset.orig = kindSel.value;
        if(groupSel) groupSel.dataset.orig = groupSel.value;
        if(btn) btn.style.display = 'none';
        _refreshTimelineFromServer();
    });
}
function saveAllMachines(){
    var rows = Array.from(document.querySelectorAll('tr[data-mid]'));
    var items = rows.map(function(r){
        var id = parseInt(r.dataset.mid, 10);
        return {
            id: id,
            name: document.getElementById('mn_'+id).value,
            task_kind: document.getElementById('mk_'+id).value,
            group_name: document.getElementById('mg_'+id) ? document.getElementById('mg_'+id).value : ''
        };
    });
    fetch('/update_machines_bulk',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({items:items})
    }).then(function(r){return r.json();}).then(function(d){
        showToast(d.msg);
        rows.forEach(function(r){
            var id = parseInt(r.dataset.mid, 10);
            var inp = document.getElementById('mn_'+id);
            var btn = document.getElementById('ms_'+id);
            var kindSel = document.getElementById('mk_'+id);
            var groupSel = document.getElementById('mg_'+id);
            if(inp) inp.dataset.orig = inp.value;
            if(kindSel) kindSel.dataset.orig = kindSel.value;
            if(groupSel) groupSel.dataset.orig = groupSel.value;
            if(btn) btn.style.display = 'none';
        });
        _refreshTimelineFromServer();
    });
}
function setMachineStatus(id,s){
    fetch('/set_machine_status',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({id:id, status:s})
    }).then(function(r){ return r.json(); }).then(function(d){
        showToast(d.msg);
        var el = document.querySelector('.machine-status-text[data-mid="'+id+'"]');
        if(el) el.textContent = s;
        // 同步更新操作按钮（标记维修 ↔ 恢复运行）
        var row = document.querySelector('tr[data-mid="'+id+'"]');
        if(row){
            var btns = row.querySelectorAll('button');
            for(var i = 0; i < btns.length; i++){
                if(btns[i].getAttribute('onclick') && btns[i].getAttribute('onclick').indexOf('setMachineStatus') >= 0){
                    if(s === '维修停用'){
                        btns[i].textContent = '恢复运行';
                        btns[i].setAttribute('onclick', 'setMachineStatus('+id+",'空闲')");
                    } else {
                        btns[i].textContent = '标记维修';
                        btns[i].setAttribute('onclick', 'setMachineStatus('+id+",'维修停用')");
                    }
                    break;
                }
            }
        }
        if(d.repair){
            if(d.repair.action === 'repair_end'){
                showToast('维修结束，持续 '+d.repair.duration, 5000);
            } else if(d.repair.action === 'repair_start'){
                showToast('维修已开始，已记录', 3000);
            } else if(d.repair.action === 'repair_end_no_start'){
                showToast(d.repair.msg, 4000);
            }
        }
        _refreshTimelineFromServer();
    });
}
function delMachine(id){showConfirm('删除机器','<p>确定删除这台机器？未完成的任务将被回收。</p>').then(function(ok){if(!ok)return;var date=document.getElementById('schedule-date').value;recycleTasks({machineId:id, date:date, skipConfirm:true, onSuccess:function(){fetch('/del_machine/'+id).then(function(r){return r.json();}).then(function(d){showToast(d.msg);_silentRefresh({machines:true});});}});});}
function recallMachineTasks(mid){
    var date = document.getElementById('schedule-date').value;
    recycleTasks({
        machineId: mid,
        date: date,
        confirmMsg: '<p>确定回收该机器当日所有未完成任务？</p>'
    });
}

// ========== 分组管理 ==========

function toggleCollapsible(boxId) {
    var box = document.getElementById(boxId);
    if (!box) return;
    box.classList.toggle('collapsed');
    _setLS('ui_collapse_' + boxId, box.classList.contains('collapsed') ? '1' : '0');
}

function initCollapsibleState() {
    ['add-machine-box', 'group-manage-box'].forEach(function(id) {
        var box = document.getElementById(id);
        if (!box) return;
        try { if (localStorage.getItem('ui_collapse_' + id) === '1') box.classList.add('collapsed'); } catch(e) {}
    });
}

function addMachineGroup() {
    var input = document.getElementById('new-group-name');
    var name = (input.value || '').trim();
    if (!name) { showToast('分组名不能为空'); return; }
    fetch('/add_machine_group', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({name: name})
    }).then(function(r) { return r.json(); }).then(function(d) {
        showToast(d.msg);
        if (d.group) {
            _appendGroupTag(d.group.key);
            _refreshGroupSelects();
            input.value = '';
            _updateGroupCount();
            _updateGroupEmptyHint();
        }
    });
}

function _appendGroupTag(name) {
    var container = document.getElementById('group-tags-container');
    var span = document.createElement('span');
    span.className = 'group-tag';
    span.setAttribute('draggable', 'true');
    span.dataset.groupName = name;
    span.ondragstart = handleGroupDragStart;
    span.ondragover = handleGroupDragOver;
    span.ondragend = handleGroupDragEnd;
    span.ondblclick = function() { editGroupName(this); };
    span.style.cssText = 'display:inline-flex;align-items:center;gap:4px;background:var(--primary-light);color:var(--primary);padding:4px 12px;border-radius:4px;font-size:12px;cursor:grab;user-select:none;';
    span.innerHTML = '⋮⋮ ' + escHtml(name) + ' <span style="cursor:pointer;margin-left:2px;">✕</span>';
    span.querySelector('span').onclick = function(e) { e.stopPropagation(); deleteMachineGroup(span.querySelector('span')); };
    container.appendChild(span);
}

function editGroupName(tagEl) {
    if (tagEl.querySelector('input')) return;
    var oldName = tagEl.dataset.groupName;
    var originalHTML = tagEl.innerHTML;

    var input = document.createElement('input');
    input.type = 'text';
    input.value = oldName;
    input.className = 'group-tag-edit-input';
    input.style.cssText = 'width:80px;padding:2px 6px;font-size:12px;border:1px solid var(--primary);border-radius:3px;outline:none;background:var(--bg-card);color:var(--text-primary);';
    tagEl.innerHTML = '';
    tagEl.appendChild(input);
    tagEl.style.cursor = 'text';
    input.focus();
    input.select();

    function finishEdit(save) {
        var newName = input.value.trim();
        if (!save || !newName || newName === oldName) {
            tagEl.innerHTML = originalHTML;
            tagEl.style.cursor = 'grab';
            var xSpan = tagEl.querySelector('span');
            if (xSpan) xSpan.onclick = function(e) { e.stopPropagation(); deleteMachineGroup(xSpan); };
            return;
        }
        fetch('/update_machine_group', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({old_name: oldName, new_name: newName})
        }).then(function(r) { return r.json(); }).then(function(d) {
            showToast(d.msg);
            if (d.msg.indexOf('成功') >= 0 || d.msg.indexOf('已更新') >= 0) {
                tagEl.dataset.groupName = newName;
                tagEl.innerHTML = '⋮⋮ ' + escHtml(newName) + ' <span style="cursor:pointer;margin-left:2px;">✕</span>';
                tagEl.style.cursor = 'grab';
                var xSpan = tagEl.querySelector('span');
                if (xSpan) xSpan.onclick = function(e) { e.stopPropagation(); deleteMachineGroup(xSpan); };
                _refreshGroupSelects();
            } else {
                tagEl.innerHTML = originalHTML;
                tagEl.style.cursor = 'grab';
                var xSpan = tagEl.querySelector('span');
                if (xSpan) xSpan.onclick = function(e) { e.stopPropagation(); deleteMachineGroup(xSpan); };
            }
        });
    }

    input.addEventListener('blur', function() { finishEdit(true); });
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { e.preventDefault(); finishEdit(false); }
    });
}

function deleteMachineGroup(xEl) {
    var tag = xEl.parentElement;
    var name = tag.dataset.groupName;
    showConfirm('删除分组', '<p>确定删除分组 "<b>' + escHtml(name) + '</b>"？</p><p style="font-size:12px;color:var(--text-muted);">该分组下的机器将变为"未分组"</p>').then(function(ok) {
        if (!ok) return;
        fetch('/delete_machine_group', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({name: name})
        }).then(function(r) { return r.json(); }).then(function(d) {
            showToast(d.msg);
            tag.remove();
            _refreshGroupSelects();
            _updateGroupCount();
            _updateGroupEmptyHint();
            _refreshMachineList();
        });
    });
}

var _groupDragSrc = null;

function handleGroupDragStart(e) {
    _groupDragSrc = this;
    this.style.opacity = '0.5';
    e.dataTransfer.effectAllowed = 'move';
}

function handleGroupDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    this.classList.add('drag-over');
}

function handleGroupDragEnd(e) {
    this.style.opacity = '1';
    this.classList.remove('drag-over');
    if (!_groupDragSrc || _groupDragSrc === this) return;
    var container = document.getElementById('group-tags-container');
    var tags = Array.from(container.querySelectorAll('.group-tag'));
    tags.forEach(function(t) { t.classList.remove('drag-over'); });
    var srcIdx = tags.indexOf(_groupDragSrc);
    var destIdx = tags.indexOf(this);
    if (srcIdx < 0 || destIdx < 0) return;
    if (srcIdx < destIdx) {
        container.insertBefore(_groupDragSrc, this.nextSibling);
    } else {
        container.insertBefore(_groupDragSrc, this);
    }
    _groupDragSrc = null;
    _saveGroupOrder();
}

function _saveGroupOrder() {
    var container = document.getElementById('group-tags-container');
    var tags = container.querySelectorAll('.group-tag');
    var keys = Array.from(tags).map(function(t) { return t.dataset.groupName; });
    fetch('/update_machine_groups_order', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({keys: keys})
    });
}

function _refreshGroupSelects() {
    fetch('/api/machine_groups').then(function(r) { return r.json(); }).then(function(d) {
        if (typeof APP_CONFIG !== 'undefined') APP_CONFIG.machine_groups = d.groups;

        var groups = d.groups;
        var groupOpts = '<option value="">未分组</option>';
        for (var i = 0; i < groups.length; i++) {
            groupOpts += '<option>' + escHtml(groups[i].key) + '</option>';
        }
        var filterOpts = '<option value="">全部</option>';
        for (var i = 0; i < groups.length; i++) {
            filterOpts += '<option>' + escHtml(groups[i].key) + '</option>';
        }
        filterOpts += '<option value="未分组">未分组</option>';

        // 更新 m_group（新增机器区）
        var mGroup = document.getElementById('m_group');
        if (mGroup) { var sv = mGroup.value; mGroup.innerHTML = groupOpts; if (sv) mGroup.value = sv; }

        // 更新 machine-group-filter（筛选栏）
        var filterSel = document.getElementById('machine-group-filter');
        if (filterSel) { var fv = filterSel.value; filterSel.innerHTML = filterOpts; if (fv) filterSel.value = fv; }

        // 更新 bm_group（批量弹窗-范围标签页）
        var bmGroup = document.getElementById('bm_group');
        if (bmGroup) { var bv = bmGroup.value; bmGroup.innerHTML = groupOpts; if (bv) bmGroup.value = bv; }

        // 更新 bp_group（批量弹窗-粘贴标签页）
        var bpGroup = document.getElementById('bp_group');
        if (bpGroup) { var pv = bpGroup.value; bpGroup.innerHTML = groupOpts; if (pv) bpGroup.value = pv; }

        // 更新所有机器行中的分组下拉框
        var mgSelects = document.querySelectorAll('select[id^="mg_"]');
        mgSelects.forEach(function(sel) {
            var curVal = sel.value;
            var isNewGroup = (curVal === '__new_group__');
            sel.innerHTML = _groupOptions(isNewGroup ? '__new_group__' : curVal);
            if (!isNewGroup) sel.value = curVal;
        });

        _refreshMachineList();

        // 同步多选筛选面板的分组数据
        if (typeof _filterPanelData !== 'undefined') {
            _filterPanelData.group = groups.map(function(g) { return g.key; });
            // 修剪无效分组选项，同步筛选 UI
            if (window.machineFilter) {
                var validKeys = _filterPanelData.group;
                machineFilter.state.group = machineFilter.state.group.filter(function(v) { return validKeys.indexOf(v) >= 0; });
                machineFilter.syncUI();
            }
        }
    });
}

function _updateGroupCount() {
    var container = document.getElementById('group-tags-container');
    var badge = document.getElementById('group-count-badge');
    if (badge && container) {
        badge.textContent = container.querySelectorAll('.group-tag').length;
    }
}

function _updateGroupEmptyHint() {
    var container = document.getElementById('group-tags-container');
    var hint = document.getElementById('group-empty-hint');
    if (hint && container) {
        hint.style.display = container.querySelectorAll('.group-tag').length === 0 ? 'block' : 'none';
    }
}
