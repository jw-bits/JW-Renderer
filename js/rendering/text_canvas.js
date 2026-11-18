"use strict";

/*
    TextCanvas - Draws text onto one shared, hidden 2D canvas, ready to upload
    into a texture (see Text2D).

    The text is drawn in white, centered, with the canvas sized to fit it plus
    padding, so a color can be applied as a tint when it's drawn.

    Usage:
        const c = TextCanvas.draw("Hello", font, 32, "bold", WGLV.getViewScale());
        if (c !== null)
            texture.loadCanvas(c); // c.width x c.height pixels

    The canvas is shared: upload it before the next draw() call.
*/
class TextCanvas
{
    static kPadding = 4; // Design units around the text, so anti-aliased edges aren't clipped

    static #canvas = null;

    /*
        Draws text at fontSize * scale pixels (scale is device pixels per design unit,
        so one texel lands on one screen pixel). Returns the canvas, or null on failure.
    */
    static draw(text, font, fontSize, fontWeight, scale)
    {
        if (text == null || font == null || font.isLoaded() === false || scale <= 0)
            return null;

        const c = TextCanvas.getCanvas();
        let ctx = c.getContext("2d");

        if (ctx === null)
            return null;

        const size = fontSize * scale;
        const css = font.toCss(size, fontWeight);
        const pad = Math.ceil(TextCanvas.kPadding * scale);

        ctx.font = css;
        const w = Math.max(1, Math.ceil(ctx.measureText(text).width) + (pad * 2));
        const h = Math.max(1, Math.ceil(size * 1.3) + (pad * 2));

        c.width = w; // Resizing clears the canvas and resets the context state
        c.height = h;

        ctx.font = css;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#ffffff";
        ctx.fillText(text, w / 2.0, h / 2.0);

        return c;
    }

    static getCanvas()
    {
        if (TextCanvas.#canvas === null)
            TextCanvas.#canvas = document.createElement("canvas");

        return TextCanvas.#canvas;
    }
}
