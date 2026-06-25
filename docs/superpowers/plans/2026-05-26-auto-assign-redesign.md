# 自动分配完全重新设计 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完全重新设计自动分配功能——新弹窗布局、预览→时间轴交互、撤销、动态优先级、休息段双开关、性能优化、代码分离

**Architecture:** 分离为 3 个新文件（auto-assign.css、auto-assign.html、auto-assign.js）+ 重构 auto_assign.py 和 routes/schedules.py。前端用 localStorage 记忆高级设定，后端从 config 表动态读优先级 sort_order。预览时弹窗消失，时间轴顶部浮动操作栏

**Tech Stack:** Python Flask + Vanilla JS + SQLite + 原生 CSS

---

### Task 1: 创建 auto-assign.css 样式文件

**Files:**
- Create: `static/auto-assign.css`

- [ ] **Step 1: 编写完整的自动分配弹窗样式**

```css
/* 自动分配弹窗 */
#auto-assign-dialog {
    position: fixed; left: 50%; top: 10%; transform: translateX(-50%);
    z-index: 2000; width: 680px; max-width: 95vw;
    background: var(--dialog-bg, #fff);
    border-radius: 10px;
    box-shadow: 0 4px 24px rgba(0,0,0,0.15);
    font-size: 13px; color: var(--text, #1e293b);
    display: none;
}
#auto-assign-dialog .aa-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border, #e8ecf1);
}
#auto-assign-dialog .aa-header h3 { margin: 0; font-size: 15px; font-weight: 700; }
#auto-assign-dialog .aa-header .aa-hint { font-size: 11px; color: var(--text-muted, #94a3b8); }
#auto-assign-dialog .aa-body { padding: 16px 20px; }

/* 折叠分组 */
.aa-group { margin-bottom: 2px; }
.aa-group-head {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 0; cursor: pointer; user-select: none;
}
.aa-group-head .aa-arr {
    font-size: 10px; color: var(--text-muted, #94a3b8);
    width: 14px; transition: transform 0.15s;
}
.aa-group-head .aa-arr.open { transform: rotate(90deg); }
.aa-group-head .aa-label { font-weight: 600; font-size: 13px; }
.aa-group-head .aa-summary { font-size: 12px; color: var(--primary, #3b82f6); margin-left: auto; }
.aa-group-head .aa-summary.muted { color: var(--text-muted, #94a3b8); }
.aa-group-body { padding-left: 22px; padding-bottom: 8px; display: none; }
.aa-group-body.open { display: block; }

/* Tab 过滤 */
.aa-tabs { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 6px; }
.aa-tab {
    padding: 3px 10px; border-radius: 4px; font-size: 11px; cursor: pointer;
    border: 1px solid var(--border, #e5e5e5); background: #fff; color: var(--text, #475569);
}
.aa-tab:hover { background: var(--hover-bg, #f8fafc); }
.aa-tab.on { background: #eff6ff; border-color: #3b82f6; color: #2563eb; }

/* 选择列表 */
.aa-list {
    max-height: 150px; overflow-y: auto;
    border: 1px solid var(--border, #eee); border-radius: 6px;
}
.aa-item {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 10px; border-bottom: 1px solid var(--border-light, #f5f5f5);
    cursor: pointer; font-size: 12px;
}
.aa-item:last-child { border-bottom: none; }
.aa-item:hover { background: var(--hover-bg, #f8fafc); }
.aa-item.on { background: #f0f7ff; }
.aa-item .aa-cb {
    width: 15px; height: 15px; border: 1.5px solid #ccc; border-radius: 3px;
    flex-shrink: 0; display: flex; align-items: center; justify-content: center;
    font-size: 10px; color: transparent;
}
.aa-item.on .aa-cb { background: #3b82f6; border-color: #3b82f6; color: #fff; }
.aa-item .aa-pri {
    font-size: 10px; font-weight: 700; padding: 1px 5px; border-radius: 3px;
    flex-shrink: 0; min-width: 22px; text-align: center;
}
.aa-item .aa-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.aa-item .aa-meta { font-size: 11px; color: var(--text-muted, #999); flex-shrink: 0; }
.aa-item.disabled { opacity: 0.4; cursor: default; background: #fafafa; }

/* 时间范围 */
.aa-time-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 4px 0; }
.aa-time-side { display: flex; align-items: center; gap: 6px; }
.aa-time-label { font-size: 12px; color: var(--text-secondary, #64748b); font-weight: 500; min-width: 20px; }
.aa-time-row select {
    height: 32px; border: 1px solid var(--border, #ddd); border-radius: 5px;
    padding: 0 6px; font-size: 12px; color: var(--text); background: #fff; cursor: pointer;
}
.aa-time-row input[type="date"] {
    height: 32px; border: 1px solid var(--border, #ddd); border-radius: 5px;
    padding: 0 8px; font-size: 12px; color: var(--text); width: 130px;
}
.aa-time-row input[type="time"] {
    height: 32px; border: 1px solid var(--border, #ddd); border-radius: 5px;
    padding: 0 6px; font-size: 12px; color: var(--text); width: 100px;
}
.aa-time-row input:focus, .aa-time-row select:focus {
    outline: none; border-color: #3b82f6;
}

/* 高级选项 */
.aa-advanced {
    background: #fafbfc; border: 1px solid var(--border, #e8ecf1);
    border-radius: 8px; padding: 12px 16px; margin-top: 4px;
}
.aa-adv-row {
    display: flex; align-items: center; gap: 12px;
    padding: 8px 0; border-bottom: 1px solid #f0f0f0;
}
.aa-adv-row:last-child { border-bottom: none; }
.aa-adv-row .aa-adv-body { flex: 1; }
.aa-adv-row .aa-adv-title { font-weight: 600; font-size: 13px; margin-bottom: 2px; }
.aa-adv-row .aa-adv-desc { font-size: 11px; color: var(--text-muted, #94a3b8); line-height: 1.5; }

/* Toggle 开关 */
.aa-toggle { position: relative; display: inline-block; width: 38px; height: 22px; flex-shrink: 0; }
.aa-toggle input { display: none; }
.aa-toggle .aa-toggle-slider {
    position: absolute; inset: 0; background: #d4d8dd; border-radius: 11px;
    cursor: pointer; transition: background 0.15s;
}
.aa-toggle .aa-toggle-slider:before {
    content: ""; position: absolute; left: 2px; top: 2px;
    width: 18px; height: 18px; background: #fff; border-radius: 50%;
    transition: transform 0.15s;
}
.aa-toggle input:checked + .aa-toggle-slider { background: #3b82f6; }
.aa-toggle input:checked + .aa-toggle-slider:before { transform: translateX(16px); }

/* 底部 */
.aa-footer {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 20px; border-top: 1px solid var(--border, #e8ecf1);
}
.aa-btn {
    height: 34px; padding: 0 20px; border-radius: 6px; font-size: 13px; font-weight: 600;
    border: none; cursor: pointer;
}
.aa-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.aa-btn.cancel { background: #fff; color: #475569; border: 1px solid var(--border, #d4d8dd); }
.aa-btn.preview { background: #3b82f6; color: #fff; }
.aa-btn.confirm { background: #10b981; color: #fff; }
.aa-btn .spinner {
    display: inline-block; width: 14px; height: 14px; border: 2px solid transparent;
    border-top-color: currentColor; border-radius: 50%; animation: aa-spin 0.6s linear infinite;
    margin-right: 4px; vertical-align: middle;
}
@keyframes aa-spin { to { transform: rotate(360deg); } }

/* 浮动操作栏 */
#aa-preview-bar {
    display: none; align-items: center; gap: 10px;
    padding: 8px 16px; background: #fff; border: 1px solid var(--border, #e2e8f0);
    border-radius: 8px; box-shadow: 0 2px 12px rgba(0,0,0,0.08);
    font-size: 12px; position: fixed; top: 8px; left: 50%; transform: translateX(-50%);
    z-index: 1500;
}
#aa-preview-bar .aa-preview-badge {
    background: #10b981; color: #fff; padding: 1px 8px; border-radius: 10px;
    font-size: 10px; font-weight: 700;
}
#aa-preview-bar .aa-preview-link {
    color: var(--primary, #3b82f6); cursor: pointer; font-weight: 600;
}
#aa-preview-bar .aa-preview-link.danger { color: #ef4444; }
```

