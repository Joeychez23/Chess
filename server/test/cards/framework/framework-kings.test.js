/*
 *  framework-kings.test.js  --  chess cards engine tests
 *	The card framework (cards-engine/turn/index.js, ctx.js, rules.js): lost turns, two-move turns, king captures and king skulls
 *
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { newGame, legalActions, applyAction, actionKey, playerView, fromView, IllegalAction, KING_SKULLS } = require("../../../../cards-engine/index.js");
const { legalMoves, inCheck } = require("../../../../cards-engine/rules.js");
const { makeCtx } = require("../../../../cards-engine/ctx.js");
const { register, reset } = require("../../../../cards-engine/cards/index.js");
const { other, fresh, game, card, placed, passive, curse, active, ofType, at, kingMove, rookMove } = require("../../helpers/framework.js");

test("a lost turn: ctx.skipTurn makes the player lose their next turns, ticking and refilling as usual", () => {
	reset();
	active("t-stun", (ctx, player) => ctx.skipTurn(other(player)));
	const s = fresh(), half = s.board.half;
	const r = applyAction(s, "w", legalActions(s, "w").find((a) => a.type === "active"));
	assert.deepEqual(ofType(r.events, "turn-skipped"), [{ type: "turn-skipped", player: "b" }]);
	const types = r.events.map((e) => e.type);
	assert.equal(types[types.indexOf("turn-skipped") - 1], "turn-start"); // RIGHT AFTER BLACK'S turn-start
	assert.deepEqual([r.state.board.turn, r.state.ply, r.state.board.half], ["w", s.ply + 2, half + 2]);
	assert.equal(r.state.players.b.lostTurns, 0);
	assert.deepEqual(ofType(r.events, "turn-start").map((e) => e.player), ["b", "w"]);
	// TWO IN A ROW
	const t = fresh();
	t.players.w.actives = [{ id: "c90", key: "t-stun" }];
	active("t-stun", (ctx, player) => ctx.skipTurn(other(player), 2));
	let st = applyAction(t, "w", { type: "active", card: "c90" }).state;
	assert.deepEqual([st.board.turn, st.players.b.lostTurns], ["w", 1]);
	st = applyAction(st, "w", legalActions(st, "w").find((a) => a.type === "move")).state;
	assert.deepEqual([st.board.turn, st.players.b.lostTurns], ["w", 0]);
	st = applyAction(st, "w", legalActions(st, "w").find((a) => a.type === "move")).state;
	assert.equal(st.board.turn, "b");
	// A LOST TURN THAT STARTS IN CHECK: SEE "a player in check doesn't lose the turn"
});

test("a lost turn arriving in check: with a skull it is void and played; with none it is lost and the king can be taken; out of check it is lost for free", () => {
	reset();
	const g = (skulls) => {
		const st = game("4k3/8/8/8/8/8/8/R3K3 w - - 0 1");
		st.players.w.moves = [card("r", "t1"), card("r", "t2")];
		Object.assign(st.players.b, { lostTurns: 1, kingSkulls: skulls });
		return st;
	};
	let s = g(KING_SKULLS), r = applyAction(s, "w", rookMove(s, "w", "a1", "a8"));
	assert.deepEqual([r.state.board.turn, r.state.players.b.lostTurns, r.state.players.b.kingSkulls], ["b", 0, KING_SKULLS - 1]); // VOID: BLACK PLAYS
	assert.deepEqual(ofType(r.events, "turn-skipped"), []);
	assert.deepEqual(ofType(r.events, "king-skull"), [{ type: "king-skull", player: "b", left: KING_SKULLS - 1, why: "lost-turn" }]);
	const out = applyAction(r.state, "b", kingMove(r.state, "b", "e7")).state;
	assert.ok(!inCheck(out, "b"));
	// NO SKULL: LOST EVEN IN CHECK, AND WHITE TAKES THE KING
	s = g(0);
	r = applyAction(s, "w", rookMove(s, "w", "a1", "a8"));
	assert.deepEqual([r.state.board.turn, r.state.players.b.lostTurns, ofType(r.events, "turn-skipped").length], ["w", 0, 1]);
	const take = rookMove(r.state, "w", "a8", "e8");
	assert.ok(take);
	assert.deepEqual(applyAction(r.state, "w", take).state.result, { winner: "w", reason: "king" });
	// OUT OF CHECK: LOST AS BEFORE, NO SKULL
	s = g(KING_SKULLS);
	r = applyAction(s, "w", rookMove(s, "w", "a1", "a2"));
	assert.deepEqual([r.state.board.turn, r.state.players.b.lostTurns, r.state.players.b.kingSkulls], ["w", 0, KING_SKULLS]);
	assert.deepEqual(ofType(r.events, "king-skull"), []);
});

test("a two-move turn whose first move gives check: the checked player's skull ends it; with none the second move may take the king", () => {
	reset();
	const g = (skulls) => {
		const st = game("4k3/8/8/8/8/8/8/R2Q1K2 w - - 0 1");
		st.players.w.moves = [card("r", "t1"), card("r", "t2")];
		st.multi = { player: "w", left: 2, moved: [], differ: false };
		st.players.b.kingSkulls = skulls;
		return st;
	};
	let r = applyAction(g(KING_SKULLS), "w", { type: "move", card: "t1", from: "a1", to: "a8" });
	assert.deepEqual([r.state.board.turn, r.state.multi, r.state.players.b.kingSkulls], ["b", null, KING_SKULLS - 1]);
	assert.deepEqual(ofType(r.events, "king-skull"), [{ type: "king-skull", player: "b", left: KING_SKULLS - 1, why: "double-move" }]);
	r = applyAction(g(0), "w", { type: "move", card: "t1", from: "a1", to: "a8" });
	assert.equal(r.state.board.turn, "w"); // THE TWO-MOVE TURN GOES ON
	const take = { type: "move", card: "t2", from: "a8", to: "e8" };
	assert.ok(legalActions(r.state, "w").some((a) => actionKey(a) === actionKey(take)));
	assert.deepEqual(applyAction(r.state, "w", take).state.result, { winner: "w", reason: "king" });
	r = applyAction(g(KING_SKULLS), "w", { type: "move", card: "t1", from: "a1", to: "a2" }); // NO CHECK: FREE, THE SECOND MOVE COMES
	assert.deepEqual([r.state.board.turn, r.state.players.b.kingSkulls, ofType(r.events, "king-skull").length], ["w", KING_SKULLS, 0]);
});

test("capturing a king wins at once; a king left in check by a card is taken only with a legal move and a card for it", () => {
	reset();
	// BLACK'S TRAP ON e2 REMOVES THE QUEEN THAT INTERPOSED: WHITE'S KING IS LEFT IN CHECK ON BLACK'S TURN
	register({ key: "t-trap", kind: "active", name: "x", rarity: "common", text: "", on: { move: (ctx, o, ev, src) => {
		if (ev.player === o || ev.to !== src.data.square) return false;
		ctx.capture(o, ev.piece);
		return true;
	} } });
	const start = () => {
		const s = game("4r2k/8/8/8/8/8/8/3QK3 w - - 0 1");
		s.players.w.moves = [card("q", "t1")];
		s.enchant = [{ id: "e1", key: "t-trap", owner: "b", pieces: [], left: null, data: { square: "e2" } }];
		return applyAction(s, "w", { type: "move", card: "t1", from: "d1", to: "e2" }).state;
	};
	let s = start();
	assert.ok(inCheck(s, "w") && s.board.turn === "b" && s.result === null);
	s.players.b.moves = [card("r", "t9")];
	const take = { type: "move", card: "t9", from: "e8", to: "e1" };
	assert.ok(legalActions(s, "b").some((a) => actionKey(a) === actionKey(take)));
	const kingId = at(s, "e1").id, rookId = at(s, "e8").id;
	const r = applyAction(s, "b", take);
	assert.deepEqual(r.state.result, { winner: "b", reason: "king" });
	assert.deepEqual(r.events.map((e) => e.type), ["move", "capture", "game-over"]); // NOTHING ELSE RESOLVES
	assert.deepEqual(r.events[1], { type: "capture", player: "b", piece: kingId, t: "k", c: "w", by: rookId, sq: "e1" });
	assert.deepEqual(r.state.players.w.captured, ["q", "k"]); // THE TAKEN KING JOINS ITS OWNER'S TAKEN PIECES (AFTER THE TRAPPED QUEEN)
	assert.deepEqual(legalActions(r.state, "w"), []);
	// NO ROOK CARD: PLAY GOES ON, WHITE MUST ANSWER THE CHECK ON ITS OWN TURN
	s = start();
	s.players.b.moves = [card("p", "t9")];
	assert.ok(!legalActions(s, "b").some((a) => a.to === "e1"));
	const q = applyAction(s, "b", kingMove(s, "b", "g8")).state;
	assert.equal(q.result, null);
	assert.ok(inCheck(q, "w") && q.board.turn === "w");
	assert.ok(legalActions(q, "w").length && legalActions(q, "w").every((a) => a.type === "move" || a.type === "active"));
	assert.equal(makeCtx(q).capture("b", kingId), false); // A CARD EFFECT NEVER TAKES A KING
});

test("random games with skipping, trapping and card-action cards never go on without a king or end in a false stalemate", { timeout: 60000 }, () => {
	reset();
	const R = (o) => register({ name: o.key, text: "", ...o });
	R({ key: "snipe", kind: "active", rarity: "uncommon", targets: (st, p) => st.board.sq.filter((q) => q && q.c !== p && q.t === "p").slice(0, 3).map((q) => ({ piece: q.id })), play: (ctx, p, t) => ctx.capture(p, t.piece) });
	R({ key: "stun", kind: "active", rarity: "common", targets: () => [null], play: (ctx, p) => ctx.skipTurn(other(p)) });
	R({ key: "dt", kind: "active", rarity: "uncommon", targets: () => [null], play: (ctx, p) => { ctx.state.multi = { player: p, left: 2, moved: [], differ: true }; ctx.skipTurn(p); } });
	R({ key: "unjust", kind: "passive", rarity: "common", on: { capture: (ctx, o, ev) => { if (ev.player === o || ev.c !== o) return false; ctx.skipTurn(ev.player); return true; } } });
	R({ key: "trapper", kind: "active", rarity: "common", targets: () => [null], play: (ctx, p) => ctx.enchant(p, "trap-t", [], null, { square: ["d4", "e4", "d5", "e5", "e2", "e7"][ctx.rng.int(6)] }) });
	R({ key: "trap-t", kind: "active", rarity: "rare", on: { move: (ctx, o, ev, src) => {
		if (ev.player === o || ev.to !== src.data.square) return false;
		const q = at(ctx.state, ev.to);
		if (q && q.t !== "k") ctx.capture(o, q.id);
		return true;
	} } });
	R({ key: "hexer", kind: "active", rarity: "common", targets: (st, p) => (st.players[other(p)].curses.length < 2 ? [null] : []), play: (ctx, p) => ctx.giveCurse(other(p), "debt-t", p) });
	R({ key: "debt-t", kind: "curse", rarity: "common", rules: { actions: (st, pl, acts, src) => (pl === src.owner ? [...acts, { type: "clear", card: src.card.id }] : acts) },
		act: (ctx, pl, a, src) => { const pp = ctx.state.players[pl]; pp.curses = pp.curses.filter((c) => c.id !== src.card.id); const b = ctx.state.board, i = b.sq.findIndex((x) => x && x.c === pl && x.t === "b"); if (i >= 0) b.sq[i] = null; } }); // ITS CLEAR DROPS A BISHOP (MAY EXPOSE THE KING)
	const pickSeq = (seed) => { let x = seed * 2654435761 >>> 0 || 1; return (n) => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x % n; }; };
	const ends = {};
	for (const seed of [130, 131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 7, 42]) {
		let s = newGame({ cardGuy: "b", level: 1300, seed });
		const pick = pickSeq(seed);
		for (let ply = 0; ply < 300 && !s.result; ply++) {
			const actor = s.pending ? s.pending.player : s.board.turn, acts = legalActions(s, actor);
			assert.ok(acts.length, "seed " + seed + " ply " + ply + ": no action");
			s = applyAction(s, actor, acts[pick(acts.length)]).state;
			const kings = ["w", "b"].filter((c) => s.board.sq.some((q) => q && q.c === c && q.t === "k")).length;
			if (kings < 2) assert.equal(s.result && s.result.reason, "king", "seed " + seed + " ply " + ply + ": a king is gone");
			if (s.result && s.result.reason === "stalemate") assert.ok(!inCheck(s, s.board.turn) && kings === 2, "seed " + seed + ": false stalemate");
		}
		const why = s.result ? s.result.reason : "open";
		ends[why] = (ends[why] || 0) + 1;
	}
	assert.ok(Object.keys(ends).length, JSON.stringify(ends));
});

test("the half-move count at turn start: a turn-start capture zeroes it, a lost turn after a card capture counts 1", () => {
	reset();
	curse("t-bite", { on: { "turn-start": (ctx, owner, ev) => {
		const st = ctx.state, q = st.board.sq.find((x) => x && x.c !== owner && x.t === "p");
		if (ev.player !== owner || st.bitten || !q) return false;
		st.bitten = true;
		ctx.capture(owner, q.id);
		return true;
	} } });
	let s = fresh();
	s.board.half = 5;
	s.players.b.curses = [{ id: "c90", key: "t-bite" }];
	s = applyAction(s, "w", legalActions(s, "w").find((a) => a.type === "move" && at(s, a.from).t === "n")).state;
	assert.equal(s.board.half, 0); // BLACK'S TURN-START CAPTURE
	reset();
	active("t-snipe-stun", (ctx, player) => { ctx.capture(player, ctx.state.board.sq.find((x) => x && x.c !== player && x.t === "p").id); ctx.skipTurn(other(player)); });
	const t = fresh();
	t.board.half = 5;
	t.players.w.actives = [{ id: "c80", key: "t-snipe-stun" }];
	const r = applyAction(t, "w", { type: "active", card: "c80" }).state;
	assert.deepEqual([r.board.turn, r.board.half], ["w", 1]); // WHITE'S CAPTURE: 0; BLACK'S LOST TURN: + 1
});

test("a lost turn doesn't roll for a passive", () => {
	reset();
	passive("t-p");
	let lost = 0, played = 0;
	for (let seed = 1; seed <= 40; seed++) {
		for (const skip of [true, false]) {
			const s = fresh(seed);
			s.ply = 4;
			if (skip) s.players.b.lostTurns = 1;
			const r = applyAction(s, "w", legalActions(s, "w").find((a) => a.type === "move"));
			const got = r.events.some((e) => e.type === "draw" && e.player === "b" && e.card.key === "t-p");
			if (skip) lost += got; else played += got;
		}
	}
	assert.equal(lost, 0);
	assert.ok(played > 5, String(played)); // THE SAME GAMES DO ROLL WHEN THE TURN IS PLAYED
});

test("king skulls: only a king move past its own statuses spends one (status cleared); a king in check with no status moves for free", () => {
	reset();
	const kingOf = (st, c) => st.board.sq.find((q) => q && q.c === c && q.t === "k");
	const kingActs = (st) => legalActions(st, "w").filter((a) => a.card === "king").map((a) => a.to).sort();
	const freeze = (st) => { st.statuses = { [kingOf(st, "w").id]: [{ s: "frozen", left: 2, by: "b" }] }; return st; };
	// A FROZEN KING, NOT IN CHECK
	let s = freeze(game("4k3/8/8/8/8/8/8/4K3 w - - 0 1"));
	assert.equal(s.players.w.kingSkulls, KING_SKULLS);
	let r = applyAction(s, "w", kingMove(s, "w", "d1"));
	assert.deepEqual([r.state.players.w.kingSkulls, r.state.statuses], [KING_SKULLS - 1, {}]);
	assert.deepEqual(ofType(r.events, "king-skull"), [{ type: "king-skull", player: "w", left: KING_SKULLS - 1, why: "status" }]);
	assert.deepEqual(ofType(r.events, "status-ended").map((e) => e.s), ["frozen"]);
	s = freeze(game("4k3/8/8/8/8/8/8/4K3 w - - 0 1"));
	s.players.w.kingSkulls = 0;
	assert.deepEqual(kingActs(s), []); // NO SKULL: THE FROZEN KING STAYS
	assert.throws(() => applyAction(s, "w", { type: "move", card: "king", from: "e1", to: "d1" }), IllegalAction);
	// IN CHECK (BLACK'S ROOK ON a1), NO STATUS: FREE, WITH SKULLS OR WITH NONE
	const checked = (skulls) => { const st = game("4k3/8/8/8/8/5B2/8/r3K3 w - - 0 1"); st.players.w.moves = [card("m", "t1")]; st.players.w.kingSkulls = skulls; return st; };
	for (const n of [KING_SKULLS, 0]) {
		s = checked(n);
		assert.deepEqual(kingActs(s), ["d2", "e2", "f2"]);
		r = applyAction(s, "w", kingMove(s, "w", "e2"));
		assert.deepEqual([r.state.players.w.kingSkulls, ofType(r.events, "king-skull").length], [n, 0]);
	}
	// IN CHECK AND FROZEN: ONE SKULL (THE STATUS); WITH NONE ONLY THE BISHOP'S BLOCK REMAINS
	s = freeze(checked(KING_SKULLS));
	r = applyAction(s, "w", kingMove(s, "w", "f2"));
	assert.deepEqual([r.state.players.w.kingSkulls, r.state.statuses], [KING_SKULLS - 1, {}]);
	s = freeze(checked(0));
	assert.deepEqual(kingActs(s), []);
	assert.ok(legalActions(s, "w").some((a) => a.card === "t1" && a.from === "f3" && a.to === "d1"));
	// A QUIET KING MOVE, NO STATUSES: FREE
	s = game("4k3/8/8/8/8/8/8/4K3 w - - 0 1");
	r = applyAction(s, "w", kingMove(s, "w", "d2"));
	assert.deepEqual([r.state.players.w.kingSkulls, ofType(r.events, "king-skull")], [KING_SKULLS, []]);
	// A SHAKEN KING CAPTURING: ONE SKULL
	s = game("4k3/8/8/8/8/8/3p4/4K3 w - - 0 1");
	s.statuses = { [kingOf(s, "w").id]: [{ s: "shaken", left: 2, by: "b" }] };
	assert.ok(!legalMoves(s, "w").some((m) => m.t === "k" && m.to === "d2")); // THE HOOKS STILL BIND THE KING
	r = applyAction(s, "w", kingMove(s, "w", "d2"));
	assert.equal(r.state.players.w.kingSkulls, KING_SKULLS - 1);
	// THE TWO KINGS NEVER STAND SIDE BY SIDE, SKULL OR NOT
	s = freeze(game("8/8/8/8/8/3k4/8/4K3 w - - 0 1"));
	assert.ok(!kingActs(s).some((to) => ["d2", "e2"].includes(to)) && kingActs(s).length > 0);
	// A FROZEN KING IN CHECK, NO SKULL, NO ANSWER IN HAND: THE REDRAW, THEN CHECKMATE BY THE CARDS
	const mate = (skulls) => { const st = freeze(game("4k3/8/8/8/8/8/1r6/4K3 b - - 0 1")); st.players.b.moves = [card("r", "t2")]; st.players.w.kingSkulls = skulls; return st; };
	r = applyAction(mate(0), "b", rookMove(mate(0), "b", "b2", "b1"));
	assert.deepEqual(r.state.result, { winner: "b", reason: "checkmate" });
	assert.equal(ofType(r.events, "redraw").length, 1);
	assert.equal(applyAction(mate(1), "b", rookMove(mate(1), "b", "b2", "b1")).state.result, null);
	// BOTH PLAYERS' SKULLS ARE PUBLIC AND SURVIVE A ROUND TRIP
	s = fresh();
	s.players.b.kingSkulls = 1;
	assert.deepEqual([playerView(s, "w").players.b.kingSkulls, playerView(s, "b").players.w.kingSkulls], [1, KING_SKULLS]);
	assert.deepEqual(JSON.parse(JSON.stringify(s)).players.b.kingSkulls, 1);
	assert.equal(fromView(playerView(s, "w"), 3).players.b.kingSkulls, 1);
});

test("a move that takes the enemy king is legal even if the mover's own king stays attacked (the game ends on it)", () => {
	reset();
	register({ key: "t-trap", kind: "active", name: "x", rarity: "common", text: "", on: { move: (ctx, o, ev, src) => {
		if (ev.player === o || ev.to !== src.data.square) return false;
		const q = at(ctx.state, ev.to);
		if (q && q.t !== "k") ctx.capture(o, q.id);
		return true;
	} } });
	const s = game("4r2k/8/8/7B/8/8/8/4K2R w - - 0 1"); // WHITE IN CHECK FROM e8; Bh5-e2 BLOCKS AND DISCOVERS Rh1 ON h8; BLACK'S TRAP TAKES THE BISHOP
	s.players.w.moves = [card("m", "t1")];
	s.enchant = [{ id: "e1", key: "t-trap", owner: "b", pieces: [], left: null, data: { square: "e2" } }];
	s.statuses = { [at(s, "h8").id]: [{ s: "frozen", left: 3, by: "w" }] };
	Object.assign(s.players.b, { kingSkulls: 0, moves: [card("r", "t9")], actives: [] });
	const r = applyAction(s, "w", { type: "move", card: "t1", from: "h5", to: "e2" }).state;
	assert.ok(inCheck(r, "w") && inCheck(r, "b"));
	assert.equal(r.result, null); // NOT CHECKMATE FOR BLACK: IT CAN TAKE THE KING
	const take = { type: "move", card: "t9", from: "e8", to: "e1" };
	assert.ok(legalActions(r, "b").some((a) => actionKey(a) === actionKey(take)));
	assert.deepEqual(applyAction(r, "b", take).state.result, { winner: "b", reason: "king" });
});

test("a skull spent on a king move is part of the move: its events come after move and capture, and no trigger can make the move stale", () => {
	reset();
	passive("t-snatch", { on: { "status-ended": (ctx, owner) => { // TRIES TO REMOVE THE PIECE THE KING IS TAKING
		const q = at(ctx.state, "d2");
		if (!q || q.t === "k") return false;
		ctx.capture(owner, q.id);
		return true;
	} } });
	const s = game("4k3/8/8/8/8/8/3p4/4K3 w - - 0 1"), king = at(s, "e1").id, pawn = at(s, "d2").id;
	s.statuses = { [king]: [{ s: "shaken", left: 2, by: "b" }] };
	s.effects = [placed("c90", "t-snatch", "b", 0)];
	const { state, events } = applyAction(s, "w", kingMove(s, "w", "d2"));
	assert.deepEqual(events.slice(0, 4).map((e) => e.type), ["move", "capture", "status-ended", "king-skull"]);
	assert.deepEqual([events[1].piece, events[1].by], [pawn, king]);
	assert.equal(at(state, "d2").id, king);
	assert.deepEqual(state.players.b.captured, ["p"]);
	assert.ok(!events.some((e) => e.type === "passive-fired")); // THE HANDLER SAW THE KING ON d2
});

test("the double-move skull is spent only when the two-move turn would go on", () => {
	reset();
	const s = game("4k3/8/8/8/8/8/8/R3K3 w - - 0 1");
	Object.assign(s.players.w, { moves: [card("r", "t1")], king: false }); // NO SECOND MOVE: NO OTHER CARD, NO KING CARD
	s.multi = { player: "w", left: 2, moved: [], differ: true };
	const r = applyAction(s, "w", { type: "move", card: "t1", from: "a1", to: "a8" });
	assert.deepEqual([r.state.board.turn, r.state.players.b.kingSkulls, ofType(r.events, "king-skull").length], ["b", KING_SKULLS, 0]);
	assert.ok(inCheck(r.state, "b"));
});

test("a pawn that takes a king while promoting still emits promote, and the taken king's statuses leave the state", () => {
	reset();
	const s = game("k7/1P6/8/8/8/8/8/4K3 w - - 0 1"), king = at(s, "a8").id;
	s.players.w.moves = [card("p", "t1")];
	s.statuses = { [king]: [{ s: "frozen", left: 2, by: "w" }] };
	const { state, events } = applyAction(s, "w", { type: "move", card: "t1", from: "b7", to: "a8", promotion: "q" });
	assert.deepEqual(events.map((e) => e.type), ["move", "capture", "promote", "game-over"]);
	assert.deepEqual(state.result, { winner: "w", reason: "king" });
	assert.deepEqual(state.statuses, {});
});
