# 自然生态种群动画 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有粒子背景和彩带动画之外，新增自然生态种群动画效果（三三角组成、黄绿随机色、飞行/休息/惊飞三态、点击交互、系统设置开关、暗色模式下自动切换为萤火虫）

**Architecture:** 双 Canvas 分层渲染——`butterfly-fly-canvas`(z=2,面板下方)绘制飞行蝴蝶/萤火虫，`butterfly-rest-canvas`(z=10,面板上方)绘制休息蝴蝶/萤火虫；所有逻辑集中在 `static/butterflies.js`，采用与 particles.js/ribbons.js 相同的 start/stop 全局函数模式；每帧检测 `data-theme` 属性自动切换蝴蝶/萤火虫渲染

**Tech Stack:** 纯 JS + Canvas 2D，不引入新依赖

---

### 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `static/butterflies.js` | **Create** | 自然生态种群动画全部逻辑：种群管理、飞行/休息/惊飞渲染（含萤火虫暗色模式）、点击交互、rest spot 管理 |
| `templates/index.html` | Modify | 新增两个 canvas 元素 + script 引入 |
| `templates/panels/settings.html` | Modify | 系统设置子页面新增自然生态种群动画开关 checkbox |
| `static/settings.js` | Modify | `applyUISetting()` 和 `applyStoredUISettings()` 新增 butterfly_animation 处理 |
| `static/app.js` | Modify | `window.onload` 中读取设置并启动自然生态种群动画 |

---

### Task 1: 创建 butterflies.js 核心文件

**Files:**
- Create: `static/butterflies.js`

- [ ] **Step 1: 创建文件骨架，包含 start/stop 全局函数和全局状态变量**

```javascript
// golden scheduling app — butterfly animation (dual canvas)
var _butterfliesRunning = false;
var _butterfliesAnimId = null;
var _butterflies = [];
var _butterflyRestSpots = [];
var _butterflyPhase = 'idle';       // 'idle' | 'grow' | 'flee'
var _butterflyTargetCount = 4;
var _butterflyCurrentCount = 0;
var _butterflyT0 = 0;
var _bfFlyCtx = null;
var _bfRestCtx = null;
var _bfW = 0, _bfH = 0;

function startButterflies() {
    var flyCanvas = document.getElementById('butterfly-fly-canvas');
    var restCanvas = document.getElementById('butterfly-rest-canvas');
    if (!flyCanvas || !restCanvas) return;
    flyCanvas.style.display = 'block';
    restCanvas.style.display = 'block';
    _bfFlyCtx = flyCanvas.getContext('2d');
    _bfRestCtx = restCanvas.getContext('2d');
    _butterfliesRunning = true;

    function resize() {
        _bfW = flyCanvas.width = restCanvas.width = window.innerWidth;
        _bfH = flyCanvas.height = restCanvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    _butterflyPhase = 'idle';
    _butterflyTargetCount = 3 + Math.floor(Math.random() * 3);
    _butterflyCurrentCount = 0;
    _butterflies = [];
    _butterflyT0 = Date.now();
    spawnInitial(3);
    _butterflyAnimId = requestAnimationFrame(updateAndDraw);
}

function stopButterflies() {
    _butterfliesRunning = false;
    if (_butterflyAnimId) {
        cancelAnimationFrame(_butterflyAnimId);
        _butterflyAnimId = null;
    }
    var flyCanvas = document.getElementById('butterfly-fly-canvas');
    var restCanvas = document.getElementById('butterfly-rest-canvas');
    if (flyCanvas) {
        flyCanvas.style.display = 'none';
        flyCanvas.getContext('2d').clearRect(0, 0, flyCanvas.width, flyCanvas.height);
    }
    if (restCanvas) {
        restCanvas.style.display = 'none';
        restCanvas.getContext('2d').clearRect(0, 0, restCanvas.width, restCanvas.height);
    }
    _butterflies = [];
}
```

- [ ] **Step 2: 添加 spawnAtEdge、spawnInitial 和 collectRestSpots 辅助函数**

