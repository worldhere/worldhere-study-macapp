# 数据库存档与位置管理系统实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为排班系统添加 RPG 式的数据库存档管理系统 + 数据库位置转移/切换功能。测试员可在 UI 内一键存档/读档/管理存档、独立指定存档目录、以及转移或切换数据库文件位置。

**Architecture:** 通过 `~/.task_schedule_app/db_config.json` 持久化用户对数据库路径和存档目录的自定义配置。存档目录可独立于数据库位置（如数据库在 C 盘、存档在 D 盘）。数据库复制用 SQLite 的 `backup()` API 保证一致性。新增 `routes/saves.py` 蓝图，设置面板新增"数据管理"子页（sub-6）。

**Tech Stack:** Python Flask + SQLite + Vanilla JS（与现有项目一致）

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `save_utils.py` (新建) | 存档管理（创建/列表/恢复/删除/轮转）、db_config 读写、安全数据库复制、转移/切换逻辑 |
| `routes/saves.py` (新建) | 存档 + 数据库位置管理 API（存档 CRUD + transfer + switch + change-save-dir） |
| `app.py` (修改) | 注册 saves 蓝图，启动时自动存档 |
| `db.py` (修改) | `_resolve_db_path()` 加入 `db_config.json` 优先级，暴露 `DATA_DIR`，添加 `get_db_info()` |
| `templates/index.html` (修改) | 新增 sub-6 数据管理子页（含存档管理 + 数据库位置管理 + 存档目录管理） |
| `static/settings.js` (修改) | `switchSettingsSub` 适配 7 个子页，存档管理函数 + 转移/切换函数 |
| `static/import-export.js` (修改) | 导入执行前触发自动存档 |
| `routes/views.py` (修改) | `index()` 中检测版本变更传至前端 |

---

### Task 1: `save_utils.py` — 存档核心工具模块

**Files:**
- Create: `C:\Users\Admin\Desktop\大家的Draft\zyh\golden\save_utils.py`

- [ ] **Step 1: 创建 `save_utils.py` 完整文件**

