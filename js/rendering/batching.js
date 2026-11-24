"use strict";

/*
    Batcher - Collects Model2Ds (Rect2D, Text2D, ...) during a frame,
    then draws them all in one go, layer by layer, grouped by Material.

    Layers run 0 - 7: 0 is drawn first (farthest back), 7 last (top-most).
    Within a layer, models are drawn in groups, binding once per group:
        - Instanced: models that canInstance() (Rect2D, Text2D, Sprite) are grouped
          by their textures and samplers (Material.getTextureKey()), whatever their
          Material's shader, and each group is a single instanced draw call. So a
          Sprite and a Rect2D drawing the same atlas share one call.
        - Everything else is grouped by Material and drawn one model at a time.

    Order: layers are always drawn in order, and within one group the
    submission order is kept. Different groups in the same layer may be
    drawn in any order, so use separate layers for things that must overlap
    a certain way (e.g. board 0, pieces 2, UI 5).

    Usage:
        let batcher = new Batcher(); // After WGLV.init()

        // Each frame
        batcher.submit(boardRect, 0);
        piece.setPos(x, y);
        batcher.submit(piece, 2);  // The same model can be submitted again...
        piece.setPos(x2, y2);
        batcher.submit(piece, 2);  // ...with different values each time
        batcher.submit(label, 5);  // A Text2D
        batcher.render();          // Draws everything and empties the batcher

    submit() captures the model's transform (position, scale, rotation, with its
    parents' applied: see Model2D.getDrawTransform()), color and UV rect (a
    Sprite's frame) at that moment, so one model can be drawn many times per
    frame (like a board square).
    Its size, mesh and Material are read when it's drawn, so don't unload or
    reload a model between submit() and render().

    Anything else that draws itself (e.g. Particles2D) can go on a layer with
    submitDrawable(obj, layer): obj.render() is called after that layer's
    models, in submission order. Nothing is captured; it draws as it is then.

    Lighting: setLayerLit(layer, true) lights every instanced model on that
    layer with the LightSet's lights (see lighting.js), still one draw call per
    group. A layer is all lit or not lit at all. Models keep their usual
    Materials: the batcher swaps its instanced shader for a lit one. A group
    whose Material has a second texture uses it as the normal map. Models
    drawn one at a time (RoundedRect2D, NinePatch2D, custom shaders) and
    drawables draw as they always do. Call LightSet.apply() each frame before
    render().

    Camera: setCamera(camera) gives the batcher one Camera2D. Every layer
    follows it (drawn through it, in world units) unless
    setLayerFollowsCamera(layer, false) makes the layer ignore it and draw in
    screen design units, e.g. the UI and HUD over a scrolling world. With no
    camera every layer draws in screen design units. render() leaves
    ClipSpace's camera as it found it.

        batcher.setCamera(camera);
        batcher.setLayerFollowsCamera(Layers.kUI, false);

    Post effects: setLayerPost(first, last, chain) draws layers first - last
    into a PostChain (post_effects.js), which runs its effects and draws the
    result back after the last of them, so later layers (a HUD, say) are left
    out. Ranges can nest (a bloom range inside a whole-screen CRT range) but
    not overlap otherwise, and a chain can only have one range. A render()
    with nothing on any of a range's layers skips its chain.

        batcher.setLayerPost(Layers.kWorld, Layers.kEffects, bloomChain);
        batcher.setLayerPost(Batcher.kMinLayer, Batcher.kMaxLayer, crtChain); // Everything

    Blend modes: each Material's (see BlendMode); models with different
    modes never share an instanced draw.

    CachedLayer (below) draws a batch once into a RenderTarget and shows it
    each frame as one textured rect.
*/
class Batcher
{
    static kMinLayer = 0;
    static kMaxLayer = 7;
    static kLayerCount = 8;

    static #kFloatsPerInstance = 15; // Rect (4), scale + rotation (3), color (4), UV rect (4)
    static #kStartCapacity = 64;     // Instances; grows as needed

