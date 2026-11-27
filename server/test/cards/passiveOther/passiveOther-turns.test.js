/*
 *  passiveOther-turns.test.js  --  chess cards engine tests
 *	The passives that change a turn: Underdog, Four of a Kind and Patience, their edge cases, a lost turn voided by a king skull, and a choice asked at the start of a turn.
 *
 */

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const { legalActions, applyAction, playerView, playerEvents } = require("../../../../cards-engine/index.js");
const hand = require("../../../../cards-engine/hand.js");
const { register, CARDS } = require("../../../../cards-engine/cards/index.js");
const { makeCtx } = require("../../../../cards-engine/ctx.js");
const { fromFen, sqIndex } = require("../../../../cards-engine/board.js");
const { fresh, ofType, ids, hidden, fired, waits, place } = require("../../helpers/passiveOther.js");

/**
 * @description The first move action of color's that spends a real move card (not a Mirage, not the King card) and lands on an empty square (captures nothing).
 */
const quiet = (s, color) => legalActions(s, color).find((a) => a.type === "move" && s.players[color].moves.some((c) => c.id === a.card) && !s.board.sq[sqIndex(a.to)]);
const taking = (s, color) => legalActions(s, color).find((a) => a.type === "move" && s.players[color].moves.some((c) => c.id === a.card) && s.board.sq[sqIndex(a.to)]);
const real = (s, color, from, to) => legalActions(s, color).find((a) => a.type === "move" && a.from === from && a.to === to && s.players[color].moves.some((c) => c.id === a.card));
const sizes = (p) => [hand.moveCards(p).length, p.actives.length];
const cardsOf = (s, pieces) => pieces.map((piece) => hand.newCard(s, "move", { piece }));
const sameRoundTrip = (s, color, a) => assert.deepEqual(applyAction(JSON.parse(JSON.stringify(s)), color, a), applyAction(s, color, a));

/**
 * @description Move the piece on square `from` to `to` (a board edit, no event).
 */
function shift(s, from, to) {
	s.board.sq[sqIndex(to)] = s.board.sq[sqIndex(from)];
	s.board.sq[sqIndex(from)] = null;
}

/**
 * @description A fresh game with Four of a Kind placed for White; White plays a quiet move, then holds exactly these move cards (piece types) and `more` is applied; then Black plays a quiet move, so White's turn starts. Returns { before: the state before Black's move, state, events }.
 */
function atStart(pieces, more = () => {}) {
	const s = fresh();
	place(s, "four-of-a-kind", "w");
	const before = applyAction(s, "w", quiet(s, "w")).state;
	before.players.w.moves = cardsOf(before, pieces);
	more(before);
	return { before, ...applyAction(before, "b", quiet(before, "b")) };
}

/**
 * @description A fresh game where White places Patience as its turn (the placement turn doesn't count). Returns the state, Black to move.
 */
function placed() {
	const s = fresh();
	s.players.w.passive = hand.newCard(s, "patience");
	return applyAction(s, "w", { type: "passive" }).state;
}

/**
 * @description Black then White play quiet moves, n times; `hook(state)` before each White move. Returns the last { state, events }.
 */
function rounds(st, n, hook = () => {}) {
	let r = { state: st, events: [] };
	for (let i = 0; i < n; i++) {
		const b = applyAction(r.state, "b", quiet(r.state, "b")).state;
		hook(b);
		r = applyAction(b, "w", quiet(b, "w"));
	}
	return r;
}

