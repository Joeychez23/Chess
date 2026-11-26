/*
 *  passiveCapture-cards.test.js  --  chess cards engine tests
 *	The passives triggered by captures and checks (cards-engine/cards/passive/), Last Rites to Escape Artist: trigger and non-trigger cases, one describe per card.
 *
 */

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const { legalActions, applyAction, playerView, playerEvents } = require("../../../../cards-engine/index.js");
const { sqIndex } = require("../../../../cards-engine/board.js");
const { legalMoves, inCheck } = require("../../../../cards-engine/rules.js");
const { makeCtx } = require("../../../../cards-engine/ctx.js");
const statuses = require("../../../../cards-engine/statuses.js");
const { ofType, id, mv, fired, waits, cardless, game, place, pass, takeD5, PAWN, QUEEN } = require("../../helpers/passiveCapture.js");

const KNIGHT = "4k3/8/8/3n4/4P3/8/8/4K3 w - - 0 1";

describe("Last Rites", () => {
	test("the piece that captured the owner's piece is Frozen for its owner's next 3 turns", () => {
		const { s, state, events } = takeD5(PAWN, "last-rites", "b"), pawn = id(s, "e4");
		assert.ok(fired(events, "last-rites"));
		assert.deepEqual(state.statuses[pawn].map((e) => [e.s, e.left]), [["frozen", 3]]);
		let t = pass(state, "b").state;
		for (let turn = 0; turn < 3; turn++) {
			assert.ok(!legalMoves(t, "w").some((m) => m.piece === pawn), "white turn " + (turn + 1)); // WHITE'S NEXT 3 TURNS: FROZEN
			t = pass(pass(t, "w").state, "b").state;
		}
		assert.ok(!statuses.has(t, pawn, "frozen"));
	});

	test("no trigger: the owner's own capture, or a card effect's capture (no capturing piece)", () => {
		const { state, events } = takeD5(PAWN, "last-rites", "w");
		assert.ok(!fired(events, "last-rites") && waits(state, "last-rites"));
		const s = game(PAWN);
		place(s, "last-rites", "b");
		const ctx = makeCtx(s);
		ctx.capture("w", id(s, "d5"));
		assert.ok(waits(s, "last-rites") && !ofType(ctx.events, "status").length);
	});
});

describe("Unjust Retribution", () => {
	test("the owner's piece captured on the opponent's half: the opponent's next turn is skipped", () => {
		const s = game("4k3/8/8/8/3p4/4P3/8/4K3 w - - 0 1");
		s.players.w.moves = [mv("p", "t1")];
		place(s, "unjust-retribution", "b");
		const { state, events } = applyAction(s, "w", { type: "move", card: "t1", from: "e3", to: "d4" });
		assert.ok(fired(events, "unjust-retribution"));
		assert.equal(state.players.w.lostTurns, 1);
		const after = pass(state, "b");
		assert.ok(ofType(after.events, "turn-skipped").some((e) => e.player === "w"));
		assert.equal(after.state.board.turn, "b");
	});

	test("no trigger: a capture on the owner's own half", () => {
		const { state, events } = takeD5(PAWN, "unjust-retribution", "b");
		assert.ok(!fired(events, "unjust-retribution") && waits(state, "unjust-retribution"));
		assert.equal(state.players.w.lostTurns, 0);
	});
});

describe("Reinforcements", () => {
	test("the owner's pawn captured: the owner draws a move card", () => {
		const { state, events } = takeD5("4k3/7p/8/3p4/4P3/8/8/4K3 w - - 0 1", "reinforcements", "b"); // A PAWN LEFT TO DRAW A CARD FOR
		assert.ok(fired(events, "reinforcements"));
		assert.equal(ofType(events, "draw").filter((e) => e.player === "b").length, 1);
		assert.equal(state.players.b.moves.length, 1);
	});

	test("no trigger: a knight captured", () => {
		const { state, events } = takeD5(KNIGHT, "reinforcements", "b");
		assert.ok(!fired(events, "reinforcements") && waits(state, "reinforcements"));
		assert.equal(state.players.b.moves.length, 0);
	});
});

