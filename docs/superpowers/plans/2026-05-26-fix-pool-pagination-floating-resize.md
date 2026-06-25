# Fix Pool Pagination Disappearing & Floating Window Resize Corruption

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two regressions: pool pagination disappearing when switching to "底部固定" mode, and residual inline width/height from floating window resize corrupting layout after mode switch.

**Architecture:** Two small targeted fixes in the mode-switching functions. In `_applyTaskPoolMode()` (core.js), replace the unconditional pagination-hide with a `fixed`-mode branch that calls `_renderPoolPagination()`, and clear width/height inline styles when leaving floating mode. Mirror the width/height cleanup in `_restorePoolModeState()` (tasks.js).

**Tech Stack:** Vanilla JavaScript, CSS, Flask/Jinja2 (no backend changes)

---

## Root Cause Summary

**Bug 1 — Pagination disappears:** `_applyTaskPoolMode()` line 332 unconditionally sets `#pool-page-controls` to `display: none` for all non-floating modes, then never calls `_renderPoolPagination()`. When switching to `fixed` mode, pagination stays hidden and all items are shown.

**Bug 2 — Resize corruption:** CSS `resize: both` on `.pool-mode-floating` lets the browser write inline `width`/`height` on `#task-pool`. `_applyTaskPoolMode()` clears `left/top/right/bottom` when leaving floating mode, but not `width`/`height`. Those residual inline styles override the CSS class styles in `fixed`/`below` modes.

---

## File Map

| File | Change |
|------|--------|
| `static/core.js:326-335` | Fix `_applyTaskPoolMode()` else branch: call `_renderPoolPagination()` for `fixed` mode, clear width/height |
| `static/tasks.js:879-884` | Fix `_restorePoolModeState()` else branch: clear width/height when not floating |

---

### Task 1: Fix `_applyTaskPoolMode()` — pagination and resize cleanup in core.js

**Files:**
- Modify: `static/core.js:326-335`

- [ ] **Step 1: Replace the else branch in `_applyTaskPoolMode()`**

The current code at `static/core.js` lines 325-335:

```javascript
    } else {
        _disablePoolDrag();
        // 清除浮动拖拽遗留的内联定位样式，避免覆盖 CSS 类
        pool.style.left = '';
        pool.style.top = '';
        pool.style.right = '';
        pool.style.bottom = '';
        document.getElementById('pool-page-controls').style.display = 'none';
        var items = document.querySelectorAll('#pool-task-items .task-draggable');
        items.forEach(function(it) { it.style.display = ''; });
    }
```

Replace with:

```javascript
    } else {
        _disablePoolDrag();
        // 清除浮动拖拽/缩放遗留的内联样式，避免覆盖 CSS 类
        pool.style.left = '';
        pool.style.top = '';
        pool.style.right = '';
        pool.style.bottom = '';
        pool.style.width = '';
        pool.style.height = '';
        if (_taskPoolMode === 'fixed') {
            // 底部固定模式：由 _renderPoolPagination 接管分页显示
            if (typeof _renderPoolPagination === 'function') _renderPoolPagination();
        } else {
            // 下方跟随模式：隐藏分页，显示全部
            document.getElementById('pool-page-controls').style.display = 'none';
            var items = document.querySelectorAll('#pool-task-items .task-draggable');
            items.forEach(function(it) { it.style.display = ''; });
        }
    }
```

- [ ] **Step 2: Verify in browser**

1. Start the app: `python app.py`
2. Open http://localhost:5000
3. Switch to "底部固定" mode — verify pagination controls appear when there are >20 unassigned tasks
4. Switch to "浮动窗口" mode, resize the floating window by dragging its bottom-right corner
5. Switch back to "底部固定" — verify the pool uses full width (not the resized floating width)
6. Switch back to "下方跟随" — verify the pool uses normal inline width

Expected: Pagination visible in fixed mode. No residual size from floating resize in other modes.

---

### Task 2: Fix `_restorePoolModeState()` — resize cleanup in tasks.js

**Files:**
- Modify: `static/tasks.js:879-884`

- [ ] **Step 1: Replace the else branch in `_restorePoolModeState()`**

The current code at `static/tasks.js` lines 879-884:

```javascript
    } else {
        var controls = document.getElementById('pool-page-controls');
        if (controls) controls.style.display = 'none';
        var items = document.querySelectorAll('#pool-task-items .task-draggable');
        items.forEach(function(it) { it.style.display = ''; });
    }
```

Replace with:

```javascript
    } else {
        // 清除浮动缩放遗留的内联宽高
        pool.style.width = '';
        pool.style.height = '';
        var controls = document.getElementById('pool-page-controls');
        if (controls) controls.style.display = 'none';
        var items = document.querySelectorAll('#pool-task-items .task-draggable');
        items.forEach(function(it) { it.style.display = ''; });
    }
```

- [ ] **Step 2: Verify in browser**

1. In floating mode, resize the window, then trigger a data refresh (e.g., add/edit a task)
2. After refresh, verify the pool layout is correct for the current mode (no residual floating size)
3. Switch modes back and forth and verify consistent behavior

Expected: After data refresh while in non-floating mode, pool uses CSS class dimensions, not residual inline width/height from a prior floating resize.

---

### Task 3: Final verification — full mode-switching cycle

- [ ] **Step 1: Run through the complete test matrix**

Manual test checklist:

| From | To | Check |
|------|----|-------|
| below | fixed | Pagination appears, full width, body padding 40vh |
| fixed | floating | Drag works, pagination hidden, all items shown |
| floating (after resize) | fixed | Pagination reappears, full width, no residual size |
| floating (after drag) | below | Inline flow, no residual position, no pagination |
| fixed | below | Inline flow, no pagination, body padding removed |
| below | floating | Drag works, window at default floating position |

- [ ] **Step 2: Verify with small data set (<20 unassigned tasks)**

In fixed mode with fewer than `_taskPoolPageSize` items, pagination should remain hidden (no pages needed) but all items should be visible.

Expected: All items visible, no pagination bar. When items grow beyond page size, pagination appears.