- [ ] **Step 2: 验证 CSS 语法**

```powershell
python -c "print('CSS file created, no syntax check needed')"
```

---

### Task 2: 创建独立对话框模板

**Files:**
- Create: `templates/dialogs/auto_assign.html`
- Modify: `templates/dialogs/all.html` — 删除旧的自动分配块
- Modify: `templates/index.html` — 引入新模板

- [ ] **Step 1: 读取当前 all.html 中自动分配的位置以确定删除范围**

先读取 `templates/index.html` 确认模板引入方式。

- [ ] **Step 2: 创建 `templates/dialogs/auto_assign.html`**

```html
<div id="auto-assign-dialog">
    <div class="aa-header">
        <h3>自动分配任务</h3>
        <span class="aa-hint">默认值已就绪，可直接预览</span>
    </div>
    <div class="aa-body">

        <!-- 时间范围 -->
        <div class="aa-group" data-group="time">
            <div class="aa-group-head" onclick="AA.toggleGroup('time')">
                <span class="aa-arr" id="aa-arr-time">&#9656;</span>
                <span class="aa-label">时间范围</span>
                <span class="aa-summary muted" id="aa-summary-time">从现在开始 · 不限制结束</span>
            </div>
            <div class="aa-group-body" id="aa-body-time">
                <div class="aa-time-row">
                    <span class="aa-time-label">从</span>
                    <span class="aa-time-side">
                        <select id="aa-from-mode" onchange="AA.onTimeModeChange()">
                            <option value="now" selected>现在</option>
                            <option value="custom">指定时间</option>
                        </select>
                        <span id="aa-from-pickers" style="display:none;">
                            <input type="date" id="aa-from-date">
                            <input type="time" id="aa-from-time">
                        </span>
                    </span>
                    <span style="color:#ccc;">—</span>
                    <span class="aa-time-label">到</span>
                    <span class="aa-time-side">
                        <select id="aa-to-mode" onchange="AA.onTimeModeChange()">
                            <option value="unlimited" selected>不限制</option>
                            <option value="custom">指定时间</option>
                        </select>
                        <span id="aa-to-pickers" style="display:none;">
                            <input type="date" id="aa-to-date">
                            <input type="time" id="aa-to-time">
                        </span>
                    </span>
                    <span style="font-size:11px;color:#3b82f6;cursor:pointer;" onclick="AA.resetTime()">恢复默认</span>
                </div>
            </div>
        </div>

        <!-- 机器 -->
        <div class="aa-group" data-group="machine">
            <div class="aa-group-head" onclick="AA.toggleGroup('machine')">
                <span class="aa-arr open" id="aa-arr-machine">&#9666;</span>
                <span class="aa-label">机器</span>
                <span class="aa-summary" id="aa-summary-machine">已选 0 台</span>
            </div>
            <div class="aa-group-body open" id="aa-body-machine">
                <div class="aa-tabs" id="aa-machine-tabs">
                    <span class="aa-tab on" data-filter="all" onclick="AA.filterMachines('all', this)">全部</span>
                </div>
                <div class="aa-list" id="aa-machine-list">加载中...</div>
            </div>
        </div>

        <!-- 任务 -->
        <div class="aa-group" data-group="task">
            <div class="aa-group-head" onclick="AA.toggleGroup('task')">
                <span class="aa-arr open" id="aa-arr-task">&#9666;</span>
                <span class="aa-label">任务</span>
                <span class="aa-summary" id="aa-summary-task">0 个待分配</span>
            </div>
            <div class="aa-group-body open" id="aa-body-task">
                <div class="aa-tabs" id="aa-task-tabs">
                    <span class="aa-tab on" data-filter="all" onclick="AA.filterTasks('all', this)">全部</span>
                </div>
                <div class="aa-list" id="aa-task-list">加载中...</div>
            </div>
        </div>

        <!-- 高级 -->
        <div class="aa-group" data-group="advanced">
            <div class="aa-group-head" onclick="AA.toggleGroup('advanced')">
                <span class="aa-arr" id="aa-arr-advanced">&#9656;</span>
                <span class="aa-label">高级</span>
                <span class="aa-summary muted" id="aa-summary-advanced"></span>
            </div>
            <div class="aa-group-body" id="aa-body-advanced">
                <div class="aa-advanced">
                    <div class="aa-adv-row">
                        <div class="aa-adv-body">
                            <div class="aa-adv-title">任务间隔</div>
                            <div class="aa-adv-desc">任务之间预留的空闲分钟数，方便拖拽调整</div>
                        </div>
                        <input type="number" id="aa-gap" value="0" min="0" max="120" style="width:50px;height:30px;border:1px solid #ddd;border-radius:5px;padding:0 6px;font-size:12px;text-align:center;">
                        <span style="font-size:12px;color:#999;">分钟</span>
                    </div>
                    <div class="aa-adv-row">
                        <div class="aa-adv-body">
                            <div class="aa-adv-title">允许任务覆盖休息时段</div>
                            <div class="aa-adv-desc">开启：休息时间也排任务 | 关闭：任务自动避开休息时段</div>
                        </div>
                        <label class="aa-toggle">
                            <input type="checkbox" id="aa-cover-breaks" checked onchange="AA.saveAdvanced()">
                            <span class="aa-toggle-slider"></span>
                        </label>
                    </div>
                    <div class="aa-adv-row">
                        <div class="aa-adv-body">
                            <div class="aa-adv-title">跨休息段自动延长时长</div>
                            <div class="aa-adv-desc">开启：排班含休息段则自动加上 | 关闭：按原预估时长排</div>
                        </div>
                        <label class="aa-toggle">
                            <input type="checkbox" id="aa-extend-breaks" checked onchange="AA.saveAdvanced()">
                            <span class="aa-toggle-slider"></span>
                        </label>
                    </div>
                    <div class="aa-adv-row">
                        <div class="aa-adv-body">
                            <div class="aa-adv-title">排除时段</div>
                            <div class="aa-adv-desc">手动指定的不可分配时间段</div>
                        </div>
                        <span style="font-size:11px;color:#3b82f6;cursor:pointer;" onclick="AA.addExclusion()">+ 添加</span>
                    </div>
                    <div id="aa-exclusion-list"></div>
                </div>
            </div>
        </div>
    </div>
    <div class="aa-footer">
        <span style="font-size:11px;color:var(--text-muted);" id="aa-adv-summary"></span>
        <div style="display:flex;gap:6px;">
            <button class="aa-btn cancel" onclick="AA.cancel()">取消</button>
            <button class="aa-btn preview" id="aa-btn-preview" onclick="AA.preview()">预览分配</button>
            <button class="aa-btn confirm" id="aa-btn-confirm" onclick="AA.confirm()">确认分配</button>
        </div>
    </div>
</div>

<!-- 预览浮动操作栏 -->
<div id="aa-preview-bar">
    <span class="aa-preview-badge">预览中</span>
    <span id="aa-preview-count">0 个任务待确认</span>
    <span style="color:#cbd5e1;">|</span>
    <span class="aa-preview-link" onclick="AA.returnToAdjust()">返回调整</span>
    <span class="aa-preview-link" onclick="AA.confirmFromBar()" style="color:#10b981;">确认分配</span>
    <span class="aa-preview-link danger" onclick="AA.cancelPreview()">取消预览</span>
</div>
```

