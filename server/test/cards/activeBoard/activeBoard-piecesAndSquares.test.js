/*
 *  activeBoard-piecesAndSquares.test.js  --  chess cards engine tests
 *	The board actives that hand over, trade, revive or trap pieces (cards-engine/cards/active/): Opposing Finality, Swap, Conscription and Trapdoor: targets, effect, debuff and edge cases, one describe per card.
 *
 */

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const { legalActions, applyAction, KING_SKULLS, playerView, playerEvents, sqIndex, inCheck, makeCtx, statuses, ofType, id, sqOf, has, actives, game, play, pass, cardPlay, chess } = require("../../helpers/activeBoard.js");

describe("Opposing Finality", () => {
	const OF = require("../../../../cards-engine/cards/active/opposing-finality.js");
	const SH = require("../../../../cards-engine/cards/active/stronghold.js");
	const QUEEN = "4k2r/6b1/8/8/3Q4/8/8/4K3 w - - 0 1"; // BLACK BISHOP g7 TAKES THE QUEEN; BLACK'S ONE ROOK h8

	test("a forfeit (All or Nothing's lost hand, epic: the piece only) of the piece whose timed Mark it took over pays no one: the Mark is not put back", () => {
		let s = game("4k3/p7/8/8/8/2N5/P7/4K3 w - - 0 1");
		const c3 = id(s, "c3");
		s.statuses[c3] = [{ s: "marked", left: 2, by: "b" }];
		s = pass(cardPlay(s, "w", "opposing-finality", { piece: c3 }).state, "b");
		s.players.w.moves = [{ id: "m91", key: "move", piece: "m" }, { id: "m92", key: "move", piece: "p" }, { id: "m93", key: "move", piece: "p" }]; // CARDS LEFT FOR MARKED TO TAKE IF IT FIRED
		s = cardPlay(s, "w", "all-or-nothing-epic", { piece: c3 }).state; // EPIC: THE LOST HAND FORFEITS THE PIECE, NO CARDS (A DISCARD BELOW WOULD BE MARKED'S)
		s.duel.hands = { w: [{ r: 2, s: "c" }, { r: 3, s: "c" }, { r: 4, s: "c" }], b: [{ r: 14, s: "c" }, { r: 13, s: "c" }, { r: 12, s: "c" }] }; // WHITE LOSES
		const r = applyAction(applyAction(s, "w", { type: "duel", pick: 1 }).state, "b", { type: "duel", pick: 0 });
		assert.deepEqual(ofType(r.events, "duel-result"), [{ type: "duel-result", winner: "b" }]);
		assert.deepEqual(ofType(r.events, "capture").map((e) => [e.piece, e.player, e.by]), [[c3, "w", null]]); // A REMOVAL BY ITS OWN SIDE
		assert.equal(sqOf(r.state, c3), null);
		assert.deepEqual(r.state.enchant, []);
		assert.deepEqual(ofType(r.events, "status"), []);
		assert.deepEqual(ofType(r.events, "discard"), []);
	});

	test("targets: every own non-king piece; none with only the king", () => {
		const s = game(QUEEN, "opposing-finality");
		assert.deepEqual(actives(s).map((a) => sqOf(s, a.target.piece)), ["d4"]);
		assert.deepEqual(actives(game("4k3/8/8/8/8/8/8/4K3 w - - 0 1", "opposing-finality")), []);
	});

	test("the piece is Marked; captured, the opponent hands over a piece one stage below: it changes colour, keeps its id and goes to its start square, nearest first", () => {
		const s = game(QUEEN, "opposing-finality"), q = id(s, "d4"), rook = id(s, "h8");
		const st = play(s, { piece: q }).state;
		assert.deepEqual(st.enchant.map((e) => [e.key, e.pieces]), [["opposing-finality", [q]]]);
		assert.deepEqual(st.statuses[q].map((e) => [e.s, e.left]), [["marked", null]]);
		const { state, events } = chess(st, "b", "g7", "d4");
		assert.equal(sqOf(state, rook), "h1");
		assert.equal(state.board.sq[sqIndex("h1")].c, "w");
		assert.deepEqual(ofType(events, "handover"), [{ type: "handover", player: "w", piece: rook, from: "h8", to: "h1" }]);
		assert.deepEqual(state.enchant, []);
		assert.equal(state.pending, null);
		assert.equal(ofType(events, "check").length, 0);
		assert.equal(state.board.turn, "w");
	});

	test("no piece at the stage below: the enchanted piece's owner picks within the highest lower stage (JSON round trip); a bishop keeps its square colour", () => {
		const s = game("1n2k3/6b1/8/8/3Q4/8/8/4K3 w - - 0 1", "opposing-finality"), q = id(s, "d4"), knight = id(s, "b8"), bishop = id(s, "g7");
		const r = chess(play(s, { piece: q }).state, "b", "g7", "d4");
		assert.deepEqual([r.state.pending.player, r.state.pending.kind, r.state.pending.options], ["w", "opposing-finality", [knight, bishop]]);
		assert.deepEqual(legalActions(r.state, "w"), [{ type: "choice", option: knight }, { type: "choice", option: bishop }]);
		assert.deepEqual(legalActions(r.state, "b"), []);
		assert.deepEqual(ofType(r.events, "handover"), []);
		const t = JSON.parse(JSON.stringify(r.state));
		const { state, events } = applyAction(t, "w", { type: "choice", option: bishop });
		assert.equal(sqOf(state, bishop), "c1"); // d4 IS DARK, SO IS c1
		assert.equal(state.board.sq[sqIndex("c1")].c, "w");
		assert.equal(sqOf(state, knight), "b8");
		assert.equal(ofType(events, "handover").length, 1);
		assert.deepEqual([state.pending, state.board.turn], [null, "w"]);
	});

	test("at the exact stage below, the opponent picks within it", () => {
		const s = game("1n2k3/6b1/8/8/3R4/8/8/4K3 w - - 0 1", "opposing-finality"), rook = id(s, "d4"), knight = id(s, "b8");
		const r = chess(play(s, { piece: rook }).state, "b", "g7", "d4");
		assert.equal(r.state.pending.player, "b");
		const { state } = applyAction(JSON.parse(JSON.stringify(r.state)), "b", { type: "choice", option: knight });
		assert.equal(sqOf(state, knight), "b1");
		assert.equal(state.board.sq[sqIndex("b1")].c, "w");
	});

	test("a pawn takes a pawn, to its file on the owner's second rank", () => {
		const s = game("4k3/5p2/5n2/8/4P3/8/8/4K3 w - - 0 1", "opposing-finality"), pawn = id(s, "e4"), fp = id(s, "f7");
		const { state } = chess(play(s, { piece: pawn }).state, "b", "f6", "e4");
		assert.equal(sqOf(state, fp), "f2");
		assert.equal(state.board.sq[sqIndex("f2")].c, "w");
	});

	test("only a king left: nothing is handed over", () => {
		const s = game("4k3/3R4/8/8/8/8/8/4K3 w - - 0 1", "opposing-finality"), rook = id(s, "d7");
		const { state, events } = chess(play(s, { piece: rook }).state, "b", "e8", "d7");
		assert.deepEqual([ofType(events, "handover"), state.pending, state.enchant], [[], null, []]);
		assert.deepEqual(state.board.sq.filter(Boolean).map((p) => p.c + p.t).sort(), ["bk", "wk"]);
	});

	test("start square taken, the other gives check: the nearest empty square where it gives none", () => {
		// b1 HOLDS A WHITE BISHOP; A KNIGHT ON g1 WOULD CHECK THE BLACK KING ON h3
		const s = game("1n6/8/8/2p5/3R4/7k/8/1B2K3 w - - 0 1", "opposing-finality"), rook = id(s, "d4"), knight = id(s, "b8");
		const { state, events } = chess(play(s, { piece: rook }).state, "b", "c5", "d4");
		assert.equal(sqOf(state, knight), "b2");
		assert.equal(inCheck(state, "b"), false);
		assert.equal(ofType(events, "check").length, 0);
	});

	test("a piece whose leaving would uncover a check on its side is never handed over", () => {
		// BLACK ROOK e7 PINNED BY WHITE e1: THE KNIGHT COMES INSTEAD (THE ONLY ONE BELOW: NO CHOICE)
		const s = game("1n2k3/4r3/8/2p5/3Q4/8/8/K3R3 w - - 0 1", "opposing-finality"), q = id(s, "d4"), r7 = id(s, "e7"), knight = id(s, "b8");
		const { state } = chess(play(s, { piece: q }).state, "b", "c5", "d4");
		assert.equal(sqOf(state, r7), "e7");
		assert.equal(sqOf(state, knight), "b1");
		assert.equal(inCheck(state, "b"), false);
	});

	test("a capture by a card fires it too; a handed-over Stronghold piece loses its Warded", () => {
		const s = game(QUEEN), q = id(s, "d4"), rook = id(s, "h8");
		const ctx = makeCtx(s);
		OF.play(ctx, "w", { piece: q });
		SH.play(ctx, "b", { piece: rook });
		assert.ok(has(ctx.state, rook, "warded"));
		assert.equal(ctx.capture("b", q), true);
		assert.equal(sqOf(ctx.state, rook), "h1");
		assert.equal(ctx.state.board.sq[sqIndex("h1")].c, "w");
		assert.ok(!has(ctx.state, rook, "warded"));
		assert.deepEqual(ctx.state.enchant, []);
		assert.equal(ctx.resetHalf, true);
	});

	test("removed by its own side (a forfeit, a lost duel): no hand-over, the enchantment just ends", () => {
		const s = game(QUEEN), q = id(s, "d4"), rook = id(s, "h8");
		const ctx = makeCtx(s);
		OF.play(ctx, "w", { piece: q });
		assert.equal(ctx.capture("w", q), true);
		assert.deepEqual([ofType(ctx.events, "handover"), ctx.state.enchant, ctx.state.pending], [[], [], null]);
		assert.equal(sqOf(ctx.state, rook), "h8");
		assert.equal(ctx.state.board.sq[sqIndex("h8")].c, "b");
	});

	test("Swap's 1-turn Mark never cuts its permanent one: still Marked and enchanted two turns later", () => {
		const s = game("4k3/8/8/8/8/8/8/R3K2N w - - 0 1", "opposing-finality"), rook = id(s, "a1"), kn = id(s, "h1");
		let t = pass(play(s, { piece: rook }).state, "b");
		t.players.w.actives = [{ id: "c91", key: "swap" }];
		t = applyAction(t, "w", { type: "active", card: "c91", target: { pieces: [rook, kn] } }).state;
		assert.deepEqual(t.statuses[rook].map((e) => [e.s, e.left]), [["marked", null]]);
		t = pass(pass(pass(t, "b"), "w"), "b");
		assert.ok(has(t, rook, "marked"));
		assert.deepEqual(t.enchant.map((e) => e.key), ["opposing-finality"]);
	});

	test("on the owner's own turn, a piece whose leaving would put the owner in check is not handed over", () => {
		// THE BLACK KNIGHT a5 SHIELDS WHITE'S KING a1 FROM THE ROOK a8; WHITE'S OF ROOK STEPS ONTO BLACK'S REMOVAL TRAP h6
		const s = game("r3k3/8/8/n7/8/8/8/K6R w - - 0 1", "opposing-finality"), rook = id(s, "h1"), knight = id(s, "a5");
		const t = pass(play(s, { piece: rook }).state, "b");
		t.enchant.push({ id: "e901", key: "t-trap", owner: "b", pieces: [], left: null, data: { square: "h6" } });
		const { state, events } = chess(t, "w", "h1", "h6");
		assert.equal(sqOf(state, rook), null);
		assert.deepEqual([ofType(events, "handover"), state.pending, state.enchant], [[], null, []]); // THE TRAP FIRED, THE OF ENDED
		assert.equal(sqOf(state, knight), "a5");
		assert.equal(inCheck(state, "w"), false);
	});

	test("only what the handed piece causes counts: a check already on the giver is not its to block", () => {
		// THE OF ROOK c3 STEPS ONTO BLACK'S REMOVAL TRAP c6, UNCOVERING Ba1 ON h8: THE KNIGHT STILL GOES HOME TO b1, NOT b2
		const s = game("7k/8/8/8/1n6/2R5/8/B3K3 w - - 0 1", "opposing-finality"), rook = id(s, "c3"), knight = id(s, "b4");
		const t = pass(play(s, { piece: rook }).state, "b");
		t.enchant.push({ id: "e902", key: "t-trap", owner: "b", pieces: [], left: null, data: { square: "c6" } });
		const { state, events } = chess(t, "w", "c3", "c6");
		assert.equal(sqOf(state, knight), "b1");
		assert.ok(inCheck(state, "b"));
		assert.deepEqual(ofType(events, "check"), [{ type: "check", player: "b" }]);
	});

	test("its piece handed to the other side by the other side's Opposing Finality: it ends and the Mark goes", () => {
		const s = game("3qk3/8/8/8/8/8/8/1N2K3 w - - 0 1"), q = id(s, "d8"), kn = id(s, "b1");
		const ctx = makeCtx(s);
		OF.play(ctx, "w", { piece: kn });
		OF.play(ctx, "b", { piece: q });
		assert.equal(ctx.capture("w", q), true);
		assert.equal(sqOf(ctx.state, kn), "b8");
		assert.equal(ctx.state.board.sq[sqIndex("b8")].c, "b");
		assert.deepEqual(ctx.state.enchant, []);
		assert.ok(!has(ctx.state, kn, "marked"));
	});

	test("Cleanse on its Mark ends it", () => {
		const s = game(QUEEN, "opposing-finality"), q = id(s, "d4");
		const ctx = makeCtx(play(s, { piece: q }).state);
		statuses.clear(ctx, q, "marked");
		assert.deepEqual(ctx.state.enchant, []);
		assert.deepEqual(ofType(ctx.events, "enchant-ended").map((e) => e.key), ["opposing-finality"]);
	});

	test("the Stronghold ends inside the hand-over, before the Opposing Finality does", () => {
		const s = game(QUEEN), q = id(s, "d4"), rook = id(s, "h8");
		const ctx = makeCtx(s);
		OF.play(ctx, "w", { piece: q });
		SH.play(ctx, "b", { piece: rook });
		ctx.capture("b", q);
		assert.deepEqual(ofType(ctx.events, "enchant-ended").map((e) => e.key), ["stronghold", "opposing-finality"]);
	});

	test("a choice resolved for a piece already the owner's does nothing (two queued choices offering it)", () => {
		const s = game(QUEEN), rook = id(s, "h8");
		s.board.sq[sqIndex("h8")].c = "w";
		const ctx = makeCtx(s);
		OF.choice.resolve(ctx, { owner: "w" }, rook);
		assert.deepEqual([ctx.events, sqOf(ctx.state, rook)], [[], "h8"]);
	});
});

