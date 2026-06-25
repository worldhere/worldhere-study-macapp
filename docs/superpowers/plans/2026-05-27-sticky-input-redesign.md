# 便签留言输入区重设计 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将便签输入区从单行 flex 改为垂直堆叠布局，正文框支持 auto-grow，添加清空按钮

**Architecture:** 纯前端改动，不涉及后端 API。DOM 结构由水平三列改为垂直三行，CSS 更新 textarea 样式，JS 新增 auto-grow 监听和清空逻辑。

**Tech Stack:** HTML, CSS, vanilla JavaScript

---

### Task 1: 重写输入区 DOM 结构

**Files:**
- Modify: `templates/panels/shifts.html:28-32`

**Current (lines 28-32):**
```html
<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center;">
    <input id="post-title" placeholder="标题（选填）" style="width:120px;" maxlength="30">
    <textarea id="post-content" placeholder="正文...（支持换行和简单HTML：p br b i u strong em）" style="flex:1;min-width:200px;" rows="3" maxlength="2000"></textarea>
    <input id="post-author" placeholder="署名（选填）" style="width:100px;" maxlength="20">
    <button class="btn" onclick="submitPost()">贴上去</button>
</div>
```

- [ ] **Step 1: 替换为垂直堆叠结构**

Replace lines 28-32 with:

```html
<div class="post-input-card">
    <!-- Row 1: 标题 + 清空 -->
    <div class="post-input-row">
        <input id="post-title" placeholder="标题（选填）" maxlength="30">
        <button class="btn btn-clear" onclick="clearPostInput()" type="button">清空</button>
    </div>
    <!-- Row 2: 正文 -->
    <textarea id="post-content" placeholder="正文...（支持换行和简单HTML：p br b i u strong em）" rows="1" maxlength="2000"></textarea>
    <!-- Row 3: 署名 + 贴上去 -->
    <div class="post-input-row post-input-footer">
        <input id="post-author" placeholder="署名（选填）" maxlength="20">
        <button class="btn" onclick="submitPost()">贴上去</button>
    </div>
</div>
```

**Note:** 删除了所有 inline style，改用 CSS class 管理。

---

### Task 2: 更新 CSS 样式

**Files:**
- Modify: `static/components.css:365-375`（替换 `#post-content`）
- Modify: `static/components.css` — 在 `#post-content` 之后插入新样式

- [ ] **Step 1: 替换 #post-content 样式**

Replace:
```css
#post-content {
    resize: vertical;
    font-family: inherit;
    font-size: 13px;
    padding: 6px 8px;
    border: 1px solid var(--border-color, #ddd);
    border-radius: 4px;
    background: var(--input-bg, #fff);
    color: var(--text, #333);
}
```

With:
```css
#post-content {
    width: 100%;
    box-sizing: border-box;
    font-family: inherit;
    font-size: 13px;
    padding: 8px;
    border: 1px solid var(--border-color, #ddd);
    border-radius: 4px;
    background: var(--input-bg, #fff);
    color: var(--text, #333);
    resize: none;
    overflow-y: auto;
    line-height: 1.6;
    min-height: 40px;
    max-height: 200px;
}
```

- [ ] **Step 2: 在 `#post-board` 之前插入新 CSS**

Insert before `#post-board {`:

```css
.post-input-card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 12px;
    padding: 10px;
    background: #f8f9fa;
    border-radius: 6px;
    border: 1px solid var(--border-color, #e5e7eb);
}
.post-input-row {
    display: flex;
    gap: 8px;
    align-items: center;
}
.post-input-row #post-title {
    flex: 1;
    padding: 6px 8px;
    font-size: 13px;
    border: 1px solid var(--border-color, #ddd);
    border-radius: 4px;
    background: var(--input-bg, #fff);
    color: var(--text, #333);
}
.post-input-footer {
    justify-content: flex-end;
}
.post-input-footer #post-author {
    width: 130px;
    padding: 6px 8px;
    font-size: 13px;
    border: 1px solid var(--border-color, #ddd);
    border-radius: 4px;
    background: var(--input-bg, #fff);
    color: var(--text, #333);
}
.btn-clear {
    flex-shrink: 0;
    background: #fff;
    color: #909399;
    border: 1px solid #dcdfe6;
    padding: 6px 14px;
    font-size: 13px;
}
.btn-clear:hover {
    color: #606266;
    border-color: #c0c4cc;
}
```

---

### Task 3: 添加 auto-grow 和清空逻辑

**Files:**
- Modify: `static/shift-posts.js`

- [ ] **Step 1: 在文件开头（`loadPosts` 之前）添加 auto-grow 函数**

Insert after `var _retentionDays = 3;` and before `var SAFE_TAGS_RE = ...`:

```javascript
function autoGrowTextarea(el) {
    el.style.height = 'auto';
    var h = el.scrollHeight;
    if (h > 200) h = 200;
    el.style.height = h + 'px';
}
```

- [ ] **Step 2: 添加清空函数**

Insert after `autoGrowTextarea`:

```javascript
function clearPostInput() {
    document.getElementById('post-title').value = '';
    document.getElementById('post-content').value = '';
    document.getElementById('post-author').value = '';
    var ta = document.getElementById('post-content');
    ta.style.height = '';
}
```

- [ ] **Step 3: 在 `DOMContentLoaded` 监听中绑定 auto-grow 事件**

Update the existing `DOMContentLoaded` handler (lines 173-185) to also bind the textarea input event. Replace:

```javascript
document.addEventListener('DOMContentLoaded', function() {
    loadPosts();
    var attempts = 0;
    function trySyncSettings() {
        attempts++;
        if (typeof _settingsData === 'object' && _settingsData['forum_settings']) {
            applyStoredForumSettings();
        } else if (attempts < 30) {
            setTimeout(trySyncSettings, 200);
        }
    }
    setTimeout(trySyncSettings, 300);
});
```

With:

```javascript
document.addEventListener('DOMContentLoaded', function() {
    loadPosts();
    var ta = document.getElementById('post-content');
    if (ta) {
        ta.addEventListener('input', function () { autoGrowTextarea(ta); });
    }
    var attempts = 0;
    function trySyncSettings() {
        attempts++;
        if (typeof _settingsData === 'object' && _settingsData['forum_settings']) {
            applyStoredForumSettings();
        } else if (attempts < 30) {
            setTimeout(trySyncSettings, 200);
        }
    }
    setTimeout(trySyncSettings, 300);
});
```

- [ ] **Step 4: 更新 `submitPost` 函数中的清空逻辑**

In `submitPost()`, after clearing values, also reset the textarea height. Replace:

```javascript
titleEl.value = '';
contentEl.value = '';
authorEl.value = '';
```

With:

```javascript
titleEl.value = '';
contentEl.value = '';
contentEl.style.height = '';
authorEl.value = '';
```

---

### Task 4: 验证

- [ ] **Step 1: 启动服务并手动验证**

```bash
python app.py
```

打开浏览器，进入班次设置面板，展开留言板：

1. 输入区呈三行垂直堆叠
2. 在正文框输入多行内容，textarea 自动增高
3. 超过约 10 行后，textarea 出现滚动条不再增高
4. 点击清空按钮，标题、正文、署名全部清空
5. 填写标题+正文+署名后点贴上去，便签正常提交并展示
