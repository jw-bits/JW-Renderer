"use strict";

/*
    TextureAtlas - One Texture holding many named images (SubTextures), laid
    out by a JSON file. Load it once and give its SubTextures to any number of
    models: a SubTexture is a Texture, so anything that takes a Texture takes
    one. Models drawing SubTextures of the same atlas still batch into one
    instanced draw call (see Material.getTextureKey()).

    The JSON:
        {
            "texture_name": "checkers_texture",       // The image: {atlas folder}/{texture_name}.webp
            "texture_filepath": ".../checkers_texture.webp", // Tried as is if that fails
            "texture_width": 2048,                    // Optional; checked against the image
            "texture_height": 512,
            "textures": {
                "checker_king": { "width": 512, "height": 512,      // Optional, in pixels; else from the uvs
                                  "uvs": { "u0": 0.0, "v0": 0.0, "u1": 0.25, "v1": 1.0 } },
                ...
            }
        }
    UVs run 0 - 1 with V up, (u0, v0) the bottom-left corner, like UVRect.

    The image is loaded from the JSON's folder, named texture_name with
    .webp, e.g. ./textures/ + "checkers_texture" -> ./textures/checkers_texture.webp.
    If that fails, texture_filepath is tried as it is; if that fails too
    (or neither is given), the atlas fails to load.

    Usage:
        let atlas = new TextureAtlas();
        atlas.load("./textures/checkers.json", () => {
            rect.load(atlas.getSubTexture("checker_king"), 64, 64);
        });

        // Or through TextureManager, which loads each atlas once:
        const atlas = await textures.loadAtlas("./textures/checkers.json");

        // Or from a canvas drawn at runtime (TextAtlas builds its glyphs this way):
        atlas.loadCanvas(canvas, { "A": { width: 20, height: 40, uvs: { u0: 0, v0: 0, u1: 0.1, v1: 1 } } }, "glyphs");

    A SubTexture can't tile or wrap (REPEAT would wrap the whole atlas), so
    Rect2D's UV tiling and offset need a Texture of their own.
*/
class TextureAtlas
{
    #texture;     // The whole atlas image
    #atlasUrl;
    #subTextures; // Name -> SubTexture, filled once the image has loaded
    #isLoading;

    constructor(_makeMipmaps = true)
    {
        this.#texture = new Texture(true, _makeMipmaps);
        this.#atlasUrl = null;
        this.#subTextures = new Map();
        this.#isLoading = false;
    }

