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
    // 1-component
    static kPtSize = "a_ptSize";

    // 2-component
    static kUV0 = "a_uv0";
    static kUV1 = "a_uv1";
    static kUV2 = "a_uv2";
    static kUV3 = "a_uv3";

    // 3-component
    static kPosition = "a_pos";
    static kNormal = "a_norm";
    static kColor = "a_color";

    static allAttribs = new Map();

    static getLocation(name) {
        switch(name) {
            case RenderAttributes.kPtSize: return 0;
            case RenderAttributes.kUV0: return 1;
            case RenderAttributes.kUV1: return 2;
            case RenderAttributes.kUV2: return 3;
            case RenderAttributes.kUV3: return 4;
            case RenderAttributes.kPosition: return 5;
            case RenderAttributes.kNormal: return 6;
            case RenderAttributes.kColor: return 7;
            
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
        this.allAttribs.set(RenderAttributes.kColor, 4);
        this.allAttribs.set(RenderAttributes.kPtSize, 1);
    }
}

/*
    Every uniform name a shader may use. Material only finds uniforms listed
    here, so a new shader packs its values into these (e.g. the generic
    u_vec0 - u_vec3) rather than inventing names.
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
    static kVector4 = "u_vec4"; // (X, Y, Z, W) as floats
    static kVector5 = "u_vec5"; // (X, Y, Z, W) as floats
    static kVector6 = "u_vec6"; // (X, Y, Z, W) as floats
    static kVector7 = "u_vec7"; // (X, Y, Z, W) as floats

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
        this.allUniforms.set(RenderUniforms.kModel, 16);
        this.allUniforms.set(RenderUniforms.kView, 16);
        this.allUniforms.set(RenderUniforms.kProjection, 16);
        this.allUniforms.set(RenderUniforms.kViewProj, 16);
        this.allUniforms.set(RenderUniforms.kMVP, 16);
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
