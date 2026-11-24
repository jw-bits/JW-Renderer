"use strict";

/*
    Render asset managers. All static: the renderer has one WebGL context
    (WGLV), so there's one of each, shared by the app and the renderer's own
    classes, with nothing to create:

        // After WGLV.init()
        FontManager.setDefaultFamily("'Segoe UI', Arial, sans-serif"); // Optional: the default font (sans-serif otherwise)
        const square = await TextureManager.load("./textures/square.png");
        const font = await FontManager.load("./fonts/MyFont-Regular.ttf");
        const shader = ShaderManager.get(Rect2DShaderSource);
        const material = MaterialManager.load(shader, [square]);
*/

/*
    ShaderManager - Builds each shader once and shares it. A shader is asked
    for by its source object, { name, VS, FS } (e.g. Rect2DShaderSource from
    shader_source.js), and kept by its name; the first request compiles and
    links it, and every request after returns the same Shader. Two different
    sources with the same name is an error.

    Usage:
        const shader = ShaderManager.get(Rect2DShaderSource); // null if it can't be built
        material.load(shader, [texture]);

        ShaderManager.find("Rect2D");                         // The built Shader by name, or null

        // Optional: build them while loading, so none compiles mid-frame on first use
        ShaderManager.preload([Rect2DShaderSource, SpriteShaderSource]);

    The Shaders belong to ShaderManager: don't unload one yourself (e.g.
    Material.unload(true)), since others share it. unloadAll() frees them all
    (e.g. when shutting down); a later get() builds a shader again.

    A shader that fails to build isn't kept, so asking again tries again.
    Use it after WGLV.init().
*/
class ShaderManager
{
    static #shaders = new Map(); // Source name -> { source, shader }

    // The Shader for source ({ name, VS, FS }), built the first time it's asked for; null (with a console.error) if it can't be built
    static get(source)
    {
        const name = source?.name;

        if (typeof name !== "string" || name.length === 0 || typeof source.VS !== "string" || typeof source.FS !== "string")
        {
            console.error("ShaderManager.get() needs a shader source with a name and VS and FS strings");
                return null;
        }

        const existing = ShaderManager.#shaders.get(name);

        if (existing !== undefined)
        {
            if (existing.source !== source)
            {
                console.error(`ShaderManager: another shader source is already named "${name}"; names must be unique`);
                    return null;
            }

            return existing.shader;
        }

        let shader = new Shader();

        if (shader.load(source.VS, source.FS) === false)
        {
            console.error(`ShaderManager couldn't build "${name}" (see the compile or link error above)`);
                return null;
        }

        ShaderManager.#shaders.set(name, { source: source, shader: shader });
            return shader;
    }

