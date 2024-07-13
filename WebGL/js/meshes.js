class StaticMesh
{
    #posBuffer;
    #uv0Buffer;
    #uv1Buffer;
    #indexBuffer;

    #primitiveType;    
    #indexType;
    #count;
    
    constructor(_primitiveType = WGL.context.TRIANGLES)
    {
        this.#posBuffer = null;
        this.#uv0Buffer = null;
        this.#uv1Buffer = null;
        this.#indexBuffer = null;

        this.#primitiveType = _primitiveType;
        this.#indexType = 0;
        this.#count = 0;        
    }

    loadPositionBuffer(pos)
    {
        if (pos == null)
            return false;
        else if (this.#posBuffer !== null)
            return false;
        else if (pos.length === 0)
            return false;

        this.#posBuffer = WGL.context.createBuffer();
            
        WGL.context.bindBuffer(WGL.context.ARRAY_BUFFER, this.#posBuffer);
        WGL.context.bufferData(WGL.context.ARRAY_BUFFER, pos, WGL.context.STATIC_DRAW);

        if (this.#primitiveType === WGL.context.TRIANGLES)
            this.#count = pos.length;

        return true;
    }

    loadUVBuffer(uvs, uvSet = 0)
    {
        if (uvs == null)
            return false;
        else if (uvs.length === 0)
            return false;
        
        switch (uvSet)
        {
            case 0:
            {
                if (this.#uv0Buffer !== null)
                    return false;

                this.#uv0Buffer = WGL.context.createBuffer();
            
                WGL.context.bindBuffer(WGL.context.ARRAY_BUFFER, this.#uv0Buffer);
                WGL.context.bufferData(WGL.context.ARRAY_BUFFER, uvs, WGL.context.STATIC_DRAW);    
            }
            break;

            default: return false;
        }

        return true;
    }

    loadIndexBuffer(indices)
    {
        if (indices == null)
            return false;
        else if (this.#indexBuffer !== null)
            return false;

        this.#indexBuffer = WGL.context.createBuffer();

        WGL.context.bindBuffer(WGL.context.ELEMENT_ARRAY_BUFFER, this.#indexBuffer);

        if (indices.length < 256)
        {
            WGL.context.bufferData(WGL.context.ELEMENT_ARRAY_BUFFER, indices, WGL.context.STATIC_DRAW);
            this.#indexType = WGL.context.UNSIGNED_BYTE;

            if (this.#primitiveType === WGL.context.TRIANGLES)
                this.#count = indices.length;            
        }
        else if (indices.length < 65536)
        {
            WGL.context.bufferData(WGL.context.ELEMENT_ARRAY_BUFFER, indices, WGL.context.STATIC_DRAW);
            this.#indexType = WGL.context.UNSIGNED_SHORT;

            if (this.#primitiveType === WGL.context.TRIANGLES)
                this.#count = indices.length;
        }
        else
            return false;
    }

    unload()
    {

    }

    render()
    {
        if (this.#indexBuffer !== null)
        {
            WGL.context.bindBuffer(WGL.context.ELEMENT_ARRAY_BUFFER, this.#indexBuffer);
            WGL.context.drawElements(this.#primitiveType, this.#count, this.#indexType, 0);
        }
        else
        {
            WGL.context.drawArrays(this.#primitiveType, 0, this.#count);
        }
    }

    getBuffer(materialAttribute)
    {
        let buff = null;

        if (materialAttribute === MaterialAttributes.kUV0)
        {
            buff = this.#uv0Buffer;
        }
        else if (materialAttribute === MaterialAttributes.kUV1)
        {
            buff = this.#uv1Buffer;
        }
        else if (materialAttribute === MaterialAttributes.kPosition)
        {
            buff = this.#posBuffer;
        }

        return buff;
    }
}