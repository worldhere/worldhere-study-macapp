# 飞书推送卡片格式改造 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 改造 `feishu/push_events.py` 中全部 5 种飞书卡片模板（提醒/公告/变动/异常/报告），统一信息密度、引入机器类型配色、优化排版层次，并新增班次总结手动触发功能。

**Architecture:** 所有改动集中在 `feishu/push_events.py`（卡片 builder + 事件派发），新增一个路由到 `routes/feishu.py`，前端在 `settings.html/js` 加一个按钮。不涉及 DB 迁移，不修改发送通道。

**Tech Stack:** Python 3, Flask, SQLite, 飞书 Bitable API + IM API

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `feishu/push_events.py` | 5 个卡片 builder + `_dispatch_events()` + `_detect_feishu_events()` |
| `feishu/common.py` | 无需改动 |
| `routes/feishu.py` | 新增 `POST /api/feishu/push-config/report-now` |
| `templates/panels/settings.html` | 推送设置区新增"📊 班次总结"按钮 |
| `static/settings.js` | 绑定班次总结按钮事件 |

---

### Task 1: 卡片 1 — 辅助函数 + 数据层（时长格式化、颜色查询、新增字段）

**Files:**
- Modify: `feishu/push_events.py`

- [ ] **Step 1: 添加时长格式化辅助函数**

在 `push_events.py` 顶部 `_minutes_to_readable` 函数后面新增：

```python
def _format_duration(minutes):
    """绝对分钟差 -> '1h10m' / '52m' 字符串"""
    if minutes is None:
        return ""
    m = int(minutes)
    if m <= 0:
        return ""
    h = m // 60
    r = m % 60
    if h > 0:
        return f"{h}h{r}m" if r > 0 else f"{h}h"
    return f"{m}m"
```

- [ ] **Step 2: 添加机器类型颜色查询函数**

在 `_format_duration` 后新增：

```python
def _get_machine_type_color(machine_id, conn=None):
    """根据机器 ID 查 type_colors 获取对应颜色，未配置返回 'blue'"""
    own_conn = False
    if conn is None:
        conn = get_db()
        own_conn = True
    try:
        # 查机器类型
        machine = conn.execute(
            "SELECT type FROM machines WHERE id=?", (machine_id,)
        ).fetchone()
        if not machine or not machine["type"]:
            return "blue"
        # 查颜色配置
        row = conn.execute(
            "SELECT value FROM config WHERE category='color_settings' AND key='type_colors'"
        ).fetchone()
        if row:
            try:
                colors = json.loads(row["value"])
                color = colors.get(machine["type"])
                if color:
                    return color
            except (json.JSONDecodeError, TypeError):
                pass
        return "blue"
    finally:
        if own_conn:
            conn.close()
```

- [ ] **Step 3: 在 `_detect_feishu_events` 的 SQL 中追加字段**

在 `_detect_feishu_events` 函数（约第 181 行），修改 SQL 查询，追加 `t.priority` 和 `m.type AS machine_type`：

当前 SQL：
```python
sch_rows = conn.execute(
    f"""SELECT s.*, m.group_name, t.package_id, pkg.name AS package_name
        FROM schedules s
        LEFT JOIN machines m ON s.machine_id = m.id
        LEFT JOIN tasks t ON s.task_id = t.id
        LEFT JOIN task_packages pkg ON t.package_id = pkg.id
        WHERE s.id IN ({placeholders})""",
    sid_list
).fetchall()
```

改为：
```python
sch_rows = conn.execute(
    f"""SELECT s.*, m.group_name, m.type AS machine_type, t.package_id, t.priority,
               pkg.name AS package_name
        FROM schedules s
        LEFT JOIN machines m ON s.machine_id = m.id
        LEFT JOIN tasks t ON s.task_id = t.id
        LEFT JOIN task_packages pkg ON t.package_id = pkg.id
        WHERE s.id IN ({placeholders})""",
    sid_list
).fetchall()
```

- [ ] **Step 4: 在 `base_info` 中追加新字段**

在 `_detect_feishu_events` 的 `base_info` dict（约第 229 行），追加 `duration_minutes`、`priority`、`machine_type`：

