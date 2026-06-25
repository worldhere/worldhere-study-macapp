// golden scheduling app — task table rendering, sorting, filtering, pagination
// 依赖：core.js, task-status.js, task-pool.js

// ========== 数据与分页状态 ==========
var TASKS_DATA = [];
var TASK_PACKAGES = [];
var _expandedPackageId = null;
var _expandedGroups = {};  // { split_group: true/false }

// ========== 多段任务分组 ==========
function _baseTaskName(name) {
    return (name || '').replace(/（第[一二三四五六七八九十]+段）$/, '');
}

function _aggregateStatus(segments) {
    var allSame = true;
    var first = segments[0].status;
    for (var i = 1; i < segments.length; i++) {
        if (segments[i].status !== first) { allSame = false; break; }
    }
    if (allSame) return first;
    for (var i = 0; i < segments.length; i++) {
        if (segments[i].status === '采集中') return '采集中';
        if (segments[i].status === '暂停中') return '暂停中';
        if (segments[i].status === '暂停即将超时') return '暂停即将超时';
        if (segments[i].status === '采集即将完成') return '采集即将完成';
    }
    return '执行中';
}

// 将 pageItems 展平为带有 type 标记的行数组
function _buildFlatRows(pageItems) {
    var groups = {};
    var standalone = [];
    var groupOrder = [];

    for (var i = 0; i < pageItems.length; i++) {
        var t = pageItems[i];
        if (t.split_group) {
            if (!groups[t.split_group]) {
                groups[t.split_group] = [];
                groupOrder.push(t.split_group);
            }
            groups[t.split_group].push(t);
        } else {
            standalone.push(t);
        }
    }

    for (var g in groups) {
        groups[g].sort(function(a, b) { return (a.split_order || 0) - (b.split_order || 0); });
    }

    var flat = [];
    // 先放独立任务
    standalone.forEach(function(t) { flat.push({ type: 'task', task: t }); });

    // 再放分组
    groupOrder.forEach(function(g) {
        var segs = groups[g];
        var nonCompleted = segs.filter(function(s) { return s.status !== '已完成'; });
        if (nonCompleted.length === 0) return;
        var displaySegs = nonCompleted;
        flat.push({
            type: 'parent',
            group: g,
            segments: displaySegs,
            totalSegments: segs.length,
            baseName: _baseTaskName(displaySegs[0].name),
            aggStatus: _aggregateStatus(displaySegs)
        });
        if (_expandedGroups[g]) {
            displaySegs.forEach(function(seg) {
                flat.push({ type: 'child', group: g, task: seg });
            });
        }
    });

    return flat;
}

function toggleTaskGroup(group) {
    _expandedGroups[group] = !_expandedGroups[group];
    _renderTaskPage();
}

function batchRecallGroup(group) {
    var tasks = TASKS_DATA.filter(function(t) { return t.split_group === group && t.status !== '已完成'; });
    if (tasks.length === 0) return;
    if (!confirm('确定回收「' + _baseTaskName(tasks[0].name) + '」的全部 ' + tasks.length + ' 段吗？')) return;
    var ids = tasks.map(function(t) { return t.id; });
    fetch('/recall_tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_ids: ids }),
    })
    .then(function(r) { return r.json(); })
    .then(function(d) {
        showToast(d.msg);
        _silentRefresh();
    });
}

function batchCompleteGroup(group) {
    var tasks = TASKS_DATA.filter(function(t) { return t.split_group === group && t.status !== '已完成'; });
    if (tasks.length === 0) return;
    if (!confirm('确定将「' + _baseTaskName(tasks[0].name) + '」的全部 ' + tasks.length + ' 段标记为完成吗？')) return;
    var count = 0;
    var total = tasks.length;
    function next() {
        if (count >= total) { _silentRefresh(); showToast('批量完成完成'); return; }
        var tid = tasks[count].id;
        count++;
        fetch('/finish_task', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ task_id: tid }),
        }).then(function() { next(); }).catch(function() { next(); });
    }
    next();
}
var _taskPage = 0;
var _taskPageSize = (function(){
    try { var v = parseInt(localStorage.getItem('taskPageSize'), 10); return (v === 20 || v === 50 || v === 100) ? v : 20; }
    catch(e) { return 20; }
})();
var _taskBatchSet = new Set();
var _taskScheduleMap = {};

function getTaskById(tid) {
    for (var i = 0; i < TASKS_DATA.length; i++) {
        if (TASKS_DATA[i].id === tid) return TASKS_DATA[i];
    }
    return null;
}

// ========== 搜索、排序、高亮 ==========
var taskSortState = { column: null, direction: 0 }; // 0=none, 1=asc, 2=desc
var STATUS_SORT_ORDER = ['待分配','已分配','采集中','采集即将完成','暂停中','暂停即将超时','过时待确认','已完成'];

function _getTaskSearchTerm() {
    var inp = document.getElementById('task-search');
    return inp ? inp.value.trim().toLowerCase() : '';
}

