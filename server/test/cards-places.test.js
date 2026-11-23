/*
 *  cards-places.test.js  --  chess cards engine tests
 *	Task 20e B1: the free discard one move card at a time, the discard pile, the active spot, at most 3 waiting passives, dropping a placed card, and what the view shows of them.
 *
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { newGame, legalActions, applyAction, IllegalAction, playerView, playerLegal, playerEvents, fromView } = require("../../cards-engine/index.js");
const { fromFen, sqIndex } = require("../../cards-engine/board.js");
const { inCheck } = require("../../cards-engine/rules.js");
const { makeCtx } = require("../../cards-engine/ctx.js");
const hand = require("../../cards-engine/hand.js");
const { register, reset } = require("../../cards-engine/cards/index.js");

reset(); // THE ENGINE ENTRY REGISTERS EVERY CARD: THESE TESTS DRAW FROM ONLY THE CARDS THEY REGISTER

let onPlay = null;
register({ key: "t-act", kind: "active", name: "t-act", rarity: "common", text: "", targets: () => [null], play: (ctx, player) => onPlay && onPlay(ctx, player) });
register(require("../../cards-engine/cards/active/stronghold.js")); // A REAL LASTING ACTIVE: ITS ENCHANTMENT STAYS UNTIL IT IS ENDED
for (const k of ["a", "b", "c", "d", "e"]) register({ key: "t-pas-" + k, kind: "passive", name: k, rarity: "common", text: "" });

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const card = (piece, id) => ({ id, key: "move", piece });
const id = (s, sq) => s.board.sq[sqIndex(sq)].id;
const of = (s, c, type) => legalActions(s, c).filter((a) => a.type === type);
const act = (s, c, a) => applyAction(s, c, a);
const D = (cid) => ({ type: "discard", cards: [cid] });
const placed = (cid, key, owner = "w", placedAt = 0) => ({ id: cid, owner, card: { id: cid, key }, placedAt });

/**
 * @description A game on fen: White holds Pawn cards t1..t5 and the active t-act as t9, Black Pawn cards u1..u5; no passives.
 */
function game(fen = START) {
	const s = newGame({ cardGuy: "b", level: 1300, seed: 1 });
	s.board = fromFen(fen);
	Object.assign(s.players.w, { moves: [1, 2, 3, 4, 5].map((n) => card("p", "t" + n)), actives: [{ id: "t9", key: "t-act" }], passive: null });
	Object.assign(s.players.b, { moves: [1, 2, 3, 4, 5].map((n) => card("p", "u" + n)), actives: [], passive: null });
	return s;
}
const pawnMove = (s, c, cid) => of(s, c, "move").find((a) => a.card === cid);

/* ---------------------------------------------------------------- */
// The free discard, one move card at a time (Idea 5)
/* ---------------------------------------------------------------- */
test("a new game has the places empty", () => {
	const s = newGame({ cardGuy: "b", level: 1300, seed: 1 });
	for (const c of ["w", "b"]) assert.deepEqual([s.players[c].kept, s.players[c].pile, s.players[c].spot, s.players[c].gone], [null, { n: 0, top: null }, [], []]);
});

test("the free discard lists each move card alone in hand order, then each active", () => {
	assert.deepEqual(of(game(), "w", "discard"), ["t1", "t2", "t3", "t4", "t5", "t9"].map(D));
});

test("the first move card discarded is remembered and draws nothing; the second draws 1 at once and both lie on the pile", () => {
	const one = act(game(), "w", D("t2"));
	assert.deepEqual(one.events, [{ type: "discard", player: "w", card: card("p", "t2"), kept: true }]);
	assert.deepEqual(one.state.players.w.kept, card("p", "t2"));
	assert.deepEqual([one.state.players.w.moves.length, one.state.players.w.pile.n], [4, 0]);
	assert.deepEqual(one.state.discarded, { player: "w", kind: "move", n: 1 });
	assert.deepEqual([one.state.board.turn, one.state.ply], ["w", 0]);
	const two = act(one.state, "w", D("t4")), p = two.state.players.w;
	assert.deepEqual(two.events.map((e) => e.type), ["discard", "draw"]);
	assert.ok(!("kept" in two.events[0]));
	assert.equal(p.kept, null);
	assert.deepEqual(p.pile, { n: 2, top: { ...card("p", "t4"), down: true } });
	assert.equal(p.moves.length, 4); // 5 - 2 + 1
	assert.deepEqual(two.state.discarded, { player: "w", kind: "move", n: 2 });
});

