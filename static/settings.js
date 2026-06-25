// golden scheduling app — settings panel

var _settingsData = {};
var _settingsLoaded = false;

// ========== 子页面切换 ==========
function switchSettingsSub(i) {
    _setLS('activeSettingsSub', String(i));
    document.querySelectorAll('.settings-tab').forEach(function (b, k) {
        b.className = k === i ? 'settings-tab active' : 'settings-tab';
    });
    document.querySelectorAll('.settings-subpage').forEach(function (p, k) {
        p.className = k === i ? 'settings-subpage active' : 'settings-subpage';
    });
    if (i === 6) {
        loadSaveList();
        if (typeof initSaveDropZone === 'function') initSaveDropZone();
    }
    if (i === 7) {
        loadFeishuCredentials();
    }
    // 同步侧边栏子导航高亮
    var subItems = document.querySelectorAll('.sidebar-settings-subnav .settings-sub-item');
    subItems.forEach(function(b, k) {
        if (k === i) {
            b.classList.add('active');
        } else {
            b.classList.remove('active');
        }
    });
}

// ========== 加载设置数据 ==========
function loadSettings() {
    if (_settingsLoaded) return;
    fetch('/api/settings')
        .then(function (r) { return r.json(); })
        .then(function (data) {
            _settingsData = data;
            _settingsLoaded = true;
            renderEnumTable('machine_types', 's-machine-types-table', '机器类型');
            renderEnumTable('task_kinds', 's-task-kinds-table', '任务类型');
            renderEnumTable('priorities', 's-priorities-table', '优先级');
            renderEnumTable('difficulties', 's-difficulties-table', '难度');
            renderNavOrder();
            applyStoredUISettings();
            _updateDisplayModeUI();
            try { loadPriorityColorSettings(); } catch(e) {}
        }).catch(function(){
            showToast('设置加载失败，请检查网络或刷新页面');
        });
}

// ========== 枚举表格渲染 ==========
function renderEnumTable(category, tableId, label) {
    var items = _settingsData[category] || [];
    var table = document.getElementById(tableId);
    if (!table) return;
    var isDifficulty = category === 'difficulties';
    var html = '<tr><th>名称</th><th>排序</th><th>引用</th><th>操作</th></tr>';
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var key = item.key;
        var isProtected = isDifficulty && key === '无';
        var refCount = _getRefCount(category, key);
        var refText = refCount > 0 ? String(refCount) : '-';
        var disabled = isProtected ? ' disabled' : '';
        var renameBtn = isProtected
            ? '<button class="btn" disabled title="\'无\'不可改名">改名</button>'
            : '<button class="btn" onclick="settingsStartRename(\'' + category + '\',\'' + escHtml(key) + '\',this)">改名</button>';
        var delBtn = isProtected
            ? '<button disabled title="\'无\'不可删除">删除</button>'
            : '<button class="btn-danger" onclick="settingsDelete(\'' + category + '\',\'' + escHtml(key) + '\')">删除</button>';
        var upBtn = i > 0
            ? '<button onclick="settingsReorder(\'' + category + '\',' + i + ',' + (i - 1) + ')" title="上移">&#8593;</button>'
            : '<button disabled>&#8593;</button>';
        var downBtn = i < items.length - 1
            ? '<button onclick="settingsReorder(\'' + category + '\',' + i + ',' + (i + 1) + ')" title="下移">&#8595;</button>'
            : '<button disabled>&#8595;</button>';

        html += '<tr data-cat="' + category + '" data-key="' + escHtml(key) + '">' +
            '<td><span class="settings-key-text">' + escHtml(key) + '</span></td>' +
            '<td>' + upBtn + ' ' + downBtn + '</td>' +
            '<td style="font-size:12px;color:var(--text-muted);">' + refText + '</td>' +
            '<td>' + renameBtn + ' ' + delBtn + '</td>' +
            '</tr>';
    }
    table.innerHTML = html;
}

function _getRefCount(category, key) {
    // APP_CONFIG is injected by the template — use it to check references
    if (typeof APP_CONFIG === 'undefined') return 0;
    var refMap = {
        'machine_types': { table: 'machines', col: 'type' },
        'machine_statuses': { table: 'machines', col: 'status' },
        'task_kinds': { table: 'machines', col: 'task_kind' },
    };
    // We can't compute exact refs client-side without querying, so return 0
    // The real reference check is enforced server-side on delete
    return 0;
}

// ========== 枚举 CRUD ==========
function settingsAdd(category) {
    var inputMap = {
        'machine_types': 's_mtype_key',
        'task_kinds': 's_tkind_key',
        'priorities': 's_pri_key',
        'difficulties': 's_diff_key',
    };
    var inputId = inputMap[category];
    var input = document.getElementById(inputId);
    if (!input) return;
    var key = input.value.trim();
    if (!key) { showToast('请输入名称'); return; }

    fetch('/api/settings/' + category + '/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: key }),
    })
        .then(function (r) { return r.json(); })
        .then(function (d) {
            showToast(d.msg);
            if (d.msg === '添加成功') {
                input.value = '';
                refreshAfterSettingsChange(category);
            }
        });
}

function settingsDelete(category, key) {
    showConfirm('确定删除', '确定删除"' + key + '"？<br>该操作不可恢复。').then(function (ok) {
        if (!ok) return;
        fetch('/api/settings/' + category + '/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: key }),
        })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                showToast(d.msg);
                refreshAfterSettingsChange(category);
            });
    });
}

function settingsStartRename(category, oldKey, btn) {
    var row = btn.closest('tr');
    var textSpan = row.querySelector('.settings-key-text');
    if (!textSpan) return;
    var current = textSpan.textContent;
    textSpan.innerHTML = '<input value="' + escHtml(current) + '" style="width:130px" id="rename-' + category + '">' +
        '<button class="btn" onclick="settingsConfirmRename(\'' + category + '\',\'' + escHtml(oldKey) + '\')">保存</button>' +
        '<button onclick="settingsCancelRename(\'' + category + '\')">取消</button>';
    var inp = document.getElementById('rename-' + category);
    if (inp) { inp.focus(); inp.select(); }
}

function settingsConfirmRename(category, oldKey) {
    var inp = document.getElementById('rename-' + category);
    if (!inp) return;
    var newKey = inp.value.trim();
    if (!newKey) { showToast('名称不能为空'); return; }
    fetch('/api/settings/' + category + '/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old_key: oldKey, new_key: newKey, value: '' }),
    })
        .then(function (r) { return r.json(); })
        .then(function (d) {
            showToast(d.msg);
            refreshAfterSettingsChange(category);
        });
}

function settingsCancelRename(category) {
    // 直接从 _settingsData 重新渲染表格，不发起网络请求
    var tableMap = {
        'machine_types': 's-machine-types-table',
        'task_kinds': 's-task-kinds-table',
        'priorities': 's-priorities-table',
        'difficulties': 's-difficulties-table',
    };
    var labelMap = {
        'machine_types': '机器类型',
        'task_kinds': '任务类型',
        'priorities': '优先级',
        'difficulties': '难度',
    };
    var tbl = tableMap[category];
    var lbl = labelMap[category];
    if (tbl && lbl) renderEnumTable(category, tbl, lbl);
}

function settingsReorder(category, fromIdx, toIdx) {
    var items = (_settingsData[category] || []).slice();
    if (fromIdx < 0 || fromIdx >= items.length || toIdx < 0 || toIdx >= items.length) return;
    var tmp = items[fromIdx];
    items[fromIdx] = items[toIdx];
    items[toIdx] = tmp;
    var keys = items.map(function (it) { return it.key; });
    fetch('/api/settings/' + category + '/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys: keys }),
    })
        .then(function (r) { return r.json(); })
        .then(function (d) {
            showToast(d.msg);
            if (d.msg === '排序已保存') {
                refreshAfterSettingsChange(category);
            }
        });
}

// ========== UI 设置 ==========
function applyUISetting(key, value) {
    // Save to server
    fetch('/api/settings/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ category: 'ui_settings', key: key, value: String(value) }] }),
    });

    // Apply immediately
    // 不透明度设置（查表驱动）
    var opCfg = _OPACITY_SETTINGS[key];
    if (opCfg) {
        var valEl = document.getElementById(opCfg.valId);
        if (valEl) valEl.textContent = value;
        document.documentElement.style.setProperty(opCfg.cssVar, String(value));
    }
    // 视觉特效切换（查表驱动）
    var visCfg = _VISUAL_EFFECT_TOGGLES[key];
    if (visCfg) {
        if (value === '1' && typeof window[visCfg.startFn] === 'function') {
            window[visCfg.startFn]();
        } else if (typeof window[visCfg.stopFn] === 'function') {
            window[visCfg.stopFn]();
        }
    }

    if (key === 'toast_duration') {
        var durVal = document.getElementById('s-toast-duration-val');
        if (durVal) durVal.textContent = value;
    } else if (key === 'show_shift_overlay') {
        var show = value === '1';
        document.querySelectorAll('.shift-overlay').forEach(function (el) {
            el.style.display = show ? '' : 'none';
        });
    } else if (key === 'enable_animations') {
        document.body.classList.toggle('no-animations', value !== '1');
    } else if (key === 'export_filename') {
        document.getElementById('s-export-preview').textContent = value + '（2024-01-01~2024-01-07）.xlsx';
    } else if (key === 'button_ripple') {
        document.body.classList.toggle('no-ripple', value !== '1');
    } else if (key === 'glow_hover') {
        document.body.classList.toggle('glow-hover', value === '1');
    } else if (key === 'night_view_style') {
        _setLS('nightViewStyle', String(value));
        if (typeof updateNightOffsetToggle === 'function') updateNightOffsetToggle();
        const isNight = document.getElementById('view-mode').value === 'night';
        if(isNight){
            renderViewMask(true);
            rebuildTimelineGrid(true);
            renderShiftOverlaySegments();
        }
    } else if (key === 'task_block_font_size') {
        var fontVal = document.getElementById('s-task-block-font-size-val');
        if (fontVal) fontVal.textContent = value + 'px';
        document.documentElement.style.setProperty('--task-block-font-size', String(value) + 'px');
    }

    // Persist to localStorage for quick read on next load
    _setLS('ui_' + key, String(value));
}