function clearTaskSearch() {
    var inp = document.getElementById('task-search');
    if (inp) { inp.value = ''; inp.focus(); }
    applyTaskFilters();
}

// 公共排序工具：对数组 arr 按 colKey 和 dir 排序
function _sortTaskData(arr, colKey, dir) {
    if (!arr.length || dir === 0) return;
    arr.sort(function(a, b) {
        var av, bv;
        if (colKey === 'status') {
            av = STATUS_SORT_ORDER.indexOf(a.status); if (av === -1) av = 999;
            bv = STATUS_SORT_ORDER.indexOf(b.status); if (bv === -1) bv = 999;
        } else if (colKey === 'dur') {
            av = a.est_seconds != null ? a.est_seconds : (a.est_minutes != null ? a.est_minutes * 60 : 0);
            bv = b.est_seconds != null ? b.est_seconds : (b.est_minutes != null ? b.est_minutes * 60 : 0);
        } else if (colKey === 'name') { av = a.name || ''; bv = b.name || ''; }
        else if (colKey === 'type') { av = a.type || ''; bv = b.type || ''; }
        else if (colKey === 'kind') { av = a.task_kind || ''; bv = b.task_kind || ''; }
        else if (colKey === 'pri') { av = a.priority || ''; bv = b.priority || ''; }
        else if (colKey === 'diff') { av = a.difficulty || ''; bv = b.difficulty || ''; }
        else { av = a[colKey] || ''; bv = b[colKey] || ''; }
        if (typeof av === 'string') { var cmp = av.localeCompare(bv); return dir === 1 ? cmp : -cmp; }
        return dir === 1 ? av - bv : bv - av;
    });
}

function _updateSortIndicators() {
    document.querySelectorAll('#task-table th.sortable .sort-indicator, #task-table-detail th.sortable .sort-indicator').forEach(function(sp) {
        sp.textContent = '';
    });
    if (taskSortState.direction === 0) return;
    var arrow = taskSortState.direction === 1 ? ' ▲' : ' ▼';
    document.querySelectorAll('#task-table th.sortable[data-sort="' + taskSortState.column + '"] .sort-indicator, #task-table-detail th.sortable[data-sort="' + taskSortState.column + '"] .sort-indicator').forEach(function(sp) {
        sp.textContent = arrow;
    });
}

function _taskMatchesSearch(t, term) {
    if (!term) return true;
    var fields = [t.name, t.type, t.task_kind, t.rbp_task_id, t.priority || '', t.difficulty || '', t.remark || '', t.scene || '', t.general_category || ''];
    for (var i = 0; i < fields.length; i++) {
        if (fields[i].toLowerCase().indexOf(term) !== -1) return true;
    }
    return false;
}

function _getFilteredAndSortedTasks() {
    var ft = _taskFilterState.type;
    var fk = _taskFilterState.kind;
    var fs = _taskFilterState.status;
    var searchTerm = _getTaskSearchTerm();

    var filtered = [];
    for (var i = 0; i < TASKS_DATA.length; i++) {
        var t = TASKS_DATA[i];
        if (t.status === '已完成' || t.status === '已确认') continue;
        if (ft.length > 0 && ft.indexOf(t.type) < 0) continue;
        if (fk.length > 0 && fk.indexOf(t.task_kind) < 0) continue;
        if (fs.length > 0 && fs.indexOf(t.status) < 0) continue;
        filtered.push(t);
    }

    var matching = [];
    if (searchTerm) {
        for (var i = 0; i < filtered.length; i++) {
            if (_taskMatchesSearch(filtered[i], searchTerm)) {
                matching.push(filtered[i]);
                // 如果命中项有 split_group，把该组所有段也加进来
                if (filtered[i].split_group) {
                    var g2 = filtered[i].split_group;
                    for (var j = 0; j < filtered.length; j++) {
                        if (filtered[j].split_group === g2 && matching.indexOf(filtered[j]) < 0) {
                            matching.push(filtered[j]);
                        }
                    }
                }
            }
        }
    } else {
        matching = filtered;
    }

    if (taskSortState.direction > 0 && taskSortState.column) {
        _sortTaskData(matching, taskSortState.column, taskSortState.direction);
    }

    return matching;
}

// ========== 任务表格客户端渲染 ==========
function _buildTaskScheduleMap(){
    var map = {};
    schedules.forEach(function(s){
        var tid = s.task_id;
        if(tid == null || s.status === 'completed') return;
        if(!map[tid]){
            var mn = (s.machine_name || '').replace(/\(.*\)/,'').trim();
            map[tid] = { machine_name: mn + '(' + (s.task_type||'') + '/' + (s.task_kind||'') + ')', absStart: s.abs_start_min, absEnd: s.abs_end_min };
        }
    });
    return map;
}

function _valOr(v, fallback) { return v != null ? v : (fallback || ''); }

