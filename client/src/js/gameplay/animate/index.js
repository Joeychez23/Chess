/*
 *  index.js  --  chess frontend
 *	Animate
 *	Where a sliding piece is from the time (stepSlide), how high a hopping knight is (handleKnightHop, draw uses it every
 *	frame of a knight's move) & the pieces sliding home after Restart & Rematch: where every piece is, pairing them with the
 *	new game's pieces & drawing each frame of the slide
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */
const { game, ctx, chessInst } = require("../state/index.js");
const { images } = require("../images/index.js"); // The loaded images by image number
const { renderBoard } = require("../layout/index.js"); // Sizes the canvas & board to the window & draws the table & board
const { setPieceSprites, handlePawnDirection } = require("../draw/pieceSprites.js");
const { awayFromRows } = require("../draw/facing.js");
// Image numbers (images[number].image is the image): the table shadow & the knights. The other pieces' images come from
// the draw functions above
const {
	tableShdw,
	wRightKnightImg, wLeftKnightImg, wRightKnightShdw, wLeftKnightShdw, wRightKnightRefl, wLeftKnightRefl,
	bRightKnightImg, bLeftKnightImg, bRightKnightShdw, bLeftKnightShdw, bRightKnightRefl, bLeftKnightRefl
} = require("../sprites/index.js");
const { setRestartLoading } = require("../menu/index.js"); // The restart / rematch button's loading fill, put back when the pieces are home
const { overlayShows } = require("../draw/overlay.js"); // 3D draws no tray slides: its overlay stays clear
const { currentView, VIEWS, glideHome3D } = require("../renderer/index.js");
const optBtn = document.getElementById("optBtn"); // Menu button (3 lines, top right), shown again when the pieces are home
// Shared with the 3D board, so a move takes the same time on both
const { RESTART_SLIDE_MS, slideDuration, slideDelay, hopArc, easeInOut } = require("./timing.js");

// On 3D the hidden 2D slide lands at once, so the move reaches chessInst & the 3D board slides it (not twice the wait)
function instant() {
	return game.reduceMotion || currentView() === VIEWS.THREE_D;
}

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
	const xSquares = tile.xSlideTo - square % 8; // Squares to go across, right is positive
	const ySquares = tile.ySlideTo - Math.floor(square / 8); // Squares to go up or down, down the screen is positive
	const knight = tile.type == 'n';
	const now = performance.now();
	if (tile.slideStartTime === null || tile.slideStartTime === undefined) { tile.slideStartTime = now + slideDelay(knight); }
	const duration = slideDuration(Math.max(Math.abs(xSquares), Math.abs(ySquares)), knight);
	tile.slideProgress = duration && !instant() ? Math.min(Math.max((now - tile.slideStartTime) / duration, 0), 1) : 1; // 0 - 1 of the time
	if (instant()) { game.slideStart = false; } // No knight stop (slideStart is what starts it)
	tile.xDiff = xSquares * game.tileWidth * tile.slideProgress; // Pixels moved so far
	tile.yDiff = -ySquares * game.tileHeight * tile.slideProgress; // yDiff is subtracted, so going down the screen makes it negative
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
	let xMoved = 0; // How far across it's gone (0 - 1)
	let yMoved = 0; // How far up or down it's gone (0 - 1)
	if (tile.isSliding) {
		if (tile.xSlideTo != tile.x) { xMoved = Math.abs(tile.xDiff) / (Math.abs(tile.xSlideTo - tile.x) * game.tileWidth); }
		if (tile.ySlideTo != tile.y) { yMoved = Math.abs(tile.yDiff) / (Math.abs(tile.ySlideTo - tile.y) * game.tileHeight); }
		game.knightHop = hopArc(Math.max(xMoved, yMoved)); // 0 at the start & end, 1 halfway
	} else { game.knightHop = 0; } // On the board
}