```python
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
    "duration_minutes": (end_min - start_min) if (start_min is not None and end_min is not None) else None,
    "priority": sch["priority"] or "",
    "machine_type": sch["machine_type"] or "",
}
```

- [ ] **Step 5: 运行现有测试确认无回归**

```bash
python -m pytest test/test_cards.py -v
```

- [ ] **Step 6: Commit**

```bash
git add feishu/push_events.py
git commit -m "feat: add helper functions and data fields for card 1 redesign"
```

---

### Task 2: 卡片 1 — `_build_reminder_card` 改造（颜色 + 字段 + 文案）

**Files:**
- Modify: `feishu/push_events.py:459-491`

- [ ] **Step 1: 重写 `_build_reminder_card` 函数**

用以下代码替换 `_build_reminder_card` 函数体：

```python
def _build_reminder_card(event):
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

    # 机器类型配色
    color = _get_machine_type_color(event.get("machine_id"))

    elements = [
        {"tag": "div", "fields": [
            {"is_short": True, "text": {"tag": "lark_md", "content": "**机器**\n{}".format(event["machine_name"])}},
            {"is_short": True, "text": {"tag": "lark_md", "content": "**任务**\n{}".format(event["task_name"])}},
        ]},
        {"tag": "div", "fields": [
            {"is_short": True, "text": {"tag": "lark_md", "content": "**时间**\n{} - {}".format(start_str, end_str)}},
            {"is_short": True, "text": {"tag": "lark_md", "content": "**状态**\n{}".format(status_label)}},
        ]},
        {"tag": "hr"},
    ]

    # 底部信息行：时长 + 优先级 + 来源 + 分组
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
```

- [ ] **Step 2: Commit**

```bash
git add feishu/push_events.py
git commit -m "feat: redesign reminder card with machine colors, new fields, '剩余' wording"
```

---

### Task 3: 卡片 1 — `_dispatch_events` 合并发送逻辑

**Files:**
- Modify: `feishu/push_events.py` (dispatch section)

- [ ] **Step 1: 新增合并发送函数**

在 `_dispatch_events` 之前添加：

```python
def _build_merged_reminder_card(events_list, merged_count):
    """将多条提醒事件合并为一张卡片。events_list 中每条格式相同，依次排列。"""
    if not events_list:
        return None
    if len(events_list) == 1:
        return _build_reminder_card(events_list[0])

    # 取第一条的颜色作为整张卡片颜色
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
                {"is_short": True, "text": {"tag": "lark_md", "content": "**任务**\n{}".format(ev["task_name"])}},
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
```

- [ ] **Step 2: 修改 `_dispatch_events` 中 individual_events 的处理**

找到个体事件处理循环（约第 865 行 `# 处理个体事件（任务提醒、异常）`），将 `individual_events` 按 `(target_type, target_id)` 分组合并发送。

将当前的逐条处理逻辑替换为按目标分组合并：

