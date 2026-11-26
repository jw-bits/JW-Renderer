"use strict";

/*
    Performance Test - One of every Model2D type (Rect2D, RoundedRect2D,
    NinePatch2D, Sprite, Text2D, TextGlyphs2D), a Particles2D, every text
    effect (Wave, Fade, Ease, Scroll), two lit Rect2Ds, two Toggles, two
    CheckBoxes, three Buttons (tap them; see InputManager), a Camera2D
    view of a small world, and render targets: a minimap of that world, a
    CachedLayer, and bloom, blur and screen (CRT) effects each on their own
    slot, an Entity hierarchy (a sun, planets and moons, each carried by its
    parent), with a small metrics window.

    Spine (page 4, a page of its own): eight of the Spine sample skeletons
    (tools/Spine/demos/assets), each loaded with SpineSkeletonData.load(),
    animated with SpineAnimation.apply() and drawn by a Skeleton2D (its
    images), with SpineSkeletonDebug lines over them: bones in red, paths,
    bounding boxes and clipping polygons in green (see js/spine). The tank
    shows multiply blending (its shadow), the owl and spineboy additive.
    Each skeleton has its own Camera2D and Batcher (drawn from the main one):
    the camera's viewport is its slot, which also clips it, and its position
    and zoom fit the whole animation. The tank's camera follows tankRoot, as
    Spine's own demo does, so the ground and rock scroll past under it. B
    shows and hides the debug lines while page 4 is shown.

    Render targets (render_target.js, post_effects.js): pages change with a
    ScreenTransition (a wipe, circle, dissolve, fade or wipe up, in turn)
    from a capture of the old page.

    Pages: the view is a 3 x 3 grid of slots. The metrics window always has
    the upper-left slot, so each page shows up to 8 test items, one per slot,
    nothing overlapping, each with a small label under it saying what it
    tests. The items fill as many pages as they need, and the pages cycle
    every 5 seconds; space pauses and resumes that. The metrics are for the
    page shown.

    Lighting (see lighting.js): two brick Rect2Ds on a layer the batcher
    lights, one with a normal map (its Material's second texture) and one
    with just its texture. Each has a warm point light circling it in front
    of the view (shown as a small dot), and a dim cool directional light
    comes from the upper-left.

    The labels and the metrics window are drawn by the renderer (a Rect2D
    panel under TextGlyphs2Ds), in their own batcher pass after counting
    stops, so they never count towards the metrics or the overdraw.

    Metrics, per frame (the HUD refreshes a few times a second):
        FPS            Frames per second, averaged over the last half second
        Vertices       Vertex shader runs: each draw call's index (or vertex) count times its instances
        Materials      Different Materials bound
        Rectangles     Quads drawn: each instance of an instanced draw (Rect2D, Text2D, Sprite through
                       the batcher, and every particle), plus Rect2D / Sprite / Text2D drawn on their own
                       and each glyph of a TextGlyphs2D. RoundedRect2D and NinePatch2D aren't quads.
        Overdraw       Pixels drawn 2 or more times, and the share of the view that is
        Draw calls     GL draw calls (post effect passes included)
        State changes  GL state calls RenderState sent (blend mode and scissor); the ones it
                       skipped because nothing changed aren't counted
        Binds          The scene batcher's shader, texture and sampler GL calls sent, and the
                       binds it skipped because they were already bound (see BatchBinder)
        Targets      RenderTargets loaded and their GPU memory, and how many are RenderTargetPool's

    The counts come from wrapping, from here, the GL
    context's draw calls, Material.prototype.bind, BatchBinder.prototype.bindMaterial
    and Model2D.prototype.draw; Binds comes from the batcher itself.

    Overdraw: the context is created with a stencil buffer. Twice a second the
    scene is drawn one extra time with every fragment incrementing the
    stencil, then a full-view pass marks pixels with a stencil of 2 or more,
    and they're read back and counted. Transparent parts of a quad count as
    drawn (they're still rasterized and blended); clipped (scissored)
    fragments don't. The normal frame is then drawn over it, so the extra
    pass is never seen, but it does cost those frames some time. Only the
    canvas has a stencil buffer, so what's drawn into render targets counts
    once, as the pass that draws the target onto the canvas. Reading the
    pixels back stalls the GPU, so on touch screens (phones) it starts off;
    O turns it on and off.

    Particles2D draws every slot of its ring each frame, alive or not, so its
    vertices and rectangles are its capacity's worth.
*/

// *** Constants ***

const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 1080;

// Pages: the view is a 3 x 3 grid of slots, numbered row by row from the top-left. Slot 0 is
// always the HUD, so a page holds up to 8 test items; the items fill as many pages as they need.
const GRID_COLS = 3;
const GRID_ROWS = 3;
const CELL_W = DESIGN_WIDTH / GRID_COLS;   // 640
const CELL_H = DESIGN_HEIGHT / GRID_ROWS;  // 360
const ITEMS_PER_PAGE = (GRID_COLS * GRID_ROWS) - 1;
const PAGE_SECONDS = 5.0;        // Auto-cycle; space pauses and resumes it

// Each page's background (the clear color), in turn, so page transitions stand out
const PAGE_BACKGROUNDS = [new Vector4(0.0, 0.0, 64.0 / 255.0, 1.0),
                          new Vector4(0.0, 64.0 / 255.0, 0.0, 1.0),
                          new Vector4(64.0 / 255.0, 64.0 / 255.0, 64.0 / 255.0, 1.0)];

const ITEM_RAISE = 20;           // An item sits this far above its cell's center, leaving room for its label
const LABEL_FONT_SIZE = 20;
const LABEL_Y = 26;              // A label's center, above its cell's bottom

const HUD_REFRESH_MS = 250;      // How often the metrics window updates

// The metrics window, in design units: a dark panel in slot 0 with the metrics on it
const HUD_FONT = "Consolas, 'Courier New', monospace"; // Monospaced, so the label column lines up with spaces
const HUD_FONT_SIZE = 16.5;
const HUD_MARGIN = 10.5;         // From the view's top-left corner
const HUD_PADDING = 7.5;         // Around the text, inside the panel
const HUD_LABELS = ["Page", "FPS", "Vertices", "Materials", "Rectangles", "Overdraw", "Draw calls", "State changes", "Binds", "Targets", "Keys"];
const OVERDRAW_SAMPLE_MS = 500;  // How often overdraw is measured
const MAX_DT = 0.1;              // Seconds; longer frames (e.g. a hidden tab) are clamped

const PARTICLE_CAPACITY = 512;
const PARTICLE_RATE = 160;       // Emitted per second
const PARTICLE_BASE = 60;        // The fountain's origin, above its cell's bottom (clear of the label)

// ps_texture.webp is a 1 x 4 strip of frames; each particle steps through 0 - 2 over its life
const PARTICLE_FRAME_ROWS = 1;
const PARTICLE_FRAME_COLS = 4;
const PARTICLE_FIRST_FRAME = 0;
const PARTICLE_LAST_FRAME = 2;

// Lighting
const LIT_SIZE = new Vector2(360, 240);              // Each lit brick rect, design units
const LAMP_RADIUS = 200;                             // Each lit rect's point light circles it this far out (half that up and down)...
const LAMP_Z = 120;                                  // ...in front of the view
const LAMP_SPEED = 0.8;                              // Radians per second
const LAMP_RANGE = 360;                              // Small, so a lamp barely reaches the next cell
const LAMP_COLOR = new Vector3(1.0, 0.82, 0.55);
const SUN_POSITION = new Vector3(0, DESIGN_HEIGHT, 900); // The directional light shines from here...
const SUN_TARGET = new Vector3(DESIGN_WIDTH, 0, 0);      // ...toward here
const SUN_COLOR = new Vector3(0.55, 0.65, 1.0);
const SUN_INTENSITY = 0.35;
const AMBIENT_COLOR = new Vector3(0.18, 0.18, 0.18);

const TOGGLE_SIZE = new Vector2(160, 70); // Each Toggle, design units
const TOGGLE_GAP = 50;                    // The two Toggles sit this far above and below their slot's center

const CHECKBOX_SIZE = 90;                 // Each CheckBox, design units
const CHECKBOX_OUTLINE = 6;               // Their outline's thickness

const BUTTON_FONT_SIZE = 26;
const BUTTON_ICON_SIZE = 30;
const BUTTON_GAP = 88;                    // The three Buttons sit this far apart, top to bottom
const CHECKBOX_GAP = 80;                  // The two CheckBoxes sit this far left and right of their slot's center

// Camera: a small checkered world seen through a Camera2D whose viewport is its slot
const CAMERA_TILE = 80;                   // World units per tile
const CAMERA_TILES = 8;                   // Tiles per side
const CAMERA_VIEW = new Vector2(CELL_W - 60, CELL_H - 90); // The viewport, screen design units, centered in its slot
const CAMERA_BORDER = 4;                  // The frame around the viewport
const CAMERA_PAN_SPEED = 300;             // A / D pan, screen design units per second (so the same on screen at any zoom)
const CAMERA_ZOOM_RATE = 2.0;             // W / S zoom, times per second
const CAMERA_ZOOM_MIN = 0.25;
const CAMERA_ZOOM_MAX = 4.0;
const CAMERA_TRAUMA = 0.4;                // E shake: trauma added per press, so quick presses build up
const CAMERA_SHAKE_ROTATION = 0.06;       // Radians at full trauma

// Render targets
const POST_VIEW = new Vector2(CELL_W - 60, CELL_H - 90); // Each post effect item's rect, centered in its slot
const MINIMAP_PIXELS = 256;               // The minimap's target, pixels per side...
const MINIMAP_SIZE = 230;                 // ...shown this big, design units
const CACHE_COLS = 20;                    // The cached layer's grid of rects
const CACHE_ROWS = 14;
const CACHE_CELL = new Vector2(26, 18);   // Design units per rect, with a 2 unit gap all round
const CACHE_REDRAW_SECONDS = 2.0;         // New colors, so it's drawn again, this often
const HIERARCHY_SUN_SIZE = 36;
const HIERARCHY_PLANETS = [{ radius: 50, size: 34, speed: 1.1 },   // Each planet: its orbit, size and radians per second
                           { radius: 86, size: 40, speed: -0.7 },
                           { radius: 120, size: 30, speed: 0.45 }];
