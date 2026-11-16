/*
 *  rows.js  --  chess frontend
 *	Move List Rows
 *	The game's moves in numbered pairs for the move list panel (movelist/index.js) & the 3D room's monitor, with the ply of each move
 *	(the replay highlights it & jumps to it, #102). No page state, the server tests run it
 *
 */

/**
 * @description Puts the moves in numbered pairs. A set position starts at its own move number & when black moves first
 * the first row's white move is blank
 * @param  {[array]} sanMoves [the game's SAN moves]
 * @param  {[string]} fen [the start position's FEN, blank = the standard position]
 * @return {[array]} rows [{ number, white, black, whitePly, blackPly }: a ply is the move's place in sanMoves counting from 1, null for a blank cell]
 */
function moveRows(sanMoves, fen) {
	const [, turn, , , , fullMove] = (fen || "").split(" ");
	let number = Number(fullMove) || 1;
	let i = 0;
	const rows = [];
	if (turn === 'b' && sanMoves.length) { rows.push({ number: number++, white: "…", black: sanMoves[i], whitePly: null, blackPly: ++i }); }
	for (; i < sanMoves.length; i += 2) {
		const black = sanMoves[i + 1] || "";
		rows.push({ number: number++, white: sanMoves[i], black, whitePly: i + 1, blackPly: black ? i + 2 : null });
	}
	return rows;
}


module.exports = { moveRows };
