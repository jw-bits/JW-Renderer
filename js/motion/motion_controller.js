"use strict";

/*
    MotionController - An Entity's motions (MotionActions and MotionChains),
    each under a name with its own play style (MotionPlayStyle):

        kOnce          Start to target, then stops at the target
        kPingPongOnce  Start to target and back again, then stops at the start
        kPingPongLoop  Start to target and back again, over and over

    Get one from Entity.addMotion(); the entity's update(dt) updates it.
    Several motions can play at once, usually on different channels. Each
    frame they're written to the entity in the order they were added, so on
    a channel two of them move, the one added later wins.

    Usage:
        let motion = piece.addMotion();      // piece is an Entity
        motion.add("lift", liftChain);
        motion.add("slide", slide, MotionPlayStyle.kOnce);
        motion.setEventCallback((controller, name, event) => { if (name === "slide" && event === MotionEvent.kCompleted) ... });
        motion.play("lift");
        motion.play("slide");

        // Each frame
        piece.update(dt);

    A motion holds its own play time, so give each entity its own motions
    (they can share MotionValues).
*/
class MotionController
{
    static #kStopped = 0;
    static #kPlaying = 1;
    static #kPaused = 2;
    static #kFinished = 3;

    static #kCurrent = new MotionState(); // Scratch: a motion's channels before they're written to the entity

    #owner;         // The Entity
    #tracks;        // Map of name: { motion, playStyle, state, runId }
    #eventCallback; // (controller, name, MotionEvent) or null

    constructor(_owner)
    {
        if ((_owner instanceof Entity) === false)
            console.error("MotionController needs the Entity it moves (use Entity.addMotion())");

        this.#owner = _owner;
        this.#tracks = new Map();
        this.#eventCallback = null;
    }

