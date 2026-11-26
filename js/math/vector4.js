class Vector4
{
    constructor(_x = 0.0, _y = 0.0, _z = 0.0, _w = 1.0)
    {
        this.x = _x;
        this.y = _y;
        this.z = _z;
        this.w = _w;
    }

    // Copies vec (a Vector4, or anything with x, y, z and w)
    set(vec)
    {
        this.x = vec.x;
        this.y = vec.y;
        this.z = vec.z;
        this.w = vec.w;
    }

    setXYZW(_x, _y, _z, _w)
    {
        this.x = _x;
        this.y = _y;
        this.z = _z;
        this.w = _w;
    }

    // As setXYZW(), for a color: (r, g, b, a) are stored in (x, y, z, w)
    setRGBA(r, g, b, a)
    {
        this.x = r;
        this.y = g;
        this.z = b;
        this.w = a;
    }

    /*
        Sets x, y, z and w from text. Returns false (with a console.error), leaving
        the vector unchanged, if text isn't four numbers. Valid formats (see
        MathUtil.parseNumberList()):
            "1, 2, 3, 4"   "1 2 3 4"   "(1, 2, 3, 4)"   "[1, 2, 3, 4]"   "{1, 2, 3, 4}"
        For a color in hex or CSS form, use setRGBAFromString().
    */
    setXYZWFromString(text)
    {
        const n = MathUtil.parseNumberList(text);

        if (n === null || n.length !== 4)
        {
            console.error(`Vector4.setXYZWFromString(): "${text}" isn't four numbers, such as "1, 2, 3, 4"`);
                return false;
        }

        this.setXYZW(n[0], n[1], n[2], n[3]);
            return true;
    }

    /*
        Sets the color (r, g, b, a in x, y, z, w) from text, each channel 0 - 1.
        Returns false (with a console.error), leaving it unchanged, if text can't be
        read. Valid formats, tried in this order:
            Hex         "#rgb", "#rgba", "#rrggbb" or "#rrggbbaa"; the '#' is optional
                        and any case works. Each channel is 0 - ff, and a single digit
                        is doubled ("f" = "ff"). Alpha is 1 when left out.
                        Spine's colors are "rrggbbaa" or "rrggbb".
            CSS rgb()   "rgb(255, 128, 0)", "rgba(255, 128, 0, 0.5)" or "rgb(255 128 0 / 0.5)":
                        channels 0 - 255, alpha 0 - 1 (1 when left out)
            Numbers     3 or 4 numbers, 0 - 1, in any MathUtil.parseNumberList() format:
                        "1, 0.5, 0" (alpha 1) or "(1, 0.5, 0, 0.8)"
        Values aren't clamped; call clamp01() for that.
    */
    setRGBAFromString(text)
    {
        if (typeof text !== "string")
        {
            console.error("Vector4.setRGBAFromString() needs a string, such as \"#ff8000\"");
                return false;
        }

        const s = text.trim();

        // Hex
        if (Vector4.#kHex.test(s) === true)
        {
            const h = (s.charAt(0) === "#") ? s.slice(1) : s;
            const digits = (h.length <= 4) ? 1 : 2;
            const count = h.length / digits;
            let c = [1.0, 1.0, 1.0, 1.0];

            for (let i = 0; i < count; ++i)
            {
                const part = h.substr(i * digits, digits);
                c[i] = parseInt((digits === 1) ? part + part : part, 16) / 255;
            }

            this.setRGBA(c[0], c[1], c[2], c[3]);
                return true;
        }

        // CSS rgb() / rgba()
        const css = Vector4.#kCss.exec(s);

        if (css !== null)
        {
            const n = MathUtil.parseNumberList(css[1].replace("/", ","));

            if (n !== null && (n.length === 3 || n.length === 4))
            {
                this.setRGBA(n[0] / 255, n[1] / 255, n[2] / 255, (n.length === 4) ? n[3] : 1.0);
                    return true;
            }
        }
        else
        {
            // 3 or 4 numbers, 0 - 1
            const n = MathUtil.parseNumberList(s);

            if (n !== null && (n.length === 3 || n.length === 4))
            {
                this.setRGBA(n[0], n[1], n[2], (n.length === 4) ? n[3] : 1.0);
                    return true;
            }
        }

        console.error(`Vector4.setRGBAFromString(): "${text}" isn't a color, such as "#ff8000", "rgb(255, 128, 0)" or "1, 0.5, 0"`);
            return false;
    }

    // Holds each component between 0 and 1 (for a color: animation curves can overshoot)
    clamp01()
    {
        this.x = MathUtil.clamp01(this.x);
        this.y = MathUtil.clamp01(this.y);
        this.z = MathUtil.clamp01(this.z);
        this.w = MathUtil.clamp01(this.w);
    }

    saturate()
    {
        let m = this.x;

        if (this.y > m)
            m = this.y;

        if (this.z > m)
            m = this.z;

        if (this.w > m)
            m = this.w;

        this.x /= m;
        this.y /= m;
        this.z /= m;
        this.w /= m;
    }

    R() { return this.x; }
    G() { return this.y; }
    B() { return this.z; }
    A() { return this.w; }

    // Methods
    dot(vec)
    {
        return ((this.x * vec.x) + (this.y * vec.y) + (this.z * vec.z) + (this.w * vec.w));
    }

    add(vec)
    {
        this.x += vec.x;
        this.y += vec.y;
        this.z += vec.z;
        this.w += vec.w;
    }

    subtract(vec)
    {
        this.x -= vec.x;
        this.y -= vec.y;
        this.z -= vec.z;
        this.w -= vec.w;
    }

    scale(sx, sy, sz, sw)
    {
        this.x *= sx;
        this.y *= sy;
        this.z *= sz;
        this.w *= sw;
    }

    // All four components, so for a direction keep w at 0
    normalize()
    {
        const ls = this.lengthSquared();

        if (ls > MathDefines.kEpsilon)
        {
            const oneOverLen = 1.0 / Math.sqrt(ls);

            this.x *= oneOverLen;
            this.y *= oneOverLen;
            this.z *= oneOverLen;
            this.w *= oneOverLen;
        }
    }

    length()
    {
        return Math.sqrt(this.lengthSquared());
    }

    lengthSquared()
    {
        return ((this.x * this.x) + (this.y * this.y) + (this.z * this.z) + (this.w * this.w));
    }

    // *** Static Methods ***

    static add(v1, v2)
    {
        return new Vector4(v1.x + v2.x, v1.y + v2.y, v1.z + v2.z, v1.w + v2.w);
    }

    static subtract(v1, v2)
    {
        return new Vector4(v1.x - v2.x, v1.y - v2.y, v1.z - v2.z, v1.w - v2.w);
    }

    // a to b by t, written into out and returned, so nothing new is created
    static lerp(out, a, b, t)
    {
        out.x = a.x + ((b.x - a.x) * t);
        out.y = a.y + ((b.y - a.y) * t);
        out.z = a.z + ((b.z - a.z) * t);
        out.w = a.w + ((b.w - a.w) * t);
            return out;
    }

    // *** Static Vars ***

    static #kHex = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i; // setRGBAFromString(): "#rgb", "#rgba", "#rrggbb", "#rrggbbaa"
    static #kCss = /^rgba?\(\s*(.*?)\s*\)$/i;                     // setRGBAFromString(): "rgb(...)" / "rgba(...)", the inside captured

    // Shared, read-only constants: frozen, and the class property can't be reassigned.
    // To get a vector you can change, call the matching static method (e.g. Vector4.black()).
    static kZero = Object.freeze(new Vector4(0.0, 0.0, 0.0, 0.0)); // All four 0 (a new Vector4()'s w is 1)
    static kOne = Object.freeze(new Vector4(1.0, 1.0, 1.0, 1.0));
    static kBlack = Object.freeze(new Vector4(0.0, 0.0, 0.0, 1.0));
    static kWhite = Object.freeze(new Vector4(1.0, 1.0, 1.0, 1.0));

    // *** Static Methods: new, changeable copies of the constants ***

    static zero() { return new Vector4(0.0, 0.0, 0.0, 0.0); }
    static one() { return new Vector4(1.0, 1.0, 1.0, 1.0); }
    static black() { return new Vector4(0.0, 0.0, 0.0, 1.0); }
    static white() { return new Vector4(1.0, 1.0, 1.0, 1.0); }

    static
    {
        for (const name of ["kZero", "kOne", "kBlack", "kWhite"])
            Object.defineProperty(Vector4, name, { writable: false, configurable: false });
    }
}
