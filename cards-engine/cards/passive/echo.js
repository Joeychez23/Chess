/*
 *  echo.js  --  chess cards engine
 *	Passive: the opponent plays an active card; you get a copy of it.
 *
 */

const hand = require("../../hand.js");

module.exports = {
	key: "echo", kind: "passive", name: "Echo", skulls: 0, rarity: "epic",
	text: "Opponent plays an active card → you get a copy of it.",
	on: {
		/**
		 * @description The opponent plays any active, not already cancelled by an earlier card (Veto): owner gets a new card of the same key (a version stays that version) in its actives, above the 1-active slot, with a draw event; over the active cap it is lost (lost: true), and Echo fires either way.
		 */
		"card-played"(ctx, owner, ev) {
			if (ev.player === owner || ctx.cancelled) return false;
			const p = ctx.state.players[owner], card = hand.newCard(ctx.state, ev.card.key), lost = p.actives.length >= hand.ACTIVE_CAP;
			if (!lost) p.actives.push(card);
			ctx.emit(lost ? { type: "draw", player: owner, card, lost: true } : { type: "draw", player: owner, card });
			return true;
		},
	},
};