```python
    # 处理个体事件（任务提醒、异常）— 按目标合并发送
    # 先分离提醒类和异常类（异常类不合并，保持独立发送）
    reminder_events = [e for e in individual_events if e["event_type"] not in ("exception_start", "exception_end")]
    exception_events = [e for e in individual_events if e["event_type"] in ("exception_start", "exception_end")]

    # 合并提醒事件：按 (target_type, target_id) 分组
    reminder_by_target = {}
    for ev in reminder_events:
        targets, _ = _get_targets_for_event(ev)
        for tt, tid in targets:
            key = (tt, tid)
            if key not in reminder_by_target:
                reminder_by_target[key] = []
            reminder_by_target[key].append(ev)

    for (target_type, target_id), evs in reminder_by_target.items():
        # 按开关过滤
        filtered = []
        for ev in evs:
            etype = ev["event_type"]
            toggle_cfg = toggles.get(etype, {})
            if target_type == "leader" and not toggle_cfg.get("leader", False):
                continue
            if target_type == "group" and not toggle_cfg.get("group", False):
                continue
            # 去重检查
            sid = ev.get("schedule_id", 0)
            dedup_key_map = {
                "task_impending_start": f"remind_{sid}_impending_start",
                "task_start": f"task_start_{sid}",
                "task_impending_end": f"remind_{sid}_impending_end",
                "task_end": f"task_end_{sid}",
            }
            dedup_key = dedup_key_map.get(etype, f"{etype}_{sid}")
            notify_value = ev.get("start_min") if etype in ("task_impending_start", "task_start") else (
                ev.get("end_min") if etype in ("task_impending_end", "task_end") else None
            )
            if _should_send(conn, dedup_key, target_id, notify_value):
                filtered.append(ev)
            else:
                diag["skipped_dedup"] += 1

        if not filtered:
            continue

        card_json = _build_merged_reminder_card(filtered, len(filtered))
        if not card_json:
            continue

        if target_type == "leader":
            success, err = send_im_message_to_user(target_id, card_json, "interactive")
        else:
            success, err = send_im_message(target_id, card_json, "interactive")

        if success:
            diag["sent"] += len(filtered)
        else:
            diag["failed"] += len(filtered)

        # 记录每条
        for ev in filtered:
            etype = ev["event_type"]
            sid = ev.get("schedule_id", 0)
            dedup_key_map = {
                "task_impending_start": f"remind_{sid}_impending_start",
                "task_start": f"task_start_{sid}",
                "task_impending_end": f"remind_{sid}_impending_end",
                "task_end": f"task_end_{sid}",
            }
            dedup_key = dedup_key_map.get(etype, f"{etype}_{sid}")
            notify_value = ev.get("start_min") if etype in ("task_impending_start", "task_start") else (
                ev.get("end_min") if etype in ("task_impending_end", "task_end") else None
            )
            _record_push(conn, dedup_key, etype, target_type, target_id, notify_value, success)

    # 异常事件保持独立发送（不合并）
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

            dedup_key = f"exc_{sid}_start" if etype == "exception_start" else f"exc_{sid}_end"
            notify_value = ev.get("exception_reason", "") if etype == "exception_start" else None

            if not _should_send(conn, dedup_key, target_id, notify_value):
                diag["skipped_dedup"] += 1
                continue

            if etype == "exception_start":
                ev["start_time"] = now_str
                card_json = _build_exception_card(ev, is_end=False)
            else:
                card_json = _build_exception_card(ev, is_end=True)

            if not card_json:
                continue

            if target_type == "leader":
                success, err = send_im_message_to_user(target_id, card_json, "interactive")
            else:
                success, err = send_im_message(target_id, card_json, "interactive")

            if success:
                diag["sent"] += 1
            else:
                diag["failed"] += 1

            _record_push(conn, dedup_key, etype, target_type, target_id, notify_value, success)
```

- [ ] **Step 3: Commit**

```bash
git add feishu/push_events.py
git commit -m "feat: merge multiple reminder cards per target in dispatch"
```

---

### Task 4: 卡片 2 — `_build_announcement_card` 改造

**Files:**
- Modify: `feishu/push_events.py:494-530`

- [ ] **Step 1: 重写 `_build_announcement_card` 函数**

用以下代码替换：

```python
def _build_announcement_card(events_list):
    """模板 2: 任务公告卡片（绿色）— 给群。合并多条，统一信息顺序。"""
    COLOR_MAP = {
        "task_confirm_start": {"bg": "#E3F2FD", "border": "#2196F3", "action": "已确定开始", "action_color": "#2196F3"},
        "task_confirm_end":   {"bg": "#E8F5E9", "border": "#4CAF50", "action": "已确定完成", "action_color": "#4CAF50"},
        "package_complete":   {"bg": "#FFF8E1", "border": "#FF9800", "action": "📦 全部任务已完成", "action_color": "#FF9800"},
    }

    elements = []
    for i, e in enumerate(events_list[:10]):
        cfg = COLOR_MAP.get(e["event_type"], COLOR_MAP["task_confirm_start"])

        # 构建行内容：分组 → 机器 → (任务包) → 任务 → 动作
        parts = []
        if e.get("group_name"):
            parts.append({"tag": "plain_text", "content": e["group_name"]})
        if e["event_type"] == "package_complete":
            # 包完成：只有任务包名 + 动作
            parts.append({"tag": "plain_text", "content": e.get("package_name", "")})
        else:
            parts.append({"tag": "plain_text", "content": e.get("machine_name", "")})
            if e.get("package_name"):
                parts.append({"tag": "plain_text", "content": e["package_name"]})
            parts.append({"tag": "plain_text", "content": e.get("task_name", "")})

        parts.append({"tag": "plain_text", "content": cfg["action"]})

        # 用空格连接各部分，lark_md 格式
        md_content = ""
        for p in parts:
            content = p["content"]
            if not content:
                continue
            # machine_name 和 task_name 加粗
            if p["content"] == e.get("machine_name") or p["content"] == e.get("task_name"):
                md_content += " **{}** ".format(content)
            elif p["content"] == cfg["action"]:
                md_content += " <font color='{}'>{}</font> ".format(cfg["action_color"], content)
            elif p["content"] == e.get("package_name"):
                md_content += " <font color='{}'>{}</font> ".format(cfg["action_color"], content)
            else:
                md_content += " {} ".format(content)

        elements.append({
            "tag": "div",
            "text": {"tag": "lark_md", "content": md_content.strip()},
        })

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
```

