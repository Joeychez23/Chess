/*
 *  cards-curses.test.js  --  chess cards engine tests
 *	Curses (cards-engine/cards/curse/) and the curse framework in ctx.js: giving (the limit, the wait, a curse's own fields), the rarity-weighted pick, the one clear path, each curse's effect and clearing, Cleanse's "all of your curses", and Mirage's hiding from its holder.
 *
 */

const { describe, test, before } = require("node:test");
const assert = require("node:assert/strict");
const { newGame, legalActions, applyAction, actionKey, playerView, playerEvents } = require("../../cards-engine/index.js");
const { fromFen, sqIndex } = require("../../cards-engine/board.js");
const { makeCtx, canCurse } = require("../../cards-engine/ctx.js");
const hand = require("../../cards-engine/hand.js");
const statuses = require("../../cards-engine/statuses.js");
const { register, reset, CARDS, CURSE_KEYS, RARITY_WEIGHTS } = require("../../cards-engine/cards/index.js");

reset();
for (const k of ["dead-weight", "traitors-mark", "tremor", "shackles", "debt", "rust", "mirage", "pact"]) register(require("../../cards-engine/cards/curse/" + k + ".js"));
for (const k of ["cleanse", "hexcraft", "mulligan", "insidious-nullification", "pickpocket"]) register(require("../../cards-engine/cards/active/" + k + ".js"));
for (const k of ["bad-omen"]) register(require("../../cards-engine/cards/passive/" + k + ".js"));
register({ key: "t-give", kind: "active", name: "t-give", rarity: "common", text: "", targets: () => [null], play: (ctx, p) => ctx.giveCurse(p === "w" ? "b" : "w", "shackles", p) });
const LOG = [];
register({ key: "t-made", kind: "curse", name: "t-made", rarity: "common", text: "", make: (ctx, to) => ({ piece: to === "b" ? "n" : "p", roll: ctx.rng.int(1000) }) });
for (const k of ["t-crown", "t-watch"]) register({ key: k, kind: "curse", name: k, rarity: "epic", text: "", on: { "curse-cleared": (ctx, owner, ev, src) => { LOG.push(k + ":" + ev.card.key + ":" + src.card.key); return true; } } });

const fresh = (seed = 1) => newGame({ cardGuy: "b", level: 1300, seed });
const game = (fen, seed = 1) => { const s = fresh(seed); s.board = fromFen(fen); return s; };
const ofType = (events, type) => events.filter((e) => e.type === type);
const at = (s, sq) => s.board.sq[sqIndex(sq)];
const curse = (s, color, key, extra) => { const c = hand.newCard(s, key, extra); s.players[color].curses.push(c); return c; };
const moveCard = (s, piece) => hand.newCard(s, "move", { piece });
const firstMove = (s, color) => legalActions(s, color).find((a) => a.type === "move");
const castles = (s, color) => legalActions(s, color).filter((a) => a.type === "move" && a.card === "king" && Math.abs(a.from.charCodeAt(0) - a.to.charCodeAt(0)) === 2);
const clears = (s, color) => legalActions(s, color).filter((a) => a.type === "clear");

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
		assert.equal(s.players.w.curseWait, 6); // GIVEN ON WHITE'S OWN TURN BEFORE ITS TICK (RULING R4-6)
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

describe("Dead Weight", () => {
	test("its holder can't play an active (the free discard of it stays); the opponent can", () => {
		const s = fresh();
		s.players.w.actives = [hand.newCard(s, "t-give")];
		const id = s.players.w.actives[0].id;
		assert.ok(legalActions(s, "w").some((a) => a.type === "active"));
		curse(s, "b", "dead-weight");
		assert.ok(legalActions(s, "w").some((a) => a.type === "active"));
		curse(s, "w", "dead-weight");
		assert.ok(!legalActions(s, "w").some((a) => a.type === "active"));
		assert.ok(legalActions(s, "w").some((a) => a.type === "discard" && a.cards[0] === id));
	});

	test("clearing it skips the move: uses the turn; actives come back", () => {
		const s = fresh();
		s.players.w.actives = [hand.newCard(s, "t-give")];
		const dw = curse(s, "w", "dead-weight");
		assert.deepEqual(clears(s, "w"), [{ type: "clear", card: dw.id }]);
		assert.deepEqual(clears(s, "b"), []);
		const r = applyAction(s, "w", { type: "clear", card: dw.id });
		assert.equal(r.state.result, null);
		assert.deepEqual([r.state.board.turn, r.state.players.w.curses], ["b", []]);
		assert.ok(!ofType(r.events, "move").length);
		assert.deepEqual(ofType(r.events, "curse-cleared"), [{ type: "curse-cleared", player: "w", card: dw }]);
		const back = applyAction(r.state, "b", firstMove(r.state, "b")).state;
		assert.ok(legalActions(back, "w").some((a) => a.type === "active"));
	});
});

describe("Traitor's Mark", () => {
	test("the next piece its holder moves is Marked (3 turns); then it is gone; the opponent's moves don't touch it", () => {
		const s = fresh(), tm = curse(s, "w", "traitors-mark"), btm = curse(s, "b", "traitors-mark");
		const a = firstMove(s, "w"), piece = at(s, a.from).id;
		const r = applyAction(s, "w", a), st = r.state;
		assert.ok(statuses.has(st, piece, "marked"));
		assert.equal(st.statuses[piece].find((e) => e.s === "marked").left, 3);
		assert.deepEqual(st.players.w.curses, []);
		assert.deepEqual(st.players.b.curses, [btm]); // BLACK'S OWN WAITS FOR BLACK'S MOVE
		assert.deepEqual(ofType(r.events, "curse-cleared"), [{ type: "curse-cleared", player: "w", card: tm }]);
		assert.deepEqual(ofType(r.events, "curse-fired").map((e) => e.card.id), [tm.id]);
		assert.deepEqual(ofType(r.events, "status"), [{ type: "status", player: "b", piece, s: "marked", left: 3 }]);
		const b = firstMove(st, "b"), bp = at(st, b.from).id, r2 = applyAction(st, "b", b);
		assert.ok(statuses.has(r2.state, bp, "marked") && r2.state.players.b.curses.length === 0);
		const r3 = applyAction(r2.state, "w", firstMove(r2.state, "w"));
		assert.ok(!ofType(r3.events, "status").length); // ONCE ONLY
	});

	test("has no clear action: it clears by firing", () => {
		const s = fresh();
		curse(s, "w", "traitors-mark");
		assert.deepEqual(clears(s, "w"), []);
	});
});

