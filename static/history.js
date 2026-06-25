// ========== 数据与分页状态 ==========
var SCHEDULES_HISTORY = [];
var _histPage = 0;
var _histPageSize = (function(){
    try { var v = parseInt(localStorage.getItem('historyPageSize'), 10); return (v === 20 || v === 50 || v === 100) ? v : 20; }
    catch(e) { return 20; }
})();
var _histBatchSet = new Set();

// ========== 搜索、排序、折叠面板 ==========
var histSortState = { column: null, direction: 0 };

function clearHistorySearch() {
    var inp = document.getElementById('history-search');
    if (inp) { inp.value = ''; inp.focus(); }
    filterHistoryTable();
}

function toggleHistoryDatePanel() {
    var panel = document.getElementById('history-date-panel');
    panel.classList.toggle('open');
    var arrow = document.querySelector('#history-date-toggle .filter-arrow');
    if (arrow) {
        arrow.textContent = panel.classList.contains('open') ? '▾' : '▸';
    }
    var badge = document.getElementById('history-date-badge');
    var from = document.getElementById('history-date-from').value;
    var to = document.getElementById('history-date-to').value;
    if (from || to) {
        badge.textContent = '●';
        badge.style.display = '';
    } else {
        badge.style.display = 'none';
    }
}

function toggleHistMoreFields(btn) {
    btn.classList.toggle('open');
    var arrow = btn.querySelector('.arrow');
    var body = document.getElementById('hist-more-fields');
    var isOpen = body.style.display !== 'none';
    if (isOpen) {
        body.style.display = 'none';
        arrow.innerHTML = '▶';
        btn.classList.remove('open');
    } else {
        body.style.display = 'block';
        arrow.innerHTML = '▼';
        btn.classList.add('open');
    }
}

function _rowMatchesHistorySearch(tr, term) {
    if (!term) return true;
    var cells = tr.querySelectorAll('td');
    for (var i = 0; i < cells.length; i++) {
        var text = (cells[i].textContent || '').toLowerCase();
        if (text.indexOf(term) !== -1) return true;
    }
    return false;
}

function _highlightHistoryCell(cell, term) {
    if (!term) {
        cell.querySelectorAll('mark.search-highlight').forEach(function(m) { m.replaceWith(m.textContent); });
        return;
    }
    cell.querySelectorAll('mark.search-highlight').forEach(function(m) { m.replaceWith(m.textContent); });
    var text = cell.textContent || '';
    var lower = text.toLowerCase();
    var idx = lower.indexOf(term);
    if (idx === -1) return;
    if (cell.querySelector('button, input, select, a')) return;
    var before = text.slice(0, idx);
    var match = text.slice(idx, idx + term.length);
    var after = text.slice(idx + term.length);
    cell.textContent = '';
    cell.appendChild(document.createTextNode(before));
    var m = document.createElement('mark');
    m.className = 'search-highlight';
    m.textContent = match;
    cell.appendChild(m);
    cell.appendChild(document.createTextNode(after));
}

function _sortHistoryRows(arr, colKey, dir) {
    if (!arr.length || !colKey) return;
    if (dir === 0) {
        arr.sort(function(a, b) {
            var ai = parseInt(a.dataset.origIndex, 10) || 0;
            var bi = parseInt(b.dataset.origIndex, 10) || 0;
            return ai - bi;
        });
        return;
    }
    arr.sort(function(a, b) {
        var av, bv;
        if (colKey === 'name') {
            av = (a.querySelector('td:first-child') || {}).textContent || '';
            bv = (b.querySelector('td:first-child') || {}).textContent || '';
        } else if (colKey === 'machine') {
            av = (a.querySelectorAll('td')[1] || {}).textContent || '';
            bv = (b.querySelectorAll('td')[1] || {}).textContent || '';
        } else if (colKey === 'kind') {
            av = (a.querySelectorAll('td')[3] || {}).textContent || '';
            bv = (b.querySelectorAll('td')[3] || {}).textContent || '';
        } else {
            av = a.dataset[colKey] || '';
            bv = b.dataset[colKey] || '';
        }
        if (typeof av === 'string') {
            return dir === 1 ? av.localeCompare(bv) : bv.localeCompare(av);
        }
        return dir === 1 ? av - bv : bv - av;
    });
}

function _updateHistSortIndicators() {
    document.querySelectorAll('#history-table th.sortable .sort-indicator, #history-table-detail th.sortable .sort-indicator').forEach(function(sp) {
        sp.textContent = '';
    });
    if (histSortState.direction === 0) return;
    var arrow = histSortState.direction === 1 ? ' ▲' : ' ▼';
    document.querySelectorAll('#history-table th.sortable[data-sort="' + histSortState.column + '"] .sort-indicator, #history-table-detail th.sortable[data-sort="' + histSortState.column + '"] .sort-indicator').forEach(function(sp) {
        sp.textContent = arrow;
    });
}

// ========== 数组驱动 pipeline（过滤 → 搜索 → 排序） ==========
function _histMatchesSearch(s, term) {
    if (!term) return true;
    var fields = [s.task_name, s.machine_name, s.task_type, s.task_kind, s.remark || '', s.rbp_task_id || '', s.scene || '', s.general_category || ''];
    for (var i = 0; i < fields.length; i++) {
        if (fields[i] && fields[i].toLowerCase().indexOf(term) !== -1) return true;
    }
    return false;
}

