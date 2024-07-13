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

    }
        
    // Static Methods
	static rotationMatrixXAxis(angle)
    {

    }

	static rotationMatrixYAxis(angle)
    {

    }

	static rotationMatrixZAzis(angle)
    {

    }
    
	static rotationMatrix(axis, angle) // (Vector3, float)
    {

    } 

	static orthonormalize(mat) // (Matrix3)
    {

    } 
}
