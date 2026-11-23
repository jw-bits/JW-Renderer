"use strict";

/*
    Button - A clickable button: a rounded rect (square, rounded or a pill)
    with an optional outline, holding text, an icon, or both side by side.
    Clicking or tapping it calls its onClick callback.

    States, each with its own colors for the background, outline and content
    (the text and icon tint), blended between quickly as the state changes:
        kNormal    Nothing's on it
        kHover     The pointer is over it (mouse or pen; touch has no hover)
        kPressed   Pressed inside it, and the pointer is still inside
        kDisabled  setEnabled(false)

    Clicks: a press that starts inside and is released inside clicks it.
    Sliding off while held lets it go back to normal, and releasing outside
    doesn't click; sliding back on presses it again.

    Press shrink (setPressShrink(true), off by default) scales the whole button
    to kPressedScale while it's pressed, about its center.

    Size: fixed (load()'s size, or setSize()), or setAutoSize(true) to fit
    the content plus padding (and the outline), so the button grows and
    shrinks with its text. The content is always centered.

    Built from RoundedRect2Ds on a white texture (tinted), a TextGlyphs2D for
    the text and a Rect2D for the icon.

    Usage:
        let b = new Button();
        b.load(200, 64, 12);                                    // Design units; corners of 12 (Button.kPill for a pill)
        b.setText(new TextAtlas(font, TextAtlas.kAscii, 28, "bold"), "Play");
        b.setIcon(playTexture, 32);                             // Optional, left of the text
        b.setAutoSize(true);                                    // Fit the content plus padding
        b.setPos(960, 300, Alignment.kMiddleCenter);
        b.setOnClick((button) => startGame());

        // Each frame, after InputManager.update()
        b.update(dt);
        b.submit(batcher, 4); // Background on layer 4, text and icon on layer 5. Or b.render()

    Input: update() reads InputManager (input_manager.js must be loaded and
    InputManager.init() called). Pointer only, for now.

    Position: setPos(x, y, align) places the whole button; align says which
    part of it sits on (x, y), and it stays that way as the button resizes.
*/
class Button
{
    // States
    static kNormal = 0;
    static kHover = 1;
    static kPressed = 2;
    static kDisabled = 3;

    static kPill = Infinity;       // A corner radius that rounds the ends fully
    static kPressedScale = 0.96;   // The button's scale while pressed, with press shrink on
    static kDefaultBlendTime = 0.08; // Seconds to blend to a new state's colors (and the press shrink)

    static #kSegments = 12;        // Triangles per rounded corner

    #material;      // The white texture on Rect2D's shader, shared by the shapes so they draw in order
    #outline;       // RoundedRect2D, the whole button; drawn only while the outline's width is above 0
    #background;    // RoundedRect2D, inside the outline
    #text;          // TextGlyphs2D, or null
    #icon;          // Rect2D, or null

    #width;         // Design units, outline included
    #height;
    #radius;        // As asked for (Button.kPill fits any size); clamped to the size when drawn
    #outlineWidth;
    #padding;       // Vector2: between the content and the outline, for auto size
    #iconGap;       // Between the icon and the text
    #isAutoSize;

    #anchor;        // Vector2: where setPos() put it
    #align;         // Which part of the button sits on the anchor

    #isEnabled;
    #isHeld;        // The pointer was pressed inside and is still down
    #isPressed;     // Held, and the pointer is inside
    #isHovered;
    #onClick;       // (button), or null

    #hasPressShrink;
    #scale;         // Now: 1, easing toward kPressedScale while pressed with press shrink on
    #blendTime;

    // Per state (indexed by kNormal - kDisabled), Vector4s, and the colors drawn now
    #backgroundColors;
    #outlineColors;
    #contentColors;
    #backgroundNow;
    #outlineNow;
    #contentNow;

    #isLoaded;

