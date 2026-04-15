"use strict";

let gBoardRects = []; // 8x8 array of Rect2D for squares
let gPieceRects = []; // Rect2D instances for pieces
let gTextures = {};
let gSelectedSquare = null; // {x, y}

const BOARD_SIZE = 8;
const SQUARE_SIZE = 80; // Pixels
const PLAYER_1 = 1; // Red/Light
const PLAYER_2 = 2; // Black/Dark

// Game state: 0 = empty, 1 = Player 1, 2 = Player 2, 3 = P1 King, 4 = P2 King
let gGameState = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(0));
let gCurrentTurn = PLAYER_1;

window.onload = () => {
    if (WGL.init("wglCanvas") === false) return;
    WGL.resizeToWindow();
    appSetup();
};

function appSetup() {
    WGL.context.clearColor(0.1, 0.1, 0.1, 1.0);
    WGL.context.enable(WGL.context.BLEND);
    WGL.context.blendFunc(WGL.context.SRC_ALPHA, WGL.context.ONE_MINUS_SRC_ALPHA);

    // Load textures
    gTextures.piece = new Texture();
    gTextures.king = new Texture();
    gTextures.square = new Texture();

    let loadedCount = 0;
    const onTexLoad = () => {
        loadedCount++;
        if (loadedCount === 3) initGame();
    };

    gTextures.piece.load("./textures/checker_piece.png", onTexLoad);
    gTextures.king.load("./textures/checker_king.png", onTexLoad);
    gTextures.square.load("./textures/square.png", onTexLoad);

    WGL.context.canvas.addEventListener('mousedown', onMouseClick);
}

function initGame() {
    // Initialize board state
    for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
            if ((x + y) % 2 !== 0) {
                if (y < 3) gGameState[y][x] = PLAYER_2;
                else if (y > 4) gGameState[y][x] = PLAYER_1;
            }
            
            // Create board square Rect2D
            let rect = new Rect2D();
            rect.load(gTextures.square, SQUARE_SIZE, SQUARE_SIZE);
            rect.setPos(x * SQUARE_SIZE, y * SQUARE_SIZE);
            // Modulate colors for checkerboard pattern
            if ((x + y) % 2 === 0) rect.setColor(new Vector4(0.9, 0.8, 0.7, 1.0)); // Light
            else rect.setColor(new Vector4(0.3, 0.2, 0.1, 1.0)); // Dark
            gBoardRects.push(rect);
        }
    }
    
    requestAnimationFrame(appMain);
}

function onMouseClick(e) {
    const rect = WGL.context.canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = WGL.context.canvas.height - (e.clientY - rect.top); // Flip Y for GL space

    const gridX = Math.floor(mouseX / SQUARE_SIZE);
    const gridY = Math.floor(mouseY / SQUARE_SIZE);

    if (gridX < 0 || gridX >= BOARD_SIZE || gridY < 0 || gridY >= BOARD_SIZE) return;

    handleSquareSelection(gridX, gridY);
}

function handleSquareSelection(x, y) {
    const piece = gGameState[y][x];

    if (gSelectedSquare) {
        if (isValidMove(gSelectedSquare.x, gSelectedSquare.y, x, y)) {
            executeMove(gSelectedSquare.x, gSelectedSquare.y, x, y);
            gSelectedSquare = null;
            return;
        }
    }

    // Select a piece belonging to current player
    if (piece === gCurrentTurn || piece === gCurrentTurn + 2) {
        gSelectedSquare = { x, y };
    } else {
        gSelectedSquare = null;
    }
}

function isValidMove(fromX, fromY, toX, toY) {
    if (gGameState[toY][toX] !== 0) return false;

    const piece = gGameState[fromY][fromY];
    const isKing = piece > 2;
    const dx = toX - fromX;
    const dy = toY - fromY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    if (absDx !== absDy) return false;

    // Direction check for normal pieces
    if (!isKing) {
        if (gCurrentTurn === PLAYER_1 && dy > 0) return false; // P1 moves up (decreasing Y)
        if (gCurrentTurn === PLAYER_2 && dy < 0) return false; // P2 moves down (increasing Y)
    }

    // Simple move
    if (absDx === 1) return true;

    // Jump capture
    if (absDx === 2) {
        const midX = fromX + dx / 2;
        const midY = fromY + dy / 2;
        const midPiece = gGameState[midY][midX];
        if (midPiece !== 0 && (midPiece % 2 !== gCurrentTurn % 2)) return true;
    }

    return false;
}

