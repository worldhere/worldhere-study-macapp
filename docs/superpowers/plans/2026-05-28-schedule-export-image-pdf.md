# 排班面板导出图片 & PDF 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为排班面板时间轴添加"导出图片"（单张 PNG）和"导出 PDF"（多视图批量合并）两个功能

**Architecture:** 纯前端方案，html2canvas 将 `.timeline-container` DOM 渲染为 Canvas，jsPDF 将多个 Canvas 合并为 PDF。两个库均本地存放，离线可用。导出时临时关闭 sticky 定位和当前时间红线，截图后恢复。

**Tech Stack:** html2canvas 1.4.1, jsPDF (latest UMD build), vanilla JS, Flask static serving

---

## 文件结构

| 文件 | 操作 | 职责 |
|---|---|---|
| `static/html2canvas.min.js` | 新建 | DOM→Canvas 截图库 |
| `static/jspdf.umd.min.js` | 新建 | Canvas→PDF 合成库 |
| `static/export-image.js` | 新建 | 导出逻辑：capture、image export、PDF batch export |
| `templates/panels/schedule.html` | 修改 | 添加两个导出按钮 |
| `templates/index.html` | 修改 | 引入三个新脚本 |

---

### Task 1: 下载 html2canvas.min.js

**Files:**
- Create: `static/html2canvas.min.js`

- [ ] **Step 1: 从 CDN 下载 html2canvas 1.4.1**

```powershell
Invoke-WebRequest -Uri "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js" -OutFile "static\html2canvas.min.js"
```

- [ ] **Step 2: 验证文件存在且非空**

```powershell
(Get-Item "static\html2canvas.min.js").Length
```

Expected: 文件大小 > 30KB

---

### Task 2: 下载 jspdf.umd.min.js

**Files:**
- Create: `static/jspdf.umd.min.js`

- [ ] **Step 1: 从 CDN 下载 jsPDF UMD 版本**

```powershell
Invoke-WebRequest -Uri "https://cdn.jsdelivr.net/npm/jspdf@3.0.2/dist/jspdf.umd.min.js" -OutFile "static\jspdf.umd.min.js"
```

- [ ] **Step 2: 验证文件存在且非空**

```powershell
(Get-Item "static\jspdf.umd.min.js").Length
```

Expected: 文件大小 > 100KB

---

### Task 3: 创建 export-image.js 核心逻辑

**Files:**
- Create: `static/export-image.js`

- [ ] **Step 1: 创建文件骨架和辅助函数**

```js
// golden scheduling app — timeline export to image / PDF

/** 获取当前日期字符串 */
function _getExportDateStr() {
    var el = document.getElementById('schedule-date');
    return el ? el.value : '';
}

/** 关闭 sticky 和隐藏红线，返回恢复函数 */
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

/** 将 timeline-container 渲染为 Canvas */
function _captureTimeline() {
    var container = document.querySelector('.timeline-container');
    if (!container) return Promise.reject(new Error('找不到时间轴容器'));

    return html2canvas(container, {
        scrollX: -container.scrollLeft,
        scrollY: -window.scrollY,
        width: container.scrollWidth,
        height: container.scrollHeight,
        scale: 2,
        useCORS: true,
        backgroundColor: '#fafbfc'
    });
}

/** 触发浏览器下载文件 */
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
```

- [ ] **Step 2: 写入导出图片函数**

```js
/** 导出当前视图为单张 PNG */
function exportTimelineImage() {
    var restore = _preCapture();
    return _captureTimeline().then(function(canvas) {
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
```

- [ ] **Step 3: 写入按钮包装函数**

```js
function handleExportImage() {
    var btn = document.getElementById('export-image-btn');
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    btn.textContent = '导出中...';
    exportTimelineImage().then(function() {
        btn.disabled = false;
        btn.textContent = '导出图片';
    }).catch(function(err) {
        console.error('导出图片失败:', err);
        showToast('导出图片失败: ' + err.message);
        btn.disabled = false;
        btn.textContent = '导出图片';
    });
}
```

- [ ] **Step 4: 写入视图切换并等待刷新函数**

