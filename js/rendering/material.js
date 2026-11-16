class Material
{
    #shader;
    #textures;
    
    #uniforms;

    constructor()
    {
        this.#shader = null;
        this.#textures = [];
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

        this.#uniforms = [];
    }

    // setAttributeValue(_name, _value)
    // {
    //     let m = this.#attribs.find((member) => member.name === _name);

    //     if (m !== undefined)
    //     {
    //         m.value = _value;
    //             return true;
    //     }

    //     return false;
    // }

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

    getUniformValue(_name)
    {
        let m = this.#uniforms.find((member) => member.name === _name);
        if (m !== undefined) {
            return m.value;
        }
        return null;
    }

    bindShader()
    {
        this.#shader.bind();
    }

    getAttribLocation(name)
    {
        return this.#shader.getAttrib(name);
    }

    getUniformLocation(name)
    {
        return this.#shader.getUniform(name);
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
                        WGL.context.uniform1i(u.location, u.value); 
                    }                    
                } 
                break;                
                
                case 2:  WGL.context.uniform2f(u.location, u.value.x, u.value.y); break;
                case 3:  WGL.context.uniform3f(u.location, u.value.x, u.value.y, u.value.z); break;
                case 4:  WGL.context.uniform4f(u.location, u.value.x, u.value.y, u.value.z, u.value.w); break;
                case 16: WGL.context.uniformMatrix4fv(u.location, false, u.value.m); break;
                default: console.log("Unsupported uniform"); break;
            }
        }        
    }

    getRenderUniforms() { return this.#uniforms; }

    // *** Internal Methods ***

    #setupUniforms()
    {
        for (const [uName, componentCount] of RenderUniforms.allUniforms)
        {
            let idx = this.#shader.getUniform(uName);

            if (idx !== null)
            {
                let m = new RenderMapping();
                m.name = uName;
                m.location = idx;
                m.componentCount = componentCount;

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
                    m.value = new Vector2();
                else if (m.componentCount === 3)
                    m.value = new Vector3();
                else if (m.componentCount === 4)
                    m.value = new Vector4();
                else if (m.componentCount === 16)
                    m.value = new Matrix4();
                else
                    return false;
                
                this.#uniforms.push(m);
            }
        }
    
        return true;
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