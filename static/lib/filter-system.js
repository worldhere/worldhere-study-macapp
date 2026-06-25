// filter-system.js — 通用多选筛选系统
// 机器列表、任务库、历史记录共用同一 FilterSet 类，替换之前三套独立但几乎相同的代码

/**
 * FilterSet — 通用多选筛选器
 *
 * 每个实例管理一个面板的筛选状态（多选 tag + 条件标签 + URL 同步），
 * 自动注册 HTML onclick 所需的全局函数。
 *
 * 参数:
 *   ns            - 命名空间: ''=机器, 'task'=任务库, 'hist'=历史
 *   dims          - 筛选维度数组，如 ['type','status','kind','group']
 *   labels        - 维度中文名，如 { type:'机型', status:'状态' }
 *   panelDataKey  - window 上的数据源 key（模板注入），如 '_filterPanelData'
 *   applyFn       - 筛选变更后的回调函数
 *   urlPrefix     - URL 参数前缀，机器用 'm_'，任务/历史无此功能传空
 *   urlRefreshFn  - URL 变更后刷新列表的函数（仅机器筛选用）
 *   filterItemsFn - 自定义过滤函数 (items, state) => filteredItems
 */
function FilterSet(config) {
    this.ns = config.ns || '';
    this.dims = config.dims || [];
    this.labels = config.labels || {};
    this.panelDataKey = config.panelDataKey || '';
    this.applyFn = config.applyFn || null;
    this.onReset = config.onReset || null;
    this.urlPrefix = config.urlPrefix || '';
    this.urlRefreshFn = config.urlRefreshFn || null;
    this.filterItemsFn = config.filterItemsFn || null;

    // 初始化筛选状态
    this.state = {};
    for (var i = 0; i < this.dims.length; i++) {
        this.state[this.dims[i]] = [];
    }

    this._registerGlobals();
}