```javascript
function spawnAtEdge() {
    var edge = Math.floor(Math.random() * 4), x, y, vx, vy;
    if (edge === 0) { x = Math.random() * _bfW; y = -30; vx = (Math.random() - 0.5) * 0.3; vy = 0.2; }
    else if (edge === 1) { x = _bfW + 30; y = Math.random() * _bfH; vx = -0.2; vy = (Math.random() - 0.5) * 0.15; }
    else if (edge === 2) { x = Math.random() * _bfW; y = _bfH + 30; vx = (Math.random() - 0.5) * 0.3; vy = -0.2; }
    else { x = -30; y = Math.random() * _bfH; vx = 0.2; vy = (Math.random() - 0.5) * 0.15; }
    return {
        x: x, y: y, vx: vx, vy: vy, heading: Math.atan2(vy, vx),
        hue: 65 + Math.random() * 30, scale: 0.7 + Math.random() * 0.4,
        phase: Math.random() * 10,
        targetX: Math.random() * _bfW, targetY: Math.random() * _bfH,
        state: 'enter', restSpot: null, restTimer: 0, restDuration: 0,
        fleeDir: null, fleeSpeed: 0, fadeProgress: 0, alpha: 0,
        floatAlpha: 0
    };
}

function spawnInitial(c) {
    for (var i = 0; i < c; i++) setTimeout(function () {
        if (_butterflyCurrentCount < _butterflyTargetCount || _butterflyPhase === 'grow') {
            _butterflies.push(spawnAtEdge());
            _butterflyCurrentCount++;
        }
    }, i * 500 + Math.random() * 300);
}

function collectRestSpots() {
    _butterflyRestSpots = [];
    var cards = document.querySelectorAll('.rest-card');
    if (cards.length === 0) return;
    for (var c = 0; c < cards.length; c++) {
        var r = cards[c].getBoundingClientRect();
        var cx = r.left, cy = r.top, cw = r.width, ch = r.height;
        // Top edge: 4 spots
        for (var i = 0; i < 4; i++) {
            _butterflyRestSpots.push({
                x: cx + 10 + (cw - 20) * (i + 0.5) / 4,
                y: cy,
                edge: 'top',
                occupied: false
            });
        }
        // Left edge: 2 spots
        for (var i = 0; i < 2; i++) {
            _butterflyRestSpots.push({
                x: cx,
                y: cy + 10 + (ch - 20) * (i + 0.5) / 2,
                edge: 'left',
                occupied: false
            });
        }
        // Right edge: 2 spots
        for (var i = 0; i < 2; i++) {
            _butterflyRestSpots.push({
                x: cx + cw,
                y: cy + 10 + (ch - 20) * (i + 0.5) / 2,
                edge: 'right',
                occupied: false
            });
        }
    }
}

function occupySpot() {
    var free = [];
    for (var i = 0; i < _butterflyRestSpots.length; i++) {
        if (!_butterflyRestSpots[i].occupied) free.push(i);
    }
    if (free.length === 0) return null;
    var idx = free[Math.floor(Math.random() * free.length)];
    _butterflyRestSpots[idx].occupied = true;
    return _butterflyRestSpots[idx];
}

function releaseSpot(spot) {
    if (spot) spot.occupied = false;
}
```

- [ ] **Step 3: 添加绘制函数——飞行俯视三角、休息侧视合并翅、惊飞双翅、萤火虫光点**

```javascript
// Flying: top-down view, 3 triangles
function drawFlyWings(ctx, ws, a, hue) {
    var wc = 'hsla(' + hue + ',65%,48%,' + a + ')',
        wl = 'hsla(' + hue + ',75%,58%,' + a + ')';
    ctx.fillStyle = wc;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-32 * ws, -20); ctx.lineTo(-30 * ws, 12); ctx.closePath(); ctx.fill();
    ctx.fillStyle = wl;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-22 * ws, -14); ctx.lineTo(-18 * ws, 8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = wc;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(32 * ws, -20); ctx.lineTo(30 * ws, 12); ctx.closePath(); ctx.fill();
    ctx.fillStyle = wl;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(22 * ws, -14); ctx.lineTo(18 * ws, 8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = wc;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-16 * ws, 26); ctx.lineTo(16 * ws, 26); ctx.closePath(); ctx.fill();
    ctx.fillStyle = wl;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-8 * ws, 20); ctx.lineTo(8 * ws, 20); ctx.closePath(); ctx.fill();
}

// Resting: side view, merged wing, no body, geometric triangles
function drawRestWings(ctx, hue, edge, flutter, alpha) {
    var a = alpha || 0.85;
    var wc = 'hsla(' + hue + ',65%,48%,' + a + ')',
        wl = 'hsla(' + hue + ',75%,58%,' + a + ')',
        wc2 = 'hsla(' + hue + ',52%,40%,' + a + ')';
    var f = flutter || 0;

    if (edge === 'top') {
        ctx.fillStyle = wc2;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-16 * (1 + f), -22); ctx.lineTo(0, -28); ctx.lineTo(16 * (1 + f), -22); ctx.closePath(); ctx.fill();
        ctx.fillStyle = wc;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-13 * (1 + f), -20); ctx.lineTo(0, -26); ctx.lineTo(13 * (1 + f), -20); ctx.closePath(); ctx.fill();
        ctx.fillStyle = wl;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-8 * (1 + f), -15); ctx.lineTo(0, -22); ctx.lineTo(8 * (1 + f), -15); ctx.closePath(); ctx.fill();
    } else if (edge === 'left') {
        ctx.fillStyle = wc2;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-22, -16 * (1 + f)); ctx.lineTo(-28, 0); ctx.lineTo(-22, 16 * (1 + f)); ctx.closePath(); ctx.fill();
        ctx.fillStyle = wc;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-20, -13 * (1 + f)); ctx.lineTo(-26, 0); ctx.lineTo(-20, 13 * (1 + f)); ctx.closePath(); ctx.fill();
        ctx.fillStyle = wl;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-15, -8 * (1 + f)); ctx.lineTo(-22, 0); ctx.lineTo(-15, 8 * (1 + f)); ctx.closePath(); ctx.fill();
    } else {
        ctx.fillStyle = wc2;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(22, -16 * (1 + f)); ctx.lineTo(28, 0); ctx.lineTo(22, 16 * (1 + f)); ctx.closePath(); ctx.fill();
        ctx.fillStyle = wc;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(20, -13 * (1 + f)); ctx.lineTo(26, 0); ctx.lineTo(20, 13 * (1 + f)); ctx.closePath(); ctx.fill();
        ctx.fillStyle = wl;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(15, -8 * (1 + f)); ctx.lineTo(22, 0); ctx.lineTo(15, 8 * (1 + f)); ctx.closePath(); ctx.fill();
    }
}
```

