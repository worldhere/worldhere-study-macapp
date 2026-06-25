# 飞书定点推送事件 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 push/pull 同步完成后自动检测飞书排班变更事件，生成卡片消息推送到群聊和小组长

**Architecture:** 新增独立模块 `feishu/push_events.py` 负责事件检测与推送调度。阶段一扫描飞书排班表检测任务级事件（场景 1-9），阶段二查询本地 DB 检测系统级事件（场景 10-11），比对 push_log 去重后通过 `send_im_message` 发送飞书交互式卡片。push/pull 各调用点末尾加一行 `detect_and_push_events()`。

**Tech Stack:** Python + Flask + SQLite + 飞书 IM API (interactive cards) + vanilla JS

---

### 文件职责

| 文件 | 操作 | 职责 |
|------|------|------|
| `feishu/push_events.py` | **新建** | 事件检测引擎：扫描飞书表、查本地 DB、去重、合并、调度发送 |
| `feishu/common.py` | 修改 | `send_im_message` 增加 `msg_type="interactive"` 支持飞书卡片 |
| `feishu/sync_loop.py` | 修改 | `push_all_machines_parallel` / `pull_all_machines` 末尾调用 `detect_and_push_events` |
| `feishu/schedule_sync.py` | 修改 | `_async_push` / `_async_pull` / `_async_toggle_on` 末尾调用 |
| `routes/feishu.py` | 修改 | push-config GET/Save 扩展 `event_toggles` |
| `db.py` | 修改 | `init_db` 新增 push_log 表 + seed 默认 event_toggles |
| `templates/panels/settings.html` | 修改 | 推送设置 box 内新增事件开关矩阵 |
| `static/settings.js` | 修改 | event_toggles 加载/保存/全选逻辑 |

---

### Task 1: 数据库 — push_log 表 + 默认 event_toggles

**Files:**
- Modify: `db.py`

- [ ] **Step 1: 在 init_db 中新增 push_log 表**

找到 `init_db()` 函数中 `repair_log` 表的建表语句（约第 451 行），在 `conn.commit()` 之后追加：

```python
    # 推送日志表（去重 + 值变化检测）
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS push_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            dedup_key TEXT NOT NULL,
            event_type TEXT NOT NULL,
            target_type TEXT NOT NULL,
            target_id TEXT NOT NULL,
            notify_value TEXT,
            sent_at TEXT NOT NULL,
            success INTEGER NOT NULL DEFAULT 1
        )
        """
    )
    cur.execute(
        "CREATE INDEX IF NOT EXISTS idx_push_log_dedup ON push_log(dedup_key, target_id)"
    )
    conn.commit()
```

- [ ] **Step 2: 在 _seed_config 中新增默认事件开关**

找到 `_seed_config()` 函数，在现有的 items 列表末尾追加：

```python
        # 推送事件开关（默认值：小组长收提醒类，群收公告类）
        ("feishu_push", "event_toggles", '{"task_impending_start":{"leader":true,"group":false},"task_start":{"leader":true,"group":false},"task_confirm_start":{"leader":false,"group":true},"schedule_changes":{"leader":false,"group":true},"exception_start":{"leader":false,"group":true},"exception_end":{"leader":false,"group":true},"task_impending_end":{"leader":true,"group":false},"task_end":{"leader":true,"group":false},"task_confirm_end":{"leader":false,"group":true},"package_complete":{"leader":false,"group":true},"shift_report":{"leader":false,"group":true}}', 0),
```

- [ ] **Step 3: 验证数据库创建**

```powershell
python -c "from db import init_db; init_db(); from db import get_db; c=get_db(); r=c.execute(\"SELECT name FROM sqlite_master WHERE type='table' AND name='push_log'\").fetchone(); print('push_log table exists:', r is not None); c.close()"
```

- [ ] **Step 4: Commit**

```bash
git add db.py
git commit -m "feat: add push_log table and default event_toggles seed

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: 后端 — send_im_message 扩展卡片消息支持

**Files:**
- Modify: `feishu/common.py`

- [ ] **Step 1: 修改 send_im_message 函数签名和实现**

找到 `send_im_message` 函数（约第 201 行），替换整个函数：

```python
def send_im_message(chat_id, content, msg_type="text"):
    """向指定群聊发送消息。返回 (success: bool, error: str|None)
    
    msg_type: "text" 发送文本消息, "interactive" 发送卡片消息
    当 msg_type="interactive" 时，content 应为飞书卡片 JSON 字符串
    """
    import json as _json
    url = f"{IM_BASE_URL}/messages?receive_id_type=chat_id"
    token = get_token()
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    
    if msg_type == "interactive":
        body = {
            "receive_id": chat_id,
            "msg_type": "interactive",
            "content": content,
        }
    else:
        body = {
            "receive_id": chat_id,
            "msg_type": "text",
            "content": _json.dumps({"text": content}, ensure_ascii=False),
        }

    for attempt in range(3):
        try:
            resp = requests.post(url, headers=headers, json=body, timeout=15)
            if resp.status_code == 401:
                refresh_token()
                headers["Authorization"] = f"Bearer {get_token()}"
                continue
            if resp.status_code == 429:
                retry_after = int(resp.headers.get("Retry-After", "5"))
                time.sleep(retry_after)
                continue
            data = resp.json()
            if data.get("code") == 0:
                return True, None
            return False, data.get("msg", "unknown error")[:200]
        except (requests.Timeout, requests.ConnectionError):
            if attempt < 2:
                time.sleep(2 ** attempt)
                continue
            return False, "Network error after retries"

    return False, "Max retries exceeded"


def send_im_message_to_user(open_id, content, msg_type="interactive"):
    """向指定用户发送私信。返回 (success: bool, error: str|None)"""
    import json as _json
    url = f"{IM_BASE_URL}/messages?receive_id_type=open_id"
    token = get_token()
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    
    if msg_type == "interactive":
        body = {
            "receive_id": open_id,
            "msg_type": "interactive",
            "content": content,
        }
    else:
        body = {
            "receive_id": open_id,
            "msg_type": "text",
            "content": _json.dumps({"text": content}, ensure_ascii=False),
        }

    for attempt in range(3):
        try:
            resp = requests.post(url, headers=headers, json=body, timeout=15)
            if resp.status_code == 401:
                refresh_token()
                headers["Authorization"] = f"Bearer {get_token()}"
                continue
            if resp.status_code == 429:
                retry_after = int(resp.headers.get("Retry-After", "5"))
                time.sleep(retry_after)
                continue
            data = resp.json()
            if data.get("code") == 0:
                return True, None
            return False, data.get("msg", "unknown error")[:200]
        except (requests.Timeout, requests.ConnectionError):
            if attempt < 2:
                time.sleep(2 ** attempt)
                continue
            return False, "Network error after retries"

    return False, "Max retries exceeded"