function _sortHistData(arr, colKey, dir) {
    if (!arr.length || dir === 0) return;
    arr.sort(function(a, b) {
        var av, bv;
        if (colKey === 'name') { av = a.task_name || ''; bv = b.task_name || ''; }
        else if (colKey === 'machine') { av = a.machine_name || ''; bv = b.machine_name || ''; }
        else if (colKey === 'kind') { av = a.task_kind || ''; bv = b.task_kind || ''; }
        else { return 0; }
        var cmp = av.localeCompare(bv);
        return dir === 1 ? cmp : -cmp;
    });
}

function _getFilteredAndSortedHistory() {
    var ft = _histFilterState.type;
    var fk = _histFilterState.kind;
    var searchTerm = (document.getElementById('history-search').value || '').trim().toLowerCase();

    var filtered = [];
    for (var i = 0; i < SCHEDULES_HISTORY.length; i++) {
        var s = SCHEDULES_HISTORY[i];
        if (ft.length > 0 && ft.indexOf(s.task_type) < 0) continue;
        if (fk.length > 0 && fk.indexOf(s.task_kind) < 0) continue;
        filtered.push(s);
    }

    var matching = [];
    if (searchTerm) {
        for (var i = 0; i < filtered.length; i++) {
            if (_histMatchesSearch(filtered[i], searchTerm)) {
                matching.push(filtered[i]);
            }
        }
    } else {
        matching = filtered;
    }

    if (histSortState.direction > 0 && histSortState.column) {
        _sortHistData(matching, histSortState.column, histSortState.direction);
    }

    return matching;
}

// ========== 分页渲染 ==========
function _renderHistoryPage() {
    var filtered = _getFilteredAndSortedHistory();
    var totalFiltered = filtered.length;
    var totalPages = Math.max(1, Math.ceil(totalFiltered / _histPageSize));

    if (_histPage >= totalPages) _histPage = totalPages - 1;
    if (_histPage < 0) _histPage = 0;

    var start = _histPage * _histPageSize;
    var end = Math.min(start + _histPageSize, totalFiltered);
    var pageItems = filtered.slice(start, end);

    _renderHistoryTableRows(pageItems, start);
    _renderHistoryPaginationBar(totalFiltered, totalPages);
    _updateHistSortIndicators();
}

