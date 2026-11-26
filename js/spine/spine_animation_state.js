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
    Spine animation playback, ported from spine-core 4.0.31
    (AnimationStateData.ts, AnimationState.ts); see docs/spine_plan.md.

        SpineAnimationStateData  Mix (crossfade) durations between animations, and the default
        SpineAnimationState      Tracks of animations: queuing, mixing and layering, applied to a skeleton
        SpineTrackEntry          One animation on a track: its times, loop, mix and alpha
        SpineEventQueue          Notifications held until they can be delivered

    Usage:
        let stateData = new SpineAnimationStateData(skeletonData);
        stateData.defaultMix = 0.2;
        stateData.setMix("walk", "jump", 0.1);

        let state = new SpineAnimationState(stateData);
        state.setEventCallback((state, entry, type, event) => { if (type === SpineEventType.event) ... });
        state.setAnimation(0, "walk", true);
        state.addAnimation(0, "jump", false, 2.0);

        // Each frame
        state.update(dt);
        state.apply(skeleton);
        skeleton.updateWorldTransform();

    Skeleton2D (spine_model.js) does all of this through its own methods.

    Engine changes: one event callback (setEventCallback()) in place of
    listener objects (AnimationStateListener, TrackEntry.listener and
    AnimationStateAdapter are gone), and spine-core's module constants are
    private statics of SpineAnimationState.
*/

/** Stores mix (crossfade) durations to be applied when {@link AnimationState} animations are changed. */
class SpineAnimationStateData
{
    /** The SkeletonData to look up animations when they are specified by name. */
    skeletonData = null;
    animationToMixTime = {};

    /** The mix duration to use when no mix duration has been defined between two animations. */
    defaultMix = 0;

    constructor(skeletonData)
    {
        if (!skeletonData)
            throw new Error("skeletonData cannot be null.");
        this.skeletonData = skeletonData;
    }

    /** Sets a mix duration by animation name.
     *
     * See {@link #setMixWith()}. */
    setMix(fromName, toName, duration)
    {
        let from = this.skeletonData.findAnimation(fromName);
        if (!from)
            throw new Error("Animation not found: " + fromName);
        let to = this.skeletonData.findAnimation(toName);
        if (!to)
            throw new Error("Animation not found: " + toName);
        this.setMixWith(from, to, duration);
    }

    /** Sets the mix duration when changing from the specified animation to the other.
     *
     * See {@link TrackEntry#mixDuration}. */
    setMixWith(from, to, duration)
    {
        if (!from)
            throw new Error("from cannot be null.");
        if (!to)
            throw new Error("to cannot be null.");
        let key = from.name + "." + to.name;
        this.animationToMixTime[key] = duration;
    }

    /** Returns the mix duration to use when changing from the specified animation to the other, or the {@link #defaultMix} if
      * no mix duration has been set. */
    getMix(from, to)
    {
        let key = from.name + "." + to.name;
        let value = this.animationToMixTime[key];
        return value === undefined ? this.defaultMix : value;
    }
}

/** Applies animations over time, queues animations for later playback, mixes (crossfading) between animations, and applies
 * multiple animations on top of each other (layering).
 *
 * See [Applying Animations](http://esotericsoftware.com/spine-applying-animations/) in the Spine Runtimes Guide. */
class SpineAnimationState
{
    // How each timeline of an entry mixes (TrackEntry.timelineMode); spine-core's module constants
    static #kSubsequent = 0;     // A previously applied timeline set this property: mix from the current pose to the timeline pose
    static #kFirst = 1;          // The first timeline to set it, and the next entry doesn't: mix from the setup pose
    static #kHoldSubsequent = 2; // As subsequent, but the next entry sets it too: don't mix out (no "dipping")
    static #kHoldFirst = 3;      // As first, but the next entry sets it too: don't mix out
    static #kHoldMix = 4;        // As hold first, mixed out by timelineHoldMix's mix (3+ entries in a row set it)

    // Slot.attachmentState, past unkeyedState
    static #kSetup = 1;
    static #kCurrent = 2;

    static #emptyAnimation = null;

