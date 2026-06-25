import os
import json
import datetime
import tempfile
from flask import Blueprint, request, jsonify

from db import get_db, get_allowed_task_kinds
from models import recycle_schedules
from feishu.schedule_sync import on_local_recycle
from utils import parse_duration_to_minutes
from import_utils import parse_excel, analyze_import, execute_import, list_excel_sheets
from models import list_task_packages, create_task_package, update_task_package, delete_task_package, add_tasks_to_package, get_package_tasks, task_insert_values, TASK_INSERT_FIELDS, TASK_INSERT_PLACEHOLDERS, recycle_split_segment


bp = Blueprint('tasks', __name__)


@bp.route('/api/tasks')
def api_tasks():
    from models import list_tasks
    tasks = list_tasks(sort_by="id", sort_dir="asc")
    return jsonify({"tasks": tasks})


@bp.route('/add_task', methods=['POST'])
def add_task():
    d = request.get_json()
    name = (d.get("name") or "").strip()
    rbp_id = (d.get("rbp_task_id") or "").strip()
    if not name and not rbp_id:
        return jsonify({"msg": "任务名和RBP任务ID至少需要填写一个"}), 400
    conn = get_db()
    task_kind = (d.get("task_kind") or "").strip()
    allowed = get_allowed_task_kinds()
    if not task_kind or task_kind not in allowed:
        task_kind = allowed[0] if allowed else "常规"

    est_mode = (d.get("est_mode") or "auto").strip().lower()
    if est_mode not in ("auto", "blank", "direct", "calc"):
        est_mode = "auto"
    duration = (d.get("duration") or "").strip()

    op_min = d.get("op_min")
    reset_min = d.get("reset_min")
    collect_count = d.get("collect_count")
    redundancy_min = d.get("redundancy_min")
    est_minutes = None
    est_seconds = None

    if est_mode == "direct":
        if duration:
            m = parse_duration_to_minutes(duration, default_minutes=0)
            if m:
                est_seconds = int(m) * 60
    elif est_mode == "calc":
        try:
            op = int(op_min or 0)
            rs = int(reset_min or 0)
            cnt = int(collect_count or 0)
            red = int(redundancy_min or 0)
        except Exception:
            op, rs, cnt, red = 0, 0, 0, 0
        op = max(0, op)
        rs = max(0, rs)
        cnt = max(0, cnt)
        red = max(0, red)
        est_seconds = (op + rs) * cnt + red * 60
        duration = ""
    else:
        # auto/blank: keep existing duration if auto-estimated, clear if blank
        if est_mode == "blank":
            duration = ""

    remark = (d.get("remark") or "").strip()
    rbp_id = (d.get("rbp_task_id") or "").strip()
    scene = (d.get("scene") or "").strip()
    general_category = (d.get("general_category") or "").strip()
    source_link = (d.get("source_link") or "").strip()
    expected_count = d.get("expected_count")
    if est_mode == "calc" and collect_count and not expected_count:
        expected_count = int(collect_count or 0)
    collection_req_id = (d.get("collection_req_id") or "").strip()
    collection_req_type = (d.get("collection_req_type") or "").strip()
    conn.execute(
        "INSERT INTO tasks(name,type,task_kind,priority,difficulty,duration,est_mode,op_min,reset_min,collect_count,redundancy_min,est_minutes,est_seconds,remark,status, rbp_task_id,scene,general_category,source_link,expected_count,collection_req_id,collection_req_type) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            d["name"],
            d["type"],
            task_kind,
            d.get("pri"),
            d.get("diff"),
            duration,
            est_mode,
            op_min,
            reset_min,
            collect_count,
            redundancy_min,
            est_minutes,
            est_seconds,
            remark,
            "待分配",
            rbp_id,
            scene,
            general_category,
            source_link,
            expected_count,
            collection_req_id,
            collection_req_type,
        ),
    )
    conn.commit()
    conn.close()
    return jsonify({"msg": "新增成功"})