function _renderHistoryTableRows(pageItems, startOffset) {
    // === 简易表格 ===
    var simpleHtml = '';
    for (var i = 0; i < pageItems.length; i++) {
        var s = pageItems[i];
        var isTaskOnly = s.record_type === 'task_only';
        var seq = startOffset + i + 1;
        var hasRepair = (!isTaskOnly && s.repair_periods && s.repair_periods.length > 0) ? '1' : '0';
        var hid = isTaskOnly ? ('t' + s.task_id) : s.id;
        var checked = _histBatchSet.has(hid) ? ' checked' : '';
        var machineCol = isTaskOnly ? '<td style="color:var(--text-muted);">—</td>' : '<td>' + escHtml(s.machine_name) + '</td>';
        var timeCol = isTaskOnly ? '<td style="color:var(--text-muted);">无分配记录</td>' : '<td>' + escHtml(s.date) + ' ' + escHtml(s.start_str) + '-' + escHtml(s.end_str) + '</td>';
        var remarkCol = isTaskOnly ? '<td>' + escHtml(s.remark || '') + '</td>' : '<td>' + (s.remark || '') + '</td>';
        var repairCol = isTaskOnly ? '<td></td>' : '<td>' + (s.repair_duration || '') + '</td>';
        var opCol;
        if (isTaskOnly) {
            opCol = '<td class="hist-op-cell">' +
                '<button onclick="recallCompletedTask(' + s.task_id + ')">回收</button>' +
                '</td>';
        } else {
            opCol = '<td class="hist-op-cell">' +
                '<button class="btn" onclick="openHistoryEdit(' + s.id + ')">修改</button>' +
                '<button class="btn-danger" onclick="delHistorySchedule(' + s.id + ')">删除</button>' +
                '<button onclick="recallHistoryTask(' + s.id + ')">回收</button>' +
                '</td>';
        }
        simpleHtml += '<tr data-hid="' + hid + '" data-orig-index="' + i + '" data-type="' + escHtml(s.task_type) + '" data-kind="' + escHtml(s.task_kind) + '" data-date="' + escHtml(s.date || '') + '" data-start="' + (s.start_min || '') + '" data-end="' + (s.end_min || '') + '" data-has-repair="' + hasRepair + '">' +
            '<td class="hist-batch-col" style="display:none;"><input type="checkbox" class="hist-check" data-hid="' + hid + '"' + checked + '></td>' +
            '<td class="seq-col">' + seq + '</td>' +
            '<td>' + escHtml(s.task_name) + '(' + escHtml(s.task_type) + '/' + escHtml(s.task_kind) + ')</td>' +
            machineCol +
            timeCol +
            '<td>' + escHtml(s.task_kind || '') + '</td>' +
            remarkCol +
            repairCol +
            opCol + '</tr>';
    }
    var simpleTbody = document.querySelector('#history-table tbody');
    if (simpleTbody) { simpleTbody.innerHTML = simpleHtml; }

    // === 详细表格 ===
    var detailHtml = '';
    for (var i = 0; i < pageItems.length; i++) {
        var s = pageItems[i];
        var isTaskOnly = s.record_type === 'task_only';
        var seq = startOffset + i + 1;
        var hasRepair = (!isTaskOnly && s.repair_periods && s.repair_periods.length > 0) ? '1' : '0';
        var hid = isTaskOnly ? ('t' + s.task_id) : s.id;
        var checked = _histBatchSet.has(hid) ? ' checked' : '';
        var machineCol = isTaskOnly ? '<td style="color:var(--text-muted);">—</td>' : '<td>' + escHtml(s.machine_name) + '</td>';
        var timeCol = isTaskOnly ? '<td style="color:var(--text-muted);">无分配记录</td>' : '<td>' + escHtml(s.date) + ' ' + escHtml(s.start_str) + '-' + escHtml(s.end_str) + '</td>';
        var remarkCol = isTaskOnly ? '<td>' + escHtml(s.remark || '') + '</td>' : '<td>' + (s.remark || '') + '</td>';
        var repairCol = isTaskOnly ? '<td></td>' : '<td>' + (s.repair_duration || '') + '</td>';
        var emptyCol = '<td></td>';
        var opCol;
        if (isTaskOnly) {
            opCol = '<td class="hist-op-cell">' +
                '<button onclick="recallCompletedTask(' + s.task_id + ')">回收</button>' +
                '</td>';
        } else {
            opCol = '<td class="hist-op-cell">' +
                '<button class="btn" onclick="openHistoryEdit(' + s.id + ')">修改</button>' +
                '<button class="btn-danger" onclick="delHistorySchedule(' + s.id + ')">删除</button>' +
                '<button onclick="recallHistoryTask(' + s.id + ')">回收</button>' +
                '</td>';
        }
        detailHtml += '<tr data-hid="' + hid + '" data-orig-index="' + i + '" data-type="' + escHtml(s.task_type) + '" data-kind="' + escHtml(s.task_kind) + '" data-date="' + escHtml(s.date || '') + '" data-start="' + (s.start_min || '') + '" data-end="' + (s.end_min || '') + '" data-has-repair="' + hasRepair + '">' +
            '<td class="hist-batch-col" style="display:none;"><input type="checkbox" class="hist-check" data-hid="' + hid + '"' + checked + '></td>' +
            '<td class="seq-col">' + seq + '</td>' +
            '<td>' + escHtml(s.task_name) + '(' + escHtml(s.task_type) + '/' + escHtml(s.task_kind) + ')</td>' +
            machineCol +
            timeCol +
            '<td>' + escHtml(s.task_kind || '') + '</td>' +
            remarkCol +
            repairCol +
            (isTaskOnly ? emptyCol : '<td>' + (s.rbp_task_id || '') + '</td>') +
            (isTaskOnly ? emptyCol : '<td>' + (s.scene || '') + '</td>') +
            (isTaskOnly ? emptyCol : '<td>' + (s.general_category || '') + '</td>') +
            (isTaskOnly ? emptyCol : '<td>' + (s.source_link ? '<a href="' + escHtml(s.source_link) + '" target="_blank" style="color:#1976d2;">链接</a>' : '') + '</td>') +
            (isTaskOnly ? emptyCol : '<td>' + (s.expected_count || '') + '</td>') +
            (isTaskOnly ? emptyCol : '<td>' + (s.collection_req_id || '') + '</td>') +
            (isTaskOnly ? emptyCol : '<td>' + (s.collection_req_type || '') + '</td>') +
            (isTaskOnly ? emptyCol : '<td>' + (s.repair_periods_str || '') + '</td>') +
            opCol + '</tr>';
    }
    var detailTbody = document.querySelector('#history-table-detail tbody');
    if (detailTbody) { detailTbody.innerHTML = detailHtml; }

    // Wire checkboxes
    document.querySelectorAll('.hist-check').forEach(function(c) { c.addEventListener('change', updateBatchCount); });
}

function _renderHistoryPaginationBar(totalFiltered, totalPages) {
    var bar = document.getElementById('history-pagination-bar');
    if (!bar) return;

    var totalAll = SCHEDULES_HISTORY.length;
    var html = '';

    html += '<button class="page-btn" onclick="histGoToPage(' + (_histPage - 1) + ')"' + (_histPage <= 0 ? ' disabled' : '') + '>← 上一页</button>';

    var maxVisible = 7;
    if (totalPages <= maxVisible) {
        for (var p = 0; p < totalPages; p++) {
            html += '<button class="page-btn' + (p === _histPage ? ' page-current' : '') + '" onclick="histGoToPage(' + p + ')">' + (p + 1) + '</button>';
        }
    } else {
        html += '<button class="page-btn' + (0 === _histPage ? ' page-current' : '') + '" onclick="histGoToPage(0)">1</button>';
        var startP = Math.max(1, _histPage - 2);
        var endP = Math.min(totalPages - 2, _histPage + 2);
        if (startP > 1) html += '<span class="page-ellipsis">...</span>';
        for (var p = startP; p <= endP; p++) {
            html += '<button class="page-btn' + (p === _histPage ? ' page-current' : '') + '" onclick="histGoToPage(' + p + ')">' + (p + 1) + '</button>';
        }
        if (endP < totalPages - 2) html += '<span class="page-ellipsis">...</span>';
        var lastP = totalPages - 1;
        html += '<button class="page-btn' + (lastP === _histPage ? ' page-current' : '') + '" onclick="histGoToPage(' + lastP + ')">' + (lastP + 1) + '</button>';
    }

    html += '<button class="page-btn" onclick="histGoToPage(' + (_histPage + 1) + ')"' + (_histPage >= totalPages - 1 ? ' disabled' : '') + '>下一页 →</button>';

    html += ' 每页 <select class="page-size-select" onchange="histSetPageSize(this.value)">';
    html += '<option value="20"' + (_histPageSize === 20 ? ' selected' : '') + '>20</option>';
    html += '<option value="50"' + (_histPageSize === 50 ? ' selected' : '') + '>50</option>';
    html += '<option value="100"' + (_histPageSize === 100 ? ' selected' : '') + '>100</option>';
    html += '</select>';

    html += ' <span class="page-summary">共 ' + totalAll + ' 条记录，筛选显示 ' + totalFiltered + ' 条，第 ' + (_histPage + 1) + '/共 ' + totalPages + ' 页</span>';

    bar.innerHTML = html;
}