describe("Tremor", () => {
	test("under its holder's Fog of War the Frozen it gives a fogged pawn, and its given and ended events, stay hidden from the opponent; the holder sees them", () => {
		const s = game("4k3/8/8/8/8/8/P7/4K3 w - - 0 1"), ctx = makeCtx(s);
		s.enchant.push({ id: "e990", key: "fog-of-war", owner: "w", pieces: [], left: null, data: {} });
		const t = curse(s, "w", "tremor"), id = at(s, "a2").id;
		assert.ok(CARDS.tremor.on.draw(ctx, "w", { type: "draw", player: "w", card: moveCard(s, "p") }, { owner: "w", card: t }));
		assert.ok(s.statuses[id].some((e) => e.s === "frozen" && e.veiled));
		assert.ok(!(id in playerView(s, "b").statuses), "shown under the fog");
		assert.ok(playerView(s, "w").statuses[id]);
		assert.equal(ofType(playerEvents(s, ctx.events, "b"), "status").length, 0);
		const mine = ofType(playerEvents(s, ctx.events, "w"), "status");
		assert.ok(mine.length === 1 && !("veiled" in mine[0]));
		const n = ctx.events.length;
		require("../../cards-engine/statuses.js").clear(ctx, id, "frozen");
		assert.equal(ofType(playerEvents(s, ctx.events.slice(n), "b"), "status-ended").length, 0);
		assert.equal(ofType(playerEvents(s, ctx.events.slice(n), "w"), "status-ended").length, 1);
		const open = game("4k3/8/8/8/8/8/P7/4K3 w - - 0 1"), octx = makeCtx(open), ot = curse(open, "w", "tremor"); // NO FOG: SHOWN AS BEFORE
		CARDS.tremor.on.draw(octx, "w", { type: "draw", player: "w", card: moveCard(open, "p") }, { owner: "w", card: ot });
		assert.ok(playerView(open, "b").statuses[at(open, "a2").id]);
		assert.ok(ofType(playerEvents(open, octx.events, "b"), "status").length === 1 && !JSON.stringify(playerEvents(open, octx.events, "b")).includes("veiled"));
	});

	test("under its holder's Fog of War a Frozen already on a hidden pawn is hidden with it, and one given a pawn off the fogged half is told", () => {
		const s = game("4k3/8/8/8/8/8/P7/4K3 w - - 0 1"), ctx = makeCtx(s), id = at(s, "a2").id;
		s.enchant.push({ id: "e990", key: "fog-of-war", owner: "w", pieces: [], left: null, data: {} });
		s.statuses[id] = [{ s: "frozen", left: 1, by: "b" }];
		CARDS.tremor.on.draw(ctx, "w", { type: "draw", player: "w", card: moveCard(s, "p") }, { owner: "w", card: curse(s, "w", "tremor") });
		assert.ok(!s.statuses[id].some((e) => e.veiled));
		assert.ok(!JSON.stringify(playerView(s, "b")).includes("\"" + id + "\"")); // THE PAWN ISN'T IN THE VIEW, NOR ANYTHING OF IT
		const off = game("4k3/8/8/P7/8/8/8/4K3 w - - 0 1"), octx = makeCtx(off), oid = at(off, "a5").id; // a5: NOT ON WHITE'S HALF, SO NOT FOGGED
		off.enchant.push({ id: "e990", key: "fog-of-war", owner: "w", pieces: [], left: null, data: {} });
		CARDS.tremor.on.draw(octx, "w", { type: "draw", player: "w", card: moveCard(off, "p") }, { owner: "w", card: curse(off, "w", "tremor") });
		assert.ok(playerView(off, "b").statuses[oid]);
		const told = ofType(playerEvents(off, octx.events, "b"), "status");
		assert.ok(told.length === 1 && !("veiled" in told[0]));
	});

	test("a trigger that ends the new Frozen at once: the draw goes on, the pawn isn't Frozen, the Tremor is gone", () => {
		CARDS["t-thaw"] = { key: "t-thaw", kind: "curse", on: { status: (ctx, owner, ev) => { if (ev.s !== "frozen") return false; statuses.clear(ctx, ev.piece, "frozen"); return true; } } }; // NOT REGISTERED: NO RANDOM PICK MAY GIVE IT
		try {
			const s = game("4k3/8/8/8/8/8/P7/4K3 w - - 0 1"), ctx = makeCtx(s), id = at(s, "a2").id;
			s.enchant.push({ id: "e990", key: "fog-of-war", owner: "w", pieces: [], left: null, data: {} });
			curse(s, "w", "t-thaw");
			assert.ok(CARDS.tremor.on.draw(ctx, "w", { type: "draw", player: "w", card: moveCard(s, "p") }, { owner: "w", card: curse(s, "w", "tremor") }));
			assert.ok(!statuses.has(s, id, "frozen"));
			assert.deepEqual(s.players.w.curses.map((c) => c.key), ["t-thaw"]);
			assert.deepEqual(ctx.events.map((e) => e.type), ["status", "status-ended", "curse-fired", "curse-cleared"]);
			assert.equal(ctx.events[0].veiled, true);
		} finally { delete CARDS["t-thaw"]; }
	});
	test("its holder's next move-card draw Freezes a random pawn of theirs (3 turns, state.rng); then it is gone", () => {
		const frozen = new Set();
		for (let seed = 1; seed <= 12; seed++) {
			const s = fresh(seed), ctx = makeCtx(s), t = curse(s, "w", "tremor");
			ctx.draw("b", 1);
			assert.deepEqual(s.players.w.curses, [t], "the opponent's draw doesn't touch it");
			ctx.draw("w", 1);
			const ids = Object.keys(s.statuses).filter((id) => statuses.has(s, id, "frozen"));
			assert.equal(ids.length, 1);
			const q = s.board.sq.find((x) => x && x.id === ids[0]);
			assert.deepEqual([q.c, q.t], ["w", "p"]);
			assert.equal(s.statuses[ids[0]][0].left, 3);
			assert.deepEqual(s.players.w.curses, []);
			assert.equal(s.players.w.moves.length, 7); // THE DRAWN CARD STAYS
			assert.deepEqual(ofType(ctx.events, "curse-cleared").map((e) => e.card.id), [t.id]);
			frozen.add(ids[0]);
			ctx.draw("w", 1);
			assert.equal(Object.keys(s.statuses).length, 1); // ONCE ONLY
		}
		assert.ok(frozen.size > 1, "the pawn is not random");
	});

	test("fires at its holder's refill in a real turn; with no pawn left it is still spent", () => {
		const s = fresh();
		curse(s, "w", "tremor");
		const r = applyAction(s, "w", firstMove(s, "w"));
		assert.deepEqual(r.state.players.w.curses, []);
		assert.equal(ofType(r.events, "status").filter((e) => e.s === "frozen").length, 1);
		const g = game("4k3/8/8/8/8/8/8/R3K3 w - - 0 1"), ctx = makeCtx(g);
		curse(g, "w", "tremor");
		ctx.draw("w", 1);
		assert.deepEqual([g.players.w.curses, g.statuses], [[], {}]);
	});
});

describe("Shackles", () => {
	const FEN = "4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1";
	test("its holder's king can't castle (other king moves stay); the opponent's Shackles doesn't bind White", () => {
		const s = game(FEN);
		s.players.w.moves = [moveCard(s, "r")];
		s.players.w.actives = [];
		assert.equal(castles(s, "w").length, 2);
		curse(s, "b", "shackles");
		assert.equal(castles(s, "w").length, 2);
		curse(s, "w", "shackles");
		assert.equal(castles(s, "w").length, 0);
		assert.ok(legalActions(s, "w").some((a) => a.card === "king" && a.to === "f1"));
	});

	test("cleared by discarding a card of the holder's choice (move or active), using the turn; the opponent learns only that a card was discarded", () => {
		const s = game(FEN);
		const mc = moveCard(s, "r"), ac = hand.newCard(s, "t-give");
		Object.assign(s.players.w, { moves: [mc], actives: [ac] });
		const sh = curse(s, "w", "shackles");
		assert.deepEqual(clears(s, "w").map(actionKey).sort(), [{ type: "clear", card: sh.id, discard: mc.id }, { type: "clear", card: sh.id, discard: ac.id }].map(actionKey).sort());
		const r = applyAction(s, "w", { type: "clear", card: sh.id, discard: mc.id });
		assert.deepEqual(r.state.players.w.curses, []);
		assert.ok(!r.state.players.w.moves.some((c) => c.id === mc.id));
		assert.equal(r.state.board.turn, "b");
		assert.deepEqual(ofType(r.events, "discard")[0], { type: "discard", player: "w", card: mc });
		assert.deepEqual(ofType(r.events, "curse-cleared"), [{ type: "curse-cleared", player: "w", card: sh }]);
		const seen = playerEvents(r.state, r.events, "b");
		assert.deepEqual(ofType(seen, "discard")[0], { type: "discard", player: "w" });
		assert.ok(!JSON.stringify(seen).includes('"' + mc.id + '"'));
		assert.ok(!JSON.stringify(playerView(r.state, "b")).includes('"' + mc.id + '"'));
		assert.equal(playerView(r.state, "b").players.w.hand.count, r.state.players.w.moves.length + r.state.players.w.actives.length);
		assert.deepEqual(legalActions(r.state, "b").filter((a) => a.type === "clear"), []);
	});
});

describe("Cleanse (base)", () => {
	test("the owner chooses: all of their curses, or one status on their side", () => {
		const s = fresh(), cl = hand.newCard(s, "cleanse");
		s.players.w.actives = [cl];
		const c1 = curse(s, "w", "shackles"), c2 = curse(s, "w", "tremor"), bc = curse(s, "b", "traitors-mark");
		const wp = at(s, "e2").id;
		s.statuses[wp] = [{ s: "frozen", left: 2, by: "b" }];
		const targets = legalActions(s, "w").filter((a) => a.type === "active").map((a) => a.target);
		assert.deepEqual(targets, [{ curses: "all" }, { piece: wp, s: "frozen" }]);
		const r = applyAction(s, "w", { type: "active", card: cl.id, target: { curses: "all" } });
		assert.deepEqual(r.state.players.w.curses, []);
		assert.deepEqual(ofType(r.events, "curse-cleared"), [c1, c2].map((card) => ({ type: "curse-cleared", player: "w", card })));
		assert.deepEqual(r.state.players.b.curses, [bc]);
		assert.ok(statuses.has(r.state, wp, "frozen"));
		const f = applyAction(s, "w", { type: "active", card: cl.id, target: { piece: wp, s: "frozen" } });
		assert.ok(!statuses.has(f.state, wp, "frozen"));
		assert.equal(f.state.players.w.curses.length, 2);
	});

	test("each cleared curse hears its own clearing", () => {
		LOG.length = 0;
		const s = fresh(), cl = hand.newCard(s, "cleanse");
		s.players.w.actives = [cl];
		curse(s, "w", "t-crown");
		curse(s, "w", "t-watch");
		applyAction(s, "w", { type: "active", card: cl.id, target: { curses: "all" } });
		assert.ok(LOG.includes("t-crown:t-crown:t-crown") && LOG.includes("t-watch:t-watch:t-watch"), LOG.join());
	});

	test("a held Mirage is never offered or cleared as a curse (its holder sees a move card)", () => {
		const s = fresh(), cl = hand.newCard(s, "cleanse");
		s.players.w.actives = [cl];
		const m = curse(s, "w", "mirage", { piece: "n" });
		assert.ok(!legalActions(s, "w").some((a) => a.type === "active"), "Cleanse shows a Mirage");
		const c = curse(s, "w", "shackles");
		const r = applyAction(s, "w", { type: "active", card: cl.id, target: { curses: "all" } });
		assert.deepEqual(r.state.players.w.curses.map((x) => x.key), [m.key]); // ITS ID MAY HAVE CHANGED AT THE REFILL
		assert.deepEqual(ofType(r.events, "curse-cleared").map((e) => e.card.id), [c.id]);
	});
});

