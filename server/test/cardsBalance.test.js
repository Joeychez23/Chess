/*
 *  cardsBalance.test.js  --  chess server tests
 *	The balance report (utils/card-guy/balance.js): summarize's flags and playGame. The engine is stubbed: no test reaches Stockfish.
 *
 */

require("./helpers/env.js");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../../cards-engine/index.js");
const { CARDS } = require("../../cards-engine/cards/index.js");
const cardGuy = require("../utils/card-guy/index.js");
const { playGame, summarize, STRONG_WIN_RATE, STRONG_MIN_GAMES, RARE_MIN_SHARE, DUD_MIN_GAMES, DUD_PLAYED_SHARE } = require("../utils/card-guy/balance.js");

const VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const material = async (fen) => [...fen.split(" ")[0]].reduce((sum, ch) => sum + (/[a-z]/i.test(ch) ? (ch === ch.toUpperCase() ? 1 : -1) * VALUE[ch.toLowerCase()] : 0), 0); // CENTIPAWNS FROM WHITE'S SIDE
const firstOf = async (fen, lans) => ({ from: lans[0].slice(0, 2), to: lans[0].slice(2, 4), promotion: lans[0][4] });

const keyOf = (kind, rarity) => Object.keys(CARDS).find((k) => CARDS[k].kind === kind && CARDS[k].rarity === rarity);
const COMMON = keyOf("active", "common"), RARE = keyOf("active", "rare"), EPIC = keyOf("active", "epic");
const none = () => ({ drawn: 0, played: 0, fired: 0 });
const side = (t = {}) => ({ ...none(), ...t });
// A GAME WHERE `who` (a colour) DREW, PLAYED & FIRED A CARD; winner: "w", "b" OR null (A DRAW)
const game = (winner, key, w = {}, b = {}) => ({ winner, cards: { [key]: { w: side(w), b: side(b) } } });
const many = (n, make) => Array.from({ length: n }, (_, i) => make(i));
const row = (rows, key) => rows.find((r) => r.key === key);

test("summarize flags a card that wins over 60% of 20+ games played", () => {
	assert.equal(STRONG_WIN_RATE, 0.6);
	assert.equal(STRONG_MIN_GAMES, 20);
	const played = { drawn: 1, played: 1 };
	const win = (wins, total) => many(total, (i) => game(i < wins ? "w" : "b", COMMON, played));
	assert.ok(row(summarize(win(13, 20)), COMMON).flags.includes("too-strong")); // 65%
	assert.ok(!row(summarize(win(12, 20)), COMMON).flags.includes("too-strong")); // EXACTLY 60%: NOT OVER
	assert.ok(!row(summarize(win(19, 19)), COMMON).flags.includes("too-strong")); // 100%, BUT UNDER 20 GAMES
	assert.equal(row(summarize(win(13, 20)), COMMON).winRateWhenPlayed, 0.65);
	// THE SIDE THAT PLAYED IT IS THE ONE THAT COUNTS
	const black = many(20, () => game("b", COMMON, {}, played));
	assert.equal(row(summarize(black), COMMON).winRateWhenPlayed, 1);
});

test("summarize flags a rare drawn in fewer than 1 game in 10", () => {
	assert.equal(RARE_MIN_SHARE, 0.1);
	const games = (drawnIn) => many(20, (i) => game("w", i < drawnIn ? RARE : COMMON, { drawn: 1 }));
	assert.ok(row(summarize(games(1)), RARE).flags.includes("rare-missing")); // 1 IN 20
	assert.ok(!row(summarize(games(2)), RARE).flags.includes("rare-missing")); // 1 IN 10 EXACTLY
	assert.ok(row(summarize(games(0)), RARE).flags.includes("rare-missing")); // NEVER TURNED UP: STILL A ROW
	assert.equal(row(summarize(games(0)), RARE).drawnGames, 0);
	assert.ok(!row(summarize(games(0)), EPIC).flags.includes("rare-missing")); // ONLY THE RARE TIER
	assert.ok(!row(summarize(games(0)), COMMON).flags.includes("rare-missing"));
});

test("summarize flags a card drawn in 20+ games but played in under a quarter", () => {
	assert.equal(DUD_MIN_GAMES, 20);
	assert.equal(DUD_PLAYED_SHARE, 0.25);
	const games = (n, played, fired = 0) => many(n, (i) => game("w", COMMON, { drawn: 1, played: i < played ? 1 : 0, fired: i >= played && i < played + fired ? 1 : 0 }));
	const dud = (rows) => row(rows, COMMON).flags.includes("dud");
	assert.ok(dud(summarize(games(20, 4)))); // 4 IN 20
	assert.ok(!dud(summarize(games(20, 5)))); // A QUARTER EXACTLY
	assert.ok(!dud(summarize(games(19, 0)))); // UNDER 20 GAMES DRAWN
	assert.ok(!dud(summarize(games(20, 2, 3)))); // FIRING COUNTS AS PLAYING
	const r = row(summarize(games(20, 4)), COMMON);
	assert.equal(r.drawnGames, 20);
	assert.equal(r.playedGames, 4);
	assert.equal(r.drawnNotPlayedGames, 16);
});

