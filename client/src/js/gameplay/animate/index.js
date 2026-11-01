/*
 *  index.js  --  chess frontend
 *	Animate
 *	Where a sliding piece is from the time (stepSlide), how high a hopping knight is (handleKnightHop, draw uses it every frame of a knight's move) & the pieces sliding home
 *	after Restart & Rematch: where every piece is, pairing them with the new game's pieces & drawing each frame of the slide
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */
const { game, ctx, chessInst } = require("../state/index.js"); // THE GAME'S SHARED STATE, THE CANVAS, THE BOARD THAT'S DRAWN
const { images } = require("../images/index.js"); // THE LOADED IMAGES BY IMAGE NUMBER
const { renderBoard } = require("../layout/index.js"); // SIZES THE CANVAS & BOARD TO THE WINDOW & DRAWS THE TABLE & BOARD
const { handlePieceDirectionW, handlePieceDirectionB, handlePawnDirection } = require("../draw/index.js"); // WHICH WAY A SLIDING PIECE FACES
const {
	tableShdw, wRightKnightImg, wLeftKnightImg, wRightKnightShdw, wLeftKnightShdw, wRightKnightRefl, wLeftKnightRefl, bRightKnightImg, bLeftKnightImg, bRightKnightShdw, bLeftKnightShdw, bRightKnightRefl, bLeftKnightRefl // TABLE SHADOW & THE KNIGHTS (THE OTHER PIECES' IMAGES COME FROM THE draw FUNCTIONS ABOVE)
} = require("../sprites/index.js"); // IMAGE NUMBERS, images[number].image IS THE IMAGE
const { setRestartLoading } = require("../menu/index.js"); // RESTART / REMATCH BUTTON'S LOADING FILL, PUT BACK WHEN THE PIECES ARE HOME
const optBtn = document.getElementById("optBtn"); // MENU BUTTON (3 LINES, TOP RIGHT), SHOWN AGAIN WHEN THE PIECES ARE HOME

const RESTART_SLIDE_MS = 800; // HOW LONG THE PIECES TAKE TO SLIDE HOME
const SLIDE_MS_PER_SQUARE = 263; // HOW LONG A MOVE TAKES PER SQUARE
export const KNIGHT_PAUSE_MS = 100; // A KNIGHT STOPS THIS LONG BEFORE ITS HOP

/* ---------------------------------------------------------------- */
// Step Slide
/* ---------------------------------------------------------------- */
/**
 * @description Puts a sliding piece where the time says it is (progress = elapsed / duration), so it moves at the same speed
 * at any frame rate, lands on time after a hidden tab comes back & stays lined up after a resize. The clock starts on the
 * slide's first frame (a slide that starts in a hidden tab plays when the tab is shown). A knight takes the time of one square
 * (its long side goes twice as fast, so both sides finish together) & stays put for KNIGHT_PAUSE_MS first.
 * With reduce motion on it's there on its first frame: no slide, no knight stop or hop (slideProgress 1 lands it, sin(PI) is no hop)
 * @param  {[object]} tile [the sliding tile]
 * @param  {[number]} square [its index in tiles (row * 8 + column), its start square]
 */
export function stepSlide(tile, square) {
	const xSquares = tile.xSlideTo - square % 8; // SQUARES TO GO ACROSS, RIGHT IS POSITIVE
	const ySquares = tile.ySlideTo - Math.floor(square / 8); // SQUARES TO GO UP OR DOWN, DOWN THE SCREEN IS POSITIVE
	const knight = tile.type == 'n';
	const now = performance.now();
	if (tile.slideStartTime === null || tile.slideStartTime === undefined) { tile.slideStartTime = now + (knight ? KNIGHT_PAUSE_MS : 0); }
	const duration = (knight ? 1 : Math.max(Math.abs(xSquares), Math.abs(ySquares))) * SLIDE_MS_PER_SQUARE;
	tile.slideProgress = duration && !game.reduceMotion ? Math.min(Math.max((now - tile.slideStartTime) / duration, 0), 1) : 1; // 0 - 1 OF THE TIME
	if (game.reduceMotion) { game.slideStart = false; } // NO KNIGHT STOP (slideStart IS WHAT STARTS IT)
	tile.xDiff = xSquares * game.tileWidth * tile.slideProgress; // PIXELS MOVED SO FAR
	tile.yDiff = -ySquares * game.tileHeight * tile.slideProgress; // yDiff IS SUBTRACTED, SO GOING DOWN THE SCREEN MAKES IT NEGATIVE
}

/* ---------------------------------------------------------------- */
// Handle Knight Hop
/* ---------------------------------------------------------------- */
/**
 * @description Check how far the sliding knight has gone to determine how high it is. Sets knightHop on an arc,
 * 0 as it leaves its square, 1 halfway (half a square up) & back to 0 as it lands, so it doesn't pop up or drop.
 * Its shadow & reflection use it too (they slide out from under it as it rises)
 * @param  {[object]} tile [the knight's tile]
 */
