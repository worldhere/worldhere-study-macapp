# Long-Running Stability Design

## 背景

系统运行场景：管理员开启程序后挂在后台，连续运行几天到十几天。期间基本不碰系统面板，主要操作在飞书表格上完成（双向同步）。仅在断电（休息日停机检修）或下次分配任务时才重启。当前系统在以下方面存在长期运行风险。

## 约束

- 单机后台运行，不做分布式
- 手动重启可接受（断电后由人手动启动）
- 尽量小改动，不大规模重构
- 双向同步已有冲突处理（`push_machine_schedules` 保留用户字段；toggle 时 `local`/`cloud` 模式选择）
- 跨天已有修复，本次聚焦防御未知边界问题

---

## 一、数据库加固

### 1.1 启用 WAL 模式

**现状**：SQLite 使用默认的 DELETE journal 模式。写操作锁整个库，并发读写冲突；断电或进程崩溃时有数据损坏风险。

**方案**：在 `init_db()` 中执行 `PRAGMA journal_mode=WAL;`

**效果**：
- 写操作不阻塞读，同步线程写 DB 时不影响前端页面读取
- WAL 文件提供崩溃恢复能力，断电后重启 SQLite 自动从 WAL 恢复
- 启动时用 `PRAGMA wal_checkpoint(TRUNCATE)` 合并 WAL 到主文件

**实现位置**：`db.py:init_db()`，连接后立即执行

### 1.2 启动时完整性检查

在 `init_db()` 末尾（建表/迁移之后）执行：
```sql
PRAGMA integrity_check;
```
- 通过则写日志
- 失败则返回错误信息，前端展示"数据库已损坏，建议从存档恢复"
- `get_sync_status()` 新增 `db_integrity_ok: bool` 字段

### 1.3 备份 WAL 文件处理

`routes/saves.py` 已处理存档时的 `-wal`/`-shm` 文件清理。启用 WAL 后 `sqlite3.backup()` 不受影响——backup API 自带 WAL 感知。

### 1.4 连接管理规范

**现状**：各处 `get_db()` 后手动 `conn.close()`，异常路径可能泄漏连接。

**方案**：新增 `get_db_context()` 上下文管理器，原有手动 close 调用逐步迁移：

```python
from contextlib import contextmanager

@contextmanager
def get_db_context():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()
```

优先级：只迁移 `feishu_sync.py` 和 `routes/` 中频繁调用路径。`db.py` 兼容旧接口。

---

## 二、运行时自动存档

**现状**：仅在 `app.py` 启动时做一次 autosave。运行几天后如果崩溃，所有增量数据丢失。

**方案**：后台定时存档线程，启动时读取配置决定间隔和保留策略。

### 2.1 配置项

| 配置 key | 默认值 | 说明 |
|----------|--------|------|
| `autosave_interval_minutes` | 120 | 自动存档间隔（分钟），最小 30 |
| `autosave_retention_count` | 20 | 运行时存档最多保留份数 |
| `autosave_enabled` | "1" | 是否启用运行时存档 |

配置项写入 `config` 表 `category='schedule_settings'`。在设置面板中可修改。

### 2.2 存档线程

```python
_autosave_stop_event = threading.Event()

def _autosave_loop():
    """后台定时自动存档，检查停止信号"""
    while not _autosave_stop_event.is_set():
        for _ in range(autosave_interval_seconds):
            if _autosave_stop_event.is_set():
                return
            time.sleep(1)
        try:
            save_dir = get_save_dir(DB_PATH)
            create_save(DB_PATH, save_dir, note="", is_autosave=True)
            rotate_autosaves(save_dir, db_path=DB_PATH)
        except Exception:
            pass
```

- 独立的 `_autosave_stop_event`，与同步线程 `_sync_stop_event` 分开管理
- 存档文件命名沿用 `autosave_YYYY-MM-DD_HH-MM.sqlite3`
- `rotate_autosaves` 在 config 驱动下清理超出保留份数的旧存档

---

## 三、同步线程自愈

### 3.1 Watchdog 机制

