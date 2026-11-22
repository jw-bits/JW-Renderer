"use strict";

/*
    WGLV (WebGL View) - The WebGL2 context and everything about the view:
    the app's fixed design resolution, fitting it to the window, clearing,
    and converting input positions.

    Everything is drawn in design units: (0, 0) is the bottom-left of the
    design area and (getWidth(), getHeight()) is the top-right, whatever the
    window size. resizeToWindow() fits that area to the window:

        - If the window (in device pixels) is smaller than the design
          resolution, the view is scaled down to fit, keeping the aspect ratio.
        - If it's bigger, the view is drawn at full resolution (scale 1), centered.

    The space left over (left/right or top/bottom) is filled with the bar color.

    Usage:
        WGLV.init("wglCanvas");
        WGLV.setDesignResolution(width, height); // Optional; WGLV has a built-in default
        WGLV.setBarColor(new Vector4(0, 0, 0, 1)); // Optional; black is the default
        WGLV.setClearColor(new Vector4(0.1, 0.1, 0.1, 1));
        WGLV.resizeToWindow(); // And again from window.onresize

        // Each frame
        WGLV.beginFrame();
        ...draw...

        // Mouse / touch input in design units (+Y up)
        const p = WGLV.clientToView(e.clientX, e.clientY);

    Raster scale event: anything drawn into a texture at screen resolution
    (like Text2D) needs redrawing when the view scale changes. Listeners are
    objects with an onRasterScaleChanged(newScale) method:

        WGLV.addRasterScaleListener(obj);    // obj.onRasterScaleChanged(scale) is called on each change
        WGLV.removeRasterScaleListener(obj); // Listeners are held strongly; always remove them

    Model2D wraps this with listenForRasterScale(true / false).

    Clipping: pushClipRect(x, y, width, height) limits drawing to a rect in
    design units (the GL scissor test) until the matching popClipRect().
    Clip rects nest: each one is cut down to the one it's inside. Only what's
    drawn while it's pushed is clipped, so with a MaterialBatcher push and pop
    inside something drawn from the batcher (see submitDrawable()), not
    around submit(). beginFrame() clears any left pushed.

        WGLV.pushClipRect(100, 200, 400, 80);
        model.render();
        WGLV.popClipRect();
*/
class WGLV
{
    static context = null;

    static #designWidth = 1440;
    static #designHeight = 3200;

    // The view rectangle in canvas (device) pixels, GL origin at the bottom-left
    static #viewX = 0;
    static #viewY = 0;
    static #viewW = 0;
    static #viewH = 0;
    static #viewScale = 1.0; // Device pixels per design unit, never above 1

    static #barColor = new Vector4(0, 0, 0, 1);
    static #clearColor = new Vector4(0, 0, 0, 1);

    static #rasterScaleListeners = new Set();

    static #clipStack = []; // Pushed clip rects in canvas pixels: { x, y, w, h }, innermost last

    static init(canvasId, ctxAttributes = null)
    {
        if (canvasId == null)
            return false;

        if (WGLV.context !== null)
            return false; // Already initialized

        let c = document.getElementById(canvasId);

        if (c == null)
        {
            console.error("::init() couldn't find canvas with id:" + canvasId);
                return false;
        }

        const defaultAttributes = {antialias: true, depth: false, stencil: false, premultipliedAlpha: true, alpha: true};
        const contextAttributes = (ctxAttributes !== null) ? ctxAttributes : defaultAttributes;

        try
        {
            WGLV.context = c.getContext("webgl2", contextAttributes);
        }
        catch (e)
        {
            WGLV.context = null;
        }

        if (WGLV.context === null)
        {
            console.error("WGLV.init(): WebGL2 isn't available");
                return false;
        }

        return true;
    }

    // Call before resizeToWindow(), usually once at startup
    static setDesignResolution(width, height)
    {
        if (width <= 0 || height <= 0)
        {
            console.error(`WGLV.setDesignResolution() needs a positive size, got ${width} x ${height}`);
                return false;
        }

        WGLV.#designWidth = width;
        WGLV.#designHeight = height;
        WGLV.resizeToWindow();
            return true;
    }

