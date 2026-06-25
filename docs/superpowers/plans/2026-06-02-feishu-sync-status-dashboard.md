# 飞书同步状态仪表盘 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将飞书同步状态栏从单行文本改造为仪表盘（KPI 卡片 + 进度条 + 时间线 + 可折叠机器列表），支持操作过程中实时显示百分比和日志。

**Architecture:** 后端新增内存事件缓冲区和 active_operation 追踪，操作函数执行时写入事件；前端新增自适应轮询（操作中 1s / 闲置 30s），从 `/api/feishu/status` 获取事件并渲染仪表盘。三个操作 API（init/push/pull）改为异步：启动后台线程后立即返回，前端通过轮询追踪进度。

**Tech Stack:** Python Flask (已有), vanilla JavaScript (已有), CSS (已有)

---

## 文件结构

| 文件 | 职责 | 操作 |
|------|------|------|
| `feishu_sync.py` | 事件缓冲区、write_event、操作函数埋点、get_sync_status 增强 | 修改 |
| `routes/feishu.py` | init/push/pull 端点改为异步（后台线程 + 立即返回） | 修改 |
| `templates/panels/settings.html` | 仪表盘 HTML 结构（替换 #feishu-status-area） | 修改 |
| `static/settings.js` | 仪表盘渲染、自适应轮询、异步操作处理 | 修改 |
| `static/components.css` | 仪表盘 CSS 样式 | 追加 |

---

### Task 1: 后端 — 事件缓冲区 + write_event + get_sync_status 增强

**Files:**
- Modify: `feishu_sync.py` (在 `_last_push_result` 之后新增全局变量，新增 write_event 函数，修改 get_sync_status)

- [ ] **Step 1: 在 _last_push_result 之后新增事件缓冲区全局变量**

在 `feishu_sync.py` 第 1465 行 (`_last_push_result = None`) 之后插入：

```python
# ========== 事件缓冲区 ==========
_event_buffer = []           # [{time, level, machine, msg, percent}]
_event_lock = threading.Lock()
MAX_EVENTS = 100             # 内存缓冲区，服务重启后清空（预期行为）
_active_operation = None     # None | {"type":"init|push|pull", "total":N, "done":M}
```

- [ ] **Step 2: 新增 write_event 函数**

在 `_last_push_result = None` 之后（事件缓冲区变量之后）插入：

```python
def write_event(level, machine, msg, percent=None):
    """操作过程中写入事件。level: info|warn|error。线程安全。"""
    with _event_lock:
        _event_buffer.append({
            "time": datetime.datetime.now().strftime("%H:%M:%S"),
            "level": level,
            "machine": machine,
            "msg": msg,
            "percent": percent,
        })
        if len(_event_buffer) > MAX_EVENTS:
            _event_buffer.pop(0)
```

- [ ] **Step 3: 增强 get_sync_status 返回值**

修改 `get_sync_status()` 的 return 语句（第 1409-1431 行之间），在返回的 dict 中新增 `events` 和 `active_operation` 字段。将现有 return 语句替换为：

```python
    # 采集最近事件
    with _event_lock:
        recent_events = list(_event_buffer[-20:])

    return {
        "enabled": enabled_val,
        "connected": connected,
        "initialized": len(mappings) > 0,
        "initializing": is_initializing(),
        "mapping_count": len(mappings),
        "total_machines": len(machines),
        "last_pull_at": mappings[0]["last_pull_at"] if mappings else None,
        "last_push_at": mappings[0]["last_push_at"] if mappings else None,
        "last_loop_at": _last_loop_at,
        "next_loop_in_sec": next_loop_in_sec,
        "sync_interval_sec": SYNC_INTERVAL_SEC,
        "last_push_result": _last_push_result,
        "base_info": APP_TOKEN,
        "events": recent_events,
        "active_operation": _active_operation,
        "integrity": {
            "total_machines": len(machines),
            "mapped_machines": len(mappings),
            "missing_tables": missing_tables,
            "missing_fields": {},
            "stale_mappings": stale_mappings,
            "validation_errors": [],
        },
    }
```

- [ ] **Step 4: 提交**

```bash
git add feishu_sync.py
git commit -m "feat: add event buffer, write_event, and enhance get_sync_status

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: 后端 — API 端点改为异步 + 操作函数埋点

**Files:**
- Modify: `routes/feishu.py` (init/push/pull 端点改为后台线程)
- Modify: `feishu_sync.py` (操作函数内添加 active_operation 管理和 write_event 埋点)

- [ ] **Step 1: 在 feishu_sync.py 新增异步包装函数**

在 `write_event()` 函数之后新增三个后台执行函数：

```python
def _async_init():
    """后台执行初始化，写入事件。"""
    global _active_operation
    try:
        conn = get_db()
        machines = conn.execute(
            "SELECT id, name FROM machines ORDER BY sort_order ASC"
        ).fetchall()
        conn.close()
        total = len(machines)
        _active_operation = {"type": "init", "total": total, "done": 0}
        write_event("info", "", "开始初始化 {} 台机器".format(total))
        # 调用实际初始化逻辑
        result = incremental_init()
        _active_operation = None
        write_event("info", "", "初始化完成: {}/{} 台已映射".format(
            result.get("mapped_machines", 0), result.get("total_machines", 0)))
    except Exception as e:
        _active_operation = None
        write_event("error", "", "初始化失败: {}".format(str(e)[:80]))


