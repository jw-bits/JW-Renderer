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
}