const HIERARCHY_MOON_SIZE = 16;
const HIERARCHY_MOON_SPEED = 3.0;         // Times its planet's
const HIERARCHY_MOON_PULSE = 0.2;         // Each moon's scale swings this far either side of 1 (a MotionAction)...
const HIERARCHY_MOON_PULSE_TIME = 1.25;   // ...taking this many seconds each way; each moon starts this much later than the one before:
const HIERARCHY_MOON_PULSE_STAGGER = 0.8;
const HIERARCHY_ROCK = 0.2;               // The root turns this many radians either side of 0...
const HIERARCHY_ROCK_TIME = 6.3;          // ...taking this many seconds each way
const HIERARCHY_BREATHE = 0.84;           // The root's scale swings between this and 1...
const HIERARCHY_BREATHE_TIME = 2.9;       // ...taking this many seconds each way
// Spine (page 4): each sample skeleton drawn by a Skeleton2D, with its bones (and paths, clipping) as SpineSkeletonDebug lines over it, animated.
// follow: a bone its camera follows across (the tank drives about 4,100 units; its ground tiles and rock scroll past).
// fitSkip: attachments left out when fitting the animation into the slot (the tank's ground and rock).
const SPINE_ASSETS = "./tools/Spine/demos/assets/";
const SPINE_JSON = SPINE_ASSETS + "demos.json";   // Holds every sample skeleton, by name
const SPINE_ITEMS = [{ name: "dragon", atlas: "atlas1", animation: "flying", tests: "regions only" },
                     { name: "raptor", atlas: "atlas1", animation: "walk", tests: "IK, weighted meshes" },
                     { name: "spineboy", atlas: "atlas1", animation: "run", tests: "IK, transform, clipping" },
                     { name: "owl", atlas: "atlas2", animation: "idle", tests: "meshes, deform" },
                     { name: "tank", atlas: "atlas2", animation: "drive", tests: "145 slots, path",
                       follow: "tankRoot", fitSkip: ["tank/ground", "tank/rock"] },
                     { name: "stretchyman", atlas: "atlas2", animation: "idle", tests: "paths, IK stretch" },
                     { name: "vine", atlas: "atlas2", animation: "animation", tests: "path constraint" },
                     { name: "heroes", atlas: "heroes", animation: "run", tests: "a skin, trimmed regions", skin: 1 }];
const SPINE_VIEW = new Vector2(CELL_W - 80, CELL_H - 100); // Each skeleton's whole animation is fitted into this, centered in its slot
const SPINE_CLIP = new Vector2(CELL_W - 16, CELL_H - 16);  // Each skeleton's camera viewport (and so its clip rect), centered in its slot
const SPINE_LINE_WIDTH = 1.5;           // Screen design units, whatever the camera's zoom
const SPINE_ORIGIN = new Transform2D(); // Skeleton2Ds are drawn at the origin at scale 1; their cameras place them

const TRANSITION_SECONDS = 0.7;
const TRANSITION_SOFTNESS = 0.15;
const TRANSITION_TYPES = [ScreenTransition.kWipeLeft, ScreenTransition.kCircle, ScreenTransition.kDissolve,
                          ScreenTransition.kFade, ScreenTransition.kWipeUp]; // In turn, one per page change

const Layers = {
    kLit: 0,       // The lit brick Rect2Ds; the batcher lights this layer
    kShapes: 1,    // Rect2D, RoundedRect2D, NinePatch2D, Sprite
    kText: 2,      // Text2D, TextGlyphs2D
    kEffects: 3,   // The text effects
    kParticles: 4, // And the Spine skeletons (Skeleton2D) and their debug lines
    kLabels: 5,    // The item labels and the metrics window, drawn after counting stops so they aren't measured
    kHudPanel: 6,
    kHudText: 7
};

const Colors = {
    kBackground: new Vector4(0.10, 0.11, 0.14, 1.0),
    kBars: new Vector4(0.0, 0.0, 0.0, 1.0),
    kText: new Vector4(0.95, 0.95, 0.95, 1.0),
    kGold: new Vector4(1.0, 0.80, 0.30, 1.0),
    kShadow: new Vector4(0.0, 0.0, 0.0, 0.6),
    kHudPanel: new Vector4(0.0, 0.0, 0.0, 0.75),
    kHudText: new Vector4(0.91, 0.91, 0.91, 1.0),
    kLabel: new Vector4(0.68, 0.71, 0.78, 1.0),
    kCheckGreen: new Vector4(0.42, 0.78, 0.26, 1.0),
    kButtonGreenHover: new Vector4(0.52, 0.86, 0.36, 1.0),
    kButtonGreenPressed: new Vector4(0.32, 0.62, 0.18, 1.0),
    kTileLight: new Vector4(0.30, 0.34, 0.44, 1.0),
    kTileDark: new Vector4(0.20, 0.23, 0.30, 1.0),
    kParticles: [new Vector4(1.0, 0.55, 0.20, 1.0), new Vector4(1.0, 0.85, 0.35, 1.0),
                 new Vector4(0.45, 0.75, 1.0, 1.0), new Vector4(0.95, 0.40, 0.70, 1.0)]
};

// The test text: a little praise
const TEXT_TEXT2D = "Brilliant!";
const TEXT_GLYPHS = "Superb";
const TEXT_WAVE = "Splendid";
const TEXT_FADE = "Dazzling";
const TEXT_EASE = "Marvelous";
const TEXT_SCROLL = "Stellar work, keep it up!";

// *** Globals ***

let gBatcher = null; // The managers (TextureManager, FontManager, ShaderManager) are static; nothing to create

// The scene, built in buildScene()
let gScene = null;

let gIsReady = false;
let gFrameTS = 0.0;     // This frame's requestAnimationFrame() time in milliseconds (the last frame's until appMain() sets it)
let gEaseHold = 0.0;    // Seconds the ease holds its end before playing again

// Which page is shown; it changes every PAGE_SECONDS unless paused (space). isTurning: change at the end of this frame.
let gPages = { current: 0, count: 1, timer: 0.0, isPaused: false, isTurning: false };

// Spine's page: B shows and hides the debug lines while it's shown
let gSpinePage = -1;    // The page the Spine items are on (-1: none loaded)
let gSpineLines = true;

// The page transition
let gTransition = null; // ScreenTransition
let gTransitionIndex = 0;

/*
    Metrics. Counting is only on while the visible frame draws, so the
    overdraw pass isn't counted twice.
*/
let gStats = {
    isCounting: false,
    drawingModel: null,     // The Model2D in Model2D.draw(), so its draw calls know what they are
    materials: new Set(),

    // This frame, while counting
    vertices: 0,
    rects: 0,
    drawCalls: 0,
    stateStart: 0,          // RenderState.getChangeCount() when counting began

    // The last finished frame
    last: { vertices: 0, rects: 0, drawCalls: 0, materials: 0, stateChanges: 0, bindsSent: 0, bindsSkipped: 0 },

    // FPS over a window of frames
    fpsFrames: 0,
    fpsStart: 0.0,
    fps: 0.0,
    frameMs: 0.0,

    // Overdraw, from the last sample. Reading pixels back stalls the GPU, which costs a phone more, so it starts off there (O toggles it).
    isOverdrawOn: (window.matchMedia?.("(pointer: coarse)").matches !== true),
    overdrawPixels: 0,
    viewPixels: 0,
    nextOverdraw: 0.0,

    nextHud: 0.0
};

// The GL draw functions as they were before wrapping; the overdraw marks use them so they're never counted
let gGLDraw = null;

// Overdraw marking: { program, vao, pixels (Uint8Array, reused) }
let gMark = null;

let gHud = null; // The metrics window, a Label, built in buildHud()

// *** App ***

window.onload = () => {
    // A stencil buffer for counting overdraw; otherwise WGLV's defaults
    const attributes = { antialias: true, depth: false, stencil: true, premultipliedAlpha: true, alpha: true };

    if (WGLV.init("wglCanvas", attributes) === false)
    {
        console.error("WebGL2 couldn't be initialized");
            return;
    }

    WGLV.setDesignResolution(DESIGN_WIDTH, DESIGN_HEIGHT);
    WGLV.setBarColor(Colors.kBars);
    WGLV.setClearColor(PAGE_BACKGROUNDS[0]); // Page 1's
    WGLV.resizeToWindow();

    if (InputManager.init() === false)
        console.error("InputManager couldn't start; the Toggles won't respond to taps");

    appSetup();
};

window.onresize = () => WGLV.resizeToWindow();

// Space pauses and resumes the page cycle, O toggles the overdraw measuring, B the Spine debug lines (on their page)
window.addEventListener("keydown", (e) => {
    if (e.repeat === true)
        return;

    switch (e.code)
    {
        case KeyCode.kSpace:
            e.preventDefault(); // No page scroll
            gPages.isPaused = !gPages.isPaused;
            break;

        case KeyCode.kO:
            gStats.isOverdrawOn = !gStats.isOverdrawOn;
            break;

        case KeyCode.kB:
            if (gPages.current === gSpinePage)
                gSpineLines = !gSpineLines;
            break;
    }
});

function appSetup()
{
    installHooks(); // Depth test and the rest of the fixed state are RenderState.applyDefaults()'s, from WGLV.init()

    if (setupOverdrawMarking() === false)
        console.error("Couldn't set up overdraw counting; it will show as n/a");

    loadAssets().then(() => {
        buildScene();
        gIsReady = true;
    });

    gFrameTS = performance.now(); // The same clock as requestAnimationFrame()'s time
    gStats.fpsStart = gFrameTS;
    requestAnimationFrame(appMain);
}

// Failed loads come back as the manager's white texture, so this always finishes
async function loadAssets()
{
    FontManager.setDefaultFamily("'Segoe UI', Arial, sans-serif");
    gBatcher = new Batcher();
    gBatcher.setLayerLit(Layers.kLit, true);

    // Build every shader the test draws with now, so none compiles mid-frame (e.g. when page 2 first shows)
    ShaderManager.preload([Rect2DShaderSource, Rect2DInstancedShaderSource, SpriteShaderSource, TextGlyphs2DShaderSource,
                           Particles2DShaderSource, LitRect2DInstancedShaderSource, LitNormalMapRect2DInstancedShaderSource]);
    buildHud(); // System font, so it's ready now and shows "Loading..." while the textures load

    const [rectTex, circleTex, ninePatchTex, particleTex, brickTex, brickNormalTex, checkTex] = await Promise.all([
        TextureManager.load("./textures/test_up.png"),
        TextureManager.load("./textures/circle.png"),
        TextureManager.load("./textures/np_text.png"),
        TextureManager.load("./textures/ps_texture.webp"),
        TextureManager.load("./textures/brickAlbedo.png"),
        TextureManager.load("./textures/brickNormals.png"),
        TextureManager.load("./textures/ux_check.png")
    ]);

    // Spine skeletons (page 4); a failed one is left out (its error is logged)
    const spineData = await Promise.all(SPINE_ITEMS.map((s) => SpineSkeletonData.load(SPINE_JSON, s.name, SPINE_ASSETS + s.atlas + ".atlas")));

    gScene = { textures: { rect: rectTex, circle: circleTex, ninePatch: ninePatchTex, particle: particleTex,
                           brick: brickTex, brickNormals: brickNormalTex, check: checkTex },
               spineData: spineData };
}

