/*
 *  cardGuy-choosing.test.js  --  chess server tests
 *	Card Guy, the card-game bot (server/utils/card-guy): how he chooses an action: legal actions, free discards, the flair margin, the noise, the evaluation budget and answering pending choices. The engine is stubbed: no test reaches Stockfish.
 *
 */

require("../helpers/env.js");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { engine, newGame, legalActions, applyAction, playerView, actionKey, toFen, hand, PASSIVE_KEYS, CARDS, cardGuyTurn, scoreTurn, MAX_EVALS, candidates, pick, FLAIR_MARGIN, noticeFor, material, firstOf, down, opts, isLegal, owes, position, ask, play } = require("../helpers/cardGuy.js");

test("Card Guy only ever returns an action in legalActions", async () => {
	for (const seed of [1, 2, 3]) {
		const r = await play(newGame({ cardGuy: "b", level: [600, 1300, 2400][seed - 1], seed }), 40, { seed }); // ask FAILS ON AN ILLEGAL ACTION UNLESS THE OTHER SIDE'S FOG OF WAR IS UP (ONE IS PLAYED IN THESE GAMES)
		assert.ok(r.actions === 40 || r.state.result);
		assert.ok(r.refused <= 2 * r.foggy, r.refused + " refusals over " + r.foggy + " turns under a fog"); // NONE WITH NO FOG UP, A FEW UNDER ONE (1 OVER 3 TURNS IN THE FIRST GAME), NOT A TURN OF THEM
	}
});

test("Card Guy's free discard, at every level: the active when it has no play, else a move card with no move, one at a time, else none; never a scored candidate", async () => {
	for (const level of [600, 1300, 2400]) {
		const s = newGame({ cardGuy: "w", level, seed: 3 }); // WHITE TO MOVE AT THE START: ROOK & QUEEN CARDS HAVE NO MOVE, PAWN & KNIGHT / BISHOP CARDS DO
		const card = (piece) => hand.newCard(s, "move", { piece });
		s.players.w.actives = [hand.newCard(s, "last-stand")]; // NO PLAY AT THE START (UNCOMMON: CLEANSE AND RARE+ ARE KEPT; WAS HEAVY CAVALRY, NOW EPIC AND PLAYABLE ON ANY KNIGHT)
		s.players.w.moves = [card("p"), card("r"), card("q"), card("m")];
		const dead = s.players.w.actives[0].id, turn = (st) => cardGuyTurn(playerView(st, "w"), level, opts());
		assert.deepEqual(await turn(s), { type: "discard", cards: [dead] }, level + ": the dead active");
		s.players.w.actives = [hand.newCard(s, "swap")]; // A LIVE ACTIVE: THE DEAD MOVE CARDS GO, ONE AT A TIME
		assert.deepEqual(await turn(s), { type: "discard", cards: [s.players.w.moves[1].id] }, level + ": the first dead move card");
		const next = applyAction(s, "w", { type: "discard", cards: [s.players.w.moves[1].id] }).state;
		assert.deepEqual(await turn(next), { type: "discard", cards: [s.players.w.moves[2].id] }, level + ": then the second, which draws 1 back");
		s.players.w.moves.splice(2, 1); // ONE DEAD MOVE CARD: IT GOES TOO, REMEMBERED UNTIL ITS PAIR
		assert.deepEqual(await turn(s), { type: "discard", cards: [s.players.w.moves[1].id] }, level + ": one dead card");
		s.players.w.actives = [hand.newCard(s, "last-stand")];
		s.discarded = "w"; // USED THIS TURN
		assert.notEqual((await turn(s)).type, "discard", level + ": used");
	}
	const s = newGame({ cardGuy: "w", level: 2400, seed: 3 }), still = toFen(s).split(" ")[0];
	Object.assign(s.players.w, { moves: ["p", "p", "m"].map((piece) => hand.newCard(s, "move", { piece })), actives: [] }); // NO DEAD CARD: THE STEP DOESN'T DISCARD
	const lazy = async (fen) => (fen.split(" ")[0] === still ? 5000 : 0); // AN ENGINE THAT LOVES A BOARD NOBODY MOVED ON: A DISCARD, WERE IT SCORED
	assert.ok(legalActions(s, "w").some((a) => a.type === "discard"));
	assert.ok(!candidates(engine.fromView(playerView(s, "w"), 1), "w").some((a) => a.type === "discard"));
	for (const seed of [1, 2, 3, 4]) assert.notEqual((await cardGuyTurn(playerView(s, "w"), 600, opts({ evaluate: lazy, seed }))).type, "discard");
});

