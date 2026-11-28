"use strict";

/*
    Physics shapes - The shapes on a PhysicsEntity's body: PhysicsCircle and
    PhysicsPolygon (boxes are polygons). Made by PhysicsEntity.addCircle(),
    addBox() and addPolygon(), which return the shape as a handle for changing
    its density, friction and so on later.

    Ported from Planck.js 1.5.1 (MIT, Copyright (c) Erin Catto, Ali Shakiba),
    itself a port of Box2D: CircleShape and PolygonShape's mass, hull and
    centroid, and Fixture's settings.

    Space: a shape is given in its Entity's own space at scale 1 (as a child
    Entity's position would be), in design units. The Entity's world scale is
    built into it (see rebuild()), so its geometry below is in the body's
    space: about the body's origin (the Entity's position), unrotated.

        circle      center, radius. An uneven scale (sx !== sy) uses the larger of
                    the two: a circle stays a circle.
        polygon     count vertices, counter-clockwise, with an outward normal for
                    each edge (vertex i to i + 1) and the centroid. A negative scale
                    flips it, and the order is reversed to stay counter-clockwise.

    The geometry fields are read-only outside js/physics; change a shape
    through its Entity (its scale) or remove it and add another.

    Settings (each shape's own):
        density       Mass per square design unit, 1 by default. Changing it works the body's mass out again.
        friction      0 or more, 0.2 by default (used from Phase 3)
        restitution   Bounciness, 0 or more, 0 by default (used from Phase 3)
        sensor        Reports contacts without colliding (used from Phase 2)
        filter        category, mask and group bits (used from Phase 2)

    Polygons: 3 - 12 points, in either winding, convex, with no three in a line
    and none closer together than the linear slop (PhysicsTolerances). Box2D
    makes the convex hull of whatever it's given; here a point the hull would
    drop is refused instead, so a concave outline is caught rather than
    quietly filled in.
*/
class PhysicsShape
{
    #type;
    #density;
    #friction;
    #restitution;
    #isSensor;
    #category;
    #mask;
    #group;

    // Internal (js/physics): the PhysicsBody it's on, or null once removed
    body;

    constructor(type)
    {
        this.#type = type;
        this.#density = PhysicsDefines.kDefaultDensity;
        this.#friction = PhysicsDefines.kDefaultFriction;
        this.#restitution = PhysicsDefines.kDefaultRestitution;
        this.#isSensor = false;
        this.#category = PhysicsDefines.kDefaultCategory;
        this.#mask = PhysicsDefines.kDefaultMask;
        this.#group = PhysicsDefines.kDefaultGroup;
        this.body = null;
    }

