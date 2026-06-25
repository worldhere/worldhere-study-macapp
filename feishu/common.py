# -*- coding: utf-8 -*-
"""飞书同步公共模块：API 请求、token、批处理、常量"""
import time
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
from feishu_token import get_token, refresh_token

BASE_URL = "https://open.feishu.cn/open-apis/bitable/v1"
BATCH_SIZE = 100
ROW_LIMIT = 200

# 白名单表（不被 init/cleanup 删除的持久化总表）
MACHINE_CONFIG_TABLE = "机器配置表"
GROUPS_TABLE = "机器分组表"
WHITELIST_TABLES = {MACHINE_CONFIG_TABLE, GROUPS_TABLE}

_app_token_cache = {"value": None, "loaded": False}


def _get_app_token():
    """从 config 表读取 app_token，带缓存。回退到旧硬编码值。"""
    if _app_token_cache["loaded"]:
        return _app_token_cache["value"]
    try:
        from db import get_db
        conn = get_db()
        row = conn.execute(
            "SELECT value FROM config WHERE category='feishu' AND key='app_token'"
        ).fetchone()
        conn.close()
        _app_token_cache["value"] = (
            row["value"].strip() if row and row["value"].strip()
            else "I7IzbOlscajHJZscWOtcYcs6nLf"
        )
    except Exception:
        _app_token_cache["value"] = "I7IzbOlscajHJZscWOtcYcs6nLf"
        print("[feishu] WARNING: 无法从数据库读取 App Token，使用硬编码默认值！请检查配置。")
    _app_token_cache["loaded"] = True
    return _app_token_cache["value"]


def invalidate_app_token_cache():
    """凭证更新后清除缓存"""
    _app_token_cache["loaded"] = False
    _app_token_cache["value"] = None

_session = requests.Session()
_session.mount("https://", requests.adapters.HTTPAdapter(pool_connections=20, pool_maxsize=20))


def _feishu_data(method, path, json_data=None, retry_count=3):
    """飞书 API 请求，返回响应中的 data 字段（已解包）。失败时返回空 dict。"""
    resp = _feishu_request(method, path, json_data, retry_count)
    if resp.get("code") == 0:
        return resp.get("data", {})
    return {}


def _feishu_raw(method, path, json_data=None, retry_count=3):
    """飞书 API 请求，返回完整响应体。"""
    return _feishu_request(method, path, json_data, retry_count)


def _feishu_request(method, path, json_data=None, retry_count=3):
    """带 token 管理和重试的飞书 API 请求"""
    url = f"{BASE_URL}{path}"
    token = get_token()
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    for attempt in range(retry_count):
        try:
            if method == "GET":
                resp = _session.get(url, headers=headers, timeout=15)
            elif method == "POST":
                resp = _session.post(url, headers=headers, json=json_data, timeout=15)
            elif method == "DELETE":
                resp = _session.delete(url, headers=headers, timeout=15)
            elif method == "PUT":
                resp = _session.put(url, headers=headers, json=json_data, timeout=15)
            else:
                return {"code": -1, "msg": f"Unknown method: {method}"}

            if resp.status_code == 401:
                refresh_token()
                headers["Authorization"] = f"Bearer {get_token()}"
                continue
            if resp.status_code == 429:
                retry_after = int(resp.headers.get("Retry-After", "5"))
                time.sleep(retry_after)
                continue
            if 400 <= resp.status_code < 500:
                return {"code": resp.status_code, "msg": resp.text}
            if resp.status_code >= 500:
                if attempt < retry_count - 1:
                    time.sleep(2 ** attempt)
                    continue
                return {"code": resp.status_code, "msg": resp.text}

            data = resp.json()
            # 飞书 API 级别的 token 失效（HTTP 200 但 code 表示 token 问题）
            if data.get("code") in (99991663, 99991664):
                refresh_token()
                headers["Authorization"] = f"Bearer {get_token()}"
                continue
            return data
        except (requests.Timeout, requests.ConnectionError):
            if attempt < retry_count - 1:
                time.sleep(2 ** attempt)
                continue
            return {"code": -1, "msg": "Network error after retries"}

    return {"code": -1, "msg": "Max retries exceeded"}


# ========== 批量操作 ==========

