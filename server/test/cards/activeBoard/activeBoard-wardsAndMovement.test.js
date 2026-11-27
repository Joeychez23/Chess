/*
 *  activeBoard-wardsAndMovement.test.js  --  chess cards engine tests
 *	The board actives that ward pieces or change how they move (cards-engine/cards/active/): Stronghold, Heavy Cavalry, Heretical Subjection and Last Stand: targets, effect, debuff and edge cases, one describe per card.
 *
 */

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const { legalActions, applyAction, KING_SKULLS, sqIndex, legalMoves, inCheck, makeCtx, startTurn, statuses, ofType, id, sqOf, has, actives, captures, game, play, pass, cardPlay, chess } = require("../../helpers/activeBoard.js");

describe("Stronghold", () => {
	const FEN = "3k4/8/8/8/3n2b1/8/2P5/K2R4 w - - 0 1";

	test("targets: every own non-king piece; none with only the king", () => {
		const s = game(FEN, "stronghold");
		assert.deepEqual(actives(s).map((a) => sqOf(s, a.target.piece)).sort(), ["c2", "d1"]);
		const bare = game("3k4/8/8/8/8/8/8/K7 w - - 0 1", "stronghold");
		assert.deepEqual(actives(bare), []);
	});

	test("the piece is Warded for good and can't attack: no capture, no check", () => {
		const s = game(FEN, "stronghold"), rook = id(s, "d1");
		assert.ok(captures(s, "w", "d1", "d4") && captures(s, "b", "g4", "d1")); // BEFORE
		const { state, events } = play(s, { piece: rook });
		assert.deepEqual(state.statuses[rook].map((e) => [e.s, e.left]), [["warded", null]]);
		assert.deepEqual(state.enchant.map((e) => [e.key, e.owner, e.pieces]), [["stronghold", "w", [rook]]]);
		assert.equal(ofType(events, "enchant").length, 1);
		assert.ok(!captures(state, "b", "g4", "d1")); // WARDED
		const w = JSON.parse(JSON.stringify(state));
		w.board.turn = "w";
		assert.ok(!captures(w, "w", "d1", "d4")); // CAN'T CAPTURE
		assert.ok(legalMoves(w, "w").some((m) => m.from === "d1" && m.to === "d3")); // STILL MOVES
		// GIVES NO CHECK: THE ROOK ON THE BLACK KING'S FILE
		const chk = JSON.parse(JSON.stringify(state));
		chk.board.sq[sqIndex("d4")] = null;
		assert.equal(inCheck(chk, "b"), false);
		chk.enchant = [];
		assert.equal(inCheck(chk, "b"), true);
		// WARDED FOR GOOD: STILL THERE MANY TURNS LATER
		let t = state;
		for (let i = 0; i < 4; i++) t = pass(pass(t, "b"), "w");
		assert.ok(has(t, rook, "warded"));
	});

	test("played on a second piece, the protection moves to it", () => {
		const s = game(FEN, "stronghold"), rook = id(s, "d1"), pawn = id(s, "c2");
		let t = pass(play(s, { piece: rook }).state, "b");
		t.players.w.actives = [{ id: "c91", key: "stronghold" }];
		assert.deepEqual(actives(t).map((a) => a.target.piece), [pawn]); // NOT THE PIECE THAT ALREADY HAS IT
		const { state, events } = play(t, { piece: pawn }, "c91");
		assert.ok(has(state, pawn, "warded") && !has(state, rook, "warded"));
		assert.deepEqual(state.enchant.map((e) => [e.key, e.pieces]), [["stronghold", [pawn]]]);
		assert.equal(ofType(events, "enchant-ended").length, 1);
		state.board.turn = "w";
		assert.ok(captures(state, "w", "d1", "d4")); // THE ROOK MAY CAPTURE AGAIN
	});

	test("Cleanse removes it: the Warded status ending ends the Stronghold", () => {
		const s = game(FEN, "stronghold"), rook = id(s, "d1");
		const ctx = makeCtx(play(s, { piece: rook }).state);
		statuses.clear(ctx, rook, "warded");
		assert.deepEqual(ctx.state.enchant, []);
		assert.deepEqual(ofType(ctx.events, "enchant-ended").map((e) => e.key), ["stronghold"]);
		ctx.state.board.turn = "w";
		assert.ok(captures(ctx.state, "w", "d1", "d4"));
	});

	test("a card capture of the piece ends it and leaves no Warded", () => {
		const s = game(FEN, "stronghold"), rook = id(s, "d1");
		const ctx = makeCtx(play(s, { piece: rook }).state);
		assert.equal(ctx.capture("b", rook), true);
		assert.deepEqual([ctx.state.enchant, ctx.state.statuses], [[], {}]);
	});

	test("ends when its piece changes sides: the entry and its Warded go", () => {
		const s = game(FEN, "stronghold"), rook = id(s, "d1");
		const ctx = makeCtx(play(s, { piece: rook }).state);
		ctx.state.board.sq[sqIndex("d1")].c = "b";
		startTurn(ctx, ctx.state.board.turn);
		assert.deepEqual(ctx.state.enchant, []);
		assert.ok(!has(ctx.state, rook, "warded"));
		// A move EVENT ALONE ENDS IT TOO, WITH NO TURN START
		const m = makeCtx(play(game(FEN, "stronghold"), { piece: rook }).state);
		m.state.board.sq[sqIndex("d1")].c = "b";
		m.emit({ type: "move", player: "b", card: null, piece: rook, from: "d1", to: "d1" });
		assert.deepEqual(m.state.enchant, []);
		assert.ok(!has(m.state, rook, "warded"));
	});

	test("common version: Warded, can't attack and can't move; it still blocks", () => {
		const s = game(FEN, "stronghold-common"), rook = id(s, "d1");
		const { state } = play(s, { piece: rook });
		assert.deepEqual(state.enchant.map((e) => [e.key, e.pieces]), [["stronghold-common", [rook]]]);
		assert.ok(has(state, rook, "warded") && !captures(state, "b", "g4", "d1"));
		const w = JSON.parse(JSON.stringify(state));
		w.board.turn = "w";
		assert.ok(!legalMoves(w, "w").some((m) => m.from === "d1"));
		assert.ok(legalMoves(w, "w").some((m) => m.from === "c2"));
		w.board.sq[sqIndex("h1")] = { id: "b16", c: "b", t: "r" };
		assert.ok(!inCheck(w, "w")); // THE ROOK STILL STANDS BETWEEN h1 AND THE KING
	});

	test("common version: no cardless move either (Heretical Subjection's bishop)", () => {
		let s = game("3k4/p7/8/8/8/8/P7/K1B5 w - - 0 1");
		const bishop = id(s, "c1"), from = (t) => legalActions(t, "w").filter((a) => a.type === "move" && a.from === "c1");
		s = pass(cardPlay(s, "w", "heretical-subjection").state, "b");
		assert.ok(from(s).some((a) => a.card === null));
		s = pass(cardPlay(s, "w", "stronghold-common", { piece: bishop }).state, "b");
		assert.deepEqual(from(s), []);
	});

	test("common version: Swap can still move the piece, and the Stronghold stays", () => {
		const s = game("3k4/8/8/8/8/8/8/K2R3N w - - 0 1", "stronghold-common"), rook = id(s, "d1"), knight = id(s, "h1");
		const t = pass(play(s, { piece: rook }).state, "b");
		t.players.w.actives = [{ id: "c91", key: "swap" }];
		assert.ok(actives(t).some((a) => a.target.pieces.includes(rook)));
		const { state } = play(t, { pieces: [rook, knight] }, "c91");
		assert.equal(sqOf(state, rook), "h1");
		assert.deepEqual(state.enchant.map((e) => [e.key, e.pieces]), [["stronghold-common", [rook]]]);
		assert.ok(has(state, rook, "warded"));
	});

	test("common and base versions count as one Stronghold: playing one on another piece moves the protection", () => {
		const s = game(FEN, "stronghold-common"), rook = id(s, "d1"), pawn = id(s, "c2");
		const t = pass(play(s, { piece: rook }).state, "b");
		t.players.w.actives = [{ id: "c91", key: "stronghold" }];
		assert.deepEqual(actives(t).map((a) => a.target.piece), [pawn]);
		const { state } = play(t, { piece: pawn }, "c91");
		assert.deepEqual(state.enchant.map((e) => [e.key, e.pieces]), [["stronghold", [pawn]]]);
		assert.ok(!has(state, rook, "warded"));
		state.board.turn = "w";
		assert.ok(legalMoves(state, "w").some((m) => m.from === "d1"));
	});
});

