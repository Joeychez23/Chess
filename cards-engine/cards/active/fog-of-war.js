/*
 *  fog-of-war.js  --  chess cards engine
 *	Active: for 1 turn the opponent sees your pieces as blank tokens; your hand is visible to them meanwhile (both done by view.js while the enchantment is up).
 *
 */

module.exports = {
	key: "fog-of-war", kind: "active", name: "Fog of War", skulls: 1, rarity: "common",
	text: "For 1 turn the opponent sees your pieces as blank tokens. Debuff: your hand is visible to the opponent while the fog lasts.",
	targets: () => [null],
	/**
	 * @description A 1-turn fog-of-war enchantment: given on player's own turn it is fresh, so it covers the opponent's next turn and ends at the end of player's next turn.
	 */
	play(ctx, player) {
		ctx.enchant(player, "fog-of-war", [], 1);
	},
};
