# 分组-任务包约束 & 双面板弹窗重构 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在自动分配弹窗中实现分组-任务包约束（框+包拖拽），重构弹窗为双面板布局，修复预览返回后时间范围重置的 bug。

**Architecture:** 约束关系仅存在于前端弹窗生命周期内，不持久化。后端 `auto_assign_tasks` 新增 `package_group_map` 参数，在兼容机器列表中按 `group_name` 过滤。前端 JS 动态渲染右面板，支持手动拖拽和贪心自动均衡。

**Tech Stack:** Python Flask + SQLite (后端), Vanilla JS + CSS (前端)

---

### Task 1: 后端 — `auto_assign_tasks` 增加分组过滤

**Files:**
- Modify: `auto_assign.py:137-148` (函数签名)
- Modify: `auto_assign.py:259-262` (compatible 列表后插入过滤)

- [ ] **Step 1: 函数签名新增 `package_group_map` 参数**

修改 `auto_assign.py` 第137-148行：

```python
def auto_assign_tasks(
    task_ids: List[int],
    machine_ids: List[int],
    date: str,
    gap_minutes: int = 0,
    work_start_min: Optional[int] = None,
    work_end_min: Optional[int] = None,
    exclusion_periods: Optional[List[Tuple[int, int]]] = None,
    allow_cross_exclusion: bool = True,
    extend_over_breaks: bool = True,
    dry_run: bool = False,
    package_group_map: Optional[Dict[int, str]] = None,  # 新增：{pkg_id: group_name}
) -> Dict:
```

- [ ] **Step 2: 在 compatible 列表构建后插入分组过滤**

找到第259-262行的 compatible 构建（在 `for task in tasks:` 循环内），在其后追加分组过滤逻辑：

```python
        compatible = [m for m in machines
            if m["type"] == task_type
            and (m.get("task_kind") or "") == task_kind
            and m["status"] != "维修停用"]

        # 分组约束：若任务属于被约束的任务包，只保留对应分组的机器
        pkg_id = task.get("package_id")
        if pkg_id is not None and package_group_map:
            constrained_group = package_group_map.get(int(pkg_id))
            if constrained_group:
                compatible = [m for m in compatible
                              if (m.get("group_name") or "") == constrained_group]
```

- [ ] **Step 3: unassigned 原因细化**

找到第349-358行 unassigned 原因逻辑。当前按"无兼容机器"分类。在 compatible 列表由于分组约束变为空时，给出更精确的原因。将 unassigned 构建逻辑改为：

```python
        else:
            if not compatible_all_type:  # compatible_all_type = 分组过滤前的 compatible
                same_type = [m for m in machines if m["type"] == task_type and m["status"] != "维修停用"]
                if not same_type:
                    reason = f"无{task_type}类型机器可用"
                else:
                    reason = f"无{task_type}/{task_kind}机器可用（有{task_type}机器但任务类型不匹配）"
            elif pkg_id is not None and package_group_map and package_group_map.get(int(pkg_id)):
                reason = f"分组约束「{package_group_map.get(int(pkg_id))}」内无兼容机器空闲时段"
            else:
                reason = "兼容机器无空闲时段"
```

对应的，在分组过滤前保存一份未过滤的 compatible：
```python
        compatible_all_type = compatible  # 保存过滤前的引用
```

实际上这行要在分组过滤代码之前加。调整 Step 2 的代码，在分组过滤前加一行：

```python
        compatible = [m for m in machines
            if m["type"] == task_type
            and (m.get("task_kind") or "") == task_kind
            and m["status"] != "维修停用"]

        compatible_all_type = compatible  # 保存分组过滤前的列表用于错误提示

        # 分组约束
        pkg_id = task.get("package_id")
        if pkg_id is not None and package_group_map:
            constrained_group = package_group_map.get(int(pkg_id))
            if constrained_group:
                compatible = [m for m in compatible
                              if (m.get("group_name") or "") == constrained_group]
```

---

### Task 2: 后端 — routes 透传 `package_group_map`

**Files:**
- Modify: `routes/schedules.py:36-57` (`_parse_auto_assign_params`)
- Modify: `routes/schedules.py:60-76` (`auto_assign_preview`)
- Modify: `routes/schedules.py:79-95` (`api_auto_assign`)

- [ ] **Step 1: `_parse_auto_assign_params` 解析 `package_group_map`**

在第56行（`}`前）加一行：

```python
        "package_group_map": _parse_package_group_map(d.get("package_group_map")),
    }
```

并在 `_parse_auto_assign_params` 函数之前新增辅助函数：

```python
def _parse_package_group_map(raw):
    """将前端传来的 {pkgId: groupName} 转为 {int(pkgId): groupName}"""
    if not raw or not isinstance(raw, dict):
        return None
    result = {}
    for k, v in raw.items():
        try:
            result[int(k)] = str(v)
        except (ValueError, TypeError):
            pass
    return result if result else None
```

