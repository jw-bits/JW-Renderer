"use strict";

/*
    Lighting - Lights for the lit shaders (see LightingSharedSource).

        BaseLight         Position, color, intensity, on / off
        PointLight        Shines out from its position, fading to nothing at its range
        DirectionalLight  Shines the same way everywhere: from its position toward its target
        LightSet          An ambient color and up to 4 lights, uploaded to the lit shaders

    Coordinates are WebGL's 3D ones, in design units: the 2D view lies on the
    z = 0 plane, over +X and +Y (see WGLV). A light at negative z is behind the
    2D objects, at positive z in front of them. A surface facing the viewer
    (normal (0, 0, 1)) is only lit by lights in front of it.

    Usage:
        let lights = new LightSet();
        lights.setAmbient(new Vector3(0.15, 0.15, 0.15));

        let lamp = new PointLight(800, 500, 150); // 150 in front of the view
        lamp.setColor(new Vector3(1.0, 0.85, 0.6));
        lamp.setRange(700);
        lights.add(lamp);

        let sun = new DirectionalLight(0, 1000, 600); // Toward the origin by default
        sun.setIntensity(0.5);
        lights.add(sun);

        // Models draw lit with a Material on a lit shader
        let wall = new Material();
        wall.load(LightSet.getNormalMapShader(), [albedo, normals]);
        rect.load(wall, 400, 300);

        // Each frame, after moving lights and before drawing
        lights.apply();

    Lit layers: Batcher.setLayerLit(layer, true) lights every
    instanced model (Rect2D, Sprite, Text2D) on that layer, still batched.
    They keep their usual Materials; a Material with a second texture uses
    it as the normal map there. apply() uploads to the batcher's lit shaders
    too, so this is usually all that's needed:

        batcher.setLayerLit(0, true);
        let wall = new Material();
        wall.load(Rect2D.getDefaultShader(), [albedo, normals]); // Texture 1: the normal map
        rect.load(wall, 400, 300);
        batcher.submit(rect, 0);

    A Material on getShader() / getNormalMapShader() is lit on any layer,
    but isn't instanced, so each such model is its own draw call.
*/

/*
    BaseLight - What every light has. Subclasses say how it reaches the
    shader by overriding getShaderPosition().
*/
class BaseLight
{
    #position;  // Vector3, design units
    #color;     // Vector3, (r, g, b) 0 - 1
    #intensity; // Multiplies the color; 0 or more
    #isEnabled;

    constructor(_x = 0.0, _y = 0.0, _z = 0.0)
    {
        this.#position = new Vector3(_x, _y, _z);
        this.#color = new Vector3(1.0, 1.0, 1.0);
        this.#intensity = 1.0;
        this.#isEnabled = true;
    }

