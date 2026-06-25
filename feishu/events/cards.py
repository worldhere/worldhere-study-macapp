# -*- coding: utf-8 -*-
"""卡片构建模块：6 种飞书卡片模板 + 合并逻辑"""
import json
import datetime
from db import get_db
from models.summary import shift_report_data
from feishu.events.shared import (
    CARD_COLORS,
    _minutes_to_readable, _format_duration, _get_machine_type_color, _parse_minutes,
)


def _format_task_label(event):
    """任务名，非今天的排班加日期前缀（如 '06-03 常规采集任务'）"""
    task_name = event.get("task_name", "")
    date_str = event.get("date", "")
    today_str = datetime.datetime.now().strftime("%Y-%m-%d")
    if date_str and date_str != today_str:
        short_date = date_str[-5:]  # "YYYY-MM-DD" -> "MM-DD"
        return f"{short_date} {task_name}"
    return task_name


# ========== 模板 1: 任务提醒 ==========

def build_reminder_card(event):
    """模板 1: 任务提醒卡片 — 给小组长"""
    status_label = {
        "task_impending_start": "即将开始（剩余{}分钟）".format(event.get("minutes_remaining", 0)),
        "task_start": "已开始（提前填写）",
        "task_impending_end": "即将结束（剩余{}分钟）".format(event.get("minutes_remaining", 0)),
        "task_end": "已结束（提前填写）",
    }.get(event["event_type"], "")

    start_str = _minutes_to_readable(event["date"], event["start_min"])
    end_str = _minutes_to_readable(event["date"], event["end_min"])
    duration_str = _format_duration(event.get("duration_minutes"))

    color = _get_machine_type_color(event.get("machine_id"))

    elements = [
        {"tag": "div", "fields": [
            {"is_short": True, "text": {"tag": "lark_md", "content": "**机器**\n{}".format(event["machine_name"])}},
            {"is_short": True, "text": {"tag": "lark_md", "content": "**任务**\n{}".format(_format_task_label(event))}},
        ]},
        {"tag": "div", "fields": [
            {"is_short": True, "text": {"tag": "lark_md", "content": "**时间**\n{} - {}".format(start_str, end_str)}},
            {"is_short": True, "text": {"tag": "lark_md", "content": "**状态**\n{}".format(status_label)}},
        ]},
        {"tag": "hr"},
    ]

    bottom_parts = []
    if duration_str:
        bottom_parts.append("⏱ {}".format(duration_str))
    if event.get("priority"):
        bottom_parts.append("⚡ {}".format(event["priority"]))
    if event.get("package_name"):
        bottom_parts.append("📦 {}".format(event["package_name"]))
    if event.get("group_name"):
        bottom_parts.append("🏷 {}".format(event["group_name"]))

    if bottom_parts:
        elements.append({
            "tag": "note",
            "elements": [{"tag": "plain_text", "content": "  ".join(bottom_parts)}]
        })

    card = {
        "header": {
            "title": {"tag": "plain_text", "content": "⏰ 任务提醒"},
            "template": color,
        },
        "elements": elements,
    }
    return json.dumps(card, ensure_ascii=False)


# ========== 模板 2: 任务公告 ==========

