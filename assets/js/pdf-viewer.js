// ============================================
// SHRIMPLINES — EMBEDDED PDF READER
// ============================================
// Renders a PDF directly into the page via self-hosted PDF.js (no
// iframe, no native toolbar/scrollbar) inside the markup emitted by
// _includes/pdf.html. Navigation happens ONLY through the two elastic
// boundary handles — the viewport itself has no native scroll; this
// is a fixed viewing window over a continuous page stack, and the
// boundaries are what move the window, not a scrollbar standing in
// for them.
//
// Isolated on purpose, same shape as divider.js: its own IIFE, no
// shared state, bails out in init() if no reader markup is present on
// the page. Loaded as a module (see _layouts/default.html) only on
// pages whose front matter sets `has_pdf: true`, so it never ships to
// pages that don't need it.
//
// BOUNDARY MODEL — a boundary is a single moving point (the apex), not
// a chain like divider.js's string. Two anchored corners + the apex
// make an OPEN chevron (two lines, no base). Pulling is a throttle,
// not a drag: while a boundary is held, how far the pointer is from
// where it grabbed (b.pull, 0..MAX_PULL) sets a continuous document
// VELOCITY (px/s, scaled by delta time); holding still keeps the
// document moving, releasing stops it on the spot. The drawn apex
// (b.apex) only follows the pull for display. On release it hands off
// to a spring that is completely independent of the document.
//
// REVEAL — the viewport element is taller than the visible window by
// MAX_PULL above and below ("room"), and is clipped with a polygon
// (clip-path) that is the window rectangle plus the two tents under
// the chevrons. So the tent interior shows real pages; the shaded
// wedges outside the lines are drawn in the room, never over paper.
//
// SCROLL MODEL — the boundaries, not a scrollbar, are the only way to
// move through the document. Internally this is one number,
// `state.offset` (px into the full stacked-page height), applied as
// `translateY(-offset)` on .pdf-reader-pages. The top boundary
// decreases it (reveals earlier content); the bottom increases it.
// Nothing here ever touches `.content-area`'s own scrolling.
(function () {
    var MAX_PULL = 56;            // px: pointer travel for full speed == max tent depth == reserved room above/below the window
    var MAX_SPEED = 900;         // px/s document speed at full pull
    var SPEED_EXPONENT = 1.6;     // >1 gives finer control near rest
    var EDGE_MAX = 10;            // px: deepest tent while the document is already at that end (nothing to reveal)
    var FOLLOW_RATE = 40;         // 1/s: how fast the drawn apex catches the pointer (exponential smoothing)
    var APEX_X_MIN = 0.15;        // apex follows the pointer horizontally, kept inside this fraction of the width
    var APEX_X_MAX = 0.85;
    var STEP = 1 / 60;            // spring runs in fixed 60 Hz steps so it feels the same at any refresh rate
    var STIFFNESS = 0.3;          // spring pull toward baseline, per step
    var DAMPING = 0.78;
    var X_RETURN = 0.18;          // per-step easing of the apex back to centre after release
    var SETTLE_EPSILON = 0.05;
    var KEY_STEP = 72;            // px per arrow-key press
    var RENDER_MARGIN = '200% 0px'; // IntersectionObserver rootMargin — render pages before they're visible
    var BASE_SCALE_CAP = 2;       // hard ceiling on devicePixelRatio-driven canvas scale, for memory's sake

    var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function baseurl() {
        return (document.body && document.body.dataset.baseurl) || '';
    }

    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
    function r2(v) { return Math.round(v * 100) / 100; }

    // ---- one reader instance ------------------------------------------------

    function Reader(root) {
        this.root = root;
        this.frame = root.querySelector('.pdf-reader-frame');
        this.viewport = root.querySelector('[data-pdf-viewport]');
        this.pagesEl = root.querySelector('[data-pdf-pages]');
        this.statusEl = root.querySelector('[data-pdf-status]');
        this.src = root.dataset.pdfSrc;
        // Single source of truth for the room above/below the window;
        // components.css reads it (with the same value as its fallback).
        root.style.setProperty('--pdf-pull-room', MAX_PULL + 'px');
        this.boundaries = {
            top: this.makeBoundary('top'),
            bottom: this.makeBoundary('bottom')
        };

        this.offset = 0;      // current scroll position, px into the full page stack
        this.maxOffset = 0;   // full stack height minus window height, once known
        this.windowH = 0;     // height of the visible window (viewport box minus the two rooms)
        this.pdf = null;
        this.pageEntries = []; // { el, canvas, pageNumber, naturalWidth, naturalHeight, rendered, renderTask }
        this.resizeRaf = null;
        this.loopRaf = null;
        this.lastTime = null;

        this.boundInit = this.init.bind(this);
    }

    Reader.prototype.makeBoundary = function (side) {
        var svg = this.root.querySelector('svg[data-pdf-boundary="' + side + '"]');
        return {
            side: side,
            svg: svg,
            path: svg.querySelector('[data-pdf-boundary-path]'),   // the two chevron lines (stroke only)
            shade: svg.querySelector('[data-pdf-boundary-shade]'), // wedges outside the lines (fill only)
            hit: this.root.querySelector('[data-pdf-hit="' + side + '"]'),
            width: 0,
            dragging: false,
            pointerId: null,
            grabY: 0,
            pull: 0,       // pointer displacement from the grab point, 0..MAX_PULL — drives document velocity
            targetX: 0,    // where the pointer wants the apex horizontally
            apex: 0,       // drawn tent depth, px (>=0; direction is implied by side)
            apexX: 0,      // drawn apex x, px from the frame's left edge
            apexVel: 0,    // spring velocity (display only)
            acc: 0         // leftover time for the fixed-step spring
        };
    };

    // ---- layout ---------------------------------------------------------------

    Reader.prototype.layoutBoundary = function (b) {
        var w = this.frame.getBoundingClientRect().width;
        var h = MAX_PULL + 1; // the room, plus one px so the baseline stroke isn't cut

        b.width = w;
        b.svg.setAttribute('width', w);
        b.svg.setAttribute('height', h);
        b.svg.style.width = w + 'px';
        b.svg.style.height = h + 'px';
        // viewBox in CSS px keeps the path math below free of DPR concerns;
        // the svg's own width/height attrs (not viewBox) control on-screen
        // size, so this does not stretch the stroke.
        b.svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
        if (!b.dragging) b.apexX = w / 2;
        this.drawBoundary(b);
    };

    // Open chevron: two anchored corners and one apex, joined by TWO lines
    // and nothing else. At rest the apex sits on the baseline, so the same
    // path is just the flat hairline — no separate "resting line" to swap
    // out, and no horizontal base once pulled.
    //
    // Shade: the same two lines closed back along the horizontal through
    // the apex. That polygon is the band between the baseline and the
    // apex's height MINUS the tent under the lines, i.e. the region
    // OUTSIDE the lines; the interior is never filled. Its height is the
    // pull depth, so it is zero-area at rest.
    //
    // The top svg's baseline is its bottom edge (apex moves to smaller y);
    // the bottom svg's baseline is its top edge (apex moves to larger y).
    // Both svgs sit in the room beside the window, never over the paper.
    Reader.prototype.drawBoundary = function (b) {
        var w = b.width;
        var top = (b.side === 'top');
        var baseY = top ? MAX_PULL : 1;
        var apexY = top ? baseY - b.apex : baseY + b.apex;
        var x = clamp(b.apexX, 0, w);

        var line = 'M0,' + r2(baseY) + ' L' + r2(x) + ',' + r2(apexY) + ' L' + r2(w) + ',' + r2(baseY);
        b.path.setAttribute('d', line);
        b.shade.setAttribute('d', line + ' L' + r2(w) + ',' + r2(apexY) + ' L0,' + r2(apexY) + ' Z');
        this.applyClip();
    };

    // The reveal. The viewport box spans the window plus MAX_PULL of room
    // above and below; this polygon is the window rectangle with each
    // edge pushed out into the room to the chevron's apex. Everything the
    // polygon contains is real page content, everything outside it is
    // the page background. Coordinates are viewport-local (== frame-local).
    Reader.prototype.applyClip = function () {
        var t = this.boundaries.top;
        var b = this.boundaries.bottom;
        var w = t.width;
        if (!w || !this.windowH) return;
        var y0 = MAX_PULL;
        var y1 = MAX_PULL + this.windowH;
        var pts = [
            [0, y0], [clamp(t.apexX, 0, w), y0 - t.apex], [w, y0],
            [w, y1], [clamp(b.apexX, 0, w), y1 + b.apex], [0, y1]
        ];
        var poly = 'polygon(' + pts.map(function (p) { return r2(p[0]) + 'px ' + r2(p[1]) + 'px'; }).join(',') + ')';
        this.viewport.style.clipPath = poly;
        this.viewport.style.webkitClipPath = poly;
    };

    Reader.prototype.layout = function () {
        this.windowH = Math.max(0, this.viewport.clientHeight - 2 * MAX_PULL);
        this.layoutBoundary(this.boundaries.top);
        this.layoutBoundary(this.boundaries.bottom);
        this.layoutPages();
    };

    // Sizes every page wrapper from the PDF's own per-page viewport (at
    // scale 1) against the reader's current content width, so proportions
    // are always the source PDF's, never guessed or forced square.
    Reader.prototype.layoutPages = function () {
        var width = this.frame.clientWidth;
        if (!width || !this.pageEntries.length) return;

        var y = 0;
        var changed = [];
        this.pageEntries.forEach(function (entry) {
            var scale = width / entry.naturalWidth;
            var displayHeight = entry.naturalHeight * scale;
            if (entry.displayScale !== scale && entry.rendered) changed.push(entry);
            entry.el.style.width = width + 'px';
            entry.el.style.height = displayHeight + 'px';
            entry.displayScale = scale;
            entry.top = y;
            y += displayHeight;
            if (entry !== this.pageEntries[this.pageEntries.length - 1]) {
                // The gap between pages is the CSS margin-bottom on
                // .pdf-page (components.css); read it back so the stack
                // height used for maxOffset matches what's really laid out.
                entry.gap = parseFloat(window.getComputedStyle(entry.el).marginBottom) || 0;
                y += entry.gap;
            }
        }, this);

        this.stackHeight = y;
        this.maxOffset = Math.max(0, this.stackHeight - this.windowH);
        this.setOffset(this.offset, true); // re-clamp without animating
        // Only pages whose scale actually changed need a new canvas.
        changed.forEach(function (entry) { this.scheduleRerender(entry); }, this);
    };

    // ---- scroll offset ----------------------------------------------------

    Reader.prototype.setOffset = function (next, skipClamp) {
        var clamped = skipClamp ? Math.max(0, Math.min(next, this.maxOffset)) :
            Math.max(0, Math.min(next, this.maxOffset));
        this.offset = clamped;
        this.pagesEl.style.transform = 'translateY(' + (-clamped) + 'px)';
        this.updateAria();
        return clamped;
    };

    Reader.prototype.updateAria = function () {
        var pct = this.maxOffset > 0 ? Math.round((this.offset / this.maxOffset) * 100) : 0;
        this.boundaries.top.hit.setAttribute('aria-valuenow', pct);
        this.boundaries.bottom.hit.setAttribute('aria-valuenow', pct);
    };

    // ---- pull interaction ---------------------------------------------------
    // Pointer handlers only record WHERE the pointer is (b.pull, b.targetX);
    // everything that moves — document, apex, spring — happens in tick().

    Reader.prototype.bindBoundary = function (b) {
        var self = this;
        var top = (b.side === 'top');

        function pointerDown(evt) {
            if (b.dragging) return;
            if (evt.pointerType === 'mouse' && evt.button !== 0) return;
            b.dragging = true;
            b.pointerId = evt.pointerId;
            b.grabY = evt.clientY;
            b.pull = 0;        // measured from the grab point, so grabbing never jumps the speed
            b.apexVel = 0;
            b.targetX = self.pointerToApexX(b, evt.clientX);
            try { b.hit.setPointerCapture(evt.pointerId); } catch (e) { /* ignore */ }
            self.ensureLoop();
            evt.preventDefault();
        }

        function pointerMove(evt) {
            if (!b.dragging || evt.pointerId !== b.pointerId) return;
            var dy = evt.clientY - b.grabY;
            // Top: moving UP pulls outward. Bottom: moving DOWN pulls outward.
            // Moving back past the grab point just returns to zero speed.
            b.pull = clamp(top ? -dy : dy, 0, MAX_PULL);
            b.targetX = self.pointerToApexX(b, evt.clientX);
        }

        // Release, cancel and lost capture all land here. Clearing
        // `dragging` is what stops the document: tick() only scrolls
        // while it is true.
        function pointerEnd(evt) {
            if (!b.dragging || evt.pointerId !== b.pointerId) return;
            b.dragging = false;
            b.pull = 0;
            b.pointerId = null;
            try { b.hit.releasePointerCapture(evt.pointerId); } catch (e) { /* ignore */ }
            if (reducedMotion) {
                // No multi-frame animation: snap flat.
                b.apex = 0; b.apexVel = 0; b.apexX = b.width / 2;
                self.drawBoundary(b);
            } else {
                self.ensureLoop();
            }
        }

        b.hit.addEventListener('pointerdown', pointerDown);
        b.hit.addEventListener('pointermove', pointerMove);
        b.hit.addEventListener('pointerup', pointerEnd);
        b.hit.addEventListener('pointercancel', pointerEnd);
        b.hit.addEventListener('lostpointercapture', pointerEnd);
        // touch-action:none (CSS) plus this stops the one case CSS can't:
        // a drag that started on the hitbox selecting page text as it
        // crosses over the PDF content underneath.
        b.hit.addEventListener('dragstart', function (e) { e.preventDefault(); });

        b.hit.addEventListener('keydown', function (evt) {
            var deltaKey = top ? 'ArrowUp' : 'ArrowDown';
            var oppositeKey = top ? 'ArrowDown' : 'ArrowUp';
            if (evt.key !== deltaKey && evt.key !== oppositeKey) return;
            evt.preventDefault();
            var dir = (evt.key === deltaKey) ? 1 : -1;
            var current = self.offset;
            var target = top ? current - dir * KEY_STEP : current + dir * KEY_STEP;
            self.setOffset(target);
            if (!reducedMotion) {
                b.apex = Math.min(MAX_PULL, KEY_STEP * 0.5);
                b.apexX = b.width / 2;
                b.apexVel = 0;
                self.drawBoundary(b);
                self.ensureLoop();
            }
        });
    };

    Reader.prototype.pointerToApexX = function (b, clientX) {
        var rect = this.frame.getBoundingClientRect();
        return clamp(clientX - rect.left, rect.width * APEX_X_MIN, rect.width * APEX_X_MAX);
    };

    // Pull (0..1) -> document speed in px/s.
    function pullToSpeed(pull) {
        return MAX_SPEED * Math.pow(clamp(pull / MAX_PULL, 0, 1), SPEED_EXPONENT);
    }

    // Soft cap on the tent when the document can't move that way any
    // more: slope 1 at 0 (no kink), asymptote EDGE_MAX.
    function edgeResist(pull) {
        return EDGE_MAX * (1 - Math.exp(-pull / EDGE_MAX));
    }

    // One frame for one boundary. Returns true while it still needs frames.
    Reader.prototype.stepBoundary = function (b, dt) {
        var top = (b.side === 'top');

        if (b.dragging) {
            // 1) Document: velocity from the CURRENT pull, integrated over
            //    real elapsed time. Runs every frame whether or not the
            //    pointer moves, so holding still keeps scrolling.
            var speed = pullToSpeed(b.pull);
            if (speed > 0) this.setOffset(this.offset + (top ? -1 : 1) * speed * dt);

            // 2) Display: the tent follows the pull, but shrinks to a
            //    small rubber-band once the document has hit this end.
            var atLimit = top ? this.offset <= 0 : this.offset >= this.maxOffset;
            var desired = atLimit ? edgeResist(b.pull) : b.pull;
            var k = 1 - Math.exp(-FOLLOW_RATE * dt); // smoothing hides the step when the end is reached
            b.apex += (desired - b.apex) * k;
            b.apexX += (b.targetX - b.apexX) * k;
            this.drawBoundary(b);
            return true;
        }

        // Released: spring only. Nothing in this branch touches the offset.
        if (b.apex === 0 && b.apexVel === 0 && b.apexX === b.width / 2) return false; // idle: skip redundant DOM writes
        b.acc += dt;
        var settled = false;
        while (b.acc >= STEP && !settled) {
            b.acc -= STEP;
            b.apexVel = (b.apexVel + STIFFNESS * (0 - b.apex)) * DAMPING;
            b.apex += b.apexVel;
            if (b.apex < 0) b.apex = 0;
            b.apexX += (b.width / 2 - b.apexX) * X_RETURN;
            settled = Math.abs(b.apex) < SETTLE_EPSILON && Math.abs(b.apexVel) < SETTLE_EPSILON;
        }
        if (b.apex === 0 && b.apexVel === 0) settled = true; // already flat (e.g. reduced-motion release)
        if (settled) { b.apex = 0; b.apexVel = 0; b.apexX = b.width / 2; b.acc = 0; }
        this.drawBoundary(b);
        return !settled;
    };

    // Single rAF loop for the reader; it sleeps whenever both boundaries
    // are at rest. dt is clamped so a backgrounded tab can't teleport the
    // document when it wakes up.
    Reader.prototype.ensureLoop = function () {
        var self = this;
        if (this.loopRaf !== null) return;
        this.lastTime = null;

        function frame(now) {
            var dt = (self.lastTime === null) ? 0 : Math.min((now - self.lastTime) / 1000, 0.05);
            self.lastTime = now;
            var topActive = self.stepBoundary(self.boundaries.top, dt);
            var bottomActive = self.stepBoundary(self.boundaries.bottom, dt);
            self.loopRaf = (topActive || bottomActive) ? window.requestAnimationFrame(frame) : null;
        }
        this.loopRaf = window.requestAnimationFrame(frame);
    };

    // ---- PDF.js wiring ----------------------------------------------------

    Reader.prototype.setStatus = function (text) {
        if (this.statusEl) this.statusEl.textContent = text;
    };

    Reader.prototype.init = function () {
        var self = this;
        if (!this.src || !window.IntersectionObserver) {
            this.setStatus('This document can\u2019t be displayed here.');
            return;
        }

        this.bindBoundary(this.boundaries.top);
        this.bindBoundary(this.boundaries.bottom);

        import(baseurl() + '/assets/js/pdfjs/pdf.mjs').then(function (pdfjsLib) {
            self.pdfjsLib = pdfjsLib;
            pdfjsLib.GlobalWorkerOptions.workerSrc = baseurl() + '/assets/js/pdfjs/pdf.worker.mjs';
            // PDF.js 6 requires a params object; a bare URL string is rejected.
            return pdfjsLib.getDocument({ url: self.src }).promise;
        }).then(function (pdf) {
            self.pdf = pdf;
            return self.buildPageShells();
        }).then(function () {
            self.setStatus('');
            self.layout();
            self.observeLazyRendering();
            self.observeResize();
        }).catch(function (err) {
            self.setStatus('This document couldn\u2019t be loaded.');
            // eslint-disable-next-line no-console
            console.error('[pdf-viewer]', err);
        });
    };

    // Creates one placeholder + canvas per page up front (so layout and
    // the elastic viewport have a real stack height to work with
    // immediately), but defers actual page.render() to IntersectionObserver.
    Reader.prototype.buildPageShells = function () {
        var self = this;
        var count = this.pdf.numPages;
        var promises = [];

        for (var i = 1; i <= count; i++) {
            promises.push(this.pdf.getPage(i).then(function (page) {
                var viewport = page.getViewport({ scale: 1 });
                var wrap = document.createElement('div');
                wrap.className = 'pdf-page';
                wrap.setAttribute('data-page-number', page.pageNumber);

                var canvas = document.createElement('canvas');
                wrap.appendChild(canvas);

                self.pagesEl.appendChild(wrap);

                self.pageEntries[page.pageNumber - 1] = {
                    el: wrap,
                    canvas: canvas,
                    page: page,
                    pageNumber: page.pageNumber,
                    naturalWidth: viewport.width,
                    naturalHeight: viewport.height,
                    gap: 0, // set via CSS margin instead — see components.css .pdf-page
                    rendered: false,
                    renderTask: null
                };
            }));
        }
        return Promise.all(promises);
    };

    Reader.prototype.observeLazyRendering = function () {
        var self = this;
        var observer = new IntersectionObserver(function (entries) {
            entries.forEach(function (ioEntry) {
                var pageNumber = parseInt(ioEntry.target.getAttribute('data-page-number'), 10);
                var entry = self.pageEntries[pageNumber - 1];
                if (!entry) return;
                if (!ioEntry.isIntersecting) {
                    if (entry.rendered) self.releasePage(entry);
                    return;
                }
                if (!entry.rendered) self.renderPage(entry);
            });
        }, { root: this.viewport, rootMargin: RENDER_MARGIN });

        this.pageEntries.forEach(function (entry) { observer.observe(entry.el); });
        this.observer = observer;
    };

    Reader.prototype.renderPage = function (entry) {
        var dpr = Math.min(window.devicePixelRatio || 1, BASE_SCALE_CAP);
        var scale = (entry.displayScale || 1) * dpr;
        var viewport = entry.page.getViewport({ scale: scale });
        // A fresh canvas per render: a canceled PDF.js render can still be
        // winding down on the old canvas, and reusing one canvas for two
        // render() calls at once is not allowed.
        var canvas = document.createElement('canvas');
        var ctx = canvas.getContext('2d');
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        entry.el.replaceChild(canvas, entry.canvas);
        entry.canvas = canvas;

        entry.rendered = true;
        var task = entry.page.render({ canvasContext: ctx, viewport: viewport });
        entry.renderTask = task;
        task.promise.catch(function (err) {
            // Cancellation (resize / page released) is expected, not an error.
            if (err && err.name === 'RenderingCancelledException') return;
            // eslint-disable-next-line no-console
            console.error('[pdf-viewer] page ' + entry.pageNumber, err);
        });

        // Text layer — selectable/searchable/accessible text over the
        // canvas. Guarded: PDF.js's text-layer entry point has moved
        // across major versions, so this degrades to canvas-only (still
        // fully functional, just not selectable) rather than throwing if
        // the installed build doesn't expose TextLayer as expected.
        if (this.pdfjsLib.TextLayer && entry.page.streamTextContent) {
            var textLayerDiv = document.createElement('div');
            textLayerDiv.className = 'pdf-page-text-layer';
            // PDF.js 6 sizes the layer and every span with calc() against
            // this custom property (normally set by its own pdf_viewer.css
            // wrapper, which this site doesn't ship). CSS px per PDF unit.
            textLayerDiv.style.setProperty('--total-scale-factor', entry.displayScale || 1);
            entry.el.appendChild(textLayerDiv);
            try {
                var textLayer = new this.pdfjsLib.TextLayer({
                    textContentSource: entry.page.streamTextContent(),
                    container: textLayerDiv,
                    viewport: entry.page.getViewport({ scale: entry.displayScale || 1 })
                });
                textLayer.render().catch(function () { /* text is best-effort */ });
            } catch (e) {
                textLayerDiv.remove();
            }
        }
    };

    // Re-renders an already-rendered page's canvas at a new scale (e.g.
    // after a resize). Cancels any in-flight render first.
    Reader.prototype.scheduleRerender = function (entry) {
        if (entry.renderTask && entry.renderTask.cancel) {
            try { entry.renderTask.cancel(); } catch (e) { /* ignore */ }
        }
        entry.rendered = false;
        var textLayer = entry.el.querySelector('.pdf-page-text-layer');
        if (textLayer) textLayer.remove();
        this.renderPage(entry);
    };

    // Frees a page that has scrolled well outside RENDER_MARGIN: cancels
    // any in-flight render and zeroes the canvas so its pixel buffer can
    // be reclaimed. The page shell keeps its size, so layout is unchanged.
    Reader.prototype.releasePage = function (entry) {
        if (entry.renderTask && entry.renderTask.cancel) {
            try { entry.renderTask.cancel(); } catch (e) { /* ignore */ }
        }
        entry.renderTask = null;
        entry.rendered = false;
        entry.canvas.width = 0;
        entry.canvas.height = 0;
        var textLayer = entry.el.querySelector('.pdf-page-text-layer');
        if (textLayer) textLayer.remove();
    };

    Reader.prototype.observeResize = function () {
        var self = this;
        if (!window.ResizeObserver) {
            window.addEventListener('resize', function () { self.scheduleLayout(); });
            return;
        }
        var ro = new ResizeObserver(function () { self.scheduleLayout(); });
        ro.observe(this.frame);
        this.resizeObserver = ro;
    };

    Reader.prototype.scheduleLayout = function () {
        var self = this;
        if (this.resizeRaf) return;
        this.resizeRaf = window.requestAnimationFrame(function () {
            self.resizeRaf = null;
            self.layout();
        });
    };

    // ---- bootstrap ----------------------------------------------------------

    function init() {
        var roots = document.querySelectorAll('[data-pdf-reader]');
        if (!roots.length) return;
        roots.forEach(function (root) { new Reader(root).init(); });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();