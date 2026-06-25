import os
import re
import json
import sqlite3
import datetime
import glob as _glob
from typing import List, Dict, Optional
from db import get_db_info

_SAFE_NAME_RE = re.compile(r'[^\w一-鿿-]')

_CONFIG_DIR = os.path.join(os.path.expanduser("~"), ".task_schedule_app")
_CONFIG_FILE = os.path.join(_CONFIG_DIR, "db_config.json")


def _db_config_dir() -> str:
    os.makedirs(_CONFIG_DIR, exist_ok=True)
    return _CONFIG_DIR


def _read_db_config() -> Dict:
    try:
        if os.path.exists(_CONFIG_FILE):
            with open(_CONFIG_FILE, "r", encoding="utf-8") as f:
                return json.load(f) or {}
    except Exception:
        pass
    return {}


def _write_db_config(cfg: Dict):
    _db_config_dir()
    with open(_CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


def _safe_copy_db(src: str, dst: str):
    src_conn = sqlite3.connect(src)
    dst_conn = sqlite3.connect(dst)
    try:
        src_conn.backup(dst_conn)
    finally:
        dst_conn.close()
        src_conn.close()


def _validate_db(path: str) -> bool:
    try:
        conn = sqlite3.connect(path)
        conn.execute("SELECT 1 FROM sqlite_master")
        conn.close()
        return True
    except Exception:
        return False


def _safe_name(s: str) -> str:
    s = s.strip()
    if not s:
        return ""
    s = _SAFE_NAME_RE.sub('_', s)
    return s[:30]


def get_save_dir(db_path: str) -> str:
    cfg = _read_db_config()
    if cfg.get("save_dir"):
        save_dir = cfg["save_dir"]
        os.makedirs(save_dir, exist_ok=True)
        return save_dir
    save_dir = os.path.join(os.path.dirname(db_path), "save")
    os.makedirs(save_dir, exist_ok=True)
    return save_dir


def get_db_path_effective() -> Dict:
    env_path = os.environ.get("TASK_SCHEDULE_DB_PATH", "").strip()
    if env_path and os.path.isfile(env_path):
        return {
            "path": env_path,
            "source": "env",
            "save_dir": get_save_dir(env_path),
        }

    cfg = _read_db_config()
    cfg_path = cfg.get("db_path", "")
    if cfg_path and os.path.isfile(cfg_path):
        return {
            "path": cfg_path,
            "source": "config",
            "save_dir": get_save_dir(cfg_path),
        }

    default_path = os.path.join(_CONFIG_DIR, "schedule_data.sqlite3")
    return {
        "path": default_path,
        "source": "default",
        "save_dir": get_save_dir(default_path),
    }


def transfer_database(db_path: str, new_path: str) -> Dict:
    if not os.path.exists(db_path):
        return {"ok": False, "msg": "当前数据库文件不存在"}

    new_dir = os.path.dirname(new_path)
    if new_dir:
        os.makedirs(new_dir, exist_ok=True)

    try:
        _safe_copy_db(db_path, new_path)
    except Exception as e:
        return {"ok": False, "msg": f"复制数据库失败: {e}"}

    if not _validate_db(new_path):
        try:
            os.remove(new_path)
        except Exception:
            pass
        return {"ok": False, "msg": "复制后的文件不是有效的 SQLite 数据库"}

    cfg = _read_db_config()
    cfg["db_path"] = new_path
    _write_db_config(cfg)
    return {"ok": True, "msg": f"数据库已转移至: {new_path}"}


def switch_database(new_path: str) -> Dict:
    if not os.path.isfile(new_path):
        return {"ok": False, "msg": "指定的数据库文件不存在"}

    if not _validate_db(new_path):
        return {"ok": False, "msg": "指定的文件不是有效的 SQLite 数据库"}

    cfg = _read_db_config()
    cfg["db_path"] = new_path
    _write_db_config(cfg)
    return {"ok": True, "msg": f"数据库已切换至: {new_path}"}


def change_save_directory(new_save_dir: str) -> Dict:
    try:
        os.makedirs(new_save_dir, exist_ok=True)
    except Exception as e:
        return {"ok": False, "msg": f"无法创建存档目录: {e}"}

    cfg = _read_db_config()
    cfg["save_dir"] = new_save_dir
    _write_db_config(cfg)
    return {"ok": True, "msg": f"存档目录已更改为: {new_save_dir}"}


def list_saves(save_dir: str) -> List[Dict]:
    saves = []
    if not os.path.isdir(save_dir):
        return saves

    for fname in sorted(os.listdir(save_dir), reverse=True):
        if not fname.endswith(".sqlite3"):
            continue
        fpath = os.path.join(save_dir, fname)
        meta_path = fpath + ".meta.json"
        meta = {}
        if os.path.exists(meta_path):
            try:
                with open(meta_path, "r", encoding="utf-8") as mf:
                    meta = json.load(mf)
            except Exception:
                pass

        size_bytes = os.path.getsize(fpath)
        if size_bytes < 1024:
            size_display = f"{size_bytes} B"
        elif size_bytes < 1024 * 1024:
            size_display = f"{size_bytes / 1024:.1f} KB"
        else:
            size_display = f"{size_bytes / (1024 * 1024):.1f} MB"

        saves.append({
            "filename": fname,
            "size_bytes": size_bytes,
            "size_display": size_display,
            "note": meta.get("note", ""),
            "created_at": meta.get("created_at", ""),
            "app_mtime": meta.get("app_mtime", 0),
            "app_version": meta.get("app_version", ""),
            "row_counts": meta.get("row_counts", {}),
            "is_autosave": fname.startswith("autosave_"),
        })

    return saves


def create_save(db_path: str, save_dir: str, note: str = "", is_autosave: bool = False) -> Optional[str]:
    if not os.path.exists(db_path):
        return None

    now = datetime.datetime.now()
    timestamp = now.strftime("%Y-%m-%d_%H-%M")
    if is_autosave:
        fname = f"autosave_{timestamp}.sqlite3"
    elif note:
        safe_note = _safe_name(note)
        fname = f"{timestamp}_{safe_note}.sqlite3"
    else:
        fname = f"{timestamp}.sqlite3"

    dst_path = os.path.join(save_dir, fname)

    base = fname[:-8]
    counter = 1
    while os.path.exists(dst_path):
        fname = f"{base}_{counter}.sqlite3"
        dst_path = os.path.join(save_dir, fname)
        counter += 1

    try:
        _safe_copy_db(db_path, dst_path)
    except Exception:
        return None

    meta = {
        "app_mtime": _get_app_mtime(),
        "app_version": "2.21.17",
        "created_at": now.strftime("%Y-%m-%d %H:%M:%S"),
        "note": note if not is_autosave else f"自动存档 ({timestamp})",
        "row_counts": {},
    }
    try:
        info = get_db_info(db_path)
        meta["row_counts"] = info.get("tables", {})
    except Exception:
        pass

    meta_path = dst_path + ".meta.json"
    try:
        with open(meta_path, "w", encoding="utf-8") as mf:
            json.dump(meta, mf, ensure_ascii=False, indent=2)
    except Exception:
        pass

    return fname


def restore_save(save_dir: str, filename: str, db_path: str) -> bool:
    src = os.path.join(save_dir, filename)
    if not os.path.exists(src):
        return False

    emergency_dir = os.path.join(save_dir, ".emergency")
    os.makedirs(emergency_dir, exist_ok=True)
    now = datetime.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    emergency_path = os.path.join(emergency_dir, f"before_restore_{now}.sqlite3")
    try:
        if os.path.exists(db_path):
            _safe_copy_db(db_path, emergency_path)
    except Exception:
        pass

    try:
        emerg_files = sorted(
            [f for f in os.listdir(emergency_dir) if f.endswith(".sqlite3")],
            reverse=True,
        )
        for old_file in emerg_files[5:]:
            old_path = os.path.join(emergency_dir, old_file)
            try:
                os.remove(old_path)
            except Exception:
                pass
    except Exception:
        pass

    try:
        _safe_copy_db(src, db_path)
        return True
    except Exception:
        return False


def delete_save(save_dir: str, filename: str) -> bool:
    fpath = os.path.join(save_dir, filename)
    meta_path = fpath + ".meta.json"
    deleted = False
    try:
        if os.path.exists(fpath):
            os.remove(fpath)
            deleted = True
        if os.path.exists(meta_path):
            os.remove(meta_path)
    except Exception:
        return False
    return deleted


def rotate_autosaves(save_dir: str, db_path: str = "", max_days: int = 60):
    if db_path:
        try:
            conn = sqlite3.connect(db_path)
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                "SELECT value FROM config WHERE category='schedule_settings' AND key='autosave_retention_days'"
            ).fetchone()
            conn.close()
            if row and row["value"].strip():
                max_days = int(row["value"].strip())
        except Exception:
            pass

    cutoff = (datetime.datetime.now() - datetime.timedelta(days=max_days)).strftime("%Y-%m-%d %H:%M:%S")
    saves = list_saves(save_dir)
    for s in saves:
        if s["is_autosave"] and s["created_at"] and s["created_at"] < cutoff:
            delete_save(save_dir, s["filename"])


def _get_app_mtime() -> float:
    root = os.path.dirname(os.path.abspath(__file__))
    patterns = [
        os.path.join(root, "*.py"),
        os.path.join(root, "routes", "*.py"),
        os.path.join(root, "static", "*.js"),
    ]
    py_files = []
    for p in patterns:
        py_files.extend(_glob.glob(p))
    try:
        return max(os.path.getmtime(f) for f in py_files if os.path.exists(f))
    except Exception:
        return 0.0