**现状**：`_sync_loop` 如果抛出未捕获异常，线程静默死亡。`get_sync_status` 无法区分"线程存活"和"线程已死"。

**方案**：在 `_sync_loop` 外层加 try/except + 重启逻辑。

```python
def _sync_loop():
    global _last_loop_at, _consecutive_failures, _thread_health
    _consecutive_failures = 0
    _thread_health = {"alive": True, "last_heartbeat": time.time(), "restart_count": 0}

    while not _sync_stop_event.is_set():
        try:
            _do_one_sync_cycle()
            _consecutive_failures = 0
        except Exception:
            _consecutive_failures += 1
            write_event("error", "", f"同步循环异常 (连续{_consecutive_failures}次)")

        _thread_health["last_heartbeat"] = time.time()

        if _consecutive_failures >= 10:
            write_event("error", "", "同步连续失败10次，5分钟后重试")
            _consecutive_failures = 0
            for _ in range(300):
                if _sync_stop_event.is_set(): return
                time.sleep(1)
            _thread_health["restart_count"] += 1
            continue

        for _ in range(SYNC_INTERVAL_SEC):
            if _sync_stop_event.is_set(): return
            time.sleep(1)
```

### 3.2 同步降级策略

当飞书 API 连续返回错误（非网络超时），自动降低同步频率：

| 连续失败次数 | 间隔 | 行为 |
|-------------|------|------|
| 0（正常） | 30s | 全量 pull → push → push_config |
| 1-2 | 30s | 同上，记录 warn 事件 |
| 3-5 | 2min | pull 改轻量（只查 has_more=false 第一页） |
| 6-9 | 5min | 只 pull，不 push |
| 10+ | 暂停 5min | 暂停后重置计数器，从 30s 重新开始 |

降级信息通过 `get_sync_status()` 暴露：
```python
{
    "sync_health": {
        "consecutive_failures": 3,
        "degraded_level": "reduced",  # "normal" | "reduced" | "minimal" | "paused"
        "thread_alive": True,
        "last_heartbeat": 1717334400.0,
        "restart_count": 0,
    }
}
```

### 3.3 同步健康前端展示

设置面板的 Dashboard KPI 行新增一个指标：
- 正常：绿色 "● 同步正常"
- 降频：黄色 "● 同步降频中"
- 暂停：红色 "● 同步已暂停"
- 线程死亡：红色 "● 同步线程异常"

恢复后自动变回绿色，不需要手动操作。

---

## 四、进程级加固

### 4.1 关闭 Flask debug 模式

**现状**：`app.py:52` `app.run(host='127.0.0.1', port=5000, debug=True)`

**问题**：
- debug=True 启用 Werkzeug reloader，监控文件变更，长期运行内存持续增长
- 保留所有请求 traceback 在内存中（`PROPAGATE_EXCEPTIONS`）
- 交互式调试器在生产中无意义

**方案**：改用生产 WSGI 服务器

推荐 `waitress`（纯 Python，Windows 兼容，无外部依赖）：

```python
# app.py
if __name__ == '__main__':
    from waitress import serve
    serve(app, host='127.0.0.1', port=5000)
```

依赖：`pip install waitress`（仅 Windows 需额外注意，waitress 支持 Windows）

如果不想加依赖，退一步方案：
```python
app.run(host='127.0.0.1', port=5000, debug=False, threaded=True)
```

### 4.2 定期 GC

长期 Python 进程可能因循环引用导致内存碎片化。在 `_sync_loop` 每次循环末尾：

```python
import gc
gc.collect()
```

频率：每 30s 一次（与同步循环同频），开销可忽略。

### 4.3 事件缓冲区上限

**现状**：`MAX_EVENTS = 100`，但每条事件的 `msg`/`machine` 字段无长度限制。

**方案**：写入时截断：
```python
def write_event(level, machine, msg, percent=None):
    with _event_lock:
        _event_buffer.append({
            "time": datetime.datetime.now().strftime("%H:%M:%S"),
            "level": level,
            "machine": (machine or "")[:50],
            "msg": (msg or "")[:200],
            "percent": percent,
        })
        if len(_event_buffer) > MAX_EVENTS:
            _event_buffer.pop(0)
```

