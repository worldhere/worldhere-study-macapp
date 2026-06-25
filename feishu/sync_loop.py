# -*- coding: utf-8 -*-
"""飞书后台同步循环：线程管理、异步操作编排、降级策略"""
import datetime
import time
import threading
import gc
from concurrent.futures import ThreadPoolExecutor, as_completed
from db import get_db
from feishu.status import write_event, _active_operation, _init_lock_ref, _is_sync_enabled

# ========== 后台同步全局状态 ==========
_sync_thread = None
_sync_stop_event = threading.Event()
_init_lock = threading.Lock()  # 初始化期间防止并发操作
_init_cancel = threading.Event()  # 用户手动取消初始化
SYNC_INTERVAL_SEC = 30
_last_loop_at = None          # 上次后台同步循环完成时间
_last_push_result = None       # {"total": N, "success": M, "fail": F} 上次推送统计
_consecutive_failures = 0     # 连续同步循环失败次数
_thread_health = {"alive": True, "last_heartbeat": 0, "restart_count": 0}  # 线程健康状态

# 将 _init_lock 注入 status 模块，供 is_initializing fallback 使用
_init_lock_ref = _init_lock


def is_initializing():
    """检查是否正在初始化中（非阻塞）"""
    return _init_lock.locked()


def cancel_init():
    """取消正在进行的初始化。设置取消标志，init 循环检测到后自行退出。"""
    _init_cancel.set()
    # 等待 init 线程释放锁（最多等 5 秒）
    for _ in range(50):
        if not _init_lock.locked():
            break
        time.sleep(0.1)


def _get_degraded_level():
    """根据连续失败次数返回降级级别"""
    if _consecutive_failures <= 2:
        return "normal"
    elif _consecutive_failures <= 5:
        return "reduced"
    elif _consecutive_failures <= 9:
        return "minimal"
    else:
        return "paused"


def _get_sync_interval():
    """根据连续失败次数返回同步间隔（秒）"""
    if _consecutive_failures <= 2:
        return SYNC_INTERVAL_SEC
    elif _consecutive_failures <= 5:
        return 120  # 2 分钟
    else:
        return 300  # 5 分钟


def push_all_machines_parallel():
    """并行推送所有已映射机器"""
    global _last_push_result
    from feishu.schedule_sync import push_machine_schedules
    import json as _json
    conn = get_db()
    mappings = conn.execute("SELECT machine_id, last_push_snapshot FROM feishu_sync_mapping").fetchall()
    conn.close()

    # 保存 push 前的旧快照，供事件检测使用（push 会更新快照导致 data_changed 失效）
    old_snapshots = {}
    for m in mappings:
        snap = {}
        if m["last_push_snapshot"]:
            try:
                snap = _json.loads(m["last_push_snapshot"])
            except (_json.JSONDecodeError, TypeError):
                snap = {}
        old_snapshots[m["machine_id"]] = snap

    if not mappings:
        _last_push_result = {"total": 0, "success": 0, "fail": 0}
        # 即使没有映射也要检测本地事件（班次报告、任务包完成等不依赖飞书表）
        try:
            from feishu.events import detect_and_push_events
            detect_and_push_events(old_snapshots)
        except Exception:
            pass
        return
    success = 0
    fail = 0
    total = len(mappings)
    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(push_machine_schedules, m["machine_id"]): m["machine_id"] for m in mappings}
        for future in as_completed(futures):
            try:
                r = future.result()
                if r and "error" not in r:
                    success += 1
                else:
                    fail += 1
            except Exception:
                fail += 1
    _last_push_result = {"total": total, "success": success, "fail": fail}

    # 推送完成后检测事件，传入旧快照
    try:
        from feishu.events import detect_and_push_events
        detect_and_push_events(old_snapshots)
    except Exception:
        pass


def start_pull_thread():
    """启动后台同步线程（幂等：已在运行则跳过）"""
    global _sync_thread, _sync_stop_event, _last_loop_at
    if _sync_thread and _sync_thread.is_alive():
        return
    _sync_stop_event.clear()
    _last_loop_at = time.time()  # 启动时设置基准点，前端倒计时立即可用
    _sync_thread = threading.Thread(target=_sync_loop, daemon=True, name="feishu-sync")
    _sync_thread.start()


def stop_pull_thread():
    """停止后台同步线程"""
    global _sync_thread, _sync_stop_event
    _sync_stop_event.set()
    if _sync_thread:
        _sync_thread.join(timeout=5)
    _sync_thread = None


# ========== 异步操作 ==========

def _async_init():
    """后台执行初始化，写入事件。"""
    from feishu.init_engine import incremental_init
    import feishu.status as status_mod
    try:
        result = incremental_init(_init_lock, _init_cancel)
        if not result.get("cancelled") and not result.get("error"):
            mapped = result.get("mapped_machines", 0)
            total = result.get("total_machines", 0)
            status_mod.finish_operation("init", "ok", mapped, total,
                                        "{}/{} 台已映射".format(mapped, total))
    except Exception as e:
        status_mod.finish_operation("init", "error", 0, 0,
                                    "初始化失败: {}".format(str(e)[:80]))
        write_event("error", "", "初始化失败: {}".format(str(e)[:80]))


