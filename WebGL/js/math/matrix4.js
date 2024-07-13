/*
	4x4 ROW 
	
	[  0  1  2  3 ]		
	[  4  5  6  7 ]		
	[  8  9 10 11 ]		
	[ 12 13 14 15 ]
*/
class Matrix4
{
    constructor(mat)
    {
        this.m = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

        if (this.setFromArray(mat) === false)
        {
            this.identity();
        }
    }
    
    set(m00, m01, m02, m03,
        m10, m11, m12, m13, 
        m20, m21, m22, m23,
        m30, m31, m32, m33)
    {
        this.m[0] = m00;  this.m[1] = m01;  this.m[2] = m02;  this.m[3] = m03;
        this.m[4] = m10;  this.m[5] = m11;  this.m[6] = m12;  this.m[7] = m13;
        this.m[8] = m20;  this.m[9] = m21;  this.m[10] = m22; this.m[11] = m23;
        this.m[12] = m30; this.m[13] = m31; this.m[14] = m32; this.m[15] = m33;
    }
	
	setFromArray(mat)
	{
        if (Array.isArray(mat) && mat.length === 16)
        {
            this.set(mat[0],  mat[1],  mat[2],  mat[3],
                     mat[4],  mat[5],  mat[6],  mat[7],
                     mat[8],  mat[9],  mat[10], mat[11],
                     mat[12], mat[13], mat[14], mat[15]);

            return true;
        }

        return false;
	}
	
    // Sets all elements to zero
	zero()
    {
        for (let i = 0; i < 16; ++i)
            this.m[i] = 0.0;
    } 

    // Set to identity matrix
	identity()
    {
        this.set(1.0, 0.0, 0.0, 0.0,
                 0.0, 1.0, 0,0, 0.0,
                 0.0, 0.0, 1.0, 0.0,
                 0.0, 0.0, 0.0, 1.0);
    }

	transpose()
    {
        let t = 0;

        // m[0] stays
        t = this.m[1]; this.m[1] = this.m[4]; this.m[4] = t;
        t = this.m[2]; this.m[2] = this.m[8]; this.m[8] = t;
        t = this.m[3]; this.m[3] = this.m[12]; this.m[12] = t;
	    // m[5] stays
        t = this.m[6]; this.m[6] = this.m[9]; this.m[9] = t;
        t = this.m[7]; this.m[7] = this.m[13]; this.m[13] = t;
	    // m[10] stays
        t = this.m[11]; this.m[11] = this.m[14]; this.m[14] = t;
	    // m[15] stays
    }	

    // *** Static methods ***

    /*
	    Orthographic Projection Matrix
	
        2/w  0    0           0
        0    2/h  0           0
        0    0    1/(zn-zf)   0
        0    0    zn/(zn-zf)  1
    */
    static orthographicMatrix(wid, hgt, zNear, zFar)
    {
        let mat = new Matrix4();

        mat.set(2.0 / wid, 0.0, 0.0, 0.0,
                0.0, 2.0 / hgt, 0.0, 0.0,
                0.0, 0.0, 1.0 / (zNear - zFar), 0.0,
                0.0, 0.0, zNear / (zNear - zFar), 1.0);
    }
}
