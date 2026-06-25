import os
from flask import Blueprint, request, jsonify, send_file

from db import DB_PATH, get_db_info, init_db
from feishu_sync import stop_pull_thread, start_pull_thread
from save_utils import (
    get_save_dir,
    list_saves,
    create_save,
    restore_save,
    delete_save,
    rotate_autosaves,
    _get_app_mtime,
    get_db_path_effective,
    transfer_database,
    switch_database,
    change_save_directory,
)

bp = Blueprint("saves", __name__)
SAVE_DIR = get_save_dir(DB_PATH)


@bp.route("/api/saves")
def api_list_saves():
    saves = list_saves(SAVE_DIR)
    db_info = get_db_info(DB_PATH)
    return jsonify({
        "saves": saves,
        "db_info": db_info,
        "save_dir": SAVE_DIR,
        "current_app_mtime": _get_app_mtime(),
    })


@bp.route("/api/saves/quick", methods=["POST"])
def api_quick_save():
    d = request.get_json() or {}
    note = (d.get("note") or "").strip()
    fname = create_save(DB_PATH, SAVE_DIR, note=note, is_autosave=False)
    if fname:
        rotate_autosaves(SAVE_DIR, db_path=DB_PATH)
        return jsonify({"msg": f"存档成功：{fname}", "filename": fname})
    return jsonify({"msg": "存档失败"}), 500


@bp.route("/api/saves/auto", methods=["POST"])
def api_auto_save():
    fname = create_save(DB_PATH, SAVE_DIR, note="", is_autosave=True)
    if fname:
        rotate_autosaves(SAVE_DIR, db_path=DB_PATH)
        return jsonify({"msg": "自动存档完成", "filename": fname})
    return jsonify({"msg": "自动存档失败"}), 500


@bp.route("/api/saves/load", methods=["POST"])
def api_load_save():
    d = request.get_json() or {}
    filename = (d.get("filename") or "").strip()
    if not filename:
        return jsonify({"msg": "请指定存档文件名"}), 400

    if ".." in filename or "/" in filename or "\\" in filename:
        return jsonify({"msg": "无效的存档文件名"}), 400

    stop_pull_thread()
    success = restore_save(SAVE_DIR, filename, DB_PATH)
    start_pull_thread()
    if success:
        return jsonify({"msg": f"读档成功，将从存档「{filename}」恢复。请重启应用以使数据生效。"})
    return jsonify({"msg": "读档失败，存档文件不存在或已损坏"}), 500


@bp.route("/api/saves/<filename>", methods=["DELETE"])
def api_delete_save(filename):
    if ".." in filename or "/" in filename or "\\" in filename:
        return jsonify({"msg": "无效的存档文件名"}), 400
    success = delete_save(SAVE_DIR, filename)
    if success:
        return jsonify({"msg": "已删除"})
    return jsonify({"msg": "删除失败"}), 500


@bp.route("/api/saves/<filename>/download")
def api_download_save(filename):
    if ".." in filename or "/" in filename or "\\" in filename:
        return jsonify({"msg": "无效的存档文件名"}), 400
    filepath = os.path.join(SAVE_DIR, filename)
    if not os.path.exists(filepath):
        return jsonify({"msg": "文件不存在"}), 404
    return send_file(
        filepath,
        mimetype="application/vnd.sqlite3",
        as_attachment=True,
        download_name=filename,
    )


@bp.route("/api/saves/upload", methods=["POST"])
def api_upload_save():
    f = request.files.get("file")
    if not f:
        return jsonify({"msg": "请选择文件"}), 400
    fname = f.filename or "uploaded.sqlite3"
    if ".." in fname or "/" in fname or "\\" in fname:
        return jsonify({"msg": "无效的文件名"}), 400
    if not fname.endswith(".sqlite3"):
        return jsonify({"msg": "仅支持 .sqlite3 格式"}), 400

    dst = os.path.join(SAVE_DIR, fname)
    base = fname[:-8]
    counter = 1
    while os.path.exists(dst):
        dst = os.path.join(SAVE_DIR, f"{base}_{counter}.sqlite3")
        counter += 1

    f.save(dst)
    return jsonify({"msg": f"存档已导入：{os.path.basename(dst)}"})


# ========== 数据库位置管理 API ==========

@bp.route("/api/db/info")
def api_db_info():
    info = get_db_path_effective()
    return jsonify({
        "db_path": info["path"],
        "source": info["source"],
        "save_dir": info["save_dir"],
    })


@bp.route("/api/db/transfer", methods=["POST"])
def api_transfer_database():
    d = request.get_json() or {}
    new_path = (d.get("path") or "").strip()
    if not new_path:
        return jsonify({"msg": "请指定新的数据库文件路径"}), 400
    result = transfer_database(DB_PATH, new_path)
    if result["ok"]:
        return jsonify(result)
    return jsonify(result), 500


@bp.route("/api/db/switch", methods=["POST"])
def api_switch_database():
    d = request.get_json() or {}
    new_path = (d.get("path") or "").strip()
    if not new_path:
        return jsonify({"msg": "请指定数据库文件路径"}), 400
    result = switch_database(new_path)
    if result["ok"]:
        return jsonify(result)
    return jsonify(result), 500


@bp.route("/api/db/change-save-dir", methods=["POST"])
def api_change_save_directory():
    d = request.get_json() or {}
    new_dir = (d.get("path") or "").strip()
    if not new_dir:
        return jsonify({"msg": "请指定存档目录路径"}), 400
    result = change_save_directory(new_dir)
    if result["ok"]:
        return jsonify(result)
    return jsonify(result), 500


@bp.route("/api/db/reset", methods=["POST"])
def api_reset_database():
    backup_note = ""
    try:
        fname = create_save(DB_PATH, SAVE_DIR, note="重置前自动备份", is_autosave=False)
        if fname:
            backup_note = f"已备份为「{fname}」。"
    except Exception:
        pass

    stop_pull_thread()
    try:
        os.remove(DB_PATH)
        for suffix in ["-wal", "-shm"]:
            p = DB_PATH + suffix
            if os.path.exists(p):
                os.remove(p)
    except Exception as e:
        start_pull_thread()
        return jsonify({"msg": f"删除数据库文件失败: {e}"}), 500

    init_db()
    start_pull_thread()

    msg = "数据库已重置。"
    if backup_note:
        msg += " " + backup_note
    else:
        msg += "（备份失败，已跳过）"
    return jsonify({"msg": msg})