/*
    One of everything, as test items. Each item is
        { label, place(x, y), update(dt, time), submit() }
    place() puts it at the center of its slot (raised for its label), update() runs every frame
    for every item (so a page looks lived-in when it comes round), and submit() queues it on the
    batcher; only the shown page's items are submitted. Items fill pages in this order, 8 a page.
*/
function buildScene()
{
    const t = gScene.textures;
    const font = FontManager.getDefault();
    let items = [];

    // *** Models ***

    // Each model is drawn at its own Transform2D (no Entity needed); centered, so it turns and scales about its middle
    let rect = new Rect2D();
    rect.load(t.rect, 200, 200);
    rect.setAlignment(Alignment.kMiddleCenter);
    let rectAt = new Transform2D();

    items.push({ label: "Rect2D - rotating",
                 place: (x, y) => rectAt.setPosition(x, y),
                 update: (dt, time) => rectAt.setRotation(time * 0.6),
                 submit: () => gBatcher.submit(rect, rectAt, Layers.kShapes) });

    let rounded = new RoundedRect2D();
    rounded.load(t.circle, 300, 200, 40);
    rounded.setAlignment(Alignment.kMiddleCenter);
    let roundedAt = new Transform2D();

    items.push({ label: "RoundedRect2D - pulsing scale",
                 place: (x, y) => roundedAt.setPosition(x, y),
                 update: (dt, time) => roundedAt.setScale(1.0 + (0.15 * Math.sin(time * 2.0))),
                 submit: () => gBatcher.submit(rounded, roundedAt, Layers.kShapes) });

    let ninePatch = new NinePatch2D();
    ninePatch.load(t.ninePatch, 380, 180, new UVRect(0.3, 0.3, 0.4, 0.4));
    ninePatch.setAlignment(Alignment.kMiddleCenter);
    let ninePatchAt = new Transform2D();

    items.push({ label: "NinePatch2D - stretched, borders kept",
                 place: (x, y) => ninePatchAt.setPosition(x, y),
                 update: (dt, time) => ninePatchAt.setRotation(0.15 * Math.sin(time * 1.3)),
                 submit: () => gBatcher.submit(ninePatch, ninePatchAt, Layers.kShapes) });

    let sprite = new Sprite();
    sprite.load(makeSpriteStrip(), 200, 200, 1, 4);
    sprite.setAlignment(Alignment.kMiddleCenter);
    sprite.createSequence("count", 0, 0, 0, 3, 1.2);
    sprite.play("count");
    let spriteAt = new Transform2D();

    items.push({ label: "Sprite - frame animation",
                 place: (x, y) => spriteAt.setPosition(x, y),
                 update: (dt) => sprite.update(dt),
                 submit: () => gBatcher.submit(sprite, spriteAt, Layers.kShapes) });

    // *** Particles ***

    let particles = new Particles2D();

    if (particles.load(PARTICLE_CAPACITY, t.particle) === false)
        console.error("Couldn't load the particles");

    particles.setGravity(0, -520);
    particles.setEndScale(0.3);
    particles.setFrames(PARTICLE_FRAME_ROWS, PARTICLE_FRAME_COLS, PARTICLE_FIRST_FRAME, PARTICLE_LAST_FRAME);

    // A small fountain that stays in its cell: it rises about 200 and spreads about 180 either way
    let origin = new Vector2();
    let emitCarry = 0.0; // Particles owed from earlier frames (fractions of one)

    items.push({ label: "Particles2D - GPU sprites, frames 0 - 2",
                 place: (x, y) => origin.setXY(x, (y - ITEM_RAISE) - (CELL_H / 2.0) + PARTICLE_BASE),
                 update: (dt) => {
                     emitCarry += PARTICLE_RATE * dt;

                     while (emitCarry >= 1.0)
                     {
                         const color = Colors.kParticles[Math.floor(Math.random() * Colors.kParticles.length)];
                         particles.emit(origin.x, origin.y, randomRange(-110, 110), randomRange(380, 460),
                                        randomRange(1.2, 1.6), randomRange(32, 64), color);
                         emitCarry -= 1.0;
                     }

                     particles.update(dt);
                 },
                 submit: () => gBatcher.submitDrawable(particles, Layers.kParticles) });

    // *** Text ***

    let text = new Text2D(font, 64, "bold");
    text.setRasterizedTextColor(Colors.kText);
    text.setRasterizedShadowColor(Colors.kShadow);
    text.setDropShadowOffset(3, -3);
    text.setDropShadowEnabled(true);
    text.setAlignment(Alignment.kMiddleCenter);
    text.setText(TEXT_TEXT2D);
    let textAt = new Transform2D();

    items.push({ label: "Text2D - rasterized, drop shadow",
                 place: (x, y) => textAt.setPosition(x, y),
                 update: () => { },
                 submit: () => gBatcher.submit(text, textAt, Layers.kText) });

    // One atlas for every TextGlyphs2D
    const atlas = new TextAtlas(font, TEXT_GLYPHS + TEXT_WAVE + TEXT_FADE + TEXT_EASE + TEXT_SCROLL, 72, "bold");
    const glyphs = makeGlyphs(atlas, TEXT_GLYPHS);
    let glyphsAt = new Transform2D();

    items.push({ label: "TextGlyphs2D - text from a glyph atlas",
                 place: (x, y) => glyphsAt.setPosition(x, y),
                 update: () => { },
                 submit: () => gBatcher.submit(glyphs, glyphsAt, Layers.kText, null, Colors.kText) });

    // *** Text effects, each on its own TextGlyphs2D ***

    let wave = new WaveTextEffect(makeGlyphs(atlas, TEXT_WAVE));
    wave.set(18, 0.75, 0.7);
    wave.setDropShadow(4, -4, Colors.kShadow);
    wave.setDropShadowEnabled(true);
    items.push(makeEffectItem("WaveTextEffect - wave with a shadow", wave));

    let fade = new FadeTextEffect(makeGlyphs(atlas, TEXT_FADE));
    const fadeLoop = () => fade.fadeIn(1.0, () => fade.fadeOut(1.0, fadeLoop));
    fadeLoop();
    items.push(makeEffectItem("FadeTextEffect - fading in and out", fade));

    let ease = new EaseTextEffect(makeGlyphs(atlas, TEXT_EASE));
    ease.setColor(Vector4.kWhite, Colors.kGold, Easing.kSineInOut, 0.3);
    ease.setScale(0.0, 1.0, Easing.kBackOut, 0.3);
    ease.setMode(EaseTextEffect.kModeIteration, EaseTextEffect.kLeftToRight);
    ease.play(() => { gEaseHold = 1.0; });

    let easeItem = makeEffectItem("EaseTextEffect - color and scale, glyph by glyph", ease);
    easeItem.update = (dt) => {
        // It plays again after holding its end
        if (gEaseHold > 0.0)
        {
            gEaseHold -= dt;

            if (gEaseHold <= 0.0)
                ease.play(() => { gEaseHold = 1.0; });
        }

        ease.update(dt);
    };
    items.push(easeItem);

    let scroll = new ScrollTextEffect(makeGlyphs(atlas, TEXT_SCROLL));
    scroll.set(ScrollTextEffect.kLeft, 160, 400, 110, 80);
    items.push(makeEffectItem("ScrollTextEffect - scrolling, clipped", scroll));

    // *** Lighting ***

    let lights = new LightSet();
    lights.setAmbient(AMBIENT_COLOR);

    let sun = new DirectionalLight(SUN_POSITION.x, SUN_POSITION.y, SUN_POSITION.z, SUN_TARGET.x, SUN_TARGET.y, SUN_TARGET.z);
    sun.setColor(SUN_COLOR);
    sun.setIntensity(SUN_INTENSITY);
    lights.add(sun);

    // Ordinary Rect2D Materials; Layers.kLit lights them. Texture 1 is the normal map.
    let brickNormalMaterial = new Material();

    if (brickNormalMaterial.load(Rect2D.getDefaultShader(), [t.brick, t.brickNormals]) === false)
        console.error("Couldn't build the normal-mapped brick material");

    let litNormalRect = new Rect2D();
    litNormalRect.load(brickNormalMaterial, LIT_SIZE.x, LIT_SIZE.y);
    items.push(makeLitItem("Lit Rect2D - normal map, point + directional", litNormalRect, lights, t.circle, true));

    let litRect = new Rect2D();
    litRect.load(t.brick, LIT_SIZE.x, LIT_SIZE.y);
    items.push(makeLitItem("Lit Rect2D - texture only, point + directional", litRect, lights, t.circle, false));

    // *** Toggles: the filled style above, the outlined one with ON / OFF text below ***

    let filled = new Toggle();
    filled.load(TOGGLE_SIZE.x, TOGGLE_SIZE.y);

    let outlined = new Toggle();
    outlined.load(TOGGLE_SIZE.x, TOGGLE_SIZE.y);
    outlined.setTrackColors(Vector4.kBlack, Vector4.kWhite);
    outlined.setKnobColors(Vector4.kWhite, Vector4.kBlack);
    outlined.setOutline(5, Vector4.kBlack, Vector4.kBlack);
    outlined.setText(new TextAtlas(font, "ONF", 26, "bold"), "ON", "OFF");
    outlined.setTextColors(Vector4.kWhite, Vector4.kBlack);
    outlined.setOn(true, true);

    let toggleItem = {
        label: "Toggle - tap to flip, filled and outlined",
        place: (x, y) => {
            filled.setPos(x, y + TOGGLE_GAP, Alignment.kMiddleCenter);
            outlined.setPos(x, y - TOGGLE_GAP, Alignment.kMiddleCenter);
        },
        update: (dt) => {
            // Taps only count while its page is shown
            const isShown = (toggleItem.page === gPages.current);

            for (const t of [filled, outlined])
            {
                if (t.isEnabled() !== isShown)
                    t.setEnabled(isShown);

                t.update(dt);
            }
        },
        submit: () => {
            filled.submit(gBatcher, Layers.kShapes, Layers.kText);
            outlined.submit(gBatcher, Layers.kShapes, Layers.kText);
        }
    };

    items.push(toggleItem);

    // *** CheckBoxes, styled like common check marks so they stand out on the dark background ***

    // The outline is drawn behind the whole box, so an "empty" box is filled with the background color

    // Square: a green outline around an empty box, with ux_check (a white tick) tinted green
    let textureCheck = new CheckBox();
    textureCheck.load(CHECKBOX_SIZE, 0, t.check);
    textureCheck.setOutlineWidth(CHECKBOX_OUTLINE);
    textureCheck.setOutlineColor(Colors.kCheckGreen);
    textureCheck.setBoxColor(Colors.kBackground);
    textureCheck.setCheckColor(Colors.kCheckGreen);
    textureCheck.setChecked(true);

    // Rounded: a light outline around an empty box, with the solid check in green
    let shapeCheck = new CheckBox();
    shapeCheck.load(CHECKBOX_SIZE, CHECKBOX_SIZE * 0.2);
    shapeCheck.setOutlineWidth(CHECKBOX_OUTLINE);
    shapeCheck.setOutlineColor(Colors.kText);
    shapeCheck.setBoxColor(Colors.kBackground);
    shapeCheck.setCheckColor(Colors.kCheckGreen);
    shapeCheck.setChecked(true);

    let checkItem = {
        label: "CheckBox - tap: texture check, shape check",
        place: (x, y) => {
            textureCheck.setPos(x - CHECKBOX_GAP, y, Alignment.kMiddleCenter);
            shapeCheck.setPos(x + CHECKBOX_GAP, y, Alignment.kMiddleCenter);
        },
        update: (dt) => {
            // Taps only count while its page is shown
            const isShown = (checkItem.page === gPages.current);

            for (const c of [textureCheck, shapeCheck])
            {
                if (c.isEnabled() !== isShown)
                    c.setEnabled(isShown);

                c.update(dt);
            }
        },
        submit: () => {
            textureCheck.submit(gBatcher, Layers.kShapes, Layers.kText);
            shapeCheck.submit(gBatcher, Layers.kShapes, Layers.kText);
        }
    };

    items.push(checkItem);

    // *** Buttons: auto-sized, with press shrink; one counts its clicks, one has an icon, one is disabled ***

    const buttonAtlas = new TextAtlas(font, TextAtlas.kAscii, BUTTON_FONT_SIZE, "bold");
    let clicks = 0;

    let countButton = new Button();
    countButton.load(100, 50, 12);
    countButton.setText(buttonAtlas, "Clicked 0");
    countButton.setAutoSize(true);
    countButton.setPressShrink(true);
    countButton.setOnClick((b) => { ++clicks; b.setText(buttonAtlas, `Clicked ${clicks}`); });

    let iconButton = new Button();
    iconButton.load(100, 50, Button.kPill);
    iconButton.setIcon(t.check, BUTTON_ICON_SIZE);
    iconButton.setText(buttonAtlas, "Accept");
    iconButton.setBackgroundColors(Colors.kCheckGreen, Colors.kButtonGreenHover, Colors.kButtonGreenPressed);
    iconButton.setOutline(3, Colors.kText, Colors.kText, Colors.kText);
    iconButton.setAutoSize(true);
    iconButton.setPressShrink(true);

    let disabledButton = new Button();
    disabledButton.setEnabled(false); // Before load(), so it starts in the disabled colors
    disabledButton.load(100, 50, 12);
    disabledButton.setText(buttonAtlas, "Disabled");
    disabledButton.setAutoSize(true);

    const buttons = [countButton, iconButton, disabledButton];

    let buttonItem = {
        label: "Button - hover, press, click, auto size",
        place: (x, y) => {
            countButton.setPos(x, y + BUTTON_GAP, Alignment.kMiddleCenter);
            iconButton.setPos(x, y, Alignment.kMiddleCenter);
            disabledButton.setPos(x, y - BUTTON_GAP, Alignment.kMiddleCenter);
        },
        update: (dt) => {
            // Only while its page is shown, so clicks elsewhere don't reach them (and they don't grey out meanwhile)
            if (buttonItem.page !== gPages.current)
                return;

            for (const b of buttons)
                b.update(dt);
        },
        submit: () => {
            for (const b of buttons)
                b.submit(gBatcher, Layers.kShapes, Layers.kText);
        }
    };

    items.push(buttonItem);

    // *** Camera ***

    const world = makeCameraWorld(t.rect);
    const cameraItem = makeCameraItem(world, t.circle);
    items.push(cameraItem);

    // *** Render targets ***

    buildTransition();
    items.push(makeMinimapItem(world, cameraItem.camera));
    items.push(makeCachedItem());

    const white = TextureManager.getWhiteTexture();
    const shader = Rect2D.getDefaultShader();

    // Bloom: orbs drawn additively (BlendMode.kAdditive) so overlaps go over 1, kept by a half-float target
    // Drawn at a scratch transform, moved between submits (the batcher copies it)
    let at = new Transform2D();

    let backdrop = new Rect2D();
    backdrop.load(white, POST_VIEW.x, POST_VIEW.y);
    backdrop.setAlignment(Alignment.kMiddleCenter);

    let orb = new Rect2D();
    orb.load(MaterialManager.load(shader, [t.circle], null, BlendMode.kAdditive), 110, 110);
    orb.setAlignment(Alignment.kMiddleCenter);

    let bar = new Rect2D();
    bar.load(white, 300, 24);
    bar.setAlignment(Alignment.kMiddleCenter);

    let bloom = new BloomEffect();
    bloom.set(0.6, 0.25, 1.4);
    bloom.setBlur(1.5, 2);

    items.push(makePostItem("BloomEffect - additive orbs, HDR target", bloom, RenderTarget.kRGBA16F, () => { },
        (batcher, c, time) => {
            batcher.submit(backdrop, at.identity().setPosition(c.x, c.y), 0, null, Colors.kTileDark);
            batcher.submit(bar, at.setPosition(c.x, c.y - 95), 1, null, Colors.kGold);

            for (let i = 0; i < 5; ++i)
            {
                const a = (time * 0.9) + ((i * MathDefines.kTwoPi) / 5.0);
                batcher.submit(orb, at.setPosition(c.x + (Math.cos(a) * 150), c.y + 25 + (Math.sin(a) * 55)), 2, null,
                               Colors.kParticles[i % Colors.kParticles.length]);
            }
        }));

    // Blur: a turning rect and dots, the blur's radius pulsing
    let blurRect = new Rect2D();
    blurRect.load(t.rect, 170, 170);
    blurRect.setAlignment(Alignment.kMiddleCenter);

    let dot = new Rect2D();
    dot.load(t.circle, 70, 70);
    dot.setAlignment(Alignment.kMiddleCenter);

    let blur = new BlurEffect();

    items.push(makePostItem("BlurEffect - radius pulsing, half size", blur, RenderTarget.kRGBA8,
        (dt, time) => blur.set(0.3 + (1.7 * (0.5 + (0.5 * Math.sin(time * 1.5))))),
        (batcher, c, time) => {
            batcher.submit(blurRect, at.identity().setPosition(c.x, c.y).setRotation(time * 0.5), 0);
            at.identity();

            for (let i = 0; i < 3; ++i)
                batcher.submit(dot, at.setPosition(c.x + ((i - 1) * 180), c.y - 60), 1, null, Colors.kParticles[i]);
        }));

    // Screen effect: a checkered panel and a turning rect, graded, vignetted and on a curved, scanned tube
    let panelTile = new Rect2D();
    panelTile.load(white, 66, 66);

    let screenRect = new Rect2D();
    screenRect.load(t.rect, 150, 150);
    screenRect.setAlignment(Alignment.kMiddleCenter);

    let screen = new ScreenEffect();
    screen.setCurvature(0.15);
    screen.setScanlines(0.45, 80);
    screen.setColorFringe(0.006);
    screen.setVignette(0.7, 0.45, 0.6);
    screen.setSaturation(1.4);
    screen.setContrast(1.1);

    items.push(makePostItem("ScreenEffect - CRT, vignette, grading", screen, RenderTarget.kRGBA8, () => { },
        (batcher, c, time) => {
            const cols = Math.ceil(POST_VIEW.x / 66);
            const rows = Math.ceil(POST_VIEW.y / 66);
            const left = c.x - (POST_VIEW.x / 2.0);
            const bottom = c.y - (POST_VIEW.y / 2.0);

            at.identity();

            for (let r = 0; r < rows; ++r)
            {
                for (let col = 0; col < cols; ++col)
                {
                    const color = ((r + col) % 2 === 0) ? Colors.kTileLight : Colors.kTileDark;
                    batcher.submit(panelTile, at.setPosition(left + (col * 66), bottom + (r * 66)), 0, null, color);
                }
            }

            batcher.submit(screenRect, at.setPosition(c.x, c.y).setRotation(time * -0.4), 1);
        }));

    // *** Entities ***

    items.push(makeHierarchyItem(t.circle, t.rect));

    // *** Spine: page 4 is theirs ***

    const spineDebug = new SpineSkeletonDebug();

    if (spineDebug.load() === false)
        console.error("Couldn't load the Spine debug lines");

    spineDebug.setLineWidth(SPINE_LINE_WIDTH);
    spineDebug.setRegions(false); // The images show these now
    spineDebug.setMeshes(false);

    let firstSpine = true;

    SPINE_ITEMS.forEach((s, i) => {
        const data = gScene.spineData[i];

        if (data === null)
            return; // Already reported

        let spineItem = makeSpineItem(s, data, spineDebug);
        spineItem.startsPage = firstSpine; // Spine starts a page of its own
        spineItem.isSpine = true;
        firstSpine = false;
        items.push(spineItem);
    });

    // *** Pages and labels ***

    const labelAtlas = new TextAtlas(font, items.map((item) => item.label).join(""), LABEL_FONT_SIZE);
    let position = 0; // Items placed so far, counting the slots left empty before an item that starts a page

    for (let i = 0; i < items.length; ++i)
    {
        let item = items[i];

        if (item.startsPage === true && (position % ITEMS_PER_PAGE) !== 0)
            position += ITEMS_PER_PAGE - (position % ITEMS_PER_PAGE); // On to the next page

        const slot = 1 + (position % ITEMS_PER_PAGE); // Slot 0 is the HUD's
        const x = (CELL_W * (slot % GRID_COLS)) + (CELL_W / 2.0);
        const cellBottom = DESIGN_HEIGHT - (CELL_H * (Math.floor(slot / GRID_COLS) + 1));

        item.page = Math.floor(position / ITEMS_PER_PAGE);
        item.place(x, cellBottom + (CELL_H / 2.0) + ITEM_RAISE);

        item.labelText = new TextGlyphs2D(labelAtlas); // Drawn in Colors.kLabel
        item.labelText.setAlignment(Alignment.kMiddleCenter);
        item.labelText.setText(item.label);
        item.labelAt = new Transform2D(x, cellBottom + LABEL_Y);
        ++position;
    }

    gPages.count = Math.ceil(position / ITEMS_PER_PAGE);
    gSpinePage = items.find((item) => item.isSpine === true)?.page ?? -1;

    gScene.items = items;
    gScene.lights = lights;
    gScene.time = 0.0;
}

