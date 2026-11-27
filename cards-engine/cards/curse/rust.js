/*
 *  rust.js  --  chess cards engine
 *	Curse: your next active card has no effect. Fires once, then discarded.
 *
 */

module.exports = {
	key: "rust", kind: "curse", name: "Rust", rarity: "uncommon",
	text: "Your next active card has no effect. Fires once, then discarded.",
	on: {
		/**
		 * @description Its holder plays an active: ctx.cancel() (the card stays spent, its play doesn't run, card-cancelled), then the curse leaves through ctx.clearCurse. Fires.
		 */
		"card-played"(ctx, owner, ev, src) {
			if (ev.player !== owner) return false;
			ctx.cancel();
			ctx.clearCurse(owner, src.card);
			return true;
		},
	},
};