test("Card Guy's dead move card is the first in hand order (the draw-back is random)", async () => {
	const s = newGame({ cardGuy: "w", level: 1300, seed: 3 });
	for (const sq of ["b1", "g1"]) s.statuses[s.board.sq[engine.board.sqIndex(sq)].id] = [{ s: "hexed", left: 9, by: "b" }]; // WHITE TO MOVE AT THE START, BOTH KNIGHTS HEXED (NO CARD MOVES THEM): QUEEN, ROOK & KNIGHT / BISHOP CARDS HAVE NO MOVE
	const deal = (types) => { s.players.w.moves = types.map((piece) => hand.newCard(s, "move", { piece })); return s.players.w.moves.map((c) => c.id); };
	const turn = () => cardGuyTurn(playerView(s, "w"), 1300, opts());
	s.players.w.actives = [hand.newCard(s, "swap")]; // A LIVE ACTIVE: THE MOVE CARDS ARE WHAT GOES
	let ids = deal(["q", "r", "m", "p"]);
	assert.deepEqual(await turn(), { type: "discard", cards: [ids[0]] }); // THE QUEEN CARD: THE FIRST DEAD ONE
	ids = deal(["p", "r", "q"]);
	assert.deepEqual(await turn(), { type: "discard", cards: [ids[1]] }); // THE PAWN CARD HAS A MOVE: THE ROOK CARD
	ids = deal(["r", "q", "m", "m"]);
	assert.deepEqual(await turn(), { type: "discard", cards: [ids[0]] });
});

test("with fewer than 3 passives waiting Card Guy never rerolls its passive (with 3 waiting he does, cardGuy-discardsFog.test.js)", async () => {
	for (const key of PASSIVE_KEYS.filter((k) => ["common", "uncommon"].includes(CARDS[k].rarity))) { // THE RARITIES IT THROWS A DEAD ACTIVE OUT AT
		const s = newGame({ cardGuy: "w", level: 1300, seed: 3 });
		s.players.w.moves = ["p", "m"].map((piece) => hand.newCard(s, "move", { piece })); // BOTH HAVE A MOVE: NO PAIR TO DISCARD
		Object.assign(s.players.w, { actives: [], passive: hand.newCard(s, key) });
		const reroll = { type: "discard", cards: [s.players.w.passive.id] };
		assert.ok(isLegal(s, "w", reroll), key + ": the reroll is legal");
		for (const seed of [1, 2, 3]) assert.notEqual((await cardGuyTurn(playerView(s, "w"), 1300, opts({ seed }))).type, "discard", key);
	}
});

test("Card Guy takes a free queen over a card with a small card score", async () => {
	const s = position("4k3/8/8/r2Q4/8/8/8/4K3 b - - 0 1");
	Object.assign(s.players.b, { moves: [hand.newCard(s, "move", { piece: "r" }), hand.newCard(s, "move", { piece: "r" })], actives: [], passive: hand.newCard(s, "patience") });
	assert.ok(legalActions(s, "b").some((a) => a.type === "passive"));
	const a = await cardGuyTurn(playerView(s, "b"), 2400, opts());
	assert.deepEqual([a.type, a.from, a.to], ["move", "a5", "d5"]);
	const quiet = position("4k3/8/8/r7/8/8/8/3QK3 b - - 0 1"); // NOTHING TO TAKE: THE SMALL CARD SCORE WINS
	Object.assign(quiet.players.b, { moves: [hand.newCard(quiet, "move", { piece: "r" })], actives: [], passive: hand.newCard(quiet, "patience") });
	assert.equal((await cardGuyTurn(playerView(quiet, "b"), 2400, opts())).type, "passive");
});

