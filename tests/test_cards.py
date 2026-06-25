# -*- coding: utf-8 -*-
"""测试卡片构建：验证发给飞书的卡片 JSON 字段完整"""
import json
from feishu.events.cards import (
    build_reminder_card,
    build_announcement_card,
    build_changes_card,
    build_exception_card,
    build_report_card,
    build_recycled_card,
    build_merged_reminder_card,
)


def _event(**overrides):
    """构造测试事件 dict"""
    e = {
        "event_type": "task_impending_start",
        "machine_name": "BR1-01",
        "machine_id": 1,
        "task_name": "常规采集任务",
        "date": "2026-06-04",
        "start_min": 540,
        "end_min": 600,
        "actual_start_min": None,
        "actual_end_min": None,
        "group_name": "A组",
        "package_name": "常规任务包",
        "duration_minutes": 60,
        "priority": "高",
        "machine_type": "BR",
    }
    e.update(overrides)
    return e


class TestReminderCard:
    def test_has_core_fields(self):
        card_json = build_reminder_card(_event(minutes_remaining=10))
        card = json.loads(card_json)
        # 验证卡片结构
        assert "header" in card
        assert "elements" in card
        assert card["header"]["title"]["content"] == "⏰ 任务提醒"

        # 把 elements 中的文本拼成一行，验证机器名和任务名都在
        all_text = json.dumps(card["elements"], ensure_ascii=False)
        assert "BR1-01" in all_text
        assert "常规采集任务" in all_text

    def test_status_label(self):
        """不同事件类型 → 状态文案不同"""
        card = json.loads(build_reminder_card(_event(
            event_type="task_impending_start", minutes_remaining=5)))
        all_text = json.dumps(card["elements"], ensure_ascii=False)
        assert "即将开始" in all_text
        assert "5分钟" in all_text

    def test_start_early_label(self):
        card = json.loads(build_reminder_card(_event(
            event_type="task_start")))
        all_text = json.dumps(card["elements"], ensure_ascii=False)
        assert "已开始" in all_text

    def test_bottom_info_priority(self):
        card = json.loads(build_reminder_card(_event()))
        all_text = json.dumps(card["elements"], ensure_ascii=False)
        assert "高" in all_text
        assert "A组" in all_text
        assert "常规任务包" in all_text

    def test_non_today_date_prefix(self):
        """非今天排班 → 任务名加日期前缀"""
        card = json.loads(build_reminder_card(_event(date="2026-06-03")))
        all_text = json.dumps(card["elements"], ensure_ascii=False)
        assert "06-03" in all_text


class TestAnnouncementCard:
    def test_single_confirm_start(self):
        card_json = build_announcement_card([_event(
            event_type="task_confirm_start")])
        card = json.loads(card_json)
        assert card["header"]["title"]["content"] == "✅ 任务动态"
        all_text = json.dumps(card["elements"], ensure_ascii=False)
        assert "BR1-01" in all_text
        assert "常规采集任务" in all_text
        assert "已确定开始" in all_text

    def test_package_complete(self):
        card_json = build_announcement_card([_event(
            event_type="package_complete", schedule_id=None)])
        card = json.loads(card_json)
        all_text = json.dumps(card["elements"], ensure_ascii=False)
        assert "全部任务已完成" in all_text

    def test_truncation_over_10(self):
        """超过 10 条 → 截断提示"""
        events = [_event(event_type="task_confirm_start",
                         task_name=f"任务{i}") for i in range(15)]
        card_json = build_announcement_card(events)
        card = json.loads(card_json)
        assert len(card["elements"]) == 11  # 10 条 + 1 note
        all_text = json.dumps(card["elements"], ensure_ascii=False)
        assert "共 15 条" in all_text


class TestChangesCard:
    def test_has_old_and_new_values(self):
        events = [_event(
            event_type="schedule_changes",
            start_min=550,
            end_min=620,
            old_start_min=540,
            old_end_min=600,
        )]
        card_json = build_changes_card(events)
        assert card_json is not None
        card = json.loads(card_json)
        all_text = json.dumps(card["elements"], ensure_ascii=False)
        assert "BR1-01" in all_text
        assert "排班变动汇总" in card["header"]["title"]["content"]

    def test_leader_color_reversed(self):
        """for_leader=True → 延后标签正确（颜色在 font 标签中）"""
        events = [_event(
            event_type="schedule_changes",
            start_min=550, old_start_min=540,
        )]
        card_json = build_changes_card(events, for_leader=True)
        card = json.loads(card_json)
        all_text = json.dumps(card["elements"], ensure_ascii=False)
        assert "延后" in all_text


class TestExceptionCard:
    def test_exception_start(self):
        ev = _event(event_type="exception_start")
        ev["exception_reason"] = "机器故障"
        ev["exception_note"] = "缺少零件"
        ev["start_time"] = "09:00"
        card_json = build_exception_card(ev, is_end=False)
        card = json.loads(card_json)
        all_text = json.dumps(card["elements"], ensure_ascii=False)
        assert "机器故障" in all_text
        assert "缺少零件" in all_text

    def test_exception_end(self):
        ev = _event(event_type="exception_end")
        ev["exception_reason"] = "机器故障"
        ev["start_time"] = "09:00"
        ev["end_time"] = "19:00"
        ev["duration"] = "10h"
        card_json = build_exception_card(ev, is_end=True)
        card = json.loads(card_json)
        # "异常恢复" 在 header.title 中
        assert "异常恢复" in card["header"]["title"]["content"]
        all_text = json.dumps(card["elements"], ensure_ascii=False)
        assert "10h" in all_text


class TestRecycledCard:
    def test_has_recycle_fields(self):
        ev = _event(event_type="task_recycled")
        ev["recycle_reason"] = "无法执行"
        ev["recycle_time"] = "2026-06-04 14:30"
        ev["exception_note"] = "乙方不配合"
        card_json = build_recycled_card(ev)
        card = json.loads(card_json)
        all_text = json.dumps(card["elements"], ensure_ascii=False)
        assert "无法执行" in all_text
        assert "乙方不配合" in all_text
        assert "任务已被回收" in card["header"]["title"]["content"]


class TestMergedReminderCard:
    def test_single_event_delegates(self):
        """单条 → 走 build_reminder_card"""
        card_json = build_merged_reminder_card(
            [_event(minutes_remaining=3)], 1
        )
        card = json.loads(card_json)
        assert "任务提醒" in card["header"]["title"]["content"]

    def test_multiple_events_merged(self):
        """多条 → 合并为一张卡片"""
        events = [
            _event(machine_name="BR1-01", task_name="任务A"),
            _event(machine_name="BR1-02", task_name="任务B"),
        ]
        card_json = build_merged_reminder_card(events, 2)
        card = json.loads(card_json)
        assert "2项" in card["header"]["title"]["content"]
        all_text = json.dumps(card["elements"], ensure_ascii=False)
        assert "BR1-01" in all_text
        assert "BR1-02" in all_text
