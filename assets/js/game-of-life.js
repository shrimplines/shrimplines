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
    var CELL_SIZE = 6;      // px, at CSS pixel scale (was 9 — higher resolution)
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
        colorBorder: '#8a97a8', // fallback; overwritten from CSS tokens
        genCount: 0,            // ticks elapsed since last (re)seed, for replenishment timing
        stableStreak: 0,        // consecutive ticks with an unchanged population count
        lastPopSize: -1,
        lastReplenishTick: -Infinity
    };

    function key(x, y) {
        return x + ',' + y;
    }

    // Pattern catalog, hoisted to module scope so both the initial seed
    // and the replenishment mechanism (below) can draw from the same
    // definitions instead of maintaining two copies.
    var PATTERNS = {
        glider: [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]],
        blinker: [[0, 0], [1, 0], [2, 0]],
        toad: [[1, 0], [2, 0], [3, 0], [0, 1], [1, 1], [2, 1]],
        beacon: [[0, 0], [1, 0], [0, 1], [3, 2], [2, 3], [3, 3]],
        block: [[0, 0], [1, 0], [0, 1], [1, 1]],
        beehive: [[1, 0], [2, 0], [0, 1], [3, 1], [1, 2], [2, 2]],
        rPent: [[1, 0], [2, 0], [0, 1], [1, 1], [1, 2]],
        tub: [[1, 0], [0, 1], [2, 1], [1, 2]]
    };

    function placePattern(alive, cells, ox, oy, cols, rows) {
        cells.forEach(function (c) {
            var x = ((ox + c[0]) % cols + cols) % cols;
            var y = oy + c[1];
            if (y < 0 || y >= rows) return;
            alive.add(key(x, y));
        });
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

    // Deterministic, width-adaptive seeding: rather than a fixed set of
    // organisms, we give each organism a fixed "slot" of SLOT_COLS grid
    // columns and derive the starting count from how many slots fit the
    // available width. This keeps visual density roughly consistent
    // whether the banner is narrow (mobile) or very wide (desktop),
    // instead of stretching the same handful of patterns across more
    // space. Verified via simulation to survive 3000+ generations across
    // grid widths from 40 to 500+ columns and row counts from 6 to 8
    // (the range produced by a ~48px banner at 6px cells).
    var SLOT_COLS = 12;
    var SEED_DENSITY_MULTIPLIER = 5; // tunable: scales starting organism count.
    // Single source of truth for density —
    // verified against 240+/1000-generation
    // simulations at multiple banner widths
    // to confirm the population stabilizes
    // rather than dying out.
    var MIN_ORGANISMS = Math.round(4 * SEED_DENSITY_MULTIPLIER);
    var MAX_ORGANISMS = Math.round(32 * SEED_DENSITY_MULTIPLIER);

    function computeOrganismCount(cols) {
        var base = Math.floor(cols / SLOT_COLS);
        var count = Math.round(base * SEED_DENSITY_MULTIPLIER);
        return Math.max(MIN_ORGANISMS, Math.min(MAX_ORGANISMS, count));
    }

    // A 12-slot repeating cycle so pattern types stay varied (moving,
    // oscillators, still lifes). Rebalanced from the original 10-slot
    // cycle: still lifes (block/beehive/tub) reduced from 3/10 to 3/12,
    // and the chaotic R-pentomino doubled (1/10 -> 2/12), since testing
    // showed still-life-heavy seeds settle into a fixed population count
    // almost immediately on narrow/normal banner widths.
    var patternCycle = [
        'glider', 'blinker', 'toad', 'rPent', 'beehive', 'beacon',
        'glider', 'blinker', 'toad', 'block', 'rPent', 'tub'
    ];

    function seedPattern(alive, cols, rows) {
        // Three anchor rows spread through the available height so
        // organisms aren't all placed on a single row — more useful now
        // that smaller cells give the banner more rows to work with.
        var rowAnchors = [
            Math.max(0, Math.floor(rows * 0.25) - 1),
            Math.max(0, Math.floor(rows * 0.5) - 1),
            Math.max(0, Math.floor(rows * 0.7) - 1)
        ];

        var count = computeOrganismCount(cols);

        for (var i = 0; i < count; i++) {
            var pattern = PATTERNS[patternCycle[i % patternCycle.length]];
            // Edge-to-edge anchoring: i=0 lands at the left boundary and
            // i=count-1 lands at the right boundary, with the rest spread
            // evenly between (rather than centered with margins on both
            // sides). Falls back to the midpoint for a single organism.
            var ox = count > 1
                ? Math.round((i / (count - 1)) * (cols - 1))
                : Math.round(cols / 2);
            var oy = rowAnchors[i % rowAnchors.length];
            placePattern(alive, pattern, ox, oy, cols, rows);
        }
    }

    // ------------------------------------------------------------
    // Replenishment
    // ------------------------------------------------------------
    // The banner is only 6-8 rows tall with a hard (non-wrapping)
    // top/bottom edge, so gliders — the only truly traveling pattern —
    // die against that edge quickly. On narrow/normal widths, what's
    // left settles into a fixed set of still lifes and period-2
    // oscillators within a couple hundred generations and then just
    // cycles in place forever with an unchanging population count.
    //
    // This introduces a single small organism, but only once the board
    // has actually gone stale (population count unchanged for
    // STALE_WINDOW ticks) and not more often than every
    // REPLENISH_COOLDOWN ticks — so it reads as an occasional
    // environmental disturbance, not a respawn timer. It only ever
    // places into empty space, so it never destroys existing structures.
    var STALE_WINDOW = 40;        // ticks of unchanged population before considered stale
    var REPLENISH_COOLDOWN = 90;  // min ticks between replenishments
    var REPLENISH_PATTERNS = ['rPent', 'glider', 'toad'];

    function findEmptyPatch(alive, cols, rows) {
        for (var attempt = 0; attempt < 12; attempt++) {
            var ox = Math.floor(Math.random() * cols);
            var oy = Math.floor(Math.random() * Math.max(1, rows - 3));
            var clear = true;
            for (var dx = -1; dx <= 4 && clear; dx++) {
                for (var dy = -1; dy <= 4 && clear; dy++) {
                    var nx = ((ox + dx) % cols + cols) % cols;
                    var ny = oy + dy;
                    if (ny < 0 || ny >= rows) continue;
                    if (alive.has(key(nx, ny))) clear = false;
                }
            }
            if (clear) return { ox: ox, oy: oy };
        }
        return null; // no clear patch found this attempt; try again later
    }

    function maybeReplenish() {
        var alive = state.alive;
        if (!alive) return;

        if (alive.size === state.lastPopSize) {
            state.stableStreak++;
        } else {
            state.stableStreak = 0;
        }
        state.lastPopSize = alive.size;

        var ticksSinceReplenish = state.genCount - state.lastReplenishTick;
        if (state.stableStreak >= STALE_WINDOW && ticksSinceReplenish >= REPLENISH_COOLDOWN) {
            var patch = findEmptyPatch(alive, state.cols, state.rows);
            if (patch) {
                var name = REPLENISH_PATTERNS[Math.floor(Math.random() * REPLENISH_PATTERNS.length)];
                placePattern(alive, PATTERNS[name], patch.ox, patch.oy, state.cols, state.rows);
                state.lastReplenishTick = state.genCount;
                state.stableStreak = 0;
            }
        }
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
            // Fresh grid dimensions invalidate replenishment timing —
            // reset so a fresh seed isn't immediately judged "stale".
            state.genCount = 0;
            state.stableStreak = 0;
            state.lastPopSize = -1;
            state.lastReplenishTick = -Infinity;
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
        state.genCount++;
        maybeReplenish();
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
        state.genCount = 0;
        state.stableStreak = 0;
        state.lastPopSize = -1;
        state.lastReplenishTick = -Infinity;
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