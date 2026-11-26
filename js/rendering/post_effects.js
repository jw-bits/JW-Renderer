"use strict";

/*
    Post-processing: effects run over a picture already drawn into a
    RenderTarget (render_target.js), on its way to the screen.

        FullscreenPass     Draws a shader over the whole surface (or a rect of it); the building block
        PostEffect         Base class for an effect; subclasses below
        BlurEffect         Gaussian blur, at a lower resolution
        BloomEffect        Bright parts glow
        ScreenEffect       Color grading (exposure, contrast, saturation, tint, LUT), vignette, and a
                           CRT look (scanlines, curvature, color fringes), all in one pass
        PostChain          Draws a scene into a target, then through its effects to where it was going
        ScreenTransition   Wipes, fades and dissolves from a captured frame to the new one

    Usage, the whole screen:
        let post = new PostChain();
        post.load();                                  // A view-sized target
        let bloom = new BloomEffect();
        let screen = new ScreenEffect();
        screen.setVignette(0.5);
        post.addEffect(bloom);
        post.addEffect(screen);

        // Each frame
        post.begin(clearColor);
        batcher.render();                             // Any number of batchers, or anything else
        post.end();                                   // Through bloom, then the screen effect, to the canvas

    Or only some of a batcher's layers, e.g. everything but the HUD:
        batcher.setLayerPost(Layers.kWorld, Layers.kEffects, post);

    Chains nest: a chain begun inside another draws into the outer one's
    target. A chain with setRect() works on just that design rect of the
    screen, and draws back into it.

    Premultiplied: what's drawn into a target with BlendMode.kAlpha is
    premultiplied (see render_target.js), so every effect reads and writes
    premultiplied colors and the result is drawn over what's under it with
    BlendMode.kPremultiplied. Transparent parts stay see-through; pass an
    opaque clear color to begin() for effects like the vignette to darken
    the background too.

    Phones: every pass reads and writes whole targets, so blur and bloom work
    at a half or a quarter of the size, and the grading, vignette and CRT
    look share a single pass. All passes use highp, so coordinates stay
    exact on large targets.
*/

// Shader sources. Every pass draws one triangle covering the viewport from gl_VertexID, with no buffers.
const FullscreenSharedSource = {
    name: "FullscreenShared", // Code shared by the pass shaders, not a shader of its own
    VS: `#version 300 es
        precision highp float;

        out vec2 v_uv;

        void main() {
            vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); // (0, 0), (2, 0), (0, 2)
            v_uv = p;
            gl_Position = vec4((p * 2.0) - 1.0, 0.0, 1.0);
        }
    `
};

// The texture, times u_color (premultiplied, so (a, a, a, a) fades it)
const PostCopyShaderSource = {
    name: "PostCopy",
    VS: FullscreenSharedSource.VS,
    FS: `#version 300 es
        precision highp float;

        uniform sampler2D u_tex0;
        uniform vec4 u_color;

        in vec2 v_uv;
        out vec4 fragColor;

        void main() {
            fragColor = texture(u_tex0, v_uv) * u_color;
        }
    `
};

// One direction of a 9-tap Gaussian in 5 samples (linear filtering reads two texels per sample); u_step is one texel that way, times the spread
const PostBlurShaderSource = {
    name: "PostBlur",
    VS: FullscreenSharedSource.VS,
    FS: `#version 300 es
        precision highp float;

        uniform sampler2D u_tex0;
        uniform vec2 u_step;

        in vec2 v_uv;
        out vec4 fragColor;

        void main() {
            vec2 o1 = u_step * 1.3846153846;
            vec2 o2 = u_step * 3.2307692308;

            vec4 c = texture(u_tex0, v_uv) * 0.2270270270;
            c += (texture(u_tex0, v_uv + o1) + texture(u_tex0, v_uv - o1)) * 0.3162162162;
            c += (texture(u_tex0, v_uv + o2) + texture(u_tex0, v_uv - o2)) * 0.0702702703;
            fragColor = c;
        }
    `
};

// Keeps what's brighter than the threshold, with a soft knee (u_threshold: threshold, knee)
const PostBrightShaderSource = {
    name: "PostBright",
    VS: FullscreenSharedSource.VS,
    FS: `#version 300 es
        precision highp float;

        uniform sampler2D u_tex0;
        uniform vec2 u_threshold;

        in vec2 v_uv;
        out vec4 fragColor;

        void main() {
            vec4 c = texture(u_tex0, v_uv);
            float b = max(c.r, max(c.g, c.b));
            float knee = max(u_threshold.y, 0.0001);
            float soft = clamp(b - u_threshold.x + knee, 0.0, 2.0 * knee);
            soft = (soft * soft) / (4.0 * knee);
            float w = max(soft, b - u_threshold.x) / max(b, 0.0001);
            fragColor = vec4(c.rgb * w, 1.0);
        }
    `
};

// The scene (u_tex0) plus the blurred bright parts (u_tex1) times u_intensity, times u_color
const PostBloomShaderSource = {
    name: "PostBloom",
    VS: FullscreenSharedSource.VS,
    FS: `#version 300 es
        precision highp float;

        uniform sampler2D u_tex0;
        uniform sampler2D u_tex1;
        uniform float u_intensity;
        uniform vec4 u_color;

        in vec2 v_uv;
        out vec4 fragColor;

        void main() {
            vec4 s = texture(u_tex0, v_uv);
            vec3 b = texture(u_tex1, v_uv).rgb * u_intensity;
            float glow = clamp(max(b.r, max(b.g, b.b)), 0.0, 1.0); // Glows show over transparent parts too
            fragColor = vec4(s.rgb + b, max(s.a, glow)) * u_color;
        }
    `
};

