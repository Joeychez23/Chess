// The status lists: what a Chess Cards view shows on the 3D board (statuses, rings, wards, a sprung trap) and the diff against the live ones
import { fileOf, rowOf } from "../index.js";

// The hover text: no client file describes a status (the catalog describes cards), so a fixed table from the engine's rules
// (cards-engine/rules.js, turn/, ctx.js capture)
export const STATUSES = {
	warded: ["Warded", "can't be captured."],
	frozen: ["Frozen", "can't move."],
	shaken: ["Shaken", "can't capture."],
	marked: ["Marked", "whoever captures it draws a move card, and its owner discards 2 random cards."],
	hexed: ["Hexed", "no card can move it."],
};
// A change to one of these is an update, not a re-create (compared as strings: siblings is a new list each sync)
const UPDATE_FIELDS = ["left", "by", "square", "slot", "slots", "siblings", "ringSlot", "ringSlots"];

// 0 = a8, the engine's order (cards-engine/board.js sqName)
function squareName(i) {
	return "abcdefgh"[i % 8] + (8 - Math.floor(i / 8));
}

function idOf(key) {
	return key.slice(0, key.lastIndexOf(":"));
}

// A version's key to its card's (cards-engine/cards/index.js baseKey)
export function baseOf(key) {
	return key.replace(/-epic$/, "");
}

// A Heavy Cavalry the fog cut its knight from (view.js scrub): it has none (pieces [] would read as a8), so no ring and no ward
export function cut(enchant) {
	return enchant.pieces.length !== 1;
}

const KNIGHT_JUMPS = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];

function knightSquares(i) {
	return KNIGHT_JUMPS
		.map(([dr, df]) => [(i >> 3) + dr, (i & 7) + df])
		.filter(([r, f]) => r >= 0 && r < 8 && f >= 0 && f < 8)
		.map(([r, f]) => r * 8 + f);
}

/**
 * @description The enchantment rings a view shows, by piece id, in view.enchant's order: Heavy Cavalry (either version) on its
 * enchanted knight (pieces[0]), Heretical Subjection on each of its bishops still its owner's bishop (one handed over loses it: the
 * engine stops moving it), Opposing Finality on its piece; only on the view's board (fog)
 * @param  {[object]} cardsView [the server's view: board.sq, enchant]
 * @return {[Map]} pieceId -> [{ s, left }]
 */
export function ringList(cardsView) {
	const rings = new Map();
	const sq = cardsView.board.sq;
	function at(id) {
		return sq.find((p) => p && p.id === id);
	}
	function add(id, s, left) {
		return rings.set(id, [...(rings.get(id) || []), { s, left: left ?? null }]);
	}
	for (const e of cardsView.enchant || []) {
		const s = baseOf(e.key);
		if ((s === "heavy-cavalry" && !cut(e)) || s === "opposing-finality") {
			if (at(e.pieces[0])) { add(e.pieces[0], s, e.left); }
		} else if (s === "heretical-subjection") {
			e.pieces.forEach((id) => {
				const p = at(id);
				if (p && p.c === e.owner && p.t === "b") { add(id, s, e.left); }
			});
		}
	}
	return rings;
}

/**
 * @description The pieces Heavy Cavalry wards in a view (the engine's canCapture rule): the owner's non-king pieces on the squares the
 * enchanted knight could move to, never the partner, while both knights are the owner's, on the board and a knight's move apart (the
 * epic version has no partner)
 * @param  {[object]} cardsView [the server's view: board.sq, enchant]
 * @return {[Set]} piece ids
 */
export function wardIds(cardsView) {
	const ids = new Set();
	const sq = cardsView.board.sq;
	for (const e of cardsView.enchant || []) {
		if (baseOf(e.key) !== "heavy-cavalry" || cut(e)) { continue; }
		const at = e.pieces.map((id) => sq.findIndex((p) => p && p.id === id));
		const knightsStand = at.every((i) => i >= 0 && sq[i].c === e.owner && sq[i].t === "n");
		if (!knightsStand || (at.length > 1 && !knightSquares(at[0]).includes(at[1]))) { continue; }
		for (const i of knightSquares(at[0])) {
			const p = sq[i];
			if (p && p.c === e.owner && p.t !== "k" && p.id !== e.pieces[1]) { ids.add(p.id); }
		}
	}
	return ids;
}

/**
 * @description Where a Trapdoor sprang between two synced views, null for none: a trapdoor entry the last view had is gone while the
 * game is on (both views: a finished one shows every trap's square). Its owner knows the square (the old entry's data.square): a spring
 * left an enemy piece Frozen on it (a drop ends the trap too, cards-engine turn/index.js drop). The other player's trap has no square in the
 * view, so it's the square of the viewer's piece newly Frozen.
 * shortcut: one spring a sync and the first newly Frozen piece; two at once would need the engine's event, fine while a trap is the only
 * thing freezing on a move. A long slide (3+ squares) can outlast Card Guy's 500 ms wait, so two answers merge into one sync (pending
 * keeps the newest): a trap played and sprung inside that window shows no snap (its statuses still do). Upgrade by diffing each view as
 * it arrives and carrying the square in pending, if that's ever seen in play
 * @param  {[object|null]} was [the last view synced]
 * @param  {[object|null]} now [the view syncing]
 * @return {[string|null]} "d5"
 */
