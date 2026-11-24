"use strict";

/*
    Camera2D - Which part of the world is seen, and where on the screen.

    The world is in design units, like everything else; with no camera the
    world and the screen are the same (see ClipSpace). A camera shows the world
    around its position (the center of the view), zoomed and rotated, in its
    viewport: a rect of the screen in design units, the whole view by default.

        position   The world point at the center of the viewport
        zoom       Screen design units per world unit: 2 shows things twice as big
        rotation   Radians, counter-clockwise: the camera turns, so the world appears to turn clockwise

    Usage:
        let camera = new Camera2D();
        camera.setPosition(player.getAnchor().x, player.getAnchor().y);
        camera.setZoom(1.5);
        camera.follow(player, 0.15);       // Optional: keep the player in view, catching up half the way every 0.15 s
        camera.setWorldBounds(0, 0, 4000, 2000); // Optional: never show past the level's edges

        // Each frame
        camera.update(dt);                 // Follow, bounds and shake
        batcher.setCamera(camera);         // Layers that follow the camera draw through it (see MaterialBatcher)

        // A tap on the world
        const world = camera.screenToWorld(InputManager.getPosition());

        // A hit
        camera.addTrauma(0.4);

    Shake: trauma, 0 - 1, builds up with addTrauma() and decays every second
    (setTraumaDecay()). The view moves by trauma squared times the limits
    (setShakeLimits(): an offset in screen design units and, optionally, a
    rotation), along smooth noise sampled over time (MathUtil.noise1D(), at
    setShakeFrequency()), so it looks the same at any frame rate. The shake is
    added when drawing (and in screenToWorld() / worldToScreen()); the position
    and rotation themselves don't change.

    Pixel snap: setPixelSnap(true) rounds the position so the world moves in
    whole device pixels, which stops thin lines and pixel art shimmering
    while the camera moves. It only lines up while the rotation (with any
    rotation shake) is 0.
*/
class Camera2D
{
    #position;     // Vector2, world; the center of the view
    #zoom;
    #rotation;     // Radians, counter-clockwise
    #viewport;     // Vector4 (x, y, width, height) in screen design units, or null for the whole view
    #worldBounds;  // Vector4 (x, y, width, height) the view stays inside, or null

    #isPixelSnap;

    // Following (see follow())
    #target;
    #smoothing;    // Seconds to close half the distance; 0 keeps the target exactly in place
    #deadZone;     // Vector2 (width, height) in world units the target moves in freely

    // Shaking (see addTrauma())
    #trauma;           // 0 - 1; the shake is trauma squared
    #traumaDecay;      // Trauma lost per second
    #shakeMaxOffset;   // Screen design units at full trauma
    #shakeMaxRotation; // Radians at full trauma; 0 for none
    #shakeFrequency;   // Noise wobbles per second
    #shakeTime;        // Seconds of noise sampled so far
    #shakeSeed;        // This camera's noise lines (seed, + 1, + 2 for x, y, rotation)
    #shakeOffset;      // Vector2, world units, added to the position this frame
    #shakeRotation;    // Radians added to the rotation this frame

    // The world-to-screen matrix, rebuilt when something changes
    #worldToScreen; // Matrix3
    #isDirty;
    #builtView;    // Vector4: the viewport it was built for (the surface's design area with no viewport set)
    #builtScale;   // The surface's pixels per design unit it was built for (pixel snapping)
    #version;      // Goes up on every change, so ClipSpace knows to upload again

    // Shake defaults
    static #kDefaultTraumaDecay = 1.0;     // Full trauma is gone in 1 second
    static #kDefaultShakeOffset = 24.0;    // Screen design units
    static #kDefaultShakeFrequency = 12.0; // Wobbles per second

    // Scratch for the view's center
    static #kCenter = new Vector2();
    static #kViewport = new Vector4();

