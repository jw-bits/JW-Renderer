"use strict";

/*
    TextEffectType - The effects a TextEffect can perform, as bit flags; any
    mix can be on at once.
        kDropShadow  Draws the text a second time behind itself, offset and tinted
        kWave        Moves each glyph up and down on a sine wave
        kFadeIn      Fading in (on while it runs; see TextEffect.fadeIn())
        kFadeOut     Fading out (on while it runs; see TextEffect.fadeOut())
*/
class TextEffectType
{
    static kNone = 0;
    static kDropShadow = 1;
    static kWave = 2;
    static kFadeIn = 4;
    static kFadeOut = 8;
}

/*
    TextEffect - Effects on a TextGlyphs2D: a drop shadow, a wave and fades.

    The TextGlyphs2D keeps its own text, position, alignment and color; the
    effect works on top of them. Drop shadow and wave stay on until turned
    off; a fade runs once over its duration, then its flag goes off and the
    opacity stays where it ended (1 after a fade in, 0 after a fade out).

    Usage:
        let title = new TextGlyphs2D(textAtlas);
        title.setText("CHECKERS");
        title.setPos(960, 700, Alignment.kMiddleCenter);

        let fx = new TextEffect(title);
        fx.setDropShadow(4, -4, new Vector4(0, 0, 0, 0.6)); // Turns it on
        fx.setWave(8, 0.5);                                 // 8 design units, half a cycle per second
        fx.fadeIn(1.0);

        // Each frame
        fx.update(dt);
        fx.submit(batcher, layer); // Or fx.render()

    The TextGlyphs2D belongs to the caller. The wave moves its glyphs (see
    TextGlyphs2D.setGlyphOffsets()), so turning the wave off or setting new
    text puts them back.
*/
class TextEffect
{
    static #kTwoPi = Math.PI * 2.0;

    #glyphs;         // The TextGlyphs2D
    #effects;        // TextEffectType flags that are on

    // Drop shadow
    #shadowOffset;   // Vector2, design units
    #shadowColor;    // Vector4; its alpha is multiplied by the opacity

    // Wave
    #waveAmplitude;  // Design units up and down
    #waveSpeed;      // Cycles per second
    #waveSpacing;    // Radians of the wave between one glyph and the next
    #waveTime;       // Seconds the wave has run
    #waveOffsets;    // Float32Array: x, y per glyph, for setGlyphOffsets()

    // Fade
    #opacity;        // 0 - 1, multiplied into the text's (and shadow's) alpha
    #fadeFrom;
    #fadeTo;
    #fadeDuration;
    #fadeTime;
    #onFadeDone;     // Called once when a fade finishes, or null

    // Scratch for submit() / render()
    #savedColor;
    #drawColor;

    // _glyphs is a TextGlyphs2D
    constructor(_glyphs)
    {
        this.#glyphs = _glyphs;

        if ((_glyphs instanceof TextGlyphs2D) === false)
        {
            console.error("TextEffect needs a TextGlyphs2D");
            this.#glyphs = null;
        }

        this.#effects = TextEffectType.kNone;

        this.#shadowOffset = new Vector2(3, -3);
        this.#shadowColor = new Vector4(0, 0, 0, 0.6);

        this.#waveAmplitude = 6.0;
        this.#waveSpeed = 1.0;
        this.#waveSpacing = 0.6;
        this.#waveTime = 0.0;
        this.#waveOffsets = new Float32Array(0);

        this.#opacity = 1.0;
        this.#fadeFrom = 1.0;
        this.#fadeTo = 1.0;
        this.#fadeDuration = 0.0;
        this.#fadeTime = 0.0;
        this.#onFadeDone = null;

        this.#savedColor = new Vector4();
        this.#drawColor = new Vector4();
    }

    // *** Effects on / off ***

    // Turns on TextEffectType flags. Fades start with fadeIn() / fadeOut() instead.
    enable(effects)
    {
        if ((effects & (TextEffectType.kFadeIn | TextEffectType.kFadeOut)) !== 0)
            console.error("TextEffect.enable(): start fades with fadeIn() / fadeOut()");

        this.#effects |= (effects & (TextEffectType.kDropShadow | TextEffectType.kWave));
    }

