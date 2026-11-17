class Texture
{
    #texId;
    #width;
    #height;    
    #url;
    #isLoaded;

    // Options
    #useClamp;
    #flipY;

    // Checkerboard RGB
    static #pixels = new Uint8Array([255, 0, 255, 255, 255, 255, 255, 255,
                                    255, 255, 255, 255, 255, 0, 255, 255]);

    constructor(_useClamp = true, _flipY = true)
    {
        
        this.#useClamp = _useClamp;
        this.#flipY = _flipY;
        this.#url = null;
        this.#isLoaded = false;

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
        img.crossOrigin = "annoymous";
        img.decoding = "async";

        img.onload = () => {
            this.#width = img.naturalWidth;
            this.#height = img.naturalHeight;

            const colorFormat = WGL.context.RGBA;

            WGL.context.bindTexture(WGL.context.TEXTURE_2D, this.#texId);
            WGL.context.pixelStorei(WGL.context.UNPACK_FLIP_Y_WEBGL, this.#flipY);
            WGL.context.texImage2D(WGL.context.TEXTURE_2D, 0, colorFormat, colorFormat, WGL.context.UNSIGNED_BYTE, img);

            if (MathUtil.isPowerOfTwo(this.#width) && MathUtil.isPowerOfTwo(this.#height))
            {
                WGL.context.generateMipmap(WGL.context.TEXTURE_2D);
                WGL.context.texParameteri(WGL.context.TEXTURE_2D, WGL.context.TEXTURE_MAG_FILTER, WGL.context.LINEAR);
                WGL.context.texParameteri(WGL.context.TEXTURE_2D, WGL.context.TEXTURE_MIN_FILTER, WGL.context.LINEAR_MIPMAP_LINEAR);
            }
            else
            {
                WGL.context.texParameteri(WGL.context.TEXTURE_2D, WGL.context.TEXTURE_MAG_FILTER, WGL.context.LINEAR);
                WGL.context.texParameteri(WGL.context.TEXTURE_2D, WGL.context.TEXTURE_MIN_FILTER, WGL.context.LINEAR);
            }

            WGL.context.bindTexture(WGL.context.TEXTURE_2D, null);
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

        const colorFormat = WGL.context.RGBA;

        WGL.context.bindTexture(WGL.context.TEXTURE_2D, this.#texId);
        WGL.context.pixelStorei(WGL.context.UNPACK_FLIP_Y_WEBGL, this.#flipY);
        WGL.context.texImage2D(WGL.context.TEXTURE_2D, 0, colorFormat, width, height, 0, colorFormat, WGL.context.UNSIGNED_BYTE, rgbaPixels);
        WGL.context.texParameteri(WGL.context.TEXTURE_2D, WGL.context.TEXTURE_MAG_FILTER, WGL.context.NEAREST);
        WGL.context.texParameteri(WGL.context.TEXTURE_2D, WGL.context.TEXTURE_MIN_FILTER, WGL.context.NEAREST);
        WGL.context.bindTexture(WGL.context.TEXTURE_2D, null);

        this.#width = width;
        this.#height = height;
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

        this.#uploadCanvas(canvas);
        this.#isLoaded = true;
            return true;
    }

    // Replaces the pixels of a texture loaded with loadCanvas(). The size may change.
    updateCanvas(canvas)
    {
        if (this.#isLoaded === false || canvas == null)
            return false;

        this.#uploadCanvas(canvas);
            return true;
    }

    isLoaded() { return this.#isLoaded; }
    getWidth() { return this.#width; }
    getHeight() { return this.#height; }
    getURL() { return this.#url; }

    bind() { WGL.context.bindTexture(WGL.context.TEXTURE_2D, this.#texId); }

    unload()
    {
        if (this.#texId === 0)
            return; // Alredy unloaded

        WGL.context.deleteTexture(this.#texId);

        this.#texId = 0;
        this.#url = null;
        this.#width = 0;
        this.#height = 0;
        this.#isLoaded = false;
    }

    // *** Internal Methods ***

    // No mipmaps: canvas textures are usually redrawn at the size they're shown
    #uploadCanvas(canvas)
    {
        const gl = WGL.context;

        gl.bindTexture(gl.TEXTURE_2D, this.#texId);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, this.#flipY);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.bindTexture(gl.TEXTURE_2D, null);

        this.#width = canvas.width;
        this.#height = canvas.height;
    }

    #initTexture()
    {
        const border = 0;
        const colorFormat = WGL.context.RGBA;
        const uvWrap = (this.#useClamp === true) ? WGL.context.CLAMP_TO_EDGE : WGL.context.REPEAT;
        
        this.#texId = WGL.context.createTexture();
        this.#width = 2;
        this.#height = 2;

        WGL.context.bindTexture(WGL.context.TEXTURE_2D, this.#texId);
        WGL.context.texImage2D(WGL.context.TEXTURE_2D, 0, colorFormat, this.#width, this.#height, border, colorFormat, WGL.context.UNSIGNED_BYTE, Texture.#pixels);
        WGL.context.texParameteri(WGL.context.TEXTURE_2D, WGL.context.TEXTURE_WRAP_S, uvWrap);
        WGL.context.texParameteri(WGL.context.TEXTURE_2D, WGL.context.TEXTURE_WRAP_T, uvWrap);

        WGL.context.bindTexture(WGL.context.TEXTURE_2D, null);
    }
}