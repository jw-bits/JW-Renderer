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
        return (x * vec.x) + (y * vec.y);
    }

    scale(sx, sy)
    {
        this.x *= sx;
        this.y *= sy;
    }

	normalize()
    {
        let ls = this.lengthSquared();

        if (ls > 0.000001)
        {
            let oneOverLen = 1.0 / Math.sqrt(ls);
        
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

    // *** Static Vars ***

    // Shared, read-only constants: frozen, and the class property can't be reassigned.
    // To get a vector you can change, call the matching static method (e.g. Vector2.zero()).
    static kZero = Object.freeze(new Vector2());
    static kOne = Object.freeze(new Vector2(1.0, 1.0));

    static
    {
        for (const name of ["kZero", "kOne"])
            Object.defineProperty(Vector2, name, { writable: false, configurable: false });
    }

    // *** Static Methods: new, changeable copies of the constants ***

    static zero() { return new Vector2(); }
    static one() { return new Vector2(1.0, 1.0); }
}