FilterSet.prototype = {

    // ---- 状态读写 ----

    toggleTag: function(dim, value) {
        var arr = this.state[dim];
        var idx = arr.indexOf(value);
        if (idx >= 0) { arr.splice(idx, 1); } else { arr.push(value); }
        this.syncUI();
        this._apply();
    },

    removeCondition: function(dim, value) {
        var arr = this.state[dim];
        var idx = arr.indexOf(value);
        if (idx >= 0) { arr.splice(idx, 1); }
        this.syncUI();
        this._apply();
    },

    reset: function() {
        var self = this;
        this.dims.forEach(function(dim) { self.state[dim] = []; });
        this.syncUI();
        var panels = document.querySelectorAll('.filter-panel.open');
        for (var i = 0; i < panels.length; i++) { panels[i].classList.remove('open'); }
        if (this.onReset) this.onReset();
        this._apply();
    },

    isActive: function() {
        for (var i = 0; i < this.dims.length; i++) {
            if (this.state[this.dims[i]].length > 0) return true;
        }
        return false;
    },

    // ---- UI 同步 ----

    syncUI: function() {
        var panelData = this._getPanelData();
        var hasAny = false;

        for (var i = 0; i < this.dims.length; i++) {
            var dim = this.dims[i];
            var sel = this.state[dim];

            // 更新 trigger 按钮
            var trigId = (this.ns ? this.ns + '-' : '') + 'filter-trigger-' + dim;
            var btn = document.getElementById(trigId);
            if (btn) {
                if (sel.length === 0) {
                    btn.textContent = '全部 ▾';
                    btn.classList.remove('active');
                } else {
                    btn.textContent = '已选 ' + sel.length + ' 项 ▾';
                    btn.classList.add('active');
                }
            }

            // 更新面板 tag 列表
            var panelId = (this.ns ? this.ns + '-' : '') + 'filter-panel-' + dim;
            var panel = document.getElementById(panelId);
            if (panel && panelData && panelData[dim]) {
                var html = '<div class="filter-tag-list">';
                for (var j = 0; j < panelData[dim].length; j++) {
                    var v = panelData[dim][j];
                    var isSel = sel.indexOf(v) >= 0;
                    html += '<span class="filter-tag' + (isSel ? ' selected' : '') +
                        '" data-value="' + escHtml(v) + '" onclick="' +
                        (this.ns ? '_toggleFilterTag_' + this.ns : '_toggleFilterTag') +
                        '(\'' + dim + '\',\'' + escHtml(v) + '\')">' + escHtml(v) + '</span>';
                }
                html += '</div>';
                panel.innerHTML = html;
            }

            if (sel.length > 0) hasAny = true;
        }

        this._renderConditionTags();

        // 更新重置按钮状态
        var resetId = (this.ns ? this.ns + '-' : '') + 'filter-reset-btn';
        var resetBtn = document.getElementById(resetId);
        if (resetBtn) {
            resetBtn.disabled = !hasAny;
            resetBtn.style.opacity = hasAny ? '' : '0.4';
        }
    },

    _renderConditionTags: function() {
        var condId = (this.ns ? this.ns + '-' : '') + 'filter-condition-tags';
        var barId = (this.ns ? this.ns + '-' : '') + 'filter-conditions';
        var container = document.getElementById(condId);
        var bar = document.getElementById(barId);
        if (!container || !bar) return;

        var html = '';
        var self = this;
        this.dims.forEach(function(dim) {
            self.state[dim].forEach(function(v) {
                html += '<span class="filter-condition-tag" data-dim="' + dim + '" data-value="' +
                    escHtml(v) + '">' + escHtml(self.labels[dim]) + ': ' + escHtml(v) +
                    ' <span class="remove-cond" onclick="_removeFilterCond' +
                    (self.ns ? '_' + self.ns : 'ition') + '(\'' + dim + '\',\'' +
                    escHtml(v) + '\')">&times;</span></span>';
            });
        });
        container.innerHTML = html;
        bar.style.display = html ? 'flex' : 'none';
    },

    togglePanel: function(dim) {
        var panelId = (this.ns ? this.ns + '-' : '') + 'filter-panel-' + dim;
        var panel = document.getElementById(panelId);
        if (!panel) return;
        var wasOpen = panel.classList.contains('open');
        var allPanels = document.querySelectorAll('.filter-panel.open');
        for (var i = 0; i < allPanels.length; i++) { allPanels[i].classList.remove('open'); }
        if (!wasOpen) {
            panel.classList.add('open');
            if (!panel.querySelector('.filter-tag-list')) this.syncUI();
        }
    },

    // ---- 数据过滤 ----

    filterItems: function(items) {
        if (!this.filterItemsFn) return items;
        return this.filterItemsFn(items, this.state);
    },

    // ---- URL 同步（机器筛选专用） ----

    initFromURL: function() {
        if (!this.urlPrefix) return;
        var url = new URL(window.location.href);
        var self = this;
        this.dims.forEach(function(dim) {
            var paramName = self.urlPrefix + dim;
            var raw = url.searchParams.getAll(paramName);
            if (raw.length === 0) {
                var single = url.searchParams.get(paramName);
                if (single) raw = [single];
            }
            var panelData = self._getPanelData();
            var validOptions = (panelData && panelData[dim]) ? panelData[dim] : [];
            self.state[dim] = raw.filter(function(v) { return validOptions.indexOf(v) >= 0; });
        });
        this.syncUI();
    },

    _apply: function() {
        // URL 同步
        if (this.urlPrefix) {
            var url = new URL(window.location.href);
            var self = this;
            this.dims.forEach(function(dim) {
                url.searchParams.delete(self.urlPrefix + dim);
                self.state[dim].forEach(function(v) {
                    url.searchParams.append(self.urlPrefix + dim, v);
                });
            });
            try { history.replaceState(null, '', url.toString()); } catch(e) {}
            if (this.urlRefreshFn) this.urlRefreshFn();
        }
        // 自定义回调
        if (this.applyFn) this.applyFn();
    },

    _getPanelData: function() {
        if (!this.panelDataKey) return {};
        return window[this.panelDataKey] || {};
    },

    // ---- 全局函数注册（供 HTML onclick 调用） ----

    _registerGlobals: function() {
        var self = this;

        if (this.ns === '') {
            // 机器筛选 — 直接全局函数
            window._toggleFilterTag = function(dim, value) { self.toggleTag(dim, value); };
            window._removeFilterCondition = function(dim, value) { self.removeCondition(dim, value); };
            window.resetAllFilters = function() { self.reset(); };
            window.toggleFilterPanel = function(dim) { self.togglePanel(dim); };
            window._isFilterActive = function() { return self.isActive(); };
            window.initFilterStateFromURL = function() { self.initFromURL(); };
            window._filterMachinesByUI = function(items) { return self.filterItems(items); };
        } else {
            // 任务/历史筛选 — 命名空间全局函数
            window['_toggleFilterTag_' + this.ns] = function(dim, value) { self.toggleTag(dim, value); };
            window['_removeFilterCond_' + this.ns] = function(dim, value) { self.removeCondition(dim, value); };

            // reset 函数名
            var resetName = 'reset' + this.ns.charAt(0).toUpperCase() + this.ns.slice(1) + 'Filters';
            window[resetName] = function() { self.reset(); };

            // syncUI 供面板切换时调用
            window['_' + this.ns + 'SyncFilterUI'] = function() { self.syncUI(); };
            // filterState 供 task-table.js / history.js 直接读取筛选状态
            window['_' + this.ns + 'FilterState'] = this.state;
        }
    }
};


