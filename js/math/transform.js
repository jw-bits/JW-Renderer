/*
    Transform2D - A 2D position, scale and rotation (radians).

    Rotation matches the 2D shaders: y runs up and a positive angle turns
    counter-clockwise (right-hand rule about +Z, toward the viewer). A
    Model2D drawn at a transform rotates and scales about its center, but
    the transform's position is its anchor (see Model2D.setAlignment()).

    Multiplying: a * b puts b in a's space, so b is a child placed relative to
    its parent a. The result is b as seen from wherever a sits:
        position = a's position + (b's position scaled, then rotated, by a)
        scale    = a's scale * b's scale
        rotation = a's rotation + b's rotation

        let world = new Transform2D();
        Transform2D.multiply(world, parent, child); // child's transform in the parent's space

    The result is exact when a's scale is uniform (sx === sy) or b has no
    rotation. Otherwise the true result is skewed, which position, scale and
    rotation can't hold; the scale is then only close.
*/
class Transform2D
{
    #position;
    #scale;
    #rotation; // Radians

    constructor(_x = 0.0, _y = 0.0, _scaleX = 1.0, _scaleY = _scaleX, _rotation = 0.0)
    {
        this.#position = new Vector2(_x, _y);
        this.#scale = new Vector2(_scaleX, _scaleY);
        this.#rotation = _rotation;
    }

    setPosition(x, y)
    {
        this.#position.set(x, y);
            return this;
    }

    setScale(sx, sy = sx)
    {
        this.#scale.set(sx, sy);
            return this;
    }

    setRotation(radians)
    {
        this.#rotation = radians;
            return this;
    }

    set(x, y, scaleX, scaleY, rotation)
    {
        this.#position.set(x, y);
        this.#scale.set(scaleX, scaleY);
        this.#rotation = rotation;
            return this;
    }

    // Back to no change: position (0, 0), scale 1, no rotation
    identity() { return this.set(0.0, 0.0, 1.0, 1.0, 0.0); }

    copy(other)
    {
        return this.set(other.getX(), other.getY(), other.getScaleX(), other.getScaleY(), other.getRotation());
    }

    equals(other)
    {
        return (this.#position.x === other.getX() && this.#position.y === other.getY() &&
                this.#scale.x === other.getScaleX() && this.#scale.y === other.getScaleY() &&
                this.#rotation === other.getRotation());
    }

    // Read-only; change them with setPosition() and setScale()
    getPosition() { return this.#position; }
    getScale() { return this.#scale; }

    getX() { return this.#position.x; }
    getY() { return this.#position.y; }
    getScaleX() { return this.#scale.x; }
    getScaleY() { return this.#scale.y; }
    getRotation() { return this.#rotation; }

    // this = this * other: other placed in this one's space (see the top of this file)
    multiply(other) { return Transform2D.multiply(this, this, other); }

    // this = other * this: this one placed in other's space, e.g. a child's local transform made world by its parent
    premultiply(other) { return Transform2D.multiply(this, other, this); }

    // Scales, rotates, then moves point (a Vector2) into this transform's space, written into out (also returned). out may be point.
    transformPoint(point, out = new Vector2())
    {
        const sx = point.x * this.#scale.x;
        const sy = point.y * this.#scale.y;
        const s = Math.sin(this.#rotation);
        const c = Math.cos(this.#rotation);

        out.set(this.#position.x + (sx * c) - (sy * s),
                this.#position.y + (sx * s) + (sy * c));
            return out;
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

        const bx = b.getX() * asx;
        const by = b.getY() * asy;
        const bsx = b.getScaleX();
        const bsy = b.getScaleY();
        const br = b.getRotation();

        const s = Math.sin(ar);
        const c = Math.cos(ar);

        return out.set(ax + (bx * c) - (by * s),
                       ay + (bx * s) + (by * c),
                       asx * bsx,
                       asy * bsy,
                       ar + br);
    }
}
