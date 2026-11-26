/*
 *  turn-two-move.test.js  --  chess cards engine tests
 *	The turn (cards-engine/turn/index.js, ctx.js, index.js): two-move turns, promotion and en passant, draws by rule, turns without a move, check announcements
 *
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { legalActions, applyAction, actionKey, KING_SKULLS } = require("../../../../cards-engine/index.js");
const { sqIndex } = require("../../../../cards-engine/board.js");
const { legalMoves, inCheck } = require("../../../../cards-engine/rules.js");
const { register, reset } = require("../../../../cards-engine/cards/index.js");
const { fresh, game, card, first, play, types, pass } = require("../../helpers/turn.js");

reset(); // THE ENGINE ENTRY REGISTERS EVERY CARD: THESE TESTS DRAW FROM ONLY THE CARDS THEY REGISTER

// TEST-ONLY CARDS: AN ACTIVE (PLAYABLE ONLY WHILE activeOn; ITS PLAY RUNS onPlay, ELSE DOES NOTHING) AND A PASSIVE
let activeOn = false, onPlay = null;
register({ key: "test-active", kind: "active", name: "Test Active", rarity: "common", text: "", targets: () => (activeOn ? [null] : []), play: (ctx, player, target) => onPlay && onPlay(ctx, player, target) });
register({ key: "test-passive", kind: "passive", name: "Test Passive", rarity: "common", text: "" });

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
require("../../../../cards-engine/cards/index.js").CARDS["test-pit"] = { key: "test-pit", kind: "active",
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
	const E = require("../../../../cards-engine/index.js"), { inCheck: checked } = require("../../../../cards-engine/rules.js");
	const from = (fen) => { // WHITE HOLDS ONE ROOK CARD, NO OTHER CARD IN PLAY; THE e6 PAWN IS FROZEN FOR ONE MORE TURN
		const s = E.newGame({ cardGuy: "b", level: 1300, seed: 1 });
		s.board = E.board.fromFen(fen);
		for (const c of ["w", "b"]) Object.assign(s.players[c], { actives: [], passive: null, curses: [] });
		s.players.w.moves = [require("../../../../cards-engine/hand.js").newCard(s, "move", { piece: "r" })];
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

test("under a refill lock a discarded active waits it out: none back at the end of this turn, one at the end of the next", () => {
	const s = fresh(), id = s.players.w.actives[0].id;
	s.players.w.refillLock = 1;
	let r = play(applyAction(s, "w", { type: "discard", cards: [id] }).state, "w", "move");
	assert.deepEqual([r.players.w.actives.length, r.players.w.moves.length, r.players.w.refillLock], [0, 4, 0]); // THE LOCK HELD THE WHOLE REFILL
	r = play(play(r, "b", "move"), "w", "move");
	assert.deepEqual([r.players.w.actives.length, r.players.w.moves.length], [1, 5]);
});
