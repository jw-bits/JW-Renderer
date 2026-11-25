"use strict";

/*
    SpineSkeletonDebug - Draws a SpineSkeleton's bones and attachment outlines
    as lines, through a Batcher: for checking poses before (or alongside) its
    images. Engine code, not a port (Spine's own is spine-webgl's
    SkeletonDebugRenderer).

    Every line is one shared 1 x 1 white Rect2D, stretched and turned (scale
    then rotation, about its center), so a whole skeleton is a handful of
    instanced draws whatever its size.

        Bones       From each bone's origin along its x axis, as long as the bone; a short tick for a
                    bone of length 0
        Regions     Each region attachment's quad
        Meshes      Each mesh's hull (and with setMeshTriangles(true), every triangle)
        Others      Bounding boxes, clipping polygons and paths' control polygons

    Usage:
        let debug = new SpineSkeletonDebug();
        debug.load();                              // After WGLV.init()
        debug.setLineWidth(2);

        // Each frame, after skeleton.updateWorldTransform()
        debug.submit(batcher, skeleton, layer);

    The skeleton's own x, y and scale place it, in design units (+Y up, as in
    Spine); the batcher's camera applies as for anything else on the layer.
*/
class SpineSkeletonDebug
{
    static kBoneColor = Object.freeze(new Vector4(1.0, 0.25, 0.25, 1.0));
    static kRegionColor = Object.freeze(new Vector4(0.3, 0.6, 1.0, 1.0));
    static kMeshColor = Object.freeze(new Vector4(1.0, 0.75, 0.2, 1.0));
    static kMeshTriangleColor = Object.freeze(new Vector4(1.0, 0.75, 0.2, 0.35));
    static kOtherColor = Object.freeze(new Vector4(0.4, 1.0, 0.4, 1.0));

    static #kZeroBoneLength = 6.0; // Design units: the tick drawn for a bone of length 0

    #line;       // Rect2D: 1 x 1, centered
    #at;         // Transform2D: scratch (the batcher copies it)
    #vertices;   // Float32Array: scratch world vertices, grown as needed
    #lineWidth;
    #showBones;
    #showRegions;
    #showMeshes;
    #showMeshTriangles;
    #showOthers;

    constructor()
    {
        this.#line = null;
        this.#at = new Transform2D();
        this.#vertices = new Float32Array(256);
        this.#lineWidth = 2.0;
        this.#showBones = true;
        this.#showRegions = true;
        this.#showMeshes = true;
        this.#showMeshTriangles = false;
        this.#showOthers = true;
    }