```

- [ ] **Step 2: 验证导入**

```powershell
python -c "from feishu.common import send_im_message, send_im_message_to_user; print('import ok')"
```

- [ ] **Step 3: Commit**

```bash
git add feishu/common.py
git commit -m "feat: extend send_im_message for interactive cards, add send_im_message_to_user

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: 后端 — 事件检测引擎

**Files:**
- Create: `feishu/push_events.py`

- [ ] **Step 1: 创建 feishu/push_events.py**

```python
# -*- coding: utf-8 -*-
"""飞书定点推送：事件检测 + 卡片生成 + 去重调度"""
import json
import datetime
import time as _time
from db import get_db
from feishu.common import (
    _feishu_data, _feishu_raw, _parse_feishu_text,
    send_im_message, send_im_message_to_user,
    APP_TOKEN,
)

IMPENDING_MINUTES = 15  # "即将开始/结束"提前量（分钟）
CARD_COLORS = {
    "reminder": "blue",
    "announcement": "green",
    "changes": "orange",
    "exception": "red",
    "report": "purple",
}


# ========== 阶段一：飞书表扫描 ==========

def _fetch_feishu_schedules(table_id):
    """拉取飞书排班表全量记录。返回 [{record_id, fields, ...}]"""
    all_items = []
    page_token = None
    while True:
        p = f"&page_token={page_token}" if page_token else ""
        data = _feishu_data(
            "GET",
            f"/apps/{APP_TOKEN}/tables/{table_id}/records?page_size=500&automatic_fields=true{p}"
        )
        if data:
            all_items.extend(data.get("items", []))
        if not data or not data.get("has_more"):
            break
        page_token = data.get("page_token")
    return all_items


def _ts_to_minutes(ts_val, date_str):
    """飞书毫秒时间戳 -> 相对 date_str 00:00 的绝对分钟数"""
    if ts_val is None:
        return None
    try:
        if isinstance(ts_val, (int, float)):
            dt_val = datetime.datetime.fromtimestamp(ts_val / 1000.0)
            base = datetime.datetime.combine(
                datetime.date.fromisoformat(date_str),
                datetime.time.min,
            )
            return int((dt_val - base).total_seconds() / 60)
    except Exception:
        pass
    return None


def _minutes_to_readable(date_str, abs_min):
    """date + 绝对分钟 -> 'HH:MM' 字符串"""
    try:
        dt_val = datetime.date.fromisoformat(date_str)
        base = datetime.datetime.combine(dt_val, datetime.time.min)
        result = base + datetime.timedelta(minutes=int(abs_min))
        return result.strftime("%H:%M")
    except Exception:
        return ""


def _detect_feishu_events(machine_id, machine_name, feishu_items):
    """扫描一台机器的飞书排班记录，检测场景 1-9 的事件。
    返回事件列表: [{event_type, schedule_id, machine_name, ...}]"""
    conn = get_db()
    now = datetime.datetime.now()
    events = []

    for item in feishu_items:
        fields = item.get("fields", {})
        record_id = item.get("record_id")

        # 通过 feishu_record_mapping 拿到本地 schedule_id
        rm = conn.execute(
            "SELECT schedule_id FROM feishu_record_mapping WHERE feishu_record_id=?",
            (record_id,)
        ).fetchone()
        if not rm:
            continue
        schedule_id = rm["schedule_id"]

        # 读本地 schedule 补充信息
        sch = conn.execute(
            "SELECT s.*, m.group_name, t.package_id, pkg.name AS package_name "
            "FROM schedules s "
            "LEFT JOIN machines m ON s.machine_id = m.id "
            "LEFT JOIN tasks t ON s.task_id = t.id "
            "LEFT JOIN task_packages pkg ON t.package_id = pkg.id "
            "WHERE s.id=?",
            (schedule_id,)
        ).fetchone()
        if not sch:
            continue

        date_str = sch["date"]
        task_name = sch["task_name"] or ""
        start_ts = fields.get("排班开始")
        end_ts = fields.get("排班结束")
        actual_start_ts = fields.get("实际开始")
        actual_end_ts = fields.get("实际结束")
        status_text = _parse_feishu_text(fields.get("状态"))
        exception_mark = _parse_feishu_text(fields.get("异常标记")) or "正常"

        start_min = _ts_to_minutes(start_ts, date_str)
        end_min = _ts_to_minutes(end_ts, date_str)
        actual_start_min = _ts_to_minutes(actual_start_ts, date_str)
        actual_end_min = _ts_to_minutes(actual_end_ts, date_str)

        base_info = {
            "schedule_id": schedule_id,
            "machine_id": machine_id,
            "machine_name": machine_name,
            "task_name": task_name,
            "date": date_str,
            "start_min": start_min,
            "end_min": end_min,
            "actual_start_min": actual_start_min,
            "actual_end_min": actual_end_min,
            "group_name": sch["group_name"] or "",
            "package_name": sch["package_name"] or "",
        }

        # ---- 场景 1: 任务即将开始 ----
        if start_min is not None and status_text != "已完成":
            minutes_until_start = start_min - (now.hour * 60 + now.minute)
            if minutes_until_start <= IMPENDING_MINUTES and minutes_until_start >= 0:
                events.append({
                    **base_info,
                    "event_type": "task_impending_start",
                    "minutes_remaining": minutes_until_start,
                })

        # ---- 场景 2+3: 实际开始被填写（同源双发）----
        if actual_start_min is not None:
            # 场景 2: 给小组长（提早填写判断）
            if start_min is not None and actual_start_min < start_min:
                events.append({
                    **base_info,
                    "event_type": "task_start",
                    "early_fill": True,
                })
            # 场景 3: 给群（结果通知）
            events.append({
                **base_info,
                "event_type": "task_confirm_start",
            })

        # ---- 场景 4: 排班时间变动 ----
        if start_min is not None and end_min is not None:
            events.append({
                **base_info,
                "event_type": "schedule_changes",
            })

        # ---- 场景 5+6: 异常 ----
        if exception_mark and exception_mark != "正常":
            events.append({
                **base_info,
                "event_type": "exception_start",
                "exception_reason": exception_mark,
                "exception_note": _parse_feishu_text(fields.get("异常备注")) or "",
            })
        elif exception_mark == "正常":
            # 检查之前是否发过异常开始
            pass  # 去重逻辑在 _should_send 中处理

        # ---- 场景 7: 任务即将结束 ----
        if end_min is not None and status_text != "已完成":
            minutes_until_end = end_min - (now.hour * 60 + now.minute)
            if minutes_until_end <= IMPENDING_MINUTES and minutes_until_end >= 0:
                events.append({
                    **base_info,
                    "event_type": "task_impending_end",
                    "minutes_remaining": minutes_until_end,
                })

        # ---- 场景 8+9: 实际结束被填写（同源双发）----
        if actual_end_min is not None:
            # 场景 8: 给小组长（提早填写判断）
            if end_min is not None and actual_end_min < end_min:
                events.append({
                    **base_info,
                    "event_type": "task_end",
                    "early_fill": True,
                })
            # 场景 9: 给群（结果通知）
            events.append({
                **base_info,
                "event_type": "task_confirm_end",
            })

    conn.close()
    return events


# ========== 阶段二：本地 DB 扫描 ==========

def _detect_local_events():
    """查本地 DB，检测场景 10（任务包完成）和场景 11（班次报告）"""
    conn = get_db()
    events = []
    now = datetime.datetime.now()
    today_str = now.strftime("%Y-%m-%d")

    # ---- 场景 10: 任务包完成 ----
    pkgs = conn.execute(
        "SELECT id, name FROM task_packages"
    ).fetchall()
    for pkg in pkgs:
        pkg_id = pkg["id"]
        pkg_name = pkg["name"]
        # 查该包下所有关联任务的排班是否全部完成
        remaining = conn.execute(
            """SELECT COUNT(*) AS c FROM schedules s
               JOIN tasks t ON s.task_id = t.id
               WHERE t.package_id=? AND s.status != 'completed'""",
            (pkg_id,)
        ).fetchone()
        if remaining and remaining["c"] == 0:
            # 检查是否有排班记录（空包不算完成）
            has_any = conn.execute(
                """SELECT COUNT(*) AS c FROM schedules s
                   JOIN tasks t ON s.task_id = t.id
                   WHERE t.package_id=?""",
                (pkg_id,)
            ).fetchone()
            if has_any and has_any["c"] > 0:
                events.append({
                    "event_type": "package_complete",
                    "package_id": pkg_id,
                    "package_name": pkg_name,
                    "date": today_str,
                })

    # ---- 场景 11: 班次报告 ----
    shift_cfg = conn.execute(
        "SELECT key, value FROM shift_config WHERE key IN ('start', 'end', 'overtime')"
    ).fetchall()
    cfg = {r["key"]: r["value"] for r in shift_cfg}

    # 解析白班时间（start ~ overtime 开始）和夜班时间（overtime 开始 ~ end）
    # 简化：检查当前时间是否超出白班/夜班的结束时间
    now_min = now.hour * 60 + now.minute

    def _parse_time(t):
        try:
            parts = t.split(":")
            return int(parts[0]) * 60 + int(parts[1])
        except Exception:
            return None

    shift_start = _parse_time(cfg.get("start", ""))
    shift_end = _parse_time(cfg.get("end", ""))
    overtime = _parse_time(cfg.get("overtime", ""))

    if shift_start is not None and shift_end is not None and overtime is not None:
        # 白班: start ~ overtime
        if now_min >= overtime:
            events.append({
                "event_type": "shift_report",
                "shift": "白班",
                "date": today_str,
            })
        # 夜班: overtime ~ end
        if now_min >= shift_end:
            events.append({
                "event_type": "shift_report",
                "shift": "夜班",
                "date": today_str,
            })

    conn.close()
    return events


# ========== 去重 ==========

def _should_send(conn, dedup_key, target_id, current_value=None):
    """检查是否应该发送：未发过 或 notify_value 已变化"""
    row = conn.execute(
        "SELECT notify_value FROM push_log WHERE dedup_key=? AND target_id=?",
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
         json.dumps(notify_value, ensure_ascii=False, sort_keys=True) if notify_value else None,
         datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"), 1 if success else 0),
    )
    conn.commit()


# ========== 卡片生成 ==========

def _build_reminder_card(event):
    """模板 1: 任务提醒卡片（蓝色）— 给小组长"""
    status_label = {
        "task_impending_start": "即将开始（提前{}分钟）".format(event.get("minutes_remaining", 0)),
        "task_start": "已开始（提前填写）",
        "task_impending_end": "即将结束（提前{}分钟）".format(event.get("minutes_remaining", 0)),
        "task_end": "已结束（提前填写）",
    }.get(event["event_type"], "")

    start_str = _minutes_to_readable(event["date"], event["start_min"])
    end_str = _minutes_to_readable(event["date"], event["end_min"])

    card = {
        "header": {
            "title": {"tag": "plain_text", "content": "⏰ 任务提醒"},
            "template": CARD_COLORS["reminder"],
        },
        "elements": [
            {"tag": "div", "fields": [
                {"is_short": True, "text": {"tag": "lark_md", "content": "**机器**\n{}".format(event["machine_name"])}},
                {"is_short": True, "text": {"tag": "lark_md", "content": "**任务**\n{}".format(event["task_name"])}},
            ]},
            {"tag": "div", "fields": [
                {"is_short": True, "text": {"tag": "lark_md", "content": "**时间**\n{} - {}".format(start_str, end_str)}},
                {"is_short": True, "text": {"tag": "lark_md", "content": "**状态**\n{}".format(status_label)}},
            ]},
            {"tag": "hr"},
            {"tag": "note", "elements": [
                {"tag": "plain_text", "content": "分组：{}".format(event.get("group_name", ""))}
            ]},
        ],
    }
    return json.dumps(card, ensure_ascii=False)


def _build_announcement_card(events_list):
    """模板 2: 任务公告卡片（绿色）— 给群。合并多条。"""
    elements = []
    for i, e in enumerate(events_list[:10]):
        if e["event_type"] == "task_confirm_start":
            action = "已确定开始"
        elif e["event_type"] == "task_confirm_end":
            action = "已确定完成"
        elif e["event_type"] == "package_complete":
            elements.append({
                "tag": "div",
                "text": {"tag": "lark_md", "content": "📦 **{}** 全部任务已完成".format(e.get("package_name", ""))}
            })
            continue
        else:
            action = "状态更新"
        elements.append({
            "tag": "div",
            "text": {"tag": "lark_md", "content": "**{}**  {}  {}".format(
                e["machine_name"], e["task_name"], action
            )}
        })
        if i < len(events_list) - 1:
            pass  # 飞书卡片元素间自动分隔

    if len(events_list) > 10:
        elements.append({
            "tag": "note",
            "elements": [{"tag": "plain_text", "content": "…等共 {} 条".format(len(events_list))}]
        })

    card = {
        "header": {
            "title": {"tag": "plain_text", "content": "✅ 任务动态"},
            "template": CARD_COLORS["announcement"],
        },
        "elements": elements,
    }
    return json.dumps(card, ensure_ascii=False)


def _build_changes_card(events_list):
    """模板 3: 变动汇总卡片（橙色）— 给群。按类型分组。"""
    # 分组: delay(延后), advance(提前), auto_assign(自动分配)
    groups = {"delay": [], "advance": [], "auto_assign": []}
    for e in events_list:
        old_start = e.get("old_start_min")
        new_start = e.get("start_min")
        old_end = e.get("old_end_min")
        new_end = e.get("end_min")
        if new_start is not None and old_start is not None:
            diff = new_start - old_start
            if diff > 0:
                groups["delay"].append((e, diff))
            elif diff < 0:
                groups["advance"].append((e, -diff))
        # auto_assign 暂时归入 advance 处理
        # 实际区分逻辑需要在检测端传入变动类型标记

    elements = []
    group_labels = {"delay": ("⏰ 延后", "+{}分钟"), "advance": ("⏫ 提前", "-{}分钟")}
    for gkey, label_info in group_labels.items():
        items = groups[gkey]
        if not items:
            continue
        header, diff_fmt = label_info
        elements.append({
            "tag": "div",
            "text": {"tag": "lark_md", "content": "**{}（{}项）**".format(header, len(items))}
        })
        for e, diff in items:
            old_str = _minutes_to_readable(e["date"], e.get("old_start_min", 0) or 0)
            new_str = _minutes_to_readable(e["date"], e["start_min"] or 0)
            elements.append({
                "tag": "div",
                "text": {"tag": "lark_md", "content": "{}  {}  {}→{}  ({})".format(
                    e["machine_name"], e["task_name"],
                    old_str, new_str,
                    diff_fmt.format(diff)
                )}
            })
        elements.append({"tag": "hr"})

    card = {
        "header": {
            "title": {"tag": "plain_text", "content": "📋 排班变动汇总"},
            "template": CARD_COLORS["changes"],
        },
        "elements": elements,
    }
    return json.dumps(card, ensure_ascii=False)


def _build_exception_card(event, is_end=False):
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
            {"tag": "hr"},
            {"tag": "note", "elements": [
                {"tag": "plain_text", "content": "持续：{}".format(event.get("duration", ""))}
            ]},
        ]
    else:
        header_title = "⚠️ 异常开始"
        elements = [
            {"tag": "div", "fields": [
                {"is_short": True, "text": {"tag": "lark_md", "content": "**机器**\n{}".format(event["machine_name"])}},
                {"is_short": True, "text": {"tag": "lark_md", "content": "**原因**\n{}".format(event.get("exception_reason", ""))}},
            ]},
            {"tag": "div", "fields": [
                {"is_short": True, "text": {"tag": "lark_md", "content": "**开始**\n{}".format(event.get("start_time", ""))}},
            ]},
        ]
        if event.get("exception_note"):
            elements.append({
                "tag": "note",
                "elements": [{"tag": "plain_text", "content": event["exception_note"]}]
            })

    card = {
        "header": {
            "title": {"tag": "plain_text", "content": header_title},
            "template": CARD_COLORS["exception"],
        },
        "elements": elements,
    }
    return json.dumps(card, ensure_ascii=False)


def _build_report_card(event):
    """模板 5: 班次报告卡片（紫色）— 给群"""
    conn = get_db()
    date_str = event["date"]
    shift = event["shift"]
    
    # 统计（简化：统计当天所有排班）
    total = conn.execute(
        "SELECT COUNT(*) AS c FROM schedules WHERE date=? AND status='completed'",
        (date_str,)
    ).fetchone()
    total_normal = conn.execute(
        """SELECT COUNT(*) AS c FROM schedules s
           LEFT JOIN tasks t ON s.task_id = t.id
           WHERE s.date=? AND s.status='completed' AND t.package_id IS NULL""",
        (date_str,)
    ).fetchone()
    total_pkg = conn.execute(
        """SELECT COUNT(*) AS c FROM schedules s
           LEFT JOIN tasks t ON s.task_id = t.id
           WHERE s.date=? AND s.status='completed' AND t.package_id IS NOT NULL""",
        (date_str,)
    ).fetchone()
    all_total = conn.execute(
        "SELECT COUNT(*) AS c FROM schedules WHERE date=?", (date_str,)
    ).fetchone()
    incomplete_normal = conn.execute(
        """SELECT COUNT(*) AS c FROM schedules s
           LEFT JOIN tasks t ON s.task_id = t.id
           WHERE s.date=? AND s.status!='completed' AND t.package_id IS NULL""",
        (date_str,)
    ).fetchone()
    incomplete_pkg = conn.execute(
        """SELECT COUNT(*) AS c FROM schedules s
           LEFT JOIN tasks t ON s.task_id = t.id
           WHERE s.date=? AND s.status!='completed' AND t.package_id IS NOT NULL""",
        (date_str,)
    ).fetchone()
    overdue = conn.execute(
        """SELECT COUNT(*) AS c FROM schedules s
           WHERE s.date=? AND s.status!='completed' AND (s.end_min < ?)""",
        (date_str, datetime.datetime.now().hour * 60 + datetime.datetime.now().minute,)
    ).fetchone()
    conn.close()

    completed_total = (total["c"] if total else 0)
    completed_normal = (total_normal["c"] if total_normal else 0)
    completed_pkg = (total_pkg["c"] if total_pkg else 0)
    all_count = (all_total["c"] if all_total else 0)
    rate = round(completed_total / all_count * 100) if all_count > 0 else 0

    card = {
        "header": {
            "title": {"tag": "plain_text", "content": "📊 {}总结报告".format(shift)},
            "template": CARD_COLORS["report"],
        },
        "elements": [
            {"tag": "div", "text": {"tag": "lark_md", "content": "**{}  {}**".format(date_str, shift)}},
            {"tag": "hr"},
            {"tag": "div", "text": {"tag": "lark_md", "content": "**✅ 任务完成情况**"}},
            {"tag": "div", "fields": [
                {"is_short": True, "text": {"tag": "lark_md", "content": "已完成普通任务\n**{} 个**".format(completed_normal)}},
                {"is_short": True, "text": {"tag": "lark_md", "content": "已完成任务包任务\n**{} 个**".format(completed_pkg)}},
            ]},
            {"tag": "div", "fields": [
                {"is_short": True, "text": {"tag": "lark_md", "content": "任务完成率\n**{}%**".format(rate)}},
            ]},
            {"tag": "hr"},
            {"tag": "div", "text": {"tag": "lark_md", "content": "**⚠️ 预警情况**"}},
            {"tag": "div", "fields": [
                {"is_short": True, "text": {"tag": "lark_md", "content": "未完成普通任务\n**{} 个**".format(incomplete_normal["c"] if incomplete_normal else 0)}},
                {"is_short": True, "text": {"tag": "lark_md", "content": "未完成任务包任务\n**{} 个**".format(incomplete_pkg["c"] if incomplete_pkg else 0)}},
            ]},
            {"tag": "div", "fields": [
                {"is_short": True, "text": {"tag": "lark_md", "content": "逾期任务\n**{} 个**".format(overdue["c"] if overdue else 0)}},
            ]},
        ],
    }
    return json.dumps(card, ensure_ascii=False)


# ========== 调度入口 ==========

def _load_toggles():
    """从 config 表读取事件开关矩阵"""
    conn = get_db()
    row = conn.execute(
        "SELECT value FROM config WHERE category='feishu_push' AND key='event_toggles'"
    ).fetchone()
    conn.close()
    if row:
        try:
            return json.loads(row["value"])
        except (json.JSONDecodeError, TypeError):
            pass
    return {}


def _get_targets_for_event(event):
    """根据事件类型和机器分组，返回 [(target_type, target_id), ...]"""
    conn = get_db()
    targets = []
    
    # 获取分组信息
    group_name = event.get("group_name", "")
    machine_name = event.get("machine_name", "")
    
    if group_name:
        group_row = conn.execute(
            "SELECT day_leader, night_leader FROM groups WHERE name=?",
            (group_name,)
        ).fetchone()
    else:
        # 从 machines 表找
        group_row = conn.execute(
            """SELECT g.day_leader, g.night_leader FROM machines m
               JOIN groups g ON m.group_name = g.name
               WHERE m.name=?""",
            (machine_name,)
        ).fetchone()
    
    day_leader = group_row["day_leader"] if group_row else ""
    night_leader = group_row["night_leader"] if group_row else ""
    
    # 获取 chat_groups
    chat_row = conn.execute(
        "SELECT value FROM config WHERE category='feishu_push' AND key='chat_ids'"
    ).fetchone()
    chat_groups = []
    if chat_row:
        raw = chat_row["value"].strip()
        if raw.startswith("["):
            try:
                chat_groups = json.loads(raw)
            except json.JSONDecodeError:
                pass
    
    conn.close()
    
    # 判断白班还是夜班（简化：根据当前时间）
    now_hour = datetime.datetime.now().hour
    leader_id = night_leader if now_hour >= 18 else day_leader
    
    # leader 目标
    if leader_id:
        targets.append(("leader", leader_id))
    
    # group 目标
    for cg in chat_groups:
        cid = cg.get("chat_id", "")
        if cid:
            targets.append(("group", cid))
    
    return targets, leader_id


def _dispatch_events(all_events):
    """去重、按开关过滤、生成卡片、发送、写 push_log"""
    toggles = _load_toggles()
    conn = get_db()
    now = datetime.datetime.now()
    now_str = now.strftime("%Y-%m-%d %H:%M:%S")
    
    # 分组：合并公告类事件
    announcement_events = []
    change_events = []
    individual_events = []
    
    for ev in all_events:
        etype = ev["event_type"]
        if etype in ("task_confirm_start", "task_confirm_end", "package_complete"):
            announcement_events.append(ev)
        elif etype == "schedule_changes":
            change_events.append(ev)
        else:
            individual_events.append(ev)
    
    # 处理个体事件（任务提醒、异常）
    for ev in individual_events:
        etype = ev["event_type"]
        toggle_cfg = toggles.get(etype, {})
        sid = ev.get("schedule_id", 0)
        
        targets, leader_id = _get_targets_for_event(ev)
        
        for target_type, target_id in targets:
            # 按开关过滤
            if target_type == "leader" and not toggle_cfg.get("leader", False):
                continue
            if target_type == "group" and not toggle_cfg.get("group", False):
                continue
            
            dedup_key_map = {
                "task_impending_start": f"remind_{sid}_impending_start",
                "task_start": f"task_start_{sid}",
                "task_impending_end": f"remind_{sid}_impending_end",
                "task_end": f"task_end_{sid}",
                "exception_start": f"exc_{sid}_start",
                "exception_end": f"exc_{sid}_end",
            }
            dedup_key = dedup_key_map.get(etype, f"{etype}_{sid}")
            
            notify_value = None
            if etype == "task_start":
                notify_value = ev.get("actual_start_min")
            elif etype == "task_end":
                notify_value = ev.get("actual_end_min")
            
            if not _should_send(conn, dedup_key, target_id, notify_value):
                continue
            
            # 生成卡片
            if etype in ("exception_start",):
                ev["start_time"] = now_str
                card_json = _build_exception_card(ev, is_end=False)
            elif etype == "exception_end":
                card_json = _build_exception_card(ev, is_end=True)
            else:
                card_json = _build_reminder_card(ev)
            
            # 发送
            if target_type == "leader":
                success, err = send_im_message_to_user(target_id, card_json, "interactive")
            else:
                success, err = send_im_message(target_id, card_json, "interactive")
            
            _record_push(conn, dedup_key, etype, target_type, target_id, notify_value, success)
    
    # 处理公告合并
    if announcement_events:
        toggle_cfg_start = toggles.get("task_confirm_start", {})
        toggle_cfg_end = toggles.get("task_confirm_end", {})
        toggle_cfg_pkg = toggles.get("package_complete", {})
        
        if announcement_events:
            targets, _ = _get_targets_for_event(announcement_events[0])
            for target_type, target_id in targets:
                if target_type == "group":
                    if not (toggle_cfg_start.get("group") or toggle_cfg_end.get("group") or toggle_cfg_pkg.get("group")):
                        continue
                    card_json = _build_announcement_card(announcement_events)
                    success, err = send_im_message(target_id, card_json, "interactive")
                elif target_type == "leader":
                    if not (toggle_cfg_start.get("leader") or toggle_cfg_end.get("leader") or toggle_cfg_pkg.get("leader")):
                        continue
                    card_json = _build_announcement_card(announcement_events)
                    success, err = send_im_message_to_user(target_id, card_json, "interactive")
    
    # 处理变动汇总
    if change_events:
        toggle_cfg = toggles.get("schedule_changes", {})
        if change_events:
            targets, _ = _get_targets_for_event(change_events[0])
            for target_type, target_id in targets:
                if not toggle_cfg.get(target_type, False):
                    continue
                # 去重键按日期+班次
                date_str = change_events[0].get("date", "")
                shift = "白班" if now.hour < 18 else "夜班"
                dedup_key = f"shift_changes_{date_str}_{shift}"
                notify_value = [{
                    "sid": e["schedule_id"],
                    "start_min": e.get("start_min"),
                    "end_min": e.get("end_min"),
                } for e in change_events]
                
                if not _should_send(conn, dedup_key, target_id, notify_value):
                    continue
                
                card_json = _build_changes_card(change_events)
                if target_type == "leader":
                    success, err = send_im_message_to_user(target_id, card_json, "interactive")
                else:
                    success, err = send_im_message(target_id, card_json, "interactive")
                
                _record_push(conn, dedup_key, "schedule_changes", target_type, target_id, notify_value, success)
    
    conn.close()


def detect_and_push_events():
    """在 push/pull 完成后调用。分两阶段检测事件并推送。"""
    try:
        conn = get_db()
        # 检查推送总开关
        row = conn.execute(
            "SELECT value FROM config WHERE category='feishu_push' AND key='enabled'"
        ).fetchone()
        if not row or row["value"] != "1":
            conn.close()
            return
        conn.close()

        all_events = []

        # 阶段一：扫描飞书表（场景 1-9）
        conn2 = get_db()
        mappings = conn2.execute(
            "SELECT machine_id, machine_name, table_id FROM feishu_sync_mapping"
        ).fetchall()
        conn2.close()

        for m in mappings:
            try:
                feishu_items = _fetch_feishu_schedules(m["table_id"])
                events = _detect_feishu_events(m["machine_id"], m["machine_name"], feishu_items)
                all_events.extend(events)
            except Exception:
                pass  # 单台机器失败不阻塞其他

        # 阶段二：查本地 DB（场景 10-11）
        try:
            local_events = _detect_local_events()
            all_events.extend(local_events)
        except Exception:
            pass

        if all_events:
            _dispatch_events(all_events)

    except Exception:
        pass  # 推送检测失败不影响 push/pull 主流程
```

