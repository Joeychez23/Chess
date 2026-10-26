/*
 *  boardPicture.js  --  chess frontend
 *	Board Picture
 *	A still picture of a game's board for Home & guest (Continue current game). It's drawn the way the play page draws a
 *	board at rest (renderBoard in gameplay/layout & renderPiecesToBoard in gameplay/draw): the same squares, sprites & the way each piece faces,
 *	so the picture matches the game when it opens. Taken pieces, highlights & props are left out
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const { Chess } = require("chess.js");
const { SPRITES } = require("../../gameplay/sprites/index.js"); // IMAGE URLS BY IMAGE NUMBER, THE PAGE'S preloadImages() ALREADY ASKED FOR THEM

const WIDTH = 880; // CANVAS SIZE (PIXELS), CSS SCALES IT TO THE BOX
const HEIGHT = 720;
const BOARD_SCALE = 0.92; // BOARD WIDTH / CANVAS WIDTH, LEAVES ROOM FOR THE TOP ROW'S PIECES (THEY STAND A LITTLE ABOVE THE BOARD)
const xBoardShadowRatio = 0.985; // SAME AS gameplay/layout/index.js, NUDGES THE SQUARES RIGHT TO LINE UP WITH THE BOARD IMAGE

// IMAGE NUMBERS (THE INDEX IN SPRITES, SAME AS THE GAME, gameplay/sprites/index.js)
const tableImg = 0; // table.webp
const tableShdw = 1; // table-shdw.png
const boardImg = 2; // chess-board.png
const boardShdw = 3; // chess-board-shdw.webp
const rawBoardImg = 4; // raw-board.png, ITS SIZE GIVES THE WOOD BORDER'S WIDTH

// [REFLECTION, SHADOW, PIECE] FOR EACH WAY A PIECE CAN FACE, THE ORDER THEY'RE DRAWN IN
const WHITE = {
	kingFront: [20, 13, 5], kingBack: [66, 62, 58],
	queenFront: [21, 14, 6], queenBack: [67, 63, 59],
	bishopDarkSq: [22, 15, 7], bishopLightSq: [22, 15, 8], bishopBack: [68, 64, 60], // FRONT BISHOPS GO BY SQUARE COLOR (wb-c1 DARK, wb-f1 LIGHT)
	knightRight: [23, 16, 9], knightLeft: [24, 17, 10],
	rookFront: [25, 18, 11], rookBack: [69, 65, 61],
	pawnFront: [26, 19, 12], pawnBack: [84, 83, 82],
};
const BLACK = {
	kingFront: [42, 35, 27], kingBack: [78, 74, 70],
	queenFront: [43, 36, 28], queenBack: [79, 75, 71],
	bishopDarkSq: [44, 37, 29], bishopLightSq: [44, 37, 30], bishopBack: [80, 76, 72], // bb-f8 DARK, bb-c8 LIGHT
	knightRight: [45, 38, 31], knightLeft: [46, 39, 32],
	rookFront: [47, 40, 33], rookBack: [81, 77, 73],
	pawnFront: [48, 41, 34], pawnBack: [87, 86, 85],
};
const PIECE_NAMES = { k: "king", q: "queen", b: "bishop", r: "rook" };

const loaded = {}; // IMAGE NUMBER -> PROMISE OF ITS IMAGE, EACH ONE LOADS ONCE

/* ---------------------------------------------------------------- */
// Draw Board Picture
/* ---------------------------------------------------------------- */
/**
 * @description Draws a game's board onto canvas, from the player's side (black at the bottom when they play black):
 * the table, the board & its shadow, then each piece's reflection, shadow & image row by row from the top
 * @param  {[object]} canvas [canvas element, its size is set here]
 * @param  {[object]} game [GET /api/chess/game/:gameId response: { game_board, player_color, w_knight, b_knight, w_piece, b_piece }]
 * @return {[object]} Promise [resolves once it's drawn, rejects if an image doesn't load]
 */
