"use strict";

/*
    Skeleton2D - Plays and draws a Spine skeleton: a Model2D, so an Entity can
    hold it (its transform, hierarchy, color and motion all apply) and a
    Batcher can draw it. Engine code, not a port; it follows spine-webgl
    4.0's SkeletonRenderer.draw().

    Usage:
        const data = await SpineSkeletonData.load(jsonUrl, name, atlasUrl);
        let model = new Skeleton2D();
        model.load(data);                          // After WGLV.init()

        model.setDefaultMix(0.2);                  // Crossfades (setMix() for a pair)
        model.setAnimation(0, "walk", true);       // Track 0; higher tracks layer over it
        model.addAnimation(0, "jump", false, 2.0); // Queued: 2 seconds after walk starts
        model.setEventCallback((skeleton2D, entry, type, event) => {
            if (type === SpineEventType.event && event.data.name === "footstep") ...
        });

        // Each frame
        model.update(dt);                          // Or entity.update(dt), with entity.setModel(model)
        batcher.submit(model, transform, layer);   // Or entity.submit(batcher, layer)

    Playing: each Skeleton2D has a SpineAnimationState (getAnimationState())
    and its SpineAnimationStateData; update(dt) moves it on and poses the
    skeleton. To pose by hand instead, change getSkeleton() (a SpineSkeleton),
    call its updateWorldTransform(), and don't call update().

    Each draw walks the draw order and writes every region and mesh
    attachment's triangles into one streaming DynamicMesh, as position, UV
    and color, then draws it in runs: a new run starts when the page or the
    blend mode changes. A skeleton on one page with normal and additive slots
    is one draw.

    Placing it: vertices are in the skeleton's own units, as posed (its x, y
    and scale included). The draw transform then turns and scales it about
    its origin and puts the origin at the transform's position. It has no
    size, so the alignment changes nothing and containsPoint() is always
    false.

    Color: every vertex is skeleton color x slot color x attachment color,
    premultiplied. The color it's drawn with (an Entity's) multiplies that in
    the shader, so one pose can be drawn in many colors.

    Blend modes (slot.data.blendMode), with the shader always giving
    premultiplied color (Skeleton2DShaderSource):
        Normal     BlendMode.kPremultiplied
        Additive   BlendMode.kPremultiplied with vertex alpha 0: adds, and shares the normal run
        Multiply   BlendMode.kMultiply
        Screen     Not yet; drawn as Normal, reported once

    Not drawn yet: clipping attachments (reported once; what they'd clip is
    drawn whole) and two-color tint (the dark color is ignored).

    Batching: draw() binds its own Materials (bindsOwnMaterials()), one per
    page and blend mode from MaterialManager, so a Batcher forgets what it
    had bound after drawing one. getDrawCount() is the draws its last draw()
    made. Each draw() rebuilds the stream from the pose as it is then.
*/
class Skeleton2D extends Model2D
{
    static #kQuadTriangles = [0, 1, 2, 2, 3, 0];
    static #kFloatsPerVertex = 8; // x, y, u, v, r, g, b, a
    static #kPosition = new Vector4();
    static #kScaleRot = new Vector3();
    static #kPageFlags = new Vector4();

    #skeleton;     // SpineSkeleton
    #mesh;         // DynamicMesh, given to the base
    #vertices;     // Float32Array: the stream, grown as needed
    #indices;      // Uint32Array
    #world;        // Float32Array: one attachment's world vertices (x, y pairs)
    #vertexCount;
    #indexCount;
    #runs;         // { page, blendMode, firstIndex, indexCount }, reused; #runCount of them are this stream's
    #runCount;
    #materials;    // TextureAtlas (page) -> [kPremultiplied Material, kMultiply Material]
    #drawCount;
    #reported;     // Set of what's been reported once ("clipping", "screen")
    #stateData;    // SpineAnimationStateData: the mixes
    #state;        // SpineAnimationState: what plays
    #eventCallback; // (skeleton2D, entry, SpineEventType, event) or null

