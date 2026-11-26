/*
 *  cards-viewFog.test.js  --  chess cards engine tests
 *	Task 25, what a view tells under a Fog of War (cards-engine/view.js): a hidden piece handed over gives no square away (A2), & Trapdoor, Swap and All or Nothing are told blind (B2, F2).
 *	Two test groups merged by feature, each in its own scope with its own helpers; the tests and their names are unchanged
 */

/* ================================================================ */
// T25-A2: A HIDDEN PIECE HANDED OVER GIVES NO SQUARE AWAY (playerEvents)
/* ================================================================ */
(() => {
/*
 *  cards-viewFog.test.js, a hidden piece handed over
 *	Task 25 A2: under a Fog of War, a hidden piece handed over to the viewer (Opposing Finality) must not give away the square it stood on (playerEvents)
 *
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { newGame, legalActions, applyAction, playerEvents, board } = require("../../../cards-engine/index.js");
const { baseKey } = require("../../../cards-engine/cards/index.js");

const other = (c) => (c === "w" ? "b" : "w");
const onHalf = (i, c) => (c === "w" ? i >= 32 : i < 32);
const fogOn = (s, c) => s.enchant.some((e) => baseKey(e.key) === "fog-of-war" && e.owner === c);
const SQ_FIELDS = ["from", "to", "sq", "square"];

/**
 * @description The squares of opp's pieces a Fog of War of opp's hides on state s (none without one).
 */
const hiddenSquares = (s, opp) => (fogOn(s, opp) ? s.board.sq.map((p, i) => (p && p.c === opp && onHalf(i, opp) ? board.sqName(i) : null)).filter(Boolean) : []);

/**
 * @description The 21a-D reviewer's generator (scratch-21a-D-review/h3d/fuzz.mjs): Opposing Finality, Insidious Nullification and All or Nothing kept in both hands, Hunger given often, Overwatch on both sides on even seeds, a Fog of War on w / b / none by seed % 3. onStep(prev, next, events, ply) after each action. Task 25b: Hunger removes no pawn now (it costs turns), so All or Nothing's lost hands make the own-side removals (forfeits) under the fog.
 */
const KEPT = ["insidious-nullification", "opposing-finality", "all-or-nothing"];
function fuzzGame(seed, plies, onStep) {
	let a0 = (seed * 7 + 1) >>> 0;
	const roll = (n) => { a0 = (a0 + 0x6D2B79F5) >>> 0; let t = Math.imul(a0 ^ (a0 >>> 15), a0 | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) % n; };
	let s = newGame({ cardGuy: "b", level: 1300, seed });
	const fogSide = seed % 3 === 0 ? "b" : seed % 3 === 1 ? "w" : null, watch = seed % 2 === 0;
	if (fogSide) s.enchant.push({ id: "e-fog", key: "fog-of-war", owner: fogSide, pieces: [], left: seed % 4 ? 99 : 6, data: {} });
	let n = 0;
	for (let ply = 0; ply < plies && !s.result; ply++) {
		for (const c of ["w", "b"]) {
			const pl = s.players[c];
			if (watch && !s.effects.some((e) => e.owner === c && e.card.key === "overwatch") && s.effects.filter((e) => e.owner === c).length < 3) { n++; s.effects.push({ id: "ow" + c + n, owner: c, card: { id: "ow" + c + n, key: "overwatch" }, placedAt: s.ply }); }
			for (const key of KEPT) if (!pl.actives.some((x) => x.key === key) && pl.actives.length < 5) { n++; pl.actives.push({ id: "x" + key[0] + c + n, key }); }
			if (!pl.curses.some((x) => x.key === "hunger") && pl.curses.length < 2 && roll(4) === 0) { n++; pl.curses.push({ id: "h" + c + n, key: "hunger", left: roll(2) }); }
		}
		const toAct = s.pending ? [s.pending.player] : s.duel ? ["w", "b"] : [s.board.turn];
		const can = toAct.map((c) => [c, legalActions(s, c)]).filter((x) => x[1].length);
		if (!can.length) break;
		const [color, acts] = can[roll(can.length)];
		const keyOf = (a) => a.type === "active" && baseKey((s.players[color].actives.find((x) => x.id === a.card) || {}).key);
		const fav = acts.filter((a) => KEPT.includes(keyOf(a)));
		const caps = acts.filter((a) => a.type === "move" && s.board.sq[board.sqIndex(a.to)]);
		const r0 = roll(6);
		const a = fav.length && r0 < 2 ? fav[roll(fav.length)] : caps.length && r0 < 4 ? caps[roll(caps.length)] : acts[roll(acts.length)];
		const { state, events } = applyAction(s, color, a);
		onStep(s, state, events, ply);
		s = state;
	}
}

/**
 * @description The told events of the action at this seed and ply, for viewer: { prev, seen, raw }.
 */
function at(seed, ply, viewer) {
	let out = null;
	fuzzGame(seed, ply + 1, (prev, next, events, i) => { if (i === ply) out = { prev, seen: playerEvents(next, events, viewer), raw: events }; });
	return out;
}

/**
 * @description The squares of told events that were hidden from viewer before the action. A ranged shot's capture keeps from (the shooter's square, user ruling 2026-11-23); a square viewer's own move went to (raw: a move by a piece hidden after it is told bare) is viewer's own knowledge.
 */
function leaks(prev, seen, viewer, raw) {
	const hid = hiddenSquares(prev, other(viewer)), out = [];
	const mine = raw.filter((e) => e.type === "move" && e.player === viewer).map((e) => e.to); // VIEWER CHOSE IT
	for (const e of seen) for (const k of SQ_FIELDS) {
		if (typeof e[k] !== "string" || !hid.includes(e[k]) || mine.includes(e[k])) continue;
		if (e.type === "capture" && k === "from" && typeof e.sq === "string") continue; // RULING 2026-11-23: A SHOT'S from STAYS
		out.push(e.type + "." + k + "=" + e[k]);
	}
	return out;
}

/**
 * @description A2-M1, the other two directions (the A2 reviewer's oracle, scratch-t25-A2-review/fuzz.js): the squares of told events hidden AFTER the action that viewer did not know before (not a square of their own pieces, not where their own move went), and the ids of pieces hidden after it named outside the square fields (b1..b8 read as black ids there).
 */
function leaksAfter(prev, next, seen, viewer, raw) {
	const opp = other(viewer), hid = hiddenSquares(next, opp), out = [];
	const known = prev.board.sq.map((p, i) => (p && p.c === viewer ? board.sqName(i) : null)).filter(Boolean).concat(raw.filter((e) => e.type === "move" && e.player === viewer).map((e) => e.to));
	const ids = next.board.sq.filter((p, i) => p && p.c === opp && onHalf(i, opp)).map((p) => p.id);
	for (const e of seen) {
		for (const k of SQ_FIELDS) {
			if (typeof e[k] !== "string" || !hid.includes(e[k]) || known.includes(e[k])) continue;
			if (e.type === "capture" && k === "from" && typeof e.sq === "string") continue; // RULING 2026-11-23: A SHOT'S from STAYS
			out.push(e.type + "." + k + "=" + e[k]);
		}
		const rest = JSON.stringify(e, (k, x) => (SQ_FIELDS.includes(k) ? undefined : x));
		for (const id of ids) if (rest.includes('"' + id + '"')) out.push(e.type + " names " + id);
	}
	return out;
}

test("repro: seed 31 ply 80, viewer b under w's fog: the handed-over mover's fogged from is not told", () => { // WAS SEED 21 PLY 42, VIEWER w (ENGINE 2), THEN SEED 217 PLY 60 (TASK 25b); RE-PINNED AFTER RULING C2 (scratch-t25-inline/repin.js): FAILS ON THE PRE-FIX view.js
	const { prev, seen, raw } = at(31, 80, "b");
	assert.ok(raw.some((e) => e.type === "handover" && e.player === "b"), "the repro still hands a piece to b");
	const mv = raw.find((e) => e.type === "move" && e.from === "g2");
	assert.ok(mv && raw.some((e) => e.type === "handover" && e.piece === mv.piece), "the raw move comes from g2, by the piece handed over");
	assert.ok(!seen.some((e) => e.from === "g2"), "g2 told: " + JSON.stringify(seen.filter((e) => e.from === "g2")));
	assert.deepEqual(leaks(prev, seen, "b", raw), []);
});

test("repro: seed 7 ply 51, viewer b under w's fog: the handover of a hidden g1 drops its from", () => { // WAS SEED 1 PLY 32 (a2, ENGINE 2), THEN SEED 49 PLY 82 (c3, TASK 25b); RE-PINNED AFTER RULING C2: FAILS ON THE PRE-FIX view.js
	const { prev, seen, raw } = at(7, 51, "b");
	const h = raw.find((e) => e.type === "handover" && e.from === "g1");
	assert.ok(h && h.player === "b", "the repro still hands g1 to b");
	const told = seen.find((e) => e.type === "handover" && e.piece === h.piece);
	assert.ok(told, "the handover is still told");
	assert.ok(!("from" in told), "handover from told: " + JSON.stringify(told));
	assert.equal(told.to, h.to, "its landing square stays");
	assert.deepEqual(leaks(prev, seen, "b", raw), []);
});

test("fuzz: under fog no told event carries a square hidden before the action; without fog the squares are told as they are", { timeout: 120000 }, () => {
	const hits = { fogged: 0, handover: 0, open: 0, removal: 0 };
	for (let seed = 1; seed <= 60; seed++) {
		fuzzGame(seed, 120, (prev, next, events, ply) => {
			if (next.result) return; // THE ENDING ACTION IS TOLD IN FULL (USER RULING 2026-11-21 03:12)
			for (const viewer of ["w", "b"]) {
				const opp = other(viewer), seen = playerEvents(next, events, viewer);
				if (fogOn(prev, opp) && fogOn(next, opp)) {
					hits.fogged++;
					if (events.some((e) => e.type === "handover")) hits.handover++;
					if (events.some((e) => e.type === "capture" && e.player === opp && e.c === opp)) hits.removal++; // A FOGGED PIECE REMOVED BY ITS OWN SIDE (ALL OR NOTHING'S LOST HAND)
					assert.deepEqual(leaks(prev, seen, viewer, events), [], "seed " + seed + " ply " + ply + " viewer " + viewer);
					assert.deepEqual(leaksAfter(prev, next, seen, viewer, events), [], "A2-M1, seed " + seed + " ply " + ply + " viewer " + viewer);
				} else if (!fogOn(prev, opp) && !fogOn(next, opp)) {
					hits.open++;
					const pick = (list) => list.filter((e) => ["move", "capture", "handover"].includes(e.type)).map((e) => SQ_FIELDS.map((k) => e[k]));
					assert.deepEqual(pick(seen), pick(events), "no fog: squares changed, seed " + seed + " ply " + ply + " viewer " + viewer);
				}
			}
		});
	}
	for (const [k, v] of Object.entries(hits)) assert.ok(v > 20, k + " hit only " + v);
});
})();