- [ ] **Step 2: `auto_assign_preview` 传递 `package_group_map`**

在第64-75行的 `auto_assign_tasks(` 调用中，增加一行：

```python
    result = auto_assign_tasks(
        task_ids=p["task_ids"],
        machine_ids=p["machine_ids"],
        date=p["date"],
        gap_minutes=p["gap_minutes"],
        work_start_min=p["work_start_min"],
        work_end_min=p["work_end_min"],
        exclusion_periods=p["exclusion_periods"],
        allow_cross_exclusion=p["allow_cross_exclusion"],
        extend_over_breaks=p["extend_over_breaks"],
        package_group_map=p["package_group_map"],  # 新增
        dry_run=True,
    )
```

- [ ] **Step 3: `api_auto_assign` 传递 `package_group_map`**

同样在第83-94行的调用中加 `package_group_map=p["package_group_map"],`：

```python
    result = auto_assign_tasks(
        task_ids=p["task_ids"],
        machine_ids=p["machine_ids"],
        date=p["date"],
        gap_minutes=p["gap_minutes"],
        work_start_min=p["work_start_min"],
        work_end_min=p["work_end_min"],
        exclusion_periods=p["exclusion_periods"],
        allow_cross_exclusion=p["allow_cross_exclusion"],
        extend_over_breaks=p["extend_over_breaks"],
        package_group_map=p["package_group_map"],  # 新增
        dry_run=False,
    )
```

---

### Task 3: HTML — 弹窗双面板结构

**Files:**
- Modify: `templates/dialogs/auto_assign.html`

用以下完整内容替换现有文件：

```html
<div id="auto-assign-dialog" class="dialog-transparent">
    <!-- 左面板：自动分配 -->
    <div class="aa-left">
        <div class="aa-header">
            <h3>自动分配任务</h3>
            <div style="display:flex;align-items:center;gap:8px;">
                <span class="aa-hint">默认值已就绪，可直接预览</span>
                <button class="aa-btn-pkg-toggle" id="aa-btn-pkg-toggle" onclick="AA.toggleConstraintPanel()">📦 分组-任务包约束</button>
            </div>
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
                        <span class="aa-time-sep">—</span>
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
                        <span class="aa-time-link" onclick="AA.resetTime()">恢复默认</span>
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
                    <div class="aa-tabs" id="aa-machine-tabs"></div>
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
                    <div class="aa-tabs" id="aa-task-tabs"></div>
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
                            <input type="number" id="aa-gap" value="0" min="0" max="120" class="aa-adv-input" onchange="AA.saveAdvanced()">
                            <span class="aa-adv-unit">分钟</span>
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
                            <span class="aa-time-link" onclick="AA.addExclusion()">+ 添加</span>
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

    <!-- 右面板：分组-任务包约束 -->
    <div class="aa-right" id="aa-right-panel" style="display:none;">
        <div class="aa-right-head">
            <h3>📦 分组 — 任务包约束</h3>
            <button class="aa-right-close" onclick="AA.toggleConstraintPanel()">&times;</button>
        </div>
        <div class="aa-right-body" id="aa-constraint-body">
            加载中...
        </div>
    </div>
</div>

<!-- 预览浮动操作栏 -->
<div id="aa-preview-bar">
    <span class="aa-preview-badge">预览中</span>
    <span id="aa-preview-count">0 个任务待确认</span>
    <span class="aa-preview-sep">|</span>
    <span class="aa-preview-link" onclick="AA.returnToAdjust()">返回调整</span>
    <span class="aa-preview-link aa-preview-confirm" onclick="AA.confirmFromBar()">确认分配</span>
    <span class="aa-preview-link danger" onclick="AA.cancelPreview()">取消预览</span>
</div>
```

---

### Task 4: CSS — 双面板 + 约束面板样式

**Files:**
- Modify: `static/auto-assign.css`

在现有 CSS 文件的**开头**（`#auto-assign-dialog` 规则之前）插入双面板容器样式，然后修改 `#auto-assign-dialog` 规则，最后在文件**末尾**追加右面板样式。

- [ ] **Step 1: 修改弹窗容器样式**

将现有第1-10行改为：

```css
/* 自动分配弹窗 — 双面板容器 */
#auto-assign-dialog {
    position: fixed; left: 50%; top: 8%; transform: translateX(-50%);
    z-index: 2000; max-width: 96vw;
    background: transparent;
    display: none; gap: 14px; align-items: flex-start;
}
```

- [ ] **Step 2: 左面板样式**

在容器样式后追加：

