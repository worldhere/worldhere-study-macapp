# -*- coding: utf-8 -*-
"""测试派发引擎：开关/去重/合并"""
import json
import datetime
from feishu.events.dispatch import (
    DEFAULT_TOGGLES, _load_toggles, _should_send,
)


class TestToggles:
    """开关配置"""

    def test_default_toggles_have_all_events(self, db):
        """所有 14 种事件类型都有默认开关"""
        expected = {
            "task_impending_start", "task_start", "task_confirm_start",
            "schedule_changes", "exception_start", "exception_end",
            "exception_update", "task_recycled",
            "task_impending_end", "task_end", "task_confirm_end",
            "package_complete", "shift_report", "shift_table_screenshot",
        }
        assert set(DEFAULT_TOGGLES.keys()) == expected

    def test_load_toggles_returns_dict(self, db):
        """_load_toggles 返回完整 dict"""
        toggles = _load_toggles()
        assert isinstance(toggles, dict)
        assert "task_impending_start" in toggles

    def test_load_toggles_handles_missing_config(self, db):
        """config 表中无 event_toggles → 用默认值"""
        db.execute("DELETE FROM config WHERE category='feishu_push' AND key='event_toggles'")
        db.commit()
        toggles = _load_toggles()
        assert toggles == DEFAULT_TOGGLES

    def test_load_toggles_handles_invalid_json(self, db):
        """config 中为非法 JSON → 用默认值不崩溃"""
        # 直接插入/替换非法值（config 表主键是 category+key）
        db.execute(
            "INSERT OR REPLACE INTO config (category, key, value) VALUES ('feishu_push', 'event_toggles', 'not valid json {{{')"
        )
        db.commit()
        toggles = _load_toggles()
        assert toggles == DEFAULT_TOGGLES
        # 恢复：删除这条非法记录
        db.execute(
            "DELETE FROM config WHERE category='feishu_push' AND key='event_toggles'"
        )
        db.commit()


class TestDedup:
    """去重逻辑"""

    def test_should_send_first_time(self, db):
        """从未发过 → True"""
        db.execute("DELETE FROM push_log WHERE dedup_key='test_dedup_1'")
        db.commit()
        assert _should_send(db, "test_dedup_1", "target1") is True

    def test_should_send_same_value(self, db):
        """相同 dedup_key + 相同 notify_value → False"""
        db.execute("DELETE FROM push_log WHERE dedup_key='test_dedup_2'")
        db.commit()
        now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        db.execute(
            "INSERT INTO push_log (dedup_key, event_type, target_type, target_id, notify_value, sent_at, success)"
            " VALUES ('test_dedup_2', 'test', 'group', 'target1', ?, ?, 1)",
            (json.dumps(500, ensure_ascii=False), now)
        )
        db.commit()
        assert _should_send(db, "test_dedup_2", "target1", 500) is False

    def test_should_send_different_value(self, db):
        """相同 dedup_key + 不同 notify_value → True"""
        db.execute("DELETE FROM push_log WHERE dedup_key='test_dedup_3'")
        db.commit()
        now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        db.execute(
            "INSERT INTO push_log (dedup_key, event_type, target_type, target_id, notify_value, sent_at, success)"
            " VALUES ('test_dedup_3', 'test', 'group', 'target1', ?, ?, 1)",
            (json.dumps(500, ensure_ascii=False), now)
        )
        db.commit()
        assert _should_send(db, "test_dedup_3", "target1", 600) is True

    def test_should_send_none_value(self, db):
        """current_value=None → 只检查是否发过"""
        db.execute("DELETE FROM push_log WHERE dedup_key='test_dedup_4'")
        db.commit()
        now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        db.execute(
            "INSERT INTO push_log (dedup_key, event_type, target_type, target_id, notify_value, sent_at, success)"
            " VALUES ('test_dedup_4', 'test', 'group', 'target1', NULL, ?, 1)",
            (now,)
        )
        db.commit()
        # 已发过，current_value=None → 即使旧值是 None 也跳过
        assert _should_send(db, "test_dedup_4", "target1") is False


class TestDispatchEmpty:
    """空事件列表 → 不崩溃"""

    def test_dispatch_empty_events(self, db):
        """空列表不崩溃"""
        from feishu.events.dispatch import dispatch_events
        dispatch_events([])  # 不应抛出异常


class TestDispatchMockCalls:
    """验证派发通过 mock 能正常完成流程（不崩溃）"""

    def test_dispatch_does_not_crash_with_events(self, db, mock_feishu):
        """有事件时 dispatch 不崩溃，mock 拦截了 IM 调用"""
        from feishu.events.dispatch import dispatch_events

        events = [
            {
                "event_type": "task_impending_start",
                "machine_name": "M1", "machine_id": 1, "task_name": "T1",
                "date": "2026-06-04", "start_min": 540, "end_min": 600,
                "actual_start_min": None, "actual_end_min": None,
                "group_name": "", "package_name": "",
                "duration_minutes": 60, "priority": "", "machine_type": "",
                "minutes_remaining": 10, "schedule_id": 99999,
            },
            {
                "event_type": "task_confirm_start",
                "machine_name": "M2", "machine_id": 2, "task_name": "T2",
                "date": "2026-06-04", "start_min": 540, "end_min": 600,
                "actual_start_min": 500, "actual_end_min": None,
                "group_name": "", "package_name": "",
                "duration_minutes": 60, "priority": "", "machine_type": "",
                "schedule_id": 99998,
            },
        ]
        dispatch_events(events)  # 不应抛出异常

    def test_dispatch_handles_all_event_types(self, db, mock_feishu):
        """12 种事件类型全部 dispatch 不崩溃"""
        from feishu.events.dispatch import dispatch_events

        events = []
        for etype in DEFAULT_TOGGLES:
            ev = {
                "event_type": etype,
                "machine_name": "M", "machine_id": 99, "task_name": "T",
                "date": "2026-06-04", "start_min": 540, "end_min": 600,
                "actual_start_min": None, "actual_end_min": None,
                "group_name": "", "package_name": "",
                "duration_minutes": 60, "priority": "", "machine_type": "",
                "schedule_id": 90000 + list(DEFAULT_TOGGLES.keys()).index(etype),
            }
            if etype == "exception_start":
                ev["exception_reason"] = "故障"
                ev["exception_note"] = ""
            elif etype == "exception_end":
                ev["exception_reason"] = "故障"
                ev["start_time"] = "09:00"
                ev["end_time"] = "10:00"
                ev["duration"] = "1h"
            elif etype == "exception_update":
                ev["exception_reason"] = "故障"
                ev["exception_note"] = "更新备注"
            elif etype == "task_recycled":
                ev["recycle_reason"] = "无法执行"
                ev["recycle_time"] = "14:00"
            elif etype == "shift_report":
                ev["shift"] = "白班"
                ev["display_date"] = "06/04"
            events.append(ev)
        dispatch_events(events)  # 不应抛出异常
