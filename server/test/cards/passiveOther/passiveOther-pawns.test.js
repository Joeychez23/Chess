/*
 *  passiveOther-pawns.test.js  --  chess cards engine tests
 *	Peasant Immunity, Phalanx, Unbroken Line and Pawn Storm, and their edge cases.
 *
 */

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const { legalActions, applyAction, playerView, playerEvents } = require("../../../../cards-engine/index.js");
const { fromView } = require("../../../../cards-engine/view.js");
const hand = require("../../../../cards-engine/hand.js");
const { CARDS } = require("../../../../cards-engine/cards/index.js");
const { makeCtx } = require("../../../../cards-engine/ctx.js");
const { fromFen, sqIndex } = require("../../../../cards-engine/board.js");
const { inCheck } = require("../../../../cards-engine/rules.js");
const { IF, fresh, ofType, ids, byId, hidden, fired, waits, shown, movesOf, varied, play, place, give } = require("../../helpers/passiveOther.js");

/**
 * @description A game on this FEN with empty hands (King cards kept) and the given move cards per colour ({ w: ["p"], b: ["k"] }).
 */
function game(fen, cards = {}) {
	const s = fresh();
	s.board = fromFen(fen);
	for (const c of ["w", "b"]) Object.assign(s.players[c], { moves: (cards[c] || []).map((piece) => hand.newCard(s, "move", { piece })), actives: [], passive: null });
	return s;
}
const moveOf = (s, color, from, to) => legalActions(s, color).find((a) => a.type === "move" && a.from === from && a.to === to);

/**
 * @description key still waits after legalActions for both sides and after a fromView simulation (from either view, a few plies) over s.
 */
function waitsThrough(s, key) {
	legalActions(s, "w");
	legalActions(s, "b");
	assert.ok(waits(s, key), "fired by legalActions");
	for (const viewer of ["w", "b"]) {
		const f = fromView(playerView(s, viewer), 3);
		legalActions(f, f.board.turn);
		assert.ok(waits(f, key), "fired in a fromView state");
	}
}

describe("Peasant Immunity", () => {
	const PAWN_CHECK = "r3k3/8/5P2/8/8/8/8/4K3 w - - 0 1"; // f6-f7 WOULD CHECK THE e8 KING

	test("a pawn move that would check the owner's king gives no check; the opponent's pawn can't take the king; it keeps waiting while that pawn check stands", () => {
		const s = game(PAWN_CHECK, { w: ["p"], b: ["r"] });
		place(s, "peasant-immunity", "b");
		const r = applyAction(s, "w", moveOf(s, "w", "f6", "f7"));
		assert.deepEqual(ofType(r.events, "check"), []);
		assert.ok(!inCheck(r.state, "b") && waits(r.state, "peasant-immunity"));
		assert.ok(moveOf(r.state, "b", "a8", "a7"), "a move that leaves the king where the pawn attacks it");
		const stay = applyAction(r.state, "b", moveOf(r.state, "b", "a8", "a7")).state; // THE KING STAYS ON e8, ATTACKED BY THE f7 PAWN
		assert.ok(waits(stay, "peasant-immunity"));
		assert.ok(!legalActions(stay, "w").some((a) => a.to === "e8"), "the pawn may take the king");
		assert.equal(stay.result, null);
		waitsThrough(stay, "peasant-immunity");
	});

	test("fires once the pawn check it stopped is over, and leaves Board Effects (not a once-per-game card)", () => {
		const s = game(PAWN_CHECK, { w: ["p"], b: ["r"] });
		place(s, "peasant-immunity", "b");
		const st = applyAction(s, "w", moveOf(s, "w", "f6", "f7")).state, r = applyAction(st, "b", moveOf(st, "b", "e8", "d8"));
		assert.ok(fired(r.events, "peasant-immunity") && !waits(r.state, "peasant-immunity"));
		assert.deepEqual(r.state.players.b.used, []);
		assert.ok(!CARDS["peasant-immunity"].oncePerGame);
	});

	test("a check by a pawn that just promoted is a real check (it is no longer a pawn), and the card keeps waiting", () => {
		const s = game("5k2/3P4/8/8/8/8/8/4K3 w - - 0 1", { w: ["p"] });
		place(s, "peasant-immunity", "b");
		const r = applyAction(s, "w", legalActions(s, "w").find((a) => a.from === "d7" && a.promotion === "q"));
		assert.deepEqual(ofType(r.events, "check").map((e) => e.player), ["b"]);
		assert.ok(waits(r.state, "peasant-immunity"));
		assert.equal(CARDS["peasant-immunity"].rules.givesCheck(s, { id: "x", c: "w", t: "p" }, { owner: "b", card: {} }), false, "a pawn's check stopped");
	});

	test("only the owner's king: the owner's pawns still check the opponent", () => {
		const s = game("4k3/8/8/8/8/5p2/8/4K3 b - - 0 1", { b: ["p"] });
		place(s, "peasant-immunity", "b");
		const r = applyAction(s, "b", moveOf(s, "b", "f3", "f2"));
		assert.deepEqual(ofType(r.events, "check").map((e) => e.player), ["w"]);
		assert.equal(CARDS["peasant-immunity"].rules.givesCheck(s, { id: "x", c: "b", t: "p" }, { owner: "b", card: {} }), true);
	});
});

