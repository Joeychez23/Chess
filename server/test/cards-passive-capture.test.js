/*
 *  cards-passive-capture.test.js  --  chess cards engine tests
 *	The passives triggered by captures and checks (cards-engine/cards/passive/): trigger and non-trigger cases, one describe per card.
 *
 */

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const { newGame, legalActions, applyAction, actionKey, playerView, playerEvents } = require("../../cards-engine/index.js");
const { fromFen, sqIndex } = require("../../cards-engine/board.js");
const { legalMoves, inCheck } = require("../../cards-engine/rules.js");
const { makeCtx } = require("../../cards-engine/ctx.js");
const statuses = require("../../cards-engine/statuses.js");
const { register, reset } = require("../../cards-engine/cards/index.js");

reset(); // THE ENGINE ENTRY REGISTERS EVERY CARD: THESE TESTS DRAW FROM ONLY THE CARDS THEY REGISTER

const KEYS = ["last-rites", "unjust-retribution", "reinforcements", "retaliation", "bleeding-hand", "hex", "spite", "bounty", "bad-omen", "overwatch", "escape-artist", "grace"];
for (const key of KEYS) register(require("../../cards-engine/cards/passive/" + key + ".js"));
for (const key of ["t-pass", "t-pass2"]) register({ key, kind: "active", name: key, rarity: "common", text: "", targets: () => [null], play: () => {} });
register({ key: "t-curse", kind: "curse", name: "t-curse", rarity: "common", text: "" });
register({ key: "t-kingguard", kind: "passive", name: "t-kingguard", rarity: "common", text: "", rules: { canCapture: (s, a, t, src) => !(t.t === "k" && t.c === src.owner) } }); // ONLY THE OWNER'S KING SHIELDED: CASTLING PAST A WATCHED SQUARE
register({ key: "t-guard", kind: "passive", name: "t-guard", rarity: "common", text: "", rules: { canCapture: (s, a, t, src) => t.c !== src.owner } }); // A CAPTURE RULE (LIKE HEAVY CAVALRY'S), NOT A STATUS

let n = 0;
const ofType = (events, type) => events.filter((e) => e.type === type);
const id = (s, sq) => s.board.sq[sqIndex(sq)].id;
const mv = (piece, cid) => ({ id: cid, key: "move", piece });
const fired = (events, key) => events.some((e) => e.type === "passive-fired" && e.card.key === key);
const waits = (s, key) => s.effects.some((e) => e.card.key === key);
const cardless = (s, c) => legalActions(s, c).filter((a) => a.type === "move" && a.card === null);

/**
 * @description A game on this FEN with empty hands (King cards kept).
 */
function game(fen) {
	const s = newGame({ cardGuy: "b", level: 1300, seed: 1 });
	s.board = fromFen(fen);
	for (const c of ["w", "b"]) Object.assign(s.players[c], { moves: [], actives: [], passive: null });
	return s;
}

/**
 * @description Place passive key for owner in Board Effects; returns its entry.
 */
function place(s, key, owner) {
	const cid = "c" + (800 + ++n), e = { id: cid, owner, card: { id: cid, key }, placedAt: s.ply };
	s.effects.push(e);
	return e;
}

/**
 * @description color spends its turn on a no-op active; returns { state, events }.
 */
function pass(s, color) {
	const card = { id: "c" + (900 + ++n), key: "t-pass" };
	s.players[color].actives = [card];
	return applyAction(s, color, { type: "active", card: card.id });
}

/**
 * @description White's pawn card t1 takes e4xd5 on this FEN, with the passive key placed for owner; returns { s, state, events }.
 */
function takeD5(fen, key, owner, setup) {
	const s = game(fen);
	s.players.w.moves = [mv("p", "t1")];
	if (key) place(s, key, owner);
	if (setup) setup(s);
	return { s, ...applyAction(s, "w", { type: "move", card: "t1", from: "e4", to: "d5" }) };
}

const PAWN = "4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1";
const KNIGHT = "4k3/8/8/3n4/4P3/8/8/4K3 w - - 0 1";
const QUEEN = "4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1";

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

