/*
 *  turn-hand.test.js  --  chess cards engine tests
 *	Game state and hands (cards-engine/hand.js, turn/index.js, index.js): the opening hand, move cards, the free discard and its draw-back, the passive reroll, move-card draws
 *
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { legalActions, applyAction, actionKey, IllegalAction, ENGINE_VERSION } = require("../../../../cards-engine/index.js");
const { sqIndex } = require("../../../../cards-engine/board.js");
const { inCheck } = require("../../../../cards-engine/rules.js");
const { makeCtx } = require("../../../../cards-engine/ctx.js");
const hand = require("../../../../cards-engine/hand.js");
const { register, reset } = require("../../../../cards-engine/cards/index.js");
const { fresh, game, card, play, types } = require("../../helpers/turn.js");

reset(); // THE ENGINE ENTRY REGISTERS EVERY CARD: THESE TESTS DRAW FROM ONLY THE CARDS THEY REGISTER

// TEST-ONLY CARDS: AN ACTIVE (PLAYABLE ONLY WHILE activeOn; ITS PLAY RUNS onPlay, ELSE DOES NOTHING) AND A PASSIVE
let activeOn = false, onPlay = null;
register({ key: "test-active", kind: "active", name: "Test Active", rarity: "common", text: "", targets: () => (activeOn ? [null] : []), play: (ctx, player, target) => onPlay && onPlay(ctx, player, target) });
register({ key: "test-passive", kind: "passive", name: "Test Passive", rarity: "common", text: "" });

test("opening hand", () => {
	const s = fresh();
	for (const c of ["w", "b"]) {
		const p = s.players[c];
		assert.equal(p.king, true);
		assert.equal(p.moves.length, 5);
		assert.equal(p.actives.length, 1);
		assert.equal(p.passive, null);
		assert.ok(p.moves.every((m) => m.key === "move" && "pmrq".includes(m.piece) && /^c\d+$/.test(m.id)));
	}
	assert.equal(s.v, ENGINE_VERSION);
	assert.equal(s.result, null);
	assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
});

test("newGame shuffles each colour's piece ids with the game rng", () => {
	const ids = (s) => s.board.sq.map((p) => p && p.id).join(",");
	assert.notEqual(ids(fresh(1)), ids(fresh(2)));
	assert.equal(ids(fresh(7)), ids(fresh(7)));
	for (const c of ["w", "b"]) {
		const got = fresh(3).board.sq.filter((p) => p && p.c === c).map((p) => p.id).sort();
		assert.deepEqual(got, Array.from({ length: 16 }, (_, i) => c + (i + 1)).sort());
	}
});

test("move cards only name piece types the player still has, weighted by count on an empty hand", () => {
	const s = game("4k3/8/8/8/8/8/PPPPPPPP/3QK3 w - - 0 1"), ctx = makeCtx(s), n = 10000;
	let pawns = 0;
	for (let i = 0; i < n; i++) {
		s.players.w.moves = []; // AN EMPTY HAND AT EACH DRAW: A HELD TYPE IS DRAWN LESS OFTEN (cards-draws.test.js)
		const c = hand.drawMove(ctx, "w");
		assert.ok(c.piece === "p" || c.piece === "q", c.piece);
		if (c.piece === "p") pawns++;
	}
	assert.ok(Math.abs(pawns / n - 6 / 8) < 0.03, String(pawns / n)); // THE QUEEN COUNTS DOUBLE & PAWNS COUNT AS 6 AT MOST (USER RULINGS 2026-11-22): 6 IN 8
	const bare = game("4k3/8/8/8/8/8/8/4K3 w - - 0 1");
	assert.equal(hand.drawMove(makeCtx(bare), "w"), null);
});

test("a move card moves only its piece type, and is spent", () => {
	const s = fresh();
	s.players.w.moves = [card("m", "t1")];
	const moves = legalActions(s, "w").filter((a) => a.type === "move");
	assert.equal(moves.length, 4);
	assert.ok(moves.every((a) => a.card === "t1" && (a.from === "b1" || a.from === "g1")));
	assert.throws(() => applyAction(s, "w", { type: "move", card: "t1", from: "e2", to: "e4" }), IllegalAction);
	const { state, events } = applyAction(s, "w", { type: "move", card: "t1", from: "g1", to: "f3" });
	assert.equal(state.board.sq[sqIndex("f3")].t, "n");
	assert.ok(!state.players.w.moves.some((c) => c.id === "t1"));
	assert.equal(events[0].type, "move");
	assert.equal(events[0].card.id, "t1");
	assert.equal(state.board.turn, "b");
});

test("a Hexed piece can't be moved by a card", () => {
	const s = game("4k3/8/8/8/8/8/8/1N2K3 w - - 0 1");
	s.players.w.moves = [card("m", "t1")];
	assert.ok(legalActions(s, "w").some((a) => a.card === "t1"));
	s.statuses[s.board.sq[sqIndex("b1")].id] = [{ s: "hexed", left: 2, by: "b" }];
	assert.ok(!legalActions(s, "w").some((a) => a.type === "move" && a.card === "t1"));
});


test("the free discard lists each move card alone in hand order and each active; never the King card or a curse", () => {
	const s = fresh();
	s.players.w.curses = [{ id: "t9", key: "test-curse" }];
	const moves = hand.moveCards(s.players.w).map((c) => c.id), actives = s.players.w.actives.map((c) => c.id); // HAND ORDER: BY ID
	const want = [...moves, ...actives].map((id) => ({ type: "discard", cards: [id] })); // ONE CARD AT A TIME
	assert.deepEqual(legalActions(s, "w").filter((a) => a.type === "discard"), want);
	assert.equal(want.length, 6); // THE 5 MOVE CARDS & THE ACTIVE
});

test("a free discard of 2 move cards, one after the other, draws 1 back at once; the turn goes on; 2 a turn", () => {
	const s = fresh(), [a, b] = s.players.w.moves.map((c) => c.id);
	const one = applyAction(s, "w", { type: "discard", cards: [a] }), two = applyAction(one.state, "w", { type: "discard", cards: [b] });
	const state = two.state, events = [...one.events, ...two.events];
	assert.deepEqual(events.map((e) => e.type), ["discard", "discard", "draw"]);
	assert.deepEqual(events.slice(0, 2).map((e) => e.card.id), [a, b]);
	assert.equal(state.players.w.moves.length, 4);
	assert.ok(!state.players.w.moves.some((c) => c.id === a || c.id === b));
	assert.deepEqual([state.board.turn, state.ply, state.discarded], ["w", 0, { player: "w", kind: "move", n: 2 }]);
	assert.ok(!legalActions(state, "w").some((x) => x.type === "discard"));
	assert.ok(legalActions(state, "w").some((x) => x.type === "move"));
	const after = play(state, "w", "move");
	assert.equal(after.discarded, null);
	assert.equal(after.players.w.moves.length, 5); // THE NORMAL END-OF-TURN REFILL
	assert.ok(legalActions(after, "b").some((x) => x.type === "discard")); // BLACK'S OWN, ON BLACK'S TURN
});

test("a free discard of the active gives nothing back until this turn's refill", () => {
	const s = fresh(), id = s.players.w.actives[0].id;
	const { state, events } = applyAction(s, "w", { type: "discard", cards: [id] });
	assert.deepEqual(events.map((e) => e.type), ["discard"]);
	assert.deepEqual(state.players.w.actives, []);
	assert.equal(state.players.w.moves.length, 5);
	assert.equal(state.board.turn, "w");
	const after = play(state, "w", "move");
	assert.equal(after.players.w.actives.length, 1);
	assert.notEqual(after.players.w.actives[0].id, id);
});

test("no free discard during a two-move turn", () => {
	const s = fresh();
	s.multi = { player: "w", left: 2, moved: [], differ: true };
	assert.deepEqual(types(s, "w"), ["move"]);
});

test("no skip count: no player carries one", () => {
	const s = fresh();
	assert.ok(!("skips" in s.players.w) && !("skips" in s.players.b));
	assert.equal(s.discarded, null);
});

test("a free discard that leaves no card action: the automatic redraw at once, then stalemate", () => {
	activeOn = true;
	try {
		const s = game("k7/8/8/8/8/8/PP6/KB6 w - - 0 1"); // KING BOXED IN BY ITS OWN HEXED PIECES
		for (const sq of ["a2", "b2", "b1"]) s.statuses[s.board.sq[sqIndex(sq)].id] = [{ s: "hexed", left: 2, by: "b" }];
		s.players.w.moves = [card("p", "t1"), card("m", "t2")];
		assert.deepEqual(types(s, "w"), ["active", "discard"]);
		const { state, events } = applyAction(s, "w", { type: "discard", cards: [s.players.w.actives[0].id] });
		const kinds = events.map((e) => e.type);
		assert.equal(kinds[0], "discard");
		assert.ok(kinds.indexOf("redraw") > 0 && kinds.indexOf("redraw") < kinds.indexOf("game-over"));
		assert.deepEqual(state.result, { winner: null, reason: "stalemate" });
	} finally { activeOn = false; }
});

/* ---------------------------------------------------------------- */
// The draw-back floor (user ruling 2026-11-22)
/* ---------------------------------------------------------------- */
const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
/**
 * @description The piece types White draws back for the free discard of move card b with a remembered, on fen, over 60 seeds (undefined when no card was drawn).
 */
