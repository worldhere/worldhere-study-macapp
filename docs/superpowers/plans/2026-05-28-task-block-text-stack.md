# Task Bar Text Stacking (Narrow Bar Two-Line Mode)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a task bar is too narrow to show both name and time on one line, switch to a two-line stacked layout (name on top, time on bottom) so the time is always visible.

**Architecture:** A `_checkTaskBlockStacked(block)` function compares `scrollWidth` vs `clientWidth` to detect overflow. If overflowing, adds `task-stacked` CSS class. Called after every render, resize, zoom, and window resize event. CSS `flex-direction: column` with vertical centering.

**Tech Stack:** Vanilla JS, CSS flexbox

---

### Task 1: Add `task-label` class and detection function

**Files:**
- Modify: `static/timeline-render.js:332-338` (add class to label span)
- Modify: `static/timeline-render.js` (add `_checkTaskBlockStacked` and `_checkAllTaskBlocksStacked`)

- [ ] **Step 1: Add `task-label` class to the name span in `_createTaskBlock`**

In `static/timeline-render.js`, line 336, add `label.className = 'task-label';`:

```js
    let label = document.createElement('span');
    label.className = 'task-label';
    label.innerHTML = txt;
    block.appendChild(label);
```

- [ ] **Step 2: Add `_checkTaskBlockStacked` function**

Add after `updateBlockDisplay` (after line 56):

```js
function _checkTaskBlockStacked(block) {
    if (!block) return;
    // Ensure the block has been laid out before measuring
    var overflowing = block.scrollWidth > block.clientWidth;
    if (overflowing && !block.classList.contains('task-stacked')) {
        block.classList.add('task-stacked');
    } else if (!overflowing && block.classList.contains('task-stacked')) {
        block.classList.remove('task-stacked');
    }
}
```

- [ ] **Step 3: Add `_checkAllTaskBlocksStacked` function**

Add after `_checkTaskBlockStacked`:

```js
function _checkAllTaskBlocksStacked() {
    document.querySelectorAll('.task-block').forEach(function(block) {
        _checkTaskBlockStacked(block);
    });
}
```

- [ ] **Step 4: Commit**

```bash
git add static/timeline-render.js
git commit -m "feat: add task block stacking detection functions"
```

---

### Task 2: Hook detection into render and resize paths

**Files:**
- Modify: `static/timeline-render.js:_renderAllTaskBlocks` (after block append)
- Modify: `static/timeline-render.js:updateBlockDisplay` (after width set)

- [ ] **Step 1: Call `_checkTaskBlockStacked` in `_renderAllTaskBlocks`**

In `static/timeline-render.js`, after `track.appendChild(blk);` (line 43), add the check:

Current (lines 42-44):
```js
        });
        track.appendChild(blk);
        syncTaskTableTime(blk, absStart, absEnd);
```

Replace with:
```js
        });
        track.appendChild(blk);
        _checkTaskBlockStacked(blk);
        syncTaskTableTime(blk, absStart, absEnd);
```

- [ ] **Step 2: Call `_checkTaskBlockStacked` at end of `updateBlockDisplay`**

In `static/timeline-render.js`, add at the end of `updateBlockDisplay` (after the timeSpan update, line 56):

Current (lines 48-56):
```js
function updateBlockDisplay(block, absStart, absEnd){
    const vs = _getViewStartMin();
    block.style.setProperty('--start', String(absStart));
    block.style.setProperty('--dur', String(Math.max(1, absEnd-absStart)));
    block.style.left = minToPx(absStart - vs) + 'px';
    block.style.width = minToPx(Math.max(1, absEnd - absStart)) + 'px';
    const timeSpan = block.querySelector('.task-time');
    if(timeSpan) timeSpan.textContent = _formatAbsMin(absStart)+'-'+_formatAbsMin(absEnd);
}
```

Replace with:
```js
function updateBlockDisplay(block, absStart, absEnd){
    const vs = _getViewStartMin();
    block.style.setProperty('--start', String(absStart));
    block.style.setProperty('--dur', String(Math.max(1, absEnd-absStart)));
    block.style.left = minToPx(absStart - vs) + 'px';
    block.style.width = minToPx(Math.max(1, absEnd - absStart)) + 'px';
    const timeSpan = block.querySelector('.task-time');
    if(timeSpan) timeSpan.textContent = _formatAbsMin(absStart)+'-'+_formatAbsMin(absEnd);
    _checkTaskBlockStacked(block);
}
```

