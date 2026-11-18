"use strict";

const GlowShaderSource = {
    VS: `#version 300 es
        layout(location = 5) in vec3 a_pos;
        layout(location = 1) in vec2 a_uv0;

        out vec2 v_uv0;

        void main() {
            // Pass-through positions for full-screen quad (NDC -1 to 1)
            gl_Position = vec4(a_pos, 1.0);
            v_uv0 = a_uv0;
        }
    `,
    FS: `#version 300 es
        precision highp float;
        uniform sampler2D u_tex0;
        in vec2 v_uv0;
        out vec4 fragColor;

        void main() {
            vec4 sceneColor = texture(u_tex0, v_uv0);
            vec4 glow = vec4(0.0);
            float spread = 0.004;

            // Simple 5x5 blur kernel to create glow spread
            for(float x = -2.0; x <= 2.0; x++) {
                for(float y = -2.0; y <= 2.0; y++) {
                    glow += texture(u_tex0, v_uv0 + vec2(x, y) * spread);
                }
            }
            glow /= 25.0;

            // Combine original scene with the blurred glow (additive style)
            fragColor = sceneColor + (glow * 1.8);
        }
    `
};

const Rect2DShaderSource = {
    VS: `#version 300 es
        layout(location = 5) in vec3 a_pos;
        layout(location = 1) in vec2 a_uv0;
        
        uniform vec2 u_res;
        uniform vec3 u_scale;

        // u_vec0 is (x, y, width / 2, height / 2); scale and rotation pivot on the rect's center
        uniform vec4 u_vec0; 

        out vec2 v_uv0;
        
        void main() {
            vec2 ssPos = (a_pos.xy - u_vec0.zw) * u_scale.xy;

            float sa = sin(u_scale.z);
            float ca = cos(u_scale.z);

            vec2 rPos = vec2(ssPos.x * ca + ssPos.y * sa,
                             ssPos.x * -sa + ssPos.y * ca);

            vec2 zTo1 = (rPos + u_vec0.zw + u_vec0.xy) / u_res;
            vec2 cs = (zTo1 * 2.0) - 1.0;

            gl_Position = vec4(cs, 0.0, 1.0);

            v_uv0 = a_uv0;
        }
    `,
    FS: `#version 300 es
        precision highp float;

        uniform sampler2D u_tex0;
        uniform vec4 u_color;

        in vec2 v_uv0;
        out vec4 fragColor;

        void main() {
            vec4 c = texture(u_tex0, v_uv0);
            fragColor = c * u_color;
        }    
    `
};

/*
    Instanced Rect2D: draws many Rect2Ds that share a material in one draw call
    (see MaterialBatcher). Same math as Rect2DShaderSource, but the per-rect
    values come from instance attributes instead of uniforms.

    The mesh is a unit quad (0,0) - (1,1); its position doubles as the UV.
    Per instance:
        a_iRect     (x, y, width / 2, height / 2)  Like u_vec0; (x, y) is the bottom-left corner
        a_iScaleRot (scaleX, scaleY, rotZ)         Like u_scale
        a_iColor    (r, g, b, a)                   Like u_color

    Locations 8 - 10 are past the ones RenderAttributes uses (0 - 7).
*/
const Rect2DInstancedShaderSource = {
    kRectLocation: 8,
    kScaleRotLocation: 9,
    kColorLocation: 10,

    VS: `#version 300 es
        layout(location = 5) in vec2 a_pos;
        layout(location = 8) in vec4 a_iRect;
        layout(location = 9) in vec3 a_iScaleRot;
        layout(location = 10) in vec4 a_iColor;

        uniform vec2 u_res;

        out vec2 v_uv0;
        out vec4 v_color;

        void main() {
            vec2 halfSize = a_iRect.zw;
            vec2 ssPos = ((a_pos * halfSize * 2.0) - halfSize) * a_iScaleRot.xy;

            float sa = sin(a_iScaleRot.z);
            float ca = cos(a_iScaleRot.z);

            vec2 rPos = vec2(ssPos.x * ca + ssPos.y * sa,
                             ssPos.x * -sa + ssPos.y * ca);

            vec2 zTo1 = (rPos + halfSize + a_iRect.xy) / u_res;
            vec2 cs = (zTo1 * 2.0) - 1.0;

            gl_Position = vec4(cs, 0.0, 1.0);

            v_uv0 = a_pos;
            v_color = a_iColor;
        }
    `,
    FS: `#version 300 es
        precision highp float;

        uniform sampler2D u_tex0;

        in vec2 v_uv0;
        in vec4 v_color;
        out vec4 fragColor;

        void main() {
            vec4 c = texture(u_tex0, v_uv0);
            fragColor = c * v_color;
        }
    `
};

