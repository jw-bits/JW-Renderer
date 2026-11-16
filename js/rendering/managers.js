"use strict";

/*
    Asset managers. The app creates one instance of each and uses it everywhere:

        // After WGL.init()
        gTextureManager = new TextureManager();
        gFontManager = new FontManager("'Segoe UI', Arial, sans-serif");
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
    TextureManager - Keeps one Texture per image url (and wrap/flip options).

    The constructor creates the default texture: a magenta/white checkerboard,
    so a missing image is easy to spot. Any request for a texture that fails,
    for any reason, logs a console.error and returns the default texture
    instead, so callers always get a loaded Texture back. Create it after
    WGL.init().

    Usage:
        let textures = new TextureManager();
        const square = await textures.load("./textures/square.png");
        rect.load(square, 64, 64);

    Requesting the same url (with the same options) again returns the same
    Texture, sharing an in-progress load, so an image is only loaded once.
*/
class TextureManager
{
    static #kDefaultPixels = new Uint8Array([255, 0, 255, 255,   255, 255, 255, 255,
                                             255, 255, 255, 255, 255, 0, 255, 255]);

    #textures;       // Key -> { texture, promise }
    #defaultTexture;

    constructor()
    {
        this.#textures = new Map();
        this.#defaultTexture = new Texture();

        if (this.#defaultTexture.loadPixels(2, 2, TextureManager.#kDefaultPixels) === false)
            console.error("TextureManager couldn't create its default texture (was WGL.init() called first?)");
    }

    getDefault() { return this.#defaultTexture; }

    // Loads an image. Always resolves to a loaded Texture: this image's, or the default texture on failure.
    async load(url, useClamp = true, flipY = true)
    {
        if (typeof url !== "string" || url.length === 0)
        {
            console.error("TextureManager.load() needs an image url; using the default texture");
                return this.#defaultTexture;
        }

        const key = this.#key(url, useClamp, flipY);
        let entry = this.#textures.get(key);

        if (entry === undefined)
        {
            const texture = new Texture(useClamp, flipY);
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

            console.error(`TextureManager couldn't load ${url}; using the default texture`);
                return this.#defaultTexture;
        }

        return entry.texture;
    }

    // The Texture for a url, or null if it isn't loaded or loading. It may still be loading; check isLoaded().
    get(url, useClamp = true, flipY = true)
    {
        return this.#textures.get(this.#key(url, useClamp, flipY))?.texture ?? null;
    }

    has(url, useClamp = true, flipY = true)
    {
        return this.#textures.has(this.#key(url, useClamp, flipY));
    }

    unload(url, useClamp = true, flipY = true)
    {
        const key = this.#key(url, useClamp, flipY);
        const entry = this.#textures.get(key);

        if (entry !== undefined)
        {
            entry.texture.unload();
            this.#textures.delete(key);
        }
    }

    // Unloads every texture except the default
    unloadAll()
    {
        for (const entry of this.#textures.values())
            entry.texture.unload();

        this.#textures.clear();
    }

    // *** Internal Methods ***

    #key(url, useClamp, flipY)
    {
        return `${url}|${useClamp ? "clamp" : "repeat"}|${flipY ? "flip" : "noflip"}`;
    }
}