function histGoToPage(p) {
    _histPage = p;
    _renderHistoryPage();
}

function histSetPageSize(size) {
    _histPageSize = parseInt(size, 10);
    _histPage = 0;
    _setLS('historyPageSize', String(_histPageSize));
    _renderHistoryPage();
}

function _loadHistory(dateFrom, dateTo){
    _histBatchSet.clear();
    updateBatchCount();
    var params = [];
    if(dateFrom) params.push('date_from='+encodeURIComponent(dateFrom));
    if(dateTo) params.push('date_to='+encodeURIComponent(dateTo));
    var qs = params.length > 0 ? '?'+params.join('&') : '';
    fetch('/api/history_schedules'+qs)
    .then(function(r){return r.json();}).then(function(d){
        SCHEDULES_HISTORY = d.history || [];
        _histPage = 0;
        filterHistoryTable();
        switchHistoryModeBtn(currentHistoryMode);
        _loadHistoryPackages();
    }).catch(function(e){
        console.error('历史记录加载失败:', e);
        showToast('历史记录加载失败，请检查网络或刷新页面');
    });
}
function _refreshHistory(){
    var from = document.getElementById('history-date-from').value;
    var to = document.getElementById('history-date-to').value;
    _loadHistory(from, to);
}
function filterHistory(){
    var from = document.getElementById('history-date-from').value;
    var to = document.getElementById('history-date-to').value;
    var url = new URL(window.location.href);
    if(from) url.searchParams.set('history_date_from', from); else url.searchParams.delete('history_date_from');
    if(to) url.searchParams.set('history_date_to', to); else url.searchParams.delete('history_date_to');
    try{ history.replaceState(null, '', url.toString()); }catch(e){}
    _loadHistory(from, to);
}
function filterHistoryTable() {
    _histPage = 0;
    _histSyncFilterUI();
    _renderHistoryPage();

    var searchTerm = (document.getElementById('history-search').value || '').trim().toLowerCase();
    var searchInput = document.getElementById('history-search');
    var clearBtn = searchInput ? searchInput.parentElement.querySelector('.search-clear') : null;
    if (clearBtn) {
        clearBtn.classList.toggle('visible', searchTerm.length > 0);
    }

    // Date badge
    var from = document.getElementById('history-date-from').value;
    var to = document.getElementById('history-date-to').value;
    var dateBadge = document.getElementById('history-date-badge');
    if (from || to) {
        dateBadge.textContent = '●';
        dateBadge.style.display = '';
    } else {
        dateBadge.style.display = 'none';
    }
}
function delHistorySchedule(sid){
    showConfirm('删除排班', '<p>确定删除此排班记录？</p>').then(function(ok){
        if(!ok) return;
        fetch('/del_schedule/'+sid).then(function(r){return r.json();}).then(function(d){showToast(d.msg);_refreshHistory();});
    });
}
function recallHistoryTask(sid){
    recycleTasks({
        scheduleIds: [sid],
        confirmTitle: '回收排班',
        confirmMsg: '<p>确定回收此排班（任务回到未分配）？</p>',
        onSuccess: _refreshHistory
    });
}
function recallCompletedTask(tid) {
    showConfirm('回收任务', '<p>确定将此已完成任务回收为待分配？</p>').then(function(ok) {
        if (!ok) return;
        fetch('/recall_task_to_pool', {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({task_id: tid})
        }).then(function(r) { return r.json(); }).then(function(d) {
            showToast(d.msg);
            _silentRefresh();
            _refreshHistory();
        });
    });
}
// 解析时间字符串 "HH:MM" 或 "HH:MM(+n)" 返回 {min, dayOff}
function _renderRepairRecords(s) {
    var container = document.getElementById('he-repair-records');
    if (!container) return;
    var periods = s.repair_periods || [];
    var html = '';
    if (!periods.length) {
        html += '<span style="color:var(--text-muted);font-size:12px;">无维修记录</span>';
    }
    for (var i = 0; i < periods.length; i++) {
        var p = periods[i];
        var rid = p.id || 0;
        var startVal = (p.start_datetime || '').substring(0, 16);
        var endVal = (p.end_datetime || '').substring(0, 16);
        var durLabel = p.label || (p.duration_minutes ? p.duration_minutes + 'min' : '进行中');
        html += '<div class="repair-record-row" data-rid="' + rid + '" style="display:flex;gap:6px;align-items:center;margin-bottom:4px;padding:4px;background:var(--bg-sidebar);border-radius:4px;">' +
            '<input class="repair-start" type="datetime-local" value="' + escHtml(startVal) + '" style="flex:1;font-size:11px;padding:2px 4px;" step="60">' +
            '<span style="color:var(--text-muted);">→</span>' +
            '<input class="repair-end" type="datetime-local" value="' + escHtml(endVal) + '" style="flex:1;font-size:11px;padding:2px 4px;" step="60">' +
            '<span class="repair-dur-label" style="font-size:11px;color:var(--text-muted);min-width:50px;text-align:right;">' + escHtml(durLabel) + '</span>' +
            '<button class="repair-del-btn" onclick="_deleteRepairRow(this)" style="font-size:11px;padding:1px 6px;color:#c62828;background:none;border:1px solid #c62828;border-radius:3px;cursor:pointer;">×</button>' +
            '</div>';
    }
    html += '<button class="repair-add-btn" onclick="_addRepairRow()" style="font-size:11px;padding:4px 12px;color:#1976d2;background:#e3f2fd;border:1px solid #90caf9;border-radius:4px;cursor:pointer;margin-top:4px;">➕ 添加维修时间段</button>';
    container.innerHTML = html;
}

