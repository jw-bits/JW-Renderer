"use strict";

/*
    CheckBox - A box that's checked or not: tapping or clicking it flips it.

    The box is square (corner radius 0) or a rounded rect, always with an
    outline of its own color around it. The check is centered in the box and
    is one of:
        A texture       Given to load(), e.g. a tick mark; fills the inside of the box, tinted by the
                        check color (white by default)
        A rounded rect  When no texture is given: one solid color (the check color), filling 80% of
                        the inside of the box

    Built from RoundedRect2Ds on a white texture (tinted), plus a Rect2D for a
    texture check.

    Usage:
        let box = new CheckBox();
        box.load(48, 10);                 // 48 x 48 design units, corners of 10
        box.load(48, 0, tickTexture);     // Or square, with a texture check
        box.setPos(400, 300, Alignment.kMiddleCenter);
        box.setOnChange((checkBox, isChecked) => settings.music = isChecked);

        // Each frame, after InputManager.update()
        box.update(dt);
        box.submit(batcher, 4); // Box on layer 4, check on layer 5. Or box.render()

    Input: update() reads InputManager (input_manager.js must be loaded and
    InputManager.init() called). A press that starts and is released inside
    the box flips it. setEnabled(false) ignores input.

    Changing it: toggle() flips it and calls the onChange callback;
    setChecked() sets it without calling it (e.g. loading a saved setting).

    Position: setPos(x, y, align) places the whole box, outline included. A
    CheckBox doesn't scale or rotate.
*/
class CheckBox
{
    static kCheckFill = 0.8;                // A shape check's size, as a fraction of the inside of the box (a texture check fills it)
    static kDefaultOutlineWidth = 3;        // Design units

    static #kSegments = 8;                  // Triangles per rounded corner
    static #kSquareCheckRadius = 0.15;      // A shape check in a square box: its corners, as a fraction of its size

    #material;      // The white texture on Rect2D's shader, shared by the shapes so they draw in order
    #outline;       // RoundedRect2D, the whole box
    #box;           // RoundedRect2D, inside the outline
    #check;         // RoundedRect2D (no texture) or Rect2D (texture)
    #checkTexture;  // Given to load(), or null for a shape check

    // Where each part is drawn: the outline and box by their bottom-left corners, the check by its center
    #outlineTransform;
    #boxTransform;
    #checkTransform;

    #size;          // Design units, outline included
    #radius;        // Of the outer corners; 0 is square
    #outlineWidth;

    #anchor;        // Vector2: where setPos() put it
    #align;         // Which part of the box sits on the anchor

    #isChecked;
    #isEnabled;
    #pressedInside; // The pointer was pressed inside, so a release inside flips it
    #onChange;      // (checkBox, isChecked), or null

    #outlineColor;  // Vector4s
    #boxColor;
    #checkColor;

    #isLoaded;

    constructor()
    {
        this.#material = null;
        this.#outline = new RoundedRect2D();
        this.#box = new RoundedRect2D();
        this.#check = null;
        this.#checkTexture = null;

        this.#outlineTransform = new Transform2D();
        this.#boxTransform = new Transform2D();
        this.#checkTransform = new Transform2D();

        this.#size = 0;
        this.#radius = 0;
        this.#outlineWidth = CheckBox.kDefaultOutlineWidth;

        this.#anchor = new Vector2();
        this.#align = Alignment.kBottomLeft;

        this.#isChecked = false;
        this.#isEnabled = true;
        this.#pressedInside = false;
        this.#onChange = null;

        this.#outlineColor = new Vector4(0.15, 0.15, 0.15, 1.0);
        this.#boxColor = new Vector4(1.0, 1.0, 1.0, 1.0);
        this.#checkColor = new Vector4(0.0, 0.47, 0.95, 1.0); // Blue for a shape check

        this.#isLoaded = false;
    }