def _batch_create_records(table_id, records):
    """批量创建记录，超 BATCH_SIZE 条自动分片并发。
    返回 (success_count, record_ids, errors)"""
    if not records:
        return 0, [], []
    chunks = [records[i:i + BATCH_SIZE] for i in range(0, len(records), BATCH_SIZE)]
    total = 0
    all_record_ids = []
    all_errors = []

    def _create_chunk(chunk):
        resp = _feishu_request(
            "POST",
            f"/apps/{_get_app_token()}/tables/{table_id}/records/batch_create",
            {"records": chunk},
        )
        if resp.get("code") == 0:
            rids = [r.get("record_id", "") for r in resp.get("data", {}).get("records", [])]
            return len(chunk), rids, []
        return 0, [], [{"op": "batch_create", "count": len(chunk),
                        "code": resp.get("code"), "msg": resp.get("msg", "")[:200]}]

    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {executor.submit(_create_chunk, c): c for c in chunks}
        for future in as_completed(futures):
            try:
                n, rids, errs = future.result()
                total += n
                all_record_ids.extend(rids)
                all_errors.extend(errs)
            except Exception as e:
                all_errors.append({"op": "batch_create", "error": str(e)[:200]})
    return total, all_record_ids, all_errors


def _batch_update_records(table_id, records):
    """批量更新记录，超 BATCH_SIZE 条自动分片并发。返回 (success_count, errors)"""
    if not records:
        return 0, []
    chunks = [records[i:i + BATCH_SIZE] for i in range(0, len(records), BATCH_SIZE)]
    total = 0
    all_errors = []

    def _update_chunk(chunk):
        resp = _feishu_request(
            "POST",
            f"/apps/{_get_app_token()}/tables/{table_id}/records/batch_update",
            {"records": chunk},
        )
        if resp.get("code") == 0:
            return len(chunk), []
        return 0, [{"op": "batch_update", "count": len(chunk),
                     "code": resp.get("code"), "msg": resp.get("msg", "")[:200]}]

    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {executor.submit(_update_chunk, c): c for c in chunks}
        for future in as_completed(futures):
            try:
                n, errs = future.result()
                total += n
                all_errors.extend(errs)
            except Exception as e:
                all_errors.append({"op": "batch_update", "error": str(e)[:200]})
    return total, all_errors


def _batch_delete_records(table_id, record_ids):
    """批量删除记录，超 BATCH_SIZE 条自动分片并发。返回 (success_count, errors)"""
    if not record_ids:
        return 0, []
    chunks = [record_ids[i:i + BATCH_SIZE] for i in range(0, len(record_ids), BATCH_SIZE)]
    total = 0
    all_errors = []

    def _delete_chunk(chunk):
        resp = _feishu_request(
            "POST",
            f"/apps/{_get_app_token()}/tables/{table_id}/records/batch_delete",
            {"records": chunk},
        )
        if resp.get("code") == 0:
            return len(chunk), []
        return 0, [{"op": "batch_delete", "count": len(chunk),
                     "code": resp.get("code"), "msg": resp.get("msg", "")[:200]}]

    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {executor.submit(_delete_chunk, c): c for c in chunks}
        for future in as_completed(futures):
            try:
                n, errs = future.result()
                total += n
                all_errors.extend(errs)
            except Exception as e:
                all_errors.append({"op": "batch_delete", "error": str(e)[:200]})
    return total, all_errors


def _parse_feishu_text(val):
    """解析飞书文本/单选字段值"""
    if val is None:
        return None
    if isinstance(val, str):
        return val
    if isinstance(val, (int, float)):
        return str(val)
    if isinstance(val, list) and len(val) > 0:
        first = val[0]
        if isinstance(first, dict):
            return first.get("text", "")
        if isinstance(first, str):
            return first
    return None


# ========== 群聊配置读取（供 routes 层复用） ==========

def _parse_chat_ids(raw):
    """纯函数：解析 config 中的 chat_ids 原始值，返回 ID 列表。"""
    import json as _json
    if not raw:
        return []
    if raw.startswith("["):
        try:
            groups = _json.loads(raw)
            return [g["chat_id"] for g in groups if g.get("chat_id")]
        except _json.JSONDecodeError:
            return []
    return [cid.strip() for cid in raw.replace('\r', '\n').split('\n') if cid.strip()]


