// golden scheduling app — operation modes, animations, undo/redo, export

// ========== 时间轴操作模式 ==========
var timelineOpMode = 'edit'; // 'edit' | 'recycle' | 'complete' | 'cut' | 'delete'
var undoStack = [];
var redoStack = [];

var _activeAnimCleanup = null;

function _abortCurrentAnim() {
    if (_activeAnimCleanup) {
        try { _activeAnimCleanup.abort(); } catch(e) {}
        _activeAnimCleanup = null;
    }
}

function setOpMode(mode){
    timelineOpMode = mode;
    document.querySelectorAll('.op-mode-btn').forEach(function(b){
        b.classList.toggle('active', b.dataset.mode === mode);
    });
    // 切割模式视觉提示
    document.querySelectorAll('.task-block').forEach(function(b){
        b.classList.toggle('cut-mode-hint', mode === 'cut' && !b.classList.contains('task-completed'));
    });
}

function handleTimelineDblClick(ev, sid){
    switch(timelineOpMode){
        case 'edit': editTask(sid); break;
        case 'recycle': recycleWithAnim(ev, sid); break;
        case 'complete': completeWithAnim(ev, sid); break;
        case 'cut': cutTask(ev, sid); break;
        case 'delete': deleteWithAnim(ev, sid); break;
    }
}

// ========== 基础操作 ==========

// 1. 任务标记完成（按钮）
function completeTask(sid){
    showConfirm('完成任务', '<p>确定标记此任务为已完成？</p>').then(ok=>{
        if(!ok) return;
        let block = document.querySelector('.task-block[data-sid="'+sid+'"]');
        fetch('/complete_task/'+sid).then(r=>r.json()).then(d=>{
            if(block) block.classList.add('task-completed');
            var s = schedules.find(function(item){ return item.id == sid; });
            if(s) s.status = 'completed';
            var tid = block ? block.dataset.tid : (s ? s.task_id : null);
            if(tid) _updateTaskStatusText(tid, '已完成');
            refreshLiveStatus();
            showToast('已完成');
        });
    });
}

// 2. 双击任务条 → 打开编辑弹窗（不跳转标签页）
function editTask(sid){
    sid = parseInt(sid, 10) || 0;
    if(!sid) return;
    var s = schedules.find(function(item){ return item.id === sid; });
    if(!s){ showToast('未找到排班数据'); return; }
    // 已完成的任务 → 打开历史记录修改弹窗
    if(s.status === 'completed'){
        document.getElementById('he-sid').value = String(sid);
        var sp = _parseTimeStr(s.start_str || _formatAbsMin(s.start_min));
        document.getElementById('he_start_date').value = s.date || '';
        document.getElementById('he_start_time').value = sp ? String(Math.floor(sp.min/60)).padStart(2,'0')+':'+String(sp.min%60).padStart(2,'0') : '00:00';
        var ep = _parseTimeStr(s.end_str || _formatAbsMin(Math.min(MAX_ABS_MIN, s.end_min)));
        document.getElementById('he_end_time').value = ep ? String(Math.floor(ep.min/60)).padStart(2,'0')+':'+String(ep.min%60).padStart(2,'0') : '00:00';
        if(ep && ep.dayOff !== 0){
            document.getElementById('he_end_date').value = _dateAddDays(s.date, ep.dayOff);
        } else if(ep && sp && ep.min < sp.min && ep.dayOff === 0){
            document.getElementById('he_end_date').value = _dateAddDays(s.date, 1);
        } else {
            document.getElementById('he_end_date').value = s.date || '';
        }
        // 填充更多字段：优先从任务数据，回退到排班数据
        var tid_he = parseInt(s.task_id, 10) || 0;
        var ht = (tid_he && typeof getTaskById === 'function') ? getTaskById(tid_he) : null;
        document.getElementById('he_task_name').value = (ht ? ht.name : s.task_name) || '';
        document.getElementById('he_type').value = (ht ? ht.type : s.task_type) || '';
        document.getElementById('he_kind').value = (ht ? ht.task_kind : s.task_kind) || '';
        document.getElementById('he_pri').value = (ht ? ht.priority : s.priority) || '';
        document.getElementById('he_diff').value = (ht ? ht.difficulty : s.difficulty) || '';
        document.getElementById('he_repair_dur').value = s.repair_duration || '';
        document.getElementById('he_machine_name').value = s.machine_name || '';
        document.getElementById('he_rbp_task_id').value = (ht ? ht.rbp_task_id : '') || '';
        document.getElementById('he_scene').value = (ht ? ht.scene : '') || '';
        document.getElementById('he_general_category').value = (ht ? ht.general_category : '') || '';
        document.getElementById('he_source_link').value = (ht ? ht.source_link : '') || '';
        document.getElementById('he_expected_count').value = (ht ? ht.expected_count : '') || '';
        document.getElementById('he_collection_req_id').value = (ht ? ht.collection_req_id : '') || '';
        document.getElementById('he_collection_req_type').value = (ht ? ht.collection_req_type : '') || '';
        document.getElementById('he_remark').value = (ht ? ht.remark : s.remark) || '';
        // 默认折叠更多字段
        var heFieldsDiv = document.getElementById('hist-more-fields');
        var heToggleBtn = document.querySelector('.hist-collapse-toggle');
        if (heFieldsDiv) heFieldsDiv.style.display = 'none';
        if (heToggleBtn) {
            heToggleBtn.classList.remove('open');
            var heArrow = heToggleBtn.querySelector('.arrow');
            if (heArrow) heArrow.innerHTML = '▶';
        }
        document.getElementById('history-edit-dialog').style.display = 'block';
        return;
    }
    var tid = parseInt(s.task_id, 10) || 0;
    if(!tid){
        showToast('该排班无关联任务，请在任务库中手动管理');
        return;
    }
    var dlg = document.getElementById('task-edit-drawer');
    if(!dlg){ showToast('编辑弹窗未找到'); return; }
    document.getElementById('edit-tid').value = String(tid);
    document.getElementById('ed_name').value = s.task_name || '';
    document.getElementById('ed_type').value = s.task_type || (APP_CONFIG.machine_types[0] && APP_CONFIG.machine_types[0].key) || '';
    document.getElementById('ed_kind').value = s.task_kind || '常规';
    document.getElementById('ed_pri').value = s.priority || 'P1';
    document.getElementById('ed_diff').value = s.difficulty || '普通';
    document.getElementById('ed_remark').value = s.remark || '';
    var t = typeof getTaskById === 'function' ? getTaskById(tid) : null;
    if(t){
        var estMode = t.est_mode || 'auto';
        var radio = document.querySelector('input[name="ed_est_mode"][value="' + estMode + '"]');
        if(radio) radio.checked = true;
        else { document.querySelector('input[name="ed_est_mode"][value="auto"]').checked = true; }
        document.getElementById('ed_duration').value = t.duration || '';
        document.getElementById('ed_op').value = t.op_min || '';
        document.getElementById('ed_reset').value = t.reset_min || '';
        document.getElementById('ed_count').value = t.collect_count || '';
        document.getElementById('ed_red').value = t.redundancy_min || '0';
        document.getElementById('ed_expcnt').value = t.expected_count || '';
        document.getElementById('ed_rbp_id').value = t.rbp_task_id || '';
        document.getElementById('ed_scene').value = t.scene || '';
        document.getElementById('ed_gcat').value = t.general_category || '';
        document.getElementById('ed_slink').value = t.source_link || '';
        document.getElementById('ed_creqid').value = t.collection_req_id || '';
        document.getElementById('ed_creqtype').value = t.collection_req_type || '';
    } else {
        var radio = document.querySelector('input[name="ed_est_mode"][value="auto"]');
        if(radio) radio.checked = true;
        document.getElementById('ed_rbp_id').value = '';
        document.getElementById('ed_scene').value = '';
        document.getElementById('ed_gcat').value = '';
        document.getElementById('ed_slink').value = '';
        document.getElementById('ed_expcnt').value = '';
        document.getElementById('ed_creqid').value = '';
        document.getElementById('ed_creqtype').value = '';
    }
    toggleEditEstMode();
    dlg.style.display = 'block';
}

