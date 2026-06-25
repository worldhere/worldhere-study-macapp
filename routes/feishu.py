# -*- coding: utf-8 -*-
"""飞书同步 API 路由"""
import json
import queue
import threading
from flask import Blueprint, request, jsonify, Response
from db import get_db
from feishu_sync import (
    incremental_init, push_machine_schedules, pull_all_machines,
    push_all_machines_parallel,
    get_sync_status, _upsert_mapping, _get_app_token,
    start_pull_thread, stop_pull_thread,
    is_initializing, cancel_init,
    _async_init, _async_push, _async_pull,
    _async_toggle_on,
)
# 懒加载 status 模块引用，避免 from import 绑定过期值
import feishu.status as _status_mod

bp = Blueprint('feishu', __name__)


@bp.route('/api/feishu/init', methods=['POST'])
def api_feishu_init():
    if is_initializing():
        return jsonify({"error": "初始化已在进行中，请等待完成"}), 409
    # 后台线程执行，立即返回
    t = threading.Thread(target=_async_init, daemon=True)
    t.start()
    return jsonify({"started": True, "msg": "初始化已启动"})


@bp.route('/api/feishu/push', methods=['POST'])
def api_feishu_push():
    """推送全部已映射机器到飞书（异步）。"""
    if is_initializing():
        return jsonify({"error": "初始化进行中，请稍后再试"}), 409
    if _status_mod._active_operation:
        return jsonify({"error": "已有操作在进行中，请稍后再试"}), 409
    t = threading.Thread(target=_async_push, daemon=True)
    t.start()
    return jsonify({"started": True, "msg": "推送已启动"})


@bp.route('/api/feishu/pull', methods=['POST'])
def api_feishu_pull():
    """拉取全部已映射机器的飞书数据（异步）。"""
    if is_initializing():
        return jsonify({"error": "初始化进行中，请稍后再试"}), 409
    if _status_mod._active_operation:
        return jsonify({"error": "已有操作在进行中，请稍后再试"}), 409
    t = threading.Thread(target=_async_pull, daemon=True)
    t.start()
    return jsonify({"started": True, "msg": "拉取已启动"})


@bp.route('/api/feishu/status', methods=['GET'])
def api_feishu_status():
    return jsonify(get_sync_status())


@bp.route('/api/feishu/stream', methods=['GET'])
def api_feishu_stream():
    """SSE 实时推送：操作进度、机器事件、完成通知。"""
    import feishu.status as status_mod
    import json as _json

    def generate():
        q = queue.Queue(maxsize=50)
        status_mod._sse_clients.append(q)
        try:
            # 发送初始状态快照
            status = get_sync_status()
            yield "event: status\ndata: {}\n\n".format(_json.dumps(status, ensure_ascii=False))

            while True:
                try:
                    event = q.get(timeout=30)
                    yield event
                except queue.Empty:
                    yield ": heartbeat\n\n"
        except GeneratorExit:
            pass
        finally:
            try:
                status_mod._sse_clients.remove(q)
            except ValueError:
                pass

    return Response(generate(), mimetype='text/event-stream',
                    headers={'Cache-Control': 'no-cache',
                             'X-Accel-Buffering': 'no'})


@bp.route('/api/feishu/toggle', methods=['POST'])
def api_feishu_toggle():
    d = request.get_json()
    enabled = bool(d.get("enabled"))
    mode = d.get("mode", "local")  # "local" 以本地为准, "cloud" 与云端对齐
    conn = get_db()
    conn.execute(
        "UPDATE config SET value=? WHERE category='feishu' AND key='sync_enabled'",
        ("1" if enabled else "0",),
    )
    conn.execute(
        "UPDATE config SET value=? WHERE category='feishu' AND key='sync_mode'",
        (mode,),
    )
    conn.commit()
    conn.close()

    if enabled:
        # 先标记 pending 状态，避免线程启动前的空窗期
        import feishu.status as status_mod
        status_mod.set_active_operation({"type": "init", "total": 1, "done": 0,
                                        "phase": 1, "phase_total": 2, "phase_label": "建表"})
        status_mod.write_event("info", "", "正在准备初始化...")
        # 后台线程执行初始化，前端通过 SSE 追进度
        t = threading.Thread(target=_async_toggle_on, args=(mode,), daemon=True)
        t.start()
    else:
        # 关闭同步：先取消正在进行的初始化，再停止后台线程
        cancel_init()
        stop_pull_thread()

    # 返回完整状态，前端立即看到 active_operation 信息
    return jsonify(get_sync_status())


