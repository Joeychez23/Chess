/*
 *  cards-active-board.test.js  --  chess cards engine tests
 *	The actives that act on the board (cards-engine/cards/active/): targets, effect, debuff and edge cases, one describe per card.
 *
 */

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const { newGame, legalActions, applyAction, KING_SKULLS, playerView, playerEvents } = require("../../cards-engine/index.js");
const { fromFen, sqIndex } = require("../../cards-engine/board.js");
const { legalMoves, inCheck } = require("../../cards-engine/rules.js");
const { makeCtx } = require("../../cards-engine/ctx.js");
const { startTurn } = require("../../cards-engine/turn.js");
const statuses = require("../../cards-engine/statuses.js");
const { register } = require("../../cards-engine/cards/index.js");

for (const key of ["stronghold", "heavy-cavalry", "heretical-subjection", "last-stand", "opposing-finality", "swap", "conscription", "trapdoor"]) register(require("../../cards-engine/cards/active/" + key + ".js"));
register(require("../../cards-engine/cards/active/double-time.js")); // TASK 8'S CARD, READ ONLY: A TWO-MOVE TURN FOR THE TRAPDOOR TEST
for (const key of ["cleanse", "hexcraft", "insidious-nullification"]) register(require("../../cards-engine/cards/active/" + key + ".js")); // HAND CARDS, READ ONLY: A MARK REMOVED OR GIVEN ON TOP OF A CLAIMED ONE
register({ key: "t-pass", kind: "active", name: "t-pass", rarity: "common", text: "", targets: () => [null], play: () => {} });

let passes = 0;
const ofType = (events, type) => events.filter((e) => e.type === type);
const id = (s, sq) => s.board.sq[sqIndex(sq)].id;
const sqOf = (s, pid) => { const i = s.board.sq.findIndex((p) => p && p.id === pid); return i < 0 ? null : "abcdefgh"[i % 8] + (8 - (i >> 3)); };
const has = (s, pid, st) => statuses.has(s, pid, st);
const actives = (s, c = "w") => legalActions(s, c).filter((a) => a.type === "active");
const captures = (s, c, from, to) => legalMoves(s, c).some((m) => m.from === from && m.to === to && m.capture);

/**
 * @description A game on this FEN with empty hands; White holds the active `key` as card c90.
 */
function game(fen, key) {
	const s = newGame({ vesper: "b", level: 1300, seed: 1 });
	s.board = fromFen(fen);
	for (const c of ["w", "b"]) Object.assign(s.players[c], { moves: [], actives: [], passive: null });
	if (key) s.players.w.actives = [{ id: "c90", key }];
	return s;
}

/**
 * @description White plays its held card c90 (with target when given); returns { state, events }.
 */
function play(s, target, card = "c90") {
	return applyAction(s, "w", target === undefined ? { type: "active", card } : { type: "active", card, target });
}

/**
 * @description color spends its turn on a no-op active; returns the new state.
 */
function pass(s, color) {
	const card = { id: "p" + ++passes, key: "t-pass" };
	s.players[color].actives = [card];
	return applyAction(s, color, { type: "active", card: card.id }).state;
}

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
});