describe("seg 1 review fixes", () => {
	test("Traitor's Mark never Marks a king: a castle or king move leaves it waiting; the holder's next non-king move fires it", () => {
		const s = game("4k3/8/8/8/8/8/P7/R3K2R w KQ - 0 1");
		Object.assign(s.players.w, { moves: [moveCard(s, "p")], actives: [] });
		const tm = curse(s, "w", "traitors-mark");
		let r = applyAction(s, "w", castles(s, "w")[0]);
		assert.deepEqual(r.state.statuses, {});
		assert.deepEqual(r.state.players.w.curses, [tm]);
		const st = applyAction(r.state, "b", firstMove(r.state, "b")).state;
		const pm = legalActions(st, "w").find((a) => a.type === "move" && a.card !== "king"), id = at(st, pm.from).id;
		r = applyAction(st, "w", pm);
		assert.ok(statuses.has(r.state, id, "marked"));
		assert.deepEqual(r.state.players.w.curses, []);
	});

	test("Traitor's Mark: a plain king step leaves it waiting too", () => {
		const s = game("4k3/8/8/8/8/8/P7/4K3 w - - 0 1");
		Object.assign(s.players.w, { moves: [moveCard(s, "p")], actives: [] });
		const tm = curse(s, "w", "traitors-mark");
		const r = applyAction(s, "w", legalActions(s, "w").find((a) => a.card === "king" && a.to === "d1"));
		assert.deepEqual([r.state.statuses, r.state.players.w.curses], [{}, [tm]]);
	});

	test("Traitor's Mark finds the moved piece by id: one an earlier handler took off the board leaves it waiting (no throw)", () => {
		register({ key: "t-snatch", kind: "passive", name: "t-snatch", rarity: "common", text: "", on: { move: (ctx, owner, ev) => ev.player === owner && ctx.capture(owner, ev.piece) } });
		const s = game("4k3/8/8/8/8/8/P7/4K3 w - - 0 1");
		Object.assign(s.players.w, { moves: [moveCard(s, "p")], actives: [] });
		s.effects = [{ id: "c950", owner: "w", card: { id: "c950", key: "t-snatch" }, placedAt: 0 }];
		const tm = curse(s, "w", "traitors-mark");
		const r = applyAction(s, "w", { type: "move", card: s.players.w.moves[0].id, from: "a2", to: "a3" });
		assert.deepEqual(r.state.players.w.curses, [tm]);
	});

	test("Shackles lists a held Mirage as a payable move card, in the order the holder sees their move cards", () => {
		const s = game("4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1");
		const mc = moveCard(s, "r");
		Object.assign(s.players.w, { moves: [mc], actives: [] });
		const m = curse(s, "w", "mirage", { piece: "r" }), sh = curse(s, "w", "shackles");
		const pay = clears(s, "w").map((a) => a.discard);
		assert.deepEqual(pay, playerView(s, "w").players.w.moves.map((c) => c.id));
		assert.deepEqual(pay, [mc.id, m.id]);
		const r = applyAction(s, "w", { type: "clear", card: sh.id, discard: m.id });
		assert.deepEqual(r.state.players.w.curses, []);
		assert.deepEqual(r.state.players.w.moves.map((c) => c.id).slice(0, 1), [mc.id]);
		const seen = playerEvents(r.state, r.events, "w");
		assert.deepEqual(ofType(seen, "discard")[0], { type: "discard", player: "w", card: { id: m.id, key: "move", piece: "r" } }); // IN DISGUISE
	});
});

/**
 * @description Play first legal moves, alternating from the side to move, until it is color's turn n more times (counting turn-start events for color); returns the last { state, events }.
 */
function untilTurn(s, color, n) {
	let r = { state: s, events: [] };
	while (n > 0) {
		const mover = r.state.board.turn;
		r = applyAction(r.state, mover, firstMove(r.state, mover));
		n -= r.events.filter((e) => e.type === "turn-start" && e.player === color).length;
	}
	return r;
}

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

/**
 * @description Assert that holder's view, the events (as holder sees them) and holder's legal actions show no Mirage: no "mirage" key, no waiting id, every move card a plain { id, key: "move", piece }, every card an action names one the view holds (or the King card / cardless).
 */
function blind(state, events, holder) {
	const v = playerView(state, holder), me = v.players[holder], json = JSON.stringify(v) + JSON.stringify(playerEvents(state, events, holder));
	const giverSees = state.players[holder === "w" ? "b" : "w"].curses.some((c) => c.key === "mirage"); // A MIRAGE THE HOLDER GAVE SHOWS IN THE OTHER HAND
	if (!giverSees) assert.ok(!json.includes("mirage"), "mirage in the holder's view or events");
	for (const c of state.players[holder].curses) if (c.waiting) assert.ok(!json.includes('"' + c.id + '"'), "a waiting Mirage's id");
	for (const c of me.moves) assert.deepEqual(Object.keys(c).sort(), ["id", "key", "piece"]);
	const ids = new Set([...me.moves, ...me.actives].map((c) => c.id).concat(["king", null]));
	if (state.board.turn === holder && !state.pending) for (const a of legalActions(state, holder)) if ("card" in a && a.type !== "clear") assert.ok(ids.has(a.card), "an action names a card the holder can't see: " + a.card);
	return v;
}

