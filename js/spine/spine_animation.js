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
    Spine animations and timelines, ported from spine-core 4.0.31
    (Animation.ts); see docs/spine_plan.md.

    A SpineAnimation is a name, a duration and its timelines; each timeline
    keys one property (a bone's rotation, a slot's color, the draw order,
    ...) over time, with linear, stepped or Bezier curves between keys.
    SpineSkeletonJson builds them; apply() poses a skeleton (Phase 4).

        SpineAnimation, SpineTimeline, SpineCurveTimeline(1, 2)
        Bone:        SpineRotateTimeline, SpineTranslate(X, Y)Timeline, SpineScale(X, Y)Timeline, SpineShear(X, Y)Timeline
        Slot:        SpineRGBATimeline, SpineRGBTimeline, SpineAlphaTimeline, SpineRGBA2Timeline, SpineRGB2Timeline,
                     SpineAttachmentTimeline, SpineDeformTimeline
        Skeleton:    SpineEventTimeline, SpineDrawOrderTimeline
        Constraints: SpineIkConstraintTimeline, SpineTransformConstraintTimeline,
                     SpinePathConstraintPosition / Spacing / MixTimeline

    Spine's "Property" (the first part of each property id) is SpineProperty in spine_defines.js.
*/

/** A simple container for a list of timelines and a name. */
class SpineAnimation
{
    /** The animation's name, which is unique across all animations in the skeleton. */
    name;
    timelines = null;
    timelineIds = null;

    /** The duration of the animation in seconds, which is the highest time of all keys in the timeline. */
    duration;

    constructor(name, timelines, duration)
    {
        if (!name)
            throw new Error("name cannot be null.");
        this.name = name;
        this.setTimelines(timelines);
        this.duration = duration;
    }

    setTimelines(timelines)
    {
        if (!timelines)
            throw new Error("timelines cannot be null.");
        this.timelines = timelines;
        this.timelineIds = new SpineStringSet();
        for (var i = 0; i < timelines.length; i++)
            this.timelineIds.addAll(timelines[i].getPropertyIds());
    }

    hasTimeline(ids)
    {
        for (let i = 0; i < ids.length; i++)
            if (this.timelineIds.contains(ids[i]))
                return true;
        return false;
    }

    /** Applies all the animation's timelines to the specified skeleton.
     *
     * See Timeline {@link Timeline#apply(Skeleton, float, float, Array, float, MixBlend, MixDirection)}.
     * @param loop If true, the animation repeats after {@link #getDuration()}.
     * @param events May be null to ignore fired events. */
    apply(skeleton, lastTime, time, loop, events, alpha, blend, direction)
    {
        if (!skeleton)
            throw new Error("skeleton cannot be null.");
        if (loop && this.duration != 0)
        {
            time %= this.duration;
            if (lastTime > 0)
                lastTime %= this.duration;
        }
        let timelines = this.timelines;
        for (let i = 0, n = timelines.length; i < n; i++)
            timelines[i].apply(skeleton, lastTime, time, events, alpha, blend, direction);
    }
}

/** The interface for all timelines. */
class SpineTimeline
{
    propertyIds = null;
    frames = null;

    constructor(frameCount, propertyIds)
    {
        this.propertyIds = propertyIds;
        this.frames = new Float32Array(frameCount * this.getFrameEntries());
    }

    getPropertyIds()
    {
        return this.propertyIds;
    }

    getFrameEntries()
    {
        return 1;
    }

    getFrameCount()
    {
        return this.frames.length / this.getFrameEntries();
    }

    getDuration()
    {
        return this.frames[this.frames.length - this.getFrameEntries()];
    }

    static search1(frames, time)
    {
        let n = frames.length;
        for (let i = 1; i < n; i++)
            if (frames[i] > time)
                return i - 1;
        return n - 1;
    }

    static search(frames, time, step)
    {
        let n = frames.length;
        for (let i = step; i < n; i += step)
            if (frames[i] > time)
                return i - step;
        return n - step;
    }
}

/** The base class for timelines that use interpolation between key frame values. */
class SpineCurveTimeline extends SpineTimeline
{
    curves = null; // type, x, y, ...
    constructor(frameCount, bezierCount, propertyIds)
    {
        super(frameCount, propertyIds);
        this.curves = new Float32Array(frameCount + bezierCount * 18 /*BEZIER_SIZE*/);
        this.curves[frameCount - 1] = 1 /*STEPPED*/;
    }

    /** Sets the specified key frame to linear interpolation. */
    setLinear(frame)
    {
        this.curves[frame] = 0 /*LINEAR*/;
    }

    /** Sets the specified key frame to stepped interpolation. */
    setStepped(frame)
    {
        this.curves[frame] = 1 /*STEPPED*/;
    }

    /** Shrinks the storage for Bezier curves, for use when <code>bezierCount</code> (specified in the constructor) was larger
     * than the actual number of Bezier curves. */
    shrink(bezierCount)
    {
        let size = this.getFrameCount() + bezierCount * 18 /*BEZIER_SIZE*/;
        if (this.curves.length > size)
        {
            let newCurves = new Float32Array(size);
            newCurves.set(this.curves.subarray(0, size));
            this.curves = newCurves;
        }
    }

    /** Stores the segments for the specified Bezier curve. For timelines that modify multiple values, there may be more than
     * one curve per frame.
     * @param bezier The ordinal of this Bezier curve for this timeline, between 0 and <code>bezierCount - 1</code> (specified
     *           in the constructor), inclusive.
     * @param frame Between 0 and <code>frameCount - 1</code>, inclusive.
     * @param value The index of the value for this frame that this curve is used for.
     * @param time1 The time for the first key.
     * @param value1 The value for the first key.
     * @param cx1 The time for the first Bezier handle.
     * @param cy1 The value for the first Bezier handle.
     * @param cx2 The time of the second Bezier handle.
     * @param cy2 The value for the second Bezier handle.
     * @param time2 The time for the second key.
     * @param value2 The value for the second key. */
    setBezier(bezier, frame, value, time1, value1, cx1, cy1, cx2, cy2, time2, value2)
    {
        let curves = this.curves;
        let i = this.getFrameCount() + bezier * 18 /*BEZIER_SIZE*/;
        if (value == 0)
            curves[frame] = 2 /*BEZIER*/ + i;
        let tmpx = (time1 - cx1 * 2 + cx2) * 0.03, tmpy = (value1 - cy1 * 2 + cy2) * 0.03;
        let dddx = ((cx1 - cx2) * 3 - time1 + time2) * 0.006, dddy = ((cy1 - cy2) * 3 - value1 + value2) * 0.006;
        let ddx = tmpx * 2 + dddx, ddy = tmpy * 2 + dddy;
        let dx = (cx1 - time1) * 0.3 + tmpx + dddx * 0.16666667, dy = (cy1 - value1) * 0.3 + tmpy + dddy * 0.16666667;
        let x = time1 + dx, y = value1 + dy;
        for (let n = i + 18 /*BEZIER_SIZE*/; i < n; i += 2)
        {
            curves[i] = x;
            curves[i + 1] = y;
            dx += ddx;
            dy += ddy;
            ddx += dddx;
            ddy += dddy;
            x += dx;
            y += dy;
        }
    }

    /** Returns the Bezier interpolated value for the specified time.
     * @param frameIndex The index into {@link #getFrames()} for the values of the frame before <code>time</code>.
     * @param valueOffset The offset from <code>frameIndex</code> to the value this curve is used for.
     * @param i The index of the Bezier segments. See {@link #getCurveType(int)}. */
    getBezierValue(time, frameIndex, valueOffset, i)
    {
        let curves = this.curves;
        if (curves[i] > time)
        {
            let x = this.frames[frameIndex], y = this.frames[frameIndex + valueOffset];
            return y + (time - x) / (curves[i] - x) * (curves[i + 1] - y);
        }
        let n = i + 18 /*BEZIER_SIZE*/;
        for (i += 2; i < n; i += 2)
        {
            if (curves[i] >= time)
            {
                let x = curves[i - 2], y = curves[i - 1];
                return y + (time - x) / (curves[i] - x) * (curves[i + 1] - y);
            }
        }
        frameIndex += this.getFrameEntries();
        let x = curves[n - 2], y = curves[n - 1];
        return y + (time - x) / (this.frames[frameIndex] - x) * (this.frames[frameIndex + valueOffset] - y);
    }
}

class SpineCurveTimeline1 extends SpineCurveTimeline
{
    constructor(frameCount, bezierCount, propertyId)
    {
        super(frameCount, bezierCount, [propertyId]);
    }

    getFrameEntries()
    {
        return 2 /*ENTRIES*/;
    }

    /** Sets the time and value for the specified frame.
     * @param frame Between 0 and <code>frameCount</code>, inclusive.
     * @param time The frame time in seconds. */
    setFrame(frame, time, value)
    {
        frame <<= 1;
        this.frames[frame] = time;
        this.frames[frame + 1 /*VALUE*/] = value;
    }

    /** Returns the interpolated value for the specified time. */
    getCurveValue(time)
    {
        let frames = this.frames;
        let i = frames.length - 2;
        for (let ii = 2; ii <= i; ii += 2)
        {
            if (frames[ii] > time)
            {
                i = ii - 2;
                break;
            }
        }
        let curveType = this.curves[i >> 1];
        switch (curveType)
        {
            case 0 /*LINEAR*/:
                let before = frames[i], value = frames[i + 1 /*VALUE*/];
                return value + (time - before) / (frames[i + 2 /*ENTRIES*/] - before) * (frames[i + 2 /*ENTRIES*/ + 1 /*VALUE*/] - value);
            case 1 /*STEPPED*/:
                return frames[i + 1 /*VALUE*/];
        }
        return this.getBezierValue(time, i, 1 /*VALUE*/, curveType - 2 /*BEZIER*/);
    }
}

/** The base class for a {@link CurveTimeline} which sets two properties. */
class SpineCurveTimeline2 extends SpineCurveTimeline
{
    /** @param bezierCount The maximum number of Bezier curves. See {@link #shrink(int)}.
     * @param propertyIds Unique identifiers for the properties the timeline modifies. */
    constructor(frameCount, bezierCount, propertyId1, propertyId2)
    {
        super(frameCount, bezierCount, [propertyId1, propertyId2]);
    }

    getFrameEntries()
    {
        return 3 /*ENTRIES*/;
    }

    /** Sets the time and values for the specified frame.
     * @param frame Between 0 and <code>frameCount</code>, inclusive.
     * @param time The frame time in seconds. */
    setFrame(frame, time, value1, value2)
    {
        frame *= 3 /*ENTRIES*/;
        this.frames[frame] = time;
        this.frames[frame + 1 /*VALUE1*/] = value1;
        this.frames[frame + 2 /*VALUE2*/] = value2;
    }
}