describe("Underdog", () => {
	test("5+ points of material down at the refill: the owner tops up to 6 move cards and 2 actives; it keeps waiting and never fires", () => {
		const s = fresh();
		place(s, "underdog", "w");
		s.board.sq[sqIndex("a1")] = null; // WHITE A ROOK DOWN: 5
		const { state, events } = applyAction(s, "w", quiet(s, "w"));
		assert.deepEqual(sizes(state.players.w), [6, 2]);
		assert.ok(waits(state, "underdog") && !fired(events, "underdog") && !state.players.w.used.includes("underdog"));
		const b = applyAction(state, "b", quiet(state, "b")).state, next = applyAction(b, "w", quiet(b, "w")).state;
		assert.deepEqual(sizes(next.players.w), [6, 2]);
		assert.ok(waits(next, "underdog"));
	});

	test("4 points down, or only the opponent's Underdog: the usual 5 and 1", () => {
		const s = fresh();
		place(s, "underdog", "w");
		s.board.sq[sqIndex("b1")] = null; // KNIGHT 3 + PAWN 1 = 4
		s.board.sq[sqIndex("h2")] = null;
		assert.deepEqual(sizes(applyAction(s, "w", quiet(s, "w")).state.players.w), [5, 1]);
		assert.equal(CARDS.underdog.rules.bigHand(s, "w", { owner: "w" }), false);
		s.board.sq[sqIndex("g2")] = null; // ONE MORE PAWN: 5
		assert.equal(CARDS.underdog.rules.bigHand(s, "w", { owner: "w" }), true);
		const t = fresh();
		place(t, "underdog", "b");
		t.board.sq[sqIndex("a1")] = null; // WHITE 5 DOWN, BUT THE UNDERDOG IS BLACK'S
		assert.deepEqual(sizes(applyAction(t, "w", quiet(t, "w")).state.players.w), [5, 1]);
	});

	test("material counts pieces on the board by type: a queen down (9) counts, the opponent being down doesn't", () => {
		const s = fresh();
		place(s, "underdog", "w");
		s.board.sq[sqIndex("d1")] = null;
		assert.deepEqual(sizes(applyAction(s, "w", quiet(s, "w")).state.players.w), [6, 2]);
		const t = fresh();
		place(t, "underdog", "w");
		t.board.sq[sqIndex("d8")] = null; // BLACK DOWN, NOT THE OWNER
		assert.deepEqual(sizes(applyAction(t, "w", quiet(t, "w")).state.players.w), [5, 1]);
	});

	test("no longer behind: the extra move card and active already held stay, but aren't refilled", () => {
		const s = fresh();
		place(s, "underdog", "w");
		s.board.sq[sqIndex("a1")] = null;
		let st = applyAction(s, "w", quiet(s, "w")).state;
		assert.deepEqual(sizes(st.players.w), [6, 2]);
		st.board.sq[sqIndex("a8")] = null; // BLACK A ROOK DOWN TOO: EVEN
		st = applyAction(st, "b", quiet(st, "b")).state;
		const { state, events } = applyAction(st, "w", quiet(st, "w"));
		assert.deepEqual(sizes(state.players.w), [5, 2]);
		assert.equal(events.filter((e) => e.type === "draw" && e.player === "w").length, 0);
		assert.ok(waits(state, "underdog"));
	});

	test("a held (entered) Mirage counts as a move card toward the 6", () => {
		const s = fresh();
		place(s, "underdog", "w");
		s.board.sq[sqIndex("a1")] = null;
		const w = s.players.w;
		w.moves = w.moves.slice(0, 4);
		w.curses.push({ id: "c900", key: "mirage", piece: "q" }); // ENTERED: 4 REAL + MIRAGE = 5 SEEN (A QUEEN CARD HAS NO MOVE AT THE START)
		const { state, events } = applyAction(s, "w", quiet(s, "w"));
		assert.deepEqual([hand.moveCards(state.players.w).length, state.players.w.moves.length], [6, 5]);
		assert.equal(events.filter((e) => e.type === "draw" && e.player === "w" && e.card.key === "move").length, 2);
	});

	test("the opponent sees only the hand count (nothing face up); the state survives a JSON round trip", () => {
		const s = fresh();
		place(s, "underdog", "w");
		s.board.sq[sqIndex("a1")] = null;
		sameRoundTrip(s, "w", quiet(s, "w"));
		const { state, events } = applyAction(s, "w", quiet(s, "w"));
		const v = playerView(state, "b");
		assert.deepEqual([v.players.w.hand.count, v.players.w.hand.shown], [8, []]);
		assert.ok(playerEvents(state, events, "b").filter((e) => e.type === "draw").every((e) => !("card" in e)));
		assert.ok(!hidden(state.players.w).some((c) => c.faceUp));
	});
	test("behind with no card to play: the automatic redraw draws 6 move cards, 5 without Underdog", () => {
		const after = (card) => {
			const s = fresh(), n = { w: 1, b: 1 };
			s.board = fromFen("3qk3/8/8/7p/7P/1pp5/p7/K5N1 b - - 0 1"); // WHITE 9 DOWN: Ka1 AND h4 CAN'T MOVE, ONLY Ng1 CAN
			s.board.sq.forEach((q) => { if (q) q.id = q.c + n[q.c]++; });
			Object.assign(s.players.w, { moves: cardsOf(s, ["p", "p", "p"]), actives: [] });
			s.players.b.moves = cardsOf(s, ["q"]);
			if (card) place(s, "underdog", "w");
			return applyAction(s, "b", real(s, "b", "d8", "d7"));
		};
		const on = after(true), off = after(false);
		for (const r of [on, off]) assert.ok(ofType(r.events, "redraw").some((e) => e.player === "w") && !r.state.result);
		assert.deepEqual([sizes(on.state.players.w), sizes(off.state.players.w)], [[6, 0], [5, 0]]);
		assert.ok(waits(on.state, "underdog"));
	});
});

