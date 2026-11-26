/*
 *  cards-balanceReport.test.js  --  chess server tests
 *	The balance report (utils/card-guy/balance.js): summarize's flags and playGame. The engine is stubbed: no test reaches Stockfish.
 *
 */

require("../helpers/env.js");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../../../cards-engine/index.js");
const { CARDS } = require("../../../cards-engine/cards/index.js");
const cardGuy = require("../../utils/card-guy/index.js");
const { playGame, summarize, drawTotals, TURN_BANDS, STRONG_WIN_RATE, STRONG_MIN_GAMES, RARE_MIN_SHARE, DUD_MIN_GAMES, DUD_PLAYED_SHARE } = require("../../utils/card-guy/balance.js");

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

test("the refill after a free discard of an active isn't counted as drawn", async (t) => {
	const id = engine.newGame({ cardGuy: "b", level: 1500, seed: 2 }).players.w.actives[0].id; // SEED 2 (TASK 20c): IN SEED 3'S GAME THE FALLBACK NOW REACHES A TURN WITH NO MOVE AND PLAYS AN ACTIVE
	let asked = 0;
	t.mock.method(cardGuy, "cardGuyTurn", async () => { if (!asked++) { return { type: "discard", cards: [id] }; } throw new Error("no action"); }); // WHITE THROWS ITS OPENING ACTIVE OUT, THEN THE FALLBACK MOVES
	const stats = {}, g = await playGame(2, { evaluate: material, bestOf: firstOf, level: 1500, stats });
	const drawn = (c) => Object.keys(g.cards).filter((k) => CARDS[k].kind === "active").reduce((n, k) => n + g.cards[k][c].drawn, 0);
	assert.equal(stats.discards, 1);
	assert.deepEqual([drawn("w"), drawn("b")], [1, 1]); // THE OPENING ACTIVES ONLY: NO ACTIVE IS PLAYED, SO THE ONLY OTHER ACTIVE DRAWN IS WHITE'S REFILL
});

test("a passive reroll is counted apart from the free discards and owes no active", async (t) => {
	const start = engine.newGame({ cardGuy: "b", level: 1500, seed: 3 }), key = Object.keys(CARDS).find((k) => CARDS[k].kind === "passive" && !CARDS[k].canPlace);
	start.players.w.passive = { id: "t1", key };
	t.mock.method(engine, "newGame", () => start);
	let asked = 0;
	t.mock.method(cardGuy, "cardGuyTurn", async () => { if (!asked++) { return { type: "discard", cards: ["t1"] }; } throw new Error("no action"); }); // WHITE REROLLS (CARD GUY NEVER DOES), THEN THE FALLBACK MOVES
	const stats = {}, g = await playGame(3, { evaluate: material, bestOf: firstOf, level: 1500, stats });
	const drawn = Object.keys(g.cards).filter((k) => CARDS[k].kind === "passive").reduce((n, k) => n + g.cards[k].w.drawn, 0);
	assert.deepEqual([stats.discards, stats.rerolls], [0, 1]);
	assert.equal(drawn, 2); // THE ONE IT HELD AND THE ONE THE REROLL DREW: A REAL DRAW, COUNTED
});

test("playGame counts the move-card types drawn and the rarity of each active or passive drawn by turn band", async () => {
	const g = await playGame(1, { evaluate: material, bestOf: firstOf, level: 1500 });
	assert.deepEqual(TURN_BANDS, [1, 10, 20, 30]);
	assert.ok(Object.keys(g.moveTypes).every((t) => "pmrq".includes(t)), Object.keys(g.moveTypes).join());
	assert.ok(Object.values(g.moveTypes).reduce((n, x) => n + x, 0) >= 10, "the two opening hands are 10 move cards");
	assert.deepEqual(Object.keys(g.rarityByBand), ["1-9", "10-19", "20-29", "30+"]);
	assert.ok(Object.values(g.rarityByBand["1-9"]).reduce((n, x) => n + x, 0) >= 2, "the two opening actives are drawn at turn 1");
	for (const band of Object.values(g.rarityByBand)) { for (const r of Object.keys(band)) { assert.ok(["common", "uncommon", "rare", "epic", "legendary"].includes(r), r); } }
});