describe("Mirage", () => {
	test("given: a waiting curse { id, key, piece } of a type its holder has; no number taken from nextId; nothing in the holder's view, events or actions shows it; the giver sees it", () => {
		const s = fresh(), before = JSON.parse(JSON.stringify(s)), ctx = makeCtx(s);
		const m = ctx.giveCurse("b", "mirage", "w");
		assert.ok(m.waiting && m.key === "mirage" && !m.id.startsWith("c"));
		assert.ok(s.board.sq.some((q) => q && q.c === "b" && q.t === m.piece) && m.piece !== "k");
		assert.equal(s.nextId, before.nextId);
		const strip = (v) => { delete v.players.w.curseWait; return v; }; // THE GIVER'S WAIT IS PUBLIC (A CURSE WAS GIVEN), NOT WHICH ONE
		assert.deepEqual(strip(playerView(s, "b")), strip(playerView(before, "b")));
		assert.deepEqual(playerEvents(s, ctx.events, "b"), []);
		assert.deepEqual(playerEvents(s, ctx.events, "w"), ctx.events);
		const g = playerView(s, "w").players.b.hand;
		assert.ok(g.shown.some((c) => c.id === m.id && c.key === "mirage"));
		assert.equal(g.count, playerView(before, "w").players.b.hand.count + 1);
		s.board.turn = before.board.turn = "b";
		assert.deepEqual(legalActions(s, "b").map(actionKey), legalActions(before, "b").map(actionKey));
		blind(s, ctx.events, "b");
	});

	test("Hexcraft and Bad Omen give a Mirage with a valid piece type: one the holder has, picked by state.rng", () => {
		const s = game("1n2k1r1/8/8/8/8/8/PPPP4/4K3 w - - 0 1"), ctx = makeCtx(s); // BLACK HAS NO PAWN
		ctx.randomCurses = () => ["mirage", "tremor"];
		CARDS.hexcraft.play(ctx, "w");
		CARDS.hexcraft.choice.resolve(ctx, s.pending, "mirage");
		const [m] = s.players.b.curses;
		assert.ok(m.key === "mirage" && m.waiting && ["n", "r"].includes(m.piece), m.piece);
		const types = new Set();
		for (let seed = 1; seed <= 12; seed++) {
			const o = game("1n2k1r1/8/8/8/8/8/PPPP4/4K3 w - - 0 1", seed), twin = makeCtx(JSON.parse(JSON.stringify(o))), octx = makeCtx(o);
			octx.randomCurses = () => ["mirage"];
			CARDS["bad-omen"].on.capture(octx, "w", { type: "capture", player: "b", c: "w" });
			const [n] = o.players.b.curses;
			assert.equal(n.piece, twin.rng.pick(["n", "r"])); // THE RULE: state.rng PICKS ONE OF THE HOLDER'S NON-KING PIECES (BOARD ORDER)
			types.add(n.piece);
		}
		assert.deepEqual([...types].sort(), ["n", "r"]);
	});

	test("it enters at its holder's next refill by taking over a random held move card (old or new): its id and type, no event; count, ids and events as with no Mirage", () => {
		const where = new Set();
		for (let seed = 1; seed <= 16; seed++) {
			const a = fresh(seed);
			a.board.turn = "b";
			const b = JSON.parse(JSON.stringify(a));
			a.players.b.curses.push({ id: "m99.0", key: "mirage", piece: "q", waiting: true }); // GIVEN: WAITING, NO rng USED
			blind(a, [], "b");
			const act = firstMove(a, "b"), ra = applyAction(a, "b", act), rb = applyAction(b, "b", act);
			const mine = (r) => playerEvents(r.state, r.events, "b").filter((e) => e.player === "b");
			assert.deepEqual(mine(ra), mine(rb));
			assert.deepEqual(playerView(ra.state, "b").players.b.moves, playerView(rb.state, "b").players.b.moves);
			const held = ra.state.players.b.curses[0];
			assert.ok(!held.waiting && rb.state.players.b.moves.some((c) => c.id === held.id && c.piece === held.piece));
			assert.ok(!ra.state.players.b.moves.some((c) => c.id === held.id));
			blind(ra.state, ra.events, "b");
			where.add(ofType(rb.events, "draw").some((e) => e.card.id === held.id) ? "new" : "old");
		}
		assert.deepEqual([...where].sort(), ["new", "old"]);
	});

	test("the holder can't name it at the refill where it enters: guessing the one new card is right about 1 in 6", () => {
		let hits = 0, tries = 0;
		for (let seed = 1; seed <= 60; seed++) {
			const s = fresh(seed);
			makeCtx(s).giveCurse("b", "mirage", "w");
			s.board.turn = "b";
			const before = new Set(playerView(s, "b").players.b.moves.map((c) => c.id));
			const act = legalActions(s, "b").find((a) => a.type === "move" && s.players.b.moves.some((c) => c.id === a.card));
			const r = applyAction(s, "b", act), shown = playerView(r.state, "b").players.b.moves.filter((c) => !before.has(c.id));
			const m = r.state.players.b.curses.find((c) => c.key === "mirage");
			if (shown.length !== 1 || m.waiting) continue;
			tries++;
			if (shown[0].id === m.id) hits++;
		}
		assert.ok(tries >= 40, String(tries));
		assert.ok(hits <= tries * 0.35, hits + " of " + tries); // CHANCE IS 1 IN 6
	});

	test("Mulligan with an entered Mirage: the holder's view and events are those of the same hand with a real card in its place", () => {
		for (let seed = 1; seed <= 8; seed++) {
			const a = fresh(seed), mul = hand.newCard(a, "mulligan");
			a.players.w.actives = [mul];
			const m = curse(a, "w", "mirage", { piece: "p" });
			const b = JSON.parse(JSON.stringify(a));
			b.players.w.curses = [];
			b.players.w.moves.push({ id: m.id, key: "move", piece: "p" });
			const act = { type: "active", card: mul.id }, ra = applyAction(a, "w", act), rb = applyAction(b, "w", act);
			const mine = (r) => playerEvents(r.state, r.events, "w").filter((e) => e.player === "w" && e.card && e.card.key === "move"); // THE THROW-OUT AND THE DRAWS (LATER DRAWS FOLLOW THE SECRET rng, WHICH THE TAKE-OVER ADVANCED)
			assert.deepEqual(mine(ra), mine(rb));
			assert.deepEqual(playerView(ra.state, "w").players.w.moves, playerView(rb.state, "w").players.w.moves);
			assert.equal(ra.state.players.w.curses[0].key, "mirage");
			blind(ra.state, ra.events, "w");
		}
	});

	test("Pickpocket counts an entered Mirage toward the 9 cap: the holder never sees 10 move cards", () => {
		const s = fresh(3);
		s.players.w.moves = Array.from({ length: 8 }, () => moveCard(s, "p"));
		curse(s, "w", "mirage", { piece: "p" });
		const pp = hand.newCard(s, "pickpocket");
		s.players.w.actives = [pp];
		s.players.b.actives = [];
		const r = applyAction(s, "w", { type: "active", card: pp.id });
		assert.deepEqual(ofType(r.events, "card-taken").map((e) => !!e.lost), [true]);
		assert.equal(playerView(r.state, "w").players.w.moves.length, 9);
	});

	test("random discards can pick an entered Mirage (a real discard that clears it): two discards due, two happen", () => {
		const s = fresh(5);
		Object.assign(s.players.w, { moves: [moveCard(s, "p")], actives: [], passive: null });
		const m = curse(s, "w", "mirage", { piece: "p" }), ctx = makeCtx(s);
		ctx.discardRandom("w", 2);
		assert.equal(ofType(playerEvents(s, ctx.events, "w"), "discard").length, 2);
		assert.deepEqual([s.players.w.moves, s.players.w.curses], [[], []]);
		assert.deepEqual(ofType(ctx.events, "curse-cleared").map((e) => e.card.id), [m.id]);
	});

	test("its actions are a real move card's of that type; playing one moves nothing, uses the turn and spends it", () => {
		const s = fresh(), m = curse(s, "w", "mirage", { piece: "n" });
		const twin = JSON.parse(JSON.stringify(s));
		twin.players.w.curses = [];
		twin.players.w.moves.push({ id: m.id, key: "move", piece: "n" });
		assert.deepEqual(legalActions(s, "w").map(actionKey), legalActions(twin, "w").map(actionKey));
		blind(s, [], "w");
		const a = legalActions(s, "w").find((x) => x.card === m.id && x.type === "move");
		const r = applyAction(s, "w", a);
		assert.deepEqual(r.state.board.sq, s.board.sq);
		assert.equal(r.state.board.turn, "b");
		assert.deepEqual(r.state.players.w.curses, []);
		assert.ok(!ofType(r.events, "move").length);
		assert.deepEqual(r.events.slice(0, 2).map((e) => [e.type, e.card.id]), [["curse-cleared", m.id], ["curse-fired", m.id]]);
	});

	test("not playable while its holder is in check", () => {
		const s = game("4r1k1/8/8/8/8/8/8/2N1K3 w - - 0 1"), m = curse(s, "w", "mirage", { piece: "n" });
		const twin = JSON.parse(JSON.stringify(s));
		twin.players.w.curses = [];
		twin.players.w.moves.push({ id: m.id, key: "move", piece: "n" });
		assert.ok(legalActions(twin, "w").some((a) => a.card === m.id && a.to === "e2"));
		assert.ok(!legalActions(s, "w").some((a) => a.card === m.id));
	});

	test("counts as a move card: toward the 9 cap and the refill's 6", () => {
		const s = fresh();
		s.players.w.moves = Array.from({ length: 8 }, () => moveCard(s, "p"));
		curse(s, "w", "mirage", { piece: "p" });
		const ctx = makeCtx(s);
		ctx.draw("w", 1);
		assert.deepEqual(ofType(ctx.events, "draw").map((e) => !!e.lost), [true]);
		assert.equal(blind(s, ctx.events, "w").players.w.moves.length, 9);
		const t = fresh();
		curse(t, "w", "mirage", { piece: "p" }); // 6 REAL + IT: 7 SHOWN
		const r = applyAction(t, "w", t.players.w.moves.length && legalActions(t, "w").find((a) => a.type === "move" && t.players.w.moves.some((c) => c.id === a.card)));
		assert.ok(!ofType(r.events, "draw").some((e) => e.player === "w" && e.card && e.card.key === "move")); // 5 REAL + IT: NO DRAW
		assert.equal(playerView(r.state, "w").players.w.moves.length, 6);
	});

	test("a free discard of it is a real discard: it pairs as a move card, a move card is drawn back and the curse is gone", () => {
		const s = fresh(), m = curse(s, "w", "mirage", { piece: "p" });
		const a = legalActions(s, "w").find((x) => x.type === "discard" && x.cards.includes(m.id));
		assert.equal(a.cards.length, 2);
		const r = applyAction(s, "w", a);
		assert.deepEqual(r.state.players.w.curses, []);
		assert.deepEqual(ofType(playerEvents(r.state, r.events, "w"), "discard")[a.cards.indexOf(m.id)], { type: "discard", player: "w", card: { id: m.id, key: "move", piece: "p" } });
		assert.ok(ofType(r.events, "draw").some((e) => e.player === "w" && e.card.key === "move"));
	});

	test("Mulligan: thrown out in disguise with the move cards, back hidden among the new draws with a fresh id; the curse stays; it counts for targets", () => {
		const slots = new Set();
		for (let seed = 1; seed <= 10; seed++) {
			const s = fresh(seed), mul = hand.newCard(s, "mulligan");
			s.players.w.actives = [mul];
			const m = curse(s, "w", "mirage", { piece: "p" }), shown = playerView(s, "w").players.w.moves.map((c) => c.id);
			const r = applyAction(s, "w", { type: "active", card: mul.id });
			const seen = playerEvents(r.state, r.events, "w");
			assert.deepEqual(ofType(seen, "discard").map((e) => e.card.id), shown);
			const draws = ofType(seen, "draw").filter((e) => e.player === "w").slice(0, 7);
			const held = r.state.players.w.curses[0];
			assert.ok(held.key === "mirage" && held.id !== m.id && !held.waiting);
			assert.ok(draws.some((e) => e.card.id === held.id));
			slots.add(draws.findIndex((e) => e.card.id === held.id));
			blind(r.state, r.events, "w");
		}
		assert.ok(slots.size > 1, "the slot is not random");
		const t = fresh(), mul = hand.newCard(t, "mulligan");
		Object.assign(t.players.w, { moves: [], actives: [mul] });
		assert.ok(!legalActions(t, "w").some((a) => a.type === "active"));
		curse(t, "w", "mirage", { piece: "p" });
		assert.ok(legalActions(t, "w").some((a) => a.type === "active"));
	});

	test("the no-action redraw throws it out and brings it back hidden with a fresh id", () => {
		const t = game("4k3/8/8/8/8/p7/P7/4K3 b - - 0 1");
		t.players.w.king = false;
		Object.assign(t.players.w, { moves: [moveCard(t, "q")], actives: [] });
		const tm = curse(t, "w", "mirage", { piece: "q" });
		const q = applyAction(t, "b", legalActions(t, "b").find((a) => a.type === "move"));
		assert.ok(ofType(q.events, "redraw").some((e) => e.player === "w"));
		const back = q.state.players.w.curses[0];
		assert.ok(back.id !== tm.id && !back.waiting && back.piece === "p");
		blind(q.state, q.events, "w");
	});

	test("passable: its holder captures an enemy piece and it goes back to the opponent (waiting, no wait started); a waiting one doesn't pass", () => {
		const s = game("4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1");
		s.players.w.moves = [moveCard(s, "p")];
		const m = curse(s, "w", "mirage", { piece: "p" });
		const r = applyAction(s, "w", { type: "move", card: s.players.w.moves[0].id, from: "e4", to: "d5" });
		assert.deepEqual(r.state.players.w.curses, []);
		const [back] = r.state.players.b.curses;
		assert.ok(back.key === "mirage" && back.waiting);
		assert.equal(r.state.players.w.curseWait, 0);
		assert.deepEqual(ofType(r.events, "curse-cleared").map((e) => e.card.id), [m.id]);
		assert.deepEqual(playerEvents(r.state, r.events, "b").filter((e) => e.type === "curse-given"), []);
		const t = game("4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1");
		t.players.w.moves = [moveCard(t, "p")];
		const w = makeCtx(t).giveCurse("w", "mirage", "b");
		const q = applyAction(t, "w", { type: "move", card: t.players.w.moves[0].id, from: "e4", to: "d5" });
		assert.deepEqual([q.state.players.w.curses.map((c) => c.key), q.state.players.b.curses], [["mirage"], []]); // STILL WHITE'S (IT ENTERED AT THIS TURN'S REFILL)
		assert.ok(!ofType(q.events, "curse-cleared").length && w.id);
	});

	test("Insidious Nullification counts an entered Mirage's type, not a waiting one", () => {
		const s = game("4k3/8/8/8/8/8/8/1N2K3 w - - 0 1"), ins = hand.newCard(s, "insidious-nullification");
		Object.assign(s.players.w, { moves: [], actives: [ins] });
		makeCtx(s).giveCurse("w", "mirage", "b");
		assert.ok(!legalActions(s, "w").some((a) => a.type === "active"));
		s.players.w.curses = [];
		curse(s, "w", "mirage", { piece: "n" });
		assert.ok(legalActions(s, "w").some((a) => a.type === "active"));
	});

	test("Cleanse never offers or clears a Mirage, entered or waiting", () => {
		const s = fresh(), cl = hand.newCard(s, "cleanse");
		s.players.w.actives = [cl];
		makeCtx(s).giveCurse("w", "mirage", "b");
		assert.ok(!legalActions(s, "w").some((a) => a.type === "active"));
		blind(s, [], "w");
	});
});