function _deleteRepairRow(btn) {
    var row = btn.closest('.repair-record-row');
    if (!row) return;
    var rid = parseInt(row.getAttribute('data-rid') || '0', 10);
    if (rid > 0) {
        // Mark for deletion
        row.style.display = 'none';
        row.classList.add('repair-deleted');
    } else {
        row.remove();
    }
}

var _repairNewCounter = 0;

function _addRepairRow() {
    var container = document.getElementById('he-repair-records');
    if (!container) return;
    _repairNewCounter++;
    var newId = 'new_' + _repairNewCounter;
    var row = document.createElement('div');
    row.className = 'repair-record-row';
    row.setAttribute('data-rid', newId);
    row.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:4px;padding:4px;background:#f0fdf4;border:1px dashed #a5d6a7;border-radius:4px;';
    row.innerHTML =
        '<input class="repair-start" type="datetime-local" value="" style="flex:1;font-size:11px;padding:2px 4px;border:1px solid #a5d6a7;border-radius:3px;" step="60">' +
        '<span style="color:var(--text-muted);">→</span>' +
        '<input class="repair-end" type="datetime-local" value="" style="flex:1;font-size:11px;padding:2px 4px;border:1px solid #a5d6a7;border-radius:3px;" step="60">' +
        '<span class="repair-dur-label" style="font-size:11px;color:#4caf50;min-width:50px;text-align:right;">新增</span>' +
        '<button onclick="_deleteRepairRow(this)" style="font-size:11px;padding:1px 6px;color:#4caf50;background:none;border:1px solid #4caf50;border-radius:3px;cursor:pointer;">✓</button>';
    // Insert before the add button (last child)
    var addBtn = container.querySelector('.repair-add-btn');
    if (addBtn) {
        container.insertBefore(row, addBtn);
    } else {
        container.appendChild(row);
    }
}

