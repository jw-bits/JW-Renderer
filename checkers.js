"use strict";

/*
    Checkers - 2D checkers against a simple computer bot, built on JW-Renderer.

    Screens: Title -> Game -> (Menu overlay with Esc / Menu button) -> Game Over.
    Rules (American checkers):
        - Men move one square diagonally forward; kings move diagonally both ways.
        - Captures are mandatory, and a capturing piece must keep jumping while it can.
        - A man that reaches the far row becomes a king, which ends the turn.
        - A player with no pieces or no legal moves loses.

    Board coordinates: row 0 is the top of the screen, column 0 is the left.
    Red (human) starts at the bottom and moves up; Black (bot) starts at the top.
*/

// *** Constants ***

const BOARD_SIZE = 8;

const EMPTY = 0;
const RED = 1;          // Human
const BLACK = 2;        // Computer
const RED_KING = 3;
const BLACK_KING = 4;

const HUMAN = RED;
const BOT = BLACK;

const BOT_SEARCH_DEPTH = 4;     // Plies (half-moves) the bot looks ahead
const BOT_THINK_DELAY = 0.6;    // Seconds the bot "thinks" before moving
const BOT_STEP_DELAY = 0.35;    // Seconds between each hop of the bot's move (after the piece lands)

// A moving piece slides to its square while lifted: scaled up to MOVE_LIFT_SCALE by halfway, back to 1 as it lands
const MOVE_TIME = 0.35;         // Seconds per hop
const MOVE_LIFT_SCALE = 1.2;

// Sparks from the edge of a piece that lands a jump; speeds and sizes are in squares, so they follow the layout
const SPARK_COUNT = 10;
const SPARK_MAX_ALIVE = 256;
const SPARK_SPEED = new Range(1.5, 3.0);  // Squares per second
const SPARK_LIFE = new Range(0.4, 0.7);   // Seconds
const SPARK_SIZE = 0.14;                  // Squares
const SPARK_GRAVITY = 6.0;                // Squares per second squared, downward
const SPARK_END_SCALE = 0.4;              // Shrink to 40% over each life

// Sound effects, by AudioManager name
const SFX_CLICK = "click";        // The human picks up a piece to move it
const SFX_JUMP_LAND = "jumpland"; // Any piece lands after capturing

const FONT_FAMILY = "'Segoe UI', Arial, sans-serif";
const TITLE_FONT_URL = "./fonts/JimNightshade-Regular.ttf";

// The app's single manager instances, created in loadAssets() after WGLV.init()
let gTextureManager = null;
let gFontManager = null;
let gMaterialManager = null;
let gBatcher = null; // Everything is drawn through it, once per frame
let gSparks = null;  // Particles2D for jumps

// Move animation, created in loadAssets(): one slide and one lift, shared by every move
let gMoveSlide = null;   // AnimAction from square to square; its start and target are set per move
let gMoveLift = null;    // AnimSequence: up to MOVE_LIFT_SCALE, then back to 1
let gSlidePlayer = null; // AnimPlayers on the moving piece's rect; they drive different channels
let gLiftPlayer = null;

let gUIFont = null;    // System font for all menu text (the FontManager's default)
let gTitleFont = null; // The title's font file, or the default font if it couldn't be loaded

class GameScreen
{
    static kTitle = 0;
    static kPlaying = 1;
    static kMenu = 2;
    static kGameOver = 3;
    static kQuit = 4;
}

const Colors = {
    kLightSquare: new Vector4(0.93, 0.85, 0.71, 1.0),
    kDarkSquare: new Vector4(0.45, 0.30, 0.18, 1.0),
    kBorder: new Vector4(0.22, 0.14, 0.08, 1.0),
    kRed: new Vector4(0.90, 0.18, 0.14, 1.0),
    kRedKing: new Vector4(1.0, 0.30, 0.25, 1.0),
    kBlack: new Vector4(0.20, 0.20, 0.23, 1.0),
    kBlackKing: new Vector4(0.30, 0.30, 0.34, 1.0),
    kSelected: new Vector4(1.0, 0.9, 0.2, 0.55),
    kMovable: new Vector4(0.3, 0.9, 0.3, 0.30),
    kLastMove: new Vector4(0.3, 0.6, 1.0, 0.35),
    kHint: new Vector4(1.0, 1.0, 1.0, 0.9),
    kOverlay: new Vector4(0.0, 0.0, 0.0, 0.7),
    kButton: new Vector4(0.36, 0.24, 0.14, 1.0),
    kButtonHover: new Vector4(0.60, 0.40, 0.22, 1.0),
    kTitle: new Vector4(0.96, 0.80, 0.45, 1.0),
    kText: new Vector4(0.94, 0.94, 0.94, 1.0),
    kTextDim: new Vector4(0.65, 0.65, 0.65, 1.0),
    kWin: new Vector4(0.45, 0.95, 0.45, 1.0),
    kLose: new Vector4(1.0, 0.40, 0.35, 1.0),
    kBackground: new Vector4(0.12, 0.10, 0.09, 1.0),
    kBars: new Vector4(0.0, 0.0, 0.0, 1.0),  // Fills the window outside the design area
    kSpark: new Vector4(1.0, 0.85, 0.40, 1.0)
};

