// golden scheduling app — split-shift view (独立面板，不和连续时间轴共享 DOM)

// ========== 入口：刷新分班时间轴 ==========

function splitRefreshTimeline() {
    var date = document.getElementById('schedule-date').value;
    var vm = localStorage.getItem('viewMode') || 'double';
    var spanDays = 3;
    var schedUrl = '/api/view_schedules?date=' + encodeURIComponent(date) + '&span_days=' + spanDays;

    Promise.all([
        fetch('/api/machines').then(function(r) { return r.json(); }),
        fetch(schedUrl).then(function(r) { return r.json(); })
    ]).then(function(results) {
        var machines = results[0].machines;
        var data = results[1];
        schedules = data.schedules;
        window._repairLogs = data.repair_logs || {};

        // 过滤隐藏机器
        if (typeof _filterMachinesByUI === 'function') machines = _filterMachinesByUI(machines);
        if (typeof _sortMachinesByURL === 'function') machines = _sortMachinesByURL(machines);
        machines = machines.filter(function(m) { return !_hiddenMachineIds.has(m.id); });

        var isDouble = vm === 'double';
        document.getElementById('split-axis-night').style.display = isDouble ? '' : 'none';

        // 在每个轴独立创建机器行
        _splitCreateMachineRows('split-tc-day', machines);
        if (isDouble) _splitCreateMachineRows('split-tc-night', machines);

        // 置顶列
        if (document.getElementById('split-sticky-col') && document.getElementById('split-sticky-col').checked) {
            document.querySelectorAll('#panel-split-schedule .machine-name-col').forEach(function(el) {
                el.classList.add('sticky-col');
            });
        }

        splitRebuildGrid();
        splitRenderTaskBlocks();
        if (typeof refreshLiveStatus === 'function') refreshLiveStatus();
    }).catch(function(e) {
        console.error('分班视图加载失败:', e);
        if (typeof showToast === 'function') showToast('分班视图加载失败');
    });
}

// ========== 机器行创建 ==========

function _splitCreateMachineRows(containerId, machines) {
    var cont = document.getElementById(containerId);
    if (!cont) return;
    cont.querySelectorAll('.machine-row').forEach(function(r) { r.remove(); });
    machines.forEach(function(m) {
        var row = document.createElement('div');
        row.className = 'timeline-grid machine-row';
        row.dataset.mid = m.id;
        row.innerHTML =
            '<div class="machine-name-col" title="' + escHtml(m.name) + '(' + escHtml(m.type) + '/' + escHtml(m.task_kind) + ')">' +
            escHtml(m.name) + '(' + escHtml(m.type) + '/' + escHtml(m.task_kind) + ')</div>' +
            '<div class="timeline-track ' + (m.status === '维修停用' ? 'repair-track' : '') + '"' +
            ' data-mid="' + m.id + '" data-mtype="' + escHtml(m.type) + '" data-mkind="' + escHtml(m.task_kind || '') +
            '" data-mstatus="' + escHtml(m.status) + '"' +
            ' ondrop="dropTask(event)" ondragover="allowDrop(event)">' +
            '<div class="shift-overlay"></div>' +
            '</div>';
        cont.appendChild(row);
    });
}

// ========== 视图范围 ==========

function _splitGetViewRange(trackType, viewMode) {
    var absVs, absVe;
    if (viewMode === 'day' || viewMode === 'night' || viewMode === 'double') {
        absVs = -MINS_PER_DAY;
        absVe = 2 * MINS_PER_DAY;
    } else {
        var r = getViewRange();
        absVs = r[0];
        absVe = r[1];
    }
    return getShiftWindows(absVs, absVe, trackType);
}

// ========== 重建网格 ==========

function splitRebuildGrid() {
    var vm = localStorage.getItem('viewMode') || 'double';

    if (vm === 'double') {
        _splitBuildHeaders('split-axis-day', 'day', vm);
        _splitBuildHeaders('split-axis-night', 'night', vm);
    } else if (vm === 'day' || vm === 'custom-day') {
        _splitBuildHeaders('split-axis-day', 'day', vm);
    } else {
        _splitBuildHeaders('split-axis-day', 'night', vm);
    }
}

