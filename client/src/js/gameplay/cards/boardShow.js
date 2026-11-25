/*
 *  boardShow.js  --  chess frontend
 *	Chess Cards Board Show
 *	What a card route's answer plays on the board as steps, in the order of its events (Overwatch's shot: the move, the take, the bishop out & back), & the step player flow.js
 *	shows every answer's steps with (these & duelShow.js's), one after another. No DOM, the client tests require it (client/test/boardShow.test.js)
 *
 */

const { sqIndex } = require("../../../../../cards-engine/board.js"); // THE ENGINE'S OWN SQUARE INDEX (a8 = 0), AS flow.js READS THE VIEW'S BOARD

const shot = (e) => e.type === "capture" && typeof e.from === "string" && typeof e.sq === "string"; // A CARD'S RANGED SHOT: THE CAPTURE EVENT NAMES THE SHOOTER'S SQUARE (OVERWATCH)
const removal = (e) => e.type === "capture" && e.player === e.c && typeof e.sq === "string"; // A CARD REMOVES A PIECE FOR ITS OWN SIDE (A FORFEIT: ALL OR NOTHING'S LOST HAND): NEVER A TAKE BY THE OPPONENT

/**
 * @description The board's steps for an answer, in the order of its events, when it has one the drawn move can't show (Overwatch's shot, a removal, a handover): each move (from & to: a move out
 * of the fog has no from, nothing of it was on the board) slides or hops, its own capture named (taken: the square the event says, en passant the pawn's, so nothing is guessed from the board), a
 * promotion on arrival; Swap's two move events (back to back, trading squares) are one swap, neither piece taken; a shot takes the piece on its square, then the shooter goes out to that square &
 * back to its own (piece: a shooter not in the previous view, hidden by a Fog of War, shows for the shot, user ruling 2026-11-23, & is gone after unless the answer's view shows it; the shooter is
 * always a bishop); a removal by the piece's own side (a forfeit: All or Nothing's lost hand) topples it, unless the previous view hides it (a Fog of War: it plays nothing, controller
 * ruling 2026-11-23); Opposing Finality's handover slides the piece to its square on the receiving side in its new colour (c); then the answer's view on the board & the table (set). Nothing
 * otherwise, also on a load (no previous view): the answer takes the drawn move's path. A lost duel's removal is the duel's answer (duelShow.js), never asked here. A new kind of step is one
 * more case here & in three/motion.js playBoardStep
 * @param  {[object|null]} prev [the view before the answer, null on a load]
 * @param  {[object]} view [the answer's view]
 * @param  {[array]} events [the answer's events]
 * @return {[array]} steps [{ op: "move", from, to, taken?, promotion? } | { op: "swap", a, b } | { op: "take", square } | { op: "out" | "back", from, to, piece: { c, t } | null } |
 * { op: "topple", square } | { op: "handover", from, to, c } | { op: "set" }, set last]
 */
function boardSteps(prev, view, events) {
	const list = (events || []).filter((e) => e && typeof e.type === "string");
	if (!prev) { return []; }
	const steps = [];
	for (const [k, e] of list.entries()) {
		const last = steps[steps.length - 1], before = list[k - 1];
		const follows = last && last.op === "move" && before && before.type === "move" && before.from && before.to; // THE EVENT BEFORE THIS ONE MADE THE LAST STEP, A MOVE
		if (e.type === "move" && e.from && e.to && follows && last.from === e.to && last.to === e.from) { steps[steps.length - 1] = { op: "swap", a: last.from, b: last.to }; } // SWAP: AS TWO CHESS MOVES THE FIRST WOULD TAKE THE OTHER PIECE
		else if (e.type === "move" && e.from && e.to) { steps.push({ op: "move", from: e.from, to: e.to }); }
		else if (removal(e)) { if (prev.board.sq[sqIndex(e.sq)] || steps.some((s) => s.op === "handover" && s.to === e.sq)) { steps.push({ op: "topple", square: e.sq }); } } // NOT THE MOVE'S OWN CAPTURE EVEN RIGHT AFTER IT (THAT ONE IS THE MOVER'S). A PIECE HANDED OVER IN THIS ANSWER STANDS WHERE IT LANDED, NOT IN prev (HIDDEN: NO MESH, playBoardStep PLAYS NOTHING)
		else if (e.type === "capture" && !shot(e) && follows) { last.taken = e.sq; } // THE MOVE'S OWN, RIGHT AFTER IT: A FOG-HIDDEN PIECE TAKEN ISN'T ON THE BOARD, THE e.p. GUESS WOULD TAKE THE ONE BESIDE IT
		else if (e.type === "promote" && last && last.op === "move" && /^[qrbn]$/.test(e.t)) { last.promotion = e.t; } // THE MOVE'S OWN: THE PAWN TURNS INTO IT ON ARRIVAL
		else if (shot(e)) {
			const piece = prev.board.sq[sqIndex(e.from)] ? null : { c: e.player, t: "b" };
			steps.push({ op: "take", square: e.sq }, { op: "out", from: e.from, to: e.sq, piece }, { op: "back", from: e.sq, to: e.from, piece: view.board.sq[sqIndex(e.from)] ? null : piece }); // THE VIEW SHOWS IT (THE GAME ENDED, THE FOG LIFTED): IT STAYS
		}
		else if (e.type === "handover" && e.from && e.to) { steps.push({ op: "handover", from: e.from, to: e.to, c: e.player }); } // A FOG-HIDDEN PIECE HANDED OVER HAS NO MESH ON from: playBoardStep PLAYS NOTHING
	}
	return steps.some((s) => s.op !== "move" && s.op !== "swap") ? [...steps, { op: "set" }] : []; // ONLY MOVES: THE DRAWN MOVE'S PATH, AS BEFORE
}

/**
 * @description Plays an answer's steps one after another, each once the one before has ended (run's promise: no timer cuts an animation short). A step that throws skips the steps left before
 * the answer's set: the set & the steps after it (a duel's trailing deal or end) still run, so the answer's view always lands; the first error is thrown once they have run
 * @param  {[array]} steps [boardSteps' or duelSteps']
 * @param  {[function]} run [(step, i) => a promise for the step's end, or nothing for one done at once]
 * @return {[Promise<void>]}
 */
async function playSteps(steps, run) {
	const set = steps.findIndex((s) => s.op === "set");
	let failed = null;
	for (const [i, step] of steps.entries()) {
		if (failed && i < set) { continue; }
		try { await run(step, i); } catch (err) { failed = failed || err; }
	}
	if (failed) { throw failed; }
}

module.exports = { boardSteps, playSteps };