    /*
        size is the box's width and height in design units, outline included.
        cornerRadius rounds the corners (0 is square; clamped to half the size).
        checkTexture (a loaded Texture or AtlasSubTexture) draws the check; null makes
        it a solid rounded rect. Starts unchecked. Returns false on failure.
    */
    load(size, cornerRadius = 0, checkTexture = null)
    {
        if (this.#isLoaded === true)
            return false; // Unload first

        if (Number.isFinite(size) === false || size <= 0 || Number.isFinite(cornerRadius) === false || cornerRadius < 0)
        {
            console.error("CheckBox.load() needs a size above 0 and a corner radius of 0 or more");
                return false;
        }

        if (checkTexture !== null && ((checkTexture instanceof BaseTexture) === false || checkTexture.isLoaded() === false))
        {
            console.error("CheckBox.load(): the check texture isn't a loaded Texture");
                return false;
        }

        let material = new Material();

        if (material.load(Rect2D.getDefaultShader(), [TextureManager.getWhiteTexture()]) === false)
        {
            console.error("CheckBox.load() couldn't create its material (was WGLV.init() called first?)");
                return false;
        }

        this.#material = material;
        this.#size = size;
        this.#radius = Math.min(cornerRadius, size / 2.0);
        this.#checkTexture = checkTexture;

        // A texture check draws the texture as it is; a shape check is the default color
        if (checkTexture !== null)
            this.#checkColor.setRGBA(1.0, 1.0, 1.0, 1.0);

        this.#outlineWidth = Math.min(this.#outlineWidth, size / 4.0);

        if (this.#buildShapes() === false)
        {
            this.unload();
                return false;
        }

        this.#isLoaded = true;
        this.#layout();
            return true;
    }

    // (x, y) is the anchor point; align says which part of the box sits on it
    setPos(x, y, align = Alignment.kBottomLeft)
    {
        this.#anchor.setXY(x, y);
        this.#align = align;
        this.#layout();
    }

    getAnchor() { return this.#anchor; } // Read-only; change it with setPos()
    getAlignment() { return this.#align; }

    // The box's size (width and height), corner radius and bottom-left corner, design units
    getSize() { return this.#size; }
    getCornerRadius() { return this.#radius; }
    getX() { return this.#anchor.x + Alignment.offsetX(this.#align, this.#size); }
    getY() { return this.#anchor.y + Alignment.offsetY(this.#align, this.#size); }

    // Flips it and calls the onChange callback
    toggle()
    {
        this.setChecked(this.#isChecked === false);

        if (this.#onChange !== null)
            this.#onChange(this, this.#isChecked);
    }

    // Sets it without calling the onChange callback
    setChecked(checked) { this.#isChecked = (checked === true); }
    isChecked() { return this.#isChecked; }

    // fn(checkBox, isChecked) is called when tapping or toggle() flips it; null for none
    setOnChange(fn) { this.#onChange = fn ?? null; }

    // false ignores input (toggle() and setChecked() still work)
    setEnabled(enabled)
    {
        this.#isEnabled = (enabled === true);
        this.#pressedInside = false;
    }

    isEnabled() { return this.#isEnabled; }

    // *** Colors and outline ***

    // Vector4s (copied)
    setOutlineColor(color) { CheckBox.#copy(this.#outlineColor, color); }
    setBoxColor(color) { CheckBox.#copy(this.#boxColor, color); }

    // The shape check's color, or the texture check's tint
    setCheckColor(color) { CheckBox.#copy(this.#checkColor, color); }

    getOutlineColor() { return this.#outlineColor; }
    getBoxColor() { return this.#boxColor; }
    getCheckColor() { return this.#checkColor; }

    /*
        The outline's thickness in design units, inside the box's size (the
        inside shrinks to fit). Returns false if it's below 0.5 or above a
        quarter of the size.
    */
    setOutlineWidth(width)
    {
        const maxWidth = (this.#isLoaded === true) ? this.#size / 4.0 : Infinity;

        if (Number.isFinite(width) === false || width < 0.5 || width > maxWidth)
        {
            console.error("CheckBox.setOutlineWidth() needs a width from 0.5 to a quarter of the size");
                return false;
        }

        if (width === this.#outlineWidth)
            return true;

        this.#outlineWidth = width;

        if (this.#isLoaded === true)
        {
            if (this.#buildShapes() === false)
                return false;

            this.#layout();
        }

        return true;
    }

    getOutlineWidth() { return this.#outlineWidth; }

    // *** Each frame ***

    // True if (x, y), design units, is inside the box
    contains(x, y)
    {
        const left = this.getX();
        const bottom = this.getY();

        return (x >= left && x <= left + this.#size && y >= bottom && y <= bottom + this.#size);
    }

    // Reads the pointer from InputManager (call InputManager.update() first)
    update(dt)
    {
        if (this.#isLoaded === false || this.#isEnabled === false)
            return;

        const pos = InputManager.getPosition();
        const isInside = (InputManager.hasPosition() === true && this.contains(pos.x, pos.y));

        if (InputManager.wasPointerPressed() === true)
            this.#pressedInside = isInside;

        if (InputManager.wasPointerReleased() === true)
        {
            const flip = (this.#pressedInside === true && isInside === true);
            this.#pressedInside = false;

            if (flip === true)
                this.toggle();
        }
    }

    /*
        Queues it on a Batcher: the outline and box on layer, and the
        check (while checked) on checkLayer, one above by default, so it's
        always drawn over the box. Returns false if not loaded.
    */
    submit(batcher, layer, checkLayer = layer + 1)
    {
        if (this.#isLoaded === false)
            return false;

        batcher.submit(this.#outline, this.#outlineTransform, layer, null, this.#outlineColor);
        batcher.submit(this.#box, this.#boxTransform, layer, null, this.#boxColor);

        if (this.#isChecked === true)
            batcher.submit(this.#check, this.#checkTransform, checkLayer, null, this.#checkColor);

        return true;
    }

    // Draws it right away
    render()
    {
        if (this.#isLoaded === false)
            return;

        this.#outline.render(this.#outlineTransform, null, this.#outlineColor);
        this.#box.render(this.#boxTransform, null, this.#boxColor);

        if (this.#isChecked === true)
            this.#check.render(this.#checkTransform, null, this.#checkColor);
    }

    isLoaded() { return this.#isLoaded; }

    // Frees the meshes and the CheckBox's own Material; the check texture belongs to the caller
    unload()
    {
        this.#outline.unload();
        this.#box.unload();
        this.#check?.unload();
        this.#check = null;
        this.#checkTexture = null;

        if (this.#material !== null)
        {
            this.#material.unload(); // Leaves the shared shader and the texture alone
            this.#material = null;
        }

        this.#pressedInside = false;
        this.#isLoaded = false;
    }

    // *** Internal Methods ***

    // (Re)builds the outline, box and check at the current size, corner radius and outline width
    #buildShapes()
    {
        const m = this.#material;
        const s = this.#size;
        const t = this.#outlineWidth;
        const seg = (this.#radius > 0.0) ? CheckBox.#kSegments : 1; // Square corners need no arc

        this.#outline.unload();
        this.#box.unload();
        this.#check?.unload();

        if (this.#outline.load(m, s, s, this.#radius, seg) === false)
            return false;

        // The inside: the outline's thickness in from every edge, its corners following the outline's
        const inner = s - (t * 2.0);
        const innerRadius = Math.max(0.0, this.#radius - t);

        if (this.#box.load(m, inner, inner, innerRadius, seg) === false)
            return false;

        // A texture check fills the inside of the box
        if (this.#checkTexture !== null)
        {
            this.#check = new Rect2D();
            this.#check.setAlignment(Alignment.kMiddleCenter);
                return this.#check.load(this.#checkTexture, inner, inner);
        }

        const c = inner * CheckBox.kCheckFill;

        // A solid rounded rect: corners in proportion to the box's, and still rounded in a square box
        const checkRadius = (innerRadius > 0.0) ? innerRadius * CheckBox.kCheckFill : c * CheckBox.#kSquareCheckRadius;

        this.#check = new RoundedRect2D();
        this.#check.setAlignment(Alignment.kMiddleCenter);
            return this.#check.load(m, c, c, checkRadius, CheckBox.#kSegments);
    }

    // Places every part
    #layout()
    {
        if (this.#isLoaded === false)
            return;

        const x = this.getX();
        const y = this.getY();
        const t = this.#outlineWidth;
        const center = this.#size / 2.0;

        this.#outlineTransform.setPosition(x, y);
        this.#boxTransform.setPosition(x + t, y + t);
        this.#checkTransform.setPosition(x + center, y + center);
    }

    // *** Static Internal Helpers ***

    static #copy(target, color) { target.set(color); }
}
