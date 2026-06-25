# -*- coding: utf-8 -*-
"""飞书机器分组表同步"""
import time
from db import get_db
from feishu.common import (
    _feishu_data, _feishu_request,
    _batch_create_records, _batch_delete_records,
    _parse_feishu_text,
    _get_app_token, GROUPS_TABLE,
)
from feishu.table_utils import _find_table_by_name

GROUPS_TABLE_FIELDS = [
    {"field_name": "分组名", "type": 1, "ui_type": "Text"},
    {"field_name": "白班负责人", "type": 11, "ui_type": "User"},
    {"field_name": "夜班负责人", "type": 11, "ui_type": "User"},
    {"field_name": "备注", "type": 1, "ui_type": "Text"},
]


def _ensure_groups_table_fields(table_id):
    """检查分组表字段完整性，缺字段则补加。"""
    data = _feishu_data("GET", f"/apps/{_get_app_token()}/tables/{table_id}/fields")
    if not data:
        return ["API error: no data returned"]

    existing_names = {f["field_name"] for f in data.get("items", [])}
    expected_names = {f["field_name"] for f in GROUPS_TABLE_FIELDS}
    missing = [n for n in expected_names if n not in existing_names]

    if not missing:
        return []

    missing_defs = [dict(f) for f in GROUPS_TABLE_FIELDS if f["field_name"] in missing]
    for fdef in missing_defs:
        _feishu_request("POST", f"/apps/{_get_app_token()}/tables/{table_id}/fields", {"field": fdef})
        time.sleep(0.2)

    return missing


def ensure_groups_table():
    """确保飞书机器分组表存在。返回 table_id 或 None。"""
    existing = _find_table_by_name(GROUPS_TABLE)
    if existing:
        _ensure_groups_table_fields(existing)
        return existing

    fields = [
        {"field_name": "分组名", "type": 1, "ui_type": "Text"},
        {"field_name": "白班负责人", "type": 11, "ui_type": "User"},
        {"field_name": "夜班负责人", "type": 11, "ui_type": "User"},
        {"field_name": "备注", "type": 1, "ui_type": "Text"},
    ]
    resp = _feishu_request("POST", f"/apps/{_get_app_token()}/tables", {
        "table": {"name": GROUPS_TABLE, "default_view_name": "默认视图", "fields": fields},
    })
    if resp.get("code") == 0:
        return resp.get("data", {}).get("table_id")
    print(f"[feishu] ensure_groups_table 创建失败: code={resp.get('code')} msg={resp.get('msg', '')[:200]}")
    return None


def _parse_feishu_user(val):
    """解析飞书 User 字段，返回所有 open_id，逗号分隔。
    格式: [{"id":"ou_xxx","name":"张三"}, {"id":"ou_yyy","name":"李四"}, ...]"""
    if val is None:
        return ""
    if isinstance(val, list) and len(val) > 0:
        ids = []
        for item in val:
            if isinstance(item, dict):
                uid = item.get("id", "")
                if uid:
                    ids.append(uid)
            elif isinstance(item, str):
                ids.append(item)
        return ",".join(ids)
    return ""


def _build_local_snapshot():
    """构建本地快照：{分组名: [机器名列表]} + 分组备注"""
    conn = get_db()
    groups_rows = conn.execute("SELECT name, remark FROM groups ORDER BY name").fetchall()
    group_names = [r["name"] for r in groups_rows]
    group_remarks = {r["name"]: r["remark"] for r in groups_rows}

    group_machines = {}
    for gname in group_names:
        machines = conn.execute(
            "SELECT name FROM machines WHERE group_name=? ORDER BY name",
            (gname,)
        ).fetchall()
        group_machines[gname] = [m["name"] for m in machines]
    conn.close()
    return group_names, group_machines, group_remarks


