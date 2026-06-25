# 飞书应用凭证可配置化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将硬编码的 APP_ID/APP_SECRET/APP_TOKEN 迁移为 SQLite config 表可配置项，并在设置面板提供 UI。

**Architecture:** 三个凭证存入 `config` 表（category='feishu'），`feishu_token.py` 和 `feishu/common.py` 从 config 动态读取（带缓存+回退默认值），新增 `/api/feishu/app-info` 端点支撑前端表单。

**Tech Stack:** Python Flask + SQLite + Vanilla JS

---

### Task 1: 重构 feishu_token.py — 从 config 表动态读取凭证

**Files:**
- Modify: `feishu_token.py`

- [ ] **Step 1: 替换硬编码为 config 表读取 + 缓存**

将 `feishu_token.py` 替换为以下内容：

```python
# -*- coding: utf-8 -*-
"""飞书 tenant_access_token 管理"""
import time
import requests

TOKEN_URL = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal"

_cache = {"token": None, "expires_at": 0}
_app_cache = {"app_id": None, "app_secret": None, "loaded": False}


def _load_app_credentials():
    """从 config 表加载 app_id / app_secret，带缓存。回退到旧硬编码值。"""
    if _app_cache["loaded"]:
        return _app_cache["app_id"], _app_cache["app_secret"]
    try:
        from db import get_db
        conn = get_db()
        row_id = conn.execute(
            "SELECT value FROM config WHERE category='feishu' AND key='app_id'"
        ).fetchone()
        row_secret = conn.execute(
            "SELECT value FROM config WHERE category='feishu' AND key='app_secret'"
        ).fetchone()
        conn.close()
        _app_cache["app_id"] = (row_id["value"].strip() if row_id and row_id["value"].strip()
                                else "cli_aa8ffc77eff89bdb")
        _app_cache["app_secret"] = (row_secret["value"].strip() if row_secret and row_secret["value"].strip()
                                    else "7yncJ4xy9XPXsT6g1PMXScK2WqjKlAd5")
    except Exception:
        _app_cache["app_id"] = "cli_aa8ffc77eff89bdb"
        _app_cache["app_secret"] = "7yncJ4xy9XPXsT6g1PMXScK2WqjKlAd5"
    _app_cache["loaded"] = True
    return _app_cache["app_id"], _app_cache["app_secret"]


def invalidate_app_cache():
    """凭证更新后清除缓存，下次 get_token 重新加载"""
    _app_cache["loaded"] = False
    _app_cache["app_id"] = None
    _app_cache["app_secret"] = None


def get_token():
    """获取有效 token，提前 5 分钟自动续期"""
    now = time.time()
    if _cache["token"] and now < _cache["expires_at"] - 300:
        return _cache["token"]

    app_id, app_secret = _load_app_credentials()

    try:
        resp = requests.post(
            TOKEN_URL,
            json={"app_id": app_id, "app_secret": app_secret},
            timeout=10,
        )
        data = resp.json()
        if data.get("code") == 0:
            _cache["token"] = data["tenant_access_token"]
            _cache["expires_at"] = now + data.get("expire", 7200)
            return _cache["token"]
    except Exception:
        pass

    return _cache["token"] if _cache["token"] else ""


def refresh_token():
    """强制刷新 token（401 时调用）"""
    _cache["expires_at"] = 0
    return get_token()
```

- [ ] **Step 2: 验证 — 启动 app 确认无 import 错误**

```bash
python -c "from feishu_token import get_token, invalidate_app_cache; print('import OK')"
```
Expected: `import OK`

- [ ] **Step 3: Commit**

```bash
git add feishu_token.py
git commit -m "refactor: feishu_token reads app_id/app_secret from config table with cache"

Co-Authored-By: Claude <noreply@anthropic.com>
```

---

### Task 2: 重构 feishu/common.py — APP_TOKEN 动态读取

**Files:**
- Modify: `feishu/common.py`

- [ ] **Step 1: 添加 `_get_app_token()` 和 `_get_base_url()` 函数**

在 `feishu/common.py` 的 imports 之后、常量定义区，用以下内容替换 `APP_TOKEN = "..."` 和 `BASE_URL = "..."`：

