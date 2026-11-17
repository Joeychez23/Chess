/*
 *  reinforcements.js  --  chess cards engine
 *	Passive: your pawn is captured; draw an extra card.
 *
 */

module.exports = {
	key: "reinforcements", kind: "passive", name: "Reinforcements", skulls: 0, rarity: "common",
	text: "Your pawn is captured → draw an extra card.",
	on: {
		/**
		 * @description One of owner's pawns captured by the opponent (by a piece or a card; a removal by owner's own side is not a capture): owner draws a move card (a plain "draw a card").
		 */
		capture(ctx, owner, ev) {
			if (ev.c !== owner || ev.player === owner || ev.t !== "p") return false; // A REMOVAL IS NOT A CAPTURE
			ctx.draw(owner, 1);
			return true;
		},
	},
};
