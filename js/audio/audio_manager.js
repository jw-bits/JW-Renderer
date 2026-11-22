"use strict";

/*
    AudioManager - Plays short sound effects and music through the Web Audio API.

    One AudioContext with three gain nodes:

        AudioInstance -> [instance gain] -> sfx gain   -> master gain -> speakers
        AudioInstance -> [instance gain] -> music gain -> master gain -> speakers

    Sounds are loaded by name into AudioClips (see audio_defines.js). Every
    name is unique across sfx and music. A clip is either:
        - decoded:  the whole file is decoded into memory when loaded, so it starts
                    instantly. The default for sfx.
        - streamed: played through an <audio> element, which downloads and decodes
                    as it plays, so a long track doesn't sit in memory. The default
                    for music. Pages opened from file:// can't stream through Web
                    Audio (the browser silences it), so there it's decoded instead.

    play() starts an AudioInstance (see audio_defines.js) and returns its id.
    Each instance has its own volume and pitch, set when it's played and
    changeable while it plays. Pitch is a playback rate: 2 is an octave up and
    twice as fast, 0.5 an octave down and half as fast.

    Browsers keep the AudioContext suspended until the user interacts with the
    page (a tap, click or key press). AudioManager resumes it on the first one,
    so nothing can play before then: autoPlay is skipped with a console.warn,
    and play() fails. canPlay() says whether sound can play right now.
    While the page is hidden (another tab, the phone's home screen) everything
    is paused, and it carries on when the page is shown again.

    Usage:
        AudioManager.init();
        await AudioManager.loadSFX("jump", "./audio/jump.mp3");
        await AudioManager.loadMusic("theme", "./audio/theme.mp3", true, true, true);

        AudioManager.play("jump", 0.8, MathUtil.randomFloat(0.9, 1.1));

        const id = AudioManager.play("engine", 1.0, 1.0);
        AudioManager.setInstancePitch(id, 1.5);
        AudioManager.stop(id);

        AudioManager.stopName("jump"); // Every instance of "jump"

        AudioManager.setMusicVolume(0.5);
*/
class AudioManager
{
    static kNoInstance = AudioInstance.kNoId; // play() failed; never a real instance id

    static #kMinPitch = 0.0625; // The range <audio> elements accept
    static #kMaxPitch = 16.0;
    static #kStreamLoadTimeout = 5.0 * MathDefines.kMsPerSecond; // Milliseconds; see #waitForMedia()

    static #context = null;
    static #masterGain = null;
    static #sfxGain = null;
    static #musicGain = null;

    static #clips = new Map();      // Name -> AudioClip
    static #playing = new Map();    // Id -> playing AudioInstance
    static #nextInstanceId = 1;

    static #domHandlers = [];       // [target, type, handler], to remove in shutdown()
    static #pausedByPage = false;   // Context suspended because the page was hidden

    static #masterVolume = 1.0;
    static #sfxVolume = 1.0;
    static #musicVolume = 1.0;

