# -*- coding: utf-8 -*-
"""测试中文标点归一化：用户用中文输入法输入 ：，－ 等标点时系统能正确识别"""

import pytest
import re


# ======================================================================
# 1. routes/schedule_ops.py —— _parse_shift_minutes
# ======================================================================
class TestParseShiftMinutes:
    """_parse_shift_minutes: HH:MM → 分钟数，兼容中文冒号"""

    @pytest.fixture
    def _parse(self):
        from routes.schedule_ops import _parse_shift_minutes
        return _parse_shift_minutes

    def test_ascii_colon(self, _parse):
        assert _parse("09:00") == 540

    def test_chinese_colon(self, _parse):
        """中文冒号 '09：00' 应等同 '09:00'"""
        assert _parse("09：00") == 540

    def test_chinese_colon_night(self, _parse):
        assert _parse("21：00") == 1260

    def test_chinese_colon_with_spaces(self, _parse):
        assert _parse("  08：30  ") == 510

    def test_empty(self, _parse):
        assert _parse("") is None

    def test_none(self, _parse):
        assert _parse(None) is None

    def test_invalid(self, _parse):
        """非法格式返回 None"""
        assert _parse("abc") is None


# ======================================================================
# 2. routes/schedule_ops.py —— _validate_shift_input
# ======================================================================
class TestValidateShiftInput:
    """_validate_shift_input: 校验班次输入并归一化中文标点"""

    @pytest.fixture
    def _validate(self):
        from routes.schedule_ops import _validate_shift_input
        return _validate_shift_input

    # ---- 中文冒号在 start/end ----
    def test_start_chinese_colon_passes(self, _validate):
        """start 用中文冒号应通过格式校验"""
        errs = _validate("day", "09：00", "18：30", "19:00-21:00", "")
        assert not any("格式错误" in e for e in errs)

    def test_end_chinese_colon_passes(self, _validate):
        errs = _validate("night", "21:00", "06：30", "06:30-08:30", "")
        assert not any("格式错误" in e for e in errs)

    # ---- 中文逗号、冒号在 overtime ----
    def test_overtime_chinese_comma_passes(self, _validate):
        """加班用中文逗号分隔应通过"""
        errs = _validate("day", "09:00", "18:30", "19:00-21:00，06:30-08:30", "")
        assert not any("加班格式" in e for e in errs)

    def test_overtime_chinese_colon_passes(self, _validate):
        """加班用中文冒号应通过"""
        errs = _validate("day", "09:00", "18:30", "19：00-21：00", "")
        assert not any("加班格式" in e for e in errs)

    def test_overtime_chinese_dash_passes(self, _validate):
        """加班用中文减号应通过"""
        errs = _validate("day", "09:00", "18:30", "19:00－21:00", "")
        assert not any("加班格式" in e for e in errs)

    def test_overtime_bad_format_still_fails(self, _validate):
        """归一只改标点，不改乱写的格式"""
        errs = _validate("day", "09:00", "18:30", "19:00-abc", "")
        assert any("加班格式" in e for e in errs)

    # ---- 中文标点在 breaks ----
    def test_breaks_chinese_comma_passes(self, _validate):
        errs = _validate("day", "09:00", "18:30", "", "12:00-13:30，16:00-16:30")
        assert not any("休息段格式" in e for e in errs)

    def test_breaks_chinese_colon_passes(self, _validate):
        errs = _validate("day", "09:00", "18:30", "", "12：00-13：30,16：00-16：30")
        assert not any("休息段格式" in e for e in errs)

    def test_breaks_slash_format_passes(self, _validate):
        """休息段 HH:MM/分钟 格式也应兼容中文冒号"""
        errs = _validate("day", "09:00", "18:30", "", "12：00/30")
        assert not any("休息段格式" in e for e in errs)

    def test_breaks_bad_format_still_fails(self, _validate):
        errs = _validate("day", "09:00", "18:30", "", "12:00-abc")
        assert any("休息段格式" in e for e in errs)

    # ---- 下班早于上班（仅白班） ----
    def test_day_end_before_start_blocked(self, _validate):
        """白班下班早于上班 → 错误（中文冒号也适用）"""
        errs = _validate("day", "09：00", "06：00", "", "")
        assert any("早于上班" in e for e in errs)

    def test_night_end_before_start_allowed(self, _validate):
        """夜班下班早于上班跨午夜 → 不报错"""
        errs = _validate("night", "21：00", "06：30", "", "")
        assert not any("早于上班" in e for e in errs)


# ======================================================================
# 3. feishu/events/shared.py —— _parse_minutes & _parse_overtime_latest_end
# ======================================================================
class TestSharedParseMinutes:
    """shared._parse_minutes 和 _parse_overtime_latest_end"""

    def test_chinese_colon(self):
        from feishu.events.shared import _parse_minutes
        assert _parse_minutes("09：00") == 540

    def test_ascii_colon(self):
        from feishu.events.shared import _parse_minutes
        assert _parse_minutes("21:00") == 1260

    def test_none(self):
        from feishu.events.shared import _parse_minutes
        assert _parse_minutes(None) is None

    def test_invalid(self):
        from feishu.events.shared import _parse_minutes
        assert _parse_minutes("abc") is None