const drawBacks = (fen, a, b, curses = []) => new Set(Array.from({ length: 60 }, (_, seed) => {
	const s = game(fen, seed + 1);
	Object.assign(s.players.w, { moves: [b].filter((c) => !curses.includes(c)), curses, actives: [], passive: null, kept: a }); // a WENT ON AN EARLIER TURN AND IS REMEMBERED (ONE CARD AT A TIME); b IS ITS PAIR
	const { events } = applyAction(s, "w", { type: "discard", cards: [b.id] });
	assert.equal(events[0].type, "discard");
	return (events.find((e) => e.type === "draw") || { card: {} }).card.piece; // THE FIRST DRAW IS THE DRAW-BACK (A REDRAW'S COME AFTER IT)
}));
const within = (got, allowed) => assert.ok([...got].every((t) => allowed.includes(t)), `drew ${[...got]}, allowed ${allowed}`);

test("the values: pawn 1, knight 3, bishop 3, rook 5, queen 9 (Underdog's material), and the Knight / Bishop card 3 (the floor)", () => {
	assert.deepEqual(hand.PIECE_VALUE, { p: 1, n: 3, b: 3, m: 3, r: 5, q: 9 });
});

test("a free discard of two Knight / Bishop cards draws a Knight / Bishop or better, never a pawn", { skip: "the draw-back floor was dropped (user 2026-11-22, the draw-back is random again): kept for reference" }, () => {
	const got = drawBacks(START_FEN, card("m", "t1"), card("m", "t2"));
	within(got, ["m", "r", "q"]);
	assert.equal(got.size, 3);
});

