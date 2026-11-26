/*
 *  index.js  --  chess frontend
 *	Draw
 *	Draws each frame of the game (drawScreen, set by handleInitialData): the pieces row by row with their reflections & shadows,
 *	the selected piece's moves, a piece sliding or a knight hopping to its new square, and the promotion picker while promoting.
 *	draw.tile.js draws one square's moves & piece, draw.slide.js a sliding or hopping piece. See draw/facing.js for facing rules,
 *	draw/pieceSprites.js for sprite setters, and draw/taken.js for taken-piece trays.
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */
const { game, ctx, chessInst } = require("../state/index.js"); // The game's shared state, the canvas, the board that's drawn
const { images } = require("../images/index.js"); // The loaded images by image number
const { renderBoard } = require("../layout/index.js"); // Sizes the canvas & board to the window & draws the table & board
const { tableShdw, moveHighlight, checkHighlight } = require("../sprites/index.js"); // Image numbers, images[number].image is the image
const { stepSlide } = require("../animate/index.js"); // Where a sliding piece is from the time
// The two private files are required where this file used to require what they now use (animate/timing.js, moves/index.js),
// so the modules still load in the same order
const drawSlide = require("./draw.slide.js");
const { overlayShows } = require("./overlay.js"); // What the flat overlay draws on 2D & on 3D
const drawTile = require("./draw.tile.js");
const { rightFromFiles } = require("./facing.js"); // Shared piece & knight facing rules
const { setKnightSide } = require("./pieceSprites.js");
const { setTakenPieceArr, renderTakenPieces } = require("./taken.js");

const DRAG_HOLD_MS = 120; // Moving a held piece for longer than this makes it a drag

let clickX; // Pixel x of tileX, a held piece is drawn there
let clickY; // Pixel y of tileY
let availableMoves; // Legal moves of the selected piece (chess.js verbose moves), found once per piece
let currInst; // 8 x 8 board from chessInst.board(), flipped when viewing from black's side
const drawState = { // Shared with draw.tile.js & draw.slide.js, which change it
	lightObstruction: true, // True draws the reflections & shadows (renderPiecesToBoard sets it each frame)
	// True for the 100ms a knight stops before its hop (currSlide is off), so a frame drawn then still puts it on top
	knightPause: false,
	// Only the sliding piece's own square is kept (draw.slide.js layer), for a hopping or landed knight (draw.slide.js redrawInFront)
	overlapSlideObj: null,
};

/* ---------------------------------------------------------------- */
// Handle Initial Data Response
/* ---------------------------------------------------------------- */
/**
 * @description Sets drawScreen & gamedata based on player color. Each frame drawScreen() draws the table & board,
 * the pieces, the taken piece trays (the promotion picker while promoting), then a light table shadow over everything.
 * Black's side at the bottom (viewColor) flips the board (rows & columns reversed)
 */