describe("Heavy Cavalry", () => {
	// ONE CARD, ONE KNIGHT (USER RULING 2026-11-25: THE TWO-KNIGHT BASE CARD, ITS MARKED PARTNER AND ITS SWITCH ARE GONE; THIS WAS THE EPIC VERSION)
	// ONE KNIGHT c3; PAWN e2 ON A SQUARE IT COVERS (BLACK BISHOP g4 ATTACKS IT); BISHOP e7 BY THE e8 ROOK, A SQUARE d5 COVERS
	const ONE = "4r2k/4B3/8/8/6b1/2N5/P3P3/7K w - - 0 1";
	// KNIGHTS c3 AND e4 (e4 IS A c3 KNIGHT SQUARE); BLACK ROOK e8 ATTACKS THE e4 KNIGHT
	const TWO = "4r2k/8/8/8/4N1b1/2N5/P3P3/7K w - - 0 1";
	const HC = require("../../../../cards-engine/cards/active/heavy-cavalry.js");

	test("epic, 2 skulls, no version; targets: any own knight in no entry, alone; a knight already in an entry is not offered again; none with no knight", () => {
		assert.deepEqual([HC.rarity, HC.skulls, HC.versions], ["epic", 2, undefined]);
		const s = game(ONE, "heavy-cavalry");
		assert.deepEqual(actives(s).map((a) => sqOf(s, a.target.piece)), ["c3"]);
		assert.deepEqual(actives(game("4r2k/8/8/8/6b1/8/P3P3/7K w - - 0 1", "heavy-cavalry")), []);
		const two = game(TWO, "heavy-cavalry");
		assert.deepEqual(actives(two).map((a) => sqOf(two, a.target.piece)).sort(), ["c3", "e4"]);
		const t = pass(play(two, { piece: id(two, "c3") }).state, "b");
		t.players.w.actives = [{ id: "c91", key: "heavy-cavalry" }];
		assert.deepEqual(actives(t).map((a) => sqOf(t, a.target.piece)), ["e4"]);
		const u = pass(play(t, { piece: id(t, "e4") }, "c91").state, "b");
		u.players.w.actives = [{ id: "c92", key: "heavy-cavalry" }];
		assert.deepEqual(actives(u), []); // BOTH KNIGHTS IN AN ENTRY
		assert.deepEqual(u.enchant.map((e) => e.pieces.length), [1, 1]);
	});

	test("the knight is enchanted and Wards the friendly non-king pieces it covers, another knight too; nothing is Marked; no switch", () => {
		const s = game(ONE, "heavy-cavalry"), n = id(s, "c3");
		assert.ok(captures(s, "b", "g4", "e2"));
		const { state, events } = play(s, { piece: n });
		assert.deepEqual(state.enchant.map((e) => [e.key, e.pieces]), [["heavy-cavalry", [n]]]);
		assert.deepEqual([state.statuses, ofType(events, "status")], [{}, []]);
		assert.ok(!captures(state, "b", "g4", "e2"));
		assert.ok(!legalActions(pass(state, "b"), "w").some((a) => a.type === "switch"));
		const two = game(TWO, "heavy-cavalry");
		assert.ok(captures(two, "b", "e8", "e4"));
		assert.ok(!captures(play(two, { piece: id(two, "c3") }).state, "b", "e8", "e4")); // NO PARTNER LEFT OUT: e4 IS A c3 SQUARE
	});

	test("lasts while the knight is on the board: a move keeps it (the Ward follows), a capture ends it", () => {
		const s = game(ONE, "heavy-cavalry"), n = id(s, "c3");
		const t = pass(play(s, { piece: n }).state, "b");
		assert.ok(captures(t, "b", "e8", "e7"));
		const r = chess(t, "w", "c3", "d5");
		assert.equal(r.state.enchant.length, 1);
		assert.ok(!captures(r.state, "b", "e8", "e7") && captures(r.state, "b", "g4", "e2"));
		const ctx = makeCtx(r.state);
		assert.equal(ctx.capture("b", n), true);
		assert.deepEqual(ctx.state.enchant, []);
		assert.deepEqual(ofType(ctx.events, "enchant-ended").map((e) => e.key), ["heavy-cavalry"]);
	});

	test("each end path alone: a capture, a handover, a promotion in place (a duel upgrade), a turn start (gone with no event); a move alone keeps it", () => {
		const g = game(ONE, "heavy-cavalry"), n = id(g, "c3"), st = play(g, { piece: n }).state;
		const copy = () => makeCtx(JSON.parse(JSON.stringify(st)));
		let ctx = copy(); // move ONLY: IT STANDS
		ctx.state.board.sq[sqIndex("b5")] = ctx.state.board.sq[sqIndex("c3")]; ctx.state.board.sq[sqIndex("c3")] = null;
		ctx.emit({ type: "move", player: "w", card: null, piece: n, from: "c3", to: "b5" });
		assert.equal(ctx.state.enchant.length, 1);
		ctx = copy(); // capture ONLY
		assert.equal(ctx.capture("b", n), true);
		assert.deepEqual(ctx.state.enchant, []);
		ctx = copy(); // handover ONLY (OPPOSING FINALITY)
		ctx.state.board.sq[sqIndex("c3")].c = "b";
		ctx.emit({ type: "handover", player: "b", piece: n, from: "c3", to: "c3" });
		assert.deepEqual(ctx.state.enchant, []);
		ctx = copy(); // promote ONLY
		ctx.state.board.sq[sqIndex("c3")].t = "r";
		ctx.emit({ type: "promote", player: "w", piece: n, t: "r" });
		assert.deepEqual(ctx.state.enchant, []);
		ctx = copy(); // turn-start ONLY: REMOVED WITH NO EVENT
		ctx.state.board.sq[sqIndex("c3")] = null;
		assert.equal(ctx.state.enchant.length, 1);
		startTurn(ctx, ctx.state.board.turn);
		assert.deepEqual(ctx.state.enchant, []);
	});

	test("touches no Mark: a timed Mark (Hexcraft's) on its knight runs down as before, Opposing Finality on the same knight stays live and Marked when Heavy Cavalry ends", () => {
		const s = game(ONE, "heavy-cavalry"), n = id(s, "c3");
		s.statuses[n] = [{ s: "marked", left: 2, by: "b" }];
		const plain = pass(JSON.parse(JSON.stringify(s)), "w").statuses; // THE SAME TURN WITH NO HEAVY CAVALRY
		const r = play(s, { piece: n });
		assert.deepEqual([r.state.statuses, ofType(r.events, "status")], [plain, []]);
		assert.deepEqual(r.state.statuses[n], [{ s: "marked", left: 1, by: "b" }]); // NOT TAKEN OVER: IT RAN DOWN AT THE TURN'S END
		let t;
		const o = game("4k3/p7/8/8/8/2N5/P7/4K3 w - - 0 1"), k = id(o, "c3"); // PAWNS: NO MATERIAL DRAW
		t = pass(cardPlay(o, "w", "opposing-finality", { piece: k }).state, "b");
		t = pass(cardPlay(t, "w", "heavy-cavalry", { piece: k }).state, "b");
		assert.deepEqual(t.enchant.map((e) => e.key), ["opposing-finality", "heavy-cavalry"]);
		t.board.sq[sqIndex("c3")].t = "r"; // HEAVY CAVALRY ENDS ON A PROMOTION IN PLACE; OPPOSING FINALITY DOESN'T
		const ctx = makeCtx(t);
		ctx.emit({ type: "promote", player: "w", piece: k, t: "r" });
		assert.deepEqual(ctx.state.enchant.map((e) => e.key), ["opposing-finality"]);
		assert.ok(has(ctx.state, k, "marked"));
		assert.deepEqual(ofType(ctx.events, "status-ended"), []);
	});

	test("Cleanse on the knight ends it (there is no Mark to remove)", () => {
		const s = game(ONE, "heavy-cavalry"), n = id(s, "c3");
		const t = pass(play(s, { piece: n }).state, "b");
		t.players.w.actives = [{ id: "c93", key: "cleanse" }];
		const a = legalActions(t, "w").filter((x) => x.type === "active");
		assert.deepEqual(a.map((x) => x.target.piece), [n]);
		const r = applyAction(t, "w", a[0]);
		assert.deepEqual(r.state.enchant, []);
		assert.ok(captures(pass(r.state, "b"), "b", "g4", "e2") || captures(r.state, "b", "g4", "e2"));
	});

	test("the rare Cleanse ends it too, with no status on the side", () => {
		const s = game(ONE, "heavy-cavalry"), n = id(s, "c3");
		const t = pass(play(s, { piece: n }).state, "b");
		t.players.w.actives = [{ id: "c93", key: "cleanse-rare" }];
		const a = legalActions(t, "w").filter((x) => x.type === "active");
		assert.equal(a.length, 1);
		assert.deepEqual(applyAction(t, "w", a[0]).state.enchant, []);
	});
});

