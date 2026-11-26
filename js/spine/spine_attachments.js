"use strict";

/******************************************************************************
 * Spine Runtimes License Agreement
 * Last updated January 1, 2020. Replaces all prior versions.
 *
 * Copyright (c) 2013-2020, Esoteric Software LLC
 *
 * Integration of the Spine Runtimes into software or otherwise creating
 * derivative works of the Spine Runtimes is permitted under the terms and
 * conditions of Section 2 of the Spine Editor License Agreement:
 * http://esotericsoftware.com/spine-editor-license
 *
 * Otherwise, it is permitted to integrate the Spine Runtimes into software
 * or otherwise create derivative works of the Spine Runtimes (collectively,
 * "Products"), provided that each user of the Products must obtain their own
 * Spine Editor license and redistribution of the Products in any form must
 * include this license and copyright notice.
 *
 * THE SPINE RUNTIMES ARE PROVIDED BY ESOTERIC SOFTWARE LLC "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL ESOTERIC SOFTWARE LLC BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES,
 * BUSINESS INTERRUPTION, OR LOSS OF USE, DATA, OR PROFITS) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THE SPINE RUNTIMES, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *****************************************************************************/

/*
    Spine attachments, ported from spine-core 4.0.31 (attachments/*.ts and
    AtlasAttachmentLoader.ts); see docs/spine_plan.md.

        SpineAttachment             The base of every attachment
        SpineVertexAttachment       Vertices moved by one or more bones (and deformed by a slot)
        SpineBoundingBoxAttachment  A polygon for hit testing
        SpineClippingAttachment     A polygon that clips the slots after it
        SpineMeshAttachment         A textured mesh
        SpinePathAttachment         A curve for path constraints
        SpinePointAttachment        A point and rotation (where to attach things)
        SpineRegionAttachment       A textured quad
        SpineAtlasAttachmentLoader  Makes them, with images from a TextureAtlasManager Spine atlas

    Engine changes: a region or mesh attachment's region is the engine's
    AtlasSubTexture, not Spine's TextureRegion; their uvs are worked out from
    it in Spine's terms (V down, see SpineUtils.getRegionUVs()).
*/

/** The base class for all attachments. */
class SpineAttachment
{
    name;

    constructor(name)
    {
        if (!name)
            throw new Error("name cannot be null.");
        this.name = name;
    }
}

/** Base class for an attachment with vertices that are transformed by one or more bones and can be deformed by a slot's
 * {@link Slot#deform}. */
class SpineVertexAttachment extends SpineAttachment
{
    static nextID = 0;

    /** The unique ID for this attachment. */
    id = SpineVertexAttachment.nextID++;

    /** The bones which affect the {@link #getVertices()}. The array entries are, for each vertex, the number of bones affecting
     * the vertex followed by that many bone indices, which is the index of the bone in {@link Skeleton#bones}. Will be null
     * if this attachment has no weights. */
    bones = null;

    /** The vertex positions in the bone's coordinate system. For a non-weighted attachment, the values are `x,y`
     * entries for each vertex. For a weighted attachment, the values are `x,y,weight` entries for each bone affecting
     * each vertex. */
    vertices = null;

    /** The maximum number of world vertex values that can be output by
     * {@link #computeWorldVertices()} using the `count` parameter. */
    worldVerticesLength = 0;

    /** Deform keys for the deform attachment are also applied to this attachment. May be null if no deform keys should be applied. */
    deformAttachment = this;

    constructor(name)
    {
        super(name);
    }

