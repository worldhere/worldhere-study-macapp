import os
import sys
import argparse
import sqlite3

# ====================== 数据持久化（SQLite）======================
def _resolve_db_path() -> str:
    env_path = (os.environ.get("TASK_SCHEDULE_DB_PATH") or "").strip().strip('"').strip("'")
    if env_path:
        return env_path

    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--db", dest="db_path", default="")
    try:
        args, _ = parser.parse_known_args(sys.argv[1:])
        cli_path = (args.db_path or "").strip().strip('"').strip("'")
        if cli_path:
            return cli_path
    except Exception:
        pass

    # 检查 db_config.json
    default_dir = os.path.join(os.path.expanduser("~"), ".task_schedule_app")
    config_file = os.path.join(default_dir, "db_config.json")
    try:
        if os.path.exists(config_file):
            import json as _json
            with open(config_file, "r", encoding="utf-8") as f:
                cfg = _json.load(f) or {}
            cfg_path = cfg.get("db_path", "")
            if cfg_path and os.path.isfile(cfg_path):
                return cfg_path
    except Exception:
        pass

    os.makedirs(default_dir, exist_ok=True)
    return os.path.join(default_dir, "schedule_data.sqlite3")


DB_PATH = _resolve_db_path()
DATA_DIR = os.path.dirname(DB_PATH)
os.makedirs(DATA_DIR, exist_ok=True)

_db_integrity_ok = True


def is_db_integrity_ok():
    """返回上次 init_db() 的完整性检查结果"""
    return _db_integrity_ok

# "任务类型"允许值（前端下拉与后端校验共用）— 从 config 表动态读取
_DEFAULT_TASK_KINDS = ("常规", "接管", "站桩", "真实场景", "移动")


def get_allowed_task_kinds():
    """从 config 表读取允许的任务类型；表不存在或为空时回退到默认值"""
    try:
        conn = get_db()
        rows = conn.execute(
            "SELECT key FROM config WHERE category='task_kinds' ORDER BY sort_order, key"
        ).fetchall()
        conn.close()
        kinds = tuple(r["key"] for r in rows)
        if kinds:
            return kinds
    except Exception:
        pass
    return _DEFAULT_TASK_KINDS


def get_allowed_machine_types():
    """从 config 表读取允许的机器类型；表不存在或为空时回退到默认值"""
    try:
        conn = get_db()
        rows = conn.execute(
            "SELECT key FROM config WHERE category='machine_types' ORDER BY sort_order, key"
        ).fetchall()
        conn.close()
        kinds = tuple(r["key"] for r in rows)
        if kinds:
            return kinds
    except Exception:
        pass
    return ("BR1", "BR2", "Mini")


def get_allowed_machine_statuses():
    """从 config 表读取允许的机器状态；表不存在或为空时回退到默认值"""
    try:
        conn = get_db()
        rows = conn.execute(
            "SELECT key FROM config WHERE category='machine_statuses' ORDER BY sort_order, key"
        ).fetchall()
        conn.close()
        kinds = tuple(r["key"] for r in rows)
        if kinds:
            return kinds
    except Exception:
        pass
    return ("空闲", "工作", "维修停用")


def get_allowed_machine_groups():
    """从 config 表读取允许的机器分组；表不存在或为空时回退到空元组"""
    try:
        conn = get_db()
        rows = conn.execute(
            "SELECT key FROM config WHERE category='machine_groups' ORDER BY sort_order, key"
        ).fetchall()
        conn.close()
        kinds = tuple(r["key"] for r in rows)
        if kinds:
            return kinds
    except Exception:
        pass
    return tuple()


def get_allowed_priorities():
    """从 config 表读取允许的优先级；表不存在或为空时回退到默认值"""
    try:
        conn = get_db()
        rows = conn.execute(
            "SELECT key FROM config WHERE category='priorities' ORDER BY sort_order, key"
        ).fetchall()
        conn.close()
        kinds = tuple(r["key"] for r in rows)
        if kinds:
            return kinds
    except Exception:
        pass
    return ("P0", "P1", "P2")