test("at most 2 move cards a turn, and one kind a turn", () => {
	const one = act(game(), "w", D("t1")).state;
	assert.deepEqual(of(one, "w", "discard"), ["t2", "t3", "t4", "t5"].map(D)); // A MOVE CARD WENT: NO ACTIVE
	assert.throws(() => act(one, "w", D("t9")), IllegalAction);
	const two = act(one, "w", D("t2")).state;
	assert.deepEqual(of(two, "w", "discard"), []);
	const active = act(game(), "w", D("t9")).state;
	assert.deepEqual(active.discarded, { player: "w", kind: "active", n: 1 });
	assert.deepEqual(of(active, "w", "discard"), []); // AN ACTIVE WENT: NO MOVE CARD
});

test("a passive reroll is the turn's kind too, and the old passive can't be the one drawn that turn", () => {
	const s = game();
	s.players.w.passive = { id: "t7", key: "t-pas-a" };
	const { state } = act(s, "w", D("t7")), p = state.players.w;
	assert.deepEqual(state.discarded, { player: "w", kind: "passive", n: 1 });
	assert.deepEqual(of(state, "w", "discard"), []);
	assert.deepEqual(p.gone, ["t-pas-a"]);
	assert.deepEqual(p.pile, { n: 1, top: { id: "t7", key: "t-pas-a", down: true } });
	assert.ok(!hand.drawable(state, "w", "passive").includes("t-pas-a"));
});

test("the remembered card lasts over turns and doesn't block an active discard on a later turn; its pair draws at once and a second card that turn is remembered again", () => {
	let s = act(game(), "w", D("t1")).state;
	s = act(s, "w", pawnMove(s, "w", "t2")).state;
	s = act(s, "b", pawnMove(s, "b", "u1")).state;
	assert.deepEqual(s.players.w.kept, card("p", "t1"));
	assert.equal(s.discarded, null);
	assert.ok(of(s, "w", "discard").some((a) => a.cards[0] === "t9")); // THE ACTIVE: THE REMEMBERED CARD IS NO DISCARD OF THIS TURN
	const next = hand.moveCards(s.players.w).map((c) => c.id);
	const pair = act(s, "w", D(next[0]));
	assert.deepEqual(pair.events.map((e) => e.type), ["discard", "draw"]);
	assert.equal(pair.state.players.w.kept, null);
	assert.deepEqual(pair.state.discarded, { player: "w", kind: "move", n: 1 });
	const again = act(pair.state, "w", D(next[1]));
	assert.deepEqual(again.events.map((e) => e.type), ["discard"]);
	assert.equal(again.state.players.w.kept.id, next[1]);
	assert.deepEqual(of(again.state, "w", "discard"), []);
});

test("nothing clears the remembered card: not a Mulligan's throw-out, not a lost duel's whole hand", () => {
	const s = act(game(), "w", D("t1")).state, ctx = makeCtx(s);
	hand.throwMoves(s, "w");
	hand.discardRandom(ctx, "w");
	assert.deepEqual(s.players.w.kept, card("p", "t1"));
	assert.deepEqual([s.players.w.moves, s.players.w.actives], [[], []]);
});

test("an entered Mirage discarded first is remembered as the move card it showed, and its curse is gone", () => {
	const s = game();
	s.players.w.curses = [{ id: "t6", key: "mirage", piece: "r" }];
	const { state } = act(s, "w", D("t6"));
	assert.deepEqual([state.players.w.kept, state.players.w.curses], [card("r", "t6"), []]);
});

test("no free discard in check, with a card remembered or not", () => {
	const s = game("4k3/8/8/8/8/8/4r3/4K3 w - - 0 1");
	s.players.w.kept = card("p", "t0");
	assert.ok(inCheck(s, "w"));
	assert.deepEqual(of(s, "w", "discard"), []);
});

