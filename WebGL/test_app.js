let prevTS = Date.now();
let dt = 0.0;
let rotZ = 0;

let gTex = null
let gRect = null;

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

    gTex.load("./textures/test_up.png", appOnTextureLoad);
}


function appOnTextureLoad()
{
    gRect.load(gTex);
    gRect.setPos(20, 20);
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
}

function appRender()
{
    gRect.render();
}