def get_allowed_difficulties():
    """从 config 表读取允许的难度；表不存在或为空时回退到默认值"""
    try:
        conn = get_db()
        rows = conn.execute(
            "SELECT key FROM config WHERE category='difficulties' ORDER BY sort_order, key"
        ).fetchall()
        conn.close()
        kinds = tuple(r["key"] for r in rows)
        if kinds:
            return kinds
    except Exception:
        pass
    return ("无", "简单", "普通", "困难")


def _seed_config(cur):
    """种子配置数据 — 与当前硬编码值保持一致"""
    items = [
        # (category, key, value, sort_order)
        # 机器类型
        ("machine_types", "BR1", "", 1),
        ("machine_types", "BR2", "", 2),
        ("machine_types", "Mini", "", 3),
        # 任务类型
        ("task_kinds", "常规", "", 1),
        ("task_kinds", "接管", "", 2),
        ("task_kinds", "站桩", "", 3),
        ("task_kinds", "真实场景", "", 4),
        ("task_kinds", "移动", "", 5),
        # 优先级
        ("priorities", "P0", "", 1),
        ("priorities", "P1", "", 2),
        ("priorities", "P2", "", 3),
        # 难度（"无" sort_order=0 表示受保护）
        ("difficulties", "无", "", 0),
        ("difficulties", "简单", "", 1),
        ("difficulties", "普通", "", 2),
        ("difficulties", "困难", "", 3),
        # 导航顺序
        ("nav_order", "班次设置", "", 1),
        ("nav_order", "机器管理", "", 2),
        ("nav_order", "任务库", "", 3),
        ("nav_order", "排班面板", "", 4),
        ("nav_order", "历史记录", "", 5),
        ("nav_order", "设置", "", 6),
        # UI 偏好
        ("ui_settings", "overlay_transparency", "0.85", 0),
        ("ui_settings", "show_shift_overlay", "1", 0),
        ("ui_settings", "enable_animations", "1", 0),
        ("ui_settings", "export_filename", "排班已完成任务", 0),
        ("ui_settings", "particle_background", "0", 0),
        ("ui_settings", "button_ripple", "1", 0),
        ("ui_settings", "glow_hover", "1", 0),
        ("ui_settings", "ribbon_effect", "0", 0),
        # 切割偏好
        ("schedule_settings", "split_placement", "inline", 0),
        ("schedule_settings", "auto_extend_after_repair", "1", 0),
        # 颜色设置
        ("color_settings", "shift_overlay_colors", '{"work":"#facc15","ot":"#f97316","break":"#3b82f6","gap":"#000000"}', 0),
        ("color_settings", "type_colors", '{"BR1":"#3b82f6","BR2":"#10b981","Mini":"#f59e0b"}', 0),
        ("color_settings", "state_colors", '{"completed":"#84cc16","split":"#a78bfa","repair_bg":"#fef2f2","repair_border":"#fca5a5"}', 0),
        # 推送事件开关（默认值：小组长收提醒类，群收公告类）
        ("feishu_push", "event_toggles", '{"task_impending_start":{"leader":true,"group":false},"task_start":{"leader":true,"group":false},"task_confirm_start":{"leader":false,"group":true},"schedule_changes":{"leader":false,"group":true},"exception_start":{"leader":false,"group":true},"exception_end":{"leader":false,"group":true},"task_impending_end":{"leader":true,"group":false},"task_end":{"leader":true,"group":false},"task_confirm_end":{"leader":false,"group":true},"package_complete":{"leader":false,"group":true},"shift_report":{"leader":false,"group":true},"shift_table_screenshot":{"leader":false,"group":true}}', 0),
        # 撤回功能（默认关闭，启用改为 '1'）
        ("undo", "enabled", "0", 0),
    ]
    cur.executemany(
        "INSERT INTO config(category, key, value, sort_order) VALUES (?,?,?,?)",
        items,
    )