function _saveRepairRecords() {
    var container = document.getElementById('he-repair-records');
    if (!container) return Promise.resolve();
    var machineId = parseInt(document.getElementById('he_machine_id')?.value || '0', 10);
    var rows = container.querySelectorAll('.repair-record-row');
    var promises = [];

    // Handle deletions
    var deletedRows = container.querySelectorAll('.repair-record-row.repair-deleted');
    deletedRows.forEach(function(row) {
        var ridStr = row.getAttribute('data-rid') || '0';
        // Only delete real records (numeric IDs), skip unsaved new rows
        if (ridStr.indexOf('new_') === 0) {
            row.remove();
            return;
        }
        var rid = parseInt(ridStr, 10);
        if (rid > 0) {
            promises.push(
                fetch('/api/repair_log/delete', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({id: rid})
                })
            );
        }
    });

    // Handle updates and creates (for visible rows)
    rows.forEach(function(row) {
        if (row.classList.contains('repair-deleted')) return;
        var ridStr = row.getAttribute('data-rid') || '0';
        var startInput = row.querySelector('.repair-start');
        var endInput = row.querySelector('.repair-end');
        if (!startInput || !endInput) return;

        var newStart = startInput.value;
        var newEnd = endInput.value;

        // Skip empty new rows (user clicked add but didn't fill anything)
        if (ridStr.indexOf('new_') === 0) {
            if (!newStart) return;  // empty row, silently skip
            if (!machineId) return; // safety: can't create without machine
            promises.push(
                fetch('/api/repair_log/create', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                        machine_id: machineId,
                        start_datetime: newStart,
                        end_datetime: newEnd || null
                    })
                })
            );
            return;
        }

        // Existing record: update if changed
        var rid = parseInt(ridStr, 10);
        if (!rid) return;
        var origStart = (startInput.defaultValue || '').substring(0, 16);
        var origEnd = (endInput.defaultValue || '').substring(0, 16);

        if (newStart !== origStart || newEnd !== origEnd) {
            var payload = {id: rid};
            if (newStart) payload.start_datetime = newStart;
            payload.end_datetime = newEnd || null;
            promises.push(
                fetch('/api/repair_log/update', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(payload)
                })
            );
        }
    });

    return Promise.all(promises);
}
function openHistoryEdit(sid){
    var s = null;
    try { s = SCHEDULES_HISTORY.find(function(item) { return item.id === sid; }); } catch(e) {}
    if (!s) return;
    document.getElementById('he-sid').value = String(sid);
    // Time range
    var startParsed = _parseTimeStr(s.start_str || _formatAbsMin(s.start_min));
    document.getElementById('he_start_date').value = s.date || '';
    document.getElementById('he_start_time').value = startParsed ? String(Math.floor(startParsed.min / 60)).padStart(2, '0') + ':' + String(startParsed.min % 60).padStart(2, '0') : '00:00';
    var endParsed = _parseTimeStr(s.end_str || _formatAbsMin(Math.min(MAX_ABS_MIN, s.end_min)));
    document.getElementById('he_end_time').value = endParsed ? String(Math.floor(endParsed.min / 60)).padStart(2, '0') + ':' + String(endParsed.min % 60).padStart(2, '0') : '00:00';
    if (endParsed && endParsed.dayOff !== 0) {
        document.getElementById('he_end_date').value = _dateAddDays(s.date, endParsed.dayOff);
    } else if (endParsed && endParsed.min < (startParsed ? startParsed.min : 0) && endParsed.dayOff === 0) {
        document.getElementById('he_end_date').value = _dateAddDays(s.date, 1);
    } else {
        document.getElementById('he_end_date').value = s.date || '';
    }
    // More fields
    document.getElementById('he_task_name').value = s.task_name || '';
    document.getElementById('he_type').value = s.task_type || '';
    document.getElementById('he_kind').value = s.task_kind || '';
    document.getElementById('he_pri').value = s.priority || '';
    document.getElementById('he_diff').value = s.difficulty || '';
    document.getElementById('he_machine_id').value = s.machine_id || '';
    _renderRepairRecords(s);
    document.getElementById('he_machine_name').value = s.machine_name || '';
    document.getElementById('he_rbp_task_id').value = s.rbp_task_id || '';
    document.getElementById('he_scene').value = s.scene || '';
    document.getElementById('he_general_category').value = s.general_category || '';
    document.getElementById('he_source_link').value = s.source_link || '';
    document.getElementById('he_expected_count').value = s.expected_count || '';
    document.getElementById('he_collection_req_id').value = s.collection_req_id || '';
    document.getElementById('he_collection_req_type').value = s.collection_req_type || '';
    document.getElementById('he_remark').value = s.remark || '';
    // Collapse more fields by default
    var fieldsDiv = document.getElementById('hist-more-fields');
    var toggleBtn = document.querySelector('.hist-collapse-toggle');
    if (fieldsDiv) fieldsDiv.style.display = 'none';
    if (toggleBtn) {
        toggleBtn.classList.remove('open');
        toggleBtn.querySelector('.arrow').innerHTML = '▶';
    }
    document.getElementById('history-edit-dialog').style.display = 'block';
}
function closeHistoryEdit(){
    document.getElementById('history-edit-dialog').style.display = 'none';
}
function submitHistoryEdit() {
    var sid = parseInt(document.getElementById('he-sid').value || '0', 10);
    var startDate = document.getElementById('he_start_date').value;
    var startTime = document.getElementById('he_start_time').value.trim();
    var endDate = document.getElementById('he_end_date').value;
    var endTime = document.getElementById('he_end_time').value.trim();
    if (!sid || !startDate || !startTime || !endDate || !endTime) { showToast('参数不完整'); return; }
    var sm = hhmmToMin(startTime);
    var em = hhmmToMin(endTime);
    if (sm === null || em === null) { showToast('时间格式错误（HH:MM）'); return; }
    var endMin = em;
    var dayDiff = Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000);
    if (dayDiff > 0) { endMin = em + dayDiff * MINS_PER_DAY; }
    endMin = Math.max(sm + 1, Math.min(MAX_COORD, endMin));

    // Collect task fields for /edit_task
    var taskPayload = {
        schedule_id: sid,
        name: document.getElementById('he_task_name').value.trim(),
        task_type: document.getElementById('he_type').value,
        task_kind: document.getElementById('he_kind').value,
        priority: document.getElementById('he_pri').value,
        difficulty: document.getElementById('he_diff').value,
        remark: document.getElementById('he_remark').value.trim(),
        rbp_task_id: document.getElementById('he_rbp_task_id').value.trim(),
        scene: document.getElementById('he_scene').value.trim(),
        general_category: document.getElementById('he_general_category').value.trim(),
        source_link: document.getElementById('he_source_link').value.trim(),
        expected_count: document.getElementById('he_expected_count').value,
        collection_req_id: document.getElementById('he_collection_req_id').value.trim(),
        collection_req_type: document.getElementById('he_collection_req_type').value.trim()
    };

    // Collect time fields for /update_task_bounds
    var timePayload = {
        schedule_id: sid,
        date: startDate,
        start_min: sm,
        end_min: endMin
    };

    // Call /edit_task first, then /update_task_bounds
    fetch('/edit_task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(taskPayload)
    }).then(function(r) { return r.json(); }).then(function(d1) {
        return fetch('/update_task_bounds', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(timePayload)
        }).then(function(r) { return r.json(); }).then(function(d2) {
            showToast(d1.msg || '已修改');
            // Save repair record changes too
            _saveRepairRecords().then(function() {
                closeHistoryEdit();
                _refreshHistory();
            }).catch(function() {
                closeHistoryEdit();
                _refreshHistory();
            });
        });
    }).catch(function() {
        showToast('修改失败，请检查网络');
    });
}
// 历史记录 — 模式切换（简易/详细）
let currentHistoryMode = 'simple';
function _getHistoryTableId(){ return currentHistoryMode === 'detail' ? '#history-table-detail' : '#history-table'; }
function switchHistoryModeBtn(mode) {
    currentHistoryMode = mode;
    document.getElementById('history-table').style.display = mode === 'simple' ? '' : 'none';
    document.getElementById('history-table-detail').style.display = mode === 'detail' ? '' : 'none';
    var wrapper = document.getElementById('history-table-detail-wrapper');
    if (wrapper) wrapper.style.display = mode === 'detail' ? '' : 'none';
    var box = document.querySelector('#history-table').closest('.box');
    if (box) {
        box.querySelectorAll('.mode-btn-group .mode-btn').forEach(function(b) {
            b.classList.toggle('active', b.dataset.mode === mode);
        });
    }
    if (document.getElementById('history-batch-mode').checked) {
        toggleHistoryBatchMode();
    }
    _setLS('historyMode', mode);
}
// 历史记录 — 批量操作
let histBatchMode = false;
function toggleHistoryBatchMode(){
    const on = document.getElementById('history-batch-mode').checked;
    histBatchMode = on;
    ['#history-table', '#history-table-detail'].forEach(function(tid){
        document.querySelectorAll(tid+' .hist-batch-col').forEach(c=>c.style.display=on?'table-cell':'none');
        document.querySelectorAll(tid+' .hist-op-cell').forEach(c=>c.style.display=on?'none':'');
    });
    ['hist-op-header', 'hist-op-header-detail'].forEach(function(id){
        var el = document.getElementById(id);
        if(el) el.style.display = on ? 'none' : '';
    });
    document.getElementById('history-batch-actions').style.display = on ? '' : 'none';
    if(on){
        updateBatchCount();
    } else {
        _histBatchSet.clear();
        ['hist-check-all', 'hist-check-all-detail'].forEach(function(id){
            var cb = document.getElementById(id);
            if(cb) cb.checked = false;
        });
        document.querySelectorAll('.hist-check').forEach(cb=>cb.checked=false);
        updateBatchCount();
    }
}
function toggleHistSelectAll(){
    var allCb = currentHistoryMode === 'detail' ? document.getElementById('hist-check-all-detail') : document.getElementById('hist-check-all');
    if (!allCb) return;
    var all = allCb.checked;
    var filtered = _getFilteredAndSortedHistory();
    document.querySelectorAll('.hist-check').forEach(function(cb) {
        cb.checked = all;
    });
    if (all) {
        for (var i = 0; i < filtered.length; i++) {
            var s = filtered[i];
            var hid = (s.record_type === 'task_only') ? ('t' + s.task_id) : String(s.id);
            _histBatchSet.add(hid);
        }
    } else {
        for (var i = 0; i < filtered.length; i++) {
            var s2 = filtered[i];
            var hid2 = (s2.record_type === 'task_only') ? ('t' + s2.task_id) : String(s2.id);
            _histBatchSet.delete(hid2);
        }
    }
    updateBatchCount();
}
function updateBatchCount(){
    document.querySelectorAll('.hist-check').forEach(function(cb) {
        var hid = cb.dataset.hid;
        if (cb.checked) {
            _histBatchSet.add(hid);
        } else {
            _histBatchSet.delete(hid);
        }
    });
    document.getElementById('batch-count').textContent = '已选 ' + _histBatchSet.size + ' 条';
}
function _getCheckedHistIds(){
    return Array.from(_histBatchSet);
}
function batchRecallHistory(){
    var ids = _getCheckedHistIds();
    if(ids.length===0){ showToast('请先选择记录'); return; }
    var scheduleIds = [];
    var taskIds = [];
    ids.forEach(function(hid) {
        if (typeof hid === 'string' && hid.charAt(0) === 't') {
            taskIds.push(parseInt(hid.substring(1), 10));
        } else {
            scheduleIds.push(parseInt(hid, 10));
        }
    });
    var totalCount = scheduleIds.length + taskIds.length;
    if (totalCount === 0) { showToast('请先选择记录'); return; }
    var payload = {};
    if (scheduleIds.length > 0) payload.scheduleIds = scheduleIds;
    if (taskIds.length > 0) payload.taskIds = taskIds;
    payload.confirmTitle = '批量回收';
    payload.confirmMsg = '确定回收 ' + totalCount + ' 条记录？';
    payload.onSuccess = _refreshHistory;
    recycleTasks(payload);
}
function batchDeleteHistory(){
    var ids = _getCheckedHistIds();
    if(ids.length===0){ showToast('请先选择记录'); return; }
    showConfirm('批量删除', '<span style="color:#f56c6c;">确定删除 '+ids.length+' 条排班记录？此操作不可恢复！</span>').then(function(ok){
        if(!ok) return;
        Promise.all(ids.map(function(id){
            return fetch('/del_schedule/'+id).then(function(r){ return r.json(); });
        })).then(function(results){
            showToast('已删除 ' + ids.length + ' 条');
            _refreshHistory();
        });
    });
}