test("a saved game from before these fields plays on: no remembered card, an empty pile, and a used free discard stays used", () => {
	const s = game();
	for (const c of ["w", "b"]) for (const k of ["kept", "pile", "spot", "gone"]) delete s.players[c][k];
	const used = JSON.parse(JSON.stringify(s));
	used.discarded = "w"; // THE OLD MARK: THE COLOUR ALONE
	assert.deepEqual(of(used, "w", "discard"), []);
	assert.equal(of(s, "w", "discard").length, 6);
	const v = playerView(s, "w");
	assert.deepEqual([v.players.b.kept, v.players.b.pile, v.players.b.spot], [null, { n: 0, top: null }, []]);
	let t = act(s, "w", D("t1")).state;
	t = act(t, "w", pawnMove(t, "w", "t2")).state;
	assert.deepEqual(t.players.w.pile, { n: 1, top: card("p", "t2") });
	assert.ok(legalActions(fromView(playerView(t, "b"), 5), "b").length);
});

/* ---------------------------------------------------------------- */
// The discard pile and the active spot (Idea 4)
/* ---------------------------------------------------------------- */
test("the turn's free discard reaches the other player as its player and count, never its kind (a reroll would tell a passive was held)", () => {
	const s = game();
	s.players.w.passive = { id: "t7", key: "t-pas-a" };
	const { state } = act(s, "w", D("t7"));
	assert.deepEqual(state.discarded, { player: "w", kind: "passive", n: 1 });
	assert.deepEqual(playerView(state, "w").discarded, state.discarded);
	assert.deepEqual(playerView(state, "b").discarded, { player: "w", n: 1 });
});

test("a move card played lies face up on its player's pile; under that player's Fog of War it lies face down", () => {
	const s = game();
	assert.deepEqual(act(s, "w", pawnMove(s, "w", "t3")).state.players.w.pile, { n: 1, top: card("p", "t3") });
	s.enchant.push({ id: "e1", key: "fog-of-war", owner: "w", pieces: [], left: 3, data: {} });
	assert.deepEqual(act(s, "w", pawnMove(s, "w", "t3")).state.players.w.pile, { n: 1, top: { ...card("p", "t3"), down: true } });
});

test("a passive that fires goes to its owner's pile, without its bookkeeping; the King card never does", () => {
	const s = game(), ctx = makeCtx(s);
	s.effects.push({ id: "t7", owner: "b", card: { id: "t7", key: "t-pas-a", denied: ["w3"], stopping: "w4" }, placedAt: 0 });
	ctx.passiveFired(s.effects[0]);
	assert.deepEqual(s.players.b.pile, { n: 1, top: { id: "t7", key: "t-pas-a" } });
	hand.toPile(s, "b", { id: "king", key: "king", faceUp: true });
	assert.equal(s.players.b.pile.n, 1);
	assert.deepEqual(s.piled, [{ player: "b", card: { id: "t7", key: "t-pas-a" } }]); // THE LIST TOO: NO BOOKKEEPING, NO KING CARD
});

test("the automatic redraw's thrown-out cards go to the pile face down, a Mirage among them as the move card it shows", () => {
	const s = game(), p = s.players.w;
	p.curses = [{ id: "t6", key: "mirage", piece: "r" }];
	hand.throwMoves(s, "w");
	assert.deepEqual(p.pile, { n: 6, top: { id: "t6", key: "move", piece: "r", down: true } });
	assert.deepEqual(s.piled[0], { player: "w", card: { id: "t6", key: "move", piece: "r", down: true } }); // THE LIST NAMES NO CURSE EITHER
});

test("an active with no lasting effect lies on the active spot until the end of the turn it was played in, then on the pile", () => {
	onPlay = (ctx, player) => { ctx.state.multi = { player, left: 1, moved: [], differ: false }; }; // THE TURN GOES ON: ONE MOVE
	try {
		const mid = act(game(), "w", { type: "active", card: "t9" }).state;
		assert.deepEqual([mid.board.turn, mid.players.w.spot, mid.players.w.pile.n], ["w", [{ id: "t9", key: "t-act" }], 0]);
		const done = act(mid, "w", pawnMove(mid, "w", "t1"));
		assert.deepEqual(done.state.players.w.spot, []);
		assert.deepEqual(done.state.players.w.pile, { n: 2, top: { id: "t9", key: "t-act" } }); // THE MOVE CARD, THEN THE ACTIVE
		assert.deepEqual(done.events.filter((e) => e.type === "card-ended"), [{ type: "card-ended", player: "w", card: { id: "t9", key: "t-act" } }]);
	} finally { onPlay = null; }
});