**萤火虫绘制函数（暗色模式自动切换）：**

```javascript
// Firefly: dual orb glow (Style C), no body, pure light
function drawFireflyFly(ctx, b, t) {
    var hue = b.hue, sat = '80%';
    var bright = 0.5 + Math.sin(t * 1.8 + b.phase) * 0.28;
    var swayX = Math.sin(t * 0.7 + b.phase) * 3, swayY = Math.cos(t * 0.55 + b.phase) * 2.5;
    ctx.save();
    ctx.translate(b.x + swayX, b.y + swayY);

    // Small tail glow (slightly behind relative to heading)
    ctx.save();
    ctx.rotate(b.heading);
    ctx.translate(0, 4);
    var gTail = ctx.createRadialGradient(0, 0, 0, 0, 0, 6);
    gTail.addColorStop(0, 'hsla(' + hue + ',' + sat + ',65%,' + (bright * 0.55) + ')');
    gTail.addColorStop(1, 'hsla(' + hue + ',' + sat + ',30%,0)');
    ctx.fillStyle = gTail;
    ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // Main glow
    var g1 = ctx.createRadialGradient(0, 0, 1, 0, 0, 14 * b.scale);
    g1.addColorStop(0, 'hsla(' + hue + ',' + sat + ',80%,' + bright + ')');
    g1.addColorStop(0.3, 'hsla(' + hue + ',' + sat + ',60%,' + (bright * 0.55) + ')');
    g1.addColorStop(0.7, 'hsla(' + hue + ',' + sat + ',35%,' + (bright * 0.12) + ')');
    g1.addColorStop(1, 'hsla(' + hue + ',' + sat + ',25%,0)');
    ctx.fillStyle = g1;
    ctx.beginPath(); ctx.arc(0, 0, 14 * b.scale, 0, Math.PI * 2); ctx.fill();

    // Bright core
    var g2 = ctx.createRadialGradient(0, 0, 0, 0, 0, 3);
    g2.addColorStop(0, 'hsla(70,20%,95%,' + bright + ')');
    g2.addColorStop(0.3, 'hsla(' + hue + ',' + sat + ',85%,' + bright + ')');
    g2.addColorStop(1, 'hsla(' + hue + ',' + sat + ',50%,' + (bright * 0.2) + ')');
    ctx.fillStyle = g2;
    ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill();

    ctx.restore();
}

// Firefly resting: small glowing dot on card edge
function drawFireflyRest(ctx, b, t) {
    var hue = b.hue, sat = '80%';
    var bright = 0.4 + Math.sin(t * 2.0 + b.phase) * 0.3;
    var g1 = ctx.createRadialGradient(0, 0, 0, 0, 0, 8);
    g1.addColorStop(0, 'hsla(' + hue + ',' + sat + ',75%,' + bright + ')');
    g1.addColorStop(0.5, 'hsla(' + hue + ',' + sat + ',50%,' + (bright * 0.4) + ')');
    g1.addColorStop(1, 'hsla(' + hue + ',' + sat + ',25%,0)');
    ctx.fillStyle = g1;
    ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill();

    // Tiny core
    var g2 = ctx.createRadialGradient(0, 0, 0, 0, 0, 2);
    g2.addColorStop(0, 'hsla(70,15%,95%,' + bright + ')');
    g2.addColorStop(1, 'hsla(' + hue + ',' + sat + ',60%,' + (bright * 0.3) + ')');
    ctx.fillStyle = g2;
    ctx.beginPath(); ctx.arc(0, 0, 2, 0, Math.PI * 2); ctx.fill();
}

// Firefly fleeing: accelerated glow with red halo
function drawFireflyFlee(ctx, b, t) {
    var hue = b.hue, sat = '80%';
    var bright = Math.max(0.1, 0.7 - b.fleeSpeed * 0.3);
    var g1 = ctx.createRadialGradient(0, 0, 1, 0, 0, 18);
    g1.addColorStop(0, 'hsla(' + hue + ',' + sat + ',85%,' + bright + ')');
    g1.addColorStop(0.3, 'hsla(0,60%,55%,' + (bright * 0.3) + ')');
    g1.addColorStop(0.6, 'hsla(' + hue + ',' + sat + ',40%,' + (bright * 0.1) + ')');
    g1.addColorStop(1, 'hsla(' + hue + ',' + sat + ',25%,0)');
    ctx.fillStyle = g1;
    ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.fill();

    var g2 = ctx.createRadialGradient(0, 0, 0, 0, 0, 3);
    g2.addColorStop(0, 'hsla(70,20%,95%,' + bright + ')');
    g2.addColorStop(1, 'hsla(' + hue + ',' + sat + ',70%,' + (bright * 0.3) + ')');
    ctx.fillStyle = g2;
    ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill();
}

// Theme detection helper
function isDarkMode() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
}
```

