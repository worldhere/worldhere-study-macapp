# -*- coding: utf-8 -*-
"""飞书表管理工具：建表、查表、字段管理、表定义"""
import json
import time
from db import get_db
from feishu.common import (
    _feishu_data, _feishu_raw, _feishu_request,
    _get_app_token, WHITELIST_TABLES,
)

# 18字段定义（建表用）
TABLE_FIELDS = [
    {"field_name": "任务名", "type": 1, "ui_type": "Text"},
    {"field_name": "所属来源", "type": 1, "ui_type": "Text"},
    {"field_name": "任务类型", "type": 1, "ui_type": "Text"},
    {"field_name": "优先级", "type": 1, "ui_type": "Text"},
    {"field_name": "难度", "type": 1, "ui_type": "Text"},
    {"field_name": "排班开始", "type": 5, "ui_type": "DateTime",
     "property": {"auto_fill": False, "date_formatter": "yyyy/MM/dd HH:mm"}},
    {"field_name": "排班结束", "type": 5, "ui_type": "DateTime",
     "property": {"auto_fill": False, "date_formatter": "yyyy/MM/dd HH:mm"}},
    {"field_name": "排班时长", "type": 1, "ui_type": "Text"},
    {"field_name": "实际开始", "type": 5, "ui_type": "DateTime",
     "property": {"auto_fill": False, "date_formatter": "yyyy/MM/dd HH:mm"}},
    {"field_name": "实际结束", "type": 5, "ui_type": "DateTime",
     "property": {"auto_fill": False, "date_formatter": "yyyy/MM/dd HH:mm"}},
    {"field_name": "状态", "type": 3, "ui_type": "SingleSelect",
     "property": {"options": [
         {"name": "待开始", "color": 7},
         {"name": "采集中", "color": 2},
         {"name": "采集即将完成", "color": 3},
         {"name": "暂停中", "color": 4},
         {"name": "暂停即将超时", "color": 5},
         {"name": "过时待确认", "color": 6},
         {"name": "已完成", "color": 0}]}},
    {"field_name": "排班备注", "type": 1, "ui_type": "Text"},
    {"field_name": "异常标记", "type": 3, "ui_type": "SingleSelect",
     "property": {"options": [
         {"name": "正常", "color": 1}, {"name": "机器故障", "color": 2},
         {"name": "缺少物料", "color": 3}, {"name": "无法执行", "color": 4}]}},
    {"field_name": "异常备注", "type": 1, "ui_type": "Text"},
    {"field_name": "异常耗时", "type": 1, "ui_type": "Text"},
    {"field_name": "预估时段", "type": 1, "ui_type": "Text"},
    {"field_name": "预估时长", "type": 1, "ui_type": "Text"},
    {"field_name": "采集员", "type": 11, "ui_type": "User",
     "property": {"multiple": True}},
    {"field_name": "修改与同步时间", "type": 5, "ui_type": "DateTime",
     "property": {"auto_fill": False, "date_formatter": "yyyy/MM/dd HH:mm"}},
]

SYSTEM_FIELDS = {"任务名", "所属来源", "任务类型", "优先级", "难度",
                 "排班开始", "排班结束", "预估时长", "状态",
                 "异常耗时"}
USER_FIELDS = {"排班备注", "异常备注", "采集员"}
LOCAL_USER_FIELDS = {"异常标记": "exception_mark", "异常备注": "exception_note",
                     "预估时段": "estimated_window"}


def _build_exception_options_property():
    """从 config 表读取异常标记选项，构造单选字段 options"""
    raw = None
    try:
        conn = get_db()
        row = conn.execute(
            "SELECT value FROM config WHERE category='feishu' AND key='exception_options'"
        ).fetchone()
        conn.close()
        if row:
            raw = row["value"]
    except Exception:
        pass

    if not raw:
        raw = '["正常", "机器故障", "缺少物料", "无法执行"]'

    try:
        options = json.loads(raw)
    except json.JSONDecodeError:
        options = ["正常", "机器故障", "缺少物料", "无法执行"]

    colors = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    return {"options": [{"name": opt, "color": colors[i % len(colors)]}
                        for i, opt in enumerate(options)]}


def _find_table_by_name(name):
    """在 Base 中按名称查找表格（仅精确匹配，支持分页）。返回 table_id 或 None。"""
    page_token = None
    while True:
        p = f"&page_token={page_token}" if page_token else ""
        data = _feishu_data("GET", f"/apps/{_get_app_token()}/tables?page_size=200{p}")
        if not data:
            return None
        for item in data.get("items", []):
            if item.get("name") == name:
                return item.get("table_id")
        if not data.get("has_more"):
            break
        page_token = data.get("page_token")
    return None


