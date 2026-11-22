"use strict";

/*
    SpriteSequence - A named run of frames, each a UVRect of the sprite's
    texture, played over a duration.

    A sequence is only data, so one can be shared by any number of Sprites
    (each keeps its own place in it). Build the frames as UVRects (see
    UVRect.pixelsToUVRect()), or let Sprite.createSequence() /
    createSequenceInRect() do it.

        name      Key for Sprite.play()
        frames    Array of UVRects, in play order
        duration  Seconds to play every frame once (kPingPong takes about twice this per cycle)
        playMode  SpritePlayMode

    Don't change frames while a Sprite is playing the sequence.
*/
class SpriteSequence
{
    constructor(name, frames, duration, playMode = SpritePlayMode.kLoop)
    {
        this.name = name;
        this.frames = frames;
        this.duration = duration;
        this.playMode = playMode;
    }

    // True if the sequence can be played: a name, at least one frame and a duration above 0
    isValid()
    {
        return (typeof this.name === "string" && this.name.length > 0 &&
                Array.isArray(this.frames) && this.frames.length > 0 &&
                Number.isFinite(this.duration) && this.duration > 0.0);
    }

    getFrameCount() { return this.frames.length; }
    getFrame(index) { return this.frames[index] ?? null; }

    // Seconds each frame is shown
    getFrameDuration() { return this.duration / this.frames.length; }

    isOneShot() { return (this.playMode === SpritePlayMode.kOnce || this.playMode === SpritePlayMode.kPingPongOnce); }
    isPingPong() { return (this.playMode === SpritePlayMode.kPingPong || this.playMode === SpritePlayMode.kPingPongOnce); }
}

/*
    Sprite - A Model2D that draws one frame of an atlas texture at a time and
    animates through sequences of frames.

    A frame is a UVRect of the texture: 0..1 with V up and (x, y) its
    bottom-left corner (UVRect.pixelsToUVRect() converts a rect in pixels).
    A sequence (SpriteSequence) is a named run of frames with a duration and
    play mode. Sequences come two ways:
        createSequence()        A start and end frame on a rows x cols grid over the whole
                                atlas (set by load() or setGrid()); a run can span rows.
        createSequenceInRect()  A rect of the atlas holding one sequence, split into its
                                own rows x cols grid.
    addSequence() takes a ready-made SpriteSequence, which can be shared by many Sprites.

    Grids: a rect split into rows x cols equal frames, numbered row by row
    from the top-left, as they appear in the image:

        0  1  2  3
        4  5  6  7

    Frames sit edge to edge, so filtering can blend in a sliver of the next
    frame. For pixel art use a NEAREST Sampler; otherwise leave a pixel or two
    of padding between frames in the atlas.

    Playback: play() starts a sequence (optionally reversed); update(dt) advances it.
    Speed scales time (2 is double speed, 0 freezes it). The event callback hears when
    a one-shot sequence completes or a looping one starts another cycle.

    Drawing: render() uses Sprite's own shader. Sprites also batch: MaterialBatcher
    draws them with its instanced shader, grouped by texture, so Sprites and Rect2Ds
    drawing the same atlas share one draw call. submit() captures the current frame.

    Usage:
        let s = new Sprite();
        s.load(atlas, 64, 64, 4, 8);   // 64 x 64 design units; a 4 x 8 grid over the atlas
        s.createSequence("walk", 1, 0, 1, 7, 0.8);                      // Row 1, looping
        s.createSequence("die", 3, 0, 3, 5, 0.6, SpritePlayMode.kOnce);

        // A 1 x 4 run inside a 256 x 64 pixel strip, measured from the image's top-left
        const strip = UVRect.pixelsToUVRect(0, 128, 256, 64, atlas.getWidth(), atlas.getHeight());
        s.createSequenceInRect("jump", strip, 1, 4, 0.4);

        s.setEventCallback((sprite, event, name) => { if (name === "die") remove(sprite); });
        s.play("walk");

        // Each frame
        s.update(dt);
        s.setPos(x, y, Alignment.kMiddleCenter);
        batcher.submit(s, 2);            // Or s.render()

    Sprites load from a Texture (the Sprite makes its own Material) or a Material
    built on Sprite.getDefaultShader(), e.g. one shared from MaterialManager.

    The Texture can be a SubTexture of a TextureAtlas: frames (and the grid)
    are then within the SubTexture, as if it were the whole texture.
*/
class Sprite extends Model2D
{
    static #kShader = null;               // Default shader, also needed by Materials given to load()
    static #kUVScratch = new Vector4();   // For uploading u_vec1

