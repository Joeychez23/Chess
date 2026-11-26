/*
 *  cards-draws.test.js  --  chess cards engine tests
 *	The draws (Task 20e, segment A; cards-engine/hand.js): the move-card draw looks at the hand, and the rarer tiers of actives and passives come more often as the game goes on (a table of tier shares at turn 30).
 *
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { newGame, applyAction } = require("../../cards-engine/index.js");
const { fromFen } = require("../../cards-engine/board.js");
const { makeCtx } = require("../../cards-engine/ctx.js");
const hand = require("../../cards-engine/hand.js");
const rng = require("../../cards-engine/rng.js");
const { register, reset, CARDS, RARITY_WEIGHTS, CLIMB_SHARES, CLIMB_END } = require("../../cards-engine/cards/index.js");

reset(); // THE ENGINE ENTRY REGISTERS EVERY CARD: THESE TESTS DRAW FROM ONLY THE CARDS THEY REGISTER

const TIERS = Object.keys(RARITY_WEIGHTS);
const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const PAWN_ROOK = "4k3/8/8/8/8/8/P7/R3K3 w - - 0 1"; // ONE PAWN, ONE ROOK: EVEN ODDS ON AN EMPTY HAND
const game = (fen, seed = 7) => { const s = newGame({ cardGuy: "b", level: 1300, seed }); s.board = fromFen(fen); return s; };
const card = (piece, i) => ({ id: "t" + i, key: "move", piece });
const pct = (x) => (x * 100).toFixed(1) + "%";

/* ---------------------------------------------------------------- */
// Idea 1: the move-card draw looks at the hand
/* ---------------------------------------------------------------- */
/**
 * @description The share of each move-card type in n draws for White on fen, the hand set to `held` (piece types) and its curses to `curses` before each draw.
 */
const moveShares = (fen, held = [], curses = [], n = 8000) => {
	const ctx = makeCtx(game(fen)), p = ctx.state.players.w, got = {};
	for (let i = 0; i < n; i++) {
		p.moves = held.map(card);
		p.curses = curses.map((c) => ({ ...c }));
		const t = hand.drawMove(ctx, "w").piece;
		got[t] = (got[t] || 0) + 1 / n;
	}
	return got;
};
const near = (got, want, what) => { for (const t of Object.keys(want)) assert.ok(Math.abs((got[t] || 0) - want[t]) < 0.02, `${what}, ${t}: ${pct(got[t] || 0)}, ${pct(want[t])} expected`); };

test("drawMove, full army: an empty hand draws Pawn 43%, Knight / Bishop 29%, Rook 14%, Queen 14%", () => {
	near(moveShares(START_FEN), { p: 6 / 14, m: 4 / 14, r: 2 / 14, q: 2 / 14 }, "empty hand");
});

test("drawMove, full army: holding 3 pawns draws Pawn 16%, Knight / Bishop 42%, Rook 21%, Queen 21%", () => {
	near(moveShares(START_FEN, ["p", "p", "p"]), { p: 1.5 / 9.5, m: 4 / 9.5, r: 2 / 9.5, q: 2 / 9.5 }, "3 pawns held");
});

test("drawMove, full army: holding 2 rooks draws Pawn 47%, Knight / Bishop 32%, Rook 5%, Queen 16%", () => {
	near(moveShares(START_FEN, ["r", "r"]), { p: 18 / 38, m: 12 / 38, r: 2 / 38, q: 6 / 38 }, "2 rooks held");
});

test("drawMove, full army: holding 2 pawns draws Pawn 20%, Knight / Bishop 40%, Rook 20%, Queen 20%", () => {
	near(moveShares(START_FEN, ["p", "p"]), { p: 0.2, m: 0.4, r: 0.2, q: 0.2 }, "2 pawns held");
});

test("drawMove: a type with no piece on the board is never drawn, whatever the hand holds", () => {
	const got = moveShares("4k3/8/8/8/8/8/PPPPPPPP/1NBQK3 w - - 0 1", ["p", "p", "p", "m", "m", "q", "q"], [], 3000); // NO ROOK, AND EVERY OTHER TYPE CUT
	assert.deepEqual(Object.keys(got).sort(), ["m", "p", "q"]);
});

test("drawMove: a held type is still drawn, 8 Pawn cards leave Pawn at 6/9 against 8", () => {
	const got = moveShares(START_FEN, Array(8).fill("p"));
	near(got, { p: (6 / 9) / (6 / 9 + 8) }, "8 pawns held");
	assert.ok(got.p > 0);
});