describe("Four of a Kind", () => {
	const FK = "four-of-a-kind";

	test("4 Knight / Bishop cards are four of a kind: the two moves may be a knight's and a bishop's", () => {
		const { state, events } = atStart(["m", "m", "m", "m", "p"], (st) => { st.board.sq[sqIndex("d2")] = null; }); // d2 EMPTY: THE c1 BISHOP CAN MOVE
		assert.ok(fired(events, FK));
		const one = applyAction(state, "w", real(state, "w", "g1", "f3")).state;
		assert.equal(applyAction(one, "w", real(one, "w", "c1", "e3")).state.board.turn, "b");
		assert.ok(!fired(atStart(["m", "m", "m", "r", "p"]).events, FK), "3 Knight / Bishop cards fired it");
	});

	test("4 move cards of one type at the start of the owner's turn: it fires and starts a two-move turn (same piece allowed); only moves are offered", () => {
		const { state, events } = atStart(["m", "m", "m", "m", "p", "p"]);
		assert.ok(fired(events, FK) && !waits(state, FK) && !state.players.w.used.includes(FK));
		assert.deepEqual(state.multi, { player: "w", left: 2, moved: [], differ: false, draw: 4 });
		assert.ok(legalActions(state, "w").every((a) => a.type === "move"));
		assert.ok(events.findIndex((e) => e.type === "turn-start" && e.player === "w") < events.findIndex((e) => e.type === "passive-fired"));
	});

	test("3 of a type: it doesn't fire and keeps waiting; it isn't checked at the opponent's turn start", () => {
		const { state, events } = atStart(["m", "m", "m", "p", "p", "r"]);
		assert.ok(!fired(events, FK) && waits(state, FK) && state.multi === null);
		assert.ok(fired(atStart(["m", "m", "m", "p", "p", "p", "p"]).events, FK), "4 pawns fire it");
		const s = fresh();
		place(s, FK, "w");
		s.players.w.moves = cardsOf(s, ["p", "m", "m", "m", "m", "m"]);
		const r = applyAction(s, "w", real(s, "w", "a2", "a3")); // BLACK'S TURN STARTS WITH WHITE HOLDING 5 KNIGHTS
		assert.ok(!fired(r.events, FK) && waits(r.state, FK) && r.state.multi === null);
	});

	test("the same knight moves twice; afterwards the owner's move cards are discarded and only 4 drawn (actives refilled as usual)", () => {
		const { state } = atStart(["m", "m", "m", "m", "p", "p"]);
		const one = applyAction(state, "w", real(state, "w", "g1", "f3"));
		assert.equal(one.state.board.turn, "w");
		sameRoundTrip(one.state, "w", real(one.state, "w", "f3", "g5"));
		const left = ids(hand.moveCards(one.state.players.w)).filter((id) => id !== real(one.state, "w", "f3", "g5").card);
		const { state: st, events } = applyAction(one.state, "w", real(one.state, "w", "f3", "g5"));
		assert.equal(st.board.turn, "b");
		assert.deepEqual(events.filter((e) => e.type === "discard" && e.player === "w").map((e) => e.card.id), left);
		const w = st.players.w;
		assert.equal(hand.moveCards(w).length, 4);
		assert.ok(!ids(w.moves).some((id) => left.includes(id)));
		assert.equal(w.actives.length, 1);
		assert.equal(st.multi, null);
		assert.ok(playerEvents(st, events, "b").filter((e) => e.player === "w" && (e.type === "draw" || e.type === "discard")).every((e) => !("card" in e)));
	});

	test("with Underdog also behind, the refill after it is still only 4 move cards", () => {
		const { state } = atStart(["m", "m", "m", "m", "p", "p"], (st) => { place(st, "underdog", "w"); st.board.sq[sqIndex("a1")] = null; });
		const one = applyAction(state, "w", real(state, "w", "g1", "f3")).state;
		const st = applyAction(one, "w", real(one, "w", "f3", "g5")).state;
		assert.deepEqual(sizes(st.players.w), [4, 2]);
	});

	test("on a lost turn it doesn't fire (the turn isn't played) and waits for the next one", () => {
		const { state, events } = atStart(["m", "m", "m", "m", "p", "p"], (st) => { st.players.w.lostTurns = 1; });
		assert.ok(ofType(events, "turn-skipped").length && !fired(events, FK) && waits(state, FK));
		const r = applyAction(state, "b", quiet(state, "b"));
		assert.ok(fired(r.events, FK) && r.state.multi.player === "w");
	});

	test("an entered Mirage of the type counts (its holder sees 4); afterwards it goes out with the move cards and comes back hidden among the 4", () => {
		const { state, events } = atStart(["m", "m", "m", "p", "p"], (st) => { st.players.w.curses.push({ id: "c900", key: "mirage", piece: "m" }); });
		assert.ok(fired(events, FK));
		const one = applyAction(state, "w", real(state, "w", "g1", "f3")).state;
		const { state: st, events: evs } = applyAction(one, "w", real(one, "w", "b1", "c3"));
		const w = st.players.w;
		assert.deepEqual([hand.moveCards(w).length, w.moves.length, hand.mirages(w).length], [4, 3, 1]);
		const seen = playerEvents(st, evs, "w").filter((e) => e.type === "discard");
		assert.equal(seen.length, 4);
		assert.ok(seen.every((e) => e.card.key === "move"));
		assert.deepEqual(playerView(st, "w").players.w.moves.length, 4);
	});
});

