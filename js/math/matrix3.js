/*
	3X3 ROW

	[ 0 1 2 ]
	[ 3 4 5 ]
	[ 6 7 8 ]
*/
class Matrix3
{		
    constructor(mat)
    {
        this.m = [0, 1, 2, 3, 4, 5, 6, 7, 8];     

        if (this.setFromArray(mat) === false)
        {
            this.identity();
        }
    }

    set(m0, m1, m2,
        m3, m4, m5,
        m6, m7, m8)
    {
        this.m[0] = m0;	this.m[1] = m1;	this.m[2] = m2;
        this.m[3] = m3;	this.m[4] = m4;	this.m[5] = m5;
        this.m[6] = m6;	this.m[7] = m7;	this.m[8] = m8;
    }

	setFromArray(mat)
	{
        if (Array.isArray(mat) === true && mat.length === 9)
        {
            this.m[0] = mat[0];	this.m[1] = mat[1]; this.m[2] = mat[2];
            this.m[3] = mat[3];	this.m[4] = mat[4]; this.m[5] = mat[5];
            this.m[6] = mat[6];	this.m[7] = mat[7];	this.m[8] = mat[8];

            return true;
        }

        return false;
    }

    zero()
    {
        for (let i = 0; i < 9; ++i)
            this.m[i] = 0.0;
    }

    identity()
    {
        this.set(1.0, 0.0, 0.0,
                 0.0, 1.0, 0.0,
                 0.0, 0.0, 1.0);
    }

    transpose()
    {
        let t = 0;

        // m[0] stays
        t = this.m[1]; this.m[1] = this.m[3]; this.m[3] = t;
        t = this.m[2]; this.m[2] = this.m[6]; this.m[6] = t;
	    // m[4] stays
        t = this.m[5]; this.m[5] = this.m[7]; this.m[7] = t;
	    // m[8] stays
    }

    invert()
    {
        let m = this.m;
        let m00 = m[0], m01 = m[1], m02 = m[2];
        let m10 = m[3], m11 = m[4], m12 = m[5];
        let m20 = m[6], m21 = m[7], m22 = m[8];

        let t00 = m11 * m22 - m12 * m21;
        let t10 = m12 * m20 - m10 * m22;
        let t20 = m10 * m21 - m11 * m20;

        let det = m00 * t00 + m01 * t10 + m02 * t20;

        if (Math.abs(det) < 0.000001)
            return;

        let invDet = 1.0 / det;

        this.set(
            t00 * invDet,
            (m02 * m21 - m01 * m22) * invDet,
            (m01 * m12 - m02 * m11) * invDet,
            t10 * invDet,
            (m00 * m22 - m02 * m20) * invDet,
            (m10 * m02 - m00 * m12) * invDet,
            t20 * invDet,
            (m01 * m20 - m00 * m21) * invDet,
            (m00 * m11 - m10 * m01) * invDet
        );
    }
        
    // Static Methods
	static rotationMatrixXAxis(angle)
    {
        let mat = new Matrix3();
        let c = Math.cos(angle);
        let s = Math.sin(angle);

        mat.set(1.0, 0.0, 0.0,
                0.0, c,   -s,
                0.0, s,    c);
        return mat;
    }

	static rotationMatrixYAxis(angle)
    {
        let mat = new Matrix3();
        let c = Math.cos(angle);
        let s = Math.sin(angle);

        mat.set(c,   0.0, s,
                0.0, 1.0, 0.0,
                -s,  0.0, c);
        return mat;
    }

	static rotationMatrixZAxis(angle)
    {
        let mat = new Matrix3();
        let c = Math.cos(angle);
        let s = Math.sin(angle);

        mat.set(c,   -s,  0.0,
                s,    c,  0.0,
                0.0, 0.0, 1.0);
        return mat;
    }
    
	static rotationMatrix(axis, angle) // (Vector3, float)
    {
        let mat = new Matrix3();
        let x = axis.x, y = axis.y, z = axis.z;
        let ls = x * x + y * y + z * z;

        if (ls < 0.000001)
            return mat;

        let invLen = 1.0 / Math.sqrt(ls);
        x *= invLen; y *= invLen; z *= invLen;

        let c = Math.cos(angle);
        let s = Math.sin(angle);
        let t = 1.0 - c;

        mat.set(
            x * x * t + c,     x * y * t - z * s, x * z * t + y * s,
            y * x * t + z * s, y * y * t + c,     y * z * t - x * s,
            z * x * t - y * s, z * y * t + x * s, z * z * t + c
        );

        return mat;
    } 

	static orthonormalize(mat) // (Matrix3)
    {
        let v0 = new Vector3(mat.m[0], mat.m[1], mat.m[2]);
        let v1 = new Vector3(mat.m[3], mat.m[4], mat.m[5]);
        let v2 = new Vector3(mat.m[6], mat.m[7], mat.m[8]);

        v0.normalize();

        // v1 = v1 - proj_v0(v1)
        let dot01 = v0.dot(v1);
        v1.set(v1.x - v0.x * dot01, v1.y - v0.y * dot01, v1.z - v0.z * dot01);
        v1.normalize();

        // v2 = v2 - proj_v0(v2) - proj_v1(v2)
        let dot02 = v0.dot(v2);
        let dot12 = v1.dot(v2);
        v2.set(v2.x - (v0.x * dot02 + v1.x * dot12), 
               v2.y - (v0.y * dot02 + v1.y * dot12), 
               v2.z - (v0.z * dot02 + v1.z * dot12));
        v2.normalize();

        mat.set(v0.x, v0.y, v0.z,
                v1.x, v1.y, v1.z,
                v2.x, v2.y, v2.z);
    } 
}
