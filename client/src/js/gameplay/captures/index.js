/*
 *  index.js  --  chess frontend
 *	Captures
 *	The pieces taken to reach the board's position, worked out from the game's move history (not board counts, so a promoted
 *	piece is taken as what it became). The 3D room lays them out as piles on the desk. No page state
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */
const { Chess, DEFAULT_POSITION } = require("chess.js"); // SAME VERSION AS THE SERVER

/* ---------------------------------------------------------------- */
// Position Key
/* ---------------------------------------------------------------- */
/**
 * @description Two positions are the same when their first four FEN fields match (pieces, side to move, castling, en passant)
 * @param  {[string]} fen
 * @return {[string]} key
 */
function positionKey(fen) {
	return String(fen).split(" ").slice(0, 4).join(" ");
}

/* ---------------------------------------------------------------- */
// Taken Piece
/* ---------------------------------------------------------------- */
/**
 * @description The piece a move took
 * @param  {[object]} move [a chess.js move]
 * @return {[object|null]} piece [{ type, color } of the taken piece, null when nothing was taken]
 */
function takenBy(move) {
	return move.captured ? { type: move.captured, color: move.color === "w" ? "b" : "w" } : null;
}

/* ---------------------------------------------------------------- */
// Replay Cache
/* ---------------------------------------------------------------- */
// THE LAST REPLAY, KEPT SO THE NEXT CALL ONLY PLAYS THE MOVES ADDED SINCE: { start, chess, sans, keys, counts, taken, failed }
// sans = THE MOVES PLAYED, keys[i] / counts[i] = THE POSITION KEY & HOW MANY CAPTURES AFTER i PLIES (0 = THE START), failed = THE MOVE THAT
// COULDN'T BE PLAYED NEXT (null WHEN NONE). IT IS ALWAYS THE REPLAY OF A PREFIX OF THE LAST MOVES GIVEN
let cache = null;

/**
 * @description A cache holding the start position and nothing played
 * @param  {[string]} start [the start FEN]
 * @return {[object|null]} cache [null when the start position is damaged]
 */
function freshCache(start) {
	let chess;
	try { chess = new Chess(start); } catch { return null; }
	return { start, chess, sans: [], keys: [positionKey(chess.fen())], counts: [0], taken: [], failed: null };
}

/**
 * @description Brings the cache to the replay of these moves: plays only the new ones when they extend what is cached, else starts over.
 * A move that can't be played stops the replay (and is remembered, so it isn't tried again)
 * @param  {[array]} moves [the game's SAN moves]
 * @param  {[string]} start [the start FEN]
 * @return {[object|null]} cache [null when the start position is damaged]
 */
function replay(moves, start) {
	const reusable = cache && cache.start === start && cache.sans.length <= moves.length && cache.sans.every((san, i) => san === moves[i]);
	if (!reusable) { cache = freshCache(start); }
	if (!cache) { return null; }
	const state = cache;
	if (state.failed !== null && moves[state.sans.length] === state.failed) { return state; } // SAME UNPLAYABLE MOVE AS LAST TIME
	state.failed = null;
	for (let i = state.sans.length; i < moves.length; i++) {
		let played;
		try { played = state.chess.move(moves[i]); } catch { state.failed = moves[i]; break; } // CAN'T BE PLAYED: STOP HERE
		const piece = takenBy(played);
		if (piece) { state.taken.push(piece); }
		state.sans.push(moves[i]);
		state.keys.push(positionKey(state.chess.fen()));
		state.counts.push(state.taken.length);
	}
	return state;
}

/* ---------------------------------------------------------------- */
// Captures At
/* ---------------------------------------------------------------- */
/**
 * @description The pieces taken to reach the board's position, in capture order. Replays the moves (only the ones added since the last call)
 * & keeps the captures after each ply. A move that can't be played stops the replay there. If a replayed position is the board's, its
 * captures count; else if one legal move from the last replayed position reaches the board, the captures include that move's; else all the
 * replayed captures count. Never throws
 * @param  {[array]} moves [the game's SAN moves]
 * @param  {[string|null]} startFen [a set position's FEN, blank = the standard position]
 * @param  {[string]} fen [the board's FEN]
 * @return {[array]} taken [{ type: "p"|"n"|"b"|"r"|"q", color: "w"|"b" } of each taken piece, color is the taken piece's. A new array each call]
 */
function capturesAt(moves, startFen, fen) {
	const state = replay(Array.isArray(moves) ? moves : [], startFen || DEFAULT_POSITION);
	if (!state) { return []; } // A DAMAGED START POSITION
	const target = positionKey(fen);
	const copy = (count) => state.taken.slice(0, count).map((piece) => ({ ...piece }));
	const at = state.keys.indexOf(target); // THE FIRST TIME THE BOARD'S POSITION CAME UP: A CAPTURE CAN'T SIT BETWEEN TWO EQUAL POSITIONS
	if (at !== -1) { return copy(state.counts[at]); }
	for (const move of state.chess.moves({ verbose: true })) { // THE BOARD IS ONE MOVE AHEAD OF THE LIST
		state.chess.move(move);
		const reached = positionKey(state.chess.fen()) === target;
		state.chess.undo();
		if (reached) {
			const piece = takenBy(move);
			return piece ? [...copy(state.taken.length), piece] : copy(state.taken.length);
		}
	}
	return copy(state.taken.length);
}


module.exports = { capturesAt };