def _async_push():
    """后台执行全量推送，写入事件。"""
    global _active_operation
    try:
        conn = get_db()
        mappings = conn.execute(
            "SELECT machine_id, machine_name FROM feishu_sync_mapping"
        ).fetchall()
        conn.close()
        if not mappings:
            write_event("info", "", "无已映射机器，跳过推送")
            return
        total = len(mappings)
        _active_operation = {"type": "push", "total": total, "done": 0}
        write_event("info", "", "开始推送 {} 台机器".format(total))

        success = 0
        fail = 0
        for i, m in enumerate(mappings):
            try:
                r = push_machine_schedules(m["machine_id"])
                if r and "error" not in r:
                    success += 1
                    write_event("info", m["machine_name"], "推送完成", percent=round((i+1)/total*100))
                else:
                    fail += 1
                    err_msg = r.get("error", "未知错误") if isinstance(r, dict) else str(r)[:60]
                    write_event("error", m["machine_name"], err_msg, percent=round((i+1)/total*100))
            except Exception as e:
                fail += 1
                write_event("error", m["machine_name"], str(e)[:60], percent=round((i+1)/total*100))
            _active_operation["done"] = i + 1

        _last_push_result = {"total": total, "success": success, "fail": fail}
        _active_operation = None
        write_event("info", "", "推送完成: {}/{} 成功".format(success, total))
    except Exception as e:
        _active_operation = None
        write_event("error", "", "推送失败: {}".format(str(e)[:80]))


def _async_pull():
    """后台执行全量拉取，写入事件。"""
    global _active_operation
    try:
        conn = get_db()
        mappings = conn.execute(
            "SELECT machine_id, machine_name FROM feishu_sync_mapping"
        ).fetchall()
        conn.close()
        if not mappings:
            write_event("info", "", "无已映射机器，跳过拉取")
            return
        total = len(mappings)
        _active_operation = {"type": "pull", "total": total, "done": 0}
        write_event("info", "", "开始拉取 {} 台机器".format(total))

        result = pull_all_machines()
        # pull_all_machines 内部用 ThreadPoolExecutor，完成后汇总
        checked = result.get("machines_checked", 0)
        errors = result.get("errors", [])
        updated = result.get("records_updated", 0)
        _active_operation = None
        if errors:
            write_event("warn", "", "拉取完成: {} 台更新 {} 条, {} 个错误".format(checked, updated, len(errors)))
        else:
            write_event("info", "", "拉取完成: {} 台更新 {} 条".format(checked, updated))
    except Exception as e:
        _active_operation = None
        write_event("error", "", "拉取失败: {}".format(str(e)[:80]))
```

- [ ] **Step 2: 在 _incremental_init_impl 中埋 write_event**

修改 `_incremental_init_impl()` 函数（`feishu_sync.py`），在各关键步骤写入事件：
  - 在步骤 3 的 for 循环内，每处理完一台机器后加：
    ```python
    # 在 skipped_existing 分支:
    write_event("info", mname, "已存在，跳过")
    # 在 new_tables_created 分支:
    write_event("info", mname, "建表完成")
    ```
  - 在步骤 4 的 for 循环内，每推送完一台后加：
    ```python
    write_event("info", m["machine_name"], "推送完成")
    ```
  - 在 `_active_operation` 中更新 done 计数（需要从 _async_init 访问，改为在 _async_init 中不设 done，让 _incremental_init_impl 内部自己管理进度）

**重要调整：** 因为 `_incremental_init_impl` 被 `incremental_init` 调用，而 `incremental_init` 也被 toggle 端点调用。为了让事件正确写入，我们把 init 的进度管理放在 `incremental_init` 的外层包装中。修改 `incremental_init()`：

```python
def incremental_init():
    """增量初始化：只建缺失的表，不删已有的正常表。"""
    global _active_operation
    if not _init_lock.acquire(blocking=False):
        return {"error": "初始化正在进行中，请稍后再试"}

    try:
        # 设置 active_operation 用于前端轮询
        conn = get_db()
        machines = conn.execute(
            "SELECT id, name FROM machines ORDER BY sort_order ASC"
        ).fetchall()
        conn.close()
        _active_operation = {"type": "init", "total": len(machines), "done": 0}
        write_event("info", "", "开始初始化 {} 台机器".format(len(machines)))

        result = _incremental_init_impl()

        _active_operation = None
        mapped = result.get("mapped_machines", 0)
        total = result.get("total_machines", 0)
        write_event("info", "", "初始化完成: {}/{} 台已映射".format(mapped, total))
        return result
    finally:
        _init_cancel.clear()
        _active_operation = None
        _init_lock.release()