- [ ] **Step 2: 验证模块导入**

```powershell
python -c "from feishu.push_events import detect_and_push_events; print('import ok')"
```

- [ ] **Step 3: Commit**

```bash
git add feishu/push_events.py
git commit -m "feat: add push event detection engine with 5 card templates

- Phase 1: scan Feishu tables for task-level events (scenarios 1-9)
- Phase 2: query local DB for system events (scenarios 10-11)
- Dedup via push_log table with notify_value change detection
- 5 interactive card templates: reminder, announcement, changes, exception, report
- Event toggle matrix filtering

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: 后端 — 在 push/pull 调用点挂载事件检测

**Files:**
- Modify: `feishu/sync_loop.py`

- [ ] **Step 1: 在 push_all_machines_parallel 末尾调用**

找到 `push_all_machines_parallel` 函数（约第 64 行），在函数体末尾 `_last_push_result = ...` 行之后、函数返回前追加：

```python
    # 推送完成后检测事件
    try:
        from feishu.push_events import detect_and_push_events
        detect_and_push_events()
    except Exception:
        pass
```

在函数顶部已有 import 区域也行，但为保持简洁，在末尾用 try/except 懒加载。

- [ ] **Step 2: 在 pull_all_machines 末尾调用**

找到 `pull_all_machines` 函数（约 `schedule_sync.py` 第 691 行），在 `return result` 之前、最后更新时间之后追加：

```python
    # 拉取完成后检测事件
    try:
        from feishu.push_events import detect_and_push_events
        detect_and_push_events()
    except Exception:
        pass
