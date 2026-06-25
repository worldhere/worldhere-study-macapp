// ========== 颜色管理 ==========

function hexToRgba(hex, alpha) {
    if (hex.charAt(0) === '#') hex = hex.slice(1);
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    var r = parseInt(hex.substring(0, 2), 16);
    var g = parseInt(hex.substring(2, 4), 16);
    var b = parseInt(hex.substring(4, 6), 16);
    return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + alpha + ')';
}

function darkenHex(hex, factor) {
    if (hex.charAt(0) === '#') hex = hex.slice(1);
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    var r = Math.floor(parseInt(hex.substring(0, 2), 16) * factor);
    var g = Math.floor(parseInt(hex.substring(2, 4), 16) * factor);
    var b = Math.floor(parseInt(hex.substring(4, 6), 16) * factor);
    return '#' + r.toString(16).padStart(2, '0') + g.toString(16).padStart(2, '0') + b.toString(16).padStart(2, '0');
}

function _readColorGroup(groupKey) {
    try {
        var raw = localStorage.getItem('_schedule_color_' + groupKey);
        if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null;
}

function _saveColorGroup(groupKey, obj) {
    try {
        localStorage.setItem('_schedule_color_' + groupKey, JSON.stringify(obj));
    } catch (e) {}
}

function _getTypeIndex(typeName) {
    if (TYPE_INDEX_MAP && TYPE_INDEX_MAP[typeName] !== undefined) return TYPE_INDEX_MAP[typeName];
    return -1;
}

function _sanitizeId(name) {
    return (name || '').replace(/[^a-zA-Z0-9一-龥_-]/g, '_');
}

var _segColorKeys = ['seg_work', 'seg_ot', 'seg_break', 'seg_gap'];
var _stateColorKeys = ['completed', 'split', 'repair_bg', 'repair_border', 'paused', 'post_pause'];

function applyColorSetting(colorKey, hexValue) {
    var root = document.documentElement;

    // Determine group and CSS variable name
    var group, cssVar;
    if (_segColorKeys.indexOf(colorKey) !== -1) {
        group = 'overlay';
        cssVar = _segCssVars[colorKey];
        // Apply alpha for segment overlay colors
        var alpha = _segAlphas[colorKey] || 0.22;
        var rgbaValue = hexToRgba(hexValue, alpha);
        root.style.setProperty(cssVar, rgbaValue);
    } else if (_stateColorKeys.indexOf(colorKey) !== -1) {
        group = 'states';
        cssVar = _stateCssVars[colorKey];
        root.style.setProperty(cssVar, hexValue);
    } else {
        // Fallback for unknown keys (treat as overlay)
        group = 'overlay';
        cssVar = '--color-' + colorKey.replace(/_/g, '-');
        root.style.setProperty(cssVar, hexValue);
    }

    // Update hex display span
    var hexSpan = document.getElementById('cs-' + colorKey.replace(/_/g, '-') + '-hex');
    if (hexSpan) hexSpan.textContent = hexValue;

    // Save to correct localStorage group
    var savedGroup = _readColorGroup(group) || {};
    savedGroup[colorKey] = hexValue;
    _saveColorGroup(group, savedGroup);
}

function applyTypeColor(typeName, hexValue) {
    var idx = _getTypeIndex(typeName);
    var prop = '--type-color-' + idx;
    document.documentElement.style.setProperty(prop, hexValue);
    var safeId = _sanitizeId(typeName);
    var hexSpan = document.getElementById('cs-type-' + safeId + '-hex');
    if (hexSpan) hexSpan.textContent = hexValue;
    var group = _readColorGroup('types') || {};
    group[typeName] = hexValue;
    _saveColorGroup('types', group);
}

function _applyStoredColors() {
    var overlayGroup = _readColorGroup('overlay');
    var stateGroup = _readColorGroup('states');
    var typeGroup = _readColorGroup('types');

    var overlayColors = {};
    var stateColors = {};
    var typeColors = {};

    var defaults = (typeof _colorDefaults !== 'undefined') ? _colorDefaults : {};
    for (var i = 0; i < _segColorKeys.length; i++) {
        var key = _segColorKeys[i];
        var color = (overlayGroup && overlayGroup[key]) ? overlayGroup[key] : (defaults[key] || '#3b82f6');
        applyColorSetting(key, color);
        overlayColors[key] = color;
    }
    for (var j = 0; j < _stateColorKeys.length; j++) {
        var sk = _stateColorKeys[j];
        var sc = (stateGroup && stateGroup[sk]) ? stateGroup[sk] : (defaults[sk] || '#3b82f6');
        applyColorSetting(sk, sc);
        stateColors[sk] = sc;
    }
    // Always process all machine types: use stored colors where available, palette defaults otherwise
    var mts = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.machine_types) ? APP_CONFIG.machine_types : [];
    var palette = (typeof _typeColorPalette !== 'undefined') ? _typeColorPalette : ['#3b82f6','#10b981','#f59e0b','#8b5cf6','#ef4444','#06b6d4','#f97316','#84cc16'];
    for (var mi = 0; mi < mts.length; mi++) {
        var mtKey = mts[mi].key;
        var storedColor = typeGroup ? typeGroup[mtKey] : null;
        var color = storedColor || palette[mi % palette.length] || '#3b82f6';
        applyTypeColor(mtKey, color);
        typeColors[mtKey] = color;
    }

    _populateColorInputs(overlayColors, stateColors, typeColors);
}