describe("Phalanx", () => {
	const LINE = "4k3/8/8/3p4/2PPP3/8/8/4K3 w - - 0 1"; // WHITE c4 d4 e4 SIDE BY SIDE; BLACK d5 ATTACKS c4 AND e4

	test("an enemy pawn can't capture one of three of the owner's pawns side by side; another piece can, and two side by side aren't enough", () => {
		const s = game(LINE.replace(" w ", " b "), { b: ["p"] });
		place(s, "phalanx", "w");
		assert.ok(!legalActions(s, "b").some((a) => a.from === "d5" && a.to !== "d4"), "a pawn capture listed");
		const two = game("4k3/8/8/3p4/2PP4/8/8/4K3 b - - 0 1", { b: ["p"] });
		place(two, "phalanx", "w");
		assert.ok(moveOf(two, "b", "d5", "c4"));
		const knight = game("4k3/8/1n6/3p4/2PPP3/8/8/4K3 b - - 0 1", { b: ["m"] });
		place(knight, "phalanx", "w");
		assert.ok(moveOf(knight, "b", "b6", "c4"));
	});

	test("a line never runs over the board's edge onto the next rank", () => {
		const h = game("4k3/8/8/6p1/6PP/P7/8/4K3 b - - 0 1", { b: ["p"] }); // g4 h4, AND a3 (THE SQUARE AFTER h4)
		place(h, "phalanx", "w");
		assert.ok(moveOf(h, "b", "g5", "h4"));
		const a4 = game("4k3/8/8/1p5P/PP6/8/8/4K3 b - - 0 1", { b: ["p"] }); // a4 b4, AND h5 (THE SQUARE BEFORE a4)
		place(a4, "phalanx", "w");
		assert.ok(moveOf(a4, "b", "b5", "a4"));
	});

	test("en passant and a promoting capture are pawn captures too", () => {
		const s = game("4k3/8/8/8/1PP1p3/8/3P4/4K3 w - - 0 1", { w: ["p"], b: ["p"] });
		place(s, "phalanx", "w");
		const r = applyAction(s, "w", moveOf(s, "w", "d2", "d4")).state; // b4 c4 d4 SIDE BY SIDE; e4xd3 WOULD TAKE d4 EN PASSANT
		assert.equal(r.board.ep, "d3");
		assert.ok(!moveOf(r, "b", "e4", "d3"), "en passant listed");
		const p = game("1ppp3k/2P5/8/8/8/8/8/4K3 w - - 0 1", { w: ["p"] }); // A BLACK LINE ON b8 c8 d8 (SET BY HAND)
		place(p, "phalanx", "b");
		assert.ok(!legalActions(p, "w").some((a) => a.from === "c7" && a.to !== "c8"), "a promoting capture listed");
	});

	test("fires at the owner's next turn start, after an opponent's turn on which a pawn capture was denied; legalActions and fromView don't fire it", () => {
		const s = game(LINE, { b: ["p"] });
		place(s, "phalanx", "w");
		const st = applyAction(s, "w", moveOf(s, "w", "e1", "f1")).state; // BLACK'S TURN STARTS WITH d5xc4 AND d5xe4 DENIED
		waitsThrough(st, "phalanx");
		const r = applyAction(st, "b", moveOf(st, "b", "e8", "f8"));
		assert.ok(fired(r.events, "phalanx") && !waits(r.state, "phalanx"));
		assert.deepEqual(r.state.players.w.used, []);
	});

	test("not fired by an opponent's move when no capture was denied", () => {
		const s = game("4k3/8/8/8/2PPP3/8/8/4K3 w - - 0 1");
		place(s, "phalanx", "w");
		const st = applyAction(s, "w", moveOf(s, "w", "e1", "f1")).state, r = applyAction(st, "b", moveOf(st, "b", "e8", "f8"));
		assert.ok(!fired(r.events, "phalanx") && waits(r.state, "phalanx"));
		assert.equal(st.effects[0].card.denied, false, "Black's turn start not recorded");
	});
});