```python
import os
import re
import json
import sqlite3
import datetime
import glob as _glob
from typing import List, Dict, Optional

# 存档文件名安全化：只保留中文、字母、数字、-、_
_SAFE_NAME_RE = re.compile(r'[^\w一-鿿-]')

# 默认配置目录和文件
_CONFIG_DIR = os.path.join(os.path.expanduser("~"), ".task_schedule_app")
_CONFIG_FILE = os.path.join(_CONFIG_DIR, "db_config.json")


def _db_config_dir() -> str:
    """确保 ~/.task_schedule_app 目录存在"""
    os.makedirs(_CONFIG_DIR, exist_ok=True)
    return _CONFIG_DIR


def _read_db_config() -> Dict:
    """读取 db_config.json，不存在则返回空 dict"""
    try:
        if os.path.exists(_CONFIG_FILE):
            with open(_CONFIG_FILE, "r", encoding="utf-8") as f:
                return json.load(f) or {}
    except Exception:
        pass
    return {}


def _write_db_config(cfg: Dict):
    """写入 db_config.json"""
    _db_config_dir()
    with open(_CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


def _safe_copy_db(src: str, dst: str):
    """使用 SQLite backup() API 安全复制数据库，保证并发写入时的一致性"""
    src_conn = sqlite3.connect(src)
    dst_conn = sqlite3.connect(dst)
    try:
        src_conn.backup(dst_conn)
    finally:
        dst_conn.close()
        src_conn.close()


def _validate_db(path: str) -> bool:
    """检查文件是否为有效的 SQLite 数据库"""
    try:
        conn = sqlite3.connect(path)
        conn.execute("SELECT 1 FROM sqlite_master")
        conn.close()
        return True
    except Exception:
        return False


def _safe_name(s: str) -> str:
    """将备注转为安全的文件名片段"""
    s = s.strip()
    if not s:
        return ""
    s = _SAFE_NAME_RE.sub('_', s)
    return s[:30]


def get_save_dir(db_path: str) -> str:
    """获取存档目录路径。
    优先读取 db_config.json 中用户指定的 save_dir，
    未配置时使用数据库同目录下的 save/ 文件夹。
    """
    cfg = _read_db_config()
    if cfg.get("save_dir"):
        save_dir = cfg["save_dir"]
        os.makedirs(save_dir, exist_ok=True)
        return save_dir
    save_dir = os.path.join(os.path.dirname(db_path), "save")
    os.makedirs(save_dir, exist_ok=True)
    return save_dir


def get_db_path_effective() -> Dict:
    """返回当前生效的数据库路径信息。
    优先级：环境变量 > CLI --db > db_config.json > 默认路径
    """
    # 检查环境变量
    env_path = os.environ.get("TASK_SCHEDULE_DB_PATH", "").strip()
    if env_path and os.path.isfile(env_path):
        return {
            "path": env_path,
            "source": "env",
            "save_dir": get_save_dir(env_path),
        }

    # 检查 CLI --db 参数（通过 _CLI_DB_PATH 全局变量）
    cli_path = globals().get("_CLI_DB_PATH", "") or ""
    if cli_path and os.path.isfile(cli_path):
        return {
            "path": cli_path,
            "source": "cli",
            "save_dir": get_save_dir(cli_path),
        }

    # 检查 db_config.json
    cfg = _read_db_config()
    cfg_path = cfg.get("db_path", "")
    if cfg_path and os.path.isfile(cfg_path):
        return {
            "path": cfg_path,
            "source": "config",
            "save_dir": get_save_dir(cfg_path),
        }

    # 默认路径
    default_path = os.path.join(_CONFIG_DIR, "task_schedule.db")
    return {
        "path": default_path,
        "source": "default",
        "save_dir": get_save_dir(default_path),
    }


def transfer_database(new_path: str) -> Dict:
    """转移数据库：复制当前数据库到新位置，更新 db_config.json。
    - new_path: 新的数据库文件完整路径（含文件名），如 D:\data\task_schedule.db
    - 复制后原文件保留，新路径写入配置
    """
    from db import DB_PATH
    if not os.path.exists(DB_PATH):
        return {"ok": False, "msg": "当前数据库文件不存在"}

    new_dir = os.path.dirname(new_path)
    if new_dir:
        os.makedirs(new_dir, exist_ok=True)

    try:
        _safe_copy_db(DB_PATH, new_path)
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
    """切换到已有数据库：验证文件有效后更新 db_config.json。
    - new_path: 已存在的数据库文件路径
    """
    if not os.path.isfile(new_path):
        return {"ok": False, "msg": "指定的数据库文件不存在"}

    if not _validate_db(new_path):
        return {"ok": False, "msg": "指定的文件不是有效的 SQLite 数据库"}

    cfg = _read_db_config()
    cfg["db_path"] = new_path
    _write_db_config(cfg)
    return {"ok": True, "msg": f"数据库已切换至: {new_path}"}


def change_save_directory(new_save_dir: str) -> Dict:
    """更改存档目录：更新 db_config.json 中的 save_dir。
    - new_save_dir: 新的存档目录路径
    """
    try:
        os.makedirs(new_save_dir, exist_ok=True)
    except Exception as e:
        return {"ok": False, "msg": f"无法创建存档目录: {e}"}

    cfg = _read_db_config()
    cfg["save_dir"] = new_save_dir
    _write_db_config(cfg)
    return {"ok": True, "msg": f"存档目录已更改为: {new_save_dir}"}


def get_db_info(db_path: str) -> Dict:
    """获取当前数据库的基本信息"""
    info = {
        "path": db_path,
        "size_bytes": 0,
        "size_display": "0 KB",
        "tables": {},
    }
    try:
        info["size_bytes"] = os.path.getsize(db_path)
        if info["size_bytes"] < 1024:
            info["size_display"] = f"{info['size_bytes']} B"
        elif info["size_bytes"] < 1024 * 1024:
            info["size_display"] = f"{info['size_bytes'] / 1024:.1f} KB"
        else:
            info["size_display"] = f"{info['size_bytes'] / (1024 * 1024):.1f} MB"
    except OSError:
        pass

    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        tables = ["machines", "tasks", "schedules", "config", "deletion_log", "repair_log", "shift_config"]
        for t in tables:
            try:
                row = conn.execute(f"SELECT COUNT(*) AS c FROM {t}").fetchone()
                info["tables"][t] = row["c"] if row else 0
            except Exception:
                info["tables"][t] = -1
        conn.close()
    except Exception:
        pass

    return info


def list_saves(save_dir: str) -> List[Dict]:
    """返回存档目录下所有存档信息，按时间降序"""
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
    """创建一份存档，返回存档文件名。失败返回 None。使用 SQLite backup() 安全复制。"""
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

    # 如果同名文件已存在（同一秒内重复存档），追加序号
    base = fname[:-8]  # 去掉 .sqlite3
    counter = 1
    while os.path.exists(dst_path):
        fname = f"{base}_{counter}.sqlite3"
        dst_path = os.path.join(save_dir, fname)
        counter += 1

    try:
        _safe_copy_db(db_path, dst_path)
    except Exception:
        return None

    # 写入元数据
    meta = {
        "app_mtime": _get_app_mtime(),
        "app_version": "2.3.1",
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
    """读档：用存档文件覆盖当前数据库。使用 SQLite backup() 安全写入。
    紧急备份保留最近 5 份。
    """
    src = os.path.join(save_dir, filename)
    if not os.path.exists(src):
        return False

    # 把当前库做一个紧急备份
    emergency_dir = os.path.join(save_dir, ".emergency")
    os.makedirs(emergency_dir, exist_ok=True)
    now = datetime.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    emergency_path = os.path.join(emergency_dir, f"before_restore_{now}.sqlite3")
    try:
        if os.path.exists(db_path):
            _safe_copy_db(db_path, emergency_path)
    except Exception:
        pass

    # 清理紧急备份，只保留最近 5 份
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
    """删除一个存档及其元数据文件。"""
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
    """轮转自动存档：删除超过 max_days 天的旧 autosave。
    如果提供 db_path，会从 config 表读取 autosave_retention_days（单位：天），
    未配置时回退到 max_days 参数（默认 60 天 = 约 2 个月）。
    """
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
    """取项目中所有 .py 和 .js 文件的最新修改时间，作为程序版本指纹"""
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
```

---

### Task 2: `routes/saves.py` — 存档 API 蓝图

**Files:**
- Create: `C:\Users\Admin\Desktop\大家的Draft\zyh\golden\routes\saves.py`

- [ ] **Step 1: 创建 `routes/saves.py` 完整文件**

