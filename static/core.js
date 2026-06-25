// golden scheduling app — 导航、UI 控件、主题、机器可见性、任务池模式

// ========== 导航栏常量 ==========
var NAV_TAB_MAP = { "班次设置": 0, "机器管理": 1, "任务库": 2, "排班面板": 3, "历史记录": 4, "可视化总结": 5, "设置": 6 };
var NAV_ICONS = ["&#9881;", "&#128421;", "&#128203;", "&#128197;", "&#128220;", "&#128202;", "&#9881;"];

// 根据 APP_CONFIG.nav_order 重建顶部导航和侧边栏按钮
function rebuildNavUI() {
    // 1. 收集所有 tab：默认按索引顺序 0..N
    var allOrder = [];
    var namesByIndex = {};
    for (var k in NAV_TAB_MAP) {
        if (NAV_TAB_MAP.hasOwnProperty(k)) { namesByIndex[NAV_TAB_MAP[k]] = k; }
    }
    for (var j = 0; j <= 6; j++) {
        var nm = namesByIndex[j];
        if (nm !== undefined) { allOrder.push({key: nm}); }
    }

    // 2. 如果用户配置了 nav_order，用它来排序（配置中的排前面，缺失的补后面）
    var cfgOrder = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.nav_order) ? APP_CONFIG.nav_order : [];
    if (cfgOrder.length > 0) {
        var seen = {};
        var merged = [];
        for (var ci = 0; ci < cfgOrder.length; ci++) {
            var cname = cfgOrder[ci].key;
            if (NAV_TAB_MAP[cname] !== undefined) {
                merged.push({key: cname});
                seen[cname] = true;
            }
        }
        for (var ai = 0; ai < allOrder.length; ai++) {
            if (!seen[allOrder[ai].key]) { merged.push(allOrder[ai]); }
        }
        allOrder = merged;
    }

    // 3. 构建侧边栏导航
    var sidebarNav = document.querySelector('.sidebar-nav');
    if (sidebarNav) {
        var sideHtml = '<div class="nav-label">主菜单</div>';
        for (var si = 0; si < allOrder.length; si++) {
            var sname = allOrder[si].key;
            var sidx = NAV_TAB_MAP[sname];
            if (sidx === undefined) continue;
            sideHtml += '<button class="nav-item" onclick="switchTab(' + sidx + ')"><span class="nav-icon">' + NAV_ICONS[sidx] + '</span> ' + sname + '</button>';
        }
        sidebarNav.innerHTML = sideHtml;
        if (_getActiveTab() === 6 && document.body.classList.contains('sidebar-mode')) {
            setTimeout(function() { renderSettingsSubNav(); }, 50);
        }
    }

    // 4. 构建顶部 tab 栏
    var tabBar = document.querySelector('.tab');
    if (tabBar) {
        var tabHtml = '';
        for (var ti = 0; ti < allOrder.length; ti++) {
            var tname = allOrder[ti].key;
            var tidx = NAV_TAB_MAP[tname];
            if (tidx === undefined) continue;
            tabHtml += '<button class="tab-btn" onclick="switchTab(' + tidx + ')">' + tname + '</button>';
        }
        tabBar.innerHTML = tabHtml;
    }
}

// ========== 侧边栏设置子导航（手风琴） ==========
function renderSettingsSubNav() {
    var isSidebar = document.body.classList.contains('sidebar-mode');
    if (!isSidebar || _getActiveTab() !== 6) {
        // 移除已存在的子导航
        var old = document.querySelector('.sidebar-settings-subnav');
        if (old) { old.classList.remove('expanded'); setTimeout(function() { if (old.parentNode) old.remove(); }, 250); }
        return;
    }
    // 查找侧边栏中"设置"按钮后的位置
    var sidebarNav = document.querySelector('.sidebar-nav');
    if (!sidebarNav) return;
    var navItems = sidebarNav.querySelectorAll('.nav-item');
    var settingsBtn = null;
    for (var i = 0; i < navItems.length; i++) {
        var match = (navItems[i].getAttribute('onclick') || '').match(/switchTab\((\d+)\)/);
        if (match && parseInt(match[1], 10) === 5) { settingsBtn = navItems[i]; break; }
    }
    if (!settingsBtn) return;

    // 移除已存在的子导航（避免重复）
    var existing = document.querySelector('.sidebar-settings-subnav');
    if (existing) existing.remove();

    var subTabs = ['班次设置', '机器管理设置', '任务库设置', '排班面板设置', '历史记录设置', '系统设置', '数据管理', '飞书同步'];
    var activeSub = parseInt((function() { try { return localStorage.getItem('activeSettingsSub') || '0'; } catch(e) { return '0'; } })(), 10);
    var html = '';
    for (var j = 0; j < subTabs.length; j++) {
        var cls = (j === activeSub) ? 'settings-sub-item active' : 'settings-sub-item';
        html += '<button class="' + cls + '" onclick="switchSettingsSub(' + j + ')">' + subTabs[j] + '</button>';
    }
    var subnav = document.createElement('div');
    subnav.className = 'sidebar-settings-subnav';
    subnav.innerHTML = html;
    // 插入到"设置"按钮后面
    settingsBtn.insertAdjacentElement('afterend', subnav);
    requestAnimationFrame(function() {
        subnav.classList.add('expanded');
    });
}

