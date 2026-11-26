"use strict";

/*
    Model2D - Base class for textured 2D shapes drawn in design units (see WGLV).

    A model is what's drawn, not where: it holds its size, alignment,
    material and mesh, and is drawn at a Transform2D given each time. One
    model can be drawn at any number of places in a frame (a board's squares,
    a grid of tiles). It has no position of its own; place it with a
    Transform2D, or give it to an Entity (entity.js) for a hierarchy and
    motion.

        let t = new Transform2D(400, 300);
        rect.setAlignment(Alignment.kMiddleCenter);
        rect.render(t);                        // Or batcher.submit(rect, t, layer)

    Each subclass does its own loading, two ways:
        load(texture, ...)   A Texture; the subclass creates a Material with its own default shader.
        load(material, ...)  A loaded Material, used as is. It only holds the shader, textures
                             and samplers, so many models can share one (see MaterialManager).

    render() and submit can also take another Material for one draw, e.g. a
    lit or outlined version of the model's own; it must suit the model's mesh
    (Rect2D's default shader, or one built from the same source). The UV rect
    is still the model's own (see below).

    Color: a model has none of its own. render() and submit take the color
    (a Vector4) to draw with, white if left out, so whoever draws it (an
    Entity, a widget, game code) holds the color and one model can be drawn
    in many colors.

    Uniform values live here, not in the Material: render() binds the
    material, then uploads the given u_color, this model's u_vec0, u_scale, and its UV
    rect as u_uvOffset and u_uvTile (for shaders that use them). Positions are
    world design units; the active camera (see ClipSpace) takes them to the screen.

    A subclass's load() builds the mesh, calls its bindAttribs(), then hands
    both to the base with the "_" setters below (for subclasses only).

    Meshes are in 0..1 of the model's rect, built with Shapes' makeUnit...()
    methods: the shaders scale them by its width and height (u_vec0), so a
    size change needs no new quad. Rect2D, Sprite and Text2D each share one
    static unit quad across all their models (_setMesh(quad, true): never
    freed by a model). TextGlyphs2D is the exception: its own shader takes its
    glyph quads in design units.

    Alignment: the transform's position is the model's anchor, and
    setAlignment() says which part of the model sits on it (bottom-left by
    default). The model keeps its alignment when its size changes, e.g.
    centered text stays centered. The model scales and rotates about its
    center, wherever the anchor is. The step from the anchor to the corner
    isn't turned, so under a turning parent (see Entity) only the anchor is
    carried round: center the model (Alignment.kMiddleCenter) for it to be
    carried round by its middle. getDrawTransform() gives what it's drawn
    with: the transform with its position moved to the bottom-left corner.

    Raster scale: a model that draws into a texture at screen resolution can
    call listenForRasterScale(true) and override onRasterScaleChanged(newScale)
    (see WGLV.addListeners()); Text2D does. unload() stops listening.
    TextGlyphs2D doesn't need to: its TextAtlas follows the scale itself.

    UV rect: the part of the texture a model draws (getUVRect()); the whole
    texture unless a subclass says otherwise (Sprite draws one atlas frame,
    Rect2D can tile and offset it). With an AtlasSubTexture (see TextureAtlas) in
    texture unit 0, it's that AtlasSubTexture's part of the atlas, and a Sprite's
    frames are within it.

    Instancing: canInstance(material) says whether Batcher may draw the
    model with its instanced shader, given the Material it's drawn with: a
    plain quad filling width x height, drawing a UV rect of texture unit 0,
    tinted by the color it's drawn with. It's false unless a subclass overrides it; Rect2D
    (on its default shader), Text2D and Sprite do.
*/
class Model2D
{
    // Scratch values for uploading uniforms in draw()
    static #kRect = new Vector4();
    static #kScaleRot = new Vector3();
    static #kUVOffset = new Vector2();
    static #kUVTile = new Vector2();
    static #kDrawTransform = new Transform2D(); // render() and containsPoint(): the transform at the bottom-left corner

    #align;       // Which part of the model sits on the transform's position (the anchor)
    #material;
    #width;
    #height;
    #mesh;
    #ownsMesh;    // False for a class's shared quad: unload() leaves it alone
    #isLoaded;
    #isListening;   // For raster scale changes
    #viewListeners; // Given to WGLV.addListeners() while listening

    constructor()
    {
        this.#align = Alignment.kBottomLeft;
        this.#material = null;
        this.#width = 0;
        this.#height = 0;
        this.#mesh = null;
        this.#ownsMesh = false;
        this.#isLoaded = false;
        this.#isListening = false;
        this.#viewListeners = { onRasterScaleChanged: (newScale) => this.onRasterScaleChanged(newScale) };
    }

    // Which part of the model sits on the transform's position (an Alignment); kept until changed. Returns false if align isn't valid.
    setAlignment(align)
    {
        if (Alignment.isValid(align) === false)
        {
            console.error(`${this.constructor.name}.setAlignment() needs an Alignment`);
                return false;
        }

        this.#align = align;
            return true;
    }

