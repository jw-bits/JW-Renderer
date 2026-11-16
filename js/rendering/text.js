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
        const font = await gFontManager.load("./fonts/MyFont-Regular.ttf"); // The app's FontManager
        let t = new Text2D(font, 32, "bold");
        t.setColor(new Vector4(1, 1, 0, 1));
        t.setPos(400, 300, Alignment.kMiddleCenter);
        t.setText("Hello");
        ...
        t.render();

    The Font is the only way to choose what Text2D draws with; use
    fontManager.loadFromSystem("Arial") for a font the browser already has.
    If the Font hasn't finished loading, setText() waits for it before
    rasterizing. If it fails to load, the text is drawn in sans-serif.
*/
class Text2D
{
    static #kCanvas = null;
    static #kPadding = 4; // Pixels around the text so anti-aliased edges aren't clipped

    #text;
    #font;
    #fontSize;
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

    // _font is a Font, usually from the app's FontManager
    constructor(_font, _fontSize = 32, _fontWeight = "normal")
    {
        this.#text = null;
        this.#font = _font;

        if (this.#font == null)
        {
            console.error("Text2D needs a Font; using sans-serif");
            this.#font = new Font();
            this.#font.loadFromSystem("sans-serif");
        }

        this.#fontSize = _fontSize;
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
        const loadId = ++this.#loadId;

        if (this.#font.isLoaded() === true)
            this.#rasterize(_text, loadId, onLoadSuccessCB);
        else
            this.#rasterizeWhenFontLoads(_text, loadId, onLoadSuccessCB);

        return true; // Loading...
    }

    getFont() { return this.#font; }

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

    async #rasterizeWhenFontLoads(_text, loadId, onLoadSuccessCB)
    {
        await this.#font.waitForLoad(); // On failure the Font falls back to sans-serif

        if (loadId === this.#loadId) // Skip if a newer setText() or unload() came first
            this.#rasterize(_text, loadId, onLoadSuccessCB);
    }

    #rasterize(_text, loadId, onLoadSuccessCB)
    {
        // Rasterize the text in white
        const c = Text2D.#getCanvas();
        let ctx = c.getContext("2d");
        const font = this.#font.toCss(this.#fontSize, this.#fontWeight);
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
    }

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
