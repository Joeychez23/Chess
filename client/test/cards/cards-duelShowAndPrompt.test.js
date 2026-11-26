// THE CARD DUEL'S PURE RULES ON THE PLAYER'S SIDE (TASK 20 S3): WHAT EACH ANSWER SHOWS ON THE TABLE (cards/duelShow.js), THE PROMPT'S BUTTONS, THE KEYS' STOPS & WHAT ELSE IS OFFERED (cards/select.js), ON REAL VIEWS OF SEEDED ENGINE DUELS
const { test } = require("node:test");
const assert = require("node:assert/strict");
const S = require("../../src/js/gameplay/cards/select.js");
const { duelSteps } = require("../../src/js/gameplay/cards/duelShow.js");
const { newGame, applyAction, playerView, playerEvents, playerLegal } = require("../../../cards-engine/index.js");
const { fromFen, sqIndex } = require("../../../cards-engine/board.js");
const hand = require("../../../cards-engine/hand.js");
const { register, reset } = require("../../../cards-engine/cards/index.js");

reset();
register(require("../../../cards-engine/cards/active/all-or-nothing.js"));

const RANKS = "23456789TJQKA";
const C = (x) => ({ r: RANKS.indexOf(x[0]) + 2, s: x[1] });
const PICK = (pick) => ({ type: "duel", pick });
const json = (x) => JSON.parse(JSON.stringify(x));

// AN ANSWER AS THE CARD ROUTES GIVE IT TO WHITE (cardsResponse): THE VIEW BEFORE, THE VIEW AFTER, ITS EVENTS & LEGAL LIST, THE STATE GONE ON WITH
function answer(s, player, action) {
	const r = applyAction(s, player, action), state = json(r.state);
	return { s: state, prev: playerView(s, "w"), view: playerView(state, "w"), events: playerEvents(state, r.events, "w"), legal: playerLegal(state, "w"), action: player === "w" ? action : null };
}
const steps = (a) => duelSteps(a.prev, a.view, a.events, a.action);
const SET = { op: "set" }; // THE BOARD & THE TABLE GET THE ANSWER'S VIEW (I1: AFTER ITS FLIPS, RIGHT BEFORE ITS TRAILING DEAL OR END)

// A SEEDED GAME: WHITE (THE PLAYER) PLAYS ALL OR NOTHING (key: A VERSION) ON ITS e4 PAWN (piece: ANOTHER), OR CARD GUY (BLACK) ON ITS e7 PAWN
function duelOn(cardGuy = false, piece = "P", key = "all-or-nothing") {
	const s = newGame({ cardGuy: "b", level: 1300, seed: 1 }), me = cardGuy ? "b" : "w", sq = cardGuy ? "e7" : "e4";
	s.board = fromFen(cardGuy ? "4k3/4p3/8/8/8/8/8/4K3 b - - 0 1" : `4k3/8/8/8/4${piece}3/8/8/4K3 w - - 0 1`);
	const c = hand.newCard(s, key);
	s.players[me].actives = [c];
	return answer(json(s), me, { type: "active", card: c.id, target: { piece: s.board.sq[sqIndex(sq)].id } });
}
const rig = (a, w, b) => { (a.s.duel.spades || a.s.duel).hands = { w: w.map(C), b: b.map(C) }; return a; };