test("a free discard of two rooks draws a rook or a queen", { skip: "the draw-back floor was dropped (user 2026-11-22, the draw-back is random again): kept for reference" }, () => {
	const got = drawBacks(START_FEN, card("r", "t1"), card("r", "t2"));
	within(got, ["r", "q"]);
	assert.equal(got.size, 2);
});

test("a free discard of a Knight / Bishop and a rook draws a card worth 3 or more: the lower of the two", { skip: "the draw-back floor was dropped (user 2026-11-22, the draw-back is random again): kept for reference" }, () => {
	const got = drawBacks(START_FEN, card("m", "t1"), card("r", "t2"));
	within(got, ["m", "r", "q"]);
	assert.ok(got.has("m"));
});

test("a free discard of a queen and a rook draws a card worth 5 or more", { skip: "the draw-back floor was dropped (user 2026-11-22, the draw-back is random again): kept for reference" }, () => {
	within(drawBacks(START_FEN, card("q", "t1"), card("r", "t2")), ["r", "q"]);
});

test("a free discard of two queens draws 1 card at random: any type on the board, a pawn too", () => {
	assert.deepEqual([...drawBacks(START_FEN, card("q", "t1"), card("q", "t2"))].sort(), ["m", "p", "q", "r"]);
});

test("a free discard of two queens draws a queen only", { skip: "the draw-back floor was dropped (user 2026-11-22, the draw-back is random again): kept for reference" }, () => {
	assert.deepEqual([...drawBacks(START_FEN, card("q", "t1"), card("q", "t2"))], ["q"]);
});

test("a free discard with a pawn in the pair draws any type still on the board", () => {
	const got = drawBacks(START_FEN, card("p", "t1"), card("q", "t2"));
	assert.ok(got.has("p") && got.size >= 3);
});