// Centered on where it's drawn
function makeGlyphs(atlas, str)
{
    let g = new TextGlyphs2D(atlas);
    g.setAlignment(Alignment.kMiddleCenter);
    g.setText(str);
        return g;
}

// A text effect as a test item; the effect draws its TextGlyphs2D at its own position
function makeEffectItem(label, effect)
{
    effect.setTextColor(Colors.kText);

    return { label: label,
             place: (x, y) => effect.setPosition(x, y),
             update: (dt) => effect.update(dt),
             submit: () => effect.submit(gBatcher, Layers.kEffects) };
}

/*
    A lit Rect2D as a test item, with its own point light circling it (shown by an
    unlit dot) added to lights. rocks turns it back and forth, so its normals turn too.
*/
function makeLitItem(label, model, lights, dotTexture, rocks)
{
    let modelAt = new Transform2D();
    let dotAt = new Transform2D();
    model.setAlignment(Alignment.kMiddleCenter);

    let lamp = new PointLight(0, 0, LAMP_Z, LAMP_RANGE);
    lamp.setColor(LAMP_COLOR);
    lights.add(lamp);

    let dot = new Rect2D();
    dot.load(dotTexture, 24, 24);
    dot.setAlignment(Alignment.kMiddleCenter);
    const dotColor = new Vector4(LAMP_COLOR.x, LAMP_COLOR.y, LAMP_COLOR.z, 1.0);

    return { label: label,
             place: (x, y) => modelAt.setPosition(x, y),
             update: (dt, time) => {
                 const a = time * LAMP_SPEED;
                 const lx = modelAt.getX() + (Math.cos(a) * LAMP_RADIUS);
                 const ly = modelAt.getY() + (Math.sin(a) * LAMP_RADIUS * 0.5);

                 lamp.setPosition(lx, ly, LAMP_Z);
                 dotAt.setPosition(lx, ly);

                 if (rocks === true)
                     modelAt.setRotation(0.12 * Math.sin(time * 0.9));
             },
             submit: () => {
                 gBatcher.submit(model, modelAt, Layers.kLit);
                 gBatcher.submit(dot, dotAt, Layers.kParticles, null, dotColor); // Unlit, on top
             } };
}

