// ============================================
// SHRIMPLINES — ABOUT PAGE HOOK
// ============================================
// Wires up the four-node constellation click behavior and starts/stops
// the Game of Life banner (game-of-life.js) whenever the About fragment
// is loaded or unloaded by the router.
//
// This listens for a "shrimplines:content-loaded" custom event dispatched
// by main.js after it injects fetched content into #content-area. It does
// not modify routing, scrolling, or nav behavior in any way — it only
// reacts to content already having been swapped in.

(function () {
    function initNodes(root) {
        var nodes = root.querySelectorAll('.about-node');
        var panels = root.querySelectorAll('.about-node-panel');

        nodes.forEach(function (btn) {
            btn.addEventListener('click', function () {
                var target = btn.dataset.node;

                nodes.forEach(function (n) {
                    n.classList.toggle('active', n === btn);
                });
                panels.forEach(function (p) {
                    p.classList.toggle('active', p.dataset.panel === target);
                });
            });
        });
    }

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

        var root = document.querySelector('.about-page');
        if (!root) return;

        initNodes(root);

        var canvas = document.getElementById('gol-canvas');
        if (canvas && window.ShrimplinesGOL) {
            window.ShrimplinesGOL.init(canvas);
        }
    });
})();