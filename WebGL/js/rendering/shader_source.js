"use strict";

const GlowShaderSource = {
    VS: `#version 300 es
        layout(location = 4) in vec3 a_pos;
        layout(location = 0) in vec2 a_uv0;

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