# 维修暂停自动延长任务结束时间 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 机器从维修恢复时，自动延长受影响的 executing 任务的 end_min，消除手动修改。

**Architecture:** 在 `set_machine_status()` 的 repair_end 分支中（commit 之前）插入延长逻辑。开关存储在 localStorage + 后端 config 表双向同步。trigger 源包括按钮和飞书，走同一条路径。

**Tech Stack:** Python 3 (Flask, sqlite3), vanilla JavaScript, HTML/CSS

---

### Task 1: 添加辅助函数 `schedule_to_datetime()`

**Files:**
- Modify: `utils.py` — 在文件末尾添加函数

- [ ] **Step 1: 在 `utils.py` 末尾添加 `schedule_to_datetime()`**

```python
def schedule_to_datetime(schedule_row, min_field):
    """将 schedule 的 date + start_min / end_min 转为真实的 datetime 对象。
    处理跨午夜：end_min 可能超过 1440，按天偏移。
    """
    import datetime as _dt
    base = _dt.date.fromisoformat(schedule_row["date"])
    minutes = int(schedule_row[min_field])
    days = minutes // 1440
    remainder = minutes % 1440
    return _dt.datetime.combine(base, _dt.time(0, 0)) + _dt.timedelta(days=days, minutes=remainder)
```

- [ ] **Step 2: 验证导入**

```bash
cd "C:\Users\Admin\Desktop\大家的Draft\zyh\golden"
python -c "from utils import schedule_to_datetime; print('OK')"
```
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add utils.py
git commit -m "feat: add schedule_to_datetime helper for repair-auto-extend

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: 核心延长逻辑 — 植入 `set_machine_status()`

**Files:**
- Modify: `routes/machines.py:311-336`（repair_end 分支）

- [ ] **Step 1: 读取现有 repair_end 分支代码**

确认要修改的位置：`routes/machines.py` 第 311-336 行，`elif old_status == "维修停用" and new_status != "维修停用":` 分支。

- [ ] **Step 2: 在 `conn.commit()` 之前插入延长逻辑**

把所有代码放在 `conn.commit()` 之前（第 338 行之前），与现有 repair_log UPDATE 在同一个事务中。

将第 311-344 行替换为：

```python
    elif old_status == "维修停用" and new_status != "维修停用":
        open_repair = conn.execute(
            "SELECT id, start_datetime FROM repair_log WHERE machine_id=? AND end_datetime IS NULL ORDER BY id DESC LIMIT 1",
            (mid,),
        ).fetchone()
        if open_repair:
            now = datetime.datetime.now()
            conn.execute(
                "UPDATE repair_log SET end_datetime=? WHERE id=?",
                (now.isoformat(timespec="seconds"), int(open_repair["id"])),
            )
            start_dt = datetime.datetime.fromisoformat(open_repair["start_datetime"])
            duration_seconds = (now - start_dt).total_seconds()
            duration_str = format_elapsed(int(duration_seconds // 60))
            repair_info = {
                "action": "repair_end",
                "repair_id": int(open_repair["id"]),
                "start_datetime": open_repair["start_datetime"],
                "end_datetime": now.isoformat(timespec="seconds"),
                "duration": duration_str,
            }

            # ---- 维修后自动延长受影响的任务 ----
            auto_extend_enabled = False
            config_row = conn.execute(
                "SELECT value FROM config WHERE category='schedule_settings' AND key='auto_extend_after_repair'"
            ).fetchone()
            if config_row and (config_row["value"] or "1") == "1":
                auto_extend_enabled = True

            if auto_extend_enabled:
                tasks = conn.execute(
                    "SELECT id, date, start_min, end_min FROM schedules"
                    " WHERE machine_id=? AND status='executing'",
                    (mid,),
                ).fetchall()

                extended = 0
                total_minutes = 0
                for task in tasks:
                    from utils import schedule_to_datetime
                    task_start = schedule_to_datetime(task, "start_min")
                    task_end = schedule_to_datetime(task, "end_min")

                    # 计算重叠
                    overlap_start = max(task_start, start_dt)
                    overlap_end = min(task_end, now)
                    if overlap_end > overlap_start:
                        overlap_minutes = int((overlap_end - overlap_start).total_seconds() // 60)
                        new_end = task_end + datetime.timedelta(minutes=overlap_minutes)

                        # 转回 end_min（支持跨天）: day_offset * 1440 + minute_of_day
                        new_end_date = new_end.date()
                        base_date = datetime.date.fromisoformat(task["date"])
                        day_offset = (new_end_date - base_date).days
                        minute_of_day = new_end.hour * 60 + new_end.minute
                        new_end_min = day_offset * 1440 + minute_of_day

                        conn.execute(
                            "UPDATE schedules SET end_min=? WHERE id=?",
                            (new_end_min, task["id"]),
                        )
                        extended += 1
                        total_minutes += overlap_minutes

                if extended > 0:
                    repair_info["auto_extended"] = {
                        "tasks": extended,
                        "total_minutes": total_minutes,
                    }
        else:
            repair_info = {
                "action": "repair_end_no_start",
                "msg": "维修无开始时间，本次不记录",
            }
```