- [ ] **Step 4: 添加主循环 updateAndDraw —— 状态更新、种群控制、飞行渲染、休息渲染**

主循环在绘制时用 `isDarkMode()` 判断分支：

```javascript
// In the draw loops, replace drawSwayOnFly / drawFleeOnFly with:

if (b.state === 'flee') {
    if (isDarkMode()) {
        _bfFlyCtx.save();
        _bfFlyCtx.shadowColor = 'rgba(255,100,80,0.3)';
        _bfFlyCtx.shadowBlur = 10;
        _bfFlyCtx.translate(b.x, b.y);
        drawFireflyFlee(_bfFlyCtx, b, t);
        _bfFlyCtx.restore();
    } else {
        drawFleeOnFly(b, t); // butterfly flee
    }
} else if (b.state === 'fade') {
    _bfFlyCtx.save();
    _bfFlyCtx.globalAlpha = b.alpha;
    if (isDarkMode()) {
        drawFireflyFly(_bfFlyCtx, b, t);
    } else {
        drawSwayOnFly(b, t);
    }
    _bfFlyCtx.restore();
} else {
    if (isDarkMode()) {
        drawFireflyFly(_bfFlyCtx, b, t);
    } else {
        drawSwayOnFly(b, t);
    }
}
```

休息态同样分支：

```javascript
// In the rest draw loop:
if (isDarkMode()) {
    _bfRestCtx.save();
    _bfRestCtx.shadowColor = 'rgba(180,220,100,' + (0.3 * b.floatAlpha) + ')';
    _bfRestCtx.shadowBlur = 8 * b.floatAlpha;
    _bfRestCtx.globalAlpha = b.floatAlpha;
    _bfRestCtx.translate(b.restSpot.x, b.restSpot.y);
    var pulseF = 0.92 + Math.sin(t * 1.8 + b.phase) * 0.06;
    _bfRestCtx.scale(pulseF, pulseF);
    drawFireflyRest(_bfRestCtx, b, t);
    _bfRestCtx.restore();
} else {
    // original butterfly rest code ...
}
```

