# -*- coding: utf-8 -*-
"""飞书机器配置表同步"""
import time
from db import get_db
from feishu.common import (
    _feishu_data, _feishu_raw, _feishu_request,
    _batch_create_records, _batch_update_records, _batch_delete_records,
    _parse_feishu_text,
    _get_app_token, MACHINE_CONFIG_TABLE,
)

CONFIG_TABLE_FIELDS = [
    {"field_name": "机器名", "type": 1, "ui_type": "Text"},
    {"field_name": "机型", "type": 1, "ui_type": "Text"},
    {"field_name": "分组名", "type": 1, "ui_type": "Text"},
    {"field_name": "任务类型", "type": 1, "ui_type": "Text"},
    {"field_name": "状态", "type": 3, "ui_type": "SingleSelect",
     "property": {"options": [
         {"name": "运行中", "color": 1},
         {"name": "维修停用", "color": 2},
         {"name": "空闲", "color": 3},
     ]}},
    {"field_name": "备注", "type": 1, "ui_type": "Text"},
]

STATUS_TRANSLATE = {
    "工作": "运行中",
    "空闲": "空闲",
    "维修停用": "维修停用",
}


def ensure_config_table_fields(table_id):
    """检查机器配置表字段完整性，缺字段则补加。返回缺失的字段名列表。"""
    data = _feishu_data("GET", f"/apps/{_get_app_token()}/tables/{table_id}/fields")
    if not data:
        return ["API error: no data returned"]

    existing_names = {f["field_name"] for f in data.get("items", [])}
    expected_names = {f["field_name"] for f in CONFIG_TABLE_FIELDS}
    missing = [n for n in expected_names if n not in existing_names]

    if not missing:
        return []

    missing_defs = [dict(f) for f in CONFIG_TABLE_FIELDS if f["field_name"] in missing]
    for fdef in missing_defs:
        _feishu_request("POST", f"/apps/{_get_app_token()}/tables/{table_id}/fields", {"field": fdef})
        time.sleep(0.2)

    return missing


def ensure_machine_config_table():
    """确保飞书机器配置表存在。返回 table_id 或 None。"""
    from feishu.table_utils import _find_table_by_name
    existing = _find_table_by_name(MACHINE_CONFIG_TABLE)
    if existing:
        ensure_config_table_fields(existing)
        return existing

    fields = [
        {"field_name": "机器名", "type": 1, "ui_type": "Text"},
        {"field_name": "机型", "type": 1, "ui_type": "Text"},
        {"field_name": "分组名", "type": 1, "ui_type": "Text"},
        {"field_name": "任务类型", "type": 1, "ui_type": "Text"},
        {"field_name": "状态", "type": 3, "ui_type": "SingleSelect",
         "property": {"options": [
             {"name": "运行中", "color": 1},
             {"name": "维修停用", "color": 2},
             {"name": "空闲", "color": 3},
         ]}},
        {"field_name": "备注", "type": 1, "ui_type": "Text"},
    ]
    resp = _feishu_request("POST", f"/apps/{_get_app_token()}/tables", {
        "table": {"name": MACHINE_CONFIG_TABLE, "default_view_name": "默认视图", "fields": fields},
    })
    if resp.get("code") == 0:
        return resp.get("data", {}).get("table_id")
    print(f"[feishu] ensure_machine_config_table 创建失败: code={resp.get('code')} msg={resp.get('msg', '')[:200]}")
    return None


def push_machine_config():
    """同步本地 machines 表到飞书机器配置表。返回变更计数。"""
    from feishu.table_utils import _find_table_by_name
    table_id = _find_table_by_name(MACHINE_CONFIG_TABLE)
    if not table_id:
        return {"error": "Config table not found"}

    ensure_config_table_fields(table_id)

    conn = get_db()
    machines = conn.execute(
        "SELECT id, name, type, status, task_kind, group_name, remark FROM machines ORDER BY sort_order ASC"
    ).fetchall()
    conn.close()

    # 读飞书全量
    feishu_map = {}
    orphan_record_ids = []
    page_token = None
    while True:
        p = f"&page_token={page_token}" if page_token else ""
        data = _feishu_data(
            "GET", f"/apps/{_get_app_token()}/tables/{table_id}/records?page_size=500&automatic_fields=true{p}"
        )
        if data:
            for item in data.get("items", []):
                fname = _parse_feishu_text(item.get("fields", {}).get("机器名"))
                if fname:
                    feishu_map[fname] = item
                elif item.get("record_id"):
                    orphan_record_ids.append(item["record_id"])
        if not data or not data.get("has_more"):
            break
        page_token = data.get("page_token")

    to_create = []
    to_update = []
    matched_names = set()

    for mc in machines:
        name = mc["name"]
        matched_names.add(name)
        raw_status = mc["status"] or ""
        fields = {
            "机器名": name,
            "机型": mc["type"] or "",
            "分组名": mc["group_name"] or "",
            "任务类型": mc["task_kind"] or "",
            "状态": STATUS_TRANSLATE.get(raw_status, raw_status),
            "备注": mc["remark"] or "",
        }
        if name in feishu_map:
            to_update.append({
                "record_id": feishu_map[name]["record_id"],
                "fields": fields,
            })
        else:
            to_create.append({"fields": fields})

    to_delete = [
        feishu_map[n]["record_id"] for n in feishu_map if n not in matched_names
    ] + orphan_record_ids

    created, _rids, ce = _batch_create_records(table_id, to_create)
    updated, ue = _batch_update_records(table_id, to_update)
    deleted, de = _batch_delete_records(table_id, to_delete)

    result = {"created": created, "updated": updated, "deleted": deleted}
    errors = ce + ue + de
    if errors:
        result["errors"] = errors
    return result
