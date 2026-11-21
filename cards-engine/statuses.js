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
 * @description Give status s to a piece on the board for `turns` of its owner's turns (null = permanent). The turn in progress is ctx.turn, else state.board.turn; the giver `by` defaults to it. Given during the owner's own turn before its end-of-turn tick, that turn does not count (the entry is stored `fresh` and its first tick only clears that); given after that tick (ctx.ticked, e.g. by a refill trigger), it is not fresh. A Mark given on a Mark an enchantment owns (claimMark) is recorded in that entry: a permanent one makes it "kept", a timed one raises the turns to put back. A repeat never stacks and never shortens: a longer or permanent one replaces the old entry; one no longer than the entry already there (permanent, or as many turns left counting a fresh turn) leaves it unchanged with no event and returns true. Returns false (and changes nothing) for a missing piece or a Warded king.
 */
function give(ctx, pieceId, s, turns = 3, by = ctx.turn || ctx.state.board.turn) {
	const { state } = ctx, i = pieceById(state.board, pieceId);
	if (i < 0 || (s === "warded" && state.board.sq[i].t === "k")) return false; // THE KING IS NEVER WARDED
	if (s === "marked") for (const x of state.enchant || []) { const m = x.data && x.data.marks; if (m && pieceId in m && m[pieceId] !== "kept") m[pieceId] = turns === null ? "kept" : Math.max(m[pieceId] || 0, turns); } // A MARK ON A CLAIMED ONE: ITS OWNER RECORDS IT, SO THE RELEASE DOESN'T DROP IT
	const list = (state.statuses[pieceId] || []).filter((e) => e.s !== s), e = { s, left: turns, by };
	const owner = state.board.sq[i].c;
	if (turns !== null && (ctx.turn || state.board.turn) === owner && ctx.ticked !== owner) e.fresh = true; // THE OWNER'S TURN IN PROGRESS DOES NOT COUNT
	const old = (state.statuses[pieceId] || []).find((x) => x.s === s), len = (x) => x.left + (x.fresh ? 1 : 0);
	if (old && turns !== null && (old.left === null || len(old) >= len(e))) return true; // A SHORTER ONE NEVER CUTS A LONGER ONE (SWAP'S 1-TURN MARK ON A PERMANENT ONE)
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
	const veiled = ctx.state.statuses[pieceId].some((e) => e.s === s && e.veiled), list = ctx.state.statuses[pieceId].filter((e) => e.s !== s);
	if (list.length) ctx.state.statuses[pieceId] = list;
	else delete ctx.state.statuses[pieceId];
	const b = ctx.state.board, p = b.sq[pieceById(b, pieceId)];
	if (p) ctx.emit(veiled ? { type: "status-ended", player: p.c, piece: pieceId, s, veiled } : { type: "status-ended", player: p.c, piece: pieceId, s }); // THE OWNER ON THE BOARD, NOT THE ID; OFF THE BOARD: NO EVENT
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

/**
 * @description An enchantment (entry) needs the piece Marked while it lasts: the Mark becomes permanent, and entry.data.marks[pieceId] records what to put back: null (no Mark before: the entry owns it), "kept" (a permanent Mark already there, another card's), or the turns a timed Mark had left.
 */
function claimMark(ctx, entry, pieceId) {
	const e = (ctx.state.statuses[pieceId] || []).find((x) => x.s === "marked");
	if (!e || e.left !== null) give(ctx, pieceId, "marked", null); // BEFORE THE RECORD: give WOULD TAKE THIS MARK FOR ONE GIVEN ON TOP
	entry.data.marks = { ...entry.data.marks, [pieceId]: e ? (e.left === null ? "kept" : e.left) : null };
}

/**
 * @description The entry no longer needs the piece's Mark (its end, a switch): a "kept" Mark is left alone; one it owns passes to another live entry that kept it (that entry now owns it), else it is cleared and a timed Mark it took over comes back with the turns it had left. A Mark already gone (Cleanse, a removal, a capture) is neither handed on nor put back. So a card never clears a Mark another card or status still needs.
 */
function releaseMark(ctx, entry, pieceId) {
	const marks = entry.data.marks || {}, back = marks[pieceId];
	delete marks[pieceId];
	if (back === "kept" || !has(ctx.state, pieceId, "marked")) return; // GONE ON PURPOSE (CLEANSE, A REMOVAL'S PRE-CLEAR, A CAPTURE): NOTHING HANDED ON OR PUT BACK
	const heir = ctx.state.enchant.find((x) => x.id !== entry.id && x.data && x.data.marks && x.data.marks[pieceId] === "kept");
	if (heir) return void (heir.data.marks[pieceId] = back);
	clear(ctx, pieceId, "marked");
	if (typeof back === "number") give(ctx, pieceId, "marked", back);
}

module.exports = { has, give, clear, tick, claimMark, releaseMark };
