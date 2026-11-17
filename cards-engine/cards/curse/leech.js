/*
 *  leech.js  --  chess cards engine
 *	Curse: each turn you hold it, the opponent draws an extra card. Passable: capture an enemy piece while holding it to send it back. Clear: discard your active card.
 *
 */

const hand = require("../../hand.js");

const other = (c) => (c === "w" ? "b" : "w");

module.exports = {
	key: "leech", kind: "curse", name: "Leech", rarity: "rare",
	text: "Each turn you hold it, the opponent draws an extra card. Passable: capture an enemy piece while holding it to send it back. Clear: discard your active card.",
	rules: {
		/**
		 * @description For its holder: a clear action { type: "clear", card: <this curse's id>, discard: <active id> } for each active card they hold.
		 */
		actions: (state, player, acts, src) => (player === src.owner ? [...acts, ...state.players[player].actives.map((c) => ({ type: "clear", card: src.card.id, discard: c.id }))] : acts),
	},
	/**
	 * @description The clear action: the chosen active is discarded (a discard event, no replacement draw), then the curse leaves through ctx.clearCurse. Uses the turn.
	 */
	act(ctx, player, a, src) {
		hand.discard(ctx, player, a.discard);
		ctx.clearCurse(player, src.card);
	},
	on: {
		/**
		 * @description At each start of its holder's turn the opponent draws a move card (ctx.draw: a plain "draw a card"). Fires.
		 */
		"turn-start"(ctx, owner, ev) {
			if (ev.player !== owner) return false;
			ctx.draw(other(owner), 1);
			return true;
		},
		/**
		 * @description Passable: its holder captures an enemy piece (ev.player !== ev.c): it leaves through ctx.clearCurse and goes back to the opponent through ctx.giveCurse, as Mirage does (the limit holds: refused, it is simply gone; no wait started). Fires.
		 */
		capture(ctx, owner, ev, src) {
			if (ev.player !== owner || ev.c === owner) return false;
			ctx.clearCurse(owner, src.card);
			ctx.giveCurse(other(owner), "leech", owner, { wait: false });
			return true;
		},
	},
};
