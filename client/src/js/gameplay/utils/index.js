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