export function springSquare(was, now) {
	if (!was || !now || was.result || now.result) { return null; }
	function traps(v) {
		return (v.enchant || []).filter((e) => baseOf(e.key) === "trapdoor");
	}
	const still = traps(now).map((e) => e.id);
	const gone = traps(was).filter((e) => !still.includes(e.id));
	function isFrozen(v, id) {
		return ((v.statuses || {})[id] || []).some((e) => e.s === "frozen");
	}
	for (const e of gone.filter((e) => e.data && e.data.square)) {
		const p = now.board.sq[rowOf(e.data.square) * 8 + fileOf(e.data.square)];
		if (p && p.c !== e.owner && isFrozen(now, p.id)) { return e.data.square; }
	}
	// Only the owner's own traps ended, none sprang: not the other player's either
	if (!gone.some((e) => !(e.data && e.data.square))) { return null; }
	const i = now.board.sq.findIndex((p) => p && p.c === now.you && isFrozen(now, p.id) && !isFrozen(was, p.id));
	return i < 0 ? null : squareName(i);
}

/**
 * @description The statuses a view shows, by "pieceId:status": a known status on a piece on the view's board (fog: a hidden piece isn't
 * there), a veiled one unless the viewer owns its piece while the game is on (the server strips that case, and sends it in a finished
 * game and to the old owner after a handover), and the ids on the board
 * @param  {[object]} cardsView [the server's view: board.sq, statuses, you, result]
 * @return {[object]} { want: Map key -> { id, s, left, by, square, slot, slots, siblings }, onBoard: Set of piece ids }
 */
export function statusList(cardsView) {
	const want = new Map();
	const onBoard = new Set();
	const all = cardsView.statuses || {};
	const rings = ringList(cardsView);
	const ward = wardIds(cardsView);
	cardsView.board.sq.forEach(function (p, i) {
		if (!p) { return; }
		onBoard.add(p.id);
		// A backup of the server's strip of the viewer's own veiled statuses: it sends the rest
		const list = (all[p.id] || []).filter((e) => STATUSES[e.s] && !(e.veiled && p.c === cardsView.you && !cardsView.result));
		// Heavy Cavalry's ward: one aura and one line with a real warded
		if (ward.has(p.id) && !list.some((e) => e.s === "warded")) { list.push({ s: "warded", left: null }); }
		const ring = rings.get(p.id) || [];
		// Concentric rings, 0 the inner
		ring.forEach((r, ringSlot) => list.push({ ...r, ringSlot, ringSlots: ring.length }));
		list.forEach((e, slot) => want.set(`${p.id}:${e.s}`, {
			id: p.id, s: e.s, left: e.left ?? null, by: e.by, square: squareName(i), slot, slots: list.length,
			siblings: list.filter((o) => o !== e).map((o) => o.s), ringSlot: e.ringSlot, ringSlots: e.ringSlots,
		}));
	});
	// The open trap: only its owner's view (a finished game's too) has its square
	for (const e of cardsView.enchant || []) {
		if (baseOf(e.key) === "trapdoor" && e.data && e.data.square) {
			want.set(`trapdoor:${e.id}`, { id: "trapdoor", s: "trapdoor", left: null, square: e.data.square });
		}
	}
	return { want, onBoard };
}

/**
 * @description What to do to the live statuses for the ones wanted now: create the new, update one whose left, by, square or slot
 * changed, swap one shown in the other mode (no burst), end the rest, with a burst when its piece is still on the board (its status
 * ended) and without when it's gone (taken, or hidden by the fog)
 * @param  {[Map]} was [key -> { mode, opts }]
 * @param  {[Map]} want [statusList's]
 * @param  {[string]} mode ["effects" or "badges"]
 * @param  {[Set]} onBoard [statusList's]
 * @return {[object]} { create: [key], update: [key], swap: [key], end: [{ key, burst }] }
 */
export function diffStatuses(was, want, mode, onBoard) {
	const plan = { create: [], update: [], swap: [], end: [] };
	for (const [key, liveStatus] of was) {
		const wanted = want.get(key);
		if (!wanted) {
			plan.end.push({ key, burst: onBoard.has(idOf(key)) });
		} else if (liveStatus.mode !== mode) {
			plan.swap.push(key);
		} else if (UPDATE_FIELDS.some((field) => String(liveStatus.opts[field]) !== String(wanted[field]))) {
			plan.update.push(key);
		}
	}
	for (const key of want.keys()) {
		if (!was.has(key)) { plan.create.push(key); }
	}
	return plan;
}