```python
BASE_URL = "https://open.feishu.cn/open-apis/bitable/v1"
BATCH_SIZE = 100
ROW_LIMIT = 200

# 白名单表（不被 init/cleanup 删除的持久化总表）
MACHINE_CONFIG_TABLE = "机器配置表"
GROUPS_TABLE = "机器分组表"
WHITELIST_TABLES = {MACHINE_CONFIG_TABLE, GROUPS_TABLE}

_app_token_cache = {"value": None, "loaded": False}


def _get_app_token():
    """从 config 表读取 app_token，带缓存。回退到旧硬编码值。"""
    if _app_token_cache["loaded"]:
        return _app_token_cache["value"]
    try:
        from db import get_db
        conn = get_db()
        row = conn.execute(
            "SELECT value FROM config WHERE category='feishu' AND key='app_token'"
        ).fetchone()
        conn.close()
        _app_token_cache["value"] = (
            row["value"].strip() if row and row["value"].strip()
            else "I7IzbOlscajHJZscWOtcYcs6nLf"
        )
    except Exception:
        _app_token_cache["value"] = "I7IzbOlscajHJZscWOtcYcs6nLf"
    _app_token_cache["loaded"] = True
    return _app_token_cache["value"]


def invalidate_app_token_cache():
    """凭证更新后清除缓存"""
    _app_token_cache["loaded"] = False
    _app_token_cache["value"] = None
```

- [ ] **Step 2: 替换 feishu/common.py 内部所有 `APP_TOKEN` 为 `_get_app_token()`**

`feishu/common.py` 内部有三处使用 `APP_TOKEN`（在批量操作函数中），将它们从 f-string 中的 `{APP_TOKEN}` 改为 `{_get_app_token()}`：

```python
# Line 95 (in _batch_create_records):
            f"/apps/{_get_app_token()}/tables/{table_id}/records/batch_create",

# Line 128 (in _batch_update_records):
            f"/apps/{_get_app_token()}/tables/{table_id}/records/batch_update",

# Line 159 (in _batch_delete_records):
            f"/apps/{_get_app_token()}/tables/{table_id}/records/batch_delete",
```

- [ ] **Step 3: 替换 feishu/ 包内其他文件中的 `APP_TOKEN` 为 `_get_app_token()`**

需要改动的文件和位置：

**`feishu/lifecycle.py`:**
```python
# Line 5: 改 import
from feishu.common import (
    _feishu_data, _feishu_raw, _feishu_request, _get_app_token,
)
# Line 23: _upsert_mapping 中 storage 字段
            (machine_id, machine_name, _get_app_token(), table_id),
# Lines 58, 63, 72, 85, 102, 106, 114, 122: 所有 f"/apps/{APP_TOKEN}/..." → f"/apps/{_get_app_token()}/..."
```

**`feishu/init_engine.py`:**
```python
# Line 6: 改 import
from feishu.common import (
    _feishu_data, _feishu_raw, _feishu_request, _get_app_token,
)
# Lines 80, 205, 212: 所有 f"/apps/{APP_TOKEN}/..." → f"/apps/{_get_app_token()}/..."
```

**`feishu/table_utils.py`:**
```python
# Line 8: 改 import
from feishu.common import (
    _feishu_data, _feishu_raw, _feishu_request, _get_app_token, WHITELIST_TABLES,
)
# Lines 91, 113, 133, 161, 171, 189, 212: 所有 f"/apps/{APP_TOKEN}/..." → f"/apps/{_get_app_token()}/..."
```

**`feishu/schedule_sync.py`:**
```python
# Line 10: 改 import
from feishu.common import (
    _feishu_data, _feishu_raw, _feishu_request,
    _batch_create_records, _batch_update_records, _batch_delete_records,
    _parse_feishu_text,
    _get_app_token, BATCH_SIZE,
)
# Lines 282, 554: 所有 f"/apps/{APP_TOKEN}/..." → f"/apps/{_get_app_token()}/..."
```

**`feishu/status.py`:**
```python
# Line 9: 改 import
from feishu.common import _get_app_token
# Line 177: "base_info": _get_app_token(),
# Line 187: f"/apps/{_get_app_token()}/tables"
# Line 285: "base_info": _get_app_token(),
```

**`feishu/groups.py`:**
```python
# Line 9: 改 import
from feishu.common import (
    _feishu_data, _feishu_request, _get_app_token, GROUPS_TABLE,
)
# Lines 23, 36, 55, 110: 所有 f"/apps/{APP_TOKEN}/..." → f"/apps/{_get_app_token()}/..."
```

