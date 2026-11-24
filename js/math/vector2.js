class Vector2
{
    constructor(_x = 0.0, _y = 0.0)
    {
        this.x = _x;
        this.y = _y;
    }

    set(_x, _y)
    {
        this.x = _x;
        this.y = _y;
    }
	
	// Methods
	dot(vec)
    {
        return ((this.x * vec.x) + (this.y * vec.y));
    }

    scale(sx, sy)
    {
        this.x *= sx;
        this.y *= sy;
    }

	normalize()
    {
        const ls = this.lengthSquared();

        if (ls > MathDefines.kEpsilon)
        {
            const oneOverLen = 1.0 / Math.sqrt(ls);
        
            this.x *= oneOverLen;
            this.y *= oneOverLen;
        }
    }

    length()
    {
        return Math.sqrt(this.lengthSquared());
    }

	lengthSquared()
    {
	    return ((this.x * this.x) + (this.y * this.y));
    }

    // *** Static Methods ***

    // a to b by t, written into out and returned, so nothing new is created
    static lerp(out, a, b, t)
    {
        out.x = a.x + ((b.x - a.x) * t);
        out.y = a.y + ((b.y - a.y) * t);
            return out;
    }

    // *** Static Vars ***

    // Shared, read-only constants: frozen, and the class property can't be reassigned.
    // To get a vector you can change, call the matching static method (e.g. Vector2.zero()).
    static kZero = Object.freeze(new Vector2());
    static kOne = Object.freeze(new Vector2(1.0, 1.0));

    // *** Static Methods: new, changeable copies of the constants ***

    static zero() { return new Vector2(); }
    static one() { return new Vector2(1.0, 1.0); }

    static
    {
        for (const name of ["kZero", "kOne"])
            Object.defineProperty(Vector2, name, { writable: false, configurable: false });
    }
}