```

然后在 `_incremental_init_impl` 的关键位置（步骤 3、步骤 4 循环内）写入事件并更新 `_active_operation["done"]`。

在步骤 3 的 for 循环内，skipped_existing 分支和 new_tables_created 分支都加上：

```python
_active_operation["done"] = _active_operation["done"] + 1
```

在步骤 4 的 for 循环内，每推送完一台加上：

```python
_active_operation["done"] = _active_operation["done"] + 1
write_event("info", m["machine_name"], "推送完成")
```

- [ ] **Step 3: 修改 routes/feishu.py 的 init/push/pull 端点为异步**

修改 `routes/feishu.py`：

**初始化端点** — 将第 17-22 行替换为：

```python
@bp.route('/api/feishu/init', methods=['POST'])
def api_feishu_init():
    if is_initializing():
        return jsonify({"error": "初始化已在进行中，请等待完成"}), 409
    # 后台线程执行，立即返回
    t = threading.Thread(target=_async_init, daemon=True)
    t.start()
    return jsonify({"started": True, "msg": "初始化已启动"})
```

需要在文件顶部新增 import：
```python
import threading
from feishu_sync import (
    # ... 现有 import ...
    _async_init, _async_push, _async_pull,
)
```

**推送端点** — 将第 25-53 行替换为：

```python
@bp.route('/api/feishu/push', methods=['POST'])
def api_feishu_push():
    """推送全部已映射机器到飞书（异步）。"""
    if is_initializing():
        return jsonify({"error": "初始化进行中，请稍后再试"}), 409
    if _active_operation:
        return jsonify({"error": "已有操作在进行中，请稍后再试"}), 409
    t = threading.Thread(target=_async_push, daemon=True)
    t.start()
    return jsonify({"started": True, "msg": "推送已启动"})
```

**拉取端点** — 将第 56-61 行替换为：

```python
@bp.route('/api/feishu/pull', methods=['POST'])
def api_feishu_pull():
    """拉取全部已映射机器的飞书数据（异步）。"""
    if is_initializing():
        return jsonify({"error": "初始化进行中，请稍后再试"}), 409
    if _active_operation:
        return jsonify({"error": "已有操作在进行中，请稍后再试"}), 409
    t = threading.Thread(target=_async_pull, daemon=True)
    t.start()
    return jsonify({"started": True, "msg": "拉取已启动"})
```

需要在 `feishu_sync.py` 顶部暴露 `_active_operation` 给 routes 使用。在 `routes/feishu.py` 的 import 中补充：

```python
from feishu_sync import (
    # ... 现有 import ...
    _active_operation,
)
```

需要在 feishu_sync.py 中暴露 `_async_init`, `_async_push`, `_async_pull` 并在 routes/feishu.py 中导入。

- [ ] **Step 4: 提交**

```bash
git add feishu_sync.py routes/feishu.py
git commit -m "feat: make init/push/pull endpoints async with event tracking

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: 前端 HTML — 仪表盘结构

**Files:**
- Modify: `templates/panels/settings.html:437-450`

- [ ] **Step 1: 用仪表盘 HTML 替换旧的 #feishu-status-area**

将 `templates/panels/settings.html` 第 437-450 行的内容：

```html
            <!-- 状态指示器 -->
            <div id="feishu-status-area" style="display:none;">
                <div class="box">
                    <div id="feishu-status-indicator" style="font-size:13px;margin-bottom:4px;"></div>
                    <div id="feishu-status-detail" style="font-size:12px;color:var(--text-muted);margin-bottom:10px;"></div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        <button class="btn-sm" id="feishu-init-btn" style="display:none;" onclick="initFeishuSync()">初始化同步</button>
                        <button class="btn-sm" id="feishu-refresh-btn" onclick="refreshFeishuStatus()">刷新状态</button>
                        <button class="btn-sm" id="feishu-push-now-btn" onclick="pushFeishuNow()">立刻推送</button>
                        <button class="btn-sm" id="feishu-pull-now-btn" onclick="pullFeishuNow()">立即拉取</button>
                        <button class="btn-sm" onclick="scanFeishuTables()">扫描飞书表</button>
                        <button class="btn-sm" onclick="cleanupFeishuTables()" style="background:#991b1b;color:#fca5a5;border:1px solid #ef4444;" title="删除所有飞书表并清除映射（开发用）">一键清理飞书表</button>
                    </div>
                </div>
            </div>
```

替换为：