/**
 * @description White has played Stronghold (card t8) on its d1 rook; it is White's turn again.
 */
function stronghold(fen = "4k3/8/8/8/8/8/P7/3RK3 w - - 0 1") {
	const s = game(fen);
	s.players.w.actives = [{ id: "t8", key: "stronghold" }];
	let t = act(s, "w", of(s, "w", "active").find((a) => a.target.piece === id(s, "d1"))).state;
	t = act(t, "b", of(t, "b", "move").find((a) => a.to === "f8")).state; // OFF THE ROOK'S FILE
	return t;
}

test("a lasting active stays on the active spot while its enchantment lasts, and goes to the pile when it ends", () => {
	const s = stronghold(), ctx = makeCtx(s);
	assert.deepEqual(s.players.w.spot, [{ id: "t8", key: "stronghold" }]);
	assert.equal(s.players.w.pile.n, 0);
	ctx.endEnchant(s.enchant[0]);
	const { state } = act(s, "w", of(s, "w", "move")[0]);
	assert.deepEqual(state.players.w.spot, []);
	assert.equal(state.players.w.pile.top.id, "t8");
});

/* ---------------------------------------------------------------- */
// At most 3 waiting passives; dropping a placed card
/* ---------------------------------------------------------------- */
const waiting = (n) => { const s = game(); for (let i = 0; i < n; i++) s.effects.push(placed("p" + i, "t-pas-" + "abcd"[i], "w", i)); s.players.w.passive = { id: "t7", key: "t-pas-e" }; return s; };

test("a fourth passive placed replaces the oldest, which goes to the pile and isn't used", () => {
	const { state, events } = act(waiting(3), "w", { type: "passive" });
	assert.deepEqual(state.effects.map((e) => e.id), ["p1", "p2", "t7"]);
	assert.deepEqual(events.slice(0, 2), [{ type: "card-dropped", player: "w", card: { id: "p0", key: "t-pas-a" }, replaced: true }, { type: "passive-placed", player: "w", card: { id: "t7", key: "t-pas-e" } }]);
	assert.deepEqual([state.players.w.pile, state.players.w.used], [{ n: 1, top: { id: "p0", key: "t-pas-a" } }, []]);
	assert.equal(act(waiting(2), "w", { type: "passive" }).state.effects.length, 3);
});

test("a game with more than 3 waiting keeps them: the next one placed replaces the oldest, one for one", () => {
	assert.deepEqual(act(waiting(4), "w", { type: "passive" }).state.effects.map((e) => e.id), ["p1", "p2", "p3", "t7"]);
});

test("the opponent's waiting passives don't count toward the 3", () => {
	const s = waiting(3);
	for (const e of s.effects) e.owner = "b";
	assert.equal(act(s, "w", { type: "passive" }).state.effects.length, 4);
});

test("a drop is listed for each of the player's own waiting passives and lasting actives, never for the opponent's, a curse or an active that only waits for the turn's end", () => {
	const s = stronghold();
	s.effects.push(placed("p1", "t-pas-a"), placed("p2", "t-pas-b", "b"));
	s.players.w.curses = [{ id: "t6", key: "t-curse" }];
	s.players.w.spot.push({ id: "t5x", key: "t-act" });
	assert.deepEqual(of(s, "w", "drop"), [{ type: "drop", card: "p1" }, { type: "drop", card: "t8" }]);
	assert.deepEqual(of(s, "b", "drop"), []);
	assert.throws(() => act(s, "w", { type: "drop", card: "p2" }), IllegalAction);
});

