/*
 *  hunger.js  --  chess cards engine
 *	Curse: no capture within 2 turns; a random pawn of yours is removed. Clear: capture a piece.
 *
 */

const statuses = require("../../statuses.js");

module.exports = {
	key: "hunger", kind: "curse", name: "Hunger", rarity: "rare",
	text: "No capture within 2 turns → a random pawn of yours is removed. Clear: capture a piece.",
	/**
	 * @description left: the holder's turns still to pass before it comes due.
	 */
	make: () => ({ left: 2 }),
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
		 * @description At each start of its holder's turn one of the 2 turns passes (left counts down); at the start of the 3rd it comes due: a random pawn of theirs (state.rng) is removed (a removal, as a forfeit: Marked cleared first so it pays no one, then ctx.capture by its own side), and it stays, due again 2 turns later. Fires when a pawn goes; with none left nothing happens.
		 */
		"turn-start"(ctx, owner, ev, src) {
			if (ev.player !== owner || --src.card.left >= 0) return false;
			src.card.left = 1; // THIS TURN IS THE FIRST OF THE NEXT 2: ITS COUNTDOWN ALREADY RAN
			const sq = ctx.state.board.sq, pawns = sq.filter((q) => q && q.c === owner && q.t === "p");
			if (!pawns.length) return false;
			const id = ctx.rng.pick(pawns).id;
			statuses.clear(ctx, id, "marked");
			ctx.capture(owner, id);
			return true;
		},
	},
};
