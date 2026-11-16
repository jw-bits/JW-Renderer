"use strict";

/*
    Font - A font that Text2D can draw with.

    There are two ways to load one:
        load(url)                  A font file (.ttf, .otf). Async; resolves to true or false.
        loadFromSystem(cssFamily)  A font the browser already has, e.g. "'Segoe UI', Arial, sans-serif".

    For a font file, the family name is read from the file's "name" table.
    If it can't be read (e.g. .woff/.woff2, which are compressed), the file
    name without its extension is used.

    Usage:
        let f = new Font();
        if (await f.load("./fonts/MyFont-Regular.ttf"))
            console.log(f.getFamily()); // e.g. "My Font"

    Usually created through the app's FontManager, which keeps one Font per
    source and hands back its default font when a load fails.
*/
class Font
{
    #kFallbackCss = "sans-serif";

    #url;
    #family;
    #cssFamily;
    #face;
    #isLoaded;
    #loadPromise;

    constructor()
    {
        this.#url = null;
        this.#family = null;
        this.#cssFamily = null;
        this.#face = null;
        this.#isLoaded = false;
        this.#loadPromise = null;
    }

    // Loads a font file. Resolves to true once it can be drawn with, false on failure.
    async load(url)
    {
        if (this.#loadPromise !== null || this.#isLoaded === true)
        {
            if (url === this.#url)
                return await this.waitForLoad(); // Same file: share the load

            console.error(`Font is already used for ${this.#url ?? this.#cssFamily}; create a new Font for ${url}`);
                return false;
        }

        this.#url = url;
        this.#loadPromise = this.#loadFile(url);
            return await this.#loadPromise;
    }

    // Uses a font the browser already has. Ready right away; returns true or false.
    loadFromSystem(cssFamily)
    {
        if (this.#loadPromise !== null || this.#isLoaded === true)
        {
            console.error(`Font is already used for ${this.#url ?? this.#cssFamily}; create a new Font for ${cssFamily}`);
                return false;
        }

        if (typeof cssFamily !== "string" || cssFamily.trim().length === 0)
        {
            console.error("Font.loadFromSystem() needs a CSS font family");
                return false;
        }

        this.#family = cssFamily;
        this.#cssFamily = cssFamily;
        this.#isLoaded = true;
            return true;
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

    unload()
    {
        if (this.#face !== null)
        {
            document.fonts.delete(this.#face);
            this.#face = null;
        }

        this.#url = null;
        this.#family = null;
        this.#cssFamily = null;
        this.#isLoaded = false;
        this.#loadPromise = null;
    }

    getUrl() { return this.#url; } // null for system fonts
    getFamily() { return this.#family; } // null until loaded
    isLoaded() { return this.#isLoaded; }
    isSystem() { return (this.#isLoaded === true && this.#url === null); }

    // The family as used in a CSS / canvas font string; falls back to sans-serif until loaded
    getCssFamily() { return this.#cssFamily ?? this.#kFallbackCss; }

    // e.g. toCss(32, "bold") -> 'bold 32px "My Font"'
    toCss(size, weight = "normal")
    {
        return `${weight} ${size}px ${this.getCssFamily()}`;
    }

    // *** Internal Methods ***

    async #loadFile(url)
    {
        try
        {
            const buffer = await this.#loadBytes(url);
            const family = this.#readFamilyName(buffer) ?? this.#fileStem(url);

            const face = new FontFace(family, buffer);
            await face.load();
            document.fonts.add(face);

            this.#face = face;
            this.#family = family;
            this.#cssFamily = `"${family}"`; // Quoted, since names can have spaces
            this.#isLoaded = true;
                return true;
        }
        catch (err)
        {
            console.error(`Font couldn't load ${url}`, err);
            this.#url = null;
            this.#loadPromise = null; // Allow load() to be tried again
                return false;
        }
    }

    // XMLHttpRequest rather than fetch(), because fetch() rejects file:// URLs
    #loadBytes(url)
    {
        return new Promise((resolve, reject) => {
            let xhr = new XMLHttpRequest();
            xhr.open("GET", url);
            xhr.responseType = "arraybuffer";

            xhr.onload = () => {
                // file:// requests report status 0 on success
                if ((xhr.status === 200 || xhr.status === 0) && xhr.response !== null && xhr.response.byteLength > 0)
                    resolve(xhr.response);
                else
                    reject(new Error(`HTTP ${xhr.status}`));
            };

            xhr.onerror = () => reject(new Error("Network error"));
            xhr.send();
        });
    }

    /*
        Reads the family name from a TrueType/OpenType file's "name" table.
        Prefers the typographic family (name ID 16) over the legacy family
        (name ID 1), and Windows English names over others. Returns null if
        the file isn't a plain .ttf/.otf or has no usable name.
    */
    #readFamilyName(buffer)
    {
        try
        {
            const view = new DataView(buffer);
            const numTables = view.getUint16(4);
            let nameOffset = -1;

            for (let i = 0; i < numTables; ++i)
            {
                const rec = 12 + (i * 16);
                const tag = String.fromCharCode(view.getUint8(rec), view.getUint8(rec + 1), view.getUint8(rec + 2), view.getUint8(rec + 3));

                if (tag === "name")
                {
                    nameOffset = view.getUint32(rec + 8);
                    break;
                }
            }

            if (nameOffset < 0)
                return null; // Not a plain sfnt (e.g. woff, woff2, ttc)

            const count = view.getUint16(nameOffset + 2);
            const storage = nameOffset + view.getUint16(nameOffset + 4);
            let best = null;
            let bestScore = -1;

            for (let i = 0; i < count; ++i)
            {
                const rec = nameOffset + 6 + (i * 12);
                const platformId = view.getUint16(rec);
                const languageId = view.getUint16(rec + 4);
                const nameId = view.getUint16(rec + 6);
                const length = view.getUint16(rec + 8);
                const offset = storage + view.getUint16(rec + 10);

                if (nameId !== 1 && nameId !== 16)
                    continue;

                const isUtf16 = (platformId === 0 || platformId === 3);
                if (isUtf16 === false && platformId !== 1)
                    continue;

                let score = (nameId === 16) ? 4 : 0;
                if (platformId === 3) score += 2;
                if ((platformId === 3 && languageId === 0x0409) || (platformId === 1 && languageId === 0)) score += 1;

                if (score <= bestScore)
                    continue;

                let s = "";
                if (isUtf16 === true)
                {
                    for (let j = 0; j + 1 < length; j += 2)
                        s += String.fromCharCode(view.getUint16(offset + j));
                }
                else
                {
                    for (let j = 0; j < length; ++j)
                        s += String.fromCharCode(view.getUint8(offset + j));
                }

                s = s.trim();
                if (s.length > 0)
                {
                    best = s;
                    bestScore = score;
                }
            }

            return best;
        }
        catch
        {
            return null; // Truncated or malformed file
        }
    }

    // "./fonts/MyFont-Regular.ttf" -> "MyFont-Regular"
    #fileStem(url)
    {
        const file = url.split(/[?#]/)[0].split("/").pop();
        return file.replace(/\.[^.]+$/, "") || "Font";
    }
}
