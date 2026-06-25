import datetime

from flask import Blueprint, request, jsonify

from db import get_db, get_allowed_task_kinds, get_allowed_machine_groups
from models import recycle_schedules
from utils import parse_date, start_repair, end_repair

bp = Blueprint('machines', __name__)


# ========== 机器分组 CRUD ==========

@bp.route('/api/machine_groups')
def api_machine_groups():
    try:
        conn = get_db()
        rows = conn.execute(
            "SELECT key, sort_order FROM config WHERE category='machine_groups' ORDER BY sort_order, key"
        ).fetchall()
        conn.close()
        return jsonify({"groups": [dict(r) for r in rows]})
    except Exception as e:
        return jsonify({"msg": f"加载分组列表失败: {e}"}), 500


@bp.route('/add_machine_group', methods=['POST'])
def add_machine_group():
    d = request.get_json()
    name = (d.get("name") or "").strip()
    if not name:
        return jsonify({"msg": "分组名不能为空"}), 400
    conn = get_db()
    existing = conn.execute(
        "SELECT COUNT(*) AS c FROM config WHERE category='machine_groups' AND key=?", (name,)
    ).fetchone()["c"]
    if existing:
        conn.close()
        return jsonify({"msg": "该分组名已存在"}), 400
    max_order = conn.execute(
        "SELECT COALESCE(MAX(sort_order), 0) AS m FROM config WHERE category='machine_groups'"
    ).fetchone()["m"]
    conn.execute(
        "INSERT INTO config(category, key, value, sort_order) VALUES ('machine_groups', ?, '', ?)",
        (name, max_order + 1),
    )
    # 同步到 groups 表（供飞书 sync_groups 使用）
    conn.execute(
        "INSERT OR IGNORE INTO groups (name) VALUES (?)", (name,)
    )
    conn.commit()
    conn.close()
    return jsonify({"msg": "分组已创建", "group": {"key": name, "sort_order": max_order + 1}})


@bp.route('/update_machine_group', methods=['POST'])
def update_machine_group():
    d = request.get_json()
    old_name = (d.get("old_name") or "").strip()
    new_name = (d.get("new_name") or "").strip()
    if not old_name or not new_name:
        return jsonify({"msg": "分组名不能为空"}), 400
    conn = get_db()
    if old_name != new_name:
        dup = conn.execute(
            "SELECT COUNT(*) AS c FROM config WHERE category='machine_groups' AND key=?",
            (new_name,)
        ).fetchone()["c"]
        if dup:
            conn.close()
            return jsonify({"msg": "该分组名已存在"}), 400
        conn.execute(
            "UPDATE config SET key=? WHERE category='machine_groups' AND key=?",
            (new_name, old_name),
        )
        conn.execute(
            "UPDATE machines SET group_name=? WHERE group_name=?",
            (new_name, old_name),
        )
        # 同步 groups 表（供飞书 sync_groups 使用）
        conn.execute(
            "UPDATE groups SET name=? WHERE name=?",
            (new_name, old_name),
        )
    conn.commit()
    conn.close()
    return jsonify({"msg": "分组已更新"})


@bp.route('/delete_machine_group', methods=['POST'])
def delete_machine_group():
    d = request.get_json()
    name = (d.get("name") or "").strip()
    if not name:
        return jsonify({"msg": "分组名不能为空"}), 400
    conn = get_db()
    conn.execute(
        "DELETE FROM config WHERE category='machine_groups' AND key=?", (name,)
    )
    conn.execute(
        "UPDATE machines SET group_name='' WHERE group_name=?", (name,)
    )
    # 同步 groups 表（供飞书 sync_groups 使用）
    conn.execute(
        "DELETE FROM groups WHERE name=?", (name,)
    )
    conn.commit()
    conn.close()
    return jsonify({"msg": "分组已删除，该分组下的机器已变为未分组"})


