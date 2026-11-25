/*
    Material - A shader, up to 4 textures, and the sampler state for each
    texture unit. That's all it holds, so one Material can be shared by any
    number of models (see MaterialManager).

    Each texture unit is drawn with its Sampler (filtering and wrapping). A
    unit without one uses a shared default: trilinear (LINEAR_MIPMAP_LINEAR /
    LINEAR) if its texture has mipmaps, otherwise LINEAR / LINEAR; both clamp.

    Uniform values (position, color, ...) belong to whatever is being drawn,
    not the Material. Bind the Material, then upload them:

        material.bind();                       // Shader, every texture and sampler
        material.setUniform("u_color", color); // Uploaded right away
        mesh.render();

    Usage:
        let m = new Material();
        m.load(shader, [texture], [sampler]); // Samplers are optional, per unit
        m.setSampler(0, repeatSampler);       // Or set / change one later

    Samplers and textures belong to the caller; one can be shared by many Materials.
    A texture can be an AtlasSubTexture of a TextureAtlas: it binds the atlas, and
    models draw only its part (see Model2D.getUVRect()).

    Blend mode: how its draws combine with what's there (see BlendMode),
    BlendMode.kAlpha unless setBlendMode() says otherwise. bind() sets it,
    even when it binds only the textures. It's part of the keys, so models
    with different blend modes never share a batch.
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
    #blendMode;

    // Looked up once in load(), from the uniforms the shader actually uses
    #uniforms;     // Name -> { location, componentCount, value } (value: the texture unit for samplers, else null)
    #textureUnits; // The shader's sampler uniforms that have a texture, for bind() to point at their units
    #textureKey;   // Cached getTextureKey(); null until asked for, or after a change

    constructor()
    {
        this.#shader = null;
        this.#textures = [];
        this.#samplers = [null, null, null, null];
        this.#blendMode = BlendMode.kAlpha;
        this.#uniforms = new Map();
        this.#textureUnits = [];
        this.#textureKey = null;
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
        this.#textureUnits = [];
        this.#textureKey = null;
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
        this.#textureKey = null;
            return true;
    }

    // The sampler set for a unit, or null if it uses the default
    getSampler(unit = 0) { return this.#samplers[unit] ?? null; }

    // A BlendMode, e.g. BlendMode.kPremultiplied for a RenderTarget's texture. Kept through unload().
    setBlendMode(mode)
    {
        if (BlendMode.isValid(mode) === false)
        {
            console.error("Material.setBlendMode() needs a BlendMode such as BlendMode.kAdditive");
                return false;
        }

        this.#blendMode = mode;
        this.#textureKey = null;
            return true;
    }

    getBlendMode() { return this.#blendMode; }

    getShader() { return this.#shader; }

    /*
        Identifies what makes this material: its shader, textures, samplers and blend
        mode. Two Materials built from the same objects get the same key, e.g.
        "s3|t7,9|p-,12|b0" (shader 3, textures 7 and 9, unit 0 default sampler,
        unit 1 sampler 12, BlendMode.kAlpha). Uniform values aren't part of it. null if not loaded.
        Each AtlasSubTexture counts as its own texture, so models reading their
        AtlasSubTexture from a shared Material get the right one.
    */
    getKey()
    {
        if (this.#shader === null)
            return null;

        return `s${Material.#idOf(this.#shader)}|${this.#makeTextureKey(false)}`;
    }

    /*
        Like getKey() without the shader: just the textures, samplers and blend mode,
        e.g. "t7,9|p-,12|b0". Materials with different shaders but the same textures,
        samplers and blend mode share it, which is what Batcher's instanced
        drawing needs (it uses its own shader). An AtlasSubTexture counts as its
        atlas's Texture, since that's what it binds: AtlasSubTextures of one atlas
        (and the atlas Texture itself) batch together, each drawing its own
        UV rect. null if not loaded.
    */
    getTextureKey()
    {
        if (this.#shader === null)
            return null;

        if (this.#textureKey === null)
            this.#textureKey = this.#makeTextureKey(true);

        return this.#textureKey;
    }

    /*
        Sets the blend mode and binds the shader, and every texture with its sampler
        (each in its own unit, whether or not the shader reads it). Call before
        setUniform() and drawing. Either the shader or the textures can be skipped,
        e.g. Batcher binds only the textures and then a shader of its own.
    */
    bind(bindShader = true, bindTextures = true)
    {
        RenderState.setBlendMode(this.#blendMode);

        if (bindShader === true)
        {
            this.#shader.bind();
            this.setTextureUnits();
        }

        if (bindTextures === true)
        {
            for (let i = 0; i < this.#textures.length; ++i)
                this.#bindTexture(i);
        }
    }

    /*
        Uploads a uniform value right away, so the Material must be bound.
        value is a number, Vector2, Vector3, Vector4 or Matrix4 to match the uniform.
        Returns false if the shader doesn't use that uniform (texture units are set by bind()).
    */
    setUniform(name, value)
    {
        const u = this.#uniforms.get(name);

        if (u === undefined || u.value !== null)
            return false; // Not used, or a texture unit

        const gl = WGLV.context;

        switch (u.componentCount)
        {
            case 1:  gl.uniform1f(u.location, value); break;
            case 2:  gl.uniform2f(u.location, value.x, value.y); break;
            case 3:  gl.uniform3f(u.location, value.x, value.y, value.z); break;
            case 4:  gl.uniform4f(u.location, value.x, value.y, value.z, value.w); break;
            case 16: gl.uniformMatrix4fv(u.location, false, value.m); break;
            default: return false;
        }

        return true;
    }

    isLoaded() { return (this.#shader !== null); }

    // The texture in a unit (0 - 3), or null if there isn't one
    getTexture(index = 0) { return this.#textures[index] ?? null; }

    // Textures it has, in units 0 up
    getTextureCount() { return this.#textures.length; }

    // The Sampler bind() uses for a unit with a texture: its own, or the shared default; null without a texture
    getUnitSampler(unit)
    {
        const t = this.#textures[unit];

        if (t === undefined)
            return null;

        return this.#samplers[unit] ?? Material.#getDefaultSampler(t.hasMipmaps());
    }

    /*
        Points the shader's sampler uniforms at their texture units (u_tex0 at 0
        ...). The shader must be bound. bind() does this; a program keeps the
        values, so Batcher does it once per Material and shader.
    */
    setTextureUnits()
    {
        for (const u of this.#textureUnits)
            WGLV.context.uniform1i(u.location, u.value);
    }

    // *** Internal Methods ***

    /*
        Caches the location and component count of each uniform the shader uses. Every one must be
        listed in RenderUniforms; one that isn't is reported and skipped (setUniform()
        can't set it).
    */
    #setupUniforms()
    {
        for (const uName of this.#shader.getActiveUniformNames())
        {
            const componentCount = RenderUniforms.componentCount(uName);

            if (componentCount === 0)
            {
                console.error(`Material: the shader uses "${uName}", which isn't in RenderUniforms; add it there or use u_vec0 - u_vec7`);
                continue;
            }

            // Only texture units keep a value here: the unit number. Other values come from setUniform().
            const unit = RenderUniforms.textureUnit(uName);
            const m = { location: this.#shader.getUniform(uName), componentCount, value: (unit !== -1) ? unit : null };

            this.#uniforms.set(uName, m);

            if (unit !== -1 && unit < this.#textures.length)
                this.#textureUnits.push(m);
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

        this.#textures[textureIndex].bind();
        this.getUnitSampler(textureIndex).bind(textureIndex);
    }

    // The textures, samplers and blend mode part of a key; byAtlas counts each AtlasSubTexture as its atlas's Texture
    #makeTextureKey(byAtlas)
    {
        const textures = this.#textures.map((t) => Material.#idOf((byAtlas === true) ? t.getTexture() : t));
        const samplers = this.#textures.map((t, i) => (this.#samplers[i] !== null) ? Material.#idOf(this.#samplers[i]) : "-");
            return `t${textures.join(",")}|p${samplers.join(",")}|b${this.#blendMode}`;
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