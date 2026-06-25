// Excel 导入
let importPreviewData = [];
let deletionBatchMode = false;
let _importFile = null;

function handleImportFile(input){
    const file = input.files[0];
    if(!file){ return; }
    _importFile = file;
    _doImportPreview(file, null);
    input.value = '';
}

function _doImportPreview(file, sheet){
    const fd = new FormData();
    fd.append('file', file);
    if (sheet) fd.append('sheet', sheet);
    showToast('正在解析 Excel...', 2000);
    fetch('/import_tasks/preview', {method:'POST', body:fd})
        .then(r=>r.json())
        .then(data=>{
            if(data.msg && data.items === undefined){
                showToast(data.msg); return;
            }
            importPreviewData = data.items || [];
            renderImportPreview(data);
            document.getElementById('import-dialog').style.display = 'block';
        })
        .catch(e=>{ showToast('导入失败: '+e.message); });
}

function _onImportSheetChange(sheetName){
    if (!_importFile) return;
    _doImportPreview(_importFile, sheetName);
}

function renderImportPreview(data){
    const items = data.items || [];
    const tbody = document.getElementById('import-preview-table');
    // 保留表头，清除旧行
    tbody.querySelectorAll('tr.import-row').forEach(r=>r.remove());

    items.forEach((it, i)=>{
        const tr = document.createElement('tr');
        tr.className = 'import-row';
        let statusText = '', statusColor = '';
        if(it.status === 'ok'){
            statusText = '可导入'; statusColor = '#67c23a';
        } else if(it.status === 'rejected'){
            statusText = '已存在(ID重复)'; statusColor = '#f56c6c';
        } else if(it.status === 'confirm'){
            statusText = '疑似重复'; statusColor = '#e6a23c';
        }
        const checked = it.status !== 'rejected' ? 'checked' : '';
        const disabled = it.status === 'rejected' ? 'disabled' : '';
        tr.innerHTML = `
            <td><input type="checkbox" class="import-check" data-idx="${i}" ${checked} ${disabled} onchange="updateImportCount()"></td>
            <td>${escHtml(it.name)}</td>
            <td>${escHtml(it.type)}</td>
            <td>${escHtml(it.task_kind)}</td>
            <td>${escHtml(it.priority)}</td>
            <td><input class="import-duration-edit" value="${escHtml(it.duration)}" style="width:90px" data-idx="${i}" placeholder="如 2h / 90min"></td>
            <td>${escHtml(it.rbp_task_id)}</td>
            <td style="color:${statusColor};font-weight:600;">${statusText}</td>
            <td style="color:#e6a23c;font-size:11px;">${(it.warnings||[]).join('; ')}</td>
        `;
        tbody.appendChild(tr);
    });

    // 多工作表选择器
    var sheets = data.sheets || [];
    var sheetDiv = document.getElementById('import-sheet-selector');
    var sheetSelect = document.getElementById('import-sheet-select');
    if (sheets.length > 1) {
        sheetDiv.style.display = '';
        sheetSelect.innerHTML = '';
        sheets.forEach(function(s) {
            var opt = document.createElement('option');
            opt.value = s;
            opt.textContent = s;
            if (s === (data.active_sheet || '')) opt.selected = true;
            sheetSelect.appendChild(opt);
        });
    } else {
        sheetDiv.style.display = 'none';
    }

    const fieldInfo = Object.entries(data.field_map || {}).map(([k,v])=>`列${v+1}→${k}`).join(', ');
    document.getElementById('import-summary').innerHTML = `
        共 ${data.valid_items} 条 |
        <span style="color:#67c23a;">可导入 ${data.ok_count}</span> |
        <span style="color:#f56c6c;">ID重复 ${data.rbp_dup_count}</span> |
        <span style="color:#e6a23c;">疑似重复 ${data.name_type_dup_count}</span>
    `;
    document.getElementById('import-field-map').textContent = '识别字段映射: ' + (fieldInfo || '无');
    updateImportCount();

    // 显示缺失的枚举类型
    const missing = data.missing_types || {};
    const fieldLabels = { type: '机型', task_kind: '任务类型', priority: '优先级', difficulty: '难度' };
    const missingEntries = Object.entries(missing).filter(function(e){ return e[1].length > 0; });
    const missingDiv = document.getElementById('import-missing-types');
    if (missingEntries.length > 0) {
        const parts = missingEntries.map(function(e){
            return fieldLabels[e[0]] + '：' + e[1].map(function(v){ return '「' + v + '」'; }).join('、');
        });
        document.getElementById('import-missing-types-text').textContent =
            '导入数据中发现当前设置中不存在的类型 — ' + parts.join('；');
        missingDiv.style.display = '';
        missingDiv._missingTypes = missing;
    } else {
        missingDiv.style.display = 'none';
        missingDiv._missingTypes = null;
    }
}

