/*
 *  index.js  --  chess frontend
 *	Game State
 *	The game's shared state, one object every gameplay file reads & changes (game.tiles, game.moveObj, ...),
 *	plus the canvas & the two chess.js boards. renderCanvas (gameplay/index.js) fills in the game's settings
 *	(GAME_ID, GAME_URL, ...) when a game opens, everything else starts at the values below
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */
const { Chess } = require("chess.js"); // RULES, LEGAL MOVES & FEN (SAME VERSION AS THE SERVER)
const { setTiles, countStartPieces } = require("../utils/index.js"); // NEW ARRAY OF 64 BLANK TILE STATES, HOW MANY PIECES EACH SIDE STARTED WITH

export const canvas = document.createElement("canvas"); // THE WHOLE GAME IS DRAWN ON THIS
export const ctx = canvas.getContext("2d"); // EVERYTHING IS DRAWN WITH THIS
export const chessInst = new Chess(); // THE BOARD THAT'S DRAWN, LOADED FROM THE SERVER'S FEN
export const validateState = new Chess(); // SCRATCH BOARD, TESTS A MOVE WITHOUT CHANGING chessInst
export const OVERRIDE_TV = false; // TRUE TURNS ON THE TV REMOTE (ARROW KEYS & ENTER) & THE MOUSE TOGETHER, FOR TESTING

/* ---------------------------------------------------------------- */
// Frames
/* ---------------------------------------------------------------- */
let drawFrame = null; // THE RENDER LOOP, null UNTIL THE GAME STARTS & AFTER IT'S LEFT
let frameRequest = null; // THE FRAME ALREADY ASKED FOR, SO THERE'S ONLY EVER ONE

/**
 * @description Asks the browser for one frame, when it's ready to show it (not at all while the tab is hidden: the frame
 * comes when the tab is shown again). Nothing is asked for when nothing changed, so an idle board does no work
 */
export function requestFrame() {
	if (frameRequest !== null || !drawFrame) { return; }
	frameRequest = requestAnimationFrame(function () {
		frameRequest = null;
		if (drawFrame) { drawFrame(); }
	});
}

/**
 * @description Starts the render loop, it's called for each frame requestFrame() asks for
 * @param  {[function]} renderLoop [draws one frame]
 */
export function startFrames(renderLoop) {
	drawFrame = renderLoop;
	requestFrame();
}

/**
 * @description Stops the render loop, leaving the game
 */
export function stopFrames() {
	drawFrame = null;
	if (frameRequest !== null) { cancelAnimationFrame(frameRequest); frameRequest = null; }
}

let refresh = true; // game.refresh
let currSlide = false; // game.currSlide
let restartSlide = null; // game.restartSlide

/* ---------------------------------------------------------------- */
// Game
/* ---------------------------------------------------------------- */
/**
 * @description Everything more than one part of the game uses. A value that's only used in one place stays a let there
 */
