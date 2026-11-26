"use strict";

/*
	2X2 ROW

	Row vectors, multiplied on the left (v * M), like Matrix3 and Matrix4.
	Rotations are right-handed: a positive angle turns counter-clockwise (y up).
	A 2x2 holds rotation, scale and shear but no translation; keep a position
	alongside it for that.

	[ 0 1 ]
	[ 2 3 ]

	A 2D vector is the row [x, y], so v * M is:
		x' = (x * m[0]) + (y * m[2])
		y' = (x * m[1]) + (y * m[3])

	A Spine bone's world (a, b, c, d) is m = [a, c, b, d].
*/
class Matrix2
{
    constructor(mat)
    {
        this.m = [0, 1, 2, 3];

        if (this.setFromArray(mat) === false)
        {
            this.identity();
        }
    }

    set(m0, m1,
        m2, m3)
    {
        this.m[0] = m0;	this.m[1] = m1;
        this.m[2] = m2;	this.m[3] = m3;
    }

    setFromArray(mat)
    {
        if (Array.isArray(mat) === true && mat.length === 4)
        {
            this.m[0] = mat[0];	this.m[1] = mat[1];
            this.m[2] = mat[2];	this.m[3] = mat[3];

            return true;
        }

        return false;
    }

    zero()
    {
        for (let i = 0; i < 4; ++i)
            this.m[i] = 0.0;
    }

    identity()
    {
        this.set(1.0, 0.0,
                 0.0, 1.0);
    }

    // Negative when the matrix flips (an odd number of negative scales); 0 when it can't be inverted
    determinant()
    {
        return (this.m[0] * this.m[3]) - (this.m[1] * this.m[2]);
    }

    transpose()
    {
        // m[0] and m[3] stay
        const t = this.m[1]; this.m[1] = this.m[2]; this.m[2] = t;
    }

    // Left unchanged when it can't be inverted (determinant near 0)
    invert()
    {
        const m = this.m;
        const det = this.determinant();

        if (Math.abs(det) < MathDefines.kEpsilon)
            return;

        const invDet = 1.0 / det;

        this.set(m[3] * invDet, -m[1] * invDet,
                 -m[2] * invDet, m[0] * invDet);
    }

    // Static Methods

    // Turns by angle (radians), counter-clockwise. A new Matrix2.
    static rotationMatrix(angle)
    {
        const mat = new Matrix2();
        const c = Math.cos(angle);
        const s = Math.sin(angle);

        mat.set(c,  s,
                -s, c);
        return mat;
    }

    // Scales by (sx, sy). A new Matrix2.
    static fromScale(sx, sy = sx)
    {
        const mat = new Matrix2();
        mat.m[0] = sx;
        mat.m[3] = sy;
        return mat;
    }

    // Shears: x moves by y * shx, and y by x * shy. A new Matrix2.
    static fromShear(shx, shy)
    {
        const mat = new Matrix2();
        mat.m[1] = shy;
        mat.m[2] = shx;
        return mat;
    }

    // b * a, like Matrix3.multiply(): with row vectors, b is applied first, then a. A new Matrix2.
    static multiply(a, b)
    {
        const out = new Matrix2();
        const ae = a.m, be = b.m, te = out.m;

        te[0] = (be[0] * ae[0]) + (be[1] * ae[2]);
        te[1] = (be[0] * ae[1]) + (be[1] * ae[3]);
        te[2] = (be[2] * ae[0]) + (be[3] * ae[2]);
        te[3] = (be[2] * ae[1]) + (be[3] * ae[3]);

        return out;
    }

    // [v.x, v.y] * mat, written into out (also returned). out may be v.
    static transformVector(mat, v, out = new Vector2())
    {
        const m = mat.m;
        const x = v.x, y = v.y;

        out.setXY((x * m[0]) + (y * m[2]),
                  (x * m[1]) + (y * m[3]));
        return out;
    }

    // Makes the rows unit length and at right angles (Gram-Schmidt), keeping row 0's direction
    static orthonormalize(mat) // (Matrix2)
    {
        const v0 = new Vector2(mat.m[0], mat.m[1]);
        const v1 = new Vector2(mat.m[2], mat.m[3]);

        v0.normalize();

        // v1 = v1 - proj_v0(v1)
        const dot01 = v0.dot(v1);
        v1.setXY(v1.x - v0.x * dot01, v1.y - v0.y * dot01);
        v1.normalize();

        mat.set(v0.x, v0.y,
                v1.x, v1.y);
    }
}
