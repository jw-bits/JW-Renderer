"use strict";

/*
    AnimSequence - AnimActions that play one after another, first in first
    out. Its duration is the sum of its actions' durations.

    An action without a set start for a channel starts from wherever the
    actions before it left that channel (or the model's value, if none
    animated it).

    Only data: play it with an AnimPlayer. One sequence can be played on any
    number of models at once, and an action can appear in several sequences,
    or more than once in one.

    Usage:
        let hop = new AnimSequence([rise, fall]); // AnimActions
        player.play(checker, hop);

    Changes made while a player is playing it take effect on its next play().
*/
class AnimSequence
{
    #actions; // AnimActions, in play order

    constructor(_actions = null)
    {
        this.#actions = [];

        if (_actions !== null)
            this.set(_actions);
    }

    // Replaces the actions with an array of AnimActions. Returns false (and changes nothing) if it isn't one.
    set(actions)
    {
        if (Array.isArray(actions) === false || actions.every((a) => a instanceof AnimAction) === false)
        {
            console.error("AnimSequence.set() needs an array of AnimActions");
                return false;
        }

        this.#actions = actions.slice();
            return true;
    }

    // Adds an action to the end
    add(action)
    {
        if ((action instanceof AnimAction) === false)
        {
            console.error("AnimSequence.add() needs an AnimAction");
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
}
