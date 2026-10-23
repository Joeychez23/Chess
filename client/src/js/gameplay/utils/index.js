/* ---------------------------------------------------------------- */
// setTiles()
/* ---------------------------------------------------------------- */
/**
 * @description Sets tile object, which is set by chess.js (npm) on render
 */
export function setTiles() {
	let arr = []
	for (let i = 0; i < 64; i++) {
		arr[i] = { isSliding: null, xSlideTo: null, ySlideTo: null, xDiff: 0, yDiff: 0, isHovering: false, isClicked: false, originX: null, originY: null, isMousedown: null}
	}
	return arr;
}

/* ---------------------------------------------------------------- */
// moveFacing()
/* ---------------------------------------------------------------- */
/**
 * @description Works out which way the kings, queens, bishops & rooks face after a move, on the board before the move is made.
 * Same rules as the server (server/utils/validate.js), it keeps the local board in step until the server's game comes back:
 * a piece faces the way it moved up or down the board (a sideways move keeps its facing), castling takes the rook's facing
 * with it & a pawn promoted to a queen, rook or bishop faces the other side.
 * !NOTE: IT ONLY ADDS OR CHANGES SQUARES, NOTHING IS REMOVED (THE SERVER'S GAME DROPS THE OLD ONES WHEN IT COMES BACK). THE MOVE
 * LANDS HALFWAY THROUGH DRAWING A FRAME, SO THE REST OF THAT FRAME STILL DRAWS THE OLD BOARD & A TAKEN PIECE OR A CASTLING ROOK
 * WOULD TURN AROUND FOR A FRAME IF ITS SQUARE WAS GONE
 * @param  {[object]} board [chess.js board before the move]
 * @param  {[object]} response [game from the server { w_facing, b_facing }, JSON strings of { square: the rank it faces (8 | 1) }]
 * @param  {[object]} move [{ from, to, promotion }]
 * @return {[object]} facing [{ w_facing, b_facing }, JSON strings]
 */
export function moveFacing(board, response, move) {
	let w_facing = JSON.parse(response?.w_facing || "{}");
	let b_facing = JSON.parse(response?.b_facing || "{}");
	const piece = board.get(move.from);
	if (piece) {
		let facing = piece.color == 'w' ? w_facing : b_facing; // THE SIDE THAT'S MOVING
		const forward = piece.color == 'w' ? 8 : 1; // THE OTHER SIDE'S BACK RANK

		if (piece.type.match(/[kqbr]/)) {
			const fromRank = Number(move.from[1]);
			const toRank = Number(move.to[1]);
			let faces = facing[move.from] || forward;
			if (toRank > fromRank) { faces = 8; } // MOVED TOWARD RANK 8
			else if (toRank < fromRank) { faces = 1; } // MOVED TOWARD RANK 1
			facing[move.to] = faces;

			if (piece.type == 'k' && Math.abs(move.to.charCodeAt(0) - move.from.charCodeAt(0)) == 2) { // CASTLING: THE ROOK MOVES SIDEWAYS TOO, SAME FACING
				const rookFrom = `${move.to[0] == 'g' ? 'h' : 'a'}${fromRank}`;
				const rookTo = `${move.to[0] == 'g' ? 'f' : 'd'}${fromRank}`;
				facing[rookTo] = facing[rookFrom] || forward;
			}
		} else if (piece.type == 'p' && move.promotion && `${move.promotion}`.match(/[qbr]/)) { // PROMOTED: FACES THE OTHER SIDE (KNIGHTS GO IN THE KNIGHT LIST)
			facing[move.to] = forward;
		}
	}
	return { w_facing: JSON.stringify(w_facing), b_facing: JSON.stringify(b_facing) };
}

