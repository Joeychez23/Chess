/*
 *  cards-duel.test.js  --  chess cards engine tests
 *	All or Nothing (cards-engine/cards/active/all-or-nothing.js) and the card duel it starts (cards-engine/duel.js)
 *
 */

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const { newGame, legalActions, applyAction, actionKey, playerView, playerEvents, fromView, IllegalAction } = require("../../cards-engine/index.js");
const { fromFen, sqIndex } = require("../../cards-engine/board.js");
const hand = require("../../cards-engine/hand.js");
const { register, reset } = require("../../cards-engine/cards/index.js");

reset();
register(require("../../cards-engine/cards/active/all-or-nothing.js"));
register(require("../../cards-engine/cards/active/opposing-finality.js")); // A CLAIMED MARK ON A LOST PIECE
register(require("../../cards-engine/cards/passive/grace.js")); // A DUEL ACTION TAKEN BACK
const { makeCtx } = require("../../cards-engine/ctx.js");
const statuses = require("../../cards-engine/statuses.js");

const ofType = (events, type) => events.filter((e) => e.type === type);
const at = (s, sq) => s.board.sq[sqIndex(sq)];
const RANKS = "23456789TJQKA";
const C = (x) => ({ r: RANKS.indexOf(x[0]) + 2, s: x[1] }); // "As" -> { r: 14, s: "s" }
const PICK = (pick) => ({ type: "duel", pick });
const STOP = { type: "duel", stop: true }, GO = { type: "duel", stop: false };
const roundTrip = (s) => JSON.parse(JSON.stringify(s));

/**
 * @description A fresh game on fen where White holds All or Nothing (or the version key) as its only active; returns { s, id }.
 */
function holding(fen, seed = 1, key = "all-or-nothing") {
	const s = newGame({ vesper: "b", level: 1300, seed });
	s.board = fromFen(fen);
	const c = hand.newCard(s, key);
	s.players.w.actives = [c];
	return { s, id: c.id };
}

/**
 * @description Apply an action; the state comes back through a JSON round trip (the server stores JSON), which must not change it.
 */
function go(s, player, action) {
	const r = applyAction(s, player, action);
	assert.deepEqual(roundTrip(r.state), r.state);
	return { s: roundTrip(r.state), events: r.events };
}

/**
 * @description Start the duel on the piece standing on sq (with All or Nothing, or the version key).
 */
function start(fen, sq, seed, key) {
	const { s, id } = holding(fen, seed, key);
	const piece = at(s, sq).id;
	return { ...go(s, "w", { type: "active", card: id, target: { piece } }), piece };
}

/**
 * @description Set the current set's face-down cards by hand (the main deal, or the spades deal when it is up).
 */
function rig(s, w, b) {
	(s.duel.spades || s.duel).hands = { w: w.map(C), b: b.map(C) };
}

/**
 * @description White picks wi, then Black picks bi; returns the second action's result.
 */
function both(s, wi, bi) {
	return go(go(s, "w", PICK(wi)).s, "b", PICK(bi));
}

const PAWN = "4k3/8/8/8/4P3/8/8/4K3 w - - 0 1", KNIGHT = "4k3/8/8/8/N7/8/8/4K3 w - - 7 1";

