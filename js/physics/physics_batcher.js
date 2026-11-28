"use strict";

/*
    PhysicsBatcher - The simulation: steps every PhysicsEntity's body at a
    fixed rate, then writes where each one is back to its Entity. It drives
    physics the way the Batcher drives drawing (docs/physics_plan.md), and
    there's one per app session.

    Ported from Planck.js 1.5.1 (MIT, Copyright (c) Erin Catto, Ali Shakiba),
    itself a port of Box2D: World's step and Solver's integration.

        let physics = new PhysicsBatcher();       // 100 design units per meter
        physics.load();                           // Takes the session's one slot

        let crate = new PhysicsEntity("crate");
        crate.setPosition(400, 600);
        crate.addBody(physics, PhysicsBodyType.kDynamic);
        crate.addBox(100, 100);
        scene.add(crate);

        // Each frame
        scene.update(dt);                         // Game logic: forces, impulses, kinematic moves
        physics.update(dt);                       // Fixed steps, then each body's pose to its Entity
        scene.submit(batcher);
        physics.submitDebug(batcher, 6);          // Optional: the shapes as lines

    One at a time: load() fails (console.error) while another PhysicsBatcher is
    loaded; unload() frees the slot (and drops every body from its Entity), so
    a test or a page can make a fresh one.

    Fixed steps: update(dt) adds dt to the time not yet stepped, and runs as
    many steps of getStep() (1/60 s) as it holds, at most getMaxSteps() (4).
    Time past that is dropped, so a long frame slows the simulation down
    rather than piling steps up. A frame within a millionth of a step of
    another step counts as one, so 1/60 s frames give one step each.

    Blending: what's left over (less than a step) is getAlpha() of a step,
    and each moving body's Entity is placed that far from its pose before the
    last step to its pose after it. So the Entity is drawn smoothly, up to one
    step behind the simulation; PhysicsEntity.getBodyPosition() is where the
    simulation has it.

    Order: bodies are stepped in the order they were added, whatever their
    Entities' layers or Scene order, so the same inputs give the same result
    every time. Bodies are added and removed with PhysicsEntity.addBody() and
    removeBody(); during an update() (from a subclass's _writePose(), and from
    Phase 2, a contact handler) that waits until the update ends. A body being
    removed is left out of the rest of the update at once.

    Forces: a force (PhysicsEntity.applyForce()) acts for the frame it's
    applied in: update(dt) spreads force x dt over the frame's steps, so a
    force applied every frame acts the same however many steps each frame
    runs (two 1/120 s frames make one 1/60 s step with the force they each
    applied). Forces are dropped after each update that steps. Impulses
    change the velocity at once.

    Phase 1: gravity, velocities, forces, damping and kinematic moves; no
    collision (Phase 2), solver (Phase 3) or sleeping (Phase 3).
*/
class PhysicsBatcher
{
    static #loaded = null;        // The PhysicsBatcher holding the slot, or null
    static #kStepEpsilon = 1e-6;  // A fraction of a step that still counts as a whole one
    static #kDebugAt = null;      // Scratch Transform2D for debug lines (made when first needed)

    // Debug colors (submitDebug())
    static kStaticColor = Object.freeze(new Vector4(0.5, 0.9, 0.5, 1.0));
    static kKinematicColor = Object.freeze(new Vector4(0.5, 0.6, 1.0, 1.0));
    static kDynamicColor = Object.freeze(new Vector4(1.0, 0.7, 0.6, 1.0));
    static kSleepingColor = Object.freeze(new Vector4(0.6, 0.6, 0.6, 1.0));

    #isLoaded;
    #tolerances;      // PhysicsTolerances for the units per meter
    #step;            // Seconds per step
    #maxSteps;
    #velocityIterations;
    #positionIterations;
    #gravity;         // Vector2, units / s^2
    #bodies;          // PhysicsBodys, in the order added
    #pending;         // [isAdd, body], waiting for the update to end
    #passes;          // update() calls running
    #accumulator;     // Seconds not yet stepped
    #alpha;           // getAlpha()
    #lastSteps;       // Steps the last update() ran
    #debugLine;       // Rect2D for submitDebug(), made when first needed
    #debugLineWidth;

