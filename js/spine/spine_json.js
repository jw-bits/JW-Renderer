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
    SpineSkeletonJson - Reads Spine 4.0 JSON into a SpineSkeletonData,
    ported from spine-core 4.0.31 (SkeletonJson.ts); see docs/spine_plan.md.
    Usually used through SpineSkeletonData.load().

        let reader = new SpineSkeletonJson(new SpineAtlasAttachmentLoader("assets/atlas1.atlas"));
        let data = reader.readSkeletonData(json); // The parsed JSON, or its text

    Engine changes: Spine's module-level helpers (readTimeline1, readCurve,
    getValue, ...) are private static methods here, so nothing is global but
    the classes. SpineLinkedMesh is the reader's own bookkeeping.
*/

/** Loads skeleton data in the Spine JSON format.
 *
 * See [Spine JSON format](http://esotericsoftware.com/spine-json-format) and
 * [JSON and binary data](http://esotericsoftware.com/spine-loading-skeleton-data#JSON-and-binary-data) in the Spine
 * Runtimes Guide. */
class SpineSkeletonJson
{
    attachmentLoader = null;

    /** Scales bone positions, image sizes, and translations as they are loaded. This allows different size images to be used at
     * runtime than were used in Spine.
     *
     * See [Scaling](http://esotericsoftware.com/spine-loading-skeleton-data#Scaling) in the Spine Runtimes Guide. */
    scale = 1;
    linkedMeshes = new Array();

    constructor(attachmentLoader)
    {
        this.attachmentLoader = attachmentLoader;
    }

