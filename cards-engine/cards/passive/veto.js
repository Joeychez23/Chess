/*
 *  veto.js  --  chess cards engine
 *	Passive: the opponent plays an active card; it is cancelled and both cards are discarded.
 *
 */

module.exports = {
	key: "veto", kind: "passive", name: "Veto", skulls: 0, rarity: "rare",
	text: "Opponent plays an active card → cancel it; both cards are discarded.",
	on: {
		/**
		 * @description The opponent plays any active (any version), not already cancelled by an earlier card: it is cancelled (it stays spent; turn.js emits card-cancelled) and Veto fires (leaves Board Effects). An earlier Echo has already copied it; a later one copies nothing.
		 */
		"card-played"(ctx, owner, ev) {
			if (ev.player === owner || ctx.cancelled) return false;
			ctx.cancel();
			return true;
		},
	},
};
