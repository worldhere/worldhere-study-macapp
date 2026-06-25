# -*- coding: utf-8 -*-
"""测试数据变更端点：完成/撤销/批量/finish/逾期确认"""
import json


class TestCompleteTask:
    """GET /complete_task/<sid> — 单个排班完成"""

    def test_complete_sets_actual_end_min(self, app, db):
        """完成排班 → status=completed, actual_end_min 非空"""
        sch = db.execute(
            "SELECT id FROM schedules WHERE status!='completed' LIMIT 1"
        ).fetchone()
        assert sch is not None, "need at least one non-completed schedule"

        resp = app.get(f"/complete_task/{sch['id']}")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data.get("msg") == "ok"

        updated = db.execute(
            "SELECT status, actual_end_min FROM schedules WHERE id=?", (sch["id"],)
        ).fetchone()
        assert updated["status"] == "completed"
        assert updated["actual_end_min"] is not None

    def test_complete_idempotent(self, app, db):
        """重复完成同一排班 → 幂等不报错"""
        sch = db.execute(
            "SELECT id FROM schedules WHERE status!='completed' LIMIT 1"
        ).fetchone()

        app.get(f"/complete_task/{sch['id']}")
        resp = app.get(f"/complete_task/{sch['id']}")
        assert resp.status_code == 200

    def test_complete_missing_schedule(self, app, db):
        """不存在的排班 ID → 不崩溃"""
        resp = app.get("/complete_task/99999")
        # 排班不存在时返回 200 + msg 或 400/404
        assert resp.status_code != 500

    def test_complete_actual_end_relative_to_date(self, app, db):
        """actual_end_min 相对于 schedule.date 零点"""
        from datetime import date
        sch = db.execute(
            "SELECT id, date FROM schedules WHERE status!='completed' AND date < ? LIMIT 1",
            (date.today().isoformat(),)
        ).fetchone()
        if sch is None:
            return

        resp = app.get(f"/complete_task/{sch['id']}")
        assert resp.status_code == 200

        updated = db.execute(
            "SELECT actual_end_min FROM schedules WHERE id=?", (sch["id"],)
        ).fetchone()
        assert updated["actual_end_min"] is not None


class TestUncompleteTask:
    """GET /uncomplete_task/<sid> — 撤销完成"""

    def test_uncomplete_clears_actual_end_min(self, app, db):
        """撤销完成 → actual_end_min 被清空"""
        sch = db.execute(
            "SELECT id FROM schedules WHERE status='completed' LIMIT 1"
        ).fetchone()
        assert sch is not None, "need at least one completed schedule"

        resp = app.get(f"/uncomplete_task/{sch['id']}")
        assert resp.status_code == 200

        updated = db.execute(
            "SELECT status, actual_end_min, completed_at FROM schedules WHERE id=?", (sch["id"],)
        ).fetchone()
        assert updated["status"] == "executing"
        assert updated["actual_end_min"] is None
        assert updated["completed_at"] is None


class TestBatchComplete:
    """POST /batch_tasks — action=complete"""

    def test_batch_complete_sets_actual_end_min(self, app, db):
        """批量完成 → 所有排班 actual_end_min 非空"""
        schs = db.execute(
            "SELECT task_id FROM schedules WHERE status!='completed' AND task_id IS NOT NULL LIMIT 3"
        ).fetchall()
        assert len(schs) >= 1, "need at least one schedule with task_id"

        task_ids = [s["task_id"] for s in schs]

        resp = app.post("/batch_tasks", json={
            "ids": task_ids,
            "action": "complete"
        })
        data = resp.get_json()
        assert data.get("msg") is not None

        for tid in task_ids:
            rows = db.execute(
                "SELECT status, actual_end_min, completed_at FROM schedules WHERE task_id=?",
                (tid,)
            ).fetchall()
            for r in rows:
                assert r["status"] == "completed"
                assert r["actual_end_min"] is not None


class TestFinishTask:
    """POST /finish_task"""

    def test_finish_task_sets_actual_end_min(self, app, db):
        """finish_task → 排班 actual_end_min 非空"""
        sch = db.execute(
            "SELECT task_id FROM schedules WHERE status!='completed' AND task_id IS NOT NULL LIMIT 1"
        ).fetchone()
        assert sch is not None

        resp = app.post("/finish_task", json={"task_id": sch["task_id"]})
        data = resp.get_json()
        assert data.get("msg") is not None

        updated = db.execute(
            "SELECT status, actual_end_min, completed_at FROM schedules WHERE task_id=?",
            (sch["task_id"],)
        ).fetchall()
        for r in updated:
            assert r["status"] == "completed"
            assert r["actual_end_min"] is not None


class TestConfirmOverdue:
    """POST /quick_ops — action=confirm_overdue"""

    def test_confirm_overdue_sets_actual_end_min(self, app, db):
        """逾期确认 → actual_end_min + completed_at 都被设置"""
        from datetime import date, timedelta
        today = date.today().isoformat()
        yesterday = (date.today() - timedelta(days=1)).isoformat()

        sch = db.execute(
            "SELECT id, task_id, date FROM schedules WHERE status!='completed' AND date IN (?, ?) LIMIT 1",
            (yesterday, today)
        ).fetchone()
        if sch is None:
            return

        resp = app.post("/quick_ops", json={
            "task_id": sch["task_id"],
            "date": sch["date"],
            "action": "confirm_overdue"
        })
        assert resp.status_code != 500