    static emptyAnimation()
    {
        if (!SpineAnimationState.#emptyAnimation)
            SpineAnimationState.#emptyAnimation = new SpineAnimation("<empty>", [], 0);
        return SpineAnimationState.#emptyAnimation;
    }

    /** The AnimationStateData to look up mix durations. */
    data = null;

    /** The list of tracks that currently have animations, which may contain null entries. */
    tracks = new Array();

    /** Multiplier for the delta time when the animation state is updated, causing time for all animations and mixes to play slower
     * or faster. Defaults to 1.
     *
     * See TrackEntry {@link TrackEntry#timeScale} for affecting a single animation. */
    timeScale = 1;
    unkeyedState = 0;
    events = new Array();
    eventCallback = null; // Engine: see setEventCallback()
    queue = new SpineEventQueue(this);
    propertyIDs = new SpineStringSet();
    animationsChanged = false;
    trackEntryPool = new SpinePool(() => new SpineTrackEntry());

    constructor(data)
    {
        this.data = data;
    }

    /** Increments each track entry {@link TrackEntry#trackTime()}, setting queued animations as current if needed. */
    update(delta)
    {
        delta *= this.timeScale;
        let tracks = this.tracks;
        for (let i = 0, n = tracks.length; i < n; i++)
        {
            let current = tracks[i];
            if (!current)
                continue;
            current.animationLast = current.nextAnimationLast;
            current.trackLast = current.nextTrackLast;
            let currentDelta = delta * current.timeScale;
            if (current.delay > 0)
            {
                current.delay -= currentDelta;
                if (current.delay > 0)
                    continue;
                currentDelta = -current.delay;
                current.delay = 0;
            }
            let next = current.next;
            if (next)
            {
                // When the next entry's delay is passed, change to the next entry, preserving leftover time.
                let nextTime = current.trackLast - next.delay;
                if (nextTime >= 0)
                {
                    next.delay = 0;
                    next.trackTime += current.timeScale == 0 ? 0 : (nextTime / current.timeScale + delta) * next.timeScale;
                    current.trackTime += currentDelta;
                    this.setCurrent(i, next, true);
                    while (next.mixingFrom)
                    {
                        next.mixTime += delta;
                        next = next.mixingFrom;
                    }
                    continue;
                }
            }
            else if (current.trackLast >= current.trackEnd && !current.mixingFrom)
            {
                tracks[i] = null;
                this.queue.end(current);
                this.clearNext(current);
                continue;
            }
            if (current.mixingFrom && this.updateMixingFrom(current, delta))
            {
                // End mixing from entries once all have completed.
                let from = current.mixingFrom;
                current.mixingFrom = null;
                if (from)
                    from.mixingTo = null;
                while (from)
                {
                    this.queue.end(from);
                    from = from.mixingFrom;
                }
            }
            current.trackTime += currentDelta;
        }
        this.queue.drain();
    }

    /** Returns true when all mixing from entries are complete. */
    updateMixingFrom(to, delta)
    {
        let from = to.mixingFrom;
        if (!from)
            return true;
        let finished = this.updateMixingFrom(from, delta);
        from.animationLast = from.nextAnimationLast;
        from.trackLast = from.nextTrackLast;
        // Require mixTime > 0 to ensure the mixing from entry was applied at least once.
        if (to.mixTime > 0 && to.mixTime >= to.mixDuration)
        {
            // Require totalAlpha == 0 to ensure mixing is complete, unless mixDuration == 0 (the transition is a single frame).
            if (from.totalAlpha == 0 || to.mixDuration == 0)
            {
                to.mixingFrom = from.mixingFrom;
                if (from.mixingFrom)
                    from.mixingFrom.mixingTo = to;
                to.interruptAlpha = from.interruptAlpha;
                this.queue.end(from);
            }
            return finished;
        }
        from.trackTime += delta * from.timeScale;
        to.mixTime += delta;
        return false;
    }

    /** Poses the skeleton using the track entry animations. There are no side effects other than calling the event callback, so the
     * animation state can be applied to multiple skeletons to pose them identically.
     * @returns True if any animations were applied. */
    apply(skeleton)
    {
        if (!skeleton)
            throw new Error("skeleton cannot be null.");
        if (this.animationsChanged)
            this._animationsChanged();
        let events = this.events;
        let tracks = this.tracks;
        let applied = false;
        for (let i = 0, n = tracks.length; i < n; i++)
        {
            let current = tracks[i];
            if (!current || current.delay > 0)
                continue;
            applied = true;
            let blend = i == 0 ? SpineMixBlend.first : current.mixBlend;
            // Apply mixing from entries first.
            let mix = current.alpha;
            if (current.mixingFrom)
                mix *= this.applyMixingFrom(current, skeleton, blend);
            else if (current.trackTime >= current.trackEnd && !current.next)
                mix = 0;
            // Apply current entry.
            let animationLast = current.animationLast, animationTime = current.getAnimationTime(), applyTime = animationTime;
            let applyEvents = events;
            if (current.reverse)
            {
                applyTime = current.animation.duration - applyTime;
                applyEvents = null;
            }
            let timelines = current.animation.timelines;
            let timelineCount = timelines.length;
            if ((i == 0 && mix == 1) || blend == SpineMixBlend.add)
            {
                for (let ii = 0; ii < timelineCount; ii++)
                {
                    // Fixes issue #302 on IOS9 where mix, blend sometimes became undefined and caused assets
                    // to sometimes stop rendering when using color correction, as their RGBA values become NaN.
                    // (https://github.com/pixijs/pixi-spine/issues/302)
                    SpineUtils.webkit602BugfixHelper(mix, blend);
                    var timeline = timelines[ii];
                    if (timeline instanceof SpineAttachmentTimeline)
                        this.applyAttachmentTimeline(timeline, skeleton, applyTime, blend, true);
                    else
                        timeline.apply(skeleton, animationLast, applyTime, applyEvents, mix, blend, SpineMixDirection.mixIn);
                }
            }
            else
            {
                let timelineMode = current.timelineMode;
                let firstFrame = current.timelinesRotation.length != timelineCount << 1;
                if (firstFrame)
                    current.timelinesRotation.length = timelineCount << 1;
                for (let ii = 0; ii < timelineCount; ii++)
                {
                    let timeline = timelines[ii];
                    let timelineBlend = timelineMode[ii] == SpineAnimationState.#kSubsequent ? blend : SpineMixBlend.setup;
                    if (timeline instanceof SpineRotateTimeline)
                    {
                        this.applyRotateTimeline(timeline, skeleton, applyTime, mix, timelineBlend, current.timelinesRotation, ii << 1, firstFrame);
                    }
                    else if (timeline instanceof SpineAttachmentTimeline)
                    {
                        this.applyAttachmentTimeline(timeline, skeleton, applyTime, blend, true);
                    }
                    else
                    {
                        // This fixes the WebKit 602 specific issue described at http://esotericsoftware.com/forum/iOS-10-disappearing-graphics-10109
                        SpineUtils.webkit602BugfixHelper(mix, blend);
                        timeline.apply(skeleton, animationLast, applyTime, applyEvents, mix, timelineBlend, SpineMixDirection.mixIn);
                    }
                }
            }
            this.queueEvents(current, animationTime);
            events.length = 0;
            current.nextAnimationLast = animationTime;
            current.nextTrackLast = current.trackTime;
        }
        // Set slots attachments to the setup pose, if needed. This occurs if an animation that is mixing out sets attachments so
        // subsequent timelines see any deform, but the subsequent timelines don't set an attachment (eg they are also mixing out or
        // the time is before the first key).
        var setupState = this.unkeyedState + SpineAnimationState.#kSetup;
        var slots = skeleton.slots;
        for (var i = 0, n = skeleton.slots.length; i < n; i++)
        {
            var slot = slots[i];
            if (slot.attachmentState == setupState)
            {
                var attachmentName = slot.data.attachmentName;
                slot.setAttachment(!attachmentName ? null : skeleton.getAttachment(slot.data.index, attachmentName));
            }
        }
        this.unkeyedState += 2; // Increasing after each use avoids the need to reset attachmentState for every slot.
        this.queue.drain();
        return applied;
    }

    applyMixingFrom(to, skeleton, blend)
    {
        let from = to.mixingFrom;
        if (from.mixingFrom)
            this.applyMixingFrom(from, skeleton, blend);
        let mix = 0;
        if (to.mixDuration == 0) { // Single frame mix to undo mixingFrom changes.
            mix = 1;
            if (blend == SpineMixBlend.first)
                blend = SpineMixBlend.setup;
        }
        else
        {
            mix = to.mixTime / to.mixDuration;
            if (mix > 1)
                mix = 1;
            if (blend != SpineMixBlend.first)
                blend = from.mixBlend;
        }
        let attachments = mix < from.attachmentThreshold, drawOrder = mix < from.drawOrderThreshold;
        let timelines = from.animation.timelines;
        let timelineCount = timelines.length;
        let alphaHold = from.alpha * to.interruptAlpha, alphaMix = alphaHold * (1 - mix);
        let animationLast = from.animationLast, animationTime = from.getAnimationTime(), applyTime = animationTime;
        let events = null;
        if (from.reverse)
            applyTime = from.animation.duration - applyTime;
        else if (mix < from.eventThreshold)
            events = this.events;
        if (blend == SpineMixBlend.add)
        {
            for (let i = 0; i < timelineCount; i++)
                timelines[i].apply(skeleton, animationLast, applyTime, events, alphaMix, blend, SpineMixDirection.mixOut);
        }
        else
        {
            let timelineMode = from.timelineMode;
            let timelineHoldMix = from.timelineHoldMix;
            let firstFrame = from.timelinesRotation.length != timelineCount << 1;
            if (firstFrame)
                from.timelinesRotation.length = timelineCount << 1;
            from.totalAlpha = 0;
            for (let i = 0; i < timelineCount; i++)
            {
                let timeline = timelines[i];
                let direction = SpineMixDirection.mixOut;
                let timelineBlend;
                let alpha = 0;
                switch (timelineMode[i])
                {
                    case SpineAnimationState.#kSubsequent:
                        if (!drawOrder && timeline instanceof SpineDrawOrderTimeline)
                            continue;
                        timelineBlend = blend;
                        alpha = alphaMix;
                        break;
                    case SpineAnimationState.#kFirst:
                        timelineBlend = SpineMixBlend.setup;
                        alpha = alphaMix;
                        break;
                    case SpineAnimationState.#kHoldSubsequent:
                        timelineBlend = blend;
                        alpha = alphaHold;
                        break;
                    case SpineAnimationState.#kHoldFirst:
                        timelineBlend = SpineMixBlend.setup;
                        alpha = alphaHold;
                        break;
                    default:
                        timelineBlend = SpineMixBlend.setup;
                        let holdMix = timelineHoldMix[i];
                        alpha = alphaHold * Math.max(0, 1 - holdMix.mixTime / holdMix.mixDuration);
                        break;
                }
                from.totalAlpha += alpha;
                if (timeline instanceof SpineRotateTimeline)
                    this.applyRotateTimeline(timeline, skeleton, applyTime, alpha, timelineBlend, from.timelinesRotation, i << 1, firstFrame);
                else if (timeline instanceof SpineAttachmentTimeline)
                    this.applyAttachmentTimeline(timeline, skeleton, applyTime, timelineBlend, attachments);
                else
                {
                    // This fixes the WebKit 602 specific issue described at http://esotericsoftware.com/forum/iOS-10-disappearing-graphics-10109
                    SpineUtils.webkit602BugfixHelper(alpha, blend);
                    if (drawOrder && timeline instanceof SpineDrawOrderTimeline && timelineBlend == SpineMixBlend.setup)
                        direction = SpineMixDirection.mixIn;
                    timeline.apply(skeleton, animationLast, applyTime, events, alpha, timelineBlend, direction);
                }
            }
        }
        if (to.mixDuration > 0)
            this.queueEvents(from, animationTime);
        this.events.length = 0;
        from.nextAnimationLast = animationTime;
        from.nextTrackLast = from.trackTime;
        return mix;
    }

    applyAttachmentTimeline(timeline, skeleton, time, blend, attachments)
    {
        var slot = skeleton.slots[timeline.slotIndex];
        if (!slot.bone.active)
            return;
        if (time < timeline.frames[0]) { // Time is before first frame.
            if (blend == SpineMixBlend.setup || blend == SpineMixBlend.first)
                this.setAttachment(skeleton, slot, slot.data.attachmentName, attachments);
        }
        else
            this.setAttachment(skeleton, slot, timeline.attachmentNames[SpineTimeline.search1(timeline.frames, time)], attachments);
        // If an attachment wasn't set (ie before the first frame or attachments is false), set the setup attachment later.
        if (slot.attachmentState <= this.unkeyedState)
            slot.attachmentState = this.unkeyedState + SpineAnimationState.#kSetup;
    }

    setAttachment(skeleton, slot, attachmentName, attachments)
    {
        slot.setAttachment(!attachmentName ? null : skeleton.getAttachment(slot.data.index, attachmentName));
        if (attachments)
            slot.attachmentState = this.unkeyedState + SpineAnimationState.#kCurrent;
    }

    applyRotateTimeline(timeline, skeleton, time, alpha, blend, timelinesRotation, i, firstFrame)
    {
        if (firstFrame)
            timelinesRotation[i] = 0;
        if (alpha == 1)
        {
            timeline.apply(skeleton, 0, time, null, 1, blend, SpineMixDirection.mixIn);
            return;
        }
        let bone = skeleton.bones[timeline.boneIndex];
        if (!bone.active)
            return;
        let frames = timeline.frames;
        let r1 = 0, r2 = 0;
        if (time < frames[0])
        {
            switch (blend)
            {
                case SpineMixBlend.setup:
                    bone.rotation = bone.data.rotation;
                default:
                    return;
                case SpineMixBlend.first:
                    r1 = bone.rotation;
                    r2 = bone.data.rotation;
            }
        }
        else
        {
            r1 = blend == SpineMixBlend.setup ? bone.data.rotation : bone.rotation;
            r2 = bone.data.rotation + timeline.getCurveValue(time);
        }
        // Mix between rotations using the direction of the shortest route on the first frame while detecting crosses.
        let total = 0, diff = r2 - r1;
        diff -= (16384 - ((16384.499999999996 - diff / 360) | 0)) * 360;
        if (diff == 0)
        {
            total = timelinesRotation[i];
        }
        else
        {
            let lastTotal = 0, lastDiff = 0;
            if (firstFrame)
            {
                lastTotal = 0;
                lastDiff = diff;
            }
            else
            {
                lastTotal = timelinesRotation[i]; // Angle and direction of mix, including loops.
                lastDiff = timelinesRotation[i + 1]; // Difference between bones.
            }
            let current = diff > 0, dir = lastTotal >= 0;
            // Detect cross at 0 (not 180).
            if (SpineMathUtils.signum(lastDiff) != SpineMathUtils.signum(diff) && Math.abs(lastDiff) <= 90)
            {
                // A cross after a 360 rotation is a loop.
                if (Math.abs(lastTotal) > 180)
                    lastTotal += 360 * SpineMathUtils.signum(lastTotal);
                dir = current;
            }
            total = diff + lastTotal - lastTotal % 360; // Store loops as part of lastTotal.
            if (dir != current)
                total += 360 * SpineMathUtils.signum(lastTotal);
            timelinesRotation[i] = total;
        }
        timelinesRotation[i + 1] = diff;
        bone.rotation = r1 + total * alpha;
    }

    queueEvents(entry, animationTime)
    {
        let animationStart = entry.animationStart, animationEnd = entry.animationEnd;
        let duration = animationEnd - animationStart;
        let trackLastWrapped = entry.trackLast % duration;
        // Queue events before complete.
        let events = this.events;
        let i = 0, n = events.length;
        for (; i < n; i++)
        {
            let event = events[i];
            if (event.time < trackLastWrapped)
                break;
            if (event.time > animationEnd)
                continue; // Discard events outside animation start/end.
            this.queue.event(entry, event);
        }
        // Queue complete if completed a loop iteration or the animation.
        let complete = false;
        if (entry.loop)
            complete = duration == 0 || trackLastWrapped > entry.trackTime % duration;
        else
            complete = animationTime >= animationEnd && entry.animationLast < animationEnd;
        if (complete)
            this.queue.complete(entry);
        // Queue events after complete.
        for (; i < n; i++)
        {
            let event = events[i];
            if (event.time < animationStart)
                continue; // Discard events outside animation start/end.
            this.queue.event(entry, event);
        }
    }

    /** Removes all animations from all tracks, leaving skeletons in their current pose.
     *
     * It may be desired to use {@link AnimationState#setEmptyAnimation()} to mix the skeletons back to the setup pose,
     * rather than leaving them in their current pose. */
    clearTracks()
    {
        let oldDrainDisabled = this.queue.drainDisabled;
        this.queue.drainDisabled = true;
        for (let i = 0, n = this.tracks.length; i < n; i++)
            this.clearTrack(i);
        this.tracks.length = 0;
        this.queue.drainDisabled = oldDrainDisabled;
        this.queue.drain();
    }

    /** Removes all animations from the track, leaving skeletons in their current pose.
     *
     * It may be desired to use {@link AnimationState#setEmptyAnimation()} to mix the skeletons back to the setup pose,
     * rather than leaving them in their current pose. */
    clearTrack(trackIndex)
    {
        if (trackIndex >= this.tracks.length)
            return;
        let current = this.tracks[trackIndex];
        if (!current)
            return;
        this.queue.end(current);
        this.clearNext(current);
        let entry = current;
        while (true)
        {
            let from = entry.mixingFrom;
            if (!from)
                break;
            this.queue.end(from);
            entry.mixingFrom = null;
            entry.mixingTo = null;
            entry = from;
        }
        this.tracks[current.trackIndex] = null;
        this.queue.drain();
    }

    setCurrent(index, current, interrupt)
    {
        let from = this.expandToIndex(index);
        this.tracks[index] = current;
        current.previous = null;
        if (from)
        {
            if (interrupt)
                this.queue.interrupt(from);
            current.mixingFrom = from;
            from.mixingTo = current;
            current.mixTime = 0;
            // Store the interrupted mix percentage.
            if (from.mixingFrom && from.mixDuration > 0)
                current.interruptAlpha *= Math.min(1, from.mixTime / from.mixDuration);
            from.timelinesRotation.length = 0; // Reset rotation for mixing out, in case entry was mixed in.
        }
        this.queue.start(current);
    }

    /** Sets an animation by name.
      *
      * See {@link #setAnimationWith()}. */
    setAnimation(trackIndex, animationName, loop = false)
    {
        let animation = this.data.skeletonData.findAnimation(animationName);
        if (!animation)
            throw new Error("Animation not found: " + animationName);
        return this.setAnimationWith(trackIndex, animation, loop);
    }

    /** Sets the current animation for a track, discarding any queued animations. If the formerly current track entry was never
     * applied to a skeleton, it is replaced (not mixed from).
     * @param loop If true, the animation will repeat. If false it will not, instead its last frame is applied if played beyond its
     *           duration. In either case {@link TrackEntry#trackEnd} determines when the track is cleared.
     * @returns A track entry to allow further customization of animation playback. References to the track entry must not be kept
     *         after the dispose event occurs (see SpineAnimationState.setEventCallback()). */
    setAnimationWith(trackIndex, animation, loop = false)
    {
        if (!animation)
            throw new Error("animation cannot be null.");
        let interrupt = true;
        let current = this.expandToIndex(trackIndex);
        if (current)
        {
            if (current.nextTrackLast == -1)
            {
                // Don't mix from an entry that was never applied.
                this.tracks[trackIndex] = current.mixingFrom;
                this.queue.interrupt(current);
                this.queue.end(current);
                this.clearNext(current);
                current = current.mixingFrom;
                interrupt = false;
            }
            else
                this.clearNext(current);
        }
        let entry = this.trackEntry(trackIndex, animation, loop, current);
        this.setCurrent(trackIndex, entry, interrupt);
        this.queue.drain();
        return entry;
    }

    /** Queues an animation by name.
     *
     * See {@link #addAnimationWith()}. */
    addAnimation(trackIndex, animationName, loop = false, delay = 0)
    {
        let animation = this.data.skeletonData.findAnimation(animationName);
        if (!animation)
            throw new Error("Animation not found: " + animationName);
        return this.addAnimationWith(trackIndex, animation, loop, delay);
    }

    /** Adds an animation to be played after the current or last queued animation for a track. If the track is empty, it is
     * equivalent to calling {@link #setAnimationWith()}.
     * @param delay If > 0, sets {@link TrackEntry#delay}. If <= 0, the delay set is the duration of the previous track entry
     *           minus any mix duration (from the {@link AnimationStateData}) plus the specified `delay` (ie the mix
     *           ends at (`delay` = 0) or before (`delay` < 0) the previous track entry duration). If the
     *           previous entry is looping, its next loop completion is used instead of its duration.
     * @returns A track entry to allow further customization of animation playback. References to the track entry must not be kept
     *         after the dispose event occurs (see SpineAnimationState.setEventCallback()). */
    addAnimationWith(trackIndex, animation, loop = false, delay = 0)
    {
        if (!animation)
            throw new Error("animation cannot be null.");
        let last = this.expandToIndex(trackIndex);
        if (last)
        {
            while (last.next)
                last = last.next;
        }
        let entry = this.trackEntry(trackIndex, animation, loop, last);
        if (!last)
        {
            this.setCurrent(trackIndex, entry, true);
            this.queue.drain();
        }
        else
        {
            last.next = entry;
            entry.previous = last;
            if (delay <= 0)
                delay += last.getTrackComplete() - entry.mixDuration;
        }
        entry.delay = delay;
        return entry;
    }

    /** Sets an empty animation for a track, discarding any queued animations, and sets the track entry's
     * {@link TrackEntry#mixduration}. An empty animation has no timelines and serves as a placeholder for mixing in or out.
     *
     * Mixing out is done by setting an empty animation with a mix duration using either {@link #setEmptyAnimation()},
     * {@link #setEmptyAnimations()}, or {@link #addEmptyAnimation()}. Mixing to an empty animation causes
     * the previous animation to be applied less and less over the mix duration. Properties keyed in the previous animation
     * transition to the value from lower tracks or to the setup pose value if no lower tracks key the property. A mix duration of
     * 0 still mixes out over one frame.
     *
     * Mixing in is done by first setting an empty animation, then adding an animation using
     * {@link #addAnimation()} and on the returned track entry, set the
     * {@link TrackEntry#setMixDuration()}. Mixing from an empty animation causes the new animation to be applied more and
     * more over the mix duration. Properties keyed in the new animation transition from the value from lower tracks or from the
     * setup pose value if no lower tracks key the property to the value keyed in the new animation. */
    setEmptyAnimation(trackIndex, mixDuration = 0)
    {
        let entry = this.setAnimationWith(trackIndex, SpineAnimationState.emptyAnimation(), false);
        entry.mixDuration = mixDuration;
        entry.trackEnd = mixDuration;
        return entry;
    }

    /** Adds an empty animation to be played after the current or last queued animation for a track, and sets the track entry's
     * {@link TrackEntry#mixDuration}. If the track is empty, it is equivalent to calling
     * {@link #setEmptyAnimation()}.
     *
     * See {@link #setEmptyAnimation()}.
     * @param delay If > 0, sets {@link TrackEntry#delay}. If <= 0, the delay set is the duration of the previous track entry
     *           minus any mix duration plus the specified `delay` (ie the mix ends at (`delay` = 0) or
     *           before (`delay` < 0) the previous track entry duration). If the previous entry is looping, its next
     *           loop completion is used instead of its duration.
     * @return A track entry to allow further customization of animation playback. References to the track entry must not be kept
     *         after the dispose event occurs (see SpineAnimationState.setEventCallback()). */
    addEmptyAnimation(trackIndex, mixDuration = 0, delay = 0)
    {
        let entry = this.addAnimationWith(trackIndex, SpineAnimationState.emptyAnimation(), false, delay);
        if (delay <= 0)
            entry.delay += entry.mixDuration - mixDuration;
        entry.mixDuration = mixDuration;
        entry.trackEnd = mixDuration;
        return entry;
    }

    /** Sets an empty animation for every track, discarding any queued animations, and mixes to it over the specified mix
      * duration. */
    setEmptyAnimations(mixDuration = 0)
    {
        let oldDrainDisabled = this.queue.drainDisabled;
        this.queue.drainDisabled = true;
        for (let i = 0, n = this.tracks.length; i < n; i++)
        {
            let current = this.tracks[i];
            if (current)
                this.setEmptyAnimation(current.trackIndex, mixDuration);
        }
        this.queue.drainDisabled = oldDrainDisabled;
        this.queue.drain();
    }

    expandToIndex(index)
    {
        if (index < this.tracks.length)
            return this.tracks[index];
        SpineUtils.ensureArrayCapacity(this.tracks, index + 1, null);
        this.tracks.length = index + 1;
        return null;
    }

    /** @param last May be null. */
    trackEntry(trackIndex, animation, loop, last)
    {
        let entry = this.trackEntryPool.obtain();
        entry.reset();
        entry.trackIndex = trackIndex;
        entry.animation = animation;
        entry.loop = loop;
        entry.holdPrevious = false;
        entry.eventThreshold = 0;
        entry.attachmentThreshold = 0;
        entry.drawOrderThreshold = 0;
        entry.animationStart = 0;
        entry.animationEnd = animation.duration;
        entry.animationLast = -1;
        entry.nextAnimationLast = -1;
        entry.delay = 0;
        entry.trackTime = 0;
        entry.trackLast = -1;
        entry.nextTrackLast = -1;
        entry.trackEnd = Number.MAX_VALUE;
        entry.timeScale = 1;
        entry.alpha = 1;
        entry.interruptAlpha = 1;
        entry.mixTime = 0;
        entry.mixDuration = !last ? 0 : this.data.getMix(last.animation, animation);
        entry.mixBlend = SpineMixBlend.replace;
        return entry;
    }

    /** Removes the {@link TrackEntry#getNext() next entry} and all entries after it for the specified entry. */
    clearNext(entry)
    {
        let next = entry.next;
        while (next)
        {
            this.queue.dispose(next);
            next = next.next;
        }
        entry.next = null;
    }

    _animationsChanged()
    {
        this.animationsChanged = false;
        this.propertyIDs.clear();
        let tracks = this.tracks;
        for (let i = 0, n = tracks.length; i < n; i++)
        {
            let entry = tracks[i];
            if (!entry)
                continue;
            while (entry.mixingFrom)
                entry = entry.mixingFrom;
            do
            {
                if (!entry.mixingTo || entry.mixBlend != SpineMixBlend.add)
                    this.computeHold(entry);
                entry = entry.mixingTo;
            } while (entry);
        }
    }

    computeHold(entry)
    {
        let to = entry.mixingTo;
        let timelines = entry.animation.timelines;
        let timelinesCount = entry.animation.timelines.length;
        let timelineMode = entry.timelineMode;
        timelineMode.length = timelinesCount;
        let timelineHoldMix = entry.timelineHoldMix;
        timelineHoldMix.length = 0;
        let propertyIDs = this.propertyIDs;
        if (to && to.holdPrevious)
        {
            for (let i = 0; i < timelinesCount; i++)
                timelineMode[i] = propertyIDs.addAll(timelines[i].getPropertyIds()) ? SpineAnimationState.#kHoldFirst : SpineAnimationState.#kHoldSubsequent;
            return;
        }
        outer: for (let i = 0; i < timelinesCount; i++)
        {
            let timeline = timelines[i];
            let ids = timeline.getPropertyIds();
            if (!propertyIDs.addAll(ids))
                timelineMode[i] = SpineAnimationState.#kSubsequent;
            else if (!to || timeline instanceof SpineAttachmentTimeline || timeline instanceof SpineDrawOrderTimeline
                || timeline instanceof SpineEventTimeline || !to.animation.hasTimeline(ids))
            {
                timelineMode[i] = SpineAnimationState.#kFirst;
            }
            else
            {
                for (let next = to.mixingTo; next; next = next.mixingTo)
                {
                    if (next.animation.hasTimeline(ids))
                        continue;
                    if (entry.mixDuration > 0)
                    {
                        timelineMode[i] = SpineAnimationState.#kHoldMix;
                        timelineHoldMix[i] = next;
                        continue outer;
                    }
                    break;
                }
                timelineMode[i] = SpineAnimationState.#kHoldFirst;
            }
        }
    }

    /** Returns the track entry for the animation currently playing on the track, or null if no animation is currently playing. */
    getCurrent(trackIndex)
    {
        if (trackIndex >= this.tracks.length)
            return null;
        return this.tracks[trackIndex];
    }

    /*
        Engine: one callback in place of Spine's listener objects (addListener() and
        TrackEntry.listener). callback(state, entry, SpineEventType, event) is called for
        every entry's start, interrupt, end, dispose and complete, and for each keyed
        event (event is the SpineEvent; null for the others). An end is followed by
        its dispose, as in Spine. It's safe to call the state's methods from it. null
        for none.
    */
    setEventCallback(callback) { this.eventCallback = (typeof callback === "function") ? callback : null; }

    getEventCallback() { return this.eventCallback; }

    /** Discards all notifications that have not yet been delivered. This can be useful to call from the event callback when it
     * is known that further notifications that may have been already queued for delivery are not wanted because new
     * animations are being set. */
    clearListenerNotifications()
    {
        this.queue.clear();
    }
}

/** Stores settings and other state for the playback of an animation on an {@link AnimationState} track.
 *
 * References to a track entry must not be kept after the dispose event occurs (see SpineAnimationState.setEventCallback()). */
class SpineTrackEntry
{
    /** The animation to apply for this track entry. */
    animation = null;
    previous = null;

