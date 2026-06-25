import sys as _sys
import os as _os

from flask import Flask


def _resource_path(relative_path):
    """获取资源文件的绝对路径，兼容开发模式和 PyInstaller 打包"""
    if getattr(_sys, 'frozen', False):
        base_path = _sys._MEIPASS
    else:
        base_path = _os.path.dirname(_os.path.abspath(__file__))
    return _os.path.join(base_path, relative_path)


from db import init_db, DB_PATH, DATA_DIR, is_db_integrity_ok
from save_utils import get_save_dir, create_save, rotate_autosaves
from routes.views import bp as views_bp
from routes.machines import bp as machines_bp
from routes.tasks import bp as tasks_bp
from routes.schedules import bp as schedules_bp
from routes.schedule_ops import bp as schedule_ops_bp
from routes.schedule_cut import bp as schedule_cut_bp
from routes.settings import bp as settings_bp
from routes.saves import bp as saves_bp
from routes.shift_posts import bp as shift_posts_bp
from routes.feishu import bp as feishu_bp
from routes.undo import bp as undo_bp
from routes.summary import bp as summary_bp

app = Flask(__name__,
            template_folder=_resource_path('templates'),
            static_folder=_resource_path('static'))

init_db()

app.register_blueprint(views_bp)
app.register_blueprint(machines_bp)
app.register_blueprint(tasks_bp)
app.register_blueprint(schedules_bp)
app.register_blueprint(schedule_ops_bp)
app.register_blueprint(schedule_cut_bp)
app.register_blueprint(settings_bp)
app.register_blueprint(saves_bp)
app.register_blueprint(shift_posts_bp)
app.register_blueprint(feishu_bp)
app.register_blueprint(undo_bp)
app.register_blueprint(summary_bp)

# 启动时数据库完整性检查
if not is_db_integrity_ok():
    import sys as _sys
    print("⚠ 数据库完整性检查失败！建议从存档恢复。", file=_sys.stderr)

# 启动时自动存档
try:
    save_dir = get_save_dir(DB_PATH)
    create_save(DB_PATH, save_dir, note="", is_autosave=True)
    rotate_autosaves(save_dir, db_path=DB_PATH)
except Exception:
    pass

# 启动时强制关闭飞书同步（每次启动需手动开启，触发方向选择）
try:
    from db import get_db
    conn = get_db()
    conn.execute(
        "UPDATE config SET value='0' WHERE category='feishu' AND key='sync_enabled'"
    )
    conn.commit()
    conn.close()
except Exception:
    pass

# 启动运行时自动存档线程
import threading
import time as _time

_autosave_stop_event = threading.Event()
_autosave_thread = None


def _autosave_loop():
    """后台定时自动存档"""
    # 读取存档间隔配置（分钟），默认 120 分钟
    interval_minutes = 120
    try:
        from db import get_db
        conn = get_db()
        row = conn.execute(
            "SELECT value FROM config WHERE category='schedule_settings' AND key='autosave_interval_minutes'"
        ).fetchone()
        conn.close()
        if row and row["value"].strip():
            interval_minutes = max(30, int(row["value"].strip()))
    except Exception:
        pass

    interval_seconds = interval_minutes * 60
    while not _autosave_stop_event.is_set():
        for _ in range(interval_seconds):
            if _autosave_stop_event.is_set():
                return
            _time.sleep(1)
        try:
            save_dir = get_save_dir(DB_PATH)
            create_save(DB_PATH, save_dir, note="", is_autosave=True)
            rotate_autosaves(save_dir, db_path=DB_PATH)
            # 清理过期的撤回会话目录
            try:
                from undo_utils import cleanup_orphans
                cleanup_orphans()
            except Exception:
                pass
        except Exception:
            pass


def start_autosave_thread():
    """启动后台自动存档线程（幂等）"""
    global _autosave_thread
    if _autosave_thread and _autosave_thread.is_alive():
        return
    _autosave_stop_event.clear()
    _autosave_thread = threading.Thread(target=_autosave_loop, daemon=True, name="autosave")
    _autosave_thread.start()


def stop_autosave_thread():
    """停止后台自动存档线程"""
    _autosave_stop_event.set()


start_autosave_thread()

if __name__ == '__main__':
    # 生产模式：关闭 debug，启用多线程处理请求
    app.run(host='127.0.0.1', port=5000, debug=False, threaded=True)