```javascript
function updateAndDraw() {
    if (!_butterfliesRunning) return;
    _bfFlyCtx.clearRect(0, 0, _bfW, _bfH);
    _bfRestCtx.clearRect(0, 0, _bfW, _bfH);
    collectRestSpots();
    var t = (Date.now() - _butterflyT0) * 0.001;

    // Population growth
    if (_butterflyPhase === 'grow' && _butterflyTargetCount < 15 && _butterflyCurrentCount >= _butterflyTargetCount && Math.random() < 0.008) {
        _butterflyTargetCount = Math.min(15, _butterflyTargetCount + 1);
    }
    if (_butterflyCurrentCount < _butterflyTargetCount && _butterflyPhase !== 'flee' && Math.random() < 0.05) {
        _butterflies.push(spawnAtEdge());
        _butterflyCurrentCount++;
    }
    // Flee phase auto-reduce
    if (_butterflyPhase === 'flee' && _butterflyCurrentCount > Math.max(0, _butterflyTargetCount) && Math.random() < 0.12) {
        for (var i = 0; i < _butterflies.length; i++) {
            var bb = _butterflies[i];
            if (bb.state === 'fly' || bb.state === 'rest') {
                if (bb.state === 'rest') { releaseSpot(bb.restSpot); bb.restSpot = null; }
                if (Math.random() < 0.5) {
                    bb.state = 'flee'; bb.fleeDir = { x: (Math.random() - 0.5) * 2.5, y: -(0.5 + Math.random() * 2) }; bb.fleeSpeed = 0.25 + Math.random() * 0.3;
                } else { bb.state = 'fade'; bb.fadeProgress = 0; }
                break;
            }
        }
    }

    // State updates
    for (var i = _butterflies.length - 1; i >= 0; i--) {
        var b = _butterflies[i];

        if (b.state === 'enter') {
            b.alpha = Math.min(0.82, b.alpha + 0.012);
            b.vx += ((_bfW / 2 - b.x) / _bfW) * 0.3; b.vy += ((_bfH / 2 - b.y) / _bfH) * 0.25;
            var espd = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
            if (espd > 0.35) { b.vx = (b.vx / espd) * 0.35; b.vy = (b.vy / espd) * 0.35; }
            b.x += b.vx; b.y += b.vy;
            var eh = Math.atan2(b.vy, b.vx); b.heading += (eh - b.heading) * 0.08;
            if (b.x > 20 && b.x < _bfW - 20 && b.y > 20 && b.y < _bfH - 20 && b.alpha > 0.7) {
                b.state = 'fly'; b.targetX = Math.random() * _bfW; b.targetY = Math.random() * _bfH;
            }
            continue;
        }

        if (b.state === 'flee') {
            b.fleeSpeed += 0.002; b.x += b.fleeDir.x * b.fleeSpeed; b.y += b.fleeDir.y * b.fleeSpeed;
            var fh = Math.atan2(b.fleeDir.y, b.fleeDir.x); b.heading += (fh - b.heading) * 0.15;
            if (b.x < -80 || b.x > _bfW + 80 || b.y < -80 || b.y > _bfH + 80 || b.fleeSpeed > 2) {
                _butterflies.splice(i, 1); _butterflyCurrentCount--;
            }
            continue;
        }

        if (b.state === 'fade') {
            b.fadeProgress += 0.008; b.alpha = 0.82 * (1 - b.fadeProgress);
            if (b.fadeProgress > 1) { _butterflies.splice(i, 1); _butterflyCurrentCount--; }
            continue;
        }

        if (b.state === 'rest') {
            b.floatAlpha = Math.min(1, b.floatAlpha + 0.02);
            if (!b.restSpot) { b.state = 'fly'; b.floatAlpha = 0; continue; }
            var rdx = b.restSpot.x - b.x, rdy = b.restSpot.y - b.y;
            var rdist = Math.sqrt(rdx * rdx + rdy * rdy);
            if (rdist < 8) {
                b.restTimer += 0.016;
                if (b.restTimer > b.restDuration) {
                    releaseSpot(b.restSpot); b.restSpot = null;
                    b.state = 'fly'; b.floatAlpha = 0;
                    b.targetX = Math.random() * _bfW; b.targetY = Math.random() * _bfH;
                    continue;
                }
            }
            b.x += rdx * 0.04; b.y += rdy * 0.04;
            b.heading += (Math.atan2(rdy, rdx) - b.heading) * 0.1;
            continue;
        }

        if (b.state === 'fly') {
            var dx = b.targetX - b.x, dy = b.targetY - b.y, dist = Math.sqrt(dx * dx + dy * dy) + 0.01;
            if (dist < 40) { b.targetX = Math.random() * _bfW; b.targetY = Math.random() * _bfH; }
            var spd = 0.25 + Math.sin(t * 0.4 + b.phase) * 0.08;
            b.vx += (dx / dist) * spd * 0.012; b.vy += (dy / dist) * spd * 0.012;
            var ms = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
            if (ms > 0.45) { b.vx = (b.vx / ms) * 0.45; b.vy = (b.vy / ms) * 0.45; }
            b.x += b.vx; b.y += b.vy;
            if (b.x < 10) b.vx += 0.1; if (b.x > _bfW - 10) b.vx -= 0.1;
            if (b.y < 10) b.vy += 0.1; if (b.y > _bfH - 10) b.vy -= 0.1;
            b.alpha = 0.82;
            var th = Math.atan2(b.vy, b.vx), dH = th - b.heading;
            while (dH > Math.PI) dH -= Math.PI * 2; while (dH < -Math.PI) dH += Math.PI * 2;
            b.heading += dH * 0.06;
            // Try to rest
            if (_butterflyCurrentCount > 4 && Math.random() < 0.0008) {
                var spot = occupySpot();
                if (spot) {
                    b.state = 'rest'; b.restSpot = spot; b.floatAlpha = 0;
                    b.restTimer = 0; b.restDuration = 15 + Math.random() * 35;
                }
            }
        }
    }

    // ===== Draw flying (behind panels) =====
    for (var i = 0; i < _butterflies.length; i++) {
        var b = _butterflies[i];
        if (b.state === 'rest') continue; // drawn on rest canvas

        if (b.state === 'flee') {
            drawFleeOnFly(b, t);
        } else if (b.state === 'fade') {
            _bfFlyCtx.save(); _bfFlyCtx.globalAlpha = b.alpha;
            drawSwayOnFly(b, t);
            _bfFlyCtx.restore();
        } else {
            drawSwayOnFly(b, t);
        }
    }

    // ===== Draw resting (above panels) =====
    for (var i = 0; i < _butterflies.length; i++) {
        var b = _butterflies[i];
        if (b.state !== 'rest' || !b.restSpot) continue;

        _bfRestCtx.save();
        _bfRestCtx.shadowColor = 'rgba(245,158,11,' + (0.25 * b.floatAlpha) + ')';
        _bfRestCtx.shadowBlur = 5 * b.floatAlpha;
        _bfRestCtx.globalAlpha = b.floatAlpha;
        _bfRestCtx.translate(b.restSpot.x, b.restSpot.y);

        // Gentle rotation sway + breathing pulse
        var swayRot = Math.sin(t * 0.5 + b.phase) * 0.05;
        var pulse = 0.94 + Math.sin(t * 1.2 + b.phase) * 0.04;
        // Occasional flutter
        var flutterPeriod = 3.5 + b.phase * 4.5;
        var fp = (t % flutterPeriod) / flutterPeriod;
        var flutter = 0;
        if (fp < 0.08) { flutter = Math.sin(fp / 0.08 * Math.PI * 3) * 0.18; }

        _bfRestCtx.rotate(swayRot);
        _bfRestCtx.scale(b.scale * pulse * 0.65, b.scale * pulse * 0.65);
        drawRestWings(_bfRestCtx, b.hue, b.restSpot.edge, flutter, 0.85);
        _bfRestCtx.restore();
    }

    _butterflyAnimId = requestAnimationFrame(updateAndDraw);
}

// Helper: draw swaying fly butterfly
function drawSwayOnFly(b, t) {
    var sx = Math.sin(t * 0.7 + b.phase) * 5, sy = Math.cos(t * 0.55 + b.phase) * 3.5;
    var rotSway = Math.sin(t * 0.5 + b.phase) * 0.05;
    var ws = 0.90 + Math.sin(t * 2.5 + b.phase) * 0.10;
    _bfFlyCtx.save();
    _bfFlyCtx.translate(b.x, b.y);
    _bfFlyCtx.rotate(b.heading + Math.PI / 2);
    _bfFlyCtx.rotate(rotSway);
    _bfFlyCtx.translate(sx, sy);
    _bfFlyCtx.scale(b.scale, b.scale);
    drawFlyWings(_bfFlyCtx, ws, b.alpha || 0.82, b.hue);
    _bfFlyCtx.restore();
}

// Helper: draw fleeing butterfly
function drawFleeOnFly(b, t) {
    _bfFlyCtx.save();
    _bfFlyCtx.shadowColor = 'rgba(239,68,68,0.25)';
    _bfFlyCtx.shadowBlur = 6;
    var flapPhase = (t * (0.6 + b.phase * 0.8) + b.phase) % 1;
    var baseC = Math.abs(Math.sin(flapPhase * Math.PI));
    var upWs = 1.0 - baseC * 0.90, loWs = 1.0 - baseC * 0.35;
    var a = Math.max(0.1, 0.82 - b.fleeSpeed * 0.3);
    _bfFlyCtx.translate(b.x, b.y);
    _bfFlyCtx.rotate(b.heading + Math.PI / 2);
    _bfFlyCtx.scale(b.scale, b.scale);
    var upWa = a * (0.25 + upWs * 0.75), loWa = a;
    var upC = 'hsla(' + b.hue + ',65%,48%,' + upWa + ')', upL = 'hsla(' + b.hue + ',75%,58%,' + upWa + ')';
    _bfFlyCtx.fillStyle = upC;
    _bfFlyCtx.beginPath(); _bfFlyCtx.moveTo(0, 0); _bfFlyCtx.lineTo(-32 * upWs, -20); _bfFlyCtx.lineTo(-30 * upWs, 12); _bfFlyCtx.closePath(); _bfFlyCtx.fill();
    _bfFlyCtx.fillStyle = upL;
    _bfFlyCtx.beginPath(); _bfFlyCtx.moveTo(0, 0); _bfFlyCtx.lineTo(-22 * upWs, -14); _bfFlyCtx.lineTo(-18 * upWs, 8); _bfFlyCtx.closePath(); _bfFlyCtx.fill();
    _bfFlyCtx.fillStyle = upC;
    _bfFlyCtx.beginPath(); _bfFlyCtx.moveTo(0, 0); _bfFlyCtx.lineTo(32 * upWs, -20); _bfFlyCtx.lineTo(30 * upWs, 12); _bfFlyCtx.closePath(); _bfFlyCtx.fill();
    _bfFlyCtx.fillStyle = upL;
    _bfFlyCtx.beginPath(); _bfFlyCtx.moveTo(0, 0); _bfFlyCtx.lineTo(22 * upWs, -14); _bfFlyCtx.lineTo(18 * upWs, 8); _bfFlyCtx.closePath(); _bfFlyCtx.fill();
    var loC = 'hsla(' + b.hue + ',65%,48%,' + loWa + ')', loL = 'hsla(' + b.hue + ',75%,58%,' + loWa + ')';
    _bfFlyCtx.fillStyle = loC;
    _bfFlyCtx.beginPath(); _bfFlyCtx.moveTo(0, 0); _bfFlyCtx.lineTo(-16 * loWs, 26); _bfFlyCtx.lineTo(16 * loWs, 26); _bfFlyCtx.closePath(); _bfFlyCtx.fill();
    _bfFlyCtx.fillStyle = loL;
    _bfFlyCtx.beginPath(); _bfFlyCtx.moveTo(0, 0); _bfFlyCtx.lineTo(-8 * loWs, 20); _bfFlyCtx.lineTo(8 * loWs, 20); _bfFlyCtx.closePath(); _bfFlyCtx.fill();
    _bfFlyCtx.restore();
}
```