// MaterialBatcher layers, back (0) to front (7). Things with different materials
// that must overlap a certain way (a button and its label) go on different layers.
const Layers = {
    kBoard: 0,        // Border, then squares (one material, so submission order holds)
    kHighlight: 1,
    kPieces: 2,       // Pieces and move hints (they never overlap), then sparks on top
    kUIBack: 3,       // Button backgrounds
    kUIText: 4,       // Text and button labels
    kOverlay: 5,      // Darkens everything under the menu / game over screens
    kOverlayBack: 6,  // Buttons on the overlay
    kOverlayText: 7
};

// *** Globals ***

let prevTS = Date.now();
let dt = 0.0;

let gTextures = {};
let gIsReady = false;

let gScreen = GameScreen.kTitle;
let gScreenBeforeMenu = GameScreen.kTitle;

// Receives InputManager's events (see onInputEvent())
const gInputListener = { onInputEvent: (e) => onInputEvent(e) };

// Layout, in design units (WGLV's fixed design resolution), so it's built once
let gLayout = { w: 0, h: 0, sq: 0, boardX: 0, boardY: 0 };
let gRects = {};
let gTexts = {};
let gButtons = {};

// Game state
let gBoard = [];
let gTurn = HUMAN;
let gSelected = null;       // {r, c} of the selected piece
let gChainPiece = null;     // {r, c} of a piece that must keep jumping
let gLastMove = [];         // Squares visited by the last move
let gWinner = EMPTY;
let gBotTimer = 0.0;
let gBotPlan = null;        // Squares the bot's current move walks through
let gGameTime = 0.0;        // Seconds played this game; paused while the menu is open

/*
    The hop being animated, or null. The board already holds the result; until
    the piece lands, its destination square draws the moving rect instead, and
    a captured piece stays drawn where it was.
        { piece, rect, to: {r, c}, captured: {r, c, piece} or null, result, onLanded(result) }
*/
let gMoving = null;

// *** App ***

window.onload = () => {
    if (WGLV.init("wglCanvas") === false)
    {
        console.error("WebGL2 couldn't be initialized");
            return;
    }

    WGLV.setDesignResolution(1920, 1080);
    WGLV.setBarColor(Colors.kBars);
    WGLV.setClearColor(Colors.kBackground);
    WGLV.resizeToWindow();
    appSetup();
};

// The layout is in design units, so a resize only refits the view (text re-rasterizes itself)
window.onresize = () => WGLV.resizeToWindow();

function appSetup()
{
    WGLV.context.disable(WGLV.context.DEPTH_TEST);
    WGLV.context.enable(WGLV.context.BLEND);
    // Blend color normally but keep the canvas alpha at 1, so translucent overlays
    // darken the scene instead of letting the white page show through the canvas
    WGLV.context.blendFuncSeparate(WGLV.context.SRC_ALPHA, WGLV.context.ONE_MINUS_SRC_ALPHA, WGLV.context.ONE, WGLV.context.ONE_MINUS_SRC_ALPHA);

    loadAssets().then(appOnAssetsLoaded);
}

// Failed loads come back as the managers' default texture / font, so this always finishes
async function loadAssets()
{
    gTextureManager = new TextureManager();
    gFontManager = new FontManager(FONT_FAMILY);
    gMaterialManager = new MaterialManager();
    gBatcher = new MaterialBatcher();
    gUIFont = gFontManager.getDefault();

    const files = {
        square: "./textures/square.png",
        piece: "./textures/checker_piece.png",
        king: "./textures/checker_king.png",
        ring: "./textures/circle.png",
        particle: "./textures/particleA.png"
    };

    // Sound can't play until the user's first tap or key; a failed load only logs, and play() then does nothing
    AudioManager.init();

    const names = Object.keys(files);
    const [textures, titleFont] = await Promise.all([
        Promise.all(names.map((name) => gTextureManager.load(files[name]))),
        gFontManager.load(TITLE_FONT_URL),
        AudioManager.loadSFX(SFX_CLICK, "./audio/click.wav"),
        AudioManager.loadSFX(SFX_JUMP_LAND, "./audio/jumpland.wav")
    ]);

    names.forEach((name, i) => { gTextures[name] = textures[i]; });
    gTitleFont = titleFont;

    gSparks = new Particles2D();

    if (gSparks.load(SPARK_MAX_ALIVE, gTextures.particle) === false)
        console.error("Couldn't load the jump sparks; jumps won't show them");

    gSparks.setEndScale(SPARK_END_SCALE); // Gravity depends on the square size; set in appLayout()

    setupMoveAnimation();
}

// The slide and lift every move plays (see startMove())
function setupMoveAnimation()
{
    gMoveSlide = new AnimAction(); // Set up per move in startMove()

    let liftUp = new AnimAction();
    liftUp.setScaleStart(1.0, 1.0);
    liftUp.setScale(MOVE_LIFT_SCALE, MOVE_LIFT_SCALE, MOVE_TIME / 2.0, Easing.kQuadraticOut);

    let putDown = new AnimAction(); // Starts where liftUp left off
    putDown.setScale(1.0, 1.0, MOVE_TIME / 2.0, Easing.kQuadraticIn);

    gMoveLift = new AnimSequence([liftUp, putDown]);

    gSlidePlayer = new AnimPlayer();
    gSlidePlayer.setEventCallback((player, event) => { if (event === AnimEvent.kCompleted) landMove(); });

    gLiftPlayer = new AnimPlayer();
}

