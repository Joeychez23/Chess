/*
 *  pawn-storm.js  --  chess cards engine
 *	Passive: you promote a pawn; draw 2 cards.
 *
 */

module.exports = {
	key: "pawn-storm", kind: "passive", name: "Pawn Storm", skulls: 0, rarity: "common",
	text: "You promote a pawn → draw 2 cards.",
	on: {
		/**
		 * @description Owner promotes a pawn (a promotion move, Conscription, or a card duel's first upgrade of a pawn, which is to a knight or bishop; a duel upgrade to a rook or queen is of a knight, bishop or rook): owner draws 2 move cards (a plain "draw a card").
		 */
		promote(ctx, owner, ev) {
			const d = ctx.state.duel;
			if (ev.player !== owner || (d && d.piece === ev.piece && !"nb".includes(ev.t))) return false;
			ctx.draw(owner, 2);
			return true;
		},
	},
};