document.addEventListener('DOMContentLoaded', ()=>{
    document.querySelectorAll('.hist-check').forEach(c=>c.addEventListener('change', updateBatchCount));
    // 历史记录日期筛选：change+input 双保险，选完日期立即触发
    var hdf = document.getElementById('history-date-from');
    var hdt = document.getElementById('history-date-to');
    if(hdf){ hdf.addEventListener('change', filterHistory); hdf.addEventListener('input', filterHistory); }
    if(hdt){ hdt.addEventListener('change', filterHistory); hdt.addEventListener('input', filterHistory); }
    // 表头排序点击
    document.querySelectorAll('#history-table th.sortable, #history-table-detail th.sortable').forEach(function(th) {
        th.addEventListener('click', function() {
            var col = th.dataset.sort;
            if (histSortState.column === col) {
                histSortState.direction = (histSortState.direction + 1) % 3;
            } else {
                histSortState.column = col;
                histSortState.direction = 1;
            }
            _updateHistSortIndicators();
            filterHistoryTable();
        });
    });
    // 恢复历史记录模式
    try{
        const saved = localStorage.getItem('historyMode');
        if(saved === 'detail'){
            switchHistoryModeBtn('detail');
        }
    }catch(e){}
});

// ========== 已完成任务包 ==========
var HISTORY_PACKAGES = [];