describe("Patience", () => {


	test("3 of the owner's turns in a row without capturing (after the placement turn): it fires and the owner draws an active, above the 1-active slot", () => {
		const two = rounds(placed(), 2);
		assert.ok(waits(two.state, "patience") && !fired(two.events, "patience"));
		const b = applyAction(two.state, "b", quiet(two.state, "b")).state;
		sameRoundTrip(b, "w", quiet(b, "w"));
		const { state, events } = applyAction(b, "w", quiet(b, "w"));
		assert.ok(fired(events, "patience") && !waits(state, "patience") && !state.players.w.used.includes("patience"));
		assert.equal(state.players.w.actives.length, 2);
		assert.equal(events.filter((e) => e.type === "draw" && e.player === "w" && e.card.key !== "move").length, 1);
		assert.ok(playerEvents(state, events, "b").filter((e) => e.type === "draw").every((e) => !("card" in e)));
	});

	test("an owner's capture starts the count again; the opponent's capture doesn't", () => {
		let st = rounds(placed(), 1).state;
		shift(st, "b7", "b3"); // A BLACK PAWN WHITE CAN TAKE
		st = applyAction(st, "b", quiet(st, "b")).state;
		st.players.w.moves = cardsOf(st, ["p", "p", "p", "m", "m", "m"]);
		const cap = applyAction(st, "w", taking(st, "w"));
		assert.ok(ofType(cap.events, "capture").length && !fired(cap.events, "patience"));
		const two = rounds(cap.state, 2);
		assert.ok(waits(two.state, "patience"));
		assert.ok(fired(rounds(two.state, 1).events, "patience"));
		let o = rounds(placed(), 1).state; // THE COUNT RUNS (1), SO A RESTART ON THE OPPONENT'S CAPTURE WOULD SHOW
		const wp = o.board.sq.findIndex((q) => q && q.c === "w" && q.t === "p");
		shift(o, "abcdefgh"[wp & 7] + (8 - (wp >> 3)), "b6"); // A WHITE PAWN BLACK CAN TAKE
		o.players.b.moves = cardsOf(o, ["p", "p", "m", "m", "m", "m"]);
		o = applyAction(o, "b", taking(o, "b")).state;
		assert.equal(o.players.w.captured.length, 1);
		const w1 = applyAction(o, "w", quiet(o, "w")).state;
		assert.ok(fired(rounds(w1, 1).events, "patience"));
	});

	test("with 3 actives held the drawn one is lost to the cap, but it still fires", () => {
		const two = rounds(placed(), 2);
		const b = applyAction(two.state, "b", quiet(two.state, "b")).state;
		b.players.w.actives = ["t-a", "t-b", "t-c"].map((k) => hand.newCard(b, k));
		const { state, events } = applyAction(b, "w", quiet(b, "w"));
		assert.ok(fired(events, "patience"));
		assert.equal(state.players.w.actives.length, 3);
		assert.ok(events.some((e) => e.type === "draw" && e.player === "w" && e.lost));
	});
});