// 3. 一键快速操作
function openQuickOpsDialog(){
    // ── 确定操作范围 ──
    var baseDate = document.getElementById('schedule-date').value;
    var urlParams = new URLSearchParams(window.location.search);
    var viewMode = 'default';
    try { viewMode = localStorage.getItem('viewMode') || 'default'; } catch(e) {}

    var payload = { date: baseDate };
    var dateLabel = '';  // 显示用的日期范围描述
    var dayCount = 0;

    if (viewMode === 'custom') {
        var csd = document.getElementById('custom-start-date');
        var ced = document.getElementById('custom-end-date');
        if (csd && ced && csd.value && ced.value) {
            payload.date_from = csd.value;
            payload.date_to = ced.value;
            var fromD = new Date(csd.value);
            var toD = new Date(ced.value);
            dayCount = Math.ceil((toD - fromD) / (24*60*60*1000)) + 1;
            dateLabel = csd.value + ' ~ ' + ced.value;
        }
    }

    if (!payload.date_from) {
        var spanDays = parseInt(urlParams.get('span_days') || '2', 10) || 2;
        spanDays = Math.max(1, Math.min(14, spanDays));
        payload.span_days = spanDays;
        dayCount = spanDays;
        // 计算结束日期
        var endD = new Date(baseDate);
        endD.setDate(endD.getDate() + spanDays - 1);
        dateLabel = baseDate + ' ~ ' + endD.toISOString().slice(0,10);
    }

    // ── 弹窗容器 ──
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,var(--dialog-overlay-opacity,0.5));z-index:20000;display:flex;align-items:center;justify-content:center;animation:fadeIn 0.2s ease;backdrop-filter:blur(2px);';

    var box = document.createElement('div');
    box.style.cssText = 'background:var(--bg-card);border-radius:var(--radius);width:580px;max-width:95vw;max-height:90vh;overflow-y:auto;box-shadow:var(--shadow-xl);border:1px solid var(--border);display:flex;flex-direction:column;';

    box.innerHTML =
    // ── 切换开关样式 ──
    '<style>'+
        '#qo-all-dates:checked{background:var(--primary)!important;}'+
        '#qo-all-dates::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;background:#fff;border-radius:50%;transition:transform 0.2s;}'+
        '#qo-all-dates:checked::after{transform:translateX(16px);}'+
    '</style>'+
    // ── 头部 ──
    '<div style="display:flex;align-items:center;justify-content:space-between;padding:20px 24px 0 24px;">'+
        '<b style="font-size:17px;color:var(--text-primary);">一键快速操作</b>'+
        '<button id="qo-close-x" style="background:none;border:none;font-size:20px;color:var(--text-muted);cursor:pointer;width:30px;height:30px;border-radius:var(--radius-xs);display:flex;align-items:center;justify-content:center;line-height:1;" title="关闭">&times;</button>'+
    '</div>'+

    // ── 操作范围提示 ──
    '<div style="margin:12px 24px 0 24px;padding:12px 16px;background:var(--primary-light);border-radius:var(--radius-sm);border:1px solid rgba(59,130,246,0.2);">'+
        '<div style="display:flex;align-items:center;justify-content:space-between;">'+
            '<div style="display:flex;align-items:center;gap:8px;">'+
                '<span style="font-size:14px;">&#128206;</span>'+
                '<span style="font-size:13px;color:var(--text-secondary);">操作范围：<b style="color:var(--text-primary);" id="qo-scope-label">'+escHtml(dateLabel)+'</b></span>'+
            '</div>'+
            '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;flex-shrink:0;">'+
                '<span style="font-size:11px;color:var(--text-muted);" id="qo-toggle-label">影响全部</span>'+
                '<input type="checkbox" id="qo-all-dates" style="width:36px;height:20px;appearance:none;-webkit-appearance:none;background:var(--border);border-radius:10px;position:relative;cursor:pointer;outline:none;transition:background 0.2s;">'+
            '</label>'+
        '</div>'+
        '<div style="font-size:12px;color:var(--text-muted);margin-top:4px;padding-left:22px;" id="qo-scope-sub">共 <b>'+dayCount+'</b> 天 · 仅影响当前视图内的日期 · 不影响视图外数据</div>'+
    '</div>'+

    // ── 分隔线 ──
    '<div style="margin:16px 24px 0 24px;border-top:1px solid var(--border-light);"></div>'+

    // ── 按钮列表 ──
    '<div style="padding:16px 24px 8px 24px;display:flex;flex-direction:column;gap:10px;">'+

        // 分组：标记确认
        '<div style="font-size:11px;font-weight:600;color:var(--primary);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:-4px;">&#128221; 标记确认</div>'+
        '<button class="qo-card-btn qo-btn-primary" id="qo-confirm-od">'+
            '<span class="qo-btn-title">确认过时待确认的任务</span>'+
            '<span class="qo-btn-desc">将已过期但未完成的任务标记为"已完成"，排班同步标记为已完成。维修停用机器上的任务会跳过。</span>'+
        '</button>'+

        // 分组：任务回收
        '<div style="font-size:11px;font-weight:600;color:var(--warning);text-transform:uppercase;letter-spacing:0.5px;margin-top:8px;margin-bottom:-4px;">&#9851; 任务回收</div>'+
        '<button class="qo-card-btn qo-btn-warning" id="qo-rec-pend">'+
            '<span class="qo-btn-title">回收待开始的任务</span>'+
            '<span class="qo-btn-desc">仅回收已过期但当前非"采集中/暂停中"的任务。正在执行的任务不受影响。</span>'+
        '</button>'+
        '<button class="qo-card-btn qo-btn-warning" id="qo-rec-uncomp">'+
            '<span class="qo-btn-title">回收未完成的任务</span>'+
            '<span class="qo-btn-desc">除已完成的任务外，其余全部回收至任务池，任务状态回到"待分配"。</span>'+
        '</button>'+

        // 分组：删除清理
        '<div style="font-size:11px;font-weight:600;color:var(--danger);text-transform:uppercase;letter-spacing:0.5px;margin-top:8px;margin-bottom:-4px;">&#128465; 删除清理</div>'+
        '<button class="qo-card-btn qo-btn-danger" id="qo-del-comp">'+
            '<span class="qo-btn-title">删除已完成的任务排班</span>'+
            '<span class="qo-btn-desc">仅删除排班记录，任务本身保留为已完成状态。操作范围按上述日期。</span>'+
        '</button>'+
        '<button class="qo-card-btn qo-btn-danger" id="qo-clear-all">'+
            '<span class="qo-btn-title">清空所有任务</span>'+
            '<span class="qo-btn-desc">已完成任务的排班记录删除；未完成任务的排班删除并回收入池。</span>'+
        '</button>'+
        '<button class="qo-card-btn qo-btn-danger qo-btn-danger-bold" id="qo-del-all">'+
            '<span class="qo-btn-title">&#9888; 删除所有任务</span>'+
            '<span class="qo-btn-desc">清空全部排班，一个不剩。未完成的任务回到"待分配"状态。<b>不可恢复。</b></span>'+
        '</button>'+
    '</div>'+

    // ── 底部 ──
    '<div style="display:flex;justify-content:flex-end;padding:12px 24px 20px 24px;">'+
        '<button class="btn" style="background:var(--bg-card);color:var(--text-secondary);border:1px solid var(--border);" id="qo-cancel">取消</button>'+
    '</div>';

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    // ── 关闭 ──
    function cleanup(){ overlay.remove(); }
    overlay.addEventListener('click', function(e){ if(e.target===overlay) cleanup(); });
    box.querySelector('#qo-close-x').onclick = cleanup;
    box.querySelector('#qo-cancel').onclick = cleanup;

    // ── 影响全部开关 ──
    var toggleEl = box.querySelector('#qo-all-dates');
    var scopeLabel = box.querySelector('#qo-scope-label');
    var scopeSub = box.querySelector('#qo-scope-sub');
    var toggleText = box.querySelector('#qo-toggle-label');
    var defaultScopeHTML = scopeLabel.innerHTML;
    var defaultSubHTML = scopeSub.innerHTML;
    toggleEl.addEventListener('change', function(){
        if (this.checked) {
            scopeLabel.textContent = '全部任务';
            scopeSub.innerHTML = '已开启<b>影响全部</b> · 不限日期，操作整个任务库';
            toggleText.textContent = '影响全部 ✓';
        } else {
            scopeLabel.innerHTML = defaultScopeHTML;
            scopeSub.innerHTML = defaultSubHTML;
            toggleText.textContent = '影响全部';
        }
    });

    // ── 通用请求 ──
    function doAction(action, confirmTitle, confirmMsg) {
        showConfirm(confirmTitle || '确认操作', confirmMsg).then(function(ok){
            if(!ok) return;
            var body = Object.assign({ action: action }, payload);
            if (document.getElementById('qo-all-dates').checked) body.all_dates = true;
            fetch('/quick_ops', {method:'POST', headers:{'Content-Type':'application/json'},
                body: JSON.stringify(body)
            }).then(function(r){
                if(!r.ok) return r.json().then(function(d){ throw new Error(d.msg || '请求失败'); });
                return r.json();
            }).then(function(d){
                showToast(d.msg);
                if(typeof _refreshTimelineFromServer === 'function') _refreshTimelineFromServer();
                if(typeof buildSplitIndex === 'function') buildSplitIndex();
                if(typeof refreshLiveStatus === 'function') refreshLiveStatus();
                cleanup();
            }).catch(function(e){
                showToast(e.message || '操作失败');
            });
        });
    }

    // ── 按钮事件绑定 ──
    box.querySelector('#qo-confirm-od').onclick = function(){
        doAction('confirm_overdue', '确认过时任务',
            '<p>确定确认所有过时待确认的任务？</p>'+
            '<p style="font-size:12px;color:var(--text-muted);">过期未完成且机器非维修停用的任务将被标记为"已完成"，排班标记为已完成。维修停用机器上的任务会跳过。</p>');
    };
    box.querySelector('#qo-rec-pend').onclick = function(){
        doAction('recycle_pending', '回收待开始的任务',
            '<p>确定回收所有待开始的任务？</p>'+
            '<p style="font-size:12px;color:var(--text-muted);">仅回收已过期但当前非"采集中/暂停中"的任务。正在执行中的任务将保留。</p>');
    };
    box.querySelector('#qo-rec-uncomp').onclick = function(){
        doAction('recycle_uncompleted', '回收未完成的任务',
            '<p>确定回收所有未完成的任务？</p>'+
            '<p style="font-size:12px;color:var(--text-muted);">已完成的任务将保留不动，其余全部回收至任务池。</p>');
    };
    box.querySelector('#qo-del-comp').onclick = function(){
        doAction('delete_completed', '删除已完成的任务',
            '<p>确定删除操作范围内的所有已完成任务？</p>'+
            '<p style="font-size:12px;color:#e65100;">仅删除排班记录，任务本身保留为已完成状态。</p>'+
            '<p style="font-size:11px;color:var(--text-muted);">建议先导出已完成任务数据。</p>');
    };
    box.querySelector('#qo-clear-all').onclick = function(){
        doAction('clear_all', '清空所有任务',
            '<p>确定清空操作范围内的所有任务？</p>'+
            '<p style="font-size:12px;color:var(--text-muted);">已完成任务：删除排班记录。未完成任务：删除排班 + 回收入池。</p>'+
            '<p style="font-size:11px;color:var(--text-muted);">建议先导出已完成任务数据。</p>');
    };
    box.querySelector('#qo-del-all').onclick = function(){
        doAction('delete_all', '危险操作',
            '<p style="color:#c62828;font-weight:600;">确定删除操作范围内<b>所有</b>任务？</p>'+
            '<p style="font-size:12px;color:var(--text-muted);">全部排班将被删除，任务（不含已完成）回到"待分配"状态。</p>'+
            '<p style="font-size:12px;color:#c62828;">此操作不可恢复，建议先导出数据。</p>');
    };
}