describe("All or Nothing: the card duel", () => {
	test("a won round, Bishop chosen, then stop: the piece keeps its id; the turn passes", () => {
		let { s, events, piece } = start(PAWN, "e4");
		assert.deepEqual(ofType(events, "duel-deal"), [{ type: "duel-deal", player: "w", round: 1 }]);
		assert.equal(s.duel.step, "pick");
		assert.equal(s.board.turn, "w");
		assert.deepEqual(legalActions(s, "w"), [PICK(0), PICK(1), PICK(2)]);
		assert.deepEqual(legalActions(s, "b"), [PICK(0), PICK(1), PICK(2)]);
		rig(s, ["As", "2c", "3d"], ["Kh", "4c", "5d"]);
		({ s, events } = go(s, "w", PICK(0)));
		assert.deepEqual(ofType(events, "duel-flip"), []);
		assert.deepEqual(legalActions(s, "w"), []); // WAITING FOR BLACK'S PICK
		({ s, events } = go(s, "b", PICK(2)));
		assert.deepEqual(ofType(events, "duel-flip"), [{ type: "duel-flip", player: "w", card: C("As") }, { type: "duel-flip", player: "b", card: C("5d") }]);
		assert.deepEqual(ofType(events, "duel-result"), [{ type: "duel-result", winner: "w" }]);
		assert.equal(s.pending.kind, "all-or-nothing");
		assert.deepEqual(legalActions(s, "w"), [{ type: "choice", option: "n" }, { type: "choice", option: "b" }]);
		({ s, events } = go(s, "w", { type: "choice", option: "b" }));
		assert.deepEqual(ofType(events, "promote"), [{ type: "promote", player: "w", piece, t: "b" }]);
		assert.deepEqual(at(s, "e4"), { id: piece, c: "w", t: "b" });
		assert.equal(s.duel.step, "decide");
		assert.equal(s.duel.wins, 1);
		assert.deepEqual(legalActions(s, "w"), [STOP, GO]);
		assert.deepEqual(legalActions(s, "b"), []);
		({ s, events } = go(s, "w", STOP));
		assert.equal(s.duel, null);
		assert.equal(s.board.turn, "b");
		assert.equal(s.board.half, 1);
		assert.deepEqual(at(s, "e4"), { id: piece, c: "w", t: "b" });
		assert.ok(ofType(events, "turn-start").some((e) => e.player === "b"));
	});

	test("three wins in a row take a pawn to Queen; the duel then ends by itself", () => {
		let { s, events, piece } = start(PAWN, "e4");
		const promotes = [];
		rig(s, ["As", "2c", "3d"], ["Kh", "4c", "5d"]);
		({ s, events } = both(s, 0, 0));
		({ s, events } = go(s, "w", { type: "choice", option: "n" }));
		promotes.push(...ofType(events, "promote"));
		for (const round of [2, 3]) {
			({ s, events } = go(s, "w", GO));
			assert.deepEqual(ofType(events, "duel-deal"), [{ type: "duel-deal", player: "w", round }]);
			rig(s, ["Qs", "2c", "3d"], ["Jh", "4c", "5d"]);
			({ s, events } = both(s, 0, 1));
			promotes.push(...ofType(events, "promote"));
		}
		assert.deepEqual(promotes.map((e) => [e.piece, e.t]), [[piece, "n"], [piece, "r"], [piece, "q"]]);
		assert.equal(s.duel, null);
		assert.equal(s.board.turn, "b");
		assert.deepEqual(at(s, "e4"), { id: piece, c: "w", t: "q" });
	});

	test("a loss: the piece is taken, 6 random cards are forfeit and not refilled this turn; half 0", () => {
		let { s, events, piece } = start(KNIGHT, "a4");
		const p = s.players.w, before = p.moves.length + p.actives.length + (p.passive ? 1 : 0);
		rig(s, ["2c", "3c", "4c"], ["Ac", "Kc", "Qc"]);
		({ s, events } = both(s, 1, 0));
		assert.deepEqual(ofType(events, "duel-result"), [{ type: "duel-result", winner: "b" }]);
		assert.equal(ofType(events, "discard").filter((e) => e.player === "w").length, 6);
		assert.deepEqual(ofType(events, "capture"), [{ type: "capture", player: "w", piece, t: "n", c: "w", by: null, sq: "a4" }]); // A REMOVAL: THE PIECE'S OWN PLAYER, NOT A CAPTURE BY THE WINNER
		assert.equal(at(s, "a4"), null);
		const q = s.players.w;
		assert.equal(q.moves.length + q.actives.length + (q.passive ? 1 : 0), before - 6);
		assert.deepEqual(ofType(events, "draw").filter((e) => e.player === "w"), []); // NOT REFILLED THIS TURN
		assert.equal(s.duel, null);
		assert.equal(s.board.turn, "b");
		assert.equal(s.board.half, 0); // A CAPTURE OUTSIDE A CHESS MOVE
	});

	test("a tie on pick 1 is decided on pick 2", () => {
		let { s, events, piece } = start(KNIGHT, "a4");
		rig(s, ["Ks", "9h", "2c"], ["Kh", "5d", "3c"]);
		({ s, events } = both(s, 0, 0));
		assert.equal(ofType(events, "duel-flip").length, 2);
		assert.deepEqual(ofType(events, "duel-result"), []);
		assert.deepEqual(legalActions(s, "w"), [PICK(1), PICK(2)]);
		assert.deepEqual(legalActions(s, "b"), [PICK(1), PICK(2)]);
		({ s, events } = both(s, 1, 1));
		assert.deepEqual(ofType(events, "duel-result"), [{ type: "duel-result", winner: "w" }]);
		assert.deepEqual(ofType(events, "promote"), [{ type: "promote", player: "w", piece, t: "r" }]); // A KNIGHT SKIPS THE KNIGHT-OR-BISHOP STEP
	});

	test("all three tied in rank: the suit score decides", () => {
		let { s, events } = start(KNIGHT, "a4");
		rig(s, ["Ac", "Jc", "5d"], ["Ah", "Jd", "5s"]); // WHITE SCORES 2, BLACK 1
		({ s } = both(s, 0, 0));
		({ s } = both(s, 1, 1));
		({ s, events } = both(s, 2, 2));
		assert.deepEqual(ofType(events, "duel-result"), [{ type: "duel-result", winner: "w" }]);
		({ s, events } = start(KNIGHT, "a4", 2));
		rig(s, ["Ah", "Jd", "5s"], ["Ac", "Jc", "5c"]); // BLACK SCORES 3
		({ s } = both(s, 2, 2));
		({ s } = both(s, 1, 1));
		({ s, events } = both(s, 0, 0));
		assert.deepEqual(ofType(events, "duel-result"), [{ type: "duel-result", winner: "b" }]);
	});

	test("suit scores tied: a 13-spade deal decides it", () => {
		let { s, events, piece } = start(KNIGHT, "a4");
		rig(s, ["Ac", "Jd", "5h"], ["Ad", "Jh", "5c"]); // BOTH SCORE 1
		({ s } = both(s, 0, 0));
		({ s } = both(s, 1, 1));
		({ s, events } = both(s, 2, 2));
		assert.equal(ofType(events, "duel-flip").length, 2);
		assert.deepEqual(ofType(events, "duel-result"), []);
		assert.deepEqual(ofType(events, "duel-deal"), [{ type: "duel-deal", player: "w", round: 1, spades: true }]);
		const sp = s.duel.spades, cards = [...sp.hands.w, ...sp.hands.b, ...sp.deck];
		assert.equal(sp.hands.w.length, 3);
		assert.equal(sp.hands.b.length, 3);
		assert.ok(cards.every((c) => c.s === "s"));
		assert.deepEqual(cards.map((c) => c.r).sort((a, b) => a - b), Array.from({ length: 13 }, (_, i) => i + 2));
		assert.deepEqual(legalActions(s, "w"), [PICK(0), PICK(1), PICK(2)]);
		rig(s, ["2s", "3s", "4s"], ["Ks", "Qs", "Js"]);
		({ s, events } = both(s, 0, 0));
		assert.deepEqual(ofType(events, "duel-flip").map((e) => e.card), [C("2s"), C("Ks")]);
		assert.deepEqual(ofType(events, "duel-result"), [{ type: "duel-result", winner: "b" }]);
		assert.equal(ofType(events, "capture")[0].piece, piece);
		assert.equal(s.duel, null);
	});

	test("a rook goes straight to Queen in one win, and its castling right goes", () => {
		let { s, events, piece } = start("4k3/8/8/8/8/8/8/4K2R w K - 0 1", "h1");
		rig(s, ["As", "2c", "3d"], ["Kh", "4c", "5d"]);
		({ s, events } = both(s, 0, 0));
		assert.deepEqual(ofType(events, "choice"), []);
		assert.deepEqual(ofType(events, "promote"), [{ type: "promote", player: "w", piece, t: "q" }]);
		assert.deepEqual(at(s, "h1"), { id: piece, c: "w", t: "q" });
		assert.equal(s.duel, null);
		assert.equal(s.board.turn, "b");
		assert.equal(s.board.castling, "-");
	});

	test("an upgrade that gives check: exactly one check event, also through the choice", () => {
		let { s, events } = start("4k3/8/8/8/4N3/8/8/4K3 w - - 0 1", "e4");
		rig(s, ["As", "2c", "3d"], ["Kh", "4c", "5d"]);
		({ s, events } = both(s, 0, 0)); // KNIGHT TO ROOK ON THE OPEN e-FILE
		assert.deepEqual(ofType(events, "check"), [{ type: "check", player: "b" }]);
		({ s, events } = go(s, "w", GO));
		rig(s, ["As", "2c", "3d"], ["Kh", "4c", "5d"]);
		({ s, events } = both(s, 0, 0)); // ROOK TO QUEEN: THE CHECK ALREADY STOOD
		assert.deepEqual(ofType(events, "check"), []);
		assert.equal(s.board.turn, "b");
		assert.ok(legalActions(s, "b").length > 0);
		({ s, events } = start("4k3/8/2P5/8/8/8/8/4K3 w - - 0 1", "c6"));
		rig(s, ["As", "2c", "3d"], ["Kh", "4c", "5d"]);
		({ s, events } = both(s, 0, 0));
		assert.deepEqual(ofType(events, "check"), []);
		({ s, events } = go(s, "w", { type: "choice", option: "b" })); // BISHOP ON c6 CHECKS e8
		assert.deepEqual(ofType(events, "check"), [{ type: "check", player: "b" }]);
	});

	test("the views hide the deck and every face-down card from both players; the events carry none", () => {
		let { s, events } = start(PAWN, "e4");
		const hidden = (v) => { assert.equal(v.duel.deck, undefined); assert.equal(v.rng, undefined); };
		for (const c of ["w", "b"]) {
			const v = playerView(s, c);
			hidden(v);
			assert.deepEqual(v.duel.hands, { w: [null, null, null], b: [null, null, null] });
			assert.deepEqual(ofType(playerEvents(s, events, c), "duel-deal"), [{ type: "duel-deal", player: "w", round: 1 }]);
		}
		assert.equal(s.duel.deck.length, 46);
		rig(s, ["As", "2c", "3d"], ["Kh", "2h", "5d"]);
		({ s, events } = go(s, "w", PICK(1)));
		for (const c of ["w", "b"]) {
			const v = playerView(s, c);
			hidden(v);
			assert.deepEqual(v.duel.hands, { w: [null, null, null], b: [null, null, null] }); // PICKED, NOT YET FLIPPED
			assert.deepEqual(v.duel.picked, { w: [1], b: [] });
			assert.deepEqual(playerEvents(s, events, c).filter((e) => e.type.startsWith("duel")), []);
		}
		({ s, events } = go(s, "b", PICK(1))); // A TIE: THE DUEL GOES ON WITH BOTH PICKS FACE UP
		for (const c of ["w", "b"]) {
			const v = playerView(s, c);
			hidden(v);
			assert.deepEqual(v.duel.hands, { w: [null, C("2c"), null], b: [null, C("2h"), null] });
			assert.deepEqual(ofType(playerEvents(s, events, c), "duel-flip").map((e) => e.card), [C("2c"), C("2h")]);
		}
		// SPADES: SAME HIDING
		({ s } = start(KNIGHT, "a4"));
		rig(s, ["Ac", "Jd", "5h"], ["Ad", "Jh", "5c"]);
		for (const i of [0, 1, 2]) ({ s, events } = both(s, i, i));
		for (const c of ["w", "b"]) {
			const v = playerView(s, c);
			hidden(v);
			assert.equal(v.duel.spades.deck, undefined);
			assert.deepEqual(v.duel.spades.hands, { w: [null, null, null], b: [null, null, null] });
			assert.deepEqual(v.duel.hands, { w: [C("Ac"), C("Jd"), C("5h")], b: [C("Ad"), C("Jh"), C("5c")] });
			assert.deepEqual(ofType(playerEvents(s, events, c), "duel-deal"), [{ type: "duel-deal", player: "w", round: 1, spades: true }]);
		}
		assert.equal(s.duel.spades.deck.length, 7);
		// THE KNIGHT-OR-BISHOP CHOICE SHOWS IN FULL ONLY TO ITS PLAYER
		({ s } = start(PAWN, "e4"));
		rig(s, ["As", "2c", "3d"], ["Kh", "4c", "5d"]);
		({ s } = both(s, 0, 0));
		assert.deepEqual(playerView(s, "b").pending, { player: "w", kind: "all-or-nothing" });
		assert.deepEqual(playerView(s, "w").pending.options, ["n", "b"]);
	});

	test("a JSON round trip mid-duel continues the same duel; fromView fills the hidden cards", () => {
		const { s: s0 } = start(PAWN, "e4", 9);
		const { s: s1 } = go(s0, "w", PICK(2));
		const a = applyAction(s1, "b", PICK(1)), b = applyAction(roundTrip(s1), "b", PICK(1));
		assert.deepEqual(b, a);
		const f = fromView(playerView(s1, "b"), 5);
		const all = [...f.duel.hands.w, ...f.duel.hands.b, ...f.duel.deck].map((c) => c.r + c.s);
		assert.equal(all.length, 52);
		assert.equal(new Set(all).size, 52);
		assert.deepEqual(legalActions(f, "b"), [PICK(0), PICK(1), PICK(2)]);
		assert.ok(applyAction(f, "b", PICK(0)).events.some((e) => e.type === "duel-flip"));
	});

	test("targets: no queen, king or piece whose loss would expose the own king; never in check", () => {
		const { s } = holding("4r1k1/8/8/8/8/8/4B3/Q3K2N w - - 0 1"); // THE BISHOP ON e2 IS PINNED
		const offered = legalActions(s, "w").filter((a) => a.type === "active").map((a) => a.target.piece);
		assert.deepEqual(offered, [at(s, "h1").id]);
		const c = holding("4k3/8/8/8/8/8/4r3/N3K3 w - - 0 1");
		assert.deepEqual(legalActions(c.s, "w").filter((a) => a.type === "active"), []);
	});

	test("only duel actions while it lasts, validated for both players", () => {
		let { s } = start(KNIGHT, "a4");
		assert.ok(legalActions(s, "w").every((a) => a.type === "duel"));
		for (const [pl, a] of [["w", STOP], ["b", STOP], ["b", PICK(3)], ["w", { type: "move", card: "king", from: "e1", to: "e2" }]]) {
			assert.throws(() => applyAction(s, pl, a), IllegalAction);
		}
		({ s } = go(s, "b", PICK(1))); // VESPER MAY PICK FIRST
		assert.throws(() => applyAction(s, "b", PICK(0)), IllegalAction);
		rig(s, ["As", "2c", "3d"], ["Kh", "4c", "5d"]);
		({ s } = go(s, "w", PICK(0)));
		assert.equal(s.duel.step, "decide");
		assert.throws(() => applyAction(s, "b", GO), IllegalAction);
		assert.throws(() => applyAction(s, "w", PICK(1)), IllegalAction);
	});

	test("seeded duels never get stuck and always end the turn", () => {
		const outcomes = new Set();
		for (let seed = 1; seed <= 40; seed++) {
			let { s, piece } = start(PAWN, "e4", seed);
			for (let i = 0; s.duel || s.pending; i++) {
				assert.ok(i < 60, "duel too long");
				const opts = ["w", "b"].flatMap((pl) => legalActions(s, pl).map((a) => [pl, a]));
				assert.ok(opts.length > 0, "stuck mid-duel");
				const [pl, a] = opts[(seed * 7 + i * 3) % opts.length];
				({ s } = go(s, pl, a.type === "duel" && a.stop !== undefined ? (s.duel.wins < 2 ? GO : STOP) : a));
			}
			assert.equal(s.board.turn, "b");
			const q = s.board.sq.find((x) => x && x.id === piece);
			outcomes.add(q ? q.t : "lost");
		}
		assert.ok(outcomes.has("lost"));
		assert.ok([...outcomes].some((t) => t !== "lost" && t !== "p"));
	});
	test("a lost Marked piece pays no one: losing the duel is a removal, not a capture by the winner", () => {
		let { s, events, piece } = start(KNIGHT, "a4");
		s.statuses[piece] = [{ s: "marked", left: 3 }];
		s.players.w.moves.push({ id: "x1", key: "move", piece: "p" }, { id: "x2", key: "move", piece: "p" }, { id: "x3", key: "move", piece: "p" }); // CARDS LEFT AFTER THE FORFEIT, FOR MARKED TO TAKE IF IT FIRED
		const blackMoves = s.players.b.moves.length;
		rig(s, ["2c", "3c", "4c"], ["Ac", "Kc", "Qc"]);
		({ s, events } = both(s, 1, 0));
		assert.equal(at(s, "a4"), null);
		assert.equal(ofType(events, "discard").filter((e) => e.player === "w").length, 6); // THE FORFEIT ONLY, NOT 2 MORE FOR MARKED
		assert.deepEqual(ofType(events, "draw").filter((e) => e.player === "b"), []);
		assert.equal(s.players.b.moves.length, blackMoves);
	});

	test("a lost piece that was shielding the enemy king from a rook: one check event, the turn passes, half 0", () => {
		// WHITE ROOK e1, WHITE KNIGHT e4 IN FRONT OF IT, BLACK KING e8
		let { s, events } = start("4k3/8/8/8/4N3/8/8/K3R3 w - - 7 1", "e4");
		rig(s, ["2c", "3c", "4c"], ["Ac", "Kc", "Qc"]);
		({ s, events } = both(s, 1, 0));
		assert.equal(at(s, "e4"), null);
		assert.deepEqual(ofType(events, "check"), [{ type: "check", player: "b" }]);
		assert.equal(s.board.turn, "b");
		assert.equal(s.board.half, 0);
	});

	test("Black starts a duel too: Black is the duel's player, wins and stops", () => {
		const s0 = newGame({ vesper: "b", level: 1300, seed: 1 });
		s0.board = fromFen("4k3/8/8/4p3/8/8/8/4K3 b - - 0 1");
		const c = hand.newCard(s0, "all-or-nothing");
		s0.players.b.actives = [c];
		const piece = at(s0, "e5").id;
		let { s } = go(s0, "b", { type: "active", card: c.id, target: { piece } });
		assert.equal(s.duel.player, "b");
		rig(s, ["2c", "3c", "4c"], ["Ac", "Kc", "Qc"]);
		let r = go(go(s, "b", PICK(0)).s, "w", PICK(0));
		assert.deepEqual(ofType(r.events, "duel-result"), [{ type: "duel-result", winner: "b" }]);
		r = go(r.s, "b", { type: "choice", option: "n" });
		r = go(r.s, "b", STOP);
		assert.deepEqual(at(r.s, "e5"), { id: piece, c: "b", t: "n" });
		assert.equal(r.s.duel, null);
		assert.equal(r.s.board.turn, "w");
	});
	test("a barred pick (Grace took its mate back) is left out while another pick remains", () => {
		const { s } = start(KNIGHT, "a4");
		assert.equal(legalActions(s, "w").length, 3);
		s.barred = actionKey(PICK(1));
		assert.deepEqual(legalActions(s, "w"), [PICK(0), PICK(2)]);
		assert.equal(legalActions(s, "b").length, 3); // THE BAR IS ON THE PLAYER WHOSE TURN IT IS, NOT ON THE OTHER PLAYER'S SAME PICK
	});

	test("a barred pick that is the only pick left is still offered: the duel can't stall", () => {
		let { s } = start(KNIGHT, "a4");
		rig(s, ["2c", "3c", "4c"], ["2d", "3d", "4d"]);
		({ s } = both(s, 0, 0)); // TIE
		({ s } = both(s, 1, 1)); // TIE
		s.barred = actionKey(PICK(2));
		assert.deepEqual(legalActions(s, "w"), [PICK(2)]);
	});

	test("a barred stop (Grace took it back) is barred at that decision only: the next round's decision offers it again", () => {
		let { s } = start(PAWN, "e4");
		rig(s, ["As", "2c", "3d"], ["Kh", "4c", "5d"]);
		({ s } = both(s, 0, 0));
		({ s } = go(s, "w", { type: "choice", option: "n" }));
		s.barred = actionKey(STOP); // AS IF GRACE TOOK BACK A MATING STOP HERE
		assert.deepEqual(legalActions(s, "w"), [GO]);
		({ s } = go(s, "w", GO));
		assert.equal(s.barred, null);
		rig(s, ["Qs", "2c", "3d"], ["Jh", "4c", "5d"]);
		({ s } = both(s, 0, 1));
		assert.equal(s.duel.step, "decide");
		assert.deepEqual(legalActions(s, "w"), [STOP, GO]);
	});

	test("Grace taking back a mating stop leaves the duel open: no redraw for a duel player with no turn action", () => {
		let { s } = start("N6k/6pp/8/8/8/8/8/4K3 w - - 0 1", "a8");
		rig(s, ["As", "2c", "3d"], ["Kh", "4c", "5d"]);
		({ s } = both(s, 0, 0)); // KNIGHT TO ROOK ON a8: BACK-RANK MATE ONCE THE DUEL ENDS
		Object.assign(s.players.w, { king: false, moves: [], actives: [], used: ["all-or-nothing", "opposing-finality"] }); // NO ACTIVE LEFT TO DRAW: GRACE'S DRAW GIVES NO CARD ACTION
		s.effects.push({ id: "g1", owner: "b", card: { id: "g1", key: "grace" }, placedAt: s.ply });
		const { s: u, events } = go(s, "w", STOP);
		assert.ok(events.some((e) => e.type === "passive-fired" && e.card.key === "grace"));
		assert.equal(u.result, null);
		assert.deepEqual(ofType(events, "redraw"), []);
		assert.deepEqual(legalActions(u, "w"), [GO]);
	});

	test("a lost Opposing Finality piece whose timed Mark the enchantment took over pays no one: the Mark is not put back", () => {
		const { s: s0, id: aon } = holding(KNIGHT), piece = at(s0, "a4").id, ctx = makeCtx(s0);
		s0.statuses[piece] = [{ s: "marked", left: 2, by: "b" }];
		statuses.claimMark(ctx, ctx.enchant("w", "opposing-finality", [piece]), piece); // AS ITS PLAY DOES
		let { s, events } = go(ctx.state, "w", { type: "active", card: aon, target: { piece } });
		s.players.w.moves.push({ id: "x1", key: "move", piece: "p" }, { id: "x2", key: "move", piece: "p" }, { id: "x3", key: "move", piece: "p" }); // CARDS LEFT AFTER THE FORFEIT, FOR MARKED TO TAKE IF IT FIRED
		rig(s, ["2c", "3c", "4c"], ["Ac", "Kc", "Qc"]);
		({ s, events } = both(s, 1, 0));
		assert.equal(at(s, "a4"), null);
		assert.deepEqual(s.enchant, []);
		assert.deepEqual(ofType(events, "status"), []);
		assert.equal(ofType(events, "discard").filter((e) => e.player === "w").length, 6); // THE FORFEIT ONLY
	});
});