describe("Heretical Subjection", () => {
	// c1 AND f1 BISHOPS HEMMED IN BY PAWNS; BLACK ROOK c2 ORTHOGONALLY BESIDE c1
	const FEN = "4k3/8/8/8/8/8/1PrPPPP1/2B1KB2 w - - 0 1";
	const cardless = (s) => legalActions(s, "w").filter((a) => a.type === "move" && a.card === null).map((a) => a.from + a.to).sort();

	test("targets: no target, needs a bishop", () => {
		assert.deepEqual(actives(game(FEN, "heretical-subjection")), [{ type: "active", card: "c90" }]);
		assert.deepEqual(actives(game("4k3/8/8/8/8/8/8/4K3 w - - 0 1", "heretical-subjection")), []);
	});

	test("for 3 turns both bishops move without a card, like a bishop or a king; then both are Shaken for 1 turn", () => {
		const s = game(FEN, "heretical-subjection"), b1 = id(s, "c1"), b2 = id(s, "f1");
		assert.deepEqual(cardless(s), []);
		let r = play(s);
		assert.deepEqual(r.state.enchant.map((e) => [e.key, e.pieces, e.left]), [["heretical-subjection", [b1, b2], 3]]);
		// TURN 1: KING STEPS (CHANGING SQUARE COLOUR), ONE OF THEM A CAPTURE
		let t = pass(r.state, "b");
		assert.deepEqual(cardless(t), ["c1b1", "c1c2", "c1d1", "f1g1"]);
		r = applyAction(t, "w", { type: "move", card: null, from: "c1", to: "c2" });
		assert.deepEqual(ofType(r.events, "capture").map((e) => [e.t, e.by]), [["r", b1]]);
		assert.equal(r.state.board.half, 0);
		// TURN 2: LIKE A BISHOP TOO
		t = pass(r.state, "b");
		assert.ok(cardless(t).includes("c2a4") && cardless(t).includes("c2c3"));
		t = pass(applyAction(t, "w", { type: "move", card: null, from: "c2", to: "d3" }).state, "b"); // NOT a4: CHECK ON e8
		// TURN 3: THE LAST ONE; IT ENDS AT ITS END
		assert.ok(cardless(t).length > 0);
		r = applyAction(t, "w", { type: "move", card: null, from: "f1", to: "g1" });
		assert.deepEqual(ofType(r.events, "enchant-ended").map((e) => e.key), ["heretical-subjection"]);
		assert.ok(has(r.state, b1, "shaken") && has(r.state, b2, "shaken"));
		// TURN 4: NO CARDLESS MOVES, SHAKEN; GONE AFTER IT
		t = pass(r.state, "b");
		assert.deepEqual(cardless(t), []);
		assert.ok(has(t, b1, "shaken") && has(t, b2, "shaken"));
		t = pass(t, "w");
		assert.ok(!has(t, b1, "shaken") && !has(t, b2, "shaken"));
	});

	test("a Hexed bishop keeps its cardless moves (Hex stops card moves only) and gets none from a bishop move card", () => {
		const s = game(FEN, "heretical-subjection"), b1 = id(s, "c1");
		const t = pass(play(s).state, "b");
		t.statuses[b1] = [{ s: "hexed", left: 2, by: "b" }];
		assert.deepEqual(cardless(t), ["c1b1", "c1c2", "c1d1", "f1g1"]);
		t.players.w.moves = [{ id: "c95", key: "move", piece: "m" }];
		const carded = legalActions(t, "w").filter((a) => a.card === "c95").map((a) => a.from);
		assert.ok(!carded.includes("c1") && carded.includes("f1"));
	});

	test("not offered again while it lasts", () => {
		const s = game(FEN, "heretical-subjection");
		const t = pass(play(s).state, "b");
		t.players.w.actives = [{ id: "c91", key: "heretical-subjection" }];
		assert.deepEqual(actives(t), []);
	});

	test("its end Shakes only bishops still the owner's; a bishop turned into another type has no cardless or king moves", () => {
		const s = game(FEN, "heretical-subjection"), b1 = id(s, "c1"), b2 = id(s, "f1");
		const ctx = makeCtx(play(s).state);
		ctx.state.board.sq[sqIndex("c1")].c = "b";
		ctx.endEnchant(ctx.state.enchant[0]);
		assert.ok(!has(ctx.state, b1, "shaken") && has(ctx.state, b2, "shaken"));
		const t = pass(play(game(FEN, "heretical-subjection")).state, "b");
		t.board.sq[sqIndex("c1")].t = "r"; // WHAT A DUEL'S UPGRADE DOES IN PLACE
		assert.deepEqual(cardless(t), ["f1g1"]);
		const HS = require("../../../../cards-engine/cards/active/heretical-subjection.js");
		assert.deepEqual(HS.rules.extraMoves(t, t.board.sq[sqIndex("c1")], t.enchant[0]), []); // NO KING STEPS FOR ANY CARD MOVE OF IT EITHER
		assert.ok(HS.rules.extraMoves(t, t.board.sq[sqIndex("f1")], t.enchant[0]).length > 0);
	});
});

