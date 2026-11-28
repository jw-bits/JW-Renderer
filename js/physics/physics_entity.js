"use strict";

/*
    PhysicsEntity - An Entity with a body: the only thing that takes part in
    physics (docs/physics_plan.md). A plain Entity has no physics cost at all.

        let crate = new PhysicsEntity("crate");
        crate.setModel(crateRect);                    // Drawn like any Entity
        crate.setPosition(400, 600);
        crate.addBody(physics, PhysicsBodyType.kDynamic);
        crate.addBox(100, 100, { density: 1, friction: 0.5 });
        scene.add(crate);                             // A root (dynamic bodies always are)

        crate.applyLinearImpulse(0, 5000, crate.getPosition().x, crate.getPosition().y);

    Body types (PhysicsBodyType):
        kDynamic     The simulation places it: its Entity is written each update()
                     (blended, see PhysicsBatcher). setPosition(), setRotation() and
                     setTransform() teleport it (keeping its velocity) and wake it.
                     Always a root: setParent() / addChild() refuse to give it a parent.
        kKinematic   Moves at its own velocity (setLinearVelocity()), or where its Entity
                     is put: moving it (setPosition(), a MotionController, or its parent)
                     gives it the velocity that gets it there over the next update's
                     steps, and then its own velocity again. With a parent it's placed
                     only that way, and setLinearVelocity() is refused.
        kStatic      Never moves by itself, and has no mass. Moving its Entity (or its
                     parent) re-places it.

    Moves vs. writes: the PhysicsBatcher writes each moving body's pose through
    _writeBlendedPose(), with #writing set, so _onTransformChanged() knows that
    isn't the app moving it. Anything else that changes the transform is.

    Shapes are given in the Entity's own space at scale 1, and its world scale
    is built in (see physics_shapes.js). Changing the scale later builds them
    again and works the mass out again (and wakes the body): fine now and
    then, costly every frame. Shear isn't used.

    Children: plain Entities under it (a sprite, a Spine skeleton, a label) ride
    on the body. A PhysicsEntity under it is its own body (kinematic or
    static: a dynamic one can't have a parent).

    Points, velocities and forces are in world design units: (x, y) numbers,
    as Entity.setPosition() takes. Moves take effect for the body at once;
    getBodyPosition() / getBodyAngle() are where the simulation has it, which
    the Entity's own transform trails by up to a step (blending).
*/
class PhysicsEntity extends Entity
{
    #body;      // PhysicsBody, or null
    #writing;   // True while the batcher writes the pose (see the top of this file)
    #scratch;   // Transform2D for writes

    constructor(_name = "")
    {
        super(_name);
        this.#body = null;
        this.#writing = false;
        this.#scratch = new Transform2D();
    }

    // *** Body ***