```python
import os
from flask import Blueprint, request, jsonify, send_file

from db import DB_PATH, get_db_info
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
    """列出所有存档"""
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
    """快速存档（可附带备注）"""
    d = request.get_json() or {}
    note = (d.get("note") or "").strip()
    fname = create_save(DB_PATH, SAVE_DIR, note=note, is_autosave=False)
    if fname:
        rotate_autosaves(SAVE_DIR, db_path=DB_PATH)
        return jsonify({"msg": f"存档成功：{fname}", "filename": fname})
    return jsonify({"msg": "存档失败"}), 500


@bp.route("/api/saves/auto", methods=["POST"])
def api_auto_save():
    """自动存档（无需用户确认）"""
    fname = create_save(DB_PATH, SAVE_DIR, note="", is_autosave=True)
    if fname:
        rotate_autosaves(SAVE_DIR, db_path=DB_PATH)
        return jsonify({"msg": "自动存档完成", "filename": fname})
    return jsonify({"msg": "自动存档失败"}), 500


@bp.route("/api/saves/load", methods=["POST"])
def api_load_save():
    """读档：用指定存档覆盖当前数据库"""
    d = request.get_json() or {}
    filename = (d.get("filename") or "").strip()
    if not filename:
        return jsonify({"msg": "请指定存档文件名"}), 400

    # 安全检查：防止路径穿越
    if ".." in filename or "/" in filename or "\\" in filename:
        return jsonify({"msg": "无效的存档文件名"}), 400

    success = restore_save(SAVE_DIR, filename, DB_PATH)
    if success:
        return jsonify({"msg": f"读档成功，将从存档「{filename}」恢复。请重启应用以使数据生效。"})
    return jsonify({"msg": "读档失败，存档文件不存在或已损坏"}), 500


@bp.route("/api/saves/<filename>", methods=["DELETE"])
def api_delete_save(filename):
    """删除存档"""
    if ".." in filename or "/" in filename or "\\" in filename:
        return jsonify({"msg": "无效的存档文件名"}), 400
    success = delete_save(SAVE_DIR, filename)
    if success:
        return jsonify({"msg": "已删除"})
    return jsonify({"msg": "删除失败"}), 500


@bp.route("/api/saves/<filename>/download")
def api_download_save(filename):
    """下载存档文件"""
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
    """导入存档文件（从本地上传 .sqlite3 文件）"""
    f = request.files.get("file")
    if not f:
        return jsonify({"msg": "请选择文件"}), 400
    fname = f.filename or "uploaded.sqlite3"
    if ".." in fname or "/" in fname or "\\" in fname:
        return jsonify({"msg": "无效的文件名"}), 400
    if not fname.endswith(".sqlite3"):
        return jsonify({"msg": "仅支持 .sqlite3 格式"}), 400

    dst = os.path.join(SAVE_DIR, fname)
    # 如果同名存在，追加序号
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
    """获取当前数据库路径信息（来源、存档目录等）"""
    info = get_db_path_effective()
    cfg = {
        "db_path": info["path"],
        "source": info["source"],
        "save_dir": info["save_dir"],
    }
    return jsonify(cfg)


@bp.route("/api/db/transfer", methods=["POST"])
def api_transfer_database():
    """转移数据库到新位置（复制 + 更新配置）"""
    d = request.get_json() or {}
    new_path = (d.get("path") or "").strip()
    if not new_path:
        return jsonify({"msg": "请指定新的数据库文件路径"}), 400
    result = transfer_database(new_path)
    if result["ok"]:
        return jsonify(result)
    return jsonify(result), 500


@bp.route("/api/db/switch", methods=["POST"])
def api_switch_database():
    """切换到已有数据库（验证 + 更新配置）"""
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
    """更改存档目录"""
    d = request.get_json() or {}
    new_dir = (d.get("path") or "").strip()
    if not new_dir:
        return jsonify({"msg": "请指定存档目录路径"}), 400
    result = change_save_directory(new_dir)
    if result["ok"]:
        return jsonify(result)
    return jsonify(result), 500
```

---

### Task 3: `db.py` — `_resolve_db_path` 加入 `db_config.json` 优先级 + 暴露 `DATA_DIR` + 添加 `get_db_info`

**Files:**
- Modify: `C:\Users\Admin\Desktop\大家的Draft\zyh\golden\db.py`

- [ ] **Step 1: 修改 `_resolve_db_path` 加入 `db_config.json` 优先级**

找到 `_resolve_db_path` 函数，替换为：

```python
def _resolve_db_path() -> str:
    """解析数据库文件路径。
    优先级：环境变量 TASK_SCHEDULE_DB_PATH > CLI --db > db_config.json > 默认路径
    如果 db_config.json 中配置的路径不存在，回退到默认路径。
    """
    import os as _os

    # 1. 环境变量
    env_path = _os.environ.get("TASK_SCHEDULE_DB_PATH", "").strip()
    if env_path and _os.path.isfile(env_path):
        return env_path

    # 2. CLI --db 参数（通过全局变量传入）
    cli_path = globals().get("_CLI_DB_PATH", "") or ""
    if cli_path and _os.path.isfile(cli_path):
        return cli_path

    # 3. db_config.json
    default_dir = _os.path.join(_os.path.expanduser("~"), ".task_schedule_app")
    config_file = _os.path.join(default_dir, "db_config.json")
    try:
        if _os.path.exists(config_file):
            import json as _json
            with open(config_file, "r", encoding="utf-8") as f:
                cfg = _json.load(f) or {}
            cfg_path = cfg.get("db_path", "")
            if cfg_path and _os.path.isfile(cfg_path):
                return cfg_path
    except Exception:
        pass

    # 4. 默认路径
    _os.makedirs(default_dir, exist_ok=True)
    return _os.path.join(default_dir, "task_schedule.db")
```

