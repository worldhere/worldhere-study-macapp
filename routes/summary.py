# -*- coding: utf-8 -*-
"""可视化总结面板 API"""
from flask import Blueprint, request, jsonify
from db import get_db
from models.summary import WIDGET_REGISTRY, shift_report_data
from models.queries import get_repair_logs
from feishu.events.cards import build_report_card
from feishu.common import send_im_message, upload_image, send_image_message, _load_chat_ids

bp = Blueprint("summary", __name__)


@bp.route("/api/summary/data")
def api_summary_data():
    """批量获取 widget 数据。GET /api/summary/data?widgets=a,b&days=14&end_date=2026-06-08&date=...&shift=夜班"""
    widget_names = (request.args.get("widgets") or "").split(",")
    widget_names = [w.strip() for w in widget_names if w.strip()]

    days = request.args.get("days", "14")
    try:
        days = int(days)
    except ValueError:
        days = 14

    date_str = request.args.get("date") or None
    end_date = request.args.get("end_date") or None
    shift = request.args.get("shift") or "白班"

    conn = get_db()
    result = {}
    errors = []

    for name in widget_names:
        if name not in WIDGET_REGISTRY:
            errors.append({"widget": name, "error": "unknown widget"})
            continue
        try:
            func = WIDGET_REGISTRY[name]
            if name == "shift_report":
                if date_str:
                    result[name] = func(conn, date_str, shift)
                else:
                    result[name] = {"error": "date required for shift_report"}
            elif name == "machine_utilization":
                if date_str:
                    result[name] = func(conn, date_str, shift)
                else:
                    result[name] = {"error": "date required for machine_utilization"}
            elif name == "machine_status":
                result[name] = func(conn)
            elif name == "push_stats":
                if date_str:
                    result[name] = func(conn, date_str, shift)
                else:
                    result[name] = {"error": "date required for push_stats"}
            elif name == "overdue_tasks":
                result[name] = func(conn)
            else:
                result[name] = func(conn, days, end_date)
        except Exception as e:
            errors.append({"widget": name, "error": str(e)})
            result[name] = None

    conn.close()

    resp = {"data": result}
    if errors:
        resp["errors"] = errors
    return jsonify(resp)


@bp.route("/api/summary/report-status")
def api_report_status():
    """检查报告/截图是否已发送。GET /api/summary/report-status?date=2026-06-08&shift=白班"""
    date_str = request.args.get("date") or ""
    shift = request.args.get("shift") or "白班"

    conn = get_db()
    dedup_report = f"shift_report_{date_str}_{shift}"
    dedup_screenshot = f"shift_table_screenshot_{date_str}_{shift}"
    row = conn.execute(
        """SELECT sent_at, success, event_type FROM push_log
           WHERE (dedup_key=? AND event_type='shift_report')
              OR (dedup_key=? AND event_type='shift_table_screenshot')
           ORDER BY id DESC LIMIT 1""",
        (dedup_report, dedup_screenshot)
    ).fetchone()
    conn.close()

    if row:
        return jsonify({
            "generated": True,
            "sent": bool(row["success"]),
            "sent_at": row["sent_at"],
            "method": row["event_type"],
        })
    return jsonify({"generated": False, "sent": False, "sent_at": None, "method": None})


@bp.route("/api/summary/send-report", methods=["POST"])
def api_send_report():
    """手动发送班次报告到飞书群。
    POST body: {"date": "2026-06-08", "shift": "白班"}"""
    body = request.get_json() or {}
    date_str = body.get("date") or ""
    shift = body.get("shift") or "白班"

    if not date_str:
        return jsonify({"success": False, "error": "date required"}), 400

    # 从 DB 读取群配置
    chat_ids, err = _load_chat_ids()
    if err:
        return jsonify({"success": False, "error": err}), 400

    # 构建报告事件
    event = {"date": date_str, "shift": shift, "display_date": date_str}

    try:
        card_json = build_report_card(event)
    except Exception as e:
        return jsonify({"success": False, "error": f"card build failed: {e}"}), 500

    # 发送到每个群
    import datetime as _dt
    now_str = _dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    sent_to = []
    send_errors = []

    for cid in chat_ids:
        success, err = send_im_message(str(cid), card_json, "interactive")
        if success:
            sent_to.append(cid)
        else:
            send_errors.append({"chat_id": cid, "error": err})

    # 写 push_log 记录
    conn2 = get_db()
    dedup_key = f"shift_report_{date_str}_{shift}"
    conn2.execute(
        """INSERT OR REPLACE INTO push_log (dedup_key, event_type, target_type, target_id, notify_value, sent_at, success)
           VALUES (?, 'shift_report', 'group', ?, ?, ?, 1)""",
        (dedup_key, ",".join(sent_to), card_json[:500], now_str),
    )
    conn2.commit()
    conn2.close()

    return jsonify({
        "success": len(send_errors) == 0,
        "sent_to": sent_to,
        "errors": send_errors,
    })