/*
    One shared Material per texture, built on Rect2D's default shader, so every
    rect using a texture lands in the same batch (and Rect2Ds draw instanced).
    Falls back to the texture itself (a per-rect material) if it can't be made.
*/
function materialFor(texture)
{
    return gMaterialManager.load(Rect2D.getDefaultShader(), [texture]) ?? texture;
}

function appOnAssetsLoaded()
{
    gIsReady = true;
    resetGame();
    appLayout();

    // Started once the game can react, so nothing queues up while loading
    InputManager.init();
    InputManager.addListener(gInputListener);
    appMain();
}

function appMain()
{
    let now = Date.now();
    dt = (now - prevTS) * 0.001;
    prevTS = now;

    appUpdate(dt);
    appRender();

    requestAnimationFrame(appMain);
}

function appUpdate(dt)
{
    InputManager.update(); // Taps and keys reach onInputEvent() here, before the game updates

    if (gScreen === GameScreen.kPlaying)
    {
        gGameTime += dt;
        updateTimeText();

        // Lift first, so it's back to scale 1 when the slide lands and calls landMove()
        gLiftPlayer.update(dt);
        gSlidePlayer.update(dt);

        updateBot(dt);
    }

    // Sparks freeze while the menu is open, like the game; they finish on the game over screen
    if (gScreen !== GameScreen.kMenu)
        gSparks.update(dt);
}

function appRender()
{
    WGLV.beginFrame(); // Clears the view and the bars around it

    // The render functions only submit to the batcher; it draws everything at the end
    if (gScreen === GameScreen.kMenu)
    {
        renderScreen(gScreenBeforeMenu, false);
        renderMenu();
    }
    else
        renderScreen(gScreen, true);

    gBatcher.render();
}

// *** Layout ***

function appLayout()
{
    const w = WGLV.getWidth();
    const h = WGLV.getHeight();
    const unit = Math.min(w, h);

    // Free the old text textures before building new ones
    for (const key in gTexts)
        gTexts[key].unload();

    for (const key in gButtons)
        gButtons[key].unload();

    gRects = {};
    gTexts = {};
    gButtons = {};

    // Board
    const sq = Math.max(16, Math.floor(Math.min(w * 0.9, h * 0.78) / BOARD_SIZE));
    const boardPx = sq * BOARD_SIZE;
    const boardX = Math.floor((w - boardPx) / 2);
    const boardY = Math.floor((h - boardPx) * 0.4);
    const border = Math.max(4, Math.floor(sq * 0.15));
    const pieceSize = Math.floor(sq * 0.86);
    const hintSize = Math.floor(sq * 0.5);

    gLayout = { w, h, sq, boardX, boardY };
    gSparks.setGravity(0, -SPARK_GRAVITY * sq);

    // makeRect() shares one Material per texture, so the board is one batch
    gRects.border = makeRect(gTextures.square, boardPx + (border * 2), boardPx + (border * 2), Colors.kBorder);
    gRects.border.setPos(boardX - border, boardY - border);

    gRects.lightSquare = makeRect(gTextures.square, sq, sq, Colors.kLightSquare);
    gRects.darkSquare = makeRect(gTextures.square, sq, sq, Colors.kDarkSquare);
    gRects.highlight = makeRect(gTextures.square, sq, sq, Colors.kSelected);

    gRects.redMan = makeRect(gTextures.piece, pieceSize, pieceSize, Colors.kRed);
    gRects.redKing = makeRect(gTextures.king, pieceSize, pieceSize, Colors.kRedKing);
    gRects.blackMan = makeRect(gTextures.piece, pieceSize, pieceSize, Colors.kBlack);
    gRects.blackKing = makeRect(gTextures.king, pieceSize, pieceSize, Colors.kBlackKing);
    gRects.hint = makeRect(gTextures.ring, hintSize, hintSize, Colors.kHint);

    // The piece in motion gets its own rect, so the animation can scale it without touching the shared ones
    gRects.moving = {};
    gRects.moving[RED] = makeRect(gTextures.piece, pieceSize, pieceSize, Colors.kRed);
    gRects.moving[RED_KING] = makeRect(gTextures.king, pieceSize, pieceSize, Colors.kRedKing);
    gRects.moving[BLACK] = makeRect(gTextures.piece, pieceSize, pieceSize, Colors.kBlack);
    gRects.moving[BLACK_KING] = makeRect(gTextures.king, pieceSize, pieceSize, Colors.kBlackKing);

    gRects.overlay = makeRect(gTextures.square, w, h, Colors.kOverlay);
    gRects.overlay.setPos(0, 0);

    // Title screen
    gTexts.title = makeText("CHECKERS", unit * 0.15, "normal", Colors.kTitle, w / 2, h * 0.70, Alignment.kMiddleCenter, gTitleFont);
    gTexts.subtitle = makeText("You play Red against the computer", unit * 0.035, "normal", Colors.kTextDim, w / 2, h * 0.57);
    gButtons.start = new Button("Start Game", w / 2, h * 0.42, unit * 0.38, unit * 0.10, unit * 0.045, unit * 0.035);
    gTexts.titleHint = makeText("Enter - Start      Esc - Menu", unit * 0.028, "normal", Colors.kTextDim, w / 2, h * 0.27);

    // Game screen
    const boardTop = boardY + boardPx + border;
    gTexts.status = makeText("", unit * 0.04, "bold", Colors.kText, w / 2, boardTop + ((h - boardTop) / 2));
    const menuW = unit * 0.16;
    const menuH = unit * 0.06;
    const margin = Math.round(unit * 0.03);
    gButtons.menu = new Button("Menu", margin + (menuW / 2), h - margin - (menuH / 2), menuW, menuH, unit * 0.03);
    gTexts.time = makeText("", unit * 0.04, "bold", Colors.kText, w - margin, h - margin - (menuH / 2), Alignment.kMiddleRight);

    // Menu screen
    gTexts.menuTitle = makeText("MENU", unit * 0.10, "bold", Colors.kTitle, w / 2, h * 0.66);
    gButtons.quit = new Button("Quit", w / 2, h * 0.48, unit * 0.32, unit * 0.09, unit * 0.045);
    gTexts.menuHint = makeText("Esc - Resume", unit * 0.028, "normal", Colors.kTextDim, w / 2, h * 0.34);

    // Game over
    gTexts.gameOver = makeText("", unit * 0.12, "bold", Colors.kText, w / 2, h * 0.58);
    gTexts.gameOverHint = makeText("Click or press Enter to return to the title screen", unit * 0.03, "normal", Colors.kText, w / 2, h * 0.45);

    // Quit
    gTexts.quitTitle = makeText("Thanks for playing!", unit * 0.08, "bold", Colors.kTitle, w / 2, h * 0.56);
    gTexts.quitHint = makeText("You can close this window now.", unit * 0.032, "normal", Colors.kTextDim, w / 2, h * 0.44);

    updateStatusText();
    updateTimeText();
    updateGameOverText();
}

