class Vector3
{
    constructor(_x = 0.0, _y = 0.0, _z = 0.0)
    {
        this.x = _x;
        this.y = _y;
        this.z = _z;
    }
	
	set(_x, _y, _z)
	{
		this.x = _x;
		this.y = _y;
		this.z = _z;
	}
	
	// Methods
	dot(vec)
    {
        return ((this.x * vec.x) + (this.y * vec.y) + (this.z * vec.z));
    }
    
	cross(vec)
    {
        let v = new Vector3((this.y * vec.z) - (vec.y * this.z), 
                            (this.z * vec.x) - (vec.z * this.x),
                            (this.x * vec.y) - (vec.x * this.y));
        
        return v;
    }

    add(vec)
    {
        this.x += vec.x;
        this.y += vec.y;
        this.z += vec.z;
    }

    subtract(vec)
    {
        this.x -= vec.x;
        this.y -= vec.y;
        this.z -= vec.z;
    }

	scale(sx, sy, sz)
    {
        this.x *= sx;
        this.y *= sy;
        this.z *= sz;
    }	

	normalize()
    {
        let ls = this.lengthSquared();

        if (ls > MathDefines.kEpsilon)
        {
            let oneOverLen = 1.0 / Math.sqrt(ls);
        
            this.x *= oneOverLen;
            this.y *= oneOverLen;
            this.z *= oneOverLen;
        }

    }

	length()
    {
        return Math.sqrt(this.lengthSquared());
    }

	lengthSquared()
    {
	    return ((this.x * this.x) + (this.y * this.y) + (this.z * this.z));
    }

    // <== Static Methods ==>
    static add(v1, v2)
    {
        return new Vector3(v1.x + v2.x, v1.y + v2.y, v1.z + v2.z);
    }

    static subtract(v1, v2)
    {       
        return new Vector3(v1.x - v2.x, v1.y - v2.y, v1.z - v2.z);
    }

    // a to b by t, written into out and returned, so nothing new is created
    static lerp(out, a, b, t)
    {
        out.x = a.x + ((b.x - a.x) * t);
        out.y = a.y + ((b.y - a.y) * t);
        out.z = a.z + ((b.z - a.z) * t);
            return out;
    }

    // *** Static Vars ***

    // Shared, read-only constants: frozen, and the class property can't be reassigned.
    // To get a vector you can change, call the matching static method (e.g. Vector3.zero()).
    static kZero = Object.freeze(new Vector3());
    static kOne = Object.freeze(new Vector3(1.0, 1.0, 1.0));

    static
    {
        for (const name of ["kZero", "kOne"])
            Object.defineProperty(Vector3, name, { writable: false, configurable: false });
    }

    // *** Static Methods: new, changeable copies of the constants ***

    static zero() { return new Vector3(); }
    static one() { return new Vector3(1.0, 1.0, 1.0); }
};