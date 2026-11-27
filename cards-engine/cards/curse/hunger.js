/*
 *  hunger.js  --  chess cards engine
 *	Curse: no capture within 2 turns; you lose every 3rd turn. Clear: capture a piece.
 *
 */

const { inCheck } = require("../../rules.js");

module.exports = {
	key: "hunger", kind: "curse", name: "Hunger", rarity: "rare",
	text: "No capture within 2 turns → you lose your 3rd turn, and every 3rd turn after it. Not while you are in check with no King skull. Clear: capture a piece.",
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
		 * @description At each start of its holder's turn one of the 2 turns passes (left counts down); at the start of the 3rd it comes due: that turn is lost (ctx.skipTurn: turn.startTurn skips it right after this event, or, in check, voids the loss for a King skull), in check with no King skull, or with the King card gone, no turn is taken (the king would be taken: user ruling C8) and nothing fires; and it stays, due again every 3rd turn (user ruling 2026-11-25: was a random pawn removed). Fires.
		 */
		"turn-start"(ctx, owner, ev, src) {
			if (ev.player !== owner || --src.card.left >= 0) return false;
			src.card.left = 2; // THE NEXT 2 TURNS ARE PLAYED, THE 3RD IS LOST AGAIN
			const p = ctx.state.players[owner];
			if (inCheck(ctx.state, owner) && !(p.king && p.kingSkulls > 0)) return false; // NO SKULL TO VOID THE LOSS: THE KING WOULD BE TAKEN, SO NO TURN IS TAKEN (USER RULING C8, 2026-11-25)
			ctx.skipTurn(owner, 1);
			return true;
		},
	},
};