function makeRect(texture, w, h, color)
{
    let r = new Rect2D();
    r.load(materialFor(texture), Math.round(w), Math.round(h));
    r.setColor(color);
    return r;
}

function makeRoundedRect(texture, w, h, radius, color)
{
    let r = new RoundedRect2D();
    r.load(materialFor(texture), Math.round(w), Math.round(h), radius);
    r.setColor(color);
    return r;
}

function makeText(text, fontSize, weight, color, x, y, align = Alignment.kMiddleCenter, font = gUIFont)
{
    let t = new Text2D(font, Math.max(8, Math.round(fontSize)), weight);
    t.setColor(color);
    t.setPos(Math.round(x), Math.round(y), align);
    t.setText(text);
    return t;
}

class Button
{
    #bg;
    #label;
    #x;
    #y;
    #w;
    #h;

    // (cx, cy) is the center of the button; a _cornerRadius > 0 gives it rounded corners
    constructor(_text, _cx, _cy, _w, _h, _fontSize, _cornerRadius = 0)
    {
        this.#w = Math.round(_w);
        this.#h = Math.round(_h);
        this.#x = Math.round(_cx - (this.#w / 2));
        this.#y = Math.round(_cy - (this.#h / 2));

        if (_cornerRadius > 0)
            this.#bg = makeRoundedRect(gTextures.square, this.#w, this.#h, _cornerRadius, Colors.kButton);
        else
            this.#bg = makeRect(gTextures.square, this.#w, this.#h, Colors.kButton);
        this.#bg.setPos(this.#x, this.#y);
        this.#label = makeText(_text, _fontSize, "bold", Colors.kText, _cx, _cy);
    }