- [ ] **Step 3: 确认 `from utils import schedule_to_datetime` 在函数内部**（延迟导入避免循环依赖）

函数内部已有 `from utils import format_elapsed` 的先例，同理处理 `schedule_to_datetime`。

- [ ] **Step 4: 验证语法**

```bash
cd "C:\Users\Admin\Desktop\大家的Draft\zyh\golden"
python -c "import routes.machines; print('OK')"
```
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add routes/machines.py
git commit -m "feat: auto-extend task end_min when repair ends on machine

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: 设置开关 — 前端 UI + 后端存储

**Files:**
- Modify: `templates/panels/schedule.html:54` — 添加 checkbox
- Modify: `static/timeline.js:124` — 添加 toggle 函数
- Modify: `static/app.js:114` — 添加页面初始化恢复逻辑
- Modify: `routes/settings.py` — 添加保存设置的路由

- [ ] **Step 1: 在 `schedule.html` 中添加 checkbox**

在 `templates/panels/schedule.html` 第 54 行之后插入：

```html
                <label style="margin-left:4px;font-size:12px;"><input type="checkbox" id="auto-extend-repair" checked onchange="toggleAutoExtendRepair()"> 维修后自动延长任务</label>
```

- [ ] **Step 2: 在 `static/timeline.js` 中添加 toggle 函数**

在 `toggleAutoCompactRecycle` 函数（第 124 行）之后添加：

```javascript
function toggleAutoExtendRepair(){
    var checked = document.getElementById('auto-extend-repair').checked;
    window._autoExtendRepair = checked;
    try{ localStorage.setItem('autoExtendRepair', checked?'1':'0'); }catch(e){}
    // 同步到后端 config 表，供 set_machine_status 读取
    fetch('/save_schedule_setting', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({key:'auto_extend_after_repair', value: checked?'1':'0'})
    }).catch(function(){});
}
```

- [ ] **Step 3: 在 `static/app.js` 中添加页面初始化恢复**

在 `static/app.js` 第 116 行（`if (acrCheck)` 之后）插入：

```javascript
    window._autoExtendRepair = localStorage.getItem('autoExtendRepair') !== '0';
    var aerCheck = document.getElementById('auto-extend-repair');
    if (aerCheck) aerCheck.checked = window._autoExtendRepair;
```

- [ ] **Step 4: 在 `routes/settings.py` 中添加保存路由**

找到 settings.py 末尾，添加：

```python
@bp.route('/save_schedule_setting', methods=['POST'])
def save_schedule_setting():
    d = request.get_json()
    key = d.get("key", "")
    value = d.get("value", "1")
    conn = get_db()
    conn.execute(
        "INSERT INTO config(category, key, value, sort_order) VALUES ('schedule_settings', ?, ?, 0)"
        " ON CONFLICT(category, key) DO UPDATE SET value=excluded.value",
        (key, value),
    )
    conn.commit()
    conn.close()
    return jsonify({"msg": "ok"})
```

需要确认 `settings.py` 已有 `from db import get_db` 和 `from flask import Blueprint, request, jsonify` 的导入。如果没有，在文件顶部补上。

- [ ] **Step 5: 验证语法**

```bash
cd "C:\Users\Admin\Desktop\大家的Draft\zyh\golden"
python -c "import routes.settings; print('OK')"
```
Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add templates/panels/schedule.html static/timeline.js static/app.js routes/settings.py
git commit -m "feat: add 'auto-extend after repair' settings toggle

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: 种子配置

**Files:**
- Modify: `db.py:_seed_config()` — 添加一行默认配置

- [ ] **Step 1: 在 `_seed_config` 的 `schedule_settings` 区域添加种子配置**

在 `db.py` 的 `_seed_config` 函数中，找到 `schedule_settings` 分类的最后一项（`split_placement`），在其后添加：

