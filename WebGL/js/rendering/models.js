class Rect2D
{
    static #VS = `#version 300 es
        layout(location = 5) in vec3 a_pos;
        layout(location = 1) in vec2 a_uv0;
        
        uniform vec2 u_res;
        uniform vec3 u_scale;
        uniform vec4 u_vec0;

        out vec2 v_uv0;

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

    static #FS = `#version 300 es
        precision highp float;

        uniform sampler2D u_tex0;

        in vec2 v_uv0;
        out vec4 fragColor;

        void main() {
            vec4 c = texture(u_tex0, v_uv0);
            fragColor = c;
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

        this.#mesh = Shapes.makeQuad(0, 0, 0, this.#width, this.#height, Alignment.kBottomLeft);
        if (this.#mesh === null) return false;
        
        this.#mesh.bindMaterial(this.#material);
        let b = true;
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

        this.#material.bindUniforms();
        this.#mesh.render();
    }

    // *** Internal methods ***

}

class Particles2D
{
    static #VS = `#version 300 es
        layout(location = 5) in vec3 a_pos;
        
        uniform vec2 u_res;

        void main() {
            vec2 zTo1 = a_pos.xy / u_res;
            vec2 cs = (zTo1 * 2.0) - 1.0;

            gl_PointSize = 64.0;
            gl_Position = vec4(cs, 0.0, 1.0);
        }
    `;

    static #FS = `#version 300 es
        precision highp float;

        uniform sampler2D u_tex0;
        uniform vec4 u_color;
        out vec4 fragColor;

        void main() {
            vec4 c = texture(u_tex0, gl_PointCoord);
            fragColor = c * u_color;
        }    
    `;

    //  static #FS = `
    //      precision highp float;

    //      void main() {
    //          gl_FragColor = vec4(0.0, 1.0, 0.0, 1.0);
    //      }    
    //  `;

     // Shader
     static #kShader = null;
     
     #material;
     #mesh;

     #emitPosition;
     #duration;
     #useGravity;     
     #isLoaded;
     #isRunning;

     #deltaTime;
     #positions;
     #velocities;    
     
     constructor()
     {
         this.#material = null;
         this.#mesh = null;

         this.#emitPosition = Vector2.kZero;
         this.#duration = 0.0;
         this.#useGravity = false;
         this.#isLoaded = false;
         this.#isRunning = false;

         this.#deltaTime = 0.0;
         this.#positions = [];
         this.#velocities = [];
     }

     load(_particleCount, _texture, _emitPosition, _duration, _useGravity)
     {
        if (Particles2D.#kShader === null)
        {
            Particles2D.#kShader = new Shader();

            if (Particles2D.#kShader.load(Particles2D.#VS, Particles2D.#FS) === false)
                return false;
        }

        let ta = [_texture];
        this.#material = new Material();
        this.#mesh = new PointsMesh();

        if (this.#material.load(Particles2D.#kShader, ta) === false)
            return false;

        this.#positions = new Float32Array(_particleCount * 3);
        this.#positions.fill(0.0);
        
        this.#velocities = new Array(_particleCount);

        if (this.#mesh.set(this.#positions) === false)
            return false;

        this.#emitPosition = _emitPosition;
        this.#duration = _duration;
        this.#useGravity = _useGravity;
        this.#isLoaded = true;
            return true;
     }

     // Takes a function to do the initilization logic for the positions/veleociies of the particles
     // initFunc
     // (   
     //     origin, -- A Vector2 of where the particles should emit from  
     //     poistions[], -- A Float32Array[] of (x,y,z) tightly packed
     //     velocities[] -- An array of Vector2
     // )
     start(initFunc)
     {
        if (this.#isLoaded === false || this.#isRunning === true)
            return false;

        initFunc(this.#emitPosition, this.#positions, this.#velocities);

        this.#mesh.set(this.#positions);

        this.#isRunning = true;
        this.#deltaTime = 0.0;
            return true;
     }

     stop()
     {
        this.#isRunning = false;
     }

     update(dt)
     {
        if (this.#isRunning === true)
        {
            this.#deltaTime += dt;

            if (this.#deltaTime > this.#duration)
                this.stop();
            else
            {
                let pIdx = 0;
                let gravityForce = (this.#useGravity === true) ? -9.8 : 0.0;

                for (let i = 0; i < this.#velocities.length; ++i)
                {
                    let v = this.#velocities[i];

                    this.#positions[pIdx + 0] += (v.x * dt);
                    this.#positions[pIdx + 1] += ((v.y * dt) + (gravityForce * dt));
                    this.#positions[pIdx + 2] = 0.0;

                    pIdx += 3;
                }

                this.#mesh.set(this.#positions);
            }
        }
     }

     render()
     {
        if (this.#isRunning === true)
        {
            let res = new Vector2(WGL.context.canvas.width, WGL.context.canvas.height);
            this.#material.setUniformValue("u_res", res);
            this.#material.setUniformValue("u_color", Vector4.kWhite);
            
            this.#material.bindShader();

            this.#material.bindUniforms();
            this.#mesh.render();
        }
     }
}

class Model {
    static #kShader = null;
    
    #material;
    #mesh;
    #pos;
    #rot;
    #scale;
    #color;
    #isLoaded = false;

    constructor() {
        this.#pos = new Vector3(0, 0, 0);
        this.#rot = new Vector3(0, 0, 0);
        this.#scale = new Vector3(1, 1, 1);
        this.#color = new Vector4(1, 1, 1, 1);
    }

    load(_mesh, _texture) {
        if (Model.#kShader === null) {
            Model.#kShader = new Shader();
            if (!Model.#kShader.load(Standard3DShaderSource.VS, Standard3DShaderSource.FS)) return false;
        }
        this.#mesh = _mesh;
        this.#material = new Material();

        if (!this.#material.load(Model.#kShader, [_texture])) 
            return false;

        this.#material.setUniformValue("u_color", this.#color);

        this.#mesh.bindMaterial(this.#material);        
        this.#isLoaded = true;
            return true;
    }

    setPos(x, y, z) { this.#pos.set(x, y, z); }
    setRotation(x, y, z) { this.#rot.set(x, y, z); }
    setScale(x, y, z) { this.#scale.set(x, y, z); }
    setColor(c) { this.#color = c; }
    setAlpha(a) { this.#color.w = a; }

    getPos() { return this.#pos; }
    getRotation() { return this.#rot; }
    getScale() { return this.#scale; }
    getColor() { return this.#color; }

    translate(x, y, z) {
        this.#pos.x += x; this.#pos.y += y; this.#pos.z += z;
    }

    rotate(x, y, z) {
        this.#rot.x += x; this.#rot.y += y; this.#rot.z += z;
    }

    getModelMatrix() {
        let mTranslation = Matrix4.fromTranslation(this.#pos.x, this.#pos.y, this.#pos.z);
        let mRotX = Matrix4.fromRotationX(this.#rot.x);
        let mRotY = Matrix4.fromRotationY(this.#rot.y);
        let mRotZ = Matrix4.fromRotationZ(this.#rot.z);
        let mScale = Matrix4.fromScaling(this.#scale.x, this.#scale.y, this.#scale.z);

        return Matrix4.multiply(mTranslation, Matrix4.multiply(mRotZ, Matrix4.multiply(mRotY, Matrix4.multiply(mRotX, mScale))));
    }

    renderWithShader(viewProj, shader) {
        if (!this.#isLoaded) return;

        let model = this.getModelMatrix();
        let mvp = Matrix4.multiply(viewProj, model);

        shader.bind();
        let uMvpLoc = shader.getUniform("u_mvp");
        if (uMvpLoc) {
            WGL.context.uniformMatrix4fv(uMvpLoc, false, mvp.m);
        }

        this.#mesh.render();
    }

    render(viewProj) {
        if (!this.#isLoaded) return;

        this.#material.setUniformValue("u_color", this.#color);

        let model = this.getModelMatrix();
        let mvp = Matrix4.multiply(viewProj, model);

        this.#material.setUniformValue("u_mvp", mvp);
        this.#material.bindShader();
        
        this.#material.bindUniforms();
        this.#mesh.render();
    }
}

class Quad extends Model {
    constructor() {
        super();
    }

    load(_texture, size = 0.2) {
        // Quads in 3D are usually centered at 0,0,0
        const mesh = Shapes.makeQuad(-size/2, -size/2, 0, size, size, Alignment.kBottomLeft);
        return super.load(mesh, _texture);
    }

    // Helper to align quad to a specific cube face
    alignToFace(faceIndex, offset = 0.501) {
        this.setPos(0, 0, 0);
        this.setRotation(0, 0, 0);
        
        const randomOffset = () => Util.randomFloat(-0.3, 0.3);

        switch(faceIndex) {
            case 0: this.setPos(randomOffset(), randomOffset(), offset); break; // Front
            case 1: this.setPos(randomOffset(), randomOffset(), -offset); this.setRotation(0, Math.PI, 0); break; // Back
            case 2: this.setPos(offset, randomOffset(), randomOffset()); this.setRotation(0, Math.PI/2, 0); break; // Right
            case 3: this.setPos(-offset, randomOffset(), randomOffset()); this.setRotation(0, -Math.PI/2, 0); break; // Left
            case 4: this.setPos(randomOffset(), offset, randomOffset()); this.setRotation(-Math.PI/2, 0, 0); break; // Top
            case 5: this.setPos(randomOffset(), -offset, randomOffset()); this.setRotation(Math.PI/2, 0, 0); break; // Bottom
        }
    }
}