describe("Grace", () => {
	const MATE = "3rkr2/3p1p2/8/8/8/8/8/R5K1 w - - 0 1"; // Ra1-e1 MATES
	const setup = () => {
		const s = game(MATE);
		s.players.w.moves = [mv("r", "c61")];
		s.players.b.actives = [{ id: "c62", key: "t-pass" }];
		place(s, "grace", "b");
		return s;
	};
	const MATING = { type: "move", card: "c61", from: "a1", to: "e1" };

	test("a mating move is taken back once: the state before it, Grace used, the opponent +1 active, the move barred this turn only; a second mate goes through", () => {
		const s = setup(), { state, events } = applyAction(s, "w", MATING);
		assert.equal(state.result, null);
		assert.deepEqual(events.map((e) => e.type), ["move", "passive-fired", "draw", "move-undone"]);
		assert.deepEqual(state.board, s.board);
		assert.deepEqual(state.players.b.moves, s.players.b.moves);
		assert.deepEqual(state.players.b.actives, s.players.b.actives);
		assert.deepEqual(state.players.w.moves, s.players.w.moves);
		assert.equal(state.players.w.actives.length, 1);
		assert.ok(["t-pass", "t-pass2"].includes(state.players.w.actives[0].key));
		assert.ok(!waits(state, "grace"));
		assert.deepEqual(state.players.b.used, ["grace"]);
		assert.equal(state.barred, actionKey({ type: "move", from: "a1", to: "e1" })); // THE MOVE, WHATEVER THE CARD
		assert.notDeepEqual(state.rng, s.rng); // KEPT ADVANCED
		assert.ok(!legalActions(state, "w").some((a) => actionKey(a) === actionKey(MATING)));
		assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
		const t = applyAction(state, "w", { type: "move", card: "king", from: "g1", to: "h1" }).state;
		const u = pass(t, "b").state;
		u.players.w.moves.push(mv("r", "c61"));
		assert.ok(legalActions(u, "w").some((a) => actionKey(a) === actionKey(MATING)));
		const end = applyAction(u, "w", MATING);
		assert.deepEqual(end.state.result, { winner: "w", reason: "checkmate" });
	});

	test("no trigger: a mate against a player without Grace, or a non-mating move", () => {
		const s = setup();
		s.effects[0].owner = "w";
		assert.equal(applyAction(s, "w", MATING).state.result.reason, "checkmate");
		const t = setup(), r = applyAction(t, "w", { type: "move", card: "c61", from: "a1", to: "b1" });
		assert.ok(waits(r.state, "grace") && !fired(r.events, "grace"));
	});

	test("the same move with another card of the type, the King card or cardless stays barred; the mater's card stays hidden", () => {
		const s = setup();
		s.players.w.moves.push(mv("r", "c65"));
		const { state, events } = applyAction(s, "w", MATING);
		assert.equal(state.result, null);
		assert.ok(!legalActions(state, "w").some((a) => a.type === "move" && a.from === "a1" && a.to === "e1"));
		for (const ev of playerEvents(state, events, "b")) assert.ok(!(ev.card && typeof ev.card === "object" && ev.card.id === "c61")); // c61 IS BACK IN WHITE'S HAND
		assert.equal(events[0].card, "move");
	});

	test("the barred move was the only answer and the redraw gives none: checkmate by the cards", () => {
		const s = game("3rkr2/3p1p2/8/8/8/3n4/4P3/2K1R3 w - - 0 1"); // IN CHECK; exd3 IS THE ONE ANSWER AND MATES
		Object.assign(s.players.w, { king: false, moves: [mv("p", "c63")] });
		place(s, "grace", "b");
		const a = { type: "move", card: "c63", from: "e2", to: "d3" };
		assert.deepEqual(legalActions(s, "w"), [a]);
		const { state, events } = applyAction(s, "w", a);
		assert.ok(ofType(events, "redraw").some((e) => e.player === "w"));
		assert.deepEqual(state.result, { winner: "b", reason: "checkmate" }); // THE NEW PAWN CARDS MAY NOT PLAY THE BARRED exd3 EITHER
		assert.ok(ofType(events, "game-over").length === 1);
	});

	test("the barred move was the only answer: the move cards are redrawn and the game goes on with another answer", () => {
		const s = game("3rkr2/3p1p2/8/8/8/3n4/4P3/1BK1R3 w - - 0 1"); // Bb1xd3 ANSWERS TOO, BUT WHITE HOLDS NO KNIGHT / BISHOP CARD
		Object.assign(s.players.w, { king: false, moves: [mv("p", "c63")] });
		place(s, "grace", "b");
		const { state, events } = applyAction(s, "w", { type: "move", card: "c63", from: "e2", to: "d3" });
		assert.ok(ofType(events, "redraw").some((e) => e.player === "w"));
		assert.ok(state.players.w.moves.some((c) => c.piece === "m"), "this test needs seed 1's redraw to hold a Knight / Bishop card: pick another seed if the rng use before it changed");
		assert.equal(state.result, null);
		assert.ok(!state.players.w.moves.some((c) => c.id === "c63"));
		assert.ok(legalActions(state, "w").some((a) => a.from === "b1" && a.to === "d3"));
	});

	test("Grace taking back a mating choice leaves the choice open: no redraw and no stalemate for a player with no turn action", () => {
		// WHITE Ka1 HAS NO MOVE (Qc2) AND NO PLAYABLE CARD; OPTION x DROPS A KNIGHT ON f7: SMOTHERED MATE
		register({ key: "t-choose", kind: "active", name: "t-choose", rarity: "common", text: "", targets: () => [], play: () => {},
			choice: { resolve(ctx, pend, option) { if (option === "x") ctx.state.board.sq[sqIndex("f7")] = { id: "w16", t: "n", c: "w" }; } } });
		const s = game("6rk/6pp/8/8/8/8/2q5/K7 w - - 0 1");
		Object.assign(s.players.w, { king: false, moves: [], actives: [{ id: "d0", key: "t-choose" }, { id: "d1", key: "t-choose" }, { id: "d2", key: "t-choose" }] });
		place(s, "grace", "b");
		s.pending = { player: "w", kind: "t", options: ["x", "y"], card: "t-choose", turn: "w", end: true };
		const { state, events } = applyAction(s, "w", { type: "choice", option: "x" });
		assert.ok(fired(events, "grace"));
		assert.equal(state.result, null);
		assert.deepEqual(ofType(events, "redraw"), []);
		assert.deepEqual(legalActions(state, "w"), [{ type: "choice", option: "y" }]);
	});

	test("a check that stood before the undone move is not announced again by the undo (graceUndo's ctx.stood)", () => {
		// DOUBLE TIME'S FIRST MOVE Bd4-e5 CHECKS h8; THE ONLY SECOND MOVE Ra1-a2 LEAVES BLACK (NO SKULL) MATED
		const s = game("6bk/7p/8/8/3B4/P7/8/RN2K3 w - - 0 1");
		Object.assign(s.players.w, { king: false, moves: [mv("m", "c71"), mv("r", "c72")] });
		s.players.b.kingSkulls = 0;
		place(s, "grace", "b");
		s.multi = { player: "w", left: 2, moved: [], differ: true };
		const first = applyAction(s, "w", { type: "move", card: "c71", from: "d4", to: "e5" });
		assert.deepEqual(ofType(first.events, "check"), [{ type: "check", player: "b" }]);
		const { events } = applyAction(first.state, "w", { type: "move", card: "c72", from: "a1", to: "a2" });
		assert.ok(fired(events, "grace"));
		assert.deepEqual(ofType(events, "check"), []);
	});

	test("a pending choice's barred option is left out while another remains", () => {
		const s = game(MATE);
		s.pending = { player: "w", kind: "t", options: ["x", "y"], card: "t-pass", turn: "w" };
		s.barred = actionKey({ type: "choice", option: "x" });
		assert.deepEqual(legalActions(s, "w"), [{ type: "choice", option: "y" }]);
		s.pending.options = ["x"];
		assert.deepEqual(legalActions(s, "w"), [{ type: "choice", option: "x" }]); // A CHOICE MUST BE ANSWERED
	});

	test("the barred move was the only second move of a two-move turn: the turn ends", () => {
		const s = game("kr6/1p6/8/8/1P6/2P5/N7/R6K w - - 0 1"); // Na2-c1 DISCOVERS MATE
		Object.assign(s.players.w, { king: false, moves: [mv("m", "c64")] });
		s.multi = { player: "w", left: 1, moved: [], differ: false };
		place(s, "grace", "b");
		const { state } = applyAction(s, "w", { type: "move", card: "c64", from: "a2", to: "c1" });
		assert.equal(state.result, null);
		assert.equal(state.board.turn, "b");
		assert.equal(state.multi, null);
		assert.equal(state.board.sq[sqIndex("a2")].t, "n");
	});
});