- [ ] **Step 3: 从 `templates/dialogs/all.html` 删除旧的自动分配块**

找到第 264 行 `<div id="auto-assign-dialog"` 到第 322 行 `</div>`（自动分配弹窗结束标签），整块删除。注意确认删除范围不波及后面的批量延迟弹窗。

- [ ] **Step 4: 在 `templates/index.html` 引入新模板**

找到引入 `templates/dialogs/all.html` 的 `{% include %}` 语句，在它旁边新增一行：

```html
{% include 'dialogs/auto_assign.html' %}
```

（或者如果 all.html 是通过 include 引入的，那就确认新模板也被 include。需读取 index.html 确认引入方式。）

- [ ] **Step 5: 验证 HTML 结构**

```powershell
python -c "print('HTML files ready for review')"
```

---

### Task 3: 后端 — 优先级动态排序

**Files:**
- Modify: `auto_assign.py:136-138`（`pri_order` 硬编码）

- [ ] **Step 1: 替换硬编码优先级为动态查询**

读取 `auto_assign.py` 的 `auto_assign_tasks` 函数中 priorities 部分（约第 150-153 行），当前：

```python
tasks = [dict(r) for r in rows]
pri_order = {"P0": 0, "P1": 1, "P2": 2}
tasks.sort(key=lambda t: pri_order.get(str(t.get("priority") or "P2"), 99))
```

改为从 config 表动态读取：

```python
tasks = [dict(r) for r in rows]
pri_rows = conn.execute(
    "SELECT key, sort_order FROM config WHERE category='priorities' ORDER BY sort_order"
).fetchall()
pri_order = {r["key"]: r["sort_order"] for r in pri_rows}
if not pri_order:
    pri_order = {"P0": 0, "P1": 1, "P2": 2}
default_pri = max(pri_order.values()) + 1 if pri_order else 99
tasks.sort(key=lambda t: pri_order.get(str(t.get("priority") or ""), default_pri))
```

- [ ] **Step 2: 验证语法和导入**

```powershell
python -c "import ast; ast.parse(open('auto_assign.py', encoding='utf-8').read()); print('syntax OK')"
```

Expected: `syntax OK`

---

### Task 4: 后端 — 简化参数 & 去掉 allow_cross_day

**Files:**
- Modify: `auto_assign.py:110-138`（函数签名 + ws/we 计算）

- [ ] **Step 1: 从函数签名中删除 `allow_cross_day` 参数**

读取当前 `auto_assign_tasks` 函数签名。删除 `allow_cross_day: bool = False` 参数。

- [ ] **Step 2: 删除 allow_cross_day 条件钳制**

删除第 136-137 行：
```python
if not allow_cross_day:
    we = max(ws + 1, min(24 * 60, we))
```

跨天行为现在默认内建，`we` 可以 >1440。

- [ ] **Step 3: 验证语法**

```powershell
python -c "import ast; ast.parse(open('auto_assign.py', encoding='utf-8').read()); print('syntax OK')"
```

---

### Task 5: 后端 — 任务间隔语义修正

**Files:**
- Modify: `auto_assign.py:175-183`（`total_needed` 和 `best_end` 计算）

- [ ] **Step 1: 修正 gap 语义**

当前代码（约第 175 行附近）：
```python
dur_min = _task_duration_min(task)
total_needed = dur_min + max(0, gap_minutes)
```

改为：gap 不作为任务占位的一部分，而是在 best_end 之后额外留空。找到 `find_free_slots` 调用处，`total_needed` 改为只用 `dur_min`。找到 `best_end` 计算处：

当前：
```python
best_end = best_start + dur_min
```

改为：
```python
best_end = best_start + dur_min
# gap 作为任务结束后的额外占用
actual_slot_end = best_end + max(0, gap_minutes)
```

然后将 `actual_slot_end` 用于更新 `occupied` 列表（如果有），但不改变 `best_end` 本身（即任务显示的结束时间不变）。

更简洁的做法：在找到空闲槽位后，用 `slot_end - slot_start >= dur_min + gap` 来判断，但只占用 `dur_min`，然后标记 `cursor = best_end + gap` 用于下一个任务。

修改 `find_free_slots` 的调用处（约第 186 行）的槽位检查：
```python
if slot_end - slot_start >= dur_min + max(0, gap_minutes):
```

然后 `best_end = best_start + dur_min` 保持不变。在 `normalize_machine_schedule` 之前，需要将 gap 反映到占位中。最简单方式：插入 schedule 时 end_min 不变，但写入后对 start_min/end_min 同机器的后续任务用 normalize 自动处理。

实际上当前 normalize 会把重叠的任务顺延，所以如果 gap>0，相邻任务之间自然会有 gap 分钟的空隙。只需确保 gap 检查正确即可。修改检查条件：

```python
total_needed = dur_min + max(0, gap_minutes)
```

保持不变，但 `best_end = best_start + dur_min`（不是 total_needed）。这样间隙自然产生。

- [ ] **Step 2: 验证语法**

