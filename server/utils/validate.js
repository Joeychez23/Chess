/*
 *  validate.js  --  chess server
 *	Chess Move Engine
 *  Validation Functions (was chess-validation/lambdas/functions/chess/validate/validate.js)
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */

const { Chess, validateFen, DEFAULT_POSITION } = require("chess.js");

const FACING_LISTS = ["w_knight", "b_knight", "w_piece", "b_piece"]; // WHICH WAY EACH KNIGHT, KING, QUEEN, BISHOP & ROOK FACES (JSON STRINGS ON THE GAME)

/* ---------------------------------------------------------------- */
// Check Start Position
/* ---------------------------------------------------------------- */
/**
 * @description Checks a position a new game starts from (Home & the guest page's Start position box). chess.js checks the FEN's
 * format & that each side has one king, this also turns down what it lets through: pawns on the first or last rank, the side
 * that isn't moving in check (its king could be taken), and positions that are already over
 * @param  {[string]} fen [req.body.start_fen, left out or blank = the standard position]
 * @return {[object]} result [{ fen } (the cleaned up FEN, false for the standard position) | { message } why it can't be played]
 */
function checkStartFen(fen) {
	if (typeof fen != "string" || !fen.trim()) { return { fen: false }; } // NO SET POSITION
	let fields = fen.trim().split(/\s+/);
	if (fields.length >= 2 && fields.length < 6) { fields = fields.concat(["-", "-", "0", "1"].slice(fields.length - 6)); } // "8/8/... w" IS ENOUGH, THE REST GET THEIR DEFAULTS (SAME AS chess.js load())
	fen = fields.join(" ");

	const check = validateFen(fen);
	if (!check.ok) { return { message: check.error }; } // "Invalid FEN: ..."
	const rows = fields[0].split("/");
	if (/[pP]/.test(rows[0] + rows[7])) { return { message: "Invalid FEN: pawns can't be on the first or last rank" }; }

	let otherSide = [...fields];
	otherSide[1] = fields[1] == "w" ? "b" : "w"; // THE SIDE THAT ISN'T MOVING
	otherSide[3] = "-";
	if (new Chess(otherSide.join(" ")).isCheck()) { return { message: "Invalid FEN: the side that isn't moving is in check" }; }

	if (new Chess(fen).isGameOver()) { return { message: "That position is already over (checkmate or a draw)" }; }
	if (fen == DEFAULT_POSITION) { return { fen: false }; } // THE STANDARD POSITION, SAVED WITHOUT A fen
	return { fen };
}

/* ---------------------------------------------------------------- */
// Start Pieces
/* ---------------------------------------------------------------- */
/**
 * @description The facing lists a new game starts with: each knight in w_knight / b_knight & each king, queen, bishop & rook in
 * w_piece / b_piece as { from: null, to: square } (hasn't moved, faces the other side). Rank 1 first, a to h, so the standard
 * position gives the same lists games always started with. Pawns aren't listed, they always face the other side
 * @param  {[string]} fen [start position]
 * @return {[object]} lists [{ w_knight, b_knight, w_piece, b_piece }]
 */
function startPieces(fen) {
	const board = new Chess(fen).board(); // 8 x 8, RANK 8 FIRST
	let lists = { w_knight: [], b_knight: [], w_piece: [], b_piece: [] };
	for (let i = board.length - 1; i >= 0; i--) { // RANK 1 FIRST
		for (let j = 0; j < board[i].length; j++) {
			const piece = board[i][j];
			if (!piece || piece.type == 'p') { continue; }
			let list = piece.type == 'n' ? lists[`${piece.color}_knight`] : lists[`${piece.color}_piece`];
			list[list.length] = { from: null, to: piece.square };
		}
	}
	return lists;
}

/* ---------------------------------------------------------------- */
// Face Move
/* ---------------------------------------------------------------- */
/**
 * @description Updates the facing lists for one move, the rules a move (validateMove) & an undo (replayMoves) share. Knights face the way
 * they last moved, kings, queens, bishops & rooks the way they last moved up or down (a sideways move keeps their from)
 * @param  {[object]} facing [{ w_knight, b_knight, w_piece, b_piece } arrays of { from, to }, changed in place]
 * @param  {[object]} move [the chess.js move: { color, piece, from, to, captured, promotion }]
 */
