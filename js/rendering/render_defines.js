/*

 +Y
  |
  |
  |
(0,0)----+X

*/
class Alignment
{
    static kBottomLeft = 0;
    static kMiddleLeft = 1;
    static kTopLeft = 2;

    static kBottomCenter = 3;
    static kMiddleCenter = 4;
    static kTopCenter = 5;

    static kBottomRight = 6;
    static kMiddleRight = 7;
    static kTopRight = 8;

    static isValid(align) { return (Number.isInteger(align) && align >= Alignment.kBottomLeft && align <= Alignment.kTopRight); }

    // Values run bottom/middle/top in groups of left/center/right
    static getColumn(align) { return Math.floor(align / 3); } // 0 left, 1 center, 2 right
    static getRow(align) { return align % 3; }                // 0 bottom, 1 middle, 2 top

    // Where the bottom-left corner of a width x height box sits, relative to the point it's aligned on
    static offsetX(align, width) { return -width * Alignment.getColumn(align) / 2.0; }
    static offsetY(align, height) { return -height * Alignment.getRow(align) / 2.0; }
}

class RenderAttributes
{
    // 2-component
    static kUV0 = "a_uv0";
    static kUV1 = "a_uv1";
    static kUV2 = "a_uv2";
    static kUV3 = "a_uv3";

    // 3-component
    static kPosition = "a_pos";
    static kNormal = "a_norm";

    // 4-component
    static kTangent = "a_tangent"; // (X, Y, Z, W): W is the bitangent's handedness, +1 or -1
    static kColor = "a_color";

    static allAttribs = new Map(); // Name -> { count, location }; locations must match the shaders' layout(location = N)

    // -1 for a name that isn't listed
    static getLocation(name)
    {
        const a = RenderAttributes.allAttribs.get(name);
            return (a !== undefined) ? a.location : -1;
    }

    // 0 for a name that isn't listed
    static componentCount(name)
    {
        const a = RenderAttributes.allAttribs.get(name);
            return (a !== undefined) ? a.count : 0;
    }

    static {
        const all = RenderAttributes.allAttribs;

        all.set(RenderAttributes.kPosition, { count: 3, location: 0 }); // Always present; some drivers are slow when location 0 isn't an enabled array
        all.set(RenderAttributes.kUV0,      { count: 2, location: 1 });
        all.set(RenderAttributes.kUV1,      { count: 2, location: 2 });
        all.set(RenderAttributes.kUV2,      { count: 2, location: 3 });
        all.set(RenderAttributes.kUV3,      { count: 2, location: 4 });
        all.set(RenderAttributes.kNormal,   { count: 3, location: 5 });
        all.set(RenderAttributes.kTangent,  { count: 4, location: 6 });
        all.set(RenderAttributes.kColor,    { count: 4, location: 7 });
    }
}

/*
    Every per-instance attribute an instanced shader may use (see
    InstancedQuadMesh). Locations 8 - 14 are past RenderAttributes' (0 - 7),
    so a mesh's position (location 0) can be drawn alongside them.
    Shaders without a named meaning for a value pack it into a_instVec0 - a_instVec3.
*/
class InstancedAttributes
{
    // 3-component
    static kScaleRot = "a_instScaleRot"; // (scaleX, scaleY, rotation around Z as radians)

    // 4-component
    static kRect = "a_instRect";         // (x, y, width / 2, height / 2); (x, y) is the bottom-left corner
    static kColor = "a_instColor";       // (R, G, B, A) as floats
    static kVector0 = "a_instVec0";      // (X, Y, Z, W) as floats
    static kVector1 = "a_instVec1";      // (X, Y, Z, W) as floats
    static kVector2 = "a_instVec2";      // (X, Y, Z, W) as floats
    static kVector3 = "a_instVec3";      // (X, Y, Z, W) as floats

    static allAttribs = new Map(); // Name -> { count, location }; locations must match the shaders' layout(location = N)

    // -1 for a name that isn't listed
    static getLocation(name)
    {
        const a = InstancedAttributes.allAttribs.get(name);
            return (a !== undefined) ? a.location : -1;
    }

    // 0 for a name that isn't listed
    static componentCount(name)
    {
        const a = InstancedAttributes.allAttribs.get(name);
            return (a !== undefined) ? a.count : 0;
    }

    static {
        const all = InstancedAttributes.allAttribs;

        all.set(InstancedAttributes.kRect,     { count: 4, location: 8 });
        all.set(InstancedAttributes.kScaleRot, { count: 3, location: 9 });
        all.set(InstancedAttributes.kColor,    { count: 4, location: 10 });
        all.set(InstancedAttributes.kVector0,  { count: 4, location: 11 });
        all.set(InstancedAttributes.kVector1,  { count: 4, location: 12 });
        all.set(InstancedAttributes.kVector2,  { count: 4, location: 13 });
        all.set(InstancedAttributes.kVector3,  { count: 4, location: 14 });
    }
}

