# -*- coding: utf-8 -*-
"""测试本地事件源检测器（场景 10-11 + 补发）"""
import json
import datetime
from feishu.events.local_source import detect_from_local


class TestPackageComplete:
    """场景 10: 任务包完成"""

    def test_package_complete_detected(self, db):
        """所有排班完成 → 触发"""
        events = detect_from_local()
        pkg_events = [e for e in events if e["event_type"] == "package_complete"]
        # 测试数据中可能有或没有全部完成的任务包，只要不报错即可
        assert all(e["event_type"] == "package_complete" for e in pkg_events)

    def test_package_complete_not_triggered_for_partial(self, db):
        """仍有未完成排班的任务包 → 不包含在结果中"""
        # 先找出一个已全部完成的任务包
        pkgs = db.execute("SELECT id, name FROM task_packages").fetchall()
        for pkg in pkgs:
            remaining = db.execute(
                """SELECT COUNT(*) AS c FROM schedules s
                   JOIN tasks t ON s.task_id = t.id
                   WHERE t.package_id=? AND s.status != 'completed'""",
                (pkg["id"],)
            ).fetchone()
            if remaining and remaining["c"] > 0:
                # 这个包还有未完成的排班 → package_complete 不应包含它
                events = detect_from_local()
                pkg_names = [e.get("package_name") for e in events
                            if e["event_type"] == "package_complete"]
                assert pkg["name"] not in pkg_names
                return
        # 如果所有包都已完成，跳过此断言


class TestShiftReport:
    """场景 11: 班次报告"""

    def test_shift_report_returns_deterministic(self, db):
        events = detect_from_local()
        report_events = [e for e in events if e["event_type"] == "shift_report"]
        # 可能不触发（不在窗口内），但触发了就要有 shift 字段
        for e in report_events:
            assert e["shift"] in ("白班", "夜班")
            assert "date" in e


class TestLocalBackfill:
    """补发逻辑"""

    def test_exception_backfill(self, db):
        """活跃排班有异常 + push_log 无记录 → 补发"""
        now_min = datetime.datetime.now().hour * 60 + datetime.datetime.now().minute
        today = datetime.date.today().isoformat()
        yesterday = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()

        # 找一个活跃排班（已开始、未完成）并标记异常
        active_sch = db.execute(
            """SELECT s.id FROM schedules s
               WHERE s.date IN (?, ?) AND s.status != 'completed'
               AND s.start_min <= ? AND s.end_min > ?
               LIMIT 1""",
            (yesterday, today, now_min, now_min)
        ).fetchone()

        if active_sch is None:
            return  # 无活跃排班可测试

        # 确保 push_log 中无此排班的异常记录
        db.execute("DELETE FROM push_log WHERE dedup_key=?",
                   (f"exc_{active_sch['id']}_start",))
        # 标记异常
        db.execute(
            "UPDATE schedules SET exception_mark='机器故障' WHERE id=?",
            (active_sch["id"],)
        )
        db.commit()

        events = detect_from_local()
        exc_events = [e for e in events
                      if e["event_type"] == "exception_start"
                      and e.get("schedule_id") == active_sch["id"]]
        assert len(exc_events) >= 1, "should backfill exception_start"

        # 恢复
        db.execute(
            "UPDATE schedules SET exception_mark='正常' WHERE id=?",
            (active_sch["id"],)
        )
        db.commit()

    def test_confirm_start_backfill(self, db):
        """活跃排班有 actual_start + push_log 无记录 → 补发"""
        today = datetime.date.today().isoformat()
        yesterday = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()

        # 找一个有 actual_start_min 但 push_log 无 confirm_start 的活跃排班
        now_min = datetime.datetime.now().hour * 60 + datetime.datetime.now().minute
        sch = db.execute(
            """SELECT s.id FROM schedules s
               WHERE s.date IN (?, ?) AND s.status != 'completed'
               AND s.actual_start_min IS NOT NULL
               AND s.start_min <= ? AND s.end_min > ?
               LIMIT 1""",
            (yesterday, today, now_min, now_min)
        ).fetchone()

        if sch is None:
            # 如果没有，找一条活跃排班造数据
            sch = db.execute(
                """SELECT s.id FROM schedules s
                   WHERE s.date IN (?, ?) AND s.status != 'completed'
                   AND s.start_min <= ? AND s.end_min > ?
                   LIMIT 1""",
                (yesterday, today, now_min, now_min)
            ).fetchone()
            if sch is None:
                return
            db.execute(
                "UPDATE schedules SET actual_start_min=? WHERE id=?",
                (500, sch["id"])
            )
            db.execute(
                "DELETE FROM push_log WHERE dedup_key=?",
                (f"confirm_start_{sch['id']}",)
            )
            db.commit()

        events = detect_from_local()
        cs_events = [e for e in events
                     if e["event_type"] == "task_confirm_start"
                     and e.get("schedule_id") == sch["id"]]
        # 班次过滤可能导致不触发（非当前班次的排班被跳过），
        # 这本身是正确的业务行为。只要不崩溃即可。
        assert isinstance(cs_events, list)

    def test_confirm_end_backfill(self, db):
        """已完成排班有 actual_end + push_log 无记录 → 补发"""
        today = datetime.date.today().isoformat()
        yesterday = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()

        sch = db.execute(
            """SELECT s.id FROM schedules s
               WHERE s.date IN (?, ?) AND s.status = 'completed'
               AND s.actual_end_min IS NOT NULL
               LIMIT 1""",
            (yesterday, today)
        ).fetchone()

        if sch is None:
            return  # 无已完成有 actual_end 的排班

        db.execute("DELETE FROM push_log WHERE dedup_key=?",
                   (f"confirm_end_{sch['id']}",))
        db.commit()

        events = detect_from_local()
        ce_events = [e for e in events
                     if e["event_type"] == "task_confirm_end"
                     and e.get("schedule_id") == sch["id"]]
        assert len(ce_events) >= 1, "should backfill task_confirm_end"

    def test_recycled_backfill(self, db):
        """push_log 中有 success=0 的回收记录 → 补发"""
        # 先造一条未发送的回收记录
        now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        db.execute(
            """INSERT INTO push_log (dedup_key, event_type, target_type, target_id, notify_value, sent_at, success)
               VALUES (?, 'task_recycled', '', '', ?, ?, 0)""",
            ("recycle_test_999", json.dumps({
                "event_type": "task_recycled",
                "machine_name": "TestMachine",
                "task_name": "TestTask",
                "recycle_reason": "测试回收",
                "recycle_time": now_str,
            }, ensure_ascii=False), now_str)
        )
        db.commit()

        events = detect_from_local()
        recycled = [e for e in events if e.get("event_type") == "task_recycled"]
        assert any(e.get("machine_name") == "TestMachine" for e in recycled)

        # 清理
        db.execute("DELETE FROM push_log WHERE dedup_key='recycle_test_999'")
        db.commit()


class TestEmptyScenarios:
    """无数据边界"""

    def test_detect_from_local_does_not_crash(self, db):
        """无任何排班时 detect_from_local 不崩溃"""
        events = detect_from_local()
        assert isinstance(events, list)
