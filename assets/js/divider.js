// ============================================
// SHRIMPLINES — ELASTIC DIVIDER
// ============================================
// A small damped spring-chain interaction on the sidebar/content
// divider. Purely visual: it never touches the CSS grid, sidebar
// width, or content layout — it only takes over rendering of the
// divider LINE itself, via an absolutely-positioned canvas that sits
// on top of it (see .divider-canvas in main.css).
//
// Isolated on purpose: its own IIFE, its own canvas/id
// (#divider-canvas, distinct from #gol-canvas), no shared state with
// game-of-life.js.
//
// Progressive enhancement: if the expected elements aren't present or
// canvas isn't supported, init() bails out before touching anything,
// and the plain CSS border-right (see main.css / nav styling) remains
// the divider exactly as before.

(function () {
    var POINT_COUNT = 18;           // points along the chain — more = smoother curve
    var STIFFNESS = 0.18;           // pull toward the current target displacement
    var NEIGHBOR_STIFFNESS = 0.12;  // pull toward neighboring points (curve smoothing)
    var DAMPING = 0.88;             // velocity damping per frame — produces the settle wobble
    var GRAB_SIGMA = 60;            // px falloff radius: how far the pull reaches along the line
    var MAX_PULL = 46;              // px clamp so a wild drag can't stretch indefinitely
    var SETTLE_EPSILON = 0.05;      // below this displacement+velocity, treat as fully at rest
    var LINE_WIDTH = 1;             // matches the original 1px CSS border
    var HIT_WIDTH = 20;             // canvas width in CSS px, centered on the divider

    var state = {
        canvas: null,
        ctx: null,
        shell: null,
        nav: null,
        points: null,      // [{y, dx, vx, targetDx}]
        height: 0,
        dragging: false,
        grabY: 0,
        grabDx: 0,
        rafId: null,
        color: '#8a97a8'   // fallback; overwritten from the site's color token
    };

    function readColor() {
        var styles = getComputedStyle(document.documentElement);
        var border = (styles.getPropertyValue('--color-border') || '').trim();
        if (border) state.color = border;
    }

    function buildPoints(height) {
        var points = [];
        var count = Math.max(2, POINT_COUNT);
        for (var i = 0; i < count; i++) {
            points.push({
                y: (height * i) / (count - 1),
                dx: 0,
                vx: 0,
                targetDx: 0
            });
        }
        return points;
    }

    function layout() {
        var shell = state.shell;
        var nav = state.nav;
        var canvas = state.canvas;
        if (!shell || !nav || !canvas) return;

        var shellRect = shell.getBoundingClientRect();
        var navRect = nav.getBoundingClientRect();
        var dividerX = navRect.right - shellRect.left; // divider position relative to shell
        var height = shellRect.height;
        var dpr = window.devicePixelRatio || 1;

        canvas.style.left = (dividerX - HIT_WIDTH / 2) + 'px';
        canvas.style.width = HIT_WIDTH + 'px';
        canvas.style.height = height + 'px';

        canvas.width = Math.round(HIT_WIDTH * dpr);
        canvas.height = Math.round(height * dpr);
        state.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        state.height = height;
        state.points = buildPoints(height);
        drawStraight();
    }

    function drawStraight() {
        var ctx = state.ctx;
        if (!ctx) return;
        ctx.clearRect(0, 0, HIT_WIDTH, state.height);
        ctx.strokeStyle = state.color;
        ctx.lineWidth = LINE_WIDTH;
        ctx.beginPath();
        ctx.moveTo(HIT_WIDTH / 2 + 0.5, 0);
        ctx.lineTo(HIT_WIDTH / 2 + 0.5, state.height);
        ctx.stroke();
    }

    function draw() {
        var ctx = state.ctx;
        var points = state.points;
        if (!ctx || !points || !points.length) return;

        ctx.clearRect(0, 0, HIT_WIDTH, state.height);
        ctx.strokeStyle = state.color;
        ctx.lineWidth = LINE_WIDTH;
        ctx.beginPath();

        var center = HIT_WIDTH / 2;
        points.forEach(function (p, i) {
            var x = center + p.dx + 0.5;
            if (i === 0) {
                ctx.moveTo(x, p.y);
            } else {
                ctx.lineTo(x, p.y);
            }
        });
        ctx.stroke();
    }

    function falloff(distance) {
        return Math.exp(-(distance * distance) / (2 * GRAB_SIGMA * GRAB_SIGMA));
    }

    function applyDragTargets() {
        var points = state.points;
        for (var i = 0; i < points.length; i++) {
            points[i].targetDx = state.grabDx * falloff(points[i].y - state.grabY);
        }
    }

    function releaseTargets() {
        var points = state.points;
        for (var i = 0; i < points.length; i++) {
            points[i].targetDx = 0;
        }
    }

    // One damped spring-chain step. Each point is pulled toward its own
    // target (0 at rest, pointer-influenced while dragging) and toward
    // its neighbors (so the curve stays smooth rather than kinking).
    // Returns true once every point's displacement and velocity have
    // decayed below SETTLE_EPSILON.
    function physicsStep() {
        var points = state.points;
        var settled = true;

        for (var i = 0; i < points.length; i++) {
            var p = points[i];
            var force = (p.targetDx - p.dx) * STIFFNESS;

            if (i > 0) force += (points[i - 1].dx - p.dx) * NEIGHBOR_STIFFNESS;
            if (i < points.length - 1) force += (points[i + 1].dx - p.dx) * NEIGHBOR_STIFFNESS;

            p.vx = (p.vx + force) * DAMPING;
            p.dx += p.vx;

            if (Math.abs(p.dx) > SETTLE_EPSILON || Math.abs(p.vx) > SETTLE_EPSILON) {
                settled = false;
            }
        }

        return settled;
    }

    function loop() {
        var settled = physicsStep();

        if (!state.dragging && settled) {
            // Snap exactly back to the resting straight line so no
            // fractional-pixel offset lingers, then stop the loop
            // entirely — this is not a continuous animation.
            state.points.forEach(function (p) { p.dx = 0; p.vx = 0; });
            drawStraight();
            state.rafId = null;
            return;
        }

        draw();
        state.rafId = window.requestAnimationFrame(loop);
    }

    function ensureLoop() {
        if (state.rafId === null) {
            state.rafId = window.requestAnimationFrame(loop);
        }
    }

    function pointerDown(evt) {
        if (!state.points) return;
        state.dragging = true;
        try { state.canvas.setPointerCapture(evt.pointerId); } catch (e) {}
        var rect = state.canvas.getBoundingClientRect();
        state.grabY = evt.clientY - rect.top;
        state.grabDx = evt.clientX - rect.left - HIT_WIDTH / 2;
        applyDragTargets();
        ensureLoop();
        evt.preventDefault();
    }

    function pointerMove(evt) {
        if (!state.dragging) return;
        var rect = state.canvas.getBoundingClientRect();
        state.grabY = evt.clientY - rect.top;
        var raw = evt.clientX - rect.left - HIT_WIDTH / 2;
        state.grabDx = Math.max(-MAX_PULL, Math.min(MAX_PULL, raw));
        applyDragTargets();
    }

    function pointerUp(evt) {
        if (!state.dragging) return;
        state.dragging = false;
        try { state.canvas.releasePointerCapture(evt.pointerId); } catch (e) {}
        releaseTargets();
        ensureLoop();
    }

    function init() {
        var shell = document.querySelector('.site-shell');
        var nav = document.querySelector('.site-nav');
        var canvas = document.getElementById('divider-canvas');
        if (!shell || !nav || !canvas || !canvas.getContext) return;

        state.shell = shell;
        state.nav = nav;
        state.canvas = canvas;
        state.ctx = canvas.getContext('2d');

        readColor();
        layout();

        // Hand rendering of the divider line entirely to the canvas so
        // there is never a duplicate straight line underneath it. Only
        // done once we know the canvas is actually working.
        nav.style.borderRightColor = 'transparent';

        canvas.addEventListener('pointerdown', pointerDown);
        canvas.addEventListener('pointermove', pointerMove);
        canvas.addEventListener('pointerup', pointerUp);
        canvas.addEventListener('pointercancel', pointerUp);

        window.addEventListener('resize', layout);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();