function applyStoredUISettings() {
    var ui = {};
    (_settingsData['ui_settings'] || []).forEach(function (item) {
        ui[item.key] = item.value;
    });

    // 不透明度设置（查表驱动，消除重复代码）
    for (var opKey in _OPACITY_SETTINGS) {
        if (!_OPACITY_SETTINGS.hasOwnProperty(opKey)) continue;
        var cfg = _OPACITY_SETTINGS[opKey];
        var val = ui[opKey] || cfg.defaultValue;
        var slider = document.getElementById(cfg.sliderId);
        if (slider) slider.value = val;
        var valEl = document.getElementById(cfg.valId);
        if (valEl) valEl.textContent = val;
        document.documentElement.style.setProperty(cfg.cssVar, String(val));
    }

    // Show overlay
    var showOverlay = ui['show_shift_overlay'] || '1';
    var overlayCheck = document.getElementById('s-show-overlay');
    if (overlayCheck) { overlayCheck.checked = showOverlay === '1'; }

    // Animations
    var enableAnim = ui['enable_animations'] || '1';
    var animCheck = document.getElementById('s-enable-animations');
    if (animCheck) { animCheck.checked = enableAnim === '1'; }
    document.body.classList.toggle('no-animations', enableAnim !== '1');

    // Tooltip animation
    var tooltipAnim = ui['enable_tooltip_animation'] || '1';
    var tooltipAnimCheck = document.getElementById('s-enable-tooltip-anim');
    if (tooltipAnimCheck) { tooltipAnimCheck.checked = tooltipAnim === '1'; }

    // Tooltip delay
    var tooltipDelay = ui['tooltip_delay'] || '3';
    var tooltipDelayInput = document.getElementById('s-tooltip-delay');
    if (tooltipDelayInput) { tooltipDelayInput.value = tooltipDelay; }

    // Export filename
    var exportName = ui['export_filename'] || '排班已完成任务';
    var exportInput = document.getElementById('s-export-filename');
    if (exportInput) { exportInput.value = exportName; }
    var preview = document.getElementById('s-export-preview');
    if (preview) { preview.textContent = exportName + '（2024-01-01~2024-01-07）.xlsx'; }

    // Toast duration
    var toastDur = ui['toast_duration'] || '3';
    var toastSlider = document.getElementById('s-toast-duration');
    if (toastSlider) { toastSlider.value = toastDur; }
    var toastVal = document.getElementById('s-toast-duration-val');
    if (toastVal) { toastVal.textContent = toastDur; }

    // Split placement (schedule_settings)
    var ss = {};
    (_settingsData['schedule_settings'] || []).forEach(function (item) {
        ss[item.key] = item.value;
    });
    var splitPlacement = ss['split_placement'] || 'inline';
    var inlineRadio = document.querySelector('input[name="s-split-placement"][value="inline"]');
    var poolRadio = document.querySelector('input[name="s-split-placement"][value="pool"]');
    if (splitPlacement === 'pool' && poolRadio) {
        poolRadio.checked = true;
    } else if (inlineRadio) {
        inlineRadio.checked = true;
    }

    // cross_type_block（schedule_settings）
    var crossTypeBlock = ss['cross_type_block'] === '1';
    window._crossTypeBlockSetting = crossTypeBlock;
    var ctbCheck = document.getElementById('s-cross-type-block');
    if (ctbCheck) { ctbCheck.checked = crossTypeBlock; }

    // compact_task_label（schedule_settings）
    var compactLabel = ss['compact_task_label'] === '1';
    window._compactTaskLabel = compactLabel;
    var ctlCheck = document.getElementById('s-compact-task-label');
    if (ctlCheck) { ctlCheck.checked = compactLabel; }

    // show_package_name（schedule_settings）
    var showPkg = ss['show_package_name'] !== '0';  // 默认开启
    window._showPackageName = showPkg;
    var spnCheck = document.getElementById('s-show-package-name');
    if (spnCheck) { spnCheck.checked = showPkg; }

    // pool_modern_style（schedule_settings）
    var poolModern = ss['pool_modern_style'] === '1';
    var poolEl = document.getElementById('task-pool');
    if (poolEl) { poolEl.classList.toggle('pool-style-modern', poolModern); }
    var pmsCheck = document.getElementById('s-pool-modern-style');
    if (pmsCheck) { pmsCheck.checked = poolModern; }
    // 列数
    var poolColsRow = document.getElementById('pool-columns-row');
    if (poolColsRow) { poolColsRow.style.display = poolModern ? 'flex' : 'none'; }
    var poolCols = parseInt(ss['pool_modern_columns'], 10) || 2;
    var pmsSlider = document.getElementById('s-pool-modern-columns');
    if (pmsSlider) { pmsSlider.value = poolCols; }
    var pmsDisplay = document.getElementById('pool-cols-display');
    if (pmsDisplay) { pmsDisplay.textContent = poolCols; }
    if (poolEl) { poolEl.style.setProperty('--pool-columns', poolCols); }

    // snap to break toggles
    var snapStart = ss['snap_start_to_break'] === '1';
    window._snapStartToBreak = snapStart;
    var ssbCheck = document.getElementById('snap-start-break');
    if (ssbCheck) { ssbCheck.checked = snapStart; }

    var snapEnd = ss['snap_end_to_break'] === '1';
    window._snapEndToBreak = snapEnd;
    var sebCheck = document.getElementById('snap-end-break');
    if (sebCheck) { sebCheck.checked = snapEnd; }

    // 即将提醒阈值
    var pendingAlert = ss['pending_alert_minutes'] || '15';
    var pendingSlider = document.getElementById('s-pending-alert-minutes');
    if (pendingSlider) { pendingSlider.value = pendingAlert; }
    var pendingVal = document.getElementById('s-pending-alert-val');
    if (pendingVal) { pendingVal.textContent = pendingAlert; }

    // 班次采集速率（双参数反推 + 时长）
    window.updateRateDisplay = function(rate) {
        var effMin = parseInt(document.getElementById('s-effective-minutes').value, 10) || 570;
        var per25 = (25 * effMin / rate).toFixed(1);
        var d25Disp = document.getElementById('rate-per-25-display');
        if (d25Disp) d25Disp.textContent = per25;
    };
    window.onRateParamChange = function() {
        var totalItems = parseInt(document.getElementById('s-total-items').value, 10) || 3600;
        var machineCount = parseInt(document.getElementById('s-machine-count').value, 10) || 24;
        var effMin = parseInt(document.getElementById('s-effective-minutes').value, 10) || 570;
        var rate = Math.max(1, Math.round(totalItems / machineCount));
        document.getElementById('s-rate-per-shift').value = rate;
        // Save all three
        var items = [
            { category: 'schedule_settings', key: 'rate_per_shift', value: String(rate) },
            { category: 'schedule_settings', key: 'machine_count', value: String(machineCount) },
            { category: 'schedule_settings', key: 'effective_minutes', value: String(effMin) },
        ];
        fetch('/api/settings/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: items }),
        }).catch(function(){});
        updateRateDisplay(rate);
    };
    var savedRate = parseInt(ss['rate_per_shift'], 10) || 150;
    var savedMachines = parseInt(ss['machine_count'], 10) || 24;
    var savedEffMin = parseInt(ss['effective_minutes'], 10) || 570;
    var rateEl = document.getElementById('s-rate-per-shift');
    var totalEl = document.getElementById('s-total-items');
    var machEl = document.getElementById('s-machine-count');
    var effEl = document.getElementById('s-effective-minutes');
    if (rateEl) rateEl.value = savedRate;
    if (totalEl) totalEl.value = savedRate * savedMachines;
    if (machEl) machEl.value = savedMachines;
    if (effEl) effEl.value = savedEffMin;
    updateRateDisplay(savedRate);

    // 自动存档保留天数
    var retentionDays = ss['autosave_retention_days'] || '60';
    var retSlider = document.getElementById('s-autosave-retention');
    var retDisplay = document.getElementById('autosave-retention-display');
    if (retSlider) {
        retSlider.value = retentionDays;
        retSlider.oninput = function() {
            applyScheduleSetting('autosave_retention_days', this.value);
            if (retDisplay) retDisplay.textContent = this.value;
        };
    }
    if (retDisplay) retDisplay.textContent = retentionDays;

    // Particle background
    var particleBg = ui['particle_background'] || '0';
    var particleCheck = document.getElementById('s-particle-bg');
    if (particleCheck) { particleCheck.checked = particleBg === '1'; }
    // Button ripple
    var btnRipple = ui['button_ripple'];
    if (btnRipple === undefined) btnRipple = '1';
    var rippleCheck = document.getElementById('s-btn-ripple');
    if (rippleCheck) { rippleCheck.checked = btnRipple === '1'; }
    document.body.classList.toggle('no-ripple', btnRipple !== '1');
    // Glow hover
    var glowHover = ui['glow_hover'];
    if (glowHover === undefined) glowHover = '1';
    var glowCheck = document.getElementById('s-glow-hover');
    if (glowCheck) { glowCheck.checked = glowHover === '1'; }
    document.body.classList.toggle('glow-hover', glowHover === '1');
    // Ribbon effect
    var ribbonEff = ui['ribbon_effect'] || '0';
    var ribbonCheck = document.getElementById('s-ribbons');
    if (ribbonCheck) { ribbonCheck.checked = ribbonEff === '1'; }
    // Butterfly animation
    var butterflyAnim = ui['butterfly_animation'] || '0';
    var butterflyCheck = document.getElementById('s-butterflies');
    if (butterflyCheck) { butterflyCheck.checked = butterflyAnim === '1'; }
    if (butterflyAnim === '1' && typeof startButterflies === 'function') {
        startButterflies();
    }
    // Night view style
    var nightViewStyle = ui['night_view_style'] || 'simple';
    var nightViewSelect = document.getElementById('s-night-view-style');
    if (nightViewSelect) { nightViewSelect.value = nightViewStyle; }
    _setLS('nightViewStyle', nightViewStyle);

    // Task block font size
    var taskBlockFontSize = ui['task_block_font_size'] || '11';
    var taskBlockFontSlider = document.getElementById('s-task-block-font-size');
    if (taskBlockFontSlider) { taskBlockFontSlider.value = taskBlockFontSize; }
    var taskBlockFontVal = document.getElementById('s-task-block-font-size-val');
    if (taskBlockFontVal) { taskBlockFontVal.textContent = taskBlockFontSize + 'px'; }
    document.documentElement.style.setProperty('--task-block-font-size', taskBlockFontSize + 'px');

    // Theme mode radio
    var themeMode = localStorage.getItem('theme') || 'auto';
    var themeRadio = document.querySelector('input[name="s-theme-mode"][value="' + themeMode + '"]');
    if (themeRadio) themeRadio.checked = true;

    _applyStoredColors();
}

// schedule_settings 通用 localStorage 写入辅助
function _setScheduleStorage(key, value) {
    try {
        var ss = JSON.parse(localStorage.getItem('schedule_settings') || '{}');
        ss[key] = String(value);
        localStorage.setItem('schedule_settings', JSON.stringify(ss));
    } catch(e) {}
}

function applyScheduleSetting(key, value) {
    fetch('/api/settings/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ category: 'schedule_settings', key: key, value: String(value) }] }),
    }).catch(function(){});
    // 即时生效
    if (key === 'pool_modern_style') {
        var poolEl = document.getElementById('task-pool');
        if (poolEl) poolEl.classList.toggle('pool-style-modern', value === '1');
        var row = document.getElementById('pool-columns-row');
        if (row) row.style.display = (value === '1') ? 'flex' : 'none';
    }
    if (key === 'pool_modern_columns') {
        var poolEl = document.getElementById('task-pool');
        if (poolEl) poolEl.style.setProperty('--pool-columns', value);
        _setScheduleStorage('pool_modern_columns', value);
    }
    if (key === 'cross_type_block') {
        window._crossTypeBlockSetting = value === '1';
        _setLS('schedule_cross_type_block', String(value));
    }
    if (key === 'snap_start_to_break') {
        _setLS('schedule_snap_start_to_break', String(value));
    }
    if (key === 'snap_end_to_break') {
        _setLS('schedule_snap_end_to_break', String(value));
    }
    if (key === 'compact_task_label') {
        window._compactTaskLabel = value === '1';
        _setScheduleStorage('compact_task_label', value);
        if (typeof _renderAllTaskBlocks === 'function') _renderAllTaskBlocks();
    }
    if (key === 'show_package_name') {
        window._showPackageName = value !== '0';
        _setScheduleStorage('show_package_name', value);
        if (typeof _renderAllTaskBlocks === 'function') _renderAllTaskBlocks();
        if (typeof _renderTaskPool === 'function') _renderTaskPool();
    }
}

