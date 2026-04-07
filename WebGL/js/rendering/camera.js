"use strict";

class Camera {
    #eye;
    #target;
    #up;

    constructor() {
        this.#eye = new Vector3(0, 0, 1);
        this.#target = new Vector3(0, 0, 0);
        this.#up = new Vector3(0, 1, 0);
    }

    setEye(x, y, z) {
        this.#eye.set(x, y, z);
    }

    setTarget(x, y, z) {
        this.#target.set(x, y, z);
    }

    translate(x, y, z) {
        this.#eye.x += x;
        this.#eye.y += y;
        this.#eye.z += z;

        this.#target.x += x;
        this.#target.y += y;
        this.#target.z += z;
    }

    rotateAround(axis, angle) {
        let m = Matrix3.rotationMatrix(axis, angle);
        
        let dx = this.#eye.x - this.#target.x;
        let dy = this.#eye.y - this.#target.y;
        let dz = this.#eye.z - this.#target.z;

        let rx = m.m[0] * dx + m.m[1] * dy + m.m[2] * dz;
        let ry = m.m[3] * dx + m.m[4] * dy + m.m[5] * dz;
        let rz = m.m[6] * dx + m.m[7] * dy + m.m[8] * dz;

        this.#eye.set(this.#target.x + rx, this.#target.y + ry, this.#target.z + rz);
    }

    getViewMatrix() {
        let zx = this.#eye.x - this.#target.x;
        let zy = this.#eye.y - this.#target.y;
        let zz = this.#eye.z - this.#target.z;
        
        let zAxis = new Vector3(zx, zy, zz);
        zAxis.normalize();

        let xAxis = this.#up.cross(zAxis);
        xAxis.normalize();

        let yAxis = zAxis.cross(xAxis);

        let view = new Matrix4();
        
        // Column Major Matrix Construction
        // Index: 0  4  8  12
        //        1  5  9  13
        //        2  6 10  14
        //        3  7 11  15
        
        view.m[0] = xAxis.x;
        view.m[4] = xAxis.y;
        view.m[8] = xAxis.z;
        view.m[12] = -(xAxis.x * this.#eye.x + xAxis.y * this.#eye.y + xAxis.z * this.#eye.z);

        view.m[1] = yAxis.x;
        view.m[5] = yAxis.y;
        view.m[9] = yAxis.z;
        view.m[13] = -(yAxis.x * this.#eye.x + yAxis.y * this.#eye.y + yAxis.z * this.#eye.z);

        view.m[2] = zAxis.x;
        view.m[6] = zAxis.y;
        view.m[10] = zAxis.z;
        view.m[14] = -(zAxis.x * this.#eye.x + zAxis.y * this.#eye.y + zAxis.z * this.#eye.z);

        view.m[3] = 0.0; view.m[7] = 0.0; view.m[11] = 0.0; view.m[15] = 1.0;

        return view;
    }
}
