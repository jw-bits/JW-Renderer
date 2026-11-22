"use strict";

/*
    MaterialBatcher - Collects Model2Ds (Rect2D, Text2D, ...) during a frame,
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
        let batcher = new MaterialBatcher(); // After WGLV.init()

        // Each frame
        batcher.submit(boardRect, 0);
        piece.setPos(x, y);
        batcher.submit(piece, 2);  // The same model can be submitted again...
        piece.setPos(x2, y2);
        batcher.submit(piece, 2);  // ...with different values each time
        batcher.submit(label, 5);  // A Text2D
        batcher.render();          // Draws everything and empties the batcher

    submit() captures the model's transform (position, scale, rotation), color and UV rect
    (a Sprite's frame) at that moment, so one model can be drawn many times per
    frame (like a board square).
    Its size, mesh and Material are read when it's drawn, so don't unload or
    reload a model between submit() and render().

    Anything else that draws itself (e.g. Particles2D) can go on a layer with
    submitDrawable(obj, layer): obj.render() is called after that layer's
    models, in submission order. Nothing is captured; it draws as it is then.
*/
class MaterialBatcher
{
    static kMinLayer = 0;
    static kMaxLayer = 7;
    static kLayerCount = 8;

    static #kFloatsPerInstance = 15; // Rect (4), scale + rotation (3), color (4), UV rect (4)
    static #kStartCapacity = 64;     // Instances; grows as needed

    #layers;      // Per layer: the submitted entries
    #groups;      // Per layer: group key (texture key string for instanced, else the Material) -> group number, in order of first submission
    #drawables;   // Per layer: objects with render(), drawn after the layer's models
    #pool;        // Entry objects reused from frame to frame
    #poolUsed;

    // Instanced Rect2D drawing; null shader if it couldn't be set up (every model is drawn on its own then)
    #instShader;
    #instResLocation;
    #instMesh;
    #instData;
    #instCapacity;

    #drawCalls;     // Draw calls made by the last render()

    constructor()
    {
        this.#layers = [];
        this.#groups = [];
        this.#drawables = [];

        for (let i = 0; i < MaterialBatcher.kLayerCount; ++i)
        {
            this.#layers.push([]);
            this.#groups.push(new Map());
            this.#drawables.push([]);
        }

        this.#pool = [];
        this.#poolUsed = 0;

        this.#instShader = null;
        this.#instResLocation = null;
        this.#instMesh = new InstancedQuadMesh();
        this.#instData = null;
        this.#instCapacity = 0;

        this.#drawCalls = 0;

        if (this.#setupInstancing() === false)
            console.error("MaterialBatcher couldn't set up instanced drawing; Rect2Ds will be drawn one at a time");
    }

    /*
        Queues a Model2D (including Text2D) for the next render(), on a layer from 0
        (back) to 7 (front). Returns false if it isn't loaded or the layer isn't valid.
    */
    submit(model, layer = 0)
    {
        if (Number.isInteger(layer) === false || layer < MaterialBatcher.kMinLayer || layer > MaterialBatcher.kMaxLayer)
        {
            console.error(`MaterialBatcher.submit(): layer must be ${MaterialBatcher.kMinLayer} - ${MaterialBatcher.kMaxLayer}`);
                return false;
        }

        if ((model instanceof Model2D) === false)
        {
            console.error("MaterialBatcher.submit() needs a Model2D (Rect2D, Text2D, ...)");
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
        e.transform.copy(model.getTransform());
        e.transform.setPosition(model.getX(), model.getY()); // Drawn from the bottom-left corner, not the anchor (see Model2D.draw())

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
        if (Number.isInteger(layer) === false || layer < MaterialBatcher.kMinLayer || layer > MaterialBatcher.kMaxLayer)
        {
            console.error(`MaterialBatcher.submitDrawable(): layer must be ${MaterialBatcher.kMinLayer} - ${MaterialBatcher.kMaxLayer}`);
                return false;
        }

        if (typeof drawable?.render !== "function")
        {
            console.error("MaterialBatcher.submitDrawable() needs an object with a render() method");
                return false;
        }

        this.#drawables[layer].push(drawable);
            return true;
    }

    // Draws everything submitted since the last render(), back layer to front, then empties the batcher
    render()
    {
        this.#drawCalls = 0;

        for (let l = 0; l < MaterialBatcher.kLayerCount; ++l)
        {
            this.#renderModels(this.#layers[l]);

            for (const d of this.#drawables[l])
            {
                d.render();
                ++this.#drawCalls; // Counted as one, though a drawable may draw more or nothing
            }
        }

        this.clear();
    }

    // Drops everything submitted without drawing it
    clear()
    {
        for (let l = 0; l < MaterialBatcher.kLayerCount; ++l)
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

        if (this.#instShader !== null)
            this.#instShader.unload();

        this.#instShader = null;
        this.#instData = null;
        this.#instCapacity = 0;
    }

    // *** Internal Methods ***

    // Draws one layer's models, grouped by Material
    #renderModels(list)
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
                this.#drawInstanced(list, i, end);
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

    // Draws quads sharing textures and samplers in one instanced call
    #drawInstanced(list, start, end)
    {
        const gl = WGLV.context;
        const count = end - start;
        const stride = MaterialBatcher.#kFloatsPerInstance;

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

        // Any Material in the group binds the same textures and samplers; then switch to the instanced shader
        list[start].material.bind();
        this.#instShader.bind();
        gl.uniform2f(this.#instResLocation, WGLV.getWidth(), WGLV.getHeight());

        this.#instMesh.updateInstanceData(d, 0, count * stride);
        this.#instMesh.render(count);

        ++this.#drawCalls;
    }

    // Makes room for count instances, on the CPU and GPU
    #reserve(count)
    {
        if (count <= this.#instCapacity)
            return;

        let capacity = Math.max(this.#instCapacity, MaterialBatcher.#kStartCapacity);

        while (capacity < count)
            capacity *= 2;

        this.#instData = new Float32Array(capacity * MaterialBatcher.#kFloatsPerInstance);
        this.#instCapacity = capacity;
        this.#instMesh.setInstanceData(this.#instData);
    }

    #setupInstancing()
    {
        const gl = WGLV.context;
        let shader = new Shader();

        if (shader.load(Rect2DInstancedShaderSource.VS, Rect2DInstancedShaderSource.FS) === false)
            return false;

        this.#instResLocation = shader.getUniform("u_res");

        // Texture unit 0 never changes; uniform values stay with the program
        shader.bind();
        gl.uniform1i(shader.getUniform("u_tex0"), 0);

        // Unit quad (0,0) - (1,1), shared by every instance, plus the interleaved per-instance values
        const attribs = [
            [Rect2DInstancedShaderSource.kRectLocation, 4, 0],
            [Rect2DInstancedShaderSource.kScaleRotLocation, 3, 4],
            [Rect2DInstancedShaderSource.kColorLocation, 4, 7],
            [Rect2DInstancedShaderSource.kUVRectLocation, 4, 11]
        ];

        if (this.#instMesh.load(new Float32Array([0, 0,  1, 0,  1, 1,  0, 1]), MaterialBatcher.#kFloatsPerInstance, attribs) === false)
        {
            shader.unload();
                return false;
        }

        this.#instShader = shader;
        this.#reserve(MaterialBatcher.#kStartCapacity);
            return true;
    }
}
