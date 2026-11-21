/*
    Model2D - Base class for textured 2D shapes drawn in design units (see WGLV).

    Holds the per-object state (position, size, scale, rotation, color), the
    material and mesh, the setters/getters, render() and unload().

    Each subclass does its own loading, two ways:
        load(texture, ...)   A Texture; the subclass creates a Material with its own default shader.
        load(material, ...)  A loaded Material, used as is. It only holds the shader, textures
                             and samplers, so many models can share one (see MaterialManager).

    Uniform values live here, not in the Material: render() binds the
    material, then uploads this model's u_res, u_color, u_vec0, u_scale, and
    its UV rect as u_uvOffset and u_uvTile (for shaders that use them).

    A subclass's load() builds the mesh, calls its bindAttribs(), then hands
    both to the base with the "_" setters below (for subclasses only).

    Position: setPos(x, y, align) places an anchor point; align says which part
    of the model sits on it (bottom-left by default). The model keeps its
    alignment when its size changes, e.g. centered text stays centered.

    Raster scale: a model that draws into a texture at screen resolution can
    call listenForRasterScale(true) and override onRasterScaleChanged(newScale)
    (see WGLV). unload() stops listening.

    UV rect: the part of the texture a model draws (getUVRect()); the whole
    texture unless a subclass says otherwise (Sprite draws one atlas frame,
    Rect2D can tile and offset it). With a SubTexture (see TextureAtlas) in
    texture unit 0, it's that SubTexture's part of the atlas, and a Sprite's
    frames are within it.

    Instancing: canInstance() says whether MaterialBatcher may draw the model
    with its instanced shader: a plain quad filling width x height, drawing a
    UV rect of texture unit 0, tinted by its color. It's false unless a
    subclass overrides it; Rect2D (on its default shader), Text2D and Sprite do.
*/
class Model2D
{
    static #kFullUVRect = new UVRect(); // getUVRect() for models that draw the whole texture

    // Scratch values for uploading uniforms in render()
    static #kRes = new Vector2();
    static #kRect = new Vector4();
    static #kScaleRot = new Vector3();
    static #kUVOffset = new Vector2();
    static #kUVTile = new Vector2();

    #anchor;     // Where setPos() put it
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

    // True if MaterialBatcher may draw this with its instanced shader (see the top of this file). Subclasses opt in.
    canInstance() { return false; }

    // The part of the texture drawn, as a UVRect. Shared and read-only for models that draw all of it; don't change it.
    getUVRect() { return this._getTextureUVRect(); }

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

