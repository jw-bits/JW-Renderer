class Rect2D
{
    static #VS = `
        attribute vec3 a_pos;
        attribute vec2 a_uv0;
        
        uniform vec2 u_res;
        uniform vec3 u_scale;
        uniform vec4 u_vec0;

        varying vec2 v_uv0;

        void main() {
            vec2 ssPos = ((a_pos.xy + u_vec0.xy) - u_vec0.zw) * u_scale.xy;

            float sa = sin(u_scale.z);
            float ca = cos(u_scale.z);

            vec2 rPos = vec2(ssPos.x * ca + ssPos.y * sa,
                             ssPos.x * -sa + ssPos.y * ca);

            vec2 zTo1 = (rPos + u_vec0.zw) / u_res;
            vec2 cs = (zTo1 * 2.0) - 1.0;

            gl_Position = vec4(cs, 0.0, 1.0);

            v_uv0 = a_uv0;
        }
    `;

    static #FS = `
        precision highp float;

        uniform sampler2D u_tex0;

        varying vec2 v_uv0;

        void main() {
            vec4 c = texture2D(u_tex0, v_uv0);
            gl_FragColor = c;
        }    
    `;

    // Shader
    static #kShader = null; 

    #position;
    #width;
    #height;

    #material;
    #mesh;

    #scaleX;
    #scaleY;
    #rotZ;
    #isLoaded;

    
    constructor()
    {
        this.#position = Vector2.kZero;
        this.#width = 0;
        this.#height = 0;
        this.#material = null;
        this.#mesh = null;
                 
        this.#scaleX = 1.0;
        this.#scaleY = 1.0;
        this.#rotZ = 0.0;
        this.#isLoaded = false;
    }

    load(_texture, _width, _height)
    {
        if (this.#isLoaded === true)
            return false; // Unload first

        if (_texture.isLoaded() === false)
            return false; // Invalid texture

        if (Rect2D.#kShader === null)
        {
            Rect2D.#kShader = new Shader();
            
            if (Rect2D.#kShader.load(Rect2D.#VS, Rect2D.#FS) === false)
            {
                Rect2D.#kShader = null;
                    return false;
            }
        }

        if (_width !== undefined)
            this.#width = _width;
        else
            this.#width = _texture.getWidth();

        if (_height !== undefined)
            this.#height = _height;
        else
            this.#height = _texture.getHeight();

        let ta = [_texture];

        this.#material = new Material();

        if (this.#material.load(Rect2D.#kShader, ta) === false)
            return false;

        if (Shapes.makeQuad(0, 0, 0, this.#width, this.#height, Alignment.kBottomLeft) === false)
            return false;

        this.#mesh = new StaticMesh();

        let b = true;

        b |= this.#mesh.loadVertexData(RenderAttributes.kPosition, Shapes.pos);
        b |= this.#mesh.loadVertexData(RenderAttributes.kUV0, Shapes.uvs);
        b |= this.#mesh.loadIndexBuffer(Shapes.indices);
        
        // Set other default values 
        let res = new Vector2(WGL.context.canvas.width, WGL.context.canvas.height);
        b |= this.#material.setUniformValue("u_res", res);

        let scaleAndRotZ = new Vector3(1.0, 1.0, 0.0);
        b |= this.#material.setUniformValue("u_scale", scaleAndRotZ);

        let rectPos = new Vector4(0, 0, this.#width / 2.0, this.#height / 2.0);
        b |= this.#material.setUniformValue("u_vec0", rectPos);

        this.#isLoaded = b;
            return b;      
    }
    
    setPos(x, y)
    {
        this.#position.set(x,y);

        let rectPos = new Vector4(this.#position.x, this.#position.y, this.#width / 2.0, this.#height / 2.0);
        this.#material.setUniformValue("u_vec0", rectPos);
    }

    setRotation(rotZ)
    {
        this.#rotZ = rotZ;        
        let scaleAndRotZ = new Vector3(this.#scaleX, this.#scaleY, this.#rotZ);
        this.#material?.setUniformValue("u_scale", scaleAndRotZ);
    }

    render()
    {
        if (this.#isLoaded === false)
        {
            console.log("Not loaded, skipping render");
                return;
        }

        this.#material.bindShader();

        let raa = this.#material.getRenderAttributes();

        for (let i = 0; i < raa.length; ++i)
        {
            this.#mesh.bindVertexAttribute(raa[i]);
        }

        this.#material.bindUniforms();
        this.#mesh.render();
    }

    // *** Internal methods ***

}