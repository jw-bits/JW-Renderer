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
    Spine skeletons, ported from spine-core 4.0.31 (Bone.ts, Slot.ts,
    IkConstraint.ts, TransformConstraint.ts, PathConstraint.ts, Skeleton.ts);
    see docs/spine_plan.md. What changes while a skeleton plays; its
    SpineSkeletonData is shared and read-only.

        SpineBone                 A bone's local transform and its world transform (a, b, c, d, worldX, worldY)
        SpineSlot                 A slot's color, attachment and deform vertices
        SpineIkConstraint         Bends one or two bones to reach a target
        SpineTransformConstraint  Copies another bone's transform onto bones
        SpinePathConstraint       Moves bones along a path attachment
        SpineSkeleton             The bones, slots and constraints in update order

    Usage:
        let skeleton = new SpineSkeleton(data);   // A SpineSkeletonData (see SpineSkeletonData.load())
        skeleton.x = 400;                         // Where the root goes, in design units
        skeleton.setToSetupPose();
        skeleton.updateWorldTransform();          // After changing bones (or applying animations)

    Spine's +Y is up, like the engine's design units, so a skeleton draws the
    right way up with no flipping. SpineSkeletonDebug (spine_debug.js) draws
    its bones and attachments; Skeleton2D (Phase 3) draws its images.
*/

/** Stores a bone's current pose.
 *
 * A bone has a local transform which is used to compute its world transform. A bone also has an applied transform, which is a
 * local transform that can be applied to compute the world transform. The local transform and applied transform may differ if a
 * constraint or application code modifies the world transform after it was computed from the local transform. */
class SpineBone
{
    /** The bone's setup pose data. */
    data = null;

    /** The skeleton this bone belongs to. */
    skeleton = null;

    /** The parent bone, or null if this is the root bone. */
    parent = null;

    /** The immediate children of this bone. */
    children = new Array();

    /** The local x translation. */
    x = 0;

    /** The local y translation. */
    y = 0;

    /** The local rotation in degrees, counter clockwise. */
    rotation = 0;

    /** The local scaleX. */
    scaleX = 0;

    /** The local scaleY. */
    scaleY = 0;

    /** The local shearX. */
    shearX = 0;

    /** The local shearY. */
    shearY = 0;

    /** The applied local x translation. */
    ax = 0;

    /** The applied local y translation. */
    ay = 0;

    /** The applied local rotation in degrees, counter clockwise. */
    arotation = 0;

    /** The applied local scaleX. */
    ascaleX = 0;

    /** The applied local scaleY. */
    ascaleY = 0;

    /** The applied local shearX. */
    ashearX = 0;

    /** The applied local shearY. */
    ashearY = 0;

    /** Part of the world transform matrix for the X axis. If changed, {@link #updateAppliedTransform()} should be called. */
    a = 0;

    /** Part of the world transform matrix for the Y axis. If changed, {@link #updateAppliedTransform()} should be called. */
    b = 0;

    /** Part of the world transform matrix for the X axis. If changed, {@link #updateAppliedTransform()} should be called. */
    c = 0;

    /** Part of the world transform matrix for the Y axis. If changed, {@link #updateAppliedTransform()} should be called. */
    d = 0;

    /** The world X position. If changed, {@link #updateAppliedTransform()} should be called. */
    worldY = 0;

    /** The world Y position. If changed, {@link #updateAppliedTransform()} should be called. */
    worldX = 0;
    sorted = false;
    active = false;

    /** @param parent May be null. */
    constructor(data, skeleton, parent)
    {
        if (!data)
            throw new Error("data cannot be null.");
        if (!skeleton)
            throw new Error("skeleton cannot be null.");
        this.data = data;
        this.skeleton = skeleton;
        this.parent = parent;
        this.setToSetupPose();
    }

    /** Returns false when the bone has not been computed because {@link BoneData#skinRequired} is true and the
      * {@link Skeleton#skin active skin} does not {@link Skin#bones contain} this bone. */
    isActive()
    {
        return this.active;
    }

    /** Computes the world transform using the parent bone and this bone's local applied transform. */
    update()
    {
        this.updateWorldTransformWith(this.ax, this.ay, this.arotation, this.ascaleX, this.ascaleY, this.ashearX, this.ashearY);
    }

    /** Computes the world transform using the parent bone and this bone's local transform.
     *
     * See {@link #updateWorldTransformWith()}. */
    updateWorldTransform()
    {
        this.updateWorldTransformWith(this.x, this.y, this.rotation, this.scaleX, this.scaleY, this.shearX, this.shearY);
    }

    /** Computes the world transform using the parent bone and the specified local transform. The applied transform is set to the
     * specified local transform. Child bones are not updated.
     *
     * See [World transforms](http://esotericsoftware.com/spine-runtime-skeletons#World-transforms) in the Spine
     * Runtimes Guide. */
    updateWorldTransformWith(x, y, rotation, scaleX, scaleY, shearX, shearY)
    {
        this.ax = x;
        this.ay = y;
        this.arotation = rotation;
        this.ascaleX = scaleX;
        this.ascaleY = scaleY;
        this.ashearX = shearX;
        this.ashearY = shearY;
        let parent = this.parent;
        if (!parent) { // Root bone.
            let skeleton = this.skeleton;
            let rotationY = rotation + 90 + shearY;
            let sx = skeleton.scaleX;
            let sy = skeleton.scaleY;
            this.a = SpineMathUtils.cosDeg(rotation + shearX) * scaleX * sx;
            this.b = SpineMathUtils.cosDeg(rotationY) * scaleY * sx;
            this.c = SpineMathUtils.sinDeg(rotation + shearX) * scaleX * sy;
            this.d = SpineMathUtils.sinDeg(rotationY) * scaleY * sy;
            this.worldX = x * sx + skeleton.x;
            this.worldY = y * sy + skeleton.y;
            return;
        }
        let pa = parent.a, pb = parent.b, pc = parent.c, pd = parent.d;
        this.worldX = pa * x + pb * y + parent.worldX;
        this.worldY = pc * x + pd * y + parent.worldY;
        switch (this.data.transformMode)
        {
            case SpineTransformMode.Normal: {
                let rotationY = rotation + 90 + shearY;
                let la = SpineMathUtils.cosDeg(rotation + shearX) * scaleX;
                let lb = SpineMathUtils.cosDeg(rotationY) * scaleY;
                let lc = SpineMathUtils.sinDeg(rotation + shearX) * scaleX;
                let ld = SpineMathUtils.sinDeg(rotationY) * scaleY;
                this.a = pa * la + pb * lc;
                this.b = pa * lb + pb * ld;
                this.c = pc * la + pd * lc;
                this.d = pc * lb + pd * ld;
                return;
            }
            case SpineTransformMode.OnlyTranslation: {
                let rotationY = rotation + 90 + shearY;
                this.a = SpineMathUtils.cosDeg(rotation + shearX) * scaleX;
                this.b = SpineMathUtils.cosDeg(rotationY) * scaleY;
                this.c = SpineMathUtils.sinDeg(rotation + shearX) * scaleX;
                this.d = SpineMathUtils.sinDeg(rotationY) * scaleY;
                break;
            }
            case SpineTransformMode.NoRotationOrReflection: {
                let s = pa * pa + pc * pc;
                let prx = 0;
                if (s > 0.0001)
                {
                    s = Math.abs(pa * pd - pb * pc) / s;
                    pa /= this.skeleton.scaleX;
                    pc /= this.skeleton.scaleY;
                    pb = pc * s;
                    pd = pa * s;
                    prx = Math.atan2(pc, pa) * SpineMathUtils.radDeg;
                }
                else
                {
                    pa = 0;
                    pc = 0;
                    prx = 90 - Math.atan2(pd, pb) * SpineMathUtils.radDeg;
                }
                let rx = rotation + shearX - prx;
                let ry = rotation + shearY - prx + 90;
                let la = SpineMathUtils.cosDeg(rx) * scaleX;
                let lb = SpineMathUtils.cosDeg(ry) * scaleY;
                let lc = SpineMathUtils.sinDeg(rx) * scaleX;
                let ld = SpineMathUtils.sinDeg(ry) * scaleY;
                this.a = pa * la - pb * lc;
                this.b = pa * lb - pb * ld;
                this.c = pc * la + pd * lc;
                this.d = pc * lb + pd * ld;
                break;
            }
            case SpineTransformMode.NoScale:
            case SpineTransformMode.NoScaleOrReflection: {
                let cos = SpineMathUtils.cosDeg(rotation);
                let sin = SpineMathUtils.sinDeg(rotation);
                let za = (pa * cos + pb * sin) / this.skeleton.scaleX;
                let zc = (pc * cos + pd * sin) / this.skeleton.scaleY;
                let s = Math.sqrt(za * za + zc * zc);
                if (s > 0.00001)
                    s = 1 / s;
                za *= s;
                zc *= s;
                s = Math.sqrt(za * za + zc * zc);
                if (this.data.transformMode == SpineTransformMode.NoScale
                    && (pa * pd - pb * pc < 0) != (this.skeleton.scaleX < 0 != this.skeleton.scaleY < 0))
                    s = -s;
                let r = Math.PI / 2 + Math.atan2(zc, za);
                let zb = Math.cos(r) * s;
                let zd = Math.sin(r) * s;
                let la = SpineMathUtils.cosDeg(shearX) * scaleX;
                let lb = SpineMathUtils.cosDeg(90 + shearY) * scaleY;
                let lc = SpineMathUtils.sinDeg(shearX) * scaleX;
                let ld = SpineMathUtils.sinDeg(90 + shearY) * scaleY;
                this.a = za * la + zb * lc;
                this.b = za * lb + zb * ld;
                this.c = zc * la + zd * lc;
                this.d = zc * lb + zd * ld;
                break;
            }
        }
        this.a *= this.skeleton.scaleX;
        this.b *= this.skeleton.scaleX;
        this.c *= this.skeleton.scaleY;
        this.d *= this.skeleton.scaleY;
    }