- [ ] **Step 2: 暴露 `DATA_DIR`**

找到原有代码（约第 28 行）：
```python
DB_PATH = _resolve_db_path()
os.makedirs(os.path.dirname(DB_PATH) or ".", exist_ok=True)
```

替换为：
```python
DB_PATH = _resolve_db_path()
DATA_DIR = os.path.dirname(DB_PATH)
os.makedirs(DATA_DIR, exist_ok=True)
```

- [ ] **Step 3: 添加 `get_db_info` 函数（如果不在 save_utils 中）**

在 `db.py` 末尾（`init_db` 函数之后）添加：

```python
def get_db_info(db_path=None):
    """获取数据库的基本信息。db_path 默认使用当前数据库路径。"""
    if db_path is None:
        db_path = DB_PATH
    import os as _os
    info = {
        "path": db_path,
        "size_bytes": 0,
        "size_display": "0 KB",
        "tables": {},
    }
    try:
        info["size_bytes"] = _os.path.getsize(db_path)
        if info["size_bytes"] < 1024:
            info["size_display"] = f"{info['size_bytes']} B"
        elif info["size_bytes"] < 1024 * 1024:
            info["size_display"] = f"{info['size_bytes'] / 1024:.1f} KB"
        else:
            info["size_display"] = f"{info['size_bytes'] / (1024 * 1024):.1f} MB"
    except OSError:
        pass

    try:
        conn = sqlite3.connect(db_path)
        tables = ["machines", "tasks", "schedules", "config", "deletion_log", "repair_log", "shift_config"]
        for t in tables:
            try:
                row = conn.execute(f"SELECT COUNT(*) AS c FROM {t}").fetchone()
                info["tables"][t] = row["c"] if row else 0
            except Exception:
                info["tables"][t] = -1
        conn.close()
    except Exception:
        pass

    return info
```

---

### Task 4: `app.py` — 注册蓝图和启动时自动存档

**Files:**
- Modify: `C:\Users\Admin\Desktop\大家的Draft\zyh\golden\app.py`

- [ ] **Step 1: 修改 `app.py`**

将整个文件替换为：

```python
from flask import Flask

from db import init_db, DB_PATH, DATA_DIR
from save_utils import get_save_dir, get_db_path_effective, create_save, rotate_autosaves
from routes.views import bp as views_bp
from routes.machines import bp as machines_bp
from routes.tasks import bp as tasks_bp
from routes.schedules import bp as schedules_bp
from routes.settings import bp as settings_bp
from routes.saves import bp as saves_bp

app = Flask(__name__)

init_db()

app.register_blueprint(views_bp)
app.register_blueprint(machines_bp)
app.register_blueprint(tasks_bp)
app.register_blueprint(schedules_bp)
app.register_blueprint(settings_bp)
app.register_blueprint(saves_bp)

# 启动时自动存档
try:
    save_dir = get_save_dir(DB_PATH)
    create_save(DB_PATH, save_dir, note="", is_autosave=True)
    rotate_autosaves(save_dir, db_path=DB_PATH)
except Exception:
    pass

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000, debug=True)
```

---

### Task 4.5: `routes/views.py` — 启动时检测版本变更并传至前端

**Files:**
- Modify: `C:\Users\Admin\Desktop\大家的Draft\zyh\golden\routes\views.py:1-42`

- [ ] **Step 1: 在 `index()` 中添加版本变更检测**

将 `routes/views.py` 的 import 区域和 `index()` 函数替换为：

```python
import datetime
from flask import Blueprint, render_template, request, jsonify

from db import get_db, DB_PATH
from utils import parse_date
from save_utils import get_save_dir, get_db_path_effective, list_saves, _get_app_mtime

from models import load_shift_config, load_app_config

bp = Blueprint('views', __name__)


@bp.route('/')
def index():
    selected_date = parse_date(request.args.get("date"))
    m_sort = (request.args.get("m_sort") or "name").strip()
    m_dir = (request.args.get("m_dir") or "asc").strip()
    m_type = (request.args.get("m_type") or "").strip()
    m_status = (request.args.get("m_status") or "").strip()
    m_kind = (request.args.get("m_kind") or "").strip()
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
        task_sort=task_sort,
        task_dir=task_dir,
        shift=shift_config,
        history_date_from=history_date_from,
        history_date_to=history_date_to,
        version_mismatch=version_mismatch,
        current_app_mtime=current_mtime,
    )
```

---

### Task 5: `templates/index.html` — 新增"数据管理"设置子页 + 版本更新 Toast

**Files:**
- Modify: `C:\Users\Admin\Desktop\大家的Draft\zyh\golden\templates\index.html:468-474` (导航按钮)
- Modify: `C:\Users\Admin\Desktop\大家的Draft\zyh\golden\templates\index.html:713-718` (sub-5 之后)

- [ ] **Step 1: 在设置导航中添加第 7 个按钮**

找到（第 473-474 行）：
```html
        <button class="settings-tab" onclick="switchSettingsSub(5)">班次设置</button>
    </div>
```

替换为：
```html
        <button class="settings-tab" onclick="switchSettingsSub(5)">班次设置</button>
        <button class="settings-tab" onclick="switchSettingsSub(6)">数据管理</button>
    </div>
```