    /** The animation queued to start after this animation, or null. `next` makes up a linked list. */
    next = null;

    /** The track entry for the previous animation when mixing from the previous animation to this animation, or null if no
     * mixing is currently occuring. When mixing from multiple animations, `mixingFrom` makes up a linked list. */
    mixingFrom = null;

    /** The track entry for the next animation when mixing from this animation to the next animation, or null if no mixing is
     * currently occuring. When mixing to multiple animations, `mixingTo` makes up a linked list. */
    mixingTo = null;

    /** The index of the track where this track entry is either current or queued.
     *
     * See {@link AnimationState#getCurrent()}. */
    trackIndex = 0;

    /** If true, the animation will repeat. If false it will not, instead its last frame is applied if played beyond its
     * duration. */
    loop = false;

    /** If true, when mixing from the previous animation to this animation, the previous animation is applied as normal instead
     * of being mixed out.
     *
     * When mixing between animations that key the same property, if a lower track also keys that property then the value will
     * briefly dip toward the lower track value during the mix. This happens because the first animation mixes from 100% to 0%
     * while the second animation mixes from 0% to 100%. Setting `holdPrevious` to true applies the first animation
     * at 100% during the mix so the lower track value is overwritten. Such dipping does not occur on the lowest track which
     * keys the property, only when a higher track also keys the property.
     *
     * Snapping will occur if `holdPrevious` is true and this animation does not key all the same properties as the
     * previous animation. */
    holdPrevious = false;
    reverse = false;

