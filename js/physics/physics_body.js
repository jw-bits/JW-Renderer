"use strict";

/*
    PhysicsBody - A PhysicsEntity's body: its type, mass, motion and shapes,
    as the PhysicsBatcher steps them. Internal to js/physics: the app works
    through PhysicsEntity, and its fields are plain (as a port's runtime data
    is, like SpineBone's) so the batcher's loops can read and write them.

    Ported from Planck.js 1.5.1 (MIT, Copyright (c) Erin Catto, Ali Shakiba),
    itself a port of Box2D: Body's mass and Sweep.

    Pose: (p, a) is the body's origin (its Entity's position) and angle. The
    simulation moves its center of mass c, which is p plus localCenter turned
    by a; synchronizeTransform() works p out from c and a again. c0 / a0 are
    where the last step started, and prevX / prevY / prevA the pose before the
    last step, which the batcher blends from (see PhysicsBatcher).
*/
class PhysicsBody
{
    constructor(entity, batcher, type, x, y, angle)
    {
        this.entity = entity;          // The PhysicsEntity
        this.batcher = batcher;        // The PhysicsBatcher, or null once it's unloaded
        this.type = type;              // PhysicsBodyType
        this.shapes = [];              // PhysicsShapes, in the order added

        // Mass (resetMassData())
        this.mass = 0.0;
        this.invMass = 0.0;
        this.I = 0.0;                  // Rotational inertia about the center of mass
        this.invI = 0.0;
        this.localCenter = new Vector2();

        // Pose and motion
        this.p = new Vector2(x, y);    // Origin
        this.qs = 0.0;                 // sin(a), cos(a)
        this.qc = 1.0;
        this.c = new Vector2();        // Center of mass
        this.a = 0.0;
        this.c0 = new Vector2();
        this.a0 = 0.0;
        this.v = new Vector2();        // Linear velocity, of the center of mass (units / s)
        this.w = 0.0;                  // Angular velocity (radians / s)

        // Forces: summed until the batcher's next update(), which turns them into this frame's (see PhysicsBatcher)
        this.force = new Vector2();
        this.torque = 0.0;
        this.stepForce = new Vector2();   // The force (and torque) each of this update's steps applies
        this.stepTorque = 0.0;
        this.heldForce = new Vector2();   // Force x seconds (and torque x seconds) from updates that ran no steps
        this.heldTorque = 0.0;

        this.linearDamping = 0.0;
        this.angularDamping = 0.0;
        this.gravityScale = 1.0;
        this.fixedRotation = false;
        this.awake = true;

        // The batcher's
        this.prevX = x;                // The pose before the last step
        this.prevY = y;
        this.prevA = 0.0;
        this.builtScaleX = 1.0;        // The world scale the shapes were built at
        this.builtScaleY = 1.0;
        this.seenWorldVersion = -1;    // The Entity's world version last read or written
        this.hasTarget = false;        // Kinematic: moved by its Entity this frame, to (targetX, targetY, targetA)
        this.targetX = 0.0;
        this.targetY = 0.0;
        this.targetA = 0.0;
        this.ownVX = 0.0;              // Kinematic: its own velocity, given back once a target is reached
        this.ownVY = 0.0;
        this.ownW = 0.0;
        this.isAdded = false;          // In the batcher's list (adding waits during a pass)

        this.setPose(x, y, angle);
    }

    isStatic() { return (this.type === PhysicsBodyType.kStatic); }
    isKinematic() { return (this.type === PhysicsBodyType.kKinematic); }
    isDynamic() { return (this.type === PhysicsBodyType.kDynamic); }