function faceMove(facing, move) {
	const other = move.color == 'w' ? 'b' : 'w';
	const knights = facing[`${move.color}_knight`];
	const pieces = facing[`${move.color}_piece`];

	let taken = null; // A TAKEN KNIGHT, QUEEN, BISHOP OR ROOK IS CLEARED (PAWNS AREN'T LISTED, SO EN PASSANT CHANGES NOTHING)
	if (move.captured == 'n') { taken = facing[`${other}_knight`]; }
	else if (move.captured == 'q' || move.captured == 'b' || move.captured == 'r') { taken = facing[`${other}_piece`]; }
	for (let n = 0; taken && n < taken.length; n++) {
		if (taken[n].to == move.to) { taken[n] = { from: null, to: null }; }
	}

	if (move.promotion) { // THE NEW PIECE FACES THE OTHER SIDE, IT CAME UP FROM RANK 7 (WHITE) OR 2 (BLACK)
		const list = move.promotion == 'n' ? knights : pieces;
		list[list.length] = { from: move.from, to: move.to };
	} else if (move.piece == 'n') {
		for (let n = 0; n < knights.length; n++) {
			if (knights[n].to == move.from) { knights[n] = { from: move.from, to: move.to }; }
		}
	} else if (move.piece.match(/[kqbr]/)) { // KINGS, QUEENS, BISHOPS & ROOKS FACE THE WAY THEY LAST MOVED UP OR DOWN
		for (let n = 0; n < pieces.length; n++) {
			if (pieces[n].to != move.from) { continue; }
			if (move.from[1] != move.to[1]) { pieces[n] = { from: move.from, to: move.to }; } // MOVED UP OR DOWN
			else { pieces[n].to = move.to; } // MOVED SIDEWAYS: KEEPS ITS from SO IT FACES THE SAME WAY
		}

		const rank = move.color == 'w' ? '1' : '8';
		if (move.piece == 'k' && move.from == `e${rank}` && (move.to == `g${rank}` || move.to == `c${rank}`)) { // CASTLING: THE ROOK MOVES SIDEWAYS TOO
			const rookFrom = move.to == `g${rank}` ? `h${rank}` : `a${rank}`; // KING SIDE : QUEEN SIDE
			const rookTo = move.to == `g${rank}` ? `f${rank}` : `d${rank}`;
			for (let n = 0; n < pieces.length; n++) {
				if (pieces[n].to == rookFrom) { pieces[n].to = rookTo; }
			}
		}
	}
}

/* ---------------------------------------------------------------- */
// Validates client move request
/* ---------------------------------------------------------------- */
/**
 * [Validates requested move by checking previous move, and piece movement]
 * @param  {[object]} playerData [Contains request data]
 * @param  {[object]} gameData [Contains server data]
 * @return {[object]} response [Returns the results of the processed move internally]
 */
async function validateMove(playerData, gameData) {
	let Module_chess;
	try {
		Module_chess = new Chess(gameData.game_board.S);
	} catch {
		return {
			status: 500,
			message: "Invalid board, corrupted data"
		}
	}

	try {
		const turn = Module_chess.turn();
		const playerId = turn == "w" ? gameData.white_player_id.S : gameData.black_player_id.S; // THE PLAYER WHOSE TURN IT IS
		if (playerId != playerData.player_id || Module_chess.get(playerData.move[0])?.color != turn) { // NOT THEIR TURN, OR NOT THEIR PIECE
			return {
				status: 500,
				message: "Invalid piece movement"
			}
		}

		const move = Module_chess.move({ from: playerData.move[0], to: playerData.move[1], promotion: playerData.promotion }); // MOVES THE PIECE, THROWS IF IT'S NOT LEGAL
		let facing = {};
		for (let i = 0; i < FACING_LISTS.length; i++) { facing[FACING_LISTS[i]] = JSON.parse(gameData[FACING_LISTS[i]].S); }
		faceMove(facing, move); // THE PROMOTION COMES FROM chess.js, A promotion SENT WITH ANY OTHER MOVE IS IGNORED
		for (let i = 0; i < FACING_LISTS.length; i++) { gameData[FACING_LISTS[i]].S = JSON.stringify(facing[FACING_LISTS[i]]); }

		gameData.game_board.S = Module_chess.fen(); // UPDATES GAME BOARD LOCALLY
		gameData.moves.S[gameData.moves.S.length] = move.san; // ADDS UPDATED MOVE
		gameData.prev_move.S = playerData.move
		return {
			status: 200,
			game_data: gameData,
			message: "Validated piece movement"
		}
	} catch {
		return {
			status: 500,
			message: "Invalid piece movement"
		}
	}
}

/* ---------------------------------------------------------------- */
// Start Position
/* ---------------------------------------------------------------- */
/**
 * @description The position a game started from: its set position (start_params.fen) or the standard one
 * @param  {[object]} gameData [game item]
 * @return {[string]} fen [games from before start_params started from the standard position]
 */
function startFen(gameData) {
	try { return JSON.parse(gameData.start_params?.S || "{}").fen || DEFAULT_POSITION; }
	catch { return DEFAULT_POSITION; }
}

/* ---------------------------------------------------------------- */
// Replay Moves
/* ---------------------------------------------------------------- */
/**
 * @description Plays a game's first moves again from its start position, with the facing lists from startPieces & faceMove. Only the
 * board & the current facing are saved, so this is how an earlier position is rebuilt (undoMoves)
 * @param  {[object]} gameData [game item from retrieveGame, moves.S is the array of SAN moves]
 * @param  {[number]} count [how many of the moves to play]
 * @return {[object]} replay [{ chess (the board after them, with their history), facing ({ w_knight, b_knight, w_piece, b_piece } arrays),
 * last (the last move played, a chess.js move, null for none) }], throws if a saved move can't be played
 */