test("drawMove: an entered Mirage counts as the type it shows; a waiting one does not count", () => {
	const mirage = (i, extra) => ({ id: "t9" + i, key: "mirage", piece: "r", ...extra });
	near(moveShares(START_FEN, [], [mirage(1), mirage(2)]), { p: 18 / 38, m: 12 / 38, r: 2 / 38, q: 6 / 38 }, "2 Mirages showing a rook");
	near(moveShares(START_FEN, [], [mirage(1, { waiting: true }), mirage(2, { waiting: true })]), { p: 6 / 14, m: 4 / 14, r: 2 / 14, q: 2 / 14 }, "2 waiting Mirages");
});

test("a deal sees its earlier cards: with one pawn and one rook, 2 cards dealt are the same type 1 time in 3, not 1 in 2", () => {
	const ctx = makeCtx(game(PAWN_ROOK)), p = ctx.state.players.w, n = 6000;
	let same = 0;
	for (let i = 0; i < n; i++) {
		p.moves = [];
		ctx.draw("w", 2);
		if (p.moves[0].piece === p.moves[1].piece) same++;
	}
	assert.ok(Math.abs(same / n - 1 / 3) < 0.02, `same type ${pct(same / n)}, 33.3% expected`);
});

test("the free discard: the 2 discarded cards have left the hand before the draw-back, so 2 Pawn cards thrown out draw a Pawn back 1 time in 2", () => {
	const s = game(PAWN_ROOK), n = 1500;
	s.players.w.moves = [card("p", 1), card("p", 2)];
	let pawns = 0;
	for (let i = 0; i < n; i++) {
		s.rng = rng.seed(i);
		const { events } = applyAction(applyAction(s, "w", { type: "discard", cards: ["t1"] }).state, "w", { type: "discard", cards: ["t2"] }); // ONE AT A TIME (TASK 20e)
		if (events.find((e) => e.type === "draw" && e.card.key === "move").card.piece === "p") pawns++;
	}
	assert.ok(Math.abs(pawns / n - 1 / 2) < 0.05, `a Pawn back ${pct(pawns / n)}, 50% expected (25% if the discarded pair still counted)`);
});

/* ---------------------------------------------------------------- */
// Idea 2: the rarity climb, to a table of tier shares at turn 30 (user ruling 2026-11-22 11:35)
/* ---------------------------------------------------------------- */
// THE TEST POOLS. ACTIVES: ONE CARD PER TIER AND 3 MORE EPICS (A TEST LEAVES CARDS OUT THROUGH Player.used). PASSIVES: A COMMON, AN EPIC AND 20 RARES (RARE IS 81% OF THE POOL)
const play = () => {};
for (const r of TIERS) register({ key: "t-" + r, kind: "active", name: r, rarity: r, text: "", targets: () => [null], play });
for (const i of [2, 3, 4]) register({ key: "t-epic" + i, kind: "active", name: "epic " + i, rarity: "epic", text: "", targets: () => [null], play });
register({ key: "tp-epic", kind: "passive", name: "epic", rarity: "epic", text: "" });
register({ key: "tp-common", kind: "passive", name: "common", rarity: "common", text: "" });
for (let i = 1; i <= 20; i++) register({ key: "tp-rare" + i, kind: "passive", name: "rare " + i, rarity: "rare", text: "" });
const MORE_EPICS = ["t-epic2", "t-epic3", "t-epic4"];
const TOP = ["epic", "legendary"];

/**
 * @description The share of each card key in n draws of `kind` for White at turn `full`, with the keys in `used` out of the pool.
 */
const keyShares = (full, used = MORE_EPICS, kind = "active", n = 10000) => {
	const s = newGame({ cardGuy: "b", level: 1300, seed: 5 }), ctx = makeCtx(s), p = s.players.w, got = {};
	s.board.full = full;
	p.used = used;
	for (let i = 0; i < n; i++) {
		p.actives = [];
		p.passive = null;
		const key = hand.drawCard(ctx, "w", kind).key;
		got[key] = (got[key] || 0) + 1 / n;
	}
	return got;
};
/**
 * @description The share of each rarity in those draws.
 */
