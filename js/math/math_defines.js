"use strict";

/*
    MathDefines - Numbers used across the codebase, worked out once.

    Usage:
        const step = MathDefines.kTwoPi / count;      // A full turn split into count parts
        const rad = deg * MathDefines.kDegToRad;
        if (lengthSq > MathDefines.kEpsilon) ...      // Not (almost) zero
        const seconds = ms * MathDefines.kSecondsPerMs;

    Load it before every other script; other classes use it in their static values.
*/
class MathDefines
{
    // Angles (radians)
    static kPi = Math.PI;                   // Half a turn
    static kTwoPi = Math.PI * 2.0;          // A full turn
    static kHalfPi = Math.PI / 2.0;         // A quarter turn
    static kDegToRad = Math.PI / 180.0;     // Degrees * this = radians
    static kRadToDeg = 180.0 / Math.PI;     // Radians * this = degrees

    // Below this a length (squared) or determinant counts as zero
    static kEpsilon = 0.000001;

    // Time
    static kMsPerSecond = 1000.0;
    static kSecondsPerMs = 0.001;           // Milliseconds (e.g. performance.now()) * this = seconds
    static kSecondsPerMinute = 60;

    // Colors
    static kByteMax = 255;                  // The largest 8-bit channel value; a 0 - 1 color * this = a byte

    static
    {
        for (const name of Object.keys(MathDefines))
            Object.defineProperty(MathDefines, name, { writable: false, configurable: false });
    }
}
