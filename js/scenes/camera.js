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

    Entity: a Camera2D is an Entity (entity.js), so its position and rotation
    are its local transform, and its world transform is what it shows. Make it
    a child of something (a ship, a car) to move and turn with it, instead of
    or as well as follow(). Scale isn't used: zoom with setZoom().

    Usage:
        let camera = new Camera2D();
        camera.setPosition(player.getAnchor().x, player.getAnchor().y);
        camera.setZoom(1.5);
        camera.follow(player, 0.15);       // Optional: keep the player in view, catching up half the way every 0.15 s
        camera.setWorldBounds(0, 0, 4000, 2000); // Optional: never show past the level's edges

        // Each frame
        camera.update(dt);                 // Follow, bounds and shake
        batcher.setCamera(camera);         // Layers that follow the camera draw through it (see Batcher)

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

    World bounds: setWorldBounds() keeps the view inside a world rect. With
    no parent, update() keeps the position inside them; with one, the view is
    held inside when it's drawn, so a parent can't push it out.

    Pixel snap: setPixelSnap(true) rounds the position so the world moves in
    whole device pixels, which stops thin lines and pixel art shimmering
    while the camera moves. It only lines up while the rotation (with any
    rotation shake) is 0.
*/
class Camera2D extends Entity
{
    #zoom;
    #viewport;    // Vector4 (x, y, width, height) in screen design units, or null for the whole view
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
    #seenWorldVersion; // The world version (Entity) #version last caught up with

    // Shake defaults
    static #kDefaultTraumaDecay = 1.0;     // Full trauma is gone in 1 second
    static #kDefaultShakeOffset = 24.0;    // Screen design units
    static #kDefaultShakeFrequency = 12.0; // Wobbles per second

    // Scratch for the view's center
    static #kCenter = new Vector2();
    static #kViewport = new Vector4();
    static #kWorldPoint = new Vector2();

    constructor(_name = "")
    {
        super(_name);

        this.#zoom = 1.0;
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
        this.#seenWorldVersion = -1;
    }

    // Position and rotation (Entity): the point at the center of the view, and the turn, relative to the parent

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
        update() moves the camera after target: an Entity (its world position, a
        Model2D's anchor) or anything with x and y (a Vector2). null stops following. smoothing is the seconds it takes to
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

    // Plays its motions (see Entity.update()), follows the target, keeps inside the world bounds, then shakes. Call once a frame.
    update(dt)
    {
        super.update(dt);
        this.#updateFollow(dt);

        if (this.getParent() === null)
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
        this.#catchUpWorld();

        const v = this.getViewport(Camera2D.#kViewport);
        const b = this.#builtView;
        const scale = ClipSpace.getSurfaceScale();

        if (this.#isDirty === true || v.x !== b.x || v.y !== b.y || v.z !== b.z || v.w !== b.w ||
            (this.#isPixelSnap === true && scale !== this.#builtScale))
            this.#build(v, scale);

        return this.#worldToScreen;
    }

    // Goes up whenever the camera changes, including through a parent
    getVersion()
    {
        this.#catchUpWorld();
            return this.#version;
    }

    // *** Internal Methods ***

    #changed()
    {
        this.#isDirty = true;
        ++this.#version;
    }

    // The camera, or a parent, moved or turned since the last check: the view changed
    #catchUpWorld()
    {
        const worldVersion = this.getWorldVersion();

        if (worldVersion !== this.#seenWorldVersion)
        {
            this.#seenWorldVersion = worldVersion;
            this.#changed();
        }
    }

    // The world position the view is centered on: held inside the world bounds, shaken, then snapped. Shared; read it right away.
    #getCenter()
    {
        const world = this.getWorldTransform();
        let c = Camera2D.#kCenter;

        c.set(world.getX(), world.getY());

        if (this.getParent() !== null)
            this.#clampPoint(c); // With no parent, update() already did

        c.set(c.x + this.#shakeOffset.x, c.y + this.#shakeOffset.y);

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

        const anchor = (t instanceof Entity) ? t.getWorldTransform().getPosition() : t;
        const p = this.getWorldTransform().getPosition();
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
        let w = Camera2D.#kWorldPoint;

        w.set(p.x + ((goalX - p.x) * k), p.y + ((goalY - p.y) * k));

        // The goal is in the world; the position is relative to the parent
        const parent = this.getParent();

        if (parent !== null)
            parent.worldToLocal(w, w);

        this.setPosition(w.x, w.y);
    }

    // With no parent: keeps the position inside the world bounds
    #clampToBounds()
    {
        const p = this.getPosition();
        let c = Camera2D.#kWorldPoint;

        c.set(p.x, p.y);
        this.#clampPoint(c);

        if (c.x !== p.x || c.y !== p.y)
            this.setPosition(c.x, c.y);
    }

    // Moves the view center c (a world point) so the view stays inside the world bounds, if any
    #clampPoint(c)
    {
        const b = this.#worldBounds;

        if (b === null)
            return;

        const half = this.#getHalfExtents(this.getWorldTransform().getRotation()); // Unshaken, so the shake doesn't push the camera about
        let x = c.x;
        let y = c.y;

        // A level smaller than the view is centered
        if (half.x * 2.0 >= b.z)
            x = b.x + (b.z / 2.0);
        else
            x = Math.min(Math.max(x, b.x + half.x), b.x + b.z - half.x);

        if (half.y * 2.0 >= b.w)
            y = b.y + (b.w / 2.0);
        else
            y = Math.min(Math.max(y, b.y + half.y), b.y + b.w - half.y);

        c.set(x, y);
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

    // The rotation the view is drawn at: the camera's world rotation, plus the shake's
    #getViewRotation() { return this.getWorldTransform().getRotation() + this.#shakeRotation; }
}