    /*
        Loads the JSON at atlasUrl, then its image (see the top of this file).
        onLoadFailCB is called if the JSON or image can't be loaded or the JSON
        isn't valid (the atlas is unloaded first). Returns false if it can't start (already loaded or
        loading, or no url).
    */
    load(atlasUrl, onLoadSuccessCB = null, onLoadFailCB = null)
    {
        if (typeof atlasUrl !== "string" || atlasUrl.length === 0)
        {
            console.error("TextureAtlas.load() needs the atlas JSON's url");
                return false;
        }

        if (this.isLoaded() === true || this.#isLoading === true)
            return false; // Already loaded or loading... unload first

        this.#atlasUrl = atlasUrl;
        this.#isLoading = true;

        const fail = (message) => {
            console.error(`TextureAtlas: ${message} (${atlasUrl})`);
            this.unload();

            if (onLoadFailCB !== null)
                onLoadFailCB();
        };

        fetch(atlasUrl)
            .then((response) => {
                if (response.ok === false)
                    throw new Error(`HTTP ${response.status}`);

                return response.json();
            })
            .then((json) => {
                const entries = TextureAtlas.#parse(json);

                if (entries === null)
                {
                    fail("the JSON isn't a valid atlas");
                        return;
                }

                const imageUrls = TextureAtlas.#imageUrlsFor(atlasUrl, json);
                const onImageLoaded = () => {
                    this.#isLoading = false;
                    this.#createSubTextures(entries, json);

                    if (onLoadSuccessCB !== null)
                        onLoadSuccessCB();
                };

                // Tries each url in turn; the atlas fails once none load
                const tryImage = (i) => {
                    if (i >= imageUrls.length)
                    {
                        fail(`couldn't load its image (tried ${imageUrls.join(", ") || "nothing: no texture_name or texture_filepath"})`);
                            return;
                    }

                    // A failed Texture.load() unloads the texture, so it can load again
                    if (this.#texture.load(imageUrls[i], onImageLoaded, () => tryImage(i + 1)) === false)
                        tryImage(i + 1);
                };

                tryImage(0);
            })
            .catch((error) => fail(`couldn't load the JSON: ${error.message}`));

        return true; // Loading...
    }

    /*
        Builds the atlas from a canvas drawn at runtime (see TextAtlas), ready
        right away. textures is laid out like the JSON's "textures": name ->
        { width, height, uvs: { u0, v0, u1, v1 } }, with V up. name is shown in
        messages and getAtlasURL(). Returns false (and changes nothing) if it's
        already loaded or loading, or the canvas can't be uploaded.
    */
    loadCanvas(canvas, textures, name = "canvas")
    {
        if (this.isLoaded() === true || this.#isLoading === true)
            return false; // Already loaded or loading... unload first

        const json = { textures: textures };
        const entries = TextureAtlas.#parse(json);

        if (entries === null || this.#texture.loadCanvas(canvas) === false)
        {
            console.error(`TextureAtlas.loadCanvas() couldn't build "${name}"`);
            this.#texture.unload();
                return false;
        }

        this.#atlasUrl = name;
        this.#createSubTextures(entries, json);
            return true;
    }

    /*
        Replaces an atlas built by loadCanvas() with a newly drawn canvas (its
        size may change), uploading into the same Texture so Materials holding
        it stay valid. textures is as for loadCanvas(). The old SubTextures
        stop being loaded; get the new ones with getSubTexture(). Returns false
        if it isn't loaded or the canvas can't be uploaded.
    */
    updateCanvas(canvas, textures)
    {
        if (this.isLoaded() === false)
            return false;

        const json = { textures: textures };
        const entries = TextureAtlas.#parse(json);

        if (entries === null || this.#texture.updateCanvas(canvas) === false)
        {
            console.error(`TextureAtlas.updateCanvas() couldn't update "${this.#atlasUrl}"`);
                return false;
        }

        this.#subTextures.clear();
        this.#createSubTextures(entries, json);
            return true;
    }

    // The SubTexture with this name, or null (also while loading)
    getSubTexture(name) { return this.#subTextures.get(name) ?? null; }
    hasSubTexture(name) { return this.#subTextures.has(name); }
    getSubTextureNames() { return Array.from(this.#subTextures.keys()); }

    // The whole atlas image; it can be drawn like any Texture
    getTexture() { return this.#texture; }

    getWidth() { return this.#texture.getWidth(); }
    getHeight() { return this.#texture.getHeight(); }
    getAtlasURL() { return this.#atlasUrl; }
    isLoaded() { return (this.#isLoading === false && this.#texture.isLoaded() === true); }
    isLoading() { return this.#isLoading; }

    // Frees the texture; its SubTextures stop being loaded, and are forgotten. load() can be called again.
    unload()
    {
        this.#texture.unload();
        this.#subTextures.clear();
        this.#atlasUrl = null;
        this.#isLoading = false;
    }

    // *** Internal Methods ***

    #createSubTextures(entries, json)
    {
        const w = this.getWidth();
        const h = this.getHeight();

        if ((Number.isFinite(json.texture_width) && json.texture_width !== w) || (Number.isFinite(json.texture_height) && json.texture_height !== h))
            console.error(`TextureAtlas: the JSON says ${json.texture_width} x ${json.texture_height}, but the image is ${w} x ${h} (${this.#atlasUrl})`);

        for (const e of entries)
        {
            // Sizes from the UVs, to check the JSON's against: more than a pixel out means they don't describe the same rect
            const uvWidth = (e.u1 - e.u0) * w;
            const uvHeight = (e.v1 - e.v0) * h;

            if (e.width !== null && (Math.abs(e.width - uvWidth) > 1.0 || Math.abs(e.height - uvHeight) > 1.0))
                console.error(`TextureAtlas: "${e.name}" says ${e.width} x ${e.height}, but its uvs cover ${uvWidth.toFixed(1)} x ${uvHeight.toFixed(1)} pixels (${this.#atlasUrl})`);

            const width = e.width ?? Math.round(uvWidth);
            const height = e.height ?? Math.round(uvHeight);
            this.#subTextures.set(e.name, new SubTexture(this, e.name, e.u0, e.v0, e.u1, e.v1, width, height));
        }
    }

    // [{ name, u0, v0, u1, v1, width, height }] (width / height null if not given), or null if the JSON isn't an atlas. Bad entries are reported and skipped.
    static #parse(json)
    {
        if (json === null || typeof json !== "object" || json.textures === null || typeof json.textures !== "object")
            return null;

        let entries = [];

        for (const name of Object.keys(json.textures))
        {
            const uvs = json.textures[name]?.uvs;
            const values = [uvs?.u0, uvs?.v0, uvs?.u1, uvs?.v1];

            if (values.every((v) => Number.isFinite(v) && v >= 0.0 && v <= 1.0) === false || uvs.u1 <= uvs.u0 || uvs.v1 <= uvs.v0)
            {
                console.error(`TextureAtlas: "${name}" needs uvs u0 < u1 and v0 < v1, all 0 - 1; skipped`);
                continue;
            }

            // Sizes in pixels are optional; without them (or if they aren't whole numbers above 0) they come from the UVs
            const w = json.textures[name].width;
            const h = json.textures[name].height;
            const hasSize = (Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0);

            if (hasSize === false && (w !== undefined || h !== undefined))
                console.error(`TextureAtlas: "${name}" needs a width and height in whole pixels above 0; working them out from its uvs`);

            entries.push({ name: name, u0: uvs.u0, v0: uvs.v0, u1: uvs.u1, v1: uvs.v1,
                           width: hasSize ? w : null, height: hasSize ? h : null });
        }

        return entries;
    }

    // The image urls to try, in order: {atlas folder}/{texture_name}.webp, then texture_filepath
    static #imageUrlsFor(atlasUrl, json)
    {
        let urls = [];

        if (typeof json.texture_name === "string" && json.texture_name.length > 0)
        {
            const slash = atlasUrl.lastIndexOf("/");
            const folder = (slash !== -1) ? atlasUrl.substring(0, slash + 1) : "";
            urls.push(`${folder}${json.texture_name}.webp`);
        }

        if (typeof json.texture_filepath === "string" && json.texture_filepath.length > 0)
            urls.push(json.texture_filepath);

        return urls;
    }
}

/*
    SubTexture - One named image in a TextureAtlas. It's a Texture, so models,
    Materials and Particles2D take it like any other: it binds its atlas's
    Texture, its width and height are its own size in pixels, and it's loaded
    while its atlas is. Models draw only its part of the atlas (see getUVRect()).

    The pixels belong to the atlas: load() and the other upload methods fail,
    and unload() does nothing (unload the TextureAtlas instead).

    Its UV rect is pulled in by half a texel on each side, so filtering never
    blends in the atlas pixels around it (a 4 x 4 square stretched over a
    board square keeps sharp edges).
*/
class SubTexture extends Texture
{
    #atlas;
    #name;
    #width;   // In pixels: the JSON's, or worked out from the UVs
    #height;
    #uvRect;  // Half a texel in from the JSON's rect

    // Made by TextureAtlas once its image has loaded; _width / _height are in pixels
    constructor(_atlas, _name, _u0, _v0, _u1, _v1, _width, _height)
    {
        super(true, false, true); // A view: no GL texture of its own

        this.#atlas = _atlas;
        this.#name = _name;
        this.#width = _width;
        this.#height = _height;

        // Half a texel in, unless the rect is a texel or less across
        const halfU = (_width > 1) ? 0.5 / _atlas.getWidth() : 0.0;
        const halfV = (_height > 1) ? 0.5 / _atlas.getHeight() : 0.0;
        this.#uvRect = new UVRect(_u0 + halfU, _v0 + halfV, (_u1 - _u0) - (halfU * 2.0), (_v1 - _v0) - (halfV * 2.0));
    }

    getAtlas() { return this.#atlas; }
    getName() { return this.#name; }

    // The atlas's Texture, which this binds
    getTexture() { return this.#atlas.getTexture(); }

    // Its part of the atlas, as a UVRect. Read-only.
    getUVRect() { return this.#uvRect; }

    /*
        Maps rect, a UVRect within this SubTexture (0 - 1 across it), to the
        same part of the atlas, written into out (also returned). Used for a
        Sprite's frames.
    */
    mapUVRect(rect, out)
    {
        const r = this.#uvRect;

        return out.setUnclamped(r.getX() + (rect.getX() * r.getWidth()), r.getY() + (rect.getY() * r.getHeight()),
                                rect.getWidth() * r.getWidth(), rect.getHeight() * r.getHeight());
    }

    // *** Texture ***

    isLoaded() { return (this.#atlas.isLoaded() === true && this.#atlas.getSubTexture(this.#name) === this); }
    hasMipmaps() { return this.getTexture().hasMipmaps(); }

    // In atlas pixels: the JSON's size, or worked out from the UVs if it has none
    getWidth() { return this.#width; }
    getHeight() { return this.#height; }

    // The atlas JSON's url, with "#name" on the end
    getURL() { return `${this.#atlas.getAtlasURL()}#${this.#name}`; }

    bind() { this.getTexture().bind(); }

    load(imageUrl, onLoadSuccessCB = null, onLoadFailCB = null) { return this.#notSupported("load"); }
    loadPixels(width, height, rgbaPixels) { return this.#notSupported("loadPixels"); }
    loadCanvas(canvas) { return this.#notSupported("loadCanvas"); }
    updateCanvas(canvas) { return this.#notSupported("updateCanvas"); }

    // The pixels belong to the atlas; unload the TextureAtlas instead
    unload() { }

    // *** Internal Methods ***

    #notSupported(methodName)
    {
        console.error(`SubTexture.${methodName}(): a SubTexture's pixels belong to its TextureAtlas`);
            return false;
    }
}