- [ ] **Step 2: 在 sub-5 末尾之后添加 sub-6 数据管理子页**

找到 sub-5 结束的 `</div>`（第 718 行附近）：
```html
    <div id="settings-sub-5" class="settings-subpage">
        <div class="box">
            <div class="settings-hint">暂无班次相关设置</div>
        </div>
    </div>
```

在其后添加：

```html
    <div id="settings-sub-6" class="settings-subpage">
        <!-- 数据库信息卡片 -->
        <div class="box">
            <div class="settings-hint" style="font-size:14px;color:var(--text);">数据库信息</div>
            <div id="save-db-info" style="font-size:12px;color:#666;line-height:1.8;">
                加载中...
            </div>
        </div>

        <!-- 快速存档 -->
        <div class="box">
            <div class="settings-hint" style="font-size:14px;color:var(--text);">快速存档</div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                <input id="save-note-input" placeholder="存档备注（可选）" style="flex:1;min-width:200px;">
                <button class="btn" onclick="quickSave()" style="background:var(--success);">&#128190; 保存当前存档</button>
            </div>
        </div>

        <!-- 存档列表 -->
        <div class="box">
            <div class="settings-hint" style="font-size:14px;color:var(--text);">存档管理</div>
            <div id="save-list-container" style="max-height:400px;overflow-y:auto;">
                加载中...
            </div>
        </div>

        <!-- 导入存档 -->
        <div class="box">
            <div class="settings-hint" style="font-size:14px;color:var(--text);">导入外部存档</div>
            <input type="file" id="save-upload-input" accept=".sqlite3" style="display:none;" onchange="uploadSaveFile(this)">
            <button class="btn" onclick="document.getElementById('save-upload-input').click()">选择 .sqlite3 文件导入</button>
        </div>

        <!-- 数据库位置管理 -->
        <div class="box">
            <div class="settings-hint" style="font-size:14px;color:var(--text);">数据库位置管理</div>
            <div id="save-db-location-info" style="font-size:12px;color:#666;margin-bottom:8px;">加载中...</div>
            <div style="display:flex;flex-direction:column;gap:8px;">
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                    <input id="db-transfer-path" placeholder="新数据库文件路径（如 D:\data\task_schedule.db）" style="flex:1;min-width:250px;">
                    <button class="btn" onclick="transferDatabase()" style="background:#1976d2;color:#fff;">转移数据库（复制到新位置）</button>
                </div>
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                    <input id="db-switch-path" placeholder="已有数据库文件路径" style="flex:1;min-width:250px;">
                    <button class="btn" onclick="switchDatabase()" style="background:#e6a23c;color:#fff;">切换数据库（指向已有文件）</button>
                </div>
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                    <input id="save-dir-path" placeholder="存档目录路径（如 D:\backups\saves）" style="flex:1;min-width:250px;">
                    <button class="btn" onclick="changeSaveDirectory()" style="background:#67c23a;color:#fff;">更改存档目录</button>
                </div>
            </div>
            <div style="font-size:11px;color:#999;margin-top:6px;">
                转移：复制当前数据库到新位置并自动切换；切换：指向已有数据库文件；更改存档目录：仅修改存档存储位置
            </div>
        </div>
    </div>
```

- [ ] **Step 3: 更新导航顺序种子数据中的设置子页索引**

需要在 `settings.js` 第 15 行的 `switchSettingsSub` 中更新范围检查。这一步在 Task 6 中处理。

- [ ] **Step 4: 在模板底部添加版本更新 Toast 脚本**

找到 `templates/index.html` 中 `</body>` 之前最后一个 `<script>` 块的末尾，在其后添加：

```html
{% if version_mismatch %}
<script>
(function() {
    var serverMtime = {{ current_app_mtime|tojson }};
    var storedMtime = localStorage.getItem('last_seen_app_mtime');
    if (String(serverMtime) !== storedMtime) {
        document.addEventListener('DOMContentLoaded', function() {
            showToast('检测到程序更新。读档旧存档时将自动适配数据库结构。');
        });
        localStorage.setItem('last_seen_app_mtime', String(serverMtime));
    }
})();
</script>
{% endif %}
```

**机制**：`current_app_mtime` 是当前代码的最新修改时间戳。前端把它和 `localStorage` 里上次记录的 mtime 对比——不同就弹 toast 并更新记录，相同就跳过。升级一次弹一次，不重复打扰。

- [ ] **Step 5: 在系统设置子页（sub-4）中添加自动存档保留天数**

找到 `templates/index.html` 中 `settings-sub-4`（第 666-710 行），在"Toast 通知时长"滑块之后添加：

```html
            <div class="settings-hint">
                自动存档保留天数
                <span id="autosave-retention-display" style="float:right;color:var(--text-muted);">60</span>
            </div>
            <div class="settings-row">
                <input type="range" id="s-autosave-retention" min="7" max="180" value="60" step="1">
                <div class="range-labels"><span>7天</span><span>180天</span></div>
            </div>
```

---

### Task 6: `static/settings.js` — 设置面板适配

**Files:**
- Modify: `C:\Users\Admin\Desktop\大家的Draft\zyh\golden\static\settings.js:7-15` (switchSettingsSub)
- Modify: `C:\Users\Admin\Desktop\大家的Draft\zyh\golden\static\settings.js:18-34` (loadSettings)
- Modify: `C:\Users\Admin\Desktop\大家的Draft\zyh\golden\static\settings.js:742-749` (restoreSettingsSub)

