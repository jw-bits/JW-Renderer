"use strict";

/*
    BaseTextEffect - Base class for an effect on a TextGlyphs2D:
        WaveTextEffect    Moves each glyph up and down on a sine wave
        FadeTextEffect    Fades the text in or out
        EaseTextEffect    Eases each glyph's color and scale
        ScrollTextEffect  Scrolls the text through a view rect, wrapping around

    One effect runs on a text at a time: to change effects, stop() the old one
    and make the new one.

    Any effect can also draw a drop shadow: the text a second time behind
    itself, offset and tinted. It's off until setDropShadowEnabled(true).

        fx.setDropShadow(4, -4, new Vector4(0, 0, 0, 0.6));
        fx.setDropShadowEnabled(true);

    The TextGlyphs2D belongs to the caller and keeps its own text, position,
    alignment and color; the effect works on top of them. The wave, scroll and
    ease change its glyphs (see TextGlyphs2D.setGlyphOffsets(), setGlyphScales()
    and setGlyphColors()) in update(), so after setText() they come back on the
    next update(); stop() puts them back.

    Usage:
        let title = new TextGlyphs2D(textAtlas);
        title.setText("CHECKERS");
        title.setPos(960, 700, Alignment.kMiddleCenter);

        let fx = new WaveTextEffect(title);
        fx.set(8, 0.5); // 8 design units, half a cycle per second

        // Each frame
        fx.update(dt);
        fx.submit(batcher, layer); // Or fx.render()

        // Changing effects
        fx.stop();
        fx = new FadeTextEffect(title);
        fx.fadeOut(1.0);

    Subclasses override what they need:
        _onUpdate(dt)   Advances the effect; called by update() with a TextGlyphs2D and a dt of 0 or more
        _onStop()       Stops the effect's own state; stop() then puts the glyphs back
        _getOpacity()   0 - 1, multiplied into the text's (and shadow's) alpha; 1 by default
    and can override submit() / render() to draw another way (see ScrollTextEffect).
*/
class BaseTextEffect
{
    // Scratch for #draw()
    static #kSavedColor = new Vector4();
    static #kDrawColor = new Vector4();

    #glyphs;         // The TextGlyphs2D, or null if it wasn't given one
    #isShadowOn;     // Drop shadow
    #shadowOffset;   // Vector2, design units
    #shadowColor;    // Vector4; its alpha is multiplied by the opacity

    // _glyphs is a TextGlyphs2D
    constructor(_glyphs)
    {
        this.#glyphs = _glyphs;

        if ((_glyphs instanceof TextGlyphs2D) === false)
        {
            console.error(`${this.constructor.name} needs a TextGlyphs2D`);
            this.#glyphs = null;
        }

        this.#isShadowOn = false;
        this.#shadowOffset = new Vector2(3, -3);
        this.#shadowColor = new Vector4(0, 0, 0, 0.6);
    }