function _splitBuildHeaders(axisId, trackType, viewMode) {
    var axis = document.getElementById(axisId);
    if (!axis) return;

    var isNight = axisId === 'split-axis-night';
    var dateId = isNight ? 'split-header-date-night' : 'split-header-date-day';
    var hourId = isNight ? 'split-header-hour-night' : 'split-header-hour-day';
    var headerDate = document.getElementById(dateId);
    var headerHour = document.getElementById(hourId);
    if (!headerDate || !headerHour) return;

    var windows = _splitGetViewRange(trackType, viewMode);
    if (!windows.length) return;

    var cfg = _getTrackConfig(trackType);
    var dw = cfg.dw;
    var firstIdx = windows[0].windowIndex;
    var splitStart = firstIdx * dw;

    // 按窗口拆分列，避免列跨越窗口边界
    var fullColsPerWindow = Math.floor(dw / MINS_PER_HOUR);
    var remainder = dw % MINS_PER_HOUR;
    var colsPerWindow = fullColsPerWindow + (remainder > 0 ? 1 : 0);
    var totalCols = windows.length * colsPerWindow;

    // 存 splitStart 到容器
    var contId = isNight ? 'split-tc-night' : 'split-tc-day';
    var cont = document.getElementById(contId);
    if (cont) cont.dataset.splitStart = String(splitStart);

    // 构建 grid-template-columns：每窗口末尾列宽度按剩余分钟比例缩放
    var gridColsStr = '130px';
    for (var w = 0; w < windows.length; w++) {
        for (var j = 0; j < fullColsPerWindow; j++) {
            gridColsStr += ' var(--hourWidth)';
        }
        if (remainder > 0) {
            gridColsStr += ' calc(var(--hourWidth) * ' + remainder + ' / 60)';
        }
    }

    // hour header — 每列标注该列起点对应的真实钟点
    while (headerHour.children.length > 1) headerHour.removeChild(headerHour.lastElementChild);
    for (var w = 0; w < windows.length; w++) {
        var wSplitStart = (firstIdx + w) * dw;
        for (var j = 0; j < fullColsPerWindow; j++) {
            var sm = wSplitStart + j * MINS_PER_HOUR;
            var am = splitMinToAbs(sm, trackType);
            var hMod = ((Math.round(am) % MINS_PER_DAY) + MINS_PER_DAY) % MINS_PER_DAY;
            var hh = Math.floor(hMod / MINS_PER_HOUR);
            var div = document.createElement('div');
            div.className = 'timeline-hour';
            div.textContent = String(hh).padStart(2, '0') + ':00';
            headerHour.appendChild(div);
        }
        if (remainder > 0) {
            var sm2 = wSplitStart + fullColsPerWindow * MINS_PER_HOUR;
            var am2 = splitMinToAbs(sm2, trackType);
            var hMod2 = ((Math.round(am2) % MINS_PER_DAY) + MINS_PER_DAY) % MINS_PER_DAY;
            var hh2 = Math.floor(hMod2 / MINS_PER_HOUR);
            var div2 = document.createElement('div');
            div2.className = 'timeline-hour';
            div2.textContent = String(hh2).padStart(2, '0') + ':00';
            headerHour.appendChild(div2);
        }
    }

    // date header — 每个窗口 = 一天，整窗跨度显示日期
    while (headerDate.children.length > 1) headerDate.removeChild(headerDate.lastElementChild);
    var base = document.getElementById('schedule-date').value;
    var colIdx = 0;
    for (var w = 0; w < windows.length; w++) {
        var dayOff = windows[w].windowIndex;
        var ddiv = document.createElement('div');
        ddiv.className = 'timeline-date';
        ddiv.textContent = _dateAddDays(base, dayOff);
        ddiv.style.gridColumn = (colIdx + 2) + ' / ' + (colIdx + colsPerWindow + 2);
        headerDate.appendChild(ddiv);
        colIdx += colsPerWindow;
    }

    // grid columns — 应用到所有行
    headerDate.style.gridTemplateColumns = gridColsStr;
    headerHour.style.gridTemplateColumns = gridColsStr;
    if (cont) {
        cont.querySelectorAll('.machine-row').forEach(function(row) {
            row.style.gridTemplateColumns = gridColsStr;
            var track = row.querySelector('.timeline-track');
            if (track) {
                track.style.gridColumn = '2 / ' + (totalCols + 2);
                track.dataset.trackType = trackType;
            }
        });
    }

    // 叠加层
    _splitRenderOverlay(axis, trackType, windows, splitStart);
}

