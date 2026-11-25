"use strict";

/*
    TextCanvas - Draws text onto one shared, hidden 2D canvas, ready to upload
    into a texture (see Text2D, TextAtlas).

    The text is drawn centered, in white by default (so a color can be applied
    as a tint when it's drawn), with the canvas sized to fit it plus padding.
    It can also be drawn in a color, with a drop shadow behind it.

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

        color is a Vector4 (0 - 1). shadowColor, if not null, draws the text
        again behind itself in that color, shadowOffsetX / shadowOffsetY design
        units away (negative y is down). The canvas grows by the offset on
        every side, so the text stays centered in it.
    */
    static draw(text, font, fontSize, fontWeight, scale, color = Vector4.kWhite, shadowColor = null, shadowOffsetX = 0.0, shadowOffsetY = 0.0)
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
        const sx = (shadowColor !== null) ? (shadowOffsetX * scale) : 0.0;
        const sy = (shadowColor !== null) ? (-shadowOffsetY * scale) : 0.0; // The canvas's y is down
        const padX = pad + Math.ceil(Math.abs(sx));
        const padY = pad + Math.ceil(Math.abs(sy));

        ctx.font = css;
        const w = Math.max(1, Math.ceil(ctx.measureText(text).width) + (padX * 2));
        const h = Math.max(1, TextCanvas.lineHeight(size) + (padY * 2));

        c.width = w; // Resizing clears the canvas and resets the context state
        c.height = h;

        ctx.font = css;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        if (shadowColor !== null)
        {
            ctx.fillStyle = TextCanvas.#toCssColor(shadowColor);
            ctx.fillText(text, (w / 2.0) + sx, (h / 2.0) + sy);
        }

        ctx.fillStyle = TextCanvas.#toCssColor(color);
        ctx.fillText(text, w / 2.0, h / 2.0);

        return c;
    }

    // Pixels from the top of a line to the bottom, for a font size in pixels (without padding)
    static lineHeight(sizePixels) { return Math.ceil(sizePixels * 1.3); }

    static getCanvas()
    {
        if (TextCanvas.#canvas === null)
            TextCanvas.#canvas = document.createElement("canvas");

        return TextCanvas.#canvas;
    }

    // *** Internal Methods ***

    // A Vector4 (0 - 1) as a CSS rgba() color
    static #toCssColor(color)
    {
        const r = Math.round(MathUtil.clamp01(color.x) * MathDefines.kByteMax);
        const g = Math.round(MathUtil.clamp01(color.y) * MathDefines.kByteMax);
        const b = Math.round(MathUtil.clamp01(color.z) * MathDefines.kByteMax);
            return `rgba(${r}, ${g}, ${b}, ${MathUtil.clamp01(color.w)})`;
    }
}

/*
    TextAtlas - A set of characters (glyphs) from a Font, drawn once into a
    TextureAtlas at runtime, so text can be built from them without drawing
    it again (see TextGlyphs2D). One TextAtlas can be shared by any number of
    TextGlyphs2Ds, which all draw with its one Material.

    Each glyph is an AtlasSubTexture named by its character, drawn in white like
    Text2D (the color is a tint). A space and the fallback character "?" are
    always included; a character that isn't in the atlas draws as "?".

    The glyphs are drawn at fontSize times the view's scale. When the view's
    scale changes (e.g. the window is resized, or the page loaded while it
    was small), the atlas draws them again at the new scale (rasterize()),
    keeping the same Material and Texture, and every TextGlyphs2D on it
    rebuilds its quads, so text stays sharp. setFollowsViewScale(false)
    stops that, so the text stretches with the view instead (cheaper while
    the window is being dragged to a new size, say); rasterize() still draws
    them again when called. The atlas listens through WGLV.addListeners()
    until unload().

    Usage:
        const font = await FontManager.load("./fonts/MyFont-Regular.ttf");
        let digits = new TextAtlas(font, TextAtlas.kDigits + ":", 40, "bold"); // Or kAlphabet, kAscii

        let time = new TextGlyphs2D(digits);
        time.setAlignment(Alignment.kMiddleCenter);
        time.setText("12:34"); // No drawing; just a new mesh of glyph quads

    Glyphs sit side by side by their advance widths; kerning isn't applied.
    Call unload() once nothing draws with it.
*/
class TextAtlas
{
    static kFallbackChar = "?";
    static #kMaxRowPixels = 2048; // The atlas starts a new row of glyphs past this

    // Character presets for the constructor's _glyphs; join them for more than one (e.g. kDigits + ":")
    static kDigits = "0123456789";
    static kAlphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    static kAscii = String.fromCharCode(...Array.from({ length: 95 }, (_, i) => 32 + i)); // Every printable ASCII character, space (32) - tilde (126)

