"use strict";

/*
    Render targets: drawing into a texture instead of the screen, for post
    effects (post_effects.js), cached UI, transitions, minimaps and the like.

        RenderTarget       A framebuffer with a RenderTexture (textures.js), sized in pixels or to the view
        RenderTargets      The stack of targets being drawn into (static)
        RenderTargetPool   Temporary targets, lent out and taken back each frame (static)

    CachedLayer (batching.js) is built on them: something drawn once into a
    target, then shown as one textured rect.

    Usage:
        let minimap = new RenderTarget();
        minimap.loadFixed(256, 256);                  // Pixels; its design area is 0 - 256 unless setDesignRect() says otherwise
        minimap.setDesignRect(0, 0, 1024, 1024);      // What it shows, in design units: 4 design units per pixel

        // Each frame
        RenderTargets.push(minimap);                  // Cleared to transparent; draws go into it
        ClipSpace.setCamera(worldCamera);             // Optional: cameras and clip rects work in a target too
        batcher.render();
        RenderTargets.pop();                          // Back to the screen (or the target under it)

        mapRect.load(minimapMaterial, 200, 200);      // Material on Rect2D's shader with [minimap.getTexture()],
                                                      // BlendMode.kPremultiplied (see below)

    Surfaces: drawing goes to the top of the RenderTargets stack, or the canvas
    when it's empty. Each surface has a design area: the whole design
    resolution for the canvas and view-sized targets, the target's design rect
    otherwise. ClipSpace maps that area onto the surface's pixels, so models,
    cameras and clip rects work the same in a target as on the screen.
    push() starts the target with no camera and no clip rects; pop() puts back
    the camera and clip rects that were active before it.

    Premultiplied: drawing with BlendMode.kAlpha into a target cleared to
    transparent leaves colors multiplied by their alpha, so its texture must be
    drawn back with BlendMode.kPremultiplied, or soft edges darken.

    Phones (tile-based GPUs): every push() and pop() writes the GPU's tiles out
    to memory, so draw everything for one target together instead of going
    back and forth. Clearing on push() (the default) saves reading the old
    contents back in; pass null only when the old contents must stay.
    Multisampled and stencil buffers are discarded once resolved, so they're
    never written out.

    Lost context: targets make their GL objects again when the context comes
    back (onContextRestored, see WGLV.addListeners()); their contents are
    lost, so getVersion() goes up.
*/

/*
    RenderTarget - A framebuffer drawing into a RenderTexture.

    Size, set by the load:
        loadFixed(width, height)  That many pixels; its design area is (0, 0) - (width, height)
                                  until setDesignRect() says otherwise
        loadView(scale)           The view's pixel size times scale (1, 0.5, 0.25 ...), following
                                  it as the window changes (checked on each push()); its design
                                  area is the whole design resolution, like the canvas

    Options (an object, all optional):
        format    RenderTarget.kRGBA8 (default) or kRGBA16F: half-float colors that can go
                  above 1 (HDR, for bloom). Needs EXT_color_buffer_float; falls back to
                  kRGBA8 without it (see getFormat()).
        samples   Multisampling (MSAA) for smooth edges like the canvas's: 0 (default) or
                  e.g. 4, capped at what the GPU supports for the format (see getSamples()).
                  Resolved into the texture by RenderTargets.pop().
        stencil   true for a stencil buffer (cleared on push()).

    The target is drawn into through RenderTargets.push() / pop(), and drawn
    from through getTexture().
*/
class RenderTarget
{
    // Formats
    static kRGBA8 = 0;
    static kRGBA16F = 1;

    // Size modes
    static kFixed = 0;
    static kView = 1;

    // Every loaded target, to remake after a lost context, and their memory
    static #loaded = new Set();
    static #bytes = 0;
    static #floatSupport = null; // null until asked
    static #contextListener = null;

    #sizeMode;
    #scale;        // kView: of the view's pixel size
    #width;        // Pixels
    #height;
    #format;       // Asked for
    #actualFormat; // Got
    #samples;      // Asked for
    #actualSamples;
    #hasStencil;
    #designRect;   // Vector4 (x, y, width, height) in design units, or null for the default
    #version;      // Goes up each time the GL objects are (re)made: the contents are lost then
    #bytesUsed;

