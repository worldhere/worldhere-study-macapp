# -*- coding: utf-8 -*-
"""派发引擎：事件去重、开关过滤、卡片发送、push_log 写入"""
import json
import datetime
from db import get_db
from feishu.common import send_im_message, send_im_message_to_user, upload_image, send_image_message
from feishu.status import write_event
from feishu.events.cards import (
    build_reminder_card, build_announcement_card, build_changes_card,
    build_exception_card, build_report_card, build_recycled_card,
    build_merged_reminder_card,
)

DEFAULT_TOGGLES = {
    "task_impending_start":  {"leader": True,  "group": False},
    "task_start":            {"leader": True,  "group": False},
    "task_confirm_start":    {"leader": False, "group": True},
    "schedule_changes":      {"leader": False, "group": True},
    "exception_start":       {"leader": False, "group": True},
    "exception_end":         {"leader": False, "group": True},
    "exception_update":      {"leader": False, "group": True},
    "task_recycled":         {"leader": True,  "group": True},
    "task_impending_end":    {"leader": True,  "group": False},
    "task_end":              {"leader": True,  "group": False},
    "task_confirm_end":      {"leader": False, "group": True},
    "package_complete":      {"leader": False, "group": True},
    "shift_report":          {"leader": False, "group": True},
    "shift_table_screenshot": {"leader": False, "group": True},
}


def _load_toggles():
    """从 config 表读取事件开关矩阵，缺失的 key 用默认值回退"""
    conn = get_db()
    row = conn.execute(
        "SELECT value FROM config WHERE category='feishu_push' AND key='event_toggles'"
    ).fetchone()
    conn.close()
    result = dict(DEFAULT_TOGGLES)
    if row:
        try:
            saved = json.loads(row["value"])
            result.update(saved)
        except (json.JSONDecodeError, TypeError):
            pass
    return result


def _should_send(conn, dedup_key, target_id, current_value=None):
    """检查是否应该发送：未发过 或 notify_value 已变化"""
    row = conn.execute(
        "SELECT notify_value FROM push_log WHERE dedup_key=? AND target_id=? ORDER BY sent_at DESC LIMIT 1",
        (dedup_key, target_id)
    ).fetchone()
    if row is None:
        return True
    if current_value is not None:
        old_value = (row["notify_value"] or "").strip()
        new_value = json.dumps(current_value, ensure_ascii=False, sort_keys=True)
        if old_value != new_value:
            return True
    return False


