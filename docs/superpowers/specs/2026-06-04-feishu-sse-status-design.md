# 飞书状态区 SSE 实时推送 — 设计文档

**日期**: 2026-06-04
**状态**: 已确认

---

## 1. 概述

飞书设置页面的状态区（初始化进度条 + 最近活动）目前依赖前端轮询（1s 快速轮询 / 5s 空闲轮询），存在延迟、竞态、代码复杂等问题。本 spec 将状态更新改为 SSE（Server-Sent Events）推送，前端删掉所有轮询逻辑，后端在操作状态变更时主动广播。

## 2. 状态区功能定义

状态区由上下两层组成：

### 2.1 状态区（上半部分）

| 状态 | 显示内容 |
|------|---------|
| **操作进行中** | 进度条（类型 + 阶段 + 百分比 + done/total） + 机器级事件日志（实时追加） |
| **空闲** | "⏸ 无进行中的操作" + 上次操作摘要（如 "上次推送: 30/30 成功"），事件日志保留定格 |

**进度支持三种操作：**

| 操作 | 阶段数 | 示例 |
|------|--------|------|
| init | 2（建表 → 推送） | `⟳ 初始化进行中... (1/2 建表) 48/60 (80%)` |
| push | 1 | `⟳ 推送进行中... 18/30 (60%)` |
| pull | 1 | `⟳ 拉取进行中... 5/10 (50%)` |

**操作来源：**
- 手动：用户点击按钮触发（初始化 / 推送 / 拉取）
- 自动：后台同步循环触发推送
- 同一时间只有一个操作（`_active_operation` 全局单例），自动和手动不会冲突
- SSE 对这两种来源一视同仁，都广播 `progress` / `done` 事件

### 2.2 最近活动（下半部分）

按操作聚合，每条一行。操作进行中时实时显示进度，完成后变为终态。

```
⏳ 推送中... 18/30 (60%)
✅ 15:20 初始化完成 60/60 台已映射
✅ 15:10 推送完成 30/30 成功
```

- 操作完成后追加一条，不超过 10 条
- 倒序排列（最新在前）
- 数据存内存（`_operation_history` 列表），服务重启丢弃

## 3. 架构：SSE 替代轮询

### 3.1 整体架构

```
浏览器                          Flask 后端
  │                                │
  │──── GET /api/feishu/stream ───→│  打开 SSE 长连接
  │                                │
  │←─── event: status ────────────│  完整状态快照（连接时发送一次）
  │←─── event: progress ──────────│  进度更新（_active_operation 变化时）
  │←─── event: log ───────────────│  机器事件（write_event 调用时）
  │←─── event: done ──────────────│  操作完成（active_operation 置空时）
  │←─── event: heartbeat ─────────│  30s 保活
```

### 3.2 事件定义

**`status`** — 连接时发送完整状态：
```json
{
  "enabled": true,
  "connected": true,
  "initialized": true,
  "initializing": false,
  "active_operation": null,
  "last_push_result": {"total": 30, "success": 30, "fail": 0},
  "operation_history": [
    {"type": "push", "time": "15:20:33", "status": "ok", "done": 30, "total": 30, "summary": "30/30 成功"}
  ]
}
```
注：KPI 行数据在此事件中一并返回，页面打开时一次性渲染。

**`progress`** — `_active_operation` 更新时广播：
```json
{
  "type": "init",
  "phase": 1,
  "phase_total": 2,
  "phase_label": "建表",
  "done": 48,
  "total": 60
}
```

**`log`** — `write_event()` 调用时广播：
```json
{
  "time": "15:32:15",
  "level": "info",
  "machine": "BR2-26",
  "msg": "创建表完成"
}
```

**`done`** — 操作完成时广播：
```json
{
  "type": "init",
  "status": "ok",
  "time": "15:32:20",
  "done": 60,
  "total": 60,
  "summary": "60/60 台已映射"
}
```

**`heartbeat`** — 每 30 秒发送空注释行 `: heartbeat`，保活并检测断连。

### 3.3 数据流

```
write_event(level, machine, msg)
  → 追加到 _event_buffer
  → broadcast('log', {time, level, machine, msg})

_active_operation 更新（done++ 或 phase 推进）
  → broadcast('progress', {...})

操作 finally: _active_operation = None
  → 追加到 _operation_history
  → broadcast('done', {type, status, time, summary})
```

## 4. 文件改动

