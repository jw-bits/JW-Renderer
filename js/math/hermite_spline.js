"use strict";

class HermiteSpline {
    #points;

    constructor() {
        this.#points = [];
    }

    /**
     * Adds a control point to the spline.
     * @param {Vector3} v - The control point to add.
     */
    setControlPoint(v) {
        // We store a new instance to prevent external modifications to the spline data
        this.#points.push(new Vector3(v.x, v.y, v.z));
    }

    /**
     * Returns the interpolated position at a given time t.
     * @param {number} t - Normalized time [0, 1] across the entire spline.
     * @returns {Vector3} The interpolated position.
     */
    getPoint(t) {
        const count = this.#points.length;
        if (count === 0) return new Vector3();
        if (count === 1) return new Vector3(this.#points[0].x, this.#points[0].y, this.#points[0].z);

        // Clamp t to the valid range [0, 1]
        const clampT = Math.max(0, Math.min(1, t));

        // Calculate which segment we are in
        const numSegments = count - 1;
        const progress = clampT * numSegments;
        let index = Math.floor(progress);
        let localT = progress - index;

        // Handle the boundary at t = 1.0
        if (index >= numSegments) {
            index = numSegments - 1;
            localT = 1.0;
        }

        // Catmull-Rom requires p[i-1], p[i], p[i+1], and p[i+2]
        // We clamp the indices to handle the start and end of the point list
        const p0 = this.#points[index === 0 ? 0 : index - 1];
        const p1 = this.#points[index];
        const p2 = this.#points[index + 1];
        const p3 = (index + 2 >= count) ? this.#points[count - 1] : this.#points[index + 2];

        const t2 = localT * localT;
        const t3 = t2 * localT;

        // Basis functions for Catmull-Rom
        const f1 = -0.5 * t3 + t2 - 0.5 * localT;
        const f2 = 1.5 * t3 - 2.5 * t2 + 1.0;
        const f3 = -1.5 * t3 + 2.0 * t2 + 0.5 * localT;
        const f4 = 0.5 * t3 - 0.5 * t2;

        return new Vector3(
            p0.x * f1 + p1.x * f2 + p2.x * f3 + p3.x * f4,
            p0.y * f1 + p1.y * f2 + p2.y * f3 + p3.y * f4,
            p0.z * f1 + p1.z * f2 + p2.z * f3 + p3.z * f4
        );
    }

    clear() {
        this.#points = [];
    }
}
