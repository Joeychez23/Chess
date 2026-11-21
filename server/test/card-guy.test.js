/*
 *  card-guy.test.js  --  chess server tests
 *	Card Guy, the card-game bot (server/utils/card-guy): candidates, scoring and the pick. The engine is stubbed: no test reaches Stockfish.
 *
 */

require("./helpers/env.js");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../../cards-engine/index.js");
const { newGame, legalActions, applyAction, playerView, actionKey, toFen } = engine;
const { fromFen } = engine.board;
const hand = require("../../cards-engine/hand.js");
const { makeCtx } = require("../../cards-engine/ctx.js");
const { PASSIVE_KEYS } = require("../../cards-engine/cards/index.js");
const cardGuy = require("../utils/card-guy/index.js");
const { cardGuyTurn, scoreTurn, MAX_EVALS } = cardGuy;
const { candidates, staticScore } = require("../utils/card-guy/candidates.js");
const { cardScore, duelValue, WEIGHTS } = require("../utils/card-guy/score.js");
const { pick, FLAIR_MARGIN } = require("../utils/card-guy/pick.js");
const { noticeFor, bestOf } = require("../utils/ai.js");
const { Chess } = require("chess.js");

const other = (c) => (c === "w" ? "b" : "w");
const VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const material = async (fen) => [...fen.split(" ")[0]].reduce((sum, ch) => sum + (/[a-z]/i.test(ch) ? (ch === ch.toUpperCase() ? 1 : -1) * VALUE[ch.toLowerCase()] : 0), 0); // CENTIPAWNS FROM WHITE'S SIDE
const firstOf = async (fen, lans) => ({ from: lans[0].slice(0, 2), to: lans[0].slice(2, 4), promotion: lans[0][4] });
const down = async () => { throw new Error("engine is down"); };
const opts = (o) => ({ evaluate: material, bestOf: firstOf, seed: 7, ...o });
const isLegal = (s, c, a) => legalActions(s, c).some((x) => actionKey(x) === actionKey(a));
const owes = (s) => [s.board.turn, other(s.board.turn)].find((c) => legalActions(s, c).length);
const fogUp = (s, owner, key = "fog-of-war-rare", left = 40) => { const ctx = makeCtx(s); ctx.trigger = () => {}; ctx.enchant(owner, key, [], left); };
const hasFog = (s, c) => s.enchant.some((e) => e.owner === c && e.key.startsWith("fog-of-war"));
const place = (s, key, owner, more = {}) => { const card = { ...hand.newCard(s, key), ...more }; s.effects.push({ id: card.id, owner, card, placedAt: s.ply }); }; // A PASSIVE ALREADY WAITING
const FOGGED_SWAP = JSON.parse('{"v":1,"rng":{"key":[1003,0,0,0,0,0,0,0],"n":276},"board":{"sq":[{"id":"b10","c":"b","t":"r"},{"id":"b8","c":"b","t":"n"},null,null,null,{"id":"w3","c":"w","t":"n"},null,null,{"id":"b3","c":"b","t":"p"},null,null,{"id":"b9","c":"b","t":"q"},{"id":"b13","c":"b","t":"n"},null,null,null,null,null,null,null,null,{"id":"b7","c":"b","t":"p"},null,{"id":"b2","c":"b","t":"r"},null,{"id":"w11","c":"w","t":"p"},{"id":"b12","c":"b","t":"k"},null,{"id":"w8","c":"w","t":"k"},{"id":"w12","c":"w","t":"p"},null,null,null,null,null,null,null,null,null,{"id":"b11","c":"b","t":"p"},null,null,null,{"id":"w1","c":"w","t":"p"},{"id":"b15","c":"b","t":"p"},{"id":"w16","c":"w","t":"p"},null,null,{"id":"w14","c":"w","t":"r"},null,null,null,null,null,{"id":"w15","c":"w","t":"p"},{"id":"w13","c":"w","t":"p"},null,{"id":"w2","c":"w","t":"n"},{"id":"w4","c":"w","t":"b"},{"id":"w10","c":"w","t":"q"},{"id":"b16","c":"b","t":"b"},{"id":"w6","c":"w","t":"b"},null,{"id":"w7","c":"w","t":"r"}],"turn":"w","castling":"-","ep":null,"half":0,"full":28,"history":[]},"cardGuy":"w","level":1300,"ply":54,"nextId":98,"players":{"w":{"king":true,"moves":[{"id":"c68","key":"move","piece":"p"},{"id":"c69","key":"move","piece":"p"},{"id":"c77","key":"move","piece":"n"},{"id":"c80","key":"move","piece":"p"},{"id":"c83","key":"move","piece":"n"},{"id":"c85","key":"move","piece":"n"}],"actives":[{"id":"c97","key":"swap-epic"}],"passive":null,"curses":[],"used":[],"skips":0,"refillLock":0,"curseWait":0,"lostTurns":0,"kingSkulls":3,"captured":["p","p"],"seen":null},"b":{"king":true,"moves":[{"id":"c12","key":"move","piece":"p"},{"id":"c46","key":"move","piece":"p"},{"id":"c88","key":"move","piece":"p"},{"id":"c92","key":"move","piece":"p"},{"id":"c94","key":"move","piece":"p"},{"id":"c96","key":"move","piece":"p"}],"actives":[{"id":"c61","key":"pickpocket-epic"}],"passive":{"id":"c39","key":"reinforcements"},"curses":[],"used":[],"skips":0,"refillLock":0,"curseWait":0,"lostTurns":0,"kingSkulls":3,"captured":["p","p","p","b","b"],"seen":null}},"statuses":{"w7":[{"s":"warded","left":null,"by":"w"}],"b3":[{"s":"frozen","left":1,"by":"b","veiled":true}]},"effects":[{"id":"c43","owner":"w","card":{"id":"c43","key":"phalanx","denied":false},"placedAt":52}],"enchant":[{"id":"e30","key":"fog-of-war-rare","owner":"b","pieces":[],"left":36,"data":{}},{"id":"e52","key":"stronghold-common","owner":"w","pieces":["w7"],"left":null,"data":{}}],"duel":null,"pending":null,"multi":null,"barred":null,"result":null}'); // A REVIEW FUZZ STATE (tremor, GAME 3, ACTION 66; ITS HISTORY CUT): CARD GUY WHITE, LEVEL 1300, AN EPIC SWAP IN HAND UNDER BLACK'S FOG: 115 CANDIDATES