    // Puts the origin at (x, y) and the angle at angle, as Box2D's setTransform() does (the angle comes back in -PI - PI), with no blend from where it was
    setPose(x, y, angle)
    {
        this.qs = Math.sin(angle);
        this.qc = Math.cos(angle);
        this.p.setXY(x, y);

        // Sweep.setTransform(): the center through the transform, the angle from its sine and cosine
        const lc = this.localCenter;
        this.c.setXY((this.qc * lc.x) - (this.qs * lc.y) + x, (this.qs * lc.x) + (this.qc * lc.y) + y);
        this.c0.set(this.c);
        this.a = Math.atan2(this.qs, this.qc);
        this.a0 = this.a;

        this.prevX = x;
        this.prevY = y;
        this.prevA = this.a;
    }

    // The origin from the center of mass and angle (Sweep.getTransform() at the step's end)
    synchronizeTransform()
    {
        this.qs = Math.sin(this.a);
        this.qc = Math.cos(this.a);

        const lc = this.localCenter;
        this.p.setXY(this.c.x - ((this.qc * lc.x) - (this.qs * lc.y)),
                     this.c.y - ((this.qs * lc.x) + (this.qc * lc.y)));
    }

    // Box2D's: wakes it, or puts it to sleep (stopping it and dropping its forces)
    setAwake(awake)
    {
        if (awake === true)
        {
            this.awake = true;
                return;
        }

        this.awake = false;
        this.v.setXY(0.0, 0.0);
        this.w = 0.0;
        this.force.setXY(0.0, 0.0);
        this.torque = 0.0;
        this.heldForce.setXY(0.0, 0.0);
        this.heldTorque = 0.0;
    }

    // Works the mass, center of mass and inertia out from the shapes (Box2D's resetMassData())
    resetMassData()
    {
        this.mass = 0.0;
        this.invMass = 0.0;
        this.I = 0.0;
        this.invI = 0.0;
        this.localCenter.setXY(0.0, 0.0);

        if (this.type !== PhysicsBodyType.kDynamic)
        {
            this.c0.set(this.p);
            this.c.set(this.p);
            this.a0 = this.a;
                return;
        }

        const data = PhysicsBody.#kMassData;
        let lcx = 0.0, lcy = 0.0;

        for (const shape of this.shapes)
        {
            const density = shape.getDensity();

            if (density === 0.0)
                continue;

            shape.computeMass(data, density);
            this.mass += data.mass;
            lcx += data.mass * data.center.x;
            lcy += data.mass * data.center.y;
            this.I += data.I;
        }

        if (this.mass > 0.0)
        {
            this.invMass = 1.0 / this.mass;
            lcx *= this.invMass;
            lcy *= this.invMass;
        }
        else
        {
            // Box2D: a dynamic body always has mass
            this.mass = 1.0;
            this.invMass = 1.0;
        }

        if (this.I > 0.0 && this.fixedRotation === false)
        {
            this.I -= this.mass * ((lcx * lcx) + (lcy * lcy));
            this.invI = 1.0 / this.I;
        }
        else
        {
            this.I = 0.0;
            this.invI = 0.0;
        }

        // Move the center of mass, keeping the origin; the velocity of the new center follows from the spin
        const oldX = this.c.x;
        const oldY = this.c.y;

        this.localCenter.setXY(lcx, lcy);
        this.c.setXY((this.qc * lcx) - (this.qs * lcy) + this.p.x, (this.qs * lcx) + (this.qc * lcy) + this.p.y);
        this.c0.set(this.c);

        const shiftX = this.c.x - oldX;
        const shiftY = this.c.y - oldY;
        this.v.x += -this.w * shiftY;
        this.v.y += this.w * shiftX;
    }

    // The shapes built again at the Entity's world scale (sx, sy); the mass follows. Returns false if any couldn't be (it keeps its last size).
    rebuildShapes(sx, sy)
    {
        let ok = true;

        for (const shape of this.shapes)
        {
            if (shape.rebuild(sx, sy, this.batcher.getTolerances()) === false)
                ok = false;
        }

        this.builtScaleX = sx;
        this.builtScaleY = sy;
        this.resetMassData();
            return ok;
    }

    static #kMassData = { mass: 0.0, center: new Vector2(), I: 0.0 };
}