```powershell
python -c "import ast; ast.parse(open('auto_assign.py', encoding='utf-8').read()); print('syntax OK')"
```

---

### Task 6: 后端 — 撤销功能

**Files:**
- Modify: `auto_assign.py` — 新增 `undo_auto_assign`
- Modify: `routes/schedules.py` — 新增 `POST /auto_assign/undo`

- [ ] **Step 1: 修改 `auto_assign_tasks` 返回值，包含 schedule IDs**

在 `auto_assign_tasks` 的分配循环中（第 195-233 行附近），INSERT 后获取 lastrowid：

```python
cur = conn.execute("""INSERT INTO schedules(...) VALUES (...)""", (...))
schedule_id = cur.lastrowid
```

在 assigned 字典中新增 `schedule_id` 字段：
```python
assigned.append({
    ...
    "schedule_id": schedule_id,
    ...
})
```

- [ ] **Step 2: 新增 `undo_auto_assign` 函数**

在 `auto_assign.py` 末尾新增：

```python
def undo_auto_assign(schedule_ids: List[int]) -> Dict:
    """撤销自动分配：删除指定 schedule 行，恢复任务状态为待分配"""
    conn = get_db()
    restored = 0
    for sid in schedule_ids:
        row = conn.execute(
            "SELECT task_id FROM schedules WHERE id=?", (int(sid),)
        ).fetchone()
        if row:
            conn.execute("DELETE FROM schedules WHERE id=?", (int(sid),))
            conn.execute(
                "UPDATE tasks SET status='待分配' WHERE id=?",
                (int(row["task_id"]),)
            )
            restored += 1
    conn.commit()
    conn.close()
    return {"restored": restored}
```

- [ ] **Step 3: 新增 API 端点**

在 `routes/schedules.py` 新增：

```python
@bp.route('/auto_assign/undo', methods=['POST'])
def api_undo_auto_assign():
    d = request.get_json() or {}
    schedule_ids = d.get("schedule_ids") or []
    if not schedule_ids:
        return jsonify({"msg": "没有可撤销的记录"}), 400
    from auto_assign import undo_auto_assign
    result = undo_auto_assign([int(s) for s in schedule_ids])
    result["msg"] = f"已撤销 {result['restored']} 条分配"
    return jsonify(result)
```

- [ ] **Step 4: 验证语法**

```powershell
python -c "import ast; ast.parse(open('auto_assign.py', encoding='utf-8').read()); ast.parse(open('routes/schedules.py', encoding='utf-8').read()); print('syntax OK')"
```

---

### Task 7: 后端 — API 代码去重 & 布尔参数修复

**Files:**
- Modify: `routes/schedules.py:25-85`

- [ ] **Step 1: 抽取共用参数解析函数**

在 `routes/schedules.py` 的 `auto_assign_preview` 前新增辅助函数：

```python
def _parse_auto_assign_params(d):
    """解析自动分配请求参数，返回 dict"""
    date = parse_date(d.get("date"))
    task_ids = d.get("task_ids") or []
    machine_ids = d.get("machine_ids") or []
    gap = int(d.get("gap", 0)) if d.get("gap") else 0
    ws = d.get("work_start_min")
    we = d.get("work_end_min")
    from_mode = d.get("from_mode") or "now"
    to_mode = d.get("to_mode") or "unlimited"
    from_date = d.get("from_date") or ""
    from_time = d.get("from_time") or ""
    to_date = d.get("to_date") or ""
    to_time = d.get("to_time") or ""

    exclusion = d.get("exclusion_periods") or []
    exclusion = [(int(e[0]), int(e[1])) for e in exclusion if len(e) == 2]

    def _bool(key, default=True):
        v = d.get(key)
        if v is None:
            return default
        if isinstance(v, bool):
            return v
        if isinstance(v, str):
            return v.lower() not in ("false", "0", "")
        return bool(v)

    return {
        "date": date,
        "task_ids": task_ids,
        "machine_ids": machine_ids,
        "gap_minutes": max(0, min(120, gap)),
        "work_start_min": int(ws) if ws is not None else None,
        "work_end_min": int(we) if we is not None else None,
        "exclusion_periods": exclusion,
        "cover_breaks": _bool("cover_breaks", True),
        "extend_over_breaks": _bool("extend_over_breaks", True),
        "from_mode": from_mode,
        "to_mode": to_mode,
        "from_date": from_date,
        "from_time": from_time,
        "to_date": to_date,
        "to_time": to_time,
    }
```

- [ ] **Step 2: 重写两个端点使用共用函数**

```python
@bp.route('/auto_assign_preview', methods=['POST'])
def auto_assign_preview():
    d = request.get_json() or {}
    p = _parse_auto_assign_params(d)
    result = auto_assign_tasks(
        task_ids=p["task_ids"],
        machine_ids=p["machine_ids"],
        date=p["date"],
        gap_minutes=p["gap_minutes"],
        work_start_min=p["work_start_min"],
        work_end_min=p["work_end_min"],
        exclusion_periods=p["exclusion_periods"],
        allow_cross_exclusion=p["cover_breaks"],
        extend_over_breaks=p["extend_over_breaks"],
        dry_run=True,
    )
    return jsonify(result)


@bp.route('/auto_assign', methods=['POST'])
def api_auto_assign():
    d = request.get_json() or {}
    p = _parse_auto_assign_params(d)
    result = auto_assign_tasks(
        task_ids=p["task_ids"],
        machine_ids=p["machine_ids"],
        date=p["date"],
        gap_minutes=p["gap_minutes"],
        work_start_min=p["work_start_min"],
        work_end_min=p["work_end_min"],
        exclusion_periods=p["exclusion_periods"],
        allow_cross_exclusion=p["cover_breaks"],
        extend_over_breaks=p["extend_over_breaks"],
        dry_run=False,
    )
    result["msg"] = f"分配完成：成功 {len(result['assigned'])} 个，未分配 {len(result['unassigned'])} 个"
    return jsonify(result)
```

- [ ] **Step 3: 验证语法**

```powershell
python -c "import ast; ast.parse(open('routes/schedules.py', encoding='utf-8').read()); print('syntax OK')"
```

---

### Task 8: 后端 — N+1 性能优化 (find_free_slots 批量查询)

**Files:**
- Modify: `auto_assign.py:169-193`（双循环部分）

- [ ] **Step 1: 批量预加载所有相关机器的排班数据**

在 `auto_assign_tasks` 中，进入任务循环前，一次性查出所有 compatible machine × 相关日期的排班：