```js
/** 切换视图并等待服务端数据刷新完成 */
function _switchViewAndRefresh(mode, nightOffset) {
    document.getElementById('view-mode').value = mode;
    localStorage.setItem('viewMode', mode);

    // 保存/恢复 night offset
    if (nightOffset != null) {
        localStorage.setItem('nightOffset', String(nightOffset));
    }

    // 自定义范围控件显隐
    var crc = document.getElementById('custom-range-controls');
    if (crc) crc.style.display = (mode === 'custom') ? '' : 'none';

    // 同步 DOM 更新
    if (typeof renderViewMask === 'function') renderViewMask(true);
    if (typeof rebuildTimelineGrid === 'function') rebuildTimelineGrid(true);
    if (typeof _renderAllTaskBlocks === 'function') _renderAllTaskBlocks();
    if (typeof renderShiftOverlaySegments === 'function') renderShiftOverlaySegments();
    if (typeof updateNightOffsetToggle === 'function') updateNightOffsetToggle();

    // 等待服务端拉取最新数据
    return new Promise(function(resolve) {
        if (typeof silentRefreshSchedules === 'function') {
            silentRefreshSchedules(resolve);
        } else {
            resolve();
        }
    });
}
```

- [ ] **Step 5: 写入 PDF 批量导出函数**

```js
/** 批量导出 PDF */
function exportPDF() {
    var nightStyle = localStorage.getItem('nightViewStyle') || 'simple';
    var isSimple = nightStyle === 'simple';

    // 构建视图列表
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

    // 保存当前视图状态
    var savedMode = document.getElementById('view-mode').value;
    var savedOffset = localStorage.getItem('nightOffset') || '0';
    var savedViewMode = localStorage.getItem('viewMode') || '';

    var canvases = [];

    function processNext(index) {
        if (index >= views.length) {
            // 全部截图完成，合成 PDF
            _buildPDF(canvases);
            // 恢复视图
            _restoreView(savedMode, savedOffset, savedViewMode);
            return Promise.resolve();
        }

        var v = views[index];
        return _switchViewAndRefresh(v.mode, v.offset).then(function() {
            var restore = _preCapture();
            return _captureTimeline().then(function(canvas) {
                restore();
                canvases.push(canvas);
                return processNext(index + 1);
            });
        });
    }

    return processNext(0);
}

/** 恢复到导出前的视图 */
function _restoreView(mode, offset, viewMode) {
    document.getElementById('view-mode').value = mode;
    localStorage.setItem('viewMode', viewMode);
    localStorage.setItem('nightOffset', offset);

    var crc = document.getElementById('custom-range-controls');
    if (crc) crc.style.display = (mode === 'custom') ? '' : 'none';

    if (typeof renderViewMask === 'function') renderViewMask(true);
    if (typeof rebuildTimelineGrid === 'function') rebuildTimelineGrid(true);
    if (typeof _renderAllTaskBlocks === 'function') _renderAllTaskBlocks();
    if (typeof renderShiftOverlaySegments === 'function') renderShiftOverlaySegments();
    if (typeof updateNightOffsetToggle === 'function') updateNightOffsetToggle();

    // 异步拉数据
    if (typeof silentRefreshSchedules === 'function') {
        setTimeout(function() { silentRefreshSchedules(); }, 50);
    }
}

/** 用 jsPDF 将多个 Canvas 合成 PDF */
function _buildPDF(canvases) {
    var jspdf = window.jspdf;
    if (!jspdf || !jspdf.jsPDF) {
        showToast('PDF 库未加载，请刷新页面后重试');
        return;
    }
    var doc = new jspdf.jsPDF('l', 'mm', 'a4');
    var pageWidth = doc.internal.pageSize.getWidth();

    canvases.forEach(function(canvas, i) {
        if (i > 0) doc.addPage();
        var imgData = canvas.toDataURL('image/png');
        var imgHeight = (canvas.height * pageWidth) / canvas.width;
        doc.addImage(imgData, 'PNG', 0, 0, pageWidth, imgHeight);
    });

    var date = _getExportDateStr();
    var filename = date ? '排班_' + date + '.pdf' : '排班_导出.pdf';
    doc.save(filename);
}

function handleExportPDF() {
    var btn = document.getElementById('export-pdf-btn');
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    btn.textContent = '导出中...';
    exportPDF().then(function() {
        btn.disabled = false;
        btn.textContent = '导出PDF';
    }).catch(function(err) {
        console.error('导出PDF失败:', err);
        showToast('导出PDF失败: ' + err.message);
        btn.disabled = false;
        btn.textContent = '导出PDF';
    });
}
```

