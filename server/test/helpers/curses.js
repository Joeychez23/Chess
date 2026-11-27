/*
 *  curses.js  --  chess cards engine test helper
 *	Shared setup for test/cards/curses/: the card registry (reset, the curses, actives and passive the curse tests use, the test cards t-give, t-made, t-crown and t-watch and their LOG), fresh games, small state helpers, untilTurn, blind (Mirage's hiding check), and seg3 and place for the Hunger, Leech and Hollow Crown tests.
 *
 */

const assert = require("node:assert/strict");
const { newGame, legalActions, applyAction, playerView, playerEvents } = require("../../../cards-engine/index.js");
const { fromFen, sqIndex } = require("../../../cards-engine/board.js");
const hand = require("../../../cards-engine/hand.js");
const { register, reset } = require("../../../cards-engine/cards/index.js");

reset();
for (const k of ["dead-weight", "traitors-mark", "tremor", "shackles", "debt", "rust", "mirage", "pact"]) register(require("../../../cards-engine/cards/curse/" + k + ".js"));
for (const k of ["cleanse", "hexcraft", "mulligan", "insidious-nullification", "pickpocket"]) register(require("../../../cards-engine/cards/active/" + k + ".js"));
for (const k of ["bad-omen"]) register(require("../../../cards-engine/cards/passive/" + k + ".js"));
register({ key: "t-give", kind: "active", name: "t-give", rarity: "common", text: "", targets: () => [null], play: (ctx, p) => ctx.giveCurse(p === "w" ? "b" : "w", "shackles", p) });
const LOG = [];
register({ key: "t-made", kind: "curse", name: "t-made", rarity: "common", text: "", make: (ctx, to) => ({ piece: to === "b" ? "n" : "p", roll: ctx.rng.int(1000) }) });
for (const k of ["t-crown", "t-watch"]) register({ key: k, kind: "curse", name: k, rarity: "epic", text: "", on: { "curse-cleared": (ctx, owner, ev, src) => { LOG.push(k + ":" + ev.card.key + ":" + src.card.key); return true; } } });

const fresh = (seed = 1) => newGame({ cardGuy: "b", level: 1300, seed });
const game = (fen, seed = 1) => { const s = fresh(seed); s.board = fromFen(fen); return s; };
const ofType = (events, type) => events.filter((e) => e.type === type);
const at = (s, sq) => s.board.sq[sqIndex(sq)];
const curse = (s, color, key, extra) => { const c = hand.newCard(s, key, extra); s.players[color].curses.push(c); return c; };
const moveCard = (s, piece) => hand.newCard(s, "move", { piece });
const firstMove = (s, color) => legalActions(s, color).find((a) => a.type === "move");
const clears = (s, color) => legalActions(s, color).filter((a) => a.type === "clear");

/**
 * @description Play first legal moves, alternating from the side to move, until it is color's turn n more times (counting turn-start events for color); returns the last { state, events }.
 */
function untilTurn(s, color, n) {
	let r = { state: s, events: [] };
	while (n > 0) {
		const mover = r.state.board.turn;
		r = applyAction(r.state, mover, firstMove(r.state, mover));
		n -= r.events.filter((e) => e.type === "turn-start" && e.player === color).length;
	}
	return r;
}

/**
 * @description Assert that holder's view, the events (as holder sees them) and holder's legal actions show no Mirage: no "mirage" key, no waiting id, every move card a plain { id, key: "move", piece }, every card an action names one the view holds (or the King card / cardless).
 */
function blind(state, events, holder) {
	const v = playerView(state, holder), me = v.players[holder], json = JSON.stringify(v) + JSON.stringify(playerEvents(state, events, holder));
	const giverSees = state.players[holder === "w" ? "b" : "w"].curses.some((c) => c.key === "mirage"); // A MIRAGE THE HOLDER GAVE SHOWS IN THE OTHER HAND
	if (!giverSees) assert.ok(!json.includes("mirage"), "mirage in the holder's view or events");
	for (const c of state.players[holder].curses) if (c.waiting) assert.ok(!json.includes('"' + c.id + '"'), "a waiting Mirage's id");
	for (const c of me.moves) assert.deepEqual(Object.keys(c).sort(), ["id", "key", "piece"]);
	const ids = new Set([...me.moves, ...me.actives].map((c) => c.id).concat(["king", null]));
	if (state.board.turn === holder && !state.pending) for (const a of legalActions(state, holder)) if ("card" in a && a.type !== "clear") assert.ok(ids.has(a.card), "an action names a card the holder can't see: " + a.card);
	return v;
}

// THE LATER CURSES: HUNGER, LEECH, HOLLOW CROWN, HEXCRAFT'S LEGENDARY AND BAD OMEN'S EPIC VERSIONS (REGISTERED HERE, AFTER THE TESTS ABOVE: NEW CURSE KEYS WOULD CHANGE THEIR SEEDED PICKS)
const seg3 = () => {
	for (const k of ["hunger", "leech", "hollow-crown"]) register(require("../../../cards-engine/cards/curse/" + k + ".js"));
	for (const k of ["escape-artist", "bleeding-hand"]) register(require("../../../cards-engine/cards/passive/" + k + ".js"));
};
const place = (s, key, owner) => { const c = hand.newCard(s, key); s.effects.push({ id: c.id, owner, card: c, placedAt: s.ply }); return c; };

module.exports = { LOG, fresh, game, ofType, at, curse, moveCard, firstMove, clears, untilTurn, blind, seg3, place };
