"use strict";

/*
    A 2D rectangle of UV coordinates, normalized from 0 to 1.
    V runs up, matching Shapes.makeQuad: (0,0) is the bottom-left of the
    texture and (1,1) the top-right. (x, y) is the rectangle's bottom-left.

        (x, y + h) ------- (x + w, y + h)
            |                    |
          (x, y) --------- (x + w, y)

    Values are clamped to 0..1.
*/
class UVRect
{
    #x;
    #y;
    #width;
    #height;

    constructor(_x = 0.0, _y = 0.0, _width = 1.0, _height = 1.0)
    {
        this.#x = 0.0;
        this.#y = 0.0;
        this.#width = 1.0;
        this.#height = 1.0;
        this.set(_x, _y, _width, _height);
    }

    // (x, y) is the bottom-left corner
    set(x, y, width, height)
    {
        const left = UVRect.#clamp01(x);
        const bottom = UVRect.#clamp01(y);
        const right = UVRect.#clamp01(x + width);
        const top = UVRect.#clamp01(y + height);

        this.#x = Math.min(left, right);
        this.#y = Math.min(bottom, top);
        this.#width = Math.abs(right - left);
        this.#height = Math.abs(top - bottom);
            return this;
    }

    // Top-left and bottom-right corners; with V up, tly is the larger V
    setCorners(tlx, tly, brx, bry)
    {
        return this.set(tlx, bry, brx - tlx, tly - bry);
    }

    getX() { return this.#x; }
    getY() { return this.#y; }
    getWidth() { return this.#width; }
    getHeight() { return this.#height; }

    getLeft() { return this.#x; }
    getRight() { return this.#x + this.#width; }
    getBottom() { return this.#y; }
    getTop() { return this.#y + this.#height; }

    // *** Internal Methods ***

    static #clamp01(v)
    {
        return Math.min(1.0, Math.max(0.0, v));
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
        mesh.setVertexData(RenderAttributes.kPosition, pos);
        mesh.setVertexData(RenderAttributes.kUV0, uvs);
        mesh.setIndexData(indices);
        return mesh;
    }

    /*
        Rounded rectangle with its bottom-left corner at (x, y), built as a
        triangle fan: one center vertex plus the perimeter, where each corner
        is an arc of (segments + 1) vertices. UVs map the bounds to 0..1.
    */
    static makeRoundedRect(x, y, z, w, h, radius, segments = 8)
    {
        const r = Math.max(0, Math.min(radius, w / 2.0, h / 2.0));
        const seg = Math.max(1, Math.floor(segments));
        const perCorner = seg + 1;
        const perimCount = perCorner * 4;
        const vertCount = perimCount + 1;

        let pos = new Float32Array(vertCount * 3);
        let uvs = new Float32Array(vertCount * 2);

        const setVert = (i, vx, vy) =>
        {
            pos[(i * 3) + 0] = vx;
            pos[(i * 3) + 1] = vy;
            pos[(i * 3) + 2] = z;
            uvs[(i * 2) + 0] = (vx - x) / w;
            uvs[(i * 2) + 1] = (vy - y) / h;
        };

        // Center
        setVert(0, x + (w / 2.0), y + (h / 2.0));

        // Corner arc centers, counter-clockwise starting bottom-right
        const corners = [
            { cx: x + w - r, cy: y + r,     start: -Math.PI / 2.0 }, // Bottom right
            { cx: x + w - r, cy: y + h - r, start: 0.0 },            // Top right
            { cx: x + r,     cy: y + h - r, start: Math.PI / 2.0 },  // Top left
            { cx: x + r,     cy: y + r,     start: Math.PI }         // Bottom left
        ];

        let v = 1;
        for (const c of corners)
        {
            for (let i = 0; i <= seg; ++i)
            {
                const a = c.start + ((i / seg) * (Math.PI / 2.0));
                setVert(v++, c.cx + (Math.cos(a) * r), c.cy + (Math.sin(a) * r));
            }
        }

        // Match IndexBuffer's type selection (it picks the GL type from the index count)
        const indexCount = perimCount * 3;
        let indices = (indexCount < 256) ? new Uint8Array(indexCount) : new Uint16Array(indexCount);

        for (let i = 0; i < perimCount; ++i)
        {
            indices[(i * 3) + 0] = 0;
            indices[(i * 3) + 1] = 1 + i;
            indices[(i * 3) + 2] = 1 + ((i + 1) % perimCount);
        }

        let mesh = new StaticMesh();
        mesh.setVertexData(RenderAttributes.kPosition, pos);
        mesh.setVertexData(RenderAttributes.kUV0, uvs);
        mesh.setIndexData(indices);
        return mesh;
    }

    /*
        Nine-slice mesh with its bottom-left corner at (x, y): a 4x4 grid of
        vertices making 3x3 quads.

        xs / ys are the 4 vertex positions along each axis (left to right,
        bottom to top). us / vs are the 4 matching texture coordinates.

          12 -- 13 -- 14 -- 15
           | 7  |  8  |  9  |
           8 --- 9 -- 10 -- 11
           | 4  |  5  |  6  |
           4 --- 5 --- 6 --- 7
           | 1  |  2  |  3  |
           0 --- 1 --- 2 --- 3
    */
    static makeNinePatch(z, xs, ys, us, vs)
    {
        let pos = new Float32Array(16 * 3);
        let uvs = new Float32Array(16 * 2);

        for (let row = 0; row < 4; ++row)
        {
            for (let col = 0; col < 4; ++col)
            {
                const i = (row * 4) + col;
                pos[(i * 3) + 0] = xs[col];
                pos[(i * 3) + 1] = ys[row];
                pos[(i * 3) + 2] = z;
                uvs[(i * 2) + 0] = us[col];
                uvs[(i * 2) + 1] = vs[row];
            }
        }

        let indices = new Uint8Array(9 * 6);
        let n = 0;

        for (let row = 0; row < 3; ++row)
        {
            for (let col = 0; col < 3; ++col)
            {
                const bl = (row * 4) + col;
                const br = bl + 1;
                const tl = bl + 4;
                const tr = tl + 1;

                indices[n++] = bl; indices[n++] = br; indices[n++] = tr;
                indices[n++] = tr; indices[n++] = tl; indices[n++] = bl;
            }
        }

        let mesh = new StaticMesh();
        mesh.setVertexData(RenderAttributes.kPosition, pos);
        mesh.setVertexData(RenderAttributes.kUV0, uvs);
        mesh.setIndexData(indices);
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