export function handleInitialData() {
	if (game.viewColor == "w") { // Draw screen w
		currInst = chessInst.board(); // Row 0 is rank 8, column 0 is the a file
		game.drawScreen = async function () {
			const boardData = renderBoard();
			clickX = boardData.clickX;
			clickY = boardData.clickY;
			currInst = chessInst.board();
			drawState.overlapSlideObj = null
			renderPiecesToBoard(currInst, clickX, clickY, true);
			const overlay = overlayShows(game); // 2D: "all", 3D: only the flat promotion picker ("picker") or nothing ("none")
			if (overlay !== "all") { ctx.clearRect(0, 0, game.cw, game.ch); } // 3D: the board, taken pieces & score are in the 3D room
			if (overlay === "none") { return; }
			if (game.currPromotion) { // A pawn promotion of the player's is up
				if (game.playerColor == 'w') {
					game.bTakenPieces = setTakenPieceArr(game.playerColor);
					renderTakenPieces(game.bTakenPieces, game.opponentColor, currInst);
				} else if (game.playerColor == 'b') {
					game.wTakenPieces = setTakenPieceArr(game.playerColor);
					renderTakenPieces(game.wTakenPieces, game.opponentColor, currInst);
				}
			} else { // Taken pieces sit on the side of the player who took them
				game.wTakenPieces = setTakenPieceArr('w');
				game.bTakenPieces = setTakenPieceArr('b');
				renderTakenPieces(game.wTakenPieces, 'b', currInst);
				renderTakenPieces(game.bTakenPieces, 'w', currInst);
			}

			if (overlay !== "all") { return; } // No table shadow over the 3D board
			ctx.globalAlpha = 0.05
			ctx.drawImage(images[tableShdw].image, 0, 0, game.cw, game.ch); // Table shadow
			ctx.globalAlpha = 1;
		}
	} else if (game.viewColor == "b") { // Draw screen b
		currInst = chessInst.board().reverse(); // Row 0 is rank 1
		for (let i = currInst.length - 1; i >= 0; i--) { currInst[i] = currInst[i].reverse(); } // Column 0 is the h file
		game.drawScreen = async function () {
			const boardData = renderBoard();
			clickX = boardData.clickX;
			clickY = boardData.clickY;
			currInst = chessInst.board().reverse();
			for (let i = currInst.length - 1; i >= 0; i--) { currInst[i] = currInst[i].reverse(); }
			drawState.overlapSlideObj = null
			renderPiecesToBoard(currInst, clickX, clickY, true);
			const overlay = overlayShows(game); // 2D: "all", 3D: only the flat promotion picker ("picker") or nothing ("none")
			if (overlay !== "all") { ctx.clearRect(0, 0, game.cw, game.ch); } // 3D: the board, taken pieces & score are in the 3D room
			if (overlay === "none") { return; }
			if (game.currPromotion) { // A pawn promotion of the player's is up
				if (game.playerColor == 'w') {
					game.bTakenPieces = setTakenPieceArr(game.playerColor);
					renderTakenPieces(game.bTakenPieces, game.opponentColor, currInst);
				} else if (game.playerColor == 'b') {
					game.wTakenPieces = setTakenPieceArr(game.playerColor);
					renderTakenPieces(game.wTakenPieces, game.opponentColor, currInst);
				}
			} else { // Taken pieces sit on the side of the player who took them
				game.wTakenPieces = setTakenPieceArr('w');
				game.bTakenPieces = setTakenPieceArr('b');
				renderTakenPieces(game.wTakenPieces, 'b', currInst);
				renderTakenPieces(game.bTakenPieces, 'w', currInst);
			}

			if (overlay !== "all") { return; } // No table shadow over the 3D board
			ctx.globalAlpha = 0.05
			ctx.drawImage(images[tableShdw].image, 0, 0, game.cw, game.ch); // Table shadow
			ctx.globalAlpha = 1;
		}
	}
}

/* ---------------------------------------------------------------- */
// Renders Data Game Instance data
/* ---------------------------------------------------------------- */
/**
 * @param [inst] A object array which reperesents the current game board to be rendered
 * @description Renders game data based on input params. Goes through the board one square at a time (row by row,
 * index = row * 8 + column) & draws its piece: a held piece follows the mouse, a clicked piece sits lifted where it was
 * dropped, the rest sit on their square. Also draws the selected piece's legal moves & slides a moving piece toward its
 * new square. A sliding king, queen, bishop, rook or pawn is drawn once, in the turn of the first square after it (slideTurn),
 * & a hopping knight in the turn of the square it's over (hopTurn), not their start square's
 * @param  {[number]} clickX [pixel x of the square under the mouse, from renderBoard()]
 * @param  {[number]} clickY [pixel y of the square under the mouse]
 * @param  {[boolean]} lightObstruction [true draws the reflections & shadows]
 */