/* ================================================================ */
// T25 B2 / F2: THE BLIND TOLD LIST (playerLegal)
/* ================================================================ */
(() => {
/*
 *  cards-viewFog.test.js, Trapdoor, Swap and All or Nothing told blind
 *	Task 25 B2 (user ruling): under the opponent's Fog of War, Trapdoor, Swap and All or Nothing are told by what the player can see (as if the hidden pieces were not there) and refused on play; a Trapdoor square b1..b8 is not a black piece's id (view.js playerLegal)
 *
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { newGame, legalActions, applyAction, IllegalAction, playerLegal, actionKey } = require("../../../cards-engine/index.js");
const { fromFen, sqIndex } = require("../../../cards-engine/board.js");
const { baseKey } = require("../../../cards-engine/cards/index.js");

const BLIND = ["trapdoor", "swap", "all-or-nothing"];
const FOG = { id: "e-fog", key: "fog-of-war", owner: "b", pieces: [], left: 99, data: {} };
const onHalf = (i, c) => (c === "w" ? i >= 32 : i < 32);

/**
 * @description Test-only: a game on this FEN, no cards but White's actives (key list, ids c90...), Black's Fog of War up when fog.
 */
function game(fen, keys, fog = true) {
	const s = newGame({ cardGuy: "b", level: 1300, seed: 1 });
	s.board = fromFen(fen);
	for (const c of ["w", "b"]) Object.assign(s.players[c], { moves: [], actives: [], passive: null });
	s.players.w.actives = keys.map((key, n) => ({ id: "c" + (90 + n), key }));
	if (fog) s.enchant.push({ ...FOG });
	return s;
}

/**
 * @description Test-only: a copy of s with the piece on square from moved to the empty square to (same id).
 */
function shift(s, from, to) {
	const t = JSON.parse(JSON.stringify(s)), sq = t.board.sq;
	[sq[sqIndex(to)], sq[sqIndex(from)]] = [sq[sqIndex(from)], null];
	return t;
}

const keys = (list) => list.map(actionKey).sort();

test("a Trapdoor square b1 is told under the fog though a hidden black piece has the id b1", () => {
	const s = game("k7/8/8/8/8/8/8/4K3 w", ["trapdoor"]); // b1 IS THE HIDDEN BLACK KING'S ID
	assert.equal(s.board.sq[sqIndex("a8")].id, "b1");
	assert.ok(playerLegal(s, "w").some((a) => a.target && a.target.square === "b1"));
});

test("under the fog the Trapdoor squares told don't change with where the hidden pieces stand; the ones the hidden pieces rule out are refused on play", () => {
	const s = game("7k/8/8/3p4/8/8/8/4K3 w", ["trapdoor"]), t = shift(shift(s, "d5", "a7"), "h8", "d5"); // SAME IDS, OTHER SQUARES
	assert.deepEqual(keys(playerLegal(s, "w")), keys(playerLegal(t, "w")));
	const told = playerLegal(s, "w");
	assert.ok(told.some((a) => a.target && a.target.square === "d4"), "d4, beside the hidden d5 pawn, is told");
	assert.throws(() => applyAction(s, "w", told.find((a) => a.target && a.target.square === "d4")), IllegalAction);
	assert.throws(() => applyAction(t, "w", told.find((a) => a.target && a.target.square === "c4")), IllegalAction); // BESIDE THE HIDDEN KING ON d5, TOO NEAR IT
	assert.doesNotThrow(() => applyAction(s, "w", told.find((a) => a.target && a.target.square === "a1")));
});

test("a Swap a hidden rook makes illegal is told under the fog and refused on play", () => {
	const s = game("r3k3/8/8/8/8/8/8/R3K3 w", ["swap"]); // THE KING TO a1 WALKS INTO THE HIDDEN a8 ROOK
	const swap = { type: "active", card: "c90", target: { pieces: ["w1", "w2"] } };
	assert.ok(!legalActions(s, "w").some((a) => actionKey(a) === actionKey(swap)));
	assert.ok(playerLegal(s, "w").some((a) => actionKey(a) === actionKey(swap)));
	assert.throws(() => applyAction(s, "w", swap), IllegalAction);
});

test("All or Nothing is told under the fog while a hidden piece gives check, and refused on play", () => {
	const s = game("4k3/8/8/4q3/8/8/8/R3K3 w", ["all-or-nothing"]);
	const aon = { type: "active", card: "c90", target: { piece: "w1" } };
	assert.ok(!legalActions(s, "w").some((a) => a.card === "c90"));
	assert.deepEqual(playerLegal(s, "w").filter((a) => a.card === "c90"), [aon]);
	assert.throws(() => applyAction(s, "w", aon), IllegalAction);
});

test("with no fog the told list is the whole legal list, unchanged", () => {
	for (const [fen, key] of [["7k/8/8/3p4/8/8/8/4K3 w", "trapdoor"], ["r3k3/8/8/8/8/8/8/R3K3 w", "swap"], ["4k3/8/8/4q3/8/8/8/R3K3 w", "all-or-nothing"], ["k7/8/8/8/8/8/8/4K3 w", "trapdoor"]]) {
		const s = game(fen, [key, "swap"], false);
		assert.deepEqual(playerLegal(s, "w"), legalActions(s, "w"));
	}
	const s = newGame({ cardGuy: "b", level: 1300, seed: 7 });
	assert.deepEqual(playerLegal(s, "w"), legalActions(s, "w"));
});

/**
 * @description Seeded random games with Trapdoor, Swap and All or Nothing (and their versions) kept in White's hand and Black's Fog of War up; onState(s) at every state where White is to act.
 */
function fuzz(seed, plies, onState) {
	let a0 = (seed * 7 + 1) >>> 0;
	const roll = (n) => { a0 = (a0 + 0x6D2B79F5) >>> 0; let t = Math.imul(a0 ^ (a0 >>> 15), a0 | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) % n; };
	let s = newGame({ cardGuy: "b", level: 1300, seed });
	s.enchant.push({ ...FOG });
	const kept = ["trapdoor", "swap", "all-or-nothing", "swap-epic", "all-or-nothing-legendary"];
	let n = 0;
	for (let ply = 0; ply < plies && !s.result; ply++) {
		const pl = s.players.w;
		for (const key of kept) if (!pl.actives.some((x) => x.key === key) && pl.actives.length < 6) pl.actives.push({ id: "x" + ++n, key });
		const color = s.pending ? s.pending.player : s.board.turn;
		if (color === "w" && !s.pending && !s.duel) onState(s, roll);
		const acts = legalActions(s, color);
		if (!acts.length) break;
		const plain = acts.filter((a) => a.type === "move");
		s = applyAction(s, color, plain.length && roll(3) ? plain[roll(plain.length)] : acts[roll(acts.length)]).state;
	}
}

// ONLY THE THREE CARDS' ACTIONS ARE COMPARED, NOT THE WHOLE TOLD LIST (F2-M1): MOVING THE HIDDEN PIECES CAN GIVE OR LIFT A CHECK, WHICH THE PLAYER IS TOLD ANYWAY & WHICH CHANGES THE REST OF THE LIST
// (THE F2 REVIEWER'S PROBE: 11 OF 152 STATES DIFFER, ALL 11 BY A CHECK; 0 WITH THE CHECK STATES LEFT OUT). TOLD ACTIONS A FOGGED TURN: 95.6 BEFORE THE CHANGE, 97.4 AFTER (playerLegal 5.3 ms -> 9.2 ms MEAN)
test("fuzz: under the fog the Trapdoor, Swap and All or Nothing actions told are the same wherever the hidden pieces stand; each told one is played or refused, nothing else", () => {
	let checked = 0, refused = 0;
	for (let seed = 1; seed <= 12; seed++) fuzz(seed, 60, (s, roll) => {
		const blind = new Set(s.players.w.actives.filter((c) => BLIND.includes(baseKey(c.key))).map((c) => c.id));
		const mine = (list) => keys(list.filter((a) => a.type === "active" && blind.has(a.card)));
		const t = JSON.parse(JSON.stringify(s)), sq = t.board.sq;
		const hid = sq.map((p, i) => i).filter((i) => sq[i] && sq[i].c === "b" && onHalf(i, "b"));
		for (const i of hid) { // EACH HIDDEN PIECE TO A RANDOM EMPTY SQUARE OF ITS HALF
			const free = sq.map((p, j) => j).filter((j) => !sq[j] && onHalf(j, "b"));
			const j = free[roll(free.length)];
			[sq[j], sq[i]] = [sq[i], null];
		}
		const told = playerLegal(s, "w");
		assert.deepEqual(mine(playerLegal(t, "w")), mine(told), "seed state at ply " + s.ply);
		const tries = told.filter((x) => x.type === "active" && blind.has(x.card));
		for (const a of tries.length ? [tries[roll(tries.length)], tries[roll(tries.length)]] : []) { // TWO A STATE: EACH applyAction RUNS THE TRIALS AGAIN
			try { applyAction(s, "w", a); } catch (e) { assert.ok(e instanceof IllegalAction, e.stack); refused++; }
		}
		checked++;
	});
	assert.ok(checked > 150, "states checked: " + checked);
	assert.ok(refused > 0, "some told action was refused");
});
})();
