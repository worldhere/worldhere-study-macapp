// golden scheduling app — timeline export to image / PDF

function _getExportDateStr() {
    var el = document.getElementById('schedule-date');
    return el ? el.value : '';
}

function _showExportOverlay(title, showProgress) {
    var overlay = document.getElementById('export-overlay');
    if (!overlay) return;
    document.getElementById('export-overlay-title').textContent = title;
    document.getElementById('export-overlay-progress').style.display = showProgress ? '' : 'none';
    document.getElementById('export-overlay-bar-wrap').style.display = showProgress ? '' : 'none';
    overlay.style.display = 'flex';
}

function _updateExportProgress(current, total, label) {
    var stepEl = document.getElementById('export-overlay-step');
    var labelEl = document.getElementById('export-overlay-label');
    var bar = document.getElementById('export-overlay-bar');
    if (stepEl) stepEl.textContent = current + '/' + total;
    if (labelEl) labelEl.textContent = label || '';
    if (bar) bar.style.width = ((current / total) * 100) + '%';
}

function _hideExportOverlay() {
    var overlay = document.getElementById('export-overlay');
    if (overlay) overlay.style.display = 'none';
}

function _preCapture() {
    var stickyCols = document.querySelectorAll('.machine-row .machine-name-col.sticky-col');
    var stickyList = [];
    stickyCols.forEach(function(c) {
        stickyList.push(c);
        c.classList.remove('sticky-col');
    });

    var marker = document.getElementById('current-marker');
    var markerWasShown = marker && marker.style.display !== 'none';
    if (markerWasShown) marker.style.display = 'none';

    return function() {
        stickyList.forEach(function(c) { c.classList.add('sticky-col'); });
        if (markerWasShown) marker.style.display = '';
    };
}

function _captureTimeline(scale) {
    scale = scale || 2;
    var container = document.querySelector('.timeline-container');
    if (!container) return Promise.reject(new Error('找不到时间轴容器'));

    // 保存原始样式
    var origOverflow = container.style.overflow;
    var origOverflowX = container.style.overflowX;
    var origWidth = container.style.width;
    var origMinWidth = container.style.minWidth;
    var origHeight = container.style.height;

    // 先解除宽度约束，让容器缩到实际内容宽度
    container.style.overflow = 'visible';
    container.style.overflowX = 'visible';
    container.style.width = 'max-content';
    container.style.minWidth = '0';
    container.offsetHeight; // 强制 reflow

    // 读取真实内容尺寸（不受 viewport 宽度影响）
    var fullW = container.scrollWidth;
    var fullH = container.scrollHeight;

    // 锁定宽度为内容实际宽度
    container.style.width = fullW + 'px';
    container.style.height = fullH + 'px';

    return html2canvas(container, {
        width: fullW,
        height: fullH,
        scale: scale,
        useCORS: true,
        backgroundColor: '#fafbfc'
    }).then(function(canvas) {
        container.style.overflow = origOverflow;
        container.style.overflowX = origOverflowX;
        container.style.width = origWidth;
        container.style.minWidth = origMinWidth;
        container.style.height = origHeight;
        return canvas;
    });
}

function _downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
}

function exportTimelineImage() {
    var restore = _preCapture();
    return _captureTimeline(4).then(function(canvas) {
        restore();
        return new Promise(function(resolve) {
            canvas.toBlob(function(blob) {
                var date = _getExportDateStr();
                var filename = date ? '排班_' + date + '.png' : '排班_导出.png';
                _downloadBlob(blob, filename);
                resolve();
            }, 'image/png');
        });
    });
}

function handleExportImage() {
    var btn = document.getElementById('export-image-btn');
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    btn.textContent = '导出中...';
    _showExportOverlay('正在生成图片...', false);
    exportTimelineImage().then(function() {
        _hideExportOverlay();
        btn.disabled = false;
        btn.textContent = '导出图片';
    }).catch(function(err) {
        _hideExportOverlay();
        console.error('导出图片失败:', err);
        showToast('导出图片失败: ' + err.message);
        btn.disabled = false;
        btn.textContent = '导出图片';
    });
}

