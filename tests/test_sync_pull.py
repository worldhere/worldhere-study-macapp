# -*- coding: utf-8 -*-
"""测试 Pull 同步：字段回写、状态联动、Last Write Wins"""
import datetime
from feishu.schedule_sync import (
    _parse_feishu_datetime_for_pull,
    _schedule_is_active,
    compute_task_statuses,
)


class TestParseFeishuDatetime:
    """飞书 DateTime → 绝对分钟"""

    def test_valid_timestamp(self):
        # 2026-06-04 09:00 UTC+8 = 1717462800000 ms
        # Relative to 2026-06-04 00:00: 9*60 = 540 minutes
        import datetime as dt
        base = dt.datetime(2026, 6, 4, 9, 0, 0)
        ts_ms = int(base.timestamp() * 1000)
        result = _parse_feishu_datetime_for_pull(ts_ms, "2026-06-04")
        assert result == 540

    def test_none_value(self):
        assert _parse_feishu_datetime_for_pull(None, "2026-06-04") is None

    def test_cross_day_timestamp(self):
        """跨天时间戳 → 正确计算相对 schedule.date 的分钟数"""
        # 2026-06-03 23:00 → relative to 2026-06-03 00:00 = 1380 min
        base = datetime.datetime(2026, 6, 3, 23, 0, 0)
        ts_ms = int(base.timestamp() * 1000)
        result = _parse_feishu_datetime_for_pull(ts_ms, "2026-06-03")
        assert result == 1380


class TestScheduleIsActive:
    """排班活跃性判断"""

    def test_active_schedule(self):
        now_min = datetime.datetime.now().hour * 60 + datetime.datetime.now().minute
        sch = {
            "status": "executing",
            "date": datetime.date.today().isoformat(),
            "start_min": now_min - 30,
            "end_min": now_min + 30,
        }
        assert _schedule_is_active(sch) is True

    def test_completed_schedule(self):
        now_min = datetime.datetime.now().hour * 60 + datetime.datetime.now().minute
        sch = {
            "status": "completed",
            "date": datetime.date.today().isoformat(),
            "start_min": now_min - 30,
            "end_min": now_min + 30,
        }
        assert _schedule_is_active(sch) is False

    def test_not_yet_started(self):
        now_min = datetime.datetime.now().hour * 60 + datetime.datetime.now().minute
        sch = {
            "status": "executing",
            "date": datetime.date.today().isoformat(),
            "start_min": now_min + 60,  # 1小时后才开始
            "end_min": now_min + 120,
        }
        assert _schedule_is_active(sch) is False

    def test_already_ended(self):
        now_min = datetime.datetime.now().hour * 60 + datetime.datetime.now().minute
        sch = {
            "status": "executing",
            "date": datetime.date.today().isoformat(),
            "start_min": now_min - 120,
            "end_min": now_min - 60,  # 1小时前已结束
        }
        assert _schedule_is_active(sch) is False

    def test_invalid_data(self):
        assert _schedule_is_active({}) is False
        assert _schedule_is_active(None) is False


class TestComputeTaskStatuses:
    """动态任务状态计算"""

    def test_compute_returns_dict(self, db):
        """返回 {task_id: status} 格式"""
        statuses = compute_task_statuses(db)
        assert isinstance(statuses, dict)
        for tid, status in statuses.items():
            assert isinstance(tid, int)
            assert isinstance(status, str)

    def test_completed_task_not_in_result(self, db):
        """已完成任务的 schedule 不在结果中"""
        statuses = compute_task_statuses(db)
        # 只返回有活跃排班的任务
        for tid, status in statuses.items():
            assert status != "已完成"


class TestPullAllMachines:
    """pull_all_machines 集成"""

    def test_pull_all_does_not_crash(self, app, db):
        """pull_all_machines 不崩溃"""
        from feishu.schedule_sync import pull_all_machines
        result = pull_all_machines()
        assert isinstance(result, dict)
        assert "machines_checked" in result
        assert "records_updated" in result