    /** Sets this bone's local transform to the setup pose. */
    setToSetupPose()
    {
        let data = this.data;
        this.x = data.x;
        this.y = data.y;
        this.rotation = data.rotation;
        this.scaleX = data.scaleX;
        this.scaleY = data.scaleY;
        this.shearX = data.shearX;
        this.shearY = data.shearY;
    }

    /** The world rotation for the X axis, calculated using {@link #a} and {@link #c}. */
    getWorldRotationX()
    {
        return Math.atan2(this.c, this.a) * SpineMathUtils.radDeg;
    }

    /** The world rotation for the Y axis, calculated using {@link #b} and {@link #d}. */
    getWorldRotationY()
    {
        return Math.atan2(this.d, this.b) * SpineMathUtils.radDeg;
    }

    /** The magnitude (always positive) of the world scale X, calculated using {@link #a} and {@link #c}. */
    getWorldScaleX()
    {
        return Math.sqrt(this.a * this.a + this.c * this.c);
    }

    /** The magnitude (always positive) of the world scale Y, calculated using {@link #b} and {@link #d}. */
    getWorldScaleY()
    {
        return Math.sqrt(this.b * this.b + this.d * this.d);
    }

    /** Computes the applied transform values from the world transform.
     *
     * If the world transform is modified (by a constraint, {@link #rotateWorld(float)}, etc) then this method should be called so
     * the applied transform matches the world transform. The applied transform may be needed by other code (eg to apply other
     * constraints).
     *
     * Some information is ambiguous in the world transform, such as -1,-1 scale versus 180 rotation. The applied transform after
     * calling this method is equivalent to the local transform used to compute the world transform, but may not be identical. */
    updateAppliedTransform()
    {
        let parent = this.parent;
        if (!parent)
        {
            this.ax = this.worldX - this.skeleton.x;
            this.ay = this.worldY - this.skeleton.y;
            this.arotation = Math.atan2(this.c, this.a) * SpineMathUtils.radDeg;
            this.ascaleX = Math.sqrt(this.a * this.a + this.c * this.c);
            this.ascaleY = Math.sqrt(this.b * this.b + this.d * this.d);
            this.ashearX = 0;
            this.ashearY = Math.atan2(this.a * this.b + this.c * this.d, this.a * this.d - this.b * this.c) * SpineMathUtils.radDeg;
            return;
        }
        let pa = parent.a, pb = parent.b, pc = parent.c, pd = parent.d;
        let pid = 1 / (pa * pd - pb * pc);
        let dx = this.worldX - parent.worldX, dy = this.worldY - parent.worldY;
        this.ax = (dx * pd * pid - dy * pb * pid);
        this.ay = (dy * pa * pid - dx * pc * pid);
        let ia = pid * pd;
        let id = pid * pa;
        let ib = pid * pb;
        let ic = pid * pc;
        let ra = ia * this.a - ib * this.c;
        let rb = ia * this.b - ib * this.d;
        let rc = id * this.c - ic * this.a;
        let rd = id * this.d - ic * this.b;
        this.ashearX = 0;
        this.ascaleX = Math.sqrt(ra * ra + rc * rc);
        if (this.ascaleX > 0.0001)
        {
            let det = ra * rd - rb * rc;
            this.ascaleY = det / this.ascaleX;
            this.ashearY = Math.atan2(ra * rb + rc * rd, det) * SpineMathUtils.radDeg;
            this.arotation = Math.atan2(rc, ra) * SpineMathUtils.radDeg;
        }
        else
        {
            this.ascaleX = 0;
            this.ascaleY = Math.sqrt(rb * rb + rd * rd);
            this.ashearY = 0;
            this.arotation = 90 - Math.atan2(rd, rb) * SpineMathUtils.radDeg;
        }
    }

    /** Transforms a point from world coordinates to the bone's local coordinates. */
    worldToLocal(world)
    {
        let invDet = 1 / (this.a * this.d - this.b * this.c);
        let x = world.x - this.worldX, y = world.y - this.worldY;
        world.x = x * this.d * invDet - y * this.b * invDet;
        world.y = y * this.a * invDet - x * this.c * invDet;
        return world;
    }

    /** Transforms a point from the bone's local coordinates to world coordinates. */
    localToWorld(local)
    {
        let x = local.x, y = local.y;
        local.x = x * this.a + y * this.b + this.worldX;
        local.y = x * this.c + y * this.d + this.worldY;
        return local;
    }

    /** Transforms a world rotation to a local rotation. */
    worldToLocalRotation(worldRotation)
    {
        let sin = SpineMathUtils.sinDeg(worldRotation), cos = SpineMathUtils.cosDeg(worldRotation);
        return Math.atan2(this.a * sin - this.c * cos, this.d * cos - this.b * sin) * SpineMathUtils.radDeg + this.rotation - this.shearX;
    }

    /** Transforms a local rotation to a world rotation. */
    localToWorldRotation(localRotation)
    {
        localRotation -= this.rotation - this.shearX;
        let sin = SpineMathUtils.sinDeg(localRotation), cos = SpineMathUtils.cosDeg(localRotation);
        return Math.atan2(cos * this.c + sin * this.d, cos * this.a + sin * this.b) * SpineMathUtils.radDeg;
    }

    /** Rotates the world transform the specified amount.
     * <p>
     * After changes are made to the world transform, {@link #updateAppliedTransform()} should be called and {@link #update()} will
     * need to be called on any child bones, recursively. */
    rotateWorld(degrees)
    {
        let a = this.a, b = this.b, c = this.c, d = this.d;
        let cos = SpineMathUtils.cosDeg(degrees), sin = SpineMathUtils.sinDeg(degrees);
        this.a = cos * a - sin * c;
        this.b = cos * b - sin * d;
        this.c = sin * a + cos * c;
        this.d = sin * b + cos * d;
    }
}

/** Stores a slot's current pose. Slots organize attachments for {@link Skeleton#drawOrder} purposes and provide a place to store
 * state for an attachment. State cannot be stored in an attachment itself because attachments are stateless and may be shared
 * across multiple skeletons. */
class SpineSlot
{
    /** The slot's setup pose data. */
    data = null;

    /** The bone this slot belongs to. */
    bone = null;

    /** The color used to tint the slot's attachment. If {@link #getDarkColor()} is set, this is used as the light color for two
     * color tinting. */
    color = null;

    /** The dark color used to tint the slot's attachment for two color tinting, or null if two color tinting is not used. The dark
     * color's alpha is not used. */
    darkColor = null;
    attachment = null;
    attachmentTime = 0;
    attachmentState = 0;

    /** Values to deform the slot's attachment. For an unweighted mesh, the entries are local positions for each vertex. For a
     * weighted mesh, the entries are an offset for each vertex which will be added to the mesh's local vertex positions.
     *
     * See {@link VertexAttachment#computeWorldVertices()} and {@link DeformTimeline}. */
    deform = new Array();

    constructor(data, bone)
    {
        if (!data)
            throw new Error("data cannot be null.");
        if (!bone)
            throw new Error("bone cannot be null.");
        this.data = data;
        this.bone = bone;
        this.color = new SpineColor();
        this.darkColor = !data.darkColor ? null : new SpineColor();
        this.setToSetupPose();
    }

    /** The skeleton this slot belongs to. */
    getSkeleton()
    {
        return this.bone.skeleton;
    }

    /** The current attachment for the slot, or null if the slot has no attachment. */
    getAttachment()
    {
        return this.attachment;
    }

    /** Sets the slot's attachment and, if the attachment changed, resets {@link #attachmentTime} and clears the {@link #deform}.
     * The deform is not cleared if the old attachment has the same {@link VertexAttachment#getDeformAttachment()} as the specified
     * attachment.
     * @param attachment May be null. */
    setAttachment(attachment)
    {
        if (this.attachment == attachment)
            return;
        if (!(attachment instanceof SpineVertexAttachment) || !(this.attachment instanceof SpineVertexAttachment)
            || attachment.deformAttachment != this.attachment.deformAttachment)
            {
            this.deform.length = 0;
        }
        this.attachment = attachment;
        this.attachmentTime = this.bone.skeleton.time;
    }

    setAttachmentTime(time)
    {
        this.attachmentTime = this.bone.skeleton.time - time;
    }

    /** The time that has elapsed since the last time the attachment was set or cleared. Relies on Skeleton
     * {@link Skeleton#time}. */
    getAttachmentTime()
    {
        return this.bone.skeleton.time - this.attachmentTime;
    }

    /** Sets this slot to the setup pose. */
    setToSetupPose()
    {
        this.color.setFromColor(this.data.color);
        if (this.darkColor)
            this.darkColor.setFromColor(this.data.darkColor);
        if (!this.data.attachmentName)
            this.attachment = null;
        else
        {
            this.attachment = null;
            this.setAttachment(this.bone.skeleton.getAttachment(this.data.index, this.data.attachmentName));
        }
    }
}

/** Stores the current pose for an IK constraint. An IK constraint adjusts the rotation of 1 or 2 constrained bones so the tip of
 * the last bone is as close to the target bone as possible.
 *
 * See [IK constraints](http://esotericsoftware.com/spine-ik-constraints) in the Spine User Guide. */
class SpineIkConstraint
{
    /** The IK constraint's setup pose data. */
    data = null;

    /** The bones that will be modified by this IK constraint. */
    bones = null;

    /** The bone that is the IK target. */
    target = null;

    /** Controls the bend direction of the IK bones, either 1 or -1. */
    bendDirection = 0;

    /** When true and only a single bone is being constrained, if the target is too close, the bone is scaled to reach it. */
    compress = false;

    /** When true, if the target is out of range, the parent bone is scaled to reach it. If more than one bone is being constrained
     * and the parent bone has local nonuniform scale, stretch is not applied. */
    stretch = false;

    /** A percentage (0-1) that controls the mix between the constrained and unconstrained rotations. */
    mix = 1;

    /** For two bone IK, the distance from the maximum reach of the bones that rotation will slow. */
    softness = 0;
    active = false;