**`feishu/sync_loop.py`:**
```python
# Line 9: 改 import — 如果文件内没用 APP_TOKEN 直接删除这行 import，否则改为 _get_app_token
from feishu.common import _get_app_token
```

**`feishu/config_table.py`:**
```python
# Line 9: 改 import
from feishu.common import (
    _feishu_data, _feishu_request, _get_app_token, MACHINE_CONFIG_TABLE,
)
# Lines 35, 48, 75, 105: 所有 f"/apps/{APP_TOKEN}/..." → f"/apps/{_get_app_token()}/..."
```

- [ ] **Step 4: 更新 `feishu/__init__.py` — 导出 `_get_app_token` 替代 `APP_TOKEN`**

```python
# __all__ 列表中：
# 在 common 段，将 "APP_TOKEN" 替换为 "_get_app_token"
# 同时添加 invalidate_app_token_cache

# 新增导出（在 common 段末尾）:
    "_get_app_token", "invalidate_app_token_cache",
```

- [ ] **Step 5: 更新 `feishu_sync.py` 兼容层**

```python
# feishu_sync.py 是 `from feishu import *` 的兼容层，无需改动
# 但需验证 `_get_app_token` 可通过 `from feishu_sync import _get_app_token` 访问
```

- [ ] **Step 6: 更新 `routes/feishu.py` 中直接引用 `APP_TOKEN` 的地方**

```python
# Line 8: 改 import（从 feishu_sync 导入，实际来自 feishu）
from feishu_sync import (
    ...,
    _get_app_token,
)
# Line 168: from feishu_sync import ... APP_TOKEN ...  → 删掉 APP_TOKEN
# Lines 180, 188: f"/apps/{APP_TOKEN}/..." → f"/apps/{_get_app_token()}/..."
```

- [ ] **Step 7: 验证 import 链无中断**

```bash
python -c "from feishu.common import _get_app_token; print('common OK')"
python -c "from feishu import _get_app_token; print('feishu OK')"
python -c "from feishu_sync import _get_app_token; print('feishu_sync OK')"
python -c "from routes.feishu import bp; print('routes OK')"
```
Expected: 全部输出 `OK`

- [ ] **Step 8: Commit**

```bash
git add feishu/common.py feishu/lifecycle.py feishu/init_engine.py feishu/table_utils.py
git add feishu/schedule_sync.py feishu/status.py feishu/groups.py feishu/sync_loop.py
git add feishu/config_table.py feishu/__init__.py feishu_sync.py routes/feishu.py
git commit -m "refactor: replace APP_TOKEN constant with _get_app_token() reading from config table

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: 新增后端 API — GET/POST /api/feishu/app-info

**Files:**
- Modify: `routes/feishu.py`

- [ ] **Step 1: 在 `routes/feishu.py` 末尾添加两个端点**

在文件末尾（`# ===== 飞书应用凭证 =====` 节）添加：