// 4. 导出排班 Excel（仅执行中任务）
function exportSchedule(){
    openExportColumnsDialog('executing');
}
// 导出已完成任务 Excel（从历史面板调用）
function exportHistory(){
    openExportColumnsDialog('completed');
}

// ========== 导出列选择弹窗 ==========
const EXPORT_COLUMNS = [
    // === 基本信息（7列）===
    {key: "date",            label: "排班日期",     group: "基本信息"},
    {key: "completed_at",    label: "完成时间",     group: "基本信息"},
    {key: "task_name",       label: "任务名称",     group: "基本信息"},
    {key: "machine_name",    label: "机器名称",     group: "基本信息"},
    {key: "task_type",       label: "机型",         group: "基本信息"},
    {key: "task_kind",       label: "任务类型",     group: "基本信息"},
    {key: "status",          label: "状态",         group: "基本信息"},
    // === 时间与时长（9列）===
    {key: "start_time",      label: "开始时间",     group: "时间与时长"},
    {key: "end_time",        label: "结束时间",     group: "时间与时长"},
    {key: "actual_start",    label: "实际开始",     group: "时间与时长"},
    {key: "actual_end",      label: "实际结束",     group: "时间与时长"},
    {key: "duration",        label: "预估时长",     group: "时间与时长"},
    {key: "elapsed",         label: "排班时长",     group: "时间与时长"},
    {key: "working",         label: "工作时长",     group: "时间与时长"},
    {key: "est_mode",        label: "预估模式",     group: "时间与时长"},
    {key: "est_window",      label: "预估窗口",     group: "时间与时长"},
    // === 任务详情（11列）===
    {key: "priority",        label: "优先级",       group: "任务详情"},
    {key: "difficulty",      label: "难度",         group: "任务详情"},
    {key: "rbp_task_id",     label: "RBP数采任务ID", group: "任务详情"},
    {key: "scene",           label: "场景",         group: "任务详情"},
    {key: "general_category",label: "通用类别",     group: "任务详情"},
    {key: "source_link",     label: "来源链接",     group: "任务详情"},
    {key: "expected_count",  label: "预期采集量",   group: "任务详情"},
    {key: "collection_req_id",label: "数采需求ID",  group: "任务详情"},
    {key: "collection_req_type",label: "数采需求类型", group: "任务详情"},
    {key: "remark",          label: "备注",         group: "任务详情"},
    {key: "package_name",    label: "所属任务包",   group: "任务详情"},
    // === 维修相关（2列）===
    {key: "repair_duration", label: "维修时长",     group: "维修相关"},
    {key: "repair_periods",  label: "维修时间段",   group: "维修相关"},
];

