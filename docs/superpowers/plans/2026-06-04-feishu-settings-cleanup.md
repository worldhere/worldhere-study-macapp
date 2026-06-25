# 飞书设置页面优化 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 精简飞书同步设置子页面：删除 3 个冗余 box、合并进度条+安静条为统一状态区、解除推送设置对飞书同步的依赖

**Architecture:** 纯前端改动，两个文件：`templates/panels/settings.html`（删/改 DOM）、`static/settings.js`（重构状态渲染逻辑、删除推送联动代码）

**Tech Stack:** Vanilla JS + Jinja2 templates

---

### Task 1: 删除 3 个冗余 HTML box

**Files:**
- Modify: `templates/panels/settings.html`

- [ ] **Step 1: 删除"自动推送间隔" box**

定位第 570-580 行，删除整个 `<div class="box">` 及其内容：

```html
            <!-- 自动推送间隔设置 -->
            <div class="box">
                <h3>自动推送间隔</h3>
                <p class="settings-hint">设置后台自动将排班变更推送到飞书的间隔时间</p>
                <div style="display:flex;align-items:center;gap:8px;">
                    <input type="number" id="s-feishu-interval" value="30" disabled min="10" max="300" style="width:80px;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--bg-muted);color:var(--text-muted);text-align:center;">
                    <span style="font-size:13px;">秒</span>
                    <span style="font-size:10px;background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:10px;margin-left:8px;">暂不可用</span>
                </div>
                <p style="font-size:11px;color:var(--text-muted);margin:6px 0 0;">功能预留，当前使用默认间隔 30 秒</p>
            </div>
```

- [ ] **Step 2: 删除"立刻推送行为提示" box，改为推送按钮 tooltip**

定位第 507-508 行（推送/拉取按钮），为它们添加 `title` 属性，然后删除第 582-585 行的提示 box。

先改按钮：
```html
                        <button class="btn-sm fs-btn-success" id="feishu-push-now-btn" onclick="pushFeishuNow()" title="点击立刻推送：暂停自动推送 → 等待推送完成 → 重新开始计时">⬆ 推送</button>
                        <button class="btn-sm fs-btn-warn" id="feishu-pull-now-btn" onclick="pullFeishuNow()" title="点击立即拉取：暂停自动推送 → 等待拉取完成 → 重新开始计时">⬇ 拉取</button>
```

再删提示 box（第 582-585 行）：
```html
            <!-- 立刻推送行为提示 -->
            <div class="box" style="background:#eff6ff;border:1px solid #bfdbfe;">
                <p style="font-size:12px;color:#1e40af;margin:0;">&#128161; 点击<b>立刻推送</b>或<b>立即拉取</b>时：暂停自动推送 → 等待操作完成 → 重新开始计时</p>
            </div>
```

- [ ] **Step 3: 删除"扫描结果区域" box，扫描后改用 toast**

删除第 587-592 行：
```html
            <!-- 扫描结果区域 -->
            <div class="box" id="feishu-scan-result" style="display:none;">
                <h3 style="margin:0 0 4px;">扫描结果</h3>
                <div id="feishu-scan-summary" style="font-size:12px;color:var(--text-muted);margin-bottom:10px;"></div>
                <div id="feishu-scan-detail" style="max-height:400px;overflow-y:auto;"></div>
            </div>
```

- [ ] **Step 4: Commit**

```bash
git add templates/panels/settings.html
git commit -m "refactor: remove 3 redundant boxes from feishu settings

- Delete auto-push interval box (never implemented)
- Delete push behavior hint box (replaced by button tooltips)
- Delete scan results box (replaced by toast)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: 合并进度条 + 安静条为统一状态区（HTML）

**Files:**
- Modify: `templates/panels/settings.html`

- [ ] **Step 1: 将进度条和安静条替换为统一的 #fs-status-area**

定位第 466-481 行，删除 `fs-progress-box` 和 `fs-idle-bar` 两个独立 box，替换为一个统一容器：

删除：
```html
                <!-- 进度条区域 -->
                <div class="box" id="fs-progress-box" style="display:none;padding:10px 16px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                        <span id="fs-progress-label" style="font-weight:600;font-size:12px;color:#1e40af;"></span>
                        <span id="fs-progress-pct" style="font-size:11px;color:#3b82f6;font-family:monospace;"></span>
                    </div>
                    <div class="fs-progress-track"><div class="fs-progress-fill" id="fs-progress-bar"></div></div>
                    <div id="fs-progress-log" style="margin-top:4px;max-height:100px;overflow-y:auto;font-size:10px;color:#64748b;font-family:monospace;line-height:1.6;"></div>
                </div>

                <!-- 安静模式条 -->
                <div class="box" id="fs-idle-bar" style="padding:8px 16px;color:#9ca3af;font-size:12px;">
                    ⏸ 无进行中的操作
                    <span style="color:#cbd5e1;margin:0 8px;">|</span>
                    <span id="fs-idle-summary"></span>
                </div>