test("duelSteps: the deal, a first pick, a tie, a won round: each duel-flip on the index its player picked, the winner's card outlined, then the view's duel", () => {
	let a = duelOn();
	assert.deepEqual(steps(a), [SET, { op: "deal", duel: a.view.duel }], "All or Nothing played: the deal");
	a = answer(rig(a, ["9c", "Kh", "2d"], ["9s", "4c", "Jd"]).s, "w", PICK(0));
	assert.deepEqual(steps(a), [SET, { op: "deal", duel: a.view.duel }], "a pick the other hasn't matched: nothing flips");
	a = answer(a.s, "b", PICK(0)); // CARD GUY'S ANSWER: 9 AND 9, A TIE
	assert.deepEqual(steps(a), [
		{ op: "flip", player: "w", index: 0, card: C("9c"), won: false },
		{ op: "flip", player: "b", index: 0, card: C("9s"), won: false },
		SET,
		{ op: "deal", duel: a.view.duel },
	]);
	a = answer(answer(a.s, "b", PICK(2)).s, "w", PICK(1)); // CARD GUY PICKS FIRST, THEN THE PLAYER: K OVER J
	assert.deepEqual(steps(a), [
		{ op: "flip", player: "w", index: 1, card: C("Kh"), won: false },
		{ op: "flip", player: "b", index: 2, card: C("Jd"), won: false },
		{ op: "flip", player: "w", index: 1, card: C("Kh"), won: true },
		SET,
		{ op: "deal", duel: a.view.duel },
	]);
	assert.equal(a.view.duel.step, "decide");
});

test("duelSteps: three ties then a spades deal: the last tied flips land on the round's cards, the spades picks on the spades deal's", () => {
	let a = rig(duelOn(), ["9c", "9h", "9d"], ["9s", "9c", "9h"]); // EVERY PICK TIES, THE SUIT SCORES TIE
	for (const i of [0, 1]) { a = answer(answer(a.s, "w", PICK(i)).s, "b", PICK(2 - i)); }
	a = answer(answer(a.s, "w", PICK(2)).s, "b", PICK(0));
	assert.ok(a.view.duel.spades, "the spades deal is up");
	assert.deepEqual(steps(a), [
		{ op: "flip", player: "w", index: 2, card: C("9d"), won: false },
		{ op: "flip", player: "b", index: 0, card: C("9s"), won: false },
		SET,
		{ op: "deal", duel: a.view.duel },
	], "the round's last tie, then the spades deal; no second deal after it");
	a = answer(rig(a, ["Qs", "2s", "4s"], ["5s", "3s", "6s"]).s, "b", PICK(1));
	a = answer(a.s, "w", PICK(0)); // Q OVER 3
	assert.deepEqual(steps(a), [
		{ op: "flip", player: "w", index: 0, card: C("Qs"), won: false },
		{ op: "flip", player: "b", index: 1, card: C("3s"), won: false },
		{ op: "flip", player: "w", index: 0, card: C("Qs"), won: true },
		SET,
		{ op: "deal", duel: a.view.duel },
	]);
});

test("duelSteps: a lost duel is gone from the view: the player's index from the action they sent or the previous view's picks, Card Guy's from the previous view or null when he picked second; then the end", () => {
	let a = rig(duelOn(), ["2c", "3d", "4h"], ["Ac", "Kd", "Qh"]);
	a = answer(answer(a.s, "b", PICK(2)).s, "w", PICK(1)); // CARD GUY FIRST, THE PLAYER'S PICK ENDS IT
	assert.equal(a.view.duel, null);
	assert.deepEqual(steps(a), [
		{ op: "flip", player: "w", index: 1, card: C("3d"), won: false },
		{ op: "flip", player: "b", index: 2, card: C("Qh"), won: false },
		{ op: "flip", player: "b", index: 2, card: C("Qh"), won: true },
		SET,
		{ op: "end" },
	]);
	a = rig(duelOn(), ["2c", "3d", "4h"], ["Ac", "Kd", "Qh"]);
	a = answer(answer(a.s, "w", PICK(1)).s, "b", PICK(2)); // THE PLAYER FIRST, CARD GUY'S PICK ENDS IT: HIS INDEX IS IN NO VIEW
	assert.deepEqual(steps(a), [
		{ op: "flip", player: "w", index: 1, card: C("3d"), won: false },
		{ op: "flip", player: "b", index: null, card: C("Qh"), won: false },
		{ op: "flip", player: "b", index: null, card: C("Qh"), won: true },
		SET,
		{ op: "end" },
	]);
	a = rig(duelOn(), ["9c", "3d", "4h"], ["9s", "Kd", "Qh"]);
	a = answer(answer(a.s, "w", PICK(0)).s, "b", PICK(0)); // A TIE, THEN THE SECOND PICKS: CARD GUY FIRST
	a = answer(answer(a.s, "b", PICK(1)).s, "w", PICK(2));
	assert.deepEqual(steps(a).slice(0, 2).map((x) => [x.player, x.index]), [["w", 2], ["b", 1]], "the second pick's index, not the first's");
});