@bp.route('/update_machine_groups_order', methods=['POST'])
def update_machine_groups_order():
    d = request.get_json()
    keys = d.get("keys") or []
    if not keys:
        return jsonify({"msg": "排序列表不能为空"}), 400
    conn = get_db()
    for i, key in enumerate(keys):
        conn.execute(
            "UPDATE config SET sort_order=? WHERE category='machine_groups' AND key=?",
            (i + 1, key),
        )
    conn.commit()
    conn.close()
    return jsonify({"msg": "排序已保存"})


@bp.route('/api/machines')
def api_machines():
    try:
        conn = get_db()
        rows = conn.execute("SELECT id,name,type,status,task_kind,group_name FROM machines ORDER BY sort_order ASC").fetchall()
        machines = [dict(r) for r in rows]

        # 动态计算状态：有进行中任务 → "工作"，维修停用 → 保持，其余 → "空闲"
        now = datetime.datetime.now()
        status_map = {}
        for m in machines:
            mid = int(m["id"])
            db_status = m["status"]
            status_map[mid] = "空闲" if db_status != "维修停用" else "维修停用"

        schedules_rows = conn.execute(
            "SELECT machine_id, date, start_min, end_min FROM schedules WHERE status != 'completed'"
        ).fetchall()
        for s in schedules_rows:
            mid = int(s["machine_id"])
            if status_map.get(mid) == "维修停用":
                continue
            try:
                base_date = datetime.date.fromisoformat(s["date"])
                start_dt = datetime.datetime.combine(base_date, datetime.time.min) + datetime.timedelta(minutes=int(s["start_min"]))
                end_dt = datetime.datetime.combine(base_date, datetime.time.min) + datetime.timedelta(minutes=int(s["end_min"]))
            except (ValueError, TypeError):
                continue
            if start_dt <= now < end_dt:
                status_map[mid] = "工作"

        for m in machines:
            mid = int(m["id"])
            m["status"] = status_map.get(mid, m["status"])

        conn.close()
        return jsonify({"machines": machines})
    except Exception as e:
        return jsonify({"msg": f"加载机器列表失败: {e}"}), 500


@bp.route('/add_machine', methods=['POST'])
def add_machine():
    d = request.get_json()
    name = (d.get("name") or "").strip()
    mtype = d.get("type", "")
    conn = get_db()
    if name:
        existing = conn.execute("SELECT COUNT(*) AS c FROM machines WHERE name=?", (name,)).fetchone()
        if existing and existing["c"] > 0:
            conn.close()
            return jsonify({"msg": "名称已存在"})
    else:
        name = f"{mtype}-未命名" if mtype else "未命名"
    conn.execute(
        "INSERT INTO machines(sort_order,name,type,status,area) VALUES (?,?,?,?,?)",
        (
            int(conn.execute("SELECT COALESCE(MAX(sort_order),0)+1 AS v FROM machines").fetchone()["v"]),
            name,
            mtype,
            "空闲",
            "站桩",
        ),
    )
    task_kind = (d.get("task_kind") or "").strip()
    allowed = get_allowed_task_kinds()
    if not task_kind or task_kind not in allowed:
        task_kind = allowed[0] if allowed else "常规"
    group_name = (d.get("group_name") or "").strip()
    allowed_groups = get_allowed_machine_groups()
    if group_name and group_name not in allowed_groups:
        group_name = ""
    remark = (d.get("remark") or "").strip()
    new_id = conn.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]
    conn.execute("UPDATE machines SET task_kind=?, group_name=?, remark=? WHERE id=?", (task_kind, group_name, remark, int(new_id)))
    conn.commit()
    conn.close()

    # 飞书联动：同步开关打开时自动创建对应表格
    try:
        import time as _time
        _time.sleep(0.1)  # 确保机器已落库
        from feishu_sync import on_machine_created
        on_machine_created(int(new_id), name)
    except Exception:
        pass  # 飞书创建失败不影响机器新增

    return jsonify({"msg": "新增成功", "machine": {"id": new_id, "name": name, "type": mtype, "status": "空闲", "task_kind": task_kind, "group_name": group_name, "remark": remark}})