// SEGMENT 3: HUNGER, LEECH, HOLLOW CROWN, HEXCRAFT'S LEGENDARY AND BAD OMEN'S EPIC VERSIONS (REGISTERED HERE, AFTER THE TESTS ABOVE: NEW CURSE KEYS WOULD CHANGE THEIR SEEDED PICKS)
const seg3 = () => {
	for (const k of ["hunger", "leech", "hollow-crown"]) register(require("../../cards-engine/cards/curse/" + k + ".js"));
	for (const k of ["escape-artist", "bleeding-hand"]) register(require("../../cards-engine/cards/passive/" + k + ".js"));
};
const place = (s, key, owner) => { const c = hand.newCard(s, key); s.effects.push({ id: c.id, owner, card: c, placedAt: s.ply }); return c; };
const pawns = (s, color) => s.board.sq.filter((q) => q && q.c === color && q.t === "p").length;

describe("Hunger", () => {
	before(seg3);

	test("is rare; no capture within 2 of its holder's turns: a random pawn of theirs is removed (a removal: player === c, by null); it stays and comes due again 2 turns later", () => {
		assert.equal(CARDS.hunger.rarity, "rare");
		const s = fresh(), h = makeCtx(s).giveCurse("b", "hunger", "w");
		let r = untilTurn(s, "b", 2);
		assert.equal(pawns(r.state, "b"), 8);
		assert.ok(!ofType(r.events, "curse-fired").length);
		r = untilTurn(r.state, "b", 1);
		const [gone] = ofType(r.events, "capture").filter((e) => e.c === "b");
		assert.deepEqual([gone.player, gone.t, gone.by], ["b", "p", null]);
		assert.equal(pawns(r.state, "b"), 7);
		assert.deepEqual(r.state.players.b.curses.map((c) => c.id), [h.id]); // IT STAYS
		assert.deepEqual(ofType(r.events, "curse-fired").map((e) => e.card.key), ["hunger"]);
		r = untilTurn(r.state, "b", 1);
		assert.equal(pawns(r.state, "b"), 7);
		r = untilTurn(r.state, "b", 1);
		assert.equal(pawns(r.state, "b"), 6);
		const picked = new Set();
		for (let seed = 1; seed <= 12; seed++) { // THE PAWN IS PICKED BY state.rng
			const t = fresh(seed);
			makeCtx(t).giveCurse("b", "hunger", "w");
			picked.add(ofType(untilTurn(t, "b", 3).events, "capture").find((e) => e.c === "b").piece);
		}
		assert.ok(picked.size > 1);
	});

	test("cleared when its holder captures; not by the opponent capturing, not by a removal; with no pawn left nothing is removed", () => {
		const s = game("4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1");
		s.players.w.moves = [moveCard(s, "p")];
		const h = curse(s, "w", "hunger", { left: 3 });
		const r = applyAction(s, "w", { type: "move", card: s.players.w.moves[0].id, from: "e4", to: "d5" });
		assert.deepEqual(r.state.players.w.curses, []);
		assert.deepEqual(ofType(r.events, "curse-cleared"), [{ type: "curse-cleared", player: "w", card: h }]);
		const t = game("4k3/8/8/3p4/4P3/8/8/4K3 b - - 0 1");
		t.players.b.moves = [moveCard(t, "p")];
		curse(t, "w", "hunger", { left: 3 });
		assert.equal(applyAction(t, "b", { type: "move", card: t.players.b.moves[0].id, from: "d5", to: "e4" }).state.players.w.curses.length, 1);
		const u = game("4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1"), ctx = makeCtx(u);
		curse(u, "w", "hunger", { left: 3 });
		ctx.capture("w", at(u, "e4").id);
		assert.equal(u.players.w.curses.length, 1);
		assert.deepEqual(clears(game("4k3/8/8/8/8/8/8/4K3 w - - 0 1"), "w"), []); // NO CLEAR ACTION: ONLY A CAPTURE PAYS IT
		const v = game("4k3/8/8/8/8/8/8/R3K3 b - - 0 1");
		v.players.b.moves = [];
		curse(v, "w", "hunger", { left: 0 });
		const q = applyAction(v, "b", firstMove(v, "b"));
		assert.equal(at(q.state, "a1").t, "r");
		assert.ok(!ofType(q.events, "capture").length);
	});
});

describe("Leech", () => {
	before(seg3);

	test("is rare; each of its holder's turns the opponent draws an extra move card, at the start of that turn", () => {
		assert.equal(CARDS.leech.rarity, "rare");
		const s = fresh();
		makeCtx(s).giveCurse("b", "leech", "w");
		const r = applyAction(s, "w", firstMove(s, "w")), start = r.events.findIndex((e) => e.type === "turn-start" && e.player === "b");
		const after = r.events.slice(start);
		assert.deepEqual(ofType(after, "draw").filter((e) => e.player === "w").map((e) => e.card.key), ["move"]);
		assert.deepEqual(ofType(after, "curse-fired").map((e) => [e.player, e.card.key]), [["b", "leech"]]);
		assert.equal(r.state.players.w.moves.length, 7);
		assert.ok(ofType(playerEvents(r.state, r.events, "b").slice(start), "draw").filter((e) => e.player === "w").every((e) => !e.card)); // THE HOLDER DOESN'T SEE WHAT THE OPPONENT DREW
		const q = applyAction(r.state, "b", firstMove(r.state, "b")); // WHITE'S OWN TURN: NOTHING EXTRA
		assert.ok(!ofType(q.events.slice(q.events.findIndex((e) => e.type === "turn-start")), "draw").some((e) => e.player === "w" && e.card.key === "move"));
	});

	test("passable: its holder captures an enemy piece and it goes back to the opponent (no wait started; the limit holds)", () => {
		const s = game("4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1");
		s.players.w.moves = [moveCard(s, "p")];
		const l = curse(s, "w", "leech");
		const r = applyAction(s, "w", { type: "move", card: s.players.w.moves[0].id, from: "e4", to: "d5" });
		assert.deepEqual(r.state.players.w.curses, []);
		assert.deepEqual(r.state.players.b.curses.map((c) => c.key), ["leech"]);
		assert.equal(r.state.players.w.curseWait, 0);
		assert.deepEqual(ofType(r.events, "curse-cleared").map((e) => e.card.id), [l.id]);
		assert.deepEqual(ofType(r.events, "curse-given").map((e) => [e.player, e.card.key]), [["w", "leech"]]);
		const t = game("4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1");
		t.players.w.moves = [moveCard(t, "p")];
		curse(t, "w", "leech");
		for (const k of ["shackles", "rust"]) curse(t, "b", k);
		const q = applyAction(t, "w", { type: "move", card: t.players.w.moves[0].id, from: "e4", to: "d5" });
		assert.deepEqual([q.state.players.w.curses, q.state.players.b.curses.length], [[], 2]); // REFUSED BY THE LIMIT: IT IS GONE
		const u = game("4k3/8/8/3p4/4P3/8/8/4K3 b - - 0 1");
		u.players.b.moves = [moveCard(u, "p")];
		curse(u, "w", "leech");
		assert.deepEqual(applyAction(u, "b", { type: "move", card: u.players.b.moves[0].id, from: "d5", to: "e4" }).state.players.w.curses.map((c) => c.key), ["leech"]); // THE OPPONENT'S CAPTURE DOESN'T PASS IT
	});

	test("cleared by discarding an active card (one clear per active held), using the turn; none without an active; the opponent learns only that a card was discarded", () => {
		const s = game("4k3/8/8/8/8/8/4P3/4K3 w - - 0 1"), a1 = hand.newCard(s, "cleanse"), a2 = hand.newCard(s, "mulligan"); // THE PAWN KEEPS THE GAME ON: BARE KINGS END IT (MATERIAL), AND A FINISHED GAME SHOWS EVERYTHING (USER RULING 2026-11-21)
		Object.assign(s.players.w, { moves: [moveCard(s, "p")], actives: [a1, a2] });
		const l = curse(s, "w", "leech");
		assert.deepEqual(clears(s, "w"), [{ type: "clear", card: l.id, discard: a1.id }, { type: "clear", card: l.id, discard: a2.id }]);
		const r = applyAction(s, "w", { type: "clear", card: l.id, discard: a2.id });
		assert.deepEqual(r.state.players.w.curses, []);
		assert.equal(r.state.board.turn, "b");
		assert.ok(!r.state.players.w.actives.some((c) => c.id === a2.id));
		assert.deepEqual(ofType(r.events, "discard"), [{ type: "discard", player: "w", card: a2 }]);
		assert.deepEqual(ofType(playerEvents(r.state, r.events, "b"), "discard"), [{ type: "discard", player: "w" }]);
		const t = game("4k3/8/8/8/8/8/8/4K3 w - - 0 1");
		Object.assign(t.players.w, { moves: [moveCard(t, "p")], actives: [] });
		curse(t, "w", "leech");
		assert.deepEqual(clears(t, "w"), []);
	});
});

