"use strict";

/*
    Sampler - A WebGL2 sampler object: how a texture is filtered and wrapped.

    The texture holds the pixels; the sampler says how they're read. A Material
    holds one Sampler per texture unit and binds it with the texture, so the
    same Texture can be drawn repeated in one Material and clamped in another.
    One Sampler can be shared by any number of Materials.

    Usage:
        const gl = WGL.context;
        let s = new Sampler();
        s.setWrap(gl.REPEAT, gl.REPEAT);
        s.setFilter(gl.LINEAR_MIPMAP_LINEAR, gl.LINEAR); // The texture needs mipmaps for this
        material.setSampler(0, s);

    Defaults: LINEAR / LINEAR filtering, CLAMP_TO_EDGE wrapping.
*/
class Sampler
{
    #id;
    #wrapS;
    #wrapT;
    #minFilter;
    #magFilter;

    constructor()
    {
        const gl = WGL.context;

        this.#id = gl.createSampler();
        this.#wrapS = gl.CLAMP_TO_EDGE;
        this.#wrapT = gl.CLAMP_TO_EDGE;
        this.#minFilter = gl.LINEAR;
        this.#magFilter = gl.LINEAR;
        this.#apply();
    }

    // gl.CLAMP_TO_EDGE, gl.REPEAT or gl.MIRRORED_REPEAT
    setWrap(wrapS, wrapT = wrapS)
    {
        this.#wrapS = wrapS;
        this.#wrapT = wrapT;
        this.#apply();
    }

    // min: gl.NEAREST, gl.LINEAR or one of the *_MIPMAP_* modes; mag: gl.NEAREST or gl.LINEAR
    setFilter(minFilter, magFilter = WGL.context.LINEAR)
    {
        this.#minFilter = minFilter;
        this.#magFilter = magFilter;
        this.#apply();
    }

    getWrapS() { return this.#wrapS; }
    getWrapT() { return this.#wrapT; }
    getMinFilter() { return this.#minFilter; }
    getMagFilter() { return this.#magFilter; }
    isLoaded() { return (this.#id !== null); }

    // True if the min filter reads mipmaps (the texture must have them, or it samples as black)
    usesMipmaps()
    {
        const gl = WGL.context;
        return (this.#minFilter !== gl.NEAREST && this.#minFilter !== gl.LINEAR);
    }

    // Binds to a texture unit (0 - 3); overrides the bound texture's own filtering and wrapping
    bind(unit)
    {
        WGL.context.bindSampler(unit, this.#id);
    }

    unload()
    {
        if (this.#id !== null)
        {
            WGL.context.deleteSampler(this.#id);
            this.#id = null;
        }
    }

    // *** Internal Methods ***

    #apply()
    {
        if (this.#id === null)
            return;

        const gl = WGL.context;
        gl.samplerParameteri(this.#id, gl.TEXTURE_WRAP_S, this.#wrapS);
        gl.samplerParameteri(this.#id, gl.TEXTURE_WRAP_T, this.#wrapT);
        gl.samplerParameteri(this.#id, gl.TEXTURE_MIN_FILTER, this.#minFilter);
        gl.samplerParameteri(this.#id, gl.TEXTURE_MAG_FILTER, this.#magFilter);
    }
}
