// ============================================
// SHRIMPLINES — ABOUT PAGE HOOK
// ============================================
// Starts/stops the Game of Life banner (game-of-life.js) whenever the
// About fragment is loaded or unloaded by the router.
//
// This listens for a "shrimplines:content-loaded" custom event dispatched
// by main.js after it injects fetched content into #content-area. It does
// not modify routing, scrolling, or nav behavior in any way — it only
// reacts to content already having been swapped in.
//
// The four-node interaction that previously lived here has been removed;
// the About page no longer has node/panel switching.

(function () {
    document.addEventListener('shrimplines:content-loaded', function (evt) {
        var section = evt.detail && evt.detail.section;

        // Leaving the About page: stop the simulation so it doesn't keep
        // ticking against a detached canvas after navigation.
        if (section !== 'about') {
            if (window.ShrimplinesGOL) {
                window.ShrimplinesGOL.stop();
            }
            return;
        }

        var canvas = document.getElementById('gol-canvas');
        if (canvas && window.ShrimplinesGOL) {
            window.ShrimplinesGOL.init(canvas);
        }
    });
})();