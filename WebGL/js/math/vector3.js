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
	
	// // Overloaded Operators
	// Vector3& operator =(const Vector3 &vec);
	// Vector3 operator +(const Vector3 &vec) const;
	// Vector3 operator -(const Vector3 &vec) const;
	// Vector3 operator *(real s) const;
	// Vector3 operator *(const Matrix3 &mat) const;
	// Vector3& operator +=(const Vector3 &vec);
	// Vector3& operator -=(const Vector3 &vec);
	// Vector3& operator *=(real s);
	// Vector3 operator -() const;
	// bool operator ==(const Vector3 &vec) const;
    // bool operator !=(const Vector3 &vec) const;
	
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

    // *** Static Methods ***

	// static Vector3 Project(const Vector3 &a, const Vector3 &ontoB);
	// static Point3 Rotate(const Point3 &pt, const Point3 &pivotPt, const Matrix3 &rotation);
	// static Vector3 PerpendicularProject(const Vector3 &a, const Vector3 &ontoB);
	// static Vector3 Reflect(const Vector3 &vec, const Vector3 &norm);

	// // If areUnitLength == true, both vectors lengths are assumed to = 1
	// // Otherwise, their lengths are calculated and used
	// static real AngleBetween(const Vector3 &vec1, const Vector3 &vec2, bool areUnitLength);

    // *** Static Vars ***

    static kZero = new Vector3();
    static kOne = new Vector3(1.0, 1.0, 1.0);
};