// ========== 分页渲染 ==========
function _renderTaskPage() {
    var filtered = _getFilteredAndSortedTasks();
    var totalFiltered = filtered.length;
    var totalPages = Math.max(1, Math.ceil(totalFiltered / _taskPageSize));

    if (_taskPage >= totalPages) _taskPage = totalPages - 1;
    if (_taskPage < 0) _taskPage = 0;

    var start = _taskPage * _taskPageSize;
    var end = Math.min(start + _taskPageSize, totalFiltered);
    var pageItems = filtered.slice(start, end);

    _renderTaskTableRows(pageItems, start, totalFiltered);
    _renderPaginationBar(totalFiltered, totalPages);
    _updateSortIndicators();
}

function _renderTaskTableRows(pageItems, startOffset, totalFiltered) {
    var batchOn = document.getElementById('task-batch-mode') && document.getElementById('task-batch-mode').checked;
    var showActionCol = !document.getElementById('show-action-col') || document.getElementById('show-action-col').checked;
    var actionDisplay = showActionCol ? '' : 'display:none;';

    // 分组处理
    var flatRows = _buildFlatRows(pageItems);
    // 搜索模式下：确保匹配的段所在组全部展开
    var searchTerm = _getTaskSearchTerm();
    if (searchTerm) {
        for (var fi = 0; fi < flatRows.length; fi++) {
            if (flatRows[fi].type === 'parent') {
                // 如果父行在 flatRows 中，说明它的某个段在当前页，展开它
                if (!_expandedGroups[flatRows[fi].group]) {
                    // search doesn't auto-expand — only explicit click
                }
            }
        }
    }

    var simpleHtml = '';
    var seq = startOffset;
    for (var i = 0; i < flatRows.length; i++) {
        var row = flatRows[i];
        if (row.type === 'parent') {
            var segs = row.segments;
            var firstSeg = segs[0];
            var dates = [];
            for (var di = 0; di < segs.length; di++) {
                var d = segs[di].date;
                if (d && dates.indexOf(d) < 0) dates.push(d);
            }
            dates.sort();
            var timeRange = dates.length > 0 ? (dates[0] + '~' + dates[dates.length-1].slice(5)) : '';
            var totalExpected = 0;
            for (var ei = 0; ei < segs.length; ei++) {
                totalExpected += (parseInt(segs[ei].expected_count) || 0);
            }
            var expanded = _expandedGroups[row.group];
            var arrow = expanded ? '▼' : '▶';
            var durDisplay = '';
            if (firstSeg.est_seconds != null) { durDisplay = Math.round(firstSeg.est_seconds / 60); }
            else if (firstSeg.est_minutes != null) { durDisplay = firstSeg.est_minutes; }
            seq++;
            simpleHtml += '<tr class="task-parent-row" data-group="' + row.group + '" style="background:#f1f5ff;cursor:pointer;" onclick="toggleTaskGroup(\'' + row.group + '\')">' +
                '<td class="batch-col" style="display:' + (batchOn?'':'none') + ';"></td>' +
                '<td class="seq-col">' + seq + '</td>' +
                '<td style="font-weight:600;">' + arrow + ' ' + escHtml(row.baseName) + ' <span style="color:#7c3aed;font-size:10px;">（' + row.totalSegments + '段）</span></td>' +
                '<td>' + escHtml(firstSeg.type) + '</td>' +
                '<td>' + escHtml(firstSeg.task_kind) + '</td>' +
                '<td>' + escHtml(firstSeg.priority||'') + '</td>' +
                '<td>' + escHtml(firstSeg.difficulty||'') + '</td>' +
                '<td class="dur-cell">' + durDisplay + '</td>' +
                '<td><span class="task-status-text" style="color:' + _statusColor(row.aggStatus) + ';font-weight:500;">' + escHtml(row.aggStatus) + '</span></td>' +
                '<td style="font-size:11px;">' + escHtml(timeRange) + '</td>' +
                '<td class="action-btns" style="' + actionDisplay + '">' +
                    '<button class="btn" onclick="event.stopPropagation();batchRecallGroup(\'' + row.group + '\')" style="font-size:10px;">批量回收</button>' +
                    '<button class="btn" onclick="event.stopPropagation();batchCompleteGroup(\'' + row.group + '\')" style="font-size:10px;">批量完成</button>' +
                '</td></tr>';
        } else if (row.type === 'child') {
            var t = row.task;
            seq++;
            var durDisp2 = '';
            if (t.est_seconds != null) { durDisp2 = Math.round(t.est_seconds / 60); }
            else if (t.est_minutes != null) { durDisp2 = t.est_minutes; }
            var schInfo2 = _taskScheduleMap[t.id];
            var assignedDisp2 = '';
            if (schInfo2 && schInfo2.absStart !== undefined && schInfo2.absEnd !== undefined) {
                assignedDisp2 = schInfo2.machine_name + ' ' + (typeof _formatAbsRange === 'function' ? _formatAbsRange(schInfo2.absStart, schInfo2.absEnd) : '');
            }
            var checked = _taskBatchSet.has(t.id) ? ' checked' : '';
            simpleHtml += '<tr data-tid="' + t.id + '" class="task-child-row" data-group="' + row.group + '" style="background:#faf5ff;"' +
                ' data-status="' + escHtml(t.status||'') + '" data-type="' + escHtml(t.type||'') + '" data-kind="' + escHtml(t.task_kind||'') + '"' +
                ' data-split-group="' + escHtml(t.split_group||'') + '" data-split-order="' + (t.split_order||'') + '">' +
                '<td class="batch-col" style="display:' + (batchOn?'':'none') + ';"></td>' +
                '<td class="seq-col">' + seq + '</td>' +
                '<td style="padding-left:24px;color:#7c3aed;font-size:11px;">└ ' + escHtml(t.name) + '</td>' +
                '<td>' + escHtml(t.type) + '</td>' +
                '<td>' + escHtml(t.task_kind) + '</td>' +
                '<td>' + escHtml(t.priority||'') + '</td>' +
                '<td>' + escHtml(t.difficulty||'') + '</td>' +
                '<td class="dur-cell">' + durDisp2 + '</td>' +
                '<td><span class="task-status-text" data-tid="' + t.id + '" data-orig="' + escHtml(t._origStatus||t.status||'') + '" style="color:' + _statusColor(t.status) + '">' + escHtml(t.status) + '</span></td>' +
                '<td style="font-size:11px;">' + escHtml(assignedDisp2) + '</td>' +
                '<td class="action-btns" style="' + actionDisplay + '">' +
                    '<button class="btn" onclick="openEditDrawer(' + t.id + ')" style="font-size:10px;">修改</button>' +
                    '<button onclick="recallTaskToPool(' + t.id + ')" style="font-size:10px;">回收</button>' +
                    '<button onclick="finishTaskFromList(' + t.id + ')" style="font-size:10px;">完成</button>' +
                    '<button class="btn-danger" onclick="delTask(' + t.id + ')" style="font-size:10px;">删除</button>' +
                '</td></tr>';
        } else {
            // 普通独立任务
            var t = row.task;
            seq++;
            var durDisp3 = '';
            if (t.est_seconds != null) { durDisp3 = Math.round(t.est_seconds / 60); }
            else if (t.est_minutes != null) { durDisp3 = t.est_minutes; }
            var schInfo3 = _taskScheduleMap[t.id];
            var assignedDisp3 = '';
            if (schInfo3 && schInfo3.absStart !== undefined && schInfo3.absEnd !== undefined) {
                assignedDisp3 = schInfo3.machine_name + ' ' + (typeof _formatAbsRange === 'function' ? _formatAbsRange(schInfo3.absStart, schInfo3.absEnd) : '');
            }
            var checked = _taskBatchSet.has(t.id) ? ' checked' : '';
            simpleHtml += '<tr data-tid="' + t.id + '" data-status="' + escHtml(t.status||'') + '" data-type="' + escHtml(t.type||'') + '" data-kind="' + escHtml(t.task_kind||'') + '" data-split-group="' + escHtml(t.split_group||'') + '" data-split-order="' + (t.split_order||'') + '">' +
                '<td class="batch-col" style="display:' + (batchOn?'':'none') + ';"><input type="checkbox" class="batch-check" data-tid="' + t.id + '" onchange="updateTaskBatchCount()"' + checked + '></td>' +
                '<td class="seq-col">' + seq + '</td>' +
                '<td>' + escHtml(t.name) + '</td>' +
                '<td>' + escHtml(t.type) + '</td>' +
                '<td>' + escHtml(t.task_kind) + '</td>' +
                '<td>' + escHtml(t.priority||'') + '</td>' +
                '<td>' + escHtml(t.difficulty||'') + '</td>' +
                '<td class="dur-cell">' + durDisp3 + '</td>' +
                '<td><span class="task-status-text" data-tid="' + t.id + '" data-orig="' + escHtml(t._origStatus||t.status||'') + '" style="color:' + _statusColor(t.status) + '">' + escHtml(t.status) + '</span></td>' +
                '<td style="font-size:11px;">' + escHtml(assignedDisp3) + '</td>' +
                '<td class="action-btns" style="' + actionDisplay + '">' +
                    '<button class="btn" onclick="openAssignDialog(' + t.id + ')">指派</button>' +
                    '<button onclick="recallTaskToPool(' + t.id + ')">回收</button>' +
                    '<button onclick="finishTaskFromList(' + t.id + ')">已完成</button>' +
                    '<button onclick="openEditDrawer(' + t.id + ')">修改</button>' +
                    '<button class="btn-danger" onclick="delTask(' + t.id + ')">删除</button>' +
                '</td></tr>';
        }
    }
    var simpleTbody = document.querySelector('#task-table tbody');
    if (simpleTbody) { simpleTbody.innerHTML = simpleHtml; }

    // === 详细表格 ===
    var detailHtml = '';
    for (var i = 0; i < pageItems.length; i++) {
        var t = pageItems[i];
        var seq = startOffset + i + 1;
        var checked = _taskBatchSet.has(t.id) ? ' checked' : '';
        detailHtml += '<tr data-tid="' + t.id + '" data-orig-index="' + i + '" data-status="' + escHtml(t.status||'') + '" data-type="' + escHtml(t.type||'') + '" data-kind="' + escHtml(t.task_kind||'') + '" data-sec="' + (t.est_seconds||'') + '" data-name="' + escHtml(t.name||'') + '" data-pri="' + escHtml(t.priority||'') + '" data-diff="' + escHtml(t.difficulty||'') + '" data-dur="' + escHtml(t.duration||'') + '" data-estmode="' + (t.est_mode||'blank') + '" data-op="' + (t.op_min||'') + '" data-reset="' + (t.reset_min||'') + '" data-cnt="' + _valOr(t.collect_count) + '" data-red="' + (t.redundancy_min||'') + '" data-remark="' + escHtml(t.remark||'') + '" data-rbp="' + escHtml(t.rbp_task_id||'') + '" data-scene="' + escHtml(t.scene||'') + '" data-gcat="' + escHtml(t.general_category||'') + '" data-slink="' + escHtml(t.source_link||'') + '" data-expcnt="' + _valOr(t.expected_count) + '" data-creqid="' + escHtml(t.collection_req_id||'') + '" data-creqtype="' + escHtml(t.collection_req_type||'') + '" data-split-group="' + escHtml(t.split_group||'') + '" data-split-order="' + (t.split_order||'') + '">' +
            '<td class="batch-col" style="display:' + (batchOn?'':'none') + ';"><input type="checkbox" class="batch-check" data-tid="' + t.id + '" onchange="updateTaskBatchCount()"' + checked + '></td>' +
            '<td class="seq-col">' + seq + '</td>' +
            '<td>' + escHtml(t.name) + '</td>' +
            '<td>' + escHtml(t.type) + '</td>' +
            '<td>' + escHtml(t.priority||'') + '</td>' +
            '<td>' + escHtml(t.rbp_task_id||'') + '</td>' +
            '<td><span class="task-status-text" data-tid="' + t.id + '" data-orig="' + escHtml(t._origStatus||t.status||'') + '" style="color:' + _statusColor(t.status) + '">' + escHtml(t.status) + '</span></td>' +
            '<td>' + escHtml(t.scene||'') + '</td>' +
            '<td>' + escHtml(t.task_kind) + '</td>' +
            '<td>' + escHtml(t.general_category||'') + '</td>' +
            '<td>' + (t.source_link ? '<a href="' + escHtml(t.source_link) + '" target="_blank" style="color:#1976d2;">链接</a>' : '') + '</td>' +
            '<td>' + (t.expected_count || '') + '</td>' +
            '<td>' + (t.collection_req_id || '') + '</td>' +
            '<td>' + (t.collection_req_type || '') + '</td>' +
            '<td class="action-btns" style="' + actionDisplay + '">' +
                '<button class="btn" onclick="openAssignDialog(' + t.id + ')">指派</button>' +
                '<button onclick="recallTaskToPool(' + t.id + ')">回收</button>' +
                '<button onclick="finishTaskFromList(' + t.id + ')">已完成</button>' +
                '<button onclick="openEditDrawer(' + t.id + ')">修改</button>' +
                '<button class="btn-danger" onclick="delTask(' + t.id + ')">删除</button>' +
            '</td></tr>';
    }
    var detailTbody = document.querySelector('#task-table-detail tbody');
    if (detailTbody) { detailTbody.innerHTML = detailHtml; }
}