        uvRect is the captured getUVRect(), or null for the model's current one.
        It's uploaded as u_uvOffset (x, y) and u_uvTile (width, height); shaders
        that don't use them ignore it. Uniforms keep their value per shader, so
        this sets them every draw: models sharing Rect2D's shader (RoundedRect2D,
        NinePatch2D) get the whole texture back after a tiled Rect2D.
    */
    draw(x, y, scaleX, scaleY, rotZ, color, uvRect = null)
    {
        if (this.#isLoaded === false)
            return;

        const m = this.#material;
        const r = uvRect ?? this.getUVRect();

        Model2D.#kRes.set(WGLV.getWidth(), WGLV.getHeight());
        Model2D.#kRect.set(x, y, this.#width / 2.0, this.#height / 2.0);
        Model2D.#kScaleRot.set(scaleX, scaleY, rotZ);
        Model2D.#kUVOffset.set(r.getX(), r.getY());
        Model2D.#kUVTile.set(r.getWidth(), r.getHeight());

        m.setUniform("u_res", Model2D.#kRes);
        m.setUniform("u_color", color);
        m.setUniform("u_vec0", Model2D.#kRect);
        m.setUniform("u_scale", Model2D.#kScaleRot);
        m.setUniform(RenderUniforms.kUVOffset, Model2D.#kUVOffset);
        m.setUniform(RenderUniforms.kUVTile, Model2D.#kUVTile);

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

    // Texture unit 0 if it's a SubTexture (see TextureAtlas), else null
    _getSubTexture()
    {
        const t = this.#material?.getTexture(0) ?? null;
            return (t instanceof SubTexture) ? t : null;
    }

    // The part of texture unit 0 to draw: a SubTexture's UV rect, or the whole texture. Read-only.
    _getTextureUVRect() { return this._getSubTexture()?.getUVRect() ?? Model2D.#kFullUVRect; }

    /*
        For a subclass's load(): the Material to draw with. A loaded Texture gets a
        new Material on shader; a loaded Material is used as is. Returns null (with
        a console.error naming className) otherwise.
    */
    _resolveMaterial(source, shader, className)
    {
        if (source instanceof Texture)
        {
            if (source.isLoaded() === false)
            {
                console.error(`${className}.load(): the Texture isn't loaded`);
                    return null;
            }

            if (shader === null)
            {
                console.error(`${className}.load(): its shader couldn't be built`);
                    return null;
            }

            let material = new Material();

            if (material.load(shader, [source]) === false)
            {
                console.error(`${className}.load() couldn't create a Material`);
                    return null;
            }

            return material;
        }

        if (source instanceof Material && source.isLoaded() === true)
            return source;

        console.error(`${className}.load() needs a loaded Texture or Material`);
            return null;
    }

    // *** Internal Methods ***

    #updatePosition()
    {
        this.#position.set(this.#anchor.x + Alignment.offsetX(this.#align, this.#width),
                           this.#anchor.y + Alignment.offsetY(this.#align, this.#height));
    }
}

/*
    Rect2D - A textured rectangle.

    UV tiling and offset: setUVTile(2, 3) repeats the texture 2 times across and
    3 times up; setUVOffset(x, y) shifts it, in texture widths / heights (animate
    it to scroll). The texture's Sampler must wrap with REPEAT (or
    MIRRORED_REPEAT) for anything outside 0..1; the default sampler clamps. Both
    are part of getUVRect(), so tiled Rect2Ds still batch (see MaterialBatcher).

    A SubTexture (see TextureAtlas) can't tile or offset: REPEAT would wrap the
    whole atlas. It's drawn once, and setting a tile or offset logs an error.
*/
class Rect2D extends Model2D
{
    static #kShader = null; // Default shader, used when loading from a Texture

    #uvRect; // (x, y) is the UV offset, (width, height) the UV tile

    constructor()
    {
        super();
        this.#uvRect = new UVRect();
    }

    // How many times the texture repeats across (x) and up (y); 1 is once
    setUVTile(x, y = x)
    {
        this.#uvRect.setUnclamped(this.#uvRect.getX(), this.#uvRect.getY(), x, y);
        this.#checkSubTextureUVs("setUVTile");
    }

    // Shifts the texture, in texture widths (x) and heights (y)
    setUVOffset(x, y)
    {
        this.#uvRect.setUnclamped(x, y, this.#uvRect.getWidth(), this.#uvRect.getHeight());
        this.#checkSubTextureUVs("setUVOffset");
    }

    getUVTileX() { return this.#uvRect.getWidth(); }
    getUVTileY() { return this.#uvRect.getHeight(); }
    getUVOffsetX() { return this.#uvRect.getX(); }
    getUVOffsetY() { return this.#uvRect.getY(); }

    // The offset and tile, for draw() and MaterialBatcher; a SubTexture's UV rect instead (no tiling)
    getUVRect() { return this._getSubTexture()?.getUVRect() ?? this.#uvRect; }

    // _source is a Texture or a loaded Material. _width / _height default to its texture's size.
    load(_source, _width, _height)
    {
        if (this.isLoaded() === true)
            return false; // Unload first

        const material = this._resolveMaterial(_source, Rect2D.getDefaultShader(), "Rect2D");

        if (material === null)
            return false;

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
        this.#checkSubTextureUVs("load");
            return true;
    }

    // A Material on another shader may do more than the instanced shader can
    canInstance()
    {
        return (this.isLoaded() === true && this.getMaterial().getShader() === Rect2D.getDefaultShader());
    }

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

    // *** Internal Methods ***

    // Reports a tile or offset set on a SubTexture, which can't use them (see the top of Rect2D)
    #checkSubTextureUVs(methodName)
    {
        const r = this.#uvRect;

        if (this._getSubTexture() !== null && (r.getX() !== 0.0 || r.getY() !== 0.0 || r.getWidth() !== 1.0 || r.getHeight() !== 1.0))
            console.error(`Rect2D.${methodName}(): a SubTexture can't be tiled or offset; it's drawn once`);
    }
}

// A Rect2D with the corners rounded with geometry; loading from a Texture uses Rect2D's default shader
class RoundedRect2D extends Model2D
{
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

        const material = this._resolveMaterial(_source, Rect2D.getDefaultShader(), "RoundedRect2D");

        if (material === null)
            return false;

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

        const material = this._resolveMaterial(_source, Rect2D.getDefaultShader(), "NinePatch2D");

        if (material === null)
            return false;

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

    // Always drawn with its own Material on Rect2D's default shader
    canInstance() { return this.isLoaded(); }

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
    TextGlyphs2D - Text built from a TextAtlas's glyphs: one quad per
    character, in one mesh, drawn in one call. setText() only rebuilds that
    mesh, so it's cheap to change every frame (a timer, a score). Every
    TextGlyphs2D on the same TextAtlas shares its Material, so MaterialBatcher
    draws them one after another with a single bind.

    Like Text2D: sizes and positions are in design units, the glyphs are
    white and setColor() tints them, and its size is the text plus the
    padding around it, so alignment matches Text2D's.

    Raster scale: by default it isn't drawn again when the view's scale
    changes, so it stretches with the view. listenForRasterScale(true)
    makes it redraw its TextAtlas at the new scale, like Text2D, so it stays
    sharp; the setting is kept through unload() and setText(). The atlas is
    shared, so every TextGlyphs2D on it rebuilds its quads and gets sharp
    too, listening or not.

    Usage:
        let digits = new TextAtlas(font, "0123456789:", 40, "bold");
        let time = new TextGlyphs2D(digits);
        time.setColor(new Vector4(1, 1, 0, 1));
        time.setPos(400, 300, Alignment.kMiddleCenter);
        time.setText("12:34"); // isLoaded() is true once this succeeds
        ...
        time.render();

    Characters missing from the TextAtlas draw as its fallback "?". The
    TextAtlas belongs to the caller; unload it after the TextGlyphs2Ds.

    Each glyph can be moved on its own with setGlyphOffsets() (see
    TextEffect's wave); that re-uploads the positions only. setText()
    clears the offsets.
*/
class TextGlyphs2D extends Model2D
{
    #textAtlas;
    #text;
    #mesh;         // The mesh given to the base, kept to update its positions
    #positions;    // Each glyph quad's corners without offsets (x, y, z per vertex)
    #moved;        // Scratch for #positions plus offsets
    #glyphCount;
    #wantsRasterScale;  // Set by listenForRasterScale(); kept through unload()
    #onAtlasRasterized; // Given to the TextAtlas: rebuilds the quads after it draws the glyphs again

    // _textAtlas is a loaded TextAtlas, which can be shared by many TextGlyphs2Ds
    constructor(_textAtlas)
    {
        super();

        this.#textAtlas = _textAtlas;
        this.#text = null;
        this.#mesh = null;
        this.#positions = null;
        this.#moved = null;
        this.#glyphCount = 0;
        this.#wantsRasterScale = false;
        this.#onAtlasRasterized = () => {
            if (this.#text !== null)
                this.#buildMesh(this.#text); // New UVs and sizes; glyph offsets are cleared
        };

        if ((_textAtlas instanceof TextAtlas) === false)
        {
            console.error("TextGlyphs2D needs a TextAtlas");
            this.#textAtlas = null;
        }
    }

    // Returns false if the text is null, the TextAtlas isn't loaded, or the mesh couldn't be built
    setText(_text)
    {
        if (_text == null)
            return false;

        if (this.#textAtlas === null || this.#textAtlas.isLoaded() === false)
        {
            console.error("TextGlyphs2D.setText(): the TextAtlas isn't loaded");
                return false;
        }

        if (_text === this.#text && this.isLoaded() === true)
            return true; // Nothing changed

        if (this.#buildMesh(_text) === false)
            return false;

        this.#text = _text;
            return true;
    }

    getText() { return this.#text; }
    getTextAtlas() { return this.#textAtlas; }

    // Characters in the text (each one quad)
    getGlyphCount() { return this.#glyphCount; }

    /*
        true redraws the TextAtlas at the new scale when the view's scale changes,
        so the text stays sharp; false (the default) lets it stretch with the
        view. The setting is kept through unload() and setText().
    */
    listenForRasterScale(listen)
    {
        this.#wantsRasterScale = (listen === true);
        super.listenForRasterScale(this.#wantsRasterScale);
    }

    isListeningForRasterScale() { return this.#wantsRasterScale; }

    // The view scale changed while listening: redraw the atlas, which rebuilds the quads of every TextGlyphs2D on it
    onRasterScaleChanged(newScale)
    {
        if (this.#text !== null && this.#textAtlas !== null)
            this.#textAtlas.rasterize();
    }

    /*
        Moves each glyph by (x, y) design units from where the text puts it:
        offsets holds x, y pairs, one per glyph (getGlyphCount()), or is null to
        put them all back. The size and alignment don't change. Returns false
        if not loaded or offsets is too short.
    */
    setGlyphOffsets(offsets)
    {
        if (this.isLoaded() === false || this.#mesh === null)
            return false;

        if (offsets === null)
            return this.#mesh.updateVertexData(RenderAttributes.kPosition, this.#positions);

        if (offsets.length < this.#glyphCount * 2)
        {
            console.error(`TextGlyphs2D.setGlyphOffsets() needs ${this.#glyphCount * 2} values (x, y per glyph)`);
                return false;
        }

        const base = this.#positions;
        let moved = this.#moved;

        for (let i = 0; i < this.#glyphCount; ++i)
        {
            const dx = offsets[i * 2];
            const dy = offsets[(i * 2) + 1];

            for (let corner = 0; corner < 4; ++corner)
            {
                const p = (i * 12) + (corner * 3);
                moved[p] = base[p] + dx;
                moved[p + 1] = base[p + 1] + dy;
                moved[p + 2] = base[p + 2];
            }
        }

        return this.#mesh.updateVertexData(RenderAttributes.kPosition, moved);
    }

    // Frees the mesh; the TextAtlas belongs to the caller. setText() loads it again, listening again if it was.
    unload()
    {
        const wantsRasterScale = this.#wantsRasterScale;

        super.unload(); // Stops listening, through listenForRasterScale(false)
        this.#wantsRasterScale = wantsRasterScale;
        this.#textAtlas?.removeRasterizeListener(this.#onAtlasRasterized);
        this.#text = null;
        this.#mesh = null;
        this.#positions = null;
        this.#moved = null;
        this.#glyphCount = 0;
    }

    // *** Internal Methods ***

    /*
        One quad per character, each its glyph's whole cell, placed side by side
        by advance width from the left padding. Its UVs are the glyph's
        SubTexture rect in the atlas, so it draws with the atlas Texture as is.
    */
    #buildMesh(text)
    {
        const ta = this.#textAtlas;
        const chars = Array.from(text);
        const quadCount = Math.max(1, chars.length); // Empty text: one empty quad, so it still has a mesh and a size
        const height = ta.getLineHeight();

        let pos = new Float32Array(quadCount * 4 * 3);
        let uvs = new Float32Array(quadCount * 4 * 2);
        let indices = ((quadCount * 4) > 65535) ? new Uint32Array(quadCount * 6) : new Uint16Array(quadCount * 6);
        let penX = 0.0; // Each cell's left edge: the advances so far (the cell holds the left padding)

        for (let i = 0; i < chars.length; ++i)
        {
            const glyph = ta.getGlyph(chars[i]);
            const r = glyph.subTexture.getUVRect();
            const left = penX;
            const right = penX + glyph.width;
            const p = i * 12;
            const t = i * 8;
            const v = i * 4;

            // 3 - 2
            // |   |
            // 0 - 1
            pos.set([left, 0.0, 0.0,  right, 0.0, 0.0,  right, height, 0.0,  left, height, 0.0], p);
            uvs.set([r.getLeft(), r.getBottom(),  r.getRight(), r.getBottom(),  r.getRight(), r.getTop(),  r.getLeft(), r.getTop()], t);
            indices.set([v, v + 1, v + 2,  v + 2, v + 3, v], i * 6);

            penX += glyph.advance;
        }

        if (chars.length === 0)
            indices.set([0, 1, 2,  2, 3, 0], 0); // All corners at (0, 0): draws nothing

        let mesh = new StaticMesh();

        if (mesh.setVertexData(RenderAttributes.kPosition, pos) === false || mesh.setVertexData(RenderAttributes.kUV0, uvs) === false || mesh.setIndexData(indices) === false)
        {
            console.error("TextGlyphs2D couldn't build its mesh for: " + text);
            mesh.unload();
                return false;
        }

        mesh.bindAttribs();
        this._setMesh(mesh); // Frees the old one
        this.#mesh = mesh;
        this.#positions = pos;
        this.#moved = new Float32Array(pos.length);
        this.#glyphCount = chars.length;
        this._setSize(penX + (ta.getPadding() * 2.0), height); // Keeps the anchor and alignment from setPos()
        this._setMaterial(ta.getMaterial());
        this._setLoaded(true);

        // Rebuild when the atlas draws its glyphs again; listen for scale changes if asked to
        ta.addRasterizeListener(this.#onAtlasRasterized);

        if (this.#wantsRasterScale === true)
            super.listenForRasterScale(true);

            return true;
    }
}
