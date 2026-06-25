# -*- coding: utf-8 -*-
"""飞书同步状态聚合：事件缓冲、同步状态查询、模式管理、SSE 广播"""
import datetime
import json
import queue
import time
import threading
from db import get_db
from feishu.common import _get_app_token

# ========== 事件缓冲区 ==========
_event_buffer = []           # [{time, level, machine, msg, percent}]
_event_lock = threading.Lock()
MAX_EVENTS = 100             # 内存缓冲区，服务重启后清空（预期行为）
_active_operation = None     # None | {"type":"init|push|pull", "total":N, "done":M}
_last_event_push_at = None  # 上次事件检测+推送完成的时间戳

# ========== SSE 广播 ==========
_sse_clients = []            # list of queue.Queue
_operation_history = []      # [{type, time, status, done, total, summary}]
MAX_OPERATION_HISTORY = 600

# 由 sync_loop 设置，引用 sync_loop 模块的 _init_lock
_init_lock_ref = None


def broadcast(event_type, data):
    """Push an SSE event to all connected clients. Thread-safe."""
    payload = "event: {}\ndata: {}\n\n".format(event_type, json.dumps(data, ensure_ascii=False))
    dead = []
    for q in _sse_clients:
        try:
            q.put_nowait(payload)
        except queue.Full:
            dead.append(q)
    for q in dead:
        try:
            _sse_clients.remove(q)
        except ValueError:
            pass


def set_active_operation(op):
    """Set _active_operation and broadcast progress to SSE clients."""
    global _active_operation
    _active_operation = op
    if op:
        broadcast('progress', {
            'type': op['type'],
            'phase': op.get('phase', 1),
            'phase_total': op.get('phase_total', 1),
            'phase_label': op.get('phase_label', op['type']),
            'done': op.get('done', 0),
            'total': op.get('total', 0),
        })


def clear_active_operation():
    """Clear _active_operation without broadcasting done."""
    global _active_operation
    _active_operation = None


def finish_operation(op_type, status, done, total, summary):
    """Clear operation, record to history, broadcast done event."""
    global _active_operation
    _active_operation = None
    record = {
        "type": op_type,
        "time": datetime.datetime.now().strftime("%H:%M:%S"),
        "status": status,
        "done": done,
        "total": total,
        "summary": summary,
    }
    _operation_history.insert(0, record)
    if len(_operation_history) > MAX_OPERATION_HISTORY:
        _operation_history.pop()
    broadcast('done', record)


def record_event_push(diag):
    """推送事件完成后，记录摘要到操作历史并更新时间戳。"""
    global _last_event_push_at
    import time as _time
    _last_event_push_at = _time.time()
    parts = []
    if diag.get("sent", 0) > 0:
        parts.append("发送{}条".format(diag["sent"]))
    if diag.get("failed", 0) > 0:
        parts.append("失败{}条".format(diag["failed"]))
    if diag.get("skipped_dedup", 0) > 0:
        parts.append("去重跳过{}".format(diag["skipped_dedup"]))
    if diag.get("skipped_toggle", 0) > 0:
        parts.append("开关关闭{}".format(diag["skipped_toggle"]))
    summary = ", ".join(parts) if parts else "无事件"
    record = {
        "type": "event_push",
        "time": datetime.datetime.now().strftime("%H:%M:%S"),
        "status": "ok",
        "done": 1,
        "total": 1,
        "summary": summary,
    }
    _operation_history.insert(0, record)
    if len(_operation_history) > MAX_OPERATION_HISTORY:
        _operation_history.pop()
    broadcast('done', record)


def write_event(level, machine, msg, percent=None):
    """操作过程中写入事件。level: info|warn|error。线程安全。字段自动截断。
    同时通过 SSE 广播 log 事件给所有连接的客户端。
    """
    entry = {
        "time": datetime.datetime.now().strftime("%H:%M:%S"),
        "level": level,
        "machine": (machine or "")[:50],
        "msg": (msg or "")[:200],
        "percent": percent,
    }
    with _event_lock:
        _event_buffer.append(entry)
        if len(_event_buffer) > MAX_EVENTS:
            _event_buffer.pop(0)
    # SSE broadcast with current operation progress
    sse_data = dict(entry)
    if _active_operation:
        sse_data['done'] = _active_operation.get('done', 0)
        sse_data['total'] = _active_operation.get('total', 0)
    broadcast('log', sse_data)


def _is_sync_enabled():
    try:
        conn = get_db()
        row = conn.execute(
            "SELECT value FROM config WHERE category='feishu' AND key='sync_enabled'"
        ).fetchone()
        conn.close()
        return row and row["value"] == "1"
    except Exception:
        return False


def _get_sync_mode():
    """读取同步模式：'local' 以本地为准，'cloud' 与云端对齐（仅首次拉取）"""
    try:
        conn = get_db()
        row = conn.execute(
            "SELECT value FROM config WHERE category='feishu' AND key='sync_mode'"
        ).fetchone()
        conn.close()
        return row["value"] if row else "local"
    except Exception:
        return "local"


