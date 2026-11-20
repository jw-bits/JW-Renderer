"use strict";

/*
    Animation types: transforms on a model's position, scale and rotation.
    Sprite frame animation (UVs) belongs to rendering; its types are in
    render_defines.js.

        AnimTransform  Translation, scale and rotation
        AnimAction     Per channel: start, target, duration and easing
        AnimSequence   AnimActions, one after another
        AnimPlayer     Plays an AnimAction or AnimSequence on one Model2D
*/

// The parts of a transform an AnimAction can animate, as bit flags (combine with |)
class AnimChannel
{
    static kNone = 0;
    static kTranslation = 1;
    static kScale = 2;
    static kRotation = 4;
    static kAll = 7;
}

// How an AnimPlayer plays
class AnimPlayMode
{
    static kOnce = 0;          // Start to end, then stops at the end
    static kPingPong = 1;      // Start to end and back again, over and over
    static kPingPongOnce = 2;  // Start to end and back again, then stops at the start

    static isValid(mode) { return (Number.isInteger(mode) === true && mode >= AnimPlayMode.kOnce && mode <= AnimPlayMode.kPingPongOnce); }
}

// What an AnimPlayer reports to its event callback (see AnimPlayer.setEventCallback())
class AnimEvent
{
    static kCompleted = 0; // A kOnce / kPingPongOnce play finished
    static kTurned = 1;    // A ping-pong reached an end and turned around
}
