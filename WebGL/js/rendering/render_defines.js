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

    static allAttribs = new Map();

    static getLocation(name) {
        switch(name) {
            case RenderAttributes.kUV0: return 0;
            case RenderAttributes.kUV1: return 1;
            case RenderAttributes.kUV2: return 2;
            case RenderAttributes.kUV3: return 3;
            case RenderAttributes.kPosition: return 4;
            case RenderAttributes.kNormal: return 5;
            default: return -1;
        }
    }

    static componentCount(name)
    {
        if (this.allAttribs.has(name))
            return this.allAttribs.get(name);
        else
            return 0;
    }

    static {
        this.allAttribs.set(RenderAttributes.kUV0, 2);
        this.allAttribs.set(RenderAttributes.kUV1, 2);
        this.allAttribs.set(RenderAttributes.kUV2, 2);
        this.allAttribs.set(RenderAttributes.kUV3, 2);
        this.allAttribs.set(RenderAttributes.kPosition, 3);
        this.allAttribs.set(RenderAttributes.kNormal, 3);
    }
}

class RenderUniforms
{
    // 1-component
    static kTexture0 = "u_tex0";
    static kTexture1 = "u_tex1";
    static kTexture2 = "u_tex2";
    static kTexture3 = "u_tex3";

    // 2-component
    static kUVTile = "u_uvTile"; // (X, Y) => (U = U * X, V = V * Y)
    static kUVOffset = "u_uvOffset"; // (X, Y) => (U = U + X, V = V + Y)
    static kResolution = "u_res"; // (W, H)

    // 3-component
    static kScale = "u_scale"; // (SX, SY, SZ)
    static kEulerRotation = "u_euler"; // (EX, EY, EZ) as radians

    // 4-component
    static kColor = "u_color"; // (R, G, B, A) as floats
    static kVector0 = "u_vec0"; // (X, Y, Z, W) as floats
    static kVector1 = "u_vec1"; // (X, Y, Z, W) as floats
    static kVector2 = "u_vec2"; // (X, Y, Z, W) as floats
    static kVector3 = "u_vec3"; // (X, Y, Z, W) as floats

    // Matrix
    static kMVP = "u_mvp";
    
    static allUniforms = new Map();

    static componentCount(name)
    {
        if (this.allUniforms.has(name))
            return this.allUniforms.get(name);
        else
            return 0;
    }

    static {
        this.allUniforms.set(RenderUniforms.kTexture0, 1);
        this.allUniforms.set(RenderUniforms.kTexture1, 1);
        this.allUniforms.set(RenderUniforms.kTexture2, 1);
        this.allUniforms.set(RenderUniforms.kTexture3, 1);
        this.allUniforms.set(RenderUniforms.kUVTile, 2);
        this.allUniforms.set(RenderUniforms.kUVOffset, 2);
        this.allUniforms.set(RenderUniforms.kResolution, 2);
        this.allUniforms.set(RenderUniforms.kScale, 3);
        this.allUniforms.set(RenderUniforms.kEulerRotation, 3);
        this.allUniforms.set(RenderUniforms.kColor, 4);
        this.allUniforms.set(RenderUniforms.kVector0, 4);
        this.allUniforms.set(RenderUniforms.kVector1, 4);
        this.allUniforms.set(RenderUniforms.kVector2, 4);
        this.allUniforms.set(RenderUniforms.kVector3, 4);
        this.allUniforms.set(RenderUniforms.kMVP, 16);
    }
}

class RenderMapping
{
    constructor()
    {
        this.name = ""; // Shader variable name
        this.location = -1; // Shader variable location
        this.componentCount = 0; // Number of components for variable
        this.value = null; // Data value for uniforms
    }
}
