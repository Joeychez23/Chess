/*
 *  statuses.js  --  chess cards engine
 *	Piece statuses (shaken, frozen, marked, warded, hexed) in state.statuses = { [pieceId]: [{ s, left, by }] }; left null = permanent.
 *
 */

const { pieceById } = require("./board.js");

/**
 * @description True when the piece with this id has status s.
 */
function has(state, pieceId, s) {
	const list = state.statuses && state.statuses[pieceId];
	return !!list && list.some((e) => e.s === s);
}

/**
 * @description Give status s to a piece on the board for `turns` of its owner's turns (null = permanent). The turn in progress is ctx.turn, else state.board.turn; the giver `by` defaults to it. Given during the owner's own turn before its end-of-turn tick, that turn does not count (the entry is stored `fresh` and its first tick only clears that); given after that tick (ctx.ticked, e.g. by a refill trigger), it is not fresh. A repeat replaces the old length instead of stacking. Returns false (and changes nothing) for a missing piece or a Warded king.
 */
function give(ctx, pieceId, s, turns = 3, by = ctx.turn || ctx.state.board.turn) {
	const { state } = ctx, i = pieceById(state.board, pieceId);
	if (i < 0 || (s === "warded" && state.board.sq[i].t === "k")) return false; // THE KING IS NEVER WARDED
	const list = (state.statuses[pieceId] || []).filter((e) => e.s !== s), e = { s, left: turns, by };
	const owner = state.board.sq[i].c;
	if (turns !== null && (ctx.turn || state.board.turn) === owner && ctx.ticked !== owner) e.fresh = true; // THE OWNER'S TURN IN PROGRESS DOES NOT COUNT
	list.push(e);
	state.statuses[pieceId] = list;
	ctx.emit({ type: "status", player: by, piece: pieceId, s, left: turns });
	return true;
}

/**
 * @description Remove status s from a piece, with a status-ended event if it had it and is still on the board.
 */
function clear(ctx, pieceId, s) {
	if (!has(ctx.state, pieceId, s)) return;
	const list = ctx.state.statuses[pieceId].filter((e) => e.s !== s);
	if (list.length) ctx.state.statuses[pieceId] = list;
	else delete ctx.state.statuses[pieceId];
	const b = ctx.state.board, p = b.sq[pieceById(b, pieceId)];
	if (p) ctx.emit({ type: "status-ended", player: p.c, piece: pieceId, s }); // THE OWNER ON THE BOARD, NOT THE ID; OFF THE BOARD: NO EVENT
}

/**
 * @description End of color's turn: every timed status on the pieces color owns on the board loses a turn and ends at 0; a `fresh` entry (given during this same turn) only loses its fresh mark. Works on the entries present when the tick starts: one given or replaced during the tick (by a status-ended handler) is not ticked now. Statuses of a piece no longer on the board are dropped with no event.
 */
function tick(ctx, color) {
	const { state } = ctx, snap = Object.entries(state.statuses).flatMap(([id, list]) => list.map((e) => [id, e]));
	for (const [id, e] of snap) {
		if (!(state.statuses[id] || []).includes(e)) continue; // CLEARED OR REPLACED DURING THE TICK
		const p = state.board.sq[pieceById(state.board, id)];
		if (!p) { delete state.statuses[id]; continue; } // BACKSTOP: CAPTURE HANDLING CLEARS THESE FIRST
		if (p.c !== color || e.left === null) continue;
		if (e.fresh) delete e.fresh;
		else if (--e.left <= 0) clear(ctx, id, e.s);
	}
}

module.exports = { has, give, clear, tick };