    readSkeletonData(json)
    {
        let scale = this.scale;
        let skeletonData = new SpineSkeletonData();
        let root = typeof (json) === "string" ? JSON.parse(json) : json;
        // Skeleton
        let skeletonMap = root.skeleton;
        if (skeletonMap)
        {
            skeletonData.hash = skeletonMap.hash;
            skeletonData.version = skeletonMap.spine;
            skeletonData.x = skeletonMap.x;
            skeletonData.y = skeletonMap.y;
            skeletonData.width = skeletonMap.width;
            skeletonData.height = skeletonMap.height;
            skeletonData.fps = skeletonMap.fps;
            skeletonData.imagesPath = skeletonMap.images;
        }
        // Bones
        if (root.bones)
        {
            for (let i = 0; i < root.bones.length; i++)
            {
                let boneMap = root.bones[i];
                let parent = null;
                let parentName = SpineSkeletonJson.#getValue(boneMap, "parent", null);
                if (parentName)
                    parent = skeletonData.findBone(parentName);
                let data = new SpineBoneData(skeletonData.bones.length, boneMap.name, parent);
                data.length = SpineSkeletonJson.#getValue(boneMap, "length", 0) * scale;
                data.x = SpineSkeletonJson.#getValue(boneMap, "x", 0) * scale;
                data.y = SpineSkeletonJson.#getValue(boneMap, "y", 0) * scale;
                data.rotation = SpineSkeletonJson.#getValue(boneMap, "rotation", 0);
                data.scaleX = SpineSkeletonJson.#getValue(boneMap, "scaleX", 1);
                data.scaleY = SpineSkeletonJson.#getValue(boneMap, "scaleY", 1);
                data.shearX = SpineSkeletonJson.#getValue(boneMap, "shearX", 0);
                data.shearY = SpineSkeletonJson.#getValue(boneMap, "shearY", 0);
                data.transformMode = SpineUtils.enumValue(SpineTransformMode, SpineSkeletonJson.#getValue(boneMap, "transform", "Normal"));
                data.skinRequired = SpineSkeletonJson.#getValue(boneMap, "skin", false);
                let color = SpineSkeletonJson.#getValue(boneMap, "color", null);
                if (color)
                    data.color.setRGBAFromString(color);
                skeletonData.bones.push(data);
            }
        }
        // Slots.
        if (root.slots)
        {
            for (let i = 0; i < root.slots.length; i++)
            {
                let slotMap = root.slots[i];
                let boneData = skeletonData.findBone(slotMap.bone);
                let data = new SpineSlotData(skeletonData.slots.length, slotMap.name, boneData);
                let color = SpineSkeletonJson.#getValue(slotMap, "color", null);
                if (color)
                    data.color.setRGBAFromString(color);
                let dark = SpineSkeletonJson.#getValue(slotMap, "dark", null);
                if (dark)
                    data.darkColor = SpineSkeletonJson.#color(dark);
                data.attachmentName = SpineSkeletonJson.#getValue(slotMap, "attachment", null);
                data.blendMode = SpineUtils.enumValue(SpineBlendMode, SpineSkeletonJson.#getValue(slotMap, "blend", "normal"));
                skeletonData.slots.push(data);
            }
        }
        // IK constraints
        if (root.ik)
        {
            for (let i = 0; i < root.ik.length; i++)
            {
                let constraintMap = root.ik[i];
                let data = new SpineIkConstraintData(constraintMap.name);
                data.order = SpineSkeletonJson.#getValue(constraintMap, "order", 0);
                data.skinRequired = SpineSkeletonJson.#getValue(constraintMap, "skin", false);
                for (let ii = 0; ii < constraintMap.bones.length; ii++)
                    data.bones.push(skeletonData.findBone(constraintMap.bones[ii]));
                data.target = skeletonData.findBone(constraintMap.target);
                data.mix = SpineSkeletonJson.#getValue(constraintMap, "mix", 1);
                data.softness = SpineSkeletonJson.#getValue(constraintMap, "softness", 0) * scale;
                data.bendDirection = SpineSkeletonJson.#getValue(constraintMap, "bendPositive", true) ? 1 : -1;
                data.compress = SpineSkeletonJson.#getValue(constraintMap, "compress", false);
                data.stretch = SpineSkeletonJson.#getValue(constraintMap, "stretch", false);
                data.uniform = SpineSkeletonJson.#getValue(constraintMap, "uniform", false);
                skeletonData.ikConstraints.push(data);
            }
        }
        // Transform constraints.
        if (root.transform)
        {
            for (let i = 0; i < root.transform.length; i++)
            {
                let constraintMap = root.transform[i];
                let data = new SpineTransformConstraintData(constraintMap.name);
                data.order = SpineSkeletonJson.#getValue(constraintMap, "order", 0);
                data.skinRequired = SpineSkeletonJson.#getValue(constraintMap, "skin", false);
                for (let ii = 0; ii < constraintMap.bones.length; ii++)
                    data.bones.push(skeletonData.findBone(constraintMap.bones[ii]));
                let targetName = constraintMap.target;
                data.target = skeletonData.findBone(targetName);
                data.local = SpineSkeletonJson.#getValue(constraintMap, "local", false);
                data.relative = SpineSkeletonJson.#getValue(constraintMap, "relative", false);
                data.offsetRotation = SpineSkeletonJson.#getValue(constraintMap, "rotation", 0);
                data.offsetX = SpineSkeletonJson.#getValue(constraintMap, "x", 0) * scale;
                data.offsetY = SpineSkeletonJson.#getValue(constraintMap, "y", 0) * scale;
                data.offsetScaleX = SpineSkeletonJson.#getValue(constraintMap, "scaleX", 0);
                data.offsetScaleY = SpineSkeletonJson.#getValue(constraintMap, "scaleY", 0);
                data.offsetShearY = SpineSkeletonJson.#getValue(constraintMap, "shearY", 0);
                data.mixRotate = SpineSkeletonJson.#getValue(constraintMap, "mixRotate", 1);
                data.mixX = SpineSkeletonJson.#getValue(constraintMap, "mixX", 1);
                data.mixY = SpineSkeletonJson.#getValue(constraintMap, "mixY", data.mixX);
                data.mixScaleX = SpineSkeletonJson.#getValue(constraintMap, "mixScaleX", 1);
                data.mixScaleY = SpineSkeletonJson.#getValue(constraintMap, "mixScaleY", data.mixScaleX);
                data.mixShearY = SpineSkeletonJson.#getValue(constraintMap, "mixShearY", 1);
                skeletonData.transformConstraints.push(data);
            }
        }
        // Path constraints.
        if (root.path)
        {
            for (let i = 0; i < root.path.length; i++)
            {
                let constraintMap = root.path[i];
                let data = new SpinePathConstraintData(constraintMap.name);
                data.order = SpineSkeletonJson.#getValue(constraintMap, "order", 0);
                data.skinRequired = SpineSkeletonJson.#getValue(constraintMap, "skin", false);
                for (let ii = 0; ii < constraintMap.bones.length; ii++)
                    data.bones.push(skeletonData.findBone(constraintMap.bones[ii]));
                let targetName = constraintMap.target;
                data.target = skeletonData.findSlot(targetName);
                data.positionMode = SpineUtils.enumValue(SpinePositionMode, SpineSkeletonJson.#getValue(constraintMap, "positionMode", "Percent"));
                data.spacingMode = SpineUtils.enumValue(SpineSpacingMode, SpineSkeletonJson.#getValue(constraintMap, "spacingMode", "Length"));
                data.rotateMode = SpineUtils.enumValue(SpineRotateMode, SpineSkeletonJson.#getValue(constraintMap, "rotateMode", "Tangent"));
                data.offsetRotation = SpineSkeletonJson.#getValue(constraintMap, "rotation", 0);
                data.position = SpineSkeletonJson.#getValue(constraintMap, "position", 0);
                if (data.positionMode == SpinePositionMode.Fixed)
                    data.position *= scale;
                data.spacing = SpineSkeletonJson.#getValue(constraintMap, "spacing", 0);
                if (data.spacingMode == SpineSpacingMode.Length || data.spacingMode == SpineSpacingMode.Fixed)
                    data.spacing *= scale;
                data.mixRotate = SpineSkeletonJson.#getValue(constraintMap, "mixRotate", 1);
                data.mixX = SpineSkeletonJson.#getValue(constraintMap, "mixX", 1);
                data.mixY = SpineSkeletonJson.#getValue(constraintMap, "mixY", data.mixX);
                skeletonData.pathConstraints.push(data);
            }
        }
        // Skins.
        if (root.skins)
        {
            for (let i = 0; i < root.skins.length; i++)
            {
                let skinMap = root.skins[i];
                let skin = new SpineSkin(skinMap.name);
                if (skinMap.bones)
                {
                    for (let ii = 0; ii < skinMap.bones.length; ii++)
                        skin.bones.push(skeletonData.findBone(skinMap.bones[ii]));
                }
                if (skinMap.ik)
                {
                    for (let ii = 0; ii < skinMap.ik.length; ii++)
                        skin.constraints.push(skeletonData.findIkConstraint(skinMap.ik[ii]));
                }
                if (skinMap.transform)
                {
                    for (let ii = 0; ii < skinMap.transform.length; ii++)
                        skin.constraints.push(skeletonData.findTransformConstraint(skinMap.transform[ii]));
                }
                if (skinMap.path)
                {
                    for (let ii = 0; ii < skinMap.path.length; ii++)
                        skin.constraints.push(skeletonData.findPathConstraint(skinMap.path[ii]));
                }
                for (let slotName in skinMap.attachments)
                {
                    let slot = skeletonData.findSlot(slotName);
                    let slotMap = skinMap.attachments[slotName];
                    for (let entryName in slotMap)
                    {
                        let attachment = this.readAttachment(slotMap[entryName], skin, slot.index, entryName, skeletonData);
                        if (attachment)
                            skin.setAttachment(slot.index, entryName, attachment);
                    }
                }
                skeletonData.skins.push(skin);
                if (skin.name == "default")
                    skeletonData.defaultSkin = skin;
            }
        }
        // Linked meshes.
        for (let i = 0, n = this.linkedMeshes.length; i < n; i++)
        {
            let linkedMesh = this.linkedMeshes[i];
            let skin = !linkedMesh.skin ? skeletonData.defaultSkin : skeletonData.findSkin(linkedMesh.skin);
            let parent = skin.getAttachment(linkedMesh.slotIndex, linkedMesh.parent);
            linkedMesh.mesh.deformAttachment = linkedMesh.inheritDeform ? parent : linkedMesh.mesh;
            linkedMesh.mesh.setParentMesh(parent);
            linkedMesh.mesh.updateUVs();
        }
        this.linkedMeshes.length = 0;
        // Events.
        if (root.events)
        {
            for (let eventName in root.events)
            {
                let eventMap = root.events[eventName];
                let data = new SpineEventData(eventName);
                data.intValue = SpineSkeletonJson.#getValue(eventMap, "int", 0);
                data.floatValue = SpineSkeletonJson.#getValue(eventMap, "float", 0);
                data.stringValue = SpineSkeletonJson.#getValue(eventMap, "string", "");
                data.audioPath = SpineSkeletonJson.#getValue(eventMap, "audio", null);
                if (data.audioPath)
                {
                    data.volume = SpineSkeletonJson.#getValue(eventMap, "volume", 1);
                    data.balance = SpineSkeletonJson.#getValue(eventMap, "balance", 0);
                }
                skeletonData.events.push(data);
            }
        }
        // Animations.
        if (root.animations)
        {
            for (let animationName in root.animations)
            {
                let animationMap = root.animations[animationName];
                this.readAnimation(animationMap, animationName, skeletonData);
            }
        }
        return skeletonData;
    }

    readAttachment(map, skin, slotIndex, name, skeletonData)
    {
        let scale = this.scale;
        name = SpineSkeletonJson.#getValue(map, "name", name);
        switch (SpineSkeletonJson.#getValue(map, "type", "region"))
        {
            case "region": {
                let path = SpineSkeletonJson.#getValue(map, "path", name);
                let region = this.attachmentLoader.newRegionAttachment(skin, name, path);
                if (!region)
                    return null;
                region.path = path;
                region.x = SpineSkeletonJson.#getValue(map, "x", 0) * scale;
                region.y = SpineSkeletonJson.#getValue(map, "y", 0) * scale;
                region.scaleX = SpineSkeletonJson.#getValue(map, "scaleX", 1);
                region.scaleY = SpineSkeletonJson.#getValue(map, "scaleY", 1);
                region.rotation = SpineSkeletonJson.#getValue(map, "rotation", 0);
                region.width = map.width * scale;
                region.height = map.height * scale;
                let color = SpineSkeletonJson.#getValue(map, "color", null);
                if (color)
                    region.color.setRGBAFromString(color);
                region.updateOffset();
                return region;
            }
            case "boundingbox": {
                let box = this.attachmentLoader.newBoundingBoxAttachment(skin, name);
                if (!box)
                    return null;
                this.readVertices(map, box, map.vertexCount << 1);
                let color = SpineSkeletonJson.#getValue(map, "color", null);
                if (color)
                    box.color.setRGBAFromString(color);
                return box;
            }
            case "mesh":
            case "linkedmesh": {
                let path = SpineSkeletonJson.#getValue(map, "path", name);
                let mesh = this.attachmentLoader.newMeshAttachment(skin, name, path);
                if (!mesh)
                    return null;
                mesh.path = path;
                let color = SpineSkeletonJson.#getValue(map, "color", null);
                if (color)
                    mesh.color.setRGBAFromString(color);
                mesh.width = SpineSkeletonJson.#getValue(map, "width", 0) * scale;
                mesh.height = SpineSkeletonJson.#getValue(map, "height", 0) * scale;
                let parent = SpineSkeletonJson.#getValue(map, "parent", null);
                if (parent)
                {
                    this.linkedMeshes.push(new SpineLinkedMesh(mesh, SpineSkeletonJson.#getValue(map, "skin", null), slotIndex, parent, SpineSkeletonJson.#getValue(map, "deform", true)));
                    return mesh;
                }
                let uvs = map.uvs;
                this.readVertices(map, mesh, uvs.length);
                mesh.triangles = map.triangles;
                mesh.regionUVs = uvs;
                mesh.updateUVs();
                mesh.edges = SpineSkeletonJson.#getValue(map, "edges", null);
                mesh.hullLength = SpineSkeletonJson.#getValue(map, "hull", 0) * 2;
                return mesh;
            }
            case "path": {
                let path = this.attachmentLoader.newPathAttachment(skin, name);
                if (!path)
                    return null;
                path.closed = SpineSkeletonJson.#getValue(map, "closed", false);
                path.constantSpeed = SpineSkeletonJson.#getValue(map, "constantSpeed", true);
                let vertexCount = map.vertexCount;
                this.readVertices(map, path, vertexCount << 1);
                let lengths = SpineUtils.newArray(vertexCount / 3, 0);
                for (let i = 0; i < map.lengths.length; i++)
                    lengths[i] = map.lengths[i] * scale;
                path.lengths = lengths;
                let color = SpineSkeletonJson.#getValue(map, "color", null);
                if (color)
                    path.color.setRGBAFromString(color);
                return path;
            }
            case "point": {
                let point = this.attachmentLoader.newPointAttachment(skin, name);
                if (!point)
                    return null;
                point.x = SpineSkeletonJson.#getValue(map, "x", 0) * scale;
                point.y = SpineSkeletonJson.#getValue(map, "y", 0) * scale;
                point.rotation = SpineSkeletonJson.#getValue(map, "rotation", 0);
                let color = SpineSkeletonJson.#getValue(map, "color", null);
                if (color)
                    point.color.setRGBAFromString(color);
                return point;
            }
            case "clipping": {
                let clip = this.attachmentLoader.newClippingAttachment(skin, name);
                if (!clip)
                    return null;
                let end = SpineSkeletonJson.#getValue(map, "end", null);
                if (end)
                    clip.endSlot = skeletonData.findSlot(end);
                let vertexCount = map.vertexCount;
                this.readVertices(map, clip, vertexCount << 1);
                let color = SpineSkeletonJson.#getValue(map, "color", null);
                if (color)
                    clip.color.setRGBAFromString(color);
                return clip;
            }
        }
        return null;
    }

    readVertices(map, attachment, verticesLength)
    {
        let scale = this.scale;
        attachment.worldVerticesLength = verticesLength;
        let vertices = map.vertices;
        if (verticesLength == vertices.length)
        {
            let scaledVertices = SpineUtils.toFloatArray(vertices);
            if (scale != 1)
            {
                for (let i = 0, n = vertices.length; i < n; i++)
                    scaledVertices[i] *= scale;
            }
            attachment.vertices = scaledVertices;
            return;
        }
        let weights = new Array();
        let bones = new Array();
        for (let i = 0, n = vertices.length; i < n;)
        {
            let boneCount = vertices[i++];
            bones.push(boneCount);
            for (let nn = i + boneCount * 4; i < nn; i += 4)
            {
                bones.push(vertices[i]);
                weights.push(vertices[i + 1] * scale);
                weights.push(vertices[i + 2] * scale);
                weights.push(vertices[i + 3]);
            }
        }
        attachment.bones = bones;
        attachment.vertices = SpineUtils.toFloatArray(weights);
    }

    readAnimation(map, name, skeletonData)
    {
        let scale = this.scale;
        let timelines = new Array();
        // Slot timelines.
        if (map.slots)
        {
            for (let slotName in map.slots)
            {
                let slotMap = map.slots[slotName];
                let slotIndex = skeletonData.findSlot(slotName).index;
                for (let timelineName in slotMap)
                {
                    let timelineMap = slotMap[timelineName];
                    if (!timelineMap)
                        continue;
                    let frames = timelineMap.length;
                    if (timelineName == "attachment")
                    {
                        let timeline = new SpineAttachmentTimeline(frames, slotIndex);
                        for (let frame = 0; frame < frames; frame++)
                        {
                            let keyMap = timelineMap[frame];
                            timeline.setFrame(frame, SpineSkeletonJson.#getValue(keyMap, "time", 0), keyMap.name);
                        }
                        timelines.push(timeline);
                    }
                    else if (timelineName == "rgba")
                    {
                        let timeline = new SpineRGBATimeline(frames, frames << 2, slotIndex);
                        let keyMap = timelineMap[0];
                        let time = SpineSkeletonJson.#getValue(keyMap, "time", 0);
                        let color = SpineSkeletonJson.#color(keyMap.color);
                        for (let frame = 0, bezier = 0;; frame++)
                        {
                            timeline.setFrame(frame, time, color.x, color.y, color.z, color.w);
                            let nextMap = timelineMap[frame + 1];
                            if (!nextMap)
                            {
                                timeline.shrink(bezier);
                                break;
                            }
                            let time2 = SpineSkeletonJson.#getValue(nextMap, "time", 0);
                            let newColor = SpineSkeletonJson.#color(nextMap.color);
                            let curve = keyMap.curve;
                            if (curve)
                            {
                                bezier = SpineSkeletonJson.#readCurve(curve, timeline, bezier, frame, 0, time, time2, color.x, newColor.x, 1);
                                bezier = SpineSkeletonJson.#readCurve(curve, timeline, bezier, frame, 1, time, time2, color.y, newColor.y, 1);
                                bezier = SpineSkeletonJson.#readCurve(curve, timeline, bezier, frame, 2, time, time2, color.z, newColor.z, 1);
                                bezier = SpineSkeletonJson.#readCurve(curve, timeline, bezier, frame, 3, time, time2, color.w, newColor.w, 1);
                            }
                            time = time2;
                            color = newColor;
                            keyMap = nextMap;
                        }
                        timelines.push(timeline);
                    }
                    else if (timelineName == "rgb")
                    {
                        let timeline = new SpineRGBTimeline(frames, frames * 3, slotIndex);
                        let keyMap = timelineMap[0];
                        let time = SpineSkeletonJson.#getValue(keyMap, "time", 0);
                        let color = SpineSkeletonJson.#color(keyMap.color);
                        for (let frame = 0, bezier = 0;; frame++)
                        {
                            timeline.setFrame(frame, time, color.x, color.y, color.z);
                            let nextMap = timelineMap[frame + 1];
                            if (!nextMap)
                            {
                                timeline.shrink(bezier);
                                break;
                            }
                            let time2 = SpineSkeletonJson.#getValue(nextMap, "time", 0);
                            let newColor = SpineSkeletonJson.#color(nextMap.color);
                            let curve = keyMap.curve;
                            if (curve)
                            {
                                bezier = SpineSkeletonJson.#readCurve(curve, timeline, bezier, frame, 0, time, time2, color.x, newColor.x, 1);
                                bezier = SpineSkeletonJson.#readCurve(curve, timeline, bezier, frame, 1, time, time2, color.y, newColor.y, 1);
                                bezier = SpineSkeletonJson.#readCurve(curve, timeline, bezier, frame, 2, time, time2, color.z, newColor.z, 1);
                            }
                            time = time2;
                            color = newColor;
                            keyMap = nextMap;
                        }
                        timelines.push(timeline);
                    }
                    else if (timelineName == "alpha")
                    {
                        timelines.push(SpineSkeletonJson.#readTimeline1(timelineMap, new SpineAlphaTimeline(frames, frames, slotIndex), 0, 1));
                    }
                    else if (timelineName == "rgba2")
                    {
                        let timeline = new SpineRGBA2Timeline(frames, frames * 7, slotIndex);
                        let keyMap = timelineMap[0];
                        let time = SpineSkeletonJson.#getValue(keyMap, "time", 0);
                        let color = SpineSkeletonJson.#color(keyMap.light);
                        let color2 = SpineSkeletonJson.#color(keyMap.dark);
                        for (let frame = 0, bezier = 0;; frame++)
                        {
                            timeline.setFrame(frame, time, color.x, color.y, color.z, color.w, color2.x, color2.y, color2.z);
                            let nextMap = timelineMap[frame + 1];
                            if (!nextMap)
                            {
                                timeline.shrink(bezier);
                                break;
                            }
                            let time2 = SpineSkeletonJson.#getValue(nextMap, "time", 0);
                            let newColor = SpineSkeletonJson.#color(nextMap.light);
                            let newColor2 = SpineSkeletonJson.#color(nextMap.dark);
                            let curve = keyMap.curve;
                            if (curve)
                            {
                                bezier = SpineSkeletonJson.#readCurve(curve, timeline, bezier, frame, 0, time, time2, color.x, newColor.x, 1);
                                bezier = SpineSkeletonJson.#readCurve(curve, timeline, bezier, frame, 1, time, time2, color.y, newColor.y, 1);
                                bezier = SpineSkeletonJson.#readCurve(curve, timeline, bezier, frame, 2, time, time2, color.z, newColor.z, 1);
                                bezier = SpineSkeletonJson.#readCurve(curve, timeline, bezier, frame, 3, time, time2, color.w, newColor.w, 1);
                                bezier = SpineSkeletonJson.#readCurve(curve, timeline, bezier, frame, 4, time, time2, color2.x, newColor2.x, 1);
                                bezier = SpineSkeletonJson.#readCurve(curve, timeline, bezier, frame, 5, time, time2, color2.y, newColor2.y, 1);
                                bezier = SpineSkeletonJson.#readCurve(curve, timeline, bezier, frame, 6, time, time2, color2.z, newColor2.z, 1);
                            }
                            time = time2;
                            color = newColor;
                            color2 = newColor2;
                            keyMap = nextMap;
                        }
                        timelines.push(timeline);
                    }
                    else if (timelineName == "rgb2")
                    {
                        let timeline = new SpineRGB2Timeline(frames, frames * 6, slotIndex);
                        let keyMap = timelineMap[0];
                        let time = SpineSkeletonJson.#getValue(keyMap, "time", 0);
                        let color = SpineSkeletonJson.#color(keyMap.light);
                        let color2 = SpineSkeletonJson.#color(keyMap.dark);
                        for (let frame = 0, bezier = 0;; frame++)
                        {
                            timeline.setFrame(frame, time, color.x, color.y, color.z, color2.x, color2.y, color2.z);
                            let nextMap = timelineMap[frame + 1];
                            if (!nextMap)
                            {
                                timeline.shrink(bezier);
                                break;
                            }
                            let time2 = SpineSkeletonJson.#getValue(nextMap, "time", 0);
                            let newColor = SpineSkeletonJson.#color(nextMap.light);
                            let newColor2 = SpineSkeletonJson.#color(nextMap.dark);
                            let curve = keyMap.curve;
                            if (curve)
                            {
                                bezier = SpineSkeletonJson.#readCurve(curve, timeline, bezier, frame, 0, time, time2, color.x, newColor.x, 1);
                                bezier = SpineSkeletonJson.#readCurve(curve, timeline, bezier, frame, 1, time, time2, color.y, newColor.y, 1);
                                bezier = SpineSkeletonJson.#readCurve(curve, timeline, bezier, frame, 2, time, time2, color.z, newColor.z, 1);
                                bezier = SpineSkeletonJson.#readCurve(curve, timeline, bezier, frame, 3, time, time2, color2.x, newColor2.x, 1);
                                bezier = SpineSkeletonJson.#readCurve(curve, timeline, bezier, frame, 4, time, time2, color2.y, newColor2.y, 1);
                                bezier = SpineSkeletonJson.#readCurve(curve, timeline, bezier, frame, 5, time, time2, color2.z, newColor2.z, 1);
                            }
                            time = time2;
                            color = newColor;
                            color2 = newColor2;
                            keyMap = nextMap;
                        }
                        timelines.push(timeline);
                    }
                }
            }
        }
        // Bone timelines.
        if (map.bones)
        {
            for (let boneName in map.bones)
            {
                let boneMap = map.bones[boneName];
                let boneIndex = skeletonData.findBone(boneName).index;
                for (let timelineName in boneMap)
                {
                    let timelineMap = boneMap[timelineName];
                    let frames = timelineMap.length;
                    if (frames == 0)
                        continue;
                    if (timelineName === "rotate")
                    {
                        timelines.push(SpineSkeletonJson.#readTimeline1(timelineMap, new SpineRotateTimeline(frames, frames, boneIndex), 0, 1));
                    }
                    else if (timelineName === "translate")
                    {
                        let timeline = new SpineTranslateTimeline(frames, frames << 1, boneIndex);
                        timelines.push(SpineSkeletonJson.#readTimeline2(timelineMap, timeline, "x", "y", 0, scale));
                    }
                    else if (timelineName === "translatex")
                    {
                        let timeline = new SpineTranslateXTimeline(frames, frames, boneIndex);
                        timelines.push(SpineSkeletonJson.#readTimeline1(timelineMap, timeline, 0, scale));
                    }
                    else if (timelineName === "translatey")
                    {
                        let timeline = new SpineTranslateYTimeline(frames, frames, boneIndex);
                        timelines.push(SpineSkeletonJson.#readTimeline1(timelineMap, timeline, 0, scale));
                    }
                    else if (timelineName === "scale")
                    {
                        let timeline = new SpineScaleTimeline(frames, frames << 1, boneIndex);
                        timelines.push(SpineSkeletonJson.#readTimeline2(timelineMap, timeline, "x", "y", 1, 1));
                    }
                    else if (timelineName === "scalex")
                    {
                        let timeline = new SpineScaleXTimeline(frames, frames, boneIndex);
                        timelines.push(SpineSkeletonJson.#readTimeline1(timelineMap, timeline, 1, 1));
                    }
                    else if (timelineName === "scaley")
                    {
                        let timeline = new SpineScaleYTimeline(frames, frames, boneIndex);
                        timelines.push(SpineSkeletonJson.#readTimeline1(timelineMap, timeline, 1, 1));
                    }
                    else if (timelineName === "shear")
                    {
                        let timeline = new SpineShearTimeline(frames, frames << 1, boneIndex);
                        timelines.push(SpineSkeletonJson.#readTimeline2(timelineMap, timeline, "x", "y", 0, 1));
                    }
                    else if (timelineName === "shearx")
                    {
                        let timeline = new SpineShearXTimeline(frames, frames, boneIndex);
                        timelines.push(SpineSkeletonJson.#readTimeline1(timelineMap, timeline, 0, 1));
                    }
                    else if (timelineName === "sheary")
                    {
                        let timeline = new SpineShearYTimeline(frames, frames, boneIndex);
                        timelines.push(SpineSkeletonJson.#readTimeline1(timelineMap, timeline, 0, 1));
                    }
                }
            }
        }
        // IK constraint timelines.
        if (map.ik)
        {
            for (let constraintName in map.ik)
            {
                let constraintMap = map.ik[constraintName];
                let keyMap = constraintMap[0];
                if (!keyMap)
                    continue;
                let constraint = skeletonData.findIkConstraint(constraintName);
                let constraintIndex = skeletonData.ikConstraints.indexOf(constraint);
                let timeline = new SpineIkConstraintTimeline(constraintMap.length, constraintMap.length << 1, constraintIndex);
                let time = SpineSkeletonJson.#getValue(keyMap, "time", 0);
                let mix = SpineSkeletonJson.#getValue(keyMap, "mix", 1);
                let softness = SpineSkeletonJson.#getValue(keyMap, "softness", 0) * scale;
                for (let frame = 0, bezier = 0;; frame++)
                {
                    timeline.setFrame(frame, time, mix, softness, SpineSkeletonJson.#getValue(keyMap, "bendPositive", true) ? 1 : -1, SpineSkeletonJson.#getValue(keyMap, "compress", false), SpineSkeletonJson.#getValue(keyMap, "stretch", false));
                    let nextMap = constraintMap[frame + 1];
                    if (!nextMap)
                    {
                        timeline.shrink(bezier);
                        break;
                    }
                    let time2 = SpineSkeletonJson.#getValue(nextMap, "time", 0);
                    let mix2 = SpineSkeletonJson.#getValue(nextMap, "mix", 1);
                    let softness2 = SpineSkeletonJson.#getValue(nextMap, "softness", 0) * scale;
                    let curve = keyMap.curve;
                    if (curve)
                    {
                        bezier = SpineSkeletonJson.#readCurve(curve, timeline, bezier, frame, 0, time, time2, mix, mix2, 1);
                        bezier = SpineSkeletonJson.#readCurve(curve, timeline, bezier, frame, 1, time, time2, softness, softness2, scale);
                    }
                    time = time2;
                    mix = mix2;
                    softness = softness2;
                    keyMap = nextMap;
                }
                timelines.push(timeline);
            }
        }
        // Transform constraint timelines.
        if (map.transform)
        {
            for (let constraintName in map.transform)
            {
                let timelineMap = map.transform[constraintName];
                let keyMap = timelineMap[0];
                if (!keyMap)
                    continue;
                let constraint = skeletonData.findTransformConstraint(constraintName);
                let constraintIndex = skeletonData.transformConstraints.indexOf(constraint);
                let timeline = new SpineTransformConstraintTimeline(timelineMap.length, timelineMap.length * 6, constraintIndex);
                let time = SpineSkeletonJson.#getValue(keyMap, "time", 0);
                let mixRotate = SpineSkeletonJson.#getValue(keyMap, "mixRotate", 1);
                let mixX = SpineSkeletonJson.#getValue(keyMap, "mixX", 1);
                let mixY = SpineSkeletonJson.#getValue(keyMap, "mixY", mixX);
                let mixScaleX = SpineSkeletonJson.#getValue(keyMap, "mixScaleX", 1);
                let mixScaleY = SpineSkeletonJson.#getValue(keyMap, "mixScaleY", mixScaleX);
                let mixShearY = SpineSkeletonJson.#getValue(keyMap, "mixShearY", 1);
                for (let frame = 0, bezier = 0;; frame++)
                {
                    timeline.setFrame(frame, time, mixRotate, mixX, mixY, mixScaleX, mixScaleY, mixShearY);
                    let nextMap = timelineMap[frame + 1];
                    if (!nextMap)
                    {
                        timeline.shrink(bezier);
                        break;
                    }
                    let time2 = SpineSkeletonJson.#getValue(nextMap, "time", 0);
                    let mixRotate2 = SpineSkeletonJson.#getValue(nextMap, "mixRotate", 1);
                    let mixX2 = SpineSkeletonJson.#getValue(nextMap, "mixX", 1);
                    let mixY2 = SpineSkeletonJson.#getValue(nextMap, "mixY", mixX2);
                    let mixScaleX2 = SpineSkeletonJson.#getValue(nextMap, "mixScaleX", 1);
                    let mixScaleY2 = SpineSkeletonJson.#getValue(nextMap, "mixScaleY", mixScaleX2);
                    let mixShearY2 = SpineSkeletonJson.#getValue(nextMap, "mixShearY", 1);
                    let curve = keyMap.curve;
                    if (curve)
                    {
                        bezier = SpineSkeletonJson.#readCurve(curve, timeline, bezier, frame, 0, time, time2, mixRotate, mixRotate2, 1);
                        bezier = SpineSkeletonJson.#readCurve(curve, timeline, bezier, frame, 1, time, time2, mixX, mixX2, 1);
                        bezier = SpineSkeletonJson.#readCurve(curve, timeline, bezier, frame, 2, time, time2, mixY, mixY2, 1);
                        bezier = SpineSkeletonJson.#readCurve(curve, timeline, bezier, frame, 3, time, time2, mixScaleX, mixScaleX2, 1);
                        bezier = SpineSkeletonJson.#readCurve(curve, timeline, bezier, frame, 4, time, time2, mixScaleY, mixScaleY2, 1);
                        bezier = SpineSkeletonJson.#readCurve(curve, timeline, bezier, frame, 5, time, time2, mixShearY, mixShearY2, 1);
                    }
                    time = time2;
                    mixRotate = mixRotate2;
                    mixX = mixX2;
                    mixY = mixY2;
                    mixScaleX = mixScaleX2;
                    mixScaleY = mixScaleY2;
                    mixScaleX = mixScaleX2;
                    keyMap = nextMap;
                }
                timelines.push(timeline);
            }
        }
        // Path constraint timelines.
        if (map.path)
        {
            for (let constraintName in map.path)
            {
                let constraintMap = map.path[constraintName];
                let constraint = skeletonData.findPathConstraint(constraintName);
                let constraintIndex = skeletonData.pathConstraints.indexOf(constraint);
                for (let timelineName in constraintMap)
                {
                    let timelineMap = constraintMap[timelineName];
                    let keyMap = timelineMap[0];
                    if (!keyMap)
                        continue;
                    let frames = timelineMap.length;
                    if (timelineName === "position")
                    {
                        let timeline = new SpinePathConstraintPositionTimeline(frames, frames, constraintIndex);
                        timelines.push(SpineSkeletonJson.#readTimeline1(timelineMap, timeline, 0, constraint.positionMode == SpinePositionMode.Fixed ? scale : 1));
                    }
                    else if (timelineName === "spacing")
                    {
                        let timeline = new SpinePathConstraintSpacingTimeline(frames, frames, constraintIndex);
                        timelines.push(SpineSkeletonJson.#readTimeline1(timelineMap, timeline, 0, constraint.spacingMode == SpineSpacingMode.Length || constraint.spacingMode == SpineSpacingMode.Fixed ? scale : 1));
                    }
                    else if (timelineName === "mix")
                    {
                        let timeline = new SpinePathConstraintMixTimeline(frames, frames * 3, constraintIndex);
                        let time = SpineSkeletonJson.#getValue(keyMap, "time", 0);
                        let mixRotate = SpineSkeletonJson.#getValue(keyMap, "mixRotate", 1);
                        let mixX = SpineSkeletonJson.#getValue(keyMap, "mixX", 1);
                        let mixY = SpineSkeletonJson.#getValue(keyMap, "mixY", mixX);
                        for (let frame = 0, bezier = 0;; frame++)
                        {
                            timeline.setFrame(frame, time, mixRotate, mixX, mixY);
                            let nextMap = timelineMap[frame + 1];
                            if (!nextMap)
                            {
                                timeline.shrink(bezier);
                                break;
                            }
                            let time2 = SpineSkeletonJson.#getValue(nextMap, "time", 0);
                            let mixRotate2 = SpineSkeletonJson.#getValue(nextMap, "mixRotate", 1);
                            let mixX2 = SpineSkeletonJson.#getValue(nextMap, "mixX", 1);
                            let mixY2 = SpineSkeletonJson.#getValue(nextMap, "mixY", mixX2);
                            let curve = keyMap.curve;
                            if (curve)
                            {
                                bezier = SpineSkeletonJson.#readCurve(curve, timeline, bezier, frame, 0, time, time2, mixRotate, mixRotate2, 1);
                                bezier = SpineSkeletonJson.#readCurve(curve, timeline, bezier, frame, 1, time, time2, mixX, mixX2, 1);
                                bezier = SpineSkeletonJson.#readCurve(curve, timeline, bezier, frame, 2, time, time2, mixY, mixY2, 1);
                            }
                            time = time2;
                            mixRotate = mixRotate2;
                            mixX = mixX2;
                            mixY = mixY2;
                            keyMap = nextMap;
                        }
                        timelines.push(timeline);
                    }
                }
            }
        }
        // Deform timelines.
        if (map.deform)
        {
            for (let deformName in map.deform)
            {
                let deformMap = map.deform[deformName];
                let skin = skeletonData.findSkin(deformName);
                for (let slotName in deformMap)
                {
                    let slotMap = deformMap[slotName];
                    let slotIndex = skeletonData.findSlot(slotName).index;
                    for (let timelineName in slotMap)
                    {
                        let timelineMap = slotMap[timelineName];
                        let keyMap = timelineMap[0];
                        if (!keyMap)
                            continue;
                        let attachment = skin.getAttachment(slotIndex, timelineName);
                        let weighted = attachment.bones;
                        let vertices = attachment.vertices;
                        let deformLength = weighted ? vertices.length / 3 * 2 : vertices.length;
                        let timeline = new SpineDeformTimeline(timelineMap.length, timelineMap.length, slotIndex, attachment);
                        let time = SpineSkeletonJson.#getValue(keyMap, "time", 0);
                        for (let frame = 0, bezier = 0;; frame++)
                        {
                            let deform;
                            let verticesValue = SpineSkeletonJson.#getValue(keyMap, "vertices", null);
                            if (!verticesValue)
                                deform = weighted ? new Float32Array(deformLength) : vertices;
                            else
                            {
                                deform = new Float32Array(deformLength);
                                let start = SpineSkeletonJson.#getValue(keyMap, "offset", 0);
                                SpineUtils.arrayCopy(verticesValue, 0, deform, start, verticesValue.length);
                                if (scale != 1)
                                {
                                    for (let i = start, n = i + verticesValue.length; i < n; i++)
                                        deform[i] *= scale;
                                }
                                if (!weighted)
                                {
                                    for (let i = 0; i < deformLength; i++)
                                        deform[i] += vertices[i];
                                }
                            }
                            timeline.setFrame(frame, time, deform);
                            let nextMap = timelineMap[frame + 1];
                            if (!nextMap)
                            {
                                timeline.shrink(bezier);
                                break;
                            }
                            let time2 = SpineSkeletonJson.#getValue(nextMap, "time", 0);
                            let curve = keyMap.curve;
                            if (curve)
                                bezier = SpineSkeletonJson.#readCurve(curve, timeline, bezier, frame, 0, time, time2, 0, 1, 1);
                            time = time2;
                            keyMap = nextMap;
                        }
                        timelines.push(timeline);
                    }
                }
            }
        }
        // Draw order timelines.
        if (map.drawOrder)
        {
            let timeline = new SpineDrawOrderTimeline(map.drawOrder.length);
            let slotCount = skeletonData.slots.length;
            let frame = 0;
            for (let i = 0; i < map.drawOrder.length; i++, frame++)
            {
                let drawOrderMap = map.drawOrder[i];
                let drawOrder = null;
                let offsets = SpineSkeletonJson.#getValue(drawOrderMap, "offsets", null);
                if (offsets)
                {
                    drawOrder = SpineUtils.newArray(slotCount, -1);
                    let unchanged = SpineUtils.newArray(slotCount - offsets.length, 0);
                    let originalIndex = 0, unchangedIndex = 0;
                    for (let ii = 0; ii < offsets.length; ii++)
                    {
                        let offsetMap = offsets[ii];
                        let slotIndex = skeletonData.findSlot(offsetMap.slot).index;
                        // Collect unchanged items.
                        while (originalIndex != slotIndex)
                            unchanged[unchangedIndex++] = originalIndex++;
                        // Set changed items.
                        drawOrder[originalIndex + offsetMap.offset] = originalIndex++;
                    }
                    // Collect remaining unchanged items.
                    while (originalIndex < slotCount)
                        unchanged[unchangedIndex++] = originalIndex++;
                    // Fill in unchanged items.
                    for (let ii = slotCount - 1; ii >= 0; ii--)
                        if (drawOrder[ii] == -1)
                            drawOrder[ii] = unchanged[--unchangedIndex];
                }
                timeline.setFrame(frame, SpineSkeletonJson.#getValue(drawOrderMap, "time", 0), drawOrder);
            }
            timelines.push(timeline);
        }
        // Event timelines.
        if (map.events)
        {
            let timeline = new SpineEventTimeline(map.events.length);
            let frame = 0;
            for (let i = 0; i < map.events.length; i++, frame++)
            {
                let eventMap = map.events[i];
                let eventData = skeletonData.findEvent(eventMap.name);
                let event = new SpineEvent(SpineUtils.toSinglePrecision(SpineSkeletonJson.#getValue(eventMap, "time", 0)), eventData);
                event.intValue = SpineSkeletonJson.#getValue(eventMap, "int", eventData.intValue);
                event.floatValue = SpineSkeletonJson.#getValue(eventMap, "float", eventData.floatValue);
                event.stringValue = SpineSkeletonJson.#getValue(eventMap, "string", eventData.stringValue);
                if (event.data.audioPath)
                {
                    event.volume = SpineSkeletonJson.#getValue(eventMap, "volume", 1);
                    event.balance = SpineSkeletonJson.#getValue(eventMap, "balance", 0);
                }
                timeline.setFrame(frame, event);
            }
            timelines.push(timeline);
        }
        let duration = 0;
        for (let i = 0, n = timelines.length; i < n; i++)
            duration = Math.max(duration, timelines[i].getDuration());
        skeletonData.animations.push(new SpineAnimation(name, timelines, duration));
    }

    // *** Internal Methods (module-level functions in Spine's SkeletonJson.ts) ***

    static #readTimeline1(keys, timeline, defaultValue, scale)
    {
        let keyMap = keys[0];
        let time = SpineSkeletonJson.#getValue(keyMap, "time", 0);
        let value = SpineSkeletonJson.#getValue(keyMap, "value", defaultValue) * scale;
        let bezier = 0;

        for (let frame = 0;; frame++)
        {
            timeline.setFrame(frame, time, value);
            let nextMap = keys[frame + 1];
            if (!nextMap)
            {
                timeline.shrink(bezier);
                return timeline;
            }
            let time2 = SpineSkeletonJson.#getValue(nextMap, "time", 0);
            let value2 = SpineSkeletonJson.#getValue(nextMap, "value", defaultValue) * scale;
            if (keyMap.curve)
                bezier = SpineSkeletonJson.#readCurve(keyMap.curve, timeline, bezier, frame, 0, time, time2, value, value2, scale);
            time = time2;
            value = value2;
            keyMap = nextMap;
        }
    }

    static #readTimeline2(keys, timeline, name1, name2, defaultValue, scale)
    {
        let keyMap = keys[0];
        let time = SpineSkeletonJson.#getValue(keyMap, "time", 0);
        let value1 = SpineSkeletonJson.#getValue(keyMap, name1, defaultValue) * scale;
        let value2 = SpineSkeletonJson.#getValue(keyMap, name2, defaultValue) * scale;
        let bezier = 0;

        for (let frame = 0;; frame++)
        {
            timeline.setFrame(frame, time, value1, value2);
            let nextMap = keys[frame + 1];
            if (!nextMap)
            {
                timeline.shrink(bezier);
                return timeline;
            }
            let time2 = SpineSkeletonJson.#getValue(nextMap, "time", 0);
            let nvalue1 = SpineSkeletonJson.#getValue(nextMap, name1, defaultValue) * scale;
            let nvalue2 = SpineSkeletonJson.#getValue(nextMap, name2, defaultValue) * scale;
            let curve = keyMap.curve;
            if (curve)
            {
                bezier = SpineSkeletonJson.#readCurve(curve, timeline, bezier, frame, 0, time, time2, value1, nvalue1, scale);
                bezier = SpineSkeletonJson.#readCurve(curve, timeline, bezier, frame, 1, time, time2, value2, nvalue2, scale);
            }
            time = time2;
            value1 = nvalue1;
            value2 = nvalue2;
            keyMap = nextMap;
        }
    }

    static #readCurve(curve, timeline, bezier, frame, value, time1, time2, value1, value2, scale)
    {
        if (curve == "stepped")
        {
            timeline.setStepped(frame);
            return bezier;
        }

        let i = value << 2;
        let cx1 = curve[i];
        let cy1 = curve[i + 1] * scale;
        let cx2 = curve[i + 2];
        let cy2 = curve[i + 3] * scale;
        timeline.setBezier(bezier, frame, value, time1, value1, cx1, cy1, cx2, cy2, time2, value2);
        return bezier + 1;
    }

    static #getValue(map, property, defaultValue)
    {
        return map[property] !== undefined ? map[property] : defaultValue;
    }

    // A new color (Vector4: r, g, b, a in x, y, z, w) from Spine's "rrggbbaa" or "rrggbb" (Vector4.setRGBAFromString())
    static #color(hex)
    {
        let color = new Vector4();

        color.setRGBAFromString(hex);
            return color;
    }
}

class SpineLinkedMesh
{
    parent;
    skin;
    slotIndex;
    mesh;
    inheritDeform;

    constructor(mesh, skin, slotIndex, parent, inheritDeform)
    {
        this.mesh = mesh;
        this.skin = skin;
        this.slotIndex = slotIndex;
        this.parent = parent;
        this.inheritDeform = inheritDeform;
    }
}
