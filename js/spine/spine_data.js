"use strict";

/******************************************************************************
 * Spine Runtimes License Agreement
 * Last updated January 1, 2020. Replaces all prior versions.
 *
 * Copyright (c) 2013-2020, Esoteric Software LLC
 *
 * Integration of the Spine Runtimes into software or otherwise creating
 * derivative works of the Spine Runtimes is permitted under the terms and
 * conditions of Section 2 of the Spine Editor License Agreement:
 * http://esotericsoftware.com/spine-editor-license
 *
 * Otherwise, it is permitted to integrate the Spine Runtimes into software
 * or otherwise create derivative works of the Spine Runtimes (collectively,
 * "Products"), provided that each user of the Products must obtain their own
 * Spine Editor license and redistribution of the Products in any form must
 * include this license and copyright notice.
 *
 * THE SPINE RUNTIMES ARE PROVIDED BY ESOTERIC SOFTWARE LLC "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL ESOTERIC SOFTWARE LLC BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES,
 * BUSINESS INTERRUPTION, OR LOSS OF USE, DATA, OR PROFITS) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THE SPINE RUNTIMES, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *****************************************************************************/

/*
    Spine skeleton data, ported from spine-core 4.0.31 (Event.ts, EventData.ts,
    ConstraintData.ts, BoneData.ts, SlotData.ts, IkConstraintData.ts,
    TransformConstraintData.ts, PathConstraintData.ts, Skin.ts,
    SkeletonData.ts); see docs/spine_plan.md. The setup pose and everything
    that doesn't change while a skeleton plays; many skeletons share it.

        SpineEvent, SpineEventData        An event fired by an animation, and its defaults
        SpineConstraintData               The base of the constraint data
        SpineBoneData, SpineSlotData      A bone's and a slot's setup pose
        SpineIkConstraintData             IK: bones that reach for a target
        SpineTransformConstraintData      Bones that copy another bone's transform
        SpinePathConstraintData           Bones that follow a path
        SpineSkin, SpineSkinEntry         Named sets of attachments
        SpineSkeletonData                 All of it for one skeleton; load() reads it (engine addition)
*/

/** Stores the current pose values for an {@link Event}.
 *
 * See Timeline {@link Timeline#apply()},
 * AnimationStateListener {@link AnimationStateListener#event()}, and
 * [Events](http://esotericsoftware.com/spine-events) in the Spine User Guide. */
class SpineEvent
{
    data = null;
    intValue = 0;
    floatValue = 0;
    stringValue = null;
    time = 0;
    volume = 0;
    balance = 0;

    constructor(time, data)
    {
        if (!data)
            throw new Error("data cannot be null.");
        this.time = time;
        this.data = data;
    }
}

/** Stores the setup pose values for an {@link Event}.
 *
 * See [Events](http://esotericsoftware.com/spine-events) in the Spine User Guide. */
class SpineEventData
{
    name = null;
    intValue = 0;
    floatValue = 0;
    stringValue = null;
    audioPath = null;
    volume = 0;
    balance = 0;

    constructor(name)
    {
        this.name = name;
    }
}

/** The base class for all constraint datas. */
class SpineConstraintData
{
    name;
    order;
    skinRequired;

    constructor(name, order, skinRequired)
    {
        this.name = name;
        this.order = order;
        this.skinRequired = skinRequired;
    }
}

/** Stores the setup pose for a {@link Bone}. */
class SpineBoneData
{
    /** The index of the bone in {@link Skeleton#getBones()}. */
    index = 0;

    /** The name of the bone, which is unique across all bones in the skeleton. */
    name = null;

    /** @returns May be null. */
    parent = null;

    /** The bone's length. */
    length = 0;

    /** The local x translation. */
    x = 0;

    /** The local y translation. */
    y = 0;

    /** The local rotation. */
    rotation = 0;

    /** The local scaleX. */
    scaleX = 1;

    /** The local scaleY. */
    scaleY = 1;

    /** The local shearX. */
    shearX = 0;

    /** The local shearX. */
    shearY = 0;

    /** The transform mode for how parent world transforms affect this bone. */
    transformMode = SpineTransformMode.Normal;

    /** When true, {@link Skeleton#updateWorldTransform()} only updates this bone if the {@link Skeleton#skin} contains this
      * bone.
      * @see Skin#bones */
    skinRequired = false;