@bp.route("/api/recycle", methods=["POST"])
def api_recycle():
    d = request.get_json() or {}
    schedule_ids = d.get("schedule_ids")
    task_ids = d.get("task_ids")
    machine_id = d.get("machine_id")
    date = d.get("date")
    if not schedule_ids and not task_ids and not (machine_id and date):
        return jsonify({"msg": "参数错误：需要 schedule_ids、task_ids 或 machine_id+date"}), 400
    conn = get_db()
    on_local_recycle(conn, schedule_ids=schedule_ids, task_ids=task_ids,
                     machine_id=machine_id, date=date)
    count, affected = recycle_schedules(
        conn,
        schedule_ids=[int(x) for x in schedule_ids] if schedule_ids else None,
        task_ids=[int(x) for x in task_ids] if task_ids else None,
        machine_id=int(machine_id) if machine_id else None,
        date=date if date else None,
    )
    conn.commit()
    conn.close()
    return jsonify({"msg": f"已回收 {count} 个任务", "recycled_count": count, "affected_task_ids": affected})


@bp.route('/batch_tasks', methods=['POST'])
def batch_tasks():
    d = request.get_json() or {}
    action = (d.get("action") or "").strip()
    ids = d.get("ids") or []
    if not isinstance(ids, list) or len(ids) == 0:
        return jsonify({"msg": "参数错误"})
    conn = get_db()
    if action == "recycle":
        on_local_recycle(conn, task_ids=ids)
        count, _ = recycle_schedules(conn, task_ids=[int(tid) for tid in ids])
        msg = f"已回收 {count} 个任务"
    elif action == "complete":
        now = datetime.datetime.now().isoformat(timespec="seconds")
        # actual_end_min: current time-of-day in minutes.  If the current minute-of-day
        # is less than the schedule's start_min, the task crossed midnight → add 1440.
        for tid in ids:
            conn.execute(
                "UPDATE schedules SET status='completed', completed_at=?,"
                " actual_end_min=CASE"
                "  WHEN CAST(strftime('%H','now','localtime') AS INTEGER)*60"
                "      +CAST(strftime('%M','now','localtime') AS INTEGER) < start_min"
                "  THEN CAST(strftime('%H','now','localtime') AS INTEGER)*60"
                "      +CAST(strftime('%M','now','localtime') AS INTEGER)+1440"
                "  ELSE CAST(strftime('%H','now','localtime') AS INTEGER)*60"
                "      +CAST(strftime('%M','now','localtime') AS INTEGER)"
                " END"
                " WHERE task_id=?",
                (now, int(tid)),
            )
        conn.executemany("UPDATE tasks SET status='已完成' WHERE id=?", [(int(tid),) for tid in ids])
        msg = f"已完成 {len(ids)} 个任务"
    elif action == "delete":
        for tid in ids:
            row = conn.execute("SELECT * FROM tasks WHERE id=?", (int(tid),)).fetchone()
            if row:
                conn.execute(
                    "INSERT INTO deletion_log(deleted_at, table_name, record_id, record_json) VALUES (?,?,?,?)",
                    (datetime.datetime.now().isoformat(timespec="seconds"), "tasks", int(tid), json.dumps(dict(row), ensure_ascii=False)),
                )
            conn.execute("DELETE FROM schedules WHERE task_id=?", (int(tid),))
        conn.executemany("DELETE FROM tasks WHERE id=?", [(int(tid),) for tid in ids])
        msg = f"已删除 {len(ids)} 个任务，可在删除记录中恢复"
    else:
        conn.close()
        return jsonify({"msg": "未知操作"})
    conn.commit()
    conn.close()
    return jsonify({"msg": msg})


