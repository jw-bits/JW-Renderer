"use strict";

/*
    AnimPlayer - Plays an AnimAction or AnimSequence on one Entity: a Model2D,
    a Camera2D, or a plain Entity grouping others (its children move with it).

    Play modes (AnimPlayMode):
        kOnce          Start to end, then stops at the end
        kPingPong      Start to end and back again, over and over
        kPingPongOnce  Start to end and back again, then stops at the start

    play() works out where each action starts: its set starts, and for the
    other channels the model's value then, carried through the actions before
    it. Each frame is worked out from those, so a ping-pong runs back exactly.

    The player only writes the channels the action being played animates;
    the others are left to game code, or another player on the same model.

    Usage:
        let player = new AnimPlayer();
        player.setEventCallback((player, event) => { if (event === AnimEvent.kCompleted) ... });
        player.play(checker, hop, AnimPlayMode.kOnce);

        // Each frame
        player.update(dt);

    The action or sequence can be shared: give each model its own player.
*/
class AnimPlayer
{
    static #kStopped = 0;
    static #kPlaying = 1;
    static #kPaused = 2;
    static #kFinished = 3;

    #eventCallback; // (player, AnimEvent) or null

    // Set by play()
    #target;        // The Entity, or null
    #motion;        // The AnimAction or AnimSequence, or null
    #playMode;      // AnimPlayMode
    #actions;       // The actions, as they were when play() was called
    #starts;        // Transform2D per action: where it starts (see AnimAction.resolveStart())
    #offsets;       // Seconds into the motion each action starts; one more on the end for the duration
    #current;       // Transform2D the actions are worked out into (position is the model's anchor)
    #time;          // Seconds into the motion
    #index;         // The action last applied
    #isReversed;    // True while ping-ponging back
    #state;
    #runId;         // Changes on every play() / stop(), so an event callback that calls them is noticed

    constructor()
    {
        this.#eventCallback = null;

        this.#target = null;
        this.#motion = null;
        this.#playMode = AnimPlayMode.kOnce;
        this.#actions = [];
        this.#starts = [];
        this.#offsets = [0.0];
        this.#current = new Transform2D();
        this.#time = 0.0;
        this.#index = 0;
        this.#isReversed = false;
        this.#state = AnimPlayer.#kStopped;
        this.#runId = 0;
    }