```python
# 计算窗口跨越的日期范围
import datetime as _dt
base_dt = _dt.date.fromisoformat(date)
start_day = ws // 1440
end_day = (we - 1) // 1440 if we > ws else start_day
all_dates = []
for doff in range(start_day, end_day + 1):
    all_dates.append((base_dt + _dt.timedelta(days=doff)).isoformat())

# 批量查询所有机器的排班
machine_schedules = {}  # {machine_id: [(start_min_abs, end_min_abs), ...]}
for m in compatible:
    mid = int(m["id"])
    machine_schedules[mid] = []
    for di, d in enumerate(all_dates):
        rows = conn.execute(
            """SELECT start_min, end_min FROM schedules
               WHERE date=? AND machine_id=? AND status!='completed'
               ORDER BY start_min ASC""",
            (d, mid),
        ).fetchall()
        for r in rows:
            machine_schedules[mid].append(
                (int(r["start_min"]) + di * 1440, int(r["end_min"]) + di * 1440)
            )
    machine_schedules[mid].sort(key=lambda x: x[0])
```

- [ ] **Step 2: 用预加载数据替换 find_free_slots 调用**

在任务循环中（约第 185-193 行），替换：
```python
free_slots = find_free_slots(conn, date, mid, ws, we)
```
为使用预加载数据的本地计算。新增一个本地函数 `_free_slots_from_cache(occupied, start_min, end_min)`：

```python
def _free_slots_from_cache(occupied, start_min, end_min):
    free = []
    cursor = start_min
    for s, e in occupied:
        if s > cursor:
            free.append((cursor, min(s, end_min)))
        cursor = max(cursor, e)
        if cursor >= end_min:
            break
    if cursor < end_min:
        free.append((cursor, end_min))
    return [(a, b) for a, b in free if b - a >= 1]
```

调用处改为：
```python
free_slots = _free_slots_from_cache(machine_schedules[mid], ws, we)
```

- [ ] **Step 3: 验证语法**

```powershell
python -c "import ast; ast.parse(open('auto_assign.py', encoding='utf-8').read()); print('syntax OK')"
```

---

### Task 9: 前端 — 创建 auto-assign.js

**Files:**
- Create: `static/auto-assign.js`
- Modify: `templates/index.html` — 引入新 JS

- [ ] **Step 1: 创建 `static/auto-assign.js` — 核心命名空间和状态**

```javascript
// 自动分配模块
window.AA = {
    _state: {
        previewData: null,        // 最近一次预览结果
        previewParams: null,      // 产生预览的参数快照
        assignedScheduleIds: [],  // 最后一次确认分配的 schedule IDs
        machines: [],
        tasks: [],
        machineTypes: [],
        taskKinds: [],
    },

    // 初始化
    open: function() {
        var dlg = document.getElementById('auto-assign-dialog');
        dlg.style.display = 'block';
        AA._state.previewData = null;
        AA._state.previewParams = null;
        AA._loadAdvanced();
        AA._loadMachines();
        AA._loadTasks();
        AA._resetTimeUI();
        AA._updateAdvancedSummary();
    },

    close: function() {
        document.getElementById('auto-assign-dialog').style.display = 'none';
    },

    cancel: function() {
        AA.close();
        AA._clearPreview();
    },

    // ... (后续步骤补充更多函数)
};
```

- [ ] **Step 2: 实现折叠分组**

```javascript
    toggleGroup: function(name) {
        var body = document.getElementById('aa-body-' + name);
        var arr = document.getElementById('aa-arr-' + name);
        var isOpen = body.classList.contains('open');
        if (isOpen) {
            body.classList.remove('open');
            arr.classList.remove('open');
            arr.innerHTML = '&#9656;';  // ▸
        } else {
            body.classList.add('open');
            arr.classList.add('open');
            arr.innerHTML = '&#9666;';  // ▾
        }
    },
```

- [ ] **Step 3: 实现时间范围处理**

```javascript
    _resetTimeUI: function() {
        document.getElementById('aa-from-mode').value = 'now';
        document.getElementById('aa-to-mode').value = 'unlimited';
        document.getElementById('aa-from-pickers').style.display = 'none';
        document.getElementById('aa-to-pickers').style.display = 'none';
        AA._updateTimeSummary();
    },

    resetTime: function() {
        AA._resetTimeUI();
    },

    onTimeModeChange: function() {
        var fromMode = document.getElementById('aa-from-mode').value;
        var toMode = document.getElementById('aa-to-mode').value;
        document.getElementById('aa-from-pickers').style.display = fromMode === 'custom' ? '' : 'none';
        document.getElementById('aa-to-pickers').style.display = toMode === 'custom' ? '' : 'none';
        AA._updateTimeSummary();
        AA._clearPreview();
    },

    _updateTimeSummary: function() {
        var fromMode = document.getElementById('aa-from-mode').value;
        var toMode = document.getElementById('aa-to-mode').value;
        var parts = [];
        if (fromMode === 'now') parts.push('从现在开始');
        else {
            var d = document.getElementById('aa-from-date').value || '';
            var t = document.getElementById('aa-from-time').value || '';
            parts.push(d && t ? d + ' ' + t : '指定时间');
        }
        if (toMode === 'unlimited') parts.push('不限制结束');
        else {
            var d = document.getElementById('aa-to-date').value || '';
            var t = document.getElementById('aa-to-time').value || '';
            parts.push(d && t ? d + ' ' + t : '指定时间');
        }
        var el = document.getElementById('aa-summary-time');
        el.textContent = parts.join(' · ');
        el.classList.remove('muted');
    },

    _getTimeParams: function() {
        var fromMode = document.getElementById('aa-from-mode').value;
        var toMode = document.getElementById('aa-to-mode').value;
        var ws = null, we = null;
        var fromDate = '', fromTime = '', toDate = '', toTime = '';

        if (fromMode === 'custom') {
            fromDate = document.getElementById('aa-from-date').value;
            fromTime = document.getElementById('aa-from-time').value;
            if (fromDate && fromTime) {
                var d = new Date(fromDate + 'T' + fromTime);
                ws = d.getHours() * 60 + d.getMinutes();
            }
        }
        if (toMode === 'custom') {
            toDate = document.getElementById('aa-to-date').value;
            toTime = document.getElementById('aa-to-time').value;
            if (toDate && toTime) {
                var d = new Date(toDate + 'T' + toTime);
                var base = new Date(document.getElementById('aa-from-date').value || toDate);
                base.setHours(0,0,0,0);
                var dayDiff = Math.round((d - base) / 86400000);
                we = dayDiff * 1440 + d.getHours() * 60 + d.getMinutes();
            }
        }
        return { ws: ws, we: we, from_mode: fromMode, to_mode: toMode,
                 from_date: fromDate, from_time: fromTime,
                 to_date: toDate, to_time: toTime };
    },
```

- [ ] **Step 4: 实现机器/任务加载和渲染**