describe("Retaliation", () => {
	const FEN = "4k3/8/5n2/3p4/4P3/8/8/4K3 w - - 0 1";

	test("the owner may recapture next turn without a card; doing so fires it with no discard", () => {
		const { s, state, events } = takeD5(FEN, "retaliation", "b"), pawn = id(s, "e4");
		assert.ok(!fired(events, "retaliation"));
		assert.deepEqual(cardless(state, "b"), [{ type: "move", card: null, from: "f6", to: "d5" }]);
		assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
		assert.deepEqual(playerView(state, "w").effects, state.effects); // BOARD EFFECTS ARE FACE UP
		const r = applyAction(state, "b", { type: "move", card: null, from: "f6", to: "d5" });
		assert.ok(ofType(r.events, "capture").some((e) => e.piece === pawn));
		assert.ok(fired(r.events, "retaliation"));
		assert.ok(!ofType(r.events, "discard").some((e) => e.player === "b"));
	});

	test("no recapture that turn: the owner discards a card and it fires", () => {
		const { state } = takeD5(FEN, "retaliation", "b");
		const r = pass(state, "b");
		assert.ok(fired(r.events, "retaliation"));
		assert.equal(ofType(r.events, "discard").filter((e) => e.player === "b").length, 1);
		assert.deepEqual(cardless(r.state, "w"), []);
	});

	test("a Hexed recapturer still gets the cardless move (Hex stops card moves only); none for a non-capture, none on the opponent's turn", () => {
		const { state } = takeD5(FEN, "retaliation", "b", (s) => { s.statuses[id(s, "f6")] = [{ s: "hexed", left: 2, by: "w" }]; });
		assert.deepEqual(cardless(state, "b"), [{ type: "move", card: null, from: "f6", to: "d5" }]);
		const t = takeD5(FEN, "retaliation", "b").state;
		assert.ok(cardless(t, "b").every((a) => a.to === "d5"));
		const u = takeD5(FEN, "retaliation", "w").state; // WHITE'S OWN CAPTURE ARMS NOTHING
		assert.deepEqual(cardless(u, "b"), []);
	});
});

describe("Bleeding Hand", () => {
	test("the opponent captures: they discard a random card", () => {
		const { events } = takeD5(PAWN, "bleeding-hand", "b", (s) => { s.players.w.moves.push(mv("p", "t2"), mv("p", "t3")); });
		assert.ok(fired(events, "bleeding-hand"));
		const d = ofType(events, "discard");
		assert.equal(d.length, 1);
		assert.equal(d[0].player, "w");
	});

	test("no trigger: the owner's own capture", () => {
		const { state, events } = takeD5(PAWN, "bleeding-hand", "w");
		assert.ok(!fired(events, "bleeding-hand") && waits(state, "bleeding-hand"));
		assert.equal(ofType(events, "discard").length, 0);
	});
});

describe("Hex", () => {
	test("the piece that took the owner's knight is Hexed for 3 turns: no card moves it", () => {
		const { s, state, events } = takeD5(KNIGHT, "hex", "b"), pawn = id(s, "e4");
		assert.ok(fired(events, "hex"));
		assert.deepEqual(state.statuses[pawn].map((e) => [e.s, e.left]), [["hexed", 3]]);
		const t = pass(state, "b").state;
		assert.ok(t.players.w.moves.some((c) => c.piece === "p"));
		assert.ok(!legalActions(t, "w").some((a) => a.from === "d5"));
	});

	test("no trigger: a pawn captured", () => {
		const { s, state, events } = takeD5(PAWN, "hex", "b");
		assert.ok(!fired(events, "hex") && waits(state, "hex"));
		assert.ok(!statuses.has(state, id(s, "e4"), "hexed"));
	});
});