function _loadHistoryPackages() {
    fetch('/api/task_packages?completed=true')
        .then(function(r) { return r.json(); })
        .then(function(d) {
            HISTORY_PACKAGES = d.packages || [];
            _renderHistoryPackages();
        })
        .catch(function() {
            // 静默失败，历史记录主表格不受影响
            var grid = document.getElementById('history-packages-grid');
            if (grid) grid.innerHTML = '';
        });
}

var _histExpandedPackageId = null;

function _renderHistoryPackages() {
    var grid = document.getElementById('history-packages-grid');
    if (!grid) return;

    if (HISTORY_PACKAGES.length === 0) {
        grid.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px;font-size:13px;">暂无已完成的任务包</div>';
        _histExpandedPackageId = null;
        return;
    }

    var colors = ['#f59e0b', '#3b82f6', '#8b5cf6', '#06b6d4', '#f97316'];
    var html = '';

    for (var i = 0; i < HISTORY_PACKAGES.length; i++) {
        var p = HISTORY_PACKAGES[i];
        var color = colors[i % colors.length];
        var assignedPct = p.total > 0 ? Math.round(p.assigned / p.total * 100) : 0;
        var completedPct = p.total > 0 ? Math.round(p.completed / p.total * 100) : 0;
        var isAllDone = p.total > 0 && p.completed >= p.total;
        var isExpanded = _histExpandedPackageId === p.id;

        html += '<div class="pkg-card' + (isAllDone ? ' pkg-completed' : '') + '" style="border-left-color:' + color + '" onclick="toggleHistPackageCard(event, ' + p.id + ')">';
        html += '<div class="pkg-card-header">';
        html += '<div><div class="pkg-card-title">' + escHtml(p.name) + '</div>';
        html += '<div class="pkg-card-meta">' + escHtml(p.machine_type) + ' · ' + escHtml(p.priority || '') + (p.deadline ? ' · 截止 ' + escHtml(p.deadline) : ' · 无截止') + '</div></div>';
        html += '<div class="pkg-card-toggle">' + (isAllDone ? '已完成' : '进行中') + (isExpanded ? ' ▲' : ' ▼') + '</div></div>';
        html += '<div class="pkg-progress-section">';
        html += '<div class="pkg-progress-row"><span class="pkg-progress-label">已分配</span><div class="pkg-progress-bar-wrap"><div class="pkg-progress-bar assigned" style="width:' + assignedPct + '%"></div></div><span class="pkg-progress-count">' + p.assigned + '/' + p.total + '</span></div>';
        html += '<div class="pkg-progress-row"><span class="pkg-progress-label">已完成</span><div class="pkg-progress-bar-wrap"><div class="pkg-progress-bar completed" style="width:' + completedPct + '%"></div></div><span class="pkg-progress-count">' + p.completed + '/' + p.total + '</span></div></div>';
        if (isExpanded) {
            html += '<div class="pkg-expanded-body" id="hist-pkg-body-' + p.id + '" onclick="event.stopPropagation();">';
            html += '<div id="hist-pkg-tasks-table-' + p.id + '">加载中...</div>';
            html += '</div>';
        }
        html += '</div>';
    }

    grid.innerHTML = html;

    if (_histExpandedPackageId !== null) {
        _loadHistPackageTasks(_histExpandedPackageId);
    }
}

function toggleHistPackageCard(ev, packageId) {
    if (ev.target.tagName === 'BUTTON' || ev.target.tagName === 'INPUT') return;
    if (_histExpandedPackageId === packageId) {
        _histExpandedPackageId = null;
    } else {
        _histExpandedPackageId = packageId;
    }
    _renderHistoryPackages();
}

function _loadHistPackageTasks(packageId) {
    fetch('/api/task_packages/' + packageId + '/tasks')
        .then(function(r) { return r.json(); })
        .then(function(d) {
            var tasks = (d.tasks || []).filter(function(t) { return t.status === '已完成'; });
            var tableEl = document.getElementById('hist-pkg-tasks-table-' + packageId);
            if (!tableEl) return;
            if (tasks.length === 0) {
                tableEl.innerHTML = '<div style="padding:12px;color:var(--text-muted);text-align:center;">此包暂无已完成任务</div>';
                return;
            }
            var html = '<table style="width:100%;font-size:12px;border-collapse:collapse;"><thead><tr style="color:var(--text-muted);border-bottom:1px solid var(--border);">';
            html += '<th style="text-align:left;padding:6px;">任务名</th><th>机型</th><th>优先级</th><th>状态</th><th>预估</th></tr></thead><tbody>';
            for (var i = 0; i < tasks.length; i++) {
                var t = tasks[i];
                var durDisplay = t.est_seconds ? Math.round(t.est_seconds / 60) + '分' : (t.duration || '');
                html += '<tr style="border-bottom:1px solid var(--border-light);">';
                html += '<td style="padding:6px">' + escHtml(t.name) + '</td>';
                html += '<td>' + escHtml(t.type) + '</td>';
                html += '<td>' + escHtml(t.priority || '') + '</td>';
                html += '<td><span style="color:' + (_statusColor(t.status)) + '">' + escHtml(t.status) + '</span></td>';
                html += '<td>' + durDisplay + '</td></tr>';
            }
            html += '</tbody></table>';
            tableEl.innerHTML = html;
        });
}
