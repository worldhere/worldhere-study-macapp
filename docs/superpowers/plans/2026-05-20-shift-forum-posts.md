# 班次设置页面留言板（便签贴纸）实现方案

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在班次设置面板底部添加可折叠的便签留言板（每条便签不同大小/颜色），并在设置→班次设置子页面提供功能开关和保留天数配置。

**Architecture:** SQLite + Flask + 原生 JS。新增 `shift_posts` 表，新增 `/api/shift_posts` 蓝本。论坛开关和保留天数存储在 `config` 表的 `forum_settings` 分类中，复用现有 `/api/settings` 和 `/api/settings/batch` 端点。保留天数变更时前端弹二次确认，确认后触发服务端清理。GET 接口每次自动清理过期便签。

**Tech Stack:** Flask (Python) + SQLite3 + 原生 JavaScript + Jinja2 + 自定义 CSS

---

## 可行性分析

### 技术可行性：高

1. **数据持久化** — 现有 SQLite 已有 `shift_config` 等表，新增 `shift_posts` 零风险，DB 存档系统自动覆盖
2. **后端路由** — 参照现有蓝本模式，无需引入新依赖
3. **前端交互** — 复用 `fetch` → `toast` → `refresh` 模式和 `showConfirm` 确认弹窗
4. **折叠组件** — 代码库已有 4 处 `<details>/<summary>` 使用
5. **设置存储** — 使用现有 `config` 表 + `POST /api/settings/batch` + `GET /api/settings` 模式

### 需要注意的地方

1. **无用户认证** — 署名自由文本输入，UI 标注"署名（选填）"
2. **数据生命周期** — 便签随 DB 存档保存/恢复，存档回滚时便签也回滚
3. **便签尺寸差异化** — 用 `id % N` 确定颜色/尺寸/旋转，每次渲染一致
4. **保留天数变更需二次确认** — 因为调整天数会立即触发清理，不可逆
5. **设置子页面5** — 当前是占位符，本次替换为实际控件

---

## 文件结构

| 文件 | 职责 | 操作 |
|------|------|------|
| `db.py` | `shift_posts` 表 + 论坛默认设置初始化 | 修改 |
| `routes/shift_posts.py` | 留言 CRUD + 过期清理 | 新建 |
| `app.py` | 注册新蓝本 | 修改 |
| `templates/index.html` | 留言板 HTML + 设置子页面5控件 | 修改 |
| `static/style.css` | 便签样式 + 设置子页面5样式 | 修改 |
| `static/shift-posts.js` | 便签 CRUD + 设置绑定 + 二次确认 | 新建 |

---

### Task 1: 数据库 — shift_posts 表 + 论坛默认设置

**Files:**
- Modify: `db.py`

- [ ] **Step 1: 在 `init_db()` 中添加 `shift_posts` 建表语句**

在 `db.py` 的 `init_db()` 中，找到最后一个已有 `CREATE TABLE` 的 `conn.commit()` 之后，添加：

```python
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS shift_posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL DEFAULT '',
            author TEXT NOT NULL DEFAULT '',
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    conn.commit()
```

- [ ] **Step 2: 添加论坛默认设置种子数据**

在同一函数中，找到种子数据区（如 shift_config 种子数据附近），添加：

```python
    # 论坛默认设置（仅在首次运行时写入）
    cur.execute("SELECT COUNT(*) AS c FROM config WHERE category='forum_settings' AND key='forum_enabled'")
    if int(cur.fetchone()["c"]) == 0:
        cur.executemany(
            "INSERT INTO config(category,key,value,sort_order) VALUES (?,?,?,0)",
            [
                ("forum_settings", "forum_enabled", "1"),
                ("forum_settings", "forum_retention_days", "3"),
            ],
        )
        conn.commit()
```

- [ ] **Step 3: 验证建表**

```bash
python -c "from db import init_db; init_db(); from db import get_db; conn=get_db(); cur=conn.execute(\"SELECT name FROM sqlite_master WHERE type='table' AND name='shift_posts'\"); print('OK' if cur.fetchone() else 'FAIL')"
```

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add db.py
git commit -m "feat: add shift_posts table and forum_settings defaults"
```

---

### Task 2: 后端 — 留言 CRUD + 自动清理

**Files:**
- Create: `routes/shift_posts.py`
- Modify: `app.py`

- [ ] **Step 1: 创建 `routes/shift_posts.py`**

```python
from flask import Blueprint, request, jsonify
from db import get_db