    constructor()
    {
        this.#position = new Vector2(0, 0);
        this.#zoom = 1.0;
        this.#rotation = 0.0;
        this.#viewport = null;
        this.#worldBounds = null;
        this.#isPixelSnap = false;

        this.#target = null;
        this.#smoothing = 0.0;
        this.#deadZone = new Vector2(0, 0);

        this.#trauma = 0.0;
        this.#traumaDecay = Camera2D.#kDefaultTraumaDecay;
        this.#shakeMaxOffset = Camera2D.#kDefaultShakeOffset;
        this.#shakeMaxRotation = 0.0;
        this.#shakeFrequency = Camera2D.#kDefaultShakeFrequency;
        this.#shakeTime = 0.0;
        this.#shakeSeed = Math.floor(Math.random() * 0x7fffffff);
        this.#shakeOffset = new Vector2(0, 0);
        this.#shakeRotation = 0.0;

        this.#worldToScreen = new Matrix3();
        this.#isDirty = true;
        this.#builtView = new Vector4();
        this.#builtScale = 0;
        this.#version = 0;
    }

    // The world point at the center of the view
    setPosition(x, y)
    {
        this.#position.set(x, y);
        this.#changed();
    }

    // Read-only; change it with setPosition()
    getPosition() { return this.#position; }

    // Screen design units per world unit, above 0. Returns false (changing nothing) otherwise.
    setZoom(zoom)
    {
        if (Number.isFinite(zoom) === false || zoom <= 0.0)
        {
            console.error("Camera2D.setZoom() needs a zoom above 0");
                return false;
        }

        this.#zoom = zoom;
        this.#changed();
            return true;
    }

    getZoom() { return this.#zoom; }

    // Radians, counter-clockwise
    setRotation(radians)
    {
        this.#rotation = radians;
        this.#changed();
    }

    getRotation() { return this.#rotation; }

    // The part of the screen it draws into, in design units ((x, y) its bottom-left). Returns false if the size isn't above 0.
    setViewport(x, y, width, height)
    {
        if (Number.isFinite(x) === false || Number.isFinite(y) === false || Number.isFinite(width) === false ||
            Number.isFinite(height) === false || width <= 0.0 || height <= 0.0)
        {
            console.error("Camera2D.setViewport() needs a position and a size above 0");
                return false;
        }

        if (this.#viewport === null)
            this.#viewport = new Vector4();

        this.#viewport.set(x, y, width, height);
        this.#changed();
            return true;
    }

    // Back to the whole view
    clearViewport()
    {
        this.#viewport = null;
        this.#changed();
    }

    // True if it draws into part of the view (setViewport()) rather than all of it
    hasViewport() { return (this.#viewport !== null); }

    /*
        The viewport in screen design units, written into out (a Vector4: x, y, width, height)
        and returned. With none set, the design area of the surface being drawn (the whole
        view on the canvas; a RenderTarget's design rect in one).
    */
    getViewport(out = new Vector4())
    {
        if (this.#viewport === null)
            ClipSpace.getSurfaceRect(out);
        else
            out.set(this.#viewport.x, this.#viewport.y, this.#viewport.z, this.#viewport.w);

        return out;
    }

    // update() keeps the view inside this world rect ((x, y) its bottom-left). Returns false if the size isn't above 0.
    setWorldBounds(x, y, width, height)
    {
        if (Number.isFinite(x) === false || Number.isFinite(y) === false || Number.isFinite(width) === false ||
            Number.isFinite(height) === false || width <= 0.0 || height <= 0.0)
        {
            console.error("Camera2D.setWorldBounds() needs a position and a size above 0");
                return false;
        }

        if (this.#worldBounds === null)
            this.#worldBounds = new Vector4();

        this.#worldBounds.set(x, y, width, height);
            return true;
    }

    clearWorldBounds() { this.#worldBounds = null; }

    setPixelSnap(snap)
    {
        this.#isPixelSnap = (snap === true);
        this.#changed();
    }

    isPixelSnap() { return this.#isPixelSnap; }

    /*
        update() moves the camera after target: a Model2D (its anchor) or anything with
        x and y (a Vector2). null stops following. smoothing is the seconds it takes to
        close half the distance (0 stays exactly on it). The target moves freely inside
        a dead zone of deadZoneWidth x deadZoneHeight world units around the center.
    */
    follow(target, smoothing = 0.0, deadZoneWidth = 0.0, deadZoneHeight = 0.0)
    {
        if (Number.isFinite(smoothing) === false || smoothing < 0.0 ||
            Number.isFinite(deadZoneWidth) === false || deadZoneWidth < 0.0 ||
            Number.isFinite(deadZoneHeight) === false || deadZoneHeight < 0.0)
        {
            console.error("Camera2D.follow() needs a smoothing and dead zone of 0 or more");
                return false;
        }

        this.#target = target;
        this.#smoothing = smoothing;
        this.#deadZone.set(deadZoneWidth, deadZoneHeight);
            return true;
    }

    getTarget() { return this.#target; }

    /*
        Shakes the camera: adds amount (0 - 1) to its trauma, held at 1. Small hits
        add a little (0.2), big ones a lot (0.6); hits close together build up. The
        shake is trauma squared, so small amounts barely move it and big ones
        shake hard. Trauma falls by the decay (setTraumaDecay()) every second.
    */
    addTrauma(amount)
    {
        if (Number.isFinite(amount) === false || amount < 0.0)
        {
            console.error("Camera2D.addTrauma() needs an amount of 0 or more");
                return false;
        }

        this.#trauma = Math.min(1.0, this.#trauma + amount);
            return true;
    }

    // Sets the trauma (0 - 1) outright; 0 stops the shake
    setTrauma(trauma)
    {
        if (Number.isFinite(trauma) === false || trauma < 0.0 || trauma > 1.0)
        {
            console.error("Camera2D.setTrauma() needs a trauma from 0 to 1");
                return false;
        }

        this.#trauma = trauma;
            return true;
    }

    getTrauma() { return this.#trauma; }

    isShaking() { return (this.#trauma > 0.0); }

    /*
        The most the shake moves the view, at full trauma: maxOffset screen design units
        (the same on screen at any zoom) and maxRotation radians (0, the default, for no
        rotation shake). Returns false (changing nothing) if either is below 0.
    */
    setShakeLimits(maxOffset, maxRotation = 0.0)
    {
        if (Number.isFinite(maxOffset) === false || maxOffset < 0.0 || Number.isFinite(maxRotation) === false || maxRotation < 0.0)
        {
            console.error("Camera2D.setShakeLimits() needs an offset and rotation of 0 or more");
                return false;
        }

        this.#shakeMaxOffset = maxOffset;
        this.#shakeMaxRotation = maxRotation;
            return true;
    }

    getShakeMaxOffset() { return this.#shakeMaxOffset; }
    getShakeMaxRotation() { return this.#shakeMaxRotation; }

    // How many times a second the shake changes direction, above 0: low is a slow sway, high a rattle
    setShakeFrequency(frequency)
    {
        if (Number.isFinite(frequency) === false || frequency <= 0.0)
        {
            console.error("Camera2D.setShakeFrequency() needs a frequency above 0");
                return false;
        }

        this.#shakeFrequency = frequency;
            return true;
    }

    getShakeFrequency() { return this.#shakeFrequency; }

    // Trauma lost per second, above 0: 1 takes full trauma to none in 1 second
    setTraumaDecay(perSecond)
    {
        if (Number.isFinite(perSecond) === false || perSecond <= 0.0)
        {
            console.error("Camera2D.setTraumaDecay() needs a decay above 0");
                return false;
        }

        this.#traumaDecay = perSecond;
            return true;
    }

    getTraumaDecay() { return this.#traumaDecay; }

    // Follows the target, keeps inside the world bounds, then shakes. Call once a frame.
    update(dt)
    {
        this.#updateFollow(dt);
        this.#clampToBounds();
        this.#updateShake(dt);
        this.#changed();
    }

    // A screen point in design units (e.g. InputManager.getPosition()) in world units, written into out and returned
    screenToWorld(point, out = new Vector2())
    {
        const c = this.#getCenter();
        const v = this.getViewport(Camera2D.#kViewport);
        const vx = point.x - (v.x + (v.z / 2.0));
        const vy = point.y - (v.y + (v.w / 2.0));
        const r = this.#getViewRotation();
        const cos = Math.cos(r);
        const sin = Math.sin(r);

        out.set(c.x + (((vx * cos) - (vy * sin)) / this.#zoom),
                c.y + (((vx * sin) + (vy * cos)) / this.#zoom));
            return out;
    }

    // A world point on the screen in design units, written into out and returned
    worldToScreen(point, out = new Vector2())
    {
        const c = this.#getCenter();
        const v = this.getViewport(Camera2D.#kViewport);
        const dx = point.x - c.x;
        const dy = point.y - c.y;
        const r = this.#getViewRotation();
        const cos = Math.cos(r);
        const sin = Math.sin(r);

        out.set((v.x + (v.z / 2.0)) + (this.#zoom * ((dx * cos) + (dy * sin))),
                (v.y + (v.w / 2.0)) + (this.#zoom * ((dy * cos) - (dx * sin))));
            return out;
    }

    // The world rect in view (bigger than the view while rotated), written into out (a Vector4: x, y, width, height) and returned
    getWorldBounds(out = new Vector4())
    {
        const c = this.#getCenter();
        const half = this.#getHalfExtents(this.#getViewRotation());
            out.set(c.x - half.x, c.y - half.y, half.x * 2.0, half.y * 2.0);
            return out;
    }

    // World to screen design units, for ClipSpace (which takes the screen to clip space for the surface). Read-only.
    getWorldToScreen()
    {
        const v = this.getViewport(Camera2D.#kViewport);
        const b = this.#builtView;
        const scale = ClipSpace.getSurfaceScale();

        if (this.#isDirty === true || v.x !== b.x || v.y !== b.y || v.z !== b.z || v.w !== b.w ||
            (this.#isPixelSnap === true && scale !== this.#builtScale))
            this.#build(v, scale);

        return this.#worldToScreen;
    }

    // Goes up whenever the camera changes
    getVersion() { return this.#version; }

    // *** Internal Methods ***

    #changed()
    {
        this.#isDirty = true;
        ++this.#version;
    }

    // The position the view is centered on: shaken, then snapped. Shared; read it right away.
    #getCenter()
    {
        let c = Camera2D.#kCenter;
        c.set(this.#position.x + this.#shakeOffset.x, this.#position.y + this.#shakeOffset.y);

        if (this.#isPixelSnap === true)
        {
            const k = this.#zoom * ClipSpace.getSurfaceScale(); // Device pixels per world unit

            if (k > 0.0)
                c.set(Math.round(c.x * k) / k, Math.round(c.y * k) / k);
        }

        return c;
    }

    // Half the size of the world rect in view, as a new Vector2, allowing for rotation (radians)
    #getHalfExtents(rotation)
    {
        const v = this.getViewport(Camera2D.#kViewport);
        const cos = Math.abs(Math.cos(rotation));
        const sin = Math.abs(Math.sin(rotation));
        const hw = v.z / (2.0 * this.#zoom);
        const hh = v.w / (2.0 * this.#zoom);

        return new Vector2((hw * cos) + (hh * sin), (hw * sin) + (hh * cos));
    }

    /*
        World point p, as the row vector [x, y, 1], times this matrix is screen design units:
            view   = rotate by -rotation (p - center) * zoom    (center and rotation include the shake)
            screen = view + the viewport's center
        v is the viewport (getViewport()), scale the surface's pixels per design unit.
    */
    #build(v, scale)
    {
        const c = this.#getCenter();
        const r = this.#getViewRotation();
        const cos = Math.cos(r);
        const sin = Math.sin(r);
        const z = this.#zoom;
        const vcx = v.x + (v.z / 2.0);
        const vcy = v.y + (v.w / 2.0);

        this.#worldToScreen.set(z * cos, -z * sin, 0.0,
                                z * sin,  z * cos, 0.0,
                                (-z * ((cos * c.x) + (sin * c.y))) + vcx,
                                (-z * ((cos * c.y) - (sin * c.x))) + vcy,
                                1.0);

        this.#builtView.set(v.x, v.y, v.z, v.w);
        this.#builtScale = scale;
        this.#isDirty = false;
    }

    #updateFollow(dt)
    {
        const t = this.#target;

        if (t === null)
            return;

        const anchor = (typeof t.getAnchor === "function") ? t.getAnchor() : t;
        const p = this.#position;
        let goalX = p.x;
        let goalY = p.y;

        // Only as far as the target is outside the dead zone
        const halfW = this.#deadZone.x / 2.0;
        const halfH = this.#deadZone.y / 2.0;

        if (anchor.x > p.x + halfW) goalX = anchor.x - halfW;
        else if (anchor.x < p.x - halfW) goalX = anchor.x + halfW;

        if (anchor.y > p.y + halfH) goalY = anchor.y - halfH;
        else if (anchor.y < p.y - halfH) goalY = anchor.y + halfH;

        // Half the way every smoothing seconds, whatever the frame rate
        const k = (this.#smoothing > 0.0) ? 1.0 - Math.pow(0.5, dt / this.#smoothing) : 1.0;
        p.set(p.x + ((goalX - p.x) * k), p.y + ((goalY - p.y) * k));
    }

    #clampToBounds()
    {
        const b = this.#worldBounds;

        if (b === null)
            return;

        const half = this.#getHalfExtents(this.#rotation); // Unshaken, so the shake doesn't push the camera about
        const p = this.#position;
        let x = p.x;
        let y = p.y;

        // A level smaller than the view is centered
        if (half.x * 2.0 >= b.z)
            x = b.x + (b.z / 2.0);
        else
            x = Math.min(Math.max(x, b.x + half.x), b.x + b.z - half.x);

        if (half.y * 2.0 >= b.w)
            y = b.y + (b.w / 2.0);
        else
            y = Math.min(Math.max(y, b.y + half.y), b.y + b.w - half.y);

        p.set(x, y);
    }

    /*
        Samples this camera's noise lines at the time so far: each wobbles smoothly
        from -1 to 1, so the shake is the same at any frame rate. Scaled by trauma
        squared, then the trauma decays.
    */
    #updateShake(dt)
    {
        if (this.#trauma <= 0.0)
        {
            this.#shakeOffset.set(0, 0);
            this.#shakeRotation = 0.0;
            this.#shakeTime = 0.0; // Keeps the noise input small
                return;
        }

        this.#shakeTime += dt;

        const amount = this.#trauma * this.#trauma;
        const t = this.#shakeTime * this.#shakeFrequency;
        const offset = (this.#shakeMaxOffset * amount) / this.#zoom; // Screen units to world units
        const seed = this.#shakeSeed;

        this.#shakeOffset.set(offset * MathUtil.noise1D(t, seed), offset * MathUtil.noise1D(t, seed + 1));
        this.#shakeRotation = this.#shakeMaxRotation * amount * MathUtil.noise1D(t, seed + 2);

        this.#trauma = Math.max(0.0, this.#trauma - (this.#traumaDecay * dt));
    }

    // The rotation the view is drawn at: the camera's, plus the shake's
    #getViewRotation() { return this.#rotation + this.#shakeRotation; }
}

/*
    ClipSpace - How design units reach the GL's clip space, and what is clipped.

    Camera: setCamera(camera) draws the world through a Camera2D from then on;
    setCamera(null) draws in screen design units again (the world is the
    screen). The active camera's world-to-clip matrix is in the Frame uniform
    block (see RenderUniformBlocks), uploaded once when the camera changes, so
    every shader reads it without per-draw uniforms. A camera with a viewport
    also clips drawing to it. MaterialBatcher sets the camera for each layer.

    Clipping: pushClipRect(x, y, width, height) limits drawing to a rect in
    screen design units (the GL scissor test) until the matching
    popClipRect(). Clip rects nest: each one is cut down to the one it's
    inside, and to the active camera's viewport. Only what's drawn while it's
    pushed is clipped, so with a MaterialBatcher push and pop inside something
    drawn from the batcher (see submitDrawable()), not around submit().

    The Frame block is created and given the screen mapping when the first
    shader using it is loaded (uploadBuffer()), so drawing works without a
    camera or beginFrame(). beginFrame() resets the per-frame state.

    Surfaces: drawing goes to the canvas or to a RenderTarget (see
    RenderTargets in render_target.js). Each surface has a design area (the
    whole design resolution on the canvas, the target's design rect in a
    target) that ClipSpace maps onto its pixels: the camera's world-to-screen
    matrix is taken on to the surface's clip space, and clip rects and camera
    viewports to its pixels. RenderTargets saves ClipSpace's state on push()
    (saveState()), starts the target clean (resetState()) and puts it back on
    pop() (restoreState()).

    Each frame, after WGLV.beginFrame():
        ClipSpace.beginFrame(); // No clip rects, no camera

        ClipSpace.pushClipRect(100, 200, 400, 80);
        model.render();
        ClipSpace.popClipRect();
*/
class ClipSpace
{
    // Frame block, std140: mat3 u_worldToClip (3 columns of 4 floats), vec2 u_res, 2 unused
    static #kFrameFloats = 16;

    static #frame = null;       // UniformBuffer, made on first use
    static #frameData = new Float32Array(ClipSpace.#kFrameFloats);
    static #camera = null;      // Active Camera2D, or null for the screen
    static #uploadedVersion = -1;
    static #uploadedSurface = new Vector4(); // The surface design area it was uploaded for
    static #isUploaded = false;

    static #clipStack = [];     // Pushed clip rects in the surface's pixels: { x, y, w, h }, innermost last

    static #kIdentity = [1, 0, 0, 0, 1, 0, 0, 0, 1];

    // Scratch, one per use so they never overwrite each other
    static #kViewport = new Vector4();
    static #kSurface = new Vector4();
    static #kScaleRect = new Vector4();
    static #kPixelRect = new Vector4();

    /*
        Back to the canvas (popping any RenderTargets left pushed), with no clip rects
        and no camera. Call each frame after WGLV.beginFrame().
    */
    static beginFrame()
    {
        RenderTargets.beginFrame();

        if (ClipSpace.#clipStack.length > 0)
        {
            console.error(`ClipSpace.beginFrame(): ${ClipSpace.#clipStack.length} clip rect(s) were never popped`);
            ClipSpace.#clipStack.length = 0;
        }

        ClipSpace.setCamera(null);
        ClipSpace.#applyClip();
    }

    /*
        Draws through camera (a Camera2D) from now on, or in screen design units with
        null. Call again after changing the camera; it uploads only if something changed.
    */
    static setCamera(camera)
    {
        if (camera !== null && (camera instanceof Camera2D) === false)
        {
            console.error("ClipSpace.setCamera() needs a Camera2D or null");
                return false;
        }

        if (ClipSpace.#ensureFrame() === false)
            return false;

        const s = ClipSpace.getSurfaceRect(ClipSpace.#kSurface);
        const u = ClipSpace.#uploadedSurface;
        const isSameSurface = (s.x === u.x && s.y === u.y && s.z === u.z && s.w === u.w);
        const version = (camera !== null) ? camera.getVersion() : -1;
        const viewportChanged = (camera !== ClipSpace.#camera || (camera !== null && version !== ClipSpace.#uploadedVersion) || isSameSurface === false);

        if (ClipSpace.#isUploaded === true && camera === ClipSpace.#camera && version === ClipSpace.#uploadedVersion && isSameSurface === true)
            return true; // Already there

        // World to screen design units (the camera's, or the same units with none), then on to the surface's clip space
        let d = ClipSpace.#frameData;
        const m = (camera !== null) ? camera.getWorldToScreen().m : ClipSpace.#kIdentity;

        ClipSpace.#writeMatrix(d, m, s);
        d[12] = s.z;
        d[13] = s.w;
        ClipSpace.#frame.update(d);

        ClipSpace.#camera = camera;
        ClipSpace.#uploadedVersion = version;
        u.set(s.x, s.y, s.z, s.w);
        ClipSpace.#isUploaded = true;

        if (viewportChanged === true)
            ClipSpace.#applyClip(); // A camera viewport clips too

        return true;
    }

    // The active Camera2D, or null for the screen
    static getCamera() { return ClipSpace.#camera; }

    // The design area of the surface being drawn, written into out (a Vector4: x, y, width, height) and returned
    static getSurfaceRect(out = new Vector4())
    {
        const target = RenderTargets.getCurrent();

        if (target !== null)
            return target.getDesignRect(out);

        out.set(0, 0, WGLV.getWidth(), WGLV.getHeight());
            return out;
    }

    // Device pixels per design unit on the surface being drawn, across (the view scale on the canvas)
    static getSurfaceScale()
    {
        const target = RenderTargets.getCurrent();

        if (target === null)
            return WGLV.getViewScale();

        return target.getWidth() / target.getDesignRect(ClipSpace.#kScaleRect).z;
    }

    // A rect in screen design units in the surface's pixels ({ x, y, w, h }, rounded outward), e.g. for a GL viewport
    static toPixelRect(x, y, width, height) { return ClipSpace.#toPixels(x, y, width, height); }

    // *** For RenderTargets ***

    // The camera and clip rects, to put back with restoreState()
    static saveState() { return { camera: ClipSpace.#camera, clips: ClipSpace.#clipStack.slice() }; }

    // No camera and no clip rects, on the surface now being drawn
    static resetState()
    {
        ClipSpace.#clipStack.length = 0;
        ClipSpace.setCamera(null);
        ClipSpace.#applyClip();
    }

    // Back to a saveState(), on the surface now being drawn
    static restoreState(state)
    {
        ClipSpace.#clipStack = state.clips.slice();
        ClipSpace.setCamera(state.camera);
        ClipSpace.#applyClip();
    }

    // Sets the scissor test again, after GL calls that changed it (e.g. a blit)
    static refresh() { ClipSpace.#applyClip(); }

    /*
        The Frame block's buffer provider (see RenderUniformBlocks), called by Shader.load():
        the first time, creates the buffer and sends the active camera's mapping (the
        screen until a camera is set) to the Frame binding point; afterwards returns
        right away. So models draw in screen design units even before any setCamera()
        or beginFrame().
    */
    static uploadBuffer()
    {
        if (ClipSpace.#isUploaded === true)
            return true;

        return ClipSpace.setCamera(ClipSpace.#camera);
    }

    /*
        Limits drawing to a rect in screen design units ((x, y) its bottom-left), cut
        down to any clip rect already pushed (or the camera's viewport), until
        popClipRect(). Returns false (pushing nothing) if the size isn't valid.
    */
    static pushClipRect(x, y, width, height)
    {
        if (WGLV.context === null)
            return false;

        if (Number.isFinite(x) === false || Number.isFinite(y) === false || Number.isFinite(width) === false || Number.isFinite(height) === false || width < 0 || height < 0)
        {
            console.error("ClipSpace.pushClipRect() needs a position and a size of 0 or more");
                return false;
        }

        const outer = (ClipSpace.#clipStack.length > 0) ? ClipSpace.#clipStack[ClipSpace.#clipStack.length - 1] : ClipSpace.#getBaseRect();
        const r = ClipSpace.#toPixels(x, y, width, height);

        const left = Math.max(r.x, outer.x);
        const bottom = Math.max(r.y, outer.y);
        const right = Math.min(r.x + r.w, outer.x + outer.w);
        const top = Math.min(r.y + r.h, outer.y + outer.h);

        ClipSpace.#clipStack.push({ x: left, y: bottom, w: Math.max(0, right - left), h: Math.max(0, top - bottom) });
        ClipSpace.#applyClip();
            return true;
    }

    // Removes the last pushed clip rect; the one before it (or none) applies again
    static popClipRect()
    {
        if (ClipSpace.#clipStack.length === 0)
        {
            console.error("ClipSpace.popClipRect() without a pushClipRect()");
                return;
        }

        ClipSpace.#clipStack.pop();
        ClipSpace.#applyClip();
    }

    // Clip rects pushed and not yet popped
    static getClipDepth() { return ClipSpace.#clipStack.length; }

    // Frees the Frame block's buffer; the next setCamera() or beginFrame() makes it again
    static unload()
    {
        if (ClipSpace.#frame !== null)
            ClipSpace.#frame.unload();

        ClipSpace.#frame = null;
        ClipSpace.#camera = null;
        ClipSpace.#isUploaded = false;
        ClipSpace.#uploadedSurface.set(0, 0, 0, 0);
        ClipSpace.#clipStack.length = 0;
    }

    // *** Internal Methods ***

    static #ensureFrame()
    {
        if (ClipSpace.#frame !== null)
            return true;

        if (WGLV.context === null)
        {
            console.error("ClipSpace needs WGLV.init() first");
                return false;
        }

        let frame = new UniformBuffer();

        if (frame.load(RenderUniformBlocks.kFrame, ClipSpace.#kFrameFloats) === false)
            return false;

        ClipSpace.#frame = frame;
        ClipSpace.#isUploaded = false;
            return true;
    }

    /*
        A row-major world-to-screen Matrix3 m (its 9 values), taken on to clip space for the
        surface design area s (screen (s.x, s.y) - (s.x + s.z, s.y + s.w) to (-1, -1) - (1, 1)),
        written as the std140 mat3's columns: its rows become GLSL's columns, so GLSL works
        out [x, y, 1] * M.
    */
    static #writeMatrix(d, m, s)
    {
        const ax = 2.0 / s.z;
        const ay = 2.0 / s.w;
        const bx = -1.0 - (s.x * ax);
        const by = -1.0 - (s.y * ay);

        for (let row = 0; row < 3; ++row)
        {
            const i = row * 3;
            const o = row * 4;
            const w = m[i + 2];

            d[o] = (m[i] * ax) + (bx * w);
            d[o + 1] = (m[i + 1] * ay) + (by * w);
            d[o + 2] = w;
            d[o + 3] = 0.0;
        }
    }

    // A rect in screen design units, in the surface's pixels, rounded outward so edges in between pixels aren't lost
    static #toPixels(x, y, width, height)
    {
        const target = RenderTargets.getCurrent();
        let ox = 0.0; // The design area's bottom-left, in pixels
        let oy = 0.0;
        let sx = 0.0; // Pixels per design unit
        let sy = 0.0;
        let dx = 0.0; // The design area's bottom-left, in design units
        let dy = 0.0;

        if (target === null)
        {
            ox = WGLV.getViewportX();
            oy = WGLV.getViewportY();
            sx = WGLV.getViewScale();
            sy = sx;
        }
        else
        {
            const r = target.getDesignRect(ClipSpace.#kPixelRect);
            sx = target.getWidth() / r.z;
            sy = target.getHeight() / r.w;
            dx = r.x;
            dy = r.y;
        }

        const left = Math.floor(ox + ((x - dx) * sx));
        const bottom = Math.floor(oy + ((y - dy) * sy));
        const right = Math.ceil(ox + ((x + width - dx) * sx));
        const top = Math.ceil(oy + ((y + height - dy) * sy));

        return { x: left, y: bottom, w: right - left, h: top - bottom };
    }

    // All of the surface being drawn, in its pixels: the canvas's view, or the whole target
    static #getSurfacePixels()
    {
        const target = RenderTargets.getCurrent();

        if (target !== null)
            return { x: 0, y: 0, w: target.getWidth(), h: target.getHeight() };

        return { x: WGLV.getViewportX(), y: WGLV.getViewportY(), w: WGLV.getViewportWidth(), h: WGLV.getViewportHeight() };
    }

    // What clip rects are cut down to: the camera's viewport, or the whole surface
    static #getBaseRect()
    {
        const view = ClipSpace.#getSurfacePixels();
        const c = ClipSpace.#camera;

        if (c === null || c.hasViewport() === false)
            return view;

        const v = c.getViewport(ClipSpace.#kViewport);
        const r = ClipSpace.#toPixels(v.x, v.y, v.z, v.w);
        const left = Math.max(r.x, view.x);
        const bottom = Math.max(r.y, view.y);
        const right = Math.min(r.x + r.w, view.x + view.w);
        const top = Math.min(r.y + r.h, view.y + view.h);

        return { x: left, y: bottom, w: Math.max(0, right - left), h: Math.max(0, top - bottom) };
    }

    // Sets the scissor test to the innermost clip rect or the camera's viewport, or turns it off when neither applies
    static #applyClip()
    {
        const gl = WGLV.context;

        if (gl === null)
            return;

        let r = null;

        if (ClipSpace.#clipStack.length > 0)
            r = ClipSpace.#clipStack[ClipSpace.#clipStack.length - 1];
        else if (ClipSpace.#camera !== null && ClipSpace.#camera.hasViewport() === true)
            r = ClipSpace.#getBaseRect();

        if (r === null)
        {
            gl.disable(gl.SCISSOR_TEST); // The GL viewport already clips drawing to the view
                return;
        }

        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(r.x, r.y, r.w, r.h);
    }
}

// Every shader declaring the Frame block gets its data on load (see RenderUniformBlocks)
RenderUniformBlocks.setBufferProvider(RenderUniformBlocks.kFrame, ClipSpace.uploadBuffer);
