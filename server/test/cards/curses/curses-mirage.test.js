/*
 *  curses-mirage.test.js  --  chess cards engine tests
 *	Mirage: hidden from its holder, seen by its giver.
 *
 */

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const { legalActions, applyAction, actionKey, playerView, playerEvents } = require("../../../../cards-engine/index.js");
const { makeCtx } = require("../../../../cards-engine/ctx.js");
const hand = require("../../../../cards-engine/hand.js");
const { CARDS } = require("../../../../cards-engine/cards/index.js");
const { fresh, game, ofType, curse, moveCard, firstMove, blind } = require("../../helpers/curses.js");

describe("Mirage", () => {
	test("given: a waiting curse { id, key, piece } of a type its holder has; no number taken from nextId; nothing in the holder's view, events or actions shows it; the giver sees it", () => {
		const s = fresh(), before = JSON.parse(JSON.stringify(s)), ctx = makeCtx(s);
		const m = ctx.giveCurse("b", "mirage", "w");
		assert.ok(m.waiting && m.key === "mirage" && !m.id.startsWith("c"));
		assert.ok(s.board.sq.some((q) => q && q.c === "b" && hand.fits(m.piece, q.t)));
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

	test("a Mirage given to a holder with a knight and a bishop only is a Knight / Bishop card, never a Knight or a Bishop card", () => {
		for (let seed = 1; seed <= 8; seed++) assert.equal(makeCtx(game("1nb1k3/8/8/8/8/8/PPPP4/4K3 w - - 0 1", seed)).giveCurse("b", "mirage", "w").piece, "m");
	});

	test("Hexcraft and Bad Omen give a Mirage with a valid piece type: one the holder has, picked by state.rng", () => {
		const s = game("1n2k1r1/8/8/8/8/8/PPPP4/4K3 w - - 0 1"), ctx = makeCtx(s); // BLACK HAS NO PAWN
		ctx.randomCurses = () => ["mirage", "tremor"];
		CARDS.hexcraft.play(ctx, "w");
		CARDS.hexcraft.choice.resolve(ctx, s.pending, "mirage");
		const [m] = s.players.b.curses;
		assert.ok(m.key === "mirage" && m.waiting && ["m", "r"].includes(m.piece), m.piece);
		const types = new Set();
		for (let seed = 1; seed <= 12; seed++) {
			const o = game("1n2k1r1/8/8/8/8/8/PPPP4/4K3 w - - 0 1", seed), twin = makeCtx(JSON.parse(JSON.stringify(o))), octx = makeCtx(o);
			octx.randomCurses = () => ["mirage"];
			CARDS["bad-omen"].on.capture(octx, "w", { type: "capture", player: "b", c: "w" });
			const [n] = o.players.b.curses;
			assert.equal(n.piece, hand.cardOf(twin.rng.pick(["n", "r"]))); // THE RULE: state.rng PICKS ONE OF THE HOLDER'S NON-KING PIECES (BOARD ORDER); ITS CARD TYPE
			types.add(n.piece);
		}
		assert.deepEqual([...types].sort(), ["m", "r"]);
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

	test("the refill (hand.js): when an entered Mirage trades ids with a move card, the opponent's real Foresight entry (data.ids) follows the card, not the id", () => {
		let traded = 0;
		for (let seed = 1; seed <= 12; seed++) {
			const s = fresh(seed), m = curse(s, "w", "mirage", { piece: "p" }), ctx = makeCtx(s);
			const sight = { id: "e990", key: "foresight", owner: "b", pieces: [], left: 1, data: { ids: [m.id] } };
			s.enchant.push(sight);
			hand.refill(ctx, "w");
			const now = s.players.w.curses.find((c) => c.key === "mirage");
			if (now.id !== m.id) traded++;
			assert.deepEqual(sight.data.ids, [now.id], "seed " + seed);
		}
		assert.ok(traded >= 3, "traded only " + traded);
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
		const s = fresh(), m = curse(s, "w", "mirage", { piece: "m" });
		const twin = JSON.parse(JSON.stringify(s));
		twin.players.w.curses = [];
		twin.players.w.moves.push({ id: m.id, key: "move", piece: "m" });
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
		const s = game("4r1k1/8/8/8/8/8/8/2N1K3 w - - 0 1"), m = curse(s, "w", "mirage", { piece: "m" });
		const twin = JSON.parse(JSON.stringify(s));
		twin.players.w.curses = [];
		twin.players.w.moves.push({ id: m.id, key: "move", piece: "m" });
		assert.ok(legalActions(twin, "w").some((a) => a.card === m.id && a.to === "e2"));
		assert.ok(!legalActions(s, "w").some((a) => a.card === m.id));
	});

	test("counts as a move card: toward the 9 cap and the refill's 5", () => {
		const s = fresh();
		s.players.w.moves = Array.from({ length: 8 }, () => moveCard(s, "p"));
		curse(s, "w", "mirage", { piece: "p" });
		const ctx = makeCtx(s);
		ctx.draw("w", 1);
		assert.deepEqual(ofType(ctx.events, "draw").map((e) => !!e.lost), [true]);
		assert.equal(blind(s, ctx.events, "w").players.w.moves.length, 9);
		const t = fresh();
		curse(t, "w", "mirage", { piece: "p" }); // 5 REAL + IT: 6 SHOWN
		const r = applyAction(t, "w", t.players.w.moves.length && legalActions(t, "w").find((a) => a.type === "move" && t.players.w.moves.some((c) => c.id === a.card)));
		assert.ok(!ofType(r.events, "draw").some((e) => e.player === "w" && e.card && e.card.key === "move")); // 4 REAL + IT: NO DRAW
		assert.equal(playerView(r.state, "w").players.w.moves.length, 5);
	});

	test("a free discard of it is a real discard: it pairs as a move card, a move card is drawn back and the curse is gone", () => {
		const s = fresh(), m = curse(s, "w", "mirage", { piece: "p" });
		s.players.w.kept = { id: "t0", key: "move", piece: "p" }; // A MOVE CARD REMEMBERED: THE MIRAGE IS ITS PAIR
		const a = legalActions(s, "w").find((x) => x.type === "discard" && x.cards.includes(m.id));
		assert.equal(a.cards.length, 1);
		const r = applyAction(s, "w", a);
		assert.deepEqual(r.state.players.w.curses, []);
		assert.deepEqual(ofType(playerEvents(r.state, r.events, "w"), "discard")[0], { type: "discard", player: "w", card: { id: m.id, key: "move", piece: "p" } });
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

	test("Cleanse never offers or clears a Mirage, entered or waiting", () => {
		const s = fresh(), cl = hand.newCard(s, "cleanse");
		s.players.w.actives = [cl];
		makeCtx(s).giveCurse("w", "mirage", "b");
		assert.ok(!legalActions(s, "w").some((a) => a.type === "active"));
		blind(s, [], "w");
	});
});