    /** Transforms the attachment's local {@link #vertices} to world coordinates. If the slot's {@link Slot#deform} is
     * not empty, it is used to deform the vertices.
     *
     * See [World transforms](http://esotericsoftware.com/spine-runtime-skeletons#World-transforms) in the Spine
     * Runtimes Guide.
     * @param start The index of the first {@link #vertices} value to transform. Each vertex has 2 values, x and y.
     * @param count The number of world vertex values to output. Must be <= {@link #worldVerticesLength} - `start`.
     * @param worldVertices The output world vertices. Must have a length >= `offset` + `count` *
     *           `stride` / 2.
     * @param offset The `worldVertices` index to begin writing values.
     * @param stride The number of `worldVertices` entries between the value pairs written. */
    computeWorldVertices(slot, start, count, worldVertices, offset, stride)
    {
        count = offset + (count >> 1) * stride;
        let skeleton = slot.bone.skeleton;
        let deformArray = slot.deform;
        let vertices = this.vertices;
        let bones = this.bones;
        if (!bones)
        {
            if (deformArray.length > 0)
                vertices = deformArray;
            let bone = slot.bone;
            let x = bone.worldX;
            let y = bone.worldY;
            let a = bone.a, b = bone.b, c = bone.c, d = bone.d;
            for (let v = start, w = offset; w < count; v += 2, w += stride)
            {
                let vx = vertices[v], vy = vertices[v + 1];
                worldVertices[w] = vx * a + vy * b + x;
                worldVertices[w + 1] = vx * c + vy * d + y;
            }
            return;
        }
        let v = 0, skip = 0;
        for (let i = 0; i < start; i += 2)
        {
            let n = bones[v];
            v += n + 1;
            skip += n;
        }
        let skeletonBones = skeleton.bones;
        if (deformArray.length == 0)
        {
            for (let w = offset, b = skip * 3; w < count; w += stride)
            {
                let wx = 0, wy = 0;
                let n = bones[v++];
                n += v;
                for (; v < n; v++, b += 3)
                {
                    let bone = skeletonBones[bones[v]];
                    let vx = vertices[b], vy = vertices[b + 1], weight = vertices[b + 2];
                    wx += (vx * bone.a + vy * bone.b + bone.worldX) * weight;
                    wy += (vx * bone.c + vy * bone.d + bone.worldY) * weight;
                }
                worldVertices[w] = wx;
                worldVertices[w + 1] = wy;
            }
        }
        else
        {
            let deform = deformArray;
            for (let w = offset, b = skip * 3, f = skip << 1; w < count; w += stride)
            {
                let wx = 0, wy = 0;
                let n = bones[v++];
                n += v;
                for (; v < n; v++, b += 3, f += 2)
                {
                    let bone = skeletonBones[bones[v]];
                    let vx = vertices[b] + deform[f], vy = vertices[b + 1] + deform[f + 1], weight = vertices[b + 2];
                    wx += (vx * bone.a + vy * bone.b + bone.worldX) * weight;
                    wy += (vx * bone.c + vy * bone.d + bone.worldY) * weight;
                }
                worldVertices[w] = wx;
                worldVertices[w + 1] = wy;
            }
        }
    }

    /** Does not copy id (generated) or name (set on construction). **/
    copyTo(attachment)
    {
        if (this.bones)
        {
            attachment.bones = new Array(this.bones.length);
            SpineUtils.arrayCopy(this.bones, 0, attachment.bones, 0, this.bones.length);
        }
        else
            attachment.bones = null;
        if (this.vertices)
        {
            attachment.vertices = new Float32Array(this.vertices.length);
            SpineUtils.arrayCopy(this.vertices, 0, attachment.vertices, 0, this.vertices.length);
        }
        else
            attachment.vertices = null;
        attachment.worldVerticesLength = this.worldVerticesLength;
        attachment.deformAttachment = this.deformAttachment;
    }
}

/** An attachment with vertices that make up a polygon. Can be used for hit detection, creating physics bodies, spawning particle
 * effects, and more.
 *
 * See {@link SkeletonBounds} and [Bounding Boxes](http://esotericsoftware.com/spine-bounding-boxes) in the Spine User
 * Guide. */
class SpineBoundingBoxAttachment extends SpineVertexAttachment
{
    color = new Vector4(1, 1, 1, 1);

    constructor(name)
    {
        super(name);
    }

    copy()
    {
        let copy = new SpineBoundingBoxAttachment(this.name);
        this.copyTo(copy);
        copy.color.set(this.color);
        return copy;
    }
}

