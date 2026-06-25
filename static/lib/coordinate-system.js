// coordinate-system.js — 时间轴坐标系统 & 工具函数
// 从 core.js 拆出：坐标常量、absMin 换算、班次范围、时间格式化、拖拽全局变量

// ========== 坐标系统常量 ==========
var MINS_PER_DAY = 1440;
var MINS_PER_HOUR = 60;
var MAX_VIEW_SPAN = MINS_PER_DAY * 28;   // 视图跨度硬限制 40320（±28天）
var MIN_VIEW_SPAN = -MINS_PER_DAY * 28;
var MAX_COORD = MINS_PER_DAY * 180;      // 坐标范围 ±180天（约6个月）
var MAX_ABS_MIN = MAX_COORD - 1;         // 259199
var MIN_ABS_MIN = -MAX_COORD;            // -259200

// ========== 坐标系统工具函数 ==========
function dayOffset(absMin) { return Math.floor(absMin / MINS_PER_DAY); }
function minuteInDay(absMin) { return ((absMin % MINS_PER_DAY) + MINS_PER_DAY) % MINS_PER_DAY; }
function absMinFromDayMin(dayOff, minute) { return dayOff * MINS_PER_DAY + minute; }
function minToPx(deltaMin) { return (deltaMin / MINS_PER_HOUR) * getHourWidth(); }
function pxToMin(px) { return Math.round((px / getHourWidth()) * MINS_PER_HOUR); }
function clampAbsMin(val) { return Math.max(MIN_ABS_MIN, Math.min(MAX_ABS_MIN, Math.round(val) || 0)); }
function clampViewSpan(val) { return Math.max(MIN_VIEW_SPAN, Math.min(MAX_VIEW_SPAN, Math.round(val) || 0)); }

// ========== 拖拽全局变量 ==========
let currentDragTid = null, currentDragType = null;
let currentDragSid = null;
let dragOffsetX = 0;
let movingSid = null, moveStartX = 0, moveStartLeft = 0;
let resizingSid = null, resizeDir = '', resizeStartX = 0, resizeStartLeft = 0, resizeStartWidth = 0;
const MACHINE_NAME_WIDTH = 130;

// ========== 日期/时间核心工具 ==========

function hhmmToMin(s){
    if(!s) return null;
    s = String(s).replace(/[：]/g, ':');
    const m = String(s).trim().match(/^(\d{1,2}):(\d{2})$/);
    if(!m) return null;
    const hh = Math.max(0, Math.min(23, parseInt(m[1],10)));
    const mm = Math.max(0, Math.min(59, parseInt(m[2],10)));
    return hh*60+mm;
}

function _dateAddDays(iso, days){
    // iso: YYYY-MM-DD
    const m = String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(!m) return iso;
    const dt = new Date(parseInt(m[1],10), parseInt(m[2],10)-1, parseInt(m[3],10));
    dt.setDate(dt.getDate() + (days|0));
    const y = dt.getFullYear();
    const mon = String(dt.getMonth()+1).padStart(2,'0');
    const d = String(dt.getDate()).padStart(2,'0');
    return `${y}-${mon}-${d}`;
}

function _absMinToDateMin(absMin){
    // 返回 {date, min}：支持前一天（负absMin）和多天跨天
    const base = document.getElementById('schedule-date').value;
    const a = Math.round(absMin) || 0;
    const dayOff = dayOffset(a);
    const m = a - dayOff * MINS_PER_DAY;
    return {date: _dateAddDays(base, dayOff), min: m};
}

function getHourWidth(){
    const v = getComputedStyle(document.documentElement).getPropertyValue('--hourWidth').trim().replace('px','');
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 80;
}

function getRowHeight(){
    const v = getComputedStyle(document.documentElement).getPropertyValue('--rowHeight').trim().replace('px','');
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 40;
}

function minPerPx(){
    return MINS_PER_HOUR / getHourWidth();
}

// ========== 时间范围解析 ==========

