/*
 *  cards/index.js  --  chess cards engine
 *	The card registry: CARDS by key, the key list per kind, and the rarity weights draws use.
 *
 */

const CARDS = {}, ACTIVE_KEYS = [], PASSIVE_KEYS = [], CURSE_KEYS = [];
const RARITY_WEIGHTS = { common: 12, uncommon: 6, rare: 3, epic: 2, legendary: 1 }; // THE ONE PLACE TO TUNE THEM: HOW OFTEN A CARD OF EACH TIER IS DRAWN, AGAINST THE OTHERS
const LISTS = { active: ACTIVE_KEYS, passive: PASSIVE_KEYS, curse: CURSE_KEYS };

/**
 * @description Add a card unit (or replace the one with the same key, keeping its place in its key list), and each of its versions as its own entry { ...unit, ...version, key: "<base>-<rarity>", base } (no nested versions). cards/all.js registers every card file; tests register their own (a repeat is harmless).
 */
function register(card) {
	if (!(card.rarity in RARITY_WEIGHTS)) throw new Error("Card " + card.key + " has no known rarity: " + card.rarity); // A WEIGHTLESS CARD WOULD SILENTLY STOP EVERY DRAW OF ITS KIND
	const list = LISTS[card.kind];
	const keep = new Set((card.versions || []).map((v) => card.key + "-" + v.rarity)); // A REPEAT REGISTRATION KEEPS ITS VERSIONS' PLACES IN THE LIST (DRAW ORDER)
	for (const k of list.filter((k) => CARDS[k].base === card.key && !keep.has(k))) { delete CARDS[k]; list.splice(list.indexOf(k), 1); } // VERSIONS FROM AN EARLIER REGISTRATION OF THIS CARD
	if (!CARDS[card.key]) list.push(card.key);
	CARDS[card.key] = card;
	const { versions, ...unit } = card;
	for (const v of versions || []) register({ ...unit, ...v, key: card.key + "-" + v.rarity, base: card.key });
}

/**
 * @description The base card's key: a version's base, else the key itself (an unknown key too). Every "is this card X" check compares it.
 */
function baseKey(key) {
	return (CARDS[key] && CARDS[key].base) || key;
}

/**
 * @description Empty the registry in place, so every holder of CARDS and the key lists sees it. Test-only.
 */
function reset() {
	for (const k of Object.keys(CARDS)) delete CARDS[k];
	for (const list of Object.values(LISTS)) list.length = 0;
}

module.exports = { CARDS, ACTIVE_KEYS, PASSIVE_KEYS, CURSE_KEYS, RARITY_WEIGHTS, register, reset, baseKey };