/*
    Every uniform name a shader may use. Material only finds uniforms listed
    here, so a new shader packs its values into these (e.g. the generic
    u_vec0 - u_vec7) rather than inventing names. Uniforms inside a uniform
    block are listed in RenderUniformBlocks instead.
*/
class RenderUniforms
{
    // 1-component: texture units (sampler2D)
    static kTexture0 = "u_tex0";
    static kTexture1 = "u_tex1";
    static kTexture2 = "u_tex2";
    static kTexture3 = "u_tex3";

    // 2-component
    static kUVTile = "u_uvTile"; // (X, Y) => (U = U * X, V = V * Y)
    static kUVOffset = "u_uvOffset"; // (X, Y) => (U = U + X, V = V + Y)

    // 3-component
    static kScale = "u_scale"; // (SX, SY, SZ)
    static kEulerRotation = "u_euler"; // (EX, EY, EZ) as radians

    // 4-component
    static kColor = "u_color"; // (R, G, B, A) as floats
    static kVector0 = "u_vec0"; // (X, Y, Z, W) as floats
    static kVector1 = "u_vec1"; // (X, Y, Z, W) as floats
    static kVector2 = "u_vec2"; // (X, Y, Z, W) as floats
    static kVector3 = "u_vec3"; // (X, Y, Z, W) as floats
    static kVector4 = "u_vec4"; // (X, Y, Z, W) as floats
    static kVector5 = "u_vec5"; // (X, Y, Z, W) as floats
    static kVector6 = "u_vec6"; // (X, Y, Z, W) as floats
    static kVector7 = "u_vec7"; // (X, Y, Z, W) as floats

    // Lighting (see LightSet in lighting.js), 4-component
    static kAmbient = "u_ambient";         // (R, G, B, light count)
    static kLightPos0 = "u_lightPos0";     // (X, Y, Z, W): a point light's position and range (W > 0), or the direction toward a directional light (W = 0)
    static kLightPos1 = "u_lightPos1";
    static kLightPos2 = "u_lightPos2";
    static kLightPos3 = "u_lightPos3";
    static kLightColor0 = "u_lightColor0"; // (R, G, B, intensity); intensity 0 is off
    static kLightColor1 = "u_lightColor1";
    static kLightColor2 = "u_lightColor2";
    static kLightColor3 = "u_lightColor3";

    // Matrix
    static kModel = "u_model"; // World 
    static kView = "u_view"; // Camera 
    static kProjection = "u_proj"; // Projection to 2D  
    static kViewProj = "u_viewProj"; // View * Projection
    static kMVP = "u_mvp"; // Model * View * Projection
    
    static allUniforms = new Map();

    static componentCount(name)
    {
        if (this.allUniforms.has(name))
            return this.allUniforms.get(name);
        else
            return 0;
    }

    // The texture unit (0 - 3) a sampler uniform is for, or -1 if it isn't one
    static textureUnit(name)
    {
        switch (name)
        {
            case RenderUniforms.kTexture0: return 0;
            case RenderUniforms.kTexture1: return 1;
            case RenderUniforms.kTexture2: return 2;
            case RenderUniforms.kTexture3: return 3;
            default: return -1;
        }
    }

    static {
        this.allUniforms.set(RenderUniforms.kTexture0, 1);
        this.allUniforms.set(RenderUniforms.kTexture1, 1);
        this.allUniforms.set(RenderUniforms.kTexture2, 1);
        this.allUniforms.set(RenderUniforms.kTexture3, 1);
        this.allUniforms.set(RenderUniforms.kUVTile, 2);
        this.allUniforms.set(RenderUniforms.kUVOffset, 2);
        this.allUniforms.set(RenderUniforms.kScale, 3);
        this.allUniforms.set(RenderUniforms.kEulerRotation, 3);
        this.allUniforms.set(RenderUniforms.kColor, 4);
        this.allUniforms.set(RenderUniforms.kVector0, 4);
        this.allUniforms.set(RenderUniforms.kVector1, 4);
        this.allUniforms.set(RenderUniforms.kVector2, 4);
        this.allUniforms.set(RenderUniforms.kVector3, 4);
        this.allUniforms.set(RenderUniforms.kVector4, 4);
        this.allUniforms.set(RenderUniforms.kVector5, 4);
        this.allUniforms.set(RenderUniforms.kVector6, 4);
        this.allUniforms.set(RenderUniforms.kVector7, 4);
        this.allUniforms.set(RenderUniforms.kAmbient, 4);
        this.allUniforms.set(RenderUniforms.kLightPos0, 4);
        this.allUniforms.set(RenderUniforms.kLightPos1, 4);
        this.allUniforms.set(RenderUniforms.kLightPos2, 4);
        this.allUniforms.set(RenderUniforms.kLightPos3, 4);
        this.allUniforms.set(RenderUniforms.kLightColor0, 4);
        this.allUniforms.set(RenderUniforms.kLightColor1, 4);
        this.allUniforms.set(RenderUniforms.kLightColor2, 4);
        this.allUniforms.set(RenderUniforms.kLightColor3, 4);
        this.allUniforms.set(RenderUniforms.kModel, 16);
        this.allUniforms.set(RenderUniforms.kView, 16);
        this.allUniforms.set(RenderUniforms.kProjection, 16);
        this.allUniforms.set(RenderUniforms.kViewProj, 16);
        this.allUniforms.set(RenderUniforms.kMVP, 16);
    }
}

