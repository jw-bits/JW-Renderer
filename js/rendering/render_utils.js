"use strict";

/*
    A 2D rectangle of UV coordinates, normalized from 0 to 1.
    V runs up, matching Shapes.makeQuad: (0,0) is the bottom-left of the
    texture and (1,1) the top-right. (x, y) is the rectangle's bottom-left.

        (x, y + h) ------- (x + w, y + h)
            |                    |
          (x, y) --------- (x + w, y)

    Values are clamped to 0..1, except through setUnclamped(), which is for
    tiling and scrolling a repeating texture (see Rect2D.setUVTile()).

    UVRect.kFull is the whole texture (0, 0, 1, 1), shared: read it, copy
    it, but don't change it.
*/
class UVRect
{
    static kFull = new UVRect();

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
        const left = MathUtil.clamp01(x);
        const bottom = MathUtil.clamp01(y);
        const right = MathUtil.clamp01(x + width);
        const top = MathUtil.clamp01(y + height);

        this.#x = Math.min(left, right);
        this.#y = Math.min(bottom, top);
        this.#width = Math.abs(right - left);
        this.#height = Math.abs(top - bottom);
            return this;
    }

    /*
        As given, without clamping: (x, y) is an offset and (width, height) how
        many times the texture repeats across the rect. Outside 0..1 the
        texture's Sampler must wrap with REPEAT or MIRRORED_REPEAT.
    */
    setUnclamped(x, y, width, height)
    {
        this.#x = x;
        this.#y = y;
        this.#width = width;
        this.#height = height;
            return this;
    }

    copy(other)
    {
        this.#x = other.getX();
        this.#y = other.getY();
        this.#width = other.getWidth();
        this.#height = other.getHeight();
            return this;
    }

    equals(other)
    {
        return (this.#x === other.getX() && this.#y === other.getY() && this.#width === other.getWidth() && this.#height === other.getHeight());
    }

    getX() { return this.#x; }
    getY() { return this.#y; }
    getWidth() { return this.#width; }
    getHeight() { return this.#height; }

    getLeft() { return this.#x; }
    getRight() { return this.#x + this.#width; }
    getBottom() { return this.#y; }
    getTop() { return this.#y + this.#height; }

    /*
        Converts a rect in texture pixels to a UVRect, written into out (also returned).

        origin is the Alignment of pixel (0, 0) on the texture:
            Alignment.kTopLeft     Image editors and atlas tools: x right, y down (the default)
            Alignment.kBottomLeft  GL style: x right, y up
            Others                 x runs away from a right edge (else right); y runs down
                                   from a top edge (else up); center / middle put the
                                   origin halfway across
        (x, y) is the rect's corner nearest the origin, and it extends width / height
        along those directions. Values outside the texture are clamped to it.

        V runs up to match textures uploaded with flipY (Texture's default), so
        pixel rects measured from an image's top-left convert correctly.

        Returns null (with a console.error) if the texture size or origin isn't valid.
    */
    static pixelsToUVRect(x, y, width, height, texWidth, texHeight, origin = Alignment.kTopLeft, out = new UVRect())
    {
        const o = UVRect.#getOrigin(texWidth, texHeight, origin, "pixelsToUVRect");

        if (o === null)
            return null;

        const left = o.xRunsRight ? (o.x + x) : (o.x - x - width);
        const bottom = o.yRunsUp ? (o.y + y) : (o.y - y - height);

        return out.set(left / texWidth, bottom / texHeight, width / texWidth, height / texHeight);
    }

    /*
        Converts a UVRect to texture pixels, as pixelsToUVRect() takes them: written
        into out as (x, y, width, height) and returned. Returns null (with a
        console.error) if the texture size or origin isn't valid.
    */
    static uvRectToPixels(uvRect, texWidth, texHeight, origin = Alignment.kTopLeft, out = new Vector4())
    {
        const o = UVRect.#getOrigin(texWidth, texHeight, origin, "uvRectToPixels");

        if (o === null)
            return null;

        const left = uvRect.getX() * texWidth;
        const bottom = uvRect.getY() * texHeight;
        const width = uvRect.getWidth() * texWidth;
        const height = uvRect.getHeight() * texHeight;

        const x = o.xRunsRight ? (left - o.x) : (o.x - left - width);
        const y = o.yRunsUp ? (bottom - o.y) : (o.y - bottom - height);

        out.set(x, y, width, height);
            return out;
    }

    // *** Internal Methods ***

    // Where pixel (0, 0) sits, in pixels from the bottom-left, and which way x and y run from it
    static #getOrigin(texWidth, texHeight, origin, method)
    {
        if (!(texWidth > 0) || !(texHeight > 0))
        {
            console.error(`UVRect.${method}() needs a texture width and height above 0`);
                return null;
        }

        if (Alignment.isValid(origin) === false)
        {
            console.error(`UVRect.${method}(): origin must be an Alignment`);
                return null;
        }

        const col = Alignment.getColumn(origin);
        const row = Alignment.getRow(origin);

        return {
            x: col * (texWidth / 2.0),
            y: row * (texHeight / 2.0),
            xRunsRight: (col !== 2),
            yRunsUp: (row !== 2)
        };
    }

    static
    {
        Object.defineProperty(UVRect, "kFull", { writable: false, configurable: false });
    }
}

/*
    Shapes - StaticMeshes of common shapes, with positions and UVs. Call
    bindAttribs() on a mesh before drawing it; Shapes doesn't.

    Each shape comes two ways, and the name says which space it's in:
        makeQuad(), makeRoundedRect(), makeNinePatch()
            Positions in design units (see WGLV)
        makeUnitQuad(), makeUnitRoundedRect(), makeUnitNinePatch()
            Positions in 0..1 of the shape's bounds: what Model2D's shaders take,
            scaling them by the model's size (u_vec0). Built in design units
            first, so a shape whose look depends on its size (rounded corners,
            nine-patch borders) still takes that size.

    UVs are the same either way.
*/
class Shapes
{
    /*
        3 ----- 2
        |       |
        |       |
        0 ----- 1
    */
    // In design units: (x, y) is the point the quad is aligned on. Returns null if align isn't an Alignment.
    static makeQuad(x, y, z, w, h, align = Alignment.kBottomLeft)
    {
        if (Alignment.isValid(align) === false)
            return null;

        return Shapes.#makeMesh(Shapes.#quadData(x + Alignment.offsetX(align, w), y + Alignment.offsetY(align, h), z, w, h));
    }

    // The (0, 0) - (1, 1) quad, for Model2D's shaders
    static makeUnitQuad()
    {
        return Shapes.#makeMesh(Shapes.#quadData(0.0, 0.0, 0.0, 1.0, 1.0));
    }

    /*
        In design units: a rounded rectangle with its bottom-left corner at (x, y),
        built as a triangle fan: one center vertex plus the perimeter, where each
        corner is an arc of (segments + 1) vertices. radius is clamped to half the
        shortest side. UVs map the bounds to 0..1.
    */
    static makeRoundedRect(x, y, z, w, h, radius, segments = 8)
    {
        return Shapes.#makeMesh(Shapes.#roundedRectData(x, y, z, w, h, radius, segments));
    }

    /*
        makeRoundedRect() for Model2D's shaders: w x h design units (the corners are
        round at that size), with positions in 0..1 of it. Returns null if the size
        isn't above 0.
    */
    static makeUnitRoundedRect(w, h, radius, segments = 8)
    {
        if (Shapes.#isValidSize(w, h, "makeUnitRoundedRect") === false)
            return null;

        let d = Shapes.#roundedRectData(0.0, 0.0, 0.0, w, h, radius, segments);
        Shapes.#toUnit(d.pos, w, h);
            return Shapes.#makeMesh(d);
    }

    /*
        In design units: a nine-slice mesh, a 4x4 grid of vertices making 3x3 quads.

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
        return Shapes.#makeMesh(Shapes.#ninePatchData(z, xs, ys, us, vs));
    }

    /*
        makeNinePatch() for Model2D's shaders: xs / ys are in design units, from 0 to
        w / h (the borders keep their size in them), and the positions end up in 0..1
        of w x h. Returns null if the size isn't above 0.
    */
    static makeUnitNinePatch(w, h, xs, ys, us, vs)
    {
        if (Shapes.#isValidSize(w, h, "makeUnitNinePatch") === false)
            return null;

        let d = Shapes.#ninePatchData(0.0, xs, ys, us, vs);
        Shapes.#toUnit(d.pos, w, h);
            return Shapes.#makeMesh(d);
    }

    // *** Internal Methods ***

    // A StaticMesh from { pos, uvs, indices }
    static #makeMesh(d)
    {
        let mesh = new StaticMesh();
        mesh.setVertexData(RenderAttributes.kPosition, d.pos);
        mesh.setVertexData(RenderAttributes.kUV0, d.uvs);
        mesh.setIndexData(d.indices);
            return mesh;
    }

    // Design-unit positions (x, y, z per vertex) of a shape at the origin, divided by its size: 0..1 of its bounds
    static #toUnit(pos, w, h)
    {
        for (let i = 0; i < pos.length; i += 3)
        {
            pos[i] /= w;
            pos[i + 1] /= h;
        }
    }

    static #isValidSize(w, h, method)
    {
        if (!(w > 0) || !(h > 0) || Number.isFinite(w) === false || Number.isFinite(h) === false)
        {
            console.error(`Shapes.${method}() needs a width and height above 0`);
                return false;
        }

        return true;
    }

    // A quad with its bottom-left corner at (x, y)
    static #quadData(x, y, z, w, h)
    {
        const rx = x + w;
        const ty = y + h;

        let pos = new Float32Array([
            x,  y,  z,
            rx, y,  z,
            rx, ty, z,
            x,  ty, z
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

        return { pos, uvs, indices };
    }

    // See makeRoundedRect()
    static #roundedRectData(x, y, z, w, h, radius, segments)
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
            { cx: x + w - r, cy: y + r,     start: -MathDefines.kHalfPi }, // Bottom right
            { cx: x + w - r, cy: y + h - r, start: 0.0 },                  // Top right
            { cx: x + r,     cy: y + h - r, start: MathDefines.kHalfPi },  // Top left
            { cx: x + r,     cy: y + r,     start: MathDefines.kPi }       // Bottom left
        ];

        let v = 1;
        for (const c of corners)
        {
            for (let i = 0; i <= seg; ++i)
            {
                const a = c.start + ((i / seg) * MathDefines.kHalfPi);
                setVert(v++, c.cx + (Math.cos(a) * r), c.cy + (Math.sin(a) * r));
            }
        }

        // Bytes while every vertex index fits in one (IndexBuffer takes the GL type from the array)
        const indexCount = perimCount * 3;
        let indices = (vertCount <= 256) ? new Uint8Array(indexCount) : new Uint16Array(indexCount);

        for (let i = 0; i < perimCount; ++i)
        {
            indices[(i * 3) + 0] = 0;
            indices[(i * 3) + 1] = 1 + i;
            indices[(i * 3) + 2] = 1 + ((i + 1) % perimCount);
        }

        return { pos, uvs, indices };
    }

    // See makeNinePatch()
    static #ninePatchData(z, xs, ys, us, vs)
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

        return { pos, uvs, indices };
    }
}

/*
    RenderState - The GL state the renderer sets, remembered so it's only sent
    when it changes:

        Blend mode  setBlendMode(), see BlendMode
        Scissor     setScissor(rect) turns the scissor test on and clips to rect, in the
                    surface's pixels ({ x, y, w, h }, bottom-left origin); setScissor(null)
                    turns it off. ClipSpace sets it for clip rects and camera viewports.
                    Something that needs it off for a moment (a clear, a blit) saves it
                    with getScissor(), turns it off and puts it back with setScissor(saved).

    Fixed state the 2D renderer never changes (depth test, face culling and
    stencil test off, every color channel written) is set by applyDefaults(),
    which WGLV calls when the context is made and when it comes back after
    being lost. Anything that changes it (a debug pass) must put it back.

    Anything that changes the remembered state with the GL directly (e.g.
    gl.disable(gl.BLEND)) should call invalidate() afterwards, so the next set
    sends it again.

    getChangeCount() counts the GL calls it has sent, for metrics.
*/
class RenderState
{
    static #blendMode = -1;     // -1: unknown, the next setBlendMode() sends it
    static #scissorOn = -1;     // -1: unknown, 0: off, 1: on
    static #scissorRect = { x: 0, y: 0, w: -1, h: -1 }; // w -1: unknown
    static #changes = 0;        // GL calls sent, ever

    // Returns false (changing nothing) if mode isn't a BlendMode
    static setBlendMode(mode)
    {
        if (mode === RenderState.#blendMode)
            return true;

        const gl = WGLV.context;

        switch (mode)
        {
            case BlendMode.kAlpha:
                gl.enable(gl.BLEND);
                gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
                break;

            case BlendMode.kPremultiplied:
                gl.enable(gl.BLEND);
                gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
                break;

            case BlendMode.kAdditive:
                gl.enable(gl.BLEND);
                gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ZERO, gl.ONE);
                break;

            case BlendMode.kMultiply:
                // color: src * dst + dst * (1 - srcA). With a premultiplied src (rgb * a) that's
                // dst * lerp(1, rgb, a): transparent texels change nothing, soft edges fade out.
                // A straight-alpha src brightens where it's partly see-through (white at a 0.5
                // gives dst * 1.5), so the shader or texture must give premultiplied color.
                // alpha: dst alpha is kept; multiplying it would cut holes in a RenderTarget.
                gl.enable(gl.BLEND);
                gl.blendFuncSeparate(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
                break;

            case BlendMode.kNone:
                gl.disable(gl.BLEND);
                break;

            default:
                console.error("RenderState.setBlendMode() needs a BlendMode such as BlendMode.kAlpha");
                    return false;
        }

        RenderState.#changes += (mode === BlendMode.kNone) ? 1 : 2;
        RenderState.#blendMode = mode;
            return true;
    }

    // The last mode set, or -1 if it's unknown (after invalidate())
    static getBlendMode() { return RenderState.#blendMode; }

    /*
        Clips drawing to rect ({ x, y, w, h } in the surface's pixels, bottom-left
        origin), or turns clipping off with null. Sends only what changed.
    */
    static setScissor(rect)
    {
        const gl = WGLV.context;

        if (gl === null)
            return;

        if (rect === null)
        {
            if (RenderState.#scissorOn !== 0)
            {
                gl.disable(gl.SCISSOR_TEST);
                RenderState.#scissorOn = 0;
                ++RenderState.#changes;
            }

            return;
        }

        if (RenderState.#scissorOn !== 1)
        {
            gl.enable(gl.SCISSOR_TEST);
            RenderState.#scissorOn = 1;
            ++RenderState.#changes;
        }

        let s = RenderState.#scissorRect;

        if (rect.x !== s.x || rect.y !== s.y || rect.w !== s.w || rect.h !== s.h)
        {
            gl.scissor(rect.x, rect.y, rect.w, rect.h);
            s.x = rect.x;
            s.y = rect.y;
            s.w = rect.w;
            s.h = rect.h;
            ++RenderState.#changes;
        }
    }

    // The scissor now, as a new { x, y, w, h } to give back to setScissor() later, or null while it's off (or unknown)
    static getScissor()
    {
        if (RenderState.#scissorOn !== 1)
            return null;

        const s = RenderState.#scissorRect;
            return { x: s.x, y: s.y, w: s.w, h: s.h };
    }

    /*
        Sets the state the 2D renderer never changes: depth test, face culling and
        stencil test off, every color channel written. Forgets everything remembered
        (invalidate()), then turns the scissor test off. WGLV calls it when the context
        is made and when it comes back after being lost.
    */
    static applyDefaults()
    {
        const gl = WGLV.context;

        if (gl === null)
            return;

        RenderState.invalidate();

        gl.disable(gl.DEPTH_TEST); // No depth buffer: 2D draws in layer order
        gl.disable(gl.CULL_FACE);
        gl.disable(gl.STENCIL_TEST);
        gl.colorMask(true, true, true, true);
        RenderState.#changes += 4;

        RenderState.setScissor(null);
    }

    // Forgets what was set, so everything is sent again; after changing GL state directly, or a lost context
    static invalidate()
    {
        RenderState.#blendMode = -1;
        RenderState.#scissorOn = -1;
        RenderState.#scissorRect.w = -1;
    }

    // GL state calls sent since the page loaded; take the difference between two calls for a frame's
    static getChangeCount() { return RenderState.#changes; }
}

/*
    ClipSpace - How design units reach the GL's clip space, and what is clipped.

    Camera: setCamera(camera) draws the world through a Camera2D from then on;
    setCamera(null) draws in screen design units again (the world is the
    screen). The active camera's world-to-clip matrix is in the Frame uniform
    block (see RenderUniformBlocks), uploaded once when the camera changes, so
    every shader reads it without per-draw uniforms. A camera with a viewport
    also clips drawing to it. Batcher sets the camera for each layer.

    Clipping: pushClipRect(x, y, width, height) limits drawing to a rect in
    screen design units (the GL scissor test) until the matching
    popClipRect(). Clip rects nest: each one is cut down to the one it's
    inside, and to the active camera's viewport. Only what's drawn while it's
    pushed is clipped, so with a Batcher push and pop inside something
    drawn from the batcher (see submitDrawable()), not around submit().

    The Frame block is created and given the screen mapping by WGLV.init()
    (uploadBuffer()), so drawing works without a camera or beginFrame(), and
    shaders loaded before any camera read it too. beginFrame() resets the
    per-frame state.

    Surfaces: drawing goes to the canvas or to a RenderTarget (see
    RenderTargets in render_target.js). Each surface has a design area (the
    whole design resolution on the canvas, the target's design rect in a
    target) that ClipSpace maps onto its pixels: the camera's world-to-screen
    matrix is taken on to the surface's clip space, and clip rects and camera
    viewports to its pixels. RenderTargets saves ClipSpace's state on push()
    (saveState()), starts the target clean (resetState()) and puts it back on
    pop() (restoreState()).

    Each frame, after WGLV.beginFrame():
        ClipSpace.beginFrame(); // No clip rects, no camera

        ClipSpace.pushClipRect(100, 200, 400, 80);
        model.render(transform);
        ClipSpace.popClipRect();
*/
class ClipSpace
{
    // Frame block, std140: mat3 u_worldToClip (3 columns of 4 floats), vec2 u_res, 2 unused
    static #kFrameFloats = 16;

    static #frame = null;       // UniformBuffer, made on first use
    static #frameData = new Float32Array(ClipSpace.#kFrameFloats);
    static #camera = null;      // Active Camera2D, or null for the screen
    static #uploadedVersion = -1;
    static #uploadedSurface = new Vector4(); // The surface design area it was uploaded for
    static #isUploaded = false;

    static #clipStack = [];     // Pushed clip rects in the surface's pixels: { x, y, w, h }, innermost last

    static #kIdentity = [1, 0, 0, 0, 1, 0, 0, 0, 1];

    // Scratch, one per use so they never overwrite each other
    static #kViewport = new Vector4();
    static #kSurface = new Vector4();
    static #kScaleRect = new Vector4();
    static #kPixelRect = new Vector4();

    /*
        Back to the canvas (popping any RenderTargets left pushed), with no clip rects
        and no camera. Call each frame after WGLV.beginFrame().
    */
    static beginFrame()
    {
        RenderTargets.beginFrame();

        if (ClipSpace.#clipStack.length > 0)
        {
            console.error(`ClipSpace.beginFrame(): ${ClipSpace.#clipStack.length} clip rect(s) were never popped`);
            ClipSpace.#clipStack.length = 0;
        }

        ClipSpace.setCamera(null);
        ClipSpace.#applyClip();
    }

    /*
        Draws through camera (a Camera2D) from now on, or in screen design units with
        null. Call again after changing the camera; it uploads only if something changed.
    */
    static setCamera(camera)
    {
        if (camera !== null && (camera instanceof Camera2D) === false)
        {
            console.error("ClipSpace.setCamera() needs a Camera2D or null");
                return false;
        }

        if (ClipSpace.#ensureFrame() === false)
            return false;

        const s = ClipSpace.getSurfaceRect(ClipSpace.#kSurface);
        const u = ClipSpace.#uploadedSurface;
        const isSameSurface = (s.x === u.x && s.y === u.y && s.z === u.z && s.w === u.w);
        const version = (camera !== null) ? camera.getVersion() : -1;
        const viewportChanged = (camera !== ClipSpace.#camera || (camera !== null && version !== ClipSpace.#uploadedVersion) || isSameSurface === false);

        if (ClipSpace.#isUploaded === true && camera === ClipSpace.#camera && version === ClipSpace.#uploadedVersion && isSameSurface === true)
            return true; // Already there

        // World to screen design units (the camera's, or the same units with none), then on to the surface's clip space
        let d = ClipSpace.#frameData;
        const m = (camera !== null) ? camera.getWorldToScreen().m : ClipSpace.#kIdentity;

        ClipSpace.#writeMatrix(d, m, s);
        d[12] = s.z;
        d[13] = s.w;
        ClipSpace.#frame.update(d);

        ClipSpace.#camera = camera;
        ClipSpace.#uploadedVersion = version;
        u.set(s.x, s.y, s.z, s.w);
        ClipSpace.#isUploaded = true;

        if (viewportChanged === true)
            ClipSpace.#applyClip(); // A camera viewport clips too

        return true;
    }

    // The active Camera2D, or null for the screen
    static getCamera() { return ClipSpace.#camera; }

    // The design area of the surface being drawn, written into out (a Vector4: x, y, width, height) and returned
    static getSurfaceRect(out = new Vector4())
    {
        const target = RenderTargets.getCurrent();

        if (target !== null)
            return target.getDesignRect(out);

        out.set(0, 0, WGLV.getWidth(), WGLV.getHeight());
            return out;
    }

    // Device pixels per design unit on the surface being drawn, across (the view scale on the canvas)
    static getSurfaceScale()
    {
        const target = RenderTargets.getCurrent();

        if (target === null)
            return WGLV.getViewScale();

        return target.getWidth() / target.getDesignRect(ClipSpace.#kScaleRect).z;
    }

    // A rect in screen design units in the surface's pixels ({ x, y, w, h }, rounded outward), e.g. for a GL viewport
    static toPixelRect(x, y, width, height) { return ClipSpace.#toPixels(x, y, width, height); }

    // *** For RenderTargets ***

    // The camera and clip rects, to put back with restoreState()
    static saveState() { return { camera: ClipSpace.#camera, clips: ClipSpace.#clipStack.slice() }; }

    // No camera and no clip rects, on the surface now being drawn
    static resetState()
    {
        ClipSpace.#clipStack.length = 0;
        ClipSpace.setCamera(null);
        ClipSpace.#applyClip();
    }

    // Back to a saveState(), on the surface now being drawn
    static restoreState(state)
    {
        ClipSpace.#clipStack = state.clips.slice();
        ClipSpace.setCamera(state.camera);
        ClipSpace.#applyClip();
    }

    /*
        The Frame block's buffer provider (see RenderUniformBlocks), called by WGLV.init():
        the first time, creates the buffer and sends the active camera's mapping (the
        screen until a camera is set) to the Frame binding point; afterwards returns
        right away. So models draw in screen design units even before any setCamera()
        or beginFrame().
    */
    static uploadBuffer()
    {
        if (ClipSpace.#isUploaded === true)
            return true;

        return ClipSpace.setCamera(ClipSpace.#camera);
    }

    /*
        Limits drawing to a rect in screen design units ((x, y) its bottom-left), cut
        down to any clip rect already pushed (or the camera's viewport), until
        popClipRect(). Returns false (pushing nothing) if the size isn't valid.
    */
    static pushClipRect(x, y, width, height)
    {
        if (WGLV.context === null)
            return false;

        if (Number.isFinite(x) === false || Number.isFinite(y) === false || Number.isFinite(width) === false || Number.isFinite(height) === false || width < 0 || height < 0)
        {
            console.error("ClipSpace.pushClipRect() needs a position and a size of 0 or more");
                return false;
        }

        const outer = (ClipSpace.#clipStack.length > 0) ? ClipSpace.#clipStack[ClipSpace.#clipStack.length - 1] : ClipSpace.#getBaseRect();
        const r = ClipSpace.#toPixels(x, y, width, height);

        const left = Math.max(r.x, outer.x);
        const bottom = Math.max(r.y, outer.y);
        const right = Math.min(r.x + r.w, outer.x + outer.w);
        const top = Math.min(r.y + r.h, outer.y + outer.h);

        ClipSpace.#clipStack.push({ x: left, y: bottom, w: Math.max(0, right - left), h: Math.max(0, top - bottom) });
        ClipSpace.#applyClip();
            return true;
    }

    // Removes the last pushed clip rect; the one before it (or none) applies again
    static popClipRect()
    {
        if (ClipSpace.#clipStack.length === 0)
        {
            console.error("ClipSpace.popClipRect() without a pushClipRect()");
                return;
        }

        ClipSpace.#clipStack.pop();
        ClipSpace.#applyClip();
    }

    // Clip rects pushed and not yet popped
    static getClipDepth() { return ClipSpace.#clipStack.length; }

    // Frees the Frame block's buffer; the next setCamera() or beginFrame() makes it again
    static unload()
    {
        if (ClipSpace.#frame !== null)
            ClipSpace.#frame.unload();

        ClipSpace.#frame = null;
        ClipSpace.#camera = null;
        ClipSpace.#isUploaded = false;
        ClipSpace.#uploadedSurface.set(0, 0, 0, 0);
        ClipSpace.#clipStack.length = 0;
    }

    // *** Internal Methods ***

    static #ensureFrame()
    {
        if (ClipSpace.#frame !== null)
            return true;

        if (WGLV.context === null)
        {
            console.error("ClipSpace needs WGLV.init() first");
                return false;
        }

        let frame = new UniformBuffer();

        if (frame.load(RenderUniformBlocks.kFrame, ClipSpace.#kFrameFloats) === false)
            return false;

        ClipSpace.#frame = frame;
        ClipSpace.#isUploaded = false;
            return true;
    }

    /*
        A row-major world-to-screen Matrix3 m (its 9 values), taken on to clip space for the
        surface design area s (screen (s.x, s.y) - (s.x + s.z, s.y + s.w) to (-1, -1) - (1, 1)),
        written as the std140 mat3's columns: its rows become GLSL's columns, so GLSL works
        out [x, y, 1] * M.
    */
    static #writeMatrix(d, m, s)
    {
        const ax = 2.0 / s.z;
        const ay = 2.0 / s.w;
        const bx = -1.0 - (s.x * ax);
        const by = -1.0 - (s.y * ay);

        for (let row = 0; row < 3; ++row)
        {
            const i = row * 3;
            const o = row * 4;
            const w = m[i + 2];

            d[o] = (m[i] * ax) + (bx * w);
            d[o + 1] = (m[i + 1] * ay) + (by * w);
            d[o + 2] = w;
            d[o + 3] = 0.0;
        }
    }

    // A rect in screen design units, in the surface's pixels, rounded outward so edges in between pixels aren't lost
    static #toPixels(x, y, width, height)
    {
        const target = RenderTargets.getCurrent();
        let ox = 0.0; // The design area's bottom-left, in pixels
        let oy = 0.0;
        let sx = 0.0; // Pixels per design unit
        let sy = 0.0;
        let dx = 0.0; // The design area's bottom-left, in design units
        let dy = 0.0;

        if (target === null)
        {
            ox = WGLV.getViewportX();
            oy = WGLV.getViewportY();
            sx = WGLV.getViewScale();
            sy = sx;
        }
        else
        {
            const r = target.getDesignRect(ClipSpace.#kPixelRect);
            sx = target.getWidth() / r.z;
            sy = target.getHeight() / r.w;
            dx = r.x;
            dy = r.y;
        }

        const left = Math.floor(ox + ((x - dx) * sx));
        const bottom = Math.floor(oy + ((y - dy) * sy));
        const right = Math.ceil(ox + ((x + width - dx) * sx));
        const top = Math.ceil(oy + ((y + height - dy) * sy));

        return { x: left, y: bottom, w: right - left, h: top - bottom };
    }

    // All of the surface being drawn, in its pixels: the canvas's view, or the whole target
    static #getSurfacePixels()
    {
        const target = RenderTargets.getCurrent();

        if (target !== null)
            return { x: 0, y: 0, w: target.getWidth(), h: target.getHeight() };

        return { x: WGLV.getViewportX(), y: WGLV.getViewportY(), w: WGLV.getViewportWidth(), h: WGLV.getViewportHeight() };
    }

    // What clip rects are cut down to: the camera's viewport, or the whole surface
    static #getBaseRect()
    {
        const view = ClipSpace.#getSurfacePixels();
        const c = ClipSpace.#camera;

        if (c === null || c.hasViewport() === false)
            return view;

        const v = c.getViewport(ClipSpace.#kViewport);
        const r = ClipSpace.#toPixels(v.x, v.y, v.z, v.w);
        const left = Math.max(r.x, view.x);
        const bottom = Math.max(r.y, view.y);
        const right = Math.min(r.x + r.w, view.x + view.w);
        const top = Math.min(r.y + r.h, view.y + view.h);

        return { x: left, y: bottom, w: Math.max(0, right - left), h: Math.max(0, top - bottom) };
    }

    // Sets the scissor (RenderState) to the innermost clip rect or the camera's viewport, or off when neither applies
    static #applyClip()
    {
        if (WGLV.context === null)
            return;

        let r = null; // Off: the GL viewport already clips drawing to the surface

        if (ClipSpace.#clipStack.length > 0)
            r = ClipSpace.#clipStack[ClipSpace.#clipStack.length - 1];
        else if (ClipSpace.#camera !== null && ClipSpace.#camera.hasViewport() === true)
            r = ClipSpace.#getBaseRect();

        RenderState.setScissor(r);
    }
}

// The Frame block's buffer is made by WGLV.init(), so every shader declaring it finds it at the binding point (see RenderUniformBlocks)
RenderUniformBlocks.setBufferProvider(RenderUniformBlocks.kFrame, ClipSpace.uploadBuffer);