    // Turns off TextEffectType flags. Turning off a fade stops it where it is.
    disable(effects)
    {
        this.#effects &= ~effects;

        if ((effects & TextEffectType.kWave) !== 0 && this.#glyphs !== null)
            this.#glyphs.setGlyphOffsets(null); // Back in line
    }

    isEnabled(effect) { return ((this.#effects & effect) !== 0); }
    getEffects() { return this.#effects; }

    getGlyphs() { return this.#glyphs; }

    // *** Drop shadow ***

    // Turns the shadow on, offsetX / offsetY design units from the text (negative y is down), tinted color
    setDropShadow(offsetX, offsetY, color)
    {
        this.#shadowOffset.set(offsetX, offsetY);
        this.#shadowColor.set(color.x, color.y, color.z, color.w);
        this.enable(TextEffectType.kDropShadow);
    }

    getShadowOffset() { return this.#shadowOffset; }
    getShadowColor() { return this.#shadowColor; }

    // *** Wave ***

    /*
        Turns the wave on: each glyph moves up and down by amplitude design units,
        speed cycles per second. spacing is how far along the wave (radians)
        each glyph is from the one before it.
    */
    setWave(amplitude, speed, spacing = this.#waveSpacing)
    {
        if (Number.isFinite(amplitude) === false || Number.isFinite(speed) === false || Number.isFinite(spacing) === false)
        {
            console.error("TextEffect.setWave() needs numbers");
                return;
        }

        this.#waveAmplitude = amplitude;
        this.#waveSpeed = speed;
        this.#waveSpacing = spacing;
        this.enable(TextEffectType.kWave);
    }

    getWaveAmplitude() { return this.#waveAmplitude; }
    getWaveSpeed() { return this.#waveSpeed; }
    getWaveSpacing() { return this.#waveSpacing; }

    // *** Fades ***

    // Fades from invisible to fully visible over duration seconds; onDone() is called once when it finishes
    fadeIn(duration, onDone = null) { this.#startFade(0.0, 1.0, duration, TextEffectType.kFadeIn, onDone); }

    // Fades from the current opacity to invisible over duration seconds; onDone() is called once when it finishes
    fadeOut(duration, onDone = null) { this.#startFade(this.#opacity, 0.0, duration, TextEffectType.kFadeOut, onDone); }

    // Sets the opacity (0 - 1) right away, stopping any fade
    setOpacity(opacity)
    {
        this.#effects &= ~(TextEffectType.kFadeIn | TextEffectType.kFadeOut);
        this.#opacity = Math.min(1.0, Math.max(0.0, opacity));
        this.#onFadeDone = null;
    }

    getOpacity() { return this.#opacity; }
    isFading() { return this.isEnabled(TextEffectType.kFadeIn | TextEffectType.kFadeOut); }

    // *** Each frame ***

    // Advances the wave and any fade by dt seconds
    update(dt)
    {
        if (this.#glyphs === null || Number.isFinite(dt) === false || dt < 0.0)
            return;

        if (this.isEnabled(TextEffectType.kWave))
        {
            this.#waveTime += dt;
            this.#applyWave();
        }

        if (this.isFading())
        {
            this.#fadeTime += dt;
            const t = (this.#fadeDuration > 0.0) ? Math.min(1.0, this.#fadeTime / this.#fadeDuration) : 1.0;
            this.#opacity = MathUtil.lerp(this.#fadeFrom, this.#fadeTo, t);

            if (t >= 1.0)
            {
                const onDone = this.#onFadeDone;
                this.#effects &= ~(TextEffectType.kFadeIn | TextEffectType.kFadeOut);
                this.#onFadeDone = null;

                if (onDone !== null)
                    onDone(this);
            }
        }
    }

    // Queues the text (and its shadow, behind it) on a MaterialBatcher layer. Nothing is queued while invisible.
    submit(batcher, layer)
    {
        this.#draw((model) => batcher.submit(model, layer));
    }

    // Draws the text (and its shadow, first) right away
    render()
    {
        this.#draw((model) => model.render());
    }

    // *** Internal Methods ***

    // Draws the shadow then the text with drawFn, at the opacity, then puts the text's color and position back
    #draw(drawFn)
    {
        const g = this.#glyphs;

        if (g === null || g.isLoaded() === false || this.#opacity <= 0.0)
            return;

        const c = g.getColor();
        this.#savedColor.set(c.x, c.y, c.z, c.w);

        if (this.isEnabled(TextEffectType.kDropShadow))
        {
            const anchor = g.getAnchor();
            const ax = anchor.x;
            const ay = anchor.y;
            const s = this.#shadowColor;

            this.#drawColor.set(s.x, s.y, s.z, s.w * this.#opacity);
            g.setColor(this.#drawColor);
            g.setPos(ax + this.#shadowOffset.x, ay + this.#shadowOffset.y, g.getAlignment());
            drawFn(g);
            g.setPos(ax, ay, g.getAlignment());
        }

        const saved = this.#savedColor;
        this.#drawColor.set(saved.x, saved.y, saved.z, saved.w * this.#opacity);
        g.setColor(this.#drawColor);
        drawFn(g);

        g.setColor(saved);
    }

    #applyWave()
    {
        const g = this.#glyphs;
        const count = g.getGlyphCount();

        if (count === 0)
            return;

        if (this.#waveOffsets.length !== count * 2)
            this.#waveOffsets = new Float32Array(count * 2); // The text changed length

        const phase = this.#waveTime * this.#waveSpeed * TextEffect.#kTwoPi;

        for (let i = 0; i < count; ++i)
        {
            this.#waveOffsets[i * 2] = 0.0;
            this.#waveOffsets[(i * 2) + 1] = this.#waveAmplitude * Math.sin(phase - (i * this.#waveSpacing));
        }

        g.setGlyphOffsets(this.#waveOffsets);
    }

    #startFade(from, to, duration, flag, onDone)
    {
        if (Number.isFinite(duration) === false || duration < 0.0)
        {
            console.error("TextEffect: a fade needs a duration of 0 or more seconds");
                return;
        }

        this.#effects &= ~(TextEffectType.kFadeIn | TextEffectType.kFadeOut);
        this.#effects |= flag;
        this.#fadeFrom = from;
        this.#fadeTo = to;
        this.#fadeDuration = duration;
        this.#fadeTime = 0.0;
        this.#opacity = from;
        this.#onFadeDone = (typeof onDone === "function") ? onDone : null;
    }
}
