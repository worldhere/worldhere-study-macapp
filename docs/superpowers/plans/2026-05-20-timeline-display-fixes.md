# 时间轴显示与动画问题修复方案

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复已完成任务在机器 task_kind 变更后变红 + 双击模式动画阻塞快速操作 + 排查到的关联显示问题。

**Architecture:** 三处修复均为现有代码逻辑修正，不新增文件。Bug 1 在 `_createTaskBlock` 加条件排除已完成任务；Bug 2 引入全局动画追踪变量，新动画开始时立即终止旧动画并执行其服务器调用；Bug 3 在 `_refreshTimelineFromServer` 前终止所有进行中的动画。

**Tech Stack:** 原生 JavaScript + CSS（无框架）

---

## 根因分析

### Bug 1：已完成任务变红

`timeline-render.js:294-295` 中 `isIncompatible` 条件不排除 `isCompleted`：

```javascript
let isIncompatible = (data.machineType && data.type && data.type !== data.machineType)
    || (data.machineKind && data.task_kind && data.task_kind !== data.machineKind);
```

导致已完成任务同时获得 `task-completed` + `task-incompatible` 两个 class。两者都用了 `!important` 背景色，但 CSS 中 `.task-incompatible`（line 970，红色）排在 `.task-completed`（line 960，绿色）之后，层叠顺序导致红色覆盖绿色。

对比 `refreshLiveStatus`（`tasks.js:1427`）正确使用了 `:not(.task-completed)` 排除已完成任务：
```javascript
track.querySelectorAll('.task-block:not(.task-completed)').forEach(function(block){
```

**根因**：`_createTaskBlock` 缺少 `&& !isCompleted`。

### Bug 2：动画阻塞快速操作

三个动画函数均需等待 CSS animation 结束后才执行真正的服务器调用：

| 函数 | 动画时长 | 服务器调用时机 | 有跳过机制 |
|------|---------|--------------|-----------|
| `recycleWithAnim` | 0.45s | 动画后 | 无 |
| `completeWithAnim` | 0.5s | 动画前 | 仅同 block |
| `deleteWithAnim` | 0.4s + 0.5s | 两段动画后 | 无 |

更严重的是：动画期间 `pointer-events: none` 让 block 不可交互；无全局状态追踪，不同 block 的动画可以重叠；`_refreshTimelineFromServer` 销毁 DOM 时会把正在播放的动画和它的 `animationend` listener 一起丢掉，导致服务器调用永远不会执行。

**根因**：缺全局动画中止机制 + recycle/delete 的服务器调用不应被动画阻塞。

---

## 文件结构

| 文件 | 职责 | 操作 |
|------|------|------|
| `static/timeline-render.js` | `_createTaskBlock` 排除已完成任务 | 修改 |
| `static/timeline-ops.js` | 动画全局中止机制 + 立即执行逻辑 | 修改 |
| `static/style.css` | CSS 防御：确保 `.task-completed` 永远覆盖 `.task-incompatible` | 修改 |
| `static/tasks.js` | `_refreshTimelineFromServer` 前终止动画 | 修改 |

---

### Task 1: 修复已完成任务变红

**Files:**
- Modify: `static/timeline-render.js:294-295`
- Modify: `static/style.css`

- [ ] **Step 1: `_createTaskBlock` — isIncompatible 排除已完成任务**

将 `timeline-render.js` 第 294-295 行：

```javascript
    let isIncompatible = (data.machineType && data.type && data.type !== data.machineType)
        || (data.machineKind && data.task_kind && data.task_kind !== data.machineKind);
```

改为：

```javascript
    let isIncompatible = !isCompleted && (
        (data.machineType && data.type && data.type !== data.machineType)
        || (data.machineKind && data.task_kind && data.task_kind !== data.machineKind)
    );
```

逻辑：已完成任务不应该被标记为 incompatible。

- [ ] **Step 2: CSS 防御层 — 确保 `.task-completed` 不被后续规则覆盖**

在 `static/style.css` 第 963 行（`.task-completed` 规则末尾 `}` 后）或 973 行（`.task-incompatible` 规则后）不做修改。

改为使用选择器优先级防御：将 `.task-completed` 的选择器改为 `.task-block.task-completed`，使其特异性高于 `.task-incompatible`，即使两者都有 `!important` 也能保证 completed 优先。

找到第 960 行：
```css
.task-completed {
```

改为：
```css
.task-block.task-completed {
```

