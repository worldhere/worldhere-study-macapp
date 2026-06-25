# -*- coding: utf-8 -*-
"""应用配置加载：班次配置、UI 配置等"""
from typing import Dict
from db import get_db, get_config
from utils import parse_time_range_list, parse_break_list


def load_app_config() -> Dict:
    """加载全部应用配置，返回 {category: [{key, value, sort_order}, ...]}。
    数据库异常时回退为空 dict，确保页面仍能加载。
    """
    try:
        return get_config()
    except Exception:
        return {}


def load_shift_config() -> Dict:
    """加载班次配置。数据库异常时回退到内置默认值。"""
    out = {}
    try:
        conn = get_db()
        rows = conn.execute("SELECT key,start,end,overtime,breaks FROM shift_config").fetchall()
        conn.close()
        out = {
            r["key"]: {"start": r["start"], "end": r["end"], "overtime": r["overtime"], "breaks": r["breaks"]}
            for r in rows
        }
    except Exception:
        pass

    day_cfg = out.get("day_shift", {"start": "09:00", "end": "18:30", "overtime": "19:00-21:00", "breaks": "12:00-13:30,16:00-16:30,18:30-19:00"})
    night_cfg = out.get("night_shift", {"start": "21:00", "end": "06:30", "overtime": "06:30-08:30", "breaks": "00:00-01:30,04:30-05:00"})
    return {
        "day_shift": {
            "start": day_cfg["start"],
            "end": day_cfg["end"],
            "overtime_raw": day_cfg["overtime"],
            "overtime": parse_time_range_list(day_cfg["overtime"]),
            "breaks_raw": day_cfg["breaks"] or "",
            "breaks": parse_break_list(day_cfg["breaks"]),
        },
        "night_shift": {
            "start": night_cfg["start"],
            "end": night_cfg["end"],
            "overtime_raw": night_cfg["overtime"],
            "overtime": parse_time_range_list(night_cfg["overtime"]),
            "breaks_raw": night_cfg["breaks"] or "",
            "breaks": parse_break_list(night_cfg["breaks"]),
        },
    }
