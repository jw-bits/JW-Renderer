"use strict";
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
        let by = 0;

        switch (align)
        {
            case Alignment.kBottomLeft:
            {
                lx = x;
                by = y;
            }
            break;

            case Alignment.kMiddleLeft:
            {
                lx = x;
                by = y - (h / 2.0);
            }
            break;

            case Alignment.kTopLeft:
            {
                lx = x;
                by = y - h;     
            }
            break;

            case Alignment.kBottomCenter:
            {
                lx = x - (w / 2.0);
                by = y;
            }
            break;

            case Alignment.kMiddleCenter:
            {
                lx = x - (w / 2.0);
                by = y - (h / 2.0);               
            }
            break;

            case Alignment.kTopCenter:
            {
                lx = x - (w / 2.0);
                by = y - h;
            }
            break;

            case Alignment.kBottomRight:
            {
                lx = x - w;
                by = y;
            }
            break;

            case Alignment.kMiddleRight:
            {
                lx = x - w;
                by = y - (h / 2.0);               
            }
            break;

            case Alignment.kTopRight:
            {
                lx = x - w;
                by = y - h;
            }
            break;

            default: return false;
        }

        let rx = lx + w;
        let ty = by + h;

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