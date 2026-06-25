// 自动分配模块
window.AA = {
    _state: {
        previewData: null,
        previewParams: null,
        machines: [],
        tasks: [],
        machineTypes: [],
        taskKinds: [],
        _selectedMachineIds: null,
        _selectedTaskIds: null,
        _activeMachineTypeFilters: [],
        _activeMachineKindFilters: [],
        _activeMachineGroupFilters: [],
        _activeTaskTypeFilters: [],
        _activeTaskKindFilters: [],
        _activePackageFilters: [],
        _constraints: {},
        _panelWasOpen: false,
    },

    // ========== 弹窗控制 ==========

    open: function(preserveState) {
        var dlg = document.getElementById('auto-assign-dialog');
        var backdrop = document.getElementById('dialog-backdrop');
        if (dlg) dlg.style.display = 'flex';
        if (backdrop) backdrop.style.display = 'block';

        if (!preserveState) {
            AA._state.previewData = null;
            AA._state.previewParams = null;
            AA._state._activeMachineTypeFilters = [];
            AA._state._activeMachineKindFilters = [];
            AA._state._activeMachineGroupFilters = [];
            AA._state._activeTaskTypeFilters = [];
            AA._state._activeTaskKindFilters = [];
            AA._state._activePackageFilters = [];
            AA._state._constraints = {};
            AA._state._panelWasOpen = false;
            AA._loadMachines();
            AA._loadTasks();
            AA._resetTimeUI();
            AA._closeConstraintPanel();
        } else {
            AA._state.previewData = null;
            AA._loadMachines();
            AA._loadTasks();
            if (AA._state.previewParams) {
                AA._restoreTimeFromParams(AA._state.previewParams);
                var pkgMap = AA._state.previewParams.package_group_map || {};
                AA._state._constraints = {};
                Object.keys(pkgMap).forEach(function(pkgId) {
                    var g = pkgMap[pkgId];
                    if (!AA._state._constraints[g]) AA._state._constraints[g] = [];
                    AA._state._constraints[g].push(parseInt(pkgId, 10));
                });
            }
            if (AA._state._panelWasOpen) {
                AA._openConstraintPanel();
            }
        }
        AA._loadAdvanced();
        AA._updateAdvancedSummary();
    },

    close: function() {
        var dlg = document.getElementById('auto-assign-dialog');
        var backdrop = document.getElementById('dialog-backdrop');
        if (dlg) dlg.style.display = 'none';
        if (backdrop) backdrop.style.display = 'none';
    },

    cancel: function() {
        AA._closeConstraintPanel();
        AA.close();
        AA._clearPreview();
    },

    // ========== 折叠分组 ==========

    toggleGroup: function(name) {
        var body = document.getElementById('aa-body-' + name);
        var arr = document.getElementById('aa-arr-' + name);
        if (!body || !arr) return;
        var isOpen = body.classList.contains('open');
        if (isOpen) {
            body.classList.remove('open');
            arr.classList.remove('open');
            arr.innerHTML = '&#9656;';
        } else {
            body.classList.add('open');
            arr.classList.add('open');
            arr.innerHTML = '&#9666;';
        }
    },

    // ========== 分组-任务包约束面板 ==========

    toggleConstraintPanel: function() {
        if (AA._isConstraintPanelOpen()) {
            AA._closeConstraintPanel();
        } else {
            AA._openConstraintPanel();
        }
    },

    _isConstraintPanelOpen: function() {
        var panel = document.getElementById('aa-right-panel');
        return panel && panel.style.display !== 'none';
    },

    _openConstraintPanel: function() {
        var panel = document.getElementById('aa-right-panel');
        var btn = document.getElementById('aa-btn-pkg-toggle');
        var divider = document.getElementById('aa-divider');
        if (panel) panel.style.display = 'flex';
        if (btn) btn.classList.add('active');
        if (divider) divider.classList.add('visible');
        AA._renderConstraintPanel();
    },

    _closeConstraintPanel: function() {
        var panel = document.getElementById('aa-right-panel');
        var btn = document.getElementById('aa-btn-pkg-toggle');
        var divider = document.getElementById('aa-divider');
        if (panel) panel.style.display = 'none';
        if (btn) btn.classList.remove('active');
        if (divider) divider.classList.remove('visible');
    },

    _renderConstraintPanel: function() {
        var body = document.getElementById('aa-constraint-body');
        if (!body) return;

        var groups = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.machine_groups) ? APP_CONFIG.machine_groups : [];
        if (groups.length === 0) {
            body.innerHTML = '<div style="padding:20px;color:#94a3b8;text-align:center;">暂无分组配置，请先在机器管理中创建分组</div>';
            return;
        }

        var timeP = AA._getTimeParams();
        var totalDays = timeP.we !== null ? Math.ceil((timeP.we - (timeP.ws || 0)) / 1440) : 4;

        var packages = AA._state._packages || [];
        var constraints = AA._state._constraints || {};
        var assignedPkgIds = {};
        Object.keys(constraints).forEach(function(g) {
            (constraints[g] || []).forEach(function(pid) { assignedPkgIds[pid] = true; });
        });

        var html = '<div class="aa-cstr-toolbar">' +
            '<button class="aa-btn-balance" onclick="AA._autoBalance()">⚡ 自动均衡</button>' +
            '<button class="aa-btn-clear-cstr" onclick="AA._clearConstraints()">清除全部</button>' +
            '</div>';

        groups.forEach(function(g) {
            var myPkgIds = constraints[g.key] || [];
            var totalMin = 0;
            var chipsHtml = '';
            myPkgIds.forEach(function(pid) {
                var pkg = AA._findPackageById(pid);
                var pkgMin = pkg ? (pkg.total_min || 0) : 0;
                totalMin += pkgMin;
                chipsHtml += '<span class="aa-pkg-chip" data-pkg="' + pid + '">' +
                    '<span style="width:7px;height:7px;border-radius:50%;background:' + (pkg ? (pkg.color || '#94a3b8') : '#94a3b8') + ';flex-shrink:0;"></span>' +
                    (pkg ? escHtml(pkg.name) : '#' + pid) +
                    ' (' + Math.round(pkgMin / 60) + 'h)' +
                    '<span class="aa-pkg-chip-rm" onclick="event.stopPropagation();AA._removeConstraint(\'' + escHtml(g.key) + '\', ' + pid + ')">&times;</span>' +
                    '</span>';
            });

            var machineCount = AA._state.machines.filter(function(m) { return (m.group_name || '') === g.key; }).length;
            var availMin = machineCount * totalDays * 24 * 60;
            var ratio = availMin > 0 ? totalMin / availMin : 0;
            var pct = Math.round(ratio * 100);
            var barColor = ratio > 0.9 ? '#ef4444' : ratio > 0.6 ? '#f59e0b' : '#10b981';

            html += '<div class="aa-group-box" data-group="' + escHtml(g.key) + '" ' +
                'ondragover="event.preventDefault();this.classList.add(\'drag-over\')" ' +
                'ondragleave="this.classList.remove(\'drag-over\')" ' +
                'ondrop="AA._onDropConstraint(event, \'' + escHtml(g.key) + '\')">' +
                '<div class="aa-gbox-head">' +
                    '<span class="aa-gbox-dot" style="background:' + AA._groupColor(g.key) + '"></span>' +
                    escHtml(g.key) + ' · ' + machineCount + '台' +
                    '<span class="aa-gbox-stats">可用 ' + (machineCount * totalDays * 24) + 'h</span>' +
                '</div>' +
                '<div class="aa-gbox-body">' +
                    (chipsHtml || '<div class="aa-gbox-hint">拖拽任务包到此处</div>') +
                '</div>' +
                '<div class="aa-load-bar">' +
                    '<div class="aa-load-label"><span>负载率</span><span><b>' + Math.round(totalMin / 60) + 'h</b> / ' + (machineCount * totalDays * 24) + 'h</span></div>' +
                    '<div class="aa-load-track"><div class="aa-load-fill" style="width:' + Math.min(pct, 100) + '%;background:' + barColor + '"></div></div>' +
                '</div>' +
                '</div>';
        });

        var unassignedPkgs = packages.filter(function(p) { return !assignedPkgIds[p.id]; });
        html += '<div class="aa-pkg-pool"><h4>待分配任务包</h4>';
        if (unassignedPkgs.length === 0) {
            html += '<div style="font-size:11px;color:#cbd5e1;padding:4px 0;">全部已分配</div>';
        } else {
            unassignedPkgs.forEach(function(p) {
                html += '<div class="aa-pkg-pool-item" draggable="true" data-pkg-id="' + p.id + '" ' +
                    'data-pkg-name="' + escHtml(p.name) + '" data-pkg-color="' + (p.color || '#94a3b8') + '" ' +
                    'data-pkg-min="' + (p.total_min || 0) + '" ' +
                    'ondragstart="AA._onDragStartPkg(event)" ondragend="AA._onDragEndPkg(event)">' +
                    '<span class="aa-pkg-dot" style="background:' + (p.color || '#94a3b8') + '"></span>' +
                    '<span class="aa-pkg-name">' + escHtml(p.name) + '</span>' +
                    '<span class="aa-pkg-meta">' + (p.task_count || '?') + '个 · ' + Math.round((p.total_min || 0) / 60) + 'h</span>' +
                    '</div>';
            });
        }
        html += '</div>';

        body.innerHTML = html;
    },

    _onDragStartPkg: function(e) {
        var el = e.target.closest('.aa-pkg-pool-item');
        if (!el || el.classList.contains('assigned')) { e.preventDefault(); return; }
        e.dataTransfer.setData('text/plain', JSON.stringify({
            id: parseInt(el.dataset.pkgId, 10),
            name: el.dataset.pkgName,
            color: el.dataset.pkgColor,
            total_min: parseInt(el.dataset.pkgMin, 10) || 0
        }));
        el.style.opacity = '0.4';
    },

    _onDragEndPkg: function(e) {
        var el = e.target.closest('.aa-pkg-pool-item');
        if (el) el.style.opacity = '1';
    },

    _onDropConstraint: function(e, groupName) {
        e.preventDefault();
        var box = e.target.closest('.aa-group-box');
        if (box) box.classList.remove('drag-over');
        try {
            var data = JSON.parse(e.dataTransfer.getData('text/plain'));
        } catch(err) { return; }

        Object.keys(AA._state._constraints).forEach(function(g) {
            var arr = AA._state._constraints[g] || [];
            var idx = arr.indexOf(data.id);
            if (idx >= 0) arr.splice(idx, 1);
        });

        if (!AA._state._constraints[groupName]) AA._state._constraints[groupName] = [];
        if (AA._state._constraints[groupName].indexOf(data.id) < 0) {
            AA._state._constraints[groupName].push(data.id);
        }
        AA._renderConstraintPanel();
        AA._clearPreview();
    },

    _removeConstraint: function(groupName, pkgId) {
        var arr = AA._state._constraints[groupName];
        if (arr) {
            var idx = arr.indexOf(pkgId);
            if (idx >= 0) arr.splice(idx, 1);
        }
        AA._renderConstraintPanel();
        AA._clearPreview();
    },

    _autoBalance: function() {
        AA._state._constraints = {};
        var groups = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.machine_groups) ? APP_CONFIG.machine_groups : [];
        if (groups.length === 0) return;
        groups.forEach(function(g) { AA._state._constraints[g.key] = []; });

        var timeP = AA._getTimeParams();
        var totalDays = timeP.we !== null ? Math.ceil((timeP.we - (timeP.ws || 0)) / 1440) : 4;

        var packages = (AA._state._packages || []).slice();
        packages.sort(function(a, b) { return (b.total_min || 0) - (a.total_min || 0); });

        packages.forEach(function(pkg) {
            var bestGroup = null;
            var bestRatio = Infinity;
            groups.forEach(function(g) {
                var curMin = (AA._state._constraints[g.key] || []).reduce(function(s, pid) {
                    var p = AA._findPackageById(pid);
                    return s + (p ? (p.total_min || 0) : 0);
                }, 0);
                var newMin = curMin + (pkg.total_min || 0);
                var machineCount = AA._state.machines.filter(function(m) { return (m.group_name || '') === g.key; }).length;
                var availMin = machineCount * totalDays * 24 * 60;
                var ratio = availMin > 0 ? newMin / availMin : Infinity;
                if (ratio < bestRatio) { bestRatio = ratio; bestGroup = g; }
            });
            if (bestGroup) {
                AA._state._constraints[bestGroup.key].push(pkg.id);
            }
        });
        AA._renderConstraintPanel();
        AA._clearPreview();
    },

    _clearConstraints: function() {
        AA._state._constraints = {};
        AA._renderConstraintPanel();
        AA._clearPreview();
    },

    _findPackageById: function(pid) {
        var packages = AA._state._packages || [];
        for (var i = 0; i < packages.length; i++) {
            if (packages[i].id === pid) return packages[i];
        }
        return null;
    },

    _groupColor: function(groupName) {
        var palette = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#84cc16'];
        var groups = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.machine_groups) ? APP_CONFIG.machine_groups : [];
        for (var i = 0; i < groups.length; i++) {
            if (groups[i].key === groupName) return palette[i % palette.length];
        }
        return '#94a3b8';
    },

    // ========== 时间范围 ==========

    _resetTimeUI: function() {
        var fromMode = document.getElementById('aa-from-mode');
        var toMode = document.getElementById('aa-to-mode');
        if (fromMode) fromMode.value = 'now';
        if (toMode) toMode.value = 'unlimited';
        var fp = document.getElementById('aa-from-pickers');
        var tp = document.getElementById('aa-to-pickers');
        if (fp) fp.style.display = 'none';
        if (tp) tp.style.display = 'none';
        AA._updateTimeSummary();
    },

    _restoreTimeFromParams: function(params) {
        var fromMode = document.getElementById('aa-from-mode');
        var toMode = document.getElementById('aa-to-mode');
        if (fromMode) fromMode.value = params.from_mode || 'now';
        if (toMode) toMode.value = params.to_mode || 'unlimited';

        var fp = document.getElementById('aa-from-pickers');
        var tp = document.getElementById('aa-to-pickers');
        if (params.from_mode === 'custom') {
            if (fp) fp.style.display = '';
            var fd = document.getElementById('aa-from-date');
            var ft = document.getElementById('aa-from-time');
            if (fd && params.from_date) fd.value = params.from_date;
            if (ft && params.from_time) ft.value = params.from_time;
        } else {
            if (fp) fp.style.display = 'none';
        }
        if (params.to_mode === 'custom') {
            if (tp) tp.style.display = '';
            var td = document.getElementById('aa-to-date');
            var tt = document.getElementById('aa-to-time');
            if (td && params.to_date) td.value = params.to_date;
            if (tt && params.to_time) tt.value = params.to_time;
        } else {
            if (tp) tp.style.display = 'none';
        }
        AA._updateTimeSummary();
    },

    resetTime: function() {
        AA._resetTimeUI();
    },

    onTimeModeChange: function() {
        var fromMode = document.getElementById('aa-from-mode');
        var toMode = document.getElementById('aa-to-mode');
        var fp = document.getElementById('aa-from-pickers');
        var tp = document.getElementById('aa-to-pickers');
        if (fp) fp.style.display = fromMode && fromMode.value === 'custom' ? '' : 'none';
        if (tp) tp.style.display = toMode && toMode.value === 'custom' ? '' : 'none';
        AA._updateTimeSummary();
        AA._clearPreview();
    },

    _updateTimeSummary: function() {
        var fromMode = document.getElementById('aa-from-mode');
        var toMode = document.getElementById('aa-to-mode');
        var parts = [];
        if (!fromMode || fromMode.value === 'now') {
            parts.push('从现在开始');
        } else {
            var d = document.getElementById('aa-from-date');
            var t = document.getElementById('aa-from-time');
            var dv = d ? d.value : ''; var tv = t ? t.value : '';
            parts.push(dv && tv ? dv + ' ' + tv : '指定时间');
        }
        if (!toMode || toMode.value === 'unlimited') {
            parts.push('28天内');
        } else {
            var d2 = document.getElementById('aa-to-date');
            var t2 = document.getElementById('aa-to-time');
            var dv2 = d2 ? d2.value : ''; var tv2 = t2 ? t2.value : '';
            parts.push(dv2 && tv2 ? dv2 + ' ' + tv2 : '指定时间');
        }
        var el = document.getElementById('aa-summary-time');
        if (el) { el.textContent = parts.join(' · '); el.classList.remove('muted'); }
    },

    _getTimeParams: function() {
        var fromMode = document.getElementById('aa-from-mode');
        var toMode = document.getElementById('aa-to-mode');
        var ws = null, we = null;
        var fromDate = '', fromTime = '', toDate = '', toTime = '';

        if (fromMode && fromMode.value === 'now') {
            var now = new Date();
            var baseDateForWs = (function(){
                var sdEl = document.getElementById('schedule-date');
                return sdEl ? sdEl.value : '';
            })();
            if (!baseDateForWs) baseDateForWs = new Date().toISOString().slice(0, 10);
            var baseWs = new Date(baseDateForWs + 'T00:00');
            ws = Math.round((now - baseWs) / 60000);
        } else if (fromMode && fromMode.value === 'custom') {
            var fd = document.getElementById('aa-from-date');
            var ft = document.getElementById('aa-from-time');
            if (fd && ft) {
                fromDate = fd.value; fromTime = ft.value;
                if (fromDate && fromTime) {
                    var baseDateForWs2 = (function(){
                        var sdEl = document.getElementById('schedule-date');
                        return sdEl ? sdEl.value : '';
                    })();
                    if (!baseDateForWs2) baseDateForWs2 = new Date().toISOString().slice(0, 10);
                    var baseWs2 = new Date(baseDateForWs2 + 'T00:00');
                    var d = new Date(fromDate + 'T' + fromTime);
                    if (!isNaN(d.getTime()) && !isNaN(baseWs2.getTime())) {
                        ws = Math.round((d - baseWs2) / 60000);
                    }
                }
            }
        }
        if (toMode && toMode.value === 'unlimited') {
            we = 28 * 1440;
        } else if (toMode && toMode.value === 'custom') {
            var td = document.getElementById('aa-to-date');
            var tt = document.getElementById('aa-to-time');
            if (td && tt) {
                toDate = td.value; toTime = tt.value;
                if (toDate && toTime) {
                    var baseDateForWe = (function(){
                        var sdEl = document.getElementById('schedule-date');
                        return sdEl ? sdEl.value : '';
                    })();
                    if (!baseDateForWe) baseDateForWe = new Date().toISOString().slice(0, 10);
                    var baseWe = new Date(baseDateForWe + 'T00:00');
                    var d2 = new Date(toDate + 'T' + toTime);
                    if (!isNaN(d2.getTime()) && !isNaN(baseWe.getTime())) {
                        we = Math.round((d2 - baseWe) / 60000);
                    }
                }
            }
        }
        return { ws: ws, we: we, from_mode: fromMode ? fromMode.value : 'now',
                 to_mode: toMode ? toMode.value : 'unlimited',
                 from_date: fromDate, from_time: fromTime,
                 to_date: toDate, to_time: toTime };
    },

    // ========== 机器 ==========

    _loadMachines: function() {
        var container = document.getElementById('aa-machine-list');
        if (container) container.innerHTML = '加载中...';
        fetch('/api/machines')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                AA._state.machines = data.machines || [];
                AA._state._selectedMachineIds = {};
                AA._state.machines.forEach(function(m) {
                    if (m.status !== '维修停用') AA._state._selectedMachineIds[m.id] = true;
                });
                AA._renderMachineTabs();
                AA._renderMachines();
            })
            .catch(function() {
                var c = document.getElementById('aa-machine-list');
                if (c) c.innerHTML = '<div style="padding:12px;color:#f56c6c;text-align:center;">加载失败</div>';
            });
    },

    _renderMachineTabs: function() {
        var types = {};
        var kinds = {};
        AA._state.machines.forEach(function(m) {
            if (m.type) types[m.type] = true;
            if (m.task_kind) kinds[m.task_kind] = true;
        });
        AA._state.machineTypes = Object.keys(types);
        AA._state.taskKinds = Object.keys(kinds);

        var activeTypes = AA._state._activeMachineTypeFilters;
        var activeKinds = AA._state._activeMachineKindFilters;
        var html = '';

        // 机型组
        html += '<div class="aa-tab-group"><span class="aa-tab-label">机型</span>';
        html += '<span class="aa-tab' + (activeTypes.length === 0 ? ' on' : '') + '" data-group="type" data-filter="all" onclick="AA.toggleMachineFilter(\'all\', \'type\', this)">全部</span>';
        AA._state.machineTypes.forEach(function(t) {
            html += '<span class="aa-tab' + (activeTypes.indexOf(t) >= 0 ? ' on' : '') + '" data-group="type" data-filter="type:' + escHtml(t) + '" onclick="AA.toggleMachineFilter(\'type:' + escHtml(t) + '\', \'type\', this)">' + escHtml(t) + '</span>';
        });
        html += '</div>';

        // 任务类型组
        html += '<div class="aa-tab-group" style="margin-top:2px;"><span class="aa-tab-label">任务类型</span>';
        html += '<span class="aa-tab' + (activeKinds.length === 0 ? ' on' : '') + '" data-group="kind" data-filter="all" onclick="AA.toggleMachineFilter(\'all\', \'kind\', this)">全部</span>';
        AA._state.taskKinds.forEach(function(k) {
            html += '<span class="aa-tab' + (activeKinds.indexOf(k) >= 0 ? ' on' : '') + '" data-group="kind" data-filter="kind:' + escHtml(k) + '" onclick="AA.toggleMachineFilter(\'kind:' + escHtml(k) + '\', \'kind\', this)">' + escHtml(k) + '</span>';
        });
        html += '</div>';

        // 分组
        var groups = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.machine_groups) ? APP_CONFIG.machine_groups : [];
        var activeGroups = AA._state._activeMachineGroupFilters || [];
        html += '<div class="aa-tab-group" style="margin-top:2px;"><span class="aa-tab-label">分组</span>';
        html += '<span class="aa-tab' + (activeGroups.length === 0 ? ' on' : '') + '" data-group="group" data-filter="all" onclick="AA.toggleMachineFilter(\'all\', \'group\', this)">全部</span>';
        groups.forEach(function(g) {
            html += '<span class="aa-tab' + (activeGroups.indexOf(g.key) >= 0 ? ' on' : '') + '" data-group="group" data-filter="group:' + escHtml(g.key) + '" onclick="AA.toggleMachineFilter(\'group:' + escHtml(g.key) + '\', \'group\', this)">' + escHtml(g.key) + '</span>';
        });
        html += '</div>';

        var el = document.getElementById('aa-machine-tabs');
        if (el) el.innerHTML = html;
    },

    _renderMachines: function() {
        var activeTypes = AA._state._activeMachineTypeFilters;
        var activeKinds = AA._state._activeMachineKindFilters;
        var activeGroups = AA._state._activeMachineGroupFilters || [];
        var list = AA._state.machines.slice();

        if (activeTypes.length > 0 || activeKinds.length > 0 || activeGroups.length > 0) {
            list = list.filter(function(m) {
                var typeOk = activeTypes.length === 0 || activeTypes.indexOf(m.type) >= 0;
                var kindOk = activeKinds.length === 0 || activeKinds.indexOf(m.task_kind) >= 0;
                var groupOk = activeGroups.length === 0 || activeGroups.indexOf(m.group_name || '') >= 0;
                return typeOk && kindOk && groupOk;
            });
        }

        var sel = AA._state._selectedMachineIds || {};
        var html = '';
        list.forEach(function(m) {
            var disabled = m.status === '维修停用';
            var cls = 'aa-item';
            if (disabled) cls += ' disabled';
            if (!disabled && sel[m.id]) cls += ' on';
            html += '<div class="' + cls + '" data-id="' + m.id + '" onclick="' + (disabled ? '' : 'AA.toggleMachine(this)') + '">';
            html += '<span class="aa-cb">' + (disabled ? '' : '✓') + '</span>';
            html += '<span class="aa-name">' + escHtml(m.name) + '</span>';
            html += '<span class="aa-meta">' + escHtml(m.type || '') + ' · ' + escHtml(m.task_kind || '') + (m.group_name ? ' · ' + escHtml(m.group_name) : '') + '</span>';
            html += '</div>';
        });
        if (!list.length) html = '<div style="padding:12px;color:#999;text-align:center;">暂无可选机器</div>';
        var el = document.getElementById('aa-machine-list');
        if (el) el.innerHTML = html;
        AA._updateMachineSummary();
    },

    toggleMachine: function(el) {
        var id = parseInt(el.getAttribute('data-id'), 10);
        el.classList.toggle('on');
        var sel = AA._state._selectedMachineIds || {};
        if (el.classList.contains('on')) {
            sel[id] = true;
        } else {
            delete sel[id];
        }
        AA._updateMachineSummary();
        AA._clearPreview();
    },

    toggleMachineFilter: function(filter, group, tabEl) {
        var arr;
        if (group === 'type') arr = AA._state._activeMachineTypeFilters;
        else if (group === 'kind') arr = AA._state._activeMachineKindFilters;
        else if (group === 'group') arr = AA._state._activeMachineGroupFilters;
        else return;
        if (filter === 'all') {
            arr.length = 0;
        } else {
            var val = filter.slice(filter.indexOf(':') + 1);
            var idx = arr.indexOf(val);
            if (idx >= 0) {
                arr.splice(idx, 1);
            } else {
                arr.push(val);
            }
        }
        AA._renderMachineTabs();
        AA._renderMachines();
    },

    _updateMachineSummary: function() {
        var sel = AA._state._selectedMachineIds || {};
        var count = Object.keys(sel).length;
        var el = document.getElementById('aa-summary-machine');
        if (el) el.textContent = '已选 ' + count + ' 台';
    },

    // ========== 任务 ==========

    _loadTasks: function() {
        var container = document.getElementById('aa-task-list');
        if (container) container.innerHTML = '加载中...';
        fetch('/api/tasks?status=待分配')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                AA._state.tasks = (data.tasks || []).filter(function(t) { return t.status === '待分配'; });
                // 按优先级 sort_order 排序
                var priMap = {};
                if (window.APP_CONFIG && window.APP_CONFIG.priorities) {
                    window.APP_CONFIG.priorities.forEach(function(p, i) { priMap[p.key] = i; });
                }
                AA._state.tasks.sort(function(a, b) {
                    return (priMap[a.priority] || 99) - (priMap[b.priority] || 99);
                });
                AA._state._selectedTaskIds = {};
                AA._state.tasks.forEach(function(t) { AA._state._selectedTaskIds[t.id] = true; });
                AA._renderTaskTabs();
                AA._renderTasks();
            })
            .catch(function() {
                var c = document.getElementById('aa-task-list');
                if (c) c.innerHTML = '<div style="padding:12px;color:#f56c6c;text-align:center;">加载失败</div>';
            });
    },

    _renderTaskTabs: function() {
        var types = {};
        var kinds = {};
        AA._state.tasks.forEach(function(t) {
            if (t.type) types[t.type] = true;
            if (t.task_kind) kinds[t.task_kind] = true;
        });

        var activeTypes = AA._state._activeTaskTypeFilters;
        var activeKinds = AA._state._activeTaskKindFilters;
        var html = '';

        // 机型组
        html += '<div class="aa-tab-group"><span class="aa-tab-label">机型</span>';
        html += '<span class="aa-tab' + (activeTypes.length === 0 ? ' on' : '') + '" data-group="type" data-filter="all" onclick="AA.toggleTaskFilter(\'all\', \'type\', this)">全部</span>';
        Object.keys(types).forEach(function(tp) {
            html += '<span class="aa-tab' + (activeTypes.indexOf(tp) >= 0 ? ' on' : '') + '" data-group="type" data-filter="type:' + escHtml(tp) + '" onclick="AA.toggleTaskFilter(\'type:' + escHtml(tp) + '\', \'type\', this)">' + escHtml(tp) + '</span>';
        });
        html += '</div>';

        // 任务类型组
        html += '<div class="aa-tab-group" style="margin-top:2px;"><span class="aa-tab-label">任务类型</span>';
        html += '<span class="aa-tab' + (activeKinds.length === 0 ? ' on' : '') + '" data-group="kind" data-filter="all" onclick="AA.toggleTaskFilter(\'all\', \'kind\', this)">全部</span>';
        Object.keys(kinds).forEach(function(k) {
            html += '<span class="aa-tab' + (activeKinds.indexOf(k) >= 0 ? ' on' : '') + '" data-group="kind" data-filter="kind:' + escHtml(k) + '" onclick="AA.toggleTaskFilter(\'kind:' + escHtml(k) + '\', \'kind\', this)">' + escHtml(k) + '</span>';
        });
        html += '</div>';

        // 任务包组（异步加载）
        var activePackages = AA._state._activePackageFilters || [];
        html += '<div class="aa-tab-group" style="margin-top:2px;"><span class="aa-tab-label">任务包</span>';
        html += '<span class="aa-tab' + (activePackages.length === 0 ? ' on' : '') + '" data-group="package" data-filter="all" onclick="AA.toggleTaskFilter(\'all\', \'package\', this)">全部</span>';
        html += '<span id="aa-pkg-tabs-loading" style="font-size:11px;color:var(--text-muted);">加载中...</span>';
        html += '</div>';

        var el = document.getElementById('aa-task-tabs');
        if (el) el.innerHTML = html;

        // 异步加载任务包选项
        fetch('/api/task_packages')
            .then(function(r) { return r.json(); })
            .then(function(d) {
                var packages = d.packages || [];
                // 从已加载的 tasks 计算每个包的 total_min 和 task_count
                packages.forEach(function(pkg) {
                    var pkgTasks = AA._state.tasks.filter(function(t) { return t.package_id === pkg.id; });
                    var totalMin = 0;
                    pkgTasks.forEach(function(t) {
                        totalMin += t.est_seconds ? Math.round(t.est_seconds / 60) : 120;
                    });
                    pkg.total_min = totalMin;
                    pkg.task_count = pkgTasks.length;
                });
                AA._state._packages = packages;
                var pkgTabsHtml = '';
                packages.forEach(function(pkg) {
                    var isOn = activePackages.indexOf(pkg.id) >= 0;
                    pkgTabsHtml += '<span class="aa-tab' + (isOn ? ' on' : '') + '" data-group="package" data-filter="package:' + pkg.id + '" onclick="AA.toggleTaskFilter(\'package:' + pkg.id + '\', \'package\', this)">' + escHtml(pkg.name) + '</span>';
                });
                var loadingEl = document.getElementById('aa-pkg-tabs-loading');
                if (loadingEl) loadingEl.outerHTML = pkgTabsHtml;
            });
    },

    _renderTasks: function() {
        var activeTypes = AA._state._activeTaskTypeFilters;
        var activeKinds = AA._state._activeTaskKindFilters;
        var list = AA._state.tasks.slice();

        if (activeTypes.length > 0 || activeKinds.length > 0) {
            list = list.filter(function(tk) {
                var typeOk = activeTypes.length === 0 || activeTypes.indexOf(tk.type) >= 0;
                var kindOk = activeKinds.length === 0 || activeKinds.indexOf(tk.task_kind) >= 0;
                return typeOk && kindOk;
            });
        }

        var activePackages = AA._state._activePackageFilters || [];
        if (activePackages.length > 0) {
            list = list.filter(function(tk) {
                return activePackages.indexOf(tk.package_id) >= 0;
            });
        }

        var sel = AA._state._selectedTaskIds || {};
        var html = '';
        list.forEach(function(t) {
            var pri = t.priority || '';
            var durText = t.est_seconds ? Math.round(t.est_seconds / 60) + 'min' : (t.duration || '');
            var taskOn = sel[t.id] ? ' on' : '';
            html += '<div class="aa-item' + taskOn + '" data-id="' + t.id + '" onclick="AA.toggleTask(this)">';
            html += '<span class="aa-cb">✓</span>';
            if (pri) html += '<span class="aa-pri" style="' + AA._priStyle(pri) + '">' + escHtml(pri) + '</span>';
            html += '<span class="aa-name">' + escHtml(t.name || '') + '</span>';
            html += '<span class="aa-meta">' + escHtml(t.type || '') + ' · ' + escHtml(durText) + '</span>';
            html += '</div>';
        });
        if (!list.length) html = '<div style="padding:12px;color:#999;text-align:center;">没有待分配任务</div>';
        var el = document.getElementById('aa-task-list');
        if (el) el.innerHTML = html;
        AA._updateTaskSummary();
    },

    toggleTask: function(el) {
        var id = parseInt(el.getAttribute('data-id'), 10);
        el.classList.toggle('on');
        var sel = AA._state._selectedTaskIds || {};
        if (el.classList.contains('on')) {
            sel[id] = true;
        } else {
            delete sel[id];
        }
        AA._updateTaskSummary();
        AA._clearPreview();
    },

    toggleTaskFilter: function(filter, group, tabEl) {
        var arr;
        if (group === 'type') arr = AA._state._activeTaskTypeFilters;
        else if (group === 'kind') arr = AA._state._activeTaskKindFilters;
        else if (group === 'package') arr = AA._state._activePackageFilters;
        else return;
        if (filter === 'all') {
            arr.length = 0;
        } else if (group === 'package') {
            var pid = parseInt(filter.slice(filter.indexOf(':') + 1), 10);
            var idx = arr.indexOf(pid);
            if (idx >= 0) { arr.splice(idx, 1); }
            else { arr.push(pid); }
        } else {
            var val = filter.slice(filter.indexOf(':') + 1);
            var idx = arr.indexOf(val);
            if (idx >= 0) {
                arr.splice(idx, 1);
            } else {
                arr.push(val);
            }
        }
        AA._renderTaskTabs();
        AA._renderTasks();
    },

    _updateTaskSummary: function() {
        var sel = AA._state._selectedTaskIds || {};
        var count = Object.keys(sel).length;
        var el = document.getElementById('aa-summary-task');
        if (el) el.textContent = count + ' 个待分配 · 按优先级排列';
    },

    _priStyle: function(pri) {
        var colors = { 'P0': 'background:#fee2e2;color:#dc2626;', 'P1': 'background:#fef3c7;color:#d97706;' };
        return colors[pri] || 'background:#f1f5f9;color:#94a3b8;';
    },

    // ========== 高级选项 ==========

    _loadAdvanced: function() {
        try {
            var saved = JSON.parse(localStorage.getItem('aa_advanced') || '{}');
            var gapEl = document.getElementById('aa-gap');
            var startAvoidEl = document.getElementById('aa-start-avoid-breaks');
            var endAvoidEl = document.getElementById('aa-end-avoid-breaks');
            var extendEl = document.getElementById('aa-extend-breaks');
            if (gapEl) gapEl.value = saved.gap !== undefined ? saved.gap : 0;
            if (startAvoidEl) startAvoidEl.checked = saved.startAvoidBreaks === true;
            if (endAvoidEl) endAvoidEl.checked = saved.endAvoidBreaks === true;
            if (extendEl) extendEl.checked = saved.extendBreaks !== false;
        } catch(e) {}
    },

    saveAdvanced: function() {
        try {
            var gapEl = document.getElementById('aa-gap');
            var startAvoidEl = document.getElementById('aa-start-avoid-breaks');
            var endAvoidEl = document.getElementById('aa-end-avoid-breaks');
            var extendEl = document.getElementById('aa-extend-breaks');
            localStorage.setItem('aa_advanced', JSON.stringify({
                gap: gapEl ? gapEl.value : 0,
                startAvoidBreaks: startAvoidEl ? startAvoidEl.checked : false,
                endAvoidBreaks: endAvoidEl ? endAvoidEl.checked : false,
                extendBreaks: extendEl ? extendEl.checked : true,
            }));
        } catch(e) {}
        AA._updateAdvancedSummary();
    },

    _updateAdvancedSummary: function() {
        var gapEl = document.getElementById('aa-gap');
        var startAvoidEl = document.getElementById('aa-start-avoid-breaks');
        var endAvoidEl = document.getElementById('aa-end-avoid-breaks');
        var extendEl = document.getElementById('aa-extend-breaks');
        var gap = gapEl ? (gapEl.value || '0') : '0';
        var startAvoid = startAvoidEl ? startAvoidEl.checked : false;
        var endAvoid = endAvoidEl ? endAvoidEl.checked : false;
        var extend = extendEl ? extendEl.checked : true;
        var parts = ['间隔' + gap + '分钟'];
        if (startAvoid && endAvoid) {
            parts.push('避开休息');
        } else if (startAvoid) {
            parts.push('避开开始');
        } else if (endAvoid) {
            parts.push('避开结束');
        } else {
            parts.push('覆盖休息');
        }
        parts.push(extend ? '自动延长' : '不加时');
        var el = document.getElementById('aa-summary-advanced');
        if (el) el.textContent = parts.join(' · ');
    },

    addExclusion: function() {
        var container = document.getElementById('aa-exclusion-list');
        if (!container) return;
        var idx = Date.now();
        var div = document.createElement('div');
        div.id = 'ex-' + idx;
        div.style.cssText = 'display:flex;align-items:center;gap:4px;margin-top:4px;';
        div.innerHTML = '<input class="ex-start" placeholder="08:00" style="width:70px;height:28px;border:1px solid #ddd;border-radius:4px;padding:0 6px;font-size:12px;">' +
            '<span style="font-size:12px;">-</span>' +
            '<input class="ex-end" placeholder="09:00" style="width:70px;height:28px;border:1px solid #ddd;border-radius:4px;padding:0 6px;font-size:12px;">' +
            '<button onclick="document.getElementById(\'ex-' + idx + '\').remove();AA._clearPreview();" style="background:none;border:none;cursor:pointer;font-size:14px;color:#f56c6c;">&times;</button>';
        container.appendChild(div);
    },

    // ========== 预览/确认/撤销 ==========

    _getParams: function() {
        var timeP = AA._getTimeParams();
        var machineIds = [];
        document.querySelectorAll('#aa-machine-list .aa-item.on').forEach(function(el) {
            var id = parseInt(el.getAttribute('data-id'), 10);
            if (!isNaN(id)) machineIds.push(id);
        });
        var taskIds = [];
        document.querySelectorAll('#aa-task-list .aa-item.on').forEach(function(el) {
            var id = parseInt(el.getAttribute('data-id'), 10);
            if (!isNaN(id)) taskIds.push(id);
        });
        var exclusions = [];
        var exclusionContainer = document.getElementById('aa-exclusion-list');
        if (exclusionContainer) {
            exclusionContainer.querySelectorAll('div[id^="ex-"]').forEach(function(row) {
                var s = row.querySelector('.ex-start');
                var e = row.querySelector('.ex-end');
                if (s && e) {
                    var sm = AA._hhmmToMin((s.value || '').trim());
                    var em = AA._hhmmToMin((e.value || '').trim());
                    if (sm !== null && em !== null && em > sm) exclusions.push([sm, em]);
                }
            });
        }
        // 分班模式：自动把另一种班次的时段加入排除列表
        var _aadm = '';
        try { _aadm = localStorage.getItem('displayMode') || 'continuous'; } catch(e) {}
        if (_aadm === 'split') {
            var _aavm = '';
            try { _aavm = localStorage.getItem('viewMode') || 'double'; } catch(e) {}
            var _opposite = null;
            if (_aavm === 'day' || _aavm === 'custom-day') _opposite = 'night';
            else if (_aavm === 'night' || _aavm === 'custom-night') _opposite = 'day';
            if (_opposite) {
                var _range = getViewRange();
                var _oppWins = getShiftWindows(_range[0], _range[1], _opposite);
                _oppWins.forEach(function(w) {
                    var ws = ((w.absStart % MINS_PER_DAY) + MINS_PER_DAY) % MINS_PER_DAY;
                    var we = ((w.absEnd % MINS_PER_DAY) + MINS_PER_DAY) % MINS_PER_DAY;
                    if (we <= ws) we = MINS_PER_DAY;
                    exclusions.push([ws, Math.min(we, MINS_PER_DAY)]);
                });
            }
        }
        var dateEl = document.getElementById('schedule-date');
        var gapEl = document.getElementById('aa-gap');
        var startAvoidEl = document.getElementById('aa-start-avoid-breaks');
        var endAvoidEl = document.getElementById('aa-end-avoid-breaks');
        var extendEl = document.getElementById('aa-extend-breaks');
        return {
            date: dateEl ? dateEl.value : '',
            task_ids: taskIds,
            machine_ids: machineIds,
            gap: parseInt(gapEl ? (gapEl.value || '0') : '0', 10),
            work_start_min: timeP.ws,
            work_end_min: timeP.we,
            from_mode: timeP.from_mode,
            to_mode: timeP.to_mode,
            from_date: timeP.from_date,
            from_time: timeP.from_time,
            to_date: timeP.to_date,
            to_time: timeP.to_time,
            exclusion_periods: exclusions,
            avoid_break_start: startAvoidEl ? startAvoidEl.checked : false,
            avoid_break_end: endAvoidEl ? endAvoidEl.checked : false,
            extend_over_breaks: extendEl ? extendEl.checked : true,
        };
    },

    _hhmmToMin: function(s) {
        var parts = s.split(':');
        if (parts.length !== 2) return null;
        var h = parseInt(parts[0], 10), m = parseInt(parts[1], 10);
        if (isNaN(h) || isNaN(m)) return null;
        return h * 60 + m;
    },

    preview: function() {
        var params = AA._getParams();
        if (params.machine_ids.length === 0) { showToast('请至少选择一台机器'); return; }
        if (params.task_ids.length === 0) { showToast('请至少选择一个任务'); return; }

        // 将约束扁平化为 package_group_map
        var pkgGroupMap = {};
        Object.keys(AA._state._constraints).forEach(function(g) {
            (AA._state._constraints[g] || []).forEach(function(pid) {
                pkgGroupMap[pid] = g;
            });
        });
        params.package_group_map = pkgGroupMap;

        // 记录右面板状态，预览前关闭
        AA._state._panelWasOpen = AA._isConstraintPanelOpen();
        AA._closeConstraintPanel();

        var btn = document.getElementById('aa-btn-preview');
        if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>预览中...'; }

        fetch('/auto_assign_preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            AA._state.previewData = data;
            AA._state.previewParams = JSON.parse(JSON.stringify(params));
            AA._showPreviewOnTimeline(data);
            AA._showPreviewBar(data);
            AA.close();
        })
        .catch(function() {
            showToast('网络异常，请重试');
        })
        .finally(function() {
            if (btn) { btn.disabled = false; btn.innerHTML = '预览分配'; }
        });
    },

    confirm: function() {
        var params = AA._state.previewParams;
        if (!params) {
            params = AA._getParams();
            if (params.machine_ids.length === 0) { showToast('请至少选择一台机器'); return; }
            if (params.task_ids.length === 0) { showToast('请至少选择一个任务'); return; }
        }

        var btn = document.getElementById('aa-btn-confirm');
        if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>确认中...'; }

        fetch('/auto_assign', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            AA._hidePreviewBar();
            AA._clearTimelinePreview();
            AA._state.previewData = null;
            AA._state.previewParams = null;
            AA.close();
            showToast(data.msg || '分配完成');
            if (typeof _silentRefresh === 'function') _silentRefresh();
        })
        .catch(function() {
            showToast('网络异常，请重试');
        })
        .finally(function() {
            if (btn) { btn.disabled = false; btn.innerHTML = '确认分配'; }
        });
    },


    // ========== 预览浮动栏 ==========

    _showPreviewBar: function(data) {
        var bar = document.getElementById('aa-preview-bar');
        var count = (data.assigned || []).length;
        var countEl = document.getElementById('aa-preview-count');
        if (countEl) countEl.textContent = count + ' 个任务待确认';
        if (bar) bar.style.display = 'flex';
    },

    _hidePreviewBar: function() {
        var bar = document.getElementById('aa-preview-bar');
        if (bar) bar.style.display = 'none';
    },

    returnToAdjust: function() {
        AA._clearTimelinePreview();
        AA._hidePreviewBar();
        AA.open(true);
    },

    confirmFromBar: function() {
        AA.confirm();
    },

    cancelPreview: function() {
        AA._hidePreviewBar();
        AA._clearTimelinePreview();
        AA._state.previewData = null;
        AA._state.previewParams = null;
        AA._state._panelWasOpen = false;
    },

    _clearPreview: function() {
        AA._clearTimelinePreview();
        AA._hidePreviewBar();
        AA._state.previewData = null;
        AA._state.previewParams = null;
    },

    // ========== 时间轴预览卡片 ==========

    _showPreviewOnTimeline: function(data) {
        AA._clearTimelinePreview();
        if (typeof window._renderPreviewCards === 'function') {
            window._renderPreviewCards(data.assigned || []);
        }
        AA._markPoolPreview(data.assigned || []);
        var event = new CustomEvent('aa-preview', { detail: data });
        document.dispatchEvent(event);
    },

    _clearTimelinePreview: function() {
        if (typeof window._clearPreviewCards === 'function') {
            window._clearPreviewCards();
        }
        AA._unmarkPoolPreview();
        var event = new CustomEvent('aa-preview-clear');
        document.dispatchEvent(event);
    },

    // ========== 任务池预览标记 ==========

    _markPoolPreview: function(assigned) {
        var ids = {};
        assigned.forEach(function(a) { ids[a.task_id] = true; });
        var items = document.querySelectorAll('#pool-task-items .task-draggable');
        var marked = 0;
        items.forEach(function(el) {
            var tid = parseInt(el.getAttribute('data-tid'), 10);
            if (ids[tid]) { el.classList.add('aa-pool-preview'); marked++; }
        });
        console.log('[aa-preview] _markPoolPreview: ' + items.length + ' pool items, ' + marked + ' marked as preview');
    },

    _unmarkPoolPreview: function() {
        var items = document.querySelectorAll('#pool-task-items .task-draggable.aa-pool-preview');
        items.forEach(function(el) { el.classList.remove('aa-pool-preview'); });
    },

    // ========== 键盘和初始化 ==========

    _initKeyboard: function() {
        document.addEventListener('keydown', function(e) {
            var dlg = document.getElementById('auto-assign-dialog');
            if (!dlg || dlg.style.display === 'none') return;
            if (e.key === 'Escape') {
                AA.cancel();
            } else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'INPUT') {
                e.preventDefault();
                AA.preview();
            }
        });
    },
};

// 初始化
document.addEventListener('DOMContentLoaded', function() {
    AA._initKeyboard();
    AA._updateAdvancedSummary();
});