test("dropping a waiting passive: it goes to the pile, the turn and the free discard stay, nothing is drawn, it isn't used and can't be drawn that turn", () => {
	const s = game();
	s.effects.push(placed("p1", "t-pas-a"));
	const { state, events } = act(s, "w", { type: "drop", card: "p1" }), p = state.players.w;
	assert.deepEqual(events, [{ type: "card-dropped", player: "w", card: { id: "p1", key: "t-pas-a" } }]);
	assert.deepEqual([state.effects, p.pile, p.used, p.gone], [[], { n: 1, top: { id: "p1", key: "t-pas-a" } }, [], ["t-pas-a"]]);
	assert.deepEqual([state.board.turn, state.ply, state.discarded], ["w", 0, null]);
	assert.equal(of(state, "w", "discard").length, 6);
	assert.ok(!hand.drawable(state, "w", "passive").includes("t-pas-a"));
	const next = act(state, "w", pawnMove(state, "w", "t1")).state;
	assert.deepEqual(next.players.w.gone, []);
	assert.ok(hand.drawable(next, "w", "passive").includes("t-pas-a")); // A LATER TURN CAN DRAW IT AGAIN
});

test("dropping a lasting active ends its effect: the enchantment ends, the card goes to the pile, the turn stays", () => {
	const s = stronghold(), rook = id(s, "d1");
	const { state, events } = act(s, "w", { type: "drop", card: "t8" });
	assert.deepEqual(events.map((e) => e.type), ["card-dropped", "enchant-ended", "status-ended"]);
	assert.deepEqual([state.enchant, state.players.w.spot, state.statuses[rook]], [[], [], undefined]);
	assert.deepEqual(state.players.w.pile, { n: 1, top: { id: "t8", key: "stronghold" } });
	assert.equal(state.board.turn, "w");
	assert.deepEqual(of(state, "w", "drop"), []);
});

test("drops are listed in check and after a free discard, any number a turn; not in a two-move turn, not while a choice is open, not on the other player's turn", () => {
	const s = game("4k3/8/8/8/8/8/4r3/4K3 w - - 0 1");
	s.effects.push(placed("p1", "t-pas-a"), placed("p2", "t-pas-b"));
	assert.ok(inCheck(s, "w"));
	assert.equal(of(s, "w", "drop").length, 2);
	const t = game();
	t.effects.push(placed("p1", "t-pas-a"), placed("p2", "t-pas-b"), placed("p3", "t-pas-c", "b"));
	let u = act(t, "w", D("t1")).state;
	u = act(u, "w", { type: "drop", card: "p1" }).state;
	u = act(u, "w", { type: "drop", card: "p2" }).state;
	assert.deepEqual([u.effects.map((e) => e.id), u.players.w.pile.n, u.board.turn], [["p3"], 2, "w"]);
	assert.deepEqual(of(t, "b", "drop"), []);
	t.multi = { player: "w", left: 2, moved: [], differ: true };
	assert.deepEqual(of(t, "w", "drop"), []);
	t.multi = null;
	t.pending = { card: "t-act", player: "w", kind: "x", options: ["a"], turn: "w" };
	assert.deepEqual(of(t, "w", "drop"), []);
});

test("a drop that would put a king in check is not offered: the Stronghold rook facing the enemy king", () => {
	const s = stronghold(), sq = s.board.sq, k = sq.findIndex((p) => p && p.c === "b" && p.t === "k");
	sq[sqIndex("d8")] = sq[k]; // THE BLACK KING ONTO THE ROOK'S OPEN FILE
	if (k !== sqIndex("d8")) sq[k] = null;
	assert.ok(!inCheck(s, "b")); // A STRONGHOLD PIECE GIVES NO CHECK
	assert.deepEqual(of(s, "w", "drop"), []);
});

/**
 * @description The Stronghold position with Black's Fog of War up (when fog) and Black's king, hidden from White on rank 8, on sq.
 */
function strongholdKing(sq, fog = true) {
	const s = stronghold(), b = s.board.sq, k = b.findIndex((p) => p && p.c === "b" && p.t === "k");
	if (k !== sqIndex(sq)) { b[sqIndex(sq)] = b[k]; b[k] = null; }
	if (fog) s.enchant.push({ id: "fog", key: "fog-of-war", owner: "b", pieces: [], left: 40, data: {} });
	return s;
}

