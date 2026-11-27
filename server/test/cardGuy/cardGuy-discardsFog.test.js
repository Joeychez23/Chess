/*
 *  cardGuy-discardsFog.test.js  --  chess server tests
 *	Task 25, Card Guy's rules outside the search (server/utils/card-guy/): the passive reroll, refusals under the player's fog & hidden-slot choices (F3), the discard fallback & the en passant score line (F4).
 *	Two test groups merged by feature, each in its own scope with its own helpers; the tests and their names are unchanged
 */

/* ================================================================ */
// F3: THE PASSIVE REROLL, FOG REFUSALS, HIDDEN SLOTS (index.js)
/* ================================================================ */
(() => {
/*
 *  cardGuy-discardsFog.test.js, the passive reroll, fog refusals & hidden slots
 *	Task 25 wave C, F3: Card Guy rerolls a passive that can't beat his weakest waiting one (ruling 7(b), B4), copes with a fogged told list
 *  that holds targets the real game refuses (B2), and answers an Opposing Finality choice holding hidden "?n" slots (A1, contract a).
 *
 */

require("../helpers/env.js");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../../../cards-engine/index.js");
const { newGame, legalActions, applyAction, playerView, actionKey } = engine;
const hand = require("../../../cards-engine/hand.js");
const { makeCtx } = require("../../../cards-engine/ctx.js");
const { PASSIVE_KEYS, CARDS } = require("../../../cards-engine/cards/index.js");
const { cardGuyTurn } = require("../../utils/card-guy/index.js");

const VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const material = async (fen) => [...fen.split(" ")[0]].reduce((sum, ch) => sum + (/[a-z]/i.test(ch) ? (ch === ch.toUpperCase() ? 1 : -1) * VALUE[ch.toLowerCase()] : 0), 0);
const firstOf = async (fen, lans) => ({ from: lans[0].slice(0, 2), to: lans[0].slice(2, 4), promotion: lans[0][4] });
const opts = (o) => ({ evaluate: material, bestOf: firstOf, seed: 7, ...o });
const isLegal = (s, c, a) => legalActions(s, c).some((x) => actionKey(x) === actionKey(a));
const place = (s, key, owner) => { const card = hand.newCard(s, key); s.effects.push({ id: card.id, owner, card, placedAt: s.ply }); };
const fogUp = (s, owner) => { const ctx = makeCtx(s); ctx.trigger = () => {}; ctx.enchant(owner, "fog-of-war-rare", [], 40); };
const MAX_REFUSALS = 8; // cardsController's CAP: PAST IT ANY LEGAL ACTION IS PLAYED FOR HIM

/**
 * @description Card Guy (White) at the start with 3 common passives waiting, the hand passive `key` and a queen card (no move at the start: a dead move card) beside a pawn card.
 */
function waiting(key) {
	const s = newGame({ cardGuy: "w", level: 1300, seed: 3 });
	for (const k of ["witness", "spite", "bounty"]) place(s, k, "w");
	s.players.w.moves = ["q", "p"].map((piece) => hand.newCard(s, "move", { piece }));
	Object.assign(s.players.w, { actives: [], passive: hand.newCard(s, key) });
	return s;
}

test("with 3 waiting and a hand passive no rarer than his weakest, Card Guy rerolls it, ahead of a dead move card's discard", async () => {
	const s = waiting("interdicted-foresight"); // COMMON, AS THE WEAKEST WAITING
	const reroll = { type: "discard", cards: [s.players.w.passive.id] };
	assert.ok(isLegal(s, "w", reroll), "the engine offers the reroll");
	assert.ok(isLegal(s, "w", { type: "discard", cards: [s.players.w.moves[0].id] }), "the dead queen card's discard is offered too");
	for (const seed of [1, 2, 3]) assert.deepEqual(await cardGuyTurn(playerView(s, "w"), 1300, opts({ seed, legal: engine.playerLegal(s, "w") })), reroll);
});

test("a hand passive rarer than his weakest is not rerolled (the drop path stays)", async () => {
	const s = waiting("veto"); // RARE OVER COMMONS
	const a = await cardGuyTurn(playerView(s, "w"), 1300, opts({ legal: engine.playerLegal(s, "w") }));
	assert.ok(!(a.type === "discard" && a.cards[0] === s.players.w.passive.id), JSON.stringify(a));
});

test("no reroll when the engine doesn't offer one (no passive left to draw, or the turn's free discard is used)", async () => {
	const s = waiting("interdicted-foresight");
	s.players.w.used = PASSIVE_KEYS.slice(); // NOTHING LEFT TO DRAW: hand.drawable IS EMPTY
	assert.ok(!isLegal(s, "w", { type: "discard", cards: [s.players.w.passive.id] }));
	const a = await cardGuyTurn(playerView(s, "w"), 1300, opts());
	assert.deepEqual(a, { type: "discard", cards: [s.players.w.moves[0].id] }); // THE DEAD QUEEN CARD, AS BEFORE
	const t = waiting("interdicted-foresight");
	t.discarded = { player: "w", kind: "active", n: 1 };
	const b = await cardGuyTurn(playerView(t, "w"), 1300, opts());
	assert.ok(!(b.type === "discard"), JSON.stringify(b));
});

test("under the player's fog the reroll is checked on the told list too", async () => {
	const s = waiting("interdicted-foresight");
	fogUp(s, "b");
	const reroll = { type: "discard", cards: [s.players.w.passive.id] };
	assert.deepEqual(await cardGuyTurn(playerView(s, "w"), 1300, opts({ legal: engine.playerLegal(s, "w") })), reroll);
	const told = engine.playerLegal(s, "w").filter((a) => actionKey(a) !== actionKey(reroll)); // A TOLD LIST WITHOUT IT (A CHECK BY A FOGGED PIECE): NOT TRIED
	const a = await cardGuyTurn(playerView(s, "w"), 1300, opts({ legal: told }));
	assert.notDeepEqual(a, reroll);
});

/**
 * @description A pending Opposing Finality choice for Card Guy (Black) at the start, its options as given (piece ids and "?n" slots).
 */
function finality(options) {
	const s = newGame({ cardGuy: "b", level: 1300, seed: 4 });
	s.board.turn = "b";
	s.pending = { card: "opposing-finality", owner: "b", player: "b", kind: "opposing-finality", options, turn: "b" };
	return s;
}

test("a pending Opposing Finality choice of hidden slots only: one of them, no throw, even when the guess can't play a slot out", async (t) => {
	const resolve = CARDS["opposing-finality"].choice.resolve;
	CARDS["opposing-finality"].choice.resolve = (ctx, pend, option) => { if (String(option)[0] === "?") throw new Error("no hidden piece on this guess"); return resolve(ctx, pend, option); }; // HIS GUESS HOLDS NO OFFERED HIDDEN PIECE
	t.after(() => { CARDS["opposing-finality"].choice.resolve = resolve; });
	for (const seed of [1, 2, 3]) {
		const a = await cardGuyTurn(playerView(finality(["?1", "?2"]), "b"), 1300, opts({ seed }));
		assert.equal(a.type, "choice");
		assert.ok(["?1", "?2"].includes(a.option), JSON.stringify(a));
	}
});

test("visible ids beside hidden slots: he picks one of the options, no throw", async (t) => {
	const resolve = CARDS["opposing-finality"].choice.resolve;
	CARDS["opposing-finality"].choice.resolve = (ctx, pend, option) => { if (String(option)[0] === "?") throw new Error("no hidden piece on this guess"); return resolve(ctx, pend, option); };
	t.after(() => { CARDS["opposing-finality"].choice.resolve = resolve; });
	const s = finality([]), pawns = s.board.sq.filter((q) => q && q.c === "w" && q.t === "p").slice(0, 2).map((q) => q.id);
	s.pending.options = [...pawns, "?1"];
	const a = await cardGuyTurn(playerView(s, "b"), 1300, opts());
	assert.equal(a.type, "choice");
	assert.ok(s.pending.options.includes(a.option), JSON.stringify(a));
});

test("under the player's fog, Card Guy holding Trapdoor, Swap and All or Nothing finds a legal action within the controller's refusal cap; worst turn time logged", async () => {
	let worst = 0, most = 0;
	for (const seed of [1, 2, 3, 4]) {
		let s = newGame({ cardGuy: "b", level: 1300, seed });
		fogUp(s, "w");
		for (let ply = 0; ply < 40 && !s.result; ply++) { // 40: FAR ENOUGH FOR HIS GUESS OF THE FOGGED PIECES TO BE WRONG (12 PLIES MADE NO REFUSAL, F3-M1)
			const c = [s.board.turn, s.board.turn === "w" ? "b" : "w"].find((x) => legalActions(s, x).length);
			if (c === "b") { s.players.b.actives = ["trapdoor", "swap", "all-or-nothing"].map((k) => hand.newCard(s, k)); } // HIS CARDS EVERY TURN: THEIR TARGETS UNDER THE FOG ARE TOLD, NOT ALL REAL
			const refused = [];
			let action;
			for (;;) {
				const t0 = Date.now();
				action = await cardGuyTurn(playerView(s, c), 1300, opts({ seed: seed * 100 + ply, refused, legal: engine.playerLegal(s, c) }));
				worst = Math.max(worst, Date.now() - t0);
				if (isLegal(s, c, action)) break;
				assert.ok(!refused.includes(actionKey(action)), "a refused action came back");
				refused.push(actionKey(action));
				assert.ok(refused.length <= MAX_REFUSALS, "the refusal cap reached: seed " + seed + " ply " + ply);
			}
			most = Math.max(most, refused.length);
			s = applyAction(s, c, action).state;
		}
	}
	console.log(`F3 FOGGED TURNS: WORST CALL ${worst} ms, MOST REFUSALS IN ONE TURN ${most}`);
	assert.ok(most > 0, "no action was refused: the refusal loop wasn't tested"); // F3-M1: THE TEST MUST REACH A REFUSAL TO PIN THE LOOP
});
})();