test("the floor drops to the most valuable type left: two rooks with no rook or queen draw a Knight / Bishop", { skip: "the draw-back floor was dropped (user 2026-11-22, the draw-back is random again): kept for reference" }, () => {
	assert.deepEqual([...drawBacks("4k3/8/8/8/8/8/PPPP4/1NB1K3 w - - 0 1", card("r", "t1"), card("r", "t2"))], ["m"]);
	assert.deepEqual([...drawBacks("4k3/8/8/8/8/8/PPPP4/4K3 w - - 0 1", card("q", "t1"), card("q", "t2"))], ["p"]);
});

test("a free discard of a pair by a bare king draws no card and doesn't throw", () => {
	assert.deepEqual([...drawBacks("4k3/8/8/8/8/8/8/4K3 w - - 0 1", card("r", "t1"), card("r", "t2"))], [undefined]);
});

test("an entered Mirage in the pair counts as the piece type it shows", { skip: "the draw-back floor was dropped (user 2026-11-22, the draw-back is random again): kept for reference" }, () => {
	const mirage = { id: "t2", key: "mirage", piece: "r" };
	within(drawBacks(START_FEN, card("q", "t1"), mirage, [mirage]), ["r", "q"]);
});

test("the opening deal, the refill and a Mulligan's draws are pinned (seed 1): a floor of 0 changes none of them. Re-pinned 2026-11-22 when a queen began to count double, and again when pawns began to count as 6 at most, for a hand of 5 with the Knight / Bishop card, and when the draw began to look at the hand", () => {
	const s = fresh();
	assert.equal(s.players.w.moves.map((c) => c.piece).join(""), "prmrq");
	assert.equal(s.players.b.moves.map((c) => c.piece).join(""), "rpmqq");
	const after = applyAction(s, "w", legalActions(s, "w").find((a) => a.type === "move")).state;
	assert.equal(after.players.w.moves.map((c) => c.piece).join(""), "rmrqq"); // THE END-OF-TURN REFILL
	const ctx = makeCtx(fresh()), { out, ms } = hand.throwMoves(ctx.state, "w"); // AS MULLIGAN DRAWS (cards/active/mulligan.js)
	hand.drawMoves(ctx, "w", out.length, ms);
	assert.equal(ctx.state.players.w.moves.map((c) => c.piece).join(""), "qmmmp");
});

/* ---------------------------------------------------------------- */
// The passive reroll (user ruling 2026-11-22)
/* ---------------------------------------------------------------- */
const { CARDS: REG, PASSIVE_KEYS } = require("../../../../cards-engine/cards/index.js");
/**
 * @description Runs fn with two more test passives in the registry, then takes them out again (the file's other tests draw from the cards registered at the top).
 */
const withPassives = (fn) => {
	const keys = ["test-passive-b", "test-passive-c"];
	for (const key of keys) register({ key, kind: "passive", name: key, rarity: "common", text: "" });
	try { return fn(); } finally { for (const key of keys) { delete REG[key]; PASSIVE_KEYS.splice(PASSIVE_KEYS.indexOf(key), 1); } }
};
const holding = (s, key = "test-passive") => { s.players.w.passive = { id: "t7", key }; return s; };
const REROLL = { type: "discard", cards: ["t7"] };
const rerolls = (s) => legalActions(s, "w").filter((a) => actionKey(a) === actionKey(REROLL));

test("the passive reroll is listed last among the free discards, only with a passive held", () => withPassives(() => {
	const s = fresh();
	assert.equal(legalActions(s, "w").filter((a) => a.type === "discard").length, 6);
	const discards = legalActions(holding(s), "w").filter((a) => a.type === "discard");
	assert.equal(discards.length, 7);
	assert.deepEqual(discards[6], REROLL);
}));

test("no passive reroll in check, after the turn's free discard, or in a two-move turn; after Mulligan yes", () => withPassives(() => {
	const checked = holding(game("4k3/8/8/8/8/8/4r3/4K3 w - - 0 1"));
	assert.ok(inCheck(checked, "w"));
	assert.equal(rerolls(checked).length, 0);
	const used = holding(fresh());
	used.discarded = "w";
	assert.equal(rerolls(used).length, 0);
	const two = holding(fresh());
	two.multi = { player: "w", left: 2, moved: [], differ: true };
	assert.equal(rerolls(two).length, 0);
	two.multi = { player: "w", left: 1, moved: [], differ: false, mulled: true };
	assert.equal(rerolls(two).length, 1);
}));