describe("Spite", () => {
	test("the owner's queen captured: the opponent's move cards are thrown out and redrawn; the owner loses its active", () => {
		const { state, events } = takeD5(QUEEN, "spite", "b", (s) => {
			s.players.w.moves.push(mv("p", "t2"), mv("p", "t3"));
			s.players.b.actives = [{ id: "c70", key: "t-pass" }];
		});
		assert.ok(fired(events, "spite"));
		const i = events.findIndex((e) => e.type === "redraw" && e.player === "w");
		assert.ok(i >= 0);
		assert.equal(events.slice(i + 1, i + 3).filter((e) => e.type === "draw" && e.player === "w").length, 2); // AS MANY AS WERE THROWN OUT
		assert.ok(!state.players.w.moves.some((c) => c.id === "t2" || c.id === "t3"));
		assert.ok(ofType(events, "discard").some((e) => e.player === "b" && e.card.id === "c70"));
		assert.deepEqual(state.players.b.actives, []);
	});

	test("no trigger: a pawn captured", () => {
		const { state, events } = takeD5(PAWN, "spite", "b");
		assert.ok(!fired(events, "spite") && waits(state, "spite"));
		assert.equal(ofType(events, "redraw").length, 0);
	});
});

describe("Bounty", () => {
	test("the owner takes the enemy queen: a random card of theirs is stolen", () => {
		const { state, events } = takeD5(QUEEN, "bounty", "w", (s) => { s.players.b.moves = [mv("p", "c71")]; });
		assert.ok(fired(events, "bounty"));
		assert.deepEqual(ofType(events, "card-taken").map((e) => [e.player, e.from, e.card.id]), [["w", "b", "c71"]]);
		assert.ok(state.players.w.moves.some((c) => c.id === "c71"));
		assert.deepEqual(state.players.b.moves, []);
	});

	test("no trigger: a pawn taken", () => {
		const { state, events } = takeD5(PAWN, "bounty", "w", (s) => { s.players.b.moves = [mv("p", "c71")]; });
		assert.ok(!fired(events, "bounty") && waits(state, "bounty"));
		assert.equal(ofType(events, "card-taken").length, 0);
	});
});

describe("Bad Omen", () => {
	test("any of the owner's pieces captured by the opponent: a random curse goes to the opponent", () => {
		for (const fen of [QUEEN, PAWN]) {
			const { state, events } = takeD5(fen, "bad-omen", "b");
			assert.ok(fired(events, "bad-omen"));
			assert.deepEqual(state.players.w.curses.map((c) => c.key), ["t-curse"]);
			assert.ok(ofType(events, "curse-given").some((e) => e.player === "b"));
		}
	});

	test("the curse limit holds (it still fires); no trigger on the owner's own capture or a removal by the owner's side", () => {
		const full = takeD5(PAWN, "bad-omen", "b", (s) => { s.players.w.curses = [{ id: "c72", key: "t-curse" }, { id: "c73", key: "t-curse" }]; });
		assert.ok(fired(full.events, "bad-omen"));
		assert.equal(full.state.players.w.curses.length, 2);
		assert.equal(ofType(full.events, "curse-given").length, 0);
		const { state, events } = takeD5(PAWN, "bad-omen", "w");
		assert.ok(!fired(events, "bad-omen") && waits(state, "bad-omen"));
		const s = game(PAWN);
		place(s, "bad-omen", "b");
		const ctx = makeCtx(s);
		ctx.capture("b", id(s, "d5")); // A REMOVAL (A FORFEIT, A LOST DUEL PIECE) IS NOT A CAPTURE
		assert.ok(waits(s, "bad-omen") && !ofType(ctx.events, "curse-given").length);
	});
});

