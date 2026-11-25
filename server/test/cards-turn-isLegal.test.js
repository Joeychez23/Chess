/*
 *  cards-turn-isLegal.test.js  --  chess cards engine tests
 *	Task 25 A3: turn.isLegal(state, player, action) answers exactly as legalActions(state, player).some(same actionKey), without building the whole list. A differential fuzz over seeded games with every registered card, and a timing note.
 *
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { newGame, legalActions, applyAction } = require("../../cards-engine/index.js"); // THE REAL LOADER: EVERY CARD IN PLAY
const turn = require("../../cards-engine/turn.js");

const GAMES = 10, PLIES = 200, SAMPLE = 5; // ABOUT 15 s
const FILES = "abcdefgh";

/**
 * @description mulberry32, so a failing seed replays: roll(n) is an integer in 0..n-1.
 */
function picker(seed) {
	let a = seed >>> 0;
	return (n) => {
		a = (a + 0x6D2B79F5) >>> 0;
		let t = Math.imul(a ^ (a >>> 15), a | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) % n;
	};
}

/**
 * @description Actions near a legal one that may or may not be legal: another card, swapped or shifted squares, another type, a field dropped or added, a choice or duel answer changed.
 */
function mutants(s, player, a, roll) {
	const p = s.players[player], ids = [...p.moves, ...p.actives, ...p.curses, p.passive].filter(Boolean).map((c) => c.id);
	const cards = [...ids, "king", null, "zz"], sq = () => FILES[roll(8)] + (1 + roll(8));
	const out = [{ ...a, card: cards[roll(cards.length)] }, { ...a, extra: 1 }, { ...a, type: ["move", "active", "passive", "discard", "drop", "clear", "switch", "choice", "duel"][roll(9)] }];
	if (a.from) out.push({ ...a, from: a.to, to: a.from }, { ...a, to: sq() }, { ...a, from: sq() });
	if (a.target !== undefined) out.push({ ...a, target: sq() }, (({ target, ...rest }) => rest)(a));
	if (a.promotion) out.push({ ...a, promotion: "q" }, { ...a, promotion: "n" }, (({ promotion, ...rest }) => rest)(a));
	if (a.cards) out.push({ ...a, cards: [ids[roll(ids.length)]] }, { ...a, cards: [...a.cards, ids[roll(ids.length)]] });
	if (a.type === "choice") out.push({ type: "choice", option: roll(4) }, { type: "choice", option: String(a.option) });
	if (a.type === "duel") out.push({ type: "duel", pick: roll(4) }, { type: "duel", stop: !a.stop });
	return out;
}

const GARBAGE = [null, 5, "move", [], {}, { type: "move" }, { type: "drop" }, { type: "passive", card: 1 }, { type: "discard", cards: [] }, { type: "passive" }, { type: "discard" }, { type: "active" }, { type: "clear" }]; // BARE SHAPES ON EVERY PLY: A PASSIVE ROUTE THAT SKIPS ITS CHECK IS CAUGHT (REVIEW A3-M1)

/**
 * @description Check isLegal against legalActions for player on s, for every candidate; counts disagreements by never letting one pass. isLegal must not change s.
 */
function agree(s, player, candidates, tag, stats) {
	const keys = new Set(legalActions(s, player).map(turn.actionKey)), before = JSON.stringify(s);
	for (const c of candidates) {
		const want = keys.has(turn.actionKey(c)), got = turn.isLegal(s, player, c);
		assert.equal(got, want, tag + " " + player + " " + JSON.stringify(c) + " expected " + want);
		stats[want ? "legal" : "illegal"]++;
	}
	assert.equal(JSON.stringify(s), before, tag + ": isLegal changed the state");
}

/**
 * @description One seeded game: at each ply, for both players, a sample of their legal actions, mutants of them, stale actions from earlier plies and garbage agree; also on a copy with a random legal action barred. Play picks an action type first, then an action, so actives, discards and drops come up often.
 */