/** Changes a bone's local {@link Bone#rotation}. */
class SpineRotateTimeline extends SpineCurveTimeline1
{
    boneIndex = 0;

    constructor(frameCount, bezierCount, boneIndex)
    {
        super(frameCount, bezierCount, SpineProperty.rotate + "|" + boneIndex);
        this.boneIndex = boneIndex;
    }

    apply(skeleton, lastTime, time, events, alpha, blend, direction)
    {
        let bone = skeleton.bones[this.boneIndex];
        if (!bone.active)
            return;
        let frames = this.frames;
        if (time < frames[0])
        {
            switch (blend)
            {
                case SpineMixBlend.setup:
                    bone.rotation = bone.data.rotation;
                    return;
                case SpineMixBlend.first:
                    bone.rotation += (bone.data.rotation - bone.rotation) * alpha;
            }
            return;
        }
        let r = this.getCurveValue(time);
        switch (blend)
        {
            case SpineMixBlend.setup:
                bone.rotation = bone.data.rotation + r * alpha;
                break;
            case SpineMixBlend.first:
            case SpineMixBlend.replace:
                r += bone.data.rotation - bone.rotation;
            case SpineMixBlend.add:
                bone.rotation += r * alpha;
        }
    }
}

/** Changes a bone's local {@link Bone#x} and {@link Bone#y}. */
class SpineTranslateTimeline extends SpineCurveTimeline2
{
    boneIndex = 0;

    constructor(frameCount, bezierCount, boneIndex)
    {
        super(frameCount, bezierCount, SpineProperty.x + "|" + boneIndex, SpineProperty.y + "|" + boneIndex);
        this.boneIndex = boneIndex;
    }

    apply(skeleton, lastTime, time, events, alpha, blend, direction)
    {
        let bone = skeleton.bones[this.boneIndex];
        if (!bone.active)
            return;
        let frames = this.frames;
        if (time < frames[0])
        {
            switch (blend)
            {
                case SpineMixBlend.setup:
                    bone.x = bone.data.x;
                    bone.y = bone.data.y;
                    return;
                case SpineMixBlend.first:
                    bone.x += (bone.data.x - bone.x) * alpha;
                    bone.y += (bone.data.y - bone.y) * alpha;
            }
            return;
        }
        let x = 0, y = 0;
        let i = SpineTimeline.search(frames, time, 3 /*ENTRIES*/);
        let curveType = this.curves[i / 3 /*ENTRIES*/];
        switch (curveType)
        {
            case 0 /*LINEAR*/:
                let before = frames[i];
                x = frames[i + 1 /*VALUE1*/];
                y = frames[i + 2 /*VALUE2*/];
                let t = (time - before) / (frames[i + 3 /*ENTRIES*/] - before);
                x += (frames[i + 3 /*ENTRIES*/ + 1 /*VALUE1*/] - x) * t;
                y += (frames[i + 3 /*ENTRIES*/ + 2 /*VALUE2*/] - y) * t;
                break;
            case 1 /*STEPPED*/:
                x = frames[i + 1 /*VALUE1*/];
                y = frames[i + 2 /*VALUE2*/];
                break;
            default:
                x = this.getBezierValue(time, i, 1 /*VALUE1*/, curveType - 2 /*BEZIER*/);
                y = this.getBezierValue(time, i, 2 /*VALUE2*/, curveType + 18 /*BEZIER_SIZE*/ - 2 /*BEZIER*/);
        }
        switch (blend)
        {
            case SpineMixBlend.setup:
                bone.x = bone.data.x + x * alpha;
                bone.y = bone.data.y + y * alpha;
                break;
            case SpineMixBlend.first:
            case SpineMixBlend.replace:
                bone.x += (bone.data.x + x - bone.x) * alpha;
                bone.y += (bone.data.y + y - bone.y) * alpha;
                break;
            case SpineMixBlend.add:
                bone.x += x * alpha;
                bone.y += y * alpha;
        }
    }
}

/** Changes a bone's local {@link Bone#x}. */
class SpineTranslateXTimeline extends SpineCurveTimeline1
{
    boneIndex = 0;

    constructor(frameCount, bezierCount, boneIndex)
    {
        super(frameCount, bezierCount, SpineProperty.x + "|" + boneIndex);
        this.boneIndex = boneIndex;
    }

    apply(skeleton, lastTime, time, events, alpha, blend, direction)
    {
        let bone = skeleton.bones[this.boneIndex];
        if (!bone.active)
            return;
        let frames = this.frames;
        if (time < frames[0])
        {
            switch (blend)
            {
                case SpineMixBlend.setup:
                    bone.x = bone.data.x;
                    return;
                case SpineMixBlend.first:
                    bone.x += (bone.data.x - bone.x) * alpha;
            }
            return;
        }
        let x = this.getCurveValue(time);
        switch (blend)
        {
            case SpineMixBlend.setup:
                bone.x = bone.data.x + x * alpha;
                break;
            case SpineMixBlend.first:
            case SpineMixBlend.replace:
                bone.x += (bone.data.x + x - bone.x) * alpha;
                break;
            case SpineMixBlend.add:
                bone.x += x * alpha;
        }
    }
}

/** Changes a bone's local {@link Bone#x}. */
class SpineTranslateYTimeline extends SpineCurveTimeline1
{
    boneIndex = 0;

    constructor(frameCount, bezierCount, boneIndex)
    {
        super(frameCount, bezierCount, SpineProperty.y + "|" + boneIndex);
        this.boneIndex = boneIndex;
    }

    apply(skeleton, lastTime, time, events, alpha, blend, direction)
    {
        let bone = skeleton.bones[this.boneIndex];
        if (!bone.active)
            return;
        let frames = this.frames;
        if (time < frames[0])
        {
            switch (blend)
            {
                case SpineMixBlend.setup:
                    bone.y = bone.data.y;
                    return;
                case SpineMixBlend.first:
                    bone.y += (bone.data.y - bone.y) * alpha;
            }
            return;
        }
        let y = this.getCurveValue(time);
        switch (blend)
        {
            case SpineMixBlend.setup:
                bone.y = bone.data.y + y * alpha;
                break;
            case SpineMixBlend.first:
            case SpineMixBlend.replace:
                bone.y += (bone.data.y + y - bone.y) * alpha;
                break;
            case SpineMixBlend.add:
                bone.y += y * alpha;
        }
    }
}

/** Changes a bone's local {@link Bone#scaleX)} and {@link Bone#scaleY}. */
class SpineScaleTimeline extends SpineCurveTimeline2
{
    boneIndex = 0;

    constructor(frameCount, bezierCount, boneIndex)
    {
        super(frameCount, bezierCount, SpineProperty.scaleX + "|" + boneIndex, SpineProperty.scaleY + "|" + boneIndex);
        this.boneIndex = boneIndex;
    }

    apply(skeleton, lastTime, time, events, alpha, blend, direction)
    {
        let bone = skeleton.bones[this.boneIndex];
        if (!bone.active)
            return;
        let frames = this.frames;
        if (time < frames[0])
        {
            switch (blend)
            {
                case SpineMixBlend.setup:
                    bone.scaleX = bone.data.scaleX;
                    bone.scaleY = bone.data.scaleY;
                    return;
                case SpineMixBlend.first:
                    bone.scaleX += (bone.data.scaleX - bone.scaleX) * alpha;
                    bone.scaleY += (bone.data.scaleY - bone.scaleY) * alpha;
            }
            return;
        }
        let x, y;
        let i = SpineTimeline.search(frames, time, 3 /*ENTRIES*/);
        let curveType = this.curves[i / 3 /*ENTRIES*/];
        switch (curveType)
        {
            case 0 /*LINEAR*/:
                let before = frames[i];
                x = frames[i + 1 /*VALUE1*/];
                y = frames[i + 2 /*VALUE2*/];
                let t = (time - before) / (frames[i + 3 /*ENTRIES*/] - before);
                x += (frames[i + 3 /*ENTRIES*/ + 1 /*VALUE1*/] - x) * t;
                y += (frames[i + 3 /*ENTRIES*/ + 2 /*VALUE2*/] - y) * t;
                break;
            case 1 /*STEPPED*/:
                x = frames[i + 1 /*VALUE1*/];
                y = frames[i + 2 /*VALUE2*/];
                break;
            default:
                x = this.getBezierValue(time, i, 1 /*VALUE1*/, curveType - 2 /*BEZIER*/);
                y = this.getBezierValue(time, i, 2 /*VALUE2*/, curveType + 18 /*BEZIER_SIZE*/ - 2 /*BEZIER*/);
        }
        x *= bone.data.scaleX;
        y *= bone.data.scaleY;
        if (alpha == 1)
        {
            if (blend == SpineMixBlend.add)
            {
                bone.scaleX += x - bone.data.scaleX;
                bone.scaleY += y - bone.data.scaleY;
            }
            else
            {
                bone.scaleX = x;
                bone.scaleY = y;
            }
        }
        else
        {
            let bx = 0, by = 0;
            if (direction == SpineMixDirection.mixOut)
            {
                switch (blend)
                {
                    case SpineMixBlend.setup:
                        bx = bone.data.scaleX;
                        by = bone.data.scaleY;
                        bone.scaleX = bx + (Math.abs(x) * SpineMathUtils.signum(bx) - bx) * alpha;
                        bone.scaleY = by + (Math.abs(y) * SpineMathUtils.signum(by) - by) * alpha;
                        break;
                    case SpineMixBlend.first:
                    case SpineMixBlend.replace:
                        bx = bone.scaleX;
                        by = bone.scaleY;
                        bone.scaleX = bx + (Math.abs(x) * SpineMathUtils.signum(bx) - bx) * alpha;
                        bone.scaleY = by + (Math.abs(y) * SpineMathUtils.signum(by) - by) * alpha;
                        break;
                    case SpineMixBlend.add:
                        bone.scaleX += (x - bone.data.scaleX) * alpha;
                        bone.scaleY += (y - bone.data.scaleY) * alpha;
                }
            }
            else
            {
                switch (blend)
                {
                    case SpineMixBlend.setup:
                        bx = Math.abs(bone.data.scaleX) * SpineMathUtils.signum(x);
                        by = Math.abs(bone.data.scaleY) * SpineMathUtils.signum(y);
                        bone.scaleX = bx + (x - bx) * alpha;
                        bone.scaleY = by + (y - by) * alpha;
                        break;
                    case SpineMixBlend.first:
                    case SpineMixBlend.replace:
                        bx = Math.abs(bone.scaleX) * SpineMathUtils.signum(x);
                        by = Math.abs(bone.scaleY) * SpineMathUtils.signum(y);
                        bone.scaleX = bx + (x - bx) * alpha;
                        bone.scaleY = by + (y - by) * alpha;
                        break;
                    case SpineMixBlend.add:
                        bone.scaleX += (x - bone.data.scaleX) * alpha;
                        bone.scaleY += (y - bone.data.scaleY) * alpha;
                }
            }
        }
    }
}