test("duelSteps: Card Guy's own duel flips his card first; a reload shows the view's duel; an answer with no duel shows nothing", () => {
	let a = duelOn(true);
	assert.deepEqual(steps(a), [SET, { op: "deal", duel: a.view.duel }]);
	a = answer(rig(a, ["9c", "Kh", "2d"], ["9s", "4c", "Jd"]).s, "w", PICK(1));
	a = answer(a.s, "b", PICK(2)); // K OVER J: CARD GUY LOSES HIS DUEL, HIS PICK SECOND (IN NO VIEW)
	assert.deepEqual(steps(a).map((x) => [x.op, x.player, x.index, x.won]), [["flip", "b", null, false], ["flip", "w", 1, false], ["flip", "w", 1, true], ["set", undefined, undefined, undefined], ["end", undefined, undefined, undefined]]);
	const mid = rig(duelOn(), ["9c", "Kh", "2d"], ["9s", "4c", "Jd"]);
	const tied = answer(answer(mid.s, "w", PICK(0)).s, "b", PICK(0));
	assert.deepEqual(duelSteps(null, tied.view, [], null), [SET, { op: "deal", duel: tied.view.duel }], "a reload: the duel as it is");
	assert.deepEqual(duelSteps(tied.view, tied.view, [], null), [SET, { op: "deal", duel: tied.view.duel }], "an answer with no events (a stale 409, a Grace take-back): the view's duel");
	const plain = playerView(newGame({ cardGuy: "b", level: 1300, seed: 1 }), "w");
	assert.deepEqual(duelSteps(plain, plain, [{ type: "move", player: "w", from: "e2", to: "e4" }], null), []);
	assert.deepEqual(duelSteps(null, plain, [], null), []);
});

test("the prompt at each step: nothing while picking or waiting, Knight and Bishop for All or Nothing's choice, Stop and Continue in step decide, with the first button focused", () => {
	const buttons = (a) => (S.asking(a.legal) ? S.lift(a.legal, a.view, null).actions.map((x) => S.label(x, a.view, {})) : []);
	let a = rig(duelOn(), ["9c", "Kh", "2d"], ["9s", "4c", "Jd"]);
	assert.deepEqual(buttons(a), [], "step pick");
	a = answer(a.s, "w", PICK(1));
	assert.deepEqual([a.legal, buttons(a)], [[], []], "waiting for Card Guy's pick");
	a = answer(a.s, "b", PICK(2)); // K OVER J: THE PAWN'S FIRST WIN ASKS KNIGHT OR BISHOP
	assert.deepEqual(buttons(a), ["Knight", "Bishop"]);
	a = answer(a.s, "w", { type: "choice", option: "b" });
	assert.deepEqual(buttons(a), ["Stop", "Continue"]);
	assert.deepEqual(a.legal, [{ type: "duel", stop: true }, { type: "duel", stop: false }]);
	assert.equal(S.promptFocus(a.legal), 0, "the keys focus Stop");
	assert.equal(S.asking([PICK(0), { type: "duel", stop: true }]), false, "not with a pick among them");
	assert.equal(S.asking([]), false);
	let g = answer(rig(duelOn(true), ["9c", "Kh", "2d"], ["9s", "4c", "Jd"]).s, "w", PICK(2));
	g = answer(g.s, "b", PICK(1)); // CARD GUY'S OWN DUEL WON: HIS CHOICE, NOTHING FOR THE PLAYER
	assert.deepEqual([g.legal, buttons(g)], [[], []]);
});

