# -*- coding: utf-8 -*-
"""操作撤回 — 快照制。操作前序列化受影响行到文件，撤回时 INSERT OR REPLACE 回去。

存储位置：{存档目录}/undo_sessions/{session_id}/
生命周期：页面关闭时前端通知清理，服务端定时扫描清理超过1小时的孤儿目录。
"""
import json
import os
import datetime
import uuid
from db import DB_PATH, DATA_DIR


UNDO_DIR = os.path.join(DATA_DIR, "undo_sessions")
MAX_SNAPSHOTS_PER_SESSION = 10
ORPHAN_TIMEOUT_SEC = 3600  # 1小时


def _ensure_undo_dir():
    os.makedirs(UNDO_DIR, exist_ok=True)


def _session_dir(session_id):
    return os.path.join(UNDO_DIR, session_id)


def _snapshot_path(session_id, snapshot_id):
    return os.path.join(_session_dir(session_id), f"{snapshot_id}.json")


def _index_path(session_id):
    return os.path.join(_session_dir(session_id), "_index.json")


def _write_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _read_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


# ========== 快照创建 ==========

def create_snapshot(session_id, label, schedule_ids=None, task_ids=None):
    """操作前拍快照。返回 snapshot_id 或 None（无数据可拍）。

    schedule_ids / task_ids: 至少提供一个，用于确定要快照的排班范围。
    """
    if not session_id or (not schedule_ids and not task_ids):
        return None

    _ensure_undo_dir()
    s_dir = _session_dir(session_id)
    os.makedirs(s_dir, exist_ok=True)

    from db import get_db
    conn = get_db()

    data = {}

    # 快照 schedules
    if schedule_ids:
        placeholders = ",".join("?" * len(schedule_ids))
        rows = conn.execute(
            f"SELECT * FROM schedules WHERE id IN ({placeholders})",
            [int(x) for x in schedule_ids],
        ).fetchall()
        data["schedules"] = [dict(r) for r in rows] if rows else []
    else:
        data["schedules"] = []

    # 快照关联的 tasks
    affected_task_ids = set()
    for s in data["schedules"]:
        if s.get("task_id"):
            affected_task_ids.add(int(s["task_id"]))
    if task_ids:
        for tid in task_ids:
            affected_task_ids.add(int(tid))
    if affected_task_ids:
        placeholders = ",".join("?" * len(affected_task_ids))
        rows = conn.execute(
            f"SELECT * FROM tasks WHERE id IN ({placeholders})",
            [int(x) for x in affected_task_ids],
        ).fetchall()
        data["tasks"] = [dict(r) for r in rows] if rows else []
    else:
        data["tasks"] = []

    # 快照 feishu_record_mapping（如果排班已同步到飞书）
    schedule_ids_for_fs = [int(s["id"]) for s in data["schedules"] if s.get("id")]
    if schedule_ids_for_fs:
        placeholders = ",".join("?" * len(schedule_ids_for_fs))
        rows = conn.execute(
            f"SELECT * FROM feishu_record_mapping WHERE schedule_id IN ({placeholders})",
            schedule_ids_for_fs,
        ).fetchall()
        data["feishu_record_mapping"] = [dict(r) for r in rows] if rows else []
    else:
        data["feishu_record_mapping"] = []

    conn.close()

    if not data["schedules"] and not data["tasks"]:
        return None

    snapshot_id = uuid.uuid4().hex[:12]
    snapshot = {
        "operation": label,
        "captured_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "data": data,
    }

    _write_json(_snapshot_path(session_id, snapshot_id), snapshot)

    # 更新索引
    index = _read_json(_index_path(session_id)) if os.path.exists(_index_path(session_id)) else []
    index.append({
        "snapshot_id": snapshot_id,
        "label": label,
        "captured_at": snapshot["captured_at"],
    })
    # 保留最近 N 个
    if len(index) > MAX_SNAPSHOTS_PER_SESSION:
        removed = index[:-MAX_SNAPSHOTS_PER_SESSION]
        index = index[-MAX_SNAPSHOTS_PER_SESSION:]
        for item in removed:
            p = _snapshot_path(session_id, item["snapshot_id"])
            if os.path.exists(p):
                os.remove(p)
    _write_json(_index_path(session_id), index)

    return snapshot_id