// ========== 导航顺序 ==========
function _getNavOrderItems() {
    // 合并 DB 配置 + NAV_TAB_MAP 中缺失的 tab，确保新增的 tab 不会丢失
    var items = (_settingsData['nav_order'] || []).slice();
    var seen = {};
    for (var i = 0; i < items.length; i++) { seen[items[i].key] = true; }
    // 按 NAV_TAB_MAP 的 index 顺序补上缺失的
    var byIdx = {};
    for (var k in NAV_TAB_MAP) { if (NAV_TAB_MAP.hasOwnProperty(k)) { byIdx[NAV_TAB_MAP[k]] = k; } }
    for (var j = 0; j <= 6; j++) {
        var nm = byIdx[j];
        if (nm !== undefined && !seen[nm]) {
            items.push({key: nm, sort_order: items.length + 1});
            seen[nm] = true;
        }
    }
    return items;
}

function renderNavOrder() {
    var items = _getNavOrderItems();
    var list = document.getElementById('s-nav-order');
    if (!list) return;
    var html = '';
    for (var i = 0; i < items.length; i++) {
        html += '<li draggable="true" data-key="' + escHtml(items[i].key) + '" data-idx="' + i + '"' +
            ' ondragstart="navDragStart(event)" ondragover="navDragOver(event)" ondragleave="navDragLeave(event)" ondrop="navDrop(event)">' +
            '<span class="drag-handle">&#9776;</span>' +
            '<span class="sort-index">' + (i + 1) + '.</span>' +
            '<span>' + escHtml(items[i].key) + '</span>' +
            '</li>';
    }
    list.innerHTML = html;
}

var _navDragIdx = -1;
function navDragStart(e) {
    _navDragIdx = parseInt(e.currentTarget.dataset.idx);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', e.currentTarget.dataset.key);
}
function navDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    var li = e.currentTarget;
    document.querySelectorAll('#s-nav-order li').forEach(function (el) { el.classList.remove('drag-over'); });
    li.classList.add('drag-over');
}
function navDragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
}
function navDrop(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    var targetIdx = parseInt(e.currentTarget.dataset.idx);
    if (_navDragIdx < 0 || targetIdx < 0 || _navDragIdx === targetIdx) return;
    var items = _getNavOrderItems();
    var moved = items.splice(_navDragIdx, 1)[0];
    items.splice(targetIdx, 0, moved);
    _settingsData['nav_order'] = items;
    renderNavOrder();
    _navDragIdx = -1;
}

function saveNavOrder() {
    var items = _getNavOrderItems();
    var keys = items.map(function (it) { return it.key; });
    fetch('/api/settings/nav_order/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys: keys }),
    })
        .then(function (r) { return r.json(); })
        .then(function (d) {
            showToast(d.msg);
            if (d.msg === '排序已保存') {
                APP_CONFIG.nav_order = items.slice();
                rebuildNavUI();
            }
        });
}

// ========== 下拉栏重建辅助 ==========
function _rebuildSelect(id, items, savedVal, includeAll, valueFn) {
    var sel = document.getElementById(id);
    if (!sel) return;
    var html = '';
    if (includeAll) {
        html += '<option value=""' + (!savedVal ? ' selected' : '') + '>全部</option>';
    }
    for (var i = 0; i < items.length; i++) {
        var key = items[i].key;
        var val = valueFn ? valueFn(key) : key;
        html += '<option value="' + escHtml(val) + '"' + (val === savedVal ? ' selected' : '') + '>' + escHtml(key) + '</option>';
    }
    sel.innerHTML = html;
}

function _captureSelectValues(ids) {
    var vals = {};
    for (var i = 0; i < ids.length; i++) {
        var el = document.getElementById(ids[i]);
        vals[ids[i]] = el ? el.value : '';
    }
    return vals;
}

function _diffValueFn(key) {
    return key === '无' ? '' : key;
}

// ========== 按类别同步下拉栏 ==========
function _syncMachineTypeUI() {
    var mts = APP_CONFIG.machine_types || [];
    var saved = _captureSelectValues([
        'm_type', 'machine-filter', 't_type', 'task-filter-type',
        'pool-filter-type', 'history-filter-type', 'ed_type', 'bm_type'
    ]);

    _rebuildSelect('m_type', mts, saved['m_type']);
    _rebuildSelect('machine-filter', mts, saved['machine-filter'], true);
    _rebuildSelect('t_type', mts, saved['t_type']);
    _rebuildSelect('task-filter-type', mts, saved['task-filter-type'], true);
    _rebuildSelect('pool-filter-type', mts, saved['pool-filter-type'], true);
    _rebuildSelect('history-filter-type', mts, saved['history-filter-type'], true);
    _rebuildSelect('ed_type', mts, saved['ed_type']);
    _rebuildSelect('bm_type', mts, saved['bm_type']);

    _rebuildTypeLinks('aa-type-links', mts, 'toggleAAMachinesByType');
    _rebuildTypeLinks('aa-task-type-links', mts, 'toggleAATasksByType');
    _rebuildTypeLinks('md-type-links', mts, 'toggleMDMachinesByType');

    if (typeof filterTaskPool === 'function') filterTaskPool();
    if (typeof applyTaskFilters === 'function') applyTaskFilters();
    if (typeof filterHistoryTable === 'function') filterHistoryTable();
}

function _syncTaskKindUI() {
    var kinds = APP_CONFIG.task_kinds || [];
    var saved = _captureSelectValues([
        'm_kind', 't_kind', 'task-filter-kind',
        'history-filter-kind', 'ed_kind', 'bm_kind', 'machine-kind-filter'
    ]);

    _rebuildSelect('m_kind', kinds, saved['m_kind']);
    _rebuildSelect('t_kind', kinds, saved['t_kind']);
    _rebuildSelect('task-filter-kind', kinds, saved['task-filter-kind'], true);
    _rebuildSelect('history-filter-kind', kinds, saved['history-filter-kind'], true);
    _rebuildSelect('ed_kind', kinds, saved['ed_kind']);
    _rebuildSelect('bm_kind', kinds, saved['bm_kind']);
    _rebuildSelect('machine-kind-filter', kinds, saved['machine-kind-filter'], true);

    _rebuildMachineRowKindSelects(kinds);
    _rebuildKindLinks('aa-kind-links', kinds, 'toggleAAMachinesByKind');
    _rebuildKindLinks('aa-task-kind-links', kinds, 'toggleAATasksByKind');

    if (typeof applyTaskFilters === 'function') applyTaskFilters();
    if (typeof filterHistoryTable === 'function') filterHistoryTable();
}

function _syncPriorityUI() {
    var pris = APP_CONFIG.priorities || [];
    var saved = _captureSelectValues(['t_pri', 'pool-filter-pri', 'ed_pri']);

    _rebuildSelect('t_pri', pris, saved['t_pri']);
    _rebuildSelect('pool-filter-pri', pris, saved['pool-filter-pri'], true);
    _rebuildSelect('ed_pri', pris, saved['ed_pri']);

    if (typeof filterTaskPool === 'function') filterTaskPool();
}

function _syncDifficultyUI() {
    var diffs = APP_CONFIG.difficulties || [];
    var saved = _captureSelectValues(['t_diff', 'pool-filter-diff', 'ed_diff']);

    _rebuildSelect('t_diff', diffs, saved['t_diff'], false, _diffValueFn);
    _rebuildSelect('pool-filter-diff', diffs, saved['pool-filter-diff'], true);
    _rebuildSelect('ed_diff', diffs, saved['ed_diff'], false, _diffValueFn);

    if (typeof filterTaskPool === 'function') filterTaskPool();
}

// ========== 类型链接重建 ==========
function _rebuildTypeLinks(containerId, mts, fnName) {
    var container = document.getElementById(containerId);
    if (!container) return;
    var html = '';
    for (var i = 0; i < mts.length; i++) {
        var mt = mts[i].key;
        html += '<a href="#" onclick="' + fnName + '(\'' + escHtml(mt) + '\');return false;" style="color:var(--type-color-' + i + ');' + (i > 0 ? 'margin-left:4px;' : '') + '">' + escHtml(mt) + '</a>';
    }
    container.innerHTML = html;
}

function _rebuildKindLinks(containerId, kinds, fnName) {
    var container = document.getElementById(containerId);
    if (!container) return;
    var html = '';
    for (var i = 0; i < kinds.length; i++) {
        var k = kinds[i].key;
        html += '<a href="#" onclick="' + fnName + '(\'' + escHtml(k) + '\');return false;"' + (i > 0 ? ' style="margin-left:4px;"' : '') + '>' + escHtml(k) + '</a>';
    }
    container.innerHTML = html;
}

// ========== 机器行内嵌任务类型下拉重建 ==========
function _rebuildMachineRowKindSelects(kinds) {
    var selects = document.querySelectorAll('select[id^="mk_"]');
    for (var s = 0; s < selects.length; s++) {
        var sel = selects[s];
        var curVal = sel.value;
        var html = '';
        for (var i = 0; i < kinds.length; i++) {
            var k = kinds[i].key;
            html += '<option' + (k === curVal ? ' selected' : '') + '>' + escHtml(k) + '</option>';
        }
        sel.innerHTML = html;
        sel.value = curVal;
    }
}

// ========== 时间轴和任务池CSS类名刷新 ==========
function _refreshTaskBlockClasses() {
    document.querySelectorAll('.task-block').forEach(function(block) {
        var typeName = block.dataset.type || '';
        for (var i = 0; i < 16; i++) { block.classList.remove('task-type-' + i); }
        var idx = (typeof TYPE_INDEX_MAP !== 'undefined' && TYPE_INDEX_MAP[typeName] !== undefined) ? TYPE_INDEX_MAP[typeName] : 0;
        block.classList.add('task-type-' + idx);
    });

    document.querySelectorAll('#task-pool .task-draggable').forEach(function(el) {
        var typeName = el.dataset.type || '';
        for (var i = 0; i < 16; i++) { el.classList.remove('task-type-' + i); }
        var idx = (typeof TYPE_INDEX_MAP !== 'undefined' && TYPE_INDEX_MAP[typeName] !== undefined) ? TYPE_INDEX_MAP[typeName] : 0;
        el.classList.add('task-type-' + idx);
    });
}

// ========== 设置变更后集中刷新 ==========
function refreshAfterSettingsChange(category) {
    _settingsLoaded = false;
    fetch('/api/settings')
        .then(function(r) { return r.json(); })
        .then(function(data) {
            _settingsData = data;
            _settingsLoaded = true;

            // 刷新设置子页面表格
            renderEnumTable('machine_types', 's-machine-types-table', '机器类型');
            renderEnumTable('task_kinds', 's-task-kinds-table', '任务类型');
            renderEnumTable('priorities', 's-priorities-table', '优先级');
            renderEnumTable('difficulties', 's-difficulties-table', '难度');
            renderNavOrder();
            applyStoredUISettings();

            // 更新 APP_CONFIG
            APP_CONFIG.machine_types = data.machine_types || [];
            APP_CONFIG.task_kinds = data.task_kinds || [];
            APP_CONFIG.priorities = data.priorities || [];
            APP_CONFIG.difficulties = data.difficulties || [];
            APP_CONFIG.machine_statuses = data.machine_statuses || [];
            APP_CONFIG.nav_order = data.nav_order || [];
            APP_CONFIG.ui_settings = data.ui_settings || [];

            // 重建 TYPE_INDEX_MAP
            for (var k in TYPE_INDEX_MAP) { delete TYPE_INDEX_MAP[k]; }
            var mts = data.machine_types || [];
            for (var i = 0; i < mts.length; i++) {
                TYPE_INDEX_MAP[mts[i].key] = i;
            }

            // 按变更类别同步UI
            if (category === 'machine_types') {
                _syncMachineTypeUI();
            }
            if (category === 'task_kinds') {
                _syncTaskKindUI();
            }
            if (category === 'priorities') {
                _syncPriorityUI();
            }
            if (category === 'difficulties') {
                _syncDifficultyUI();
            }

            // 重新应用颜色（APP_CONFIG 和 TYPE_INDEX_MAP 已刷新）
            _applyStoredColors();

            // 刷新任务块CSS类名
            _refreshTaskBlockClasses();

            // 时间轴和任务库数据刷新（排班面板切换时会重拉，但主动刷新更及时）
            if (category === 'machine_types' || category === 'task_kinds') {
                if (typeof silentRefreshSchedules === 'function') {
                    silentRefreshSchedules();
                }
            }
        })
        .catch(function(err) {
            console.error('refreshAfterSettingsChange failed:', err);
            showToast('刷新UI失败，请手动刷新页面');
        });
}