export function handleKnightHop(tile) {
	let xMoved = 0; // HOW FAR ACROSS IT'S GONE (0 - 1)
	let yMoved = 0; // HOW FAR UP OR DOWN IT'S GONE (0 - 1)
	if (tile.isSliding) {
		if (tile.xSlideTo != tile.x) { xMoved = Math.abs(tile.xDiff) / (Math.abs(tile.xSlideTo - tile.x) * game.tileWidth); }
		if (tile.ySlideTo != tile.y) { yMoved = Math.abs(tile.yDiff) / (Math.abs(tile.ySlideTo - tile.y) * game.tileHeight); }
		game.knightHop = Math.sin(Math.min(Math.max(xMoved, yMoved), 1) * Math.PI); // 0 AT THE START & END, 1 HALFWAY
		if (game.knightHop < 0.001) { game.knightHop = 0; } // BACK ON THE BOARD (sin(PI) ISN'T EXACTLY 0)
	} else { game.knightHop = 0; } // ON THE BOARD
}

/* ---------------------------------------------------------------- */
// Restart Slide (Restart & Rematch)
/* ---------------------------------------------------------------- */
/**
 * @description Where every piece is on screen in squares (screen column x & row y, like tiles), so the slide still lines up
 * after a resize. Board pieces sit a tenth of a square up like they're drawn, taken pieces are where renderTakenPieces()
 * last drew them (pawns aren't in the trays)
 * @param  {[boolean]} withTrays [true adds the taken pieces (the old game), the new game has none]
 * @return {[array]} pieces [{ type, color, square, x, y }, square is null in a tray]
 */
export function getRestartPieces(withTrays) {
	let pieces = [];
	let board = chessInst.board(); // ROW 0 IS RANK 8, COLUMN 0 IS THE a FILE
	if (game.playerColor == 'b') { // FLIPPED BOARD, SAME AS handleInitialData()
		board = board.reverse();
		for (let i = board.length - 1; i >= 0; i--) { board[i] = board[i].reverse(); }
	}
	for (let i = 0; i < board.length; i++) { // ROW
		for (let j = 0; j < board[i].length; j++) { // COLUMN
			if (board[i][j]) { pieces[pieces.length] = { type: board[i][j].type, color: board[i][j].color, square: board[i][j].square, x: j, y: i - 0.1 }; } // RESTING PIECES SIT A TENTH OF A SQUARE UP
		}
	}
	if (withTrays && !game.currPromotion) { // WHILE PROMOTING THE TRAY IS THE PROMOTION PICKER
		const takenPieces = [...(game.wTakenPieces || []), ...(game.bTakenPieces || [])];
		for (let i = 0; i < takenPieces.length; i++) {
			if (takenPieces[i].x !== undefined) { pieces[pieces.length] = { type: takenPieces[i].type, color: takenPieces[i].color, square: null, x: takenPieces[i].x, y: takenPieces[i].y }; } // DRAWN IN A TRAY
		}
	}
	return pieces;
}

/**
 * @description Starts the slide home. Pairs every piece of the new game with a piece of the old one, same color & type,
 * closest pairs first (a bishop stays on its square color). A square with no old piece (a taken pawn, pawns aren't in
 * the trays) fades in, an old piece with no square (a promoted piece) fades out where it is
 * @param  {[array]} fromPieces [the old game, getRestartPieces(true) before it was replaced]
 */
export function startRestartSlide(fromPieces) {
	const toPieces = getRestartPieces(false); // THE NEW GAME'S START SQUARES
	let pairs = []; // EVERY OLD & NEW PIECE THAT COULD BE THE SAME PIECE
	for (let t = 0; t < toPieces.length; t++) {
		for (let f = 0; f < fromPieces.length; f++) {
			if (toPieces[t].color != fromPieces[f].color || toPieces[t].type != fromPieces[f].type) { continue; }
			let distance = Math.hypot(toPieces[t].x - fromPieces[f].x, toPieces[t].y - fromPieces[f].y);
			if (toPieces[t].type == 'b' && fromPieces[f].square && chessInst.squareColor(fromPieces[f].square) != chessInst.squareColor(toPieces[t].square)) { distance += 100; } // A BISHOP STAYS ON ITS SQUARE COLOR
			pairs[pairs.length] = { t, f, distance };
		}
	}
	pairs.sort(function (a, b) { return a.distance - b.distance; }); // CLOSEST FIRST
	let pieces = [];
	let toUsed = [];
	let fromUsed = [];
	for (let i = 0; i < pairs.length; i++) {
		if (toUsed[pairs[i].t] || fromUsed[pairs[i].f]) { continue; } // ONE OF THEM IS ALREADY PAIRED
		toUsed[pairs[i].t] = true;
		fromUsed[pairs[i].f] = true;
		pieces[pieces.length] = setSlidePiece(fromPieces[pairs[i].f], toPieces[pairs[i].t], 0);
	}
	for (let t = 0; t < toPieces.length; t++) { if (!toUsed[t]) { pieces[pieces.length] = setSlidePiece(toPieces[t], toPieces[t], 1); } } // FADES IN
	for (let f = 0; f < fromPieces.length; f++) { if (!fromUsed[f]) { pieces[pieces.length] = setSlidePiece(fromPieces[f], fromPieces[f], -1); } } // FADES OUT
	game.restartSlide = { pieces, startTime: Date.now() };
}