test("under the other player's Fog of War the drops a player is told don't depend on a hidden piece: the game refuses the one that would give check (final review F-I1, ruling 2026-11-22)", () => {
	const off = strongholdKing("f8"), on = strongholdKing("d8"), told = (s) => playerLegal(s, "w").filter((a) => a.type === "drop");
	assert.deepEqual(playerView(on, "w").board.sq, playerView(off, "w").board.sq); // WHITE SEES THE SAME BOARD: THE KING IS HIDDEN ON BOTH SQUARES
	assert.deepEqual(told(off), [{ type: "drop", card: "t8" }]);
	assert.deepEqual(told(on), told(off));
	assert.deepEqual(of(on, "w", "drop"), []); // THE TRUE LIST KEEPS RULE R4: STALEMATE, CHECKMATE AND applyAction READ IT
	const before = JSON.stringify(on);
	assert.throws(() => act(on, "w", { type: "drop", card: "t8" }), IllegalAction);
	assert.equal(JSON.stringify(on), before); // REFUSED AS A BLIND MOVE IS: NOTHING CHANGED
	assert.doesNotThrow(() => act(off, "w", { type: "drop", card: "t8" }));
});

test("with no Fog of War a drop that would give check is still not told", () => {
	const s = strongholdKing("d8", false);
	assert.deepEqual(playerLegal(s, "w").filter((a) => a.type === "drop"), []);
	assert.deepEqual(playerLegal(s, "w"), legalActions(s, "w"));
	const own = strongholdKing("d8", false);
	own.enchant.push({ id: "fog", key: "fog-of-war", owner: "w", pieces: [], left: 40, data: {} }); // THE PLAYER'S OWN FOG HIDES NOTHING FROM THEM
	assert.deepEqual(playerLegal(own, "w").filter((a) => a.type === "drop"), []);
});

test("a turn with only drops left redraws: a drop is no card action", () => {
	const s = game("k7/8/8/8/8/8/PP6/KB6 w - - 0 1"); // KING BOXED IN BY ITS OWN HEXED PIECES
	for (const sq of ["a2", "b2", "b1"]) s.statuses[id(s, sq)] = [{ s: "hexed", left: 2, by: "b" }];
	s.players.w.actives = [];
	s.effects.push(placed("p1", "t-pas-a"), placed("p2", "t-pas-b"));
	const { state, events } = act(s, "w", { type: "drop", card: "p1" });
	assert.ok(events.some((e) => e.type === "redraw"));
	assert.deepEqual(state.result, { winner: null, reason: "stalemate" });
});

/**
 * @description White: king a1 boxed in by the b3 queen, a rook under its own Stronghold (card t8) on rookSq, Rook cards in hand. Black has made the move to: it is White's turn again. Returns applyAction's answer to that move.
 */
function boxed(fen, rookSq, to) {
	const s = game(fen);
	Object.assign(s.players.w, { moves: [1, 2, 3].map((n) => card("r", "t" + n)), actives: [{ id: "t8", key: "stronghold-common" }] }); // THE COMMON ONE: THE PIECE CAN'T MOVE
	s.players.b.moves = [card("r", "u1"), card("r", "u2")];
	const t = act(s, "w", of(s, "w", "active").find((a) => a.target.piece === id(s, rookSq))).state;
	t.players.w.actives = []; // THE REFILL'S NEW ACTIVE WOULD BE A CARD ACTION
	return act(t, "b", of(t, "b", "move").find((a) => a.to === to));
}

test("no stalemate while a drop would open a move: the Stronghold on the only mobile piece (fix round 1, I1)", () => {
	const { state } = boxed("6k1/8/8/8/8/1q6/8/K6R w - - 0 1", "h1", "g7");
	assert.ok(!inCheck(state, "w"));
	assert.equal(state.result, null);
	assert.deepEqual(of(state, "w", "move"), []);
	assert.deepEqual(of(state, "w", "drop"), [{ type: "drop", card: "t8" }]);
	const after = act(state, "w", { type: "drop", card: "t8" }).state;
	assert.deepEqual([after.result, after.board.turn], [null, "w"]);
	assert.ok(of(after, "w", "move").length > 0);
});

test("no checkmate by the cards while a drop would open the answer; a drop that opens nothing still ends the game (fix round 1, I1)", () => {
	const { state } = boxed("4r1k1/8/8/8/8/1q6/8/K6R w - - 0 1", "h1", "e1"); // Re1+: ONLY THE STRONGHOLD ROOK CAN TAKE IT
	assert.ok(inCheck(state, "w"));
	assert.equal(state.result, null);
	const after = act(state, "w", { type: "drop", card: "t8" }).state;
	assert.equal(after.result, null);
	assert.ok(of(after, "w", "move").some((a) => a.from === "h1" && a.to === "e1"));
	const mate = boxed("4r1k1/8/8/7R/8/1q6/8/K7 w - - 0 1", "h5", "e1").state; // THE ROOK ON h5 CAN'T REACH: ITS DROP OPENS NOTHING
	assert.deepEqual(mate.result, { winner: "b", reason: "checkmate" });
});

