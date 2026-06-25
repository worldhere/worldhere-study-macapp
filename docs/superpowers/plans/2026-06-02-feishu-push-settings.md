# 飞书推送设置模块 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在设置→飞书同步子页面新增推送设置模块，支持配置群聊 ID 列表、总开关、测试发送

**Architecture:** Flask 后端新增 3 个路由（读/写配置 + 测试发送），前端新增一个 box 含 iOS toggle + textarea + 保存/测试按钮，数据存 config 表 category='feishu_push'。推送 box 受飞书同步开关控制：同步关→推送全部置灰。

**Tech Stack:** Flask + vanilla JS + SQLite config 表 + 飞书 IM API

---

### Task 1: 后端 — 飞书 IM 消息发送辅助函数

**Files:**
- Modify: `feishu/common.py`（末尾追加）

- [ ] **Step 1: 在 common.py 末尾追加 IM API 请求函数**

```python
# ========== IM 消息发送 ==========

IM_BASE_URL = "https://open.feishu.cn/open-apis/im/v1"


def send_im_message(chat_id, content):
    """向指定群聊发送文本消息。返回 (success: bool, error: str|None)"""
    url = f"{IM_BASE_URL}/messages?receive_id_type=chat_id"
    token = get_token()
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    body = {
        "receive_id": chat_id,
        "msg_type": "text",
        "content": '{"text":"' + content.replace('"', '\\"').replace('\n', '\\n') + '"}',
    }

    for attempt in range(3):
        try:
            resp = requests.post(url, headers=headers, json=body, timeout=15)
            if resp.status_code == 401:
                refresh_token()
                headers["Authorization"] = f"Bearer {get_token()}"
                continue
            if resp.status_code == 429:
                retry_after = int(resp.headers.get("Retry-After", "5"))
                time.sleep(retry_after)
                continue
            data = resp.json()
            if data.get("code") == 0:
                return True, None
            return False, data.get("msg", "unknown error")[:200]
        except (requests.Timeout, requests.ConnectionError):
            if attempt < 2:
                time.sleep(2 ** attempt)
                continue
            return False, "Network error after retries"

    return False, "Max retries exceeded"
```

- [ ] **Step 2: 验证导入路径**

```bash
python -c "from feishu.common import send_im_message; print('import ok')"
```

---

### Task 2: 后端 — 推送配置 API 路由

**Files:**
- Modify: `routes/feishu.py`（末尾追加）

- [ ] **Step 1: 在 routes/feishu.py 末尾追加 3 个路由**

```python
# ========== 推送设置 ==========

@bp.route('/api/feishu/push-config', methods=['GET'])
def api_feishu_push_config():
    """读取推送配置"""
    conn = get_db()
    row_enabled = conn.execute(
        "SELECT value FROM config WHERE category='feishu_push' AND key='enabled'"
    ).fetchone()
    row_chat_ids = conn.execute(
        "SELECT value FROM config WHERE category='feishu_push' AND key='chat_ids'"
    ).fetchone()
    conn.close()
    return jsonify({
        "enabled": row_enabled["value"] == "1" if row_enabled else False,
        "chat_ids": row_chat_ids["value"] if row_chat_ids else "",
    })


@bp.route('/api/feishu/push-config/save', methods=['POST'])
def api_feishu_push_config_save():
    """保存推送配置"""
    d = request.get_json()
    enabled = "1" if d.get("enabled") else "0"
    chat_ids = d.get("chat_ids", "")

    conn = get_db()
    conn.execute(
        "INSERT INTO config(category, key, value, sort_order) VALUES ('feishu_push', 'enabled', ?, 0)"
        " ON CONFLICT(category, key) DO UPDATE SET value=excluded.value",
        (enabled,),
    )
    conn.execute(
        "INSERT INTO config(category, key, value, sort_order) VALUES ('feishu_push', 'chat_ids', ?, 0)"
        " ON CONFLICT(category, key) DO UPDATE SET value=excluded.value",
        (chat_ids,),
    )
    conn.commit()
    conn.close()
    return jsonify({"msg": "保存成功"})


@bp.route('/api/feishu/push-config/test', methods=['POST'])
def api_feishu_push_config_test():
    """发送测试消息到所有配置的群聊"""
    from feishu.common import send_im_message

    conn = get_db()
    row = conn.execute(
        "SELECT value FROM config WHERE category='feishu_push' AND key='chat_ids'"
    ).fetchone()
    conn.close()

    raw = row["value"].strip() if row else ""
    if not raw:
        return jsonify({"error": "未配置群聊 ID"}), 400

    chat_ids = [cid.strip() for cid in raw.replace('\r', '\n').split('\n') if cid.strip()]

    d = request.get_json()
    message = (d.get("message") or "").strip()
    if not message:
        return jsonify({"error": "消息内容不能为空"}), 400

    results = []
    for cid in chat_ids:
        success, err = send_im_message(cid, message)
        results.append({
            "chat_id": cid,
            "success": success,
            "error": err if not success else None,
        })

    return jsonify({"results": results})
```

