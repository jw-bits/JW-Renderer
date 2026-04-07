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
                 0.0, 1.0, 0.0, 0.0,
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

    static multiply(a, b) {
        let out = new Matrix4();
        let ae = a.m, be = b.m, te = out.m;
        let a00 = ae[0], a01 = ae[1], a02 = ae[2], a03 = ae[3];
        let a10 = ae[4], a11 = ae[5], a12 = ae[6], a13 = ae[7];
        let a20 = ae[8], a21 = ae[9], a22 = ae[10], a23 = ae[11];
        let a30 = ae[12], a31 = ae[13], a32 = ae[14], a33 = ae[15];

        let b0 = be[0], b1 = be[1], b2 = be[2], b3 = be[3];
        te[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
        te[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
        te[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
        te[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

        b0 = be[4]; b1 = be[5]; b2 = be[6]; b3 = be[7];
        te[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
        te[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
        te[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
        te[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

        b0 = be[8]; b1 = be[9]; b2 = be[10]; b3 = be[11];
        te[8] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
        te[9] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
        te[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
        te[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

        b0 = be[12]; b1 = be[13]; b2 = be[14]; b3 = be[15];
        te[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
        te[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
        te[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
        te[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
        return out;
    }

    static fromTranslation(x, y, z) {
        let mat = new Matrix4();
        mat.m[12] = x; mat.m[13] = y; mat.m[14] = z;
        return mat;
    }

    static fromRotationY(rad) {
        let mat = new Matrix4();
        let s = Math.sin(rad), c = Math.cos(rad);
        mat.m[0] = c; mat.m[2] = -s;
        mat.m[8] = s; mat.m[10] = c;
        return mat;
    }

    static fromRotationX(rad) {
        let mat = new Matrix4();
        let s = Math.sin(rad), c = Math.cos(rad);
        mat.m[5] = c; mat.m[6] = s;
        mat.m[9] = -s; mat.m[10] = c;
        return mat;
    }

    static fromRotationZ(rad) {
        let mat = new Matrix4();
        let s = Math.sin(rad), c = Math.cos(rad);
        mat.m[0] = c; mat.m[1] = s;
        mat.m[4] = -s; mat.m[5] = c;
        return mat;
    }

    static fromScaling(x, y, z) {
        let mat = new Matrix4();
        mat.m[0] = x; mat.m[5] = y; mat.m[10] = z;
        return mat;
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
        
        return mat;
    }

    static perspectiveMatrix(fovy, aspect, zNear, zFar)
    {
        let mat = new Matrix4();
        let f = 1.0 / Math.tan(fovy / 2.0);
        let nf = 1.0 / (zNear - zFar);

        mat.set(
            f / aspect, 0.0, 0.0, 0.0,
            0.0, f, 0.0, 0.0,
            0.0, 0.0, (zFar + zNear) * nf, -1.0,
            0.0, 0.0, (2.0 * zFar * zNear) * nf, 0.0
        );

        return mat;
    }
}
