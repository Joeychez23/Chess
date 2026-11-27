/*
 *  passiveCapture-grace.test.js  --  chess cards engine tests
 *	The passives triggered by captures and checks (cards-engine/cards/passive/), Grace, then removals, card-effect captures and edge cases across the cards, and a Mulligan turn left with no move. Grace stays ahead of the tests that register cards of their own, as before.
 *
 */

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const { legalActions, applyAction, actionKey, playerEvents } = require("../../../../cards-engine/index.js");
const { sqIndex } = require("../../../../cards-engine/board.js");
const { inCheck } = require("../../../../cards-engine/rules.js");
const { makeCtx } = require("../../../../cards-engine/ctx.js");
const { register } = require("../../../../cards-engine/cards/index.js");
const { ofType, id, mv, fired, waits, cardless, game, place, pass, takeD5, PAWN, QUEEN } = require("../../helpers/passiveCapture.js");

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

describe("a Mulligan turn left with no move (after Mulligan the turn is one move)", () => {
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