    // Creates the AudioContext and gain nodes. Returns false if already initialized or Web Audio isn't available.
    static init()
    {
        if (AudioManager.#context !== null)
            return false; // Already initialized

        const ContextClass = window.AudioContext ?? window.webkitAudioContext;

        if (ContextClass === undefined)
        {
            console.error("AudioManager.init(): this browser doesn't support the Web Audio API");
                return false;
        }

        try
        {
            AudioManager.#context = new ContextClass();
        }
        catch (err)
        {
            console.error("AudioManager.init() couldn't create an AudioContext", err);
                return false;
        }

        const ctx = AudioManager.#context;

        AudioManager.#masterGain = ctx.createGain();
        AudioManager.#sfxGain = ctx.createGain();
        AudioManager.#musicGain = ctx.createGain();

        AudioManager.#masterGain.gain.value = AudioManager.#masterVolume;
        AudioManager.#sfxGain.gain.value = AudioManager.#sfxVolume;
        AudioManager.#musicGain.gain.value = AudioManager.#musicVolume;

        AudioManager.#sfxGain.connect(AudioManager.#masterGain);
        AudioManager.#musicGain.connect(AudioManager.#masterGain);
        AudioManager.#masterGain.connect(ctx.destination);

        const add = (t, type, handler) => {
            t.addEventListener(type, handler, true);
            AudioManager.#domHandlers.push([t, type, handler]);
        };

        // Resume on user interaction. Kept for the whole session, since phones can
        // suspend the context again (a call, another app taking the audio).
        // touchend / pointerup as well as the down events, because iOS only counts some of them.
        const unlock = () => AudioManager.#resume();

        add(window, "pointerdown", unlock);
        add(window, "pointerup", unlock);
        add(window, "touchend", unlock);
        add(window, "keydown", unlock);

        add(document, "visibilitychange", () => AudioManager.#onVisibilityChange());
            return true;
    }

    // Stops everything, forgets all sounds and closes the AudioContext
    static shutdown()
    {
        if (AudioManager.#context === null)
            return;

        for (const name of Array.from(AudioManager.#clips.keys()))
            AudioManager.unload(name);

        for (const [t, type, handler] of AudioManager.#domHandlers)
            t.removeEventListener(type, handler, true);

        AudioManager.#domHandlers = [];
        AudioManager.#context.close().catch(() => {});
        AudioManager.#context = null;
        AudioManager.#masterGain = null;
        AudioManager.#sfxGain = null;
        AudioManager.#musicGain = null;
        AudioManager.#pausedByPage = false;
    }

    // True when sound can play right now (the user has interacted and the page is shown)
    static canPlay()
    {
        return (AudioManager.#context !== null && AudioManager.#context.state === "running");
    }

    /*
        Loads a sound effect. Resolves to true once it's ready to play (and
        started, if autoPlay and the context can play), or false on failure.
            name             Key used by play() / stopName()
            url              File to load
            loop             Loop until stopped
            singleInstance   Only one instance plays at a time: play() stops the current one, then starts the new one
            autoPlay         Play once loaded; skipped with a console.warn if canPlay() is false
            stream           Stream instead of decoding into memory (see the top of this file)
    */
    static loadSFX(name, url, loop = false, singleInstance = false, autoPlay = false, stream = false)
    {
        return AudioManager.#load("loadSFX", AudioManager.#sfxGain, name, url, loop, singleInstance, autoPlay, stream);
    }

    // Loads music. Same as loadSFX(), but plays through the music volume and streams by default.
    static loadMusic(name, url, loop = true, singleInstance = true, autoPlay = false, stream = true)
    {
        return AudioManager.#load("loadMusic", AudioManager.#musicGain, name, url, loop, singleInstance, autoPlay, stream);
    }

    static isLoaded(name)
    {
        return (AudioManager.#clips.get(name)?.isReady === true);
    }

    // True while any instance of the sound is playing
    static isPlaying(name)
    {
        return (AudioManager.#clips.get(name)?.isPlaying() === true);
    }

    // Length in seconds, or -1 if the sound isn't loaded or its length isn't known yet
    static getDuration(name)
    {
        return AudioManager.#clips.get(name)?.getDuration() ?? -1.0;
    }

    /*
        Starts a new instance of a loaded sound and returns its id, or
        AudioManager.kNoInstance (0) if the sound isn't loaded or can't play
        yet (see canPlay()). For a singleInstance clip, any instance already
        playing is stopped first.
            volume  0..1, this instance only
            pitch   Playback rate, 0.0625..16 (1 is normal)
    */
    static play(name, volume = 1.0, pitch = 1.0)
    {
        const clip = AudioManager.#clips.get(name);

        if (clip === undefined)
        {
            console.error(`AudioManager.play(): no sound named "${name}"`);
                return AudioManager.kNoInstance;
        }

        if (clip.isReady === false)
            return AudioManager.kNoInstance; // Still loading

        if (AudioManager.canPlay() === false)
            return AudioManager.kNoInstance; // Would start late, all at once, when the context resumes

        if (clip.singleInstance === true)
            AudioManager.stopName(name); // The new play replaces the one already playing

        const v = AudioManager.#toVolume(volume, 1.0);
        const p = AudioManager.#toPitch(pitch, 1.0);
        const audioInstance = clip.isStreamed ? AudioManager.#startStreamed(clip, v, p) : AudioManager.#startDecoded(clip, v, p);
            return (audioInstance !== null ? audioInstance.id : AudioManager.kNoInstance);
    }

    // True while the instance is playing (it hasn't ended or been stopped)
    static isInstancePlaying(id)
    {
        return AudioManager.#playing.has(id);
    }

    // Returns false if the instance has ended or been stopped
    static setInstanceVolume(id, volume)
    {
        const audioInstance = AudioManager.#playing.get(id);

        if (audioInstance === undefined)
            return false;

        audioInstance.setVolume(AudioManager.#toVolume(volume, audioInstance.volume));
            return true;
    }

    // Returns false if the instance has ended or been stopped
    static setInstancePitch(id, pitch)
    {
        const audioInstance = AudioManager.#playing.get(id);

        if (audioInstance === undefined)
            return false;

        audioInstance.setPitch(AudioManager.#toPitch(pitch, audioInstance.pitch));
            return true;
    }

    // The instance's volume / pitch, or -1 if it has ended or been stopped
    static getInstanceVolume(id) { return AudioManager.#playing.get(id)?.volume ?? -1.0; }
    static getInstancePitch(id) { return AudioManager.#playing.get(id)?.pitch ?? -1.0; }

    // Stops one instance, by the id play() returned. Does nothing if it has already ended.
    static stop(id)
    {
        if (typeof id === "string")
        {
            console.error(`AudioManager.stop() takes an instance id; use stopName("${id}") to stop a sound by name`);
                return;
        }

        const audioInstance = AudioManager.#playing.get(id);

        if (audioInstance !== undefined)
            AudioManager.#endInstance(audioInstance);
    }

    // Stops every playing instance of a sound
    static stopName(name)
    {
        const clip = AudioManager.#clips.get(name);

        if (clip === undefined)
            return;

        for (const audioInstance of Array.from(clip.playing))
            AudioManager.#endInstance(audioInstance);
    }

    // Stops every playing sound, sfx and music
    static stopAll()
    {
        for (const audioInstance of Array.from(AudioManager.#playing.values()))
            AudioManager.#endInstance(audioInstance);
    }

    // Stops a sound and forgets it, so its name can be loaded again
    static unload(name)
    {
        const clip = AudioManager.#clips.get(name);

        if (clip === undefined)
            return;

        AudioManager.#clips.delete(name); // First, so ending instances aren't kept for reuse
        AudioManager.stopName(name);

        for (const audioInstance of clip.idle)
            AudioManager.#releaseStreamed(audioInstance);

        clip.idle.length = 0;
        clip.buffer = null;
        clip.isReady = false;
    }

    // Volumes are 0..1 and can be set before init()
    static setMasterVolume(volume) { AudioManager.#masterVolume = AudioManager.#setBusVolume(AudioManager.#masterGain, volume, AudioManager.#masterVolume); }
    static setSFXVolume(volume) { AudioManager.#sfxVolume = AudioManager.#setBusVolume(AudioManager.#sfxGain, volume, AudioManager.#sfxVolume); }
    static setMusicVolume(volume) { AudioManager.#musicVolume = AudioManager.#setBusVolume(AudioManager.#musicGain, volume, AudioManager.#musicVolume); }

    static getMasterVolume() { return AudioManager.#masterVolume; }
    static getSFXVolume() { return AudioManager.#sfxVolume; }
    static getMusicVolume() { return AudioManager.#musicVolume; }

    // *** Internal Methods ***

    // method names the caller in messages; bus is the gain node the sound plays through
    static async #load(method, bus, name, url, loop, singleInstance, autoPlay, stream)
    {
        if (AudioManager.#context === null)
        {
            console.error(`AudioManager.${method}(): call AudioManager.init() first`);
                return false;
        }

        if (typeof name !== "string" || name.length === 0 || typeof url !== "string" || url.length === 0)
        {
            console.error(`AudioManager.${method}() needs a name and a url`);
                return false;
        }

        if (AudioManager.#clips.has(name))
        {
            console.error(`AudioManager.${method}(): a sound named "${name}" is already loaded`);
                return false;
        }

        if (stream === true && window.location.protocol === "file:")
        {
            console.warn(`AudioManager: "${name}" is decoded instead of streamed; pages opened from file:// can't stream through Web Audio`);
            stream = false;
        }

        const clip = new AudioClip(name, url, bus, (stream === true), (loop === true), (singleInstance === true));

        AudioManager.#clips.set(name, clip); // Stored before loading, so the name is taken

        let first = null; // Streamed: the AudioInstance whose element loads the file

        try
        {
            if (clip.isStreamed)
            {
                first = AudioManager.#createStreamed(clip);
                await AudioManager.#waitForMedia(first.element);
            }
            else
            {
                const bytes = await AudioManager.#loadBytes(url);
                clip.buffer = await AudioManager.#context.decodeAudioData(bytes);
            }
        }
        catch (err)
        {
            if (first !== null)
                AudioManager.#releaseStreamed(first);

            if (AudioManager.#clips.get(name) === clip)
                AudioManager.#clips.delete(name); // Don't keep failed sounds; a later load tries again

            console.error(`AudioManager couldn't load ${url}`, err);
                return false;
        }

        if (AudioManager.#clips.get(name) !== clip)
        {
            // Unloaded (or shut down) while loading
            if (first !== null)
                AudioManager.#releaseStreamed(first);

            return false;
        }

        if (first !== null)
            clip.idle.push(first); // The first play() uses it

        clip.isReady = true;

        if (autoPlay === true)
        {
            if (AudioManager.canPlay() === false)
                console.warn(`AudioManager: "${name}" wasn't auto-played; audio can't play until the user interacts with the page`);
            else
                AudioManager.play(name);
        }

        return true;
    }

    // XMLHttpRequest rather than fetch(), because fetch() rejects file:// URLs
    static #loadBytes(url)
    {
        return new Promise((resolve, reject) => {
            let xhr = new XMLHttpRequest();
            xhr.open("GET", url);
            xhr.responseType = "arraybuffer";

            xhr.onload = () => {
                // file:// requests report status 0 on success
                if ((xhr.status === 200 || xhr.status === 0) && xhr.response !== null && xhr.response.byteLength > 0)
                    resolve(xhr.response);
                else
                    reject(new Error(`HTTP ${xhr.status}`));
            };

            xhr.onerror = () => reject(new Error("Network error"));
            xhr.send();
        });
    }

    /*
        Resolves once a streamed file's header has loaded, and rejects if it
        can't be loaded. iOS doesn't download media before the first play, so
        after a timeout this resolves anyway and the file loads when played.
    */
    static #waitForMedia(element)
    {
        return new Promise((resolve, reject) => {
            let timer = 0;

            const finish = (err) => {
                clearTimeout(timer);
                element.removeEventListener("loadedmetadata", onReady);
                element.removeEventListener("canplay", onReady);
                element.removeEventListener("error", onError);

                if (err === null)
                    resolve();
                else
                    reject(err);
            };

            const onReady = () => finish(null);
            const onError = () => finish(new Error(element.error?.message || `Media error ${element.error?.code ?? ""}`));

            if (element.readyState >= HTMLMediaElement.HAVE_METADATA)
            {
                resolve();
                return;
            }

            element.addEventListener("loadedmetadata", onReady);
            element.addEventListener("canplay", onReady);
            element.addEventListener("error", onError);
            timer = setTimeout(onReady, AudioManager.#kStreamLoadTimeout);
        });
    }

    // A new streamed AudioInstance: an <audio> element wired into the graph. Throws on failure.
    static #createStreamed(clip)
    {
        const element = new Audio();
        element.crossOrigin = "anonymous"; // Before src: without CORS, Web Audio only gets silence
        element.preload = "auto";
        element.preservesPitch = false;    // So playbackRate changes pitch, as it does for decoded sounds
        element.mozPreservesPitch = false;
        element.webkitPreservesPitch = false;
        element.src = clip.url;

        const ctx = AudioManager.#context;
        const source = ctx.createMediaElementSource(element);
        const gain = ctx.createGain();

        source.connect(gain);
        gain.connect(clip.bus);
            return new AudioInstance(clip, source, gain, element);
    }

    // Frees a streamed AudioInstance that's no longer needed
    static #releaseStreamed(audioInstance)
    {
        const element = audioInstance.element;
        element.onended = null;
        element.pause();
        element.removeAttribute("src");
        element.load(); // Lets the browser drop the download
        audioInstance.source.disconnect();
        audioInstance.gain.disconnect();
    }

    static #startDecoded(clip, volume, pitch)
    {
        const ctx = AudioManager.#context;
        const source = ctx.createBufferSource();
        const gain = ctx.createGain();

        source.buffer = clip.buffer;
        source.loop = clip.loop;
        source.connect(gain);
        gain.connect(clip.bus);

        const audioInstance = new AudioInstance(clip, source, gain);
        audioInstance.setVolume(volume);
        audioInstance.setPitch(pitch);
        AudioManager.#addPlaying(audioInstance);

        source.onended = () => AudioManager.#endInstance(audioInstance);
        source.start();
            return audioInstance;
    }

    static #startStreamed(clip, volume, pitch)
    {
        let audioInstance = clip.idle.pop() ?? null;

        if (audioInstance === null)
        {
            try
            {
                audioInstance = AudioManager.#createStreamed(clip);
            }
            catch (err)
            {
                console.error(`AudioManager couldn't play "${clip.name}"`, err);
                    return null;
            }
        }

        const element = audioInstance.element;
        element.loop = clip.loop;
        element.currentTime = 0;
        audioInstance.setVolume(volume);
        audioInstance.setPitch(pitch);
        AudioManager.#addPlaying(audioInstance);

        const id = audioInstance.id; // The instance is reused, so check its id is still this play's
        element.onended = () => AudioManager.#endInstance(audioInstance);
        element.play().catch((err) => {
            // Stopping right after playing also rejects (AbortError); that play has already ended
            if (audioInstance.id === id && err?.name !== "AbortError")
            {
                console.warn(`AudioManager couldn't play "${clip.name}"`, err);
                AudioManager.#endInstance(audioInstance);
            }
        });

        return audioInstance;
    }

    static #addPlaying(audioInstance)
    {
        audioInstance.id = AudioManager.#nextInstanceId++;
        AudioManager.#playing.set(audioInstance.id, audioInstance);
        audioInstance.clip.playing.add(audioInstance);
    }

    // Safe to call twice: stopping ends an instance at once, and its ended event may fire later
    static #endInstance(audioInstance)
    {
        if (audioInstance.isPlaying() === false)
            return;

        const clip = audioInstance.clip;
        AudioManager.#playing.delete(audioInstance.id);
        clip.playing.delete(audioInstance);
        audioInstance.id = AudioInstance.kNoId;
        audioInstance.pausedByPage = false;

        if (audioInstance.isStreamed())
        {
            audioInstance.element.onended = null;
            audioInstance.element.pause();

            if (AudioManager.#clips.get(clip.name) === clip)
                clip.idle.push(audioInstance); // Kept for the next play()
            else
                AudioManager.#releaseStreamed(audioInstance); // Unloaded
        }
        else
        {
            const source = audioInstance.source;
            source.onended = null;
            try { source.stop(); } catch {} // Throws if it already ended
            source.disconnect();
            audioInstance.gain.disconnect();
        }
    }

    // value clamped to 0..1, or fallback (with a console.error) if it isn't a number
    static #toVolume(value, fallback)
    {
        if (typeof value !== "number" || Number.isFinite(value) === false)
        {
            console.error("AudioManager volumes need a number from 0 to 1");
                return fallback;
        }

        return MathUtil.clamp01(value);
    }

    // value clamped to the pitch range, or fallback (with a console.error) if it isn't a number
    static #toPitch(value, fallback)
    {
        if (typeof value !== "number" || Number.isFinite(value) === false)
        {
            console.error(`AudioManager pitches need a number from ${AudioManager.#kMinPitch} to ${AudioManager.#kMaxPitch}`);
                return fallback;
        }

        return Math.min(Math.max(value, AudioManager.#kMinPitch), AudioManager.#kMaxPitch);
    }

    // Applies a bus volume to gainNode if there is one (there isn't before init()), and returns it
    static #setBusVolume(gainNode, volume, current)
    {
        const v = AudioManager.#toVolume(volume, current);

        if (gainNode !== null)
            gainNode.gain.value = v;

        return v;
    }

    static #resume()
    {
        const ctx = AudioManager.#context;

        if (ctx === null || ctx.state === "running" || ctx.state === "closed" || document.hidden === true)
            return;

        ctx.resume().catch(() => {}); // Rejects if the browser doesn't count this as an interaction yet
    }

    /*
        Hidden: suspend the context, and pause streamed instances too, since
        <audio> elements keep playing (silently) through a suspended context
        and would have skipped ahead when the page comes back.
    */
    static #onVisibilityChange()
    {
        const ctx = AudioManager.#context;

        if (ctx === null || ctx.state === "closed")
            return;

        if (document.hidden === true)
        {
            for (const audioInstance of AudioManager.#playing.values())
            {
                if (audioInstance.isStreamed() && audioInstance.element.paused === false)
                {
                    audioInstance.pausedByPage = true;
                    audioInstance.element.pause();
                }
            }

            if (ctx.state === "running")
            {
                AudioManager.#pausedByPage = true;
                ctx.suspend().catch(() => {});
            }
        }
        else
        {
            if (AudioManager.#pausedByPage === true)
            {
                AudioManager.#pausedByPage = false;
                ctx.resume().catch(() => {});
            }

            for (const audioInstance of AudioManager.#playing.values())
            {
                if (audioInstance.pausedByPage === true)
                {
                    audioInstance.pausedByPage = false;
                    audioInstance.element.play().catch(() => {});
                }
            }
        }
    }
}
