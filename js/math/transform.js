/*
    Transform2D - A 2D position, scale, shear and rotation (radians).

    Rotation matches the 2D shaders: y runs up and a positive angle turns
    counter-clockwise (right-hand rule about +Z, toward the viewer). A
    Model2D drawn at a transform rotates and scales about its center, but
    the transform's position is its anchor (see Model2D.setAlignment()).

    A point is scaled, then sheared, then rotated, then moved:
        X  = x * scaleX                 Y = y * scaleY
        X  = X - tan(shear) * Y         A positive shear leans the y axis counter-clockwise (as Spine's does)
        x' = X cos(r) - Y sin(r) + x    y' = X sin(r) + Y cos(r) + y (the position)

    Shear is math only for now: transformPoint(), multiply(), invert() and
    getMatrix() use it, but the 2D shaders don't, so models draw unsheared.

    Multiplying: a * b puts b in a's space, so b is a child placed relative to
    its parent a. The result is b as seen from wherever a sits, and is exact:
        position                  = a's position + b's position through a's scale, shear and rotation
        scale, shear and rotation = b's 2x2 matrix then a's, split back into the four

        let world = new Transform2D();
        Transform2D.multiply(world, parent, child); // child's transform in the parent's space

    When a has no shear and a uniform scale (sx === sy), or b has no rotation
    and no shear, the split is simply: rotation = a's + b's, scale = a's * b's,
    shear = b's (or a's), keeping the values as given. Otherwise the rotation
    comes back in -PI - PI, scaleX 0 or more, and a flip shows in scaleY.

    getMatrix() and setFromMatrix() convert to and from a Matrix2 (row vectors:
    m = [a, c, b, d] for x' = a x + b y, y' = c x + d y).
*/
class Transform2D
{
    #position;
    #scale;
    #rotation; // Radians
    #shear;    // Radians, counter-clockwise lean of the y axis (see the top of this file)

    static #kMatA = [0, 0, 0, 0]; // Scratch for multiply(): [a, b, c, d]
    static #kMatB = [0, 0, 0, 0];

    constructor(_x = 0.0, _y = 0.0, _scaleX = 1.0, _scaleY = _scaleX, _rotation = 0.0, _shear = 0.0)
    {
        this.#position = new Vector2(_x, _y);
        this.#scale = new Vector2(_scaleX, _scaleY);
        this.#rotation = _rotation;
        this.#shear = _shear;
    }

    setPosition(x, y)
    {
        this.#position.setXY(x, y);
            return this;
    }

    setScale(sx, sy = sx)
    {
        this.#scale.setXY(sx, sy);
            return this;
    }

    setRotation(radians)
    {
        this.#rotation = radians;
            return this;
    }

    // Radians; a positive shear leans the y axis counter-clockwise
    setShear(radians)
    {
        this.#shear = radians;
            return this;
    }

    // shear left out is 0
    set(x, y, scaleX, scaleY, rotation, shear = 0.0)
    {
        this.#position.setXY(x, y);
        this.#scale.setXY(scaleX, scaleY);
        this.#rotation = rotation;
        this.#shear = shear;
            return this;
    }

    // Back to no change: position (0, 0), scale 1, no rotation or shear
    identity() { return this.set(0.0, 0.0, 1.0, 1.0, 0.0, 0.0); }

    copy(other)
    {
        return this.set(other.getX(), other.getY(), other.getScaleX(), other.getScaleY(), other.getRotation(), other.getShear());
    }

