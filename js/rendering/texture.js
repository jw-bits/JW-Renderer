/*
    BaseTexture - What every texture can be asked, whether it holds its own
    pixels (Texture) or names part of an atlas (SubTexture, see
    texture_atlas.js). Anything that draws with a texture takes a BaseTexture.

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

    A TextureAtlas (texture_atlas.js) holds one Texture and names parts of it
    as SubTextures. Both are BaseTextures, so anything that takes one takes
    the other.
*/
class Texture extends BaseTexture
{
    #texId;
    #url;
    #isLoaded;

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
        this.#texId = 0;
    }

    // Loads an image. onLoadFailCB is called if the image can't be loaded (the texture is unloaded first).
    load(imageUrl, onLoadSuccessCB = null, onLoadFailCB = null)
    {
        if (imageUrl == null)
            return false; // Nothing to load

        if (this.#texId !== 0)
            return false; // Already loaded or loading... free first

        this.#initTexture();
        this.#url = imageUrl;

        const img = new Image();
        img.crossOrigin = "anonymous";
        img.decoding = "async";

        img.onload = () => {
            this.#upload(img, img.naturalWidth, img.naturalHeight);
            this.#isLoaded = true;

            if (onLoadSuccessCB !== null)
                onLoadSuccessCB();
        };

        img.onerror = () => {
            console.error("Can't load texture: " + this.#url);
            this.unload();

            if (onLoadFailCB !== null)
                onLoadFailCB();
        };

        img.src = imageUrl; // Load it
            return true; // Loading...
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
    }

    // *** Internal Methods ***

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
