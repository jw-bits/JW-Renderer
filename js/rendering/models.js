/*
    Model2D - Base class for textured 2D shapes drawn in design units (see WGL).

    Holds the per-object state (position, size, scale, rotation, color), the
    material and mesh, the setters/getters, render() and unload().

    Each subclass does its own loading, two ways:
        load(texture, ...)   A Texture; the subclass creates a Material with its own default shader.
        load(material, ...)  A loaded Material, used as is. It only holds the shader, textures
                             and samplers, so many models can share one (see MaterialManager).

    Uniform values live here, not in the Material: render() binds the
    material, then uploads this model's u_res, u_color, u_vec0 and u_scale.

    A subclass's load() builds the mesh, binds it to the material, then hands
    both to the base with the "_" setters below (for subclasses only).
*/
class Model2D
{
    // Scratch values for uploading uniforms in render()
    static #kRes = new Vector2();
    static #kRect = new Vector4();
    static #kScaleRot = new Vector3();

    #position;
    #material;
    #width;
    #height;
    #mesh;
    #scaleX;
    #scaleY;
    #rotZ;
    #color;
    #isLoaded;

    constructor()
    {
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
    }

    // (x, y) is the bottom-left corner
    setPos(x, y) { this.#position.set(x, y); }
    setRotation(rotZ) { this.#rotZ = rotZ; }

    setScale(sx, sy = sx)
    {
        this.#scaleX = sx;
        this.#scaleY = sy;
    }

    setColor(color) { this.#color.set(color.x, color.y, color.z, color.w); }

    getPos() { return this.#position; }
    getX() { return this.#position.x; }
    getY() { return this.#position.y; }
    getWidth() { return this.#width; }
    getHeight() { return this.#height; }
    getScaleX() { return this.#scaleX; }
    getScaleY() { return this.#scaleY; }
    getRotation() { return this.#rotZ; }
    getColor() { return this.#color; }
    getMaterial() { return this.#material; }
    isLoaded() { return this.#isLoaded; }

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

        Model2D.#kRes.set(WGL.getWidth(), WGL.getHeight());
        Model2D.#kRect.set(x, y, this.#width / 2.0, this.#height / 2.0);
        Model2D.#kScaleRot.set(scaleX, scaleY, rotZ);

        m.setUniform("u_res", Model2D.#kRes);
        m.setUniform("u_color", color);
        m.setUniform("u_vec0", Model2D.#kRect);
        m.setUniform("u_scale", Model2D.#kScaleRot);

        this.#mesh.render();
    }

    // Frees the mesh; the material and texture belong to the caller. load() can be called again afterwards.
    unload()
    {
        if (this.#mesh !== null)
        {
            this.#mesh.unload();
            this.#mesh = null;
        }

        this.#material = null;
        this.#isLoaded = false;
    }

    // *** For subclasses ***

    _setSize(width, height)
    {
        this.#width = width;
        this.#height = height;
    }

    _setMaterial(material) { this.#material = material; }

    // The mesh must already be bound to the material
    _setMesh(mesh) { this.#mesh = mesh; }

    _setLoaded(isLoaded) { this.#isLoaded = isLoaded; }
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

        mesh.bindMaterial(material);
        this._setSize(w, h);
        this._setMaterial(material);
        this._setMesh(mesh);
        this._setLoaded(true);
            return true;
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

        mesh.bindMaterial(material);
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

        mesh.bindMaterial(material);
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

class Particles2D
{
    static #VS = `#version 300 es
        layout(location = 5) in vec3 a_pos;

        uniform vec2 u_res;

        void main() {
            vec2 zTo1 = a_pos.xy / u_res;
            vec2 cs = (zTo1 * 2.0) - 1.0;

            gl_PointSize = 64.0;
            gl_Position = vec4(cs, 0.0, 1.0);
        }
    `;

    static #FS = `#version 300 es
        precision highp float;

        uniform sampler2D u_tex0;
        uniform vec4 u_color;
        out vec4 fragColor;

        void main() {
            vec4 c = texture(u_tex0, gl_PointCoord);
            fragColor = c * u_color;
        }
    `;

    //  static #FS = `
    //      precision highp float;

    //      void main() {
    //          gl_FragColor = vec4(0.0, 1.0, 0.0, 1.0);
    //      }
    //  `;

     // Shader
     static #kShader = null;

     #material;
     #mesh;

     #emitPosition;
     #duration;
     #useGravity;
     #isLoaded;
     #isRunning;

     #deltaTime;
     #positions;
     #velocities;

     constructor()
     {
         this.#material = null;
         this.#mesh = null;

         this.#emitPosition = new Vector2();
         this.#duration = 0.0;
         this.#useGravity = false;
         this.#isLoaded = false;
         this.#isRunning = false;

         this.#deltaTime = 0.0;
         this.#positions = [];
         this.#velocities = [];
     }

     load(_particleCount, _texture, _emitPosition, _duration, _useGravity)
     {
        if (Particles2D.#kShader === null)
        {
            Particles2D.#kShader = new Shader();

            if (Particles2D.#kShader.load(Particles2D.#VS, Particles2D.#FS) === false)
                return false;
        }

        let ta = [_texture];
        this.#material = new Material();
        this.#mesh = new PointsMesh();

        if (this.#material.load(Particles2D.#kShader, ta) === false)
            return false;

        this.#positions = new Float32Array(_particleCount * 3);
        this.#positions.fill(0.0);

        this.#velocities = new Array(_particleCount);

        if (this.#mesh.set(this.#positions) === false)
            return false;

        this.#emitPosition = _emitPosition;
        this.#duration = _duration;
        this.#useGravity = _useGravity;
        this.#isLoaded = true;
            return true;
     }

     // Takes a function to do the initilization logic for the positions/veleociies of the particles
     // initFunc
     // (
     //     origin, -- A Vector2 of where the particles should emit from
     //     poistions[], -- A Float32Array[] of (x,y,z) tightly packed
     //     velocities[] -- An array of Vector2
     // )
     start(initFunc)
     {
        if (this.#isLoaded === false || this.#isRunning === true)
            return false;

        initFunc(this.#emitPosition, this.#positions, this.#velocities);

        this.#mesh.set(this.#positions);

        this.#isRunning = true;
        this.#deltaTime = 0.0;
            return true;
     }

     stop()
     {
        this.#isRunning = false;
     }

     update(dt)
     {
        if (this.#isRunning === true)
        {
            this.#deltaTime += dt;

            if (this.#deltaTime > this.#duration)
                this.stop();
            else
            {
                let pIdx = 0;
                let gravityForce = (this.#useGravity === true) ? -9.8 : 0.0;

                for (let i = 0; i < this.#velocities.length; ++i)
                {
                    let v = this.#velocities[i];

                    this.#positions[pIdx + 0] += (v.x * dt);
                    this.#positions[pIdx + 1] += ((v.y * dt) + (gravityForce * dt));
                    this.#positions[pIdx + 2] = 0.0;

                    pIdx += 3;
                }

                this.#mesh.set(this.#positions);
            }
        }
     }

     render()
     {
        if (this.#isRunning === true)
        {
            this.#material.bind();
            this.#material.setUniform("u_res", new Vector2(WGL.getWidth(), WGL.getHeight()));
            this.#material.setUniform("u_color", Vector4.kWhite);
            this.#mesh.render();
        }
     }
}