/**
 * @description One piece of the slide home & its images, picked once like a move: pawns face the other side, kings,
 * queens, bishops & rooks face up or down the way they go (sideways faces their start way), knights face left or right
 * the way they go (one that stays in its column faces the middle, like the start). The new game's first frame turns
 * them to their start
 * @param  {[object]} from [{ type, color, square, x, y } where it is now]
 * @param  {[object]} to [where it goes, its start square]
 * @param  {[number]} fade [0 = solid, 1 = fades in, -1 = fades out]
 * @return {[object]} { type, xFrom, yFrom, xTo, yTo, fade, imgArr }
 */
function setSlidePiece(from, to, fade) {
	let imgArr; // REFLECTION, SHADOW, PIECE
	const square = to.square || from.square; // A BISHOP'S IMAGE FOLLOWS ITS SQUARE COLOR
	if (to.type == 'p') { // PAWN
		handlePawnDirection();
		if (to.color == 'w') { imgArr = [game.wPawnRefl, game.wPawnShdw, game.wPawnImg]; } else { imgArr = [game.bPawnRefl, game.bPawnShdw, game.bPawnImg]; }
	} else if (to.type == 'n') { // KNIGHT
		const right = to.x > from.x || (to.x == from.x && to.x < 4);
		if (to.color == 'w') { imgArr = right ? [wRightKnightRefl, wRightKnightShdw, wRightKnightImg] : [wLeftKnightRefl, wLeftKnightShdw, wLeftKnightImg]; }
		else { imgArr = right ? [bRightKnightRefl, bRightKnightShdw, bRightKnightImg] : [bLeftKnightRefl, bLeftKnightShdw, bLeftKnightImg]; }
	} else { // KING, QUEEN, BISHOP OR ROOK
		const yFrom = from.y == to.y ? null : from.y; // null: SIDEWAYS (OR STAYING), FACES ITS START WAY
		const yTo = from.y == to.y ? null : to.y;
		const lightSquare = square && chessInst.squareColor(square) == 'light';
		if (to.color == 'w') {
			handlePieceDirectionW(yFrom, yTo);
			if (to.type == 'k') { imgArr = [game.wKingRefl, game.wKingShdw, game.wKingImg]; }
			else if (to.type == 'q') { imgArr = [game.wQueenRefl, game.wQueenShdw, game.wQueenImg]; }
			else if (to.type == 'b') { imgArr = [game.wBishopRefl, game.wBishopShdw, lightSquare ? game.wBishopWhiteSqImg : game.wBishopBlackSqImg]; }
			else if (to.type == 'r') { imgArr = [game.wRookRefl, game.wRookShdw, game.wRookImg]; }
		} else {
			handlePieceDirectionB(yFrom, yTo);
			if (to.type == 'k') { imgArr = [game.bKingRefl, game.bKingShdw, game.bKingImg]; }
			else if (to.type == 'q') { imgArr = [game.bQueenRefl, game.bQueenShdw, game.bQueenImg]; }
			else if (to.type == 'b') { imgArr = [game.bBishopRefl, game.bBishopShdw, lightSquare ? game.bBishopWhiteSqImg : game.bBishopBlackSqImg]; }
			else if (to.type == 'r') { imgArr = [game.bRookRefl, game.bRookShdw, game.bRookImg]; }
		}
	}
	return { type: to.type, xFrom: from.x, yFrom: from.y, xTo: to.x, yTo: to.y, fade, imgArr };
}

/**
 * @description One frame of the slide home, the render loop calls it instead of drawScreen while restartSlide is set.
 * Draws the board, then every piece part of the way home on a slow start & landing, back to front so the lower pieces
 * cover the ones above them. Knights hop like a move, their image is drawn on top while they're in the air (their reflection & shadow
 * stay in order, under the pieces in front of them). When the time is up
 * the new game takes over (its first frame turns the pieces to their start, an AI move slides in after). With reduce motion on the time is up on the first frame, so the pieces are just set
 */
