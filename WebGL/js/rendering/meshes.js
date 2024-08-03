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

    setVertexData(_data)
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
        WGL.context.bufferData(WGL.context.ARRAY_BUFFER, _data, (this.#isDynamic === true) ? WGL.context.DYNAMIC_ARRAY : WGL.context.STATIC_DRAW);
            return true;
    }

    enableAttribute(shaderLocation, numberOfComponents)
    {
        WGL.context.enableVertexAttribArray(shaderLocation);
        WGL.context.bindBuffer(WGL.context.ARRAY_BUFFER, this.#bufferId);
        WGL.context.vertexAttribPointer(shaderLocation, numberOfComponents, WGL.context.FLOAT, false, 0, 0);
    }
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

    setStaticIndexData(_data)
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
            return false; // Too large
    }

    render(primType)
    {
        WGL.context.bindBuffer(WGL.context.ELEMENT_ARRAY_BUFFER, this.#bufferId);
        WGL.context.drawElements(primType, this.#indexCount, this.#glDataType, 0);
    }

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

    constructor()
    {
        this.#vertexBuffer = new VertexFloatBuffer(true);
        this.#count = 0;
    }

    set(_positions)
    {
        if (_positions == null || _positions.length === 0)
            return false;

        this.#vertexBuffer.setVertexData(_positions);
        this.#count = _positions.length;
    }

    render()
    {
        WGL.context.drawArrays(WGL.context.POINTS, 0, this.#count);
    }
}

class StaticMesh
{
    #vertexBuffers;
    #indexBuffer;

    #primitiveType;
    #count;
    
    constructor(_primitiveType = WGL.context.TRIANGLES)
    {
        this.#vertexBuffers = new Map();
        this.#indexBuffer = null;

        this.#primitiveType = _primitiveType;
        this.#count = 0;        
    }

    loadVertexData(materialAttribName, data)
    {
        if (RenderAttributes.allAttribs.includes(materialAttribName) === false)
            return false;

        if (data == null)
            return false;

        let vb = new VertexFloatBuffer();

        if (vb.setVertexData(data) === false)
            return false;

        if (materialAttribName === RenderAttributes.kPosition)
            this.#count = data.length;

        this.#vertexBuffers.set(materialAttribName, vb);
            return true;
    }

    loadIndexBuffer(indices)
    {
        if (indices == null)
            return false;
        else if (this.#indexBuffer !== null)
            return false;

        this.#indexBuffer = new IndexBuffer();
            return this.#indexBuffer.setStaticIndexData(indices);
    }

    unload()
    {

    }

    bindVertexAttribute(renderMapping)
    {
        if (this.#vertexBuffers.has(renderMapping.name) === true)
        {
            let vb = this.#vertexBuffers.get(renderMapping.name);
            vb.enableAttribute(renderMapping.location, renderMapping.componentCount);
        }
    }

    render()
    {
        if (this.#indexBuffer !== null)
        {
            this.#indexBuffer.render(this.#primitiveType);
        }
        else
        {
            WGL.context.drawArrays(this.#primitiveType, 0, this.#count);
        }
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