def build_announcement_card(events_list):
    """模板 2: 任务公告卡片 — 给群。自动分组聚合，四档展示：
    - total ≤ 10: 原样逐条平铺
    - 10 < total ≤ 50: 分组展开（组→机器→包→任务），某组 > 10 个则该组收拢
    - total > 50: 全局收拢（组→机器）"""
    from itertools import groupby

    COLOR_MAP = {
        "task_confirm_start": {"action": "已确定开始", "action_color": "#2196F3"},
        "task_confirm_end":   {"action": "已确定完成", "action_color": "#4CAF50"},
        "package_complete":   {"action": "📦 全部任务已完成", "action_color": "#FF9800"},
    }

    total = len(events_list)
    if total == 0:
        return None

    def _gn(e):
        return e.get("group_name") or "未分组"

    def _mn(e):
        return e.get("machine_name") or ""

    def _pn(e):
        return e.get("package_name") or ""

    def _sort_key(e):
        return (_gn(e), _mn(e), _pn(e), e.get("event_type", ""))

    sorted_events = sorted(events_list, key=_sort_key)
    elements = []
    group_count = 0

    if total <= 10:
        # ── 档位 1: 原样逐条 ──
        for e in events_list:
            cfg = COLOR_MAP.get(e["event_type"], COLOR_MAP["task_confirm_start"])
            if e["event_type"] == "package_complete":
                md = "{} <font color='{}'>{}</font>".format(
                    e.get("package_name", ""), cfg["action_color"], cfg["action"]
                )
            else:
                parts = []
                if e.get("group_name"):
                    parts.append(e["group_name"])
                parts.append("**{}**".format(e.get("machine_name", "")))
                if e.get("package_name"):
                    parts.append(e.get("package_name"))
                parts.append("**{}**".format(_format_task_label(e)))
                parts.append("<font color='{}'>{}</font>".format(cfg["action_color"], cfg["action"]))
                md = "  ".join(parts)
            elements.append({
                "tag": "div",
                "text": {"tag": "lark_md", "content": md}
            })

    elif total <= 50:
        # ── 档位 2/3: 分组展开，单组超 10 则收拢 ──
        for gn, gn_iter in groupby(sorted_events, key=_gn):
            gn_events = list(gn_iter)
            group_count += 1
            gn_total = len(gn_events)

            if gn_total > 10:
                # 档位 3: 该组收拢，只展示机器摘要
                elements.append({
                    "tag": "div",
                    "text": {"tag": "lark_md", "content": "▸ **{}** {} 个".format(gn, gn_total)}
                })
                # 按机器汇总
                gn_events.sort(key=_mn)
                for mn, mn_iter in groupby(gn_events, key=_mn):
                    mn_count = len(list(mn_iter))
                    elements.append({
                        "tag": "div",
                        "text": {"tag": "lark_md", "content": "  **{}** {} 个任务已完成".format(mn, mn_count)}
                    })
            else:
                # 档位 2: 全量展开 组→机器→包→任务
                elements.append({
                    "tag": "div",
                    "text": {"tag": "lark_md", "content": "▸ **{}**".format(gn)}
                })
                gn_events.sort(key=lambda e: (_mn(e), _pn(e), e.get("event_type", "")))
                for mn, mn_iter in groupby(gn_events, key=_mn):
                    mn_events = list(mn_iter)
                    for pn, pn_iter in groupby(mn_events, key=_pn):
                        pn_events = list(pn_iter)

                        if pn:
                            elements.append({
                                "tag": "div",
                                "text": {"tag": "lark_md", "content": "  **{}** · {}".format(mn, pn)}
                            })
                        else:
                            elements.append({
                                "tag": "div",
                                "text": {"tag": "lark_md", "content": "  **{}**".format(mn)}
                            })

                        pn_events.sort(key=lambda e: e.get("event_type", ""))
                        for et, et_iter in groupby(pn_events, key=lambda e: e.get("event_type", "")):
                            et_events = list(et_iter)
                            n = len(et_events)
                            cfg = COLOR_MAP.get(et, COLOR_MAP["task_confirm_start"])

                            if et == "package_complete":
                                elements.append({
                                    "tag": "div",
                                    "text": {"tag": "lark_md",
                                             "content": "    <font color='{}'>{}</font>".format(
                                                 cfg["action_color"], cfg["action"])}
                                })
                            else:
                                first = et_events[0]
                                task_label = _format_task_label(first)
                                if n >= 2:
                                    line = "    {}等**{}**个任务<font color='{}'>{}</font>".format(
                                        task_label, n, cfg["action_color"], cfg["action"])
                                else:
                                    line = "    {}<font color='{}'>{}</font>".format(
                                        task_label, cfg["action_color"], cfg["action"])
                                elements.append({
                                    "tag": "div",
                                    "text": {"tag": "lark_md", "content": line}
                                })

    else:
        # ── 档位 4: 全局收拢 组→机器 ──
        for gn, gn_iter in groupby(sorted_events, key=_gn):
            gn_events = list(gn_iter)
            group_count += 1
            gn_total = len(gn_events)

            elements.append({
                "tag": "div",
                "text": {"tag": "lark_md", "content": "▸ **{}** {} 个".format(gn, gn_total)}
            })

            gn_events.sort(key=_mn)
            for mn, mn_iter in groupby(gn_events, key=_mn):
                mn_count = len(list(mn_iter))
                elements.append({
                    "tag": "div",
                    "text": {"tag": "lark_md", "content": "  **{}** {} 个任务已完成".format(mn, mn_count)}
                })

    # ── 脚注 ──
    if group_count > 1:
        footer_text = "📊 共 {} 组 {} 个".format(group_count, total)
    else:
        footer_text = "📊 共 {} 个".format(total)
    elements.append({
        "tag": "note",
        "elements": [{"tag": "plain_text", "content": footer_text}]
    })

    card = {
        "header": {
            "title": {"tag": "plain_text", "content": "✅ 任务动态"},
            "template": CARD_COLORS["announcement"],
        },
        "elements": elements,
    }
    return json.dumps(card, ensure_ascii=False)