@bp.route('/add_machines_batch', methods=['POST'])
def add_machines_batch():
    d = request.get_json() or {}
    allowed = get_allowed_task_kinds()
    default_kind = allowed[0] if allowed else "常规"
    allowed_groups = get_allowed_machine_groups()
    conn = get_db()

    # New format: {machines: [{name, type, task_kind, group_name}, ...]}
    machine_list = d.get("machines")
    if machine_list and isinstance(machine_list, list):
        added = 0
        skipped = []
        for item in machine_list:
            if isinstance(item, str):
                name = item.strip()
                mtype = ""
                task_kind = default_kind
                group_name = ""
            else:
                name = (item.get("name") or "").strip()
                mtype = (item.get("type") or "").strip()
                task_kind = (item.get("task_kind") or "").strip()
                group_name = (item.get("group_name") or "").strip()
            if not name or not mtype:
                continue
            if not task_kind or task_kind not in allowed:
                task_kind = default_kind
            if group_name and group_name not in allowed_groups:
                group_name = ""
            existing = conn.execute("SELECT COUNT(*) AS c FROM machines WHERE name=?", (name,)).fetchone()
            if existing and existing["c"] > 0:
                skipped.append(name)
                continue
            conn.execute(
                "INSERT INTO machines(sort_order,name,type,status,area) VALUES (?,?,?,?,?)",
                (
                    int(conn.execute("SELECT COALESCE(MAX(sort_order),0)+1 AS v FROM machines").fetchone()["v"]),
                    name,
                    mtype,
                    "空闲",
                    "站桩",
                ),
            )
            new_id = conn.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]
            conn.execute("UPDATE machines SET task_kind=?, group_name=? WHERE id=?", (task_kind, group_name, int(new_id)))
            added += 1
        conn.commit()
        conn.close()
        msg = f"成功添加 {added} 台机器"
        if skipped:
            msg += f"，{len(skipped)} 台跳过（名称已存在：{', '.join(skipped)}）"
        return jsonify({"msg": msg, "added": added, "skipped": skipped})

    # Old format (backward compatible): {type, task_kind, names: [...]}
    mtype = (d.get("type") or "").strip()
    task_kind = (d.get("task_kind") or "").strip()
    names = d.get("names") or []
    if not mtype or not isinstance(names, list) or len(names) == 0:
        return jsonify({"msg": "参数错误"})
    if not task_kind or task_kind not in allowed:
        task_kind = default_kind
    added = 0
    skipped = []
    for name in names:
        item_group = ""
        if isinstance(name, dict):
            item_name = (name.get("name") or "").strip()
            item_kind = (name.get("task_kind") or "").strip()
            item_group = (name.get("group_name") or "").strip()
            if not item_kind or item_kind not in allowed:
                item_kind = task_kind
            if item_group and item_group not in allowed_groups:
                item_group = ""
            name = item_name
        else:
            name = (name or "").strip()
            item_kind = task_kind
        if not name:
            continue
        existing = conn.execute("SELECT COUNT(*) AS c FROM machines WHERE name=?", (name,)).fetchone()
        if existing and existing["c"] > 0:
            skipped.append(name)
            continue
        conn.execute(
            "INSERT INTO machines(sort_order,name,type,status,area) VALUES (?,?,?,?,?)",
            (
                int(conn.execute("SELECT COALESCE(MAX(sort_order),0)+1 AS v FROM machines").fetchone()["v"]),
                name,
                mtype,
                "空闲",
                "站桩",
            ),
        )
        new_id = conn.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]
        conn.execute("UPDATE machines SET task_kind=?, group_name=? WHERE id=?", (item_kind, item_group, int(new_id)))
        added += 1
    conn.commit()
    conn.close()
    msg = f"成功添加 {added} 台机器"
    if skipped:
        msg += f"，{len(skipped)} 台跳过（名称已存在：{', '.join(skipped)}）"
    return jsonify({"msg": msg, "added": added, "skipped": skipped})


