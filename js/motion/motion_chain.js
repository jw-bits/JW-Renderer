"use strict";

/*
    MotionChain - MotionActions that play one after another, from the first
    one's start to the last one's target. Its duration is the sum of its
    actions' durations, and it moves every channel any of them moves.

    Each action has its own start, so the chain jumps if one action's
    target isn't the next one's start.

    Usage:
        let hop = new MotionChain([rise, fall]); // MotionActions
        checker.addMotion().add("hop", hop);     // checker is an Entity

    The chain holds the play time, not its actions, so an action can be in
    several chains, or more than once in one. Changes to the actions show
    straight away, even while the chain plays.
*/
class MotionChain extends MotionBase
{
    #actions; // MotionActions, in play order

    constructor(_actions = null)
    {
        super();

        this.#actions = [];

        if (_actions !== null)
            this.set(_actions);
    }

    // Replaces the actions with an array of MotionActions. Returns false (and changes nothing) if it isn't one.
    set(actions)
    {
        if (Array.isArray(actions) === false || actions.every((a) => a instanceof MotionAction) === false)
        {
            console.error("MotionChain.set() needs an array of MotionActions");
                return false;
        }

        this.#actions = actions.slice();
            return true;
    }

    // Adds an action to the end
    add(action)
    {
        if ((action instanceof MotionAction) === false)
        {
            console.error("MotionChain.add() needs a MotionAction");
                return false;
        }

        this.#actions.push(action);
            return true;
    }

    clear() { this.#actions = []; }

    getActions() { return this.#actions; } // Read-only; change them with set(), add() and clear()
    getActionCount() { return this.#actions.length; }

    // Seconds: the sum of the actions' durations
    getDuration()
    {
        let total = 0.0;

        for (const action of this.#actions)
            total += action.getDuration();

        return total;
    }

    getChannels()
    {
        let channels = MotionChannel.kNone;

        for (const action of this.#actions)
            channels |= action.getChannels();

        return channels;
    }

    /*
        Writes the moved channels seconds in into out (a MotionState) and
        returns it. The action holding that time is part way; the ones before
        it are at their targets. A channel only later actions move is at the
        start of the first of them, so the result depends on the time alone
        and a ping-pong runs back exactly.
    */
    evaluateAt(seconds, out)
    {
        const actions = this.#actions;
        const count = actions.length;

        if (count === 0)
            return out;

        // The action holding seconds
        let k = 0;
        let offset = 0.0;

        while (k < count - 1 && seconds >= offset + actions[k].getDuration())
        {
            offset += actions[k].getDuration();
            ++k;
        }

        // Later actions last to first, so the first one moving a channel wins
        for (let i = count - 1; i > k; --i)
            actions[i].evaluateAt(0.0, out);

        for (let i = 0; i < k; ++i)
            actions[i].evaluateAt(actions[i].getDuration(), out);

        return actions[k].evaluateAt(seconds - offset, out);
    }
}