test("a draw counts as half a win", () => {
	const played = { drawn: 1, played: 1 };
	assert.equal(row(summarize(many(4, () => game(null, COMMON, played))), COMMON).winRateWhenPlayed, 0.5);
	const mixed = [game("w", COMMON, played), game(null, COMMON, played), game("b", COMMON, played), game("w", COMMON, played)];
	assert.equal(row(summarize(mixed), COMMON).winRateWhenPlayed, 0.625); // (1 + .5 + 0 + 1) / 4
	assert.equal(row(summarize(mixed), COMMON).rarity, CARDS[COMMON].rarity);
	assert.equal(row(summarize([]), COMMON).winRateWhenPlayed, null); // NEVER PLAYED: NO RATE
});

test("playGame ends and reports only real card keys", async () => {
	const stats = {};
	const first = await playGame(1, { evaluate: material, bestOf: firstOf, level: 1500, stats });
	assert.ok(["w", "b", null].includes(first.winner));
	assert.ok(stats.plies <= 300, "a game runs at most 300 plies, then it is a draw");
	if (stats.capped) { assert.equal(first.winner, null); assert.equal(stats.plies, 300); }
	const keys = Object.keys(first.cards);
	assert.ok(keys.length > 0, "a game of 20+ turns draws some card");
	for (const key of keys) {
		assert.ok(CARDS[key], "unknown card key " + key);
		assert.notEqual(key, "move"); // MOVE CARDS ARE NOT COUNTED
		for (const c of ["w", "b"]) { for (const n of ["drawn", "played", "fired"]) { assert.ok(Number.isInteger(first.cards[key][c][n]) && first.cards[key][c][n] >= 0); } }
	}
	assert.ok(Object.values(first.cards).some((t) => t.w.drawn + t.b.drawn > 0));
	// THE SAME SEED PLAYS THE SAME GAME
	assert.deepEqual(await playGame(1, { evaluate: material, bestOf: firstOf, level: 1500 }), first);
});

test("the opening hand counts as drawn, and a throw from Card Guy plays the legal fallback, asked once per action", async (t) => {
	const spy = t.mock.method(cardGuy, "cardGuyTurn", async () => { throw new Error("no action"); });
	const stats = {};
	const g = await playGame(3, { evaluate: material, bestOf: firstOf, level: 1500, stats });
	const opening = engine.newGame({ cardGuy: "b", level: 1500, seed: 3 });
	for (const c of ["w", "b"]) {
		// THE FALLBACK PLAYS A MOVE WHEN THERE IS ONE, SO THE OPENING CARD IS NEVER DRAWN AGAIN: ONCE, AT THE DEAL
		for (const card of opening.players[c].actives) { assert.equal(g.cards[card.key] && g.cards[card.key][c].drawn, 1, `${c}'s opening ${card.key}`); }
		for (const [k, t] of Object.entries(g.cards)) { if (t[c].played) { assert.ok(t[c].drawn, `${c} played ${k} without drawing it`); } } // NOTHING IS STOLEN HERE
	}
	assert.ok(stats.fallbacks > 0);
	assert.equal(spy.mock.callCount(), stats.fallbacks); // A THROW IS NOT ASKED AGAIN: ONE ASK PER ACTION
	assert.equal(stats.turnActions, 0);
});

test("a refused action is asked for again with its key in refused, 8 times, then the legal fallback plays", async (t) => {
	const illegal = { type: "move", from: "a1", to: "a8" }, asked = [];
	t.mock.method(cardGuy, "cardGuyTurn", async (view, level, { refused }) => {
		asked.push([...refused]);
		if (asked.length <= 9) { return illegal; } // THE FIRST ACTION: REFUSED EVERY TIME
		throw new Error("no action"); // THE REST: STRAIGHT TO THE FALLBACK, SO THE GAME IS QUICK
	});
	const stats = {};
	await playGame(1, { evaluate: material, bestOf: firstOf, level: 1500, stats });
	const key = engine.actionKey(illegal);
	assert.deepEqual(asked.slice(0, 9), Array.from({ length: 9 }, (_, i) => Array(i).fill(key)));
	assert.deepEqual(asked[9], []); // THE NEXT ACTION STARTS WITH NOTHING REFUSED
	assert.equal(stats.fallbacks, asked.length - 8); // THE FIRST ACTION'S 9 ASKS ARE ONE FALLBACK, EVERY LATER ASK ONE MORE
});

test("a game that stops without a result says why: stuck or the action cap, not the 300-ply cap", async (t) => {
	const stats = {}, play = () => playGame(1, { evaluate: material, bestOf: firstOf, level: 1500, stats });
	const legal = t.mock.method(engine, "legalActions", () => []);
	assert.equal((await play()).winner, null);
	assert.deepEqual([stats.stuck, stats.capped, stats.actionCapped, stats.plies], [true, false, false, 0]); // NO ONE CAN ACT
	legal.mock.mockImplementation(() => [{ type: "move", from: "a2", to: "a3" }]);
	t.mock.method(engine, "applyAction", (state) => ({ state, events: [] })); // NOTHING EVER CHANGES
	t.mock.method(cardGuy, "cardGuyTurn", async () => { throw new Error("no action"); });
	assert.equal((await play()).winner, null);
	assert.deepEqual([stats.stuck, stats.capped, stats.actionCapped, stats.plies], [false, false, true, 0]);
});