/** Changes a bone's local {@link Bone#scaleX)} and {@link Bone#scaleY}. */
class SpineScaleXTimeline extends SpineCurveTimeline1
{
    boneIndex = 0;

    constructor(frameCount, bezierCount, boneIndex)
    {
        super(frameCount, bezierCount, SpineProperty.scaleX + "|" + boneIndex);
        this.boneIndex = boneIndex;
    }

    apply(skeleton, lastTime, time, events, alpha, blend, direction)
    {
        let bone = skeleton.bones[this.boneIndex];
        if (!bone.active)
            return;
        let frames = this.frames;
        if (time < frames[0])
        {
            switch (blend)
            {
                case SpineMixBlend.setup:
                    bone.scaleX = bone.data.scaleX;
                    return;
                case SpineMixBlend.first:
                    bone.scaleX += (bone.data.scaleX - bone.scaleX) * alpha;
            }
            return;
        }
        let x = this.getCurveValue(time) * bone.data.scaleX;
        if (alpha == 1)
        {
            if (blend == SpineMixBlend.add)
                bone.scaleX += x - bone.data.scaleX;
            else
                bone.scaleX = x;
        }
        else
        {
            // Mixing out uses sign of setup or current pose, else use sign of key.
            let bx = 0;
            if (direction == SpineMixDirection.mixOut)
            {
                switch (blend)
                {
                    case SpineMixBlend.setup:
                        bx = bone.data.scaleX;
                        bone.scaleX = bx + (Math.abs(x) * SpineMathUtils.signum(bx) - bx) * alpha;
                        break;
                    case SpineMixBlend.first:
                    case SpineMixBlend.replace:
                        bx = bone.scaleX;
                        bone.scaleX = bx + (Math.abs(x) * SpineMathUtils.signum(bx) - bx) * alpha;
                        break;
                    case SpineMixBlend.add:
                        bone.scaleX += (x - bone.data.scaleX) * alpha;
                }
            }
            else
            {
                switch (blend)
                {
                    case SpineMixBlend.setup:
                        bx = Math.abs(bone.data.scaleX) * SpineMathUtils.signum(x);
                        bone.scaleX = bx + (x - bx) * alpha;
                        break;
                    case SpineMixBlend.first:
                    case SpineMixBlend.replace:
                        bx = Math.abs(bone.scaleX) * SpineMathUtils.signum(x);
                        bone.scaleX = bx + (x - bx) * alpha;
                        break;
                    case SpineMixBlend.add:
                        bone.scaleX += (x - bone.data.scaleX) * alpha;
                }
            }
        }
    }
}

/** Changes a bone's local {@link Bone#scaleX)} and {@link Bone#scaleY}. */
class SpineScaleYTimeline extends SpineCurveTimeline1
{
    boneIndex = 0;

    constructor(frameCount, bezierCount, boneIndex)
    {
        super(frameCount, bezierCount, SpineProperty.scaleY + "|" + boneIndex);
        this.boneIndex = boneIndex;
    }

    apply(skeleton, lastTime, time, events, alpha, blend, direction)
    {
        let bone = skeleton.bones[this.boneIndex];
        if (!bone.active)
            return;
        let frames = this.frames;
        if (time < frames[0])
        {
            switch (blend)
            {
                case SpineMixBlend.setup:
                    bone.scaleY = bone.data.scaleY;
                    return;
                case SpineMixBlend.first:
                    bone.scaleY += (bone.data.scaleY - bone.scaleY) * alpha;
            }
            return;
        }
        let y = this.getCurveValue(time) * bone.data.scaleY;
        if (alpha == 1)
        {
            if (blend == SpineMixBlend.add)
                bone.scaleY += y - bone.data.scaleY;
            else
                bone.scaleY = y;
        }
        else
        {
            // Mixing out uses sign of setup or current pose, else use sign of key.
            let by = 0;
            if (direction == SpineMixDirection.mixOut)
            {
                switch (blend)
                {
                    case SpineMixBlend.setup:
                        by = bone.data.scaleY;
                        bone.scaleY = by + (Math.abs(y) * SpineMathUtils.signum(by) - by) * alpha;
                        break;
                    case SpineMixBlend.first:
                    case SpineMixBlend.replace:
                        by = bone.scaleY;
                        bone.scaleY = by + (Math.abs(y) * SpineMathUtils.signum(by) - by) * alpha;
                        break;
                    case SpineMixBlend.add:
                        bone.scaleY += (y - bone.data.scaleY) * alpha;
                }
            }
            else
            {
                switch (blend)
                {
                    case SpineMixBlend.setup:
                        by = Math.abs(bone.data.scaleY) * SpineMathUtils.signum(y);
                        bone.scaleY = by + (y - by) * alpha;
                        break;
                    case SpineMixBlend.first:
                    case SpineMixBlend.replace:
                        by = Math.abs(bone.scaleY) * SpineMathUtils.signum(y);
                        bone.scaleY = by + (y - by) * alpha;
                        break;
                    case SpineMixBlend.add:
                        bone.scaleY += (y - bone.data.scaleY) * alpha;
                }
            }
        }
    }
}

/** Changes a bone's local {@link Bone#shearX} and {@link Bone#shearY}. */
class SpineShearTimeline extends SpineCurveTimeline2
{
    boneIndex = 0;

    constructor(frameCount, bezierCount, boneIndex)
    {
        super(frameCount, bezierCount, SpineProperty.shearX + "|" + boneIndex, SpineProperty.shearY + "|" + boneIndex);
        this.boneIndex = boneIndex;
    }

    apply(skeleton, lastTime, time, events, alpha, blend, direction)
    {
        let bone = skeleton.bones[this.boneIndex];
        if (!bone.active)
            return;
        let frames = this.frames;
        if (time < frames[0])
        {
            switch (blend)
            {
                case SpineMixBlend.setup:
                    bone.shearX = bone.data.shearX;
                    bone.shearY = bone.data.shearY;
                    return;
                case SpineMixBlend.first:
                    bone.shearX += (bone.data.shearX - bone.shearX) * alpha;
                    bone.shearY += (bone.data.shearY - bone.shearY) * alpha;
            }
            return;
        }
        let x = 0, y = 0;
        let i = SpineTimeline.search(frames, time, 3 /*ENTRIES*/);
        let curveType = this.curves[i / 3 /*ENTRIES*/];
        switch (curveType)
        {
            case 0 /*LINEAR*/:
                let before = frames[i];
                x = frames[i + 1 /*VALUE1*/];
                y = frames[i + 2 /*VALUE2*/];
                let t = (time - before) / (frames[i + 3 /*ENTRIES*/] - before);
                x += (frames[i + 3 /*ENTRIES*/ + 1 /*VALUE1*/] - x) * t;
                y += (frames[i + 3 /*ENTRIES*/ + 2 /*VALUE2*/] - y) * t;
                break;
            case 1 /*STEPPED*/:
                x = frames[i + 1 /*VALUE1*/];
                y = frames[i + 2 /*VALUE2*/];
                break;
            default:
                x = this.getBezierValue(time, i, 1 /*VALUE1*/, curveType - 2 /*BEZIER*/);
                y = this.getBezierValue(time, i, 2 /*VALUE2*/, curveType + 18 /*BEZIER_SIZE*/ - 2 /*BEZIER*/);
        }
        switch (blend)
        {
            case SpineMixBlend.setup:
                bone.shearX = bone.data.shearX + x * alpha;
                bone.shearY = bone.data.shearY + y * alpha;
                break;
            case SpineMixBlend.first:
            case SpineMixBlend.replace:
                bone.shearX += (bone.data.shearX + x - bone.shearX) * alpha;
                bone.shearY += (bone.data.shearY + y - bone.shearY) * alpha;
                break;
            case SpineMixBlend.add:
                bone.shearX += x * alpha;
                bone.shearY += y * alpha;
        }
    }
}

/** Changes a bone's local {@link Bone#shearX} and {@link Bone#shearY}. */
class SpineShearXTimeline extends SpineCurveTimeline1
{
    boneIndex = 0;

    constructor(frameCount, bezierCount, boneIndex)
    {
        super(frameCount, bezierCount, SpineProperty.shearX + "|" + boneIndex);
        this.boneIndex = boneIndex;
    }

    apply(skeleton, lastTime, time, events, alpha, blend, direction)
    {
        let bone = skeleton.bones[this.boneIndex];
        if (!bone.active)
            return;
        let frames = this.frames;
        if (time < frames[0])
        {
            switch (blend)
            {
                case SpineMixBlend.setup:
                    bone.shearX = bone.data.shearX;
                    return;
                case SpineMixBlend.first:
                    bone.shearX += (bone.data.shearX - bone.shearX) * alpha;
            }
            return;
        }
        let x = this.getCurveValue(time);
        switch (blend)
        {
            case SpineMixBlend.setup:
                bone.shearX = bone.data.shearX + x * alpha;
                break;
            case SpineMixBlend.first:
            case SpineMixBlend.replace:
                bone.shearX += (bone.data.shearX + x - bone.shearX) * alpha;
                break;
            case SpineMixBlend.add:
                bone.shearX += x * alpha;
        }
    }
}

/** Changes a bone's local {@link Bone#shearX} and {@link Bone#shearY}. */
class SpineShearYTimeline extends SpineCurveTimeline1
{
    boneIndex = 0;

    constructor(frameCount, bezierCount, boneIndex)
    {
        super(frameCount, bezierCount, SpineProperty.shearY + "|" + boneIndex);
        this.boneIndex = boneIndex;
    }

    apply(skeleton, lastTime, time, events, alpha, blend, direction)
    {
        let bone = skeleton.bones[this.boneIndex];
        if (!bone.active)
            return;
        let frames = this.frames;
        if (time < frames[0])
        {
            switch (blend)
            {
                case SpineMixBlend.setup:
                    bone.shearY = bone.data.shearY;
                    return;
                case SpineMixBlend.first:
                    bone.shearY += (bone.data.shearY - bone.shearY) * alpha;
            }
            return;
        }
        let y = this.getCurveValue(time);
        switch (blend)
        {
            case SpineMixBlend.setup:
                bone.shearY = bone.data.shearY + y * alpha;
                break;
            case SpineMixBlend.first:
            case SpineMixBlend.replace:
                bone.shearY += (bone.data.shearY + y - bone.shearY) * alpha;
                break;
            case SpineMixBlend.add:
                bone.shearY += y * alpha;
        }
    }
}