# ========== 模板 3: 变动汇总 ==========

def build_changes_card(events_list, for_leader=False):
    """模板 3: 变动汇总卡片 — 给群/小组长。按上下文分组，展示双时间线。
    for_leader=True 时颜色反向（延后=绿, 提前=橙）"""

    def _time_change_line(old_min, new_min, label_prefix, date_str, is_leader):
        if old_min is None or new_min is None:
            return None
        diff = new_min - old_min
        if diff == 0:
            return None
        old_str = _minutes_to_readable(date_str, old_min)
        new_str = _minutes_to_readable(date_str, new_min)
        if diff > 0:
            direction_label = "⏰延后"
            direction_color = "#4CAF50" if is_leader else "#FF9800"
        else:
            direction_label = "⏫提前"
            direction_color = "#FF9800" if is_leader else "#4CAF50"
        sign = "+" if diff > 0 else ""
        return "{} {}→{} **({}{}m {})**".format(
            label_prefix, old_str, new_str, sign, diff, direction_label
        )

    groups = {}
    for e in events_list:
        key = (e.get("group_name", ""), e.get("machine_name", ""), e.get("package_name", ""))
        if key not in groups:
            groups[key] = []
        groups[key].append(e)

    elements = []
    for (group_name, machine_name, package_name), evs in groups.items():
        header_parts = []
        if group_name:
            header_parts.append(group_name)
        if machine_name:
            header_parts.append("**{}**".format(machine_name))
        if package_name:
            header_parts.append("<font color='#3b82f6'>{}</font>".format(package_name))
        if header_parts:
            elements.append({
                "tag": "div",
                "text": {"tag": "lark_md", "content": "  ".join(header_parts)}
            })

        for ev in evs:
            elements.append({
                "tag": "div",
                "text": {"tag": "lark_md", "content": "  **{}**".format(_format_task_label(ev))}
            })

            start_line = _time_change_line(
                ev.get("old_start_min"), ev.get("start_min"),
                "开始时间", ev["date"], for_leader
            )
            if start_line:
                elements.append({
                    "tag": "div",
                    "text": {"tag": "lark_md", "content": "    " + start_line}
                })
            else:
                elements.append({
                    "tag": "div",
                    "text": {"tag": "lark_md", "content": "    开始时间 —（未变化）"}
                })

            end_line = _time_change_line(
                ev.get("old_end_min"), ev.get("end_min"),
                "结束时间", ev["date"], for_leader
            )
            if end_line:
                elements.append({
                    "tag": "div",
                    "text": {"tag": "lark_md", "content": "    " + end_line}
                })
            else:
                elements.append({
                    "tag": "div",
                    "text": {"tag": "lark_md", "content": "    结束时间 —（未变化）"}
                })

            new_start = ev.get("start_min")
            new_end = ev.get("end_min")
            if new_start is not None and new_end is not None:
                new_duration = _format_duration(new_end - new_start)
                elements.append({
                    "tag": "div",
                    "text": {"tag": "lark_md", "content": "    变化后排班时长 **{}**".format(new_duration)}
                })
            else:
                elements.append({
                    "tag": "div",
                    "text": {"tag": "lark_md", "content": "    变化后排班时长 —"}
                })

        elements.append({"tag": "hr"})

    if elements and elements[-1].get("tag") == "hr":
        elements.pop()

    if not elements:
        return None

    card = {
        "header": {
            "title": {"tag": "plain_text", "content": "📋 排班变动汇总"},
            "template": CARD_COLORS["changes"],
        },
        "elements": elements,
    }
    return json.dumps(card, ensure_ascii=False)