    contains(px, py)
    {
        return (px >= this.#x && px <= this.#x + this.#w && py >= this.#y && py <= this.#y + this.#h);
    }

    // The background goes on backLayer, the label on textLayer (in front of it)
    render(isActive, backLayer = Layers.kUIBack, textLayer = Layers.kUIText)
    {
        const p = InputManager.getPosition();
        const hover = (isActive === true) && InputManager.hasPosition() && this.contains(p.x, p.y);
        this.#bg.setColor(hover ? Colors.kButtonHover : Colors.kButton);
        gBatcher.submit(this.#bg, backLayer);
        gBatcher.submit(this.#label, textLayer);
    }

    unload()
    {
        this.#label.unload();
    }
}

// *** Rendering ***

function renderScreen(screen, isActive)
{
    switch (screen)
    {
        case GameScreen.kTitle: renderTitle(isActive); break;
        case GameScreen.kPlaying: renderGame(isActive); break;
        case GameScreen.kGameOver: renderGame(false); renderGameOver(); break;
        case GameScreen.kQuit: renderQuit(); break;
    }
}

function renderTitle(isActive)
{
    gBatcher.submit(gTexts.title, Layers.kUIText);
    gBatcher.submit(gTexts.subtitle, Layers.kUIText);
    gButtons.start.render(isActive);
    gBatcher.submit(gTexts.titleHint, Layers.kUIText);
}

function renderGame(isActive)
{
    const sq = gLayout.sq;

    gBatcher.submit(gRects.border, Layers.kBoard);

    // Squares (submitted after the border, with the same material, so they draw on top of it)
    for (let r = 0; r < BOARD_SIZE; r++)
    {
        for (let c = 0; c < BOARD_SIZE; c++)
        {
            let rect = ((r + c) % 2 === 0) ? gRects.lightSquare : gRects.darkSquare;
            rect.setPos(squareX(c), squareY(r));
            gBatcher.submit(rect, Layers.kBoard);
        }
    }

    // Highlights
    for (const s of gLastMove)
        renderHighlight(s.r, s.c, Colors.kLastMove);

    if (gTurn === HUMAN && gScreen === GameScreen.kPlaying && gChainPiece === null && gMoving === null)
    {
        for (let r = 0; r < BOARD_SIZE; r++)
        {
            for (let c = 0; c < BOARD_SIZE; c++)
            {
                if (getLegalTargets(gBoard, r, c, HUMAN).length > 0)
                    renderHighlight(r, c, Colors.kMovable);
            }
        }
    }

    if (gSelected !== null)
        renderHighlight(gSelected.r, gSelected.c, Colors.kSelected);

    // Pieces; a moving piece's destination is drawn by its own rect, below
    for (let r = 0; r < BOARD_SIZE; r++)
    {
        for (let c = 0; c < BOARD_SIZE; c++)
        {
            if (gMoving !== null && r === gMoving.to.r && c === gMoving.to.c)
                continue;

            renderPiece(gBoard[r][c], r, c);
        }
    }

    // The moving piece, on top of the others (same layer and material, so submission order holds)
    if (gMoving !== null)
    {
        if (gMoving.captured !== null)
            renderPiece(gMoving.captured.piece, gMoving.captured.r, gMoving.captured.c); // Until it's landed on

        gBatcher.submit(gMoving.rect, Layers.kPieces);
    }

    gBatcher.submitDrawable(gSparks, Layers.kPieces); // Drawn after the layer's pieces, so on top

    // Where the selected piece can go
    if (gTurn === HUMAN && gSelected !== null)
    {
        const hintOffset = (sq - Math.floor(sq * 0.5)) / 2;

        for (const t of getLegalTargets(gBoard, gSelected.r, gSelected.c, HUMAN))
        {
            gRects.hint.setPos(Math.round(squareX(t.c) + hintOffset), Math.round(squareY(t.r) + hintOffset));
            gBatcher.submit(gRects.hint, Layers.kPieces);
        }
    }

    gBatcher.submit(gTexts.status, Layers.kUIText);
    gBatcher.submit(gTexts.time, Layers.kUIText);
    gButtons.menu.render(isActive);
}

// Draws piece p (EMPTY draws nothing) on (r, c) with the shared piece rects
function renderPiece(p, r, c)
{
    let rect = null;

    switch (p)
    {
        case RED: rect = gRects.redMan; break;
        case BLACK: rect = gRects.blackMan; break;
        case RED_KING: rect = gRects.redKing; break;
        case BLACK_KING: rect = gRects.blackKing; break;
    }

    if (rect === null)
        return;

    rect.setPos(pieceX(c), pieceY(r));
    gBatcher.submit(rect, Layers.kPieces);
}

function renderHighlight(r, c, color)
{
    gRects.highlight.setColor(color);
    gRects.highlight.setPos(squareX(c), squareY(r));
    gBatcher.submit(gRects.highlight, Layers.kHighlight);
}

function renderMenu()
{
    gBatcher.submit(gRects.overlay, Layers.kOverlay);
    gBatcher.submit(gTexts.menuTitle, Layers.kOverlayText);
    gButtons.quit.render(true, Layers.kOverlayBack, Layers.kOverlayText);
    gBatcher.submit(gTexts.menuHint, Layers.kOverlayText);
}

function renderGameOver()
{
    gBatcher.submit(gRects.overlay, Layers.kOverlay);
    gBatcher.submit(gTexts.gameOver, Layers.kOverlayText);
    gBatcher.submit(gTexts.gameOverHint, Layers.kOverlayText);
}

function renderQuit()
{
    gBatcher.submit(gTexts.quitTitle, Layers.kUIText);
    gBatcher.submit(gTexts.quitHint, Layers.kUIText);
}

// A ring of sparks flying out from the edge of the piece that just landed on (r, c)
function emitJumpSparks(r, c)
{
    const sq = gLayout.sq;
    const cx = squareX(c) + (sq / 2);
    const cy = squareY(r) + (sq / 2);
    const radius = Math.floor(sq * 0.86) / 2; // The piece's size, as in appLayout()
    const step = (Math.PI * 2.0) / SPARK_COUNT;

    for (let i = 0; i < SPARK_COUNT; i++)
    {
        const angle = (i * step) + MathUtil.randomFloat(-0.3, 0.3) * step;
        const dx = Math.cos(angle);
        const dy = Math.sin(angle);
        const speed = SPARK_SPEED.random() * sq;

        gSparks.emit(cx + (dx * radius), cy + (dy * radius), dx * speed, dy * speed, SPARK_LIFE.random(), SPARK_SIZE * sq, Colors.kSpark);
    }
}

function squareX(c) { return gLayout.boardX + (c * gLayout.sq); }
function squareY(r) { return gLayout.boardY + ((BOARD_SIZE - 1 - r) * gLayout.sq); }

// A piece's bottom-left corner on a square: centered, at the size from appLayout()
function pieceOffset() { return (gLayout.sq - Math.floor(gLayout.sq * 0.86)) / 2; }
function pieceX(c) { return Math.round(squareX(c) + pieceOffset()); }
function pieceY(r) { return Math.round(squareY(r) + pieceOffset()); }

function updateStatusText()
{
    if (gTexts.status === undefined)
        return;

    let text = "";

    if (gTurn === BOT)
        text = "Computer is thinking...";
    else if (gChainPiece !== null)
        text = "Keep jumping!";
    else if (playerHasJump(gBoard, HUMAN))
        text = "Your turn - you must capture";
    else
        text = "Your turn";

    gTexts.status.setText(text);
}

// Game time as "mm:ss"; minutes keep counting past 59
function formatTime(seconds)
{
    const total = Math.floor(seconds);
    const mm = String(Math.floor(total / 60)).padStart(2, "0");
    const ss = String(total % 60).padStart(2, "0");
    return `${mm}:${ss}`;
}

function updateTimeText()
{
    if (gTexts.time === undefined)
        return;

    gTexts.time.setText(formatTime(gGameTime)); // Only re-rasterizes when the second changes
}

function updateGameOverText()
{
    if (gTexts.gameOver === undefined || gWinner === EMPTY)
        return;

    const humanWon = (gWinner === HUMAN);
    gTexts.gameOver.setColor(humanWon ? Colors.kWin : Colors.kLose);
    gTexts.gameOver.setText(humanWon ? "You Win!" : "You Lose!");
}

// *** Input ***

function cellAt(x, y)
{
    const c = Math.floor((x - gLayout.boardX) / gLayout.sq);
    const r = BOARD_SIZE - 1 - Math.floor((y - gLayout.boardY) / gLayout.sq);

    if (inBounds(r, c) === false)
        return null;

    return { r, c };
}

// InputManager listener; returns true when the event was used
function onInputEvent(e)
{
    if (gIsReady === false || gScreen === GameScreen.kQuit || e.hasBeenConsumed === true)
        return false;

    switch (e.type)
    {
        case InputEventType.kTap: return onTap(e.position.x, e.position.y);
        case InputEventType.kKeyDown: return (e.isRepeat === false) && onKeyDown(e.code);
        default: return false;
    }
}

// (x, y) in design units, +Y up to match Rect2D
function onTap(x, y)
{
    switch (gScreen)
    {
        case GameScreen.kTitle:
        {
            if (gButtons.start.contains(x, y) === false)
                return false;

            startGame();
        }
        break;

        case GameScreen.kPlaying:
        {
            if (gButtons.menu.contains(x, y))
                openMenu();
            else
            {
                const cell = cellAt(x, y);

                if (cell === null)
                    return false;

                onBoardClick(cell.r, cell.c);
            }
        }
        break;

        case GameScreen.kMenu:
        {
            if (gButtons.quit.contains(x, y) === false)
                return false;

            quitApp();
        }
        break;

        case GameScreen.kGameOver: gScreen = GameScreen.kTitle; break;
    }

    return true;
}

function onKeyDown(code)
{
    switch (code)
    {
        case KeyCode.kEscape:
        {
            if (gScreen === GameScreen.kMenu)
                closeMenu();
            else
                openMenu();
        }
        return true;

        case KeyCode.kEnter:
        case KeyCode.kNumpadEnter:
        case KeyCode.kSpace:
        {
            if (gScreen === GameScreen.kTitle)
                startGame();
            else if (gScreen === GameScreen.kGameOver)
                gScreen = GameScreen.kTitle;
            else
                return false;
        }
        return true;

        default: return false;
    }
}

function openMenu()
{
    gScreenBeforeMenu = gScreen;
    gScreen = GameScreen.kMenu;
}

function closeMenu()
{
    gScreen = gScreenBeforeMenu;
}

function quitApp()
{
    gScreen = GameScreen.kQuit;
    AudioManager.stopAll();

    // Browsers only let a script close a window that a script opened.
    // If the close is blocked, the "Thanks for playing" screen stays up.
    window.close();
}

// *** Game Flow ***

function makeStartBoard()
{
    let board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(EMPTY));

    for (let r = 0; r < BOARD_SIZE; r++)
    {
        for (let c = 0; c < BOARD_SIZE; c++)
        {
            if ((r + c) % 2 === 0)
                continue; // Pieces only sit on dark squares

            if (r < 3)
                board[r][c] = BLACK;
            else if (r > 4)
                board[r][c] = RED;
        }
    }

    return board;
}

function resetGame()
{
    gBoard = makeStartBoard();
    gTurn = HUMAN;
    gSelected = null;
    gChainPiece = null;
    gLastMove = [];
    gWinner = EMPTY;
    gBotTimer = 0.0;
    gBotPlan = null;
    gGameTime = 0.0;
    gMoving = null;
    gSlidePlayer?.stop();
    gLiftPlayer?.stop();
    gSparks?.clear();
    updateStatusText();
    updateTimeText();
}

function startGame()
{
    resetGame();
    gScreen = GameScreen.kPlaying;
}

function onBoardClick(r, c)
{
    if (gTurn !== HUMAN || gMoving !== null)
        return; // Not the human's turn, or a piece is still moving

    // Move the selected piece
    if (gSelected !== null)
    {
        const targets = getLegalTargets(gBoard, gSelected.r, gSelected.c, HUMAN);

        if (targets.some((t) => t.r === r && t.c === c))
        {
            performHumanStep(gSelected.r, gSelected.c, r, c);
                return;
        }
    }

    if (gChainPiece !== null)
        return; // Must keep jumping with the same piece

    // Select a piece that can move
    if (getLegalTargets(gBoard, r, c, HUMAN).length > 0)
        gSelected = { r, c };
    else
        gSelected = null;
}

function performHumanStep(fr, fc, tr, tc)
{
    if (gChainPiece === null)
        gLastMove = [{ r: fr, c: fc }];

    gLastMove.push({ r: tr, c: tc });
    gSelected = null;

    playSFX(SFX_CLICK); // Picked up; a capture also plays its landing sound when it lands
    startMove(fr, fc, tr, tc, (result) => onHumanLanded(tr, tc, result));
}

function onHumanLanded(r, c, result)
{
    if (result.captured)
        landJump(r, c);

    if (result.captured && !result.promoted && getJumps(gBoard, r, c).length > 0)
    {
        gChainPiece = { r, c };
        gSelected = { r, c };
        updateStatusText();
            return;
    }

    endTurn();
}

/*
    Makes a hop on the board right away, and animates the piece there: it slides
    over MOVE_TIME while lifting and putting down. onLanded(result) gets
    applyStep()'s result when it lands (see landMove()).
*/
function startMove(fr, fc, tr, tc, onLanded)
{
    const piece = gBoard[fr][fc];
    let captured = null;

    if (Math.abs(tr - fr) === 2)
    {
        const mr = (fr + tr) / 2;
        const mc = (fc + tc) / 2;
        captured = { r: mr, c: mc, piece: gBoard[mr][mc] };
    }

    const result = applyStep(gBoard, fr, fc, tr, tc);
    const rect = gRects.moving[piece]; // The piece as it was, so a man crowned here shows its crown on landing

    gMoveSlide.setTranslationStart(pieceX(fc), pieceY(fr));
    gMoveSlide.setTranslation(pieceX(tc), pieceY(tr), MOVE_TIME, Easing.kQuadraticInOut);

    gMoving = { piece, rect, to: { r: tr, c: tc }, captured, result, onLanded };

    gLiftPlayer.play(rect, gMoveLift, AnimPlayMode.kOnce);
    gSlidePlayer.play(rect, gMoveSlide, AnimPlayMode.kOnce);
}

// The slide finished (gSlidePlayer's callback): the piece is on its square, so the turn carries on
function landMove()
{
    const move = gMoving;

    if (move === null)
        return;

    gMoving = null;
    move.onLanded(move.result);
}

function endTurn()
{
    gSelected = null;
    gChainPiece = null;
    gTurn = opponentOf(gTurn);

    if (getAllTurns(gBoard, gTurn).length === 0)
    {
        gWinner = opponentOf(gTurn);
        gScreen = GameScreen.kGameOver;
        updateGameOverText();
    }
    else if (gTurn === BOT)
    {
        gBotTimer = BOT_THINK_DELAY;
        gBotPlan = null;
    }

    updateStatusText();
}

// A piece landed on (r, c) after capturing
function landJump(r, c)
{
    emitJumpSparks(r, c);
    playSFX(SFX_JUMP_LAND);
}

// Plays a loaded sound if it can; sound is optional, so a missing or not-yet-allowed one is skipped quietly
function playSFX(name)
{
    if (AudioManager.isLoaded(name))
        AudioManager.play(name);
}

function updateBot(dt)
{
    // A landing earlier this frame can end the game (see landMove()), so check the screen here too
    if (gScreen !== GameScreen.kPlaying || gTurn !== BOT || gMoving !== null)
        return; // Game over, not the bot's turn, or waiting for a hop to land (see onBotLanded())

    gBotTimer -= dt;

    if (gBotTimer > 0.0)
        return;

    // Pick a move, then show the chosen piece selected for a moment
    if (gBotPlan === null)
    {
        gBotPlan = chooseBotTurn(gBoard) ?? null;

        if (gBotPlan === null)
        {
            console.error("updateBot(): the bot has no move, but the game isn't over");
                return;
        }

        gLastMove = [gBotPlan[0]];
        gSelected = gBotPlan[0];
        gBotTimer = BOT_STEP_DELAY;
            return;
    }

    // Make one hop of the move; the rest happens when it lands
    const from = gBotPlan[0];
    const to = gBotPlan[1];

    gLastMove.push(to);
    gBotPlan.shift();
    gSelected = null;

    startMove(from.r, from.c, to.r, to.c, (result) => onBotLanded(to, result));
}

function onBotLanded(to, result)
{
    if (result.captured)
        landJump(to.r, to.c);

    if (gBotPlan.length > 1)
    {
        gSelected = gBotPlan[0];
        gBotTimer = BOT_STEP_DELAY;
    }
    else
    {
        gBotPlan = null;
        endTurn();
    }
}

// *** Rules ***

function ownerOf(p)
{
    if (p === EMPTY)
        return EMPTY;

    return (p === RED || p === RED_KING) ? RED : BLACK;
}

function isKing(p) { return (p === RED_KING || p === BLACK_KING); }
function opponentOf(player) { return (player === RED) ? BLACK : RED; }
function inBounds(r, c) { return (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE); }
function cloneBoard(board) { return board.map((row) => row.slice()); }

function moveDirections(p)
{
    if (isKing(p))
        return [[-1, -1], [-1, 1], [1, -1], [1, 1]];

    return (ownerOf(p) === RED) ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]];
}

