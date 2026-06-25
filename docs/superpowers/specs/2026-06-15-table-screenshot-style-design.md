# 表格截图样式（样式二）设计

## 背景

飞书截图发送功能目前只有一种样式——html2canvas 截取时间轴 DOM。需要增加第二种样式作为替代选择，之前用 matplotlib 的方案因字体依赖和复杂度问题失败。

## 方案

用 **Pillow (PIL)** 在 Python 服务端直接画表格图片，生成 PNG 后走已有的飞书图片上传管线。

### 视觉风格

深色表头（#1e3a5f）+ 标准 Excel 网格线（#c8ccd4）：

| 要素 | 规格 |
|------|------|
| 表头 | 深蓝底 #1e3a5f，白字时间标签 |
| 机器名列 | 左侧固定列，浅灰底 #f4f5f7，加粗黑字 |
| 网格线 | 所有格子 1px #c8ccd4 |
| 任务格 | 机器类型对应实色背景 + 白字居中 |
| 空闲格 | 浅灰底 #fafbfc，"空闲" 灰字 #c0c4cc 居中 |
| 时间槽 | 30 分钟一格 |
| 行高 | 约 40px |

### 数据流

```
用户选日期/班次 → 点"表格截图" 
  → Python 查询 schedules + machines + type_colors
  → Pillow 画表格 → PNG bytes
  → 上传飞书 → 发送到配置的群聊
```

### 样式切换入口

"📸 发送排班截图"按钮旁加下拉选择：
- 时间轴截图（默认，现有 html2canvas 方案）
- 表格截图（新增，Pillow 方案）

两个样式共用同一条发送管线。

## 实现文件

- `routes/summary.py` — 新增 `/api/summary/table-screenshot` 端点
- `static/summary.js` — 前端下拉切换 + 请求逻辑
- `feishu/common.py` — 复用已有 `upload_image` + `send_image_message`

## 待定

- 自动发送（本期先做手动，后续再做定时自动）
