# 便签留言输入区重设计

**日期**: 2026-05-27  
**状态**: 已确认  

## 问题

当前便签输入区为单行 flex 布局：`[标题 120px] [正文 flex:1] [署名 100px] [贴上去]`。正文框需要 auto-grow 以适应多行内容，但在同行布局下当正文增高时，标题框和署名框显得悬浮、不协调。

## 方案

垂直堆叠布局（方案 A），三行结构：

```
Row 1: [标题 input (flex:1) ........................... 清空 button]
Row 2: [正文 textarea (100%宽, auto-grow)]
Row 3: [署名 input (130px, 右对齐) .......... 贴上去 button]
```

### 布局要点

- 整体包裹在浅色卡片容器内（`background:#f8f9fa; border-radius:6px`）
- 标题和清空按钮同行，清空按钮始终在右侧
- 署名和贴上去按钮同行，整体右对齐
- 与下方便签展示区结构呼应（标题→正文→署名）

### Auto-grow 行为

- 初始高度：~40px（约 1 行）
- 最大高度：200px（约 8-10 行），超出后出滚动条
- 触发方式：`input` 事件监听，每次输入时调整 `textarea.style.height`
- 实现：设置 `height: auto` → 读 `scrollHeight` → 设为新高度

### 清空按钮

- 灰色次要按钮，位于标题行右侧
- 一键清空标题、正文、署名三个输入框

## 涉及文件

| 文件 | 改动 |
|------|------|
| `templates/panels/shifts.html` | 重写输入区 DOM 结构 |
| `static/shift-posts.js` | 添加 auto-grow 逻辑 + 清空按钮事件 |
| `static/components.css` | 输入区卡片样式 |

## 不影响

- 便签提交 API（`POST /api/shift_posts`）
- 便签展示区和渲染逻辑
- 便签删除功能
- 班次设置区域