describe("Heavy Cavalry", () => {
	// KNIGHTS c3 AND e4 A KNIGHT'S MOVE APART; PAWN e2 ON A SQUARE c3 COVERS (BLACK BISHOP g4 ATTACKS IT); BLACK ROOK e8 ATTACKS THE e4 KNIGHT
	const FEN = "4r2k/8/8/8/4N1b1/2N5/P3P3/7K w - - 0 1";

	test("targets: either knight, only when the two are a knight's move apart", () => {
		const s = game(FEN, "heavy-cavalry");
		assert.deepEqual(actives(s).map((a) => sqOf(s, a.target.piece)).sort(), ["c3", "e4"]);
		assert.deepEqual(actives(game("4r2k/8/8/8/3N2b1/2N5/P3P3/7K w - - 0 1", "heavy-cavalry")), []);
		assert.deepEqual(actives(game("4r2k/8/8/8/6b1/2N5/P3P3/7K w - - 0 1", "heavy-cavalry")), []);
	});

	test("friendly pieces the enchanted knight covers are Warded, never the partner; the partner is Marked", () => {
		const s = game(FEN, "heavy-cavalry"), n = id(s, "c3"), partner = id(s, "e4");
		assert.ok(captures(s, "b", "g4", "e2"));
		const { state } = play(s, { piece: n });
		assert.deepEqual(state.enchant.map((e) => [e.key, e.pieces]), [["heavy-cavalry", [n, partner]]]);
		assert.ok(has(state, partner, "marked") && !has(state, n, "marked"));
		assert.ok(!captures(state, "b", "g4", "e2")); // e2 IS A c3 KNIGHT SQUARE: WARDED
		assert.ok(captures(state, "b", "e8", "e4")); // THE PARTNER IS NEVER WARDED
	});

	test("switching the enchantment to the other knight uses the turn", () => {
		const s = game(FEN, "heavy-cavalry"), n = id(s, "c3"), partner = id(s, "e4");
		const t = pass(play(s, { piece: n }).state, "b"), e = t.enchant[0];
		const sw = { type: "switch", enchant: e.id };
		assert.ok(legalActions(t, "w").some((a) => a.type === "switch" && a.enchant === e.id));
		const { state } = applyAction(t, "w", sw);
		assert.deepEqual(state.enchant[0].pieces, [partner, n]);
		assert.ok(has(state, n, "marked") && !has(state, partner, "marked"));
		assert.deepEqual([state.board.turn, state.ply], ["b", t.ply + 1]);
		assert.ok(captures(state, "b", "g4", "e2")); // e2 IS NOT AN e4 KNIGHT SQUARE
	});

	test("ends for good when the knights separate", () => {
		const s = game(FEN, "heavy-cavalry"), n = id(s, "c3"), partner = id(s, "e4");
		const t = pass(play(s, { piece: n }).state, "b");
		t.players.w.moves = [{ id: "c95", key: "move", piece: "n" }];
		const { state, events } = applyAction(t, "w", { type: "move", card: "c95", from: "c3", to: "b5" });
		assert.deepEqual(state.enchant, []);
		assert.deepEqual(ofType(events, "enchant-ended").map((e) => e.key), ["heavy-cavalry"]);
		assert.ok(!has(state, partner, "marked"));
		assert.ok(captures(state, "b", "g4", "e2"));
		assert.ok(!legalActions(pass(state, "b"), "w").some((a) => a.type === "switch"));
	});

	test("ends when the partner is captured", () => {
		const s = game(FEN, "heavy-cavalry"), n = id(s, "c3");
		const t = play(s, { piece: n }).state;
		t.players.b.moves = [{ id: "c96", key: "move", piece: "r" }];
		const { state } = applyAction(t, "b", { type: "move", card: "c96", from: "e8", to: "e4" });
		assert.deepEqual(state.enchant, []);
	});

	test("a second Heavy Cavalry offers no knight already in an entry; the partner stays Marked while it lasts", () => {
		const s = game(FEN, "heavy-cavalry"), n = id(s, "c3"), partner = id(s, "e4");
		let t = pass(play(s, { piece: n }).state, "b");
		t.players.w.actives = [{ id: "c91", key: "heavy-cavalry" }];
		assert.deepEqual(actives(t), []);
		t = pass(applyAction(t, "w", { type: "switch", enchant: t.enchant[0].id }).state, "b");
		t = pass(applyAction(t, "w", { type: "switch", enchant: t.enchant[0].id }).state, "b");
		assert.equal(t.enchant.length, 1);
		assert.ok(has(t, partner, "marked") && !has(t, n, "marked"));
	});

	test("each end path alone: a move event, a capture, a turn start", () => {
		const s = game(FEN, "heavy-cavalry"), n = id(s, "c3"), partner = id(s, "e4");
		const st = play(s, { piece: n }).state;
		const hop = (x) => { x.board.sq[sqIndex("b5")] = x.board.sq[sqIndex("c3")]; x.board.sq[sqIndex("c3")] = null; };
		// move ONLY
		let ctx = makeCtx(JSON.parse(JSON.stringify(st)));
		hop(ctx.state);
		ctx.emit({ type: "move", player: "w", card: null, piece: n, from: "c3", to: "b5" });
		assert.deepEqual(ctx.state.enchant, []);
		// capture ONLY
		ctx = makeCtx(JSON.parse(JSON.stringify(st)));
		assert.equal(ctx.capture("b", partner), true);
		assert.deepEqual(ctx.state.enchant, []);
		// turn-start ONLY: SEPARATED WITH NO EVENT
		ctx = makeCtx(JSON.parse(JSON.stringify(st)));
		hop(ctx.state);
		assert.equal(ctx.state.enchant.length, 1);
		startTurn(ctx, ctx.state.board.turn);
		assert.deepEqual(ctx.state.enchant, []);
		assert.ok(!has(ctx.state, partner, "marked"));
	});

	test("a partner handed over ends it at once; Cleanse on the partner's Mark ends it", () => {
		const s = game(FEN, "heavy-cavalry"), n = id(s, "c3"), partner = id(s, "e4");
		let ctx = makeCtx(play(s, { piece: n }).state);
		ctx.state.board.sq[sqIndex("e4")].c = "b";
		ctx.emit({ type: "handover", player: "b", piece: partner, from: "e4", to: "e4" });
		assert.deepEqual(ctx.state.enchant, []);
		ctx = makeCtx(play(game(FEN, "heavy-cavalry"), { piece: n }).state);
		statuses.clear(ctx, partner, "marked");
		assert.deepEqual(ctx.state.enchant, []);
		assert.deepEqual(ofType(ctx.events, "enchant-ended").map((e) => e.key), ["heavy-cavalry"]);
	});

	test("shared Marks: Heavy Cavalry never takes a Mark it didn't give (A: its knight captured; B: its switch; C: Conscription's)", () => {
		// A, B: OF ON c3 FIRST, THEN HEAVY CAVALRY ENCHANTING b1 WITH c3 AS THE PARTNER
		const setup = () => {
			let s = game("1r2k3/8/8/8/8/2N5/8/1N2K3 w - - 0 1");
			s = pass(cardPlay(s, "w", "opposing-finality", { piece: id(s, "c3") }).state, "b");
			return cardPlay(s, "w", "heavy-cavalry", { piece: id(s, "b1") }).state;
		};
		let s = setup();
		const n1 = id(s, "b1"), n2 = id(s, "c3");
		let r = chess(s, "b", "b8", "b1");
		assert.deepEqual(r.state.enchant.map((e) => e.key), ["opposing-finality"]);
		assert.ok(has(r.state, n2, "marked"));
		s = pass(setup(), "b");
		r = applyAction(s, "w", { type: "switch", enchant: s.enchant.find((e) => e.key === "heavy-cavalry").id });
		assert.deepEqual(r.state.enchant.map((e) => [e.key, e.pieces]), [["opposing-finality", [n2]], ["heavy-cavalry", [n2, n1]]]);
		assert.ok(has(r.state, n2, "marked") && has(r.state, n1, "marked"));
		assert.deepEqual(ofType(r.events, "status-ended"), []);
		// C: A CONSCRIPTED KNIGHT (MARKED FOR GOOD) AS THE PARTNER; THE KNIGHTS SEPARATE
		let u = game("4k3/8/8/8/8/8/3P4/1N2K3 w - - 0 1");
		u.players.w.captured = ["n"];
		const pc = id(u, "d2");
		u = pass(cardPlay(u, "w", "conscription", { piece: pc, t: "n" }).state, "b");
		u = pass(cardPlay(u, "w", "heavy-cavalry", { piece: id(u, "b1") }).state, "b");
		r = chess(u, "w", "b1", "a3");
		assert.deepEqual(r.state.enchant, []);
		assert.deepEqual(r.state.statuses[pc].find((e) => e.s === "marked").left, null);
	});

	test("shared Marks: Heavy Cavalry first, then Opposing Finality on the partner: the OF stays Marked and live when Heavy Cavalry ends", () => {
		const s = game(FEN, "heavy-cavalry"), n = id(s, "c3"), partner = id(s, "e4");
		let t = pass(play(s, { piece: n }).state, "b");
		t = pass(cardPlay(t, "w", "opposing-finality", { piece: partner }).state, "b");
		const r = chess(t, "w", "c3", "b5");
		assert.deepEqual(r.state.enchant.map((e) => e.key), ["opposing-finality"]);
		assert.ok(has(r.state, partner, "marked"));
		assert.deepEqual(ofType(r.events, "status-ended"), []);
	});

	test("a timed Mark (Hexcraft's) on the partner is permanent while it lasts and put back with the turns it had left", () => {
		const s = game(FEN, "heavy-cavalry"), n = id(s, "c3"), partner = id(s, "e4");
		s.statuses[partner] = [{ s: "marked", left: 2, by: "b" }];
		let t = play(s, { piece: n }).state;
		assert.equal(t.statuses[partner][0].left, null);
		t = pass(pass(pass(t, "b"), "w"), "b");
		assert.equal(t.statuses[partner][0].left, null); // IT DOESN'T RUN DOWN WHILE HEAVY CAVALRY LASTS
		const r = chess(t, "w", "c3", "b5");
		assert.deepEqual(r.state.enchant, []);
		assert.deepEqual(r.state.statuses[partner].map((e) => [e.s, e.left]), [["marked", 2]]);
	});

	test("Cleanse on a timed Mark Heavy Cavalry took over ends it and leaves no Mark: nothing is put back", () => {
		const s = game(FEN, "heavy-cavalry"), n = id(s, "c3"), partner = id(s, "e4");
		s.statuses[partner] = [{ s: "marked", left: 2, by: "b" }]; // HEXCRAFT'S
		const t = pass(play(s, { piece: n }).state, "b");
		const r = cardPlay(t, "w", "cleanse", { piece: partner, s: "marked" });
		assert.deepEqual(r.state.enchant, []);
		assert.ok(!has(r.state, partner, "marked"));
		assert.deepEqual(ofType(r.events, "status").filter((e) => e.piece === partner), []);
	});

	test("a timed Mark given on top of the one Heavy Cavalry owns (Hexcraft's) is recorded: when the knights part it stays for its turns", () => {
		const s = game("4k3/8/8/8/4N3/2N5/8/4K3 w - - 0 1", "heavy-cavalry"), n = id(s, "c3"), partner = id(s, "e4");
		const hx = cardPlay(pass(play(s, { piece: n }).state, "b"), "w", "hexcraft"); // e4 IS WHITE'S MOST ADVANCED PIECE; NO CURSE IS REGISTERED HERE, SO NO CHOICE
		assert.deepEqual(ofType(hx.events, "status").filter((e) => e.piece === partner), []); // AS BEFORE: NO EVENT
		assert.equal(hx.state.enchant[0].data.marks[partner], 3);
		const r = chess(pass(hx.state, "b"), "w", "c3", "b5");
		assert.deepEqual(r.state.enchant, []);
		assert.deepEqual(r.state.statuses[partner].map((e) => [e.s, e.left]), [["marked", 3]]);
	});

	test("ends when a knight becomes another type in place (a duel upgrade)", () => {
		const s = game(FEN, "heavy-cavalry"), n = id(s, "c3");
		const ctx = makeCtx(play(s, { piece: n }).state);
		ctx.state.board.sq[sqIndex("c3")].t = "r";
		ctx.emit({ type: "promote", player: "w", piece: n, t: "r" });
		assert.deepEqual(ctx.state.enchant, []);
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
		t.players.w.moves = [{ id: "c95", key: "move", piece: "b" }];
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
		const HS = require("../../cards-engine/cards/active/heretical-subjection.js");
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

/**
 * @description color makes a chess move with a fresh move card for the moving piece's type; returns { state, events }.
 */
/**
 * @description color plays the active `key` (with target when given) from a fresh card; returns { state, events }.
 */
function cardPlay(s, color, key, target) {
	const card = { id: "k" + ++passes, key };
	s.players[color].actives = [card];
	return applyAction(s, color, target === undefined ? { type: "active", card: card.id } : { type: "active", card: card.id, target });
}

function chess(s, color, from, to) {
	const card = { id: "m" + ++passes, key: "move", piece: s.board.sq[sqIndex(from)].t };
	s.players[color].moves = [card];
	return applyAction(s, color, { type: "move", card: card.id, from, to });
}

describe("Opposing Finality", () => {
	const OF = require("../../cards-engine/cards/active/opposing-finality.js");
	const SH = require("../../cards-engine/cards/active/stronghold.js");
	const QUEEN = "4k2r/6b1/8/8/3Q4/8/8/4K3 w - - 0 1"; // BLACK BISHOP g7 TAKES THE QUEEN; BLACK'S ONE ROOK h8

	test("a forfeit (Insidious Nullification) of the piece whose timed Mark it took over pays no one: the Mark is not put back", () => {
		let s = game("4k3/p7/8/8/8/2N5/P7/4K3 w - - 0 1");
		const c3 = id(s, "c3");
		s.statuses[c3] = [{ s: "marked", left: 2, by: "b" }];
		s = pass(cardPlay(s, "w", "opposing-finality", { piece: c3 }).state, "b");
		s.players.w.moves = [{ id: "m91", key: "move", piece: "n" }, { id: "m92", key: "move", piece: "p" }, { id: "m93", key: "move", piece: "p" }]; // CARDS LEFT FOR MARKED TO TAKE IF IT FIRED
		const r = applyAction(cardPlay(s, "w", "insidious-nullification").state, "w", { type: "choice", option: c3 });
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
		// THE BLACK KNIGHT a5 SHIELDS WHITE'S KING a1 FROM THE ROOK a8; WHITE'S OF ROOK STEPS ONTO BLACK'S TRAP h6
		const s = game("r3k3/8/8/n7/8/8/8/K6R w - - 0 1", "opposing-finality"), rook = id(s, "h1"), knight = id(s, "a5");
		const t = pass(play(s, { piece: rook }).state, "b");
		t.enchant.push({ id: "e901", key: "trapdoor", owner: "b", pieces: [], left: null, data: { square: "h6" } });
		const { state, events } = chess(t, "w", "h1", "h6");
		assert.equal(sqOf(state, rook), null);
		assert.deepEqual([ofType(events, "handover"), state.pending, state.enchant], [[], null, []]); // THE TRAP FIRED, THE OF ENDED
		assert.equal(sqOf(state, knight), "a5");
		assert.equal(inCheck(state, "w"), false);
	});

	test("only what the handed piece causes counts: a check already on the giver is not its to block", () => {
		// THE OF ROOK c3 STEPS ONTO BLACK'S TRAP c6, UNCOVERING Ba1 ON h8: THE KNIGHT STILL GOES HOME TO b1, NOT b2
		const s = game("7k/8/8/8/1n6/2R5/8/B3K3 w - - 0 1", "opposing-finality"), rook = id(s, "c3"), knight = id(s, "b4");
		const t = pass(play(s, { piece: rook }).state, "b");
		t.enchant.push({ id: "e902", key: "trapdoor", owner: "b", pieces: [], left: null, data: { square: "c6" } });
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

	test("hidden from the opponent; the first enemy piece to land there is removed (half-move counter 0)", () => {
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
		assert.equal(sqOf(r.state, rook), null);
		assert.deepEqual(ofType(r.events, "capture").map((e) => [e.piece, e.c, e.by]), [[rook, "b", null]]);
		assert.deepEqual(r.state.enchant, []);
		assert.equal(r.state.board.half, 0);
		assert.deepEqual(r.state.players.b.captured, ["r"]);
	});

	test("a king landing there is not removed or frozen; the trap stays", () => {
		const s = game(FEN, "trapdoor"), k = id(s, "e6");
		let t = pass(play(s, { square: "a3" }).state, "b");
		t = pass(t, "w");
		t.board.sq[sqIndex("b4")] = t.board.sq[sqIndex("e6")];
		t.board.sq[sqIndex("e6")] = null;
		const r = applyAction(t, "b", { type: "move", card: "king", from: "b4", to: "a3" });
		assert.equal(sqOf(r.state, k), "a3");
		assert.ok(!r.state.statuses[k]);
		assert.equal(r.state.enchant.length, 1);
		assert.deepEqual(ofType(r.events, "capture"), []);
		// THE SAME TRAP, STILL ARMED: THE KING STEPS OFF, THEN AN ENEMY ROOK LANDS AND IS REMOVED
		t = pass(applyAction(pass(r.state, "w"), "b", { type: "move", card: "king", from: "a3", to: "b3" }).state, "w");
		const rook = id(t, "a8"), x = chess(t, "b", "a8", "a3");
		assert.deepEqual([sqOf(x.state, rook), x.state.enchant], [null, []]);
	});

	test("an entry without its square (rebuilt from the opponent's view) does nothing", () => {
		const s = game(FEN, "trapdoor"), rook = id(s, "a8");
		const st = play(s, { square: "a3" }).state;
		const armed = JSON.parse(JSON.stringify(st));
		delete st.enchant[0].data.square;
		const { state } = chess(st, "b", "a8", "a3");
		assert.equal(sqOf(state, rook), "a3");
		assert.equal(state.enchant.length, 1);
		assert.equal(sqOf(chess(armed, "b", "a8", "a3").state, rook), null); // THE SAME STATE WITH ITS SQUARE: IT FIRES
	});

	test("a shield removed by the trap leaves its king open, and the check is announced", () => {
		const s = game("k7/8/8/8/8/7r/8/R3K3 b - - 0 1"), rook = id(s, "h3");
		s.enchant.push({ id: "e900", key: "trapdoor", owner: "w", pieces: [], left: null, data: { square: "a3" } });
		const { state, events } = chess(s, "b", "h3", "a3");
		assert.equal(sqOf(state, rook), null);
		assert.ok(inCheck(state, "b"));
		assert.deepEqual(ofType(events, "check"), [{ type: "check", player: "b" }]);
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

	test("fires on Swap's moves and on a hand-over", () => {
		const s = game("4k3/8/8/8/n6r/8/8/4K3 b - - 0 1"), rook = id(s, "h4"), kn = id(s, "a4");
		s.enchant.push({ id: "e906", key: "trapdoor", owner: "w", pieces: [], left: null, data: { square: "a4" } });
		s.players.b.actives = [{ id: "c77", key: "swap" }];
		assert.ok(actives(s, "b").length);
		const { state } = applyAction(s, "b", { type: "active", card: "c77", target: { pieces: [kn, rook] } });
		assert.deepEqual([sqOf(state, rook), sqOf(state, kn), state.enchant], [null, "h4", []]);
		const h = game("4k3/8/8/8/8/8/8/r3K3 b - - 0 1"), r = id(h, "a1");
		h.enchant.push({ id: "e907", key: "trapdoor", owner: "w", pieces: [], left: null, data: { square: "a1" } });
		const ctx = makeCtx(h);
		ctx.emit({ type: "handover", player: "b", piece: r, from: "h8", to: "a1" });
		assert.deepEqual([sqOf(ctx.state, r), ctx.state.enchant], [null, []]);
	});

	test("a protected piece (Warded, or a Ward rule like Heavy Cavalry's) is not removed and the trap stays", () => {
		// BLACK KNIGHTS c6 (ENCHANTED) AND e5; c6 COVERS d4, THE TRAP
		const FEN2 = "4k3/8/2n5/4n3/7r/8/8/4K3 b - - 0 1";
		const run = (prep) => {
			const s = game(FEN2), rook = id(s, "h4");
			s.enchant.push({ id: "e908", key: "trapdoor", owner: "w", pieces: [], left: null, data: { square: "d4" } });
			prep(s);
			const { state } = chess(s, "b", "h4", "d4");
			return [sqOf(state, rook), state.enchant.filter((e) => e.key === "trapdoor").length];
		};
		assert.deepEqual(run(() => {}), [null, 0]);
		assert.deepEqual(run((s) => { s.statuses[id(s, "h4")] = [{ s: "warded", left: null, by: "b" }]; }), ["d4", 1]);
		assert.deepEqual(run((s) => { s.enchant.push({ id: "e909", key: "heavy-cavalry", owner: "b", pieces: [id(s, "c6"), id(s, "e5")], left: null, data: {} }); }), ["d4", 1]);
	});

	test("an existing own trap square is not offered again", () => {
		const s = game("4k3/p7/8/8/8/8/8/K7 w - - 0 1", "trapdoor");
		assert.ok(actives(s).some((a) => a.target.square === "h1"));
		const t = pass(play(s, { square: "h1" }).state, "b");
		t.players.w.actives = [{ id: "c92", key: "trapdoor" }];
		const sqs = actives(t).map((a) => a.target.square);
		assert.ok(!sqs.includes("h1") && sqs.includes("h2"));
	});
	test("a shield removed on the first move of a two-move turn: the mover's check is announced and must be answered", () => {
		let s = game("k3r3/8/8/8/8/4R3/8/4K3 b - - 0 1");
		s = cardPlay(s, "b", "trapdoor", { square: "e5" }).state;
		s = cardPlay(s, "w", "double-time").state;
		const r = chess(s, "w", "e3", "e5");
		assert.deepEqual([r.state.board.turn, inCheck(r.state, "w")], ["w", true]);
		assert.deepEqual(ofType(r.events, "check"), [{ type: "check", player: "w" }]);
	});
});
