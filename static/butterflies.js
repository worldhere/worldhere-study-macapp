// golden scheduling app — butterfly / firefly animation (dual canvas)
var _butterfliesRunning = false;
var _butterfliesAnimId = null;
var _butterflies = [];
var _butterflyRestSpots = [];
var _butterflyPhase = 'idle';
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
    _butterfliesAnimId = requestAnimationFrame(updateAndDraw);
}

function stopButterflies() {
    _butterfliesRunning = false;
    if (_butterfliesAnimId) {
        cancelAnimationFrame(_butterfliesAnimId);
        _butterfliesAnimId = null;
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

// ===== SPAWN & SPOTS =====

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
        for (var i = 0; i < 4; i++) {
            _butterflyRestSpots.push({ x: cx + 10 + (cw - 20) * (i + 0.5) / 4, y: cy, edge: 'top', occupied: false });
        }
        for (var i = 0; i < 2; i++) {
            _butterflyRestSpots.push({ x: cx, y: cy + 10 + (ch - 20) * (i + 0.5) / 2, edge: 'left', occupied: false });
        }
        for (var i = 0; i < 2; i++) {
            _butterflyRestSpots.push({ x: cx + cw, y: cy + 10 + (ch - 20) * (i + 0.5) / 2, edge: 'right', occupied: false });
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

// ===== THEME DETECTION =====

function isDarkMode() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
}

// ===== BUTTERFLY DRAWING =====

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

// ===== FIREFLY DRAWING =====

function drawFireflyFly(ctx, b, t) {
    var hue = b.hue, sat = '80%';
    var bright = 0.5 + Math.sin(t * 1.8 + b.phase) * 0.28;
    var swayX = Math.sin(t * 0.7 + b.phase) * 3, swayY = Math.cos(t * 0.55 + b.phase) * 2.5;
    ctx.save();
    ctx.translate(b.x + swayX, b.y + swayY);

    ctx.save();
    ctx.rotate(b.heading);
    ctx.translate(0, 4);
    var gTail = ctx.createRadialGradient(0, 0, 0, 0, 0, 6);
    gTail.addColorStop(0, 'hsla(' + hue + ',' + sat + ',65%,' + (bright * 0.55) + ')');
    gTail.addColorStop(1, 'hsla(' + hue + ',' + sat + ',30%,0)');
    ctx.fillStyle = gTail;
    ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    var g1 = ctx.createRadialGradient(0, 0, 1, 0, 0, 14 * b.scale);
    g1.addColorStop(0, 'hsla(' + hue + ',' + sat + ',80%,' + bright + ')');
    g1.addColorStop(0.3, 'hsla(' + hue + ',' + sat + ',60%,' + (bright * 0.55) + ')');
    g1.addColorStop(0.7, 'hsla(' + hue + ',' + sat + ',35%,' + (bright * 0.12) + ')');
    g1.addColorStop(1, 'hsla(' + hue + ',' + sat + ',25%,0)');
    ctx.fillStyle = g1;
    ctx.beginPath(); ctx.arc(0, 0, 14 * b.scale, 0, Math.PI * 2); ctx.fill();

    var g2 = ctx.createRadialGradient(0, 0, 0, 0, 0, 3);
    g2.addColorStop(0, 'hsla(70,20%,95%,' + bright + ')');
    g2.addColorStop(0.3, 'hsla(' + hue + ',' + sat + ',85%,' + bright + ')');
    g2.addColorStop(1, 'hsla(' + hue + ',' + sat + ',50%,' + (bright * 0.2) + ')');
    ctx.fillStyle = g2;
    ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill();

    ctx.restore();
}

function drawFireflyRest(ctx, b, t) {
    var hue = b.hue, sat = '80%';
    var bright = 0.4 + Math.sin(t * 2.0 + b.phase) * 0.3;
    var g1 = ctx.createRadialGradient(0, 0, 0, 0, 0, 8);
    g1.addColorStop(0, 'hsla(' + hue + ',' + sat + ',75%,' + bright + ')');
    g1.addColorStop(0.5, 'hsla(' + hue + ',' + sat + ',50%,' + (bright * 0.4) + ')');
    g1.addColorStop(1, 'hsla(' + hue + ',' + sat + ',25%,0)');
    ctx.fillStyle = g1;
    ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill();

    var g2 = ctx.createRadialGradient(0, 0, 0, 0, 0, 2);
    g2.addColorStop(0, 'hsla(70,15%,95%,' + bright + ')');
    g2.addColorStop(1, 'hsla(' + hue + ',' + sat + ',60%,' + (bright * 0.3) + ')');
    ctx.fillStyle = g2;
    ctx.beginPath(); ctx.arc(0, 0, 2, 0, Math.PI * 2); ctx.fill();
}

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

// ===== BUTTERFLY FLY HELPERS =====

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

// ===== MAIN LOOP =====

function updateAndDraw() {
    if (!_butterfliesRunning) return;
    _bfFlyCtx.clearRect(0, 0, _bfW, _bfH);
    _bfRestCtx.clearRect(0, 0, _bfW, _bfH);
    collectRestSpots();
    var t = (Date.now() - _butterflyT0) * 0.001;
    var dark = isDarkMode();

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
            if (_butterflyCurrentCount > 4 && Math.random() < 0.0008) {
                var spot = occupySpot();
                if (spot) {
                    b.state = 'rest'; b.restSpot = spot; b.floatAlpha = 0;
                    b.restTimer = 0; b.restDuration = 15 + Math.random() * 35;
                }
            }
        }
    }

    // ===== DRAW FLYING =====
    for (var i = 0; i < _butterflies.length; i++) {
        var b = _butterflies[i];
        if (b.state === 'rest') continue;

        if (b.state === 'flee') {
            if (dark) {
                _bfFlyCtx.save();
                _bfFlyCtx.shadowColor = 'rgba(255,100,80,0.3)';
                _bfFlyCtx.shadowBlur = 10;
                _bfFlyCtx.translate(b.x, b.y);
                drawFireflyFlee(_bfFlyCtx, b, t);
                _bfFlyCtx.restore();
            } else {
                drawFleeOnFly(b, t);
            }
        } else if (b.state === 'fade') {
            _bfFlyCtx.save();
            _bfFlyCtx.globalAlpha = b.alpha;
            if (dark) {
                drawFireflyFly(_bfFlyCtx, b, t);
            } else {
                drawSwayOnFly(b, t);
            }
            _bfFlyCtx.restore();
        } else {
            if (dark) {
                drawFireflyFly(_bfFlyCtx, b, t);
            } else {
                drawSwayOnFly(b, t);
            }
        }
    }

    // ===== DRAW RESTING =====
    for (var i = 0; i < _butterflies.length; i++) {
        var b = _butterflies[i];
        if (b.state !== 'rest' || !b.restSpot) continue;

        if (dark) {
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
            _bfRestCtx.save();
            _bfRestCtx.shadowColor = 'rgba(245,158,11,' + (0.25 * b.floatAlpha) + ')';
            _bfRestCtx.shadowBlur = 5 * b.floatAlpha;
            _bfRestCtx.globalAlpha = b.floatAlpha;
            _bfRestCtx.translate(b.restSpot.x, b.restSpot.y);

            var swayRot = Math.sin(t * 0.5 + b.phase) * 0.05;
            var pulse = 0.94 + Math.sin(t * 1.2 + b.phase) * 0.04;
            var flutterPeriod = 3.5 + b.phase * 4.5;
            var fp = (t % flutterPeriod) / flutterPeriod;
            var flutter = 0;
            if (fp < 0.08) { flutter = Math.sin(fp / 0.08 * Math.PI * 3) * 0.18; }

            _bfRestCtx.rotate(swayRot);
            _bfRestCtx.scale(b.scale * pulse * 0.65, b.scale * pulse * 0.65);
            drawRestWings(_bfRestCtx, b.hue, b.restSpot.edge, flutter, 0.85);
            _bfRestCtx.restore();
        }
    }

    _butterfliesAnimId = requestAnimationFrame(updateAndDraw);
}

// ===== CLICK INTERACTION =====
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

// ===== PHASE CONTROL =====
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
