"use strict";

/*
    MotionAction - Moves an Entity's local transform from a start Transform2D
    to a target one, always start to target. Its MotionValues says which
    channels move and each one's duration and easing; the others are left
    to game code or another motion. A Model2D's position is its anchor.

    Usage:
        let timing = new MotionValues({ scale: { duration: 0.2, easing: Easing.kBackOut } });
        let grow = new MotionAction(new Transform2D(0, 0, 0.5), new Transform2D(0, 0, 1.0), timing);

        rect.enableMotion().add("grow", grow);
        rect.getMotion().play("grow");

    The values can also be given as a plain object, which makes one for
    this action alone (see MotionValues):

        let spin = new MotionAction(null, new Transform2D(0, 0, 1, 1, MathDefines.kPi), { rotation: { duration: 0.5 } });

    Rotation goes straight from start to target, without wrapping: from
    2 PI to 0 turns a full circle back.
*/
class MotionAction extends MotionBase
{
    #start;      // Transform2D
    #target;     // Transform2D
    #values;     // MotionValues

    // start and target: Transform2Ds (copied), or null for the identity. values: a MotionValues (shared) or a plain object.
    constructor(_start = null, _target = null, _values = null)
    {
        super();

        this.#start = new Transform2D();
        this.#target = new Transform2D();
        this.#values = new MotionValues();

        if (_start !== null || _target !== null)
            this.set(_start ?? this.#start, _target ?? this.#target);

        if (_values !== null)
            this.setValues(_values);
    }

    // Copies start and target (Transform2Ds). Returns false (and changes nothing) if they aren't.
    set(start, target)
    {
        if ((start instanceof Transform2D) === false || (target instanceof Transform2D) === false)
        {
            console.error("MotionAction.set() needs a start and target Transform2D");
                return false;
        }

        this.#start.copy(start);
        this.#target.copy(target);
            return true;
    }

    getStart() { return this.#start; }   // Read-only; change it with set()
    getTarget() { return this.#target; } // Read-only; change it with set()

    // A MotionValues (shared, not copied) or a plain object for a new one. Returns false (and changes nothing) if it isn't valid.
    setValues(values)
    {
        if (values instanceof MotionValues)
        {
            this.#values = values;
                return true;
        }

        let made = new MotionValues();

        if (made.set(values) === false)
            return false;

        this.#values = made;
            return true;
    }

    getValues() { return this.#values; }

    getDuration() { return this.#values.getDuration(); }
    getChannels() { return this.#values.getChannels(); }

    // Writes the moved channels seconds in into out (a Transform2D) and returns it; other channels are left as they are
    evaluateAt(seconds, out)
    {
        const d = this.#values;
        const channels = d.getChannels();
        const s = this.#start;
        const t = this.#target;

        if ((channels & MotionChannel.kTranslation) !== 0)
        {
            const e = d.getProgress(MotionChannel.kTranslation, seconds);
            out.setPosition(MathUtil.lerp(s.getX(), t.getX(), e), MathUtil.lerp(s.getY(), t.getY(), e));
        }

        if ((channels & MotionChannel.kScale) !== 0)
        {
            const e = d.getProgress(MotionChannel.kScale, seconds);
            out.setScale(MathUtil.lerp(s.getScaleX(), t.getScaleX(), e), MathUtil.lerp(s.getScaleY(), t.getScaleY(), e));
        }

        if ((channels & MotionChannel.kRotation) !== 0)
        {
            const e = d.getProgress(MotionChannel.kRotation, seconds);
            out.setRotation(MathUtil.lerp(s.getRotation(), t.getRotation(), e));
        }

        return out;
    }
}