function _switchViewAndRefresh(mode, nightOffset) {
    document.getElementById('view-mode').value = mode;
    _setLS('viewMode', mode);

    if (nightOffset != null) {
        _setLS('nightOffset', String(nightOffset));
    }

    var crc = document.getElementById('custom-range-controls');
    if (crc) crc.style.display = (mode === 'custom') ? '' : 'none';

    if (typeof renderViewMask === 'function') renderViewMask(true);
    if (typeof rebuildTimelineGrid === 'function') rebuildTimelineGrid(true);
    if (typeof _renderAllTaskBlocks === 'function') _renderAllTaskBlocks();
    if (typeof renderShiftOverlaySegments === 'function') renderShiftOverlaySegments();
    if (typeof updateNightOffsetToggle === 'function') updateNightOffsetToggle();

    return new Promise(function(resolve) {
        if (typeof silentRefreshSchedules === 'function') {
            silentRefreshSchedules(resolve);
        } else {
            resolve();
        }
    });
}

function _restoreView(mode, offset, viewMode) {
    document.getElementById('view-mode').value = mode;
    _setLS('viewMode', viewMode);
    _setLS('nightOffset', offset);

    var crc = document.getElementById('custom-range-controls');
    if (crc) crc.style.display = (mode === 'custom') ? '' : 'none';

    if (typeof renderViewMask === 'function') renderViewMask(true);
    if (typeof rebuildTimelineGrid === 'function') rebuildTimelineGrid(true);
    if (typeof _renderAllTaskBlocks === 'function') _renderAllTaskBlocks();
    if (typeof renderShiftOverlaySegments === 'function') renderShiftOverlaySegments();
    if (typeof updateNightOffsetToggle === 'function') updateNightOffsetToggle();

    if (typeof silentRefreshSchedules === 'function') {
        setTimeout(function() { silentRefreshSchedules(); }, 50);
    }
}

function _buildPDF(canvases) {
    var jspdf = window.jspdf;
    if (!jspdf || !jspdf.jsPDF) {
        showToast('PDF库未加载，请刷新页面后重试');
        return;
    }
    var pageWidth = 297; // A4 landscape width in mm

    // 第一页：用第一张 canvas 的高度作为页面高度
    var firstH = (canvases[0].height * pageWidth) / canvases[0].width;
    var doc = new jspdf.jsPDF('l', 'mm', [pageWidth, firstH]);
    doc.addImage(canvases[0].toDataURL('image/jpeg', 0.85), 'JPEG', 0, 0, pageWidth, firstH);

    // 后续页：各自按 canvas 比例设页面高度
    for (var i = 1; i < canvases.length; i++) {
        var h = (canvases[i].height * pageWidth) / canvases[i].width;
        doc.addPage([pageWidth, h]);
        doc.addImage(canvases[i].toDataURL('image/jpeg', 0.85), 'JPEG', 0, 0, pageWidth, h);
    }

    var date = _getExportDateStr();
    var filename = date ? '排班_' + date + '.pdf' : '排班_导出.pdf';
    doc.save(filename);
}

function exportPDF() {
    var nightStyle = localStorage.getItem('nightViewStyle') || 'simple';
    var isSimple = nightStyle === 'simple';

    var views = [
        { mode: 'double', offset: null, label: '双班' },
        { mode: 'day',    offset: null, label: '白班' }
    ];
    if (isSimple) {
        views.push({ mode: 'night', offset: -1, label: '前夜班' });
        views.push({ mode: 'night', offset: 0,  label: '后夜班' });
    } else {
        views.push({ mode: 'night', offset: null, label: '夜班扩展' });
    }

    var savedMode = document.getElementById('view-mode').value;
    var savedOffset = localStorage.getItem('nightOffset') || '0';
    var savedViewMode = localStorage.getItem('viewMode') || '';

    var canvases = [];
    var total = views.length;

    function processNext(index) {
        if (index >= views.length) {
            _buildPDF(canvases);
            _restoreView(savedMode, savedOffset, savedViewMode);
            return Promise.resolve();
        }

        var v = views[index];
        _updateExportProgress(index + 1, total, v.label);
        return _switchViewAndRefresh(v.mode, v.offset).then(function() {
            var restore = _preCapture();
            return _captureTimeline(4).then(function(canvas) {
                restore();
                canvases.push(canvas);
                return processNext(index + 1);
            });
        });
    }

    return processNext(0);
}

function handleExportPDF() {
    var btn = document.getElementById('export-pdf-btn');
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    btn.textContent = '导出中...';
    _showExportOverlay('正在生成 PDF', true);
    exportPDF().then(function() {
        _hideExportOverlay();
        btn.disabled = false;
        btn.textContent = '导出PDF';
    }).catch(function(err) {
        _hideExportOverlay();
        console.error('导出PDF失败:', err);
        showToast('导出PDF失败: ' + err.message);
        btn.disabled = false;
        btn.textContent = '导出PDF';
    });
}
