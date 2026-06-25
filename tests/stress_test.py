"""
Golden 排班系统 — 多用户稳定性极限测试
模拟 10 个并发用户，覆盖所有关键 API 路径。
用法：先启动 app.py，再运行 python stress_test.py
"""
import requests
import threading
import time
import random
import sys
import json
from collections import defaultdict

BASE = "http://127.0.0.1:5000"
RESULTS = defaultdict(lambda: {"ok": 0, "fail": 0, "times_ms": []})
LOCK = threading.Lock()
VERBOSE = "--verbose" in sys.argv or "-v" in sys.argv

def record(category, ok, ms):
    with LOCK:
        RESULTS[category]["ok" if ok else "fail"] += int(ok)
        r = RESULTS[category]
        r["times_ms"].append(ms)

def get(path, cat=None):
    cat = cat or path.split("?")[0].split("/")[1:3]
    cat = "/".join(cat) if isinstance(cat, list) else cat
    t0 = time.time()
    try:
        r = requests.get(f"{BASE}{path}", timeout=10)
        ok = r.status_code == 200
        record(cat, ok, (time.time() - t0) * 1000)
        if not ok and VERBOSE:
            print(f"  GET {path} → {r.status_code}")
        return r.json() if ok else None
    except Exception as e:
        record(cat, False, (time.time() - t0) * 1000)
        if VERBOSE:
            print(f"  GET {path} ERROR: {e}")
        return None

def post(path, data, cat=None):
    cat = cat or path.split("?")[0].split("/")[1:3]
    cat = "/".join(cat) if isinstance(cat, list) else cat
    t0 = time.time()
    try:
        r = requests.post(f"{BASE}{path}", json=data, timeout=10)
        ok = r.status_code in (200, 201)
        record(cat, ok, (time.time() - t0) * 1000)
        if not ok and VERBOSE:
            print(f"  POST {path} → {r.status_code}: {r.text[:200]}")
        return r.json() if ok else None
    except Exception as e:
        record(cat, False, (time.time() - t0) * 1000)
        if VERBOSE:
            print(f"  POST {path} ERROR: {e}")
        return None

# ============================================================
# 用户行为定义
# ============================================================

def user_read_heavy(uid):
    """读密集型用户：大量查询，少量写"""
    for i in range(30):
        get("/api/machines", "machines_list")
        get("/api/tasks", "tasks_list")
        get("/api/settings", "settings_all")
        get("/api/view_schedules?date=2026-06-12&span_days=3", "view_schedules")
        get("/api/history_schedules?date_from=2026-06-01&date_to=2026-06-12", "history")
        get("/api/task_packages", "packages_list")
        get("/api/machine_groups", "groups_list")
        get("/deletion_log", "deletion_log")
        if i % 5 == 0:
            post("/api/settings/batch", {
                "items": [{"category": "schedule_settings", "key": f"stress_test_{uid}", "value": str(i)}]
            }, "settings_batch")

def user_schedule_ops(uid):
    """排班操作用户：分配、移动、完成、回收"""
    # 先拿到可用的机器和任务
    machines = get("/api/machines", "machines_list")
    tasks = get("/api/tasks", "tasks_list")
    if not machines or not tasks:
        return
    mids = [m["id"] for m in machines.get("machines", [])]
    tids = [t["id"] for t in tasks.get("tasks", []) if t.get("status") == "待分配"]

    for i in range(20):
        if not mids or not tids:
            break
        mid = random.choice(mids)
        tid = random.choice(tids)

        # 1. 分配任务
        r = post("/assign_task", {
            "task_id": tid, "machine_id": mid,
            "date": "2026-06-12", "start_min": random.randint(0, 600),
            "force": True
        }, "assign_task")
        if r and r.get("schedule_id"):
            sid = r["schedule_id"]
            # 2. 移动任务
            post("/move_task", {
                "schedule_id": sid, "new_machine_id": mid,
                "date": "2026-06-12",
                "new_start_min": random.randint(100, 700),
                "force": True
            }, "move_task")
            # 3. 完成任务
            get(f"/complete_task/{sid}", "complete_task")
            # 4. 撤销完成
            get(f"/uncomplete_task/{sid}", "uncomplete_task")

def user_settings_mutator(uid):
    """设置变更用户：疯狂增删改枚举"""
    kinds = ["machine_types", "task_kinds", "priorities", "difficulties"]
    for i in range(15):
        cat = random.choice(kinds)
        key = f"stress_{uid}_{i}"
        # add
        post(f"/api/settings/{cat}/add", {"key": key}, f"settings_add_{cat}")
        # update
        post(f"/api/settings/{cat}/update", {"old_key": key, "new_key": f"{key}_v2", "value": ""}, f"settings_upd_{cat}")
        # reorder
        r = get(f"/api/settings?category={cat}", f"settings_get_{cat}")
        if r:
            items = r.get(cat, r) if isinstance(r, dict) else r
            keys = [x["key"] for x in items] if isinstance(items, list) else []
            if len(keys) >= 2:
                post(f"/api/settings/{cat}/reorder", {"keys": list(reversed(keys))}, f"settings_reorder_{cat}")
        # delete (if not the last one)
        post(f"/api/settings/{cat}/delete", {"key": f"{key}_v2"}, f"settings_del_{cat}")