// ========== 历史记录名称同步 ==========
function openHistoryNameSync() {
    var catInput = prompt('请选择要同步的类别：\n1 - 机器类型\n2 - 任务类型\n（输入 1 或 2）', '1');
    if (!catInput) return;
    var catKey;
    if (catInput === '1') catKey = 'machine_types';
    else if (catInput === '2') catKey = 'task_kinds';
    else { showToast('无效选择'); return; }

    var oldName = prompt('旧名称（历史记录中显示的旧类型名）：');
    if (!oldName) return;

    var newName = prompt('新名称（当前设置中使用的名称）：');
    if (!newName) return;

    fetch('/api/settings/' + catKey + '/cascade-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old_key: oldName.trim(), new_key: newName.trim() })
    })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            showToast(d.msg);
            if (typeof _refreshHistory === 'function') _refreshHistory();
        })
        .catch(function() {
            showToast('同步失败');
        });
}

// ========== 恢复设置子页面状态 ==========
function restoreSettingsSub() {
    try {
        var idx = parseInt(localStorage.getItem('activeSettingsSub') || '0');
        if (idx >= 0 && idx <= 7) {
            switchSettingsSub(idx);
        }
    } catch (e) { }
}

// ========== 颜色设置 ==========
var _colorDefaults = {
    seg_work: '#facc15', seg_ot: '#f97316', seg_break: '#3b82f6', seg_gap: '#000000',
    completed: '#84cc16', split: '#a78bfa', repair_bg: '#fef2f2', repair_border: '#fca5a5',
    paused: '#fca5a5', post_pause: '#fbcfe8'
};
var _typeColorPalette = ['#3b82f6','#10b981','#f59e0b','#8b5cf6','#ef4444','#06b6d4','#f97316','#84cc16'];
var _segAlphas = { seg_work: 0.22, seg_ot: 0.22, seg_break: 0.22, seg_gap: 0.06 };
var _segCssVars = { seg_work: '--seg-color-work', seg_ot: '--seg-color-ot', seg_break: '--seg-color-break', seg_gap: '--seg-color-gap' };
var _stateCssVars = { completed: '--state-color-completed', split: '--state-color-split', repair_bg: '--state-color-repair-bg', repair_border: '--state-color-repair-border', paused: '--state-color-paused', post_pause: '--state-color-post-pause' };
var _stateDarkVars = { completed: '--state-color-completed-dark', split: '--state-color-split-dark', paused: '--state-color-paused-dark', post_pause: '--state-color-post-pause-dark' };

// ========== 不透明度 / 视觉特效查找表（消除 applyUISetting / applyStoredUISettings 重复分支） ==========
var _OPACITY_SETTINGS = {
    'overlay_transparency':       { sliderId: 's-overlay-transparency',       valId: 's-transparency-val',         cssVar: '--dialog-overlay-opacity',    defaultValue: '0.85' },
    'schedule_dialog_bg_opacity': { sliderId: 's-schedule-dialog-bg-opacity', valId: 's-schedule-dialog-bg-val',   cssVar: '--dialog-bg-opacity',         defaultValue: '1' },
    'task_dialog_bg_opacity':     { sliderId: 's-task-dialog-bg-opacity',     valId: 's-task-dialog-bg-val',       cssVar: '--edit-dialog-bg-opacity',    defaultValue: '1' },
    'hist_dialog_bg_opacity':     { sliderId: 's-hist-dialog-bg-opacity',     valId: 's-hist-dialog-bg-val',       cssVar: '--hist-dialog-bg-opacity',    defaultValue: '1' }
};

var _VISUAL_EFFECT_TOGGLES = {
    'particle_background': { startFn: 'startParticleBackground', stopFn: 'stopParticleBackground' },
    'ribbon_effect':       { startFn: 'startRibbons',             stopFn: 'stopRibbons' },
    'butterfly_animation': { startFn: 'startButterflies',         stopFn: 'stopButterflies' }
};

// ========== 飞书同步 UI 控制 ==========

function toggleFeishuSync(enabled) {
    var toggle = document.getElementById('feishu-toggle');
    var label = document.getElementById('feishu-toggle-label');
    var statusArea = document.getElementById('feishu-status-area');

    if (!enabled) {
        // 关闭
        if (toggle) toggle.classList.remove('active');
        if (label) label.textContent = '飞书同步已关闭';
        if (statusArea) statusArea.style.display = 'none';
        _pushConfigLoaded = false;  // 下次开启时重新加载
        // 推送开关复位，但配置区保持可编辑（用户可以先填群聊ID再开推送）
        var pushToggle = document.getElementById('push-toggle');
        var pushLabel = document.getElementById('push-toggle-label');
        if (pushToggle) pushToggle.classList.remove('active');
        if (pushLabel) pushLabel.textContent = '推送已关闭';
        if (typeof FeishuSync !== 'undefined') {
            FeishuSync.toggle(false).then(function() { refreshFeishuStatus(); });
        } else {
            toggleFeishuSyncFallback(false);
        }
        return;
    }

    // 开启：弹出方向选择（先不设置 toggle 状态，等用户选择方向后再开）
    // 先获取同步状态，拿到 last_pull_at
    fetch('/api/feishu/status').then(function(r) { return r.json(); }).then(function(s) {
        var lastSyncHint = _buildLastSyncHint(s);
        _renderFeishuDirDialog(lastSyncHint, statusArea, toggle, label);
    }).catch(function() {
        _renderFeishuDirDialog('', statusArea, toggle, label);
    });
}

function _buildLastSyncHint(s) {
    if (s.last_pull_at || s.last_push_at) {
        var latest = s.last_pull_at || s.last_push_at;
        var elapsed = '';
        try {
            var then = new Date(latest.replace(/-/g, '/'));
            var diffMin = Math.floor((Date.now() - then.getTime()) / 60000);
            if (diffMin < 1) elapsed = '刚刚';
            else if (diffMin < 60) elapsed = diffMin + ' 分钟前';
            else if (diffMin < 1440) elapsed = Math.floor(diffMin / 60) + ' 小时前';
            else elapsed = Math.floor(diffMin / 1440) + ' 天前';
        } catch(e) {}
        if (elapsed) {
            return '<p style="font-size:12px;color:var(--warning);margin-bottom:12px;">' +
                '上次同步：' + elapsed + '（' + latest + '）</p>';
        }
    }
    if (!s.initialized) {
        return '<p style="font-size:12px;color:var(--warning);margin-bottom:12px;">' +
            '未检测到历史同步记录，首次连接</p>';
    }
    return '';
}

function _renderFeishuDirDialog(lastSyncHint, statusArea, toggle, label) {
    var msg = '<p style="margin-bottom:12px;">即将开启飞书同步，请选择首次同步方向：</p>' +
        (lastSyncHint || '') +
        '<p style="font-size:12px;color:var(--text-muted);margin-bottom:4px;">以本地数据为准 — 本地排班覆盖飞书表格</p>' +
        '<p style="font-size:12px;color:var(--text-muted);">与云端对齐 — 先拉取飞书端的改动再推送</p>';

    var overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = '<div class="confirm-box" style="background:var(--dialog-bg);border-radius:8px;padding:24px;min-width:400px;max-width:500px;box-shadow:0 4px 24px rgba(0,0,0,0.3);">' +
        '<h3 style="margin:0 0 12px 0;">飞书同步方向</h3>' +
        '<div style="margin-bottom:16px;">' + msg + '</div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end;">' +
        '<button class="btn" id="fs-dir-cancel" style="margin-right:auto;">取消</button>' +
        '<button class="btn" id="fs-dir-cloud">与云端对齐</button>' +
        '<button class="btn" id="fs-dir-local" style="background:var(--primary);color:#fff;">以本地数据为准</button>' +
        '</div></div>';
    document.body.appendChild(overlay);

    function _choose(mode) {
        document.body.removeChild(overlay);
        if (!mode) return;
        // 开启 iOS toggle
        if (toggle) toggle.classList.add('active');
        if (label) label.textContent = '飞书同步已开启';
        if (statusArea) statusArea.style.display = 'block';
        // 立刻显示初始化进行中（状态区）
        var headerEl = document.getElementById('fs-status-header');
        var barEl = document.getElementById('fs-status-bar');
        var logEl = document.getElementById('fs-status-log');
        if (headerEl) {
            headerEl.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
                '<span style="font-weight:600;font-size:12px;color:#1e40af;">⟳ 初始化进行中...</span>' +
                '</div>';
        }
        if (barEl) {
            barEl.innerHTML = '<div class="fs-progress-track"><div class="fs-progress-fill" style="width:0%;"></div></div>';
        }
        if (logEl) {
            logEl.innerHTML = '<div style="margin-top:4px;font-size:10px;color:var(--text-muted);">正在创建飞书表并推送数据...</div>';
        }
        _doToggleFeishu(true, mode);
    }

    document.getElementById('fs-dir-cancel').onclick = function() { _choose(null); };
    document.getElementById('fs-dir-local').onclick = function() { _choose('local'); };
    document.getElementById('fs-dir-cloud').onclick = function() { _choose('cloud'); };
    overlay.onclick = function(e) { if (e.target === overlay) _choose(null); };
}

function _doToggleFeishu(enabled, mode) {
    if (typeof FeishuSync !== 'undefined') {
        FeishuSync.toggle(enabled, mode).then(function(data) {
            if (data && data.init_result) {
                if (typeof showToast === 'function') {
                    var label = mode === 'cloud' ? '云端对齐完成' : '本地数据已同步';
                    showToast(label + '，' + data.init_result.mapped_machines + ' 台机器已就绪');
                }
            }
            refreshFeishuStatus();
        });
    } else {
        toggleFeishuSyncFallback(enabled, mode);
    }
}

function toggleFeishuSyncFallback(enabled, mode) {
    fetch('/api/feishu/toggle', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({enabled:enabled, mode:mode||'local'})
    }).then(function(r){ return r.json(); }).then(function(){
        refreshFeishuStatus();
    });
}

