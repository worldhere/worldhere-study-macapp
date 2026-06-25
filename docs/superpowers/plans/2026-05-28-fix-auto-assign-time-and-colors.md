# Fix Auto-Assign Time, Gradient Colors, and Color Reset

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three bugs: (1) custom start time in auto-assign ignores the date, always using today; (2) task bar color gradients show wrong colors after customization; (3) add per-color reset-to-default buttons.

**Architecture:** Three independent fixes in the frontend. Bug 1 is a JS logic fix in `auto-assign.js`. Bug 2 is a CSS change (remove `linear-gradient`) plus removing dead code in `colors.js`. Bug 3 adds UI buttons in `settings.html` and a handler in `colors.js`.

**Tech Stack:** Vanilla JS, CSS custom properties, HTML

---

### Task 1: Fix custom start time ignoring date offset

**Files:**
- Modify: `static/auto-assign.js:132-141`

- [ ] **Step 1: Fix `_getTimeParams` to calculate day offset for `ws`**

In `static/auto-assign.js`, replace lines 132-141 in `_getTimeParams()`:

Current code (lines 132-141):
```js
        } else if (fromMode && fromMode.value === 'custom') {
            var fd = document.getElementById('aa-from-date');
            var ft = document.getElementById('aa-from-time');
            if (fd && ft) {
                fromDate = fd.value; fromTime = ft.value;
                if (fromDate && fromTime) {
                    var d = new Date(fromDate + 'T' + fromTime);
                    if (!isNaN(d.getTime())) ws = d.getHours() * 60 + d.getMinutes();
                }
            }
```

Replace with:
```js
        } else if (fromMode && fromMode.value === 'custom') {
            var fd = document.getElementById('aa-from-date');
            var ft = document.getElementById('aa-from-time');
            if (fd && ft) {
                fromDate = fd.value; fromTime = ft.value;
                if (fromDate && fromTime) {
                    var baseDateForWs = (function(){
                        var sdEl = document.getElementById('schedule-date');
                        return sdEl ? sdEl.value : '';
                    })();
                    if (!baseDateForWs) baseDateForWs = new Date().toISOString().slice(0, 10);
                    var baseWs = new Date(baseDateForWs + 'T00:00');
                    var d = new Date(fromDate + 'T' + fromTime);
                    if (!isNaN(d.getTime()) && !isNaN(baseWs.getTime())) {
                        var dayDiffWs = Math.round((d - baseWs) / 86400000);
                        ws = dayDiffWs * 1440 + d.getHours() * 60 + d.getMinutes();
                    }
                }
            }
```

- [ ] **Step 2: Verify with a quick manual logic check**

The fix mirrors the `we` calculation logic (lines 153-165). Confirm:
- When `fromDate` = base date (e.g., 2026-05-28) and `fromTime` = 08:00, `dayDiffWs` = 0, `ws` = 480. Correct.
- When `fromDate` = base date + 2 days and `fromTime` = 08:00, `dayDiffWs` = 2, `ws` = 2*1440 + 480 = 3360. Correct.
- When `fromDate` = base date + 2 days and `fromTime` = 14:30, `ws` = 2*1440 + 870 = 3750. Correct.

- [ ] **Step 3: Commit**

```bash
git add static/auto-assign.js
git commit -m "fix: auto-assign custom start time now respects date offset

ws calculation in _getTimeParams was only extracting hours/minutes
from the Date object, ignoring the day difference from the base date.
Now mirrors the we calculation which correctly uses dayDiff * 1440."
```

---

### Task 2: Remove gradient effect from task bar colors

**Files:**
- Modify: `static/timeline.css:187-194,196,200,203,206,210,520,565`
- Modify: `static/colors.js:63-67`

- [ ] **Step 1: Replace type color gradients with solid colors in timeline.css**

In `static/timeline.css`, replace lines 187-194:

Current:
```css
.task-type-0 { background: linear-gradient(135deg, var(--type-color-0), var(--type-color-0-dark)); }
.task-type-1 { background: linear-gradient(135deg, var(--type-color-1), var(--type-color-1-dark)); }
.task-type-2 { background: linear-gradient(135deg, var(--type-color-2), var(--type-color-2-dark)); }
.task-type-3 { background: linear-gradient(135deg, var(--type-color-3), var(--type-color-3-dark)); }
.task-type-4 { background: linear-gradient(135deg, var(--type-color-4), var(--type-color-4-dark)); }
.task-type-5 { background: linear-gradient(135deg, var(--type-color-5), var(--type-color-5-dark)); }
.task-type-6 { background: linear-gradient(135deg, var(--type-color-6), var(--type-color-6-dark)); }
.task-type-7 { background: linear-gradient(135deg, var(--type-color-7), var(--type-color-7-dark)); }
```

