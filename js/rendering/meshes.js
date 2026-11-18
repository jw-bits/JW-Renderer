class VertexFloatBuffer
{
    #bufferId;
    #isDynamic;

    constructor(_isDynamic = false)
    {
        this.#isDynamic = _isDynamic;
        this.#bufferId = null;
        this.#bufferId = WGLV.context.createBuffer();               
    }

    set(_data)
    {
        try
        {
            if (_data.BYTES_PER_ELEMENT !== 4)
                return false;
        }
        catch
        {
            return false; // Not Float32Array
        }

        WGLV.context.bindBuffer(WGLV.context.ARRAY_BUFFER, this.#bufferId);
        WGLV.context.bufferData(WGLV.context.ARRAY_BUFFER, _data, (this.#isDynamic === true) ? WGLV.context.DYNAMIC_DRAW : WGLV.context.STATIC_DRAW);
            return true;
    }

    getBufferId() { return this.#bufferId; } 
}

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

        if (this.#bufferId === null)
            this.#bufferId = WGLV.context.createBuffer();

        this.#indexCount = _data.length;
        
        WGLV.context.bindBuffer(WGLV.context.ELEMENT_ARRAY_BUFFER, this.#bufferId);

        if (this.#indexCount < 256)
        {
            WGLV.context.bufferData(WGLV.context.ELEMENT_ARRAY_BUFFER, _data, WGLV.context.STATIC_DRAW);
            this.#glDataType = WGLV.context.UNSIGNED_BYTE; 
                return true;         
        }
        else if (this.#indexCount < 65536)
        {
            WGLV.context.bufferData(WGLV.context.ELEMENT_ARRAY_BUFFER, _data, WGLV.context.STATIC_DRAW);
            this.#glDataType = WGLV.context.UNSIGNED_SHORT;
                return true;
        }
        else
        {
            WGLV.context.bufferData(WGLV.context.ELEMENT_ARRAY_BUFFER, _data, WGLV.context.STATIC_DRAW);
            this.#glDataType = WGLV.context.UNSIGNED_INT;
                return true;
        }
    }

    getBufferId() { return this.#bufferId; }
    getDataType() { return this.#glDataType; }
    getIndexCount() { return this.#indexCount; }

    unload()
    {
        if (this.#bufferId !== null)
            WGLV.context.deleteBuffer(this.#bufferId);

        this.#glDataType = 0;        
        this.#indexCount = 0;
    }
}

class PointsMesh
{
    #vertexBuffer;
    #count;
    #vao;

    constructor()
    {
        this.#vertexBuffer = new VertexFloatBuffer(true);
        this.#count = 0;
        this.#vao = WGLV.context.createVertexArray();
    }

    set(_positions)
    {
        if (_positions == null || _positions.length === 0)
            return false;

        this.#vertexBuffer.set(_positions);
        this.#count = _positions.length / 3;

        WGLV.context.bindVertexArray(this.#vao);
        WGLV.context.bindBuffer(WGLV.context.ARRAY_BUFFER, this.#vertexBuffer.getBufferId());
        WGLV.context.vertexAttribPointer(RenderAttributes.getLocation(RenderAttributes.kPosition), 3, WGLV.context.FLOAT, false, 0, 0);
        WGLV.context.enableVertexAttribArray(RenderAttributes.getLocation(RenderAttributes.kPosition));
        WGLV.context.bindVertexArray(null);
    }

    render()
    {
        WGLV.context.bindVertexArray(this.#vao);
        WGLV.context.drawArrays(WGLV.context.POINTS, 0, this.#count);
        WGLV.context.bindVertexArray(null);
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
            return false;

        if (this.#count === 0)
            this.#count = data.length / RenderAttributes.componentCount(materialAttribName);
        else
        {
            const c = data.length / RenderAttributes.componentCount(materialAttribName);
            
            if (this.#count !== c)
                return false;
        }

        this.#vertexBuffers.set(materialAttribName, vb);
            return true;
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

    unload()
    {

    }

    /*
        Records the vertex buffers (at RenderAttributes' fixed locations) and the
        index buffer in this mesh's VAO. Call once, after all setVertexData() and
        setIndexData() calls; the mesh then works with any shader using those locations.
    */
    bindAttribs()
    {
        // Bind to VAO
        WGLV.context.bindVertexArray(this.#vao);

        for (const [key, value] of this.#vertexBuffers) {
            const materialAttribName = key;
            const vb = value;
            
            WGLV.context.bindBuffer(WGLV.context.ARRAY_BUFFER, vb.getBufferId());
    
            const numberOfComponents = RenderAttributes.componentCount(materialAttribName);
            const shaderLocation = RenderAttributes.getLocation(materialAttribName);
    
            if (shaderLocation !== -1) {
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
        WGLV.context.bindVertexArray(this.#vao);

        if (this.#indexBuffer !== null)
        {
            WGLV.context.drawElements(this.#primitiveType, this.#indexBuffer.getIndexCount(), this.#indexBuffer.getDataType(), 0);
        }
        else
        {
            WGLV.context.drawArrays(this.#primitiveType, 0, this.#count);
        }

        WGLV.context.bindVertexArray(null);
    }
}