    /** When the mix percentage ({@link #mixTime} / {@link #mixDuration}) is less than the
     * `eventThreshold`, event timelines are applied while this animation is being mixed out. Defaults to 0, so event
     * timelines are not applied while this animation is being mixed out. */
    eventThreshold = 0;

    /** When the mix percentage ({@link #mixtime} / {@link #mixDuration}) is less than the
     * `attachmentThreshold`, attachment timelines are applied while this animation is being mixed out. Defaults to
     * 0, so attachment timelines are not applied while this animation is being mixed out. */
    attachmentThreshold = 0;

    /** When the mix percentage ({@link #mixTime} / {@link #mixDuration}) is less than the
     * `drawOrderThreshold`, draw order timelines are applied while this animation is being mixed out. Defaults to 0,
     * so draw order timelines are not applied while this animation is being mixed out. */
    drawOrderThreshold = 0;

    /** Seconds when this animation starts, both initially and after looping. Defaults to 0.
     *
     * When changing the `animationStart` time, it often makes sense to set {@link #animationLast} to the same
     * value to prevent timeline keys before the start time from triggering. */
    animationStart = 0;

    /** Seconds for the last frame of this animation. Non-looping animations won't play past this time. Looping animations will
     * loop back to {@link #animationStart} at this time. Defaults to the animation {@link Animation#duration}. */
    animationEnd = 0;