@bp.route('/api/feishu/exception-options', methods=['GET', 'POST'])
def api_feishu_exception_options():
    conn = get_db()
    if request.method == 'GET':
        row = conn.execute(
            "SELECT value FROM config WHERE category='feishu' AND key='exception_options'"
        ).fetchone()
        conn.close()
        options = json.loads(row["value"]) if row else ["正常", "机器故障", "缺少物料", "无法执行"]
        return jsonify({"options": options})

    # POST: 保存异常标记选项
    d = request.get_json()
    options = d.get("options", [])
    if not options or len(options) < 1:
        conn.close()
        return jsonify({"msg": "至少保留一个选项"}), 400

    conn.execute(
        "UPDATE config SET value=? WHERE category='feishu' AND key='exception_options'",
        (json.dumps(options, ensure_ascii=False),),
    )
    conn.commit()
    conn.close()

    return jsonify({"msg": "异常标记选项已更新"})


@bp.route('/api/feishu/cleanup', methods=['POST'])
def api_feishu_cleanup():
    """一键清除本应用创建的所有飞书表和映射（开发用）"""
    if is_initializing():
        return jsonify({"error": "初始化进行中，请稍后再试"}), 409
    conn = get_db()
    mappings = conn.execute("SELECT table_id, machine_name FROM feishu_sync_mapping").fetchall()

    deleted = 0
    errors = []
    from feishu_sync import _feishu_raw, _feishu_data, _get_app_token, stop_pull_thread, WHITELIST_TABLES
    import time as _time

    stop_pull_thread()

    # 白名单：不删这些表（机器配置表、机器分组表）
    whitelist = WHITELIST_TABLES

    # 遍历飞书 Base 中所有表，删掉不在白名单中的
    page_token = None
    while True:
        p = f"&page_token={page_token}" if page_token else ""
        data = _feishu_data("GET", f"/apps/{_get_app_token()}/tables?page_size=200{p}")
        if not data:
            break
        for item in data.get("items", []):
            name = item.get("name", "")
            tid = item.get("table_id", "")
            if name in whitelist:
                continue
            resp = _feishu_raw("DELETE", f"/apps/{_get_app_token()}/tables/{tid}")
            if resp.get("code") == 0:
                deleted += 1
            else:
                errors.append({"machine": name, "error": resp.get("msg", "unknown")[:100]})
            _time.sleep(0.15)
        if not data.get("has_more"):
            break
        page_token = data.get("page_token")

    conn.execute("DELETE FROM feishu_sync_mapping")
    conn.execute(
        "UPDATE config SET value='0' WHERE category='feishu' AND key='sync_enabled'"
    )
    conn.commit()
    conn.close()

    return jsonify({
        "msg": f"已删除 {deleted} 张表",
        "deleted": deleted,
        "total": deleted,
        "errors": errors if errors else None,
    })