describe("Swap", () => {
	// e2 BISHOP PINNED BY THE e8 ROOK; PAWN a2; KNIGHT b1
	const FEN = "k3r3/8/8/8/8/8/P3B3/1N2K3 w - - 7 20";
	const pairs = (s) => actives(s).map((a) => a.target.pieces.map((p) => sqOf(s, p)).join("-")).sort();

	test("targets: pairs of own pieces; never one that exposes the king, puts a pawn on a back rank, or moves a Frozen or Hexed piece", () => {
		const s = game(FEN, "swap");
		assert.deepEqual(pairs(s), ["a2-e2", "b1-e1", "e2-b1"]);
		s.statuses[id(s, "b1")] = [{ s: "frozen", left: 2, by: "b" }];
		assert.deepEqual(pairs(s), ["a2-e2"]);
		s.statuses[id(s, "a2")] = [{ s: "hexed", left: 2, by: "b" }];
		assert.deepEqual(pairs(s), []);
		assert.deepEqual(actives(game("k7/8/8/8/8/8/8/4K3 w - - 0 1", "swap")), []);
	});

	test("never puts the king beside the other king (even one that can't capture)", () => {
		// THE ROOK c2 IS BESIDE THE SHAKEN BLACK KING d3: SWAPPED, THE WHITE KING WOULD STAND THERE
		const s = game("8/8/8/8/7N/3k4/2R5/4K3 w - - 0 1", "swap");
		s.statuses[id(s, "d3")] = [{ s: "shaken", left: 2, by: "w" }];
		assert.deepEqual(pairs(s), ["h4-c2", "h4-e1"]);
	});

	test("the two pieces trade squares and are Marked for 1 turn; a pawn moved resets the half-move counter", () => {
		const s = game(FEN, "swap"), b = id(s, "e2"), p = id(s, "a2");
		const { state, events } = play(s, { pieces: [p, b] });
		assert.deepEqual([sqOf(state, b), sqOf(state, p)], ["a2", "e2"]);
		assert.deepEqual(ofType(events, "move").map((e) => [e.piece, e.from, e.to, e.card]).sort(), [[b, "e2", "a2", null], [p, "a2", "e2", null]].sort());
		assert.equal(state.board.half, 0);
		assert.ok(has(state, b, "marked") && has(state, p, "marked"));
		let t = pass(state, "b");
		assert.ok(has(t, b, "marked") && has(t, p, "marked"));
		t = pass(t, "w");
		assert.ok(!has(t, b, "marked") && !has(t, p, "marked"));
	});

	test("castling rights follow the squares", () => {
		const s = game("k7/8/8/8/8/8/8/R3K2R w KQ - 0 1", "swap");
		const { state } = play(s, { pieces: [id(s, "a1"), id(s, "h1")] });
		assert.equal(state.board.castling, "-");
	});

	test("epic version: the same pairs, and only the one piece the owner picks is Marked for 1 turn", () => {
		const s = game(FEN, "swap-epic"), b = id(s, "e2"), p = id(s, "a2");
		const ts = actives(s).map((a) => a.target);
		assert.equal(ts.length, 2 * pairs(game(FEN, "swap")).length);
		const pick = ts.filter((t) => t.pieces.includes(b) && t.pieces.includes(p));
		assert.deepEqual(pick.map((t) => t.mark).sort(), [b, p].sort());
		const { state, events } = play(s, pick.find((t) => t.mark === b));
		assert.deepEqual([sqOf(state, b), sqOf(state, p)], ["a2", "e2"]);
		assert.ok(has(state, b, "marked") && !has(state, p, "marked"));
		assert.deepEqual(ofType(events, "status").map((e) => [e.piece, e.s, e.left]), [[b, "marked", 1]]);
		assert.equal(ofType(events, "card-played")[0].card.key, "swap-epic");
		const t = pass(pass(state, "b"), "w");
		assert.ok(!has(t, b, "marked"));
	});
});