describe("Removals, card-effect captures and edge cases", () => {
	/**
	 * @description A game on fen with key placed for owner; ctx.capture(player, the piece on sq); returns { s, ctx }.
	 */
	const remove = (fen, key, owner, player, sq, setup) => {
		const s = game(fen);
		place(s, key, owner);
		if (setup) setup(s);
		const ctx = makeCtx(s);
		ctx.capture(player, id(s, sq));
		return { s, ctx };
	};

	test("a removal is not a capture: a piece its own side gives up fires none of Reinforcements, Spite, Bad Omen, Bleeding Hand, Unjust Retribution", () => {
		const PQ = "4k3/7p/8/3q4/3p4/8/8/4K3 b - - 0 1";
		for (const [key, sq] of [["reinforcements", "d4"], ["spite", "d5"], ["bad-omen", "d5"], ["unjust-retribution", "d4"]]) {
			const { s, ctx } = remove(PQ, key, "b", "b", sq, (t) => { t.players.w.moves = [mv("p", "c74")]; });
			assert.ok(waits(s, key), key);
			assert.deepEqual(ctx.events.map((e) => e.type), ["capture"], key);
		}
		const { s, ctx } = remove(PQ, "bleeding-hand", "w", "b", "d5", (t) => { t.players.b.moves = [mv("p", "c74")]; });
		assert.ok(waits(s, "bleeding-hand"));
		assert.deepEqual(ctx.events.map((e) => e.type), ["capture"]);
	});

	test("a card-effect capture by the opponent fires Reinforcements, Spite, Bad Omen, Bounty and Unjust Retribution", () => {
		const r = remove("4k3/7p/8/3p4/8/8/8/4K3 w - - 0 1", "reinforcements", "b", "w", "d5");
		assert.ok(!waits(r.s, "reinforcements") && r.s.players.b.moves.length === 1);
		const sp = remove(QUEEN, "spite", "b", "w", "d5", (t) => { t.players.w.moves = [mv("p", "c75")]; });
		assert.ok(!waits(sp.s, "spite") && ofType(sp.ctx.events, "redraw").length === 1);
		const bo = remove(QUEEN, "bad-omen", "b", "w", "d5");
		assert.deepEqual(bo.s.players.w.curses.map((c) => c.key), ["t-curse"]);
		const bt = remove(QUEEN, "bounty", "w", "w", "d5", (t) => { t.players.b.moves = [mv("p", "c76")]; });
		assert.ok(bt.s.players.w.moves.some((c) => c.id === "c76"));
		const ur = remove("4k3/8/8/8/3p4/8/8/4K3 w - - 0 1", "unjust-retribution", "b", "w", "d4");
		assert.ok(!waits(ur.s, "unjust-retribution"));
		assert.equal(ur.s.players.w.lostTurns, 1);
	});

	test("Unjust Retribution: a White owner; a capturer its own Overwatch shot first still counts; en passant never fires it", () => {
		const s = game("4k3/8/4p3/3P4/8/8/8/4K3 b - - 0 1");
		s.players.b.moves = [mv("p", "t1")];
		place(s, "unjust-retribution", "w");
		const w = applyAction(s, "b", { type: "move", card: "t1", from: "e6", to: "d5" });
		assert.ok(fired(w.events, "unjust-retribution"));
		assert.equal(w.state.players.b.lostTurns, 1);
		const t = game("4k3/8/5b2/8/3p4/4P3/8/4K3 w - - 0 1"); // Bf6 WATCHES d4
		t.players.w.moves = [mv("p", "t1")];
		place(t, "overwatch", "b");
		place(t, "unjust-retribution", "b");
		const o = applyAction(t, "w", { type: "move", card: "t1", from: "e3", to: "d4" });
		assert.ok(fired(o.events, "overwatch") && fired(o.events, "unjust-retribution"));
		assert.equal(o.state.players.w.lostTurns, 1);
		const e = game("4k3/7p/8/3pP3/8/8/8/4K3 w - d6 0 1");
		e.players.w.moves = [mv("p", "t1")];
		place(e, "unjust-retribution", "b");
		place(e, "reinforcements", "b");
		const ep = applyAction(e, "w", { type: "move", card: "t1", from: "e5", to: "d6" });
		assert.ok(fired(ep.events, "reinforcements")); // EN PASSANT IS A PAWN CAPTURE
		assert.ok(!fired(ep.events, "unjust-retribution") && ep.state.players.w.lostTurns === 0); // THE PAWN STOOD ON ITS OWN HALF
	});

	test("Retaliation does not arm on a capturer the owner's own Overwatch already shot", () => {
		const s = game("4k3/1b5p/8/3p4/4P3/8/8/4K3 w - - 0 1") // Bb7 WATCHES d5;
		s.players.w.moves = [mv("p", "t1")];
		place(s, "overwatch", "b");
		const ret = place(s, "retaliation", "b");
		const r = applyAction(s, "w", { type: "move", card: "t1", from: "e4", to: "d5" });
		assert.ok(fired(r.events, "overwatch"));
		const card = r.state.effects.find((e) => e.id === ret.id).card;
		assert.equal(card.target, undefined);
		const next = pass(r.state, "b");
		assert.ok(!ofType(next.events, "discard").some((e) => e.player === "b") && waits(next.state, "retaliation"));
	});

	test("a capture on the first move of a two-move turn fires at once and the turn goes on", () => {
		const s = game(PAWN);
		s.players.w.moves = [mv("p", "t1")];
		s.multi = { player: "w", left: 2, moved: [], differ: false };
		place(s, "last-rites", "b");
		const { state, events } = applyAction(s, "w", { type: "move", card: "t1", from: "e4", to: "d5" });
		assert.ok(fired(events, "last-rites"));
		assert.equal(state.board.turn, "w");
		assert.equal(state.multi.left, 1);
	});

	test("Bounty: a stolen card over the cap is lost; Spite with no active held loses nothing", () => {
		const { state, events } = takeD5(QUEEN, "bounty", "w", (s) => {
			for (let i = 0; i < 9; i++) s.players.w.moves.push(mv("p", "c" + (50 + i)));
			s.players.b.moves = [mv("p", "c71")];
		});
		assert.deepEqual(ofType(events, "card-taken").map((e) => [e.card.id, e.lost]), [["c71", true]]);
		assert.ok(!state.players.w.moves.some((c) => c.id === "c71") && !state.players.b.moves.length);
		const sp = takeD5(QUEEN, "spite", "b");
		assert.ok(fired(sp.events, "spite"));
		assert.ok(!ofType(sp.events, "discard").some((e) => e.player === "b"));
	});

	test("Overwatch watches a castling rook's landing square", () => {
		const s = game("4k3/7p/8/1b6/8/8/8/4K2R w K - 0 1"), rook = id(s, "h1");
		place(s, "overwatch", "b");
		place(s, "t-kingguard", "w"); // THE BISHOP CAN'T TAKE THE KING, SO f1 IS NOT ATTACKED FOR CASTLING
		const { state, events } = applyAction(s, "w", { type: "move", card: "king", from: "e1", to: "g1" });
		assert.ok(fired(events, "overwatch"));
		assert.ok(ofType(events, "capture").some((e) => e.piece === rook));
		assert.equal(state.board.sq[sqIndex("f1")], null);
	});

	test("Escape Artist: a Hexed piece may escape without a card; a check raised mid-turn counts", () => {
		const s = checked2();
		s.statuses[id(s, "h4")] = [{ s: "hexed", left: 2, by: "b" }];
		assert.ok(cardless(s, "w").some((a) => a.from === "h4" && a.to === "e7"));
		const t = game("k3r3/8/8/8/8/8/4R3/2b1K3 w - - 0 1"); // Re2-e3 IS SHOT BY Bc1, OPENING THE e-FILE ON WHITE'S KING
		t.players.w.moves = [mv("r", "t1")];
		t.multi = { player: "w", left: 2, moved: [], differ: false };
		place(t, "overwatch", "b");
		place(t, "escape-artist", "w");
		const first = applyAction(t, "w", { type: "move", card: "t1", from: "e2", to: "e3" });
		assert.ok(inCheck(first.state, "w") && first.state.board.turn === "w");
		const r = applyAction(first.state, "w", { type: "move", card: null, from: "e1", to: "f1" });
		assert.ok(fired(r.events, "escape-artist"));
	});
});