/** Changes a slot's {@link Slot#color}. */
class SpineRGBATimeline extends SpineCurveTimeline
{
    slotIndex = 0;

    constructor(frameCount, bezierCount, slotIndex)
    {
        super(frameCount, bezierCount, [
            SpineProperty.rgb + "|" + slotIndex,
            SpineProperty.alpha + "|" + slotIndex
        ]);
        this.slotIndex = slotIndex;
    }

    getFrameEntries()
    {
        return 5 /*ENTRIES*/;
    }

    /** Sets the time in seconds, red, green, blue, and alpha for the specified key frame. */
    setFrame(frame, time, r, g, b, a)
    {
        frame *= 5 /*ENTRIES*/;
        this.frames[frame] = time;
        this.frames[frame + 1 /*R*/] = r;
        this.frames[frame + 2 /*G*/] = g;
        this.frames[frame + 3 /*B*/] = b;
        this.frames[frame + 4 /*A*/] = a;
    }

    apply(skeleton, lastTime, time, events, alpha, blend, direction)
    {
        let slot = skeleton.slots[this.slotIndex];
        if (!slot.bone.active)
            return;
        let frames = this.frames;
        let color = slot.color;
        if (time < frames[0])
        {
            let setup = slot.data.color;
            switch (blend)
            {
                case SpineMixBlend.setup:
                    color.set(setup);
                    return;
                case SpineMixBlend.first:
                    color.x += (setup.x - color.x) * alpha;
                    color.y += (setup.y - color.y) * alpha;
                    color.z += (setup.z - color.z) * alpha;
                    color.w += (setup.w - color.w) * alpha;
                    color.clamp01();
            }
            return;
        }
        let r = 0, g = 0, b = 0, a = 0;
        let i = SpineTimeline.search(frames, time, 5 /*ENTRIES*/);
        let curveType = this.curves[i / 5 /*ENTRIES*/];
        switch (curveType)
        {
            case 0 /*LINEAR*/:
                let before = frames[i];
                r = frames[i + 1 /*R*/];
                g = frames[i + 2 /*G*/];
                b = frames[i + 3 /*B*/];
                a = frames[i + 4 /*A*/];
                let t = (time - before) / (frames[i + 5 /*ENTRIES*/] - before);
                r += (frames[i + 5 /*ENTRIES*/ + 1 /*R*/] - r) * t;
                g += (frames[i + 5 /*ENTRIES*/ + 2 /*G*/] - g) * t;
                b += (frames[i + 5 /*ENTRIES*/ + 3 /*B*/] - b) * t;
                a += (frames[i + 5 /*ENTRIES*/ + 4 /*A*/] - a) * t;
                break;
            case 1 /*STEPPED*/:
                r = frames[i + 1 /*R*/];
                g = frames[i + 2 /*G*/];
                b = frames[i + 3 /*B*/];
                a = frames[i + 4 /*A*/];
                break;
            default:
                r = this.getBezierValue(time, i, 1 /*R*/, curveType - 2 /*BEZIER*/);
                g = this.getBezierValue(time, i, 2 /*G*/, curveType + 18 /*BEZIER_SIZE*/ - 2 /*BEZIER*/);
                b = this.getBezierValue(time, i, 3 /*B*/, curveType + 18 /*BEZIER_SIZE*/ * 2 - 2 /*BEZIER*/);
                a = this.getBezierValue(time, i, 4 /*A*/, curveType + 18 /*BEZIER_SIZE*/ * 3 - 2 /*BEZIER*/);
        }
        if (alpha == 1)
        {
            color.setRGBA(r, g, b, a);
            color.clamp01();
        }
        else
        {
            if (blend == SpineMixBlend.setup)
                color.set(slot.data.color);
            color.x += (r - color.x) * alpha;
            color.y += (g - color.y) * alpha;
            color.z += (b - color.z) * alpha;
            color.w += (a - color.w) * alpha;
            color.clamp01();
        }
    }
}

/** Changes a slot's {@link Slot#color}. */
class SpineRGBTimeline extends SpineCurveTimeline
{
    slotIndex = 0;

    constructor(frameCount, bezierCount, slotIndex)
    {
        super(frameCount, bezierCount, [
            SpineProperty.rgb + "|" + slotIndex
        ]);
        this.slotIndex = slotIndex;
    }

    getFrameEntries()
    {
        return 4 /*ENTRIES*/;
    }

    /** Sets the time in seconds, red, green, blue, and alpha for the specified key frame. */
    setFrame(frame, time, r, g, b)
    {
        frame <<= 2;
        this.frames[frame] = time;
        this.frames[frame + 1 /*R*/] = r;
        this.frames[frame + 2 /*G*/] = g;
        this.frames[frame + 3 /*B*/] = b;
    }

    apply(skeleton, lastTime, time, events, alpha, blend, direction)
    {
        let slot = skeleton.slots[this.slotIndex];
        if (!slot.bone.active)
            return;
        let frames = this.frames;
        let color = slot.color;
        if (time < frames[0])
        {
            let setup = slot.data.color;
            switch (blend)
            {
                case SpineMixBlend.setup:
                    color.x = setup.x;
                    color.y = setup.y;
                    color.z = setup.z;
                    return;
                case SpineMixBlend.first:
                    color.x += (setup.x - color.x) * alpha;
                    color.y += (setup.y - color.y) * alpha;
                    color.z += (setup.z - color.z) * alpha;
            }
            return;
        }
        let r = 0, g = 0, b = 0;
        let i = SpineTimeline.search(frames, time, 4 /*ENTRIES*/);
        let curveType = this.curves[i >> 2];
        switch (curveType)
        {
            case 0 /*LINEAR*/:
                let before = frames[i];
                r = frames[i + 1 /*R*/];
                g = frames[i + 2 /*G*/];
                b = frames[i + 3 /*B*/];
                let t = (time - before) / (frames[i + 4 /*ENTRIES*/] - before);
                r += (frames[i + 4 /*ENTRIES*/ + 1 /*R*/] - r) * t;
                g += (frames[i + 4 /*ENTRIES*/ + 2 /*G*/] - g) * t;
                b += (frames[i + 4 /*ENTRIES*/ + 3 /*B*/] - b) * t;
                break;
            case 1 /*STEPPED*/:
                r = frames[i + 1 /*R*/];
                g = frames[i + 2 /*G*/];
                b = frames[i + 3 /*B*/];
                break;
            default:
                r = this.getBezierValue(time, i, 1 /*R*/, curveType - 2 /*BEZIER*/);
                g = this.getBezierValue(time, i, 2 /*G*/, curveType + 18 /*BEZIER_SIZE*/ - 2 /*BEZIER*/);
                b = this.getBezierValue(time, i, 3 /*B*/, curveType + 18 /*BEZIER_SIZE*/ * 2 - 2 /*BEZIER*/);
        }
        if (alpha == 1)
        {
            color.x = r;
            color.y = g;
            color.z = b;
        }
        else
        {
            if (blend == SpineMixBlend.setup)
            {
                let setup = slot.data.color;
                color.x = setup.x;
                color.y = setup.y;
                color.z = setup.z;
            }
            color.x += (r - color.x) * alpha;
            color.y += (g - color.y) * alpha;
            color.z += (b - color.z) * alpha;
        }
    }
}

/** Changes a bone's local {@link Bone#shearX} and {@link Bone#shearY}. */
class SpineAlphaTimeline extends SpineCurveTimeline1
{
    slotIndex = 0;

    constructor(frameCount, bezierCount, slotIndex)
    {
        super(frameCount, bezierCount, SpineProperty.alpha + "|" + slotIndex);
        this.slotIndex = slotIndex;
    }

    apply(skeleton, lastTime, time, events, alpha, blend, direction)
    {
        let slot = skeleton.slots[this.slotIndex];
        if (!slot.bone.active)
            return;
        let color = slot.color;
        if (time < this.frames[0]) { // Time is before first frame.
            let setup = slot.data.color;
            switch (blend)
            {
                case SpineMixBlend.setup:
                    color.w = setup.w;
                    return;
                case SpineMixBlend.first:
                    color.w += (setup.w - color.w) * alpha;
            }
            return;
        }
        let a = this.getCurveValue(time);
        if (alpha == 1)
            color.w = a;
        else
        {
            if (blend == SpineMixBlend.setup)
                color.w = slot.data.color.w;
            color.w += (a - color.w) * alpha;
        }
    }
}

/** Changes a slot's {@link Slot#color} and {@link Slot#darkColor} for two color tinting. */
class SpineRGBA2Timeline extends SpineCurveTimeline
{
    slotIndex = 0;

    constructor(frameCount, bezierCount, slotIndex)
    {
        super(frameCount, bezierCount, [
            SpineProperty.rgb + "|" + slotIndex,
            SpineProperty.alpha + "|" + slotIndex,
            SpineProperty.rgb2 + "|" + slotIndex
        ]);
        this.slotIndex = slotIndex;
    }

    getFrameEntries()
    {
        return 8 /*ENTRIES*/;
    }

    /** Sets the time in seconds, light, and dark colors for the specified key frame. */
    setFrame(frame, time, r, g, b, a, r2, g2, b2)
    {
        frame <<= 3;
        this.frames[frame] = time;
        this.frames[frame + 1 /*R*/] = r;
        this.frames[frame + 2 /*G*/] = g;
        this.frames[frame + 3 /*B*/] = b;
        this.frames[frame + 4 /*A*/] = a;
        this.frames[frame + 5 /*R2*/] = r2;
        this.frames[frame + 6 /*G2*/] = g2;
        this.frames[frame + 7 /*B2*/] = b2;
    }