    getOwner() { return this.#owner; }

    // *** Motions ***

    /*
        Adds motion (a MotionAction or MotionChain) under name, replacing (and
        stopping) any motion already there. It doesn't play until play().
        Returns false (and changes nothing) if the arguments aren't valid.
    */
    add(name, motion, playStyle = MotionPlayStyle.kOnce)
    {
        if (typeof name !== "string" || name.length === 0)
        {
            console.error("MotionController.add() needs a name");
                return false;
        }

        if ((motion instanceof MotionAction) === false && (motion instanceof MotionChain) === false)
        {
            console.error(`MotionController.add() "${name}" needs a MotionAction or MotionChain`);
                return false;
        }

        if (MotionPlayStyle.isValid(playStyle) === false)
        {
            console.error(`MotionController.add() "${name}" needs a MotionPlayStyle such as MotionPlayStyle.kOnce`);
                return false;
        }

        this.remove(name);
        this.#tracks.set(name, { motion: motion, playStyle: playStyle, state: MotionController.#kStopped, runId: 0 });
            return true;
    }

    // Stops and forgets the motion under name; returns false if there isn't one
    remove(name)
    {
        const track = this.#tracks.get(name);

        if (track === undefined)
            return false;

        this.#setState(track, MotionController.#kStopped);
        this.#tracks.delete(name);
            return true;
    }

    has(name) { return this.#tracks.has(name); }
    get(name) { return this.#tracks.get(name)?.motion ?? null; } // The MotionAction or MotionChain, or null
    getNames() { return Array.from(this.#tracks.keys()); }

    // Takes effect from the motion's next end
    setPlayStyle(name, playStyle)
    {
        const track = this.#getTrack(name, "setPlayStyle");

        if (track === null)
            return false;

        if (MotionPlayStyle.isValid(playStyle) === false)
        {
            console.error("MotionController.setPlayStyle() needs a MotionPlayStyle such as MotionPlayStyle.kOnce");
                return false;
        }

        track.playStyle = playStyle;
            return true;
    }

    getPlayStyle(name) { return this.#tracks.get(name)?.playStyle ?? MotionPlayStyle.kOnce; }

    // *** Playing ***

    /*
        Plays the motion under name from its start, which is written to the
        entity straight away; playStyle (a MotionPlayStyle) also changes its
        style. A motion with no duration jumps to its target and completes.
        Returns false if there's no motion under name.
    */
    play(name, playStyle = null)
    {
        const track = this.#getTrack(name, "play");

        if (track === null)
            return false;

        if (playStyle !== null && this.setPlayStyle(name, playStyle) === false)
            return false;

        if (MotionController.#isUnloaded(this.#owner) === true)
        {
            console.error(`MotionController.play() "${name}": the entity's model isn't loaded`);
                return false;
        }

        track.motion.rewind();
        this.#setState(track, MotionController.#kPlaying);
        this.#apply(track);

        if (track.motion.getDuration() <= 0.0)
            this.#complete(name, track);

        return true;
    }

    // Lets go of the entity where it is now
    stop(name)
    {
        const track = this.#tracks.get(name);

        if (track !== undefined)
            this.#setState(track, MotionController.#kStopped);
    }

    stopAll()
    {
        for (const track of this.#tracks.values())
            this.#setState(track, MotionController.#kStopped);
    }

    // Holds where it is; resume() carries on
    pause(name)
    {
        const track = this.#tracks.get(name);

        if (track !== undefined && track.state === MotionController.#kPlaying)
            track.state = MotionController.#kPaused;
    }

    resume(name)
    {
        const track = this.#tracks.get(name);

        if (track !== undefined && track.state === MotionController.#kPaused)
            track.state = MotionController.#kPlaying;
    }

    isPlaying(name) { return (this.#tracks.get(name)?.state === MotionController.#kPlaying); }
    isPaused(name) { return (this.#tracks.get(name)?.state === MotionController.#kPaused); }
    isFinished(name) { return (this.#tracks.get(name)?.state === MotionController.#kFinished); }

    // True if any motion is playing
    isAnyPlaying()
    {
        for (const track of this.#tracks.values())
        {
            if (track.state === MotionController.#kPlaying)
                return true;
        }

        return false;
    }

    // callback(controller, name, MotionEvent), or null for none. It may call play(), stop() and the rest.
    setEventCallback(callback) { this.#eventCallback = (typeof callback === "function") ? callback : null; }

    // Moves every playing motion dt seconds on and writes it to the entity. Entity.update() calls this.
    update(dt)
    {
        if (Number.isFinite(dt) === false || dt < 0.0)
            return;

        if (MotionController.#isUnloaded(this.#owner) === true)
        {
            this.stopAll(); // The model was unloaded
                return;
        }

        for (const [name, track] of this.#tracks)
        {
            if (track.state === MotionController.#kPlaying)
                this.#advance(name, track, dt);
        }
    }

    // *** Internal Methods ***

    // True for an Entity whose model isn't loaded (see Entity.isReady()); one without a model has nothing to load
    static #isUnloaded(entity) { return (entity.isReady() === false); }

    #getTrack(name, methodName)
    {
        const track = this.#tracks.get(name);

        if (track === undefined)
        {
            console.error(`MotionController.${methodName}(): no motion named "${name}"`);
                return null;
        }

        return track;
    }

    // Changing the state through here lets #fireEvent() notice a callback that played or stopped the track
    #setState(track, state)
    {
        track.state = state;
        ++track.runId;
    }

    // Moves a playing track dt seconds on, turning or completing at its ends, then writes it to the entity
    #advance(name, track, dt)
    {
        const motion = track.motion;

        if (motion.getDuration() <= 0.0)
        {
            this.#apply(track);
            this.#complete(name, track);
                return;
        }

        let left = motion.update(dt);

        // Handle reaching an end, more than once if dt spans several turns
        while (motion.isAtEnd() === true)
        {
            const isAtTarget = (motion.isReversed() === false);
            const style = track.playStyle;

            if ((isAtTarget === true && style === MotionPlayStyle.kOnce) || (isAtTarget === false && style !== MotionPlayStyle.kPingPongLoop))
            {
                this.#apply(track);
                this.#complete(name, track);
                    return;
            }

            motion.setReversed(isAtTarget); // Turn around

            if (this.#fireEvent(name, track, MotionEvent.kTurned) === false)
                return; // The callback stopped, paused or restarted it

            left = motion.update(left);
        }

        this.#apply(track);
    }

    // Writes the track's motion, at its current time, to the entity
    #apply(track)
    {
        const motion = track.motion;

        motion.evaluate(MotionController.#kCurrent);
        MotionBase.applyChannels(MotionController.#kCurrent, this.#owner, motion.getChannels());
    }

    // Stops at the end it reached; the entity stays there
    #complete(name, track)
    {
        this.#setState(track, MotionController.#kFinished);
        this.#fireEvent(name, track, MotionEvent.kCompleted);
    }

    // Returns false if the callback stopped, paused, restarted or removed the track
    #fireEvent(name, track, event)
    {
        if (this.#eventCallback === null)
            return true;

        const state = track.state;
        const runId = track.runId;

        this.#eventCallback(this, name, event);

        return (track.state === state && track.runId === runId && this.#tracks.get(name) === track);
    }
}