- [ ] **Step 5: 添加点击交互**

```javascript
document.addEventListener('DOMContentLoaded', function () {
    var flyCanvas = document.getElementById('butterfly-fly-canvas');
    if (!flyCanvas) return;
    flyCanvas.addEventListener('click', function (e) {
        if (!_butterfliesRunning) return;
        var rect = flyCanvas.getBoundingClientRect();
        var mx = e.clientX - rect.left, my = e.clientY - rect.top;
        var hit = null, bestDist = Infinity;
        for (var i = 0; i < _butterflies.length; i++) {
            var b = _butterflies[i];
            if (b.state === 'fly' || b.state === 'enter' || b.state === 'flee') {
                var dx = b.x - mx, dy = b.y - my, dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 25 && dist < bestDist) { hit = b; bestDist = dist; }
            }
        }
        if (!hit) return;
        if (hit.state === 'fly' || hit.state === 'enter') {
            hit.state = 'flee';
            hit.fleeDir = { x: (Math.random() - 0.5) * 2.5, y: -(0.5 + Math.random() * 2) };
            hit.fleeSpeed = 0.25 + Math.random() * 0.3;
        } else if (hit.state === 'flee') {
            hit.state = 'fade'; hit.fadeProgress = 0;
        }
    });
});
```

- [ ] **Step 6: 添加导出函数 setButterflyPhase（供外部触发群体惊飞）**