def get_config(category=None):
    """读取配置。不传 category 返回全部(按category分组)，传了返回该category的list。"""
    conn = get_db()
    if category:
        rows = conn.execute(
            "SELECT key, value, sort_order FROM config WHERE category=? ORDER BY sort_order, key",
            (category,),
        ).fetchall()
        conn.close()
        return [dict(r) for r in rows]
    else:
        rows = conn.execute(
            "SELECT category, key, value, sort_order FROM config ORDER BY category, sort_order, key"
        ).fetchall()
        conn.close()
        out = {}
        for r in rows:
            cat = r["category"]
            if cat not in out:
                out[cat] = []
            out[cat].append({"key": r["key"], "value": r["value"], "sort_order": r["sort_order"]})
        return out


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


from contextlib import contextmanager


@contextmanager
def get_db_context():
    """上下文管理器，自动关闭连接。推荐在 feishu_sync.py 和 routes/ 中使用。"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout = 5000")
    try:
        yield conn
    finally:
        conn.close()


def init_db():
    conn = get_db()
    cur = conn.cursor()

    # 启用 WAL 模式：写不阻塞读，崩溃恢复能力
    try:
        cur.execute("PRAGMA journal_mode=WAL")
    except Exception:
        pass
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS shift_config (
            key TEXT PRIMARY KEY,
            start TEXT NOT NULL,
            end TEXT NOT NULL,
            overtime TEXT NOT NULL,
            breaks TEXT NOT NULL DEFAULT ''
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS machines (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            status TEXT NOT NULL,
            area TEXT NOT NULL,
            task_kind TEXT NOT NULL DEFAULT '常规',
            remark TEXT NOT NULL DEFAULT ''
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            task_kind TEXT NOT NULL DEFAULT '常规',
            priority TEXT,
            difficulty TEXT,
            duration TEXT,
            est_mode TEXT NOT NULL DEFAULT 'direct',
            op_min INTEGER,
            reset_min INTEGER,
            collect_count INTEGER,
            redundancy_min INTEGER,
            est_minutes INTEGER,
            status TEXT NOT NULL,
            split_group TEXT,
            split_order INTEGER,
            split_items_done INTEGER,
            split_total_items INTEGER
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS schedules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            machine_id INTEGER NOT NULL,
            machine_name TEXT NOT NULL,
            task_id INTEGER,
            task_name TEXT NOT NULL,
            task_type TEXT NOT NULL,
            task_kind TEXT NOT NULL DEFAULT '常规',
            duration TEXT,
            remark TEXT,
            start_min INTEGER NOT NULL,
            end_min INTEGER NOT NULL,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at INTEGER
        )
        """
    )
    conn.commit()

    # 兼容旧库：补上 machines.sort_order
    try:
        cur.execute("ALTER TABLE machines ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0")
        conn.commit()
    except sqlite3.OperationalError:
        pass

    # 兼容旧库：补上 machines.task_kind / tasks.task_kind / schedules.task_kind
    for stmt in (
        "ALTER TABLE machines ADD COLUMN task_kind TEXT NOT NULL DEFAULT '常规'",
        "ALTER TABLE tasks ADD COLUMN task_kind TEXT NOT NULL DEFAULT '常规'",
        "ALTER TABLE schedules ADD COLUMN task_kind TEXT NOT NULL DEFAULT '常规'",
    ):
        try:
            cur.execute(stmt)
            conn.commit()
        except sqlite3.OperationalError:
            pass

    # 兼容旧库：补上 tasks 预估字段
    for stmt in (
        "ALTER TABLE tasks ADD COLUMN est_mode TEXT NOT NULL DEFAULT 'direct'",
        "ALTER TABLE tasks ADD COLUMN op_min INTEGER",
        "ALTER TABLE tasks ADD COLUMN reset_min INTEGER",
        "ALTER TABLE tasks ADD COLUMN collect_count INTEGER",
        "ALTER TABLE tasks ADD COLUMN redundancy_min INTEGER",
        "ALTER TABLE tasks ADD COLUMN est_minutes INTEGER",
    ):
        try:
            cur.execute(stmt)
            conn.commit()
        except sqlite3.OperationalError:
            pass

    # 兼容旧库：补上 tasks.remark
    try:
        cur.execute("ALTER TABLE tasks ADD COLUMN remark TEXT NOT NULL DEFAULT ''")
        conn.commit()
    except sqlite3.OperationalError:
        pass

    # 兼容旧库：补上 tasks 详细模式字段
    for stmt, col in [
        ("ALTER TABLE tasks ADD COLUMN rbp_task_id TEXT NOT NULL DEFAULT ''", "rbp_task_id"),
        ("ALTER TABLE tasks ADD COLUMN scene TEXT NOT NULL DEFAULT ''", "scene"),
        ("ALTER TABLE tasks ADD COLUMN general_category TEXT NOT NULL DEFAULT ''", "general_category"),
        ("ALTER TABLE tasks ADD COLUMN source_link TEXT NOT NULL DEFAULT ''", "source_link"),
        ("ALTER TABLE tasks ADD COLUMN expected_count INTEGER", "expected_count"),
        ("ALTER TABLE tasks ADD COLUMN collection_req_id TEXT NOT NULL DEFAULT ''", "collection_req_id"),
        ("ALTER TABLE tasks ADD COLUMN collection_req_type TEXT NOT NULL DEFAULT ''", "collection_req_type"),
    ]:
        try:
            cur.execute(stmt)
            conn.commit()
        except sqlite3.OperationalError:
            pass

    # 兼容旧库：补上 tasks.est_seconds（估算秒数）
    try:
        cur.execute("ALTER TABLE tasks ADD COLUMN est_seconds INTEGER")
        conn.commit()
    except sqlite3.OperationalError:
        pass
    # 将旧 est_minutes 迁移为 est_seconds
    cur.execute("UPDATE tasks SET est_seconds = est_minutes * 60 WHERE est_seconds IS NULL AND est_minutes IS NOT NULL")
    conn.commit()

    # 兼容旧库：补上 shift_config.breaks
    try:
        cur.execute("ALTER TABLE shift_config ADD COLUMN breaks TEXT NOT NULL DEFAULT ''")
        conn.commit()
    except sqlite3.OperationalError:
        pass

    # 配置表（动态枚举 + 偏好设置）
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS config (
            category TEXT NOT NULL,
            key TEXT NOT NULL,
            value TEXT NOT NULL DEFAULT '',
            sort_order INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (category, key)
        )
        """
    )
    conn.commit()

    # 种子配置数据（仅首次空表时写入）
    cur.execute("SELECT COUNT(*) AS c FROM config")
    if int(cur.fetchone()["c"]) == 0:
        _seed_config(cur)
        conn.commit()

    # 删除日志表
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS deletion_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            deleted_at TEXT NOT NULL,
            table_name TEXT NOT NULL,
            record_id INTEGER NOT NULL,
            record_json TEXT NOT NULL
        )
        """
    )
    conn.commit()

    # 维修日志表
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS repair_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            machine_id INTEGER NOT NULL,
            start_datetime TEXT NOT NULL,
            end_datetime TEXT,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.commit()

    # 任务包表
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS task_packages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            deadline TEXT,
            priority TEXT NOT NULL DEFAULT 'P1',
            machine_type TEXT NOT NULL DEFAULT 'BR2',
            created_at TEXT NOT NULL
        )
        """
    )
    conn.commit()

    # 论坛帖子表
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS shift_posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL DEFAULT '',
            author TEXT NOT NULL DEFAULT '',
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    conn.commit()

    # 兼容旧库：补上 machines.group_name（须在 groups 种子数据之前）
    try:
        cur.execute("ALTER TABLE machines ADD COLUMN group_name TEXT NOT NULL DEFAULT ''")
        conn.commit()
    except sqlite3.OperationalError:
        pass

    # 机器分组表
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS groups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            day_leader TEXT NOT NULL DEFAULT '',
            night_leader TEXT NOT NULL DEFAULT '',
            remark TEXT NOT NULL DEFAULT ''
        )
        """
    )
    conn.commit()

    # 推送日志表（去重 + 值变化检测）
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS push_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            dedup_key TEXT NOT NULL,
            event_type TEXT NOT NULL,
            target_type TEXT NOT NULL,
            target_id TEXT NOT NULL,
            notify_value TEXT,
            sent_at TEXT NOT NULL,
            success INTEGER NOT NULL DEFAULT 1
        )
        """
    )
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_push_log_dedup ON push_log(dedup_key, target_id)"
    )
    conn.commit()

    # 种子分组数据：从 machines.group_name 去重生成
    cur.execute("SELECT COUNT(*) AS c FROM groups")
    if int(cur.fetchone()["c"]) == 0:
        cur.execute(
            "INSERT OR IGNORE INTO groups (name) SELECT DISTINCT group_name FROM machines WHERE group_name IS NOT NULL AND group_name != ''"
        )
        conn.commit()

    # 旧数据若 sort_order 还为 0，则初始化成 id（保证有稳定顺序）
    cur.execute("UPDATE machines SET sort_order=id WHERE sort_order=0")
    # 旧数据 task_kind 为空则填常规
    cur.execute("UPDATE machines SET task_kind='常规' WHERE task_kind IS NULL OR task_kind=''")
    cur.execute("UPDATE tasks SET task_kind='常规' WHERE task_kind IS NULL OR task_kind=''")
    cur.execute("UPDATE schedules SET task_kind='常规' WHERE task_kind IS NULL OR task_kind=''")
    conn.commit()

    # 初始数据（仅首次空库时写入）
    cur.execute("SELECT COUNT(*) AS c FROM shift_config")
    if int(cur.fetchone()["c"]) == 0:
        cur.executemany(
            "INSERT INTO shift_config(key,start,end,overtime,breaks) VALUES (?,?,?,?,?)",
            [
                ("day_shift", "09:00", "18:30", "19:00-21:00", "12:00-13:30,16:00-16:30,18:30-19:00"),
                ("night_shift", "21:00", "06:30", "06:30-08:30", "00:00-01:30,04:30-05:00"),
            ],
        )
        conn.commit()

    cur.execute("SELECT COUNT(*) AS c FROM machines")
    if int(cur.fetchone()["c"]) == 0:
        cur.executemany(
            "INSERT INTO machines(sort_order,name,type,status,area,task_kind) VALUES (?,?,?,?,?,?)",
            [
                (1, "BR1-01", "BR1", "空闲", "站桩", "常规"),
                (2, "BR2-01", "BR2", "空闲", "移动", "常规"),
                (3, "Mini-01", "Mini", "维修停用", "真实场景", "常规"),
                (4, "BR1-02", "BR1", "空闲", "站桩", "常规"),
            ],
        )
        conn.commit()

    cur.execute("SELECT COUNT(*) AS c FROM tasks")
    if int(cur.fetchone()["c"]) == 0:
        cur.execute(
            "INSERT INTO tasks(name,type,priority,difficulty,duration,status) VALUES (?,?,?,?,?,?)",
            ("常规采集任务", "BR1", "P1", "普通", "2h", "待分配"),
        )
        conn.commit()

    # 兼容旧库：补上 schedules.completed_at
    try:
        cur.execute("ALTER TABLE schedules ADD COLUMN completed_at TEXT")
        conn.commit()
    except sqlite3.OperationalError:
        pass

    # 兼容旧库：补上 tasks 切割字段
    for stmt in (
        "ALTER TABLE tasks ADD COLUMN split_group TEXT",
        "ALTER TABLE tasks ADD COLUMN split_order INTEGER",
        "ALTER TABLE tasks ADD COLUMN split_items_done INTEGER",
        "ALTER TABLE tasks ADD COLUMN split_total_items INTEGER",
    ):
        try:
            cur.execute(stmt)
            conn.commit()
        except sqlite3.OperationalError:
            pass

    # 兼容旧库：补上 repair_log 表
    try:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS repair_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                machine_id INTEGER NOT NULL,
                start_datetime TEXT NOT NULL,
                end_datetime TEXT,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.commit()
    except sqlite3.OperationalError:
        pass

    # 兼容旧库：补上 machines.remark
    try:
        cur.execute("ALTER TABLE machines ADD COLUMN remark TEXT NOT NULL DEFAULT ''")
        conn.commit()
    except sqlite3.OperationalError:
        pass

    # 兼容旧库：补上 tasks.package_id
    try:
        cur.execute("ALTER TABLE tasks ADD COLUMN package_id INTEGER DEFAULT NULL")
        conn.commit()
    except sqlite3.OperationalError:
        pass

    # 飞书同步：schedules 新增实际时间字段
    try:
        cur.execute("ALTER TABLE schedules ADD COLUMN actual_start_min INTEGER")
        conn.commit()
    except sqlite3.OperationalError:
        pass
    try:
        cur.execute("ALTER TABLE schedules ADD COLUMN actual_end_min INTEGER")
        conn.commit()
    except sqlite3.OperationalError:
        pass

    # 飞书同步 v2：异常标记/备注落本地
    try:
        cur.execute("ALTER TABLE schedules ADD COLUMN exception_mark TEXT")
        conn.commit()
    except sqlite3.OperationalError:
        pass
    try:
        cur.execute("ALTER TABLE schedules ADD COLUMN exception_note TEXT")
        conn.commit()
    except sqlite3.OperationalError:
        pass

    # 双向同步：记录最后确认的飞书时间戳（毫秒），用于 pull 时判断改动源头
    try:
        cur.execute("ALTER TABLE schedules ADD COLUMN updated_at INTEGER")
        conn.commit()
    except sqlite3.OperationalError:
        pass

    # 飞书字段重设计：排班漂移前窗口
    try:
        cur.execute("ALTER TABLE schedules ADD COLUMN estimated_window TEXT")
        conn.commit()
    except sqlite3.OperationalError:
        pass

    # Last Write Wins 同步：本地修改时间戳
    try:
        cur.execute("ALTER TABLE schedules ADD COLUMN local_modified_at INTEGER NOT NULL DEFAULT 0")
        conn.commit()
    except sqlite3.OperationalError:
        pass

    # 采集员字段：飞书拉取的排班级用户，逗号分隔 open_id
    try:
        cur.execute("ALTER TABLE schedules ADD COLUMN collector TEXT NOT NULL DEFAULT ''")
        conn.commit()
    except sqlite3.OperationalError:
        pass

    # 飞书同步：映射表
    cur.execute("""
        CREATE TABLE IF NOT EXISTS feishu_sync_mapping (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            machine_id INTEGER NOT NULL UNIQUE,
            machine_name TEXT NOT NULL,
            app_token TEXT NOT NULL,
            table_id TEXT NOT NULL,
            last_pull_at TEXT,
            last_push_at TEXT,
            last_push_snapshot TEXT
        )
    """)
    conn.commit()

    # 飞书同步 v2：旧库补加 last_push_snapshot 列
    try:
        cur.execute("ALTER TABLE feishu_sync_mapping ADD COLUMN last_push_snapshot TEXT")
        conn.commit()
    except sqlite3.OperationalError:
        pass

    # 飞书字段重设计：本地 schedule_id ↔ feishu_record_id 映射（替代飞书 _记录ID）
    cur.execute("""
        CREATE TABLE IF NOT EXISTS feishu_record_mapping (
            schedule_id INTEGER PRIMARY KEY,
            machine_id INTEGER NOT NULL,
            feishu_record_id TEXT NOT NULL
        )
    """)
    conn.commit()

    # 飞书字段备份表：每次 pull 拿到飞书端最新值时存一份，防止列被删后数据丢失
    cur.execute("""
        CREATE TABLE IF NOT EXISTS feishu_field_backup (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            schedule_id INTEGER NOT NULL,
            machine_id INTEGER NOT NULL,
            field_name TEXT NOT NULL,
            field_value TEXT NOT NULL,
            recorded_at TEXT NOT NULL,
            UNIQUE(schedule_id, field_name)
        )
    """)
    conn.commit()

    # Last Write Wins 同步：schedule 任意 UPDATE 时自动打时间戳。
    # push/pull 代码显式写 local_modified_at 会导致 OLD ≠ NEW，触发器不执行。
    cur.execute("""
        CREATE TRIGGER IF NOT EXISTS schedules_local_modified_touch
        AFTER UPDATE ON schedules
        WHEN OLD.local_modified_at = NEW.local_modified_at
        BEGIN
            UPDATE schedules SET local_modified_at = CAST(
                (julianday('now') - 2440587.5) * 86400000 AS INTEGER
            ) WHERE id = NEW.id;
        END;
    """)
    conn.commit()

    # 论坛默认设置（仅在首次运行时写入）
    cur.execute("SELECT COUNT(*) AS c FROM config WHERE category='forum_settings' AND key='forum_enabled'")
    if int(cur.fetchone()["c"]) == 0:
        cur.executemany(
            "INSERT INTO config(category,key,value,sort_order) VALUES (?,?,?,0)",
            [
                ("forum_settings", "forum_enabled", "1"),
                ("forum_settings", "forum_retention_days", "3"),
            ],
        )
        conn.commit()

    # 飞书同步：默认配置
    cur.execute("SELECT COUNT(*) AS c FROM config WHERE category='feishu' AND key='sync_enabled'")
    if int(cur.fetchone()["c"]) == 0:
        cur.execute(
            "INSERT INTO config(category, key, value, sort_order) VALUES ('feishu', 'sync_enabled', '0', 0)"
        )
        cur.execute(
            "INSERT INTO config(category, key, value, sort_order) VALUES (?, ?, ?, 1)",
            ("feishu", "exception_options", '["正常", "机器故障", "缺少物料", "无法执行"]'),
        )
        cur.execute(
            "INSERT INTO config(category, key, value, sort_order) VALUES (?, ?, ?, 2)",
            ("feishu", "sync_mode", "local"),
        )
        conn.commit()
    else:
        # 确保 sync_mode 配置项存在（老数据库迁移）
        cur.execute("SELECT COUNT(*) AS c FROM config WHERE category='feishu' AND key='sync_mode'")
        if int(cur.fetchone()["c"]) == 0:
            cur.execute(
                "INSERT INTO config(category, key, value, sort_order) VALUES (?, ?, ?, 2)",
                ("feishu", "sync_mode", "local"),
            )
            conn.commit()

    # 撤回功能：默认配置（老数据库迁移）
    cur.execute("SELECT COUNT(*) AS c FROM config WHERE category='undo' AND key='enabled'")
    if int(cur.fetchone()["c"]) == 0:
        cur.execute(
            "INSERT INTO config(category, key, value, sort_order) VALUES ('undo', 'enabled', '0', 0)"
        )
        conn.commit()

    # 数据迁移：统一历史遗留的 "已确认" 状态为 "已完成"
    cur.execute("UPDATE tasks SET status='已完成' WHERE status='已确认'")
    conn.commit()

    # 数据修复：飞书同步可能只标记排班完成而未联动任务状态，补齐遗漏
    cur.execute("""
        UPDATE tasks SET status='已完成'
        WHERE id IN (
            SELECT t.id FROM tasks t
            WHERE t.status NOT IN ('已完成', '待分配')
              AND (SELECT COUNT(*) FROM schedules WHERE task_id=t.id) > 0
              AND (SELECT COUNT(*) FROM schedules WHERE task_id=t.id AND status!='completed') = 0
        )
    """)
    conn.commit()

    # 启动时合并 WAL 到主文件，减小 WAL 体积
    try:
        cur.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    except Exception:
        pass

    # 数据库完整性检查
    global _db_integrity_ok
    try:
        row = cur.execute("PRAGMA integrity_check").fetchone()
        _db_integrity_ok = row and row[0] == "ok"
    except Exception:
        _db_integrity_ok = False

    conn.close()

    if not _db_integrity_ok:
        import sys as _sys
        print("⚠ 数据库完整性检查失败！建议从存档恢复。", file=_sys.stderr)


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
        conn.row_factory = sqlite3.Row
        tables = ["machines", "tasks", "schedules", "config", "deletion_log", "repair_log", "shift_config", "groups"]
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
