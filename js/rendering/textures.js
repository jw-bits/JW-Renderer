"use strict";

/*
    Textures: everything that can be drawn with.

        BaseTexture      What every texture can be asked; anything that draws with a texture takes one
        Texture          The pixels of an image, raw pixels or a canvas
        RenderTexture    The texture a RenderTarget (render_target.js) draws into
        TextureAtlas     One Texture holding many named images, laid out by a JSON file or a Spine .atlas page
        AtlasSubTexture  One named image in a TextureAtlas

    Many atlases (and multi-page Spine atlases) are kept by TextureAtlasManager (render_managers.js).
*/

/*
    BaseTexture - What every texture can be asked, whether it holds its own
    pixels (Texture) or names part of an atlas (AtlasSubTexture). Anything that
    draws with a texture takes a BaseTexture.

        getTexture()  The Texture holding the pixels, which bind() binds (itself for a Texture)
        getUVRect()   Its part of that Texture as a UVRect (all of it, 0 - 1, for a Texture)
        getWidth() / getHeight()  In pixels

    Subclasses set the size with _setSize() and override what differs:
    isLoaded(), hasMipmaps(), getURL(), bind(), unload(), getTexture(),
    getUVRect().
*/
class BaseTexture
{
    #width;  // Pixels
    #height;

    constructor()
    {
        this.#width = 0;
        this.#height = 0;
    }

    getWidth() { return this.#width; }
    getHeight() { return this.#height; }

    isLoaded() { return false; }
    hasMipmaps() { return false; }
    getURL() { return null; }

    bind() { }
    unload() { }

    // The Texture holding the pixels
    getTexture() { return this; }

    // The part of getTexture() this is, as a UVRect: all of it (UVRect.kFull). Shared and read-only.
    getUVRect() { return UVRect.kFull; }

    // *** Subclass Methods ***

    _setSize(width, height)
    {
        this.#width = width;
        this.#height = height;
    }
}

/*
    Texture - The pixels of a 2D texture (and their mipmaps).

    How the texture is filtered and wrapped is sampler state, which lives in
    the Material (see Sampler). The Texture only keeps safe internal settings
    (LINEAR, CLAMP_TO_EDGE) for the rare case it's bound without a sampler.

    Options, set when it's created:
        _flipY       Flip rows on upload, so V runs up (matches the 2D models)
        _makeMipmaps Build mipmaps on every upload, so a Sampler can use a *_MIPMAP_* filter

    The GL texture is created by load(), loadPixels() or loadCanvas(), not
    the constructor, so a Texture can be made before WGLV.init(). Each fails
    if the texture already exists (loaded, or an image still loading);
    unload() it first.

    A TextureAtlas (below) holds one Texture and names parts of it
    as AtlasSubTextures. Both are BaseTextures, so anything that takes one takes
    the other.
*/
class Texture extends BaseTexture
{
    #texId;
    #url;
    #isLoaded;
    #loadPromise; // While an image loads (and after), resolving to true or false

    // Options
    #flipY;
    #hasMipmaps;

    // Checkerboard RGB
    static #pixels = new Uint8Array([255, 0, 255, 255, 255, 255, 255, 255,
                                    255, 255, 255, 255, 255, 0, 255, 255]);

    constructor(_flipY = true, _makeMipmaps = true)
    {
        super();

        this.#flipY = _flipY;
        this.#hasMipmaps = _makeMipmaps;
        this.#url = null;
        this.#isLoaded = false;
        this.#loadPromise = null;
        this.#texId = 0;
    }

