"use strict";

/*
    Physics Test - Phase 1b of docs/physics_plan.md: bodies stepped by the
    PhysicsBatcher, held in a Scene, with debug lines over them. There's no
    collision yet (Phase 2), so falling things fall through everything; one
    that drops below the view is teleported back up top (a setPosition()).

        Boxes        Dynamic, each a Rect2D drawn on its PhysicsEntity, one with a label
                     child riding on it
        Circles      Dynamic, debug lines only (the line from the center shows them turn)
        Platform     Kinematic, at its own velocity: setLinearVelocity(), reversed at the edges
        Swinger      Kinematic, moved by its Entity: setPosition() / setRotation() each frame
        Arm          A plain Entity turning, with a static ledge child following it

    Keys:
        B / C        Drops a box / a circle from the pointer (or the top middle)
        Space        Pauses and resumes
        Right        While paused: one 1/60 s frame
        D            Toggles the debug lines
        G            Toggles gravity (the status line at the top shows whether it's on)
        R            Starts again
*/

const DESIGN_W = 1920;
const DESIGN_H = 1080;
const HUD_H = 60;
const MAX_DT = 0.1;
const STEP_SECONDS = 1.0 / 60.0;
const HELP_SIZE = 22;
const STATUS_SIZE = 22;
const BOX_SIZES = [[90, 90], [140, 70], [60, 120], [110, 110]];
const CIRCLE_RADII = [30, 45, 60];
const FLOOR_Y = -150;                    // Below this a body goes back to the top

const Colors = {
    kBackground: new Vector4(0.12, 0.13, 0.16, 1.0),
    kBoxes: [new Vector4(0.85, 0.45, 0.35, 1.0), new Vector4(0.35, 0.6, 0.85, 1.0), new Vector4(0.9, 0.75, 0.3, 1.0), new Vector4(0.5, 0.8, 0.5, 1.0)],
    kPlatform: new Vector4(0.45, 0.5, 0.9, 1.0),
    kSwinger: new Vector4(0.6, 0.45, 0.85, 1.0),
    kLedge: new Vector4(0.4, 0.75, 0.45, 1.0),
    kText: new Vector4(0.92, 0.92, 0.95, 1.0),
    kHelp: new Vector4(0.7, 0.72, 0.78, 1.0)
};

const Layers = {
    kWorld: 1,
    kDebug: 2,
    kText: 3
};

let gBatcher = null;
let gPhysics = null;
let gScene = null;
let gRects = new Map();      // "w x h" -> a centered white Rect2D, shared (see rectFor())
let gHelp = null;
let gStatus = null;
let gPlatform = null;
let gSwinger = null;
let gArm = null;
let gTime = 0.0;
let gIsPaused = false;
let gShowDebug = true;
let gHasGravity = true;
let gSpawned = 0;
let gPrevTS = 0.0;

const gInputListener = { onInputEvent: (e) => onInputEvent(e) };

// *** App ***

window.onload = () => {
    if (WGLV.init("wglCanvas") === false)
    {
        console.error("WebGL2 couldn't be initialized");
            return;
    }

    WGLV.setDesignResolution(DESIGN_W, DESIGN_H);
    WGLV.setBarColor(Colors.kBackground);
    WGLV.setClearColor(Colors.kBackground);
    WGLV.resizeToWindow();

    gBatcher = new Batcher();
    gPhysics = new PhysicsBatcher();         // 100 design units per meter
    gPhysics.load();
    gPhysics.setDebugLineWidth(2.0);

    gHelp = makeText("", HELP_SIZE, Colors.kHelp, DESIGN_W / 2, HUD_H / 2);
    gStatus = makeText(" ", STATUS_SIZE, Colors.kText, DESIGN_W / 2, DESIGN_H - 30);

    buildScene();

    InputManager.init();
    InputManager.addListener(gInputListener);

    gPrevTS = performance.now();
    requestAnimationFrame(appMain);
};

window.onresize = () => WGLV.resizeToWindow();

function appMain(ts)
{
    const dt = MathUtil.clamp((ts - gPrevTS) * MathDefines.kSecondsPerMs, 0.0, MAX_DT);
    gPrevTS = ts;

    InputManager.update();

    if (gIsPaused === false)
        appUpdate(dt);

    appRender();
    requestAnimationFrame(appMain);
}

