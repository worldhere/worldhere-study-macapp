import json

from flask import Blueprint, request, jsonify

from db import get_db, get_config

bp = Blueprint('settings', __name__)

PROTECTED_DIFFICULTY = "无"

CATEGORY_LABELS = {
    "machine_types": "机器类型",
    "machine_statuses": "机器状态",
    "task_kinds": "任务类型",
    "priorities": "优先级",
    "difficulties": "难度",
    "nav_order": "导航顺序",
}

# 枚举类型对应数据库中的引用表和列
REFERENCE_CHECKS = {
    "machine_types": ("machines", "type"),
    "machine_statuses": ("machines", "status"),
    "task_kinds": ("machines", "task_kind"),
    "task_kinds_tasks": ("tasks", "task_kind"),
    "task_kinds_schedules": ("schedules", "task_kind"),
    "priorities": ("tasks", "priority"),
    "difficulties": ("tasks", "difficulty"),
}


def _check_references(category, key):
    """检查某个枚举值是否正在被引用，返回引用详情列表。"""
    refs = []
    conn = get_db()
    if category == "machine_types":
        count = conn.execute(
            "SELECT COUNT(*) AS c FROM machines WHERE type=?", (key,)
        ).fetchone()["c"]
        if count:
            refs.append(f"{count} 台机器")
    elif category == "machine_statuses":
        count = conn.execute(
            "SELECT COUNT(*) AS c FROM machines WHERE status=?", (key,)
        ).fetchone()["c"]
        if count:
            refs.append(f"{count} 台机器")
    elif category == "task_kinds":
        m_count = conn.execute(
            "SELECT COUNT(*) AS c FROM machines WHERE task_kind=?", (key,)
        ).fetchone()["c"]
        t_count = conn.execute(
            "SELECT COUNT(*) AS c FROM tasks WHERE task_kind=?", (key,)
        ).fetchone()["c"]
        s_count = conn.execute(
            "SELECT COUNT(*) AS c FROM schedules WHERE task_kind=?", (key,)
        ).fetchone()["c"]
        if m_count:
            refs.append(f"{m_count} 台机器")
        if t_count:
            refs.append(f"{t_count} 个任务")
        if s_count:
            refs.append(f"{s_count} 条排班")
    elif category == "priorities":
        count = conn.execute(
            "SELECT COUNT(*) AS c FROM tasks WHERE priority=?", (key,)
        ).fetchone()["c"]
        if count:
            refs.append(f"{count} 个任务")
    elif category == "difficulties":
        count = conn.execute(
            "SELECT COUNT(*) AS c FROM tasks WHERE difficulty=?", (key,)
        ).fetchone()["c"]
        if count:
            refs.append(f"{count} 个任务")
    conn.close()
    return refs


def _category_count(category):
    conn = get_db()
    count = conn.execute(
        "SELECT COUNT(*) AS c FROM config WHERE category=?", (category,)
    ).fetchone()["c"]
    conn.close()
    return count


@bp.route('/api/settings')
def api_settings():
    return jsonify(get_config())


@bp.route('/api/settings/<category>/add', methods=['POST'])
def settings_add(category):
    d = request.get_json()
    key = (d.get("key") or "").strip()
    if not key:
        return jsonify({"msg": "名称不能为空"}), 400

    conn = get_db()
    existing = conn.execute(
        "SELECT COUNT(*) AS c FROM config WHERE category=? AND key=?", (category, key)
    ).fetchone()["c"]
    if existing:
        conn.close()
        return jsonify({"msg": "该名称已存在"}), 400

    max_order = conn.execute(
        "SELECT COALESCE(MAX(sort_order), 0) AS m FROM config WHERE category=?", (category,)
    ).fetchone()["m"]

    conn.execute(
        "INSERT INTO config(category, key, value, sort_order) VALUES (?,?,?,?)",
        (category, key, "", max_order + 1),
    )
    conn.commit()
    conn.close()
    return jsonify({"msg": "添加成功"})


