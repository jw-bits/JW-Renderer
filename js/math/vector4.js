class Vector4
{
    constructor(_x = 0.0, _y = 0.0, _z = 0.0, _w = 1.0)
    {
        this.x = _x;
        this.y = _y;
        this.z = _z;
        this.w = _w;
    }

    set(_x, _y, _z, _w)
    {
        this.x = _x;
        this.y = _y;
        this.z = _z;
        this.w = _w;
    }

    saturate()
    {
        let m = this.x;

        if (this.y > m)
            m = this.y;

        if (this.z > m)
            m = this.z;

        if (this.w > m)
            m = this.w;

        this.x /= m;
        this.y /= m;
        this.z /= m;
        this.w /= m;
    }

    R() { return this.x; }
    G() { return this.y; }
    B() { return this.z; }
    A() { return this.w; }

    // *** Static Methods ***

    // a to b by t, written into out and returned, so nothing new is created
    static lerp(out, a, b, t)
    {
        out.x = a.x + ((b.x - a.x) * t);
        out.y = a.y + ((b.y - a.y) * t);
        out.z = a.z + ((b.z - a.z) * t);
        out.w = a.w + ((b.w - a.w) * t);
            return out;
    }

    // *** Static Vars ***

    // Shared, read-only constants: frozen, and the class property can't be reassigned.
    // To get a vector you can change, call the matching static method (e.g. Vector4.black()).
    static kBlack = Object.freeze(new Vector4());
    static kWhite = Object.freeze(new Vector4(1.0, 1.0, 1.0, 1.0));

    // *** Static Methods: new, changeable copies of the constants ***

    static black() { return new Vector4(); }
    static white() { return new Vector4(1.0, 1.0, 1.0, 1.0); }

    static
    {
        for (const name of ["kBlack", "kWhite"])
            Object.defineProperty(Vector4, name, { writable: false, configurable: false });
    }
}