// Capturing hops available to the piece at (r, c)
function getJumps(board, r, c)
{
    const p = board[r][c];
    const enemy = opponentOf(ownerOf(p));
    let result = [];

    if (p === EMPTY)
        return result;

    for (const [dr, dc] of moveDirections(p))
    {
        const tr = r + (dr * 2);
        const tc = c + (dc * 2);

        if (inBounds(tr, tc) && board[tr][tc] === EMPTY && ownerOf(board[r + dr][c + dc]) === enemy)
            result.push({ r: tr, c: tc });
    }

    return result;
}

// Non-capturing moves available to the piece at (r, c)
function getSteps(board, r, c)
{
    const p = board[r][c];
    let result = [];

    if (p === EMPTY)
        return result;

    for (const [dr, dc] of moveDirections(p))
    {
        const tr = r + dr;
        const tc = c + dc;

        if (inBounds(tr, tc) && board[tr][tc] === EMPTY)
            result.push({ r: tr, c: tc });
    }

    return result;
}

function playerHasJump(board, player)
{
    for (let r = 0; r < BOARD_SIZE; r++)
    {
        for (let c = 0; c < BOARD_SIZE; c++)
        {
            if (ownerOf(board[r][c]) === player && getJumps(board, r, c).length > 0)
                return true;
        }
    }

    return false;
}