describe("Four of a Kind, Hunger, Patience and Underdog edge cases", () => {
	test("Four of a Kind fired, then a Debt due at the same turn start discards the two-move turn's only move: the turn goes on as a normal one, never ending a game the hand could save", () => {
		const after = (seed, card) => {
			const s = fresh(seed);
			s.board = fromFen("r3k3/8/8/8/8/8/3N2PP/7K b - - 0 20"); // AFTER Ra1+ ONLY Nd2 CAN BLOCK; SWAP ALSO ANSWERS THE CHECK
			const n = { w: 1, b: 1 };
			s.board.sq.forEach((q) => { if (q) q.id = q.c + n[q.c]++; });
			s.ply = 20;
			s.board.history = [];
			s.players.w.moves = ["q", "q", "q", "q", "m"].map((piece) => hand.newCard(s, "move", { piece }));
			s.players.w.actives = [hand.newCard(s, "swap")];
			s.players.w.curses.push(hand.newCard(s, "debt", { left: 0 })); // DUE AT WHITE'S NEXT TURN START
			if (card) place(s, "four-of-a-kind", "w", 2);
			s.players.b.moves = ["r", "r", "r", "r", "r", "r"].map((piece) => hand.newCard(s, "move", { piece }));
			return applyAction(s, "b", legalActions(s, "b").find((x) => x.type === "move" && x.to === "a1")).state;
		};
		let dropped = 0;
		for (let seed = 1; seed <= 150; seed++) {
			const off = after(seed, false), on = after(seed, true);
			assert.ok(!(on.result && !off.result), "seed " + seed + ": the game ended only because Four of a Kind was placed");
			if (!on.result && !waits(on, "four-of-a-kind") && !on.multi) dropped++;
		}
		assert.ok(dropped > 0, "no seed reached the case");
	});

	test("Four of a Kind: with no move for the two-move turn it keeps waiting, so an active that answers the check (Swap) is still offered", () => {
		const s = fresh(7);
		s.board = fromFen("r3k3/8/8/8/3N4/8/6PP/7K b - - 0 20");
		const n = { w: 1, b: 1 };
		s.board.sq.forEach((p) => { if (p) p.id = p.c + n[p.c]++; });
		s.ply = 20;
		s.board.history = [];
		s.players.w.moves = cardsOf(s, ["m", "m", "m", "m", "m", "m"]);
		s.players.w.actives = [hand.newCard(s, "swap")];
		place(s, "four-of-a-kind", "w", 2);
		s.players.b.moves = cardsOf(s, ["r", "r", "r", "r", "r", "r"]);
		const { state, events } = applyAction(s, "b", legalActions(s, "b").find((a) => a.type === "move" && a.to === "a1"));
		assert.equal(state.result, null);
		assert.ok(!fired(events, "four-of-a-kind") && waits(state, "four-of-a-kind") && state.multi === null);
		assert.ok(legalActions(state, "w").some((a) => a.type === "active"));
	});

	test("Four of a Kind on the turn Hunger takes: it does not fire (passives run before curses, so lostTurns is still 0): it waits and the turn is skipped; without the Hunger it fires", () => {
		register(require("../../../../cards-engine/cards/curse/hunger.js"));
		for (const hungry of [true, false]) {
			const s = fresh(7);
			s.board = fromFen("r3k3/8/8/8/3N4/8/6PP/7K b - - 0 20");
			const n = { w: 1, b: 1 };
			s.board.sq.forEach((p) => { if (p) p.id = p.c + n[p.c]++; });
			s.ply = 20;
			s.board.history = [];
			s.players.w.moves = cardsOf(s, ["m", "m", "m", "m", "m", "m"]);
			place(s, "four-of-a-kind", "w", 2);
			if (hungry) s.players.w.curses.push(hand.newCard(s, "hunger", { left: 0 }));
			s.players.b.moves = cardsOf(s, ["r", "r", "r", "r", "r", "r"]);
			const { state, events } = applyAction(s, "b", legalActions(s, "b").find((a) => a.type === "move" && a.to === "a2")); // NO CHECK
			assert.equal(fired(events, "four-of-a-kind"), !hungry);
			assert.equal(waits(state, "four-of-a-kind"), hungry);
			assert.equal(ofType(events, "turn-skipped").length, hungry ? 1 : 0);
			assert.equal(Boolean(state.multi), !hungry);
		}
	});

	test("Patience: a capture the owner makes outside their own turn restarts the count at 0; their next capture-free turn counts", () => {
		const st = rounds(placed(), 1).state; // ONE COUNTED TURN; BLACK TO MOVE
		const ctx = makeCtx(st);
		ctx.turn = "b";
		ctx.capture("w", st.board.sq[sqIndex("h7")].id);
		assert.equal(st.effects.find((e) => e.card.key === "patience").card.calm, 0);
		const two = rounds(st, 2);
		assert.ok(waits(two.state, "patience"));
		assert.ok(fired(rounds(two.state, 1).events, "patience"));
	});

	test("Four of a Kind under refillLock: the move cards are still thrown out (a discard each); the lock only stops the draw", () => {
		const { state } = atStart(["m", "m", "m", "m", "p", "p"]);
		const one = applyAction(state, "w", real(state, "w", "g1", "f3")).state;
		one.players.w.refillLock = 1;
		const a = real(one, "w", "f3", "g5"), left = ids(hand.moveCards(one.players.w)).filter((id) => id !== a.card);
		const { state: st, events } = applyAction(one, "w", a);
		assert.deepEqual(events.filter((e) => e.type === "discard" && e.player === "w").map((e) => e.card.id), left);
		assert.equal(events.filter((e) => e.type === "draw" && e.player === "w").length, 0);
		assert.deepEqual([st.players.w.moves.length, st.players.w.refillLock], [0, 0]);
	});

	test("Underdog behind: the automatic redraw (no card action) draws up to 6", () => {
		const s = fresh();
		place(s, "underdog", "w");
		s.board.sq[sqIndex("a1")] = null;
		const st = applyAction(s, "w", quiet(s, "w")).state;
		Object.assign(st.players.w, { moves: cardsOf(st, ["q", "q", "q", "q", "q"]), actives: [] }); // 5 HELD, SO THE 6TH IS UNDERDOG'S. NO QUEEN MOVE, NO ACTIVE, NO KING MOVE AT THE START
		const { state, events } = applyAction(st, "b", quiet(st, "b"));
		assert.ok(events.some((e) => e.type === "redraw" && e.player === "w"));
		assert.equal(hand.moveCards(state.players.w).length, 6);
	});
});

