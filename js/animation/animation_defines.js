"use strict";

/*
    Animation types shared by Sprite and the helpers in animation_util.js.
*/

// How a sequence plays through its frames
class AnimationPlayMode
{
    static kOnce = 0;          // First to last frame, then stops on the last
    static kLoop = 1;          // First to last, over and over
    static kPingPong = 2;      // First to last and back again, over and over
    static kPingPongOnce = 3;  // First to last and back again, then stops on the first
}

// What a Sprite reports to its event callback (see Sprite.setEventCallback())
class AnimationEvent
{
    static kCompleted = 0; // A kOnce / kPingPongOnce sequence finished; the sprite stopped on its final frame
    static kLooped = 1;    // A kLoop / kPingPong sequence started another cycle
}

/*
    AnimationSequence - A named run of frames, each a UVRect of the sprite's
    texture, played over a duration.

    A sequence is only data, so one can be shared by any number of Sprites
    (each keeps its own place in it). Build the frames with AnimationUtil, or
    let Sprite.createSequence() / createSequenceInRect() do it.

        name      Key for Sprite.play()
        frames    Array of UVRects, in play order
        duration  Seconds to play every frame once (kPingPong takes about twice this per cycle)
        playMode  AnimationPlayMode

    Don't change frames while a Sprite is playing the sequence.
*/
class AnimationSequence
{
    constructor(name, frames, duration, playMode = AnimationPlayMode.kLoop)
    {
        this.name = name;
        this.frames = frames;
        this.duration = duration;
        this.playMode = playMode;
    }

    // True if the sequence can be played: a name, at least one frame and a duration above 0
    isValid()
    {
        return (typeof this.name === "string" && this.name.length > 0 &&
                Array.isArray(this.frames) && this.frames.length > 0 &&
                Number.isFinite(this.duration) && this.duration > 0.0);
    }

    getFrameCount() { return this.frames.length; }
    getFrame(index) { return this.frames[index] ?? null; }

    // Seconds each frame is shown
    getFrameDuration() { return this.duration / this.frames.length; }

    isOneShot() { return (this.playMode === AnimationPlayMode.kOnce || this.playMode === AnimationPlayMode.kPingPongOnce); }
    isPingPong() { return (this.playMode === AnimationPlayMode.kPingPong || this.playMode === AnimationPlayMode.kPingPongOnce); }
}
