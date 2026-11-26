"use strict";

/*
    Bounds2D - An axis-aligned box in 2D, kept as its corners (minX, minY) and
    (maxX, maxY), y up. A new one is empty: min is +Infinity and max -Infinity,
    so the first expandByXY() or union() makes it that point or box.

        let b = new Bounds2D();
        b.expandByXY(10, 20);
        b.expandByXY(-5, 40);                  // Now (-5, 20) - (10, 40)

        let view = new Bounds2D();
        view.setFromVector4(camera.getWorldBounds());
        if (entity.getWorldBounds(b).intersects(view)) ...   // On screen

    As a rect: getX(), getY(), getWidth() and getHeight() (all 0 when empty),
    or toVector4() for (x, y, width, height), the shape Camera2D.getWorldBounds()
    gives. Edges count as inside: boxes that only touch intersect.
*/
class Bounds2D
{
    constructor(minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity)
    {
        this.minX = minX;
        this.minY = minY;
        this.maxX = maxX;
        this.maxY = maxY;
    }

    // Copies other (a Bounds2D)
    set(other)
    {
        this.minX = other.minX;
        this.minY = other.minY;
        this.maxX = other.maxX;
        this.maxY = other.maxY;
    }

    setMinMax(minX, minY, maxX, maxY)
    {
        this.minX = minX;
        this.minY = minY;
        this.maxX = maxX;
        this.maxY = maxY;
    }

    // From a rect v (a Vector4: x, y, width, height), e.g. Camera2D.getWorldBounds()
    setFromVector4(v)
    {
        this.setMinMax(v.x, v.y, v.x + v.z, v.y + v.w);
    }

    // Back to empty: holds nothing
    setEmpty()
    {
        this.setMinMax(Infinity, Infinity, -Infinity, -Infinity);
    }

    isEmpty() { return (this.minX > this.maxX || this.minY > this.maxY); }

    // Grows to hold the point (x, y)
    expandByXY(x, y)
    {
        if (x < this.minX) this.minX = x;
        if (y < this.minY) this.minY = y;
        if (x > this.maxX) this.maxX = x;
        if (y > this.maxY) this.maxY = y;
    }

    // Grows to hold point (a Vector2)
    expandByPoint(point)
    {
        this.expandByXY(point.x, point.y);
    }

    // Grows to hold other (a Bounds2D); an empty other changes nothing
    union(other)
    {
        if (other.isEmpty() === true)
            return;

        this.expandByXY(other.minX, other.minY);
        this.expandByXY(other.maxX, other.maxY);
    }

    // True if the two overlap or touch; false if either is empty
    intersects(other)
    {
        return (this.isEmpty() === false && other.isEmpty() === false &&
                this.minX <= other.maxX && this.maxX >= other.minX &&
                this.minY <= other.maxY && this.maxY >= other.minY);
    }

    // True if point (a Vector2) is inside or on an edge
    containsPoint(point)
    {
        return (point.x >= this.minX && point.x <= this.maxX &&
                point.y >= this.minY && point.y <= this.maxY);
    }

    // The bottom-left corner and size; 0 when empty
    getX() { return (this.isEmpty() === true) ? 0.0 : this.minX; }
    getY() { return (this.isEmpty() === true) ? 0.0 : this.minY; }
    getWidth() { return (this.isEmpty() === true) ? 0.0 : this.maxX - this.minX; }
    getHeight() { return (this.isEmpty() === true) ? 0.0 : this.maxY - this.minY; }

    // The middle, written into out and returned; (0, 0) when empty
    getCenter(out = new Vector2())
    {
        if (this.isEmpty() === true)
            out.setXY(0.0, 0.0);
        else
            out.setXY((this.minX + this.maxX) / 2.0, (this.minY + this.maxY) / 2.0);
        return out;
    }

    // As a rect (x, y, width, height), written into out (a Vector4) and returned; all 0 when empty
    toVector4(out = new Vector4())
    {
        out.setXYZW(this.getX(), this.getY(), this.getWidth(), this.getHeight());
        return out;
    }

    // *** Static Methods ***

    /*
        The box around b's 4 corners put through t (a Transform2D, see
        transformPoint(): scale, shear, rotation, then position), written into out
        and returned. out may be b. An empty b gives an empty box.
    */
    static transform(out, b, t)
    {
        if (b.isEmpty() === true)
        {
            out.setEmpty();
            return out;
        }

        const p = Bounds2D.#kPoint;
        const minX = b.minX, minY = b.minY, maxX = b.maxX, maxY = b.maxY;

        out.setEmpty();

        p.setXY(minX, minY); out.expandByPoint(t.transformPoint(p, p));
        p.setXY(maxX, minY); out.expandByPoint(t.transformPoint(p, p));
        p.setXY(maxX, maxY); out.expandByPoint(t.transformPoint(p, p));
        p.setXY(minX, maxY); out.expandByPoint(t.transformPoint(p, p));
        return out;
    }

    static #kPoint = new Vector2(); // Scratch for transform()
}