```python
# ===== 飞书应用凭证 =====

@bp.route('/api/feishu/app-info', methods=['GET'])
def api_feishu_app_info_get():
    """读取飞书应用凭证（app_secret 脱敏返回）"""
    conn = get_db()
    row_id = conn.execute(
        "SELECT value FROM config WHERE category='feishu' AND key='app_id'"
    ).fetchone()
    row_secret = conn.execute(
        "SELECT value FROM config WHERE category='feishu' AND key='app_secret'"
    ).fetchone()
    row_token = conn.execute(
        "SELECT value FROM config WHERE category='feishu' AND key='app_token'"
    ).fetchone()
    conn.close()

    app_id = row_id["value"].strip() if row_id else ""
    app_secret = row_secret["value"].strip() if row_secret else ""
    app_token = row_token["value"].strip() if row_token else ""

    # 脱敏：只显示前4位和后4位
    masked_secret = ""
    if app_secret and len(app_secret) > 8:
        masked_secret = app_secret[:4] + "*" * (len(app_secret) - 8) + app_secret[-4:]
    elif app_secret:
        masked_secret = app_secret[:2] + "*" * max(0, len(app_secret) - 2)

    return jsonify({
        "app_id": app_id,
        "app_secret": masked_secret,
        "has_secret": bool(app_secret),
        "app_token": app_token,
    })


@bp.route('/api/feishu/app-info', methods=['POST'])
def api_feishu_app_info_save():
    """保存飞书应用凭证，可选验证"""
    d = request.get_json()
    app_id = (d.get("app_id") or "").strip()
    app_secret = (d.get("app_secret") or "").strip()
    app_token = (d.get("app_token") or "").strip()
    verify = d.get("verify", False)

    if not app_id or not app_secret or not app_token:
        return jsonify({"error": "App ID、App Secret、App Token 均不能为空"}), 400

    conn = get_db()
    # Upsert 三条记录
    for key, val in [("app_id", app_id), ("app_secret", app_secret), ("app_token", app_token)]:
        conn.execute(
            "INSERT INTO config(category, key, value, sort_order) VALUES ('feishu', ?, ?, 0)"
            " ON CONFLICT(category, key) DO UPDATE SET value=excluded.value",
            (key, val),
        )
    conn.commit()
    conn.close()

    # 清除缓存，使下次 API 调用使用新凭证
    try:
        from feishu_token import invalidate_app_cache
        invalidate_app_cache()
    except Exception:
        pass
    try:
        from feishu.common import invalidate_app_token_cache
        invalidate_app_token_cache()
    except Exception:
        pass

    # 可选：验证凭证
    verify_result = None
    if verify:
        try:
            import requests as _requests
            resp = _requests.post(
                "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
                json={"app_id": app_id, "app_secret": app_secret},
                timeout=10,
            )
            data = resp.json()
            if data.get("code") == 0:
                verify_result = {"valid": True, "msg": "凭证有效"}
            else:
                verify_result = {"valid": False, "msg": data.get("msg", "未知错误")[:200]}
        except Exception as e:
            verify_result = {"valid": False, "msg": str(e)[:200]}

    return jsonify({
        "msg": "保存成功",
        "verify": verify_result,
    })
```

- [ ] **Step 2: 验证端点**

```bash
# 启动 app 后测试
curl http://127.0.0.1:5000/api/feishu/app-info
```
Expected: 返回 JSON，包含 `app_id`, `app_secret`（脱敏）, `app_token`

- [ ] **Step 3: Commit**

```bash
git add routes/feishu.py
git commit -m "feat: add GET/POST /api/feishu/app-info endpoints for credential management

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: 前端 — 设置面板 HTML（应用凭证 box）

**Files:**
- Modify: `templates/panels/settings.html`

- [ ] **Step 1: 在飞书同步子页面底部（推送设置之后）添加应用凭证 box**

在 `templates/panels/settings.html` 的飞书同步子页面 (`id="settings-sub-7"`) 中，`</div>` 闭合前（推送设置 box 之后）插入：

```html
            <!-- 应用凭证（放最下面） -->
            <div class="box" id="feishu-cred-box" style="border-left: 3px solid var(--primary);">
                <div style="display:flex;align-items:center;justify-content:space-between;">
                    <div>
                        <h3 style="margin:0;">🔑 应用凭证</h3>
                        <p class="settings-hint" style="margin-bottom:0;">
                            从飞书开放平台获取。更换 Base 后需重新执行初始化。
                        </p>
                    </div>
                    <div style="text-align:right;">
                        <span id="feishu-cred-status" style="font-size:12px;font-weight:500;color:var(--text-muted);">未验证</span>
                    </div>
                </div>
                <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border);">
                    <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
                        <span style="flex:0 0 90px;font-size:13px;font-weight:500;color:var(--text-secondary);text-align:right;">App ID</span>
                        <input id="feishu-app-id" type="text" placeholder="cli_ 开头的应用 ID" style="flex:1;padding:8px 12px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:monospace;">
                    </div>
                    <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
                        <span style="flex:0 0 90px;font-size:13px;font-weight:500;color:var(--text-secondary);text-align:right;">App Secret</span>
                        <input id="feishu-app-secret" type="password" placeholder="应用密钥" style="flex:1;padding:8px 12px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:monospace;">
                    </div>
                    <div style="display:flex;align-items:center;gap:12px;margin-bottom:0;">
                        <span style="flex:0 0 90px;font-size:13px;font-weight:500;color:var(--text-secondary);text-align:right;">App Token</span>
                        <input id="feishu-app-token" type="text" placeholder="多维表格 Base 的 app_token" style="flex:1;padding:8px 12px;border:1px solid var(--border);border-radius:6px;font-size:13px;font-family:monospace;">
                    </div>
                </div>
                <div style="display:flex;gap:8px;align-items:center;margin-top:12px;padding-top:12px;border-top:1px solid var(--border);">
                    <button class="btn btn-sm" onclick="saveFeishuCredentials(false)" style="background:var(--primary);color:#fff;border-color:var(--primary);">💾 保存</button>
                    <button class="btn btn-sm" onclick="saveFeishuCredentials(true)">🔄 保存并验证</button>
                    <span id="feishu-cred-msg" style="font-size:11px;color:var(--text-muted);"></span>
                </div>
            </div>
