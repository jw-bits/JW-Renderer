"use strict";

// A GPU buffer of 32-bit floats (vertex data)
class VertexFloatBuffer
{
    #bufferId;
    #isDynamic;

    constructor(_isDynamic = false)
    {
        this.#isDynamic = _isDynamic;
        this.#bufferId = WGLV.context.createBuffer();
    }

    // _data must be a Float32Array
    set(_data)
    {
        if ((_data instanceof Float32Array) === false || this.#bufferId === null)
            return false;

        WGLV.context.bindBuffer(WGLV.context.ARRAY_BUFFER, this.#bufferId);
        WGLV.context.bufferData(WGLV.context.ARRAY_BUFFER, _data, (this.#isDynamic === true) ? WGLV.context.DYNAMIC_DRAW : WGLV.context.STATIC_DRAW);
            return true;
    }

    // Replaces the contents with _data (a Float32Array) of the same length as set(), without reallocating
    update(_data)
    {
        if ((_data instanceof Float32Array) === false || this.#bufferId === null)
            return false;

        WGLV.context.bindBuffer(WGLV.context.ARRAY_BUFFER, this.#bufferId);
        WGLV.context.bufferSubData(WGLV.context.ARRAY_BUFFER, 0, _data);
            return true;
    }

    getBufferId() { return this.#bufferId; }

    unload()
    {
        if (this.#bufferId !== null)
        {
            WGLV.context.deleteBuffer(this.#bufferId);
            this.#bufferId = null;
        }
    }
}

/*
    A GPU buffer of triangle indices. The GL index type comes from the array:
    Uint8Array, Uint16Array or Uint32Array (UNSIGNED_BYTE / SHORT / INT).
*/
class IndexBuffer
{
    #bufferId;
    #glDataType;
    #indexCount;

    constructor()
    {
        this.#bufferId = null;
        this.#glDataType = 0;
        this.#indexCount = 0;
    }

    set(_data)
    {
        if (this.#indexCount !== 0)
            return false; // Already set

        const gl = WGLV.context;
        let type = 0;

        if (_data instanceof Uint8Array) type = gl.UNSIGNED_BYTE;
        else if (_data instanceof Uint16Array) type = gl.UNSIGNED_SHORT;
        else if (_data instanceof Uint32Array) type = gl.UNSIGNED_INT;
        else
        {
            console.error("IndexBuffer.set() needs a Uint8Array, Uint16Array or Uint32Array");
                return false;
        }

        if (this.#bufferId === null)
            this.#bufferId = gl.createBuffer();

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.#bufferId);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, _data, gl.STATIC_DRAW);

        this.#glDataType = type;
        this.#indexCount = _data.length;
            return true;
    }

    getBufferId() { return this.#bufferId; }
    getDataType() { return this.#glDataType; }
    getIndexCount() { return this.#indexCount; }

    unload()
    {
        if (this.#bufferId !== null)
        {
            WGLV.context.deleteBuffer(this.#bufferId);
            this.#bufferId = null;
        }

        this.#glDataType = 0;
        this.#indexCount = 0;
    }
}

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

    setVertexData(materialAttribName, data)
    {
        if (RenderAttributes.allAttribs.has(materialAttribName) === false)
            return false;

        if (data == null)
            return false;

        let vb = new VertexFloatBuffer();

        if (vb.set(data) === false)
        {
            vb.unload();
                return false;
        }

        const c = data.length / RenderAttributes.componentCount(materialAttribName);

        if (this.#count !== 0 && this.#count !== c)
        {
            vb.unload();
                return false;
        }

        this.#count = c;
        this.#vertexBuffers.get(materialAttribName)?.unload(); // Replacing one
        this.#vertexBuffers.set(materialAttribName, vb);
            return true;
    }

    /*
        Replaces a vertex buffer's contents in place, e.g. positions moved each
        frame. data must be a Float32Array with as many vertices as before; the
        VAO keeps pointing at the same buffer, so bindAttribs() isn't needed again.
    */
    updateVertexData(materialAttribName, data)
    {
        const vb = this.#vertexBuffers.get(materialAttribName);

        if (vb === undefined || data == null || (data.length / RenderAttributes.componentCount(materialAttribName)) !== this.#count)
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

        for (const [materialAttribName, vb] of this.#vertexBuffers)
        {
            WGLV.context.bindBuffer(WGLV.context.ARRAY_BUFFER, vb.getBufferId());

            const numberOfComponents = RenderAttributes.componentCount(materialAttribName);
            const shaderLocation = RenderAttributes.getLocation(materialAttribName);

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
    MaterialBatcher (Rect2Ds, Sprites) and Particles2D.

    The quad's 4 corners (x, y pairs, counter-clockwise from the bottom-left)
    go to RenderAttributes' position location. Each instance attribute is
    [location, componentCount, offset in floats] within floatsPerInstance floats.

    Usage:
        let mesh = new InstancedQuadMesh();
        mesh.load(new Float32Array([0, 0,  1, 0,  1, 1,  0, 1]), 8, [[8, 4, 0], [9, 4, 4]]);
        mesh.setInstanceData(new Float32Array(capacity * 8)); // Allocates (and fills) the buffer
        mesh.updateInstanceData(data, 0, count * 8);          // Changes part of it
        shader.bind(); ...uniforms...
        mesh.render(count);
*/
class InstancedQuadMesh
{
    #vao;
    #quadBuffer;
    #indexBuffer;
    #instBuffer;

    constructor()
    {
        this.#vao = null;
        this.#quadBuffer = null;
        this.#indexBuffer = null;
        this.#instBuffer = null;
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
        const bytes = 4;
        const strideBytes = floatsPerInstance * bytes;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.#instBuffer);

        for (const [location, size, offset] of attribs)
        {
            gl.vertexAttribPointer(location, size, gl.FLOAT, false, strideBytes, offset * bytes);
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

    // Draws instanceCount quads; bind the shader and set its uniforms first
    render(instanceCount)
    {
        if (this.#vao === null || instanceCount <= 0)
            return;

        const gl = WGLV.context;
        gl.bindVertexArray(this.#vao);
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
    }
}
