// golden scheduling app — task pool (draggable task list)
// 依赖：core.js, task-status.js

function _renderTaskPool() {
    var itemsEl = document.getElementById('pool-task-items');
    if (!itemsEl) return;

    var pending = [];
    for (var i = 0; i < TASKS_DATA.length; i++) {
        if (TASKS_DATA[i].status === '待分配') pending.push(TASKS_DATA[i]);
    }
    var itemsHtml = '';
    for (var i = 0; i < pending.length; i++) {
        var t = pending[i];
        var typeIdx = typeof _typeIndex === 'function' ? _typeIndex(t.type) : 0;
        var durMin = t.est_seconds ? Math.round(t.est_seconds / 60) : 0;
        var durText = durMin > 0 ? ' ' + durMin + '分' : '';
        var pkgTag = '';
        if (t.package_id && window._showPackageName !== false) {
            var pkg = TASK_PACKAGES.find(function(pk) { return pk.id === t.package_id; });
            if (pkg) {
                var colors = ['#f59e0b','#3b82f6','#8b5cf6','#06b6d4','#f97316'];
                var ci = TASK_PACKAGES.findIndex(function(pk){return pk.id===pkg.id;}) % colors.length;
                pkgTag = '<span class="pkg-tag" style="background:' + colors[ci] + '15;color:' + colors[ci] + ';">📦' + escHtml(pkg.name.charAt(0)) + '</span>';
            }
        }
        itemsHtml += '<div class="task-draggable task-type-' + typeIdx + '" draggable="true" data-tid="' + t.id + '" data-type="' + escHtml(t.type) + '" data-kind="' + escHtml(t.task_kind || '') + '" data-pri="' + escHtml(t.priority || '') + '" data-diff="' + escHtml(t.difficulty || '') + '" data-sec="' + (t.est_seconds || '') + '" ondragstart="dragStart(event)" ondblclick="openEditDialog(' + t.id + ')">' + pkgTag + escHtml(t.name) + '(' + escHtml(t.type) + '/' + escHtml(t.task_kind) + ') ' + (t.priority ? '[' + escHtml(t.priority) + ']' : '') + durText + '</div>';
    }
    itemsEl.innerHTML = itemsHtml;
    _restorePoolModeState();
    filterTaskPool();
}

function filterTaskPool(){
    var ft = document.getElementById('pool-filter-type').value;
    var fp = document.getElementById('pool-filter-pri').value;
    var fd = document.getElementById('pool-filter-diff').value;
    document.querySelectorAll('#task-pool .task-draggable').forEach(function(el){
        var ty = el.dataset.type || '';
        var pri = el.dataset.pri || '';
        var diff = el.dataset.diff || '';
        var ok = true;
        if(ft) ok = ok && (ty === ft);
        if(fp) ok = ok && (pri === fp);
        if(fd) ok = ok && (diff === fd);
        el.style.display = ok ? '' : 'none';
    });
    _taskPoolPage = 0;
    if (typeof _renderPoolPagination === 'function') _renderPoolPagination();
}

// ========== 任务区模式：恢复、拖拽、分页 ==========
function _restorePoolModeState() {
    var pool = document.getElementById('task-pool');
    if (!pool) return;

    pool.classList.remove('pool-mode-below', 'pool-mode-fixed', 'pool-mode-floating');
    pool.classList.add('pool-mode-' + _taskPoolMode);

    if (_taskPoolMode === 'floating') {
        pool.style.setProperty('--pool-columns', '1');
        _enablePoolDrag();
        var controls = document.getElementById('pool-page-controls');
        if (controls) controls.style.display = 'none';
        var items = document.querySelectorAll('#pool-task-items .task-draggable');
        items.forEach(function(it) { it.style.display = ''; });
    } else {
        try {
            var _ss = JSON.parse(localStorage.getItem('schedule_settings') || '{}');
            var _cols = parseInt(_ss['pool_modern_columns'], 10) || 2;
            pool.style.setProperty('--pool-columns', _cols);
        } catch(_e) { pool.style.setProperty('--pool-columns', '2'); }
        // 清除浮动缩放遗留的内联宽高
        pool.style.width = '';
        pool.style.height = '';
        var controls = document.getElementById('pool-page-controls');
        if (controls) controls.style.display = 'none';
        var items = document.querySelectorAll('#pool-task-items .task-draggable');
        items.forEach(function(it) { it.style.display = ''; });
    }
}

var _poolDragActive = false;