# ========== 模板 4: 异常通知 ==========

def build_exception_card(event, is_end=False, is_update=False):
    """模板 4: 异常通知卡片（红色）— 给群"""
    if is_end:
        header_title = "✅ 异常恢复"
        elements = [
            {"tag": "div", "fields": [
                {"is_short": True, "text": {"tag": "lark_md", "content": "**机器**\n{}".format(event["machine_name"])}},
                {"is_short": True, "text": {"tag": "lark_md", "content": "**原因**\n{}".format(event.get("exception_reason", ""))}},
            ]},
            {"tag": "div", "fields": [
                {"is_short": True, "text": {"tag": "lark_md", "content": "**开始**\n{}".format(event.get("start_time", ""))}},
                {"is_short": True, "text": {"tag": "lark_md", "content": "**结束**\n{}".format(event.get("end_time", ""))}},
            ]},
            {
                "tag": "div",
                "text": {"tag": "lark_md", "content": "**异常总耗时：{}**".format(event.get("duration", ""))}
            },
        ]
    elif is_update:
        header_title = "📝 异常状态更新"
        elements = []
        if event.get("exception_note"):
            elements.append({
                "tag": "div",
                "text": {"tag": "lark_md", "content": "**备注：{}**".format(event["exception_note"])}
            })
        elements.extend([
            {"tag": "div", "fields": [
                {"is_short": True, "text": {"tag": "lark_md", "content": "**机器**\n{}".format(event["machine_name"])}},
                {"is_short": True, "text": {"tag": "lark_md", "content": "**原因**\n{}".format(event.get("exception_reason", ""))}},
            ]},
        ])
    else:
        header_title = "⚠️ 异常开始"
        elements = []
        if event.get("exception_note"):
            elements.append({
                "tag": "div",
                "text": {"tag": "lark_md", "content": "**备注：{}**".format(event["exception_note"])}
            })
        elements.extend([
            {"tag": "div", "fields": [
                {"is_short": True, "text": {"tag": "lark_md", "content": "**机器**\n{}".format(event["machine_name"])}},
                {"is_short": True, "text": {"tag": "lark_md", "content": "**原因**\n{}".format(event.get("exception_reason", ""))}},
            ]},
            {"tag": "div", "fields": [
                {"is_short": True, "text": {"tag": "lark_md", "content": "**开始**\n{}".format(event.get("start_time", ""))}},
            ]},
        ])

    card = {
        "header": {
            "title": {"tag": "plain_text", "content": header_title},
            "template": CARD_COLORS["exception"],
        },
        "elements": elements,
    }
    return json.dumps(card, ensure_ascii=False)


# ========== 模板 5: 班次报告 ==========