/* ================================================================ */
// F4: THE DISCARD FALLBACK & staticScore (candidates.js)
/* ================================================================ */
(() => {
/*
 *  cardGuy-discardsFog.test.js, the discard fallback & the en passant score line
 *	Card Guy's candidates (server/utils/card-guy/candidates.js): the "only discards left" fallback (ruling 7(c), B5) and the en passant line of staticScore
 *
 */

require("../helpers/env.js");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../../../cards-engine/index.js");
const hand = require("../../../cards-engine/hand.js");
const { candidates, staticScore } = require("../../utils/card-guy/candidates.js");

/**
 * @description Lone kings, Card Guy black with no King card and a rook move card (no rook): no plain move and no playable card, the hand and placed passives as given
 */
function stuck(actives, placed = []) {
	const s = engine.newGame({ cardGuy: "b", level: 2400, seed: 1 });
	s.board = engine.board.fromFen("k7/8/8/8/8/8/8/4K3 b - - 0 1");
	Object.assign(s.players.b, { king: false, passive: null, moves: [hand.newCard(s, "move", { piece: "r" })], actives: actives.map((key) => hand.newCard(s, key)) });
	for (const key of placed) { const card = hand.newCard(s, key); s.effects.push({ id: card.id, owner: "b", card, placedAt: s.ply }); }
	return s;
}

const ids = (s, keys) => keys.map((key) => s.players.b.actives.find((c) => c.key === key).id);

test("with only discards and drops left, the dead move card first, then the common or uncommon actives that are not Cleanse; kept cards and drops left out", () => {
	const s = stuck(["swap", "last-stand", "cleanse", "stronghold-common"], ["patience"]);
	const all = engine.legalActions(s, "b");
	assert.ok(all.every((a) => a.type === "discard" || a.type === "drop") && all.some((a) => a.type === "drop")); // THE FALLBACK'S POSITION
	const list = candidates(s, "b");
	assert.deepEqual(list, [{ type: "discard", cards: [s.players.b.moves[0].id] }, ...ids(s, ["last-stand", "stronghold-common"]).map((id) => ({ type: "discard", cards: [id] }))]);
});

test("the cheap actives alone when no move card is left", () => {
	const s = stuck(["swap", "last-stand"]);
	s.players.b.moves = [];
	assert.deepEqual(candidates(s, "b"), ids(s, ["last-stand"]).map((id) => ({ type: "discard", cards: [id] })));
});

test("only kept cards and drops left: every one of them", () => {
	const s = stuck(["swap", "cleanse"], ["patience"]);
	s.players.b.moves = [];
	const all = engine.legalActions(s, "b");
	assert.ok(all.some((a) => a.type === "drop"));
	assert.deepEqual(candidates(s, "b"), all);
});

test("staticScore's en passant line scores the pawn it takes", () => {
	const s = engine.newGame({ cardGuy: "w", level: 2400, seed: 1 });
	s.board = engine.board.fromFen("7k/8/8/3pP3/8/8/8/K7 w - d6 0 1");
	assert.equal(staticScore(s, { from: "e5", to: "d6" }), 90); // NO VICTIM ON d6: A PAWN, LESS A TENTH
	assert.equal(staticScore(s, { from: "e5", to: "e6" }), 0); // A STRAIGHT PUSH ISN'T ONE
});

test("an entered Mirage (a move card to its holder, kept among the curses) is a dead move card too: its discard alone, the rare Swap kept", () => {
	const s = stuck(["swap"]);
	s.players.b.moves = [];
	s.players.b.curses.push(hand.newCard(s, "mirage", { piece: "r" }));
	const mirage = s.players.b.curses[0];
	assert.ok(hand.moveCards(s.players.b).includes(mirage), "entered: a move card in his hand");
	assert.deepEqual(candidates(s, "b"), [{ type: "discard", cards: [mirage.id] }]);
});
})();