def _async_push():
    """后台执行全量推送，写入事件。"""
    global _last_push_result
    from feishu.schedule_sync import push_machine_schedules
    import feishu.status as status_mod
    import json as _json
    try:
        conn = get_db()
        mappings = conn.execute(
            "SELECT machine_id, machine_name, last_push_snapshot FROM feishu_sync_mapping"
        ).fetchall()
        conn.close()

        # 保存 push 前的旧快照，供事件检测使用
        old_snapshots = {}
        for m in mappings:
            snap = {}
            if m["last_push_snapshot"]:
                try:
                    snap = _json.loads(m["last_push_snapshot"])
                except (_json.JSONDecodeError, TypeError):
                    snap = {}
            old_snapshots[m["machine_id"]] = snap

        if not mappings:
            write_event("info", "", "无已映射机器，跳过推送")
            # 即使没有映射也要检测本地事件（班次报告、任务包完成等不依赖飞书表）
            try:
                from feishu.events import detect_and_push_events
                detect_and_push_events(old_snapshots)
            except Exception:
                pass
            return
        total = len(mappings)
        status_mod.set_active_operation({"type": "push", "total": total, "done": 0,
                           "phase": 1, "phase_total": 1, "phase_label": "推送"})
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
            status_mod._active_operation["done"] = i + 1

        _last_push_result = {"total": total, "success": success, "fail": fail}

        # 推送完成后检测事件，传入旧快照
        try:
            from feishu.events import detect_and_push_events
            detect_and_push_events(old_snapshots)
        except Exception:
            pass

        status_mod.finish_operation("push", "ok", success, total,
                                    "{}/{} 成功".format(success, total))
        write_event("info", "", "推送完成: {}/{} 成功".format(success, total))
    except Exception as e:
        import feishu.status as status_mod2
        status_mod2.finish_operation("push", "error", 0, 0,
                                     "推送失败: {}".format(str(e)[:80]))
        write_event("error", "", "推送失败: {}".format(str(e)[:80]))


def _async_pull():
    """后台执行全量拉取，写入事件。"""
    from feishu.schedule_sync import pull_all_machines
    import feishu.status as status_mod
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
        status_mod.set_active_operation({"type": "pull", "total": total, "done": 0,
                           "phase": 1, "phase_total": 1, "phase_label": "拉取"})
        write_event("info", "", "开始拉取 {} 台机器".format(total))

        result = pull_all_machines()
        checked = result.get("machines_checked", 0)
        errors = result.get("errors", [])
        updated = result.get("records_updated", 0)
        summary = "{} 台更新 {} 条".format(checked, updated)
        if errors:
            summary += ", {} 个错误".format(len(errors))
        status_mod.finish_operation("pull", "ok", checked, checked, summary)
        if errors:
            write_event("warn", "", "拉取完成: {}".format(summary))
        else:
            write_event("info", "", "拉取完成: {}".format(summary))
    except Exception as e:
        import feishu.status as status_mod2
        status_mod2.finish_operation("pull", "error", 0, 0,
                                     "拉取失败: {}".format(str(e)[:80]))
        write_event("error", "", "拉取失败: {}".format(str(e)[:80]))


def _async_toggle_on(mode="local"):
    """后台执行 toggle 开启的完整流程：初始化 + 云端对齐 + 启动同步循环 + 推送。"""
    from feishu.init_engine import incremental_init
    from feishu.schedule_sync import pull_all_machines
    import feishu.status as status_mod

    try:
        result = incremental_init(_init_lock, _init_cancel)
        mapped = result.get("mapped_machines", 0)
        total = result.get("total_machines", 0)
        # cloud 模式：先拉取飞书端改动
        if mode == "cloud":
            status_mod.set_active_operation({"type": "pull", "total": 1, "done": 0,
                                              "phase": 1, "phase_total": 1, "phase_label": "拉取"})
            write_event("info", "", "云端对齐：拉取飞书端改动...")
            try:
                pull_all_machines()
            except Exception:
                pass
            status_mod.finish_operation("pull", "ok", 1, 1, "云端对齐完成")
            write_event("info", "", "云端对齐完成")
        # 启动后台同步循环
        start_pull_thread()
        # 全量推送
        try:
            push_all_machines_parallel()
        except Exception:
            pass
        # 标记 init 完成，让前端 KPI 和进度条正确更新
        status_mod.finish_operation("init", "ok", mapped, total,
                                    "{}/{} 台已映射".format(mapped, total))
        # 广播最新状态，让前端 KPI 实时更新
        try:
            status_mod.broadcast('status', status_mod.get_sync_status())
        except Exception:
            pass
    except Exception as e:
        import feishu.status as status_mod2
        status_mod2.finish_operation("init", "error", 0, 0,
                                     "初始化失败: {}".format(str(e)[:80]))
        write_event("error", "", "初始化失败: {}".format(str(e)[:80]))