- [ ] **Step 2: 验证路由注册成功**

```bash
python -c "from routes.feishu import bp; print([r.rule for r in bp.deferred_functions if hasattr(r,'rule')]); print('routes ok')"
```

---

### Task 3: 前端 — HTML 推送设置 box

**Files:**
- Modify: `templates/panels/settings.html`（在操作按钮区域之后、"自动推送间隔设置"之前插入）

- [ ] **Step 1: 在 settings.html 操作按钮 box（第 514 行 `</div>`）之后插入推送设置 box**

定位：找到 `<!-- 自动推送间隔设置 -->`（约第 517 行），在其**前面**插入以下 HTML：

```html
            <!-- 推送设置 -->
            <div class="box" id="feishu-push-box" style="opacity:0.5;pointer-events:none;">
                <div style="display:flex;align-items:center;justify-content:space-between;">
                    <div>
                        <h3 style="margin:0;">&#128232; 推送设置</h3>
                        <p class="settings-hint" style="margin-bottom:0;">配置排班通知推送到飞书群。飞书同步开启后方可编辑。</p>
                    </div>
                    <div class="ios-toggle" id="push-toggle" onclick="togglePush(!this.classList.contains('active'))" style="flex-shrink:0;margin-left:16px;">
                        <div class="ios-toggle-track">
                            <div class="ios-toggle-thumb"></div>
                        </div>
                    </div>
                </div>
                <span id="push-toggle-label" style="font-size:12px;color:#9ca3af;margin-top:4px;display:inline-block;">推送已关闭</span>
                <div id="push-config-area" style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border);opacity:0.5;pointer-events:none;">
                    <label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px;">群聊 ID 列表</label>
                    <p style="font-size:10px;color:var(--text-muted);margin:0 0 8px;">一行一个 chat_id，以 oc_ 开头</p>
                    <textarea id="push-chat-ids" placeholder="oc_1b5fe857a2c346a9cb67970fb9d79fed" style="width:100%;min-height:80px;padding:8px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;font-family:monospace;resize:vertical;box-sizing:border-box;"></textarea>
                    <div style="display:flex;gap:8px;margin-top:10px;">
                        <button class="btn" onclick="savePushConfig()" style="background:var(--primary);color:#fff;">&#128190; 保存</button>
                        <button class="btn" onclick="testPush()">&#129514; 测试发送</button>
                    </div>
                </div>
            </div>
```

---

### Task 4: 前端 — JS 推送逻辑

**Files:**
- Modify: `static/settings.js`（末尾追加）

- [ ] **Step 1: 在 settings.js 末尾追加推送相关函数**

```javascript
// ========== 推送设置 ==========

function loadPushConfig() {
    fetch('/api/feishu/push-config')
        .then(function(r) { return r.json(); })
        .then(function(cfg) {
            var toggle = document.getElementById('push-toggle');
            var label = document.getElementById('push-toggle-label');
            var area = document.getElementById('push-config-area');
            var textarea = document.getElementById('push-chat-ids');

            if (cfg.enabled) {
                if (toggle) toggle.classList.add('active');
                if (label) label.textContent = '推送已开启';
                if (area) { area.style.opacity = '1'; area.style.pointerEvents = 'auto'; }
            } else {
                if (toggle) toggle.classList.remove('active');
                if (label) label.textContent = '推送已关闭';
                if (area) { area.style.opacity = '0.5'; area.style.pointerEvents = 'none'; }
            }
            if (textarea) textarea.value = cfg.chat_ids || '';
        })
        .catch(function() {});
}

function togglePush(enabled) {
    var toggle = document.getElementById('push-toggle');
    var label = document.getElementById('push-toggle-label');
    var area = document.getElementById('push-config-area');

    if (enabled) {
        if (toggle) toggle.classList.add('active');
        if (label) label.textContent = '推送已开启';
        if (area) { area.style.opacity = '1'; area.style.pointerEvents = 'auto'; }
    } else {
        if (toggle) toggle.classList.remove('active');
        if (label) label.textContent = '推送已关闭';
        if (area) { area.style.opacity = '0.5'; area.style.pointerEvents = 'none'; }
    }
}

function savePushConfig() {
    var enabled = document.getElementById('push-toggle').classList.contains('active');
    var chatIds = document.getElementById('push-chat-ids').value;

    fetch('/api/feishu/push-config/save', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({enabled: enabled, chat_ids: chatIds}),
    }).then(function(r) { return r.json(); })
      .then(function(data) {
          if (data.msg) showToast(data.msg);
      })
      .catch(function() {
          showToast('保存失败，请检查网络');
      });
}

function testPush() {
    var chatIds = document.getElementById('push-chat-ids').value.trim();
    if (!chatIds) {
        showToast('请先配置群聊 ID');
        return;
    }

    var msg = prompt('请输入测试消息内容：', '🧪 推送测试消息');
    if (!msg || !msg.trim()) return;

    fetch('/api/feishu/push-config/test', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({message: msg.trim()}),
    }).then(function(r) { return r.json(); })
      .then(function(data) {
          if (data.error) { showToast(data.error); return; }
          var results = data.results || [];
          var ok = results.filter(function(r) { return r.success; }).length;
          var fail = results.length - ok;
          if (fail === 0) {
              showToast('测试发送成功（' + ok + ' 个群）');
          } else {
              showToast('发送完成：' + ok + ' 成功，' + fail + ' 失败');
          }
      })
      .catch(function() {
          showToast('发送失败，请检查网络');
      });
}
```

