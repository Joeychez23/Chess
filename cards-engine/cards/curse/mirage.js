/*
 *  mirage.js  --  chess cards engine
 *	Curse: takes the place of one of your move cards, with a random type; playing it wastes your turn. Passable: capture an enemy piece while holding it to send it back. Fires once, then discarded.
 *
 */

const other = (c) => (c === "w" ? "b" : "w");

/**
 * @description An id no card holds, taking no number from nextId: "m<nextId>.<i>" (a "c" id comes when it enters the hand).
 */
function waitingId(state) {
	const held = new Set(["w", "b"].flatMap((c) => state.players[c].curses.map((x) => x.id)));
	let i = 0;
	while (held.has("m" + state.nextId + "." + i)) i++;
	return "m" + state.nextId + "." + i;
}

module.exports = {
	key: "mirage", kind: "curse", name: "Mirage", rarity: "uncommon",
	text: "Takes the place of one of your move cards, with a random type; playing it wastes your turn. Passable: capture an enemy piece while holding it to send it back. Fires once, then discarded.",
	/**
	 * @description A given Mirage waits (waiting: true, its own id: no number from nextId, so nothing in its holder's view shows it) until its holder's next refill, where, after the real draws, it takes over one random held move card (old or new): that card's id and piece type, with no event (hand.drawMoves); at every later refill it trades id and piece type with a random held move card (hand.refill). piece: a type `to` has on the board now (state.rng; "p" with only a king), so the giver sees a valid card.
	 */
	make(ctx, to) {
		const left = ctx.state.board.sq.filter((q) => q && q.c === to && q.t !== "k").map((q) => q.t);
		return { id: waitingId(ctx.state), piece: left.length ? ctx.rng.pick(left) : "p", waiting: true };
	},
	/**
	 * @description A move action under its id (turn.js lists one for each move a real card of its type has, never in check): nothing moves, the turn is used, and it leaves through ctx.clearCurse with a curse-fired event.
	 */
	act(ctx, player, a, src) {
		ctx.clearCurse(player, src.card);
		ctx.emit({ type: "curse-fired", player, card: src.card });
	},
	on: {
		/**
		 * @description Passable: its holder captures an enemy piece (ev.player !== ev.c) while it is in the hand (not waiting): it leaves through ctx.clearCurse and goes back to the opponent as a new waiting Mirage through ctx.giveCurse (the limit holds, and the opponent may already hold a Mirage: refused, it is simply gone; no wait started). Fires.
		 */
		capture(ctx, owner, ev, src) {
			if (ev.player !== owner || ev.c === owner || src.card.waiting) return false;
			ctx.clearCurse(owner, src.card);
			ctx.giveCurse(other(owner), "mirage", owner, { wait: false });
			return true;
		},
	},
};
