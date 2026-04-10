"use strict";

class Particle {
    constructor() {
        this.pos = new Vector3();
        this.vel = new Vector3();
        this.life = 0.0;
        this.maxLife = 1.0;
        this.active = false;
    }
}

class ParticleSystem {
    #particles = [];
    #mesh = null;
    #material = null;
    #posData = null;
    #maxParticles = 0;
    #activeCount = 0;

    static #VS = `#version 300 es
        layout(location = 4) in vec3 a_pos;
        uniform mat4 u_mvp;
        uniform vec4 u_vec0; // x = point size
        void main() {
            vec4 pos = u_mvp * vec4(a_pos, 1.0);
            gl_Position = pos;
            // Perspective sizing: size * (reference_dist / clip_w)
            gl_PointSize = u_vec0.x * (100.0 / pos.w);
        }
    `;

    static #FS = `#version 300 es
        precision highp float;
        uniform sampler2D u_tex0;
        uniform vec4 u_color;
        out vec4 fragColor;
        void main() {
            vec4 tex = texture(u_tex0, gl_PointCoord);
            fragColor = tex * u_color;
        }
    `;

    constructor(maxCount, texture) {
        this.#maxParticles = maxCount;
        for (let i = 0; i < maxCount; i++) {
            this.#particles.push(new Particle());
        }

        this.#posData = new Float32Array(maxCount * 3);
        this.#mesh = new PointsMesh();

        let shader = new Shader();
        shader.load(ParticleSystem.#VS, ParticleSystem.#FS);
        
        this.#material = new Material();
        this.#material.load(shader, [texture]);
    }

    emit(pos, vel, life) {
        let p = this.#particles.find(part => !part.active);
        if (!p) return;

        p.active = true;
        p.pos.set(pos.x, pos.y, pos.z);
        p.vel.set(vel.x, vel.y, vel.z);
        p.life = life;
        p.maxLife = life;
    }

    update(dt) {
        this.#activeCount = 0;
        for (let i = 0; i < this.#maxParticles; i++) {
            let p = this.#particles[i];
            if (!p.active) continue;

            p.life -= dt;
            if (p.life <= 0) {
                p.active = false;
                continue;
            }

            // Apply velocity
            p.pos.x += p.vel.x * dt;
            p.pos.y += p.vel.y * dt;
            p.pos.z += p.vel.z * dt;

            // Update buffer data
            this.#posData[this.#activeCount * 3 + 0] = p.pos.x;
            this.#posData[this.#activeCount * 3 + 1] = p.pos.y;
            this.#posData[this.#activeCount * 3 + 2] = p.pos.z;
            this.#activeCount++;
        }

        if (this.#activeCount > 0) {
            this.#mesh.set(this.#posData.subarray(0, this.#activeCount * 3));
        }
    }

    render(viewProj, color, size) {
        if (this.#activeCount === 0) return;

        this.#material.bindShader();
        this.#material.setUniformValue("u_mvp", viewProj);
        this.#material.setUniformValue("u_color", color);
        this.#material.setUniformValue("u_vec0", new Vector4(size, 0, 0, 0));
        
        this.#material.bindUniforms();
        this.#mesh.render();
    }
}