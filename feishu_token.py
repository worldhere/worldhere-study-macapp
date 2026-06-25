# -*- coding: utf-8 -*-
"""飞书 tenant_access_token 管理"""
import time
import requests

TOKEN_URL = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal"

_cache = {"token": None, "expires_at": 0}
_app_cache = {"app_id": None, "app_secret": None, "loaded": False}


def _load_app_credentials():
    """从 config 表加载 app_id / app_secret，带缓存。回退到旧硬编码值。"""
    if _app_cache["loaded"]:
        return _app_cache["app_id"], _app_cache["app_secret"]
    try:
        from db import get_db
        conn = get_db()
        row_id = conn.execute(
            "SELECT value FROM config WHERE category='feishu' AND key='app_id'"
        ).fetchone()
        row_secret = conn.execute(
            "SELECT value FROM config WHERE category='feishu' AND key='app_secret'"
        ).fetchone()
        conn.close()
        _app_cache["app_id"] = (row_id["value"].strip() if row_id and row_id["value"].strip()
                                else "cli_aa8ffc77eff89bdb")
        _app_cache["app_secret"] = (row_secret["value"].strip() if row_secret and row_secret["value"].strip()
                                    else "7yncJ4xy9XPXsT6g1PMXScK2WqjKlAd5")
    except Exception:
        _app_cache["app_id"] = "cli_aa8ffc77eff89bdb"
        _app_cache["app_secret"] = "7yncJ4xy9XPXsT6g1PMXScK2WqjKlAd5"
        print("[feishu] WARNING: 无法从数据库读取应用凭证，使用硬编码默认值！请检查配置。")
    _app_cache["loaded"] = True
    return _app_cache["app_id"], _app_cache["app_secret"]


def invalidate_app_cache():
    """凭证更新后清除缓存，下次 get_token 重新加载"""
    _app_cache["loaded"] = False
    _app_cache["app_id"] = None
    _app_cache["app_secret"] = None
    # 同时清除 token 缓存，防止旧 app 的 token 被用于新 base
    _cache["token"] = None
    _cache["expires_at"] = 0


def get_token():
    """获取有效 token，提前 5 分钟自动续期"""
    now = time.time()
    if _cache["token"] and now < _cache["expires_at"] - 300:
        return _cache["token"]

    app_id, app_secret = _load_app_credentials()

    try:
        resp = requests.post(
            TOKEN_URL,
            json={"app_id": app_id, "app_secret": app_secret},
            timeout=10,
        )
        data = resp.json()
        if data.get("code") == 0:
            _cache["token"] = data["tenant_access_token"]
            _cache["expires_at"] = now + data.get("expire", 7200)
            return _cache["token"]
    except Exception:
        pass

    # 返回旧 token 作为降级（可能已过期但好过什么都不返回）
    return _cache["token"] if _cache["token"] else ""


def refresh_token():
    """强制刷新 token（401 时调用）"""
    _cache["expires_at"] = 0
    return get_token()