describe("Hollow Crown", () => {
	before(seg3);
	const crowned = (fen = "4k3/8/8/8/8/8/8/4K3 w - - 0 1") => { const s = game(fen); Object.assign(s.players.w, { moves: [], actives: [], passive: null }); return { s, c: curse(s, "w", "hollow-crown") }; };
	const kingCardMoves = (s, color) => legalActions(s, color).filter((a) => a.type === "move" && a.card === "king");

	test("is epic; random discards can take the King card (a discard both players see); then the king has no King-card move; king skulls unchanged", () => {
		assert.equal(CARDS["hollow-crown"].rarity, "epic");
		const { s } = crowned(), ctx = makeCtx(s);
		assert.ok(kingCardMoves(s, "w").length);
		ctx.discardRandom("w", 1);
		assert.equal(s.players.w.king, false);
		assert.deepEqual(ofType(ctx.events, "discard").map((e) => [e.player, e.card.key]), [["w", "king"]]);
		assert.deepEqual(ofType(playerEvents(s, ctx.events, "b"), "discard").map((e) => e.card && e.card.key), ["king"]);
		assert.equal(playerView(s, "b").players.w.king, false);
		assert.deepEqual(kingCardMoves(s, "w"), []);
		assert.equal(s.players.w.kingSkulls, 3);
		const plain = game("4k3/8/8/8/8/8/8/4K3 w - - 0 1"), pctx = makeCtx(plain);
		Object.assign(plain.players.w, { moves: [], actives: [], passive: null });
		pctx.discardRandom("w", 1);
		assert.equal(plain.players.w.king, true); // WITHOUT THE CURSE IT IS PERMANENT
		assert.ok(!ofType(pctx.events, "discard").length);
		const many = crowned().s, picked = new Set();
		for (let i = 0; i < 40; i++) { // ONE CARD AMONG THE OTHERS IN THE POOL
			const t = JSON.parse(JSON.stringify(many));
			t.players.w.moves = [moveCard(t, "p"), moveCard(t, "n")];
			t.rng.n = i;
			const tctx = makeCtx(t);
			tctx.discardRandom("w", 1);
			picked.add(ofType(tctx.events, "discard")[0].card.key);
		}
		assert.deepEqual([...picked].sort(), ["king", "move"]);
	});

	test("a lost King card returns when the curse clears: by its clear action (discard 2 move cards of the holder's choice, using the turn), by Cleanse, by any clear", () => {
		const { s, c } = crowned();
		const m1 = moveCard(s, "p"), m2 = moveCard(s, "p"), m3 = moveCard(s, "p");
		s.players.w.moves = [m1, m2, m3];
		s.board = fromFen("4k3/8/8/8/8/8/PPP5/4K3 w - - 0 1");
		s.players.w.king = false;
		assert.deepEqual(clears(s, "w"), [[m1, m2], [m1, m3], [m2, m3]].map(([a, b]) => ({ type: "clear", card: c.id, discard: [a.id, b.id] })));
		const r = applyAction(s, "w", { type: "clear", card: c.id, discard: [m1.id, m3.id] });
		assert.deepEqual(r.state.players.w.curses, []);
		assert.equal(r.state.players.w.king, true);
		assert.equal(r.state.board.turn, "b");
		assert.deepEqual(ofType(r.events, "discard").map((e) => e.card.id), [m1.id, m3.id]);
		const one = crowned().s;
		one.players.w.moves = [moveCard(one, "p")];
		assert.deepEqual(clears(one, "w"), []); // ONE MOVE CARD CAN'T PAY
		const cl = crowned(), cs = cl.s, card = hand.newCard(cs, "cleanse");
		cs.players.w.actives = [card];
		cs.players.w.king = false;
		const cr = applyAction(cs, "w", { type: "active", card: card.id, target: { curses: "all" } });
		assert.deepEqual([cr.state.players.w.curses, cr.state.players.w.king], [[], true]);
		const d = crowned(), dctx = makeCtx(d.s);
		dctx.discardRandom("w", 1);
		assert.equal(d.s.players.w.king, false);
		dctx.clearCurse("w", d.c);
		assert.equal(d.s.players.w.king, true);
		const two = crowned(), tctx = makeCtx(two.s), second = curse(two.s, "w", "hollow-crown");
		tctx.discardRandom("w", 1);
		tctx.clearCurse("w", two.c);
		assert.equal(two.s.players.w.king, false); // ANOTHER HOLLOW CROWN STILL HOLDS IT
		tctx.clearCurse("w", second);
		assert.equal(two.s.players.w.king, true);
	});

	test("Pickpocket can take it (the taker keeps only one King card: the stolen one is lost); Bleeding Hand can discard it", () => {
		const { s } = crowned("4k3/8/8/8/8/8/8/4K3 b - - 0 1"), pp = hand.newCard(s, "pickpocket");
		Object.assign(s.players.b, { moves: [moveCard(s, "p")], actives: [pp] });
		assert.ok(legalActions(s, "b").some((a) => a.type === "active")); // ITS ONLY TAKEABLE CARD IS THE KING CARD
		const r = applyAction(s, "b", { type: "active", card: pp.id });
		assert.equal(r.state.players.w.king, false);
		assert.equal(r.state.players.b.king, true);
		assert.deepEqual(ofType(r.events, "card-taken").map((e) => [e.player, e.from, e.card.key, e.lost]), [["b", "w", "king", true]]);
		const plain = game("4k3/8/8/8/8/8/8/4K3 b - - 0 1"), pp2 = hand.newCard(plain, "pickpocket");
		Object.assign(plain.players.w, { moves: [], actives: [] });
		Object.assign(plain.players.b, { moves: [moveCard(plain, "p")], actives: [pp2] });
		assert.ok(!legalActions(plain, "b").some((a) => a.type === "active")); // WITHOUT THE CURSE NOTHING IS TAKEABLE
		const bh = crowned().s, bctx = makeCtx(bh);
		assert.ok(CARDS["bleeding-hand"].on.capture(bctx, "b", { type: "capture", player: "w", c: "b" }));
		assert.equal(bh.players.w.king, false);
	});

	test("without the King card the king moves only by Escape Artist; a check nothing else answers is checkmate by the cards", () => {
		const fen = "7k/r7/8/8/8/8/P7/4K3 b - - 0 1", rook = (s) => { s.players.b.moves = [moveCard(s, "r")]; return { type: "move", card: s.players.b.moves[0].id, from: "a7", to: "e7" }; };
		const { s } = crowned(fen);
		s.players.w.king = false;
		const r = applyAction(s, "b", rook(s));
		assert.deepEqual(r.state.result, { winner: "b", reason: "checkmate" });
		const k = crowned(fen).s; // THE SAME WITH THE KING CARD: THE KING STEPS AWAY
		assert.equal(applyAction(k, "b", rook(k)).state.result, null);
		const e = crowned(fen).s;
		e.players.w.king = false;
		place(e, "escape-artist", "w");
		const q = applyAction(e, "b", rook(e));
		assert.equal(q.state.result, null);
		const acts = legalActions(q.state, "w");
		assert.ok(acts.length && acts.every((a) => a.card === null && a.from === "e1"));
	});

	test("king skulls are untouched while the King card is gone: no skull voids a lost turn in check, none ends a two-move turn", () => {
		const fen = "r6k/8/8/8/8/8/8/4K3 b - - 0 1", check = (s) => { s.players.b.moves = [moveCard(s, "r")]; return { type: "move", card: s.players.b.moves[0].id, from: "a8", to: "e8" }; };
		const gone = crowned(fen).s;
		Object.assign(gone.players.w, { king: false, lostTurns: 1 });
		const r = applyAction(gone, "b", check(gone));
		assert.deepEqual([ofType(r.events, "king-skull"), ofType(r.events, "turn-skipped").length, r.state.players.w.kingSkulls], [[], 1, 3]);
		const kept = crowned(fen).s;
		kept.players.w.lostTurns = 1;
		const k = applyAction(kept, "b", check(kept));
		assert.deepEqual(ofType(k.events, "king-skull").map((e) => e.why), ["lost-turn"]);
		const t = game("4k3/8/8/8/8/8/8/R2Q1K2 w - - 0 1");
		curse(t, "b", "hollow-crown");
		t.players.b.king = false;
		t.players.w.moves = [moveCard(t, "r"), moveCard(t, "r")];
		t.multi = { player: "w", left: 2, moved: [], differ: false };
		const d = applyAction(t, "w", { type: "move", card: t.players.w.moves[0].id, from: "a1", to: "a8" });
		assert.deepEqual([ofType(d.events, "king-skull"), d.state.players.b.kingSkulls, d.state.board.turn], [[], 3, "w"]); // THE TWO-MOVE TURN GOES ON
	});
});

describe("Hexcraft's legendary version", () => {
	before(seg3);
	const play = (held) => {
		const s = game("4k3/8/8/8/8/8/PPPP4/4K3 w - - 0 1"), hx = hand.newCard(s, "hexcraft-legendary");
		s.players.w.actives = [hx];
		s.players.w.curseWait = 3; // IGNORED
		for (const k of ["dead-weight", "shackles", "rust", "debt"].slice(0, held)) curse(s, "b", k);
		const a = legalActions(s, "w").find((x) => x.type === "active");
		return { s, a, r: a && applyAction(s, "w", a) };
	};

	test("is the legendary Hexcraft: catalog text, no debuff skull", () => {
		const v = CARDS["hexcraft-legendary"];
		assert.deepEqual([v.base, v.rarity, v.kind, v.name, v.skulls], ["hexcraft", "legendary", "active", "Hexcraft", 0]);
		assert.equal(v.text, "Give the opponent both curses. Overrides the curse limit: the opponent may hold up to 4 curses (at 3 it gives one). Ignores the 5-turn wait. No Marked piece.");
	});

	test("gives both drawn curses (no choice) at 0 and 2 held, one at 3, is not playable at 4; ignores the wait and starts none; Marks nothing", () => {
		for (const [held, after] of [[0, 2], [2, 4], [3, 4]]) {
			const { r } = play(held);
			assert.equal(r.state.players.b.curses.length, after, "held " + held);
			assert.equal(ofType(r.events, "curse-given").length, after - held);
			assert.equal(r.state.pending, null);
			assert.equal(r.state.players.w.curseWait, 2); // ITS OWN COUNTDOWN ONLY: NO NEW WAIT
			assert.deepEqual(r.state.statuses, {});
		}
		assert.equal(play(4).a, undefined);
		const keys = new Set();
		for (let seed = 1; seed <= 10; seed++) {
			const ctx = makeCtx(fresh(seed));
			CARDS["hexcraft-legendary"].play(ctx, "w");
			const given = ofType(ctx.events, "curse-given").map((e) => e.card.key);
			assert.equal(new Set(given).size, 2);
			keys.add(given[0]);
		}
		assert.ok(keys.size > 1); // DRAWN BY THE WEIGHTED PICK
	});

	test("the base Hexcraft still Marks, asks for one of two, and obeys the limit and the wait", () => {
		const s = game("4k3/8/8/8/8/8/PPPP4/4K3 w - - 0 1"), ctx = makeCtx(s);
		CARDS.hexcraft.play(ctx, "w");
		assert.equal(s.pending.options.length, 2);
		assert.equal(Object.values(s.statuses).flat().filter((e) => e.s === "marked").length, 1);
	});
});