/*
    Grading, vignette and CRT in one pass:
        u_grade     (exposure, contrast, saturation, LUT amount)
        u_tint      Multiplies the color
        u_vignette  (amount, radius, softness, aspect)
        u_crt       (curvature, scanline amount, scanline count, color fringe)
        u_tex1      LUT: a strip of u_lutSize squares, u_lutSize x u_lutSize each, blue across the squares
*/
const PostScreenShaderSource = {
    name: "PostScreen",
    VS: FullscreenSharedSource.VS,
    FS: `#version 300 es
        precision highp float;

        uniform sampler2D u_tex0;
        uniform sampler2D u_tex1;
        uniform vec4 u_grade;
        uniform vec3 u_tint;
        uniform vec4 u_vignette;
        uniform vec4 u_crt;
        uniform float u_lutSize;
        uniform vec4 u_color;

        in vec2 v_uv;
        out vec4 fragColor;

        vec3 lookUp(vec3 c) {
            float n = u_lutSize;
            float slice = c.b * (n - 1.0);
            float s0 = floor(slice);
            float s1 = min(s0 + 1.0, n - 1.0);
            float x = ((c.r * (n - 1.0)) + 0.5) / (n * n);
            float y = ((c.g * (n - 1.0)) + 0.5) / n;
            vec3 a = texture(u_tex1, vec2(x + (s0 / n), y)).rgb;
            vec3 b = texture(u_tex1, vec2(x + (s1 / n), y)).rgb;
            return mix(a, b, slice - s0);
        }

        void main() {
            vec2 uv = v_uv;

            // Curvature: bulges the picture like a tube; outside it is black
            if (u_crt.x > 0.0) {
                vec2 p = (uv * 2.0) - 1.0;
                p *= 1.0 + (u_crt.x * (p.yx * p.yx));
                uv = (p * 0.5) + 0.5;

                if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {
                    fragColor = vec4(0.0, 0.0, 0.0, 1.0) * u_color;
                    return;
                }
            }

            vec4 c = texture(u_tex0, uv);

            // Color fringes: red and blue pulled apart toward the edges
            if (u_crt.w > 0.0) {
                vec2 d = (uv - 0.5) * u_crt.w;
                c.r = texture(u_tex0, uv + d).r;
                c.b = texture(u_tex0, uv - d).b;
            }

            vec3 rgb = c.rgb / max(c.a, 0.0001); // Graded straight, not premultiplied
            rgb *= u_grade.x;
            rgb = ((rgb - 0.5) * u_grade.y) + 0.5;
            rgb = mix(vec3(dot(rgb, vec3(0.2126, 0.7152, 0.0722))), rgb, u_grade.z);
            rgb = clamp(rgb * u_tint, 0.0, 1.0);

            if (u_grade.w > 0.0)
                rgb = mix(rgb, lookUp(rgb), u_grade.w);

            if (u_crt.y > 0.0) {
                float line = 0.5 + (0.5 * sin(uv.y * u_crt.z * 6.2831853));
                rgb *= mix(1.0, line, u_crt.y);
            }

            if (u_vignette.x > 0.0) {
                vec2 p = (uv - 0.5) * vec2(u_vignette.w, 1.0);
                float d = length(p) / length(vec2(u_vignette.w, 1.0) * 0.5); // 1 at the corners
                rgb *= 1.0 - (u_vignette.x * smoothstep(u_vignette.y, u_vignette.y + u_vignette.z, d));
            }

            fragColor = vec4(rgb * c.a, c.a) * u_color;
        }
    `
};

/*
    The captured frame (u_tex0) over the new one, with less of it as u_params.x
    (progress, 0 - 1) goes up. u_params: (progress, softness, type, aspect).
    u_viewRect is the view's part of the capture (x, y, width, height in UVs:
    the capture is the whole canvas, bars included). Each type gives every
    pixel a value v (0 - 1): the pixel switches to the new frame as progress
    passes it, over softness.
*/
const PostTransitionShaderSource = {
    name: "PostTransition",
    VS: FullscreenSharedSource.VS,
    FS: `#version 300 es
        precision highp float;

        uniform sampler2D u_tex0;
        uniform sampler2D u_tex1;
        uniform vec4 u_params;
        uniform vec4 u_viewRect;

        in vec2 v_uv;
        out vec4 fragColor;

        void main() {
            float t = u_params.x;
            float s = max(u_params.y, 0.0001);
            int type = int(u_params.z + 0.5);
            float v = 0.0;

            if (type == 1) v = 1.0 - v_uv.x;        // Wipe left: the edge runs right to left
            else if (type == 2) v = v_uv.x;         // Wipe right
            else if (type == 3) v = v_uv.y;         // Wipe up
            else if (type == 4) v = 1.0 - v_uv.y;   // Wipe down
            else if (type == 5) {                   // Circle opening from the center
                vec2 p = (v_uv - 0.5) * vec2(u_params.w, 1.0);
                v = length(p) / length(vec2(u_params.w, 1.0) * 0.5);
            }
            else if (type == 6)                     // Dissolve, pixel by pixel
                v = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
            else if (type == 7)                     // Mask texture
                v = texture(u_tex1, v_uv).r;

            float isNew = (type == 0) ? t : clamp(((t * (1.0 + s)) - v) / s, 0.0, 1.0);
            fragColor = texture(u_tex0, u_viewRect.xy + (v_uv * u_viewRect.zw)) * (1.0 - isNew);
        }
    `
};