@bp.route("/api/summary/send-screenshot", methods=["POST"])
def api_send_screenshot():
    """接收前端截图 PNG，上传飞书并发送到群。
    POST: multipart/form-data, field 'image' = PNG blob
    可选 field: date, shift — 用于班次结束后写入 push_log 去重"""
    if "image" not in request.files:
        return jsonify({"success": False, "error": "missing image file"}), 400

    png_bytes = request.files["image"].read()
    if not png_bytes or len(png_bytes) < 100:
        return jsonify({"success": False, "error": "image too small or empty"}), 400

    date_str = request.form.get("date", "")
    shift_arg = request.form.get("shift", "")

    # 读取群配置
    chat_ids, err = _load_chat_ids()
    if err:
        return jsonify({"success": False, "error": err}), 400

    # 上传图片到飞书
    image_key = upload_image(png_bytes)
    if not image_key:
        return jsonify({"success": False, "error": "图片上传飞书失败"}), 500

    # 发送到每个群
    sent_to = []
    send_errors = []
    for cid in chat_ids:
        success, err = send_image_message(str(cid), image_key)
        if success:
            sent_to.append(cid)
        else:
            send_errors.append({"chat_id": cid, "error": err})

    # ── 去重：仅班次结束后手动发送时写入 push_log，拦截自动推送 ──
    if date_str and shift_arg:
        SHIFT_MAP = {"白班": "day_shift", "夜班": "night_shift"}
        shift_key = SHIFT_MAP.get(shift_arg, shift_arg)
        # 班次结束后手动发送 → 写入 push_log，拦截自动推送
        conn3 = get_db()
        if _is_post_shift(conn3, shift_key):
            import datetime as _dt2
            now_str = _dt2.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            dedup_key = f"shift_table_screenshot_{date_str}_{shift_key}"
            try:
                conn3.execute(
                    """INSERT OR REPLACE INTO push_log
                       (dedup_key, event_type, target_type, target_id, notify_value, sent_at, success)
                       VALUES (?, 'shift_table_screenshot', 'group', ?, ?, ?, 1)""",
                    (dedup_key, ",".join(sent_to), "manual", now_str),
                )
                conn3.commit()
            except Exception:
                pass
        conn3.close()

    return jsonify({
        "success": len(send_errors) == 0,
        "sent_to": sent_to,
        "errors": send_errors,
    })


def _is_post_shift(conn, shift_key):
    """班次是否已结束（与 _detect_shift_report 的触发窗口一致）"""
    import datetime as _dt, re as _re
    now = _dt.datetime.now()
    now_min = now.hour * 60 + now.minute

    sc = conn.execute(
        "SELECT start, \"end\", overtime, breaks FROM shift_config WHERE key=?", (shift_key,)
    ).fetchone()
    if not sc:
        return False
    t0 = _parse_time_min(sc["start"])
    t1 = _parse_time_min(sc["end"])
    cross = t1 <= t0
    if cross:
        t1 += 24 * 60

    # 从 overtime + breaks 中找最晚结束时间
    oe = t1
    for raw in (sc["overtime"] or "", sc["breaks"] or ""):
        if not raw:
            continue
        for seg in raw.split(","):
            m = _re.match(r"(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})", seg.strip())
            if m:
                be = int(m.group(3)) * 60 + int(m.group(4))
                # 跨夜规范化（与 _parse_segments 一致）
                if cross and be < t0 % (24 * 60):
                    be += 24 * 60
                if be > oe:
                    oe = be
    oe = oe % 1440

    if shift_key == "day_shift":
        return now_min < t0 or now_min >= oe
    else:
        return now_min >= oe