@bp.route('/update_task', methods=['POST'])
def update_task():
    d = request.get_json()
    tid = int(d.get("id"))
    conn = get_db()

    # 读取现有记录，支持部分更新（未传字段保持原值）
    existing = conn.execute("SELECT * FROM tasks WHERE id=?", (tid,)).fetchone()
    if not existing:
        conn.close()
        return jsonify({"msg": "任务不存在"}), 404

    def _val(key, default=""):
        """取请求字段，未传则保持 DB 原值"""
        if key in d:
            raw = d[key]
            return raw if raw is not None else default
        return (existing[key] or default) if key in existing.keys() else default

    name = (_val("name") or _val("rbp_task_id") or "").strip()
    rbp_id = (_val("rbp_task_id") or _val("name") or "").strip()
    # name 保持优先取 name，rbp_id 同理；两者可互为 fallback

    task_kind_raw = d.get("task_kind")
    if task_kind_raw is not None and task_kind_raw != "":
        task_kind = str(task_kind_raw).strip()
    else:
        task_kind = (existing["task_kind"] or "").strip()
    allowed = get_allowed_task_kinds()
    if not task_kind or task_kind not in allowed:
        task_kind = allowed[0] if allowed else "常规"

    est_mode_raw = d.get("est_mode")
    if est_mode_raw is not None:
        est_mode = str(est_mode_raw).strip().lower() or "auto"
    else:
        est_mode = (existing["est_mode"] or "auto").strip().lower()
    if est_mode not in ("auto", "blank", "direct", "calc"):
        est_mode = "auto"

    duration = (_val("duration") or "").strip()
    est_seconds = None

    if est_mode == "direct":
        if duration:
            m = parse_duration_to_minutes(duration, default_minutes=0)
            if m:
                est_seconds = int(m) * 60
    elif est_mode == "calc":
        try:
            def _num(key, fallback=0):
                v = d.get(key)
                if v is None or v == '':
                    return int(existing.get(key) or fallback)
                return max(0, int(v))
            op = _num("op_min")
            rs = _num("reset_min")
            cnt = _num("collect_count")
            red = _num("redundancy_min")
        except Exception:
            op, rs, cnt, red = 0, 0, 0, 0
        est_seconds = (op + rs) * cnt + red * 60
        duration = ""
    else:
        # auto: keep auto-estimated duration; blank: clear it
        if est_mode == "blank":
            duration = ""

    expected_count = d.get("expected_count")
    if est_mode == "calc" and d.get("collect_count") and not expected_count:
        expected_count = int(d.get("collect_count") or 0)

    _type = _val("type")
    _pri = _val("priority") or d.get("pri")
    _diff = _val("difficulty") or d.get("diff")
    _remark = (_val("remark") or "").strip()
    _scene = (_val("scene") or "").strip()
    _general_category = (_val("general_category") or "").strip()
    _source_link = (_val("source_link") or "").strip()
    _collection_req_id = (_val("collection_req_id") or "").strip()
    _collection_req_type = (_val("collection_req_type") or "").strip()

    conn.execute(
        "UPDATE tasks SET name=?, type=?, task_kind=?, priority=?, difficulty=?, duration=?, est_mode=?, op_min=?, reset_min=?, collect_count=?, redundancy_min=?, est_seconds=?, remark=?, est_minutes=NULL, rbp_task_id=?, scene=?, general_category=?, source_link=?, expected_count=?, collection_req_id=?, collection_req_type=? WHERE id=?",
        (
            name, _type, task_kind,
            _pri, _diff,
            duration, est_mode,
            d.get("op_min"), d.get("reset_min"),
            d.get("collect_count"), d.get("redundancy_min"),
            est_seconds,
            _remark,
            rbp_id,
            _scene,
            _general_category,
            _source_link,
            expected_count,
            _collection_req_id,
            _collection_req_type,
            tid,
        ),
    )
    conn.execute(
        "UPDATE schedules SET task_name=?, task_type=?, task_kind=?, remark=? WHERE task_id=?",
        (name, _type, task_kind, _remark, tid),
    )
    conn.commit()
    conn.close()
    return jsonify({"msg": "修改成功"})