function updateFeishuStatusUI(status) {
    var statusArea = document.getElementById('feishu-status-area');
    var iosToggle = document.getElementById('feishu-toggle');
    var iosLabel = document.getElementById('feishu-toggle-label');
    var initBtn = document.getElementById('feishu-init-btn');

    if (!statusArea) return;

    // === 推送箱：始终可编辑，仅在同步关闭时显示提示 ===
    var pushWarning = document.getElementById('push-sync-warning');
    if (pushWarning) {
        pushWarning.style.display = status.enabled ? 'none' : 'block';
    }
    if (!_pushConfigLoaded) {
        loadPushConfig();
        _pushConfigLoaded = true;
    }

    // === Toggle ===
    if (iosToggle) {
        if (status.enabled) { iosToggle.classList.add('active'); }
        else { iosToggle.classList.remove('active'); }
    }
    if (iosLabel) {
        iosLabel.textContent = status.enabled ? '飞书同步已开启' : '飞书同步已关闭';
    }
    statusArea.style.display = status.enabled ? 'block' : 'none';
    if (!status.enabled) { disconnectFeishuStream(); return; }

    // === KPI 行 ===
    renderKpiRow(status);

    // === 状态区 ===
    _currentOp = status.active_operation;
    _machineEvents = (status.events || []).filter(function(ev) { return ev.machine; });
    _operationHistory = status.operation_history || [];
    renderStatusArea();
    renderRecentActivity();

    // === 初始化按钮 ===
    if (initBtn) {
        if (!status.initialized && !status.initializing) {
            initBtn.style.display = 'inline-block';
        } else {
            initBtn.style.display = 'none';
        }
    }

    // === 机器列表 ===
    renderMachineList(status);

    // === SSE 连接 ===
    connectFeishuStream();
}

// ========== SSE 状态变量 ==========
var _feishuEventSource = null;
var _machineEvents = [];
var _currentOp = null;
var _operationHistory = [];
var _countdownTimer = null;         // 距下次同步倒计时 interval ID
var _countdownValueSec = null;     // 当前倒计时剩余秒数
var _eventPushTimer = null;        // 距下次事件推送倒计时 interval ID
var _eventPushValueSec = null;     // 当前事件推送倒计时剩余秒数

// ========== KPI 行渲染 ==========
function renderKpiRow(status) {
    // 连接状态
    var connEl = document.getElementById('fs-kpi-conn-val');
    if (connEl) {
        if (status.connected && status.initialized) {
            connEl.innerHTML = '<span style="color:#16a34a;">● 已连接</span>';
        } else if (!status.initialized) {
            connEl.innerHTML = '<span style="color:#f59e0b;">● 未初始化</span>';
        } else {
            connEl.innerHTML = '<span style="color:#ef4444;">● 连接失败</span>';
        }
    }

    // 同步健康
    var healthEl = document.getElementById('fs-kpi-health-val');
    if (healthEl && status.sync_health) {
        var h = status.sync_health;
        if (!status.enabled) {
            healthEl.innerHTML = '<span style="color:#9ca3af;">○ 未启用</span>';
        } else if (!h.thread_alive) {
            healthEl.innerHTML = '<span style="color:#ef4444;">● 线程异常</span>';
        } else if (h.degraded_level === 'paused') {
            healthEl.innerHTML = '<span style="color:#ef4444;">● 同步暂停</span>';
        } else if (h.degraded_level === 'minimal') {
            healthEl.innerHTML = '<span style="color:#f59e0b;">● 降频中</span>';
        } else if (h.degraded_level === 'reduced') {
            healthEl.innerHTML = '<span style="color:#f59e0b;">● 轻度降频</span>';
        } else {
            healthEl.innerHTML = '<span style="color:#16a34a;">● 同步正常</span>';
        }
    }

    // 数据库完整性
    var dbWarn = document.getElementById('fs-db-integrity-warn');
    if (dbWarn) {
        if (status.db_integrity_ok === false) {
            dbWarn.style.display = 'block';
        } else {
            dbWarn.style.display = 'none';
        }
    }

    // 映射覆盖
    var covEl = document.getElementById('fs-kpi-cov-val');
    var covBar = document.getElementById('fs-kpi-cov-bar');
    var total = status.total_machines || (status.integrity && status.integrity.total_machines) || 0;
    var mapped = status.mapping_count || (status.integrity && status.integrity.mapped_machines) || 0;
    if (covEl) {
        covEl.innerHTML = mapped + '/' + total + ' <span style="font-size:11px;color:#9ca3af;">台</span>';
    }
    if (covBar) {
        covBar.style.width = total > 0 ? Math.round(mapped / total * 100) + '%' : '0%';
    }

    // 上次推送
    var pushEl = document.getElementById('fs-kpi-push-val');
    if (pushEl) {
        var pr = status.last_push_result;
        if (pr && pr.total > 0) {
            var color = pr.fail > 0 ? '#ef4444' : '#16a34a';
            pushEl.innerHTML = '<span style="color:' + color + ';">' + pr.success + '/' + pr.total + '</span> 成功';
        } else {
            pushEl.textContent = '—';
        }
    }

    // 倒计时
    _startCountdown(status.next_loop_in_sec);

    // 事件推送倒计时
    _startEventPushCountdown(status.next_event_push_in_sec);
}

// ========== 倒计时定时器 ==========
function _startCountdown(nextLoopSec) {
    // 清除旧定时器
    if (_countdownTimer) { clearInterval(_countdownTimer); _countdownTimer = null; }

    var cdEl = document.getElementById('fs-kpi-cd-val');
    if (!cdEl) return;

    if (nextLoopSec === null || nextLoopSec === undefined) {
        cdEl.textContent = '—';
        _countdownValueSec = null;
        return;
    }

    _countdownValueSec = nextLoopSec;

    function _tick() {
        var el = document.getElementById('fs-kpi-cd-val');
        if (!el) { clearInterval(_countdownTimer); _countdownTimer = null; return; }
        if (_countdownValueSec <= 0) {
            el.innerHTML = '<span style="color:#f59e0b;">0s</span>';
            // 到期后不再递减，等待下次 status 事件更新
            return;
        }
        el.innerHTML = '<span style="color:#2563eb;">' + _countdownValueSec + 's</span>';
        _countdownValueSec--;
    }

    _tick();  // 立即显示初始值
    _countdownTimer = setInterval(_tick, 1000);
}

// ========== 事件推送倒计时 ==========
function _startEventPushCountdown(nextPushSec) {
    if (_eventPushTimer) { clearInterval(_eventPushTimer); _eventPushTimer = null; }

    var el = document.getElementById('fs-kpi-ep-val');
    if (!el) return;

    if (nextPushSec === null || nextPushSec === undefined) {
        el.textContent = '—';
        _eventPushValueSec = null;
        return;
    }

    _eventPushValueSec = nextPushSec;

    function _tick() {
        var epEl = document.getElementById('fs-kpi-ep-val');
        if (!epEl) { clearInterval(_eventPushTimer); _eventPushTimer = null; return; }
        if (_eventPushValueSec <= 0) {
            epEl.innerHTML = '<span style="color:#f59e0b;">0s</span>';
            return;
        }
        epEl.innerHTML = '<span style="color:#8b5cf6;">' + _eventPushValueSec + 's</span>';
        _eventPushValueSec--;
    }

    _tick();
    _eventPushTimer = setInterval(_tick, 1000);
}

// ========== 状态区渲染（进度条 + 机器事件日志） ==========
function renderStatusArea() {
    var container = document.getElementById('fs-status-area');
    if (!container) return;

    var headerEl = document.getElementById('fs-status-header');
    var barEl = document.getElementById('fs-status-bar');
    var logEl = document.getElementById('fs-status-log');

    var typeNames = { init: '初始化', push: '推送', pull: '拉取', sync: '同步', event_push: '事件推送' };

    if (_currentOp) {
        // === 操作进行中 ===
        var typeName = typeNames[_currentOp.type] || _currentOp.type;
        var pct = _currentOp.total > 0 ? Math.round(_currentOp.done / _currentOp.total * 100) : 0;
        var phaseStr = _currentOp.phase_total > 1
            ? '(' + _currentOp.phase + '/' + _currentOp.phase_total + ' ' + _currentOp.phase_label + ') ' : '';

        if (headerEl) {
            headerEl.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
                '<span style="font-weight:600;font-size:12px;color:#1e40af;">⟳ ' + typeName + '进行中... ' + phaseStr + '</span>' +
                '<span style="font-size:11px;color:#3b82f6;font-family:monospace;">' + _currentOp.done + '/' + _currentOp.total + ' (' + pct + '%)</span>' +
                '</div>';
        }
        if (barEl) {
            barEl.innerHTML = '<div class="fs-progress-track"><div class="fs-progress-fill" style="width:' + pct + '%;"></div></div>';
        }
        if (logEl) {
            var html = '<div style="margin-top:4px;max-height:100px;overflow-y:auto;font-size:10px;color:#64748b;font-family:monospace;line-height:1.6;">';
            var recent = _machineEvents.slice(-10).reverse();
            for (var i = 0; i < recent.length; i++) {
                var e = recent[i];
                var color = e.level === 'error' ? '#dc2626' : (e.level === 'warn' ? '#f59e0b' : '#64748b');
                html += '<div style="color:' + color + ';">' + e.time + '  ' + (e.machine || '') + ' → ' + e.msg + '</div>';
            }
            if (recent.length === 0) {
                html += '<div style="color:var(--text-muted);">请等待...</div>';
            }
            html += '</div>';
            logEl.innerHTML = html;
        }
    } else {
        // === 空闲 ===
        var lastDone = _operationHistory.length > 0 ? _operationHistory[0] : null;
        if (headerEl) {
            var summaryHtml = '<span style="color:#9ca3af;font-size:12px;">⏸ 无进行中的操作</span>';
            if (lastDone && lastDone.status === 'ok') {
                var ltName = typeNames[lastDone.type] || lastDone.type;
                summaryHtml += '<span style="color:#cbd5e1;margin:0 8px;">|</span>' +
                    '<span style="color:#64748b;font-size:12px;">上次' + ltName + ': ' + lastDone.summary + '</span>';
            }
            headerEl.innerHTML = summaryHtml;
        }
        if (barEl) barEl.innerHTML = '';
        // 保留机器事件日志定格
        if (logEl && _machineEvents.length > 0) {
            // 内容已在操作进行中时渲染，保持不变
        } else if (logEl && _machineEvents.length === 0) {
            logEl.innerHTML = '';
        }
    }
}

// ========== 最近活动渲染（操作聚合） ==========
function renderRecentActivity() {
    var el = document.getElementById('fs-recent-list');
    if (!el) return;

    if (_operationHistory.length === 0 && !_currentOp) {
        el.innerHTML = '<div style="color:#9ca3af;font-size:11px;">暂无活动记录</div>';
        return;
    }

    var html = '';
    // 进行中的操作显示在最前面
    if (_currentOp) {
        var typeNames = { init: '初始化', push: '推送', pull: '拉取', sync: '同步', event_push: '事件推送' };
        var typeName = typeNames[_currentOp.type] || _currentOp.type;
        var pct = _currentOp.total > 0 ? Math.round(_currentOp.done / _currentOp.total * 100) : 0;
        html += '<div style="padding:2px 0;color:#2563eb;">⏳ ' + typeName + '中... ' +
            _currentOp.done + '/' + _currentOp.total + ' (' + pct + '%)</div>';
    }
    // 已完成的操作
    for (var i = 0; i < _operationHistory.length; i++) {
        var rec = _operationHistory[i];
        var icon = rec.status === 'error' ? '❌' : '✅';
        var color = rec.status === 'error' ? '#dc2626' : '#16a34a';
        html += '<div style="padding:2px 0;color:' + color + ';">' +
            icon + ' ' + rec.time + ' ' + rec.summary + '</div>';
    }
    el.innerHTML = html;
}