// ========== 侧边栏时钟 ==========
function updateSidebarClock() {
    var timeEl = document.getElementById('sidebar-clock-time');
    if (!timeEl) return;
    var now = new Date();
    var hh = String(now.getHours()).padStart(2, '0');
    var mm = String(now.getMinutes()).padStart(2, '0');
    var ss = String(now.getSeconds()).padStart(2, '0');
    timeEl.textContent = hh + ':' + mm + ':' + ss;
    // 折叠态竖排时钟
    var sciEl = document.getElementById('sidebar-collapsed-clock-el');
    if (sciEl) {
        sciEl.textContent = hh + ':' + mm;
    }
}

// ========== 侧边栏折叠/展开 ==========
function toggleSidebarCollapse() {
    var body = document.body;
    if (!body.classList.contains('sidebar-mode')) return;
    var isCollapsed = body.classList.toggle('sidebar-collapsed');
    _setLS('sidebarCollapsed', isCollapsed ? '1' : '0');
    var collapseBtn = document.getElementById('sidebar-collapse-btn');
    if (collapseBtn) {
        collapseBtn.innerHTML = isCollapsed ? '&#9654;' : '&#9664;';
        collapseBtn.title = isCollapsed ? '展开侧边栏' : '折叠侧边栏';
    }
    if (isCollapsed) {
        var subnav = document.querySelector('.sidebar-settings-subnav');
        if (subnav) { subnav.classList.remove('expanded'); }
    } else {
        if (_getActiveTab() === 6) {
            setTimeout(function() { renderSettingsSubNav(); }, 300);
        }
    }
}

// ========== 侧边栏日期同步 ==========
function syncSidebarDate() {
    var sd = document.getElementById('sidebar-schedule-date');
    var md = document.getElementById('schedule-date');
    if (sd && md) { md.value = sd.value; }
    if (typeof changeDate === 'function') changeDate();
}

// ========== 侧边栏导出桥接 ==========
function sidebarExport() {
    var ef = document.getElementById('sidebar-export-from');
    var et = document.getElementById('sidebar-export-to');
    var mef = document.getElementById('export-date-from');
    var met = document.getElementById('export-date-to');
    if (ef && mef) mef.value = ef.value;
    if (et && met) met.value = et.value;
    if (typeof exportSchedule === 'function') exportSchedule();
}

// Toast 轻提示：带消失动画，时长可通过设置调整
function showToast(msg, duration){
    if (duration === undefined) {
        try { duration = parseFloat(localStorage.getItem('ui_toast_duration') || '3') * 1000; } catch(e) { duration = 3000; }
    }
    var container = document.getElementById('toast-container');
    var item = document.createElement('div');
    item.className = 'toast-item';
    item.innerHTML = '<span style="flex:1">' + msg + '</span><button class="toast-close">×</button>';
    container.appendChild(item);

    function dismissToast() {
        if (!item.parentElement) return;
        clearTimeout(timer);
        item.classList.add('toast-out');
        item.addEventListener('animationend', function() {
            if (item.parentElement) item.remove();
        });
    }

    var timer = setTimeout(dismissToast, duration);
    item.querySelector('.toast-close').addEventListener('click', dismissToast);
}