    /*
        Gives it a body of type (PhysicsBodyType) in physics (a loaded
        PhysicsBatcher), at its world position and rotation. options: {
        linearDamping, angularDamping (0 or more), gravityScale, fixedRotation,
        awake }, each optional. Returns false (changing nothing) if it already has
        one, physics isn't loaded, type isn't valid, it's dynamic and has a parent,
        or an option isn't valid. Add shapes after.
    */
    addBody(physics, type, options = null)
    {
        if (this.#body !== null)
        {
            console.error(`PhysicsEntity.addBody(): "${this.getName()}" already has a body; removeBody() first`);
                return false;
        }

        if ((physics instanceof PhysicsBatcher) === false || physics.isLoaded() === false)
        {
            console.error("PhysicsEntity.addBody() needs a loaded PhysicsBatcher");
                return false;
        }

        if (type !== PhysicsBodyType.kStatic && type !== PhysicsBodyType.kKinematic && type !== PhysicsBodyType.kDynamic)
        {
            console.error("PhysicsEntity.addBody() needs a PhysicsBodyType");
                return false;
        }

        if (type === PhysicsBodyType.kDynamic && this.getParent() !== null)
        {
            console.error(`PhysicsEntity.addBody(): "${this.getName()}" has a parent; a dynamic body must be a root`);
                return false;
        }

        if (PhysicsEntity.#checkBodyOptions(options) === false)
            return false;

        const t = this.getWorldTransform();
        const body = new PhysicsBody(this, physics, type, t.getX(), t.getY(), t.getRotation());
        const o = options ?? {};

        body.linearDamping = o.linearDamping ?? 0.0;
        body.angularDamping = o.angularDamping ?? 0.0;
        body.gravityScale = o.gravityScale ?? 1.0;
        body.fixedRotation = o.fixedRotation ?? false;
        body.builtScaleX = t.getScaleX();
        body.builtScaleY = t.getScaleY();
        body.seenWorldVersion = this.getWorldVersion();
        body.resetMassData();

        if (o.awake === false)
            body.setAwake(false);

        this.#body = body;
        physics._addBody(body);
            return true;
    }

    // Takes the body away (its shapes with it). Returns false if it has none.
    removeBody()
    {
        if (this.#body === null)
        {
            console.error(`PhysicsEntity.removeBody(): "${this.getName()}" has no body`);
                return false;
        }

        const body = this.#body;
        this.#body = null;

        for (const shape of body.shapes)
            shape.body = null;

        body.batcher?._removeBody(body);
            return true;
    }

    hasBody() { return (this.#body !== null); }

    // PhysicsBodyType, or -1 without a body
    getBodyType() { return (this.#body === null) ? -1 : this.#body.type; }

    // The PhysicsBatcher, or null without a body
    getPhysics() { return (this.#body === null) ? null : this.#body.batcher; }

    // *** Shapes ***

    /*
        A width x height box (above 0), centered on (x, y) in this Entity's space
        and turned by angle (radians): options { x, y, angle } plus the shape's
        (see PhysicsShape.setOptions()). Returns the PhysicsPolygon, or null (with a
        console.error) if it has no body or anything isn't valid.
    */
    addBox(width, height, options = null)
    {
        if (this.#canAddShape("addBox", options) === false)
            return null;

        if (Number.isFinite(width) === false || Number.isFinite(height) === false || width <= 0.0 || height <= 0.0)
        {
            console.error("PhysicsEntity.addBox() needs a width and height above 0");
                return null;
        }

        const o = options ?? {};

        if (PhysicsEntity.#isPlace(o) === false)
        {
            console.error("PhysicsEntity.addBox(): x, y and angle must be finite numbers");
                return null;
        }

        const points = PhysicsPolygon.boxPoints(width, height, o.x ?? 0.0, o.y ?? 0.0, o.angle ?? 0.0);
        return this.#addPolygonPoints(points, o, "PhysicsEntity.addBox()");
    }

    // A circle of radius (above 0) centered on (x, y) in this Entity's space: options { x, y } plus the shape's. Returns the PhysicsCircle, or null.
    addCircle(radius, options = null)
    {
        if (this.#canAddShape("addCircle", options) === false)
            return null;

        const o = options ?? {};
        const x = o.x ?? 0.0;
        const y = o.y ?? 0.0;

        if (PhysicsCircle.isValid(x, y, radius, "PhysicsEntity.addCircle()") === false)
            return null;

        const shape = new PhysicsCircle(x, y, radius);
        return this.#attach(shape, o, "PhysicsEntity.addCircle()");
    }

    // A convex polygon of 3 - 12 points (Vector2s or { x, y }, either winding) in this Entity's space; options are the shape's. Returns the PhysicsPolygon, or null.
    addPolygon(points, options = null)
    {
        if (this.#canAddShape("addPolygon", options) === false)
            return null;

        return this.#addPolygonPoints(points, options ?? {}, "PhysicsEntity.addPolygon()");
    }

    // Takes shape off the body (the mass follows). Returns false if it isn't one of this body's.
    removeShape(shape)
    {
        const body = this.#body;
        const i = (body === null) ? -1 : body.shapes.indexOf(shape);

        if (i === -1)
        {
            console.error("PhysicsEntity.removeShape() needs one of this body's shapes");
                return false;
        }

        body.shapes.splice(i, 1);
        shape.body = null;
        body.resetMassData();
            return true;
    }

    // Read-only; change it with addBox() ... and removeShape()
    getShapes() { return (this.#body === null) ? PhysicsEntity.#kNoShapes : this.#body.shapes; }

    // *** Mass ***

    // 0 for static and kinematic bodies (and without a body)
    getMass() { return (this.#body === null) ? 0.0 : this.#body.mass; }

    // Rotational inertia about the body's origin (its Entity's position), as Box2D's getInertia()
    getInertia()
    {
        const b = this.#body;

        if (b === null)
            return 0.0;

        return b.I + (b.mass * b.localCenter.lengthSquared());
    }

    // The center of mass in the body's space (scale built in, unrotated), written into out and returned
    getLocalCenter(out = new Vector2())
    {
        if (this.#body === null)
            out.setXY(0.0, 0.0);
        else
            out.set(this.#body.localCenter);

        return out;
    }

    // The center of mass in the world, as the simulation has it, written into out and returned
    getWorldCenter(out = new Vector2())
    {
        if (this.#body === null)
            out.set(this.getWorldTransform().getPosition());
        else
            out.set(this.#body.c);

        return out;
    }

    // *** Pose and Motion ***

    // Where the simulation has the body's origin (the Entity trails it by up to a step), written into out and returned
    getBodyPosition(out = new Vector2())
    {
        if (this.#body === null)
            out.set(this.getWorldTransform().getPosition());
        else
            out.set(this.#body.p);

        return out;
    }

    // The simulation's angle (radians)
    getBodyAngle() { return (this.#body === null) ? this.getWorldTransform().getRotation() : this.#body.a; }

    // The velocity of the center of mass, units per second. Static bodies and kinematic ones with a parent refuse (returns false).
    setLinearVelocity(x, y)
    {
        if (this.#canSetVelocity("setLinearVelocity", x, y) === false)
            return false;

        const b = this.#body;

        if ((x * x) + (y * y) > 0.0)
            b.setAwake(true);

        b.v.setXY(x, y);
        b.ownVX = x;
        b.ownVY = y;
            return true;
    }

    // Read-only; change it with setLinearVelocity()
    getLinearVelocity() { return (this.#body === null) ? Vector2.kZero : this.#body.v; }

    // Radians per second, counter-clockwise
    setAngularVelocity(w)
    {
        if (this.#canSetVelocity("setAngularVelocity", w, 0.0) === false)
            return false;

        const b = this.#body;

        if (w * w > 0.0)
            b.setAwake(true);

        b.w = w;
        b.ownW = w;
            return true;
    }

    getAngularVelocity() { return (this.#body === null) ? 0.0 : this.#body.w; }

    // A force at world point (px, py), for this frame (see PhysicsBatcher). Dynamic bodies only; wake: wakes it first (a sleeping body ignores it otherwise).
    applyForce(fx, fy, px, py, wake = true)
    {
        if (this.#canPush("applyForce", [fx, fy, px, py], wake) === false)
            return false;

        const b = this.#body;
        b.force.x += fx;
        b.force.y += fy;
        b.torque += ((px - b.c.x) * fy) - ((py - b.c.y) * fx);
            return true;
    }

    // A force at the center of mass (no turning), for this frame
    applyForceToCenter(fx, fy, wake = true)
    {
        if (this.#canPush("applyForceToCenter", [fx, fy], wake) === false)
            return false;

        this.#body.force.x += fx;
        this.#body.force.y += fy;
            return true;
    }

    // A torque, for this frame
    applyTorque(torque, wake = true)
    {
        if (this.#canPush("applyTorque", [torque], wake) === false)
            return false;

        this.#body.torque += torque;
            return true;
    }

    // An impulse at world point (px, py): changes the velocity at once
    applyLinearImpulse(ix, iy, px, py, wake = true)
    {
        if (this.#canPush("applyLinearImpulse", [ix, iy, px, py], wake) === false)
            return false;

        const b = this.#body;
        b.v.x += b.invMass * ix;
        b.v.y += b.invMass * iy;
        b.w += b.invI * (((px - b.c.x) * iy) - ((py - b.c.y) * ix));
            return true;
    }

    // An angular impulse: changes the spin at once
    applyAngularImpulse(impulse, wake = true)
    {
        if (this.#canPush("applyAngularImpulse", [impulse], wake) === false)
            return false;

        this.#body.w += this.#body.invI * impulse;
            return true;
    }

    // Damping slows it down: 0 or more, per second (0 by default)
    setLinearDamping(damping) { return this.#setBodyNumber("setLinearDamping", "linearDamping", damping, 0.0); }
    setAngularDamping(damping) { return this.#setBodyNumber("setAngularDamping", "angularDamping", damping, 0.0); }
    getLinearDamping() { return (this.#body === null) ? 0.0 : this.#body.linearDamping; }
    getAngularDamping() { return (this.#body === null) ? 0.0 : this.#body.angularDamping; }

    // How much of the batcher's gravity it feels (1 by default; 0 floats; negative falls up)
    setGravityScale(scale) { return this.#setBodyNumber("setGravityScale", "gravityScale", scale, -Infinity); }
    getGravityScale() { return (this.#body === null) ? 1.0 : this.#body.gravityScale; }

    // True stops it turning (the mass is worked out again)
    setFixedRotation(isFixed)
    {
        if (this.#needBody("setFixedRotation") === false)
            return false;

        const b = this.#body;
        b.fixedRotation = (isFixed === true);

        if (b.fixedRotation === true)
            b.w = 0.0;

        b.resetMassData();
            return true;
    }

    isFixedRotation() { return (this.#body !== null && this.#body.fixedRotation === true); }

    // Asleep, a body doesn't move or take forces until woken (from Phase 3 bodies also fall asleep by themselves). Putting it to sleep stops it.
    setAwake(awake)
    {
        if (this.#needBody("setAwake") === false)
            return false;

        this.#body.setAwake(awake === true);
            return true;
    }

    isAwake() { return (this.#body !== null && this.#body.awake === true); }

    // *** Entity Overrides ***

    // A dynamic body can't have a parent (it's always a root)
    setParent(parent, keepWorld = false)
    {
        if (parent !== null && this.#body !== null && this.#body.type === PhysicsBodyType.kDynamic)
        {
            console.error(`PhysicsEntity: "${this.getName()}" has a dynamic body, which can't have a parent`);
                return false;
        }

        return super.setParent(parent, keepWorld);
    }

    // The app moved it (the batcher's own writes are skipped): see the top of this file
    _onTransformChanged()
    {
        if (this.#writing === true || this.#body === null)
            return;

        this.#applyMove();
    }

    // *** Internal (js/physics) ***

    // PhysicsBatcher: whether body is this entity's (a pending add may have been dropped)
    _hasBody(body) { return (this.#body === body); }

    // PhysicsBatcher, at the start of update(): moves that didn't call _onTransformChanged(), e.g. a parent's
    _readMoves()
    {
        if (this.#body !== null && this.getWorldVersion() !== this.#body.seenWorldVersion)
            this.#applyMove();
    }

    // PhysicsBatcher, at the end of update(): the pose alpha (0 - 1) of the way from before the last step to after it
    _writeBlendedPose(alpha)
    {
        const b = this.#body;

        if (b === null || this.getParent() !== null)
            return; // A kinematic child is placed only by its parent and transform

        const x = b.prevX + ((b.p.x - b.prevX) * alpha);
        const y = b.prevY + ((b.p.y - b.prevY) * alpha);
        const a = b.prevA + ((b.a - b.prevA) * alpha);
        const t = this.getTransform();

        if (t.getX() === x && t.getY() === y && t.getRotation() === a)
            return;

        this._writePose(x, y, a);
    }

    // Writes the pose (x, y, rotation) as the local transform, keeping the scale, without it counting as a move. Subclasses may override (call super).
    _writePose(x, y, rotation)
    {
        this.#scratch.copy(this.getTransform());
        this.#scratch.setPosition(x, y);
        this.#scratch.setRotation(rotation);

        this.#writing = true;

        try
        {
            this.setTransform(this.#scratch);   // One change: children and world transforms follow
        }
        finally
        {
            this.#writing = false;
        }

        if (this.#body !== null)
            this.#body.seenWorldVersion = this.getWorldVersion();
    }

    // PhysicsBatcher.unload(): body is gone
    _onBatcherUnloaded(body)
    {
        if (this.#body !== body)
            return;

        for (const shape of body.shapes)
            shape.body = null;

        this.#body = null;
    }

    // *** Internal Methods ***

    static #kNoShapes = Object.freeze([]);

    // The app moved the Entity (or its parent): the body follows, by its type
    #applyMove()
    {
        const b = this.#body;
        const t = this.getWorldTransform();

        b.seenWorldVersion = this.getWorldVersion();

        if (t.getScaleX() !== b.builtScaleX || t.getScaleY() !== b.builtScaleY)
        {
            b.rebuildShapes(t.getScaleX(), t.getScaleY());
            b.setAwake(true);
        }

        if (b.type === PhysicsBodyType.kKinematic)
        {
            // Where it's to be by the end of the next update's steps (its center of mass, as the steps move that)
            const s = Math.sin(t.getRotation());
            const c = Math.cos(t.getRotation());
            const lc = b.localCenter;

            if (b.hasTarget === false)
            {
                b.ownVX = b.v.x;
                b.ownVY = b.v.y;
                b.ownW = b.w;
            }

            b.hasTarget = true;
            b.targetX = (c * lc.x) - (s * lc.y) + t.getX();
            b.targetY = (s * lc.x) + (c * lc.y) + t.getY();
            b.targetA = t.getRotation();
                return;
        }

        // Dynamic: a teleport (keeping its velocity); static: re-placed
        b.setPose(t.getX(), t.getY(), t.getRotation());

        if (b.type === PhysicsBodyType.kDynamic)
            b.setAwake(true);
    }

    #addPolygonPoints(points, options, where)
    {
        const hull = PhysicsPolygon.makeHull(points, this.#body.batcher.getTolerances(), where);

        if (hull === null)
            return null;

        return this.#attach(new PhysicsPolygon(hull), options, where);
    }

    // Applies the options, builds it at the world scale and puts it on the body
    #attach(shape, options, where)
    {
        const shapeOptions = {};

        for (const key of ["density", "friction", "restitution", "sensor", "category", "mask", "group"])
        {
            if (options[key] !== undefined)
                shapeOptions[key] = options[key];
        }

        if (shape.setOptions(shapeOptions) === false)
            return null;

        const b = this.#body;

        if (shape.rebuild(b.builtScaleX, b.builtScaleY, b.batcher.getTolerances()) === false)
        {
            console.error(`${where}: the Entity's scale leaves the shape too small`);
                return null;
        }

        shape.body = b;
        b.shapes.push(shape);
        b.resetMassData();
            return shape;
    }

    #canAddShape(name, options)
    {
        if (this.#body === null || this.#body.batcher === null)
        {
            console.error(`PhysicsEntity.${name}() needs addBody() first`);
                return false;
        }

        return PhysicsShape._checkOptions(options, `PhysicsEntity.${name}()`);
    }

    #needBody(name)
    {
        if (this.#body === null)
        {
            console.error(`PhysicsEntity.${name}() needs addBody() first`);
                return false;
        }

        return true;
    }

    #canSetVelocity(name, x, y)
    {
        if (this.#needBody(name) === false)
            return false;

        if (Number.isFinite(x) === false || Number.isFinite(y) === false)
        {
            console.error(`PhysicsEntity.${name}() needs finite numbers`);
                return false;
        }

        if (this.#body.type === PhysicsBodyType.kStatic)
        {
            console.error(`PhysicsEntity.${name}(): a static body doesn't move`);
                return false;
        }

        if (this.#body.type === PhysicsBodyType.kKinematic && this.getParent() !== null)
        {
            console.error(`PhysicsEntity.${name}(): a kinematic body with a parent is moved only by its parent and transform`);
                return false;
        }

        return true;
    }

    // Forces and impulses: dynamic bodies only, finite numbers; wakes it if asked. False if it can't (or is asleep and not woken).
    #canPush(name, numbers, wake)
    {
        if (this.#needBody(name) === false)
            return false;

        for (const n of numbers)
        {
            if (Number.isFinite(n) === false)
            {
                console.error(`PhysicsEntity.${name}() needs finite numbers`);
                    return false;
            }
        }

        const b = this.#body;

        if (b.type !== PhysicsBodyType.kDynamic)
            return false; // As Box2D: only dynamic bodies are pushed

        if (wake === true)
            b.setAwake(true);

        return (b.awake === true);
    }

    #setBodyNumber(name, field, value, min)
    {
        if (this.#needBody(name) === false)
            return false;

        if (Number.isFinite(value) === false || value < min)
        {
            console.error(`PhysicsEntity.${name}() needs a finite number${(min === 0.0) ? ", 0 or more" : ""}`);
                return false;
        }

        this.#body[field] = value;
            return true;
    }

    static #isPlace(o)
    {
        for (const key of ["x", "y", "angle"])
        {
            if (o[key] !== undefined && Number.isFinite(o[key]) === false)
                return false;
        }

        return true;
    }

    static #checkBodyOptions(options)
    {
        if (options === null)
            return true;

        if (typeof options !== "object")
        {
            console.error("PhysicsEntity.addBody(): options must be an object or left out");
                return false;
        }

        const o = options;
        const isNumber = (v, min) => (v === undefined || (Number.isFinite(v) === true && v >= min));

        if (isNumber(o.linearDamping, 0.0) === false || isNumber(o.angularDamping, 0.0) === false || isNumber(o.gravityScale, -Infinity) === false)
        {
            console.error("PhysicsEntity.addBody(): linearDamping and angularDamping must be 0 or more, gravityScale a finite number");
                return false;
        }

        if ((o.fixedRotation !== undefined && typeof o.fixedRotation !== "boolean") || (o.awake !== undefined && typeof o.awake !== "boolean"))
        {
            console.error("PhysicsEntity.addBody(): fixedRotation and awake must be true or false");
                return false;
        }

        return true;
    }
}
