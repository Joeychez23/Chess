/* ---------------------------------------------------------------- */
// setTiles()
/* ---------------------------------------------------------------- */
/**
 * @description Sets tile object, which is set by chess.js (npm) on render
 */
export function setTiles() {
	let arr = []
	for (let i = 0; i < 64; i++) {
		arr[i] = { isSliding: null, xSlideTo: null, ySlideTo: null, xDiff: 0, yDiff: 0, slideStartTime: null, slideProgress: 0, isHovering: false, isClicked: false, originX: null, originY: null, isMousedown: null}
	}
	return arr;
}


/* ---------------------------------------------------------------- */
// countStartPieces()
/* ---------------------------------------------------------------- */
/**
 * @description How many of each piece each side started with, the taken piece trays show (started - on the board).
 * A game from a set position (start_params.fen) can start with fewer pieces, or more (two queens)
 * @param  {[string]} fen [start position, left out = the standard position]
 * @return {[object]} counts [{ w: { king, queen, bishop, knight, rook, pawn }, b: { ... } }]
 */
export function countStartPieces(fen) {
	const names = { k: "king", q: "queen", b: "bishop", n: "knight", r: "rook", p: "pawn" };
	const placement = (fen || "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1").split(" ")[0]; // THE PIECES PART OF THE FEN
	let counts = { w: { king: 0, queen: 0, bishop: 0, knight: 0, rook: 0, pawn: 0 }, b: { king: 0, queen: 0, bishop: 0, knight: 0, rook: 0, pawn: 0 } };
	for (let i = 0; i < placement.length; i++) {
		const letter = placement[i];
		if (!names[letter.toLowerCase()]) { continue; } // EMPTY SQUARES (DIGITS) & "/"
		if (letter == letter.toUpperCase()) { counts.w[names[letter.toLowerCase()]]++; } // WHITE IS UPPERCASE
		else { counts.b[names[letter]]++; }
	}
	return counts;
}


/* ---------------------------------------------------------------- */
// materialDiff()
/* ---------------------------------------------------------------- */
/**
 * @description White's material minus black's, counted from the board so promotions & set positions are right
 * @param  {[array]} board [8 x 8 board from chessInst.board(), flipped or not]
 * @return {[number]} diff [above 0 = white is ahead, below 0 = black is ahead]
 */
export function materialDiff(board) {
	const values = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
	let diff = 0;
	for (const piece of board.flat()) {
		if (piece) { diff += piece.color == 'w' ? values[piece.type] : -values[piece.type]; }
	}
	return diff;
}


/* ---------------------------------------------------------------- */
// lastMoveBy()
/* ---------------------------------------------------------------- */
/**
 * @description Plays a game's saved moves to find one side's last move
 * @param  {[object]} board [chess.js board at the game's start position, its moves get played]
 * @param  {[array]} moves [the game's SAN moves]
 * @param  {[string]} color ['w' | 'b']
 * @return {[array]} [from, to], null when that side hasn't moved
 */
export function lastMoveBy(board, moves, color) {
	let last = null;
	for (let i = 0; i < moves.length; i++) {
		const move = board.move(moves[i]); // THROWS IF IT'S NOT LEGAL
		if (move.color == color) { last = [move.from, move.to]; }
	}
	return last;
}