function _renderPaginationBar(totalFiltered, totalPages) {
    var bar = document.getElementById('task-pagination-bar');
    if (!bar) return;

    var totalAll = TASKS_DATA.length;
    var html = '';

    html += '<button class="page-btn" onclick="taskGoToPage(' + (_taskPage - 1) + ')"' + (_taskPage <= 0 ? ' disabled' : '') + '>← 上一页</button>';

    var maxVisible = 7;
    if (totalPages <= maxVisible) {
        for (var p = 0; p < totalPages; p++) {
            html += '<button class="page-btn' + (p === _taskPage ? ' page-current' : '') + '" onclick="taskGoToPage(' + p + ')">' + (p + 1) + '</button>';
        }
    } else {
        html += '<button class="page-btn' + (0 === _taskPage ? ' page-current' : '') + '" onclick="taskGoToPage(0)">1</button>';
        var startP = Math.max(1, _taskPage - 2);
        var endP = Math.min(totalPages - 2, _taskPage + 2);
        if (startP > 1) html += '<span class="page-ellipsis">...</span>';
        for (var p = startP; p <= endP; p++) {
            html += '<button class="page-btn' + (p === _taskPage ? ' page-current' : '') + '" onclick="taskGoToPage(' + p + ')">' + (p + 1) + '</button>';
        }
        if (endP < totalPages - 2) html += '<span class="page-ellipsis">...</span>';
        var lastP = totalPages - 1;
        html += '<button class="page-btn' + (lastP === _taskPage ? ' page-current' : '') + '" onclick="taskGoToPage(' + lastP + ')">' + (lastP + 1) + '</button>';
    }

    html += '<button class="page-btn" onclick="taskGoToPage(' + (_taskPage + 1) + ')"' + (_taskPage >= totalPages - 1 ? ' disabled' : '') + '>下一页 →</button>';

    html += ' 每页 <select class="page-size-select" onchange="taskSetPageSize(this.value)">';
    html += '<option value="20"' + (_taskPageSize === 20 ? ' selected' : '') + '>20</option>';
    html += '<option value="50"' + (_taskPageSize === 50 ? ' selected' : '') + '>50</option>';
    html += '<option value="100"' + (_taskPageSize === 100 ? ' selected' : '') + '>100</option>';
    html += '</select>';

    html += ' <span class="page-summary">共 ' + totalAll + ' 条任务，筛选显示 ' + totalFiltered + ' 条，第 ' + (_taskPage + 1) + '/共 ' + totalPages + ' 页</span>';

    bar.innerHTML = html;
}