```python
        ("schedule_settings", "auto_extend_after_repair", "1", 0),
```

- [ ] **Step 2: Commit**

```bash
git add db.py
git commit -m "feat: seed default config for auto_extend_after_repair

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: 端到端验证

- [ ] **Step 1: 重启服务器并验证**

```bash
# Restart Flask
cd "C:\Users\Admin\Desktop\大家的Draft\zyh\golden"
python app.py &
sleep 2
curl -s http://127.0.0.1:5000/ | head -c 200
```

Expected: 页面正常返回 HTML

- [ ] **Step 2: 测试自动延长逻辑**

```bash
python -c "
import requests, datetime

BASE = 'http://127.0.0.1:5000'
now = datetime.datetime.now()
now_min = now.hour * 60 + now.minute

# 准备：确保机器 BR1-01 不在维修停用，创建测试任务
import sqlite3
DB = r'C:\Users\Admin\.task_schedule_app\schedule_data.sqlite3'
conn = sqlite3.connect(DB)

# 确认 config 存在
conn.execute(\"INSERT OR REPLACE INTO config(category,key,value,sort_order) VALUES ('schedule_settings','auto_extend_after_repair','1',0)\")

# 创建测试任务：8:00-10:00
conn.execute(\"INSERT INTO schedules(date,machine_id,machine_name,task_id,task_name,task_type,task_kind,start_min,end_min,status,created_at) VALUES ('2026-06-01',1,'BR1-01',1,'测试任务','BR1','常规',480,600,'executing','\" + now.isoformat() + \"')\")
conn.commit()
conn.close()

# 步骤1: 标记维修
r = requests.post(f'{BASE}/set_machine_status', json={'id':1,'status':'维修停用'})
print('Step 1 (start repair):', r.json().get('repair',{}).get('action'))

# 步骤2: 恢复运行（触发延长）
r = requests.post(f'{BASE}/set_machine_status', json={'id':1,'status':'空闲'})
repair = r.json().get('repair',{})
print('Step 2 (end repair):', repair.get('action'))
ext = repair.get('auto_extended', {})
print('  Auto extended:', ext)

# 步骤3: 验证 end_min 已被延长
conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row
task = conn.execute('SELECT end_min FROM schedules WHERE machine_id=1 AND task_name=\"测试任务\" AND status=\"executing\"').fetchone()
print(f'  Updated end_min: {task[\"end_min\"]} (original: 600 = 10:00)')
conn.close()

if task['end_min'] > 600:
    print('SUCCESS: Task end_min was extended!')
else:
    print('WARNING: end_min not extended, check logic')
"
```

Expected: `end_min > 600`，自动延长的 tasks >= 1

- [ ] **Step 3: 测试开关关闭时不延长**

```bash
python -c "
import sqlite3, requests
DB = r'C:\Users\Admin\.task_schedule_app\schedule_data.sqlite3'
BASE = 'http://127.0.0.1:5000'

# 关闭开关
conn = sqlite3.connect(DB)
conn.execute(\"UPDATE config SET value='0' WHERE category='schedule_settings' AND key='auto_extend_after_repair'\")
# 重置测试任务
conn.execute(\"UPDATE schedules SET end_min=600 WHERE machine_id=1 AND task_name='测试任务'\")
conn.commit()
conn.close()

# 维修再恢复
requests.post(f'{BASE}/set_machine_status', json={'id':1,'status':'维修停用'})
r = requests.post(f'{BASE}/set_machine_status', json={'id':1,'status':'空闲'})

conn = sqlite3.connect(DB)
conn.row_factory = sqlite3.Row
task = conn.execute('SELECT end_min FROM schedules WHERE machine_id=1 AND task_name=\"测试任务\"').fetchone()
conn.close()

if task['end_min'] == 600:
    print('SUCCESS: end_min unchanged (switch OFF correctly skipped)')
else:
    print(f'FAIL: end_min changed to {task[\"end_min\"]} but should be 600')
"
```

Expected: `end_min == 600`（未延长）

- [ ] **Step 4: Commit any fixes if needed, then final verification**

---

### Task 6: 清理和最终确认

- [ ] **Step 1: 检查无残留调试代码** — 确认所有文件只有功能代码，无 `console.log` 或 `print` 调试语句
- [ ] **Step 2: 确认 git 状态干净**

```bash
git status
git log --oneline -5
```

Expected: 4 commits，无 uncommitted changes
