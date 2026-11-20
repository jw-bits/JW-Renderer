"use strict";
class MathUtil
{
    static isPowerOfTwo(x)
    {
        if (Number.isInteger(x) === false)
            return false;
        else if (x <= 0)
            return false; // Only check positive numbers
        else
            return ((x & (x - 1)) === 0);
    }

    static degToRad(d)
    {
        return d * (Math.PI / 180.0);
    }

    static randomFloat(minF, maxF)
    {
        let r = Math.random();
        let f = (r * (maxF - minF)) + minF;
            return f;
    }

    static lerp(a, b, t)
    {
        return a + ((b - a) * t);
    }

    // The vector lerps write into out and return it, so nothing new is created
    static lerpVector2(out, a, b, t)
    {
        out.x = a.x + ((b.x - a.x) * t);
        out.y = a.y + ((b.y - a.y) * t);
            return out;
    }

    static lerpVector3(out, a, b, t)
    {
        out.x = a.x + ((b.x - a.x) * t);
        out.y = a.y + ((b.y - a.y) * t);
        out.z = a.z + ((b.z - a.z) * t);
            return out;
    }

    static lerpVector4(out, a, b, t)
    {
        out.x = a.x + ((b.x - a.x) * t);
        out.y = a.y + ((b.y - a.y) * t);
        out.z = a.z + ((b.z - a.z) * t);
        out.w = a.w + ((b.w - a.w) * t);
            return out;
    }
}

/*
    Range - An inclusive min / max of numbers.

    Usage:
        let r = new Range(0, 10);
        r.inside(5);   // true
        r.inside(10);  // true (inclusive)
*/
class Range
{
    #min;
    #max;

    constructor(_min = 0.0, _max = 0.0)
    {
        this.#min = 0.0;
        this.#max = 0.0;

        this.set(_min, _max);
    }