```css
#auto-assign-dialog .aa-left {
    width: 620px; flex-shrink: 0;
    background: var(--bg-card, #fff);
    border-radius: 10px;
    box-shadow: 0 4px 24px rgba(0,0,0,0.15);
    font-size: 13px; color: var(--text-primary, #1e293b);
    display: flex; flex-direction: column;
    max-height: 82vh;
}
#auto-assign-dialog .aa-left .aa-body {
    padding: 12px 20px; overflow-y: auto; flex: 1;
}
#auto-assign-dialog .aa-left .aa-footer {
    flex-shrink: 0;
}
```

- [ ] **Step 3: 删除原有 `#auto-assign-dialog` 的内部样式并替换**

将原有第11-17行的 `.aa-header` / `.aa-body` / `.aa-footer` 选择器去掉 `#auto-assign-dialog` 前缀（它们现在在 `.aa-left` 内，选择器路径自然正确，无需修改。但确认 `.aa-header` 保持：`display: flex; ...`，`.aa-footer` 保持：`display: flex; ...`）。

- [ ] **Step 4: "分组-任务包约束" 触发按钮样式**

在 `.aa-header` 规则后追加：

```css
.aa-btn-pkg-toggle {
    padding: 5px 12px; border-radius: 6px; font-size: 11px; font-weight: 600;
    border: 1.5px dashed #8b5cf6; color: #8b5cf6; background: #faf5ff;
    cursor: pointer; white-space: nowrap; transition: all 0.15s;
}
.aa-btn-pkg-toggle.active { background: #8b5cf6; color: #fff; border-style: solid; }
.aa-btn-pkg-toggle:hover { opacity: 0.85; }
```

- [ ] **Step 5: 右面板样式（追加到文件末尾）**

```css
/* ========== 右面板：分组-任务包约束 ========== */
#auto-assign-dialog .aa-right {
    width: 360px; flex-shrink: 0;
    background: var(--bg-card, #fff);
    border-radius: 10px;
    box-shadow: 0 4px 24px rgba(0,0,0,0.15);
    font-size: 13px; color: var(--text-primary, #1e293b);
    display: flex; flex-direction: column;
    max-height: 82vh;
}
.aa-right-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 16px; border-bottom: 1px solid var(--border, #e8ecf1);
    flex-shrink: 0;
}
.aa-right-head h3 { margin: 0; font-size: 14px; font-weight: 700; }
.aa-right-close {
    background: none; border: none; font-size: 20px; color: var(--text-muted, #94a3b8);
    cursor: pointer; padding: 0 4px; line-height: 1;
}
.aa-right-close:hover { color: var(--text-primary, #1e293b); }
.aa-right-body { padding: 12px 14px; overflow-y: auto; flex: 1; }

/* 右面板工具栏 */
.aa-cstr-toolbar { display: flex; gap: 6px; margin-bottom: 10px; }
.aa-btn-balance {
    padding: 6px 14px; border: none; border-radius: 6px;
    font-size: 11px; font-weight: 700; cursor: pointer;
    background: linear-gradient(135deg, #3b82f6, #8b5cf6); color: #fff;
}
.aa-btn-balance:hover { opacity: 0.9; }
.aa-btn-clear-cstr {
    padding: 6px 12px; border: 1px solid var(--border, #e2e8f0);
    border-radius: 6px; font-size: 11px; font-weight: 500; cursor: pointer;
    background: #fff; color: var(--text-secondary, #64748b);
}

/* 分组框 */
.aa-group-box {
    border: 2px dashed #cbd5e1; border-radius: 8px;
    padding: 10px 12px; margin-bottom: 10px;
    background: var(--bg-app, #fafbfc); transition: border-color 0.2s, background 0.2s;
}
.aa-group-box.drag-over { border-color: #3b82f6; background: #eff6ff; }
.aa-group-box .aa-gbox-head {
    font-size: 12px; font-weight: 700; color: var(--text-secondary, #475569);
    margin-bottom: 6px; display: flex; align-items: center; gap: 6px;
}
.aa-group-box .aa-gbox-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.aa-group-box .aa-gbox-stats { font-size: 10px; color: var(--text-muted, #94a3b8); font-weight: 400; margin-left: auto; }
.aa-group-box .aa-gbox-body { min-height: 24px; }
.aa-group-box .aa-gbox-hint { font-size: 11px; color: #cbd5e1; font-style: italic; }

/* 包 chip */
.aa-pkg-chip {
    display: inline-flex; align-items: center; gap: 4px;
    background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 5px;
    padding: 2px 7px; font-size: 11px; margin: 2px 4px 2px 0;
    animation: aa-chip-in 0.2s ease-out;
}
.aa-pkg-chip .aa-pkg-chip-rm { cursor: pointer; color: #94a3b8; font-size: 13px; line-height: 1; margin-left: 2px; }
.aa-pkg-chip .aa-pkg-chip-rm:hover { color: #ef4444; }
@keyframes aa-chip-in { from { opacity: 0; transform: scale(0.85); } to { opacity: 1; transform: scale(1); } }

/* 负载条 */
.aa-load-bar { margin-top: 8px; }
.aa-load-bar .aa-load-label { display: flex; justify-content: space-between; font-size: 10px; color: var(--text-muted, #94a3b8); margin-bottom: 2px; }
.aa-load-bar .aa-load-track { height: 5px; background: #e8ecf1; border-radius: 3px; overflow: hidden; }
.aa-load-bar .aa-load-fill { height: 100%; border-radius: 3px; transition: width 0.4s ease, background 0.4s ease; }

/* 任务包池 */
.aa-pkg-pool { margin-top: 14px; }
.aa-pkg-pool h4 { font-size: 12px; color: var(--text-secondary, #64748b); margin: 0 0 6px; }
.aa-pkg-pool-item {
    background: #fff; border: 1px solid var(--border, #e2e8f0); border-radius: 6px;
    padding: 6px 10px; margin-bottom: 4px; font-size: 11px; cursor: grab;
    display: flex; align-items: center; gap: 6px; user-select: none;
}
.aa-pkg-pool-item:hover { border-color: #3b82f6; box-shadow: 0 1px 6px rgba(59,130,246,0.1); }
.aa-pkg-pool-item:active { cursor: grabbing; }
.aa-pkg-pool-item.assigned { opacity: 0.35; cursor: default; pointer-events: none; }
.aa-pkg-pool-item .aa-pkg-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.aa-pkg-pool-item .aa-pkg-name { flex: 1; font-weight: 500; }
.aa-pkg-pool-item .aa-pkg-meta { font-size: 10px; color: var(--text-muted, #94a3b8); }
```