这样做之后，`.task-block.task-completed` 的特异性（0,2,0）高于 `.task-incompatible`（0,1,0），即使 CSS 源顺序靠前也能确保绿色覆盖红色。

- [ ] **Step 3: 验证**

手动测试：启动 app，在机器管理页修改某机器的 task_kind → 切回排班面板 → 该机器上已完成的任务应保持绿色，未完成且 task_kind 不匹配的任务应变红。

- [ ] **Step 4: Commit**

```bash
git add static/timeline-render.js static/style.css
git commit -m "fix: prevent completed tasks from turning red on machine kind change"
```

---

### Task 2: 修复双击模式动画阻塞

**Files:**
- Modify: `static/timeline-ops.js`

核心改动：在文件顶部添加全局动画追踪，新增 `_abortCurrentAnim()` 函数。修改 `recycleWithAnim`、`deleteWithAnim` 让服务器调用在动画之前执行。

- [ ] **Step 1: 添加全局动画中止机制**

在 `timeline-ops.js` 顶部（`timelineOpMode` 定义之后，约第 4 行后）添加：

```javascript
var _activeAnimCleanup = null; // { abort: function } 或 null

function _abortCurrentAnim() {
    if (_activeAnimCleanup) {
        try { _activeAnimCleanup.abort(); } catch(e) {}
        _activeAnimCleanup = null;
    }
}
```

- [ ] **Step 2: 修改 `recycleWithAnim` — 服务器调用前置 + 可中止**

将 `timeline-ops.js` 第 545-588 行的整个函数替换为：

```javascript
function recycleWithAnim(ev, sid){
    var s = schedules.find(function(item){ return item.id == sid; });
    if(!s) return;
    var block = document.querySelector('.task-block[data-sid="'+sid+'"]');
    if(!block) return;

    function doRecycle(){
        if(block) block.remove();
        schedules = schedules.filter(function(item){ return item.id != sid; });
        if(s.task_id) _updateTaskStatusText(s.task_id, '待分配');
        recycleTasks({
            scheduleIds: [sid],
            skipConfirm: true,
            skipLocalCleanup: true,
            onSuccess: function(){
                _silentRefresh();
                pushUndo({type:'recycle', sid:sid, tid:s.task_id, mid:s.machine_id, date:s.date,
                    start_min:s.start_min, end_min:s.end_min, machine_name:s.machine_name,
                    task_name:s.task_name, task_type:s.task_type, task_kind:s.task_kind,
                    priority:s.priority, difficulty:s.difficulty, remark:s.remark});
            }
        });
    }

    function run(){
        _abortCurrentAnim(); // 中止之前的动画
        if(document.body.classList.contains('no-animations')){
            doRecycle();
            return;
        }
        block.classList.add('task-recycling');
        var aborted = false;
        _activeAnimCleanup = {
            abort: function(){
                aborted = true;
                block.classList.remove('task-recycling');
                _activeAnimCleanup = null;
                doRecycle();
            }
        };
        block.addEventListener('animationend', function handler(){
            block.removeEventListener('animationend', handler);
            if(aborted) return;
            _activeAnimCleanup = null;
            doRecycle();
        });
    }

    if(_hasRepairOverlap(sid)){
        _abortCurrentAnim();
        showConfirm('回收任务', '<p style="color:#e65100;">检测到该任务在维修期间执行，确定回收？</p><p style="font-size:12px;color:var(--text-muted);">回收后，维修时间段信息不受影响。</p>').then(function(ok){
            if(ok) run();
        });
    } else {
        run();
    }
}
```

关键改动：
1. 动画开始前调用 `_abortCurrentAnim()` 立即完成上一个动画的服务器调用
2. `_activeAnimCleanup` 追踪当前动画，支持外部中止
3. 中止时跳过动画直接调用 `doRecycle()`

- [ ] **Step 3: 修改 `deleteWithAnim` — 同样的前置调用 + 可中止**

将 `timeline-ops.js` 第 736-777 行的整个函数替换为：

