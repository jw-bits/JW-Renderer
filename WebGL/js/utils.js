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
            return ((x & (x - 1)) === 0);
    }

    static degToRad(d)
    {
        return d * (Math.PI / 180.0);
    }

    static randomFloat(minF, maxF)
    {
        let r = Math.random();
        let f = (r * (maxF - minF)) + minF;
            return f;
    }
}

class Shapes
{
    /*
        3 ----- 2
        |       |
        |       |
        0 ----- 1
    */
    static makeQuad(x, y, z, w, h, align = Alignment.kBottomLeft)
    {
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

        let pos = new Float32Array([
            lx, by, z,
            rx, by, z,
            rx, ty, z,
            lx, ty, z
        ]);

        let uvs = new Float32Array([
            0.0, 0.0,
            1.0, 0.0,
            1.0, 1.0,
            0.0, 1.0
        ]); 

        let indices = new Uint8Array([
            0, 1, 2,
            2, 3, 0
        ]);

        let mesh = new StaticMesh();
        mesh.loadVertexData(RenderAttributes.kPosition, pos);
        mesh.loadVertexData(RenderAttributes.kUV0, uvs);
        mesh.loadIndexBuffer(indices);
        return mesh;
    }

    static makeCube(size = 1.0) {
        let s = size / 2.0;
        let pos = new Float32Array([
            // Front face
            -s, -s,  s,  s, -s,  s,  s,  s,  s, -s,  s,  s,
            // Back face
            -s, -s, -s, -s,  s, -s,  s,  s, -s,  s, -s, -s,
            // Top face
            -s,  s, -s, -s,  s,  s,  s,  s,  s,  s,  s, -s,
            // Bottom face
            -s, -s, -s,  s, -s, -s,  s, -s,  s, -s, -s,  s,
            // Right face
             s, -s, -s,  s,  s, -s,  s,  s,  s,  s, -s,  s,
            // Left face
            -s, -s, -s, -s, -s,  s, -s,  s,  s, -s,  s, -s,
        ]);

        let uvs = new Float32Array([
            0,0, 1,0, 1,1, 0,1,
            1,0, 1,1, 0,1, 0,0,
            0,1, 0,0, 1,0, 1,1,
            1,1, 0,1, 0,0, 1,0,
            1,0, 1,1, 0,1, 0,0,
            0,0, 1,0, 1,1, 0,1,
        ]);

        let indices = new Uint8Array([
            0,  1,  2,      0,  2,  3,    // front
            4,  5,  6,      4,  6,  7,    // back
            8,  9,  10,     8,  10, 11,   // top
            12, 13, 14,     12, 14, 15,   // bottom
            16, 17, 18,     16, 18, 19,   // right
            20, 21, 22,     20, 22, 23,   // left
        ]);

        let mesh = new StaticMesh();
        mesh.setVertexData(RenderAttributes.kPosition, pos);
        mesh.setVertexData(RenderAttributes.kUV0, uvs);
        mesh.setIndexData(indices);
        return mesh;
    }
}