// 默认勾选预设：执行中（11列）
const EXPORT_DEFAULTS_EXECUTING = new Set([
    "task_name","task_kind","machine_name","task_type","priority",
    "difficulty","date","start_time","end_time","duration","status"
]);

// 默认勾选预设：已完成（12列，状态默认关）
const EXPORT_DEFAULTS_COMPLETED = new Set([
    "task_name","task_kind","machine_name","task_type","priority",
    "difficulty","date","completed_at","start_time","end_time",
    "elapsed","remark"
]);

// 从 EXPORT_COLUMNS 提取分组列表（保持声明顺序）
function _getExportGroups() {
    const groups = [];
    const seen = new Set();
    for (const col of EXPORT_COLUMNS) {
        if (!seen.has(col.group)) {
            seen.add(col.group);
            groups.push(col.group);
        }
    }
    return groups;
}

let _exportColumns = null;  // working copy: [{key,label,checked}, ...]
let _currentExportStatus = 'completed';
let _exportDragIdx = -1;

function _loadExportColumns() {
    let order = null, checked = null;
    try { order = JSON.parse(localStorage.getItem('exportColumnsOrder')); } catch(e) {}
    try { checked = JSON.parse(localStorage.getItem('exportColumnsChecked')); } catch(e) {}

    // 确定默认勾选：根据当前导出状态
    const status = _currentExportStatus || 'completed';
    const defaultSet = status === 'executing' ? EXPORT_DEFAULTS_EXECUTING : EXPORT_DEFAULTS_COMPLETED;

    const result = [];
    const keySet = new Set();

    // 先按保存的顺序
    if (Array.isArray(order)) {
        for (const k of order) {
            const def = EXPORT_COLUMNS.find(c => c.key === k);
            if (def) {
                let ck;
                if (checked && k in checked) {
                    ck = !!checked[k];
                } else {
                    // 新字段无历史 → 用默认预设
                    ck = defaultSet.has(k);
                }
                result.push({key: def.key, label: def.label, group: def.group, checked: ck});
                keySet.add(k);
            }
        }
    }
    // 补上没在保存顺序中的列
    for (const def of EXPORT_COLUMNS) {
        if (!keySet.has(def.key)) {
            let ck;
            if (checked && def.key in checked) {
                ck = !!checked[def.key];
            } else {
                ck = defaultSet.has(def.key);
            }
            result.push({key: def.key, label: def.label, group: def.group, checked: ck});
        }
    }
    return result;
}

function _saveExportColumns(){
    const order = _exportColumns.map(c=>c.key);
    const checked = {};
    _exportColumns.forEach(c=>{checked[c.key]=c.checked;});
    _setLS('exportColumnsOrder', JSON.stringify(order));
    _setLS('exportColumnsChecked', JSON.stringify(checked));
}

function _renderExportColumnList() {
    const searchTerm = (document.getElementById('export-column-search')?.value || '').toLowerCase();

    // === 渲染左侧：分组列池 ===
    const leftEl = document.getElementById('export-columns-left');
    if (!leftEl) return;
    leftEl.innerHTML = '';

    const groups = _getExportGroups();
    for (const group of groups) {
        const groupCols = _exportColumns.filter(c => c.group === group);
        // 搜索模式下过滤
        const visibleCols = searchTerm
            ? groupCols.filter(c => c.label.toLowerCase().includes(searchTerm))
            : groupCols;

        if (visibleCols.length === 0) continue;

        // 分组标题
        const groupDiv = document.createElement('div');
        groupDiv.style.marginBottom = '8px';

        const header = document.createElement('div');
        header.style.cssText = 'font-weight:600;font-size:13px;padding:6px 0;cursor:pointer;display:flex;align-items:center;gap:4px;';
        header.innerHTML = '<span style="font-size:10px;">▼</span> ' + group +
            ' <span style="font-size:10px;color:var(--text-muted);">(' + groupCols.filter(c => c.checked).length + '/' + groupCols.length + ')</span>';
        header.onclick = function() {
            const body = this.nextElementSibling;
            if (body) {
                const arrow = this.querySelector('span');
                body.style.display = body.style.display === 'none' ? '' : 'none';
                arrow.textContent = body.style.display === 'none' ? '▶' : '▼';
            }
            _setLS('export_group_' + group, body.style.display === 'none' ? '1' : '0');
        };
        groupDiv.appendChild(header);

        const body = document.createElement('div');
        body.style.paddingLeft = '4px';
        try {
            if (localStorage.getItem('export_group_' + group) === '1') {
                body.style.display = 'none';
                header.querySelector('span').textContent = '▶';
            }
        } catch(e) {}

        for (const col of visibleCols) {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:7px 12px;margin:3px 0;border-radius:10px;font-size:13px;' +
                (col.checked
                    ? 'background:#eff6ff;border:1.5px solid #bfdbfe;'
                    : 'background:var(--bg-card);border:1px solid var(--border);');

            const label = document.createElement('span');
            label.style.flex = '1';
            label.textContent = col.label;
            row.appendChild(label);

            // Toggle 开关
            const toggle = document.createElement('div');
            toggle.style.cssText = 'width:38px;height:22px;border-radius:11px;position:relative;cursor:pointer;flex-shrink:0;' +
                (col.checked ? 'background:var(--primary);' : 'background:#cbd5e1;');
            toggle.onclick = function(e) {
                e.stopPropagation();
                col.checked = !col.checked;
                _renderExportColumnList();
            };

            const knob = document.createElement('div');
            knob.style.cssText = 'width:18px;height:18px;background:white;border-radius:50%;position:absolute;top:2px;' +
                (col.checked ? 'right:2px;' : 'left:2px;') +
                'box-shadow:0 1px 3px rgba(0,0,0,' + (col.checked ? '0.15);' : '0.1);');
            toggle.appendChild(knob);
            row.appendChild(toggle);

            body.appendChild(row);
        }
        groupDiv.appendChild(body);
        leftEl.appendChild(groupDiv);
    }

    // === 渲染右侧：已选列排序 ===
    const rightEl = document.getElementById('export-columns-right');
    const emptyEl = document.getElementById('export-columns-empty');
    const countEl = document.getElementById('export-selected-count');
    if (!rightEl) return;

    const selected = _exportColumns.filter(c => c.checked);
    if (countEl) countEl.textContent = selected.length + ' 列';

    if (selected.length === 0) {
        rightEl.innerHTML = '';
        if (emptyEl) emptyEl.style.display = '';
    } else {
        if (emptyEl) emptyEl.style.display = 'none';
        rightEl.innerHTML = '';
        for (let i = 0; i < selected.length; i++) {
            const col = selected[i];
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 10px;margin:3px 0;border-radius:6px;font-size:13px;background:var(--bg-card);border-left:3px solid var(--primary);border-top:1px solid var(--border);border-right:1px solid var(--border);border-bottom:1px solid var(--border);';
            row.draggable = true;
            row.setAttribute('data-col-key', col.key);

            const handle = document.createElement('span');
            handle.style.cssText = 'cursor:grab;color:#cbd5e1;font-size:14px;';
            handle.textContent = '⠿';
            row.appendChild(handle);

            const label = document.createElement('span');
            label.style.flex = '1';
            label.textContent = col.label;
            row.appendChild(label);

            const removeBtn = document.createElement('span');
            removeBtn.style.cssText = 'cursor:pointer;color:var(--text-muted);font-size:16px;';
            removeBtn.textContent = '✕';
            removeBtn.title = '移除';
            removeBtn.onclick = function(e) {
                e.stopPropagation();
                col.checked = false;
                _renderExportColumnList();
            };
            row.appendChild(removeBtn);

            // Drag events
            row.addEventListener('dragstart', function(e) {
                _exportDragIdx = i;
                e.dataTransfer.effectAllowed = 'move';
                row.style.opacity = '0.4';
            });
            row.addEventListener('dragend', function(e) {
                row.style.opacity = '1';
                _exportDragIdx = -1;
            });
            row.addEventListener('dragover', function(e) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                row.style.borderTop = '2px solid var(--accent)';
            });
            row.addEventListener('dragleave', function(e) {
                row.style.borderTop = '1px solid var(--border)';
            });
            row.addEventListener('drop', function(e) {
                e.preventDefault();
                row.style.borderTop = '1px solid var(--border)';
                const fromIdx = _exportDragIdx;
                const toIdx = i;
                if (fromIdx >= 0 && fromIdx !== toIdx) {
                    const fromKey = selected[fromIdx].key;
                    const toKey = selected[toIdx].key;
                    const fromGlobalIdx = _exportColumns.findIndex(c => c.key === fromKey);
                    const toGlobalIdx = _exportColumns.findIndex(c => c.key === toKey);
                    if (fromGlobalIdx >= 0 && toGlobalIdx >= 0) {
                        const [moved] = _exportColumns.splice(fromGlobalIdx, 1);
                        const newToIdx = _exportColumns.findIndex(c => c.key === toKey);
                        _exportColumns.splice(newToIdx, 0, moved);
                        _renderExportColumnList();
                    }
                }
                _exportDragIdx = -1;
            });

            rightEl.appendChild(row);
        }
    }
}