describe("Bad Omen's epic version", () => {
	before(seg3);
	const omen = (held, wait = 3) => {
		const s = fresh(), ctx = makeCtx(s);
		s.players.w.curseWait = wait;
		for (const k of ["dead-weight", "shackles", "rust", "debt"].slice(0, held)) curse(s, "b", k);
		const fired = CARDS["bad-omen-epic"].on.capture(ctx, "w", { type: "capture", player: "b", c: "w" });
		return { s, ctx, fired };
	};

	test("is the epic Bad Omen: catalog rarity, the same name", () => {
		const v = CARDS["bad-omen-epic"];
		assert.deepEqual([v.base, v.rarity, v.kind, v.name], ["bad-omen", "epic", "passive", "Bad Omen"]);
		assert.match(v.text, /Ignores the curse limit \(the opponent can go over 2 curses\)/);
	});

	test("ignores the curse limit and the wait: at 0, 2, 3 and 4 held a curse goes to the opponent; no wait starts; a removal doesn't fire it", () => {
		for (const held of [0, 2, 3, 4]) {
			const { s, fired } = omen(held);
			assert.ok(fired);
			assert.equal(s.players.b.curses.length, held + 1, "held " + held);
			assert.equal(s.players.w.curseWait, 3);
		}
		const s = fresh(), ctx = makeCtx(s);
		assert.equal(CARDS["bad-omen-epic"].on.capture(ctx, "w", { type: "capture", player: "w", c: "w" }), false);
		const base = fresh(), bctx = makeCtx(base);
		for (const k of ["dead-weight", "shackles"]) curse(base, "b", k);
		assert.ok(CARDS["bad-omen"].on.capture(bctx, "w", { type: "capture", player: "b", c: "w" }));
		assert.equal(base.players.b.curses.length, 2); // THE BASE CARD STILL OBEYS IT
	});

	test("views cope with 3+ curses held: the holder sees them, the giver sees them, the count holds, fromView rebuilds them", () => {
		const { s } = omen(4);
		const held = s.players.b.curses.filter((c) => c.key !== "mirage");
		assert.ok(held.length >= 4);
		const vb = playerView(s, "b"), vw = playerView(s, "w");
		assert.deepEqual(vb.players.b.curses.map((c) => c.id), held.map((c) => c.id));
		assert.equal(vw.players.b.hand.count, s.players.b.moves.length + s.players.b.actives.length + s.players.b.curses.length + (s.players.b.passive ? 1 : 0));
		for (const c of s.players.b.curses) assert.ok(vw.players.b.hand.shown.some((x) => x.id === c.id));
		const { fromView } = require("../../cards-engine/index.js");
		const rebuilt = fromView(vw, 5);
		assert.equal(rebuilt.players.b.curses.length, s.players.b.curses.length);
		assert.ok(legalActions(rebuilt, "w").length);
	});
});

// FIX ROUND 1 (SEGMENT 3): WITHOUT THE KING CARD NO CARD MOVES THE HOLDER'S KING FOR THEM (ESCAPE ARTIST ALONE STILL MAY); BOUNTY'S CAP WITH AN ENTERED MIRAGE
describe("Hollow Crown: no card moves the king without the King card", () => {
	const ACTIVES = ["all-or-nothing", "cleanse", "conscription", "double-time", "fog-of-war", "foresight", "heavy-cavalry", "heretical-subjection", "hexcraft", "insidious-nullification",
		"last-stand", "mulligan", "opposing-finality", "pickpocket", "stronghold", "swap", "trapdoor"];
	before(() => {
		seg3();
		for (const k of ACTIVES) register(require("../../cards-engine/cards/active/" + k + ".js"));
		for (const k of ["retaliation", "unbroken-line", "bounty"]) register(require("../../cards-engine/cards/passive/" + k + ".js"));
	});
	const gone = (fen) => { const s = game(fen); Object.assign(s.players.w, { moves: [], actives: [], passive: null, king: false }); curse(s, "w", "hollow-crown"); return s; };
	const kingAt = (s, color) => s.board.sq.findIndex((q) => q && q.c === color && q.t === "k");
	const kingActs = (s) => legalActions(s, "w").filter((a) => a.type === "move" && a.from === "e1");

	test("Last Stand offers no king move", () => {
		const s = gone("7k/8/8/8/8/8/8/4K3 w - - 0 1"), ls = hand.newCard(s, "last-stand");
		s.players.w.actives = [ls];
		assert.ok(!legalActions(s, "w").some((a) => a.type === "active"));
		s.players.w.king = true;
		assert.ok(legalActions(s, "w").some((a) => a.type === "active")); // WITH THE KING CARD IT DOES
	});

	test("Swap (every version) offers no pair holding the holder's own king; other pairs stay", () => {
		for (const key of ["swap", "swap-epic"]) {
			const s = gone("7k/8/8/8/8/8/8/R3K2R w - - 0 1"), sw = hand.newCard(s, key), king = at(s, "e1").id;
			s.players.w.actives = [sw];
			const targets = legalActions(s, "w").filter((a) => a.type === "active").map((a) => a.target.pieces);
			assert.ok(targets.length, key);
			assert.ok(targets.every((p) => !p.includes(king)), key);
			s.players.w.king = true;
			assert.ok(legalActions(s, "w").some((a) => a.type === "active" && a.target.pieces.includes(king)), key);
		}
	});

	test("Retaliation offers no king recapture; another piece's stays", () => {
		const s = gone("3R3k/8/8/8/8/8/3n4/4K3 w - - 0 1"), r = place(s, "retaliation", "w");
		Object.assign(r, { target: at(s, "d2").id, open: true });
		const caps = legalActions(s, "w").filter((a) => a.type === "move" && a.card === null).map((a) => a.from);
		assert.deepEqual(caps, ["d8"]);
		s.players.w.king = true;
		assert.deepEqual(legalActions(s, "w").filter((a) => a.type === "move" && a.card === null).map((a) => a.from).sort(), ["d8", "e1"]);
	});

	test("no castling, Unbroken Line or not; no king move in a Double Time turn", () => {
		const s = gone("7k/8/8/8/8/8/8/4K2R w K - 0 1");
		place(s, "unbroken-line", "w");
		assert.deepEqual(kingActs(s), []);
		s.players.w.king = true;
		assert.ok(kingActs(s).some((a) => a.to === "g1"));
		const d = gone("7k/8/8/8/8/8/P7/4K3 w - - 0 1");
		d.players.w.moves = [moveCard(d, "p")];
		d.multi = { player: "w", left: 2, moved: [], differ: true };
		assert.deepEqual(kingActs(d), []);
		assert.ok(legalActions(d, "w").length);
	});

	test("sweep: no active card (every version) played by the holder moves their king", () => {
		const fen = "r3k3/1n6/8/3p4/4P3/1N1B4/PP3P2/R3K1NR w Q - 0 1";
		for (const key of ACTIVES.flatMap((k) => [k, ...Object.keys(CARDS).filter((x) => CARDS[x].base === k)])) {
			const s = gone(fen), c = hand.newCard(s, key), home = kingAt(s, "w");
			s.players.w.actives = [c];
			s.players.w.captured = ["q", "r"];
			for (const a of legalActions(s, "w").filter((x) => x.type === "active")) {
				let r = applyAction(s, "w", a);
				while (r.state.pending && r.state.pending.player === "w") r = applyAction(r.state, "w", legalActions(r.state, "w")[0]);
				assert.equal(kingAt(r.state, "w"), home, key + " " + JSON.stringify(a));
			}
		}
	});

	test("Bounty counts an entered Mirage toward the 9 cap: a stolen move card is lost at 8 real move cards plus the Mirage", () => {
		const s = fresh(), ctx = makeCtx(s);
		s.players.w.moves = Array.from({ length: 8 }, () => moveCard(s, "p"));
		curse(s, "w", "mirage", { piece: "n" }); // ENTERED (NOT WAITING): A MOVE CARD TO ITS HOLDER
		Object.assign(s.players.b, { moves: [moveCard(s, "r")], actives: [] });
		assert.ok(CARDS.bounty.on.capture(ctx, "w", { type: "capture", player: "w", c: "b", t: "q" }));
		assert.deepEqual(ofType(ctx.events, "card-taken").map((e) => e.lost), [true]);
		assert.equal(hand.moveCards(s.players.w).length, 9);
	});
});