    constructor(data, skeleton)
    {
        if (!data)
            throw new Error("data cannot be null.");
        if (!skeleton)
            throw new Error("skeleton cannot be null.");
        this.data = data;
        this.mix = data.mix;
        this.softness = data.softness;
        this.bendDirection = data.bendDirection;
        this.compress = data.compress;
        this.stretch = data.stretch;
        this.bones = new Array();
        for (let i = 0; i < data.bones.length; i++)
            this.bones.push(skeleton.findBone(data.bones[i].name));
        this.target = skeleton.findBone(data.target.name);
    }

    isActive()
    {
        return this.active;
    }

    update()
    {
        if (this.mix == 0)
            return;
        let target = this.target;
        let bones = this.bones;
        switch (bones.length)
        {
            case 1:
                this.apply1(bones[0], target.worldX, target.worldY, this.compress, this.stretch, this.data.uniform, this.mix);
                break;
            case 2:
                this.apply2(bones[0], bones[1], target.worldX, target.worldY, this.bendDirection, this.stretch, this.data.uniform, this.softness, this.mix);
                break;
        }
    }

    /** Applies 1 bone IK. The target is specified in the world coordinate system. */
    apply1(bone, targetX, targetY, compress, stretch, uniform, alpha)
    {
        let p = bone.parent;
        let pa = p.a, pb = p.b, pc = p.c, pd = p.d;
        let rotationIK = -bone.ashearX - bone.arotation, tx = 0, ty = 0;
        switch (bone.data.transformMode)
        {
            case SpineTransformMode.OnlyTranslation:
                tx = targetX - bone.worldX;
                ty = targetY - bone.worldY;
                break;
            case SpineTransformMode.NoRotationOrReflection:
                let s = Math.abs(pa * pd - pb * pc) / (pa * pa + pc * pc);
                let sa = pa / bone.skeleton.scaleX;
                let sc = pc / bone.skeleton.scaleY;
                pb = -sc * s * bone.skeleton.scaleX;
                pd = sa * s * bone.skeleton.scaleY;
                rotationIK += Math.atan2(sc, sa) * SpineMathUtils.radDeg;
            // Fall through
            default:
                let x = targetX - p.worldX, y = targetY - p.worldY;
                let d = pa * pd - pb * pc;
                tx = (x * pd - y * pb) / d - bone.ax;
                ty = (y * pa - x * pc) / d - bone.ay;
        }
        rotationIK += Math.atan2(ty, tx) * SpineMathUtils.radDeg;
        if (bone.ascaleX < 0)
            rotationIK += 180;
        if (rotationIK > 180)
            rotationIK -= 360;
        else if (rotationIK < -180)
            rotationIK += 360;
        let sx = bone.ascaleX, sy = bone.ascaleY;
        if (compress || stretch)
        {
            switch (bone.data.transformMode)
            {
                case SpineTransformMode.NoScale:
                case SpineTransformMode.NoScaleOrReflection:
                    tx = targetX - bone.worldX;
                    ty = targetY - bone.worldY;
            }
            let b = bone.data.length * sx, dd = Math.sqrt(tx * tx + ty * ty);
            if ((compress && dd < b) || (stretch && dd > b) && b > 0.0001)
            {
                let s = (dd / b - 1) * alpha + 1;
                sx *= s;
                if (uniform)
                    sy *= s;
            }
        }
        bone.updateWorldTransformWith(bone.ax, bone.ay, bone.arotation + rotationIK * alpha, sx, sy, bone.ashearX, bone.ashearY);
    }

    /** Applies 2 bone IK. The target is specified in the world coordinate system.
     * @param child A direct descendant of the parent bone. */
    apply2(parent, child, targetX, targetY, bendDir, stretch, uniform, softness, alpha)
    {
        let px = parent.ax, py = parent.ay, psx = parent.ascaleX, psy = parent.ascaleY, sx = psx, sy = psy, csx = child.ascaleX;
        let os1 = 0, os2 = 0, s2 = 0;
        if (psx < 0)
        {
            psx = -psx;
            os1 = 180;
            s2 = -1;
        }
        else
        {
            os1 = 0;
            s2 = 1;
        }
        if (psy < 0)
        {
            psy = -psy;
            s2 = -s2;
        }
        if (csx < 0)
        {
            csx = -csx;
            os2 = 180;
        }
        else
            os2 = 0;
        let cx = child.ax, cy = 0, cwx = 0, cwy = 0, a = parent.a, b = parent.b, c = parent.c, d = parent.d;
        let u = Math.abs(psx - psy) <= 0.0001;
        if (!u || stretch)
        {
            cy = 0;
            cwx = a * cx + parent.worldX;
            cwy = c * cx + parent.worldY;
        }
        else
        {
            cy = child.ay;
            cwx = a * cx + b * cy + parent.worldX;
            cwy = c * cx + d * cy + parent.worldY;
        }
        let pp = parent.parent;
        a = pp.a;
        b = pp.b;
        c = pp.c;
        d = pp.d;
        let id = 1 / (a * d - b * c), x = cwx - pp.worldX, y = cwy - pp.worldY;
        let dx = (x * d - y * b) * id - px, dy = (y * a - x * c) * id - py;
        let l1 = Math.sqrt(dx * dx + dy * dy), l2 = child.data.length * csx, a1, a2;
        if (l1 < 0.0001)
        {
            this.apply1(parent, targetX, targetY, false, stretch, false, alpha);
            child.updateWorldTransformWith(cx, cy, 0, child.ascaleX, child.ascaleY, child.ashearX, child.ashearY);
            return;
        }
        x = targetX - pp.worldX;
        y = targetY - pp.worldY;
        let tx = (x * d - y * b) * id - px, ty = (y * a - x * c) * id - py;
        let dd = tx * tx + ty * ty;
        if (softness != 0)
        {
            softness *= psx * (csx + 1) * 0.5;
            let td = Math.sqrt(dd), sd = td - l1 - l2 * psx + softness;
            if (sd > 0)
            {
                let p = Math.min(1, sd / (softness * 2)) - 1;
                p = (sd - softness * (1 - p * p)) / td;
                tx -= p * tx;
                ty -= p * ty;
                dd = tx * tx + ty * ty;
            }
        }
        outer: if (u)
        {
            l2 *= psx;
            let cos = (dd - l1 * l1 - l2 * l2) / (2 * l1 * l2);
            if (cos < -1)
            {
                cos = -1;
                a2 = Math.PI * bendDir;
            }
            else if (cos > 1)
            {
                cos = 1;
                a2 = 0;
                if (stretch)
                {
                    a = (Math.sqrt(dd) / (l1 + l2) - 1) * alpha + 1;
                    sx *= a;
                    if (uniform)
                        sy *= a;
                }
            }
            else
                a2 = Math.acos(cos) * bendDir;
            a = l1 + l2 * cos;
            b = l2 * Math.sin(a2);
            a1 = Math.atan2(ty * a - tx * b, tx * a + ty * b);
        }
        else
        {
            a = psx * l2;
            b = psy * l2;
            let aa = a * a, bb = b * b, ta = Math.atan2(ty, tx);
            c = bb * l1 * l1 + aa * dd - aa * bb;
            let c1 = -2 * bb * l1, c2 = bb - aa;
            d = c1 * c1 - 4 * c2 * c;
            if (d >= 0)
            {
                let q = Math.sqrt(d);
                if (c1 < 0)
                    q = -q;
                q = -(c1 + q) * 0.5;
                let r0 = q / c2, r1 = c / q;
                let r = Math.abs(r0) < Math.abs(r1) ? r0 : r1;
                if (r * r <= dd)
                {
                    y = Math.sqrt(dd - r * r) * bendDir;
                    a1 = ta - Math.atan2(y, r);
                    a2 = Math.atan2(y / psy, (r - l1) / psx);
                    break outer;
                }
            }
            let minAngle = SpineMathUtils.PI, minX = l1 - a, minDist = minX * minX, minY = 0;
            let maxAngle = 0, maxX = l1 + a, maxDist = maxX * maxX, maxY = 0;
            c = -a * l1 / (aa - bb);
            if (c >= -1 && c <= 1)
            {
                c = Math.acos(c);
                x = a * Math.cos(c) + l1;
                y = b * Math.sin(c);
                d = x * x + y * y;
                if (d < minDist)
                {
                    minAngle = c;
                    minDist = d;
                    minX = x;
                    minY = y;
                }
                if (d > maxDist)
                {
                    maxAngle = c;
                    maxDist = d;
                    maxX = x;
                    maxY = y;
                }
            }
            if (dd <= (minDist + maxDist) * 0.5)
            {
                a1 = ta - Math.atan2(minY * bendDir, minX);
                a2 = minAngle * bendDir;
            }
            else
            {
                a1 = ta - Math.atan2(maxY * bendDir, maxX);
                a2 = maxAngle * bendDir;
            }
        }
        let os = Math.atan2(cy, cx) * s2;
        let rotation = parent.arotation;
        a1 = (a1 - os) * SpineMathUtils.radDeg + os1 - rotation;
        if (a1 > 180)
            a1 -= 360;
        else if (a1 < -180) //
            a1 += 360;
        parent.updateWorldTransformWith(px, py, rotation + a1 * alpha, sx, sy, 0, 0);
        rotation = child.arotation;
        a2 = ((a2 + os) * SpineMathUtils.radDeg - child.ashearX) * s2 + os2 - rotation;
        if (a2 > 180)
            a2 -= 360;
        else if (a2 < -180) //
            a2 += 360;
        child.updateWorldTransformWith(cx, cy, rotation + a2 * alpha, child.ascaleX, child.ascaleY, child.ashearX, child.ashearY);
    }
}

/** Stores the current pose for a transform constraint. A transform constraint adjusts the world transform of the constrained
 * bones to match that of the target bone.
 *
 * See [Transform constraints](http://esotericsoftware.com/spine-transform-constraints) in the Spine User Guide. */
class SpineTransformConstraint
{
    /** The transform constraint's setup pose data. */
    data = null;

    /** The bones that will be modified by this transform constraint. */
    bones = null;

    /** The target bone whose world transform will be copied to the constrained bones. */
    target = null;
    mixRotate = 0;
    mixX = 0;
    mixY = 0;
    mixScaleX = 0;
    mixScaleY = 0;
    mixShearY = 0;
    temp = new SpineVector2();
    active = false;

