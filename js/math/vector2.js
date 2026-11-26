class Vector2
{
    constructor(_x = 0.0, _y = 0.0)
    {
        this.x = _x;
        this.y = _y;
    }

    // Copies vec (a Vector2, or anything with x and y)
    set(vec)
    {
        this.x = vec.x;
        this.y = vec.y;
    }

    setXY(_x, _y)
    {
        this.x = _x;
        this.y = _y;
    }

    /*
        Sets x and y from text. Returns false (with a console.error), leaving the
        vector unchanged, if text isn't two numbers. Valid formats (see
        MathUtil.parseNumberList()):
            "1, 2"   "1 2"   "(1, 2)"   "[1, 2]"   "{1, 2}"
    */
    setXYFromString(text)
    {
        const n = MathUtil.parseNumberList(text);

        if (n === null || n.length !== 2)
        {
            console.error(`Vector2.setXYFromString(): "${text}" isn't two numbers, such as "1, 2"`);
                return false;
        }

        this.x = n[0];
        this.y = n[1];
            return true;
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