describe("Conscription", () => {
	const FEN = "4k3/8/8/8/8/8/P7/4K3 w - - 7 20";

	test("targets: an own pawn and a captured non-pawn type; none without either", () => {
		const s = game(FEN, "conscription"), p = id(s, "a2");
		s.players.w.captured = ["p", "n", "q", "n"];
		assert.deepEqual(actives(s).map((a) => a.target), [{ piece: p, t: "q" }, { piece: p, t: "n" }]);
		s.players.w.captured = ["p"];
		assert.deepEqual(actives(s), []);
		const none = game("4k3/8/8/8/8/8/8/4K3 w - - 0 1", "conscription");
		none.players.w.captured = ["q"];
		assert.deepEqual(actives(none), []);
	});

	test("the pawn becomes the piece (same id), the type leaves the captured list; Shaken 2 turns and Marked", () => {
		const s = game(FEN, "conscription"), p = id(s, "a2");
		s.players.w.captured = ["n", "q", "q"];
		const { state, events } = play(s, { piece: p, t: "q" });
		assert.deepEqual(state.board.sq[sqIndex("a2")], { id: p, c: "w", t: "q" });
		assert.deepEqual(state.players.w.captured, ["n", "q"]);
		assert.deepEqual(ofType(events, "promote"), [{ type: "promote", player: "w", piece: p, t: "q" }]);
		assert.equal(state.board.half, 0);
		assert.deepEqual(state.statuses[p].map((e) => [e.s, e.left]).sort(), [["marked", null], ["shaken", 2]]);
		let t = pass(pass(state, "b"), "w");
		assert.ok(has(t, p, "shaken"));
		t = pass(pass(t, "b"), "w");
		assert.ok(!has(t, p, "shaken") && has(t, p, "marked"));
	});

	test("Conscription of a pawn whose Mark Opposing Finality owns: the permanent Mark is recorded and stays when the pawn is handed over", () => {
		let s = game("4k3/p7/8/8/8/8/3P4/4K3 w - - 0 1");
		const pc = id(s, "d2");
		s = pass(cardPlay(s, "w", "opposing-finality", { piece: pc }).state, "b");
		s.players.w.captured = ["n"];
		const ctx = makeCtx(cardPlay(s, "w", "conscription", { piece: pc, t: "n" }).state);
		assert.equal(ctx.state.enchant[0].data.marks[pc], "kept");
		ctx.state.board.sq[sqIndex("d2")].c = "b";
		ctx.emit({ type: "handover", player: "b", piece: pc, from: "d2", to: "d2" });
		assert.deepEqual(ctx.state.enchant, []);
		assert.equal(ctx.state.statuses[pc].find((e) => e.s === "marked").left, null);
	});
});

