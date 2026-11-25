"use strict";

/*
    Motion types: moving an Entity's local position, scale and rotation over
    time. Sprite frame animation (UVs) belongs to rendering; its types are in
    render_defines.js.

        MotionValues      Per channel: duration and easing. Any number of MotionActions can share one. (Below.)
        MotionBase        What MotionAction and MotionChain share: play time, direction and update(dt)
        MotionAction      From a start Transform2D to a target one, timed by a MotionValues
        MotionChain       MotionActions, one after another
        MotionController  An Entity's named motions and how each plays (see Entity.enableMotion())

    Usage:
        let timing = new MotionValues({ translation: { duration: 0.35, easing: Easing.kQuadraticInOut } });
        let slide = new MotionAction(new Transform2D(100, 100), new Transform2D(400, 200), timing);

        let motion = rect.enableMotion();
        motion.add("slide", slide, MotionPlayStyle.kPingPongLoop);
        motion.play("slide");

        // Each frame
        rect.update(dt);
*/

// The parts of a transform a motion can move, as bit flags (combine with |)
class MotionChannel
{
    static kNone = 0;
    static kTranslation = 1;
    static kScale = 2;
    static kRotation = 4;
    static kAll = 7;
}

// How a MotionController plays one of its motions
class MotionPlayStyle
{
    static kOnce = 0;          // Start to target, then stops at the target
    static kPingPongOnce = 1;  // Start to target and back again, then stops at the start
    static kPingPongLoop = 2;  // Start to target and back again, over and over

    static isValid(style) { return (Number.isInteger(style) === true && style >= MotionPlayStyle.kOnce && style <= MotionPlayStyle.kPingPongLoop); }
}

// What a MotionController reports to its event callback (see MotionController.setEventCallback())
class MotionEvent
{
    static kCompleted = 0; // A kOnce / kPingPongOnce motion finished
    static kTurned = 1;    // A ping-pong reached an end and turned around
}

/*
    MotionValues - The timing of a MotionAction: which channels
    (MotionChannel) it moves, and each one's duration and easing. Any number
    of actions can share one; a change to it shows in all of them, including
    any playing now.

    It can be made from a plain object, any of whose keys can be left out
    (a channel left out isn't moved; easing defaults to Easing.kLinear):

        let timing = new MotionValues({
            translation: { duration: 0.35, easing: Easing.kQuadraticInOut },
            scale:       { duration: 0.35, easing: Easing.kBackOut },
            rotation:    { duration: 0.2 }
        });

        timing.setChannel(MotionChannel.kRotation, 0.5, Easing.kSineOut); // Or one channel at a time

    A motion lasts as long as its longest channel; shorter ones hold their
    target until it ends. A channel with a duration of 0 jumps to its target.
*/
class MotionValues
{
    static #kKeys = ["translation", "scale", "rotation"]; // In #channelIndex() order
    static #kChannels = [MotionChannel.kTranslation, MotionChannel.kScale, MotionChannel.kRotation];

    #channels; // MotionChannel flags moved
    #timings;  // Per channel, in #kKeys order: { duration (seconds), easing (Easing type) }

    constructor(_values = null)
    {
        this.#channels = MotionChannel.kNone;
        this.#timings = MotionValues.#kKeys.map(() => ({ duration: 0.0, easing: Easing.kLinear }));

        if (_values !== null)
            this.set(_values);
    }

    /*
        Replaces every channel from a plain object (see the top of this class).
        Returns false (and changes nothing) if it isn't a valid one.
    */
    set(values)
    {
        const isObject = (values !== null && typeof values === "object");
        const keys = (isObject === true) ? Object.keys(values) : [];

        if (isObject === false || keys.every((k) => MotionValues.#kKeys.includes(k)) === false)
        {
            console.error(`MotionValues.set() needs an object with any of the keys ${MotionValues.#kKeys.join(", ")}`);
                return false;
        }

        for (const key of keys)
        {
            const t = values[key];
            const easing = t?.easing ?? Easing.kLinear;

            if (MotionValues.#isValid(t?.duration, easing, `set() "${key}"`) === false)
                return false;
        }

        this.#channels = MotionChannel.kNone;

        for (let i = 0; i < MotionValues.#kKeys.length; ++i)
        {
            const t = values[MotionValues.#kKeys[i]];

            if (t !== undefined)
                this.#setTiming(i, t.duration, t.easing ?? Easing.kLinear);
        }

        return true;
    }

    // Moves one channel (a single MotionChannel) over duration seconds
    setChannel(channel, duration, easing = Easing.kLinear)
    {
        const i = MotionValues.#channelIndex(channel);

        if (i < 0)
        {
            console.error("MotionValues.setChannel() needs a single MotionChannel such as MotionChannel.kScale");
                return false;
        }

        if (MotionValues.#isValid(duration, easing, "setChannel()") === false)
            return false;

        this.#setTiming(i, duration, easing);
            return true;
    }

    // Stops moving the MotionChannel flags in channels
    clear(channels = MotionChannel.kAll) { this.#channels &= ~channels; }

    getChannels() { return this.#channels; }

    // A single channel's duration and easing (0 and kLinear if it isn't moved)
    getChannelDuration(channel) { return this.#timingOf(channel)?.duration ?? 0.0; }
    getChannelEasing(channel) { return this.#timingOf(channel)?.easing ?? Easing.kLinear; }

    // Seconds: the longest moved channel's duration
    getDuration()
    {
        let longest = 0.0;

        for (let i = 0; i < MotionValues.#kChannels.length; ++i)
        {
            if ((this.#channels & MotionValues.#kChannels[i]) !== 0)
                longest = Math.max(longest, this.#timings[i].duration);
        }

        return longest;
    }

    // Eased progress of a moved channel seconds in: 0 at the start, 1 from its duration on (Back / Elastic overshoot in between)
    getProgress(channel, seconds)
    {
        const t = this.#timingOf(channel);

        if (t === null || t.duration <= 0.0)
            return 1.0;

        return Easing.ease(t.easing, MathUtil.clamp01(seconds / t.duration));
    }

    // *** Internal Methods ***

    #setTiming(i, duration, easing)
    {
        this.#timings[i].duration = duration;
        this.#timings[i].easing = easing;
        this.#channels |= MotionValues.#kChannels[i];
    }

    // The timing of a moved single channel, or null
    #timingOf(channel)
    {
        const i = MotionValues.#channelIndex(channel);

        return (i >= 0 && (this.#channels & channel) !== 0) ? this.#timings[i] : null;
    }

    // 0, 1 or 2 for kTranslation, kScale or kRotation; -1 for anything else
    static #channelIndex(channel) { return MotionValues.#kChannels.indexOf(channel); }

    static #isValid(duration, easing, methodName)
    {
        if (Number.isFinite(duration) === false || duration < 0.0)
        {
            console.error(`MotionValues.${methodName}: duration must be 0 or more seconds`);
                return false;
        }

        if (Easing.isValid(easing) === false)
        {
            console.error(`MotionValues.${methodName}: needs an easing type such as Easing.kLinear`);
                return false;
        }

        return true;
    }
}