- [ ] **Step 6: 暗色模式适配（追加到文件末尾）**

```css
/* 暗色模式 — 右面板 */
[data-theme="dark"] .aa-btn-pkg-toggle { background: #2d2440; border-color: #8b5cf6; color: #a78bfa; }
[data-theme="dark"] .aa-btn-pkg-toggle.active { background: #8b5cf6; color: #fff; }
[data-theme="dark"] .aa-group-box { background: var(--bg-sidebar, #0d0f14); border-color: #334155; }
[data-theme="dark"] .aa-group-box.drag-over { border-color: #3b82f6; background: #1e2940; }
[data-theme="dark"] .aa-group-box .aa-gbox-hint { color: #4b5563; }
[data-theme="dark"] .aa-pkg-chip { background: #1e3050; border-color: #3b5f9e; }
[data-theme="dark"] .aa-pkg-pool-item { background: var(--bg-card); border-color: var(--border); }
[data-theme="dark"] .aa-pkg-pool-item:hover { border-color: #3b82f6; }
[data-theme="dark"] .aa-btn-clear-cstr { background: var(--bg-card); color: var(--text-primary); border-color: var(--border); }
```

---

### Task 5: JS — 约束管理 + 拖拽 + 自动均衡 + 预览修复

**Files:**
- Modify: `static/auto-assign.js`

- [ ] **Step 1: 状态新增 `_constraints` 和 `_panelWasOpen`**

在 `_state` 对象中新增两行：

```js
    _state: {
        previewData: null,
        previewParams: null,
        machines: [],
        tasks: [],
        machineTypes: [],
        taskKinds: [],
        _selectedMachineIds: null,
        _selectedTaskIds: null,
        _activeMachineTypeFilters: [],
        _activeMachineKindFilters: [],
        _activeMachineGroupFilters: [],
        _activeTaskTypeFilters: [],
        _activeTaskKindFilters: [],
        _activePackageFilters: [],
        _constraints: {},          // 新增：{groupName: [pkgId, ...]}
        _panelWasOpen: false,      // 新增：预览前是否打开了右面板
    },
```

- [ ] **Step 2: 预览流程修复 — `open()` 支持 `preserveState` 参数**

将第22-40行替换为：

