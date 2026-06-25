# -*- coding: utf-8 -*-
"""任务包管理：创建、更新、删除、查询任务包"""
import datetime
from typing import List, Dict
from db import get_db


def list_task_packages(completed_only: bool = False) -> List[Dict]:
    """返回所有任务包，附带已分配/已完成/总数统计。
    当 completed_only=True 时，只返回全部任务均完成的包。"""
    conn = get_db()
    if completed_only:
        packages = conn.execute(
            """SELECT id, name, deadline, priority, machine_type, created_at FROM task_packages p
               WHERE (SELECT COUNT(*) FROM tasks WHERE package_id=p.id AND status='已完成') > 0
               ORDER BY id DESC"""
        ).fetchall()
    else:
        packages = conn.execute(
            "SELECT id, name, deadline, priority, machine_type, created_at FROM task_packages ORDER BY id DESC"
        ).fetchall()
    result = []
    for p in packages:
        pid = int(p["id"])
        total = conn.execute("SELECT COUNT(*) AS c FROM tasks WHERE package_id=?", (pid,)).fetchone()["c"]
        completed = conn.execute(
            "SELECT COUNT(*) AS c FROM tasks WHERE package_id=? AND status='已完成'", (pid,)
        ).fetchone()["c"]
        assigned = conn.execute(
            "SELECT COUNT(*) AS c FROM tasks WHERE package_id=? AND status != '待分配'", (pid,)
        ).fetchone()["c"]
        item = dict(p)
        item["total"] = total
        item["completed"] = completed
        item["assigned"] = assigned
        result.append(item)
    conn.close()
    return result


def create_task_package(name, deadline=None, machine_type="BR2", priority="P1") -> int:
    """创建空任务包，返回 id"""
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO task_packages(name, deadline, priority, machine_type, created_at) VALUES (?,?,?,?,?)",
        (name, deadline, priority, machine_type,
         datetime.datetime.now().isoformat(timespec="seconds")),
    )
    conn.commit()
    pid = cur.lastrowid
    conn.close()
    return pid


def update_task_package(package_id, name=None, deadline=None, machine_type=None, priority=None):
    """更新任务包字段（只更新传入的非 None 字段）"""
    conn = get_db()
    fields = {}
    if name is not None:
        fields["name"] = name
    if deadline is not None:
        fields["deadline"] = deadline
    if machine_type is not None:
        fields["machine_type"] = machine_type
    if priority is not None:
        fields["priority"] = priority
    if fields:
        sets = ", ".join(f"{k}=?" for k in fields)
        vals = list(fields.values()) + [int(package_id)]
        conn.execute(f"UPDATE task_packages SET {sets} WHERE id=?", vals)
        conn.commit()
    conn.close()


def delete_task_package(package_id, cascade=False):
    """删除任务包。cascade=true: 级联删除未完成子任务+排班。cascade=false: 回收子任务到待分配。
    已完成任务始终保持，仅清除 package_id。"""
    conn = get_db()

    if cascade:
        conn.execute(
            "DELETE FROM schedules WHERE task_id IN (SELECT id FROM tasks WHERE package_id=? AND status!='已完成')",
            (int(package_id),),
        )
        conn.execute(
            "DELETE FROM tasks WHERE package_id=? AND status!='已完成'",
            (int(package_id),),
        )
    else:
        conn.execute(
            "DELETE FROM schedules WHERE task_id IN (SELECT id FROM tasks WHERE package_id=? AND status!='已完成')",
            (int(package_id),),
        )
        conn.execute(
            "UPDATE tasks SET status='待分配' WHERE package_id=? AND status!='已完成'",
            (int(package_id),),
        )

    conn.execute("UPDATE tasks SET package_id=NULL WHERE package_id=?", (int(package_id),))
    conn.execute("DELETE FROM task_packages WHERE id=?", (int(package_id),))
    conn.commit()
    conn.close()


def add_tasks_to_package(package_id, task_ids):
    """将已有任务加入任务包"""
    if not task_ids:
        return
    conn = get_db()
    placeholders = ",".join("?" * len(task_ids))
    conn.execute(
        f"UPDATE tasks SET package_id=? WHERE id IN ({placeholders})",
        [int(package_id)] + [int(t) for t in task_ids],
    )
    conn.commit()
    conn.close()


def get_package_tasks(package_id):
    """获取某任务包内所有任务"""
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM tasks WHERE package_id=? ORDER BY id",
        (int(package_id),),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]