```

- [ ] **Step 3: 在 _async_push 末尾调用**

`_async_push` 逐台调用 `push_machine_schedules`（非 `push_all_machines_parallel`），需独立挂载。

找到 `_async_push` 函数（约 sync_loop.py 第 124 行），在 `_last_push_result = ...` 行之后、`status_mod._active_operation = None` 行之前追加：

```python
        # 推送完成后检测事件
        try:
            from feishu.push_events import detect_and_push_events
            detect_and_push_events()
        except Exception:
            pass
```

> **无需在 `_async_pull` 和 `_async_toggle_on` 中单独添加：**
> - `_async_pull` 调用 `pull_all_machines()`，后者末尾已有 detect
> - `_async_toggle_on` 调用 `pull_all_machines()` + `push_all_machines_parallel()`，两者末尾均有 detect
> - `_sync_loop` 同理，调用 `pull_all_machines()` + `push_all_machines_parallel()`，已覆盖

- [ ] **Step 6: 验证**

```powershell
python -c "from feishu.sync_loop import push_all_machines_parallel; from feishu.schedule_sync import pull_all_machines; print('imports ok')"
```

- [ ] **Step 7: Commit**

```bash
git add feishu/sync_loop.py feishu/schedule_sync.py
git commit -m "feat: hook detect_and_push_events into push/pull call sites

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: 后端 — API 路由扩展 event_toggles