```

替换为：
```html
                <!-- 统一状态区（进度 / 空闲 / 异常） -->
                <div class="box" id="fs-status-area" style="padding:10px 16px;">
                    <div id="fs-status-content">
                        <span style="color:#9ca3af;font-size:12px;">⏸ 无进行中的操作</span>
                        <span style="color:#cbd5e1;margin:0 8px;">|</span>
                        <span id="fs-idle-summary"></span>
                    </div>
                </div>
```

- [ ] **Step 2: Commit**

```bash
git add templates/panels/settings.html
git commit -m "refactor: merge progress bar and idle bar into unified #fs-status-area

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: 解除推送设置对飞书同步的依赖（HTML + JS）

**Files:**
- Modify: `templates/panels/settings.html`
- Modify: `static/settings.js`

- [ ] **Step 1: HTML — 删除推送 box 的 inline 禁用样式，更新提示文字**

定位 `templates/panels/settings.html` 第 518 行，将：
```html
            <div class="box" id="feishu-push-box" style="opacity:0.5;pointer-events:none;">
```
改为：
```html
            <div class="box" id="feishu-push-box">
```

定位第 522 行，将提示文字：
```html
                        <p class="settings-hint" style="margin-bottom:0;">配置排班通知推送到飞书群。推送开关需飞书同步开启后生效。</p>
```
改为：
```html
                        <p class="settings-hint" style="margin-bottom:0;">配置排班通知推送到飞书群</p>
```

在 `</div>` (push-config-area 的关闭标签) 之后、`</div>` (feishu-push-box 的关闭标签) 之前，插入同步状态提示行：

定位到 `</div>` (第 567 行 `push-config-area` 结束) 之后，第 568 行 `</div>` (feishu-push-box 结束) 之前，插入：
```html
                <div id="push-sync-warning" style="display:none;margin-top:10px;font-size:11px;color:#f59e0b;">
                    ⚠ 飞书同步未开启，推送不会生效
                </div>
```

- [ ] **Step 2: JS — 删除 updateFeishuStatusUI 中的推送 box 禁用逻辑，改为显示/隐藏 warning**

定位 `static/settings.js` 第 1047-1062 行，将：
```javascript
    // === 推送 box 联动 ===
    var pushBox = document.getElementById('feishu-push-box');
    if (pushBox) {
        if (status.enabled) {
            pushBox.style.opacity = '1';
            pushBox.style.pointerEvents = 'auto';
            if (!_pushConfigLoaded) {
                loadPushConfig();
                _pushConfigLoaded = true;
            }
        } else {
            pushBox.style.opacity = '0.5';
            pushBox.style.pointerEvents = 'none';
            togglePush(false, true);  // 同步关闭时强制关推送，skipSave 避免覆盖用户保存的状态
        }
    }
```
改为：
```javascript
    // === 推送箱：始终可编辑，仅在同步关闭时显示提示 ===
    var pushWarning = document.getElementById('push-sync-warning');
    if (pushWarning) {
        pushWarning.style.display = status.enabled ? 'none' : 'block';
    }
    // 首次加载推送配置
    if (!_pushConfigLoaded) {
        loadPushConfig();
        _pushConfigLoaded = true;
    }
```

- [ ] **Step 3: Commit**

