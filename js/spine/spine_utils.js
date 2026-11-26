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
        SpineUtils                   Array helpers, enumValue(), and getRegionUVs() (engine addition)
        SpinePool                    Reuses objects

    Left out: DebugUtils, TimeKeeper and WindowedMean (the engine has its own
    timing and logging), and the Pow / PowOut interpolations (never used).

    Replaced: MathUtils is the engine's MathDefines and MathUtil. PI, PI2,
    degRad and radDeg are MathDefines.kPi, kTwoPi, kDegToRad and kRadToDeg
    (Math.PI rather than Spine's 3.1415927); cosDeg(), sinDeg() and signum()
    are MathUtil's. Its other helpers were never called.

    Replaced: Color is the engine's Vector4, with (r, g, b, a) in (x, y, z, w).
    Its set(r, g, b, a) and add() clamped to 0 - 1, so the timelines call
    Vector4.clamp01() after writing a color; setFromString() is
    Vector4.setRGBAFromString(). A Spine color made with no values is
    new Vector4(0, 0, 0, 0), since a new Vector4()'s w is 1.
    Vector2 is the engine's Vector2: values are written with setXY(), and
    SpineSkeleton.getBounds() fills Vector2s. newFloatArray() is
    new Float32Array(), and arrayCopy() between two typed arrays is
    TypedArray.set(); arrayCopy() stays for copies into or from plain arrays.
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