    /*
        Loads an image. Resolves to true once it's uploaded, false on failure (the
        texture is unloaded, so it can load again). Asking again for the same image
        while it loads shares the load; any other request while it's loaded or
        loading fails (unload() first). The checkerboard placeholder draws meanwhile.
    */
    async load(imageUrl)
    {
        if (typeof imageUrl !== "string" || imageUrl.length === 0)
        {
            console.error("Texture.load() needs an image url");
                return false;
        }

        if (this.#texId !== 0)
        {
            if (imageUrl === this.#url)
                return await this.waitForLoad(); // Same image: share the load

            console.error(`Texture is already used for ${this.#url ?? "pixels or a canvas"}; unload it first, or create a new Texture for ${imageUrl}`);
                return false;
        }

        this.#initTexture();
        this.#url = imageUrl;
        this.#loadPromise = this.#loadImage(imageUrl);
            return await this.#loadPromise;
    }

    // Resolves to true once loaded, or false if it failed or was never loaded
    async waitForLoad()
    {
        if (this.#isLoaded === true)
            return true;

        if (this.#loadPromise === null)
            return false;

        return await this.#loadPromise;
    }

    // Loads raw RGBA pixels (a Uint8Array of width * height * 4). Ready right away.
    loadPixels(width, height, rgbaPixels)
    {
        if (this.#texId !== 0)
            return false; // Already loaded or loading... free first

        if (rgbaPixels == null || rgbaPixels.length !== width * height * 4)
            return false;

        this.#initTexture();

        const gl = WGLV.context;

        gl.bindTexture(gl.TEXTURE_2D, this.#texId);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, this.#flipY);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgbaPixels);
        this.#finishUpload(width, height);

        this.#isLoaded = true;
            return true;
    }

    // Loads the pixels of a canvas (or any image source texImage2D accepts). Ready right away.
    loadCanvas(canvas)
    {
        if (this.#texId !== 0)
            return false; // Already loaded or loading... free first, or use updateCanvas()

        if (canvas == null)
            return false;

        this.#initTexture();

        this.#upload(canvas, canvas.width, canvas.height);
        this.#isLoaded = true;
            return true;
    }

    // Replaces the pixels of a texture loaded with loadCanvas(). The size may change.
    updateCanvas(canvas)
    {
        if (this.#isLoaded === false || canvas == null)
            return false;

        this.#upload(canvas, canvas.width, canvas.height);
            return true;
    }

    isLoaded() { return this.#isLoaded; }
    hasMipmaps() { return this.#hasMipmaps; }
    getURL() { return this.#url; }

    // Fails (with a console.error) if there's no GL texture yet, i.e. before a load or after unload()
    bind()
    {
        if (this.#texId === 0)
        {
            console.error("Texture.bind(): there's no GL texture to bind; load it first");
                return;
        }

        WGLV.context.bindTexture(WGLV.context.TEXTURE_2D, this.#texId);
    }

    unload()
    {
        if (this.#texId === 0)
            return; // Alredy unloaded

        WGLV.context.deleteTexture(this.#texId);

        this.#texId = 0;
        this.#url = null;
        this._setSize(0, 0);
        this.#isLoaded = false;
        this.#loadPromise = null;
    }

    // *** Internal Methods ***

    // Loads and uploads an image; resolves to true, or false (unloading) if it can't be loaded
    #loadImage(url)
    {
        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.decoding = "async";

            img.onload = () => {
                if (this.#url !== url)
                {
                    resolve(false); // Unloaded (or reloaded) while it was loading
                        return;
                }

                this.#upload(img, img.naturalWidth, img.naturalHeight);
                this.#isLoaded = true;
                resolve(true);
            };

            img.onerror = () => {
                console.error("Can't load texture: " + url);

                if (this.#url === url)
                    this.unload();

                resolve(false);
            };

            img.src = url; // Load it
        });
    }

    // source is an image, canvas, or anything else texImage2D accepts
    #upload(source, width, height)
    {
        const gl = WGLV.context;

        gl.bindTexture(gl.TEXTURE_2D, this.#texId);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, this.#flipY);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        this.#finishUpload(width, height);
    }

    // Expects the texture to be bound; unbinds it
    #finishUpload(width, height)
    {
        const gl = WGLV.context;

        // WebGL2 can build mipmaps for any size, not just powers of two
        if (this.#hasMipmaps === true)
            gl.generateMipmap(gl.TEXTURE_2D);

        gl.bindTexture(gl.TEXTURE_2D, null);

        this._setSize(width, height);
    }

    #initTexture()
    {
        const gl = WGLV.context;

        this.#texId = gl.createTexture();
        this._setSize(2, 2);

        gl.bindTexture(gl.TEXTURE_2D, this.#texId);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, Texture.#pixels);

        if (this.#hasMipmaps === true)
            gl.generateMipmap(gl.TEXTURE_2D); // So the placeholder works with a mipmap sampler too

        // Only used when no sampler is bound; a Material always binds one
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        gl.bindTexture(gl.TEXTURE_2D, null);
    }
}

/*
    RenderTexture - The color texture of a RenderTarget. RenderTarget makes it
    and sizes it; draw it like any other texture (Rect2D, Material). Rows run
    up, like the other textures (flipped on load), so it draws the right way up.
    No mipmaps.
*/
class RenderTexture extends BaseTexture
{
    #texId;
    #isFloat;

    constructor()
    {
        super();

        this.#texId = null;
        this.#isFloat = false;
    }

    /*
        For RenderTarget: makes the GL texture (or gives it a new size), RGBA8, or
        RGBA16F with isFloat. The pixels are undefined until drawn.
    */
    allocate(width, height, isFloat)
    {
        const gl = WGLV.context;

        if (this.#texId === null)
            this.#texId = gl.createTexture();

        gl.bindTexture(gl.TEXTURE_2D, this.#texId);

        if (isFloat === true)
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
        else
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

        // Only used when no sampler is bound; a Material always binds one
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.bindTexture(gl.TEXTURE_2D, null);

        this.#isFloat = (isFloat === true);
        this._setSize(width, height);
    }

    // The GL texture, for attaching to a framebuffer; null if not allocated
    getGLTexture() { return this.#texId; }

    isFloat() { return this.#isFloat; }
    isLoaded() { return (this.#texId !== null); }

    bind()
    {
        if (this.#texId === null)
        {
            console.error("RenderTexture.bind(): it has no GL texture; load its RenderTarget first");
                return;
        }

        WGLV.context.bindTexture(WGLV.context.TEXTURE_2D, this.#texId);
    }

    unload()
    {
        if (this.#texId === null)
            return;

        WGLV.context.deleteTexture(this.#texId);
        this.#texId = null;
        this._setSize(0, 0);
    }

    // For RenderTarget after a lost context: the old GL texture is gone, so forget it without deleting it
    forget()
    {
        this.#texId = null;
    }
}

/*
    TextureAtlas - One Texture holding many named images (AtlasSubTextures), laid
    out by a JSON file. Load it once and give its AtlasSubTextures to any number of
    models: an AtlasSubTexture is a BaseTexture, like a Texture, so anything that
    takes a Texture to draw with takes one. Models drawing AtlasSubTextures of the same atlas still batch into one
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
        if (await atlas.load("./textures/checkers.json"))
            rect.load(atlas.getSubTexture("checker_king"), 64, 64);

        // Or through TextureAtlasManager, which loads each atlas once:
        const atlas = await TextureAtlasManager.loadAtlas("./textures/checkers.json");

        // Or from a canvas drawn at runtime (TextAtlas builds its glyphs this way):
        atlas.loadCanvas(canvas, { "A": { width: 20, height: 40, uvs: { u0: 0, v0: 0, u1: 0.1, v1: 1 } } }, "glyphs");

    An AtlasSubTexture can't tile or wrap (REPEAT would wrap the whole atlas), so
    Rect2D's UV tiling and offset need a Texture of their own.

    Spine atlases: a Spine .atlas file (4.0 format) names one or more page
    images, each with its own regions. parseSpineAtlas(text) reads the file
    into pages; loadSpineAtlas(atlasUrl, page) loads one page into this atlas.
    The page's image is named in the file and loaded from its folder. A
    TextureAtlas is always one page, so TextureAtlasManager.loadSpineAtlas()
    loads a whole file, one TextureAtlas per page:

        const pages = await TextureAtlasManager.loadSpineAtlas("assets/atlas1.atlas");
        const eye = TextureAtlasManager.findSubTexture("assets/atlas1.atlas", "alien/eye");

    A Spine page's AtlasSubTextures also carry the region's rotation, trimmed
    whitespace and original size (see AtlasSubTexture). isPremultiplied() and
    getSampler() come from the page's pma,
    filter and repeat settings; mipmaps are made only if its filter uses them.
*/
class TextureAtlas
{
    // Spine filter names -> GL filters (the GL constants, as Spine's TextureFilter enum)
    static #kSpineFilters = new Map([["Nearest", 9728], ["Linear", 9729], ["MipMap", 9987],
                                     ["MipMapNearestNearest", 9984], ["MipMapLinearNearest", 9985],
                                     ["MipMapNearestLinear", 9986], ["MipMapLinearLinear", 9987]]);

    #texture;     // The whole atlas image
    #atlasUrl;
    #subTextures; // Name -> AtlasSubTexture, filled once the image has loaded
    #isLoading;
    #loadPromise; // While the JSON and image load (and after), resolving to true or false
    #spinePage;   // The parsed Spine page (see parseSpineAtlas()) for a Spine atlas, else null
    #sampler;     // A Spine page's Sampler, made the first time getSampler() is asked

    constructor(_makeMipmaps = true)
    {
        this.#texture = new Texture(true, _makeMipmaps);
        this.#atlasUrl = null;
        this.#subTextures = new Map();
        this.#isLoading = false;
        this.#loadPromise = null;
        this.#spinePage = null;
        this.#sampler = null;
    }

    /*
        Reads a Spine .atlas file's text (4.0 format) into its pages, loading nothing:
            [{ name, width, height, format, minFilter, magFilter, wrapS, wrapT, pma, scale,
               regions: [{ name, x, y, width, height, rotation, offsetX, offsetY,
                           originalWidth, originalHeight, index, splits, pads }] }]
        name is the page's image file; filters and wraps are GL constants; a region's
        x, y are its top-left in pixels from the image's top-left, and width, height its
        size before rotation. splits and pads are [4] or null. Returns null (with a
        console.error) if the text isn't an atlas.
    */
    static parseSpineAtlas(text)
    {
        if (typeof text !== "string")
        {
            console.error("TextureAtlas.parseSpineAtlas() needs the .atlas file's text");
                return null;
        }

        const lines = text.split(/\r\n|\r|\n/);
        let entry = [];
        let n = 0;
        let pages = [];
        let page = null;

        const readLine = () => (n < lines.length) ? lines[n++] : null;

        // Skip blank lines, then the header (fields before the first page name, if any)
        let line = readLine();

        while (line !== null && line.trim().length === 0)
            line = readLine();

        while (line !== null && line.trim().length > 0 && TextureAtlas.#readSpineEntry(entry, line) > 0)
            line = readLine();

        while (line !== null)
        {
            if (line.trim().length === 0)
            {
                page = null;
                line = readLine();
            }
            else if (page === null)
            {
                page = { name: line.trim(), width: 0, height: 0, format: null, minFilter: 9728, magFilter: 9728,
                         wrapS: 33071, wrapT: 33071, pma: false, scale: 1.0, regions: [] }; // Spine's defaults: NEAREST, CLAMP_TO_EDGE

                while (TextureAtlas.#readSpineEntry(entry, line = readLine()) > 0)
                {
                    if (TextureAtlas.#readSpinePageField(page, entry) === false)
                        return null;
                }

                pages.push(page);
            }
            else
            {
                let region = { name: line, x: 0, y: 0, width: 0, height: 0, rotation: 0, offsetX: 0, offsetY: 0,
                               originalWidth: 0, originalHeight: 0, index: 0, splits: null, pads: null }; // index 0 unless given, as Spine 4.0
                let count;

                while ((count = TextureAtlas.#readSpineEntry(entry, line = readLine())) > 0)
                    TextureAtlas.#readSpineRegionField(region, entry, count);

                if (region.originalWidth === 0 && region.originalHeight === 0)
                {
                    region.originalWidth = region.width;
                    region.originalHeight = region.height;
                }

                page.regions.push(region);
            }
        }

        if (pages.length === 0 || pages.some((p) => p.width <= 0 || p.height <= 0))
        {
            console.error("TextureAtlas.parseSpineAtlas(): the text has no pages, or a page has no size");
                return null;
        }

        return pages;
    }

    /*
        Loads the JSON at atlasUrl, then its image (see the top of this file).
        Resolves to true once the AtlasSubTextures are ready, false if the JSON or
        image can't be loaded or the JSON isn't valid (the atlas is unloaded, so
        it can load again). Asking again for the same atlas while it loads
        shares the load; any other request while it's loaded or loading fails
        (unload() first).
    */
    async load(atlasUrl)
    {
        if (typeof atlasUrl !== "string" || atlasUrl.length === 0)
        {
            console.error("TextureAtlas.load() needs the atlas JSON's url");
                return false;
        }

        if (this.isLoaded() === true || this.#isLoading === true)
        {
            if (atlasUrl === this.#atlasUrl)
                return await this.waitForLoad(); // Same atlas: share the load

            console.error(`TextureAtlas is already used for ${this.#atlasUrl}; unload it first, or create a new TextureAtlas for ${atlasUrl}`);
                return false;
        }

        this.#atlasUrl = atlasUrl;
        this.#isLoading = true;
        this.#loadPromise = this.#loadFiles(atlasUrl);
            return await this.#loadPromise;
    }

    // Resolves to true once loaded, or false if it failed or was never loaded
    async waitForLoad()
    {
        if (this.isLoaded() === true)
            return true;

        if (this.#loadPromise === null)
            return false;

        return await this.#loadPromise;
    }

    /*
        Loads one page of a Spine atlas: page is one of parseSpineAtlas()'s pages for the
        .atlas file at atlasUrl. Its image (the page's name) is loaded from the file's
        folder, and each region becomes an AtlasSubTexture. getAtlasURL() is then
        "atlasUrl#pageName". Resolves like load(): true once ready, false on failure
        (unloaded, so it can load again); the same page again shares the load.
    */
    async loadSpineAtlas(atlasUrl, page)
    {
        if (typeof atlasUrl !== "string" || atlasUrl.length === 0 || page === null || typeof page !== "object" || Array.isArray(page.regions) === false)
        {
            console.error("TextureAtlas.loadSpineAtlas() needs the .atlas file's url and one of its pages (see parseSpineAtlas())");
                return false;
        }

        const url = `${atlasUrl}#${page.name}`;

        if (this.isLoaded() === true || this.#isLoading === true)
        {
            if (url === this.#atlasUrl)
                return await this.waitForLoad(); // Same page: share the load

            console.error(`TextureAtlas is already used for ${this.#atlasUrl}; unload it first, or create a new TextureAtlas for ${url}`);
                return false;
        }

        // Mipmaps only if the page's filter reads them (the texture isn't loaded, so it can be swapped)
        const usesMipmaps = TextureAtlas.#isMipmapFilter(page.minFilter);

        if (this.#texture.hasMipmaps() !== usesMipmaps)
            this.#texture = new Texture(true, usesMipmaps);

        this.#atlasUrl = url;
        this.#spinePage = page;
        this.#isLoading = true;
        this.#loadPromise = this.#loadSpinePage(atlasUrl, url, page);
            return await this.#loadPromise;
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
        it stay valid. textures is as for loadCanvas(). The old AtlasSubTextures
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

    // The AtlasSubTexture with this name, or null (also while loading)
    getSubTexture(name) { return this.#subTextures.get(name) ?? null; }
    hasSubTexture(name) { return this.#subTextures.has(name); }
    getSubTextureNames() { return Array.from(this.#subTextures.keys()); }

    // The whole atlas image, as a Texture
    getTexture() { return this.#texture; }

    getWidth() { return this.#texture.getWidth(); }
    getHeight() { return this.#texture.getHeight(); }
    getAtlasURL() { return this.#atlasUrl; }
    isLoaded() { return (this.#isLoading === false && this.#texture.isLoaded() === true); }
    isLoading() { return this.#isLoading; }

    // True for a Spine page loaded with loadSpineAtlas()
    isSpinePage() { return (this.#spinePage !== null); }

    // True if the image's colors are already multiplied by alpha (a Spine page's pma); draw it with BlendMode.kPremultiplied
    isPremultiplied() { return (this.#spinePage?.pma === true); }

    // A Spine page's scale (1 unless the .atlas says otherwise)
    getScale() { return this.#spinePage?.scale ?? 1.0; }

    /*
        The Sampler a Spine page asks for (its filter and repeat), made the first time
        it's asked for and shared by everything drawing the page; freed by unload().
        null for other atlases (Materials then use their default).
    */
    getSampler()
    {
        if (this.#spinePage === null)
            return null;

        if (this.#sampler === null)
        {
            const p = this.#spinePage;
            this.#sampler = new Sampler();
            this.#sampler.setFilter(p.minFilter, p.magFilter);
            this.#sampler.setWrap(p.wrapS, p.wrapT);
        }

        return this.#sampler;
    }

    // Frees the texture (and a Spine page's Sampler); its AtlasSubTextures stop being loaded, and are forgotten. load() can be called again.
    unload()
    {
        this.#texture.unload();
        this.#sampler?.unload();
        this.#sampler = null;
        this.#subTextures.clear();
        this.#atlasUrl = null;
        this.#spinePage = null;
        this.#isLoading = false;
        this.#loadPromise = null;
    }

    // *** Internal Methods ***

    // The JSON, then the first of its image urls that loads; true once the AtlasSubTextures are made
    async #loadFiles(atlasUrl)
    {
        try
        {
            const response = await fetch(atlasUrl);

            if (response.ok === false)
                throw new Error(`HTTP ${response.status}`);

            const json = await response.json();
            const entries = TextureAtlas.#parse(json);

            if (entries === null)
                return this.#fail(atlasUrl, "the JSON isn't a valid atlas");

            const imageUrls = TextureAtlas.#imageUrlsFor(atlasUrl, json);

            // Tries each url in turn; a failed Texture.load() unloads the texture, so it can load the next
            for (const url of imageUrls)
            {
                if (await this.#texture.load(url) === true)
                {
                    if (this.#atlasUrl !== atlasUrl)
                        return false; // Unloaded while it was loading

                    this.#isLoading = false;
                    this.#createSubTextures(entries, json);
                        return true;
                }
            }

            return this.#fail(atlasUrl, `couldn't load its image (tried ${imageUrls.join(", ") || "nothing: no texture_name or texture_filepath"})`);
        }
        catch (error)
        {
            return this.#fail(atlasUrl, `couldn't load the JSON: ${error.message}`);
        }
    }

    // A Spine page's image, from the .atlas file's folder; true once its AtlasSubTextures are made
    async #loadSpinePage(fileUrl, url, page)
    {
        const slash = fileUrl.lastIndexOf("/");
        const imageUrl = ((slash !== -1) ? fileUrl.substring(0, slash + 1) : "") + page.name;

        if (await this.#texture.load(imageUrl) === false)
            return this.#fail(url, `couldn't load its image ${imageUrl}`);

        if (this.#atlasUrl !== url)
            return false; // Unloaded while it was loading

        if (this.getWidth() !== page.width || this.getHeight() !== page.height)
            console.error(`TextureAtlas: the .atlas says ${page.width} x ${page.height}, but the image is ${this.getWidth()} x ${this.getHeight()} (${url})`);

        for (const region of page.regions)
        {
            // The first region with a name wins, as Spine's findRegion() does
            if (this.#subTextures.has(region.name) === false)
                this.#subTextures.set(region.name, AtlasSubTexture._fromSpineRegion(this, region, page.width, page.height));
        }

        this.#isLoading = false;
            return true;
    }

    // Reports why atlasUrl failed and unloads (if it's still this atlas's load); returns false
    #fail(atlasUrl, message)
    {
        console.error(`TextureAtlas: ${message} (${atlasUrl})`);

        if (this.#atlasUrl === atlasUrl)
            this.unload();

        return false;
    }

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
            this.#subTextures.set(e.name, new AtlasSubTexture(this, e.name, e.u0, e.v0, e.u1, e.v1, width, height));
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

    /*
        Splits a .atlas line "name: a, b, c, d" into entry (entry[0] the name, then up to 4
        values, as Spine reads them). Returns how many values, or 0 if it isn't a field.
    */
    static #readSpineEntry(entry, line)
    {
        if (line === null || line === undefined)
            return 0;

        line = line.trim();

        const colon = line.indexOf(":");

        if (line.length === 0 || colon === -1)
            return 0;

        entry[0] = line.substring(0, colon).trim();

        for (let i = 1, start = colon + 1; ; ++i)
        {
            const comma = line.indexOf(",", start);

            if (comma === -1)
            {
                entry[i] = line.substring(start).trim();
                    return i;
            }

            entry[i] = line.substring(start, comma).trim();
            start = comma + 1;

            if (i === 4)
                return 4;
        }
    }

    // One page field into page; false (with a console.error) for a filter Spine doesn't have. Unknown fields are ignored.
    static #readSpinePageField(page, entry)
    {
        switch (entry[0])
        {
            case "size":
                page.width = parseInt(entry[1]);
                page.height = parseInt(entry[2]);
                break;

            case "format":
                page.format = entry[1];
                break;

            case "filter":
                page.minFilter = TextureAtlas.#kSpineFilters.get(entry[1]);
                page.magFilter = TextureAtlas.#kSpineFilters.get(entry[2]);

                if (page.minFilter === undefined || page.magFilter === undefined)
                {
                    console.error(`TextureAtlas.parseSpineAtlas(): page ${page.name} has an unknown filter "${entry[1]}, ${entry[2]}"`);
                        return false;
                }
                break;

            case "repeat":
                page.wrapS = (entry[1].indexOf("x") !== -1) ? 10497 : 33071; // REPEAT or CLAMP_TO_EDGE
                page.wrapT = (entry[1].indexOf("y") !== -1) ? 10497 : 33071;
                break;

            case "pma":
                page.pma = (entry[1] === "true");
                break;

            case "scale":
                page.scale = parseFloat(entry[1]);
                break;
        }

        return true;
    }

    // One region field into region; count is how many values entry has. Unknown fields are ignored.
    static #readSpineRegionField(region, entry, count)
    {
        const ints = () => entry.slice(1, count + 1).map((v) => parseInt(v));

        switch (entry[0])
        {
            case "xy": // Old exports; bounds replaced it
                [region.x, region.y] = ints();
                break;

            case "size": // Old exports
                [region.width, region.height] = ints();
                break;

            case "bounds":
                [region.x, region.y, region.width, region.height] = ints();
                break;

            case "offset": // Old exports
                [region.offsetX, region.offsetY] = ints();
                break;

            case "orig": // Old exports
                [region.originalWidth, region.originalHeight] = ints();
                break;

            case "offsets":
                [region.offsetX, region.offsetY, region.originalWidth, region.originalHeight] = ints();
                break;

            case "rotate":
                if (entry[1] === "true")
                    region.rotation = 90;
                else if (entry[1] !== "false")
                    region.rotation = parseInt(entry[1]);
                break;

            case "index":
                region.index = parseInt(entry[1]);
                break;

            case "split":
                region.splits = ints();
                break;

            case "pad":
                region.pads = ints();
                break;
        }
    }

    // True for a GL min filter that reads mipmaps
    static #isMipmapFilter(filter) { return (filter >= 9984 && filter <= 9987); }

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
    AtlasSubTexture - One named image in a TextureAtlas. It's a BaseTexture, so
    models, Materials and Particles2D take it like a Texture: it binds its
    atlas's Texture, its width and height are its own size in pixels, and
    it's loaded while its atlas is. Models draw only its part of the atlas
    (see getUVRect()).

    The pixels belong to the atlas, so it has no load methods, and unload()
    does nothing (unload the TextureAtlas instead).

    Its UV rect is exactly its region of the atlas, for JSON and Spine atlases
    alike. Filtering at its edges reads the pixels around it, so pack atlases
    with padding (and extrude the edges of small images that get stretched).

    Spine regions also carry (the defaults for other atlases in brackets):
        getRotation()                      Degrees the image is turned in the atlas, 90 when packed sideways [0].
                                           The UV rect covers the turned rect; width and height are the image's.
        getOffsetX() / getOffsetY()        Trimmed whitespace left of / below the packed image, in pixels [0]
        getOriginalWidth() / Height()      The image's size before trimming [its width / height]
        getIndex()                         Its frame number in a sequence [0]
        getSplits() / getPads()            Nine-patch splits and padding, [4] each, or null [null]
    For now only Spine uses rotation and trimming: other models draw a rotated
    one unrotated (Material reports it).
*/
class AtlasSubTexture extends BaseTexture
{
    #atlas;
    #name;
    #uvRect;  // Exactly its region of the atlas
    #rotation;
    #offsetX;
    #offsetY;
    #originalWidth;
    #originalHeight;
    #index;
    #splits;
    #pads;

    // Made by TextureAtlas once its image has loaded; _width / _height are in pixels (the JSON's, or worked out from the UVs)
    constructor(_atlas, _name, _u0, _v0, _u1, _v1, _width, _height)
    {
        super();

        this.#atlas = _atlas;
        this.#name = _name;
        this._setSize(_width, _height);
        this.#uvRect = new UVRect(_u0, _v0, _u1 - _u0, _v1 - _v0);

        this.#rotation = 0;
        this.#offsetX = 0;
        this.#offsetY = 0;
        this.#originalWidth = _width;
        this.#originalHeight = _height;
        this.#index = 0;
        this.#splits = null;
        this.#pads = null;
    }

    /*
        For TextureAtlas: a Spine region (see TextureAtlas.parseSpineAtlas()) on a page of
        pageWidth x pageHeight pixels. Its rect is measured from the image's top-left; the
        UV rect is the same pixels with V up.
    */
    static _fromSpineRegion(atlas, region, pageWidth, pageHeight)
    {
        const isTurned = (region.rotation === 90); // Packed sideways: the rect in the atlas is height x width
        const packedWidth = isTurned ? region.height : region.width;
        const packedHeight = isTurned ? region.width : region.height;

        const u0 = region.x / pageWidth;
        const u1 = (region.x + packedWidth) / pageWidth;
        const v0 = 1.0 - ((region.y + packedHeight) / pageHeight);
        const v1 = 1.0 - (region.y / pageHeight);

        let s = new AtlasSubTexture(atlas, region.name, u0, v0, u1, v1, region.width, region.height);
        s.#rotation = region.rotation;
        s.#offsetX = region.offsetX;
        s.#offsetY = region.offsetY;
        s.#originalWidth = region.originalWidth;
        s.#originalHeight = region.originalHeight;
        s.#index = region.index;
        s.#splits = region.splits;
        s.#pads = region.pads;
            return s;
    }

    getAtlas() { return this.#atlas; }
    getName() { return this.#name; }

    getRotation() { return this.#rotation; }
    getOffsetX() { return this.#offsetX; }
    getOffsetY() { return this.#offsetY; }
    getOriginalWidth() { return this.#originalWidth; }
    getOriginalHeight() { return this.#originalHeight; }
    getIndex() { return this.#index; }
    getSplits() { return this.#splits; } // Read-only; [left, right, top, bottom] or null
    getPads() { return this.#pads; }     // Read-only; [left, right, top, bottom] or null

    // The atlas's Texture, which this binds
    getTexture() { return this.#atlas.getTexture(); }

    // Its part of the atlas, as a UVRect. Read-only.
    getUVRect() { return this.#uvRect; }

    /*
        Maps rect, a UVRect within this AtlasSubTexture (0 - 1 across it), to the
        same part of the atlas, written into out (also returned). Used for a
        Sprite's frames.
    */
    mapUVRect(rect, out)
    {
        const r = this.#uvRect;

        return out.setUnclamped(r.getX() + (rect.getX() * r.getWidth()), r.getY() + (rect.getY() * r.getHeight()),
                                rect.getWidth() * r.getWidth(), rect.getHeight() * r.getHeight());
    }

    // *** BaseTexture ***

    isLoaded() { return (this.#atlas.isLoaded() === true && this.#atlas.getSubTexture(this.#name) === this); }
    hasMipmaps() { return this.getTexture().hasMipmaps(); }

    // The atlas JSON's url, with "#name" on the end
    getURL() { return `${this.#atlas.getAtlasURL()}#${this.#name}`; }

    bind() { this.getTexture().bind(); }

    // unload() does nothing (from BaseTexture): the pixels belong to the atlas; unload the TextureAtlas instead
}
