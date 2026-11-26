/*
 *  boardShow.js  --  chess frontend
 *	Chess Cards Board Show
 *	What a card route's answer plays on the board, as steps in the order of its events (Overwatch's shot: the move, the take,
 *	the bishop out and back), and the step player that flow.js runs every answer's steps through (these and duelShow.js's),
 *	one after another. No DOM, so the client tests can require it (client/test/boardShow.test.js)
 *
 */

/* ---------------------------------------------------------------- */
// Global
/* ---------------------------------------------------------------- */
const { sqIndex } = require("../../../../../cards-engine/board.js"); // the engine's own square index (a8 = 0), as in flow.js

// A card's ranged shot: the capture event names the shooter's square (Overwatch)
function isShot(event) {
	return event.type === "capture" && typeof event.from === "string" && typeof event.sq === "string";
}

// A card removes a piece for its own side (a forfeit: All or Nothing's lost hand), never a take by the opponent
function isRemoval(event) {
	return event.type === "capture" && event.player === event.c && typeof event.sq === "string";
}

/* ---------------------------------------------------------------- */
// Steps
/* ---------------------------------------------------------------- */
/**
 * @description The board's steps for an answer, in the order of its events, when it has one the drawn move can't show
 * (Overwatch's shot, a removal, a handover):
 * - each move (from and to; a move out of the fog has no from, nothing of it was on the board) slides or hops, with its own
 *   capture named (taken: the square the event says, en passant the pawn's, so nothing is guessed from the board) and a
 *   promotion on arrival;
 * - Swap's two move events (back to back, trading squares) are one swap, neither piece taken;
 * - a shot takes the piece on its square, then the shooter goes out to that square and back to its own. The shooter is always
 *   a bishop. One not in the previous view (hidden by a Fog of War) shows for the shot, and is gone
 *   after unless the answer's view shows it;
 * - a removal by the piece's own side (a forfeit: All or Nothing's lost hand) topples it, unless the previous view hides it
 *   (a Fog of War: it plays nothing);
 * - Opposing Finality's handover slides the piece to its square on the receiving side, in its new colour (c);
 * - then the answer's view goes on the board and the table (set).
 * Nothing otherwise, also on a load (no previous view): the answer takes the drawn move's path. A lost duel's removal is the
 * duel's answer (duelShow.js), never asked here. A new kind of step is one more case here and in three/motion.js playBoardStep
 * @param  {[object|null]} prev [the view before the answer, null on a load]
 * @param  {[object]} view [the answer's view]
 * @param  {[array]} events [the answer's events]
 * @return {[array]} steps [{ op: "move", from, to, taken?, promotion? } | { op: "swap", a, b } | { op: "take", square } |
 * { op: "out" | "back", from, to, piece: { c, t } | null } | { op: "topple", square } | { op: "handover", from, to, c } |
 * { op: "set" }, set last]
 */
function boardSteps(prev, view, events) {
	const list = (events || []).filter((event) => event && typeof event.type === "string");
	if (!prev) { return []; }
	const steps = [];
	for (const [index, event] of list.entries()) {
		const last = steps[steps.length - 1];
		const before = list[index - 1];
		// The event before this one made the last step, a move
		const follows = last && last.op === "move" && before && before.type === "move" && before.from && before.to;
		const isMove = event.type === "move" && event.from && event.to;
		if (isMove && follows && last.from === event.to && last.to === event.from) {
			// Swap: as two chess moves, the first would take the other piece
			steps[steps.length - 1] = { op: "swap", a: last.from, b: last.to };
		}
		else if (isMove) { steps.push({ op: "move", from: event.from, to: event.to }); }
		else if (isRemoval(event)) {
			// Never the move's own capture, even right after it (that one is the mover's). A piece handed over in this answer
			// stands where it landed, not in prev. A hidden one has no mesh: playBoardStep plays nothing
			const handedOver = steps.some((step) => step.op === "handover" && step.to === event.sq);
			if (prev.board.sq[sqIndex(event.sq)] || handedOver) { steps.push({ op: "topple", square: event.sq }); }
		}
		else if (event.type === "capture" && !isShot(event) && follows) {
			// The move's own, right after it: a fog-hidden piece taken isn't on the board, and the en passant guess would take
			// the one beside it
			last.taken = event.sq;
		}
		else if (event.type === "promote" && last && last.op === "move" && /^[qrbn]$/.test(event.t)) {
			last.promotion = event.t; // the move's own: the pawn turns into it on arrival
		}
		else if (isShot(event)) {
			const piece = prev.board.sq[sqIndex(event.from)] ? null : { c: event.player, t: "b" };
			steps.push(
				{ op: "take", square: event.sq },
				{ op: "out", from: event.from, to: event.sq, piece },
				// The view shows the shooter (the game ended, the fog lifted): it stays
				{ op: "back", from: event.sq, to: event.from, piece: view.board.sq[sqIndex(event.from)] ? null : piece },
			);
		}
		else if (event.type === "handover" && event.from && event.to) {
			// A fog-hidden piece handed over has no mesh on from: playBoardStep plays nothing
			steps.push({ op: "handover", from: event.from, to: event.to, c: event.player });
		}
	}
	// Only moves: the drawn move's path, as before
	return steps.some((step) => step.op !== "move" && step.op !== "swap") ? [...steps, { op: "set" }] : [];
}

/**
 * @description Plays an answer's steps one after another, each once the one before has ended (run's promise: no timer cuts
 * an animation short). A step that throws skips the steps left before the answer's set: the set and the steps after it
 * (a duel's trailing deal or end) still run, so the answer's view always lands. The first error is thrown once they have run
 * @param  {[array]} steps [boardSteps' or duelSteps']
 * @param  {[function]} run [(step, i) => a promise for the step's end, or nothing for one done at once]
 * @return {[Promise<void>]}
 */
async function playSteps(steps, run) {
	const set = steps.findIndex((step) => step.op === "set");
	let failed = null;
	for (const [i, step] of steps.entries()) {
		if (failed && i < set) { continue; }
		try { await run(step, i); } catch (err) { failed = failed || err; }
	}
	if (failed) { throw failed; }
}

module.exports = { boardSteps, playSteps };