- [ ] **Step 6: 验证文件完整性**

```powershell
(Get-Content "static\export-image.js" | Measure-Object -Line).Lines
```

Expected: > 100 行

---

### Task 4: 修改 schedule.html 添加按钮

**Files:**
- Modify: `templates/panels/schedule.html:6`

- [ ] **Step 1: 在"批量延迟"按钮后添加两个导出按钮**

找到：
```html
<button class="tool-btn" style="background:var(--warning);" onclick="openMassDelayDialog()">批量延迟</button>
```

替换为：
```html
<button class="tool-btn" style="background:var(--warning);" onclick="openMassDelayDialog()">批量延迟</button>
<button id="export-image-btn" class="tool-btn" style="background:var(--primary);" onclick="handleExportImage()">导出图片</button>
<button id="export-pdf-btn" class="tool-btn" style="background:var(--danger);" onclick="handleExportPDF()">导出PDF</button>
```

- [ ] **Step 2: 验证 HTML 修改**

```powershell
Select-String -Path "templates\panels\schedule.html" -Pattern "export-image-btn|export-pdf-btn"
```

Expected: 两行匹配

---

### Task 5: 修改 index.html 引入脚本

**Files:**
- Modify: `templates/index.html:138`

- [ ] **Step 1: 在 shift-posts.js 之后添加三个新脚本标签**

在 `templates/index.html` 的 `shift-posts.js` 引用行之后，`{% if version_mismatch %}` 之前，添加：

```html
<script src="{{ url_for('static', filename='html2canvas.min.js') }}"></script>
<script src="{{ url_for('static', filename='jspdf.umd.min.js') }}"></script>
<script src="{{ url_for('static', filename='export-image.js') }}"></script>
```

- [ ] **Step 2: 验证 HTML 修改**

```powershell
Select-String -Path "templates\index.html" -Pattern "html2canvas|jspdf|export-image"
```

Expected: 三行匹配

---

### Task 6: 验证与测试

- [ ] **Step 1: 启动应用并验证页面加载无 JS 报错**

```powershell
python app.py
```

打开浏览器访问应用，打开开发者工具 Console，刷新页面，确认无 JS 错误。

- [ ] **Step 2: 测试导出图片**

1. 切换到排班面板
2. 点击"导出图片"按钮
3. 验证：下载了 `排班_{date}.png` 文件
4. 验证：PNG 包含完整时间轴（机器名列 + 任务块 + 表头）
5. 验证：不包含任务池内容
6. 验证：界面恢复正常

- [ ] **Step 3: 测试导出 PDF（简洁模式）**

1. 设置夜班视图为简洁模式
2. 点击"导出PDF"
3. 验证：下载了 4 页 PDF（双班、白班、前夜班、后夜班）
4. 验证：每页图片完整
5. 验证：视图恢复到导出前状态

- [ ] **Step 4: 测试导出 PDF（扩展模式）**

1. 设置夜班视图为扩展模式
2. 点击"导出PDF"
3. 验证：下载了 3 页 PDF（双班、白班、夜班扩展）
4. 验证：每页图片完整
5. 验证：视图恢复到导出前状态

- [ ] **Step 5: 测试边界情况**

1. 点击"导出图片"后立即再点一次 → 按钮应该禁用，不会触发第二次导出
2. 切换为自定义视图后点"导出图片" → 正常导出当前自定义视图
3. 调整列宽/行高后导出 → PNG 反映当前缩放设置
4. 关闭当前时间红线后导出 → PNG 中不含红线

- [ ] **Step 6: 测试离线可用**

断开外网，刷新页面，点击导出按钮 → 功能正常（html2canvas 和 jsPDF 均为本地文件）。