// Where the piece at (r, c) may go this hop, enforcing mandatory captures
function getLegalTargets(board, r, c, player)
{
    if (ownerOf(board[r][c]) !== player)
        return [];

    if (playerHasJump(board, player))
        return getJumps(board, r, c);

    return getSteps(board, r, c);
}

// Moves one hop; returns whether it captured and whether it crowned a king
function applyStep(board, fr, fc, tr, tc)
{
    let p = board[fr][fc];
    let captured = false;
    let promoted = false;

    if (Math.abs(tr - fr) === 2)
    {
        board[(fr + tr) / 2][(fc + tc) / 2] = EMPTY;
        captured = true;
    }

    if (p === RED && tr === 0)
    {
        p = RED_KING;
        promoted = true;
    }
    else if (p === BLACK && tr === BOARD_SIZE - 1)
    {
        p = BLACK_KING;
        promoted = true;
    }

    board[fr][fc] = EMPTY;
    board[tr][tc] = p;
    return { captured, promoted };
}

// Every complete turn for a player, each as the list of squares it visits
function getAllTurns(board, player)
{
    let turns = [];
    const mustJump = playerHasJump(board, player);

    for (let r = 0; r < BOARD_SIZE; r++)
    {
        for (let c = 0; c < BOARD_SIZE; c++)
        {
            if (ownerOf(board[r][c]) !== player)
                continue;

            if (mustJump)
                collectJumpChains(board, r, c, [{ r, c }], turns);
            else
            {
                for (const s of getSteps(board, r, c))
                    turns.push([{ r, c }, s]);
            }
        }
    }

    return turns;
}