@bp.route('/api/settings/<category>/update', methods=['POST'])
def settings_update(category):
    d = request.get_json()
    old_key = (d.get("old_key") or "").strip()
    new_key = (d.get("new_key") or "").strip()
    new_value = (d.get("value") or "").strip()

    if not old_key or not new_key:
        return jsonify({"msg": "名称不能为空"}), 400

    # "无" 难度不可改名
    if category == "difficulties" and old_key == PROTECTED_DIFFICULTY:
        if new_key != PROTECTED_DIFFICULTY:
            return jsonify({"msg": "'无' 难度不可改名"}), 400

    conn = get_db()
    if old_key != new_key:
        dup = conn.execute(
            "SELECT COUNT(*) AS c FROM config WHERE category=? AND key=?", (category, new_key)
        ).fetchone()["c"]
        if dup:
            conn.close()
            return jsonify({"msg": "该名称已存在"}), 400

    conn.execute(
        "UPDATE config SET key=?, value=? WHERE category=? AND key=?",
        (new_key, new_value, category, old_key),
    )

    # 级联更新引用表
    if old_key != new_key:
        if category == "machine_types":
            conn.execute("UPDATE machines SET type=? WHERE type=?", (new_key, old_key))
            conn.execute("UPDATE tasks SET type=? WHERE type=?", (new_key, old_key))
            conn.execute("UPDATE schedules SET task_type=? WHERE task_type=? AND status!='completed'", (new_key, old_key))
            # 级联颜色设置中的 type_colors key
            row = conn.execute(
                "SELECT value FROM config WHERE category='color_settings' AND key='type_colors'"
            ).fetchone()
            if row:
                try:
                    colors = json.loads(row["value"])
                    if old_key in colors:
                        colors[new_key] = colors.pop(old_key)
                        conn.execute(
                            "UPDATE config SET value=? WHERE category='color_settings' AND key='type_colors'",
                            (json.dumps(colors, ensure_ascii=False),)
                        )
                except Exception:
                    pass
        elif category == "machine_statuses":
            conn.execute("UPDATE machines SET status=? WHERE status=?", (new_key, old_key))
        elif category == "task_kinds":
            conn.execute("UPDATE machines SET task_kind=? WHERE task_kind=?", (new_key, old_key))
            conn.execute("UPDATE tasks SET task_kind=? WHERE task_kind=?", (new_key, old_key))
            conn.execute("UPDATE schedules SET task_kind=? WHERE task_kind=? AND status!='completed'", (new_key, old_key))
        elif category == "priorities":
            conn.execute("UPDATE tasks SET priority=? WHERE priority=?", (new_key, old_key))
        elif category == "difficulties":
            conn.execute("UPDATE tasks SET difficulty=? WHERE difficulty=?", (new_key, old_key))

    conn.commit()
    conn.close()
    return jsonify({"msg": "修改成功"})


@bp.route('/api/settings/<category>/delete', methods=['POST'])
def settings_delete(category):
    d = request.get_json()
    key = (d.get("key") or "").strip()
    if not key:
        return jsonify({"msg": "名称不能为空"}), 400

    # "无" 难度不可删除
    if category == "difficulties" and key == PROTECTED_DIFFICULTY:
        return jsonify({"msg": "'无' 难度不可删除"}), 400

    # 每种枚举至少保留一个
    if _category_count(category) <= 1:
        label = CATEGORY_LABELS.get(category, category)
        return jsonify({"msg": f"至少需要保留一个{label}"}), 400

    # 检查引用
    refs = _check_references(category, key)
    if refs:
        return jsonify({"msg": f"该值正被 {'、'.join(refs)} 引用，无法删除"}), 400

    conn = get_db()
    conn.execute(
        "DELETE FROM config WHERE category=? AND key=?", (category, key)
    )
    conn.commit()
    conn.close()
    return jsonify({"msg": "删除成功"})


@bp.route('/api/settings/<category>/reorder', methods=['POST'])
def settings_reorder(category):
    d = request.get_json()
    keys = d.get("keys") or []
    if not keys:
        return jsonify({"msg": "排序列表不能为空"}), 400

    conn = get_db()
    for i, key in enumerate(keys):
        conn.execute(
            "INSERT OR REPLACE INTO config (category, key, value, sort_order) VALUES (?, ?, '', ?)",
            (category, key, i + 1),
        )
    conn.commit()
    conn.close()
    return jsonify({"msg": "排序已保存"})


@bp.route('/api/settings/<category>/cascade-history', methods=['POST'])
def settings_cascade_history(category):
    """手动将设置改名同步到已完成（历史）排班"""
    d = request.get_json()
    old_key = (d.get("old_key") or "").strip()
    new_key = (d.get("new_key") or "").strip()

    if not old_key or not new_key:
        return jsonify({"msg": "参数不完整"}), 400

    if old_key == new_key:
        return jsonify({"msg": "新旧名称相同，无需更新"}), 400

    conn = get_db()
    updated = 0
    if category == "machine_types":
        result = conn.execute(
            "UPDATE schedules SET task_type=? WHERE task_type=? AND status='completed'",
            (new_key, old_key),
        )
        updated = result.rowcount
    elif category == "task_kinds":
        result = conn.execute(
            "UPDATE schedules SET task_kind=? WHERE task_kind=? AND status='completed'",
            (new_key, old_key),
        )
        updated = result.rowcount
    else:
        conn.close()
        return jsonify({"msg": "该类别不需要同步历史记录"}), 400

    conn.commit()
    conn.close()
    return jsonify({"msg": f"已更新 {updated} 条历史记录"})


@bp.route('/api/settings/batch', methods=['POST'])
def settings_batch():
    """批量保存 UI 偏好等非枚举配置"""
    d = request.get_json() or {}
    conn = get_db()
    for item in d.get("items", []):
        category = item.get("category", "")
        key = item.get("key", "")
        value = str(item.get("value", ""))
        if category and key:
            conn.execute(
                "INSERT INTO config(category,key,value,sort_order) VALUES (?,?,?,0) "
                "ON CONFLICT(category,key) DO UPDATE SET value=excluded.value",
                (category, key, value),
            )
    conn.commit()
    conn.close()
    return jsonify({"msg": "保存成功"})


@bp.route('/save_schedule_setting', methods=['POST'])
def save_schedule_setting():
    d = request.get_json()
    key = d.get("key", "")
    value = d.get("value", "1")
    conn = get_db()
    conn.execute(
        "INSERT INTO config(category, key, value, sort_order) VALUES ('schedule_settings', ?, ?, 0)"
        " ON CONFLICT(category, key) DO UPDATE SET value=excluded.value",
        (key, value),
    )
    conn.commit()
    conn.close()
    return jsonify({"msg": "ok"})
