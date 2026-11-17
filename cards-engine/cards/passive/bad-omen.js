/*
 *  bad-omen.js  --  chess cards engine
 *	Passive: one of your pieces is captured; a random curse goes into the opponent's hand, if the curse limit allows. Epic version: the curse limit and the wait don't apply.
 *
 */

const other = (c) => (c === "w" ? "b" : "w");

/**
 * @description The capture handler, giving through ctx.giveCurse with opts (canCurse's: {} for the base card): one of owner's pieces captured by the opponent (ev.player !== ev.c: a removal by owner's own side is not a capture): a random curse key the opponent does not hold, picked by rarity (ctx.randomCurses), is given to the opponent, which giveCurse refuses under the limit opts allow. Fires either way.
 */
const omen = (opts) => (ctx, owner, ev) => {
	if (ev.c !== owner || ev.player === ev.c) return false; // A REMOVAL IS NOT A CAPTURE
	const [key] = ctx.randomCurses(1, other(owner));
	if (key) ctx.giveCurse(other(owner), key, owner, opts);
	return true;
};

module.exports = {
	key: "bad-omen", kind: "passive", name: "Bad Omen", skulls: 0, rarity: "rare",
	text: "One of your pieces is captured → a random curse goes into the opponent's hand, if the curse limit allows.",
	on: { capture: omen({}) },
	versions: [{
		rarity: "epic",
		text: "One of your pieces is captured → a random curse goes into the opponent's hand. Ignores the curse limit (the opponent can go over 2 curses).",
		on: { capture: omen({ max: Infinity, wait: false }) }, // NO LIMIT AND NO WAIT, AND NONE STARTED
	}],
};