export function drawRestartSlide() {
	const progress = game.reduceMotion ? 1 : Math.min((Date.now() - game.restartSlide.startTime) / RESTART_SLIDE_MS, 1); // 0 - 1 OF THE TIME
	if (progress == 1) { // HOME: THE NEW GAME TAKES OVER
		game.restartSlide = null;
		setRestartLoading(false);
		optBtn.style.display = "flex";
		game.opposingMove = chessInst.turn() != game.playerColor; // LOCKED IF THE OPPONENT GOES FIRST
		game.boardReset = false;
		game.drawScreen(); // THE NEW GAME'S FIRST FRAME, IT ALSO PUTS THE SQUARES ON tiles SO AN AI MOVE FINDS ITS PIECE
		game.refresh = true; // AN AI MOVE SLIDES IN NEXT
		return;
	}
	const eased = 0.5 - Math.cos(progress * Math.PI) / 2; // HOW FAR ALONG, SLOW START & LANDING
	let hop = Math.sin(progress * Math.PI); // KNIGHTS: 0 ON THE BOARD, 1 HALFWAY (HALF A SQUARE UP), SAME ARC AS handleKnightHop()
	if (hop < 0.001) { hop = 0; } // BACK ON THE BOARD (sin(PI) ISN'T EXACTLY 0)
	renderBoard();

	let drawPieces = []; // WHERE EACH PIECE IS THIS FRAME
	for (let i = 0; i < game.restartSlide.pieces.length; i++) {
		const piece = game.restartSlide.pieces[i];
		const moving = piece.xFrom != piece.xTo || piece.yFrom != piece.yTo;
		drawPieces[i] = {
			imgArr: piece.imgArr,
			x: piece.xFrom + (piece.xTo - piece.xFrom) * eased,
			y: piece.yFrom + (piece.yTo - piece.yFrom) * eased,
			hop: (piece.type == 'n' && moving) ? hop : 0,
			alpha: piece.fade == 1 ? progress : piece.fade == -1 ? 1 - progress : 1 // FADES IN, FADES OUT OR SOLID
		};
	}
	drawPieces.sort(function (a, b) { return a.y - b.y; }); // BACK TO FRONT BY WHERE THEY ARE ON THE BOARD (A KNIGHT IN THE AIR BY THE SQUARE UNDER IT)

	for (let i = 0; i < drawPieces.length; i++) {
		const piece = drawPieces[i];
		const x = piece.x * game.tileWidth + game.xBoardOff - game.xPieceOffset / 2;
		const y = piece.y * game.tileHeight + game.yBoardOff - game.yPieceOffset / 2;
		ctx.globalAlpha = 0.30 * piece.alpha; // REFLECTION & SHADOW STAY ON THE BOARD, SHIFTED UP TO A FIFTH OF A SQUARE LEFT AS A KNIGHT RISES
		ctx.drawImage(images[piece.imgArr[0]].image, x - (game.tileWidth / 5) * piece.hop, y, game.tileWidth + game.xPieceOffset, game.tileHeight + game.yPieceOffset);
		ctx.globalAlpha = 0.75 * piece.alpha;
		ctx.drawImage(images[piece.imgArr[1]].image, x - (game.tileWidth / 5) * piece.hop, y, game.tileWidth + game.xPieceOffset, game.tileHeight + game.yPieceOffset);
		ctx.globalAlpha = piece.alpha;
		if (piece.hop == 0) { ctx.drawImage(images[piece.imgArr[2]].image, x, y, game.tileWidth + game.xPieceOffset, game.tileHeight + game.yPieceOffset); } // PIECE (A KNIGHT IN THE AIR IS DRAWN BELOW)
	}
	for (let i = 0; i < drawPieces.length; i++) { // KNIGHTS IN THE AIR GO OVER EVERYTHING, UP TO HALF A SQUARE UP (ONLY THE IMAGE, LIKE drawSlideBox, THEIR SHADOWS STAYED IN ORDER ABOVE)
		const piece = drawPieces[i];
		if (piece.hop == 0) { continue; }
		ctx.globalAlpha = piece.alpha;
		ctx.drawImage(images[piece.imgArr[2]].image, piece.x * game.tileWidth + game.xBoardOff - game.xPieceOffset / 2, piece.y * game.tileHeight + game.yBoardOff - game.yPieceOffset / 2 - (game.tileHeight / 2) * piece.hop, game.tileWidth + game.xPieceOffset, game.tileHeight + game.yPieceOffset);
	}
	ctx.globalAlpha = 0.05
	ctx.drawImage(images[tableShdw].image, 0, 0, game.cw, game.ch); // RENDER TABLE SHDW
	ctx.globalAlpha = 1;
}