function renderPiecesToBoard(inst, clickX, clickY, lightObstruction) {
	let x, y; // Where this square's piece is drawn (pixels)
	let index = 0; // Tile being drawn, counts up with the loop
	drawState.lightObstruction = lightObstruction;

	stepSlides();
	const hopTurn = findHopTurn();
	const slideTurn = findSlideTurn();

	drawLastMove(); // Before the loop so it's under every piece, reflection & shadow
	drawHint();
	drawAnnotations();

	for (let i = 0; i < inst.length; i++) { // Row
		for (let j = 0; j < inst[i].length; j++, index++) { // Column
			game.tiles[index] = { ...inst[i][j], ...game.tiles[index], x: j, y: i }; // The board's piece, the tile's own state, its square
			const piece = inst[i][j];
			const tile = game.tiles[index];
			if (piece && tile.isMousedown) { // Held: follows the mouse
				handleDragHold(tile);
				tile.x = game.tileX;
				tile.y = game.tileY;
				x = clickX + game.xBoardOff;
				y = clickY - game.tileHeight / 5 + game.yBoardOff; // Lifted (a fifth of a square up)
			} else if (piece && tile.isClicked) {
				x = tile.x * game.tileWidth + game.xBoardOff;
				y = tile.y * game.tileHeight - game.tileHeight / 5 + game.yBoardOff; // Lifted
			} else if (piece) { // Where the board puts it, a tenth of a square up so its base is on the square
				x = tile.x * game.tileWidth + game.xBoardOff;
				y = tile.y * game.tileHeight - game.tileHeight / 10 + game.yBoardOff;
			}

			// The selected piece's moves, only on the player's turn
			if (!game.currPromotion && !game.opposingMove && (game.clickedTile || game.mousedownTile) && !game.currSlide) {
				availableMoves = selectedMoves(availableMoves);
				drawTile.availableMoves(i, j, index, availableMoves, drawState);
			}
			// The hopping knight is over this square: under this square's piece & the ones after it
			if (hopTurn && hopTurn.square == index) { drawHoppingKnight(hopTurn.index, x, y); }
			if (slideTurn && !slideTurn.drawn && isAfterSlide(i, j, slideTurn)) { drawSlidingPiece(slideTurn, x, y); }
			if (piece) { drawSquarePiece(piece, i, j, index, x, y, slideTurn, hopTurn); }
			if (index == 63 && slideTurn && !slideTurn.drawn) { drawSlidingPiece(slideTurn, x, y); } // No square after it: drawn last
		}
	}

	drawSlide.redrawInFront(drawState);
	if (!game.currSlide) { game.refresh = true; drawState.overlapSlideObj = null; } // Nothing sliding, clear the overlap
}

/**
 * @description Moves each sliding piece to where the time says it is, once a frame before anything is drawn
 */
function stepSlides() {
	for (let q = 0; q < game.tiles.length; q++) {
		if (game.tiles[q].isSliding) { stepSlide(game.tiles[q], q); }
	}
}

/**
 * @description A hopping knight is drawn in the turn of the square it's over, not its start square, so its reflection & shadow go
 * under the pieces in front of it & over the ones behind it, like a piece standing there (its image is drawn again on top at the end
 * of the frame, draw.slide.js redrawInFront). Only the row changes, never the column: switching columns mid-row (b2 to c2 on Nc3) put
 * b2's pawn under, over, then under the shadow, so it flashed.
 * !NOTE: IN ITS START SQUARE'S TURN IT PAINTED ITS SHADOW OVER THE PAWNS IT JUMPED (DRAWN BEFORE IT) UNTIL IT LANDED, SO THEY FLASHED
 * @return {[object]} { index: the knight's tile, square: tile of the square it's over (row * 8 + column) }, null when it's over its own
 */
function findHopTurn() {
	for (let q = 0; q < game.tiles.length; q++) {
		const tile = game.tiles[q];
		if (tile.isSliding && tile.type == 'n' && (tile.xDiff || tile.yDiff)) {
			// Its start square, as its own turn sets it below (the click that started the slide left x, y on the new square), so it's
			// right if it's drawn before its own turn (with reduce motion its first frame already hops)
			tile.x = q % 8;
			tile.y = Math.floor(q / 8);
			// The row it's over. yDiff is subtracted (up the screen is positive)
			const row = Math.min(Math.max(Math.round(tile.y - tile.yDiff / game.tileHeight), 0), 7);
			const column = q % 8; // Its start column, not the one it's over: each piece goes over or under its shadow once
			if (row * 8 + column != q) { return { index: q, square: row * 8 + column }; }
			return null;
		}
	}
	return null;
}

/**
 * @description A sliding king, queen, bishop, rook or pawn is drawn once, in the turn of the first square after it (painter's order:
 * lower rows in front, further right over further left), not its start square's, so every reflection, shadow & piece is drawn
 * exactly once a frame.
 * !NOTE: DRAWING THE PIECES IN FRONT OF IT AGAIN AT THE END OF THE FRAME PUT THEM OVER THEIR RIGHT NEIGHBOUR'S SHADOW, SO THEY FLASHED
 * @return {[object]} { index: the sliding tile, sx, sy: where it's drawn this frame (in squares), drawn: already drawn this frame }
 */
function findSlideTurn() {
	for (let q = 0; q < game.tiles.length; q++) {
		const tile = game.tiles[q];
		if (tile.isSliding && tile.type && tile.type.match(/[kqbrp]/)) {
			// Its start square, as its own turn sets it below (the click that started the slide left x, y on the new square), so it's
			// right if it's drawn before its own turn (sliding up or left)
			tile.x = q % 8;
			tile.y = Math.floor(q / 8);
			// Where it is this frame (stepSlides), yDiff is subtracted (up the screen is positive)
			const sx = tile.x + tile.xDiff / game.tileWidth;
			const sy = tile.y - tile.yDiff / game.tileHeight;
			return { index: q, sx, sy, drawn: false };
		}
	}
	return null;
}