    constructor(data, skeleton)
    {
        if (!data)
            throw new Error("data cannot be null.");
        if (!skeleton)
            throw new Error("skeleton cannot be null.");
        this.data = data;
        this.mixRotate = data.mixRotate;
        this.mixX = data.mixX;
        this.mixY = data.mixY;
        this.mixScaleX = data.mixScaleX;
        this.mixScaleY = data.mixScaleY;
        this.mixShearY = data.mixShearY;
        this.bones = new Array();
        for (let i = 0; i < data.bones.length; i++)
            this.bones.push(skeleton.findBone(data.bones[i].name));
        this.target = skeleton.findBone(data.target.name);
    }

    isActive()
    {
        return this.active;
    }

    update()
    {
        if (this.mixRotate == 0 && this.mixX == 0 && this.mixY == 0 && this.mixScaleX == 0 && this.mixScaleX == 0 && this.mixShearY == 0)
            return;
        if (this.data.local)
        {
            if (this.data.relative)
                this.applyRelativeLocal();
            else
                this.applyAbsoluteLocal();
        }
        else
        {
            if (this.data.relative)
                this.applyRelativeWorld();
            else
                this.applyAbsoluteWorld();
        }
    }

    applyAbsoluteWorld()
    {
        let mixRotate = this.mixRotate, mixX = this.mixX, mixY = this.mixY, mixScaleX = this.mixScaleX, mixScaleY = this.mixScaleY, mixShearY = this.mixShearY;
        let translate = mixX != 0 || mixY != 0;
        let target = this.target;
        let ta = target.a, tb = target.b, tc = target.c, td = target.d;
        let degRadReflect = ta * td - tb * tc > 0 ? SpineMathUtils.degRad : -SpineMathUtils.degRad;
        let offsetRotation = this.data.offsetRotation * degRadReflect;
        let offsetShearY = this.data.offsetShearY * degRadReflect;
        let bones = this.bones;
        for (let i = 0, n = bones.length; i < n; i++)
        {
            let bone = bones[i];
            if (mixRotate != 0)
            {
                let a = bone.a, b = bone.b, c = bone.c, d = bone.d;
                let r = Math.atan2(tc, ta) - Math.atan2(c, a) + offsetRotation;
                if (r > SpineMathUtils.PI)
                    r -= SpineMathUtils.PI2;
                else if (r < -SpineMathUtils.PI) //
                    r += SpineMathUtils.PI2;
                r *= mixRotate;
                let cos = Math.cos(r), sin = Math.sin(r);
                bone.a = cos * a - sin * c;
                bone.b = cos * b - sin * d;
                bone.c = sin * a + cos * c;
                bone.d = sin * b + cos * d;
            }
            if (translate)
            {
                let temp = this.temp;
                target.localToWorld(temp.set(this.data.offsetX, this.data.offsetY));
                bone.worldX += (temp.x - bone.worldX) * mixX;
                bone.worldY += (temp.y - bone.worldY) * mixY;
            }
            if (mixScaleX != 0)
            {
                let s = Math.sqrt(bone.a * bone.a + bone.c * bone.c);
                if (s != 0)
                    s = (s + (Math.sqrt(ta * ta + tc * tc) - s + this.data.offsetScaleX) * mixScaleX) / s;
                bone.a *= s;
                bone.c *= s;
            }
            if (mixScaleY != 0)
            {
                let s = Math.sqrt(bone.b * bone.b + bone.d * bone.d);
                if (s != 0)
                    s = (s + (Math.sqrt(tb * tb + td * td) - s + this.data.offsetScaleY) * mixScaleY) / s;
                bone.b *= s;
                bone.d *= s;
            }
            if (mixShearY > 0)
            {
                let b = bone.b, d = bone.d;
                let by = Math.atan2(d, b);
                let r = Math.atan2(td, tb) - Math.atan2(tc, ta) - (by - Math.atan2(bone.c, bone.a));
                if (r > SpineMathUtils.PI)
                    r -= SpineMathUtils.PI2;
                else if (r < -SpineMathUtils.PI) //
                    r += SpineMathUtils.PI2;
                r = by + (r + offsetShearY) * mixShearY;
                let s = Math.sqrt(b * b + d * d);
                bone.b = Math.cos(r) * s;
                bone.d = Math.sin(r) * s;
            }
            bone.updateAppliedTransform();
        }
    }

    applyRelativeWorld()
    {
        let mixRotate = this.mixRotate, mixX = this.mixX, mixY = this.mixY, mixScaleX = this.mixScaleX, mixScaleY = this.mixScaleY, mixShearY = this.mixShearY;
        let translate = mixX != 0 || mixY != 0;
        let target = this.target;
        let ta = target.a, tb = target.b, tc = target.c, td = target.d;
        let degRadReflect = ta * td - tb * tc > 0 ? SpineMathUtils.degRad : -SpineMathUtils.degRad;
        let offsetRotation = this.data.offsetRotation * degRadReflect, offsetShearY = this.data.offsetShearY * degRadReflect;
        let bones = this.bones;
        for (let i = 0, n = bones.length; i < n; i++)
        {
            let bone = bones[i];
            if (mixRotate != 0)
            {
                let a = bone.a, b = bone.b, c = bone.c, d = bone.d;
                let r = Math.atan2(tc, ta) + offsetRotation;
                if (r > SpineMathUtils.PI)
                    r -= SpineMathUtils.PI2;
                else if (r < -SpineMathUtils.PI) //
                    r += SpineMathUtils.PI2;
                r *= mixRotate;
                let cos = Math.cos(r), sin = Math.sin(r);
                bone.a = cos * a - sin * c;
                bone.b = cos * b - sin * d;
                bone.c = sin * a + cos * c;
                bone.d = sin * b + cos * d;
            }
            if (translate)
            {
                let temp = this.temp;
                target.localToWorld(temp.set(this.data.offsetX, this.data.offsetY));
                bone.worldX += temp.x * mixX;
                bone.worldY += temp.y * mixY;
            }
            if (mixScaleX != 0)
            {
                let s = (Math.sqrt(ta * ta + tc * tc) - 1 + this.data.offsetScaleX) * mixScaleX + 1;
                bone.a *= s;
                bone.c *= s;
            }
            if (mixScaleY != 0)
            {
                let s = (Math.sqrt(tb * tb + td * td) - 1 + this.data.offsetScaleY) * mixScaleY + 1;
                bone.b *= s;
                bone.d *= s;
            }
            if (mixShearY > 0)
            {
                let r = Math.atan2(td, tb) - Math.atan2(tc, ta);
                if (r > SpineMathUtils.PI)
                    r -= SpineMathUtils.PI2;
                else if (r < -SpineMathUtils.PI) //
                    r += SpineMathUtils.PI2;
                let b = bone.b, d = bone.d;
                r = Math.atan2(d, b) + (r - SpineMathUtils.PI / 2 + offsetShearY) * mixShearY;
                let s = Math.sqrt(b * b + d * d);
                bone.b = Math.cos(r) * s;
                bone.d = Math.sin(r) * s;
            }
            bone.updateAppliedTransform();
        }
    }

    applyAbsoluteLocal()
    {
        let mixRotate = this.mixRotate, mixX = this.mixX, mixY = this.mixY, mixScaleX = this.mixScaleX, mixScaleY = this.mixScaleY, mixShearY = this.mixShearY;
        let target = this.target;
        let bones = this.bones;
        for (let i = 0, n = bones.length; i < n; i++)
        {
            let bone = bones[i];
            let rotation = bone.arotation;
            if (mixRotate != 0)
            {
                let r = target.arotation - rotation + this.data.offsetRotation;
                r -= (16384 - ((16384.499999999996 - r / 360) | 0)) * 360;
                rotation += r * mixRotate;
            }
            let x = bone.ax, y = bone.ay;
            x += (target.ax - x + this.data.offsetX) * mixX;
            y += (target.ay - y + this.data.offsetY) * mixY;
            let scaleX = bone.ascaleX, scaleY = bone.ascaleY;
            if (mixScaleX != 0 && scaleX != 0)
                scaleX = (scaleX + (target.ascaleX - scaleX + this.data.offsetScaleX) * mixScaleX) / scaleX;
            if (mixScaleY != 0 && scaleY != 0)
                scaleY = (scaleY + (target.ascaleY - scaleY + this.data.offsetScaleY) * mixScaleY) / scaleY;
            let shearY = bone.ashearY;
            if (mixShearY != 0)
            {
                let r = target.ashearY - shearY + this.data.offsetShearY;
                r -= (16384 - ((16384.499999999996 - r / 360) | 0)) * 360;
                shearY += r * mixShearY;
            }
            bone.updateWorldTransformWith(x, y, rotation, scaleX, scaleY, bone.ashearX, shearY);
        }
    }

    applyRelativeLocal()
    {
        let mixRotate = this.mixRotate, mixX = this.mixX, mixY = this.mixY, mixScaleX = this.mixScaleX, mixScaleY = this.mixScaleY, mixShearY = this.mixShearY;
        let target = this.target;
        let bones = this.bones;
        for (let i = 0, n = bones.length; i < n; i++)
        {
            let bone = bones[i];
            let rotation = bone.arotation + (target.arotation + this.data.offsetRotation) * mixRotate;
            let x = bone.ax + (target.ax + this.data.offsetX) * mixX;
            let y = bone.ay + (target.ay + this.data.offsetY) * mixY;
            let scaleX = bone.ascaleX * (((target.ascaleX - 1 + this.data.offsetScaleX) * mixScaleX) + 1);
            let scaleY = bone.ascaleY * (((target.ascaleY - 1 + this.data.offsetScaleY) * mixScaleY) + 1);
            let shearY = bone.ashearY + (target.ashearY + this.data.offsetShearY) * mixShearY;
            bone.updateWorldTransformWith(x, y, rotation, scaleX, scaleY, bone.ashearX, shearY);
        }
    }
}