```html
            <!-- 飞书同步仪表盘 -->
            <div id="feishu-status-area" style="display:none;">

                <!-- KPI 行 -->
                <div class="box" style="padding:12px 16px;">
                    <div id="fs-kpi-row" style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;">
                        <div class="fs-kpi-card" id="fs-kpi-connection">
                            <div class="fs-kpi-label">连接状态</div>
                            <div class="fs-kpi-value" id="fs-kpi-conn-val">—</div>
                        </div>
                        <div class="fs-kpi-card" id="fs-kpi-coverage">
                            <div class="fs-kpi-label">映射覆盖</div>
                            <div class="fs-kpi-value" id="fs-kpi-cov-val">—</div>
                            <div class="fs-mini-bar"><div class="fs-mini-bar-fill" id="fs-kpi-cov-bar"></div></div>
                        </div>
                        <div class="fs-kpi-card" id="fs-kpi-push">
                            <div class="fs-kpi-label">上次推送</div>
                            <div class="fs-kpi-value" id="fs-kpi-push-val">—</div>
                        </div>
                        <div class="fs-kpi-card" id="fs-kpi-countdown">
                            <div class="fs-kpi-label">距下次同步</div>
                            <div class="fs-kpi-value" id="fs-kpi-cd-val">—</div>
                        </div>
                    </div>
                </div>

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

                <!-- 最近活动时间线 -->
                <div class="box" style="padding:10px 16px;">
                    <div style="font-weight:600;font-size:13px;margin-bottom:8px;">📋 最近活动</div>
                    <div id="fs-timeline" style="font-size:12px;"></div>
                </div>

                <!-- 机器同步状态（可折叠） -->
                <div class="box fs-collapsible" id="fs-machine-box">
                    <div class="fs-collapsible-header" onclick="toggleMachineList()" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;">
                        <span style="font-weight:600;font-size:13px;">🖥️ 机器同步状态 <span id="fs-machine-summary"></span></span>
                        <span id="fs-machine-arrow" style="font-size:10px;color:#9ca3af;">展开 ▼</span>
                    </div>
                    <div id="fs-machine-list" style="display:none;margin-top:8px;font-size:12px;"></div>
                </div>

                <!-- 操作按钮 -->
                <div class="box" style="padding:10px 16px;">
                    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
                        <button class="btn-sm fs-btn-primary" id="feishu-init-btn" style="display:none;" onclick="initFeishuSync()">⟳ 初始化</button>
                        <button class="btn-sm fs-btn-success" id="feishu-push-now-btn" onclick="pushFeishuNow()">⬆ 推送</button>
                        <button class="btn-sm fs-btn-warn" id="feishu-pull-now-btn" onclick="pullFeishuNow()">⬇ 拉取</button>
                        <span style="color:#cbd5e1;margin:0 4px;">|</span>
                        <button class="btn-sm" onclick="scanFeishuTables()">📋 扫描</button>
                        <button class="btn-sm" id="feishu-refresh-btn" onclick="refreshFeishuStatus()">🔄 刷新</button>
                        <button class="btn-sm" style="background:#991b1b;color:#fca5a5;border:1px solid #ef4444;" onclick="cleanupFeishuTables()">🗑 清理</button>
                    </div>
                </div>
            </div>
```

- [ ] **Step 2: 提交**

```bash
git add templates/panels/settings.html
git commit -m "feat: replace status bar with dashboard HTML structure

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: 前端 CSS — 仪表盘样式

**Files:**
- Modify: `static/components.css` (追加仪表盘样式)

- [ ] **Step 1: 在 components.css 末尾追加仪表盘 CSS**

在 `static/components.css` 末尾追加：

```css
/* ========== FEISHU SYNC DASHBOARD ========== */

/* KPI 卡片 */
.fs-kpi-card {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 8px 10px;
}
.fs-kpi-label {
    font-size: 10px;
    color: #64748b;
    margin-bottom: 2px;
}
.fs-kpi-value {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
}

/* KPI 小进度条 */
.fs-mini-bar {
    margin-top: 3px;
    background: #e5e7eb;
    border-radius: 2px;
    height: 3px;
    overflow: hidden;
}
.fs-mini-bar-fill {
    background: #2563eb;
    height: 3px;
    border-radius: 2px;
    width: 0%;
    transition: width 0.5s ease;
}