    getType() { return this.#type; }

    // The PhysicsEntity it's on, or null once removed
    getEntity() { return (this.body === null) ? null : this.body.entity; }

    /*
        Applies options: { density, friction, restitution, sensor, category, mask,
        group }, each optional. Returns false (changing nothing) if any is invalid.
        A density change works the body's mass out again.
    */
    setOptions(options)
    {
        if (options === null || typeof options !== "object")
        {
            console.error("PhysicsShape.setOptions() needs an object, e.g. { density: 1, friction: 0.5 }");
                return false;
        }

        const o = options;
        const isNumber = (v, min) => (v === undefined || (Number.isFinite(v) === true && v >= min));
        const isBits = (v) => (v === undefined || (Number.isInteger(v) === true && v >= 0 && v <= 0xFFFF));
        const isGroup = (v) => (v === undefined || (Number.isInteger(v) === true && v >= -32768 && v <= 32767));

        if (isNumber(o.density, 0.0) === false || isNumber(o.friction, 0.0) === false || isNumber(o.restitution, 0.0) === false)
        {
            console.error("PhysicsShape: density, friction and restitution must be numbers, 0 or more");
                return false;
        }

        if (isBits(o.category) === false || isBits(o.mask) === false || isGroup(o.group) === false)
        {
            console.error("PhysicsShape: category and mask must be 16-bit integers (0 - 0xFFFF), group -32768 - 32767");
                return false;
        }

        if (o.sensor !== undefined && typeof o.sensor !== "boolean")
        {
            console.error("PhysicsShape: sensor must be true or false");
                return false;
        }

        const densityChanged = (o.density !== undefined && o.density !== this.#density);

        this.#density = o.density ?? this.#density;
        this.#friction = o.friction ?? this.#friction;
        this.#restitution = o.restitution ?? this.#restitution;
        this.#isSensor = o.sensor ?? this.#isSensor;
        this.#category = o.category ?? this.#category;
        this.#mask = o.mask ?? this.#mask;
        this.#group = o.group ?? this.#group;

        if (densityChanged === true && this.body !== null)
            this.body.resetMassData();

        return true;
    }

    setDensity(density) { return this.setOptions({ density }); }
    setFriction(friction) { return this.setOptions({ friction }); }
    setRestitution(restitution) { return this.setOptions({ restitution }); }
    setSensor(isSensor) { return this.setOptions({ sensor: isSensor }); }
    setFilter(category, mask, group = 0) { return this.setOptions({ category, mask, group }); }

    getDensity() { return this.#density; }
    getFriction() { return this.#friction; }
    getRestitution() { return this.#restitution; }
    isSensor() { return this.#isSensor; }
    getCategory() { return this.#category; }
    getMask() { return this.#mask; }
    getGroup() { return this.#group; }

    // *** For Subclasses (js/physics) ***

    // Builds the geometry at scale (sx, sy). Returns false (keeping the old geometry) if it can't be.
    rebuild(sx, sy, tolerances) { return false; }

    // This shape's mass, center (body space) and rotational inertia about the body's origin, at density, into out ({ mass, center: Vector2, I })
    computeMass(out, density) { }

    // The box around it in the body's space, written into out (a Bounds2D) and returned
    getLocalBounds(out = new Bounds2D()) { return out; }

    // True if point (body space) is inside it
    containsPoint(point) { return false; }

    // *** Internal Methods ***

    // Checks the options object shape factories take (null for none)
    static _checkOptions(options, where)
    {
        if (options !== null && (typeof options !== "object"))
        {
            console.error(`${where}: options must be an object or left out`);
                return false;
        }

        return true;
    }
}

/*
    PhysicsCircle - A circle: (x, y) its center in the Entity's space, radius
    above 0.
*/
class PhysicsCircle extends PhysicsShape
{
    // Geometry in the body's space (see the top of this file); read-only outside js/physics
    center;
    radius;

    #baseX;
    #baseY;
    #baseRadius;

    constructor(x, y, radius)
    {
        super(PhysicsShapeType.kCircle);
        this.#baseX = x;
        this.#baseY = y;
        this.#baseRadius = radius;
        this.center = new Vector2(x, y);
        this.radius = radius;
    }

    // Checks a circle's numbers; returns false (with a console.error) if they can't make one
    static isValid(x, y, radius, where)
    {
        if (Number.isFinite(x) === false || Number.isFinite(y) === false || Number.isFinite(radius) === false || radius <= 0.0)
        {
            console.error(`${where}: needs a finite center and a radius above 0`);
                return false;
        }

        return true;
    }

    rebuild(sx, sy, tolerances)
    {
        const scale = Math.max(Math.abs(sx), Math.abs(sy));

        if (scale * this.#baseRadius < tolerances.linearSlop)
        {
            console.error("PhysicsCircle: the scale makes it smaller than the linear slop; it keeps its last size");
                return false;
        }

        this.center.setXY(this.#baseX * sx, this.#baseY * sy);
        this.radius = this.#baseRadius * scale;
            return true;
    }

    computeMass(out, density)
    {
        out.mass = density * Math.PI * this.radius * this.radius;
        out.center.set(this.center);
        out.I = out.mass * ((0.5 * this.radius * this.radius) + this.center.lengthSquared());
    }

    getLocalBounds(out = new Bounds2D())
    {
        const c = this.center;
        const r = this.radius;

        out.setMinMax(c.x - r, c.y - r, c.x + r, c.y + r);
            return out;
    }

    containsPoint(point)
    {
        const dx = point.x - this.center.x;
        const dy = point.y - this.center.y;
            return ((dx * dx) + (dy * dy) <= this.radius * this.radius);
    }
}

/*
    PhysicsPolygon - A convex polygon of 3 - 12 points (see the top of this
    file). Boxes are made by PhysicsPolygon.boxPoints().
*/
class PhysicsPolygon extends PhysicsShape
{
    // Geometry in the body's space (see the top of this file); read-only outside js/physics
    count;
    vertices;   // Vector2s, counter-clockwise
    normals;    // Vector2s: normals[i] is the outward normal of vertices[i] -> vertices[i + 1]
    centroid;   // Vector2

    #base;      // The points at scale 1, counter-clockwise (Vector2s)

    // points: counter-clockwise Vector2s from PhysicsPolygon.makeHull()
    constructor(points)
    {
        super(PhysicsShapeType.kPolygon);
        this.#base = points;
        this.count = points.length;
        this.vertices = points.map((p) => new Vector2(p.x, p.y));
        this.normals = points.map(() => new Vector2());
        this.centroid = new Vector2();
        PhysicsPolygon.#finish(this.vertices, this.normals, this.centroid);
    }

    /*
        points (an array of Vector2s or { x, y }) as a counter-clockwise convex
        polygon, as new Vector2s; null (with a console.error naming where) if there
        are fewer than 3 or more than 12, any isn't finite, two are within the
        linear slop of each other, or they aren't convex with no three in a line.
    */
    static makeHull(points, tolerances, where)
    {
        if (Array.isArray(points) === false || points.length < 3 || points.length > PhysicsDefines.kMaxPolygonVertices)
        {
            console.error(`${where}: needs an array of 3 - ${PhysicsDefines.kMaxPolygonVertices} points`);
                return null;
        }

        const ps = [];

        for (const p of points)
        {
            if (p === null || typeof p !== "object" || Number.isFinite(p.x) === false || Number.isFinite(p.y) === false)
            {
                console.error(`${where}: every point needs a finite x and y`);
                    return null;
            }

            for (const q of ps)
            {
                const dx = p.x - q.x;
                const dy = p.y - q.y;

                if ((dx * dx) + (dy * dy) < 0.25 * tolerances.linearSlopSquared)
                {
                    console.error(`${where}: two points are closer than the linear slop (${tolerances.linearSlop} units)`);
                        return null;
                }
            }

            ps.push(new Vector2(p.x, p.y));
        }

        // Gift wrapping from the rightmost point (lowest of those), as Box2D does
        const n = ps.length;
        let i0 = 0;
        let x0 = ps[0].x;

        for (let i = 1; i < n; ++i)
        {
            const x = ps[i].x;

            if (x > x0 || (x === x0 && ps[i].y < ps[i0].y))
            {
                i0 = i;
                x0 = x;
            }
        }

        const hull = [];
        let ih = i0;

        for (;;)
        {
            hull.push(ih);

            if (hull.length > n)
                break; // Can't happen with distinct points; a guard against a loop

            let ie = 0;

            for (let j = 1; j < n; ++j)
            {
                if (ie === ih)
                {
                    ie = j;
                    continue;
                }

                const h = ps[ih];
                const rx = ps[ie].x - h.x, ry = ps[ie].y - h.y;
                const vx = ps[j].x - h.x, vy = ps[j].y - h.y;
                const c = (rx * vy) - (ry * vx);

                if (c < 0.0)
                    ie = j;

                if (c === 0.0 && (vx * vx) + (vy * vy) > (rx * rx) + (ry * ry))
                    ie = j;
            }

            ih = ie;

            if (ie === i0)
                break;
        }

        if (hull.length !== n)
        {
            console.error(`${where}: the points must be convex with no three in a line (${n - hull.length} would be left out)`);
                return null;
        }

        // Every other point is left of each edge: counter-clockwise, from the rightmost point
        const out = hull.map((i) => ps[i]);

        if (PhysicsPolygon.#area(out) < tolerances.linearSlopSquared)
        {
            console.error(`${where}: the polygon has no area`);
                return null;
        }

        return out;
    }

    // A width x height box's corners, centered on (x, y) and turned by angle (radians), counter-clockwise
    static boxPoints(width, height, x = 0.0, y = 0.0, angle = 0.0)
    {
        const hx = width * 0.5;
        const hy = height * 0.5;
        const s = Math.sin(angle);
        const c = Math.cos(angle);
        const corners = [[hx, -hy], [hx, hy], [-hx, hy], [-hx, -hy]];

        return corners.map(([px, py]) => new Vector2(x + (c * px) - (s * py), y + (s * px) + (c * py)));
    }

    rebuild(sx, sy, tolerances)
    {
        const n = this.#base.length;
        const flip = (sx * sy < 0.0);
        const scaled = [];

        for (let i = 0; i < n; ++i)
        {
            const p = this.#base[flip ? (n - 1 - i) : i];
            scaled.push(new Vector2(p.x * sx, p.y * sy));
        }

        if (PhysicsPolygon.#area(scaled) < tolerances.linearSlopSquared)
        {
            console.error("PhysicsPolygon: the scale leaves it with no area; it keeps its last size");
                return false;
        }

        for (let i = 0; i < n; ++i)
            this.vertices[i].set(scaled[i]);

        PhysicsPolygon.#finish(this.vertices, this.normals, this.centroid);
            return true;
    }

    computeMass(out, density)
    {
        // Box2D's: triangles from a point inside (the vertices' average), for accuracy
        const v = this.vertices;
        const n = this.count;
        let sx = 0.0, sy = 0.0;

        for (let i = 0; i < n; ++i)
        {
            sx += v[i].x;
            sy += v[i].y;
        }

        sx *= 1.0 / n;
        sy *= 1.0 / n;

        const kInv3 = 1.0 / 3.0;
        let area = 0.0, cx = 0.0, cy = 0.0, I = 0.0;

        for (let i = 0; i < n; ++i)
        {
            const p2 = v[(i + 1 < n) ? i + 1 : 0];
            const ex1 = v[i].x - sx, ey1 = v[i].y - sy;
            const ex2 = p2.x - sx, ey2 = p2.y - sy;
            const D = (ex1 * ey2) - (ey1 * ex2);
            const triangleArea = 0.5 * D;

            area += triangleArea;
            cx += (triangleArea * kInv3 * ex1) + (triangleArea * kInv3 * ex2);
            cy += (triangleArea * kInv3 * ey1) + (triangleArea * kInv3 * ey2);

            const intx2 = (ex1 * ex1) + (ex2 * ex1) + (ex2 * ex2);
            const inty2 = (ey1 * ey1) + (ey2 * ey1) + (ey2 * ey2);
            I += 0.25 * kInv3 * D * (intx2 + inty2);
        }

        out.mass = density * area;
        cx *= 1.0 / area;
        cy *= 1.0 / area;
        out.center.setXY(cx + sx, cy + sy);
        out.I = density * I;
        out.I += out.mass * (((out.center.x * out.center.x) + (out.center.y * out.center.y)) - ((cx * cx) + (cy * cy)));
    }

    getLocalBounds(out = new Bounds2D())
    {
        out.setEmpty();

        for (let i = 0; i < this.count; ++i)
            out.expandByXY(this.vertices[i].x, this.vertices[i].y);

        return out;
    }

    containsPoint(point)
    {
        for (let i = 0; i < this.count; ++i)
        {
            const nv = this.normals[i];
            const v = this.vertices[i];

            if ((nv.x * (point.x - v.x)) + (nv.y * (point.y - v.y)) > 0.0)
                return false;
        }

        return true;
    }

    // *** Internal Methods ***

    // Twice-signed area halved: positive for counter-clockwise points
    static #area(points)
    {
        let a = 0.0;

        for (let i = 0; i < points.length; ++i)
        {
            const p = points[i];
            const q = points[(i + 1) % points.length];
            a += (p.x * q.y) - (q.x * p.y);
        }

        return 0.5 * a;
    }

    // Each edge's outward normal, and the centroid (Box2D's ComputeCentroid, from the origin)
    static #finish(vertices, normals, centroid)
    {
        const n = vertices.length;
        let area = 0.0, cx = 0.0, cy = 0.0;
        const kInv3 = 1.0 / 3.0;

        for (let i = 0; i < n; ++i)
        {
            const p2 = vertices[i];
            const p3 = vertices[(i + 1 < n) ? i + 1 : 0];

            // Edge normal: (edge.y, -edge.x), normalized
            const ex = p3.x - p2.x;
            const ey = p3.y - p2.y;
            normals[i].setXY(ey, -ex);
            normals[i].normalize();

            const D = (p2.x * p3.y) - (p2.y * p3.x);
            const triangleArea = 0.5 * D;
            area += triangleArea;
            cx += triangleArea * kInv3 * (p2.x + p3.x);
            cy += triangleArea * kInv3 * (p2.y + p3.y);
        }

        centroid.setXY(cx * (1.0 / area), cy * (1.0 / area));
    }
}