> **注意:** 飞书卡片 `lark_md` 不支持文本背景色。色块标注（蓝底/绿底/橙底）依赖飞书卡片自身的 `div` 背景，无法在 `lark_md` 中实现。此任务先做字段顺序 + 颜色文字。色块背景可在后续任务中评估用 `div` + `fields` 替代纯文本行来实现。

- [ ] **Step 2: Commit**

```bash
git add feishu/push_events.py
git commit -m "feat: redesign announcement card with unified field order and color text"
```

---

### Task 5: 卡片 3 — `_build_changes_card` 改造（双时间线 + 分组 + 颜色反转）

**Files:**
- Modify: `feishu/push_events.py:533-579`

- [ ] **Step 1: 重写 `_build_changes_card` 函数**

用以下代码替换：

```python
def _build_changes_card(events_list, for_leader=False):
    """模板 3: 变动汇总卡片（橙色）— 给群/小组长。按上下文分组，展示双时间线。
    for_leader=True 时颜色反向（延后=绿, 提前=橙）"""

    def _time_change_line(old_min, new_min, label_prefix, date_str, is_leader):
        """构建一条时间变化行。返回 (md_content, direction_color, direction_label)"""
        if old_min is None or new_min is None:
            return None
        diff = new_min - old_min
        if diff == 0:
            return None  # 未变化不展示
        old_str = _minutes_to_readable(date_str, old_min)
        new_str = _minutes_to_readable(date_str, new_min)
        if diff > 0:
            direction_label = "⏰延后"
            direction_color = "#4CAF50" if is_leader else "#FF9800"  # 群=橙, 私信=绿
        else:
            direction_label = "⏫提前"
            direction_color = "#FF9800" if is_leader else "#4CAF50"  # 群=绿, 私信=橙
        sign = "+" if diff > 0 else ""
        content = "{} {}→{} **({}{}m {})**".format(
            label_prefix, old_str, new_str, sign, diff, direction_label
        )
        return content

    # 按 (group_name, machine_name, package_name) 分组
    groups = {}
    for e in events_list:
        key = (e.get("group_name", ""), e.get("machine_name", ""), e.get("package_name", ""))
        if key not in groups:
            groups[key] = []
        groups[key].append(e)

    elements = []
    for (group_name, machine_name, package_name), evs in groups.items():
        # 上下文 header
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
            # 任务名
            elements.append({
                "tag": "div",
                "text": {"tag": "lark_md", "content": "**{}**".format(ev.get("task_name", ""))}
            })

            # 开始时间变化
            start_line = _time_change_line(
                ev.get("old_start_min"), ev.get("start_min"),
                "开始时间", ev["date"], for_leader
            )
            if start_line:
                elements.append({
                    "tag": "div",
                    "text": {"tag": "lark_md", "content": start_line}
                })
            else:
                elements.append({
                    "tag": "div",
                    "text": {"tag": "lark_md", "content": "开始时间 —（未变化）"}
                })

            # 结束时间变化
            end_line = _time_change_line(
                ev.get("old_end_min"), ev.get("end_min"),
                "结束时间", ev["date"], for_leader
            )
            if end_line:
                elements.append({
                    "tag": "div",
                    "text": {"tag": "lark_md", "content": end_line}
                })
            else:
                elements.append({
                    "tag": "div",
                    "text": {"tag": "lark_md", "content": "结束时间 —（未变化）"}
                })

            # 变化后排班时长
            new_start = ev.get("start_min")
            new_end = ev.get("end_min")
            if new_start is not None and new_end is not None:
                new_duration = _format_duration(new_end - new_start)
                elements.append({
                    "tag": "div",
                    "text": {"tag": "lark_md", "content": "变化后排班时长 **{}**".format(new_duration)}
                })
            else:
                elements.append({
                    "tag": "div",
                    "text": {"tag": "lark_md", "content": "变化后排班时长 —"}
                })

        elements.append({"tag": "hr"})

    # 去掉最后一个多余的 hr
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
```