function executeMove(fromX, fromY, toX, toY) {
    let piece = gGameState[fromY][fromX];

    // Handle jump capture
    if (Math.abs(toX - fromX) === 2) {
        gGameState[fromY + (toY - fromY) / 2][fromX + (toX - fromX) / 2] = 0;
    }

    // Move piece
    gGameState[fromY][fromX] = 0;
    
    // Kinging logic
    if (gCurrentTurn === PLAYER_1 && toY === 0) piece = 3;
    if (gCurrentTurn === PLAYER_2 && toY === BOARD_SIZE - 1) piece = 4;

    gGameState[toY][toX] = piece;

    // Switch turn
    gCurrentTurn = gCurrentTurn === PLAYER_1 ? PLAYER_2 : PLAYER_1;
}

function appMain() {
    appRender();
    requestAnimationFrame(appMain);
}

function appRender() {
    WGL.context.clear(WGL.context.COLOR_BUFFER_BIT | WGL.context.DEPTH_BUFFER_BIT);

    // Render Board
    for (let i = 0; i < gBoardRects.length; i++) {
        // Highlight selected square
        if (gSelectedSquare) {
            const gridX = i % BOARD_SIZE;
            const gridY = Math.floor(i / BOARD_SIZE);
            if (gridX === gSelectedSquare.x && gridY === gSelectedSquare.y) {
                // We can't easily change color per frame if uniforms aren't updated, 
                // but Rect2D.setPos/setColor handles uniform updates.
                gBoardRects[i].setColor(new Vector4(1.0, 1.0, 0.0, 1.0));
            } else {
                // Reset color
                if ((gridX + gridY) % 2 === 0) gBoardRects[i].setColor(new Vector4(0.9, 0.8, 0.7, 1.0));
                else gBoardRects[i].setColor(new Vector4(0.3, 0.2, 0.1, 1.0));
            }
        }
        gBoardRects[i].render();
    }

    // Render Pieces dynamically based on state
    renderPieces();
}

function renderPieces() {
    // To keep it simple and performant, we'll use a reusable Rect2D
    // In a real game, you'd cache these, but Rect2D uniform updates are fast enough for 24 pieces.
    if (!renderPieces.p1Rect) {
        renderPieces.p1Rect = new Rect2D();
        renderPieces.p1Rect.load(gTextures.piece, SQUARE_SIZE * 0.8, SQUARE_SIZE * 0.8);
        renderPieces.p1Rect.setColor(new Vector4(1.0, 0.2, 0.2, 1.0));

        renderPieces.p2Rect = new Rect2D();
        renderPieces.p2Rect.load(gTextures.piece, SQUARE_SIZE * 0.8, SQUARE_SIZE * 0.8);
        renderPieces.p2Rect.setColor(new Vector4(0.1, 0.1, 0.1, 1.0));

        renderPieces.k1Rect = new Rect2D();
        renderPieces.k1Rect.load(gTextures.king, SQUARE_SIZE * 0.8, SQUARE_SIZE * 0.8);
        renderPieces.k1Rect.setColor(new Vector4(1.0, 0.2, 0.2, 1.0));

        renderPieces.k2Rect = new Rect2D();
        renderPieces.k2Rect.load(gTextures.king, SQUARE_SIZE * 0.8, SQUARE_SIZE * 0.8);
        renderPieces.k2Rect.setColor(new Vector4(0.1, 0.1, 0.1, 1.0));
    }

    const offset = SQUARE_SIZE * 0.1;

    for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
            const val = gGameState[y][x];
            if (val === 0) continue;

            let targetRect = null;
            switch (val) {
                case 1: targetRect = renderPieces.p1Rect; break;
                case 2: targetRect = renderPieces.p2Rect; break;
                case 3: targetRect = renderPieces.k1Rect; break;
                case 4: targetRect = renderPieces.k2Rect; break;
            }

            if (targetRect) {
                targetRect.setPos(x * SQUARE_SIZE + offset, y * SQUARE_SIZE + offset);
                targetRect.render();
            }
        }
    }
}