    static getWidth() { return WGLV.#designWidth; }   // Design units
    static getHeight() { return WGLV.#designHeight; } // Design units
    static getViewScale() { return WGLV.#viewScale; } // Device pixels per design unit; the scale to rasterize at

    // listener needs an onRasterScaleChanged(newScale) method. Returns false if it doesn't have one.
    static addRasterScaleListener(listener)
    {
        if (typeof listener?.onRasterScaleChanged !== "function")
        {
            console.error("WGLV.addRasterScaleListener() needs an object with an onRasterScaleChanged(newScale) method");
                return false;
        }

        WGLV.#rasterScaleListeners.add(listener);
            return true;
    }

    static removeRasterScaleListener(listener)
    {
        WGLV.#rasterScaleListeners.delete(listener);
    }

    static setBarColor(color) { WGLV.#barColor.set(color.x, color.y, color.z, color.w); }
    static setClearColor(color) { WGLV.#clearColor.set(color.x, color.y, color.z, color.w); }

    // Sizes the canvas to the window in device pixels and fits the design area inside it
    static resizeToWindow()
    {
        if (WGLV.context === null)
            return;

        let c = WGLV.context.canvas;
        const dpr = window.devicePixelRatio || 1;
        const cssW = window.innerWidth;
        const cssH = window.innerHeight;
        const w = Math.max(1, Math.round(cssW * dpr));
        const h = Math.max(1, Math.round(cssH * dpr));

        c.style.width = cssW + "px";
        c.style.height = cssH + "px";

        if (c.width !== w || c.height !== h)
        {
            c.width = w;
            c.height = h;
        }

        const scale = Math.min(1.0, w / WGLV.#designWidth, h / WGLV.#designHeight);
        const scaleChanged = (scale !== WGLV.#viewScale);

        WGLV.#viewScale = scale;
        WGLV.#viewW = Math.round(WGLV.#designWidth * scale);
        WGLV.#viewH = Math.round(WGLV.#designHeight * scale);
        WGLV.#viewX = Math.floor((w - WGLV.#viewW) / 2);
        WGLV.#viewY = Math.floor((h - WGLV.#viewH) / 2);

        WGLV.restoreView();

        if (scaleChanged === true)
        {
            // A copy, so listeners can add or remove listeners while being called
            for (const listener of Array.from(WGLV.#rasterScaleListeners))
                listener.onRasterScaleChanged(scale);
        }
    }

    // Draws to the canvas through the design view again (e.g. after rendering into a framebuffer)
    static restoreView()
    {
        if (WGLV.context === null)
            return;

        WGLV.context.bindFramebuffer(WGLV.context.FRAMEBUFFER, null);
        WGLV.context.viewport(WGLV.#viewX, WGLV.#viewY, WGLV.#viewW, WGLV.#viewH);
    }

    // Fills the bars with the bar color and the view with the clear color
    static beginFrame()
    {
        if (WGLV.context === null)
            return;

        const gl = WGLV.context;
        const bits = gl.COLOR_BUFFER_BIT; // No depth buffer: 2D draws in layer order

        WGLV.restoreView();

        if (WGLV.#clipStack.length > 0)
        {
            console.error(`WGLV.beginFrame(): ${WGLV.#clipStack.length} clip rect(s) were never popped`);
            WGLV.#clipStack.length = 0;
        }

        gl.disable(gl.SCISSOR_TEST);
        gl.clearColor(WGLV.#barColor.x, WGLV.#barColor.y, WGLV.#barColor.z, WGLV.#barColor.w);
        gl.clear(bits);

        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(WGLV.#viewX, WGLV.#viewY, WGLV.#viewW, WGLV.#viewH);
        gl.clearColor(WGLV.#clearColor.x, WGLV.#clearColor.y, WGLV.#clearColor.z, WGLV.#clearColor.w);
        gl.clear(bits);
        gl.disable(gl.SCISSOR_TEST); // The viewport already clips drawing to the view
    }

    /*
        Limits drawing to a rect in design units ((x, y) its bottom-left), cut
        down to any clip rect already pushed, until popClipRect(). Returns
        false (pushing nothing) if the size isn't valid.
    */
    static pushClipRect(x, y, width, height)
    {
        if (WGLV.context === null)
            return false;

        if (Number.isFinite(x) === false || Number.isFinite(y) === false || Number.isFinite(width) === false || Number.isFinite(height) === false || width < 0 || height < 0)
        {
            console.error("WGLV.pushClipRect() needs a position and a size of 0 or more");
                return false;
        }

        // To canvas pixels, rounded outward so edges in between pixels aren't lost
        const s = WGLV.#viewScale;
        let left = Math.floor(WGLV.#viewX + (x * s));
        let bottom = Math.floor(WGLV.#viewY + (y * s));
        let right = Math.ceil(WGLV.#viewX + ((x + width) * s));
        let top = Math.ceil(WGLV.#viewY + ((y + height) * s));

        // Inside the view, and inside the clip rect it's pushed into
        const outer = (WGLV.#clipStack.length > 0) ? WGLV.#clipStack[WGLV.#clipStack.length - 1] : { x: WGLV.#viewX, y: WGLV.#viewY, w: WGLV.#viewW, h: WGLV.#viewH };

        left = Math.max(left, outer.x);
        bottom = Math.max(bottom, outer.y);
        right = Math.min(right, outer.x + outer.w);
        top = Math.min(top, outer.y + outer.h);

        const rect = { x: left, y: bottom, w: Math.max(0, right - left), h: Math.max(0, top - bottom) };

        WGLV.#clipStack.push(rect);
        WGLV.#applyClip();
            return true;
    }

    // Removes the last pushed clip rect; the one before it (or none) applies again
    static popClipRect()
    {
        if (WGLV.#clipStack.length === 0)
        {
            console.error("WGLV.popClipRect() without a pushClipRect()");
                return;
        }

        WGLV.#clipStack.pop();
        WGLV.#applyClip();
    }

    // Clip rects pushed and not yet popped
    static getClipDepth() { return WGLV.#clipStack.length; }

    // A point in page (client) pixels, e.g. from a mouse event, in design units with +Y up.
    // Points over the bars land outside 0..getWidth() / 0..getHeight().
    static clientToView(clientX, clientY)
    {
        if (WGLV.context === null)
            return new Vector2(-1, -1);

        const c = WGLV.context.canvas;
        const bounds = c.getBoundingClientRect();
        const px = (clientX - bounds.left) * (c.width / bounds.width);
        const py = c.height - ((clientY - bounds.top) * (c.height / bounds.height)); // Flip to +Y up

        return new Vector2((px - WGLV.#viewX) / WGLV.#viewScale, (py - WGLV.#viewY) / WGLV.#viewScale);
    }

    // *** Internal Methods ***

    // Sets the scissor test to the innermost clip rect, or turns it off with none pushed
    static #applyClip()
    {
        const gl = WGLV.context;

        if (WGLV.#clipStack.length === 0)
        {
            gl.disable(gl.SCISSOR_TEST);
                return;
        }

        const r = WGLV.#clipStack[WGLV.#clipStack.length - 1];
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(r.x, r.y, r.w, r.h);
    }
}