def _get_raw(path, cat):
    """GET that doesn't parse JSON (for binary responses like Excel export)"""
    t0 = time.time()
    try:
        r = requests.get(f"{BASE}{path}", timeout=15)
        ok = r.status_code == 200
        record(cat, ok, (time.time() - t0) * 1000)
        return ok
    except Exception as e:
        record(cat, False, (time.time() - t0) * 1000)
        return False

def user_export_heavy(uid):
    """导出密集型用户"""
    for i in range(5):
        _get_raw("/export_schedules?status=executing&date_from=2026-06-01&date_to=2026-06-12", "export_exec")
        _get_raw("/export_schedules?status=completed&date_from=2026-06-01&date_to=2026-06-12", "export_comp")
        get("/api/history_schedules", "history")

def user_machine_manager(uid):
    """机器管理用户"""
    for i in range(15):
        # 改机器状态
        machines = get("/api/machines", "machines_list")
        if not machines:
            continue
        ms = machines.get("machines", [])
        if ms:
            m = random.choice(ms)
            new_status = random.choice(["空闲", "工作", "维修停用"])
            post("/set_machine_status", {"id": m["id"], "status": new_status}, "machine_status")
        # 改设置
        post("/api/settings/batch", {
            "items": [{"category": "schedule_settings", "key": f"stress_machine_{uid}_{i}", "value": "1"}]
        }, "settings_batch")

def user_quick_ops(uid):
    """批量操作用户"""
    for i in range(10):
        # 分配一些任务再做批量操作
        tasks = get("/api/tasks", "tasks_list")
        machines = get("/api/machines", "machines_list")
        if not tasks or not machines:
            continue
        tids = [t["id"] for t in tasks.get("tasks", []) if t.get("status") == "待分配"]
        mids = [m["id"] for m in machines.get("machines", [])]
        if tids and mids:
            for _ in range(2):
                post("/assign_task", {
                    "task_id": random.choice(tids), "machine_id": random.choice(mids),
                    "date": "2026-06-12", "start_min": random.randint(0, 800),
                    "force": True
                }, "assign_task")
        # 批量操作
        actions = ["recycle_uncompleted", "confirm_overdue"]
        post("/quick_ops", {"action": random.choice(actions), "date": "2026-06-12"}, "quick_ops")

def user_task_package_ops(uid):
    """任务包操作用户"""
    for i in range(8):
        # 创建任务包
        r = post("/api/task_packages", {
            "name": f"stress_pkg_{uid}_{i}",
            "machine_type": "BR2",
            "priority": "P1"
        }, "package_create")
        if r and r.get("id"):
            pid = r["id"]
            # 添加任务
            tasks = get("/api/tasks", "tasks_list")
            if tasks:
                tids = [t["id"] for t in tasks.get("tasks", [])[:3]]
                if tids:
                    post(f"/api/task_packages/{pid}/add_tasks", {"task_ids": tids}, "package_add_tasks")
            # 更新 (PUT)
            requests.put(f"{BASE}/api/task_packages/{pid}", json={"name": f"stress_pkg_{uid}_{i}_updated"}, timeout=10)
            # 删除
            requests.delete(f"{BASE}/api/task_packages/{pid}?cascade=true", timeout=10)

def user_mixed_crud(uid):
    """混合 CRUD 用户：随机打各种 API"""
    endpoints_read = [
        "/api/machines", "/api/tasks", "/api/settings",
        "/api/view_schedules?date=2026-06-12&span_days=2",
        "/api/history_schedules", "/api/task_packages",
        "/api/machine_groups", "/deletion_log",
        "/api/settings?category=machine_types",
        "/api/settings?category=task_kinds",
        "/api/settings?category=priorities",
        "/api/settings?category=difficulties",
    ]
    for i in range(40):
        # 70% 读, 30% 写
        if random.random() < 0.7:
            path = random.choice(endpoints_read)
            get(path, "mixed_read")
        else:
            post("/api/settings/batch", {
                "items": [{"category": "schedule_settings", "key": f"stress_mixed_{uid}_{i}", "value": str(random.randint(1, 100))}]
            }, "mixed_write")

# ============================================================
# 并发执行引擎
# ============================================================

USER_FACTORIES = [
    ("read_heavy", user_read_heavy),
    ("schedule_ops", user_schedule_ops),
    ("settings_mutator", user_settings_mutator),
    ("export_heavy", user_export_heavy),
    ("machine_manager", user_machine_manager),
    ("quick_ops", user_quick_ops),
    ("task_package_ops", user_task_package_ops),
    ("mixed_crud", user_mixed_crud),
    ("read_heavy2", user_read_heavy),
    ("mixed_crud2", user_mixed_crud),
]