    // unitsPerMeter: design units per meter (above 0), 100 by default; Box2D's tolerances are scaled by it
    constructor(unitsPerMeter = PhysicsDefines.kDefaultUnitsPerMeter)
    {
        if (Number.isFinite(unitsPerMeter) === false || unitsPerMeter <= 0.0)
        {
            console.error(`PhysicsBatcher: unitsPerMeter must be above 0; using ${PhysicsDefines.kDefaultUnitsPerMeter}`);
            unitsPerMeter = PhysicsDefines.kDefaultUnitsPerMeter;
        }

        this.#isLoaded = false;
        this.#tolerances = new PhysicsTolerances(unitsPerMeter);
        this.#step = PhysicsDefines.kDefaultStep;
        this.#maxSteps = PhysicsDefines.kDefaultMaxSteps;
        this.#velocityIterations = PhysicsDefines.kDefaultVelocityIterations;
        this.#positionIterations = PhysicsDefines.kDefaultPositionIterations;
        this.#gravity = new Vector2(0.0, PhysicsDefines.kDefaultGravity * unitsPerMeter);
        this.#bodies = [];
        this.#pending = [];
        this.#passes = 0;
        this.#accumulator = 0.0;
        this.#alpha = 0.0;
        this.#lastSteps = 0;
        this.#debugLine = null;
        this.#debugLineWidth = 2.0;
    }

    // *** Loading ***

