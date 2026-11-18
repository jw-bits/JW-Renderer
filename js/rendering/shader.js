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
        this.#vsId = WGLV.context.createShader(WGLV.context.VERTEX_SHADER);
        this.#fsId = WGLV.context.createShader(WGLV.context.FRAGMENT_SHADER);

        // Compile vertex shader
        WGLV.context.shaderSource(this.#vsId, vsSource);
        WGLV.context.compileShader(this.#vsId);

        let didCompile = WGLV.context.getShaderParameter(this.#vsId, WGLV.context.COMPILE_STATUS);

        if (didCompile === false)
        {
            this.#logCompilerFailure(this.#vsId, vsSource);
            this.unload();
                return false;
        }

        // Compile fragment shader
        WGLV.context.shaderSource(this.#fsId, fsSource);
        WGLV.context.compileShader(this.#fsId);

        didCompile = WGLV.context.getShaderParameter(this.#fsId, WGLV.context.COMPILE_STATUS);

        if (didCompile === false)
        {
            this.#logCompilerFailure(this.#fsId, fsSource);
            this.unload();
                return false;
        }

        
        this.#programId = WGLV.context.createProgram();

        // Compile program
        WGLV.context.attachShader(this.#programId, this.#vsId);
        WGLV.context.attachShader(this.#programId, this.#fsId);
        WGLV.context.linkProgram(this.#programId);

        let didLink = WGLV.context.getProgramParameter(this.#programId, WGLV.context.LINK_STATUS);

        if (didLink === false)
        {
            const errMsg = WGLV.context.getProgramInfoLog(this.#programId);

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
                WGLV.context.detachShader(this.#programId, this.#fsId);
            
            WGLV.context.deleteShader(this.#fsId);
        }

        if (this.#vsId !== 0)
        {
            if (this.#programId !== 0)
                WGLV.context.detachShader(this.#programId, this.#vsId);
            
            WGLV.context.deleteShader(this.#vsId);
        }

        if (this.#programId !== 0)
            WGLV.context.deleteProgram(this.#programId);
        
        this.#vsId = 0;
        this.#fsId = 0;
        this.#programId = 0;
    }

    getAttrib(attribName) { return WGLV.context.getAttribLocation(this.#programId, attribName); } // -1 if not found
    getUniform(uniformName) { return WGLV.context.getUniformLocation(this.#programId, uniformName); } // null if not found

    bind()
    {
        WGLV.context.useProgram(this.#programId);
    }

    // *** Internal Methods ***

    #logCompilerFailure(shaderId, shaderSource)
    {
        const errMsg = WGLV.context.getShaderInfoLog(shaderId);
            
        console.log(`Shader source: ${shaderSource}`);
        console.error(`Shader failed to compile with error: ${errMsg}`);
    }

}