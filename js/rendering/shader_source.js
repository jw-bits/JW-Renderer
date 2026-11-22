"use strict";

const Rect2DShaderSource = {
    VS: `#version 300 es
        layout(location = 5) in vec3 a_pos;
        layout(location = 1) in vec2 a_uv0;
        
        uniform vec2 u_res;
        uniform vec3 u_scale;

        // u_vec0 is (x, y, width / 2, height / 2); scale and rotation pivot on the rect's center
        uniform vec4 u_vec0;

        // UV tiling and offset: uv = offset + uv * tile; (0, 0) and (1, 1) draw the whole texture once
        uniform vec2 u_uvOffset;
        uniform vec2 u_uvTile;

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

            v_uv0 = u_uvOffset + (a_uv0 * u_uvTile);
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
    TextGlyphs2D: Rect2D's shader plus a color per vertex (a_color, the
    glyph's color from TextGlyphs2D.setGlyphColors(); white when not set),
    multiplied with u_color, so each glyph can have its own tint.
*/
const TextGlyphs2DShaderSource = {
    VS: `#version 300 es
        layout(location = 5) in vec3 a_pos;
        layout(location = 1) in vec2 a_uv0;
        layout(location = 7) in vec4 a_color;

        uniform vec2 u_res;
        uniform vec3 u_scale;

        // u_vec0 is (x, y, width / 2, height / 2); scale and rotation pivot on the rect's center
        uniform vec4 u_vec0;

        uniform vec2 u_uvOffset;
        uniform vec2 u_uvTile;

        out vec2 v_uv0;
        out vec4 v_color;

        void main() {
            vec2 ssPos = (a_pos.xy - u_vec0.zw) * u_scale.xy;

            float sa = sin(u_scale.z);
            float ca = cos(u_scale.z);

            vec2 rPos = vec2(ssPos.x * ca + ssPos.y * sa,
                             ssPos.x * -sa + ssPos.y * ca);

            vec2 zTo1 = (rPos + u_vec0.zw + u_vec0.xy) / u_res;
            vec2 cs = (zTo1 * 2.0) - 1.0;

            gl_Position = vec4(cs, 0.0, 1.0);

            v_uv0 = u_uvOffset + (a_uv0 * u_uvTile);
            v_color = a_color;
        }
    `,
    FS: `#version 300 es
        precision highp float;

        uniform sampler2D u_tex0;
        uniform vec4 u_color;

        in vec2 v_uv0;
        in vec4 v_color;
        out vec4 fragColor;

        void main() {
            vec4 c = texture(u_tex0, v_uv0);
            fragColor = c * u_color * v_color;
        }
    `
};

/*
    Sprite: Rect2D's shader, drawing one rect of its texture (an atlas frame)
    instead of all of it. u_vec1 is the UV rect (u, v, width, height), with
    (u, v) its bottom-left corner and V up (see UVRect).
*/
const SpriteShaderSource = {
    VS: `#version 300 es
        layout(location = 5) in vec3 a_pos;
        layout(location = 1) in vec2 a_uv0;

        uniform vec2 u_res;
        uniform vec3 u_scale;

        // u_vec0 is (x, y, width / 2, height / 2); scale and rotation pivot on the rect's center
        uniform vec4 u_vec0;

        // u_vec1 is the frame's UV rect
        uniform vec4 u_vec1;

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

            v_uv0 = u_vec1.xy + (a_uv0 * u_vec1.zw);
        }
    `,
    FS: Rect2DShaderSource.FS
};

/*
    Instanced Rect2D: draws many Rect2Ds that share a material in one draw call
    (see MaterialBatcher), and Sprites too. Same math as Rect2DShaderSource /
    SpriteShaderSource, but the per-rect values come from instance attributes
    instead of uniforms.

    The mesh is a unit quad (0,0) - (1,1); its position is mapped into the
    instance's UV rect, so a quad can draw part of its texture (a Sprite's frame).
    Per instance:
        a_iRect     (x, y, width / 2, height / 2)  Like u_vec0; (x, y) is the bottom-left corner
        a_iScaleRot (scaleX, scaleY, rotZ)         Like u_scale
        a_iColor    (r, g, b, a)                   Like u_color
        a_iUVRect   (u, v, width, height)          Like SpriteShaderSource's u_vec1, or Rect2D's u_uvOffset / u_uvTile; (0, 0, 1, 1) for the whole texture

    Locations 8 - 11 are past the ones RenderAttributes uses (0 - 7).
*/
const Rect2DInstancedShaderSource = {
    kRectLocation: 8,
    kScaleRotLocation: 9,
    kColorLocation: 10,
    kUVRectLocation: 11,

    VS: `#version 300 es
        layout(location = 5) in vec2 a_pos;
        layout(location = 8) in vec4 a_iRect;
        layout(location = 9) in vec3 a_iScaleRot;
        layout(location = 10) in vec4 a_iColor;
        layout(location = 11) in vec4 a_iUVRect;

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

            v_uv0 = a_iUVRect.xy + (a_pos * a_iUVRect.zw);
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

        age = time - startTime
        pos = startPos + velocity * age + 0.5 * gravity * age^2

    Over its life a particle fades out and its size goes from size to
    size * endScale. Particles that haven't started or have died are
    collapsed off-screen, so dead slots cost almost nothing.

    Uniforms: u_res, and u_vec0 = (gravityX, gravityY, endScale, time), time in seconds.
    u_uvOffset / u_uvTile are the part of the texture drawn on each particle:
    (0, 0) / (1, 1) for all of it, or a SubTexture's UV rect (see TextureAtlas).

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
        uniform vec4 u_vec0; // (gravityX, gravityY, endScale, time)
        uniform vec2 u_uvOffset;
        uniform vec2 u_uvTile;

        out vec2 v_uv0;
        out vec4 v_color;

        void main() {
            float age = u_vec0.w - a_iLife.x;
            float life = a_iLife.y;

            if (age < 0.0 || age >= life) {
                gl_Position = vec4(-2.0, -2.0, 0.0, 1.0); // Off-screen; all 4 corners collapse
                v_uv0 = vec2(0.0);
                v_color = vec4(0.0);
                return;
            }

            float t = age / life;
            vec2 center = a_iMotion.xy + (a_iMotion.zw * age) + (0.5 * u_vec0.xy * age * age);
            float size = a_iLife.z * mix(1.0, u_vec0.z, t);
            vec2 p = center + (a_pos * size);

            gl_Position = vec4(((p / u_res) * 2.0) - 1.0, 0.0, 1.0);

            v_uv0 = u_uvOffset + ((a_pos + 0.5) * u_uvTile);
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