function _filterExportColumns() {
    _renderExportColumnList();
}

function openExportColumnsDialog(status) {
    _currentExportStatus = status || 'completed';
    _exportColumns = _loadExportColumns();
    _renderExportColumnList();
    document.getElementById('export-columns-dialog').style.display = 'flex';
    // 清空搜索
    const searchInput = document.getElementById('export-column-search');
    if (searchInput) searchInput.value = '';
    // 更新标题
    const title = document.getElementById('export-columns-title');
    if (title) title.textContent = (status === 'executing') ? '导出排班执行中 — 选择列' : '导出已完成排班 — 选择列';
}

function closeExportColumnsDialog(){
    document.getElementById('export-columns-dialog').style.display = 'none';
}

function toggleAllExportColumns(checked){
    _exportColumns.forEach(c=>{c.checked = checked;});
    _renderExportColumnList();
}

function resetDefaultExportColumns() {
    const status = _currentExportStatus || 'completed';
    const defaultSet = status === 'executing' ? EXPORT_DEFAULTS_EXECUTING : EXPORT_DEFAULTS_COMPLETED;
    _exportColumns = EXPORT_COLUMNS.map(function(def) {
        return {key: def.key, label: def.label, group: def.group, checked: defaultSet.has(def.key)};
    });
    _renderExportColumnList();
    showToast('已恢复默认');
}

function executeExport(){
    const selected = _exportColumns.filter(c=>c.checked).map(c=>c.key);
    if(selected.length===0){ showToast('请至少选择一列'); return; }
    _saveExportColumns();
    const fromEl = _currentExportStatus==='executing' ? document.getElementById('export-date-from') : document.getElementById('history-date-from');
    const toEl = _currentExportStatus==='executing' ? document.getElementById('export-date-to') : document.getElementById('history-date-to');
    const from = fromEl ? fromEl.value : '';
    const to = toEl ? toEl.value : '';
    const body = {status:_currentExportStatus, columns:selected};
    if(from) body.date_from = from;
    if(to) body.date_to = to;
    fetch('/export_schedules',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(body)
    }).then(r=>{
        if(!r.ok) return r.json().then(d=>{showToast(d.msg||'导出失败');});
        return r.blob();
    }).then(blob=>{
        if(!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        var exportName = '排班已完成任务';
        try { var ui = JSON.parse(localStorage.getItem('ui_export_filename')||'null'); if(ui) exportName = ui; } catch(e) {}
        if(typeof APP_CONFIG !== 'undefined' && APP_CONFIG.ui_settings){
            APP_CONFIG.ui_settings.forEach(function(s){ if(s.key==='export_filename') exportName = s.value; });
        }
        var label = _currentExportStatus==='executing'?'排班执行中':exportName;
        a.download = label+'.xlsx';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        closeExportColumnsDialog();
        showToast('导出完成');
    });
}

// ========== 任务回收 ==========
function _hasRepairOverlap(sid){
    var s = schedules.find(function(item){ return item.id == sid; });
    if(!s) return false;
    var mid = s.machine_id;
    var repairPeriods = (window._repairLogs && window._repairLogs[mid]) || [];
    if(!repairPeriods.length) return false;
    var absStart = s.abs_start_min;
    var absEnd = s.abs_end_min;
    for(var i = 0; i < repairPeriods.length; i++){
        var rp = repairPeriods[i];
        var oStart = Math.max(absStart, rp.abs_start);
        var oEnd = rp.abs_end !== null ? Math.min(absEnd, rp.abs_end) : absEnd;
        if(oEnd > oStart) return true;
    }
    return false;
}

function recallTask(sid){
    var msg = '<p>确定回收此任务？</p>';
    if(_hasRepairOverlap(sid)){
        msg = '<p style="color:#e65100;">检测到该任务在维修期间执行，确定回收？</p><p style="font-size:12px;color:var(--text-muted);">回收后，维修时间段信息不受影响。</p>';
    }
    recycleTasks({scheduleIds: [sid], confirmMsg: msg});
}