/**
 * @description Why a chess engine can't be asked about this board (chess.js refuses it, or the side not to move is in check), null when it can.
 */
function notChess(fen) {
	let chess;
	try { chess = new Chess(fen); } catch (err) { return err.message; }
	const turn = chess.turn();
	return chess.isAttacked(chess.findPiece({ type: "k", color: other(turn) })[0], turn) ? "the side not to move is in check" : null;
}

/**
 * @description A game on this board (ids as board.fromFen numbers them), Card Guy the side to move unless told, both hands as newGame dealt them.
 */
function position(fen, { cardGuy: v = fen.split(" ")[1], level = 2400, seed = 1 } = {}) {
	const s = newGame({ cardGuy: v, level, seed });
	s.board = fromFen(fen);
	return s;
}

/**
 * @description Card Guy's action for color on the true state: asked again with each refused action until one is legal (only a Fog of War of the other side's may refuse one). Returns { action, refused: how many }.
 */
async function ask(s, c, o) {
	const refused = [];
	for (;;) {
		const action = await cardGuyTurn(playerView(s, c), s.level, opts({ ...o, refused }));
		if (isLegal(s, c, action)) return { action, refused: refused.length };
		assert.ok(hasFog(s, other(c)), "an illegal action with no fog up: " + JSON.stringify(action));
		assert.ok(!refused.includes(actionKey(action)), "a refused action came back: " + JSON.stringify(action));
		assert.ok(refused.length < 80, "80 refusals in one turn");
		refused.push(actionKey(action));
	}
}

/**
 * @description Card Guy plays both sides of s for up to n actions (each tested against applyAction on the true state). Returns { state, actions, refused, foggy: the turns asked with the other side's fog up }.
 */
async function play(s, n, o = {}) {
	let actions = 0, refused = 0, foggy = 0;
	while (actions < n && !s.result) {
		const c = owes(s), r = await ask(s, c, { seed: (o.seed || 0) * 1000 + actions, ...o });
		if (hasFog(s, other(c))) { foggy++; }
		s = applyAction(s, c, r.action).state; // THROWS IF IT ISN'T LEGAL
		refused += r.refused;
		actions++;
	}
	return { state: s, actions, refused, foggy };
}

test("Card Guy only ever returns an action in legalActions", async () => {
	for (const seed of [1, 2, 3]) {
		const r = await play(newGame({ cardGuy: "b", level: [600, 1300, 2400][seed - 1], seed }), 40, { seed }); // ask FAILS ON AN ILLEGAL ACTION UNLESS THE OTHER SIDE'S FOG OF WAR IS UP (ONE IS PLAYED IN THESE GAMES)
		assert.ok(r.actions === 40 || r.state.result);
		assert.ok(r.refused <= 2 * r.foggy, r.refused + " refusals over " + r.foggy + " turns under a fog"); // NONE WITH NO FOG UP, A FEW UNDER ONE (1 OVER 3 TURNS IN THE FIRST GAME), NOT A TURN OF THEM
	}
});

