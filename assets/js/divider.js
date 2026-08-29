// ============================================
// SHRIMPLINES — ELASTIC DIVIDER
// ============================================
// A small damped spring-chain interaction on the sidebar/content
// divider. Purely visual: it never touches the CSS grid, sidebar
// width, or content layout — it only takes over rendering of the
// divider LINE itself, via an absolutely-positioned canvas that sits
// on top of it (see .divider-canvas in components.css).
//
// TWO SEPARATE SURFACES, SAME CENTER:
// #divider-canvas (from the layout) is now a WIDE, pointer-events:none
// drawing-only surface (DRAW_WIDTH), sized to comfortably contain the
// string's full MAX_PULL displacement without the canvas's own box
// clipping it once it bends into the sidebar/content panels. A second,
// separate element — a plain <div>, created and owned entirely by this
// file, never added to any HTML template — is the actual pointer
// target: narrow (HIT_WIDTH, unchanged from before), pointer-events:
// auto, centered on the exact same divider X as the canvas. Widening
// the drawing canvas therefore never widens the draggable region; the
// two were previously the same element/width, which is what caused the
// string to visually disappear past ~HIT_WIDTH/2 px of displacement —
// not a stacking/z-index issue (that was a real but separate bug,
// already fixed in components.css/main.css).
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
//
// IMPORTANT — simultaneous (snapshot) update, not in-place mutation:
// every point's new dx/vx is computed from a snapshot of the PREVIOUS
// frame's displacements, then swapped in all at once. Updating
// points[i].dx in place while looping (so point i+1 reads point i's
// brand-new value instead of last frame's) turns this into a lopsided,
// non-physical recurrence that can quietly drift and blow up over a
// long-enough hold — verified numerically before this rewrite, and
// fixed by always reading from `prevDx`, never from a partially-
// updated points[] mid-loop.
//
// STIFFNESS/DAMPING: DAMPING is intentionally left at 0.8 (tuned
// in-browser). STIFFNESS is set well past the point where the
// slowest-decaying mode of the chain stops being a plain fade and
// starts genuinely overshooting past center before settling — that's
// what produces the guitar-string "swings back the other way, then
// decays" feel rather than a loose, floppy relaxation. Confirmed by
// direct simulation of this exact recurrence: bounded, reaches a
// visible reversal, and always returns to exactly 0.
(function () {
    var POINT_COUNT = 18;        // points along the chain — more = smoother curve
    var STIFFNESS = 0.55;        // neighbor coupling strength — taut string, not a loose chain
    var DAMPING = 0.85;           // velocity damping per frame — tuned in-browser, kept as-is
    var MAX_PULL = 46;           // px clamp so a wild drag can't stretch indefinitely
    var SETTLE_EPSILON = 0.05;   // below this displacement+velocity, treat as fully at rest
    var LINE_WIDTH = 1;          // matches the original 1px CSS border
    var HIT_WIDTH = 20;          // pointer-interaction width, centered on the divider — unchanged, deliberately narrow
    var DRAW_WIDTH = 2 * MAX_PULL + 10; // canvas drawing width — wide enough for the string's full MAX_PULL swing in either direction, plus a small margin

    var state = {
        canvas: null,
        ctx: null,
        hitEl: null,       // narrow, invisible pointer-capture element — separate from the (wider) drawing canvas
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

        canvas.style.left = (dividerX - DRAW_WIDTH / 2) + 'px';
        canvas.style.width = DRAW_WIDTH + 'px';
        canvas.style.height = height + 'px';

        canvas.width = Math.round(DRAW_WIDTH * dpr);
        canvas.height = Math.round(height * dpr);
        state.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        if (state.hitEl) {
            state.hitEl.style.left = (dividerX - HIT_WIDTH / 2) + 'px';
            state.hitEl.style.width = HIT_WIDTH + 'px';
            state.hitEl.style.height = height + 'px';
        }

        state.height = height;
        state.points = buildPoints(height);
        drawStraight();
    }

    function drawStraight() {
        var ctx = state.ctx;
        if (!ctx) return;
        ctx.clearRect(0, 0, DRAW_WIDTH, state.height);
        ctx.strokeStyle = state.color;
        ctx.lineWidth = LINE_WIDTH;
        ctx.beginPath();
        ctx.moveTo(DRAW_WIDTH / 2 + 0.5, 0);
        ctx.lineTo(DRAW_WIDTH / 2 + 0.5, state.height);
        ctx.stroke();
    }

    function draw() {
        var ctx = state.ctx;
        var points = state.points;
        if (!ctx || !points || !points.length) return;

        ctx.clearRect(0, 0, DRAW_WIDTH, state.height);
        ctx.strokeStyle = state.color;
        ctx.lineWidth = LINE_WIDTH;
        ctx.beginPath();

        var center = DRAW_WIDTH / 2;
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

        // Snapshot every point's displacement from THIS frame's start
        // so every point's force is computed from the same "before"
        // state — see the simultaneous-update note above.
        var prevDx = new Array(n);
        for (var s = 0; s < n; s++) prevDx[s] = points[s].dx;

        var settled = true;

        for (var i = 1; i < n - 1; i++) {
            var p = points[i];

            if (state.dragging && i === state.grabIndex) {
                var newDx = state.pendingDx;
                p.vx = newDx - prevDx[i];
                p.dx = newDx;
                settled = false;
                continue;
            }

            var left = prevDx[i - 1];
            var right = prevDx[i + 1];
            var force = STIFFNESS * (left + right - 2 * prevDx[i]);

            p.vx = (p.vx + force) * DAMPING;
            p.dx = prevDx[i] + p.vx;

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
        var rect = state.hitEl.getBoundingClientRect();
        var grabY = evt.clientY - rect.top;

        state.grabIndex = computeGrabIndex(grabY);
        if (state.grabIndex < 0) return;

        state.dragging = true;
        try { state.hitEl.setPointerCapture(evt.pointerId); } catch (e) {}

        var raw = evt.clientX - rect.left - HIT_WIDTH / 2;
        state.pendingDx = Math.max(-MAX_PULL, Math.min(MAX_PULL, raw));

        ensureLoop();
        evt.preventDefault();
    }

    function pointerMove(evt) {
        if (!state.dragging) return;
        var rect = state.hitEl.getBoundingClientRect();
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
        try { state.hitEl.releasePointerCapture(evt.pointerId); } catch (e) {}
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

        // The canvas is now sized to DRAW_WIDTH so the string can render
        // across its full MAX_PULL swing without being clipped by its
        // own box — but that means it also now visually overlaps the
        // sidebar/content on either side of the actual narrow divider
        // gap. It must not intercept pointer events there (that would
        // silently widen the draggable/hoverable area and block normal
        // clicks/selection on the panels). Interaction is handled
        // entirely by a separate, narrow hit-test element instead.
        canvas.style.pointerEvents = 'none';

        var hitEl = document.createElement('div');
        hitEl.setAttribute('aria-hidden', 'true');
        hitEl.style.position = 'absolute';
        hitEl.style.top = '0';
        // Match whatever components.css defines for .divider-canvas's
        // z-index, so the hit-test element stays in sync with that
        // single authoritative stacking rule rather than a second,
        // hardcoded value living here.
        hitEl.style.zIndex = getComputedStyle(canvas).zIndex;
        hitEl.style.cursor = 'ew-resize';
        hitEl.style.touchAction = 'none';
        hitEl.style.pointerEvents = 'auto';
        hitEl.style.background = 'transparent';
        canvas.insertAdjacentElement('afterend', hitEl);
        state.hitEl = hitEl;

        readColor();
        layout();

        // Hand rendering of the divider line entirely to the canvas so
        // there is never a duplicate straight line underneath it. Only
        // done once we know the canvas is actually working.
        nav.style.borderRightColor = 'transparent';

        hitEl.addEventListener('pointerdown', pointerDown);
        hitEl.addEventListener('pointermove', pointerMove);
        hitEl.addEventListener('pointerup', pointerUp);
        hitEl.addEventListener('pointercancel', pointerUp);

        window.addEventListener('resize', layout);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();