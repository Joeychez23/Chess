/*
 *  bleeding-hand.js  --  chess cards engine
 *	Passive: the opponent captures; they discard a random card.
 *
 */

module.exports = {
	key: "bleeding-hand", kind: "passive", name: "Bleeding Hand", skulls: 0, rarity: "common",
	text: "Opponent captures → they discard a random card.",
	on: {
		/**
		 * @description Any capture of owner's piece by the opponent (a chess move or a card; the opponent removing its own piece is not a capture): they discard a random move, active or passive card (never the King card or a curse).
		 */
		capture(ctx, owner, ev) {
			if (ev.player === owner || ev.c === ev.player) return false; // A REMOVAL IS NOT A CAPTURE
			ctx.discardRandom(ev.player, 1);
			return true;
		},
	},
};
