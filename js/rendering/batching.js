"use strict";

/*
    MaterialBatcher - Collects Model2Ds (and Text2Ds) during a frame, then
    draws them all in one go, layer by layer, grouped by Material.

    Layers run 0 - 7: 0 is drawn first (farthest back), 7 last (top-most).
    Within a layer, everything sharing a Material is drawn together, so the
    Material is bound once per group. Rect2Ds whose Material uses Rect2D's
    default shader (see Rect2D.getDefaultShader()) go one step further: each
    group of them is a single instanced draw call.

    Order: layers are always drawn in order, and within one Material the
    submission order is kept. Different Materials in the same layer may be
    drawn in any order, so use separate layers for things that must overlap
    a certain way (e.g. board 0, pieces 2, UI 5).

    Usage:
        let batcher = new MaterialBatcher(); // After WGL.init()

        // Each frame
        batcher.submit(boardRect, 0);
        piece.setPos(x, y);
        batcher.submit(piece, 2);  // The same model can be submitted again...
        piece.setPos(x2, y2);
        batcher.submit(piece, 2);  // ...with different values each time
        batcher.submit(label, 5);  // Text2D works too
        batcher.render();          // Draws everything and empties the batcher

    submit() captures the model's position, scale, rotation and color at that
    moment, so one model can be drawn many times per frame (like a board square).
    Its size, mesh and Material are read when it's drawn, so don't unload or
    reload a model between submit() and render().
*/
class MaterialBatcher
{
    static kMinLayer = 0;
    static kMaxLayer = 7;
    static kLayerCount = 8;

    static #kFloatsPerInstance = 11; // Rect (4), scale + rotation (3), color (4)
    static #kStartCapacity = 64;     // Instances; grows as needed

    #layers;      // Per layer: the submitted entries
    #groups;      // Per layer: Material -> group number, in order of first submission
    #pool;        // Entry objects reused from frame to frame
    #poolUsed;

    // Instanced Rect2D drawing; null shader if it couldn't be set up (every model is drawn on its own then)
    #instShader;
    #instResLocation;
    #instVao;
    #quadBuffer;
    #indexBuffer;
    #instBuffer;
    #instData;
    #instCapacity;

    #drawCalls;     // Draw calls made by the last render()