- [ ] **Step 1: `switchSettingsSub` 中添加数据管理的渲染触发**

找到第 7-15 行，替换为：

```javascript
function switchSettingsSub(i) {
    try { localStorage.setItem('activeSettingsSub', String(i)); } catch (e) {}
    document.querySelectorAll('.settings-tab').forEach(function (b, k) {
        b.className = k === i ? 'settings-tab active' : 'settings-tab';
    });
    document.querySelectorAll('.settings-subpage').forEach(function (p, k) {
        p.className = k === i ? 'settings-subpage active' : 'settings-subpage';
    });
    // 切换到数据管理子页时加载存档列表
    if (i === 6) {
        loadSaveList();
    }
}
```

- [ ] **Step 2: `restoreSettingsSub` 更新索引上限**

找到第 742-749 行，将 `idx <= 5` 改为 `idx <= 6`：

```javascript
function restoreSettingsSub() {
    try {
        var idx = parseInt(localStorage.getItem('activeSettingsSub') || '0');
        if (idx >= 0 && idx <= 6) {
            switchSettingsSub(idx);
        }
    } catch (e) { }
}
```

- [ ] **Step 3: 在 `loadSettings` 中初始化存档保留天数滑块**

在 `loadSettings()` 函数（第 18 行）的 `applyStoredUISettings()` 调用之前，需要确保 `applyStoredUISettings` 会从 `_settingsData.schedule_settings` 中读取 `autosave_retention_days` 并设置 `#s-autosave-retention` 滑块的值和 `#autosave-retention-display` 的显示。

在 `applyStoredUISettings()` 函数中（约第 264-406 行），找到处理 schedule_settings 的部分，添加：

```javascript
// 自动存档保留天数
var retentionDays = '60';
var schedSettings = _settingsData['schedule_settings'] || [];
for (var si = 0; si < schedSettings.length; si++) {
    if (schedSettings[si].key === 'autosave_retention_days') {
        retentionDays = schedSettings[si].value || '60';
        break;
    }
}
var retSlider = document.getElementById('s-autosave-retention');
var retDisplay = document.getElementById('autosave-retention-display');
if (retSlider) {
    retSlider.value = retentionDays;
    retSlider.oninput = function() {
        applyScheduleSetting('autosave_retention_days', this.value);
        if (retDisplay) retDisplay.textContent = this.value;
    };
}
if (retDisplay) retDisplay.textContent = retentionDays;
```

- [ ] **Step 4: 在 `settings.js` 末尾添加存档管理和数据库位置管理前端函数**