const rarityShares = (...args) => {
	const got = Object.fromEntries(TIERS.map((r) => [r, 0]));
	for (const [key, share] of Object.entries(keyShares(...args))) got[CARDS[key].rarity] += share;
	return got;
};
const tiersNear = (got, want, what) => { for (const r of TIERS) assert.ok(Math.abs(got[r] - (want[r] || 0)) < 0.02, `${what}, ${r}: ${pct(got[r])}, ${pct(want[r] || 0)} expected`); };
const base = (rarities) => { const total = rarities.reduce((n, r) => n + RARITY_WEIGHTS[r], 0); return Object.fromEntries(rarities.map((r) => [r, RARITY_WEIGHTS[r] / total])); };

test("the climb's constants: at turn 30 common 26, uncommon 23, rare 20, epic 17, legendary 14; rarer is less likely, tier by tier", () => {
	assert.deepEqual([CLIMB_SHARES, CLIMB_END], [{ common: 26, uncommon: 23, rare: 20, epic: 17, legendary: 14 }, 30]);
	assert.deepEqual(Object.keys(CLIMB_SHARES), TIERS);
	assert.equal(Object.values(CLIMB_SHARES).reduce((n, x) => n + x, 0), 100);
});

test("drawCard at turn 1 draws by the base weights, pick for pick", () => {
	const draws = (weightOf) => {
		const s = newGame({ cardGuy: "b", level: 1300, seed: 11 }), ctx = makeCtx(s), p = s.players.w, out = [];
		p.used = MORE_EPICS;
		for (let i = 0; i < 300; i++) { p.actives = []; out.push(weightOf(ctx)); }
		return out;
	};
	const total = TIERS.reduce((n, r) => n + RARITY_WEIGHTS[r], 0);
	const plain = (ctx) => { let r = ctx.rng.int(total); return "t-" + TIERS.find((t) => (r -= RARITY_WEIGHTS[t]) < 0); }; // THE DRAW AS IT WAS BEFORE THE CLIMB
	assert.deepEqual(draws((ctx) => hand.drawCard(ctx, "w", "active").key), draws(plain));
	tiersNear(rarityShares(1), base(TIERS), "turn 1");
});

test("drawCard at the climb's last turn and after it: common 26%, uncommon 23%, rare 20%, epic 17%, legendary 14%", () => {
	for (const full of [CLIMB_END, CLIMB_END + 1, 200]) tiersNear(rarityShares(full), { common: 0.26, uncommon: 0.23, rare: 0.20, epic: 0.17, legendary: 0.14 }, "turn " + full);
});

test("drawCard climbs in equal steps: at turn 16 every tier is 15/29 of the way from its turn-1 share to its table share", () => {
	// FROM 12 / 6 / 3 / 2 / 1 OF 24 (50, 25, 12.5, 8.3, 4.2%) TO 26, 23, 20, 17, 14%
	tiersNear(rarityShares(16), { common: 0.3759, uncommon: 0.2397, rare: 0.1638, epic: 0.1282, legendary: 0.0925 }, "turn 16");
	const at8 = rarityShares(8), at23 = rarityShares(23); // 7 AND 22 STEPS OF 29
	tiersNear(at8, { common: 0.4421, uncommon: 0.2452, rare: 0.1431, epic: 0.1043, legendary: 0.0654 }, "turn 8");
	tiersNear(at23, { common: 0.3179, uncommon: 0.2348, rare: 0.1819, epic: 0.1491, legendary: 0.1163 }, "turn 23");
});

test("drawCard: a tier with no card left has no share, its table share goes to the others in proportion (no legendary: 26 / 23 / 20 / 17 of 86)", () => {
	const got = rarityShares(CLIMB_END, [...MORE_EPICS, "t-legendary"]);
	tiersNear(got, { common: 26 / 86, uncommon: 23 / 86, rare: 20 / 86, epic: 17 / 86 }, "no legendary left");
	assert.equal(got.legendary, 0);
});

test("drawCard: with no common or uncommon card left, rare, epic and legendary share out 20 / 17 / 14 of 51", () => {
	tiersNear(rarityShares(CLIMB_END, [...MORE_EPICS, "t-common", "t-uncommon"]), { rare: 20 / 51, epic: 17 / 51, legendary: 14 / 51 }, "no common or uncommon");
});