---

## 五、跨天边界防护

### 5.1 日期计算防御

在所有涉及 `datetime.date.today()` 的地方统一使用项目级函数，方便审计：

```python
# utils.py 新增
def today() -> datetime.date:
    """统一获取当天日期，跨天相关逻辑统一入口"""
    return datetime.date.today()
```

然后将 `feishu_sync.py`、`routes/schedules.py`、`routes/schedule_ops.py` 中的 `datetime.date.today()` 调用替换为此函数。单点可加日志，方便排查跨天 bug。

### 5.2 午夜前后数据校验

在 `_sync_loop` 中检测是否刚跨过午夜（`last_loop_date != today`），跨天后触发一次全量状态重新计算和推送。这确保午夜前后排班状态变更（"采集中"→"过时待确认"等）被正确推送到飞书。

### 5.3 排班日期范围校验

`push_machine_schedules` 中：
```python
PUSH_DAYS_BEFORE = 3
PUSH_DAYS_AFTER = 7
```

在跨天时，如果系统时间出现大幅跳变（如休眠后唤醒），`today` 可能突然变化，导致推送窗口偏移。解决方案：在每次同步循环开始时重新获取 `today`，不使用缓存的日期。当前代码已经是每次 push 时调用 `datetime.date.today()`，符合要求。

---

## 六、数据库锁冲突防护

### 6.1 问题

SQLite 在写锁期间，其他连接的写操作会立即返回 `SQLITE_BUSY`。当前代码没有处理 `SQLITE_BUSY` 重试。

### 6.2 方案

在 `get_db()` 中设置 busy timeout：

```python
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout = 5000")  # 5 秒等待而非立即失败
    return conn
```

WAL 模式下读不阻塞写，这个设置主要保护写-写冲突场景（如用户在面板操作时恰好同步线程也在写）。

---

## 七、配置项汇总

新建/修改的 config 表项：

| category | key | 默认值 | 说明 |
|----------|-----|--------|------|
| `schedule_settings` | `autosave_interval_minutes` | `120` | 运行时自动存档间隔 |
| `schedule_settings` | `autosave_retention_count` | `20` | 运行时存档保留份数 |
| `schedule_settings` | `autosave_enabled` | `1` | 启用运行时存档 |
| — | — | — | 降级状态由 `get_sync_status().sync_health` 暴露，内存维护不持久化 |

---

## 八、改动文件清单

| 文件 | 改动内容 | 复杂度 |
|------|----------|--------|
| `db.py` | WAL 模式、integrity_check、busy_timeout、`get_db_context` | 中 |
| `feishu_sync.py` | 同步降级、watchdog、线程健康、事件截断、gc | 高 |
| `app.py` | debug=False / waitress、启动完整性检查、启动存档线程 | 低 |
| `utils.py` | `today()` 统一入口 | 低 |
| `routes/saves.py` | 无需修改（已处理 WAL） | 无 |
| `routes/feishu.py` | `get_sync_status` 新增字段 | 低 |
| `static/settings.js` | 前端健康指示器 | 低 |
| `templates/panels/settings.html` | 存档配置 UI | 低 |

---

## 九、不变的部分

- 双向同步冲突处理逻辑（`push_machine_schedules` 用户字段保留、`_apply_pull_changes` 状态联动）
- toggle 的 local/cloud 模式选择
- 前端自适应轮询（快轮询/倒计时/fallback）
- 现有的 save/restore 机制
- 飞书建表/字段补齐逻辑

---

## 十、测试要点

1. **WAL 模式**：模拟进程 kill，重启后数据库完整性检查通过
2. **同步降级**：mock 飞书 API 连续返回 500，验证降频 → 暂停 → 恢复全流程
3. **线程死亡恢复**：手动抛异常杀死同步线程，验证 watchdog 重启
4. **运行时存档**：调低间隔到 2 分钟，验证定期存档文件生成
5. **跨天行为**：手动修改系统时间跨过午夜，验证状态推送正确
6. **db locked 重试**：并发大量写操作，验证 busy_timeout 生效
