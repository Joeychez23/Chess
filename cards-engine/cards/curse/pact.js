/*
 *  pact.js  --  chess cards engine
 *	Curse: looks like a gift: draw 2 cards now. After 3 turns it becomes Debt. Can't be cleared before it turns.
 *
 */

const other = (c) => (c === "w" ? "b" : "w");

module.exports = {
	key: "pact", kind: "curse", name: "Pact", rarity: "uncommon",
	text: "Looks like a gift: draw 2 cards now. After 3 turns it becomes Debt. Can't be cleared before it turns.",
	/**
	 * @description left: the holder's turns still to pass before it turns.
	 */
	make: () => ({ left: 3 }),
	on: {
		/**
		 * @description This Pact arrives (its own curse-given): its holder draws 2 move cards. Fires.
		 */
		"curse-given"(ctx, owner, ev, src) {
			if (ev.card.id !== src.card.id) return false;
			ctx.draw(owner, 2);
			return true;
		},
		/**
		 * @description At each start of its holder's turn one of the 3 turns passes; at the start of the 4th it turns: it leaves through ctx.clearCurse and a Debt is given in its place by the same giver (ignoring the limit and the wait: it takes the Pact's slot). Fires then.
		 */
		"turn-start"(ctx, owner, ev, src) {
			if (ev.player !== owner || --src.card.left >= 0) return false;
			ctx.clearCurse(owner, src.card);
			ctx.giveCurse(owner, "debt", other(owner), { max: Infinity, wait: false });
			return true;
		},
	},
};
