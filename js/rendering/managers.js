"use strict";

/*
    Asset managers. The app creates one instance of each and uses it everywhere:

        // After WGLV.init()
        gTextureManager = new TextureManager();
        gFontManager = new FontManager("'Segoe UI', Arial, sans-serif");
        gMaterialManager = new MaterialManager();
*/

/*
    FontManager - Keeps one Font per source (font file url or system CSS family).

    The constructor creates the default font. Any request for a font that
    fails, for any reason, logs a console.error and returns the default font
    instead, so callers always get a usable Font back.

    Usage:
        let fonts = new FontManager("'Segoe UI', Arial, sans-serif");
        const title = await fonts.load("./fonts/MyFont-Regular.ttf");
        const mono = fonts.loadFromSystem("Consolas, monospace");
        let t = new Text2D(title, 48);

    Requesting the same source again returns the same Font (sharing an
    in-progress load), so a file is only downloaded once.
*/
class FontManager
{
    static #kFallbackCss = "sans-serif";

    #fonts;       // Source key -> Font
    #defaultFont;

    // defaultCssFamily is the system font used as the default
    constructor(defaultCssFamily = FontManager.#kFallbackCss)
    {
        this.#fonts = new Map();
        this.#defaultFont = new Font();

        if (this.#defaultFont.loadFromSystem(defaultCssFamily) === false)
        {
            console.error(`FontManager couldn't use "${defaultCssFamily}" as the default font; using ${FontManager.#kFallbackCss}`);
            this.#defaultFont = new Font();
            this.#defaultFont.loadFromSystem(FontManager.#kFallbackCss);
        }
    }

    getDefault() { return this.#defaultFont; }

    // Loads a font file. Always resolves to a Font: the loaded one, or the default font on failure.
    async load(url)
    {
        if (typeof url !== "string" || url.length === 0)
        {
            console.error("FontManager.load() needs a font file url; using the default font");
                return this.#defaultFont;
        }

        const key = "file:" + url;
        let font = this.#fonts.get(key);
        let ok;

        if (font === undefined)
        {
            font = new Font();
            this.#fonts.set(key, font); // Stored before loading, so a second request shares this load
            ok = await font.load(url);
        }
        else
        {
            ok = await font.waitForLoad();
        }

        if (ok === false)
        {
            if (this.#fonts.get(key) === font)
                this.#fonts.delete(key); // Don't keep failed fonts; a later request tries again

            console.error(`FontManager couldn't load ${url}; using the default font`);
                return this.#defaultFont;
        }

        return font;
    }

    // Uses a font the browser already has. Returns that Font, or the default font on failure.
    loadFromSystem(cssFamily)
    {
        const key = "system:" + cssFamily;
        const existing = this.#fonts.get(key);

        if (existing !== undefined)
            return existing;

        let font = new Font();

        if (font.loadFromSystem(cssFamily) === false)
        {
            console.error(`FontManager couldn't use system font "${cssFamily}"; using the default font`);
                return this.#defaultFont;
        }

        this.#fonts.set(key, font);
            return font;
    }

    // The Font for a font file url, or null if it isn't loaded or loading
    get(url)
    {
        return this.#fonts.get("file:" + url) ?? null;
    }

    has(url)
    {
        return this.#fonts.has("file:" + url);
    }

    unload(url)
    {
        const key = "file:" + url;
        const font = this.#fonts.get(key);

        if (font !== undefined)
        {
            font.unload();
            this.#fonts.delete(key);
        }
    }

    // Unloads every font except the default
    unloadAll()
    {
        for (const font of this.#fonts.values())
            font.unload();

        this.#fonts.clear();
    }
}

/*
    TextureManager - Keeps one Texture per image url (and flip/mipmap options).
    Filtering and wrapping are sampler state, set on the Material (see Sampler).

    The constructor creates the white texture (getWhiteTexture()): pure white,
    so a model drawn with it shows just its color, e.g. a solid panel. Any
    request for a texture that fails, for any reason, logs a console.error
    and returns the white texture instead, so callers always get a loaded
    Texture back. Create it after WGLV.init().

    Usage:
        let textures = new TextureManager();
        const square = await textures.load("./textures/square.png");
        rect.load(square, 64, 64);

    Requesting the same url (with the same options) again returns the same
    Texture, sharing an in-progress load, so an image is only loaded once.

    Atlases (see TextureAtlas) are kept the same way, one per JSON url.
    Their SubTextures are BaseTextures like Texture, so they go wherever one does:
        const atlas = await textures.loadAtlas("./textures/checkers.json");
        rect.load(atlas.getSubTexture("checker_king"), 64, 64);
*/
class TextureManager
{
    static #kDefaultPixels = new Uint8Array([255, 255, 255, 255,   255, 255, 255, 255,
                                             255, 255, 255, 255,   255, 255, 255, 255]); // 2 x 2, pure white

    #textures;       // Key -> { texture, promise }
    #atlases;        // Key -> { atlas, promise }
    #whiteTexture;

    constructor()
    {
        this.#textures = new Map();
        this.#atlases = new Map();
        this.#whiteTexture = new Texture(true, false);

        if (this.#whiteTexture.loadPixels(2, 2, TextureManager.#kDefaultPixels) === false)
            console.error("TextureManager couldn't create its white texture (was WGLV.init() called first?)");
    }

    // Pure white; also what failed loads return. Shared: don't unload it.
    getWhiteTexture() { return this.#whiteTexture; }

    // Loads an image. Always resolves to a loaded Texture: this image's, or the white texture on failure.
    async load(url, flipY = true, useMipmaps = true)
    {
        if (typeof url !== "string" || url.length === 0)
        {
            console.error("TextureManager.load() needs an image url; using the white texture");
                return this.#whiteTexture;
        }

        const key = this.#key(url, flipY, useMipmaps);
        let entry = this.#textures.get(key);

        if (entry === undefined)
        {
            const texture = new Texture(flipY, useMipmaps);
            const promise = new Promise((resolve) => {
                const started = texture.load(url, () => resolve(true), () => resolve(false));

                if (started === false)
                    resolve(false);
            });

            entry = { texture, promise };
            this.#textures.set(key, entry); // Stored before loading, so a second request shares this load
        }

        if (await entry.promise === false)
        {
            if (this.#textures.get(key) === entry)
                this.#textures.delete(key); // Don't keep failed textures; a later request tries again

            console.error(`TextureManager couldn't load ${url}; using the white texture`);
                return this.#whiteTexture;
        }

        return entry.texture;
    }

    // The Texture for a url, or null if it isn't loaded or loading. It may still be loading; check isLoaded().
    get(url, flipY = true, useMipmaps = true)
    {
        return this.#textures.get(this.#key(url, flipY, useMipmaps))?.texture ?? null;
    }

    has(url, flipY = true, useMipmaps = true)
    {
        return this.#textures.has(this.#key(url, flipY, useMipmaps));
    }

    unload(url, flipY = true, useMipmaps = true)
    {
        const key = this.#key(url, flipY, useMipmaps);
        const entry = this.#textures.get(key);

        if (entry !== undefined)
        {
            entry.texture.unload();
            this.#textures.delete(key);
        }
    }

    /*
        Loads a TextureAtlas: the JSON at atlasUrl and the image beside it. Resolves
        to the loaded atlas, or null on failure (there's no default atlas).
        Requesting the same url again returns the same atlas, sharing a load.
    */
    async loadAtlas(atlasUrl, useMipmaps = true)
    {
        if (typeof atlasUrl !== "string" || atlasUrl.length === 0)
        {
            console.error("TextureManager.loadAtlas() needs an atlas JSON url");
                return null;
        }

        const key = this.#key(atlasUrl, true, useMipmaps);
        let entry = this.#atlases.get(key);

        if (entry === undefined)
        {
            const atlas = new TextureAtlas(useMipmaps);
            const promise = new Promise((resolve) => {
                const started = atlas.load(atlasUrl, () => resolve(true), () => resolve(false));

                if (started === false)
                    resolve(false);
            });

            entry = { atlas, promise };
            this.#atlases.set(key, entry); // Stored before loading, so a second request shares this load
        }

        if (await entry.promise === false)
        {
            if (this.#atlases.get(key) === entry)
                this.#atlases.delete(key); // Don't keep failed atlases; a later request tries again

            console.error(`TextureManager couldn't load the atlas ${atlasUrl}`);
                return null;
        }

        return entry.atlas;
    }

    // The TextureAtlas for a url, or null if it isn't loaded or loading. It may still be loading; check isLoaded().
    getAtlas(atlasUrl, useMipmaps = true)
    {
        return this.#atlases.get(this.#key(atlasUrl, true, useMipmaps))?.atlas ?? null;
    }

    hasAtlas(atlasUrl, useMipmaps = true)
    {
        return this.#atlases.has(this.#key(atlasUrl, true, useMipmaps));
    }

    // Unloads an atlas; its SubTextures stop being loaded
    unloadAtlas(atlasUrl, useMipmaps = true)
    {
        const key = this.#key(atlasUrl, true, useMipmaps);
        const entry = this.#atlases.get(key);

        if (entry !== undefined)
        {
            entry.atlas.unload();
            this.#atlases.delete(key);
        }
    }

    // Unloads every texture and atlas except the white texture
    unloadAll()
    {
        for (const entry of this.#textures.values())
            entry.texture.unload();

        for (const entry of this.#atlases.values())
            entry.atlas.unload();

        this.#textures.clear();
        this.#atlases.clear();
    }

    // *** Internal Methods ***

    #key(url, flipY, useMipmaps)
    {
        return `${url}|${flipY ? "flip" : "noflip"}|${useMipmaps ? "mips" : "nomips"}`;
    }
}

/*
    MaterialManager - Keeps one Material per unique shader + textures + samplers
    (see Material.getKey()).

    Requesting the same combination again returns the same Material. The
    shaders, textures and samplers belong to the caller (or their managers);
    unloading a Material here doesn't unload them.

    A failed request logs a console.error and returns null: there's no
    default material, since the manager doesn't know which shader to use.

    Usage:
        let materials = new MaterialManager();
        const m = materials.load(shader, [texture], [sampler]);

    Materials hold no uniform values (those belong to each model), so one
    Material can be shared by any number of models.
*/
class MaterialManager
{
    #materials; // Key -> Material

    constructor()
    {
        this.#materials = new Map();
    }

    // The Material for this shader, textures and samplers (samplers optional, per unit), or null on failure
    load(shader, textures = [], samplers = null)
    {
        if (shader == null)
        {
            console.error("MaterialManager.load() needs a shader");
                return null;
        }

        let material = new Material();

        if (material.load(shader, textures, samplers) === false)
        {
            console.error("MaterialManager couldn't load a material (up to 4 textures and samplers are supported)");
                return null;
        }

        return this.add(material);
    }

    // Stores a loaded Material. If one with the same key is already stored, that one is returned instead.
    add(material)
    {
        const key = material?.getKey() ?? null;

        if (key === null)
        {
            console.error("MaterialManager.add() needs a loaded Material");
                return null;
        }

        const existing = this.#materials.get(key);

        if (existing !== undefined)
            return existing;

        this.#materials.set(key, material);
            return material;
    }

    // The Material for a key from Material.getKey(), or null
    get(key)
    {
        return this.#materials.get(key) ?? null;
    }

    has(key)
    {
        return this.#materials.has(key);
    }

    unload(key)
    {
        const material = this.#materials.get(key);

        if (material !== undefined)
        {
            material.unload(); // Leaves the shader, textures and samplers alone
            this.#materials.delete(key);
        }
    }

    unloadAll()
    {
        for (const material of this.#materials.values())
            material.unload();

        this.#materials.clear();
    }
}