```

- [ ] **Step 2: Commit**

```bash
git add templates/panels/settings.html
git commit -m "feat: add app credentials box to feishu settings subpage

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: 前端 — settings.js 凭证逻辑

**Files:**
- Modify: `static/settings.js`

- [ ] **Step 1: 在 settings.js 末尾添加凭证管理函数**

```javascript
// ========== 飞书应用凭证 ==========

function loadFeishuCredentials() {
    fetch('/api/feishu/app-info')
        .then(function(r) { return r.json(); })
        .then(function(data) {
            var idEl = document.getElementById('feishu-app-id');
            var secretEl = document.getElementById('feishu-app-secret');
            var tokenEl = document.getElementById('feishu-app-token');
            if (idEl) idEl.value = data.app_id || '';
            // secret 脱敏返回，不填回密码框；有值时设 placeholder 提示
            if (secretEl) {
                if (data.has_secret) {
                    secretEl.placeholder = '已保存（' + (data.app_secret || '***') + '），留空不修改';
                } else {
                    secretEl.placeholder = '应用密钥';
                }
                secretEl.value = '';
            }
            if (tokenEl) tokenEl.value = data.app_token || '';
        })
        .catch(function() {
            // 静默失败，面板打开时会重试
        });
}

function saveFeishuCredentials(verify) {
    var idEl = document.getElementById('feishu-app-id');
    var secretEl = document.getElementById('feishu-app-secret');
    var tokenEl = document.getElementById('feishu-app-token');
    var msgEl = document.getElementById('feishu-cred-msg');
    var statusEl = document.getElementById('feishu-cred-status');

    var appId = (idEl ? idEl.value.trim() : '');
    var appSecret = (secretEl ? secretEl.value.trim() : '');
    var appToken = (tokenEl ? tokenEl.value.trim() : '');

    if (!appId) { showToast('请输入 App ID'); return; }
    if (!appToken) { showToast('请输入 App Token'); return; }

    // 如果 secret 为空且已有保存值，允许不修改 secret
    if (!appSecret && secretEl && secretEl.placeholder.indexOf('已保存') === 0) {
        // 不传 secret，后端保持原值
    } else if (!appSecret) {
        showToast('请输入 App Secret');
        return;
    }

    if (msgEl) msgEl.textContent = verify ? '正在验证...' : '正在保存...';
    if (statusEl) { statusEl.textContent = '验证中...'; statusEl.style.color = '#f59e0b'; }

    fetch('/api/feishu/app-info', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            app_id: appId,
            app_secret: appSecret,
            app_token: appToken,
            verify: !!verify
        })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
        if (data.error) {
            showToast(data.error);
            if (msgEl) msgEl.textContent = data.error;
            if (statusEl) { statusEl.textContent = '保存失败'; statusEl.style.color = '#dc2626'; }
            return;
        }
        if (data.verify) {
            if (data.verify.valid) {
                showToast('凭证有效，保存成功');
                if (statusEl) { statusEl.textContent = '✅ 凭证有效'; statusEl.style.color = '#059669'; }
                if (msgEl) msgEl.textContent = '验证通过，已保存';
            } else {
                showToast('凭证无效: ' + (data.verify.msg || '未知错误'));
                if (statusEl) { statusEl.textContent = '⚠ 凭证无效'; statusEl.style.color = '#d97706'; }
                if (msgEl) msgEl.textContent = '已保存但验证失败: ' + (data.verify.msg || '');
            }
        } else {
            showToast('凭证已保存');
            if (statusEl) { statusEl.textContent = '✅ 已保存（未验证）'; statusEl.style.color = '#059669'; }
            if (msgEl) msgEl.textContent = '保存成功';
        }
        // 清空 secret 输入框
        if (secretEl) {
            secretEl.value = '';
            secretEl.placeholder = '已保存（***），留空不修改';
        }
    })
    .catch(function(err) {
        showToast('保存失败: ' + err);
        if (msgEl) msgEl.textContent = '网络错误';
        if (statusEl) { statusEl.textContent = '❌ 网络错误'; statusEl.style.color = '#dc2626'; }
    });
}
```

