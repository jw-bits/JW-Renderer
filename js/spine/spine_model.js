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
    size, so the alignment changes nothing.

    Hit tests: hitTest(transform, point) gives the bounding-box attachment
    (SpineBoundingBoxAttachment, e.g. spineboy's "head") under a world point
    with the skeleton drawn at transform, or null; containsPoint() is true when
    there is one, so an Entity's containsPoint() picks a skeleton by its
    bounding boxes. A skeleton with no bounding boxes is never hit. The
    polygons (getHitBounds(), a SpineSkeletonBounds) are cached like the
    bounds below.

    Bounds: getLocalBounds() is the box around the region and mesh
    attachments as posed, unclipped as in spine-core 4.0 (so it can be bigger
    than what's drawn), in skeleton units (SpineSkeleton.getBounds()), and
    getWorldBounds(transform) is that box as drawn at transform (an Entity's
    getWorldBounds() asks it). It's worked out the first time it's asked for
    after a pose change and kept until the next: update(), setSkin() and
    updateAttachments() mark it stale, so call updateAttachments() after
    posing by hand.

    Culling: on a Batcher layer with setLayerCulled(), a skeleton is skipped
    when its getCullBounds() box is out of view. That's the pose's world box
    unless setCullBounds() gives a fixed box in skeleton units (e.g. fitted
    over its animations), which saves working the pose's box out each frame.
    A culled skeleton still moves on and poses in update(); only the draw is
    skipped.

    Attaching to a bone: an Entity that's a child of the entity holding this
    Skeleton2D can follow one of its bones, e.g. a weapon in a hand:

        holder.setModel(model);                    // holder: an Entity
        holder.addChild(sword);                    // sword: an Entity with a Sprite
        model.attachToBone(sword, "front-fist", new Transform2D(12, 0)); // Offset in the bone's space
        model.attachToBone(healthBar, "head", null, { rotation: false, scale: false });

    After posing, update() sets each attached entity's local transform to the
    bone's world transform (skeleton space, see SpineBone.getWorldTransform())
    times the offset, so the holder's transform carries it with the
    skeleton. Options turn off following the bone's rotation or its scale
    (and shear); the position always follows. A skeleton posed by hand calls
    updateAttachments() after its updateWorldTransform(). An entity moved out
    from under the holder is left where it is until it's back.

    Color: every vertex is skeleton color x slot color x attachment color,
    premultiplied. The color it's drawn with (an Entity's) multiplies that in
    the shader, so one pose can be drawn in many colors.

    Two-color tint: a skeleton whose data has dark colors (slot "dark" in
    Spine) streams 12 floats per vertex instead of 8, the slot's dark color
    (premultiplied; black for slots without one) in RenderAttributes.kVector0,
    and draws with Skeleton2DTwoColorShaderSource, where the texture's dark
    parts take on the dark color. Skeletons without dark colors keep the
    smaller stream and the plain shader.

    Blend modes (slot.data.blendMode), with the shader always giving
    premultiplied color (Skeleton2DShaderSource):
        Normal     BlendMode.kPremultiplied
        Additive   BlendMode.kPremultiplied with vertex alpha 0: adds, and shares the normal run
        Multiply   BlendMode.kMultiply
        Screen     BlendMode.kScreen

    Clipping attachments clip the slots after them, up to their end slot, on
    the CPU as the stream is written (SpineSkeletonClipping, one shared by
    every Skeleton2D): each clipped triangle becomes its own vertices.

    Batching: draw() binds its own Materials (bindsOwnMaterials()), one per
    page and blend mode from MaterialManager, so a Batcher forgets what it
    had bound after drawing one. getDrawCount() is the draws its last draw()
    made. Each draw() rebuilds the stream from the pose as it is then.
*/
class Skeleton2D extends Model2D
{
    static #kQuadTriangles = [0, 1, 2, 2, 3, 0];
    static #kFloatsPerVertex = 8;          // x, y, u, v, r, g, b, a
    static #kFloatsPerVertexTwoColor = 12; // ...then the dark color: r, g, b, a
    static #kPosition = new Vector4();
    static #kScaleRot = new Vector3();
    static #kPageFlags = new Vector4();
    static #kBoneTransform = new Transform2D(); // Scratch for updateAttachments()
    static #kBoundsOffset = new Vector2();      // Scratch for #refreshBounds()
    static #kBoundsSize = new Vector2();
    static #kBoundsCenter = new Vector2();      // Scratch for #toWorld()
    static #kClipper = new SpineSkeletonClipping(); // Shared by every Skeleton2D; _fillStream() starts and ends with it unused
    static #kLight = new Vector4();             // Scratch: the vertex colors given to the clipper
    static #kDark = new Vector4();

    #skeleton;     // SpineSkeleton
    #mesh;         // DynamicMesh, given to the base
    #vertices;     // Float32Array: the stream, grown as needed
    #indices;      // Uint32Array
    #world;        // Float32Array: one attachment's world vertices (x, y pairs)
    #vertexCount;
    #indexCount;
    #runs;         // { page, blendMode, firstIndex, indexCount }, reused; #runCount of them are this stream's
    #runCount;
    #materials;    // TextureAtlas (page) -> [kPremultiplied, kMultiply, kScreen Material]
    #drawCount;
    #twoColor;     // True if the skeleton has dark colors: the two-color stream and shader
    #stride;       // Floats per vertex in the stream: #kFloatsPerVertex, or #kFloatsPerVertexTwoColor
    #stateData;   // SpineAnimationStateData: the mixes
    #state;        // SpineAnimationState: what plays
    #eventCallback; // (skeleton2D, entry, SpineEventType, event) or null
    #attachments;   // { entity, bone (SpineBone), offset (Transform2D or null), rotation, scale } (see attachToBone())
    #bounds;        // Bounds2D: the pose's box in skeleton units, while #boundsStale is false
    #boundsStale;
    #boundsTemp;    // Array: getBounds()' working memory, reused
    #hitBounds;     // SpineSkeletonBounds: the bounding-box polygons, while #hitStale is false
    #hitStale;
    #cullBounds;    // Bounds2D in skeleton units that culling uses instead of the pose's (see setCullBounds()), or null

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
        this.#twoColor = false;
        this.#stride = Skeleton2D.#kFloatsPerVertex;
        this.#stateData = null;
        this.#state = null;
        this.#eventCallback = null;
        this.#attachments = [];
        this.#bounds = new Bounds2D();
        this.#boundsStale = true;
        this.#boundsTemp = [];
        this.#hitBounds = new SpineSkeletonBounds();
        this.#hitStale = true;
        this.#cullBounds = null;
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

        // Two-color tint only for skeletons with dark colors; the others keep the smaller stream
        const twoColor = skeletonData.slots.some((s) => s.darkColor !== null);
        let layout = [[RenderAttributes.kPosition, 2], [RenderAttributes.kUV0, 2], [RenderAttributes.kColor, 4]];

        if (twoColor === true)
            layout.push([RenderAttributes.kVector0, 4]);

        let mesh = new DynamicMesh();

        if (mesh.load(layout) === false)
        {
            console.error("Skeleton2D.load() couldn't build its mesh");
                return false;
        }

        this.#mesh = mesh;
        this.#twoColor = twoColor;
        this.#stride = (twoColor === true) ? Skeleton2D.#kFloatsPerVertexTwoColor : Skeleton2D.#kFloatsPerVertex;
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
        this.#boundsStale = true;
        this.#hitStale = true;
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
        this.updateAttachments();
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
        this.#boundsStale = true;
        this.#hitStale = true;
            return true;
    }

    // The bone named name (a SpineBone: worldX, worldY, getWorldRotationX() ...), or null
    findBone(name) { return (this.isLoaded() === true && typeof name === "string") ? this.#skeleton.findBone(name) : null; }

    // *** Attaching to Bones ***

    /*
        Makes entity (an Entity, a child of an entity holding this Skeleton2D) follow
        the bone named boneName, placed at offset (a Transform2D in the bone's space,
        copied; null for none). options: { rotation, scale }, each true by default;
        false stops following the bone's rotation, or its scale and shear. Attaching an
        entity again replaces its bone, offset and options. Places it now, and from then
        on in each update(). Returns false (changing nothing) if any of these aren't valid.
    */
    attachToBone(entity, boneName, offset = null, options = null)
    {
        if (this.isLoaded() === false)
        {
            console.error("Skeleton2D.attachToBone(): load() it first");
                return false;
        }

        if ((entity instanceof Entity) === false || entity.getParent()?.getModel() !== this)
        {
            console.error("Skeleton2D.attachToBone() needs an Entity that's a child of an entity holding this Skeleton2D");
                return false;
        }

        const bone = this.findBone(boneName);

        if (bone === null)
        {
            console.error(`Skeleton2D.attachToBone(): no bone named "${boneName}"`);
                return false;
        }

        if (offset !== null && (offset instanceof Transform2D) === false)
        {
            console.error("Skeleton2D.attachToBone(): offset must be a Transform2D or null");
                return false;
        }

        const isObject = (options !== null && typeof options === "object");

        if (options !== null && (isObject === false || Object.keys(options).every((k) => k === "rotation" || k === "scale") === false))
        {
            console.error("Skeleton2D.attachToBone(): options must be null or an object with rotation and / or scale (true or false)");
                return false;
        }

        let a = this.#attachments.find((x) => x.entity === entity);

        if (a === undefined)
        {
            a = { entity: entity, bone: null, offset: null, rotation: true, scale: true };
            this.#attachments.push(a);
        }

        a.bone = bone;
        a.offset = (offset !== null) ? new Transform2D().copy(offset) : null;
        a.rotation = (options?.rotation !== false);
        a.scale = (options?.scale !== false);

        this.#placeAttachment(a);
            return true;
    }

    // Stops entity following its bone; it keeps its last transform. Returns false if it wasn't attached.
    detachFromBone(entity)
    {
        const i = this.#attachments.findIndex((x) => x.entity === entity);

        if (i < 0)
            return false;

        this.#attachments.splice(i, 1);
            return true;
    }

    // The bone entity follows (a SpineBone), or null if it isn't attached
    getAttachedBone(entity) { return this.#attachments.find((x) => x.entity === entity)?.bone ?? null; }

    // Places every attached entity at its bone as posed now, and marks the bounds and hit polygons stale. update() calls it; call it after posing by hand.
    updateAttachments()
    {
        this.#boundsStale = true;
        this.#hitStale = true;

        for (const a of this.#attachments)
            this.#placeAttachment(a);
    }

    // *** Bounds ***

    /*
        The box around the region and mesh attachments as posed, in skeleton units
        (origin at the anchor), written into out (a Bounds2D) and returned. Empty if it
        isn't loaded or nothing is showing. Cached until the pose changes (see the top
        of this file).
    */
    getLocalBounds(out = new Bounds2D())
    {
        if (this.isLoaded() === false)
        {
            out.setEmpty();
                return out;
        }

        if (this.#boundsStale === true)
            this.#refreshBounds();

        out.set(this.#bounds);
            return out;
    }

    /*
        The axis-aligned box around the skeleton as drawn at transform, in world design
        units, written into out (a Bounds2D) and returned: getLocalBounds() scaled and
        turned about the origin, then moved to transform's position. Like draw(), it
        ignores the transform's shear.
    */
    getWorldBounds(transform, out = new Bounds2D())
    {
        return Skeleton2D.#toWorld(this.getLocalBounds(out), transform, out);
    }

    /*
        Gives culling (see Batcher.setLayerCulled()) a fixed box in skeleton units, like
        getLocalBounds()' (a Bounds2D, copied), e.g. one fitted over every pose its
        animations reach, so it doesn't work out the pose's box each frame. null goes
        back to the pose's box. Kept until changed or unload(). Returns false if bounds
        isn't a Bounds2D or null.
    */
    setCullBounds(bounds)
    {
        if (bounds !== null && (bounds instanceof Bounds2D) === false)
        {
            console.error("Skeleton2D.setCullBounds() needs a Bounds2D, or null for the pose's box");
                return false;
        }

        if (bounds === null)
            this.#cullBounds = null;
        else
        {
            this.#cullBounds = this.#cullBounds ?? new Bounds2D();
            this.#cullBounds.set(bounds);
        }

        return true;
    }

    // The box culling uses (Model2D.getCullBounds()): setCullBounds()' box as drawn at transform, or without one getWorldBounds()
    getCullBounds(transform, out = new Bounds2D())
    {
        if (this.#cullBounds === null || this.isLoaded() === false)
            return this.getWorldBounds(transform, out);

        out.set(this.#cullBounds);
            return Skeleton2D.#toWorld(out, transform, out);
    }

    // *** Hit tests ***

    /*
        The first visible bounding-box attachment (a SpineBoundingBoxAttachment; its name
        says which part) holding point (a Vector2, world design units) with the skeleton
        drawn at transform, or null. Null too if it isn't loaded, has no bounding boxes
        showing, or the transform's scale is 0. Like draw(), it ignores the transform's
        shear. The polygons are worked out the first time it's asked after a pose
        change, like the bounds.
    */
    hitTest(transform, point)
    {
        if (this.isLoaded() === false)
            return null;

        // Into skeleton units: undo the position, then the rotation, then the scale
        const sx = transform.getScaleX();
        const sy = transform.getScaleY();

        if (sx === 0.0 || sy === 0.0)
            return null;

        const r = transform.getRotation();
        const s = Math.sin(r);
        const c = Math.cos(r);
        const dx = point.x - transform.getX();
        const dy = point.y - transform.getY();
        const x = ((dx * c) + (dy * s)) / sx;
        const y = ((dy * c) - (dx * s)) / sy;
        const hit = this.getHitBounds();

        if (hit.aabbContainsPoint(x, y) === false)
            return null;

        return hit.containsPoint(x, y);
    }

    // True if point (a Vector2, world design units) is in a visible bounding box with the skeleton drawn at transform (see hitTest())
    containsPoint(transform, point)
    {
        return (this.hitTest(transform, point) !== null);
    }

    /*
        The visible bounding boxes' polygons as posed, in skeleton units (a
        SpineSkeletonBounds, read-only: polygons, boundingBoxes, aabb), for other tests,
        e.g. intersectsSegment(). Worked out when stale; null if it isn't loaded.
    */
    getHitBounds()
    {
        if (this.isLoaded() === false)
            return null;

        if (this.#hitStale === true)
        {
            this.#hitBounds.update(this.#skeleton, true);
            this.#hitStale = false;
        }

        return this.#hitBounds;
    }

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
        this.#attachments.length = 0; // Their bones were this skeleton's
        this.#cullBounds = null;      // In this skeleton's units
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

    // The two-color tint variant (see Skeleton2DTwoColorShaderSource), for skeletons with dark colors
    static getTwoColorShader()
    {
        return ShaderManager.get(Skeleton2DTwoColorShaderSource);
    }

    /*
        For draw() and tests: writes the skeleton's triangles, as posed now, into the
        stream, on the CPU only. Returns it, read-only: { vertices (x, y, u, v, r, g, b, a
        each, then the dark color's r, g, b, a for a two-color skeleton; u, v in Spine's
        terms, V down), vertexCount, floatsPerVertex (8, or 12 with two colors), indices,
        indexCount, runs (runCount of { page, blendMode, firstIndex, indexCount }),
        runCount }.
    */
    _fillStream()
    {
        const skeleton = this.#skeleton;
        const sc = skeleton.color;
        const stride = this.#stride;
        const twoColor = this.#twoColor;
        const clipper = Skeleton2D.#kClipper;

        this.#vertexCount = 0;
        this.#indexCount = 0;
        this.#runCount = 0;

        let run = null;

        for (const slot of skeleton.drawOrder)
        {
            if (slot.bone.active === false)
            {
                clipper.clipEndWithSlot(slot);
                continue;
            }

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
            else if (a instanceof SpineClippingAttachment)
            {
                clipper.clipStart(slot, a); // Clips the slots after it, up to its end slot
                continue;
            }
            else
            {
                clipper.clipEndWithSlot(slot);
                continue;
            }

            if ((a.region instanceof AtlasSubTexture) === false)
            {
                clipper.clipEndWithSlot(slot);
                continue; // No image (Spine's "if (texture)")
            }

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
                    blendMode = BlendMode.kScreen;
                    break;
            }

            // Two-color: the slot's dark color, premultiplied by the alpha (not the additive 0); black without one
            const dark = slot.darkColor;
            const dr = (dark !== null) ? dark.x * alpha : 0.0;
            const dg = (dark !== null) ? dark.y * alpha : 0.0;
            const db = (dark !== null) ? dark.z * alpha : 0.0;

            // Clipped: the clipper's vertices (already in the stream's layout) and triangles instead
            let clipped = false;

            if (clipper.isClipping())
            {
                Skeleton2D.#kLight.setXYZW(r, g, b, vertexAlpha);
                Skeleton2D.#kDark.setXYZW(dr, dg, db, 1.0);
                clipper.clipTriangles(this.#world, count * 2, triangles, triangles.length, a.uvs, Skeleton2D.#kLight, Skeleton2D.#kDark, twoColor);
                count = clipper.clippedVertices.length / stride;
                triangles = clipper.clippedTriangles;
                clipped = true;

                if (count === 0)
                {
                    clipper.clipEndWithSlot(slot);
                    continue; // All clipped away
                }
            }

            const page = a.region.getAtlas();

            if (run === null || run.page !== page || run.blendMode !== blendMode)
                run = this.#startRun(page, blendMode);

            this.#reserve(count, triangles.length);

            // Vertices
            let v = this.#vertices;
            let o = this.#vertexCount * stride;

            if (clipped === true)
            {
                const cv = clipper.clippedVertices;

                for (let i = 0; i < cv.length; ++i)
                    v[o++] = cv[i];
            }
            else
            {
                const uvs = a.uvs;
                const world = this.#world;

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

                    if (twoColor === true)
                    {
                        v[o++] = dr;
                        v[o++] = dg;
                        v[o++] = db;
                        v[o++] = 1.0;
                    }
                }
            }

            // Indices, after the vertices so far
            const base = this.#vertexCount;
            let ind = this.#indices;

            for (let i = 0; i < triangles.length; ++i)
                ind[this.#indexCount + i] = base + triangles[i];

            this.#vertexCount += count;
            this.#indexCount += triangles.length;
            run.indexCount += triangles.length;

            clipper.clipEndWithSlot(slot);
        }

        clipper.clipEnd();

        return {
            vertices: this.#vertices, vertexCount: this.#vertexCount, floatsPerVertex: stride,
            indices: this.#indices, indexCount: this.#indexCount,
            runs: this.#runs, runCount: this.#runCount
        };
    }

    // *** Internal Methods ***

    // Works out #bounds from the pose (SpineSkeleton.getBounds()); empty if nothing is showing
    #refreshBounds()
    {
        const offset = Skeleton2D.#kBoundsOffset;
        const size = Skeleton2D.#kBoundsSize;

        this.#skeleton.getBounds(offset, size, this.#boundsTemp);

        if (Number.isFinite(offset.x) === true && Number.isFinite(offset.y) === true)
            this.#bounds.setMinMax(offset.x, offset.y, offset.x + size.x, offset.y + size.y);
        else
            this.#bounds.setEmpty();

        this.#boundsStale = false;
    }

    // local (a Bounds2D in skeleton units) as drawn at transform: scaled and turned about the origin, then moved to its position. out may be local.
    static #toWorld(local, transform, out)
    {
        if (local.isEmpty() === true)
        {
            out.setEmpty();
                return out;
        }

        const sx = transform.getScaleX();
        const sy = transform.getScaleY();
        const r = transform.getRotation();
        const s = Math.sin(r);
        const c = Math.cos(r);
        const center = local.getCenter(Skeleton2D.#kBoundsCenter);
        const x = center.x * sx;
        const y = center.y * sy;

        return Model2D._setTurnedBox(out, transform.getX() + (x * c) - (y * s), transform.getY() + (x * s) + (y * c),
                                     local.getWidth() / 2.0, local.getHeight() / 2.0, sx, sy, r);
    }

    // Sets a's entity's local transform to its bone (as its options allow) times its offset; skipped while the entity isn't under a holder
    #placeAttachment(a)
    {
        if (a.entity.getParent()?.getModel() !== this)
            return;

        let t = a.bone.getWorldTransform(Skeleton2D.#kBoneTransform);

        if (a.rotation === false)
            t.setRotation(0.0);

        if (a.scale === false)
        {
            t.setScale(1.0, 1.0);
            t.setShear(0.0);
        }

        if (a.offset !== null)
            Transform2D.multiply(t, t, a.offset);

        a.entity.setTransform(t); // Copied
    }

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
        const floats = (this.#vertexCount + vertexCount) * this.#stride;

        if (floats > this.#vertices.length)
        {
            let grown = new Float32Array(Math.max(floats, this.#vertices.length * 2));
            grown.set(this.#vertices.subarray(0, this.#vertexCount * this.#stride));
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

    /*
        The Material for page (a Spine page's TextureAtlas) and blendMode (kPremultiplied,
        kMultiply or kScreen), with this skeleton's shader (two-color or not), made once
        (shared through MaterialManager); null on failure
    */
    #getMaterial(page, blendMode)
    {
        let set = this.#materials.get(page);

        if (set === undefined)
        {
            set = [null, null, null];
            this.#materials.set(page, set);
        }

        const i = (blendMode === BlendMode.kMultiply) ? 1 : (blendMode === BlendMode.kScreen) ? 2 : 0;

        if (set[i] === null)
        {
            const shader = (this.#twoColor === true) ? Skeleton2D.getTwoColorShader() : Skeleton2D.getDefaultShader();

            if (shader === null)
            {
                console.error("Skeleton2D: its shader couldn't be built");
                    return null;
            }

            set[i] = MaterialManager.load(shader, [page.getTexture()], [page.getSampler()], blendMode);

            if (set[i] === null)
                return null;
        }

        return set[i];
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
