/*
    Material - A shader, up to 4 textures, and the sampler state for each
    texture unit. That's all it holds, so one Material can be shared by any
    number of models (see MaterialManager).

    Each texture unit is drawn with its Sampler (filtering and wrapping). A
    unit without one uses a shared default: trilinear (LINEAR_MIPMAP_LINEAR /
    LINEAR) if its texture has mipmaps, otherwise LINEAR / LINEAR; both clamp.

    Uniform values (position, color, ...) belong to whatever is being drawn,
    not the Material. Bind the Material, then upload them:

        material.bind();                       // Shader, textures, samplers
        material.setUniform("u_color", color); // Uploaded right away
        mesh.render();

    Usage:
        let m = new Material();
        m.load(shader, [texture], [sampler]); // Samplers are optional, per unit
        m.setSampler(0, repeatSampler);       // Or set / change one later

    Samplers and textures belong to the caller; one can be shared by many Materials.
*/
class Material
{
    // Shared defaults, created the first time they're needed
    static #kDefaultSampler = null;
    static #kDefaultMipmapSampler = null;

    // Ids for the shaders, textures and samplers in getKey(); weak, so they don't keep anything alive
    static #kIds = new WeakMap();
    static #kNextId = 1;

    #shader;
    #textures;
    #samplers; // Per texture unit; null uses a default

    #uniforms; // Name -> RenderMapping (location and component count) for the shader's uniforms

    constructor()
    {
        this.#shader = null;
        this.#textures = [];
        this.#samplers = [null, null, null, null];
        this.#uniforms = new Map();
    }

    // samplerArray is optional: one Sampler (or null for the default) per texture
    load(_shader, textureArray, samplerArray = null)
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

        if (samplerArray != null)
        {
            if (Array.isArray(samplerArray) === false || samplerArray.length > 4)
                return false;

            for (let i = 0; i < samplerArray.length; ++i)
                this.#samplers[i] = samplerArray[i] ?? null;
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

        this.#samplers = [null, null, null, null]; // Samplers belong to the caller
        this.#uniforms = new Map();
    }

    // The sampler for a texture unit (0 - 3); null goes back to the default
    setSampler(unit, sampler)
    {
        if (unit < 0 || unit > 3)
        {
            console.error("Material.setSampler(): only texture units 0 - 3 are supported");
                return false;
        }

        this.#samplers[unit] = sampler ?? null;
            return true;
    }

    // The sampler set for a unit, or null if it uses the default
    getSampler(unit = 0) { return this.#samplers[unit] ?? null; }

    getShader() { return this.#shader; }

    /*
        Identifies what makes this material: its shader, textures, and samplers.
        Two Materials built from the same objects get the same key, e.g.
        "s3|t7,9|p-,12" (shader 3, textures 7 and 9, unit 0 default sampler,
        unit 1 sampler 12). Uniform values aren't part of it. null if not loaded.
    */
    getKey()
    {
        if (this.#shader === null)
            return null;

        const textures = this.#textures.map((t) => Material.#idOf(t));
        const samplers = this.#textures.map((t, i) => (this.#samplers[i] !== null) ? Material.#idOf(this.#samplers[i]) : "-");

        return `s${Material.#idOf(this.#shader)}|t${textures.join(",")}|p${samplers.join(",")}`;
    }

    // Binds the shader, and each texture with its sampler. Call before setUniform() and drawing.
    bind()
    {
        this.#shader.bind();

        for (const u of this.#uniforms.values())
        {
            if (u.componentCount === 1 && u.value < this.#textures.length) // Texture units
            {
                this.#bindTexture(u.value);
                WGLV.context.uniform1i(u.location, u.value);
            }
        }
    }

    /*
        Uploads a uniform value right away, so the Material must be bound.
        value is a Vector2, Vector3, Vector4 or Matrix4 to match the uniform.
        Returns false if the shader doesn't use that uniform (texture units are set by bind()).
    */
    setUniform(name, value)
    {
        const u = this.#uniforms.get(name);

        if (u === undefined)
            return false;

        const gl = WGLV.context;

        switch (u.componentCount)
        {
            case 2:  gl.uniform2f(u.location, value.x, value.y); break;
            case 3:  gl.uniform3f(u.location, value.x, value.y, value.z); break;
            case 4:  gl.uniform4f(u.location, value.x, value.y, value.z, value.w); break;
            case 16: gl.uniformMatrix4fv(u.location, false, value.m); break;
            default: return false;
        }

        return true;
    }

    hasUniform(name) { return this.#uniforms.has(name); }

    getAttribLocation(name)
    {
        return this.#shader.getAttrib(name);
    }

    getUniformLocation(name)
    {
        return this.#shader.getUniform(name);
    }

    isLoaded() { return (this.#shader !== null); }

    // The texture in a unit (0 - 3), or null if there isn't one
    getTexture(index = 0) { return this.#textures[index] ?? null; }

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

                // Only texture units keep a value here: the unit number. Other values come from setUniform().
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
                else if (m.componentCount !== 2 && m.componentCount !== 3 && m.componentCount !== 4 && m.componentCount !== 16)
                    return false;

                this.#uniforms.set(uName, m);
            }
        }
    
        return true;
    }

    #bindTexture(textureIndex)
    {
        switch (textureIndex)
        {
            case 0: WGLV.context.activeTexture(WGLV.context.TEXTURE0); break;
            case 1: WGLV.context.activeTexture(WGLV.context.TEXTURE1); break;
            case 2: WGLV.context.activeTexture(WGLV.context.TEXTURE2); break;
            case 3: WGLV.context.activeTexture(WGLV.context.TEXTURE3); break;
            default: console.error("Only 4 texture units supported"); break;
        }

        let t = this.#textures[textureIndex];
        t.bind();

        const sampler = this.#samplers[textureIndex] ?? Material.#getDefaultSampler(t.hasMipmaps());
        sampler.bind(textureIndex);
    }

    static #idOf(obj)
    {
        let id = Material.#kIds.get(obj);

        if (id === undefined)
        {
            id = Material.#kNextId++;
            Material.#kIds.set(obj, id);
        }

        return id;
    }

    static #getDefaultSampler(withMipmaps)
    {
        if (withMipmaps === true)
        {
            if (Material.#kDefaultMipmapSampler === null)
            {
                Material.#kDefaultMipmapSampler = new Sampler();
                Material.#kDefaultMipmapSampler.setFilter(WGLV.context.LINEAR_MIPMAP_LINEAR, WGLV.context.LINEAR);
            }

            return Material.#kDefaultMipmapSampler;
        }

        if (Material.#kDefaultSampler === null)
            Material.#kDefaultSampler = new Sampler();

        return Material.#kDefaultSampler;
    }
}