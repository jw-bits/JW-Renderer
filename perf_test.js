"use strict";

/*
    Performance Test - One of every Model2D type (Rect2D, RoundedRect2D,
    NinePatch2D, Sprite, Text2D, TextGlyphs2D), a Particles2D, every text
    effect (Wave, Fade, Ease, Scroll), two lit Rect2Ds, two Toggles, two
    CheckBoxes, three Buttons (tap them; see InputManager) and a Camera2D
    view of a small world, with a small metrics window.

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
        FPS         Frames per second, averaged over the last half second
        Vertices    Vertex shader runs: each draw call's index (or vertex) count times its instances
        Materials   Different Materials bound
        Rectangles  Quads drawn: each instance of an instanced draw (Rect2D, Text2D, Sprite through
                    the batcher, and every particle), plus Rect2D / Sprite / Text2D drawn on their own
                    and each glyph of a TextGlyphs2D. RoundedRect2D and NinePatch2D aren't quads.
        Overdraw    Pixels drawn 2 or more times, and the share of the view that is
        Draw calls  GL draw calls

    The counts come from wrapping, from here, the GL
    context's draw calls, Material.prototype.bind and Model2D.prototype.draw.

    Overdraw: the context is created with a stencil buffer. Twice a second the
    scene is drawn one extra time with every fragment incrementing the
    stencil, then a full-view pass marks pixels with a stencil of 2 or more,
    and they're read back and counted. Transparent parts of a quad count as
    drawn (they're still rasterized and blended); clipped (scissored)
    fragments don't. The normal frame is then drawn over it, so the extra
    pass is never seen, but it does cost those frames some time.

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

const ITEM_RAISE = 20;           // An item sits this far above its cell's center, leaving room for its label
const LABEL_FONT_SIZE = 20;
const LABEL_Y = 26;              // A label's center, above its cell's bottom

const HUD_REFRESH_MS = 250;      // How often the metrics window updates

// The metrics window, in design units: a dark panel in slot 0 with the metrics on it
const HUD_FONT = "Consolas, 'Courier New', monospace"; // Monospaced, so the label column lines up with spaces
const HUD_FONT_SIZE = 16.5;
const HUD_MARGIN = 10.5;         // From the view's top-left corner
const HUD_PADDING = 7.5;         // Around the text, inside the panel
const HUD_LABELS = ["Page", "FPS", "Vertices", "Materials", "Rectangles", "Overdraw", "Draw calls"];
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

const Layers = {
    kLit: 0,       // The lit brick Rect2Ds; the batcher lights this layer
    kShapes: 1,    // Rect2D, RoundedRect2D, NinePatch2D, Sprite
    kText: 2,      // Text2D, TextGlyphs2D
    kEffects: 3,   // The text effects
    kParticles: 4,
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
let gPrevTS = 0.0;
let gEaseHold = 0.0;    // Seconds the ease holds its end before playing again

// Which page is shown; it changes every PAGE_SECONDS unless paused (space)
let gPages = { current: 0, count: 1, timer: 0.0, isPaused: false };

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

    // The last finished frame
    last: { vertices: 0, rects: 0, drawCalls: 0, materials: 0 },

    // FPS over a window of frames
    fpsFrames: 0,
    fpsStart: 0.0,
    fps: 0.0,
    frameMs: 0.0,

    // Overdraw, from the last sample
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
    WGLV.setClearColor(Colors.kBackground);
    WGLV.resizeToWindow();

    if (InputManager.init() === false)
        console.error("InputManager couldn't start; the Toggles won't respond to taps");

    appSetup();
};

window.onresize = () => WGLV.resizeToWindow();

// Space pauses and resumes the page cycle
window.addEventListener("keydown", (e) => {
    if (e.code !== "Space" || e.repeat === true)
        return;

    e.preventDefault(); // No page scroll
    gPages.isPaused = !gPages.isPaused;
});

function appSetup()
{
    const gl = WGLV.context;

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    installHooks();

    if (setupOverdrawMarking() === false)
        console.error("Couldn't set up overdraw counting; it will show as n/a");

    loadAssets().then(() => {
        buildScene();
        gIsReady = true;
    });

    gPrevTS = performance.now();
    gStats.fpsStart = gPrevTS;
    requestAnimationFrame(appMain);
}

// Failed loads come back as the manager's white texture, so this always finishes
async function loadAssets()
{
    FontManager.setDefaultFamily("'Segoe UI', Arial, sans-serif");
    gBatcher = new MaterialBatcher();
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

    gScene = { textures: { rect: rectTex, circle: circleTex, ninePatch: ninePatchTex, particle: particleTex,
                           brick: brickTex, brickNormals: brickNormalTex, check: checkTex } };
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

    let rect = new Rect2D();
    rect.load(t.rect, 200, 200);

    items.push({ label: "Rect2D - rotating",
                 place: (x, y) => rect.setPos(x, y, Alignment.kMiddleCenter),
                 update: (dt, time) => rect.setRotation(time * 0.6),
                 submit: () => gBatcher.submit(rect, Layers.kShapes) });

    let rounded = new RoundedRect2D();
    rounded.load(t.circle, 300, 200, 40);

    items.push({ label: "RoundedRect2D - pulsing scale",
                 place: (x, y) => rounded.setPos(x, y, Alignment.kMiddleCenter),
                 update: (dt, time) => rounded.setScale(1.0 + (0.15 * Math.sin(time * 2.0))),
                 submit: () => gBatcher.submit(rounded, Layers.kShapes) });

    let ninePatch = new NinePatch2D();
    ninePatch.load(t.ninePatch, 380, 180, new UVRect(0.3, 0.3, 0.4, 0.4));

    items.push({ label: "NinePatch2D - stretched, borders kept",
                 place: (x, y) => ninePatch.setPos(x, y, Alignment.kMiddleCenter),
                 update: (dt, time) => ninePatch.setRotation(0.15 * Math.sin(time * 1.3)),
                 submit: () => gBatcher.submit(ninePatch, Layers.kShapes) });

    let sprite = new Sprite();
    sprite.load(makeSpriteStrip(), 200, 200, 1, 4);
    sprite.createSequence("count", 0, 0, 0, 3, 1.2);
    sprite.play("count");

    items.push({ label: "Sprite - frame animation",
                 place: (x, y) => sprite.setPos(x, y, Alignment.kMiddleCenter),
                 update: (dt) => sprite.update(dt),
                 submit: () => gBatcher.submit(sprite, Layers.kShapes) });

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
                 place: (x, y) => origin.set(x, (y - ITEM_RAISE) - (CELL_H / 2.0) + PARTICLE_BASE),
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
    text.setText(TEXT_TEXT2D);

    items.push({ label: "Text2D - rasterized, drop shadow",
                 place: (x, y) => text.setPos(x, y, Alignment.kMiddleCenter),
                 update: () => { },
                 submit: () => gBatcher.submit(text, Layers.kText) });

    // One atlas for every TextGlyphs2D
    const atlas = new TextAtlas(font, TEXT_GLYPHS + TEXT_WAVE + TEXT_FADE + TEXT_EASE + TEXT_SCROLL, 72, "bold");
    const glyphs = makeGlyphs(atlas, TEXT_GLYPHS);

    items.push({ label: "TextGlyphs2D - text from a glyph atlas",
                 place: (x, y) => glyphs.setPos(x, y, Alignment.kMiddleCenter),
                 update: () => { },
                 submit: () => gBatcher.submit(glyphs, Layers.kText) });

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

    items.push(makeCameraItem(t.rect, t.circle));

    // *** Pages and labels ***

    const labelAtlas = new TextAtlas(font, items.map((item) => item.label).join(""), LABEL_FONT_SIZE);

    for (let i = 0; i < items.length; ++i)
    {
        let item = items[i];
        const slot = 1 + (i % ITEMS_PER_PAGE); // Slot 0 is the HUD's
        const x = (CELL_W * (slot % GRID_COLS)) + (CELL_W / 2.0);
        const cellBottom = DESIGN_HEIGHT - (CELL_H * (Math.floor(slot / GRID_COLS) + 1));

        item.page = Math.floor(i / ITEMS_PER_PAGE);
        item.place(x, cellBottom + (CELL_H / 2.0) + ITEM_RAISE);

        item.labelText = new TextGlyphs2D(labelAtlas);
        item.labelText.setColor(Colors.kLabel);
        item.labelText.setPos(x, cellBottom + LABEL_Y, Alignment.kMiddleCenter);
        item.labelText.setText(item.label);
    }

    gPages.count = Math.ceil(items.length / ITEMS_PER_PAGE);

    gScene.items = items;
    gScene.lights = lights;
    gScene.time = 0.0;
}

function makeGlyphs(atlas, str)
{
    let g = new TextGlyphs2D(atlas);
    g.setColor(Colors.kText);
    g.setText(str);
        return g;
}

// A text effect as a test item; it's placed by its TextGlyphs2D
function makeEffectItem(label, effect)
{
    return { label: label,
             place: (x, y) => effect.getGlyphs().setPos(x, y, Alignment.kMiddleCenter),
             update: (dt) => effect.update(dt),
             submit: () => effect.submit(gBatcher, Layers.kEffects) };
}

/*
    A lit Rect2D as a test item, with its own point light circling it (shown by an
    unlit dot) added to lights. rocks turns it back and forth, so its normals turn too.
*/
function makeLitItem(label, model, lights, dotTexture, rocks)
{
    let center = new Vector2();

    let lamp = new PointLight(0, 0, LAMP_Z, LAMP_RANGE);
    lamp.setColor(LAMP_COLOR);
    lights.add(lamp);

    let dot = new Rect2D();
    dot.load(dotTexture, 24, 24);
    dot.setColor(new Vector4(LAMP_COLOR.x, LAMP_COLOR.y, LAMP_COLOR.z, 1.0));

    return { label: label,
             place: (x, y) => {
                 center.set(x, y);
                 model.setPos(x, y, Alignment.kMiddleCenter);
             },
             update: (dt, time) => {
                 const a = time * LAMP_SPEED;
                 const lx = center.x + (Math.cos(a) * LAMP_RADIUS);
                 const ly = center.y + (Math.sin(a) * LAMP_RADIUS * 0.5);

                 lamp.setPosition(lx, ly, LAMP_Z);
                 dot.setPos(lx, ly, Alignment.kMiddleCenter);

                 if (rocks === true)
                     model.setRotation(0.12 * Math.sin(time * 0.9));
             },
             submit: () => {
                 gBatcher.submit(model, Layers.kLit);
                 gBatcher.submit(dot, Layers.kParticles); // Unlit, on top
             } };
}