def _fetch_all_tables_snapshot():
    """一次性分页拉取 Base 全部表。
    返回 (snapshot: {name: table_id}, conflicts: [(name, table_id), ...])
    snapshot 不含 _conflict 表和白名单表。
    """
    snapshot = {}
    conflicts = []
    page_token = None
    while True:
        p = f"&page_token={page_token}" if page_token else ""
        data = _feishu_data("GET", f"/apps/{_get_app_token()}/tables?page_size=200{p}")
        if not data:
            break
        for item in data.get("items", []):
            name = item.get("name", "")
            tid = item.get("table_id", "")
            if not name or not tid:
                continue
            if "_conflict" in name:
                conflicts.append((name, tid))
            elif name not in WHITELIST_TABLES:
                snapshot[name] = tid
        if not data.get("has_more"):
            break
        page_token = data.get("page_token")
    return snapshot, conflicts


def _lookup_table_name(table_id):
    """从列表接口查找指定 table_id 的表名。找不到返回 None。"""
    data = _feishu_data("GET", f"/apps/{_get_app_token()}/tables")
    for item in data.get("items", []):
        if item.get("table_id") == table_id:
            return item.get("name")
    return None


def _create_table(machine_name):
    """建表 + 名校验：POST 创建飞书表，验证返回的表名与期望一致。
    飞书可能因重名自动改名（如 BR1-02 → BR1-02 (1)），此时删掉改名表并重试。
    返回 (table_id, None) 或 (None, error_msg)。
    """
    fields = []
    for f in TABLE_FIELDS:
        fcopy = dict(f)
        if fcopy["field_name"] == "异常标记":
            fcopy["property"] = _build_exception_options_property()
        fields.append(fcopy)

    payload = {
        "table": {
            "name": machine_name,
            "default_view_name": "默认视图",
            "fields": fields,
        }
    }

    for attempt in range(3):
        resp = _feishu_request("POST", f"/apps/{_get_app_token()}/tables", payload)
        code = resp.get("code")
        if code == 0:
            table_id = resp.get("data", {}).get("table_id")
            if not table_id:
                continue
            actual_name = _lookup_table_name(table_id)
            if actual_name == machine_name:
                return table_id, None
            if actual_name:
                _feishu_raw("DELETE", f"/apps/{_get_app_token()}/tables/{table_id}")
                time.sleep(0.5)
                continue
            return table_id, None
        if code == 1254013:
            return None, "table name conflict"
        # 记录非重试错误的关键信息
        print(f"[feishu] _create_table({machine_name}) attempt {attempt+1}/3 failed: code={code} msg={resp.get('msg', '')[:150]}")
        time.sleep(0.5)

    print(f"[feishu] _create_table({machine_name}) failed after 3 retries")
    return None, "Failed after 3 retries"


def ensure_table_fields(table_id):
    """检查飞书表字段完整性，缺字段则补加。返回 (fixed_list, failed_list)。"""
    # 分页拉取全部字段（默认 page_size=10 不够 18 字段用）
    all_items = []
    page_token = None
    while True:
        p = f"&page_token={page_token}" if page_token else ""
        raw = _feishu_raw("GET", f"/apps/{_get_app_token()}/tables/{table_id}/fields?page_size=100{p}")
        if raw.get("code") != 0:
            err_code = raw.get("code", -1)
            err_msg = raw.get("msg", "no data returned")[:150]
            return [], [(f"API error ({err_code})", err_code, err_msg)]
        data = raw.get("data", {})
        all_items.extend(data.get("items", []))
        if not data.get("has_more"):
            break
        page_token = data.get("page_token")

    existing_names = {f["field_name"] for f in all_items}
    expected_names = {f["field_name"] for f in TABLE_FIELDS}
    missing = [n for n in expected_names if n not in existing_names]

    if not missing:
        return [], []

    missing_defs = [dict(f) for f in TABLE_FIELDS if f["field_name"] in missing]
    for fdef in missing_defs:
        if fdef["field_name"] == "异常标记":
            fdef["property"] = _build_exception_options_property()

    fixed = []
    failed = []
    for fdef in missing_defs:
        resp = _feishu_request("POST", f"/apps/{_get_app_token()}/tables/{table_id}/fields", fdef)
        if resp.get("code") == 0:
            fixed.append(fdef["field_name"])
        else:
            failed.append((fdef["field_name"], resp.get("code"), resp.get("msg", "")[:100]))
            print(f"[feishu] ensure_table_fields: 创建字段 {fdef['field_name']} 失败: code={resp.get('code')} {resp.get('msg', '')[:100]}")
        time.sleep(0.2)

    return fixed, failed