export async function drawBoardPicture(canvas, game) {
	const playerColor = game.player_color == "b" ? "b" : "w";
	const chessInst = new Chess(game.game_board);
	let rows = chessInst.board(); // ROW 0 IS RANK 8, COLUMN 0 IS THE a FILE
	if (playerColor == "b") { rows = rows.reverse().map((row) => row.reverse()); } // FLIPPED LIKE THE GAME: ROW 0 IS RANK 1, COLUMN 0 IS THE h FILE
	const lists = { // WHICH WAY THE PIECES FACE, SAVED BY THE SERVER WITH EACH MOVE
		w: { piece: JSON.parse(game.w_piece || "[]"), knight: JSON.parse(game.w_knight || "[]") },
		b: { piece: JSON.parse(game.b_piece || "[]"), knight: JSON.parse(game.b_knight || "[]") },
	};

	let pieces = []; // { x, y, images } IN DRAW ORDER
	for (let i = 0; i < rows.length; i++) {
		for (let j = 0; j < rows[i].length; j++) {
			if (rows[i][j]) { pieces.push({ x: j, y: i, images: pieceImages(rows[i][j], chessInst, lists, playerColor) }); }
		}
	}

	const imageNumbers = [tableImg, tableShdw, boardImg, boardShdw, rawBoardImg];
	for (let i = 0; i < pieces.length; i++) { imageNumbers.push(...pieces[i].images); }
	const images = {};
	await Promise.all([...new Set(imageNumbers)].map(async function (n) { images[n] = await loadSprite(n); }));

	canvas.width = WIDTH;
	canvas.height = HEIGHT;
	const ctx = canvas.getContext("2d");

	// TABLE (COVERS THE CANVAS LIKE THE GAME'S CSS BACKGROUND)
	const tableScale = Math.max(WIDTH / images[tableImg].naturalWidth, HEIGHT / images[tableImg].naturalHeight);
	const tableWidth = images[tableImg].naturalWidth * tableScale;
	const tableHeight = images[tableImg].naturalHeight * tableScale;
	ctx.drawImage(images[tableImg], (WIDTH - tableWidth) / 2, (HEIGHT - tableHeight) / 2, tableWidth, tableHeight);
	ctx.drawImage(images[tableShdw], 0, 0, WIDTH, HEIGHT);

	// BOARD (SAME MATH AS renderBoard)
	const boardWidth = WIDTH * BOARD_SCALE;
	const boardHeight = (9 * boardWidth) / 11; // THE BOARD IMAGE IS DRAWN 11:9 (WIDE)
	const xBoardStart = (WIDTH - boardWidth) / 2;
	const yBoardStart = (HEIGHT - boardHeight) / 2;
	ctx.drawImage(images[boardShdw], xBoardStart, yBoardStart, boardWidth, boardHeight);
	ctx.drawImage(images[boardImg], xBoardStart, yBoardStart, boardWidth, boardHeight);

	const bw = boardWidth * images[rawBoardImg].naturalWidth / images[boardImg].naturalWidth; // THE 64 SQUARES WITHOUT THE WOOD BORDER
	const bh = boardHeight * images[rawBoardImg].naturalHeight / images[boardImg].naturalHeight;
	const xBoardOff = (WIDTH - (bw * xBoardShadowRatio)) / 2; // LEFT OF SCREEN COLUMN 0
	const yBoardOff = (HEIGHT - bh) / 2; // TOP OF SCREEN ROW 0
	const tileWidth = bw / 8;
	const tileHeight = bh / 8;
	const xPieceOffset = bw / 5.75; // PIECE IMAGES ARE A SQUARE PLUS THIS, CENTERED ON THE SQUARE
	const yPieceOffset = bh / 4.25;

	// PIECES (A RESTING PIECE IN renderPiecesToBoard: A TENTH OF A SQUARE UP, REFLECTION 30%, SHADOW 75%, THEN THE PIECE)
	for (let i = 0; i < pieces.length; i++) {
		const x = pieces[i].x * tileWidth + xBoardOff;
		const y = pieces[i].y * tileHeight - tileHeight / 10 + yBoardOff;
		for (let w = 0; w < pieces[i].images.length; w++) {
			if (w == 0) { ctx.globalAlpha = 0.30; }
			else if (w == 1) { ctx.globalAlpha = 0.75; }
			else { ctx.globalAlpha = 1; }
			ctx.drawImage(images[pieces[i].images[w]], x - xPieceOffset / 2, y - yPieceOffset / 2, tileWidth + xPieceOffset, tileHeight + yPieceOffset);
		}
	}

	ctx.globalAlpha = 0.05;
	ctx.drawImage(images[tableShdw], 0, 0, WIDTH, HEIGHT); // THE GAME ENDS EACH FRAME WITH THIS TOO
	ctx.globalAlpha = 1;
}

