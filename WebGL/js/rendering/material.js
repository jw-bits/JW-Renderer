class Material
{
    #shader;
    #textures;
    
    #attribs;
    #uniforms;

    constructor()
    {
        this.#shader = null;
        this.#textures = [];
        this.#attribs = [];
        this.#uniforms = [];
    }

    load(_shader, textureArray)
    {
        if (this.#shader !== null)
            return false; // Already loaded

        if (textureArray != null)
        {
            if (Array.isArray(textureArray) && textureArray.length <= 4)
            {
                for (let i = 0; i < textureArray.length; ++i)
                    this.#textures.push(textureArray[i]);
            }
            else
                return false;
        }

        this.#shader = _shader;

        if (this.#setupAttributes() === false)
            return false;

        if (this.#setupUniforms() === false)
            return false;

        return true;
    }
    
    unload(unloadShader = false, unloadTextures = false)
    {
        if (this.#shader !== null)
        {
            if (unloadShader === true)
                this.#shader.unload();

            this.#shader = null;
        }

        if (this.#textures.length > 0)
        {
            if (unloadTextures === true)
            {
                while (this.#textures.length > 0)
                {
                    let t = this.#textures.pop();
                    t.unload();
                }
            }
            else
                this.#textures = [];            
        }

        this.#attribs = [];
        this.#uniforms = [];
    }

    setAttributeValue(_name, _value)
    {
        let m = this.#attribs.find((member) => member.name === _name);

        if (m !== undefined)
        {
            m.value = _value;
                return true;
        }

        return false;
    }

    setUniformValue(_name, _value)
    {
        let m = this.#uniforms.find((member) => member.name === _name);

        if (m !== undefined)
        {
            m.value = _value;
                return true;
        }

        return false;
    }

    bindShader()
    {
        this.#shader.bind();
    }

    bindAttributes(dataType = WGL.context.FLOAT)
    {
        for (let i = 0; i < this.#attribs.length; ++i)
        {
            let a = this.#attribs[i];

            WGL.context.enableVertexAttribArray(a.location);
            WGL.context.bindBuffer(WGL.context.ARRAY_BUFFER, a.value);
            WGL.context.vertexAttribPointer(a.location, a.componentCount, dataType, false, 0, 0);
        }
    }

    bindUniforms()
    {
        for (let i = 0; i < this.#uniforms.length; ++i)
        {
            let u = this.#uniforms[i];

            switch (u.componentCount)
            {
                case 1: // One-component is texture units only
                {
                    if (u.value < this.#textures.length)
                    {
                        this.#bindTexture(u.value);
                        WGL.context.uniform1f(u.location, u.value); 
                    }                    
                } 
                break;                
                
                case 2:  WGL.context.uniform2f(u.location, u.value.x, u.value.y); break;
                case 3:  WGL.context.uniform3f(u.location, u.value.x, u.value.y, u.value.z); break;
                case 4:  WGL.context.uniform4f(u.location, u.value.x, u.value.y, u.value.z, u.value.w); break;
                default: console.log("Unsupported uniform"); break;
            }
        }        
    }

    getRenderAttributes() { return this.#attribs; }
    getRenderUniforms() { return this.#uniforms; }

    // *** Internal Methods ***

    #setupAttributes()
    {
        for (let i = 0; i < RenderAttributes.allAttribs.length; ++i)
        {
            let aName = RenderAttributes.allAttribs[i];
            let idx = this.#shader.getAttrib(aName);

            if (idx !== -1)
            {
                let m = new RenderMapping();
                m.name = aName;
                m.location = idx;
                m.componentCount = RenderAttributes.componentCount(aName);

                this.#attribs.push(m);
            }
        }

        return (this.#attribs.length > 0);
    }

    #setupUniforms()
    {
        for (let i = 0; i < RenderUniforms.allUniforms.length; ++i)
        {
            let uName = RenderUniforms.allUniforms[i];
            let idx = this.#shader.getUniform(uName);

            if (idx !== null)
            {
                let m = new RenderMapping();
                m.name = uName;
                m.location = idx;
                m.componentCount = RenderUniforms.componentCount(uName);

                if (m.componentCount === 1)
                {
                    if (uName === "u_tex0")
                        m.value = 0;
                    else if (uName === "u_tex1")
                        m.value = 1;
                    else if (uName === "u_tex2")
                        m.value = 2;
                    else if (uName === "u_tex3")
                        m.value = 3;
                    else
                        m.value = 0;
                }                    
                else if (m.componentCount === 2)
                    m.value = Vector2.kZero;
                else if (m.componentCount === 3)
                    m.value = Vector3.kZero;
                else if (m.componentCount === 4)
                    m.value = Vector4.kBlack;
                else
                    return false;
                

                this.#uniforms.push(m);
            }
        }
    
        return (this.#uniforms.length > 0);
    }

    #bindTexture(textureIndex)
    {
        switch (textureIndex)
        {
            case 0: WGL.context.activeTexture(WGL.context.TEXTURE0); break;
            case 1: WGL.context.activeTexture(WGL.context.TEXTURE1); break;
            case 2: WGL.context.activeTexture(WGL.context.TEXTURE2); break;
            case 3: WGL.context.activeTexture(WGL.context.TEXTURE3); break;
            default: console.error("Only 4 texture units supported"); break;
        }

        let t = this.#textures[textureIndex];
        t.bind();
    }
}