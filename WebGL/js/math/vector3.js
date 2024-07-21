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

	scale(sx, sy, sz)
    {
        this.x *= sx;
        this.y *= sy;
        this.z *= sz;
    }	

	normalize()
    {
        let ls = this.lengthSquared();

        if (ls > 0.000001)
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

    // *** Static Vars ***

    static kZero = new Vector3();
    static kOne = new Vector3(1.0, 1.0, 1.0);
};