/* 进度条 */
.fs-progress-track {
    background: #dbeafe;
    border-radius: 3px;
    height: 6px;
    overflow: hidden;
}
.fs-progress-fill {
    background: linear-gradient(90deg, #2563eb, #3b82f6);
    height: 6px;
    border-radius: 3px;
    width: 0%;
    transition: width 0.3s ease;
}

/* 操作按钮颜色 */
.fs-btn-primary { background: #2563eb; color: #fff; border: 1px solid #1d4ed8; }
.fs-btn-primary:hover { background: #1d4ed8; }
.fs-btn-success { background: #16a34a; color: #fff; border: 1px solid #15803d; }
.fs-btn-success:hover { background: #15803d; }
.fs-btn-warn { background: #ca8a04; color: #fff; border: 1px solid #a16207; }
.fs-btn-warn:hover { background: #a16207; }

/* 时间线 */
.fs-timeline-item {
    position: relative;
    padding-left: 18px;
    padding-bottom: 6px;
    border-left: 2px solid transparent;
    font-size: 11px;
}
.fs-timeline-dot {
    position: absolute;
    left: -4px;
    top: 2px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
}
.fs-tl-info    { border-left-color: #22c55e; }
.fs-tl-error   { border-left-color: #dc2626; }
.fs-tl-warn    { border-left-color: #f59e0b; }
.fs-tl-default { border-left-color: #94a3b8; }
.fs-tl-dot-info    { background: #22c55e; }
.fs-tl-dot-error   { background: #dc2626; }
.fs-tl-dot-warn    { background: #f59e0b; }
.fs-tl-dot-default { background: #94a3b8; }
.fs-timeline-time { color: #9ca3af; margin-right: 6px; }

/* 机器状态标签 */
.fs-mstatus-ok    { background: #dcfce7; color: #16a34a; padding: 1px 7px; border-radius: 8px; font-size: 11px; }
.fs-mstatus-miss  { background: #fef3c7; color: #ca8a04; padding: 1px 7px; border-radius: 8px; font-size: 11px; }
.fs-mstatus-fail  { background: #fee2e2; color: #dc2626; padding: 1px 7px; border-radius: 8px; font-size: 11px; }
.fs-mstatus-none  { background: #f1f5f9; color: #94a3b8; padding: 1px 7px; border-radius: 8px; font-size: 11px; }

/* 机器行 */
.fs-machine-row {
    display: flex;
    align-items: center;
    padding: 6px 12px;
    border-bottom: 1px solid #f1f5f9;
    gap: 8px;
}
.fs-machine-row:last-child { border-bottom: none; }
.fs-machine-name { flex: 1; font-weight: 500; }
.fs-machine-time { color: #9ca3af; font-size: 11px; }

/* 可折叠区域 */
.fs-collapsible { padding: 8px 16px !important; }
.fs-collapsible-header { user-select: none; }
```

- [ ] **Step 2: 提交**

```bash
git add static/components.css
git commit -m "feat: add dashboard CSS styles for feishu sync status

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: 前端 JS — 仪表盘渲染 + 自适应轮询

**Files:**
- Modify: `static/settings.js` (重写 updateFeishuStatusUI、refreshFeishuStatus，修改 initFeishuSync/pushFeishuNow/pullFeishuNow 为异步处理)

- [ ] **Step 1: 重写 updateFeishuStatusUI**

将 `static/settings.js` 第 1027-1116 行的 `updateFeishuStatusUI` 函数替换为：

```javascript
function updateFeishuStatusUI(status) {
    var statusArea = document.getElementById('feishu-status-area');
    var iosToggle = document.getElementById('feishu-toggle');
    var iosLabel = document.getElementById('feishu-toggle-label');
    var initBtn = document.getElementById('feishu-init-btn');

    if (!statusArea) return;

    // === Toggle ===
    if (iosToggle) {
        if (status.enabled) { iosToggle.classList.add('active'); }
        else { iosToggle.classList.remove('active'); }
    }
    if (iosLabel) {
        iosLabel.textContent = status.enabled ? '飞书同步已开启' : '飞书同步已关闭';
    }
    statusArea.style.display = status.enabled ? 'block' : 'none';
    if (!status.enabled) { stopFeishuTimers(); return; }

    // === KPI 行 ===
    renderKpiRow(status);

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

    // === 初始化按钮 ===
    if (initBtn) {
        if (!status.initialized && !status.initializing) {
            initBtn.style.display = 'inline-block';
        } else {
            initBtn.style.display = 'none';
        }
    }

    // === 时间线 ===
    renderTimeline(status.events || []);

    // === 机器列表 ===
    renderMachineList(status);

    // === 轮询 ===
    if (op || status.initializing) {
        // 有操作中 → 1s 轮询
        startFastPoll();
    } else {
        // 闲置 → 30s 轮询
        stopFastPoll();
        if (!startFeishuCountdown()) { startFeishuFallbackPoller(); }
    }
}
```

- [ ] **Step 2: 新增辅助渲染函数**

在 `updateFeishuStatusUI` 之后新增以下函数：

```javascript
// ========== KPI 行渲染 ==========
function renderKpiRow(status) {
    // 连接状态
    var connEl = document.getElementById('fs-kpi-conn-val');
    if (connEl) {
        if (status.connected && status.initialized) {
            connEl.innerHTML = '<span style="color:#16a34a;">● 已连接</span>';
        } else if (!status.initialized) {
            connEl.innerHTML = '<span style="color:#f59e0b;">● 未初始化</span>';
        } else {
            connEl.innerHTML = '<span style="color:#ef4444;">● 连接失败</span>';
        }
    }

    // 映射覆盖
    var covEl = document.getElementById('fs-kpi-cov-val');
    var covBar = document.getElementById('fs-kpi-cov-bar');
    var total = status.total_machines || (status.integrity && status.integrity.total_machines) || 0;
    var mapped = status.mapping_count || (status.integrity && status.integrity.mapped_machines) || 0;
    if (covEl) {
        covEl.innerHTML = mapped + '/' + total + ' <span style="font-size:11px;color:#9ca3af;">台</span>';
    }
    if (covBar) {
        covBar.style.width = total > 0 ? Math.round(mapped / total * 100) + '%' : '0%';
    }

    // 上次推送
    var pushEl = document.getElementById('fs-kpi-push-val');
    if (pushEl) {
        var pr = status.last_push_result;
        if (pr && pr.total > 0) {
            var pct = Math.round(pr.success / pr.total * 100);
            var color = pr.fail > 0 ? '#ef4444' : '#16a34a';
            pushEl.innerHTML = '<span style="color:' + color + ';">' + pr.success + '/' + pr.total + '</span> 成功';
        } else {
            pushEl.textContent = '—';
        }
    }

    // 倒计时
    var cdEl = document.getElementById('fs-kpi-cd-val');
    if (cdEl) {
        if (status.next_loop_in_sec !== null && status.next_loop_in_sec !== undefined) {
            cdEl.innerHTML = '<span style="color:#2563eb;">' + status.next_loop_in_sec + 's</span>';
        } else {
            cdEl.textContent = '—';
        }
        // 存储数据给倒计时器
        cdEl.setAttribute('data-loop-at', status.last_loop_at || '');
        cdEl.setAttribute('data-interval', status.sync_interval_sec || 30);
    }
}

// ========== 进度条渲染 ==========
function renderProgress(op, events) {
    var label = document.getElementById('fs-progress-label');
    var pctEl = document.getElementById('fs-progress-pct');
    var bar = document.getElementById('fs-progress-bar');
    var log = document.getElementById('fs-progress-log');

    var typeNames = { init: '初始化', push: '推送', pull: '拉取' };
    var typeName = typeNames[op.type] || op.type;
    var pct = op.total > 0 ? Math.round(op.done / op.total * 100) : 0;

    if (label) label.textContent = '⟳ ' + typeName + '进行中...';
    if (pctEl) pctEl.textContent = op.done + '/' + op.total + ' (' + pct + '%)';
    if (bar) bar.style.width = pct + '%';

    // 实时日志（机器级别，最新在上）
    if (log) {
        var html = '';
        var machineEvents = events.filter(function(e) { return e.machine; });
        var recent = machineEvents.slice(-10).reverse();
        for (var i = 0; i < recent.length; i++) {
            var e = recent[i];
            var color = e.level === 'error' ? '#dc2626' : (e.level === 'warn' ? '#f59e0b' : '#64748b');
            html += '<div style="color:' + color + ';">' + e.time + '  ' + e.machine + ' → ' + e.msg + '</div>';
        }
        log.innerHTML = html || '<div style="color:var(--text-muted);">等待中...</div>';
    }
}

// ========== 时间线渲染 ==========
function renderTimeline(events) {
    var el = document.getElementById('fs-timeline');
    if (!el) return;

    // 过滤非机器级别事件 & 取最近 15 条
    var timelineEvents = [];
    for (var i = events.length - 1; i >= 0 && timelineEvents.length < 15; i--) {
        var e = events[i];
        if (!e.machine && e.msg) {
            timelineEvents.push(e);
        }
    }

    if (timelineEvents.length === 0) {
        el.innerHTML = '<div style="color:#9ca3af;font-size:11px;">暂无活动记录</div>';
        return;
    }

    var levelClass = { info: 'fs-tl-info', error: 'fs-tl-error', warn: 'fs-tl-warn' };
    var dotClass = { info: 'fs-tl-dot-info', error: 'fs-tl-dot-error', warn: 'fs-tl-dot-warn' };
    var html = '';
    for (var j = 0; j < timelineEvents.length; j++) {
        var ev = timelineEvents[j];
        var lc = levelClass[ev.level] || 'fs-tl-default';
        var dc = dotClass[ev.level] || 'fs-tl-dot-default';
        html += '<div class="fs-timeline-item ' + lc + '">';
        html += '<div class="fs-timeline-dot ' + dc + '"></div>';
        html += '<span class="fs-timeline-time">' + ev.time + '</span>';
        html += ev.msg;
        html += '</div>';
    }
    el.innerHTML = html;
}

// ========== 机器列表渲染 ==========
function renderMachineList(status) {
    var box = document.getElementById('fs-machine-box');
    var summary = document.getElementById('fs-machine-summary');
    var list = document.getElementById('fs-machine-list');
    if (!box || !summary || !list) return;

    var integrity = status.integrity || {};
    var total = integrity.total_machines || 0;
    var mapped = integrity.mapped_machines || 0;
    var missing = integrity.missing_tables || [];
    var missingIds = {};
    for (var i = 0; i < missing.length; i++) { missingIds[missing[i]] = true; }

    summary.textContent = '(' + mapped + '/' + total + ')';

    // 检查事件缓冲区中的错误机器
    var errorMachines = {};
    var events = status.events || [];
    for (var j = 0; j < events.length; j++) {
        if (events[j].level === 'error' && events[j].machine) {
            errorMachines[events[j].machine] = events[j].msg;
        }
    }

    // 构建机器行（仅在展开时渲染）
    if (list.style.display === 'none') {
        list.innerHTML = '';  // 折叠时清空，延迟渲染
        return;
    }

    // 从 integrity + 事件构建列表
    // 注意：后端目前只返回 missing_tables 名字，没有完整机器列表
    // 我们需要在后端 get_sync_status 中返回 per_machine 状态
    // 暂时用现有数据渲染
    var perMachine = status.per_machine || [];
    if (perMachine.length === 0) {
        list.innerHTML = '<div style="color:#9ca3af;font-size:11px;">加载中...</div>';
        return;
    }

    var html = '';
    for (var k = 0; k < perMachine.length; k++) {
        var m = perMachine[k];
        var statusClass, statusText;
        if (errorMachines[m.name]) {
            statusClass = 'fs-mstatus-fail';
            statusText = '同步失败';
        } else if (missingIds[m.name]) {
            statusClass = 'fs-mstatus-miss';
            statusText = '缺表';
        } else if (m.mapped) {
            statusClass = 'fs-mstatus-ok';
            statusText = '同步正常';
        } else {
            statusClass = 'fs-mstatus-none';
            statusText = '未映射';
        }
        html += '<div class="fs-machine-row">';
        html += '<span class="fs-machine-name">' + m.name + '</span>';
        html += '<span class="' + statusClass + '">' + statusText + '</span>';
        html += '<span class="fs-machine-time">' + (m.last_sync || '—') + '</span>';
        html += '</div>';
    }
    list.innerHTML = html;
}

// ========== 机器列表折叠 ==========
function toggleMachineList() {
    var list = document.getElementById('fs-machine-list');
    var arrow = document.getElementById('fs-machine-arrow');
    if (!list || !arrow) return;
    if (list.style.display === 'none') {
        list.style.display = 'block';
        arrow.textContent = '折叠 ▲';
        // 触发重新渲染
        refreshFeishuStatus();
    } else {
        list.style.display = 'none';
        arrow.textContent = '展开 ▼';
    }
}

// ========== 自适应轮询 ==========
var _fastPollTimer = null;

function startFastPoll() {
    if (_fastPollTimer) return;
    _feishuPollActive = true;
    _fastPollTimer = setInterval(function() {
        fetch('/api/feishu/status')
            .then(function(r) { return r.json(); })
            .then(function(s) {
                if (typeof updateFeishuStatusUI === 'function') updateFeishuStatusUI(s);
                // 如果没有 active_operation 了，停止快轮询
                if (!s.active_operation && !s.initializing) {
                    stopFastPoll();
                    refreshFeishuStatus();  // 切回慢轮询
                }
            })
            .catch(function() {});
    }, 1000);
}

function stopFastPoll() {
    if (_fastPollTimer) { clearInterval(_fastPollTimer); _fastPollTimer = null; }
    _feishuPollActive = false;
}
```

- [ ] **Step 3: 修改 refreshFeishuStatus 支持快轮询互斥**

修改 `refreshFeishuStatus` 函数（第 1193 行），避免与快轮询冲突：

```javascript
function refreshFeishuStatus() {
    if (_feishuPollActive) return;  // 快轮询中，跳过
    fetch('/api/feishu/status')
        .then(function(r){ return r.json(); })
        .then(function(s){
            if (typeof updateFeishuStatusUI === 'function') updateFeishuStatusUI(s);
        });
    loadExceptionOptions();
}
```

在 `stopFeishuTimers` 前声明 `var _feishuPollActive = false;`。

- [ ] **Step 4: 修改 initFeishuSync 为异步模式**

修改 `initFeishuSync` 函数（第 1176-1191 行）：

```javascript
function initFeishuSync() {
    var btn = document.getElementById('feishu-init-btn');
    if (btn) { btn.disabled = true; btn.textContent = '启动中...'; }
    // 停止现有定时器
    stopFeishuTimers();
    fetch('/api/feishu/init', {method:'POST'})
        .then(function(r){ return r.json(); })
        .then(function(data){
            if (data.started) {
                // 启动快轮询追踪进度
                startFastPoll();
                if (btn) { btn.style.display = 'none'; }
            } else if (data.error) {
                if (typeof showToast === 'function') showToast(data.error);
                if (btn) { btn.disabled = false; btn.textContent = '初始化同步'; }
            }
        })
        .catch(function(){
            if (btn) { btn.disabled = false; btn.textContent = '初始化同步'; }
        });
}
```

- [ ] **Step 5: 修改 pushFeishuNow 为异步模式**

修改 `pushFeishuNow` 函数（第 1282 行起）：

```javascript
function pushFeishuNow() {
    var btn = document.getElementById('feishu-push-now-btn');
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = '启动中...';
    stopFeishuTimers();
    fetch('/api/feishu/push', { method: 'POST' })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.started) {
                startFastPoll();
            } else if (data.error) {
                if (typeof showToast === 'function') showToast(data.error);
                btn.disabled = false;
                btn.textContent = '⬆ 推送';
            }
        })
        .catch(function() {
            btn.disabled = false;
            btn.textContent = '⬆ 推送';
        });
}
```

- [ ] **Step 6: 修改 pullFeishuNow 为异步模式**

修改 `pullFeishuNow` 函数（第 1313 行起）：

```javascript
function pullFeishuNow() {
    var btn = document.getElementById('feishu-pull-now-btn');
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = '启动中...';
    stopFeishuTimers();
    fetch('/api/feishu/pull', { method: 'POST' })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.started) {
                startFastPoll();
            } else if (data.error) {
                if (typeof showToast === 'function') showToast(data.error);
                btn.disabled = false;
                btn.textContent = '⬇ 拉取';
            }
        })
        .catch(function() {
            btn.disabled = false;
            btn.textContent = '⬇ 拉取';
        });
}
```

- [ ] **Step 7: 修改倒计时逻辑适配 KPI 卡片中的倒计时**

修改 `startFeishuCountdown` 函数（第 1121 行），将倒计时更新从旧的 `<span id="feishu-countdown">` 改为更新 KPI 卡片中的 `#fs-kpi-cd-val`：

```javascript
function startFeishuCountdown() {
    if (_feishuCountdownTimer) return true;
    var el = document.getElementById('fs-kpi-cd-val');
    if (!el || !el.hasAttribute('data-loop-at')) return false;
    _feishuCountdownTimer = setInterval(function() {
        var el2 = document.getElementById('fs-kpi-cd-val');
        if (!el2) { stopFeishuCountdown(); return; }
        var loopAt = parseFloat(el2.getAttribute('data-loop-at'));
        var interval = parseInt(el2.getAttribute('data-interval')) || 30;
        if (!loopAt) return;
        var elapsed = (Date.now() / 1000) - loopAt;
        var remaining = Math.max(0, Math.round(interval - elapsed));
        el2.innerHTML = '<span style="color:#2563eb;">' + remaining + 's</span>';
        if (remaining <= 0) {
            stopFeishuCountdown();
            refreshFeishuStatus();
        }
    }, 1000);
    return true;
}
```

- [ ] **Step 8: 在文件顶部声明 _feishuPollActive**

在 `static/settings.js` 中 `var _feishuCountdownTimer = null; var _feishuFallbackTimer = null;` 之后添加：

```javascript
var _feishuPollActive = false;
```

- [ ] **Step 9: 提交**

```bash
git add static/settings.js
git commit -m "feat: dashboard rendering, adaptive polling, async operation handlers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: 后端补充 — 将 per_machine 状态暴露给前端

**Files:**
- Modify: `feishu_sync.py:1359-1431` (get_sync_status 函数)

- [ ] **Step 1: 在 get_sync_status 中构建 per_machine 列表**

修改 `get_sync_status` 中的 integrity 块（第 1388-1430 行区域），在构建完 `missing_tables` 后新增 `per_machine` 列表：

```python
    # 构建每台机器的同步状态
    per_machine = []
    for mc in machines:
        mid = mc["id"]
        mname = mc["name"]
        mapping = mapped_ids.get(mid)
        info = {
            "name": mname,
            "mapped": mapping is not None,
            "last_sync": None,
        }
        if mapping:
            # 取 pull 和 push 中较近的时间
            pull_at = mapping.get("last_pull_at")
            push_at = mapping.get("last_push_at")
            if pull_at and push_at:
                info["last_sync"] = max(pull_at, push_at)
            else:
                info["last_sync"] = pull_at or push_at
        per_machine.append(info)

    # ... 然后在 return 的 integrity dict 中加上:
    "integrity": {
        # ... 现有字段 ...
        "per_machine": per_machine,
    }
```

- [ ] **Step 2: 提交**

```bash
git add feishu_sync.py
git commit -m "feat: expose per_machine sync status in get_sync_status

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: 端到端验证

- [ ] **Step 1: 启动应用并检查仪表盘渲染**

```bash
python app.py
```
打开浏览器 → 设置面板 → 确认仪表盘显示（KPI 卡片、时间线、折叠的机器列表、按钮分组）

- [ ] **Step 2: 测试初始化进度显示**

点击"初始化"按钮 → 确认进度条出现、百分比递增、实时日志滚动、操作完成后进度条消失切回安静模式

- [ ] **Step 3: 测试推送进度显示**

点击"推送"按钮 → 确认进度条出现、每台机器推送结果显示在日志中

- [ ] **Step 4: 测试拉取进度显示**

点击"拉取"按钮 → 确认进度条出现、拉取结果显示

- [ ] **Step 5: 测试机器列表折叠展开**

点击机器列表标题 → 确认展开显示机器状态、再次点击折叠

- [ ] **Step 6: 测试关闭同步后仪表盘隐藏**

关闭同步开关 → 确认仪表盘隐藏、定时器停止
