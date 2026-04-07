let prevTS = Date.now();
let dt = 0.0;
let rotZ = 0;

let gTex = null;
let gCube = null;
let gCamera = null;

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
    WGL.context.enable(WGL.context.DEPTH_TEST);

    gCamera = new Camera();
    gCamera.setEye(0, 1.0, 5.0);
    gCamera.setTarget(0, 0, 0);

    gTex = new Texture();
    gCube = new Model();
    gTex.load("./textures/test_up.png", appOnTextureLoad);
}


function appOnTextureLoad()
{
    gCube.load(Shapes.makeCube(1.0), gTex);
    gCube.setPos(0, 0, -3); // Move into view
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
    gCube.rotate(0, dt * 0.5, 0); // Rotate around Y
}

function appRender()
{
    let aspect = WGL.context.canvas.width / WGL.context.canvas.height;
    let proj = Matrix4.perspectiveMatrix(Util.degToRad(45), aspect, 0.1, 100.0);
    let view = gCamera.getViewMatrix();
    let viewProj = Matrix4.multiply(proj, view);

    gCube.render(viewProj);
}

function particleInit(emitPos, posArray, velArray)
{
    let pIdx = 0;

    for (let i = 0; i < velArray.length; ++i)
    {
        let xxx = Util.randomFloat(-2.0, 2.0);
        let yyy = Util.randomFloat(1.0, 4.0);

        let v = new Vector2(xxx, yyy);

        posArray[pIdx + 0] = emitPos.x + v.x; 
        posArray[pIdx + 1] = emitPos.y + v.y;
        posArray[pIdx + 2] = 0.0;
        pIdx += 3; 

        velArray[i] = v;
    }
}