    getGlyphs() { return this.#glyphs; }

    // *** Drop shadow ***

    setDropShadowEnabled(enabled) { this.#isShadowOn = (enabled === true); }
    isDropShadowEnabled() { return this.#isShadowOn; }

    // The shadow is offsetX / offsetY design units from the text (negative y is down), tinted color; doesn't turn it on
    setDropShadow(offsetX, offsetY, color)
    {
        this.#shadowOffset.set(offsetX, offsetY);
        this.#shadowColor.set(color.x, color.y, color.z, color.w);
    }

    getDropShadowOffset() { return this.#shadowOffset; }
    getDropShadowColor() { return this.#shadowColor; }

    // *** Each frame ***

    // Advances the effect by dt seconds
    update(dt)
    {
        if (this.#glyphs === null || Number.isFinite(dt) === false || dt < 0.0)
            return;

        this._onUpdate(dt);
    }

    // Stops the effect and puts the glyphs' offsets, scales and colors back
    stop()
    {
        this._onStop();

        if (this.#glyphs === null)
            return;

        this.#glyphs.setGlyphOffsets(null);
        this.#glyphs.setGlyphScales(null);
        this.#glyphs.setGlyphColors(null);
    }

    // Queues the text (and its shadow, behind it) on a Batcher layer
    submit(batcher, layer) { this.#draw((model) => batcher.submit(model, layer)); }

    // Draws the text (and its shadow, first) right away
    render() { this.#draw((model) => model.render()); }

    // *** Subclass Methods ***

    _onUpdate(dt) { }
    _onStop() { }
    _getOpacity() { return 1.0; }

    // True if there's a loaded TextGlyphs2D to draw
    _isDrawable() { return (this.#glyphs !== null && this.#glyphs.isLoaded() === true); }

    // *** Internal Methods ***

    // Draws the shadow then the text with drawFn, at the opacity, then puts the text's color and position back
    #draw(drawFn)
    {
        const opacity = this._getOpacity();

        if (this._isDrawable() === false || opacity <= 0.0)
            return;

        const g = this.#glyphs;
        const c = g.getColor();
        const saved = BaseTextEffect.#kSavedColor;
        const drawColor = BaseTextEffect.#kDrawColor;
        saved.set(c.x, c.y, c.z, c.w);

        if (this.#isShadowOn === true)
        {
            const anchor = g.getAnchor();
            const ax = anchor.x;
            const ay = anchor.y;
            const s = this.#shadowColor;

            drawColor.set(s.x, s.y, s.z, s.w * opacity);
            g.setColor(drawColor);
            g.setPos(ax + this.#shadowOffset.x, ay + this.#shadowOffset.y, g.getAlignment());
            drawFn(g);
            g.setPos(ax, ay, g.getAlignment());
        }

        drawColor.set(saved.x, saved.y, saved.z, saved.w * opacity);
        g.setColor(drawColor);
        drawFn(g);

        g.setColor(saved);
    }
}

/*
    WaveTextEffect - Moves each glyph up and down on a sine wave.

        let fx = new WaveTextEffect(title);
        fx.set(8, 0.5); // 8 design units, half a cycle per second
*/
class WaveTextEffect extends BaseTextEffect
{
    #amplitude; // Design units up and down
    #speed;     // Cycles per second
    #spacing;   // Radians of the wave between one glyph and the next
    #time;      // Seconds the wave has run
    #offsets;   // Float32Array: x, y per glyph

    // _glyphs is a TextGlyphs2D
    constructor(_glyphs)
    {
        super(_glyphs);

        this.#amplitude = 6.0;
        this.#speed = 1.0;
        this.#spacing = 0.6;
        this.#time = 0.0;
        this.#offsets = new Float32Array(0);
    }

    /*
        Each glyph moves up and down by amplitude design units, speed cycles
        per second. spacing is how far along the wave (radians) each glyph is
        from the one before it. Returns false if they aren't numbers.
    */
    set(amplitude, speed, spacing = this.#spacing)
    {
        if (Number.isFinite(amplitude) === false || Number.isFinite(speed) === false || Number.isFinite(spacing) === false)
        {
            console.error("WaveTextEffect.set() needs numbers");
                return false;
        }

        this.#amplitude = amplitude;
        this.#speed = speed;
        this.#spacing = spacing;
            return true;
    }

    getAmplitude() { return this.#amplitude; }
    getSpeed() { return this.#speed; }
    getSpacing() { return this.#spacing; }

    // Works out each glyph's offset on the wave, and gives them to the TextGlyphs2D
    _onUpdate(dt)
    {
        this.#time += dt;

        const g = this.getGlyphs();
        const count = g.getGlyphCount();

        if (count === 0 || g.isLoaded() === false)
            return;

        if (this.#offsets.length !== count * 2)
            this.#offsets = new Float32Array(count * 2); // The text changed length

        let offsets = this.#offsets;
        const phase = this.#time * this.#speed * MathDefines.kTwoPi;

        for (let i = 0; i < count; ++i)
        {
            offsets[i * 2] = 0.0;
            offsets[(i * 2) + 1] = this.#amplitude * Math.sin(phase - (i * this.#spacing));
        }

        g.setGlyphOffsets(offsets);
    }
}

/*
    FadeTextEffect - Fades the text in or out. A fade runs once over its
    duration, then the opacity stays where it ended (1 after a fade in, 0
    after a fade out). The opacity multiplies the text's (and drop shadow's)
    alpha; nothing is drawn at 0.

        let fx = new FadeTextEffect(title);
        fx.fadeIn(1.0, () => console.log("done"));
*/
class FadeTextEffect extends BaseTextEffect
{
    #opacity;   // 0 - 1
    #from;
    #to;
    #duration;
    #time;
    #isFading;
    #onDone;    // Called once when a fade finishes, or null

    // _glyphs is a TextGlyphs2D
    constructor(_glyphs)
    {
        super(_glyphs);

        this.#opacity = 1.0;
        this.#from = 1.0;
        this.#to = 1.0;
        this.#duration = 0.0;
        this.#time = 0.0;
        this.#isFading = false;
        this.#onDone = null;
    }

    // Fades from invisible to fully visible over duration seconds; onDone() is called once when it finishes
    fadeIn(duration, onDone = null) { this.#start(0.0, 1.0, duration, onDone); }

    // Fades from the current opacity to invisible over duration seconds; onDone() is called once when it finishes
    fadeOut(duration, onDone = null) { this.#start(this.#opacity, 0.0, duration, onDone); }

    // Sets the opacity (0 - 1) right away, stopping any fade
    setOpacity(opacity)
    {
        this.#isFading = false;
        this.#opacity = MathUtil.clamp01(opacity);
        this.#onDone = null;
    }

    getOpacity() { return this.#opacity; }
    isFading() { return this.#isFading; }

    _onUpdate(dt)
    {
        if (this.#isFading === false)
            return;

        this.#time += dt;
        const t = (this.#duration > 0.0) ? MathUtil.clamp01(this.#time / this.#duration) : 1.0;
        this.#opacity = MathUtil.lerp(this.#from, this.#to, t);

        if (t >= 1.0)
        {
            const onDone = this.#onDone;
            this.#isFading = false;
            this.#onDone = null;

            if (onDone !== null)
                onDone(this);
        }
    }

    // Stops a fade where it is
    _onStop()
    {
        this.#isFading = false;
        this.#onDone = null;
    }

    _getOpacity() { return this.#opacity; }

    // *** Internal Methods ***

    #start(from, to, duration, onDone)
    {
        if (Number.isFinite(duration) === false || duration < 0.0)
        {
            console.error("FadeTextEffect: a fade needs a duration of 0 or more seconds");
                return;
        }

        this.#isFading = true;
        this.#from = from;
        this.#to = to;
        this.#duration = duration;
        this.#time = 0.0;
        this.#opacity = from;
        this.#onDone = (typeof onDone === "function") ? onDone : null;
    }
}

/*
    EaseTextEffect - Eases each glyph's color and scale. The color and the
    scale each have their own from / to, easing and duration, and either can
    be left out. The color multiplies the text's color, so with white text
    it's the color seen. The scale is about each glyph's own center (1 is its
    normal size).

        let fx = new EaseTextEffect(title);
        fx.setColor(new Vector4(1, 1, 1, 1), new Vector4(1, 0.8, 0, 1), Easing.kSineInOut, 0.3);
        fx.setScale(0.0, 1.0, Easing.kBackOut, 0.25);
        fx.setMode(EaseTextEffect.kModeIteration, EaseTextEffect.kLeftToRight);
        fx.play(() => console.log("done"));

    Modes:
        kModeAll        Every glyph eases at the same time, over the duration (the default)
        kModeIteration  One glyph at a time (spaces too), each over the whole duration, in a direction:
                        kLeftToRight or kRightToLeft

    An ease runs once, then its glyphs stay at the "to" values until stop().
*/
class EaseTextEffect extends BaseTextEffect
{
    // Modes
    static kModeAll = 0;
    static kModeIteration = 1;

    // The order kModeIteration goes through the glyphs
    static kLeftToRight = 0;
    static kRightToLeft = 1;

    // A color channel and a scale channel, each { from, to, easing, duration, time } or null
    #color;
    #scale;
    #mode;
    #direction;  // For kModeIteration
    #isPlaying;  // True from play() until stop(), holding the end once it's finished
    #isEasing;   // True while a channel hasn't finished
    #onDone;     // Called once when both channels finish, or null
    #colors;     // Float32Array: r, g, b, a per glyph
    #scales;     // Float32Array: sx, sy per glyph

    // _glyphs is a TextGlyphs2D
    constructor(_glyphs)
    {
        super(_glyphs);

        this.#color = null;
        this.#scale = null;
        this.#mode = EaseTextEffect.kModeAll;
        this.#direction = EaseTextEffect.kLeftToRight;
        this.#isPlaying = false;
        this.#isEasing = false;
        this.#onDone = null;
        this.#colors = new Float32Array(0);
        this.#scales = new Float32Array(0);
    }

    /*
        The color part of the ease: from and to are Vector4s (copied),
        multiplied with the text's color; easing is an Easing type, duration
        in seconds. null for from leaves the color out. Takes effect on the
        next play(). Returns false if the values aren't valid.
    */
    setColor(from, to = null, easing = Easing.kLinear, duration = 1.0)
    {
        if (from === null)
        {
            this.#color = null;
                return true;
        }

        if (to === null || EaseTextEffect.#checkEase(easing, duration, "setColor") === false)
            return false;

        this.#color = { from: new Vector4(from.x, from.y, from.z, from.w), to: new Vector4(to.x, to.y, to.z, to.w), easing, duration, time: 0.0 };
            return true;
    }

    /*
        The scale part of the ease: from and to are scales (1 is the glyph's
        normal size), about each glyph's center; easing is an Easing type,
        duration in seconds. null for from leaves the scale out. Takes effect
        on the next play(). Returns false if the values aren't valid.
    */
    setScale(from, to = null, easing = Easing.kLinear, duration = 1.0)
    {
        if (from === null)
        {
            this.#scale = null;
                return true;
        }

        if (Number.isFinite(from) === false || Number.isFinite(to) === false)
        {
            console.error("EaseTextEffect.setScale() needs a from and to scale");
                return false;
        }

        if (EaseTextEffect.#checkEase(easing, duration, "setScale") === false)
            return false;

        this.#scale = { from, to, easing, duration, time: 0.0 };
            return true;
    }

    // kModeAll (the default) or kModeIteration, and for kModeIteration kLeftToRight or kRightToLeft
    setMode(mode, direction = EaseTextEffect.kLeftToRight)
    {
        if ((mode !== EaseTextEffect.kModeAll && mode !== EaseTextEffect.kModeIteration) ||
            (direction !== EaseTextEffect.kLeftToRight && direction !== EaseTextEffect.kRightToLeft))
        {
            console.error("EaseTextEffect.setMode() needs a mode and a direction (see EaseTextEffect)");
                return false;
        }

        this.#mode = mode;
        this.#direction = direction;
            return true;
    }

    getMode() { return this.#mode; }
    getDirection() { return this.#direction; }

    /*
        Starts the ease from the beginning with the color and scale set (at
        least one); onDone() is called once when both have finished. The
        glyphs then stay at the "to" values until stop(). Returns false if
        neither is set.
    */
    play(onDone = null)
    {
        if (this.#color === null && this.#scale === null)
        {
            console.error("EaseTextEffect.play(): set a color or scale first (setColor() / setScale())");
                return false;
        }

        if (this.#color !== null)
            this.#color.time = 0.0;

        if (this.#scale !== null)
            this.#scale.time = 0.0;

        this.#isPlaying = true;
        this.#isEasing = true;
        this.#onDone = (typeof onDone === "function") ? onDone : null;

        if (this.getGlyphs() !== null)
            this.#apply();

        return true;
    }

    // True while the ease is running (it holds its end, once it's finished, until stop())
    isEasing() { return this.#isEasing; }

    _onUpdate(dt)
    {
        if (this.#isPlaying === false)
            return;

        if (this.#isEasing === true)
        {
            if (this.#color !== null)
                this.#color.time += dt;

            if (this.#scale !== null)
                this.#scale.time += dt;
        }

        this.#apply(); // Every update, so it survives setText() and the atlas redrawing

        if (this.#isEasing === true && this.#isChannelDone(this.#color) && this.#isChannelDone(this.#scale))
        {
            const onDone = this.#onDone;
            this.#isEasing = false;
            this.#onDone = null;

            if (onDone !== null)
                onDone(this);
        }
    }

    _onStop()
    {
        this.#isPlaying = false;
        this.#isEasing = false;
        this.#onDone = null;
    }

    // *** Internal Methods ***

    // Works out each glyph's color and scale, and gives them to the TextGlyphs2D
    #apply()
    {
        const g = this.getGlyphs();
        const count = g.getGlyphCount();

        if (count === 0 || g.isLoaded() === false)
            return;

        const ec = this.#color;
        const es = this.#scale;

        if (ec !== null)
        {
            if (this.#colors.length !== count * 4)
                this.#colors = new Float32Array(count * 4);

            let colors = this.#colors;

            for (let i = 0; i < count; ++i)
            {
                const t = this.#glyphProgress(ec, i, count);
                const c = i * 4;

                colors[c] = MathUtil.lerp(ec.from.x, ec.to.x, t);
                colors[c + 1] = MathUtil.lerp(ec.from.y, ec.to.y, t);
                colors[c + 2] = MathUtil.lerp(ec.from.z, ec.to.z, t);
                colors[c + 3] = MathUtil.lerp(ec.from.w, ec.to.w, t);
            }

            g.setGlyphColors(colors);
        }
        else
            g.setGlyphColors(null);

        if (es !== null)
        {
            if (this.#scales.length !== count * 2)
                this.#scales = new Float32Array(count * 2);

            let scales = this.#scales;

            for (let i = 0; i < count; ++i)
            {
                const s = MathUtil.lerp(es.from, es.to, this.#glyphProgress(es, i, count));
                scales[i * 2] = s;
                scales[(i * 2) + 1] = s;
            }

            g.setGlyphScales(scales);
        }
        else
            g.setGlyphScales(null);
    }

    // The eased progress (0 at from, 1 at to) of glyph index in a channel
    #glyphProgress(channel, index, count)
    {
        let t = (channel.duration > 0.0) ? (channel.time / channel.duration) : Number.POSITIVE_INFINITY;

        if (this.#mode === EaseTextEffect.kModeIteration)
        {
            const order = (this.#direction === EaseTextEffect.kLeftToRight) ? index : (count - 1 - index);
            t -= order; // Each glyph starts when the one before it has finished
        }

        return Easing.ease(channel.easing, MathUtil.clamp01(t));
    }

    // True if a channel isn't set or has finished every glyph
    #isChannelDone(channel)
    {
        if (channel === null)
            return true;

        const steps = (this.#mode === EaseTextEffect.kModeIteration) ? Math.max(1, this.getGlyphs().getGlyphCount()) : 1;
            return (channel.time >= channel.duration * steps);
    }

    static #checkEase(easing, duration, methodName)
    {
        if (Easing.isValid(easing) === false || Number.isFinite(duration) === false || duration < 0.0)
        {
            console.error(`EaseTextEffect.${methodName}() needs an Easing type and a duration of 0 or more seconds`);
                return false;
        }

        return true;
    }
}

/*
    ScrollTextEffect - Scrolls the text through a view rect of viewWidth x
    viewHeight design units, and what leaves one side comes back in on the
    other. The view is placed where the text is: on its anchor, with its
    alignment (see Model2D.setPos()). Across the other axis the text sits in
    the view by that alignment too. The text can be wider than the view, or
    taller with line breaks (see TextGlyphs2D); gap is the space between its
    end and its start coming round again.

        let fx = new ScrollTextEffect(title);
        fx.set(ScrollTextEffect.kLeft, 120, 600, 80); // 120 design units per second

    Directions: kLeft, kRight, kUp, kDown.

    Drawing outside the view is clipped (ClipSpace.pushClipRect(), in screen
    design units, so put it on a layer that ignores the camera). With a
    batcher, it goes on its layer with submitDrawable(), so it's drawn after
    that layer's models. Until set() is called the text is drawn as it is.
*/
class ScrollTextEffect extends BaseTextEffect
{
    // Directions
    static kLeft = 0;
    static kRight = 1;
    static kUp = 2;
    static kDown = 3;

    #direction;
    #speed;       // Design units per second, 0 or more
    #viewW;       // Design units; 0 until set()
    #viewH;
    #gap;         // Design units between the text's end and its start coming round
    #pos;         // How far it has scrolled, design units, kept within one wrap
    #viewRect;    // Vector4 (x, y, width, height), from getView()
    #clippedDraw; // Given to Batcher.submitDrawable()
    #offsets;     // Float32Array: x, y per glyph

    // _glyphs is a TextGlyphs2D
    constructor(_glyphs)
    {
        super(_glyphs);

        this.#direction = ScrollTextEffect.kLeft;
        this.#speed = 0.0;
        this.#viewW = 0.0;
        this.#viewH = 0.0;
        this.#gap = 0.0;
        this.#pos = 0.0;
        this.#viewRect = new Vector4(0, 0, 0, 0);
        this.#clippedDraw = { render: () => this.render() };
        this.#offsets = new Float32Array(0);
    }

    /*
        The text moves in direction at speed design units per second, through
        a view of viewWidth x viewHeight design units, wrapping around with
        gap design units between its end and its start. It starts with the
        text at the view's left (or bottom) edge. Returns false if the values
        aren't valid.
    */
    set(direction, speed, viewWidth, viewHeight, gap = 0.0)
    {
        if (Number.isInteger(direction) === false || direction < ScrollTextEffect.kLeft || direction > ScrollTextEffect.kDown)
        {
            console.error("ScrollTextEffect.set() needs a direction (see ScrollTextEffect)");
                return false;
        }

        if (Number.isFinite(speed) === false || speed < 0.0 || Number.isFinite(viewWidth) === false || viewWidth <= 0.0 ||
            Number.isFinite(viewHeight) === false || viewHeight <= 0.0 || Number.isFinite(gap) === false || gap < 0.0)
        {
            console.error("ScrollTextEffect.set() needs a speed and gap of 0 or more, and a view size above 0");
                return false;
        }

        this.#direction = direction;
        this.#speed = speed;
        this.#viewW = viewWidth;
        this.#viewH = viewHeight;
        this.#gap = gap;
        this.#pos = 0.0;

        if (this.getGlyphs() !== null)
            this.#applyOffsets();

        return true;
    }

    // Design units per second, 0 or more; 0 pauses it where it is
    setSpeed(speed)
    {
        if (Number.isFinite(speed) === false || speed < 0.0)
        {
            console.error("ScrollTextEffect.setSpeed() needs a speed of 0 or more");
                return;
        }

        this.#speed = speed;
    }

    getDirection() { return this.#direction; }
    getSpeed() { return this.#speed; }
    getGap() { return this.#gap; }

    // The view rect in design units, as a shared Vector4 (x, y, width, height), (x, y) its bottom-left; read-only
    getView()
    {
        const g = this.getGlyphs();
        const w = this.#viewW;
        const h = this.#viewH;

        if (g === null)
            this.#viewRect.set(0, 0, w, h);
        else
        {
            const a = g.getAnchor();
            const align = g.getAlignment();
            this.#viewRect.set(a.x + Alignment.offsetX(align, w), a.y + Alignment.offsetY(align, h), w, h);
        }

        return this.#viewRect;
    }

    // Queues the text on a Batcher layer, with submitDrawable() so it can be clipped to its view
    submit(batcher, layer)
    {
        if (this.#isSet() === false)
        {
            super.submit(batcher, layer);
                return;
        }

        if (this._isDrawable() === true)
            batcher.submitDrawable(this.#clippedDraw, layer);
    }

    // Draws the text right away, clipped to its view
    render()
    {
        if (this.#isSet() === false)
        {
            super.render();
                return;
        }

        const v = this.getView();

        if (ClipSpace.pushClipRect(v.x, v.y, v.z, v.w) === false)
            return;

        super.render();
        ClipSpace.popClipRect();
    }

    _onUpdate(dt)
    {
        if (this.#isSet() === false)
            return;

        const forward = (this.#direction === ScrollTextEffect.kRight || this.#direction === ScrollTextEffect.kUp);
        this.#pos += (forward ? this.#speed : -this.#speed) * dt;
        this.#applyOffsets();
    }

    // *** Internal Methods ***

    #isSet() { return (this.#viewW > 0.0); }

    /*
        Places each glyph in the view: along the scroll it's where the text has
        scrolled to, wrapped within one period; across it the text sits in the
        view by its alignment. A glyph only wraps once it's wholly past the
        view's start edge, and the period is long enough that it comes back in
        from beyond the far edge, so nothing pops in or out where it's seen.
    */
    #applyOffsets()
    {
        const g = this.getGlyphs();
        const count = g.getGlyphCount();

        if (count === 0 || g.isLoaded() === false)
            return;

        if (this.#offsets.length !== count * 2)
            this.#offsets = new Float32Array(count * 2); // The text changed length

        let offsets = this.#offsets;
        const view = this.getView();
        const pos = g.getPos();
        const align = g.getAlignment();
        const horizontal = (this.#direction === ScrollTextEffect.kLeft || this.#direction === ScrollTextEffect.kRight);
        const textLength = horizontal ? g.getWidth() : g.getHeight();
        const viewLength = horizontal ? view.z : view.w;

        let longestGlyph = 0.0;

        for (let i = 0; i < count; ++i)
            longestGlyph = Math.max(longestGlyph, horizontal ? g.getGlyphWidth(i) : g.getGlyphHeight(i));

        const period = Math.max(textLength + this.#gap, viewLength + longestGlyph);

        this.#pos = ScrollTextEffect.#wrap(this.#pos, period); // Keep it small

        // Across the scroll: aligned in the view
        const acrossX = view.x + (((view.z - g.getWidth()) * Alignment.getColumn(align)) / 2.0) - pos.x;
        const acrossY = view.y + (((view.w - g.getHeight()) * Alignment.getRow(align)) / 2.0) - pos.y;

        for (let i = 0; i < count; ++i)
        {
            if (horizontal)
            {
                const gx = g.getGlyphX(i);
                const gw = g.getGlyphWidth(i);
                const x = ScrollTextEffect.#wrap(gx + this.#pos + gw, period) - gw;

                offsets[i * 2] = (view.x + x) - (pos.x + gx);
                offsets[(i * 2) + 1] = acrossY;
            }
            else
            {
                const gy = g.getGlyphY(i);
                const gh = g.getGlyphHeight(i);
                const y = ScrollTextEffect.#wrap(gy + this.#pos + gh, period) - gh;

                offsets[i * 2] = acrossX;
                offsets[(i * 2) + 1] = (view.y + y) - (pos.y + gy);
            }
        }

        g.setGlyphOffsets(offsets);
    }

    // value wrapped into 0 up to (not including) period
    static #wrap(value, period)
    {
        if (period <= 0.0)
            return 0.0;

        const r = value % period;
            return (r < 0.0) ? (r + period) : r;
    }
}