/*
    A Camera2D as a test item: a checkered world with an arrow at its center, seen
    through a camera the keys move, its viewport the item's slot: A / D pan left /
    right, W / S zoom in / out, E shakes it (adds trauma, with a little rotation
    shake), only while its page is showing.
    It has its own Batcher with the camera: layer 0 ignores the camera (the
    frame, in screen units), layers 1 and 2 follow it. The pointer, over the
    viewport, is turned into world units (screenToWorld()) and marked with a dot
    in the world, so the dot should sit right under it however the camera moves.
    The batcher is drawn from the main one as a drawable. The item's camera is
    item.camera (the minimap shows what it sees).
*/
function makeCameraItem(world, dotTexture)
{
    const white = TextureManager.getWhiteTexture();
    const worldCenter = world.size / 2.0;

    let camera = new Camera2D();
    camera.setPosition(worldCenter, worldCenter);
    camera.setShakeLimits(camera.getShakeMaxOffset(), CAMERA_SHAKE_ROTATION);
    let batcher = new Batcher();
    batcher.setCamera(camera);
    batcher.setLayerFollowsCamera(0, false);

    let border = new Rect2D();
    border.load(white, CAMERA_VIEW.x + (CAMERA_BORDER * 2), CAMERA_VIEW.y + (CAMERA_BORDER * 2));
    border.setAlignment(Alignment.kMiddleCenter);

    let backdrop = new Rect2D();
    backdrop.load(white, CAMERA_VIEW.x, CAMERA_VIEW.y);
    backdrop.setAlignment(Alignment.kMiddleCenter);

    let cursor = new Rect2D();
    cursor.load(dotTexture, 20, 20);
    cursor.setAlignment(Alignment.kMiddleCenter);

    let frameAt = new Transform2D();  // The border and backdrop, centered in the slot
    let cursorAt = new Transform2D(); // World units
    const viewport = new Vector4();
    const pointer = new Vector2();
    let showCursor = false;

    const drawable = { render: () => batcher.render() };

    let item = {
        label: "Camera2D - A/D pan, W/S zoom, E shake",
        place: (x, y) => {
            camera.setViewport(x - (CAMERA_VIEW.x / 2.0), y - (CAMERA_VIEW.y / 2.0), CAMERA_VIEW.x, CAMERA_VIEW.y);
            frameAt.setPosition(x, y);
        },
        update: (dt, time) => {
            // Keys, only while its page is showing
            if (item.page === gPages.current)
            {
                const pan = (InputManager.isKeyHeld(KeyCode.kD) ? 1.0 : 0.0) - (InputManager.isKeyHeld(KeyCode.kA) ? 1.0 : 0.0);
                const zoomDir = (InputManager.isKeyHeld(KeyCode.kW) ? 1.0 : 0.0) - (InputManager.isKeyHeld(KeyCode.kS) ? 1.0 : 0.0);

                if (pan !== 0.0)
                {
                    const p = camera.getPosition();
                    camera.setPosition(p.x + ((pan * CAMERA_PAN_SPEED * dt) / camera.getZoom()), p.y);
                }

                if (zoomDir !== 0.0)
                {
                    const zoom = camera.getZoom() * Math.pow(CAMERA_ZOOM_RATE, zoomDir * dt);
                    camera.setZoom(Math.min(Math.max(zoom, CAMERA_ZOOM_MIN), CAMERA_ZOOM_MAX));
                }

                if (InputManager.wasKeyPressed(KeyCode.kE) === true)
                    camera.addTrauma(CAMERA_TRAUMA);
            }

            camera.update(dt);

            // The pointer, when it's over the viewport, in world units
            showCursor = false;

            if (item.page === gPages.current && InputManager.hasPosition() === true)
            {
                const p = InputManager.getPosition();
                const v = camera.getViewport(viewport);

                if (p.x >= v.x && p.x <= v.x + v.z && p.y >= v.y && p.y <= v.y + v.w)
                {
                    camera.screenToWorld(p, pointer);
                    cursorAt.setPosition(pointer.x, pointer.y);
                    showCursor = true;
                }
            }
        },
        submit: () => {
            batcher.submit(border, frameAt, 0, null, Colors.kLabel);
            batcher.submit(backdrop, frameAt, 0, null, Colors.kBackground);
            world.submit(batcher, 1);

            if (showCursor === true)
                batcher.submit(cursor, cursorAt, 2, null, Colors.kGold);

            gBatcher.submitDrawable(drawable, Layers.kShapes);
        },
        camera: camera
    };

    return item;
}

// The camera's world: a checkered square (world.size per side, world units) with an arrow at its center; world.submit(batcher, layer) queues it
function makeCameraWorld(arrowTexture)
{
    const white = TextureManager.getWhiteTexture();
    const size = CAMERA_TILE * CAMERA_TILES;

    let tile = new Rect2D(); // Submitted once per tile, each in its own color, at a moving transform
    tile.load(white, CAMERA_TILE, CAMERA_TILE);
    let tileAt = new Transform2D();

    let arrow = new Rect2D();
    arrow.load(arrowTexture, CAMERA_TILE * 2, CAMERA_TILE * 2);
    arrow.setAlignment(Alignment.kMiddleCenter);
    const arrowAt = new Transform2D(size / 2.0, size / 2.0);

    return {
        size: size,
        submit: (batcher, layer) => {
            for (let r = 0; r < CAMERA_TILES; ++r)
            {
                for (let c = 0; c < CAMERA_TILES; ++c)
                {
                    const color = ((r + c) % 2 === 0) ? Colors.kTileLight : Colors.kTileDark;
                    batcher.submit(tile, tileAt.setPosition(c * CAMERA_TILE, r * CAMERA_TILE), layer, null, color);
                }
            }

            batcher.submit(arrow, arrowAt, layer);
        }
    };
}

/*
    A PostChain working on just its slot (PostChain.setRect()) as a test item: draw(batcher,
    center, time) submits a small scene onto a batcher of its own each frame, in screen
    design units around center; it's drawn into the chain and through effect back into
    the slot. format is the chain's target format; update(dt, time) runs every frame.
*/
function makePostItem(label, effect, format, update, draw)
{
    let chain = new PostChain();

    // The slot's size from the start; place() moves it into the slot, which doesn't remake the target
    const rect = { x: 0, y: 0, width: POST_VIEW.x, height: POST_VIEW.y };

    if (chain.load({ format: format, samples: 4, rect: rect }) === false)
        console.error(`Couldn't load the PostChain for "${label}"`);

    chain.addEffect(effect);

    let batcher = new Batcher();
    let center = new Vector2();

    const drawable = {
        render: () => {
            if (chain.begin() === false)
                return;

            draw(batcher, center, gScene.time);
            batcher.render();
            chain.end();
        }
    };

    return { label: label,
             place: (x, y) => {
                 center.setXY(x, y);
                 chain.setRect(x - (POST_VIEW.x / 2.0), y - (POST_VIEW.y / 2.0), POST_VIEW.x, POST_VIEW.y);
             },
             update: update,
             submit: () => gBatcher.submitDrawable(drawable, Layers.kShapes) };
}