    apply(skeleton, lastTime, time, events, alpha, blend, direction)
    {
        let slot = skeleton.slots[this.slotIndex];
        if (!slot.bone.active)
            return;
        let frames = this.frames;
        let light = slot.color, dark = slot.darkColor;
        if (time < frames[0])
        {
            let setupLight = slot.data.color, setupDark = slot.data.darkColor;
            switch (blend)
            {
                case SpineMixBlend.setup:
                    light.set(setupLight);
                    dark.x = setupDark.x;
                    dark.y = setupDark.y;
                    dark.z = setupDark.z;
                    return;
                case SpineMixBlend.first:
                    light.x += (setupLight.x - light.x) * alpha;
                    light.y += (setupLight.y - light.y) * alpha;
                    light.z += (setupLight.z - light.z) * alpha;
                    light.w += (setupLight.w - light.w) * alpha;
                    light.clamp01();
                    dark.x += (setupDark.x - dark.x) * alpha;
                    dark.y += (setupDark.y - dark.y) * alpha;
                    dark.z += (setupDark.z - dark.z) * alpha;
            }
            return;
        }
        let r = 0, g = 0, b = 0, a = 0, r2 = 0, g2 = 0, b2 = 0;
        let i = SpineTimeline.search(frames, time, 8 /*ENTRIES*/);
        let curveType = this.curves[i >> 3];
        switch (curveType)
        {
            case 0 /*LINEAR*/:
                let before = frames[i];
                r = frames[i + 1 /*R*/];
                g = frames[i + 2 /*G*/];
                b = frames[i + 3 /*B*/];
                a = frames[i + 4 /*A*/];
                r2 = frames[i + 5 /*R2*/];
                g2 = frames[i + 6 /*G2*/];
                b2 = frames[i + 7 /*B2*/];
                let t = (time - before) / (frames[i + 8 /*ENTRIES*/] - before);
                r += (frames[i + 8 /*ENTRIES*/ + 1 /*R*/] - r) * t;
                g += (frames[i + 8 /*ENTRIES*/ + 2 /*G*/] - g) * t;
                b += (frames[i + 8 /*ENTRIES*/ + 3 /*B*/] - b) * t;
                a += (frames[i + 8 /*ENTRIES*/ + 4 /*A*/] - a) * t;
                r2 += (frames[i + 8 /*ENTRIES*/ + 5 /*R2*/] - r2) * t;
                g2 += (frames[i + 8 /*ENTRIES*/ + 6 /*G2*/] - g2) * t;
                b2 += (frames[i + 8 /*ENTRIES*/ + 7 /*B2*/] - b2) * t;
                break;
            case 1 /*STEPPED*/:
                r = frames[i + 1 /*R*/];
                g = frames[i + 2 /*G*/];
                b = frames[i + 3 /*B*/];
                a = frames[i + 4 /*A*/];
                r2 = frames[i + 5 /*R2*/];
                g2 = frames[i + 6 /*G2*/];
                b2 = frames[i + 7 /*B2*/];
                break;
            default:
                r = this.getBezierValue(time, i, 1 /*R*/, curveType - 2 /*BEZIER*/);
                g = this.getBezierValue(time, i, 2 /*G*/, curveType + 18 /*BEZIER_SIZE*/ - 2 /*BEZIER*/);
                b = this.getBezierValue(time, i, 3 /*B*/, curveType + 18 /*BEZIER_SIZE*/ * 2 - 2 /*BEZIER*/);
                a = this.getBezierValue(time, i, 4 /*A*/, curveType + 18 /*BEZIER_SIZE*/ * 3 - 2 /*BEZIER*/);
                r2 = this.getBezierValue(time, i, 5 /*R2*/, curveType + 18 /*BEZIER_SIZE*/ * 4 - 2 /*BEZIER*/);
                g2 = this.getBezierValue(time, i, 6 /*G2*/, curveType + 18 /*BEZIER_SIZE*/ * 5 - 2 /*BEZIER*/);
                b2 = this.getBezierValue(time, i, 7 /*B2*/, curveType + 18 /*BEZIER_SIZE*/ * 6 - 2 /*BEZIER*/);
        }
        if (alpha == 1)
        {
            light.setRGBA(r, g, b, a);
            light.clamp01();
            dark.x = r2;
            dark.y = g2;
            dark.z = b2;
        }
        else
        {
            if (blend == SpineMixBlend.setup)
            {
                light.set(slot.data.color);
                let setupDark = slot.data.darkColor;
                dark.x = setupDark.x;
                dark.y = setupDark.y;
                dark.z = setupDark.z;
            }
            light.x += (r - light.x) * alpha;
            light.y += (g - light.y) * alpha;
            light.z += (b - light.z) * alpha;
            light.w += (a - light.w) * alpha;
            light.clamp01();
            dark.x += (r2 - dark.x) * alpha;
            dark.y += (g2 - dark.y) * alpha;
            dark.z += (b2 - dark.z) * alpha;
        }
    }
}

/** Changes a slot's {@link Slot#color} and {@link Slot#darkColor} for two color tinting. */
class SpineRGB2Timeline extends SpineCurveTimeline
{
    slotIndex = 0;

    constructor(frameCount, bezierCount, slotIndex)
    {
        super(frameCount, bezierCount, [
            SpineProperty.rgb + "|" + slotIndex,
            SpineProperty.rgb2 + "|" + slotIndex
        ]);
        this.slotIndex = slotIndex;
    }

    getFrameEntries()
    {
        return 7 /*ENTRIES*/;
    }

    /** Sets the time in seconds, light, and dark colors for the specified key frame. */
    setFrame(frame, time, r, g, b, r2, g2, b2)
    {
        frame *= 7 /*ENTRIES*/;
        this.frames[frame] = time;
        this.frames[frame + 1 /*R*/] = r;
        this.frames[frame + 2 /*G*/] = g;
        this.frames[frame + 3 /*B*/] = b;
        this.frames[frame + 4 /*R2*/] = r2;
        this.frames[frame + 5 /*G2*/] = g2;
        this.frames[frame + 6 /*B2*/] = b2;
    }

    apply(skeleton, lastTime, time, events, alpha, blend, direction)
    {
        let slot = skeleton.slots[this.slotIndex];
        if (!slot.bone.active)
            return;
        let frames = this.frames;
        let light = slot.color, dark = slot.darkColor;
        if (time < frames[0])
        {
            let setupLight = slot.data.color, setupDark = slot.data.darkColor;
            switch (blend)
            {
                case SpineMixBlend.setup:
                    light.x = setupLight.x;
                    light.y = setupLight.y;
                    light.z = setupLight.z;
                    dark.x = setupDark.x;
                    dark.y = setupDark.y;
                    dark.z = setupDark.z;
                    return;
                case SpineMixBlend.first:
                    light.x += (setupLight.x - light.x) * alpha;
                    light.y += (setupLight.y - light.y) * alpha;
                    light.z += (setupLight.z - light.z) * alpha;
                    dark.x += (setupDark.x - dark.x) * alpha;
                    dark.y += (setupDark.y - dark.y) * alpha;
                    dark.z += (setupDark.z - dark.z) * alpha;
            }
            return;
        }
        let r = 0, g = 0, b = 0, a = 0, r2 = 0, g2 = 0, b2 = 0;
        let i = SpineTimeline.search(frames, time, 7 /*ENTRIES*/);
        let curveType = this.curves[i / 7 /*ENTRIES*/];
        switch (curveType)
        {
            case 0 /*LINEAR*/:
                let before = frames[i];
                r = frames[i + 1 /*R*/];
                g = frames[i + 2 /*G*/];
                b = frames[i + 3 /*B*/];
                r2 = frames[i + 4 /*R2*/];
                g2 = frames[i + 5 /*G2*/];
                b2 = frames[i + 6 /*B2*/];
                let t = (time - before) / (frames[i + 7 /*ENTRIES*/] - before);
                r += (frames[i + 7 /*ENTRIES*/ + 1 /*R*/] - r) * t;
                g += (frames[i + 7 /*ENTRIES*/ + 2 /*G*/] - g) * t;
                b += (frames[i + 7 /*ENTRIES*/ + 3 /*B*/] - b) * t;
                r2 += (frames[i + 7 /*ENTRIES*/ + 4 /*R2*/] - r2) * t;
                g2 += (frames[i + 7 /*ENTRIES*/ + 5 /*G2*/] - g2) * t;
                b2 += (frames[i + 7 /*ENTRIES*/ + 6 /*B2*/] - b2) * t;
                break;
            case 1 /*STEPPED*/:
                r = frames[i + 1 /*R*/];
                g = frames[i + 2 /*G*/];
                b = frames[i + 3 /*B*/];
                r2 = frames[i + 4 /*R2*/];
                g2 = frames[i + 5 /*G2*/];
                b2 = frames[i + 6 /*B2*/];
                break;
            default:
                r = this.getBezierValue(time, i, 1 /*R*/, curveType - 2 /*BEZIER*/);
                g = this.getBezierValue(time, i, 2 /*G*/, curveType + 18 /*BEZIER_SIZE*/ - 2 /*BEZIER*/);
                b = this.getBezierValue(time, i, 3 /*B*/, curveType + 18 /*BEZIER_SIZE*/ * 2 - 2 /*BEZIER*/);
                r2 = this.getBezierValue(time, i, 4 /*R2*/, curveType + 18 /*BEZIER_SIZE*/ * 3 - 2 /*BEZIER*/);
                g2 = this.getBezierValue(time, i, 5 /*G2*/, curveType + 18 /*BEZIER_SIZE*/ * 4 - 2 /*BEZIER*/);
                b2 = this.getBezierValue(time, i, 6 /*B2*/, curveType + 18 /*BEZIER_SIZE*/ * 5 - 2 /*BEZIER*/);
        }
        if (alpha == 1)
        {
            light.x = r;
            light.y = g;
            light.z = b;
            dark.x = r2;
            dark.y = g2;
            dark.z = b2;
        }
        else
        {
            if (blend == SpineMixBlend.setup)
            {
                let setupLight = slot.data.color, setupDark = slot.data.darkColor;
                light.x = setupLight.x;
                light.y = setupLight.y;
                light.z = setupLight.z;
                dark.x = setupDark.x;
                dark.y = setupDark.y;
                dark.z = setupDark.z;
            }
            light.x += (r - light.x) * alpha;
            light.y += (g - light.y) * alpha;
            light.z += (b - light.z) * alpha;
            dark.x += (r2 - dark.x) * alpha;
            dark.y += (g2 - dark.y) * alpha;
            dark.z += (b2 - dark.z) * alpha;
        }
    }
}

/** Changes a slot's {@link Slot#attachment}. */
class SpineAttachmentTimeline extends SpineTimeline
{
    slotIndex = 0;

    /** The attachment name for each key frame. May contain null values to clear the attachment. */
    attachmentNames;

    constructor(frameCount, slotIndex)
    {
        super(frameCount, [
            SpineProperty.attachment + "|" + slotIndex
        ]);
        this.slotIndex = slotIndex;
        this.attachmentNames = new Array(frameCount);
    }

    getFrameCount()
    {
        return this.frames.length;
    }

    /** Sets the time in seconds and the attachment name for the specified key frame. */
    setFrame(frame, time, attachmentName)
    {
        this.frames[frame] = time;
        this.attachmentNames[frame] = attachmentName;
    }

    apply(skeleton, lastTime, time, events, alpha, blend, direction)
    {
        let slot = skeleton.slots[this.slotIndex];
        if (!slot.bone.active)
            return;
        if (direction == SpineMixDirection.mixOut)
        {
            if (blend == SpineMixBlend.setup)
                this.setAttachment(skeleton, slot, slot.data.attachmentName);
            return;
        }
        if (time < this.frames[0])
        {
            if (blend == SpineMixBlend.setup || blend == SpineMixBlend.first)
                this.setAttachment(skeleton, slot, slot.data.attachmentName);
            return;
        }
        this.setAttachment(skeleton, slot, this.attachmentNames[SpineTimeline.search1(this.frames, time)]);
    }