@bp.route('/del_task/<int:tid>')
def del_task(tid):
    conn = get_db()
    row = conn.execute("SELECT * FROM tasks WHERE id=?", (tid,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"msg": "任务不存在"})
    record_json = json.dumps(dict(row), ensure_ascii=False)
    conn.execute(
        "INSERT INTO deletion_log(deleted_at, table_name, record_id, record_json) VALUES (?,?,?,?)",
        (datetime.datetime.now().isoformat(timespec="seconds"), "tasks", tid, record_json),
    )

    recovered_to = None
    exp_val = 0

    if row["split_group"] and row["split_order"] is not None:
        recovered_to, exp_val = recycle_split_segment(conn, row)

    conn.execute("DELETE FROM tasks WHERE id=?", (tid,))
    conn.execute("DELETE FROM schedules WHERE task_id=?", (tid,))
    conn.commit()
    conn.close()

    if recovered_to and exp_val > 0:
        return jsonify({"msg": "已删除，" + str(exp_val) + " 条数据已回收至「" + recovered_to + "」"})
    return jsonify({"msg": "删除成功，可在删除记录中恢复"})


@bp.route("/recall_task_to_pool", methods=["POST"])
def recall_task_to_pool():
    d = request.get_json() or {}
    try:
        tid = int(d.get("task_id"))
    except Exception:
        return jsonify({"msg": "参数错误"})
    conn = get_db()
    count, affected = recycle_schedules(conn, task_ids=[tid])
    task = conn.execute("SELECT id, name, type, task_kind, priority, difficulty, est_seconds, status FROM tasks WHERE id=?", (tid,)).fetchone()
    if task and task["status"] == "已完成":
        conn.execute("UPDATE tasks SET status=? WHERE id=?", ("待分配", tid))
    conn.commit()
    conn.close()
    result = {"msg": "已回收到未分配"}
    if task:
        result["task"] = {"id": task["id"], "name": task["name"], "type": task["type"], "task_kind": task["task_kind"], "priority": task["priority"] or "", "difficulty": task["difficulty"] or "", "est_seconds": task["est_seconds"] or 0}
    return jsonify(result)


@bp.route("/finish_task", methods=["POST"])
def finish_task():
    d = request.get_json() or {}
    try:
        tid = int(d.get("task_id"))
    except Exception:
        return jsonify({"msg": "参数错误"})
    conn = get_db()
    # 完成该任务的所有排班，防止残留活动排班导致状态不一致
    now = datetime.datetime.now().isoformat(timespec="seconds")
    conn.execute(
        "UPDATE schedules SET status='completed', completed_at=?,"
        " actual_end_min=CAST(strftime('%H','now','localtime') AS INTEGER)*60"
        " + CAST(strftime('%M','now','localtime') AS INTEGER)"
        " WHERE task_id=? AND status!='completed'",
        (now, tid),
    )
    conn.execute("UPDATE tasks SET status=? WHERE id=?", ("已完成", tid))
    conn.commit()
    conn.close()
    return jsonify({"msg": "已标记完成"})


@bp.route('/import_tasks/preview', methods=['POST'])
def import_tasks_preview():
    """上传 Excel，返回字段映射和去重分析结果"""
    f = request.files.get('file')
    if not f:
        return jsonify({"msg": "请选择文件"}), 400
    ext = os.path.splitext(f.filename or "")[1].lower()
    if ext not in ('.xlsx', '.xls'):
        return jsonify({"msg": "仅支持 .xlsx / .xls 格式"}), 400

    sheet = request.form.get("sheet") or None

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=ext)
    try:
        f.save(tmp.name)
        tmp.close()
        sheets = list_excel_sheets(tmp.name)
        field_map, rows, headers = parse_excel(tmp.name, sheet_name=sheet)
        if not rows:
            return jsonify({"msg": "未读取到任何数据行，请检查 Excel 格式", "sheets": sheets}), 400
        if "name" not in field_map:
            return jsonify({
                "msg": "未识别到「任务名」相关列，请检查表头。已识别的列: " + (", ".join(headers) if headers else "无"),
                "headers": headers,
                "sheets": sheets,
            }), 400

        result = analyze_import(rows, field_map)
        result["msg"] = f"解析完成：{result['valid_items']} 条有效数据，{result['ok_count']} 条可导入，{result['rbp_dup_count']} 条ID重复，{result['name_type_dup_count']} 条疑似重复"
        result["headers"] = headers
        result["sheets"] = sheets
        result["active_sheet"] = sheet or (sheets[0] if sheets else "")
        return jsonify(result)
    finally:
        try:
            os.unlink(tmp.name)
        except Exception:
            pass