// One frame: the game logic (the Scene's update), then physics, as docs/physics_plan.md's frame order
function appUpdate(dt)
{
    gTime += dt;

    // The swinger: moved by its Entity, so the batcher gives it the velocity to get there
    gSwinger.setPosition(1450 + (Math.sin(gTime * 1.3) * 220), 620 + (Math.cos(gTime * 2.6) * 60));
    gSwinger.setRotation(Math.sin(gTime * 1.3) * 0.6);

    // The arm: a plain Entity turning; its static ledge child follows it
    gArm.setRotation(Math.sin(gTime * 0.8) * 0.5);

    // The platform: at its own velocity, turned round at the edges
    const px = gPlatform.getBodyPosition().x;
    const vx = gPlatform.getLinearVelocity().x;

    if ((px > 1100 && vx > 0) || (px < 300 && vx < 0))
        gPlatform.setLinearVelocity(-vx, 0);

    gScene.update(dt);

    // Anything that fell out of view goes back to the top
    for (let i = 0; i < gScene.getCount(); ++i)
    {
        const e = gScene.getEntity(i);

        if (e instanceof PhysicsEntity && e.getBodyType() === PhysicsBodyType.kDynamic && e.getBodyPosition().y < FLOOR_Y)
            e.setPosition(300 + Math.random() * (DESIGN_W - 600), DESIGN_H + 100);
    }

    gPhysics.update(dt);
}

function appRender()
{
    WGLV.beginFrame();
    ClipSpace.beginFrame();

    gScene.submit(gBatcher);

    if (gShowDebug === true)
        gPhysics.submitDebug(gBatcher, Layers.kDebug);

    updateStatus();
    gStatus.submit(gBatcher, Layers.kText);
    gHelp.submit(gBatcher, Layers.kText);
    gBatcher.render();
}

// *** Scene ***

function buildScene()
{
    gScene = new Scene();
    gTime = 0.0;
    gSpawned = 0;

    for (let i = 0; i < 6; ++i)
        spawnBox(300 + (i * 250), 700 + ((i % 3) * 120));

    for (let i = 0; i < 4; ++i)
        spawnCircle(420 + (i * 330), 950);

    // A box with a label riding on it (a plain child Entity)
    const carrier = spawnBox(960, 1000);
    const label = makeText("riding", 20, Colors.kText, 0, 0);
    carrier.addChild(label);

    // Kinematic at its own velocity
    gPlatform = new PhysicsEntity("platform");
    gPlatform.setModel(rectFor(320, 24));
    gPlatform.setColor(Colors.kPlatform);
    gPlatform.setPosition(700, 260);
    gPlatform.addBody(gPhysics, PhysicsBodyType.kKinematic);
    gPlatform.addBox(320, 24);
    gPlatform.setLinearVelocity(250, 0);
    gScene.add(gPlatform, Layers.kWorld);

    // Kinematic moved by its Entity
    gSwinger = new PhysicsEntity("swinger");
    gSwinger.setModel(rectFor(220, 30));
    gSwinger.setColor(Colors.kSwinger);
    gSwinger.setPosition(1450, 620);
    gSwinger.addBody(gPhysics, PhysicsBodyType.kKinematic);
    gSwinger.addBox(220, 30);
    gScene.add(gSwinger, Layers.kWorld);

    // A plain Entity turning, with a static ledge as its child
    gArm = new Entity("arm");
    gArm.setPosition(250, 450);
    const ledge = new PhysicsEntity("ledge");
    ledge.setModel(rectFor(260, 20));
    ledge.setColor(Colors.kLedge);
    ledge.setPosition(160, 0);
    gArm.addChild(ledge);
    ledge.addBody(gPhysics, PhysicsBodyType.kStatic);
    ledge.addBox(260, 20);
    gScene.add(gArm, Layers.kWorld);

    updateHelp();
}

function resetScene()
{
    gPhysics.unload();                       // Drops every body; then a fresh start
    gPhysics.load();
    applyGravity();
    buildScene();
}

