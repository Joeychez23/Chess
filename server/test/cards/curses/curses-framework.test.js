/*
 *  curses-framework.test.js  --  chess cards engine tests
 *	The curse framework in ctx.js: giving (the limit, the wait, a curse's own fields), the rarity-weighted pick and the one clear path.
 *
 */

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const { applyAction } = require("../../../../cards-engine/index.js");
const { makeCtx, canCurse } = require("../../../../cards-engine/ctx.js");
const hand = require("../../../../cards-engine/hand.js");
const { register, CARDS, CURSE_KEYS, RARITY_WEIGHTS } = require("../../../../cards-engine/cards/index.js");
const { LOG, fresh, game, ofType, curse, firstMove } = require("../../helpers/curses.js");

describe("the curse framework", () => {
	test("register refuses a curse without a known rarity, like any other card", () => {
		assert.throws(() => register({ key: "t-bare", kind: "curse", name: "t-bare", text: "" }), /no known rarity/);
		assert.throws(() => register({ key: "t-odd", kind: "curse", name: "t-odd", text: "", rarity: "mythic" }), /no known rarity/);
		assert.ok(!CURSE_KEYS.includes("t-bare") && !CURSE_KEYS.includes("t-odd"));
		for (const k of ["dead-weight", "traitors-mark", "tremor", "shackles"]) assert.ok(CARDS[k].rarity in RARITY_WEIGHTS, k);
		assert.deepEqual(["dead-weight", "traitors-mark", "tremor", "shackles"].map((k) => CARDS[k].rarity), ["uncommon", "common", "common", "common"]);
	});

	test("the limit: a third curse is refused (nothing changes, no event); the giver waits; canCurse is the one test", () => {
		const s = fresh(), ctx = makeCtx(s);
		assert.ok(canCurse(s, "b", "w"));
		const c1 = ctx.giveCurse("b", "dead-weight", "w");
		assert.ok(c1 && c1.key === "dead-weight");
		assert.equal(s.players.w.curseWait, 6); // GIVEN ON WHITE'S OWN TURN BEFORE ITS TICK (THE GIVING TURN DOESN'T COUNT)
		assert.ok(!canCurse(s, "b", "w"));
		assert.equal(ctx.giveCurse("b", "shackles", "w"), false); // THE GIVER WAITS
		s.players.w.curseWait = 0;
		assert.ok(ctx.giveCurse("b", "shackles", "w"));
		s.players.w.curseWait = 0;
		const before = JSON.stringify(s), n = ctx.events.length;
		assert.ok(!canCurse(s, "b", "w"));
		assert.equal(ctx.giveCurse("b", "tremor", "w"), false); // BLACK HOLDS 2: THE THIRD IS REFUSED
		assert.equal(JSON.stringify(s), before);
		assert.equal(ctx.events.length, n);
		assert.deepEqual(s.players.b.curses.map((c) => c.key), ["dead-weight", "shackles"]);
	});

	test("the wait: after giving, the giver's next 5 own turns can't give, the 6th can", () => {
		let s = fresh(3);
		s.players.w.actives = [hand.newCard(s, "t-give")];
		s = applyAction(s, "w", { type: "active", card: s.players.w.actives[0].id }).state;
		assert.equal(s.players.b.curses.length, 1);
		s.players.b.curses = []; // SO ONLY THE WAIT CAN BLOCK
		const can = [];
		for (let i = 0; i < 6; i++) {
			s = applyAction(s, "b", firstMove(s, "b")).state;
			can.push(canCurse(s, "b", "w"));
			if (i < 5) s = applyAction(s, "w", firstMove(s, "w")).state;
		}
		assert.deepEqual(can, [false, false, false, false, false, true]);
	});

	test("options relax the limit: a raised maximum and no wait (Hexcraft's legendary, Bad Omen's epic); such a give starts no wait", () => {
		const s = fresh(), ctx = makeCtx(s);
		for (const k of ["dead-weight", "shackles", "tremor"]) curse(s, "b", k);
		s.players.w.curseWait = 3;
		assert.ok(!canCurse(s, "b", "w"));
		assert.ok(!canCurse(s, "b", "w", { max: 4 })); // STILL WAITS
		assert.ok(canCurse(s, "b", "w", { max: 4, wait: false }));
		assert.ok(ctx.giveCurse("b", "traitors-mark", "w", { max: 4, wait: false }));
		assert.equal(s.players.w.curseWait, 3); // IGNORING THE WAIT DOESN'T START ONE
		assert.equal(ctx.giveCurse("b", "rust", "w", { max: 4, wait: false }), false); // 4 HELD
		assert.ok(ctx.giveCurse("b", "rust", "w", { max: Infinity, wait: false }));
		assert.equal(s.players.b.curses.length, 5);
		assert.equal(JSON.parse(JSON.stringify(s)).players.b.curses.length, 5);
	});

	test("giveCurse builds a curse's own fields through its make(ctx, to)", () => {
		const s = fresh(), ctx = makeCtx(s);
		const c = ctx.giveCurse("b", "t-made", "w");
		assert.equal(c.piece, "n");
		assert.ok(Number.isInteger(c.roll));
		assert.deepEqual(s.players.b.curses[0], c);
		assert.deepEqual(ofType(ctx.events, "curse-given"), [{ type: "curse-given", player: "w", card: c }]);
	});

	test("a random curse is picked by RARITY_WEIGHTS through state.rng; n picks are n different curses", () => {
		const s = fresh(7), ctx = makeCtx(s), count = {}, N = 6000;
		for (let i = 0; i < N; i++) { const [k] = ctx.randomCurses(1); count[k] = (count[k] || 0) + 1; }
		const w = (k) => RARITY_WEIGHTS[CARDS[k].rarity], total = CURSE_KEYS.reduce((t, k) => t + w(k), 0);
		for (const k of CURSE_KEYS) assert.ok(Math.abs((count[k] || 0) / N - w(k) / total) < 0.03, k + " " + count[k]);
		assert.ok(count["traitors-mark"] > 3 * count["t-crown"]); // COMMON 12 AGAINST EPIC 2
		const two = ctx.randomCurses(2);
		assert.equal(new Set(two).size, 2);
		assert.deepEqual(new Set(ctx.randomCurses(99)), new Set(CURSE_KEYS)); // NO MORE THAN THERE ARE
		assert.deepEqual(makeCtx(fresh(9)).randomCurses(3), makeCtx(fresh(9)).randomCurses(3)); // THE SEED DECIDES
	});

	test("Hexcraft and Bad Omen pick through the weighted pick and give through giveCurse", () => {
		const s = game("4k3/8/8/3P4/8/8/PPPP4/4K3 w - - 0 1"), ctx = makeCtx(s), calls = [], pick = ctx.randomCurses;
		ctx.randomCurses = (n) => { calls.push(n); return pick(n); };
		CARDS.hexcraft.play(ctx, "w");
		assert.deepEqual(calls, [2]);
		assert.equal(s.pending.options.length, 2);
		const o = fresh(), octx = makeCtx(o), ocalls = [], opick = octx.randomCurses;
		octx.randomCurses = (n) => { ocalls.push(n); return opick(n); };
		assert.ok(CARDS["bad-omen"].on.capture(octx, "w", { type: "capture", player: "b", c: "w" }));
		assert.deepEqual(ocalls, [1]);
		assert.equal(o.players.b.curses.length, 1);
		assert.equal(o.players.w.curseWait, 6);
		o.players.w.curseWait = 0;
		o.players.b.curses.push(hand.newCard(o, "tremor"));
		assert.ok(CARDS["bad-omen"].on.capture(octx, "w", { type: "capture", player: "b", c: "w" })); // FIRES, GIVES NOTHING
		assert.equal(o.players.b.curses.length, 2);
		const h = game("4k3/8/8/3P4/8/8/PPPP4/4K3 w - - 0 1"), hctx = makeCtx(h);
		h.players.w.curseWait = 2;
		CARDS.hexcraft.play(hctx, "w");
		assert.equal(h.pending, null); // canCurse SAYS NO: NOTHING DRAWN OR ASKED
	});

	test("ctx.clearCurse is the one clear path: the curse leaves, a curse-cleared event, other curses hear it, the cleared curse hears its own once", () => {
		LOG.length = 0;
		const s = fresh(), ctx = makeCtx(s), crown = curse(s, "w", "t-crown"), watch = curse(s, "w", "t-watch");
		assert.equal(ctx.clearCurse("w", crown), true);
		assert.deepEqual(s.players.w.curses, [watch]);
		assert.deepEqual(ofType(ctx.events, "curse-cleared"), [{ type: "curse-cleared", player: "w", card: crown }]);
		assert.deepEqual(LOG, ["t-watch:t-crown:t-watch", "t-crown:t-crown:t-crown"]);
		assert.ok(ofType(ctx.events, "curse-fired").every((e) => e.card.id !== crown.id)); // ITS OWN HEARING IS NOT A FIRING
		const n = ctx.events.length;
		assert.equal(ctx.clearCurse("w", crown), false); // ALREADY GONE: NO EVENT
		assert.equal(ctx.events.length, n);
	});
});