| 文件 | 改动 |
|------|------|
| `feishu/status.py` | 新增 `_sse_clients`、`broadcast()`、`_operation_history`，`write_event` 中调广播 |
| `feishu/init_engine.py` | 进度更新点无需改动（已通过 `_active_operation` 全局变量，`write_event` 自动广播） |
| `feishu/sync_loop.py` | 自动推送的进度更新同 init_engine，无需额外改动 |
| `routes/feishu.py` | 新增 `GET /api/feishu/stream` SSE 路由 |
| `static/settings.js` | 删所有轮询代码，新增 `connectFeishuStream()`，拆分 `renderStatusArea` / `renderRecentActivity` |
| `templates/panels/settings.html` | 状态区 HTML 结构调整（拆分为 status-area + recent-activity 两个独立区块） |

## 5. HTML 结构调整

当前结构：
```html
<!-- 统一状态区 -->
<div id="fs-status-area">
    <div id="fs-status-content">...</div>
</div>
<!-- 最近活动 -->
<div id="fs-timeline-box">
    <div id="fs-timeline">...</div>
</div>
```

新结构（保持两层区分）：
```html
<!-- 状态区：进度条 + 机器事件日志 -->
<div id="fs-status-area">
    <div id="fs-status-header"></div>   <!-- 标题行：操作类型 + 阶段 + 百分比 -->
    <div id="fs-status-bar"></div>      <!-- 进度条 -->
    <div id="fs-status-log"></div>      <!-- 机器事件日志（滚动） -->
</div>

<!-- 最近活动：操作完成聚合 -->
<div id="fs-recent-activity">
    <div id="fs-recent-list"></div>
</div>
```

## 6. 前端 JS 结构

```javascript
// SSE 连接（页面打开飞书设置时建立，关闭时断开）
var _feishuEventSource = null;
var _machineEvents = [];        // 当前操作的机器事件（操作完成不清空，下次操作开始才重置）
var _operationHistory = [];     // 操作聚合记录（> 从 status 事件初始化）

function connectFeishuStream() {
    if (_feishuEventSource) return;
    _feishuEventSource = new EventSource('/api/feishu/stream');
    
    _feishuEventSource.addEventListener('status', function(e) {
        var s = JSON.parse(e.data);
        updateFeishuStatusUI(s);  // KPI行、toggle、机器列表等
        renderStatusArea(s);       // 状态区
        renderRecentActivity(s);   // 最近活动
    });
    
    _feishuEventSource.addEventListener('progress', function(e) {
        var p = JSON.parse(e.data);
        renderProgress(p);
    });
    
    _feishuEventSource.addEventListener('log', function(e) {
        var ev = JSON.parse(e.data);
        _machineEvents.push(ev);
        renderMachineLog(_machineEvents);
    });
    
    _feishuEventSource.addEventListener('done', function(e) {
        var d = JSON.parse(e.data);
        addOperationRecord(d);     // 追加到 _operationHistory
        renderStatusIdle(d);       // 切空闲状态（进度条消失，显示摘要，日志保留）
        renderRecentActivity();
    });
    
    _feishuEventSource.onerror = function() {
        // SSE 断连，30s 后自动重连（EventSource 默认行为）
    };
}
```

## 7. 删除的代码

从 `settings.js` 中彻底删除：

- `_feishuPollActive`、`_fastPollTimer`、`_fastPollSawOp`、`_feishuIdleTimer`
- `startFastPoll()`、`stopFastPoll()`、`startFeishuIdlePoll()`、`stopFeishuTimers()`
- `refreshFeishuStatus()` 中的 `_feishuPollActive` 判重逻辑
- `initFeishuSync()` / `pushFeishuNow()` / `pullFeishuNow()` 中 `startFastPoll()` 调用
- `updateFeishuStatusUI()` 中轮询启停逻辑（1088-1094 行）

保留 `refreshFeishuStatus()` 作为兜底（SSE 断连时手动刷新），但实现简化。

## 8. 不涉及

- KPI 仪表盘行（连接状态、同步健康、数据库完整性、映射覆盖、上次推送、倒计时）— 保持现有逻辑
- 机器同步状态列表（可折叠）
- 操作按钮行（初始化/推送/拉取/扫描/刷新/清理）
- 推送设置区域
- 后端业务逻辑（init_engine / sync_loop / push/pull 流程无需改动，只需 status.py 加广播层）