    // The Shader built for the source with this name, or null if there isn't one (find() never builds)
    static find(name) { return ShaderManager.#shaders.get(name)?.shader ?? null; }

    // True if source's Shader has been built
    static has(source) { return (ShaderManager.#shaders.get(source?.name)?.source === source); }

    // Builds every source in sources (an array) now; returns true if all of them built
    static preload(sources)
    {
        let isAllBuilt = true;

        for (const source of sources)
        {
            if (ShaderManager.get(source) === null)
                isAllBuilt = false;
        }

        return isAllBuilt;
    }

    // Shaders built so far
    static getCount() { return ShaderManager.#shaders.size; }

    // Frees one source's Shader; nothing may still be drawing with it
    static unload(source)
    {
        if (ShaderManager.has(source) === false)
            return;

        ShaderManager.#shaders.get(source.name).shader.unload();
        ShaderManager.#shaders.delete(source.name);
    }

    // Frees every Shader; nothing may still be drawing with them
    static unloadAll()
    {
        for (const entry of ShaderManager.#shaders.values())
            entry.shader.unload();

        ShaderManager.#shaders.clear();
    }
}

/*
    FontManager - Keeps one Font per source (font file url or system CSS family).

    The default font is a system font: sans-serif from the start, or the
    family given to setDefaultFamily() (set it before building text; text
    made earlier keeps the old default). Any request for a font that fails,
    for any reason, logs a console.error and returns the default font
    instead, so callers always get a usable Font back.

    Usage:
        FontManager.setDefaultFamily("'Segoe UI', Arial, sans-serif"); // Optional
        const title = await FontManager.load("./fonts/MyFont-Regular.ttf");
        const mono = FontManager.loadFromSystem("Consolas, monospace");
        let t = new Text2D(title, 48);

    Requesting the same source again returns the same Font (sharing an
    in-progress load), so a file is only downloaded once.
*/
class FontManager
{
    static #kFallbackCss = "sans-serif";

    static #fonts = new Map(); // Source key -> Font
    static #defaultFont;       // sans-serif until setDefaultFamily()

    // A system font needs nothing from WebGL or the page, so the default can be made as soon as this loads
    static
    {
        FontManager.#defaultFont = FontManager.#makeFallback();
    }

    /*
        Makes the system font cssFamily the default font, replacing the current
        one. Returns false (keeping the current one) if it can't be used.
    */
    static setDefaultFamily(cssFamily)
    {
        let font = new Font();

        if (font.loadFromSystem(cssFamily) === false)
        {
            console.error(`FontManager couldn't use "${cssFamily}" as the default font; keeping ${FontManager.#defaultFont.getCssFamily()}`);
                return false;
        }

        FontManager.#defaultFont = font;
            return true;
    }

    // The default font: sans-serif, or setDefaultFamily()'s
    static getDefault() { return FontManager.#defaultFont; }

    // Loads a font file. Always resolves to a Font: the loaded one, or the default font on failure.
    static async load(url)
    {
        if (typeof url !== "string" || url.length === 0)
        {
            console.error("FontManager.load() needs a font file url; using the default font");
                return FontManager.getDefault();
        }

        const key = "file:" + url;
        let font = FontManager.#fonts.get(key);
        let ok;

        if (font === undefined)
        {
            font = new Font();
            FontManager.#fonts.set(key, font); // Stored before loading, so a second request shares this load
            ok = await font.load(url);
        }
        else
        {
            ok = await font.waitForLoad();
        }

        if (ok === false)
        {
            if (FontManager.#fonts.get(key) === font)
                FontManager.#fonts.delete(key); // Don't keep failed fonts; a later request tries again

            console.error(`FontManager couldn't load ${url}; using the default font`);
                return FontManager.getDefault();
        }

        return font;
    }

    // Uses a font the browser already has. Returns that Font, or the default font on failure.
    static loadFromSystem(cssFamily)
    {
        const key = "system:" + cssFamily;
        const existing = FontManager.#fonts.get(key);

        if (existing !== undefined)
            return existing;

        let font = new Font();

        if (font.loadFromSystem(cssFamily) === false)
        {
            console.error(`FontManager couldn't use system font "${cssFamily}"; using the default font`);
                return FontManager.getDefault();
        }

        FontManager.#fonts.set(key, font);
            return font;
    }

    // The Font for a font file url, or null if it isn't loaded or loading
    static get(url) { return FontManager.#fonts.get("file:" + url) ?? null; }
    static has(url) { return FontManager.#fonts.has("file:" + url); }

    static unload(url)
    {
        const key = "file:" + url;
        const font = FontManager.#fonts.get(key);

        if (font !== undefined)
        {
            font.unload();
            FontManager.#fonts.delete(key);
        }
    }

    // Unloads every font except the default
    static unloadAll()
    {
        for (const font of FontManager.#fonts.values())
            font.unload();

        FontManager.#fonts.clear();
    }

    // *** Internal Methods ***

    static #makeFallback()
    {
        let font = new Font();
        font.loadFromSystem(FontManager.#kFallbackCss);
            return font;
    }
}

/*
    TextureManager - Keeps one Texture per image url (and flip/mipmap options).
    Filtering and wrapping are sampler state, set on the Material (see Sampler).

    getWhiteTexture() is pure white, so a model drawn with it shows just its
    color, e.g. a solid panel; it's made the first time it's asked for. Any
    request for a texture that fails, for any reason, logs a console.error
    and returns the white texture instead, so callers always get a loaded
    Texture back. Use it after WGLV.init().

    Usage:
        const square = await TextureManager.load("./textures/square.png");
        rect.load(square, 64, 64);

    Requesting the same url (with the same options) again returns the same
    Texture, sharing an in-progress load, so an image is only loaded once.

    Atlases (see TextureAtlas) are kept the same way, one per JSON url.
    Their SubTextures are BaseTextures like Texture, so they go wherever one does:
        const atlas = await TextureManager.loadAtlas("./textures/checkers.json");
        rect.load(atlas.getSubTexture("checker_king"), 64, 64);
*/
class TextureManager
{
    static #kWhitePixels = new Uint8Array([255, 255, 255, 255,   255, 255, 255, 255,
                                           255, 255, 255, 255,   255, 255, 255, 255]); // 2 x 2, pure white

    static #textures = new Map(); // Key -> Texture
    static #atlases = new Map();  // Key -> TextureAtlas
    static #whiteTexture = null;  // Made the first time it's asked for

    // Pure white; also what failed loads return. Shared: don't unload it.
    static getWhiteTexture()
    {
        if (TextureManager.#whiteTexture === null)
        {
            let texture = new Texture(true, false);

            if (texture.loadPixels(2, 2, TextureManager.#kWhitePixels) === false)
            {
                console.error("TextureManager couldn't create its white texture (was WGLV.init() called first?)");
                    return texture; // Not kept, so the next call tries again
            }

            TextureManager.#whiteTexture = texture;
        }

        return TextureManager.#whiteTexture;
    }

    // Loads an image. Always resolves to a loaded Texture: this image's, or the white texture on failure.
    static async load(url, flipY = true, useMipmaps = true)
    {
        if (typeof url !== "string" || url.length === 0)
        {
            console.error("TextureManager.load() needs an image url; using the white texture");
                return TextureManager.getWhiteTexture();
        }

        const key = TextureManager.#key(url, flipY, useMipmaps);
        let texture = TextureManager.#textures.get(key);
        let ok;

        if (texture === undefined)
        {
            texture = new Texture(flipY, useMipmaps);
            TextureManager.#textures.set(key, texture); // Stored before loading, so a second request shares this load
            ok = await texture.load(url);
        }
        else
        {
            ok = await texture.waitForLoad();
        }

        if (ok === false)
        {
            if (TextureManager.#textures.get(key) === texture)
                TextureManager.#textures.delete(key); // Don't keep failed textures; a later request tries again

            console.error(`TextureManager couldn't load ${url}; using the white texture`);
                return TextureManager.getWhiteTexture();
        }

        return texture;
    }

    // The Texture for a url, or null if it isn't loaded or loading. It may still be loading; check isLoaded().
    static get(url, flipY = true, useMipmaps = true)
    {
        return TextureManager.#textures.get(TextureManager.#key(url, flipY, useMipmaps)) ?? null;
    }

    static has(url, flipY = true, useMipmaps = true)
    {
        return TextureManager.#textures.has(TextureManager.#key(url, flipY, useMipmaps));
    }

    static unload(url, flipY = true, useMipmaps = true)
    {
        const key = TextureManager.#key(url, flipY, useMipmaps);
        const texture = TextureManager.#textures.get(key);

        if (texture !== undefined)
        {
            texture.unload();
            TextureManager.#textures.delete(key);
        }
    }

    /*
        Loads a TextureAtlas: the JSON at atlasUrl and the image beside it. Resolves
        to the loaded atlas, or null on failure (there's no default atlas).
        Requesting the same url again returns the same atlas, sharing a load.
    */
    static async loadAtlas(atlasUrl, useMipmaps = true)
    {
        if (typeof atlasUrl !== "string" || atlasUrl.length === 0)
        {
            console.error("TextureManager.loadAtlas() needs an atlas JSON url");
                return null;
        }

        const key = TextureManager.#key(atlasUrl, true, useMipmaps);
        let atlas = TextureManager.#atlases.get(key);
        let ok;

        if (atlas === undefined)
        {
            atlas = new TextureAtlas(useMipmaps);
            TextureManager.#atlases.set(key, atlas); // Stored before loading, so a second request shares this load
            ok = await atlas.load(atlasUrl);
        }
        else
        {
            ok = await atlas.waitForLoad();
        }

        if (ok === false)
        {
            if (TextureManager.#atlases.get(key) === atlas)
                TextureManager.#atlases.delete(key); // Don't keep failed atlases; a later request tries again

            console.error(`TextureManager couldn't load the atlas ${atlasUrl}`);
                return null;
        }

        return atlas;
    }

    // The TextureAtlas for a url, or null if it isn't loaded or loading. It may still be loading; check isLoaded().
    static getAtlas(atlasUrl, useMipmaps = true)
    {
        return TextureManager.#atlases.get(TextureManager.#key(atlasUrl, true, useMipmaps)) ?? null;
    }

    static hasAtlas(atlasUrl, useMipmaps = true)
    {
        return TextureManager.#atlases.has(TextureManager.#key(atlasUrl, true, useMipmaps));
    }

    // Unloads an atlas; its SubTextures stop being loaded
    static unloadAtlas(atlasUrl, useMipmaps = true)
    {
        const key = TextureManager.#key(atlasUrl, true, useMipmaps);
        const atlas = TextureManager.#atlases.get(key);

        if (atlas !== undefined)
        {
            atlas.unload();
            TextureManager.#atlases.delete(key);
        }
    }

    // Unloads every texture and atlas except the white texture
    static unloadAll()
    {
        for (const texture of TextureManager.#textures.values())
            texture.unload();

        for (const atlas of TextureManager.#atlases.values())
            atlas.unload();

        TextureManager.#textures.clear();
        TextureManager.#atlases.clear();
    }

    // *** Internal Methods ***

    static #key(url, flipY, useMipmaps)
    {
        return `${url}|${flipY ? "flip" : "noflip"}|${useMipmaps ? "mips" : "nomips"}`;
    }
}

/*
    MaterialManager - Keeps one Material per unique shader + textures + samplers
    + blend mode (see Material.getKey()). Don't change a shared Material's blend
    mode; load one with the mode you need.

    Requesting the same combination again returns the same Material. The
    shaders, textures and samplers belong to the caller (or their managers);
    unloading a Material here doesn't unload them.

    A failed request logs a console.error and returns null: there's no
    default material, since the manager doesn't know which shader to use.

    Usage:
        const m = MaterialManager.load(shader, [texture], [sampler]);

    Materials hold no uniform values (those belong to each model), so one
    Material can be shared by any number of models.
*/
class MaterialManager
{
    static #materials = new Map(); // Key -> Material

    // The Material for this shader, textures, samplers (optional, per unit) and BlendMode, or null on failure
    static load(shader, textures = [], samplers = null, blendMode = BlendMode.kAlpha)
    {
        if (shader == null)
        {
            console.error("MaterialManager.load() needs a shader");
                return null;
        }

        let material = new Material();

        if (material.load(shader, textures, samplers) === false || material.setBlendMode(blendMode) === false)
        {
            console.error("MaterialManager couldn't load a material (up to 4 textures and samplers are supported)");
                return null;
        }

        return MaterialManager.add(material);
    }

    // Stores a loaded Material. If one with the same key is already stored, that one is returned instead.
    static add(material)
    {
        const key = material?.getKey() ?? null;

        if (key === null)
        {
            console.error("MaterialManager.add() needs a loaded Material");
                return null;
        }

        const existing = MaterialManager.#materials.get(key);

        if (existing !== undefined)
            return existing;

        MaterialManager.#materials.set(key, material);
            return material;
    }

    // The Material for a key from Material.getKey(), or null
    static get(key) { return MaterialManager.#materials.get(key) ?? null; }
    static has(key) { return MaterialManager.#materials.has(key); }

    static unload(key)
    {
        const material = MaterialManager.#materials.get(key);

        if (material !== undefined)
        {
            material.unload(); // Leaves the shader, textures and samplers alone
            MaterialManager.#materials.delete(key);
        }
    }

    static unloadAll()
    {
        for (const material of MaterialManager.#materials.values())
            material.unload();

        MaterialManager.#materials.clear();
    }
}
