# 飞书同步状态仪表盘 — 设计文档

## 现状

当前飞书同步状态栏位于设置面板，显示形式为单行管道分隔文本：
- 所有信息挤在一行，看不到关键指标
- 缺表只知道数量不知道是哪台
- 初始化过程黑盒，没有任何进度反馈
- 推送/拉取操作没有进度条
- 活动日志没有持久化，刷新丢失
- 按钮杂乱堆砌，没有视觉优先级

## 目标

将状态栏改造为仪表盘风格，提供清晰、实时、可操作的状态反馈。

## 设计概览

- **位置**：设置面板，同步开关下方（不变）
- **风格**：仪表盘（KPI 卡片 + 进度条 + 时间线 + 可折叠机器列表）
- **后端**：内存事件缓冲区 + 增强 `/api/feishu/status` 返回
- **前端**：仪表盘 UI + 自适应轮询（操作中 1s / 闲置 30s）

## 数据流

```
操作函数 (init/push/pull)
    │
    ├─ 每处理一台机器 → write_event(level, machine, msg, percent)
    │                    写入 _event_buffer (线程安全, FIFO, 最近100条)
    │
    └─ 操作结束 → 更新 _active_operation = null

前端轮询 /api/feishu/status
    │
    ├─ 响应含 events[] + active_operation{type, percent, total, done}
    │
    ├─ 有 active_operation → 1s 轮询, 渲染进度条
    └─ 无 active_operation → 30s 轮询, 显示安静模式
```

## 后端改造

### 事件缓冲区

```python
# feishu_sync.py 新增

_event_buffer = []           # [{time, level, machine, msg, percent}]
_event_lock = threading.Lock()
MAX_EVENTS = 100  # 内存缓冲区，服务重启后清空（预期行为）
_active_operation = None     # None | {"type":"init|push|pull", "total":N, "done":M}
```

### write_event()

```python
def write_event(level, machine, msg, percent=None):
    """操作过程中写入事件。level: info|warn|error"""
    with _event_lock:
        _event_buffer.append({
            "time": datetime.now().strftime("%H:%M:%S"),
            "level": level,
            "machine": machine,
            "msg": msg,
            "percent": percent,
        })
        if len(_event_buffer) > MAX_EVENTS:
            _event_buffer.pop(0)
```

### 操作函数埋点

- **init_machine_tables()**：每处理完一台机器 → `write_event("info", machine_name, "完成", percent)`
- **push_machine_schedules()**：每推送完一台 → `write_event("info"|"error", machine_name, result_msg, percent)`  
- **pull_all_machines()**：每拉取完一台 → `write_event("info"|"error", machine_name, result_msg, percent)`

注意：日志粒度在机器级别，不展开到任务级别。

### get_sync_status() 增强

在现有返回中新增：

```python
{
    # ... 现有字段不变 ...
    "events": _event_buffer[-20:],          # 最近 20 条事件
    "active_operation": _active_operation,   # 当前进行中的操作信息
}
```

## 前端改造

### 仪表盘 UI 结构（替换现有 #feishu-status-area）

```
┌──────────────────────────────────────────────────┐
│  KPI 行 (4 张迷你卡片)                             │
│  [连接状态] [映射覆盖+进度条] [上次推送成功率] [倒计时] │
├──────────────────────────────────────────────────┤
│  进度条区域（有操作时出现）                           │
│  [操作名称 + 百分比 + 进度条 + 实时日志滚动区]         │
│  （无操作时：安静模式，一行灰色摘要）                   │
├──────────────────────────────────────────────────┤
│  最近活动时间线（最近 20 条，颜色编码）                │
│  🟢 成功  🔴 失败  🔵 拉取  🟡 初始化  ⚪ 普通        │
├──────────────────────────────────────────────────┤
│  机器同步状态（默认折叠，可展开）                      │
│  [机器名 | 状态标签 | 最后同步时间]                    │
│  展开后显示详情/错误原因                              │
├──────────────────────────────────────────────────┤
│  操作按钮                                          │
│  [初始化] [推送] [拉取]  |  [扫描] [刷新] [清理]     │
└──────────────────────────────────────────────────┘
```

### KPI 卡片数据映射

| 卡片 | 数据来源 | 正常态 | 异常态 |
|------|---------|--------|--------|
| 连接状态 | `connected` | 绿 ● 已连接 | 红 ● 连接失败 |
| 映射覆盖 | `mapped/total` | 显示分数 + 进度条 | 0 台时显示"未初始化" |
| 上次推送 | `last_push_result` | "4/5 成功" | "3 台失败" 红色 |
| 距下次同步 | `next_loop_in_sec` | 倒计时秒数 | 同步关闭时显示"已暂停" |

### 机器状态标签

判断逻辑依据 `get_sync_status()` 中 `integrity` 和事件缓冲区：

| 状态 | 颜色 | 条件 |
|------|------|------|
| 同步正常 | 绿 | 有映射 + 最近无 error 级别事件 |
| 缺表 | 黄 | 无映射记录（在 missing_tables 中） |
| 同步失败 | 红 | 有映射 + 事件缓冲区中存在该机器的 error 级别事件 |
| 未映射 | 灰 | 机器存在但从未初始化过（不在映射表也不在当前操作中） |

### 初始化进行中的特殊处理

当 `active_operation.type == "init"` 时：
- KPI 行照常显示（连接状态不受影响，映射覆盖反映实时进度）
- 进度条区域显示初始化进度（百分比 + 机器级别实时日志）
- 时间线只显示最近完成的操作（初始化的 "开始初始化" 事件在时间线底部）
- 机器列表中正在处理的机器显示 ⏳ 图标
- 其他操作按钮（推送/拉取）可置灰提示"初始化完成后可用"

### 按钮分组

- **主操作组**（彩色）：初始化、推送、拉取
- **辅助操作组**（默认色，竖线分隔）：扫描、刷新、清理

### 轮询策略

```javascript
// 伪代码
function poll() {
    fetch('/api/feishu/status').then(render);
    if (status.active_operation) {
        nextPoll = 1000;   // 有操作 → 1s
    } else {
        nextPoll = 30000;  // 闲置 → 30s
    }
    setTimeout(poll, nextPoll);
}
```

## 文件变更计划

| 文件 | 变更 |
|------|------|
| `feishu_sync.py` | 新增事件缓冲区、write_event()、操作函数埋点、get_sync_status() 增强 |
| `static/settings.js` | 重写 updateFeishuStatusUI()、新增自适应轮询逻辑 |
| `templates/panels/settings.html` | 替换 #feishu-status-area 为仪表盘 HTML 结构 |
| `static/style.css` (如存在) | 新增仪表盘相关样式 |

## 非目标

- 不改变同步开关的行为
- 不改变推送/拉取/初始化的核心逻辑
- 不改变按钮的实际功能
- 不增加新的 API 端点（复用 /api/feishu/status）
- 不引入 SSE/WebSocket