    /** The color of the bone as it was in Spine. Available only when nonessential data was exported. Bones are not usually
     * rendered at runtime. */
    color = new Vector4(0, 0, 0, 0);

    constructor(index, name, parent)
    {
        if (index < 0)
            throw new Error("index must be >= 0.");
        if (!name)
            throw new Error("name cannot be null.");
        this.index = index;
        this.name = name;
        this.parent = parent;
    }
}

/** Stores the setup pose for a {@link Slot}. */
class SpineSlotData
{
    /** The index of the slot in {@link Skeleton#getSlots()}. */
    index = 0;

    /** The name of the slot, which is unique across all slots in the skeleton. */
    name = null;

    /** The bone this slot belongs to. */
    boneData = null;

    /** The color used to tint the slot's attachment. If {@link #getDarkColor()} is set, this is used as the light color for two
     * color tinting. */
    color = new Vector4(1, 1, 1, 1);

    /** The dark color used to tint the slot's attachment for two color tinting, or null if two color tinting is not used. The dark
     * color's alpha is not used. */
    darkColor = null;

    /** The name of the attachment that is visible for this slot in the setup pose, or null if no attachment is visible. */
    attachmentName = null;

    /** The blend mode for drawing the slot's attachment. */
    blendMode = null;

    constructor(index, name, boneData)
    {
        if (index < 0)
            throw new Error("index must be >= 0.");
        if (!name)
            throw new Error("name cannot be null.");
        if (!boneData)
            throw new Error("boneData cannot be null.");
        this.index = index;
        this.name = name;
        this.boneData = boneData;
    }
}

/** Stores the setup pose for an {@link IkConstraint}.
 * <p>
 * See [IK constraints](http://esotericsoftware.com/spine-ik-constraints) in the Spine User Guide. */
class SpineIkConstraintData extends SpineConstraintData
{
    /** The bones that are constrained by this IK constraint. */
    bones = new Array();

    /** The bone that is the IK target. */
    target = null;

    /** Controls the bend direction of the IK bones, either 1 or -1. */
    bendDirection = 1;

    /** When true and only a single bone is being constrained, if the target is too close, the bone is scaled to reach it. */
    compress = false;

    /** When true, if the target is out of range, the parent bone is scaled to reach it. If more than one bone is being constrained
     * and the parent bone has local nonuniform scale, stretch is not applied. */
    stretch = false;

    /** When true, only a single bone is being constrained, and {@link #getCompress()} or {@link #getStretch()} is used, the bone
     * is scaled on both the X and Y axes. */
    uniform = false;

    /** A percentage (0-1) that controls the mix between the constrained and unconstrained rotations. */
    mix = 1;

    /** For two bone IK, the distance from the maximum reach of the bones that rotation will slow. */
    softness = 0;

    constructor(name)
    {
        super(name, 0, false);
    }
}

/** Stores the setup pose for a {@link TransformConstraint}.
 *
 * See [Transform constraints](http://esotericsoftware.com/spine-transform-constraints) in the Spine User Guide. */
class SpineTransformConstraintData extends SpineConstraintData
{
    /** The bones that will be modified by this transform constraint. */
    bones = new Array();

    /** The target bone whose world transform will be copied to the constrained bones. */
    target = null;
    mixRotate = 0;
    mixX = 0;
    mixY = 0;
    mixScaleX = 0;
    mixScaleY = 0;
    mixShearY = 0;

    /** An offset added to the constrained bone rotation. */
    offsetRotation = 0;

    /** An offset added to the constrained bone X translation. */
    offsetX = 0;

    /** An offset added to the constrained bone Y translation. */
    offsetY = 0;

    /** An offset added to the constrained bone scaleX. */
    offsetScaleX = 0;

    /** An offset added to the constrained bone scaleY. */
    offsetScaleY = 0;

    /** An offset added to the constrained bone shearY. */
    offsetShearY = 0;
    relative = false;
    local = false;

    constructor(name)
    {
        super(name, 0, false);
    }
}

/** Stores the setup pose for a {@link PathConstraint}.
 *
 * See [path constraints](http://esotericsoftware.com/spine-path-constraints) in the Spine User Guide. */