/*
    Every uniform block a shader may declare, each with its own binding point.
    A block's values live in one UniformBuffer (buffers.js) that every shader
    declaring the block reads; Shader.load() connects them by name. Members of
    a block aren't Material uniforms, so they aren't in RenderUniforms.

    bufferProvider: the code that owns a block's buffer registers a function
    with setBufferProvider(). Shader.load() calls it for each block the shader
    declares, after connecting the block, so the buffer has its data at the
    binding point before anything draws with the shader. It's called once per
    shader load, so it must create and upload only the first time and return
    right away afterwards. null (the default) calls nothing.

        Frame (binding 0, see ClipSpace in render_utils.js), std140:
            mat3 u_worldToClip   World position (design units) to clip space, through the active camera
                                 and onto the surface being drawn (the canvas or a RenderTarget)
            vec2 u_res           The size of that surface's design area (the design resolution on the canvas)
*/
class RenderUniformBlocks
{
    static kFrame = "Frame";

    static allBlocks = new Map(); // Name -> { binding, bufferProvider }; bufferProvider is a function or null

    // -1 for a name that isn't listed
    static getBinding(name)
    {
        const b = RenderUniformBlocks.allBlocks.get(name);
            return (b !== undefined) ? b.binding : -1;
    }

    // The function that sends name's data to its binding point, or null
    static getBufferProvider(name)
    {
        const b = RenderUniformBlocks.allBlocks.get(name);
            return (b !== undefined) ? b.bufferProvider : null;
    }

    // Registers (or with null, removes) the function that sends name's data to its binding point. Returns false if name isn't listed.
    static setBufferProvider(name, bufferProvider)
    {
        const b = RenderUniformBlocks.allBlocks.get(name);

        if (b === undefined)
        {
            console.error(`RenderUniformBlocks.setBufferProvider(): "${name}" isn't a uniform block`);
                return false;
        }

        if (bufferProvider !== null && typeof bufferProvider !== "function")
        {
            console.error("RenderUniformBlocks.setBufferProvider() needs a function or null");
                return false;
        }

        b.bufferProvider = bufferProvider;
            return true;
    }

    static {
        RenderUniformBlocks.allBlocks.set(RenderUniformBlocks.kFrame, { binding: 0, bufferProvider: null });
    }
}

/*
    How a draw's colors combine with what's already there. Each Material has one
    (Material.setBlendMode(); kAlpha by default) and sets it when bound, through
    RenderState, so the GL is only told when it changes.

        kAlpha          Straight alpha: color * alpha over what's there. Textures and
                        colors as they're loaded. Alpha builds up, so drawing into a
                        cleared RenderTarget leaves premultiplied colors in it.
        kPremultiplied  For colors already multiplied by their alpha, like a RenderTarget's
                        texture (see above) drawn back over the screen.
        kAdditive       Adds color * alpha, brightening (glows, sparks); alpha is left alone.
        kMultiply       Multiplies what's there by the color, darkening; white changes
                        nothing, so transparent parts should be white. Alpha is left alone.
        kNone           Replaces what's there, alpha included (blending off).
*/
class BlendMode
{
    static kAlpha = 0;
    static kPremultiplied = 1;
    static kAdditive = 2;
    static kMultiply = 3;
    static kNone = 4;

    static isValid(mode) { return (Number.isInteger(mode) === true && mode >= BlendMode.kAlpha && mode <= BlendMode.kNone); }
}

// How a SpriteSequence plays through its frames
class SpritePlayMode
{
    static kOnce = 0;          // First to last frame, then stops on the last
    static kLoop = 1;          // First to last, over and over
    static kPingPong = 2;      // First to last and back again, over and over
    static kPingPongOnce = 3;  // First to last and back again, then stops on the first
}

// What a Sprite reports to its event callback (see Sprite.setEventCallback())
class SpriteEvent
{
    static kCompleted = 0; // A kOnce / kPingPongOnce sequence finished; the sprite stopped on its final frame
    static kLooped = 1;    // A kLoop / kPingPong sequence started another cycle
}