    #texture;      // RenderTexture
    #fbo;          // Draws into the texture (and is what a multisampled one resolves to)
    #msaaFbo;      // Multisampled: drawn into, then resolved into #fbo; null without samples
    #colorRb;      // Multisampled color renderbuffer
    #stencilRb;    // Stencil (with depth, the format every GPU has) renderbuffer, or null

    constructor()
    {
        this.#sizeMode = RenderTarget.kFixed;
        this.#scale = 1.0;
        this.#width = 0;
        this.#height = 0;
        this.#format = RenderTarget.kRGBA8;
        this.#actualFormat = RenderTarget.kRGBA8;
        this.#samples = 0;
        this.#actualSamples = 0;
        this.#hasStencil = false;
        this.#designRect = null;
        this.#version = 0;
        this.#bytesUsed = 0;

        this.#texture = new RenderTexture();
        this.#fbo = null;
        this.#msaaFbo = null;
        this.#colorRb = null;
        this.#stencilRb = null;
    }

    // A target of width x height pixels (see the top of this class for options). Returns false on failure.
    loadFixed(width, height, options = null)
    {
        if (Number.isInteger(width) === false || Number.isInteger(height) === false || width <= 0 || height <= 0)
        {
            console.error("RenderTarget.loadFixed() needs a whole number width and height above 0");
                return false;
        }

        return this.#load(RenderTarget.kFixed, 1.0, width, height, options, "loadFixed");
    }

    // A target the size of the view times scale (above 0, up to 1), following it (see the top of this class for options)
    loadView(scale = 1.0, options = null)
    {
        if (Number.isFinite(scale) === false || scale <= 0.0 || scale > 1.0)
        {
            console.error("RenderTarget.loadView() needs a scale above 0, up to 1");
                return false;
        }

        const size = RenderTarget.#viewSize(scale);
            return this.#load(RenderTarget.kView, scale, size.width, size.height, options, "loadView");
    }

