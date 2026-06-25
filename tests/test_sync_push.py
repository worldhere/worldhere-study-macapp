# -*- coding: utf-8 -*-
"""测试 Push 同步：字段 diff、映射管理、快照"""
import datetime
from feishu.schedule_sync import _fields_differ, _date_min_to_timestamps


class TestFieldsDiffer:
    """字段 diff 计算"""

    def test_none_vs_none(self):
        assert _fields_differ(None, None) is False

    def test_none_vs_empty_string(self):
        assert _fields_differ(None, "") is False

    def test_empty_string_vs_none(self):
        assert _fields_differ("", None) is False

    def test_none_vs_zero(self):
        assert _fields_differ(None, 0) is False

    def test_zero_vs_none(self):
        assert _fields_differ(0, None) is False

    def test_empty_string_vs_zero(self):
        assert _fields_differ("", 0) is False

    def test_same_value(self):
        assert _fields_differ("abc", "abc") is False

    def test_different_value(self):
        assert _fields_differ("abc", "xyz") is True

    def test_none_vs_value(self):
        assert _fields_differ(None, "hello") is True

    def test_same_int_value(self):
        assert _fields_differ(1234567890000, 1234567890000) is False

    def test_different_int_value(self):
        assert _fields_differ(1234567890000, 1234567899999) is True


class TestDateMinToTimestamps:
    """date + 分钟数 → 毫秒时间戳"""

    def test_valid_conversion(self):
        start_ts, end_ts = _date_min_to_timestamps("2026-06-04", 540, 600)
        assert start_ts is not None
        assert end_ts is not None
        assert isinstance(start_ts, int)
        assert isinstance(end_ts, int)
        assert end_ts > start_ts

    def test_invalid_date(self):
        start_ts, end_ts = _date_min_to_timestamps("invalid", 540, 600)
        assert start_ts is None
        assert end_ts is None


class TestPushMachineSchedules:
    """push_machine_schedules 集成"""

    def test_push_with_no_mapping(self, app, db):
        """无映射的机器 push 返回 error"""
        from feishu.schedule_sync import push_machine_schedules
        result = push_machine_schedules(99999)
        assert "error" in result

    def test_push_with_valid_mapping(self, app, db):
        """有映射的机器 push 不崩溃"""
        mapping = db.execute(
            "SELECT machine_id FROM feishu_sync_mapping LIMIT 1"
        ).fetchone()
        if mapping is None:
            return  # 无映射可测试
        from feishu.schedule_sync import push_machine_schedules
        result = push_machine_schedules(mapping["machine_id"])
        # 应该返回结果（可能成功或失败，但不应抛异常）
        assert isinstance(result, dict)