    setAttachment(skeleton, slot, attachmentName)
    {
        slot.setAttachment(!attachmentName ? null : skeleton.getAttachment(this.slotIndex, attachmentName));
    }
}

/** Changes a slot's {@link Slot#deform} to deform a {@link VertexAttachment}. */
class SpineDeformTimeline extends SpineCurveTimeline
{
    slotIndex = 0;

    /** The attachment that will be deformed. */
    attachment = null;

    /** The vertices for each key frame. */
    vertices = null;

    constructor(frameCount, bezierCount, slotIndex, attachment)
    {
        super(frameCount, bezierCount, [
            SpineProperty.deform + "|" + slotIndex + "|" + attachment.id
        ]);
        this.slotIndex = slotIndex;
        this.attachment = attachment;
        this.vertices = new Array(frameCount);
    }

    getFrameCount()
    {
        return this.frames.length;
    }

    /** Sets the time in seconds and the vertices for the specified key frame.
     * @param vertices Vertex positions for an unweighted VertexAttachment, or deform offsets if it has weights. */
    setFrame(frame, time, vertices)
    {
        this.frames[frame] = time;
        this.vertices[frame] = vertices;
    }

    /** @param value1 Ignored (0 is used for a deform timeline).
     * @param value2 Ignored (1 is used for a deform timeline). */
    setBezier(bezier, frame, value, time1, value1, cx1, cy1, cx2, cy2, time2, value2)
    {
        let curves = this.curves;
        let i = this.getFrameCount() + bezier * 18 /*BEZIER_SIZE*/;
        if (value == 0)
            curves[frame] = 2 /*BEZIER*/ + i;
        let tmpx = (time1 - cx1 * 2 + cx2) * 0.03, tmpy = cy2 * 0.03 - cy1 * 0.06;
        let dddx = ((cx1 - cx2) * 3 - time1 + time2) * 0.006, dddy = (cy1 - cy2 + 0.33333333) * 0.018;
        let ddx = tmpx * 2 + dddx, ddy = tmpy * 2 + dddy;
        let dx = (cx1 - time1) * 0.3 + tmpx + dddx * 0.16666667, dy = cy1 * 0.3 + tmpy + dddy * 0.16666667;
        let x = time1 + dx, y = dy;
        for (let n = i + 18 /*BEZIER_SIZE*/; i < n; i += 2)
        {
            curves[i] = x;
            curves[i + 1] = y;
            dx += ddx;
            dy += ddy;
            ddx += dddx;
            ddy += dddy;
            x += dx;
            y += dy;
        }
    }

    getCurvePercent(time, frame)
    {
        let curves = this.curves;
        let i = curves[frame];
        switch (i)
        {
            case 0 /*LINEAR*/:
                let x = this.frames[frame];
                return (time - x) / (this.frames[frame + this.getFrameEntries()] - x);
            case 1 /*STEPPED*/:
                return 0;
        }
        i -= 2 /*BEZIER*/;
        if (curves[i] > time)
        {
            let x = this.frames[frame];
            return curves[i + 1] * (time - x) / (curves[i] - x);
        }
        let n = i + 18 /*BEZIER_SIZE*/;
        for (i += 2; i < n; i += 2)
        {
            if (curves[i] >= time)
            {
                let x = curves[i - 2], y = curves[i - 1];
                return y + (time - x) / (curves[i] - x) * (curves[i + 1] - y);
            }
        }
        let x = curves[n - 2], y = curves[n - 1];
        return y + (1 - y) * (time - x) / (this.frames[frame + this.getFrameEntries()] - x);
    }

    apply(skeleton, lastTime, time, firedEvents, alpha, blend, direction)
    {
        let slot = skeleton.slots[this.slotIndex];
        if (!slot.bone.active)
            return;
        let slotAttachment = slot.getAttachment();
        if (!(slotAttachment instanceof SpineVertexAttachment) || slotAttachment.deformAttachment != this.attachment)
            return;
        let deform = slot.deform;
        if (deform.length == 0)
            blend = SpineMixBlend.setup;
        let vertices = this.vertices;
        let vertexCount = vertices[0].length;
        let frames = this.frames;
        if (time < frames[0])
        {
            let vertexAttachment = slotAttachment;
            switch (blend)
            {
                case SpineMixBlend.setup:
                    deform.length = 0;
                    return;
                case SpineMixBlend.first:
                    if (alpha == 1)
                    {
                        deform.length = 0;
                        return;
                    }
                    deform.length = vertexCount;
                    if (!vertexAttachment.bones)
                    {
                        // Unweighted vertex positions.
                        let setupVertices = vertexAttachment.vertices;
                        for (var i = 0; i < vertexCount; i++)
                            deform[i] += (setupVertices[i] - deform[i]) * alpha;
                    }
                    else
                    {
                        // Weighted deform offsets.
                        alpha = 1 - alpha;
                        for (var i = 0; i < vertexCount; i++)
                            deform[i] *= alpha;
                    }
            }
            return;
        }
        deform.length = vertexCount;
        if (time >= frames[frames.length - 1]) { // Time is after last frame.
            let lastVertices = vertices[frames.length - 1];
            if (alpha == 1)
            {
                if (blend == SpineMixBlend.add)
                {
                    let vertexAttachment = slotAttachment;
                    if (!vertexAttachment.bones)
                    {
                        // Unweighted vertex positions, with alpha.
                        let setupVertices = vertexAttachment.vertices;
                        for (let i = 0; i < vertexCount; i++)
                            deform[i] += lastVertices[i] - setupVertices[i];
                    }
                    else
                    {
                        // Weighted deform offsets, with alpha.
                        for (let i = 0; i < vertexCount; i++)
                            deform[i] += lastVertices[i];
                    }
                }
                else
                    SpineUtils.arrayCopy(lastVertices, 0, deform, 0, vertexCount);
            }
            else
            {
                switch (blend)
                {
                    case SpineMixBlend.setup: {
                        let vertexAttachment = slotAttachment;
                        if (!vertexAttachment.bones)
                        {
                            // Unweighted vertex positions, with alpha.
                            let setupVertices = vertexAttachment.vertices;
                            for (let i = 0; i < vertexCount; i++)
                            {
                                let setup = setupVertices[i];
                                deform[i] = setup + (lastVertices[i] - setup) * alpha;
                            }
                        }
                        else
                        {
                            // Weighted deform offsets, with alpha.
                            for (let i = 0; i < vertexCount; i++)
                                deform[i] = lastVertices[i] * alpha;
                        }
                        break;
                    }
                    case SpineMixBlend.first:
                    case SpineMixBlend.replace:
                        for (let i = 0; i < vertexCount; i++)
                            deform[i] += (lastVertices[i] - deform[i]) * alpha;
                        break;
                    case SpineMixBlend.add:
                        let vertexAttachment = slotAttachment;
                        if (!vertexAttachment.bones)
                        {
                            // Unweighted vertex positions, with alpha.
                            let setupVertices = vertexAttachment.vertices;
                            for (let i = 0; i < vertexCount; i++)
                                deform[i] += (lastVertices[i] - setupVertices[i]) * alpha;
                        }
                        else
                        {
                            // Weighted deform offsets, with alpha.
                            for (let i = 0; i < vertexCount; i++)
                                deform[i] += lastVertices[i] * alpha;
                        }
                }
            }
            return;
        }
        // Interpolate between the previous frame and the current frame.
        let frame = SpineTimeline.search1(frames, time);
        let percent = this.getCurvePercent(time, frame);
        let prevVertices = vertices[frame];
        let nextVertices = vertices[frame + 1];
        if (alpha == 1)
        {
            if (blend == SpineMixBlend.add)
            {
                let vertexAttachment = slotAttachment;
                if (!vertexAttachment.bones)
                {
                    // Unweighted vertex positions, with alpha.
                    let setupVertices = vertexAttachment.vertices;
                    for (let i = 0; i < vertexCount; i++)
                    {
                        let prev = prevVertices[i];
                        deform[i] += prev + (nextVertices[i] - prev) * percent - setupVertices[i];
                    }
                }
                else
                {
                    // Weighted deform offsets, with alpha.
                    for (let i = 0; i < vertexCount; i++)
                    {
                        let prev = prevVertices[i];
                        deform[i] += prev + (nextVertices[i] - prev) * percent;
                    }
                }
            }
            else
            {
                for (let i = 0; i < vertexCount; i++)
                {
                    let prev = prevVertices[i];
                    deform[i] = prev + (nextVertices[i] - prev) * percent;
                }
            }
        }
        else
        {
            switch (blend)
            {
                case SpineMixBlend.setup: {
                    let vertexAttachment = slotAttachment;
                    if (!vertexAttachment.bones)
                    {
                        // Unweighted vertex positions, with alpha.
                        let setupVertices = vertexAttachment.vertices;
                        for (let i = 0; i < vertexCount; i++)
                        {
                            let prev = prevVertices[i], setup = setupVertices[i];
                            deform[i] = setup + (prev + (nextVertices[i] - prev) * percent - setup) * alpha;
                        }
                    }
                    else
                    {
                        // Weighted deform offsets, with alpha.
                        for (let i = 0; i < vertexCount; i++)
                        {
                            let prev = prevVertices[i];
                            deform[i] = (prev + (nextVertices[i] - prev) * percent) * alpha;
                        }
                    }
                    break;
                }
                case SpineMixBlend.first:
                case SpineMixBlend.replace:
                    for (let i = 0; i < vertexCount; i++)
                    {
                        let prev = prevVertices[i];
                        deform[i] += (prev + (nextVertices[i] - prev) * percent - deform[i]) * alpha;
                    }
                    break;
                case SpineMixBlend.add:
                    let vertexAttachment = slotAttachment;
                    if (!vertexAttachment.bones)
                    {
                        // Unweighted vertex positions, with alpha.
                        let setupVertices = vertexAttachment.vertices;
                        for (let i = 0; i < vertexCount; i++)
                        {
                            let prev = prevVertices[i];
                            deform[i] += (prev + (nextVertices[i] - prev) * percent - setupVertices[i]) * alpha;
                        }
                    }
                    else
                    {
                        // Weighted deform offsets, with alpha.
                        for (let i = 0; i < vertexCount; i++)
                        {
                            let prev = prevVertices[i];
                            deform[i] += (prev + (nextVertices[i] - prev) * percent) * alpha;
                        }
                    }
            }
        }
    }
}

/** Fires an {@link Event} when specific animation times are reached. */
class SpineEventTimeline extends SpineTimeline
{
    static propertyIds = ["" + SpineProperty.event];

    /** The event for each key frame. */
    events = null;

