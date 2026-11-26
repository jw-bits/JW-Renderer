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
    it as the normal map there. Every lit shader, the batcher's included,
    reads the same Lights uniform block, so this is usually all that's needed:

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
    
    setPosition(x, y, z) { this.#position.setXYZ(x, y, z); } // Design units; negative z is behind the 2D view, positive in front
    setColor(color) { this.#color.set(color); } // (r, g, b) 0 - 1, copied from a Vector3 (or a Vector4; its w is ignored)
    setEnabled(enabled) { this.#isEnabled = (enabled === true); }

    getShaderPosition(out) { return out; } // The light's u_lightPosN value, written into out (a Vector4) and returned; used by LightSet
    getPosition() { return this.#position; } // Read-only; change it with setPosition()
    getColor() { return this.#color; }       // Read-only; change it with setColor()
    getIntensity() { return this.#intensity; }

    isEnabled() { return this.#isEnabled; }
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

        out.setXYZW(p.x, p.y, p.z, this.#range);
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

    setTarget(x, y, z) { this.#target.setXYZ(x, y, z); }
    
    getTarget() { return this.#target; } // Read-only; change it with setTarget()

    // The way it shines, from its position toward its target, normalized; written into out (a Vector3) and returned
    getDirection(out = new Vector3())
    {
        const p = this.getPosition();
        const t = this.#target;

        out.setXYZ(t.x - p.x, t.y - p.y, t.z - p.z);

        if (out.lengthSquared() <= MathDefines.kEpsilon)
            out.setXYZ(0.0, 0.0, -1.0); // Same point: shine into the view

        out.normalize();
            return out;
    }

    // (direction toward the light, 0)
    getShaderPosition(out)
    {
        const d = this.getDirection(DirectionalLight.#kScratch);

        out.setXYZW(-d.x, -d.y, -d.z, 0.0);
            return out;
    }
}

/*
    LightSet - An ambient color and up to kMaxLights lights, for the lit
    shaders.

    Every lit shader reads its lights from one Lights uniform block (see
    RenderUniformBlocks), held in a single UniformBuffer shared by all of
    them. apply() writes this set into it: one upload per frame (after the
    lights move, before drawing) whatever the number of lit shaders, and a
    shader built later reads it too. Any shader declaring the block (see
    LightingSharedSource) gets the lights without being told about them.

    There is one Lights block, so the last LightSet applied lights everything
    drawn after it. Until the first apply() it's all zeros: lit models draw
    black.

    getShader() and getNormalMapShader() are the lit shaders (built the first
    time they're asked for); build Materials for lit models on them.

    The ambient color is used as is (its intensity is always 1). The enabled
    lights with an intensity above 0 go into the first slots, and u_ambient's w
    is how many there are, so the shaders skip the empty slots.
*/
class LightSet
{
    static kMaxLights = 4; // The Lights block's u_lightPos[4] / u_lightColor[4]

    // The Lights block, std140 (see RenderUniformBlocks): u_ambient, then 4 positions, then 4 colors
    static #kFloatCount = 36;
    static #kPosFloat = 4;
    static #kColorFloat = 20;

    static #buffer = null; // UniformBuffer, made on first use
    static #data = new Float32Array(LightSet.#kFloatCount);

    // Scratch for apply()
    static #kPos = new Vector4();

    #lights;
    #ambient;  // Vector4, (r, g, b, lightCount); apply() sets the count, 1 until then

    constructor()
    {
        this.#lights = [];
        this.#ambient = new Vector4(0.2, 0.2, 0.2, 1.0);
    }

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

    // color is (r, g, b) 0 - 1 (a Vector3, or a Vector4 with w ignored), copied and used as is
    setAmbient(color) { this.#ambient.setRGBA(color.x, color.y, color.z, this.#ambient.w); }

    getAmbient() { return this.#ambient; } // Read-only (w is the light count); change it with setAmbient()
    getLights() { return this.#lights; } // Read-only; change them with add(), remove() and clear()
    getCount() { return this.#lights.length; }

    /*
        Writes the ambient and the lights into the Lights block, in one upload that
        every lit shader reads. Enabled lights with intensity > 0 fill the first
        slots and their count goes in u_ambient's w; the rest are zeros. Binds no
        shader. Returns false if the block's buffer couldn't be made.
    */
    apply()
    {
        if (LightSet.#ensureBuffer() === false)
            return false;

        let d = LightSet.#data;
        const pos = LightSet.#kPos;
        let count = 0;

        d.fill(0.0);

        for (const light of this.#lights)
        {
            if (light.isEnabled() === false || light.getIntensity() <= 0.0)
                continue; // It would add nothing

            const c = light.getColor();
            const p = LightSet.#kPosFloat + (count * 4);
            const k = LightSet.#kColorFloat + (count * 4);

            light.getShaderPosition(pos);
            d[p] = pos.x;
            d[p + 1] = pos.y;
            d[p + 2] = pos.z;
            d[p + 3] = pos.w;
            d[k] = c.x;
            d[k + 1] = c.y;
            d[k + 2] = c.z;
            d[k + 3] = light.getIntensity();
            ++count;
        }

        const a = this.#ambient;
        a.w = count; // 0: the shaders use the ambient only
        d[0] = a.x;
        d[1] = a.y;
        d[2] = a.z;
        d[3] = a.w;

        return LightSet.#buffer.update(d);
    }

    /*
        The Lights block's buffer provider (see RenderUniformBlocks), called by WGLV.init():
        the first time, creates the buffer (all zeros until apply()) at the block's binding
        point; afterwards returns right away.
    */
    static uploadBuffer() { return LightSet.#ensureBuffer(); }

    // Frees the Lights block's buffer; the next apply() makes it again
    static unload()
    {
        if (LightSet.#buffer !== null)
            LightSet.#buffer.unload();

        LightSet.#buffer = null;
    }

    // The lit shader with one texture (null if it can't be built)
    static getShader() { return ShaderManager.get(LitRect2DShaderSource); }

    // The lit shader with a texture (unit 0) and a normal map (unit 1) (null if it can't be built)
    static getNormalMapShader() { return ShaderManager.get(LitNormalMapRect2DShaderSource); }

    // Batcher's lit instanced shaders, one texture or with a normal map (null if it can't be built)
    static getInstancedShader() { return ShaderManager.get(LitRect2DInstancedShaderSource); }
    static getInstancedNormalMapShader() { return ShaderManager.get(LitNormalMapRect2DInstancedShaderSource); }

    // *** Internal Methods ***

    // Makes the Lights block's buffer the first time; false if it can't be
    static #ensureBuffer()
    {
        if (LightSet.#buffer !== null)
            return true;

        if (WGLV.context === null)
        {
            console.error("LightSet needs WGLV.init() first");
                return false;
        }

        let buffer = new UniformBuffer();

        if (buffer.load(RenderUniformBlocks.kLights, LightSet.#kFloatCount) === false)
            return false;

        LightSet.#buffer = buffer;
            return true;
    }
}

// The Lights block's buffer is made by WGLV.init(), so every shader declaring it finds it at the binding point (see RenderUniformBlocks)
RenderUniformBlocks.setBufferProvider(RenderUniformBlocks.kLights, LightSet.uploadBuffer);