```javascript
// ========== 数据管理（存档系统） ==========

var _currentAppMtime = 0;

function loadSaveList() {
    fetch('/api/saves')
        .then(function (r) { return r.json(); })
        .then(function (data) {
            _currentAppMtime = data.current_app_mtime || 0;
            renderDbInfo(data.db_info);
            renderSaveTable(data.saves || []);
        })
        .catch(function (err) {
            document.getElementById('save-list-container').textContent = '加载失败: ' + err.message;
        });
    // 同时加载数据库位置信息
    fetch('/api/db/info')
        .then(function (r) { return r.json(); })
        .then(function (info) {
            renderDbLocationInfo(info);
        })
        .catch(function () {});
}

function renderDbInfo(dbInfo) {
    if (!dbInfo) return;
    var tableInfo = [];
    var labelMap = {
        machines: '机器', tasks: '任务', schedules: '排班',
        config: '配置项', deletion_log: '删除记录', repair_log: '维修记录', shift_config: '班次配置'
    };
    for (var t in dbInfo.tables) {
        if (dbInfo.tables[t] >= 0) {
            tableInfo.push((labelMap[t] || t) + ': ' + dbInfo.tables[t]);
        }
    }
    document.getElementById('save-db-info').innerHTML =
        '<div>路径：<code style="font-size:11px;word-break:break-all;">' + escHtml(dbInfo.path) + '</code></div>' +
        '<div>大小：' + escHtml(dbInfo.size_display) +
        '　｜　' + tableInfo.join('　') + '</div>';
}

function renderDbLocationInfo(info) {
    var sourceLabels = {env: '环境变量', cli: '命令行参数', config: '配置文件 (db_config.json)', default: '默认路径'};
    document.getElementById('save-db-location-info').innerHTML =
        '来源：' + (sourceLabels[info.source] || info.source) +
        '　｜　存档目录：<code style="font-size:11px;">' + escHtml(info.save_dir) + '</code>';
}

function renderSaveTable(saves) {
    var container = document.getElementById('save-list-container');
    if (saves.length === 0) {
        container.innerHTML = '<div style="color:#999;padding:12px;text-align:center;">暂无存档，点上方「保存当前存档」创建第一个存档</div>';
        return;
    }
    var html = '<table style="font-size:12px;width:100%;"><tr><th>存档名称</th><th>大小</th><th>时间</th><th>备注</th><th>操作</th></tr>';
    for (var i = 0; i < saves.length; i++) {
        var s = saves[i];
        var badge = s.is_autosave ? ' <span style="background:#e8e8e8;color:#666;padding:0 4px;border-radius:2px;font-size:10px;">自动</span>' : '';
        // 检查存档时的 app 版本与当前是否一致
        if (s.app_mtime && _currentAppMtime && Math.abs(s.app_mtime - _currentAppMtime) > 1) {
            badge += ' <span style="background:#fff3cd;color:#856404;padding:0 4px;border-radius:2px;font-size:10px;" title="存档时程序版本与当前不同，加载后将自动适配">版本变更</span>';
        }
        html += '<tr>' +
            '<td>' + escHtml(s.filename) + badge + '</td>' +
            '<td>' + escHtml(s.size_display) + '</td>' +
            '<td style="font-size:11px;">' + escHtml(s.created_at) + '</td>' +
            '<td style="font-size:11px;color:#666;">' + escHtml(s.note) + '</td>' +
            '<td style="white-space:nowrap;">' +
                '<button onclick="downloadSave(\'' + escHtml(s.filename) + '\')" style="font-size:11px;">下载</button> ' +
                '<button onclick="loadSave(\'' + escHtml(s.filename) + '\', ' + (s.app_mtime || 0) + ')" style="font-size:11px;background:var(--warning);">读档</button> ' +
                '<button onclick="deleteSave(\'' + escHtml(s.filename) + '\')" style="font-size:11px;background:var(--danger);color:#fff;">删除</button>' +
            '</td>' +
        '</tr>';
    }
    html += '</table>';
    container.innerHTML = html;
}

function quickSave() {
    var note = (document.getElementById('save-note-input').value || '').trim();
    var body = {};
    if (note) body.note = note;
    fetch('/api/saves/quick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    })
        .then(function (r) { return r.json(); })
        .then(function (d) {
            showToast(d.msg || '存档完成');
            document.getElementById('save-note-input').value = '';
            loadSaveList();
        });
}

function loadSave(filename, saveAppMtime) {
    var extraMsg = '';
    if (saveAppMtime && _currentAppMtime && Math.abs(saveAppMtime - _currentAppMtime) > 1) {
        extraMsg = '<p style="color:#e6a23c;">此存档来自不同版本的程序，加载后将自动适配当前数据库结构。</p>';
    }
    showConfirm('确认读档',
        '<p>确认从存档 <b>' + escHtml(filename) + '</b> 恢复？</p>' +
        '<p style="color:#c62828;">当前数据库将被覆盖，建议先快速存档。</p>' +
        extraMsg
    ).then(function (ok) {
        if (!ok) return;
        fetch('/api/saves/load', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename: filename })
        })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                showToast(d.msg || '读档完成');
                loadSaveList();
                // 提示用户刷新
                if (d.msg && d.msg.indexOf('重启') !== -1) {
                    setTimeout(function () {
                        showConfirm('需要刷新', '读档已生效，是否刷新页面以加载新数据？').then(function (yes) {
                            if (yes) location.reload();
                        });
                    }, 1500);
                }
            });
    });
}

function deleteSave(filename) {
    showConfirm('确认删除', '确认删除存档 <b>' + escHtml(filename) + '</b>？此操作不可恢复。').then(function (ok) {
        if (!ok) return;
        fetch('/api/saves/' + encodeURIComponent(filename), { method: 'DELETE' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                showToast(d.msg || '已删除');
                loadSaveList();
            });
    });
}

function downloadSave(filename) {
    var a = document.createElement('a');
    a.href = '/api/saves/' + encodeURIComponent(filename) + '/download';
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function uploadSaveFile(input) {
    var file = input.files[0];
    if (!file) return;
    var fd = new FormData();
    fd.append('file', file);
    fetch('/api/saves/upload', { method: 'POST', body: fd })
        .then(function (r) { return r.json(); })
        .then(function (d) {
            showToast(d.msg || '导入完成');
            loadSaveList();
        });
    input.value = '';
}

// ========== 数据库位置管理 ==========

function transferDatabase() {
    var newPath = (document.getElementById('db-transfer-path').value || '').trim();
    if (!newPath) { showToast('请输入目标数据库文件路径'); return; }
    showConfirm('转移数据库',
        '<p>将当前数据库复制到：</p><p><code>' + escHtml(newPath) + '</code></p>' +
        '<p style="color:#e6a23c;">操作完成后将自动切换到新位置的数据库，原文件保留。</p>'
    ).then(function (ok) {
        if (!ok) return;
        fetch('/api/db/transfer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: newPath })
        })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                showToast(d.msg || '转移完成');
                document.getElementById('db-transfer-path').value = '';
                loadSaveList();
            });
    });
}

function switchDatabase() {
    var newPath = (document.getElementById('db-switch-path').value || '').trim();
    if (!newPath) { showToast('请输入已有数据库文件路径'); return; }
    showConfirm('切换数据库',
        '<p>切换到已有数据库：</p><p><code>' + escHtml(newPath) + '</code></p>' +
        '<p style="color:#c62828;">请确保该文件是有效的 SQLite 数据库，切换后请刷新页面。</p>'
    ).then(function (ok) {
        if (!ok) return;
        fetch('/api/db/switch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: newPath })
        })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                showToast(d.msg || '切换完成');
                document.getElementById('db-switch-path').value = '';
                loadSaveList();
                // 提示刷新
                if (d.ok) {
                    setTimeout(function () {
                        showConfirm('需要刷新', '数据库已切换，是否刷新页面以加载新数据？').then(function (yes) {
                            if (yes) location.reload();
                        });
                    }, 1000);
                }
            });
    });
}

function changeSaveDirectory() {
    var newDir = (document.getElementById('save-dir-path').value || '').trim();
    if (!newDir) { showToast('请输入存档目录路径'); return; }
    showConfirm('更改存档目录',
        '<p>将存档目录更改为：</p><p><code>' + escHtml(newDir) + '</code></p>' +
        '<p style="color:#e6a23c;">此操作仅修改存档存储位置，不影响数据库位置。已有的存档文件不会自动迁移。</p>'
    ).then(function (ok) {
        if (!ok) return;
        fetch('/api/db/change-save-dir', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: newDir })
        })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                showToast(d.msg || '更改完成');
                document.getElementById('save-dir-path').value = '';
                loadSaveList();
            });
    });
}
```