class SpinePathConstraintData extends SpineConstraintData
{
    /** The bones that will be modified by this path constraint. */
    bones = new Array();

    /** The slot whose path attachment will be used to constrained the bones. */
    target = null;

    /** The mode for positioning the first bone on the path. */
    positionMode = null;

    /** The mode for positioning the bones after the first bone on the path. */
    spacingMode = null;

    /** The mode for adjusting the rotation of the bones. */
    rotateMode = null;

    /** An offset added to the constrained bone rotation. */
    offsetRotation = 0;

    /** The position along the path. */
    position = 0;

    /** The spacing between bones. */
    spacing = 0;
    mixRotate = 0;
    mixX = 0;
    mixY = 0;

    constructor(name)
    {
        super(name, 0, false);
    }
}

/** Stores an entry in the skin consisting of the slot index, name, and attachment **/
class SpineSkinEntry
{
    slotIndex;
    name;
    attachment;

    constructor(slotIndex = 0, name = null, attachment = null)
    {
        this.slotIndex = slotIndex;
        this.name = name;
        this.attachment = attachment;
    }
}

/** Stores attachments by slot index and attachment name.
 *
 * See SkeletonData {@link SkeletonData#defaultSkin}, Skeleton {@link Skeleton#skin}, and
 * [Runtime skins](http://esotericsoftware.com/spine-runtime-skins) in the Spine Runtimes Guide. */
class SpineSkin
{
    /** The skin's name, which is unique across all skins in the skeleton. */
    name = null;
    attachments = new Array();
    bones = Array();
    constraints = new Array();

    constructor(name)
    {
        if (!name)
            throw new Error("name cannot be null.");
        this.name = name;
    }

    /** Adds an attachment to the skin for the specified slot index and name. */
    setAttachment(slotIndex, name, attachment)
    {
        if (!attachment)
            throw new Error("attachment cannot be null.");
        let attachments = this.attachments;
        if (slotIndex >= attachments.length)
            attachments.length = slotIndex + 1;
        if (!attachments[slotIndex])
            attachments[slotIndex] = {};
        attachments[slotIndex][name] = attachment;
    }

    /** Adds all attachments, bones, and constraints from the specified skin to this skin. */
    addSkin(skin)
    {
        for (let i = 0; i < skin.bones.length; i++)
        {
            let bone = skin.bones[i];
            let contained = false;
            for (let ii = 0; ii < this.bones.length; ii++)
            {
                if (this.bones[ii] == bone)
                {
                    contained = true;
                    break;
                }
            }
            if (!contained)
                this.bones.push(bone);
        }
        for (let i = 0; i < skin.constraints.length; i++)
        {
            let constraint = skin.constraints[i];
            let contained = false;
            for (let ii = 0; ii < this.constraints.length; ii++)
            {
                if (this.constraints[ii] == constraint)
                {
                    contained = true;
                    break;
                }
            }
            if (!contained)
                this.constraints.push(constraint);
        }
        let attachments = skin.getAttachments();
        for (let i = 0; i < attachments.length; i++)
        {
            var attachment = attachments[i];
            this.setAttachment(attachment.slotIndex, attachment.name, attachment.attachment);
        }
    }

    /** Adds all bones and constraints and copies of all attachments from the specified skin to this skin. Mesh attachments are not
     * copied, instead a new linked mesh is created. The attachment copies can be modified without affecting the originals. */
    copySkin(skin)
    {
        for (let i = 0; i < skin.bones.length; i++)
        {
            let bone = skin.bones[i];
            let contained = false;
            for (let ii = 0; ii < this.bones.length; ii++)
            {
                if (this.bones[ii] == bone)
                {
                    contained = true;
                    break;
                }
            }
            if (!contained)
                this.bones.push(bone);
        }
        for (let i = 0; i < skin.constraints.length; i++)
        {
            let constraint = skin.constraints[i];
            let contained = false;
            for (let ii = 0; ii < this.constraints.length; ii++)
            {
                if (this.constraints[ii] == constraint)
                {
                    contained = true;
                    break;
                }
            }
            if (!contained)
                this.constraints.push(constraint);
        }
        let attachments = skin.getAttachments();
        for (let i = 0; i < attachments.length; i++)
        {
            var attachment = attachments[i];
            if (!attachment.attachment)
                continue;
            if (attachment.attachment instanceof SpineMeshAttachment)
            {
                attachment.attachment = attachment.attachment.newLinkedMesh();
                this.setAttachment(attachment.slotIndex, attachment.name, attachment.attachment);
            }
            else
            {
                attachment.attachment = attachment.attachment.copy();
                this.setAttachment(attachment.slotIndex, attachment.name, attachment.attachment);
            }
        }
    }

