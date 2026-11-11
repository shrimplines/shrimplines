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
// BOUNDARY PHYSICS — deliberately a simpler relative of divider.js's
// guitar-string chain, not a reuse of it: a boundary here is a single
// moving point (the apex), not an 18-point chain, because the shape
// is one triangle, not a continuous curve. Resting state is just
// "apex at baseline"; dragging drives the apex straight to the
// pointer (kinematic, like divider.js's grabbed point); release hands
// it to the same kind of snapshot-based spring step divider.js uses
// (read every value from the previous frame, then swap in all at
// once) so a single point can't develop the kind of in-place-mutation
// drift divider.js's own comments warn about.
//
// SCROLL MODEL — the boundaries, not a scrollbar, are the only way to
// move through the document. Internally this is one number,
// `state.offset` (px into the full stacked-page height), applied as
// `translateY(-offset)` on .pdf-reader-pages. Dragging the top
// boundary decreases it (reveals earlier content); dragging the
// bottom boundary increases it (reveals later content). The viewport
// itself is `overflow:hidden`, so there is no second scroll
// mechanism to keep in sync with it, and nothing here ever touches
// `.content-area`'s own scrolling.
(function () {
    var MAX_PULL = 56;            // px clamp on the TRIANGLE's visible depth (not on scroll distance)
    var STIFFNESS = 0.3;          // spring pull toward baseline (apex-only, so gentler than divider.js's chain)
    var DAMPING = 0.78;
    var SETTLE_EPSILON = 0.05;
    var KEY_STEP = 72;            // px per arrow-key press
    var RENDER_MARGIN = '200% 0px'; // IntersectionObserver rootMargin — render pages before they're visible
    var BASE_SCALE_CAP = 2;       // hard ceiling on devicePixelRatio-driven canvas scale, for memory's sake

    var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function baseurl() {
        return (document.body && document.body.dataset.baseurl) || '';
    }

    // ---- one reader instance ------------------------------------------------

    function Reader(root) {
        this.root = root;
        this.frame = root.querySelector('.pdf-reader-frame');
        this.viewport = root.querySelector('[data-pdf-viewport]');
        this.pagesEl = root.querySelector('[data-pdf-pages]');
        this.statusEl = root.querySelector('[data-pdf-status]');
        this.src = root.dataset.pdfSrc;
        this.boundaries = {
            top: this.makeBoundary('top'),
            bottom: this.makeBoundary('bottom')
        };

        this.offset = 0;      // current scroll position, px into the full page stack
        this.maxOffset = 0;   // full stack height minus viewport height, once known
        this.pdf = null;
        this.pageEntries = []; // { el, canvas, pageNumber, naturalWidth, naturalHeight, rendered, renderTask }
        this.resizeRaf = null;

        this.boundInit = this.init.bind(this);
    }

    Reader.prototype.makeBoundary = function (side) {
        var svg = this.root.querySelector('svg[data-pdf-boundary="' + side + '"]');
        var path = svg.querySelector('[data-pdf-boundary-path]');
        var hit = this.root.querySelector('[data-pdf-hit="' + side + '"]');
        return {
            side: side,
            svg: svg,
            path: path,
            hit: hit,
            width: 0,
            apex: 0,       // current rendered displacement, px (always >=0; direction is implied by side)
            velocity: 0,
            dragging: false,
            dragStartPointerY: 0,
            dragStartOffset: 0,
            rafId: null
        };
    };

    // ---- layout ---------------------------------------------------------------

    Reader.prototype.layoutBoundary = function (b) {
        var rect = this.frame.getBoundingClientRect();
        var w = rect.width;
        var h = MAX_PULL + 8; // resting line + full travel + a hair of margin
        var dpr = window.devicePixelRatio || 1;

        b.width = w;
        b.svg.setAttribute('width', w);
        b.svg.setAttribute('height', h);
        b.svg.style.width = w + 'px';
        b.svg.style.height = h + 'px';
        // viewBox in CSS px keeps the path math below free of DPR concerns;
        // the svg's own width/height attrs (not viewBox) are what control
        // on-screen size, so this does not stretch the stroke.
        b.svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
        this.drawBoundary(b);
    };

    // Path geometry: two anchored corners + one apex that moves away from
    // the PDF rectangle. Top boundary's SVG sits ABOVE the viewport with
    // its baseline at the SVG's own bottom edge, apex moving further up
    // (smaller y) as it's pulled — so the fill (between baseline and apex)
    // is always on the screen-edge side, never over the viewport. Bottom
    // boundary mirrors this with its baseline at the SVG's top edge.
    Reader.prototype.drawBoundary = function (b) {
        var w = b.width;
        var restY = (b.side === 'top') ? (MAX_PULL + 8) : 0;
        var apexY = (b.side === 'top') ? (restY - b.apex) : (restY + b.apex);
        var midX = w / 2;

        var d = 'M0,' + restY +
            ' L' + midX + ',' + apexY +
            ' L' + w + ',' + restY +
            ' Z';
        b.path.setAttribute('d', d);
    };

    Reader.prototype.layout = function () {
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
        this.pageEntries.forEach(function (entry) {
            var scale = width / entry.naturalWidth;
            var displayHeight = entry.naturalHeight * scale;
            entry.el.style.width = width + 'px';
            entry.el.style.height = displayHeight + 'px';
            entry.displayScale = scale;
            entry.top = y;
            y += displayHeight;
            if (entry !== this.pageEntries[this.pageEntries.length - 1]) {
                y += entry.gap;
            }
        }, this);

        this.stackHeight = y;
        this.maxOffset = Math.max(0, this.stackHeight - this.viewport.clientHeight);
        this.setOffset(this.offset, true); // re-clamp without animating
        this.pageEntries.forEach(function (entry) {
            if (entry.rendered) this.scheduleRerender(entry);
        }, this);
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

    // ---- drag interaction ---------------------------------------------------

    Reader.prototype.bindBoundary = function (b) {
        var self = this;

        function pointerDown(evt) {
            b.dragging = true;
            b.dragStartPointerY = evt.clientY;
            b.dragStartOffset = self.offset;
            try { b.hit.setPointerCapture(evt.pointerId); } catch (e) { /* ignore */ }
            self.ensureSpringLoop(b);
            evt.preventDefault();
        }

        function pointerMove(evt) {
            if (!b.dragging) return;
            var dy = evt.clientY - b.dragStartPointerY;
            // Top: dragging UP (negative dy) reveals earlier content.
            // Bottom: dragging DOWN (positive dy) reveals later content.
            var reveal = (b.side === 'top') ? -dy : dy;
            if (reveal < 0) reveal = 0; // a boundary only ever pulls outward, never inverts
            self.setOffset((b.side === 'top') ?
                b.dragStartOffset - reveal :
                b.dragStartOffset + reveal);
            b.apex = Math.min(MAX_PULL, reveal);
            self.drawBoundary(b);
        }

        function pointerUp(evt) {
            if (!b.dragging) return;
            b.dragging = false;
            try { b.hit.releasePointerCapture(evt.pointerId); } catch (e) { /* ignore */ }
            self.ensureSpringLoop(b); // let it settle back to 0
        }

        b.hit.addEventListener('pointerdown', pointerDown);
        b.hit.addEventListener('pointermove', pointerMove);
        b.hit.addEventListener('pointerup', pointerUp);
        b.hit.addEventListener('pointercancel', pointerUp);
        // touch-action:none (CSS) plus this stops the one case CSS can't:
        // a drag that started on the hitbox selecting page text as it
        // crosses over the PDF content underneath.
        b.hit.addEventListener('dragstart', function (e) { e.preventDefault(); });

        b.hit.addEventListener('keydown', function (evt) {
            var deltaKey = (b.side === 'top') ? 'ArrowUp' : 'ArrowDown';
            var oppositeKey = (b.side === 'top') ? 'ArrowDown' : 'ArrowUp';
            if (evt.key !== deltaKey && evt.key !== oppositeKey) return;
            evt.preventDefault();
            var dir = (evt.key === deltaKey) ? 1 : -1;
            var current = self.offset;
            var target = (b.side === 'top') ? current - dir * KEY_STEP : current + dir * KEY_STEP;
            self.setOffset(target);
            if (!reducedMotion) {
                b.apex = Math.min(MAX_PULL, KEY_STEP * 0.5);
                self.drawBoundary(b);
                self.ensureSpringLoop(b);
            }
        });
    };

    // One spring step, snapshot style (matches divider.js's own note on
    // why in-place mutation during the loop is unsafe — not applicable
    // here with only one point, but the same discipline is kept).
    Reader.prototype.springStep = function (b) {
        if (b.dragging) return false;
        var force = STIFFNESS * (0 - b.apex);
        b.velocity = (b.velocity + force) * DAMPING;
        b.apex = b.apex + b.velocity;
        if (b.apex < 0) b.apex = 0;
        var settled = Math.abs(b.apex) < SETTLE_EPSILON && Math.abs(b.velocity) < SETTLE_EPSILON;
        if (settled) { b.apex = 0; b.velocity = 0; }
        this.drawBoundary(b);
        return settled;
    };

    Reader.prototype.ensureSpringLoop = function (b) {
        var self = this;
        if (b.rafId !== null) return;

        if (reducedMotion) {
            // No multi-frame animation: resolve immediately to the resting
            // (or, mid-drag, current) shape instead of easing toward it.
            if (!b.dragging) { b.apex = 0; b.velocity = 0; this.drawBoundary(b); }
            return;
        }

        function loop() {
            var settled = self.springStep(b);
            if (!b.dragging && settled) { b.rafId = null; return; }
            b.rafId = window.requestAnimationFrame(loop);
        }
        b.rafId = window.requestAnimationFrame(loop);
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
            return pdfjsLib.getDocument(self.src).promise;
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
                if (!ioEntry.isIntersecting) return;
                var pageNumber = parseInt(ioEntry.target.getAttribute('data-page-number'), 10);
                var entry = self.pageEntries[pageNumber - 1];
                if (entry && !entry.rendered) self.renderPage(entry);
            });
        }, { root: this.viewport, rootMargin: RENDER_MARGIN });

        this.pageEntries.forEach(function (entry) { observer.observe(entry.el); });
        this.observer = observer;
    };

    Reader.prototype.renderPage = function (entry) {
        var dpr = Math.min(window.devicePixelRatio || 1, BASE_SCALE_CAP);
        var scale = (entry.displayScale || 1) * dpr;
        var viewport = entry.page.getViewport({ scale: scale });
        var canvas = entry.canvas;
        var ctx = canvas.getContext('2d');

        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        canvas.style.width = '100%';
        canvas.style.height = '100%';

        entry.rendered = true;
        entry.renderTask = entry.page.render({ canvasContext: ctx, viewport: viewport });
        entry.renderTask.promise.then(function () {
            return entry.page.getTextContent ? entry.page.getTextContent() : null;
        }).catch(function () { /* rendering failure already surfaced via status */ });

        // Text layer — selectable/searchable/accessible text over the
        // canvas. Guarded: PDF.js's text-layer entry point has moved
        // across major versions, so this degrades to canvas-only (still
        // fully functional, just not selectable) rather than throwing if
        // the installed build doesn't expose TextLayer as expected.
        if (this.pdfjsLib.TextLayer && entry.page.streamTextContent) {
            var textLayerDiv = document.createElement('div');
            textLayerDiv.className = 'pdf-page-text-layer';
            entry.el.appendChild(textLayerDiv);
            try {
                var textLayer = new this.pdfjsLib.TextLayer({
                    textContentSource: entry.page.streamTextContent(),
                    container: textLayerDiv,
                    viewport: entry.page.getViewport({ scale: entry.displayScale || 1 })
                });
                textLayer.render();
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