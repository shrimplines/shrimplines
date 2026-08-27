// ============================================
// SHRIMPLINES — GAME OF LIFE BANNER
// ============================================
// A small, isolated Conway's Game of Life simulation for the skinny
// About-page banner. Exposes window.ShrimplinesGOL.init(canvas) and
// .stop() so it can be started/stopped by the About page hook without
// touching the router (main.js) or the highlight engine.
//
// The grid wraps left-right only (top/bottom are a hard edge). Testing
// showed wrapping vertically too made a short banner behave like a tiny,
// unstable cylinder that reliably dies out on narrow/mobile widths;
// horizontal-only wrap keeps the pattern alive across all tested widths
// and matches how a wide, skinny strip should visually read (drifting
// left/right, not looping top-to-bottom).

(function () {
    var CELL_SIZE = 9;      // px, at CSS pixel scale
    var TICK_MS = 500;      // one generation per ~500ms, per spec
    var ALIVE_ALPHA = 0.85;

    var state = {
        canvas: null,
        ctx: null,
        cols: 0,
        rows: 0,
        alive: null,           // Set of "x,y" keys
        timer: null,
        resizeObserver: null,
        colorAccent: '#306880', // fallback; overwritten from CSS tokens
        colorBorder: '#8a97a8'  // fallback; overwritten from CSS tokens
    };

    function key(x, y) {
        return x + ',' + y;
    }

    function readColors() {
        var styles = getComputedStyle(document.documentElement);
        var accent = (styles.getPropertyValue('--color-accent') || '').trim();
        var border = (styles.getPropertyValue('--color-border') || '').trim();
        if (accent) {
            state.colorAccent = accent;
        }
        if (border) {
            state.colorBorder = border;
        }
    }

    // Eight deliberately-chosen patterns spread across the width so the
    // banner reads as a small living system rather than a die-off: one
    // moving pattern (glider), three oscillators (blinker, toad, beacon),
    // three still lifes (block, beehive, tub), and one classic chaotic
    // "methuselah" pattern (R-pentomino) that takes a long time to settle.
    // Verified via simulation to survive 2000+ generations at every
    // tested banner width, from narrow mobile grids to wide desktop ones.
    function seedPattern(alive, cols, rows) {
        function place(cells, ox, oy) {
            cells.forEach(function (c) {
                var x = ((ox + c[0]) % cols + cols) % cols;
                var y = oy + c[1];
                if (y < 0 || y >= rows) return;
                alive.add(key(x, y));
            });
        }

        var glider  = [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]];
        var blinker = [[0, 0], [1, 0], [2, 0]];
        var toad    = [[1, 0], [2, 0], [3, 0], [0, 1], [1, 1], [2, 1]];
        var beacon  = [[0, 0], [1, 0], [0, 1], [3, 2], [2, 3], [3, 3]];
        var block   = [[0, 0], [1, 0], [0, 1], [1, 1]];
        var beehive = [[1, 0], [2, 0], [0, 1], [3, 1], [1, 2], [2, 2]];
        var rPent   = [[1, 0], [2, 0], [0, 1], [1, 1], [1, 2]];
        var tub     = [[1, 0], [0, 1], [2, 1], [1, 2]];

        var midRow = Math.max(0, Math.floor(rows / 2) - 1);
        var fractions = [0.06, 0.18, 0.30, 0.42, 0.54, 0.66, 0.78, 0.90];
        var patterns = [glider, blinker, toad, beacon, block, beehive, rPent, tub];

        patterns.forEach(function (pattern, i) {
            place(pattern, Math.round(cols * fractions[i]), midRow);
        });
    }

    function resize() {
        var canvas = state.canvas;
        if (!canvas) return;

        var dpr = window.devicePixelRatio || 1;
        var rect = canvas.getBoundingClientRect();
        var displayWidth = Math.max(1, Math.floor(rect.width));
        var displayHeight = Math.max(1, Math.floor(rect.height));

        canvas.width = Math.floor(displayWidth * dpr);
        canvas.height = Math.floor(displayHeight * dpr);
        state.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        var newCols = Math.max(1, Math.floor(displayWidth / CELL_SIZE));
        var newRows = Math.max(1, Math.floor(displayHeight / CELL_SIZE));

        if (newCols !== state.cols || newRows !== state.rows || !state.alive) {
            state.cols = newCols;
            state.rows = newRows;
            state.alive = new Set();
            seedPattern(state.alive, state.cols, state.rows);
        }

        render();
    }

    function countNeighbors(alive, x, y, cols, rows) {
        var count = 0;
        for (var dx = -1; dx <= 1; dx++) {
            for (var dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;
                var nx = (x + dx + cols) % cols;
                var ny = y + dy;
                if (ny < 0 || ny >= rows) continue;
                if (alive.has(key(nx, ny))) count++;
            }
        }
        return count;
    }

    function step() {
        if (!state.alive) return;
        var cols = state.cols;
        var rows = state.rows;

        // Only cells adjacent to a currently-alive cell can change state,
        // so we only need to evaluate that neighborhood each tick.
        var candidates = new Set();
        state.alive.forEach(function (k) {
            var parts = k.split(',');
            var x = parseInt(parts[0], 10);
            var y = parseInt(parts[1], 10);
            for (var dx = -1; dx <= 1; dx++) {
                for (var dy = -1; dy <= 1; dy++) {
                    var nx = (x + dx + cols) % cols;
                    var ny = y + dy;
                    if (ny < 0 || ny >= rows) continue;
                    candidates.add(key(nx, ny));
                }
            }
        });

        var next = new Set();
        candidates.forEach(function (k) {
            var parts = k.split(',');
            var x = parseInt(parts[0], 10);
            var y = parseInt(parts[1], 10);
            var n = countNeighbors(state.alive, x, y, cols, rows);
            var isAlive = state.alive.has(k);

            if (isAlive && (n === 2 || n === 3)) {
                next.add(k);
            } else if (!isAlive && n === 3) {
                next.add(k);
            }
        });

        state.alive = next;
    }

    function hexToRgba(hex, alpha) {
        var clean = String(hex).replace('#', '');
        if (clean.length === 3) {
            clean = clean.split('').map(function (c) { return c + c; }).join('');
        }
        var r = parseInt(clean.substring(0, 2), 16);
        var g = parseInt(clean.substring(2, 4), 16);
        var b = parseInt(clean.substring(4, 6), 16);
        if (isNaN(r) || isNaN(g) || isNaN(b)) return hex;
        return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
    }

    var GRID_ALPHA = 0.14;

    function drawGrid(ctx, width, height) {
        if (!state.cols || !state.rows) return;

        ctx.save();
        ctx.strokeStyle = hexToRgba(state.colorBorder, GRID_ALPHA);
        ctx.lineWidth = 1;
        ctx.beginPath();

        for (var gx = 0; gx <= state.cols; gx++) {
            var x = gx * CELL_SIZE + 0.5;
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
        }
        for (var gy = 0; gy <= state.rows; gy++) {
            var y = gy * CELL_SIZE + 0.5;
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
        }

        ctx.stroke();
        ctx.restore();
    }

    function render() {
        var ctx = state.ctx;
        if (!ctx || !state.canvas) return;

        var rect = state.canvas.getBoundingClientRect();
        ctx.clearRect(0, 0, rect.width, rect.height);

        if (!state.alive) return;

        drawGrid(ctx, rect.width, rect.height);

        ctx.fillStyle = hexToRgba(state.colorAccent, ALIVE_ALPHA);
        var pad = 1.5;

        state.alive.forEach(function (k) {
            var parts = k.split(',');
            var x = parseInt(parts[0], 10);
            var y = parseInt(parts[1], 10);
            ctx.fillRect(
                x * CELL_SIZE + pad,
                y * CELL_SIZE + pad,
                CELL_SIZE - pad * 2,
                CELL_SIZE - pad * 2
            );
        });
    }

    function tick() {
        step();
        render();
    }

    function handleClick(evt) {
        if (!state.canvas || !state.alive) return;

        var rect = state.canvas.getBoundingClientRect();
        var x = Math.floor((evt.clientX - rect.left) / CELL_SIZE);
        var y = Math.floor((evt.clientY - rect.top) / CELL_SIZE);
        if (x < 0 || y < 0 || x >= state.cols || y >= state.rows) return;

        var k = key(x, y);
        if (state.alive.has(k)) {
            state.alive.delete(k);
        } else {
            state.alive.add(k);
        }

        // Intentionally does NOT touch state.timer — the simulation
        // keeps running on its own 500ms cadence while edited.
        render();
    }

    function stop() {
        if (state.timer) {
            window.clearInterval(state.timer);
            state.timer = null;
        }
        if (state.resizeObserver) {
            state.resizeObserver.disconnect();
            state.resizeObserver = null;
        }
        if (state.canvas) {
            state.canvas.removeEventListener('click', handleClick);
        }
        state.canvas = null;
        state.ctx = null;
        state.alive = null;
        state.cols = 0;
        state.rows = 0;
    }

    function init(canvas) {
        if (!canvas) return;

        // Tear down any previous instance first (re-visiting the About
        // page loads a brand-new <canvas> element each time).
        stop();

        state.canvas = canvas;
        state.ctx = canvas.getContext('2d');
        readColors();
        resize();

        state.resizeObserver = new ResizeObserver(function () {
            resize();
        });
        state.resizeObserver.observe(canvas);

        canvas.addEventListener('click', handleClick);

        state.timer = window.setInterval(tick, TICK_MS);
    }

    window.ShrimplinesGOL = {
        init: init,
        stop: stop
    };
})();