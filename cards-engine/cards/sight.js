/*
 *  sight.js  --  chess cards engine
 *	A player's sight of the opponent's hand (players[x].seen), rebuilt from the enchantments that give it (Foresight, Witness, Interdicted Foresight), so one ending never wipes another's.
 *
 */

const { baseKey } = require("./index.js");

const SIGHT = ["foresight", "witness", "interdicted-foresight"]; // THE ONLY CARDS WHOSE ENCHANTMENT data.ids / data.fake / data.all MEAN SIGHT
const other = (c) => (c === "w" ? "b" : "w");

/**
 * @description True for an enchantment entry that gives sight (its card's baseKey is in SIGHT).
 */
const isSight = (e) => SIGHT.includes(baseKey(e.key));

/**
 * @description owner's seen rebuilt from owner's sight enchantments (isSight): ids = every entry's data.ids, fake = every entry's data.fake whose id the opponent still holds as a move, active or passive card (one fake per id), all = whether any entry has data.all; null when they give nothing.
 */
function resight(state, owner) {
	const live = state.enchant.filter((e) => e.owner === owner && e.data && isSight(e)), o = state.players[other(owner)];
	const held = new Set([...o.moves, ...o.actives, ...(o.passive ? [o.passive] : [])].map((c) => c.id));
	const fake = live.flatMap((e) => e.data.fake || []).filter((f, i, a) => held.has(f.id) && a.findIndex((x) => x.id === f.id) === i); // A FAKE GOES WITH THE CARD WHOSE ID IT WEARS
	const seen = { ids: [...new Set(live.flatMap((e) => e.data.ids || []))], fake, all: live.some((e) => !!e.data.all) };
	state.players[owner].seen = seen.ids.length || fake.length || seen.all ? seen : null;
}

module.exports = { resight, isSight };