function spawnBox(x, y)
{
    const [w, h] = BOX_SIZES[gSpawned % BOX_SIZES.length];
    const box = new PhysicsEntity("box" + gSpawned);

    box.setModel(rectFor(w, h));
    box.setColor(Colors.kBoxes[gSpawned % Colors.kBoxes.length]);
    box.setPosition(x, y);
    box.setRotation((gSpawned * 0.37) % 1.0);
    box.addBody(gPhysics, PhysicsBodyType.kDynamic, { angularDamping: 0.1 });
    box.addBox(w, h);
    box.setAngularVelocity(((gSpawned % 5) - 2) * 0.8);

    gScene.add(box, Layers.kWorld);
    ++gSpawned;
        return box;
}

function spawnCircle(x, y)
{
    const r = CIRCLE_RADII[gSpawned % CIRCLE_RADII.length];
    const ball = new PhysicsEntity("ball" + gSpawned);

    ball.setPosition(x, y);
    ball.addBody(gPhysics, PhysicsBodyType.kDynamic);
    ball.addCircle(r);
    ball.setLinearVelocity(((gSpawned % 3) - 1) * 120, 200);
    ball.setAngularVelocity(((gSpawned % 4) - 1.5) * 2.0);

    gScene.add(ball, Layers.kWorld);
    ++gSpawned;
        return ball;
}

// A centered white Rect2D of w x h, shared by every Entity of that size (each has its own color)
function rectFor(w, h)
{
    const key = `${w}x${h}`;
    let rect = gRects.get(key);

    if (rect === undefined)
    {
        rect = new Rect2D();
        rect.load(TextureManager.getWhiteTexture(), w, h);
        rect.setAlignment(Alignment.kMiddleCenter);
        gRects.set(key, rect);
    }

    return rect;
}

function applyGravity()
{
    gPhysics.setGravity(0.0, gHasGravity ? PhysicsDefines.kDefaultGravity * gPhysics.getUnitsPerMeter() : 0.0);
}

// *** HUD ***

function updateHelp()
{
    const pause = gIsPaused ? "Space: resume   Right: step" : "Space: pause";
    gHelp.getModel().setText(`B / C: drop a box / circle   ${pause}   D: toggle debug lines   G: toggle gravity   R: restart   (no collision until Phase 2)`);
}

function updateStatus()
{
    const text = `Bodies ${gPhysics.getBodyCount()}   Steps last frame ${gPhysics.getLastStepCount()}   Alpha ${gPhysics.getAlpha().toFixed(2)}` +
                 `   Gravity ${gHasGravity ? "on" : "off"}${gIsPaused ? "   (paused)" : ""}`;

    if (gStatus.getModel().getText() !== text)
        gStatus.getModel().setText(text);
}

// *** Input ***

function onInputEvent(e)
{
    if (e.hasBeenConsumed === true || e.type !== InputEventType.kKeyDown || e.isRepeat === true)
        return false;

    const p = InputManager.hasPosition() ? InputManager.getPosition() : { x: DESIGN_W / 2, y: DESIGN_H - 100 };

    if (e.code === KeyCode.kB)
        spawnBox(p.x, p.y);
    else if (e.code === KeyCode.kC)
        spawnCircle(p.x, p.y);
    else if (e.code === KeyCode.kSpace)
    {
        gIsPaused = !gIsPaused;
        updateHelp();
    }
    else if (e.code === KeyCode.kRight && gIsPaused === true)
        appUpdate(STEP_SECONDS);
    else if (e.code === KeyCode.kD)
        gShowDebug = !gShowDebug;
    else if (e.code === KeyCode.kG)
    {
        gHasGravity = !gHasGravity;
        applyGravity();
        updateHelp();
    }
    else if (e.code === KeyCode.kR)
        resetScene();
    else
        return false;

    return true;
}

// *** Helpers ***

// An Entity at (x, y) holding a centered Text2D in the default font
function makeText(text, size, color, x, y)
{
    let t = new Text2D(FontManager.getDefault(), size, "normal");
    t.setAlignment(Alignment.kMiddleCenter);
    t.setText(text.length > 0 ? text : " ");

    let e = new Entity();
    e.setModel(t);
    e.setPosition(Math.round(x), Math.round(y));
    e.setColor(color);
    return e;
}
