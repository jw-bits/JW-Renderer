"use strict";

/*

 +Y
  |
  |
  |
(0,0)----+X

*/
class Alignment
{
    static kBottomLeft = 0;
    static kMiddleLeft = 1;
    static kTopLeft = 2;

    static kBottomCenter = 3;
    static kMiddleCenter = 4;
    static kTopCenter = 5;

    static kBottomRight = 6;
    static kMiddleRight = 7;
    static kTopRight = 8;
}

class Util
{
    static isPowerOfTwo(x)
    {
        if (Number.isInteger(x) === false)
            return false;
        else if (x <= 0)
            return false; // Only check positive numbers
        else
            ((x & (x - 1)) === 0);
    }

    static degToRad(d)
    {
        return d * (Math.PI / 180.0);
    }
}

class Shapes
{
    static pos = [];
    static normals = [];
    static uvs = [];
    static vertexCount = 0;

    static indices = [];
    static indexCount = 0;

    /*
        3 ----- 2
        |       |
        |       |
        0 ----- 1
    */
    static makeQuad(x, y, z, w, h, align = Alignment.kBottomLeft)
    {
        Shapes.clearData();

        let lx = 0;
        let rx = 0;
        let ty = 0;
        let by = 0;

        switch (align)
        {
            case Alignment.kBottomLeft:
            {
                lx = x;
                rx = x + w;
                ty = y + h;
                by = y;
            }
            break;

            case Alignment.kMiddleLeft:
            {
                lx = x;
                rx = x + w;
                by = y - (h / 2.0);
                ty = by + h;                
            }
            break;

            case Alignment.kTopLeft:
            {
                lx = x;
                rx = x + w;
                ty = y;
                by = y - h;
                                
            }
            break;

            default: return false;
        }

        Shapes.vertexCount = 4;
        Shapes.pos = new Float32Array([
            lx, by, z,
            rx, by, z,
            rx, ty, z,
            lx, ty, z
        ]);

        Shapes.uvs = new Float32Array([
            0.0, 0.0,
            1.0, 0.0,
            1.0, 1.0,
            0.0, 1.0
        ]); 

        Shapes.indexCount = 6;
        Shapes.indices = new Uint8Array([
            0, 1, 2,
            2, 3, 0
        ]);

        return true;
    }

    static clearData()
    {
        Shapes.pos.length = 0;
        Shapes.normals.length = 0;
        Shapes.uvs.length = 0;
        Shapes.vertexCount = 0;

        Shapes.indices.length = 0;
        Shapes.indexCount = 0;
    }
}