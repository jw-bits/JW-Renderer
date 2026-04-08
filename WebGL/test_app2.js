"use strict";

let prevTS = Date.now();
let dt = 0.0;

let gTex = null;
let gCube = null;
let gCamera = null;
let gRT = null;
let gGlowQuad = null;
let gGlowMaterial = null;

window.onload = () => {
    if (WGL.init("wglCanvas") === false) {
        console.error("Renderer initialization failed");
        return;
    }
    WGL.resizeToWindow();
    appSetup();
    appMain();
};

window.onresize = () => {
    WGL.resizeToWindow();
    // Re-initialize RenderTarget on resize to match screen resolution
    if (gRT) {
        gRT.unload();
        gRT.load(WGL.context.canvas.width, WGL.context.canvas.height);
    }
};

function appSetup() {
    WGL.context.clearColor(0.05, 0.05, 0.1, 1.0); // Darker background for better glow
    WGL.context.enable(WGL.context.DEPTH_TEST);

    gCamera = new Camera();
    gCamera.setEye(0, 1.5, 4.0);
    gCamera.setTarget(0, 0, 0);

    // Create the off-screen target
    gRT = new RenderTarget();
    gRT.load(WGL.context.canvas.width, WGL.context.canvas.height);

    gTex = new Texture();
    gCube = new Model();
    gTex.load("./textures/test_up.png", appOnResourcesLoad);
}

function appOnResourcesLoad() {
    // 1. Setup the Cube
    gCube.load(Shapes.makeCube(1.0), gTex);
    gCube.setPos(0, 0, 0);

    // 2. Setup the Post-Process Glow Pass
    let glowShader = new Shader();
    if (glowShader.load(GlowShaderSource.VS, GlowShaderSource.FS)) {
        // Create a mock texture object to interface the RT with the Material system
        const rtTextureProxy = {
            bind: () => gRT.bindAsTexture(0),
            isLoaded: () => true,
            unload: () => {}
        };

        gGlowMaterial = new Material();
        gGlowMaterial.load(glowShader, [rtTextureProxy]);
        
        // Use NDC -1 to 1 quad to fill the screen
        gGlowQuad = Shapes.makeQuad(-1.0, -1.0, 0.0, 2.0, 2.0);
        gGlowQuad.bindMaterial(gGlowMaterial);
    }
}

function appMain() {
    let now = Date.now();
    dt = (now - prevTS) * 0.001;
    prevTS = now;

    appUpdate(dt);
    appRender();

    requestAnimationFrame(appMain);
}

function appUpdate(dt) {
    // Spin slowly around +Y axis
    gCube.rotate(0, dt * 0.8, 0);
}

function appRender() {
    if (!gGlowQuad) return;

    let aspect = WGL.context.canvas.width / WGL.context.canvas.height;
    let proj = Matrix4.perspectiveMatrix(Util.degToRad(45), aspect, 0.1, 100.0);
    let view = gCamera.getViewMatrix();
    let viewProj = Matrix4.multiply(proj, view);

    // --- Pass 1: Render Cube to RenderTarget ---
    gRT.bind();
    WGL.context.clear(WGL.context.COLOR_BUFFER_BIT | WGL.context.DEPTH_BUFFER_BIT);
    gCube.render(viewProj);
    gRT.unbind();

    // --- Pass 2: Render Target to Screen with Glow Shader ---
    WGL.context.clear(WGL.context.COLOR_BUFFER_BIT | WGL.context.DEPTH_BUFFER_BIT);
    
    gGlowMaterial.bindShader();
    gGlowMaterial.bindUniforms();

    // Since we are rendering a full-screen NDC quad, 
    // we don't need a transformation matrix (identity).
    gGlowQuad.render();

    WGL.context.flush();
}