# ========== 快照恢复 ==========

def restore_snapshot(session_id, snapshot_id):
    """从快照恢复数据。返回 (ok, msg, details)。"""
    path = _snapshot_path(session_id, snapshot_id)
    if not os.path.exists(path):
        return False, "快照不存在或已过期", {}

    snapshot = _read_json(path)
    data = snapshot.get("data", {})
    restored = {"schedules": 0, "tasks": 0, "feishu_record_mapping": 0}

    from db import get_db
    conn = get_db()

    try:
        # 1) 先清理当前可能残留的排班行（按 id 删除再 INSERT 是最干净的方式）
        schedule_ids = [int(s["id"]) for s in data.get("schedules", []) if s.get("id")]
        task_ids = list(set(int(t["id"]) for t in data.get("tasks", []) if t.get("id")))

        # 2) 恢复 schedules
        for s in data.get("schedules", []):
            cols = list(s.keys())
            vals = [s[c] for c in cols]
            placeholders = ", ".join("?" * len(cols))
            col_names = ", ".join(cols)
            conn.execute(
                f"INSERT OR REPLACE INTO schedules ({col_names}) VALUES ({placeholders})",
                vals,
            )
            restored["schedules"] += 1

        # 3) 恢复 tasks（只恢复状态，不覆盖可能已被其他操作修改的字段）
        for t in data.get("tasks", []):
            tid = int(t["id"])
            conn.execute("UPDATE tasks SET status=? WHERE id=?", (t.get("status", "待分配"), tid))
            restored["tasks"] += 1

        # 4) 恢复 feishu_record_mapping
        for m in data.get("feishu_record_mapping", []):
            conn.execute(
                "INSERT OR REPLACE INTO feishu_record_mapping (schedule_id, machine_id, feishu_record_id) VALUES (?, ?, ?)",
                (int(m["schedule_id"]), int(m["machine_id"]), m["feishu_record_id"]),
            )
            restored["feishu_record_mapping"] += 1

        # 5) 对每台涉及的机器做 timeline 归一化
        machine_dates = set()
        for s in data.get("schedules", []):
            if s.get("machine_id") and s.get("date"):
                machine_dates.add((int(s["machine_id"]), s["date"]))
        from utils import normalize_machine_schedule
        for mid, date in machine_dates:
            normalize_machine_schedule(conn, date, mid)

        conn.commit()
    except Exception as e:
        conn.rollback()
        conn.close()
        return False, f"恢复失败: {str(e)[:100]}", restored
    finally:
        if conn:
            conn.close()

    # 删除快照文件
    os.remove(path)
    # 更新索引
    idx_path = _index_path(session_id)
    if os.path.exists(idx_path):
        index = _read_json(idx_path)
        index = [i for i in index if i["snapshot_id"] != snapshot_id]
        if index:
            _write_json(idx_path, index)
        else:
            os.remove(idx_path)

    return True, f"已恢复 {restored['schedules']} 条排班、{restored['tasks']} 个任务", restored


# ========== 会话清理 ==========

def cleanup_session(session_id):
    """删除整个会话的 undo 目录"""
    import shutil
    s_dir = _session_dir(session_id)
    if os.path.isdir(s_dir):
        shutil.rmtree(s_dir)


def cleanup_orphans():
    """扫描并清理超过超时时间的孤儿 session 目录"""
    _ensure_undo_dir()
    now = datetime.datetime.now()
    for name in os.listdir(UNDO_DIR):
        s_dir = os.path.join(UNDO_DIR, name)
        if not os.path.isdir(s_dir):
            continue
        idx_path = _index_path(name)
        if os.path.exists(idx_path):
            try:
                mtime = os.path.getmtime(idx_path)
                age = (now - datetime.datetime.fromtimestamp(mtime)).total_seconds()
                if age > ORPHAN_TIMEOUT_SEC:
                    import shutil
                    shutil.rmtree(s_dir)
            except OSError:
                pass
        else:
            # 无索引文件 → 可能是损坏的目录，检查修改时间
            try:
                mtime = os.path.getmtime(s_dir)
                age = (now - datetime.datetime.fromtimestamp(mtime)).total_seconds()
                if age > ORPHAN_TIMEOUT_SEC:
                    import shutil
                    shutil.rmtree(s_dir)
            except OSError:
                pass
