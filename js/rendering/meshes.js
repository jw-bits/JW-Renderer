class VertexFloatBuffer
{
    #bufferId;
    #isDynamic;

    constructor(_isDynamic = false)
    {
        this.#isDynamic = _isDynamic;
        this.#bufferId = null;
        this.#bufferId = WGL.context.createBuffer();               
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

        WGL.context.bindBuffer(WGL.context.ARRAY_BUFFER, this.#bufferId);
        WGL.context.bufferData(WGL.context.ARRAY_BUFFER, _data, (this.#isDynamic === true) ? WGL.context.DYNAMIC_DRAW : WGL.context.STATIC_DRAW);
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
            this.#bufferId = WGL.context.createBuffer();

        this.#indexCount = _data.length;
        
        WGL.context.bindBuffer(WGL.context.ELEMENT_ARRAY_BUFFER, this.#bufferId);

        if (this.#indexCount < 256)
        {
            WGL.context.bufferData(WGL.context.ELEMENT_ARRAY_BUFFER, _data, WGL.context.STATIC_DRAW);
            this.#glDataType = WGL.context.UNSIGNED_BYTE; 
                return true;         
        }
        else if (this.#indexCount < 65536)
        {
            WGL.context.bufferData(WGL.context.ELEMENT_ARRAY_BUFFER, _data, WGL.context.STATIC_DRAW);
            this.#glDataType = WGL.context.UNSIGNED_SHORT;
                return true;
        }
        else
        {
            WGL.context.bufferData(WGL.context.ELEMENT_ARRAY_BUFFER, _data, WGL.context.STATIC_DRAW);
            this.#glDataType = WGL.context.UNSIGNED_INT;
                return true;
        }
    }

    getBufferId() { return this.#bufferId; }
    getDataType() { return this.#glDataType; }
    getIndexCount() { return this.#indexCount; }

    // render(primType)
    // {
    //     WGL.context.bindBuffer(WGL.context.ELEMENT_ARRAY_BUFFER, this.#bufferId);
    //     WGL.context.drawElements(primType, this.#indexCount, this.#glDataType, 0);
    // }

    unload()
    {
        if (this.#bufferId !== null)
            WGL.context.deleteBuffer(this.#bufferId);

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
        this.#vao = WGL.context.createVertexArray();
    }

    set(_positions)
    {
        if (_positions == null || _positions.length === 0)
            return false;

        this.#vertexBuffer.set(_positions);
        this.#count = _positions.length / 3;

        WGL.context.bindVertexArray(this.#vao);
        WGL.context.bindBuffer(WGL.context.ARRAY_BUFFER, this.#vertexBuffer.getBufferId());
        WGL.context.vertexAttribPointer(RenderAttributes.getLocation(RenderAttributes.kPosition), 3, WGL.context.FLOAT, false, 0, 0);
        WGL.context.enableVertexAttribArray(RenderAttributes.getLocation(RenderAttributes.kPosition));
        WGL.context.bindVertexArray(null);
    }

    render()
    {
        WGL.context.bindVertexArray(this.#vao);
        WGL.context.drawArrays(WGL.context.POINTS, 0, this.#count);
        WGL.context.bindVertexArray(null);
    }
}

class StaticMesh
{
    #vertexBuffers;
    #indexBuffer;
    #vao;

    #primitiveType;
    #count;
    
    constructor(_primitiveType = WGL.context.TRIANGLES)
    {
        this.#vertexBuffers = new Map();
        this.#indexBuffer = null;
        this.#vao = WGL.context.createVertexArray();

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
        const success = this.#indexBuffer.set(indices);
        
        WGL.context.bindVertexArray(this.#vao);
        // Index buffer binding is part of VAO state
        return success;
    }

    unload()
    {

    }

    bindMaterial(material)
    {
        // Bind to VAO
        WGL.context.bindVertexArray(this.#vao);

        for (const [key, value] of this.#vertexBuffers) {
            const materialAttribName = key;
            const vb = value;
            
            WGL.context.bindBuffer(WGL.context.ARRAY_BUFFER, vb.getBufferId());
    
            const numberOfComponents = RenderAttributes.componentCount(materialAttribName);
            const shaderLocation = RenderAttributes.getLocation(materialAttribName);
    
            if (shaderLocation !== -1) {
                WGL.context.vertexAttribPointer(shaderLocation, numberOfComponents, WGL.context.FLOAT, false, 0, 0);
                WGL.context.enableVertexAttribArray(shaderLocation);
            }
        }

        if (this.#indexBuffer !== null)
            WGL.context.bindBuffer(WGL.context.ELEMENT_ARRAY_BUFFER, this.#indexBuffer.getBufferId());

        WGL.context.bindVertexArray(null);
    }

    render()
    {
        WGL.context.bindVertexArray(this.#vao);

        if (this.#indexBuffer !== null)
        {
            WGL.context.drawElements(this.#primitiveType, this.#indexBuffer.getIndexCount(), this.#indexBuffer.getDataType(), 0);
        }
        else
        {
            WGL.context.drawArrays(this.#primitiveType, 0, this.#count);
        }

        WGL.context.bindVertexArray(null);
    }
}

// class StaticMesh
// {
//     #posBuffer;
//     #uv0Buffer;
//     #uv1Buffer;
//     #indexBuffer;

//     #primitiveType;    
//     #indexType;
//     #count;
    
//     constructor(_primitiveType = WGL.context.TRIANGLES)
//     {
//         this.#posBuffer = null;
//         this.#uv0Buffer = null;
//         this.#uv1Buffer = null;
//         this.#indexBuffer = null;

//         this.#primitiveType = _primitiveType;
//         this.#indexType = 0;
//         this.#count = 0;        
//     }

//     loadPositionBuffer(pos)
//     {
//         if (pos == null)
//             return false;
//         else if (this.#posBuffer !== null)
//             return false;
//         else if (pos.length === 0)
//             return false;

//         this.#posBuffer = WGL.context.createBuffer();
            
//         WGL.context.bindBuffer(WGL.context.ARRAY_BUFFER, this.#posBuffer);
//         WGL.context.bufferData(WGL.context.ARRAY_BUFFER, pos, WGL.context.STATIC_DRAW);

//         if (this.#primitiveType === WGL.context.TRIANGLES)
//             this.#count = pos.length;

//         return true;
//     }

//     loadUVBuffer(uvs, uvSet = 0)
//     {
//         if (uvs == null)
//             return false;
//         else if (uvs.length === 0)
//             return false;
        
//         switch (uvSet)
//         {
//             case 0:
//             {
//                 if (this.#uv0Buffer !== null)
//                     return false;

//                 this.#uv0Buffer = WGL.context.createBuffer();
            
//                 WGL.context.bindBuffer(WGL.context.ARRAY_BUFFER, this.#uv0Buffer);
//                 WGL.context.bufferData(WGL.context.ARRAY_BUFFER, uvs, WGL.context.STATIC_DRAW);    
//             }
//             break;

//             default: return false;
//         }

//         return true;
//     }

//     loadIndexBuffer(indices)
//     {
//         if (indices == null)
//             return false;
//         else if (this.#indexBuffer !== null)
//             return false;

//         this.#indexBuffer = WGL.context.createBuffer();

//         WGL.context.bindBuffer(WGL.context.ELEMENT_ARRAY_BUFFER, this.#indexBuffer);

//         if (indices.length < 256)
//         {
//             WGL.context.bufferData(WGL.context.ELEMENT_ARRAY_BUFFER, indices, WGL.context.STATIC_DRAW);
//             this.#indexType = WGL.context.UNSIGNED_BYTE;

//             if (this.#primitiveType === WGL.context.TRIANGLES)
//                 this.#count = indices.length;            
//         }
//         else if (indices.length < 65536)
//         {
//             WGL.context.bufferData(WGL.context.ELEMENT_ARRAY_BUFFER, indices, WGL.context.STATIC_DRAW);
//             this.#indexType = WGL.context.UNSIGNED_SHORT;

//             if (this.#primitiveType === WGL.context.TRIANGLES)
//                 this.#count = indices.length;
//         }
//         else
//             return false;
//     }

//     unload()
//     {

//     }

//     render()
//     {
//         if (this.#indexBuffer !== null)
//         {
//             WGL.context.bindBuffer(WGL.context.ELEMENT_ARRAY_BUFFER, this.#indexBuffer);
//             WGL.context.drawElements(this.#primitiveType, this.#count, this.#indexType, 0);
//         }
//         else
//         {
//             WGL.context.drawArrays(this.#primitiveType, 0, this.#count);
//         }
//     }

//     getBuffer(materialAttribute)
//     {
//         let buff = null;

//         if (materialAttribute === RenderAttributes.kUV0)
//         {
//             buff = this.#uv0Buffer;
//         }
//         else if (materialAttribute === RenderAttributes.kUV1)
//         {
//             buff = this.#uv1Buffer;
//         }
//         else if (materialAttribute === RenderAttributes.kPosition)
//         {
//             buff = this.#posBuffer;
//         }

//         return buff;
//     }
// }