    /** The time in seconds this animation was last applied. Some timelines use this for one-time triggers. Eg, when this
     * animation is applied, event timelines will fire all events between the `animationLast` time (exclusive) and
     * `animationTime` (inclusive). Defaults to -1 to ensure triggers on frame 0 happen the first time this animation
     * is applied. */
    animationLast = 0;
    nextAnimationLast = 0;

    /** Seconds to postpone playing the animation. When this track entry is the current track entry, `delay`
     * postpones incrementing the {@link #trackTime}. When this track entry is queued, `delay` is the time from
     * the start of the previous animation to when this track entry will become the current track entry (ie when the previous
     * track entry {@link TrackEntry#trackTime} >= this track entry's `delay`).
     *
     * {@link #timeScale} affects the delay. */
    delay = 0;

    /** Current time in seconds this track entry has been the current track entry. The track time determines
     * {@link #animationTime}. The track time can be set to start the animation at a time other than 0, without affecting
     * looping. */
    trackTime = 0;
    trackLast = 0;
    nextTrackLast = 0;

    /** The track time in seconds when this animation will be removed from the track. Defaults to the highest possible float
     * value, meaning the animation will be applied until a new animation is set or the track is cleared. If the track end time
     * is reached, no other animations are queued for playback, and mixing from any previous animations is complete, then the
     * properties keyed by the animation are set to the setup pose and the track is cleared.
     *
     * It may be desired to use {@link AnimationState#addEmptyAnimation()} rather than have the animation
     * abruptly cease being applied. */
    trackEnd = 0;

