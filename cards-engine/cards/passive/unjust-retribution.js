/*
 *  unjust-retribution.js  --  chess cards engine
 *	Passive: one of your pieces is captured on the opponent's half of the board; the opponent's next turn is skipped.
 *
 */

const other = (c) => (c === "w" ? "b" : "w");

module.exports = {
	key: "unjust-retribution", kind: "passive", name: "Unjust Retribution", skulls: 0, rarity: "rare",
	text: "One of your pieces is captured on the opponent's half of the board → skip the opponent's next turn.",
	on: {
		/**
		 * @description One of owner's pieces captured by the opponent (a piece or a card; a removal by owner's own side is not a capture) on the opponent's half (ev.sq on ranks 5-8 for a White owner, 1-4 for Black): the opponent loses their next turn (ctx.skipTurn). En passant takes a pawn on its own half, so it never fires this.
		 */
		capture(ctx, owner, ev) {
			if (ev.c !== owner || ev.player === owner || !ev.sq) return false;
			const rank = Number(ev.sq[1]);
			if (owner === "w" ? rank < 5 : rank > 4) return false; // THE OWNER'S OWN HALF
			ctx.skipTurn(other(owner), 1);
			return true;
		},
	},
};
