"use strict";

/******************************************************************************
 * Spine Runtimes License Agreement
 * Last updated January 1, 2020. Replaces all prior versions.
 *
 * Copyright (c) 2013-2020, Esoteric Software LLC
 *
 * Integration of the Spine Runtimes into software or otherwise creating
 * derivative works of the Spine Runtimes is permitted under the terms and
 * conditions of Section 2 of the Spine Editor License Agreement:
 * http://esotericsoftware.com/spine-editor-license
 *
 * Otherwise, it is permitted to integrate the Spine Runtimes into software
 * or otherwise create derivative works of the Spine Runtimes (collectively,
 * "Products"), provided that each user of the Products must obtain their own
 * Spine Editor license and redistribution of the Products in any form must
 * include this license and copyright notice.
 *
 * THE SPINE RUNTIMES ARE PROVIDED BY ESOTERIC SOFTWARE LLC "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL ESOTERIC SOFTWARE LLC BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES,
 * BUSINESS INTERRUPTION, OR LOSS OF USE, DATA, OR PROFITS) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THE SPINE RUNTIMES, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *****************************************************************************/

/*
    Spine utilities, ported from spine-core 4.0.31 (Utils.ts); see
    docs/spine_plan.md. Phase 5 of the plan replaces these with the engine's
    own (Vector4, Vector2, MathUtil, Easing) wherever they do the same job.

        SpineIntSet, SpineStringSet  Sets of ints / strings
        SpineColor                   r, g, b, a (0 - 1)
        SpineMathUtils               Spine's math helpers (degrees, clamp, signum, ...)
        SpinePow, SpinePowOut        Interpolations
        SpineUtils                   Array helpers, enumValue(), and getRegionUVs() (engine addition)
        SpinePool                    Reuses objects
        SpineVector2                 x, y

    Left out: DebugUtils, TimeKeeper and WindowedMean (the engine has its own
    timing and logging).
*/

class SpineIntSet
{
    array = new Array();

    add(value)
    {
        let contains = this.contains(value);
        this.array[value | 0] = value | 0;
        return !contains;
    }

    contains(value)
    {
        return this.array[value | 0] != undefined;
    }

    remove(value)
    {
        this.array[value | 0] = undefined;
    }

    clear()
    {
        this.array.length = 0;
    }
}

class SpineStringSet
{
    entries = {};
    size = 0;

    add(value)
    {
        let contains = this.entries[value];
        this.entries[value] = true;
        if (!contains)
        {
            this.size++;
            return true;
        }
        return false;
    }

    addAll(values)
    {
        let oldSize = this.size;
        for (var i = 0, n = values.length; i < n; i++)
            this.add(values[i]);
        return oldSize != this.size;
    }

    contains(value)
    {
        return this.entries[value];
    }

    clear()
    {
        this.entries = {};
        this.size = 0;
    }
}

class SpineColor
{
    r;
    g;
    b;
    a;
    static WHITE = new SpineColor(1, 1, 1, 1);
    static RED = new SpineColor(1, 0, 0, 1);
    static GREEN = new SpineColor(0, 1, 0, 1);
    static BLUE = new SpineColor(0, 0, 1, 1);
    static MAGENTA = new SpineColor(1, 0, 1, 1);

    constructor(r = 0, g = 0, b = 0, a = 0)
    {
        this.r = r;
        this.g = g;
        this.b = b;
        this.a = a;
    }

    set(r, g, b, a)
    {
        this.r = r;
        this.g = g;
        this.b = b;
        this.a = a;
        return this.clamp();
    }

    setFromColor(c)
    {
        this.r = c.r;
        this.g = c.g;
        this.b = c.b;
        this.a = c.a;
        return this;
    }

    setFromString(hex)
    {
        hex = hex.charAt(0) == '#' ? hex.substr(1) : hex;
        this.r = parseInt(hex.substr(0, 2), 16) / 255;
        this.g = parseInt(hex.substr(2, 2), 16) / 255;
        this.b = parseInt(hex.substr(4, 2), 16) / 255;
        this.a = hex.length != 8 ? 1 : parseInt(hex.substr(6, 2), 16) / 255;
        return this;
    }

