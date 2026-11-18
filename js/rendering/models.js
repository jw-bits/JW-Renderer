/*
    Model2D - Base class for textured 2D shapes drawn in design units (see WGLV).

    Holds the per-object state (position, size, scale, rotation, color), the
    material and mesh, the setters/getters, render() and unload().

    Each subclass does its own loading, two ways:
        load(texture, ...)   A Texture; the subclass creates a Material with its own default shader.
        load(material, ...)  A loaded Material, used as is. It only holds the shader, textures
                             and samplers, so many models can share one (see MaterialManager).

    Uniform values live here, not in the Material: render() binds the
    material, then uploads this model's u_res, u_color, u_vec0 and u_scale.

    A subclass's load() builds the mesh, calls its bindAttribs(), then hands
    both to the base with the "_" setters below (for subclasses only).

    Position: setPos(x, y, align) places an anchor point; align says which part
    of the model sits on it (bottom-left by default). The model keeps its
    alignment when its size changes, e.g. centered text stays centered.

    Raster scale: a model that draws into a texture at screen resolution can
    call listenForRasterScale(true) and override onRasterScaleChanged(newScale)
    (see WGLV). unload() stops listening.
*/
class Model2D
{
    // Scratch values for uploading uniforms in render()
    static #kRes = new Vector2();
    static #kRect = new Vector4();
    static #kScaleRot = new Vector3();

    #anchor;      // Where setPos() put it
    #align;       // Which part of the model sits on the anchor
    #position;    // The bottom-left corner, from the anchor, alignment and size
    #material;
    #width;
    #height;
    #mesh;
    #scaleX;
    #scaleY;
    #rotZ;
    #color;
    #isLoaded;
    #isListening; // For raster scale changes

    constructor()
    {
        this.#anchor = new Vector2();
        this.#align = Alignment.kBottomLeft;
        this.#position = new Vector2();
        this.#material = null;
        this.#width = 0;
        this.#height = 0;
        this.#mesh = null;
        this.#scaleX = 1.0;
        this.#scaleY = 1.0;
        this.#rotZ = 0.0;
        this.#color = new Vector4(1, 1, 1, 1);
        this.#isLoaded = false;
        this.#isListening = false;
    }

    // (x, y) is the anchor point; align says which part of the model sits on it
    setPos(x, y, align = Alignment.kBottomLeft)
    {
        this.#anchor.set(x, y);
        this.#align = align;
        this.#updatePosition();
    }

