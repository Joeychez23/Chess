/*
 *  curses-economy.test.js  --  chess cards engine tests
 *	Debt, Rust and Pact: the curses that cost their holder cards.
 *
 */

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const { legalActions, applyAction } = require("../../../../cards-engine/index.js");
const { makeCtx } = require("../../../../cards-engine/ctx.js");
const hand = require("../../../../cards-engine/hand.js");
const { fresh, game, ofType, at, curse, moveCard, clears, untilTurn } = require("../../helpers/curses.js");

describe("Debt", () => {
	test("after 3 of its holder's turns with no capture, they discard 2 random cards and it is gone", () => {
		const s = fresh(), d = makeCtx(s).giveCurse("b", "debt", "w");
		assert.equal(d.left, 3);
		let r = untilTurn(s, "b", 3);
		assert.equal(r.state.players.b.curses.length, 1);
		assert.ok(!ofType(r.events, "discard").length);
		r = untilTurn(r.state, "b", 1);
		assert.deepEqual(r.state.players.b.curses, []);
		assert.equal(ofType(r.events, "discard").filter((e) => e.player === "b").length, 2);
		assert.deepEqual(ofType(r.events, "curse-cleared").map((e) => e.card.key), ["debt"]);
	});

	test("cleared when its holder captures; not by the opponent capturing, not by a removal", () => {
		const s = game("4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1");
		s.players.w.moves = [moveCard(s, "p")];
		const d = curse(s, "w", "debt", { left: 3 });
		const r = applyAction(s, "w", { type: "move", card: s.players.w.moves[0].id, from: "e4", to: "d5" });
		assert.deepEqual(r.state.players.w.curses, []);
		assert.deepEqual(ofType(r.events, "curse-cleared"), [{ type: "curse-cleared", player: "w", card: d }]);
		const t = game("4k3/8/8/3p4/4P3/8/8/4K3 b - - 0 1");
		t.players.b.moves = [moveCard(t, "p")];
		curse(t, "w", "debt", { left: 3 });
		assert.equal(applyAction(t, "b", { type: "move", card: t.players.b.moves[0].id, from: "d5", to: "e4" }).state.players.w.curses.length, 1);
		const u = game("4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1"), ctx = makeCtx(u);
		curse(u, "w", "debt", { left: 3 });
		ctx.capture("w", at(u, "e4").id); // WHITE GIVES UP ITS OWN PAWN: NOT A CAPTURE
		assert.equal(u.players.w.curses.length, 1);
		assert.deepEqual(clears(game("4k3/8/8/8/8/8/8/4K3 w - - 0 1"), "w"), []);
	});
});

describe("Rust", () => {
	test("its holder's next active has no effect (spent, card-cancelled); then it is gone; the opponent's actives are untouched", () => {
		const s = fresh(), give = hand.newCard(s, "t-give");
		s.players.w.actives = [give];
		const ru = curse(s, "w", "rust"), bru = curse(s, "b", "rust");
		const r = applyAction(s, "w", { type: "active", card: give.id });
		assert.deepEqual(r.state.players.b.curses, [bru]); // THE GIVE NEVER RAN
		assert.ok(!r.state.players.w.actives.some((c) => c.id === give.id));
		assert.deepEqual(ofType(r.events, "card-cancelled").map((e) => e.card.id), [give.id]);
		assert.deepEqual(r.state.players.w.curses, []);
		assert.deepEqual(ofType(r.events, "curse-cleared"), [{ type: "curse-cleared", player: "w", card: ru }]);
		const t = fresh();
		t.players.w.actives = [hand.newCard(t, "t-give")];
		t.players.w.curses = [];
		const q = applyAction(t, "w", { type: "active", card: t.players.w.actives[0].id });
		assert.equal(q.state.players.b.curses.length, 1); // NO RUST: IT WORKS
		assert.deepEqual(clears(s, "w"), []);
	});
});

describe("Pact", () => {
	test("its holder draws 2 move cards when it arrives; after 3 of their turns it becomes Debt (given by the same giver, no wait)", () => {
		const s = fresh(), ctx = makeCtx(s), n = s.players.b.moves.length;
		const p = ctx.giveCurse("b", "pact", "w");
		assert.equal(s.players.b.moves.length, n + 2);
		assert.deepEqual(ctx.events.map((e) => e.type), ["curse-given", "draw", "draw", "curse-fired"]);
		assert.deepEqual(ofType(ctx.events, "draw").map((e) => e.player), ["b", "b"]);
		s.players.w.curseWait = 0;
		let r = untilTurn(s, "b", 3);
		assert.deepEqual(r.state.players.b.curses.map((c) => c.key), ["pact"]);
		r = untilTurn(r.state, "b", 1);
		assert.deepEqual(r.state.players.b.curses.map((c) => [c.key, c.left]), [["debt", 3]]);
		assert.deepEqual(ofType(r.events, "curse-cleared").map((e) => e.card.id), [p.id]);
		assert.deepEqual(ofType(r.events, "curse-given").map((e) => [e.player, e.card.key]), [["w", "debt"]]);
		assert.equal(r.state.players.w.curseWait, 0);
	});

	test("can't be cleared before it turns: no clear action, and Cleanse leaves it", () => {
		const s = fresh(), cl = hand.newCard(s, "cleanse");
		s.players.w.actives = [cl];
		const p = curse(s, "w", "pact", { left: 3 });
		assert.deepEqual(clears(s, "w"), []);
		assert.ok(!legalActions(s, "w").some((a) => a.type === "active"), "Cleanse offers the Pact");
		const sh = curse(s, "w", "shackles");
		const r = applyAction(s, "w", { type: "active", card: cl.id, target: { curses: "all" } });
		assert.deepEqual(r.state.players.w.curses, [p]);
		assert.deepEqual(ofType(r.events, "curse-cleared").map((e) => e.card.id), [sh.id]);
	});
});