// ========== 撤回/重做系统 ==========
function pushUndo(action){
    undoStack.push(action);
    if(undoStack.length > 50) undoStack.shift();
    redoStack = [];
    updateUndoRedoUI();
}
function updateUndoRedoUI(){
    var ub = document.getElementById('undo-btn');
    var rb = document.getElementById('redo-btn');
    if(ub){ ub.disabled = undoStack.length === 0; }
    if(rb){ rb.disabled = redoStack.length === 0; }
}
function undoLastAction(){
    if(!undoStack.length) return;
    var action = undoStack.pop();
    redoStack.push(action);
    _reverseAction(action);
    updateUndoRedoUI();
}
function redoLastAction(){
    if(!redoStack.length) return;
    var action = redoStack.pop();
    undoStack.push(action);
    _applyAction(action);
    updateUndoRedoUI();
}
function _reverseAction(action){
    if(action.type === 'complete'){
        fetch('/uncomplete_task/'+action.sid).then(function(r){ return r.json(); }).then(function(d){
            var block = document.querySelector('.task-block[data-sid="'+action.sid+'"]');
            if(block){ block.classList.remove('task-completed'); block.draggable = true; }
            var s = schedules.find(function(item){ return item.id == action.sid; });
            if(s) s.status = 'executing';
            var tid = block ? block.dataset.tid : (s ? s.task_id : null);
            if(tid) _updateTaskStatusText(tid, '');
            refreshLiveStatus();
            showToast('已撤回完成');
        });
    } else if(action.type === 'uncomplete'){
        fetch('/complete_task/'+action.sid).then(function(r){ return r.json(); }).then(function(d){
            var block = document.querySelector('.task-block[data-sid="'+action.sid+'"]');
            if(block) block.classList.add('task-completed');
            var s = schedules.find(function(item){ return item.id == action.sid; });
            if(s) s.status = 'completed';
            var tid = block ? block.dataset.tid : (s ? s.task_id : null);
            if(tid) _updateTaskStatusText(tid, '已完成');
            refreshLiveStatus();
            showToast('已撤回取消完成');
        });
    } else if(action.type === 'recycle'){
        fetch('/assign_task', {method:'POST', headers:{'Content-Type':'application/json'},
            body:JSON.stringify({
                task_id: action.tid, machine_id: action.mid, date: action.date,
                start_min: action.start_min, end_min: action.end_min
            })})
            .then(function(r){ return r.json(); }).then(function(d){
                showToast('已撤回回收');
                _refreshTimelineFromServer();
                _refreshTaskList();
            });
    } else if(action.type === 'delete'){
        if(action.log_id){
            fetch('/restore_deleted_and_assign', {method:'POST', headers:{'Content-Type':'application/json'},
                body:JSON.stringify({
                    log_id: action.log_id,
                    machine_id: action.mid, date: action.date,
                    start_min: action.start_min, end_min: action.end_min
                })})
                .then(function(r){ return r.json(); }).then(function(d){
                    showToast('已撤回删除');
                    _refreshTimelineFromServer();
                    _refreshTaskList();
                });
        } else {
            fetch('/assign_task', {method:'POST', headers:{'Content-Type':'application/json'},
                body:JSON.stringify({
                    task_id: action.tid, machine_id: action.mid, date: action.date,
                    start_min: action.start_min, end_min: action.end_min
                })})
                .then(function(r){ return r.json(); }).then(function(d){
                    showToast('已撤回删除');
                    _refreshTimelineFromServer();
                    _refreshTaskList();
                });
        }
    } else if(action.type === 'cut'){
        fetch('/undo_cut', {method:'POST', headers:{'Content-Type':'application/json'},
            body:JSON.stringify({
                split_group: action.split_group,
                original: action.original,
                created: action.created
            })})
            .then(function(r){ return r.json(); }).then(function(d){
                showToast('已撤回切割');
                _refreshTimelineFromServer();
                _refreshTaskList();
            });
    }
}
function _applyAction(action){
    if(action.type === 'complete'){
        fetch('/complete_task/'+action.sid).then(function(r){ return r.json(); }).then(function(d){
            var block = document.querySelector('.task-block[data-sid="'+action.sid+'"]');
            if(block) block.classList.add('task-completed');
            var s = schedules.find(function(item){ return item.id == action.sid; });
            if(s) s.status = 'completed';
            var tid = block ? block.dataset.tid : (s ? s.task_id : null);
            if(tid) _updateTaskStatusText(tid, '已完成');
            refreshLiveStatus();
            showToast('已重做完成');
        });
    } else if(action.type === 'uncomplete'){
        fetch('/uncomplete_task/'+action.sid).then(function(r){ return r.json(); }).then(function(d){
            var block = document.querySelector('.task-block[data-sid="'+action.sid+'"]');
            if(block){ block.classList.remove('task-completed'); block.draggable = true; }
            var s = schedules.find(function(item){ return item.id == action.sid; });
            if(s) s.status = 'executing';
            var tid = block ? block.dataset.tid : (s ? s.task_id : null);
            if(tid) _updateTaskStatusText(tid, '');
            refreshLiveStatus();
            showToast('已重做取消完成');
        });
    } else if(action.type === 'recycle'){
        recycleTasks({
            scheduleIds: [action.sid],
            skipConfirm: true,
            onSuccess: function(){
                _silentRefresh();
                showToast('已重做回收');
            }
        });
    } else if(action.type === 'delete'){
        fetch('/delete_schedule/'+action.sid).then(function(r){ return r.json(); }).then(function(d){
            showToast('已重做删除');
            schedules = schedules.filter(function(item){ return item.id != action.sid; });
            _refreshTimelineFromServer();
            _refreshTaskList();
        });
    }
}

// ========== 操作模式动画 ==========

// ========== 回收后压实 ==========
function _compactAfterRecycle(machineId, date, startMin, endMin, cb) {
    if (!window._autoCompactRecycle) {
        if (cb) cb();
        return;
    }
    var adv = {};
    try {
        adv = JSON.parse(localStorage.getItem('aa_advanced') || '{}');
    } catch(e) {}
    var body = {
        machine_id: machineId,
        date: date,
        hole_start_min: startMin,
        hole_end_min: endMin,
        gap_minutes: parseInt(adv.gap || '0', 10) || 0,
        avoid_break_start: adv.startAvoidBreaks === true,
        avoid_break_end: adv.endAvoidBreaks === true,
        extend_over_breaks: adv.extendBreaks !== false
    };
    // 仅当视图日期为今天时，传当前时间作为压实起点下限
    var todayStr = new Date().toISOString().slice(0, 10);
    if (date === todayStr) {
        var now = new Date();
        body.now_min = now.getHours() * 60 + now.getMinutes();
    }
    fetch('/compact_tasks', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body)
    }).then(function(r){ return r.json(); }).then(function(d){
        if (d.shifted > 0) showToast(d.msg);
    }).catch(function(){}).finally(function(){
        if (cb) cb();
    });
}

// 回收模式：渐灰消失动画 → 任务回到分配池
function recycleWithAnim(ev, sid){
    var s = schedules.find(function(item){ return item.id == sid; });
    if(!s) return;
    var block = document.querySelector('.task-block[data-sid="'+sid+'"]');
    if(!block) return;

    function doRecycle(){
        if(block) block.remove();
        schedules = schedules.filter(function(item){ return item.id != sid; });
        if(s.task_id) _updateTaskStatusText(s.task_id, '待分配');
        recycleTasks({
            scheduleIds: [sid],
            skipConfirm: true,
            skipLocalCleanup: true,
            onSuccess: function(){
                _compactAfterRecycle(s.machine_id, s.date, s.start_min, s.end_min, function(){
                    _silentRefresh();
                    pushUndo({type:'recycle', sid:sid, tid:s.task_id, mid:s.machine_id, date:s.date,
                        start_min:s.start_min, end_min:s.end_min, machine_name:s.machine_name,
                        task_name:s.task_name, task_type:s.task_type, task_kind:s.task_kind,
                        priority:s.priority, difficulty:s.difficulty, remark:s.remark});
                });
            }
        });
    }

    function run(){
        _abortCurrentAnim();
        if(document.body.classList.contains('no-animations')){
            doRecycle();
            return;
        }
        block.classList.add('task-recycling');
        var aborted = false;
        _activeAnimCleanup = {
            abort: function(){
                aborted = true;
                block.classList.remove('task-recycling');
                _activeAnimCleanup = null;
                doRecycle();
            }
        };
        block.addEventListener('animationend', function handler(){
            block.removeEventListener('animationend', handler);
            if(aborted) return;
            _activeAnimCleanup = null;
            doRecycle();
        });
    }

    if(_hasRepairOverlap(sid)){
        showConfirm('回收任务', '<p style="color:#e65100;">检测到该任务在维修期间执行，确定回收？</p><p style="font-size:12px;color:var(--text-muted);">回收后，维修时间段信息不受影响。</p>').then(function(ok){
            if(ok) run();
        });
    } else {
        run();
    }
}