    /** Multiplier for the delta time when this track entry is updated, causing time for this animation to pass slower or
     * faster. Defaults to 1.
     *
     * {@link #mixTime} is not affected by track entry time scale, so {@link #mixDuration} may need to be adjusted to
     * match the animation speed.
     *
     * When using {@link AnimationState#addAnimation()} with a `delay` <= 0, note the
     * {@link #delay} is set using the mix duration from the {@link AnimationStateData}, assuming time scale to be 1. If
     * the time scale is not 1, the delay may need to be adjusted.
     *
     * See AnimationState {@link AnimationState#timeScale} for affecting all animations. */
    timeScale = 0;

    /** Values < 1 mix this animation with the skeleton's current pose (usually the pose resulting from lower tracks). Defaults
     * to 1, which overwrites the skeleton's current pose with this animation.
     *
     * Typically track 0 is used to completely pose the skeleton, then alpha is used on higher tracks. It doesn't make sense to
     * use alpha on track 0 if the skeleton pose is from the last frame render. */
    alpha = 0;

    /** Seconds from 0 to the {@link #getMixDuration()} when mixing from the previous animation to this animation. May be
     * slightly more than `mixDuration` when the mix is complete. */
    mixTime = 0;

    /** Seconds for mixing from the previous animation to this animation. Defaults to the value provided by AnimationStateData
     * {@link AnimationStateData#getMix()} based on the animation before this animation (if any).
     *
     * A mix duration of 0 still mixes out over one frame to provide the track entry being mixed out a chance to revert the
     * properties it was animating.
     *
     * The `mixDuration` can be set manually rather than use the value from
     * {@link AnimationStateData#getMix()}. In that case, the `mixDuration` can be set for a new
     * track entry only before {@link AnimationState#update(float)} is first called.
     *
     * When using {@link AnimationState#addAnimation()} with a `delay` <= 0, note the
     * {@link #delay} is set using the mix duration from the {@link AnimationStateData}, not a mix duration set
     * afterward. */
    mixDuration = 0;
    interruptAlpha = 0;
    totalAlpha = 0;