- [ ] **Step 3: Commit**

```bash
git add static/timeline-render.js
git commit -m "fix: hook task block stacking check into render and resize paths"
```

---

### Task 3: Hook detection into zoom change and window resize

**Files:**
- Modify: `static/timeline.js:setZoom` (after grid rebuild)
- Create: (inline in `static/timeline-render.js`) window resize listener

- [ ] **Step 1: Call `_checkAllTaskBlocksStacked` after zoom change**

In `static/timeline.js`, modify `setZoom` to add the check after `rebuildTimelineGrid()`:

Current (lines 3-15):
```js
function setZoom(){
    const hw = parseInt(document.getElementById('zoom-hour').value, 10);
    const rh = parseInt(document.getElementById('zoom-row').value, 10);
    document.documentElement.style.setProperty('--hourWidth', hw+'px');
    document.documentElement.style.setProperty('--rowHeight', rh+'px');
    try{
        localStorage.setItem('zoomHour', String(hw));
        localStorage.setItem('zoomRow', String(rh));
    }catch(e){}
    renderCurrentTimeMarker();
    renderViewMask();
    rebuildTimelineGrid();
}
```

Replace with:
```js
function setZoom(){
    const hw = parseInt(document.getElementById('zoom-hour').value, 10);
    const rh = parseInt(document.getElementById('zoom-row').value, 10);
    document.documentElement.style.setProperty('--hourWidth', hw+'px');
    document.documentElement.style.setProperty('--rowHeight', rh+'px');
    try{
        localStorage.setItem('zoomHour', String(hw));
        localStorage.setItem('zoomRow', String(rh));
    }catch(e){}
    renderCurrentTimeMarker();
    renderViewMask();
    rebuildTimelineGrid();
    if (typeof _checkAllTaskBlocksStacked === 'function') _checkAllTaskBlocksStacked();
}
```

- [ ] **Step 2: Add debounced window resize handler**

In `static/timeline-render.js`, add a debounced resize listener at the bottom of the file (or alongside the DOMContentLoaded init):

```js
var _stackedResizeTimer = null;
window.addEventListener('resize', function() {
    if (_stackedResizeTimer) clearTimeout(_stackedResizeTimer);
    _stackedResizeTimer = setTimeout(function() {
        if (typeof _checkAllTaskBlocksStacked === 'function') _checkAllTaskBlocksStacked();
    }, 150);
});
```

- [ ] **Step 3: Commit**

```bash
git add static/timeline.js static/timeline-render.js
git commit -m "fix: recheck task block stacking on zoom and window resize"
```

---

### Task 4: Add CSS for two-line stacked layout

**Files:**
- Modify: `static/timeline.css` (add `.task-block.task-stacked` rules)

- [ ] **Step 1: Add stacked layout CSS**

Add after the `.task-block` ruleset (after line ~171 in timeline.css):

```css
/* Two-line stacked layout for narrow bars */
.task-block.task-stacked {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    line-height: 1.3;
}
.task-block.task-stacked .task-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
}
.task-block.task-stacked .task-time {
    flex-shrink: 0;
}
.task-block.task-stacked .task-remark {
    display: none;
}
```

- [ ] **Step 2: Commit**

```bash
git add static/timeline.css
git commit -m "feat: add CSS for two-line stacked task bar layout"
```

---

### Task 5: Verify end-to-end

**Files:** None (verification only)

- [ ] **Step 1: Verify the complete modified flow**

Checklist:
1. `_createTaskBlock` sets `label.className = 'task-label'` on the name span
2. After `track.appendChild(blk)` in `_renderAllTaskBlocks`, `_checkTaskBlockStacked(blk)` runs
3. At end of `updateBlockDisplay`, `_checkTaskBlockStacked(block)` runs
4. `setZoom()` calls `_checkAllTaskBlocksStacked()` after grid rebuild
5. `window.resize` (debounced 150ms) calls `_checkAllTaskBlocksStacked()`
6. `.task-block.task-stacked` CSS rules are present in timeline.css

- [ ] **Step 2: Check for conflicts with existing `.task-block` styles**

The existing `.task-block` has `white-space: nowrap`, `overflow: hidden`, `text-overflow: ellipsis`. In stacked mode, the block-level `white-space: nowrap` still applies to the flex container, but the children (`task-label`, `task-time`) each have their own text wrapping. The `overflow: hidden` on the block prevents text from spilling out — this is still desired in both modes. No conflicts.
