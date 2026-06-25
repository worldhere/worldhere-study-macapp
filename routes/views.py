import datetime
from flask import Blueprint, render_template, request, jsonify

from db import get_db, DB_PATH
from utils import parse_date, find_best_default_date
from save_utils import get_save_dir, list_saves, _get_app_mtime
from feishu_sync import compute_task_statuses

from models import load_shift_config, load_app_config

bp = Blueprint('views', __name__)


@bp.route('/')
def index():
    date_param = request.args.get("date")
    selected_date = parse_date(date_param) if date_param else find_best_default_date()
    m_sort = (request.args.get("m_sort") or "name").strip()
    m_dir = (request.args.get("m_dir") or "asc").strip()
    m_type_list = request.args.getlist("m_type")
    m_status_list = request.args.getlist("m_status")
    m_kind_list = request.args.getlist("m_kind")
    m_group_list = request.args.getlist("m_group")
    # backward-compat single values for template sort links
    m_type = m_type_list[0] if m_type_list else ""
    m_status = m_status_list[0] if m_status_list else ""
    m_kind = m_kind_list[0] if m_kind_list else ""
    m_group = m_group_list[0] if m_group_list else ""
    task_sort = (request.args.get("task_sort") or "id").strip()
    task_dir = (request.args.get("task_dir") or "asc").strip()
    shift_config = load_shift_config()
    app_config = load_app_config()
    history_date_from = (request.args.get("history_date_from") or "").strip()
    history_date_to = (request.args.get("history_date_to") or "").strip()

    # 检测是否有来自旧版本的存档
    version_mismatch = False
    current_mtime = 0.0
    try:
        save_dir = get_save_dir(DB_PATH)
        current_mtime = _get_app_mtime()
        for s in list_saves(save_dir):
            if s.get("app_mtime") and abs(s["app_mtime"] - current_mtime) > 1:
                version_mismatch = True
                break
    except Exception:
        pass

    return render_template(
        'index.html',
        selected_date=selected_date,
        db_path=DB_PATH,
        app_config=app_config,
        m_sort=m_sort,
        m_dir=m_dir,
        m_type=m_type,
        m_status=m_status,
        m_kind=m_kind,
        m_group=m_group,
        task_sort=task_sort,
        task_dir=task_dir,
        shift=shift_config,
        history_date_from=history_date_from,
        history_date_to=history_date_to,
        version_mismatch=version_mismatch,
        current_app_mtime=current_mtime,
    )


@bp.route('/current_status')
def current_status():
    now = datetime.datetime.now()
    now_date = now.date().isoformat()
    now_min = now.hour * 60 + now.minute

    conn = get_db()
    alert_row = conn.execute(
        "SELECT value FROM config WHERE category='schedule_settings' AND key='pending_alert_minutes'"
    ).fetchone()
    alert_minutes = int(alert_row["value"]) if alert_row else 15

    machines_rows = conn.execute("SELECT id, status FROM machines").fetchall()
    # 基线归一化：非维修机器统一从"空闲"开始，只对进行中任务的提升为"工作"
    machine_statuses = {}
    for m in machines_rows:
        mid = int(m["id"])
        machine_statuses[mid] = "空闲" if m["status"] != "维修停用" else "维修停用"

    task_statuses = compute_task_statuses(conn, alert_minutes)

    # 有当前任务且非维修的机器标记为"工作"（与 compute_task_statuses 逻辑一致）
    now_dt = now
    schedules_rows = conn.execute(
        "SELECT machine_id, date, start_min, end_min FROM schedules WHERE status != 'completed'"
    ).fetchall()
    for s in schedules_rows:
        mid = int(s["machine_id"])
        if machine_statuses.get(mid) == "维修停用":
            continue
        try:
            base_date = datetime.date.fromisoformat(s["date"])
            start_dt = datetime.datetime.combine(base_date, datetime.time.min) + datetime.timedelta(minutes=int(s["start_min"]))
            end_dt = datetime.datetime.combine(base_date, datetime.time.min) + datetime.timedelta(minutes=int(s["end_min"]))
        except ValueError:
            continue
        if start_dt <= now < end_dt:
            machine_statuses[mid] = "工作"

    conn.close()

    return jsonify({
        "task_statuses": task_statuses,
        "machine_statuses": machine_statuses,
        "now_min": now_min,
        "now_date": now_date,
    })


