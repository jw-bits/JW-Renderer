class MaterialAttributes
{
    // 2-component
    static kUV0 = "a_uv0";
    static kUV1 = "a_uv1";
    static kUV2 = "a_uv2";
    static kUV3 = "a_uv3";

    // 3-component
    static kPosition = "a_pos";
    static kNormal = "a_norm";

    static allAttribs = [];

    static componentCount(name)
    {
        for (let i = 0; i < this.allAttribs.length; ++i)
        {
            let n = this.allAttribs[i];

            if (n === name)
            {
                if (i <= 3)
                    return 2;
                else
                    return 3; 
            }
        }

        return 0;
    }

    static {
        this.allAttribs.push(MaterialAttributes.kUV0);
        this.allAttribs.push(MaterialAttributes.kUV1);
        this.allAttribs.push(MaterialAttributes.kUV2);
        this.allAttribs.push(MaterialAttributes.kUV3);
        this.allAttribs.push(MaterialAttributes.kPosition);
        this.allAttribs.push(MaterialAttributes.kNormal);
    }
}

class MaterialUniforms
{
    // 1-component
    static kTexture0 = "u_tex0";
    static kTexture1 = "u_tex1";
    static kTexture2 = "u_tex2";
    static kTexture3 = "u_tex3";
    static #kOneEnd = 4;

    // 2-component
    static kUVTile = "u_uvTile"; // (X, Y) => (U = U * X, V = V * Y)
    static kUVOffset = "u_uvOffset"; // (X, Y) => (U = U + X, V = V + Y)
    static kResolution = "u_res"; // (W, H)
    static #kTwoEnd = 7;

    // 3-component
    static kScale = "u_scale"; // (SX, SY, SZ)
    static kEulerRotation = "u_euler"; // (EX, EY, EZ) as radians
    static #kThreeEnd = 9;

    // 4-component
    static kColor = "u_color"; // (R, G, B, A) as floats
    static kVector0 = "u_vec0"; // (X, Y, Z, W) as floats
    static kVector1 = "u_vec1"; // (X, Y, Z, W) as floats
    static kVector2 = "u_vec2"; // (X, Y, Z, W) as floats
    static kVector3 = "u_vec3"; // (X, Y, Z, W) as floats
    
    static allUniforms = [];

    static componentCount(name)
    {
        for (let i = 0; i < this.allUniforms.length; ++i)
        {
            let n = this.allUniforms[i];

            if (n === name)
            {
                if (i < MaterialUniforms.#kOneEnd)
                    return 1;
                else if (i < MaterialUniforms.#kTwoEnd)
                    return 2;
                else if (i < MaterialUniforms.#kThreeEnd)
                    return 3;
                else
                    return 4;
            }
        }

        return 0;
    }

    static {
        this.allUniforms.push(MaterialUniforms.kTexture0);
        this.allUniforms.push(MaterialUniforms.kTexture1);
        this.allUniforms.push(MaterialUniforms.kTexture2);
        this.allUniforms.push(MaterialUniforms.kTexture3);
        this.allUniforms.push(MaterialUniforms.kUVTile);
        this.allUniforms.push(MaterialUniforms.kUVOffset);
        this.allUniforms.push(MaterialUniforms.kResolution);
        this.allUniforms.push(MaterialUniforms.kScale);
        this.allUniforms.push(MaterialUniforms.kEulerRotation);
        this.allUniforms.push(MaterialUniforms.kColor);
        this.allUniforms.push(MaterialUniforms.kVector0);
        this.allUniforms.push(MaterialUniforms.kVector1);
        this.allUniforms.push(MaterialUniforms.kVector2);
        this.allUniforms.push(MaterialUniforms.kVector3);
    }
}

class MaterialMember
{
    constructor()
    {
        this.name = "";
        this.location = -1;
        this.componentCount = 0;
        this.value = null;
    }
}

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

    setMemberValue(_name, _value)
    {
        let m = this.#uniforms.find((member) => member.name === _name);

        if (m !== undefined)
        {
            m.value = _value;
                return true;
        }

        return false;
    }

    setAttributeValuesFromMesh(mesh)
    {
        for (let i = 0; i < this.#attribs.length; ++i)
        {
            let m = this.#attribs[i];
            let buff = mesh.getBuffer(m.name);

            if (buff !== null)
                m.value = buff;
        }
    }

    bind()
    {
        this.#shader.bind();

        for (let i = 0; i < this.#attribs.length; ++i)
        {
            let a = this.#attribs[i];

            WGL.context.enableVertexAttribArray(a.location);
            WGL.context.bindBuffer(WGL.context.ARRAY_BUFFER, a.value);
            WGL.context.vertexAttribPointer(a.location, a.componentCount, WGL.context.FLOAT, false, 0, 0);
        }

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

    // *** Internal Methods ***

    #setupAttributes()
    {
        for (let i = 0; i < MaterialAttributes.allAttribs.length; ++i)
        {
            let aName = MaterialAttributes.allAttribs[i];
            let idx = this.#shader.getAttrib(aName);

            if (idx !== -1)
            {
                let m = new MaterialMember();
                m.name = aName;
                m.location = idx;
                m.componentCount = MaterialAttributes.componentCount(aName);

                this.#attribs.push(m);
            }
        }

        return (this.#attribs.length > 0);
    }

    #setupUniforms()
    {
        for (let i = 0; i < MaterialUniforms.allUniforms.length; ++i)
        {
            let uName = MaterialUniforms.allUniforms[i];
            let idx = this.#shader.getUniform(uName);

            if (idx !== null)
            {
                let m = new MaterialMember();
                m.name = uName;
                m.location = idx;
                m.componentCount = MaterialUniforms.componentCount(uName);

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