/** An attachment with vertices that make up a polygon used for clipping the rendering of other attachments. */
class SpineClippingAttachment extends SpineVertexAttachment
{
    /** Clipping is performed between the clipping polygon's slot and the end slot. Returns null if clipping is done until the end of
     * the skeleton's rendering. */
    endSlot = null;
    // Nonessential.
    /** The color of the clipping polygon as it was in Spine. Available only when nonessential data was exported. Clipping polygons
     * are not usually rendered at runtime. */
    color = new Vector4(0.2275, 0.2275, 0.8078, 1); // ce3a3aff
    constructor(name)
    {
        super(name);
    }

    copy()
    {
        let copy = new SpineClippingAttachment(this.name);
        this.copyTo(copy);
        copy.endSlot = this.endSlot;
        copy.color.set(this.color);
        return copy;
    }
}

/** An attachment that displays a textured mesh. A mesh has hull vertices and internal vertices within the hull. Holes are not
 * supported. Each vertex has UVs (texture coordinates) and triangles are used to map an image on to the mesh.
 *
 * See [Mesh attachments](http://esotericsoftware.com/spine-meshes) in the Spine User Guide. */
class SpineMeshAttachment extends SpineVertexAttachment
{
    static #kCorners = [0, 0, 0, 0]; // Scratch for updateUVs()

    /** Engine: the AtlasSubTexture the mesh draws (Spine's TextureRegion). */
    region = null;

    /** The name of the texture region for this attachment. */
    path = null;

    /** The UV pair for each vertex, normalized within the texture region. */
    regionUVs = null;

    /** The UV pair for each vertex, normalized within the entire texture.
     *
     * See {@link #updateUVs}. */
    uvs = null;

    /** Triplets of vertex indices which describe the mesh's triangulation. */
    triangles = null;

    /** The color to tint the mesh. */
    color = new Vector4(1, 1, 1, 1);

    /** The width of the mesh's image. Available only when nonessential data was exported. */
    width = 0;

    /** The height of the mesh's image. Available only when nonessential data was exported. */
    height = 0;

    /** The number of entries at the beginning of {@link #vertices} that make up the mesh hull. */
    hullLength = 0;

    /** Vertex index pairs describing edges for controling triangulation. Mesh triangles will never cross edges. Only available if
     * nonessential data was exported. Triangulation is not performed at runtime. */
    edges = null;
    parentMesh = null;
    tempColor = new Vector4(0, 0, 0, 0);

    constructor(name)
    {
        super(name);
    }