function parseTimeRangeList(s){
    // 支持： "20:00-24:00,08:00-12:00"（逗号/中文逗号/分号分隔）。兼容中文冒号、顿号、句号
    const out = [];
    var raw = String(s||'').trim();
    raw = raw.replace(/[：]/g, ':').replace(/[，、。]/g, ',');
    if(!raw) return out;
    raw.split(/[,，;；]+/).map(x=>x.trim()).filter(Boolean).forEach(part=>{
        const m = part.match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2}|24:00)$/);
        if(!m) return;
        const a = hhmmToMin(m[1]);
        let b = (m[2] === '24:00') ? MINS_PER_DAY : hhmmToMin(m[2]);
        if(a === null || b === null) return;
        out.push([a, b]);
    });
    return out;
}

function parseBreakList(s){
    // 支持两种格式： "12:00/30"（开始/分钟数）或 "12:00-12:30"（开始-结束）。兼容中文标点
    const out = [];
    var raw = String(s||'').trim();
    raw = raw.replace(/[：]/g, ':').replace(/[，、。]/g, ',');
    if(!raw) return out;
    raw.split(/[,，;；]+/).map(x=>x.trim()).filter(Boolean).forEach(part=>{
        // 格式1: start/duration（如 12:00/30）
        let m = part.match(/^(\d{1,2}:\d{2})\s*\/\s*(\d+)$/);
        if(m){
            const start = hhmmToMin(m[1]);
            const dur = Math.max(1, parseInt(m[2],10) || 0);
            if(start !== null){ out.push([start, Math.min(start+dur, MINS_PER_DAY)]); return; }
        }
        // 格式2: start-end（如 12:00-12:30 或 12:00/12:30）
        m = part.match(/^(\d{1,2}:\d{2})\s*[-\/]\s*(\d{1,2}:\d{2})$/);
        if(m){
            const start = hhmmToMin(m[1]);
            let end = hhmmToMin(m[2]);
            if(start !== null && end !== null){
                if(end <= start) end += MINS_PER_DAY; // 跨天
                out.push([start, Math.min(end, MAX_COORD)]);
            }
        }
    });
    return out;
}

// ========== 班次范围 ==========

function _shiftAbsifyRanges(shiftStart, ranges, allowCrossDay){
    // 把 [a,b] 转为"绝对分钟"范围：夜班跨天时，落在次日的段自动 +1440
    const out = [];
    ranges.forEach(([a,b])=>{
        let aa = a, bb = b;
        // 允许跨天：例如 20:00-08:00
        if(allowCrossDay && bb <= aa) bb = bb + MINS_PER_DAY;
        // 夜班跨天时：把凌晨段映射到 +MINS_PER_DAY（例如 08:00-12:00）
        if(allowCrossDay && aa < shiftStart) { aa += MINS_PER_DAY; bb += MINS_PER_DAY; }
        out.push([aa, bb]);
    });
    return out;
}

function getShiftRange(mode){
    // 返回 [startAbsMin, endAbsMin]（0-2880）
    // 白班/夜班均把"加班段"纳入范围；夜班跨天会延伸到次日
    if(mode === 'day'){
        const s = hhmmToMin(SHIFT.day_shift.start)||540;
        const e = hhmmToMin(SHIFT.day_shift.end)||1110;
        let end = e;
        const ot = SHIFT.day_shift.overtime;
        ot.forEach(([a,b])=>{ end = Math.max(end, (b<=a?MINS_PER_DAY:b)); });
        return [s, Math.max(s+1, end)];
    }
    if(mode === 'night'){
        const s = hhmmToMin(SHIFT.night_shift.start)||1260;
        const e = hhmmToMin(SHIFT.night_shift.end)||390;
        const crosses = e <= s;
        let end = crosses ? (MINS_PER_DAY + e) : e;
        const absOt = _shiftAbsifyRanges(s, SHIFT.night_shift.overtime, crosses);
        absOt.forEach(([a,b])=>{ end = Math.max(end, b); });
        const style = localStorage.getItem('nightViewStyle') || 'simple';
        if(style === 'simple'){
            const offset = parseInt(localStorage.getItem('nightOffset') || '0', 10);
            const base = offset * MINS_PER_DAY;
            return [base + s, Math.max(base + s + 1, base + end)];
        }
        return [s - MINS_PER_DAY, Math.max(s+1, end)];
    }
    if(mode === 'double'){
        // 双班：前一日夜班(覆盖当日凌晨) + 今日白班 + 今日夜班 + 今日夜班跨天
        const ns = hhmmToMin(SHIFT.night_shift.start)||1260;
        const ne = hhmmToMin(SHIFT.night_shift.end)||390;
        const crosses = ne <= ns;
        // 昨夜：从 -MINS_PER_DAY+ns 到 ne（落在当日凌晨段）
        let start = ns - MINS_PER_DAY;
        let end = crosses ? (MINS_PER_DAY + ne) : ne;

        // 今日白班 + 加班
        const ds = hhmmToMin(SHIFT.day_shift.start)||540;
        const de = hhmmToMin(SHIFT.day_shift.end)||1110;
        end = Math.max(end, de);
        SHIFT.day_shift.overtime.forEach(([a,b])=>{ end = Math.max(end, (b<=a?MINS_PER_DAY:b)); });

        // 今日夜班 + 加班（映射到 +1 段）
        end = Math.max(end, (crosses ? (MINS_PER_DAY+ne) : ne));
        const absOt = _shiftAbsifyRanges(ns, SHIFT.night_shift.overtime, crosses);
        absOt.forEach(([a,b])=>{ end = Math.max(end, b); });

        return [start, Math.max(start+1, end)];
    }
    return [0, MINS_PER_DAY];
}

