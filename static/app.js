// golden scheduling app — window.onload entry point

window.onload=()=>{
    // 时钟 tick 最早启动，确保 onload 中任何错误都不会阻断计时
    setInterval(()=>{renderCurrentTimeMarker(); if(typeof splitRenderCurrentMarker==='function') splitRenderCurrentMarker();},1000);
    // 初始化默认值
    try {
        window._crossTypeBlockSetting = localStorage.getItem('schedule_cross_type_block') === '1';
        window._snapStartToBreak = localStorage.getItem('schedule_snap_start_to_break') === '1';
        window._snapEndToBreak = localStorage.getItem('schedule_snap_end_to_break') === '1';
        var ss = JSON.parse(localStorage.getItem('schedule_settings') || '{}');
        window._compactTaskLabel = ss['compact_task_label'] === '1';
        window._showPackageName = ss['show_package_name'] !== '0';
    } catch(e) {
        window._crossTypeBlockSetting = false;
        window._snapStartToBreak = false;
        window._snapEndToBreak = false;
        window._compactTaskLabel = false;
        window._showPackageName = true;
    }
    _loadHiddenMachines();
    _loadTaskPoolMode();
    initCollapsibleState();
    // 初始化主题
    initTheme();
    // 初始化按钮波纹
    initButtonRipple();
    // 记住并恢复上一次停留的页面，避免每次操作 reload 都跳回"排班面板"
    let i = DEFAULT_TAB_INDEX;
    try{
        const v = localStorage.getItem('activeTabIndex');
        if(v !== null && v !== undefined){
            const n = parseInt(v, 10);
            if(Number.isFinite(n)) i = n;
        }
    }catch(e){}
    // 恢复布局模式
    try{
        const lm = localStorage.getItem("layoutMode");
        if(lm === "sidebar") document.body.classList.add("sidebar-mode");
    }catch(e){}
    // 恢复侧边栏折叠状态
    try {
        const sc = localStorage.getItem('sidebarCollapsed');
        if (sc === '1' && document.body.classList.contains('sidebar-mode')) {
            document.body.classList.add('sidebar-collapsed');
            const collapseBtn = document.getElementById('sidebar-collapse-btn');
            if (collapseBtn) {
                collapseBtn.innerHTML = '&#9654;';
                collapseBtn.title = '展开侧边栏';
            }
        }
    } catch(e) {}
    // 侧边栏时钟
    setInterval(function() { if (typeof updateSidebarClock === 'function') updateSidebarClock(); }, 1000);
    if (typeof updateSidebarClock === 'function') updateSidebarClock();
    // 恢复动画设置（避免页面刷新后动画开关失效）
    try{
        if(APP_CONFIG && APP_CONFIG.ui_settings){
            APP_CONFIG.ui_settings.forEach(function(s){
                if(s.key==='enable_animations') document.body.classList.toggle('no-animations', s.value!=='1');
                if(s.key==='button_ripple') document.body.classList.toggle('no-ripple', s.value!=='1');
                if(s.key==='glow_hover') document.body.classList.toggle('glow-hover', s.value==='1');
                if(s.key==='particle_background' && s.value==='1' && typeof startParticleBackground==='function'){
                    startParticleBackground();
                }
                if(s.key==='ribbon_effect' && s.value==='1' && typeof startRibbons==='function'){
                    startRibbons();
                }
                if(s.key==='butterfly_animation' && s.value==='1' && typeof startButterflies==='function'){
                    startButterflies();
                }
            });
        }
    }catch(e){}
    // 恢复机器管理表单
    try{
        const lmType = localStorage.getItem("lastMType");
        const lmKind = localStorage.getItem("lastMKind");
        if(lmType) document.getElementById("m_type").value = lmType;
        if(lmKind) document.getElementById("m_kind").value = lmKind;
    }catch(e){}
    // 恢复维修日志数据
    try {
        var rlEl = document.getElementById('repair-logs-data');
        window._repairLogs = rlEl ? JSON.parse(rlEl.textContent || '{}') : {};
    }catch(e){ window._repairLogs = {}; }
    rebuildNavUI();
    switchTab(i);
    if (i === 6) { restoreSettingsSub(); }
    // 初始化显示模式 UI（视图下拉选项）
    try { if (typeof _updateDisplayModeUI === 'function') _updateDisplayModeUI(); } catch(e) {}
    // 恢复优先级颜色 CSS 变量（不渲染 UI，UI 等设置加载后再渲染）
    try { if (typeof restorePriorityCSSVars === 'function') restorePriorityCSSVars(); } catch(e) {}
    // 恢复缩放与视图
    let vm = localStorage.getItem('viewMode') || '';
    try{
        const zh = parseInt(localStorage.getItem('zoomHour')||'80',10);
        const zr = parseInt(localStorage.getItem('zoomRow')||'40',10);
        document.getElementById('zoom-hour').value = String(zh);
        document.getElementById('zoom-row').value = String(zr);
        document.documentElement.style.setProperty('--hourWidth', zh+'px');
        document.documentElement.style.setProperty('--rowHeight', zr+'px');
        if(!vm){
            // 自动绑定当前班次：落在白班范围 => 白班，否则夜班
            const now = new Date();
            const cur = now.getHours()*60 + now.getMinutes();
            const dayS = hhmmToMin(SHIFT.day_shift.start)||540;
            const dayE = hhmmToMin(SHIFT.day_shift.end)||1110;
            vm = (cur>=dayS && cur<dayE) ? 'day' : 'night';
        }
        document.getElementById('view-mode').value = vm || 'double';
        const csdEl = document.getElementById('custom-start-date');
        const cedEl = document.getElementById('custom-end-date');
        if(csdEl) csdEl.value = localStorage.getItem('customStartDate') || document.getElementById('schedule-date').value;
        if(document.getElementById('custom-start-time')) document.getElementById('custom-start-time').value = localStorage.getItem('customStartTime') || '09:00';
        if(cedEl) cedEl.value = localStorage.getItem('customEndDate') || document.getElementById('schedule-date').value;
        if(document.getElementById('custom-end-time')) document.getElementById('custom-end-time').value = localStorage.getItem('customEndTime') || '18:30';
    }catch(e){}
    try{
        if(!localStorage.getItem('nightViewStyle')) localStorage.setItem('nightViewStyle', 'simple');
        if(!localStorage.getItem('nightOffset')) localStorage.setItem('nightOffset', '0');
    }catch(e){}
    // 自定义时段控件仅自定义视图显示
    var crc = document.getElementById('custom-range-controls');
    if(crc){ crc.style.display = (vm === 'custom') ? '' : 'none'; }
    // 恢复置顶机器列状态
    if(localStorage.getItem('stickyMachineCol') === '1'){
        document.getElementById('sticky-machine-col').checked = true;
        toggleStickyMachineCol();
    }
    // 恢复回收压实开关状态（默认开启）
    window._autoCompactRecycle = localStorage.getItem('autoCompactRecycle') !== '0';
    var acrCheck = document.getElementById('auto-compact-recycle');
    if (acrCheck) acrCheck.checked = window._autoCompactRecycle;
    window._autoExtendRepair = localStorage.getItem('autoExtendRepair') !== '0';
    var aerCheck = document.getElementById('auto-extend-repair');
    if (aerCheck) aerCheck.checked = window._autoExtendRepair;
    renderCurrentTimeMarker();
    renderViewMask(true);
    rebuildTimelineGrid(true);
    updateNightOffsetToggle();
    validateShiftFormat('day');
    validateShiftFormat('night');
    applyTaskFilters();
    try{
        const du = localStorage.getItem('durationUnit');
        if(du) document.getElementById('duration-unit').value = du;
    }catch(e){}
    toggleDurationUnit();
    _applyTaskPoolMode();
    // 初始化飞书同步（静默启动，不阻塞页面加载）
    try { FeishuSync.init(); } catch(e) { console.error('FeishuSync init failed:', e); }
}
