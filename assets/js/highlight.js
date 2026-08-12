// ============================================
// SHRIMPLINES — MARKER SELECTION ENGINE
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    const textWrapper = document.querySelector('.text-wrapper');
    const textContainer = document.querySelector('.content-area') || textWrapper;
    const canvas = document.querySelector('.highlight-canvas');

    if (!textWrapper || !canvas) return;

    const ctx = canvas.getContext('2d');
    let selectionRects = [];
    let renderPending = false;

    const OFFSET_X = 0;
    const OFFSET_Y = 0;

    // --------------------------------------------
    // DYNAMIC RESIZING & RESIDUE PREVENTION
    // --------------------------------------------
    function syncCanvasDimensions() {
        const dpr = window.devicePixelRatio || 1;
        const rect = textWrapper.getBoundingClientRect();

        const newWidth = Math.floor(rect.width * dpr);
        const newHeight = Math.floor(rect.height * dpr);

        if (canvas.width !== newWidth || canvas.height !== newHeight) {
            canvas.width = newWidth;
            canvas.height = newHeight;
        }

        // Reset transform & scale for crisp high-DPI rendering
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        renderSelection();
    }

    const resizeObserver = new ResizeObserver(() => syncCanvasDimensions());
    resizeObserver.observe(textWrapper);

    // --------------------------------------------
    // NOISE & WOBBLE HELPERS
    // --------------------------------------------
    function getAbsoluteNoise(x, y, salt = 1) {
        const sin = Math.sin(x * 12.9898 + y * 78.233 + salt * 43758.5453);
        return (sin - Math.floor(sin)) - 0.5;
    }

    function getWobble(x, lineSeed, frequency) {
        return Math.sin(x / 12 + lineSeed) * Math.cos(x / frequency);
    }

    // --------------------------------------------
    // EVENT LISTENERS
    // --------------------------------------------
    function scheduleRender() {
        if (!renderPending) {
            renderPending = true;
            requestAnimationFrame(() => {
                updateActiveSelection();
                renderPending = false;
            });
        }
    }

    document.addEventListener('selectionchange', scheduleRender);
    if (textContainer) {
        textContainer.addEventListener('scroll', scheduleRender, { passive: true });
    }
    window.addEventListener('resize', scheduleRender, { passive: true });

    // --------------------------------------------
    // SELECTION CALCULATION
    // --------------------------------------------
    function updateActiveSelection() {
        const selection = window.getSelection();

        if (selection.isCollapsed || !selection.rangeCount) {
            selectionRects = [];
            renderSelection();
            return;
        }

        const range = selection.getRangeAt(0);
        if (!textWrapper.contains(range.commonAncestorContainer)) {
            selectionRects = [];
            renderSelection();
            return;
        }

        selectionRects = getRangeRects(range);
        renderSelection();
    }

    function getRangeRects(range) {
        const wrapperRect = textWrapper.getBoundingClientRect();
        const clientRects = Array.from(range.getClientRects());
        const maxSingleLineHeight = 44;

        const validRects = clientRects
            .filter(r => r.width > 6 && r.height > 6 && r.height <= maxSingleLineHeight)
            .map(r => ({
                left: r.left - wrapperRect.left,
                top: r.top - wrapperRect.top,
                width: r.width,
                height: r.height
            }));

        validRects.sort((a, b) => (a.top - b.top) || (a.left - b.left));

        const mergedRects = [];
        validRects.forEach(rect => {
            if (mergedRects.length === 0) {
                mergedRects.push({ ...rect });
            } else {
                const last = mergedRects[mergedRects.length - 1];
                if (Math.abs(last.top - rect.top) < 6 && Math.abs(last.height - rect.height) < 6) {
                    const newLeft = Math.min(last.left, rect.left);
                    const newRight = Math.max(last.left + last.width, rect.left + rect.width);
                    last.left = newLeft;
                    last.width = newRight - newLeft;
                } else {
                    mergedRects.push({ ...rect });
                }
            }
        });

        return mergedRects;
    }

    // --------------------------------------------
    // CLEAR & RENDER LOOP (PREVENTS RESIDUE)
    // --------------------------------------------
    function renderSelection() {
        const dpr = window.devicePixelRatio || 1;

        // Hard clear full pixel buffer to eliminate all ghosting residue
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.restore();

        selectionRects.forEach((rect, index) => {
            drawSelectionStroke(rect, index);
        });
    }

    // --------------------------------------------
    // EXACT ORIGINAL MARKER STROKE ALGORITHM
    // --------------------------------------------
    function drawSelectionStroke(rect, lineIndex) {
        const lineSeed = Math.round(rect.top) * 17 + lineIndex * 131;

        const x = rect.left + OFFSET_X;
        const y = rect.top + OFFSET_Y;
        const w = rect.width;
        const totalH = rect.height;

        if (w <= 2) return;

        const strokeHeight = totalH * 1.38;
        const strokeY = y + (totalH - strokeHeight) / 2 - 2;

        const slantFactor = 0.28 + (getAbsoluteNoise(lineSeed, lineSeed, 3) + 0.5) * 0.05;
        const slant = strokeHeight * slantFactor;
        const radius = 4.0;

        const smidgeLeft = 2.5 + (getAbsoluteNoise(x, lineSeed, 1) + 0.5) * 1.0;
        const strokeXLeft = x - slant - smidgeLeft;

        const padXRight = 2.5 + (getAbsoluteNoise(x + w, lineSeed, 2) + 0.5) * 1.0;
        const strokeXRight = x + w + padXRight;

        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = 'rgba(238, 202, 186, 0.72)';

        const pTL = {
            x: strokeXLeft + slant + getAbsoluteNoise(strokeXLeft, lineSeed, 5) * 0.8,
            y: strokeY + getAbsoluteNoise(strokeXLeft, lineSeed, 6) * 0.5
        };
        const pTR = {
            x: strokeXRight + slant + getAbsoluteNoise(strokeXRight, lineSeed, 7) * 0.8,
            y: strokeY + getAbsoluteNoise(strokeXRight, lineSeed, 8) * 0.5
        };
        const pBR = {
            x: strokeXRight + getAbsoluteNoise(strokeXRight, lineSeed, 9) * 0.8,
            y: strokeY + strokeHeight + getAbsoluteNoise(strokeXRight, lineSeed, 10) * 0.5
        };
        const pBL = {
            x: strokeXLeft + getAbsoluteNoise(strokeXLeft, lineSeed, 11) * 0.8,
            y: strokeY + strokeHeight + getAbsoluteNoise(strokeXLeft, lineSeed, 12) * 0.5
        };

        ctx.beginPath();
        const startTopX = pTL.x + radius;
        const endTopX = pTR.x - radius;
        ctx.moveTo(startTopX, pTL.y);

        for (let curX = startTopX + 10; curX < endTopX; curX += 10) {
            const wobble = getWobble(curX, lineSeed, 100);
            ctx.lineTo(curX, strokeY + wobble * 0.6);
        }

        ctx.lineTo(endTopX, pTR.y);
        ctx.quadraticCurveTo(pTR.x, pTR.y, pTR.x - (radius * 0.3), pTR.y + (radius * 0.7));
        ctx.lineTo(pBR.x + (radius * 0.3), pBR.y - (radius * 0.7));
        ctx.quadraticCurveTo(pBR.x, pBR.y, pBR.x - radius, pBR.y);

        const startBottomX = pBR.x - radius;
        const endBottomX = pBL.x + radius;
        for (let curX = startBottomX - 10; curX > endBottomX; curX -= 10) {
            const wobble = getWobble(curX, lineSeed, 200);
            ctx.lineTo(curX, strokeY + strokeHeight + wobble * 0.6);
        }

        ctx.lineTo(endBottomX, pBL.y);
        ctx.quadraticCurveTo(pBL.x, pBL.y, pBL.x + (radius * 0.3), pBL.y - (radius * 0.7));
        ctx.lineTo(pTL.x - (radius * 0.3), pTL.y + (radius * 0.7));
        ctx.quadraticCurveTo(pTL.x, pTL.y, pTL.x + radius, pTL.y);

        ctx.closePath();
        ctx.fill();

        const radG1 = ctx.createRadialGradient(
            pBL.x + radius, pBL.y - radius, 1,
            pBL.x + radius, pBL.y - radius, strokeHeight * 0.65
        );
        radG1.addColorStop(0, 'rgba(218, 172, 152, 0.28)');
        radG1.addColorStop(1, 'rgba(218, 172, 152, 0)');
        ctx.fillStyle = radG1;
        ctx.fill();

        const radG2 = ctx.createRadialGradient(
            pTR.x - radius, pTR.y + radius, 1,
            pTR.x - radius, pTR.y + radius, strokeHeight * 0.65
        );
        radG2.addColorStop(0, 'rgba(218, 172, 152, 0.28)');
        radG2.addColorStop(1, 'rgba(218, 172, 152, 0)');
        ctx.fillStyle = radG2;
        ctx.fill();

        ctx.restore();
    }
});