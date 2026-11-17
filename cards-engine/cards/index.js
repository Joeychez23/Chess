/*
 *  cards/index.js  --  chess cards engine
 *	The card registry: CARDS by key, the key list per kind, and the rarity weights draws use.
 *
 */

const CARDS = {}, ACTIVE_KEYS = [], PASSIVE_KEYS = [], CURSE_KEYS = [];
const RARITY_WEIGHTS = { common: 12, uncommon: 6, rare: 3, epic: 2, legendary: 1 }; // THE ONE PLACE TO TUNE THEM: HOW OFTEN A CARD OF EACH TIER IS DRAWN, AGAINST THE OTHERS
const LISTS = { active: ACTIVE_KEYS, passive: PASSIVE_KEYS, curse: CURSE_KEYS };

/**
 * @description Add a card unit (or replace the one with the same key). Test-only until the card files register themselves.
 */
function register(card) {
	if (!CARDS[card.key]) LISTS[card.kind].push(card.key);
	CARDS[card.key] = card;
}

/**
 * @description Empty the registry in place, so every holder of CARDS and the key lists sees it. Test-only.
 */
function reset() {
	for (const k of Object.keys(CARDS)) delete CARDS[k];
	for (const list of Object.values(LISTS)) list.length = 0;
}

module.exports = { CARDS, ACTIVE_KEYS, PASSIVE_KEYS, CURSE_KEYS, RARITY_WEIGHTS, register, reset };