// ========== 分班视图：单轨压缩坐标 ==========

function _getTrackConfig(trackType) {
    // 返回 { ws, we, dw } — 窗口起始分钟、结束分钟（含加班）、窗口宽度
    if (trackType === 'day') {
        const ws = hhmmToMin(SHIFT.day_shift.start) || 540;
        const we = hhmmToMin(SHIFT.day_shift.end) || 1110;
        let dwEnd = we;
        SHIFT.day_shift.overtime.forEach(([a, b]) => { dwEnd = Math.max(dwEnd, (b <= a ? MINS_PER_DAY : b)); });
        return { ws, we, dwEnd, dw: dwEnd - ws };
    } else {
        const ws = hhmmToMin(SHIFT.night_shift.start) || 1260;
        const we = hhmmToMin(SHIFT.night_shift.end) || 390;
        const crosses = we <= ws;
        let dwEnd = crosses ? (MINS_PER_DAY + we) : we;
        const absOt = _shiftAbsifyRanges(ws, SHIFT.night_shift.overtime, crosses);
        absOt.forEach(([a, b]) => { dwEnd = Math.max(dwEnd, b); });
        return { ws, we, dwEnd, dw: dwEnd - ws, crosses };
    }
}

function getShiftWindows(startAbs, endAbs, trackType) {
    // 返回 [startAbs, endAbs] 范围内所有同类班次窗口（含加班），每个 { absStart, absEnd, windowIndex }
    const cfg = _getTrackConfig(trackType);
    const windows = [];
    const firstDay = Math.floor((startAbs - cfg.dwEnd) / MINS_PER_DAY);
    const lastDay = Math.ceil((endAbs - cfg.ws) / MINS_PER_DAY);
    for (let d = firstDay; d <= lastDay; d++) {
        const wStart = d * MINS_PER_DAY + cfg.ws;
        const wEnd = d * MINS_PER_DAY + cfg.dwEnd;
        if (wEnd > startAbs && wStart < endAbs) {
            windows.push({ absStart: wStart, absEnd: wEnd, windowIndex: d });
        }
    }
    return windows;
}

function absToSplitMin(absMin, trackType) {
    // 绝对分钟 → 压缩轨分钟偏移。若 absMin 落在空隙，夹到最近窗口边界
    const cfg = _getTrackConfig(trackType);
    const d = Math.floor((Math.round(absMin) - cfg.ws) / MINS_PER_DAY);
    const wStart = d * MINS_PER_DAY + cfg.ws;
    const wEnd = d * MINS_PER_DAY + cfg.dwEnd;
    if (absMin >= wStart && absMin < wEnd) {
        return d * cfg.dw + (absMin - wStart);
    }
    return absMin < wStart ? d * cfg.dw : d * cfg.dw + cfg.dw;
}

function splitMinToAbs(splitMin, trackType) {
    // 压缩轨分钟 → 绝对分钟。逆映射
    const cfg = _getTrackConfig(trackType);
    const d = Math.floor(Math.round(splitMin) / cfg.dw);
    const offset = Math.round(splitMin) - d * cfg.dw;
    return d * MINS_PER_DAY + cfg.ws + Math.max(0, Math.min(cfg.dw, offset));
}

// ========== 窗口边界穿越检测 ==========