function _splitRenderOverlay(axis, trackType, windows, splitStart) {
    var cfg = _getTrackConfig(trackType);
    axis.querySelectorAll('.timeline-track').forEach(function(track) {
        var ov = track.querySelector('.shift-overlay');
        if (!ov) return;
        ov.innerHTML = '';

        windows.forEach(function(w) {
            _renderSeg(ov, absToSplitMin(w.absStart, trackType), absToSplitMin(w.absEnd, trackType), 'seg-work', splitStart);
            // 加班
            var otRanges = [];
            if (trackType === 'night') {
                var absOt = _shiftAbsifyRanges(cfg.ws, SHIFT.night_shift.overtime, cfg.crosses);
                absOt.forEach(function(p) {
                    otRanges.push([w.windowIndex * MINS_PER_DAY + p[0], w.windowIndex * MINS_PER_DAY + p[1]]);
                });
            } else {
                (SHIFT.day_shift.overtime || []).forEach(function(p) {
                    otRanges.push([w.windowIndex * MINS_PER_DAY + p[0], w.windowIndex * MINS_PER_DAY + (p[1] <= p[0] ? MINS_PER_DAY : p[1])]);
                });
            }
            otRanges.forEach(function(p) {
                if (p[1] > w.absStart && p[0] < w.absEnd) {
                    _renderSeg(ov, absToSplitMin(Math.max(p[0], w.absStart), trackType),
                        absToSplitMin(Math.min(p[1], w.absEnd), trackType), 'seg-ot', splitStart);
                }
            });
            // 休息
            var breaks = trackType === 'day' ? (SHIFT.day_shift.breaks || []) : (SHIFT.night_shift.breaks || []);
            breaks.forEach(function(p) {
                var ba, bb;
                if (trackType === 'night') {
                    var absB = _shiftAbsifyRanges(cfg.ws, [[p[0], p[1]]], cfg.crosses);
                    ba = w.windowIndex * MINS_PER_DAY + absB[0][0];
                    bb = w.windowIndex * MINS_PER_DAY + absB[0][1];
                } else {
                    ba = w.windowIndex * MINS_PER_DAY + p[0];
                    bb = w.windowIndex * MINS_PER_DAY + p[1];
                }
                if (bb > w.absStart && ba < w.absEnd) {
                    _renderSeg(ov, absToSplitMin(Math.max(ba, w.absStart), trackType),
                        absToSplitMin(Math.min(bb, w.absEnd), trackType), 'seg-break', splitStart);
                }
            });
        });

        // 空隙 — 在 split-minute 空间计算，避免像素值二次转换
        var allSegs = ov.querySelectorAll('.seg');
        var occupiedMin = [];
        allSegs.forEach(function(s) {
            var leftPx = parseFloat(s.style.left) || 0;
            var widthPx = parseFloat(s.style.width) || 0;
            var leftMin = splitStart + pxToMin(leftPx);
            var rightMin = leftMin + pxToMin(widthPx);
            occupiedMin.push([leftMin, rightMin]);
        });
        occupiedMin.sort(function(a, b) { return a[0] - b[0]; });
        var cursorMin = splitStart;
        occupiedMin.forEach(function(p) {
            if (p[0] > cursorMin) _renderSeg(ov, cursorMin, p[0], 'seg-gap', splitStart);
            cursorMin = Math.max(cursorMin, p[1]);
        });
        var totalMin = splitStart + cfg.dw * windows.length;
        if (cursorMin < totalMin) _renderSeg(ov, cursorMin, totalMin, 'seg-gap', splitStart);
    });
}

// ========== 任务块渲染 ==========

function splitRenderTaskBlocks() {
    // 清除旧块
    document.querySelectorAll('#panel-split-schedule .task-block').forEach(function(b) { b.remove(); });

    var vm = localStorage.getItem('viewMode') || 'double';
    var isDouble = vm === 'double';

    schedules.forEach(function(s) {
        var absStart = s.abs_start_min != null ? s.abs_start_min : _dateMinToAbs(s.date, s.start_min);
        var absEnd = s.abs_end_min != null ? s.abs_end_min : _dateMinToAbs(s.date, s.end_min);

        // 分类任务归属
        var trackType = _splitClassifyTask(absStart);
        var displayStart = absToSplitMin(absStart, trackType);
        var displayEnd = absToSplitMin(absEnd, trackType);

        // 找正确的轨道
        var track;
        if (isDouble && trackType === 'night') {
            var na = document.getElementById('split-axis-night');
            if (na) track = na.querySelector('.timeline-track[data-mid="' + s.machine_id + '"]');
        }
        if (!track) {
            var da = document.getElementById('split-axis-day');
            if (da) track = da.querySelector('.timeline-track[data-mid="' + s.machine_id + '"]');
        }
        if (!track) return;

        var blk = _createTaskBlock({
            sid: s.id, tid: s.task_id,
            name: s.task_name, type: s.task_type, task_kind: s.task_kind,
            priority: s.priority, difficulty: s.difficulty, remark: s.remark,
            abs_start_min: displayStart, abs_end_min: displayEnd,
            _fmt_start_min: absStart, _fmt_end_min: absEnd,
            status: s.status,
            split_group: s.split_group,
            package_id: s.package_id,
            package_name: s.package_name,
            machineType: track.dataset.mtype || '',
            machineKind: track.dataset.mkind || '',
            machineStatus: track.dataset.mstatus || '',
            machineId: s.machine_id,
        });
        track.appendChild(blk);

        // 像素定位——用轴容器 splitStart
        var axCont = track.closest('.split-timeline-container');
        var axSs = axCont ? (parseInt(axCont.dataset.splitStart, 10) || 0) : 0;
        blk.style.left = minToPx(displayStart - axSs) + 'px';
        blk.style.width = minToPx(Math.max(1, displayEnd - displayStart)) + 'px';

        if (typeof _checkTaskBlockStacked === 'function') _checkTaskBlockStacked(blk);
        if (typeof syncTaskTableTime === 'function') syncTaskTableTime(blk, absStart, absEnd);
    });
}

