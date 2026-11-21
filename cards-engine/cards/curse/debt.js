/*
 *  debt.js  --  chess cards engine
 *	Curse: after 3 turns, discard 2 cards unless you've captured since. Clear: capture a piece.
 *
 */

module.exports = {
	key: "debt", kind: "curse", name: "Debt", rarity: "uncommon",
	text: "After 3 turns, discard 2 cards unless you've captured since. Clear: capture a piece.",
	/**
	 * @description left: the holder's turns still to pass before it comes due.
	 */
	make: () => ({ left: 3 }),
	on: {
		/**
		 * @description Its holder captures an enemy piece (a chess move or a card; ev.player !== ev.c: a removal is not a capture): it is paid and leaves through ctx.clearCurse. Fires.
		 */
		capture(ctx, owner, ev, src) {
			if (ev.player !== owner || ev.c === owner) return false;
			ctx.clearCurse(owner, src.card);
			return true;
		},
		/**
		 * @description At each start of its holder's turn one of the 3 turns passes (left counts down); at the start of the 4th it comes due: 2 random cards discarded (ctx.discardRandom: move, active or passive, never a curse; the King card only under Hollow Crown), then it leaves through ctx.clearCurse. Fires then.
		 */
		"turn-start"(ctx, owner, ev, src) {
			if (ev.player !== owner || --src.card.left >= 0) return false;
			ctx.discardRandom(owner, 2);
			ctx.clearCurse(owner, src.card);
			return true;
		},
	},
};
