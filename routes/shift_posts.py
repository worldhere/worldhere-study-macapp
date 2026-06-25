from flask import Blueprint, request, jsonify
from db import get_db

bp = Blueprint('shift_posts', __name__)


def _get_forum_setting(conn, key):
    row = conn.execute(
        "SELECT value FROM config WHERE category='forum_settings' AND key=?",
        (key,),
    ).fetchone()
    return row["value"] if row else None


def _cleanup_old_posts(conn, retention_days):
    cur = conn.execute(
        "DELETE FROM shift_posts WHERE created_at < datetime('now', ?)",
        ('-' + str(int(retention_days)) + ' days',),
    )
    return cur.rowcount


@bp.route('/api/shift_posts', methods=['GET'])
def list_posts():
    conn = get_db()
    enabled = _get_forum_setting(conn, 'forum_enabled')
    retention = _get_forum_setting(conn, 'forum_retention_days') or '3'
    _cleanup_old_posts(conn, retention)
    conn.commit()
    cur = conn.execute(
        "SELECT id, title, author, content, created_at FROM shift_posts ORDER BY created_at DESC LIMIT 100"
    )
    rows = cur.fetchall()
    conn.close()
    return jsonify({
        "enabled": enabled == '1',
        "retention_days": int(retention),
        "posts": [dict(r) for r in rows],
    })


@bp.route('/api/shift_posts', methods=['POST'])
def create_post():
    d = request.get_json()
    title = (d.get('title') or '').strip()
    author = (d.get('author') or '').strip() or '匿名'
    content = (d.get('content') or '').strip()
    if not content or len(content) > 2000:
        return jsonify({"msg": "内容不能为空且不超过2000字符"}), 400
    conn = get_db()
    conn.execute(
        "INSERT INTO shift_posts (title, author, content) VALUES (?, ?, ?)",
        (title, author, content),
    )
    conn.commit()
    conn.close()
    return jsonify({"msg": "留言已发布"})


@bp.route('/api/shift_posts/<int:post_id>', methods=['DELETE'])
def delete_post(post_id):
    conn = get_db()
    conn.execute("DELETE FROM shift_posts WHERE id = ?", (post_id,))
    conn.commit()
    conn.close()
    return jsonify({"msg": "留言已删除"})


@bp.route('/api/shift_posts/cleanup', methods=['POST'])
def cleanup_posts():
    conn = get_db()
    retention = _get_forum_setting(conn, 'forum_retention_days') or '3'
    deleted = _cleanup_old_posts(conn, retention)
    conn.commit()
    conn.close()
    return jsonify({"deleted": deleted})
