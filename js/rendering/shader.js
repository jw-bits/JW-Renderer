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

        this.#bindUniformBlocks();
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

    getUniform(uniformName) { return WGLV.context.getUniformLocation(this.#programId, uniformName); } // null if not found

    /*
        Names of the uniforms the linked program actually uses (the compiler drops unused ones),
        outside any uniform block: block members come from a UniformBuffer, not a Material.
    */
    getActiveUniformNames()
    {
        const gl = WGLV.context;
        const count = gl.getProgramParameter(this.#programId, gl.ACTIVE_UNIFORMS) ?? 0;
        let names = [];

        if (count === 0)
            return names;

        const indices = Array.from({ length: count }, (_, i) => i);
        const blockIndices = gl.getActiveUniforms(this.#programId, indices, gl.UNIFORM_BLOCK_INDEX);

        for (let i = 0; i < count; ++i)
        {
            if (blockIndices[i] !== -1)
                continue; // In a uniform block

            const info = gl.getActiveUniform(this.#programId, i);

            if (info !== null)
                names.push(info.name);
        }

        return names;
    }

    // True if the program declares (and uses) the uniform block blockName, e.g. RenderUniformBlocks.kFrame
    hasUniformBlock(blockName)
    {
        return (WGLV.context.getUniformBlockIndex(this.#programId, blockName) !== WGLV.context.INVALID_INDEX);
    }

    bind()
    {
        WGLV.context.useProgram(this.#programId);
    }

    // *** Internal Methods ***

    /*
        Points each RenderUniformBlocks block the program declares at its binding point. Only
        the program's own setup: the block's UniformBuffer is put at that binding point by its
        owner (see RenderUniformBlocks.createBuffers()), before or after this shader loads.
    */
    #bindUniformBlocks()
    {
        const gl = WGLV.context;

        for (const [name, block] of RenderUniformBlocks.allBlocks)
        {
            const index = gl.getUniformBlockIndex(this.#programId, name);

            if (index === gl.INVALID_INDEX)
                continue; // Not declared (or not used) by this program

            gl.uniformBlockBinding(this.#programId, index, block.binding);
        }
    }

    #logCompilerFailure(shaderId, shaderSource)
    {
        const errMsg = WGLV.context.getShaderInfoLog(shaderId);
            
        console.log(`Shader source: ${shaderSource}`);
        console.error(`Shader failed to compile with error: ${errMsg}`);
    }

}