bp = Blueprint('shift_posts', __name__)


def _get_forum_setting(conn, key):
    row = conn.execute(
        "SELECT value FROM config WHERE category='forum_settings' AND key=?",
        (key,),
    ).fetchone()
    return row["value"] if row else None


def _cleanup_old_posts(conn, retention_days):
    """删除超过保留天数的便签，返回删除数量"""
    cur = conn.execute(
        "DELETE FROM shift_posts WHERE created_at < datetime('now', ?)",
        ('-' + str(int(retention_days)) + ' days',),
    )
    return cur.rowcount


@bp.route('/api/shift_posts', methods=['GET'])
def list_posts():
    conn = get_db()
    enabled = _get_forum_setting(conn, 'forum_enabled')
    retention = _get_forum_setting(conn, 'forum_retention_days') or '3'
    _cleanup_old_posts(conn, retention)
    conn.commit()
    cur = conn.execute(
        "SELECT id, title, author, content, created_at FROM shift_posts ORDER BY created_at DESC LIMIT 100"
    )
    rows = cur.fetchall()
    conn.close()
    return jsonify({
        "enabled": enabled == '1',
        "retention_days": int(retention),
        "posts": [dict(r) for r in rows],
    })


@bp.route('/api/shift_posts', methods=['POST'])
def create_post():
    d = request.get_json()
    title = (d.get('title') or '').strip()
    author = (d.get('author') or '').strip() or '匿名'
    content = (d.get('content') or '').strip()
    if not content:
        return jsonify({"msg": "内容不能为空"}), 400
    conn = get_db()
    conn.execute(
        "INSERT INTO shift_posts (title, author, content) VALUES (?, ?, ?)",
        (title, author, content),
    )
    conn.commit()
    conn.close()
    return jsonify({"msg": "留言已发布"})


@bp.route('/api/shift_posts/<int:post_id>', methods=['DELETE'])
def delete_post(post_id):
    conn = get_db()
    conn.execute("DELETE FROM shift_posts WHERE id = ?", (post_id,))
    conn.commit()
    conn.close()
    return jsonify({"msg": "留言已删除"})


@bp.route('/api/shift_posts/cleanup', methods=['POST'])
def cleanup_posts():
    """手动触发清理过期便签，返回清理数量"""
    conn = get_db()
    retention = _get_forum_setting(conn, 'forum_retention_days') or '3'
    deleted = _cleanup_old_posts(conn, retention)
    conn.commit()
    conn.close()
    return jsonify({"deleted": deleted})
```

- [ ] **Step 2: 在 `app.py` 中注册新蓝本**

在 `app.py` 的 import 区添加：

```python
from routes.shift_posts import bp as shift_posts_bp
```

在现有 `app.register_blueprint(...)` 调用组之后添加：

```python
app.register_blueprint(shift_posts_bp)
```

- [ ] **Step 3: 手动测试端点**

```bash
curl -X POST http://127.0.0.1:5000/api/shift_posts -H "Content-Type: application/json" -d "{\"title\":\"交接提醒\",\"author\":\"小王\",\"content\":\"BR1-01 今晚需要换夹具\"}"
# Expected: {"msg": "留言已发布"}

curl http://127.0.0.1:5000/api/shift_posts
# Expected: {"enabled":true,"retention_days":3,"posts":[{"id":1,...}]}

curl -X POST http://127.0.0.1:5000/api/shift_posts/cleanup
# Expected: {"deleted": 0}（没有过期数据时）

