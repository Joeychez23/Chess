/*
 *  cards/all.js  --  chess cards engine
 *	Registers every card file (cards/active, cards/passive, cards/curse), each kind in sorted file-name order (the registry's key lists, and so every weighted draw, follow it). Required last by index.js: card files require hand.js, ctx.js and view.js at load, which must be whole by then (from cards/index.js they would be half-loaded). A new card file must be listed here.
 *
 */

const { register } = require("./index.js");

const FILES = {
	active: ["all-or-nothing", "cleanse", "conscription", "double-time", "fog-of-war", "foresight", "heavy-cavalry", "heretical-subjection", "hexcraft", "insidious-nullification",
		"last-stand", "mulligan", "opposing-finality", "pickpocket", "stronghold", "swap", "trapdoor"],
	passive: ["bad-omen", "bleeding-hand", "bounty", "echo", "escape-artist", "four-of-a-kind", "grace", "hex", "interdicted-foresight", "last-rites", "overwatch", "patience", "pawn-storm", "peasant-immunity",
		"phalanx", "reinforcements", "retaliation", "spite", "unbroken-line", "underdog", "unjust-retribution", "veto", "witness"],
	curse: ["dead-weight", "debt", "hollow-crown", "hunger", "leech", "mirage", "pact", "rust", "shackles", "traitors-mark", "tremor"],
};

for (const kind of Object.keys(FILES)) for (const f of FILES[kind]) register(require("./" + kind + "/" + f + ".js")); // A BUNDLER RESOLVES THESE: NO DIRECTORY READ (THE ENGINE USES NO NODE API)

module.exports = { FILES };
