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
const BOT_STEP_DELAY = 0.35;    // Seconds between each hop of the bot's move

const FONT_FAMILY = "'Segoe UI', Arial, sans-serif";
const TITLE_FONT_URL = "./fonts/JimNightshade-Regular.ttf";

// The app's single manager instances, created in loadAssets() after WGL.init()
let gTextureManager = null;
let gFontManager = null;
let gMaterialManager = null;
let gBatcher = null; // Everything is drawn through it, once per frame

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
    kBars: new Vector4(0.0, 0.0, 0.0, 1.0)  // Fills the window outside the design area
};

// MaterialBatcher layers, back (0) to front (7). Things with different materials
// that must overlap a certain way (a button and its label) go on different layers.
const Layers = {
    kBoard: 0,        // Border, then squares (one material, so submission order holds)
    kHighlight: 1,
    kPieces: 2,       // Pieces and move hints (they never overlap)
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
let gMouse = new Vector2(-1, -1);

// Layout, in design units (WGL's fixed design resolution), so it's built once
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

// *** App ***

window.onload = () => {
    if (WGL.init("wglCanvas") === false)
    {
        console.error("WebGL2 couldn't be initialized");
            return;
    }

    WGL.setDesignResolution(1920, 1080);
    WGL.setBarColor(Colors.kBars);
    WGL.setClearColor(Colors.kBackground);
    WGL.resizeToWindow();
    appSetup();
};

// The layout is in design units, so a resize only refits the view (text re-rasterizes itself)
window.onresize = () => WGL.resizeToWindow();

function appSetup()
{
    WGL.context.disable(WGL.context.DEPTH_TEST);
    WGL.context.enable(WGL.context.BLEND);
    // Blend color normally but keep the canvas alpha at 1, so translucent overlays
    // darken the scene instead of letting the white page show through the canvas
    WGL.context.blendFuncSeparate(WGL.context.SRC_ALPHA, WGL.context.ONE_MINUS_SRC_ALPHA, WGL.context.ONE, WGL.context.ONE_MINUS_SRC_ALPHA);

    loadAssets().then(appOnAssetsLoaded);

    WGL.context.canvas.addEventListener("mousedown", onMouseDown);
    WGL.context.canvas.addEventListener("mousemove", onMouseMove);
    window.addEventListener("keydown", onKeyDown);
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
        ring: "./textures/circle.png"
    };

    const names = Object.keys(files);
    const [textures, titleFont] = await Promise.all([
        Promise.all(names.map((name) => gTextureManager.load(files[name]))),
        gFontManager.load(TITLE_FONT_URL)
    ]);

    names.forEach((name, i) => { gTextures[name] = textures[i]; });
    gTitleFont = titleFont;
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
    if (gScreen === GameScreen.kPlaying)
    {
        gGameTime += dt;
        updateTimeText();
        updateBot(dt);
    }
}

function appRender()
{
    WGL.beginFrame(); // Clears the view and the bars around it

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
    const w = WGL.getWidth();
    const h = WGL.getHeight();
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
        const hover = (isActive === true) && this.contains(gMouse.x, gMouse.y);
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

    if (gTurn === HUMAN && gScreen === GameScreen.kPlaying && gChainPiece === null)
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

    // Pieces
    const pieceOffset = (sq - Math.floor(sq * 0.86)) / 2;

    for (let r = 0; r < BOARD_SIZE; r++)
    {
        for (let c = 0; c < BOARD_SIZE; c++)
        {
            let rect = null;

            switch (gBoard[r][c])
            {
                case RED: rect = gRects.redMan; break;
                case BLACK: rect = gRects.blackMan; break;
                case RED_KING: rect = gRects.redKing; break;
                case BLACK_KING: rect = gRects.blackKing; break;
            }

            if (rect !== null)
            {
                rect.setPos(Math.round(squareX(c) + pieceOffset), Math.round(squareY(r) + pieceOffset));
                gBatcher.submit(rect, Layers.kPieces);
            }
        }
    }

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

function squareX(c) { return gLayout.boardX + (c * gLayout.sq); }
function squareY(r) { return gLayout.boardY + ((BOARD_SIZE - 1 - r) * gLayout.sq); }

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

// Design units, +Y up to match Rect2D
function toCanvasCoords(e)
{
    return WGL.clientToView(e.clientX, e.clientY);
}

function cellAt(x, y)
{
    const c = Math.floor((x - gLayout.boardX) / gLayout.sq);
    const r = BOARD_SIZE - 1 - Math.floor((y - gLayout.boardY) / gLayout.sq);

    if (inBounds(r, c) === false)
        return null;

    return { r, c };
}

function onMouseMove(e)
{
    const p = toCanvasCoords(e);
    gMouse.set(p.x, p.y);
}

function onMouseDown(e)
{
    if (gIsReady === false || e.button !== 0)
        return;

    const p = toCanvasCoords(e);
    gMouse.set(p.x, p.y);

    switch (gScreen)
    {
        case GameScreen.kTitle:
        {
            if (gButtons.start.contains(p.x, p.y))
                startGame();
        }
        break;

        case GameScreen.kPlaying:
        {
            if (gButtons.menu.contains(p.x, p.y))
                openMenu();
            else
            {
                const cell = cellAt(p.x, p.y);

                if (cell !== null)
                    onBoardClick(cell.r, cell.c);
            }
        }
        break;

        case GameScreen.kMenu:
        {
            if (gButtons.quit.contains(p.x, p.y))
                quitApp();
        }
        break;

        case GameScreen.kGameOver: gScreen = GameScreen.kTitle; break;
    }
}

function onKeyDown(e)
{
    if (gIsReady === false || gScreen === GameScreen.kQuit)
        return;

    if (e.key === "Escape")
    {
        if (gScreen === GameScreen.kMenu)
            closeMenu();
        else
            openMenu();
    }
    else if (e.key === "Enter" || e.key === " ")
    {
        if (gScreen === GameScreen.kTitle)
            startGame();
        else if (gScreen === GameScreen.kGameOver)
            gScreen = GameScreen.kTitle;
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
    if (gTurn !== HUMAN)
        return;

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

    const result = applyStep(gBoard, fr, fc, tr, tc);
    gLastMove.push({ r: tr, c: tc });

    if (result.captured && !result.promoted && getJumps(gBoard, tr, tc).length > 0)
    {
        gChainPiece = { r: tr, c: tc };
        gSelected = { r: tr, c: tc };
        updateStatusText();
            return;
    }

    endTurn();
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

function updateBot(dt)
{
    if (gTurn !== BOT)
        return;

    gBotTimer -= dt;

    if (gBotTimer > 0.0)
        return;

    // Pick a move, then show the chosen piece selected for a moment
    if (gBotPlan === null)
    {
        gBotPlan = chooseBotTurn(gBoard);
        gLastMove = [gBotPlan[0]];
        gSelected = gBotPlan[0];
        gBotTimer = BOT_STEP_DELAY;
            return;
    }

    // Make one hop of the move
    const from = gBotPlan[0];
    const to = gBotPlan[1];
    applyStep(gBoard, from.r, from.c, to.r, to.c);
    gLastMove.push(to);
    gBotPlan.shift();

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