- [ ] **Step 2: 更新 `_dispatch_events` 中 change_events 的处理**

找到变动汇总发送部分（约第 1037 行），修改为按 target_type 传入 `for_leader` 参数：

```python
    # 处理变动汇总
    if change_events:
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

            # 颜色反转：私信小组长时传 for_leader=True
            is_leader = (target_type == "leader")
            card_json = _build_changes_card(change_events, for_leader=is_leader)
            if not card_json:
                continue

            if target_type == "leader":
                success, err = send_im_message_to_user(target_id, card_json, "interactive")
            else:
                success, err = send_im_message(target_id, card_json, "interactive")

            if success:
                diag["sent"] += 1
            else:
                diag["failed"] += 1

            _record_push(conn, dedup_key, "schedule_changes", target_type, target_id, notify_value, success)
```

- [ ] **Step 3: Commit**

```bash
git add feishu/push_events.py
git commit -m "feat: redesign changes card with dual timeline, context grouping, color inversion"
```

---

### Task 6: 卡片 4 — `_build_exception_card` 改造

**Files:**
- Modify: `feishu/push_events.py:582-624`

- [ ] **Step 1: 重写 `_build_exception_card` 函数**

用以下代码替换：

```python
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
            {
                "tag": "div",
                "text": {"tag": "lark_md", "content": "**异常总耗时：{}**".format(event.get("duration", ""))}
            },
        ]
    else:
        header_title = "⚠️ 异常开始"
        elements = []
        # 备注提前到顶部
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
```

- [ ] **Step 2: Commit**

```bash
git add feishu/push_events.py
git commit -m "feat: redesign exception card — note up, '异常总耗时' rename"
```

---

### Task 7: 卡片 5 — `_build_report_card` 改造（三段结构 + 数据查询）

**Files:**
- Modify: `feishu/push_events.py:627-717`

- [ ] **Step 1: 添加包进度查询函数**

在 `_build_report_card` 之前新增：

```python
def _query_package_progress(conn, date_clause, date_params):
    """查询任务包进度：每包 total/completed。复用 list_task_packages 模式。"""
    rows = conn.execute(
        f"""SELECT p.id, p.name,
                   COUNT(*) AS total,
                   SUM(CASE WHEN s.status='completed' THEN 1 ELSE 0 END) AS completed
            FROM schedules s
            JOIN tasks t ON s.task_id = t.id
            JOIN task_packages p ON t.package_id = p.id
            WHERE s.date {date_clause} AND t.package_id IS NOT NULL
            GROUP BY p.id ORDER BY p.name""",
        date_params
    ).fetchall()
    return rows


def _query_collect_total(conn, date_clause, date_params):
    """统计已完成 schedule 的采集总数"""
    row = conn.execute(
        f"""SELECT COALESCE(SUM(t.collect_count), 0) AS total
            FROM schedules s
            JOIN tasks t ON s.task_id = t.id
            WHERE s.date {date_clause} AND s.status='completed'""",
        date_params
    ).fetchone()
    return row["total"] if row else 0
```

- [ ] **Step 2: 重写 `_build_report_card` 函数**

用以下代码替换（保留夜班跨两天逻辑）：

