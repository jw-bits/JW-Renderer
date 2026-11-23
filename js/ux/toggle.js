"use strict";

/*
    Toggle - An on / off switch: a pill-shaped track with a round knob that
    slides right when it's on and left when it's off. Tapping or clicking it
    flips it, and the knob eases across while the colors blend.

    Built from RoundedRect2Ds on a white texture (tinted), so every part is a
    solid color:
        Track and knob  Always drawn; each has an on color and an off color
        Outline         Optional: a border of the given thickness, inside the toggle's size
        Text            Optional: TextGlyphs2Ds from a TextAtlas, e.g. "ON" beside the knob
                        when on and "OFF" when off; they cross-fade as it flips

    Usage:
        let t = new Toggle();
        t.load(120, 56); // Design units, outline included
        t.setPos(400, 300, Alignment.kMiddleCenter);
        t.setOnChange((toggle, isOn) => sound.setMuted(isOn === false));

        // Optional parts
        t.setOutline(5, Vector4.kBlack, Vector4.kBlack);
        t.setText(new TextAtlas(font, "ONF", 26, "bold"), "ON", "OFF");

        // Each frame, after InputManager.update()
        t.update(dt);
        t.submit(batcher, 4); // Shapes on layer 4, text on layer 5. Or t.render()

    Input: update() reads InputManager (input_manager.js must be loaded and
    InputManager.init() called). A press that starts and is released inside
    the toggle flips it. setEnabled(false) ignores input.

    Changing it: toggle() flips it and calls the onChange callback; setOn()
    sets it without calling it (e.g. loading a saved setting).

    Position: setPos(x, y, align) places the whole toggle; align says which
    part of it sits on (x, y). A Toggle doesn't scale or rotate.
*/
class Toggle
{
    static kDefaultSlideTime = 0.15; // Seconds for the knob to cross

    static #kKnobInset = 0.1;  // Gap around the knob, as a fraction of the track's height
    static #kSegments = 16;    // Triangles per rounded corner, so the knob is a smooth circle
    static #kScratch = new Vector4();

    #material;     // The white texture on Rect2D's shader, shared by the shapes so they draw in order
    #outline;      // RoundedRect2D; loaded only while the outline is on
    #track;        // RoundedRect2D
    #knob;         // RoundedRect2D, a circle
    #onText;       // TextGlyphs2D, or null without text
    #offText;

    #width;        // Design units, outline included
    #height;
    #outlineWidth; // Design units; 0 is no outline

    #anchor;       // Vector2: where setPos() put it
    #align;        // Which part of the toggle sits on the anchor

    #isOn;
    #amount;       // Where the knob is: 0 all the way off (left) - 1 all the way on (right)
    #slideTime;
    #isEnabled;
    #pressedInside; // The pointer was pressed inside, so a release inside flips it
    #onChange;      // (toggle, isOn), or null

    // On / off colors, Vector4s
    #trackOn;
    #trackOff;
    #knobOn;
    #knobOff;
    #outlineOn;
    #outlineOff;
    #textOn;
    #textOff;

    #isLoaded;

    constructor()
    {
        this.#material = null;
        this.#outline = new RoundedRect2D();
        this.#track = new RoundedRect2D();
        this.#knob = new RoundedRect2D();
        this.#onText = null;
        this.#offText = null;

        this.#width = 0;
        this.#height = 0;
        this.#outlineWidth = 0;

        this.#anchor = new Vector2();
        this.#align = Alignment.kBottomLeft;

        this.#isOn = false;
        this.#amount = 0.0;
        this.#slideTime = Toggle.kDefaultSlideTime;
        this.#isEnabled = true;
        this.#pressedInside = false;
        this.#onChange = null;

        this.#trackOn = new Vector4(0.0, 0.84, 0.31, 1.0);  // Green
        this.#trackOff = new Vector4(0.93, 0.93, 0.93, 1.0); // Light grey
        this.#knobOn = new Vector4(1.0, 1.0, 1.0, 1.0);
        this.#knobOff = new Vector4(1.0, 1.0, 1.0, 1.0);
        this.#outlineOn = new Vector4(0.0, 0.0, 0.0, 1.0);
        this.#outlineOff = new Vector4(0.0, 0.0, 0.0, 1.0);
        this.#textOn = new Vector4(1.0, 1.0, 1.0, 1.0);
        this.#textOff = new Vector4(0.0, 0.0, 0.0, 1.0);

        this.#isLoaded = false;
    }