def _build_feishu_snapshot():
    """构建飞书快照：{分组名: {"record_id": ..., "day_leader": ..., "night_leader": ...}}"""
    table_id = _find_table_by_name(GROUPS_TABLE)
    if not table_id:
        return {}, None

    feishu_map = {}
    page_token = None
    while True:
        p = f"&page_token={page_token}" if page_token else ""
        data = _feishu_data(
            "GET", f"/apps/{_get_app_token()}/tables/{table_id}/records?page_size=500&automatic_fields=true{p}"
        )
        if data:
            for item in data.get("items", []):
                fields = item.get("fields", {})
                gname = _parse_feishu_text(fields.get("分组名"))
                if gname:
                    feishu_map[gname] = {
                        "record_id": item["record_id"],
                        "day_leader": _parse_feishu_user(fields.get("白班负责人")),
                        "night_leader": _parse_feishu_user(fields.get("夜班负责人")),
                    }
        if not data or not data.get("has_more"):
            break
        page_token = data.get("page_token")

    return feishu_map, table_id


def sync_groups():
    """同步机器分组表：结构变→清空重推；结构不变→只拉负责人。
    返回 dict: {"action": "pull_leaders"|"rebuild", ...}
    """
    from feishu.status import write_event

    # 0. 回填：确保 config 中的分组已同步到 groups 表
    conn0 = get_db()
    config_groups = conn0.execute(
        "SELECT key FROM config WHERE category='machine_groups'"
    ).fetchall()
    for cg in config_groups:
        conn0.execute(
            "INSERT OR IGNORE INTO groups (name) VALUES (?)", (cg["key"],)
        )
    conn0.commit()
    conn0.close()

    # 1. 确保表存在
    table_id = ensure_groups_table()
    if not table_id:
        write_event("warn", "", "分组表不存在且创建失败")
        return {"error": "Groups table not found and could not be created"}

    _ensure_groups_table_fields(table_id)

    # 2. 构建双端快照
    local_names, local_machines, local_remarks = _build_local_snapshot()
    feishu_map, _ = _build_feishu_snapshot()

    feishu_names = sorted(feishu_map.keys())

    # 3. 判断结构是否变化
    if local_names != feishu_names:
        # === 分支 A：分组名列表不同 → 清空飞书表，全量重推 ===
        write_event("info", "", "分组结构变化，清空飞书分组表并重推")

        # 删除所有现有记录
        all_record_ids = [v["record_id"] for v in feishu_map.values()]
        if all_record_ids:
            _batch_delete_records(table_id, all_record_ids)
            time.sleep(0.3)

        # 全量推送本地分组
        to_create = []
        for gname in local_names:
            to_create.append({"fields": {
                "分组名": gname,
                "备注": local_remarks.get(gname, ""),
                # 负责人留空，等飞书端填写
            }})

        if to_create:
            created, _, errors = _batch_create_records(table_id, to_create)
            if errors:
                write_event("warn", "", "分组表重推错误: {}".format(str(errors)[:100]))

        write_event("info", "", "分组表重推完成: {} 个分组".format(len(local_names)))
        return {"action": "rebuild", "groups_pushed": len(local_names)}

    else:
        # === 分支 B：结构一致 → 只拉取负责人 ===
        updated = 0
        conn = get_db()
        for gname, feishu_info in feishu_map.items():
            day = feishu_info.get("day_leader", "")
            night = feishu_info.get("night_leader", "")

            existing = conn.execute(
                "SELECT day_leader, night_leader FROM groups WHERE name=?",
                (gname,)
            ).fetchone()

            if existing:
                if day != existing["day_leader"] or night != existing["night_leader"]:
                    conn.execute(
                        "UPDATE groups SET day_leader=?, night_leader=? WHERE name=?",
                        (day, night, gname),
                    )
                    updated += 1
        conn.commit()
        conn.close()

        if updated > 0:
            write_event("info", "", "从飞书拉取负责人更新: {} 个分组".format(updated))

        return {"action": "pull_leaders", "leaders_updated": updated}