    /** Controls how properties keyed in the animation are mixed with lower tracks. Defaults to {@link MixBlend#replace}, which
     * replaces the values from the lower tracks with the animation values. {@link MixBlend#add} adds the animation values to
     * the values from the lower tracks.
     *
     * The `mixBlend` can be set for a new track entry only before {@link AnimationState#apply()} is first
     * called. */
    mixBlend = SpineMixBlend.replace;
    timelineMode = new Array();
    timelineHoldMix = new Array();
    timelinesRotation = new Array();

    reset()
    {
        this.next = null;
        this.previous = null;
        this.mixingFrom = null;
        this.mixingTo = null;
        this.animation = null;
        this.timelineMode.length = 0;
        this.timelineHoldMix.length = 0;
        this.timelinesRotation.length = 0;
    }

    /** Uses {@link #trackTime} to compute the `animationTime`, which is between {@link #animationStart}
     * and {@link #animationEnd}. When the `trackTime` is 0, the `animationTime` is equal to the
     * `animationStart` time. */
    getAnimationTime()
    {
        if (this.loop)
        {
            let duration = this.animationEnd - this.animationStart;
            if (duration == 0)
                return this.animationStart;
            return (this.trackTime % duration) + this.animationStart;
        }
        return Math.min(this.trackTime + this.animationStart, this.animationEnd);
    }