    constructor()
    {
        super();

        this.#skeleton = null;
        this.#mesh = null;
        this.#vertices = new Float32Array(1024 * Skeleton2D.#kFloatsPerVertex);
        this.#indices = new Uint32Array(3072);
        this.#world = new Float32Array(256);
        this.#vertexCount = 0;
        this.#indexCount = 0;
        this.#runs = [];
        this.#runCount = 0;
        this.#materials = new Map();
        this.#drawCount = 0;
        this.#reported = new Set();
        this.#stateData = null;
        this.#state = null;
        this.#eventCallback = null;
    }

    /*
        Makes a SpineSkeleton of skeletonData (a SpineSkeletonData, see
        SpineSkeletonData.load()) in its setup pose, and the mesh to draw it.
        Returns false if it's already loaded, the data has no images, or the
        shader or mesh can't be built.
    */
    load(skeletonData)
    {
        if (this.isLoaded() === true)
            return false; // Unload first

        if ((skeletonData instanceof SpineSkeletonData) === false)
        {
            console.error("Skeleton2D.load() needs a SpineSkeletonData");
                return false;
        }

        const page = Skeleton2D.#findFirstPage(skeletonData);

        if (page === null)
        {
            console.error(`Skeleton2D.load(): "${skeletonData.name}" has no region or mesh attachments with an atlas page`);
                return false;
        }

        let mesh = new DynamicMesh();

        if (mesh.load([[RenderAttributes.kPosition, 2], [RenderAttributes.kUV0, 2], [RenderAttributes.kColor, 4]]) === false)
        {
            console.error("Skeleton2D.load() couldn't build its mesh");
                return false;
        }

        this.#mesh = mesh;
        this.#materials.clear();

        // The base's own Material: the first page, normal blending (what Batcher groups it by)
        const material = this.#getMaterial(page, BlendMode.kPremultiplied);

        if (material === null)
        {
            mesh.unload();
            this.#mesh = null;
                return false;
        }

        let skeleton = new SpineSkeleton(skeletonData);
        skeleton.setToSetupPose();
        skeleton.updateWorldTransform();

        this.#stateData = new SpineAnimationStateData(skeletonData);
        this.#state = new SpineAnimationState(this.#stateData);
        this.#state.setEventCallback((state, entry, type, event) => {
            if (this.#eventCallback !== null)
                this.#eventCallback(this, entry, type, event);
        });