def _load_chat_ids():
    """从 DB config 读取并解析 chat_ids。返回 (chat_ids: list, error: str|None)。"""
    from db import get_db
    conn = get_db()
    row = conn.execute(
        "SELECT value FROM config WHERE category='feishu_push' AND key='chat_ids'"
    ).fetchone()
    conn.close()
    raw = row["value"].strip() if row else ""
    if not raw:
        return [], "未配置飞书群组"
    chat_ids = _parse_chat_ids(raw)
    if not chat_ids:
        return [], "群聊数据格式错误"
    return chat_ids, None


# ========== IM 消息发送 ==========

IM_BASE_URL = "https://open.feishu.cn/open-apis/im/v1"


def upload_image(png_bytes):
    """上传图片到飞书，返回 image_key 或 None。
    用于发送图片消息前获取 image_key。
    """
    url = f"{IM_BASE_URL}/images"
    token = get_token()
    headers = {"Authorization": f"Bearer {token}"}

    for attempt in range(3):
        try:
            resp = requests.post(url, headers=headers,
                                 files={"image": ("timeline.png", png_bytes, "image/png")},
                                 data={"image_type": "message"},
                                 timeout=30)
            if resp.status_code == 401:
                refresh_token()
                headers["Authorization"] = f"Bearer {get_token()}"
                continue
            if resp.status_code == 429:
                retry_after = int(resp.headers.get("Retry-After", "5"))
                time.sleep(retry_after)
                continue
            data = resp.json()
            if data.get("code") == 0:
                return data["data"]["image_key"]
            print(f"[feishu] upload_image failed: {data.get('msg', 'unknown')[:150]}")
            return None
        except (requests.Timeout, requests.ConnectionError):
            if attempt < 2:
                time.sleep(2 ** attempt)
                continue
            return None
    return None


def send_image_message(chat_id, image_key):
    """向指定群聊发送图片消息。返回 (success: bool, error: str|None)"""
    import json as _json
    url = f"{IM_BASE_URL}/messages?receive_id_type=chat_id"
    token = get_token()
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    body = {
        "receive_id": chat_id,
        "msg_type": "image",
        "content": _json.dumps({"image_key": image_key}),
    }

    for attempt in range(3):
        try:
            resp = requests.post(url, headers=headers, json=body, timeout=15)
            if resp.status_code == 401:
                refresh_token()
                headers["Authorization"] = f"Bearer {get_token()}"
                continue
            if resp.status_code == 429:
                retry_after = int(resp.headers.get("Retry-After", "5"))
                time.sleep(retry_after)
                continue
            data = resp.json()
            if data.get("code") == 0:
                return True, None
            return False, data.get("msg", "unknown error")[:200]
        except (requests.Timeout, requests.ConnectionError):
            if attempt < 2:
                time.sleep(2 ** attempt)
                continue
            return False, "Network error after retries"

    return False, "Max retries exceeded"


def send_im_message(receive_id, content, msg_type="text", receive_id_type="chat_id"):
    """发送 IM 消息。返回 (success: bool, error: str|None)

    receive_id_type: "chat_id" 发群聊, "open_id" 发私信
    msg_type: "text" 发送文本消息, "interactive" 发送卡片消息
    当 msg_type="interactive" 时，content 应为飞书卡片 JSON 字符串
    """
    import json as _json
    url = f"{IM_BASE_URL}/messages?receive_id_type={receive_id_type}"
    token = get_token()
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    if msg_type == "interactive":
        body = {
            "receive_id": receive_id,
            "msg_type": "interactive",
            "content": content,
        }
    else:
        body = {
            "receive_id": receive_id,
            "msg_type": "text",
            "content": _json.dumps({"text": content}, ensure_ascii=False),
        }

    for attempt in range(3):
        try:
            resp = requests.post(url, headers=headers, json=body, timeout=15)
            if resp.status_code == 401:
                refresh_token()
                headers["Authorization"] = f"Bearer {get_token()}"
                continue
            if resp.status_code == 429:
                retry_after = int(resp.headers.get("Retry-After", "5"))
                time.sleep(retry_after)
                continue
            data = resp.json()
            if data.get("code") == 0:
                return True, None
            return False, data.get("msg", "unknown error")[:200]
        except (requests.Timeout, requests.ConnectionError):
            if attempt < 2:
                time.sleep(2 ** attempt)
                continue
            return False, "Network error after retries"

    return False, "Max retries exceeded"


def send_im_message_to_user(open_id, content, msg_type="interactive"):
    """向指定用户发送私信。返回 (success: bool, error: str|None)"""
    return send_im_message(open_id, content, msg_type, receive_id_type="open_id")