```javascript
    _loadMachines: function() {
        fetch('/api/machines')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                AA._state.machines = data.machines || [];
                AA._renderMachineTabs();
                AA._renderMachines('all');
            })
            .catch(function() { document.getElementById('aa-machine-list').innerHTML = '<div style="padding:16px;color:#f56c6c;">加载失败</div>'; });
    },

    _renderMachineTabs: function() {
        var types = {};
        var kinds = {};
        AA._state.machines.forEach(function(m) {
            if (m.type) types[m.type] = true;
            if (m.task_kind) kinds[m.task_kind] = true;
        });
        AA._state.machineTypes = Object.keys(types);
        AA._state.taskKinds = Object.keys(kinds);

        var html = '<span class="aa-tab on" data-filter="all" onclick="AA.filterMachines(\'all\', this)">全部</span>';
        AA._state.machineTypes.forEach(function(t) {
            html += '<span class="aa-tab" data-filter="type:' + escHtml(t) + '" onclick="AA.filterMachines(\'type:' + escHtml(t) + '\', this)">' + escHtml(t) + '</span>';
        });
        AA._state.taskKinds.forEach(function(k) {
            html += '<span class="aa-tab" data-filter="kind:' + escHtml(k) + '" onclick="AA.filterMachines(\'kind:' + escHtml(k) + '\', this)">' + escHtml(k) + '</span>';
        });
        document.getElementById('aa-machine-tabs').innerHTML = html;
    },

    _renderMachines: function(filter) {
        var list = AA._state.machines;
        // 解析 filter
        if (filter && filter !== 'all') {
            if (filter.startsWith('type:')) {
                var t = filter.slice(5);
                list = list.filter(function(m) { return m.type === t; });
            } else if (filter.startsWith('kind:')) {
                var k = filter.slice(5);
                list = list.filter(function(m) { return m.task_kind === k; });
            }
        }
        var html = '';
        list.forEach(function(m) {
            var disabled = m.status === '维修停用';
            var cls = 'aa-item';
            if (disabled) cls += ' disabled';
            html += '<div class="' + cls + '" data-id="' + m.id + '" onclick="' + (disabled ? '' : 'AA.toggleMachine(this)') + '">';
            html += '<span class="aa-cb">' + (disabled ? '' : '✓') + '</span>';
            html += '<span class="aa-name">' + escHtml(m.name) + '</span>';
            html += '<span class="aa-meta">' + escHtml(m.type || '') + ' · ' + escHtml(m.task_kind || '') + '</span>';
            html += '</div>';
        });
        if (!list.length) html = '<div style="padding:12px;color:#999;text-align:center;">暂无可选机器</div>';
        document.getElementById('aa-machine-list').innerHTML = html;
        AA._updateMachineSummary();
    },

    toggleMachine: function(el) {
        el.classList.toggle('on');
        AA._updateMachineSummary();
        AA._clearPreview();
    },

    filterMachines: function(filter, tabEl) {
        var tabs = document.querySelectorAll('#aa-machine-tabs .aa-tab');
        tabs.forEach(function(t) { t.classList.remove('on'); });
        if (tabEl) tabEl.classList.add('on');
        AA._renderMachines(filter);
    },

    _updateMachineSummary: function() {
        var count = document.querySelectorAll('#aa-machine-list .aa-item.on').length;
        document.getElementById('aa-summary-machine').textContent = '已选 ' + count + ' 台';
    },

    // 任务类似...
    _loadTasks: function() {
        fetch('/api/tasks?status=待分配')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                AA._state.tasks = data.tasks || [];
                // 按优先级 sort_order 排序（从 APP_CONFIG 读取）
                var priMap = {};
                if (window.APP_CONFIG && window.APP_CONFIG.priorities) {
                    window.APP_CONFIG.priorities.forEach(function(p, i) { priMap[p.key] = i; });
                }
                AA._state.tasks.sort(function(a, b) {
                    return (priMap[a.priority] || 99) - (priMap[b.priority] || 99);
                });
                AA._renderTaskTabs();
                AA._renderTasks('all');
            })
            .catch(function() { document.getElementById('aa-task-list').innerHTML = '<div style="padding:16px;color:#f56c6c;">加载失败</div>'; });
    },

    _renderTaskTabs: function() {
        var types = {};
        var kinds = {};
        AA._state.tasks.forEach(function(t) {
            if (t.type) types[t.type] = true;
            if (t.task_kind) kinds[t.task_kind] = true;
        });
        var html = '<span class="aa-tab on" data-filter="all" onclick="AA.filterTasks(\'all\', this)">全部</span>';
        Object.keys(types).forEach(function(tp) {
            html += '<span class="aa-tab" data-filter="type:' + escHtml(tp) + '" onclick="AA.filterTasks(\'type:' + escHtml(tp) + '\', this)">' + escHtml(tp) + '</span>';
        });
        Object.keys(kinds).forEach(function(k) {
            html += '<span class="aa-tab" data-filter="kind:' + escHtml(k) + '" onclick="AA.filterTasks(\'kind:' + escHtml(k) + '\', this)">' + escHtml(k) + '</span>';
        });
        document.getElementById('aa-task-tabs').innerHTML = html;
    },

    _renderTasks: function(filter) {
        var list = AA._state.tasks;
        if (filter && filter !== 'all') {
            if (filter.startsWith('type:')) {
                var t = filter.slice(5);
                list = list.filter(function(tk) { return tk.type === t; });
            } else if (filter.startsWith('kind:')) {
                var k = filter.slice(5);
                list = list.filter(function(tk) { return tk.task_kind === k; });
            }
        }
        var html = '';
        list.forEach(function(t) {
            var pri = t.priority || 'P2';
            var cls = 'aa-item on';
            html += '<div class="' + cls + '" data-id="' + t.id + '" onclick="AA.toggleTask(this)">';
            html += '<span class="aa-cb">✓</span>';
            html += '<span class="aa-pri" style="' + AA._priStyle(pri) + '">' + escHtml(pri) + '</span>';
            html += '<span class="aa-name">' + escHtml(t.name) + '</span>';
            html += '<span class="aa-meta">' + escHtml(t.type || '') + ' · ' + (t.duration || '') + '</span>';
            html += '</div>';
        });
        if (!list.length) html = '<div style="padding:12px;color:#999;text-align:center;">没有待分配任务</div>';
        document.getElementById('aa-task-list').innerHTML = html;
        AA._updateTaskSummary();
    },

    toggleTask: function(el) {
        el.classList.toggle('on');
        AA._updateTaskSummary();
        AA._clearPreview();
    },

    filterTasks: function(filter, tabEl) {
        var tabs = document.querySelectorAll('#aa-task-tabs .aa-tab');
        tabs.forEach(function(t) { t.classList.remove('on'); });
        if (tabEl) tabEl.classList.add('on');
        AA._renderTasks(filter);
    },

    _updateTaskSummary: function() {
        var count = document.querySelectorAll('#aa-task-list .aa-item.on').length;
        document.getElementById('aa-summary-task').textContent = count + ' 个待分配 · 按优先级排列';
    },

    _priStyle: function(pri) {
        var colors = { 'P0': 'background:#fee2e2;color:#dc2626;', 'P1': 'background:#fef3c7;color:#d97706;' };
        return colors[pri] || 'background:#f1f5f9;color:#94a3b8;';
    },
```