function _absToWindowIndex(absMin, trackType) {
    // 返回绝对分钟落在哪个窗口（windowIndex），用于判断拉伸是否跨越了窗口边界
    var cfg = _getTrackConfig(trackType);
    return Math.floor((Math.round(absMin) - cfg.ws) / MINS_PER_DAY);
}

function getWindowsCrossed(absOld, absNew, trackType) {
    // 返回从 absOld 到 absNew 穿越的窗口边界列表
    // 每个边界 {boundaryAbs, direction: 'forward'|'backward'}
    // forward: absNew > absOld（向右拉伸），backward: absNew < absOld（向左拉伸）
    var oldWin = _absToWindowIndex(absOld, trackType);
    var newWin = _absToWindowIndex(absNew, trackType);
    var cfg = _getTrackConfig(trackType);
    var crossed = [];
    if (newWin > oldWin) {
        // 向右穿越：经过 oldWin+1, oldWin+2, ..., newWin 的起始边界
        for (var w = oldWin + 1; w <= newWin; w++) {
            crossed.push({boundaryAbs: w * MINS_PER_DAY + cfg.ws, direction: 'forward'});
        }
    } else if (newWin < oldWin) {
        // 向左穿越：经过 oldWin, oldWin-1, ..., newWin+1 的起始边界
        for (var w = oldWin; w > newWin; w--) {
            crossed.push({boundaryAbs: w * MINS_PER_DAY + cfg.ws, direction: 'backward'});
        }
    }
    return crossed;
}

function getViewRange(){
    const mode = document.getElementById('view-mode').value;
    if(mode === 'custom'){
        const sdEl = document.getElementById('custom-start-date');
        const stEl = document.getElementById('custom-start-time');
        const edEl = document.getElementById('custom-end-date');
        const etEl = document.getElementById('custom-end-time');
        if(!sdEl || !edEl) return [0, MINS_PER_DAY];
        const base = document.getElementById('schedule-date').value;
        const sd = sdEl.value;
        const st = stEl ? stEl.value : '08:00';
        const ed = edEl.value;
        const et = etEl ? etEl.value : '20:00';
        const sm = hhmmToMin(st);
        const em = hhmmToMin(et);
        if(sm === null || em === null || !sd || !ed) return [0, MINS_PER_DAY];
        // 计算相对 SELECTED_DATE 的偏移天数
        const dayOffStart = Math.round((new Date(sd).getTime() - new Date(base).getTime()) / (MINS_PER_DAY * 60 * 1000));
        const dayOffEnd = Math.round((new Date(ed).getTime() - new Date(base).getTime()) / (MINS_PER_DAY * 60 * 1000));
        const absStart = dayOffStart * MINS_PER_DAY + sm;
        const absEnd = dayOffEnd * MINS_PER_DAY + em;
        return [Math.min(absStart, absEnd), Math.max(absStart, absEnd)];
    }
    return getShiftRange(mode);
}

// ========== 时间格式化 ==========

function _formatAbsMin(m){
    let mm = Math.round(m) || 0;
    let dayOff = 0;
    if(mm < 0){
        dayOff = -Math.floor((Math.abs(mm)-1)/(MINS_PER_DAY)+1);
        mm = mm - dayOff * MINS_PER_DAY;
    }else if(mm >= MINS_PER_DAY){
        dayOff = Math.floor(mm/(MINS_PER_DAY));
        mm = mm % (MINS_PER_DAY);
    }
    const hh = String(Math.floor(mm/MINS_PER_HOUR)).padStart(2,'0');
    const mi = String(mm%MINS_PER_HOUR).padStart(2,'0');
    const base = hh+':'+mi;
    if(dayOff===0) return base;
    const sign = dayOff>0?'+':'';
    return base+'('+sign+dayOff+')';
}

function _formatAbsDateTime(amin){
    let mm = Math.round(amin) || 0;
    let dayOff = 0;
    if(mm < 0){
        dayOff = -Math.floor((Math.abs(mm)-1)/(MINS_PER_DAY)+1);
        mm = mm - dayOff * MINS_PER_DAY;
    }else if(mm >= MINS_PER_DAY){
        dayOff = Math.floor(mm/(MINS_PER_DAY));
        mm = mm % (MINS_PER_DAY);
    }
    const hh = String(Math.floor(mm/MINS_PER_HOUR)).padStart(2,'0');
    const mi = String(mm%MINS_PER_HOUR).padStart(2,'0');
    const base = document.getElementById('schedule-date').value;
    const d = new Date(base + 'T00:00:00');
    d.setDate(d.getDate() + dayOff);
    const mon = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    return mon+'-'+day+' '+hh+':'+mi;
}

