/*
 *  spite.js  --  chess cards engine
 *	Passive: your queen is captured; the opponent's move cards are thrown out and redrawn. Debuff: you lose your next active card.
 *
 */

const hand = require("../../hand.js");

const other = (c) => (c === "w" ? "b" : "w");

module.exports = {
	key: "spite", kind: "passive", name: "Spite", skulls: 1, rarity: "common",
	text: "Your queen is captured → the opponent's move cards are thrown out and redrawn. Debuff: you also lose your next active card.",
	on: {
		/**
		 * @description One of owner's queens captured by the opponent (a removal by owner's own side is not a capture): the opponent's move cards are thrown out and as many redrawn (a redraw event, then the draws); then owner's next active card (the first held) is discarded, if owner holds one.
		 */
		capture(ctx, owner, ev) {
			if (ev.c !== owner || ev.player === owner || ev.t !== "q") return false; // A REMOVAL IS NOT A CAPTURE
			const opp = other(owner), o = ctx.state.players[opp], n = o.moves.length, p = ctx.state.players[owner];
			for (const c of o.moves) hand.toPile(o, c, true); // THROWN OUT: TO THE DISCARD PILE, FACE DOWN
			o.moves = [];
			ctx.emit({ type: "redraw", player: opp });
			ctx.draw(opp, n);
			if (p.actives.length) hand.discard(ctx, owner, p.actives[0].id);
			return true;
		},
	},
};
