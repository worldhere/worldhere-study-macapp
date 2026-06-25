# Fix Auto-Assign "Now" Date Offset Bug

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When auto-assign `fromMode` is `"now"`, calculate the correct absolute minute offset including the date difference between the real current time and the timeline view date, preventing tasks from being assigned to the wrong date.

**Architecture:** Single-file fix in `static/auto-assign.js` — the `_getTimeParams()` function's `"now"` branch currently only captures time-of-day (0-1440) without day offset. The fix mirrors the `"custom"` branch's pattern of computing a day offset relative to the `schedule-date` base, using `Math.round((now - baseDate) / 86400000)` to compute the day difference.

**Tech Stack:** Vanilla JavaScript (no libraries)

---

### Task 1: Fix `_getTimeParams()` to include day offset in "now" mode

**Files:**
- Modify: `static/auto-assign.js:413-416`

- [ ] **Step 1: Read the current "now" branch to confirm the exact text**

The current code at lines 413-416 in `auto-assign.js`:

```javascript
        if (fromMode && fromMode.value === 'now') {
            var now = new Date();
            ws = now.getHours() * 60 + now.getMinutes();
```

This only captures time-of-day (e.g., 600 for 10:00 AM) without accounting for the day offset between the real current date and the view's `schedule-date`.

- [ ] **Step 2: Replace the "now" branch with day-offset-aware calculation**

Replace lines 413-416:

```javascript
        if (fromMode && fromMode.value === 'now') {
            var now = new Date();
            ws = now.getHours() * 60 + now.getMinutes();
```

With:

```javascript
        if (fromMode && fromMode.value === 'now') {
            var now = new Date();
            var baseDateForWs = (function(){
                var sdEl = document.getElementById('schedule-date');
                return sdEl ? sdEl.value : '';
            })();
            if (!baseDateForWs) baseDateForWs = new Date().toISOString().slice(0, 10);
            var baseWs = new Date(baseDateForWs + 'T00:00');
            var dayDiffWs = Math.round((now - baseWs) / 86400000);
            ws = dayDiffWs * 1440 + now.getHours() * 60 + now.getMinutes();
```

This mirrors the calculation pattern already used in the `"custom"` branch (lines 417-434), which correctly computes day offsets.

- [ ] **Step 3: Verify the fix by reviewing the full `_getTimeParams` function for consistency**

Read the full `_getTimeParams` function after the edit and confirm:
1. The `"now"` branch now uses the same `schedule-date` base and `dayDiffWs` pattern as `"custom"`
2. The variable `baseDateForWs` doesn't shadow any outer variables (it's scoped inside the block with `var`)
3. The `ws` value for the same-day case (view date = today) is unchanged: `dayDiffWs = 0`, so `ws = 0 + hours*60 + minutes` — same as before

- [ ] **Step 4: Clear browser cache and test the fix manually**

Run the app and test the following scenarios:

1. **Same day (regression check):** Set view to today, open auto-assign with `fromMode = "now"` → preview should show tasks at the current time on today's date. This should be unchanged.

2. **View in the past:** Set view to yesterday (June 3), open auto-assign with `fromMode = "now"` → `ws` should be ≥ 1440 (e.g., 2040 = June 4 10:00 AM relative to June 3 view). Tasks should be assigned to June 4, and preview cards should appear on the June 4 portion of the timeline (to the right of June 3).

3. **View in the future:** Set view to tomorrow, open auto-assign with `fromMode = "now"` → `ws` should be negative (e.g., -840 = June 4 10:00 AM relative to June 5 view), which the backend clamps to 0. Tasks should be assigned to the view date starting at 00:00.

- [ ] **Step 5: Commit**

```bash
git add static/auto-assign.js
git commit -m "fix: auto-assign 'now' mode uses correct date offset relative to view date

Previously, the 'now' fromMode only captured time-of-day (hours*60+minutes)
without computing the day offset between the actual current date and the
timeline view's schedule-date. This caused tasks to be assigned to the
view's date instead of the actual current date when the two differed.

Now the 'now' branch mirrors the 'custom' branch pattern: compute
dayDiffWs = Math.round((now - baseDate) / 86400000) and add it to the
minute-in-day value, so the backend receives the correct absolute minute
offset from the base date."
```

---

### Self-Review

**1. Spec coverage:**
- ✅ Auto-assign "now" mode uses correct date offset → Task 1 implements this
- ✅ Preview cards render on correct date → This follows automatically from the backend receiving the correct `work_start_min`; `_renderPreviewCards()` already handles cross-day offsets correctly (lines 693-700 in timeline-render.js)

**2. Placeholder scan:**
- No TBD, TODO, or "implement later" patterns
- No "add appropriate error handling" without specifics
- All code changes are shown inline

**3. Type consistency:**
- `ws` remains a number (integer minutes)
- `dayDiffWs` is an integer from `Math.round`
- The backend's `max(0, ws)` clamp handles negative values from future-date views correctly