function taskGoToPage(p) {
    _taskPage = p;
    _renderTaskPage();
}

function taskSetPageSize(size) {
    _taskPageSize = parseInt(size, 10);
    _taskPage = 0;
    _setLS('taskPageSize', String(_taskPageSize));
    _renderTaskPage();
}

function _refreshTaskList(){
    _taskBatchSet.clear();
    updateTaskBatchCount();
    fetch('/api/tasks')
    .then(function(r){ return r.json(); })
    .then(function(d){
        TASKS_DATA = d.tasks;
        for (var i = 0; i < TASKS_DATA.length; i++) { TASKS_DATA[i]._origStatus = TASKS_DATA[i].status; }
        _taskPage = 0;
        _taskScheduleMap = _buildTaskScheduleMap();
        _renderTaskPool();
        buildSplitIndex();
        applyTaskFilters();
        refreshLiveStatus();
        toggleDurationUnit();
        _refreshTaskPackages();
    }).catch(function(e){
        console.error('任务列表加载失败:', e);
        showToast('任务列表加载失败，请检查网络或刷新页面');
    });
}

function _renderTaskTable(tasks){
    TASKS_DATA = tasks;
    for (var i = 0; i < TASKS_DATA.length; i++) { if (!TASKS_DATA[i]._origStatus) TASKS_DATA[i]._origStatus = TASKS_DATA[i].status; }
    _taskPage = 0;
    _taskScheduleMap = _buildTaskScheduleMap();
    _renderTaskPage();
    _renderTaskPool();
    buildSplitIndex();
}

