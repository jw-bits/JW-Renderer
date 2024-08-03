let prevTS = Date.now();
let dt = 0.0;
let rotZ = 0;

let gTex = null
let gRect = null;
let gParticles = null;

window.onload = () => {

    if (WGL.init("wglCanvas") === false)
    {
        console.error("Something really bad happened... Run!");
            return;
    }

    WGL.resizeToWindow();

    appSetup();
    appMain();
};

window.onresize = () => {
    WGL.resizeToWindow();
};

function appSetup()
{
    WGL.context.clearColor(1.0, 0.0, 0.0, 1.0);

    gTex = new Texture();
    gRect = new Rect2D();
    gParticles = new Particles2D();

    gTex.load("./textures/test_up.png", appOnTextureLoad);
}


function appOnTextureLoad()
{
    gRect.load(gTex);
    gRect.setPos(20, 20);

    let pos = new Vector2(256, 256);
    gParticles.load(64, gTex, pos, 2.5, true);
    gParticles.start(particleInit);
}

function appMain()
{
    let now = Date.now();
    dt = (now - prevTS) * 0.001;
    prevTS = now;

    appUpdate(dt);

    WGL.context.clear(WGL.context.COLOR_BUFFER_BIT | WGL.context.DEPTH_BUFFER_BIT);

    appRender();

    WGL.context.flush();

    requestAnimationFrame(appMain);
}

function appUpdate(dt)
{
    rotZ += dt;
    gRect.setRotation(rotZ);
    gParticles.update(dt);
}

function appRender()
{
    gRect.render();
    gParticles.render();
}

function particleInit(emitPos, f32PosArray, velArray)
{
    let pIdx = 0;

    for (let i = 0; i < posf32Array.length; ++i)
    {
        let xxx = Util.randomFloat(-2.0, 2.0);
        let yyy = Util.randomFloat(1.0, 4.0);

        let v = new Vector2(xxx, yyy);

        f32PosArray[pIdx + 0] = emitPos.x + v.x; 
        f32PosArray[pIdx + 1] = emitPos.y + v.y;
        pIdx += 2; 

        velArray[i] = v;
    }
}