    constructor()
    {
        this.#material = null;
        this.#outline = new RoundedRect2D();
        this.#background = new RoundedRect2D();
        this.#text = null;
        this.#icon = null;

        this.#width = 0;
        this.#height = 0;
        this.#radius = 0;
        this.#outlineWidth = 0;
        this.#padding = new Vector2(20, 12);
        this.#iconGap = 10;
        this.#isAutoSize = false;

        this.#anchor = new Vector2();
        this.#align = Alignment.kBottomLeft;

        this.#isEnabled = true;
        this.#isHeld = false;
        this.#isPressed = false;
        this.#isHovered = false;
        this.#onClick = null;

        this.#hasPressShrink = false;
        this.#scale = 1.0;
        this.#blendTime = Button.kDefaultBlendTime;

        this.#backgroundColors = [new Vector4(0.20, 0.48, 0.90, 1.0),  // Normal: blue
                                  new Vector4(0.30, 0.58, 0.98, 1.0),  // Hover: lighter
                                  new Vector4(0.14, 0.36, 0.72, 1.0),  // Pressed: darker
                                  new Vector4(0.45, 0.47, 0.52, 1.0)]; // Disabled: grey
        this.#outlineColors = [new Vector4(0.08, 0.20, 0.45, 1.0),
                               new Vector4(0.08, 0.20, 0.45, 1.0),
                               new Vector4(0.08, 0.20, 0.45, 1.0),
                               new Vector4(0.33, 0.34, 0.38, 1.0)];
        this.#contentColors = [new Vector4(1.0, 1.0, 1.0, 1.0),
                               new Vector4(1.0, 1.0, 1.0, 1.0),
                               new Vector4(1.0, 1.0, 1.0, 1.0),
                               new Vector4(0.78, 0.78, 0.80, 1.0)];

        this.#backgroundNow = new Vector4();
        this.#outlineNow = new Vector4();
        this.#contentNow = new Vector4();

        this.#isLoaded = false;
    }

    /*
        width x height is the button in design units, outline included (until
        auto size changes it). cornerRadius rounds the corners: 0 is square,
        Button.kPill a pill. Returns false on failure.
    */
    load(width, height, cornerRadius = 0)
    {
        if (this.#isLoaded === true)
            return false; // Unload first

        if (Number.isFinite(width) === false || Number.isFinite(height) === false || width <= 0 || height <= 0 ||
            Number.isNaN(cornerRadius) === true || cornerRadius < 0)
        {
            console.error("Button.load() needs a width and height above 0 and a corner radius of 0 or more");
                return false;
        }

        let material = new Material();

        if (material.load(Rect2D.getDefaultShader(), [TextureManager.getWhiteTexture()]) === false)
        {
            console.error("Button.load() couldn't create its material (was WGLV.init() called first?)");
                return false;
        }

        // The shapes start at the given size; #resize() keeps them fitted from here on
        if (this.#outline.load(material, width, height, cornerRadius, Button.#kSegments) === false ||
            this.#background.load(material, width, height, cornerRadius, Button.#kSegments) === false)
        {
            this.#outline.unload();
            this.#background.unload();
            material.unload();
                return false;
        }

        this.#material = material;
        this.#width = width;
        this.#height = height;
        this.#radius = cornerRadius;
        this.#isLoaded = true;

        this.#snapColors();
        this.#refit();
            return true;
    }

    // (x, y) is the anchor point; align says which part of the button sits on it
    setPos(x, y, align = Alignment.kBottomLeft)
    {
        this.#anchor.set(x, y);
        this.#align = align;
        this.#layout();
    }

    getAnchor() { return this.#anchor; } // Read-only; change it with setPos()
    getAlignment() { return this.#align; }

    // The button's size and bottom-left corner, design units (unpressed)
    getWidth() { return this.#width; }
    getHeight() { return this.#height; }
    getX() { return this.#anchor.x + Alignment.offsetX(this.#align, this.#width); }
    getY() { return this.#anchor.y + Alignment.offsetY(this.#align, this.#height); }

    // *** Content ***

    /*
        Text from textAtlas (white glyphs, tinted by the content color); null or ""
        removes it. The TextAtlas belongs to the caller. Returns false if the text
        couldn't be set.
    */
    setText(textAtlas, text)
    {
        if (textAtlas === null || text == null || text === "")
        {
            this.#text?.unload();
            this.#text = null;
            this.#refit();
                return true;
        }

        if (this.#text === null || this.#text.getTextAtlas() !== textAtlas)
        {
            this.#text?.unload();
            this.#text = new TextGlyphs2D(textAtlas);
        }

        if (this.#text.setText(text) === false)
        {
            console.error("Button.setText() couldn't set the text");
                return false;
        }

        this.#refit();
            return true;
    }

    getText() { return this.#text?.getText() ?? null; }

    /*
        An icon: texture (a loaded Texture or SubTexture) drawn width x height design
        units, left of the text, tinted by the content color (keep that white for the
        icon's own colors); null removes it. Returns false on failure.
    */
    setIcon(texture, width, height = width)
    {
        this.#icon?.unload();
        this.#icon = null;

        if (texture === null)
        {
            this.#refit();
                return true;
        }

        let icon = new Rect2D();

        if (icon.load(texture, width, height) === false)
        {
            console.error("Button.setIcon() needs a loaded texture and a size above 0");
            this.#refit();
                return false;
        }

        this.#icon = icon;
        this.#refit();
            return true;
    }

    // Design units between the icon and the text, when it has both
    setIconGap(gap)
    {
        this.#iconGap = Math.max(0, gap);
        this.#refit();
    }

    // Keeps the text sharp when the view's scale changes (see TextGlyphs2D.listenForRasterScale())
    listenForRasterScale(listen) { this.#text?.listenForRasterScale(listen); }

    // *** Size and shape ***

    // A fixed size, outline included; turns auto size off. Returns false if it isn't above 0.
    setSize(width, height)
    {
        if (Number.isFinite(width) === false || Number.isFinite(height) === false || width <= 0 || height <= 0)
        {
            console.error("Button.setSize() needs a width and height above 0");
                return false;
        }

        this.#isAutoSize = false;
        this.#width = width;
        this.#height = height;
        this.#refit();
            return true;
    }

    // true fits the button to its content plus padding and the outline, whenever they change
    setAutoSize(autoSize)
    {
        this.#isAutoSize = (autoSize === true);
        this.#refit();
    }

    isAutoSize() { return this.#isAutoSize; }

    // Design units between the content and the outline, used by auto size: x left and right, y top and bottom
    setPadding(x, y = x)
    {
        this.#padding.set(Math.max(0, x), Math.max(0, y));
        this.#refit();
    }

    getPadding() { return this.#padding; } // Read-only; change it with setPadding()

    // 0 is square, Button.kPill a pill
    setCornerRadius(radius)
    {
        if (Number.isNaN(radius) === true || radius < 0)
        {
            console.error("Button.setCornerRadius() needs a radius of 0 or more");
                return false;
        }

        this.#radius = radius;
        this.#refit();
            return true;
    }

    // *** Colors and outline ***

    /*
        The colors for each state, Vector4s (copied): kNormal, kHover, kPressed,
        kDisabled. Pass null (or leave one off) to keep that state's color.
    */
    setBackgroundColors(normal, hover = null, pressed = null, disabled = null)
    {
        Button.#copyColors(this.#backgroundColors, [normal, hover, pressed, disabled]);
    }

    // The text and icon tint
    setContentColors(normal, hover = null, pressed = null, disabled = null)
    {
        Button.#copyColors(this.#contentColors, [normal, hover, pressed, disabled]);
    }

    /*
        An outline width design units thick, inside the button's size; 0 removes it.
        Colors per state as for setBackgroundColors(). Returns false if the width
        is below 0.
    */
    setOutline(width, normal = null, hover = null, pressed = null, disabled = null)
    {
        if (Number.isFinite(width) === false || width < 0)
        {
            console.error("Button.setOutline() needs a width of 0 or more");
                return false;
        }

        Button.#copyColors(this.#outlineColors, [normal, hover, pressed, disabled]);
        this.#outlineWidth = width;
        this.#refit();
            return true;
    }

    getOutlineWidth() { return this.#outlineWidth; }

    // Seconds to blend to a new state's colors; 0 changes them at once
    setBlendTime(seconds) { this.#blendTime = Math.max(0, seconds); }

    // *** Behaviour ***

    // fn(button) is called when it's clicked; null for none
    setOnClick(fn) { this.#onClick = fn ?? null; }

    // false greys it out (the kDisabled colors) and ignores input
    setEnabled(enabled)
    {
        this.#isEnabled = (enabled === true);

        if (this.#isEnabled === false)
        {
            this.#isHeld = false;
            this.#isPressed = false;
            this.#isHovered = false;
        }
    }

    isEnabled() { return this.#isEnabled; }
    isHovered() { return this.#isHovered; }
    isPressed() { return this.#isPressed; }

    // The state shown now: kNormal, kHover, kPressed or kDisabled
    getState()
    {
        if (this.#isEnabled === false)
            return Button.kDisabled;

        if (this.#isPressed === true)
            return Button.kPressed;

        return (this.#isHovered === true) ? Button.kHover : Button.kNormal;
    }

    // Scales the button to kPressedScale while it's pressed (off by default)
    setPressShrink(enabled) { this.#hasPressShrink = (enabled === true); }
    hasPressShrink() { return this.#hasPressShrink; }

    // *** Each frame ***

    // True if (x, y), design units, is inside the button's box (unpressed)
    contains(x, y)
    {
        const left = this.getX();
        const bottom = this.getY();

        return (x >= left && x <= left + this.#width && y >= bottom && y <= bottom + this.#height);
    }

    // Reads the pointer from InputManager (call InputManager.update() first), clicks, and blends toward the state
    update(dt)
    {
        if (this.#isLoaded === false)
            return;

        const clicked = this.#handleInput();

        // Ease toward the state's colors and scale
        const k = (this.#blendTime > 0.0) ? Math.min(1.0, dt / this.#blendTime) : 1.0;
        const state = this.getState();
        const scale = (this.#hasPressShrink === true && this.#isPressed === true) ? Button.kPressedScale : 1.0;

        Button.#approach(this.#backgroundNow, this.#backgroundColors[state], k);
        Button.#approach(this.#outlineNow, this.#outlineColors[state], k);
        Button.#approach(this.#contentNow, this.#contentColors[state], k);
        this.#scale += (scale - this.#scale) * k;

        this.#layout();

        if (clicked === true && this.#onClick !== null)
            this.#onClick(this);
    }

    /*
        Queues it on a MaterialBatcher: the outline and background on layer, the
        icon and text on contentLayer, one above by default. Returns false if not
        loaded.
    */
    submit(batcher, layer, contentLayer = layer + 1)
    {
        if (this.#isLoaded === false)
            return false;

        if (this.#outlineWidth > 0.0)
            batcher.submit(this.#outline, layer);

        batcher.submit(this.#background, layer);

        if (this.#icon !== null)
            batcher.submit(this.#icon, contentLayer);

        if (this.#text !== null)
            batcher.submit(this.#text, contentLayer);

        return true;
    }

    // Draws it right away
    render()
    {
        if (this.#isLoaded === false)
            return;

        if (this.#outlineWidth > 0.0)
            this.#outline.render();

        this.#background.render();
        this.#icon?.render();
        this.#text?.render();
    }

    isLoaded() { return this.#isLoaded; }

    // Frees the meshes and the button's own Material; the icon texture and TextAtlas belong to the caller
    unload()
    {
        this.#outline.unload();
        this.#background.unload();
        this.#text?.unload();
        this.#icon?.unload();
        this.#text = null;
        this.#icon = null;

        if (this.#material !== null)
        {
            this.#material.unload(); // Leaves the shared shader and the texture alone
            this.#material = null;
        }

        this.#isHeld = false;
        this.#isPressed = false;
        this.#isHovered = false;
        this.#isLoaded = false;
    }

    // *** Internal Methods ***

    // Updates hover and press from the pointer; returns true if this frame's release clicked it
    #handleInput()
    {
        if (this.#isEnabled === false)
            return false;

        const pos = InputManager.getPosition();
        const isInside = (InputManager.hasPosition() === true && this.contains(pos.x, pos.y));
        let clicked = false;

        if (InputManager.wasPointerPressed() === true)
            this.#isHeld = isInside;

        if (InputManager.wasPointerReleased() === true)
        {
            clicked = (this.#isHeld === true && isInside === true);
            this.#isHeld = false;
        }

        const isDown = InputManager.isPointerDown();

        this.#isPressed = (this.#isHeld === true && isDown === true && isInside === true);

        // Hover is for a pointer that can hover (not touch), and not while another press is held elsewhere
        this.#isHovered = (isInside === true && InputManager.getDevice() !== InputDevice.kTouch &&
                           (isDown === false || this.#isHeld === true));
            return clicked;
    }

    // The content's size: the icon, the gap if there's text too, and the text
    #contentWidth()
    {
        const iconW = this.#icon?.getWidth() ?? 0;
        const textW = this.#text?.getWidth() ?? 0;
        const gap = (this.#icon !== null && this.#text !== null) ? this.#iconGap : 0;
            return iconW + gap + textW;
    }

    #contentHeight() { return Math.max(this.#icon?.getHeight() ?? 0, this.#text?.getHeight() ?? 0); }

    // Works out the size (auto size), refits the shapes to it, then lays everything out
    #refit()
    {
        if (this.#isLoaded === false)
            return;

        const t = this.#outlineWidth;

        if (this.#isAutoSize === true && (this.#icon !== null || this.#text !== null))
        {
            this.#width = this.#contentWidth() + ((this.#padding.x + t) * 2.0);
            this.#height = this.#contentHeight() + ((this.#padding.y + t) * 2.0);
        }

        // The background sits inside the outline, its corners following the outline's
        const w = this.#width;
        const h = this.#height;
        const r = Math.min(this.#radius, w / 2.0, h / 2.0);
        const iw = Math.max(1, w - (t * 2.0));
        const ih = Math.max(1, h - (t * 2.0));

        this.#outline.setSize(w, h, r);
        this.#background.setSize(iw, ih, Math.max(0, r - t));
        this.#layout();
    }

    // Places every part about the button's center, scaled by the press shrink, and sets the colors
    #layout()
    {
        if (this.#isLoaded === false)
            return;

        const s = this.#scale;
        const cx = this.getX() + (this.#width / 2.0);
        const cy = this.getY() + (this.#height / 2.0);

        for (const shape of [this.#outline, this.#background])
        {
            shape.setPos(cx, cy, Alignment.kMiddleCenter);
            shape.setScale(s);
        }

        this.#outline.setColor(this.#outlineNow);
        this.#background.setColor(this.#backgroundNow);

        // The content, centered: the icon on the left, the text on the right
        const half = this.#contentWidth() / 2.0;

        if (this.#icon !== null)
        {
            const offset = -half + (this.#icon.getWidth() / 2.0);

            this.#icon.setPos(cx + (offset * s), cy, Alignment.kMiddleCenter);
            this.#icon.setScale(s);
            this.#icon.setColor(this.#contentNow);
        }

        if (this.#text !== null)
        {
            const offset = half - (this.#text.getWidth() / 2.0);

            this.#text.setPos(cx + (offset * s), cy, Alignment.kMiddleCenter);
            this.#text.setScale(s);
            this.#text.setColor(this.#contentNow);
        }
    }

    // Starts the colors at the current state's, with no blend
    #snapColors()
    {
        const state = this.getState();

        Button.#approach(this.#backgroundNow, this.#backgroundColors[state], 1.0);
        Button.#approach(this.#outlineNow, this.#outlineColors[state], 1.0);
        Button.#approach(this.#contentNow, this.#contentColors[state], 1.0);
    }

    // *** Static Internal Helpers ***

    // Copies each color given (skipping null and undefined) into the matching target
    static #copyColors(targets, colors)
    {
        for (let i = 0; i < targets.length; ++i)
        {
            const c = colors[i];

            if (c !== null && c !== undefined)
                targets[i].set(c.x, c.y, c.z, c.w);
        }
    }

    // Moves now toward target by k (0 - 1)
    static #approach(now, target, k)
    {
        now.set(now.x + ((target.x - now.x) * k), now.y + ((target.y - now.y) * k),
                now.z + ((target.z - now.z) * k), now.w + ((target.w - now.w) * k));
    }
}
