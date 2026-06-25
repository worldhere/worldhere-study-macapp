// golden scheduling app — floating triangle ribbon background
// adapted from demo-enhanced-no-character.html
var _ribbonsRunning = false;
var _ribbonsAnimId = null;

function startRibbons() {
    var canvas = document.getElementById('ribbons-canvas');
    if (!canvas) return;
    canvas.style.display = 'block';
    var ctx = canvas.getContext('2d');
    var w, h, scrollY = 0;
    var ribbons = [];
    var ribbonCount = 4;
    var parallax = -0.5;

    function resize() {
        w = canvas.width = window.innerWidth || document.documentElement.clientWidth;
        h = canvas.height = window.innerHeight || document.documentElement.clientHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    function onScroll() {
        scrollY = window.pageYOffset || document.documentElement.scrollTop;
    }
    window.addEventListener('scroll', onScroll);

    function isDark() {
        return document.documentElement.getAttribute('data-theme') === 'dark';
    }

    function addRibbon() {
        var side = Math.random() > 0.5 ? 'right' : 'left';
        var startX = side === 'right' ? w + 200 : -200;
        var baseY = Math.random() * h;
        var hue = Math.round(Math.random() * 360);
        var segments = [];
        var x = startX, y = baseY;
        var dirX = side === 'right' ? -1 : 1;

        for (var i = 0; i < 40; i++) {
            var speedX = (0.5 + Math.random() * 2.5) * dirX;
            var speedY = (Math.random() - 0.5) * 1.5;
            var nx = x + speedX * 30;
            var ny = y + speedY * 30;
            segments.push({
                x1: x, y1: y,
                x2: nx, y2: ny,
                x3: x + (nx - x) * 0.3 + (Math.random() - 0.5) * 40,
                y3: y + (Math.random() - 0.5) * 60,
                hue: (hue + i * 7) % 360,
                delay: i * 3,
                alpha: 0,
                phase: 0
            });
            x = nx; y = ny;
        }
        ribbons.push({ segments: segments, side: side });
    }

    function drawSegment(s) {
        if (s.phase >= 3.14 && s.alpha <= 0) return true;
        if (s.delay > 0) { s.delay -= 0.8; return false; }
        s.phase += 0.03;
        s.alpha = Math.sin(s.phase);
        if (s.alpha < 0) s.alpha = 0;

        var wobble = 0.08 * Math.sin(s.phase * 1.5) * 30;
        var px1 = s.x1 + wobble, py1 = s.y1 + wobble * 0.5;
        var px2 = s.x2 + wobble, py2 = s.y2 + wobble * 0.5;
        var px3 = s.x3 + wobble, py3 = s.y3 - wobble;

        var dark = isDark();
        var sat = dark ? '80%' : '70%';
        var lit = dark ? '60%' : '55%';
        ctx.fillStyle = 'hsla(' + s.hue + ', ' + sat + ', ' + lit + ', ' + (s.alpha * 0.55) + ')';
        ctx.beginPath();
        ctx.moveTo(px1, py1);
        ctx.lineTo(px2, py2);
        ctx.lineTo(px3, py3);
        ctx.closePath();
        ctx.fill();
        return false;
    }

    function draw() {
        if (!_ribbonsRunning) {
            window.removeEventListener('scroll', onScroll);
            window.removeEventListener('resize', resize);
            return;
        }
        ctx.clearRect(0, 0, w, h);
        ctx.save();
        var py = scrollY * parallax;
        ctx.translate(0, py);

        for (var r = 0; r < ribbons.length; r++) {
            var ribbon = ribbons[r];
            var done = 0;
            for (var s = 0; s < ribbon.segments.length; s++) {
                if (drawSegment(ribbon.segments[s])) done++;
            }
            if (done >= ribbon.segments.length) {
                ribbons.splice(r, 1);
                r--;
            }
        }

        ctx.restore();

        while (ribbons.length < ribbonCount) addRibbon();
        _ribbonsAnimId = requestAnimationFrame(draw);
    }

    for (var i = 0; i < ribbonCount; i++) addRibbon();
    _ribbonsRunning = true;
    draw();
}

function stopRibbons() {
    _ribbonsRunning = false;
    if (_ribbonsAnimId) {
        cancelAnimationFrame(_ribbonsAnimId);
        _ribbonsAnimId = null;
    }
    var canvas = document.getElementById('ribbons-canvas');
    if (canvas) {
        canvas.style.display = 'none';
        var ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
}