/*
    Entities as a test item: a sun with planets circling it and a moon circling
    each planet, where only the pivots are turned. The system is the root; each
    planet's pivot (an empty Entity) is a child of it and each planet a child
    of its pivot, so it's carried round and turns with it (its arrow always
    points out). Each moon has a pivot that's a child of its planet, so it
    follows the planet, turning as it circles and pulsing its own scale. The
    root breathes and rocks, carrying everything under it.

    The planets, sun and moons are Entities holding models (Entity.setModel()),
    and every moon draws the same Rect2D, each at its own place. The root's
    submit() queues every model in the tree.

    The pulse, rock and breathe are motions (MotionControllers) ping-ponging
    forever; the root's update(dt) plays its own and, through its children,
    the moons'. The root's two motions move different channels at once.
*/
function makeHierarchyItem(circleTexture, arrowTexture)
{
    const white = TextureManager.getWhiteTexture();
    const easing = Easing.kSineInOut;
    let system = new Entity("system");
    let pivots = [];  // { entity, speed, start }
    let drawnCount = 0; // Entities with a model

    // An Entity named name holding model at (x, y) under parent, drawn in color
    const addBody = (name, model, parent, x, y, color = Vector4.kWhite) => {
        let body = new Entity(name);
        body.setModel(model);
        body.setPosition(x, y);
        body.setColor(color);
        parent.addChild(body);
        ++drawnCount;
            return body;
    };

    let systemMotion = system.addMotion();
    systemMotion.add("rock", new MotionAction(new Transform2D(0, 0, 1, 1, -HIERARCHY_ROCK), new Transform2D(0, 0, 1, 1, HIERARCHY_ROCK),
                                              { rotation: { duration: HIERARCHY_ROCK_TIME, easing: easing } }), MotionPlayStyle.kPingPongLoop);
    systemMotion.add("breathe", new MotionAction(new Transform2D(0, 0, 1.0), new Transform2D(0, 0, HIERARCHY_BREATHE),
                                                 { scale: { duration: HIERARCHY_BREATHE_TIME, easing: easing } }), MotionPlayStyle.kPingPongLoop);
    systemMotion.play("rock");
    systemMotion.play("breathe");

    // Shared by every moon's pulse; each moon needs its own MotionAction, as it holds the play time
    const pulseTiming = new MotionParams({ scale: { duration: HIERARCHY_MOON_PULSE_TIME, easing: easing } });
    const pulseSmall = new Transform2D(0, 0, 1.0 - HIERARCHY_MOON_PULSE);
    const pulseBig = new Transform2D(0, 0, 1.0 + HIERARCHY_MOON_PULSE);

    let sunRect = new Rect2D();
    sunRect.load(circleTexture, HIERARCHY_SUN_SIZE, HIERARCHY_SUN_SIZE);
    sunRect.setAlignment(Alignment.kMiddleCenter);
    addBody("sun", sunRect, system, 0, 0, Colors.kGold);

    // One Rect2D for every moon, drawn at each moon's place
    let moonRect = new Rect2D();
    moonRect.load(white, HIERARCHY_MOON_SIZE, HIERARCHY_MOON_SIZE);
    moonRect.setAlignment(Alignment.kMiddleCenter);

    for (let i = 0; i < HIERARCHY_PLANETS.length; ++i)
    {
        const p = HIERARCHY_PLANETS[i];

        let orbit = new Entity(`orbit ${i}`);
        system.addChild(orbit);
        pivots.push({ entity: orbit, speed: p.speed, start: i * 2.1 });

        let planetRect = new Rect2D();
        planetRect.load(arrowTexture, p.size, p.size);
        planetRect.setAlignment(Alignment.kMiddleCenter);

        let planet = addBody(`planet ${i}`, planetRect, orbit, p.radius, 0, Colors.kParticles[i % Colors.kParticles.length]);
        planet.setRotation(-MathDefines.kHalfPi); // The arrow points up; this points it away from the sun

        // The moon's pivot sits on the planet's anchor (its center); turning the planet above doesn't matter to it
        let moonOrbit = new Entity(`moon orbit ${i}`);
        moonOrbit.setRotation(MathDefines.kHalfPi); // Undoes the planet's turn, so the moon's speed reads the same
        planet.addChild(moonOrbit);
        pivots.push({ entity: moonOrbit, speed: p.speed * HIERARCHY_MOON_SPEED, start: MathDefines.kHalfPi });

        let moon = addBody(`moon ${i}`, moonRect, moonOrbit, (p.size / 2.0) + HIERARCHY_MOON_SIZE, 0);

        let moonMotion = moon.addMotion();
        moonMotion.add("pulse", new MotionAction(pulseSmall, pulseBig, pulseTiming), MotionPlayStyle.kPingPongLoop);
        moonMotion.play("pulse");
        moon.update(i * HIERARCHY_MOON_PULSE_STAGGER); // Out of step with the others
    }

    return { label: `Entity - ${drawnCount} models, parented 3 deep`,
             place: (x, y) => system.setPosition(x, y),
             update: (dt, time) => {
                 for (const pivot of pivots)
                     pivot.entity.setRotation(pivot.start + (time * pivot.speed));

                 system.update(dt); // Its rock and breathe, and through its children each moon's pulse
             },
             submit: () => system.submit(gBatcher, Layers.kShapes) };
}

/*
    A RenderTarget as a test item: the camera item's whole world drawn into a small
    target of its own (its design rect is the world, no camera needed), with what
    the camera sees marked in gold, then the target's texture shown on a Rect2D
    (BlendMode.kPremultiplied, as a target's texture needs).
*/
function makeMinimapItem(world, camera)
{
    const white = TextureManager.getWhiteTexture();

    let target = new RenderTarget();

    if (target.loadFixed(MINIMAP_PIXELS, MINIMAP_PIXELS, { samples: 4 }) === false)
        console.error("Couldn't load the minimap's RenderTarget");

    target.setDesignRect(0, 0, world.size, world.size);

    let batcher = new Batcher();

    let view = new Rect2D(); // 1 x 1, scaled to the camera's view each frame
    view.load(white, 1, 1);
    view.setAlignment(Alignment.kMiddleCenter);
    const viewColor = new Vector4(Colors.kGold.x, Colors.kGold.y, Colors.kGold.z, 0.45);

    let map = new Rect2D();
    map.load(MaterialManager.load(Rect2D.getDefaultShader(), [target.getTexture()], null, BlendMode.kPremultiplied), MINIMAP_SIZE, MINIMAP_SIZE);
    map.setAlignment(Alignment.kMiddleCenter);

    let border = new Rect2D();
    border.load(white, MINIMAP_SIZE + (CAMERA_BORDER * 2), MINIMAP_SIZE + (CAMERA_BORDER * 2));
    border.setAlignment(Alignment.kMiddleCenter);

    let viewAt = new Transform2D();
    let mapAt = new Transform2D(); // The map and its border, centered in the slot
    const bounds = new Vector4();

    const drawable = {
        render: () => {
            if (target.isLoaded() === false)
                return;

            // The world into the target...
            RenderTargets.push(target);
            world.submit(batcher, 0);

            camera.getWorldBounds(bounds);
            viewAt.set(bounds.x + (bounds.z / 2.0), bounds.y + (bounds.w / 2.0), bounds.z, bounds.w, 0.0);
            batcher.submit(view, viewAt, 1, null, viewColor);

            batcher.render();
            RenderTargets.pop();

            // ...then the target onto the screen
            border.render(mapAt, null, Colors.kLabel);
            map.render(mapAt);
        }
    };

    return { label: "RenderTarget - minimap of the Camera2D world",
             place: (x, y) => mapAt.setPosition(x, y),
             update: () => { },
             submit: () => gBatcher.submitDrawable(drawable, Layers.kShapes) };
}

/*
    A CachedLayer as a test item: a grid of rects drawn once into the layer, then
    shown as one instanced quad. It's given new colors (and so drawn again) every
    CACHE_REDRAW_SECONDS; the frames in between draw just the one quad.
*/
function makeCachedItem()
{
    const count = CACHE_COLS * CACHE_ROWS;
    const width = CACHE_COLS * CACHE_CELL.x;
    const height = CACHE_ROWS * CACHE_CELL.y;

    let cache = new CachedLayer();
    let batcher = new Batcher();
    let origin = new Vector2();
    let timer = 0.0;

    let cell = new Rect2D();
    cell.load(TextureManager.getWhiteTexture(), CACHE_CELL.x - 4, CACHE_CELL.y - 4);
    let cellAt = new Transform2D();

    let colors = Array.from({ length: count }, () => new Vector4());
    const recolor = () => colors.forEach((c) => c.setRGBA(randomRange(0.2, 1.0), randomRange(0.2, 1.0), randomRange(0.2, 1.0), 1.0));
    recolor();

    const drawCells = () => {
        for (let i = 0; i < count; ++i)
        {
            cellAt.setPosition(origin.x + ((i % CACHE_COLS) * CACHE_CELL.x) + 2, origin.y + (Math.floor(i / CACHE_COLS) * CACHE_CELL.y) + 2);
            batcher.submit(cell, cellAt, 0, null, colors[i]);
        }

        batcher.render();
    };

    return { label: `CachedLayer - ${count} rects drawn once, new every ${CACHE_REDRAW_SECONDS} s`,
             place: (x, y) => {
                 origin.setXY(x - (width / 2.0), y - (height / 2.0));

                 if (cache.load(origin.x, origin.y, width, height) === false)
                     console.error("Couldn't load the CachedLayer");
             },
             update: (dt) => {
                 timer += dt;

                 if (timer >= CACHE_REDRAW_SECONDS)
                 {
                     timer = 0.0;
                     recolor();
                     cache.markDirty();
                 }
             },
             submit: () => {
                 cache.update(drawCells); // Draws only when it needs to
                 cache.submit(gBatcher, Layers.kShapes);
             } };
}

