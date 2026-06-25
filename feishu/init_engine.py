# -*- coding: utf-8 -*-
"""飞书增量初始化引擎：建表、字段补齐、推送、清理"""
import time
from db import get_db
from feishu.common import (
    _feishu_data, _feishu_raw, _feishu_request, _get_app_token,
)


def incremental_init(init_lock, init_cancel):
    """增量初始化：只建缺失的表，不删已有的正常表。

    参数:
        init_lock: threading.Lock 实例（来自 sync_loop），防止并发初始化
        init_cancel: threading.Event 实例（来自 sync_loop），用户取消标志
    """
    import feishu.status as status_mod

    if not init_lock.acquire(blocking=False):
        return {"error": "初始化正在进行中，请稍后再试"}

    try:
        conn = get_db()
        machines = conn.execute(
            "SELECT id, name FROM machines ORDER BY sort_order ASC"
        ).fetchall()
        conn.close()
        status_mod.set_active_operation({"type": "init", "total": len(machines), "done": 0,
                                        "phase": 1, "phase_total": 2, "phase_label": "建表"})
        status_mod.write_event("info", "", "开始初始化 {} 台机器".format(len(machines)))

        result = _incremental_init_impl(init_cancel)

        mapped = result.get("mapped_machines", 0)
        total = result.get("total_machines", 0)
        status_mod.write_event("info", "", "初始化完成: {}/{} 台已映射".format(mapped, total))
        return result
    finally:
        init_cancel.clear()
        status_mod.clear_active_operation()
        init_lock.release()


def _incremental_init_impl(init_cancel):
    import feishu.status as status_mod
    from feishu.table_utils import _fetch_all_tables_snapshot, _create_table, ensure_table_fields
    from feishu.config_table import ensure_machine_config_table, push_machine_config
    from feishu.groups import ensure_groups_table, sync_groups
    from feishu.lifecycle import _upsert_mapping
    from feishu.schedule_sync import push_machine_schedules
    from feishu.status import _is_sync_enabled

    conn = get_db()
    machines = conn.execute(
        "SELECT id, name FROM machines ORDER BY sort_order ASC"
    ).fetchall()
    conn.close()

    result = {
        "total_machines": len(machines),
        "mapped_machines": 0,
        "new_tables_created": 0,
        "skipped_existing": 0,
        "conflicts_deleted": 0,
        "stale_mappings": 0,
        "records_pushed": 0,
    }

    # ==== 0. 确保白名单总表存在 ====
    ensure_machine_config_table()
    ensure_groups_table()
    if init_cancel.is_set():
        result["cancelled"] = True
        return result

    # ==== 1. 获取线上现有表快照，只删冲突表 ====
    snapshot, conflicts = _fetch_all_tables_snapshot()
    for tname, tid in conflicts:
        if init_cancel.is_set(): break
        _feishu_raw("DELETE", f"/apps/{_get_app_token()}/tables/{tid}")
        result["conflicts_deleted"] += 1
        time.sleep(0.15)
    if init_cancel.is_set():
        result["cancelled"] = True
        return result
    # 构建 {table_id: table_name} 反查表
    online_table_ids = {tid: tname for tname, tid in snapshot.items()}

    # ==== 2. 获取本地已有映射 ====
    conn2 = get_db()
    existing = {}
    base_changed = False
    current_app_token = _get_app_token()
    rows = conn2.execute(
        "SELECT machine_id, machine_name, table_id, app_token FROM feishu_sync_mapping"
    ).fetchall()
    for r in rows:
        existing[r["machine_id"]] = {"name": r["machine_name"], "table_id": r["table_id"],
                                      "app_token": r["app_token"]}
        if r["app_token"] and r["app_token"] != current_app_token:
            base_changed = True
    conn2.close()

    if base_changed:
        status_mod.write_event("info", "",
            "检测到飞书 Base 已变更 ({} → {})，将重建所有映射".format(
                rows[0]["app_token"][:8] if rows else "?", current_app_token[:8]))

    # ==== 3. 为每台机器检查是否需要建表（已存在则跳过）====
    machine_ids = {mc["id"] for mc in machines}

    for mc in machines:
        mid = mc["id"]
        mname = mc["name"]
        existing_info = existing.get(mid)

        # 已有映射且在飞书端存在 -> 跳过，不删不建
        if existing_info and existing_info["table_id"] in online_table_ids:
            result["skipped_existing"] += 1
            result["mapped_machines"] += 1
            # 确保 app_token 与当前 Base 同步（换 Base 又换回来后需要）
            if existing_info.get("app_token") != current_app_token:
                conn_upd = get_db()
                conn_upd.execute(
                    "UPDATE feishu_sync_mapping SET app_token=? WHERE machine_id=?",
                    (current_app_token, mid))
                conn_upd.commit()
                conn_upd.close()
            if status_mod._active_operation:
                status_mod._active_operation["done"] = status_mod._active_operation["done"] + 1
            status_mod.write_event("info", mname, "已存在，跳过")
            continue

        # 映射指向的表已在飞书端消失 -> 建新表
        if init_cancel.is_set(): break
        table_id, err = _create_table(mname)
        if not table_id:
            status_mod.write_event("error", mname, "建表失败: {}".format(err or "未知错误"))
            if status_mod._active_operation:
                status_mod._active_operation["done"] = status_mod._active_operation["done"] + 1
            continue
        _upsert_mapping(mid, mname, table_id)
        result["new_tables_created"] += 1
        result["mapped_machines"] += 1
        if status_mod._active_operation:
            status_mod._active_operation["done"] = status_mod._active_operation["done"] + 1
        status_mod.write_event("info", mname, "建表完成")
        time.sleep(0.5)
    if init_cancel.is_set():
        result["cancelled"] = True
        return result

    # ==== 3.5 确保所有已映射表的字段完整性（缺字段补加）====
    conn3a = get_db()
    all_mappings_check = conn3a.execute(
        "SELECT machine_id, machine_name, table_id FROM feishu_sync_mapping"
    ).fetchall()
    conn3a.close()
    for m in all_mappings_check:
        if init_cancel.is_set(): break
        try:
            fixed, failed = ensure_table_fields(m["table_id"])
            if fixed and not (len(fixed) == 1 and "API error" in fixed[0]):
                result.setdefault("fields_fixed", {})[m["machine_name"]] = fixed
            if failed:
                result.setdefault("fields_failed", {})[m["machine_name"]] = [f"{n}({c})" for n, c, _ in failed]
        except Exception:
            pass

    # ==== 4. 推数据到所有已映射机器 ====
    conn3 = get_db()
    all_mappings = conn3.execute(
        "SELECT machine_id, machine_name FROM feishu_sync_mapping"
    ).fetchall()
    conn3.close()
    # 切换到阶段 2（推送）
    if status_mod._active_operation and all_mappings:
        status_mod._active_operation["phase"] = 2
        status_mod._active_operation["phase_label"] = "推送"
        status_mod._active_operation["total"] = status_mod._active_operation["total"] + len(all_mappings)
        status_mod.set_active_operation(status_mod._active_operation)  # broadcast phase change
    for m in all_mappings:
        if init_cancel.is_set(): break
        try:
            push_result = push_machine_schedules(m["machine_id"])
            if not push_result.get("error") and not push_result.get("skipped"):
                result["records_pushed"] += (
                    push_result.get("created", 0) + push_result.get("updated", 0)
                )
            if status_mod._active_operation:
                status_mod._active_operation["done"] = status_mod._active_operation["done"] + 1
            status_mod.write_event("info", m["machine_name"], "推送完成")
        except Exception:
            if status_mod._active_operation:
                status_mod._active_operation["done"] = status_mod._active_operation["done"] + 1
            pass
        time.sleep(0.3)

    # ==== 5. 推送机器配置表 ====
    if _is_sync_enabled():
        try:
            push_machine_config()
        except Exception:
            pass

    # ==== 5.5 推送分组表 ====
    if _is_sync_enabled():
        try:
            sync_groups()
        except Exception:
            pass

    # ==== 6. 清理飞书端孤立表 + 废弃本地映射 ====
    conn4 = get_db()
    # 收集当前所有有效映射的 table_id
    valid_mappings = conn4.execute(
        "SELECT machine_id, table_id FROM feishu_sync_mapping"
    ).fetchall()
    valid_table_ids = {m["table_id"] for m in valid_mappings}

    # 6a. 删飞书端孤立表：在线上但没有任何本地映射指向它
    for tid, tname in online_table_ids.items():
        if tid not in valid_table_ids:
            _feishu_raw("DELETE", f"/apps/{_get_app_token()}/tables/{tid}")
            result["stale_mappings"] += 1
            time.sleep(0.15)

    # 6b. 删本地废弃映射：映射指向的机器已不存在
    for s in valid_mappings:
        if s["machine_id"] not in machine_ids:
            _feishu_raw("DELETE", f"/apps/{_get_app_token()}/tables/{s['table_id']}")
            conn4.execute(
                "DELETE FROM feishu_sync_mapping WHERE machine_id=?",
                (s["machine_id"],),
            )
            # 同时清理 record_mapping
            conn4.execute(
                "DELETE FROM feishu_record_mapping WHERE machine_id=?",
                (s["machine_id"],),
            )
            result["stale_mappings"] += 1
    conn4.commit()
    conn4.close()

    return result


