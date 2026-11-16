"use strict";

class ParticleSystem {
    #positions = null;
    #velocities = null;
    #lives = null;
    #colors = null;
    #sizes = null;

    #poolIdx = 0;
    #vao = null;
    #posBuffer = null;
    #colorBuffer = null;
    #sizeBuffer = null;

    #material = null;
    #posData = null;
    #colorData = null;
    #sizeData = null;

    #maxParticles = 0;
    #activeCount = 0;

    static #VS = `#version 300 es
        layout(location = 0) in float a_ptSize;
        layout(location = 5) in vec3 a_pos;
        layout(location = 7) in vec4 a_color;
        

        uniform mat4 u_mvp;

        out vec4 v_color;

        void main() {
            vec4 pos = u_mvp * vec4(a_pos, 1.0);
            gl_Position = pos;
            
            // Use the per-particle size attribute for perspective-correct points
            gl_PointSize = a_ptSize * (100.0 / pos.w);
            v_color = a_color;
        }
    `;

    static #FS = `#version 300 es
        precision highp float;
        uniform sampler2D u_tex0;
        out vec4 fragColor;
        in vec4 v_color;
        void main() {
            vec4 tex = texture(u_tex0, gl_PointCoord);
            fragColor = tex * v_color;
        }
    `;

    constructor(maxCount, texture) {
        this.#maxParticles = maxCount;

        this.#positions = new Float32Array(maxCount * 3);
        this.#velocities = new Float32Array(maxCount * 3);
        this.#colors = new Float32Array(maxCount * 4);
        this.#sizes = new Float32Array(maxCount);
        this.#lives = new Float32Array(maxCount); // 0 or less means inactive
        this.#posData = new Float32Array(maxCount * 3);
        this.#colorData = new Float32Array(maxCount * 4);
        this.#sizeData = new Float32Array(maxCount);

        this.#posBuffer = new VertexFloatBuffer(true);
        this.#colorBuffer = new VertexFloatBuffer(true);
        this.#sizeBuffer = new VertexFloatBuffer(true);
        this.#vao = WGL.context.createVertexArray();

        WGL.context.bindVertexArray(this.#vao);
        
        WGL.context.bindBuffer(WGL.context.ARRAY_BUFFER, this.#posBuffer.getBufferId());
        WGL.context.vertexAttribPointer(RenderAttributes.getLocation(RenderAttributes.kPosition), 3, WGL.context.FLOAT, false, 0, 0);
        WGL.context.enableVertexAttribArray(RenderAttributes.getLocation(RenderAttributes.kPosition));

        WGL.context.bindBuffer(WGL.context.ARRAY_BUFFER, this.#colorBuffer.getBufferId());
        WGL.context.vertexAttribPointer(RenderAttributes.getLocation(RenderAttributes.kColor), 4, WGL.context.FLOAT, false, 0, 0);
        WGL.context.enableVertexAttribArray(RenderAttributes.getLocation(RenderAttributes.kColor));

        WGL.context.bindBuffer(WGL.context.ARRAY_BUFFER, this.#sizeBuffer.getBufferId());
        WGL.context.vertexAttribPointer(RenderAttributes.getLocation(RenderAttributes.kPtSize), 1, WGL.context.FLOAT, false, 0, 0);
        WGL.context.enableVertexAttribArray(RenderAttributes.getLocation(RenderAttributes.kPtSize));

        WGL.context.bindVertexArray(null);

        let shader = new Shader();
        shader.load(ParticleSystem.#VS, ParticleSystem.#FS);

        this.#material = new Material();
        this.#material.load(shader, [texture]);
    }

    emit(pos, vel, life, color, size) {
        // Efficiently find an inactive slot starting from the last known free position
        let idx = -1;
        for (let i = 0; i < this.#maxParticles; i++) {
            let testIdx = (this.#poolIdx + i) % this.#maxParticles;
            if (this.#lives[testIdx] <= 0) {
                idx = testIdx;
                break;
            }
        }

        if (idx === -1) return;

        const i3 = idx * 3;
        const i4 = idx * 4;
        this.#positions[i3 + 0] = pos.x;
        this.#positions[i3 + 1] = pos.y;
        this.#positions[i3 + 2] = pos.z;
        this.#velocities[i3 + 0] = vel.x;
        this.#velocities[i3 + 1] = vel.y;
        this.#velocities[i3 + 2] = vel.z;
        this.#lives[idx] = life;

        this.#colors[i4 + 0] = color.x;
        this.#colors[i4 + 1] = color.y;
        this.#colors[i4 + 2] = color.z;
        this.#colors[i4 + 3] = color.w;
        this.#sizes[idx] = size;
        
        this.#poolIdx = (idx + 1) % this.#maxParticles;
    }

    update(dt) {
        let activeCount = 0;
        let posPtr = 0;
        let colorPtr = 0;
        let sizePtr = 0;
        const max = this.#maxParticles;
        const lives = this.#lives;
        const pos = this.#positions;
        const vel = this.#velocities;
        const colors = this.#colors;
        const sizes = this.#sizes;
        const posData = this.#posData;
        const colorData = this.#colorData;
        const sizeData = this.#sizeData;

        for (let i = 0; i < max; i++) {
            if (lives[i] <= 0) continue;

            lives[i] -= dt;
            if (lives[i] <= 0) continue;

            const i3 = i * 3;
            const i4 = i * 4;

            // Apply velocity
            pos[i3 + 0] += vel[i3 + 0] * dt;
            pos[i3 + 1] += vel[i3 + 1] * dt;
            pos[i3 + 2] += vel[i3 + 2] * dt;

            // Pack active positions and colors into the contiguous buffers for the GPU
            posData[posPtr++] = pos[i3 + 0];
            posData[posPtr++] = pos[i3 + 1];
            posData[posPtr++] = pos[i3 + 2];

            colorData[colorPtr++] = colors[i4 + 0];
            colorData[colorPtr++] = colors[i4 + 1];
            colorData[colorPtr++] = colors[i4 + 2];
            colorData[colorPtr++] = colors[i4 + 3];

            sizeData[sizePtr++] = sizes[i];

            activeCount++;
        }

        this.#activeCount = activeCount;
        if (activeCount > 0) {
            this.#posBuffer.set(posData.subarray(0, posPtr));
            this.#colorBuffer.set(colorData.subarray(0, colorPtr));
            this.#sizeBuffer.set(sizeData.subarray(0, sizePtr));
        }
    }

    render(viewProj) {
        if (this.#activeCount === 0) return;

        this.#material.bindShader();
        this.#material.setUniformValue("u_mvp", viewProj);
        
        this.#material.bindUniforms();
        WGL.context.depthMask(false);
        WGL.context.bindVertexArray(this.#vao);
        WGL.context.drawArrays(WGL.context.POINTS, 0, this.#activeCount);
        WGL.context.bindVertexArray(null);
        WGL.context.depthMask(true);
    }

    getPositions() { return this.#positions; }
    getVelocities() { return this.#velocities; }
    getSizes() { return this.#sizes; }
    getColors() { return this.#colors; }
    getLives() { return this.#lives; }
    getMaxParticles() { return this.#maxParticles; }
}