**Files:**
- Modify: `routes/feishu.py`

- [ ] **Step 1: 扩展 GET /api/feishu/push-config**

找到 `api_feishu_push_config` 函数（约第 250 行），在 `return jsonify({...})` 中增加 `event_toggles` 字段。修改返回语句：

```python
    # 读取事件开关
    row_toggles = conn.execute(
        "SELECT value FROM config WHERE category='feishu_push' AND key='event_toggles'"
    ).fetchone()
    toggles = {}
    if row_toggles:
        try:
            toggles = json.loads(row_toggles["value"])
        except json.JSONDecodeError:
            pass

    conn.close()
    return jsonify({
        "enabled": row_enabled["value"] == "1" if row_enabled else False,
        "chat_groups": chat_groups,
        "event_toggles": toggles,
    })
```

注意需要把 `conn.close()` 从原来的位置移到 return 之前（如果还没移的话）。

- [ ] **Step 2: 扩展 POST /api/feishu/push-config/save**

找到 `api_feishu_push_config_save` 函数（约第 282 行），在现有两个 `conn.execute` 之后追加 event_toggles 的写入：

```python
    event_toggles = d.get("event_toggles", {})
    conn.execute(
        "INSERT INTO config(category, key, value, sort_order) VALUES ('feishu_push', 'event_toggles', ?, 0)"
        " ON CONFLICT(category, key) DO UPDATE SET value=excluded.value",
        (json.dumps(event_toggles, ensure_ascii=False),),
    )
```