function applyTaskFilters(){
    var searchInput = document.getElementById('task-search');
    var clearBtn = searchInput ? searchInput.parentElement.querySelector('.search-clear') : null;
    if (clearBtn) {
        clearBtn.classList.toggle('visible', (searchInput.value || '').trim().length > 0);
    }

    _taskPage = 0;
    _taskSyncFilterUI();
    _renderTaskPage();

    var showActionCol = document.getElementById('show-action-col').checked;
    document.querySelectorAll('#task-table .action-col, #task-table-detail .action-col').forEach(function(th) {
        th.style.display = showActionCol ? '' : 'none';
    });
    document.querySelectorAll('#task-table .action-btns, #task-table-detail .action-btns').forEach(function(td) {
        td.style.display = showActionCol ? '' : 'none';
    });
}

// 任务库模式切换（简易/详细）
var currentTaskMode = 'simple';
function _getTaskTableId(){ return currentTaskMode === 'detail' ? '#task-table-detail' : '#task-table'; }

function switchTaskModeBtn(mode) {
    currentTaskMode = mode;
    document.getElementById('task-table').style.display = mode === 'simple' ? '' : 'none';
    document.getElementById('task-table-detail').style.display = mode === 'detail' ? '' : 'none';
    document.getElementById('task-table-detail-wrapper').style.display = mode === 'detail' ? '' : 'none';
    document.querySelectorAll('#task-mode-btns .mode-btn').forEach(function(b) {
        b.classList.toggle('active', b.dataset.mode === mode);
    });
    if (document.getElementById('task-batch-mode').checked) {
        toggleTaskBatchMode();
    }
    if (typeof loadDeletionLog === 'function') loadDeletionLog();
    _setLS('taskMode', mode);
}