    /** Calculates {@link #uvs} using {@link #regionUVs} and the {@link #region}. Must be called after changing the region UVs or
     * region.
     *
     * Engine: the region is an AtlasSubTexture (see SpineAtlasAttachmentLoader). The uvs come out as Spine's, with V
     * running down from the top of the page (see SpineUtils.getRegionUVs()). */
    updateUVs()
    {
        let regionUVs = this.regionUVs;
        if (!this.uvs || this.uvs.length != regionUVs.length)
            this.uvs = new Float32Array(regionUVs.length);
        let uvs = this.uvs;
        let n = this.uvs.length;
        let u = 0, v = 0, width = 0, height = 0;
        if (this.region instanceof AtlasSubTexture)
        {
            let region = this.region;
            const corners = SpineUtils.getRegionUVs(region, SpineMeshAttachment.#kCorners);
            u = corners[0];
            v = corners[1];
            let textureWidth = region.getAtlas().getWidth(), textureHeight = region.getAtlas().getHeight();
            let regionWidth = region.getWidth(), regionHeight = region.getHeight();
            let offsetX = region.getOffsetX(), offsetY = region.getOffsetY();
            let originalWidth = region.getOriginalWidth(), originalHeight = region.getOriginalHeight();
            switch (region.getRotation())
            {
                case 90:
                    u -= (originalHeight - offsetY - regionHeight) / textureWidth;
                    v -= (originalWidth - offsetX - regionWidth) / textureHeight;
                    width = originalHeight / textureWidth;
                    height = originalWidth / textureHeight;
                    for (let i = 0; i < n; i += 2)
                    {
                        uvs[i] = u + regionUVs[i + 1] * width;
                        uvs[i + 1] = v + (1 - regionUVs[i]) * height;
                    }
                    return;
                case 180:
                    u -= (originalWidth - offsetX - regionWidth) / textureWidth;
                    v -= offsetY / textureHeight;
                    width = originalWidth / textureWidth;
                    height = originalHeight / textureHeight;
                    for (let i = 0; i < n; i += 2)
                    {
                        uvs[i] = u + (1 - regionUVs[i]) * width;
                        uvs[i + 1] = v + (1 - regionUVs[i + 1]) * height;
                    }
                    return;
                case 270:
                    u -= offsetY / textureWidth;
                    v -= offsetX / textureHeight;
                    width = originalHeight / textureWidth;
                    height = originalWidth / textureHeight;
                    for (let i = 0; i < n; i += 2)
                    {
                        uvs[i] = u + (1 - regionUVs[i + 1]) * width;
                        uvs[i + 1] = v + regionUVs[i] * height;
                    }
                    return;
            }
            u -= offsetX / textureWidth;
            v -= (originalHeight - offsetY - regionHeight) / textureHeight;
            width = originalWidth / textureWidth;
            height = originalHeight / textureHeight;
        }
        else
        {
            // No region: the whole texture
            u = v = 0;
            width = height = 1;
        }
        for (let i = 0; i < n; i += 2)
        {
            uvs[i] = u + regionUVs[i] * width;
            uvs[i + 1] = v + regionUVs[i + 1] * height;
        }
    }

    /** The parent mesh if this is a linked mesh, else null. A linked mesh shares the {@link #bones}, {@link #vertices},
     * {@link #regionUVs}, {@link #triangles}, {@link #hullLength}, {@link #edges}, {@link #width}, and {@link #height} with the
     * parent mesh, but may have a different {@link #name} or {@link #path} (and therefore a different texture). */
    getParentMesh()
    {
        return this.parentMesh;
    }

    /** @param parentMesh May be null. */
    setParentMesh(parentMesh)
    {
        this.parentMesh = parentMesh;
        if (parentMesh)
        {
            this.bones = parentMesh.bones;
            this.vertices = parentMesh.vertices;
            this.worldVerticesLength = parentMesh.worldVerticesLength;
            this.regionUVs = parentMesh.regionUVs;
            this.triangles = parentMesh.triangles;
            this.hullLength = parentMesh.hullLength;
            this.worldVerticesLength = parentMesh.worldVerticesLength;
        }
    }

    copy()
    {
        if (this.parentMesh)
            return this.newLinkedMesh();
        let copy = new SpineMeshAttachment(this.name);
        copy.region = this.region;
        copy.path = this.path;
        copy.color.set(this.color);
        this.copyTo(copy);
        copy.regionUVs = new Array(this.regionUVs.length);
        SpineUtils.arrayCopy(this.regionUVs, 0, copy.regionUVs, 0, this.regionUVs.length);
        copy.uvs = new Array(this.uvs.length);
        SpineUtils.arrayCopy(this.uvs, 0, copy.uvs, 0, this.uvs.length);
        copy.triangles = new Array(this.triangles.length);
        SpineUtils.arrayCopy(this.triangles, 0, copy.triangles, 0, this.triangles.length);
        copy.hullLength = this.hullLength;
        // Nonessential.
        if (this.edges)
        {
            copy.edges = new Array(this.edges.length);
            SpineUtils.arrayCopy(this.edges, 0, copy.edges, 0, this.edges.length);
        }
        copy.width = this.width;
        copy.height = this.height;
        return copy;
    }

    /** Returns a new mesh with the {@link #parentMesh} set to this mesh's parent mesh, if any, else to this mesh. **/
    newLinkedMesh()
    {
        let copy = new SpineMeshAttachment(this.name);
        copy.region = this.region;
        copy.path = this.path;
        copy.color.set(this.color);
        copy.deformAttachment = this.deformAttachment;
        copy.setParentMesh(this.parentMesh ? this.parentMesh : this);
        copy.updateUVs();
        return copy;
    }
}

/** An attachment whose vertices make up a composite Bezier curve.
 *
 * See {@link PathConstraint} and [Paths](http://esotericsoftware.com/spine-paths) in the Spine User Guide. */
class SpinePathAttachment extends SpineVertexAttachment
{
    /** The lengths along the path in the setup pose from the start of the path to the end of each Bezier curve. */
    lengths = null;