test("the keys' stops while a duel is on: only the player's legal picks, none while waiting or in step decide; no hand card, piece or pile", () => {
	let a = rig(duelOn(), ["9c", "Kh", "2d"], ["9s", "4c", "Jd"]);
	const withPile = (v) => ({ ...v, effects: [{ id: "e1", owner: "w", card: { id: "p9", key: "spite" } }] });
	assert.ok(S.handCards(a.view).length > 0, "the player holds cards");
	assert.deepEqual(S.focusList(a.legal, withPile(a.view), false), [0, 1, 2].map((index) => ({ kind: "duel", index })));
	assert.deepEqual(S.focusList(a.legal, withPile(a.view), true), [0, 1, 2].map((index) => ({ kind: "duel", index })), "under fog too");
	a = answer(a.s, "w", PICK(0));
	assert.deepEqual(S.focusList(a.legal, a.view, false), [], "waiting");
	a = answer(a.s, "b", PICK(0)); // A TIE: THE TWO LEFT
	assert.deepEqual(S.focusList(a.legal, a.view, false), [{ kind: "duel", index: 1 }, { kind: "duel", index: 2 }]);
	a = answer(answer(a.s, "w", PICK(1)).s, "b", PICK(2));
	a = answer(a.s, "w", { type: "choice", option: "n" });
	assert.deepEqual(S.focusList(a.legal, a.view, false), [], "step decide: the prompt has the keys");
});

test("while a duel is on nothing else is offered, under fog too: no lift, no piece, no drag or drop, no pile's drop, nothing dimmed", () => {
	const a = duelOn(), v = { ...a.view, players: { ...a.view.players, w: { ...a.view.players.w, actives: [{ id: "x1", key: "last-stand" }] } } };
	const move = S.handCards(v).find((c) => c.kind === "move");
	for (const hidden of [false, true]) {
		for (const c of S.handCards(v)) { assert.deepEqual(S.lift(a.legal, v, c.id, hidden).actions, [], `${c.id} ${hidden}`); }
		assert.equal(S.pickPiece(a.legal, v, "e4", hidden), null);
		assert.equal(S.pressPick(null, a.legal, v, "e4", hidden), null);
		for (const place of ["spot", "passive", "discard"]) { assert.equal(S.dropPlay(a.legal, v, { from: "hand", id: place === "spot" ? "x1" : move.id }, { side: "mine", place }, hidden), null); }
		assert.deepEqual(S.dimmed(a.legal, v, hidden), []);
	}
	assert.deepEqual(S.pileDrops(a.legal, v, "mine"), []);
});

test("duelSteps: the board and the table get the answer's view once its cards have flipped, right before its trailing deal or end, once per answer", () => {
	const shape = (x) => x.map((st) => st.op + (st.won ? "!" : "")).join(" ");
	let a = rig(duelOn(), ["9c", "Kh", "2d"], ["9s", "4c", "Jd"]);
	assert.equal(shape(steps(a)), "set deal", "the duel starts");
	a = answer(a.s, "w", PICK(0));
	assert.equal(shape(steps(a)), "set deal", "a pick that flips nothing");
	a = answer(a.s, "b", PICK(0));
	assert.equal(shape(steps(a)), "flip flip set deal", "a tie");
	a = answer(answer(a.s, "b", PICK(2)).s, "w", PICK(1));
	assert.equal(shape(steps(a)), "flip flip flip! set deal", "a won round: the promotion shows after the outline");
	a = answer(a.s, "w", { type: "choice", option: "n" });
	assert.equal(shape(steps(a)), "set deal", "the choice");
	a = answer(a.s, "w", { type: "duel", stop: true });
	assert.equal(shape(steps(a)), "set end", "Stop");
	a = rig(duelOn(), ["2c", "3d", "4h"], ["Ac", "Kd", "Qh"]);
	a = answer(answer(a.s, "b", PICK(2)).s, "w", PICK(1));
	assert.equal(shape(steps(a)), "flip flip flip! set end", "a loss: the piece and the hand go after the flips");
	assert.equal(shape(duelSteps(null, a.prev, [], null)), "set deal", "a reload");
});