test("Card Guy's free discard, at every level: the active when it has no play, else 2 move cards with no move, else none; never a scored candidate", async () => {
	for (const level of [600, 1300, 2400]) {
		const s = newGame({ cardGuy: "w", level, seed: 3 }); // WHITE TO MOVE AT THE START: BISHOP & QUEEN CARDS HAVE NO MOVE, PAWN & KNIGHT CARDS DO
		const card = (piece) => hand.newCard(s, "move", { piece });
		s.players.w.actives = [hand.newCard(s, "heavy-cavalry")]; // NO KNIGHT IT CAN SEND YET: NO PLAY (UNCOMMON: CLEANSE AND RARE+ ARE KEPT, RULING R1)
		s.players.w.moves = [card("p"), card("b"), card("q"), card("n")];
		const dead = s.players.w.actives[0].id, turn = (st) => cardGuyTurn(playerView(st, "w"), level, opts());
		assert.deepEqual(await turn(s), { type: "discard", cards: [dead] }, level + ": the dead active");
		s.players.w.actives = [hand.newCard(s, "swap")]; // A LIVE ACTIVE: THE 2 DEAD MOVE CARDS GO
		assert.deepEqual(await turn(s), { type: "discard", cards: [s.players.w.moves[1].id, s.players.w.moves[2].id] }, level + ": the 2 dead move cards");
		s.players.w.moves.splice(2, 1); // ONE DEAD MOVE CARD: KEPT
		assert.notEqual((await turn(s)).type, "discard", level + ": one dead card");
		s.players.w.actives = [hand.newCard(s, "heavy-cavalry")];
		s.discarded = "w"; // USED THIS TURN
		assert.notEqual((await turn(s)).type, "discard", level + ": used");
	}
	const s = newGame({ cardGuy: "w", level: 2400, seed: 3 }), still = toFen(s).split(" ")[0];
	Object.assign(s.players.w, { moves: ["p", "p", "n"].map((piece) => hand.newCard(s, "move", { piece })), actives: [] }); // NO DEAD CARD: THE STEP DOESN'T DISCARD
	const lazy = async (fen) => (fen.split(" ")[0] === still ? 5000 : 0); // AN ENGINE THAT LOVES A BOARD NOBODY MOVED ON: A DISCARD, WERE IT SCORED
	assert.ok(legalActions(s, "w").some((a) => a.type === "discard"));
	assert.ok(!candidates(engine.fromView(playerView(s, "w"), 1), "w").some((a) => a.type === "discard"));
	for (const seed of [1, 2, 3, 4]) assert.notEqual((await cardGuyTurn(playerView(s, "w"), 600, opts({ evaluate: lazy, seed }))).type, "discard");
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
	s.players.w.actives = [hand.newCard(s, "cleanse")]; // A DEAD ACTIVE, AND 3 DEAD MOVE CARDS: EVERY KIND OF FREE DISCARD ON OFFER
	s.players.w.moves = ["p", "b", "q", "n", "r"].map((piece) => hand.newCard(s, "move", { piece }));
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
	assert.ok(hidden.length >= 7);
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
			if (c === "w" && a.stop !== undefined) assert.equal(a.stop, true); // ONE WIN IN HAND: THE NEXT STEP ISN'T WORTH THE PIECE AND SIX CARDS
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

test("candidates keep bestPlain and the top 5 plain moves by static score, and every card action but the free discard", () => {
	const s = position("4k3/8/8/r2Q4/8/8/8/4K3 b - - 0 1");
	Object.assign(s.players.b, { moves: [hand.newCard(s, "move", { piece: "r" }), hand.newCard(s, "move", { piece: "r" })], actives: [hand.newCard(s, "fog-of-war")], passive: hand.newCard(s, "patience") });
	const quiet = { from: "a5", to: "a8" }, all = legalActions(s, "b"), list = candidates(s, "b", { bestPlain: quiet });
	const plain = list.filter((a) => a.type === "move");
	assert.deepEqual([plain[0].from, plain[0].to], ["a5", "a8"]); // bestPlain FIRST
	assert.deepEqual([plain[1].from, plain[1].to], ["a5", "d5"]); // THEN THE BEST STATIC SCORE
	assert.equal(plain.length, 6);
	assert.equal(new Set(plain.map((a) => a.from + a.to)).size, 6); // TWO ROOK CARDS: ONE CANDIDATE A MOVE
	assert.deepEqual(list.filter((a) => a.type !== "move"), all.filter((a) => a.type !== "move" && a.type !== "discard"));
	assert.ok(all.some((a) => a.type === "discard") && !list.some((a) => a.type === "discard"));
	assert.ok(staticScore(s, { from: "a5", to: "d5" }) > staticScore(s, { from: "a5", to: "a1" })); // A CAPTURE OVER A CHECK
	assert.ok(staticScore(s, { from: "a5", to: "a1" }) > staticScore(s, quiet)); // A CHECK OVER A QUIET MOVE
	const promo = position("4k3/8/8/8/8/8/p7/4K3 b - - 0 1");
	assert.ok(staticScore(promo, { from: "a2", to: "a1", promotion: "q" }) > staticScore(promo, { from: "a2", to: "a1", promotion: "n" }));
	assert.equal(legalActions(s, "b").filter((a) => a.to === "d5").length, 2); // ONE PER ROOK CARD
	assert.equal(candidates(s, "b", { refused: [actionKey(plain[1])] }).filter((a) => a.to === "d5").length, 0); // A REFUSED MOVE ISN'T OFFERED AGAIN UNDER THE OTHER ROOK CARD
	assert.equal(staticScore(s, { from: "a5", to: "d5" }), 900 - 500 / 10); // THE VICTIM LESS A TENTH OF THE ATTACKER
	assert.ok(!candidates(s, "b", { refused: [actionKey({ type: "passive" })] }).some((a) => a.type === "passive"));
});

test("the card score weighs what the engine can't see", () => {
	const s = newGame({ cardGuy: "w", level: 2400, seed: 1 }), after = JSON.parse(JSON.stringify(s));
	assert.equal(cardScore(s, s, "w"), 0);
	const mine = s.board.sq.find((q) => q && q.c === "w" && q.t === "p").id, theirs = s.board.sq.filter((q) => q && q.c === "b").map((q) => q.id);
	after.statuses = { [mine]: [{ s: "warded", left: 3 }, { s: "marked", left: 3 }], [theirs[0]]: [{ s: "frozen", left: 3 }], [theirs[1]]: [{ s: "shaken", left: 3 }] };
	assert.equal(cardScore(s, after, "w"), WEIGHTS.warded + WEIGHTS.markedOwn + WEIGHTS.frozenEnemy + WEIGHTS.shakenEnemy);
	assert.equal(cardScore(s, after, "b"), 0); // FROM THE OTHER SIDE NONE OF THESE HAS A WEIGHT
	const b = JSON.parse(JSON.stringify(s));
	b.players.b.curses.push({ id: "c90", key: "rust" });
	b.players.w.curses.push({ id: "c91", key: "debt" });
	b.players.w.moves.pop();
	b.players.w.moves.pop();
	b.players.w.lostTurns = 1;
	b.ply++; // THE TURN ENDED: BOTH CARDS ARE GONE FOR GOOD
	b.effects.push({ id: "c92", owner: "w", card: { id: "c92", key: "patience" }, placedAt: 0 });
	assert.equal(cardScore(s, b, "w"), WEIGHTS.curseGiven + WEIGHTS.curseHeld + 2 * WEIGHTS.cardLost + WEIGHTS.turnSkipped + WEIGHTS.passiveWaiting);
	const c = JSON.parse(JSON.stringify(s));
	c.players.w.moves.push({ id: "c93", key: "move", piece: "p" });
	c.players.w.skips = 1; // AN OLD STATE'S SKIP COUNT: NO LONGER SCORED
	assert.equal(cardScore(s, c, "w", [{ type: "passive-cancelled", player: "b" }, { type: "passive-cancelled", player: "w" }]), WEIGHTS.cardGained + WEIGHTS.enemyPassiveCancelled);
	const open = JSON.parse(JSON.stringify(s));
	open.players.w.actives.pop(); // AN ACTIVE THAT LEAVES THE TURN OPEN: ITS SLOT REFILLS WHEN THE TURN ENDS
	assert.equal(cardScore(s, open, "w"), 0);
	open.ply++;
	assert.equal(cardScore(s, open, "w"), WEIGHTS.cardLost);
	assert.deepEqual(WEIGHTS, { warded: 120, frozenEnemy: 90, shakenEnemy: 60, markedOwn: -40, curseGiven: 150, curseHeld: -150, cardLost: -35, cardGained: 35, passiveWaiting: 80, turnSkipped: -200, enemyPassiveCancelled: 80 });
});

test("bestOf asks the engine for the best of the given moves only, and throws when it can't answer", async (t) => {
	const bodies = [], real = globalThis.fetch;
	t.after(() => { globalThis.fetch = real; });
	globalThis.fetch = async (url, init) => { bodies.push(JSON.parse(init.body)); return new Response(JSON.stringify({ type: "bestmove", from: "e2", to: "e4" }), { status: 200 }); };
	const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
	assert.deepEqual(await bestOf(fen, ["e2e4", "d2d4"]), { from: "e2", to: "e4", promotion: undefined });
	assert.equal(bodies[0].searchmoves, "e2e4 d2d4");
	assert.equal(bodies[0].fen, fen);
	globalThis.fetch = async () => new Response(JSON.stringify({ type: "info", text: "busy" }), { status: 503 });
	await assert.rejects(bestOf(fen, ["e2e4"]), /busy/);
});

test("the production evaluate turns an analysis into centipawns from White's side", async (t) => {
	const real = globalThis.fetch, fen = "4k3/8/8/8/8/8/8/R3K3 w - - 0 1";
	t.after(() => { globalThis.fetch = real; require("../utils/ai.js").clearAnalyses(); });
	const answer = (body) => { require("../utils/ai.js").clearAnalyses(); globalThis.fetch = async () => new Response(JSON.stringify({ type: "bestmove", from: "a1", to: "a8", winChance: 90, ...body }), { status: 200 }); };
	answer({ eval: 4.5 });
	assert.equal(await cardGuy.evaluate(fen), 450);
	answer({ eval: 99, mate: 3 });
	assert.equal(await cardGuy.evaluate(fen), 10000);
	answer({ eval: -99, mate: -2 });
	assert.equal(await cardGuy.evaluate(fen), -10000);
	answer({});
	await assert.rejects(cardGuy.evaluate(fen));
});

test("Card Guy plays on from a view with a Hollow Crown (King card held or lost) or a waiting Mirage, on either side", async () => {
	for (const kind of [0, 1, 2, 3]) {
		const s = newGame({ cardGuy: "b", level: 1300, seed: 20 + kind }), ctx = makeCtx(s);
		ctx.trigger = () => {};
		if (kind < 2) assert.ok(ctx.giveCurse("b", "hollow-crown", "w")); // CARD GUY HOLDS IT
		if (kind === 1) s.players.b.king = false;
		if (kind >= 2) assert.ok(ctx.giveCurse(kind === 2 ? "w" : "b", "mirage", kind === 2 ? "b" : "w"));
		const r = await play(s, 24, { seed: kind });
		assert.equal(r.refused, 0);
		assert.ok(r.actions === 24 || r.state.result);
	}
});

test("under the player's Fog of War Card Guy still reaches a legal action, also with a hidden Tremor Frozen on a fogged pawn", async () => {
	let turns = 0, refused = 0, worst = 0;
	for (const seed of [1, 2, 3]) {
		let s = newGame({ cardGuy: "b", level: 1300, seed: 30 + seed });
		s = (await play(s, 6, { seed })).state; // A FEW MOVES FIRST, SO LINES ARE OPEN
		fogUp(s, "w");
		const pawn = s.board.sq.find((q, i) => q && q.c === "w" && q.t === "p" && i >= 32).id;
		s.statuses[pawn] = [...(s.statuses[pawn] || []), { s: "frozen", left: 3, by: "w", veiled: true }];
		assert.equal(playerView(s, "b").statuses[pawn], undefined);
		assert.ok(playerView(s, "b").board.hidden > 0);
		for (let i = 0; i < 30 && !s.result; i++) {
			const c = owes(s), r = await ask(s, c, { seed: seed * 1000 + i });
			if (c === "b") { turns++; refused += r.refused; worst = Math.max(worst, r.refused); }
			s = applyAction(s, c, r.action).state;
		}
	}
	assert.ok(turns >= 30);
	assert.ok(refused <= turns && worst <= 6, refused + " refusals in " + turns + " turns, " + worst + " in one"); // MEASURED: 20 IN 44 TURNS, 3 IN ONE (A REFUSAL IS A WHOLE TURN THOUGHT AGAIN)
	console.log("    under the player's fog: " + turns + " Card Guy actions, " + refused + " refused first, at most " + worst + " in one turn");
});

test("All or Nothing is scored by its expected value, not played out", async () => {
	for (const [key, value] of [["all-or-nothing", 0.5 * 225 - 0.5 * (6 * 35 + 100)], ["all-or-nothing-epic", 0.5 * 225 - 0.5 * 100], ["all-or-nothing-legendary", 0.5 * 225 - 0.5 * 6 * 35]]) {
		const s = newGame({ cardGuy: "w", level: 2400, seed: 2 });
		s.players.w.actives = [hand.newCard(s, key)];
		const pawn = s.board.sq.find((q) => q && q.c === "w" && q.t === "p").id, rook = s.board.sq.find((q) => q && q.c === "w" && q.t === "r").id;
		const scored = await scoreTurn(playerView(s, "w"), opts({ evaluate: async () => 40 }));
		const on = (piece) => scored.find((c) => c.action.type === "active" && c.action.target.piece === piece);
		assert.equal(on(pawn).total, 40 + value); // THE BOARD AS IT STANDS + THE GAMBLE
		assert.ok(on(pawn).favourite && on(rook).favourite);
		assert.equal(on(rook).total < on(pawn).total, key !== "all-or-nothing-legendary"); // A ROOK RISKS MORE FOR ITS QUEEN, UNLESS THE PIECE ISN'T AT STAKE
	}
});

test("a first move of a two-move turn that leaves the king for another piece to take is worth the game", async () => {
	let s = position("4k3/5N2/8/7Q/8/8/8/4K3 w - - 0 1"); // THE KNIGHT STEPS OFF THE QUEEN'S LINE TO e8
	Object.assign(s.players.w, { moves: [hand.newCard(s, "move", { piece: "n" }), hand.newCard(s, "move", { piece: "q" })], actives: [hand.newCard(s, "double-time-legendary")], passive: null });
	s.players.b.kingSkulls = 0; // NO SKULL ENDS THE TWO-MOVE TURN ON THE CHECK: THE SECOND MOVE TAKES THE KING
	s = applyAction(s, "w", { type: "active", card: s.players.w.actives[0].id }).state;
	const quiet = async () => ({ from: "h5", to: "h4" }), o = opts({ evaluate: async () => 0, bestOf: quiet });
	const a = await cardGuyTurn(playerView(s, "w"), 2400, o);
	assert.equal(a.from, "f7");
	s = applyAction(s, "w", a).state;
	assert.equal(s.board.turn, "w");
	assert.equal(applyAction(s, "w", await cardGuyTurn(playerView(s, "w"), 2400, o)).state.result.reason, "king");
	let lone = position("4k3/8/8/8/8/8/8/R3K3 w - - 0 1"); // THE ROOK'S CHECK ON a8 WINS NOTHING: THE SECOND MOVE IS THE KING'S
	Object.assign(lone.players.w, { moves: [hand.newCard(lone, "move", { piece: "r" })], actives: [hand.newCard(lone, "double-time-legendary")], passive: null });
	lone.players.b.kingSkulls = 0;
	lone = applyAction(lone, "w", { type: "active", card: lone.players.w.actives[0].id }).state;
	const scored = await scoreTurn(playerView(lone, "w"), opts({ evaluate: async () => 30 }));
	assert.equal(scored.find((c) => c.action.to === "a8").total, 30);
});

test("when the real game refused every action of its guesses Card Guy plays on the board it can see; with nothing hidden it has none left", async (t) => {
	const logged = t.mock.method(console, "log", () => {});
	const s = position("3r3k/8/8/8/8/8/PPPPPPPP/RNBQKBNR b - - 0 1", { level: 1300 });
	Object.assign(s.players.b, { moves: [hand.newCard(s, "move", { piece: "r" })], actives: [], passive: null });
	const guessed = (view) => [7, 16, 25].flatMap((seed) => legalActions(engine.fromView(view, seed), "b").map(actionKey)); // THE THREE GUESSES OF SEED 7 (index.js simulate)
	await assert.rejects(cardGuyTurn(playerView(s, "b"), 1300, opts({ refused: guessed(playerView(s, "b")) })), /no action/);
	await assert.rejects(cardGuyTurn(playerView(s, "w"), 1300, opts()), /no action/); // NOT ITS TURN
	const over = position("3r3k/8/8/8/8/8/PPPPPPPP/RNBQKBNR b - - 0 1", { level: 1300 });
	over.result = { winner: "w", reason: "resign" };
	await assert.rejects(cardGuyTurn(playerView(over, "b"), 1300, opts()), /no action/); // THE GAME IS OVER: THE CALLER CATCHES IT (TASK 17)
	fogUp(s, "w");
	const view = playerView(s, "b"), refused = guessed(view);
	assert.equal(view.board.hidden, 16);
	const a = await cardGuyTurn(view, 1300, opts({ refused, evaluate: down, bestOf: down })); // THE ENGINE ISN'T ASKED ABOUT A BOARD WITH NO WHITE KING
	assert.ok(!refused.includes(actionKey(a)) && a.from === "d8" && ["d2", "d1"].includes(a.to), JSON.stringify(a)); // EVERY GUESS HAD A PIECE IN THE WAY
	assert.equal(logged.mock.callCount(), 0); // NOT ASKED, SO NO ENGINE ALARM
});

test("with no fog up Card Guy's own Peasant Immunity or Phalanx never leads it to an illegal action", async () => {
	const s = position("1k6/8/5p2/3p4/3PK3/8/8/2R5 w - - 0 1"); // d5 CHECKS e4 AND IS STOPPED; f6 ATTACKS e5 FOR REAL
	place(s, "peasant-immunity", "w", { stopping: [s.board.sq[engine.board.sqIndex("d5")].id] });
	assert.ok(!legalActions(s, "w").some((a) => a.to === "e5"));
	const still = toFen(s), stay = async (fen) => (fen === still ? 900 : 0); // AN ENGINE THAT LIKES THE BOARD AS IT STANDS: e4-e5 LEAVES NO CHESS POSITION, SO IT WOULD SCORE AS THAT BOARD
	const r = await ask(s, "w", { evaluate: stay, bestOf: async () => ({ from: "e4", to: "e5" }) });
	assert.equal(r.refused, 0);
	assert.notEqual(r.action.to, "e5");
	for (const [key, owner] of [["phalanx", "w"], ["phalanx", "b"], ["peasant-immunity", "w"], ["peasant-immunity", "b"]]) {
		const g = newGame({ cardGuy: "b", level: 1300, seed: 41 });
		place(g, key, owner);
		assert.equal((await play(g, 16, { seed: 41 })).refused, 0);
	}
	let g = position("4k3/8/8/2p5/1PPP4/8/8/4K2N w - - 0 1"), denied = 0; // c5 COULD TAKE b4 OR d4 BUT FOR WHITE'S PHALANX. WHITE HOLDS NO PAWN CARD, SO c5 STAYS
	Object.assign(g.players.w, { moves: [hand.newCard(g, "move", { piece: "n" })], actives: [], passive: null });
	place(g, "phalanx", "w");
	for (let n = 0; n < 6 && !g.result; n++) {
		const c = owes(g), r = await ask(g, c, { seed: 50 + n });
		assert.equal(r.refused, 0);
		g = applyAction(g, c, r.action).state;
		const waiting = g.effects.find((e) => e.card.key === "phalanx");
		if (waiting && waiting.card.denied) { denied++; assert.equal(playerView(g, "w").effects.find((e) => e.card.key === "phalanx").card.denied, true); }
	}
	assert.ok(denied > 0, "Phalanx never denied a capture here"); // THE LOOP DID PLAY WITH denied SET
});

test("the engine is only asked about chess positions: no en passant square for the wrong side, no king left to take, and no engine alarm for a board it isn't asked about", async (t) => {
	const logged = t.mock.method(console, "log", () => {}), sent = [];
	const o = opts({ evaluate: async (fen) => { sent.push(fen); return material(fen); }, bestOf: async (fen, lans) => { sent.push(fen); return firstOf(fen, lans); } });
	let s = position("rnbqkbnr/ppp1pppp/8/8/3p4/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"); // d4 COULD TAKE e3 IN PASSING
	Object.assign(s.players.w, { moves: [hand.newCard(s, "move", { piece: "p" }), hand.newCard(s, "move", { piece: "n" })], actives: [hand.newCard(s, "double-time-legendary")] });
	s = applyAction(s, "w", { type: "active", card: s.players.w.actives[0].id }).state;
	s = applyAction(s, "w", legalActions(s, "w").find((a) => a.from === "e2" && a.to === "e4")).state; // WHITE MOVES AGAIN, THE STATE'S EN PASSANT SQUARE IS e3
	assert.match(toFen(s), / w KQkq e3 /);
	assert.ok(isLegal(s, "w", await cardGuyTurn(playerView(s, "w"), 2400, o)));
	assert.ok(sent.length > 3 && sent.every((fen) => fen.split(" ")[3] !== "e3"));
	assert.equal(sent.filter((fen) => fen === toFen(s).replace(" e3 ", " - ")).length, 2); // THE BOARD NOW IS STILL ASKED ABOUT (bestOf & evaluate), WITHOUT THE SQUARE
	const p = position("1k6/8/5p2/3p4/3PK3/8/8/2R5 w - - 0 1"); // WHITE'S KING STANDS IN A PAWN'S CHECK ITS PEASANT IMMUNITY STOPS: AFTER A ROOK MOVE THAT IS NO CHESS POSITION
	Object.assign(p.players.w, { moves: [hand.newCard(p, "move", { piece: "r" })], actives: [], passive: null });
	place(p, "peasant-immunity", "w", { stopping: [p.board.sq[engine.board.sqIndex("d5")].id] });
	const scored = await scoreTurn(playerView(p, "w"), o);
	assert.ok(scored.some((c) => c.action.from === "c1") && scored.every((c) => Number.isFinite(c.total)));
	assert.deepEqual(sent.map(notChess).filter(Boolean), []);
	assert.equal(logged.mock.callCount(), 0);
});

test("when the board as it stands is no chess position (or one chess.js refuses) the engine isn't asked: every board scores 0 that turn, the card scores decide, no engine alarm", async (t) => {
	const logged = t.mock.method(console, "log", () => {}), sent = [];
	const o = opts({ evaluate: async (fen) => { sent.push(fen); return material(fen); }, bestOf: async (fen, lans) => { sent.push(fen); return firstOf(fen, lans); } });
	const s = position("8/4k3/3P4/8/8/8/7P/3QK3 w - - 0 1"); // A QUEEN UP. THE VISITOR'S PEASANT IMMUNITY STOPS d6'S CHECK, WHICH CARD GUY'S VIEW DOESN'T SAY: ITS GUESS HAS THE KING IN CHECK WITH WHITE TO MOVE
	Object.assign(s.players.w, { moves: [hand.newCard(s, "move", { piece: "p" }), hand.newCard(s, "move", { piece: "q" })], actives: [hand.newCard(s, "all-or-nothing-epic"), hand.newCard(s, "double-time-legendary")], passive: null });
	place(s, "peasant-immunity", "b", { stopping: [s.board.sq[engine.board.sqIndex("d6")].id] });
	const scored = await scoreTurn(playerView(s, "w"), o), cards = scored.filter((c) => c.favourite), moves = scored.filter((c) => c.plain);
	assert.ok(cards.length === 3 && moves.length > 3);
	assert.deepEqual(cards.map((c) => c.total).sort(), [0, 62.5, 62.5]); // BOTH DUELS AND DOUBLE TIME
	assert.ok(moves.every((c) => Math.abs(c.total) < 300), "a move scored " + Math.max(...moves.map((c) => c.total)) + " against the cards' 0"); // NOT THE QUEEN'S 1240 BESIDE CARDS SCORED AGAINST NOTHING
	const win = position("8/4k3/3P4/8/8/8/7P/3QK3 w - - 0 1"); // THE SAME BOARD WITH NO PASSIVE: THE PAWN TAKES THE KING
	Object.assign(win.players.w, { moves: [hand.newCard(win, "move", { piece: "p" })], actives: [], passive: null });
	const taking = (await scoreTurn(playerView(win, "w"), o)).find((c) => c.action.to === "e7");
	assert.ok(taking && taking.total > 90000, "a won game lost its score"); // DECIDED GAMES KEEP THEIRS
	const edge = position("4k3/8/8/8/8/8/8/P3K2R w - - 0 1"); // A PAWN ON ITS FIRST RANK: chess.js REFUSES THE BOARD
	assert.match(notChess(toFen(edge)), /edge rows/);
	Object.assign(edge.players.w, { moves: [hand.newCard(edge, "move", { piece: "r" }), hand.newCard(edge, "move", { piece: "p" })], actives: [], passive: null });
	const a = await cardGuyTurn(playerView(edge, "w"), 2400, o);
	assert.ok(isLegal(edge, "w", a));
	assert.deepEqual(sent, []); // NEITHER evaluate NOR bestOf, ON ANY OF THE THREE TURNS
	assert.equal(logged.mock.callCount(), 0);
});

test("a fogged epic Swap (115 candidates) is answered within 3 s on an instant engine, with no 200 ms stretch that answers nothing else", async (t) => {
	const view = playerView(FOGGED_SWAP, "w"), fens = new Set();
	assert.ok(legalActions(engine.fromView(view, 306675), "w").length > 100);
	const tried = t.mock.method(engine, "applyAction");
	let stall = 0, last = Date.now();
	const tick = setInterval(() => { stall = Math.max(stall, Date.now() - last - 10); last = Date.now(); }, 10);
	const started = Date.now();
	const a = await cardGuyTurn(view, 1300, opts({ seed: 306675, evaluate: async (fen) => { fens.add(fen); return 0; } }));
	const took = Date.now() - started;
	stall = Math.max(stall, Date.now() - last - 10); // A TURN THAT NEVER LET THE TIMER RUN
	clearInterval(tick);
	assert.ok(a && a.type);
	assert.ok(took < 3000, "took " + took + " ms"); // THE PLAN'S LIMIT (0.7 s HERE, 1.9 s WITH EVERY CORE BUSY): THE TWO ASSERTS BELOW HOLD THE FIX
	assert.ok(stall < 200, "the event loop stood still for " + stall + " ms");
	assert.ok(tried.mock.callCount() < 250, tried.mock.callCount() + " actions tried"); // ONE PER CANDIDATE, 8 ONLY FOR THE FEW THE ENGINE IS ASKED ABOUT (IT WAS 875)
	assert.ok(fens.size <= MAX_EVALS && fens.size > 6, fens.size + " boards evaluated");
});

test("when one evaluation fails, or isn't a number, every board scores 0 that turn and the card scores decide; one log line", async (t) => {
	const logged = t.mock.method(console, "log", () => {});
	const s = position("4k3/8/8/r2Q4/8/8/8/4K3 b - - 0 1");
	Object.assign(s.players.b, { moves: [hand.newCard(s, "move", { piece: "r" }), hand.newCard(s, "move", { piece: "r" })], actives: [], passive: hand.newCard(s, "patience") });
	const view = playerView(s, "b"), cards = (await scoreTurn(view, opts({ evaluate: down }))).map((c) => c.total); // NO BOARD ANSWERED: THE CARD SCORES ALONE
	const marks = (to) => { const c = cards.length && whole.find((x) => x.action.to === to); return [c.plain, c.standsOut]; }, whole = await scoreTurn(view, opts());
	assert.deepEqual([marks("d5"), marks("a1"), marks("a8")], [[true, true], [true, true], [true, false]]); // A CAPTURE & A CHECK STAND OUT, A QUIET MOVE DOESN'T
	assert.ok(!whole.some((c) => c.action.type === "discard" || "discard" in c)); // THE FREE DISCARD IS NEVER SCORED
	logged.mock.resetCalls();
	for (const broken of [down, async () => NaN, async () => undefined, async () => "12"]) {
		let calls = 0;
		logged.mock.resetCalls();
		const scored = await scoreTurn(view, opts({ evaluate: async (fen) => (++calls > 3 ? broken() : material(fen)) })); // THE FIRST THREE BOARDS ARE ANSWERED
		assert.ok(calls > 3);
		assert.deepEqual(scored.map((c) => c.total), cards); // NOT THE THREE ANSWERS AGAINST 0 FOR THE REST
		assert.equal(new Set(scored.filter((c) => c.plain).map((c) => c.total)).size, 1); // THE FREE QUEEN AND A QUIET MOVE SCORE ALIKE: EVERY BOARD IS 0
		assert.equal(scored.find((c) => c.action.type === "passive").total - scored[0].total, WEIGHTS.passiveWaiting + WEIGHTS.cardLost);
		assert.equal(logged.mock.callCount(), 1);
		assert.ok(String(logged.mock.calls[0].arguments[0]).startsWith("STOCKFISH FAILED, js-chess-engine PLAYS INSTEAD: "));
	}
	logged.mock.resetCalls();
	await scoreTurn(view, opts({ evaluate: down, bestOf: down }));
	assert.equal(logged.mock.callCount(), 1); // bestOf AND EVERY BOARD FAILED: STILL ONE LINE A TURN
});

test("a seed that isn't a finite number is refused, and a turn makes each guess once", async (t) => {
	const s = newGame({ cardGuy: "w", level: 2400, seed: 3 }), view = playerView(s, "w");
	for (const seed of [undefined, null, NaN, Infinity, "7", "ab".repeat(32)]) {
		await assert.rejects(cardGuyTurn(view, 2400, opts({ seed })), /seed/);
		await assert.rejects(scoreTurn(view, opts({ seed })), /seed/);
	}
	s.players.w.actives = [hand.newCard(s, "mulligan")]; // MOVES AND A CARD: ONE GUESS, AND A SECOND TO TELL A CHANCE OUTCOME
	s.discarded = "w"; // THE FREE DISCARD USED: THE SEARCH DECIDES
	const spy = t.mock.method(engine, "fromView");
	await cardGuyTurn(playerView(s, "w"), 2400, opts());
	assert.deepEqual(spy.mock.calls.map((c) => c.arguments[1]), [7, 8]);
});

test("Card Guy goes on with a card duel while the next hand is worth its risk", async () => {
	let went = 0;
	for (let seed = 1; seed <= 12; seed++) {
		let s = newGame({ cardGuy: "w", level: 2400, seed });
		Object.assign(s.players.w, { moves: s.players.w.moves.slice(0, 3), actives: [hand.newCard(s, "all-or-nothing-legendary")], passive: null }); // THE PIECE ISN'T AT STAKE, AND ONLY 3 CARDS ARE
		const pawn = s.board.sq.find((q) => q && q.c === "w" && q.t === "p").id;
		s = applyAction(s, "w", { type: "active", card: s.players.w.actives[0].id, target: { piece: pawn } }).state;
		for (let i = 0; i < 60 && s.duel; i++) {
			const c = owes(s), a = c === "w" ? (await ask(s, "w", { seed: seed * 100 + i })).action : legalActions(s, "b")[0];
			if (c === "w" && a.stop !== undefined) {
				assert.ok(duelValue(s, "w", s.duel.card, pawn) > 0);
				assert.equal(a.stop, false, "it stopped with a " + s.board.sq.find((q) => q && q.id === pawn).t); // A KNIGHT, BISHOP OR ROOK HAS A STEP LEFT: HALF ITS GAIN IS MORE THAN HALF OF 3 CARDS
				went++;
			}
			s = applyAction(s, c, a).state;
		}
		assert.equal(s.duel, null);
	}
	assert.ok(went >= 3, went + " decisions");
});

test("a chance outcome is scored by its mean over 8 guessed states", async (t) => {
	const { register } = require("../../cards-engine/cards/index.js"), statuses = require("../../cards-engine/statuses.js");
	register({ // A COIN FLIP: HALF THE TIME IT WARDS A PAWN (LAST IN THE FILE: THE CARD STAYS REGISTERED)
		key: "card-guy-test-coin", kind: "active", name: "Coin", skulls: 0, rarity: "common", text: "", targets: () => [null],
		play(ctx, player) { if (ctx.rng.next() < 0.5) statuses.give(ctx, ctx.state.board.sq.find((q) => q && q.c === player && q.t === "p").id, "warded", 3); },
	});
	const s = newGame({ cardGuy: "w", level: 2400, seed: 12 });
	s.players.w.actives = [hand.newCard(s, "card-guy-test-coin")];
	const spy = t.mock.method(engine, "fromView");
	let scored, coin;
	for (let seed = 1; seed <= 12 && !(coin && coin.samples > 1); seed++) { // THE FIRST TWO GUESSES MUST DISAGREE FOR THE REST TO BE ASKED: HALF THE SEEDS
		spy.mock.resetCalls();
		scored = await scoreTurn(playerView(s, "w"), opts({ evaluate: async () => 0, seed }));
		coin = scored.find((c) => c.action.type === "active");
	}
	assert.equal(coin.samples, 8);
	assert.equal(new Set(spy.mock.calls.map((c) => c.arguments[1])).size, 8);
	assert.ok(coin.total > 0 && coin.total < WEIGHTS.warded && coin.total % (WEIGHTS.warded / 8) === 0, "total " + coin.total); // SOME OF THE 8 WARDED, SOME DIDN'T
	assert.ok(scored.filter((c) => c !== coin).every((c) => c.samples === 1));
});

test("under the player's Fog of War a sampled card is scored on the same guessed board as the plain moves (the first guess), only its card score is averaged", async () => {
	const s = newGame({ cardGuy: "w", level: 2400, seed: 12 }); // THE Coin OF THE TEST ABOVE
	s.players.w.actives = [hand.newCard(s, "card-guy-test-coin")];
	fogUp(s, "b");
	const view = playerView(s, "w");
	assert.ok(view.board.hidden > 0);
	const worth = (fen) => [...fen.split(" ")[0]].reduce((sum, ch, i) => sum + ch.charCodeAt(0) * (i + 1), 0); // EVERY GUESSED PLACING HAS ITS OWN
	let checked = 0;
	for (let seed = 1; seed <= 12; seed++) {
		const seen = [];
		const coin = (await scoreTurn(view, opts({ seed, evaluate: async (fen) => { seen.push(worth(fen)); return worth(fen); } }))).find((c) => c.action.type === "active");
		const now = worth(toFen(engine.fromView(view, seed)));
		if (coin.samples === 1 || !seen.includes(now)) { continue; } // THE FIRST TWO GUESSES AGREED, OR THE GUESSED BOARD IS NO CHESS POSITION
		const card = coin.total - now; // THE COIN MOVES NO PIECE: ITS BOARD IS THE BOARD NOW, ON THE FIRST GUESS
		assert.ok(card >= 0 && card <= WEIGHTS.warded && card % (WEIGHTS.warded / 8) === 0, "seed " + seed + ": card score " + card);
		assert.ok(seen.length <= MAX_EVALS);
		checked++;
	}
	assert.ok(checked > 0, "no seed sampled the coin");
});

test("Card Guy keeps a dead rare, epic or legendary active, and Cleanse; a dead common or uncommon one goes (user ruling R1)", async () => {
	const s = newGame({ cardGuy: "w", level: 1300, seed: 3 });
	s.players.w.moves = ["p", "n"].map((piece) => hand.newCard(s, "move", { piece })); // BOTH HAVE A MOVE: NO PAIR TO DISCARD
	const turn = async (key) => {
		s.players.w.actives = [hand.newCard(s, key)];
		assert.ok(!legalActions(s, "w").some((a) => a.type === "active"), key + " has a play at the start");
		return (await cardGuyTurn(playerView(s, "w"), 1300, opts())).type;
	};
	for (const key of ["heavy-cavalry", "last-stand"]) assert.equal(await turn(key), "discard", key); // UNCOMMON
	for (const key of ["cleanse", "cleanse-rare", "conscription"]) assert.notEqual(await turn(key), "discard", key); // CLEANSE (COMMON), RARE, LEGENDARY
});

test("an active that can pay Leech or Shackles isn't dead: Card Guy doesn't throw it out for nothing", async () => {
	for (const key of ["shackles", "leech"]) {
		const s = newGame({ cardGuy: "w", level: 1300, seed: 3 });
		s.players.w.moves = ["p", "n"].map((piece) => hand.newCard(s, "move", { piece }));
		s.players.w.actives = [hand.newCard(s, "heavy-cavalry")]; // NO PLAY AT THE START
		s.players.w.curses = [hand.newCard(s, key)];
		const active = s.players.w.actives[0].id;
		assert.ok(legalActions(s, "w").some((a) => a.type === "clear" && a.discard === active));
		assert.notEqual((await cardGuyTurn(playerView(s, "w"), 1300, opts())).type, "discard", key);
	}
});

test("a refused free discard with nothing else to do on Card Guy's guess: no other discard is offered, it says it has no action", async () => {
	const s = position("k7/8/8/8/8/8/PP6/KB6 w - - 0 1"); // WHITE'S KING BOXED IN BY ITS OWN HEXED PIECES: 5 DEAD MOVE CARDS, 10 PAIRS
	for (const sq of ["a2", "b2", "b1"]) s.statuses[s.board.sq[engine.board.sqIndex(sq)].id] = [{ s: "hexed", left: 2, by: "b" }];
	Object.assign(s.players.w, { moves: ["p", "b", "p", "b", "p"].map((piece) => hand.newCard(s, "move", { piece })), actives: [], passive: null });
	fogUp(s, "b");
	const view = playerView(s, "w"), refused = [];
	let discards = 0, error = null;
	while (!error && refused.length <= 8) { // AS cardsController AND balance.js ASK: AGAIN WITH EACH REFUSED KEY, 8 TIMES
		try {
			const a = await cardGuyTurn(view, 2400, opts({ refused }));
			assert.equal(a.type, "discard");
			discards++;
			refused.push(actionKey(a));
		} catch (err) { error = err; }
	}
	assert.equal(discards, 1, discards + " free discards offered after the first was refused");
	assert.match(error.message, /no action/);
});