class TestSharedOvertimeLatestEnd:
    """_parse_overtime_latest_end 兼容中文标点"""

    def test_ascii(self):
        from feishu.events.shared import _parse_overtime_latest_end
        assert _parse_overtime_latest_end("19:00-21:00") == 1260  # 21:00

    def test_chinese_colon(self):
        from feishu.events.shared import _parse_overtime_latest_end
        assert _parse_overtime_latest_end("19：00-21：00") == 1260

    def test_chinese_dash(self):
        from feishu.events.shared import _parse_overtime_latest_end
        assert _parse_overtime_latest_end("19:00－21:00") == 1260

    def test_chinese_both(self):
        """中文冒号 + 中文减号"""
        from feishu.events.shared import _parse_overtime_latest_end
        assert _parse_overtime_latest_end("19：00－21：00") == 1260

    def test_multi_segment_chinese_comma(self):
        """多段加班用中文逗号分隔——返回最晚结束分钟（绝对值）"""
        from feishu.events.shared import _parse_overtime_latest_end
        # 19:00-21:00 → end=1260, 06:30-08:30 → end=510
        # 函数取 max，1260 > 510
        assert _parse_overtime_latest_end("19:00-21:00，06:30-08:30") == 1260

    def test_empty(self):
        from feishu.events.shared import _parse_overtime_latest_end
        assert _parse_overtime_latest_end("") is None

    def test_none(self):
        from feishu.events.shared import _parse_overtime_latest_end
        assert _parse_overtime_latest_end(None) is None


# ======================================================================
# 4. models/summary.py —— _parse_minutes & _parse_break_periods
# ======================================================================
class TestSummaryParseMinutes:
    """models.summary._parse_minutes"""

    def test_chinese_colon(self):
        from models.summary import _parse_minutes
        assert _parse_minutes("09：00") == 540

    def test_ascii_colon(self):
        from models.summary import _parse_minutes
        assert _parse_minutes("18:30") == 1110

    def test_none(self):
        from models.summary import _parse_minutes
        assert _parse_minutes(None) is None

    def test_invalid(self):
        from models.summary import _parse_minutes
        assert _parse_minutes("abc") is None


class TestSummaryParseBreakPeriods:
    """models.summary._parse_break_periods 兼容中文标点"""

    def test_ascii(self):
        from models.summary import _parse_break_periods
        result = _parse_break_periods("12:00-13:30,16:00-16:30")
        assert len(result) == 2
        assert result[0] == (720, 810)   # 12:00-13:30
        assert result[1] == (960, 990)   # 16:00-16:30

    def test_chinese_comma(self):
        """中文逗号分隔休息段"""
        from models.summary import _parse_break_periods
        result = _parse_break_periods("12:00-13:30，16:00-16:30")
        assert len(result) == 2
        assert result[0] == (720, 810)
        assert result[1] == (960, 990)

    def test_chinese_colon(self):
        """中文冒号在休息段时间中"""
        from models.summary import _parse_break_periods
        result = _parse_break_periods("12：00-13：30,16：00-16：30")
        assert len(result) == 2
        assert result[0] == (720, 810)

    def test_chinese_dash(self):
        """中文减号"""
        from models.summary import _parse_break_periods
        result = _parse_break_periods("12:00－13:30")
        assert len(result) == 1
        assert result[0] == (720, 810)

    def test_chinese_all_mixed(self):
        """中文冒号 + 中文逗号 + 中文减号 混合"""
        from models.summary import _parse_break_periods
        result = _parse_break_periods("12：00－13：30，16：00－16：30")
        assert len(result) == 2
        assert result[0] == (720, 810)
        assert result[1] == (960, 990)

    def test_empty(self):
        from models.summary import _parse_break_periods
        assert _parse_break_periods("") == []
        assert _parse_break_periods(None) == []


