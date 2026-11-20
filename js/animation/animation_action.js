"use strict";

/*
    AnimAction - Animates any of a model's translation, scale and rotation
    (each an AnimChannel) from a start to a target. Each channel has its own
    duration and easing; the action lasts as long as its longest channel, and
    shorter ones hold their target until it ends.

    A channel's start is either set (setTranslationStart() ...) or, if not,
    whatever the model's value is when the action begins. Channels that
    aren't set are left alone, for game code or another player.

    Only data: play it with an AnimPlayer, on its own or in an AnimSequence.
    One action can be played on any number of models at once.

    Usage:
        let slide = new AnimAction();
        slide.setTranslation(400, 200, 0.35, Easing.kQuadraticInOut); // From wherever the model is
        slide.setRotation(Math.PI, 0.2);                               // Half a turn, faster
        slide.setScaleStart(0.5, 0.5);                                 // Grows from half size...
        slide.setScale(1.0, 1.0, 0.35, Easing.kBackOut);               // ...to full size

        player.play(rect, slide);

    Rotation goes straight from start to target, without wrapping: from
    2 PI to 0 turns a full circle back. A channel with a duration of 0 jumps
    to its target.
*/
class AnimAction
{
    #start;         // AnimTransform: the set starts (only the channels in #startChannels)
    #target;        // AnimTransform
    #channels;      // AnimChannel flags animated
    #startChannels; // AnimChannel flags with a set start

    // Per channel: { duration (seconds), easing (Easing type) }
    #posTiming;
    #scaleTiming;
    #rotTiming;

    constructor()
    {
        this.#start = new AnimTransform();
        this.#target = new AnimTransform();
        this.#channels = AnimChannel.kNone;
        this.#startChannels = AnimChannel.kNone;

        this.#posTiming = { duration: 0.0, easing: Easing.kLinear };
        this.#scaleTiming = { duration: 0.0, easing: Easing.kLinear };
        this.#rotTiming = { duration: 0.0, easing: Easing.kLinear };
    }

    // *** Targets: each animates its channel ***

