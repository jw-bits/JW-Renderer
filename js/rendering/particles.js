"use strict";

/*
    Particles2D - Textured particles in design units, drawn as instanced quads
    and simulated on the GPU (see Particles2DShaderSource).

    emit() writes one particle into the next slot of a ring buffer; nothing
    about it changes afterwards. Each frame the shader works out every
    particle's position from its start, velocity, the gravity and the time
    since it was emitted, and fades it out over its life. So update() only
    advances the clock, and render() is one draw call with no per-particle
    work on the CPU. Only newly emitted particles are uploaded.

    Usage:
        let sparks = new Particles2D();
        sparks.load(256, texture);         // Up to 256 alive at once
        sparks.setGravity(0, -600);        // Design units per second squared
        sparks.setEndScale(0.3);           // Shrink to 30% over each life

        sparks.emit(x, y, vx, vy, 0.6, 12, color); // Position, velocity, life (s), size, color

        // Each frame
        sparks.update(dt);
        batcher.submitDrawable(sparks, layer); // Or sparks.render()

    When the ring is full, a new particle replaces the oldest one.

    Frames: setFrames(rows, cols, firstFrame, lastFrame) splits the texture
    into a rows x cols grid, numbered row by row from the top-left (like
    Sprite), and each particle steps through firstFrame - lastFrame evenly
    over its own life. Without it every particle draws the whole texture.

        smoke.setFrames(1, 4, 0, 2); // A 1 x 4 strip; frames 0, 1, 2, a third of each life apiece
*/
class Particles2D
{
    static #kShader = null;
    static #kFloatsPerParticle = 11; // Motion (4), start time + life + size (3), color (4)
    static #kRebaseTime = 600.0;     // Seconds; the clock restarts after this once nothing's alive

    // Scratch values for uploading uniforms in render()
    static #kRes = new Vector2();
    static #kGravityScaleTime = new Vector4(); // u_vec0: (gravityX, gravityY, endScale, time)
    static #kUVOffset = new Vector2();
    static #kUVTile = new Vector2();

    #material;
    #mesh;        // InstancedQuadMesh
    #data;        // CPU copy of the instance buffer

    #capacity;
    #next;        // Next slot to write
    #dirtyMin;    // Slots written since the last upload
    #dirtyMax;

    #time;        // Seconds since the clock (re)started
    #aliveUntil;  // When the last particle emitted so far dies

    #gravity;
    #endScale;
    #frames;      // Vector4 (cols, rows, firstFrame, frameCount), uploaded as u_vec1

    #isLoaded;

    constructor()
    {
        this.#material = null;
        this.#mesh = new InstancedQuadMesh();
        this.#data = null;

        this.#capacity = 0;
        this.#next = 0;
        this.#dirtyMin = Infinity;
        this.#dirtyMax = -1;

        this.#time = 0.0;
        this.#aliveUntil = 0.0;

        this.#gravity = new Vector2();
        this.#endScale = 1.0;
        this.#frames = new Vector4(1, 1, 0, 1); // One frame: the whole texture

        this.#isLoaded = false;
    }