def _record_push(conn, dedup_key, event_type, target_type, target_id, notify_value, success):
    conn.execute(
        """INSERT INTO push_log (dedup_key, event_type, target_type, target_id, notify_value, sent_at, success)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (dedup_key, event_type, target_type, target_id,
         json.dumps(notify_value, ensure_ascii=False, sort_keys=True) if notify_value is not None else None,
         datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"), 1 if success else 0),
    )
    conn.commit()


def _get_targets_for_event(event):
    """根据事件分组/采集员/机型路由通知目标。

    优先级：
    1. 有组且有 leader → 发给该组 leader
    2. 有组无 leader，有 collector → 发给 collector
    3. 有组无 leader 无 collector → 同机型匹配分组的 leader
    4. 无组有 collector → 发给 collector
    5. 无组无 collector，同机型匹配 → 发给匹配组 leader
    6. 无组无 collector 无匹配 → 发给所有组 leader（回退）
    """
    conn = get_db()
    targets = []

    group_name = event.get("group_name", "")
    collector_str = event.get("collector", "")
    machine_type = event.get("machine_type", "")

    # ── 班次解析 ──
    shift_rows = conn.execute(
        "SELECT key, start FROM shift_config WHERE key IN ('day_shift', 'night_shift')"
    ).fetchall()

    now_min = datetime.datetime.now().hour * 60 + datetime.datetime.now().minute

    def _parse_shift_time(t):
        try:
            parts = t.split(":")
            return int(parts[0]) * 60 + int(parts[1])
        except Exception:
            return None

    day_start = None
    night_start = None
    for r in shift_rows:
        t = _parse_shift_time(r["start"])
        if r["key"] == "day_shift":
            day_start = t
        elif r["key"] == "night_shift":
            night_start = t

    def _current_shift():
        if day_start is not None and night_start is not None:
            return "day" if day_start <= now_min < night_start else "night"
        return "day"

    def _pick_leader_ids(group_row):
        """从 group 行提取当前班次的 leader open_id 集合"""
        if not group_row:
            return set()
        raw = (group_row["day_leader"] if _current_shift() == "day"
               else group_row["night_leader"]) or ""
        return {lid.strip() for lid in raw.split(",") if lid.strip()}

    def _add_leader_targets(leader_ids):
        """将 open_id 集合追加为 leader 目标"""
        for lid in sorted(leader_ids):
            if lid:
                targets.append(("leader", lid))

    # ── 解析本组 leader ──
    group_row = None
    if group_name:
        group_row = conn.execute(
            "SELECT day_leader, night_leader FROM groups WHERE name=?",
            (group_name,)
        ).fetchone()

    group_leader_ids = _pick_leader_ids(group_row) if group_row else set()

    # ── 解析采集员 ──
    collector_ids = set()
    if collector_str:
        for cid in collector_str.split(","):
            cid = cid.strip()
            if cid:
                collector_ids.add(cid)

    # ── 同机型匹配：找同机型且有分组的机器的 leader ──
    type_match_ids = set()
    if not group_leader_ids and not collector_ids and machine_type:
        type_rows = conn.execute(
            """SELECT DISTINCT g.day_leader, g.night_leader
               FROM machines m
               JOIN groups g ON m.group_name = g.name
               WHERE m.type = ? AND m.group_name != ''""",
            (machine_type,),
        ).fetchall()
        for r in type_rows:
            type_match_ids |= _pick_leader_ids(r)

    # ── 路由决策 ──
    if group_name and group_row and group_leader_ids:
        # 分支 1：有组且有 leader → 用它
        _add_leader_targets(group_leader_ids)
    elif group_name and group_row and not group_leader_ids:
        # 分支 2+3：有组无 leader
        if collector_ids:
            _add_leader_targets(collector_ids)
        elif type_match_ids:
            _add_leader_targets(type_match_ids)
        # 分支 3 无匹配 → 空（不发给所有人）
    elif group_name and not group_row:
        # 组名存在但 groups 表中无匹配 → 无 leader
        if collector_ids:
            _add_leader_targets(collector_ids)
        elif type_match_ids:
            _add_leader_targets(type_match_ids)
    elif not group_name:
        # 分支 4+5+6：无组
        if collector_ids:
            _add_leader_targets(collector_ids)
        elif type_match_ids:
            _add_leader_targets(type_match_ids)
        else:
            # 分支 6：回退到所有组的 leader
            all_rows = conn.execute(
                "SELECT day_leader, night_leader FROM groups"
            ).fetchall()
            all_ids = set()
            for r in all_rows:
                all_ids |= _pick_leader_ids(r)
            _add_leader_targets(all_ids)

    # ── 群聊目标 ──
    chat_row = conn.execute(
        "SELECT value FROM config WHERE category='feishu_push' AND key='chat_ids'"
    ).fetchone()
    chat_groups = []
    if chat_row:
        raw = (chat_row["value"] or "").strip()
        if raw.startswith("["):
            try:
                chat_groups = json.loads(raw)
            except json.JSONDecodeError:
                pass

    for cg in chat_groups:
        cid = cg.get("chat_id", "")
        if cid:
            targets.append(("group", cid))

    conn.close()

    leader_id = ",".join(t[1] for t in targets if t[0] == "leader")
    return targets, leader_id


# ========== 发送 & 分组 共用基元 ==========

def _send_card(target_type, target_id, card_json):
    """统一的卡片发送：根据 target_type 选择群发或私信"""
    if target_type == "leader":
        return send_im_message_to_user(target_id, card_json, "interactive")
    else:
        return send_im_message(target_id, card_json, "interactive")


def _group_events(all_events):
    """将事件按类型分组，返回各阶段所需列表"""
    announcement_events = []
    change_events = []
    individual_events = []

    for ev in all_events:
        etype = ev["event_type"]
        if etype in ("task_confirm_start", "task_confirm_end", "package_complete"):
            announcement_events.append(ev)
        elif etype == "schedule_changes":
            change_events.append(ev)
        elif etype in ("shift_report", "shift_table_screenshot"):
            pass  # 班次报告/表格截图独立处理
        else:
            individual_events.append(ev)

    reminder_events = [e for e in individual_events
                       if e["event_type"] not in ("exception_start", "exception_end", "exception_update", "task_recycled")]
    exception_events = [e for e in individual_events
                        if e["event_type"] in ("exception_start", "exception_end", "exception_update")]
    recycled_events = [e for e in individual_events
                       if e["event_type"] == "task_recycled"]

    return announcement_events, change_events, reminder_events, exception_events, recycled_events


# ========== 各阶段派发函数 ==========

def _dispatch_reminders(reminder_by_target, toggles, conn, diag):
    """合并提醒事件：按 target 分组去重后发送"""
    for (target_type, target_id), evs in reminder_by_target.items():
        filtered = []
        for ev in evs:
            etype = ev["event_type"]
            toggle_cfg = toggles.get(etype, {})
            if target_type == "leader" and not toggle_cfg.get("leader", False):
                continue
            if target_type == "group" and not toggle_cfg.get("group", False):
                continue
            sid = ev.get("schedule_id", 0)
            dedup_key_map = {
                "task_impending_start": f"remind_{sid}_impending_start",
                "task_start": f"task_start_{sid}",
                "task_impending_end": f"remind_{sid}_impending_end",
                "task_end": f"task_end_{sid}",
            }
            dedup_key = dedup_key_map.get(etype, f"{etype}_{sid}")
            notify_value = None
            if etype == "task_start":
                notify_value = ev.get("actual_start_min")
            elif etype == "task_end":
                notify_value = ev.get("actual_end_min")
            elif etype == "task_impending_start":
                notify_value = ev.get("start_min")
            elif etype == "task_impending_end":
                notify_value = ev.get("end_min")

            if _should_send(conn, dedup_key, target_id, notify_value):
                filtered.append((ev, dedup_key, etype, notify_value))
            else:
                diag["skipped_dedup"] += 1

        if not filtered:
            diag["skipped_toggle"] += 1
            continue

        card_json = build_merged_reminder_card([f[0] for f in filtered], len(filtered))
        if not card_json:
            continue

        success, _ = _send_card(target_type, target_id, card_json)
        if success:
            diag["sent"] += len(filtered)
        else:
            diag["failed"] += len(filtered)

        for ev, dedup_key, etype, notify_value in filtered:
            _record_push(conn, dedup_key, etype, target_type, target_id, notify_value, success)


def _dispatch_exceptions(exception_events, toggles, conn, now_str, diag):
    """异常事件逐条发送（不合并）"""
    for ev in exception_events:
        etype = ev["event_type"]
        toggle_cfg = toggles.get(etype, {})
        sid = ev.get("schedule_id", 0)

        targets, _ = _get_targets_for_event(ev)

        for target_type, target_id in targets:
            if target_type == "leader" and not toggle_cfg.get("leader", False):
                continue
            if target_type == "group" and not toggle_cfg.get("group", False):
                continue

            if etype == "exception_update":
                dedup_key = f"exc_{sid}_update"
                notify_value = ev.get("exception_note", "")
            elif etype == "exception_start":
                dedup_key = f"exc_{sid}_start"
                notify_value = ev.get("exception_reason", "")
            else:
                dedup_key = f"exc_{sid}_end"
                notify_value = None

            if not _should_send(conn, dedup_key, target_id, notify_value):
                diag["skipped_dedup"] += 1
                continue

            if etype == "exception_start":
                ev["start_time"] = now_str
                card_json = build_exception_card(ev, is_end=False)
            elif etype == "exception_update":
                card_json = build_exception_card(ev, is_update=True)
            else:
                card_json = build_exception_card(ev, is_end=True)

            if not card_json:
                continue

            success, _ = _send_card(target_type, target_id, card_json)
            if success:
                diag["sent"] += 1
            else:
                diag["failed"] += 1

            _record_push(conn, dedup_key, etype, target_type, target_id, notify_value, success)


def _dispatch_recycled_events(recycled_events, toggles, conn, diag):
    """任务回收事件逐条发送，发送后更新 push_log 状态"""
    for ev in recycled_events:
        toggle_cfg = toggles.get("task_recycled", {})
        dedup_key = ev.get("dedup_key", "")
        push_log_id = ev.pop("push_log_id", None)
        any_sent = False

        targets, _ = _get_targets_for_event(ev)

        for target_type, target_id in targets:
            if target_type == "leader" and not toggle_cfg.get("leader", False):
                continue
            if target_type == "group" and not toggle_cfg.get("group", False):
                continue

            if not _should_send(conn, dedup_key, target_id):
                diag["skipped_dedup"] += 1
                continue

            card_json = build_recycled_card(ev)
            if not card_json:
                continue

            success, _ = _send_card(target_type, target_id, card_json)
            if success:
                diag["sent"] += 1
                any_sent = True
            else:
                diag["failed"] += 1

            _record_push(conn, dedup_key, "task_recycled", target_type, target_id, None, success)

        if push_log_id and any_sent:
            conn.execute("UPDATE push_log SET success=1 WHERE id=?", (push_log_id,))
            conn.commit()


def _dispatch_announcements(announcement_events, toggles, conn, diag):
    """公告合并发送：去重后按 target 汇总推送"""
    if not announcement_events:
        return

    all_targets = set()
    for ev in announcement_events:
        targets, _ = _get_targets_for_event(ev)
        for tt, tid in targets:
            all_targets.add((tt, tid))

    for target_type, target_id in all_targets:
        new_events = []
        for ev in announcement_events:
            cfg = toggles.get(ev["event_type"], {})
            if not cfg.get(target_type, False):
                continue

            sid = ev.get("schedule_id", 0)
            dedup_key_map = {
                "task_confirm_start": f"confirm_start_{sid}",
                "task_confirm_end": f"confirm_end_{sid}",
                "package_complete": f"pkg_done_{ev.get('package_name', '')}_{ev.get('date', '')}",
            }
            dedup_key = dedup_key_map.get(ev["event_type"], f"{ev['event_type']}_{sid}")
            notify_value = ev.get("actual_start_min") if ev["event_type"] == "task_confirm_start" else (
                ev.get("actual_end_min") if ev["event_type"] == "task_confirm_end" else None
            )
            if _should_send(conn, dedup_key, target_id, notify_value):
                new_events.append(ev)
            else:
                diag["skipped_dedup"] += 1

        if not new_events:
            continue

        card_json = build_announcement_card(new_events)
        if not card_json:
            continue

        success, _ = _send_card(target_type, target_id, card_json)
        if success:
            diag["sent"] += len(new_events)
        else:
            diag["failed"] += len(new_events)

        for ev in new_events:
            sid = ev.get("schedule_id", 0)
            dedup_key_map = {
                "task_confirm_start": f"confirm_start_{sid}",
                "task_confirm_end": f"confirm_end_{sid}",
                "package_complete": f"pkg_done_{ev.get('package_name', '')}_{ev.get('date', '')}",
            }
            dedup_key = dedup_key_map.get(ev["event_type"], f"{ev['event_type']}_{sid}")
            notify_value = ev.get("actual_start_min") if ev["event_type"] == "task_confirm_start" else (
                ev.get("actual_end_min") if ev["event_type"] == "task_confirm_end" else None
            )
            _record_push(conn, dedup_key, ev["event_type"], target_type, target_id, notify_value, success)


def _dispatch_shift_reports(all_events, toggles, conn, diag):
    """班次报告逐条发送（不合并）"""
    report_events = [e for e in all_events if e["event_type"] == "shift_report"]
    if not report_events:
        return

    toggle_cfg = toggles.get("shift_report", {})
    for ev in report_events:
        targets, _ = _get_targets_for_event(ev)
        for target_type, target_id in targets:
            if not toggle_cfg.get(target_type, False):
                diag["skipped_toggle"] += 1
                continue
            dedup_key = f"shift_report_{ev.get('date', '')}_{ev.get('shift', '')}"
            if not _should_send(conn, dedup_key, target_id):
                diag["skipped_dedup"] += 1
                continue
            card_json = build_report_card(ev)
            if not card_json:
                continue
            success, _ = _send_card(target_type, target_id, card_json)
            if success:
                diag["sent"] += 1
            else:
                diag["failed"] += 1
            _record_push(conn, dedup_key, "shift_report", target_type, target_id, None, success)


def _dispatch_shift_table_screenshots(all_events, toggles, conn, diag):
    """表格截图推送：生成 Pillow 表格 PNG 并发送到群聊"""
    ss_events = [e for e in all_events if e["event_type"] == "shift_table_screenshot"]
    if not ss_events:
        return

    from routes.summary import generate_table_image

    toggle_cfg = toggles.get("shift_table_screenshot", {})
    for ev in ss_events:
        targets, _ = _get_targets_for_event(ev)
        for target_type, target_id in targets:
            if not toggle_cfg.get(target_type, False):
                diag["skipped_toggle"] += 1
                continue
            dedup_key = f"shift_table_screenshot_{ev.get('date', '')}_{ev.get('shift_key', ev.get('shift', ''))}"
            if not _should_send(conn, dedup_key, target_id):
                diag["skipped_dedup"] += 1
                continue
            try:
                png_bytes = generate_table_image(ev["date"], ev.get("shift_key", ev["shift"]))
                image_key = upload_image(png_bytes)
                if not image_key:
                    diag["failed"] += 1
                    continue
                success, _ = send_image_message(target_id, image_key)
                if success:
                    diag["sent"] += 1
                else:
                    diag["failed"] += 1
                _record_push(conn, dedup_key, "shift_table_screenshot", target_type, target_id, None, success)
            except Exception as e:
                diag["failed"] += 1
                write_event("error", "", f"表格截图失败 {ev.get('date','')}/{ev.get('shift','')}: {e}")


def _dispatch_changes(change_events, toggles, conn, now, now_min, diag):
    """变动汇总合并发送"""
    if not change_events:
        return

    toggle_cfg = toggles.get("schedule_changes", {})
    all_targets = set()
    for ev in change_events:
        targets, _ = _get_targets_for_event(ev)
        for tt, tid in targets:
            all_targets.add((tt, tid))

    for target_type, target_id in all_targets:
        if not toggle_cfg.get(target_type, False):
            diag["skipped_toggle"] += 1
            continue

        date_str = change_events[0].get("date", "")
        # 用 shift_config 表的实际班次时间判断当前班次（与 _get_targets_for_event 一致）
        day_s = night_s = None
        for r in conn.execute(
            "SELECT key, start FROM shift_config WHERE key IN ('day_shift', 'night_shift')"
        ).fetchall():
            try:
                parts = str(r["start"]).replace('：', ':').split(":")
                t = int(parts[0]) * 60 + int(parts[1])
            except Exception:
                t = None
            if r["key"] == "day_shift":
                day_s = t
            elif r["key"] == "night_shift":
                night_s = t
        if day_s is not None and night_s is not None:
            shift = "白班" if day_s <= now_min < night_s else "夜班"
        else:
            shift = "白班" if 6 <= now.hour < 18 else "夜班"
        dedup_key = f"shift_changes_{date_str}_{shift}"
        notify_value = [{
            "sid": e["schedule_id"],
            "start_min": e.get("start_min"),
            "end_min": e.get("end_min"),
        } for e in change_events]

        if not _should_send(conn, dedup_key, target_id, notify_value):
            diag["skipped_dedup"] += 1
            continue

        is_leader = (target_type == "leader")
        card_json = build_changes_card(change_events, for_leader=is_leader)
        if not card_json:
            continue

        success, _ = _send_card(target_type, target_id, card_json)
        if success:
            diag["sent"] += 1
        else:
            diag["failed"] += 1

        _record_push(conn, dedup_key, "schedule_changes", target_type, target_id, notify_value, success)


def _log_diag(diag):
    """诊断摘要写入事件日志"""
    parts = []
    if diag["sent"] > 0:
        parts.append(f"发送{diag['sent']}条")
    if diag["failed"] > 0:
        parts.append(f"失败{diag['failed']}条")
    if diag["skipped_dedup"] > 0:
        parts.append(f"去重跳过{diag['skipped_dedup']}")
    if diag["skipped_toggle"] > 0:
        parts.append(f"开关关闭{diag['skipped_toggle']}")
    if parts:
        write_event("info", "", "📤 派发: " + ", ".join(parts))


# ========== 派发入口 ==========

def dispatch_events(all_events):
    """去重、按开关过滤、生成卡片、发送、写 push_log"""
    toggles = _load_toggles()
    conn = get_db()
    try:
        now = datetime.datetime.now()
        now_str = now.strftime("%m-%d %H:%M")
        now_min = now.hour * 60 + now.minute

        diag = {"sent": 0, "skipped_toggle": 0, "skipped_dedup": 0, "skipped_no_target": 0, "failed": 0}

        announcement_events, change_events, reminder_events, exception_events, recycled_events = _group_events(all_events)

        # 合并提醒事件：按 (target_type, target_id) 分组
        reminder_by_target = {}
        for ev in reminder_events:
            targets, _ = _get_targets_for_event(ev)
            for tt, tid in targets:
                key = (tt, tid)
                if key not in reminder_by_target:
                    reminder_by_target[key] = []
                reminder_by_target[key].append(ev)

        _dispatch_reminders(reminder_by_target, toggles, conn, diag)
        _dispatch_exceptions(exception_events, toggles, conn, now_str, diag)
        _dispatch_recycled_events(recycled_events, toggles, conn, diag)
        _dispatch_announcements(announcement_events, toggles, conn, diag)
        _dispatch_shift_reports(all_events, toggles, conn, diag)
        _dispatch_shift_table_screenshots(all_events, toggles, conn, diag)
        _dispatch_changes(change_events, toggles, conn, now, now_min, diag)

        _log_diag(diag)
        # 清理 90 天前的推送日志，控制表大小
        try:
            cutoff = (now - datetime.timedelta(days=90)).strftime("%Y-%m-%d")
            conn.execute("DELETE FROM push_log WHERE sent_at < ?", (cutoff,))
            conn.commit()
        except Exception:
            pass
        return diag
    finally:
        conn.close()
