/*
 *  cards-turn.test.js  --  chess cards engine tests
 *	Game state, hands and the turn (cards-engine/hand.js, turn.js, ctx.js, index.js)
 *
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { newGame, legalActions, applyAction, actionKey, IllegalAction, ENGINE_VERSION, KING_SKULLS } = require("../../cards-engine/index.js");
const { fromFen, sqIndex } = require("../../cards-engine/board.js");
const { legalMoves, inCheck } = require("../../cards-engine/rules.js");
const { makeCtx } = require("../../cards-engine/ctx.js");
const hand = require("../../cards-engine/hand.js");
const turn = require("../../cards-engine/turn.js");
const { register, reset } = require("../../cards-engine/cards/index.js");

reset(); // THE ENGINE ENTRY REGISTERS EVERY CARD: THESE TESTS DRAW FROM ONLY THE CARDS THEY REGISTER

// TEST-ONLY CARDS: AN ACTIVE (PLAYABLE ONLY WHILE activeOn; ITS PLAY RUNS onPlay, ELSE DOES NOTHING) AND A PASSIVE
let activeOn = false, onPlay = null;
register({ key: "test-active", kind: "active", name: "Test Active", rarity: "common", text: "", targets: () => (activeOn ? [null] : []), play: (ctx, player, target) => onPlay && onPlay(ctx, player, target) });
register({ key: "test-passive", kind: "passive", name: "Test Passive", rarity: "common", text: "" });

const fresh = (seed = 1) => newGame({ cardGuy: "b", level: 1300, seed });
const game = (fen, seed = 1) => { const s = fresh(seed); s.board = fromFen(fen); return s; };
const card = (piece, id) => ({ id, key: "move", piece });
const first = (s, c, type) => legalActions(s, c).find((a) => a.type === type);
const play = (s, c, type) => applyAction(s, c, first(s, c, type)).state;
const types = (s, c) => [...new Set(legalActions(s, c).map((a) => a.type))].sort();
const pass = (s, c) => { const t = JSON.parse(JSON.stringify(s)); t.players[c].passive = { id: "tp" + t.ply, key: "test-passive" }; return applyAction(t, c, { type: "passive" }).state; }; // A TURN WITHOUT A MOVE

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
		s.players.w.moves = []; // AN EMPTY HAND AT EACH DRAW: A HELD TYPE IS DRAWN LESS OFTEN (TASK 20e, cards-draws.test.js)
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
	const want = [...moves, ...actives].map((id) => ({ type: "discard", cards: [id] })); // ONE CARD AT A TIME (TASK 20e)
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
	Object.assign(s.players.w, { moves: [b].filter((c) => !curses.includes(c)), curses, actives: [], passive: null, kept: a }); // a WENT ON AN EARLIER TURN AND IS REMEMBERED (TASK 20e: ONE CARD AT A TIME); b IS ITS PAIR
	const { events } = applyAction(s, "w", { type: "discard", cards: [b.id] });
	assert.equal(events[0].type, "discard");
	return (events.find((e) => e.type === "draw") || { card: {} }).card.piece; // THE FIRST DRAW IS THE DRAW-BACK (A REDRAW'S COME AFTER IT)
}));
const within = (got, allowed) => assert.ok([...got].every((t) => allowed.includes(t)), `drew ${[...got]}, allowed ${allowed}`);

test("the values: pawn 1, knight 3, bishop 3, rook 5, queen 9 (Underdog's material), and the Knight / Bishop card 3 (the floor)", () => {
	assert.deepEqual(hand.VALUE, { p: 1, n: 3, b: 3, m: 3, r: 5, q: 9 });
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

test("the opening deal, the refill and a Mulligan's draws are pinned (seed 1): a floor of 0 changes none of them. Re-pinned 2026-11-22 when a queen began to count double, and again when pawns began to count as 6 at most, and for Task 20c (a hand of 5, the Knight / Bishop card), and for Task 20e (the draw looks at the hand)", () => {
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
const { CARDS: REG, PASSIVE_KEYS } = require("../../cards-engine/cards/index.js");
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
	state.players.w.gone = []; // AS THE END OF THE TURN LEAVES IT: NOT ON THE TURN IT LEFT (TASK 20e)
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

test("placing a passive puts it into Board Effects and uses the turn", () => {
	const s = fresh();
	s.players.w.passive = { id: "t1", key: "test-passive" };
	const r = applyAction(s, "w", { type: "passive" });
	assert.equal(r.state.players.w.passive === null || r.state.players.w.passive.id !== "t1", true);
	assert.deepEqual(r.state.effects, [{ id: "t1", owner: "w", card: { id: "t1", key: "test-passive" }, placedAt: 0 }]);
	assert.equal(r.events[0].type, "passive-placed");
	assert.equal(r.state.board.turn, "b");
});

test("in check, discard and place passive are not legal", () => {
	activeOn = true;
	try {
		const calm = game("4k3/8/8/8/8/8/7r/4K3 w - - 0 1");
		calm.players.w.passive = { id: "t1", key: "test-passive" };
		assert.deepEqual(types(calm, "w"), ["active", "discard", "move", "passive"]);
		const s = game("4k3/8/8/8/8/8/8/4K2r w - - 0 1");
		s.players.w.passive = { id: "t1", key: "test-passive" };
		assert.deepEqual(types(s, "w"), ["move"]); // THE ACTIVE DOES NOTHING, SO IT CAN'T END THE CHECK
		for (const a of legalActions(s, "w")) assert.equal(inCheck(applyAction(s, "w", a).state, "w"), false);
	} finally { activeOn = false; }
});

test("an active card is played and spent", () => {
	activeOn = true;
	try {
		const s = fresh(), id = s.players.w.actives[0].id;
		const { state, events } = applyAction(s, "w", { type: "active", card: id });
		assert.equal(events[0].type, "card-played");
		assert.equal(events[0].card.id, id);
		assert.equal(state.players.w.actives.length, 1);
		assert.notEqual(state.players.w.actives[0].id, id);
		assert.equal(state.board.turn, "b");
	} finally { activeOn = false; }
});

test("no legal action → automatic redraw, then checkmate by the cards", () => {
	// THE ONLY WHITE PIECE BESIDES THE KING IS A HEXED ROOK: Rxg2 IS A CARDLESS ESCAPE, AND A REDRAW CAN ONLY GIVE ROOK CARDS
	const s = game("8/8/8/3q4/8/6k1/R7/7K b - - 0 1");
	const rook = s.board.sq[sqIndex("a2")].id;
	s.statuses[rook] = [{ s: "hexed", left: 2, by: "b" }];
	s.players.w.moves = [card("r", "t1"), card("r", "t2")];
	s.players.w.actives = [];
	s.players.b.moves = [card("q", "t3")];
	const { state, events } = applyAction(s, "b", { type: "move", card: "t3", from: "d5", to: "g2" });
	assert.ok(legalMoves(state, "w").some((m) => m.from === "a2" && m.to === "g2"));
	const kinds = events.map((e) => e.type);
	assert.ok(kinds.indexOf("redraw") > 0 && kinds.indexOf("redraw") < kinds.indexOf("game-over"));
	assert.ok(!state.players.w.moves.some((c) => c.id === "t1" || c.id === "t2"));
	assert.ok(state.players.w.moves.every((c) => c.piece === "r"));
	assert.equal(state.players.w.moves.length, 5); // A FULL HAND: max(2 THROWN OUT, 5)
	assert.deepEqual(state.result, { winner: "b", reason: "checkmate" });
});

test("no legal action and not in check after the redraw → stalemate", () => {
	const s = game("k7/8/8/1R3q2/8/8/8/7K b - - 0 1");
	s.statuses[s.board.sq[sqIndex("b5")].id] = [{ s: "hexed", left: 2, by: "b" }];
	s.players.w.moves = [card("r", "t1")];
	s.players.w.actives = [];
	s.players.b.moves = [card("q", "t3")];
	const { state, events } = applyAction(s, "b", { type: "move", card: "t3", from: "f5", to: "f2" });
	assert.ok(legalMoves(state, "w").length > 0);
	assert.ok(events.some((e) => e.type === "redraw" && e.player === "w"));
	assert.deepEqual(state.result, { winner: null, reason: "stalemate" });
});

test("a mate delivered with the halfmove clock at 100 is a win, not a draw", () => {
	const s = game("8/8/8/3q4/8/6k1/8/7K b - - 99 80");
	s.players.b.moves = [card("q", "t3")];
	const { state } = applyAction(s, "b", { type: "move", card: "t3", from: "d5", to: "g2" });
	assert.equal(state.board.half, 100);
	assert.deepEqual(state.result, { winner: "b", reason: "checkmate" });
});

test("bare kings after a capture: a draw by material", () => {
	const s = game("8/8/8/8/8/8/3q4/3K2k1 w - - 0 1");
	const { state, events } = applyAction(s, "w", { type: "move", card: "king", from: "d1", to: "d2" });
	assert.deepEqual(state.result, { winner: null, reason: "material" });
	assert.deepEqual(state.players.b.captured, ["q"]);
	assert.ok(events.some((e) => e.type === "capture" && e.player === "w"));
});

test("capturing a Marked piece: statuses cleared, the capturer draws a move card, the owner discards 2", () => {
	const s = game("3r3k/8/8/8/8/8/8/3Q3K w - - 0 1"), rook = s.board.sq[sqIndex("d8")].id;
	s.statuses[rook] = [{ s: "marked", left: null, by: "w" }, { s: "shaken", left: 2, by: "w" }];
	s.players.w.moves = [card("q", "t1"), ...[2, 3, 4, 5, 6].map((n) => card("q", "t" + n))];
	s.players.b.moves = [card("p", "t7"), card("p", "t8"), card("p", "t9")];
	s.players.b.actives = [];
	const { state, events } = applyAction(s, "w", { type: "move", card: "t1", from: "d1", to: "d8" });
	assert.equal(state.statuses[rook], undefined);
	assert.deepEqual(state.players.b.captured, ["r"]);
	assert.equal(events.filter((e) => e.type === "draw" && e.player === "w").length, 1);
	assert.equal(state.players.w.moves.length, 6);
	assert.equal(events.filter((e) => e.type === "discard" && e.player === "b").length, 2);
	assert.equal(state.players.b.moves.length, 1);
	assert.ok(events.some((e) => e.type === "check" && e.player === "b"));
});

test("refill tops up to 5 and 1 and never trims", () => {
	const s = fresh();
	s.players.w.moves = [card("p", "t1"), card("p", "t2"), card("p", "t3")];
	s.players.w.actives = [];
	let w = applyAction(s, "w", { type: "move", card: "t1", from: "e2", to: "e4" }).state.players.w;
	assert.equal(w.moves.length, 5);
	assert.equal(w.actives.length, 1);
	s.players.w.moves = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => card("p", "t" + n));
	s.players.w.actives = [{ id: "a1", key: "test-active" }, { id: "a2", key: "test-active" }];
	w = applyAction(s, "w", { type: "move", card: "t1", from: "e2", to: "e4" }).state.players.w;
	assert.equal(w.moves.length, 7);
	assert.equal(w.actives.length, 2);
	s.players.w.moves = [card("p", "t1")];
	s.players.w.refillLock = 1;
	w = applyAction(s, "w", { type: "move", card: "t1", from: "e2", to: "e4" }).state.players.w;
	assert.equal(w.moves.length, 0);
	assert.equal(w.refillLock, 0);
});

test("draws past 9 move cards (or 3 actives) are lost", () => {
	const s = fresh(), ctx = makeCtx(s);
	s.players.w.moves = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => card("p", "t" + n));
	hand.drawMove(ctx, "w");
	assert.equal(s.players.w.moves.length, 9);
	assert.equal(ctx.events[0].type, "draw");
	assert.equal(ctx.events[0].lost, true);
	s.players.w.actives = [1, 2, 3].map((n) => ({ id: "a" + n, key: "other" }));
	hand.drawCard(ctx, "w", "active");
	assert.equal(s.players.w.actives.length, 3);
	assert.equal(ctx.events[1].lost, true);
});

test("an active already held is never drawn; none left → null", () => {
	const s = fresh(), ctx = makeCtx(s);
	assert.equal(s.players.w.actives[0].key, "test-active");
	assert.equal(hand.drawCard(ctx, "w", "active"), null);
	s.players.w.used = ["test-passive"];
	assert.equal(hand.drawCard(ctx, "w", "passive"), null);
});

test("the passive roll: 1 in 3, from a player's second turn, only with an empty slot", () => {
	let got = 0;
	const n = 3000;
	for (let seed = 1; seed <= n; seed++) {
		const s = fresh(seed), ctx = makeCtx(s);
		turn.startTurn(ctx, "w");
		assert.equal(s.players.w.passive, null); // PLY 0: NO ROLL
		s.ply = 2;
		turn.startTurn(ctx, "w");
		if (s.players.w.passive) got++;
	}
	assert.ok(Math.abs(got / n - turn.PASSIVE_CHANCE) < 0.03, String(got / n));
	const s = fresh(), ctx = makeCtx(s);
	s.ply = 2;
	s.players.w.passive = { id: "t1", key: "other" };
	const used = s.rng.n;
	turn.startTurn(ctx, "w");
	assert.equal(s.rng.n, used); // NO OUTPUT DRAWN
	assert.equal(s.players.w.passive.id, "t1");
});

test("castling with the King card has one key and can't collide with another action", () => {
	const s = game("4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1");
	const castles = legalActions(s, "w").filter((a) => a.from === "e1" && a.to === "g1");
	assert.equal(castles.length, 1);
	assert.equal(castles[0].card, "king");
	const keys = legalActions(s, "w").map(actionKey);
	assert.equal(new Set(keys).size, keys.length);
	assert.notEqual(actionKey(castles[0]), actionKey({ type: "active", card: "c1", target: { move: { from: "e1", to: "g1" } } }));
	assert.equal(actionKey({ to: "g1", from: "e1", type: "move", card: "king" }), actionKey(castles[0]));
	const { state } = applyAction(s, "w", { to: "g1", card: "king", from: "e1", type: "move" });
	assert.equal(state.board.sq[sqIndex("f1")].t, "r");
});

test("a two-move turn: the same player moves twice, a different piece, then the turn passes", () => {
	const s = fresh();
	s.players.w.moves = [card("p", "t1"), card("p", "t2")];
	s.multi = { player: "w", left: 2, moved: [], differ: true };
	const pawn = s.board.sq[sqIndex("e2")].id;
	let r = applyAction(s, "w", { type: "move", card: "t1", from: "e2", to: "e3" });
	assert.equal(r.state.board.turn, "w");
	assert.deepEqual(r.state.multi.moved, [pawn]);
	assert.deepEqual(types(r.state, "w"), ["move"]);
	assert.ok(!legalActions(r.state, "w").some((a) => a.from === "e3"));
	assert.deepEqual(legalActions(r.state, "b"), []);
	r = applyAction(r.state, "w", { type: "move", card: "t2", from: "d2", to: "d4" });
	assert.equal(r.state.board.turn, "b");
	assert.equal(r.state.multi, null);
	assert.equal(r.state.board.full, 1);
});

test("a barred action is left out until the mover's turn ends", () => {
	const s = fresh(), a = first(s, "w", "move");
	s.barred = actionKey(a);
	assert.ok(!legalActions(s, "w").some((x) => actionKey(x) === s.barred));
	assert.throws(() => applyAction(s, "w", a), IllegalAction);
	assert.equal(play(s, "w", "move").barred, null);
});

test("an illegal action throws IllegalAction and leaves the input unchanged", () => {
	const s = fresh(), before = JSON.stringify(s);
	for (const a of [{ type: "move", card: "king", from: "e1", to: "e2" }, { type: "resign" }, null, { type: "discard", cards: ["king"] }]) {
		assert.throws(() => applyAction(s, "w", a), (e) => e instanceof IllegalAction && e.code === "ILLEGAL");
	}
	assert.throws(() => applyAction(s, "b", first(s, "w", "move")), IllegalAction);
	applyAction(s, "w", first(s, "w", "move"));
	applyAction(s, "w", first(s, "w", "discard"));
	assert.equal(JSON.stringify(s), before);
});

test("the player not on turn has no legal actions", () => {
	const s = fresh();
	assert.deepEqual(legalActions(s, "b"), []);
	assert.ok(legalActions(s, "w").length > 0);
	const t = play(s, "w", "move");
	assert.deepEqual(legalActions(t, "w"), []);
	assert.ok(legalActions(t, "b").length > 0);
});

test("the state stays plain JSON through play", () => {
	let s = fresh(5);
	for (let i = 0; i < 20 && !s.result; i++) {
		const c = s.board.turn, acts = legalActions(s, c);
		s = applyAction(s, c, acts[i % acts.length]).state;
		assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
	}
});

test("the automatic redraw draws back a full hand: an empty move hand gets 5, and play goes on", () => {
	// START POSITION, WHITE'S KING BOXED IN AND NO MOVE CARD: THE REDRAW MUST GIVE 5
	const s = game("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1");
	s.players.w.moves = [];
	s.players.w.refillLock = 2; // THE LOCK IS ABOUT THE END-OF-TURN REFILL ONLY
	s.players.b.moves = [card("m", "t3")];
	const { state, events } = applyAction(s, "b", { type: "move", card: "t3", from: "g8", to: "f6" });
	assert.ok(events.some((e) => e.type === "redraw" && e.player === "w"));
	assert.equal(state.players.w.moves.length, 5);
	assert.equal(state.result, null);
	assert.ok(legalActions(state, "w").some((a) => a.type === "move"));
});

test("the automatic redraw in check: a redrawn card that answers the check means no checkmate", () => {
	// Bb4+ WITH d2 EMPTY: THE KING CAN'T MOVE (d2 IS ON THE CHECK LINE), A PAWN, KNIGHT, BISHOP OR QUEEN CAN BLOCK
	const s = game("rnbqkbnr/pppp1ppp/4p3/8/8/3P4/PPP1PPPP/RNBQKBNR b KQkq - 0 2");
	s.players.w.moves = [];
	s.players.b.moves = [card("m", "t3")];
	const { state, events } = applyAction(s, "b", { type: "move", card: "t3", from: "f8", to: "b4" });
	assert.ok(inCheck(state, "w"));
	assert.ok(events.some((e) => e.type === "redraw" && e.player === "w"));
	assert.equal(state.players.w.moves.length, 5);
	assert.equal(state.result, null);
	const acts = legalActions(state, "w");
	assert.ok(acts.length > 0 && acts.every((a) => a.type === "move"));
	for (const a of acts) assert.equal(inCheck(applyAction(state, "w", a).state, "w"), false);
});

test("an active that sets state.multi starts a two-move turn", () => {
	activeOn = true;
	onPlay = (ctx, player) => { ctx.state.multi = { player, left: 2, moved: [], differ: true }; }; // SHAPED LIKE DOUBLE TIME
	try {
		const s = fresh(), active = { type: "active", card: s.players.w.actives[0].id };
		s.players.w.moves = [card("m", "t1"), card("m", "t2")];
		let r = applyAction(s, "w", active);
		assert.equal(r.state.board.turn, "w");
		assert.deepEqual(r.state.multi, { player: "w", left: 2, moved: [], differ: true });
		assert.deepEqual(types(r.state, "w"), ["move"]);
		assert.deepEqual(legalActions(r.state, "b"), []);
		const knight = r.state.board.sq[sqIndex("g1")].id;
		r = applyAction(r.state, "w", { type: "move", card: "t1", from: "g1", to: "f3" });
		assert.equal(r.state.board.turn, "w");
		assert.deepEqual(r.state.multi.moved, [knight]);
		assert.ok(legalActions(r.state, "w").length > 0);
		assert.ok(legalActions(r.state, "w").every((a) => a.type === "move" && a.from === "b1")); // NOT THE KNIGHT ALREADY MOVED
		r = applyAction(r.state, "w", { type: "move", card: "t2", from: "b1", to: "c3" });
		assert.equal(r.state.board.turn, "b");
		assert.equal(r.state.multi, null);
		// ONE KNIGHT CARD AND A BOXED KING: NO SECOND MOVE, SO THE TURN PASSES AFTER THE FIRST
		const t = fresh();
		t.players.w.moves = [card("m", "t1")];
		r = applyAction(t, "w", { type: "active", card: t.players.w.actives[0].id });
		assert.equal(r.state.board.turn, "w");
		r = applyAction(r.state, "w", { type: "move", card: "t1", from: "g1", to: "f3" });
		assert.equal(r.state.board.turn, "b");
		assert.equal(r.state.multi, null);
		assert.equal(r.state.board.history.at(-1).split(" ")[1], "b");
		assert.ok(legalActions(r.state, "b").length > 0);
		// NO MOVE AT ALL AFTER THE ACTIVE: THE TURN PASSES AT ONCE
		const u = fresh();
		u.players.w.moves = [];
		r = applyAction(u, "w", { type: "active", card: u.players.w.actives[0].id });
		assert.equal(r.state.board.turn, "b");
		assert.equal(r.state.multi, null);
	} finally { activeOn = false; onPlay = null; }
});

test("two-move turns: history holds only end-of-turn positions, half counts each move, full once per Black turn", () => {
	let s = fresh();
	s.players.w.moves = [card("m", "t1"), card("m", "t2")];
	s.multi = { player: "w", left: 2, moved: [], differ: true };
	s = applyAction(s, "w", { type: "move", card: "t1", from: "g1", to: "f3" }).state;
	assert.equal(s.board.history.length, 1); // MID-TURN: NO POSITION ADDED
	assert.equal(s.board.half, 1);
	s = applyAction(s, "w", { type: "move", card: "t2", from: "b1", to: "c3" }).state;
	assert.equal(s.board.half, 2);
	assert.equal(s.board.full, 1);
	s.players.b.moves = [card("m", "t3"), card("m", "t4")];
	s.multi = { player: "b", left: 2, moved: [], differ: true };
	s = applyAction(s, "b", { type: "move", card: "t3", from: "g8", to: "f6" }).state;
	assert.equal(s.board.full, 1);
	s = applyAction(s, "b", { type: "move", card: "t4", from: "b8", to: "c6" }).state;
	assert.equal(s.board.half, 4);
	assert.equal(s.board.full, 2);
	assert.deepEqual(s.board.history.map((k) => k.split(" ")[1]), ["w", "b", "w"]);
	assert.ok(s.board.history.at(-1).startsWith("r1bqkb1r/pppppppp/2n2n2/8/8/2N2N2/PPPPPPPP/R1BQKB1R w"));
});

test("a barred second move ends a two-move turn instead of locking it", () => {
	// KING h1 BOXED (g1 COVERED BY Ba7 ONCE THE KNIGHT LEAVES), THE ONLY SECOND MOVE IS a3-a4
	const s = game("4k3/b7/8/8/8/P5BB/6PP/6NK w - - 0 1");
	s.players.w.moves = [card("m", "t1"), card("p", "t2")];
	s.multi = { player: "w", left: 2, moved: [], differ: true };
	const second = { type: "move", card: "t2", from: "a3", to: "a4" };
	s.barred = actionKey(second);
	const r = applyAction(s, "w", { type: "move", card: "t1", from: "g1", to: "f3" });
	assert.equal(r.state.board.turn, "b");
	assert.equal(r.state.multi, null);
	assert.equal(r.state.barred, null);
	assert.ok(legalActions(r.state, "b").length > 0);
});

test("a chess stalemate with a card action left still ends by the fifty-move rule", () => {
	activeOn = true;
	try {
		const s = game("k7/8/8/8/8/8/8/2Q1K3 w - - 99 80");
		s.players.w.moves = [card("q", "t1")];
		const { state } = applyAction(s, "w", { type: "move", card: "t1", from: "c1", to: "c7" });
		assert.equal(legalMoves(state, "b").length, 0); // NO CHESS MOVE, BUT THE ACTIVE IS PLAYABLE
		assert.equal(state.board.half, 100);
		assert.deepEqual(state.result, { winner: null, reason: "fifty" });
	} finally { activeOn = false; }
});

test("promotion with a Pawn card: all four pieces offered, the card spent, a promote event", () => {
	const s = game("4k2r/P7/8/8/8/8/8/4K3 w - - 0 1"), pawn = s.board.sq[sqIndex("a7")].id;
	s.players.w.moves = [card("p", "t1")];
	const promos = legalActions(s, "w").filter((a) => a.type === "move" && a.card === "t1");
	assert.deepEqual(promos.map((a) => a.from + a.to + a.promotion).sort(), ["a7a8b", "a7a8n", "a7a8q", "a7a8r"]);
	const { state, events } = applyAction(s, "w", { type: "move", card: "t1", from: "a7", to: "a8", promotion: "n" });
	assert.deepEqual(state.board.sq[sqIndex("a8")], { c: "w", t: "n", id: pawn });
	assert.ok(!state.players.w.moves.some((c) => c.id === "t1"));
	assert.ok(events.some((e) => e.type === "promote" && e.player === "w" && e.piece === pawn && e.t === "n"));
});

test("en passant with a Pawn card", () => {
	const s = game("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1"), victim = s.board.sq[sqIndex("d5")].id;
	s.players.w.moves = [card("p", "t1")];
	const { state, events } = applyAction(s, "w", { type: "move", card: "t1", from: "e5", to: "d6" });
	assert.equal(state.board.sq[sqIndex("d5")], null);
	assert.equal(state.board.sq[sqIndex("d6")].t, "p");
	assert.deepEqual(state.players.b.captured, ["p"]);
	assert.ok(events.some((e) => e.type === "capture" && e.player === "w" && e.piece === victim));
});

test("a draw by threefold repetition through applyAction", () => {
	let s = game("r3k3/8/8/8/8/8/8/R3K3 w - - 0 1");
	const shuffle = [["w", "e1", "d1"], ["b", "e8", "d8"], ["w", "d1", "e1"], ["b", "d8", "e8"]];
	for (let i = 0; i < 8; i++) {
		assert.equal(s.result, null);
		const [c, from, to] = shuffle[i % 4];
		s = applyAction(s, c, { type: "move", card: "king", from, to }).state;
	}
	assert.deepEqual(s.result, { winner: null, reason: "repetition" });
});

test("a draw by the fifty-move rule through applyAction", () => {
	const s = game("4k3/8/8/8/8/8/8/R3K3 w - - 99 80");
	s.players.w.moves = [card("r", "t1")];
	const { state, events } = applyAction(s, "w", { type: "move", card: "t1", from: "a1", to: "a2" });
	assert.deepEqual(state.result, { winner: null, reason: "fifty" });
	assert.equal(events.at(-1).type, "game-over");
});

test("statuses tick at the end of the owner's turn", () => {
	activeOn = true;
	let pawn;
	onPlay = (ctx) => { pawn = ctx.state.board.sq[sqIndex("e7")].id; ctx.giveStatus(pawn, "shaken", 1); };
	try {
		const s = fresh();
		let r = applyAction(s, "w", { type: "active", card: s.players.w.actives[0].id }); // GIVEN ON WHITE'S TURN TO A BLACK PIECE
		assert.deepEqual(r.state.statuses[pawn], [{ s: "shaken", left: 1, by: "w" }]); // WHITE'S END OF TURN DOESN'T TICK IT
		r = applyAction(r.state, "b", first(r.state, "b", "move"));
		assert.equal(r.state.statuses[pawn], undefined); // GONE WHEN BLACK'S NEXT TURN ENDS
		assert.ok(r.events.some((e) => e.type === "status-ended" && e.piece === pawn));
	} finally { activeOn = false; onPlay = null; }
});

test("a two-move turn ends when its first move gives check", () => {
	// BLACK NOT IN CHECK BEFOREHAND; WITH differ: false THE SAME ROOK COULD OTHERWISE TAKE e8
	const s = game("4k3/8/8/8/8/8/8/R2Q1K2 w - - 0 1");
	s.players.w.moves = [card("r", "t1"), card("r", "t2")];
	s.multi = { player: "w", left: 2, moved: [], differ: false };
	assert.equal(inCheck(s, "b"), false);
	const { state, events } = applyAction(s, "w", { type: "move", card: "t1", from: "a1", to: "a8" });
	assert.ok(inCheck(state, "b"));
	assert.equal(state.board.turn, "b");
	assert.equal(state.players.b.kingSkulls, KING_SKULLS - 1); // BY RULING (05:16): IT ENDS BECAUSE BLACK SPENDS A KING SKULL
	assert.deepEqual(events.filter((e) => e.type === "king-skull"), [{ type: "king-skull", player: "b", left: KING_SKULLS - 1, why: "double-move" }]);
	assert.equal(state.multi, null);
	assert.deepEqual(legalActions(state, "w"), []);
	assert.ok(![...legalActions(state, "w"), ...legalActions(state, "b")].some((a) => a.to === "e8" && a.type === "move"));
	assert.equal(state.board.sq.filter((p) => p && p.t === "k").length, 2);
	assert.ok(legalActions(state, "b").length > 0);
	// NO CHECK ON THE FIRST MOVE: THE SECOND STILL COMES
	const t = game("4k3/8/8/8/8/8/8/R2Q1K2 w - - 0 1");
	t.players.w.moves = [card("r", "t1"), card("q", "t2")];
	t.multi = { player: "w", left: 2, moved: [], differ: true };
	const r = applyAction(t, "w", { type: "move", card: "t1", from: "a1", to: "a2" });
	assert.equal(r.state.board.turn, "w");
	assert.ok(legalActions(r.state, "w").some((a) => a.card === "t2"));
});

test("seeded playouts with a two-move active never leave a side without its king", () => {
	// PLAY THE TWO-MOVE ACTIVE WHENEVER IT'S HELD, ELSE PREFER CAPTURES (A KING CAPTURE INCLUDED), NEVER DISCARD UNLESS FORCED
	activeOn = true;
	let twoMove = 0;
	try {
		for (let seed = 1; seed <= 300; seed++) {
			onPlay = (ctx, player) => { ctx.state.multi = { player, left: 2, moved: [], differ: seed % 2 === 0 }; };
			let s = fresh(seed), x = seed;
			const rand = (n) => { x = (Math.imul(x, 1103515245) + 12345) >>> 0; return (x >>> 8) % n; }; // 32-BIT LCG, HIGH BITS
			const prefer = (acts, keep) => (acts.some(keep) ? acts.filter(keep) : acts);
			for (let ply = 0; ply < 40 && !s.result; ply++) {
				const c = s.board.turn;
				let acts = prefer(legalActions(s, c), (a) => a.type !== "discard");
				acts = prefer(prefer(acts, (a) => a.type === "active"), (a) => a.type === "move" && !!s.board.sq[sqIndex(a.to)]);
				s = applyAction(s, c, acts[rand(acts.length)]).state;
				if (s.multi && s.multi.left === 2) twoMove++;
				for (const k of ["w", "b"]) if (!s.board.sq.some((p) => p && p.c === k && p.t === "k")) assert.equal(s.result && s.result.reason, "king", `seed ${seed} ply ${ply}: ${k} has no king and the game didn't end by "king"`); // BY RULING (05:16): WITH NO SKULLS A TWO-MOVE TURN MAY TAKE A KING
			}
		}
	} finally { activeOn = false; onPlay = null; }
	assert.ok(twoMove > 1000, String(twoMove));
});

test("an early end after a double pawn push keeps the en passant square for the opponent", () => {
	// e2-e4 BESIDE THE d4 PAWN; NO SECOND MOVE (g2/h2 BLOCKED, e4 ALREADY MOVED, KING BOXED)
	const s = game("4k3/8/8/8/3p4/6BB/4P1PP/6NK w - - 0 1");
	s.players.w.moves = [card("p", "t1"), card("p", "t2")];
	s.players.b.moves = [card("p", "t3")];
	s.multi = { player: "w", left: 2, moved: [], differ: true };
	const pawn = s.board.sq[sqIndex("e2")].id;
	let r = applyAction(s, "w", { type: "move", card: "t1", from: "e2", to: "e4" });
	assert.equal(r.state.board.turn, "b");
	assert.equal(r.state.board.ep, "e3");
	assert.ok(legalActions(r.state, "b").some((a) => a.type === "move" && a.from === "d4" && a.to === "e3"));
	r = applyAction(r.state, "b", { type: "move", card: "t3", from: "d4", to: "e3" });
	assert.equal(r.state.board.sq[sqIndex("e4")], null);
	assert.ok(r.events.some((e) => e.type === "capture" && e.piece === pawn));
});

test("a turn without a move adds 1 to half and records no position", () => {
	const s = fresh();
	const r = pass(s, "w");
	assert.equal(r.board.half, 1);
	assert.equal(r.board.history.length, 1); // REPETITION COUNTS POSITIONS REACHED BY MOVES ONLY
	assert.equal(r.board.ep, null);
	// THE FIFTY-MOVE DRAW CAN ARRIVE ON A TURN WITHOUT A MOVE
	const t = game("4k3/8/8/8/8/8/8/R3K3 w - - 99 80");
	t.players.w.passive = { id: "tp", key: "test-passive" };
	const { state, events } = applyAction(t, "w", { type: "passive" });
	assert.equal(state.board.half, 100);
	assert.deepEqual(state.result, { winner: null, reason: "fifty" });
	assert.equal(events.at(-1).type, "game-over");
});

test("turns without a move from the start never draw by repetition", () => {
	let s = fresh();
	for (const c of ["w", "b", "w", "b", "w", "b"]) {
		s = pass(s, c);
		assert.equal(s.result, null);
	}
});

test("ctx.resetHalf: a turn without a move that set it ends with half 0", () => {
	activeOn = true;
	onPlay = (ctx, player) => { if (player === "w") ctx.resetHalf = true; }; // AS AN ACTIVE THAT CAPTURES OR MOVES A PAWN WOULD
	try {
		const s = fresh();
		s.board.half = 5;
		let r = applyAction(s, "w", { type: "active", card: s.players.w.actives[0].id }).state;
		assert.equal(r.board.half, 0);
		r = applyAction(r, "b", { type: "active", card: r.players.b.actives[0].id }).state;
		assert.equal(r.board.half, 1);
	} finally { activeOn = false; onPlay = null; }
});

test("ctx.resetHalf: an active that starts a two-move turn zeroes half before the moves", () => {
	activeOn = true;
	onPlay = (ctx, player) => { ctx.resetHalf = true; ctx.state.multi = { player, left: 2, moved: [], differ: true }; };
	try {
		const s = fresh();
		s.board.half = 5;
		s.players.w.moves = [card("m", "t1"), card("m", "t2")];
		let r = applyAction(s, "w", { type: "active", card: s.players.w.actives[0].id }).state;
		assert.equal(r.board.turn, "w");
		assert.equal(r.board.half, 0);
		r = applyAction(r, "w", { type: "move", card: "t1", from: "g1", to: "f3" }).state;
		assert.equal(r.board.half, 1); // A QUIET MOVE COUNTS FROM THERE
	} finally { activeOn = false; onPlay = null; }
});

test("threefold repetition by moves still counts with turns without a move in between", () => {
	let s = game("r3k3/8/8/8/8/8/8/R3K3 w - - 0 1");
	const shuffle = [["w", "e1", "d1"], ["b", "e8", "d8"], ["w", "d1", "e1"], ["b", "d8", "e8"]];
	const round = () => { for (const [c, from, to] of shuffle) { assert.equal(s.result, null); s = applyAction(s, c, { type: "move", card: "king", from, to }).state; } };
	round(); // THE START POSITION A SECOND TIME
	s = pass(s, "w");
	s = pass(s, "b"); // SAME BOARD, SAME SIDE TO MOVE, NOTHING RECORDED
	assert.equal(s.result, null);
	round(); // AND A THIRD
	assert.deepEqual(s.result, { winner: null, reason: "repetition" });
});

// TEST-ONLY ENCHANTMENT: AN ENEMY PIECE THAT LANDS ON a3 IS REMOVED (A TRAP WITH NO GUARDS); IN CARDS ONLY, SO IT IS NEVER DRAWN
require("../../cards-engine/cards/index.js").CARDS["test-pit"] = { key: "test-pit", kind: "active",
	on: { move: (ctx, owner, ev) => { const p = ctx.state.board.sq[sqIndex("a3")]; return ev.to === "a3" && !!p && p.c !== owner && ctx.capture(owner, p.id); } } };

test("a check a trigger leaves on the mover (a shield removed) is announced once, at the next turn start", () => {
	const s = game("k7/8/8/8/8/7r/8/R3K3 b - - 0 1");
	s.enchant.push({ id: "e900", key: "test-pit", owner: "w", pieces: [], left: null, data: {} });
	s.players.b.moves = [card("r", "c95")];
	const { state, events } = applyAction(s, "b", { type: "move", card: "c95", from: "h3", to: "a3" });
	assert.equal(state.board.sq[sqIndex("a3")], null);
	assert.ok(inCheck(state, "b"));
	assert.deepEqual(events.filter((e) => e.type === "check"), [{ type: "check", player: "b" }]);
});

test("a check made by a status ending (Shaken) is announced once to the side to move; a chess check still gives exactly one", () => {
	const s = game("k7/8/8/8/8/8/Q7/4K3 w - - 0 1"), q = s.board.sq[sqIndex("a2")].id;
	s.statuses[q] = [{ s: "shaken", left: 1, by: "b" }];
	assert.equal(inCheck(s, "b"), false);
	const { state, events } = applyAction(s, "w", { type: "move", card: "king", from: "e1", to: "d1" });
	assert.ok(inCheck(state, "b"));
	assert.deepEqual(events.filter((e) => e.type === "check"), [{ type: "check", player: "b" }]);
	const m = game("k7/8/8/8/8/8/8/1Q2K3 w - - 0 1");
	m.players.w.moves = [card("q", "c96")];
	assert.equal(applyAction(m, "w", { type: "move", card: "c96", from: "b1", to: "a1" }).events.filter((e) => e.type === "check").length, 1);
});

test("a check that stood, was lifted, and comes back before the turn passes is announced (a Shaken checker's status ends on a lost turn)", () => {
	const s = game("k4r2/8/8/8/1b6/8/8/4K3 w - - 0 1");
	s.players.b.lostTurns = 1;
	s.statuses[s.board.sq[sqIndex("f8")].id] = [{ s: "shaken", left: 1, by: "w" }];
	assert.ok(inCheck(s, "w"));
	const { state, events } = applyAction(s, "w", { type: "move", card: "king", from: "e1", to: "f1" });
	assert.deepEqual([state.board.turn, inCheck(state, "w")], ["w", true]);
	assert.deepEqual(events.filter((e) => e.type === "check"), [{ type: "check", player: "w" }]);
});

test("a Frozen pawn gives no check, so a king may stand in its reach; when the Frozen ends (the end of its owner's turn) the king is in check at its own turn start, and with no answer that is checkmate", () => {
	const E = require("../../cards-engine/index.js"), { inCheck: checked } = require("../../cards-engine/rules.js");
	const from = (fen) => { // WHITE HOLDS ONE ROOK CARD, NO OTHER CARD IN PLAY; THE e6 PAWN IS FROZEN FOR ONE MORE TURN
		const s = E.newGame({ cardGuy: "b", level: 1300, seed: 1 });
		s.board = E.board.fromFen(fen);
		for (const c of ["w", "b"]) Object.assign(s.players[c], { actives: [], passive: null, curses: [] });
		s.players.w.moves = [require("../../cards-engine/hand.js").newCard(s, "move", { piece: "r" })];
		s.statuses[s.board.sq[E.board.sqIndex("e6")].id] = [{ s: "frozen", left: 1, by: "b" }];
		return s;
	};
	const wait = (s) => E.applyAction(s, "w", E.legalActions(s, "w").find((a) => a.type === "move" && a.from === "h1" && a.to === "h2"));
	const types = (r) => r.events.map((e) => e.type + ":" + (e.player || "")).filter((t) => /^(status-ended|turn-start|check|game-over)/.test(t));
	const open = from("8/3k4/4P3/8/8/8/8/4K2R w - - 0 1");
	assert.equal(checked(open, "b"), false); // FROZEN: NO CHECK ON d7
	const r = wait(open);
	assert.deepEqual(types(r), ["status-ended:w", "turn-start:b", "check:b"]);
	assert.equal(r.state.result, null);
	assert.ok(checked(r.state, "b"));
	assert.ok(E.legalActions(r.state, "b").some((a) => a.type === "move")); // IT MUST, AND CAN, ANSWER
	const mate = wait(from("2nbn3/2pkp3/4P3/3P4/5B2/8/8/4K2R w - - 0 1")); // NO SQUARE, NO CAPTURE OF THE PAWN (d5 GUARDS IT)
	assert.deepEqual(types(mate), ["status-ended:w", "turn-start:b", "check:b", "game-over:w"]);
	assert.deepEqual(mate.state.result, { winner: "w", reason: "checkmate" });
});

test("under a refill lock a discarded active waits it out: none back at the end of this turn, one at the end of the next (user ruling R4)", () => {
	const s = fresh(), id = s.players.w.actives[0].id;
	s.players.w.refillLock = 1;
	let r = play(applyAction(s, "w", { type: "discard", cards: [id] }).state, "w", "move");
	assert.deepEqual([r.players.w.actives.length, r.players.w.moves.length, r.players.w.refillLock], [0, 4, 0]); // THE LOCK HELD THE WHOLE REFILL
	r = play(play(r, "b", "move"), "w", "move");
	assert.deepEqual([r.players.w.actives.length, r.players.w.moves.length], [1, 5]);
});

test("drawMove: a queen on the board counts double (user ruling 2026-11-22), and pawns count as 6 at most, so at the start a Queen card is 2 in 14 and a Pawn card 6 in 14", () => {
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
// The Knight / Bishop card (Task 20c, user ruling 2026-11-22)
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