```python
def _build_report_card(event):
    """模板 5: 班次报告卡片（紫色）— 给群。三段结构：包进度 → 汇总 → 未完成"""
    conn = get_db()
    date_str = event["date"]
    display_date = event.get("display_date", date_str)
    shift = event["shift"]

    # 夜班跨两天
    if shift == "夜班":
        now = datetime.datetime.now()
        today_str = now.strftime("%Y-%m-%d")
        yesterday_str = (now - datetime.timedelta(days=1)).strftime("%Y-%m-%d")
        date_clause = "IN (?, ?)"
        date_params = (yesterday_str, today_str)
    else:
        date_clause = "= ?"
        date_params = (date_str,)

    now_min = datetime.datetime.now().hour * 60 + datetime.datetime.now().minute

    # 基本统计（复用现有查询逻辑）
    all_total = conn.execute(
        f"SELECT COUNT(*) AS c FROM schedules WHERE date {date_clause}", date_params
    ).fetchone()
    total_normal = conn.execute(
        f"""SELECT COUNT(*) AS c FROM schedules s
           LEFT JOIN tasks t ON s.task_id = t.id
           WHERE s.date {date_clause} AND s.status='completed' AND t.package_id IS NULL""",
        date_params
    ).fetchone()
    incomplete_normal = conn.execute(
        f"""SELECT COUNT(*) AS c FROM schedules s
           LEFT JOIN tasks t ON s.task_id = t.id
           WHERE s.date {date_clause} AND s.status!='completed' AND t.package_id IS NULL""",
        date_params
    ).fetchone()
    overdue = conn.execute(
        f"""SELECT COUNT(*) AS c FROM schedules s
           WHERE s.date {date_clause} AND s.status!='completed' AND (s.end_min < ?)""",
        (*date_params, now_min)
    ).fetchone()

    # 包进度
    pkg_rows = _query_package_progress(conn, date_clause, date_params)
    collect_total = _query_collect_total(conn, date_clause, date_params)

    all_count = (all_total["c"] if all_total else 0)
    completed_normal_count = (total_normal["c"] if total_normal else 0)

    # 汇总包任务数
    pkg_completed_total = sum(r["completed"] for r in pkg_rows)
    pkg_all_total = sum(r["total"] for r in pkg_rows)
    completed_all = pkg_completed_total + completed_normal_count
    rate = round(completed_all / all_count * 100) if all_count > 0 else 0

    elements = [
        {"tag": "div", "text": {"tag": "lark_md", "content": "**{}  {}**".format(display_date, shift)}},
        {"tag": "hr"},
    ]

    # 第一段：📦 任务包进度
    elements.append({"tag": "div", "text": {"tag": "lark_md", "content": "**📦 任务包进度**"}})
    if pkg_rows:
        for r in pkg_rows:
            completed = r["completed"]
            total = r["total"]
            pct = round(completed / total * 100) if total > 0 else 0
            # 进度条用 unicode block 字符
            bar_len = 10
            filled = round(pct / 100 * bar_len) if total > 0 else 0
            bar = "█" * filled + "░" * (bar_len - filled)
            elements.append({
                "tag": "div",
                "text": {"tag": "lark_md", "content": "{}  完成 {}/{}  {}  **{}%**".format(
                    r["name"], completed, total, bar, pct
                )}
            })
    else:
        elements.append({
            "tag": "div",
            "text": {"tag": "lark_md", "content": "本班次无任务包排班"}
        })

    elements.append({"tag": "hr"})

    # 第二段：📊 汇总
    elements.append({"tag": "div", "text": {"tag": "lark_md", "content": "**📊 汇总**"}})
    elements.append({"tag": "div", "fields": [
        {"is_short": True, "text": {"tag": "lark_md", "content": "任务包任务\n**{}/{}** 个".format(pkg_completed_total, pkg_all_total)}},
        {"is_short": True, "text": {"tag": "lark_md", "content": "普通任务\n**{}** 个已完成".format(completed_normal_count)}},
    ]})
    elements.append({"tag": "div", "fields": [
        {"is_short": True, "text": {"tag": "lark_md", "content": "总完成率\n**{}%**".format(rate)}},
        {"is_short": True, "text": {"tag": "lark_md", "content": "共采集\n**{:,}** 条".format(collect_total)}},
    ]})

    elements.append({"tag": "hr"})

    # 第三段：⚠️ 未完成
    elements.append({"tag": "div", "text": {"tag": "lark_md", "content": "**⚠️ 未完成**"}})
    # 未完成的任务包
    incomplete_pkgs = [r for r in pkg_rows if r["completed"] < r["total"]]
    if incomplete_pkgs:
        for r in incomplete_pkgs:
            remaining = r["total"] - r["completed"]
            pct = round(r["completed"] / r["total"] * 100) if r["total"] > 0 else 0
            elements.append({
                "tag": "div",
                "text": {"tag": "lark_md", "content": "{}  剩余{}个  进度 {}%".format(
                    r["name"], remaining, pct
                )}
            })
    else:
        elements.append({
            "tag": "div",
            "text": {"tag": "lark_md", "content": "所有任务包均已完成 ✅"}
        })

    # 普通未完成 + 逾期
    inc_n = incomplete_normal["c"] if incomplete_normal else 0
    ov = overdue["c"] if overdue else 0
    footer_parts = []
    if inc_n > 0:
        footer_parts.append("普通未完成 {} 个".format(inc_n))
    if ov > 0:
        footer_parts.append("逾期 {} 个".format(ov))
    if footer_parts:
        elements.append({
            "tag": "div",
            "text": {"tag": "lark_md", "content": " · ".join(footer_parts)}
        })

    conn.close()

    card = {
        "header": {
            "title": {"tag": "plain_text", "content": "📊 {}总结报告".format(shift)},
            "template": CARD_COLORS["report"],
        },
        "elements": elements,
    }
    return json.dumps(card, ensure_ascii=False)
```