/**
 * @description Black's Rd8-e8 checks White (Escape Artist placed for White); returns the state.
 */
function checked2() {
	const s = game("k2r4/8/8/8/7B/8/8/1R2K3 b - - 0 1");
	s.players.b.moves = [mv("r", "t1")];
	place(s, "escape-artist", "w");
	return applyAction(s, "b", { type: "move", card: "t1", from: "d8", to: "e8" }).state;
}

describe("a Mulligan turn left with no move (after Mulligan the turn is one move; user ruling 2026-11-21, call 4)", () => {
	const FEN = "5rkb/8/6KP/8/8/8/8/1N6 w - - 0 1"; // h6-h7 MATES AND IS THE PAWN'S ONLY MOVE; THE KNIGHT COULD MOVE, BUT WHITE HOLDS 2 PAWN CARDS AND NO KING CARD
	const setup = (discarded) => {
		const s = game(FEN);
		Object.assign(s.players.w, { king: false, moves: [mv("p", "c63"), mv("p", "c64")] });
		s.multi = { player: "w", left: 1, moved: [], differ: false, mulled: true }; // AS mulligan.js LEAVES IT
		s.discarded = discarded ? "w" : null;
		return s;
	};
	const redrawn = ({ state, events }) => {
		assert.ok(ofType(events, "redraw").some((e) => e.player === "w"), "no automatic redraw");
		assert.deepEqual([state.result, state.board.turn], [null, "w"]);
		assert.ok(legalActions(state, "w").some((a) => a.type === "move" && a.from === "b1"), "this test needs the redraw to hold a knight card: pick another seed if the rng use before it changed");
	};

	for (const discarded of [false, true]) {
		const name = discarded ? "the free discard used" : "the free discard unused";
		test("Grace takes back the only move, " + name + ": the automatic redraw at once", () => {
			const s = setup(discarded);
			place(s, "grace", "b");
			const r = applyAction(s, "w", { type: "move", card: "c63", from: "h6", to: "h7" });
			assert.ok(fired(r.events, "grace"));
			redrawn(r);
		});

		test("a choice resolved with no move left, " + name + ": the automatic redraw at once", () => {
			register({ key: "t-ask", kind: "active", name: "t-ask", rarity: "common", text: "", targets: () => [], play: () => {}, choice: { resolve() {} } }); // HERE, NOT AT LOAD: THE GRACE TESTS ABOVE DRAW THEIR ACTIVE FROM THE REGISTRY
			const s = setup(discarded);
			s.statuses[id(s, "h6")] = [{ s: "hexed", left: 2, by: "b" }]; // NO CARD MOVES THE PAWN
			s.pending = { player: "w", kind: "t", options: ["x", "y"], card: "t-ask", turn: "w" };
			redrawn(applyAction(s, "w", { type: "choice", option: "y" }));
		});
	}
});