describe("Overwatch", () => {
	const FEN = "4k3/7p/8/8/1b6/8/7P/R6K w - - 5 1";
	const rookTo = (s, to) => { s.players.w.moves = [mv("r", "t1")]; return applyAction(s, "w", { type: "move", card: "t1", from: "a1", to }); };

	test("an enemy piece landing where the owner's bishop attacks is captured at once; the bishop is Frozen 2 turns; Black then plays on", () => {
		const s = game(FEN), rook = id(s, "a1"), bishop = id(s, "b4");
		place(s, "overwatch", "b");
		const { state, events } = rookTo(s, "a3");
		assert.ok(fired(events, "overwatch"));
		assert.ok(ofType(events, "capture").some((e) => e.piece === rook && e.player === "b" && e.by === null));
		assert.equal(state.board.sq[sqIndex("a3")], null);
		assert.equal(state.board.sq[sqIndex("b4")].id, bishop); // AN OUT-OF-TURN SHOT: THE BISHOP STAYS
		assert.deepEqual(state.statuses[bishop].map((e) => [e.s, e.left]), [["frozen", 2]]);
		assert.equal(state.board.half, 0); // A CAPTURE THIS TURN
		assert.equal(state.board.turn, "b");
		assert.equal(state.result, null);
		assert.ok(legalActions(state, "b").length);
		assert.ok(!legalMoves(state, "b").some((m) => m.piece === bishop));
	});

	test("no trigger: a square the bishop doesn't attack, a Warded piece, a piece a capture rule protects", () => {
		const s = game(FEN);
		place(s, "overwatch", "b");
		const quiet = rookTo(s, "a2");
		assert.ok(!fired(quiet.events, "overwatch") && waits(quiet.state, "overwatch"));
		assert.equal(quiet.state.board.half, 6);
		const w = game(FEN);
		place(w, "overwatch", "b");
		w.statuses[id(w, "a1")] = [{ s: "warded", left: null, by: "w" }];
		assert.ok(rookTo(w, "a3").state.board.sq[sqIndex("a3")]);
		const g = game(FEN);
		place(g, "overwatch", "b");
		place(g, "t-guard", "w");
		assert.ok(rookTo(g, "a3").state.board.sq[sqIndex("a3")]);
	});

	test("a check its capture uncovers on the mover is reported once; a check its capture removes is not reported", () => {
		const s = game("k3r3/8/8/8/8/8/4R3/2b1K3 w - - 0 1");
		place(s, "overwatch", "b");
		s.players.w.moves = [mv("r", "t1")];
		const { state, events } = applyAction(s, "w", { type: "move", card: "t1", from: "e2", to: "e3" });
		assert.ok(fired(events, "overwatch"));
		assert.ok(inCheck(state, "w"));
		assert.equal(ofType(events, "check").filter((e) => e.player === "w").length, 1);
		const t = game("4k3/8/8/8/8/R7/8/2b4K w - - 0 1");
		place(t, "overwatch", "b");
		t.players.w.moves = [mv("r", "t1")];
		const r = applyAction(t, "w", { type: "move", card: "t1", from: "a3", to: "e3" });
		assert.ok(fired(r.events, "overwatch"));
		assert.equal(ofType(r.events, "check").length, 0);
	});

	test("the shot's capture event names the bishop's square (from) for either owner and a castle's rook; a move's own capture names none", () => {
		const shot = (events) => ofType(events, "capture").find((e) => e.by === null);
		const s = game(FEN);
		place(s, "overwatch", "b");
		assert.deepEqual([shot(rookTo(s, "a3").events)].map((e) => [e.from, e.sq]), [["b4", "a3"]]);
		const w = game("r6k/7p/8/1B6/8/8/7P/4K3 b - - 5 1"); // WHITE'S OWNER: Bb5 WATCHES a6
		place(w, "overwatch", "w");
		w.players.b.moves = [mv("r", "t1")];
		assert.deepEqual([shot(applyAction(w, "b", { type: "move", card: "t1", from: "a8", to: "a6" }).events)].map((e) => [e.from, e.sq]), [["b5", "a6"]]);
		const c = game("4k3/7p/8/1b6/8/8/8/4K2R w K - 0 1"); // THE CASTLE'S ROOK, ON f1
		place(c, "overwatch", "b");
		place(c, "t-kingguard", "w");
		assert.deepEqual([shot(applyAction(c, "w", { type: "move", card: "king", from: "e1", to: "g1" }).events)].map((e) => [e.from, e.sq]), [["b5", "f1"]]);
		const { events } = takeD5(PAWN, null);
		assert.ok(!("from" in ofType(events, "capture")[0]));
	});

	test("under the owner's Fog of War the opponent's events keep the hidden bishop's square for its shot, and nothing else names the bishop", () => {
		const s = game("4k3/7p/2b5/8/8/8/7P/R5K1 w - - 5 1"), bishop = id(s, "c6");
		place(s, "overwatch", "b");
		s.enchant.push({ id: "e1", key: "fog-of-war", owner: "b", pieces: [], left: 2, data: {} });
		const { state, events } = rookTo(s, "a4");
		assert.ok(fired(events, "overwatch"));
		const seen = playerEvents(state, events, "w");
		assert.deepEqual(ofType(seen, "capture").map((e) => [e.from, e.sq]), [["c6", "a4"]]);
		assert.ok(!JSON.stringify(seen).includes('"' + bishop + '"'));
		assert.equal(ofType(seen, "status").length, 0); // ITS FROZEN: ABOUT A HIDDEN PIECE, NOT TOLD
		assert.equal(playerView(state, "w").board.sq[sqIndex("c6")], null);
	});
});