    /** Returns the attachment for the specified slot index and name, or null. */
    getAttachment(slotIndex, name)
    {
        let dictionary = this.attachments[slotIndex];
        return dictionary ? dictionary[name] : null;
    }

    /** Removes the attachment in the skin for the specified slot index and name, if any. */
    removeAttachment(slotIndex, name)
    {
        let dictionary = this.attachments[slotIndex];
        if (dictionary)
            dictionary[name] = null;
    }

    /** Returns all attachments in this skin. */
    getAttachments()
    {
        let entries = new Array();
        for (var i = 0; i < this.attachments.length; i++)
        {
            let slotAttachments = this.attachments[i];
            if (slotAttachments)
            {
                for (let name in slotAttachments)
                {
                    let attachment = slotAttachments[name];
                    if (attachment)
                        entries.push(new SpineSkinEntry(i, name, attachment));
                }
            }
        }
        return entries;
    }

    /** Returns all attachments in this skin for the specified slot index. */
    getAttachmentsForSlot(slotIndex, attachments)
    {
        let slotAttachments = this.attachments[slotIndex];
        if (slotAttachments)
        {
            for (let name in slotAttachments)
            {
                let attachment = slotAttachments[name];
                if (attachment)
                    attachments.push(new SpineSkinEntry(slotIndex, name, attachment));
            }
        }
    }

    /** Clears all attachments, bones, and constraints. */
    clear()
    {
        this.attachments.length = 0;
        this.bones.length = 0;
        this.constraints.length = 0;
    }

    /** Attach each attachment in this skin if the corresponding attachment in the old skin is currently attached. */
    attachAll(skeleton, oldSkin)
    {
        let slotIndex = 0;
        for (let i = 0; i < skeleton.slots.length; i++)
        {
            let slot = skeleton.slots[i];
            let slotAttachment = slot.getAttachment();
            if (slotAttachment && slotIndex < oldSkin.attachments.length)
            {
                let dictionary = oldSkin.attachments[slotIndex];
                for (let key in dictionary)
                {
                    let skinAttachment = dictionary[key];
                    if (slotAttachment == skinAttachment)
                    {
                        let attachment = this.getAttachment(slotIndex, key);
                        if (attachment)
                            slot.setAttachment(attachment);
                        break;
                    }
                }
            }
            slotIndex++;
        }
    }
}

/** Stores the setup pose and all of the stateless data for a skeleton.
 *
 * See [Data objects](http://esotericsoftware.com/spine-runtime-architecture#Data-objects) in the Spine Runtimes
 * Guide.
 *
 * Engine: load() reads one from a JSON file and a Spine atlas in one call:
 *
 *     const data = await SpineSkeletonData.load("assets/demos.json", "raptor", "assets/atlas1.atlas");
 *
 * name picks one skeleton from a file holding several by name (like the samples' demos.json); null reads the whole
 * file as one skeleton (Spine's usual export). The atlas comes from TextureAtlasManager.loadSpineAtlas(), so
 * skeletons on the same atlas share it; each JSON file is fetched once, and each skeleton read once and shared
 * (the data is read-only once loaded; a Skeleton holds what changes). */
class SpineSkeletonData
{
    static #files = new Map();     // JSON url -> Promise of the parsed file (null if it failed)
    static #skeletons = new Map(); // "jsonUrl|name|atlasUrl" -> Promise of the SpineSkeletonData (null if it failed)