def auto_fix_missing_mappings():
    """轻量级自动修复：为缺失飞书映射的机器建表（供同步循环使用）。
    不需要 init_lock，不影响正在运行的初始化。
    同时检测 app_token 不匹配的旧映射并重建。
    返回 {fixed: int, failed: int, fixed_list: [...], failed_list: [...]}
    """
    from feishu.table_utils import _create_table
    from feishu.lifecycle import _upsert_mapping
    from feishu.common import _get_app_token as _current_app_token

    conn = get_db()
    machines = conn.execute(
        "SELECT id, name FROM machines ORDER BY sort_order ASC"
    ).fetchall()
    mapping_rows = conn.execute(
        "SELECT machine_id, app_token, table_id FROM feishu_sync_mapping"
    ).fetchall()
    conn.close()

    current_token = _current_app_token()
    # machine_id → {app_token, table_id}
    mapped = {r["machine_id"]: {"app_token": r["app_token"], "table_id": r["table_id"]}
              for r in mapping_rows}

    fixed = []
    failed = []
    for m in machines:
        mid = m["id"]
        info = mapped.get(mid)

        # 有映射且 app_token 匹配 → 跳过
        if info and info["app_token"] == current_token:
            continue

        # 无映射 或 app_token 不匹配（换了新 Base）→ 建新表
        if info and info["app_token"] != current_token:
            import feishu.status as status_mod
            status_mod.write_event("info", m["name"],
                "Base 已变更，为机器重建映射 (旧: {}…)".format(info["app_token"][:8]))

        table_id, err = _create_table(m["name"])
        if table_id:
            _upsert_mapping(mid, m["name"], table_id)
            fixed.append({"machine_id": mid, "machine_name": m["name"], "table_id": table_id})
        else:
            failed.append({"machine_id": mid, "machine_name": m["name"], "error": str(err)[:100]})

    return {
        "fixed": len(fixed),
        "failed": len(failed),
        "fixed_list": fixed,
        "failed_list": failed,
    }