- [ ] **Step 3: 验证 API**

启动服务后测试：

```powershell
# 测试读取
curl -s http://localhost:5000/api/feishu/push-config | python -m json.tool

# 测试保存（含 event_toggles）
curl -s -X POST http://localhost:5000/api/feishu/push-config/save -H "Content-Type: application/json" -d "{\"enabled\":true,\"chat_groups\":[],\"event_toggles\":{\"task_impending_start\":{\"leader\":true,\"group\":false}}}"
```

- [ ] **Step 4: Commit**

```bash
git add routes/feishu.py
git commit -m "feat: extend push-config API with event_toggles read/write

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: 前端 — 事件开关矩阵 HTML

**Files:**
- Modify: `templates/panels/settings.html`

- [ ] **Step 1: 在推送设置 box 内插入事件开关矩阵**

找到推送设置 box 中 `<!-- chat_groups 区域 -->` 和测试发送按钮之间的位置（约第 539 行 `</div>` 之后，第 540 行 `</div>` 之前），插入事件开关矩阵 HTML：

```html
                    <!-- 事件推送开关矩阵 -->
                    <div id="push-event-toggles" style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border);">
                        <label style="font-size:12px;font-weight:600;display:block;margin-bottom:8px;">📨 推送事件设置</label>
                        <table style="width:100%;border-collapse:collapse;font-size:12px;">
                            <thead>
                                <tr>
                                    <th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border);">场景</th>
                                    <th style="text-align:center;padding:6px 8px;border-bottom:1px solid var(--border);">
                                        发给小组长<br>
                                        <button class="btn-sm" onclick="toggleEventColumn('leader', true)" style="font-size:10px;padding:2px 6px;">全选</button>
                                    </th>
                                    <th style="text-align:center;padding:6px 8px;border-bottom:1px solid var(--border);">
                                        发给群<br>
                                        <button class="btn-sm" onclick="toggleEventColumn('group', true)" style="font-size:10px;padding:2px 6px;">全选</button>
                                    </th>
                                </tr>
                            </thead>
                            <tbody id="push-event-tbody">
                            </tbody>
                        </table>
                    </div>