curl -X DELETE http://127.0.0.1:5000/api/shift_posts/1
# Expected: {"msg": "留言已删除"}
```

- [ ] **Step 4: Commit**

```bash
git add routes/shift_posts.py app.py
git commit -m "feat: add shift posts CRUD API with auto-cleanup and forum settings"
```

---

### Task 3: 前端 HTML — 留言板 + 设置子页面5

**Files:**
- Modify: `templates/index.html`

- [ ] **Step 1: 在班次设置面板底部添加折叠留言板**

在 `templates/index.html` 第 101 行（夜班 box `</div>`）和第 102 行（panel `</div>`）之间插入：

```html
        <!-- 便签留言板 -->
        <details class="box" id="shift-forum" style="margin-top:12px;display:none;">
            <summary>留言板 · 便签</summary>
            <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center;">
                <input id="post-title" placeholder="标题（选填）" style="width:120px;" maxlength="30">
                <input id="post-content" placeholder="正文..." style="flex:1;min-width:200px;" maxlength="500">
                <input id="post-author" placeholder="署名（选填）" style="width:100px;" maxlength="20">
                <button class="btn" onclick="submitPost()">贴上去</button>
            </div>
            <div id="post-board"></div>
        </details>
```

注意：默认 `display:none`，由 JS 根据 `forum_enabled` 设置决定是否显示。

- [ ] **Step 2: 替换设置子页面5占位符**

在 `templates/index.html` 第 720-726 行，将占位符：

```html
        <!-- ===== 子页面5：班次设置 ===== -->
        <div class="settings-subpage" id="settings-sub-5">
            <div class="box" style="text-align:center;padding:60px 20px;color:var(--text-muted);">
                <p style="font-size:18px;">暂无设置</p>
                <p style="font-size:13px;">班次设置页面的可配置项将在后续版本中添加</p>
            </div>
        </div>
```

替换为：

```html
        <!-- ===== 子页面5：班次设置 ===== -->
        <div class="settings-subpage" id="settings-sub-5">
            <div class="box">
                <h3>留言板设置</h3>
                <p class="settings-hint">在班次设置页面底部显示便签留言板，用于跨班留言或备忘</p>
                <label><input type="checkbox" id="s-forum-enabled" checked onchange="applyForumEnabled(this.checked)"> 启用留言板</label>
            </div>
            <div class="box">
                <h3>便签保留天数</h3>
                <p class="settings-hint">超过该天数的便签将自动删除（默认3天，最多30天）</p>
                <div style="display:flex;align-items:center;gap:12px;">
                    <input id="s-forum-retention" type="range" min="1" max="30" step="1" value="3" onchange="onRetentionSliderChange(this.value)">
                    <span id="s-forum-retention-val">3</span> 天
                </div>
            </div>
        </div>
```

- [ ] **Step 3: 在 `</body>` 前引入新 JS 文件**

找到 `templates/index.html` 底部 `<script>` 标签区，添加：

```html
<script src="{{ url_for('static', filename='shift-posts.js') }}"></script>
```

- [ ] **Step 4: Commit**

```bash
git add templates/index.html
git commit -m "feat: add forum HTML and settings subpage 5 controls"
```

---

### Task 4: 前端 CSS — 便签样式 + 设置子页面5

**Files:**
- Modify: `static/style.css`

- [ ] **Step 1: 添加便签贴纸样式**

在 `static/style.css` 末尾添加：

```css
/* ===== 便签留言板 ===== */
#post-board {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    padding: 8px 4px;
    align-items: flex-start;
}

/* 便签贴纸 */
.sticky {
    position: relative;
    padding: 14px 16px 32px 16px;
    box-shadow: 2px 3px 8px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08);
    word-break: break-word;
    transition: transform 0.15s, box-shadow 0.15s;
}
.sticky:hover {
    transform: scale(1.03) rotate(0deg) !important;
    box-shadow: 3px 5px 14px rgba(0,0,0,0.18), 0 2px 4px rgba(0,0,0,0.10);
    z-index: 2;
}