describe("no duplicate curses", () => {
	test("the weighted pick leaves out every curse key the target holds (a waiting Mirage counts); nothing left, nothing picked", () => {
		for (let seed = 1; seed <= 40; seed++) {
			const s = fresh(seed), ctx = makeCtx(s), held = ctx.randomCurses(2);
			for (const k of held) curse(s, "b", k, k === "mirage" ? { piece: "p", waiting: true } : undefined);
			for (let i = 0; i < 30; i++) for (const k of ctx.randomCurses(1 + (i % 2), "b")) assert.ok(!held.includes(k), k);
			const rest = ctx.randomCurses(99, "b");
			assert.deepEqual(new Set(rest), new Set(CURSE_KEYS.filter((k) => !held.includes(k))));
			assert.equal(ctx.randomCurses(2, "w").length, 2); // WHITE HOLDS NONE
		}
		const s = fresh(), ctx = makeCtx(s);
		for (const k of CURSE_KEYS) curse(s, "b", k);
		assert.deepEqual(ctx.randomCurses(2, "b"), []);
		assert.ok(CARDS["bad-omen"].on.capture(ctx, "w", { type: "capture", player: "b", c: "w" })); // FIRES, NOTHING TO GIVE
		assert.equal(s.players.b.curses.length, CURSE_KEYS.length);
	});

	test("giveCurse refuses a key the target already holds: false, no change, no event, whatever the limit", () => {
		const s = fresh(), ctx = makeCtx(s);
		assert.ok(ctx.giveCurse("b", "rust", "w", { wait: false }));
		const before = JSON.stringify(s), n = ctx.events.length;
		assert.equal(ctx.giveCurse("b", "rust", "w", { wait: false }), false);
		assert.equal(ctx.giveCurse("b", "rust", "w", { max: Infinity, wait: false }), false);
		assert.equal(JSON.stringify(s), before);
		assert.equal(ctx.events.length, n);
		assert.ok(ctx.giveCurse("w", "rust", "b", { wait: false })); // THE OTHER PLAYER MAY HOLD ONE TOO
	});

	test("the curse-given event holds a copy of the curse: a later change to the held card (a Mirage entering) leaves the event as it was", () => {
		const s = fresh(), ctx = makeCtx(s), card = ctx.giveCurse("b", "mirage", "w", { wait: false }), id = card.id;
		card.id = "c999";
		assert.equal(ofType(ctx.events, "curse-given")[0].card.id, id);
	});

	test("Hexcraft (both versions) and Bad Omen never give a curse the opponent holds; the legendary's two are different", () => {
		for (let seed = 1; seed <= 60; seed++) {
			const s = game("4k3/8/8/8/8/8/PPPP4/4K3 w - - 0 1", seed), ctx = makeCtx(s), [held] = ctx.randomCurses(1);
			curse(s, "b", held);
			CARDS["hexcraft-legendary"].play(ctx, "w");
			const keys = s.players.b.curses.map((c) => c.key);
			assert.equal(keys.length, 3, "seed " + seed);
			assert.equal(new Set(keys).size, 3, keys.join());
			const h = game("4k3/8/8/8/8/8/PPPP4/4K3 w - - 0 1", seed), hctx = makeCtx(h);
			curse(h, "b", held);
			CARDS.hexcraft.play(hctx, "w");
			assert.ok(h.pending.options.length === 2 && h.pending.options[0] !== h.pending.options[1] && !h.pending.options.includes(held));
			const o = fresh(seed), octx = makeCtx(o);
			curse(o, "b", held);
			CARDS["bad-omen"].on.capture(octx, "w", { type: "capture", player: "b", c: "w" });
			assert.ok(o.players.b.curses.length === 2 && o.players.b.curses[1].key !== held);
		}
	});

	test("a passable curse passed back to a player who already holds that curse is simply lost", () => {
		const s = game("4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1");
		s.players.w.moves = [moveCard(s, "p")];
		const m = curse(s, "w", "mirage", { piece: "p" }), theirs = curse(s, "b", "mirage", { piece: "p", waiting: true });
		const r = applyAction(s, "w", { type: "move", card: s.players.w.moves[0].id, from: "e4", to: "d5" });
		assert.deepEqual(r.state.players.w.curses, []);
		assert.deepEqual(ofType(r.events, "curse-cleared").map((e) => e.card.id), [m.id]);
		assert.deepEqual(ofType(r.events, "curse-given"), []);
		assert.deepEqual(r.state.players.b.curses.map((c) => c.id), [theirs.id]);
	});
});

describe("Mirage: no tell from a card's age", () => {
	const lcg = (seed) => { let x = seed >>> 0; return (n) => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x % n; }; }; // THE TEST'S OWN CHOICES, NOT THE GAME'S rng

	test("naming the oldest or the newest move card finds the Mirage no more often than chance", (t) => {
		let tries = 0, chance = 0, oldest = 0, newest = 0;
		for (let seed = 1; seed <= 40; seed++) { // 150 SEEDS MEASURED: OLDEST 608, NEWEST 574, CHANCE 574.8 OF 3449 (BEFORE THE TRADE: 937 AND 178 OF 3497, CHANCE 582.8)
			let s = fresh(seed);
			const pick = lcg(seed);
			for (let ply = 0; ply < 60 && !s.result; ply++) {
				const c = s.pending ? s.pending.player : s.board.turn, acts = legalActions(s, c);
				if (!acts.length) break;
				if (!s.players.b.curses.some((x) => x.key === "mirage")) makeCtx(s).giveCurse("b", "mirage", "w", { wait: false });
				const m = s.players.b.curses.find((x) => x.key === "mirage");
				if (c === "b" && !s.pending && m && !m.waiting) {
					const seen = playerView(s, "b").players.b.moves;
					tries++;
					chance += 1 / seen.length;
					if (seen[0].id === m.id) oldest++;
					if (seen[seen.length - 1].id === m.id) newest++;
				}
				const moves = acts.filter((a) => a.type === "move");
				s = applyAction(s, c, (moves.length ? moves : acts)[pick((moves.length ? moves : acts).length)]).state;
			}
		}
		const msg = "oldest " + oldest + ", newest " + newest + ", chance " + chance.toFixed(1) + " of " + tries;
		t.diagnostic(msg);
		assert.ok(tries >= 600, msg);
		assert.ok(oldest <= chance * 1.25 && oldest >= chance * 0.75, msg);
		assert.ok(newest <= chance * 1.25 && newest >= chance * 0.75, msg);
	});

	test("at each refill an entered Mirage trades places with a random held move card; the holder's view and events are those of a twin game with a real card in its place", () => {
		const at = new Set();
		for (let seed = 1; seed <= 30; seed++) {
			const a = fresh(seed);
			const m = curse(a, "w", "mirage", { piece: "q" });
			a.players.w.moves.pop(); // 5 REAL CARDS AND THE MIRAGE
			const b = JSON.parse(JSON.stringify(a));
			b.players.w.curses = [];
			b.players.w.moves.push({ id: m.id, key: "move", piece: "q" });
			const card = a.players.w.moves.find((c) => legalActions(a, "w").some((x) => x.card === c.id)).id; // A REAL CARD IS PLAYED: THE REFILL DRAWS ONE
			const act = legalActions(a, "w").find((x) => x.card === card), ra = applyAction(a, "w", act), rb = applyAction(b, "w", act);
			assert.deepEqual(playerEvents(ra.state, ra.events, "w"), playerEvents(rb.state, rb.events, "w"));
			assert.deepEqual(playerView(ra.state, "w").players.w, playerView(rb.state, "w").players.w);
			const now = ra.state.players.w.curses[0], twin = rb.state.players.w.moves.find((c) => c.id === now.id);
			assert.ok(now.key === "mirage" && !now.waiting && twin && twin.piece === now.piece);
			assert.equal(new Set(hand.moveCards(ra.state.players.w).map((c) => c.id)).size, 6);
			assert.deepEqual(playerView(ra.state, "b").players.w.hand.shown.map((c) => [c.id, c.key]), [[now.id, "mirage"]]); // THE GIVER SEES WHERE IT IS NOW
			assert.deepEqual(JSON.parse(JSON.stringify(ra.state)), ra.state);
			blind(ra.state, ra.events, "w");
			at.add(now.id === m.id ? "same" : ofType(rb.events, "draw").some((e) => e.card.id === now.id) ? "new" : "old");
		}
		assert.deepEqual([...at].sort(), ["new", "old", "same"]);
	});
});

describe("a cancelled Mulligan (user ruling R3)", () => {
	const cancelled = (arm) => {
		const s = fresh(), c = hand.newCard(s, "mulligan");
		s.players.w.actives = [c];
		arm(s);
		const r = applyAction(s, "w", { type: "active", card: c.id });
		assert.equal(ofType(r.events, "card-cancelled").length, 1);
		assert.deepEqual(ofType(r.events, "discard").filter((e) => e.card.key === "move"), []); // THE HAND IS KEPT
		assert.deepEqual(r.state.players.w.moves, s.players.w.moves);
		assert.ok(!r.state.players.w.actives.some((a) => a.id === c.id)); // THE CARD IS SPENT
		assert.deepEqual([r.state.board.turn, r.state.multi, r.state.ply], ["b", null, 1]); // THE TURN ENDS, AS AFTER ANY CANCELLED ACTIVE
		return r;
	};

	test("by Rust: the turn ends, the hand is kept, the card is spent", () => {
		const r = cancelled((s) => curse(s, "w", "rust"));
		assert.deepEqual(r.state.players.w.curses, []);
	});

	test("by Veto: the same", () => {
		register(require("../../cards-engine/cards/passive/veto.js")); // HERE, NOT AT THE TOP: THE TESTS ABOVE DRAW THEIR PASSIVES FROM THE CARDS REGISTERED THERE
		const r = cancelled((s) => s.effects.push({ id: "v1", owner: "b", card: { id: "v1", key: "veto" }, placedAt: 0 }));
		assert.ok(r.events.some((e) => e.type === "passive-fired" && e.card.key === "veto"));
	});
});