```javascript
function deleteWithAnim(ev, sid){
    var s = schedules.find(function(item){ return item.id == sid; });
    var block = document.querySelector('.task-block[data-sid="'+sid+'"]');
    if(!block) return;

    var doDelete = function(){
        fetch('/delete_schedule/'+sid).then(function(r){ return r.json(); }).then(function(d){
            _silentRefresh();
            refreshLiveStatus();
            showToast('已删除');
            if(s){
                pushUndo({type:'delete', sid:sid, tid:s.task_id, mid:s.machine_id, date:s.date,
                    start_min:s.start_min, end_min:s.end_min, machine_name:s.machine_name,
                    task_name:s.task_name, task_type:s.task_type, task_kind:s.task_kind,
                    priority:s.priority, difficulty:s.difficulty, remark:s.remark,
                    log_id: d.log_id});
            }
        });
    };

    _abortCurrentAnim(); // 中止之前的动画
    if(document.body.classList.contains('no-animations')){
        doDelete();
        return;
    }

    var aborted = false;
    _activeAnimCleanup = {
        abort: function(){
            aborted = true;
            var r = block.querySelector('.task-delete-ripple');
            if(r) r.remove();
            block.classList.remove('task-deleting');
            _activeAnimCleanup = null;
            doDelete();
        }
    };

    var rect = block.getBoundingClientRect();
    var cx = ev.clientX - rect.left;
    var cy = ev.clientY - rect.top;
    var ripple = document.createElement('div');
    ripple.className = 'task-delete-ripple';
    ripple.style.left = cx + 'px';
    ripple.style.top = cy + 'px';
    block.appendChild(ripple);
    ripple.addEventListener('animationend', function(){
        if(aborted) return;
        ripple.remove();
        block.classList.add('task-deleting');
        block.addEventListener('animationend', function handler2(){
            block.removeEventListener('animationend', handler2);
            if(aborted) return;
            _activeAnimCleanup = null;
            doDelete();
        });
    });
}
```

- [ ] **Step 4: 修改 `completeWithAnim` — 添加全局中止**

在 `completeWithAnim` 函数的 `run()` 调用前（约第 586 行是符合回收检查的路径，completeWithAnim 不需要确认），在函数体的 `fetch` 之前添加 `_abortCurrentAnim()`。

在 `completeWithAnim` 约第 591-592 行（函数开始，block 查找之后），在 `fetch('/complete_task/'+sid)` 之前添加：

```javascript
    _abortCurrentAnim();
```

同时将 complete 的 spread 动画同样注册到 `_activeAnimCleanup`。在 `run()` 函数（创建 spread 之后）添加 cleanup 注册。查找 completeWithAnim 中创建 spread 后、requestAnimationFrame 之前的代码（约第 660-680 行），在 spread 创建后添加：

```javascript
            var aborted = false;
            _activeAnimCleanup = {
                abort: function(){
                    aborted = true;
                    if(spread.parentNode) spread.remove();
                    _activeAnimCleanup = null;
                    finishComplete();
                }
            };
```

并在 `finishComplete` 函数（约第 690-697 行）开头添加：
```javascript
            if(aborted) return;
```

对 uncomplete 路径做同样处理。

注意：由于 `completeWithAnim` 结构复杂（有两个分支：complete 和 uncomplete），需要分别在不同分支中处理。具体改动位置需要精确。

更简洁的方案：直接在 `completeWithAnim` 的 `_skipCompleteSpread` 中处理——该函数已处理了同 block 二次点击。只需在函数入口加 `_abortCurrentAnim()` 即可覆盖跨 block 场景。同 block 二次点击的路径保持不变（仍然走 `_skipCompleteSpread`）。

实际修改：
- `completeWithAnim` 函数第 592-593 行之间（block 检查之后）插入 `_abortCurrentAnim();`
- complete 分支的 spread 动画（约第 660-700 行）中，创建 spread 后添加 `_activeAnimCleanup` 注册
- uncomplete 分支的 spread 动画（约第 627-670 行）中同样处理

因为 completeWithAnim 代码较长且有两个分支，以下是具体要改的三处：

**改动 A：** 在第 593 行（`if(!block) return;` 之后、592 行 `var block = ...` 之后）插入：
```javascript
    _abortCurrentAnim();
```

**改动 B：** 在 complete 分支创建 spread（约第 660 行 `block.appendChild(spread);` 之后、`requestAnimationFrame` 之前）添加：
```javascript
            var animAborted = false;
            _activeAnimCleanup = { abort: function(){
                animAborted = true;
                if(spread.parentNode) spread.remove();
                _activeAnimCleanup = null;
                finishComplete();
            }};
```

并在 `finishComplete` 函数（约第 690-695 行）开头加：
```javascript
            if(animAborted) return;
```

**改动 C：** 在 uncomplete 分支（约第 635 行 `block.appendChild(spread);` 之后、`requestAnimationFrame` 之前）做同样处理。在 `finishUncomplete`（约第 641-645 行）开头加 `if(animAborted) return;`。

- [ ] **Step 5: 验证**