function _populateColorInputs(overlayColors, stateColors, typeColors) {
    var segMap = {seg_work:'seg-work', seg_ot:'seg-ot', seg_break:'seg-break', seg_gap:'seg-gap'};
    for (var k in segMap) {
        var id = segMap[k];
        var input = document.getElementById('cs-' + id);
        if (input) {
            var hexSpan = document.getElementById('cs-' + id + '-hex');
            var c = overlayColors[k] || (input.value || '');
            input.value = c;
            if (hexSpan) hexSpan.textContent = c;
        }
    }
    var stateKeys = ['completed','split','repair_bg','repair_border','paused','post_pause'];
    for (var i = 0; i < stateKeys.length; i++) {
        var sid = 'cs-state-' + stateKeys[i].replace(/_/g, '-');
        var sinput = document.getElementById(sid);
        if (sinput) {
            var sHexSpan = document.getElementById(sid + '-hex');
            var sc = stateColors[stateKeys[i]] || (sinput.value || '');
            sinput.value = sc;
            if (sHexSpan) sHexSpan.textContent = sc;
        }
    }
    _renderTypeColorInputs(typeColors);
}

function _renderTypeColorInputs(typeColors) {
    var container = document.getElementById('cs-type-colors-container');
    if (!container) return;
    var mts = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.machine_types) ? APP_CONFIG.machine_types : [];
    var html = '';
    for (var i = 0; i < mts.length; i++) {
        var typeName = mts[i].key;
        var palette = (typeof _typeColorPalette !== 'undefined') ? _typeColorPalette : ['#3b82f6'];
        var color = (typeColors && typeColors[typeName]) ? typeColors[typeName] : (palette[i % palette.length] || '#3b82f6');
        var safeId = _sanitizeId(typeName);
        html += '<label style="display:flex;align-items:center;gap:6px;">' +
            escHtml(typeName) + '：' +
            '<input type="color" id="cs-type-' + safeId + '" value="' + color + '" onchange="applyTypeColor(\'' + escHtml(typeName) + '\', this.value)">' +
            '<span class="color-hex-label" id="cs-type-' + safeId + '-hex">' + color + '</span>' +
            '<button class="btn-sm" onclick="resetColorSetting(\'' + escHtml(typeName) + '\');return false;" title="恢复默认值">↺</button>' +
            '</label>';
    }
    container.innerHTML = html;
}

function resetColorSetting(colorKey) {
    var defaults = (typeof _colorDefaults !== 'undefined') ? _colorDefaults : {};
    var palette = (typeof _typeColorPalette !== 'undefined') ? _typeColorPalette : ['#3b82f6','#10b981','#f59e0b','#8b5cf6','#ef4444','#06b6d4','#f97316','#84cc16'];

    if (_segColorKeys.indexOf(colorKey) !== -1) {
        var defColor = defaults[colorKey] || '#3b82f6';
        applyColorSetting(colorKey, defColor);
        var segMap = {seg_work:'seg-work', seg_ot:'seg-ot', seg_break:'seg-break', seg_gap:'seg-gap'};
        var input = document.getElementById('cs-' + segMap[colorKey]);
        if (input) input.value = defColor;
    } else if (_stateColorKeys.indexOf(colorKey) !== -1) {
        var defState = defaults[colorKey] || '#3b82f6';
        applyColorSetting(colorKey, defState);
        var stateId = 'cs-state-' + colorKey.replace(/_/g, '-');
        var sInput = document.getElementById(stateId);
        if (sInput) sInput.value = defState;
    } else {
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
