/*
 *  double-time.js  --  chess cards engine
 *	Active: move two different pieces this turn; debuff: skip your next turn. Legendary version: no skipped turn.
 *
 */

const KEY = "double-time";
const multi = (player) => ({ player, left: 2, moved: [], differ: true });

module.exports = {
	key: KEY, kind: "active", name: "Double Time", skulls: 3, rarity: "rare",
	text: "Move two different pieces this turn. Debuff: skip your next turn.",
	/**
	 * @description No target; only when player has a move to make (the two-move turn's own action list). In check it answers nothing, so the framework's trial drops it.
	 */
	targets(state, player) {
		const { legalActions } = require("../../turn/index.js"); // LAZY: turn/ REQUIRES THE REGISTRY, WHICH WILL REQUIRE THIS FILE; WITH multi SET IT LISTS NO ACTIVES, SO NO RECURSION
		return legalActions({ ...state, pending: null, multi: multi(player) }, player).length ? [null] : []; // A PENDING CHOICE IS NOT A MOVE
	},
	/**
	 * @description Starts the two-move turn (turn/ runs it: different pieces, a card each, a check or no second move ends it) and loses player's next turn.
	 */
	play(ctx, player) {
		ctx.state.multi = multi(player);
		ctx.skipTurn(player, 1);
	},
	versions: [{ rarity: "legendary", skulls: 0, text: "Move two different pieces this turn. No skipped turn.", play(ctx, player) { ctx.state.multi = multi(player); } }],
};