describe("Last Stand", () => {
	const FEN = "k7/8/8/4p3/8/8/8/4K2R w K - 7 20";

	test("targets: the king's queen moves, never castling", () => {
		const s = game(FEN, "last-stand");
		const got = actives(s).map((a) => a.target.move.from + a.target.move.to).sort();
		const want = ["e2", "e3", "e4", "e5", "d2", "c3", "b4", "a5", "f2", "g3", "h4", "d1", "c1", "b1", "a1", "f1", "g1"].map((x) => "e1" + x).sort();
		assert.deepEqual(got, want);
		assert.ok(actives(s).every((a) => !a.target.move.castle));
	});

	test("can't be played by a Frozen king; never beside the other king", () => {
		const s = game(FEN, "last-stand");
		s.statuses[id(s, "e1")] = [{ s: "frozen", left: 2, by: "b" }];
		assert.deepEqual(actives(s), []);
		const near = game("8/4k3/8/8/8/8/8/4K3 w - - 0 1", "last-stand");
		const to = actives(near).map((a) => a.target.move.to);
		assert.ok(to.includes("e5") && !to.includes("e6") && !to.includes("d6") && !to.includes("f6"));
	});

	test("the king moves like a queen (a capture resets the half-move counter), then is Frozen for the next 2 turns", () => {
		const s = game(FEN, "last-stand"), k = id(s, "e1"), pawn = id(s, "e5");
		const { state, events } = play(s, { move: { from: "e1", to: "e5" } });
		assert.equal(sqOf(state, k), "e5");
		assert.equal(sqOf(state, pawn), null);
		assert.deepEqual(ofType(events, "move").map((e) => [e.piece, e.from, e.to]), [[k, "e1", "e5"]]);
		assert.deepEqual(ofType(events, "capture").map((e) => [e.piece, e.t, e.c]), [[pawn, "p", "b"]]);
		assert.deepEqual(state.players.b.captured, ["p"]);
		assert.equal(state.board.half, 0);
		assert.equal(state.board.castling, "-"); // THE KING MOVED
		assert.equal(state.players.w.kingSkulls, KING_SKULLS);
		assert.deepEqual(state.statuses[k].map((e) => [e.s, e.left]), [["frozen", 2]]);
		// FROZEN THROUGH WHITE'S NEXT 2 TURNS, GONE AFTER
		let t = pass(state, "b");
		assert.ok(has(t, k, "frozen"));
		t = pass(pass(t, "w"), "b");
		assert.ok(has(t, k, "frozen"));
		t = pass(t, "w");
		assert.ok(!has(t, k, "frozen"));
	});

	test("a quiet queen move keeps the half-move count going and leaves the rook home", () => {
		const s = game(FEN, "last-stand"), k = id(s, "e1"), rook = id(s, "h1");
		const { state } = play(s, { move: { from: "e1", to: "g1" } });
		assert.deepEqual([sqOf(state, k), sqOf(state, rook), state.board.half], ["g1", "h1", 8]);
	});

	test("a king move that uncovers a check emits one check event (framework, after any active)", () => {
		const s = game("4k3/8/8/8/8/8/4K3/4R3 w - - 0 1", "last-stand");
		const { state, events } = play(s, { move: { from: "e2", to: "a6" } });
		assert.ok(inCheck(state, "b"));
		assert.deepEqual(ofType(events, "check"), [{ type: "check", player: "b" }]);
		// A CHESS MOVE STILL EMITS EXACTLY ONE
		const m = game("4k3/8/8/8/8/8/8/R3K3 w - - 0 1");
		m.players.w.moves = [{ id: "c95", key: "move", piece: "r" }];
		assert.equal(ofType(applyAction(m, "w", { type: "move", card: "c95", from: "a1", to: "a8" }).events, "check").length, 1);
	});

	test("a capture names its square; taking an OF piece leaves the giver's choice pending with one check, none on the choice", () => {
		const s = game("4k3/8/b7/8/8/8/4K1PP/4R3 w - - 0 1", "last-stand"), bb = id(s, "a6");
		s.enchant.push({ id: "e99", key: "opposing-finality", owner: "b", pieces: [bb], left: null, data: {} });
		s.statuses[bb] = [{ s: "marked", left: null, by: "b" }];
		const r = play(s, { move: { from: "e2", to: "a6" } });
		assert.deepEqual(ofType(r.events, "capture").map((e) => [e.piece, e.sq]), [[bb, "a6"]]);
		assert.deepEqual(ofType(r.events, "check"), [{ type: "check", player: "b" }]);
		assert.equal(r.state.pending.player, "w");
		const r2 = applyAction(r.state, "w", { type: "choice", option: r.state.pending.options[0] });
		assert.deepEqual(ofType(r2.events, "check"), []);
		assert.equal(ofType(r2.events, "handover").length, 1);
	});
});
