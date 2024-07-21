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

    load(imageUrl, onLoadSuccessCB = null)
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

            if (Util.isPowerOfTwo(this.#width) && Util.isPowerOfTwo(this.#height))
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
        };

        img.src = imageUrl; // Load it
            return true; // Loading...
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