// 完成模式：双击切换完成/未完成状态（带绿扩散 + 反转动画 + 点击跳过）
function completeWithAnim(ev, sid){
    var block = document.querySelector('.task-block[data-sid="'+sid+'"]');
    if(!block) return;

    // 动画中再次点击 → 跳到终点，然后继续处理本次双击
    var existingSpread = block.querySelector('.task-complete-spread');
    if(existingSpread && block.dataset.animDir){
        _skipCompleteSpread(block, sid, block.dataset.animDir);
        delete block.dataset.animDir;
    }

    var isCompleted = block.classList.contains('task-completed');
    if(isCompleted){
        // 已完成 → 取消完成（反转动画）
        fetch('/uncomplete_task/'+sid).then(function(r){ return r.json(); }).then(function(d){
            if(document.body.classList.contains('no-animations')){
                block.classList.remove('task-completed');
                block.draggable = true;
                var s = schedules.find(function(item){ return item.id == sid; });
                if(s) s.status = 'executing';
                var tid = block ? block.dataset.tid : (s ? s.task_id : null);
                if(tid) _updateTaskStatusText(tid, '');
                showToast('已取消完成');
                refreshLiveStatus();
                pushUndo({type:'uncomplete', sid:sid});
                return;
            }
            var rect = block.getBoundingClientRect();
            var cx = ev.clientX - rect.left;
            var cy = ev.clientY - rect.top;
            var maxDist = Math.max(
                Math.hypot(cx, cy),
                Math.hypot(rect.width - cx, cy),
                Math.hypot(cx, rect.height - cy),
                Math.hypot(rect.width - cx, rect.height - cy)
            );
            block.dataset.animDir = 'uncomplete';
            var spread = document.createElement('div');
            spread.className = 'task-complete-spread';
            spread.style.background = block.dataset.origBg || '';
            spread.style.left = cx + 'px';
            spread.style.top = cy + 'px';
            spread.style.width = '0px';
            spread.style.height = '0px';
            block.appendChild(spread);
            requestAnimationFrame(function(){
                spread.style.width = (maxDist * 2) + 'px';
                spread.style.height = (maxDist * 2) + 'px';
            });
            var uncompleteDone = false;
            function finishUncomplete(){
                if(uncompleteDone) return;
                uncompleteDone = true;
                spread.remove();
                delete block.dataset.animDir;
                block.classList.remove('task-completed');
                block.draggable = true;
                var s = schedules.find(function(item){ return item.id == sid; });
                if(s) s.status = 'executing';
                var tid = block ? block.dataset.tid : (s ? s.task_id : null);
                if(tid) _updateTaskStatusText(tid, '');
                showToast('已取消完成');
                refreshLiveStatus();
                pushUndo({type:'uncomplete', sid:sid});
            }
            spread.addEventListener('transitionend', finishUncomplete);
            setTimeout(finishUncomplete, 600);
        });
        return;
    }

    // 完成（切割段后端自动处理，无需弹窗）
    fetch('/complete_task/'+sid).then(function(r){ return r.json(); }).then(function(d){
        block.dataset.origBg = getComputedStyle(block).backgroundImage;
        if(document.body.classList.contains('no-animations')){
            _applyCompleteBlock(block, sid);
            return;
        }
        block.dataset.animDir = 'complete';
        var rect = block.getBoundingClientRect();
        var cx = ev.clientX - rect.left;
        var cy = ev.clientY - rect.top;
        var maxDist = Math.max(
            Math.hypot(cx, cy),
            Math.hypot(rect.width - cx, cy),
            Math.hypot(cx, rect.height - cy),
            Math.hypot(rect.width - cx, rect.height - cy)
        );
        var spread = document.createElement('div');
        spread.className = 'task-complete-spread';
        spread.style.left = cx + 'px';
        spread.style.top = cy + 'px';
        spread.style.width = '0px';
        spread.style.height = '0px';
        block.appendChild(spread);
        requestAnimationFrame(function(){
            spread.style.width = (maxDist * 2) + 'px';
            spread.style.height = (maxDist * 2) + 'px';
        });
        var spreadDone = false;
        function finishComplete(){
            if(spreadDone) return;
            spreadDone = true;
            spread.remove();
            delete block.dataset.animDir;
            _applyCompleteBlock(block, sid);
        }
        spread.addEventListener('transitionend', finishComplete);
        setTimeout(finishComplete, 600);
    });
}

function _skipCompleteSpread(block, sid, dir){
    var spread = block.querySelector('.task-complete-spread');
    if(!spread) return;
    spread.remove();
    if(dir === 'complete'){
        if(!block.classList.contains('task-completed')){
            _applyCompleteBlock(block, sid);
        }
    } else if(dir === 'uncomplete'){
        block.classList.remove('task-completed');
        block.draggable = true;
        var s = schedules.find(function(item){ return item.id == sid; });
        if(s) s.status = 'executing';
        var tid = block ? block.dataset.tid : (s ? s.task_id : null);
        if(tid) _updateTaskStatusText(tid, '');
        showToast('已取消完成');
        refreshLiveStatus();
        pushUndo({type:'uncomplete', sid:sid});
    }
}

function _applyCompleteBlock(block, sid){
    block.classList.add('task-completed');
    var s = schedules.find(function(item){ return item.id == sid; });
    if(s) s.status = 'completed';
    var tid = block ? block.dataset.tid : (s ? s.task_id : null);
    if(tid) _updateTaskStatusText(tid, '已完成');
    showToast('已完成');
    refreshLiveStatus();
    pushUndo({type:'complete', sid:sid});
}

// 删除模式：红圈波纹 → 变红缩小消失 → 真删除（写删除日志+删任务）
function deleteWithAnim(ev, sid){
    var s = schedules.find(function(item){ return item.id == sid; });
    var block = document.querySelector('.task-block[data-sid="'+sid+'"]');
    if(!block) return;

    var doDelete = function(){
        fetch('/delete_schedule/'+sid).then(function(r){ return r.json(); }).then(function(d){
            _silentRefresh();
            refreshLiveStatus();
            showToast('已删除');
            if(s){
                pushUndo({type:'delete', sid:sid, tid:s.task_id, mid:s.machine_id, date:s.date,
                    start_min:s.start_min, end_min:s.end_min, machine_name:s.machine_name,
                    task_name:s.task_name, task_type:s.task_type, task_kind:s.task_kind,
                    priority:s.priority, difficulty:s.difficulty, remark:s.remark,
                    log_id: d.log_id});
            }
        });
    };

    _abortCurrentAnim();
    if(document.body.classList.contains('no-animations')){
        doDelete();
        return;
    }

    var aborted = false;
    _activeAnimCleanup = {
        abort: function(){
            aborted = true;
            var r = block.querySelector('.task-delete-ripple');
            if(r) r.remove();
            block.classList.remove('task-deleting');
            _activeAnimCleanup = null;
            doDelete();
        }
    };

    var rect = block.getBoundingClientRect();
    var cx = ev.clientX - rect.left;
    var cy = ev.clientY - rect.top;
    var ripple = document.createElement('div');
    ripple.className = 'task-delete-ripple';
    ripple.style.left = cx + 'px';
    ripple.style.top = cy + 'px';
    block.appendChild(ripple);
    ripple.addEventListener('animationend', function(){
        if(aborted) return;
        ripple.remove();
        block.classList.add('task-deleting');
        block.addEventListener('animationend', function handler2(){
            block.removeEventListener('animationend', handler2);
            if(aborted) return;
            _activeAnimCleanup = null;
            doDelete();
        });
    });
}