Replace with:
```css
.task-type-0 { background: var(--type-color-0); }
.task-type-1 { background: var(--type-color-1); }
.task-type-2 { background: var(--type-color-2); }
.task-type-3 { background: var(--type-color-3); }
.task-type-4 { background: var(--type-color-4); }
.task-type-5 { background: var(--type-color-5); }
.task-type-6 { background: var(--type-color-6); }
.task-type-7 { background: var(--type-color-7); }
```

- [ ] **Step 2: Replace state color gradients with solid colors in timeline.css**

Replace the following lines in `static/timeline.css`:

Line 196:
```css
.status-completed .task-block { background: linear-gradient(135deg, var(--state-color-completed), var(--state-color-completed-dark)) !important; }
```
→
```css
.status-completed .task-block { background: var(--state-color-completed) !important; }
```

Line 200:
```css
.status-paused .task-block { background: linear-gradient(135deg, var(--state-color-paused), var(--state-color-paused-dark)) !important; }
```
→
```css
.status-paused .task-block { background: var(--state-color-paused) !important; }
```

Line 203:
```css
.status-post-pause .task-block { background: linear-gradient(135deg, var(--state-color-post-pause), var(--state-color-post-pause-dark)) !important; }
```
→
```css
.status-post-pause .task-block { background: var(--state-color-post-pause) !important; }
```

Line 210:
```css
.task-block-split { background: linear-gradient(135deg, var(--state-color-split), var(--state-color-split-dark)); }
```
→
```css
.task-block-split { background: var(--state-color-split); }
```

Line 520:
```css
background: linear-gradient(135deg, var(--state-color-completed), var(--state-color-completed-dark));
```
→
```css
background: var(--state-color-completed);
```