function replayMoves(gameData, count) {
	const fen = startFen(gameData);
	const chess = new Chess(fen);
	let facing = startPieces(fen);
	let last = null;
	for (let i = 0; i < count; i++) {
		last = chess.move(gameData.moves.S[i]); // SAN, THROWS IF IT ISN'T LEGAL HERE
		faceMove(facing, last);
	}
	return { chess, facing, last };
}

/* ---------------------------------------------------------------- */
// Undo Moves
/* ---------------------------------------------------------------- */
/**
 * @description Takes back a game's last moves (the undo AI & friend takebacks share): the moves that are left are replayed from the
 * start position, so the board, moves, prev_move & facing lists are exactly what they were before the undone moves. Save it with
 * updateGame(game_data, the board before the undo) in dynamoDB.js, its game_board condition makes a move made meanwhile win
 * @param  {[object]} gameData [game item from retrieveGame, changed in place when it works]
 * @param  {[number]} count [moves (plies) to take back: 1 = the last move, 2 = the last move of each side]
 * @return {[object]} response [{ status, game_data, message }, nothing changes when it fails]
 */
function undoMoves(gameData, count) {
	const moves = gameData.moves.S;
	if ((gameData.state?.S || "OPEN") != "OPEN") { return { status: 500, message: "Game isn't open" }; } // GAMES FROM BEFORE state ARE OPEN
	if (!Number.isInteger(count) || count < 1) { return { status: 500, message: "Nothing to take back" }; }
	if (count > moves.length) { return { status: 500, message: "Can't take back past the start" }; }

	let kept;
	try {
		if (replayMoves(gameData, moves.length).chess.fen() != gameData.game_board.S) { return { status: 500, message: "Saved moves don't match the board" }; } // OLD OR DAMAGED DATA
		kept = replayMoves(gameData, moves.length - count);
	} catch {
		return { status: 500, message: "Saved moves can't be replayed" };
	}

	gameData.game_board.S = kept.chess.fen();
	gameData.moves.S = moves.slice(0, moves.length - count);
	gameData.prev_move.S = kept.last ? [kept.last.from, kept.last.to] : []; // THE MOVE BEFORE THE UNDONE ONES, NONE AT THE START
	for (let i = 0; i < FACING_LISTS.length; i++) { gameData[FACING_LISTS[i]].S = JSON.stringify(kept.facing[FACING_LISTS[i]]); }
	return {
		status: 200,
		game_data: gameData,
		message: `Took back ${count} move${count == 1 ? "" : "s"}`
	}
}


/* ---------------------------------------------------------------- */
// Game Result
/* ---------------------------------------------------------------- */
/**
 * @description Checks a game for the end: checkmate & the draws. The board (FEN) is enough for all but threefold repetition,
 * which needs every position since the start, so the saved moves are replayed for it (repeatedThreeTimes)
 * @param  {[object]} gameData [game item, game_board.S is the board after the last move & moves.S the SAN moves]
 * @return {[object]} result [{ winner: "w" | "b" | "draw", reason } | null while the game is still going]
 */
function gameResult(gameData) {
	const Module_chess = new Chess(gameData.game_board.S);
	if (Module_chess.isCheckmate()) { return { winner: Module_chess.turn() == "w" ? "b" : "w", reason: "checkmate" }; } // THE SIDE TO MOVE IS MATED
	if (Module_chess.isStalemate()) { return { winner: "draw", reason: "stalemate" }; }
	if (Module_chess.isInsufficientMaterial()) { return { winner: "draw", reason: "insufficient material" }; }
	if (Module_chess.isDrawByFiftyMoves()) { return { winner: "draw", reason: "fifty-move rule" }; }
	if (repeatedThreeTimes(gameData)) { return { winner: "draw", reason: "threefold repetition" }; }
	return null;
}

/**
 * @description Whether the position on the board has now come up three times (same pieces, side to move, castling rights &
 * en passant), counted by chess.js over a replay of the saved moves from the start position
 * @param  {[object]} gameData [game item]
 * @return {[boolean]} repeated [false when the saved moves can't be replayed or don't lead to the board (old or damaged data)]
 */
function repeatedThreeTimes(gameData) {
	const halfMoves = Number(gameData.game_board.S.split(" ")[4]);
	if (!(halfMoves >= 8)) { return false; } // A POSITION NEEDS 8 HALF MOVES WITHOUT A CAPTURE OR PAWN MOVE TO COME UP A THIRD TIME, NO REPLAY NEEDED
	try {
		const replay = replayMoves(gameData, gameData.moves.S.length);
		return replay.chess.fen() == gameData.game_board.S && replay.chess.isThreefoldRepetition();
	} catch {
		return false; // THE GAME GOES ON, LIKE BEFORE THREEFOLD WAS CHECKED
	}
}


module.exports = { validateMove, gameResult, checkStartFen, startPieces, undoMoves }