def build_report_card(event):
    """模板 5: 班次报告卡片（紫色）— 给群。三段结构：包进度 → 汇总 → 未完成。
    数据查询已迁至 models.summary.shift_report_data()，此处仅拼装 Feishu JSON。"""
    conn = get_db()
    date_str = event["date"]
    display_date = event.get("display_date", date_str)
    shift = event["shift"]

    data = shift_report_data(conn, date_str, shift)
    conn.close()

    elements = [
        {"tag": "div", "text": {"tag": "lark_md", "content": "**{}  {}**".format(display_date, shift)}},
        {"tag": "hr"},
    ]

    # 第一段：📦 任务包进度
    elements.append({"tag": "div", "text": {"tag": "lark_md", "content": "**📦 任务包进度**"}})
    if data["packages"]:
        # 对齐：取最宽包名，统一补齐 → 完成(NNN/NNN) → 进度条(10) → 百分比 → 剩余
        max_dw = max((sum(2 if ord(c) > 127 else 1 for c in p["name"]) for p in data["packages"]), default=20)
        for pkg in data["packages"]:
            bar_len = 10
            filled = round(pkg["pct"] / 100 * bar_len) if pkg["total"] > 0 else 0
            bar = "█" * filled + "░" * (bar_len - filled)
            done_mark = " ✅" if pkg["completed"] >= pkg["total"] else ""
            remaining = pkg["total"] - pkg["completed"]
            remaining_text = "  ⚠ 剩余 {} 个".format(remaining) if pkg["completed"] < pkg["total"] else ""

            # 包名补齐到最大显示宽度
            display_w = sum(2 if ord(c) > 127 else 1 for c in pkg["name"])
            pad = max(0, max_dw - display_w + 2)  # +2 给一点间距
            padded_name = pkg["name"] + " " * pad

            # 完成数右对齐到 7 个半角宽（NNN/NNN）
            comp_str = "{}/{}".format(pkg["completed"], pkg["total"]).rjust(7)

            # 百分比右对齐到 4 个半角宽
            pct_str = "{}%".format(pkg["pct"]).rjust(4)

            elements.append({
                "tag": "div",
                "text": {"tag": "lark_md", "content": "{}  完成 {}  {}  **{}**{}{}".format(
                    padded_name, comp_str, bar, pct_str, done_mark, remaining_text
                )}
            })
    elif data["total_schedules"] > 0:
        elements.append({
            "tag": "div",
            "text": {"tag": "lark_md", "content": "本班次无任务包排班"}
        })

    elements.append({"tag": "hr"})

    # 第二段：📊 汇总
    elements.append({"tag": "div", "text": {"tag": "lark_md", "content": "**📊 汇总**"}})
    elements.append({"tag": "div", "fields": [
        {"is_short": True, "text": {"tag": "lark_md", "content": "任务包\n已完成 **{}** 条".format(data["pkg_sch_completed"])}},
        {"is_short": True, "text": {"tag": "lark_md", "content": "独立任务\n已完成 **{}** 条".format(data["completed_standalone"])}},
    ]})
    elements.append({"tag": "div", "fields": [
        {"is_short": True, "text": {"tag": "lark_md", "content": "排班\n**{}** 条".format(data["total_schedules"])}},
        {"is_short": True, "text": {"tag": "lark_md", "content": "完成率\n**{}%**".format(data["completion_pct"])}},
    ]})
    elements.append({
        "tag": "div",
        "text": {"tag": "lark_md", "content": "采集总数 **{:,}** 条".format(data["collect_total"])}
    })

    elements.append({"tag": "hr"})

    # 第三段：⚠️ 待处理
    elements.append({"tag": "div", "text": {"tag": "lark_md", "content": "**⚠️ 待处理**"}})
    if data["total_schedules"] == 0:
        elements.append({
            "tag": "div",
            "text": {"tag": "lark_md", "content": "本班次无排班"}
        })
    elif data["pending_count"] > 0:
        elements.append({
            "tag": "div",
            "text": {"tag": "lark_md", "content": "待完成排班 **{}** 个（共 {} 个，已完成 {} 个）".format(data["pending_count"], data["total_schedules"], data["total_schedules"] - data["pending_count"])}
        })
    else:
        elements.append({
            "tag": "div",
            "text": {"tag": "lark_md", "content": "全部完成 ✅"}
        })

    card = {
        "header": {
            "title": {"tag": "plain_text", "content": "📊 {}总结报告".format(shift)},
            "template": CARD_COLORS["report"],
        },
        "elements": elements,
    }
    return json.dumps(card, ensure_ascii=False)