```js
    open: function(preserveState) {
        var dlg = document.getElementById('auto-assign-dialog');
        var backdrop = document.getElementById('dialog-backdrop');
        if (dlg) dlg.style.display = 'flex';
        if (backdrop) backdrop.style.display = 'block';

        if (!preserveState) {
            // 首次打开：重置所有状态
            AA._state.previewData = null;
            AA._state.previewParams = null;
            AA._state._activeMachineTypeFilters = [];
            AA._state._activeMachineKindFilters = [];
            AA._state._activeMachineGroupFilters = [];
            AA._state._activeTaskTypeFilters = [];
            AA._state._activeTaskKindFilters = [];
            AA._state._activePackageFilters = [];
            AA._state._constraints = {};
            AA._state._panelWasOpen = false;
            AA._loadMachines();
            AA._loadTasks();
            AA._resetTimeUI();
            AA._closeConstraintPanel();
        } else {
            // 从预览返回：从 previewParams 恢复时间、约束、筛选
            AA._state.previewData = null;
            AA._loadMachines();
            AA._loadTasks();
            if (AA._state.previewParams) {
                AA._restoreTimeFromParams(AA._state.previewParams);
                var pkgMap = AA._state.previewParams.package_group_map || {};
                AA._state._constraints = {};
                Object.keys(pkgMap).forEach(function(pkgId) {
                    var g = pkgMap[pkgId];
                    if (!AA._state._constraints[g]) AA._state._constraints[g] = [];
                    AA._state._constraints[g].push(parseInt(pkgId, 10));
                });
            }
            if (AA._state._panelWasOpen) {
                AA._openConstraintPanel();
            } else {
                AA._renderConstraintPanel();
            }
        }
        AA._loadAdvanced();
        AA._updateAdvancedSummary();
    },
```

- [ ] **Step 3: 新增 `_restoreTimeFromParams` 方法**

在 `_resetTimeUI` 方法之后添加：

```js
    _restoreTimeFromParams: function(params) {
        var fromMode = document.getElementById('aa-from-mode');
        var toMode = document.getElementById('aa-to-mode');
        if (fromMode) fromMode.value = params.from_mode || 'now';
        if (toMode) toMode.value = params.to_mode || 'unlimited';

        var fp = document.getElementById('aa-from-pickers');
        var tp = document.getElementById('aa-to-pickers');
        if (params.from_mode === 'custom') {
            if (fp) fp.style.display = '';
            var fd = document.getElementById('aa-from-date');
            var ft = document.getElementById('aa-from-time');
            if (fd && params.from_date) fd.value = params.from_date;
            if (ft && params.from_time) ft.value = params.from_time;
        } else {
            if (fp) fp.style.display = 'none';
        }
        if (params.to_mode === 'custom') {
            if (tp) tp.style.display = '';
            var td = document.getElementById('aa-to-date');
            var tt = document.getElementById('aa-to-time');
            if (td && params.to_date) td.value = params.to_date;
            if (tt && params.to_time) tt.value = params.to_time;
        } else {
            if (tp) tp.style.display = 'none';
        }
        AA._updateTimeSummary();
    },
```

- [ ] **Step 4: 修改 `returnToAdjust` 和 `cancelPreview`**

将第702-715行替换为：

```js
    returnToAdjust: function() {
        AA.open(true);  // preserveState = true
    },

    cancelPreview: function() {
        AA._hidePreviewBar();
        AA._clearTimelinePreview();
        AA._state.previewData = null;
        AA._state.previewParams = null;
    },
```

- [ ] **Step 5: 修改 `preview()` — 存储 `package_group_map` 和 `_panelWasOpen`**

在 `preview()` 方法中（第623行 `var params = AA._getParams();` 之后，fetch 之前），追加：

```js
        // 将约束扁平化为 package_group_map
        var pkgGroupMap = {};
        Object.keys(AA._state._constraints).forEach(function(g) {
            (AA._state._constraints[g] || []).forEach(function(pid) {
                pkgGroupMap[pid] = g;
            });
        });
        params.package_group_map = pkgGroupMap;

        // 记录右面板状态
        AA._state._panelWasOpen = AA._isConstraintPanelOpen();
        AA._closeConstraintPanel();
```

- [ ] **Step 6: 新增右面板控制方法**

在 `toggleGroup` 方法之后插入：

```js
    // ========== 分组-任务包约束面板 ==========

    toggleConstraintPanel: function() {
        var panel = document.getElementById('aa-right-panel');
        if (!panel) return;
        if (AA._isConstraintPanelOpen()) {
            AA._closeConstraintPanel();
        } else {
            AA._openConstraintPanel();
        }
    },

    _isConstraintPanelOpen: function() {
        var panel = document.getElementById('aa-right-panel');
        return panel && panel.style.display !== 'none';
    },

    _openConstraintPanel: function() {
        var panel = document.getElementById('aa-right-panel');
        var btn = document.getElementById('aa-btn-pkg-toggle');
        if (panel) panel.style.display = 'flex';
        if (btn) btn.classList.add('active');
        AA._renderConstraintPanel();
    },

    _closeConstraintPanel: function() {
        var panel = document.getElementById('aa-right-panel');
        var btn = document.getElementById('aa-btn-pkg-toggle');
        if (panel) panel.style.display = 'none';
        if (btn) btn.classList.remove('active');
    },
```

- [ ] **Step 7: 新增 `_renderConstraintPanel` — 渲染分组框和包池**

