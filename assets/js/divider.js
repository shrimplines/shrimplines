// ============================================
// SHRIMPLINES — ELASTIC DIVIDER
// ============================================
// A small damped spring-chain interaction on the sidebar/content
// divider. Purely visual: it never touches the CSS grid, sidebar
// width, or content layout — it only takes over rendering of the
// divider LINE itself, via an absolutely-positioned canvas that sits
// on top of it (see .divider-canvas in components.css).
//
// Isolated on purpose: its own IIFE, its own canvas/id
// (#divider-canvas, distinct from #gol-canvas), no shared state with
// game-of-life.js.
//
// Progressive enhancement: if the expected elements aren't present or
// canvas isn't supported, init() bails out before touching anything,
// and the plain CSS border-right (see nav styling) remains the
// divider exactly as before.
//
// PHYSICS MODEL (guitar-string pluck):
// The divider is a chain of points with fixed y and a horizontal
// displacement `dx` + velocity `vx`. The two endpoints are hard-
// anchored at dx=0 forever — they are never touched by the physics
// step, so the chain's only possible resting state is perfectly
// straight.
//
// Only the single point nearest the pointer is "grabbed": while
// dragging, that one point's dx is driven directly to the pointer's
// horizontal offset (a kinematic constraint), and its velocity is
// derived from its own frame-to-frame movement. Every other point —
// including the grabbed one once released — is governed purely by a
// discrete wave equation: each point is pulled only toward the
// AVERAGE of its two immediate neighbors, then damped. A point can
// therefore only be disturbed by a neighbor that has already moved,
// so a pluck has to propagate outward step by step from the grab
// point rather than being applied everywhere at once. This is what
// produces the localized, tapering deformation (strong at the grab
// point, fading toward the anchored ends) instead of a broad
// translated curve.
(function () {
    var POINT_COUNT = 18;        // points along the chain — more = smoother curve
    var STIFFNESS = 0.15;        // neighbor coupling strength (discrete wave equation)
    var DAMPING = 0.87;          // velocity damping per frame — produces the settle wobble
    var MAX_PULL = 46;           // px clamp so a wild drag can't stretch indefinitely
    var SETTLE_EPSILON = 0.05;   // below this displacement+velocity, treat as fully at rest
    var LINE_WIDTH = 1;          // matches the original 1px CSS border
    var HIT_WIDTH = 20;          // canvas width in CSS px, centered on the divider

    var state = {
        canvas: null,
        ctx: null,
        shell: null,
        nav: null,
        points: null,      // [{y, dx, vx}] — index 0 and length-1 are anchored endpoints
        height: 0,
        dragging: false,
        grabIndex: -1,     // index of the currently/most-recently grabbed point
        pendingDx: 0,       // pointer's current (clamped) horizontal offset while dragging
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
                vx: 0
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

    // Finds the point nearest a given y (in canvas-local coordinates)
    // and clamps away from the two anchored endpoints, so a grab near
    // the very top/bottom edge still lands on a point that's actually
    // free to move.
    function computeGrabIndex(grabY) {
        var points = state.points;
        var count = points.length;
        if (count < 3) return -1;
        var t = state.height > 0 ? grabY / state.height : 0;
        var idx = Math.round(t * (count - 1));
        return Math.max(1, Math.min(count - 2, idx));
    }

    // One discrete-wave-equation step. The grabbed point (while
    // dragging) is kinematically driven to the pointer; every other
    // interior point is pulled only toward the average of its two
    // immediate neighbors, then damped. Endpoints are never touched —
    // they stay anchored at 0, which is the chain's only equilibrium.
    // Returns true once every free point's displacement and velocity
    // have decayed below SETTLE_EPSILON.
    function physicsStep() {
        var points = state.points;
        var n = points.length;
        if (n < 3) return true;

        var settled = true;

        for (var i = 1; i < n - 1; i++) {
            var p = points[i];

            if (state.dragging && i === state.grabIndex) {
                var newDx = state.pendingDx;
                p.vx = newDx - p.dx;
                p.dx = newDx;
                settled = false;
                continue;
            }

            var left = points[i - 1].dx;
            var right = points[i + 1].dx;
            var force = STIFFNESS * (left + right - 2 * p.dx);

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
        var rect = state.canvas.getBoundingClientRect();
        var grabY = evt.clientY - rect.top;

        state.grabIndex = computeGrabIndex(grabY);
        if (state.grabIndex < 0) return;

        state.dragging = true;
        try { state.canvas.setPointerCapture(evt.pointerId); } catch (e) {}

        var raw = evt.clientX - rect.left - HIT_WIDTH / 2;
        state.pendingDx = Math.max(-MAX_PULL, Math.min(MAX_PULL, raw));

        ensureLoop();
        evt.preventDefault();
    }

    function pointerMove(evt) {
        if (!state.dragging) return;
        var rect = state.canvas.getBoundingClientRect();
        var raw = evt.clientX - rect.left - HIT_WIDTH / 2;
        state.pendingDx = Math.max(-MAX_PULL, Math.min(MAX_PULL, raw));
        // Note: the grab index is intentionally NOT re-picked on move —
        // you keep hold of the same point on the string as you pull it,
        // the same way plucking a real string doesn't relocate the
        // pluck point just because your finger drifts slightly.
    }

    function pointerUp(evt) {
        if (!state.dragging) return;
        state.dragging = false;
        try { state.canvas.releasePointerCapture(evt.pointerId); } catch (e) {}
        // No explicit "release" step needed beyond clearing the flag —
        // the grabbed point already carries its last dx/vx, and
        // physicsStep() will fold it back into the ordinary
        // neighbor-spring simulation on the very next frame, which is
        // what lets the disturbance propagate and oscillate.
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