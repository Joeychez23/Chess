/*
 *  passiveOther.js  --  chess cards engine test helper
 *	Shared setup for test/cards/passiveOther/: the card registry (reset, the passives, actives and curses the tests use, and the test cards t-flag, t-none, t-a, t-b and t-c), fresh games and small state helpers, place and give.
 *
 */

const { newGame, legalActions, applyAction, playerView } = require("../../../cards-engine/index.js");
const hand = require("../../../cards-engine/hand.js");
const { register, reset } = require("../../../cards-engine/cards/index.js");

reset();
register(require("../../../cards-engine/cards/active/foresight.js"));
for (const key of ["interdicted-foresight", "witness", "veto", "echo", "peasant-immunity", "phalanx", "unbroken-line", "pawn-storm"]) register(require("../../../cards-engine/cards/passive/" + key + ".js"));
register({ key: "t-flag", kind: "active", name: "t-flag", rarity: "common", text: "", targets: () => [null], play: (ctx, player) => { ctx.state.flag = player; }, versions: [{ rarity: "rare", text: "" }] });
for (const key of ["double-time", "conscription"]) register(require("../../../cards-engine/cards/active/" + key + ".js"));
register({ key: "t-none", kind: "passive", name: "t-none", rarity: "common", text: "" });
for (const key of ["t-a", "t-b", "t-c"]) register({ key, kind: "active", name: key, rarity: "common", text: "", targets: () => [null], play: () => {} });
for (const key of ["underdog", "four-of-a-kind", "patience"]) register(require("../../../cards-engine/cards/passive/" + key + ".js"));
register(require("../../../cards-engine/cards/curse/mirage.js"));
register(require("../../../cards-engine/cards/active/swap.js"));
register(require("../../../cards-engine/cards/curse/debt.js"));
register(require("../../../cards-engine/cards/curse/hollow-crown.js"));

const IF = "interdicted-foresight";
const fresh = (seed = 1) => newGame({ cardGuy: "b", level: 1300, seed });
const ofType = (events, type) => events.filter((e) => e.type === type);
const ids = (cards) => cards.map((c) => c.id);
const byId = (a, b) => Number(a.slice(1)) - Number(b.slice(1));
const hidden = (p) => [...p.moves, ...p.actives, ...(p.passive ? [p.passive] : [])];
const fired = (events, key) => events.some((e) => e.type === "passive-fired" && e.card.key === key);
const waits = (s, key) => s.effects.some((e) => e.card.key === key);
const shown = (s, viewer) => playerView(s, viewer).players[viewer === "w" ? "b" : "w"].hand.shown;
const movesOf = (s, color) => legalActions(s, color).filter((a) => a.type === "move");
const varied = (s, color, i) => applyAction(s, color, movesOf(s, color)[(i * 7 + 3) % movesOf(s, color).length]).state;
const play = (s, color, id) => applyAction(s, color, { type: "active", card: id });

/**
 * @description Place passive key for owner in Board Effects (placedAt = the current ply, or at); returns its card.
 */
function place(s, key, owner, at = s.ply) {
	const card = hand.newCard(s, key);
	s.effects.push({ id: card.id, owner, card, placedAt: at });
	return card;
}

/**
 * @description color holds exactly one active, of this key; returns its id.
 */
function give(s, key, color = "w") {
	const c = hand.newCard(s, key);
	s.players[color].actives = [c];
	return c.id;
}

module.exports = { IF, fresh, ofType, ids, byId, hidden, fired, waits, shown, movesOf, varied, play, place, give };