function collectJumpChains(board, r, c, path, turns)
{
    for (const j of getJumps(board, r, c))
    {
        let b = cloneBoard(board);
        const result = applyStep(b, r, c, j.r, j.c);
        const newPath = path.concat([j]);

        if (!result.promoted && getJumps(b, j.r, j.c).length > 0)
            collectJumpChains(b, j.r, j.c, newPath, turns);
        else
            turns.push(newPath);
    }
}

function applyTurn(board, path)
{
    for (let i = 0; i < path.length - 1; i++)
        applyStep(board, path[i].r, path[i].c, path[i + 1].r, path[i + 1].c);
}

// *** Bot ***

// Positive scores favor the bot
function evaluateBoard(board)
{
    let score = 0;

    for (let r = 0; r < BOARD_SIZE; r++)
    {
        for (let c = 0; c < BOARD_SIZE; c++)
        {
            const p = board[r][c];

            if (p === EMPTY)
                continue;

            let value = isKing(p) ? 160 : 100;

            if (!isKing(p))
                value += (ownerOf(p) === BLACK) ? r * 4 : (BOARD_SIZE - 1 - r) * 4; // Reward advancing

            score += (ownerOf(p) === BOT) ? value : -value;
        }
    }

    return score;
}

function minimax(board, depth, alpha, beta, player)
{
    const turns = getAllTurns(board, player);

    // No moves means that player loses; prefer quicker wins and slower losses
    if (turns.length === 0)
        return (player === BOT) ? -100000 - depth : 100000 + depth;

    if (depth === 0)
        return evaluateBoard(board);

    if (player === BOT)
    {
        let best = -Infinity;

        for (const t of turns)
        {
            let b = cloneBoard(board);
            applyTurn(b, t);
            best = Math.max(best, minimax(b, depth - 1, alpha, beta, HUMAN));
            alpha = Math.max(alpha, best);

            if (alpha >= beta)
                break;
        }

        return best;
    }
    else
    {
        let best = Infinity;

        for (const t of turns)
        {
            let b = cloneBoard(board);
            applyTurn(b, t);
            best = Math.min(best, minimax(b, depth - 1, alpha, beta, BOT));
            beta = Math.min(beta, best);

            if (alpha >= beta)
                break;
        }

        return best;
    }
}

function chooseBotTurn(board)
{
    let turns = getAllTurns(board, BOT);

    // Shuffle so equally good moves aren't always played the same way
    for (let i = turns.length - 1; i > 0; i--)
    {
        const j = Math.floor(Math.random() * (i + 1));
        [turns[i], turns[j]] = [turns[j], turns[i]];
    }

    let best = turns[0];
    let bestScore = -Infinity;

    for (const t of turns)
    {
        let b = cloneBoard(board);
        applyTurn(b, t);
        const score = minimax(b, BOT_SEARCH_DEPTH - 1, -Infinity, Infinity, HUMAN);

        if (score > bestScore)
        {
            bestScore = score;
            best = t;
        }
    }

    return best;
}
