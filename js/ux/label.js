"use strict";

/*
    Label - Text on a panel: a TextGlyphs2D with a Rect2D behind it that's
    always fitted around the text plus padding. Changing the text, padding or
    position refits the panel, so it never needs sizing by hand.

    The panel is a Rect2D tinted by the panel color: a solid color by default
    (the white texture), or drawn with a panel texture given to the
    constructor. The text is white glyphs from the TextAtlas, tinted by the
    text color.

    Usage:
        const atlas = new TextAtlas(font, TextAtlas.kAscii, 16);
        let label = new Label(atlas);                // Or new Label(atlas, panelTexture)
        label.setPanelColor(new Vector4(0, 0, 0, 0.75));
        label.setPadding(8);
        label.setPos(10, 1070, Alignment.kTopLeft); // The panel's top-left corner sits on (10, 1070)
        label.setText("FPS 60");                    // isLoaded() is true once this succeeds

        // Each frame
        label.submit(batcher, 6);                   // Panel on layer 6, text on layer 7. Or label.render()

    Position: setPos(x, y, align) places the whole label: align says which
    part of the panel sits on (x, y), and it stays that way as the text
    changes size (a centered label stays centered). The text sits inside the
    panel's padding, its lines lined up by setLineAlignment() (left by
    default).

    A Label doesn't scale or rotate. The TextAtlas and any panel texture
    belong to the caller; unload() the Label before them.
*/
class Label
{
    #panel;      // Rect2D, fitted around the text
    #text;       // TextGlyphs2D
    #anchor;     // Vector2: where setPos() put it
    #align;      // Which part of the panel sits on the anchor
    #padding;    // Vector2, design units between the text and the panel's edges

    // _textAtlas draws the text; _panelTexture (a loaded BaseTexture) draws the panel, or null for a solid color
    constructor(_textAtlas, _panelTexture = null)
    {
        this.#anchor = new Vector2();
        this.#align = Alignment.kBottomLeft;
        this.#padding = new Vector2(8, 8);

        this.#text = new TextGlyphs2D(_textAtlas);
        this.#panel = new Rect2D();

        const panelTexture = _panelTexture ?? TextureManager.getWhiteTexture();

        if (this.#panel.load(panelTexture, 1, 1) === false) // 1 x 1 until the text is set
            console.error("Label needs a loaded panel texture (or null for a solid color)");
    }

    // Returns false if the text couldn't be set (see TextGlyphs2D.setText()); the panel is refitted
    setText(text)
    {
        if (this.#text.setText(text) === false)
            return false;

        this.#layout();
            return true;
    }

    getText() { return this.#text.getText(); }

    // (x, y) is the anchor point; align says which part of the panel sits on it
    setPos(x, y, align = Alignment.kBottomLeft)
    {
        this.#anchor.set(x, y);
        this.#align = align;
        this.#layout();
    }

    getAnchor() { return this.#anchor; }  // Read-only; change it with setPos()
    getAlignment() { return this.#align; }

    // Design units between the text and the panel's edges: x left and right, y top and bottom
    setPadding(x, y = x)
    {
        if (Number.isFinite(x) === false || Number.isFinite(y) === false || x < 0 || y < 0)
        {
            console.error("Label.setPadding() needs a padding of 0 or more");
                return false;
        }

        this.#padding.set(x, y);
        this.#layout();
            return true;
    }

    getPadding() { return this.#padding; } // Read-only; change it with setPadding()

    // Tints, as Vector4s (copied)
    setTextColor(color) { this.#text.setColor(color); }
    setPanelColor(color) { this.#panel.setColor(color); }

    getTextColor() { return this.#text.getColor(); }
    getPanelColor() { return this.#panel.getColor(); }

    // How the text's lines line up inside the panel, by an Alignment's column (see TextGlyphs2D)
    setLineAlignment(align)
    {
        this.#text.setLineAlignment(align);
        this.#layout();
    }

    // Keeps the text sharp when the view's scale changes (see TextGlyphs2D.listenForRasterScale())
    listenForRasterScale(listen) { this.#text.listenForRasterScale(listen); }

    // The panel's size and bottom-left corner, design units
    getWidth() { return this.#panel.getWidth(); }
    getHeight() { return this.#panel.getHeight(); }
    getX() { return this.#panel.getX(); }
    getY() { return this.#panel.getY(); }

    // True once text has been set
    isLoaded() { return (this.#text.isLoaded() === true && this.#panel.isLoaded() === true); }

    /*
        Queues the label on a MaterialBatcher: the panel on panelLayer and the
        text on textLayer, one above it by default, so the text is always drawn
        over the panel. Returns false if not loaded.
    */
    submit(batcher, panelLayer, textLayer = panelLayer + 1)
    {
        if (this.isLoaded() === false)
            return false;

        batcher.submit(this.#panel, panelLayer);
        batcher.submit(this.#text, textLayer);
            return true;
    }

    // Draws the panel, then the text, right away
    render()
    {
        if (this.isLoaded() === false)
            return;

        this.#panel.render();
        this.#text.render();
    }

    // Frees the panel's and text's meshes; the TextAtlas and panel texture belong to the caller
    unload()
    {
        this.#text.unload();
        this.#panel.unload();
    }

    // *** Internal Methods ***

    // Fits the panel around the text and puts both where setPos() says
    #layout()
    {
        if (this.isLoaded() === false)
            return;

        const p = this.#padding;

        this.#panel.setSize(this.#text.getWidth() + (p.x * 2.0), this.#text.getHeight() + (p.y * 2.0));
        this.#panel.setPos(this.#anchor.x, this.#anchor.y, this.#align);
        this.#text.setPos(this.#panel.getX() + p.x, this.#panel.getY() + p.y, Alignment.kBottomLeft);
    }
}