function _formatAbsRange(absStart, absEnd){
    const sDay = dayOffset(Math.round(absStart)||0);
    const eDay = dayOffset(Math.round(absEnd)||0);
    if(sDay === eDay){
        const s = _formatAbsMin(absStart);
        const e = _formatAbsMin(absEnd);
        return s+'~'+e;
    }
    return _formatAbsDateTime(absStart)+'~'+_formatAbsDateTime(absEnd);
}

function _formatAbsTimeStr(amin) {
    var mm = Math.round(amin) || 0;
    mm = ((mm % MINS_PER_DAY) + MINS_PER_DAY) % MINS_PER_DAY;
    var hh = String(Math.floor(mm / MINS_PER_HOUR)).padStart(2, '0');
    var mi = String(mm % MINS_PER_HOUR).padStart(2, '0');
    return hh + ':' + mi;
}

function _formatAbsRangeCustom(absStart, absEnd) {
    var sDay = dayOffset(Math.round(absStart) || 0);
    var eDay = dayOffset(Math.round(absEnd) || 0);
    if (sDay === eDay) {
        return _formatAbsDateTime(absStart) + '-' + _formatAbsTimeStr(absEnd);
    }
    return _formatAbsDateTime(absStart) + '-' + _formatAbsDateTime(absEnd);
}

function _dateMinToAbs(dateStr, min){
    const base = document.getElementById('schedule-date').value;
    if(!dateStr || dateStr === base) return min|0;
    const d = new Date(dateStr + 'T00:00:00');
    const b = new Date(base + 'T00:00:00');
    const dayOff = Math.round((d - b) / 86400000);
    return (dayOff * MINS_PER_DAY + (min|0));
}

function _getViewStartMin(){
    const v = getComputedStyle(document.documentElement).getPropertyValue('--viewStartMin').trim();
    const n = parseInt(v || '0', 10);
    return Number.isFinite(n) ? n : 0;
}

function _parseTimeStr(s){
    if(!s) return null;
    let str = s.trim();
    let dayOff = 0;
    const offMatch = str.match(/\(([+-]?\d+)\)$/);
    if(offMatch){
        dayOff = parseInt(offMatch[1],10)||0;
        str = str.replace(/\([+-]?\d+\)$/, '').trim();
    }
    const m = str.match(/^(\d{1,2}):(\d{2})$/);
    if(!m) return null;
    return {min: Math.max(0, Math.min(MINS_PER_DAY - 1, parseInt(m[1],10)*MINS_PER_HOUR + parseInt(m[2],10))), dayOff};
}

// ========== 网格渲染 ==========

function _hourLabelsForRange(vs, ve, showDayOffset){
    if (showDayOffset === undefined) showDayOffset = true;
    let start = clampViewSpan(vs);
    let end = clampViewSpan(ve);
    if(end <= start) end = MINS_PER_DAY;
    const labels = [];
    const startHour = Math.floor(start / MINS_PER_HOUR);
    const endHour = Math.ceil(end / MINS_PER_HOUR);
    for(let h = startHour; h < endHour; h++){
        const hh = String((h % 24 + 24) % 24).padStart(2,'0');
        const dayOff = Math.floor(h / 24);
        if (!showDayOffset) {
            labels.push(hh + ':00');
        } else {
            labels.push(dayOff === 0 ? hh + ':00' : hh + ':00(' + (dayOff > 0 ? '+' : '') + dayOff + ')');
        }
    }
    return {labels, startMin: start, endMin: end};
}

function _renderSeg(el, a, b, cls, vsOverride){
    const vs = (vsOverride != null) ? vsOverride : _getViewStartMin();
    const leftPx = minToPx(a - vs);
    const widthPx = minToPx(b - a);
    const seg = document.createElement('div');
    seg.className = `seg ${cls}`;
    seg.style.left = `${leftPx}px`;
    seg.style.width = `${Math.max(0, widthPx)}px`;
    el.appendChild(seg);
}