let confirmResolver = null;
function showConfirm(title, message) {
    return new Promise((resolve) => {
        confirmResolver = resolve;
        document.getElementById('confirm-title').textContent = title;
        document.getElementById('confirm-message').innerHTML = message;
        document.getElementById('confirm-dialog').style.display = 'flex';
    });
}
function closeConfirm(result) {
    document.getElementById('confirm-dialog').style.display = 'none';
    if (confirmResolver) {
        confirmResolver(result);
        confirmResolver = null;
    }
}

let promptResolver = null;
function showPrompt(title, label, placeholder) {
    return new Promise(function(resolve) {
        promptResolver = resolve;
        document.getElementById('prompt-title').textContent = title;
        document.getElementById('prompt-label').textContent = label || '';
        var inp = document.getElementById('prompt-input');
        inp.value = '';
        inp.placeholder = placeholder || '';
        document.getElementById('prompt-dialog').style.display = 'flex';
        setTimeout(function() { inp.focus(); }, 50);
    });
}
function closePrompt(result) {
    document.getElementById('prompt-dialog').style.display = 'none';
    if (promptResolver) {
        promptResolver(typeof result === 'string' ? result : null);
        promptResolver = null;
    }
}

let screenshotPreviewResolver = null;
function showScreenshotPreview(imageDataUrl) {
    return new Promise(function(resolve) {
        screenshotPreviewResolver = resolve;
        document.getElementById('screenshot-preview-img').src = imageDataUrl;
        document.getElementById('screenshot-preview-dialog').style.display = 'flex';
    });
}
function closeScreenshotPreview(confirmed) {
    document.getElementById('screenshot-preview-dialog').style.display = 'none';
    if (screenshotPreviewResolver) {
        screenshotPreviewResolver(confirmed);
        screenshotPreviewResolver = null;
    }
}
function saveScreenshotLocal() {
    var img = document.getElementById('screenshot-preview-img');
    if (!img || !img.src) return;
    var style = (typeof _screenshotStyle !== 'undefined') ? _screenshotStyle : 'screenshot';
    var label = style === 'table' ? '表格' : '时间轴';
    var date = (typeof summaryGetDate === 'function') ? summaryGetDate() : '';
    var filename = date ? '排班_' + label + '_' + date + '.png' : '排班_' + label + '.png';
    var a = document.createElement('a');
    a.href = img.src;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function escHtml(s){ const d=document.createElement('div'); d.textContent=s||''; return d.innerHTML; }
function _setLS(key, value) { try { localStorage.setItem(key, value); } catch(e) {} }

const DEFAULT_TAB_INDEX = 3; // 默认进入"排班面板"
function _getActiveTab(){ return parseInt(localStorage.getItem('activeTabIndex')||'3',10); }

// ========== 机器可见性独立开关 ==========
var _hiddenMachineIds = new Set();
var _filterForceVisibleIds = new Set();

function _loadHiddenMachines() {
    try {
        var raw = localStorage.getItem('hiddenMachineIds');
        if (raw) _hiddenMachineIds = new Set(JSON.parse(raw));
    } catch(e) { _hiddenMachineIds = new Set(); }
}

function _saveHiddenMachines() {
    _setLS('hiddenMachineIds', JSON.stringify([..._hiddenMachineIds]));
}

function _clearHiddenMachines() { _hiddenMachineIds.clear(); _saveHiddenMachines(); }

function _toggleMachineVisibility(mid) {
    mid = parseInt(mid, 10);
    if (_hiddenMachineIds.has(mid)) {
        _hiddenMachineIds.delete(mid);
    } else {
        _hiddenMachineIds.add(mid);
        _filterForceVisibleIds.delete(mid);
    }
    _saveHiddenMachines();
    _refreshMachineList();
    _refreshTimelineFromServer();
}

function _restoreHiddenMachine(mid) {
    mid = parseInt(mid, 10);
    if (_hiddenMachineIds.has(mid)) {
        _hiddenMachineIds.delete(mid);
    } else {
        _filterForceVisibleIds.add(mid);
    }
    _saveHiddenMachines();
    _refreshMachineList();
    _refreshTimelineFromServer();
}

function _isMachineHidden(mid) { return _hiddenMachineIds.has(parseInt(mid, 10)); }

// ========== 任务区显示模式 ==========
var _taskPoolMode = 'below';
var _taskPoolPage = 0;
var _taskPoolPageSize = (function(){
    try { var v = parseInt(localStorage.getItem('taskPoolPageSize'), 10); return (v === 20 || v === 50 || v === 100) ? v : 20; }
    catch(e) { return 20; }
})();

function _loadTaskPoolMode() {
    try { _taskPoolMode = localStorage.getItem('taskPoolMode') || 'below'; }
    catch(e) { _taskPoolMode = 'below'; }
}

function setTaskPoolMode(mode) {
    _taskPoolMode = mode;
    _taskPoolPage = 0;
    _setLS('taskPoolMode', mode);
    _applyTaskPoolMode();
}

function _applyTaskPoolMode() {
    var pool = document.getElementById('task-pool');
    if (!pool) return;

    pool.classList.remove('pool-mode-below', 'pool-mode-fixed', 'pool-mode-floating');
    pool.classList.add('pool-mode-' + _taskPoolMode);

    document.querySelectorAll('.pool-mode-btn').forEach(function(b) {
        b.classList.toggle('active', b.dataset.mode === _taskPoolMode);
    });

    if (_taskPoolMode === 'floating') {
        pool.style.setProperty('--pool-columns', '1');
        _enablePoolDrag();
        document.getElementById('pool-page-controls').style.display = 'none';
        var items = document.querySelectorAll('#pool-task-items .task-draggable');
        items.forEach(function(it) { it.style.display = ''; });
    } else {
        try {
            var _ss = JSON.parse(localStorage.getItem('schedule_settings') || '{}');
            var _cols = parseInt(_ss['pool_modern_columns'], 10) || 2;
            pool.style.setProperty('--pool-columns', _cols);
        } catch(_e) { pool.style.setProperty('--pool-columns', '2'); }
        _disablePoolDrag();
        pool.style.left = '';
        pool.style.top = '';
        pool.style.right = '';
        pool.style.bottom = '';
        pool.style.width = '';
        pool.style.height = '';
        if (_taskPoolMode === 'fixed') {
            var items = document.querySelectorAll('#pool-task-items .task-draggable');
            items.forEach(function(it) { it.style.display = ''; });
            filterTaskPool();
        } else {
            document.getElementById('pool-page-controls').style.display = 'none';
            var items = document.querySelectorAll('#pool-task-items .task-draggable');
            items.forEach(function(it) { it.style.display = ''; });
            filterTaskPool();
        }
    }

    document.body.style.paddingBottom = (_taskPoolMode === 'fixed') ? '40vh' : '';
}

// ========== 机器排序 & UI 生成器 ==========

// 按 URL 中的 m_sort / m_dir 参数对机器数组排序
function _sortMachinesByURL(machines) {
    var url = new URL(window.location.href);
    var sort = url.searchParams.get('m_sort') || '';
    var dir = url.searchParams.get('m_dir') || 'asc';
    if (!sort) return machines;
    var sorted = machines.slice();
    sorted.sort(function(a, b) {
        var va = (a[sort] || '').toString().toLowerCase();
        var vb = (b[sort] || '').toString().toLowerCase();
        if (va < vb) return dir === 'asc' ? -1 : 1;
        if (va > vb) return dir === 'asc' ? 1 : -1;
        return 0;
    });
    return sorted;
}

// 生成机器表格排序链接（与 Jinja2 模板保持一致）
function _sortLink(label, field) {
    var url = new URL(window.location.href);
    var curSort = url.searchParams.get('m_sort') || '';
    var curDir = url.searchParams.get('m_dir') || 'asc';
    var newDir = (curSort === field && curDir === 'asc') ? 'desc' : 'asc';
    url.searchParams.set('m_sort', field);
    url.searchParams.set('m_dir', newDir);
    var indicator = curSort === field ? '(' + curDir + ')' : '';
    return '<a href="' + url.toString() + '">' + label + indicator + '</a>';
}

// 将机型名映射为 CSS 色板索引（task-type-0 ~ task-type-7）
function _typeIndex(typeName) {
    if (typeof TYPE_INDEX_MAP !== 'undefined' && TYPE_INDEX_MAP[typeName] !== undefined) return TYPE_INDEX_MAP[typeName];
    return 0;
}

// 生成任务类型下拉框选项（动态读取 APP_CONFIG.task_kinds）
function _taskKindOptions(selected) {
    var kinds = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.task_kinds && APP_CONFIG.task_kinds.length) ? APP_CONFIG.task_kinds : [{key:'常规'}];
    var html = '';
    for (var i = 0; i < kinds.length; i++) {
        var k = kinds[i].key;
        html += '<option' + (k === selected ? ' selected' : '') + '>' + escHtml(k) + '</option>';
    }
    return html;
}