/** Stores the current pose for a path constraint. A path constraint adjusts the rotation, translation, and scale of the
 * constrained bones so they follow a {@link PathAttachment}.
 *
 * See [Path constraints](http://esotericsoftware.com/spine-path-constraints) in the Spine User Guide. */
class SpinePathConstraint
{
    static NONE = -1;
    static BEFORE = -2;
    static AFTER = -3;
    static epsilon = 0.00001;

    /** The path constraint's setup pose data. */
    data = null;

    /** The bones that will be modified by this path constraint. */
    bones = null;

    /** The slot whose path attachment will be used to constrained the bones. */
    target = null;

    /** The position along the path. */
    position = 0;

    /** The spacing between bones. */
    spacing = 0;
    mixRotate = 0;
    mixX = 0;
    mixY = 0;
    spaces = new Array();
    positions = new Array();
    world = new Array();
    curves = new Array();
    lengths = new Array();
    segments = new Array();
    active = false;

    constructor(data, skeleton)
    {
        if (!data)
            throw new Error("data cannot be null.");
        if (!skeleton)
            throw new Error("skeleton cannot be null.");
        this.data = data;
        this.bones = new Array();
        for (let i = 0, n = data.bones.length; i < n; i++)
            this.bones.push(skeleton.findBone(data.bones[i].name));
        this.target = skeleton.findSlot(data.target.name);
        this.position = data.position;
        this.spacing = data.spacing;
        this.mixRotate = data.mixRotate;
        this.mixX = data.mixX;
        this.mixY = data.mixY;
    }

    isActive()
    {
        return this.active;
    }

    update()
    {
        let attachment = this.target.getAttachment();
        if (!(attachment instanceof SpinePathAttachment))
            return;
        let mixRotate = this.mixRotate, mixX = this.mixX, mixY = this.mixY;
        if (mixRotate == 0 && mixX == 0 && mixY == 0)
            return;
        let data = this.data;
        let tangents = data.rotateMode == SpineRotateMode.Tangent, scale = data.rotateMode == SpineRotateMode.ChainScale;
        let bones = this.bones;
        let boneCount = bones.length, spacesCount = tangents ? boneCount : boneCount + 1;
        let spaces = SpineUtils.setArraySize(this.spaces, spacesCount), lengths = scale ? this.lengths = SpineUtils.setArraySize(this.lengths, boneCount) : null;
        let spacing = this.spacing;
        switch (data.spacingMode)
        {
            case SpineSpacingMode.Percent:
                if (scale)
                {
                    for (let i = 0, n = spacesCount - 1; i < n; i++)
                    {
                        let bone = bones[i];
                        let setupLength = bone.data.length;
                        if (setupLength < SpinePathConstraint.epsilon)
                            lengths[i] = 0;
                        else
                        {
                            let x = setupLength * bone.a, y = setupLength * bone.c;
                            lengths[i] = Math.sqrt(x * x + y * y);
                        }
                    }
                }
                SpineUtils.arrayFill(spaces, 1, spacesCount, spacing);
                break;
            case SpineSpacingMode.Proportional:
                let sum = 0;
                for (let i = 0, n = spacesCount - 1; i < n;)
                {
                    let bone = bones[i];
                    let setupLength = bone.data.length;
                    if (setupLength < SpinePathConstraint.epsilon)
                    {
                        if (scale)
                            lengths[i] = 0;
                        spaces[++i] = spacing;
                    }
                    else
                    {
                        let x = setupLength * bone.a, y = setupLength * bone.c;
                        let length = Math.sqrt(x * x + y * y);
                        if (scale)
                            lengths[i] = length;
                        spaces[++i] = length;
                        sum += length;
                    }
                }
                if (sum > 0)
                {
                    sum = spacesCount / sum * spacing;
                    for (let i = 1; i < spacesCount; i++)
                        spaces[i] *= sum;
                }
                break;
            default:
                let lengthSpacing = data.spacingMode == SpineSpacingMode.Length;
                for (let i = 0, n = spacesCount - 1; i < n;)
                {
                    let bone = bones[i];
                    let setupLength = bone.data.length;
                    if (setupLength < SpinePathConstraint.epsilon)
                    {
                        if (scale)
                            lengths[i] = 0;
                        spaces[++i] = spacing;
                    }
                    else
                    {
                        let x = setupLength * bone.a, y = setupLength * bone.c;
                        let length = Math.sqrt(x * x + y * y);
                        if (scale)
                            lengths[i] = length;
                        spaces[++i] = (lengthSpacing ? setupLength + spacing : spacing) * length / setupLength;
                    }
                }
        }
        let positions = this.computeWorldPositions(attachment, spacesCount, tangents);
        let boneX = positions[0], boneY = positions[1], offsetRotation = data.offsetRotation;
        let tip = false;
        if (offsetRotation == 0)
            tip = data.rotateMode == SpineRotateMode.Chain;
        else
        {
            tip = false;
            let p = this.target.bone;
            offsetRotation *= p.a * p.d - p.b * p.c > 0 ? SpineMathUtils.degRad : -SpineMathUtils.degRad;
        }
        for (let i = 0, p = 3; i < boneCount; i++, p += 3)
        {
            let bone = bones[i];
            bone.worldX += (boneX - bone.worldX) * mixX;
            bone.worldY += (boneY - bone.worldY) * mixY;
            let x = positions[p], y = positions[p + 1], dx = x - boneX, dy = y - boneY;
            if (scale)
            {
                let length = lengths[i];
                if (length != 0)
                {
                    let s = (Math.sqrt(dx * dx + dy * dy) / length - 1) * mixRotate + 1;
                    bone.a *= s;
                    bone.c *= s;
                }
            }
            boneX = x;
            boneY = y;
            if (mixRotate > 0)
            {
                let a = bone.a, b = bone.b, c = bone.c, d = bone.d, r = 0, cos = 0, sin = 0;
                if (tangents)
                    r = positions[p - 1];
                else if (spaces[i + 1] == 0)
                    r = positions[p + 2];
                else
                    r = Math.atan2(dy, dx);
                r -= Math.atan2(c, a);
                if (tip)
                {
                    cos = Math.cos(r);
                    sin = Math.sin(r);
                    let length = bone.data.length;
                    boneX += (length * (cos * a - sin * c) - dx) * mixRotate;
                    boneY += (length * (sin * a + cos * c) - dy) * mixRotate;
                }
                else
                {
                    r += offsetRotation;
                }
                if (r > SpineMathUtils.PI)
                    r -= SpineMathUtils.PI2;
                else if (r < -SpineMathUtils.PI) //
                    r += SpineMathUtils.PI2;
                r *= mixRotate;
                cos = Math.cos(r);
                sin = Math.sin(r);
                bone.a = cos * a - sin * c;
                bone.b = cos * b - sin * d;
                bone.c = sin * a + cos * c;
                bone.d = sin * b + cos * d;
            }
            bone.updateAppliedTransform();
        }
    }

