"use strict";

/*
    GPU buffers:
        VertexFloatBuffer   Vertex data, 32-bit floats (ARRAY_BUFFER)
        IndexBuffer         Triangle indices (ELEMENT_ARRAY_BUFFER)
        UniformBuffer       A uniform block's values (UNIFORM_BUFFER), shared by every shader using the block
*/

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

/*
    UniformBuffer - The values of one uniform block (see RenderUniformBlocks),
    attached to the block's binding point. Every shader that declares the block
    reads the same buffer (Shader.load() points the block at the binding
    point), so the values are
    uploaded once, not per shader or per draw.

    The data is laid out by the block's std140 rules: in floats, a vec2 starts
    on a multiple of 2, a vec3 / vec4 on a multiple of 4, and each column of a
    mat3 takes 4 floats (the 4th unused).

    Usage:
        let ubo = new UniformBuffer();
        ubo.load(RenderUniformBlocks.kFrame, 16);   // 16 floats
        ubo.update(data);                           // A Float32Array, from float 0
*/
class UniformBuffer
{
    #bufferId;
    #binding;
    #floatCount;

    constructor()
    {
        this.#bufferId = null;
        this.#binding = -1;
        this.#floatCount = 0;
    }

    // Allocates floatCount floats (zeros) for blockName's block and attaches them to its binding point
    load(blockName, floatCount)
    {
        if (this.#bufferId !== null)
            return false; // Unload first

        const binding = RenderUniformBlocks.getBinding(blockName);

        if (binding === -1)
        {
            console.error(`UniformBuffer.load(): "${blockName}" isn't in RenderUniformBlocks`);
                return false;
        }

        if (Number.isInteger(floatCount) === false || floatCount <= 0)
        {
            console.error("UniformBuffer.load() needs a float count above 0");
                return false;
        }

        const gl = WGLV.context;

        this.#bufferId = gl.createBuffer();
        gl.bindBuffer(gl.UNIFORM_BUFFER, this.#bufferId);
        gl.bufferData(gl.UNIFORM_BUFFER, floatCount * 4, gl.DYNAMIC_DRAW);
        gl.bindBufferBase(gl.UNIFORM_BUFFER, binding, this.#bufferId);

        this.#binding = binding;
        this.#floatCount = floatCount;
            return true;
    }

    // Copies data (a Float32Array) into the buffer, starting at firstFloat
    update(data, firstFloat = 0)
    {
        if (this.#bufferId === null || (data instanceof Float32Array) === false || firstFloat + data.length > this.#floatCount)
            return false;

        const gl = WGLV.context;
        gl.bindBuffer(gl.UNIFORM_BUFFER, this.#bufferId);
        gl.bufferSubData(gl.UNIFORM_BUFFER, firstFloat * 4, data);
            return true;
    }

    getBufferId() { return this.#bufferId; }
    getBinding() { return this.#binding; }
    getFloatCount() { return this.#floatCount; }
    isLoaded() { return (this.#bufferId !== null); }

    unload()
    {
        if (this.#bufferId !== null)
        {
            WGLV.context.deleteBuffer(this.#bufferId);
            this.#bufferId = null;
        }

        this.#binding = -1;
        this.#floatCount = 0;
    }
}