@bp.route('/api/feishu/scan', methods=['GET'])
def api_feishu_scan():
    """扫描飞书 Base 中所有表，与本地映射对比，返回诊断结果。
    init 期间正常返回（前端根据 initializing 标记自行处理），不阻塞查询。"""
    from feishu_sync import _fetch_all_tables_snapshot, MACHINE_CONFIG_TABLE

    # 1. 飞书端：拉取所有表快照
    snapshot, conflicts = _fetch_all_tables_snapshot()
    online_tables = [{"name": n, "table_id": tid} for n, tid in snapshot.items()]
    conflict_tables = [{"name": n, "table_id": tid} for n, tid in conflicts]

    # 2. 本地映射
    conn = get_db()
    mappings = conn.execute(
        "SELECT machine_id, machine_name, table_id FROM feishu_sync_mapping"
    ).fetchall()
    mapped_table_ids = {m["table_id"] for m in mappings}

    # 3. 本地机器
    machines = conn.execute(
        "SELECT id, name FROM machines ORDER BY sort_order ASC"
    ).fetchall()
    machine_map = {m["id"]: m["name"] for m in machines}
    conn.close()

    # 4. 分析
    # 飞书端孤立表（无本地映射指向）
    orphan_online = [t for t in online_tables if t["table_id"] not in mapped_table_ids]

    # 已映射的表详情
    mapped = []
    for m in mappings:
        mapped.append({
            "machine_id": m["machine_id"],
            "machine_name": m["machine_name"],
            "table_id": m["table_id"],
            "online": m["table_id"] in {t["table_id"] for t in online_tables},
        })

    # 本地缺表的机器（有映射但飞书端不存在，或无映射）
    mapped_machine_ids = {m["machine_id"] for m in mappings}
    missing_tables = []
    for mid, mname in machine_map.items():
        mapping = next((m for m in mappings if m["machine_id"] == mid), None)
        if mapping is None:
            missing_tables.append({"machine_id": mid, "machine_name": mname, "reason": "无映射"})
        elif mapping["table_id"] not in mapped_table_ids or not any(
            t["table_id"] == mapping["table_id"] for t in online_tables
        ):
            missing_tables.append({"machine_id": mid, "machine_name": mname, "reason": "飞书端表已不存在"})

    return jsonify({
        "summary": {
            "online_total": len(online_tables),
            "mapped_total": len(mapped),
            "orphan_total": len(orphan_online),
            "missing_total": len(missing_tables),
            "conflict_total": len(conflict_tables),
        },
        "online_tables": online_tables,
        "mapped": mapped,
        "orphan_online": orphan_online,
        "missing_tables": missing_tables,
        "conflict_tables": conflict_tables,
    })


@bp.route('/api/feishu/fix-missing', methods=['POST'])
def api_feishu_fix_missing():
    """为缺失飞书表的机器建表并建立映射。返回修复结果。"""
    from feishu.init_engine import auto_fix_missing_mappings
    result = auto_fix_missing_mappings()
    return jsonify(result)

@bp.route('/api/feishu/push-config', methods=['GET'])
def api_feishu_push_config():
    """读取推送配置"""
    conn = get_db()
    row_enabled = conn.execute(
        "SELECT value FROM config WHERE category='feishu_push' AND key='enabled'"
    ).fetchone()
    row_chat_ids = conn.execute(
        "SELECT value FROM config WHERE category='feishu_push' AND key='chat_ids'"
    ).fetchone()
    row_toggles = conn.execute(
        "SELECT value FROM config WHERE category='feishu_push' AND key='event_toggles'"
    ).fetchone()
    conn.close()

    raw = row_chat_ids["value"] if row_chat_ids else ""
    # 向后兼容：旧格式为纯文本换行分隔，新格式为 JSON 数组
    if raw and raw.strip().startswith("["):
        try:
            chat_groups = json.loads(raw)
        except json.JSONDecodeError:
            chat_groups = []
    elif raw.strip():
        # 旧格式迁移：换行分隔的 chat_id → 无名称的 group
        lines = [l.strip() for l in raw.replace('\r', '\n').split('\n') if l.strip()]
        chat_groups = [{"name": "", "chat_id": l} for l in lines]
    else:
        chat_groups = []

    toggles = {}
    if row_toggles:
        try:
            toggles = json.loads(row_toggles["value"])
        except json.JSONDecodeError:
            pass

    return jsonify({
        "enabled": row_enabled["value"] == "1" if row_enabled else False,
        "chat_groups": chat_groups,
        "event_toggles": toggles,
    })