```bash
git add templates/panels/settings.html static/settings.js
git commit -m "refactor: remove push-settings dependency on feishu sync toggle

Push settings box is now always editable. When sync is off, a warning
line is shown instead of disabling the entire box.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: 重构 JS 状态渲染为统一函数

**Files:**
- Modify: `static/settings.js`

- [ ] **Step 1: 替换进度条/安静条渲染逻辑为统一函数 `renderStatusArea`**

定位 `updateFeishuStatusUI` 第 1078-1112 行，将进度条/安静条的互斥逻辑替换为一个统一渲染调用。

删除：
```javascript
    // === 进度条 / 安静模式 ===
    var op = status.active_operation;
    var progBox = document.getElementById('fs-progress-box');
    var idleBar = document.getElementById('fs-idle-bar');
    if (op) {
        // 有操作进行中
        if (progBox) progBox.style.display = 'block';
        if (idleBar) idleBar.style.display = 'none';
        renderProgress(op, status.events || []);
    } else if (status.initializing) {
        // initializing 但没有 active_operation（兼容 toggle 时的短暂状态）
        if (progBox) {
            progBox.style.display = 'block';
            document.getElementById('fs-progress-label').textContent = '⟳ 初始化进行中...';
            document.getElementById('fs-progress-pct').textContent = '';
            document.getElementById('fs-progress-bar').style.width = '0%';
            document.getElementById('fs-progress-log').innerHTML =
                '<div style="color:var(--text-muted);">请等待飞书表创建和数据推送完成...</div>';
        }
        if (idleBar) idleBar.style.display = 'none';
    } else {
        // 安静模式
        if (progBox) progBox.style.display = 'none';
        if (idleBar) {
            idleBar.style.display = 'block';
            var idleText = '';
            var pr = status.last_push_result;
            if (pr && pr.total > 0) {
                idleText = '上次推送: ' + pr.success + '/' + pr.total + ' 成功';
                if (pr.fail > 0) idleText += ' · ' + pr.fail + ' 失败';
            }
            var el = document.getElementById('fs-idle-summary');
            if (el) el.textContent = idleText;
        }
    }
```

替换为：
```javascript
    // === 统一状态区 ===
    renderStatusArea(status);
```

- [ ] **Step 2: 在 settings.js 中添加 renderStatusArea 函数**

在 `renderProgress` 函数之前（约第 1221 行之前）插入新的统一渲染函数：

```javascript
// ========== 统一状态区渲染 ==========
function renderStatusArea(status) {
    var container = document.getElementById('fs-status-content');
    if (!container) return;

    var op = status.active_operation;
    var pr = status.last_push_result;

    if (op || status.initializing) {
        // 有操作进行中（或初始化中）：显示进度条
        var typeNames = { init: '初始化', push: '推送', pull: '拉取' };
        var typeName = typeNames[op ? op.type : 'init'] || (op ? op.type : 'init');
        var pct = (op && op.total > 0) ? Math.round(op.done / op.total * 100) : 0;
        var phaseLabel = (op && op.phase_label) || typeName;
        var phaseStr = (op && op.phase_total > 1) ? '(' + op.phase + '/' + op.phase_total + ' ' + phaseLabel + ') ' : '';

        var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
            '<span style="font-weight:600;font-size:12px;color:#1e40af;">⟳ ' + typeName + '进行中... ' + phaseStr + '</span>';
        if (op) {
            html += '<span style="font-size:11px;color:#3b82f6;font-family:monospace;">' + op.done + '/' + op.total + ' (' + pct + '%)</span>';
        }
        html += '</div>' +
            '<div class="fs-progress-track"><div class="fs-progress-fill" style="width:' + (op ? pct : 0) + '%;"></div></div>';
        if (op) {
            html += '<div style="margin-top:4px;max-height:100px;overflow-y:auto;font-size:10px;color:#64748b;font-family:monospace;line-height:1.6;">';
            var events = status.events || [];
            var machineEvents = events.filter(function(e) { return e.machine; });
            var recent = machineEvents.slice(-10).reverse();
            for (var i = 0; i < recent.length; i++) {
                var e = recent[i];
                var color = e.level === 'error' ? '#dc2626' : (e.level === 'warn' ? '#f59e0b' : '#64748b');
                html += '<div style="color:' + color + ';">' + e.time + '  ' + e.machine + ' → ' + e.msg + '</div>';
            }
            if (recent.length === 0 && status.initializing) {
                html += '<div style="color:var(--text-muted);">请等待飞书表创建和数据推送完成...</div>';
            }
            html += '</div>';
        } else {
            html += '<div style="margin-top:4px;font-size:10px;color:var(--text-muted);">请等待飞书表创建和数据推送完成...</div>';
        }
        container.innerHTML = html;
    } else {
        // 空闲模式
        var idleText = '';
        if (pr && pr.total > 0) {
            idleText = '上次推送: ' + pr.success + '/' + pr.total + ' 成功';
            if (pr.fail > 0) idleText += ' · ' + pr.fail + ' 失败';
        }
        container.innerHTML = '<span style="color:#9ca3af;font-size:12px;">⏸ 无进行中的操作</span>' +
            '<span style="color:#cbd5e1;margin:0 8px;">|</span>' +
            '<span id="fs-idle-summary">' + idleText + '</span>';
    }
}
```

- [ ] **Step 3: 删除不再需要的 renderProgress 函数（已被 renderStatusArea 替代）**

删除 `static/settings.js` 中第 1221-1252 行的 `renderProgress` 函数（约 32 行），因为其逻辑已内联到 `renderStatusArea` 中。

- [ ] **Step 4: Commit**

```bash
git add static/settings.js
git commit -m "refactor: unify status area rendering into single renderStatusArea function