在 `_closeConstraintPanel` 之后插入：

```js
    _renderConstraintPanel: function() {
        var body = document.getElementById('aa-constraint-body');
        if (!body) return;

        var groups = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.machine_groups) ? APP_CONFIG.machine_groups : [];
        if (groups.length === 0) {
            body.innerHTML = '<div style="padding:20px;color:#94a3b8;text-align:center;">暂无分组配置，请先在机器管理中创建分组</div>';
            return;
        }

        // 统计每个分组的机器数和可用时长（从时间范围推算）
        var timeP = AA._getTimeParams();
        var totalDays = timeP.we !== null ? Math.ceil((timeP.we - (timeP.ws || 0)) / 1440) : 4;
        var hoursPerDay = 24; // 简化：全天可用

        // 获取任务包数据（从缓存的 package 列表或重新请求）
        var packages = AA._state._packages || [];

        var constraints = AA._state._constraints || {};
        var assignedPkgIds = {};
        Object.keys(constraints).forEach(function(g) {
            (constraints[g] || []).forEach(function(pid) { assignedPkgIds[pid] = true; });
        });

        var html = '<div class="aa-cstr-toolbar">' +
            '<button class="aa-btn-balance" onclick="AA._autoBalance()">⚡ 自动均衡</button>' +
            '<button class="aa-btn-clear-cstr" onclick="AA._clearConstraints()">清除全部</button>' +
            '</div>';

        // 渲染分组框
        groups.forEach(function(g) {
            var myPkgIds = constraints[g.key] || [];
            var totalMin = 0;
            var chipsHtml = '';
            myPkgIds.forEach(function(pid) {
                var pkg = AA._findPackageById(pid);
                var pkgMin = pkg ? pkg.total_min : 0;
                totalMin += pkgMin;
                chipsHtml += '<span class="aa-pkg-chip" data-pkg="' + pid + '">' +
                    '<span style="width:7px;height:7px;border-radius:50%;background:' + (pkg ? pkg.color : '#94a3b8') + ';flex-shrink:0;"></span>' +
                    (pkg ? escHtml(pkg.name) : '#' + pid) +
                    ' (' + Math.round(pkgMin / 60) + 'h)' +
                    '<span class="aa-pkg-chip-rm" onclick="event.stopPropagation();AA._removeConstraint(\'' + escHtml(g.key) + '\', ' + pid + ')">&times;</span>' +
                    '</span>';
            });

            var machineCount = AA._state.machines.filter(function(m) { return (m.group_name || '') === g.key; }).length;
            var availMin = machineCount * totalDays * hoursPerDay * 60;
            var ratio = availMin > 0 ? totalMin / availMin : 0;
            var pct = Math.round(ratio * 100);
            var barColor = ratio > 0.9 ? '#ef4444' : ratio > 0.6 ? '#f59e0b' : '#10b981';

            html += '<div class="aa-group-box" data-group="' + escHtml(g.key) + '" ' +
                'ondragover="event.preventDefault();this.classList.add(\'drag-over\')" ' +
                'ondragleave="this.classList.remove(\'drag-over\')" ' +
                'ondrop="AA._onDropConstraint(event, \'' + escHtml(g.key) + '\')">' +
                '<div class="aa-gbox-head">' +
                    '<span class="aa-gbox-dot" style="background:' + (AA._groupColor(g.key)) + '"></span>' +
                    escHtml(g.key) + ' · ' + machineCount + '台' +
                    '<span class="aa-gbox-stats">可用 ' + (machineCount * totalDays * hoursPerDay) + 'h</span>' +
                '</div>' +
                '<div class="aa-gbox-body">' +
                    (chipsHtml || '<div class="aa-gbox-hint">拖拽任务包到此处</div>') +
                '</div>' +
                '<div class="aa-load-bar">' +
                    '<div class="aa-load-label"><span>负载率</span><span><b>' + Math.round(totalMin / 60) + 'h</b> / ' + (machineCount * totalDays * hoursPerDay) + 'h</span></div>' +
                    '<div class="aa-load-track"><div class="aa-load-fill" style="width:' + Math.min(pct, 100) + '%;background:' + barColor + '"></div></div>' +
                '</div>' +
                '</div>';
        });

        // 渲染未分配的任务包池
        var unassignedPkgs = packages.filter(function(p) { return !assignedPkgIds[p.id]; });
        html += '<div class="aa-pkg-pool"><h4>待分配任务包</h4>';
        if (unassignedPkgs.length === 0) {
            html += '<div style="font-size:11px;color:#cbd5e1;padding:4px 0;">全部已分配</div>';
        } else {
            unassignedPkgs.forEach(function(p) {
                html += '<div class="aa-pkg-pool-item" draggable="true" data-pkg-id="' + p.id + '" ' +
                    'data-pkg-name="' + escHtml(p.name) + '" data-pkg-color="' + (p.color || '#94a3b8') + '" ' +
                    'data-pkg-min="' + (p.total_min || 0) + '" ' +
                    'ondragstart="AA._onDragStartPkg(event)" ondragend="AA._onDragEndPkg(event)">' +
                    '<span class="aa-pkg-dot" style="background:' + (p.color || '#94a3b8') + '"></span>' +
                    '<span class="aa-pkg-name">' + escHtml(p.name) + '</span>' +
                    '<span class="aa-pkg-meta">' + (p.task_count || '?') + '个 · ' + Math.round((p.total_min || 0) / 60) + 'h</span>' +
                    '</div>';
            });
        }
        html += '</div>';

        body.innerHTML = html;
    },
```