@bp.route('/api/feishu/push-config/save', methods=['POST'])
def api_feishu_push_config_save():
    """保存推送配置"""
    d = request.get_json()
    enabled = "1" if d.get("enabled") else "0"
    chat_groups = d.get("chat_groups", [])

    conn = get_db()
    conn.execute(
        "INSERT INTO config(category, key, value, sort_order) VALUES ('feishu_push', 'enabled', ?, 0)"
        " ON CONFLICT(category, key) DO UPDATE SET value=excluded.value",
        (enabled,),
    )
    conn.execute(
        "INSERT INTO config(category, key, value, sort_order) VALUES ('feishu_push', 'chat_ids', ?, 0)"
        " ON CONFLICT(category, key) DO UPDATE SET value=excluded.value",
        (json.dumps(chat_groups, ensure_ascii=False),),
    )
    event_toggles = d.get("event_toggles", {})
    conn.execute(
        "INSERT INTO config(category, key, value, sort_order) VALUES ('feishu_push', 'event_toggles', ?, 0)"
        " ON CONFLICT(category, key) DO UPDATE SET value=excluded.value",
        (json.dumps(event_toggles, ensure_ascii=False),),
    )
    conn.commit()
    conn.close()
    return jsonify({"msg": "保存成功"})


@bp.route('/api/feishu/push-config/test', methods=['POST'])
def api_feishu_push_config_test():
    """发送测试消息到所有配置的群聊"""
    from feishu.common import send_im_message, _load_chat_ids

    chat_ids, err = _load_chat_ids()
    if err:
        return jsonify({"error": err}), 400

    d = request.get_json()
    message = (d.get("message") or "").strip()
    if not message:
        return jsonify({"error": "消息内容不能为空"}), 400

    results = []
    for cid in chat_ids:
        success, err = send_im_message(cid, message)
        results.append({
            "chat_id": cid,
            "success": success,
            "error": err if not success else None,
        })

    return jsonify({"results": results})


@bp.route('/api/feishu/push-config/report-now', methods=['POST'])
def api_feishu_push_config_report_now():
    """立即生成并推送当前班次总结报告到所有配置的群聊"""
    import datetime as _dt
    from feishu.common import send_im_message, _load_chat_ids
    from feishu.events import _build_report_card

    chat_ids, err = _load_chat_ids()
    if err:
        return jsonify({"error": err}), 400

    # 判断当前班次
    now = _dt.datetime.now()
    now_min = now.hour * 60 + now.minute
    conn2 = get_db()
    shift_rows = conn2.execute(
        "SELECT key, start FROM shift_config WHERE key IN ('day_shift', 'night_shift')"
    ).fetchall()
    conn2.close()

    day_start = night_start = None
    for r in shift_rows:
        try:
            parts = str(r["start"]).replace('：', ':').split(":")
            t = int(parts[0]) * 60 + int(parts[1])
        except Exception:
            continue
        if r["key"] == "day_shift":
            day_start = t
        elif r["key"] == "night_shift":
            night_start = t

    if day_start is not None and night_start is not None:
        if day_start <= now_min < night_start:
            shift = "白班"
        else:
            shift = "夜班"
    else:
        shift = "白班"

    # 构造 event
    if shift == "夜班":
        yesterday = now - _dt.timedelta(days=1)
        event = {
            "event_type": "shift_report",
            "shift": shift,
            "date": yesterday.strftime("%Y-%m-%d"),
            "display_date": f"{yesterday.strftime('%m/%d')}-{now.strftime('%m/%d')}",
        }
    else:
        event = {
            "event_type": "shift_report",
            "shift": shift,
            "date": now.strftime("%Y-%m-%d"),
            "display_date": now.strftime("%m/%d"),
        }

    card_json = _build_report_card(event)
    if not card_json:
        return jsonify({"error": "生成报告失败"}), 500

    results = []
    for cid in chat_ids:
        success, err = send_im_message(cid, card_json, "interactive")
        results.append({
            "chat_id": cid,
            "success": success,
            "error": err if not success else None,
        })

    return jsonify({"shift": shift, "results": results})


# ===== 飞书应用凭证 =====

