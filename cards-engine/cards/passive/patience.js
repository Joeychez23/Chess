/*
 *  patience.js  --  chess cards engine
 *	Passive: 3 turns in a row without capturing; draw an active card.
 *
 */

const hand = require("../../hand.js");

module.exports = {
	key: "patience", kind: "passive", name: "Patience", skulls: 0, rarity: "common",
	text: "3 turns in a row without capturing → draw an active card.",
	on: {
		/**
		 * @description card.calm counts owner's turns in a row without capturing, from owner's first turn after the placement turn (set to 0 when it starts; a lost turn counts). The opponent's turn starting ends one of owner's turns: the third in a row fires it, and owner draws an active card (above the 1-active slot; lost over the cap of 3).
		 */
		"turn-start"(ctx, owner, ev, src) {
			const c = src.card;
			if (ev.player === owner) { if (c.calm === undefined) c.calm = 0; return false; }
			if (c.calm === undefined || ++c.calm < 3) return false;
			hand.drawCard(ctx, owner, "active");
			return true;
		},
		/**
		 * @description Owner captures (ev.player !== ev.c) once the count runs: it starts again, the turn of the capture not counting (one made out of turn: from 0, so owner's next capture-free turn counts).
		 */
		capture(ctx, owner, ev, src) {
			if (ev.player === owner && ev.c !== owner && src.card.calm !== undefined) src.card.calm = ctx.turn === owner ? -1 : 0; // IN owner'S TURN: THAT TURN COUNTS 0; OUT OF TURN (OVERWATCH, RETALIATION): owner'S NEXT TURN COUNTS
			return false;
		},
	},
};