# ========== 模板 6: 任务回收 ==========

def build_recycled_card(event):
    """模板 6: 任务回收卡片（黄色）— 给群和小组长。通知任务已被回收待分配。"""
    elements = [
        {"tag": "div", "fields": [
            {"is_short": True, "text": {"tag": "lark_md", "content": "**机器**\n{}".format(event.get("machine_name", ""))}},
            {"is_short": True, "text": {"tag": "lark_md", "content": "**任务**\n{}".format(_format_task_label(event))}},
        ]},
        {"tag": "div", "fields": [
            {"is_short": True, "text": {"tag": "lark_md", "content": "**回收原因**\n{}".format(event.get("recycle_reason", ""))}},
            {"is_short": True, "text": {"tag": "lark_md", "content": "**回收时间**\n{}".format(event.get("recycle_time", ""))}},
        ]},
    ]
    if event.get("exception_note"):
        elements.append({
            "tag": "div",
            "text": {"tag": "lark_md", "content": "**备注：{}**".format(event["exception_note"])}
        })
    if event.get("group_name"):
        elements.append({
            "tag": "note",
            "elements": [{"tag": "plain_text", "content": "🏷 {}".format(event["group_name"])}]
        })

    card = {
        "header": {
            "title": {"tag": "plain_text", "content": "📋 任务已被回收"},
            "template": "orange",
        },
        "elements": elements,
    }
    return json.dumps(card, ensure_ascii=False)


# ========== 提醒合并 ==========

def build_merged_reminder_card(events_list, merged_count):
    """将多条提醒事件合并为一张卡片。events_list 中每条格式相同，依次排列。"""
    if not events_list:
        return None
    if len(events_list) == 1:
        return build_reminder_card(events_list[0])

    color = _get_machine_type_color(events_list[0].get("machine_id"))

    elements = []
    for i, ev in enumerate(events_list):
        status_label = {
            "task_impending_start": "即将开始（剩余{}分钟）".format(ev.get("minutes_remaining", 0)),
            "task_start": "已开始（提前填写）",
            "task_impending_end": "即将结束（剩余{}分钟）".format(ev.get("minutes_remaining", 0)),
            "task_end": "已结束（提前填写）",
        }.get(ev["event_type"], "")

        start_str = _minutes_to_readable(ev["date"], ev["start_min"])
        end_str = _minutes_to_readable(ev["date"], ev["end_min"])
        duration_str = _format_duration(ev.get("duration_minutes"))

        elements.append({
            "tag": "div", "fields": [
                {"is_short": True, "text": {"tag": "lark_md", "content": "**机器**\n{}".format(ev["machine_name"])}},
                {"is_short": True, "text": {"tag": "lark_md", "content": "**任务**\n{}".format(_format_task_label(ev))}},
            ]
        })
        elements.append({
            "tag": "div", "fields": [
                {"is_short": True, "text": {"tag": "lark_md", "content": "**时间**\n{} - {}".format(start_str, end_str)}},
                {"is_short": True, "text": {"tag": "lark_md", "content": "**状态**\n{}".format(status_label)}},
            ]
        })

        bottom_parts = []
        if duration_str:
            bottom_parts.append("⏱ {}".format(duration_str))
        if ev.get("priority"):
            bottom_parts.append("⚡ {}".format(ev["priority"]))
        if ev.get("package_name"):
            bottom_parts.append("📦 {}".format(ev["package_name"]))
        if ev.get("group_name"):
            bottom_parts.append("🏷 {}".format(ev["group_name"]))

        if bottom_parts:
            elements.append({
                "tag": "note",
                "elements": [{"tag": "plain_text", "content": "  ".join(bottom_parts)}]
            })

        if i < len(events_list) - 1:
            elements.append({"tag": "hr"})

    card = {
        "header": {
            "title": {"tag": "plain_text", "content": "⏰ 任务提醒（{}项）".format(merged_count)},
            "template": color,
        },
        "elements": elements,
    }
    return json.dumps(card, ensure_ascii=False)