describe("Unbroken Line", () => {
	const castle = (s) => moveOf(s, "w", "e1", "g1");

	test("once per game: castle through an attacked square; it fires when the castle is played, not when it is listed", () => {
		const s = game("4kr2/8/8/8/8/8/8/4K2R w K - 0 1"); // f1 ATTACKED BY THE f8 ROOK
		assert.ok(!castle(s));
		place(s, "unbroken-line", "w");
		assert.ok(castle(s));
		waitsThrough(s, "unbroken-line");
		const r = applyAction(s, "w", castle(s));
		assert.equal(r.state.board.sq[62].t, "k");
		assert.ok(fired(r.events, "unbroken-line") && !waits(r.state, "unbroken-line"));
		assert.deepEqual(r.state.players.w.used, ["unbroken-line"]);
	});

	test("only its owner: the opponent still can't castle through an attacked square", () => {
		const s = game("4k2r/8/8/8/8/8/8/4KR2 b k - 0 1"); // f8 ATTACKED BY THE f1 ROOK
		place(s, "unbroken-line", "w");
		assert.ok(!moveOf(s, "b", "e8", "g8"));
		place(s, "unbroken-line", "b");
		assert.ok(moveOf(s, "b", "e8", "g8"));
	});

	test("castle out of check", () => {
		const s = game("k7/8/8/8/4r3/8/8/4K2R w K - 0 1"); // e4 ROOK CHECKS e1
		assert.ok(!castle(s));
		place(s, "unbroken-line", "w");
		const r = applyAction(s, "w", castle(s));
		assert.ok(fired(r.events, "unbroken-line"));
		assert.ok(!inCheck(r.state, "w"));
	});

	test("never into check; a normal castle doesn't fire it; the opponent's castle doesn't either", () => {
		const into = game("4k1r1/8/8/8/8/8/8/4K2R w K - 0 1"); // g1 ATTACKED
		place(into, "unbroken-line", "w");
		assert.ok(!castle(into));
		const s = game("r3k3/8/8/8/8/8/8/4K2R w Kq - 0 1");
		place(s, "unbroken-line", "w");
		const r = applyAction(s, "w", castle(s));
		assert.ok(!fired(r.events, "unbroken-line") && waits(r.state, "unbroken-line"));
		const b = applyAction(r.state, "b", moveOf(r.state, "b", "e8", "c8"));
		assert.ok(waits(b.state, "unbroken-line"));
		assert.ok(CARDS["unbroken-line"].oncePerGame);
	});
});