    /** If true, the start and end knots are connected. */
    closed = false;

    /** If true, additional calculations are performed to make calculating positions along the path more accurate. If false, fewer
     * calculations are performed but calculating positions along the path is less accurate. */
    constantSpeed = false;

    /** The color of the path as it was in Spine. Available only when nonessential data was exported. Paths are not usually
     * rendered at runtime. */
    color = new Vector4(1, 1, 1, 1);

    constructor(name)
    {
        super(name);
    }

    copy()
    {
        let copy = new SpinePathAttachment(this.name);
        this.copyTo(copy);
        copy.lengths = new Array(this.lengths.length);
        SpineUtils.arrayCopy(this.lengths, 0, copy.lengths, 0, this.lengths.length);
        copy.closed = closed;
        copy.constantSpeed = this.constantSpeed;
        copy.color.set(this.color);
        return copy;
    }
}

/** An attachment which is a single point and a rotation. This can be used to spawn projectiles, particles, etc. A bone can be
 * used in similar ways, but a PointAttachment is slightly less expensive to compute and can be hidden, shown, and placed in a
 * skin.
 *
 * See [Point Attachments](http://esotericsoftware.com/spine-point-attachments) in the Spine User Guide. */
class SpinePointAttachment extends SpineVertexAttachment
{
    x = 0;
    y = 0;
    rotation = 0;

    /** The color of the point attachment as it was in Spine. Available only when nonessential data was exported. Point attachments
     * are not usually rendered at runtime. */
    color = new Vector4(0.38, 0.94, 0, 1);

    constructor(name)
    {
        super(name);
    }

    computeWorldPosition(bone, point)
    {
        point.x = this.x * bone.a + this.y * bone.b + bone.worldX;
        point.y = this.x * bone.c + this.y * bone.d + bone.worldY;
        return point;
    }

    computeWorldRotation(bone)
    {
        let cos = SpineMathUtils.cosDeg(this.rotation), sin = SpineMathUtils.sinDeg(this.rotation);
        let x = cos * bone.a + sin * bone.b;
        let y = cos * bone.c + sin * bone.d;
        return Math.atan2(y, x) * SpineMathUtils.radDeg;
    }

    copy()
    {
        let copy = new SpinePointAttachment(this.name);
        copy.x = this.x;
        copy.y = this.y;
        copy.rotation = this.rotation;
        copy.color.set(this.color);
        return copy;
    }
}

/** An attachment that displays a textured quadrilateral.
 *
 * See [Region attachments](http://esotericsoftware.com/spine-regions) in the Spine User Guide. */
class SpineRegionAttachment extends SpineAttachment
{
    /** The local x translation. */
    x = 0;

    /** The local y translation. */
    y = 0;

    /** The local scaleX. */
    scaleX = 1;

    /** The local scaleY. */
    scaleY = 1;

    /** The local rotation. */
    rotation = 0;

    /** The width of the region attachment in Spine. */
    width = 0;

    /** The height of the region attachment in Spine. */
    height = 0;

    /** The color to tint the region attachment. */
    color = new Vector4(1, 1, 1, 1);

    /** The name of the texture region for this attachment. */
    path = null;
    rendererObject = null;

    /** Engine: the AtlasSubTexture the region draws (Spine's TextureRegion). */
    region = null;

    static #kCorners = [0, 0, 0, 0]; // Scratch for setRegion()