    #font;
    #fontSize;
    #fontWeight;
    #atlas;      // TextureAtlas: one AtlasSubTexture per character
    #material;   // The atlas Texture on Rect2D's default shader, shared by every TextGlyphs2D
    #glyphs;     // Character -> { subTexture, advance, width, height }, in design units
    #lineHeight; // Design units: the height of every glyph, padding included
    #padding;    // Design units around each glyph
    #chars;      // The characters drawn, in atlas order
    #scale;      // The view scale the glyphs were last drawn at
    #listeners;  // Functions called after rasterize() redraws the glyphs
    #followsViewScale;
    #viewListeners; // Given to WGLV.addListeners() while loaded and following the view scale

    /*
        _font is a loaded Font, usually from FontManager. _glyphs is a
        string of the characters to draw (repeats are fine). Check isLoaded()
        afterwards; it's false (with a console.error) if the glyphs couldn't
        be built.
    */
    constructor(_font, _glyphs, _fontSize = 32, _fontWeight = "normal")
    {
        this.#font = _font;
        this.#fontSize = _fontSize;
        this.#fontWeight = _fontWeight;
        this.#atlas = null;
        this.#material = null;
        this.#glyphs = new Map();
        this.#lineHeight = 0;
        this.#padding = 0;
        this.#chars = [];
        this.#scale = 0.0;
        this.#listeners = new Set();
        this.#followsViewScale = true;
        this.#viewListeners = { onRasterScaleChanged: () => this.rasterize() };

        if (_font == null || _font.isLoaded() === false)
        {
            console.error("TextAtlas needs a loaded Font");
                return;
        }

        if (typeof _glyphs !== "string")
        {
            console.error("TextAtlas needs a string of glyphs");
                return;
        }

        // Unique characters (Array.from keeps surrogate pairs, e.g. emoji, whole), plus a space and the fallback
        this.#chars = Array.from(new Set(Array.from(_glyphs + " " + TextAtlas.kFallbackChar)));

        if (this.#build() === false)
        {
            this.unload();
                return;
        }

        WGLV.addListeners(this.#viewListeners);
    }

    /*
        true (the default) draws the glyphs again whenever the view's scale changes, so
        text stays sharp; false lets it stretch with the view until rasterize() is called.
        A setting of false followed by true draws them now if the scale changed meanwhile.
    */
    setFollowsViewScale(follow)
    {
        this.#followsViewScale = (follow === true);

        if (this.isLoaded() === false)
            return;

        if (this.#followsViewScale === true)
        {
            WGLV.addListeners(this.#viewListeners);
            this.rasterize(); // Catch up with any change while it wasn't following
        }
        else
            WGLV.removeListeners(this.#viewListeners);
    }

    followsViewScale() { return this.#followsViewScale; }

    /*
        Draws the glyphs again at the view's current scale, if it changed since
        they were last drawn, then calls every rasterize listener (each
        TextGlyphs2D on the atlas rebuilds its quads). The Material and its
        Texture stay the same objects. Returns false if not loaded or it failed.
    */
    rasterize()
    {
        if (this.isLoaded() === false)
            return false;

        if (WGLV.getViewScale() === this.#scale)
            return true; // Already drawn at this scale

        if (this.#build() === false)
            return false;

        for (const listener of Array.from(this.#listeners))
            listener(this);

        return true;
    }

    // The view scale the glyphs were last drawn at
    getScale() { return this.#scale; }

    // listener(textAtlas) is called after rasterize() redraws the glyphs (TextGlyphs2D uses this)
    addRasterizeListener(listener)
    {
        if (typeof listener === "function")
            this.#listeners.add(listener);
    }

    removeRasterizeListener(listener) { this.#listeners.delete(listener); }

    getFont() { return this.#font; }
    getFontSize() { return this.#fontSize; }
    getFontWeight() { return this.#fontWeight; }

    // The TextureAtlas of glyphs, and its Material (for TextGlyphs2D)
    getTextureAtlas() { return this.#atlas; }
    getMaterial() { return this.#material; }

    // Design units
    getLineHeight() { return this.#lineHeight; }
    getPadding() { return this.#padding; }

    isLoaded() { return (this.#material !== null); }

    hasGlyph(char) { return this.#glyphs.has(char); }

    // The characters in the atlas, as one string
    getGlyphs() { return Array.from(this.#glyphs.keys()).join(""); }

    // { subTexture, advance, width, height } (design units) for char, or for the fallback if it isn't in the atlas; null if not loaded
    getGlyph(char) { return this.#glyphs.get(char) ?? this.#glyphs.get(TextAtlas.kFallbackChar) ?? null; }

    // How wide text is in design units, padding included (like TextGlyphs2D's width): its widest line, with "\n" / "\r\n" breaking lines
    measure(text)
    {
        if (this.isLoaded() === false || text == null)
            return 0;

        let widest = 0.0;

        for (const line of text.split(/\r?\n/))
        {
            let width = 0.0;

            for (const char of Array.from(line))
                width += this.getGlyph(char).advance;

            widest = Math.max(widest, width);
        }

        return widest + (this.#padding * 2.0);
    }

    // How tall text is in design units (like TextGlyphs2D's height): a line height per line
    measureHeight(text)
    {
        if (this.isLoaded() === false || text == null)
            return 0;

        return this.#lineHeight * text.split(/\r?\n/).length;
    }

    // Frees the atlas and Material, and stops following the view scale; TextGlyphs2Ds using it stop drawing
    unload()
    {
        WGLV.removeListeners(this.#viewListeners);

        if (this.#material !== null)
        {
            this.#material.unload(); // Leaves the shared shader alone
            this.#material = null;
        }

        if (this.#atlas !== null)
        {
            this.#atlas.unload();
            this.#atlas = null;
        }

        this.#glyphs.clear();
        this.#listeners.clear();
        this.#scale = 0.0;
    }

    // *** Internal Methods ***

    /*
        Draws every glyph into the shared TextCanvas, row by row, at the view's
        scale. The first time it builds the atlas and Material from it; after
        that it uploads into the same atlas Texture, so the Material is kept.
    */
    #build()
    {
        const chars = this.#chars;
        const c = TextCanvas.getCanvas();
        let ctx = c.getContext("2d");

        if (ctx === null)
        {
            console.error("TextAtlas couldn't get a 2D canvas");
                return false;
        }

        const scale = WGLV.getViewScale();
        const size = this.#fontSize * scale;
        const css = this.#font.toCss(size, this.#fontWeight);
        const pad = Math.ceil(TextCanvas.kPadding * scale);
        const cellHeight = TextCanvas.lineHeight(size) + (pad * 2);

        // Measure each glyph and lay them out in rows
        ctx.font = css;

        let cells = [];
        let x = 0;
        let y = 0;
        let canvasWidth = 1;

        for (const char of chars)
        {
            const advance = ctx.measureText(char).width;
            const cellWidth = Math.max(1, Math.ceil(advance) + (pad * 2));

            if (x > 0 && x + cellWidth > TextAtlas.#kMaxRowPixels)
            {
                x = 0;
                y += cellHeight;
            }

            cells.push({ char, advance, x, y, width: cellWidth });
            x += cellWidth;
            canvasWidth = Math.max(canvasWidth, x);
        }

        const canvasHeight = y + cellHeight;

        c.width = canvasWidth; // Resizing clears the canvas and resets the context state
        c.height = canvasHeight;

        ctx.font = css;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#ffffff";

        // Draw them, and describe each as an AtlasSubTexture (V up, so the canvas's top row is V 1)
        let textures = {};

        for (const cell of cells)
        {
            ctx.fillText(cell.char, cell.x + pad, cell.y + (cellHeight / 2.0));

            textures[cell.char] = {
                width: cell.width,
                height: cellHeight,
                uvs: {
                    u0: cell.x / canvasWidth,
                    v0: 1.0 - ((cell.y + cellHeight) / canvasHeight),
                    u1: (cell.x + cell.width) / canvasWidth,
                    v1: 1.0 - (cell.y / canvasHeight)
                }
            };
        }

        const name = `${this.#font.getFamily()} ${this.#fontSize} ${this.#fontWeight}`;

        if (this.#atlas !== null)
        {
            // Drawn again: same atlas Texture, so the Material (and every model holding it) stays valid
            if (this.#atlas.updateCanvas(c, textures) === false)
            {
                console.error(`TextAtlas couldn't draw "${name}" again`);
                    return false;
            }
        }
        else
        {
            let atlas = new TextureAtlas(false); // No mipmaps: it's drawn near the size it's rasterized

            if (atlas.loadCanvas(c, textures, name) === false)
            {
                console.error("TextAtlas couldn't build its texture");
                    return false;
            }

            const shader = TextGlyphs2D.getDefaultShader(); // Rect2D's, plus a color per glyph
            let material = new Material();

            if (shader === null || material.load(shader, [atlas.getTexture()]) === false)
            {
                console.error("TextAtlas couldn't create its material");
                atlas.unload();
                    return false;
            }

            this.#atlas = atlas;
            this.#material = material;
        }

        const atlas = this.#atlas;
        this.#scale = scale;
        this.#lineHeight = cellHeight / scale;
        this.#padding = pad / scale;
        this.#glyphs.clear();

        for (const cell of cells)
        {
            this.#glyphs.set(cell.char, {
                subTexture: atlas.getSubTexture(cell.char),
                advance: cell.advance / scale,
                width: cell.width / scale,
                height: cellHeight / scale
            });
        }

        return true;
    }
}