/*
    FullscreenPass - Draws a shader over the viewport of the surface being drawn
    (or a pixel rect of it): one triangle, no buffers. The shader's vertex
    shader is FullscreenSharedSource.VS, which gives it v_uv (0 - 1 across
    the viewport). Effects build on it; it's not needed for anything else.

        const shader = FullscreenPass.getShader(PostCopyShaderSource);
        shader.bind();
        FullscreenPass.bindTexture(0, texture);
        gl.uniform4f(FullscreenPass.getUniform(shader, "u_color"), 1, 1, 1, 1);
        FullscreenPass.draw(BlendMode.kPremultiplied);
*/
class FullscreenPass
{
    static #vao = null;
    static #sampler = null;           // Linear, clamped
    static #uniforms = new WeakMap(); // Shader -> Map(name -> location)
    static #contextListener = null;
    static #kWhite = new Vector4(1, 1, 1, 1);

    // The Shader for a pass source, built (by ShaderManager) the first time, with u_tex0 / u_tex1 on units 0 / 1; null if it can't be built
    static getShader(source)
    {
        const shader = ShaderManager.get(source);

        if (shader === null)
            return null;

        if (FullscreenPass.#uniforms.has(shader) === false)
        {
            const gl = WGLV.context;

            FullscreenPass.#uniforms.set(shader, new Map());
            shader.bind();
            gl.uniform1i(shader.getUniform("u_tex0"), 0); // A null location (not used) is ignored
            gl.uniform1i(shader.getUniform("u_tex1"), 1);
        }

        return shader;
    }

    // A uniform's location in a shader from getShader(), looked up once
    static getUniform(shader, name)
    {
        let locations = FullscreenPass.#uniforms.get(shader);

        if (locations === undefined)
        {
            locations = new Map();
            FullscreenPass.#uniforms.set(shader, locations);
        }

        let location = locations.get(name);

        if (location === undefined)
        {
            location = shader.getUniform(name);
            locations.set(name, location);
        }

        return location;
    }

    // Binds a BaseTexture to a unit (0 - 3) with linear, clamped filtering
    static bindTexture(unit, texture)
    {
        const gl = WGLV.context;

        if (FullscreenPass.#sampler === null)
        {
            FullscreenPass.#sampler = new Sampler();
            FullscreenPass.#listenForContext();
        }

        gl.activeTexture(gl.TEXTURE0 + unit);
        texture.bind();
        FullscreenPass.#sampler.bind(unit);
    }

    /*
        Draws the bound shader over the viewport with blendMode. viewport, if given, is a
        pixel rect ({ x, y, w, h }) of the surface to draw into instead; the surface's own
        viewport is set back afterwards.
    */
    static draw(blendMode, viewport = null)
    {
        const gl = WGLV.context;

        if (FullscreenPass.#vao === null)
        {
            FullscreenPass.#vao = gl.createVertexArray();
            FullscreenPass.#listenForContext();
        }

        RenderState.setBlendMode(blendMode);

        if (viewport !== null)
            gl.viewport(viewport.x, viewport.y, viewport.w, viewport.h);

        gl.bindVertexArray(FullscreenPass.#vao);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindVertexArray(null);

        if (viewport !== null)
            RenderTargets.bindCurrent();
    }

    // Draws texture over the viewport (or viewport, a pixel rect), times color (premultiplied; white by default)
    static copy(texture, blendMode, color = null, viewport = null)
    {
        const shader = FullscreenPass.getShader(PostCopyShaderSource);

        if (shader === null)
            return false;

        const c = color ?? FullscreenPass.#kWhite;

        shader.bind();
        FullscreenPass.bindTexture(0, texture);
        WGLV.context.uniform4f(FullscreenPass.getUniform(shader, "u_color"), c.x, c.y, c.z, c.w);
        FullscreenPass.draw(blendMode, viewport);
            return true;
    }

    // *** Internal Methods ***

    // A lost context takes the vertex array and sampler with it
    static #listenForContext()
    {
        if (FullscreenPass.#contextListener !== null)
            return;

        FullscreenPass.#contextListener = {
            onContextRestored: () => {
                FullscreenPass.#vao = null;
                FullscreenPass.#sampler = null;
                FullscreenPass.#uniforms = new WeakMap();
            }
        };

        WGLV.addListeners(FullscreenPass.#contextListener);
    }
}

/*
    PostEffect - Base class for an effect in a PostChain. A subclass overrides
    apply(), which draws its result of source into the surface being drawn.
    Effects can be turned off without taking them out of the chain.
*/
class PostEffect
{
    #isEnabled;

    constructor()
    {
        this.#isEnabled = true;
    }

    setEnabled(enabled) { this.#isEnabled = (enabled === true); }
    isEnabled() { return this.#isEnabled; }

    /*
        Draws the effect applied to source (a BaseTexture, premultiplied) over the surface
        being drawn, with blendMode, times color (premultiplied, a Vector4). viewport is
        a pixel rect ({ x, y, w, h }) to draw into, or null for the whole viewport; any
        targets the effect draws into on the way are its own business. Returns false if
        it couldn't draw.
    */
    apply(source, blendMode, color, viewport) { return false; }

    // Frees anything the effect made (the shaders are ShaderManager's, so they're left)
    unload() { }

    // *** Subclass Methods ***

    // The pool format matching source: half float if it is, so HDR colors survive
    _formatOf(source)
    {
        return (source instanceof RenderTexture && source.isFloat() === true) ? RenderTarget.kRGBA16F : RenderTarget.kRGBA8;
    }
}

/*
    BlurEffect - A Gaussian blur. It works at the source's size divided by
    downscale (2 by default: a quarter of the pixels), horizontally then
    vertically, iterations times; radius spreads each pass's samples (1 is
    the plain kernel; up to about 2 before it shows banding). Bigger blurs:
    more iterations or a bigger downscale.

        let blur = new BlurEffect();
        blur.set(1.5, 2, 2);
*/
class BlurEffect extends PostEffect
{
    #radius;
    #iterations;
    #downscale;

    constructor()
    {
        super();

        this.#radius = 1.0;
        this.#iterations = 2;
        this.#downscale = 2;
    }

    // Returns false (changing nothing) unless radius > 0, iterations is 1 or more and downscale is 1, 2, 4 or 8
    set(radius, iterations = 2, downscale = 2)
    {
        if (Number.isFinite(radius) === false || radius <= 0.0 || Number.isInteger(iterations) === false || iterations < 1 ||
            [1, 2, 4, 8].includes(downscale) === false)
        {
            console.error("BlurEffect.set() needs a radius above 0, 1 or more iterations, and a downscale of 1, 2, 4 or 8");
                return false;
        }

        this.#radius = radius;
        this.#iterations = iterations;
        this.#downscale = downscale;
            return true;
    }

    getRadius() { return this.#radius; }
    getIterations() { return this.#iterations; }
    getDownscale() { return this.#downscale; }

    apply(source, blendMode, color, viewport)
    {
        const w = Math.max(1, Math.round(source.getWidth() / this.#downscale));
        const h = Math.max(1, Math.round(source.getHeight() / this.#downscale));
        const blurred = BlurEffect.blurToTarget(source, w, h, this.#radius, this.#iterations, this._formatOf(source));

        if (blurred === null)
            return FullscreenPass.copy(source, blendMode, color, viewport); // Unblurred rather than nothing

        const drew = FullscreenPass.copy(blurred.getTexture(), blendMode, color, viewport);
        RenderTargetPool.release(blurred);
            return drew;
    }

    /*
        Blurs source into a RenderTargetPool target of width x height pixels in format and
        returns it; release() it when done. null if a target or the shader can't be made.
    */
    static blurToTarget(source, width, height, radius, iterations, format = RenderTarget.kRGBA8)
    {
        const shader = FullscreenPass.getShader(PostBlurShaderSource);
        const a = RenderTargetPool.acquire(width, height, format);
        const b = RenderTargetPool.acquire(width, height, format);

        if (shader === null || a === null || b === null)
        {
            if (a !== null) RenderTargetPool.release(a);
            if (b !== null) RenderTargetPool.release(b);
                return null;
        }

        const gl = WGLV.context;
        const step = FullscreenPass.getUniform(shader, "u_step");
        let src = source;

        for (let i = 0; i < iterations; ++i)
        {
            // Across, from src into a; then up, from a into b
            RenderTargets.push(a);
            shader.bind();
            FullscreenPass.bindTexture(0, src);
            gl.uniform2f(step, radius / src.getWidth(), 0.0);
            FullscreenPass.draw(BlendMode.kNone);
            RenderTargets.pop();

            RenderTargets.push(b);
            shader.bind();
            FullscreenPass.bindTexture(0, a.getTexture());
            gl.uniform2f(step, 0.0, radius / height);
            FullscreenPass.draw(BlendMode.kNone);
            RenderTargets.pop();

            src = b.getTexture();
        }

        RenderTargetPool.release(a);
            return b;
    }
}

/*
    BloomEffect - Bright parts glow. What's brighter than threshold (0 - 1 for
    ordinary colors; above 1 needs a kRGBA16F chain) is kept, softened over
    knee, blurred at a quarter of the size, and added back times intensity.

        let bloom = new BloomEffect();
        bloom.set(0.7, 0.2, 1.2);
        bloom.setBlur(1.5, 3);
*/
class BloomEffect extends PostEffect
{
    #threshold;
    #knee;
    #intensity;
    #radius;
    #iterations;

    constructor()
    {
        super();

        this.#threshold = 0.75;
        this.#knee = 0.25;
        this.#intensity = 1.0;
        this.#radius = 1.5;
        this.#iterations = 2;
    }

    // Returns false (changing nothing) unless they're 0 or more
    set(threshold, knee = 0.25, intensity = 1.0)
    {
        if ([threshold, knee, intensity].every((v) => Number.isFinite(v) === true && v >= 0.0) === false)
        {
            console.error("BloomEffect.set() needs a threshold, knee and intensity of 0 or more");
                return false;
        }

        this.#threshold = threshold;
        this.#knee = knee;
        this.#intensity = intensity;
            return true;
    }

    // How far the glow spreads (see BlurEffect)
    setBlur(radius, iterations = 2)
    {
        if (Number.isFinite(radius) === false || radius <= 0.0 || Number.isInteger(iterations) === false || iterations < 1)
        {
            console.error("BloomEffect.setBlur() needs a radius above 0 and 1 or more iterations");
                return false;
        }

        this.#radius = radius;
        this.#iterations = iterations;
            return true;
    }

    getThreshold() { return this.#threshold; }
    getKnee() { return this.#knee; }
    getIntensity() { return this.#intensity; }

    apply(source, blendMode, color, viewport)
    {
        const gl = WGLV.context;
        const format = this._formatOf(source);
        const bright = FullscreenPass.getShader(PostBrightShaderSource);
        const combine = FullscreenPass.getShader(PostBloomShaderSource);

        if (bright === null || combine === null)
            return FullscreenPass.copy(source, blendMode, color, viewport);

        // The bright parts at half size...
        const half = RenderTargetPool.acquire(Math.max(1, Math.round(source.getWidth() / 2)), Math.max(1, Math.round(source.getHeight() / 2)), format);

        if (half === null)
            return FullscreenPass.copy(source, blendMode, color, viewport);

        RenderTargets.push(half);
        bright.bind();
        FullscreenPass.bindTexture(0, source);
        gl.uniform2f(FullscreenPass.getUniform(bright, "u_threshold"), this.#threshold, this.#knee);
        FullscreenPass.draw(BlendMode.kNone);
        RenderTargets.pop();

        // ...blurred at quarter size...
        const glow = BlurEffect.blurToTarget(half.getTexture(), Math.max(1, Math.round(half.getWidth() / 2)),
                                             Math.max(1, Math.round(half.getHeight() / 2)), this.#radius, this.#iterations, format);
        RenderTargetPool.release(half);

        if (glow === null)
            return FullscreenPass.copy(source, blendMode, color, viewport);

        // ...added to the scene
        combine.bind();
        FullscreenPass.bindTexture(0, source);
        FullscreenPass.bindTexture(1, glow.getTexture());
        gl.uniform1f(FullscreenPass.getUniform(combine, "u_intensity"), this.#intensity);
        gl.uniform4f(FullscreenPass.getUniform(combine, "u_color"), color.x, color.y, color.z, color.w);
        FullscreenPass.draw(blendMode, viewport);

        RenderTargetPool.release(glow);
            return true;
    }
}

/*
    ScreenEffect - Color grading, a vignette and a CRT look in one pass. Every
    part starts off (or neutral); turn on what's wanted.

        Grading     setExposure(1)      Brightness multiplier
                    setContrast(1)      1 is unchanged, above 1 more contrast
                    setSaturation(1)    0 is grey, 1 unchanged, above 1 more colorful
                    setTint(rgb)        Multiplies the color (a Vector3)
                    setLUT(texture, size, amount)
                                        A color lookup table: a strip of size squares of
                                        size x size (e.g. 256 x 16 for size 16), blue
                                        increasing square to square, red across and green
                                        up each square. amount blends it in (0 - 1).
        Vignette    setVignette(amount, radius, softness)
                                        Darkens toward the corners: amount 0 - 1, starting at
                                        radius (0 center - 1 corners) over softness
        CRT         setScanlines(amount, count)  Dark lines, amount 0 - 1, count across the height
                    setCurvature(amount)         Bulges the picture; around 0.05 - 0.2
                    setColorFringe(amount)       Red and blue apart toward the edges; around 0.002 - 0.01
*/
class ScreenEffect extends PostEffect
{
    #grade;     // Vector4: exposure, contrast, saturation, LUT amount
    #tint;      // Vector3
    #vignette;  // Vector3: amount, radius, softness
    #crt;       // Vector4: curvature, scanline amount, scanline count, fringe
    #lut;       // BaseTexture or null
    #lutSize;

    constructor()
    {
        super();

        this.#grade = new Vector4(1.0, 1.0, 1.0, 0.0);
        this.#tint = new Vector3(1.0, 1.0, 1.0);
        this.#vignette = new Vector3(0.0, 0.6, 0.5);
        this.#crt = new Vector4(0.0, 0.0, 240.0, 0.0);
        this.#lut = null;
        this.#lutSize = 16;
    }

    setExposure(exposure) { return this.#setIfValid(exposure, 0.0, (v) => { this.#grade.x = v; }, "setExposure"); }
    setContrast(contrast) { return this.#setIfValid(contrast, 0.0, (v) => { this.#grade.y = v; }, "setContrast"); }
    setSaturation(saturation) { return this.#setIfValid(saturation, 0.0, (v) => { this.#grade.z = v; }, "setSaturation"); }
    setTint(rgb) { this.#tint.set(rgb); }

    // texture null turns the LUT off. Returns false (changing nothing) for a size below 2 or an amount outside 0 - 1.
    setLUT(texture, size = 16, amount = 1.0)
    {
        if (texture !== null && ((texture instanceof BaseTexture) === false || Number.isInteger(size) === false || size < 2 ||
            Number.isFinite(amount) === false || amount < 0.0 || amount > 1.0))
        {
            console.error("ScreenEffect.setLUT() needs a texture (or null), a whole number size of 2 or more and an amount of 0 - 1");
                return false;
        }

        this.#lut = texture;
        this.#lutSize = size;
        this.#grade.w = (texture !== null) ? amount : 0.0;
            return true;
    }

    setVignette(amount, radius = 0.6, softness = 0.5)
    {
        if ([amount, radius, softness].every((v) => Number.isFinite(v) === true && v >= 0.0) === false || amount > 1.0)
        {
            console.error("ScreenEffect.setVignette() needs an amount of 0 - 1 and a radius and softness of 0 or more");
                return false;
        }

        this.#vignette.setXYZ(amount, radius, softness);
            return true;
    }

    setScanlines(amount, count = 240)
    {
        if (Number.isFinite(amount) === false || amount < 0.0 || amount > 1.0 || Number.isFinite(count) === false || count <= 0.0)
        {
            console.error("ScreenEffect.setScanlines() needs an amount of 0 - 1 and a count above 0");
                return false;
        }

        this.#crt.y = amount;
        this.#crt.z = count;
            return true;
    }

    setCurvature(amount) { return this.#setIfValid(amount, 0.0, (v) => { this.#crt.x = v; }, "setCurvature"); }
    setColorFringe(amount) { return this.#setIfValid(amount, 0.0, (v) => { this.#crt.w = v; }, "setColorFringe"); }

    apply(source, blendMode, color, viewport)
    {
        const shader = FullscreenPass.getShader(PostScreenShaderSource);

        if (shader === null)
            return FullscreenPass.copy(source, blendMode, color, viewport);

        const gl = WGLV.context;
        const u = (name) => FullscreenPass.getUniform(shader, name);
        const aspect = (viewport !== null) ? (viewport.w / Math.max(1, viewport.h)) : (source.getWidth() / Math.max(1, source.getHeight()));

        shader.bind();
        FullscreenPass.bindTexture(0, source);
        FullscreenPass.bindTexture(1, this.#lut ?? TextureManager.getWhiteTexture()); // Something bound, even with no LUT

        gl.uniform4f(u("u_grade"), this.#grade.x, this.#grade.y, this.#grade.z, this.#grade.w);
        gl.uniform3f(u("u_tint"), this.#tint.x, this.#tint.y, this.#tint.z);
        gl.uniform4f(u("u_vignette"), this.#vignette.x, this.#vignette.y, this.#vignette.z, aspect);
        gl.uniform4f(u("u_crt"), this.#crt.x, this.#crt.y, this.#crt.z, this.#crt.w);
        gl.uniform1f(u("u_lutSize"), this.#lutSize);
        gl.uniform4f(u("u_color"), color.x, color.y, color.z, color.w);

        FullscreenPass.draw(blendMode, viewport);
            return true;
    }

    // *** Internal Methods ***

    #setIfValid(value, min, setter, methodName)
    {
        if (Number.isFinite(value) === false || value < min)
        {
            console.error(`ScreenEffect.${methodName}() needs a number of ${min} or more`);
                return false;
        }

        setter(value);
            return true;
    }
}

/*
    PostChain - Draws a scene into its own target, then through its effects (in
    the order added; turned-off ones skipped) to the surface it was drawn on:
    the canvas, or an outer chain's target. Effects between the first and the
    last draw into RenderTargetPool targets of the same size.

        let post = new PostChain();
        post.load({ scale: 1, format: RenderTarget.kRGBA16F, samples: 4 });
        post.addEffect(new BloomEffect());

        post.begin();       // Draws go into the chain's target from here...
        ...
        post.end();         // ...and through the effects to where they were going

    Options for load() (all optional):
        scale     Of the view's size (1 by default); 0.5 halves the work on a phone, softly
        format    RenderTarget.kRGBA8 (default) or kRGBA16F (HDR: bright colors over 1 for bloom;
                  RGBA8 if the device can't)
        samples   Multisampling for the scene, so edges stay smooth like the canvas's (0 by default)
        rect      { x, y, width, height } in design units: work on just that rect of the screen
                  (as setRect()), so the target is made at its size from the start; without it,
                  the whole view

    setRect(x, y, width, height) makes it work on just that design rect of the
    screen (its target is sized to it, at the view's scale, when the chain
    next begins); clearRect() goes back to the whole view. Moving the rect
    without changing its size doesn't remake the target. setOpacity() fades
    the result.

    Batcher.setLayerPost() runs a chain around a range of layers.
*/
class PostChain
{
    #target;
    #effects;
    #options;   // { scale, format, samples }
    #rect;      // Vector4 in design units, or null for the whole view
    #opacity;   // Vector4 (a, a, a, a): premultiplied
    #clearColor; // Vector4 begin() clears to by default
    #isActive;
    #isLoaded;
    #camera;    // The camera active before end() composites

    constructor()
    {
        this.#target = new RenderTarget();
        this.#effects = [];
        this.#options = { scale: 1.0, format: RenderTarget.kRGBA8, samples: 0 };
        this.#rect = null;
        this.#opacity = new Vector4(1, 1, 1, 1);
        this.#clearColor = new Vector4(0, 0, 0, 0);
        this.#isActive = false;
        this.#isLoaded = false;
        this.#camera = null;
    }

    // Makes its target (see the top of this class for options). Returns false on failure.
    load(options = null)
    {
        if (this.#isLoaded === true)
        {
            console.error("PostChain.load(): it's already loaded; unload() it first");
                return false;
        }

        const scale = options?.scale ?? 1.0;

        if (Number.isFinite(scale) === false || scale <= 0.0 || scale > 1.0)
        {
            console.error("PostChain.load(): scale must be above 0, up to 1");
                return false;
        }

        this.#options = { scale: scale, format: options?.format ?? RenderTarget.kRGBA8, samples: options?.samples ?? 0 };

        const r = options?.rect ?? null;

        if (r !== null && this.setRect(r.x, r.y, r.width, r.height) === false)
            return false;

        if (this.#fitTarget() === false)
            return false;

        this.#isLoaded = true;
            return true;
    }

    // Works on just this design rect of the screen. Returns false if the size isn't above 0.
    setRect(x, y, width, height)
    {
        if (Number.isFinite(x) === false || Number.isFinite(y) === false || Number.isFinite(width) === false ||
            Number.isFinite(height) === false || width <= 0.0 || height <= 0.0)
        {
            console.error("PostChain.setRect() needs a position and a size above 0");
                return false;
        }

        if (this.#rect === null)
            this.#rect = new Vector4();

        this.#rect.setXYZW(x, y, width, height);
            return true;
    }

    // Back to the whole view
    clearRect() { this.#rect = null; }
    hasRect() { return (this.#rect !== null); }

    // Fades the result: 1 (default) opaque, 0 gone
    setOpacity(opacity)
    {
        const a = MathUtil.clamp01(opacity);
        this.#opacity.setRGBA(a, a, a, a);
    }

    getOpacity() { return this.#opacity.w; }

    /*
        What begin() clears the target to when it's given no color: transparent (the
        default), or e.g. the background color, so effects like the vignette and
        scanlines cover the background too (Batcher.setLayerPost() uses it).
    */
    setClearColor(color) { this.#clearColor.set(color); }
    getClearColor() { return this.#clearColor; }

    addEffect(effect)
    {
        if ((effect instanceof PostEffect) === false)
        {
            console.error("PostChain.addEffect() needs a PostEffect");
                return false;
        }

        this.#effects.push(effect);
            return true;
    }

    removeEffect(effect)
    {
        const i = this.#effects.indexOf(effect);

        if (i !== -1)
            this.#effects.splice(i, 1);
    }

    clearEffects() { this.#effects = []; }
    getEffects() { return this.#effects; } // Read-only; change it with addEffect() and removeEffect()

    getTarget() { return this.#target; }
    isActive() { return this.#isActive; }
    isLoaded() { return this.#isLoaded; }

    // Draws go into the chain's target, cleared to clearColor (setClearColor()'s by default), until end()
    begin(clearColor = null)
    {
        if (this.#isLoaded === false)
        {
            console.error("PostChain.begin(): load() it first");
                return false;
        }

        if (this.#isActive === true)
        {
            console.error("PostChain.begin(): it's already begun");
                return false;
        }

        if (this.#fitTarget() === false || RenderTargets.push(this.#target, clearColor ?? this.#clearColor) === false)
            return false;

        this.#isActive = true;
            return true;
    }

    // Finishes the scene and draws it through the effects to where it was going
    end()
    {
        if (this.#isActive === false)
        {
            console.error("PostChain.end() without a begin()");
                return false;
        }

        this.#isActive = false;
        RenderTargets.pop();

        // The result goes straight onto the surface: no camera (or its viewport's clipping)
        this.#camera = ClipSpace.getCamera();
        ClipSpace.setCamera(null);

        const enabled = this.#effects.filter((e) => e.isEnabled() === true);
        const viewport = (this.#rect !== null) ? ClipSpace.toPixelRect(this.#rect.x, this.#rect.y, this.#rect.z, this.#rect.w) : null;
        let source = this.#target.getTexture();
        let temps = [];

        // Every effect but the last into a pool target, each from the one before
        for (let i = 0; i < enabled.length - 1; ++i)
        {
            const temp = RenderTargetPool.acquire(this.#target.getWidth(), this.#target.getHeight(), this.#target.getFormat());

            if (temp === null)
                break;

            RenderTargets.push(temp);
            enabled[i].apply(source, BlendMode.kNone, Vector4.kWhite, null);
            RenderTargets.pop();

            source = temp.getTexture();
            temps.push(temp);
        }

        // The last one onto the surface
        if (enabled.length > 0)
            enabled[enabled.length - 1].apply(source, BlendMode.kPremultiplied, this.#opacity, viewport);
        else
            FullscreenPass.copy(source, BlendMode.kPremultiplied, this.#opacity, viewport);

        for (const temp of temps)
            RenderTargetPool.release(temp);

        ClipSpace.setCamera(this.#camera);
        this.#camera = null;
            return true;
    }

    // Frees the target and the effects' resources
    unload()
    {
        for (const effect of this.#effects)
            effect.unload();

        this.#target.unload();
        this.#isLoaded = false;
        this.#isActive = false;
    }

    // *** Internal Methods ***

    // Makes (or remakes) the target to suit the rect or the view
    #fitTarget()
    {
        const t = this.#target;
        const o = this.#options;

        if (this.#rect === null)
        {
            if (t.isLoaded() === true && t.getSizeMode() === RenderTarget.kView)
                return true; // It follows the view itself

            t.unload();
            return t.loadView(o.scale, { format: o.format, samples: o.samples });
        }

        // The rect's size at the view's scale (and the chain's)
        const s = WGLV.getViewScale() * o.scale;
        const w = Math.max(1, Math.ceil(this.#rect.z * s));
        const h = Math.max(1, Math.ceil(this.#rect.w * s));

        if (t.isLoaded() === false || t.getSizeMode() !== RenderTarget.kFixed)
        {
            t.unload();

            if (t.loadFixed(w, h, { format: o.format, samples: o.samples }) === false)
                return false;
        }
        else if (t.resize(w, h) === false)
            return false;

        return t.setDesignRect(this.#rect.x, this.#rect.y, this.#rect.z, this.#rect.w);
    }
}

/*
    ScreenTransition - From one frame to the next with a fade, a wipe, an
    opening circle, a dissolve or a mask texture: the outgoing frame is
    captured from the canvas, then drawn over the new frames with less and
    less of it showing.

        let transition = new ScreenTransition();
        transition.load();

        // At the end of the last frame of the old scene (after drawing it, before
        // anything that shouldn't be in the picture, like a HUD):
        transition.capture();
        transition.start(ScreenTransition.kWipeLeft, 0.6);

        // Each frame
        transition.update(dt);
        ...draw the new scene...
        transition.render();      // While isActive(): the old frame over it

    Types: kFade, kWipeLeft / kWipeRight / kWipeUp / kWipeDown (the edge runs that
    way), kCircle (opens from the center), kDissolve (pixel by pixel), kMask (the
    red channel of setMask()'s texture: dark parts change first). softness is
    how wide the edge is, 0 - 1 of the way across.

    The whole canvas is copied as it is, into a target of its size (a
    multisampled canvas can only be copied that way), and the view is drawn
    from its part of it. The context needs alpha (WGLV's default), so the
    canvas's format matches the target's.
*/
class ScreenTransition
{
    static kFade = 0;
    static kWipeLeft = 1;
    static kWipeRight = 2;
    static kWipeUp = 3;
    static kWipeDown = 4;
    static kCircle = 5;
    static kDissolve = 6;
    static kMask = 7;

    #capture;   // RenderTarget, the canvas's size
    #viewRect;  // Vector4: the view's part of the capture, in UVs
    #hasFrame;
    #type;
    #duration;
    #time;
    #easing;
    #softness;
    #mask;      // BaseTexture or null
    #isActive;

    constructor()
    {
        this.#capture = new RenderTarget();
        this.#viewRect = new Vector4(0, 0, 1, 1);
        this.#hasFrame = false;
        this.#type = ScreenTransition.kFade;
        this.#duration = 0.5;
        this.#time = 0.0;
        this.#easing = Easing.kQuadraticInOut;
        this.#softness = 0.15;
        this.#mask = null;
        this.#isActive = false;
    }

    load() { return this.#capture.loadFixed(1, 1); } // Sized to the canvas on each capture()

    // Copies what's on the canvas now, to transition away from. Returns false if it couldn't.
    capture()
    {
        this.#hasFrame = this.#capture.copyFromCanvas();

        if (this.#hasFrame === true)
        {
            const w = this.#capture.getWidth();
            const h = this.#capture.getHeight();

            this.#viewRect.setXYZW(WGLV.getViewportX() / w, WGLV.getViewportY() / h, WGLV.getViewportWidth() / w, WGLV.getViewportHeight() / h);
        }

        return this.#hasFrame;
    }

    /*
        Starts from the captured frame: type (see the top of this class) over duration
        seconds along easing, with an edge softness wide. Returns false if there's no
        captured frame or the values aren't valid.
    */
    start(type, duration, easing = Easing.kQuadraticInOut, softness = 0.15)
    {
        if (this.#hasFrame === false)
        {
            console.error("ScreenTransition.start(): capture() a frame first");
                return false;
        }

        if (Number.isInteger(type) === false || type < ScreenTransition.kFade || type > ScreenTransition.kMask ||
            Number.isFinite(duration) === false || duration <= 0.0 || Easing.isValid(easing) === false ||
            Number.isFinite(softness) === false || softness < 0.0 || softness > 1.0)
        {
            console.error("ScreenTransition.start() needs a type such as ScreenTransition.kFade, a duration above 0, an easing and a softness of 0 - 1");
                return false;
        }

        if (type === ScreenTransition.kMask && this.#mask === null)
        {
            console.error("ScreenTransition.start(): kMask needs setMask() first");
                return false;
        }

        this.#type = type;
        this.#duration = duration;
        this.#easing = easing;
        this.#softness = softness;
        this.#time = 0.0;
        this.#isActive = true;
            return true;
    }

    // The texture kMask reads (its red channel), or null
    setMask(texture) { this.#mask = texture; }

    update(dt)
    {
        if (this.#isActive === false)
            return;

        this.#time += dt;

        if (this.#time >= this.#duration)
            this.#isActive = false;
    }

    // Stops it; the new frame shows fully
    stop() { this.#isActive = false; }

    isActive() { return this.#isActive; }

    // Eased progress, 0 (all old) - 1 (all new)
    getProgress()
    {
        if (this.#isActive === false)
            return 1.0;

        return Easing.ease(this.#easing, MathUtil.clamp01(this.#time / this.#duration));
    }

    // Draws the old frame over the surface (the canvas's view) while active
    render()
    {
        if (this.#isActive === false)
            return;

        const shader = FullscreenPass.getShader(PostTransitionShaderSource);

        if (shader === null)
            return;

        const gl = WGLV.context;
        const t = this.#capture;

        shader.bind();
        FullscreenPass.bindTexture(0, t.getTexture());
        FullscreenPass.bindTexture(1, this.#mask ?? TextureManager.getWhiteTexture());
        const r = this.#viewRect;

        gl.uniform4f(FullscreenPass.getUniform(shader, "u_params"), this.getProgress(), this.#softness, this.#type,
                     (r.z * t.getWidth()) / Math.max(1, r.w * t.getHeight())); // The view's aspect
        gl.uniform4f(FullscreenPass.getUniform(shader, "u_viewRect"), r.x, r.y, r.z, r.w);
        FullscreenPass.draw(BlendMode.kPremultiplied);
    }

    unload()
    {
        this.#capture.unload();
        this.#hasFrame = false;
        this.#isActive = false;
    }
}