describe("a lost turn voided by a king skull", () => {
	/**
	 * @description A game on this FEN at ply 20 with piece ids set and these move-card piece types per color.
	 */
	const setup = (seed, fen, w, b) => {
		const s = fresh(seed);
		s.board = fromFen(fen);
		const n = { w: 1, b: 1 };
		s.board.sq.forEach((q) => { if (q) q.id = q.c + n[q.c]++; });
		s.ply = 20;
		s.board.history = [];
		s.players.w.moves = w.map((piece) => hand.newCard(s, "move", { piece }));
		s.players.b.moves = b.map((piece) => hand.newCard(s, "move", { piece }));
		return s;
	};

	test("Four of a Kind fired on a lost turn a king skull would void, then a Debt (Hollow Crown held) discards the King card and the turn is skipped: its debuff is dropped, the usual refill runs", () => {
		let hits = 0;
		for (let seed = 1; seed <= 60; seed++) {
			const s = setup(seed, "r3k3/8/8/8/8/8/3N2PP/7K b - - 0 20", ["q", "q", "q", "q", "m"], ["r", "r", "r", "r", "r", "r"]);
			s.players.w.actives = [];
			s.players.w.curses.push(hand.newCard(s, "hollow-crown"), hand.newCard(s, "debt", { left: 0 }));
			s.players.w.lostTurns = 1;
			place(s, "four-of-a-kind", "w", 2);
			const { state, events } = applyAction(s, "b", legalActions(s, "b").find((a) => a.type === "move" && a.to === "a1"));
			if (!fired(events, "four-of-a-kind") || !ofType(events, "turn-skipped").length) continue;
			hits++;
			assert.equal(hand.moveCards(state.players.w).length, hand.HAND_MOVES, "seed " + seed + ": the skipped turn's refill drew only 4");
			assert.equal(ofType(events, "discard").filter((e) => e.player === "w" && e.card.key === "move").length, 1, "seed " + seed + ": move cards thrown out on a skipped turn"); // DEBT'S ONE AT MOST
		}
		assert.ok(hits > 0, "no seed reached the case");
	});

	test("Phalanx: a lost turn voided by a king skull is played, so the blocked capture stays recorded and it fires at the owner's next turn start", () => {
		const s = setup(3, "8/8/8/2p1k3/2P1P3/3P4/8/4K3 w - - 0 20", ["p", "p", "p", "p", "p", "p"], ["p", "p", "p", "p", "p", "p"]);
		place(s, "phalanx", "w", 2);
		Object.assign(s.players.b, { lostTurns: 1, kingSkulls: 1 });
		const one = applyAction(s, "w", legalActions(s, "w").find((a) => a.type === "move" && a.from === "d3" && a.to === "d4")); // CHECK; c4 d4 e4 SIDE BY SIDE, c5xd4 DENIED
		assert.ok(!ofType(one.events, "turn-skipped").length && one.state.board.turn === "b" && one.state.players.b.lostTurns === 0);
		assert.equal(one.state.effects.find((e) => e.card.key === "phalanx").card.denied, true);
		const two = applyAction(one.state, "b", legalActions(one.state, "b").find((a) => a.type === "move" && a.from === "e5"));
		assert.ok(fired(two.events, "phalanx") && !waits(two.state, "phalanx"));
	});
});

