# -*- coding: utf-8 -*-
"""飞书机器生命周期钩子：增/删/改名 同步到飞书端"""
from db import get_db
from feishu.common import (
    _feishu_data, _feishu_raw, _feishu_request, _get_app_token,
)


def _upsert_mapping(machine_id, machine_name, table_id):
    conn = get_db()
    existing = conn.execute(
        "SELECT id FROM feishu_sync_mapping WHERE machine_id=?", (machine_id,)
    ).fetchone()
    if existing:
        conn.execute(
            "UPDATE feishu_sync_mapping SET machine_name=?, table_id=?, app_token=? WHERE machine_id=?",
            (machine_name, table_id, _get_app_token(), machine_id),
        )
    else:
        conn.execute(
            "INSERT INTO feishu_sync_mapping(machine_id, machine_name, app_token, table_id) "
            "VALUES (?,?,?,?)",
            (machine_id, machine_name, _get_app_token(), table_id),
        )
    conn.commit()
    conn.close()


def on_machine_created(machine_id, machine_name):
    """新增机器时创建飞书表并记录映射。失败不抛异常。"""
    from feishu.status import _is_sync_enabled
    if not _is_sync_enabled():
        return
    try:
        from feishu.table_utils import _create_table
        table_id, err = _create_table(machine_name)
        if table_id:
            _upsert_mapping(int(machine_id), machine_name, table_id)
    except Exception:
        pass


def on_machine_renamed(machine_id, new_name):
    """机器改名时删旧飞书表→建新表→重推数据。PATCH API 不支持重命名。"""
    from feishu.status import _is_sync_enabled
    if not _is_sync_enabled():
        return
    try:
        conn = get_db()
        mapping = conn.execute(
            "SELECT table_id FROM feishu_sync_mapping WHERE machine_id=?", (int(machine_id),)
        ).fetchone()
        conn.close()
        if mapping:
            # 飞书不允许删 Base 里最后一张表 → 先建临时表占位
            import time as _time
            from feishu.common import _feishu_data
            tables_data = _feishu_data("GET", f"/apps/{_get_app_token()}/tables?page_size=5")
            table_count = len(tables_data.get("items", []))
            temp_table_id = None
            if table_count <= 1:
                from feishu.common import _feishu_request
                resp = _feishu_request("POST", f"/apps/{_get_app_token()}/tables", {
                    "table": {"name": "_temp_rename_placeholder", "default_view_name": "默认视图",
                              "fields": [{"field_name": "占位", "type": 1}]}
                })
                if resp.get("code") == 0:
                    temp_table_id = resp.get("data", {}).get("table_id")
                    _time.sleep(0.3)

            # 删旧表
            _feishu_raw("DELETE", f"/apps/{_get_app_token()}/tables/{mapping['table_id']}")

            # 建新表
            from feishu.table_utils import _create_table
            new_table_id, err = _create_table(new_name)
            if new_table_id:
                from feishu.lifecycle import _upsert_mapping
                _upsert_mapping(int(machine_id), new_name, new_table_id)
                from feishu.schedule_sync import push_machine_schedules
                push_machine_schedules(int(machine_id))

            # 清理临时占位表
            if temp_table_id:
                _feishu_raw("DELETE", f"/apps/{_get_app_token()}/tables/{temp_table_id}")
    except Exception:
        pass


def on_machine_deleted(machine_id):
    """删除机器时清理飞书表和映射。失败不抛异常。"""
    try:
        conn = get_db()
        mapping = conn.execute(
            "SELECT table_id FROM feishu_sync_mapping WHERE machine_id=?", (int(machine_id),)
        ).fetchone()
        conn.close()
        if mapping:
            # 飞书不允许删 Base 里最后一张表 → 先建临时表占位
            import time as _time
            from feishu.common import _feishu_data, _feishu_request
            tables_data = _feishu_data("GET", f"/apps/{_get_app_token()}/tables?page_size=5")
            table_count = len(tables_data.get("items", []))
            temp_table_id = None
            if table_count <= 1:
                resp = _feishu_request("POST", f"/apps/{_get_app_token()}/tables", {
                    "table": {"name": "_temp_delete_placeholder", "default_view_name": "默认视图",
                              "fields": [{"field_name": "占位", "type": 1}]}
                })
                if resp.get("code") == 0:
                    temp_table_id = resp.get("data", {}).get("table_id")
                    _time.sleep(0.3)

            _feishu_raw("DELETE", f"/apps/{_get_app_token()}/tables/{mapping['table_id']}")
            conn = get_db()
            conn.execute("DELETE FROM feishu_sync_mapping WHERE machine_id=?", (int(machine_id),))
            conn.commit()
            conn.close()

            # 清理临时占位表
            if temp_table_id:
                _feishu_raw("DELETE", f"/apps/{_get_app_token()}/tables/{temp_table_id}")
    except Exception:
        pass