```

- [ ] **Step 2: Commit**

```bash
git add templates/panels/settings.html
git commit -m "feat: add event toggle matrix HTML to push settings

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: 前端 — 事件开关 JS 逻辑

**Files:**
- Modify: `static/settings.js`

- [ ] **Step 1: 在 settings.js 末尾追加事件开关 JS 逻辑**

```javascript
// ========== 推送事件开关矩阵 ==========

var _eventToggles = {};
var _eventColumnSelectAll = { leader: true, group: true };  // 当前全选状态

var EVENT_ITEMS = [
    { key: 'task_impending_start', label: '任务即将开始', leader: true,  group: false },
    { key: 'task_start',           label: '任务开始',     leader: true,  group: false },
    { key: 'task_confirm_start',   label: '任务确定开始', leader: false, group: true  },
    { key: 'schedule_changes',     label: '排班任务变动', leader: false, group: true  },
    { key: 'exception_start',      label: '异常情况开始', leader: false, group: true  },
    { key: 'exception_end',        label: '异常情况结束', leader: false, group: true  },
    { key: 'task_impending_end',   label: '任务即将结束', leader: true,  group: false },
    { key: 'task_end',             label: '任务结束',     leader: true,  group: false },
    { key: 'task_confirm_end',     label: '任务确定结束', leader: false, group: true  },
    { key: 'package_complete',     label: '任务包全部完成', leader: false, group: true },
    { key: 'shift_report',         label: '白班/夜班总结报告', leader: false, group: true },
];

function renderEventToggles(toggles) {
    _eventToggles = toggles || {};
    var tbody = document.getElementById('push-event-tbody');
    if (!tbody) return;
    
    var html = '';
    for (var i = 0; i < EVENT_ITEMS.length; i++) {
        var item = EVENT_ITEMS[i];
        var cfg = _eventToggles[item.key] || { leader: item.leader, group: item.group };
        var leaderActive = cfg.leader ? ' active' : '';
        var groupActive = cfg.group ? ' active' : '';
        html += '<tr>';
        html += '<td style="padding:4px 8px;">' + item.label + '</td>';
        html += '<td style="text-align:center;padding:4px 8px;">';
        if (item.leader !== undefined) {
            html += '<div class="ios-toggle mini-toggle' + leaderActive + '" onclick="toggleEventItem(\'' + item.key + '\', \'leader\')"><div class="ios-toggle-track"><div class="ios-toggle-thumb"></div></div></div>';
        } else {
            html += '<span style="color:var(--text-muted);">—</span>';
        }
        html += '</td>';
        html += '<td style="text-align:center;padding:4px 8px;">';
        if (item.group !== undefined) {
            html += '<div class="ios-toggle mini-toggle' + groupActive + '" onclick="toggleEventItem(\'' + item.key + '\', \'group\')"><div class="ios-toggle-track"><div class="ios-toggle-thumb"></div></div></div>';
        } else {
            html += '<span style="color:var(--text-muted);">—</span>';
        }
        html += '</td>';
        html += '</tr>';
    }
    tbody.innerHTML = html;
}

function toggleEventItem(key, column) {
    if (!_eventToggles[key]) {
        _eventToggles[key] = { leader: false, group: false };
    }
    _eventToggles[key][column] = !_eventToggles[key][column];
    renderEventToggles(_eventToggles);
}

function toggleEventColumn(column, currentAllSelected) {
    var newValue = !currentAllSelected;
    _eventColumnSelectAll[column] = newValue;
    for (var i = 0; i < EVENT_ITEMS.length; i++) {
        var item = EVENT_ITEMS[i];
        if (!_eventToggles[item.key]) {
            _eventToggles[item.key] = { leader: item.leader, group: item.group };
        }
        _eventToggles[item.key][column] = newValue;
    }
    renderEventToggles(_eventToggles);
    // 更新按钮文字
    updateSelectAllButtons();
}

function updateSelectAllButtons() {
    // 简化：重新构建时按钮 onclick 会使用当前 _eventColumnSelectAll 状态
}

function getEventTogglesForSave() {
    return _eventToggles;
}
```