export const game = {
	// GAME & SERVER
	GAME_ID: undefined, // CHANGES WHEN AN AI GAME RESTARTS OR A FRIEND GAME REMATCHES
	GAME_URL: undefined, // CHESS API, "/api/chess" (SET BY renderCanvas)
	PLAYER_ID: undefined, // THIS PLAYER (A GUEST'S PLAYER ID IS THEIR GAME ID)
	TV_BOOL: undefined, // TV REMOTE CONTROLS INSTEAD OF THE MOUSE
	SIGNED_IN: undefined, // A SIGNED IN PLAYER (NOT A GUEST): RESTART CHANGES THE URL, EXIT LOGS OUT
	moveAudio: undefined, // MOVE SOUND (MADE IN renderCanvas)
	response: undefined, // LATEST GAME FROM THE SERVER { game_board, w_knight, b_knight, w_piece, b_piece, player_color, state, ... }
	revert: undefined, // GAME TO GO BACK TO IF A MOVE FAILS
	playerColor: undefined, // 'w' OR 'b', BLACK FLIPS THE BOARD SO THE PLAYER IS ALWAYS AT THE BOTTOM
	opponentColor: undefined, // 'w' OR 'b'
	ai: undefined, // TRUE IN AI GAMES
	aiTurn: false, // TRUE WHEN THE RENDER LOOP SHOULD ASK THE SERVER FOR THE AI'S MOVE
	moveObj: [null, null], // MOVE BEING PLAYED { from, to, promotion }, THE AI'S ALSO HAS response
	tiles: setTiles(), // 64 TILE STATES IN SCREEN ORDER (ROW * 8 + COLUMN), FILLED WITH THE PIECE ON EACH SQUARE WHILE DRAWING
	startPieceCount: countStartPieces(), // { w, b } PIECES EACH SIDE STARTED WITH (THE STANDARD SET, OR A SET POSITION'S, setInitialData())
	gameOver: false, // THE SERVER CLOSED THE GAME (CHECKMATE, DRAW OR FORFEIT)
	boardReset: false, // TRUE WHILE A NEW BOARD LOADS & ITS PIECES SLIDE HOME (RESTART & REMATCH), STOPS THE NORMAL FRAMES (THE OLD BOARD STAYS ON SCREEN)
	get restartSlide() { return restartSlide; }, // PIECES SLIDING HOME AFTER RESTART & REMATCH: { pieces, startTime } (startRestartSlide)
	set restartSlide(value) { restartSlide = value; if (value) { requestFrame(); } },
	drawScreen: undefined, // DRAWS ONE FRAME, SET BY handleInitialData() FOR THE PLAYER'S COLOR
	get refresh() { return refresh; }, // TRUE DRAWS A FRAME: SETTING IT ASKS THE BROWSER FOR ONE
	set refresh(value) { refresh = value; if (value) { requestFrame(); } },

	// BOARD SIZE (SET BY renderBoard() EVERY FRAME)
	cw: undefined, // CANVAS WIDTH (CSS PIXELS)
	ch: undefined, // CANVAS HEIGHT (CSS PIXELS)
	tileWidth: undefined, // WIDTH OF ONE SQUARE
	tileHeight: undefined, // HEIGHT OF ONE SQUARE
	xBoardOff: undefined, // LEFT OF THE SQUARES (SCREEN COLUMN 0)
	yBoardOff: undefined, // TOP OF THE SQUARES (SCREEN ROW 0)
	xPieceOffset: undefined, // Width of the tile proportionality to the board width (PIECE IMAGES ARE THIS MUCH WIDER THAN A SQUARE, THEY OVERHANG IT)
	yPieceOffset: undefined, // Height of the tile proportionality to the board height (PIECES ARE TALLER THAN A SQUARE)
	widthGreater: undefined, // WIDE SCREEN: TAKEN PIECES GO TO THE RIGHT OF THE BOARD
	portraitBoard: false, // TALL SCREEN (MOBILE)

	// INPUT & THE SELECTED PIECE
	tileX: undefined, // SCREEN COLUMN UNDER THE MOUSE (0 - 7 ON THE BOARD)
	tileY: undefined, // SCREEN ROW UNDER THE MOUSE (0 - 7 ON THE BOARD)
	clickedTile: false, // TILE PICKED UP BY A CLICK (OR A FINISHED DRAG)
	mousedownTile: false, // TILE BEING DRAGGED
	mouseDownTime: null, // WHEN THE FIRST FRAME OF A HELD PIECE WAS DRAWN, null UNTIL THEN (DRAG_HOLD_MS IN gameplay/draw)
	menuToggled: false, // MENU IS OPEN
	opposingMove: false, // TRUE WHILE IT'S NOT THE PLAYER'S TURN, LOCKS THE BOARD
	currPromotion: false, // TRUE WHILE THE PLAYER PICKS THEIR PROMOTION PIECE
	availableMovesData: { piece: null, square: null }, // PIECE & SQUARE availableMoves IS FOR, SO THE MOVES ARE ONLY FOUND ONCE

	// SLIDES
	get currSlide() { return currSlide; }, // TRUE WHILE A PIECE SLIDES TO ITS NEW SQUARE, THE RENDER LOOP KEEPS ASKING FOR FRAMES
	set currSlide(value) { currSlide = value; if (value) { requestFrame(); } },
	slideStart: false, // FIRST FRAME OF A SLIDE, A KNIGHT STOPS FOR 100MS BEFORE ITS HOP
	knightHop: 0, // HOW HIGH A HOPPING KNIGHT IS: 0 ON THE BOARD, 1 AT THE TOP (HALF A SQUARE UP), SET BY handleKnightHop()

	// TAKEN PIECES
	wPieceCount: { king: 0, queen: 0, bishop: 0, knight: 0, rook: 0, pawn: 0 }, // WHITE PIECES DRAWN THIS FRAME, TAKEN PIECES = START COUNT - THIS
	bPieceCount: { king: 0, queen: 0, bishop: 0, knight: 0, rook: 0, pawn: 0 }, // BLACK PIECES DRAWN THIS FRAME
	wTakenPieces: undefined, // WHITE PIECES THAT WERE TAKEN [{ color, type, x, y }]
	bTakenPieces: undefined, // BLACK PIECES THAT WERE TAKEN

	// WHITE PIECE IMAGES BEING DRAWN (IMAGE NUMBERS, gameplay/sprites/index.js), SET BEFORE EACH DRAW BY THE handle...Direction FUNCTIONS
	wKingImg: undefined, // KING IMAGE BEING DRAWN, SET TO THE FRONT OR BACK ONE BEFORE EACH DRAW (handlePieceDirectionW)
	wQueenImg: undefined, // SET WITH wKingImg
	wBishopBlackSqImg: undefined, // SET WITH wKingImg
	wBishopWhiteSqImg: undefined, // SET WITH wKingImg
	wKnightImg: undefined, // KNIGHT IMAGE BEING DRAWN, SET TO THE RIGHT OR LEFT ONE BEFORE EACH DRAW (BOTH WHITE KNIGHTS SHARE IT)
	wRookImg: undefined, // SET WITH wKingImg
	wPawnImg: undefined, // PAWN IMAGE BEING DRAWN, SET TO THE FRONT OR BACK ONE BEFORE EACH DRAW (handlePawnDirection)
	wKingShdw: undefined, // SET WITH wKingImg
	wQueenShdw: undefined, // SET WITH wKingImg
	wBishopShdw: undefined, // SET WITH wKingImg
	wKnightShdw: undefined, // SET WITH wKnightImg
	wRookShdw: undefined, // SET WITH wKingImg
	wPawnShdw: undefined, // SET WITH wPawnImg
	wKingRefl: undefined, // SET WITH wKingImg
	wQueenRefl: undefined, // SET WITH wKingImg
	wBishopRefl: undefined, // SET WITH wKingImg
	wKnightRefl: undefined, // SET WITH wKnightImg
	wRookRefl: undefined, // SET WITH wKingImg
	wPawnRefl: undefined, // SET WITH wPawnImg

	// BLACK PIECE IMAGES BEING DRAWN
	bKingImg: undefined, // KING IMAGE BEING DRAWN, SET TO THE FRONT OR BACK ONE BEFORE EACH DRAW (handlePieceDirectionB)
	bQueenImg: undefined, // SET WITH bKingImg
	bBishopBlackSqImg: undefined, // SET WITH bKingImg
	bBishopWhiteSqImg: undefined, // SET WITH bKingImg
	bKnightImg: undefined, // KNIGHT IMAGE BEING DRAWN, SET TO THE RIGHT OR LEFT ONE BEFORE EACH DRAW (BOTH BLACK KNIGHTS SHARE IT)
	bRookImg: undefined, // SET WITH bKingImg
	bPawnImg: undefined, // PAWN IMAGE BEING DRAWN, SET TO THE FRONT OR BACK ONE BEFORE EACH DRAW (handlePawnDirection)
	bKingShdw: undefined, // SET WITH bKingImg
	bQueenShdw: undefined, // SET WITH bKingImg
	bBishopShdw: undefined, // SET WITH bKingImg
	bKnightShdw: undefined, // SET WITH bKnightImg
	bRookShdw: undefined, // SET WITH bKingImg
	bPawnShdw: undefined, // SET WITH bPawnImg
	bKingRefl: undefined, // SET WITH bKingImg
	bQueenRefl: undefined, // SET WITH bKingImg
	bBishopRefl: undefined, // SET WITH bKingImg
	bKnightRefl: undefined, // SET WITH bKnightImg
	bRookRefl: undefined, // SET WITH bKingImg
	bPawnRefl: undefined, // SET WITH bPawnImg
}