function toggleTaskBatchMode(){
    var on = document.getElementById('task-batch-mode').checked;
    var tid = _getTaskTableId();
    document.getElementById('task-batch-actions').style.display = on ? '' : 'none';
    document.querySelectorAll(tid+' .batch-col').forEach(function(el){ el.style.display = on ? '' : 'none'; });
    document.querySelectorAll(tid+' .action-btns').forEach(function(el){ el.style.display = on ? 'none' : ''; });
    document.querySelectorAll(tid+' .action-col').forEach(function(el){ el.style.display = on ? 'none' : ''; });
    if(on){
        updateTaskBatchCount();
    } else {
        _taskBatchSet.clear();
        document.querySelectorAll(tid+' .batch-check').forEach(function(cb){ cb.checked = false; });
        var allCb = currentTaskMode === 'detail' ? document.getElementById('detail-batch-check-all') : document.getElementById('batch-check-all');
        if(allCb) allCb.checked = false;
        updateTaskBatchCount();
    }
}

function toggleSelectAll(){
    var allCb = currentTaskMode === 'detail' ? document.getElementById('detail-batch-check-all') : document.getElementById('batch-check-all');
    if (!allCb) return;
    var all = allCb.checked;
    var filtered = _getFilteredAndSortedTasks();
    document.querySelectorAll('.batch-check').forEach(function(cb) {
        cb.checked = all;
    });
    if (all) {
        for (var i = 0; i < filtered.length; i++) {
            _taskBatchSet.add(filtered[i].id);
        }
    } else {
        for (var i = 0; i < filtered.length; i++) {
            _taskBatchSet.delete(filtered[i].id);
        }
    }
    updateTaskBatchCount();
}

function updateTaskBatchCount(){
    document.querySelectorAll('.batch-check').forEach(function(cb) {
        var tid = parseInt(cb.dataset.tid, 10);
        if (cb.checked) {
            _taskBatchSet.add(tid);
        } else {
            _taskBatchSet.delete(tid);
        }
    });
    document.getElementById('task-batch-count').textContent = '已选 ' + _taskBatchSet.size + ' 项';
}

function batchAction(action){
    var ids = Array.from(_taskBatchSet);
    if (ids.length === 0) { alert('请至少选择一个任务'); return; }
    var labels = {recycle:'回收', complete:'完成', delete:'删除'};
    var label = labels[action]||action;
    showConfirm('批量操作', '<p>确定批量'+label+' '+ids.length+' 个任务？</p>').then(function(ok){
        if(!ok) return;
        if(action === 'recycle'){
            recycleTasks({taskIds: ids, skipConfirm: true});
            return;
        }
        fetch('/batch_tasks',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action, ids})
    }).then(function(r){return r.json();}).then(function(d){
        showToast(d.msg);
        _silentRefresh();
    });
    });
}

function toggleDurationUnit(){
    var unit = document.getElementById('duration-unit').value;
    var labelMap = {sec:'预估时长(秒)', min:'预估时长(分钟)', hour:'预估时长(小时)'};
    var labelEl = document.getElementById('dur-header-label');
    if(labelEl) labelEl.textContent = labelMap[unit] || '预估时长';
    document.querySelectorAll('.dur-cell').forEach(function(td){
        var sec = parseInt(td.dataset.sec, 10);
        if(Number.isNaN(sec) || sec <= 0){ td.textContent = ''; return; }
        if(unit === 'sec') td.textContent = sec;
        else if(unit === 'hour') td.textContent = (sec/3600).toFixed(1);
        else td.textContent = Math.round(sec/60);
    });
    _setLS('durationUnit', unit);
}

// ========== 任务包模块 ==========

function _refreshTaskPackages() {
    fetch('/api/task_packages')
        .then(function(r) { return r.json(); })
        .then(function(d) {
            TASK_PACKAGES = d.packages || [];
            _renderTaskPackages();
            _renderTaskPool();
        });
}