    constructor(frameCount)
    {
        super(frameCount, SpineEventTimeline.propertyIds);
        this.events = new Array(frameCount);
    }

    getFrameCount()
    {
        return this.frames.length;
    }

    /** Sets the time in seconds and the event for the specified key frame. */
    setFrame(frame, event)
    {
        this.frames[frame] = event.time;
        this.events[frame] = event;
    }

    /** Fires events for frames > `lastTime` and <= `time`. */
    apply(skeleton, lastTime, time, firedEvents, alpha, blend, direction)
    {
        if (!firedEvents)
            return;
        let frames = this.frames;
        let frameCount = this.frames.length;
        if (lastTime > time) { // Fire events after last time for looped animations.
            this.apply(skeleton, lastTime, Number.MAX_VALUE, firedEvents, alpha, blend, direction);
            lastTime = -1;
        }
        else if (lastTime >= frames[frameCount - 1]) // Last time is after last frame.
            return;
        if (time < frames[0])
            return; // Time is before first frame.
        let i = 0;
        if (lastTime < frames[0])
            i = 0;
        else
        {
            i = SpineTimeline.search1(frames, lastTime) + 1;
            let frameTime = frames[i];
            while (i > 0) { // Fire multiple events with the same frame.
                if (frames[i - 1] != frameTime)
                    break;
                i--;
            }
        }
        for (; i < frameCount && time >= frames[i]; i++)
            firedEvents.push(this.events[i]);
    }
}

/** Changes a skeleton's {@link Skeleton#drawOrder}. */
class SpineDrawOrderTimeline extends SpineTimeline
{
    static propertyIds = ["" + SpineProperty.drawOrder];

    /** The draw order for each key frame. See {@link #setFrame(int, float, int[])}. */
    drawOrders = null;

    constructor(frameCount)
    {
        super(frameCount, SpineDrawOrderTimeline.propertyIds);
        this.drawOrders = new Array(frameCount);
    }

    getFrameCount()
    {
        return this.frames.length;
    }

    /** Sets the time in seconds and the draw order for the specified key frame.
     * @param drawOrder For each slot in {@link Skeleton#slots}, the index of the new draw order. May be null to use setup pose
     *           draw order. */
    setFrame(frame, time, drawOrder)
    {
        this.frames[frame] = time;
        this.drawOrders[frame] = drawOrder;
    }

    apply(skeleton, lastTime, time, firedEvents, alpha, blend, direction)
    {
        if (direction == SpineMixDirection.mixOut)
        {
            if (blend == SpineMixBlend.setup)
                SpineUtils.arrayCopy(skeleton.slots, 0, skeleton.drawOrder, 0, skeleton.slots.length);
            return;
        }
        if (time < this.frames[0])
        {
            if (blend == SpineMixBlend.setup || blend == SpineMixBlend.first)
                SpineUtils.arrayCopy(skeleton.slots, 0, skeleton.drawOrder, 0, skeleton.slots.length);
            return;
        }
        let drawOrderToSetupIndex = this.drawOrders[SpineTimeline.search1(this.frames, time)];
        if (!drawOrderToSetupIndex)
            SpineUtils.arrayCopy(skeleton.slots, 0, skeleton.drawOrder, 0, skeleton.slots.length);
        else
        {
            let drawOrder = skeleton.drawOrder;
            let slots = skeleton.slots;
            for (let i = 0, n = drawOrderToSetupIndex.length; i < n; i++)
                drawOrder[i] = slots[drawOrderToSetupIndex[i]];
        }
    }
}

/** Changes an IK constraint's {@link IkConstraint#mix}, {@link IkConstraint#softness},
 * {@link IkConstraint#bendDirection}, {@link IkConstraint#stretch}, and {@link IkConstraint#compress}. */
class SpineIkConstraintTimeline extends SpineCurveTimeline
{
    /** The index of the IK constraint slot in {@link Skeleton#ikConstraints} that will be changed. */
    ikConstraintIndex = 0;

    constructor(frameCount, bezierCount, ikConstraintIndex)
    {
        super(frameCount, bezierCount, [
            SpineProperty.ikConstraint + "|" + ikConstraintIndex
        ]);
        this.ikConstraintIndex = ikConstraintIndex;
    }

    getFrameEntries()
    {
        return 6 /*ENTRIES*/;
    }

    /** Sets the time in seconds, mix, softness, bend direction, compress, and stretch for the specified key frame. */
    setFrame(frame, time, mix, softness, bendDirection, compress, stretch)
    {
        frame *= 6 /*ENTRIES*/;
        this.frames[frame] = time;
        this.frames[frame + 1 /*MIX*/] = mix;
        this.frames[frame + 2 /*SOFTNESS*/] = softness;
        this.frames[frame + 3 /*BEND_DIRECTION*/] = bendDirection;
        this.frames[frame + 4 /*COMPRESS*/] = compress ? 1 : 0;
        this.frames[frame + 5 /*STRETCH*/] = stretch ? 1 : 0;
    }

    apply(skeleton, lastTime, time, firedEvents, alpha, blend, direction)
    {
        let constraint = skeleton.ikConstraints[this.ikConstraintIndex];
        if (!constraint.active)
            return;
        let frames = this.frames;
        if (time < frames[0])
        {
            switch (blend)
            {
                case SpineMixBlend.setup:
                    constraint.mix = constraint.data.mix;
                    constraint.softness = constraint.data.softness;
                    constraint.bendDirection = constraint.data.bendDirection;
                    constraint.compress = constraint.data.compress;
                    constraint.stretch = constraint.data.stretch;
                    return;
                case SpineMixBlend.first:
                    constraint.mix += (constraint.data.mix - constraint.mix) * alpha;
                    constraint.softness += (constraint.data.softness - constraint.softness) * alpha;
                    constraint.bendDirection = constraint.data.bendDirection;
                    constraint.compress = constraint.data.compress;
                    constraint.stretch = constraint.data.stretch;
            }
            return;
        }
        let mix = 0, softness = 0;
        let i = SpineTimeline.search(frames, time, 6 /*ENTRIES*/);
        let curveType = this.curves[i / 6 /*ENTRIES*/];
        switch (curveType)
        {
            case 0 /*LINEAR*/:
                let before = frames[i];
                mix = frames[i + 1 /*MIX*/];
                softness = frames[i + 2 /*SOFTNESS*/];
                let t = (time - before) / (frames[i + 6 /*ENTRIES*/] - before);
                mix += (frames[i + 6 /*ENTRIES*/ + 1 /*MIX*/] - mix) * t;
                softness += (frames[i + 6 /*ENTRIES*/ + 2 /*SOFTNESS*/] - softness) * t;
                break;
            case 1 /*STEPPED*/:
                mix = frames[i + 1 /*MIX*/];
                softness = frames[i + 2 /*SOFTNESS*/];
                break;
            default:
                mix = this.getBezierValue(time, i, 1 /*MIX*/, curveType - 2 /*BEZIER*/);
                softness = this.getBezierValue(time, i, 2 /*SOFTNESS*/, curveType + 18 /*BEZIER_SIZE*/ - 2 /*BEZIER*/);
        }
        if (blend == SpineMixBlend.setup)
        {
            constraint.mix = constraint.data.mix + (mix - constraint.data.mix) * alpha;
            constraint.softness = constraint.data.softness + (softness - constraint.data.softness) * alpha;
            if (direction == SpineMixDirection.mixOut)
            {
                constraint.bendDirection = constraint.data.bendDirection;
                constraint.compress = constraint.data.compress;
                constraint.stretch = constraint.data.stretch;
            }
            else
            {
                constraint.bendDirection = frames[i + 3 /*BEND_DIRECTION*/];
                constraint.compress = frames[i + 4 /*COMPRESS*/] != 0;
                constraint.stretch = frames[i + 5 /*STRETCH*/] != 0;
            }
        }
        else
        {
            constraint.mix += (mix - constraint.mix) * alpha;
            constraint.softness += (softness - constraint.softness) * alpha;
            if (direction == SpineMixDirection.mixIn)
            {
                constraint.bendDirection = frames[i + 3 /*BEND_DIRECTION*/];
                constraint.compress = frames[i + 4 /*COMPRESS*/] != 0;
                constraint.stretch = frames[i + 5 /*STRETCH*/] != 0;
            }
        }
    }
}

/** Changes a transform constraint's {@link TransformConstraint#rotateMix}, {@link TransformConstraint#translateMix},
 * {@link TransformConstraint#scaleMix}, and {@link TransformConstraint#shearMix}. */
class SpineTransformConstraintTimeline extends SpineCurveTimeline
{
    /** The index of the transform constraint slot in {@link Skeleton#transformConstraints} that will be changed. */
    transformConstraintIndex = 0;

    constructor(frameCount, bezierCount, transformConstraintIndex)
    {
        super(frameCount, bezierCount, [
            SpineProperty.transformConstraint + "|" + transformConstraintIndex
        ]);
        this.transformConstraintIndex = transformConstraintIndex;
    }

    getFrameEntries()
    {
        return 7 /*ENTRIES*/;
    }

    /** The time in seconds, rotate mix, translate mix, scale mix, and shear mix for the specified key frame. */
    setFrame(frame, time, mixRotate, mixX, mixY, mixScaleX, mixScaleY, mixShearY)
    {
        let frames = this.frames;
        frame *= 7 /*ENTRIES*/;
        frames[frame] = time;
        frames[frame + 1 /*ROTATE*/] = mixRotate;
        frames[frame + 2 /*X*/] = mixX;
        frames[frame + 3 /*Y*/] = mixY;
        frames[frame + 4 /*SCALEX*/] = mixScaleX;
        frames[frame + 5 /*SCALEY*/] = mixScaleY;
        frames[frame + 6 /*SHEARY*/] = mixShearY;
    }

