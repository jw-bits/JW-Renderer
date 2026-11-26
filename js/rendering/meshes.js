"use strict";

// Vertex and index buffers are in buffers.js

class StaticMesh
{
    #vertexBuffers;
    #indexBuffer;
    #vao;

    #primitiveType;
    #count;

    constructor(_primitiveType = WGLV.context.TRIANGLES)
    {
        this.#vertexBuffers = new Map();
        this.#indexBuffer = null;
        this.#vao = WGLV.context.createVertexArray();

        this.#primitiveType = _primitiveType;
        this.#count = 0;
    }

    setVertexData(attribName, data)
    {
        if (RenderAttributes.allAttribs.has(attribName) === false)
            return false;

        if (data == null)
            return false;

        let vb = new VertexFloatBuffer();

        if (vb.set(data) === false)
        {
            vb.unload();
                return false;
        }

        const c = data.length / RenderAttributes.componentCount(attribName);

        if (this.#count !== 0 && this.#count !== c)
        {
            vb.unload();
                return false;
        }

        this.#count = c;
        this.#vertexBuffers.get(attribName)?.unload(); // Replacing one
        this.#vertexBuffers.set(attribName, vb);
            return true;
    }

    /*
        Replaces a vertex buffer's contents in place, e.g. positions moved each
        frame. data must be a Float32Array with as many vertices as before; the
        VAO keeps pointing at the same buffer, so bindAttribs() isn't needed again.
    */
    updateVertexData(attribName, data)
    {
        const vb = this.#vertexBuffers.get(attribName);

        if (vb === undefined || data == null || (data.length / RenderAttributes.componentCount(attribName)) !== this.#count)
            return false;

        return vb.update(data);
    }

    setIndexData(indices)
    {
        if (indices == null)
            return false;
        else if (this.#indexBuffer !== null)
            return false;

        this.#indexBuffer = new IndexBuffer();

        // Attached to the VAO by bindAttribs() (the index buffer binding is VAO state)
        return this.#indexBuffer.set(indices);
    }

    // Frees the VAO and every buffer; the mesh can't be used afterwards
    unload()
    {
        const gl = WGLV.context;

        if (this.#vao !== null)
        {
            gl.deleteVertexArray(this.#vao);
            this.#vao = null;
        }

        for (const vb of this.#vertexBuffers.values())
            vb.unload();

        this.#vertexBuffers.clear();

        if (this.#indexBuffer !== null)
        {
            this.#indexBuffer.unload();
            this.#indexBuffer = null;
        }

        this.#count = 0;
    }

    /*
        Records the vertex buffers (at RenderAttributes' fixed locations) and the
        index buffer in this mesh's VAO. Call once, after all setVertexData() and
        setIndexData() calls; the mesh then works with any shader using those locations.
    */
    bindAttribs()
    {
        WGLV.context.bindVertexArray(this.#vao);

        for (const [attribName, vb] of this.#vertexBuffers)
        {
            WGLV.context.bindBuffer(WGLV.context.ARRAY_BUFFER, vb.getBufferId());

            const numberOfComponents = RenderAttributes.componentCount(attribName);
            const shaderLocation = RenderAttributes.getLocation(attribName);

            if (shaderLocation !== -1)
            {
                WGLV.context.vertexAttribPointer(shaderLocation, numberOfComponents, WGLV.context.FLOAT, false, 0, 0);
                WGLV.context.enableVertexAttribArray(shaderLocation);
            }
        }

        if (this.#indexBuffer !== null)
            WGLV.context.bindBuffer(WGLV.context.ELEMENT_ARRAY_BUFFER, this.#indexBuffer.getBufferId());

        WGLV.context.bindVertexArray(null);
    }

    render()
    {
        if (this.#vao === null)
            return; // Unloaded

        WGLV.context.bindVertexArray(this.#vao);

        if (this.#indexBuffer !== null)
            WGLV.context.drawElements(this.#primitiveType, this.#indexBuffer.getIndexCount(), this.#indexBuffer.getDataType(), 0);
        else
            WGLV.context.drawArrays(this.#primitiveType, 0, this.#count);

        WGLV.context.bindVertexArray(null);
    }
}

/*
    InstancedQuadMesh - One quad drawn many times in a single call, with
    per-instance values read from an interleaved float buffer. Used by
    Batcher (Rect2Ds, Sprites) and Particles2D.

    The quad's 4 corners (x, y pairs, counter-clockwise from the bottom-left)
    go to RenderAttributes' position location. Each instance attribute is
    [InstancedAttributes name, offset in floats] within floatsPerInstance
    floats; its location and component count come from InstancedAttributes.

    Usage:
        let mesh = new InstancedQuadMesh();
        mesh.load(new Float32Array([0, 0,  1, 0,  1, 1,  0, 1]), 8,
                  [[InstancedAttributes.kRect, 0], [InstancedAttributes.kColor, 4]]);
        mesh.setInstanceData(new Float32Array(capacity * 8)); // Allocates (and fills) the buffer
        mesh.updateInstanceData(data, 0, count * 8);          // Changes part of it
        shader.bind(); ...uniforms...
        mesh.render(count);

    Several draws can share one upload: render(count, firstInstance) draws
    instances firstInstance up, so a buffer filled once with every group's
    values (Batcher does) is drawn a group at a time. WebGL 2 has no base
    instance, so a new firstInstance re-points the instance attributes (a few
    calls on the VAO, no data sent).
*/
class InstancedQuadMesh
{
    #vao;
    #quadBuffer;
    #indexBuffer;
    #instBuffer;
    #attribs;       // [InstancedAttributes name, offset in floats], from load()
    #strideBytes;
    #firstInstance; // Where the instance attributes point now

    constructor()
    {
        this.#vao = null;
        this.#quadBuffer = null;
        this.#indexBuffer = null;
        this.#instBuffer = null;
        this.#attribs = [];
        this.#strideBytes = 0;
        this.#firstInstance = 0;
    }

    load(corners, floatsPerInstance, attribs)
    {
        if (this.#vao !== null)
            return false; // Unload first

        if ((corners instanceof Float32Array) === false || corners.length !== 8)
        {
            console.error("InstancedQuadMesh.load() needs the 4 corners as a Float32Array of 8 values");
                return false;
        }

        for (const [name, offset] of attribs)
        {
            const size = InstancedAttributes.componentCount(name);

            if (size === 0 || offset + size > floatsPerInstance)
            {
                console.error(`InstancedQuadMesh.load(): ${name} at float ${offset} isn't an InstancedAttributes name that fits in ${floatsPerInstance} floats`);
                    return false;
            }
        }

        const gl = WGLV.context;

        this.#quadBuffer = gl.createBuffer();
        this.#indexBuffer = gl.createBuffer();
        this.#instBuffer = gl.createBuffer();
        this.#vao = gl.createVertexArray();

        gl.bindVertexArray(this.#vao);

        // The quad, shared by every instance
        const posLocation = RenderAttributes.getLocation(RenderAttributes.kPosition);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.#quadBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW);
        gl.vertexAttribPointer(posLocation, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(posLocation);

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.#indexBuffer); // Part of the VAO's state
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint8Array([0, 1, 2,  2, 3, 0]), gl.STATIC_DRAW);

        // Per-instance values, interleaved
        this.#attribs = attribs.map(([name, offset]) => [name, offset]);
        this.#strideBytes = floatsPerInstance * 4;
        this.#firstInstance = 0;
        this.#pointInstanceAttribs();

        for (const [name] of this.#attribs)
        {
            const location = InstancedAttributes.getLocation(name);

            gl.enableVertexAttribArray(location);
            gl.vertexAttribDivisor(location, 1);
        }

        gl.bindVertexArray(null);
            return true;
    }

    // (Re)allocates the instance buffer to data's size and fills it with data
    setInstanceData(data)
    {
        const gl = WGLV.context;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.#instBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    }

    // Copies floatCount floats of data, starting at firstFloat, to the same place in the instance buffer
    updateInstanceData(data, firstFloat, floatCount)
    {
        const gl = WGLV.context;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.#instBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, firstFloat * 4, data, firstFloat, floatCount);
    }

    // Draws instanceCount quads, from instance firstInstance of the buffer; bind the shader and set its uniforms first
    render(instanceCount, firstInstance = 0)
    {
        if (this.#vao === null || instanceCount <= 0)
            return;

        const gl = WGLV.context;
        gl.bindVertexArray(this.#vao);

        if (firstInstance !== this.#firstInstance)
        {
            this.#firstInstance = firstInstance;
            this.#pointInstanceAttribs();
        }

        gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_BYTE, 0, instanceCount);
        gl.bindVertexArray(null);
    }

    isLoaded() { return (this.#vao !== null); }

    unload()
    {
        const gl = WGLV.context;

        if (this.#vao !== null) gl.deleteVertexArray(this.#vao);
        if (this.#quadBuffer !== null) gl.deleteBuffer(this.#quadBuffer);
        if (this.#indexBuffer !== null) gl.deleteBuffer(this.#indexBuffer);
        if (this.#instBuffer !== null) gl.deleteBuffer(this.#instBuffer);

        this.#vao = null;
        this.#quadBuffer = null;
        this.#indexBuffer = null;
        this.#instBuffer = null;
        this.#attribs = [];
        this.#strideBytes = 0;
        this.#firstInstance = 0;
    }

    // *** Internal Methods ***

    // Points each instance attribute at #firstInstance's values; the VAO must be bound
    #pointInstanceAttribs()
    {
        const gl = WGLV.context;
        const base = this.#firstInstance * this.#strideBytes;

        gl.bindBuffer(gl.ARRAY_BUFFER, this.#instBuffer);

        for (const [name, offset] of this.#attribs)
            gl.vertexAttribPointer(InstancedAttributes.getLocation(name), InstancedAttributes.componentCount(name), gl.FLOAT, false, this.#strideBytes, base + (offset * 4));
    }
}

/*
    DynamicMesh - Triangles rewritten every frame (Spine skeletons, trails,
    ropes): one interleaved vertex buffer and one index buffer, both growing
    as needed and refilled with setData().

    Vertex layout: load() takes [RenderAttributes name, components] pairs,
    interleaved in that order. components may be fewer than the attribute
    has (a 2D position into a_pos); the rest read as 0 (w as 1).

    Usage:
        let mesh = new DynamicMesh();
        mesh.load([[RenderAttributes.kPosition, 2], [RenderAttributes.kUV0, 2], [RenderAttributes.kColor, 4]]);

        // Each frame
        mesh.setData(vertices, vertexCount, indices, indexCount); // Float32Array, Uint16Array / Uint32Array
        shader.bind(); ...uniforms...
        mesh.render();                                           // Or render(firstIndex, count) for part of it

    The buffers keep their size once grown (doubling), so a steady frame
    only sends bufferSubData(). Indices are Uint16Array or Uint32Array; a
    change of type reallocates the index buffer.
*/
class DynamicMesh
{
    static #kStartBytes = 4096;

    #vao;
    #vertexBuffer;
    #indexBuffer;
    #vertexBytes;     // Allocated size of each buffer
    #indexBytes;
    #floatsPerVertex;
    #indexType;       // gl.UNSIGNED_SHORT or gl.UNSIGNED_INT, from the last setData()
    #indexSize;       // Bytes per index
    #vertexCount;
    #indexCount;
    #primitiveType;

    constructor(_primitiveType = WGLV.context.TRIANGLES)
    {
        this.#vao = null;
        this.#vertexBuffer = null;
        this.#indexBuffer = null;
        this.#vertexBytes = 0;
        this.#indexBytes = 0;
        this.#floatsPerVertex = 0;
        this.#indexType = 0;
        this.#indexSize = 0;
        this.#vertexCount = 0;
        this.#indexCount = 0;
        this.#primitiveType = _primitiveType;
    }

    // attribs: [RenderAttributes name, components used] pairs, interleaved in that order. Returns false if one isn't valid.
    load(attribs)
    {
        if (this.#vao !== null)
            return false; // Unload first

        let floats = 0;

        for (const [name, components] of attribs)
        {
            const max = RenderAttributes.componentCount(name);

            if (max === 0 || Number.isInteger(components) === false || components < 1 || components > max)
            {
                console.error(`DynamicMesh.load(): ${name} with ${components} components isn't a RenderAttributes name and size`);
                    return false;
            }

            floats += components;
        }

        const gl = WGLV.context;
        const stride = floats * 4;
        let offset = 0;

        this.#vao = gl.createVertexArray();
        this.#vertexBuffer = gl.createBuffer();
        this.#indexBuffer = gl.createBuffer();
        this.#floatsPerVertex = floats;

        gl.bindVertexArray(this.#vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.#vertexBuffer);

        for (const [name, components] of attribs)
        {
            const location = RenderAttributes.getLocation(name);

            if (location !== -1)
            {
                gl.vertexAttribPointer(location, components, gl.FLOAT, false, stride, offset);
                gl.enableVertexAttribArray(location);
            }

            offset += components * 4;
        }

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.#indexBuffer); // Part of the VAO's state
        gl.bindVertexArray(null);
            return true;
    }

    /*
        Replaces the contents with the first vertexCount vertices of vertices (a
        Float32Array, getFloatsPerVertex() floats each) and the first indexCount
        indices of indices (Uint16Array or Uint32Array). Returns false if not loaded
        or the arrays are too short or the wrong type.
    */
    setData(vertices, vertexCount, indices, indexCount)
    {
        if (this.#vao === null)
            return false;

        const gl = WGLV.context;
        const floatCount = vertexCount * this.#floatsPerVertex;
        let type = 0;
        let size = 0;

        if (indices instanceof Uint16Array) { type = gl.UNSIGNED_SHORT; size = 2; }
        else if (indices instanceof Uint32Array) { type = gl.UNSIGNED_INT; size = 4; }

        if ((vertices instanceof Float32Array) === false || type === 0 || vertices.length < floatCount || indices.length < indexCount)
        {
            console.error("DynamicMesh.setData() needs a Float32Array of vertices and a Uint16Array or Uint32Array of indices, long enough for the counts");
                return false;
        }

        // The index buffer is VAO state; bind the VAO so binding it doesn't change another VAO's
        gl.bindVertexArray(this.#vao);

        this.#vertexBytes = DynamicMesh.#upload(gl.ARRAY_BUFFER, this.#vertexBuffer, this.#vertexBytes, vertices, floatCount * 4);

        if (type !== this.#indexType)
            this.#indexBytes = 0; // Reallocate for the new type

        this.#indexBytes = DynamicMesh.#upload(gl.ELEMENT_ARRAY_BUFFER, this.#indexBuffer, this.#indexBytes, indices, indexCount * size);

        gl.bindVertexArray(null);

        this.#indexType = type;
        this.#indexSize = size;
        this.#vertexCount = vertexCount;
        this.#indexCount = indexCount;
            return true;
    }

    getFloatsPerVertex() { return this.#floatsPerVertex; }
    getVertexCount() { return this.#vertexCount; }
    getIndexCount() { return this.#indexCount; }
    isLoaded() { return (this.#vao !== null); }

    // Draws count indices from firstIndex (all of the last setData() by default); bind the shader and set its uniforms first
    render(firstIndex = 0, count = this.#indexCount - firstIndex)
    {
        if (this.#vao === null || count <= 0)
            return;

        const gl = WGLV.context;
        gl.bindVertexArray(this.#vao);
        gl.drawElements(this.#primitiveType, count, this.#indexType, firstIndex * this.#indexSize);
        gl.bindVertexArray(null);
    }

    unload()
    {
        const gl = WGLV.context;

        if (this.#vao !== null) gl.deleteVertexArray(this.#vao);
        if (this.#vertexBuffer !== null) gl.deleteBuffer(this.#vertexBuffer);
        if (this.#indexBuffer !== null) gl.deleteBuffer(this.#indexBuffer);

        this.#vao = null;
        this.#vertexBuffer = null;
        this.#indexBuffer = null;
        this.#vertexBytes = 0;
        this.#indexBytes = 0;
        this.#floatsPerVertex = 0;
        this.#indexType = 0;
        this.#indexSize = 0;
        this.#vertexCount = 0;
        this.#indexCount = 0;
    }

    // *** Internal Methods ***

    // Sends byteCount bytes of data to buffer (bound to target), growing it by doubling past allocated; returns its allocated size
    static #upload(target, buffer, allocated, data, byteCount)
    {
        const gl = WGLV.context;
        gl.bindBuffer(target, buffer);

        if (byteCount > allocated)
        {
            allocated = Math.max(allocated, DynamicMesh.#kStartBytes);

            while (allocated < byteCount)
                allocated *= 2;

            gl.bufferData(target, allocated, gl.DYNAMIC_DRAW);
        }

        if (byteCount > 0)
            gl.bufferSubData(target, 0, data, 0, byteCount / data.BYTES_PER_ELEMENT);

        return allocated;
    }
}