```javascript
function setButterflyPhase(p) {
    _butterflyPhase = p;
    if (p === 'idle') _butterflyTargetCount = 3 + Math.floor(Math.random() * 3);
    else if (p === 'grow') _butterflyTargetCount = Math.min(15, _butterflyTargetCount + 1);
    else if (p === 'flee') {
        _butterflyTargetCount = Math.max(0, _butterflyCurrentCount - Math.floor(1 + Math.random() * 4));
        for (var i = 0; i < _butterflies.length; i++) {
            var b = _butterflies[i];
            if (b.state === 'rest') {
                releaseSpot(b.restSpot); b.restSpot = null;
                b.state = 'flee'; b.fleeDir = { x: (Math.random() - 0.5) * 2.5, y: -(0.5 + Math.random() * 2) }; b.fleeSpeed = 0.25 + Math.random() * 0.3;
            } else if (b.state === 'fly' && Math.random() < 0.6) {
                if (Math.random() < 0.5) {
                    b.state = 'flee'; b.fleeDir = { x: (Math.random() - 0.5) * 2.5, y: -(0.5 + Math.random() * 2) }; b.fleeSpeed = 0.25 + Math.random() * 0.3;
                } else { b.state = 'fade'; b.fadeProgress = 0; }
            }
        }
    }
}
```

---

### Task 2: 在 index.html 添加 canvas 和 script 引用

**Files:**
- Modify: `templates/index.html`

- [ ] **Step 1: 在现有 canvas 后面新增两个蝴蝶 canvas**

找到 `templates/index.html:10-11`，在 `ribbons-canvas` 行后插入：

```html
<canvas id="butterfly-fly-canvas" style="position:fixed;top:0;left:0;width:100%;height:100%;z-index:2;pointer-events:none;display:none;"></canvas>
<canvas id="butterfly-rest-canvas" style="position:fixed;top:0;left:0;width:100%;height:100%;z-index:10;pointer-events:none;display:none;"></canvas>
```