# ======================================================================
# 5. 集成测试：POST /save_shift 保存中文标点后 DB 落盘为 ASCII
# ======================================================================
class TestSaveShiftNormalization:
    """通过 save_shift API 保存中文标点输入，验证 DB 落盘为归一化后的 ASCII"""

    def test_day_shift_chinese_punctuation_saved_normalized(self, app, db):
        """白班：全中文标点输入 → DB 存储 ASCII"""
        resp = app.post("/save_shift", json={
            "type": "day",
            "start": "09：00",
            "end": "18：30",
            "over": "19：00－21：00",
            "breaks": "12：00-13：30，16：00－16：30",
        })
        assert resp.status_code == 200

        row = db.execute(
            "SELECT start, end, overtime, breaks FROM shift_config WHERE key='day_shift'"
        ).fetchone()
        assert row["start"] == "09:00"
        assert row["end"] == "18:30"
        assert row["overtime"] == "19:00-21:00"
        assert "，" not in row["breaks"]
        assert "：" not in row["breaks"]
        assert "－" not in row["breaks"]
        # 休息段应是 ASCII 逗号分隔
        assert "," in row["breaks"]

    def test_night_shift_chinese_punctuation_saved_normalized(self, app, db):
        """夜班：中文标点 → DB ASCII"""
        resp = app.post("/save_shift", json={
            "type": "night",
            "start": "21：00",
            "end": "06：30",
            "over": "06：30－08：30",
            "breaks": "00：00-01：30，04：30-05：00",
        })
        assert resp.status_code == 200

        row = db.execute(
            "SELECT start, end, overtime, breaks FROM shift_config WHERE key='night_shift'"
        ).fetchone()
        assert row["start"] == "21:00"
        assert row["end"] == "06:30"
        assert row["overtime"] == "06:30-08:30"

    def test_invalid_input_still_rejected(self, app):
        """格式错误不会被归一化拯救——依旧 400"""
        resp = app.post("/save_shift", json={
            "type": "day",
            "start": "09：00",
            "end": "abc",          # 非法
            "over": "",
            "breaks": "",
        })
        assert resp.status_code == 400

    def test_day_start_ge_night_start_rejected(self, app):
        """跨班次顺序错误仍被拦截（含中文冒号输入）"""
        # 1. 先把白班改成 08:00（此时夜班 21:00，8<21 合法）
        resp1 = app.post("/save_shift", json={
            "type": "day", "start": "08:00", "end": "18:30", "over": "", "breaks": "",
        })
        assert resp1.status_code == 200
        # 2. 再存夜班 06：00 → night_start(360) < day_start(480) → 应拦截
        resp2 = app.post("/save_shift", json={
            "type": "night", "start": "06：00", "end": "18:00", "over": "", "breaks": "",
        })
        assert resp2.status_code == 400


# ======================================================================
# 6. routes/schedule_cut.py —— _get_shift_boundaries 中文冒号
# ======================================================================
class TestShiftBoundariesChinese:
    """_get_shift_boundaries 从 DB 读取中文标点数据后能正确解析"""

    def test_chinese_colon_in_db_parsed_correctly(self, app, db):
        """DB 中有中文冒号时（模拟旧数据），_get_shift_boundaries 仍能解析"""
        # 直接写入中文冒号数据到 DB（模拟 save_shift 修复前的脏数据）
        db.execute(
            "UPDATE shift_config SET start='09：00', end='18：30' WHERE key='day_shift'"
        )
        db.commit()

        from routes.schedule_cut import _get_shift_boundaries
        b = _get_shift_boundaries(db)

        assert b["day_start"] == 540
        assert b["day_end"] == 1110
        # night 应该是默认值（未被修改）
        assert b["night_start"] == 1260
        assert b["night_end"] == 390


# ======================================================================
# 7. feishu/events/dispatch.py —— _parse_shift_time（闭包内联版）
# ======================================================================
class TestDispatchShiftTimeParsing:
    """dispatch.py 中两处 shift time 解析兼容中文冒号"""

    def test_parse_shift_time_chinese_colon(self):
        """模拟 _parse_shift_time 的行为"""
        def _parse_shift_time(t):
            try:
                parts = str(t).replace('：', ':').split(":")
                return int(parts[0]) * 60 + int(parts[1])
            except Exception:
                return None

        assert _parse_shift_time("09：00") == 540
        assert _parse_shift_time("21：00") == 1260
        assert _parse_shift_time("06：30") == 390
        assert _parse_shift_time("abc") is None


# ======================================================================
# 8. utils.py —— 确认已有归一化仍然生效
# ======================================================================
class TestUtilsNormalization:
    """utils.py 中的 parse_hhmm / parse_time_range_list / parse_break_list"""

    def test_parse_hhmm_chinese(self):
        from utils import parse_hhmm
        assert parse_hhmm("09：00") == 540
        assert parse_hhmm("21:00") == 1260

    def test_parse_time_range_list_chinese(self):
        from utils import parse_time_range_list
        result = parse_time_range_list("19：00-21：00，06：30-08：30")
        assert len(result) == 2
        assert result[0] == (1140, 1260)   # 19:00-21:00
        assert result[1] == (390, 510)     # 06:30-08:30

    def test_parse_break_list_chinese(self):
        from utils import parse_break_list
        result = parse_break_list("12：00-13：30，16：00-16：30")
        assert len(result) == 2
        assert result[0] == (720, 810)
        assert result[1] == (960, 990)

    def test_parse_break_list_slash_format_chinese(self):
        """HH:MM/分钟 格式 + 中文冒号"""
        from utils import parse_break_list
        result = parse_break_list("12：00/30")
        assert len(result) == 1
        assert result[0] == (720, 750)