test("duelSteps: a round won on the suit score that ends the duel outlines all 3 of the winner's round cards before the end; one that goes on leaves them to its deal", () => {
	const tie3 = (a) => { for (const i of [0, 1]) { a = answer(answer(a.s, "w", PICK(i)).s, "b", PICK(i)); } return answer(answer(a.s, "w", PICK(2)).s, "b", PICK(2)); };
	let a = tie3(rig(duelOn(false, "R"), ["9c", "8c", "7c"], ["9s", "8h", "7d"])); // EVERY RANK TIES, 3 CLUBS BEAT 1 OF A SUIT: THE ROOK'S QUEEN ENDS THE DUEL
	assert.equal(a.view.duel, null);
	assert.deepEqual(steps(a), [
		{ op: "flip", player: "w", index: 2, card: C("7c"), won: false },
		{ op: "flip", player: "b", index: null, card: C("7d"), won: false },
		{ op: "flip", player: "w", index: 2, card: C("7c"), won: true },
		{ op: "flip", player: "w", index: 0, card: C("9c"), won: true },
		{ op: "flip", player: "w", index: 1, card: C("8c"), won: true },
		SET,
		{ op: "end" },
	]);
	a = tie3(rig(duelOn(), ["9c", "8h", "7d"], ["9s", "8s", "7s"])); // A LOSS ON THE SUIT SCORE: CARD GUY'S 3 SPADES
	assert.equal(a.view.duel, null);
	assert.deepEqual(steps(a).filter((x) => x.won).map((x) => [x.player, x.index, x.card]), [["b", null, C("7s")], ["b", 0, C("9s")], ["b", 1, C("8s")]]);
	a = tie3(rig(duelOn(false, "N"), ["9c", "8c", "7c"], ["9s", "8h", "7d"])); // THE KNIGHT'S ROOK: THE DUEL GOES ON, ITS DEAL OUTLINES THE 3 (duelLayout)
	assert.equal(a.view.duel.step, "decide");
	assert.deepEqual(steps(a).map((x) => x.op + (x.won ? "!" : "")), ["flip", "flip", "flip!", "set", "deal"]);
});

test("duelSteps: a finished game shows no duel: a view with a result ends the duel, laid or only in the view (a reload of a game forfeited mid-duel)", () => {
	const a = answer(answer(rig(duelOn(), ["9c", "Kh", "2d"], ["9s", "4c", "Jd"]).s, "w", PICK(0)).s, "b", PICK(0));
	const over = playerView({ ...a.s, result: { winner: "b", reason: "forfeit" } }, "w");
	assert.ok(over.duel && over.result, "the finished game's view still has the duel");
	assert.deepEqual(duelSteps(null, over, [], null), [SET, { op: "end" }], "a reload");
	assert.deepEqual(duelSteps(a.view, over, [], null), [SET, { op: "end" }], "an answer that finds the game over");
});

test("askedBy: the prompt's card is the duel's own (a version's), also for All or Nothing's Knight or Bishop, which the engine asks with the base key", () => {
	let a = rig(duelOn(false, "P", "all-or-nothing-epic"), ["9c", "Kh", "2d"], ["9s", "4c", "Jd"]);
	a = answer(answer(a.s, "w", PICK(1)).s, "b", PICK(2));
	assert.equal(a.view.pending.card, "all-or-nothing", "the engine asks with the base key");
	assert.equal(S.askedBy(a.view), "all-or-nothing-epic", "Knight or Bishop");
	a = answer(a.s, "w", { type: "choice", option: "n" });
	assert.equal(S.askedBy(a.view), "all-or-nothing-epic", "Stop or Continue");
	assert.equal(S.askedBy({ pending: { card: "spite" }, duel: null }), "spite", "a choice with no duel");
	assert.equal(S.askedBy({ pending: null, duel: null }), null, "nothing asked");
});
