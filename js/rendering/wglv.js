"use strict";

/*
    WGLV (WebGL View) - The WebGL2 context and fitting the view to the
    device: the app's fixed design resolution, letter-boxing it into the
    canvas at the device's physical resolution, clearing, and converting
    input positions. Cameras and clipping are ClipSpace's (render_utils.js).

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
        ClipSpace.beginFrame();
        ...draw...

        // Mouse / touch input in design units (+Y up)
        const p = WGLV.clientToView(e.clientX, e.clientY);

    Listeners: anything that needs to know when the view changes registers a
    listeners object, a plain object holding one or more of these callbacks
    (and nothing else):

        {
            onRasterScaleChanged: (newScale) => { },  // The view scale changed (getViewScale()). Anything
                                                      // drawn into a texture at screen resolution (Text2D,
                                                      // TextAtlas) draws itself again so it stays sharp.
            onContextLost: () => { },                 // The GL context was taken away (see below)
            onContextRestored: () => { }              // A new, empty GL context was given back
        }

        const listeners = { onRasterScaleChanged: (scale) => this.redraw(scale) };
        WGLV.addListeners(listeners);
        ...
        WGLV.removeListeners(listeners);              // The same object; held strongly until then

    Model2D wraps this with listenForRasterScale(true / false).

    Lost context: the browser can take the GL context away (often on phones,
    under memory pressure or in a background tab) and give a new, empty one
    back later. WGLV asks for it back and calls onContextLost() and
    onContextRestored(). Every GL object is gone on restore; RenderTargets
    (render_target.js) make theirs again, and RenderState forgets what it
    set. Shaders, textures and meshes aren't rebuilt yet; an app that must
    survive a lost context reloads them in its own onContextRestored().
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
    static #kViewRect = { x: 0, y: 0, w: 0, h: 0 }; // Scratch: beginFrame()'s scissor, in canvas pixels

    static #kListenerNames = ["onRasterScaleChanged", "onContextLost", "onContextRestored"];

    static #listeners = new Set(); // Listeners objects (see the top of this file)
    static #isContextLost = false;

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

        c.addEventListener("webglcontextlost", (e) => WGLV.#onContextLost(e));
        c.addEventListener("webglcontextrestored", () => WGLV.#onContextRestored());
        RenderState.applyDefaults();
            return true;
    }

    // True between the context being lost and given back; nothing drawn meanwhile shows
    static isContextLost() { return WGLV.#isContextLost; }

    /*
        Registers a listeners object (see the top of this file): one or more of
        onRasterScaleChanged, onContextLost and onContextRestored, each a function, and
        no other keys. Adding the same object again does nothing. Returns false (adding
        nothing) if it isn't one.
    */
    static addListeners(listeners)
    {
        const names = (listeners !== null && typeof listeners === "object") ? Object.keys(listeners) : [];
        const isValid = (names.length > 0 && names.every((n) => WGLV.#kListenerNames.includes(n) === true && typeof listeners[n] === "function"));

        if (isValid === false)
        {
            console.error(`WGLV.addListeners() needs an object of one or more callbacks named ${WGLV.#kListenerNames.join(", ")}`);
                return false;
        }

        WGLV.#listeners.add(listeners);
            return true;
    }

    // Unregisters a listeners object given to addListeners()
    static removeListeners(listeners)
    {
        WGLV.#listeners.delete(listeners);
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

    // The view's rect in the canvas, in device pixels with the GL origin at the bottom-left (the bars are outside it)
    static getViewportX() { return WGLV.#viewX; }
    static getViewportY() { return WGLV.#viewY; }
    static getViewportWidth() { return WGLV.#viewW; }
    static getViewportHeight() { return WGLV.#viewH; }

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
            WGLV.#notify("onRasterScaleChanged", scale);
    }

    // Draws to the canvas through the design view again (e.g. after rendering into a framebuffer)
    static restoreView()
    {
        if (WGLV.context === null)
            return;

        WGLV.context.bindFramebuffer(WGLV.context.FRAMEBUFFER, null);
        WGLV.context.viewport(WGLV.#viewX, WGLV.#viewY, WGLV.#viewW, WGLV.#viewH);
    }

    // Fills the bars with the bar color and the view with the clear color. Then call ClipSpace.beginFrame().
    static beginFrame()
    {
        if (WGLV.context === null)
            return;

        const gl = WGLV.context;
        const bits = gl.COLOR_BUFFER_BIT; // No depth buffer: 2D draws in layer order

        WGLV.restoreView();

        RenderState.setScissor(null);
        gl.clearColor(WGLV.#barColor.x, WGLV.#barColor.y, WGLV.#barColor.z, WGLV.#barColor.w);
        gl.clear(bits);

        let view = WGLV.#kViewRect;
        view.x = WGLV.#viewX;
        view.y = WGLV.#viewY;
        view.w = WGLV.#viewW;
        view.h = WGLV.#viewH;

        RenderState.setScissor(view);
        gl.clearColor(WGLV.#clearColor.x, WGLV.#clearColor.y, WGLV.#clearColor.z, WGLV.#clearColor.w);
        gl.clear(bits);
        RenderState.setScissor(null); // The viewport already clips drawing to the view
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

    // *** Internal Methods ***

    static #onContextLost(e)
    {
        e.preventDefault(); // Without this the browser never gives the context back
        WGLV.#isContextLost = true;
        RenderState.invalidate();
        console.error("WGLV: the WebGL context was lost; waiting for it to come back");
        WGLV.#notify("onContextLost");
    }

    static #onContextRestored()
    {
        WGLV.#isContextLost = false;
        RenderState.applyDefaults(); // A new context starts with GL's defaults, not ours
        WGLV.resizeToWindow(); // A new context: the viewport again
        WGLV.#notify("onContextRestored");
    }

    // Calls name on every listeners object that has it
    static #notify(name, value = undefined)
    {
        // A copy, so listeners can add or remove listeners while being called
        for (const listeners of Array.from(WGLV.#listeners))
        {
            if (listeners[name] !== undefined)
                listeners[name](value);
        }
    }
}