test("a favourite card within the flair margin is played; outside it never is", async () => {
	const s = newGame({ cardGuy: "w", level: 2400, seed: 5 }), now = toFen(s);
	s.players.w.actives = [hand.newCard(s, "double-time-legendary")]; // NO DEBUFF: ITS SCORE IS THE BOARD IT LEAVES, THE ONE IT FOUND
	s.discarded = "w"; // THE FREE DISCARD USED: THE SEARCH DECIDES
	const card = s.players.w.actives[0].id, view = playerView(s, "w");
	const worth = (cp) => async (fen) => (fen === now ? cp : 0); // THE FAVOURITE'S BOARD AGAINST EVERY MOVE'S
	for (const seed of [1, 2, 3]) {
		assert.deepEqual(await cardGuyTurn(view, 2400, opts({ evaluate: worth(-(FLAIR_MARGIN - 10)), seed })), { type: "active", card });
		assert.equal((await cardGuyTurn(view, 2400, opts({ evaluate: worth(-(FLAIR_MARGIN + 10)), seed }))).type, "move");
	}
	const scored = [{ action: "best", total: 100 }, { action: "near", total: 100 - FLAIR_MARGIN, favourite: true }, { action: "far", total: 100 - FLAIR_MARGIN - 1, favourite: true }];
	assert.equal(pick(scored, 2400, () => 0.5), "near");
	assert.equal(pick([scored[0], scored[2]], 2400, () => 0.5), "best");
	assert.equal(FLAIR_MARGIN, 60);
});

test("the same view and seed give the same action", async () => {
	const s = newGame({ cardGuy: "w", level: 600, seed: 9 }), seen = new Set();
	s.discarded = "w"; // THE FREE DISCARD USED: THE SEARCH DECIDES
	const view = playerView(s, "w");
	for (let seed = 1; seed <= 12; seed++) {
		const a = await cardGuyTurn(view, 600, opts({ seed }));
		assert.deepEqual(await cardGuyTurn(view, 600, opts({ seed })), a);
		seen.add(actionKey(a));
	}
	assert.ok(seen.size > 1, "twelve seeds at level 600 all gave one action: the seed isn't used");
});

test("the noise shrinks with the level: none from 2400 up, and a lower level sometimes takes the worse candidate", () => {
	const scored = [{ action: "good", total: 100 }, { action: "bad", total: 0 }];
	let n = 0;
	const rng = () => { n = (n * 1103515245 + 12345) % 2147483648; return n / 2147483648; };
	const bad = (level) => Array.from({ length: 400 }, () => pick(scored, level, rng)).filter((a) => a === "bad").length;
	assert.equal(bad(2400), 0);
	assert.equal(bad(3200), 0);
	const low = bad(1300); // σ = 275
	assert.ok(low > 40 && low < 200, low + " of 400");
	assert.equal(noticeFor(1300), null);
	assert.equal(noticeFor(600), 0.112);
	const plain = [{ action: "move", total: 500, plain: true }, { action: "card", total: 0 }]; // LEVELS TO 1200 OVERLOOK MOVES, NEVER CARDS
	assert.ok(Array.from({ length: 200 }, () => pick(plain, 2400, rng)).every((a) => a === "move"));
	assert.ok(Array.from({ length: 200 }, () => pick(plain, 600, rng)).filter((a) => a === "card").length > 100);
	const one = 1 - Math.exp(-0.5), dice = (list) => { let i = 0; return () => list[i++ % list.length]; }; // one, 0.5 -> A NOISE OF -σ; one, 0 -> +σ
	const off = (level, total) => pick([{ action: "good", total }, { action: "bad", total: 0 }], level, dice([one, 0.5, one, 0])); // good - σ AGAINST bad + σ
	assert.deepEqual([off(2000, 199), off(2000, 201)], ["bad", "good"]); // σ = (2400 - 2000) / 4 = 100
	assert.deepEqual([off(1300, 549), off(1300, 551)], ["bad", "good"]); // σ = 275
	assert.equal(off(2400, 1), "good");
});

test("a refused free discard isn't tried again that turn: the game refuses them all alike (a check the fog guess missed, or one already used)", async () => {
	const s = newGame({ cardGuy: "w", level: 2400, seed: 3 });
	s.players.w.actives = [hand.newCard(s, "cleanse")]; // A DEAD ACTIVE, AND 2 DEAD MOVE CARDS (QUEEN, ROOK): EVERY KIND OF FREE DISCARD ON OFFER
	s.players.w.moves = ["p", "m", "q", "m", "r"].map((piece) => hand.newCard(s, "move", { piece }));
	const view = playerView(s, "w"), first = await cardGuyTurn(view, 2400, opts());
	assert.equal(first.type, "discard");
	assert.notEqual((await cardGuyTurn(view, 2400, opts({ refused: [actionKey(first)] }))).type, "discard");
});