    constructor()
    {
        this.#layers = [];
        this.#groups = [];

        for (let i = 0; i < MaterialBatcher.kLayerCount; ++i)
        {
            this.#layers.push([]);
            this.#groups.push(new Map());
        }

        this.#pool = [];
        this.#poolUsed = 0;

        this.#instShader = null;
        this.#instResLocation = null;
        this.#instVao = null;
        this.#quadBuffer = null;
        this.#indexBuffer = null;
        this.#instBuffer = null;
        this.#instData = null;
        this.#instCapacity = 0;

        this.#drawCalls = 0;

        if (this.#setupInstancing() === false)
            console.error("MaterialBatcher couldn't set up instanced drawing; Rect2Ds will be drawn one at a time");
    }

    /*
        Queues a Model2D or Text2D for the next render(), on a layer from 0 (back)
        to 7 (front). Returns false if it isn't loaded or the layer isn't valid.
    */
    submit(item, layer = 0)
    {
        if (Number.isInteger(layer) === false || layer < MaterialBatcher.kMinLayer || layer > MaterialBatcher.kMaxLayer)
        {
            console.error(`MaterialBatcher.submit(): layer must be ${MaterialBatcher.kMinLayer} - ${MaterialBatcher.kMaxLayer}`);
                return false;
        }

        let model = null;

        if (item instanceof Text2D)
            model = item.getModel(); // null until the text is set
        else if (item instanceof Model2D)
            model = item;
        else
        {
            console.error("MaterialBatcher.submit() needs a Model2D or Text2D");
                return false;
        }

        if (model === null || model.isLoaded() === false)
            return false;

        const material = model.getMaterial();
        let groups = this.#groups[layer];
        let group = groups.get(material);

        if (group === undefined)
        {
            group = groups.size;
            groups.set(material, group);
        }

        let e = this.#nextEntry();
        e.model = model;
        e.material = material;
        e.group = group;
        e.instanced = (this.#instShader !== null && model instanceof Rect2D && material.getShader() === Rect2D.getDefaultShader());
        e.x = model.getX();
        e.y = model.getY();
        e.scaleX = model.getScaleX();
        e.scaleY = model.getScaleY();
        e.rotZ = model.getRotation();

        const c = model.getColor();
        e.color.set(c.x, c.y, c.z, c.w);

        this.#layers[layer].push(e);
            return true;
    }

    // Draws everything submitted since the last render(), back layer to front, then empties the batcher
    render()
    {
        this.#drawCalls = 0;

        for (let l = 0; l < MaterialBatcher.kLayerCount; ++l)
        {
            let list = this.#layers[l];

            if (list.length === 0)
                continue;

            // Stable sort: groups in order of first submission, submission order kept inside each group
            list.sort((a, b) => a.group - b.group);

            let i = 0;

            while (i < list.length)
            {
                // A run of entries that are all instanced, or all not, with the same Material
                const material = list[i].material;
                const instanced = list[i].instanced;
                let end = i + 1;

                while (end < list.length && list[end].material === material && list[end].instanced === instanced)
                    ++end;

                if (instanced === true)
                    this.#drawInstanced(list, i, end);
                else
                    this.#drawEach(list, i, end);

                i = end;
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

        const gl = WGL.context;

        if (this.#instVao !== null) gl.deleteVertexArray(this.#instVao);
        if (this.#quadBuffer !== null) gl.deleteBuffer(this.#quadBuffer);
        if (this.#indexBuffer !== null) gl.deleteBuffer(this.#indexBuffer);
        if (this.#instBuffer !== null) gl.deleteBuffer(this.#instBuffer);
        if (this.#instShader !== null) this.#instShader.unload();

        this.#instVao = null;
        this.#quadBuffer = null;
        this.#indexBuffer = null;
        this.#instBuffer = null;
        this.#instShader = null;
        this.#instData = null;
        this.#instCapacity = 0;
    }

    // *** Internal Methods ***

    #nextEntry()
    {
        if (this.#poolUsed === this.#pool.length)
        {
            this.#pool.push({
                model: null, material: null, group: 0, instanced: false,
                x: 0, y: 0, scaleX: 1, scaleY: 1, rotZ: 0, color: new Vector4()
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
            e.model.draw(e.x, e.y, e.scaleX, e.scaleY, e.rotZ, e.color);
            ++this.#drawCalls;
        }
    }

    // Draws Rect2Ds sharing a Material in one instanced call
    #drawInstanced(list, start, end)
    {
        const gl = WGL.context;
        const count = end - start;
        const stride = MaterialBatcher.#kFloatsPerInstance;

        this.#reserve(count);

        let d = this.#instData;
        let o = 0;

        for (let i = start; i < end; ++i)
        {
            const e = list[i];
            const m = e.model;

            d[o++] = e.x;
            d[o++] = e.y;
            d[o++] = m.getWidth() / 2.0;
            d[o++] = m.getHeight() / 2.0;
            d[o++] = e.scaleX;
            d[o++] = e.scaleY;
            d[o++] = e.rotZ;
            d[o++] = e.color.x;
            d[o++] = e.color.y;
            d[o++] = e.color.z;
            d[o++] = e.color.w;
        }

        // The Material binds its textures and samplers; then switch to the instanced shader
        list[start].material.bind();
        this.#instShader.bind();
        gl.uniform2f(this.#instResLocation, WGL.getWidth(), WGL.getHeight());

        gl.bindBuffer(gl.ARRAY_BUFFER, this.#instBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, d, 0, count * stride);

        gl.bindVertexArray(this.#instVao);
        gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_BYTE, 0, count);
        gl.bindVertexArray(null);

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

        const gl = WGL.context;

        this.#instData = new Float32Array(capacity * MaterialBatcher.#kFloatsPerInstance);
        this.#instCapacity = capacity;

        gl.bindBuffer(gl.ARRAY_BUFFER, this.#instBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, this.#instData.byteLength, gl.DYNAMIC_DRAW);
    }

    #setupInstancing()
    {
        const gl = WGL.context;
        let shader = new Shader();

        if (shader.load(Rect2DInstancedShaderSource.VS, Rect2DInstancedShaderSource.FS) === false)
            return false;

        this.#instResLocation = shader.getUniform("u_res");

        // Texture unit 0 never changes; uniform values stay with the program
        shader.bind();
        gl.uniform1i(shader.getUniform("u_tex0"), 0);

        this.#quadBuffer = gl.createBuffer();
        this.#indexBuffer = gl.createBuffer();
        this.#instBuffer = gl.createBuffer();
        this.#instVao = gl.createVertexArray();

        gl.bindVertexArray(this.#instVao);

        // Unit quad, shared by every instance
        const posLocation = RenderAttributes.getLocation(RenderAttributes.kPosition);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.#quadBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0,  1, 0,  1, 1,  0, 1]), gl.STATIC_DRAW);
        gl.vertexAttribPointer(posLocation, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(posLocation);

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.#indexBuffer); // Part of the VAO's state
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint8Array([0, 1, 2,  2, 3, 0]), gl.STATIC_DRAW);

        // Per-instance values, interleaved
        const bytes = 4;
        const strideBytes = MaterialBatcher.#kFloatsPerInstance * bytes;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.#instBuffer);

        const attribs = [
            [Rect2DInstancedShaderSource.kRectLocation, 4, 0],
            [Rect2DInstancedShaderSource.kScaleRotLocation, 3, 4],
            [Rect2DInstancedShaderSource.kColorLocation, 4, 7]
        ];

        for (const [location, size, offset] of attribs)
        {
            gl.vertexAttribPointer(location, size, gl.FLOAT, false, strideBytes, offset * bytes);
            gl.enableVertexAttribArray(location);
            gl.vertexAttribDivisor(location, 1);
        }

        gl.bindVertexArray(null);

        this.#instShader = shader;
        this.#reserve(MaterialBatcher.#kStartCapacity);
            return true;
    }
}