def _parse_time_min(s):
    """'HH:MM' → 一天中的分钟数"""
    parts = str(s).replace("：", ":").split(":")
    return int(parts[0]) * 60 + int(parts[1])


# ═══════════════════════════════════════════════════
# 表格截图生成（样式二 — Pillow 纯表格）
# ═══════════════════════════════════════════════════

import os as _os
import sys as _sys

# 样式常量
_TABLE_HEADER_BG   = (30, 58, 95)
_TABLE_HEADER_FG   = (168, 200, 232)
_TABLE_GRID_COLOR  = (200, 204, 212)
_TABLE_MACHINE_BG  = (244, 245, 247)
_TABLE_MACHINE_FG  = (30, 30, 30)
_TABLE_TASK_FG     = (255, 255, 255)
_TABLE_EMPTY_BG    = (250, 251, 252)
_TABLE_EMPTY_FG    = (192, 196, 204)
_TABLE_TITLE_FG    = (50, 50, 50)
_TABLE_COL_NAME_W  = 260
_TABLE_COL_SLOT_W  = 208
_TABLE_ROW_H       = 88
_TABLE_HEADER_H    = 68
_TABLE_TITLE_H     = 80
_TABLE_PAD_X       = 16
_TABLE_FONT_SIZE   = 26
_TABLE_FONT_SMALL  = 22


def _table_get_font(size, bold=False):
    candidates = []
    if _sys.platform == 'win32':
        candidates = [
            "C:/Windows/Fonts/msyh.ttc",
            "C:/Windows/Fonts/simhei.ttf",
        ]
    else:
        candidates = [
            "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf",
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
            "/System/Library/Fonts/PingFang.ttc",
        ]
    from PIL import ImageFont
    for path in candidates:
        if _os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    return ImageFont.load_default()