function _enablePoolDrag() {
    var pool = document.getElementById('task-pool');
    var h4 = pool ? pool.querySelector('h4') : null;
    if (!h4 || h4.dataset.dragReady) return;
    h4.dataset.dragReady = '1';
    h4.style.cursor = 'move';
    h4.style.userSelect = 'none';
    var sx, sy, sl, st;
    h4.onmousedown = function(e) {
        if (e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT') return;
        _poolDragActive = true;
        sx = e.clientX; sy = e.clientY;
        sl = pool.offsetLeft; st = pool.offsetTop;
        function mm(ev) {
            if (!_poolDragActive) return;
            pool.style.left = (sl + ev.clientX - sx) + 'px';
            pool.style.top = (st + ev.clientY - sy) + 'px';
            pool.style.right = 'auto';
            pool.style.bottom = 'auto';
        }
        function mu() {
            _poolDragActive = false;
            document.removeEventListener('mousemove', mm);
            document.removeEventListener('mouseup', mu);
        }
        document.addEventListener('mousemove', mm);
        document.addEventListener('mouseup', mu);
        e.preventDefault();
    };
}

function _disablePoolDrag() {
    var pool = document.getElementById('task-pool');
    var h4 = pool ? pool.querySelector('h4') : null;
    if (h4) {
        h4.dataset.dragReady = '';
        h4.style.cursor = '';
        h4.style.userSelect = '';
        h4.onmousedown = null;
    }
    _poolDragActive = false;
}

function _renderPoolPagination() {
    var controls = document.getElementById('pool-page-controls');
    var allItems = document.querySelectorAll('#pool-task-items .task-draggable');

    if (_taskPoolMode !== 'fixed') {
        if (controls) controls.style.display = 'none';
        return;
    }

    for (var i = 0; i < allItems.length; i++) { allItems[i].style.display = ''; }
    var ft = document.getElementById('pool-filter-type').value;
    var fp = document.getElementById('pool-filter-pri').value;
    var fd = document.getElementById('pool-filter-diff').value;
    for (var i = 0; i < allItems.length; i++) {
        var el = allItems[i];
        var ty = el.dataset.type || '';
        var pri = el.dataset.pri || '';
        var diff = el.dataset.diff || '';
        var ok = true;
        if (ft) ok = ok && (ty === ft);
        if (fp) ok = ok && (pri === fp);
        if (fd) ok = ok && (diff === fd);
        if (!ok) el.style.display = 'none';
    }
    var filteredItems = [];
    for (var i = 0; i < allItems.length; i++) {
        if (allItems[i].style.display !== 'none') filteredItems.push(allItems[i]);
    }
    var totalFiltered = filteredItems.length;
    var totalPages = Math.max(1, Math.ceil(totalFiltered / _taskPoolPageSize));
    if (!controls) return;

    if (totalFiltered <= _taskPoolPageSize) {
        controls.style.display = 'none';
        for (var i = 0; i < allItems.length; i++) { allItems[i].style.display = 'none'; }
        for (var i = 0; i < filteredItems.length; i++) { filteredItems[i].style.display = ''; }
        return;
    }

    controls.style.display = 'flex';
    _taskPoolPage = Math.max(0, Math.min(_taskPoolPage, totalPages - 1));
    var start = _taskPoolPage * _taskPoolPageSize;
    var end = Math.min(start + _taskPoolPageSize, totalFiltered);
    for (var i = 0; i < allItems.length; i++) { allItems[i].style.display = 'none'; }
    for (var i = start; i < end; i++) { filteredItems[i].style.display = ''; }

    var html = '';
    html += '<button class="page-btn" onclick="poolGoToPage(' + (_taskPoolPage - 1) + ')"' + (_taskPoolPage <= 0 ? ' disabled' : '') + '>← 上一页</button>';

    var maxVisible = 7;
    if (totalPages <= maxVisible) {
        for (var p = 0; p < totalPages; p++) {
            html += '<button class="page-btn' + (p === _taskPoolPage ? ' page-current' : '') + '" onclick="poolGoToPage(' + p + ')">' + (p + 1) + '</button>';
        }
    } else {
        html += '<button class="page-btn' + (0 === _taskPoolPage ? ' page-current' : '') + '" onclick="poolGoToPage(0)">1</button>';
        var startP = Math.max(1, _taskPoolPage - 2);
        var endP = Math.min(totalPages - 2, _taskPoolPage + 2);
        if (startP > 1) html += '<span class="page-ellipsis">...</span>';
        for (var p = startP; p <= endP; p++) {
            html += '<button class="page-btn' + (p === _taskPoolPage ? ' page-current' : '') + '" onclick="poolGoToPage(' + p + ')">' + (p + 1) + '</button>';
        }
        if (endP < totalPages - 2) html += '<span class="page-ellipsis">...</span>';
        var lastP = totalPages - 1;
        html += '<button class="page-btn' + (lastP === _taskPoolPage ? ' page-current' : '') + '" onclick="poolGoToPage(' + lastP + ')">' + (lastP + 1) + '</button>';
    }

    html += '<button class="page-btn" onclick="poolGoToPage(' + (_taskPoolPage + 1) + ')"' + (_taskPoolPage >= totalPages - 1 ? ' disabled' : '') + '>下一页 →</button>';
    html += ' 每页 <select class="page-size-select" onchange="poolSetPageSize(this.value)">';
    html += '<option value="20"' + (_taskPoolPageSize === 20 ? ' selected' : '') + '>20</option>';
    html += '<option value="50"' + (_taskPoolPageSize === 50 ? ' selected' : '') + '>50</option>';
    html += '<option value="100"' + (_taskPoolPageSize === 100 ? ' selected' : '') + '>100</option>';
    html += '</select>';
    html += ' <span class="page-summary">共 ' + totalFiltered + ' 个待分配任务，第 ' + (_taskPoolPage + 1) + '/共 ' + totalPages + ' 页</span>';

    controls.innerHTML = html;
}

function poolSetPageSize(size) {
    _taskPoolPageSize = parseInt(size, 10);
    _taskPoolPage = 0;
    _setLS('taskPoolPageSize', String(_taskPoolPageSize));
    _renderPoolPagination();
}

function poolGoToPage(p) {
    _taskPoolPage = parseInt(p, 10);
    _renderPoolPagination();
}

function poolPrevPage() {
    if (_taskPoolPage > 0) { _taskPoolPage--; _renderPoolPagination(); }
}

function poolNextPage() {
    var allItems = document.querySelectorAll('#pool-task-items .task-draggable');
    var filteredCount = 0;
    for (var i = 0; i < allItems.length; i++) { if (allItems[i].style.display !== 'none') filteredCount++; }
    if ((_taskPoolPage + 1) * _taskPoolPageSize < filteredCount) { _taskPoolPage++; _renderPoolPagination(); }
}