@bp.route('/set_machine_status', methods=['POST'])
def set_machine_status():
    d = request.get_json()
    mid = int(d["id"])
    new_status = d["status"]
    conn = get_db()

    old = conn.execute("SELECT status FROM machines WHERE id=?", (mid,)).fetchone()
    if not old:
        conn.close()
        return jsonify({"msg": "机器不存在"})
    old_status = old["status"]

    conn.execute("UPDATE machines SET status=? WHERE id=?", (new_status, mid))

    repair_info = None

    if new_status == "维修停用" and old_status != "维修停用":
        repair_info = start_repair(conn, mid)
        # 标记该机器所有未完成排班为机器故障，触发飞书异常通知
        conn.execute(
            """UPDATE schedules SET exception_mark = '机器故障', exception_note = '机器标记维修'
               WHERE machine_id = ?
                 AND status != 'completed'
                 AND (exception_mark IS NULL OR exception_mark = '' OR exception_mark = '正常')""",
            (mid,),
        )

    elif old_status == "维修停用" and new_status != "维修停用":
        repair_info = end_repair(conn, mid)
        # 清除未完成排班的异常标记，防止飞书 _audit_active_exceptions_for_repair
        # 在下次 pull 时将机器重新置为维修停用。
        # LWW 触发器自动更新 local_modified_at，保护本地清除在 pull 时不被覆盖。
        conn.execute(
            """UPDATE schedules SET exception_mark = '正常', exception_note = ''
               WHERE machine_id = ?
                 AND status != 'completed'
                 AND exception_mark IS NOT NULL
                 AND exception_mark != ''
                 AND exception_mark != '正常'""",
            (mid,),
        )

    conn.commit()
    conn.close()

    response = {"msg": "状态已更新"}
    if repair_info:
        response["repair"] = repair_info
    return jsonify(response)


@bp.route('/update_machine', methods=['POST'])
def update_machine():
    d = request.get_json()
    mid = int(d.get("id"))
    name = (d.get("name") or "").strip()
    task_kind = (d.get("task_kind") or "常规").strip()
    try:
        sort_order = int(str(d.get("sort_order") or "").strip() or "0")
    except ValueError:
        sort_order = 0
    if not name:
        return jsonify({"msg": "名称不能为空"})
    if sort_order <= 0:
        sort_order = mid
    if task_kind not in get_allowed_task_kinds():
        task_kind = "常规"
    group_name = (d.get("group_name") or "").strip()
    allowed_groups = get_allowed_machine_groups()
    if group_name and group_name not in allowed_groups:
        group_name = ""
    remark = (d.get("remark") or "").strip()
    conn = get_db()
    old = conn.execute("SELECT name FROM machines WHERE id=?", (mid,)).fetchone()
    conn.execute(
        "UPDATE machines SET sort_order=?, name=?, task_kind=?, group_name=?, remark=? WHERE id=?",
        (sort_order, name, task_kind, group_name, remark, mid),
    )
    if old and old["name"] != name:
        conn.execute("UPDATE schedules SET machine_name=? WHERE machine_id=?", (name, mid))
        # 飞书联动：更新表名
        try:
            from feishu_sync import on_machine_renamed
            on_machine_renamed(mid, name)
        except Exception:
            pass
    conn.commit()
    conn.close()
    return jsonify({"msg": "已保存"})


@bp.route('/update_machine_type', methods=['POST'])
def update_machine_type():
    d = request.get_json()
    mid = int(d.get("id"))
    new_type = (d.get("type") or "").strip()
    if not new_type:
        return jsonify({"msg": "类型不能为空"})
    conn = get_db()
    old = conn.execute("SELECT type, name, task_kind FROM machines WHERE id=?", (mid,)).fetchone()
    if not old:
        conn.close()
        return jsonify({"msg": "机器不存在"})
    old_type = old["type"]
    if old_type == new_type:
        conn.close()
        return jsonify({"msg": "类型未变化"})
    conn.execute("UPDATE machines SET type=? WHERE id=?", (new_type, mid))
    # 更新该机器排班中的 machine_name（含类型显示）
    new_full_name = f"{old['name']}({new_type}/{old['task_kind']})"
    conn.execute(
        "UPDATE schedules SET machine_name=? WHERE machine_id=? AND status!='completed'",
        (new_full_name, mid),
    )
    conn.commit()
    conn.close()
    return jsonify({"msg": f"机器类型已从 {old_type} 改为 {new_type}"})