- [ ] **Step 3: Commit**

```bash
git add feishu/push_events.py
git commit -m "feat: redesign report card with 3-section daily-report style"
```

---

### Task 8: 卡片 5 — 手动触发 API + 前端按钮

**Files:**
- Modify: `routes/feishu.py`
- Modify: `templates/panels/settings.html`
- Modify: `static/settings.js`

- [ ] **Step 1: 新增路由**

在 `routes/feishu.py` 的 `api_feishu_push_config_test` 路由之后添加：

```python
@bp.route('/api/feishu/push-config/report-now', methods=['POST'])
def api_feishu_push_config_report_now():
    """立即生成并推送当前班次总结报告到所有配置的群聊"""
    import datetime as _dt
    from feishu.common import send_im_message
    from feishu.push_events import _build_report_card

    conn = get_db()
    row = conn.execute(
        "SELECT value FROM config WHERE category='feishu_push' AND key='chat_ids'"
    ).fetchone()
    conn.close()

    raw = row["value"].strip() if row else ""
    if not raw:
        return jsonify({"error": "未配置群聊 ID"}), 400

    if raw.startswith("["):
        try:
            groups = json.loads(raw)
            chat_ids = [g["chat_id"] for g in groups if g.get("chat_id")]
        except json.JSONDecodeError:
            return jsonify({"error": "群聊数据格式错误"}), 400
    else:
        chat_ids = [cid.strip() for cid in raw.replace('\r', '\n').split('\n') if cid.strip()]

    if not chat_ids:
        return jsonify({"error": "未配置群聊 ID"}), 400

    # 判断当前班次
    now = _dt.datetime.now()
    now_min = now.hour * 60 + now.minute
    conn2 = get_db()
    shift_rows = conn2.execute(
        "SELECT key, start FROM shift_config WHERE key IN ('day_shift', 'night_shift')"
    ).fetchall()
    conn2.close()

    day_start = night_start = None
    for r in shift_rows:
        try:
            parts = r["start"].split(":")
            t = int(parts[0]) * 60 + int(parts[1])
        except Exception:
            continue
        if r["key"] == "day_shift":
            day_start = t
        elif r["key"] == "night_shift":
            night_start = t

    if day_start is not None and night_start is not None:
        if day_start <= now_min < night_start:
            shift = "白班"
        else:
            shift = "夜班"
    else:
        shift = "白班"  # fallback

    # 构造 event
    if shift == "夜班":
        yesterday = now - _dt.timedelta(days=1)
        event = {
            "event_type": "shift_report",
            "shift": shift,
            "date": yesterday.strftime("%Y-%m-%d"),
            "display_date": f"{yesterday.strftime('%m/%d')}-{now.strftime('%m/%d')}",
        }
    else:
        event = {
            "event_type": "shift_report",
            "shift": shift,
            "date": now.strftime("%Y-%m-%d"),
            "display_date": now.strftime("%m/%d"),
        }

    card_json = _build_report_card(event)
    if not card_json:
        return jsonify({"error": "生成报告失败"}), 500

    results = []
    for cid in chat_ids:
        success, err = send_im_message(cid, card_json, "interactive")
        results.append({
            "chat_id": cid,
            "success": success,
            "error": err if not success else None,
        })

    return jsonify({"shift": shift, "results": results})
```

