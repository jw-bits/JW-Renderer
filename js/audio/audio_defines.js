"use strict";

/*
    Audio types used by AudioManager.
*/

/*
    AudioClip - A loaded sound: AudioManager.loadSFX() / loadMusic() create one
    per name, and every play() of that name starts an AudioInstance of it.

    A decoded clip holds its whole file as an AudioBuffer. A streamed clip has
    no buffer; each of its instances plays the file through an <audio> element.

    AudioManager owns every AudioClip; callers use its name.
*/
class AudioClip
{
    constructor(name, url, bus, isStreamed, loop, singleInstance)
    {
        this.name = name;
        this.url = url;
        this.bus = bus;                       // The gain node it plays through (AudioManager's sfx or music gain)
        this.isStreamed = isStreamed;
        this.loop = loop;
        this.singleInstance = singleInstance; // Only one instance plays at a time

        this.isReady = false;                 // Loaded and playable
        this.buffer = null;                   // Decoded only: the AudioBuffer
        this.playing = new Set();             // AudioInstances playing now
        this.idle = [];                       // Streamed only: AudioInstances not playing, reused by the next play
    }

    isPlaying() { return (this.playing.size > 0); }

    // Length in seconds, or -1 if it isn't known yet (a streamed file before its header loads)
    getDuration()
    {
        if (this.buffer !== null)
            return this.buffer.duration;

        const element = this.idle[0]?.element ?? this.playing.values().next().value?.element ?? null;
        const duration = element?.duration ?? NaN;
            return (Number.isFinite(duration) ? duration : -1.0);
    }
}

/*
    AudioInstance - One playing copy of an AudioClip, wired into AudioManager's
    graph:

        source -> gain (this instance's volume) -> the clip's bus (sfx or music gain)

    source is an AudioBufferSourceNode for a decoded clip, or a
    MediaElementAudioSourceNode for a streamed one (with element, its <audio>).

    AudioManager owns every AudioInstance; callers only see its id. An id is
    set while the instance plays and is kNoId otherwise. Decoded instances are
    used once (a buffer source can only start once). Streamed ones are reused,
    since an <audio> element can only ever be wired up once; each play gives
    them a new id, so an old id never reaches a new play.
*/
class AudioInstance
{
    static kNoId = 0;

    constructor(clip, source, gain, element = null)
    {
        this.id = AudioInstance.kNoId;
        this.clip = clip;         // The AudioClip this plays
        this.source = source;
        this.gain = gain;
        this.element = element;   // Streamed only, else null

        this.volume = 1.0;
        this.pitch = 1.0;
        this.pausedByPage = false; // Streamed: paused while the page is hidden
    }

    isStreamed() { return (this.element !== null); }
    isPlaying() { return (this.id !== AudioInstance.kNoId); }

    // volume 0..1 (AudioManager clamps it)
    setVolume(volume)
    {
        this.volume = volume;
        this.gain.gain.value = volume;
    }

    // Playback rate: changes pitch and speed together (AudioManager clamps it)
    setPitch(pitch)
    {
        this.pitch = pitch;

        if (this.element !== null)
            this.element.playbackRate = pitch;
        else
            this.source.playbackRate.value = pitch;
    }
}