function closeImportDialog(){
    document.getElementById('import-dialog').style.display = 'none';
    importPreviewData = [];
}

function updateImportCount(){
    const n = document.querySelectorAll('.import-check:checked').length;
    document.getElementById('import-summary').dataset.checked = n;
}

function importSelectAll(){
    document.querySelectorAll('.import-check:not([disabled])').forEach(c=>c.checked=true);
    updateImportCount();
}
function importSelectNone(){
    document.querySelectorAll('.import-check').forEach(c=>c.checked=false);
    updateImportCount();
}
function importSelectOk(){
    document.querySelectorAll('.import-check').forEach(c=>{
        const tr = c.closest('tr');
        const statusText = tr ? tr.querySelector('td:nth-child(7)') : null;
        c.checked = statusText && statusText.textContent === '可导入';
    });
    updateImportCount();
}

function confirmImport(){
    const selected = [];
    document.querySelectorAll('.import-check:checked').forEach(c=>{
        const idx = parseInt(c.dataset.idx, 10);
        if(!isNaN(idx) && importPreviewData[idx]){
            const it = importPreviewData[idx];
            if(it.status !== 'rejected') selected.push(it);
        }
    });
    if(selected.length === 0){ showToast('请至少选择一条可导入的任务'); return; }
    // 读取编辑后的时长值
    selected.forEach(it=>{
        const idx = it.index;
        const durInput = document.querySelector(`.import-duration-edit[data-idx="${idx}"]`);
        if(durInput){
            const editedDur = (durInput.value || '').trim();
            it.duration = editedDur;
        }
    });
    // 检查疑似重复项
    const confirmItems = selected.filter(it=>it.status==='confirm');
    // 检查任务名为空的项
    const namelessItems = selected.filter(it=>!(it.name || '').trim());
    let msg = `确认导入 ${selected.length} 条任务？`;
    if(confirmItems.length > 0){
        msg += `\n\n其中 ${confirmItems.length} 条与已有任务名+机型重复，确认后将会新增。`;
    }
    if(namelessItems.length > 0){
        msg += `\n\n其中 ${namelessItems.length} 条任务名为空，将使用RBP任务ID生成占位名。`;
    }
    showConfirm('确认导入', msg.replace(/\n\n/g,'<br><br>')).then(ok=>{
        if(!ok) return;
    const syncCheck = document.getElementById('import-sync-types-check');
    const shouldSync = syncCheck && syncCheck.checked;
    const body = {items: selected};
    if (shouldSync) {
        // 使用 renderImportPreview 时缓存的 missing_types
        var mtDiv = document.getElementById('import-missing-types');
        if (mtDiv && mtDiv.style.display !== 'none' && mtDiv._missingTypes) {
            body.sync_missing_types = mtDiv._missingTypes;
        }
    }
    // 导入前自动存档
    fetch('/api/saves/auto', {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'})
        .catch(function(){})
        .then(function(){
            return fetch('/import_tasks/execute', {
                method:'POST',
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify(body)
            });
        })
    .then(r=>r.json())
    .then(d=>{
        showToast(d.msg||'导入完成');
        closeImportDialog();
        if (d.synced_types) {
            // 刷新设置下拉框以包含新添加的类型，完成后才刷新任务表格
            fetch('/api/settings').then(function(r){ return r.json(); }).then(function(data){
                APP_CONFIG.machine_types = data.machine_types || [];
                APP_CONFIG.task_kinds = data.task_kinds || [];
                APP_CONFIG.priorities = data.priorities || [];
                APP_CONFIG.difficulties = data.difficulties || [];
                APP_CONFIG.machine_statuses = data.machine_statuses || [];
                // 重建 TYPE_INDEX_MAP
                for (var k in TYPE_INDEX_MAP) { delete TYPE_INDEX_MAP[k]; }
                var mts = data.machine_types || [];
                for (var i = 0; i < mts.length; i++) {
                    TYPE_INDEX_MAP[mts[i].key] = i;
                }
                _syncMachineTypeUI();
                _syncTaskKindUI();
                _syncPriorityUI();
                _syncDifficultyUI();
                if (typeof filterTaskPool === 'function') filterTaskPool();
                if (typeof _applyStoredColors === 'function') _applyStoredColors();
                // 确保下拉选项全部就绪后再刷新任务表格
                _silentRefresh();
            });
        } else {
            _silentRefresh();
        }
    });
    }); // close showConfirm
}

// 删除记录
function loadDeletionLog(){
    const table = document.getElementById('deletion-log-table');
    if(!table) return;
    fetch('/deletion_log').then(function(r){ return r.json(); }).then(function(data){
        const items = data.items || [];
        const isDetail = (typeof currentTaskMode !== 'undefined' && currentTaskMode === 'detail');
        const batchOn = deletionBatchMode;

        var h = '<tr>';
        h += '<th class="batch-col" style="display:' + (batchOn ? '' : 'none') + ';"><input type="checkbox" id="deletion-check-all" onchange="toggleDeletionSelectAll()"></th>';
        h += '<th>删除时间</th><th>任务名</th><th>机型</th>';
        if (isDetail) {
            h += '<th>优先级</th><th>RBP任务ID</th><th>任务场景</th><th>任务类型</th><th>通用类别</th><th>来源链接</th><th>预期采集量</th><th>数采需求ID</th><th>数采需求类型</th>';
        } else {
            h += '<th>任务类型</th><th>优先级</th><th>难度</th>';
        }
        h += '<th class="dl-action-header">操作</th>';
        h += '</tr>';

        var b = '';
        if (items.length === 0) {
            var span = isDetail ? 14 : 8;
            b = '<tr class="deletion-row"><td colspan="' + span + '" style="color:#999;">暂无删除记录</td></tr>';
        } else {
            items.forEach(function(item){
                var rec = item.record || {};
                b += '<tr class="deletion-row" data-log-id="' + item.id + '"' +
                    ' data-rbp="' + escHtml(rec.rbp_task_id || '') + '"' +
                    ' data-scene="' + escHtml(rec.scene || '') + '"' +
                    ' data-gcat="' + escHtml(rec.general_category || '') + '"' +
                    ' data-slink="' + escHtml(rec.source_link || '') + '"' +
                    ' data-expcnt="' + (rec.expected_count || '') + '"' +
                    ' data-creqid="' + escHtml(rec.collection_req_id || '') + '"' +
                    ' data-creqtype="' + escHtml(rec.collection_req_type || '') + '"' +
                    '>';
                b += '<td class="batch-col" style="display:' + (batchOn ? '' : 'none') + ';"><input type="checkbox" class="deletion-check" data-log-id="' + item.id + '" onchange="updateDeletionBatchCount()"></td>';
                b += '<td>' + escHtml(item.deleted_at) + '</td>';
                b += '<td>' + escHtml(rec.name || '') + '</td>';
                b += '<td>' + escHtml(rec.type || '') + '</td>';
                if (isDetail) {
                    b += '<td>' + escHtml(rec.priority || '') + '</td>';
                    b += '<td>' + escHtml(rec.rbp_task_id || '') + '</td>';
                    b += '<td>' + escHtml(rec.scene || '') + '</td>';
                    b += '<td>' + escHtml(rec.task_kind || '') + '</td>';
                    b += '<td>' + escHtml(rec.general_category || '') + '</td>';
                    b += '<td>' + (rec.source_link ? '<a href="' + escHtml(rec.source_link) + '" target="_blank" style="color:#1976d2;">链接</a>' : '') + '</td>';
                    b += '<td>' + (rec.expected_count || '') + '</td>';
                    b += '<td>' + escHtml(rec.collection_req_id || '') + '</td>';
                    b += '<td>' + escHtml(rec.collection_req_type || '') + '</td>';
                } else {
                    b += '<td>' + escHtml(rec.task_kind || '') + '</td>';
                    b += '<td>' + escHtml(rec.priority || '') + '</td>';
                    b += '<td>' + escHtml(rec.difficulty || '') + '</td>';
                }
                b += '<td class="dl-action-cell">' +
                    '<button onclick="restoreTask(' + item.id + ')">恢复</button> ' +
                    '<button onclick="permanentDeleteLog(' + item.id + ')" style="background:var(--danger);color:#fff;">永久删除</button>' +
                    '</td>';
                b += '</tr>';
            });
        }
        table.innerHTML = h + b;

        if (!batchOn) {
            var allCb = document.getElementById('deletion-check-all');
            if (allCb) allCb.checked = false;
        }
    }).catch(function(){});
}

function restoreTask(logId){
    showConfirm('恢复任务', '确认恢复此任务？任务将回到"待分配"状态。').then(ok=>{
        if(!ok) return;
        fetch('/restore_task/'+logId, {method:'POST'}).then(r=>r.json()).then(d=>{
            showToast(d.msg);
            _silentRefresh();
            loadDeletionLog();
        });
    });
}

function permanentDeleteLog(logId){
    showConfirm('永久删除', '<p style="color:#c62828;">确认<b>永久删除</b>此记录？</p><p style="font-size:12px;">此操作不可恢复，任务数据将被彻底清除。</p>').then(function(ok){
        if(!ok) return;
        fetch('/permanent_delete_log/'+logId, {method:'POST'}).then(function(r){ return r.json(); }).then(function(d){
            showToast(d.msg);
            loadDeletionLog();
        });
    });
}

function toggleDeletionBatchMode(){
    deletionBatchMode = !deletionBatchMode;
    var on = deletionBatchMode;
    document.getElementById('deletion-batch-actions').style.display = on ? '' : 'none';
    document.querySelectorAll('#deletion-log-table .batch-col').forEach(function(el){
        el.style.display = on ? '' : 'none';
    });
    document.querySelectorAll('#deletion-log-table .dl-action-cell').forEach(function(el){
        el.style.display = on ? 'none' : '';
    });
    document.querySelectorAll('#deletion-log-table .dl-action-header').forEach(function(el){
        el.style.display = on ? 'none' : '';
    });
    if (!on) {
        document.querySelectorAll('#deletion-log-table .deletion-check').forEach(function(c){ c.checked = false; });
        var allCb = document.getElementById('deletion-check-all');
        if (allCb) allCb.checked = false;
        updateDeletionBatchCount();
    }
}

function toggleDeletionSelectAll(){
    var allCb = document.getElementById('deletion-check-all');
    if (!allCb) return;
    var checked = allCb.checked;
    document.querySelectorAll('#deletion-log-table .deletion-check').forEach(function(c){
        c.checked = checked;
    });
    updateDeletionBatchCount();
}

function updateDeletionBatchCount(){
    var n = document.querySelectorAll('#deletion-log-table .deletion-check:checked').length;
    var el = document.getElementById('deletion-batch-count');
    if (el) el.textContent = '已选 ' + n + ' 项';
}

function _getCheckedDeletionIds(){
    var ids = [];
    document.querySelectorAll('#deletion-log-table .deletion-check:checked').forEach(function(c){
        ids.push(parseInt(c.dataset.logId, 10));
    });
    return ids;
}

function batchRestoreDeletion(){
    var ids = _getCheckedDeletionIds();
    if (ids.length === 0) { showToast('请先选择记录'); return; }
    showConfirm('批量恢复', '确认恢复 ' + ids.length + ' 条删除记录？任务将回到"待分配"状态。').then(function(ok){
        if (!ok) return;
        fetch('/batch_restore_tasks', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ids: ids})
        }).then(function(r){ return r.json(); }).then(function(d){
            showToast(d.msg);
            _silentRefresh();
            deletionBatchMode = false;
            document.getElementById('deletion-batch-actions').style.display = 'none';
            document.getElementById('deletion-batch-mode').checked = false;
            loadDeletionLog();
        });
    });
}

function batchPermanentDeleteDeletion(){
    var ids = _getCheckedDeletionIds();
    if (ids.length === 0) { showToast('请先选择记录'); return; }
    showConfirm('批量永久删除', '<p style="color:#c62828;">确认<b>永久删除</b> ' + ids.length + ' 条删除记录？</p><p style="font-size:12px;">此操作不可恢复，任务数据将被彻底清除。</p>').then(function(ok){
        if (!ok) return;
        fetch('/batch_permanent_delete_logs', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ids: ids})
        }).then(function(r){ return r.json(); }).then(function(d){
            showToast(d.msg);
            deletionBatchMode = false;
            document.getElementById('deletion-batch-actions').style.display = 'none';
            document.getElementById('deletion-batch-mode').checked = false;
            loadDeletionLog();
        });
    });
}