function _renderTaskPackages() {
    var grid = document.getElementById('task-packages-grid');
    if (!grid) return;
    if (TASK_PACKAGES.length === 0) {
        grid.innerHTML = '<div class="pkg-card-dashed" onclick="openCreatePackageDialog()">+ 新建任务包<div style="font-size:11px;color:var(--text-muted);margin-top:4px;">导入 Excel · 手动创建 · 从任务库打包</div></div>';
        return;
    }
    var html = '';
    var colors = ['#f59e0b', '#3b82f6', '#8b5cf6', '#06b6d4', '#f97316'];
    for (var i = 0; i < TASK_PACKAGES.length; i++) {
        var p = TASK_PACKAGES[i];
        var color = colors[i % colors.length];
        var isCompleted = p.total > 0 && p.completed >= p.total;
        var isExpanded = _expandedPackageId === p.id;
        var cls = 'pkg-card';
        if (isCompleted) cls += ' pkg-completed';
        if (isExpanded) cls += ' pkg-expanded';
        var assignedPct = p.total > 0 ? Math.round(p.assigned / p.total * 100) : 0;
        var completedPct = p.total > 0 ? Math.round(p.completed / p.total * 100) : 0;
        html += '<div class="' + cls + '" style="border-left-color:' + color + '" onclick="togglePackageCard(event, ' + p.id + ')">';
        html += '<div class="pkg-card-header">';
        html += '<div><div class="pkg-card-title">' + escHtml(p.name) + '</div>';
        html += '<div class="pkg-card-meta">' + escHtml(p.machine_type) + ' · ' + escHtml(p.priority||'') + (p.deadline ? ' · 截止 ' + escHtml(p.deadline) : ' · 无截止') + '</div></div>';
        html += '<div class="pkg-card-toggle">' + (isCompleted ? '已完成' : (isExpanded ? '收起 ▲' : '展开 ▼')) + '</div></div>';
        html += '<div class="pkg-progress-section">';
        html += '<div class="pkg-progress-row"><span class="pkg-progress-label">已分配</span><div class="pkg-progress-bar-wrap"><div class="pkg-progress-bar assigned" style="width:' + assignedPct + '%"></div></div><span class="pkg-progress-count">' + p.assigned + '/' + p.total + '</span></div>';
        html += '<div class="pkg-progress-row"><span class="pkg-progress-label">已完成</span><div class="pkg-progress-bar-wrap"><div class="pkg-progress-bar completed" style="width:' + completedPct + '%"></div></div><span class="pkg-progress-count">' + p.completed + '/' + p.total + '</span></div></div>';
        if (isExpanded) {
            html += '<div class="pkg-expanded-body" id="pkg-body-' + p.id + '">';
            html += '<div class="pkg-expanded-toolbar">';
            html += '<button class="btn" onclick="event.stopPropagation();openEditPackageDialog(' + p.id + ')">编辑</button>';
            html += '<button style="background:var(--danger);color:white;border-color:var(--danger);" onclick="event.stopPropagation();deletePackage(' + p.id + ')">删除</button>';
            html += '<button class="btn" onclick="event.stopPropagation();openAddTasksToPackageDialog(' + p.id + ')" style="margin-left:auto;">+ 从任务库添加</button>';
            html += '<input type="text" placeholder="搜索此包内任务..." style="max-width:200px;" oninput="filterPackageTasks(' + p.id + ', this.value)" onclick="event.stopPropagation();">';
            html += '</div>';
            html += '<div id="pkg-tasks-table-' + p.id + '">加载中...</div>';
            html += '</div>';
        }
        html += '</div>';
    }
    html += '<div class="pkg-card-dashed" onclick="openCreatePackageDialog()">+ 新建任务包</div>';
    grid.innerHTML = html;

    if (_expandedPackageId !== null) {
        _loadPackageTasks(_expandedPackageId);
    }
}

function togglePackageCard(ev, packageId) {
    if (ev.target.tagName === 'BUTTON' || ev.target.tagName === 'INPUT') return;
    if (_expandedPackageId === packageId) {
        _expandedPackageId = null;
    } else {
        _expandedPackageId = packageId;
    }
    _renderTaskPackages();
}

function _loadPackageTasks(packageId) {
    fetch('/api/task_packages/' + packageId + '/tasks')
        .then(function(r) { return r.json(); })
        .then(function(d) {
            var tasks = d.tasks || [];
            var tableEl = document.getElementById('pkg-tasks-table-' + packageId);
            if (!tableEl) return;
            var html = '<table style="width:100%;font-size:12px;border-collapse:collapse;"><thead><tr style="color:var(--text-muted);border-bottom:1px solid var(--border);">';
            html += '<th style="text-align:left;padding:6px">任务名</th><th>机型</th><th>优先级</th><th>状态</th><th>预估</th></tr></thead><tbody>';
            for (var i = 0; i < tasks.length; i++) {
                var t = tasks[i];
                var durDisplay = t.est_seconds ? Math.round(t.est_seconds / 60) + '分' : (t.duration || '');
                var pkg = TASK_PACKAGES.find(function(pk) { return pk.id === packageId; });
                var pkgTag = pkg ? '<span class="pkg-tag-inline">📦 ' + escHtml(pkg.name) + '</span>' : '';
                html += '<tr style="border-bottom:1px solid var(--border-light);">';
                html += '<td style="padding:6px">' + pkgTag + escHtml(t.name) + '</td>';
                html += '<td>' + escHtml(t.type) + '</td>';
                html += '<td>' + escHtml(t.priority||'') + '</td>';
                html += '<td><span style="color:' + (_statusColor(t.status)) + '">' + escHtml(t.status) + '</span></td>';
                html += '<td>' + durDisplay + '</td></tr>';
            }
            html += '</tbody></table>';
            if (tasks.length === 0) html = '<div style="padding:12px;color:var(--text-muted);text-align:center;">此包暂无任务</div>';
            tableEl.innerHTML = html;
        });
}

function filterPackageTasks(packageId, term) {
    var tableEl = document.getElementById('pkg-tasks-table-' + packageId);
    if (!tableEl) return;
    var rows = tableEl.querySelectorAll('tbody tr');
    var t = (term||'').toLowerCase();
    rows.forEach(function(row) {
        row.style.display = t ? (row.textContent.toLowerCase().indexOf(t) >= 0 ? '' : 'none') : '';
    });
}
