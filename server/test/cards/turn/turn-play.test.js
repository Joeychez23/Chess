/*
 *  turn-play.test.js  --  chess cards engine tests
 *	The turn (cards-engine/turn/index.js, hand.js, ctx.js, index.js): placing passives, playing actives, the automatic redraw, game endings, refills and legal actions
 *
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { legalActions, applyAction, actionKey, IllegalAction } = require("../../../../cards-engine/index.js");
const { sqIndex } = require("../../../../cards-engine/board.js");
const { legalMoves, inCheck } = require("../../../../cards-engine/rules.js");
const { makeCtx } = require("../../../../cards-engine/ctx.js");
const hand = require("../../../../cards-engine/hand.js");
const turn = require("../../../../cards-engine/turn/index.js");
const { register, reset } = require("../../../../cards-engine/cards/index.js");
const { fresh, game, card, first, play, types } = require("../../helpers/turn.js");

reset(); // THE ENGINE ENTRY REGISTERS EVERY CARD: THESE TESTS DRAW FROM ONLY THE CARDS THEY REGISTER

// TEST-ONLY CARDS: AN ACTIVE (PLAYABLE ONLY WHILE activeOn; ITS PLAY RUNS onPlay, ELSE DOES NOTHING) AND A PASSIVE
let activeOn = false, onPlay = null;
register({ key: "test-active", kind: "active", name: "Test Active", rarity: "common", text: "", targets: () => (activeOn ? [null] : []), play: (ctx, player, target) => onPlay && onPlay(ctx, player, target) });
register({ key: "test-passive", kind: "passive", name: "Test Passive", rarity: "common", text: "" });

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