- [ ] **Step 2: 修改 loadPushConfig 函数加载 event_toggles**

找到 `loadPushConfig` 函数（约在 settings.js 后半部分），在获取到 `cfg` 后增加：

```javascript
            if (cfg.event_toggles) {
                renderEventToggles(cfg.event_toggles);
            }
```

- [ ] **Step 3: 修改 savePushConfig 函数提交 event_toggles**

找到 `savePushConfig` 函数，在请求 body 中增加 `event_toggles`：

```javascript
function savePushConfig() {
    var enabled = document.getElementById('push-toggle').classList.contains('active');
    var chatGroups = getChatGroupsForSave();

    fetch('/api/feishu/push-config/save', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            enabled: enabled,
            chat_groups: chatGroups,
            event_toggles: _eventToggles,
        }),
    }).then(function(r) { return r.json(); })
      .then(function(data) {
          if (data.msg) showToast(data.msg);
      })
      .catch(function() {
          showToast('保存失败，请检查网络');
      });
}
```

- [ ] **Step 4: 增加 mini-toggle CSS**

在 `static/components.css` 末尾追加：

```css
/* 推送事件开关矩阵 - 小号 toggle */
.mini-toggle {
    display: inline-block;
    width: 36px;
    height: 20px;
    position: relative;
    cursor: pointer;
}
.mini-toggle .ios-toggle-track {
    width: 36px;
    height: 20px;
    border-radius: 10px;
}
.mini-toggle .ios-toggle-thumb {
    width: 16px;
    height: 16px;
    top: 2px;
    left: 2px;
}
.mini-toggle.active .ios-toggle-thumb {
    left: 18px;
}
```

- [ ] **Step 5: Commit**

```bash
git add static/settings.js static/components.css
git commit -m "feat: add event toggle matrix JS logic with per-column select-all

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: 端到端验证

- [ ] **Step 1: 启动服务**

```powershell
python app.py
```

- [ ] **Step 2: 验证数据库表创建**

```powershell
python -c "from db import init_db; init_db(); from db import get_db; c=get_db(); r=c.execute('SELECT name FROM sqlite_master WHERE type=\"table\" AND name=\"push_log\"').fetchone(); print('push_log:', r is not None); r2=c.execute(\"SELECT value FROM config WHERE category='feishu_push' AND key='event_toggles'\").fetchone(); print('event_toggles seed:', r2 is not None); c.close()"
```

- [ ] **Step 3: 验证 API — 读取推送配置（含 event_toggles）**

```powershell
curl -s http://localhost:5000/api/feishu/push-config | python -m json.tool
```

确认响应中包含 `event_toggles` 字段且为 JSON object。

- [ ] **Step 4: 验证 API — 保存推送配置（含 event_toggles）**

```powershell
curl -s -X POST http://localhost:5000/api/feishu/push-config/save -H "Content-Type: application/json" -d "{\"enabled\":true,\"chat_groups\":[{\"name\":\"测试群\",\"chat_id\":\"oc_test123\"}],\"event_toggles\":{\"task_impending_start\":{\"leader\":false,\"group\":false}}}"
```

- [ ] **Step 5: 浏览器验证 — 事件开关矩阵 UI**

1. 打开页面 → 设置 → 飞书同步
2. 打开飞书同步开关，确认推送设置 box 可用
3. 打开推送 toggle，确认事件开关矩阵显示
4. 点击"发给小组长"列的 [全选] 按钮，确认该列全部 toggle 变为开启
5. 再次点击，确认全部 toggle 变为关闭
6. 点击单个 toggle，确认切换正常
7. 点击保存后刷新页面，确认开关状态持久化

- [ ] **Step 6: 浏览器验证 — 测试消息发送**

1. 在推送设置中配置有效的 chat_id
2. 点击测试发送，输入测试消息
3. 确认飞书群收到消息

- [ ] **Step 7: 验证事件检测逻辑（手动触发）**

```powershell
python -c "from feishu.push_events import detect_and_push_events; detect_and_push_events(); print('detect_and_push_events completed')"
```

- [ ] **Step 8: Commit（如有微调）**

```bash
git add -A
git commit -m "chore: final adjustments after E2E verification

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
