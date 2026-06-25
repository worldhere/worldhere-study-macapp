# 排班面板导出图片 & PDF 设计

## 概述

为排班面板（时间轴视图）提供两个导出功能：
1. **导出图片** — 将当前视图的时间轴渲染为单张 PNG
2. **导出 PDF** — 自动切换多视图，批量截图后合并为一个 PDF

技术方案：html2canvas（DOM→Canvas）+ jsPDF（Canvas→PDF），纯前端离线运行。

## 新增文件

| 文件 | 用途 |
|---|---|
| `static/html2canvas.min.js` | html2canvas 1.4.1，DOM 截图库 |
| `static/jspdf.umd.min.js` | jsPDF，客户端 PDF 生成 |
| `static/export-image.js` | 图片导出 + PDF 批量导出逻辑 |

## 修改文件

| 文件 | 改动 |
|---|---|
| `templates/index.html` | 引入 `html2canvas.min.js`、`jspdf.umd.min.js`、`export-image.js` |
| `templates/panels/schedule.html` | 在"批量延迟"按钮后添加"导出图片"和"导出PDF"两个按钮 |

## 导出图片

### 按钮

```html
<button id="export-image-btn" class="tool-btn"
        style="background:var(--primary);"
        onclick="handleExportImage()">导出图片</button>
```

放在"批量延迟"按钮右侧，与现有工具栏按钮同级。

### 流程

1. 点击按钮 → 按钮禁用，文字变为"导出中..."
2. 预处理：关闭 sticky 定位（`.sticky-col` class 移除）、隐藏当前时间红线
3. `html2canvas(.timeline-container, { scrollX, scrollY, width: scrollWidth, height: scrollHeight, scale: 2 })`
4. 恢复 sticky 和红线
5. `canvas.toBlob()` → 创建 `<a>` 触发下载
6. 按钮恢复

### 配置

- `scale: 2`（2x 高清）
- `backgroundColor: '#fafbfc'`
- `useCORS: true`
- 捕获完整滚动区域（`scrollWidth` / `scrollHeight`）

### 文件名

`排班_{date}.png`，date 取自 `#schedule-date` 的值

### 导出范围

仅 `.timeline-container` 内部：时间表头（日期行 + 小时行）、机器名列、任务块、班次叠加层、维修覆盖层。**不含任务池和控制栏。**

## 导出 PDF

### 按钮

```html
<button id="export-pdf-btn" class="tool-btn"
        style="background:var(--danger);"
        onclick="handleExportPDF()">导出PDF</button>
```

放在"导出图片"按钮右侧。

### 流程

1. 保存当前视图状态（view-mode、nightOffset）
2. 读取 `night_view_style` 设置，决定视图列表：
   - **简洁模式（simple）**：双班、白班、前夜班(offset=-1)、后夜班(offset=0) —— 4 页
   - **扩展模式（extended）**：双班、白班、夜班扩展 —— 3 页
3. 串行迭代视图列表：
   - 设置 `view-mode` 和 `nightOffset`
   - 调用 `applyViewSettings()` 触发 DOM 重绘
   - `await` 等待 `silentRefreshSchedules()` 完成（数据从服务端拉取后 DOM 更新完毕）
   - 执行与"导出图片"相同的 capture 逻辑（关 sticky、隐藏红线、html2canvas、恢复）
   - 收集 canvas
4. 用 jsPDF 合成 PDF（landscape A4），每页一个 canvas，等比缩放至页宽
5. 触发下载 `排班_{date}.pdf`
6. 恢复到导出前的视图

### PDF 配置

- 方向：landscape（横版）
- 纸张：A4
- 图片缩放：等比缩放到页宽，高度自动计算

### 自定义视图

自定义视图（`view-mode=custom`）不在 PDF 批量导出范围内，使用单独的"导出图片"按钮导出。

## 数据流

```
用户点击"导出图片"或"导出PDF"
       ↓
 export-image.js 处理函数
       ↓
   ┌─ 图片：单次 html2canvas
   └─ PDF：循环切换视图 + html2canvas × N → jsPDF 合成
       ↓
  Canvas → Blob/PDF → 浏览器下载
```

## 按钮状态管理

两个按钮各自独立的状态管理：

```js
async function handleExportImage() {
  const btn = document.getElementById('export-image-btn');
  if (btn.disabled) return;
  btn.disabled = true;
  btn.textContent = '导出中...';
  try { await exportTimelineImage(); }
  finally { btn.disabled = false; btn.textContent = '导出图片'; }
}
```

PDF 同理，按钮文字变为"导出中..."，禁用防止重复点击。

## html2canvas 预处理

截图前执行的临时 DOM 修改，完成后恢复：

1. 移除所有 `.sticky-col` class（机器名列 sticky 定位）
2. 隐藏 `#current-marker` 元素（当前时间红线）
3. 截图后恢复

`scale: 2` 确保 Retina 屏幕下输出清晰。

## 离线可用

html2canvas 和 jsPDF 均以 `.min.js` 文件放在 `static/` 目录下，通过 Flask `url_for('static', ...)` 本地引用，不依赖任何 CDN 或外部网络。

## 测试要点

1. 导出图片：验证 PNG 包含完整时间轴（含滚动区域）和机器名列
2. 导出 PDF（简洁模式）：验证 4 页，每页视图正确
3. 导出 PDF（扩展模式）：验证 3 页
4. 导出后视图恢复到原始状态
5. 按钮防重复点击
6. 不包含任务池内容
7. 离线环境可正常导出
8. 不同列宽/行高缩放设置下导出正确
9. 当前时间红线隐藏后不被截入
