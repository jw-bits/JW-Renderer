"use strict";

class RenderTarget {
    #fbo;
    #texture;
    #depthStencil;
    #width;
    #height;

    constructor() {
        this.#fbo = null;
        this.#texture = null;
        this.#depthStencil = null;
        this.#width = 0;
        this.#height = 0;
    }

    /**
     * Creates the RenderTarget resources.
     * @param {number} width - Width of the target.
     * @param {number} height - Height of the target.
     * @param {object} options - Configuration for depth, stencil, and texture parameters.
     */
    load(width, height, options = {}) {
        const gl = WGL.context;
        this.#width = width;
        this.#height = height;

        // Texture parameter configuration
        const magFilter = options.magFilter || gl.LINEAR;
        const minFilter = options.minFilter || gl.LINEAR;
        const wrapS = options.wrapS || gl.CLAMP_TO_EDGE;
        const wrapT = options.wrapT || gl.CLAMP_TO_EDGE;

        // 1. Create the Color Attachment Texture
        this.#texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.#texture);
        
        // WebGL 2.0: Using sized internal format RGBA8
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, magFilter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapT);

        // 2. Create the Framebuffer
        this.#fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.#fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.#texture, 0);

        // 3. Optional Depth/Stencil Buffer
        const useDepth = options.depth !== undefined ? options.depth : true;
        const useStencil = options.stencil !== undefined ? options.stencil : false;

        if (useDepth || useStencil) {
            this.#depthStencil = gl.createRenderbuffer();
            gl.bindRenderbuffer(gl.RENDERBUFFER, this.#depthStencil);

            let internalFormat = gl.DEPTH_COMPONENT24;
            let attachment = gl.DEPTH_ATTACHMENT;

            if (useDepth && useStencil) {
                internalFormat = gl.DEPTH24_STENCIL8;
                attachment = gl.DEPTH_STENCIL_ATTACHMENT;
            } else if (useStencil) {
                internalFormat = gl.STENCIL_INDEX8;
                attachment = gl.STENCIL_ATTACHMENT;
            }

            gl.renderbufferStorage(gl.RENDERBUFFER, internalFormat, width, height);
            gl.framebufferRenderbuffer(gl.FRAMEBUFFER, attachment, gl.RENDERBUFFER, this.#depthStencil);
        }

        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE) {
            console.error("RenderTarget error: Framebuffer is incomplete: " + status);
            this.unload();
            return false;
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return true;
    }

    bind() {
        WGL.context.bindFramebuffer(WGL.context.FRAMEBUFFER, this.#fbo);
        WGL.context.viewport(0, 0, this.#width, this.#height);
    }

    unbind() {
        WGL.context.bindFramebuffer(WGL.context.FRAMEBUFFER, null);
        WGL.resizeToWindow();
    }

    bindAsTexture(unit = 0) {
        WGL.context.activeTexture(WGL.context.TEXTURE0 + unit);
        WGL.context.bindTexture(WGL.context.TEXTURE_2D, this.#texture);
    }

    unload() {
        const gl = WGL.context;
        if (this.#fbo) gl.deleteFramebuffer(this.#fbo);
        if (this.#texture) gl.deleteTexture(this.#texture);
        if (this.#depthStencil) gl.deleteRenderbuffer(this.#depthStencil);
        this.#fbo = null;
        this.#texture = null;
        this.#depthStencil = null;
    }
}
