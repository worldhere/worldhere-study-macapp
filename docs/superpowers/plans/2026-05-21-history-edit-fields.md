# History Edit Dialog — Fields Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand history edit dialog "更多字段" from 5 to 15 fields, fix field saving, and add readonly display for computed fields.

**Architecture:** Three files modified — HTML template for the dialog UI, history.js for populating and submitting fields, schedule_ops.py for persisting new fields via `/edit_task`. The frontend will call two backend endpoints sequentially: `/edit_task` for attribute fields, then `/update_task_bounds` for time fields.

**Tech Stack:** Jinja2 HTML, vanilla JavaScript, Python Flask + SQLite

---

### Task 1: Extend "更多字段" HTML in dialog template

**Files:**
- Modify: `templates/dialogs/all.html:134-161`

- [ ] **Step 1: Replace the current 5-field grid with the full 15-field grid**

Replace the content of `<div class="hist-fields-grid">` (between lines 139 and 161):

```html
<div class="hist-fields-grid">
    <div class="hist-field-group">
        <label>任务名</label>
        <input id="he_task_name">
    </div>
    <div class="hist-field-group">
        <label>机型</label>
        <select id="he_type">{% for mt in app_config.machine_types %}<option>{{mt.key}}</option>{% endfor %}</select>
    </div>
    <div class="hist-field-group">
        <label>任务类型</label>
        <select id="he_kind">{% for tk in app_config.task_kinds %}<option>{{tk.key}}</option>{% endfor %}</select>
    </div>
    <div class="hist-field-group">
        <label>优先级</label>
        <select id="he_pri">{% for p in app_config.priorities %}<option>{{p.key}}</option>{% endfor %}</select>
    </div>
    <div class="hist-field-group">
        <label>难度</label>
        <select id="he_diff">{% for d in app_config.difficulties %}<option value="{{'' if d.key=='无' else d.key}}">{{d.key}}</option>{% endfor %}</select>
    </div>
    <div class="hist-field-group">
        <label>维修时长</label>
        <input id="he_repair_dur" readonly style="background:var(--bg-sidebar);color:var(--text-muted);">
    </div>
    <div class="hist-field-group">
        <label>机器</label>
        <input id="he_machine_name" readonly style="background:var(--bg-sidebar);color:var(--text-muted);">
    </div>
    <div class="hist-field-group">
        <label>RBP任务ID</label>
        <input id="he_rbp_task_id">
    </div>
    <div class="hist-field-group">
        <label>场景</label>
        <input id="he_scene">
    </div>
    <div class="hist-field-group">
        <label>通用类别</label>
        <input id="he_general_category">
    </div>
    <div class="hist-field-group">
        <label>来源链接</label>
        <input id="he_source_link">
    </div>
    <div class="hist-field-group">
        <label>预期采集量</label>
        <input id="he_expected_count" type="number">
    </div>
    <div class="hist-field-group">
        <label>数采需求ID</label>
        <input id="he_collection_req_id">
    </div>
    <div class="hist-field-group">
        <label>数采需求类型</label>
        <input id="he_collection_req_type">
    </div>
    <div class="hist-field-group" style="grid-column:1/-1;">
        <label>备注</label>
        <input id="he_remark" placeholder="备注信息">
    </div>
</div>
```

### Task 2: Update openHistoryEdit to populate new fields

**Files:**
- Modify: `static/history.js:302-335`

- [ ] **Step 1: Add field population for new fields in openHistoryEdit()**

Replace the "More fields" block (lines 320-325) with all 15 fields:

```javascript
// More fields
document.getElementById('he_task_name').value = s.task_name || '';
document.getElementById('he_type').value = s.task_type || '';
document.getElementById('he_kind').value = s.task_kind || '';
document.getElementById('he_pri').value = s.priority || '';
document.getElementById('he_diff').value = s.difficulty || '';
document.getElementById('he_repair_dur').value = s.repair_duration || '';
document.getElementById('he_machine_name').value = s.machine_name || '';
document.getElementById('he_rbp_task_id').value = s.rbp_task_id || '';
document.getElementById('he_scene').value = s.scene || '';
document.getElementById('he_general_category').value = s.general_category || '';
document.getElementById('he_source_link').value = s.source_link || '';
document.getElementById('he_expected_count').value = s.expected_count || '';
document.getElementById('he_collection_req_id').value = s.collection_req_id || '';
document.getElementById('he_collection_req_type').value = s.collection_req_type || '';
document.getElementById('he_remark').value = s.remark || '';
```

- [ ] **Step 2: Verify the line numbers don't shift unexpectedly**

Read `static/history.js:320-325` to confirm old code block before editing, then apply the edit.

### Task 3: Update submitHistoryEdit to call /edit_task

**Files:**
- Modify: `static/history.js:339-381`

- [ ] **Step 1: Replace submitHistoryEdit to collect all fields and call both endpoints**

Replace the entire `submitHistoryEdit()` function (lines 339-381):