test("a placed card that does nothing buys no second redraw: the game ends as it would without the card (user ruling R-2, 2026-11-23)", () => {
	// WHITE: KING BOXED, SEVEN BLOCKED PAWNS, ONE FREE ROOK; ONLY A ROOK CARD IN THE REDRAW GIVES A MOVE
	const run = (seed, extra) => {
		const s = newGame({ cardGuy: "b", level: 1300, seed });
		s.board = fromFen("7k/8/8/8/2p1p1p1/p1PpPpPp/P1pP1P1P/K6R w - - 0 20");
		Object.assign(s.players.w, { moves: [1, 2, 3, 4, 5].map((n) => card("p", "t" + n)), actives: [], passive: null });
		Object.assign(s.players.b, { moves: [1, 2, 3, 4, 5].map((n) => card("p", "u" + n)), actives: [], passive: null });
		if (extra) s.effects.push(placed("x1", "t-pas-a"));
		return act(s, "w", D("t1")).state.result; // NO CARD ACTION AFTER THE DISCARD: THE REDRAW RUNS
	};
	let stale = 0;
	for (let seed = 1; seed <= 120; seed++) {
		const bare = run(seed, false);
		if (bare) stale++;
		assert.deepEqual(run(seed, true), bare, "seed " + seed);
	}
	assert.ok(stale >= 5, "only " + stale + " of 120 redraws found no Rook card");
});

test("placed cards can be dropped after a Mulligan, before the one move it leaves; not in another two-move turn (fix round 1, R5)", () => {
	const t = game();
	t.effects.push(placed("p1", "t-pas-a"));
	t.multi = { player: "w", left: 1, moved: [], mulled: true };
	assert.deepEqual(of(t, "w", "drop"), [{ type: "drop", card: "p1" }]);
	const { state } = act(t, "w", { type: "drop", card: "p1" });
	assert.deepEqual([state.effects, state.board.turn, state.multi], [[], "w", t.multi]);
	t.multi = { player: "w", left: 2, moved: [], differ: true };
	assert.deepEqual(of(t, "w", "drop"), []);
});

/* ---------------------------------------------------------------- */
// The view
/* ---------------------------------------------------------------- */
test("the view shows the other player's pile count, a face-down top and a face-down remembered card, never the cards; the owner sees both", () => {
	let s = act(game(), "w", D("t1")).state;
	const one = playerView(s, "b").players.w;
	assert.deepEqual([one.kept, one.pile, one.spot], [{ down: true }, { n: 0, top: null }, []]);
	assert.ok(!("gone" in one));
	s = act(s, "w", D("t2")).state;
	const b = playerView(s, "b"), w = playerView(s, "w");
	assert.deepEqual([b.players.w.kept, b.players.w.pile], [null, { n: 2, top: { down: true } }]);
	assert.ok(!JSON.stringify(b).includes("\"t2\"") && !JSON.stringify(b).includes("\"t1\""));
	assert.deepEqual(w.players.w.pile, { n: 2, top: card("p", "t2") }); // THE OWNER: THE CARD, WITHOUT THE MARK
	assert.deepEqual(w.discarded, { player: "w", kind: "move", n: 2 });
	const ev = playerEvents(s, [{ type: "discard", player: "w", card: card("p", "t1"), kept: true }], "b");
	assert.deepEqual(ev, [{ type: "discard", player: "w" }]);
});

test("the view shows both players the public cards: a played move card on the pile, the active spot, a dropped passive", () => {
	const s = stronghold();
	s.effects.push(placed("p1", "t-pas-a"));
	const { state } = act(s, "w", { type: "drop", card: "p1" }), b = playerView(state, "b");
	assert.deepEqual(b.players.w.spot, [{ id: "t8", key: "stronghold" }]);
	assert.deepEqual(b.players.w.pile, { n: 1, top: { id: "p1", key: "t-pas-a" } });
	assert.deepEqual(playerView(state, "w").players.b.pile, { n: 0, top: null }); // BLACK MOVED ITS KING: THE KING CARD IS NO PLAYED CARD
});

