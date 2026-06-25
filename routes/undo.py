# -*- coding: utf-8 -*-
"""操作撤回 API — 快照/恢复/清理"""
from flask import Blueprint, request, jsonify
from db import get_db
from undo_utils import create_snapshot, restore_snapshot, cleanup_session

bp = Blueprint('undo', __name__)


def _is_enabled():
    """检查撤回功能是否启用"""
    try:
        conn = get_db()
        row = conn.execute(
            "SELECT value FROM config WHERE category='undo' AND key='enabled'"
        ).fetchone()
        conn.close()
        return row and row["value"] == "1"
    except Exception:
        return False


@bp.route('/api/undo/snapshot', methods=['POST'])
def api_create_snapshot():
    if not _is_enabled():
        return jsonify({"ok": False, "msg": "撤回功能未启用"}), 503

    d = request.get_json(silent=True) or {}
    session_id = str(d.get("session_id") or "").strip()
    label = str(d.get("label") or "操作")
    schedule_ids = d.get("schedule_ids")
    task_ids = d.get("task_ids")

    snapshot_id = create_snapshot(session_id, label, schedule_ids, task_ids)
    if snapshot_id:
        return jsonify({"ok": True, "snapshot_id": snapshot_id})
    return jsonify({"ok": False, "msg": "无数据可快照"})


@bp.route('/api/undo/restore/<snapshot_id>', methods=['POST'])
def api_restore_snapshot(snapshot_id):
    if not _is_enabled():
        return jsonify({"ok": False, "msg": "撤回功能未启用"}), 503

    d = request.get_json(silent=True) or {}
    session_id = str(d.get("session_id") or "").strip()

    ok, msg, details = restore_snapshot(session_id, snapshot_id)
    return jsonify({"ok": ok, "msg": msg, "details": details})


@bp.route('/api/undo/cleanup/<session_id>', methods=['POST'])
def api_cleanup_session(session_id):
    cleanup_session(session_id)
    return jsonify({"ok": True})