    // Builds the line model (after WGLV.init()). Returns false if it can't.
    load()
    {
        if (this.#line !== null)
            return true;

        let line = new Rect2D();

        if (line.load(TextureManager.getWhiteTexture(), 1, 1) === false)
        {
            console.error("SpineSkeletonDebug.load() couldn't build its line model");
                return false;
        }

        line.setAlignment(Alignment.kMiddleCenter);
        this.#line = line;
            return true;
    }

    isLoaded() { return (this.#line !== null); }

    unload()
    {
        this.#line?.unload();
        this.#line = null;
    }

    // Design units
    setLineWidth(width)
    {
        if (Number.isFinite(width) === false || width <= 0.0)
        {
            console.error("SpineSkeletonDebug.setLineWidth() needs a width above 0");
                return false;
        }

        this.#lineWidth = width;
            return true;
    }

    getLineWidth() { return this.#lineWidth; }

    setBones(isShown) { this.#showBones = (isShown === true); }
    setRegions(isShown) { this.#showRegions = (isShown === true); }
    setMeshes(isShown) { this.#showMeshes = (isShown === true); }
    setMeshTriangles(isShown) { this.#showMeshTriangles = (isShown === true); }
    setOthers(isShown) { this.#showOthers = (isShown === true); }

    /*
        Queues the skeleton's lines on the batcher's layer (its world transform as it is now:
        call skeleton.updateWorldTransform() first). Returns how many lines, or -1 (with a
        console.error) if it isn't loaded or isn't given a SpineSkeleton.
    */
    submit(batcher, skeleton, layer)
    {
        if (this.#line === null || (skeleton instanceof SpineSkeleton) === false)
        {
            console.error("SpineSkeletonDebug.submit() needs load() first, and a SpineSkeleton");
                return -1;
        }

        let count = 0;

        // Attachments, in draw order, under the bones
        for (const slot of skeleton.drawOrder)
        {
            if (slot.bone.active === false)
                continue;

            const a = slot.getAttachment();

            if (a instanceof SpineRegionAttachment)
            {
                if (this.#showRegions === true)
                {
                    a.computeWorldVertices(slot.bone, this.#vertices, 0, 2);
                    count += this.#submitPolygon(batcher, this.#vertices, 4, layer, SpineSkeletonDebug.kRegionColor);
                }
            }
            else if (a instanceof SpineMeshAttachment)
            {
                if (this.#showMeshes === true)
                {
                    const v = this.#worldVertices(slot, a);

                    if (this.#showMeshTriangles === true)
                        count += this.#submitTriangles(batcher, v, a.triangles, layer, SpineSkeletonDebug.kMeshTriangleColor);

                    count += this.#submitPolygon(batcher, v, a.hullLength / 2, layer, SpineSkeletonDebug.kMeshColor);
                }
            }
            else if (a instanceof SpineVertexAttachment)
            {
                // Bounding boxes, clipping polygons and paths' control points
                if (this.#showOthers === true)
                {
                    const v = this.#worldVertices(slot, a);
                    count += this.#submitPolygon(batcher, v, a.worldVerticesLength / 2, layer, SpineSkeletonDebug.kOtherColor,
                                                 (a instanceof SpinePathAttachment) === false || a.closed === true);
                }
            }
        }

        if (this.#showBones === true)
        {
            for (const bone of skeleton.bones)
            {
                if (bone.active === false)
                    continue;

                const length = (bone.data.length > 0.0) ? bone.data.length : SpineSkeletonDebug.#kZeroBoneLength;
                this.#submitLine(batcher, bone.worldX, bone.worldY, bone.worldX + (length * bone.a), bone.worldY + (length * bone.c),
                                 layer, SpineSkeletonDebug.kBoneColor);
                ++count;
            }
        }

        return count;
    }

    // *** Internal Methods ***

    // A vertex attachment's world vertices (x, y pairs) in the scratch array, grown if it's too small
    #worldVertices(slot, attachment)
    {
        const n = attachment.worldVerticesLength;

        if (this.#vertices.length < n)
            this.#vertices = new Float32Array(n * 2);

        attachment.computeWorldVertices(slot, 0, n, this.#vertices, 0, 2);
        return this.#vertices;
    }

    // count points of v (x, y pairs) joined in order, and back to the first if isClosed; the number of lines
    #submitPolygon(batcher, v, count, layer, color, isClosed = true)
    {
        const lines = isClosed ? count : count - 1;

        for (let i = 0; i < lines; ++i)
        {
            const j = (i + 1) % count;
            this.#submitLine(batcher, v[i * 2], v[(i * 2) + 1], v[j * 2], v[(j * 2) + 1], layer, color);
        }

        return Math.max(0, lines);
    }

    // Every triangle's three edges (shared edges are drawn twice); the number of lines
    #submitTriangles(batcher, v, triangles, layer, color)
    {
        for (let i = 0; i < triangles.length; i += 3)
        {
            const a = triangles[i] * 2;
            const b = triangles[i + 1] * 2;
            const c = triangles[i + 2] * 2;

            this.#submitLine(batcher, v[a], v[a + 1], v[b], v[b + 1], layer, color);
            this.#submitLine(batcher, v[b], v[b + 1], v[c], v[c + 1], layer, color);
            this.#submitLine(batcher, v[c], v[c + 1], v[a], v[a + 1], layer, color);
        }

        return triangles.length;
    }

    // The line model stretched from (x1, y1) to (x2, y2), lineWidth thick
    #submitLine(batcher, x1, y1, x2, y2, layer, color)
    {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const length = Math.sqrt((dx * dx) + (dy * dy));

        this.#at.set((x1 + x2) * 0.5, (y1 + y2) * 0.5, length + this.#lineWidth, this.#lineWidth, Math.atan2(dy, dx));
        batcher.submit(this.#line, this.#at, layer, null, color);
    }
}