describe("Escape Artist", () => {
	const FEN = "k2r4/8/8/8/7B/8/8/1R2K3 b - - 0 1";
	const checked = (key = "escape-artist") => {
		const s = game(FEN);
		s.players.b.moves = [mv("r", "t1")];
		if (key) place(s, key, "w");
		return applyAction(s, "b", { type: "move", card: "t1", from: "d8", to: "e8" }).state; // BLACK CHECKS WHITE
	};

	test("in check, the owner gets cardless moves, only those that get out of check; using one fires it", () => {
		const s = checked(), extra = cardless(s, "w");
		assert.ok(inCheck(s, "w"));
		assert.deepEqual(extra.map((a) => a.from + a.to).sort(), legalMoves(s, "w").map((m) => m.from + m.to).sort());
		assert.ok(extra.some((a) => a.from === "h4" && a.to === "e7"));
		assert.ok(!extra.some((a) => a.from === "b1"));
		for (const a of extra) assert.ok(!inCheck(applyAction(s, "w", a).state, "w"));
		const r = applyAction(s, "w", { type: "move", card: null, from: "h4", to: "e7" });
		assert.ok(fired(r.events, "escape-artist"));
		assert.deepEqual(cardless(checked(null), "w"), []); // WITHOUT THE CARD
	});

	test("no trigger: not in check (no cardless moves), or a card move out of check", () => {
		const s = game("k2r4/8/8/8/7B/8/8/1R2K3 w - - 0 1");
		place(s, "escape-artist", "w");
		assert.deepEqual(cardless(s, "w"), []);
		const t = checked();
		const r = applyAction(t, "w", { type: "move", card: "king", from: "e1", to: "d2" });
		assert.ok(!fired(r.events, "escape-artist") && waits(r.state, "escape-artist"));
		assert.deepEqual(JSON.parse(JSON.stringify(r.state)), r.state);
	});
	test("a king that lost its King card (Hollow Crown) still gets out of check by a cardless move; no King-card move is offered", () => {
		const s = game("r3k3/8/8/8/8/8/8/4K3 b - - 0 1");
		s.players.w.king = false;
		s.players.b.moves = [mv("r", "c71")];
		place(s, "escape-artist", "w");
		const { state } = applyAction(s, "b", { type: "move", card: "c71", from: "a8", to: "a1" }); // Ra1+
		assert.equal(state.result, null);
		assert.ok(!legalActions(state, "w").some((a) => a.card === "king"));
		assert.deepEqual(cardless(state, "w").map((a) => a.from + a.to).sort(), ["e1d2", "e1e2", "e1f2"]);
		const r = applyAction(state, "w", { type: "move", card: null, from: "e1", to: "e2" });
		assert.ok(fired(r.events, "escape-artist"));
		assert.equal(id(r.state, "e2"), id(state, "e1"));
		assert.equal(r.state.players.w.king, false);
	});
});