    // A loaded kFixed target at a new size; the contents are lost. Returns false if it isn't one, or the size isn't valid.
    resize(width, height)
    {
        if (this.isLoaded() === false || this.#sizeMode !== RenderTarget.kFixed)
        {
            console.error("RenderTarget.resize() needs a loaded kFixed target (kView targets follow the view)");
                return false;
        }

        if (Number.isInteger(width) === false || Number.isInteger(height) === false || width <= 0 || height <= 0)
        {
            console.error("RenderTarget.resize() needs a whole number width and height above 0");
                return false;
        }

        if (width === this.#width && height === this.#height)
            return true;

        return this.#allocate(width, height);
    }

    /*
        A kView target follows the view's pixel size: remakes it at the new size if the
        view has changed. Returns true if it did (the contents are lost). RenderTargets.push()
        calls it.
    */
    fitToView()
    {
        if (this.#sizeMode !== RenderTarget.kView || this.isLoaded() === false)
            return false;

        const size = RenderTarget.#viewSize(this.#scale);

        if (size.width === this.#width && size.height === this.#height)
            return false;

        this.#allocate(size.width, size.height);
            return true;
    }

    // The design units the target shows, (x, y) its bottom-left. Returns false if the size isn't above 0.
    setDesignRect(x, y, width, height)
    {
        if (Number.isFinite(x) === false || Number.isFinite(y) === false || Number.isFinite(width) === false ||
            Number.isFinite(height) === false || width <= 0.0 || height <= 0.0)
        {
            console.error("RenderTarget.setDesignRect() needs a position and a size above 0");
                return false;
        }

        if (this.#designRect === null)
            this.#designRect = new Vector4();

        this.#designRect.set(x, y, width, height);
            return true;
    }

    // Back to the default design area: the whole design resolution (kView) or (0, 0) - (width, height) (kFixed)
    clearDesignRect() { this.#designRect = null; }

    // The design area, written into out (a Vector4: x, y, width, height) and returned
    getDesignRect(out = new Vector4())
    {
        if (this.#designRect !== null)
            out.set(this.#designRect.x, this.#designRect.y, this.#designRect.z, this.#designRect.w);
        else if (this.#sizeMode === RenderTarget.kView)
            out.set(0, 0, WGLV.getWidth(), WGLV.getHeight());
        else
            out.set(0, 0, this.#width, this.#height);

        return out;
    }

    getTexture() { return this.#texture; }
    getWidth() { return this.#width; }   // Pixels
    getHeight() { return this.#height; }
    getSizeMode() { return this.#sizeMode; }
    getScale() { return this.#scale; }   // kView's
    getFormat() { return this.#actualFormat; } // What it got, which may be kRGBA8 when kRGBA16F was asked for
    getSamples() { return this.#actualSamples; }
    hasStencil() { return this.#hasStencil; }
    isLoaded() { return (this.#fbo !== null); }

    // Goes up each time the target's GL objects are made, i.e. its contents were lost (a resize, a lost context)
    getVersion() { return this.#version; }

    // Bytes of GPU memory it holds (texture and renderbuffers), roughly
    getMemoryBytes() { return this.#bytesUsed; }

    /*
        For RenderTargets: points drawing at this target (its multisampled buffer if it
        has one) and sets the GL viewport to all of it.
    */
    bind()
    {
        const gl = WGLV.context;

        gl.bindFramebuffer(gl.FRAMEBUFFER, (this.#msaaFbo !== null) ? this.#msaaFbo : this.#fbo);
        gl.viewport(0, 0, this.#width, this.#height);
    }

    /*
        For RenderTargets.pop(): resolves multisampling into the texture, and tells the
        GPU the multisampled and stencil buffers can be thrown away rather than saved.
        Leaves the read and draw framebuffers changed; the caller binds what's next.
    */
    resolve()
    {
        const gl = WGLV.context;
        const stencil = (this.#hasStencil === true) ? [gl.DEPTH_STENCIL_ATTACHMENT] : [];

        if (this.#msaaFbo !== null)
        {
            const scissor = RenderState.getScissor();
            RenderState.setScissor(null); // Blits are scissored too

            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.#msaaFbo);
            gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.#fbo);
            gl.blitFramebuffer(0, 0, this.#width, this.#height, 0, 0, this.#width, this.#height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
            gl.invalidateFramebuffer(gl.READ_FRAMEBUFFER, [gl.COLOR_ATTACHMENT0, ...stencil]);

            RenderState.setScissor(scissor);
        }
        else if (stencil.length > 0)
        {
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.#fbo);
            gl.invalidateFramebuffer(gl.FRAMEBUFFER, stencil);
        }
    }

    /*
        Copies the whole canvas, bars included (what's been drawn there so far this
        frame), into the texture, pixel for pixel; the view is at (WGLV.getViewportX(),
        WGLV.getViewportY()) in it. The target must be a loaded kFixed kRGBA8 target
        without multisampling; it's resized to the canvas first if it isn't its size.
        The whole canvas, because a multisampled canvas (antialias) can only be copied
        to the same place in a target of its size. Returns false if it couldn't copy.
    */
    copyFromCanvas()
    {
        if (this.isLoaded() === false || this.#sizeMode !== RenderTarget.kFixed || this.#actualFormat !== RenderTarget.kRGBA8 ||
            this.#msaaFbo !== null)
        {
            console.error("RenderTarget.copyFromCanvas() needs a loaded kFixed kRGBA8 target without samples");
                return false;
        }

        const gl = WGLV.context;
        const w = gl.drawingBufferWidth;
        const h = gl.drawingBufferHeight;

        if (this.resize(w, h) === false)
            return false;

        const scissor = RenderState.getScissor();
        RenderState.setScissor(null); // Blits are scissored too

        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.#fbo);
        gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);

        RenderTargets.bindCurrent();
        RenderState.setScissor(scissor);
            return true;
    }

    // Frees the GL objects; load again to use it
    unload()
    {
        this.#freeGL(true);
        this.#texture.unload();
        RenderTarget.#loaded.delete(this);
    }

    // *** Static ***

    // True if half-float targets (kRGBA16F) can be drawn into (EXT_color_buffer_float)
    static isFloatSupported()
    {
        if (RenderTarget.#floatSupport === null)
            RenderTarget.#floatSupport = (WGLV.context?.getExtension("EXT_color_buffer_float") != null);

        return RenderTarget.#floatSupport;
    }

    // Loaded targets (including RenderTargetPool's)
    static getCount() { return RenderTarget.#loaded.size; }

    // Bytes of GPU memory all loaded targets hold, roughly
    static getTotalMemoryBytes() { return RenderTarget.#bytes; }

    // *** Internal Methods ***

    #load(sizeMode, scale, width, height, options, methodName)
    {
        if (WGLV.context === null)
        {
            console.error(`RenderTarget.${methodName}() needs WGLV.init() first`);
                return false;
        }

        if (this.isLoaded() === true)
        {
            console.error(`RenderTarget.${methodName}(): it's already loaded; unload() it first`);
                return false;
        }

        const format = options?.format ?? RenderTarget.kRGBA8;
        const samples = options?.samples ?? 0;

        if (format !== RenderTarget.kRGBA8 && format !== RenderTarget.kRGBA16F)
        {
            console.error(`RenderTarget.${methodName}(): format must be RenderTarget.kRGBA8 or kRGBA16F`);
                return false;
        }

        if (Number.isInteger(samples) === false || samples < 0)
        {
            console.error(`RenderTarget.${methodName}(): samples must be a whole number, 0 or more`);
                return false;
        }

        this.#sizeMode = sizeMode;
        this.#scale = scale;
        this.#format = format;
        this.#samples = samples;
        this.#hasStencil = (options?.stencil === true);

        if (this.#allocate(width, height) === false)
            return false;

        RenderTarget.#loaded.add(this);
        RenderTarget.#listenForContext();
            return true;
    }

    // Makes the GL objects at this size, falling back to kRGBA8 if a half-float one can't be made
    #allocate(width, height)
    {
        let useFloat = (this.#format === RenderTarget.kRGBA16F && RenderTarget.isFloatSupported() === true);

        if (this.#build(width, height, useFloat) === false && useFloat === true)
        {
            console.error("RenderTarget: a half-float target couldn't be made; using RGBA8");
            useFloat = false;
            this.#build(width, height, false);
        }

        RenderTargets.bindCurrent(); // Making it changed the framebuffer binding

        if (this.#fbo === null)
        {
            console.error(`RenderTarget couldn't make a ${width} x ${height} framebuffer`);
                return false;
        }

        ++this.#version;
            return true;
    }

    // One try at making the GL objects; false (with nothing left made) if the framebuffer isn't complete
    #build(width, height, useFloat)
    {
        const gl = WGLV.context;

        this.#freeGL(false);
        this.#texture.allocate(width, height, useFloat);

        const internal = (useFloat === true) ? gl.RGBA16F : gl.RGBA8;
        const bytesPerPixel = (useFloat === true) ? 8 : 4;
        let bytes = width * height * bytesPerPixel;

        this.#fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.#fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.#texture.getGLTexture(), 0);

        const samples = RenderTarget.#supportedSamples(internal, this.#samples);

        if (samples > 0)
        {
            this.#msaaFbo = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.#msaaFbo);

            this.#colorRb = gl.createRenderbuffer();
            gl.bindRenderbuffer(gl.RENDERBUFFER, this.#colorRb);
            gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, internal, width, height);
            gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.#colorRb);
            bytes += width * height * bytesPerPixel * samples;
        }

        // On whichever framebuffer is drawn into (bound now)
        if (this.#hasStencil === true)
        {
            this.#stencilRb = gl.createRenderbuffer();
            gl.bindRenderbuffer(gl.RENDERBUFFER, this.#stencilRb);

            if (samples > 0)
                gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH24_STENCIL8, width, height);
            else
                gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH24_STENCIL8, width, height);

            gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, this.#stencilRb);
            bytes += width * height * 4 * Math.max(1, samples);
        }

        gl.bindRenderbuffer(gl.RENDERBUFFER, null);

        let isComplete = (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE);

        if (isComplete === true && this.#msaaFbo !== null)
        {
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.#fbo);
            isComplete = (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE);
        }

        if (isComplete === false)
        {
            this.#freeGL(true);
                return false;
        }

        this.#width = width;
        this.#height = height;
        this.#actualFormat = (useFloat === true) ? RenderTarget.kRGBA16F : RenderTarget.kRGBA8;
        this.#actualSamples = samples;
        this.#setBytes(bytes);
            return true;
    }

    // Deletes the framebuffers and renderbuffers (and with withTexture, the texture's storage size)
    #freeGL(withTexture)
    {
        const gl = WGLV.context;

        if (gl !== null)
        {
            if (this.#fbo !== null) gl.deleteFramebuffer(this.#fbo);
            if (this.#msaaFbo !== null) gl.deleteFramebuffer(this.#msaaFbo);
            if (this.#colorRb !== null) gl.deleteRenderbuffer(this.#colorRb);
            if (this.#stencilRb !== null) gl.deleteRenderbuffer(this.#stencilRb);
        }

        this.#fbo = null;
        this.#msaaFbo = null;
        this.#colorRb = null;
        this.#stencilRb = null;

        if (withTexture === true)
            this.#texture.unload();

        this.#setBytes(0);
    }

    #setBytes(bytes)
    {
        RenderTarget.#bytes += bytes - this.#bytesUsed;
        this.#bytesUsed = bytes;
    }

    // After a lost context: the old GL objects are gone; make new ones the same way
    #remake()
    {
        this.#fbo = null;
        this.#msaaFbo = null;
        this.#colorRb = null;
        this.#stencilRb = null;
        this.#texture.forget();
        this.#setBytes(0);

        let width = this.#width;
        let height = this.#height;

        if (this.#sizeMode === RenderTarget.kView)
        {
            const size = RenderTarget.#viewSize(this.#scale);
            width = size.width;
            height = size.height;
        }

        this.#allocate(width, height);
    }

    // The most samples up to wanted the GPU supports for internalFormat (0 for none)
    static #supportedSamples(internalFormat, wanted)
    {
        if (wanted <= 0)
            return 0;

        const gl = WGLV.context;
        const counts = gl.getInternalformatParameter(gl.RENDERBUFFER, internalFormat, gl.SAMPLES); // Largest first

        if (counts === null)
            return 0;

        for (const count of counts)
        {
            if (count <= wanted)
                return count;
        }

        return 0;
    }

    // The view's pixel size times scale, at least 1 x 1
    static #viewSize(scale)
    {
        return { width: Math.max(1, Math.round(WGLV.getViewportWidth() * scale)),
                 height: Math.max(1, Math.round(WGLV.getViewportHeight() * scale)) };
    }

    static #listenForContext()
    {
        if (RenderTarget.#contextListener !== null)
            return;

        RenderTarget.#contextListener = {
            onContextRestored: () => {
                RenderTarget.#floatSupport = null; // Extensions are asked for again on a new context

                for (const target of RenderTarget.#loaded)
                    target.#remake();
            }
        };

        WGLV.addListeners(RenderTarget.#contextListener);
    }
}

/*
    RenderTargets - The stack of RenderTargets being drawn into. Drawing goes to
    the top one, or the canvas when the stack is empty.

        RenderTargets.push(target);          // Cleared to transparent (or clearColor), no camera, no clip rects
        ...draw...
        RenderTargets.pop();                 // Resolved; back to what was there, with its camera and clip rects

    push(target, null) keeps the target's contents instead of clearing them
    (slower on phones; see the top of this file). Pushes nest. ClipSpace.beginFrame()
    calls beginFrame(), which reports and pops any target left pushed.
*/
class RenderTargets
{
    static kClear = new Vector4(0, 0, 0, 0); // Transparent

    static #stack = []; // { target, clipState }

    // Draws into target from now on. Returns false (changing nothing) if it isn't a loaded RenderTarget.
    static push(target, clearColor = RenderTargets.kClear)
    {
        if ((target instanceof RenderTarget) === false || target.isLoaded() === false)
        {
            console.error("RenderTargets.push() needs a loaded RenderTarget");
                return false;
        }

        if (RenderTargets.#stack.some((e) => e.target === target) === true)
        {
            console.error("RenderTargets.push(): the target is already being drawn into");
                return false;
        }

        target.fitToView();

        const gl = WGLV.context;
        const clipState = ClipSpace.saveState();

        RenderTargets.#stack.push({ target: target, clipState: clipState });
        target.bind();

        if (clearColor !== null)
        {
            let bits = gl.COLOR_BUFFER_BIT;

            if (target.hasStencil() === true)
            {
                gl.clearStencil(0);
                bits |= gl.STENCIL_BUFFER_BIT;
            }

            RenderState.setScissor(null); // All of it; resetState() below sets it for the target
            gl.clearColor(clearColor.x, clearColor.y, clearColor.z, clearColor.w);
            gl.clear(bits);
        }

        ClipSpace.resetState(); // The target's own design area, no camera, no clip rects
            return true;
    }

    // Finishes the top target and draws where it did before. Returns false if nothing was pushed.
    static pop()
    {
        if (RenderTargets.#stack.length === 0)
        {
            console.error("RenderTargets.pop() without a push()");
                return false;
        }

        const entry = RenderTargets.#stack.pop();

        entry.target.resolve();
        RenderTargets.bindCurrent();
        ClipSpace.restoreState(entry.clipState);
            return true;
    }

    // The target being drawn into, or null for the canvas
    static getCurrent()
    {
        const s = RenderTargets.#stack;
            return (s.length > 0) ? s[s.length - 1].target : null;
    }

    static getDepth() { return RenderTargets.#stack.length; }

    // Binds the current surface again (the top target, or the canvas's view), e.g. after GL calls that changed it
    static bindCurrent()
    {
        const target = RenderTargets.getCurrent();

        if (target !== null)
            target.bind();
        else
            WGLV.restoreView();
    }

    // Called by ClipSpace.beginFrame(): pops anything left pushed (an error), and lets RenderTargetPool tidy up
    static beginFrame()
    {
        if (RenderTargets.#stack.length > 0)
        {
            console.error(`RenderTargets.beginFrame(): ${RenderTargets.#stack.length} target(s) were never popped`);

            while (RenderTargets.#stack.length > 0)
                RenderTargets.pop();
        }

        RenderTargetPool.beginFrame();
    }
}

/*
    RenderTargetPool - Lends out temporary kFixed targets (no multisampling or
    stencil) by size and format, so passes like a blur don't make new ones
    every frame. Give each one back with release() within the frame; one kept
    past ClipSpace.beginFrame() is reported and taken back. A target nobody
    has borrowed for a while is unloaded.

        const temp = RenderTargetPool.acquire(512, 256, RenderTarget.kRGBA16F);
        ...push, draw, pop, draw from temp.getTexture()...
        RenderTargetPool.release(temp);
*/
class RenderTargetPool
{
    static #kMaxIdleFrames = 120;

    static #entries = []; // { target, format (asked for), inUse, lastUsed }
    static #frame = 0;

    // A free target of width x height pixels in format (RenderTarget.kRGBA8 or kRGBA16F), or null if one can't be made
    static acquire(width, height, format = RenderTarget.kRGBA8)
    {
        for (const e of RenderTargetPool.#entries)
        {
            if (e.inUse === false && e.format === format && e.target.getWidth() === width && e.target.getHeight() === height)
            {
                e.inUse = true;
                e.lastUsed = RenderTargetPool.#frame;
                    return e.target;
            }
        }

        let target = new RenderTarget();

        if (target.loadFixed(width, height, { format: format }) === false)
            return null;

        RenderTargetPool.#entries.push({ target: target, format: format, inUse: true, lastUsed: RenderTargetPool.#frame });
            return target;
    }

    // Gives a borrowed target back
    static release(target)
    {
        const e = RenderTargetPool.#entries.find((entry) => entry.target === target);

        if (e === undefined || e.inUse === false)
        {
            console.error("RenderTargetPool.release() needs a target borrowed with acquire()");
                return false;
        }

        e.inUse = false;
            return true;
    }

    // Targets in the pool, borrowed or not
    static getCount() { return RenderTargetPool.#entries.length; }

    // Called by RenderTargets.beginFrame()
    static beginFrame()
    {
        ++RenderTargetPool.#frame;

        let kept = [];

        for (const e of RenderTargetPool.#entries)
        {
            if (e.inUse === true)
            {
                console.error("RenderTargetPool: a target was never released; taking it back");
                e.inUse = false;
            }

            if (RenderTargetPool.#frame - e.lastUsed > RenderTargetPool.#kMaxIdleFrames)
                e.target.unload();
            else
                kept.push(e);
        }

        RenderTargetPool.#entries = kept;
    }

    // Unloads every target in the pool; none may be borrowed
    static unloadAll()
    {
        for (const e of RenderTargetPool.#entries)
            e.target.unload();

        RenderTargetPool.#entries = [];
    }
}