    /*
        Plays motion (an AnimAction or AnimSequence) on model, an Entity (a
        Model2D must be loaded). Motion with no duration jumps to its end and
        completes. Returns false (and changes nothing) if the arguments aren't valid.
    */
    play(model, motion, playMode = AnimPlayMode.kOnce)
    {
        if ((model instanceof Entity) === false || AnimPlayer.#isUnloaded(model) === true)
        {
            console.error("AnimPlayer.play() needs an Entity, and a Model2D must be loaded");
                return false;
        }

        if ((motion instanceof AnimAction) === false && (motion instanceof AnimSequence) === false)
        {
            console.error("AnimPlayer.play() needs an AnimAction or AnimSequence");
                return false;
        }

        if (AnimPlayMode.isValid(playMode) === false)
        {
            console.error("AnimPlayer.play() needs an AnimPlayMode such as AnimPlayMode.kPingPong");
                return false;
        }

        this.stop();

        this.#target = model;
        this.#motion = motion;
        this.#playMode = playMode;
        this.#actions = (motion instanceof AnimAction) ? [motion] : motion.getActions().slice();

        // Where each action starts: carry the model's transform through the actions
        this.#current.copy(model.getTransform());
        this.#offsets.length = this.#actions.length + 1;
        this.#offsets[0] = 0.0;

        for (let i = 0; i < this.#actions.length; ++i)
        {
            const action = this.#actions[i];

            if (i >= this.#starts.length)
                this.#starts.push(new Transform2D());

            action.resolveStart(this.#current, this.#starts[i]);
            action.evaluate(this.#starts[i], action.getDuration(), this.#current); // Now where it ends
            this.#offsets[i + 1] = this.#offsets[i] + action.getDuration();
        }

        this.#state = AnimPlayer.#kPlaying;

        if (this.getDuration() <= 0.0)
        {
            this.#apply(0.0); // The end, which is also the start
            this.#complete();
        }
        else
            this.#apply(0.0);

        return true;
    }

    // Lets go of the model where it is now
    stop()
    {
        this.#target = null;
        this.#motion = null;
        this.#actions = [];
        this.#time = 0.0;
        this.#index = 0;
        this.#isReversed = false;
        this.#state = AnimPlayer.#kStopped;
        ++this.#runId;
    }

    // Holds where it is; resume() carries on
    pause()
    {
        if (this.#state === AnimPlayer.#kPlaying)
            this.#state = AnimPlayer.#kPaused;
    }

    resume()
    {
        if (this.#state === AnimPlayer.#kPaused)
            this.#state = AnimPlayer.#kPlaying;
    }

    // Moves dt seconds on (back while ping-ponging back) and applies the result to the model
    update(dt)
    {
        if (this.#state !== AnimPlayer.#kPlaying)
            return;

        if (Number.isFinite(dt) === false || dt < 0.0)
            return; // Time never runs backwards here; ping-pong handles direction

        if (AnimPlayer.#isUnloaded(this.#target) === true)
        {
            this.stop(); // The model was unloaded
                return;
        }

        const duration = this.getDuration();
        this.#time += (this.#isReversed === true) ? -dt : dt;

        // Handle reaching an end, more than once if dt spans several turns
        while (true)
        {
            if (this.#isReversed === false && this.#time >= duration)
            {
                if (this.#playMode === AnimPlayMode.kOnce)
                {
                    this.#time = duration;
                    this.#apply(this.#time);
                    this.#complete();
                        return;
                }

                this.#time = duration - (this.#time - duration); // Turn around
                this.#isReversed = true;
            }
            else if (this.#isReversed === true && this.#time <= 0.0)
            {
                if (this.#playMode === AnimPlayMode.kPingPongOnce)
                {
                    this.#time = 0.0;
                    this.#apply(this.#time);
                    this.#complete();
                        return;
                }

                this.#time = -this.#time; // Turn around
                this.#isReversed = false;
            }
            else
                break;

            if (this.#fireEvent(AnimEvent.kTurned) === false)
                return; // The callback stopped, paused or restarted the player
        }

        this.#apply(this.#time);
    }

    // callback(player, AnimEvent), or null for none. It may call play() or stop().
    setEventCallback(callback) { this.#eventCallback = (typeof callback === "function") ? callback : null; }

    getTarget() { return this.#target; }
    getMotion() { return this.#motion; }
    getPlayMode() { return this.#playMode; }
    getTime() { return this.#time; }

    // Seconds from start to end, as worked out in play()
    getDuration() { return this.#offsets[this.#actions.length] ?? 0.0; }

    isPlaying() { return (this.#state === AnimPlayer.#kPlaying); }
    isPaused() { return (this.#state === AnimPlayer.#kPaused); }
    isFinished() { return (this.#state === AnimPlayer.#kFinished); }
    isReversed() { return this.#isReversed; }

    // *** Internal Methods ***

    // True for a Model2D that isn't loaded; other Entities have nothing to load
    static #isUnloaded(entity) { return (entity instanceof Model2D && entity.isLoaded() === false); }

    /*
        Applies the motion seconds in. Actions passed on the way to the one
        holding that time get their end (going forward) or start (going back)
        applied, so a big step never leaves a channel part way.
    */
    #apply(seconds)
    {
        const count = this.#actions.length;

        if (count === 0)
            return;

        while (this.#index < count - 1 && seconds >= this.#offsets[this.#index + 1])
        {
            this.#applyAction(this.#index, this.#actions[this.#index].getDuration());
            ++this.#index;
        }

        while (this.#index > 0 && seconds < this.#offsets[this.#index])
        {
            this.#applyAction(this.#index, 0.0);
            --this.#index;
        }

        this.#applyAction(this.#index, seconds - this.#offsets[this.#index]);
    }

    // Writes action i's channels, seconds into it, to the model
    #applyAction(i, seconds)
    {
        const action = this.#actions[i];

        action.evaluate(this.#starts[i], seconds, this.#current);
        AnimAction.applyChannels(this.#current, this.#target, action.getChannels());
    }

    // Stops at the end it reached; the model stays there
    #complete()
    {
        this.#state = AnimPlayer.#kFinished;
        this.#fireEvent(AnimEvent.kCompleted);
    }

    // Returns false if the callback stopped, paused or restarted the player
    #fireEvent(event)
    {
        if (this.#eventCallback === null)
            return true;

        const state = this.#state;
        const runId = this.#runId;

        this.#eventCallback(this, event);

        return (this.#state === state && this.#runId === runId);
    }
}
