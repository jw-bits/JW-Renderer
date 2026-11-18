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

        const defaultAttributes = {antialias: true, depth: true, stencil: false, premultipledAlpha: true, alpha: true};
        const contextAttributes = (ctxAttributes !== null) ? ctxAttributes : defaultAttributes;

        let contextNames = ["webgl2"];

        for (let i = 0; i < contextNames.length; ++i)
        {
            try
            {
                WGLV.context = c.getContext(contextNames[i], contextAttributes);
            }
            catch(e)
            {
                console.log(contextNames[i] + " could not be created");
            }

            if (WGLV.context !== null)
                break;
        }

        return (WGLV.context !== null);
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

    // Draws to the canvas through the design view again (e.g. after rendering to a RenderTarget)
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
        const bits = gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT;

        WGLV.restoreView();

        gl.disable(gl.SCISSOR_TEST);
        gl.clearColor(WGLV.#barColor.x, WGLV.#barColor.y, WGLV.#barColor.z, WGLV.#barColor.w);
        gl.clear(bits);

        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(WGLV.#viewX, WGLV.#viewY, WGLV.#viewW, WGLV.#viewH);
        gl.clearColor(WGLV.#clearColor.x, WGLV.#clearColor.y, WGLV.#clearColor.z, WGLV.#clearColor.w);
        gl.clear(bits);
        gl.disable(gl.SCISSOR_TEST); // The viewport already clips drawing to the view
    }

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
}