/* ---------------------------------------------------------------- */
// Piece Images
/* ---------------------------------------------------------------- */
/**
 * @description The images for one piece, facing the way the game would draw it:
 * kings, queens, bishops & rooks: their last move up or down the screen (handlePieceDirectionW / B), before that the other side.
 * Knights: the way their last move went across the screen (handleKnightDirectionW / B), before that toward the middle.
 * Pawns: always the other side (handlePawnDirection)
 * @param  {[object]} piece [chess.js board() square: { square, type, color }]
 * @param  {[object]} chessInst [chess.js game, for the square's color]
 * @param  {[object]} lists [{ w: { piece, knight }, b: { piece, knight } } parsed w_piece, w_knight, b_piece, b_knight]
 * @param  {[string]} playerColor ['w' | 'b', the side at the bottom]
 * @return {[array]} images [image numbers: reflection, shadow, piece]
 */
function pieceImages(piece, chessInst, lists, playerColor) {
	const set = piece.color == "w" ? WHITE : BLACK;
	if (piece.type == "p") { return piece.color == playerColor ? set.pawnBack : set.pawnFront; } // THE PLAYER'S PAWNS SHOW THEIR BACKS
	if (piece.type == "n") { return knightFacesRight(piece, lists[piece.color].knight, playerColor) ? set.knightRight : set.knightLeft; }

	const name = PIECE_NAMES[piece.type];
	if (facesAway(piece, lists[piece.color].piece, playerColor)) { return set[`${name}Back`]; }
	if (piece.type == "b") { return chessInst.squareColor(piece.square) == "dark" ? set.bishopDarkSq : set.bishopLightSq; }
	return set[`${name}Front`];
}

/**
 * @description True when a king, queen, bishop or rook shows its back. Its list entry ({ from, to } of its last move up or down,
 * from is null before it has one) says which way it went. Sideways or no move yet: the player's pieces face away, the opponent's face the player
 */
function facesAway(piece, pieceList, playerColor) {
	const lastMove = pieceList.find((entry) => entry.to == piece.square); // NOT FOUND = A PROMOTED PIECE, IT GETS THE DEFAULT
	if (lastMove?.from) {
		const yFrom = screenRow(lastMove.from, playerColor);
		const yTo = screenRow(lastMove.to, playerColor);
		if (yFrom > yTo) { return true; } // MOVED UP: FACES AWAY
		if (yFrom < yTo) { return false; } // MOVED DOWN: FACES THE PLAYER
	}
	return piece.color == playerColor;
}

/**
 * @description True when a knight faces right on the screen: the way its last move went, before it has moved toward the middle
 * of the board (b1 & b8 face right when playing white, flipped when playing black)
 */
function knightFacesRight(piece, knightList, playerColor) {
	const lastMove = knightList.find((entry) => entry.to == piece.square);
	if (lastMove?.from) {
		const xFrom = screenColumn(lastMove.from, playerColor);
		const xTo = screenColumn(lastMove.to, playerColor);
		if (xFrom < xTo) { return true; } // MOVED RIGHT
		if (xFrom > xTo) { return false; } // MOVED LEFT
	}
	return screenColumn(piece.square, playerColor) < 4;
}

function screenRow(square, playerColor) { return playerColor == "w" ? 8 - square[1] : square[1] - 1; } // RANK 8 IS THE TOP ROW FOR WHITE, RANK 1 FOR BLACK
function screenColumn(square, playerColor) { const file = square.charCodeAt(0) - 97; return playerColor == "w" ? file : 7 - file; } // a = 0, FLIPPED FOR BLACK

/* ---------------------------------------------------------------- */
// Load Sprite
/* ---------------------------------------------------------------- */
/**
 * @description Loads one of the game's images by its image number. preloadImages() already asked for the same url, so it comes from the browser cache
 * @param  {[number]} n [image number, the index in SPRITES]
 * @return {[object]} Promise [the loaded Image]
 */
function loadSprite(n) {
	if (!loaded[n]) {
		loaded[n] = new Promise(function (resolve, reject) {
			const img = new Image();
			img.onload = () => resolve(img);
			img.onerror = () => reject(new Error(`Couldn't load ${SPRITES[n]}`));
			img.src = SPRITES[n];
		});
	}
	return loaded[n];
}