function play(seed, stats) {
	let s = newGame({ cardGuy: "b", level: 1300, seed });
	const roll = picker(seed), stale = [];
	for (let ply = 0; ply < PLIES && !s.result; ply++) {
		const tag = "seed " + seed + " ply " + ply;
		if (s.pending) stats.pending++; if (s.duel) stats.duel++; if (s.multi) stats.multi++;
		for (const c of ["w", "b"]) {
			const acts = legalActions(s, c), cand = [...GARBAGE, ...stale.slice(-20)];
			for (let i = 0; i < Math.min(SAMPLE, acts.length); i++) { const a = acts[roll(acts.length)]; cand.push(a, ...mutants(s, c, a, roll)); }
			for (const t of new Set(acts.map((a) => a.type))) cand.push(acts.find((a) => a.type === t)); // EVERY TYPE OFFERED, AT LEAST ONCE
			agree(s, c, cand, tag, stats);
			if (acts.length > 1 && !s.barred) { // THE BARRED ACTION (GRACE): FORCED ON A COPY
				const b = JSON.parse(JSON.stringify(s)), x = acts[roll(acts.length)];
				b.barred = turn.barKey(x);
				agree(b, c, [x, ...acts.slice(0, 10), { ...x, card: "king" }], tag + " barred", stats);
				stats.barred++;
			}
			stale.push(...acts.slice(0, 3));
		}
		const toAct = s.pending ? [s.pending.player] : s.duel ? ["w", "b"] : [s.board.turn];
		const can = toAct.map((c) => [c, legalActions(s, c)]).filter((x) => x[1].length);
		if (!can.length) break;
		const [color, acts] = can[roll(can.length)], types = [...new Set(acts.map((a) => a.type))], t = types[roll(types.length)], of = acts.filter((a) => a.type === t);
		const a = of[roll(of.length)];
		stats["a:" + a.type] = (stats["a:" + a.type] || 0) + 1;
		s = applyAction(s, color, a).state;
	}
}

test("isLegal agrees with legalActions over seeded games (legal, mutated, stale, garbage, barred, pending, duel, multi)", () => {
	const stats = { legal: 0, illegal: 0, pending: 0, duel: 0, multi: 0, barred: 0 };
	for (let seed = 1; seed <= GAMES; seed++) play(seed, stats);
	console.log("T25-A3 fuzz", JSON.stringify(stats));
	assert.ok(stats.legal > 1000 && stats.illegal > 1000, "both answers tested");
	for (const k of ["pending", "duel", "multi", "barred", "a:discard", "a:drop", "a:active"]) assert.ok(stats[k] > 0, "the fuzz met " + k);
});

test("isLegal: not the player's turn, a game over and malformed actions are illegal", () => {
	const s = newGame({ cardGuy: "b", level: 1300, seed: 3 });
	const a = legalActions(s, "w")[0];
	assert.equal(turn.isLegal(s, "w", a), true);
	assert.equal(turn.isLegal(s, "b", a), false);
	for (const g of GARBAGE) assert.equal(turn.isLegal(s, "w", g), false, JSON.stringify(g));
	const over = { ...JSON.parse(JSON.stringify(s)), result: { winner: "w", reason: "checkmate" } };
	assert.equal(turn.isLegal(over, "w", a), false);
});

test("isLegal timing note on a large-action state (not asserted)", () => {
	let s = newGame({ cardGuy: "b", level: 1300, seed: 7 }), best = s, n = 0;
	const roll = picker(7);
	for (let ply = 0; ply < 80 && !s.result; ply++) { // THE STATE WITH THE MOST ACTIONS MET IN A SHORT GAME
		const c = s.pending ? s.pending.player : s.duel ? "w" : s.board.turn, acts = legalActions(s, c);
		if (!acts.length) break;
		if (!s.pending && !s.duel && acts.length > n) { n = acts.length; best = s; }
		s = applyAction(s, c, acts[roll(acts.length)]).state;
	}
	const c = best.board.turn, all = legalActions(best, c), R = 20, acts = [...new Set(all.map((a) => a.type))].map((t) => all.find((a) => a.type === t)); // ONE OF EACH TYPE OFFERED
	let t = process.hrtime.bigint();
	for (let i = 0; i < R; i++) for (const a of acts) legalActions(best, c).some((x) => turn.actionKey(x) === turn.actionKey(a));
	const full = Number(process.hrtime.bigint() - t) / 1e6 / (R * acts.length);
	t = process.hrtime.bigint();
	for (let i = 0; i < R; i++) for (const a of acts) turn.isLegal(best, c, a);
	const one = Number(process.hrtime.bigint() - t) / 1e6 / (R * acts.length);
	console.log("T25-A3 timing: " + all.length + " actions (types " + acts.map((a) => a.type).join() + "), legalActions+some " + full.toFixed(3) + " ms, isLegal " + one.toFixed(3) + " ms per call");
	assert.ok(acts.length > 0);
});