/* ---------------------------------------------------------------- */
// Last Move Highlight
/* ---------------------------------------------------------------- */
/**
 * @description Tints the from & to squares of the opponent's last move (game.lastOpponentMove), it stays until their next move lands
 */
function drawLastMove() {
	const lastMove = game.lastOpponentMove || [];
	ctx.globalAlpha = 0.30;
	for (let s = 0; s < lastMove.length; s++) {
		const column = lastMove[s].charCodeAt(0) - 97; // The a file is 0
		const rank = Number(lastMove[s][1]);
		const x = game.viewColor == 'b' ? 7 - column : column; // Flipped board: h1 is 0, 0
		const y = game.viewColor == 'b' ? rank - 1 : 8 - rank;
		ctx.drawImage(
			images[checkHighlight].image,
			(x * game.tileWidth + game.xBoardOff) + ((game.tileWidth * 0.0243) / 2),
			(y * game.tileHeight - game.tileHeight / 10 + game.yBoardOff) + ((game.tileHeight * 0.1034) / 2),
			game.tileWidth,
			game.tileHeight
		);
	}
	ctx.globalAlpha = 1.00;
}

/* ---------------------------------------------------------------- */
// Hint
/* ---------------------------------------------------------------- */
/**
 * @description Highlights the from & to squares of the hint (game.hint) with the move highlight
 */
function drawHint() {
	const hint = game.hint || [];
	ctx.globalAlpha = 0.50;
	for (let s = 0; s < hint.length; s++) {
		const column = hint[s].charCodeAt(0) - 97; // The a file is 0
		const rank = Number(hint[s][1]);
		const x = game.viewColor == 'b' ? 7 - column : column; // Flipped board: h1 is 0, 0
		const y = game.viewColor == 'b' ? rank - 1 : 8 - rank;
		ctx.drawImage(
			images[moveHighlight].image,
			x * game.tileWidth + game.xBoardOff,
			y * game.tileHeight - game.tileHeight / 10 + game.yBoardOff,
			game.tileWidth,
			game.tileHeight
		);
	}
	ctx.globalAlpha = 1.00;
}

/* ---------------------------------------------------------------- */
// Marks & Arrows
/* ---------------------------------------------------------------- */
/**
 * @description Draws the player's right-click marks (a ring) & arrows (game.annotations) from square centers
 */
function drawAnnotations() {
	ctx.save();
	ctx.translate(game.xBoardOff, game.yBoardOff);
	// One unit is one square: line widths & heads stretch with the wide squares in every direction
	ctx.scale(game.tileWidth, game.tileHeight);
	ctx.globalAlpha = 0.7;
	ctx.strokeStyle = "#e8792b";
	ctx.fillStyle = "#e8792b";
	ctx.lineWidth = 0.12;
	for (const { from, to } of game.annotations) {
		const [x1, y1] = squareCenter(from);
		const [x2, y2] = squareCenter(to);
		ctx.beginPath();
		if (from == to) { ctx.arc(x1, y1, 0.42, 0, Math.PI * 2); ctx.stroke(); continue; }
		const length = Math.hypot(x2 - x1, y2 - y1);
		const ux = (x2 - x1) / length; // One square along the arrow
		const uy = (y2 - y1) / length;
		// Starts at the edge of the from square's piece, stops at the head so the see-through colors don't overlap
		ctx.moveTo(x1 + ux * 0.3, y1 + uy * 0.3);
		ctx.lineTo(x2 - ux * 0.5, y2 - uy * 0.5);
		ctx.stroke();
		ctx.beginPath();
		ctx.moveTo(x2 - ux * 0.1, y2 - uy * 0.1); // Tip
		ctx.lineTo(x2 - ux * 0.5 - uy * 0.25, y2 - uy * 0.5 + ux * 0.25);
		ctx.lineTo(x2 - ux * 0.5 + uy * 0.25, y2 - uy * 0.5 - ux * 0.25);
		ctx.fill();
	}
	ctx.restore();
}

/**
 * @description Column & row of a square's center on screen, in squares
 */
