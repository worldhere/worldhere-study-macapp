// golden scheduling app — canvas-nest style particle background
var _particlesRunning = false;
var _particlesAnimId = null;
var _particlesPoints = [];
var _particlesMouseX = -9999;
var _particlesMouseY = -9999;

function startParticleBackground() {
    var canvas = document.getElementById('particle-bg');
    if (!canvas) return;
    canvas.style.display = 'block';
    var ctx = canvas.getContext('2d');
    var w, h;

    function resize() {
        w = canvas.width = window.innerWidth;
        h = canvas.height = window.innerHeight;
        var area = w * h;
        var count = Math.min(120, Math.max(60, Math.round(area / 12000)));
        if (_particlesPoints.length !== count) {
            _particlesPoints = [];
            for (var i = 0; i < count; i++) {
                _particlesPoints.push({
                    x: Math.random() * w,
                    y: Math.random() * h,
                    vx: (Math.random() - 0.5) * 0.6,
                    vy: (Math.random() - 0.5) * 0.6
                });
            }
        }
    }
    resize();
    window.addEventListener('resize', resize);

    function onMove(e) {
        _particlesMouseX = e.clientX;
        _particlesMouseY = e.clientY;
    }
    function onLeave() {
        _particlesMouseX = -9999;
        _particlesMouseY = -9999;
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseleave', onLeave);

    function isDark() {
        return document.documentElement.getAttribute('data-theme') === 'dark';
    }

    function draw() {
        if (!_particlesRunning) {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseleave', onLeave);
            window.removeEventListener('resize', resize);
            return;
        }
        ctx.clearRect(0, 0, w, h);
        var dark = isDark();
        var i, j, p, q, dx, dy, dist, alpha;

        for (i = 0; i < _particlesPoints.length; i++) {
            p = _particlesPoints[i];

            // Random walk — gentle direction drift
            p.vx += (Math.random() - 0.5) * 0.04;
            p.vy += (Math.random() - 0.5) * 0.04;
            // Clamp speed
            var spd = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
            if (spd > 0.5) { p.vx = (p.vx / spd) * 0.5; p.vy = (p.vy / spd) * 0.5; }
            if (spd < 0.15) { p.vx = (p.vx / spd) * 0.15; p.vy = (p.vy / spd) * 0.15; }

            p.x += p.vx;
            p.y += p.vy;

            // Wrap edges instead of bouncing
            if (p.x < 0) p.x = w;
            if (p.x > w) p.x = 0;
            if (p.y < 0) p.y = h;
            if (p.y > h) p.y = 0;

            // Mouse repulsion
            if (_particlesMouseX > -9000) {
                dx = p.x - _particlesMouseX;
                dy = p.y - _particlesMouseY;
                dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 150 && dist > 0.1) {
                    var force = (150 - dist) / 150 * 1.5;
                    p.vx += (dx / dist) * force * 0.15;
                    p.vy += (dy / dist) * force * 0.15;
                }
            }

            // Draw point
            ctx.fillStyle = dark ? 'rgba(180,180,220,0.50)' : 'rgba(99,102,241,0.45)';
            ctx.beginPath();
            ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
            ctx.fill();

            // Draw lines
            for (j = i + 1; j < _particlesPoints.length; j++) {
                q = _particlesPoints[j];
                dx = p.x - q.x;
                dy = p.y - q.y;
                dist = dx * dx + dy * dy;
                if (dist < 10000) {
                    alpha = (10000 - dist) / 10000;
                    ctx.beginPath();
                    ctx.lineWidth = alpha * 0.6;
                    ctx.strokeStyle = dark
                        ? 'rgba(160,170,210,' + (alpha * 0.35) + ')'
                        : 'rgba(99,102,241,' + (alpha * 0.25) + ')';
                    ctx.moveTo(p.x, p.y);
                    ctx.lineTo(q.x, q.y);
                    ctx.stroke();
                }
            }
        }
        _particlesAnimId = requestAnimationFrame(draw);
    }

    _particlesRunning = true;
    draw();
}

function stopParticleBackground() {
    _particlesRunning = false;
    if (_particlesAnimId) {
        cancelAnimationFrame(_particlesAnimId);
        _particlesAnimId = null;
    }
    var canvas = document.getElementById('particle-bg');
    if (canvas) {
        canvas.style.display = 'none';
        var ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    _particlesPoints = [];
}