describe("Trapdoor", () => {
	const FEN = "r7/8/4k3/8/8/8/8/4K3 w - - 7 20"; // BLACK KING e6, ROOK a8

	test("targets: an empty square on the own half, 4+ squares from the enemy king, beside no piece; not in check", () => {
		const s = game(FEN, "trapdoor");
		const sqs = actives(s).map((a) => a.target.square);
		assert.ok(sqs.includes("a4") && sqs.includes("h1") && sqs.includes("a3"));
		for (const x of ["b4", "d4", "a5", "e1", "d2", "f1", "e2"]) assert.ok(!sqs.includes(x), x);
		const chk = game("4r1k1/8/8/8/8/8/8/4K3 w - - 0 1", "trapdoor");
		assert.deepEqual(actives(chk), []);
	});

	test("hidden from the opponent; the first enemy piece to land there is Frozen and Marked for 3 turns and stays (no capture)", () => {
		const s = game(FEN, "trapdoor"), rook = id(s, "a8");
		const { state, events } = play(s, { square: "a3" });
		assert.deepEqual(state.enchant.map((e) => [e.key, e.owner, e.pieces, e.data]), [["trapdoor", "w", [], { square: "a3" }]]);
		assert.ok(!JSON.stringify(playerView(state, "b")).includes("\"a3\""));
		assert.ok(!JSON.stringify(playerEvents(state, events, "b")).includes("\"a3\""));
		assert.equal(playerView(state, "w").enchant[0].data.square, "a3");
		const quiet = chess(state, "b", "a8", "a5");
		assert.ok(!JSON.stringify(playerView(quiet.state, "b")).includes("\"a3\""));
		assert.equal(quiet.state.enchant.length, 1);
		const r = chess(pass(quiet.state, "w"), "b", "a5", "a3");
		assert.equal(sqOf(r.state, rook), "a3");
		assert.deepEqual(ofType(r.events, "capture"), []);
		assert.deepEqual(r.state.statuses[rook].map((e) => [e.s, e.left]), [["frozen", 3], ["marked", 3]]);
		assert.deepEqual(r.state.enchant, []);
		assert.deepEqual(r.state.players.b.captured, []);
		// 3 OF BLACK'S TURNS: STILL FROZEN AFTER 2, FREE AFTER 3
		let t = pass(pass(pass(pass(r.state, "w"), "b"), "w"), "b");
		assert.ok(has(t, rook, "frozen") && has(t, rook, "marked"));
		t = pass(pass(t, "w"), "b");
		assert.ok(!has(t, rook, "frozen") && !has(t, rook, "marked"));
	});

	test("an enemy king landing there is Frozen for 3 turns, not Marked; the trap is spent", () => {
		const s = game(FEN, "trapdoor"), k = id(s, "e6");
		let t = pass(play(s, { square: "a3" }).state, "b");
		t = pass(t, "w");
		t.board.sq[sqIndex("b4")] = t.board.sq[sqIndex("e6")];
		t.board.sq[sqIndex("e6")] = null;
		const r = applyAction(t, "b", { type: "move", card: "king", from: "b4", to: "a3" });
		assert.equal(sqOf(r.state, k), "a3");
		assert.deepEqual(r.state.statuses[k].map((e) => [e.s, e.left]), [["frozen", 3]]);
		assert.deepEqual(r.state.enchant, []);
		assert.deepEqual(ofType(r.events, "capture"), []);
	});

	test("Trapdoor on a king, then the king moves out of check for a King skull (the status-stuck king rule)", () => {
		const s = game("r7/8/4k3/8/8/8/8/4K2R w - - 0 1", "trapdoor"), k = id(s, "e6");
		let t = pass(pass(play(s, { square: "a3" }).state, "b"), "w");
		t.board.sq[sqIndex("b4")] = t.board.sq[sqIndex("e6")];
		t.board.sq[sqIndex("e6")] = null;
		t = applyAction(t, "b", { type: "move", card: "king", from: "b4", to: "a3" }).state;
		assert.ok(has(t, k, "frozen"));
		t = chess(t, "w", "h1", "h3").state; // CHECK ALONG THE THIRD RANK
		assert.ok(inCheck(t, "b"));
		const out = legalActions(t, "b").filter((a) => a.type === "move" && a.from === "a3");
		assert.deepEqual(out.map((a) => a.to).sort(), ["a2", "a4", "b2", "b4"]);
		const r = applyAction(t, "b", { type: "move", card: "king", from: "a3", to: "a2" });
		assert.equal(sqOf(r.state, k), "a2");
		assert.deepEqual(ofType(r.events, "king-skull").map((e) => [e.player, e.left, e.why]), [["b", KING_SKULLS - 1, "status"]]);
		assert.ok(!has(r.state, k, "frozen"));
	});

	test("an entry without its square (rebuilt from the opponent's view) does nothing", () => {
		const s = game(FEN, "trapdoor"), rook = id(s, "a8");
		const st = play(s, { square: "a3" }).state;
		const armed = JSON.parse(JSON.stringify(st));
		delete st.enchant[0].data.square;
		const { state } = chess(st, "b", "a8", "a3");
		assert.equal(sqOf(state, rook), "a3");
		assert.equal(state.enchant.length, 1);
		assert.ok(has(chess(armed, "b", "a8", "a3").state, rook, "frozen")); // THE SAME STATE WITH ITS SQUARE: IT FIRES
	});

	test("a trapped shield stays on the board and still shields its king: no check", () => {
		const s = game("k7/8/8/8/8/7r/8/R3K3 b - - 0 1"), rook = id(s, "h3");
		s.enchant.push({ id: "e900", key: "trapdoor", owner: "w", pieces: [], left: null, data: { square: "a3" } });
		const { state, events } = chess(s, "b", "h3", "a3");
		assert.ok(sqOf(state, rook) === "a3" && has(state, rook, "frozen"));
		assert.ok(!inCheck(state, "b"));
		assert.deepEqual(ofType(events, "check"), []);
	});

	test("never fires in a legality trial: Swap offers the same actions whether or not the hidden trap is there", () => {
		const list = (trap) => {
			const s = game("8/8/8/3r4/8/3k4/8/3RK3 b - - 0 1");
			if (trap) s.enchant.push({ id: "e905", key: "trapdoor", owner: "w", pieces: [], left: null, data: { square: "d3" } });
			s.players.b.actives = [{ id: "c77", key: "swap" }];
			return actives(s, "b").map((a) => a.target.pieces.map((p) => sqOf(s, p)).join("-"));
		};
		assert.deepEqual(list(true), list(false));
		assert.deepEqual(list(false), ["d5-d3"]);
	});

	test("a move event inside a legality trial (ctx.trial) leaves the trap armed and the piece untouched; outside one it fires", () => {
		const fired = (trial) => {
			const s = game("k7/8/8/8/8/r7/8/4K3 w - - 0 1"), rook = id(s, "a3");
			s.enchant.push({ id: "e906", key: "trapdoor", owner: "w", pieces: [], left: null, data: { square: "a3" } });
			const ctx = makeCtx(s);
			if (trial) ctx.trial = true;
			ctx.emit({ type: "move", player: "b", piece: rook, from: "h3", to: "a3" });
			return [has(ctx.state, rook, "frozen"), ctx.state.enchant.length];
		};
		assert.deepEqual(fired(true), [false, 1]);
		assert.deepEqual(fired(false), [true, 0]);
	});

	test("fires on Swap's moves and on a hand-over", () => {
		const s = game("4k3/8/8/8/n6r/8/8/4K3 b - - 0 1"), rook = id(s, "h4"), kn = id(s, "a4");
		s.enchant.push({ id: "e906", key: "trapdoor", owner: "w", pieces: [], left: null, data: { square: "a4" } });
		s.players.b.actives = [{ id: "c77", key: "swap" }];
		assert.ok(actives(s, "b").length);
		const { state } = applyAction(s, "b", { type: "active", card: "c77", target: { pieces: [kn, rook] } });
		assert.deepEqual([sqOf(state, rook), sqOf(state, kn), state.enchant], ["a4", "h4", []]);
		assert.deepEqual(state.statuses[rook].map((e) => [e.s, e.left]), [["frozen", 3], ["marked", 3]]); // SWAP'S 1-TURN MARK NEVER CUTS IT
		const h = game("4k3/8/8/8/8/8/8/r3K3 b - - 0 1"), r = id(h, "a1");
		h.enchant.push({ id: "e907", key: "trapdoor", owner: "w", pieces: [], left: null, data: { square: "a1" } });
		const ctx = makeCtx(h);
		ctx.emit({ type: "handover", player: "b", piece: r, from: "h8", to: "a1" });
		assert.deepEqual([sqOf(ctx.state, r), has(ctx.state, r, "frozen"), ctx.state.enchant], ["a1", true, []]);
	});

	test("protection no longer matters: a Warded piece, or one under a Ward rule like Heavy Cavalry's, is Frozen and Marked too", () => {
		// BLACK KNIGHTS c6 (ENCHANTED) AND e5; c6 COVERS d4, THE TRAP
		const FEN2 = "4k3/8/2n5/4n3/7r/8/8/4K3 b - - 0 1";
		const run = (prep) => {
			const s = game(FEN2), rook = id(s, "h4");
			s.enchant.push({ id: "e908", key: "trapdoor", owner: "w", pieces: [], left: null, data: { square: "d4" } });
			prep(s);
			const { state } = chess(s, "b", "h4", "d4");
			return [sqOf(state, rook), state.enchant.filter((e) => e.key === "trapdoor").length, has(state, rook, "frozen") && has(state, rook, "marked")];
		};
		assert.deepEqual(run(() => {}), ["d4", 0, true]);
		assert.deepEqual(run((s) => { s.statuses[id(s, "h4")] = [{ s: "warded", left: null, by: "b" }]; }), ["d4", 0, true]);
		assert.deepEqual(run((s) => { s.enchant.push({ id: "e909", key: "heavy-cavalry", owner: "b", pieces: [id(s, "c6")], left: null, data: {} }); }), ["d4", 0, true]);
	});

	test("an existing own trap square is not offered again", () => {
		const s = game("4k3/p7/8/8/8/8/8/K7 w - - 0 1", "trapdoor");
		assert.ok(actives(s).some((a) => a.target.square === "h1"));
		const t = pass(play(s, { square: "h1" }).state, "b");
		t.players.w.actives = [{ id: "c92", key: "trapdoor" }];
		const sqs = actives(t).map((a) => a.target.square);
		assert.ok(!sqs.includes("h1") && sqs.includes("h2"));
	});
	test("a shield trapped on the first move of a two-move turn still shields: no check, the turn goes on", () => {
		let s = game("k3r3/8/8/8/8/4R3/8/4K3 b - - 0 1");
		s = cardPlay(s, "b", "trapdoor", { square: "e5" }).state;
		s = cardPlay(s, "w", "double-time").state;
		const rook = id(s, "e3"), r = chess(s, "w", "e3", "e5");
		assert.deepEqual([r.state.board.turn, inCheck(r.state, "w"), has(r.state, rook, "frozen")], ["w", false, true]);
		assert.deepEqual(ofType(r.events, "check"), []);
	});
});