/*
    A Camera2D as a test item: a checkered world with an arrow at its center, seen
    through a camera the keys move, its viewport the item's slot: A / D pan left /
    right, W / S zoom in / out, E shakes it (adds trauma, with a little rotation
    shake), only while its page is showing.
    It has its own MaterialBatcher with the camera: layer 0 ignores the camera (the
    frame, in screen units), layers 1 and 2 follow it. The pointer, over the
    viewport, is turned into world units (screenToWorld()) and marked with a dot
    in the world, so the dot should sit right under it however the camera moves.
    The batcher is drawn from the main one as a drawable.
*/
function makeCameraItem(arrowTexture, dotTexture)
{
    const white = TextureManager.getWhiteTexture();
    const worldCenter = (CAMERA_TILE * CAMERA_TILES) / 2.0;

    let camera = new Camera2D();
    camera.setPosition(worldCenter, worldCenter);
    camera.setShakeLimits(camera.getShakeMaxOffset(), CAMERA_SHAKE_ROTATION);
    let batcher = new MaterialBatcher();
    batcher.setCamera(camera);
    batcher.setLayerFollowsCamera(0, false);

    let border = new Rect2D();
    border.load(white, CAMERA_VIEW.x + (CAMERA_BORDER * 2), CAMERA_VIEW.y + (CAMERA_BORDER * 2));
    border.setColor(Colors.kLabel);

    let backdrop = new Rect2D();
    backdrop.load(white, CAMERA_VIEW.x, CAMERA_VIEW.y);
    backdrop.setColor(Colors.kBackground);

    let tile = new Rect2D(); // Submitted once per tile, moved and recolored in between
    tile.load(white, CAMERA_TILE, CAMERA_TILE);

    let arrow = new Rect2D();
    arrow.load(arrowTexture, CAMERA_TILE * 2, CAMERA_TILE * 2);
    arrow.setPos(worldCenter, worldCenter, Alignment.kMiddleCenter);

    let cursor = new Rect2D();
    cursor.load(dotTexture, 20, 20);
    cursor.setColor(Colors.kGold);

    const viewport = new Vector4();
    const pointer = new Vector2();
    let showCursor = false;

    const drawable = { render: () => batcher.render() };

    let item = {
        label: "Camera2D - A/D pan, W/S zoom, E shake",
        place: (x, y) => {
            camera.setViewport(x - (CAMERA_VIEW.x / 2.0), y - (CAMERA_VIEW.y / 2.0), CAMERA_VIEW.x, CAMERA_VIEW.y);
            border.setPos(x, y, Alignment.kMiddleCenter);
            backdrop.setPos(x, y, Alignment.kMiddleCenter);
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
                    cursor.setPos(pointer.x, pointer.y, Alignment.kMiddleCenter);
                    showCursor = true;
                }
            }
        },
        submit: () => {
            batcher.submit(border, 0);
            batcher.submit(backdrop, 0);

            for (let r = 0; r < CAMERA_TILES; ++r)
            {
                for (let c = 0; c < CAMERA_TILES; ++c)
                {
                    tile.setColor(((r + c) % 2 === 0) ? Colors.kTileLight : Colors.kTileDark);
                    tile.setPos(c * CAMERA_TILE, r * CAMERA_TILE);
                    batcher.submit(tile, 1);
                }
            }

            batcher.submit(arrow, 1);

            if (showCursor === true)
                batcher.submit(cursor, 2);

            gBatcher.submitDrawable(drawable, Layers.kShapes);
        }
    };

    return item;
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