def _table_min_to_str(mins):
    """绝对分钟转时钟文字，跨午夜自动折叠"""
    h = (mins // 60) % 24
    m = mins % 60
    return f"{h:02d}:{m:02d}"


def _table_min_to_label(mins, t0):
    """带跨日标记的时钟标签"""
    day_offset = (mins // 60) // 24
    h = (mins // 60) % 24
    m = mins % 60
    base = f"{h:02d}:{m:02d}"
    if day_offset > 0:
        base = f"(+{day_offset}){base}"
    return base


def _table_hex_to_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))


def _table_truncate(name, max_chars):
    if len(name) <= max_chars:
        return name
    return name[:max_chars - 1] + "…"


def generate_table_image(date_str, shift_key):
    """生成表格风格排班截图，返回 PNG bytes。
    联动设置：compact_task_label, show_package_name, type_colors, state_colors,
    priority_color_enabled, priority_colors, repair_border"""
    import io as _io, json as _json
    from PIL import Image, ImageDraw

    conn = get_db()

    sc = conn.execute("SELECT * FROM shift_config WHERE key=?", (shift_key,)).fetchone()
    if not sc:
        conn.close()
        raise ValueError(f"shift not found: {shift_key}")
    import re as _re

    def _parse_segments(raw, t0, cross):
        """解析 'HH:MM-HH:MM,...' 格式的时间段，返回 [(abs_start, abs_end), ...]。
        跨夜班次时自动将凌晨段 +24h。"""
        if not raw:
            return []
        segs = []
        for seg in raw.split(","):
            m = _re.match(r"(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})", seg.strip())
            if m:
                bs = int(m.group(1)) * 60 + int(m.group(2))
                be = int(m.group(3)) * 60 + int(m.group(4))
                if cross:
                    if bs < t0 - 24 * 60 or bs < t0 % (24 * 60):
                        bs += 24 * 60
                    if be < bs:
                        be += 24 * 60
                segs.append((bs, be))
        return segs

    t0 = int(sc["start"].split(":")[0]) * 60 + int(sc["start"].split(":")[1])
    t1 = int(sc["end"].split(":")[0]) * 60 + int(sc["end"].split(":")[1])
    cross = t1 <= t0
    if cross:
        t1 += 24 * 60
    work_start, work_end = t0, t1  # 正常工作时间段

    # 加班段（overtime 字段）
    ot_segments = _parse_segments(sc["overtime"] or "", t0, cross)
    # 休息段（breaks 字段）
    break_segments = _parse_segments(sc["breaks"] or "", t0, cross)

    # 扩展 t1 到最晚结束时间
    for _, be in ot_segments + break_segments:
        t1 = max(t1, be)

    # t1 延伸到下一个班次的开始时间（覆盖班次间隙）
    next_key = "night_shift" if shift_key == "day_shift" else "day_shift"
    next_sc = conn.execute("SELECT start FROM shift_config WHERE key=?", (next_key,)).fetchone()
    if next_sc:
        next_start = int(next_sc["start"].split(":")[0]) * 60 + int(next_sc["start"].split(":")[1])
        # 若下一班次开始时间在当前班次开始之前 → 属于次日
        if next_start < t0 % (24 * 60):
            next_start += 24 * 60
        t1 = max(t1, next_start)

    # ── 段叠加层色值（与时间轴 CSS 对齐）──
    _SEG_WORK_TINT  = (250, 204, 21, int(255 * 0.22))    # --seg-color-work
    _SEG_OT_TINT    = (249, 115, 22, int(255 * 0.22))    # --seg-color-ot
    _SEG_BREAK_TINT = (59, 130, 246, int(255 * 0.22))   # --seg-color-break

    def _blend_tint(base_rgb, tint_rgba):
        """Alpha blend tint onto base, return RGB tuple"""
        r, g, b = base_rgb
        tr, tg, tb, ta = tint_rgba
        a = ta / 255.0
        return (int(r * (1 - a) + tr * a), int(g * (1 - a) + tg * a), int(b * (1 - a) + tb * a))

    def _slot_in_segments(mins, segs):
        for s, e in segs:
            if s <= mins < e:
                return True
        return False

    machines = conn.execute(
        "SELECT id, name, type, task_kind, status FROM machines ORDER BY sort_order, name"
    ).fetchall()

    # JOIN tasks + task_packages 以获取机型、优先级、难度、包名
    rows = conn.execute("""
        SELECT s.machine_id, s.start_min, s.end_min, s.task_name, s.status,
               s.task_type, s.task_kind, t.priority, t.difficulty, t.package_id,
               t.split_group, pkg.name AS package_name
        FROM schedules s
        LEFT JOIN tasks t ON s.task_id = t.id
        LEFT JOIN task_packages pkg ON t.package_id = pkg.id
        WHERE s.date = ? ORDER BY s.machine_id, s.start_min
    """, (date_str,)).fetchall()

    # ── 读取所有联动设置 ──
    def _cfg(cat, key, default=None):
        r = conn.execute(
            "SELECT value FROM config WHERE category=? AND key=?", (cat, key)
        ).fetchone()
        return r["value"] if r else default

    type_colors = _json.loads(_cfg("color_settings", "type_colors", "{}"))
    state_colors = _json.loads(_cfg("color_settings", "state_colors", "{}"))
    compact = _cfg("schedule_settings", "compact_task_label") == "1"
    show_pkg = _cfg("schedule_settings", "show_package_name") == "1"
    pri_enabled = _cfg("schedule_settings", "priority_color_enabled") == "1"

    conn.close()

    # ── 维修时段（用于叠加层；与时间轴 _repairLogs 一致）──
    machine_ids_for_repair = [m["id"] for m in machines]
    repair_logs = get_repair_logs(machine_ids_for_repair, date_str) if machine_ids_for_repair else {}

    # fallback 默认状态颜色
    _DEFAULT_STATES = {
        "completed": "#84cc16", "split": "#a78bfa",
        "repair_bg": "#fef2f2", "repair_border": "#fca5a5",
        "paused": "#fca5a5", "post_pause": "#fbcfe8",
    }
    for k, v in _DEFAULT_STATES.items():
        state_colors.setdefault(k, v)

    repair_border_rgb = _table_hex_to_rgb(state_colors["repair_border"])

    def _draw_rect(draw, coords, fill, outline, width=1):
        """画矩形，支持粗边框"""
        if width <= 1:
            draw.rectangle(coords, fill=fill, outline=outline)
        else:
            x0, y0, x1, y1 = coords
            # 先画粗边框
            for w in range(width):
                draw.rectangle([x0 + w, y0 + w, x1 - w, y1 - w], outline=outline)
            # 再画填充
            draw.rectangle([x0 + width, y0 + width, x1 - width, y1 - width], fill=fill)

    machine_map = {}
    for m in machines:
        machine_map[m["id"]] = {
            "name": m["name"], "type": m["type"] or "", "kind": m["task_kind"] or "",
            "tasks": [],
            "has_repair": m["status"] == "维修停用",
        }
    for r in rows:
        mid = r["machine_id"]
        if mid in machine_map:
            machine_map[mid]["tasks"].append({
                "start": r["start_min"], "end": r["end_min"],
                "name": r["task_name"] or "",
                "type": r["task_type"] or "",
                "kind": r["task_kind"] or "",
                "status": r["status"] or "",
                "priority": r["priority"] or "",
                "difficulty": r["difficulty"] or "",
                "package_name": r["package_name"] or "",
                "is_split": bool(r["split_group"]),
            })

    slots = list(range(t0, t1, 30))
    n_slots = len(slots)

    total_w = _TABLE_COL_NAME_W + n_slots * _TABLE_COL_SLOT_W
    total_h = _TABLE_TITLE_H + _TABLE_HEADER_H + len(machines) * _TABLE_ROW_H + _TABLE_HEADER_H

    font = _table_get_font(_TABLE_FONT_SIZE)
    font_bold = _table_get_font(_TABLE_FONT_SIZE, bold=True)
    font_small = _table_get_font(_TABLE_FONT_SMALL)
    font_tiny = _table_get_font(_TABLE_FONT_SMALL - 2)
    font_name = _table_get_font(_TABLE_FONT_SMALL + 1, bold=True)
    font_title = _table_get_font(_TABLE_FONT_SIZE + 1, bold=True)

    img = Image.new("RGB", (total_w, total_h), "white")
    draw = ImageDraw.Draw(img)

    # ── 标题行 ──
    _SHIFT_LABEL = {"day_shift": "白班", "night_shift": "夜班"}
    shift_label = _SHIFT_LABEL.get(shift_key, shift_key)
    cross_midnight = cross  # 原始班次即跨夜
    title_text = f"{date_str}  {shift_label}"
    if cross_midnight:
        from datetime import datetime as _dt, timedelta as _td
        next_date = (_dt.strptime(date_str, "%Y-%m-%d") + _td(days=1)).strftime("%Y-%m-%d")
        title_text += f" (跨 {next_date})"
    draw.text((_TABLE_PAD_X, (_TABLE_TITLE_H - _TABLE_FONT_SIZE - 1) // 2),
              title_text, fill=_TABLE_TITLE_FG, font=font_title)
    range_text = f"{_table_min_to_str(t0)} — {_table_min_to_str(t1)}"
    if cross_midnight:
        range_text += " (次日)"
    rtw = draw.textlength(range_text, font=font_small)
    draw.text((total_w - rtw - _TABLE_PAD_X, (_TABLE_TITLE_H - _TABLE_FONT_SMALL) // 2),
              range_text, fill=(140, 148, 160), font=font_small)

    # ── 表头 ──
    header_y = _TABLE_TITLE_H
    draw.rectangle([0, header_y, _TABLE_COL_NAME_W - 1, header_y + _TABLE_HEADER_H - 1],
                   fill=_TABLE_HEADER_BG, outline=_TABLE_GRID_COLOR)
    draw.text((_TABLE_PAD_X, header_y + (_TABLE_HEADER_H - _TABLE_FONT_SIZE) // 2),
              "机器", fill=(255, 255, 255), font=font_bold)
    for i, mins in enumerate(slots):
        x = _TABLE_COL_NAME_W + i * _TABLE_COL_SLOT_W
        label = _table_min_to_label(mins, t0)
        draw.rectangle([x, header_y, x + _TABLE_COL_SLOT_W - 1, header_y + _TABLE_HEADER_H - 1],
                       fill=_TABLE_HEADER_BG, outline=_TABLE_GRID_COLOR)
        tw = draw.textlength(label, font=font_small)
        draw.text((x + (_TABLE_COL_SLOT_W - tw) // 2,
                   header_y + (_TABLE_HEADER_H - _TABLE_FONT_SMALL) // 2),
                  label, fill=_TABLE_HEADER_FG, font=font_small)

    # ── 数据行 ──
    fallback_palette = [(91, 141, 239), (78, 203, 113), (240, 160, 48),
                        (139, 108, 224), (232, 84, 84), (52, 201, 212)]

    def _task_top_label(task, max_chars):
        """任务格上层文字：任务名(机型)[P1][困难] — 与时间轴 task-label 一致"""
        base = task["name"]
        if not compact:
            if task["type"]:
                base += "(" + task["type"] + ")"
            if pri_enabled and task["priority"]:
                base += "[" + task["priority"] + "]"
            if task["difficulty"]:
                base += "[" + task["difficulty"] + "]"
        return _table_truncate(base, max(1, max_chars))

    def _task_time_label(task):
        """任务格下层文字：08:30-10:00 — 与时间轴 task-time 一致"""
        return _table_min_to_str(task["start"]) + "-" + _table_min_to_str(task["end"])

    def _task_fill(task, mdata=None):
        st = task["status"]
        # 1. 已完成最高优先级（时间轴 .task-completed !important）
        if st == "completed":
            return (_table_hex_to_rgb(state_colors["completed"]), _TABLE_TASK_FG)
        # 2. 不兼容：任务类型/种类与机器不匹配（时间轴 .task-incompatible !important）
        if mdata:
            mtype = mdata.get("type", "")
            mkind = mdata.get("kind", "")
            ttype = task.get("type", "")
            tkind = task.get("kind", "")
            type_bad = bool(mtype and ttype and ttype != mtype)
            kind_bad = bool(mkind and tkind and tkind != mkind)
            if type_bad or kind_bad:
                return ((239, 68, 68), _TABLE_TASK_FG)  # #ef4444
        # 3. 维修停用机器：非已完成任务才着色
        if mdata and mdata.get("has_repair", False):
            if st == "暂停中":
                return (_table_hex_to_rgb(state_colors["paused"]), _TABLE_TASK_FG)
            else:
                return (_table_hex_to_rgb(state_colors["post_pause"]), _TABLE_TASK_FG)
        # 4. 切割任务
        if task["is_split"]:
            return (_table_hex_to_rgb(state_colors["split"]), _TABLE_TASK_FG)
        return (None, None)

    # 收集维修覆盖层矩形（非维修停用机器上的 repair_log 时段）
    _repair_overlay_rects = []

    for row_idx, m in enumerate(machines):
        row_y = _TABLE_TITLE_H + _TABLE_HEADER_H + row_idx * _TABLE_ROW_H
        mdata = machine_map.get(m["id"], {"name": m["name"], "tasks": [], "has_repair": False})
        has_repair = mdata.get("has_repair", False)
        border_color = repair_border_rgb if has_repair else _TABLE_GRID_COLOR

        color_hex = type_colors.get(m["type"] or "")
        default_rgb = _table_hex_to_rgb(color_hex) if color_hex else fallback_palette[row_idx % len(fallback_palette)]

        tasks = mdata["tasks"]

        # ── slot 底色（段叠加层：work/ot/break）──
        def _slot_bg_for(mins, base_bg):
            if _slot_in_segments(mins, ot_segments):
                return _blend_tint(base_bg, _SEG_OT_TINT)
            if _slot_in_segments(mins, break_segments):
                return _blend_tint(base_bg, _SEG_BREAK_TINT)
            if work_start <= mins < work_end:
                return _blend_tint(base_bg, _SEG_WORK_TINT)
            return base_bg

        base_slot_bg = _table_hex_to_rgb(state_colors["repair_bg"]) if has_repair else _TABLE_EMPTY_BG

        if not tasks:
            # 空闲行：按段分别画矩形
            all_points = sorted(set(
                [work_start] + [s for seg in ot_segments + break_segments for s in seg] + [work_end]
            ))
            all_points = [p for p in all_points if work_start <= p <= t1]
            for pi in range(len(all_points) - 1):
                seg_s, seg_e = all_points[pi], all_points[pi + 1]
                if seg_e <= seg_s:
                    continue
                sx = _TABLE_COL_NAME_W + int((seg_s - t0) / 30.0 * _TABLE_COL_SLOT_W)
                ex = _TABLE_COL_NAME_W + int((seg_e - t0) / 30.0 * _TABLE_COL_SLOT_W)
                seg_mid = (seg_s + seg_e) // 2
                seg_bg = _slot_bg_for(seg_mid, base_slot_bg)
                draw.rectangle([sx, row_y, ex - 1, row_y + _TABLE_ROW_H - 1],
                               fill=seg_bg, outline=border_color)
            idle = "维修中" if has_repair else "空闲"
            tw = draw.textlength(idle, font=font_small)
            draw.text((_TABLE_COL_NAME_W + (total_w - _TABLE_COL_NAME_W - tw) // 2,
                       row_y + (_TABLE_ROW_H - _TABLE_FONT_SMALL) // 2),
                      idle, fill=(180, 50, 50) if has_repair else _TABLE_EMPTY_FG, font=font_small)
        else:
            for i in range(n_slots):
                mins = slots[i]
                x = _TABLE_COL_NAME_W + i * _TABLE_COL_SLOT_W
                slot_bg = _slot_bg_for(mins, base_slot_bg)
                draw.rectangle([x, row_y, x + _TABLE_COL_SLOT_W - 1, row_y + _TABLE_ROW_H - 1],
                               fill=slot_bg, outline=border_color)
            for task in tasks:
                start_x = _TABLE_COL_NAME_W + int((task["start"] - t0) / 30.0 * _TABLE_COL_SLOT_W)
                span_slots = (task["end"] - task["start"]) / 30.0
                task_w = int(span_slots * _TABLE_COL_SLOT_W)

                fill_rgb, text_rgb = _task_fill(task, mdata)
                if fill_rgb is None:
                    fill_rgb = default_rgb
                    text_rgb = _TABLE_TASK_FG

                draw.rectangle(
                    [start_x, row_y, start_x + task_w - 1, row_y + _TABLE_ROW_H - 1],
                    fill=fill_rgb, outline=border_color
                )

                # ── 维修覆盖层：非维修停用机器，任务与 repair_log 重叠时叠加红色半透明层 ──
                if not has_repair:
                    rps = repair_logs.get(m["id"], [])
                    for rp in rps:
                        o_s = max(task["start"], rp["abs_start"])
                        o_e = rp["abs_end"] if rp["abs_end"] is not None else task["end"]
                        o_e = min(task["end"], o_e)
                        if o_e > o_s:
                            ox = start_x + int((o_s - task["start"]) / (task["end"] - task["start"]) * task_w)
                            ow = int((o_e - o_s) / (task["end"] - task["start"]) * task_w)
                            if ow > 0:
                                _repair_overlay_rects.append((
                                    ox, row_y,
                                    ox + ow - 1, row_y + _TABLE_ROW_H - 1,
                                ))

                # 三层文字：包名(可选) → 任务信息 → 时间
                pkg_h = 0
                if show_pkg and task["package_name"]:
                    pkg_h = _TABLE_FONT_SMALL - 1
                top_h = _TABLE_FONT_SMALL + 2
                time_h = _TABLE_FONT_SMALL - 1
                total_text_h = pkg_h + top_h + time_h + (1 if pkg_h else 0)
                text_base_y = row_y + (_TABLE_ROW_H - total_text_h) // 2

                # 第一行：包名
                if show_pkg and task["package_name"]:
                    pkg_max = max(1, (task_w - 4) // ((_TABLE_FONT_SMALL - 2) // 2))
                    pkg_label = _table_truncate(task["package_name"], pkg_max)
                    ptw = draw.textlength(pkg_label, font=font_tiny)
                    if ptw < task_w - 4:
                        draw.text((start_x + (task_w - ptw) // 2, text_base_y),
                                  pkg_label, fill=(140, 148, 160), font=font_tiny)

                # 第二行：任务名(机型)[P1][困难]
                top_max = max(1, (task_w - _TABLE_PAD_X * 2) // (_TABLE_FONT_SMALL // 2))
                top_label = _task_top_label(task, top_max)
                top_y = text_base_y + pkg_h + (1 if pkg_h else 0)
                top_tw = draw.textlength(top_label, font=font_small)
                if top_tw < task_w - _TABLE_PAD_X * 2:
                    draw.text((start_x + (task_w - top_tw) // 2, top_y),
                              top_label, fill=text_rgb, font=font_small)

                # 第三行：时间
                time_label = _task_time_label(task)
                time_y = top_y + top_h + 1
                time_tw = draw.textlength(time_label, font=font_tiny)
                if time_tw < task_w - _TABLE_PAD_X * 2:
                    tr, tg, tb = text_rgb
                    time_fill = (tr + (255 - tr) // 3, tg + (255 - tg) // 3, tb + (255 - tb) // 3)
                    draw.text((start_x + (task_w - time_tw) // 2, time_y),
                              time_label, fill=time_fill, font=font_tiny)

        # ── 后画机器名列（上层）──
        name_bw = 4 if has_repair else 1
        _draw_rect(draw, [0, row_y, _TABLE_COL_NAME_W - 1, row_y + _TABLE_ROW_H - 1],
                   fill=_TABLE_MACHINE_BG, outline=border_color, width=name_bw)
        mname = _table_truncate(m["name"], 10)
        mtype = m["type"] or ""
        draw.text((_TABLE_PAD_X, row_y + 4), mname, fill=_TABLE_MACHINE_FG, font=font_name)
        if mtype:
            draw.text((_TABLE_PAD_X, row_y + 4 + _TABLE_FONT_SMALL + 3),
                      mtype, fill=(140, 148, 160), font=font_small)

    # ── 底表头 ──
    footer_y = _TABLE_TITLE_H + _TABLE_HEADER_H + len(machines) * _TABLE_ROW_H
    draw.rectangle([0, footer_y, _TABLE_COL_NAME_W - 1, footer_y + _TABLE_HEADER_H - 1],
                   fill=_TABLE_HEADER_BG, outline=_TABLE_GRID_COLOR)
    draw.text((_TABLE_PAD_X, footer_y + (_TABLE_HEADER_H - _TABLE_FONT_SIZE) // 2),
              "机器", fill=(255, 255, 255), font=font_bold)
    for i, mins in enumerate(slots):
        x = _TABLE_COL_NAME_W + i * _TABLE_COL_SLOT_W
        label = _table_min_to_label(mins, t0)
        draw.rectangle([x, footer_y, x + _TABLE_COL_SLOT_W - 1, footer_y + _TABLE_HEADER_H - 1],
                       fill=_TABLE_HEADER_BG, outline=_TABLE_GRID_COLOR)
        tw = draw.textlength(label, font=font_small)
        draw.text((x + (_TABLE_COL_SLOT_W - tw) // 2,
                   footer_y + (_TABLE_HEADER_H - _TABLE_FONT_SMALL) // 2),
                  label, fill=_TABLE_HEADER_FG, font=font_small)

    # ── 维修覆盖层合成 ──
    if _repair_overlay_rects:
        overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
        odraw = ImageDraw.Draw(overlay)
        repair_overlay_rgba = (219, 39, 119, int(255 * 0.4))
        for rx0, ry0, rx1, ry1 in _repair_overlay_rects:
            odraw.rectangle([rx0, ry0, rx1, ry1], fill=repair_overlay_rgba)
        img_rgba = img.convert("RGBA")
        img = Image.alpha_composite(img_rgba, overlay).convert("RGB")

    buf = _io.BytesIO()
    img.save(buf, "PNG")
    buf.seek(0)
    return buf.getvalue()


@bp.route("/api/summary/table-screenshot")
def api_table_screenshot():
    """表格截图 HTTP 端点，返回 PNG 图片"""
    import json as _json, flask as _flask, io as _io
    date_str = request.args.get("date") or ""
    shift_arg = request.args.get("shift") or "白班"
    SHIFT_MAP = {"白班": "day_shift", "夜班": "night_shift"}
    shift_key = SHIFT_MAP.get(shift_arg, shift_arg)
    if not date_str:
        return jsonify({"error": "date required"}), 400
    try:
        png_bytes = generate_table_image(date_str, shift_key)
        return _flask.send_file(_io.BytesIO(png_bytes), mimetype="image/png")
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
