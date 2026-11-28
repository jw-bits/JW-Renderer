"use strict";

/*
    Physics defines - Body and shape kinds, the defaults, and Box2D's
    tolerances (docs/physics_plan.md).

    Ported from Planck.js 1.5.1 (MIT, Copyright (c) Erin Catto, Ali Shakiba),
    itself a port of Box2D; tools/Planck holds the reference.

    Units: everything is in design units (+Y up), seconds and radians. Box2D's
    tolerances are tuned for meters, so each PhysicsBatcher works them out
    from its units per meter (PhysicsTolerances, below): 100 by default, so a
    1 m crate is 100 units across. Box2D works best with moving things 0.1 -
    10 m (10 - 1,000 units at 100) and still ones up to about 50 m.

    Density is mass per square design unit: a 100 x 100 box of density 1 has
    a mass of 10,000. Only the ratios between masses change how things move,
    so any consistent scale works; forces and impulses follow it (mass times
    design units per second squared).
*/
class PhysicsBodyType
{
    static kStatic = 0;     // Never moves by itself; has no mass. Moving its Entity re-places it.
    static kKinematic = 1;  // Moves by its velocity, or by its Entity (see PhysicsEntity); has no mass
    static kDynamic = 2;    // Moved by the simulation: gravity, forces, impulses and (from Phase 2) contacts
}

class PhysicsShapeType
{
    static kCircle = 0;
    static kPolygon = 1;
}

class PhysicsDefines
{
    // The PhysicsBatcher's defaults (see its setters)
    static kDefaultUnitsPerMeter = 100.0;
    static kDefaultStep = 1.0 / 60.0;          // Seconds per fixed step
    static kDefaultMaxSteps = 4;               // Most steps in one update(); time past them is dropped
    static kDefaultVelocityIterations = 8;
    static kDefaultPositionIterations = 3;
    static kDefaultGravity = -10.0;            // Meters per second squared, along y (times the units per meter)

    // Shapes' defaults (see PhysicsShape)
    static kDefaultDensity = 1.0;              // Mass per square design unit
    static kDefaultFriction = 0.2;
    static kDefaultRestitution = 0.0;
    static kDefaultCategory = 0x0001;          // Collision filter bits (used from Phase 2)
    static kDefaultMask = 0xFFFF;
    static kDefaultGroup = 0;

    static kMaxPolygonVertices = 12;
    static kCircleDebugSegments = 20;          // Lines per circle in PhysicsBatcher.submitDebug()

    // Box2D's tolerances, in meters (scaled by PhysicsTolerances) or radians, as Planck.js's Settings has them
    static kLinearSlop = 0.005;                // Collision and constraint tolerance
    static kAngularSlop = (2.0 / 180.0) * Math.PI;
    static kAABBExtension = 0.1;               // How far broad-phase boxes are fattened
    static kAABBMultiplier = 2.0;              // How far ahead they reach, as a multiple of the movement (no unit)
    static kVelocityThreshold = 1.0;           // Meters per second: slower collisions don't bounce
    static kMaxLinearCorrection = 0.2;
    static kMaxAngularCorrection = (8.0 / 180.0) * Math.PI;
    static kMaxTranslation = 2.0;              // Most a body moves in one step
    static kMaxRotation = 0.5 * Math.PI;       // Most a body turns in one step
    static kBaumgarte = 0.2;                   // How fast overlap is resolved (no unit)
    static kTOIBaumgarte = 0.75;
    static kTimeToSleep = 0.5;                 // Seconds a body must be still before it sleeps
    static kLinearSleepTolerance = 0.01;       // Meters per second
    static kAngularSleepTolerance = (2.0 / 180.0) * Math.PI;
}

/*
    PhysicsTolerances - Box2D's tolerances (PhysicsDefines) in design units, for
    one PhysicsBatcher's units per meter. Lengths and speeds are scaled; angles
    and plain numbers aren't. Read-only (frozen).
*/
class PhysicsTolerances
{
    constructor(unitsPerMeter)
    {
        const u = unitsPerMeter;

        this.unitsPerMeter = u;
        this.linearSlop = PhysicsDefines.kLinearSlop * u;
        this.linearSlopSquared = this.linearSlop * this.linearSlop;
        this.polygonRadius = 2.0 * this.linearSlop;    // The skin around polygons (used from Phase 2)
        this.angularSlop = PhysicsDefines.kAngularSlop;
        this.aabbExtension = PhysicsDefines.kAABBExtension * u;
        this.aabbMultiplier = PhysicsDefines.kAABBMultiplier;
        this.velocityThreshold = PhysicsDefines.kVelocityThreshold * u;
        this.maxLinearCorrection = PhysicsDefines.kMaxLinearCorrection * u;
        this.maxAngularCorrection = PhysicsDefines.kMaxAngularCorrection;
        this.maxTranslation = PhysicsDefines.kMaxTranslation * u;
        this.maxTranslationSquared = this.maxTranslation * this.maxTranslation;
        this.maxRotation = PhysicsDefines.kMaxRotation;
        this.maxRotationSquared = this.maxRotation * this.maxRotation;
        this.baumgarte = PhysicsDefines.kBaumgarte;
        this.toiBaumgarte = PhysicsDefines.kTOIBaumgarte;
        this.timeToSleep = PhysicsDefines.kTimeToSleep;
        this.linearSleepTolerance = PhysicsDefines.kLinearSleepTolerance * u;
        this.angularSleepTolerance = PhysicsDefines.kAngularSleepTolerance;

        Object.freeze(this);
    }
}