// ========== SSE 连接 ==========
function connectFeishuStream() {
    if (_feishuEventSource) return;
    _feishuEventSource = new EventSource('/api/feishu/stream');

    _feishuEventSource.addEventListener('status', function(e) {
        var s = JSON.parse(e.data);
        updateFeishuStatusUI(s);
    });

    _feishuEventSource.addEventListener('progress', function(e) {
        var p = JSON.parse(e.data);
        _currentOp = p;
        // 检测是否为新操作：类型变化或从空闲恢复
        renderStatusArea();
        renderRecentActivity();
    });

    _feishuEventSource.addEventListener('log', function(e) {
        var ev = JSON.parse(e.data);
        _machineEvents.push(ev);
        if (ev.done !== undefined && _currentOp) {
            _currentOp.done = ev.done;
            _currentOp.total = ev.total;
        }
        renderStatusArea();
    });

    _feishuEventSource.addEventListener('done', function(e) {
        var d = JSON.parse(e.data);
        _currentOp = null;
        _operationHistory.unshift(d);
        if (_operationHistory.length > 600) _operationHistory.pop();
        renderStatusArea();
        renderRecentActivity();
        // 操作完成后拉取最新状态，刷新 KPI（同步健康、上次推送等）
        fetch('/api/feishu/status').then(function(r) { return r.json(); }).then(function(s) {
            renderKpiRow(s);
        }).catch(function() {});
    });

    _feishuEventSource.onerror = function() {
        // EventSource 默认 3 秒后自动重连
    };
}

function disconnectFeishuStream() {
    if (_feishuEventSource) {
        _feishuEventSource.close();
        _feishuEventSource = null;
    }
    // 清除倒计时
    if (_countdownTimer) {
        clearInterval(_countdownTimer);
        _countdownTimer = null;
    }
    _countdownValueSec = null;
    if (_eventPushTimer) {
        clearInterval(_eventPushTimer);
        _eventPushTimer = null;
    }
    _eventPushValueSec = null;
}

// ========== 机器列表渲染 ==========
function renderMachineList(status) {
    var box = document.getElementById('fs-machine-box');
    var summary = document.getElementById('fs-machine-summary');
    var list = document.getElementById('fs-machine-list');
    if (!box || !summary || !list) return;

    var integrity = status.integrity || {};
    var total = integrity.total_machines || 0;
    var mapped = integrity.mapped_machines || 0;
    var missing = integrity.missing_tables || [];
    var missingIds = {};
    for (var i = 0; i < missing.length; i++) { missingIds[missing[i]] = true; }

    summary.textContent = '(' + mapped + '/' + total + ')';

    var errorMachines = {};
    var events = status.events || [];
    for (var j = 0; j < events.length; j++) {
        if (events[j].level === 'error' && events[j].machine) {
            errorMachines[events[j].machine] = events[j].msg;
        }
    }

    if (list.style.display === 'none') {
        list.innerHTML = '';
        return;
    }

    var perMachine = (integrity.per_machine) || [];
    if (perMachine.length === 0) {
        list.innerHTML = '<div style="color:#9ca3af;font-size:11px;">加载中...</div>';
        return;
    }

    var html = '';
    for (var k = 0; k < perMachine.length; k++) {
        var m = perMachine[k];
        var statusClass, statusText;
        if (errorMachines[m.name]) {
            statusClass = 'fs-mstatus-fail';
            statusText = '同步失败';
        } else if (missingIds[m.name]) {
            statusClass = 'fs-mstatus-miss';
            statusText = '缺表';
        } else if (m.mapped) {
            statusClass = 'fs-mstatus-ok';
            statusText = '同步正常';
        } else {
            statusClass = 'fs-mstatus-none';
            statusText = '未映射';
        }
        html += '<div class="fs-machine-row">';
        html += '<span class="fs-machine-name">' + m.name + '</span>';
        html += '<span class="' + statusClass + '">' + statusText + '</span>';
        html += '<span class="fs-machine-time">' + (m.last_sync || '—') + '</span>';
        html += '</div>';
    }
    list.innerHTML = html;
}

// ========== 机器列表折叠 ==========
function toggleMachineList() {
    var list = document.getElementById('fs-machine-list');
    var arrow = document.getElementById('fs-machine-arrow');
    if (!list || !arrow) return;
    if (list.style.display === 'none') {
        list.style.display = 'block';
        arrow.textContent = '折叠 ▲';
        refreshFeishuStatus();
    } else {
        list.style.display = 'none';
        arrow.textContent = '展开 ▼';
    }
}

// ========== 手动操作触发 ==========

function initFeishuSync() {
    var btn = document.getElementById('feishu-init-btn');
    if (btn) { btn.disabled = true; btn.textContent = '启动中...'; }
    fetch('/api/feishu/init', {method:'POST'})
        .then(function(r){ return r.json(); })
        .then(function(data){
            if (data.started) {
                if (btn) { btn.style.display = 'none'; }
                // SSE 连接会自动推送进度
                connectFeishuStream();
            } else if (data.error) {
                if (typeof showToast === 'function') showToast(data.error);
                if (btn) { btn.disabled = false; btn.textContent = '初始化同步'; }
            }
        })
        .catch(function(){
            if (btn) { btn.disabled = false; btn.textContent = '初始化同步'; }
        });
}

function refreshFeishuStatus() {
    // SSE 兜底：手动刷新时重新获取完整状态
    fetch('/api/feishu/status')
        .then(function(r){ return r.json(); })
        .then(function(s){
            if (typeof updateFeishuStatusUI === 'function') updateFeishuStatusUI(s);
        });
}

function cleanupFeishuTables() {
    if (typeof showConfirm !== 'function') {
        if (!confirm('确定要删除所有飞书表吗？此操作不可撤销。')) return;
    } else {
        showConfirm('清理飞书表', '<p style="color:#ef4444;">此操作将删除本应用创建的所有飞书表格并清除映射，不可撤销。</p>').then(function(ok) {
            if (!ok) return;
            _doCleanup();
        });
        return;
    }
    _doCleanup();
}

function _doCleanup() {
    var btn = document.querySelector('#settings-sub-7 .btn-sm[style*="background:#991b1b"]');
    if (!btn) btn = document.querySelector('#feishu-status-area .btn-sm');
    if (btn) { btn.disabled = true; btn.textContent = '清理中...'; }
    fetch('/api/feishu/cleanup', {method:'POST'})
        .then(function(r){ return r.json(); })
        .then(function(d){
            if (typeof showToast === 'function') showToast(d.msg);
            refreshFeishuStatus();
            if (btn) { btn.disabled = false; btn.textContent = '一键清理飞书表'; }
        })
        .catch(function(){
            if (btn) { btn.disabled = false; btn.textContent = '一键清理飞书表'; }
        });
}

function pushFeishuNow() {
    var btn = document.getElementById('feishu-push-now-btn');
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = '启动中...';
    fetch('/api/feishu/push', { method: 'POST' })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.started) {
                connectFeishuStream();  // SSE 推送进度
            } else if (data.error) {
                if (typeof showToast === 'function') showToast(data.error);
                btn.disabled = false;
                btn.textContent = '⬆ 推送';
            }
        })
        .catch(function() {
            btn.disabled = false;
            btn.textContent = '⬆ 推送';
        });
}

function pullFeishuNow() {
    var btn = document.getElementById('feishu-pull-now-btn');
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = '启动中...';
    fetch('/api/feishu/pull', { method: 'POST' })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.started) {
                connectFeishuStream();  // SSE 推送进度
            } else if (data.error) {
                if (typeof showToast === 'function') showToast(data.error);
                btn.disabled = false;
                btn.textContent = '⬇ 拉取';
            }
        })
        .catch(function() {
            btn.disabled = false;
            btn.textContent = '⬇ 拉取';
        });
}

// ========== 扫描飞书表 ==========
function scanFeishuTables() {
    if (typeof showToast === 'function') showToast('扫描中...');

    fetch('/api/feishu/scan')
        .then(function(r) { return r.json(); })
        .then(function(data) {
            var s = data.summary;
            var summary = '线上 ' + s.online_total + ' 张表 | '
                + '已映射 ' + s.mapped_total + ' 台'
                + (s.orphan_total > 0 ? ' | ⚠ 孤立 ' + s.orphan_total : '')
                + (s.missing_total > 0 ? ' | ⚠ 缺表 ' + s.missing_total : '')
                + (s.conflict_total > 0 ? ' | ⚠ 冲突 ' + s.conflict_total : '');
            if (typeof showToast === 'function') showToast(summary);
        })
        .catch(function() {
            if (typeof showToast === 'function') showToast('扫描失败，请检查网络');
        });
}

// ========== 推送设置 ==========

// ========== 推送设置 · 群聊标签模式 ==========

var _chatGroups = [];
var _pushConfigLoaded = false;

function addChatGroup() {
    var nameEl = document.getElementById('push-chat-name');
    var idEl = document.getElementById('push-chat-id');
    var name = (nameEl ? nameEl.value.trim() : '');
    var chatId = (idEl ? idEl.value.trim() : '');

    if (!chatId) { showToast('请输入 chat_id'); return; }
    if (!chatId.startsWith('oc_')) { showToast('chat_id 需以 oc_ 开头'); return; }

    // 防止重复
    for (var i = 0; i < _chatGroups.length; i++) {
        if (_chatGroups[i].chat_id === chatId) { showToast('该 chat_id 已添加'); return; }
    }

    if (!name) name = chatId.substring(0, 12);
    _chatGroups.push({name: name, chat_id: chatId});
    renderChatGroups();
    savePushConfig();
    if (nameEl) nameEl.value = '';
    if (idEl) { idEl.value = ''; idEl.focus(); }
}

function removeChatGroup(idx) {
    _chatGroups.splice(idx, 1);
    renderChatGroups();
    savePushConfig();
}

function renderChatGroups() {
    var container = document.getElementById('push-chat-tags');
    if (!container) return;

    if (!_chatGroups.length) {
        container.innerHTML = '<span style=\"font-size:12px;color:var(--text-muted);font-style:italic;\">还没有群聊，在上方添加</span>';
        return;
    }

    var html = '';
    for (var i = 0; i < _chatGroups.length; i++) {
        var g = _chatGroups[i];
        html += '<span class=\"chat-tag\" title=\"' + escHtml(g.chat_id) + '\">' +
            '🏷 ' + escHtml(g.name) +
            '<span class=\"chat-tag-x\" onclick=\"removeChatGroup(' + i + ')\">&times;</span>' +
        '</span>';
    }
    container.innerHTML = html;
}

function loadPushConfig() {
    fetch('/api/feishu/push-config')
        .then(function(r) { return r.json(); })
        .then(function(cfg) {
            var toggle = document.getElementById('push-toggle');
            var label = document.getElementById('push-toggle-label');

            // 只有飞书同步开启时推送开关才能亮
            var fsToggle = document.getElementById('feishu-toggle');
            var syncOn = fsToggle && fsToggle.classList.contains('active');
            if (cfg.enabled && syncOn) {
                if (toggle) toggle.classList.add('active');
                if (label) label.textContent = '推送已开启';
            } else {
                if (toggle) toggle.classList.remove('active');
                if (label) label.textContent = '推送已关闭';
            }
            _chatGroups = cfg.chat_groups || [];
            renderChatGroups();
            if (cfg.event_toggles) {
                renderEventToggles(cfg.event_toggles);
            }
            // 恢复截图渲染引擎选择
            var eng = localStorage.getItem('screenshot_engine') || 'html2canvas';
            var engEl = document.getElementById('push-screenshot-engine');
            if (engEl) engEl.value = eng;
        })
        .catch(function() {});
}