    #uvRect;         // The frame drawn now, within the texture (or SubTexture)
    #atlasUVRect;    // #uvRect mapped into the atlas, when the texture is a SubTexture (see getUVRect())

    #gridRows;       // Grid over the whole atlas, for createSequence() and showFrame() without a sequence
    #gridCols;

    #sequences;      // Name -> SpriteSequence
    #sequence;       // Playing or paused, or null
    #time;           // Seconds into the current cycle
    #frame;          // Index into #sequence.frames (or the grid) of the frame drawn now
    #isPlaying;
    #isFinished;     // A one-shot sequence completed; resume() won't restart it
    #isReversed;
    #speed;
    #eventCallback;  // (sprite, SpriteEvent, sequenceName) or null

    constructor()
    {
        super();

        this.#uvRect = new UVRect();
        this.#atlasUVRect = new UVRect();
        this.#gridRows = 1;
        this.#gridCols = 1;
        this.#sequences = new Map();
        this.#eventCallback = null;
        this.#speed = 1.0;
        this.#resetPlayback();
    }

    /*
        _source is a loaded Texture, or a loaded Material built on Sprite.getDefaultShader().
        rows x cols is the grid over the whole atlas (1 x 1: the whole texture is one frame).
        _width / _height are the size in design units; by default one grid frame's size in
        texture pixels. Shows grid frame 0. Returns false on failure.
    */
    load(_source, _width, _height, rows = 1, cols = 1)
    {
        if (this.isLoaded() === true)
            return false; // Unload first

        if (Sprite.#isValidGrid(rows, cols, "load") === false)
            return false;

        const shader = Sprite.getDefaultShader();
        const material = this._resolveMaterial(_source, shader, "Sprite");

        if (material === null)
            return false;

        if (material.getShader() !== shader)
        {
            console.error("Sprite.load(): a Material must be built on Sprite.getDefaultShader()");
                return false;
        }

        const tex = material.getTexture(0);

        if (tex === null)
        {
            console.error("Sprite.load(): the Material has no texture");
                return false;
        }

        const w = _width ?? (tex.getWidth() / cols);
        const h = _height ?? (tex.getHeight() / rows);
        let mesh = Shapes.makeQuad(0, 0, 0, w, h, Alignment.kBottomLeft);

        if (mesh == null)
            return false;

        mesh.bindAttribs();
        this._setSize(w, h);
        this._setMaterial(material);
        this._setMesh(mesh);
        this._setLoaded(true);

        this.#gridRows = rows;
        this.#gridCols = cols;
        this.#showGridFrame(0);
            return true;
    }

    // The grid over the whole atlas, for createSequence() and showFrame() without a sequence
    setGrid(rows, cols)
    {
        if (Sprite.#isValidGrid(rows, cols, "setGrid") === false)
            return false;

        this.#gridRows = rows;
        this.#gridCols = cols;
            return true;
    }

    getGridRows() { return this.#gridRows; }
    getGridCols() { return this.#gridCols; }

    // *** Sequences ***

    /*
        A sequence from (startRow, startCol) to (endRow, endCol), inclusive, of the
        whole-atlas grid, reading row by row. duration is in seconds. Returns false
        if the range or duration isn't valid, or the name is taken.
    */
    createSequence(name, startRow, startCol, endRow, endCol, duration, playMode = SpritePlayMode.kLoop)
    {
        const frames = Sprite.#gridRangeFrames(UVRect.kFull, this.#gridRows, this.#gridCols, startRow, startCol, endRow, endCol);

        if (frames === null)
            return false;

        return this.addSequence(new SpriteSequence(name, frames, duration, playMode));
    }

    /*
        A sequence filling uvRect, a part of the atlas split into rows x cols frames.
        frameCount is how many to use, row by row from the top-left (all by default),
        for a last row that isn't full. Returns false if the grid or duration isn't
        valid, or the name is taken.
    */
    createSequenceInRect(name, uvRect, rows, cols, duration, playMode = SpritePlayMode.kLoop, frameCount = rows * cols)
    {
        if (Sprite.#isValidGrid(rows, cols, "createSequenceInRect") === false)
            return false;

        const frames = Sprite.#gridFrames(uvRect, rows, cols, 0, frameCount);

        if (frames === null)
            return false;

        return this.addSequence(new SpriteSequence(name, frames, duration, playMode));
    }

    // Adds a ready-made sequence (it can be shared by many Sprites). Returns false if it isn't valid or the name is taken.
    addSequence(sequence)
    {
        if ((sequence instanceof SpriteSequence) === false || sequence.isValid() === false)
        {
            console.error("Sprite.addSequence() needs an SpriteSequence with a name, frames and a duration above 0");
                return false;
        }

        if (this.#sequences.has(sequence.name))
        {
            console.error(`Sprite: there's already a sequence named "${sequence.name}"; remove it first`);
                return false;
        }

        this.#sequences.set(sequence.name, sequence);
            return true;
    }

    // Removing the current sequence stops playback; the frame drawn stays
    removeSequence(name)
    {
        if (this.#sequence !== null && this.#sequence.name === name)
            this.#resetPlayback();

        this.#sequences.delete(name);
    }

    hasSequence(name) { return this.#sequences.has(name); }
    getSequence(name) { return this.#sequences.get(name) ?? null; }

    // *** Playback ***

    /*
        Plays a sequence from its start (its last frame, when reversed). With restart
        false, a sequence already playing the same way just carries on. Returns false
        if there's no sequence with that name.
    */
    play(name, isReversed = false, restart = true)
    {
        const sequence = this.#sequences.get(name);

        if (sequence === undefined)
        {
            console.error(`Sprite.play(): no sequence named "${name}"`);
                return false;
        }

        if (restart === false && sequence === this.#sequence && isReversed === this.#isReversed && this.#isPlaying === true)
            return true;

        this.#sequence = sequence;
        this.#isReversed = (isReversed === true);
        this.#time = 0.0;
        this.#isPlaying = true;
        this.#isFinished = false;
        this.#applyFrame(0);
            return true;
    }

    // Holds the current frame; resume() carries on from it
    pause() { this.#isPlaying = false; }

    // Carries on after pause() (not after a one-shot sequence completed; play() it again)
    resume()
    {
        if (this.#sequence !== null && this.#isFinished === false)
            this.#isPlaying = true;
    }

    // Stops and rewinds to the sequence's first frame (its last, when reversed); play() or resume() starts it again
    stop()
    {
        if (this.#sequence === null)
            return;

        this.#time = 0.0;
        this.#isPlaying = false;
        this.#isFinished = false;
        this.#applyFrame(0);
    }

    /*
        Stops playback and draws one frame: an index into the current sequence's
        frames, or into the whole-atlas grid if there's no current sequence.
        Returns false if the index is out of range.
    */
    showFrame(index)
    {
        const count = this.getFrameCount();

        if (Number.isInteger(index) === false || index < 0 || index >= count)
        {
            console.error(`Sprite.showFrame(): frame ${index} isn't between 0 and ${count - 1}`);
                return false;
        }

        this.#isPlaying = false;

        if (this.#sequence === null)
            this.#showGridFrame(index);
        else
        {
            this.#frame = index;
            this.#uvRect.copy(this.#sequence.frames[index]);
        }

        return true;
    }

    // Scales playback time: 1 is normal, 2 double speed, 0 frozen. Below 0 is treated as 0.
    setSpeed(speed)
    {
        if (Number.isFinite(speed) === false)
        {
            console.error("Sprite.setSpeed() needs a number");
                return;
        }

        this.#speed = Math.max(0.0, speed);
    }

    getSpeed() { return this.#speed; }

    // callback(sprite, SpriteEvent, sequenceName), or null for none. It may call play() to chain sequences.
    setEventCallback(callback)
    {
        if (callback !== null && typeof callback !== "function")
        {
            console.error("Sprite.setEventCallback() needs a function or null");
                return;
        }

        this.#eventCallback = callback;
    }

    isPlaying() { return this.#isPlaying; }
    isFinished() { return this.#isFinished; }
    isReversed() { return this.#isReversed; }

    // The current sequence's name, or null
    getSequenceName() { return this.#sequence?.name ?? null; }

    // Index of the frame drawn now: into the current sequence, or the grid if there isn't one
    getFrameIndex() { return this.#frame; }

    // Frames in the current sequence, or in the grid if there isn't one
    getFrameCount() { return (this.#sequence !== null) ? this.#sequence.frames.length : (this.#gridRows * this.#gridCols); }

    // The frame drawn now, in texture pixels
    getFrameWidth() { return this.#uvRect.getWidth() * (this.getMaterial()?.getTexture(0)?.getWidth() ?? 0); }
    getFrameHeight() { return this.#uvRect.getHeight() * (this.getMaterial()?.getTexture(0)?.getHeight() ?? 0); }

    /*
        Advances the current sequence by dt seconds (times the speed). At most one
        event is reported per update, even if dt spans several cycles.
    */
    update(dt)
    {
        if (this.#isPlaying === false || this.#sequence === null)
            return;

        const sequence = this.#sequence;
        const frameCount = sequence.frames.length;
        const frameDuration = sequence.getFrameDuration();
        const steps = Sprite.#getCycleSteps(frameCount, sequence.playMode);
        const cycleDuration = steps * frameDuration;
        let event = -1;

        this.#time += dt * this.#speed;

        if (this.#time >= cycleDuration)
        {
            if (sequence.isOneShot())
            {
                // Stop on the final frame: the last, or the first again after a ping-pong
                this.#time = cycleDuration;
                this.#isPlaying = false;
                this.#isFinished = true;
                this.#applyFrame(sequence.isPingPong() ? 0 : frameCount - 1);
                event = SpriteEvent.kCompleted;
            }
            else
            {
                this.#time %= cycleDuration;
                event = SpriteEvent.kLooped;
            }
        }

        if (this.#isFinished === false)
        {
            const step = Math.min(Math.floor(this.#time / frameDuration), steps - 1);
            this.#applyFrame(Sprite.#stepToFrame(step, frameCount, sequence.playMode));
        }

        if (event !== -1 && this.#eventCallback !== null)
            this.#eventCallback(this, event, sequence.name);
    }

    // *** Model2D ***

    // Always true once loaded: load() only accepts Materials on Sprite's shader
    canInstance() { return this.isLoaded(); }

    // The frame drawn now, as part of the bound texture: mapped into the atlas for a SubTexture
    getUVRect()
    {
        const sub = this._getSubTexture();
            return (sub !== null) ? sub.mapUVRect(this.#uvRect, this.#atlasUVRect) : this.#uvRect;
    }

    // Uploads the frame's UV rect (the captured one from MaterialBatcher, or this sprite's own), then draws
    draw(transform, color, uvRect = null)
    {
        if (this.isLoaded() === false)
            return;

        const r = uvRect ?? this.getUVRect();
        Sprite.#kUVScratch.set(r.getX(), r.getY(), r.getWidth(), r.getHeight());
        this.getMaterial().setUniform("u_vec1", Sprite.#kUVScratch);

        super.draw(transform, color);
    }

    // Frees the mesh and forgets its sequences; the texture belongs to the caller
    unload()
    {
        super.unload();

        this.#sequences.clear();
        this.#resetPlayback();
        this.#uvRect.copy(UVRect.kFull);
        this.#gridRows = 1;
        this.#gridCols = 1;
    }

    /*
        The shader Sprite draws with (null if it can't be built). Build shared
        Materials for Sprites with it, e.g. gMaterialManager.load(Sprite.getDefaultShader(), [atlas]).
    */
    static getDefaultShader()
    {
        if (Sprite.#kShader === null)
        {
            let shader = new Shader();

            if (shader.load(SpriteShaderSource.VS, SpriteShaderSource.FS) === false)
            {
                console.error("Sprite couldn't build its shader");
                    return null;
            }

            Sprite.#kShader = shader;
        }

        return Sprite.#kShader;
    }

    // *** Internal Methods ***

    #resetPlayback()
    {
        this.#sequence = null;
        this.#time = 0.0;
        this.#frame = 0;
        this.#isPlaying = false;
        this.#isFinished = false;
        this.#isReversed = false;
    }

    // Draws frame index of the current sequence, counted in play order (so reversed counts from the end)
    #applyFrame(index)
    {
        const frames = this.#sequence.frames;
        this.#frame = (this.#isReversed === true) ? (frames.length - 1 - index) : index;
        this.#uvRect.copy(frames[this.#frame]);
    }

    #showGridFrame(index)
    {
        this.#frame = index;
        Sprite.#gridFrame(UVRect.kFull, this.#gridRows, this.#gridCols, index, this.#uvRect);
    }

    // *** Static Internal Helpers ***

    // True if rows x cols is a grid (whole numbers of at least 1); otherwise a console.error naming method
    static #isValidGrid(rows, cols, method)
    {
        if (Number.isInteger(rows) === false || Number.isInteger(cols) === false || rows < 1 || cols < 1)
        {
            console.error(`Sprite.${method}(): rows and cols must be whole numbers of at least 1`);
                return false;
        }

        return true;
    }

    // One frame of a rows x cols grid over rect (see "Grids" at the top of the class), written into out (also returned)
    static #gridFrame(rect, rows, cols, index, out = new UVRect())
    {
        const fw = rect.getWidth() / cols;
        const fh = rect.getHeight() / rows;
        const row = Math.floor(index / cols);
        const col = index % cols;

        // Row 0 is the top, and V runs up
        return out.set(rect.getX() + (col * fw), rect.getTop() - ((row + 1) * fh), fw, fh);
    }

    /*
        frameCount frames of a valid rows x cols grid over rect, starting at
        firstFrame, as a new array of UVRects. Returns null (with a
        console.error) if the frames aren't all in the grid.
    */
    static #gridFrames(rect, rows, cols, firstFrame, frameCount)
    {
        const total = rows * cols;

        if (Number.isInteger(firstFrame) === false || Number.isInteger(frameCount) === false ||
            firstFrame < 0 || frameCount < 1 || firstFrame + frameCount > total)
        {
            console.error(`Sprite: frames ${firstFrame} - ${firstFrame + frameCount - 1} aren't all in a ${rows} x ${cols} grid`);
                return null;
        }

        let frames = [];

        for (let i = 0; i < frameCount; ++i)
            frames.push(Sprite.#gridFrame(rect, rows, cols, firstFrame + i));

        return frames;
    }

    /*
        The frames from (startRow, startCol) to (endRow, endCol), inclusive, of a
        valid rows x cols grid over rect, reading row by row; the run can span
        rows. Returns null (with a console.error) if the range isn't valid.
    */
    static #gridRangeFrames(rect, rows, cols, startRow, startCol, endRow, endCol)
    {
        const first = (startRow * cols) + startCol;
        const last = (endRow * cols) + endCol;

        if (startCol < 0 || startCol >= cols || endCol < 0 || endCol >= cols || last < first)
        {
            console.error(`Sprite.createSequence(): (${startRow}, ${startCol}) - (${endRow}, ${endCol}) isn't a forward run in a ${rows} x ${cols} grid`);
                return null;
        }

        return Sprite.#gridFrames(rect, rows, cols, first, (last - first) + 1);
    }

    // Frame steps in one cycle: every frame for kOnce / kLoop; there and back (2n - 2) for ping-pong
    static #getCycleSteps(frameCount, playMode)
    {
        if (playMode === SpritePlayMode.kPingPong || playMode === SpritePlayMode.kPingPongOnce)
            return Math.max(1, (frameCount * 2) - 2);

        return frameCount;
    }

    // The frame shown step steps (0 .. #getCycleSteps() - 1) into a cycle
    static #stepToFrame(step, frameCount, playMode)
    {
        if (step >= frameCount)
            return Sprite.#getCycleSteps(frameCount, playMode) - step; // Ping-pong, on the way back

        return step;
    }
}