- [ ] **Step 2: 在 `loadSettings()` 或飞书面板切换时调用 `loadFeishuCredentials()`**

在 `switchSettingsSub()` 函数中添加（约 line 14）：

```javascript
    if (i === 7) {
        loadFeishuCredentials();
    }
```

完整改动 — 在现有 `switchSettingsSub` 函数中：

```javascript
// 找到 switchSettingsSub 函数中 if (i === 6) 块，在后面添加：
    if (i === 7) {
        loadFeishuCredentials();
    }
```

- [ ] **Step 3: Commit**

```bash
git add static/settings.js
git commit -m "feat: add credential load/save/verify logic to settings.js

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: 集成验证 — 端到端测试

**Files:**
- Modify: `tests/smoke_test.py` (add credential test)

- [ ] **Step 1: 添加凭证 API 冒烟测试**

在 `tests/smoke_test.py` 中添加：

```python
def test_feishu_app_info_get(client):
    """GET /api/feishu/app-info 返回凭证信息（secret 脱敏）"""
    resp = client.get('/api/feishu/app-info')
    assert resp.status_code == 200
    data = resp.get_json()
    assert 'app_id' in data
    assert 'app_secret' in data
    assert 'app_token' in data
    assert 'has_secret' in data


def test_feishu_app_info_save_and_verify(client):
    """POST /api/feishu/app-info 保存并验证凭证"""
    resp = client.post('/api/feishu/app-info', json={
        "app_id": "cli_test",
        "app_secret": "test_secret",
        "app_token": "test_token",
        "verify": False,
    })
    assert resp.status_code == 200
    data = resp.get_json()
    assert data.get('msg') == '保存成功'

    # 验证读回
    resp2 = client.get('/api/feishu/app-info')
    data2 = resp2.get_json()
    assert data2['app_id'] == 'cli_test'
    assert data2['app_token'] == 'test_token'
    assert data2['has_secret'] is True


def test_feishu_app_info_empty_rejected(client):
    """空字段应返回 400"""
    resp = client.post('/api/feishu/app-info', json={
        "app_id": "",
        "app_secret": "",
        "app_token": "",
    })
    assert resp.status_code == 400
```

- [ ] **Step 2: 运行测试**

```bash
python -m pytest tests/smoke_test.py::test_feishu_app_info_get tests/smoke_test.py::test_feishu_app_info_save_and_verify tests/smoke_test.py::test_feishu_app_info_empty_rejected -v
```
Expected: 3 tests PASS

- [ ] **Step 3: 运行完整测试套件确认无回归**

```bash
python -m pytest tests/ -v --timeout=30
```
Expected: 全部通过（或之前就存在的失败不变）

- [ ] **Step 4: 启动 app 手动验证**

```bash
python app.py
# 浏览器打开 http://127.0.0.1:5000
# 进入 设置 → 飞书同步 → 滚动到底部 → 看到「应用凭证」box
# 填入测试数据 → 点击「保存」→ 看到 toast 提示
```

- [ ] **Step 5: Commit**

```bash
git add tests/smoke_test.py
git commit -m "test: add credential API smoke tests

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: 清理 — 移除旧硬编码的导出

**Files:**
- Modify: `feishu/__init__.py`

- [ ] **Step 1: 确认 `__all__` 中不再导出 `APP_TOKEN`，改为导出新函数**

```python
# 在 __all__ 的 common 段中：
# 删除 "APP_TOKEN"（如果还存在）
# 确保有 "_get_app_token"
```

- [ ] **Step 2: Commit**

```bash
git add feishu/__init__.py
git commit -m "chore: clean up APP_TOKEN from feishu __all__ exports

Co-Authored-By: Claude <noreply@anthropic.com>"
```