    setTranslation(x, y, duration, easing = Easing.kLinear)
    {
        if (AnimAction.#isValid([x, y], duration, easing, "setTranslation") === false)
            return false;

        this.#target.setTranslation(x, y);
        AnimAction.#setTiming(this.#posTiming, duration, easing);
        this.#channels |= AnimChannel.kTranslation;
            return true;
    }

    setScale(sx, sy, duration, easing = Easing.kLinear)
    {
        if (AnimAction.#isValid([sx, sy], duration, easing, "setScale") === false)
            return false;

        this.#target.setScale(sx, sy);
        AnimAction.#setTiming(this.#scaleTiming, duration, easing);
        this.#channels |= AnimChannel.kScale;
            return true;
    }

    // Radians
    setRotation(radians, duration, easing = Easing.kLinear)
    {
        if (AnimAction.#isValid([radians], duration, easing, "setRotation") === false)
            return false;

        this.#target.setRotation(radians);
        AnimAction.#setTiming(this.#rotTiming, duration, easing);
        this.#channels |= AnimChannel.kRotation;
            return true;
    }

    // *** Starts: without one, a channel starts from the model's value when the action begins ***

    setTranslationStart(x, y)
    {
        if (AnimAction.#isValid([x, y], 0.0, Easing.kLinear, "setTranslationStart") === false)
            return false;

        this.#start.setTranslation(x, y);
        this.#startChannels |= AnimChannel.kTranslation;
            return true;
    }

    setScaleStart(sx, sy)
    {
        if (AnimAction.#isValid([sx, sy], 0.0, Easing.kLinear, "setScaleStart") === false)
            return false;

        this.#start.setScale(sx, sy);
        this.#startChannels |= AnimChannel.kScale;
            return true;
    }

    setRotationStart(radians)
    {
        if (AnimAction.#isValid([radians], 0.0, Easing.kLinear, "setRotationStart") === false)
            return false;

        this.#start.setRotation(radians);
        this.#startChannels |= AnimChannel.kRotation;
            return true;
    }

    // Stops animating the AnimChannel flags in channels, and forgets their starts
    clear(channels = AnimChannel.kAll)
    {
        this.#channels &= ~channels;
        this.#startChannels &= ~channels;
    }

    // Forgets the starts of the AnimChannel flags in channels; they start from the model again
    clearStart(channels = AnimChannel.kAll) { this.#startChannels &= ~channels; }

    getChannels() { return this.#channels; }
    getStartChannels() { return this.#startChannels; }
    getStart() { return this.#start; }   // Read-only; only the channels in getStartChannels() are used
    getTarget() { return this.#target; } // Read-only

    // A single channel's duration and easing (0 and kLinear if it isn't animated)
    getChannelDuration(channel) { return this.#timingOf(channel)?.duration ?? 0.0; }
    getChannelEasing(channel) { return this.#timingOf(channel)?.easing ?? Easing.kLinear; }

    // Seconds: the longest animated channel's duration
    getDuration()
    {
        let longest = 0.0;

        if ((this.#channels & AnimChannel.kTranslation) !== 0)
            longest = Math.max(longest, this.#posTiming.duration);

        if ((this.#channels & AnimChannel.kScale) !== 0)
            longest = Math.max(longest, this.#scaleTiming.duration);

        if ((this.#channels & AnimChannel.kRotation) !== 0)
            longest = Math.max(longest, this.#rotTiming.duration);

        return longest;
    }

    // *** For AnimPlayer ***

    // The transform this action starts from, given current (the model's when it begins): current with the set starts on top
    resolveStart(current, out)
    {
        out.copy(current);
        out.copy(this.#start, this.#startChannels);
            return out;
    }

    /*
        Writes the animated channels seconds into the action, from start (see
        resolveStart()), into out; other channels of out are left as they are.
        start and out must be different AnimTransforms.
    */
    evaluate(start, seconds, out)
    {
        if ((this.#channels & AnimChannel.kTranslation) !== 0)
        {
            const e = AnimAction.#progress(this.#posTiming, seconds);
            out.setTranslation(MathUtil.lerp(start.getX(), this.#target.getX(), e),
                               MathUtil.lerp(start.getY(), this.#target.getY(), e));
        }

        if ((this.#channels & AnimChannel.kScale) !== 0)
        {
            const e = AnimAction.#progress(this.#scaleTiming, seconds);
            out.setScale(MathUtil.lerp(start.getScaleX(), this.#target.getScaleX(), e),
                         MathUtil.lerp(start.getScaleY(), this.#target.getScaleY(), e));
        }

        if ((this.#channels & AnimChannel.kRotation) !== 0)
        {
            const e = AnimAction.#progress(this.#rotTiming, seconds);
            out.setRotation(MathUtil.lerp(start.getRotation(), this.#target.getRotation(), e));
        }

        return out;
    }

    // *** Internal Methods ***

    #timingOf(channel)
    {
        switch (channel)
        {
            case AnimChannel.kTranslation: return this.#posTiming;
            case AnimChannel.kScale: return this.#scaleTiming;
            case AnimChannel.kRotation: return this.#rotTiming;
            default: return null;
        }
    }

    // Eased progress through a channel: 0 at the start, 1 from its duration on (Back / Elastic overshoot in between)
    static #progress(timing, seconds)
    {
        if (timing.duration <= 0.0)
            return 1.0;

        return Easing.ease(timing.easing, Math.min(1.0, Math.max(0.0, seconds / timing.duration)));
    }

    static #setTiming(timing, duration, easing)
    {
        timing.duration = duration;
        timing.easing = easing;
    }

    static #isValid(values, duration, easing, methodName)
    {
        if (values.every((v) => Number.isFinite(v)) === false)
        {
            console.error(`AnimAction.${methodName}(): values must be numbers`);
                return false;
        }

        if (Number.isFinite(duration) === false || duration < 0.0)
        {
            console.error(`AnimAction.${methodName}(): duration must be 0 or more seconds`);
                return false;
        }

        if (Easing.isValid(easing) === false)
        {
            console.error(`AnimAction.${methodName}() needs an easing type such as Easing.kLinear`);
                return false;
        }

        return true;
    }
}
