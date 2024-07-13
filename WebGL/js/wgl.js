"use strict";

class WGL
{
    static context = null;

    static init(canvasId)
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

        let contextAttributes = {antialias: false, depth: false};
        let contextNames = ["webgl", "experimental-webgl", "webkit-3d", "moz-webgl"];

        for (let i = 0; i < contextNames.length; ++i)
        {
            try
            {
                WGL.context = c.getContext(contextNames[i]);
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

    static resizeToWindow()
    {
        let c = WGL.context.canvas;

        const w = window.innerWidth;
        const h = window.innerHeight;
        const needsResize = (c.width != w) || (c.height != h);

        console.log(`W = ${w} and H = ${h} clientWidth = ${c.clientWidth} and clientHeight = ${c.clientHeight}`);

        if (needsResize)
        {
            c.width = w;
            c.height = h;
            WGL.context.viewport(0, 0, c.width, c.height);
        }
    }
}