def get_sync_status():
    """聚合同步状态（含完整性检查）。
    通过懒加载 import feishu.sync_loop 读取实时值，避免参数传递导致的引用过期。
    """
    try:
        conn = get_db()
        enabled_row = conn.execute(
            "SELECT value FROM config WHERE category='feishu' AND key='sync_enabled'"
        ).fetchone()
        mappings = conn.execute("SELECT * FROM feishu_sync_mapping").fetchall()
        machines = conn.execute(
            "SELECT id, name FROM machines ORDER BY sort_order ASC"
        ).fetchall()
        conn.close()
    except Exception:
        return {
            "enabled": False, "connected": False, "initialized": False,
            "mapping_count": 0, "last_pull_at": None, "last_push_at": None,
            "base_info": _get_app_token(), "integrity": {"total_machines": 0},
            "db_integrity_ok": True,
        }

    enabled_val = (enabled_row["value"] == "1") if enabled_row else False

    # 检测连接
    from feishu.common import _feishu_data
    connected = False
    try:
        data = _feishu_data("GET", f"/apps/{_get_app_token()}/tables")
        connected = bool(data)
    except Exception:
        pass

    # 完整性
    mapped_ids = {m["machine_id"]: m for m in mappings}
    machine_map = {m["id"]: m["name"] for m in machines}
    missing_tables = []
    stale_mappings = 0

    for mc in machines:
        if mc["id"] not in mapped_ids:
            missing_tables.append(mc["name"])

    for mid in mapped_ids:
        if mid not in machine_map:
            stale_mappings += 1

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
            pull_at = mapping["last_pull_at"] if "last_pull_at" in mapping.keys() else None
            push_at = mapping["last_push_at"] if "last_push_at" in mapping.keys() else None
            if pull_at and push_at:
                info["last_sync"] = max(pull_at, push_at)
            else:
                info["last_sync"] = pull_at or push_at
        per_machine.append(info)

    # 懒加载 sync_loop 模块获取实时状态（避免 from import 绑定过期值）
    import feishu.sync_loop as sl
    sync_interval = sl.SYNC_INTERVAL_SEC
    last_loop = sl._last_loop_at
    last_push = sl._last_push_result
    consec_fails = sl._consecutive_failures
    sync_thread = sl._sync_thread
    thread_health = sl._thread_health

    # 距下次后台同步的剩余秒数
    next_loop_in_sec = None
    if last_loop and enabled_val and sync_interval:
        elapsed = time.time() - last_loop
        remaining = sync_interval - elapsed
        next_loop_in_sec = max(0, int(remaining))

    # 距下次事件推送的剩余秒数（与 MIN_DETECT_INTERVAL_SEC 对齐）
    from feishu.events.shared import MIN_DETECT_INTERVAL_SEC
    next_event_push_in_sec = None
    if _last_event_push_at and enabled_val:
        elapsed = time.time() - _last_event_push_at
        remaining = MIN_DETECT_INTERVAL_SEC - elapsed
        next_event_push_in_sec = max(0, int(remaining))

    # 数据库完整性
    try:
        from db import is_db_integrity_ok
        db_ok = is_db_integrity_ok()
    except Exception:
        db_ok = True

    # 采集最近事件
    with _event_lock:
        recent_events = list(_event_buffer[-20:])

    # init 状态
    initializing = sl.is_initializing()

    # 降级级别
    degraded_level = "disabled"
    if enabled_val:
        degraded_level = sl._get_degraded_level()

    return {
        "enabled": enabled_val,
        "connected": connected,
        "initialized": len(mappings) > 0,
        "initializing": initializing,
        "sync_mode": _get_sync_mode(),
        "mapping_count": len(mappings),
        "total_machines": len(machines),
        "last_pull_at": mappings[0]["last_pull_at"] if mappings else None,
        "last_push_at": mappings[0]["last_push_at"] if mappings else None,
        "last_loop_at": last_loop,
        "next_loop_in_sec": next_loop_in_sec,
        "last_event_push_at": _last_event_push_at,
        "next_event_push_in_sec": next_event_push_in_sec,
        "sync_interval_sec": sync_interval,
        "last_push_result": last_push,
        "base_info": _get_app_token(),
        "events": recent_events,
        "active_operation": _active_operation,
        "operation_history": list(_operation_history),
        "db_integrity_ok": db_ok,
        "sync_health": {
            "consecutive_failures": consec_fails or 0,
            "degraded_level": degraded_level,
            "thread_alive": sync_thread is not None and sync_thread.is_alive(),
            "last_heartbeat": (thread_health or {}).get("last_heartbeat", 0),
            "restart_count": (thread_health or {}).get("restart_count", 0),
        },
        "integrity": {
            "total_machines": len(machines),
            "mapped_machines": len(mappings),
            "missing_tables": missing_tables,
            "missing_fields": {},
            "stale_mappings": stale_mappings,
            "validation_errors": [],
            "per_machine": per_machine,
        },
    }