/*
    One Spine sample skeleton (see SPINE_ITEMS), drawn by a Skeleton2D with SpineSkeletonDebug
    lines over it (while gSpineLines), its animation looping (SpineAnimation.apply() from the setup
    pose each frame).
    It has its own Camera2D and Batcher, drawn from the main batcher as a drawable: the camera's
    viewport is SPINE_CLIP centered in its slot (so it's clipped there), and its position and zoom
    fit everything the whole animation reaches into SPINE_VIEW; the skeleton stays at its origin at
    scale 1. A followed bone (s.follow) is held in place while fitting; when playing, the camera
    follows it across instead, so the world it drives through (the tank's ground and rock) scrolls
    past. Without one, the root bone stays where the setup pose has it.
*/
function makeSpineItem(s, data, debug)
{
    // Its images (a Skeleton2D), or just the lines if it can't load
    let model = new Skeleton2D();

    if (model.load(data) === false)
    {
        console.error(`Spine ${s.name}: couldn't load its Skeleton2D; showing its debug lines only`);
        model = null;
    }

    let skeleton = model?.getSkeleton() ?? new SpineSkeleton(data);
    const animation = data.findAnimation(s.animation);
    const followed = (s.follow !== undefined) ? skeleton.findBone(s.follow) : null;
    const root = followed ?? skeleton.getRootBone(); // Held in place: while fitting, or (no followed bone) always
    let time = 0.0;

    let camera = new Camera2D();
    let batcher = new Batcher();
    batcher.setCamera(camera); // Both layers follow it: 0 the images, 1 the lines over them

    const drawable = { render: () => batcher.render() };
    let center = new Vector2(); // The fitted bounds' center, skeleton units: where the camera looks (plus the follow)
    let followSetupX = 0.0;     // The followed bone's world x in the setup pose

    if (s.skin !== undefined)
    {
        skeleton.setSkin(data.skins[s.skin]);
        skeleton.setSlotsToSetupPose();
    }

    if (animation === null)
        console.error(`Spine ${s.name} has no animation "${s.animation}"; showing its setup pose`);

    // The pose at seconds. isFitting: the held bone in place (a followed one too) and s.fitSkip's attachments off.
    const poseAt = (seconds, lastSeconds, isFitting) => {
        if (animation !== null)
            animation.apply(skeleton, lastSeconds, seconds, true, null, 1.0, SpineMixBlend.setup, SpineMixDirection.mixIn);

        if (isFitting === true || followed === null)
        {
            root.x = root.data.x;
            root.y = root.data.y;
        }

        if (isFitting === true && s.fitSkip !== undefined)
        {
            for (const slot of skeleton.slots)
            {
                if (s.fitSkip.includes(slot.getAttachment()?.name) === true)
                    slot.setAttachment(null);
            }
        }

        skeleton.updateWorldTransform();
    };

    // The bounds over the whole animation (sampled), at scale 1 with the root at the origin
    const fitBounds = () => {
        let min = new Vector2(Infinity, Infinity);
        let max = new Vector2(-Infinity, -Infinity);
        let offset = new Vector2();
        let size = new Vector2();
        const samples = (animation !== null) ? 12 : 1;

        for (let i = 0; i < samples; ++i)
        {
            skeleton.setToSetupPose();
            poseAt((animation !== null) ? (animation.duration * i) / samples : 0.0, 0.0, true);
            skeleton.getBounds(offset, size, []);

            if (Number.isFinite(offset.x) === true && size.x > 0.0)
            {
                min.setXY(Math.min(min.x, offset.x), Math.min(min.y, offset.y));
                max.setXY(Math.max(max.x, offset.x + size.x), Math.max(max.y, offset.y + size.y));
            }
        }

        skeleton.setToSetupPose();
        skeleton.updateWorldTransform();
        followSetupX = followed?.worldX ?? 0.0;
        return (min.x <= max.x) ? { min, max } : null;
    };

    const bounds = fitBounds();
    const label = `Spine ${s.name} - ${s.animation}: ${s.tests}`;

    // The camera fits the whole animation into SPINE_VIEW (zoom 1, looking at the origin, if it has no bounds)
    if (bounds !== null)
    {
        const w = bounds.max.x - bounds.min.x;
        const h = bounds.max.y - bounds.min.y;

        camera.setZoom(Math.min(SPINE_VIEW.x / w, SPINE_VIEW.y / h));
        center.setXY((bounds.min.x + bounds.max.x) / 2.0, (bounds.min.y + bounds.max.y) / 2.0);
    }

    camera.setPosition(center.x, center.y);

    return { label: label,
             place: (x, y) => {
                 // The viewport (and clip rect), centered on (x, y)
                 camera.setViewport(x - (SPINE_CLIP.x / 2.0), y - (SPINE_CLIP.y / 2.0), SPINE_CLIP.x, SPINE_CLIP.y);
             },
             update: (dt) => {
                 const last = time;
                 time += dt;
                 poseAt(time, last, false);

                 // Following: the camera moves across with the bone, so it keeps its place in the view
                 if (followed !== null)
                     camera.setPosition(center.x + (followed.worldX - followSetupX), center.y);

                 camera.update(dt);
             },
             submit: () => {
                 // The images on layer 0, the lines over them on layer 1, as thick on screen at any zoom
                 if (model !== null)
                     batcher.submit(model, SPINE_ORIGIN, 0);

                 if (gSpineLines === true)
                 {
                     debug.setLineWidth(SPINE_LINE_WIDTH / camera.getZoom());
                     debug.submit(batcher, skeleton, 1);
                 }

                 gBatcher.submitDrawable(drawable, Layers.kParticles);
             } };
}

// The page transition (see turnPage())
function buildTransition()
{
    gTransition = new ScreenTransition();

    if (gTransition.load() === false)
    {
        console.error("Couldn't load the page transition; pages will just change");
        gTransition = null;
    }
}

/*
    Drawn after the labels (see drawHud()): a page change captures the canvas (this
    frame's scene and labels) and turns the page; otherwise a running transition
    draws the captured page over the new one.
*/
const gTransitionDrawable = {
    render: () => {
        if (gPages.isTurning === true)
            turnPage();
        else if (gTransition !== null)
            gTransition.render();
    }
};

// The next page, with a transition from what's on the canvas now (the scene and labels, before the metrics window)
function turnPage()
{
    gPages.isTurning = false;

    if (gTransition !== null && gTransition.capture() === true)
    {
        gTransition.start(TRANSITION_TYPES[gTransitionIndex], TRANSITION_SECONDS, Easing.kQuadraticInOut, TRANSITION_SOFTNESS);
        gTransitionIndex = (gTransitionIndex + 1) % TRANSITION_TYPES.length;
    }

    gPages.current = (gPages.current + 1) % gPages.count;
    WGLV.setClearColor(PAGE_BACKGROUNDS[gPages.current % PAGE_BACKGROUNDS.length]);
}

// A 1 x 4 strip of numbered discs for the Sprite to count through
function makeSpriteStrip()
{
    const size = 128;
    const colors = ["#e0503c", "#e0b03c", "#4cc070", "#4c8ce0"];

    let c = document.createElement("canvas");
    c.width = size * colors.length;
    c.height = size;

    let ctx = c.getContext("2d");
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 72px sans-serif";

    for (let i = 0; i < colors.length; ++i)
    {
        const cx = (i * size) + (size / 2);

        ctx.fillStyle = colors[i];
        ctx.beginPath();
        ctx.arc(cx, size / 2, size * 0.45, 0, MathDefines.kTwoPi);
        ctx.fill();

        ctx.fillStyle = "#ffffff";
        ctx.fillText(String(i + 1), cx, size / 2);
    }

    let texture = new Texture();

    if (texture.loadCanvas(c) === false)
    {
        console.error("Couldn't build the sprite strip; using the white texture");
            return TextureManager.getWhiteTexture();
    }

    return texture;
}

// *** Frame ***

// ts: requestAnimationFrame()'s time, in milliseconds
function appMain(ts)
{
    const dt = MathUtil.clamp((ts - gFrameTS) * MathDefines.kSecondsPerMs, 0.0, MAX_DT);
    gFrameTS = ts;

    appUpdate(dt);
    appRender();
    requestAnimationFrame(appMain);
}

function appUpdate(dt)
{
    InputManager.update(); // This frame's taps, before anything reads them (the Toggles)

    if (gIsReady === true)
        updateScene(dt);
}

function appRender()
{
    if (gIsReady === true)
    {
        if (gStats.isOverdrawOn === true && gFrameTS >= gStats.nextOverdraw)
        {
            measureOverdraw();
            gStats.nextOverdraw = gFrameTS + OVERDRAW_SAMPLE_MS;
        }

        WGLV.beginFrame();
        ClipSpace.beginFrame();
        beginCounting();
        submitScene();
        gBatcher.render();
        endCounting();
    }
    else
    {
        WGLV.beginFrame();
        ClipSpace.beginFrame();
    }

    // After counting, so they show this frame's numbers
    updateFPS(gFrameTS);
    updateHud(gFrameTS);
    drawHud(); // Labels and HUD after counting, so the metrics are the test items' alone
}

// Moves the pages, the transition and every test item dt seconds on
function updateScene(dt)
{
    const s = gScene;
    s.time += dt;

    // The next page every PAGE_SECONDS, unless paused
    if (gPages.isPaused === false)
    {
        gPages.timer += dt;

        if (gPages.timer >= PAGE_SECONDS)
        {
            gPages.timer = 0.0;
            gPages.isTurning = true; // After this frame's labels are drawn (see gTransitionDrawable)
        }
    }

    if (gTransition !== null)
        gTransition.update(dt);

    // Every item moves, shown or not
    for (const item of s.items)
        item.update(dt, s.time);

    s.lights.apply(); // Once per frame, before anything lit is drawn
}

// The shown page's items into the batcher; drawn by gBatcher.render()
function submitScene()
{
    for (const item of gScene.items)
    {
        if (item.page === gPages.current)
            item.submit();
    }
}

function randomRange(min, max) { return min + (Math.random() * (max - min)); }

// *** Metrics ***