function _splitClassifyTask(absMin) {
    var minOfDay = ((Math.round(absMin) % MINS_PER_DAY) + MINS_PER_DAY) % MINS_PER_DAY;
    var ds = hhmmToMin(SHIFT.day_shift.start || '09:00');
    var de = hhmmToMin(SHIFT.day_shift.end || '18:30');
    var ns = hhmmToMin(SHIFT.night_shift.start || '21:00');
    var ne = hhmmToMin(SHIFT.night_shift.end || '06:30');
    if (minOfDay >= ds && minOfDay < de) return 'day';
    if (minOfDay >= ns || minOfDay < ne) return 'night';
    // 空隙：往前找最近的班次
    return (minOfDay >= de && minOfDay < ns) ? 'night' : 'day';
}

// ========== 视图设置 ==========

function splitApplyViewSettings() {
    var mode = document.getElementById('split-view-mode').value;
    _setLS('viewMode', mode);
    var crc = document.getElementById('split-custom-range');
    if (crc) crc.style.display = (mode === 'custom-day' || mode === 'custom-night') ? '' : 'none';
    splitRebuildGrid();
    splitRenderTaskBlocks();
}

function splitSetZoom() {
    var hw = parseInt(document.getElementById('split-zoom-hour').value, 10);
    var rh = parseInt(document.getElementById('split-zoom-row').value, 10);
    document.documentElement.style.setProperty('--hourWidth', hw + 'px');
    document.documentElement.style.setProperty('--rowHeight', rh + 'px');
    _setLS('zoomHour', String(hw)); _setLS('zoomRow', String(rh));
    splitRebuildGrid();
    splitRenderTaskBlocks();
}

function splitRenderCurrentMarker() {
    var checked = document.getElementById('split-show-marker');
    var enabled = checked && checked.checked;

    var now = new Date();
    var h = now.getHours(), m = now.getMinutes(), s = now.getSeconds();
    var nowMin = h * MINS_PER_HOUR + m + (s / MINS_PER_HOUR);

    var baseDateStr = document.getElementById('schedule-date').value;
    var baseDt = baseDateStr ? new Date(baseDateStr + 'T00:00:00') : null;
    var diffDays = 0;
    if (baseDt && !isNaN(baseDt.getTime())) {
        var today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        diffDays = Math.round((today0.getTime() - baseDt.getTime()) / (MINS_PER_DAY * 60 * 1000));
    }
    var nowAbs = diffDays * MINS_PER_DAY + nowMin;

    // 判断当前时间属于哪个班次，只在对应轴上显示红线
    var currentShift = _splitClassifyTask(nowAbs);

    ['split-tc-day', 'split-tc-night'].forEach(function(contId) {
        var cont = document.getElementById(contId);
        if (!cont) return;
        var marker = cont.querySelector('.current-time-marker');
        if (!marker) return;

        var trackType = contId === 'split-tc-night' ? 'night' : 'day';

        // 当前时间不属于这个班次，不显示
        if (!enabled || trackType !== currentShift) {
            marker.style.display = 'none';
            return;
        }

        var ss = parseInt(cont.dataset.splitStart, 10) || 0;

        // 绝对分钟 → 压缩分钟
        var splitMin = absToSplitMin(nowAbs, trackType);

        // 低于可视范围起点则隐藏，超出右边界由 overflow 裁剪
        if (splitMin < ss) {
            marker.style.display = 'none';
            return;
        }

        var offsetPx = minToPx(splitMin - ss);
        marker.style.display = 'block';
        marker.style.left = (MACHINE_NAME_WIDTH + offsetPx) + 'px';
    });
}

function splitToggleStickyCol() {
    var checked = document.getElementById('split-sticky-col').checked;
    document.querySelectorAll('#panel-split-schedule .machine-name-col').forEach(function(el) {
        el.classList.toggle('sticky-col', checked);
    });
}

// ========== 初始化：恢复视图选择 ==========

function splitInitViewMode() {
    var vm = localStorage.getItem('viewMode') || 'double';
    var sel = document.getElementById('split-view-mode');
    if (sel) {
        for (var i = 0; i < sel.options.length; i++) {
            if (sel.options[i].value === vm) { sel.value = vm; break; }
        }
    }
    var crc = document.getElementById('split-custom-range');
    if (crc) crc.style.display = (vm === 'custom-day' || vm === 'custom-night') ? '' : 'none';
}