/*
    Particles2D: instanced quads simulated on the GPU. Each particle is written
    once when emitted; the shader works out where it is from the time since then:

        age = u_time - startTime
        pos = startPos + velocity * age + 0.5 * u_gravity * age^2

    Over its life a particle fades out and its size goes from size to
    size * u_endScale. Particles that haven't started or have died are
    collapsed off-screen, so dead slots cost almost nothing.

    The mesh is a unit quad (-0.5, -0.5) - (0.5, 0.5), centered on the particle.
    Per instance:
        a_iMotion (startX, startY, velX, velY)  Design units, design units per second
        a_iLife   (startTime, life, size)       Seconds, seconds, design units
        a_iColor  (r, g, b, a)
*/
const Particles2DShaderSource = {
    kMotionLocation: 8,
    kLifeLocation: 9,
    kColorLocation: 10,

    VS: `#version 300 es
        layout(location = 5) in vec2 a_pos;
        layout(location = 8) in vec4 a_iMotion;
        layout(location = 9) in vec3 a_iLife;
        layout(location = 10) in vec4 a_iColor;

        uniform vec2 u_res;
        uniform float u_time;
        uniform vec2 u_gravity;
        uniform float u_endScale;

        out vec2 v_uv0;
        out vec4 v_color;

        void main() {
            float age = u_time - a_iLife.x;
            float life = a_iLife.y;

            if (age < 0.0 || age >= life) {
                gl_Position = vec4(-2.0, -2.0, 0.0, 1.0); // Off-screen; all 4 corners collapse
                v_uv0 = vec2(0.0);
                v_color = vec4(0.0);
                return;
            }

            float t = age / life;
            vec2 center = a_iMotion.xy + (a_iMotion.zw * age) + (0.5 * u_gravity * age * age);
            float size = a_iLife.z * mix(1.0, u_endScale, t);
            vec2 p = center + (a_pos * size);

            gl_Position = vec4(((p / u_res) * 2.0) - 1.0, 0.0, 1.0);

            v_uv0 = a_pos + 0.5;
            v_color = vec4(a_iColor.rgb, a_iColor.a * (1.0 - t));
        }
    `,
    FS: `#version 300 es
        precision highp float;

        uniform sampler2D u_tex0;

        in vec2 v_uv0;
        in vec4 v_color;
        out vec4 fragColor;

        void main() {
            fragColor = texture(u_tex0, v_uv0) * v_color;
        }
    `
};

const Standard3DShaderSource = {
    VS: `#version 300 es
        layout (location = 5) in vec3 a_pos;
        layout (location = 1) in vec2 a_uv0;
        uniform mat4 u_mvp;
        out vec2 v_uv0;
        void main() {
            gl_Position = u_mvp * vec4(a_pos, 1.0);
            v_uv0 = a_uv0;
        }
    `,
    FS: `#version 300 es
        precision highp float;
        uniform sampler2D u_tex0;
        uniform vec4 u_color;
        in vec2 v_uv0;
        out vec4 fragColor;
        void main() {
            fragColor = texture(u_tex0, v_uv0) * u_color;
        }
    `
};

const MaskShaderSource = {
    VS: Standard3DShaderSource.VS,
    FS: `#version 300 es
        precision highp float;
        out vec4 fragColor;
        void main() {
            // We don't care about color, only stencil/depth
            fragColor = vec4(1.0);
        }
    `
};