- [ ] **Step 2: 在 updateFeishuStatusUI 函数中增加推送 box 的状态联动**

找到 `updateFeishuStatusUI` 函数（settings.js 约第 1033 行），在函数体开头（`if (!statusArea) return;` 之后）追加：

```javascript
    // === 推送 box 联动 ===
    var pushBox = document.getElementById('feishu-push-box');
    if (pushBox) {
        if (status.enabled) {
            pushBox.style.opacity = '1';
            pushBox.style.pointerEvents = 'auto';
            loadPushConfig();
        } else {
            pushBox.style.opacity = '0.5';
            pushBox.style.pointerEvents = 'none';
        }
    }
```

- [ ] **Step 3: 清理 feishu 关闭时的推送状态**

找到 `toggleFeishuSync` 函数中关闭分支（约第 914-925 行），在 `if (statusArea) statusArea.style.display = 'none';` 之后追加：

```javascript
        // 推送 box 复位
        var pushToggle = document.getElementById('push-toggle');
        var pushLabel = document.getElementById('push-toggle-label');
        var pushArea = document.getElementById('push-config-area');
        if (pushToggle) pushToggle.classList.remove('active');
        if (pushLabel) pushLabel.textContent = '推送已关闭';
        if (pushArea) { pushArea.style.opacity = '0.5'; pushArea.style.pointerEvents = 'none'; }
```

- [ ] **Step 4: 在页面加载时加载推送配置**

找到 `updateFeishuStatusUI` 被首次调用的地方（在 `loadSettings` 或 FeishuSync.init 中），确保在 `status.enabled` 为 true 时调用 `loadPushConfig()`。上一步在 `updateFeishuStatusUI` 中已加入联动逻辑，此处无需额外修改。

---

### Task 5: 端到端验证

- [ ] **Step 1: 启动服务**

```bash
python app.py
```

- [ ] **Step 2: 验证后端 API**

```bash
# 测试读取配置
curl -s http://localhost:5000/api/feishu/push-config | python -m json.tool

# 测试保存配置
curl -s -X POST http://localhost:5000/api/feishu/push-config/save \
  -H "Content-Type: application/json" \
  -d '{"enabled":true,"chat_ids":"oc_1b5fe857a2c346a9cb67970fb9d79fed"}'

# 测试发送消息
curl -s -X POST http://localhost:5000/api/feishu/push-config/test \
  -H "Content-Type: application/json" \
  -d '{"message":"🧪 API 测试消息"}'
```

- [ ] **Step 3: 浏览器手动验证**

1. 打开页面，进入设置→飞书同步
2. 确认飞书同步关闭时推送 box 置灰
3. 打开飞书同步，确认推送 box 变为可编辑
4. 输入群聊 ID，点击保存
5. 点击测试发送，输入消息，确认群内收到消息
6. 关闭推送 toggle，确认 textarea 和按钮置灰
7. 关闭飞书同步，确认推送 box 全部置灰

- [ ] **Step 4: Commit**

```bash
git add feishu/common.py routes/feishu.py templates/panels/settings.html static/settings.js
git commit -m "feat: add push notification settings module under feishu sync

- Add send_im_message helper to feishu/common.py
- Add GET/POST /api/feishu/push-config and POST /api/feishu/push-config/test routes
- Add push settings box with toggle, textarea, save and test buttons
- Two-layer dependency: feishu sync must be ON for push to be editable

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
