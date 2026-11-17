"use strict";

/*
    WGL - The WebGL2 context, plus the app's fixed design resolution.

    Everything is drawn in design units: (0, 0) is the bottom-left of the
    design area and (getWidth(), getHeight()) is the top-right, whatever the
    window size. resizeToWindow() fits that area to the window:

        - If the window (in device pixels) is smaller than the design
          resolution, the view is scaled down to fit, keeping the aspect ratio.
        - If it's bigger, the view is drawn at full resolution (scale 1), centered.

    The space left over (left/right or top/bottom) is filled with the bar color.

    Usage:
        WGL.init("wglCanvas");
        WGL.setDesignResolution(width, height); // Optional; WGL has a built-in default
        WGL.setBarColor(new Vector4(0, 0, 0, 1)); // Optional; black is the default
        WGL.setClearColor(new Vector4(0.1, 0.1, 0.1, 1));
        WGL.resizeToWindow(); // And again from window.onresize

        // Each frame
        WGL.beginFrame();
        ...draw...

        // Mouse / touch input in design units (+Y up)
        const p = WGL.clientToView(e.clientX, e.clientY);
*/
class WGL
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

    static init(canvasId, ctxAttributes = null)
    {
        if (canvasId == null)
            return false;

        if (WGL.context !== null)
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
                WGL.context = c.getContext(contextNames[i], contextAttributes);
            }
            catch(e)
            {
                console.log(contextNames[i] + " could not be created");
            }

            if (WGL.context !== null)
                break;
        }

        return (WGL.context !== null);
    }

    // Call before resizeToWindow(), usually once at startup
    static setDesignResolution(width, height)
    {
        if (width <= 0 || height <= 0)
        {
            console.error(`WGL.setDesignResolution() needs a positive size, got ${width} x ${height}`);
                return false;
        }

        WGL.#designWidth = width;
        WGL.#designHeight = height;
        WGL.resizeToWindow();
            return true;
    }

    static getWidth() { return WGL.#designWidth; }   // Design units
    static getHeight() { return WGL.#designHeight; } // Design units
    static getViewScale() { return WGL.#viewScale; } // Device pixels per design unit

    static setBarColor(color) { WGL.#barColor.set(color.x, color.y, color.z, color.w); }
    static setClearColor(color) { WGL.#clearColor.set(color.x, color.y, color.z, color.w); }

    // Sizes the canvas to the window in device pixels and fits the design area inside it
    static resizeToWindow()
    {
        if (WGL.context === null)
            return;

        let c = WGL.context.canvas;
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

        const scale = Math.min(1.0, w / WGL.#designWidth, h / WGL.#designHeight);

        WGL.#viewScale = scale;
        WGL.#viewW = Math.round(WGL.#designWidth * scale);
        WGL.#viewH = Math.round(WGL.#designHeight * scale);
        WGL.#viewX = Math.floor((w - WGL.#viewW) / 2);
        WGL.#viewY = Math.floor((h - WGL.#viewH) / 2);

        WGL.restoreView();
    }

    // Draws to the canvas through the design view again (e.g. after rendering to a RenderTarget)
    static restoreView()
    {
        if (WGL.context === null)
            return;

        WGL.context.bindFramebuffer(WGL.context.FRAMEBUFFER, null);
        WGL.context.viewport(WGL.#viewX, WGL.#viewY, WGL.#viewW, WGL.#viewH);
    }

    // Fills the bars with the bar color and the view with the clear color
    static beginFrame()
    {
        if (WGL.context === null)
            return;

        const gl = WGL.context;
        const bits = gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT;

        WGL.restoreView();

        gl.disable(gl.SCISSOR_TEST);
        gl.clearColor(WGL.#barColor.x, WGL.#barColor.y, WGL.#barColor.z, WGL.#barColor.w);
        gl.clear(bits);

        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(WGL.#viewX, WGL.#viewY, WGL.#viewW, WGL.#viewH);
        gl.clearColor(WGL.#clearColor.x, WGL.#clearColor.y, WGL.#clearColor.z, WGL.#clearColor.w);
        gl.clear(bits);
        gl.disable(gl.SCISSOR_TEST); // The viewport already clips drawing to the view
    }

    // A point in page (client) pixels, e.g. from a mouse event, in design units with +Y up.
    // Points over the bars land outside 0..getWidth() / 0..getHeight().
    static clientToView(clientX, clientY)
    {
        if (WGL.context === null)
            return new Vector2(-1, -1);

        const c = WGL.context.canvas;
        const bounds = c.getBoundingClientRect();
        const px = (clientX - bounds.left) * (c.width / bounds.width);
        const py = c.height - ((clientY - bounds.top) * (c.height / bounds.height)); // Flip to +Y up

        return new Vector2((px - WGL.#viewX) / WGL.#viewScale, (py - WGL.#viewY) / WGL.#viewScale);
    }
}