    add(r, g, b, a)
    {
        this.r += r;
        this.g += g;
        this.b += b;
        this.a += a;
        return this.clamp();
    }

    clamp()
    {
        if (this.r < 0)
            this.r = 0;
        else if (this.r > 1)
            this.r = 1;
        if (this.g < 0)
            this.g = 0;
        else if (this.g > 1)
            this.g = 1;
        if (this.b < 0)
            this.b = 0;
        else if (this.b > 1)
            this.b = 1;
        if (this.a < 0)
            this.a = 0;
        else if (this.a > 1)
            this.a = 1;
        return this;
    }

    static rgba8888ToColor(color, value)
    {
        color.r = ((value & 0xff000000) >>> 24) / 255;
        color.g = ((value & 0x00ff0000) >>> 16) / 255;
        color.b = ((value & 0x0000ff00) >>> 8) / 255;
        color.a = ((value & 0x000000ff)) / 255;
    }

    static rgb888ToColor(color, value)
    {
        color.r = ((value & 0x00ff0000) >>> 16) / 255;
        color.g = ((value & 0x0000ff00) >>> 8) / 255;
        color.b = ((value & 0x000000ff)) / 255;
    }

    static fromString(hex)
    {
        return new SpineColor().setFromString(hex);
    }
}

class SpineMathUtils
{
    static PI = 3.1415927;
    static PI2 = SpineMathUtils.PI * 2;
    static radiansToDegrees = 180 / SpineMathUtils.PI;
    static radDeg = SpineMathUtils.radiansToDegrees;
    static degreesToRadians = SpineMathUtils.PI / 180;
    static degRad = SpineMathUtils.degreesToRadians;

    static clamp(value, min, max)
    {
        if (value < min)
            return min;
        if (value > max)
            return max;
        return value;
    }

    static cosDeg(degrees)
    {
        return Math.cos(degrees * SpineMathUtils.degRad);
    }

    static sinDeg(degrees)
    {
        return Math.sin(degrees * SpineMathUtils.degRad);
    }

    static signum(value)
    {
        return value > 0 ? 1 : value < 0 ? -1 : 0;
    }

    static toInt(x)
    {
        return x > 0 ? Math.floor(x) : Math.ceil(x);
    }

    static cbrt(x)
    {
        let y = Math.pow(Math.abs(x), 1 / 3);
        return x < 0 ? -y : y;
    }

    static randomTriangular(min, max)
    {
        return SpineMathUtils.randomTriangularWith(min, max, (min + max) * 0.5);
    }

    static randomTriangularWith(min, max, mode)
    {
        let u = Math.random();
        let d = max - min;
        if (u <= (mode - min) / d)
            return min + Math.sqrt(u * d * (mode - min));
        return max - Math.sqrt((1 - u) * d * (max - mode));
    }

    static isPowerOfTwo(value)
    {
        return value && (value & (value - 1)) === 0;
    }
}

class SpineInterpolation
{
    apply(start, end, a)
    {
        return start + (end - start) * this.applyInternal(a);
    }
}

class SpinePow extends SpineInterpolation
{
    power = 2;

    constructor(power)
    {
        super();
        this.power = power;
    }

    applyInternal(a)
    {
        if (a <= 0.5)
            return Math.pow(a * 2, this.power) / 2;
        return Math.pow((a - 1) * 2, this.power) / (this.power % 2 == 0 ? -2 : 2) + 1;
    }
}

class SpinePowOut extends SpinePow
{
    constructor(power)
    {
        super(power);
    }

    applyInternal(a)
    {
        return Math.pow(a - 1, this.power) * (this.power % 2 == 0 ? -1 : 1) + 1;
    }
}

class SpineUtils
{
    static SUPPORTS_TYPED_ARRAYS = typeof (Float32Array) !== "undefined";

