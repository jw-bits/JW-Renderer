/*
    Texture - The pixels of a 2D texture (and their mipmaps).

    How the texture is filtered and wrapped is sampler state, which lives in
    the Material (see Sampler). The Texture only keeps safe internal settings
    (LINEAR, CLAMP_TO_EDGE) for the rare case it's bound without a sampler.

    Options, set when it's created:
        _flipY       Flip rows on upload, so V runs up (matches the 2D models)
        _makeMipmaps Build mipmaps on every upload, so a Sampler can use a *_MIPMAP_* filter
        _isView      For SubTexture only: no GL texture of its own (it overrides every method)

    A TextureAtlas (texture_atlas.js) holds one Texture and names parts of it
    as SubTextures, which are Textures too, so anything that takes a Texture
    takes one of them.
*/
class Texture
{
    #texId;
    #width;
    #height;
    #url;
    #isLoaded;

    // Options
    #flipY;
    #hasMipmaps;

    // Checkerboard RGB
    static #pixels = new Uint8Array([255, 0, 255, 255, 255, 255, 255, 255,
                                    255, 255, 255, 255, 255, 0, 255, 255]);

    constructor(_flipY = true, _makeMipmaps = true, _isView = false)
    {
        this.#flipY = _flipY;
        this.#hasMipmaps = _makeMipmaps;
        this.#url = null;
        this.#isLoaded = false;
        this.#texId = 0;
        this.#width = 0;
        this.#height = 0;

        if (_isView === false)
            this.#initTexture();
    }

    // Loads an image. onLoadFailCB is called if the image can't be loaded (the texture is unloaded first).
    load(imageUrl, onLoadSuccessCB = null, onLoadFailCB = null)
    {
        if (imageUrl == null)
            return false; // Nothing to load

        if (this.#isLoaded === true)
            return false; // Already loaded... free first

        if (this.#texId === 0)
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
        if (this.#isLoaded === true)
            return false; // Already loaded... free first

        if (rgbaPixels == null || rgbaPixels.length !== width * height * 4)
            return false;

        if (this.#texId === 0)
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
        if (this.#isLoaded === true)
            return false; // Already loaded... free first, or use updateCanvas()

        if (canvas == null)
            return false;

        if (this.#texId === 0)
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
    getWidth() { return this.#width; }
    getHeight() { return this.#height; }
    getURL() { return this.#url; }

    bind() { WGLV.context.bindTexture(WGLV.context.TEXTURE_2D, this.#texId); }

    unload()
    {
        if (this.#texId === 0)
            return; // Alredy unloaded

        WGLV.context.deleteTexture(this.#texId);

        this.#texId = 0;
        this.#url = null;
        this.#width = 0;
        this.#height = 0;
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

        this.#width = width;
        this.#height = height;
    }

    #initTexture()
    {
        const gl = WGLV.context;

        this.#texId = gl.createTexture();
        this.#width = 2;
        this.#height = 2;

        gl.bindTexture(gl.TEXTURE_2D, this.#texId);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.#width, this.#height, 0, gl.RGBA, gl.UNSIGNED_BYTE, Texture.#pixels);

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
