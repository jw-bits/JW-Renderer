"use strict";

/*
    Text2D - Screen-space text drawn with Rect2D.

    The text is rasterized in white onto a hidden 2D canvas, which is
    uploaded straight into the Text2D's own texture (no image decode), and
    drawn with a Rect2D. The color is applied as a tint, so setColor() never
    re-rasterizes; only setText() does. New text shows up right away.

    Sizes and positions are in design units (see WGL). The text is rasterized
    at the view's current scale so it stays sharp at any window size; when
    the scale changes, render() rasterizes it again automatically.

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
    The Font must be loaded before setText() is called; otherwise setText()
    returns false and nothing changes.
*/
class Text2D
{
    static #kCanvas = null;
    static #kPadding = 4; // Design units around the text so anti-aliased edges aren't clipped

    #text;
    #font;
    #fontSize;
    #fontWeight;

    #texture;
    #rect;
    #rectTexW;     // Texture size the rect was built for
    #rectTexH;
    #rasterScale;  // View scale the text was rasterized at
    #color;

    #x;
    #y;
    #align;

    #width;  // Design units
    #height;

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
        this.#rectTexW = 0;
        this.#rectTexH = 0;
        this.#rasterScale = 0;
        this.#color = new Vector4(1, 1, 1, 1);

        this.#x = 0;
        this.#y = 0;
        this.#align = Alignment.kBottomLeft;

        this.#width = 0;
        this.#height = 0;
    }

    // Returns false if the text is null, the Font isn't loaded, or the text couldn't be drawn
    setText(_text)
    {
        if (_text == null)
            return false;

        if (this.#font.isLoaded() === false)
        {
            console.error("Text2D.setText(): the Font isn't loaded");
                return false;
        }

        if (_text === this.#text && this.#rect !== null)
            return true; // Nothing changed

        this.#text = _text;
        return this.#rasterize();
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
        this.getModel()?.render();
    }

    /*
        The Rect2D that draws this text, re-rasterized first if the view scale
        changed, or null if there's no text yet. MaterialBatcher uses it; it's
        rebuilt by setText() and resizes, so don't keep it.
    */
    getModel()
    {
        if (this.#text !== null && this.#rasterScale !== WGL.getViewScale())
            this.#rasterize(); // The window was resized; redraw at the new scale

        return this.#rect;
    }

    unload()
    {
        if (this.#rect !== null)
        {
            this.#rect.unload();
            this.#rect = null;
        }

        if (this.#texture !== null)
        {
            this.#texture.unload();
            this.#texture = null;
        }

        this.#text = null;
        this.#rectTexW = 0;
        this.#rectTexH = 0;
        this.#rasterScale = 0;
        this.#width = 0;
        this.#height = 0;
    }

    // *** Internal Methods ***

    #rasterize()
    {
        // Draw at device-pixel size, so one texel lands on one screen pixel
        const scale = WGL.getViewScale();
        const c = Text2D.#getCanvas();
        let ctx = c.getContext("2d");
        const size = this.#fontSize * scale;
        const font = this.#font.toCss(size, this.#fontWeight);
        const pad = Math.ceil(Text2D.#kPadding * scale);

        ctx.font = font;
        const texW = Math.max(1, Math.ceil(ctx.measureText(this.#text).width) + (pad * 2));
        const texH = Math.max(1, Math.ceil(size * 1.3) + (pad * 2));

        c.width = texW; // Resizing clears the canvas and resets the context state
        c.height = texH;

        ctx.font = font;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#ffffff";
        ctx.fillText(this.#text, texW / 2.0, texH / 2.0);

        // Upload into this Text2D's texture, creating it the first time
        let ok;

        if (this.#texture === null)
        {
            this.#texture = new Texture(true, false); // No mipmaps: it's drawn at the size it's rasterized
            ok = this.#texture.loadCanvas(c);
        }
        else
            ok = this.#texture.updateCanvas(c);

        if (ok === false)
        {
            console.error("Text2D couldn't upload the texture for: " + this.#text);
                return false;
        }

        const scaleChanged = (scale !== this.#rasterScale);
        this.#rasterScale = scale;
        this.#width = texW / scale;
        this.#height = texH / scale;

        // The rect only needs rebuilding when its size changes
        if (this.#rect === null || scaleChanged || texW !== this.#rectTexW || texH !== this.#rectTexH)
        {
            if (this.#buildRect() === false)
                return false;

            this.#rectTexW = texW;
            this.#rectTexH = texH;
        }

        return true;
    }

    static #getCanvas()
    {
        if (Text2D.#kCanvas === null)
            Text2D.#kCanvas = document.createElement("canvas");

        return Text2D.#kCanvas;
    }

    #buildRect()
    {
        if (this.#rect !== null)
            this.#rect.unload();

        let r = new Rect2D();

        if (r.load(this.#texture, this.#width, this.#height) === false)
        {
            console.error("Text2D couldn't build its rect for: " + this.#text);
            this.#rect = null;
                return false;
        }

        this.#rect = r;
        this.#rect.setColor(this.#color);
        this.#applyPos();
            return true;
    }

    #applyPos()
    {
        if (this.#rect === null)
            return; // Applied once the text is set

        // Alignment values run left/center/right in groups of bottom/middle/top
        const col = Math.floor(this.#align / 3);
        const row = this.#align % 3;

        let lx = this.#x;
        let by = this.#y;

        if (col === 1) lx -= this.#width / 2.0;
        else if (col === 2) lx -= this.#width;

        if (row === 1) by -= this.#height / 2.0;
        else if (row === 2) by -= this.#height;

        this.#rect.setPos(lx, by);
    }
}