    /*
        maxParticles is how many can be alive at once. The texture (or SubTexture) is
        drawn on each particle; sampler is optional (see Material). Returns false on failure.
    */
    load(maxParticles, texture, sampler = null)
    {
        if (this.#isLoaded === true)
            return false; // Unload first

        if (Number.isInteger(maxParticles) === false || maxParticles <= 0)
        {
            console.error("Particles2D.load() needs a particle count > 0");
                return false;
        }

        if ((texture instanceof BaseTexture) === false || texture.isLoaded() === false)
        {
            console.error("Particles2D.load() needs a loaded Texture");
                return false;
        }

        const shader = Particles2D.#getShader();

        if (shader === null)
            return false;

        let material = new Material();

        if (material.load(shader, [texture], (sampler !== null) ? [sampler] : null) === false)
        {
            console.error("Particles2D couldn't create its material");
                return false;
        }

        const stride = Particles2D.#kFloatsPerParticle;

        // Unit quad centered on the particle, shared by every instance, plus the interleaved per-particle values
        const attribs = [
            [Particles2DShaderSource.kMotionLocation, 4, 0],
            [Particles2DShaderSource.kLifeLocation, 3, 4],
            [Particles2DShaderSource.kColorLocation, 4, 7]
        ];

        if (this.#mesh.load(new Float32Array([-0.5, -0.5,  0.5, -0.5,  0.5, 0.5,  -0.5, 0.5]), stride, attribs) === false)
            return false;

        this.#material = material;
        this.#capacity = maxParticles;
        this.#data = new Float32Array(maxParticles * stride); // All zero: life 0, so every slot starts dead
        this.#mesh.setInstanceData(this.#data);               // Allocated once; then only changed slots are uploaded

        this.#next = 0;
        this.#dirtyMin = Infinity;
        this.#dirtyMax = -1;
        this.#time = 0.0;
        this.#aliveUntil = 0.0;
        this.#isLoaded = true;
            return true;
    }

    // Design units per second squared, e.g. (0, -600) pulls particles down
    setGravity(gx, gy) { this.#gravity.set(gx, gy); }
    getGravity() { return this.#gravity; }

    // How big a particle is at the end of its life, as a fraction of its starting size (1 keeps the size)
    setEndScale(scale) { this.#endScale = scale; }
    getEndScale() { return this.#endScale; }

    /*
        Splits the texture into a rows x cols grid of frames, numbered row by row
        from the top-left; each particle steps through firstFrame - lastFrame
        (inclusive) evenly over its life. Returns false (changing nothing) if
        the grid or range isn't valid.
    */
    setFrames(rows, cols, firstFrame = 0, lastFrame = (rows * cols) - 1)
    {
        if (Number.isInteger(rows) === false || Number.isInteger(cols) === false || rows < 1 || cols < 1)
        {
            console.error("Particles2D.setFrames() needs at least 1 row and 1 column");
                return false;
        }

        if (Number.isInteger(firstFrame) === false || Number.isInteger(lastFrame) === false ||
            firstFrame < 0 || lastFrame < firstFrame || lastFrame >= rows * cols)
        {
            console.error(`Particles2D.setFrames(): frames ${firstFrame} - ${lastFrame} aren't a forward run in a ${rows} x ${cols} grid`);
                return false;
        }

        this.#frames.set(cols, rows, firstFrame, (lastFrame - firstFrame) + 1);
            return true;
    }

    // Back to every particle drawing the whole texture
    clearFrames() { this.#frames.set(1, 1, 0, 1); }

    getFrameRows() { return this.#frames.y; }
    getFrameCols() { return this.#frames.x; }
    getFirstFrame() { return this.#frames.z; }
    getLastFrame() { return this.#frames.z + this.#frames.w - 1; }

    /*
        Starts one particle at (x, y), moving at (vx, vy) design units per second,
        living for life seconds, size design units across, tinted by color (its alpha
        fades to 0 over the life). Returns false if not loaded or life <= 0.
    */
    emit(x, y, vx, vy, life, size, color)
    {
        if (this.#isLoaded === false || life <= 0.0)
            return false;

        const slot = this.#next;
        this.#next = (slot + 1) % this.#capacity;

        let d = this.#data;
        let o = slot * Particles2D.#kFloatsPerParticle;

        d[o++] = x;
        d[o++] = y;
        d[o++] = vx;
        d[o++] = vy;
        d[o++] = this.#time;
        d[o++] = life;
        d[o++] = size;
        d[o++] = color.x;
        d[o++] = color.y;
        d[o++] = color.z;
        d[o++] = color.w;

        this.#markDirty(slot, slot);
        this.#aliveUntil = Math.max(this.#aliveUntil, this.#time + life);
            return true;
    }

    // Advances the clock; the GPU does the rest
    update(dt)
    {
        if (this.#isLoaded === false)
            return;

        this.#time += dt;

        // Keep the clock small (float precision on the GPU): restart it once nothing's alive
        if (this.#time > Particles2D.#kRebaseTime && this.#time >= this.#aliveUntil)
            this.clear();
    }

    // True while any emitted particle is still alive
    hasLiveParticles() { return (this.#isLoaded === true && this.#time < this.#aliveUntil); }

    getCapacity() { return this.#capacity; }
    isLoaded() { return this.#isLoaded; }

    // Kills every particle and restarts the clock
    clear()
    {
        if (this.#isLoaded === false)
            return;

        this.#data.fill(0.0); // Life 0: dead
        this.#markDirty(0, this.#capacity - 1);
        this.#next = 0;
        this.#time = 0.0;
        this.#aliveUntil = 0.0;
    }

    // One instanced draw call; skipped when nothing's alive
    render()
    {
        if (this.hasLiveParticles() === false)
            return;

        this.#upload();

        const m = this.#material;
        Particles2D.#kRes.set(WGLV.getWidth(), WGLV.getHeight());
        Particles2D.#kGravityScaleTime.set(this.#gravity.x, this.#gravity.y, this.#endScale, this.#time);

        m.bind(); // Shader, texture, sampler
        m.setUniform(RenderUniforms.kResolution, Particles2D.#kRes);
        m.setUniform(RenderUniforms.kVector0, Particles2D.#kGravityScaleTime);
        m.setUniform(RenderUniforms.kVector1, this.#frames); // Every render: the shader is shared by every Particles2D

        // The whole texture, or a SubTexture's part of its atlas
        const r = m.getTexture(0).getUVRect();
        Particles2D.#kUVOffset.set(r.getX(), r.getY());
        Particles2D.#kUVTile.set(r.getWidth(), r.getHeight());

        m.setUniform(RenderUniforms.kUVOffset, Particles2D.#kUVOffset);
        m.setUniform(RenderUniforms.kUVTile, Particles2D.#kUVTile);

        this.#mesh.render(this.#capacity);
    }

    // Frees the GPU objects; load() can be called again afterwards. The texture belongs to the caller.
    unload()
    {
        this.#mesh.unload();

        if (this.#material !== null)
            this.#material.unload(); // Leaves the shared shader and the texture alone

        this.#material = null;
        this.#data = null;
        this.#capacity = 0;
        this.#isLoaded = false;
    }

    // *** Internal Methods ***

    #markDirty(first, last)
    {
        this.#dirtyMin = Math.min(this.#dirtyMin, first);
        this.#dirtyMax = Math.max(this.#dirtyMax, last);
    }

    // Sends the slots written since the last upload, as one range
    #upload()
    {
        if (this.#dirtyMax < this.#dirtyMin)
            return;

        const stride = Particles2D.#kFloatsPerParticle;
        const first = this.#dirtyMin * stride;
        const count = (this.#dirtyMax - this.#dirtyMin + 1) * stride;

        this.#mesh.updateInstanceData(this.#data, first, count);

        this.#dirtyMin = Infinity;
        this.#dirtyMax = -1;
    }

    static #getShader()
    {
        if (Particles2D.#kShader === null)
        {
            let shader = new Shader();

            if (shader.load(Particles2DShaderSource.VS, Particles2DShaderSource.FS) === false)
            {
                console.error("Particles2D couldn't build its shader");
                    return null;
            }

            Particles2D.#kShader = shader;
        }

        return Particles2D.#kShader;
    }
}
