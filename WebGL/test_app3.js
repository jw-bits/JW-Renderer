"use strict";

let prevTS = Date.now();
let dt = 0.0;

let gTex = null;
let gCamera = null;
let gParticles = null;

const PARTICLE_COUNT = 128; 
const GRAVITY = -1.0;

window.onload = () => {
    if (WGL.init("wglCanvas") === false) return;
    WGL.resizeToWindow();
    appSetup();
    appMain();
};

window.onresize = () => { WGL.resizeToWindow(); };

function appSetup() {
    WGL.context.clearColor(0.05, 0.05, 0.05, 1.0);
    WGL.context.enable(WGL.context.DEPTH_TEST);
    WGL.context.enable(WGL.context.BLEND);
    WGL.context.blendFunc(WGL.context.SRC_ALPHA, WGL.context.ONE_MINUS_SRC_ALPHA);

    gCamera = new Camera();
    gCamera.setEye(0, 0, 8);
    gCamera.setTarget(0, 0, 0);

    gTex = new Texture();

    gTex.load("./textures/circle.png", () => {
        gParticles = new ParticleSystem(PARTICLE_COUNT, gTex);
    });
}

function appMain() {
    let now = Date.now();
    dt = (now - prevTS) * 0.001;
    prevTS = now;

    if (gParticles) {
        appUpdate(dt);
        appRender();
    }

    requestAnimationFrame(appMain);
}

function appUpdate(dt) {
    // Get buffers first to avoid ReferenceErrors and hoisting issues
    const velData = gParticles.getVelocities();
    const lifeData = gParticles.getLives();
    const max = gParticles.getMaxParticles();

    // 1. Spawning at the top with random color
    if (Math.random() > 0.5) {
        let spawnPos = new Vector3(Util.randomFloat(-4, 4), 5, 0);
        let spawnVel = new Vector3(Util.randomFloat(-0.5, 0.5), Util.randomFloat(-0.5, -1.0), 0);
        let spawnLife = Util.randomFloat(4, 6);
        let spawnColor = new Vector4(Math.random(), Math.random(), Math.random(), 0.7);
        let spawnSize = Util.randomFloat(10.0, 40.0);
        gParticles.emit(spawnPos, spawnVel, spawnLife, spawnColor, spawnSize);
    }

    // 2. Physics logic
    for (let i = 0; i < max; i++) {
        if (lifeData[i] <= 0) continue;

        const i3 = i * 3;

        // Apply simple gravity
        velData[i3 + 1] += GRAVITY * dt;
    }

    gParticles.update(dt);
}

function appRender() {
    WGL.context.clear(WGL.context.COLOR_BUFFER_BIT | WGL.context.DEPTH_BUFFER_BIT);

    let aspect = WGL.context.canvas.width / WGL.context.canvas.height;
    let proj = Matrix4.perspectiveMatrix(Util.degToRad(45), aspect, 0.1, 100.0);
    let view = gCamera.getViewMatrix();
    let viewProj = Matrix4.multiply(proj, view);

    gParticles.render(viewProj);
}