describe("All or Nothing versions: the stakes of a lost hand", () => {
	const EPIC = "all-or-nothing-epic", LEGENDARY = "all-or-nothing-legendary";
	const count = (p) => p.moves.length + p.actives.length + (p.passive ? 1 : 0);

	/**
	 * @description Win one hand (Bishop chosen) and play on: the duel at its second deal, the piece already a bishop.
	 */
	function oneWin(key, seed) {
		let { s, piece } = start(PAWN, "e4", seed, key);
		rig(s, ["As", "2c", "3d"], ["Kh", "4c", "5d"]);
		({ s } = both(s, 0, 0));
		({ s } = go(s, "w", { type: "choice", option: "b" }));
		({ s } = go(s, "w", GO));
		return { s, piece };
	}

	/**
	 * @description Lose the current hand: White picks its low card, Black its Ace.
	 */
	function lose(s) {
		rig(s, ["2c", "3c", "4c"], ["Ac", "Kc", "Qc"]);
		return both(s, 1, 0);
	}

	test("the duel records the played key", () => {
		assert.equal(start(PAWN, "e4", 1).s.duel.card, "all-or-nothing");
		assert.equal(start(PAWN, "e4", 1, EPIC).s.duel.card, EPIC);
		assert.equal(start(PAWN, "e4", 1, LEGENDARY).s.duel.card, LEGENDARY);
	});

	test("epic: a lost hand forfeits the piece but no cards, and the refill isn't held back", () => {
		let { s, events, piece } = start(KNIGHT, "a4", 1, EPIC);
		const before = count(s.players.w);
		({ s, events } = lose(s));
		assert.deepEqual(ofType(events, "duel-result"), [{ type: "duel-result", winner: "b" }]);
		assert.deepEqual(ofType(events, "capture"), [{ type: "capture", player: "w", piece, t: "n", c: "w", by: null, sq: "a4" }]);
		assert.equal(at(s, "a4"), null);
		assert.deepEqual(ofType(events, "discard"), []);
		assert.ok(count(s.players.w) >= before);
		assert.equal(s.players.w.refillLock, 0); // NO CARDS LOST: THE NORMAL REFILL RUNS
		assert.equal(s.players.w.actives.length, 1);
		assert.equal(s.duel, null);
		assert.equal(s.board.turn, "b");
	});

	test("legendary: a piece shielding the own king may be chosen (it is never lost); epic may not", () => {
		const PIN = "4r1k1/8/8/8/8/8/4B3/Q3K2N w - - 0 1"; // THE BISHOP ON e2 IS PINNED
		const offered = (key) => { const { s } = holding(PIN, 1, key); return legalActions(s, "w").filter((x) => x.type === "active").map((x) => x.target.piece).sort(); };
		const { s } = holding(PIN);
		assert.deepEqual(offered(LEGENDARY), [at(s, "e2").id, at(s, "h1").id].sort());
		assert.deepEqual(offered(EPIC), [at(s, "h1").id]);
	});

	test("legendary: a lost hand forfeits 6 cards but not the piece, which keeps the upgrade won earlier", () => {
		let { s, piece } = oneWin(LEGENDARY, 1), events;
		const before = count(s.players.w);
		({ s, events } = lose(s));
		assert.deepEqual(ofType(events, "duel-result"), [{ type: "duel-result", winner: "b" }]);
		assert.deepEqual(ofType(events, "capture"), []);
		assert.deepEqual(at(s, "e4"), { id: piece, c: "w", t: "b" }); // THE BASE CARD NEVER UNDOES A WON UPGRADE; ONLY THE FORFEIT IS LIFTED
		assert.equal(ofType(events, "discard").filter((e) => e.player === "w").length, 6);
		assert.equal(count(s.players.w), before - 6);
		assert.deepEqual(ofType(events, "draw").filter((e) => e.player === "w"), []); // NOT REFILLED THIS TURN
		assert.equal(s.duel, null);
		assert.equal(s.board.turn, "b");
		assert.equal(s.board.half, 1); // NO CAPTURE: THE COUNT GOES ON
	});

	test("a won duel plays as the base card for both versions", () => {
		const run = (key) => {
			let { s, piece } = oneWin(key, 3), events;
			rig(s, ["Qs", "2c", "3d"], ["Jh", "4c", "5d"]);
			({ s, events } = both(s, 0, 1));
			const promotes = ofType(events, "promote");
			({ s, events } = go(s, "w", STOP));
			return { promotes, piece: at(s, "e4"), duel: s.duel, turn: s.board.turn, w: count(s.players.w), discards: ofType(events, "discard") };
		};
		const base = run("all-or-nothing");
		assert.equal(base.piece.t, "r");
		assert.deepEqual(run(EPIC), base);
		assert.deepEqual(run(LEGENDARY), base);
	});

	test("a JSON round trip mid-duel, and fromView, keep each version's stakes", () => {
		for (const key of [EPIC, LEGENDARY]) {
			const { s: s0, piece } = oneWin(key, 5);
			for (const s1 of [roundTrip(s0), fromView(playerView(s0, "w"), 7)]) {
				assert.equal(s1.duel.card, key);
				const { s, events } = lose(s1);
				const discards = ofType(events, "discard").filter((e) => e.player === "w").length;
				if (key === EPIC) {
					assert.equal(at(s, "e4"), null);
					assert.equal(discards, 0);
				} else {
					assert.deepEqual(at(s, "e4"), { id: piece, c: "w", t: "b" });
					assert.equal(discards, 6);
				}
			}
		}
	});
});