@bp.route('/update_machine_task_kind', methods=['POST'])
def update_machine_task_kind():
    d = request.get_json()
    mid = int(d.get("id"))
    new_kind = (d.get("task_kind") or "").strip()
    if not new_kind:
        return jsonify({"msg": "任务类型不能为空"})
    if new_kind not in get_allowed_task_kinds():
        return jsonify({"msg": f"无效的任务类型: {new_kind}"})
    conn = get_db()
    old = conn.execute("SELECT task_kind, type, name FROM machines WHERE id=?", (mid,)).fetchone()
    if not old:
        conn.close()
        return jsonify({"msg": "机器不存在"})
    old_kind = old["task_kind"]
    if old_kind == new_kind:
        conn.close()
        return jsonify({"msg": "任务类型未变化"})
    conn.execute("UPDATE machines SET task_kind=? WHERE id=?", (new_kind, mid))
    new_full_name = f"{old['name']}({old['type']}/{new_kind})"
    conn.execute(
        "UPDATE schedules SET machine_name=? WHERE machine_id=? AND status!='completed'",
        (new_full_name, mid),
    )
    conn.commit()
    conn.close()
    return jsonify({"msg": f"机器任务类型已从 {old_kind} 改为 {new_kind}"})


@bp.route('/update_machines_bulk', methods=['POST'])
def update_machines_bulk():
    d = request.get_json() or {}
    items = d.get("items") or []
    if not isinstance(items, list):
        return jsonify({"msg": "参数错误"})
    conn = get_db()
    updated = 0
    for it in items:
        try:
            mid = int(it.get("id"))
        except Exception:
            continue
        name = (it.get("name") or "").strip()
        task_kind = (it.get("task_kind") or "常规").strip()
        group_name = (it.get("group_name") or "").strip()
        if not name:
            continue
        if task_kind not in get_allowed_task_kinds():
            task_kind = "常规"
        allowed_groups = get_allowed_machine_groups()
        if group_name and group_name not in allowed_groups:
            group_name = ""
        old = conn.execute("SELECT name FROM machines WHERE id=?", (mid,)).fetchone()
        conn.execute("UPDATE machines SET name=?, task_kind=?, group_name=? WHERE id=?", (name, task_kind, group_name, mid))
        if old and old["name"] != name:
            conn.execute("UPDATE schedules SET machine_name=? WHERE machine_id=?", (name, mid))
        updated += 1
    conn.commit()
    conn.close()
    return jsonify({"msg": f"已保存 {updated} 条机器信息"})


@bp.route('/del_machine/<int:mid>')
def del_machine(mid):
    conn = get_db()

    # 飞书联动：删除对应表格和映射
    try:
        from feishu_sync import on_machine_deleted
        on_machine_deleted(mid)
    except Exception:
        pass

    conn.execute("DELETE FROM machines WHERE id=?", (mid,))
    conn.commit()
    conn.close()
    return jsonify({"msg": "删除成功"})


@bp.route("/recall_machine_tasks", methods=["POST"])
def recall_machine_tasks():
    d = request.get_json() or {}
    date = parse_date(d.get("date"))
    try:
        mid = int(d.get("machine_id"))
    except Exception:
        return jsonify({"msg": "参数错误"})

    conn = get_db()
    count, affected = recycle_schedules(conn, machine_id=mid, date=date)
    conn.commit()
    conn.close()
    if count == 0:
        return jsonify({"msg": "没有可回收的任务"})
    return jsonify({"msg": f"已回收 {count} 条排班任务"})