    /** For each of the 4 vertices, a pair of <code>x,y</code> values that is the local position of the vertex.
     *
     * See {@link #updateOffset()}. */
    offset = new Float32Array(8);
    uvs = new Float32Array(8);
    tempColor = new Vector4(1, 1, 1, 1);

    constructor(name)
    {
        super(name);
    }

    /** Calculates the {@link #offset} using the region settings. Must be called after changing region settings. */
    updateOffset()
    {
        let region = this.region;
        let regionScaleX = this.width / region.getOriginalWidth() * this.scaleX;
        let regionScaleY = this.height / region.getOriginalHeight() * this.scaleY;
        let localX = -this.width / 2 * this.scaleX + region.getOffsetX() * regionScaleX;
        let localY = -this.height / 2 * this.scaleY + region.getOffsetY() * regionScaleY;
        let localX2 = localX + region.getWidth() * regionScaleX;
        let localY2 = localY + region.getHeight() * regionScaleY;
        let radians = this.rotation * Math.PI / 180;
        let cos = Math.cos(radians);
        let sin = Math.sin(radians);
        let x = this.x, y = this.y;
        let localXCos = localX * cos + x;
        let localXSin = localX * sin;
        let localYCos = localY * cos + y;
        let localYSin = localY * sin;
        let localX2Cos = localX2 * cos + x;
        let localX2Sin = localX2 * sin;
        let localY2Cos = localY2 * cos + y;
        let localY2Sin = localY2 * sin;
        let offset = this.offset;
        offset[0] = localXCos - localYSin;
        offset[1] = localYCos + localXSin;
        offset[2] = localXCos - localY2Sin;
        offset[3] = localY2Cos + localXSin;
        offset[4] = localX2Cos - localY2Sin;
        offset[5] = localY2Cos + localX2Sin;
        offset[6] = localX2Cos - localYSin;
        offset[7] = localYCos + localX2Sin;
    }