    apply(skeleton, lastTime, time, firedEvents, alpha, blend, direction)
    {
        let constraint = skeleton.transformConstraints[this.transformConstraintIndex];
        if (!constraint.active)
            return;
        let frames = this.frames;
        if (time < frames[0])
        {
            let data = constraint.data;
            switch (blend)
            {
                case SpineMixBlend.setup:
                    constraint.mixRotate = data.mixRotate;
                    constraint.mixX = data.mixX;
                    constraint.mixY = data.mixY;
                    constraint.mixScaleX = data.mixScaleX;
                    constraint.mixScaleY = data.mixScaleY;
                    constraint.mixShearY = data.mixShearY;
                    return;
                case SpineMixBlend.first:
                    constraint.mixRotate += (data.mixRotate - constraint.mixRotate) * alpha;
                    constraint.mixX += (data.mixX - constraint.mixX) * alpha;
                    constraint.mixY += (data.mixY - constraint.mixY) * alpha;
                    constraint.mixScaleX += (data.mixScaleX - constraint.mixScaleX) * alpha;
                    constraint.mixScaleY += (data.mixScaleY - constraint.mixScaleY) * alpha;
                    constraint.mixShearY += (data.mixShearY - constraint.mixShearY) * alpha;
            }
            return;
        }
        let rotate, x, y, scaleX, scaleY, shearY;
        let i = SpineTimeline.search(frames, time, 7 /*ENTRIES*/);
        let curveType = this.curves[i / 7 /*ENTRIES*/];
        switch (curveType)
        {
            case 0 /*LINEAR*/:
                let before = frames[i];
                rotate = frames[i + 1 /*ROTATE*/];
                x = frames[i + 2 /*X*/];
                y = frames[i + 3 /*Y*/];
                scaleX = frames[i + 4 /*SCALEX*/];
                scaleY = frames[i + 5 /*SCALEY*/];
                shearY = frames[i + 6 /*SHEARY*/];
                let t = (time - before) / (frames[i + 7 /*ENTRIES*/] - before);
                rotate += (frames[i + 7 /*ENTRIES*/ + 1 /*ROTATE*/] - rotate) * t;
                x += (frames[i + 7 /*ENTRIES*/ + 2 /*X*/] - x) * t;
                y += (frames[i + 7 /*ENTRIES*/ + 3 /*Y*/] - y) * t;
                scaleX += (frames[i + 7 /*ENTRIES*/ + 4 /*SCALEX*/] - scaleX) * t;
                scaleY += (frames[i + 7 /*ENTRIES*/ + 5 /*SCALEY*/] - scaleY) * t;
                shearY += (frames[i + 7 /*ENTRIES*/ + 6 /*SHEARY*/] - shearY) * t;
                break;
            case 1 /*STEPPED*/:
                rotate = frames[i + 1 /*ROTATE*/];
                x = frames[i + 2 /*X*/];
                y = frames[i + 3 /*Y*/];
                scaleX = frames[i + 4 /*SCALEX*/];
                scaleY = frames[i + 5 /*SCALEY*/];
                shearY = frames[i + 6 /*SHEARY*/];
                break;
            default:
                rotate = this.getBezierValue(time, i, 1 /*ROTATE*/, curveType - 2 /*BEZIER*/);
                x = this.getBezierValue(time, i, 2 /*X*/, curveType + 18 /*BEZIER_SIZE*/ - 2 /*BEZIER*/);
                y = this.getBezierValue(time, i, 3 /*Y*/, curveType + 18 /*BEZIER_SIZE*/ * 2 - 2 /*BEZIER*/);
                scaleX = this.getBezierValue(time, i, 4 /*SCALEX*/, curveType + 18 /*BEZIER_SIZE*/ * 3 - 2 /*BEZIER*/);
                scaleY = this.getBezierValue(time, i, 5 /*SCALEY*/, curveType + 18 /*BEZIER_SIZE*/ * 4 - 2 /*BEZIER*/);
                shearY = this.getBezierValue(time, i, 6 /*SHEARY*/, curveType + 18 /*BEZIER_SIZE*/ * 5 - 2 /*BEZIER*/);
        }
        if (blend == SpineMixBlend.setup)
        {
            let data = constraint.data;
            constraint.mixRotate = data.mixRotate + (rotate - data.mixRotate) * alpha;
            constraint.mixX = data.mixX + (x - data.mixX) * alpha;
            constraint.mixY = data.mixY + (y - data.mixY) * alpha;
            constraint.mixScaleX = data.mixScaleX + (scaleX - data.mixScaleX) * alpha;
            constraint.mixScaleY = data.mixScaleY + (scaleY - data.mixScaleY) * alpha;
            constraint.mixShearY = data.mixShearY + (shearY - data.mixShearY) * alpha;
        }
        else
        {
            constraint.mixRotate += (rotate - constraint.mixRotate) * alpha;
            constraint.mixX += (x - constraint.mixX) * alpha;
            constraint.mixY += (y - constraint.mixY) * alpha;
            constraint.mixScaleX += (scaleX - constraint.mixScaleX) * alpha;
            constraint.mixScaleY += (scaleY - constraint.mixScaleY) * alpha;
            constraint.mixShearY += (shearY - constraint.mixShearY) * alpha;
        }
    }
}

/** Changes a path constraint's {@link PathConstraint#position}. */
class SpinePathConstraintPositionTimeline extends SpineCurveTimeline1
{
    /** The index of the path constraint slot in {@link Skeleton#pathConstraints} that will be changed. */
    pathConstraintIndex = 0;

    constructor(frameCount, bezierCount, pathConstraintIndex)
    {
        super(frameCount, bezierCount, SpineProperty.pathConstraintPosition + "|" + pathConstraintIndex);
        this.pathConstraintIndex = pathConstraintIndex;
    }

    apply(skeleton, lastTime, time, firedEvents, alpha, blend, direction)
    {
        let constraint = skeleton.pathConstraints[this.pathConstraintIndex];
        if (!constraint.active)
            return;
        let frames = this.frames;
        if (time < frames[0])
        {
            switch (blend)
            {
                case SpineMixBlend.setup:
                    constraint.position = constraint.data.position;
                    return;
                case SpineMixBlend.first:
                    constraint.position += (constraint.data.position - constraint.position) * alpha;
            }
            return;
        }
        let position = this.getCurveValue(time);
        if (blend == SpineMixBlend.setup)
            constraint.position = constraint.data.position + (position - constraint.data.position) * alpha;
        else
            constraint.position += (position - constraint.position) * alpha;
    }
}

/** Changes a path constraint's {@link PathConstraint#spacing}. */
class SpinePathConstraintSpacingTimeline extends SpineCurveTimeline1
{
    /** The index of the path constraint slot in {@link Skeleton#getPathConstraints()} that will be changed. */
    pathConstraintIndex = 0;

    constructor(frameCount, bezierCount, pathConstraintIndex)
    {
        super(frameCount, bezierCount, SpineProperty.pathConstraintSpacing + "|" + pathConstraintIndex);
        this.pathConstraintIndex = pathConstraintIndex;
    }

    apply(skeleton, lastTime, time, firedEvents, alpha, blend, direction)
    {
        let constraint = skeleton.pathConstraints[this.pathConstraintIndex];
        if (!constraint.active)
            return;
        let frames = this.frames;
        if (time < frames[0])
        {
            switch (blend)
            {
                case SpineMixBlend.setup:
                    constraint.spacing = constraint.data.spacing;
                    return;
                case SpineMixBlend.first:
                    constraint.spacing += (constraint.data.spacing - constraint.spacing) * alpha;
            }
            return;
        }
        let spacing = this.getCurveValue(time);
        if (blend == SpineMixBlend.setup)
            constraint.spacing = constraint.data.spacing + (spacing - constraint.data.spacing) * alpha;
        else
            constraint.spacing += (spacing - constraint.spacing) * alpha;
    }
}

/** Changes a transform constraint's {@link PathConstraint#getMixRotate()}, {@link PathConstraint#getMixX()}, and
 * {@link PathConstraint#getMixY()}. */
class SpinePathConstraintMixTimeline extends SpineCurveTimeline
{
    /** The index of the path constraint slot in {@link Skeleton#getPathConstraints()} that will be changed. */
    pathConstraintIndex = 0;

    constructor(frameCount, bezierCount, pathConstraintIndex)
    {
        super(frameCount, bezierCount, [
            SpineProperty.pathConstraintMix + "|" + pathConstraintIndex
        ]);
        this.pathConstraintIndex = pathConstraintIndex;
    }

    getFrameEntries()
    {
        return 4 /*ENTRIES*/;
    }

    setFrame(frame, time, mixRotate, mixX, mixY)
    {
        let frames = this.frames;
        frame <<= 2;
        frames[frame] = time;
        frames[frame + 1 /*ROTATE*/] = mixRotate;
        frames[frame + 2 /*X*/] = mixX;
        frames[frame + 3 /*Y*/] = mixY;
    }

    apply(skeleton, lastTime, time, firedEvents, alpha, blend, direction)
    {
        let constraint = skeleton.pathConstraints[this.pathConstraintIndex];
        if (!constraint.active)
            return;
        let frames = this.frames;
        if (time < frames[0])
        {
            switch (blend)
            {
                case SpineMixBlend.setup:
                    constraint.mixRotate = constraint.data.mixRotate;
                    constraint.mixX = constraint.data.mixX;
                    constraint.mixY = constraint.data.mixY;
                    return;
                case SpineMixBlend.first:
                    constraint.mixRotate += (constraint.data.mixRotate - constraint.mixRotate) * alpha;
                    constraint.mixX += (constraint.data.mixX - constraint.mixX) * alpha;
                    constraint.mixY += (constraint.data.mixY - constraint.mixY) * alpha;
            }
            return;
        }
        let rotate, x, y;
        let i = SpineTimeline.search(frames, time, 4 /*ENTRIES*/);
        let curveType = this.curves[i >> 2];
        switch (curveType)
        {
            case 0 /*LINEAR*/:
                let before = frames[i];
                rotate = frames[i + 1 /*ROTATE*/];
                x = frames[i + 2 /*X*/];
                y = frames[i + 3 /*Y*/];
                let t = (time - before) / (frames[i + 4 /*ENTRIES*/] - before);
                rotate += (frames[i + 4 /*ENTRIES*/ + 1 /*ROTATE*/] - rotate) * t;
                x += (frames[i + 4 /*ENTRIES*/ + 2 /*X*/] - x) * t;
                y += (frames[i + 4 /*ENTRIES*/ + 3 /*Y*/] - y) * t;
                break;
            case 1 /*STEPPED*/:
                rotate = frames[i + 1 /*ROTATE*/];
                x = frames[i + 2 /*X*/];
                y = frames[i + 3 /*Y*/];
                break;
            default:
                rotate = this.getBezierValue(time, i, 1 /*ROTATE*/, curveType - 2 /*BEZIER*/);
                x = this.getBezierValue(time, i, 2 /*X*/, curveType + 18 /*BEZIER_SIZE*/ - 2 /*BEZIER*/);
                y = this.getBezierValue(time, i, 3 /*Y*/, curveType + 18 /*BEZIER_SIZE*/ * 2 - 2 /*BEZIER*/);
        }
        if (blend == SpineMixBlend.setup)
        {
            let data = constraint.data;
            constraint.mixRotate = data.mixRotate + (rotate - data.mixRotate) * alpha;
            constraint.mixX = data.mixX + (x - data.mixX) * alpha;
            constraint.mixY = data.mixY + (y - data.mixY) * alpha;
        }
        else
        {
            constraint.mixRotate += (rotate - constraint.mixRotate) * alpha;
            constraint.mixX += (x - constraint.mixX) * alpha;
            constraint.mixY += (y - constraint.mixY) * alpha;
        }
    }
}