/* ---------------------------------------------------------------- */
// Restart Slide (Restart & Rematch)
/* ---------------------------------------------------------------- */
/**
 * @description How far a tray row is drawn below its row, in squares. A narrow screen's bottom tray (row 9) would cover the
 * file letters on the board's border. Only the drawing moves, clicks still use the row
 * @param  {[number]} row [tray row]
 * @return {[number]} nudge [squares down]
 */
export function trayNudge(row) {
	return !game.widthGreater && row === 9 ? 0.2 : 0;
}

/**
 * @description Where every piece is on screen in squares (screen column x & row y, like tiles), so the slide still lines up
 * after a resize. Board pieces sit a tenth of a square up like they're drawn, taken pieces are where renderTakenPieces()
 * last drew them (pawns aren't in the trays)
 * @param  {[boolean]} withTrays [true adds the taken pieces (the old game), the new game has none]
 * @return {[array]} pieces [{ type, color, square, x, y }, square is null in a tray]
 */
export function getRestartPieces(withTrays) {
	let pieces = [];
	let board = chessInst.board(); // Row 0 is rank 8, column 0 is the a file
	if (game.viewColor == 'b') { // The flipped board, same as handleInitialData()
		board = board.reverse();
		for (let i = board.length - 1; i >= 0; i--) { board[i] = board[i].reverse(); }
	}
	for (let i = 0; i < board.length; i++) { // Row
		for (let j = 0; j < board[i].length; j++) { // Column
			const piece = board[i][j];
			if (piece) { // Resting pieces sit a tenth of a square up
				pieces[pieces.length] = { type: piece.type, color: piece.color, square: piece.square, x: j, y: i - 0.1 };
			}
		}
	}
	if (withTrays && !game.currPromotion && overlayShows(game) === "all") { // While promoting the tray is the promotion picker
		const takenPieces = [...(game.wTakenPieces || []), ...(game.bTakenPieces || [])];
		for (let i = 0; i < takenPieces.length; i++) {
			const takenPiece = takenPieces[i];
			if (takenPiece.x !== undefined) { // Drawn in a tray
				pieces[pieces.length] = {
					type: takenPiece.type,
					color: takenPiece.color,
					square: null,
					x: takenPiece.x,
					y: takenPiece.y + trayNudge(takenPiece.y)
				};
			}
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
	const toPieces = getRestartPieces(false); // The new game's start squares
	let pairs = []; // Every old & new piece that could be the same piece
	for (let t = 0; t < toPieces.length; t++) {
		const toPiece = toPieces[t];
		for (let f = 0; f < fromPieces.length; f++) {
			const fromPiece = fromPieces[f];
			if (toPiece.color != fromPiece.color || toPiece.type != fromPiece.type) { continue; }
			let distance = Math.hypot(toPiece.x - fromPiece.x, toPiece.y - fromPiece.y);
			// A bishop stays on its square color
			if (toPiece.type == 'b' && fromPiece.square
				&& chessInst.squareColor(fromPiece.square) != chessInst.squareColor(toPiece.square)) { distance += 100; }
			pairs[pairs.length] = { t, f, distance };
		}
	}
	pairs.sort(function (a, b) { return a.distance - b.distance; }); // Closest first
	let pieces = [];
	let toUsed = [];
	let fromUsed = [];
	for (let i = 0; i < pairs.length; i++) {
		const pair = pairs[i];
		if (toUsed[pair.t] || fromUsed[pair.f]) { continue; } // One of them is already paired
		toUsed[pair.t] = true;
		fromUsed[pair.f] = true;
		pieces[pieces.length] = setSlidePiece(fromPieces[pair.f], toPieces[pair.t], 0);
	}
	for (let t = 0; t < toPieces.length; t++) { // Fades in
		if (!toUsed[t]) { pieces[pieces.length] = setSlidePiece(toPieces[t], toPieces[t], 1); }
	}
	for (let f = 0; f < fromPieces.length; f++) { // Fades out
		if (!fromUsed[f]) { pieces[pieces.length] = setSlidePiece(fromPieces[f], fromPieces[f], -1); }
	}
	game.restartSlide = { pieces, startTime: Date.now() };
	glideHome3D(); // On 3D its pieces glide home in the same time (the 2D slide still runs hidden & ends it)
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
	let imgArr; // Reflection, shadow, piece
	const square = to.square || from.square; // A bishop's image follows its square color
	if (to.type == 'p') { // Pawn
		handlePawnDirection();
		if (to.color == 'w') {
			imgArr = [game.wPawnRefl, game.wPawnShdw, game.wPawnImg];
		} else {
			imgArr = [game.bPawnRefl, game.bPawnShdw, game.bPawnImg];
		}
	} else if (to.type == 'n') { // Knight
		const right = to.x > from.x || (to.x == from.x && to.x < 4);
		if (to.color == 'w') {
			imgArr = right ? [wRightKnightRefl, wRightKnightShdw, wRightKnightImg] : [wLeftKnightRefl, wLeftKnightShdw, wLeftKnightImg];
		}
		else {
			imgArr = right ? [bRightKnightRefl, bRightKnightShdw, bRightKnightImg] : [bLeftKnightRefl, bLeftKnightShdw, bLeftKnightImg];
		}
	} else { // King, queen, bishop or rook
		const yFrom = from.y == to.y ? null : from.y; // null: sideways (or staying), faces its start way
		const yTo = from.y == to.y ? null : to.y;
		const lightSquare = square && chessInst.squareColor(square) == 'light';
		setPieceSprites(to.color, awayFromRows(yFrom, yTo, to.color, game.viewColor));
		if (to.color == 'w') {
			if (to.type == 'k') { imgArr = [game.wKingRefl, game.wKingShdw, game.wKingImg]; }
			else if (to.type == 'q') { imgArr = [game.wQueenRefl, game.wQueenShdw, game.wQueenImg]; }
			else if (to.type == 'b') {
				imgArr = [game.wBishopRefl, game.wBishopShdw, lightSquare ? game.wBishopWhiteSqImg : game.wBishopBlackSqImg];
			}
			else if (to.type == 'r') { imgArr = [game.wRookRefl, game.wRookShdw, game.wRookImg]; }
		} else {
			if (to.type == 'k') { imgArr = [game.bKingRefl, game.bKingShdw, game.bKingImg]; }
			else if (to.type == 'q') { imgArr = [game.bQueenRefl, game.bQueenShdw, game.bQueenImg]; }
			else if (to.type == 'b') {
				imgArr = [game.bBishopRefl, game.bBishopShdw, lightSquare ? game.bBishopWhiteSqImg : game.bBishopBlackSqImg];
			}
			else if (to.type == 'r') { imgArr = [game.bRookRefl, game.bRookShdw, game.bRookImg]; }
		}
	}
	return { type: to.type, xFrom: from.x, yFrom: from.y, xTo: to.x, yTo: to.y, fade, imgArr };
}

/**
 * @description One frame of the slide home, the render loop calls it instead of drawScreen while restartSlide is set.
 * Draws the board, then every piece part of the way home on a slow start & landing, back to front so the lower pieces
 * cover the ones above them. Knights hop like a move, their image is drawn on top while they're in the air (their
 * reflection & shadow stay in order, under the pieces in front of them). When the time is up the new game takes over (its
 * first frame turns the pieces to their start, an AI move slides in after). With reduce motion on the time is up on the
 * first frame, so the pieces are just set
 */
export function drawRestartSlide() {
	const progress = game.reduceMotion ? 1 : Math.min((Date.now() - game.restartSlide.startTime) / RESTART_SLIDE_MS, 1); // 0 - 1 of the time
	if (progress == 1) { // Home: the new game takes over
		game.restartSlide = null;
		setRestartLoading(false);
		optBtn.style.display = "flex";
		// The menu closed while the button was away, the focus goes back to it now
		if (document.activeElement == document.body) { optBtn.focus(); }
		game.opposingMove = chessInst.turn() != game.playerColor; // Locked if the opponent goes first
		game.boardReset = false;
		game.drawScreen(); // The new game's first frame, it also puts the squares on tiles so an AI move finds its piece
		game.refresh = true; // An AI move slides in next
		return;
	}
	const eased = easeInOut(progress); // How far along, slow start & landing
	const hop = hopArc(progress); // Knights: 0 on the board, 1 halfway (half a square up), same arc as handleKnightHop()
	renderBoard();
	if (overlayShows(game) !== "all") { // 3D: its pieces glide home on their own (glideHome3D), the overlay stays clear
		ctx.clearRect(0, 0, game.cw, game.ch);
		return;
	}

	let drawPieces = []; // Where each piece is this frame
	for (let i = 0; i < game.restartSlide.pieces.length; i++) {
		const piece = game.restartSlide.pieces[i];
		const moving = piece.xFrom != piece.xTo || piece.yFrom != piece.yTo;
		drawPieces[i] = {
			imgArr: piece.imgArr,
			x: piece.xFrom + (piece.xTo - piece.xFrom) * eased,
			y: piece.yFrom + (piece.yTo - piece.yFrom) * eased,
			hop: (piece.type == 'n' && moving) ? hop : 0,
			alpha: piece.fade == 1 ? progress : piece.fade == -1 ? 1 - progress : 1 // Fades in, fades out or solid
		};
	}
	// Back to front by where they are on the board (a knight in the air by the square under it)
	drawPieces.sort(function (a, b) { return a.y - b.y; });

	for (let i = 0; i < drawPieces.length; i++) {
		const piece = drawPieces[i];
		const x = piece.x * game.tileWidth + game.xBoardOff - game.xPieceOffset / 2;
		const y = piece.y * game.tileHeight + game.yBoardOff - game.yPieceOffset / 2;
		// Reflection & shadow stay on the board, shifted up to a fifth of a square left as a knight rises
		ctx.globalAlpha = 0.30 * piece.alpha;
		ctx.drawImage(images[piece.imgArr[0]].image, x - (game.tileWidth / 5) * piece.hop, y,
			game.tileWidth + game.xPieceOffset, game.tileHeight + game.yPieceOffset);
		ctx.globalAlpha = 0.75 * piece.alpha;
		ctx.drawImage(images[piece.imgArr[1]].image, x - (game.tileWidth / 5) * piece.hop, y,
			game.tileWidth + game.xPieceOffset, game.tileHeight + game.yPieceOffset);
		ctx.globalAlpha = piece.alpha;
		if (piece.hop == 0) { // The piece (a knight in the air is drawn below)
			ctx.drawImage(images[piece.imgArr[2]].image, x, y, game.tileWidth + game.xPieceOffset, game.tileHeight + game.yPieceOffset);
		}
	}
	// Knights in the air go over everything, up to half a square up (only the image, like drawSlideBox, their shadows stayed
	// in order above)
	for (let i = 0; i < drawPieces.length; i++) {
		const piece = drawPieces[i];
		if (piece.hop == 0) { continue; }
		ctx.globalAlpha = piece.alpha;
		ctx.drawImage(
			images[piece.imgArr[2]].image,
			piece.x * game.tileWidth + game.xBoardOff - game.xPieceOffset / 2,
			piece.y * game.tileHeight + game.yBoardOff - game.yPieceOffset / 2 - (game.tileHeight / 2) * piece.hop,
			game.tileWidth + game.xPieceOffset,
			game.tileHeight + game.yPieceOffset
		);
	}
	ctx.globalAlpha = 0.05
	ctx.drawImage(images[tableShdw].image, 0, 0, game.cw, game.ch); // The table's shadow
	ctx.globalAlpha = 1;
}