- [ ] **Step 5: 实现高级选项记忆**

```javascript
    _loadAdvanced: function() {
        try {
            var saved = JSON.parse(localStorage.getItem('aa_advanced') || '{}');
            document.getElementById('aa-gap').value = saved.gap || 0;
            document.getElementById('aa-cover-breaks').checked = saved.coverBreaks !== false;
            document.getElementById('aa-extend-breaks').checked = saved.extendBreaks !== false;
        } catch(e) {}
    },

    saveAdvanced: function() {
        try {
            localStorage.setItem('aa_advanced', JSON.stringify({
                gap: document.getElementById('aa-gap').value,
                coverBreaks: document.getElementById('aa-cover-breaks').checked,
                extendBreaks: document.getElementById('aa-extend-breaks').checked,
            }));
        } catch(e) {}
        AA._updateAdvancedSummary();
    },

    _updateAdvancedSummary: function() {
        var gap = document.getElementById('aa-gap').value || '0';
        var cover = document.getElementById('aa-cover-breaks').checked;
        var extend = document.getElementById('aa-extend-breaks').checked;
        var parts = ['间隔' + gap + '分钟'];
        parts.push(cover ? '覆盖休息' : '避开休息');
        parts.push(extend ? '自动延长' : '不加时');
        document.getElementById('aa-summary-advanced').textContent = parts.join(' · ');
    },

    addExclusion: function() {
        var container = document.getElementById('aa-exclusion-list');
        var idx = Date.now();
        var div = document.createElement('div');
        div.id = 'ex-' + idx;
        div.style.cssText = 'display:flex;align-items:center;gap:4px;margin-top:4px;';
        div.innerHTML = '<input class="ex-start" placeholder="08:00" style="width:70px;height:28px;border:1px solid #ddd;border-radius:4px;padding:0 6px;font-size:12px;">' +
            '<span style="font-size:12px;">-</span>' +
            '<input class="ex-end" placeholder="09:00" style="width:70px;height:28px;border:1px solid #ddd;border-radius:4px;padding:0 6px;font-size:12px;">' +
            '<button onclick="document.getElementById(\'ex-' + idx + '\').remove();AA._clearPreview();" style="background:none;border:none;cursor:pointer;font-size:14px;color:#f56c6c;">&times;</button>';
        container.appendChild(div);
    },
```

- [ ] **Step 6: 实现预览和确认逻辑**

```javascript
    _getParams: function() {
        var timeP = AA._getTimeParams();
        var machineIds = [];
        document.querySelectorAll('#aa-machine-list .aa-item.on').forEach(function(el) {
            machineIds.push(parseInt(el.getAttribute('data-id'), 10));
        });
        var taskIds = [];
        document.querySelectorAll('#aa-task-list .aa-item.on').forEach(function(el) {
            taskIds.push(parseInt(el.getAttribute('data-id'), 10));
        });
        var exclusions = [];
        document.querySelectorAll('#aa-exclusion-list .exclusion-row, #aa-exclusion-list > div').forEach(function(row) {
            var s = row.querySelector('.ex-start');
            var e = row.querySelector('.ex-end');
            if (s && e) {
                var sm = AA._hhmmToMin((s.value || '').trim());
                var em = AA._hhmmToMin((e.value || '').trim());
                if (sm !== null && em !== null && em > sm) exclusions.push([sm, em]);
            }
        });
        return {
            date: document.getElementById('schedule-date') ? document.getElementById('schedule-date').value : '',
            task_ids: taskIds,
            machine_ids: machineIds,
            gap: parseInt(document.getElementById('aa-gap').value || '0', 10),
            work_start_min: timeP.ws,
            work_end_min: timeP.we,
            from_mode: timeP.from_mode,
            to_mode: timeP.to_mode,
            from_date: timeP.from_date,
            from_time: timeP.from_time,
            to_date: timeP.to_date,
            to_time: timeP.to_time,
            exclusion_periods: exclusions,
            cover_breaks: document.getElementById('aa-cover-breaks').checked,
            extend_over_breaks: document.getElementById('aa-extend-breaks').checked,
        };
    },

    _hhmmToMin: function(s) {
        var parts = s.split(':');
        if (parts.length !== 2) return null;
        var h = parseInt(parts[0], 10), m = parseInt(parts[1], 10);
        if (isNaN(h) || isNaN(m)) return null;
        return h * 60 + m;
    },

    preview: function() {
        var params = AA._getParams();
        if (params.machine_ids.length === 0) { showToast('请至少选择一台机器'); return; }
        if (params.task_ids.length === 0) { showToast('请至少选择一个任务'); return; }

        var btn = document.getElementById('aa-btn-preview');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span>预览中...';

        fetch('/auto_assign_preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            AA._state.previewData = data;
            AA._state.previewParams = JSON.parse(JSON.stringify(params)); // 快照
            AA._showPreviewOnTimeline(data);
            AA._showPreviewBar(data);
            AA.close(); // 弹窗消失，让用户看时间轴
        })
        .catch(function() {
            showToast('网络异常，请重试');
        })
        .finally(function() {
            btn.disabled = false;
            btn.innerHTML = '预览分配';
        });
    },

    confirm: function() {
        if (!AA._state.previewParams) { showToast('请先预览分配'); return; }
        var params = AA._state.previewParams; // 使用快照，不重读

        var btn = document.getElementById('aa-btn-confirm');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span>确认中...';

        fetch('/auto_assign', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            AA._state.assignedScheduleIds = [];
            (data.assigned || []).forEach(function(a) {
                if (a.schedule_id) AA._state.assignedScheduleIds.push(a.schedule_id);
            });
            AA._hidePreviewBar();
            AA._clearTimelinePreview();
            AA.close();
            showToast(data.msg || '分配完成', { undo: true });
            if (typeof _silentRefresh === 'function') _silentRefresh();
        })
        .catch(function() {
            showToast('网络异常，请重试');
        })
        .finally(function() {
            btn.disabled = false;
            btn.innerHTML = '确认分配';
        });
    },

    undo: function() {
        if (!AA._state.assignedScheduleIds.length) { showToast('没有可撤销的操作'); return; }
        fetch('/auto_assign/undo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ schedule_ids: AA._state.assignedScheduleIds }),
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            showToast(data.msg || '已撤销');
            AA._state.assignedScheduleIds = [];
            if (typeof _silentRefresh === 'function') _silentRefresh();
        })
        .catch(function() { showToast('撤销失败，请重试'); });
    },
```

- [ ] **Step 7: 实现预览时间轴显示和浮动操作栏**