function squareCenter(square) {
	const column = square.charCodeAt(0) - 97; // The a file is 0
	const rank = Number(square[1]);
	return game.viewColor == 'b' ? [7 - column + 0.5, rank - 0.5] : [column + 0.5, 8.5 - rank]; // Flipped board: h1 is 0, 0
}

/**
 * @description Frames only come while a held piece moves: moved for long enough, it's a drag (the click handler drops it)
 */
function handleDragHold(tile) {
	if (game.mouseDownTime === null) { game.mouseDownTime = performance.now(); }
	else if (performance.now() - game.mouseDownTime > DRAG_HOLD_MS) { tile.isClicked = true; }
}

/**
 * @description The selected piece's legal moves, a held piece comes first. Found once per piece & square (game.availableMovesData)
 * @param  {[array]} moves [the moves found last time]
 * @return {[array]} chess.js verbose moves
 */
function selectedMoves(moves) {
	const tile = game.mousedownTile || game.clickedTile;
	if (game.availableMovesData.piece == tile.type && game.availableMovesData.square == tile.square) { return moves; } // Same piece
	game.availableMovesData = { piece: tile.type, square: tile.square };
	return chessInst.moves({ piece: tile.type, square: tile.square, verbose: true });
}

/* ---------------------------------------------------------------- */
// Draw Hopping Knight
/* ---------------------------------------------------------------- */
/**
 * @description Draws the hopping knight in this square's turn, before this square's piece (it's over this square, hopTurn), facing
 * the way this move goes
 * @param  {[number]} knightIndex [the knight's tile]
 */
function drawHoppingKnight(knightIndex, x, y) {
	const knight = game.tiles[knightIndex];
	setKnightSide(knight.color, rightFromFiles(drawSlide.face().from, drawSlide.face().to, game.viewColor) ? 'right' : 'left');
	if (knight.color == 'w') {
		drawTile.piece([game.wKnightRefl, game.wKnightShdw, game.wKnightImg], x, y, false, knightIndex, drawState);
	} else if (knight.color == 'b') {
		drawTile.piece([game.bKnightRefl, game.bKnightShdw, game.bKnightImg], x, y, false, knightIndex, drawState);
	}
}

/**
 * @description The sliding piece is drawn before the first square after it: a lower row, or its row & further right (the board at
 * rest draws in this order)
 */
function isAfterSlide(row, column, slideTurn) {
	return row > slideTurn.sy + 0.001 || (Math.abs(row - slideTurn.sy) <= 0.001 && column > slideTurn.sx + 0.001);
}

/* ---------------------------------------------------------------- */
// Draw Sliding Piece
/* ---------------------------------------------------------------- */
/**
 * @description Draws the sliding king, queen, bishop, rook or pawn in this square's turn, before this square's piece (slideTurn), like
 * Draw Hopping Knight
 */
function drawSlidingPiece(slideTurn, x, y) {
	slideTurn.drawn = true;
	if (game.currPromotion) { return; } // No pieces on the board while the promotion picker is up
	const tile = game.tiles[slideTurn.index];
	drawTile.boardPiece(tile.type, tile.color, x, y, true, slideTurn.index, drawState);
}

/* ---------------------------------------------------------------- */
// Draw Square Piece
/* ---------------------------------------------------------------- */
/**
 * @description Draws the piece standing on this square. A held piece over one of its moves is drawn there instead
 * (drawTile.availableMoves), a sliding piece in the turn of the square after it (drawSlidingPiece) & no pieces while the promotion
 * picker is up
 * @param  {[object]} piece [chess.js board square: { type, color }]
 */
function drawSquarePiece(piece, row, column, index, x, y, slideTurn, hopTurn) {
	const tile = game.tiles[index]; // Read again: a slide that landed above can have replaced game.tiles (refreshData)
	tile.originX = column; // The piece's own square (x, y follow the mouse while it's held)
	tile.originY = row;
	if (game.currPromotion) { return; }
	if (game.mousedownTile.xAvailInt == tile.x && game.mousedownTile.yAvailInt == tile.y) { return; } // Drawn as the held piece's preview

	const opacity = !(tile.isClicked && (tile.x == tile.originX && tile.y == tile.originY)); // Solid when it's back on its own square
	if (piece.type.match(/[kqbrp]/) && piece.color) {
		if (!(slideTurn && slideTurn.index == index)) { drawTile.boardPiece(piece.type, piece.color, x, y, opacity, index, drawState); }
	} else if (piece.type.match(/[n]/) && piece.color) {
		drawTile.knight(piece.color, x, y, opacity, index, hopTurn, drawState);
	}
}
