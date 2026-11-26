/*
 *  activeHand.js  --  chess cards engine test helpers
 *	Shared setup for the hand actives tests (test/cards/activeHand/): the cards and test-only curses they register, a game holding one active, and the ways to play or step a turn.
 *
 */

const assert = require("node:assert/strict");
const { newGame, legalActions, applyAction, playerView, playerEvents } = require("../../../cards-engine/index.js");
const { fromView } = require("../../../cards-engine/view.js");
const { fromFen } = require("../../../cards-engine/board.js");
const hand = require("../../../cards-engine/hand.js");
const { register, reset, CURSE_KEYS, CARDS, baseKey } = require("../../../cards-engine/cards/index.js");
const statuses = require("../../../cards-engine/statuses.js");

reset();
for (const k of ["foresight", "fog-of-war", "mulligan", "pickpocket", "insidious-nullification", "double-time", "hexcraft", "cleanse", "stronghold", "heretical-subjection"]) register(require("../../../cards-engine/cards/active/" + k + ".js"));

const fresh = (seed = 1) => newGame({ cardGuy: "b", level: 1300, seed });
const ofType = (events, type) => events.filter((e) => e.type === type);
const ids = (cards) => cards.map((c) => c.id);
const byId = (a, b) => Number(a.slice(1)) - Number(b.slice(1));
const other = (c) => (c === "w" ? "b" : "w");
const tokens = (k) => Array.from({ length: k }, (_, i) => "?" + (i + 1));
const CHECK = "4k3/8/8/8/8/8/4r3/4K3 w - - 0 1", QUIET = "4k3/8/8/8/8/8/3r4/4K3 w - - 0 1"; // e2 CHECKS THE KING ON e1; d2 DOESN'T

/**
 * @description A fresh game (or one on fen) where color holds exactly one active, of this key; returns { s, id }.
 */
function holding(key, color = "w", seed = 1, fen) {
	const s = fresh(seed);
	if (fen) s.board = fromFen(fen);
	const c = hand.newCard(s, key);
	s.players[color].actives = [c];
	return { s, id: c.id };
}

/**
 * @description Play color's active with this id (no target).
 */
const play = (s, color, id) => applyAction(s, color, { type: "active", card: id });

/**
 * @description Apply color's first legal move action.
 */
const step = (s, color) => applyAction(s, color, legalActions(s, color).find((a) => a.type === "move")).state;

/**
 * @description color's legal move actions; varied applies the i-th (mod their number), so a long run doesn't repeat a position.
 */
const movesOf = (s, color) => legalActions(s, color).filter((a) => a.type === "move");
const varied = (s, color, i) => applyAction(s, color, movesOf(s, color)[(i * 7 + 3) % movesOf(s, color).length]).state;

// TEST-ONLY CURSE: WHEN ITS HOLDER PLAYS AN ACTIVE IT TAKES THE ROOK ON e2, SO ANY ACTIVE WOULD END THE CHECK
register({ key: "t-rescue", kind: "curse", name: "t-rescue", rarity: "common", text: "", on: {
	"card-played"(ctx, owner, ev) {
		const r = ctx.state.board.sq.find((p) => p && p.t === "r" && p.c !== owner);
		return ev.player === owner && !!r && ctx.capture(owner, r.id);
	},
} });

/**
 * @description key is not playable in check on its own (it can't end a check) and is playable on the same position out of check. With t-rescue held (playing any active ends the check), a card with a random outcome is still not playable in check (turn/turn.cards.js activeActions: no active playable in check may have a random outcome); one without (Fog of War) is.
 */
function notInCheck(key, random) {
	for (const [fen, n, rescue] of [[CHECK, 0, false], [QUIET, 1, false], [CHECK, random ? 0 : 1, true]]) {
		const { s, id } = holding(key, "w", 1, fen);
		if (rescue) s.players.w.curses = [hand.newCard(s, "t-rescue")];
		assert.equal(legalActions(s, "w").filter((a) => a.type === "active" && a.card === id).length, n, fen + (rescue ? " with t-rescue" : ""));
	}
}

const { sqIndex } = require("../../../cards-engine/board.js");
const at = (s, sq) => s.board.sq[sqIndex(sq)];
const moveCard = (s, piece) => hand.newCard(s, "move", { piece });
const activeIds = (s, color, id) => legalActions(s, color).filter((a) => a.type === "active" && a.card === id);
const moveFrom = (s, color, from, to) => legalActions(s, color).find((a) => a.type === "move" && a.from === from && (!to || a.to === to));
for (const k of ["t-hex-a", "t-hex-b", "t-hex-c"]) register({ key: k, kind: "curse", name: k, rarity: "common", text: "" }); // TEST-ONLY CURSES WITH NO EFFECT
// TEST-ONLY CURSE: A CARD MADE WITH { ask: true } ASKS ITS HOLDER AT THE START OF THEIR TURN (ONE HEXCRAFT GIVES NEVER DOES)
register({ key: "t-ask", kind: "curse", name: "t-ask", rarity: "common", text: "", on: {
	"turn-start"(ctx, owner, ev, src) {
		if (ev.player !== owner || !src.card.ask) return false;
		ctx.ask(owner, "t-ask", ["x", "y"], { card: "t-ask" });
		return true;
	},
}, choice: { resolve() {} } });

module.exports = { newGame, legalActions, applyAction, playerView, playerEvents, fromView, fromFen, hand, register, reset, CURSE_KEYS, CARDS, baseKey, statuses, fresh, ofType, ids, byId, other, tokens, CHECK, QUIET, holding, play, step, movesOf, varied, notInCheck, sqIndex, at, moveCard, activeIds, moveFrom };