test("a passive reroll: the passive goes, a different one is in the hand at once, the turn goes on, no other free discard", () => withPassives(() => {
	for (let seed = 1; seed <= 30; seed++) {
		const s = holding(fresh(seed)), before = JSON.parse(JSON.stringify(s.players.w));
		const { state, events } = applyAction(s, "w", REROLL), p = state.players.w;
		assert.deepEqual(events.map((e) => e.type), ["discard", "draw"]);
		assert.deepEqual(events[0], { type: "discard", player: "w", card: { id: "t7", key: "test-passive" } });
		assert.deepEqual(events[1].card, p.passive);
		assert.ok(["test-passive-b", "test-passive-c"].includes(p.passive.key), "a different passive, seed " + seed);
		assert.deepEqual([state.board.turn, state.ply, state.discarded], ["w", 0, { player: "w", kind: "passive", n: 1 }]);
		assert.deepEqual([p.moves, p.actives, p.used], [before.moves, before.actives, before.used]); // NOTHING ELSE MOVES, AND THE OLD CARD ISN'T "used"
		assert.ok(!legalActions(state, "w").some((a) => a.type === "discard"));
		assert.ok(legalActions(state, "w").some((a) => a.type === "passive") && legalActions(state, "w").some((a) => a.type === "move"));
	}
}));

test("a rerolled passive can come back on a later turn's draw: it isn't used", () => withPassives(() => {
	const { state } = applyAction(holding(fresh()), "w", REROLL), ctx = makeCtx(state);
	state.players.w.gone = []; // AS THE END OF THE TURN LEAVES IT: NOT ON THE TURN IT LEFT
	const seen = new Set();
	for (let i = 0; i < 40; i++) { ctx.state.players.w.passive = null; seen.add(hand.drawCard(ctx, "w", "passive").key); }
	assert.ok(seen.has("test-passive"));
}));

test("a passive placed in Board Effects can't be rerolled", () => withPassives(() => {
	const { state } = applyAction(holding(fresh()), "w", { type: "passive" });
	assert.equal(state.players.w.passive, null);
	assert.ok(!legalActions(state, "b").some((a) => a.type === "discard" && a.cards.includes("t7")));
	assert.throws(() => applyAction(state, "b", REROLL), IllegalAction);
	const back = JSON.parse(JSON.stringify(state)); // WHITE'S TURN AGAIN, ITS PASSIVE STILL PLACED
	back.board.turn = "w";
	assert.equal(rerolls(back).length, 0);
}));

test("no passive reroll when no other passive is left to draw: it would only lose the card", () => {
	assert.equal(rerolls(holding(fresh())).length, 0); // ONLY test-passive IS REGISTERED
	withPassives(() => {
		const s = holding(fresh());
		s.players.w.used = ["test-passive-b"];
		s.effects.push({ id: "t8", owner: "w", card: { id: "t8", key: "test-passive-c" }, placedAt: 0 });
		assert.equal(rerolls(s).length, 0);
		s.effects = [];
		assert.equal(rerolls(s).length, 1);
	});
});

test("the free discard of an active is still an active's: the passive's id is what tells a reroll apart", () => withPassives(() => {
	const s = holding(fresh()), id = s.players.w.actives[0].id;
	const { state, events } = applyAction(s, "w", { type: "discard", cards: [id] });
	assert.deepEqual(events.map((e) => e.type), ["discard"]);
	assert.deepEqual(state.players.w.passive, { id: "t7", key: "test-passive" });
}));