    computeWorldPositions(path, spacesCount, tangents)
    {
        let target = this.target;
        let position = this.position;
        let spaces = this.spaces, out = SpineUtils.setArraySize(this.positions, spacesCount * 3 + 2), world = null;
        let closed = path.closed;
        let verticesLength = path.worldVerticesLength, curveCount = verticesLength / 6, prevCurve = SpinePathConstraint.NONE;
        if (!path.constantSpeed)
        {
            let lengths = path.lengths;
            curveCount -= closed ? 1 : 2;
            let pathLength = lengths[curveCount];
            if (this.data.positionMode == SpinePositionMode.Percent)
                position *= pathLength;
            let multiplier;
            switch (this.data.spacingMode)
            {
                case SpineSpacingMode.Percent:
                    multiplier = pathLength;
                    break;
                case SpineSpacingMode.Proportional:
                    multiplier = pathLength / spacesCount;
                    break;
                default:
                    multiplier = 1;
            }
            world = SpineUtils.setArraySize(this.world, 8);
            for (let i = 0, o = 0, curve = 0; i < spacesCount; i++, o += 3)
            {
                let space = spaces[i] * multiplier;
                position += space;
                let p = position;
                if (closed)
                {
                    p %= pathLength;
                    if (p < 0)
                        p += pathLength;
                    curve = 0;
                }
                else if (p < 0)
                {
                    if (prevCurve != SpinePathConstraint.BEFORE)
                    {
                        prevCurve = SpinePathConstraint.BEFORE;
                        path.computeWorldVertices(target, 2, 4, world, 0, 2);
                    }
                    this.addBeforePosition(p, world, 0, out, o);
                    continue;
                }
                else if (p > pathLength)
                {
                    if (prevCurve != SpinePathConstraint.AFTER)
                    {
                        prevCurve = SpinePathConstraint.AFTER;
                        path.computeWorldVertices(target, verticesLength - 6, 4, world, 0, 2);
                    }
                    this.addAfterPosition(p - pathLength, world, 0, out, o);
                    continue;
                }
                // Determine curve containing position.
                for (;; curve++)
                {
                    let length = lengths[curve];
                    if (p > length)
                        continue;
                    if (curve == 0)
                        p /= length;
                    else
                    {
                        let prev = lengths[curve - 1];
                        p = (p - prev) / (length - prev);
                    }
                    break;
                }
                if (curve != prevCurve)
                {
                    prevCurve = curve;
                    if (closed && curve == curveCount)
                    {
                        path.computeWorldVertices(target, verticesLength - 4, 4, world, 0, 2);
                        path.computeWorldVertices(target, 0, 4, world, 4, 2);
                    }
                    else
                        path.computeWorldVertices(target, curve * 6 + 2, 8, world, 0, 2);
                }
                this.addCurvePosition(p, world[0], world[1], world[2], world[3], world[4], world[5], world[6], world[7], out, o, tangents || (i > 0 && space == 0));
            }
            return out;
        }
        // World vertices.
        if (closed)
        {
            verticesLength += 2;
            world = SpineUtils.setArraySize(this.world, verticesLength);
            path.computeWorldVertices(target, 2, verticesLength - 4, world, 0, 2);
            path.computeWorldVertices(target, 0, 2, world, verticesLength - 4, 2);
            world[verticesLength - 2] = world[0];
            world[verticesLength - 1] = world[1];
        }
        else
        {
            curveCount--;
            verticesLength -= 4;
            world = SpineUtils.setArraySize(this.world, verticesLength);
            path.computeWorldVertices(target, 2, verticesLength, world, 0, 2);
        }
        // Curve lengths.
        let curves = SpineUtils.setArraySize(this.curves, curveCount);
        let pathLength = 0;
        let x1 = world[0], y1 = world[1], cx1 = 0, cy1 = 0, cx2 = 0, cy2 = 0, x2 = 0, y2 = 0;
        let tmpx = 0, tmpy = 0, dddfx = 0, dddfy = 0, ddfx = 0, ddfy = 0, dfx = 0, dfy = 0;
        for (let i = 0, w = 2; i < curveCount; i++, w += 6)
        {
            cx1 = world[w];
            cy1 = world[w + 1];
            cx2 = world[w + 2];
            cy2 = world[w + 3];
            x2 = world[w + 4];
            y2 = world[w + 5];
            tmpx = (x1 - cx1 * 2 + cx2) * 0.1875;
            tmpy = (y1 - cy1 * 2 + cy2) * 0.1875;
            dddfx = ((cx1 - cx2) * 3 - x1 + x2) * 0.09375;
            dddfy = ((cy1 - cy2) * 3 - y1 + y2) * 0.09375;
            ddfx = tmpx * 2 + dddfx;
            ddfy = tmpy * 2 + dddfy;
            dfx = (cx1 - x1) * 0.75 + tmpx + dddfx * 0.16666667;
            dfy = (cy1 - y1) * 0.75 + tmpy + dddfy * 0.16666667;
            pathLength += Math.sqrt(dfx * dfx + dfy * dfy);
            dfx += ddfx;
            dfy += ddfy;
            ddfx += dddfx;
            ddfy += dddfy;
            pathLength += Math.sqrt(dfx * dfx + dfy * dfy);
            dfx += ddfx;
            dfy += ddfy;
            pathLength += Math.sqrt(dfx * dfx + dfy * dfy);
            dfx += ddfx + dddfx;
            dfy += ddfy + dddfy;
            pathLength += Math.sqrt(dfx * dfx + dfy * dfy);
            curves[i] = pathLength;
            x1 = x2;
            y1 = y2;
        }
        if (this.data.positionMode == SpinePositionMode.Percent)
            position *= pathLength;
        let multiplier;
        switch (this.data.spacingMode)
        {
            case SpineSpacingMode.Percent:
                multiplier = pathLength;
                break;
            case SpineSpacingMode.Proportional:
                multiplier = pathLength / spacesCount;
                break;
            default:
                multiplier = 1;
        }
        let segments = this.segments;
        let curveLength = 0;
        for (let i = 0, o = 0, curve = 0, segment = 0; i < spacesCount; i++, o += 3)
        {
            let space = spaces[i] * multiplier;
            position += space;
            let p = position;
            if (closed)
            {
                p %= pathLength;
                if (p < 0)
                    p += pathLength;
                curve = 0;
            }
            else if (p < 0)
            {
                this.addBeforePosition(p, world, 0, out, o);
                continue;
            }
            else if (p > pathLength)
            {
                this.addAfterPosition(p - pathLength, world, verticesLength - 4, out, o);
                continue;
            }
            // Determine curve containing position.
            for (;; curve++)
            {
                let length = curves[curve];
                if (p > length)
                    continue;
                if (curve == 0)
                    p /= length;
                else
                {
                    let prev = curves[curve - 1];
                    p = (p - prev) / (length - prev);
                }
                break;
            }
            // Curve segment lengths.
            if (curve != prevCurve)
            {
                prevCurve = curve;
                let ii = curve * 6;
                x1 = world[ii];
                y1 = world[ii + 1];
                cx1 = world[ii + 2];
                cy1 = world[ii + 3];
                cx2 = world[ii + 4];
                cy2 = world[ii + 5];
                x2 = world[ii + 6];
                y2 = world[ii + 7];
                tmpx = (x1 - cx1 * 2 + cx2) * 0.03;
                tmpy = (y1 - cy1 * 2 + cy2) * 0.03;
                dddfx = ((cx1 - cx2) * 3 - x1 + x2) * 0.006;
                dddfy = ((cy1 - cy2) * 3 - y1 + y2) * 0.006;
                ddfx = tmpx * 2 + dddfx;
                ddfy = tmpy * 2 + dddfy;
                dfx = (cx1 - x1) * 0.3 + tmpx + dddfx * 0.16666667;
                dfy = (cy1 - y1) * 0.3 + tmpy + dddfy * 0.16666667;
                curveLength = Math.sqrt(dfx * dfx + dfy * dfy);
                segments[0] = curveLength;
                for (ii = 1; ii < 8; ii++)
                {
                    dfx += ddfx;
                    dfy += ddfy;
                    ddfx += dddfx;
                    ddfy += dddfy;
                    curveLength += Math.sqrt(dfx * dfx + dfy * dfy);
                    segments[ii] = curveLength;
                }
                dfx += ddfx;
                dfy += ddfy;
                curveLength += Math.sqrt(dfx * dfx + dfy * dfy);
                segments[8] = curveLength;
                dfx += ddfx + dddfx;
                dfy += ddfy + dddfy;
                curveLength += Math.sqrt(dfx * dfx + dfy * dfy);
                segments[9] = curveLength;
                segment = 0;
            }
            // Weight by segment length.
            p *= curveLength;
            for (;; segment++)
            {
                let length = segments[segment];
                if (p > length)
                    continue;
                if (segment == 0)
                    p /= length;
                else
                {
                    let prev = segments[segment - 1];
                    p = segment + (p - prev) / (length - prev);
                }
                break;
            }
            this.addCurvePosition(p * 0.1, x1, y1, cx1, cy1, cx2, cy2, x2, y2, out, o, tangents || (i > 0 && space == 0));
        }
        return out;
    }

    addBeforePosition(p, temp, i, out, o)
    {
        let x1 = temp[i], y1 = temp[i + 1], dx = temp[i + 2] - x1, dy = temp[i + 3] - y1, r = Math.atan2(dy, dx);
        out[o] = x1 + p * Math.cos(r);
        out[o + 1] = y1 + p * Math.sin(r);
        out[o + 2] = r;
    }

    addAfterPosition(p, temp, i, out, o)
    {
        let x1 = temp[i + 2], y1 = temp[i + 3], dx = x1 - temp[i], dy = y1 - temp[i + 1], r = Math.atan2(dy, dx);
        out[o] = x1 + p * Math.cos(r);
        out[o + 1] = y1 + p * Math.sin(r);
        out[o + 2] = r;
    }

    addCurvePosition(p, x1, y1, cx1, cy1, cx2, cy2, x2, y2, out, o, tangents)
    {
        if (p == 0 || isNaN(p))
        {
            out[o] = x1;
            out[o + 1] = y1;
            out[o + 2] = Math.atan2(cy1 - y1, cx1 - x1);
            return;
        }
        let tt = p * p, ttt = tt * p, u = 1 - p, uu = u * u, uuu = uu * u;
        let ut = u * p, ut3 = ut * 3, uut3 = u * ut3, utt3 = ut3 * p;
        let x = x1 * uuu + cx1 * uut3 + cx2 * utt3 + x2 * ttt, y = y1 * uuu + cy1 * uut3 + cy2 * utt3 + y2 * ttt;
        out[o] = x;
        out[o + 1] = y;
        if (tangents)
        {
            if (p < 0.001)
                out[o + 2] = Math.atan2(cy1 - y1, cx1 - x1);
            else
                out[o + 2] = Math.atan2(y - (y1 * uu + cy1 * ut * 2 + cy2 * tt), x - (x1 * uu + cx1 * ut * 2 + cx2 * tt));
        }
    }
}

/** Stores the current pose for a skeleton.
 *
 * See [Instance objects](http://esotericsoftware.com/spine-runtime-architecture#Instance-objects) in the Spine Runtimes Guide. */
class SpineSkeleton
{
    /** The skeleton's setup pose data. */
    data = null;

    /** The skeleton's bones, sorted parent first. The root bone is always the first bone. */
    bones = null;

    /** The skeleton's slots. */
    slots = null;

    /** The skeleton's slots in the order they should be drawn. The returned array may be modified to change the draw order. */
    drawOrder = null;

    /** The skeleton's IK constraints. */
    ikConstraints = null;

    /** The skeleton's transform constraints. */
    transformConstraints = null;

    /** The skeleton's path constraints. */
    pathConstraints = null;

    /** The list of bones and constraints, sorted in the order they should be updated, as computed by {@link #updateCache()}. */
    _updateCache = new Array();

    /** The skeleton's current skin. May be null. */
    skin = null;

    /** The color to tint all the skeleton's attachments. */
    color = null;

    /** Returns the skeleton's time. This can be used for tracking, such as with Slot {@link Slot#attachmentTime}.
     * <p>
     * See {@link #update()}. */
    time = 0;

    /** Scales the entire skeleton on the X axis. This affects all bones, even if the bone's transform mode disallows scale
      * inheritance. */
    scaleX = 1;

    /** Scales the entire skeleton on the Y axis. This affects all bones, even if the bone's transform mode disallows scale
      * inheritance. */
    scaleY = 1;

    /** Sets the skeleton X position, which is added to the root bone worldX position. */
    x = 0;

    /** Sets the skeleton Y position, which is added to the root bone worldY position. */
    y = 0;