test("drawTotals sums the games' move-card types and rarities by turn band", () => {
	const one = { moveTypes: { p: 3, m: 1 }, rarityByBand: { "1-9": { common: 2 }, "30+": { epic: 1 } } }, two = { moveTypes: { p: 1, q: 2 }, rarityByBand: { "1-9": { common: 1, rare: 1 }, "30+": {} } };
	assert.deepEqual(drawTotals([one, two]), { moveTypes: { p: 4, m: 1, q: 2 }, rarityByBand: { "1-9": { common: 3, rare: 1 }, "30+": { epic: 1 } } });
});

/**
 * @description A game from start, where White (asked first) takes action once and Card Guy throws from then on (the fallback moves). Returns { stats, g, events: every event of the game }
 */
async function oneAction(t, start, action) {
	t.mock.method(engine, "newGame", () => start);
	let asked = 0;
	t.mock.method(cardGuy, "cardGuyTurn", async () => { if (!asked++) { return action; } throw new Error("no action"); });
	const apply = engine.applyAction, events = [];
	t.mock.method(engine, "applyAction", (...args) => { const out = apply(...args); events.push(...out.events); return out; });
	const stats = {}, g = await playGame(2, { evaluate: material, bestOf: firstOf, level: 1500, stats });
	return { stats, g, events };
}

test("a single move-card discard is counted as one, owes no active and is no turn action", async (t) => {
	const start = engine.newGame({ cardGuy: "b", level: 1500, seed: 2 });
	start.players.w.actives = []; // THE REFILL AT THE END OF WHITE'S TURN DRAWS ONE: A REAL DRAW, NOT A FREE DISCARD'S
	const { stats, g, events } = await oneAction(t, start, { type: "discard", cards: [start.players.w.moves[0].id] });
	const draws = events.filter((e) => e.type === "draw" && e.player === "w" && !e.lost && e.card && CARDS[e.card.key] && CARDS[e.card.key].kind === "active").length;
	const drawn = Object.keys(g.cards).filter((k) => CARDS[k].kind === "active").reduce((n, k) => n + g.cards[k].w.drawn, 0);
	assert.ok(draws > 0);
	assert.equal(drawn, draws); // EVERY ACTIVE WHITE DREW IS COUNTED
	assert.deepEqual([stats.discards, stats.singles, stats.singleRedraws, stats.rerolls, stats.turnActions], [1, 1, 0, 0, 0]);
});

test("an active's free discard is no single discard, and the automatic redraw after a single discard is counted", async (t) => {
	const first = engine.newGame({ cardGuy: "b", level: 1500, seed: 2 });
	const active = await oneAction(t, first, { type: "discard", cards: [first.players.w.actives[0].id] });
	assert.deepEqual([active.stats.discards, active.stats.singles, active.stats.singleRedraws], [1, 0, 0]);
	t.mock.restoreAll();
	const start = engine.newGame({ cardGuy: "b", level: 1500, seed: 2 }), queen = () => ({ id: "q" + start.players.w.moves.length, key: "move", piece: "q" });
	Object.assign(start.players.w, { moves: [], actives: [], passive: null });
	start.players.w.moves.push(queen(), queen()); // NO QUEEN MOVE AT THE START: THE DISCARD LEAVES NO CARD ACTION
	const { stats, events } = await oneAction(t, start, { type: "discard", cards: ["q0"] });
	assert.equal(events.filter((e) => e.type === "redraw").length >= 1, true);
	assert.deepEqual([stats.discards, stats.singles, stats.singleRedraws], [1, 1, 1]);
});

test("a drop is no turn action", async (t) => {
	const start = engine.newGame({ cardGuy: "b", level: 1500, seed: 2 }), key = Object.keys(CARDS).find((k) => CARDS[k].kind === "passive" && !CARDS[k].canPlace);
	start.effects.push({ id: "t1", owner: "w", card: { id: "t1", key }, placedAt: 0 });
	const { stats, events } = await oneAction(t, start, { type: "drop", card: "t1" });
	assert.ok(events.some((e) => e.type === "card-dropped"));
	assert.deepEqual([stats.turnActions, stats.discards, stats.singles], [0, 0, 0]);
});
