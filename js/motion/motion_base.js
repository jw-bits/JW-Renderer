"use strict";

/*
    MotionBase - What MotionAction and MotionChain share: how far into the
    motion it is (getTime()) and which way it's going. update(dt) moves the
    time on; a MotionController calls it and writes the result to its Entity.

    The time runs from 0 (the start) to getDuration() (the target); reversed,
    it runs back towards 0. It stops at whichever end it's heading for;
    isAtEnd() says when it got there.

    Subclasses provide getDuration(), getChannels() and evaluateAt(). A
    motion holds its own time, so each Entity needs its own motion (they can
    share MotionValues).
*/
class MotionBase
{
    #time;       // Seconds in, 0 to getDuration()
    #isReversed; // True while heading back to the start

    constructor()
    {
        this.#time = 0.0;
        this.#isReversed = false;
    }

    // *** For subclasses to provide ***

    // Seconds from start to target
    getDuration() { return 0.0; }

    // The MotionChannel flags it moves
    getChannels() { return MotionChannel.kNone; }

    // Writes the moved channels seconds in into out (a Transform2D) and returns it; other channels are left as they are
    evaluateAt(seconds, out) { return out; }

    // *** Playing ***

    /*
        Moves dt seconds on in the current direction, stopping at the end it's
        heading for. Returns the seconds of dt left over past that end (0 if it
        didn't reach it), so a ping-pong can turn and carry on exactly.
    */
    update(dt)
    {
        if (Number.isFinite(dt) === false || dt <= 0.0)
            return 0.0;

        const duration = this.getDuration();

        if (this.#isReversed === false)
        {
            this.#time += dt;

            if (this.#time <= duration)
                return 0.0;

            const over = this.#time - duration;
            this.#time = duration;
                return over;
        }

        this.#time -= dt;

        if (this.#time >= 0.0)
            return 0.0;

        const over = -this.#time;
        this.#time = 0.0;
            return over;
    }

    // Back to the start, heading forward
    rewind()
    {
        this.#time = 0.0;
        this.#isReversed = false;
    }

    // Heads back to the start (true) or on to the target (false) from where it is
    setReversed(isReversed) { this.#isReversed = (isReversed === true); }
    isReversed() { return this.#isReversed; }

    // Seconds in, clamped to 0 .. getDuration()
    setTime(seconds)
    {
        if (Number.isFinite(seconds) === false)
        {
            console.error("MotionBase.setTime() needs a number of seconds");
                return false;
        }

        this.#time = MathUtil.clamp(seconds, 0.0, this.getDuration());
            return true;
    }

    getTime() { return this.#time; }

    // True at the end it's heading for: the target going forward, the start going back
    isAtEnd() { return (this.#isReversed === true) ? (this.#time <= 0.0) : (this.#time >= this.getDuration()); }

    // Writes the moved channels at the current time into out (a Transform2D) and returns it
    evaluate(out) { return this.evaluateAt(this.#time, out); }

    // Writes the MotionChannel parts in channels of transform to entity's local transform; a model keeps its alignment
    static applyChannels(transform, entity, channels = MotionChannel.kAll)
    {
        if ((channels & MotionChannel.kTranslation) !== 0)
            entity.setPosition(transform.getX(), transform.getY());

        if ((channels & MotionChannel.kScale) !== 0)
            entity.setScale(transform.getScaleX(), transform.getScaleY());

        if ((channels & MotionChannel.kRotation) !== 0)
            entity.setRotation(transform.getRotation());
    }
}