/* 5 种便签颜色（由 post.id % 5 决定） */
.sticky-c0 { background: #fff9c4; }
.sticky-c1 { background: #f8bbd0; }
.sticky-c2 { background: #b3e5fc; }
.sticky-c3 { background: #dcedc8; }
.sticky-c4 { background: #ffe0b2; }

/* 3 种尺寸（由 post.id % 3 决定） */
.sticky-s0 { width: 200px; min-height: 120px; }
.sticky-s1 { width: 240px; min-height: 150px; }
.sticky-s2 { width: 180px; min-height: 100px; }

/* 3 种微旋转（由 post.id % 3 决定） */
.sticky-r0 { transform: rotate(-0.8deg); }
.sticky-r1 { transform: rotate(0.6deg); }
.sticky-r2 { transform: rotate(-0.3deg); }

/* 便签标题 */
.sticky-title {
    font-size: 14px;
    font-weight: 700;
    color: #333;
    margin-bottom: 6px;
    padding-bottom: 4px;
    border-bottom: 1px dashed rgba(0,0,0,0.15);
}

/* 便签正文 */
.sticky-body {
    font-size: 13px;
    color: #444;
    line-height: 1.55;
    white-space: pre-wrap;
}

/* 右下角署名 + 删除 */
.sticky-footer {
    position: absolute;
    bottom: 6px;
    right: 10px;
    left: 10px;
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: #888;
}
.sticky-author { font-style: italic; }
.sticky-time { color: #aaa; }
.sticky-del {
    font-size: 14px;
    color: #bbb;
    cursor: pointer;
    background: none;
    border: none;
    padding: 0 2px;
    line-height: 1;
    opacity: 0;
    transition: opacity 0.15s, color 0.15s;
}
.sticky:hover .sticky-del { opacity: 1; }
.sticky-del:hover { color: #e74c3c; }

/* 禁用状态（功能关闭时） */
#shift-forum.disabled-forum {
    opacity: 0.5;
    pointer-events: none;
}

/* 空状态 */
.post-board-empty {
    text-align: center;
    color: var(--text-muted);
    font-size: 13px;
    padding: 24px 0;
    width: 100%;
}
```

- [ ] **Step 2: Commit**

```bash
git add static/style.css
git commit -m "feat: add sticky-note board and forum-disabled styles"
```

---

### Task 5: 前端 JS — 便签 CRUD + 设置绑定 + 二次确认

**Files:**
- Create: `static/shift-posts.js`

- [ ] **Step 1: 创建 `static/shift-posts.js`**

```javascript
// ===== 便签渲染 =====
var _forumEnabled = true;
var _retentionDays = 3;
var _retentionPendingValue = null; // slider 拖动暂存值

function loadPosts() {
    var board = document.getElementById('post-board');
    var forum = document.getElementById('shift-forum');
    if (!board || !forum) return;
    fetch('/api/shift_posts')
        .then(function(r) { return r.json(); })
        .then(function(data) {
            _forumEnabled = data.enabled;
            _retentionDays = data.retention_days;
            forum.style.display = _forumEnabled ? '' : 'none';
            var posts = data.posts;
            if (!posts.length) {
                board.innerHTML = '<div class="post-board-empty">还没有便签，写一张贴上去吧</div>';
                return;
            }
            var html = '';
            for (var i = 0; i < posts.length; i++) {
                var p = posts[i];
                var color = p.id % 5;
                var size = p.id % 3;
                var rot = p.id % 3;
                var time = formatTime(p.created_at);
                html += '<div class="sticky sticky-c' + color + ' sticky-s' + size + ' sticky-r' + rot + '">';
                if (p.title) {
                    html += '<div class="sticky-title">' + escHtml(p.title) + '</div>';
                }
                html += '<div class="sticky-body">' + escHtml(p.content) + '</div>';
                html += '<div class="sticky-footer">' +
                    '<span class="sticky-time">' + escHtml(time) + '</span>' +
                    '<span class="sticky-author">— ' + escHtml(p.author) + '</span>' +
                    '<button class="sticky-del" onclick="deletePost(' + p.id + ')" title="撕掉">&times;</button>' +
                '</div></div>';
            }
            board.innerHTML = html;
        });
}

function formatTime(t) {
    if (!t) return '';
    return t.replace('T', ' ').substring(5, 16);
}

function submitPost() {
    var titleEl = document.getElementById('post-title');
    var contentEl = document.getElementById('post-content');
    var authorEl = document.getElementById('post-author');
    var content = contentEl.value.trim();
    if (!content) { showToast('请输入正文'); return; }
    fetch('/api/shift_posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            title: titleEl.value.trim(),
            author: authorEl.value.trim(),
            content: content
        })
    }).then(function(r) { return r.json(); }).then(function(d) {
        showToast(d.msg);
        titleEl.value = '';
        contentEl.value = '';
        loadPosts();
    });
}

function deletePost(id) {
    showConfirm('确定撕掉这张便签吗？', function() {
        fetch('/api/shift_posts/' + id, { method: 'DELETE' })
            .then(function(r) { return r.json(); })
            .then(function(d) {
                showToast(d.msg);
                loadPosts();
            });
    });
}

function escHtml(s) {
    var d = document.createElement('div');
    d.appendChild(document.createTextNode(s));
    return d.innerHTML;
}

// ===== 设置面板绑定 =====

function applyForumEnabled(enabled) {
    var val = enabled ? '1' : '0';
    fetch('/api/settings/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ category: 'forum_settings', key: 'forum_enabled', value: val }] }),
    });
    try { localStorage.setItem('forum_enabled', val); } catch(e) {}
    var forum = document.getElementById('shift-forum');
    if (forum) { forum.style.display = enabled ? '' : 'none'; }
    _forumEnabled = enabled;
}

function onRetentionSliderChange(val) {
    // 暂存新值，先弹确认
    _retentionPendingValue = val;
    var displayEl = document.getElementById('s-forum-retention-val');
    if (displayEl) { displayEl.textContent = val; }
    var oldVal = _retentionDays;
    var daysNum = parseInt(val, 10);
    if (isNaN(daysNum) || daysNum === oldVal) return;

    showConfirm(
        '将保留天数从 ' + oldVal + ' 天改为 ' + daysNum + ' 天，超过 ' + daysNum + ' 天的便签将立即被删除。确定继续吗？',
        function() {
            // 确认：保存设置并触发清理
            _retentionDays = daysNum;
            fetch('/api/settings/batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items: [{ category: 'forum_settings', key: 'forum_retention_days', value: String(daysNum) }] }),
            }).then(function() {
                try { localStorage.setItem('forum_retention_days', String(daysNum)); } catch(e) {}
                // 触发清理
                return fetch('/api/shift_posts/cleanup', { method: 'POST' });
            }).then(function(r) { return r.json(); }).then(function(d) {
                showToast('已清理 ' + (d.deleted || 0) + ' 条过期便签');
                loadPostsWaitingForSettings();
            });
        },
        function() {
            // 取消：回滚 slider 显示值
            var slider = document.getElementById('s-forum-retention');
            var displayEl2 = document.getElementById('s-forum-retention-val');
            if (slider) { slider.value = oldVal; }
            if (displayEl2) { displayEl2.textContent = oldVal; }
            _retentionPendingValue = null;
        }
    );
}

// 等待 settings.js 加载完成后回填控件值
function loadPostsWaitingForSettings() {
    if (typeof _settingsData === 'object' && _settingsData['forum_settings']) {
        loadPosts();
        return;
    }
    // settings 还没加载完，等 100ms 再试
    setTimeout(loadPostsWaitingForSettings, 100);
}

// 回填设置子页面5的控件值
function applyStoredForumSettings() {
    var fs = {};
    if (typeof _settingsData === 'object' && _settingsData['forum_settings']) {
        var arr = _settingsData['forum_settings'];
        for (var i = 0; i < arr.length; i++) {
            fs[arr[i].key] = arr[i].value;
        }
    }
    var enabled = fs['forum_enabled'] !== '0'; // 默认开启
    var retention = parseInt(fs['forum_retention_days'], 10) || 3;

    var enabledCheck = document.getElementById('s-forum-enabled');
    var retentionSlider = document.getElementById('s-forum-retention');
    var retentionVal = document.getElementById('s-forum-retention-val');

    if (enabledCheck) { enabledCheck.checked = enabled; }
    if (retentionSlider) { retentionSlider.value = retention; }
    if (retentionVal) { retentionVal.textContent = retention; }

    _forumEnabled = enabled;
    _retentionDays = retention;
}

// 页面加载：等 settings 数据到位后回填并拉便签
document.addEventListener('DOMContentLoaded', function() {
    // 延迟确保 settings.js 的 loadSettings() 先执行
    var attempts = 0;
    function tryInit() {
        attempts++;
        if (typeof _settingsData === 'object' && _settingsData['forum_settings']) {
            applyStoredForumSettings();
            loadPosts();
        } else if (attempts < 30) {
            setTimeout(tryInit, 200);
        } else {
            // fallback: 直接拉（服务端返回 enabled 状态）
            loadPosts();
        }
    }
    setTimeout(tryInit, 300);
});
```

**关键设计：**
- `onRetentionSliderChange` 暂存新值并弹 `showConfirm`，确认才提交；取消则回滚 slider
- `applyStoredForumSettings` 在 settings.js 加载完成后回填子页面5的控件
- `loadPosts` 返回的 JSON 包含 `enabled` 和 `retention_days`，前端据此控制可见性
- 轮询等待 `_settingsData` 就绪，最长等 6 秒后 fallback

- [ ] **Step 2: 验证前端功能**

启动应用，打开浏览器：
1. 班次设置面板：展开留言板，发布几条便签（含标题、无标题、不同署名）
2. 确认便签颜色/尺寸/旋转各异且刷新后一致
3. 设置 → 班次设置子页面：确认"启用留言板"开关和保留天数滑块
4. 关闭开关 → 切回班次设置面板，留言板消失
5. 打开开关 → 留言板恢复
6. 调整保留天数为1天 → 弹确认框 → 取消 → slider 回滚
7. 调整保留天数为1天 → 确认 → 提示清理数量

- [ ] **Step 3: Commit**

```bash
git add static/shift-posts.js
git commit -m "feat: add forum JS with settings binding and retention confirmation"
```

---

### Task 6: 端到端验证与收尾

- [ ] **Step 1: 完整流程回归测试**

手动验证：
1. 发布多条便签（有/无标题、空署名默认"匿名"）
2. 删除便签（确认弹窗 → 删除 → 刷新）
3. 折叠/展开留言板
4. 切换面板后切回，便签仍在
5. 空正文提交被拒绝
6. 长文本自动换行
7. 便签颜色/尺寸/旋转刷新后一致
8. 设置→班次设置：关闭留言板，确认主面板消失
9. 设置→班次设置：调整保留天数，取消确认后 slider 回滚
10. 设置→班次设置：调整保留天数，确认后提示清理数量
11. 不同浏览器标签页设置同步（localStorage + 服务端双写）

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "chore: finalize sticky-note forum with settings and retention"
```

---

## 自审清单

**1. Spec 覆盖：**
- ✅ 便签样式（不同大小贴纸） — Task 4 `.sticky-s0` ~ `.sticky-s2`
- ✅ 标题 — Task 1 `title` 字段, Task 3 标题输入框, Task 5 条件渲染
- ✅ 正文 — Task 1 `content` 字段
- ✅ 右下角署名 — Task 5 `.sticky-footer` + `.sticky-author`
- ✅ 折叠 — Task 3 `<details>` 元素
- ✅ 功能开关（设置子页面5） — Task 3 HTML + Task 5 `applyForumEnabled`
- ✅ 保留天数（设置子页面5，默认3天，最多30天） — Task 3 slider + Task 5 `onRetentionSliderChange`
- ✅ 保留天数变更二次确认 — Task 5 `showConfirm` 确认/取消逻辑
- ✅ 超过天数自动删除 — Task 2 `_cleanup_old_posts` + `GET /api/shift_posts` 自动调用
- ✅ 发布/查看/删除 — Task 2 + Task 5

**2. Placeholder 扫描：** 无 TBD/TODO。

**3. 类型一致性：**
- DB 字段 `id, title, author, content, created_at` — 前后端一致
- API 路径 `/api/shift_posts`, `/api/shift_posts/cleanup` — 前后端一致
- `GET /api/shift_posts` 返回 `{enabled, retention_days, posts}` — Task 5 `loadPosts` 解析一致
- 设置分类 `forum_settings` key `forum_enabled`, `forum_retention_days` — DB/Task3 HTML id/Task5 一致
- JS 函数 `loadPosts`, `submitPost`, `deletePost`, `applyForumEnabled`, `onRetentionSliderChange`, `applyStoredForumSettings` — HTML onclick/onchange 匹配
- CSS 类名 `.sticky`, `.sticky-c0~4`, `.sticky-s0~2`, `.sticky-r0~2`, `.sticky-title`, `.sticky-body`, `.sticky-footer`, `.sticky-author`, `.sticky-time`, `.sticky-del`, `.post-board-empty` — JS 生成与 CSS 定义一致
