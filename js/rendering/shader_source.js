"use strict";

/*
    Shader sources: each is { name, VS, FS } (plus any attribute locations it
    needs). name is unique in this file; ShaderManager keys each built shader
    by it, so a new source needs a name no other source uses.
*/

const Rect2DShaderSource = {
    name: "Rect2D",
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
    Per-pixel lighting for Rect2D, RoundedRect2D and NinePatch2D (they share
    Rect2D's vertex inputs and uniforms). The lights come from a LightSet
    (lighting.js), which uploads them once per frame.

    The 2D view lies on the z = 0 plane, in design units, +Y up: lights at
    negative z are behind it, positive z in front. Each pixel is lit at
    (x, y, 0) with a surface normal of (0, 0, 1), facing the viewer, or the
    normal map's (LitNormalMapRect2DShaderSource).

        u_ambient       (r, g, b, lightCount); the color is used as is, lightCount (0 - 4,
                        1 by default) is how many of slots 0 - 3 are lit; 0 is ambient only
        u_lightPosN     Point light: (x, y, z, range), range > 0, falling off to nothing at range
                        Directional light: (direction toward the light, normalized, 0)
        u_lightColorN   (r, g, b, intensity); intensity 0 is off

    Lighting is ambient plus Lambert diffuse, multiplied with the texture,
    then with u_color. Alpha is the texture's times u_color's.
*/
const LightingSharedSource = {
    name: "LightingShared", // Code shared by the lit shaders, not a shader of its own
    // Vertex shader: Rect2D's, plus v_pos, the pixel's position in design units
    VS: `#version 300 es
        layout(location = 5) in vec3 a_pos;
        layout(location = 1) in vec2 a_uv0;

        uniform vec2 u_res;
        uniform vec3 u_scale;

        // u_vec0 is (x, y, width / 2, height / 2); scale and rotation pivot on the rect's center
        uniform vec4 u_vec0;

        uniform vec2 u_uvOffset;
        uniform vec2 u_uvTile;

        out vec2 v_uv0;
        out vec2 v_pos;

        void main() {
            vec2 ssPos = (a_pos.xy - u_vec0.zw) * u_scale.xy;

            float sa = sin(u_scale.z);
            float ca = cos(u_scale.z);

            vec2 rPos = vec2(ssPos.x * ca + ssPos.y * sa,
                             ssPos.x * -sa + ssPos.y * ca);

            v_pos = rPos + u_vec0.zw + u_vec0.xy;

            vec2 cs = ((v_pos / u_res) * 2.0) - 1.0;
            gl_Position = vec4(cs, 0.0, 1.0);

            v_uv0 = u_uvOffset + (a_uv0 * u_uvTile);
        }
    `,

    // Fragment shader code shared by both lit shaders: the uniforms and lightAll()
    FS: `
        uniform vec4 u_ambient;
        uniform vec4 u_lightPos0;
        uniform vec4 u_lightPos1;
        uniform vec4 u_lightPos2;
        uniform vec4 u_lightPos3;
        uniform vec4 u_lightColor0;
        uniform vec4 u_lightColor1;
        uniform vec4 u_lightColor2;
        uniform vec4 u_lightColor3;

        // One light's diffuse at surface point p with unit normal n
        vec3 lightOne(vec4 lightPos, vec4 lightColor, vec3 p, vec3 n) {
            if (lightColor.a <= 0.0)
                return vec3(0.0);

            vec3 l = lightPos.xyz;
            float falloff = 1.0;

            if (lightPos.w > 0.0) {
                vec3 toLight = lightPos.xyz - p;
                float dist = length(toLight);
                float f = clamp(1.0 - (dist / lightPos.w), 0.0, 1.0);

                l = toLight / max(dist, 0.0001);
                falloff = f * f;
            }

            return lightColor.rgb * (lightColor.a * falloff * max(dot(n, l), 0.0));
        }

        // Ambient plus the first u_ambient.w lights (0 - 4; 0 is ambient only), at p with unit normal n
        vec3 lightAll(vec3 p, vec3 n) {
            int count = int(u_ambient.w + 0.5);
            vec3 c = u_ambient.rgb;

            if (count >= 1) c += lightOne(u_lightPos0, u_lightColor0, p, n);
            if (count >= 2) c += lightOne(u_lightPos1, u_lightColor1, p, n);
            if (count >= 3) c += lightOne(u_lightPos2, u_lightColor2, p, n);
            if (count >= 4) c += lightOne(u_lightPos3, u_lightColor3, p, n);

            return c;
        }
    `
};

// Lit with one texture (u_tex0); every pixel faces the viewer
const LitRect2DShaderSource = {
    name: "LitRect2D",
    VS: LightingSharedSource.VS,
    FS: `#version 300 es
        precision highp float;

        uniform sampler2D u_tex0;
        uniform vec4 u_color;

        in vec2 v_uv0;
        in vec2 v_pos;
        out vec4 fragColor;
        ${LightingSharedSource.FS}
        void main() {
            vec4 c = texture(u_tex0, v_uv0);
            vec3 light = lightAll(vec3(v_pos, 0.0), vec3(0.0, 0.0, 1.0));
            fragColor = vec4(c.rgb * light, c.a) * u_color;
        }
    `
};

/*
    Lit with a texture (u_tex0) and a tangent-space normal map (u_tex1), read
    with the same UVs. The normal map is OpenGL style (green is +Y, up the
    texture), which matches textures uploaded with flipY (Texture's default).
    The normals turn with the model's rotation and flip with a negative scale.
*/
const LitNormalMapRect2DShaderSource = {
    name: "LitNormalMapRect2D",
    VS: LightingSharedSource.VS,
    FS: `#version 300 es
        precision highp float;

        uniform sampler2D u_tex0;
        uniform sampler2D u_tex1;
        uniform vec4 u_color;
        uniform vec3 u_scale;

        in vec2 v_uv0;
        in vec2 v_pos;
        out vec4 fragColor;
        ${LightingSharedSource.FS}
        void main() {
            vec4 c = texture(u_tex0, v_uv0);
            vec3 n = (texture(u_tex1, v_uv0).xyz * 2.0) - 1.0;

            // Into the view: mirror with the scale, then the vertex shader's rotation
            n.xy *= sign(u_scale.xy);

            float sa = sin(u_scale.z);
            float ca = cos(u_scale.z);
            n.xy = vec2(n.x * ca + n.y * sa, n.x * -sa + n.y * ca);

            vec3 light = lightAll(vec3(v_pos, 0.0), normalize(n));
            fragColor = vec4(c.rgb * light, c.a) * u_color;
        }
    `
};

/*
    TextGlyphs2D: Rect2D's shader plus a color per vertex (a_color, the
    glyph's color from TextGlyphs2D.setGlyphColors(); white when not set),
    multiplied with u_color, so each glyph can have its own tint.
*/
const TextGlyphs2DShaderSource = {
    name: "TextGlyphs2D",
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
    name: "Sprite",
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
    name: "Rect2DInstanced",
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
    Lit instanced Rect2D: Rect2DInstancedShaderSource lit like
    LitRect2DShaderSource, for MaterialBatcher's lit layers. Same instance
    attributes and locations, so it draws with the same mesh. The lights come
    from a LightSet (lighting.js).
*/
const LitRect2DInstancedShaderSource = {
    name: "LitRect2DInstanced",
    // Rect2DInstancedShaderSource's vertex shader, plus v_pos (the pixel's position in design units) and the instance's scale and rotation
    VS: `#version 300 es
        layout(location = 5) in vec2 a_pos;
        layout(location = 8) in vec4 a_iRect;
        layout(location = 9) in vec3 a_iScaleRot;
        layout(location = 10) in vec4 a_iColor;
        layout(location = 11) in vec4 a_iUVRect;

        uniform vec2 u_res;

        out vec2 v_uv0;
        out vec4 v_color;
        out vec2 v_pos;
        flat out vec3 v_scaleRot;

        void main() {
            vec2 halfSize = a_iRect.zw;
            vec2 ssPos = ((a_pos * halfSize * 2.0) - halfSize) * a_iScaleRot.xy;

            float sa = sin(a_iScaleRot.z);
            float ca = cos(a_iScaleRot.z);

            vec2 rPos = vec2(ssPos.x * ca + ssPos.y * sa,
                             ssPos.x * -sa + ssPos.y * ca);

            v_pos = rPos + halfSize + a_iRect.xy;

            vec2 cs = ((v_pos / u_res) * 2.0) - 1.0;
            gl_Position = vec4(cs, 0.0, 1.0);

            v_uv0 = a_iUVRect.xy + (a_pos * a_iUVRect.zw);
            v_color = a_iColor;
            v_scaleRot = a_iScaleRot;
        }
    `,
    FS: `#version 300 es
        precision highp float;

        uniform sampler2D u_tex0;

        in vec2 v_uv0;
        in vec4 v_color;
        in vec2 v_pos;
        out vec4 fragColor;
        ${LightingSharedSource.FS}
        void main() {
            vec4 c = texture(u_tex0, v_uv0);
            vec3 light = lightAll(vec3(v_pos, 0.0), vec3(0.0, 0.0, 1.0));
            fragColor = vec4(c.rgb * light, c.a) * v_color;
        }
    `
};

// Lit instanced Rect2D with a normal map in u_tex1, like LitNormalMapRect2DShaderSource; each instance's normals turn with its rotation
const LitNormalMapRect2DInstancedShaderSource = {
    name: "LitNormalMapRect2DInstanced",
    VS: LitRect2DInstancedShaderSource.VS,
    FS: `#version 300 es
        precision highp float;

        uniform sampler2D u_tex0;
        uniform sampler2D u_tex1;

        in vec2 v_uv0;
        in vec4 v_color;
        in vec2 v_pos;
        flat in vec3 v_scaleRot;
        out vec4 fragColor;
        ${LightingSharedSource.FS}
        void main() {
            vec4 c = texture(u_tex0, v_uv0);
            vec3 n = (texture(u_tex1, v_uv0).xyz * 2.0) - 1.0;

            // Into the view: mirror with the scale, then the vertex shader's rotation
            n.xy *= sign(v_scaleRot.xy);

            float sa = sin(v_scaleRot.z);
            float ca = cos(v_scaleRot.z);
            n.xy = vec2(n.x * ca + n.y * sa, n.x * -sa + n.y * ca);

            vec3 light = lightAll(vec3(v_pos, 0.0), normalize(n));
            fragColor = vec4(c.rgb * light, c.a) * v_color;
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

    Frames: u_vec1 = (cols, rows, firstFrame, frameCount) splits that part into
    a cols x rows grid, numbered row by row from the top-left like Sprite's.
    Each particle steps through frameCount frames from firstFrame, evenly over
    its life. (1, 1, 0, 1) is one frame: the whole part.

    The mesh is a unit quad (-0.5, -0.5) - (0.5, 0.5), centered on the particle.
    Per instance:
        a_iMotion (startX, startY, velX, velY)  Design units, design units per second
        a_iLife   (startTime, life, size)       Seconds, seconds, design units
        a_iColor  (r, g, b, a)
*/
const Particles2DShaderSource = {
    name: "Particles2D",
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
        uniform vec4 u_vec1; // (cols, rows, firstFrame, frameCount)
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

            // The frame for its age, then its cell in the grid; rows count down from the top, V runs up
            float cols = u_vec1.x;
            float rows = u_vec1.y;
            float frame = u_vec1.z + min(floor(t * u_vec1.w), u_vec1.w - 1.0);
            float row = floor(frame / cols);
            vec2 cell = vec2(frame - (row * cols), rows - 1.0 - row);

            v_uv0 = u_uvOffset + (((a_pos + 0.5 + cell) / vec2(cols, rows)) * u_uvTile);
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