@bp.route('/api/feishu/app-info', methods=['GET'])
def api_feishu_app_info_get():
    """读取飞书应用凭证（app_secret 脱敏返回）"""
    conn = get_db()
    row_id = conn.execute(
        "SELECT value FROM config WHERE category='feishu' AND key='app_id'"
    ).fetchone()
    row_secret = conn.execute(
        "SELECT value FROM config WHERE category='feishu' AND key='app_secret'"
    ).fetchone()
    row_token = conn.execute(
        "SELECT value FROM config WHERE category='feishu' AND key='app_token'"
    ).fetchone()
    conn.close()

    app_id = row_id["value"].strip() if row_id else ""
    app_secret = row_secret["value"].strip() if row_secret else ""
    app_token = row_token["value"].strip() if row_token else ""

    # 脱敏：只显示前4位和后4位
    masked_secret = ""
    if app_secret and len(app_secret) > 8:
        masked_secret = app_secret[:4] + "*" * (len(app_secret) - 8) + app_secret[-4:]
    elif app_secret:
        masked_secret = app_secret[:2] + "*" * max(0, len(app_secret) - 2)

    # is_default：任一关键凭证未保存时，前端预填默认值 + 显示默认密钥提示
    is_default = not (bool(app_id) and bool(app_secret) and bool(app_token))

    return jsonify({
        "app_id": app_id,
        "app_secret": masked_secret,
        "has_secret": bool(app_secret),
        "app_token": app_token,
        "is_default": is_default,
    })


@bp.route('/api/feishu/app-info', methods=['POST'])
def api_feishu_app_info_save():
    """保存飞书应用凭证，可选验证"""
    d = request.get_json()
    app_id = (d.get("app_id") or "").strip()
    app_secret = (d.get("app_secret") or "").strip()
    app_token = (d.get("app_token") or "").strip()
    verify = d.get("verify", False)

    if not app_id or not app_token:
        return jsonify({"error": "App ID 和 App Token 不能为空"}), 400

    # ── 默认密钥（与 feishu_token.py 的 fallback 一致）──
    DEFAULT_SECRET = "7yncJ4xy9XPXsT6g1PMXScK2WqjKlAd5"

    conn = get_db()

    # 如果没传 app_secret，检查是否已有保存值 → 否则用默认密钥
    if not app_secret:
        existing = conn.execute(
            "SELECT value FROM config WHERE category='feishu' AND key='app_secret'"
        ).fetchone()
        if existing and existing["value"].strip():
            app_secret = existing["value"].strip()  # 保持已有值
        # 不报错：feishu_token.py 有硬编码默认值兜底；保存时也不写空值

    for key, val in [("app_id", app_id), ("app_secret", app_secret), ("app_token", app_token)]:
        if not val:
            continue  # 空值不写入 config，保持 token 模块的 fallback 行为
        conn.execute(
            "INSERT INTO config(category, key, value, sort_order) VALUES ('feishu', ?, ?, 0)"
            " ON CONFLICT(category, key) DO UPDATE SET value=excluded.value",
            (key, val),
        )
    conn.commit()
    conn.close()

    # 清除缓存，使下次 API 调用使用新凭证
    try:
        from feishu_token import invalidate_app_cache
        invalidate_app_cache()
    except Exception:
        pass
    try:
        from feishu.common import invalidate_app_token_cache
        invalidate_app_token_cache()
    except Exception:
        pass

    # 可选：验证凭证
    verify_result = None
    if verify:
        try:
            import requests as _requests
            verify_secret = app_secret if app_secret else DEFAULT_SECRET
            resp = _requests.post(
                "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
                json={"app_id": app_id, "app_secret": verify_secret},
                timeout=10,
            )
            data = resp.json()
            if data.get("code") == 0:
                verify_result = {"valid": True, "msg": "凭证有效"}
            else:
                verify_result = {"valid": False, "msg": data.get("msg", "未知错误")[:200]}
        except Exception as e:
            verify_result = {"valid": False, "msg": str(e)[:200]}

    return jsonify({
        "msg": "保存成功",
        "verify": verify_result,
    })