test("drawMove: a queen on the board counts double, and pawns count as 6 at most, so at the start a Queen card is 2 in 14 and a Pawn card 6 in 14", () => {
	const s = fresh(7), ctx = makeCtx(s), n = 8000;
	let queens = 0, pawns = 0;
	for (let i = 0; i < n; i++) {
		s.players.w.moves = []; // NEVER FULL: EVERY DRAW LANDS
		const piece = hand.drawMove(ctx, "w").piece;
		if (piece === "q") { queens++; }
		if (piece === "p") { pawns++; }
	}
	assert.ok(Math.abs(queens / n - 2 / 14) < 0.02, `a Queen card ${(queens / n * 100).toFixed(1)}% of draws, 14.3% expected`);
	assert.ok(Math.abs(pawns / n - 6 / 14) < 0.02, `a Pawn card ${(pawns / n * 100).toFixed(1)}% of draws, 42.9% expected`);
	const few = makeCtx(game("4k3/8/8/8/8/8/PPPP4/3QK3 w - - 0 1"));
	let low = 0;
	for (let i = 0; i < n; i++) { few.state.players.w.moves = []; if (hand.drawMove(few, "w").piece === "p") { low++; } }
	assert.ok(Math.abs(low / n - 4 / 6) < 0.03, `4 pawns left count as 4: ${(low / n * 100).toFixed(1)}%, 66.7% expected`);
	const none = makeCtx(game("4k3/8/8/8/8/8/PPPP4/4K3 w - - 0 1"));
	assert.equal(hand.drawMove(none, "w").piece, "p"); // NO QUEEN: NOTHING CHANGES
});

/* ---------------------------------------------------------------- */
// The Knight / Bishop card (user ruling 2026-11-22)
/* ---------------------------------------------------------------- */
/**
 * @description The share of each move-card type in n draws for White on fen (the hand emptied before each, so every draw lands).
 */
const drawShares = (fen, n = 8000) => {
	const ctx = makeCtx(game(fen, 7)), got = {};
	for (let i = 0; i < n; i++) {
		ctx.state.players.w.moves = [];
		const t = hand.drawMove(ctx, "w").piece;
		got[t] = (got[t] || 0) + 1 / n;
	}
	return got;
};

test("drawMove: a knight and a bishop both give the Knight / Bishop card, never a Knight or a Bishop card; the start odds are Pawn 6, Knight / Bishop 4, Rook 2, Queen 2 in 14", () => {
	const got = drawShares(START_FEN);
	assert.deepEqual(Object.keys(got).sort(), ["m", "p", "q", "r"]);
	for (const [t, k] of [["p", 6], ["m", 4], ["r", 2], ["q", 2]]) assert.ok(Math.abs(got[t] - k / 14) < 0.02, `${t}: ${(got[t] * 100).toFixed(1)}%, ${k} in 14 expected`);
});

test("drawMove: the Knight / Bishop card with only bishops left, with only knights left, and never with neither", () => {
	const bishops = drawShares("4k3/8/8/8/8/8/PP6/2B1KB2 w - - 0 1", 2000), knights = drawShares("4k3/8/8/8/8/8/PP6/1N2K3 w - - 0 1", 2000);
	assert.ok(Math.abs(bishops.m - 2 / 4) < 0.04, String(bishops.m));
	assert.ok(Math.abs(knights.m - 1 / 3) < 0.04, String(knights.m));
	assert.deepEqual(Object.keys(drawShares("4k3/8/8/8/8/8/PP6/R2QK3 w - - 0 1", 2000)).sort(), ["p", "q", "r"]);
});

test("the Knight / Bishop card moves a knight and a bishop and nothing else; the move spends it", () => {
	const s = game("4k3/8/8/8/8/8/8/RNBQK3 w - - 0 1");
	s.players.w.moves = [card("m", "t1")];
	const moves = legalActions(s, "w").filter((a) => a.type === "move" && a.card === "t1");
	assert.deepEqual([...new Set(moves.map((a) => a.from))].sort(), ["b1", "c1"]);
	for (const from of ["b1", "c1"]) {
		const a = moves.find((x) => x.from === from), { state, events } = applyAction(s, "w", a);
		assert.equal(state.board.sq[sqIndex(a.to)].t, from === "b1" ? "n" : "b");
		assert.ok(!state.players.w.moves.some((c) => c.id === "t1"));
		assert.deepEqual(events.find((e) => e.type === "move").card, card("m", "t1"));
	}
	for (const from of ["a1", "d1"]) assert.throws(() => applyAction(s, "w", { type: "move", card: "t1", from, to: from[0] + "2" }), IllegalAction);
	for (const t of ["n", "b"]) { // AN OLD KNIGHT OR BISHOP CARD MOVES NOTHING: NO CODE KEEPS IT WORKING
		s.players.w.moves = [card(t, "t1")];
		assert.ok(!legalActions(s, "w").some((a) => a.type === "move" && a.card === "t1"));
	}
});