test("the low levels overlook a plain move, see a capture, check or promotion 3 times as often, and always see one move", () => {
	const moves = [{ action: "best", total: 100, plain: true }, { action: "worst", total: 0, plain: true }];
	assert.equal(pick(moves, 600, () => 0.99), "worst"); // NOTHING NOTICED: ONE AT RANDOM (THE LAST HERE), NOT THE BEST OF ALL
	const card = { action: "card", total: -50 };
	assert.equal(pick([moves[0], card], 600, () => 0.99), "card"); // A CARD IS ALWAYS SEEN
	assert.equal(pick([moves[0], card], 1300, () => 0.99), "best"); // FROM 1300 UP NOTHING IS OVERLOOKED
	const quiet = { action: "quiet", total: 100, plain: true }, takes = { action: "takes", total: 0, plain: true, standsOut: true };
	assert.equal(pick([quiet, takes], 600, () => 0.33), "takes"); // 0.112 * 3 = 0.336: ONLY THE CAPTURE IS NOTICED
	assert.equal(pick([quiet, takes], 600, () => 0.34), "quiet"); // NEITHER: ONE AT RANDOM (THE FIRST HERE)
});

test("Card Guy's input contains no hidden visitor cards", async (t) => {
	const s = newGame({ cardGuy: "b", level: 1300, seed: 4 });
	s.board.turn = "b";
	const view = playerView(s, "b"), hidden = [...s.players.w.moves, ...s.players.w.actives].map((c) => "\"" + c.id + "\"");
	assert.ok(hidden.length >= 6); // 5 MOVE CARDS & THE ACTIVE
	const spy = t.mock.method(engine, "fromView");
	await cardGuyTurn(view, 1300, opts());
	assert.ok(spy.mock.callCount() >= 1);
	assert.equal(spy.mock.calls[0].arguments[1], 7); // THE FIRST GUESS IS THE SEED'S
	assert.equal(new Set(spy.mock.calls.map((c) => c.arguments[1])).size, spy.mock.callCount()); // NO GUESS IS MADE TWICE
	for (const call of spy.mock.calls) {
		const json = JSON.stringify(call.arguments[0]);
		assert.deepEqual(call.arguments[0], view);
		assert.ok(!json.includes("\"rng\"") && !hidden.some((id) => json.includes(id)));
	}
});

test("a turn stays within 24 evaluations and 3 s with an 80 ms engine", async () => {
	const s = newGame({ cardGuy: "w", level: 2400, seed: 6 }), fens = new Set();
	s.players.w.actives = ["swap", "conscription", "trapdoor"].map((k) => hand.newCard(s, k));
	s.discarded = "w"; // THE FREE DISCARD USED: THE SEARCH DECIDES
	const wait = () => new Promise((done) => setTimeout(done, 80));
	const slow = async (fen) => { fens.add(fen); await wait(); return material(fen); };
	const started = Date.now();
	const a = await cardGuyTurn(playerView(s, "w"), 2400, opts({ evaluate: slow, bestOf: async (fen, lans) => { await wait(); return firstOf(fen, lans); } }));
	assert.ok(Date.now() - started < 3000, "took " + (Date.now() - started) + " ms");
	assert.ok(isLegal(s, "w", a));
	assert.equal(MAX_EVALS, 24);
	assert.ok(fens.size <= MAX_EVALS && fens.size > 6, fens.size + " boards evaluated");
});