// ========== 面板切换（通用，含 namespace 分发） ==========
// 替代原来的 _genericToggleFilterPanel
window._genericToggleFilterPanel = function(panelId) {
    var panel = document.getElementById(panelId);
    if (!panel) return;
    var wasOpen = panel.classList.contains('open');
    var allPanels = document.querySelectorAll('.filter-panel.open');
    for (var i = 0; i < allPanels.length; i++) { allPanels[i].classList.remove('open'); }
    if (!wasOpen) {
        panel.classList.add('open');
        if (!panel.querySelector('.filter-tag-list')) {
            var ns = panel.dataset.ns;
            if (ns === 'task' && window._taskSyncFilterUI) window._taskSyncFilterUI();
            else if (ns === 'hist' && window._histSyncFilterUI) window._histSyncFilterUI();
        }
    }
};


// ========== 实例化三个筛选器 ==========

// 1) 机器列表筛选器
window.machineFilter = new FilterSet({
    ns: '',
    dims: ['type', 'status', 'kind', 'group'],
    labels: { type: '机型', status: '状态', kind: '任务类型', group: '分组' },
    panelDataKey: '_filterPanelData',
    urlPrefix: 'm_',
    onReset: function() { _filterForceVisibleIds.clear(); },
    urlRefreshFn: function() { if (typeof _refreshMachineList === 'function') _refreshMachineList(); },
    filterItemsFn: function(items, state) {
        var result = items;
        if (state.type.length > 0) {
            result = result.filter(function(m) { return state.type.indexOf(m.type) >= 0; });
        }
        if (state.status.length > 0) {
            result = result.filter(function(m) { return state.status.indexOf(m.status) >= 0; });
        }
        if (state.kind.length > 0) {
            result = result.filter(function(m) { return state.kind.indexOf(m.task_kind) >= 0; });
        }
        if (state.group.length > 0) {
            result = result.filter(function(m) {
                for (var i = 0; i < state.group.length; i++) {
                    var g = state.group[i];
                    if (g === '未分组') { if (!m.group_name) return true; }
                    else { if (m.group_name === g) return true; }
                }
                return false;
            });
        }
        return result;
    },
});

// 2) 任务库筛选器
window.taskFilter = new FilterSet({
    ns: 'task',
    dims: ['type', 'kind', 'status'],
    labels: { type: '机型', kind: '任务类型', status: '状态' },
    panelDataKey: '_taskFilterPanelData',
    applyFn: function() { if (typeof applyTaskFilters === 'function') applyTaskFilters(); },
});

// 3) 历史记录筛选器
window.histFilter = new FilterSet({
    ns: 'hist',
    dims: ['type', 'kind'],
    labels: { type: '机型', kind: '任务类型' },
    panelDataKey: '_histFilterPanelData',
    applyFn: function() { if (typeof filterHistoryTable === 'function') filterHistoryTable(); },
});