- [ ] **Step 2: 前端 HTML 按钮**

在 `templates/panels/settings.html` 的测试发送按钮行（约第 564 行）后添加：

```html
                        <button class="btn" onclick="reportNow()" style="white-space:nowrap;">📊 班次总结</button>
```

完整行变为：
```html
                    <div style="display:flex;gap:8px;margin-top:12px;align-items:center;">
                        <button class="btn" onclick="savePushConfig()" style="background:var(--primary);color:#fff;">💾 保存</button>
                        <input id="push-test-msg" value="🧪 推送测试消息" style="flex:1;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:12px;min-width:180px;">
                        <button class="btn" onclick="testPush()">🚀 发送</button>
                        <button class="btn" onclick="reportNow()" style="white-space:nowrap;">📊 班次总结</button>
                    </div>
```

- [ ] **Step 3: 前端 JS**

在 `static/settings.js` 的 `testPush()` 函数之后添加：

```javascript
function reportNow() {
    if (!_chatGroups.length) {
        showToast('请先添加群聊');
        return;
    }

    // 先保存再发送
    var enabled = document.getElementById('push-toggle').classList.contains('active');
    fetch('/api/feishu/push-config/save', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({enabled: enabled, chat_groups: _chatGroups, event_toggles: _eventToggles}),
    }).then(function() {
        return fetch('/api/feishu/push-config/report-now', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
        });
    }).then(function(r) { return r.json(); })
      .then(function(data) {
          if (data.error) { showToast(data.error); return; }
          var results = data.results || [];
          var ok = results.filter(function(r) { return r.success; }).length;
          var fail = results.length - ok;
          if (fail === 0) {
              showToast(data.shift + '总结报告已发送（' + ok + ' 个群）');
          } else {
              showToast(data.shift + '报告：' + ok + ' 成功，' + fail + ' 失败');
          }
      })
      .catch(function() {
          showToast('发送失败，请检查网络');
      });
}
```

- [ ] **Step 4: Commit**

```bash
git add routes/feishu.py templates/panels/settings.html static/settings.js
git commit -m "feat: add manual shift report trigger API and frontend button"
```

---

### Task 9: 集成验证 + 最终测试

**Files:**
- Test: `test/test_cards.py`

- [ ] **Step 1: 更新测试文件**

修改 `test/test_cards.py`，确保测试覆盖所有 5 种卡片的新 builder 签名：

```python
# 在文件末尾添加对 report-now API 的测试
def test_report_now_no_chat_ids():
    """无群聊配置时返回 400"""
    import sys, os
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from app import app
    with app.test_client() as client:
        # 临时清空 chat_ids
        from db import get_db
        conn = get_db()
        conn.execute("DELETE FROM config WHERE category='feishu_push' AND key='chat_ids'")
        conn.commit()
        conn.close()
        
        resp = client.post('/api/feishu/push-config/report-now')
        data = resp.get_json()
        assert resp.status_code == 400
        assert 'error' in data
```

- [ ] **Step 2: 运行全部测试**

```bash
python -m pytest test/test_cards.py -v
```

- [ ] **Step 3: 验证应用可启动**

```bash
python app.py &
Start-Sleep -Seconds 3
# 检查进程存活
```

- [ ] **Step 4: Commit**

```bash
git add test/test_cards.py
git commit -m "test: add report-now API test"
```

---

### Task 10: 最终合并与清理

- [ ] **Step 1: 运行全量回归测试**

```bash
python -m pytest test/ -v --tb=short
```

- [ ] **Step 2: 检查 git status 确认无遗漏文件**

```bash
git status
```

- [ ] **Step 3: 最终 commit**

```bash
git add -A
git commit -m "feat: complete all 5 card format redesigns with manual report trigger"
```