// Wraps the GL draw calls, Material.bind(), BatchBinder.bindMaterial() and Model2D.draw() to count what each frame draws
function installHooks()
{
    const gl = WGLV.context;

    gGLDraw = {
        drawElements: gl.drawElements.bind(gl),
        drawArrays: gl.drawArrays.bind(gl),
        drawElementsInstanced: gl.drawElementsInstanced.bind(gl),
        drawArraysInstanced: gl.drawArraysInstanced.bind(gl)
    };

    gl.drawElements = (mode, count, type, offset) => {
        countDraw(mode, count, 1, false);
        gGLDraw.drawElements(mode, count, type, offset);
    };

    gl.drawArrays = (mode, first, count) => {
        countDraw(mode, count, 1, false);
        gGLDraw.drawArrays(mode, first, count);
    };

    gl.drawElementsInstanced = (mode, count, type, offset, instances) => {
        countDraw(mode, count, instances, true);
        gGLDraw.drawElementsInstanced(mode, count, type, offset, instances);
    };

    gl.drawArraysInstanced = (mode, first, count, instances) => {
        countDraw(mode, count, instances, true);
        gGLDraw.drawArraysInstanced(mode, first, count, instances);
    };

    const materialBind = Material.prototype.bind;

    Material.prototype.bind = function(...args)
    {
        if (gStats.isCounting === true)
            gStats.materials.add(this);

        return materialBind.apply(this, args);
    };

    // The batcher binds Materials through its BatchBinder, not Material.bind()
    const binderBind = BatchBinder.prototype.bindMaterial;

    BatchBinder.prototype.bindMaterial = function(material, withShader)
    {
        if (gStats.isCounting === true)
            gStats.materials.add(material);

        return binderBind.call(this, material, withShader);
    };

    // Sprite.draw() calls super.draw(), which comes here too
    const modelDraw = Model2D.prototype.draw;

    Model2D.prototype.draw = function(...args)
    {
        const outer = gStats.drawingModel;
        gStats.drawingModel = this;
        modelDraw.apply(this, args); // Passed on as given, so the defaults (its own Material) still apply
        gStats.drawingModel = outer;
    };
}

function countDraw(mode, count, instances, isInstanced)
{
    if (gStats.isCounting === false)
        return;

    ++gStats.drawCalls;
    gStats.vertices += count * instances;
    gStats.rects += quadsIn(mode, count, instances, isInstanced);
}

// Quads in one draw call (see Rectangles at the top of this file)
function quadsIn(mode, count, instances, isInstanced)
{
    const gl = WGLV.context;

    if (mode !== gl.TRIANGLES)
        return 0;

    // Every instanced draw here is a 6-index quad per instance (Batcher, Particles2D)
    if (isInstanced === true)
        return (count === 6) ? instances : 0;

    const m = gStats.drawingModel;

    if (m instanceof TextGlyphs2D)
        return Math.floor(count / 6); // One quad per glyph

    if (m instanceof Rect2D || m instanceof Sprite || m instanceof Text2D)
        return 1;

    return 0; // RoundedRect2D, NinePatch2D, or not a model
}

function beginCounting()
{
    gStats.isCounting = true;
    gStats.vertices = 0;
    gStats.rects = 0;
    gStats.drawCalls = 0;
    gStats.stateStart = RenderState.getChangeCount();
    gStats.materials.clear();
}

function endCounting()
{
    gStats.isCounting = false;
    gStats.last.vertices = gStats.vertices;
    gStats.last.rects = gStats.rects;
    gStats.last.drawCalls = gStats.drawCalls;
    gStats.last.stateChanges = RenderState.getChangeCount() - gStats.stateStart;
    gStats.last.bindsSent = gBatcher.getBindsSent(); // The scene's render(), just done
    gStats.last.bindsSkipped = gBatcher.getBindsSkipped();
    gStats.last.materials = gStats.materials.size;
    gStats.materials.clear(); // Don't keep Materials alive
}

function updateFPS(ts)
{
    ++gStats.fpsFrames;

    const elapsed = ts - gStats.fpsStart;

    if (elapsed >= 500.0)
    {
        gStats.fps = (gStats.fpsFrames * 1000.0) / elapsed;
        gStats.frameMs = elapsed / gStats.fpsFrames;
        gStats.fpsFrames = 0;
        gStats.fpsStart = ts;
    }
}

function updateHud(ts)
{
    if (gHud === null || ts < gStats.nextHud)
        return;

    gStats.nextHud = ts + HUD_REFRESH_MS;

    if (gIsReady === false)
    {
        setHudText("Loading...");
            return;
    }

    const l = gStats.last;
    let overdraw = "n/a";

    if (gStats.isOverdrawOn === false)
        overdraw = "off (O turns it on)";
    else if (gMark !== null && gStats.viewPixels > 0)
    {
        const share = (100.0 * gStats.overdrawPixels) / gStats.viewPixels;
        overdraw = `${formatCount(gStats.overdrawPixels)} px (${share.toFixed(1)}% of view)`;
    }

    const p = gPages;
    const pageState = (p.isPaused === true) ? "(paused, space resumes)" : `(next in ${Math.max(1, Math.ceil(PAGE_SECONDS - p.timer))} s)`;

    // One per HUD_LABELS entry, in order
    const values = [
        `${p.current + 1} / ${p.count} ${pageState}`,
        `${gStats.fps.toFixed(1)} (${gStats.frameMs.toFixed(2)} ms)`,
        formatCount(l.vertices),
        String(l.materials),
        formatCount(l.rects),
        overdraw,
        String(l.drawCalls),
        String(l.stateChanges),
        `${l.bindsSent} sent, ${l.bindsSkipped} skipped`,
        `${RenderTarget.getCount()} (${(RenderTarget.getTotalMemoryBytes() / 1048576).toFixed(1)} MB), ${RenderTargetPool.getCount()} pooled`,
        "Space pause, O overdraw, B Spine lines"
    ];

    // Labels padded to one width; the font is monospaced, so the values line up
    const width = Math.max(...HUD_LABELS.map((s) => s.length)) + 2;
    setHudText(HUD_LABELS.map((label, i) => label.padEnd(width) + values[i]).join("\n"));
}

function formatCount(n) { return n.toLocaleString("en-US"); }

// *** HUD ***

// The metrics window: a Label (text on a panel that fits itself to the text), pinned to the view's top-left corner
function buildHud()
{
    const font = FontManager.loadFromSystem(HUD_FONT);
    const atlas = new TextAtlas(font, TextAtlas.kAscii, HUD_FONT_SIZE);

    if (atlas.isLoaded() === false)
    {
        console.error("Couldn't build the HUD's TextAtlas; there's no metrics window");
            return;
    }

    gHud = new Label(atlas);
    gHud.setPanelColor(Colors.kHudPanel);
    gHud.setTextColor(Colors.kHudText);
    gHud.setPadding(HUD_PADDING);
    gHud.setPos(HUD_MARGIN, DESIGN_HEIGHT - HUD_MARGIN, Alignment.kTopLeft);
    gHud.setText("Loading...");
}

function setHudText(str)
{
    if (gHud !== null)
        gHud.setText(str);
}

/*
    The shown page's item labels and the metrics window, in their own batcher pass on top
    of the scene. The page transition is a drawable on the labels' layer, so it runs after
    the labels and before the metrics window's layers: the old page's labels are in the
    capture and leave with its items, and the metrics window is never in it.
*/
function drawHud()
{
    if (gIsReady === true)
    {
        for (const item of gScene.items)
        {
            if (item.page === gPages.current)
                gBatcher.submit(item.labelText, item.labelAt, Layers.kLabels, null, Colors.kLabel);
        }

        gBatcher.submitDrawable(gTransitionDrawable, Layers.kLabels);
    }

    if (gHud === null)
    {
        gBatcher.render();
            return;
    }

    gHud.submit(gBatcher, Layers.kHudPanel, Layers.kHudText);
    gBatcher.render();
}

// *** Overdraw ***

// A program that fills the view (one big triangle from gl_VertexID, no buffers) with white
function setupOverdrawMarking()
{
    const gl = WGLV.context;

    if (gl.getContextAttributes()?.stencil !== true)
    {
        console.error("The WebGL context has no stencil buffer");
            return false;
    }

    const vs = `#version 300 es
        void main() {
            vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
            gl_Position = vec4((p * 2.0) - 1.0, 0.0, 1.0);
        }`;

    const fs = `#version 300 es
        precision mediump float;
        out vec4 outColor;
        void main() {
            outColor = vec4(1.0);
        }`;

    const program = buildProgram(vs, fs);

    if (program === null)
        return false;

    gMark = { program, vao: gl.createVertexArray(), pixels: null };
        return true;
}

function buildProgram(vsSource, fsSource)
{
    const gl = WGLV.context;
    const vs = compileShader(gl.VERTEX_SHADER, vsSource);
    const fs = compileShader(gl.FRAGMENT_SHADER, fsSource);

    if (vs === null || fs === null)
        return null;

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true)
    {
        console.error("Overdraw program didn't link: " + gl.getProgramInfoLog(program));
        gl.deleteProgram(program);
            return null;
    }

    return program;
}

function compileShader(type, source)
{
    const gl = WGLV.context;
    const shader = gl.createShader(type);

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true)
    {
        console.error("Overdraw shader didn't compile: " + gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
            return null;
    }

    return shader;
}

/*
    Draws the scene with every fragment adding 1 to its pixel's stencil, then
    marks red where the stencil is 2 or more (overdrawn), reads the view back
    and counts. The visible frame is drawn over it afterwards.
*/
function measureOverdraw()
{
    if (gMark === null)
        return;

    const gl = WGLV.context;

    WGLV.beginFrame(); // Also points drawing at the canvas through the view
    ClipSpace.beginFrame();

    gl.stencilMask(0xFF);
    gl.clearStencil(0);
    gl.clear(gl.STENCIL_BUFFER_BIT);
    gl.enable(gl.STENCIL_TEST);
    gl.stencilFunc(gl.ALWAYS, 0, 0xFF);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR); // No depth test, so every fragment that's drawn passes

    submitScene();
    gBatcher.render();

    // Mark the overdrawn pixels: the stencil test passes where ref (2) <= stencil
    gl.disable(gl.BLEND);
    gl.colorMask(true, true, true, true);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    gl.stencilFunc(gl.LEQUAL, 2, 0xFF);

    gl.useProgram(gMark.program);
    gl.bindVertexArray(gMark.vao);
    gGLDraw.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.colorMask(true, true, true, true);
    gl.disable(gl.STENCIL_TEST);
    RenderState.invalidate(); // Blending was turned off here, behind its back

    // The view rect in canvas pixels
    const x = WGLV.getViewportX();
    const y = WGLV.getViewportY();
    const w = WGLV.getViewportWidth();
    const h = WGLV.getViewportHeight();
    const size = w * h * 4;

    if (gMark.pixels === null || gMark.pixels.length !== size)
        gMark.pixels = new Uint8Array(size);

    const p = gMark.pixels;
    gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, p);

    // Antialiased edges come back part way; count a pixel when it's at least half marked
    let overdrawn = 0;

    for (let i = 0; i < size; i += 4)
    {
        if (p[i] >= 128)
            ++overdrawn;
    }

    gStats.overdrawPixels = overdrawn;
    gStats.viewPixels = w * h;
}