def run():
    print("=" * 60)
    print("Golden 排班系统 — 多用户稳定性极限测试")
    print(f"并发用户数: {len(USER_FACTORIES)}")
    print(f"目标服务: {BASE}")
    print("=" * 60)

    threads = []
    t0 = time.time()

    for uid, (label, factory) in enumerate(USER_FACTORIES):
        t = threading.Thread(target=factory, args=(uid,), name=f"{label}-{uid}")
        threads.append(t)

    print(f"\n启动 {len(threads)} 个线程...")
    for t in threads:
        t.start()

    for t in threads:
        t.join()

    elapsed = time.time() - t0

    # ============================================================
    # 报告
    # ============================================================
    print(f"\n{'='*60}")
    print("测试结果报告")
    print(f"{'='*60}")
    print(f"总耗时: {elapsed:.1f}s")
    print(f"并发线程: {len(threads)}")

    total_ok = sum(r["ok"] for r in RESULTS.values())
    total_fail = sum(r["fail"] for r in RESULTS.values())
    total_ops = total_ok + total_fail

    print(f"总请求数: {total_ops}")
    print(f"成功: {total_ok}  ({100*total_ok/max(1,total_ops):.1f}%)")
    print(f"失败: {total_fail} ({100*total_fail/max(1,total_ops):.1f}%)")
    print(f"吞吐量: {total_ops/elapsed:.1f} req/s")

    print(f"\n{'─'*60}")
    print(f"{'分类':<35} {'成功':>6} {'失败':>6} {'平均ms':>8} {'P50ms':>7} {'P99ms':>8}")
    print(f"{'─'*60}")

    for cat in sorted(RESULTS.keys()):
        r = RESULTS[cat]
        times = sorted(r["times_ms"])
        avg = sum(times)/len(times) if times else 0
        p50 = times[len(times)//2] if times else 0
        p99 = times[min(len(times)-1, int(len(times)*0.99))] if times else 0
        print(f"{cat:<35} {r['ok']:>6} {r['fail']:>6} {avg:>7.1f} {p50:>6.0f} {p99:>7.0f}")

    # 关键发现
    print(f"\n{'─'*60}")
    print("关键指标")
    print(f"{'─'*60}")

    # 数据库写入冲突检查
    write_cats = [k for k in RESULTS if any(w in k for w in ["assign", "move", "complete", "settings_add", "settings_upd", "settings_del", "settings_batch", "quick_ops", "machine_status", "package"])]
    write_oks = sum(RESULTS[c]["ok"] for c in write_cats)
    write_fails = sum(RESULTS[c]["fail"] for c in write_cats)
    print(f"写操作成功率: {100*write_oks/max(1,write_oks+write_fails):.1f}% ({write_oks}/{write_oks+write_fails})")

    # 并发读稳定性
    read_cats = [k for k in RESULTS if k in ["machines_list", "tasks_list", "settings_all", "view_schedules", "history", "packages_list", "groups_list", "deletion_log", "mixed_read"]]
    read_oks = sum(RESULTS[c]["ok"] for c in read_cats)
    read_fails = sum(RESULTS[c]["fail"] for c in read_cats)
    print(f"读操作成功率: {100*read_oks/max(1,read_oks+read_fails):.1f}% ({read_oks}/{read_oks+read_fails})")

    # 是否有数据库锁错误
    db_lock_errors = sum(1 for c in read_cats + write_cats for t in RESULTS.get(c, {}).get("times_ms", []) if t > 5000)
    print(f"慢查询 (>5s): {db_lock_errors} 个")

    if total_fail == 0:
        print("\n[OK] All requests passed - no issues under multi-user concurrency!")
    elif total_fail / total_ops < 0.02:
        print(f"\n[WARN] Minor failures ({total_fail}/{total_ops}), within acceptable range")
    else:
        print(f"\n[FAIL] High failure rate ({total_fail}/{total_ops}), needs investigation")

    # 数据库最终状态检查
    print(f"\n{'─'*60}")
    print("数据库最终状态")
    print(f"{'─'*60}")
    try:
        r = requests.get(f"{BASE}/api/machines", timeout=5)
        machines_count = len(r.json().get("machines", []))
        print(f"机器数: {machines_count}")
    except:
        print("机器数: 查询失败")

    try:
        r = requests.get(f"{BASE}/api/tasks", timeout=5)
        tasks_count = len(r.json().get("tasks", []))
        print(f"任务数: {tasks_count}")
    except:
        print("任务数: 查询失败")

    try:
        r = requests.get(f"{BASE}/api/settings", timeout=5)
        settings_cats = len(r.json())
        print(f"设置分类数: {settings_cats}")
    except:
        print("设置分类数: 查询失败")

    # 数据库完整性检查
    try:
        import sqlite3
        db_path = r"C:\Users\Admin\.task_schedule_app\schedule_data.sqlite3"
        conn = sqlite3.connect(db_path)
        row = conn.execute("PRAGMA integrity_check").fetchone()
        conn.close()
        print(f"Database integrity: {'OK' if row[0] == 'ok' else 'FAIL: ' + str(row[0])}")
    except Exception as e:
        print(f"数据库完整性: 检查失败 ({e})")

    print(f"\n{'='*60}")
    print("测试完毕")
    print(f"{'='*60}")

    return total_fail == 0


if __name__ == "__main__":
    ok = run()
    sys.exit(0 if ok else 1)