- [ ] **Step 8: 新增拖拽事件处理方法**

在 `_renderConstraintPanel` 后插入：

```js
    _onDragStartPkg: function(e) {
        var el = e.target.closest('.aa-pkg-pool-item');
        if (!el || el.classList.contains('assigned')) { e.preventDefault(); return; }
        e.dataTransfer.setData('text/plain', JSON.stringify({
            id: parseInt(el.dataset.pkgId, 10),
            name: el.dataset.pkgName,
            color: el.dataset.pkgColor,
            total_min: parseInt(el.dataset.pkgMin, 10) || 0
        }));
        el.style.opacity = '0.4';
    },

    _onDragEndPkg: function(e) {
        var el = e.target.closest('.aa-pkg-pool-item');
        if (el) el.style.opacity = '1';
    },

    _onDropConstraint: function(e, groupName) {
        e.preventDefault();
        e.target.closest('.aa-group-box').classList.remove('drag-over');
        try {
            var data = JSON.parse(e.dataTransfer.getData('text/plain'));
        } catch(err) { return; }

        // 先从其他分组中移除
        Object.keys(AA._state._constraints).forEach(function(g) {
            var arr = AA._state._constraints[g] || [];
            var idx = arr.indexOf(data.id);
            if (idx >= 0) arr.splice(idx, 1);
        });

        // 加入目标分组
        if (!AA._state._constraints[groupName]) AA._state._constraints[groupName] = [];
        if (AA._state._constraints[groupName].indexOf(data.id) < 0) {
            AA._state._constraints[groupName].push(data.id);
        }
        AA._renderConstraintPanel();
        AA._clearPreview();
    },
```

- [ ] **Step 9: 新增 `_removeConstraint`、`_autoBalance`、`_clearConstraints`、`_findPackageById`**

```js
    _removeConstraint: function(groupName, pkgId) {
        var arr = AA._state._constraints[groupName];
        if (arr) {
            var idx = arr.indexOf(pkgId);
            if (idx >= 0) arr.splice(idx, 1);
        }
        AA._renderConstraintPanel();
        AA._clearPreview();
    },

    _autoBalance: function() {
        AA._state._constraints = {};
        var groups = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.machine_groups) ? APP_CONFIG.machine_groups : [];
        if (groups.length === 0) return;
        groups.forEach(function(g) { AA._state._constraints[g.key] = []; });

        var timeP = AA._getTimeParams();
        var totalDays = timeP.we !== null ? Math.ceil((timeP.we - (timeP.ws || 0)) / 1440) : 4;

        var packages = (AA._state._packages || []).slice();
        packages.sort(function(a, b) { return (b.total_min || 0) - (a.total_min || 0); });

        packages.forEach(function(pkg) {
            var bestGroup = null;
            var bestRatio = Infinity;
            groups.forEach(function(g) {
                var curMin = (AA._state._constraints[g.key] || []).reduce(function(s, pid) {
                    var p = AA._findPackageById(pid);
                    return s + (p ? (p.total_min || 0) : 0);
                }, 0);
                var newMin = curMin + (pkg.total_min || 0);
                var machineCount = AA._state.machines.filter(function(m) { return (m.group_name || '') === g.key; }).length;
                var availMin = machineCount * totalDays * 24 * 60;
                var ratio = availMin > 0 ? newMin / availMin : Infinity;
                if (ratio < bestRatio) { bestRatio = ratio; bestGroup = g; }
            });
            if (bestGroup) {
                AA._state._constraints[bestGroup.key].push(pkg.id);
            }
        });
        AA._renderConstraintPanel();
        AA._clearPreview();
    },

    _clearConstraints: function() {
        AA._state._constraints = {};
        AA._renderConstraintPanel();
        AA._clearPreview();
    },

    _findPackageById: function(pid) {
        var packages = AA._state._packages || [];
        for (var i = 0; i < packages.length; i++) {
            if (packages[i].id === pid) return packages[i];
        }
        return null;
    },

    _groupColor: function(groupName) {
        var palette = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#84cc16'];
        var groups = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.machine_groups) ? APP_CONFIG.machine_groups : [];
        for (var i = 0; i < groups.length; i++) {
            if (groups[i].key === groupName) return palette[i % palette.length];
        }
        return '#94a3b8';
    },
```