    equals(other)
    {
        return (this.#position.x === other.getX() && this.#position.y === other.getY() &&
                this.#scale.x === other.getScaleX() && this.#scale.y === other.getScaleY() &&
                this.#rotation === other.getRotation() && this.#shear === other.getShear());
    }

    // Read-only; change them with setPosition() and setScale()
    getPosition() { return this.#position; }
    getScale() { return this.#scale; }

    getX() { return this.#position.x; }
    getY() { return this.#position.y; }
    getScaleX() { return this.#scale.x; }
    getScaleY() { return this.#scale.y; }
    getRotation() { return this.#rotation; }
    getShear() { return this.#shear; }

    // this = this * other: other placed in this one's space (see the top of this file)
    multiply(other) { return Transform2D.multiply(this, this, other); }

    // this = other * this: this one placed in other's space, e.g. a child's local transform made world by its parent
    premultiply(other) { return Transform2D.multiply(this, other, this); }

    // Scales, shears, rotates, then moves point (a Vector2) into this transform's space, written into out (also returned). out may be point.
    transformPoint(point, out = new Vector2())
    {
        let sx = point.x * this.#scale.x;
        const sy = point.y * this.#scale.y;
        const s = Math.sin(this.#rotation);
        const c = Math.cos(this.#rotation);

        if (this.#shear !== 0.0)
            sx -= Math.tan(this.#shear) * sy;

        out.setXY(this.#position.x + (sx * c) - (sy * s),
                this.#position.y + (sx * s) + (sy * c));
            return out;
    }

    // transformPoint() undone: a point in this transform's space, written into out (also returned). out may be point. A scale of 0 gives 0 on that axis.
    inverseTransformPoint(point, out = new Vector2())
    {
        const dx = point.x - this.#position.x;
        const dy = point.y - this.#position.y;
        const s = Math.sin(this.#rotation);
        const c = Math.cos(this.#rotation);
        let x = (dx * c) + (dy * s);
        const y = (dy * c) - (dx * s);

        if (this.#shear !== 0.0)
            x += Math.tan(this.#shear) * y;

        out.setXY((this.#scale.x !== 0.0) ? x / this.#scale.x : 0.0,
                  (this.#scale.y !== 0.0) ? y / this.#scale.y : 0.0);
            return out;
    }

    // The scale, shear and rotation as a Matrix2 (row vectors; the position is left out), written into out and returned
    getMatrix(out = new Matrix2())
    {
        const m = Transform2D.#toMatrix(this, Transform2D.#kMatA);

        out.set(m[0], m[2],
                m[1], m[3]);
            return out;
    }

    // Sets the scale, shear and rotation from mat (a Matrix2, row vectors), keeping the position. Returns this.
    setFromMatrix(mat)
    {
        const m = mat.m;

        return Transform2D.#fromMatrix(this, this.#position.x, this.#position.y, m[0], m[2], m[1], m[3]);
    }

    // *** Static Methods ***

    // a * b (b in a's space, see the top of this file), written into out and returned. out may be a or b.
    static multiply(out, a, b)
    {
        const ax = a.getX();
        const ay = a.getY();
        const asx = a.getScaleX();
        const asy = a.getScaleY();
        const ar = a.getRotation();
        const ash = a.getShear();

        let bx = b.getX() * asx;
        const by = b.getY() * asy;
        const bsx = b.getScaleX();
        const bsy = b.getScaleY();
        const br = b.getRotation();
        const bsh = b.getShear();

        const s = Math.sin(ar);
        const c = Math.cos(ar);

        if (ash !== 0.0)
            bx -= Math.tan(ash) * by;

        const x = ax + (bx * c) - (by * s);
        const y = ay + (bx * s) + (by * c);

        // No split needed (see the top of this file)
        if (ash === 0.0 && asx === asy)
            return out.set(x, y, asx * bsx, asy * bsy, ar + br, bsh);

        if (br === 0.0 && bsh === 0.0)
            return out.set(x, y, asx * bsx, asy * bsy, ar, ash);

        const ma = Transform2D.#toMatrix(a, Transform2D.#kMatA);
        const mb = Transform2D.#toMatrix(b, Transform2D.#kMatB);

        return Transform2D.#fromMatrix(out, x, y,
                                       (ma[0] * mb[0]) + (ma[1] * mb[2]), (ma[0] * mb[1]) + (ma[1] * mb[3]),
                                       (ma[2] * mb[0]) + (ma[3] * mb[2]), (ma[2] * mb[1]) + (ma[3] * mb[3]));
    }

    /*
        The transform that undoes t (so t * it is the identity), written into
        out and returned. out may be t. Returns false (out unchanged) if t
        can't be undone (a scale of 0).
    */
    static invert(out, t)
    {
        const x = t.getX();
        const y = t.getY();
        const sx = t.getScaleX();

        // No split needed: no shear and a uniform scale
        if (t.getShear() === 0.0 && sx === t.getScaleY() && sx !== 0.0)
        {
            const r = t.getRotation();
            const s = Math.sin(r);
            const c = Math.cos(r);

            return out.set(-((x * c) + (y * s)) / sx, -((y * c) - (x * s)) / sx, 1.0 / sx, 1.0 / sx, -r, 0.0);
        }

        const m = Transform2D.#toMatrix(t, Transform2D.#kMatA);
        const det = (m[0] * m[3]) - (m[1] * m[2]);

        if (Math.abs(det) < MathDefines.kEpsilon)
            return false;

        const ia = m[3] / det, ib = -m[1] / det;
        const ic = -m[2] / det, id = m[0] / det;

        return Transform2D.#fromMatrix(out, -((ia * x) + (ib * y)), -((ic * x) + (id * y)), ia, ib, ic, id);
    }

    // *** Internal Methods ***

    // t's scale, shear and rotation as [a, b, c, d] (x' = a x + b y, y' = c x + d y), written into out and returned
    static #toMatrix(t, out)
    {
        const s = Math.sin(t.getRotation());
        const c = Math.cos(t.getRotation());
        const k = Math.tan(t.getShear());
        const sx = t.getScaleX();
        const sy = t.getScaleY();

        out[0] = c * sx;    out[1] = -((k * c) + s) * sy;
        out[2] = s * sx;    out[3] = (c - (k * s)) * sy;
        return out;
    }

    // Sets out to position (x, y) and the matrix [a, b, c, d] split into scale, shear and rotation. Returns out.
    static #fromMatrix(out, x, y, a, b, c, d)
    {
        const sx = Math.sqrt((a * a) + (c * c));

        // The x axis has collapsed: all in the y axis, with no shear
        if (sx < MathDefines.kEpsilon)
            return out.set(x, y, 0.0, Math.sqrt((b * b) + (d * d)), Math.atan2(-b, d), 0.0);

        const sy = ((a * d) - (b * c)) / sx;
        const k = (sy !== 0.0) ? -((a * b) + (c * d)) / (sx * sy) : 0.0;

        return out.set(x, y, sx, sy, Math.atan2(c, a), Math.atan(k));
    }
}