function appMain(ts)
{
    const dt = Math.min(MAX_DT, Math.max(0.0, (ts - gPrevTS) / 1000.0));
    gPrevTS = ts;

    InputManager.update(); // This frame's taps, before anything reads them (the Toggles)

    if (gIsReady === true)
    {
        appUpdate(dt);

        if (ts >= gStats.nextOverdraw)
        {
            measureOverdraw();
            gStats.nextOverdraw = ts + OVERDRAW_SAMPLE_MS;
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

    updateFPS(ts);
    updateHud(ts);
    drawHud(); // Labels and HUD after counting, so the metrics are the test items' alone
    requestAnimationFrame(appMain);
}

function appUpdate(dt)
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
            gPages.current = (gPages.current + 1) % gPages.count;
        }
    }

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

// Wraps the GL draw calls, Material.bind() and Model2D.draw() to count what each frame draws
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

    // Sprite.draw() calls super.draw(), which comes here too
    const modelDraw = Model2D.prototype.draw;

    Model2D.prototype.draw = function(transform, color, uvRect = null)
    {
        const outer = gStats.drawingModel;
        gStats.drawingModel = this;
        modelDraw.call(this, transform, color, uvRect);
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

    // Every instanced draw here is a 6-index quad per instance (MaterialBatcher, Particles2D)
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
    gStats.materials.clear();
}

function endCounting()
{
    gStats.isCounting = false;
    gStats.last.vertices = gStats.vertices;
    gStats.last.rects = gStats.rects;
    gStats.last.drawCalls = gStats.drawCalls;
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

    if (gMark !== null && gStats.viewPixels > 0)
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
        String(l.drawCalls)
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
    gHud.listenForRasterScale(true); // Stays sharp at any window size
    gHud.setText("Loading...");
}

function setHudText(str)
{
    if (gHud !== null)
        gHud.setText(str);
}

// The shown page's item labels and the metrics window, in their own batcher pass on top of the scene
function drawHud()
{
    if (gIsReady === true)
    {
        for (const item of gScene.items)
        {
            if (item.page === gPages.current)
                gBatcher.submit(item.labelText, Layers.kLabels);
        }
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
    gl.enable(gl.BLEND);

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