    setAnimationLast(animationLast)
    {
        this.animationLast = animationLast;
        this.nextAnimationLast = animationLast;
    }

    /** Returns true if at least one loop has been completed.
     *
     * See the complete event (SpineAnimationState.setEventCallback()). */
    isComplete()
    {
        return this.trackTime >= this.animationEnd - this.animationStart;
    }

    /** Resets the rotation directions for mixing this entry's rotate timelines. This can be useful to avoid bones rotating the
     * long way around when using {@link #alpha} and starting animations on other tracks.
     *
     * Mixing with {@link MixBlend#replace} involves finding a rotation between two others, which has two possible solutions:
     * the short way or the long way around. The two rotations likely change over time, so which direction is the short or long
     * way also changes. If the short way was always chosen, bones would flip to the other side when that direction became the
     * long way. TrackEntry chooses the short way the first time it is applied and remembers that direction. */
    resetRotationDirections()
    {
        this.timelinesRotation.length = 0;
    }

    getTrackComplete()
    {
        let duration = this.animationEnd - this.animationStart;
        if (duration != 0)
        {
            if (this.loop)
                return duration * (1 + ((this.trackTime / duration) | 0)); // Completion of next loop.
            if (this.trackTime < duration)
                return duration; // Before duration.
        }
        return this.trackTime; // Next update.
    }
}

class SpineEventQueue
{
    objects = [];
    drainDisabled = false;
    animState = null;

    constructor(animState)
    {
        this.animState = animState;
    }

    start(entry)
    {
        this.objects.push(SpineEventType.start);
        this.objects.push(entry);
        this.animState.animationsChanged = true;
    }

    interrupt(entry)
    {
        this.objects.push(SpineEventType.interrupt);
        this.objects.push(entry);
    }

    end(entry)
    {
        this.objects.push(SpineEventType.end);
        this.objects.push(entry);
        this.animState.animationsChanged = true;
    }

    dispose(entry)
    {
        this.objects.push(SpineEventType.dispose);
        this.objects.push(entry);
    }

    complete(entry)
    {
        this.objects.push(SpineEventType.complete);
        this.objects.push(entry);
    }

    event(entry, event)
    {
        this.objects.push(SpineEventType.event);
        this.objects.push(entry);
        this.objects.push(event);
    }

    /*
        Engine: delivers every queued notification to the state's event callback
        (see SpineAnimationState.setEventCallback()), in order. An end is followed by
        its dispose; a disposed entry goes back to the pool.
    */
    drain()
    {
        if (this.drainDisabled)
            return;
        this.drainDisabled = true;
        let objects = this.objects;
        let state = this.animState;
        for (let i = 0; i < objects.length; i += 2)
        {
            let type = objects[i];
            let entry = objects[i + 1];
            let callback = state.eventCallback; // Read each time: the callback may change it
            switch (type)
            {
                case SpineEventType.start:
                case SpineEventType.interrupt:
                case SpineEventType.complete:
                    if (callback !== null)
                        callback(state, entry, type, null);
                    break;
                case SpineEventType.end:
                    if (callback !== null)
                        callback(state, entry, type, null);
                // Fall through.
                case SpineEventType.dispose:
                    callback = state.eventCallback;
                    if (callback !== null)
                        callback(state, entry, SpineEventType.dispose, null);
                    state.trackEntryPool.free(entry);
                    break;
                case SpineEventType.event:
                    let event = objects[i++ + 2];
                    if (callback !== null)
                        callback(state, entry, type, event);
                    break;
            }
        }
        this.clear();
        this.drainDisabled = false;
    }

    clear()
    {
        this.objects.length = 0;
    }
}