    static arrayCopy(source, sourceStart, dest, destStart, numElements)
    {
        for (let i = sourceStart, j = destStart; i < sourceStart + numElements; i++, j++)
        {
            dest[j] = source[i];
        }
    }

    static arrayFill(array, fromIndex, toIndex, value)
    {
        for (let i = fromIndex; i < toIndex; i++)
            array[i] = value;
    }

    static setArraySize(array, size, value = 0)
    {
        let oldSize = array.length;
        if (oldSize == size)
            return array;
        array.length = size;
        if (oldSize < size)
        {
            for (let i = oldSize; i < size; i++)
                array[i] = value;
        }
        return array;
    }

    static ensureArrayCapacity(array, size, value = 0)
    {
        if (array.length >= size)
            return array;
        return SpineUtils.setArraySize(array, size, value);
    }

    static newArray(size, defaultValue)
    {
        let array = new Array(size);
        for (let i = 0; i < size; i++)
            array[i] = defaultValue;
        return array;
    }

    static newFloatArray(size)
    {
        if (SpineUtils.SUPPORTS_TYPED_ARRAYS)
            return new Float32Array(size);
        else
        {
            let array = new Array(size);
            for (let i = 0; i < array.length; i++)
                array[i] = 0;
            return array;
        }
    }

    static newShortArray(size)
    {
        if (SpineUtils.SUPPORTS_TYPED_ARRAYS)
            return new Int16Array(size);
        else
        {
            let array = new Array(size);
            for (let i = 0; i < array.length; i++)
                array[i] = 0;
            return array;
        }
    }

    static toFloatArray(array)
    {
        return SpineUtils.SUPPORTS_TYPED_ARRAYS ? new Float32Array(array) : array;
    }

    static toSinglePrecision(value)
    {
        return SpineUtils.SUPPORTS_TYPED_ARRAYS ? Math.fround(value) : value;
    }

    // This function is used to fix WebKit 602 specific issue described at http://esotericsoftware.com/forum/iOS-10-disappearing-graphics-10109
    static webkit602BugfixHelper(alpha, blend)
    {
    }

    static contains(array, element, identity = true)
    {
        for (var i = 0; i < array.length; i++)
            if (array[i] == element)
                return true;
        return false;
    }

    static enumValue(type, name)
    {
        return type[name[0].toUpperCase() + name.slice(1)];
    }

    /*
        Engine addition: a region's corners in Spine's terms, written into out ([4]) and
        returned: [u, v, u2, v2] with V running down from the top of the page, as
        Spine's TextureAtlasRegion has them. region is an AtlasSubTexture (whose UV rect
        has V up); this is the one place the port turns the engine's V round.
    */
    static getRegionUVs(region, out)
    {
        const r = region.getUVRect();

        out[0] = r.getLeft();
        out[1] = 1.0 - r.getTop();
        out[2] = r.getRight();
        out[3] = 1.0 - r.getBottom();
        return out;
    }
}

class SpinePool
{
    items = new Array();
    instantiator;

    constructor(instantiator)
    {
        this.instantiator = instantiator;
    }

    obtain()
    {
        return this.items.length > 0 ? this.items.pop() : this.instantiator();
    }

    free(item)
    {
        if (item.reset)
            item.reset();
        this.items.push(item);
    }

    freeAll(items)
    {
        for (let i = 0; i < items.length; i++)
            this.free(items[i]);
    }

    clear()
    {
        this.items.length = 0;
    }
}

class SpineVector2
{
    x;
    y;

    constructor(x = 0, y = 0)
    {
        this.x = x;
        this.y = y;
    }

    set(x, y)
    {
        this.x = x;
        this.y = y;
        return this;
    }

    length()
    {
        let x = this.x;
        let y = this.y;
        return Math.sqrt(x * x + y * y);
    }

    normalize()
    {
        let len = this.length();
        if (len != 0)
        {
            this.x /= len;
            this.y /= len;
        }
        return this;
    }
}