describe("Pawn Storm", () => {
	test("the owner promotes a pawn: 2 move cards drawn, then it fires", () => {
		const s = game("k7/4P3/8/8/8/8/8/4K3 w - - 0 1", { w: ["p"] });
		place(s, "pawn-storm", "w");
		const { state, events } = applyAction(s, "w", legalActions(s, "w").find((a) => a.from === "e7" && a.promotion === "q"));
		const at = events.findIndex((e) => e.type === "promote"), end = events.findIndex((e) => e.type === "passive-fired");
		assert.ok(at >= 0 && end > at && fired(events, "pawn-storm") && !waits(state, "pawn-storm"));
		assert.deepEqual(events.slice(at + 1, end).filter((e) => e.type === "draw").map((e) => [e.player, e.card.key]), [["w", "move"], ["w", "move"]]);
	});

	test("not for the opponent's promotion, nor a duel upgrade of a piece that wasn't a pawn; a duel upgrade of a pawn counts", () => {
		const s = game("4k3/8/8/8/8/8/3p4/K7 b - - 0 1", { b: ["p"] });
		place(s, "pawn-storm", "w");
		const r = applyAction(s, "b", legalActions(s, "b").find((a) => a.from === "d2" && a.promotion === "q"));
		assert.ok(!fired(r.events, "pawn-storm") && waits(r.state, "pawn-storm"));
		const t = game("4k3/8/8/8/8/8/8/N3K3 w - - 0 1"), knight = t.board.sq[56].id;
		place(t, "pawn-storm", "w");
		t.duel = { player: "w", piece: knight, card: "all-or-nothing", wins: 1, round: 1 };
		const ctx = makeCtx(t);
		ctx.emit({ type: "promote", player: "w", piece: knight, t: "r" });
		assert.ok(waits(t, "pawn-storm"), "a knight's upgrade");
		ctx.emit({ type: "promote", player: "w", piece: knight, t: "b" }); // THE FIRST UPGRADE OF A PAWN: TO A KNIGHT OR A BISHOP
		assert.ok(!waits(t, "pawn-storm"));
	});
});