// ========== 任务切割 ==========
var _cutOriginalTask = null;
var _cutOriginalSchedule = null;

function cutTask(ev, sid){
    var s = schedules.find(function(item){ return item.id == sid; });
    if(!s){ showToast('未找到排班记录'); return; }
    if(s.status === 'completed'){ showToast('已完成的任务不能切割'); return; }
    _cutOriginalSchedule = s;
    // 查找关联任务
    fetch('/get_task/' + s.task_id).then(function(r){ return r.json(); }).then(function(task){
        if(!task || task.error){ showToast('未找到关联任务'); return; }
        _cutOriginalTask = task;
        var expectedCount = parseInt(task.expected_count) || 0;
        if(expectedCount > 0){
            showCutDialog(sid, expectedCount);
        } else {
            startCutDragLine(sid);
        }
    }).catch(function(){ showToast('查询任务信息失败'); });
}

// 切割弹窗（有预期采集量时）
var _cutPendingSid = null;
var _cutPendingTotal = 0;
function showCutDialog(sid, totalItems){
    var s = _cutOriginalSchedule || schedules.find(function(item){ return item.id == sid; });
    if(!s) return;
    _cutPendingSid = sid;
    _cutPendingTotal = totalItems;
    document.getElementById('cut-task-name').textContent = s.task_name;
    document.getElementById('cut-total-items').textContent = String(totalItems);
    var inp = document.getElementById('cut-items-done');
    inp.value = '';
    inp.max = String(totalItems - 1);
    document.getElementById('cut-items-remain').textContent = '-';
    document.getElementById('cut-dialog').style.display = 'block';
    document.getElementById('dialog-backdrop').style.display = 'block';
    setTimeout(function(){ if(inp) inp.focus(); }, 100);
}
function confirmCutDialogWrapper(){
    confirmCutDialog(_cutPendingSid, _cutPendingTotal);
}
function startCutDragLineFromDialog(){
    startCutDragLine(_cutPendingSid);
}

function confirmCutDialog(sid, totalItems){
    var val = parseInt(document.getElementById('cut-items-done').value, 10);
    if(isNaN(val) || val < 1 || val >= totalItems){
        showToast('请输入 1 到 ' + (totalItems-1) + ' 之间的已完成条数');
        return;
    }
    closeCutDialog();
    var ratio = val / totalItems;
    doCut(sid, ratio, val, _cutOriginalTask, _cutOriginalSchedule);
}

function closeCutDialog(){
    document.getElementById('cut-dialog').style.display = 'none';
    document.getElementById('dialog-backdrop').style.display = 'none';
}

// 拖拽切割线模式
function startCutDragLine(sid){
    closeCutDialog();
    var block = document.querySelector('.task-block[data-sid="'+sid+'"]');
    if(!block){ showToast('未找到任务条'); return; }
    // 移除已有切割线
    document.querySelectorAll('.cut-splitter').forEach(function(el){ el.remove(); });

    var rect = block.getBoundingClientRect();
    var splitter = document.createElement('div');
    splitter.className = 'cut-splitter';
    splitter.style.cssText = 'position:fixed;left:' + (rect.left + rect.width/2) + 'px;top:' + rect.top + 'px;width:4px;height:' + rect.height + 'px;background:#7c3aed;cursor:col-resize;z-index:100;pointer-events:auto;border-radius:2px;';
    splitter.dataset.sid = sid;

    var dragState = null;
    splitter.addEventListener('mousedown', function(e){
        e.preventDefault(); e.stopPropagation();
        dragState = { startX: e.clientX, startLeft: parseInt(splitter.style.left, 10), blockRect: block.getBoundingClientRect() };
        document.addEventListener('mousemove', onDrag);
        document.addEventListener('mouseup', onDrop);
    });

    function onDrag(e){
        if(!dragState) return;
        var dx = e.clientX - dragState.startX;
        var newLeft = dragState.startLeft + dx;
        var minX = dragState.blockRect.left + 10;
        var maxX = dragState.blockRect.right - 10;
        newLeft = Math.max(minX, Math.min(maxX, newLeft));
        splitter.style.left = newLeft + 'px';
        // 显示比例提示
        var ratio = (newLeft - dragState.blockRect.left) / dragState.blockRect.width;
        splitter.title = '切割点：' + Math.round(ratio * 100) + '%';
    }

    function onDrop(e){
        document.removeEventListener('mousemove', onDrag);
        document.removeEventListener('mouseup', onDrop);
        if(!dragState) return;
        var finalLeft = parseInt(splitter.style.left, 10);
        var ratio = (finalLeft - dragState.blockRect.left) / dragState.blockRect.width;
        ratio = Math.max(0.05, Math.min(0.95, ratio));
        dragState = null;
        splitter.remove();
        // 确认切割
        if(ratio > 0.05 && ratio < 0.95){
            showConfirm('确认切割', '<p>将任务按 <b>' + Math.round(ratio*100) + '%</b> 的比例切割，确认？</p>').then(function(ok){
                if(ok) doCut(sid, ratio, null, _cutOriginalTask, _cutOriginalSchedule);
            });
        }
    }

    document.body.appendChild(splitter);
    showToast('拖动紫色线选择切割点，松开确认');
}

// 执行切割
function doCut(sid, ratio, itemsDone, originalTask, originalSchedule){
    var s = originalSchedule || schedules.find(function(item){ return item.id == sid; });
    if(!s) return;
    var payload = { schedule_id: sid, ratio: ratio };
    if(itemsDone !== null && itemsDone !== undefined) payload.items_done = itemsDone;

    fetch('/cut_task', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)})
        .then(function(r){ return r.json(); }).then(function(d){
            if(d.error){ showToast(d.error); return; }
            // 存储撤销信息（含原task和schedule快照）
            pushUndo({
                type: 'cut',
                split_group: d.split_group,
                original: {
                    task: originalTask || {},
                    schedule: {
                        id: s.id, date: s.date, machine_id: s.machine_id,
                        machine_name: s.machine_name, task_name: s.task_name,
                        task_type: s.task_type, task_kind: s.task_kind,
                        duration: s.duration, remark: s.remark,
                        start_min: s.start_min, end_min: s.end_min
                    }
                },
                created: d.created
            });
            showToast('切割完成');
            _silentRefresh();
        }).catch(function(){ showToast('切割请求失败'); });
}

function _h(str){ return (str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ========== 键盘快捷键：Ctrl+Z / Ctrl+Y ==========
document.addEventListener('keydown', function(ev){
    if(ev.ctrlKey && ev.key === 'z' && !ev.shiftKey){
        ev.preventDefault();
        undoLastAction();
    }
    if(ev.ctrlKey && ev.key === 'y'){
        ev.preventDefault();
        redoLastAction();
    }
});