    constructor(data)
    {
        if (!data)
            throw new Error("data cannot be null.");
        this.data = data;
        this.bones = new Array();
        for (let i = 0; i < data.bones.length; i++)
        {
            let boneData = data.bones[i];
            let bone;
            if (!boneData.parent)
                bone = new SpineBone(boneData, this, null);
            else
            {
                let parent = this.bones[boneData.parent.index];
                bone = new SpineBone(boneData, this, parent);
                parent.children.push(bone);
            }
            this.bones.push(bone);
        }
        this.slots = new Array();
        this.drawOrder = new Array();
        for (let i = 0; i < data.slots.length; i++)
        {
            let slotData = data.slots[i];
            let bone = this.bones[slotData.boneData.index];
            let slot = new SpineSlot(slotData, bone);
            this.slots.push(slot);
            this.drawOrder.push(slot);
        }
        this.ikConstraints = new Array();
        for (let i = 0; i < data.ikConstraints.length; i++)
        {
            let ikConstraintData = data.ikConstraints[i];
            this.ikConstraints.push(new SpineIkConstraint(ikConstraintData, this));
        }
        this.transformConstraints = new Array();
        for (let i = 0; i < data.transformConstraints.length; i++)
        {
            let transformConstraintData = data.transformConstraints[i];
            this.transformConstraints.push(new SpineTransformConstraint(transformConstraintData, this));
        }
        this.pathConstraints = new Array();
        for (let i = 0; i < data.pathConstraints.length; i++)
        {
            let pathConstraintData = data.pathConstraints[i];
            this.pathConstraints.push(new SpinePathConstraint(pathConstraintData, this));
        }
        this.color = new SpineColor(1, 1, 1, 1);
        this.updateCache();
    }

    /** Caches information about bones and constraints. Must be called if the {@link #getSkin()} is modified or if bones,
     * constraints, or weighted path attachments are added or removed. */
    updateCache()
    {
        let updateCache = this._updateCache;
        updateCache.length = 0;
        let bones = this.bones;
        for (let i = 0, n = bones.length; i < n; i++)
        {
            let bone = bones[i];
            bone.sorted = bone.data.skinRequired;
            bone.active = !bone.sorted;
        }
        if (this.skin)
        {
            let skinBones = this.skin.bones;
            for (let i = 0, n = this.skin.bones.length; i < n; i++)
            {
                let bone = this.bones[skinBones[i].index];
                do
                {
                    bone.sorted = false;
                    bone.active = true;
                    bone = bone.parent;
                } while (bone);
            }
        }
        // IK first, lowest hierarchy depth first.
        let ikConstraints = this.ikConstraints;
        let transformConstraints = this.transformConstraints;
        let pathConstraints = this.pathConstraints;
        let ikCount = ikConstraints.length, transformCount = transformConstraints.length, pathCount = pathConstraints.length;
        let constraintCount = ikCount + transformCount + pathCount;
        outer: for (let i = 0; i < constraintCount; i++)
        {
            for (let ii = 0; ii < ikCount; ii++)
            {
                let constraint = ikConstraints[ii];
                if (constraint.data.order == i)
                {
                    this.sortIkConstraint(constraint);
                    continue outer;
                }
            }
            for (let ii = 0; ii < transformCount; ii++)
            {
                let constraint = transformConstraints[ii];
                if (constraint.data.order == i)
                {
                    this.sortTransformConstraint(constraint);
                    continue outer;
                }
            }
            for (let ii = 0; ii < pathCount; ii++)
            {
                let constraint = pathConstraints[ii];
                if (constraint.data.order == i)
                {
                    this.sortPathConstraint(constraint);
                    continue outer;
                }
            }
        }
        for (let i = 0, n = bones.length; i < n; i++)
            this.sortBone(bones[i]);
    }

    sortIkConstraint(constraint)
    {
        constraint.active = constraint.target.isActive() && (!constraint.data.skinRequired || (this.skin && SpineUtils.contains(this.skin.constraints, constraint.data, true)));
        if (!constraint.active)
            return;
        let target = constraint.target;
        this.sortBone(target);
        let constrained = constraint.bones;
        let parent = constrained[0];
        this.sortBone(parent);
        if (constrained.length == 1)
        {
            this._updateCache.push(constraint);
            this.sortReset(parent.children);
        }
        else
        {
            let child = constrained[constrained.length - 1];
            this.sortBone(child);
            this._updateCache.push(constraint);
            this.sortReset(parent.children);
            child.sorted = true;
        }
    }

    sortPathConstraint(constraint)
    {
        constraint.active = constraint.target.bone.isActive() && (!constraint.data.skinRequired || (this.skin && SpineUtils.contains(this.skin.constraints, constraint.data, true)));
        if (!constraint.active)
            return;
        let slot = constraint.target;
        let slotIndex = slot.data.index;
        let slotBone = slot.bone;
        if (this.skin)
            this.sortPathConstraintAttachment(this.skin, slotIndex, slotBone);
        if (this.data.defaultSkin && this.data.defaultSkin != this.skin)
            this.sortPathConstraintAttachment(this.data.defaultSkin, slotIndex, slotBone);
        for (let i = 0, n = this.data.skins.length; i < n; i++)
            this.sortPathConstraintAttachment(this.data.skins[i], slotIndex, slotBone);
        let attachment = slot.getAttachment();
        if (attachment instanceof SpinePathAttachment)
            this.sortPathConstraintAttachmentWith(attachment, slotBone);
        let constrained = constraint.bones;
        let boneCount = constrained.length;
        for (let i = 0; i < boneCount; i++)
            this.sortBone(constrained[i]);
        this._updateCache.push(constraint);
        for (let i = 0; i < boneCount; i++)
            this.sortReset(constrained[i].children);
        for (let i = 0; i < boneCount; i++)
            constrained[i].sorted = true;
    }

    sortTransformConstraint(constraint)
    {
        constraint.active = constraint.target.isActive() && (!constraint.data.skinRequired || (this.skin && SpineUtils.contains(this.skin.constraints, constraint.data, true)));
        if (!constraint.active)
            return;
        this.sortBone(constraint.target);
        let constrained = constraint.bones;
        let boneCount = constrained.length;
        if (constraint.data.local)
        {
            for (let i = 0; i < boneCount; i++)
            {
                let child = constrained[i];
                this.sortBone(child.parent);
                this.sortBone(child);
            }
        }
        else
        {
            for (let i = 0; i < boneCount; i++)
            {
                this.sortBone(constrained[i]);
            }
        }
        this._updateCache.push(constraint);
        for (let i = 0; i < boneCount; i++)
            this.sortReset(constrained[i].children);
        for (let i = 0; i < boneCount; i++)
            constrained[i].sorted = true;
    }

    sortPathConstraintAttachment(skin, slotIndex, slotBone)
    {
        let attachments = skin.attachments[slotIndex];
        if (!attachments)
            return;
        for (let key in attachments)
        {
            this.sortPathConstraintAttachmentWith(attachments[key], slotBone);
        }
    }

    sortPathConstraintAttachmentWith(attachment, slotBone)
    {
        if (!(attachment instanceof SpinePathAttachment))
            return;
        let pathBones = attachment.bones;
        if (!pathBones)
            this.sortBone(slotBone);
        else
        {
            let bones = this.bones;
            for (let i = 0, n = pathBones.length; i < n;)
            {
                let nn = pathBones[i++];
                nn += i;
                while (i < nn)
                    this.sortBone(bones[pathBones[i++]]);
            }
        }
    }

    sortBone(bone)
    {
        if (bone.sorted)
            return;
        let parent = bone.parent;
        if (parent)
            this.sortBone(parent);
        bone.sorted = true;
        this._updateCache.push(bone);
    }

    sortReset(bones)
    {
        for (let i = 0, n = bones.length; i < n; i++)
        {
            let bone = bones[i];
            if (!bone.active)
                continue;
            if (bone.sorted)
                this.sortReset(bone.children);
            bone.sorted = false;
        }
    }

    /** Updates the world transform for each bone and applies all constraints.
     *
     * See [World transforms](http://esotericsoftware.com/spine-runtime-skeletons#World-transforms) in the Spine
     * Runtimes Guide. */
    updateWorldTransform()
    {
        let bones = this.bones;
        for (let i = 0, n = bones.length; i < n; i++)
        {
            let bone = bones[i];
            bone.ax = bone.x;
            bone.ay = bone.y;
            bone.arotation = bone.rotation;
            bone.ascaleX = bone.scaleX;
            bone.ascaleY = bone.scaleY;
            bone.ashearX = bone.shearX;
            bone.ashearY = bone.shearY;
        }
        let updateCache = this._updateCache;
        for (let i = 0, n = updateCache.length; i < n; i++)
            updateCache[i].update();
    }

    updateWorldTransformWith(parent)
    {
        // Apply the parent bone transform to the root bone. The root bone always inherits scale, rotation and reflection.
        let rootBone = this.getRootBone();
        let pa = parent.a, pb = parent.b, pc = parent.c, pd = parent.d;
        rootBone.worldX = pa * this.x + pb * this.y + parent.worldX;
        rootBone.worldY = pc * this.x + pd * this.y + parent.worldY;
        let rotationY = rootBone.rotation + 90 + rootBone.shearY;
        let la = SpineMathUtils.cosDeg(rootBone.rotation + rootBone.shearX) * rootBone.scaleX;
        let lb = SpineMathUtils.cosDeg(rotationY) * rootBone.scaleY;
        let lc = SpineMathUtils.sinDeg(rootBone.rotation + rootBone.shearX) * rootBone.scaleX;
        let ld = SpineMathUtils.sinDeg(rotationY) * rootBone.scaleY;
        rootBone.a = (pa * la + pb * lc) * this.scaleX;
        rootBone.b = (pa * lb + pb * ld) * this.scaleX;
        rootBone.c = (pc * la + pd * lc) * this.scaleY;
        rootBone.d = (pc * lb + pd * ld) * this.scaleY;
        // Update everything except root bone.
        let updateCache = this._updateCache;
        for (let i = 0, n = updateCache.length; i < n; i++)
        {
            let updatable = updateCache[i];
            if (updatable != rootBone)
                updatable.update();
        }
    }

    /** Sets the bones, constraints, and slots to their setup pose values. */
    setToSetupPose()
    {
        this.setBonesToSetupPose();
        this.setSlotsToSetupPose();
    }