    #layers;      // Per layer: the submitted entries
    #groups;      // Per layer: group key (texture key string for instanced, else the Material) -> group number, in order of first submission
    #drawables;   // Per layer: objects with render(), drawn after the layer's models
    #litLayers;   // Per layer: true if its instanced models are lit
    #ignoresCamera; // Per layer: true if it draws in screen design units whatever the camera
    #camera;      // Camera2D the layers follow, or null
    #postRanges;  // { first, last, chain, isRunning }: PostChains around ranges of layers
    #postBegins;  // Per layer: ranges to begin before it, outermost first
    #postEnds;    // Per layer: ranges to end after it, innermost first
    #pool;        // Entry objects reused from frame to frame
    #poolUsed;

    // Instanced Rect2D drawing; null shader if it couldn't be set up (every model is drawn on its own then)
    #instShader;
    #instMesh;
    #instData;
    #instCapacity;

    // Lit instanced drawing (LightSet's shaders): [one texture, with a normal map], each
    // a Shader; null until first needed, false if it couldn't be built
    #litShaders;

    #drawCalls;     // Draw calls made by the last render()

    constructor()
    {
        this.#layers = [];
        this.#groups = [];
        this.#drawables = [];
        this.#litLayers = [];
        this.#ignoresCamera = [];
        this.#camera = null;
        this.#postRanges = [];
        this.#postBegins = [];
        this.#postEnds = [];

        for (let i = 0; i < Batcher.kLayerCount; ++i)
        {
            this.#layers.push([]);
            this.#groups.push(new Map());
            this.#drawables.push([]);
            this.#litLayers.push(false);
            this.#ignoresCamera.push(false);
            this.#postBegins.push([]);
            this.#postEnds.push([]);
        }

        this.#litShaders = [null, null];

        this.#pool = [];
        this.#poolUsed = 0;

        this.#instShader = null;
        this.#instMesh = new InstancedQuadMesh();
        this.#instData = null;
        this.#instCapacity = 0;

        this.#drawCalls = 0;

        if (this.#setupInstancing() === false)
            console.error("Batcher couldn't set up instanced drawing; Rect2Ds will be drawn one at a time");
    }

    /*
        Queues a Model2D (including Text2D) for the next render(), on a layer from 0
        (back) to 7 (front). Returns false if it isn't loaded or the layer isn't valid.
    */
    submit(model, layer = 0)
    {
        if (Number.isInteger(layer) === false || layer < Batcher.kMinLayer || layer > Batcher.kMaxLayer)
        {
            console.error(`Batcher.submit(): layer must be ${Batcher.kMinLayer} - ${Batcher.kMaxLayer}`);
                return false;
        }

        if ((model instanceof Model2D) === false)
        {
            console.error("Batcher.submit() needs a Model2D (Rect2D, Text2D, ...)");
                return false;
        }

        if (model.isLoaded() === false)
            return false; // e.g. a Text2D before its text is set

        const material = model.getMaterial();
        const instanced = (this.#instShader !== null && model.canInstance() === true);
        const key = instanced ? material.getTextureKey() : material; // Strings and Materials never collide as Map keys
        let groups = this.#groups[layer];
        let group = groups.get(key);

        if (group === undefined)
        {
            group = groups.size;
            groups.set(key, group);
        }

        let e = this.#nextEntry();
        e.model = model;
        e.material = material;
        e.group = group;
        e.instanced = instanced;
        e.uvRect.copy(model.getUVRect());
        model.getDrawTransform(e.transform); // In the world, from the bottom-left corner, not the anchor (see Model2D.draw())

        const c = model.getColor();
        e.color.set(c.x, c.y, c.z, c.w);

        this.#layers[layer].push(e);
            return true;
    }

    /*
        Queues anything with a render() method (e.g. Particles2D) on a layer. It's drawn
        after that layer's models, as it is at render() time. Returns false if it has no
        render() or the layer isn't valid.
    */
    submitDrawable(drawable, layer = 0)
    {
        if (Number.isInteger(layer) === false || layer < Batcher.kMinLayer || layer > Batcher.kMaxLayer)
        {
            console.error(`Batcher.submitDrawable(): layer must be ${Batcher.kMinLayer} - ${Batcher.kMaxLayer}`);
                return false;
        }

        if (typeof drawable?.render !== "function")
        {
            console.error("Batcher.submitDrawable() needs an object with a render() method");
                return false;
        }

        this.#drawables[layer].push(drawable);
            return true;
    }

    /*
        Lights every instanced model on a layer (true) or none of them (false, the
        default). Kept until changed; clear() and render() leave it alone. Returns
        false if the layer isn't valid.
    */
    setLayerLit(layer, lit)
    {
        if (Number.isInteger(layer) === false || layer < Batcher.kMinLayer || layer > Batcher.kMaxLayer)
        {
            console.error(`Batcher.setLayerLit(): layer must be ${Batcher.kMinLayer} - ${Batcher.kMaxLayer}`);
                return false;
        }

        this.#litLayers[layer] = (lit === true);
            return true;
    }

    isLayerLit(layer) { return (this.#litLayers[layer] === true); }

    // The Camera2D the layers follow, or null for none (every layer in screen design units). Kept until changed.
    setCamera(camera)
    {
        if (camera !== null && (camera instanceof Camera2D) === false)
        {
            console.error("Batcher.setCamera() needs a Camera2D or null");
                return false;
        }

        this.#camera = camera;
            return true;
    }

    getCamera() { return this.#camera; }

    /*
        Whether a layer draws through the camera (true, the default) or ignores it and
        draws in screen design units (false). Kept until changed. Returns false if the
        layer isn't valid.
    */
    setLayerFollowsCamera(layer, follows)
    {
        if (Number.isInteger(layer) === false || layer < Batcher.kMinLayer || layer > Batcher.kMaxLayer)
        {
            console.error(`Batcher.setLayerFollowsCamera(): layer must be ${Batcher.kMinLayer} - ${Batcher.kMaxLayer}`);
                return false;
        }

        this.#ignoresCamera[layer] = (follows === false);
            return true;
    }

    doesLayerFollowCamera(layer) { return (this.#ignoresCamera[layer] !== true); }

    /*
        Draws layers first - last through a loaded PostChain (see the top of this file).
        Kept until clearLayerPost(). Returns false (changing nothing) if the range isn't
        valid, overlaps another without nesting, or the chain already has a range.
    */
    setLayerPost(first, last, chain)
    {
        const isLayer = (l) => (Number.isInteger(l) === true && l >= Batcher.kMinLayer && l <= Batcher.kMaxLayer);

        if (isLayer(first) === false || isLayer(last) === false || first > last)
        {
            console.error(`Batcher.setLayerPost(): first and last must be layers ${Batcher.kMinLayer} - ${Batcher.kMaxLayer}, first <= last`);
                return false;
        }

        if ((chain instanceof PostChain) === false || chain.isLoaded() === false)
        {
            console.error("Batcher.setLayerPost() needs a loaded PostChain");
                return false;
        }

        for (const r of this.#postRanges)
        {
            const isApart = (last < r.first || first > r.last);
            const isNested = ((first >= r.first && last <= r.last) || (r.first >= first && r.last <= last));

            if (r.chain === chain)
            {
                console.error("Batcher.setLayerPost(): that chain already has a range; clearLayerPost() it first");
                    return false;
            }

            if (isApart === false && (isNested === false || (first === r.first && last === r.last)))
            {
                console.error(`Batcher.setLayerPost(): ${first} - ${last} overlaps ${r.first} - ${r.last}; ranges can only nest`);
                    return false;
            }
        }

        this.#postRanges.push({ first: first, last: last, chain: chain, isRunning: false });
        this.#sortPostRanges();
            return true;
    }

    // Stops drawing through chain
    clearLayerPost(chain)
    {
        this.#postRanges = this.#postRanges.filter((r) => r.chain !== chain);
        this.#sortPostRanges();
    }

    // The PostChain whose range starts at first and ends at last, or null
    getLayerPost(first, last) { return this.#postRanges.find((r) => r.first === first && r.last === last)?.chain ?? null; }

    // Draws everything submitted since the last render(), back layer to front, then empties the batcher
    render()
    {
        this.#drawCalls = 0;

        const before = ClipSpace.getCamera(); // Put back afterwards

        for (let l = 0; l < Batcher.kLayerCount; ++l)
        {
            for (const r of this.#postBegins[l])
                r.isRunning = (this.#hasAnything(r.first, r.last) === true && r.chain.begin() === true);

            if (this.#layers[l].length > 0 || this.#drawables[l].length > 0)
            {
                ClipSpace.setCamera((this.#ignoresCamera[l] === true) ? null : this.#camera);
                this.#renderModels(this.#layers[l], this.#litLayers[l]);

                for (const d of this.#drawables[l])
                {
                    d.render();
                    ++this.#drawCalls; // Counted as one, though a drawable may draw more or nothing
                }
            }

            for (const r of this.#postEnds[l])
            {
                if (r.isRunning === true)
                    r.chain.end();

                r.isRunning = false;
            }
        }

        ClipSpace.setCamera(before);
        this.clear();
    }

    // Drops everything submitted without drawing it
    clear()
    {
        for (let l = 0; l < Batcher.kLayerCount; ++l)
        {
            this.#layers[l].length = 0;
            this.#groups[l].clear();
            this.#drawables[l].length = 0;
        }

        for (let i = 0; i < this.#poolUsed; ++i)
        {
            this.#pool[i].model = null; // Don't keep models alive
            this.#pool[i].material = null;
        }

        this.#poolUsed = 0;
    }

    // Draw calls the last render() made
    getDrawCallCount() { return this.#drawCalls; }

    // Frees the GPU objects; the batcher can't be used afterwards
    unload()
    {
        this.clear();

        this.#instMesh.unload();

        this.#instShader = null; // ShaderManager's, shared; left loaded
        this.#instData = null;
        this.#instCapacity = 0;
        this.#litShaders = [null, null]; // LightSet's; shared, so left loaded
    }

    // *** Internal Methods ***

    // Per layer, the ranges to begin (outermost, the longest, first) and end (innermost first)
    #sortPostRanges()
    {
        for (let l = 0; l < Batcher.kLayerCount; ++l)
        {
            this.#postBegins[l] = this.#postRanges.filter((r) => r.first === l).sort((a, b) => (b.last - b.first) - (a.last - a.first));
            this.#postEnds[l] = this.#postRanges.filter((r) => r.last === l).sort((a, b) => (a.last - a.first) - (b.last - b.first));
        }
    }

    // True if anything was submitted on layers first - last
    #hasAnything(first, last)
    {
        for (let l = first; l <= last; ++l)
        {
            if (this.#layers[l].length > 0 || this.#drawables[l].length > 0)
                return true;
        }

        return false;
    }

    // Draws one layer's models, grouped by Material; lit lights the instanced groups
    #renderModels(list, lit)
    {
        if (list.length === 0)
            return;

        // Stable sort: groups in order of first submission, submission order kept inside each group
        list.sort((a, b) => a.group - b.group);

        let i = 0;

        while (i < list.length)
        {
            // One group: all instanced with the same textures, or all the same Material drawn one at a time
            const group = list[i].group;
            let end = i + 1;

            while (end < list.length && list[end].group === group)
                ++end;

            if (list[i].instanced === true)
                this.#drawInstanced(list, i, end, lit);
            else
                this.#drawEach(list, i, end);

            i = end;
        }
    }

    #nextEntry()
    {
        if (this.#poolUsed === this.#pool.length)
        {
            this.#pool.push({
                model: null, material: null, group: 0, instanced: false,
                transform: new Transform2D(), color: new Vector4(), uvRect: new UVRect()
            });
        }

        return this.#pool[this.#poolUsed++];
    }

    // Binds the Material once, then draws each model with its captured values
    #drawEach(list, start, end)
    {
        list[start].material.bind();

        for (let i = start; i < end; ++i)
        {
            const e = list[i];
            e.model.draw(e.transform, e.color, e.uvRect);
            ++this.#drawCalls;
        }
    }

    // Draws quads sharing textures and samplers in one instanced call; lit uses a lit shader
    #drawInstanced(list, start, end, lit)
    {
        const count = end - start;
        const stride = Batcher.#kFloatsPerInstance;

        this.#reserve(count);

        let d = this.#instData;
        let o = 0;

        for (let i = start; i < end; ++i)
        {
            const e = list[i];
            const m = e.model;
            const t = e.transform;

            d[o++] = t.getX();
            d[o++] = t.getY();
            d[o++] = m.getWidth() / 2.0;
            d[o++] = m.getHeight() / 2.0;
            d[o++] = t.getScaleX();
            d[o++] = t.getScaleY();
            d[o++] = t.getRotation();
            d[o++] = e.color.x;
            d[o++] = e.color.y;
            d[o++] = e.color.z;
            d[o++] = e.color.w;
            d[o++] = e.uvRect.getX();
            d[o++] = e.uvRect.getY();
            d[o++] = e.uvRect.getWidth();
            d[o++] = e.uvRect.getHeight();
        }

        // Any Material in the group has the same textures and samplers; bind just those, then the instanced shader
        const material = list[start].material;
        let shader = this.#instShader;

        if (lit === true)
        {
            const litShader = this.#getLitShader(material.getTexture(1) !== null); // Texture 1 is the normal map

            if (litShader !== false)
                shader = litShader;
        }

        material.bind(false, true);
        shader.bind(); // Positions reach the screen through the Frame block (ClipSpace)

        this.#instMesh.updateInstanceData(d, 0, count * stride);
        this.#instMesh.render(count);

        ++this.#drawCalls;
    }

    // Makes room for count instances, on the CPU and GPU
    #reserve(count)
    {
        if (count <= this.#instCapacity)
            return;

        let capacity = Math.max(this.#instCapacity, Batcher.#kStartCapacity);

        while (capacity < count)
            capacity *= 2;

        this.#instData = new Float32Array(capacity * Batcher.#kFloatsPerInstance);
        this.#instCapacity = capacity;
        this.#instMesh.setInstanceData(this.#instData);
    }

    // LightSet's lit instanced shader, set up the first time; false (drawn unlit) if it can't be built
    #getLitShader(withNormalMap)
    {
        const i = (withNormalMap === true) ? 1 : 0;

        if (this.#litShaders[i] === null)
        {
            const gl = WGLV.context;
            const shader = (withNormalMap === true) ? LightSet.getInstancedNormalMapShader() : LightSet.getInstancedShader();

            if (shader === null)
            {
                console.error("Batcher: a lit shader couldn't be built; lit layers will draw unlit");
                this.#litShaders[i] = false;
            }
            else
            {
                // Texture units never change; uniform values stay with the program
                shader.bind();
                gl.uniform1i(shader.getUniform("u_tex0"), 0);
                gl.uniform1i(shader.getUniform("u_tex1"), 1); // null location (no normal map) is ignored

                this.#litShaders[i] = shader;
            }
        }

        return this.#litShaders[i];
    }

    #setupInstancing()
    {
        const gl = WGLV.context;
        const shader = ShaderManager.get(Rect2DInstancedShaderSource); // Shared by every batcher

        if (shader === null)
            return false;

        // Texture unit 0 never changes; uniform values stay with the program
        shader.bind();
        gl.uniform1i(shader.getUniform("u_tex0"), 0);

        // Unit quad (0,0) - (1,1), shared by every instance, plus the interleaved per-instance values
        const attribs = [
            [InstancedAttributes.kRect, 0],
            [InstancedAttributes.kScaleRot, 4],
            [InstancedAttributes.kColor, 7],
            [InstancedAttributes.kVector0, 11] // UV rect
        ];

        if (this.#instMesh.load(new Float32Array([0, 0,  1, 0,  1, 1,  0, 1]), Batcher.#kFloatsPerInstance, attribs) === false)
            return false; // The shader is ShaderManager's; left loaded

        this.#instShader = shader;
        this.#reserve(Batcher.#kStartCapacity);
            return true;
    }
}

/*
    CachedLayer - Something that changes rarely (a panel of UI, a static
    background) drawn once into its own target, then shown each frame as a
    single textured rect: one draw call however much it holds.

        let panel = new CachedLayer();
        panel.load(100, 600, 500, 300);              // Design units: what it covers on the screen

        // Each frame
        panel.update(() => {                         // Draws only when needed (see below)
            uiBatcher.submit(...);
            uiBatcher.render();
        });
        panel.submit(batcher, Layers.kUI);           // Or panel.render()

        panel.markDirty();                           // After changing what it shows

    It's drawn again when marked dirty, when the view scale changes (so it
    stays sharp: its pixel size is its design size times the view scale) and
    after its contents are lost (a lost context). The draw function draws in
    screen design units; only what falls inside the layer's rect is kept.
*/
class CachedLayer
{
    #target;
    #rect;        // Rect2D showing the target's texture
    #area;        // Vector4: x, y, width, height in design units
    #isDirty;
    #drawnScale;  // The view scale it was last drawn at
    #drawnVersion;

    constructor()
    {
        this.#target = new RenderTarget();
        this.#rect = new Rect2D();
        this.#area = new Vector4();
        this.#isDirty = true;
        this.#drawnScale = 0.0;
        this.#drawnVersion = -1;
    }

    /*
        Covers the design rect (x, y, width, height). options: { format, samples } as for
        RenderTarget (samples smooths shapes' edges). Returns false on failure.
    */
    load(x, y, width, height, options = null)
    {
        if (Number.isFinite(x) === false || Number.isFinite(y) === false || Number.isFinite(width) === false ||
            Number.isFinite(height) === false || width <= 0.0 || height <= 0.0)
        {
            console.error("CachedLayer.load() needs a position and a size above 0");
                return false;
        }

        const size = CachedLayer.#pixelSize(width, height);

        if (this.#target.loadFixed(size.width, size.height, options) === false)
            return false;

        this.#target.setDesignRect(x, y, width, height);
        this.#area.set(x, y, width, height);

        const material = MaterialManager.load(Rect2D.getDefaultShader(), [this.#target.getTexture()], null, BlendMode.kPremultiplied);

        if (material === null || this.#rect.load(material, width, height) === false)
        {
            console.error("CachedLayer.load() couldn't make the rect that shows it");
            this.#target.unload();
                return false;
        }

        this.#rect.setPos(x, y);
        this.#isDirty = true;
            return true;
    }

    // Draws it again on the next update()
    markDirty() { this.#isDirty = true; }

    // True if the next update() will draw
    needsRedraw()
    {
        return (this.#isDirty === true || this.#drawnScale !== WGLV.getViewScale() || this.#drawnVersion !== this.#target.getVersion());
    }

    // Calls drawFn (which draws in screen design units) into the layer if it needs drawing. Returns true if it drew.
    update(drawFn)
    {
        if (this.#target.isLoaded() === false || this.needsRedraw() === false)
            return false;

        // Sharp at the view's scale
        const scale = WGLV.getViewScale();

        if (scale !== this.#drawnScale)
        {
            const size = CachedLayer.#pixelSize(this.#area.z, this.#area.w);
            this.#target.resize(size.width, size.height);
        }

        if (RenderTargets.push(this.#target) === false)
            return false;

        drawFn();
        RenderTargets.pop();

        this.#isDirty = false;
        this.#drawnScale = scale;
        this.#drawnVersion = this.#target.getVersion();
            return true;
    }

    // Queues the layer on a batcher layer (one instanced quad)
    submit(batcher, layer) { return batcher.submit(this.#rect, layer); }

    render() { this.#rect.render(); }

    // The Rect2D showing it (e.g. to tint or fade it with setColor()); don't load it again
    getRect2D() { return this.#rect; }
    getTarget() { return this.#target; }

    unload()
    {
        this.#rect.unload();
        this.#target.unload();
        this.#isDirty = true;
        this.#drawnScale = 0.0;
    }

    // *** Internal Methods ***

    static #pixelSize(width, height)
    {
        const scale = WGLV.getViewScale();
            return { width: Math.max(1, Math.ceil(width * scale)), height: Math.max(1, Math.ceil(height * scale)) };
    }
}