    getMin() { return this.#min; }
    getMax() { return this.#max; }

    // Returns false (and keeps the old range) if min > max
    set(_min, _max)
    {
        if (_min > _max)
        {
            console.error("Range.set(): min must be <= max");
                return false;
        }

        this.#min = _min;
        this.#max = _max;
            return true;
    }

    setMin(_min)
    {
        if (_min > this.#max)
        {
            console.error("Range.setMin(): min must be <= max");
                return false;
        }

        this.#min = _min;
            return true;
    }

    setMax(_max)
    {
        if (this.#min > _max)
        {
            console.error("Range.setMax(): max must be >= min");
                return false;
        }

        this.#max = _max;
            return true;
    }

    inside(val) { return (val >= this.#min && val <= this.#max); }

    // A random number from min to max
    random()
    {
        const r = Math.random();
        const f = this.#min + ((this.#max - this.#min) * r);

        return f;
    }

    // A random whole number from min to max.    
    randomInt()
    {
        const lo = Math.ceil(this.#min);
        const hi = Math.floor(this.#max);

        return lo + Math.floor(Math.random() * (hi - lo + 1));
    }
}

/*
    Interpolator - Moves linearly from A to B over a duration (in seconds).
    A and B are a number, Vector2, Vector3 or Vector4 (both the same type).

    Usage:
        let fade = new Interpolator(0.0, 1.0, 0.5);

        // Each frame
        fade.update(dt);
        alpha = fade.getValue();

        if (fade.isFinished() === true) ...

    The interpolator keeps its own copies of vectors, and getValue() returns
    the same vector every time (updated in place); treat it as read-only and
    copy it if you need to keep it.
*/
class Interpolator
{
    #a;
    #b;
    #value;
    #componentCount; // 1 for a number, 2 - 4 for a vector

    #curTime;
    #duration;

    #isFinished;

    // With no arguments it starts finished; call init() to start it
    constructor(_a = null, _b = null, _duration = 0.0)
    {
        this.#a = 0.0;
        this.#b = 0.0;
        this.#value = 0.0;
        this.#componentCount = 1;
        this.#curTime = 0.0;
        this.#duration = 0.0;
        this.#isFinished = true;

        if (_a !== null)
            this.#start(_a, _b, _duration);
    }

    // Interpolates from A to B. Returns false (and changes nothing) if duration <= 0 or the types don't match.
    init(_a, _b, _duration)
    {
        return this.#start(_a, _b, _duration);
    }

    update(dt)
    {
        if (this.#isFinished === true)
            return;

        this.#curTime += dt;

        let t = 1.0;

        if (this.#curTime >= this.#duration)
            this.#isFinished = true;
        else
            t = this._ease(this.#curTime / this.#duration);

        switch (this.#componentCount)
        {
            case 1: this.#value = MathUtil.lerp(this.#a, this.#b, t); break;
            case 2: MathUtil.lerpVector2(this.#value, this.#a, this.#b, t); break;
            case 3: MathUtil.lerpVector3(this.#value, this.#a, this.#b, t); break;
            case 4: MathUtil.lerpVector4(this.#value, this.#a, this.#b, t); break;
        }
    }

    getA() { return this.#a; }
    getB() { return this.#b; }
    getValue() { return this.#value; }
    getDuration() { return this.#duration; }
    isFinished() { return this.#isFinished; }

    // *** Subclass Methods ***

    // Maps linear progress t (0 - 1) to the lerp amount; Easing overrides it
    _ease(t) { return t; }

    // *** Internal Methods ***

    #start(_a, _b, _duration)
    {
        const count = Interpolator.#componentCountOf(_a);

        if (count === 0 || Interpolator.#componentCountOf(_b) !== count)
        {
            console.error("Interpolator.init() needs A and B of the same type (number, Vector2, Vector3 or Vector4)");
                return false;
        }

        if (typeof _duration !== "number" || _duration <= 0.0)
        {
            console.error("Interpolator.init(): duration must be > 0");
                return false;
        }

        this.#componentCount = count;
        this.#a = Interpolator.#copy(_a);
        this.#b = Interpolator.#copy(_b);
        this.#value = Interpolator.#copy(_a);

        this.#curTime = 0.0;
        this.#duration = _duration;
        this.#isFinished = false;
            return true;
    }

    // 1 for a number, 2 - 4 for a vector, 0 for anything else
    static #componentCountOf(v)
    {
        if (typeof v === "number")
            return 1;
        else if (v instanceof Vector2)
            return 2;
        else if (v instanceof Vector3)
            return 3;
        else if (v instanceof Vector4)
            return 4;
        else
            return 0;
    }

    static #copy(v)
    {
        if (v instanceof Vector2)
            return new Vector2(v.x, v.y);
        else if (v instanceof Vector3)
            return new Vector3(v.x, v.y, v.z);
        else if (v instanceof Vector4)
            return new Vector4(v.x, v.y, v.z, v.w);
        else
            return v; // A number
    }
}

/*
    Easing - Moves from A to B over a duration (in seconds) along an easing
    curve. Works like Interpolator (same values, same getters).

    Usage:
        let slide = new Easing(startPos, endPos, 0.3, Easing.kCubicOut);

        // Each frame
        slide.update(dt);
        rect.setPos(slide.getValue().x, slide.getValue().y);

    Easing.ease(type, t) maps progress (0 - 1) on its own, without an Easing object.
*/
class Easing extends Interpolator
{
    #easingType;

    // With no arguments it starts finished; call init() to start it
    constructor(_a = null, _b = null, _duration = 0.0, _easingType = Easing.kQuadraticInOut)
    {
        super();

        this.#easingType = Easing.kQuadraticInOut;

        if (_a !== null)
            this.init(_a, _b, _duration, _easingType);
    }

    // Eases from A to B. Returns false (and changes nothing) if the arguments aren't valid.
    init(_a, _b, _duration, _easingType)
    {
        if (Easing.isValid(_easingType) === false)
        {
            console.error("Easing.init() needs an easing type such as Easing.kQuadraticIn");
                return false;
        }

        if (super.init(_a, _b, _duration) === false)
            return false;

        this.#easingType = _easingType;
            return true;
    }

    getEasingType() { return this.#easingType; }

    // True for one of the easing types below (Easing.kQuadraticIn - Easing.kBounceOut)
    static isValid(easingType)
    {
        return (Number.isInteger(easingType) === true && easingType >= Easing.kQuadraticIn && easingType <= Easing.kBounceOut);
    }

    /*
        Maps progress t (0 - 1) along an easing curve. Every curve gives 0 at
        t = 0 and 1 at t = 1; Back and Elastic go outside 0 - 1 in between
        (they overshoot), the others don't.
    */
    static ease(easingType, t)
    {
        switch (easingType)
        {
            case Easing.kLinear:
                return t;

            case Easing.kQuadraticIn:
                return t * t;

            case Easing.kQuadraticOut:
                return t * (2.0 - t);

            case Easing.kQuadraticInOut:
            {
                let t2 = t * 2.0;

                if (t2 < 1.0)
                    return 0.5 * (t2 * t2);

                t2 -= 1.0;
                    return -0.5 * ((t2 * (t2 - 2.0)) - 1.0);
            }

            case Easing.kCubicIn:
                return t * t * t;

            case Easing.kCubicOut:
            {
                const t1 = t - 1.0;
                    return (t1 * t1 * t1) + 1.0;
            }

            case Easing.kCubicInOut:
            {
                let t2 = t * 2.0;

                if (t2 < 1.0)
                    return 0.5 * (t2 * t2 * t2);

                t2 -= 2.0;
                    return 0.5 * ((t2 * t2 * t2) + 2.0);
            }

            // Sine: a gentler start / stop than quadratic
            case Easing.kSineIn:
                return 1.0 - Math.cos(t * Math.PI * 0.5);

            case Easing.kSineOut:
                return Math.sin(t * Math.PI * 0.5);

            case Easing.kSineInOut:
                return -0.5 * (Math.cos(t * Math.PI) - 1.0);

            // Back: pulls back before starting (In), or overshoots and settles (Out)
            case Easing.kBackIn:
                return (Easing.#kBackC3 * t * t * t) - (Easing.#kBackC1 * t * t);

            case Easing.kBackOut:
            {
                const t1 = t - 1.0;
                    return 1.0 + (Easing.#kBackC3 * t1 * t1 * t1) + (Easing.#kBackC1 * t1 * t1);
            }

            case Easing.kBackInOut:
            {
                const c2 = Easing.#kBackC1 * 1.525;
                const t2 = t * 2.0;

                if (t2 < 1.0)
                    return 0.5 * (t2 * t2 * (((c2 + 1.0) * t2) - c2));

                const t3 = t2 - 2.0;
                    return 0.5 * ((t3 * t3 * (((c2 + 1.0) * t3) + c2)) + 2.0);
            }

            // Elastic: overshoots the end and wobbles to a stop, like a spring
            case Easing.kElasticOut:
            {
                if (t <= 0.0 || t >= 1.0)
                    return (t <= 0.0) ? 0.0 : 1.0;

                return (Math.pow(2.0, -10.0 * t) * Math.sin(((10.0 * t) - 0.75) * Easing.#kElasticC4)) + 1.0;
            }

            // Bounce: bounces off the end like a dropped ball
            case Easing.kBounceOut:
                return Easing.#bounceOut(t);

            default:
                return t;
        }
    }

    // *** Subclass Methods ***

    _ease(t) { return Easing.ease(this.#easingType, t); }

    // *** Internal Methods ***

    // Four parabolas, each lower than the last, landing on 1 at t = 1
    static #bounceOut(t)
    {
        const n1 = 7.5625;
        const d1 = 2.75;

        if (t < 1.0 / d1)
            return n1 * t * t;

        if (t < 2.0 / d1)
        {
            const t1 = t - (1.5 / d1);
                return (n1 * t1 * t1) + 0.75;
        }

        if (t < 2.5 / d1)
        {
            const t1 = t - (2.25 / d1);
                return (n1 * t1 * t1) + 0.9375;
        }

        const t1 = t - (2.625 / d1);
            return (n1 * t1 * t1) + 0.984375;
    }

    // *** Static Vars ***

    static #kBackC1 = 1.70158;                // How far Back overshoots (about 10%)
    static #kBackC3 = Easing.#kBackC1 + 1.0;
    static #kElasticC4 = (2.0 * Math.PI) / 3.0;   // Elastic Out wobble period

    // Easing types; the first six keep their original values
    static kQuadraticIn = 0;
    static kQuadraticOut = 1;
    static kQuadraticInOut = 2;
    static kCubicIn = 3;
    static kCubicOut = 4;
    static kCubicInOut = 5;
    static kLinear = 6;
    static kSineIn = 7;
    static kSineOut = 8;
    static kSineInOut = 9;
    static kBackIn = 10;
    static kBackOut = 11;
    static kBackInOut = 12;
    static kElasticOut = 13;
    static kBounceOut = 14;

    static
    {
        for (const name of ["kQuadraticIn", "kQuadraticOut", "kQuadraticInOut", "kCubicIn", "kCubicOut", "kCubicInOut",
                            "kLinear", "kSineIn", "kSineOut", "kSineInOut", "kBackIn", "kBackOut", "kBackInOut",
                            "kElasticOut", "kBounceOut"])
            Object.defineProperty(Easing, name, { writable: false, configurable: false });
    }
}

/*
    Oscillator - Moves a value back and forth: A to B, then B to A, and so
    on, until stopped. Each direction takes duration seconds, either linear
    (init) or along an easing curve (initEasing). A and B are a number,
    Vector2, Vector3 or Vector4 (both the same type).

    Usage:
        let pulse = new Oscillator();
        pulse.initEasing(1.0, 1.3, 0.4, Easing.kQuadraticInOut);
        pulse.start();

        // Each frame
        pulse.update(dt);
        rect.setScale(pulse.getValue());

    getValue() returns the same vector every time (updated in place); treat
    it as read-only and copy it if you need to keep it.
*/
class Oscillator
{
    static #kStopped = 0;
    static #kPlaying = 1;
    static #kPaused = 2;

    #interpolator; // An Interpolator or Easing, created by init() / initEasing()
    #a;            // The original A and B, to go back to on stop()
    #b;
    #isReversed;   // True while running from B back to A
    #state;

    // Call init() or initEasing() before start()
    constructor()
    {
        this.#interpolator = null;
        this.#a = null;
        this.#b = null;
        this.#isReversed = false;
        this.#state = Oscillator.#kStopped;
    }

    /*
        Linear, A to B and back. The value starts at A, stopped until start().
        Returns false (and changes nothing) if duration <= 0 or the types don't match.
    */
    init(_a, _b, _duration)
    {
        let interpolator = new Interpolator();

        if (interpolator.init(_a, _b, _duration) === false)
            return false;

        this.#setInterpolator(interpolator);
            return true;
    }

    // Like init(), along an easing curve such as Easing.kQuadraticInOut
    initEasing(_a, _b, _duration, _easingType)
    {
        let easing = new Easing();

        if (easing.init(_a, _b, _duration, _easingType) === false)
            return false;

        this.#setInterpolator(easing);
            return true;
    }

    // Starts, or resumes after pause(). Returns false if init() hasn't succeeded.
    start()
    {
        if (this.#interpolator === null)
        {
            console.error("Oscillator.start(): call init() first");
                return false;
        }

        this.#state = Oscillator.#kPlaying;
            return true;
    }

    // Holds the current value; start() carries on from here
    pause()
    {
        if (this.#state === Oscillator.#kPlaying)
            this.#state = Oscillator.#kPaused;
    }

    // Stops, and goes back to A, running toward B
    stop()
    {
        if (this.#interpolator === null)
            return;

        this.#state = Oscillator.#kStopped;
        this.#restart(false);
    }

    update(dt)
    {
        if (this.#state !== Oscillator.#kPlaying)
            return;

        this.#interpolator.update(dt);

        if (this.#interpolator.isFinished() === true)
            this.#restart(!this.#isReversed); // Reached an end; turn around
    }

    getValue() { return this.#interpolator?.getValue() ?? null; }
    getDuration() { return this.#interpolator?.getDuration() ?? 0.0; }

    isPlaying() { return (this.#state === Oscillator.#kPlaying); }
    isPaused() { return (this.#state === Oscillator.#kPaused); }
    isStopped() { return (this.#state === Oscillator.#kStopped); }
    isReversed() { return this.#isReversed; }

    // *** Internal Methods ***

    // Uses a freshly set up Interpolator or Easing, stopped at A
    #setInterpolator(interpolator)
    {
        this.#interpolator = interpolator;
        this.#a = interpolator.getA(); // Its own copies; re-init replaces them rather than changing them
        this.#b = interpolator.getB();
        this.#isReversed = false;
        this.#state = Oscillator.#kStopped;
    }

    // Re-inits the Interpolator to run A to B, or B to A if reversed
    #restart(reversed)
    {
        const from = (reversed === true) ? this.#b : this.#a;
        const to = (reversed === true) ? this.#a : this.#b;
        const duration = this.#interpolator.getDuration();

        if (this.#interpolator instanceof Easing)
            this.#interpolator.init(from, to, duration, this.#interpolator.getEasingType());
        else
            this.#interpolator.init(from, to, duration);

        this.#isReversed = reversed;
    }
}