```javascript
function submitHistoryEdit() {
    var sid = parseInt(document.getElementById('he-sid').value || '0', 10);
    var startDate = document.getElementById('he_start_date').value;
    var startTime = document.getElementById('he_start_time').value.trim();
    var endDate = document.getElementById('he_end_date').value;
    var endTime = document.getElementById('he_end_time').value.trim();
    if (!sid || !startDate || !startTime || !endDate || !endTime) { showToast('参数不完整'); return; }
    var sm = hhmmToMin(startTime);
    var em = hhmmToMin(endTime);
    if (sm === null || em === null) { showToast('时间格式错误（HH:MM）'); return; }
    var endMin = em;
    var dayDiff = Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000);
    if (dayDiff > 0) { endMin = em + dayDiff * MINS_PER_DAY; }
    endMin = Math.max(sm + 1, Math.min(MAX_VIEW_SPAN, endMin));

    // Collect task fields for /edit_task
    var taskPayload = {
        schedule_id: sid,
        name: document.getElementById('he_task_name').value.trim(),
        task_type: document.getElementById('he_type').value,
        task_kind: document.getElementById('he_kind').value,
        priority: document.getElementById('he_pri').value,
        difficulty: document.getElementById('he_diff').value,
        duration: document.getElementById('he_repair_dur').value,
        remark: document.getElementById('he_remark').value.trim(),
        rbp_task_id: document.getElementById('he_rbp_task_id').value.trim(),
        scene: document.getElementById('he_scene').value.trim(),
        general_category: document.getElementById('he_general_category').value.trim(),
        source_link: document.getElementById('he_source_link').value.trim(),
        expected_count: document.getElementById('he_expected_count').value.trim(),
        collection_req_id: document.getElementById('he_collection_req_id').value.trim(),
        collection_req_type: document.getElementById('he_collection_req_type').value.trim()
    };

    // Collect time fields for /update_task_bounds
    var timePayload = {
        schedule_id: sid,
        date: startDate,
        start_min: sm,
        end_min: endMin
    };

    // Call /edit_task first, then /update_task_bounds
    fetch('/edit_task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(taskPayload)
    }).then(function(r) { return r.json(); }).then(function(d1) {
        return fetch('/update_task_bounds', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(timePayload)
        }).then(function(r) { return r.json(); }).then(function(d2) {
            showToast(d1.msg || '已修改');
            closeHistoryEdit();
            _refreshHistory();
        });
    }).catch(function() {
        showToast('修改失败，请检查网络');
    });
}
```

### Task 4: Extend /edit_task backend to persist new fields

**Files:**
- Modify: `routes/schedule_ops.py:436-480`

- [ ] **Step 1: Add new fields to /edit_task**

After line 469 (`if remark: conn.execute("UPDATE tasks SET remark=? WHERE id=?", (remark, int(sch["task_id"])))`) add UPDATE statements for the new fields, and also handle the new read-only fields that should not be written:

```python
    if sch["task_id"] is not None:
        task_kind = (d.get("task_kind") or "").strip()
        task_type = (d.get("task_type") or "").strip()
        priority = (d.get("priority") or "").strip()
        difficulty = (d.get("difficulty") or "").strip()
        rbp_task_id = (d.get("rbp_task_id") or "").strip()
        scene = (d.get("scene") or "").strip()
        general_category = (d.get("general_category") or "").strip()
        source_link = (d.get("source_link") or "").strip()
        expected_count = (d.get("expected_count") or "").strip()
        collection_req_id = (d.get("collection_req_id") or "").strip()
        collection_req_type = (d.get("collection_req_type") or "").strip()
        if task_kind and task_kind in get_allowed_task_kinds():
            conn.execute("UPDATE tasks SET task_kind=? WHERE id=?", (task_kind, int(sch["task_id"])))
        if task_type:
            conn.execute("UPDATE tasks SET type=? WHERE id=?", (task_type, int(sch["task_id"])))
        if name:
            conn.execute("UPDATE tasks SET name=? WHERE id=?", (name, int(sch["task_id"])))
        if priority:
            conn.execute("UPDATE tasks SET priority=? WHERE id=?", (priority, int(sch["task_id"])))
        if difficulty:
            conn.execute("UPDATE tasks SET difficulty=? WHERE id=?", (difficulty, int(sch["task_id"])))
        if remark:
            conn.execute("UPDATE tasks SET remark=? WHERE id=?", (remark, int(sch["task_id"])))
        if name:
            conn.execute("UPDATE schedules SET task_name=? WHERE task_id=?", (name, int(sch["task_id"])))
        if task_type:
            conn.execute("UPDATE schedules SET task_type=? WHERE task_id=?", (task_type, int(sch["task_id"])))
        if task_kind and task_kind in get_allowed_task_kinds():
            conn.execute("UPDATE schedules SET task_kind=? WHERE task_id=?", (task_kind, int(sch["task_id"])))
        # New fields — tasks table only
        if rbp_task_id:
            conn.execute("UPDATE tasks SET rbp_task_id=? WHERE id=?", (rbp_task_id, int(sch["task_id"])))
        if scene:
            conn.execute("UPDATE tasks SET scene=? WHERE id=?", (scene, int(sch["task_id"])))
        if general_category:
            conn.execute("UPDATE tasks SET general_category=? WHERE id=?", (general_category, int(sch["task_id"])))
        if source_link:
            conn.execute("UPDATE tasks SET source_link=? WHERE id=?", (source_link, int(sch["task_id"])))
        if expected_count:
            conn.execute("UPDATE tasks SET expected_count=? WHERE id=?", (expected_count, int(sch["task_id"])))
        if collection_req_id:
            conn.execute("UPDATE tasks SET collection_req_id=? WHERE id=?", (collection_req_id, int(sch["task_id"])))
        if collection_req_type:
            conn.execute("UPDATE tasks SET collection_req_type=? WHERE id=?", (collection_req_type, int(sch["task_id"])))
```