    getAlignment() { return this.#align; }

    getWidth() { return this.#width; }
    getHeight() { return this.#height; }
    getMaterial() { return this.#material; }
    isLoaded() { return this.#isLoaded; }

    /*
        What it's drawn with at transform (the anchor), written into out (a Transform2D)
        and returned: transform's scale and rotation, and its position moved by the
        alignment to the bottom-left corner (see draw()).
    */
    getDrawTransform(transform, out)
    {
        return out.copy(transform).setPosition(transform.getX() + Alignment.offsetX(this.#align, this.#width),
                                               transform.getY() + Alignment.offsetY(this.#align, this.#height));
    }

    // The bottom-left corner it's drawn at with transform, written into out and returned
    getCorner(transform, out = new Vector2())
    {
        const t = this.getDrawTransform(transform, Model2D.#kDrawTransform);
        out.setXY(t.getX(), t.getY());
            return out;
    }

    // True if point (a Vector2, world design units) is inside the model's rect drawn at transform, scaled and turned
    containsPoint(transform, point)
    {
        const t = this.getDrawTransform(transform, Model2D.#kDrawTransform);
        const hw = this.#width / 2.0;
        const hh = this.#height / 2.0;
        const dx = point.x - (t.getX() + hw);
        const dy = point.y - (t.getY() + hh);
        const s = Math.sin(t.getRotation());
        const c = Math.cos(t.getRotation());
        const sx = t.getScaleX();
        const sy = t.getScaleY();

        if (sx === 0.0 || sy === 0.0)
            return false;

        // Into the model's own axes, unscaled
        const x = ((dx * c) + (dy * s)) / sx;
        const y = ((dy * c) - (dx * s)) / sy;

        return (Math.abs(x) <= hw && Math.abs(y) <= hh);
    }

    /*
        The model's box with its anchor at (0, 0), unscaled and unturned, written into
        out (a Bounds2D) and returned: its width x height placed by the alignment.
        Subclasses whose drawing isn't their rect override it (Skeleton2D).
    */
    getLocalBounds(out = new Bounds2D())
    {
        const x = Alignment.offsetX(this.#align, this.#width);
        const y = Alignment.offsetY(this.#align, this.#height);

        out.setMinMax(x, y, x + this.#width, y + this.#height);
            return out;
    }

    /*
        The axis-aligned box around the model as drawn at transform (the anchor), in
        world design units, written into out (a Bounds2D) and returned. Like draw(),
        it scales and turns about the rect's center and ignores the transform's shear
        (the 2D shaders don't draw it yet, see Transform2D).
    */
    getWorldBounds(transform, out = new Bounds2D())
    {
        const t = this.getDrawTransform(transform, Model2D.#kDrawTransform);
        const hw = this.#width / 2.0;
        const hh = this.#height / 2.0;

        return Model2D._setTurnedBox(out, t.getX() + hw, t.getY() + hh, hw, hh, t.getScaleX(), t.getScaleY(), t.getRotation());
    }

    /*
        The box a Batcher culls the model by when drawn at transform (see
        Batcher.setLayerCulled()), written into out (a Bounds2D) and returned: an empty
        box is culled. getWorldBounds() unless a subclass has a cheaper one
        (Skeleton2D.setCullBounds()).
    */
    getCullBounds(transform, out = new Bounds2D()) { return this.getWorldBounds(transform, out); }

    // True if Batcher may draw this with its instanced shader when drawn with material (see the top of this file). Subclasses opt in.
    canInstance(material = this.#material) { return false; }

    /*
        True if draw() binds Materials of its own (Skeleton2D: one per atlas page and
        blend mode) rather than drawing with the bound one. Batcher then doesn't bind
        one for it and forgets what was bound afterwards. False unless a subclass says so.
    */
    bindsOwnMaterials() { return false; }

    // Draw calls the last draw() made; 1 unless a subclass that binds its own Materials says otherwise
    getDrawCount() { return 1; }

    // The part of the texture drawn, as a UVRect. Shared and read-only for models that draw all of it; don't change it.
    getUVRect() { return this.#getTextureUVRect(); }

    // Starts or stops calling onRasterScaleChanged() when WGLV's view scale changes
    listenForRasterScale(listen)
    {
        if (listen === this.#isListening)
            return;

        if (listen === true)
            WGLV.addListeners(this.#viewListeners);
        else
            WGLV.removeListeners(this.#viewListeners);

        this.#isListening = listen;
    }

    isListeningForRasterScale() { return this.#isListening; }

    // Called by WGLV while listening; override to react (e.g. redraw a texture at the new scale)
    onRasterScaleChanged(newScale) { }

    /*
        Draws it right away at transform (a Transform2D: its position is the anchor, see
        setAlignment()), with material, or its own Material if null, tinted color (a
        Vector4, white by default). Returns false if it isn't loaded.
    */
    render(transform, material = null, color = Vector4.kWhite)
    {
        if (this.#isLoaded === false)
        {
            console.log("Not loaded, skipping render");
                return false;
        }

        const m = material ?? this.#material;
        const t = this.getDrawTransform(transform, Model2D.#kDrawTransform);

        m.bind();
        this.draw(t, color ?? Vector4.kWhite, null, m);
            return true;
    }

    /*
        Draws with the given values, without binding the material: it must
        already be bound. Used by Batcher, which binds a material once for many
        models and replays the values captured when each was submitted.

        transform is a Transform2D whose position is the bottom-left corner to
        draw at (getDrawTransform()), not the anchor.

        uvRect is the captured getUVRect(), or null for the model's current one.
        It's uploaded as u_uvOffset (x, y) and u_uvTile (width, height); shaders
        that don't use them ignore it. Uniforms keep their value per shader, so
        this sets them every draw: models sharing Rect2D's shader (RoundedRect2D,
        NinePatch2D) get the whole texture back after a tiled Rect2D.

        material is the bound Material the uniforms go to (the model's own by default).
    */
    draw(transform, color, uvRect = null, material = this.#material)
    {
        if (this.#isLoaded === false)
            return;

        const m = material;
        const r = uvRect ?? this.getUVRect();

        Model2D.#kRect.setXYZW(transform.getX(), transform.getY(), this.#width / 2.0, this.#height / 2.0);
        Model2D.#kScaleRot.setXYZ(transform.getScaleX(), transform.getScaleY(), transform.getRotation());
        Model2D.#kUVOffset.setXY(r.getX(), r.getY());
        Model2D.#kUVTile.setXY(r.getWidth(), r.getHeight());

        m.setUniform("u_color", color);
        m.setUniform("u_vec0", Model2D.#kRect);
        m.setUniform("u_scale", Model2D.#kScaleRot);
        m.setUniform(RenderUniforms.kUVOffset, Model2D.#kUVOffset);
        m.setUniform(RenderUniforms.kUVTile, Model2D.#kUVTile);

        this.#mesh.render();
    }

    // Frees its own mesh (not a shared quad) and stops listening; the material and texture belong to the caller. load() can be called again afterwards.
    unload()
    {
        this.listenForRasterScale(false);

        if (this.#mesh !== null && this.#ownsMesh === true)
            this.#mesh.unload();

        this.#mesh = null;
        this.#ownsMesh = false;
        this.#material = null;
        this.#isLoaded = false;
    }

    // *** Subclass Methods ***

    // Design units; the alignment is kept, so the corner moves with the size
    _setSize(width, height)
    {
        this.#width = width;
        this.#height = height;
    }

    _setMaterial(material) { this.#material = material; }

    /*
        mesh is in 0..1 of the rect (see the top of this file), and bindAttribs() must
        already have been called on it. isShared is true for a mesh other models use
        too (a class's static quad), which this model never unloads. A previous,
        different mesh of its own is unloaded.
    */
    _setMesh(mesh, isShared = false)
    {
        if (this.#mesh !== null && this.#mesh !== mesh && this.#ownsMesh === true)
            this.#mesh.unload();

        this.#mesh = mesh;
        this.#ownsMesh = (isShared === false);
    }

    _setLoaded(isLoaded) { this.#isLoaded = isLoaded; }

    /*
        For getWorldBounds(): the axis-aligned box around a halfWidth x halfHeight box
        centered on (centerX, centerY), scaled by (scaleX, scaleY) then turned by
        rotation (radians) about that center, written into out (a Bounds2D) and returned.
    */
    static _setTurnedBox(out, centerX, centerY, halfWidth, halfHeight, scaleX, scaleY, rotation)
    {
        const s = Math.sin(rotation);
        const c = Math.cos(rotation);
        const hx = halfWidth * scaleX;
        const hy = halfHeight * scaleY;
        const ex = Math.abs(c * hx) + Math.abs(s * hy);
        const ey = Math.abs(s * hx) + Math.abs(c * hy);

        out.setMinMax(centerX - ex, centerY - ey, centerX + ex, centerY + ey);
            return out;
    }

    // Texture unit 0 if it's an AtlasSubTexture (see TextureAtlas), else null
    _getSubTexture()
    {
        const t = this.#material?.getTexture(0) ?? null;
            return (t instanceof AtlasSubTexture) ? t : null;
    }

    /*
        For a subclass's load(): the Material to draw with. A loaded Texture gets a
        new Material on shader; a loaded Material is used as is. Returns null (with
        a console.error naming className) otherwise.
    */
    _resolveMaterial(source, shader, className)
    {
        if (source instanceof BaseTexture)
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

    // The part of texture unit 0 to draw: an AtlasSubTexture's UV rect, or the whole texture. Read-only.
    #getTextureUVRect() { return this.#material?.getTexture(0)?.getUVRect() ?? UVRect.kFull; }
}

/*
    Rect2D - A textured rectangle.

    UV tiling and offset: setUVTile(2, 3) repeats the texture 2 times across and
    3 times up; setUVOffset(x, y) shifts it, in texture widths / heights (animate
    it to scroll). The texture's Sampler must wrap with REPEAT (or
    MIRRORED_REPEAT) for anything outside 0..1; the default sampler clamps. Both
    are part of getUVRect(), so tiled Rect2Ds still batch (see Batcher).

    An AtlasSubTexture (see TextureAtlas) can't tile or offset: REPEAT would wrap the
    whole atlas. It's drawn once, and setting a tile or offset logs an error.

    Every Rect2D draws the same unit quad, made the first time one loads and
    kept for the page's life; setSize() only changes the size uploaded with it.
*/
class Rect2D extends Model2D
{
    static #kQuad = null; // Shared unit quad (see #getQuad())

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

    // The offset and tile, for draw() and Batcher; an AtlasSubTexture's UV rect instead (no tiling)
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

        this._setSize(w, h);
        this._setMaterial(material);
        this._setMesh(Rect2D.#getQuad(), true);
        this._setLoaded(true);
        this.#checkSubTextureUVs("load");
            return true;
    }

    /*
        Changes the size in design units, keeping the alignment (a centered rect stays
        centered). Cheap: the quad is shared and scaled when drawn. Returns false if
        not loaded or the size isn't above 0.
    */
    setSize(width, height)
    {
        if (this.isLoaded() === false)
        {
            console.error("Rect2D.setSize(): load it first");
                return false;
        }

        if (Number.isFinite(width) === false || Number.isFinite(height) === false || width <= 0 || height <= 0)
        {
            console.error("Rect2D.setSize() needs a width and height above 0");
                return false;
        }

        this._setSize(width, height);
            return true;
    }

    // A Material on another shader may do more than the instanced shader can
    canInstance(material = this.getMaterial())
    {
        return (this.isLoaded() === true && material.getShader() === Rect2D.getDefaultShader());
    }

    /*
        The shader Rect2D uses when loading from a Texture (null if it can't be built).
        Build shared Materials with it too: Batcher only draws a Rect2D in a
        single instanced call when its Material uses this shader.
    */
    static getDefaultShader()
    {
        return ShaderManager.get(Rect2DShaderSource);
    }

    // *** Internal Methods ***

    // The unit quad every Rect2D draws, made the first time
    static #getQuad()
    {
        if (Rect2D.#kQuad === null)
        {
            let quad = Shapes.makeUnitQuad();
            quad.bindAttribs();
            Rect2D.#kQuad = quad;
        }

        return Rect2D.#kQuad;
    }

    // Reports a tile or offset set on an AtlasSubTexture, which can't use them (see the top of Rect2D)
    #checkSubTextureUVs(methodName)
    {
        const r = this.#uvRect;

        if (this._getSubTexture() !== null && (r.getX() !== 0.0 || r.getY() !== 0.0 || r.getWidth() !== 1.0 || r.getHeight() !== 1.0))
            console.error(`Rect2D.${methodName}(): an AtlasSubTexture can't be tiled or offset; it's drawn once`);
    }
}

// A Rect2D with the corners rounded with geometry; loading from a Texture uses Rect2D's default shader
class RoundedRect2D extends Model2D
{
    #radius;
    #segments;

    constructor()
    {
        super();
        this.#radius = 0;
        this.#segments = 8;
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

        let mesh = Shapes.makeUnitRoundedRect(w, h, this.#radius, _segments);

        if (mesh == null)
            return false;

        mesh.bindAttribs();
        this.#segments = _segments;
        this._setSize(w, h);
        this._setMaterial(material);
        this._setMesh(mesh);
        this._setLoaded(true);
            return true;
    }

    /*
        Changes the size in design units, keeping the alignment (a centered rect
        stays centered). radius is clamped to half the shortest side
        (the current one by default; Infinity makes a pill). Rebuilds the mesh. Returns
        false if not loaded or the size isn't above 0.
    */
    setSize(width, height, radius = this.#radius)
    {
        if (this.isLoaded() === false)
        {
            console.error("RoundedRect2D.setSize(): load it first");
                return false;
        }

        if (Number.isFinite(width) === false || Number.isFinite(height) === false || width <= 0 || height <= 0 ||
            Number.isNaN(radius) === true || radius < 0)
        {
            console.error("RoundedRect2D.setSize() needs a width and height above 0 and a radius of 0 or more");
                return false;
        }

        const r = Math.min(radius, width / 2.0, height / 2.0);

        if (width === this.getWidth() && height === this.getHeight() && r === this.#radius)
            return true;

        let mesh = Shapes.makeUnitRoundedRect(width, height, r, this.#segments);

        if (mesh == null)
            return false;

        mesh.bindAttribs();
        this.#radius = r;
        this._setMesh(mesh); // Frees the old one
        this._setSize(width, height);
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

        if (!(w > 0) || !(h > 0))
        {
            console.error("NinePatch2D.load() needs a width and height above 0");
                return false;
        }

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

        return Shapes.makeUnitNinePatch(width, height, xs, ys, us, vs);
    }

    static #fitScale(borderTotal, size)
    {
        return (borderTotal > size && borderTotal > 0) ? (size / borderTotal) : 1.0;
    }
}

/*
    Text2D - Screen-space text, drawn as a textured quad.

    The text is drawn with TextCanvas and uploaded straight into the Text2D's
    own texture (no image decode). The color it's drawn with (see render())
    is a tint on top of it, so it never re-rasterizes.

    Rasterized colors: the text is drawn into the texture in
    setRasterizedTextColor() (white by default), with an optional drop shadow
    behind it in setRasterizedShadowColor(). With a white rasterized color,
    the draw color colors the text; with colored text or a shadow, draw it
    with (1, 1, 1, a) so the rasterized colors stay as they are and a fades
    the whole Text2D in or out. Changing a rasterized color, the
    shadow's offset, or turning the shadow on / off re-rasterizes.

        t.setRasterizedTextColor(new Vector4(1, 0.8, 0, 1));
        t.setRasterizedShadowColor(new Vector4(0, 0, 0, 0.6));
        t.setDropShadowOffset(3, -3); // Design units; negative y is down
        t.setDropShadowEnabled(true); // Off by default

    The shadow makes the quad bigger by its offset on every side, so the text
    stays centered in it.

    Sizes and positions are in design units (see WGLV). The text is rasterized
    at the view's current scale so it stays sharp at any window size, and it
    listens for raster scale changes to rasterize again.

    Usage:
        const font = await FontManager.load("./fonts/MyFont-Regular.ttf");
        let t = new Text2D(font, 32, "bold");
        t.setAlignment(Alignment.kMiddleCenter);
        t.setText("Hello"); // isLoaded() is true once this succeeds
        ...
        t.render(new Transform2D(400, 300), null, yellow); // Or batcher.submit(t, transform, layer, null, yellow)

    The Font is the only way to choose what Text2D draws with; use
    FontManager.loadFromSystem("Arial") for a font the browser already has.
    The Font must be loaded before setText() is called; otherwise setText()
    returns false and nothing changes. Call unload() when done with it, since
    it's registered with WGLV for scale changes while loaded.
*/
class Text2D extends Model2D
{
    static #kQuad = null; // Unit quad shared by every Text2D, made the first time one is drawn

    #text;
    #font;
    #fontSize;
    #fontWeight;

    #texture;  // Owned: updated in place each time the text is rasterized
    #material; // Owned: this texture with Rect2D's default shader (so Batcher can instance it)

    // Drawn into the texture
    #textColor;    // Vector4
    #shadowColor;  // Vector4
    #isShadowOn;
    #shadowOffset; // Vector2, design units

    // _font is a Font, usually from FontManager
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

        this.#textColor = new Vector4(1, 1, 1, 1);
        this.#shadowColor = new Vector4(0, 0, 0, 0.6);
        this.#isShadowOn = false;
        this.#shadowOffset = new Vector2(3, -3);
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

    // *** Rasterized colors and drop shadow ***

    // The color the text is drawn into the texture in, a Vector4 (copied); white by default
    setRasterizedTextColor(color)
    {
        if (Text2D.#copyColor(this.#textColor, color) === true)
            this.#rasterizeAgain();
    }

    // The color the drop shadow is drawn into the texture in, a Vector4 (copied)
    setRasterizedShadowColor(color)
    {
        if (Text2D.#copyColor(this.#shadowColor, color) === true && this.#isShadowOn === true)
            this.#rasterizeAgain();
    }

    getRasterizedTextColor() { return this.#textColor; }
    getRasterizedShadowColor() { return this.#shadowColor; }

    setDropShadowEnabled(enabled)
    {
        const isOn = (enabled === true);

        if (isOn === this.#isShadowOn)
            return;

        this.#isShadowOn = isOn;
        this.#rasterizeAgain();
    }

    isDropShadowEnabled() { return this.#isShadowOn; }

    // The shadow is offsetX / offsetY design units from the text (negative y is down)
    setDropShadowOffset(offsetX, offsetY)
    {
        if (offsetX === this.#shadowOffset.x && offsetY === this.#shadowOffset.y)
            return;

        this.#shadowOffset.setXY(offsetX, offsetY);

        if (this.#isShadowOn === true)
            this.#rasterizeAgain();
    }

    getDropShadowOffset() { return this.#shadowOffset; }

    // Its own Material is on Rect2D's default shader; another may not be
    canInstance(material = this.getMaterial())
    {
        return (this.isLoaded() === true && material.getShader() === Rect2D.getDefaultShader());
    }

    // The view scale changed: redraw at the new scale so the text stays sharp
    onRasterScaleChanged(newScale)
    {
        if (this.#text !== null)
            this.#rasterize();
    }

    // Frees the texture and material, and stops listening (the quad is shared). setText() loads it again.
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

    // Draws the text again after a rasterized color or the shadow changed, if it has been drawn
    #rasterizeAgain()
    {
        if (this.#text !== null && this.isLoaded() === true)
            this.#rasterize();
    }

    #rasterize()
    {
        const scale = WGLV.getViewScale();
        const shadow = (this.#isShadowOn === true) ? this.#shadowColor : null;
        const c = TextCanvas.draw(this.#text, this.#font, this.#fontSize, this.#fontWeight, scale,
                                  this.#textColor, shadow, this.#shadowOffset.x, this.#shadowOffset.y);

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

        // Design units; the shared quad is scaled to them when drawn
        const w = c.width / scale;
        const h = c.height / scale;

        if (this.isLoaded() === false || w !== this.getWidth() || h !== this.getHeight())
            this._setSize(w, h); // Keeps the alignment

        this._setMesh(Text2D.#getQuad(), true);
        this._setMaterial(this.#material);
        this._setLoaded(true);
        this.listenForRasterScale(true);
            return true;
    }

    // The unit quad every Text2D draws, made the first time
    static #getQuad()
    {
        if (Text2D.#kQuad === null)
        {
            let quad = Shapes.makeUnitQuad();
            quad.bindAttribs();
            Text2D.#kQuad = quad;
        }

        return Text2D.#kQuad;
    }

    // Copies color into target; returns true if it changed
    static #copyColor(target, color)
    {
        if (target.x === color.x && target.y === color.y && target.z === color.z && target.w === color.w)
            return false;

        target.set(color);
            return true;
    }
}

/*
    TextGlyphs2D - Text built from a TextAtlas's glyphs: one quad per
    character, in one mesh, drawn in one call. setText() only rebuilds that
    mesh, so it's cheap to change every frame (a timer, a score). Every
    TextGlyphs2D on the same TextAtlas shares its Material, so Batcher
    draws them one after another with a single bind.

    Like Text2D: sizes and positions are in design units, the glyphs are
    white and the draw color tints them, and its size is the text plus the
    padding around it, so alignment matches Text2D's.

    Raster scale: its TextAtlas draws its glyphs again when the view's scale
    changes and every TextGlyphs2D on it rebuilds its quads, so the text
    stays sharp (see TextAtlas.setFollowsViewScale()).

    Usage:
        let digits = new TextAtlas(font, "0123456789:", 40, "bold");
        let time = new TextGlyphs2D(digits);
        time.setAlignment(Alignment.kMiddleCenter);
        time.setText("12:34"); // isLoaded() is true once this succeeds
        ...
        time.render(new Transform2D(400, 300), null, yellow);

    Characters missing from the TextAtlas draw as its fallback "?". The
    TextAtlas belongs to the caller; unload it after the TextGlyphs2Ds.

    Line breaks: "\n" (or "\r\n") starts a new line, one line height below
    the last. Its size is the widest line by every line, and
    setLineAlignment() lines up the shorter ones by an Alignment's column
    (left, center or right; the row doesn't matter). Left by default, and
    kept through unload() and setText(). Line breaks aren't glyphs:
    they have no quad and aren't counted by getGlyphCount(), so glyph
    indices run over the other characters only, line after line.

        label.setLineAlignment(Alignment.kMiddleCenter); // Any center one
        label.setText("GAME\nOVER");

    Each glyph can be changed on its own (see BaseTextEffect):
        setGlyphOffsets()  Moves it
        setGlyphScales()   Scales it about its own center
        setGlyphColors()   Tints it; multiplied with the draw color
    Each only re-uploads its own vertex data. setText() clears all three.
    getGlyphX() / getGlyphY() / getGlyphWidth() / getGlyphHeight() say
    where each glyph's quad is before any of them.

    It draws with its own shader (getDefaultShader(): Rect2D's plus a color
    per vertex), which TextAtlas gives its Material.
*/
class TextGlyphs2D extends Model2D
{
    #textAtlas;
    #text;
    #mesh;         // The mesh given to the base, kept to update its positions and colors
    #positions;    // Each glyph quad's corners as laid out (x, y, z per vertex)
    #moved;        // Scratch for #positions with the offsets and scales
    #offsets;      // x, y per glyph, or null for none
    #scales;       // sx, sy per glyph, or null for none
    #colors;       // r, g, b, a per vertex, uploaded as a_color
    #glyphCount;   // Quads with a character; line breaks aren't counted
    #lineCount;
    #lineAlign;    // Alignment; only its column is used. Kept through unload()
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
        this.#offsets = null;
        this.#scales = null;
        this.#colors = null;
        this.#glyphCount = 0;
        this.#lineCount = 0;
        this.#lineAlign = Alignment.kBottomLeft;
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

    // Characters in the text, line breaks left out (each one quad)
    getGlyphCount() { return this.#glyphCount; }

    // Lines in the text (1 for text without line breaks); 0 before setText()
    getLineCount() { return this.#lineCount; }

    /*
        Lines up lines shorter than the widest by align's column (Alignment:
        left, center or right; the row doesn't matter). Rebuilds the quads if
        the text is set. Returns false if align isn't valid.
    */
    setLineAlignment(align)
    {
        if (Alignment.isValid(align) === false)
        {
            console.error("TextGlyphs2D.setLineAlignment() needs an Alignment");
                return false;
        }

        const changed = (Alignment.getColumn(align) !== Alignment.getColumn(this.#lineAlign));
        this.#lineAlign = align;

        if (changed === false)
            return true;

        if (this.#text !== null && this.isLoaded() === true)
            return this.#buildMesh(this.#text);

        return true;
    }

    getLineAlignment() { return this.#lineAlign; }

    /*
        Moves each glyph by (x, y) design units from where the text puts it:
        offsets holds x, y pairs, one per glyph (getGlyphCount()), or is null to
        put them all back. The values are copied. The size and alignment don't
        change. Returns false if not loaded or offsets is too short.
    */
    setGlyphOffsets(offsets)
    {
        if (this.isLoaded() === false || this.#mesh === null)
            return false;

        if (offsets === null)
        {
            this.#offsets = null;
                return this.#uploadPositions();
        }

        if (offsets.length < this.#glyphCount * 2)
        {
            console.error(`TextGlyphs2D.setGlyphOffsets() needs ${this.#glyphCount * 2} values (x, y per glyph)`);
                return false;
        }

        if (this.#offsets === null)
            this.#offsets = new Float32Array(this.#glyphCount * 2);

        for (let i = 0; i < this.#offsets.length; ++i)
            this.#offsets[i] = offsets[i];

        return this.#uploadPositions();
    }

    /*
        Scales each glyph about its own center: scales holds sx, sy pairs, one
        per glyph (1 is its normal size), or is null to put them all back. The
        values are copied. The size and alignment don't change. Returns false
        if not loaded or scales is too short.
    */
    setGlyphScales(scales)
    {
        if (this.isLoaded() === false || this.#mesh === null)
            return false;

        if (scales === null)
        {
            this.#scales = null;
                return this.#uploadPositions();
        }

        if (scales.length < this.#glyphCount * 2)
        {
            console.error(`TextGlyphs2D.setGlyphScales() needs ${this.#glyphCount * 2} values (sx, sy per glyph)`);
                return false;
        }

        if (this.#scales === null)
            this.#scales = new Float32Array(this.#glyphCount * 2);

        for (let i = 0; i < this.#scales.length; ++i)
            this.#scales[i] = scales[i];

        return this.#uploadPositions();
    }

    /*
        Tints each glyph: colors holds r, g, b, a (0 - 1), one set per glyph,
        multiplied with the draw color; null makes them all white again.
        Returns false if not loaded or colors is too short.
    */
    setGlyphColors(colors)
    {
        if (this.isLoaded() === false || this.#mesh === null)
            return false;

        if (colors !== null && colors.length < this.#glyphCount * 4)
        {
            console.error(`TextGlyphs2D.setGlyphColors() needs ${this.#glyphCount * 4} values (r, g, b, a per glyph)`);
                return false;
        }

        let out = this.#colors;

        if (colors === null)
            out.fill(1.0);
        else
        {
            for (let i = 0; i < this.#glyphCount; ++i)
            {
                const c = i * 4;

                for (let corner = 0; corner < 4; ++corner)
                {
                    const v = (i * 16) + (corner * 4);
                    out[v] = colors[c];
                    out[v + 1] = colors[c + 1];
                    out[v + 2] = colors[c + 2];
                    out[v + 3] = colors[c + 3];
                }
            }
        }

        return this.#mesh.updateVertexData(RenderAttributes.kColor, out);
    }

    // Where glyph index's quad is as laid out (before offsets and scales), in design units from the text's bottom-left; 0 if out of range
    getGlyphX(index) { return this.#glyphCorner(index, 0, 0); }
    getGlyphY(index) { return this.#glyphCorner(index, 0, 1); }
    getGlyphWidth(index) { return this.#glyphCorner(index, 2, 0) - this.#glyphCorner(index, 0, 0); }
    getGlyphHeight(index) { return this.#glyphCorner(index, 2, 1) - this.#glyphCorner(index, 0, 1); }

    // Frees the mesh; the TextAtlas belongs to the caller. setText() loads it again.
    unload()
    {
        super.unload();
        this.#textAtlas?.removeRasterizeListener(this.#onAtlasRasterized);
        this.#text = null;
        this.#mesh = null;
        this.#positions = null;
        this.#moved = null;
        this.#offsets = null;
        this.#scales = null;
        this.#colors = null;
        this.#glyphCount = 0;
        this.#lineCount = 0;
    }

    // Rect2D's shader plus a color per vertex (see TextGlyphs2DShaderSource); shared by every TextAtlas
    static getDefaultShader()
    {
        return ShaderManager.get(TextGlyphs2DShaderSource);
    }

    // *** Internal Methods ***

    /*
        One quad per character, each its glyph's whole cell, placed side by side
        by advance width from the left padding. Its UVs are the glyph's
        AtlasSubTexture rect in the atlas, so it draws with the atlas Texture as is.
    */
    #buildMesh(text)
    {
        const ta = this.#textAtlas;
        const lines = TextGlyphs2D.#splitLines(text);
        const height = ta.getLineHeight();

        // Each line's advance width, the widest, and the glyph count
        let lineWidths = [];
        let widest = 0.0;
        let glyphCount = 0;

        for (const line of lines)
        {
            let w = 0.0;

            for (const char of line)
                w += ta.getGlyph(char).advance;

            lineWidths.push(w);
            widest = Math.max(widest, w);
            glyphCount += line.length;
        }

        const quadCount = Math.max(1, glyphCount); // Empty text: one empty quad, so it still has a mesh and a size
        const lineShift = Alignment.getColumn(this.#lineAlign) / 2.0; // 0 left, 0.5 center, 1 right, of the space a line leaves

        let pos = new Float32Array(quadCount * 4 * 3);
        let uvs = new Float32Array(quadCount * 4 * 2);
        let indices = ((quadCount * 4) > 65535) ? new Uint32Array(quadCount * 6) : new Uint16Array(quadCount * 6);
        let i = 0; // Glyph (quad) index

        for (let l = 0; l < lines.length; ++l)
        {
            const bottom = (lines.length - 1 - l) * height; // The first line is at the top
            const top = bottom + height;
            let penX = (widest - lineWidths[l]) * lineShift; // Each cell's left edge: the advances so far (the cell holds the left padding)

            for (const char of lines[l])
            {
                const glyph = ta.getGlyph(char);
                const r = glyph.subTexture.getUVRect();
                const left = penX;
                const right = penX + glyph.width;
                const v = i * 4;

                // 3 - 2
                // |   |
                // 0 - 1
                pos.set([left, bottom, 0.0,  right, bottom, 0.0,  right, top, 0.0,  left, top, 0.0], i * 12);
                uvs.set([r.getLeft(), r.getBottom(),  r.getRight(), r.getBottom(),  r.getRight(), r.getTop(),  r.getLeft(), r.getTop()], i * 8);
                indices.set([v, v + 1, v + 2,  v + 2, v + 3, v], i * 6);

                penX += glyph.advance;
                ++i;
            }
        }

        if (glyphCount === 0)
            indices.set([0, 1, 2,  2, 3, 0], 0); // All corners at (0, 0): draws nothing

        let colors = new Float32Array(quadCount * 4 * 4).fill(1.0); // White: no tint of its own
        let mesh = new StaticMesh();

        if (mesh.setVertexData(RenderAttributes.kPosition, pos) === false || mesh.setVertexData(RenderAttributes.kUV0, uvs) === false ||
            mesh.setVertexData(RenderAttributes.kColor, colors) === false || mesh.setIndexData(indices) === false)
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
        this.#offsets = null;
        this.#scales = null;
        this.#colors = colors;
        this.#glyphCount = glyphCount;
        this.#lineCount = lines.length;
        this._setSize(widest + (ta.getPadding() * 2.0), height * lines.length); // Keeps the alignment
        this._setMaterial(ta.getMaterial());
        this._setLoaded(true);

        // Rebuild when the atlas draws its glyphs again (e.g. at a new view scale)
        ta.addRasterizeListener(this.#onAtlasRasterized);
            return true;
    }

    // Uploads the laid-out positions with the offsets and scales applied (each glyph scaled about its center, then moved)
    #uploadPositions()
    {
        if (this.#offsets === null && this.#scales === null)
            return this.#mesh.updateVertexData(RenderAttributes.kPosition, this.#positions);

        const base = this.#positions;
        const offsets = this.#offsets;
        const scales = this.#scales;
        let moved = this.#moved;

        for (let i = 0; i < this.#glyphCount; ++i)
        {
            const q = i * 12;
            const dx = (offsets !== null) ? offsets[i * 2] : 0.0;
            const dy = (offsets !== null) ? offsets[(i * 2) + 1] : 0.0;
            const sx = (scales !== null) ? scales[i * 2] : 1.0;
            const sy = (scales !== null) ? scales[(i * 2) + 1] : 1.0;
            const cx = (base[q] + base[q + 6]) * 0.5;     // Corner 0 and corner 2
            const cy = (base[q + 1] + base[q + 7]) * 0.5;

            for (let corner = 0; corner < 4; ++corner)
            {
                const p = q + (corner * 3);
                moved[p] = cx + ((base[p] - cx) * sx) + dx;
                moved[p + 1] = cy + ((base[p + 1] - cy) * sy) + dy;
                moved[p + 2] = base[p + 2];
            }
        }

        return this.#mesh.updateVertexData(RenderAttributes.kPosition, moved);
    }

    // text split at "\n" / "\r\n", each line an array of its characters (code points); always at least one line
    static #splitLines(text)
    {
        return text.split(/\r?\n/).map((line) => Array.from(line));
    }

    // One value (axis 0 x, 1 y) of a corner (0 bottom-left, 2 top-right) of glyph index's laid-out quad; 0 if out of range
    #glyphCorner(index, corner, axis)
    {
        if (this.#positions === null || Number.isInteger(index) === false || index < 0 || index >= this.#glyphCount)
            return 0.0;

        return this.#positions[(index * 12) + (corner * 3) + axis];
    }
}