describe("Peasant Immunity, Unbroken Line and Phalanx edge cases", () => {
	const at = (s, sq) => s.board.sq[sqIndex(sq)];

	test("Peasant Immunity: once it stops a pawn check, only that pawn is exempt; a second pawn's check is real; it leaves when the recorded pawn stops attacking", () => {
		const s = game("k7/8/5p2/3p4/3P4/4K3/8/2R5 w - - 0 1", { b: ["p"] });
		place(s, "peasant-immunity", "w");
		const st = applyAction(s, "w", moveOf(s, "w", "e3", "e4")).state; // d5 ATTACKS e4: STOPPED
		assert.deepEqual(st.effects[0].card.stopping, [at(st, "d5").id]);
		assert.ok(!moveOf(st, "b", "d5", "e4"), "the recorded pawn may take the king");
		const r = applyAction(st, "b", moveOf(st, "b", "f6", "f5")); // f5 ATTACKS e4 TOO
		assert.deepEqual(ofType(r.events, "check").map((e) => e.player), ["w"]);
		assert.ok(inCheck(r.state, "w") && waits(r.state, "peasant-immunity"));
		const out = applyAction(r.state, "w", moveOf(r.state, "w", "e4", "e3"));
		assert.ok(fired(out.events, "peasant-immunity") && !waits(out.state, "peasant-immunity"));
	});

	test("Unbroken Line: a castle legal without it (Peasant Immunity stopped the pawn check) doesn't spend it, whatever the placement order", () => {
		for (const order of [["peasant-immunity", "unbroken-line"], ["unbroken-line", "peasant-immunity"]]) {
			let s = game("k7/8/8/8/8/8/P2p4/4K2R w K - 0 1", { w: ["p"], b: ["k"] });
			order.forEach((k, i) => place(s, k, "w", i));
			s = applyAction(s, "w", moveOf(s, "w", "a2", "a3")).state;
			s = applyAction(s, "b", moveOf(s, "b", "a8", "b8")).state;
			const r = applyAction(s, "w", moveOf(s, "w", "e1", "g1"));
			assert.ok(!fired(r.events, "unbroken-line") && waits(r.state, "unbroken-line"), order.join());
			assert.deepEqual(r.state.players.w.used, [], order.join());
		}
	});

	test("Unbroken Line: the castle it allowed is tagged through on the move event; under the castler's fog the opponent gets neither castle nor through", () => {
		const s = game("4kr2/8/8/8/8/8/8/4K2R w K - 0 1");
		place(s, "unbroken-line", "w");
		const r = applyAction(s, "w", moveOf(s, "w", "e1", "g1")), ev = ofType(r.events, "move")[0];
		assert.equal(ev.through, true);
		r.state.enchant.push({ id: "e990", key: "fog-of-war", owner: "w", pieces: [], left: null, data: {} });
		const told = ofType(playerEvents(r.state, r.events, "b"), "move")[0];
		assert.ok(!("castle" in told) && !("through" in told));
		const plain = game("r3k3/8/8/8/8/8/8/4K2R w Kq - 0 1");
		assert.ok(!("through" in ofType(applyAction(plain, "w", moveOf(plain, "w", "e1", "g1")).events, "move")[0]));
	});

	test("Phalanx covers the opponent's whole turn: a two-move turn can't take a lined-up pawn on its second move; it fires at the owner's next turn start", () => {
		let s = game("4k3/7p/8/3p4/2PPP3/8/8/4K3 w - - 0 1", { b: ["p", "p"] });
		place(s, "phalanx", "w");
		s = applyAction(s, "w", moveOf(s, "w", "e1", "f1")).state;
		s.players.b.actives = [hand.newCard(s, "double-time")];
		s = applyAction(s, "b", { type: "active", card: s.players.b.actives[0].id }).state;
		s = applyAction(s, "b", moveOf(s, "b", "e8", "f8")).state;
		assert.equal(s.board.turn, "b");
		assert.ok(waits(s, "phalanx"));
		assert.ok(!moveOf(s, "b", "d5", "c4") && !moveOf(s, "b", "d5", "e4"), "a lined-up pawn taken on the second move");
		const r = applyAction(s, "b", moveOf(s, "b", "h7", "h6"));
		const start = r.events.findIndex((e) => e.type === "turn-start" && e.player === "w");
		assert.ok(start >= 0 && r.events.findIndex((e) => e.type === "passive-fired" && e.card.key === "phalanx") > start);
	});

	test("Phalanx records a pawn capture it first stops on the second move of a two-move turn, and fires", () => {
		let s = game("4k3/8/3p4/8/2PPP3/8/8/4K3 w - - 0 1", { b: ["p", "p"] }); // d6 ATTACKS NOTHING UNTIL IT STEPS TO d5
		place(s, "phalanx", "w");
		s = applyAction(s, "w", moveOf(s, "w", "e1", "f1")).state;
		assert.equal(s.effects[0].card.denied, false);
		s.players.b.actives = [hand.newCard(s, "double-time")];
		s = applyAction(s, "b", { type: "active", card: s.players.b.actives[0].id }).state;
		const first = applyAction(s, "b", moveOf(s, "b", "d6", "d5"));
		for (const viewer of ["w", "b"]) for (const e of playerEvents(first.state, first.events, viewer)) assert.ok(!e.card || typeof e.card !== "object" || !("denied" in e.card));
		s = first.state;
		assert.ok(!moveOf(s, "b", "d5", "c4"));
		const r = applyAction(s, "b", moveOf(s, "b", "e8", "f8"));
		assert.ok(fired(r.events, "phalanx"), "blocked without firing");
		for (const viewer of ["w", "b"]) for (const e of playerEvents(r.state, r.events, viewer)) assert.ok(!e.card || typeof e.card !== "object" || !("denied" in e.card), "denied in an event");
	});

	test("whole-hand fakes keep one card per held card when the owner's entered Mirage trades ids at a refill", () => {
		for (let seed = 1; seed <= 40; seed++) {
			const s = fresh(seed);
			place(s, IF, "b");
			const gone = s.players.b.moves.pop();
			s.players.b.curses.push({ id: "m99.0", key: "mirage", piece: gone.piece });
			const all = (st) => ids([...hidden(st.players.b), ...st.players.b.curses]).sort(byId);
			let st = play(s, "w", give(s, "foresight-epic")).state;
			assert.deepEqual(ids(shown(st, "w")), all(st), "seed " + seed);
			st = varied(st, "b", seed);
			assert.deepEqual(ids(shown(st, "w")), all(st), "after the refill, seed " + seed);
		}
	});

	test("Phalanx isn't spent on an opponent turn that is skipped: it still waits", () => {
		const s = game("4k3/8/8/3p4/2PPP3/8/8/4K3 w - - 0 1", { b: ["p"] });
		place(s, "phalanx", "w");
		s.players.b.lostTurns = 1;
		const r = applyAction(s, "w", moveOf(s, "w", "e1", "f1"));
		assert.ok(r.events.some((e) => e.type === "turn-skipped" && e.player === "b"));
		assert.ok(waits(r.state, "phalanx"), "spent on a turn the opponent never played");
	});

	test("Phalanx fires at the start of its owner's own lost turn, after a turn it blocked", () => {
		const s = game("4k3/8/8/3p4/2PPP3/8/8/4K3 w - - 0 1", { b: ["p"] });
		place(s, "phalanx", "w");
		const one = applyAction(s, "w", moveOf(s, "w", "e1", "f1")).state;
		one.players.w.lostTurns = 1;
		const r = applyAction(one, "b", moveOf(one, "b", "e8", "d8"));
		assert.ok(r.events.some((e) => e.type === "turn-skipped" && e.player === "w"));
		assert.ok(fired(r.events, "phalanx") && !waits(r.state, "phalanx"));
	});

	test("Phalanx's and Peasant Immunity's bookkeeping reaches only its owner's view, never under the opponent's Fog of War; a state rebuilt from that view plays as the real one", () => {
		const s = game("4k3/8/8/3p4/2PPP3/8/8/4K3 w - - 0 1", { b: ["p"] });
		place(s, "phalanx", "w");
		const a = applyAction(s, "w", moveOf(s, "w", "e1", "f1")).state;
		const p = game("r3k3/8/2P2P2/8/8/8/8/4K3 w - - 0 1", { w: ["p"] });
		place(p, "peasant-immunity", "b");
		const b = applyAction(p, "w", moveOf(p, "w", "f6", "f7")).state; // f7 ATTACKS e8: STOPPED & RECORDED. c6 ATTACKS d7 FOR REAL
		const kept = (e) => "denied" in e.card || "stopping" in e.card;
		assert.equal(a.effects[0].card.denied, true);
		assert.ok(b.effects[0].card.stopping);
		assert.equal(playerView(a, "w").effects[0].card.denied, true); // THE OWNER'S OWN, NO FOG UP: NOTHING IT CAN'T SEE ON THE BOARD
		assert.deepEqual(playerView(b, "b").effects[0].card.stopping, b.effects[0].card.stopping);
		assert.ok(!playerView(a, "b").effects.some(kept) && !playerView(b, "w").effects.some(kept), "in the opponent's view");
		for (const [st, owner] of [[a, "w"], [b, "b"]]) { // UNDER THE OPPONENT'S FOG IT WOULD TELL A HIDDEN PIECE IS A PAWN
			const fog = JSON.parse(JSON.stringify(st));
			fog.enchant.push({ id: "e990", key: "fog-of-war", owner: owner === "w" ? "b" : "w", pieces: [], left: null, data: {} });
			for (const viewer of ["w", "b"]) assert.ok(!playerView(fog, viewer).effects.some(kept), viewer + " under the fog");
		}
		const again = fromView(playerView(a, "w"), 1); // PHALANX STILL FIRES AT ITS OWNER'S NEXT TURN START
		assert.ok(fired(applyAction(a, "b", moveOf(a, "b", "e8", "f8")).events, "phalanx") && fired(applyAction(again, "b", moveOf(again, "b", "e8", "f8")).events, "phalanx"));
		const kings = (st) => movesOf(st, "b").filter((m) => m.from === "e8").map((m) => m.to).sort(); // PEASANT IMMUNITY STILL EXEMPTS ONLY THE PAWN IT STOPPED
		assert.ok(!kings(b).includes("d7"));
		assert.deepEqual(kings(fromView(playerView(b, "b"), 1)), kings(b));
	});

	test("Pawn Storm through a real Conscription (a pawn turned into a piece by a card): 2 move cards", () => {
		const s = game("k7/8/8/8/8/8/4P3/4K3 w - - 0 1");
		s.players.w.captured = ["q"];
		give(s, "conscription");
		place(s, "pawn-storm", "w");
		const { state, events } = applyAction(s, "w", legalActions(s, "w").find((x) => x.type === "active"));
		const from = events.findIndex((e) => e.type === "promote"), end = events.findIndex((e) => e.type === "passive-fired");
		assert.ok(from >= 0 && end > from && !waits(state, "pawn-storm"));
		assert.equal(events.slice(from + 1, end).filter((e) => e.type === "draw" && e.player === "w").length, 2);
	});

	test("Interdicted Foresight: a draw lost to the hand cap under whole-hand fakes still gets a fake, carried by its event", () => {
		const s = fresh();
		place(s, IF, "b");
		const st = play(s, "w", give(s, "foresight-rare")).state;
		while (st.players.b.moves.length < hand.MOVE_CAP) st.players.b.moves.push(hand.newCard(st, "move", { piece: "p" }));
		const ctx = makeCtx(st);
		hand.drawMove(ctx, "b");
		const ev = ctx.events.find((e) => e.type === "draw" && e.player === "b");
		assert.ok(ev.lost);
		assert.ok(st.enchant.find((e) => e.key === IF).data.fake.some((f) => f.id === ev.card.id));
		assert.equal(playerEvents(st, ctx.events, "w").find((e) => e.type === "draw").card.id, ev.card.id);
	});

	test("Interdicted Foresight: a fake card in a returned event is a copy; changing it leaves the state's fake as it was", () => {
		const s = fresh();
		place(s, IF, "b");
		const st = play(s, "w", give(s, "foresight-rare")).state, ctx = makeCtx(st);
		hand.drawMove(ctx, "b");
		const told = playerEvents(st, ctx.events, "w").find((e) => e.type === "draw"), before = JSON.stringify(st.enchant);
		told.card.key = "changed";
		assert.equal(JSON.stringify(st.enchant), before);
	});

	test("Interdicted Foresight: a Foresight another passive cancelled first leaves it waiting, with no fakes", () => {
		const s = fresh();
		place(s, "veto", "b");
		place(s, IF, "b");
		const { state, events } = play(s, "w", give(s, "foresight"));
		assert.ok(fired(events, "veto") && !fired(events, IF) && waits(state, IF));
		assert.equal(state.players.w.seen, null);
	});

	test("Interdicted Foresight: a face-up card gets no fake, at the cancel or when drawn; nor does a drawn card that is no move, active or passive", () => {
		const s = fresh(), up = s.players.b.moves[0];
		place(s, IF, "b");
		up.faceUp = true;
		const st = play(s, "w", give(s, "foresight-rare")).state, fakes = st.enchant.find((e) => e.key === IF).data.fake;
		assert.equal(fakes.length, hidden(st.players.b).length - 1);
		assert.ok(!fakes.some((f) => f.id === up.id));
		const ctx = makeCtx(st), n = fakes.length;
		ctx.emit({ type: "draw", player: "b", card: { id: "c998", key: "move", piece: "p", faceUp: true } });
		ctx.emit({ type: "draw", player: "b", card: { id: "c999", key: "mirage" } });
		assert.equal(st.enchant.find((e) => e.key === IF).data.fake.length, n);
	});
});