Replaces separate progress bar / idle bar with one container that switches
content based on active_operation state. Auto-sync progress now shows same
bar as manual operations.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: 扫描结果改用 toast 提示

**Files:**
- Modify: `static/settings.js`

- [ ] **Step 1: 简化 scanFeishuTables 函数，扫描结果用 toast 替代 box 渲染**

定位 `scanFeishuTables` 函数（第 1550-1618 行），将其简化为 toast 通知：

```javascript
// ========== 扫描飞书表 ==========
function scanFeishuTables() {
    showToast('扫描中...');

    fetch('/api/feishu/scan')
        .then(function(r) { return r.json(); })
        .then(function(data) {
            var s = data.summary;
            var summary = '线上 ' + s.online_total + ' 张表 | '
                + '已映射 ' + s.mapped_total + ' 台'
                + (s.orphan_total > 0 ? ' | ⚠ 孤立表 ' + s.orphan_total : '')
                + (s.missing_total > 0 ? ' | ⚠ 缺表机器 ' + s.missing_total : '')
                + (s.conflict_total > 0 ? ' | ⚠ 冲突表 ' + s.conflict_total : '');
            showToast(summary);
        })
        .catch(function() {
            showToast('扫描失败，请检查网络');
        });
}
```

**注意**：扫描按钮保留原样不变，用户仍可点击扫描，只是结果不再渲染到独立 box。

- [ ] **Step 2: 删除 fixMissingTables 函数（不再需要，因为它操作的是已删除的 scan-result box）**

删除 `fixMissingTables` 函数（第 1620-1635 行）。

- [ ] **Step 3: Commit**

```bash
git add static/settings.js
git commit -m "refactor: simplify scan result to toast notification

Scan button remains, but results now appear as a toast instead of a
dedicated box. Remove fixMissingTables since it relied on the deleted
scan results area.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: 验证

- [ ] **Step 1: 启动服务并检查页面**

```bash
python app.py
```

浏览器操作：
1. 进入设置 → 飞书同步子页面
2. 确认"自动推送间隔"box 已消失
3. 确认"立刻推送行为提示"box 已消失，推送/拉取按钮有 title 提示
4. 确认"扫描结果区域"box 已消失
5. 确认进度条/安静条合并为一个区域，打开/关闭同步时正常切换
6. 确认飞书同步关闭时推送设置 box 仍可编辑（群聊输入、事件开关）
7. 确认飞书同步关闭时推送 box 底部出现黄色警告文字
8. 确认事件开关点击后另一列不会错误翻转

- [ ] **Step 2: 检查控制台无 JS 错误**

打开浏览器 DevTools → Console，在以上操作中确认无 `Uncaught TypeError` 或其他报错。

- [ ] **Step 3: Commit final verification**

```bash
git add -A
git commit -m "chore: verify feishu settings cleanup

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