        this.#skeleton = skeleton;
        this._setSize(0.0, 0.0);
        this._setMaterial(material);
        this._setMesh(mesh);
        this._setLoaded(true);
            return true;
    }

    // The SpineSkeleton it draws, to pose (null before load()). Call its updateWorldTransform() after changing it.
    getSkeleton() { return this.#skeleton; }

    // The SpineAnimationState that plays its animations, and its SpineAnimationStateData (the mixes); null before load()
    getAnimationState() { return this.#state; }
    getAnimationStateData() { return this.#stateData; }

    // *** Playing ***

    /*
        Moves its animations dt seconds on and poses the skeleton with them: the state's
        update(dt), its apply(), then the skeleton's updateWorldTransform(). An Entity
        holding it calls this from its own update(dt). Skip it to pose the skeleton by
        hand (it would put the state's pose over it).
    */
    update(dt)
    {
        if (this.isLoaded() === false || Number.isFinite(dt) === false || dt < 0.0)
            return;

        this.#skeleton.update(dt);
        this.#state.update(dt);
        this.#state.apply(this.#skeleton);
        this.#skeleton.updateWorldTransform();
    }

    /*
        Plays the animation named name on track (0 up; higher tracks layer over lower
        ones) now, mixing from what was playing, and drops anything queued on it.
        Returns its SpineTrackEntry (to change its timeScale, alpha, mixDuration ...),
        or null if it isn't loaded or has no such animation.
    */
    setAnimation(track, name, loop = true)
    {
        const animation = this.#findAnimation(name, "setAnimation");

        if (animation === null || this.#isTrack(track, "setAnimation") === false)
            return null;

        return this.#state.setAnimationWith(track, animation, loop);
    }

    /*
        Queues the animation named name on track, after what's playing or queued there.
        delay is seconds after the last one starts; 0 or less is measured from its end
        (less the mix). Returns its SpineTrackEntry, or null as for setAnimation().
    */
    addAnimation(track, name, loop = true, delay = 0.0)
    {
        const animation = this.#findAnimation(name, "addAnimation");

        if (animation === null || this.#isTrack(track, "addAnimation") === false)
            return null;

        return this.#state.addAnimationWith(track, animation, loop, delay);
    }

    // Mixes track out to the setup pose (or the tracks under it) over mixSeconds. Returns its SpineTrackEntry, or null.
    setEmptyAnimation(track, mixSeconds = 0.0)
    {
        if (this.isLoaded() === false || this.#isTrack(track, "setEmptyAnimation") === false)
            return null;

        return this.#state.setEmptyAnimation(track, mixSeconds);
    }

    // Stops track, leaving the skeleton as it is (setEmptyAnimation() mixes it out instead)
    clearTrack(track)
    {
        if (this.isLoaded() === true && this.#isTrack(track, "clearTrack") === true)
            this.#state.clearTrack(track);
    }

    // The SpineTrackEntry playing on track, or null
    getCurrent(track) { return (this.isLoaded() === true) ? this.#state.getCurrent(track) : null; }

    // Seconds to mix from the animation named from to the one named to. Returns false if either isn't found.
    setMix(from, to, seconds)
    {
        const a = this.#findAnimation(from, "setMix");
        const b = this.#findAnimation(to, "setMix");

        if (a === null || b === null)
            return false;

        this.#stateData.setMixWith(a, b, Math.max(0.0, seconds));
            return true;
    }

    // Seconds to mix between animations without a setMix() of their own (0 at first)
    setDefaultMix(seconds)
    {
        if (this.isLoaded() === true)
            this.#stateData.defaultMix = Math.max(0.0, seconds);
    }

    getDefaultMix() { return this.#stateData?.defaultMix ?? 0.0; }

    // Speeds up (> 1) or slows down (< 1) every track and mix; 0 pauses
    setTimeScale(scale)
    {
        if (this.isLoaded() === false || Number.isFinite(scale) === false || scale < 0.0)
        {
            console.error("Skeleton2D.setTimeScale() needs load() first, and a scale of 0 or more");
                return false;
        }

        this.#state.timeScale = scale;
            return true;
    }

    getTimeScale() { return this.#state?.timeScale ?? 1.0; }

    /*
        callback(skeleton2D, entry, SpineEventType, event), or null for none: each track
        entry's start, interrupt, end, dispose and complete, and each keyed event (event
        is its SpineEvent: event.data.name, intValue, floatValue, stringValue; null for
        the others). Called from update(); it may call setAnimation() and the rest.
    */
    setEventCallback(callback) { this.#eventCallback = (typeof callback === "function") ? callback : null; }

    // Shows the skin named name (its attachments over the default skin's), from the setup pose's attachments. Returns false if there's no such skin.
    setSkin(name)
    {
        const skin = (this.isLoaded() === true) ? this.#skeleton.data.findSkin(name) : null;

        if (skin === null)
        {
            console.error(`Skeleton2D.setSkin(): no skin named "${name}"`);
                return false;
        }

        this.#skeleton.setSkin(skin);
        this.#skeleton.setSlotsToSetupPose();
            return true;
    }

    // The bone named name (a SpineBone: worldX, worldY, getWorldRotationX() ...), or null
    findBone(name) { return (this.isLoaded() === true && typeof name === "string") ? this.#skeleton.findBone(name) : null; }

    // True: draw() binds its own Materials, one per page and blend mode (see Batcher)
    bindsOwnMaterials() { return true; }

    // Draw calls the last draw() made
    getDrawCount() { return this.#drawCount; }

    /*
        Draws the skeleton as it's posed now, its origin at transform's position,
        turned and scaled by it, tinted color. uvRect and material are ignored: it
        draws with its own Materials, which it binds.
    */
    draw(transform, color, uvRect = null, material = null)
    {
        this.#drawCount = 0;

        if (this.isLoaded() === false)
            return;

        this._fillStream();

        if (this.#indexCount === 0 || this.#mesh.setData(this.#vertices, this.#vertexCount, this.#indices, this.#indexCount) === false)
            return;

        Skeleton2D.#kPosition.setXYZW(transform.getX(), transform.getY(), 0.0, 0.0);
        Skeleton2D.#kScaleRot.setXYZ(transform.getScaleX(), transform.getScaleY(), transform.getRotation());

        for (let i = 0; i < this.#runCount; ++i)
        {
            const run = this.#runs[i];
            const m = this.#getMaterial(run.page, run.blendMode);

            if (m === null)
                continue;

            Skeleton2D.#kPageFlags.setXYZW(run.page.isPremultiplied() ? 1.0 : 0.0, 0.0, 0.0, 0.0);

            m.bind();
            m.setUniform("u_color", color ?? Vector4.kWhite);
            m.setUniform("u_vec0", Skeleton2D.#kPosition);
            m.setUniform("u_scale", Skeleton2D.#kScaleRot);
            m.setUniform("u_vec1", Skeleton2D.#kPageFlags);

            this.#mesh.render(run.firstIndex, run.indexCount);
            ++this.#drawCount;
        }
    }

    // Frees the mesh; the skeleton data, atlas and Materials (MaterialManager's) belong to the caller. load() can be called again.
    unload()
    {
        super.unload(); // Unloads the mesh
        this.#state?.setEventCallback(null);
        this.#state = null;
        this.#stateData = null;
        this.#skeleton = null;
        this.#mesh = null;
        this.#materials.clear();
        this.#vertexCount = 0;
        this.#indexCount = 0;
        this.#runCount = 0;
        this.#drawCount = 0;
    }

    // Skeleton2D's shader (see Skeleton2DShaderSource), shared by every Skeleton2D
    static getDefaultShader()
    {
        return ShaderManager.get(Skeleton2DShaderSource);
    }

    /*
        For draw() and tests: writes the skeleton's triangles, as posed now, into the
        stream, on the CPU only. Returns it, read-only: { vertices (x, y, u, v, r, g, b, a
        each; u, v in Spine's terms, V down), vertexCount, indices, indexCount, runs
        (runCount of { page, blendMode, firstIndex, indexCount }), runCount }.
    */
    _fillStream()
    {
        const skeleton = this.#skeleton;
        const sc = skeleton.color;
        const stride = Skeleton2D.#kFloatsPerVertex;

        this.#vertexCount = 0;
        this.#indexCount = 0;
        this.#runCount = 0;

        let run = null;

        for (const slot of skeleton.drawOrder)
        {
            if (slot.bone.active === false)
                continue;

            const a = slot.getAttachment();
            let count = 0;
            let triangles = null;

            if (a instanceof SpineRegionAttachment)
            {
                count = 4;
                triangles = Skeleton2D.#kQuadTriangles;
                a.computeWorldVertices(slot.bone, this.#world, 0, 2);
            }
            else if (a instanceof SpineMeshAttachment)
            {
                const n = a.worldVerticesLength;

                if (this.#world.length < n)
                    this.#world = new Float32Array(n * 2);

                count = n >> 1;
                triangles = a.triangles;
                a.computeWorldVertices(slot, 0, n, this.#world, 0, 2);
            }
            else
            {
                if (a instanceof SpineClippingAttachment)
                    this.#reportOnce("clipping", `Skeleton2D: "${skeleton.data.name}" has clipping attachments, which aren't drawn yet; what they clip is drawn whole`);

                continue;
            }

            if ((a.region instanceof AtlasSubTexture) === false)
                continue; // No image (Spine's "if (texture)")

            // skeleton x slot x attachment, premultiplied
            const slotColor = slot.color;
            const ac = a.color;
            const alpha = sc.w * slotColor.w * ac.w;
            const r = sc.x * slotColor.x * ac.x * alpha;
            const g = sc.y * slotColor.y * ac.y * alpha;
            const b = sc.z * slotColor.z * ac.z * alpha;
            let vertexAlpha = alpha;
            let blendMode = BlendMode.kPremultiplied;

            switch (slot.data.blendMode)
            {
                case SpineBlendMode.Additive:
                    vertexAlpha = 0.0; // ONE, ONE under kPremultiplied
                    break;

                case SpineBlendMode.Multiply:
                    blendMode = BlendMode.kMultiply;
                    break;

                case SpineBlendMode.Screen:
                    this.#reportOnce("screen", `Skeleton2D: "${skeleton.data.name}" has screen-blended slots, which draw as normal for now`);
                    break;
            }

            const page = a.region.getAtlas();

            if (run === null || run.page !== page || run.blendMode !== blendMode)
                run = this.#startRun(page, blendMode);

            this.#reserve(count, triangles.length);

            // Vertices
            const uvs = a.uvs;
            const world = this.#world;
            let v = this.#vertices;
            let o = this.#vertexCount * stride;

            for (let i = 0; i < count; ++i)
            {
                v[o++] = world[i * 2];
                v[o++] = world[(i * 2) + 1];
                v[o++] = uvs[i * 2];
                v[o++] = uvs[(i * 2) + 1];
                v[o++] = r;
                v[o++] = g;
                v[o++] = b;
                v[o++] = vertexAlpha;
            }

            // Indices, after the vertices so far
            const base = this.#vertexCount;
            let ind = this.#indices;

            for (let i = 0; i < triangles.length; ++i)
                ind[this.#indexCount + i] = base + triangles[i];

            this.#vertexCount += count;
            this.#indexCount += triangles.length;
            run.indexCount += triangles.length;
        }

        return {
            vertices: this.#vertices, vertexCount: this.#vertexCount,
            indices: this.#indices, indexCount: this.#indexCount,
            runs: this.#runs, runCount: this.#runCount
        };
    }

    // *** Internal Methods ***

    // A run from the current index, reusing an old object
    #startRun(page, blendMode)
    {
        if (this.#runCount === this.#runs.length)
            this.#runs.push({ page: null, blendMode: 0, firstIndex: 0, indexCount: 0 });

        let run = this.#runs[this.#runCount++];
        run.page = page;
        run.blendMode = blendMode;
        run.firstIndex = this.#indexCount;
        run.indexCount = 0;
            return run;
    }

    // Room for vertexCount more vertices and indexCount more indices, keeping what's there
    #reserve(vertexCount, indexCount)
    {
        const floats = (this.#vertexCount + vertexCount) * Skeleton2D.#kFloatsPerVertex;

        if (floats > this.#vertices.length)
        {
            let grown = new Float32Array(Math.max(floats, this.#vertices.length * 2));
            grown.set(this.#vertices.subarray(0, this.#vertexCount * Skeleton2D.#kFloatsPerVertex));
            this.#vertices = grown;
        }

        const indices = this.#indexCount + indexCount;

        if (indices > this.#indices.length)
        {
            let grown = new Uint32Array(Math.max(indices, this.#indices.length * 2));
            grown.set(this.#indices.subarray(0, this.#indexCount));
            this.#indices = grown;
        }
    }

    // The Material for page (a Spine page's TextureAtlas) and blendMode, made once (shared through MaterialManager); null on failure
    #getMaterial(page, blendMode)
    {
        let pair = this.#materials.get(page);

        if (pair === undefined)
        {
            pair = [null, null];
            this.#materials.set(page, pair);
        }

        const i = (blendMode === BlendMode.kMultiply) ? 1 : 0;

        if (pair[i] === null)
        {
            const shader = Skeleton2D.getDefaultShader();

            if (shader === null)
            {
                console.error("Skeleton2D: its shader couldn't be built");
                    return null;
            }

            pair[i] = MaterialManager.load(shader, [page.getTexture()], [page.getSampler()], blendMode);

            if (pair[i] === null)
                return null;
        }

        return pair[i];
    }

    // The animation named name, or null (reported, naming methodName) if it isn't loaded or there's none
    #findAnimation(name, methodName)
    {
        const animation = (this.isLoaded() === true && typeof name === "string") ? this.#skeleton.data.findAnimation(name) : null;

        if (animation === null)
            console.error(`Skeleton2D.${methodName}(): no animation named "${name}"${(this.isLoaded() === false) ? " (not loaded)" : ""}`);

        return animation;
    }

    #isTrack(track, methodName)
    {
        if (Number.isInteger(track) === true && track >= 0)
            return true;

        console.error(`Skeleton2D.${methodName}() needs a track of 0 or more`);
            return false;
    }

    #reportOnce(kind, message)
    {
        if (this.#reported.has(kind) === true)
            return;

        this.#reported.add(kind);
        console.error(message);
    }

    // The atlas page of the first region or mesh attachment in any skin, or null
    static #findFirstPage(skeletonData)
    {
        for (const skin of skeletonData.skins)
        {
            for (const entry of skin.getAttachments())
            {
                const region = entry.attachment?.region ?? null;

                if (region instanceof AtlasSubTexture)
                    return region.getAtlas();
            }
        }

        return null;
    }
}