@bp.route('/import_tasks/execute', methods=['POST'])
def import_tasks_execute():
    """执行导入（前端确认后的数据）"""
    d = request.get_json() or {}
    items = d.get("items") or []
    if not isinstance(items, list) or len(items) == 0:
        return jsonify({"msg": "没有可导入的任务"}), 400

    # 同步缺失的枚举类型到设置
    sync_missing = d.get("sync_missing_types") or {}
    CATEGORY_MAP = {
        "type": "machine_types",
        "task_kind": "task_kinds",
        "priority": "priorities",
        "difficulty": "difficulties",
    }
    synced = {}
    if sync_missing:
        conn = get_db()
        for field, category in CATEGORY_MAP.items():
            vals = sync_missing.get(field) or []
            for val in vals:
                val_str = str(val).strip()
                if not val_str:
                    continue
                exists = conn.execute(
                    "SELECT COUNT(*) AS c FROM config WHERE category=? AND key=?",
                    (category, val_str),
                ).fetchone()["c"]
                if not exists:
                    max_order = conn.execute(
                        "SELECT COALESCE(MAX(sort_order), 0) AS m FROM config WHERE category=?",
                        (category,),
                    ).fetchone()["m"]
                    conn.execute(
                        "INSERT INTO config(category, key, value, sort_order) VALUES (?,?,?,?)",
                        (category, val_str, "", max_order + 1),
                    )
                    if field not in synced:
                        synced[field] = []
                    synced[field].append(val_str)
        conn.commit()
        conn.close()

    result = execute_import(items)
    result["msg"] = f"导入完成：成功 {result['imported']} 条，跳过 {result['skipped']} 条"
    if synced:
        result["synced_types"] = synced
    return jsonify(result)


@bp.route('/deletion_log')
def api_deletion_log():
    conn = get_db()
    rows = conn.execute(
        "SELECT id, deleted_at, table_name, record_id, record_json FROM deletion_log ORDER BY id DESC LIMIT 200"
    ).fetchall()
    conn.close()
    result = []
    for r in rows:
        item = dict(r)
        try:
            item["record"] = json.loads(item["record_json"])
        except Exception:
            item["record"] = {}
        del item["record_json"]
        result.append(item)
    return jsonify({"items": result})


@bp.route('/restore_task/<int:log_id>', methods=['POST'])
def restore_task(log_id):
    conn = get_db()
    row = conn.execute("SELECT * FROM deletion_log WHERE id=?", (log_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"msg": "删除记录不存在"})
    record = json.loads(row["record_json"])
    try:
        allowed_kinds = get_allowed_task_kinds()
        if not record.get("task_kind"):
            record["task_kind"] = allowed_kinds[0] if allowed_kinds else "常规"
        conn.execute(
            f"INSERT INTO tasks({TASK_INSERT_FIELDS}) VALUES ({TASK_INSERT_PLACEHOLDERS})",
            task_insert_values(record, "待分配"),
        )
        conn.execute("DELETE FROM deletion_log WHERE id=?", (log_id,))
        conn.commit()
        msg = "已恢复"
    except Exception as e:
        msg = f"恢复失败: {e}"
    finally:
        conn.close()
    return jsonify({"msg": msg})