    /** Engine: region is an AtlasSubTexture. The uvs come out as Spine's, V running down from the top of the page. */
    setRegion(region)
    {
        this.region = region;
        let uvs = this.uvs;
        const [u, v, u2, v2] = SpineUtils.getRegionUVs(region, SpineRegionAttachment.#kCorners);
        if (region.getRotation() == 90)
        {
            uvs[2] = u;
            uvs[3] = v2;
            uvs[4] = u;
            uvs[5] = v;
            uvs[6] = u2;
            uvs[7] = v;
            uvs[0] = u2;
            uvs[1] = v2;
        }
        else
        {
            uvs[0] = u;
            uvs[1] = v2;
            uvs[2] = u;
            uvs[3] = v;
            uvs[4] = u2;
            uvs[5] = v;
            uvs[6] = u2;
            uvs[7] = v2;
        }
    }

    /** Transforms the attachment's four vertices to world coordinates.
     *
     * See [World transforms](http://esotericsoftware.com/spine-runtime-skeletons#World-transforms) in the Spine
     * Runtimes Guide.
     * @param worldVertices The output world vertices. Must have a length >= `offset` + 8.
     * @param offset The `worldVertices` index to begin writing values.
     * @param stride The number of `worldVertices` entries between the value pairs written. */
    computeWorldVertices(bone, worldVertices, offset, stride)
    {
        let vertexOffset = this.offset;
        let x = bone.worldX, y = bone.worldY;
        let a = bone.a, b = bone.b, c = bone.c, d = bone.d;
        let offsetX = 0, offsetY = 0;
        offsetX = vertexOffset[0];
        offsetY = vertexOffset[1];
        worldVertices[offset] = offsetX * a + offsetY * b + x; // br
        worldVertices[offset + 1] = offsetX * c + offsetY * d + y;
        offset += stride;
        offsetX = vertexOffset[2];
        offsetY = vertexOffset[3];
        worldVertices[offset] = offsetX * a + offsetY * b + x; // bl
        worldVertices[offset + 1] = offsetX * c + offsetY * d + y;
        offset += stride;
        offsetX = vertexOffset[4];
        offsetY = vertexOffset[5];
        worldVertices[offset] = offsetX * a + offsetY * b + x; // ul
        worldVertices[offset + 1] = offsetX * c + offsetY * d + y;
        offset += stride;
        offsetX = vertexOffset[6];
        offsetY = vertexOffset[7];
        worldVertices[offset] = offsetX * a + offsetY * b + x; // ur
        worldVertices[offset + 1] = offsetX * c + offsetY * d + y;
    }

    copy()
    {
        let copy = new SpineRegionAttachment(this.name);
        copy.region = this.region;
        copy.rendererObject = this.rendererObject;
        copy.path = this.path;
        copy.x = this.x;
        copy.y = this.y;
        copy.scaleX = this.scaleX;
        copy.scaleY = this.scaleY;
        copy.rotation = this.rotation;
        copy.width = this.width;
        copy.height = this.height;
        copy.uvs.set(this.uvs);
        copy.offset.set(this.offset);
        copy.color.set(this.color);
        return copy;
    }

    static X1 = 0;
    static Y1 = 1;
    static C1R = 2;
    static C1G = 3;
    static C1B = 4;
    static C1A = 5;
    static U1 = 6;
    static V1 = 7;
    static X2 = 8;
    static Y2 = 9;
    static C2R = 10;
    static C2G = 11;
    static C2B = 12;
    static C2A = 13;
    static U2 = 14;
    static V2 = 15;
    static X3 = 16;
    static Y3 = 17;
    static C3R = 18;
    static C3G = 19;
    static C3B = 20;
    static C3A = 21;
    static U3 = 22;
    static V3 = 23;
    static X4 = 24;
    static Y4 = 25;
    static C4R = 26;
    static C4G = 27;
    static C4B = 28;
    static C4A = 29;
    static U4 = 30;
    static V4 = 31;
}

/*
    SpineAtlasAttachmentLoader - Makes the attachments SpineSkeletonJson reads,
    finding region and mesh images in a Spine atlas loaded by
    TextureAtlasManager.loadSpineAtlas() (Spine's AtlasAttachmentLoader, on
    the engine's atlases). Each region or mesh attachment's region is that
    image's AtlasSubTexture.

    Usage:
        await TextureAtlasManager.loadSpineAtlas("assets/atlas1.atlas");
        let reader = new SpineSkeletonJson(new SpineAtlasAttachmentLoader("assets/atlas1.atlas"));
        let data = reader.readSkeletonData(json.raptor);

    A missing image throws, as Spine's does, so a skeleton never loads with a
    hole in it; SpineSkeletonData.load() catches it and reports it.
*/
class SpineAtlasAttachmentLoader
{
    #atlasUrl;

    // atlasUrl: a Spine atlas already loaded by TextureAtlasManager.loadSpineAtlas()
    constructor(atlasUrl)
    {
        this.#atlasUrl = atlasUrl;
    }

    getAtlasURL() { return this.#atlasUrl; }

    newRegionAttachment(skin, name, path)
    {
        let attachment = new SpineRegionAttachment(name);
        attachment.setRegion(this.#findRegion(path, name, "region"));
        return attachment;
    }

    newMeshAttachment(skin, name, path)
    {
        let attachment = new SpineMeshAttachment(name);
        attachment.region = this.#findRegion(path, name, "mesh");
        return attachment;
    }

    newBoundingBoxAttachment(skin, name) { return new SpineBoundingBoxAttachment(name); }
    newPathAttachment(skin, name) { return new SpinePathAttachment(name); }
    newPointAttachment(skin, name) { return new SpinePointAttachment(name); }
    newClippingAttachment(skin, name) { return new SpineClippingAttachment(name); }

    // *** Internal Methods ***

    // The AtlasSubTexture for path; throws (as Spine does) if the atlas doesn't have it
    #findRegion(path, name, kind)
    {
        const region = TextureAtlasManager.findSubTexture(this.#atlasUrl, path);

        if (region === null)
            throw new Error(`Region not found in atlas: ${path} (${kind} attachment: ${name}, atlas ${this.#atlasUrl})`);

        return region;
    }
}
