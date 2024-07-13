class Shader
{
    #vsId;
    #fsId;
    #programId;

    constructor()
    {
        this.#vsId = 0;
        this.#fsId = 0;
        this.#programId = 0;
    }

    load(vsSource, fsSource)
    {
        this.#vsId = WGL.context.createShader(WGL.context.VERTEX_SHADER);
        this.#fsId = WGL.context.createShader(WGL.context.FRAGMENT_SHADER);

        // Compile vertex shader
        WGL.context.shaderSource(this.#vsId, vsSource);
        WGL.context.compileShader(this.#vsId);

        let didCompile = WGL.context.getShaderParameter(this.#vsId, WGL.context.COMPILE_STATUS);

        if (didCompile === false)
        {
            this.#logCompilerFailure(this.#vsId, vsSource);
            this.unload();
                return false;
        }

        // Compile fragment shader
        WGL.context.shaderSource(this.#fsId, fsSource);
        WGL.context.compileShader(this.#fsId);

        didCompile = WGL.context.getShaderParameter(this.#fsId, WGL.context.COMPILE_STATUS);

        if (didCompile === false)
        {
            this.#logCompilerFailure(this.#fsId, fsSource);
            this.unload();
                return false;
        }

        
        this.#programId = WGL.context.createProgram();

        // Compile program
        WGL.context.attachShader(this.#programId, this.#vsId);
        WGL.context.attachShader(this.#programId, this.#fsId);
        WGL.context.linkProgram(this.#programId);

        let didLink = WGL.context.getProgramParameter(this.#programId, WGL.context.LINK_STATUS);

        if (didLink === false)
        {
            const errMsg = WGL.context.getProgramInfoLog(this.#programId);

            console.error(`Link failed: ${errMsg}`);
            this.unload();
                return false;
        }

        return true; // Shader made

    }

    unload()
    {
        if (this.#fsId !== 0)
        {
            if (this.#programId !== 0)
                WGL.context.detachShader(this.#programId, this.#fsId);
            
            WGL.context.deleteShader(this.#fsId);
        }

        if (this.#vsId !== 0)
        {
            if (this.#programId !== 0)
                WGL.context.detachShader(this.#programId, this.#vsId);
            
            WGL.context.deleteShader(this.#vsId);
        }

        if (this.#programId !== 0)
            WGL.context.deleteProgram(this.#programId);
        
        this.#vsId = 0;
        this.#fsId = 0;
        this.#programId = 0;
    }

    getAttrib(attribName) { return WGL.context.getAttribLocation(this.#programId, attribName); } // -1 if not found
    getUniform(uniformName) { return WGL.context.getUniformLocation(this.#programId, uniformName); } // null if not found

    bind()
    {
        WGL.context.useProgram(this.#programId);
    }

    // *** Internal Methods ***

    #logCompilerFailure(shaderId, shaderSource)
    {
        const errMsg = WGL.context.getShaderInfoLog(shaderId);
            
        console.log(`Shader source: ${shaderSource}`);
        console.error(`Shader failed to compile with error: ${errMsg}`);
    }

}