describe("a choice asked at the start of a turn (no card does yet: a test card)", () => {
	const ASK = "t-ask", options = [{ type: "choice", option: "x" }, { type: "choice", option: "y" }];
	const withAsk = (run) => { // NOT REGISTERED: NO RANDOM DRAW MAY GIVE IT
		CARDS[ASK] = { key: ASK, kind: "curse", on: { "turn-start": (ctx, owner, ev, src) => { if (ev.player !== owner || src.card.done) return false; src.card.done = true; ctx.ask(owner, "t", ["x", "y"], { card: ASK }); return true; } }, choice: { resolve() {} } };
		try { run(); } finally { delete CARDS[ASK]; }
	};

	for (const first of [false, true]) test("with a Four of a Kind firing at the same turn start (the choice asked " + (first ? "before" : "after") + " it): the choice is answered, then the two moves are played, then its throw-out and draw of 4", () => withAsk(() => {
		const { state, events } = atStart(["p", "p", "p", "p", "m"], (b) => {
			const card = hand.newCard(b, ASK);
			if (first) b.effects.push({ id: card.id, owner: "w", card, placedAt: -1 }); // PLACED BEFORE FOUR OF A KIND: HEARD FIRST
			else b.players.w.curses.push(card); // A CURSE IS HEARD AFTER THE PLACED PASSIVES
		});
		assert.ok(fired(events, "four-of-a-kind") && state.multi && state.multi.left === 2);
		assert.deepEqual(legalActions(state, "w"), options);
		assert.deepEqual(legalActions(state, "b"), []);
		const a = applyAction(state, "w", options[0]).state;
		assert.ok(!a.pending && a.board.turn === "w" && a.multi.left === 2);
		assert.ok(legalActions(a, "w").length && legalActions(a, "w").every((x) => x.type === "move"));
		const m1 = applyAction(a, "w", quiet(a, "w")).state;
		assert.equal(m1.board.turn, "w");
		const m2 = applyAction(m1, "w", quiet(m1, "w"));
		assert.equal(m2.state.board.turn, "b");
		assert.equal(sizes(m2.state.players.w)[0], 4);
		assert.ok(ofType(m2.events, "discard").length >= 3);
	}));

	test("asked at the start of a turn that is then lost: the turn is skipped, the asker answers during the opponent's turn, and play goes on", () => withAsk(() => {
		const s = fresh();
		s.players.b.curses.push(hand.newCard(s, ASK));
		s.players.b.lostTurns = 1;
		const { state, events } = applyAction(s, "w", quiet(s, "w"));
		assert.ok(ofType(events, "turn-skipped").some((e) => e.player === "b"));
		assert.ok(state.board.turn === "w" && state.pending.player === "b" && !state.result);
		assert.deepEqual(legalActions(state, "w"), []);
		assert.deepEqual(legalActions(state, "b"), options);
		const a = applyAction(state, "b", options[1]);
		assert.ok(!a.state.pending && a.state.board.turn === "w" && !a.state.result);
		assert.deepEqual(ofType(a.events, "turn-start"), []);
		assert.equal(applyAction(a.state, "w", quiet(a.state, "w")).state.board.turn, "b");
	}));
});