    // Takes the session's one slot. Returns false (with a console.error) if another PhysicsBatcher holds it.
    load()
    {
        if (this.#isLoaded === true)
            return true;

        if (PhysicsBatcher.#loaded !== null)
        {
            console.error("PhysicsBatcher.load(): another PhysicsBatcher is loaded; unload() it first (one per session)");
                return false;
        }

        PhysicsBatcher.#loaded = this;
        this.#isLoaded = true;
            return true;
    }

    isLoaded() { return this.#isLoaded; }

    // Drops every body (each PhysicsEntity is left without one) and frees the slot. Not during update().
    unload()
    {
        if (this.#passes > 0)
        {
            console.error("PhysicsBatcher.unload() can't be called during update()");
                return false;
        }

        for (const body of this.#bodies)
            this.#detach(body);

        for (const [, body] of this.#pending)
            this.#detach(body);

        this.#bodies.length = 0;
        this.#pending.length = 0;
        this.#accumulator = 0.0;
        this.#alpha = 0.0;
        this.#lastSteps = 0;

        this.#debugLine?.unload();
        this.#debugLine = null;

        if (PhysicsBatcher.#loaded === this)
            PhysicsBatcher.#loaded = null;

        this.#isLoaded = false;
            return true;
    }

    // *** Settings ***

    getUnitsPerMeter() { return this.#tolerances.unitsPerMeter; }

    // Box2D's tolerances in design units (read-only)
    getTolerances() { return this.#tolerances; }

    // Seconds per fixed step, above 0 (1/60 by default)
    setStep(seconds)
    {
        if (Number.isFinite(seconds) === false || seconds <= 0.0)
        {
            console.error("PhysicsBatcher.setStep() needs seconds above 0");
                return false;
        }

        this.#step = seconds;
            return true;
    }

    getStep() { return this.#step; }

    // The most steps one update() runs, 1 or more (4 by default)
    setMaxSteps(count)
    {
        if (Number.isInteger(count) === false || count < 1)
        {
            console.error("PhysicsBatcher.setMaxSteps() needs a whole number, 1 or more");
                return false;
        }

        this.#maxSteps = count;
            return true;
    }

    getMaxSteps() { return this.#maxSteps; }

    // The solver's iterations per step, each 1 or more (8 and 3 by default; used from Phase 3)
    setIterations(velocity, position)
    {
        if (Number.isInteger(velocity) === false || velocity < 1 || Number.isInteger(position) === false || position < 1)
        {
            console.error("PhysicsBatcher.setIterations() needs whole numbers, 1 or more");
                return false;
        }

        this.#velocityIterations = velocity;
        this.#positionIterations = position;
            return true;
    }

    getVelocityIterations() { return this.#velocityIterations; }
    getPositionIterations() { return this.#positionIterations; }

    // Design units per second squared; (0, -10 m/s^2) by default
    setGravity(x, y)
    {
        if (Number.isFinite(x) === false || Number.isFinite(y) === false)
        {
            console.error("PhysicsBatcher.setGravity() needs finite numbers");
                return false;
        }

        this.#gravity.setXY(x, y);
            return true;
    }

    // Read-only; change it with setGravity()
    getGravity() { return this.#gravity; }

    // *** State ***

    // How far (0 - 1) Entities are placed between their bodies' poses before and after the last step
    getAlpha() { return this.#alpha; }

    // Steps the last update() ran
    getLastStepCount() { return this.#lastSteps; }

    // Bodies being simulated (not counting ones waiting to be added, or being removed)
    getBodyCount()
    {
        let n = 0;

        for (const body of this.#bodies)
        {
            if (body.isAdded === true)
                ++n;
        }

        return n;
    }

    // True during update()
    isUpdating() { return (this.#passes > 0); }

    // *** Updating ***

    /*
        Moves the simulation dt seconds on (0 or more): reads what the app moved,
        runs the fixed steps, then writes each moving body's blended pose to its
        Entity. Returns false (doing nothing) if it isn't loaded or dt isn't valid.
    */
    update(dt)
    {
        if (this.#isLoaded === false)
        {
            console.error("PhysicsBatcher.update() needs load() first");
                return false;
        }

        if (Number.isFinite(dt) === false || dt < 0.0)
        {
            console.error("PhysicsBatcher.update() needs dt of 0 seconds or more");
                return false;
        }

        ++this.#passes;

        try
        {
            this.#run(dt);
        }
        finally
        {
            --this.#passes;

            if (this.#passes === 0)
                this.#applyPending();
        }

        return true;
    }

    // *** Debug Drawing ***

    // Debug line width, design units (2 by default)
    setDebugLineWidth(width)
    {
        if (Number.isFinite(width) === false || width <= 0.0)
        {
            console.error("PhysicsBatcher.setDebugLineWidth() needs a width above 0");
                return false;
        }

        this.#debugLineWidth = width;
            return true;
    }

    /*
        Queues every body's shapes as lines on batcher's layer, where their Entities
        are drawn: static green, kinematic blue, dynamic orange, asleep grey. A
        circle shows a line from its center, to see it turn. Returns how many lines,
        or -1 (with a console.error) if batcher isn't a Batcher or the line model
        can't be built (it needs WGLV.init()).
    */
    submitDebug(batcher, layer = 0)
    {
        if ((batcher instanceof Batcher) === false)
        {
            console.error("PhysicsBatcher.submitDebug() needs a Batcher");
                return -1;
        }

        if (this.#debugLine === null && this.#buildDebugLine() === false)
            return -1;

        let count = 0;

        for (const body of this.#bodies)
        {
            if (body.isAdded === false)
                continue;

            const color = (body.isStatic() === true) ? PhysicsBatcher.kStaticColor :
                          (body.awake === false) ? PhysicsBatcher.kSleepingColor :
                          (body.isKinematic() === true) ? PhysicsBatcher.kKinematicColor : PhysicsBatcher.kDynamicColor;
            const t = body.entity.getWorldTransform();
            const x = t.getX(), y = t.getY();
            const s = Math.sin(t.getRotation()), c = Math.cos(t.getRotation());
            const toX = (px, py) => x + (c * px) - (s * py);
            const toY = (px, py) => y + (s * px) + (c * py);

            for (const shape of body.shapes)
            {
                if (shape instanceof PhysicsPolygon)
                {
                    const v = shape.vertices;

                    for (let i = 0; i < shape.count; ++i)
                    {
                        const a = v[i], b = v[(i + 1) % shape.count];
                        this.#submitLine(batcher, toX(a.x, a.y), toY(a.x, a.y), toX(b.x, b.y), toY(b.x, b.y), layer, color);
                    }

                    count += shape.count;
                }
                else if (shape instanceof PhysicsCircle)
                {
                    const n = PhysicsDefines.kCircleDebugSegments;
                    const cx = shape.center.x, cy = shape.center.y, r = shape.radius;

                    for (let i = 0; i < n; ++i)
                    {
                        const a0 = (i / n) * MathDefines.kTwoPi;
                        const a1 = ((i + 1) / n) * MathDefines.kTwoPi;
                        const ax = cx + (r * Math.cos(a0)), ay = cy + (r * Math.sin(a0));
                        const bx = cx + (r * Math.cos(a1)), by = cy + (r * Math.sin(a1));
                        this.#submitLine(batcher, toX(ax, ay), toY(ax, ay), toX(bx, by), toY(bx, by), layer, color);
                    }

                    this.#submitLine(batcher, toX(cx, cy), toY(cx, cy), toX(cx + r, cy), toY(cx + r, cy), layer, color);
                    count += n + 1;
                }
            }
        }

        return count;
    }

    // *** Internal (js/physics) ***

    // PhysicsEntity.addBody(): into the list now, or once the update ends
    _addBody(body)
    {
        if (this.#passes > 0)
        {
            this.#pending.push([true, body]);
                return;
        }

        this.#bodies.push(body);
        body.isAdded = true;
    }

    // PhysicsEntity.removeBody(): left out at once, out of the list now or once the update ends
    _removeBody(body)
    {
        body.isAdded = false;

        if (this.#passes > 0)
        {
            this.#pending.push([false, body]);
                return;
        }

        const i = this.#bodies.indexOf(body);

        if (i !== -1)
            this.#bodies.splice(i, 1);

        const j = this.#pending.findIndex(([, b]) => b === body);

        if (j !== -1)
            this.#pending.splice(j, 1);
    }

    // *** Internal Methods ***

    #run(dt)
    {
        const bodies = this.#bodies;

        // What the app moved: parents moving kinematic and static children, scale changes
        for (const body of bodies)
        {
            if (body.isAdded === true)
                body.entity._readMoves();
        }

        // How many steps this frame
        const h = this.#step;
        let n = 0;

        this.#accumulator += dt;

        while (n < this.#maxSteps && this.#accumulator >= h * (1.0 - PhysicsBatcher.#kStepEpsilon))
        {
            this.#accumulator -= h;
            ++n;
        }

        if (this.#accumulator >= h)
            this.#accumulator -= Math.floor(this.#accumulator / h) * h; // Past the cap: dropped

        if (this.#accumulator < 0.0)
            this.#accumulator = 0.0;

        this.#lastSteps = n;

        // Forces: this frame's force x dt (plus any held from frames with no steps) spread over the steps
        for (const body of bodies)
        {
            if (body.isAdded === false || body.isDynamic() === false)
                continue;

            body.heldForce.x += body.force.x * dt;
            body.heldForce.y += body.force.y * dt;
            body.heldTorque += body.torque * dt;
            body.force.setXY(0.0, 0.0);
            body.torque = 0.0;

            if (n > 0)
            {
                const per = 1.0 / (n * h);
                body.stepForce.setXY(body.heldForce.x * per, body.heldForce.y * per);
                body.stepTorque = body.heldTorque * per;
                body.heldForce.setXY(0.0, 0.0);
                body.heldTorque = 0.0;
            }
        }

        // Kinematic bodies moved by their Entities: the velocity that gets there over the steps
        if (n > 0)
        {
            const per = 1.0 / (n * h);

            for (const body of bodies)
            {
                if (body.isAdded === true && body.hasTarget === true)
                {
                    body.v.setXY((body.targetX - body.c.x) * per, (body.targetY - body.c.y) * per);
                    const turn = body.targetA - body.a;
                    body.w = Math.atan2(Math.sin(turn), Math.cos(turn)) * per; // The shorter way round
                    body.awake = true;
                }
            }
        }

        for (let i = 0; i < n; ++i)
            this.#stepOnce(h);

        if (n > 0)
        {
            for (const body of bodies)
            {
                if (body.isAdded === false)
                    continue;

                body.stepForce.setXY(0.0, 0.0);
                body.stepTorque = 0.0;

                if (body.hasTarget === true)
                {
                    // There: exactly where the Entity put it, at its own velocity again
                    body.setPose(body.targetX, body.targetY, body.targetA);
                    body.v.setXY(body.ownVX, body.ownVY);
                    body.w = body.ownW;
                    body.hasTarget = false;
                }
            }
        }

        this.#alpha = this.#accumulator / h;

        // Each moving body's blended pose to its Entity
        for (const body of bodies)
        {
            if (body.isAdded === true && body.isStatic() === false && body.hasTarget === false)
                body.entity._writeBlendedPose(this.#alpha);
        }
    }

    // One step of h seconds: Box2D's island integration, for every awake body, with no contacts yet
    #stepOnce(h)
    {
        const gx = this.#gravity.x;
        const gy = this.#gravity.y;
        const tol = this.#tolerances;

        for (const b of this.#bodies)
        {
            if (b.isAdded === false || b.type === PhysicsBodyType.kStatic)
                continue;

            b.prevX = b.p.x;
            b.prevY = b.p.y;
            b.prevA = b.a;

            if (b.awake === false)
                continue;

            b.c0.set(b.c);
            b.a0 = b.a;

            let vx = b.v.x;
            let vy = b.v.y;
            let w = b.w;

            if (b.type === PhysicsBodyType.kDynamic)
            {
                const hg = h * b.gravityScale;
                vx += hg * gx;
                vy += hg * gy;

                const hm = h * b.invMass;
                vx += hm * b.stepForce.x;
                vy += hm * b.stepForce.y;
                w += h * b.invI * b.stepTorque;

                const ld = 1.0 / (1.0 + (h * b.linearDamping));
                vx = ld * vx;
                vy = ld * vy;
                w *= 1.0 / (1.0 + (h * b.angularDamping));
            }

            // Box2D's limits on one step's movement
            const tx = h * vx;
            const ty = h * vy;
            const t2 = (tx * tx) + (ty * ty);

            if (t2 > tol.maxTranslationSquared)
            {
                const ratio = tol.maxTranslation / Math.sqrt(t2);
                vx *= ratio;
                vy *= ratio;
            }

            const r = h * w;

            if (r * r > tol.maxRotationSquared)
                w *= tol.maxRotation / Math.abs(r);

            b.c.x += h * vx;
            b.c.y += h * vy;
            b.a += h * w;
            b.v.setXY(vx, vy);
            b.w = w;
            b.synchronizeTransform();
        }
    }

    #applyPending()
    {
        const pending = this.#pending;

        if (pending.length === 0)
            return;

        this.#pending = [];

        for (const [isAdd, body] of pending)
        {
            if (isAdd === true)
            {
                if (body.batcher === this && body.entity._hasBody(body) === true && this.#bodies.includes(body) === false)
                {
                    this.#bodies.push(body);
                    body.isAdded = true;
                }
            }
            else
            {
                const i = this.#bodies.indexOf(body);

                if (i !== -1)
                    this.#bodies.splice(i, 1);
            }
        }
    }

    #detach(body)
    {
        body.isAdded = false;
        body.batcher = null;
        body.entity._onBatcherUnloaded(body);
    }

    #buildDebugLine()
    {
        let line = new Rect2D();

        if (line.load(TextureManager.getWhiteTexture(), 1, 1) === false)
        {
            console.error("PhysicsBatcher.submitDebug() couldn't build its line model (after WGLV.init())");
                return false;
        }

        line.setAlignment(Alignment.kMiddleCenter);
        this.#debugLine = line;

        if (PhysicsBatcher.#kDebugAt === null)
            PhysicsBatcher.#kDebugAt = new Transform2D();

        return true;
    }

    // The line model stretched from (x1, y1) to (x2, y2)
    #submitLine(batcher, x1, y1, x2, y2, layer, color)
    {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const length = Math.sqrt((dx * dx) + (dy * dy));
        const w = this.#debugLineWidth;

        PhysicsBatcher.#kDebugAt.set((x1 + x2) * 0.5, (y1 + y2) * 0.5, length + w, w, Math.atan2(dy, dx));
        batcher.submit(this.#debugLine, PhysicsBatcher.#kDebugAt, layer, null, color);
    }
}
