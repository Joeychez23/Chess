/*
 *  curses-basic.test.js  --  chess cards engine tests
 *	Dead Weight, Traitor's Mark, Tremor, Shackles, Cleanse's "all of your curses", and Traitor's Mark and Shackles edge cases.
 *
 */

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const { legalActions, applyAction, actionKey, playerView, playerEvents } = require("../../../../cards-engine/index.js");
const { makeCtx } = require("../../../../cards-engine/ctx.js");
const hand = require("../../../../cards-engine/hand.js");
const statuses = require("../../../../cards-engine/statuses.js");
const { register, CARDS } = require("../../../../cards-engine/cards/index.js");
const { LOG, fresh, game, ofType, at, curse, moveCard, firstMove, clears } = require("../../helpers/curses.js");
const castles = (s, color) => legalActions(s, color).filter((a) => a.type === "move" && a.card === "king" && Math.abs(a.from.charCodeAt(0) - a.to.charCodeAt(0)) === 2);

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
	test("under its holder's Fog of War the Frozen it gives a fogged pawn, and its given and ended events, stay hidden from the opponent; the holder (the pawn's owner) never sees them", () => {
		const s = game("4k3/8/8/8/8/8/P7/4K3 w - - 0 1"), ctx = makeCtx(s);
		s.enchant.push({ id: "e990", key: "fog-of-war", owner: "w", pieces: [], left: null, data: {} });
		const t = curse(s, "w", "tremor"), id = at(s, "a2").id;
		assert.ok(CARDS.tremor.on.draw(ctx, "w", { type: "draw", player: "w", card: moveCard(s, "p") }, { owner: "w", card: t }));
		assert.ok(s.statuses[id].some((e) => e.s === "frozen" && e.veiled));
		assert.ok(!(id in playerView(s, "b").statuses), "shown under the fog");
		assert.ok(!(id in playerView(s, "w").statuses), "shown to its owner");
		assert.equal(ofType(playerEvents(s, ctx.events, "b"), "status").length, 0);
		assert.equal(ofType(playerEvents(s, ctx.events, "w"), "status").length, 0);
		const n = ctx.events.length;
		require("../../../../cards-engine/statuses.js").clear(ctx, id, "frozen");
		assert.equal(ofType(playerEvents(s, ctx.events.slice(n), "b"), "status-ended").length, 0);
		assert.equal(ofType(playerEvents(s, ctx.events.slice(n), "w"), "status-ended").length, 0);
		const open = game("4k3/8/8/8/8/8/P7/4K3 w - - 0 1"), octx = makeCtx(open), ot = curse(open, "w", "tremor"); // NO FOG: SHOWN AS BEFORE
		CARDS.tremor.on.draw(octx, "w", { type: "draw", player: "w", card: moveCard(open, "p") }, { owner: "w", card: ot });
		assert.ok(playerView(open, "b").statuses[at(open, "a2").id]);
		assert.ok(ofType(playerEvents(open, octx.events, "b"), "status").length === 1 && !JSON.stringify(playerEvents(open, octx.events, "b")).includes("veiled"));
	});

	test("a second Tremor on a pawn whose Frozen is veiled keeps it veiled: the pawn's owner and the opponent still see nothing", () => {
		const s = game("4k3/8/8/8/8/8/P7/4K3 w - - 0 1"), ctx = makeCtx(s), id = at(s, "a2").id;
		s.enchant.push({ id: "e990", key: "fog-of-war", owner: "w", pieces: [], left: null, data: {} });
		const draw = () => CARDS.tremor.on.draw(ctx, "w", { type: "draw", player: "w", card: moveCard(s, "p") }, { owner: "w", card: curse(s, "w", "tremor") });
		assert.ok(draw());
		s.statuses[id].find((e) => e.s === "frozen").left = 1; // TWO TURNS ON
		const n = ctx.events.length;
		assert.ok(draw());
		assert.deepEqual(s.statuses[id].filter((e) => e.s === "frozen").map((e) => [e.left, e.veiled]), [[3, true]]);
		for (const c of ["w", "b"]) {
			assert.ok(!(id in playerView(s, c).statuses), "shown to " + c);
			assert.equal(ofType(playerEvents(s, ctx.events.slice(n), c), "status").length, 0, "told to " + c);
		}
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
			assert.equal(s.players.w.moves.length, 6); // THE DRAWN CARD STAYS
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
		const m = curse(s, "w", "mirage", { piece: "m" });
		assert.ok(!legalActions(s, "w").some((a) => a.type === "active"), "Cleanse shows a Mirage");
		const c = curse(s, "w", "shackles");
		const r = applyAction(s, "w", { type: "active", card: cl.id, target: { curses: "all" } });
		assert.deepEqual(r.state.players.w.curses.map((x) => x.key), [m.key]); // ITS ID MAY HAVE CHANGED AT THE REFILL
		assert.deepEqual(ofType(r.events, "curse-cleared").map((e) => e.card.id), [c.id]);
	});
});

describe("Traitor's Mark and Shackles edge cases", () => {
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