test("a finished game shows the face-down top and the remembered card", () => {
	let s = act(game(), "w", D("t1")).state;
	s = act(s, "w", D("t2")).state;
	s = act(s, "w", pawnMove(s, "w", "t3")).state;
	s.players.w.kept = card("p", "t5");
	s.players.w.pile.top = { ...card("p", "t4"), down: true };
	s.result = { winner: "b", reason: "checkmate" };
	const o = playerView(s, "b").players.w;
	assert.deepEqual([o.kept, o.pile.top], [card("p", "t5"), card("p", "t4")]);
});

/* ---------------------------------------------------------------- */
// The last 6 cards to join a discard pile, both players' in one list (Task 21a A)
/* ---------------------------------------------------------------- */
const P = (player, c) => ({ player, card: c });
const down = (c) => ({ ...c, down: true });

/**
 * @description White's free discard of two move cards (both to the pile face down), then plays by both players, one after the other
 */
function sevenToPiles() {
	let s = act(game(), "w", D("t1")).state; // REMEMBERED: NOT ON THE PILE YET
	s = act(s, "w", D("t2")).state; // t1 THEN t2, FACE DOWN
	for (const [c, cid] of [["w", "t3"], ["b", "u1"], ["w", "t4"], ["b", "u2"]]) s = act(s, c, pawnMove(s, c, cid)).state;
	return s;
}

test("the list: every card that joins either discard pile, newest first, as the pile keeps it with its down mark, at most 6", () => {
	const s = sevenToPiles();
	assert.deepEqual(s.piled, [P("b", card("p", "u2")), P("w", card("p", "t4")), P("b", card("p", "u1")), P("w", card("p", "t3")), P("w", down(card("p", "t2"))), P("w", down(card("p", "t1")))]);
	const t = act(s, "w", pawnMove(s, "w", "t5")).state;
	assert.deepEqual(t.piled.map((e) => e.card.id), ["t5", "u2", "t4", "u1", "t3", "t2"]); // THE 7TH PUSHES THE OLDEST OUT
	assert.equal(t.players.w.pile.n + t.players.b.pile.n, 7); // THE PILES STILL COUNT THEM ALL
});

test("the view's list: the other player's face-down cards are backs, the player's own are readable, all are once the game is over", () => {
	const s0 = sevenToPiles(), s = act(s0, "w", pawnMove(s0, "w", "t5")).state, b = playerView(s, "b"), w = playerView(s, "w");
	assert.deepEqual(b.piled, [P("w", card("p", "t5")), P("b", card("p", "u2")), P("w", card("p", "t4")), P("b", card("p", "u1")), P("w", card("p", "t3")), P("w", { down: true })]); // A BACK: NO ID, KEY OR PIECE
	assert.ok(!JSON.stringify(b).includes("\"t2\""));
	assert.deepEqual(w.piled[5], P("w", card("p", "t2"))); // THE OWNER: THE CARD, WITHOUT THE MARK
	assert.deepEqual(s.piled[5], P("w", down(card("p", "t2")))); // THE STATE KEEPS IT
	s.result = { winner: "b", reason: "checkmate" };
	assert.deepEqual(playerView(s, "b").piled[5], P("w", card("p", "t2")));
});

test("a move card played under its player's Fog of War is a back in the other player's list", () => {
	const s = game();
	s.enchant.push({ id: "e1", key: "fog-of-war", owner: "w", pieces: [], left: 3, data: {} });
	const { state } = act(s, "w", pawnMove(s, "w", "t3"));
	assert.deepEqual([playerView(state, "b").piled, playerView(state, "w").piled], [[P("w", { down: true })], [P("w", card("p", "t3"))]]);
});

test("a game saved before the list has none: it reads as empty, fills from the next card and plays on", () => {
	const s = game();
	delete s.piled;
	assert.deepEqual(playerView(s, "w").piled, []);
	const t = act(s, "w", pawnMove(s, "w", "t3")).state;
	assert.deepEqual(t.piled, [P("w", card("p", "t3"))]);
	assert.ok(legalActions(fromView(playerView(t, "b"), 5), "b").length);
});
