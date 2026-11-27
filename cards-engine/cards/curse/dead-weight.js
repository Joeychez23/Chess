/*
 *  dead-weight.js  --  chess cards engine
 *	Curse: you can't play your active card. Clear: skip a move.
 *
 */

module.exports = {
	key: "dead-weight", kind: "curse", name: "Dead Weight", rarity: "uncommon",
	text: "You can't play your active card. Clear: skip a move.",
	rules: {
		/**
		 * @description For its holder: no active action (the free discard of the active stays), and the clear action { type: "clear", card: <this curse's id> }.
		 */
		actions: (state, player, acts, src) => (player === src.owner ? [...acts.filter((a) => a.type !== "active"), { type: "clear", card: src.card.id }] : acts),
	},
	/**
	 * @description The clear action: the curse leaves through ctx.clearCurse. Paying is the turn itself (a card-defined action uses the turn).
	 */
	act(ctx, player, a, src) { ctx.clearCurse(player, src.card); },
};