手动测试：
1. 切换到回收模式，快速双击多个任务 → 每次双击应立即中止上一个动画并执行回收操作
2. 切换到完成模式，快速双击不同任务 → 无阻塞
3. 切换到删除模式，快速双击多个任务 → 无阻塞
4. 确认 server 调用都能执行（undo stack 正确记录）

- [ ] **Step 6: Commit**

```bash
git add static/timeline-ops.js
git commit -m "fix: make double-click animations skippable, prevent operation blocking"
```

---

### Task 3: 修复 `_refreshTimelineFromServer` 丢弃进行中动画

**Files:**
- Modify: `static/tasks.js`

- [ ] **Step 1: 全量刷新前中止所有动画**

在 `_refreshTimelineFromServer` 函数（约第 237 行）的第一行添加：

```javascript
    if (typeof _abortCurrentAnim === 'function') { _abortCurrentAnim(); }
```

这确保了在销毁并重建 DOM 之前，任何进行中的动画都被正确终止，不会留下永不触发的 `animationend` listener。

- [ ] **Step 2: 验证**

手动测试：开始一个删除动画 → 在动画播放期间，从机器管理页修改机器 task_kind（触发 `_refreshTimelineFromServer`）→ 确认删除操作能正确执行（_silentRefresh 在 doDelete 中正常工作）。

- [ ] **Step 3: Commit**

```bash
git add static/tasks.js
git commit -m "fix: abort in-progress animations before full timeline rebuild"
```

---

### Task 4: 排查并修复其他显示问题

- [ ] **Step 1: 检查 `task-split` 与 `task-completed` 的 CSS 层叠**

查看 `style.css` 第 974-976 行：
```css
.task-split {
    background: linear-gradient(135deg, var(--state-color-split), var(--state-color-split-dark));
}
```

`.task-split` 没有 `!important`。如果 split 任务同时被完成，`.task-completed` 的 `!important` 会覆盖 split 的背景。这是否正确？

分析：split 表示任务被切割成多段，应该是视觉提示而非状态标识。已完成状态应该优先。当前行为是正确的——已完成覆盖 split。

但存在一个问题：incompatible 的 split 任务（未完成但 task_kind 不匹配）现在能正确显示红色（`.task-incompatible` 有 `!important`，覆盖 `.task-split`）。Task 1 的 `!isCompleted` 修复确保已完成任务不会同时有 incompatible 和 completed 冲突。

无需修改。

- [ ] **Step 2: 检查 undo/redo 是否正确恢复 CSS class**

查看 `pushUndo` 和 `_reverseAction`：undo 操作通过 API 调用服务器，然后调用 `_silentRefresh()` 全量重建 DOM。Task 1 的 `!isCompleted` 修复保证了 `_createTaskBlock` 中 completed 任务不会得到 `task-incompatible`。所以 undo 恢复的任务颜色也是正确的。

无需修改。

- [ ] **Step 3: 检查 `_skipCompleteSpread` 在 abort 场景下的泄露**

Task 2 中 `_abortCurrentAnim` 的 abort 回调已经手动移除了 spread 元素。但还需确认 `_skipCompleteSpread`（同 block 二次点击路径）不会被 abort 干扰。

`_skipCompleteSpread` 在 `completeWithAnim` 入口处（第 596-600 行）被调用，它直接操作 `block.querySelector('.task-complete-spread')`。如果 `_abortCurrentAnim` 先被调用（跨 block 场景），spread 已经被移除，`_skipCompleteSpread` 的 `if(!spread) return;` 会安全退出。无冲突。

无需修改。

- [ ] **Step 4: Commit**

```bash
git commit --allow-empty -m "chore: display issue audit complete — no additional fixes needed"
```

---

## 自审清单

**1. Spec 覆盖：**
- ✅ 已完成任务变红 — Task 1：`&& !isCompleted` + CSS 防御
- ✅ 双击模式动画阻塞 — Task 2：全局中止机制 + recycle/delete 支持
- ✅ `_refreshTimelineFromServer` 丢弃动画 — Task 3：全量刷新前终止

**2. Placeholder 扫描：** 无 TBD/TODO，所有步骤包含具体代码。

**3. 类型一致性：**
- `_activeAnimCleanup` 结构 `{abort: function}` — 所有 3 个动画函数一致
- `_abortCurrentAnim()` 被 `recycleWithAnim`、`deleteWithAnim`、`completeWithAnim`、`_refreshTimelineFromServer` 调用
- `animAborted` 闭包变量在每个动画函数内独立，互不冲突
