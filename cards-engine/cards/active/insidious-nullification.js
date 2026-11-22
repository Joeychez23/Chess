/*
 *  insidious-nullification.js  --  chess cards engine
 *	Active: cancel all the opponent's waiting passives in Board Effects; debuff: forfeit one of your pieces whose type has a card in your hand. Rare version: no forfeit.
 *
 */

const { inCheck } = require("../../rules.js");
const statuses = require("../../statuses.js");

const KEY = "insidious-nullification";
const other = (c) => (c === "w" ? "b" : "w");

/**
 * @description The opponent's placed passives leave Board Effects in placedAt order (a passive-cancelled event each; not fired, so not used).
 */
function cancel(ctx, player) {
	const s = ctx.state, opp = other(player), gone = s.effects.filter((e) => e.owner === opp).sort((a, b) => a.placedAt - b.placedAt);
	s.effects = s.effects.filter((e) => e.owner !== opp);
	for (const e of gone) ctx.emit({ type: "passive-cancelled", player: opp, card: e.card });
}

/**
 * @description Ids of player's non-king pieces (board order) that a move card in player's hand moves (hand.fits: the Knight / Bishop card a knight or a bishop; an entered Mirage counts as its fake type: its holder can't tell it apart; a waiting one, not yet seen, doesn't) and whose loss leaves player's king out of check.
 */
function forfeitable(state, player) {
	const pl = state.players[player], sq = state.board.sq;
	const hand = require("../../hand.js"), types = hand.moveCards(pl).map((c) => c.piece); // LAZY hand.js: SEE shackles.js
	const safe = (p) => !inCheck({ ...state, board: { ...state.board, sq: sq.map((q) => (q === p ? null : q)) } }, player);
	return sq.filter((p) => p && p.c === player && p.t !== "k" && types.some((t) => hand.fits(t, p.t)) && safe(p)).map((p) => p.id);
}

module.exports = {
	key: KEY, kind: "active", name: "Insidious Nullification", skulls: 3, rarity: "common",
	text: "Cancel all of the opponent's waiting passive cards in Board Effects. Debuff: forfeit one piece that has a card in your hand.",
	/**
	 * @description No target; needs a piece the player can forfeit (the debuff must be payable). In check it ends nothing, so the framework's trial drops it.
	 */
	targets: (state, player) => (forfeitable(state, player).length ? [null] : []),
	/**
	 * @description cancel, then the player chooses which piece to forfeit.
	 */
	play(ctx, player) {
		cancel(ctx, player);
		const options = forfeitable(ctx.state, player);
		if (options.length) ctx.ask(player, KEY, options, { card: KEY }); // A CANCELLED PASSIVE'S RULES CAN CHANGE WHICH LOSS IS SAFE: AN EMPTY CHOICE WOULD STALL THE GAME
	},
	versions: [{ rarity: "rare", skulls: 0, text: "Cancel all of the opponent's waiting passive cards in Board Effects. No forfeit.", targets: () => [null], play: cancel }],
	choice: {
		/**
		 * @description The chosen piece leaves the board. A forfeit is a removal, not a capture: Marked is cleared first so it pays no one (as Warded doesn't stop it); ctx.capture then removes it (capture event, by null) and sets ctx.resetHalf.
		 */
		resolve(ctx, pending, option) {
			statuses.clear(ctx, option, "marked");
			ctx.capture(pending.player, option);
		},
	},
};