- [ ] **Step 2: 在 script 引用区添加 butterflies.js**

找到 `templates/index.html:116`（`static/ribbons.js` 行后），插入：

```html
<script src="/static/butterflies.js"></script>
```

两处修改完成后的上下文：

```html
<!-- 原 line 10-11 -->
<canvas id="particle-bg" style="position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none;display:none;"></canvas>
<canvas id="ribbons-canvas" style="position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;pointer-events:none;display:none;"></canvas>
<!-- 新增 -->
<canvas id="butterfly-fly-canvas" style="position:fixed;top:0;left:0;width:100%;height:100%;z-index:2;pointer-events:none;display:none;"></canvas>
<canvas id="butterfly-rest-canvas" style="position:fixed;top:0;left:0;width:100%;height:100%;z-index:10;pointer-events:none;display:none;"></canvas>

...

<!-- 原 line 116 -->
<script src="/static/ribbons.js"></script>
<!-- 新增 -->
<script src="/static/butterflies.js"></script>
```

---

### Task 3: 在 settings.html 添加自然生态种群动画开关

**Files:**
- Modify: `templates/panels/settings.html`

- [ ] **Step 1: 在系统设置子页面的彩带动画 box 后面插入自然生态种群动画开关**

找到 `templates/panels/settings.html:250` 附近（彩带动画 box 结束后），插入：

```html
            <div class="box">
                <h3>自然生态种群动画</h3>
                <p class="settings-hint">在页面中显示黄绿色自然生态种群动画，蝴蝶会飞行、休息在卡片边缘（点击开关立即生效）</p>
                <label><input type="checkbox" id="s-butterflies" onchange="applyUISetting('butterfly_animation', this.checked?'1':'0')"> 启用自然生态种群动画</label>
            </div>
```

---

### Task 4: 更新 settings.js 的 applyUISetting 和 applyStoredUISettings

**Files:**
- Modify: `static/settings.js`

- [ ] **Step 1: 在 applyUISetting 中添加 butterfly_animation 处理**

找到 `static/settings.js:254` 附近（`ribbon_effect` else if 块后），插入：

```javascript
    } else if (key === 'butterfly_animation') {
        if (value === '1' && typeof startButterflies === 'function') {
            startButterflies();
        } else if (typeof stopButterflies === 'function') {
            stopButterflies();
        }
```

- [ ] **Step 2: 在 applyStoredUISettings 中添加自然生态种群动画恢复逻辑**

找到 `static/settings.js:421` 附近（`ribbonEff` 逻辑后），插入：

```javascript
    // Butterfly animation
    var butterflyAnim = ui['butterfly_animation'] || '0';
    var butterflyCheck = document.getElementById('s-butterflies');
    if (butterflyCheck) { butterflyCheck.checked = butterflyAnim === '1'; }
    if (butterflyAnim === '1' && typeof startButterflies === 'function') {
        startButterflies();
    }
```

---

### Task 5: 更新 app.js 初始化逻辑

**Files:**
- Modify: `static/app.js`

- [ ] **Step 1: 在 window.onload 中添加自然生态种群动画初始化**

找到 `static/app.js:47-49`（`ribbon_effect` 初始化块后），插入：

```javascript
                if(s.key==='butterfly_animation' && s.value==='1' && typeof startButterflies==='function'){
                    startButterflies();
                }
```

修改后上下文：

```javascript
                if(s.key==='ribbon_effect' && s.value==='1' && typeof startRibbons==='function'){
                    startRibbons();
                }
                if(s.key==='butterfly_animation' && s.value==='1' && typeof startButterflies==='function'){
                    startButterflies();
                }
```

---

### Task 6: 验证集成

- [ ] **Step 1: 启动应用确认页面无 JS 错误**

```powershell
# 启动 Flask 应用（如果未运行）
python app.py
```
打开 `http://localhost:5000`，打开浏览器控制台，确认无 JS 报错。

- [ ] **Step 2: 进入设置页面开启自然生态种群动画**

进入 设置 → 系统设置 → 勾选"启用自然生态种群动画"。

- [ ] **Step 3: 验证飞行状态**

观察蝴蝶从边缘飞入，在面板下方飞行游荡（z=2）。

- [ ] **Step 4: 验证休息状态**

等待蝴蝶数量 >4，切换到"缓慢增殖"加速，观察蝴蝶停靠在卡片边框上（顶部/左侧/右侧），翅膀朝向正确，微风飘摆+偶尔扇翅。

- [ ] **Step 5: 验证点击交互**

点击飞行蝴蝶 → 惊飞离场；点击惊飞蝴蝶 → 渐变消失。

- [ ] **Step 6: 验证开关持久化**

关闭自然生态种群动画 → 刷新页面 → 确认动画未启动。重新开启 → 刷新页面 → 确认动画自动恢复。