    setRotation(rotZ) { this.#rotZ = rotZ; }

    setScale(sx, sy = sx)
    {
        this.#scaleX = sx;
        this.#scaleY = sy;
    }

    setColor(color) { this.#color.set(color.x, color.y, color.z, color.w); }

    // The bottom-left corner, whatever the alignment
    getPos() { return this.#position; }
    getX() { return this.#position.x; }
    getY() { return this.#position.y; }

    // As given to setPos()
    getAnchor() { return this.#anchor; }
    getAlignment() { return this.#align; }

    getWidth() { return this.#width; }
    getHeight() { return this.#height; }
    getScaleX() { return this.#scaleX; }
    getScaleY() { return this.#scaleY; }
    getRotation() { return this.#rotZ; }
    getColor() { return this.#color; }
    getMaterial() { return this.#material; }
    isLoaded() { return this.#isLoaded; }

    // True if the mesh is a plain quad that fills width x height (MaterialBatcher can instance it)
    isQuad() { return false; }

    // Starts or stops calling onRasterScaleChanged() when WGLV's view scale changes
    listenForRasterScale(listen)
    {
        if (listen === this.#isListening)
            return;

        if (listen === true)
            WGLV.addRasterScaleListener(this);
        else
            WGLV.removeRasterScaleListener(this);

        this.#isListening = listen;
    }

    isListeningForRasterScale() { return this.#isListening; }

    // Called by WGLV while listening; override to react (e.g. redraw a texture at the new scale)
    onRasterScaleChanged(newScale) { }

    render()
    {
        if (this.#isLoaded === false)
        {
            console.log("Not loaded, skipping render");
                return;
        }

        this.#material.bind();
        this.draw(this.#position.x, this.#position.y, this.#scaleX, this.#scaleY, this.#rotZ, this.#color);
    }

    /*
        Draws with the given values instead of this model's own, without binding
        the material: it must already be bound. Used by MaterialBatcher, which
        binds a material once for many models and replays the values captured
        when each was submitted.
    */
    draw(x, y, scaleX, scaleY, rotZ, color)
    {
        if (this.#isLoaded === false)
            return;

        const m = this.#material;

        Model2D.#kRes.set(WGLV.getWidth(), WGLV.getHeight());
        Model2D.#kRect.set(x, y, this.#width / 2.0, this.#height / 2.0);
        Model2D.#kScaleRot.set(scaleX, scaleY, rotZ);

        m.setUniform("u_res", Model2D.#kRes);
        m.setUniform("u_color", color);
        m.setUniform("u_vec0", Model2D.#kRect);
        m.setUniform("u_scale", Model2D.#kScaleRot);

        this.#mesh.render();
    }

    // Frees the mesh and stops listening; the material and texture belong to the caller. load() can be called again afterwards.
    unload()
    {
        this.listenForRasterScale(false);

        if (this.#mesh !== null)
        {
            this.#mesh.unload();
            this.#mesh = null;
        }

        this.#material = null;
        this.#isLoaded = false;
    }

    // *** For subclasses ***

    // Keeps the anchor and alignment, so the bottom-left corner moves with the size
    _setSize(width, height)
    {
        this.#width = width;
        this.#height = height;
        this.#updatePosition();
    }

    _setMaterial(material) { this.#material = material; }

    // bindAttribs() must already have been called on the mesh. A previous, different mesh is unloaded.
    _setMesh(mesh)
    {
        if (this.#mesh !== null && this.#mesh !== mesh)
            this.#mesh.unload();

        this.#mesh = mesh;
    }

    _setLoaded(isLoaded) { this.#isLoaded = isLoaded; }

    // *** Internal Methods ***

    #updatePosition()
    {
        // Alignment values run left/center/right in groups of bottom/middle/top
        const col = Math.floor(this.#align / 3);
        const row = this.#align % 3;

        let x = this.#anchor.x;
        let y = this.#anchor.y;

        if (col === 1) x -= this.#width / 2.0;
        else if (col === 2) x -= this.#width;

        if (row === 1) y -= this.#height / 2.0;
        else if (row === 2) y -= this.#height;

        this.#position.set(x, y);
    }
}

class Rect2D extends Model2D
{
    static #kShader = null; // Default shader, used when loading from a Texture

    // _source is a Texture or a loaded Material. _width / _height default to its texture's size.
    load(_source, _width, _height)
    {
        if (this.isLoaded() === true)
            return false; // Unload first

        let material = null;

        if (_source instanceof Texture)
        {
            const shader = Rect2D.getDefaultShader();

            if (_source.isLoaded() === false || shader === null)
                return false;

            material = new Material();

            if (material.load(shader, [_source]) === false)
                return false;
        }
        else if (_source instanceof Material && _source.isLoaded() === true)
            material = _source;
        else
        {
            console.error("Rect2D.load() needs a loaded Texture or Material");
                return false;
        }

        const tex = material.getTexture(0);
        const w = _width ?? tex?.getWidth();
        const h = _height ?? tex?.getHeight();

        if (w === undefined || h === undefined)
        {
            console.error("Rect2D.load() needs a width and height for a Material without a texture");
                return false;
        }

        let mesh = Shapes.makeQuad(0, 0, 0, w, h, Alignment.kBottomLeft);

        if (mesh == null)
            return false;

        mesh.bindAttribs();
        this._setSize(w, h);
        this._setMaterial(material);
        this._setMesh(mesh);
        this._setLoaded(true);
            return true;
    }

    isQuad() { return true; }

    /*
        The shader Rect2D uses when loading from a Texture (null if it can't be built).
        Build shared Materials with it too: MaterialBatcher only draws a Rect2D in a
        single instanced call when its Material uses this shader.
    */
    static getDefaultShader()
    {
        if (Rect2D.#kShader === null)
        {
            let shader = new Shader();

            if (shader.load(Rect2DShaderSource.VS, Rect2DShaderSource.FS) === false)
                return null;

            Rect2D.#kShader = shader;
        }

        return Rect2D.#kShader;
    }
}

// A Rect2D with the corners rounded with geometry
class RoundedRect2D extends Model2D
{
    static #kShader = null; // Default shader, used when loading from a Texture

    #radius;

    constructor()
    {
        super();
        this.#radius = 0;
    }

    /*
        _source is a Texture or a loaded Material. _width / _height default to its texture's size.
        _radius is clamped to half the shortest side (a quarter of it if undefined).
        _segments is the number of triangles per corner.
    */
    load(_source, _width, _height, _radius, _segments = 8)
    {
        if (this.isLoaded() === true)
            return false; // Unload first

        let material = null;

        if (_source instanceof Texture)
        {
            const shader = RoundedRect2D.#getDefaultShader();

            if (_source.isLoaded() === false || shader === null)
                return false;

            material = new Material();

            if (material.load(shader, [_source]) === false)
                return false;
        }
        else if (_source instanceof Material && _source.isLoaded() === true)
            material = _source;
        else
        {
            console.error("RoundedRect2D.load() needs a loaded Texture or Material");
                return false;
        }

        const tex = material.getTexture(0);
        const w = _width ?? tex?.getWidth();
        const h = _height ?? tex?.getHeight();

        if (w === undefined || h === undefined)
        {
            console.error("RoundedRect2D.load() needs a width and height for a Material without a texture");
                return false;
        }

        if (_radius !== undefined)
            this.#radius = Math.max(0, Math.min(_radius, w / 2.0, h / 2.0));
        else
            this.#radius = Math.min(w, h) * 0.25;

        let mesh = Shapes.makeRoundedRect(0, 0, 0, w, h, this.#radius, _segments);

        if (mesh == null)
            return false;

        mesh.bindAttribs();
        this._setSize(w, h);
        this._setMaterial(material);
        this._setMesh(mesh);
        this._setLoaded(true);
            return true;
    }

    getRadius() { return this.#radius; }

    // *** Internal methods ***

    static #getDefaultShader()
    {
        if (RoundedRect2D.#kShader === null)
        {
            let shader = new Shader();

            if (shader.load(Rect2DShaderSource.VS, Rect2DShaderSource.FS) === false)
                return null;

            RoundedRect2D.#kShader = shader;
        }

        return RoundedRect2D.#kShader;
    }
}

/*
    Nine-slice (9-patch) rectangle.

    The texture is split into a 3x3 grid by a center UVRect:
        Corners (1, 3, 7, 9) keep their size in texture pixels.
        Edges (2, 8) stretch horizontally, (4, 6) stretch vertically.
        Center (5) stretches both ways to fill the rest.

    If the rectangle is smaller than the corners, all borders are shrunk by
    the same factor so the corners never overlap and keep their shape.
*/
class NinePatch2D extends Model2D
{
    static #kShader = null; // Default shader, used when loading from a Texture

    #centerUV;

    constructor()
    {
        super();
        this.#centerUV = new UVRect();
    }

    /*
        _source is a Texture or a loaded Material; a Material needs a texture in unit 0,
        since the border sizes come from it. _width / _height default to the texture's size.
        _centerUV is a UVRect for the stretchable center; the 8 surrounding areas come from
        what's left around it. Without one the whole texture is the center (a plain stretched rect).
    */
    load(_source, _width, _height, _centerUV)
    {
        if (this.isLoaded() === true)
            return false; // Unload first

        let material = null;

        if (_source instanceof Texture)
        {
            const shader = NinePatch2D.#getDefaultShader();

            if (_source.isLoaded() === false || shader === null)
                return false;

            material = new Material();

            if (material.load(shader, [_source]) === false)
                return false;
        }
        else if (_source instanceof Material && _source.isLoaded() === true)
            material = _source;
        else
        {
            console.error("NinePatch2D.load() needs a loaded Texture or Material");
                return false;
        }

        const tex = material.getTexture(0);

        if (tex === null)
        {
            console.error("NinePatch2D.load() needs a Material with a texture in unit 0");
                return false;
        }

        const w = _width ?? tex.getWidth();
        const h = _height ?? tex.getHeight();

        if (_centerUV !== undefined)
            this.#centerUV.set(_centerUV.getX(), _centerUV.getY(), _centerUV.getWidth(), _centerUV.getHeight());
        else
            this.#centerUV.set(0.0, 0.0, 1.0, 1.0);

        let mesh = this.#buildMesh(w, h, tex.getWidth(), tex.getHeight());

        if (mesh == null)
            return false;

        mesh.bindAttribs();
        this._setSize(w, h);
        this._setMaterial(material);
        this._setMesh(mesh);
        this._setLoaded(true);
            return true;
    }

    getCenterUV() { return this.#centerUV; }

    // *** Internal methods ***

    static #getDefaultShader()
    {
        if (NinePatch2D.#kShader === null)
        {
            let shader = new Shader();

            if (shader.load(Rect2DShaderSource.VS, Rect2DShaderSource.FS) === false)
                return null;

            NinePatch2D.#kShader = shader;
        }

        return NinePatch2D.#kShader;
    }

    #buildMesh(width, height, texWidth, texHeight)
    {
        const c = this.#centerUV;

        // Border sizes in pixels, taken from the texture areas around the center
        let left = c.getLeft() * texWidth;
        let right = (1.0 - c.getRight()) * texWidth;
        let bottom = c.getBottom() * texHeight;
        let top = (1.0 - c.getTop()) * texHeight;

        // Shrink the borders if they don't fit, by the same amount on both axes so the corners keep their shape
        const s = Math.min(NinePatch2D.#fitScale(left + right, width), NinePatch2D.#fitScale(bottom + top, height));
        left *= s; right *= s;
        bottom *= s; top *= s;

        const xs = [0, left, width - right, width];
        const ys = [0, bottom, height - top, height];
        const us = [0, c.getLeft(), c.getRight(), 1];
        const vs = [0, c.getBottom(), c.getTop(), 1];

        return Shapes.makeNinePatch(0, xs, ys, us, vs);
    }

    static #fitScale(borderTotal, size)
    {
        return (borderTotal > size && borderTotal > 0) ? (size / borderTotal) : 1.0;
    }
}

/*
    Text2D - Screen-space text, drawn as a textured quad.

    The text is drawn in white with TextCanvas and uploaded straight into the
    Text2D's own texture (no image decode). The color is applied as a tint, so
    setColor() never re-rasterizes; only setText() does.

    Sizes and positions are in design units (see WGLV). The text is rasterized
    at the view's current scale so it stays sharp at any window size, and it
    listens for raster scale changes to rasterize again.

    Usage:
        const font = await gFontManager.load("./fonts/MyFont-Regular.ttf"); // The app's FontManager
        let t = new Text2D(font, 32, "bold");
        t.setColor(new Vector4(1, 1, 0, 1));
        t.setPos(400, 300, Alignment.kMiddleCenter);
        t.setText("Hello"); // isLoaded() is true once this succeeds
        ...
        t.render();

    The Font is the only way to choose what Text2D draws with; use
    fontManager.loadFromSystem("Arial") for a font the browser already has.
    The Font must be loaded before setText() is called; otherwise setText()
    returns false and nothing changes. Call unload() when done with it, since
    it's registered with WGLV for scale changes while loaded.
*/
class Text2D extends Model2D
{
    #text;
    #font;
    #fontSize;
    #fontWeight;

    #texture;  // Owned: updated in place each time the text is rasterized
    #material; // Owned: this texture with Rect2D's default shader (so MaterialBatcher can instance it)

    // _font is a Font, usually from the app's FontManager
    constructor(_font, _fontSize = 32, _fontWeight = "normal")
    {
        super();

        this.#text = null;
        this.#font = _font;

        if (this.#font == null)
        {
            console.error("Text2D needs a Font; using sans-serif");
            this.#font = new Font();
            this.#font.loadFromSystem("sans-serif");
        }

        this.#fontSize = _fontSize;
        this.#fontWeight = _fontWeight;

        this.#texture = null;
        this.#material = null;
    }

    // Returns false if the text is null, the Font isn't loaded, or the text couldn't be drawn
    setText(_text)
    {
        if (_text == null)
            return false;

        if (this.#font.isLoaded() === false)
        {
            console.error("Text2D.setText(): the Font isn't loaded");
                return false;
        }

        if (_text === this.#text && this.isLoaded() === true)
            return true; // Nothing changed

        const previous = this.#text;
        this.#text = _text;

        if (this.#rasterize() === false)
        {
            this.#text = previous;
                return false;
        }

        return true;
    }

    getText() { return this.#text; }
    getFont() { return this.#font; }
    getFontSize() { return this.#fontSize; }
    getFontWeight() { return this.#fontWeight; }

    isQuad() { return true; }

    // The view scale changed: redraw at the new scale so the text stays sharp
    onRasterScaleChanged(newScale)
    {
        if (this.#text !== null)
            this.#rasterize();
    }

    // Frees the mesh, texture and material, and stops listening. setText() loads it again.
    unload()
    {
        super.unload();

        if (this.#texture !== null)
        {
            this.#texture.unload();
            this.#texture = null;
        }

        if (this.#material !== null)
        {
            this.#material.unload(); // Leaves the shared shader alone
            this.#material = null;
        }

        this.#text = null;
    }

    // *** Internal Methods ***

    #rasterize()
    {
        const scale = WGLV.getViewScale();
        const c = TextCanvas.draw(this.#text, this.#font, this.#fontSize, this.#fontWeight, scale);

        if (c === null)
        {
            console.error("Text2D couldn't draw the text: " + this.#text);
                return false;
        }

        // Upload into this Text2D's texture, creating it (and its material) the first time
        if (this.#texture === null)
        {
            let texture = new Texture(true, false); // No mipmaps: it's drawn at the size it's rasterized

            if (texture.loadCanvas(c) === false)
            {
                console.error("Text2D couldn't create the texture for: " + this.#text);
                    return false;
            }

            const shader = Rect2D.getDefaultShader();
            let material = new Material();

            if (shader === null || material.load(shader, [texture]) === false)
            {
                console.error("Text2D couldn't create its material");
                texture.unload();
                    return false;
            }

            this.#texture = texture;
            this.#material = material;
        }
        else if (this.#texture.updateCanvas(c) === false)
        {
            console.error("Text2D couldn't upload the texture for: " + this.#text);
                return false;
        }

        // Design units; the quad only needs rebuilding when its size changes
        const w = c.width / scale;
        const h = c.height / scale;

        if (this.isLoaded() === false || w !== this.getWidth() || h !== this.getHeight())
        {
            let mesh = Shapes.makeQuad(0, 0, 0, w, h, Alignment.kBottomLeft);

            if (mesh == null)
            {
                console.error("Text2D couldn't build its quad for: " + this.#text);
                    return false;
            }

            mesh.bindAttribs();
            this._setMesh(mesh); // Frees the old one
            this._setSize(w, h); // Keeps the anchor and alignment from setPos()
        }

        this._setMaterial(this.#material);
        this._setLoaded(true);
        this.listenForRasterScale(true);
            return true;
    }
}

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
*/
class Particles2D
{
    static #kShader = null;
    static #kFloatsPerParticle = 11; // Motion (4), start time + life + size (3), color (4)
    static #kRebaseTime = 600.0;     // Seconds; the clock restarts after this once nothing's alive

    #material;
    #vao;
    #quadBuffer;
    #indexBuffer;
    #instBuffer;
    #data;        // CPU copy of the instance buffer

    #capacity;
    #next;        // Next slot to write
    #dirtyMin;    // Slots written since the last upload
    #dirtyMax;

    #time;        // Seconds since the clock (re)started
    #aliveUntil;  // When the last particle emitted so far dies

    #gravity;
    #endScale;

    #resLocation;
    #timeLocation;
    #gravityLocation;
    #endScaleLocation;

    #isLoaded;

    constructor()
    {
        this.#material = null;
        this.#vao = null;
        this.#quadBuffer = null;
        this.#indexBuffer = null;
        this.#instBuffer = null;
        this.#data = null;

        this.#capacity = 0;
        this.#next = 0;
        this.#dirtyMin = Infinity;
        this.#dirtyMax = -1;

        this.#time = 0.0;
        this.#aliveUntil = 0.0;

        this.#gravity = new Vector2();
        this.#endScale = 1.0;

        this.#resLocation = null;
        this.#timeLocation = null;
        this.#gravityLocation = null;
        this.#endScaleLocation = null;

        this.#isLoaded = false;
    }

    /*
        maxParticles is how many can be alive at once. The texture is drawn on each
        particle; sampler is optional (see Material). Returns false on failure.
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

        if ((texture instanceof Texture) === false || texture.isLoaded() === false)
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

        const gl = WGLV.context;
        const stride = Particles2D.#kFloatsPerParticle;

        this.#material = material;
        this.#capacity = maxParticles;
        this.#data = new Float32Array(maxParticles * stride); // All zero: life 0, so every slot starts dead

        this.#resLocation = shader.getUniform("u_res");
        this.#timeLocation = shader.getUniform("u_time");
        this.#gravityLocation = shader.getUniform("u_gravity");
        this.#endScaleLocation = shader.getUniform("u_endScale");

        this.#quadBuffer = gl.createBuffer();
        this.#indexBuffer = gl.createBuffer();
        this.#instBuffer = gl.createBuffer();
        this.#vao = gl.createVertexArray();

        gl.bindVertexArray(this.#vao);

        // Unit quad centered on the particle, shared by every instance
        const posLocation = RenderAttributes.getLocation(RenderAttributes.kPosition);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.#quadBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5,  0.5, -0.5,  0.5, 0.5,  -0.5, 0.5]), gl.STATIC_DRAW);
        gl.vertexAttribPointer(posLocation, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(posLocation);

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.#indexBuffer); // Part of the VAO's state
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint8Array([0, 1, 2,  2, 3, 0]), gl.STATIC_DRAW);

        // Per-particle values, interleaved; allocated once, then only changed slots are uploaded
        const bytes = 4;
        const strideBytes = stride * bytes;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.#instBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.#data, gl.DYNAMIC_DRAW);

        const attribs = [
            [Particles2DShaderSource.kMotionLocation, 4, 0],
            [Particles2DShaderSource.kLifeLocation, 3, 4],
            [Particles2DShaderSource.kColorLocation, 4, 7]
        ];

        for (const [location, size, offset] of attribs)
        {
            gl.vertexAttribPointer(location, size, gl.FLOAT, false, strideBytes, offset * bytes);
            gl.enableVertexAttribArray(location);
            gl.vertexAttribDivisor(location, 1);
        }

        gl.bindVertexArray(null);

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

        const gl = WGLV.context;

        this.#upload();

        this.#material.bind(); // Shader, texture, sampler
        gl.uniform2f(this.#resLocation, WGLV.getWidth(), WGLV.getHeight());
        gl.uniform1f(this.#timeLocation, this.#time);
        gl.uniform2f(this.#gravityLocation, this.#gravity.x, this.#gravity.y);
        gl.uniform1f(this.#endScaleLocation, this.#endScale);

        gl.bindVertexArray(this.#vao);
        gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_BYTE, 0, this.#capacity);
        gl.bindVertexArray(null);
    }

    // Frees the GPU objects; load() can be called again afterwards. The texture belongs to the caller.
    unload()
    {
        const gl = WGLV.context;

        if (this.#vao !== null) gl.deleteVertexArray(this.#vao);
        if (this.#quadBuffer !== null) gl.deleteBuffer(this.#quadBuffer);
        if (this.#indexBuffer !== null) gl.deleteBuffer(this.#indexBuffer);
        if (this.#instBuffer !== null) gl.deleteBuffer(this.#instBuffer);
        if (this.#material !== null) this.#material.unload(); // Leaves the shared shader and the texture alone

        this.#vao = null;
        this.#quadBuffer = null;
        this.#indexBuffer = null;
        this.#instBuffer = null;
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

        const gl = WGLV.context;
        const stride = Particles2D.#kFloatsPerParticle;
        const first = this.#dirtyMin * stride;
        const count = (this.#dirtyMax - this.#dirtyMin + 1) * stride;

        gl.bindBuffer(gl.ARRAY_BUFFER, this.#instBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, first * 4, this.#data, first, count);

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
