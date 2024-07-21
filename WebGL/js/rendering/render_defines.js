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

    static allAttribs = [];

    static componentCount(name)
    {
        for (let i = 0; i < this.allAttribs.length; ++i)
        {
            let n = this.allAttribs[i];

            if (n === name)
            {
                if (i <= 3)
                    return 2;
                else
                    return 3; 
            }
        }

        return 0;
    }

    static {
        this.allAttribs.push(RenderAttributes.kUV0);
        this.allAttribs.push(RenderAttributes.kUV1);
        this.allAttribs.push(RenderAttributes.kUV2);
        this.allAttribs.push(RenderAttributes.kUV3);
        this.allAttribs.push(RenderAttributes.kPosition);
        this.allAttribs.push(RenderAttributes.kNormal);
    }
}

class RenderUniforms
{
    // 1-component
    static kTexture0 = "u_tex0";
    static kTexture1 = "u_tex1";
    static kTexture2 = "u_tex2";
    static kTexture3 = "u_tex3";
    static #kOneEnd = 4;

    // 2-component
    static kUVTile = "u_uvTile"; // (X, Y) => (U = U * X, V = V * Y)
    static kUVOffset = "u_uvOffset"; // (X, Y) => (U = U + X, V = V + Y)
    static kResolution = "u_res"; // (W, H)
    static #kTwoEnd = 7;

    // 3-component
    static kScale = "u_scale"; // (SX, SY, SZ)
    static kEulerRotation = "u_euler"; // (EX, EY, EZ) as radians
    static #kThreeEnd = 9;

    // 4-component
    static kColor = "u_color"; // (R, G, B, A) as floats
    static kVector0 = "u_vec0"; // (X, Y, Z, W) as floats
    static kVector1 = "u_vec1"; // (X, Y, Z, W) as floats
    static kVector2 = "u_vec2"; // (X, Y, Z, W) as floats
    static kVector3 = "u_vec3"; // (X, Y, Z, W) as floats
    
    static allUniforms = [];

    static componentCount(name)
    {
        for (let i = 0; i < this.allUniforms.length; ++i)
        {
            let n = this.allUniforms[i];

            if (n === name)
            {
                if (i < RenderUniforms.#kOneEnd)
                    return 1;
                else if (i < RenderUniforms.#kTwoEnd)
                    return 2;
                else if (i < RenderUniforms.#kThreeEnd)
                    return 3;
                else
                    return 4;
            }
        }

        return 0;
    }

    static {
        this.allUniforms.push(RenderUniforms.kTexture0);
        this.allUniforms.push(RenderUniforms.kTexture1);
        this.allUniforms.push(RenderUniforms.kTexture2);
        this.allUniforms.push(RenderUniforms.kTexture3);
        this.allUniforms.push(RenderUniforms.kUVTile);
        this.allUniforms.push(RenderUniforms.kUVOffset);
        this.allUniforms.push(RenderUniforms.kResolution);
        this.allUniforms.push(RenderUniforms.kScale);
        this.allUniforms.push(RenderUniforms.kEulerRotation);
        this.allUniforms.push(RenderUniforms.kColor);
        this.allUniforms.push(RenderUniforms.kVector0);
        this.allUniforms.push(RenderUniforms.kVector1);
        this.allUniforms.push(RenderUniforms.kVector2);
        this.allUniforms.push(RenderUniforms.kVector3);
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