Line 565 (this is a hardcoded green, not a variable — but keep as is since it's not using custom properties that can be changed by the user; no change needed for this line).

- [ ] **Step 3: Remove dark variant setting from applyColorSetting in colors.js**

In `static/colors.js`, remove lines 63-67:

Current (lines 59-67):
```js
    } else if (_stateColorKeys.indexOf(colorKey) !== -1) {
        group = 'states';
        cssVar = _stateCssVars[colorKey];
        root.style.setProperty(cssVar, hexValue);
        // Also set dark variant for gradient usage
        var darkVar = _stateDarkVars[colorKey];
        if (darkVar) {
            root.style.setProperty(darkVar, darkenHex(hexValue, 0.75));
        }
```

Replace with:
```js
    } else if (_stateColorKeys.indexOf(colorKey) !== -1) {
        group = 'states';
        cssVar = _stateCssVars[colorKey];
        root.style.setProperty(cssVar, hexValue);
```

- [ ] **Step 4: Commit**

```bash
git add static/timeline.css static/colors.js
git commit -m "fix: remove gradient effect from task bar colors

Changed task-type and state color backgrounds from linear-gradient
to solid colors. Removed dark variant computation from
applyColorSetting since dark variants are no longer needed."
```

---

### Task 3: Add restore-default button for each color setting

**Files:**
- Modify: `templates/panels/settings.html:145-198` (add reset buttons to all color inputs)
- Modify: `static/colors.js` (add `resetColorSetting` function, update `_renderTypeColorInputs`)

- [ ] **Step 1: Add `resetColorSetting` function to colors.js**

At the end of `static/colors.js`, add:

```js
function resetColorSetting(colorKey) {
    var defaults = (typeof _colorDefaults !== 'undefined') ? _colorDefaults : {};
    var palette = (typeof _typeColorPalette !== 'undefined') ? _typeColorPalette : ['#3b82f6','#10b981','#f59e0b','#8b5cf6','#ef4444','#06b6d4','#f97316','#84cc16'];

    if (_segColorKeys.indexOf(colorKey) !== -1) {
        // Segment overlay color
        var defColor = defaults[colorKey] || '#3b82f6';
        applyColorSetting(colorKey, defColor);
        var segMap = {seg_work:'seg-work', seg_ot:'seg-ot', seg_break:'seg-break', seg_gap:'seg-gap'};
        var input = document.getElementById('cs-' + segMap[colorKey]);
        if (input) input.value = defColor;
    } else if (_stateColorKeys.indexOf(colorKey) !== -1) {
        // State color
        var defState = defaults[colorKey] || '#3b82f6';
        applyColorSetting(colorKey, defState);
        var stateId = 'cs-state-' + colorKey.replace(/_/g, '-');
        var sInput = document.getElementById(stateId);
        if (sInput) sInput.value = defState;
    } else {
        // Type color: colorKey is the type name
        var mts = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.machine_types) ? APP_CONFIG.machine_types : [];
        var idx = -1;
        for (var i = 0; i < mts.length; i++) {
            if (mts[i].key === colorKey) { idx = i; break; }
        }
        var defType = palette[idx % palette.length] || '#3b82f6';
        applyTypeColor(colorKey, defType);
        var safeId = _sanitizeId(colorKey);
        var tInput = document.getElementById('cs-type-' + safeId);
        if (tInput) tInput.value = defType;
    }
}
```

- [ ] **Step 2: Update `_renderTypeColorInputs` to include reset buttons**

In `static/colors.js`, modify the `_renderTypeColorInputs` function, replacing the `html +=` line inside the loop (around line 169-173):

Current:
```js
        html += '<label style="display:flex;align-items:center;gap:6px;">' +
            escHtml(typeName) + '：' +
            '<input type="color" id="cs-type-' + safeId + '" value="' + color + '" onchange="applyTypeColor(\'' + escHtml(typeName) + '\', this.value)">' +
            '<span class="color-hex-label" id="cs-type-' + safeId + '-hex">' + color + '</span>' +
            '</label>';
```

Replace with:
```js
        html += '<label style="display:flex;align-items:center;gap:6px;">' +
            escHtml(typeName) + '：' +
            '<input type="color" id="cs-type-' + safeId + '" value="' + color + '" onchange="applyTypeColor(\'' + escHtml(typeName) + '\', this.value)">' +
            '<span class="color-hex-label" id="cs-type-' + safeId + '-hex">' + color + '</span>' +
            '<button class="btn-sm" onclick="resetColorSetting(\'' + escHtml(typeName) + '\');return false;" title="恢复默认值">↺</button>' +
            '</label>';
```

- [ ] **Step 3: Add reset buttons to segment overlay color inputs in settings.html**

In `templates/panels/settings.html`, update each segment overlay color label to include a reset button.

Line 146-148, change:
```html
                    <label style="display:flex;align-items:center;gap:6px;">
                        工作时间段：<input type="color" id="cs-seg-work" onchange="applyColorSetting('seg_work', this.value)">
                        <span class="color-hex-label" id="cs-seg-work-hex">#facc15</span>
                    </label>
```
To:
```html
                    <label style="display:flex;align-items:center;gap:6px;">
                        工作时间段：<input type="color" id="cs-seg-work" onchange="applyColorSetting('seg_work', this.value)">
                        <span class="color-hex-label" id="cs-seg-work-hex">#facc15</span>
                        <button class="btn-sm" onclick="resetColorSetting('seg_work');return false;" title="恢复默认值">↺</button>
                    </label>
```

Line 150-152, change:
```html
                    <label style="display:flex;align-items:center;gap:6px;">
                        加班时间段：<input type="color" id="cs-seg-ot" onchange="applyColorSetting('seg_ot', this.value)">
                        <span class="color-hex-label" id="cs-seg-ot-hex">#f97316</span>
                    </label>
```
To:
```html
                    <label style="display:flex;align-items:center;gap:6px;">
                        加班时间段：<input type="color" id="cs-seg-ot" onchange="applyColorSetting('seg_ot', this.value)">
                        <span class="color-hex-label" id="cs-seg-ot-hex">#f97316</span>
                        <button class="btn-sm" onclick="resetColorSetting('seg_ot');return false;" title="恢复默认值">↺</button>
                    </label>
```

Line 154-156, change:
```html
                    <label style="display:flex;align-items:center;gap:6px;">
                        休息时间段：<input type="color" id="cs-seg-break" onchange="applyColorSetting('seg_break', this.value)">
                        <span class="color-hex-label" id="cs-seg-break-hex">#3b82f6</span>
                    </label>
```
To:
```html
                    <label style="display:flex;align-items:center;gap:6px;">
                        休息时间段：<input type="color" id="cs-seg-break" onchange="applyColorSetting('seg_break', this.value)">
                        <span class="color-hex-label" id="cs-seg-break-hex">#3b82f6</span>
                        <button class="btn-sm" onclick="resetColorSetting('seg_break');return false;" title="恢复默认值">↺</button>
                    </label>
```

Line 158-160, change:
```html
                    <label style="display:flex;align-items:center;gap:6px;">
                        工作间隔段：<input type="color" id="cs-seg-gap" onchange="applyColorSetting('seg_gap', this.value)">
                        <span class="color-hex-label" id="cs-seg-gap-hex">#000000</span>
                    </label>
```
To:
```html
                    <label style="display:flex;align-items:center;gap:6px;">
                        工作间隔段：<input type="color" id="cs-seg-gap" onchange="applyColorSetting('seg_gap', this.value)">
                        <span class="color-hex-label" id="cs-seg-gap-hex">#000000</span>
                        <button class="btn-sm" onclick="resetColorSetting('seg_gap');return false;" title="恢复默认值">↺</button>
                    </label>
```

- [ ] **Step 4: Add reset buttons to state color inputs in settings.html**

Update each state color label (lines 174-197):

Line 174-176:
```html
                    <label style="display:flex;align-items:center;gap:6px;">
                        已完成任务：<input type="color" id="cs-state-completed" onchange="applyColorSetting('completed', this.value)">
                        <span class="color-hex-label" id="cs-state-completed-hex">#84cc16</span>
                        <button class="btn-sm" onclick="resetColorSetting('completed');return false;" title="恢复默认值">↺</button>
                    </label>
```

Line 178-180:
```html
                    <label style="display:flex;align-items:center;gap:6px;">
                        切割任务：<input type="color" id="cs-state-split" onchange="applyColorSetting('split', this.value)">
                        <span class="color-hex-label" id="cs-state-split-hex">#a78bfa</span>
                        <button class="btn-sm" onclick="resetColorSetting('split');return false;" title="恢复默认值">↺</button>
                    </label>
```

Line 182-184:
```html
                    <label style="display:flex;align-items:center;gap:6px;">
                        维修轨道背景：<input type="color" id="cs-state-repair-bg" onchange="applyColorSetting('repair_bg', this.value)">
                        <span class="color-hex-label" id="cs-state-repair-bg-hex">#fef2f2</span>
                        <button class="btn-sm" onclick="resetColorSetting('repair_bg');return false;" title="恢复默认值">↺</button>
                    </label>
```

Line 186-188:
```html
                    <label style="display:flex;align-items:center;gap:6px;">
                        维修轨道边框：<input type="color" id="cs-state-repair-border" onchange="applyColorSetting('repair_border', this.value)">
                        <span class="color-hex-label" id="cs-state-repair-border-hex">#fca5a5</span>
                        <button class="btn-sm" onclick="resetColorSetting('repair_border');return false;" title="恢复默认值">↺</button>
                    </label>
```

Line 190-192:
```html
                    <label style="display:flex;align-items:center;gap:6px;">
                        暂停中任务栏：<input type="color" id="cs-state-paused" onchange="applyColorSetting('paused', this.value)">
                        <span class="color-hex-label" id="cs-state-paused-hex">#fca5a5</span>
                        <button class="btn-sm" onclick="resetColorSetting('paused');return false;" title="恢复默认值">↺</button>
                    </label>
```

Line 194-196:
```html
                    <label style="display:flex;align-items:center;gap:6px;">
                        维修中任务栏：<input type="color" id="cs-state-post-pause" onchange="applyColorSetting('post_pause', this.value)">
                        <span class="color-hex-label" id="cs-state-post-pause-hex">#fbcfe8</span>
                        <button class="btn-sm" onclick="resetColorSetting('post_pause');return false;" title="恢复默认值">↺</button>
                    </label>
```

- [ ] **Step 5: Commit**

```bash
git add static/colors.js templates/panels/settings.html
git commit -m "feat: add restore-default button for each color setting

Each color picker (segment overlays, type colors, state colors) now
has a reset button that restores the factory default value."
```

---

### Task 4: Verify all changes together

**Files:** None (verification only)

- [ ] **Step 1: Check for any remaining dark variant usage in JS**

Run: Search `static/` for `_stateDarkVars` and `-dark` CSS variable references in JS files.
Expected: `_stateDarkVars` is no longer referenced by any active code (it is still defined in `settings.js:862` but never read — acceptable as dead declaration).

- [ ] **Step 2: Check consistency of `resetColorSetting` key names**

Verify that all `onclick="resetColorSetting('...')"` calls use valid keys:
- Segment: `seg_work`, `seg_ot`, `seg_break`, `seg_gap`
- State: `completed`, `split`, `repair_bg`, `repair_border`, `paused`, `post_pause`
- Type: matches `APP_CONFIG.machine_types[].key` values

These all match the keys used in `applyColorSetting` / `applyTypeColor` and `_colorDefaults`. Consistent.

- [ ] **Step 3: Verify the app loads without JS errors**

Start the app and check browser console for errors when opening the settings panel and the auto-assign dialog.