// 生成分组下拉框选项（动态读取 APP_CONFIG.machine_groups）
function _groupOptions(selected) {
    var groups = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.machine_groups && APP_CONFIG.machine_groups.length) ? APP_CONFIG.machine_groups : [];
    var html = '<option value="">未分组</option>';
    for (var i = 0; i < groups.length; i++) {
        var g = groups[i].key;
        html += '<option' + (g === selected ? ' selected' : '') + '>' + escHtml(g) + '</option>';
    }
    html += '<option value="__new_group__">+ 新建分组...</option>';
    return html;
}

// ========== 任务表格联动 ==========

// 根据 schedules 数组刷新任务库表格中所有行的"分配时段"列
function _syncAllTaskTableTimes() {
    var map = {};
    schedules.forEach(function(s) {
        if (!map[s.task_id]) {
            var mn = (s.machine_name || '').replace(/\(.*\)/,'').trim();
            map[s.task_id] = { machine_name: mn + '(' + (s.task_type||'') + '/' + (s.task_kind||'') + ')', absStart: s.abs_start_min, absEnd: s.abs_end_min };
        }
    });
    document.querySelectorAll('#task-table tr[data-tid]').forEach(function(tr) {
        var tid = parseInt(tr.dataset.tid, 10);
        var info = map[tid];
        var cell = tr.children[9]; // 分配时段列（#列+1）
        if (cell) {
            if (info && info.absStart !== undefined && info.absEnd !== undefined) {
                cell.textContent = info.machine_name + ' ' + _formatAbsRange(info.absStart, info.absEnd);
            } else {
                cell.textContent = '';
            }
        }
    });
}