@bp.route('/permanent_delete_log/<int:log_id>', methods=['POST'])
def permanent_delete_log(log_id):
    conn = get_db()
    row = conn.execute("SELECT * FROM deletion_log WHERE id=?", (log_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({"msg": "删除记录不存在"})
    conn.execute("DELETE FROM deletion_log WHERE id=?", (log_id,))
    conn.commit()
    conn.close()
    return jsonify({"msg": "已永久删除"})


@bp.route('/batch_restore_tasks', methods=['POST'])
def batch_restore_tasks():
    d = request.get_json() or {}
    ids = d.get("ids") or []
    if not isinstance(ids, list) or len(ids) == 0:
        return jsonify({"msg": "参数错误"})
    conn = get_db()
    restored = 0
    errors = 0
    for log_id in ids:
        try:
            row = conn.execute(
                "SELECT * FROM deletion_log WHERE id=?", (int(log_id),)
            ).fetchone()
            if not row:
                errors += 1
                continue
            record = json.loads(row["record_json"])
            allowed = get_allowed_task_kinds()
            if not record.get("task_kind"):
                record["task_kind"] = allowed[0] if allowed else "常规"
            conn.execute(
                f"INSERT INTO tasks({TASK_INSERT_FIELDS}) VALUES ({TASK_INSERT_PLACEHOLDERS})",
                task_insert_values(record, "待分配"),
            )
            conn.execute("DELETE FROM deletion_log WHERE id=?", (int(log_id),))
            restored += 1
        except Exception:
            errors += 1
    conn.commit()
    conn.close()
    return jsonify({"msg": f"已恢复 {restored} 项，失败 {errors} 项"})


@bp.route('/batch_permanent_delete_logs', methods=['POST'])
def batch_permanent_delete_logs():
    d = request.get_json() or {}
    ids = d.get("ids") or []
    if not isinstance(ids, list) or len(ids) == 0:
        return jsonify({"msg": "参数错误"})
    conn = get_db()
    deleted = 0
    for log_id in ids:
        conn.execute("DELETE FROM deletion_log WHERE id=?", (int(log_id),))
        deleted += 1
    conn.commit()
    conn.close()
    return jsonify({"msg": f"已永久删除 {deleted} 项"})


@bp.route('/get_task/<int:tid>')
def get_task(tid):
    conn = get_db()
    row = conn.execute("SELECT * FROM tasks WHERE id=?", (tid,)).fetchone()
    conn.close()
    if not row:
        return jsonify({"error": "任务不存在"}), 404
    return jsonify(dict(row))


# ========== 任务包 API ==========

@bp.route('/api/task_packages')
def api_task_packages():
    completed_only = request.args.get("completed", "").lower() == "true"
    packages = list_task_packages(completed_only=completed_only)
    return jsonify({"packages": packages})


@bp.route('/api/task_packages', methods=['POST'])
def api_create_task_package():
    d = request.get_json() or {}
    name = (d.get("name") or "").strip()
    if not name:
        return jsonify({"msg": "任务包名称不能为空"}), 400
    pid = create_task_package(
        name=name,
        deadline=d.get("deadline") or None,
        machine_type=d.get("machine_type") or "BR2",
        priority=d.get("priority") or "P1",
    )
    return jsonify({"msg": "创建成功", "id": pid})


@bp.route('/api/task_packages/<int:pid>', methods=['PUT'])
def api_update_task_package(pid):
    d = request.get_json() or {}
    update_task_package(
        package_id=pid,
        name=d.get("name"),
        deadline=d.get("deadline"),
        machine_type=d.get("machine_type"),
        priority=d.get("priority"),
    )
    return jsonify({"msg": "修改成功"})


@bp.route('/api/task_packages/<int:pid>', methods=['DELETE'])
def api_delete_task_package(pid):
    cascade = request.args.get("cascade", "false").lower() == "true"
    delete_task_package(pid, cascade=cascade)
    return jsonify({"msg": "任务包已删除"})


@bp.route('/api/task_packages/<int:pid>/add_tasks', methods=['POST'])
def api_add_tasks_to_package(pid):
    d = request.get_json() or {}
    task_ids = d.get("task_ids") or []
    if not isinstance(task_ids, list) or len(task_ids) == 0:
        return jsonify({"msg": "请选择至少一个任务"}), 400
    add_tasks_to_package(pid, task_ids)
    return jsonify({"msg": f"已添加 {len(task_ids)} 个任务"})


@bp.route('/api/task_packages/<int:pid>/tasks')
def api_get_package_tasks(pid):
    tasks = get_package_tasks(pid)
    return jsonify({"tasks": tasks})


# ========== 任务包 Excel 导入 ==========

@bp.route('/import_task_package/preview', methods=['POST'])
def import_task_package_preview():
    """上传 Excel → 解析 → 检测任务包名 → 返回预览"""
    f = request.files.get('file')
    if not f:
        return jsonify({"msg": "请选择文件"}), 400
    ext = os.path.splitext(f.filename or "")[1].lower()
    if ext not in ('.xlsx', '.xls'):
        return jsonify({"msg": "仅支持 .xlsx / .xls 格式"}), 400

    sheet = request.form.get("sheet") or None

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=ext)
    try:
        f.save(tmp.name)
        tmp.close()
        sheets = list_excel_sheets(tmp.name)
        field_map, rows, headers = parse_excel(tmp.name, sheet_name=sheet)
        if not rows:
            return jsonify({"msg": "未读取到任何数据行", "sheets": sheets}), 400
        if "name" not in field_map:
            return jsonify({"msg": "未识别到「任务名」相关列", "sheets": sheets}), 400

        result = analyze_import(rows, field_map)

        package_name = None
        package_deadline = None
        if "package_name" in field_map:
            vals = [r.get("package_name") for r in rows if r.get("package_name")]
            v = str(vals[0]).strip() if vals else ""
            if v:
                package_name = v
        if "package_deadline" in field_map:
            dl_vals = [r.get("package_deadline") for r in rows if r.get("package_deadline")]
            dl = str(dl_vals[0]).strip() if dl_vals else ""
            if dl:
                package_deadline = dl

        if not package_name:
            # 用当前工作表名做任务包名
            active = sheet or (sheets[0] if sheets else "")
            if active and active.lower() not in ("sheet1", "sheet", "工作表1"):
                package_name = active
            else:
                fname = f.filename or ""
                if "任务包" in fname:
                    fn_noext = os.path.splitext(fname)[0]
                    package_name = fn_noext

        result["package_name"] = package_name
        result["package_deadline"] = package_deadline
        result["msg"] = f"解析完成：{result['valid_items']} 条有效数据"
        result["headers"] = headers
        result["sheets"] = sheets
        result["active_sheet"] = sheet or (sheets[0] if sheets else "")
        return jsonify(result)
    finally:
        try:
            os.unlink(tmp.name)
        except Exception:
            pass


@bp.route('/import_task_package/preview_all', methods=['POST'])
def import_task_package_preview_all():
    """上传多工作表 Excel → 解析所有工作表 → 返回各自预览"""
    f = request.files.get('file')
    if not f:
        return jsonify({"msg": "请选择文件"}), 400
    ext = os.path.splitext(f.filename or "")[1].lower()
    if ext not in ('.xlsx', '.xls'):
        return jsonify({"msg": "仅支持 .xlsx / .xls 格式"}), 400

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=ext)
    try:
        f.save(tmp.name)
        tmp.close()
        sheets = list_excel_sheets(tmp.name)
        if not sheets:
            return jsonify({"msg": "未读取到任何工作表"}), 400

        all_results = []
        for sheet_name in sheets:
            field_map, rows, headers = parse_excel(tmp.name, sheet_name=sheet_name)
            if not rows or "name" not in field_map:
                all_results.append({
                    "sheet_name": sheet_name,
                    "package_name": sheet_name if sheet_name.lower() not in ("sheet1", "sheet", "工作表1") else None,
                    "package_deadline": None,
                    "valid_items": 0,
                    "ok_count": 0,
                    "rbp_dup_count": 0,
                    "name_type_dup_count": 0,
                    "field_map": {},
                    "items": [],
                    "headers": headers,
                    "error": "name" not in field_map and "未识别到「任务名」相关列" or "未读取到任何数据行",
                    "selected": False,
                })
                continue

            result = analyze_import(rows, field_map)

            package_name = None
            package_deadline = None
            if "package_name" in field_map:
                vals = [r.get("package_name") for r in rows if r.get("package_name")]
                v = str(vals[0]).strip() if vals else ""
                if v:
                    package_name = v
            if "package_deadline" in field_map:
                dl_vals = [r.get("package_deadline") for r in rows if r.get("package_deadline")]
                dl = str(dl_vals[0]).strip() if dl_vals else ""
                if dl:
                    package_deadline = dl

            if not package_name:
                if sheet_name.lower() not in ("sheet1", "sheet", "工作表1"):
                    package_name = sheet_name
                else:
                    fname = f.filename or ""
                    if "任务包" in fname:
                        package_name = os.path.splitext(fname)[0]

            result["sheet_name"] = sheet_name
            result["package_name"] = package_name
            result["package_deadline"] = package_deadline
            result["headers"] = headers
            result["selected"] = True
            all_results.append(result)

        total_items = sum(r.get("valid_items", 0) for r in all_results)
        return jsonify({
            "sheets": sheets,
            "results": all_results,
            "total_items": total_items,
            "msg": f"共 {len(sheets)} 个工作表，{total_items} 条有效数据",
        })
    finally:
        try:
            os.unlink(tmp.name)
        except Exception:
            pass


