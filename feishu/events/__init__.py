# -*- coding: utf-8 -*-
"""飞书事件检测与推送 — 入口模块

调用方式：
    from feishu.events import detect_and_push_events
    detect_and_push_events(old_snapshots)

向后兼容别名（迁移期用）：
    from feishu.events import _build_report_card
"""
import json
import time
from db import get_db
from feishu.status import write_event
from feishu.events.shared import (
    MIN_DETECT_INTERVAL_SEC, _last_detect_at,
)
from feishu.events.feishu_source import detect_from_feishu, _fetch_feishu_schedules
from feishu.events.local_source import detect_from_local
from feishu.events.dispatch import dispatch_events
from feishu.events.cards import build_report_card

# 向后兼容别名
_build_report_card = build_report_card


def detect_and_push_events(old_snapshots=None):
    """在 push 完成后调用。分两阶段检测事件并推送。带最小间隔防重复调用。
    old_snapshots: {machine_id: {record_id: lmt}} push 前的旧快照，用于正确检测 data_changed。
                   不传则从 DB 读取（但此时快照已被 push 更新，变更类事件可能漏检）。"""
    global _last_detect_at
    now_ts = time.time()
    if now_ts - _last_detect_at < MIN_DETECT_INTERVAL_SEC:
        return
    _last_detect_at = now_ts

    try:
        conn = get_db()
        row = conn.execute(
            "SELECT value FROM config WHERE category='feishu_push' AND key='enabled'"
        ).fetchone()
        conn.close()
        if not row or row["value"] != "1":
            return

        all_events = []

        # 阶段一：扫描飞书表（场景 1-9）
        conn2 = get_db()
        mappings = conn2.execute(
            "SELECT machine_id, machine_name, table_id, last_push_snapshot FROM feishu_sync_mapping"
        ).fetchall()
        conn2.close()

        if old_snapshots is None:
            old_snapshots = {}

        for m in mappings:
            try:
                mid = m["machine_id"]
                if mid in old_snapshots:
                    snap = old_snapshots[mid]
                else:
                    snap = {}
                    if m["last_push_snapshot"]:
                        try:
                            snap = json.loads(m["last_push_snapshot"])
                        except (json.JSONDecodeError, TypeError):
                            snap = {}
                feishu_items = _fetch_feishu_schedules(m["table_id"])
                events = detect_from_feishu(m["machine_id"], m["machine_name"], feishu_items, snap)
                all_events.extend(events)
            except Exception:
                pass  # 单台机器失败不阻塞其他

        # 阶段二：查本地 DB（场景 10-11 + 补发）
        try:
            local_events = detect_from_local()
            all_events.extend(local_events)
        except Exception:
            pass

        if all_events:
            # 同一批次内去重：同 event_type + schedule_id + machine_id 只保留一条
            seen_keys = set()
            deduped_events = []
            for ev in all_events:
                etype = ev.get("event_type", "unknown")
                sid = ev.get("schedule_id", "")
                mid = ev.get("machine_id", "")
                key = (etype, str(sid), str(mid))
                if key not in seen_keys:
                    seen_keys.add(key)
                    deduped_events.append(ev)
            # 诊断日志：按事件类型统计
            type_counts = {}
            for ev in deduped_events:
                etype = ev.get("event_type", "unknown")
                type_counts[etype] = type_counts.get(etype, 0) + 1
            summary = ", ".join(f"{k}×{v}" for k, v in sorted(type_counts.items()))
            write_event("info", "", f"📨 检测到事件: {summary}" if summary else "📨 无事件")
            diag = dispatch_events(deduped_events)
            # 记录事件推送结果到操作历史，让前端「最近活动」可展示
            from feishu.status import record_event_push
            record_event_push(diag)
        else:
            write_event("info", "", "📨 本轮无事件")

    except Exception as e:
        write_event("warn", "", f"推送事件检测异常: {str(e)[:80]}")
        pass  # 推送检测失败不影响 push/pull 主流程
