/*
 *  insidious-nullification.js  --  chess cards engine
 *	Active: cancel all the opponent's waiting passives in Board Effects. Rare only, no debuff (user ruling 2026-11-25: the common version, whose debuff forfeited a piece, was removed).
 *
 */

const KEY = "insidious-nullification";
const other = (c) => (c === "w" ? "b" : "w");

/**
 * @description The opponent's placed passives leave Board Effects for the opponent's discard pile in placedAt order (a passive-cancelled event each; not fired, so not used).
 */
function cancel(ctx, player) {
	const s = ctx.state, opp = other(player), gone = s.effects.filter((e) => e.owner === opp).sort((a, b) => a.placedAt - b.placedAt);
	s.effects = s.effects.filter((e) => e.owner !== opp);
	for (const e of gone) { require("../../hand.js").toPile(s, opp, e.card); ctx.emit({ type: "passive-cancelled", player: opp, card: e.card }); } // LAZY hand.js: SEE shackles.js
}

module.exports = {
	key: KEY, kind: "active", name: "Insidious Nullification", skulls: 0, rarity: "rare",
	text: "Cancel all of the opponent's waiting passive cards in Board Effects. Playable only while they have one waiting.",
	/**
	 * @description No target, and only while the opponent has a passive waiting (user ruling C2, 2026-11-25: else a wasted rare; Board Effects are face up, so it tells nothing). In check it ends nothing, so the framework's trial drops it.
	 */
	targets: (state, player) => (state.effects.some((e) => e.owner === other(player)) ? [null] : []),
	play: cancel,
};