    /*
        Engine: loads the atlas (see TextureAtlasManager.loadSpineAtlas()) and reads the skeleton from the JSON at
        jsonUrl (the one called name, or the whole file with name null). Resolves to the SpineSkeletonData, or null
        with a console.error; a failed load isn't kept, so asking again tries again.
    */
    static async load(jsonUrl, name, atlasUrl)
    {
        if (typeof jsonUrl !== "string" || jsonUrl.length === 0 || typeof atlasUrl !== "string" || atlasUrl.length === 0 ||
            (name !== null && typeof name !== "string"))
        {
            console.error("SpineSkeletonData.load() needs the JSON's url, the skeleton's name (or null for the whole file) and the .atlas file's url");
                return null;
        }

        const key = `${jsonUrl}|${name ?? ""}|${atlasUrl}`;
        let promise = SpineSkeletonData.#skeletons.get(key);

        if (promise === undefined)
        {
            promise = SpineSkeletonData.#read(jsonUrl, name, atlasUrl);
            SpineSkeletonData.#skeletons.set(key, promise); // Stored before loading, so a second request shares this load
        }

        const data = await promise;

        if (data === null && SpineSkeletonData.#skeletons.get(key) === promise)
            SpineSkeletonData.#skeletons.delete(key); // Don't keep failures

        return data;
    }

    // Engine: forgets every loaded skeleton and JSON file (the atlases are TextureAtlasManager's)
    static unloadAll()
    {
        SpineSkeletonData.#files.clear();
        SpineSkeletonData.#skeletons.clear();
    }

    static async #read(jsonUrl, name, atlasUrl)
    {
        const [pages, file] = await Promise.all([TextureAtlasManager.loadSpineAtlas(atlasUrl), SpineSkeletonData.#fetchFile(jsonUrl)]);

        if (pages === null || file === null)
            return null; // Already reported

        const root = (name !== null) ? file[name] : file;

        if (root === null || typeof root !== "object" || typeof root.skeleton !== "object")
        {
            console.error(`SpineSkeletonData.load(): ${jsonUrl} has no skeleton${name !== null ? ` called "${name}"` : ""}`);
                return null;
        }

        try
        {
            const data = new SpineSkeletonJson(new SpineAtlasAttachmentLoader(atlasUrl)).readSkeletonData(root);
            data.name = data.name ?? name;
                return data;
        }
        catch (error)
        {
            console.error(`SpineSkeletonData.load() couldn't read ${name ?? "the skeleton"} from ${jsonUrl}: ${error.message}`);
                return null;
        }
    }

    // The parsed JSON file, fetched once; null (forgotten, with a console.error) if it can't be
    static async #fetchFile(jsonUrl)
    {
        let promise = SpineSkeletonData.#files.get(jsonUrl);

        if (promise === undefined)
        {
            promise = (async () =>
            {
                try
                {
                    const response = await fetch(jsonUrl);

                    if (response.ok === false)
                        throw new Error(`HTTP ${response.status}`);

                    return await response.json();
                }
                catch (error)
                {
                    console.error(`SpineSkeletonData.load() couldn't load ${jsonUrl}: ${error.message}`);
                        return null;
                }
            })();

            SpineSkeletonData.#files.set(jsonUrl, promise);
        }

        const file = await promise;

        if (file === null && SpineSkeletonData.#files.get(jsonUrl) === promise)
            SpineSkeletonData.#files.delete(jsonUrl);

        return file;
    }

    /** The skeleton's name, which by default is the name of the skeleton data file, if possible. May be null. */
    name = null;

    /** The skeleton's bones, sorted parent first. The root bone is always the first bone. */
    bones = new Array(); // Ordered parents first.
    /** The skeleton's slots. */
    slots = new Array(); // Setup pose draw order.
    skins = new Array();

    /** The skeleton's default skin. By default this skin contains all attachments that were not in a skin in Spine.
     *
     * See {@link Skeleton#getAttachmentByName()}.
     * May be null. */
    defaultSkin = null;

    /** The skeleton's events. */
    events = new Array();

    /** The skeleton's animations. */
    animations = new Array();

    /** The skeleton's IK constraints. */
    ikConstraints = new Array();

    /** The skeleton's transform constraints. */
    transformConstraints = new Array();

    /** The skeleton's path constraints. */
    pathConstraints = new Array();

    /** The X coordinate of the skeleton's axis aligned bounding box in the setup pose. */
    x = 0;

    /** The Y coordinate of the skeleton's axis aligned bounding box in the setup pose. */
    y = 0;

    /** The width of the skeleton's axis aligned bounding box in the setup pose. */
    width = 0;

    /** The height of the skeleton's axis aligned bounding box in the setup pose. */
    height = 0;

    /** The Spine version used to export the skeleton data, or null. */
    version = null;

    /** The skeleton data hash. This value will change if any of the skeleton data has changed. May be null. */
    hash = null;
    // Nonessential
    /** The dopesheet FPS in Spine. Available only when nonessential data was exported. */
    fps = 0;

    /** The path to the images directory as defined in Spine. Available only when nonessential data was exported. May be null. */
    imagesPath = null;

    /** The path to the audio directory as defined in Spine. Available only when nonessential data was exported. May be null. */
    audioPath = null;

    /** Finds a bone by comparing each bone's name. It is more efficient to cache the results of this method than to call it
     * multiple times.
     * @returns May be null. */
    findBone(boneName)
    {
        if (!boneName)
            throw new Error("boneName cannot be null.");
        let bones = this.bones;
        for (let i = 0, n = bones.length; i < n; i++)
        {
            let bone = bones[i];
            if (bone.name == boneName)
                return bone;
        }
        return null;
    }

    /** Finds a slot by comparing each slot's name. It is more efficient to cache the results of this method than to call it
     * multiple times.
     * @returns May be null. */
    findSlot(slotName)
    {
        if (!slotName)
            throw new Error("slotName cannot be null.");
        let slots = this.slots;
        for (let i = 0, n = slots.length; i < n; i++)
        {
            let slot = slots[i];
            if (slot.name == slotName)
                return slot;
        }
        return null;
    }

    /** Finds a skin by comparing each skin's name. It is more efficient to cache the results of this method than to call it
     * multiple times.
     * @returns May be null. */
    findSkin(skinName)
    {
        if (!skinName)
            throw new Error("skinName cannot be null.");
        let skins = this.skins;
        for (let i = 0, n = skins.length; i < n; i++)
        {
            let skin = skins[i];
            if (skin.name == skinName)
                return skin;
        }
        return null;
    }

    /** Finds an event by comparing each events's name. It is more efficient to cache the results of this method than to call it
     * multiple times.
     * @returns May be null. */
    findEvent(eventDataName)
    {
        if (!eventDataName)
            throw new Error("eventDataName cannot be null.");
        let events = this.events;
        for (let i = 0, n = events.length; i < n; i++)
        {
            let event = events[i];
            if (event.name == eventDataName)
                return event;
        }
        return null;
    }

    /** Finds an animation by comparing each animation's name. It is more efficient to cache the results of this method than to
     * call it multiple times.
     * @returns May be null. */
    findAnimation(animationName)
    {
        if (!animationName)
            throw new Error("animationName cannot be null.");
        let animations = this.animations;
        for (let i = 0, n = animations.length; i < n; i++)
        {
            let animation = animations[i];
            if (animation.name == animationName)
                return animation;
        }
        return null;
    }

    /** Finds an IK constraint by comparing each IK constraint's name. It is more efficient to cache the results of this method
     * than to call it multiple times.
     * @return May be null. */
    findIkConstraint(constraintName)
    {
        if (!constraintName)
            throw new Error("constraintName cannot be null.");
        let ikConstraints = this.ikConstraints;
        for (let i = 0, n = ikConstraints.length; i < n; i++)
        {
            let constraint = ikConstraints[i];
            if (constraint.name == constraintName)
                return constraint;
        }
        return null;
    }

    /** Finds a transform constraint by comparing each transform constraint's name. It is more efficient to cache the results of
     * this method than to call it multiple times.
     * @return May be null. */
    findTransformConstraint(constraintName)
    {
        if (!constraintName)
            throw new Error("constraintName cannot be null.");
        let transformConstraints = this.transformConstraints;
        for (let i = 0, n = transformConstraints.length; i < n; i++)
        {
            let constraint = transformConstraints[i];
            if (constraint.name == constraintName)
                return constraint;
        }
        return null;
    }

    /** Finds a path constraint by comparing each path constraint's name. It is more efficient to cache the results of this method
     * than to call it multiple times.
     * @return May be null. */
    findPathConstraint(constraintName)
    {
        if (!constraintName)
            throw new Error("constraintName cannot be null.");
        let pathConstraints = this.pathConstraints;
        for (let i = 0, n = pathConstraints.length; i < n; i++)
        {
            let constraint = pathConstraints[i];
            if (constraint.name == constraintName)
                return constraint;
        }
        return null;
    }
}