function togglePush(enabled, skipSave) {
    // 飞书同步未开启时不允许打开推送
    if (enabled) {
        var fsToggle = document.getElementById('feishu-toggle');
        if (!fsToggle || !fsToggle.classList.contains('active')) {
            showToast('请先开启飞书同步');
            return;
        }
    }

    var toggle = document.getElementById('push-toggle');
    var label = document.getElementById('push-toggle-label');

    if (enabled) {
        if (toggle) toggle.classList.add('active');
        if (label) label.textContent = '推送已开启';
    } else {
        if (toggle) toggle.classList.remove('active');
        if (label) label.textContent = '推送已关闭';
    }

    // 用户手动点击时立即保存，避免轮询覆盖
    if (!skipSave) {
        savePushConfig();
    }
}

function savePushConfig() {
    var enabled = document.getElementById('push-toggle').classList.contains('active');
    // 截图引擎存 localStorage
    var engEl = document.getElementById('push-screenshot-engine');
    if (engEl) {
        _setLS('screenshot_engine', engEl.value);
    }

    fetch('/api/feishu/push-config/save', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({enabled: enabled, chat_groups: _chatGroups, event_toggles: _eventToggles}),
    }).catch(function() {
        showToast('保存失败，请检查网络');
    });
}

function testPush() {
    if (!_chatGroups.length) {
        showToast('请先添加群聊');
        return;
    }

    var msgInput = document.getElementById('push-test-msg');
    var msg = msgInput ? msgInput.value.trim() : '';
    if (!msg) {
        showToast('请输入测试消息');
        return;
    }

    // 先保存再发送，确保后端拿到最新列表
    var enabled = document.getElementById('push-toggle').classList.contains('active');
    fetch('/api/feishu/push-config/save', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({enabled: enabled, chat_groups: _chatGroups, event_toggles: _eventToggles}),
    }).then(function() {
        return fetch('/api/feishu/push-config/test', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({message: msg}),
        });
    }).then(function(r) { return r.json(); })
      .then(function(data) {
          if (data.error) { showToast(data.error); return; }
          var results = data.results || [];
          var ok = results.filter(function(r) { return r.success; }).length;
          var fail = results.length - ok;
          // 显示每群的详细结果，失败时附带错误原因
          var details = [];
          for (var i = 0; i < results.length; i++) {
              var r = results[i];
              var gname = '';
              if (_chatGroups[i]) {
                  gname = _chatGroups[i].name || _chatGroups[i].chat_id.substring(0, 12);
              } else {
                  gname = r.chat_id.substring(0, 12);
              }
              if (r.success) {
                  details.push(gname + ' ✅');
              } else {
                  details.push(gname + ' ❌ ' + (r.error || '未知错误'));
              }
          }
          var resultDiv = document.getElementById('push-test-result');
          if (!resultDiv) {
              resultDiv = document.createElement('div');
              resultDiv.id = 'push-test-result';
              var btnsRow = document.querySelector('#feishu-push-box div:last-child');
              if (btnsRow) btnsRow.appendChild(resultDiv);
          }
          resultDiv.style.cssText = 'margin-top:8px;font-size:11px;line-height:1.6;';
          resultDiv.innerHTML = details.join('<br>');
          if (fail === 0) {
              showToast('测试发送成功（' + ok + ' 个群）');
              // 推送测试成功，清除凭证变更警告
              var warnDiv = document.getElementById('push-cred-change-warn');
              if (warnDiv) warnDiv.remove();
          } else {
              showToast('发送完成：' + ok + ' 成功，' + fail + ' 失败（详见下方）');
          }
      })
      .catch(function() {
          showToast('发送失败，请检查网络');
      });
}

function reportNow() {
    if (!_chatGroups.length) {
        showToast('请先添加群聊');
        return;
    }

    var enabled = document.getElementById('push-toggle').classList.contains('active');
    fetch('/api/feishu/push-config/save', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({enabled: enabled, chat_groups: _chatGroups, event_toggles: _eventToggles}),
    }).then(function() {
        return fetch('/api/feishu/push-config/report-now', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
        });
    }).then(function(r) { return r.json(); })
      .then(function(data) {
          if (data.error) { showToast(data.error); return; }
          var results = data.results || [];
          var ok = results.filter(function(r) { return r.success; }).length;
          var fail = results.length - ok;
          if (fail === 0) {
              showToast(data.shift + '总结报告已发送（' + ok + ' 个群）');
          } else {
              showToast(data.shift + '报告：' + ok + ' 成功，' + fail + ' 失败');
          }
      })
      .catch(function() {
          showToast('发送失败，请检查网络');
      });
}

// ========== 推送事件开关矩阵 ==========

var _eventToggles = {};
var _eventColumnSelectAll = { leader: true, group: true };

var EVENT_ITEMS = [
    { key: 'task_impending_start', label: '任务即将开始',       leader: true,  group: false },
    { key: 'task_start',           label: '任务开始',           leader: true,  group: false },
    { key: 'task_confirm_start',   label: '任务确定开始',       leader: false, group: true  },
    { key: 'schedule_changes',     label: '排班任务变动',       leader: false, group: true  },
    { key: 'exception_start',      label: '异常情况开始',       leader: false, group: true  },
    { key: 'exception_update',     label: '异常状态更新',       leader: false, group: true  },
    { key: 'exception_end',        label: '异常情况结束',       leader: false, group: true  },
    { key: 'task_recycled',        label: '任务回收待分配',     leader: true,  group: true  },
    { key: 'task_impending_end',   label: '任务即将结束',       leader: true,  group: false },
    { key: 'task_end',             label: '任务结束',           leader: true,  group: false },
    { key: 'task_confirm_end',     label: '任务确定结束',       leader: false, group: true  },
    { key: 'package_complete',     label: '任务包全部完成',     leader: false, group: true  },
    { key: 'shift_report',              label: '白班/夜班总结报告',        leader: false, group: true  },
    { key: 'shift_table_screenshot',    label: '白班/夜班表格截图（推送）', leader: false, group: true  },
];

function renderEventToggles(toggles) {
    _eventToggles = toggles || {};
    var tbody = document.getElementById('push-event-tbody');
    if (!tbody) return;

    var html = '';
    for (var i = 0; i < EVENT_ITEMS.length; i++) {
        var item = EVENT_ITEMS[i];
        var cfg = _eventToggles[item.key] || { leader: item.leader, group: item.group };
        var leaderActive = cfg.leader ? ' active' : '';
        var groupActive = cfg.group ? ' active' : '';
        html += '<tr>';
        html += '<td style="padding:4px 8px;">' + item.label + '</td>';
        html += '<td style="text-align:center;padding:4px 8px;">';
        html += '<div class="ios-toggle mini-toggle' + leaderActive + '" onclick="toggleEventItem(\'' + item.key + '\', \'leader\')"><div class="ios-toggle-track"><div class="ios-toggle-thumb"></div></div></div>';
        html += '</td>';
        html += '<td style="text-align:center;padding:4px 8px;">';
        html += '<div class="ios-toggle mini-toggle' + groupActive + '" onclick="toggleEventItem(\'' + item.key + '\', \'group\')"><div class="ios-toggle-track"><div class="ios-toggle-thumb"></div></div></div>';
        html += '</td>';
        html += '</tr>';
    }
    tbody.innerHTML = html;
}

function toggleEventItem(key, column) {
    if (!_eventToggles[key]) {
        // 用 EVENT_ITEMS 中定义的默认值初始化，而不是硬编码 false
        var defaults = { leader: false, group: false };
        for (var i = 0; i < EVENT_ITEMS.length; i++) {
            if (EVENT_ITEMS[i].key === key) {
                defaults.leader = EVENT_ITEMS[i].leader;
                defaults.group = EVENT_ITEMS[i].group;
                break;
            }
        }
        _eventToggles[key] = { leader: defaults.leader, group: defaults.group };
    }
    _eventToggles[key][column] = !_eventToggles[key][column];
    renderEventToggles(_eventToggles);
    savePushConfig();
}

function toggleEventColumn(column) {
    var newValue = !_eventColumnSelectAll[column];
    _eventColumnSelectAll[column] = newValue;
    for (var i = 0; i < EVENT_ITEMS.length; i++) {
        var item = EVENT_ITEMS[i];
        if (!_eventToggles[item.key]) {
            _eventToggles[item.key] = { leader: item.leader, group: item.group };
        }
        _eventToggles[item.key][column] = newValue;
    }
    renderEventToggles(_eventToggles);
    savePushConfig();
    var btn = document.getElementById('push-select-all-' + column);
    if (btn) {
        btn.textContent = newValue ? '全不选' : '全选';
    }
}

// ========== 显示模式切换 ==========

function switchDisplayMode() {
    // 分班模式已禁用 — 不允许切换
    if (typeof showToast === 'function') showToast('分班模式暂不可用');
}

function _updateDisplayModeUI() {
    // 分班模式已禁用 — 始终显示连续模式
    var label = document.getElementById('display-mode-label');
    if (label) { label.textContent = '当前：连续模式'; }
    // 始终使用连续模式的下拉选项
    var sel = document.getElementById('view-mode');
    if (!sel) return;
    sel.innerHTML = '<option value="double">双班(24h)</option>' +
        '<option value="day">白班</option>' +
        '<option value="night">夜班</option>' +
        '<option value="custom">自定义</option>';
    // 恢复之前的选择
    var vm = localStorage.getItem('viewMode') || '';
    if (vm) {
        var found = false;
        for (var i = 0; i < sel.options.length; i++) {
            if (sel.options[i].value === vm) { sel.value = vm; found = true; break; }
        }
        if (!found) sel.value = 'day';
    }
}

// ========== 优先级颜色设置 ==========

function togglePriorityColors() {
    var cb = document.getElementById('s-priority-color-enabled');
    var container = document.getElementById('priority-color-inputs');
    var enabled = (cb && cb.checked);
    if (container) container.style.display = enabled ? '' : 'none';
    _setLS('priority_color_enabled', enabled ? '1' : '0');
    if (enabled) {
        loadPriorityColorSettings();  // 重新加载以设置 CSS 变量
    } else {
        // 清除 CSS 变量
        ['P0','P1','P2','P3','P4','P5'].forEach(function(lv) {
            document.documentElement.style.removeProperty('--pri-color-' + lv);
        });
    }
    if (typeof _silentRefresh === 'function') _silentRefresh();
}

function applyPriorityColor(level, color) {
    try {
        var store = JSON.parse(localStorage.getItem('_priority_colors') || '{}');
        store[level] = color;
        localStorage.setItem('_priority_colors', JSON.stringify(store));
        document.documentElement.style.setProperty('--pri-color-' + level, color);
        var hexEl = document.getElementById('cs-pri-' + level + '-hex');
        if (hexEl) hexEl.textContent = color;
        if (typeof _silentRefresh === 'function') _silentRefresh();
    } catch(e) {}
}

function resetPriorityColor(level) {
    var priors = _getSystemPriorities();
    var idx = priors.indexOf(level);
    var def = PColorDefaultForLevel(idx >= 0 ? idx : 0);
    var input = document.getElementById('cs-pri-' + level);
    if (input) input.value = def;
    var hexEl = document.getElementById('cs-pri-' + level + '-hex');
    if (hexEl) hexEl.textContent = def;
    applyPriorityColor(level, def);
}

function _getSystemPriorities() {
    try {
        if (typeof _settingsData !== 'undefined' && _settingsData && _settingsData.priorities && _settingsData.priorities.length) {
            return _settingsData.priorities.map(function(p) { return p.key; });
        }
    } catch(e) {}
    return [];
}

function _getPriorityColors() {
    var priors = _getSystemPriorities();
    var stored = {};
    try { stored = JSON.parse(localStorage.getItem('_priority_colors') || '{}'); } catch(e) {}
    var result = {};
    for (var i = 0; i < priors.length; i++) {
        var lv = priors[i];
        result[lv] = stored[lv] || PColorDefaultForLevel(i);
    }
    return result;
}

