/*
 * Interactive page background.
 *
 * A field of small ticks on a grid, alternating +/-45 degrees so they read as a
 * chevron lattice — the same motif as the theme's hero decoration, promoted to
 * the whole page. A slow traveling wave keeps it from ever being quite still;
 * near the pointer the ticks swing perpendicular to the radius (concentric
 * rings), lengthen, and warm from the border grey toward the primary blue,
 * then relax back over about a second.
 *
 * Decorative only: aria-hidden, pointer-events none, stopped while the tab is
 * hidden, and reduced to a single static frame under prefers-reduced-motion.
 */
(function () {
    'use strict';

    var canvas = document.getElementById('bg-field');
    if (!canvas || !canvas.getContext) return;

    var ctx = canvas.getContext('2d');
    var reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

    var SPACING = 46;          // grid pitch, px
    var SPACING_COMPACT = 62;  // ... below 768px, where cheap frames matter more
    var LEN = 13;              // tick length at rest
    var REACH = 190;           // pointer influence radius
    var IDLE_INTERVAL = 33;    // ms between frames when only the wave is running

    var RIPPLE_SPEED = 780;    // px/s the click front travels
    var RIPPLE_BAND = 74;      // px half-width of the front
    var RIPPLE_KICK = 9;       // px a tick is shoved outward at the peak
    var RIPPLE_MAX = 4;        // concurrent fronts before the oldest is dropped

    /* --- palette, read from the theme's own tokens ------------------------ */

    var css = getComputedStyle(document.documentElement);

    function rgb(hex) {
        var h = hex.replace('#', '');
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        var n = parseInt(h, 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }

    function token(name, fallback) {
        return rgb(css.getPropertyValue(name).trim() || fallback);
    }

    var REST = token('--border-color-strong', '#c6cfdd');
    var LIVE = token('--primary-color', '#1d4ed8');

    function stroke(t, alpha) {
        return 'rgba('
            + Math.round(REST[0] + (LIVE[0] - REST[0]) * t) + ','
            + Math.round(REST[1] + (LIVE[1] - REST[1]) * t) + ','
            + Math.round(REST[2] + (LIVE[2] - REST[2]) * t) + ','
            + alpha.toFixed(3) + ')';
    }

    var REST_STROKE = stroke(0, 0.5);

    /* --- state ------------------------------------------------------------ */

    var w = 0, h = 0, dpr = 1, compact = false;
    var px = -9999, py = -9999;   // pointer, smoothed
    var tx = -9999, ty = -9999;   // pointer, raw
    var active = false;
    var scrollPhase = 0;
    var reduce = reduceQuery.matches;
    var ticks = [];
    var ripples = [];
    var raf = null;
    var lastDraw = 0;

    /* Ticks have no head or tail, so the shortest rotation between two angles
       wraps at PI, not 2PI. Without this they spin the long way round. */
    function delta(from, to) {
        var d = (to - from) % Math.PI;
        if (d > Math.PI / 2) d -= Math.PI;
        if (d < -Math.PI / 2) d += Math.PI;
        return d;
    }

    function build() {
        var step = compact ? SPACING_COMPACT : SPACING;
        var cols = Math.ceil(w / step) + 1;
        var rows = Math.ceil(h / step) + 1;
        ticks = [];
        for (var r = 0; r < rows; r++) {
            for (var c = 0; c < cols; c++) {
                var base = ((r + c) % 2 === 0 ? -1 : 1) * Math.PI / 4;
                ticks.push({
                    x: c * step + step / 2,
                    y: r * step + step / 2,
                    base: base,
                    a: base,
                    boost: 0,
                    ox: 0,
                    oy: 0
                });
            }
        }
    }

    function resize() {
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        w = window.innerWidth;
        h = window.innerHeight;
        compact = w < 768;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        build();
        draw(performance.now());
    }

    function draw(now) {
        var t = now / 1000;
        var i, k, it;
        var reach2 = REACH * REACH;

        for (i = ripples.length - 1; i >= 0; i--) {
            if (t - ripples[i].t0 > ripples[i].life) ripples.splice(i, 1);
        }

        for (i = 0; i < ticks.length; i++) {
            it = ticks[i];
            var target = it.base;
            var ox = 0, oy = 0;

            /* The strongest nearby source — pointer or one of the fronts —
               owns the angle; a blend of several just cancels out to noise. */
            var boost = 0, aim = 0;

            if (!reduce) {
                target += Math.sin(it.x * 0.010 + it.y * 0.016 - t * 0.5 + scrollPhase) * 0.20;
            }

            if (active) {
                var dx = it.x - px, dy = it.y - py;
                var d2 = dx * dx + dy * dy;
                if (d2 < reach2) {
                    var f = 1 - Math.sqrt(d2) / REACH;
                    boost = f * f;
                    aim = Math.atan2(dy, dx) + Math.PI / 2;
                }
            }

            for (k = 0; k < ripples.length; k++) {
                var rp = ripples[k];
                var age = t - rp.t0;
                var rx = it.x - rp.x, ry = it.y - rp.y;
                var rd = Math.sqrt(rx * rx + ry * ry);

                /* Gaussian band riding the expanding front, dimming with age. */
                var band = (rd - age * RIPPLE_SPEED) / RIPPLE_BAND;
                if (band < -3 || band > 3) continue;
                var fade = 1 - age / rp.life;
                var inf = Math.exp(-band * band) * fade * fade;
                if (inf < 0.004) continue;

                if (rd > 0.001) {
                    ox += rx / rd * inf * RIPPLE_KICK;
                    oy += ry / rd * inf * RIPPLE_KICK;
                }
                if (inf > boost) {
                    boost = inf;
                    aim = Math.atan2(ry, rx) + Math.PI / 2;
                }
            }

            if (boost > 0) target += delta(target, aim) * boost;

            it.a += delta(it.a, target) * 0.16;
            /* Snap toward a passing front, drift back slowly once it is gone. */
            it.boost += (boost - it.boost) * (boost > it.boost ? 0.45 : 0.10);
            it.ox = ox;
            it.oy = oy;
        }

        ctx.clearRect(0, 0, w, h);
        ctx.lineCap = 'round';
        ctx.lineWidth = 2;

        /* One path for every tick at rest — a strokeStyle per tick would mean
           ~700 string allocations every frame. */
        ctx.beginPath();
        for (i = 0; i < ticks.length; i++) {
            it = ticks[i];
            if (it.boost > 0.01) continue;
            var hx = Math.cos(it.a) * LEN / 2, hy = Math.sin(it.a) * LEN / 2;
            ctx.moveTo(it.x - hx, it.y - hy);
            ctx.lineTo(it.x + hx, it.y + hy);
        }
        ctx.strokeStyle = REST_STROKE;
        ctx.stroke();

        for (i = 0; i < ticks.length; i++) {
            it = ticks[i];
            if (it.boost <= 0.01) continue;
            var cx = it.x + it.ox, cy = it.y + it.oy;
            var len = LEN * (1 + it.boost * 0.45);
            var gx = Math.cos(it.a) * len / 2, gy = Math.sin(it.a) * len / 2;
            ctx.beginPath();
            ctx.moveTo(cx - gx, cy - gy);
            ctx.lineTo(cx + gx, cy + gy);
            ctx.strokeStyle = stroke(it.boost, 0.5 + it.boost * 0.45);
            ctx.stroke();
        }

        if (reduce) return;

        /* Trail the pointer slightly so the comb feels like it has weight. */
        px += (tx - px) * 0.18;
        py += (ty - py) * 0.18;
    }

    /* --- loop ------------------------------------------------------------- */

    function loop(now) {
        raf = window.requestAnimationFrame(loop);
        /* Full rate under the pointer and while a front is travelling; the
           ambient wave alone does not need 60fps. */
        if (!active && !ripples.length && now - lastDraw < IDLE_INTERVAL) return;
        lastDraw = now;
        draw(now);
    }

    function start() {
        if (raf || reduce) return;
        raf = window.requestAnimationFrame(loop);
    }

    function stop() {
        if (!raf) return;
        window.cancelAnimationFrame(raf);
        raf = null;
    }

    /* --- input ------------------------------------------------------------ */

    window.addEventListener('pointermove', function (e) {
        tx = e.clientX;
        ty = e.clientY;
        if (!active) {          // first sighting: start under the cursor, no swoop
            px = tx;
            py = ty;
            active = true;
        }
    }, { passive: true });

    window.addEventListener('pointerout', function (e) {
        if (!e.relatedTarget) active = false;
    }, { passive: true });

    /* Primary press only — a right-click is opening a menu, not throwing a
       stone in the pond. The front has to clear the far corner, so its life
       comes from the diagonal rather than a fixed duration. */
    window.addEventListener('pointerdown', function (e) {
        if (reduce || (e.button !== undefined && e.button !== 0)) return;
        if (ripples.length >= RIPPLE_MAX) ripples.shift();
        ripples.push({
            x: e.clientX,
            y: e.clientY,
            t0: performance.now() / 1000,
            life: (Math.sqrt(w * w + h * h) + RIPPLE_BAND * 3) / RIPPLE_SPEED
        });
        start();
    }, { passive: true });

    window.addEventListener('blur', function () { active = false; });

    window.addEventListener('scroll', function () {
        scrollPhase = window.scrollY * 0.0016;
    }, { passive: true });

    var resizeRaf = null;
    window.addEventListener('resize', function () {
        if (resizeRaf) return;
        resizeRaf = window.requestAnimationFrame(function () {
            resizeRaf = null;
            resize();
        });
    }, { passive: true });

    /* A page opened in a background tab measures 0x0 and rAF never runs, so the
       field has to re-measure on the way back rather than trust its boot size. */
    function wake() {
        if (document.hidden) { stop(); return; }
        if (!w || w !== window.innerWidth || h !== window.innerHeight) resize();
        start();
    }

    document.addEventListener('visibilitychange', wake);
    window.addEventListener('pageshow', wake);

    if (reduceQuery.addEventListener) {
        reduceQuery.addEventListener('change', function (e) {
            reduce = e.matches;
            if (reduce) { stop(); draw(performance.now()); } else start();
        });
    }

    /* --- boot ------------------------------------------------------------- */

    resize();
    if (!reduce) start();
})();