    /*
        width x height is the whole toggle in design units, outline included,
        wider than it is tall. Starts off. Returns false on failure.
    */
    load(width, height)
    {
        if (this.#isLoaded === true)
            return false; // Unload first

        if (Number.isFinite(width) === false || Number.isFinite(height) === false || height <= 0 || width < height)
        {
            console.error("Toggle.load() needs a height above 0 and a width at least as big");
                return false;
        }

        let material = new Material();

        if (material.load(Rect2D.getDefaultShader(), [TextureManager.getWhiteTexture()]) === false)
        {
            console.error("Toggle.load() couldn't create its material (was WGLV.init() called first?)");
                return false;
        }

        this.#material = material;
        this.#width = width;
        this.#height = height;

        if (this.#buildShapes() === false)
        {
            this.unload();
                return false;
        }

        this.#isLoaded = true;
        this.#layout();
            return true;
    }

    // (x, y) is the anchor point; align says which part of the toggle sits on it
    setPos(x, y, align = Alignment.kBottomLeft)
    {
        this.#anchor.set(x, y);
        this.#align = align;
        this.#layout();
    }

    getAnchor() { return this.#anchor; } // Read-only; change it with setPos()
    getAlignment() { return this.#align; }

    // The whole toggle's size and bottom-left corner, design units
    getWidth() { return this.#width; }
    getHeight() { return this.#height; }
    getX() { return this.#anchor.x + Alignment.offsetX(this.#align, this.#width); }
    getY() { return this.#anchor.y + Alignment.offsetY(this.#align, this.#height); }

    // Flips it, sliding the knob across, and calls the onChange callback
    toggle()
    {
        this.setOn(this.#isOn === false);

        if (this.#onChange !== null)
            this.#onChange(this, this.#isOn);
    }

    // Sets it without calling the onChange callback; instant puts the knob there right away
    setOn(on, instant = false)
    {
        this.#isOn = (on === true);

        if (instant === true)
        {
            this.#amount = (this.#isOn === true) ? 1.0 : 0.0;
            this.#layout();
        }
    }

    isOn() { return this.#isOn; }

    // fn(toggle, isOn) is called when tapping or toggle() flips it; null for none
    setOnChange(fn) { this.#onChange = fn ?? null; }

    // false ignores input (toggle() and setOn() still work)
    setEnabled(enabled)
    {
        this.#isEnabled = (enabled === true);
        this.#pressedInside = false;
    }

    isEnabled() { return this.#isEnabled; }

    // Seconds for the knob to cross; 0 jumps
    setSlideTime(seconds)
    {
        if (Number.isFinite(seconds) === false || seconds < 0.0)
        {
            console.error("Toggle.setSlideTime() needs a time of 0 or more");
                return false;
        }

        this.#slideTime = seconds;
            return true;
    }

    getSlideTime() { return this.#slideTime; }

    // *** Colors and optional parts ***

    // Vector4s (copied); the track blends from off to on as the knob crosses
    setTrackColors(onColor, offColor)
    {
        Toggle.#copy(this.#trackOn, onColor);
        Toggle.#copy(this.#trackOff, offColor);
        this.#layout();
    }

    setKnobColors(onColor, offColor)
    {
        Toggle.#copy(this.#knobOn, onColor);
        Toggle.#copy(this.#knobOff, offColor);
        this.#layout();
    }

    /*
        A border thickness design units wide, inside the toggle's size (the track
        shrinks to fit inside it); 0 removes it. Colors are Vector4s (copied).
        Returns false if it's thicker than a third of the height, or not loaded.
    */
    setOutline(thickness, onColor = this.#outlineOn, offColor = this.#outlineOff)
    {
        if (this.#isLoaded === false)
        {
            console.error("Toggle.setOutline(): load it first");
                return false;
        }

        if (Number.isFinite(thickness) === false || thickness < 0.0 || thickness > this.#height / 3.0)
        {
            console.error("Toggle.setOutline() needs a thickness from 0 to a third of the height");
                return false;
        }

        Toggle.#copy(this.#outlineOn, onColor);
        Toggle.#copy(this.#outlineOff, offColor);

        if (thickness !== this.#outlineWidth)
        {
            this.#outlineWidth = thickness;

            if (this.#buildShapes() === false)
                return false;
        }

        this.#layout();
            return true;
    }

    getOutlineWidth() { return this.#outlineWidth; }

    /*
        Text from textAtlas: onText beside the knob while on, offText while off
        (either can be ""); null removes the text. The TextAtlas belongs to the
        caller. Returns false if the text couldn't be set.
    */
    setText(textAtlas, onText = "ON", offText = "OFF")
    {
        this.#unloadText();

        if (textAtlas === null)
        {
            this.#layout();
                return true;
        }

        this.#onText = new TextGlyphs2D(textAtlas);
        this.#offText = new TextGlyphs2D(textAtlas);

        // An empty string has no glyphs to draw; leave that one unloaded
        if ((onText !== "" && this.#onText.setText(onText) === false) ||
            (offText !== "" && this.#offText.setText(offText) === false))
        {
            console.error("Toggle.setText() couldn't set the text");
            this.#unloadText();
                return false;
        }

        this.#layout();
            return true;
    }

    setTextColors(onColor, offColor)
    {
        Toggle.#copy(this.#textOn, onColor);
        Toggle.#copy(this.#textOff, offColor);
        this.#layout();
    }

    // Keeps the text sharp when the view's scale changes (see TextGlyphs2D.listenForRasterScale())
    listenForRasterScale(listen)
    {
        this.#onText?.listenForRasterScale(listen);
        this.#offText?.listenForRasterScale(listen);
    }

    // *** Each frame ***

    // True if (x, y), design units, is inside the toggle's box
    contains(x, y)
    {
        const left = this.getX();
        const bottom = this.getY();

        return (x >= left && x <= left + this.#width && y >= bottom && y <= bottom + this.#height);
    }

    // Reads the pointer from InputManager (call InputManager.update() first) and slides the knob
    update(dt)
    {
        if (this.#isLoaded === false)
            return;

        this.#handleInput();

        const target = (this.#isOn === true) ? 1.0 : 0.0;

        if (this.#amount !== target)
        {
            const step = (this.#slideTime > 0.0) ? (dt / this.#slideTime) : 1.0;

            this.#amount = (target > this.#amount) ? Math.min(target, this.#amount + step) : Math.max(target, this.#amount - step);
            this.#layout();
        }
    }

    /*
        Queues it on a MaterialBatcher: the shapes on layer (drawn in order:
        outline, track, knob) and the text on textLayer, one above by default.
        Returns false if not loaded.
    */
    submit(batcher, layer, textLayer = layer + 1)
    {
        if (this.#isLoaded === false)
            return false;

        for (const shape of this.#getShapes())
            batcher.submit(shape, layer);

        for (const text of this.#getVisibleTexts())
            batcher.submit(text, textLayer);

        return true;
    }

    // Draws it right away
    render()
    {
        if (this.#isLoaded === false)
            return;

        for (const shape of this.#getShapes())
            shape.render();

        for (const text of this.#getVisibleTexts())
            text.render();
    }

    isLoaded() { return this.#isLoaded; }

    // Frees the meshes and the toggle's own Material; the TextAtlas belongs to the caller
    unload()
    {
        this.#outline.unload();
        this.#track.unload();
        this.#knob.unload();
        this.#unloadText();

        if (this.#material !== null)
        {
            this.#material.unload(); // Leaves the shared shader and the texture alone
            this.#material = null;
        }

        this.#pressedInside = false;
        this.#isLoaded = false;
    }

    // *** Internal Methods ***

    // A press that starts inside and is released inside flips it
    #handleInput()
    {
        if (this.#isEnabled === false)
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

    // (Re)builds the outline, track and knob at the current size and outline width
    #buildShapes()
    {
        const m = this.#material;
        const t = this.#outlineWidth;
        const seg = Toggle.#kSegments;

        this.#outline.unload();
        this.#track.unload();
        this.#knob.unload();

        if (t > 0.0 && this.#outline.load(m, this.#width, this.#height, this.#height / 2.0, seg) === false)
            return false;

        const tw = this.#width - (t * 2.0);
        const th = this.#height - (t * 2.0);

        if (this.#track.load(m, tw, th, th / 2.0, seg) === false)
            return false;

        const d = th * (1.0 - (Toggle.#kKnobInset * 2.0));
            return this.#knob.load(m, d, d, d / 2.0, seg);
    }

    // Places every part and sets its color, from the position, the outline and how far the knob is across
    #layout()
    {
        if (this.#isLoaded === false)
            return;

        const c = Toggle.#kScratch;
        const e = Easing.ease(Easing.kSineInOut, this.#amount);
        const x = this.getX();
        const y = this.getY();

        if (this.#outline.isLoaded() === true)
        {
            this.#outline.setPos(x, y);
            this.#outline.setColor(Toggle.#lerp(c, this.#outlineOff, this.#outlineOn, e));
        }

        // The track, inside the outline
        const t = this.#outlineWidth;
        const tx = x + t;
        const ty = y + t;
        const tw = this.#width - (t * 2.0);
        const th = this.#height - (t * 2.0);

        this.#track.setPos(tx, ty);
        this.#track.setColor(Toggle.#lerp(c, this.#trackOff, this.#trackOn, e));

        // The knob, from the left end (off) to the right end (on)
        const inset = th * Toggle.#kKnobInset;
        const d = this.#knob.getWidth();

        this.#knob.setPos(tx + inset + ((tw - (inset * 2.0) - d) * e), ty + inset);
        this.#knob.setColor(Toggle.#lerp(c, this.#knobOff, this.#knobOn, e));

        // The text, centered in the space the knob leaves: on the left when on, the right when off
        const space = tw - inset - d;
        const cy = ty + (th / 2.0);

        if (this.#onText !== null)
        {
            this.#onText.setPos(tx + (space / 2.0), cy, Alignment.kMiddleCenter);
            this.#onText.setColor(Toggle.#faded(c, this.#textOn, e));
        }

        if (this.#offText !== null)
        {
            this.#offText.setPos(tx + inset + d + (space / 2.0), cy, Alignment.kMiddleCenter);
            this.#offText.setColor(Toggle.#faded(c, this.#textOff, 1.0 - e));
        }
    }

    // The shapes to draw, back to front
    #getShapes()
    {
        return (this.#outline.isLoaded() === true) ? [this.#outline, this.#track, this.#knob] : [this.#track, this.#knob];
    }

    // The texts that can be seen now: the on text fades in as the knob crosses, the off text out
    #getVisibleTexts()
    {
        let texts = [];

        if (this.#onText !== null && this.#onText.isLoaded() === true && this.#amount > 0.0)
            texts.push(this.#onText);

        if (this.#offText !== null && this.#offText.isLoaded() === true && this.#amount < 1.0)
            texts.push(this.#offText);

        return texts;
    }

    #unloadText()
    {
        this.#onText?.unload();
        this.#offText?.unload();
        this.#onText = null;
        this.#offText = null;
    }

    // *** Static Internal Helpers ***

    static #copy(target, color) { target.set(color.x, color.y, color.z, color.w); }

    // a blended toward b by t (0 - 1), written into out and returned
    static #lerp(out, a, b, t)
    {
        out.set(a.x + ((b.x - a.x) * t), a.y + ((b.y - a.y) * t),
                a.z + ((b.z - a.z) * t), a.w + ((b.w - a.w) * t));
            return out;
    }

    // color with its alpha times amount, written into out and returned
    static #faded(out, color, amount)
    {
        out.set(color.x, color.y, color.z, color.w * amount);
            return out;
    }
}