@bp.route('/import_task_package/execute', methods=['POST'])
def import_task_package_execute():
    d = request.get_json() or {}
    items = d.get("items") or []
    if not isinstance(items, list) or len(items) == 0:
        return jsonify({"msg": "没有可导入的任务"}), 400

    package_name = (d.get("package_name") or "").strip()
    if not package_name:
        package_name = "未命名任务包"
    package_deadline = (d.get("package_deadline") or "").strip() or None

    machine_type = (d.get("machine_type") or "BR2").strip()
    result = execute_import(items, package_name=package_name, package_deadline=package_deadline,
                           machine_type=machine_type)
    result["msg"] = f"导入完成：成功 {result['imported']} 条到任务包「{package_name}」，跳过 {result['skipped']} 条"
    return jsonify(result)


@bp.route('/import_task_package/execute_all', methods=['POST'])
def import_task_package_execute_all():
    """批量导入多个工作表为多个任务包"""
    d = request.get_json() or {}
    packages = d.get("packages") or []
    if not isinstance(packages, list) or len(packages) == 0:
        return jsonify({"msg": "没有可导入的任务包"}), 400

    total_imported = 0
    total_skipped = 0
    all_errors = []

    for pkg in packages:
        items = pkg.get("items") or []
        if not items:
            continue
        package_name = (pkg.get("package_name") or "").strip()
        if not package_name:
            package_name = "未命名任务包"
        package_deadline = (pkg.get("package_deadline") or "").strip() or None
        machine_type = (pkg.get("machine_type") or "BR2").strip()

        result = execute_import(items, package_name=package_name,
                               package_deadline=package_deadline,
                               machine_type=machine_type)
        total_imported += result["imported"]
        total_skipped += result["skipped"]
        all_errors.extend(result.get("errors", []))

    return jsonify({
        "imported": total_imported,
        "skipped": total_skipped,
        "errors": all_errors,
        "msg": f"批量导入完成：成功 {total_imported} 条到 {len(packages)} 个任务包，跳过 {total_skipped} 条",
    })