    // Design units; negative z is behind the 2D view, positive in front
    setPosition(x, y, z) { this.#position.set(x, y, z); }

    // (r, g, b) 0 - 1, copied from a Vector3 (or a Vector4; its w is ignored)
    setColor(color) { this.#color.set(color.x, color.y, color.z); }

    setIntensity(intensity)
    {
        if (Number.isFinite(intensity) === false || intensity < 0.0)
        {
            console.error(`${this.constructor.name}.setIntensity() needs an intensity of 0 or more`);
                return false;
        }

        this.#intensity = intensity;
            return true;
    }

    setEnabled(enabled) { this.#isEnabled = (enabled === true); }

    getPosition() { return this.#position; } // Read-only; change it with setPosition()
    getColor() { return this.#color; }       // Read-only; change it with setColor()
    getIntensity() { return this.#intensity; }
    isEnabled() { return this.#isEnabled; }

    // The light's u_lightPosN value, written into out (a Vector4) and returned; used by LightSet
    getShaderPosition(out) { return out; }
}

/*
    PointLight - Shines out from its position in every direction. It fades
    to nothing at its range (design units), smoothly: (1 - distance / range)^2.
*/
class PointLight extends BaseLight
{
    #range;

    constructor(_x = 0.0, _y = 0.0, _z = 0.0, _range = 500.0)
    {
        super(_x, _y, _z);

        this.#range = 500.0;
        this.setRange(_range);
    }

    // Design units, above 0
    setRange(range)
    {
        if (Number.isFinite(range) === false || range <= 0.0)
        {
            console.error("PointLight.setRange() needs a range above 0");
                return false;
        }

        this.#range = range;
            return true;
    }

    getRange() { return this.#range; }

    // (x, y, z, range)
    getShaderPosition(out)
    {
        const p = this.getPosition();

        out.set(p.x, p.y, p.z, this.#range);
            return out;
    }
}

/*
    DirectionalLight - Shines the same way everywhere, like the sun: from its
    position toward its target (the origin by default). Distance doesn't dim
    it; only the direction matters, so moving the position or the target
    aims it. If they're at the same point it shines straight into the view
    (from +Z).
*/
class DirectionalLight extends BaseLight
{
    static #kScratch = new Vector3();

    #target; // Vector3, design units

    constructor(_x = 0.0, _y = 0.0, _z = 1.0, _targetX = 0.0, _targetY = 0.0, _targetZ = 0.0)
    {
        super(_x, _y, _z);

        this.#target = new Vector3(_targetX, _targetY, _targetZ);
    }

    setTarget(x, y, z) { this.#target.set(x, y, z); }
    getTarget() { return this.#target; } // Read-only; change it with setTarget()

    // The way it shines, from its position toward its target, normalized; written into out (a Vector3) and returned
    getDirection(out = new Vector3())
    {
        const p = this.getPosition();
        const t = this.#target;

        out.set(t.x - p.x, t.y - p.y, t.z - p.z);

        if (out.lengthSquared() <= MathDefines.kEpsilon)
            out.set(0.0, 0.0, -1.0); // Same point: shine into the view

        out.normalize();
            return out;
    }

    // (direction toward the light, 0)
    getShaderPosition(out)
    {
        const d = this.getDirection(DirectionalLight.#kScratch);

        out.set(-d.x, -d.y, -d.z, 0.0);
            return out;
    }
}

/*
    LightSet - An ambient color and up to kMaxLights lights, for the lit
    shaders. Uniform values stay with a shader program, so apply() uploads
    them once per frame (after the lights move, before drawing), not once per
    model.

    getShader() and getNormalMapShader() are the lit shaders (built the first
    time they're asked for); build Materials for lit models on them. apply()
    uploads to whichever of them have been built, and to any other Shader
    passed in that declares the same uniforms (see LightingSharedSource).

    The ambient color is used as is (its intensity is always 1). The enabled
    lights with an intensity above 0 are uploaded into the first slots, and u_ambient's w is how many
    there are, so the shaders skip the empty slots.
*/
class LightSet
{
    static kMaxLights = 4; // The lit shaders' u_lightPos0 - 3 / u_lightColor0 - 3

    static #kLocations = new WeakMap(); // Shader -> its lighting uniform locations, looked up once

    // Scratch for apply()
    static #kPos = new Vector4();
    static #kColor = new Vector4();

    #lights;
    #ambient;  // Vector4, (r, g, b, lightCount); apply() sets the count, 1 until then

    constructor()
    {
        this.#lights = [];
        this.#ambient = new Vector4(0.2, 0.2, 0.2, 1.0);
    }

    // color is (r, g, b) 0 - 1 (a Vector3, or a Vector4 with w ignored), copied and used as is
    setAmbient(color) { this.#ambient.set(color.x, color.y, color.z, this.#ambient.w); }

    getAmbient() { return this.#ambient; } // Read-only (w is the light count); change it with setAmbient()

    // Returns false if it isn't a light, it's already in the set, or the set is full
    add(light)
    {
        if ((light instanceof BaseLight) === false)
        {
            console.error("LightSet.add() needs a PointLight or DirectionalLight");
                return false;
        }

        if (this.#lights.includes(light) === true)
            return false;

        if (this.#lights.length >= LightSet.kMaxLights)
        {
            console.error(`LightSet.add(): the set already has ${LightSet.kMaxLights} lights`);
                return false;
        }

        this.#lights.push(light);
            return true;
    }

    remove(light)
    {
        const i = this.#lights.indexOf(light);

        if (i === -1)
            return false;

        this.#lights.splice(i, 1);
            return true;
    }

    clear() { this.#lights.length = 0; }

    getLights() { return this.#lights; } // Read-only; change them with add(), remove() and clear()
    getCount() { return this.#lights.length; }

    /*
        Uploads the ambient and the lights to the lit shaders built so far, and
        to the Shaders in extraShaders (an array, or null). Enabled lights with
        intensity > 0 fill the first slots and their count goes in u_ambient's w; the rest upload
        as off. Leaves the last shader bound.
    */
    apply(extraShaders = null)
    {
        // Only the lit shaders built so far; one built later gets the lights from the next apply()
        let shaders = [];

        for (const source of [LitRect2DShaderSource, LitNormalMapRect2DShaderSource,
                              LitRect2DInstancedShaderSource, LitNormalMapRect2DInstancedShaderSource])
        {
            if (ShaderManager.has(source) === true)
                shaders.push(ShaderManager.get(source));
        }

        if (Array.isArray(extraShaders) === true)
            shaders.push(...extraShaders);

        for (const shader of shaders)
        {
            if (shader !== null && shader !== undefined)
                this.#upload(shader);
        }
    }

    // The lit shader with one texture (null if it can't be built)
    static getShader() { return ShaderManager.get(LitRect2DShaderSource); }

    // The lit shader with a texture (unit 0) and a normal map (unit 1) (null if it can't be built)
    static getNormalMapShader() { return ShaderManager.get(LitNormalMapRect2DShaderSource); }

    // Batcher's lit instanced shaders, one texture or with a normal map (null if it can't be built)
    static getInstancedShader() { return ShaderManager.get(LitRect2DInstancedShaderSource); }
    static getInstancedNormalMapShader() { return ShaderManager.get(LitNormalMapRect2DInstancedShaderSource); }

    // *** Internal Methods ***

    #upload(shader)
    {
        const gl = WGLV.context;
        const loc = LightSet.#getLocations(shader);
        const pos = LightSet.#kPos;
        const color = LightSet.#kColor;
        const a = this.#ambient;

        shader.bind();

        // Enabled lights with intensity > 0, packed into the first slots; the rest would add nothing
        let count = 0;

        for (const light of this.#lights)
        {
            if (light.isEnabled() === false || light.getIntensity() <= 0.0)
                continue;

            const c = light.getColor();
            light.getShaderPosition(pos);
            color.set(c.x, c.y, c.z, light.getIntensity());

            gl.uniform4f(loc.positions[count], pos.x, pos.y, pos.z, pos.w);
            gl.uniform4f(loc.colors[count], color.x, color.y, color.z, color.w);
            ++count;
        }

        // The rest off
        for (let i = count; i < LightSet.kMaxLights; ++i)
        {
            gl.uniform4f(loc.positions[i], 0.0, 0.0, 0.0, 0.0);
            gl.uniform4f(loc.colors[i], 0.0, 0.0, 0.0, 0.0);
        }

        a.w = count; // 0: the shaders use the ambient only
        gl.uniform4f(loc.ambient, a.x, a.y, a.z, a.w);
    }

    // A shader's lighting uniform locations (null for any it doesn't use; GL ignores those)
    static #getLocations(shader)
    {
        let loc = LightSet.#kLocations.get(shader);

        if (loc === undefined)
        {
            const names = [RenderUniforms.kLightPos0, RenderUniforms.kLightPos1, RenderUniforms.kLightPos2, RenderUniforms.kLightPos3];
            const colorNames = [RenderUniforms.kLightColor0, RenderUniforms.kLightColor1, RenderUniforms.kLightColor2, RenderUniforms.kLightColor3];

            loc = {
                ambient: shader.getUniform(RenderUniforms.kAmbient),
                positions: names.map((n) => shader.getUniform(n)),
                colors: colorNames.map((n) => shader.getUniform(n))
            };

            LightSet.#kLocations.set(shader, loc);
        }

        return loc;
    }
}