test("if evaluate and bestOf throw, Card Guy still plays a legal action (static score and card score)", async (t) => {
	const logged = t.mock.method(console, "log", () => {});
	const s = position("4k3/8/8/r2Q4/8/8/8/4K3 b - - 0 1");
	Object.assign(s.players.b, { moves: [hand.newCard(s, "move", { piece: "r" }), hand.newCard(s, "move", { piece: "r" })], actives: [], passive: null });
	const a = await cardGuyTurn(playerView(s, "b"), 2400, opts({ evaluate: down, bestOf: down }));
	assert.deepEqual([a.type, a.from, a.to], ["move", "a5", "d5"]); // THE TOP STATIC SCORE: THE FREE QUEEN
	assert.ok(logged.mock.calls.length >= 1 && logged.mock.calls.every((c) => String(c.arguments[0]).startsWith("STOCKFISH FAILED, js-chess-engine PLAYS INSTEAD: ")));
	s.players.b.passive = hand.newCard(s, "patience"); // EVERY BOARD SCORES 0 NOW: THE CARD SCORE DECIDES
	assert.equal((await cardGuyTurn(playerView(s, "b"), 2400, opts({ evaluate: down, bestOf: down }))).type, "passive");
	const only = await cardGuyTurn(playerView(s, "b"), 2400, opts({ bestOf: down })); // ONLY bestOf DOWN: THE BOARD SCORE STILL DECIDES
	assert.deepEqual([only.type, only.to], ["move", "d5"]);
	const r = await play(newGame({ cardGuy: "b", level: 1300, seed: 8 }), 12, { evaluate: down, bestOf: down });
	assert.equal(r.refused, 0);
});

test("40 card candidates: all are scored, evaluate is called at most 24 times", async () => {
	const s = newGame({ cardGuy: "w", level: 2400, seed: 6 });
	let calls = 0;
	s.players.w.actives = ["swap", "conscription", "trapdoor"].map((k) => hand.newCard(s, k));
	const scored = await scoreTurn(playerView(s, "w"), opts({ evaluate: async (fen) => { calls++; return material(fen); } }));
	const cards = scored.filter((c) => !c.plain);
	assert.ok(cards.length >= 40, cards.length + " card candidates");
	assert.ok(scored.every((c) => Number.isFinite(c.total) && isLegal(s, "w", c.action)));
	assert.ok(new Set(cards.map((c) => c.total)).size > 1);
	assert.ok(calls <= 24 && calls > 6, calls + " calls");
	assert.ok(scored.filter((c) => c.plain).length <= 6); // bestPlain AND THE TOP 5
	const flat = await scoreTurn(playerView(s, "w"), opts({ evaluate: async () => 5000 }));
	assert.ok(flat.length > MAX_EVALS && flat.every((c) => c.total > 4000), "a candidate past the 24 scored without the board now"); // THE BOARD NOW + ITS CARD SCORE, NOT THE CARD SCORE ALONE
});

test("Card Guy answers a pending choice, a duel pick, a duel stop and the second move of Double Time", async () => {
	const seen = new Set(), picks = new Set();
	for (let seed = 1; seed <= 30 && (seen.size < 3 || picks.size < 2); seed++) {
		let s = newGame({ cardGuy: "w", level: 2400, seed });
		s.players.w.actives = [hand.newCard(s, "all-or-nothing")];
		const pawn = s.board.sq.find((q) => q && q.c === "w" && q.t === "p").id;
		s = applyAction(s, "w", { type: "active", card: s.players.w.actives[0].id, target: { piece: pawn } }).state;
		for (let i = 0; i < 40 && (s.duel || (s.pending && s.pending.player === "w")); i++) {
			const c = owes(s);
			const a = c === "w" ? (await ask(s, "w", { seed: seed * 100 + i })).action : legalActions(s, "b")[0];
			if (c === "w") seen.add(a.type === "choice" ? "choice" : a.pick !== undefined ? "pick" : "decide");
			if (c === "w" && i === 0) picks.add(a.pick);
			if (c === "w" && a.stop !== undefined) assert.equal(a.stop, true); // ONE WIN IN HAND: THE NEXT STEP ISN'T WORTH THE PIECE AND THE WHOLE HAND
			s = applyAction(s, c, a).state;
		}
		assert.equal(s.duel, null);
	}
	assert.deepEqual([...seen].sort(), ["choice", "decide", "pick"]);
	assert.ok(picks.size > 1, "every first pick was card " + [...picks]); // RANDOM, FROM THE SEED

	let s = newGame({ cardGuy: "w", level: 2400, seed: 2 });
	s.players.w.actives = [hand.newCard(s, "double-time")];
	s = applyAction(s, "w", { type: "active", card: s.players.w.actives[0].id }).state;
	const first = (await ask(s, "w", {})).action;
	s = applyAction(s, "w", first).state;
	assert.equal(s.board.turn, "w");
	const second = (await ask(s, "w", {})).action;
	assert.ok(first.type === "move" && second.type === "move" && second.from !== first.to);
	assert.equal(applyAction(s, "w", second).state.multi, null);
});