// 批量更新任务库表格中的状态列（textContent + data-orig），供各处复用
function _updateTaskStatusText(tid, status) {
    var t = typeof getTaskById === 'function' ? getTaskById(tid) : null;
    if (t) t.status = status;
    document.querySelectorAll('tr[data-tid="'+tid+'"] .task-status-text').forEach(function(el){
        el.textContent = status;
        el.style.color = '';
        el.dataset.orig = status;
    });
}

// ========== 页面拖拽自动滚屏 ==========
let autoScrollTimer = null;
const SCROLL_SPEED = 12;
const SCROLL_ZONE = 60;

var _pageAutoScrollRaf = null;
var _pageAutoScrollSpeed = 0;

function _onDragOverPage(e) {
    var edge = 80;
    var maxSpeed = 12;
    var y = e.clientY;
    var vh = window.innerHeight;

    if (y < edge) {
        _pageAutoScrollSpeed = -maxSpeed * (1 - y / edge);
    } else if (y > vh - edge) {
        _pageAutoScrollSpeed = maxSpeed * (1 - (vh - y) / edge);
    } else {
        _pageAutoScrollSpeed = 0;
    }

    if (_pageAutoScrollSpeed !== 0 && !_pageAutoScrollRaf) {
        _pageAutoScrollRaf = requestAnimationFrame(_scrollPageStep);
    }
}

function _scrollPageStep() {
    if (_pageAutoScrollSpeed === 0) {
        _pageAutoScrollRaf = null;
        return;
    }
    window.scrollBy(0, _pageAutoScrollSpeed);
    _pageAutoScrollRaf = requestAnimationFrame(_scrollPageStep);
}

function _stopPageAutoScroll() {
    _pageAutoScrollSpeed = 0;
    if (_pageAutoScrollRaf) {
        cancelAnimationFrame(_pageAutoScrollRaf);
        _pageAutoScrollRaf = null;
    }
}