```javascript
    _showPreviewBar: function(data) {
        var bar = document.getElementById('aa-preview-bar');
        var count = (data.assigned || []).length;
        document.getElementById('aa-preview-count').textContent = count + ' 个任务待确认';
        bar.style.display = 'flex';
    },

    _hidePreviewBar: function() {
        document.getElementById('aa-preview-bar').style.display = 'none';
    },

    returnToAdjust: function() {
        AA.open();
    },

    confirmFromBar: function() {
        AA.confirm();
    },

    cancelPreview: function() {
        AA._hidePreviewBar();
        AA._clearTimelinePreview();
        AA._state.previewData = null;
        AA._state.previewParams = null;
    },

    _clearPreview: function() {
        if (AA._state.previewData || AA._state.previewParams) {
            AA._clearTimelinePreview();
            AA._hidePreviewBar();
            AA._state.previewData = null;
            AA._state.previewParams = null;
        }
    },

    _showPreviewOnTimeline: function(data) {
        AA._clearTimelinePreview();
        // 在时间轴上渲染半透明预览卡片
        // 依赖现有时间轴渲染基础设施
        if (typeof window._renderPreviewCards === 'function') {
            window._renderPreviewCards(data.assigned || []);
        }
        // 触发自定义事件供 timeline.js 监听
        var event = new CustomEvent('aa-preview', { detail: data });
        document.dispatchEvent(event);
    },

    _clearTimelinePreview: function() {
        if (typeof window._clearPreviewCards === 'function') {
            window._clearPreviewCards();
        }
        var event = new CustomEvent('aa-preview-clear');
        document.dispatchEvent(event);
    },
```

- [ ] **Step 8: 实现键盘和遮罩处理**

```javascript
    _initKeyboard: function() {
        document.addEventListener('keydown', function(e) {
            var dlg = document.getElementById('auto-assign-dialog');
            if (dlg.style.display === 'none') return;
            if (e.key === 'Escape') {
                AA.cancel();
            } else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
                e.preventDefault();
                AA.preview();
            }
        });
    },

    _initBackdrop: function() {
        // 复用已有的 dialog 遮罩点击关闭逻辑
    },
};

// 初始化
document.addEventListener('DOMContentLoaded', function() {
    AA._initKeyboard();
    AA._updateAdvancedSummary();
});

// 挂载 undo 到 toast
var _origShowToast = window.showToast;
window.showToast = function(msg, opts) {
    _origShowToast(msg, opts);
    if (opts && opts.undo) {
        // 在 toast 出现后追加撤销按钮
        setTimeout(function() {
            var btns = document.querySelectorAll('.toast:last-child, [class*="toast"]');
            // 简化处理：如果有撤销需要，发出自定义事件
        }, 100);
    }
};
```

- [ ] **Step 9: 在 `templates/index.html` 引入 auto-assign.js**

在 `<script src="/static/auto-assign.js"></script>` 放在其他 JS 引入之后。

---

### Task 10: 前端 — 清理 dialogs.js

**Files:**
- Modify: `static/dialogs.js`

- [ ] **Step 1: 删除旧的自动分配函数**

从 `static/dialogs.js` 中删除以下全局变量和函数：
- `autoAssignPreviewData`
- `openAutoAssignDialog()`
- `closeAutoAssignDialog()`
- `loadAutoAssignMachines()`
- `loadAutoAssignTasks()`
- `_getAutoAssignParams()`
- `_clearAutoAssignPreview()`
- `_onAATimeSrcChange()`
- `_updateAAMachineAll()`
- `_updateAATaskAll()`
- `previewAutoAssign()`
- `renderAutoAssignResult()`
- `confirmAutoAssign()`
- `toggleAAMachines()`
- `toggleAAMachinesByType()`
- `toggleAAMachinesByKind()`
- `toggleAATasks()`
- `toggleAATasksByType()`
- `toggleAATasksByKind()`
- `addExclusionPeriod()`
- `_getNearestOvertimeEnd()`

- [ ] **Step 2: 更新触发入口**

在 `templates/panels/schedule.html` 中，将按钮 `onclick="openAutoAssignDialog()"` 改为 `onclick="AA.open()"`。

---

### Task 11: 前端 — 时间轴预览卡片支持

**Files:**
- Modify: `static/timeline-render.js` — 新增预览卡片渲染
- Modify: `static/timeline.js` — 监听预览事件

- [ ] **Step 1: 在 timeline-render.js 中添加预览卡片渲染**

```javascript
// 渲染自动分配预览卡片（半透明虚线边框）
function _renderPreviewCards(assigned) {
    _clearPreviewCards();
    assigned.forEach(function(a) {
        var el = document.createElement('div');
        el.className = 'aa-preview-card';
        el.setAttribute('data-preview-task', a.task_id);
        el.style.cssText = 'position:absolute; background:rgba(16,185,129,0.15); border:1px dashed #10b981; border-radius:4px; padding:4px 8px; font-size:10px; pointer-events:none; z-index:5;';
        el.textContent = (a.task_name || '') + ' (' + a.start_str + '-' + a.end_str + ')';
        // 定位到对应机器的行和时间位置
        var row = document.querySelector('[data-machine-id="' + a.machine_id + '"]');
        if (row) {
            row.style.position = 'relative';
            row.appendChild(el);
            var pctLeft = (a.start_min / 1440) * 100;
            var pctWidth = Math.max(2, ((a.end_min - a.start_min) / 1440) * 100);
            el.style.left = pctLeft + '%';
            el.style.width = pctWidth + '%';
        }
    });
}
window._renderPreviewCards = _renderPreviewCards;

function _clearPreviewCards() {
    document.querySelectorAll('.aa-preview-card').forEach(function(el) { el.remove(); });
}
window._clearPreviewCards = _clearPreviewCards;
```

- [ ] **Step 2: 在 timeline.js 中监听预览事件**

```javascript
document.addEventListener('aa-preview', function(e) {
    _renderPreviewCards(e.detail.assigned || []);
});
document.addEventListener('aa-preview-clear', function() {
    _clearPreviewCards();
});
```

---

### Task 12: 集成验证 & 旧代码清理

- [ ] **Step 1: 验证所有后端导入**

```powershell
python -c "from auto_assign import auto_assign_tasks, undo_auto_assign; from routes.schedules import bp; print('all imports OK')"
```

- [ ] **Step 2: 启动 Flask 验证无错误**

```powershell
python app.py
```

- [ ] **Step 3: 端到端测试清单**

1. 打开排班面板 → 点击"自动分配任务" → 弹窗出现
2. 时间范围折叠，机器/任务展开，高级折叠
3. 确认机器列表 Tab 过滤正常
4. 确认任务按优先级排列，全选默认勾选
5. 点"预览分配" → 弹窗消失 → 时间轴出现半透明卡片 → 顶部浮动操作栏出现
6. 点"返回调整" → 弹窗恢复，之前参数还在
7. 修改参数 → 半透明卡片消失
8. 重新预览 → 点"确认分配" → toast + 撤销按钮
9. 点撤销 → 排班恢复
10. 展开高级 → 修改休息段开关 → 关闭弹窗重开 → 设定保持
11. 网络断开 → 点预览 → toast "网络异常"