test("drawCard, a rare-heavy pool (rare 81% by the base weights): no drawable tier is at 0, common 26, rare 20 and epic 17 of 63", () => {
	const got = rarityShares(CLIMB_END, [], "passive");
	tiersNear(got, { common: 26 / 63, rare: 20 / 63, epic: 17 / 63 }, "20 rares, an epic and a common");
	const mid = rarityShares(16, [], "passive"), f = 15 / 29; // HALFWAY: FROM 12, 60 AND 2 OF 74
	tiersNear(mid, { common: 12 / 74 + (26 / 63 - 12 / 74) * f, rare: 60 / 74 + (20 / 63 - 60 / 74) * f, epic: 2 / 74 + (17 / 63 - 2 / 74) * f }, "turn 16");
	for (const g of [got, mid]) for (const r of ["common", "rare", "epic"]) assert.ok(g[r] > 0.1, `${r}: ${pct(g[r])}`);
});

test("drawCard: within a tier every drawable card is equally likely (4 epics share 17%, 20 rares share 20 of 63)", () => {
	const actives = keyShares(CLIMB_END, [], "active", 20000);
	for (const k of ["t-epic", ...MORE_EPICS]) assert.ok(Math.abs(actives[k] - 0.17 / 4) < 0.008, `${k}: ${pct(actives[k])}, 4.3% expected`);
	const passives = keyShares(CLIMB_END, [], "passive", 20000);
	for (let i = 1; i <= 20; i++) assert.ok(Math.abs(passives["tp-rare" + i] - 20 / 63 / 20) < 0.006, `tp-rare${i}: ${pct(passives["tp-rare" + i])}, 1.6% expected`);
});

test("drawCard never lowers the chance of epic or legendary: a pool whose base share of them is at or above the table's keeps the base weights", () => {
	// RARE 3, 4 EPICS 8, LEGENDARY 1: 75% EPIC OR LEGENDARY BY THE BASE WEIGHTS, 31 OF 51 (61%) BY THE TABLE
	for (const full of [16, CLIMB_END]) tiersNear(rarityShares(full, ["t-common", "t-uncommon"]), { rare: 3 / 12, epic: 8 / 12, legendary: 1 / 12 }, "4 epics, a legendary and a rare, turn " + full);
});

test("drawCard: a pool with no epic or legendary card still climbs, the table shared out: common 26, uncommon 23, rare 20 of 69", () => {
	const none = [...MORE_EPICS, "t-epic", "t-legendary"];
	tiersNear(rarityShares(CLIMB_END, none), { common: 26 / 69, uncommon: 23 / 69, rare: 20 / 69 }, "no epic or legendary");
	tiersNear(rarityShares(1, none), base(["common", "uncommon", "rare"]), "no epic or legendary, turn 1");
});

test("drawCard: a pool just under the table's epic-or-legendary share climbs (4 epics: 30% by the base weights, 31% by the table)", () => {
	tiersNear(rarityShares(CLIMB_END, []), { common: 0.26, uncommon: 0.23, rare: 0.20, epic: 0.17, legendary: 0.14 }, "all 8 actives");
});

test("the climb follows board.full on a real refill, and steps back with it", () => {
	const tops = (full) => {
		const s = newGame({ cardGuy: "b", level: 1300, seed: 3 }), ctx = makeCtx(s), p = s.players.w, n = 4000;
		p.used = MORE_EPICS;
		s.board.full = full;
		let count = 0;
		for (let i = 0; i < n; i++) {
			p.actives = [];
			p.moves = Array.from({ length: 5 }, (_, j) => card("p", j));
			hand.refill(ctx, "w");
			if (TOP.includes(CARDS[p.actives[0].key].rarity)) count++;
		}
		return count / n;
	};
	assert.ok(Math.abs(tops(CLIMB_END) - 0.31) < 0.03);
	assert.ok(Math.abs(tops(1) - 3 / 24) < 0.03);
});

test("curse draws keep the base weights at any turn", () => {
	for (const r of TIERS) register({ key: "tc-" + r, kind: "curse", name: r, rarity: r, text: "" });
	const s = newGame({ cardGuy: "b", level: 1300, seed: 5 }), ctx = makeCtx(s), n = 10000, got = Object.fromEntries(TIERS.map((r) => [r, 0]));
	s.board.full = CLIMB_END;
	for (let i = 0; i < n; i++) got[CARDS[ctx.randomCurses(1)[0]].rarity] += 1 / n;
	tiersNear(got, base(TIERS), "curses at the climb's last turn");
});
