"use strict";

/*
    Text2D - Screen-space text drawn with Rect2D.

    The text is rasterized in white onto a hidden 2D canvas, the canvas is
    turned into a data URL and loaded through Texture.load(), and the result
    is drawn with a Rect2D. The color is applied as a tint, so setColor()
    never re-rasterizes; only setText() does.

    Texture loading is asynchronous, so new text appears once its texture has
    loaded (usually the next frame). Like Rect2D, the canvas resolution is
    captured when the text is built: after the canvas is resized, create the
    Text2D again (or call setText with new text).

    Usage:
        let t = new Text2D(32, "Arial", "bold");
        t.setColor(new Vector4(1, 1, 0, 1));
        t.setPos(400, 300, Alignment.kMiddleCenter);
        t.setText("Hello");
        ...
        t.render();
*/
class Text2D
{
    static #kCanvas = null;
    static #kPadding = 4; // Pixels around the text so anti-aliased edges aren't clipped

    #text;
    #fontSize;
    #fontFamily;
    #fontWeight;

    #texture;
    #rect;
    #color;

    #x;
    #y;
    #align;

    #width;
    #height;
    #loadId;

    constructor(_fontSize = 32, _fontFamily = "sans-serif", _fontWeight = "normal")
    {
        this.#text = null;
        this.#fontSize = _fontSize;
        this.#fontFamily = _fontFamily;
        this.#fontWeight = _fontWeight;

        this.#texture = null;
        this.#rect = null;
        this.#color = new Vector4(1, 1, 1, 1);

        this.#x = 0;
        this.#y = 0;
        this.#align = Alignment.kBottomLeft;

        this.#width = 0;
        this.#height = 0;
        this.#loadId = 0;
    }

    setText(_text, onLoadSuccessCB = null)
    {
        if (_text == null)
            return false;

        if (_text === this.#text)
            return true; // Nothing changed

        this.#text = _text;

        // Rasterize the text in white
        const c = Text2D.#getCanvas();
        let ctx = c.getContext("2d");
        const font = `${this.#fontWeight} ${this.#fontSize}px ${this.#fontFamily}`;
        const pad = Text2D.#kPadding;

        ctx.font = font;
        const w = Math.max(1, Math.ceil(ctx.measureText(_text).width) + (pad * 2));
        const h = Math.ceil(this.#fontSize * 1.3) + (pad * 2);

        c.width = w; // Resizing clears the canvas and resets the context state
        c.height = h;

        ctx.font = font;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#ffffff";
        ctx.fillText(_text, w / 2.0, h / 2.0);

        const url = c.toDataURL("image/png");
        const loadId = ++this.#loadId;
        let tex = new Texture();

        tex.load(url, () => {
            if (loadId !== this.#loadId)
            {
                tex.unload(); // A newer setText() or unload() replaced this one
                    return;
            }

            if (this.#texture !== null)
                this.#texture.unload();

            this.#texture = tex;
            this.#width = w;
            this.#height = h;
            this.#buildRect();

            if (onLoadSuccessCB !== null)
                onLoadSuccessCB();
        });

        return true; // Loading...
    }

    // (x, y) is the anchor point; align says which part of the text sits on it
    setPos(x, y, align = Alignment.kBottomLeft)
    {
        this.#x = x;
        this.#y = y;
        this.#align = align;
        this.#applyPos();
    }

    setColor(color)
    {
        this.#color.set(color.x, color.y, color.z, color.w);
        this.#rect?.setColor(this.#color);
    }

    getText() { return this.#text; }
    getWidth() { return this.#width; }
    getHeight() { return this.#height; }
    isLoaded() { return (this.#rect !== null); }

    render()
    {
        if (this.#rect !== null)
            this.#rect.render();
    }

    unload()
    {
        this.#loadId++; // Discard any texture still loading

        if (this.#texture !== null)
        {
            this.#texture.unload();
            this.#texture = null;
        }

        this.#rect = null;
        this.#text = null;
        this.#width = 0;
        this.#height = 0;
    }

    // *** Internal Methods ***

    static #getCanvas()
    {
        if (Text2D.#kCanvas === null)
            Text2D.#kCanvas = document.createElement("canvas");

        return Text2D.#kCanvas;
    }

    #buildRect()
    {
        let r = new Rect2D();

        if (r.load(this.#texture, this.#width, this.#height) === false)
        {
            console.error("Text2D couldn't build its rect for: " + this.#text);
                return;
        }

        this.#rect = r;
        this.#rect.setColor(this.#color);
        this.#applyPos();
    }

    #applyPos()
    {
        if (this.#rect === null)
            return; // Applied once the texture loads

        // Alignment values run left/center/right in groups of bottom/middle/top
        const col = Math.floor(this.#align / 3);
        const row = this.#align % 3;

        let lx = this.#x;
        let by = this.#y;

        if (col === 1) lx -= this.#width / 2.0;
        else if (col === 2) lx -= this.#width;

        if (row === 1) by -= this.#height / 2.0;
        else if (row === 2) by -= this.#height;

        this.#rect.setPos(Math.round(lx), Math.round(by));
    }
}