function toggleLayoutMode(){
    var body = document.body;
    var isCurrentlySidebar = body.classList.contains('sidebar-mode');
    var sidebar = document.querySelector('.sidebar');
    var header = document.querySelector('.app-header');
    var toolbar = document.querySelector('.app-toolbar');
    var tab = document.querySelector('.tab');

    if (isCurrentlySidebar) {
        // 侧边栏 → 顶部模式：水滴收起 + 顶部向下延伸
        if (sidebar) {
            sidebar.style.animation = 'sidebarDripOut 300ms ease forwards';
        }
        // 先移除 sidebar-mode 让 header/toolbar/tab 恢复 display
        body.classList.remove('sidebar-mode');
        if (header) {
            header.style.display = 'flex';
            header.style.animation = 'headerSlideDown 300ms ease forwards';
        }
        if (toolbar) {
            toolbar.style.display = 'flex';
            toolbar.style.animation = 'headerSlideDown 300ms ease forwards';
        }
        if (tab) {
            tab.style.display = 'flex';
            tab.style.animation = 'headerSlideDown 300ms ease forwards';
        }
        setTimeout(function() {
            if (sidebar) { sidebar.style.animation = ''; }
            if (header) { header.style.animation = ''; header.style.display = ''; }
            if (toolbar) { toolbar.style.animation = ''; toolbar.style.display = ''; }
            if (tab) { tab.style.animation = ''; tab.style.display = ''; }
        }, 300);
        _setLS('layoutMode', 'topnav');
        // 收起设置子导航
        var subnav = document.querySelector('.sidebar-settings-subnav');
        if (subnav) { subnav.classList.remove('expanded'); }
    } else {
        // 顶部模式 → 侧边栏：水滴展开 + 顶部向上收起
        if (header) {
            header.style.display = 'flex';
            header.style.animation = 'headerSlideUp 300ms ease forwards';
        }
        if (toolbar) {
            toolbar.style.display = 'flex';
            toolbar.style.animation = 'headerSlideUp 300ms ease forwards';
        }
        if (tab) {
            tab.style.display = 'flex';
            tab.style.animation = 'headerSlideUp 300ms ease forwards';
        }
        // 侧边栏用 CSS transition 而非 animation
        body.classList.add('sidebar-mode');
        if (sidebar) {
            sidebar.style.clipPath = 'circle(0 at 38px 36px)';
            sidebar.style.opacity = '0';
            requestAnimationFrame(function() {
                sidebar.style.clipPath = 'inset(0 0 0 0)';
                sidebar.style.opacity = '1';
            });
        }
        setTimeout(function() {
            if (sidebar) { sidebar.style.clipPath = ''; sidebar.style.opacity = ''; }
            if (header) { header.style.animation = ''; header.style.display = ''; }
            if (toolbar) { toolbar.style.animation = ''; toolbar.style.display = ''; }
            if (tab) { tab.style.animation = ''; tab.style.display = ''; }
        }, 320);
        _setLS('layoutMode', 'sidebar');
        if (_getActiveTab() === 6) {
            setTimeout(function() { renderSettingsSubNav(); }, 320);
        }
    }
}

// ========== 主题管理 ==========
function initTheme() {
    var saved = localStorage.getItem('theme');
    if (!saved || saved === 'auto') {
        var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    } else {
        document.documentElement.setAttribute('data-theme', saved);
    }
    _syncThemeToggleIcons();

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function(e) {
        var saved = localStorage.getItem('theme');
        if (!saved || saved === 'auto') {
            document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
            _syncThemeToggleIcons();
        }
    });
}

function toggleTheme() {
    var current = document.documentElement.getAttribute('data-theme');
    var next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    _syncThemeToggleIcons();
}

function applyThemeMode(value) {
    localStorage.setItem('theme', value);
    if (value === 'auto') {
        var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    } else {
        document.documentElement.setAttribute('data-theme', value);
    }
    _syncThemeToggleIcons();
}

function _syncThemeToggleIcons() {
    var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    var icon = isDark ? '☀' : '☽';
    var hBtn = document.getElementById('theme-toggle-header');
    var sBtn = document.getElementById('theme-toggle-sidebar');
    if (hBtn) hBtn.innerHTML = icon;
    if (sBtn) sBtn.innerHTML = icon;
}

// ========== 按钮波纹 ==========
function initButtonRipple() {
    document.addEventListener('click', function(e) {
        if (document.body.classList.contains('no-ripple')) return;
        var btn = e.target.closest('button, .btn, .tool-btn, .btn-danger');
        if (!btn) return;
        var ripple = document.createElement('span');
        ripple.className = 'ripple';
        var rect = btn.getBoundingClientRect();
        var size = Math.max(rect.width, rect.height);
        ripple.style.width = ripple.style.height = size + 'px';
        ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
        ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
        btn.appendChild(ripple);
        ripple.addEventListener('animationend', function() { ripple.remove(); });
    });
}