---

### Task 7: `static/import-export.js` — 导入前自动存档

**Files:**
- Modify: `C:\Users\Admin\Desktop\大家的Draft\zyh\golden\static\import-export.js:144-155`

- [ ] **Step 1: 在 `confirmImport` 中，执行导入前触发自动存档**

找到 `confirmImport` 中发送 `/import_tasks/execute` 的 fetch 调用（第 156-160 行附近）。在执行导入的 fetch 之前，先发一个自动存档请求。

替换：
```javascript
    fetch('/import_tasks/execute', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(body)
    })
```

为：
```javascript
    // 导入前自动存档
    fetch('/api/saves/auto', {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'})
        .catch(function(){})
        .then(function(){
            return fetch('/import_tasks/execute', {
                method:'POST',
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify(body)
            });
        })
```

---

### Task 8: `routes/settings.py` — 种子数据更新

**Files:**
- Modify: `C:\Users\Admin\Desktop\大家的Draft\zyh\golden\db.py:137-143` (`_seed_config` 中的 `nav_order`)

- [ ] **Step 1: 在 `_seed_config` 中添加"数据管理"到导航顺序**

找到 `db.py` 中 `_seed_config` 函数的 nav_order 部分（`("nav_order", "设置", "", 6)` 附近），在其后增加：

```python
        ("nav_order", "数据管理", "", 7),
```

注意：nav_order 是主面板导航（班次设置/机器管理/任务库/排班面板/历史记录/设置），而"数据管理"是设置的子页，不应出现在主面板导航中。所以这一步不需要做。

实际上重新想一下——`nav_order` 控制的是主面板（左侧导航栏），不是设置子页导航。设置子页导航是固定的 HTML 按钮。所以不需要修改 `nav_order`。

---

### Task 8（修订）: `static/core.js` — 主面板导航适配

**Files:**
- Modify: `C:\Users\Admin\Desktop\大家的Draft\zyh\golden\static\core.js:20-21`

- [ ] **Step 1: 不需要修改 NAV_TAB_MAP**

`NAV_TAB_MAP` 只包含主面板的 6 个标签页（班次设置/机器管理/任务库/排班面板/历史记录/设置）。"数据管理"作为设置的子页（sub-6），无需出现在 `NAV_TAB_MAP` 中。无需修改 `core.js`。

---

## 验证方式

1. **启动 Toast** → 用一份已有旧存档的数据库启动程序，打开页面，确认弹出黄色 toast「检测到程序更新。读档旧存档时将自动适配数据库结构。」；刷新页面，确认 toast 不再出现
2. **启动应用** → 检查 `~/.task_schedule_app/save/` 目录下是否自动生成了 `autosave_*.sqlite3` 文件及其 `.meta.json`
3. **快速存档** → 切换到设置 > 数据管理，输入备注"测试存档"，点击"保存当前存档"，确认存档列表中出现新条目
4. **读档** → 点击某个存档的"读档"按钮，确认弹窗，数据被恢复
5. **删除存档** → 点击"删除"，确认存档消失
6. **下载存档** → 点击"下载"，浏览器下载 .sqlite3 文件
7. **导入存档** → 点击"选择 .sqlite3 文件导入"，选择一个之前下载的存档，确认出现在列表中
8. **导入前自动存档** → 在任务库导入 Excel 文件，确认执行导入后 `save/` 目录出现新的 autosave
9. **自动存档轮转** → 修改系统时间为 60 天前，创建一份旧 autosave，恢复时间后启动程序，确认旧存档被清理；修改保留天数为 7 天，确认生效
10. **数据库信息** → 在数据管理面板确认路径、大小、各表行数显示正确
11. **版本变更标记** → 修改任意 .py 文件后启动，确认存档列表出现"版本变更"标记，读档弹窗出现黄色提示
12. **转移数据库** → 在数据管理面板输入新路径（如 `D:\test_transfer.db`），点击"转移数据库"，确认文件被复制到新位置、`db_config.json` 已更新、页面提示刷新后数据正常
13. **切换数据库** → 用另一份已有的 .sqlite3 文件，点击"切换数据库"，确认配置已更新、刷新后数据切换到新库
14. **更改存档目录** → 输入新存档目录路径，确认 `db_config.json` 中 `save_dir` 已更新，后续存档保存到新目录
15. **安全复制验证** → 用 SQLite 的 backup API 复制数据库，确认复制后的文件可被 sqlite3 命令行正常打开
16. **紧急备份轮转** → 连续读档 6 次，确认 `.emergency` 目录只保留最近 5 份紧急备份
17. **路径回退** → 手动删除 `db_config.json` 中配置的数据库文件，重启应用，确认自动回退到默认路径
18. **db_config 验证** → 切换到一个无效文件，确认后端拒绝并返回错误提示