# ========== 后台同步主循环 ==========

def _sync_loop():
    """统一后台循环：pull -> push -> push_config，带 watchdog 和降级策略"""
    global _last_loop_at, _consecutive_failures, _thread_health
    from feishu.config_table import push_machine_config
    from feishu.groups import sync_groups
    from feishu.schedule_sync import pull_all_machines
    _consecutive_failures = 0
    _thread_health = {"alive": True, "last_heartbeat": time.time(), "restart_count": 0}
    _last_loop_at = time.time()

    while not _sync_stop_event.is_set():
        # 同步未开启时降低检查频率
        if not _is_sync_enabled():
            for _ in range(10):
                if _sync_stop_event.is_set():
                    return
                time.sleep(1)
            continue

        # 执行一次同步循环
        cycle_errors = 0
        degraded_level = _get_degraded_level()

        # === 构建同步阶段列表 ===
        phases = []
        if degraded_level in ("normal", "reduced"):
            phases.append(("拉取", "pull"))
            phases.append(("推送", "push"))
        if degraded_level in ("normal", "reduced", "minimal") and _is_sync_enabled():
            phases.append(("配置", "config"))
            phases.append(("分组", "groups"))

        # === 设置同步进行中的进度条 ===
        import feishu.status as status_mod
        if phases:
            status_mod.set_active_operation({
                "type": "sync", "total": len(phases), "done": 0,
                "phase": 0, "phase_total": len(phases), "phase_label": "同步",
            })

        def _step_done(label):
            """更新当前阶段进度"""
            op = status_mod._active_operation
            if op:
                op["phase"] += 1
                op["done"] = op["phase"]
                op["phase_label"] = label
                status_mod.broadcast('progress', {
                    'type': 'sync',
                    'phase': op["phase"],
                    'phase_total': op["phase_total"],
                    'phase_label': label,
                    'done': op["done"],
                    'total': op["total"],
                })

        # 自动修复缺失映射的机器（进入建表模式）
        if degraded_level in ("normal", "reduced") and _is_sync_enabled():
            try:
                from feishu.init_engine import auto_fix_missing_mappings
                fix_result = auto_fix_missing_mappings()
                if fix_result.get("fixed", 0) > 0:
                    write_event("info", "", "自动建表: {} 台新机器已映射".format(fix_result["fixed"]))
            except Exception:
                pass

        if degraded_level in ("normal", "reduced"):
            _step_done("拉取")
            try:
                pull_all_machines()
            except Exception:
                cycle_errors += 1
                write_event("warn", "", "pull 拉取异常")

        if degraded_level in ("normal", "reduced"):
            _step_done("推送")
            try:
                push_all_machines_parallel()
            except Exception:
                cycle_errors += 1
                write_event("warn", "", "push 推送异常")

        if degraded_level in ("normal", "reduced", "minimal") and _is_sync_enabled():
            _step_done("配置")
            try:
                push_machine_config()
            except Exception:
                cycle_errors += 1
                write_event("warn", "", "push_config 配置推送异常")

        if degraded_level in ("normal", "reduced", "minimal") and _is_sync_enabled():
            _step_done("分组")
            try:
                sync_groups()
            except Exception:
                cycle_errors += 1
                write_event("warn", "", "sync_groups 分组同步异常")

        # === 同步完成，写入摘要 ===
        if phases:
            pr = _last_push_result
            if pr and pr.get("total", 0) > 0:
                summary = "推送 {}/{} 成功".format(pr["success"], pr["total"])
            else:
                summary = "{}/{} 步完成".format(len(phases) - cycle_errors, len(phases))
            status_mod.finish_operation(
                "sync", "ok" if cycle_errors == 0 else "warn",
                len(phases), len(phases), summary,
            )

        # 更新追踪状态
        if cycle_errors > 0:
            _consecutive_failures += 1
            write_event("warn", "", "同步循环异常 (连续{}次)".format(_consecutive_failures))
        else:
            _consecutive_failures = 0

        _last_loop_at = time.time()
        _thread_health["last_heartbeat"] = _last_loop_at

        # 每次循环后广播最新状态，前端倒计时等 KPI 得以实时更新
        try:
            import feishu.status as _st
            _st.broadcast('status', _st.get_sync_status())
        except Exception:
            pass

        # 连续 10 次失败 -> 暂停 5 分钟后重试
        if _consecutive_failures >= 10:
            write_event("error", "", "同步连续失败10次，暂停5分钟后重试")
            for _ in range(300):
                if _sync_stop_event.is_set():
                    return
                time.sleep(1)
            _consecutive_failures = 0
            _thread_health["restart_count"] += 1
            write_event("info", "", "同步恢复，重置计数器")
            continue

        # 定期 GC
        try:
            gc.collect()
        except Exception:
            pass

        # 根据降级级别计算等待间隔
        interval = _get_sync_interval()

        # 按秒等待，每秒检查停止信号
        for _ in range(interval):
            if _sync_stop_event.is_set():
                return
            time.sleep(1)