    /** Sets the bones and constraints to their setup pose values. */
    setBonesToSetupPose()
    {
        let bones = this.bones;
        for (let i = 0, n = bones.length; i < n; i++)
            bones[i].setToSetupPose();
        let ikConstraints = this.ikConstraints;
        for (let i = 0, n = ikConstraints.length; i < n; i++)
        {
            let constraint = ikConstraints[i];
            constraint.mix = constraint.data.mix;
            constraint.softness = constraint.data.softness;
            constraint.bendDirection = constraint.data.bendDirection;
            constraint.compress = constraint.data.compress;
            constraint.stretch = constraint.data.stretch;
        }
        let transformConstraints = this.transformConstraints;
        for (let i = 0, n = transformConstraints.length; i < n; i++)
        {
            let constraint = transformConstraints[i];
            let data = constraint.data;
            constraint.mixRotate = data.mixRotate;
            constraint.mixX = data.mixX;
            constraint.mixY = data.mixY;
            constraint.mixScaleX = data.mixScaleX;
            constraint.mixScaleY = data.mixScaleY;
            constraint.mixShearY = data.mixShearY;
        }
        let pathConstraints = this.pathConstraints;
        for (let i = 0, n = pathConstraints.length; i < n; i++)
        {
            let constraint = pathConstraints[i];
            let data = constraint.data;
            constraint.position = data.position;
            constraint.spacing = data.spacing;
            constraint.mixRotate = data.mixRotate;
            constraint.mixX = data.mixX;
            constraint.mixY = data.mixY;
        }
    }

    /** Sets the slots and draw order to their setup pose values. */
    setSlotsToSetupPose()
    {
        let slots = this.slots;
        SpineUtils.arrayCopy(slots, 0, this.drawOrder, 0, slots.length);
        for (let i = 0, n = slots.length; i < n; i++)
            slots[i].setToSetupPose();
    }

    /** @returns May return null. */
    getRootBone()
    {
        if (this.bones.length == 0)
            return null;
        return this.bones[0];
    }

    /** @returns May be null. */
    findBone(boneName)
    {
        if (!boneName)
            throw new Error("boneName cannot be null.");
        let bones = this.bones;
        for (let i = 0, n = bones.length; i < n; i++)
        {
            let bone = bones[i];
            if (bone.data.name == boneName)
                return bone;
        }
        return null;
    }

    /** Finds a slot by comparing each slot's name. It is more efficient to cache the results of this method than to call it
     * repeatedly.
     * @returns May be null. */
    findSlot(slotName)
    {
        if (!slotName)
            throw new Error("slotName cannot be null.");
        let slots = this.slots;
        for (let i = 0, n = slots.length; i < n; i++)
        {
            let slot = slots[i];
            if (slot.data.name == slotName)
                return slot;
        }
        return null;
    }

    /** Sets a skin by name.
     *
     * See {@link #setSkin()}. */
    setSkinByName(skinName)
    {
        let skin = this.data.findSkin(skinName);
        if (!skin)
            throw new Error("Skin not found: " + skinName);
        this.setSkin(skin);
    }

    /** Sets the skin used to look up attachments before looking in the {@link SkeletonData#defaultSkin default skin}. If the
     * skin is changed, {@link #updateCache()} is called.
     *
     * Attachments from the new skin are attached if the corresponding attachment from the old skin was attached. If there was no
     * old skin, each slot's setup mode attachment is attached from the new skin.
     *
     * After changing the skin, the visible attachments can be reset to those attached in the setup pose by calling
     * {@link #setSlotsToSetupPose()}. Also, often {@link AnimationState#apply()} is called before the next time the
     * skeleton is rendered to allow any attachment keys in the current animation(s) to hide or show attachments from the new skin.
     * @param newSkin May be null. */
    setSkin(newSkin)
    {
        if (newSkin == this.skin)
            return;
        if (newSkin)
        {
            if (this.skin)
                newSkin.attachAll(this, this.skin);
            else
            {
                let slots = this.slots;
                for (let i = 0, n = slots.length; i < n; i++)
                {
                    let slot = slots[i];
                    let name = slot.data.attachmentName;
                    if (name)
                    {
                        let attachment = newSkin.getAttachment(i, name);
                        if (attachment)
                            slot.setAttachment(attachment);
                    }
                }
            }
        }
        this.skin = newSkin;
        this.updateCache();
    }

    /** Finds an attachment by looking in the {@link #skin} and {@link SkeletonData#defaultSkin} using the slot name and attachment
     * name.
     *
     * See {@link #getAttachment()}.
     * @returns May be null. */
    getAttachmentByName(slotName, attachmentName)
    {
        return this.getAttachment(this.data.findSlot(slotName).index, attachmentName);
    }

    /** Finds an attachment by looking in the {@link #skin} and {@link SkeletonData#defaultSkin} using the slot index and
     * attachment name. First the skin is checked and if the attachment was not found, the default skin is checked.
     *
     * See [Runtime skins](http://esotericsoftware.com/spine-runtime-skins) in the Spine Runtimes Guide.
     * @returns May be null. */
    getAttachment(slotIndex, attachmentName)
    {
        if (!attachmentName)
            throw new Error("attachmentName cannot be null.");
        if (this.skin)
        {
            let attachment = this.skin.getAttachment(slotIndex, attachmentName);
            if (attachment)
                return attachment;
        }
        if (this.data.defaultSkin)
            return this.data.defaultSkin.getAttachment(slotIndex, attachmentName);
        return null;
    }

    /** A convenience method to set an attachment by finding the slot with {@link #findSlot()}, finding the attachment with
     * {@link #getAttachment()}, then setting the slot's {@link Slot#attachment}.
     * @param attachmentName May be null to clear the slot's attachment. */
    setAttachment(slotName, attachmentName)
    {
        if (!slotName)
            throw new Error("slotName cannot be null.");
        let slots = this.slots;
        for (let i = 0, n = slots.length; i < n; i++)
        {
            let slot = slots[i];
            if (slot.data.name == slotName)
            {
                let attachment = null;
                if (attachmentName)
                {
                    attachment = this.getAttachment(i, attachmentName);
                    if (!attachment)
                        throw new Error("Attachment not found: " + attachmentName + ", for slot: " + slotName);
                }
                slot.setAttachment(attachment);
                return;
            }
        }
        throw new Error("Slot not found: " + slotName);
    }

    /** Finds an IK constraint by comparing each IK constraint's name. It is more efficient to cache the results of this method
     * than to call it repeatedly.
     * @return May be null. */
    findIkConstraint(constraintName)
    {
        if (!constraintName)
            throw new Error("constraintName cannot be null.");
        let ikConstraints = this.ikConstraints;
        for (let i = 0, n = ikConstraints.length; i < n; i++)
        {
            let ikConstraint = ikConstraints[i];
            if (ikConstraint.data.name == constraintName)
                return ikConstraint;
        }
        return null;
    }

    /** Finds a transform constraint by comparing each transform constraint's name. It is more efficient to cache the results of
     * this method than to call it repeatedly.
     * @return May be null. */
    findTransformConstraint(constraintName)
    {
        if (!constraintName)
            throw new Error("constraintName cannot be null.");
        let transformConstraints = this.transformConstraints;
        for (let i = 0, n = transformConstraints.length; i < n; i++)
        {
            let constraint = transformConstraints[i];
            if (constraint.data.name == constraintName)
                return constraint;
        }
        return null;
    }

    /** Finds a path constraint by comparing each path constraint's name. It is more efficient to cache the results of this method
     * than to call it repeatedly.
     * @return May be null. */
    findPathConstraint(constraintName)
    {
        if (!constraintName)
            throw new Error("constraintName cannot be null.");
        let pathConstraints = this.pathConstraints;
        for (let i = 0, n = pathConstraints.length; i < n; i++)
        {
            let constraint = pathConstraints[i];
            if (constraint.data.name == constraintName)
                return constraint;
        }
        return null;
    }

    /** Returns the axis aligned bounding box (AABB) of the region and mesh attachments for the current pose as `{ x: number, y: number, width: number, height: number }`.
     * Note that this method will create temporary objects which can add to garbage collection pressure. Use `getBounds()` if garbage collection is a concern. */
    getBoundsRect()
    {
        let offset = new SpineVector2();
        let size = new SpineVector2();
        this.getBounds(offset, size);
        return { x: offset.x, y: offset.y, width: size.x, height: size.y };
    }

    /** Returns the axis aligned bounding box (AABB) of the region and mesh attachments for the current pose.
     * @param offset An output value, the distance from the skeleton origin to the bottom left corner of the AABB.
     * @param size An output value, the width and height of the AABB.
     * @param temp Working memory to temporarily store attachments' computed world vertices. */
    getBounds(offset, size, temp = new Array(2))
    {
        if (!offset)
            throw new Error("offset cannot be null.");
        if (!size)
            throw new Error("size cannot be null.");
        let drawOrder = this.drawOrder;
        let minX = Number.POSITIVE_INFINITY, minY = Number.POSITIVE_INFINITY, maxX = Number.NEGATIVE_INFINITY, maxY = Number.NEGATIVE_INFINITY;
        for (let i = 0, n = drawOrder.length; i < n; i++)
        {
            let slot = drawOrder[i];
            if (!slot.bone.active)
                continue;
            let verticesLength = 0;
            let vertices = null;
            let attachment = slot.getAttachment();
            if (attachment instanceof SpineRegionAttachment)
            {
                verticesLength = 8;
                vertices = SpineUtils.setArraySize(temp, verticesLength, 0);
                attachment.computeWorldVertices(slot.bone, vertices, 0, 2);
            }
            else if (attachment instanceof SpineMeshAttachment)
            {
                let mesh = attachment;
                verticesLength = mesh.worldVerticesLength;
                vertices = SpineUtils.setArraySize(temp, verticesLength, 0);
                mesh.computeWorldVertices(slot, 0, verticesLength, vertices, 0, 2);
            }
            if (vertices)
            {
                for (let ii = 0, nn = vertices.length; ii < nn; ii += 2)
                {
                    let x = vertices[ii], y = vertices[ii + 1];
                    minX = Math.min(minX, x);
                    minY = Math.min(minY, y);
                    maxX = Math.max(maxX, x);
                    maxY = Math.max(maxY, y);
                }
            }
        }
        offset.set(minX, minY);
        size.set(maxX - minX, maxY - minY);
    }

    /** Increments the skeleton's {@link #time}. */
    update(delta)
    {
        this.time += delta;
    }
}
