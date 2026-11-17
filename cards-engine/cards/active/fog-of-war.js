/*
 *  fog-of-war.js  --  chess cards engine
 *	Active: for 3 turns the opponent sees your pieces on your half of the board as blank tokens; your hand is visible to them meanwhile (both done by view.js while the enchantment is up). Rare version: the hand stays hidden; epic: hidden hand and 5 turns.
 *
 */

const KEY = "fog-of-war";
const SEES = "the opponent sees your pieces on your half of the board as blank tokens.";

/**
 * @description The play of a fog lasting left of the owner's turns, put up under key: given on player's own turn it is fresh, so it covers the opponent's next turn and ends at the end of player's left-th next turn. view.js shows the hand only under the base key, so a version enchants under its own key.
 */
const fog = (key, left) => (ctx, player) => { ctx.enchant(player, key, [], left); };

module.exports = {
	key: KEY, kind: "active", name: "Fog of War", skulls: 2, rarity: "uncommon",
	text: "For 3 turns " + SEES + " Debuff: your hand is visible to the opponent while the fog lasts.",
	targets: () => [null],
	play: fog(KEY, 3),
	versions: [
		{ rarity: "rare", skulls: 0, text: "For 3 turns " + SEES + " Your hand stays hidden.", play: fog(KEY + "-rare", 3) },
		{ rarity: "epic", skulls: 0, text: "For 5 turns " + SEES + " Your hand stays hidden.", play: fog(KEY + "-epic", 5) },
	],
};