@bp.route('/api/feishu/app-info/test', methods=['POST'])
def api_feishu_app_info_test():
    """测试凭证：分别检测 token、IM（机器人）、Bitable（表格）"""
    d = request.get_json() or {}
    app_id_in = (d.get("app_id") or "").strip()
    app_secret_in = (d.get("app_secret") or "").strip()
    app_token_in = (d.get("app_token") or "").strip()

    # ── 逐级回退：输入 > DB > 默认 ──
    DEFAULT_ID = "YOUR_APP_ID"
    DEFAULT_SECRET = "YOUR_APP_SECRET"
    DEFAULT_TOKEN = "YOUR_APP_TOKEN"

    app_id = app_id_in
    app_secret = app_secret_in
    app_token = app_token_in

    if not app_id or not app_secret or not app_token:
        conn = get_db()
        if not app_id:
            row = conn.execute(
                "SELECT value FROM config WHERE category='feishu' AND key='app_id'"
            ).fetchone()
            app_id = row["value"].strip() if row and row["value"].strip() else ""
        if not app_secret:
            row = conn.execute(
                "SELECT value FROM config WHERE category='feishu' AND key='app_secret'"
            ).fetchone()
            app_secret = row["value"].strip() if row and row["value"].strip() else ""
        if not app_token:
            row = conn.execute(
                "SELECT value FROM config WHERE category='feishu' AND key='app_token'"
            ).fetchone()
            app_token = row["value"].strip() if row and row["value"].strip() else ""
        conn.close()

    if not app_id:
        app_id = DEFAULT_ID
    if not app_secret:
        app_secret = DEFAULT_SECRET
    if not app_token:
        app_token = DEFAULT_TOKEN

    import requests as _requests

    results = {}

    # ── 1. Token 测试 ──
    try:
        resp = _requests.post(
            "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
            json={"app_id": app_id, "app_secret": app_secret},
            timeout=10,
        )
        data = resp.json()
        if data.get("code") == 0:
            token = data.get("tenant_access_token", "")
            results["token"] = {"ok": True, "msg": "凭证有效"}
        else:
            results["token"] = {"ok": False, "msg": data.get("msg", "未知错误")[:100]}
            # token 都不行，后面不用测了
            return jsonify(results)
    except Exception as e:
        results["token"] = {"ok": False, "msg": str(e)[:100]}
        return jsonify(results)

    # ── 2. 机器人（IM）测试：列群 + 上传图片 ──
    im_headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    im_ok = True
    im_details = []

    # 2a. 读群列表
    try:
        r = _requests.get("https://open.feishu.cn/open-apis/im/v1/chats?page_size=1",
                          headers=im_headers, timeout=8)
        if r.json().get("code") == 0:
            im_details.append("群列表读取正常")
        else:
            im_ok = False
            im_details.append("群列表: " + str(r.json().get("msg", ""))[:40])
    except Exception as e:
        im_ok = False
        im_details.append("群列表: " + str(e)[:40])

    # 2b. 上传 1x1 占位 PNG（验证 im:image 权限）
    try:
        # 最小合法 PNG: 1x1 白色像素
        import base64
        TINY_PNG_B64 = (
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/"
            "PchI7wAAAABJRU5ErkJggg=="
        )
        tiny_png = base64.b64decode(TINY_PNG_B64)
        r = _requests.post("https://open.feishu.cn/open-apis/im/v1/images",
                           headers={"Authorization": f"Bearer {token}"},
                           files={"image": ("test.png", tiny_png, "image/png")},
                           data={"image_type": "message"}, timeout=8)
        if r.json().get("code") == 0:
            im_details.append("图片上传正常")
        else:
            im_ok = False
            im_details.append("图片上传: " + str(r.json().get("msg", ""))[:40])
    except Exception as e:
        im_ok = False
        im_details.append("图片上传: " + str(e)[:40])

    results["im"] = {"ok": im_ok, "msg": "; ".join(im_details)}

    # ── 3. 表格（Bitable）测试 ──
    bt_headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    try:
        r = _requests.get(
            f"https://open.feishu.cn/open-apis/bitable/v1/apps/{app_token}/tables?page_size=1",
            headers=bt_headers, timeout=8,
        )
        bdata = r.json()
        if bdata.get("code") == 0:
            table_count = bdata.get("data", {}).get("total", 0) if isinstance(bdata.get("data"), dict) else len(bdata.get("data", {}).get("items", []))
            results["bitable"] = {"ok": True, "msg": f"表格连接正常（{table_count} 张表）"}
        elif bdata.get("code") in (99991663, 99991664, 99991665, 230002):
            results["bitable"] = {"ok": False, "msg": "未授权 bitable:app 权限"}
        else:
            results["bitable"] = {"ok": False, "msg": bdata.get("msg", "未知错误")[:100]}
    except Exception as e:
        results["bitable"] = {"ok": False, "msg": str(e)[:100]}

    return jsonify(results)