// 仅恢复 CSS 变量（页面初始化时调用，不渲染 UI）
function restorePriorityCSSVars() {
    var enabled = '0';
    try { enabled = localStorage.getItem('priority_color_enabled') || '0'; } catch(e) {}
    if (enabled !== '1') return;
    var colors = _getPriorityColors();
    for (var lv in colors) {
        if (colors.hasOwnProperty(lv)) {
            document.documentElement.style.setProperty('--pri-color-' + lv, colors[lv]);
        }
    }
}

function loadPriorityColorSettings() {
    var priors = _getSystemPriorities();
    if (!priors.length) return;  // 设置未加载时不渲染

    // 渲染颜色输入控件
    var container = document.getElementById('priority-color-inputs');
    if (container) {
        var stored = {};
        try { stored = JSON.parse(localStorage.getItem('_priority_colors') || '{}'); } catch(e) {}
        var html = '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">';
        for (var i = 0; i < priors.length; i++) {
            var level = priors[i];
            var def = PColorDefaultForLevel(i);
            var c = stored[level] || def;
            html += '<label style="display:inline-flex;align-items:center;gap:4px;font-size:12px;white-space:nowrap;">' +
                escHtml(level) +
                '<input type="color" id="cs-pri-' + escHtml(level) + '" value="' + c + '" onchange="applyPriorityColor(\'' + escHtml(level) + '\', this.value)" style="width:28px;height:22px;padding:0;border:none;">' +
                '<span class="color-hex-label" id="cs-pri-' + escHtml(level) + '-hex" style="font-size:11px;">' + c + '</span>' +
                '<button class="btn-sm" onclick="resetPriorityColor(\'' + escHtml(level) + '\');return false;" title="恢复默认">↺</button>' +
                '</label>';
        }
        html += '<button class="btn-sm" onclick="resetAllPriorityColors();return false;" style="white-space:nowrap;color:var(--text-muted);">全部重置</button>';
        html += '</div>';
        container.innerHTML = html;
    }

    // 恢复开关
    var enabled = '0';
    try { enabled = localStorage.getItem('priority_color_enabled') || '0'; } catch(e) {}
    var cb = document.getElementById('s-priority-color-enabled');
    if (cb) cb.checked = (enabled === '1');
    togglePriorityColors();

    // 开启时设 CSS 变量
    if (enabled === '1') {
        var colors = _getPriorityColors();
        for (var lv in colors) {
            if (colors.hasOwnProperty(lv)) {
                document.documentElement.style.setProperty('--pri-color-' + lv, colors[lv]);
            }
        }
    }

}

function PColorDefaultForLevel(idx) {
    var defs = ['#fecaca', '#fde68a', '#bbf7d0', '#d1d5db', '#e2e8f0'];
    return defs[idx] || '#e2e8f0';
}

function resetAllPriorityColors() {
    var priors = _getSystemPriorities();
    for (var i = 0; i < priors.length; i++) {
        resetPriorityColor(priors[i]);
    }
}

// ========== 飞书应用凭证 ==========

// ── 默认飞书应用凭证（已有的飞书应用，一直运行中）──
var FEISHU_DEFAULT_APP_ID = 'cli_aa8ffc77eff89bdb';
var FEISHU_DEFAULT_APP_TOKEN = 'I7IzbOlscajHJZscWOtcYcs6nLf';

function loadFeishuCredentials() {
    fetch('/api/feishu/app-info')
        .then(function(r) { return r.json(); })
        .then(function(data) {
            var idEl = document.getElementById('feishu-app-id');
            var secretEl = document.getElementById('feishu-app-secret');
            var tokenEl = document.getElementById('feishu-app-token');
            var statusEl = document.getElementById('feishu-cred-status');

            // 未保存 → 新电脑用默认值预填
            var appId = data.app_id || (data.is_default ? FEISHU_DEFAULT_APP_ID : '');
            var appToken = data.app_token || (data.is_default ? FEISHU_DEFAULT_APP_TOKEN : '');

            if (idEl) idEl.value = appId;
            if (secretEl) {
                if (data.has_secret) {
                    secretEl.placeholder = '已保存（' + (data.app_secret || '***') + '），留空不修改';
                } else if (data.is_default) {
                    secretEl.placeholder = '默认密钥，填入时覆盖';
                } else {
                    secretEl.placeholder = '应用密钥';
                }
                secretEl.value = '';
            }
            if (tokenEl) tokenEl.value = appToken;
            if (statusEl) {
                if (data.is_default) {
                    statusEl.textContent = '📋 默认配置（可修改）';
                    statusEl.style.color = '#f59e0b';
                }
            }
        })
        .catch(function() {
            // 静默失败，面板打开时会重试
        });
}

function resetFeishuCredentials() {
    var idEl = document.getElementById('feishu-app-id');
    var secretEl = document.getElementById('feishu-app-secret');
    var tokenEl = document.getElementById('feishu-app-token');
    var statusEl = document.getElementById('feishu-cred-status');
    var msgEl = document.getElementById('feishu-cred-msg');

    if (idEl) idEl.value = FEISHU_DEFAULT_APP_ID;
    if (secretEl) {
        secretEl.value = '';
        secretEl.placeholder = '默认密钥，填入时覆盖';
    }
    if (tokenEl) tokenEl.value = FEISHU_DEFAULT_APP_TOKEN;
    if (statusEl) {
        statusEl.textContent = '📋 已恢复默认';
        statusEl.style.color = '#f59e0b';
    }
    if (msgEl) msgEl.textContent = '已填入默认凭证，点击保存生效';
}

function saveFeishuCredentials(verify) {
    var idEl = document.getElementById('feishu-app-id');
    var secretEl = document.getElementById('feishu-app-secret');
    var tokenEl = document.getElementById('feishu-app-token');
    var msgEl = document.getElementById('feishu-cred-msg');
    var statusEl = document.getElementById('feishu-cred-status');

    var appId = (idEl ? idEl.value.trim() : '');
    var appSecret = (secretEl ? secretEl.value.trim() : '');
    var appToken = (tokenEl ? tokenEl.value.trim() : '');

    if (!appId) { showToast('请输入 App ID'); return; }
    if (!appToken) { showToast('请输入 App Token'); return; }

    if (!appSecret && secretEl && secretEl.placeholder.indexOf('已保存') === 0) {
        // 已有保存值，留空不修改 → 不传 secret，后端保持原值
    } else if (!appSecret && secretEl && secretEl.placeholder.indexOf('默认密钥') === 0) {
        // 新电脑/恢复默认，留空 → 后端自动使用默认密钥
    } else if (!appSecret) {
        showToast('请输入 App Secret');
        return;
    }

    if (msgEl) msgEl.textContent = verify ? '正在验证...' : '正在保存...';
    if (statusEl) { statusEl.textContent = '验证中...'; statusEl.style.color = '#f59e0b'; }

    fetch('/api/feishu/app-info', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            app_id: appId,
            app_secret: appSecret,
            app_token: appToken,
            verify: !!verify
        })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.error) {
            showToast(data.error);
            if (msgEl) msgEl.textContent = data.error;
            if (statusEl) { statusEl.textContent = '保存失败'; statusEl.style.color = '#dc2626'; }
            return;
        }
        if (data.verify) {
            if (data.verify.valid) {
                showToast('凭证有效，保存成功');
                if (statusEl) { statusEl.textContent = '✅ 凭证有效'; statusEl.style.color = '#059669'; }
                if (msgEl) msgEl.textContent = '验证通过，已保存';
            } else {
                showToast('凭证无效: ' + (data.verify.msg || '未知错误'));
                if (statusEl) { statusEl.textContent = '⚠ 凭证无效'; statusEl.style.color = '#d97706'; }
                if (msgEl) msgEl.textContent = '已保存但验证失败: ' + (data.verify.msg || '');
            }
        } else {
            showToast('凭证已保存');
            if (statusEl) { statusEl.textContent = '✅ 已保存（未验证）'; statusEl.style.color = '#059669'; }
            if (msgEl) msgEl.textContent = '保存成功';
        }
        if (secretEl) {
            secretEl.value = '';
            secretEl.placeholder = '已保存（***），留空不修改';
        }
        // 凭证变更后重置推送配置缓存，下次打开推送面板时重新加载
        _pushConfigLoaded = false;
        // 如果推送已开启，提醒用户用新机器人重测
        var pushToggle = document.getElementById('push-toggle');
        if (pushToggle && pushToggle.classList.contains('active')) {
            var warnDiv = document.getElementById('push-cred-change-warn');
            if (!warnDiv) {
                warnDiv = document.createElement('div');
                warnDiv.id = 'push-cred-change-warn';
                warnDiv.style.cssText = 'margin-top:8px;padding:8px 12px;background:#fef3c7;border:1px solid #f59e0b;border-radius:6px;font-size:12px;color:#92400e;';
                warnDiv.innerHTML = '⚠ 应用凭证已更新。请确认<b>新机器人已加入推送群聊</b>，然后重新<a href="#" onclick="testPush();return false;" style="color:#d97706;text-decoration:underline;">🚀 发送测试消息</a>验证。';
                var pushBox = document.getElementById('feishu-push-box');
                if (pushBox) pushBox.appendChild(warnDiv);
            }
        }
    })
    .catch(function(err) {
        showToast('保存失败: ' + err);
        if (msgEl) msgEl.textContent = '网络错误';
        if (statusEl) { statusEl.textContent = '❌ 网络错误'; statusEl.style.color = '#dc2626'; }
    });
}

function testFeishuConnection() {
    var idEl = document.getElementById('feishu-app-id');
    var secretEl = document.getElementById('feishu-app-secret');
    var tokenEl = document.getElementById('feishu-app-token');
    var msgEl = document.getElementById('feishu-cred-msg');
    var statusEl = document.getElementById('feishu-cred-status');

    var appId = (idEl ? idEl.value.trim() : '');
    var appSecret = (secretEl ? secretEl.value.trim() : '');
    var appToken = (tokenEl ? tokenEl.value.trim() : '');

    if (msgEl) msgEl.textContent = '⏳ 测试中...';
    if (statusEl) { statusEl.textContent = '⏳ 测试中...'; statusEl.style.color = '#f59e0b'; }

    fetch('/api/feishu/app-info/test', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ app_id: appId, app_secret: appSecret, app_token: appToken })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        var lines = [];

        // Token
        if (data.token) {
            lines.push((data.token.ok ? '🔑' : '❌') + ' 凭证: ' + (data.token.msg || ''));
        }

        // 机器人 IM
        if (data.im) {
            lines.push((data.im.ok ? '🤖' : '❌') + ' 机器人: ' + (data.im.msg || ''));
        }

        // 表格 Bitable
        if (data.bitable) {
            lines.push((data.bitable.ok ? '📊' : '❌') + ' 表格: ' + (data.bitable.msg || ''));
        }

        var allOk = (data.token && data.token.ok) && (data.im && data.im.ok) && (data.bitable && data.bitable.ok);
        if (msgEl) msgEl.innerHTML = lines.join('<br>');
        if (statusEl) {
            statusEl.textContent = allOk ? '✅ 全部通过' : '⚠ 部分失败';
            statusEl.style.color = allOk ? '#059669' : '#d97706';
        }
    })
    .catch(function(err) {
        if (msgEl) msgEl.textContent = '网络错误';
        if (statusEl) { statusEl.textContent = '❌ 网络错误'; statusEl.style.color = '#dc2626'; }
    });
}