- [ ] **Step 10: 修改 `_loadTasks` — 缓存任务包数据**

在 `_loadTasks()` 方法中，`_renderTaskTabs` 之前加载任务包数据存入 `_state._packages`：

在 `_loadTasks` 方法中，第331行 `.then(function(data) {` 之后，追加请求任务包数据：

```js
            .then(function(data) {
                AA._state.tasks = (data.tasks || []).filter(function(t) { return t.status === '待分配'; });
                // ... 现有优先级排序代码 ...

                // 加载任务包数据供约束面板使用
                fetch('/api/task_packages')
                    .then(function(r) { return r.json(); })
                    .then(function(d) {
                        var packages = d.packages || [];
                        // 补充 total_min（任务总时长）
                        packages.forEach(function(pkg) {
                            pkg.total_min = pkg.total_min || 0;
                            pkg.task_count = pkg.task_count || 0;
                            // 从统计中推算总时长（简化：用任务数×2h估计，后续可用精确数据）
                        });
                        // 从已加载的 tasks 计算每个包的 total_min
                        packages.forEach(function(pkg) {
                            var pkgTasks = AA._state.tasks.filter(function(t) { return t.package_id === pkg.id; });
                            var totalMin = 0;
                            pkgTasks.forEach(function(t) {
                                totalMin += t.est_seconds ? Math.round(t.est_seconds / 60) : 120;
                            });
                            pkg.total_min = totalMin;
                            pkg.task_count = pkgTasks.length;
                        });
                        AA._state._packages = packages;
                        AA._renderConstraintPanel();
                    });
```

更好的做法：在 `_renderTaskTabs` 的回调中已经 fetch 了 `/api/task_packages`（第390行），在那里的 `.then()` 末尾加入上述计算逻辑。修改 `_renderTaskTabs` 中第392-401行的 fetch 回调：

```js
            .then(function(d) {
                var packages = d.packages || [];
                // 从已加载的 tasks 计算每个包的 total_min 和 task_count
                packages.forEach(function(pkg) {
                    var pkgTasks = AA._state.tasks.filter(function(t) { return t.package_id === pkg.id; });
                    var totalMin = 0;
                    pkgTasks.forEach(function(t) {
                        totalMin += t.est_seconds ? Math.round(t.est_seconds / 60) : 120;
                    });
                    pkg.total_min = totalMin;
                    pkg.task_count = pkgTasks.length;
                });
                AA._state._packages = packages;  // 新增：缓存供约束面板使用
                var pkgTabsHtml = '';
                packages.forEach(function(pkg) {
                    var isOn = activePackages.indexOf(pkg.id) >= 0;
                    pkgTabsHtml += '<span class="aa-tab' + (isOn ? ' on' : '') + '" data-group="package" data-filter="package:' + pkg.id + '" onclick="AA.toggleTaskFilter(\'package:' + pkg.id + '\', \'package\', this)">' + escHtml(pkg.name) + '</span>';
                });
                var loadingEl = document.getElementById('aa-pkg-tabs-loading');
                if (loadingEl) loadingEl.outerHTML = pkgTabsHtml;
            });
```

- [ ] **Step 11: 修改 `cancel` — 清理约束面板**

```js
    cancel: function() {
        AA._closeConstraintPanel();
        AA.close();
        AA._clearPreview();
    },
```

### Task 6: 验证

- [ ] **Step 1: 启动服务器验证基本功能**

```bash
cd "C:\Users\Admin\Desktop\大家的Draft\zyh\golden" && python app.py
```

打开浏览器，验证：
1. 自动分配弹窗左右布局正常
2. 点击"分组-任务包约束"按钮打开/关闭右面板
3. 拖拽任务包到分组框，chip 显示正确，× 移除正常
4. "自动均衡"按钮能合理分配
5. "清除全部"可重置
6. 预览 → 返回调整 → 时间范围和约束保持不变
7. 原有功能（机器筛选、任务筛选、高级选项）不受影响

- [ ] **Step 2: 测试分组过滤后端逻辑**

用 curl 测试带 `package_group_map` 的请求：

```bash
curl -X POST http://localhost:5000/auto_assign_preview \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-05-28","task_ids":[1,2,3],"machine_ids":[1,2,3],"package_group_map":{"1":"A组","2":"B组"}}'
```

验证返回的 assigned 中，package_id=1 的任务只分配给 A 组的机器。
