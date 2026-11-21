/*
 *  cards-passive-other.test.js  --  chess cards engine tests
 *	The passives that are not capture or check triggers (cards-engine/cards/passive/): trigger and non-trigger cases, one describe per card.
 *
 */

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const { newGame, legalActions, applyAction, playerView, playerEvents } = require("../../cards-engine/index.js");
const { fromView } = require("../../cards-engine/view.js");
const hand = require("../../cards-engine/hand.js");
const { register, reset, CARDS, baseKey } = require("../../cards-engine/cards/index.js");
const { makeCtx } = require("../../cards-engine/ctx.js");
const { fromFen, sqIndex } = require("../../cards-engine/board.js");
const { inCheck } = require("../../cards-engine/rules.js");

reset();
register(require("../../cards-engine/cards/active/foresight.js"));
for (const key of ["interdicted-foresight", "witness", "veto", "echo", "peasant-immunity", "phalanx", "unbroken-line", "pawn-storm"]) register(require("../../cards-engine/cards/passive/" + key + ".js"));
register({ key: "t-flag", kind: "active", name: "t-flag", rarity: "common", text: "", targets: () => [null], play: (ctx, player) => { ctx.state.flag = player; }, versions: [{ rarity: "rare", text: "" }] });
for (const key of ["double-time", "conscription"]) register(require("../../cards-engine/cards/active/" + key + ".js"));
register({ key: "t-none", kind: "passive", name: "t-none", rarity: "common", text: "" });
for (const key of ["t-a", "t-b", "t-c"]) register({ key, kind: "active", name: key, rarity: "common", text: "", targets: () => [null], play: () => {} });
for (const key of ["underdog", "four-of-a-kind", "patience"]) register(require("../../cards-engine/cards/passive/" + key + ".js"));
register(require("../../cards-engine/cards/curse/mirage.js"));
register(require("../../cards-engine/cards/active/swap.js"));
register(require("../../cards-engine/cards/curse/debt.js"));
register(require("../../cards-engine/cards/curse/hollow-crown.js"));

const IF = "interdicted-foresight";
const fresh = (seed = 1) => newGame({ cardGuy: "b", level: 1300, seed });
const ofType = (events, type) => events.filter((e) => e.type === type);
const ids = (cards) => cards.map((c) => c.id);
const byId = (a, b) => Number(a.slice(1)) - Number(b.slice(1));
const hidden = (p) => [...p.moves, ...p.actives, ...(p.passive ? [p.passive] : [])];
const fired = (events, key) => events.some((e) => e.type === "passive-fired" && e.card.key === key);
const waits = (s, key) => s.effects.some((e) => e.card.key === key);
const shown = (s, viewer) => playerView(s, viewer).players[viewer === "w" ? "b" : "w"].hand.shown;
const movesOf = (s, color) => legalActions(s, color).filter((a) => a.type === "move");
const varied = (s, color, i) => applyAction(s, color, movesOf(s, color)[(i * 7 + 3) % movesOf(s, color).length]).state;
const play = (s, color, id) => applyAction(s, color, { type: "active", card: id });

/**
 * @description Place passive key for owner in Board Effects (placedAt = the current ply, or at); returns its card.
 */
function place(s, key, owner, at = s.ply) {
	const card = hand.newCard(s, key);
	s.effects.push({ id: card.id, owner, card, placedAt: at });
	return card;
}

/**
 * @description color holds exactly one active, of this key; returns its id.
 */
function give(s, key, color = "w") {
	const c = hand.newCard(s, key);
	s.players[color].actives = [c];
	return c.id;
}

describe("Interdicted Foresight", () => {
	test("the opponent's Foresight is cancelled; they see as many fake cards as it would have shown, each wearing the id of one of the owner's hidden cards", () => {
		let differs = false;
		for (const seed of [1, 2, 3, 4]) {
			const s = fresh(seed);
			place(s, IF, "b");
			const id = give(s, "foresight"), real = hidden(s.players.b), want = Math.ceil(real.length / 2);
			const { state, events } = play(s, "w", id);
			assert.deepEqual(ofType(events, "card-cancelled").map((e) => e.card.id), [id]);
			assert.ok(fired(events, IF) && !waits(state, IF));
			assert.ok(!state.enchant.some((e) => e.key === "foresight"), "Foresight still ran");
			const seen = state.players.w.seen;
			assert.deepEqual([seen.ids, seen.all, seen.fake.length], [[], false, want]);
			assert.equal(new Set(ids(seen.fake)).size, want);
			for (const f of seen.fake) {
				const r = real.find((c) => c.id === f.id);
				assert.ok(r, "fake id " + f.id + " is not a hidden card's");
				assert.deepEqual(Object.keys(f), Object.keys(r), "a fake is shaped like the card under it");
				assert.equal(f.key === "move" ? "move" : CARDS[f.key].kind, r.key === "move" ? "move" : CARDS[r.key].kind);
				if (JSON.stringify(f) !== JSON.stringify(r)) differs = true;
			}
			const v = playerView(state, "w");
			assert.deepEqual(v.players.b.hand.shown, [...seen.fake].sort((a, b) => byId(a.id, b.id)));
			assert.equal(v.players.b.hand.count, real.length);
			assert.ok(!("seen" in v.players.w));
			for (const e of v.enchant) assert.ok(!("fake" in e.data) && !("ids" in e.data), "which shown cards are fake, in the view");
			assert.ok(!JSON.stringify(playerEvents(state, events, "w")).includes("\"fake\""));
		}
		assert.ok(differs, "the fakes are random cards, not the real ones");
	});

	test("a state rebuilt from either player's view while whole-hand fakes last plays on (no sight bookkeeping in it)", () => {
		const s = fresh();
		place(s, IF, "b");
		const st = play(s, "w", give(s, "foresight-epic")).state;
		for (const viewer of ["w", "b"]) {
			let f = fromView(playerView(st, viewer), 5);
			for (let i = 0; i < 4 && !f.result; i++) f = varied(f, f.board.turn, i);
			assert.ok(!f.enchant.some((e) => e.data && (e.data.fake || e.data.ids)));
		}
	});

	test("the fakes last as long as that Foresight would have (until the end of the opponent's next turn)", () => {
		const s = fresh();
		place(s, IF, "b");
		let st = play(s, "w", give(s, "foresight")).state;
		st = varied(st, "b", 0);
		assert.ok(shown(st, "w").length > 0, "gone on the owner's turn");
		const last = applyAction(st, "w", movesOf(st, "w")[0]);
		assert.ok(ofType(last.events, "enchant-ended").some((e) => e.key === IF));
		assert.equal(last.state.players.w.seen, null);
		assert.deepEqual(shown(last.state, "w"), []);
	});

	test("a fake goes when the card under it leaves the owner's hand", () => {
		let done = false;
		for (let seed = 1; seed < 20 && !done; seed++) {
			const s = fresh(seed);
			place(s, IF, "b");
			const st = play(s, "w", give(s, "foresight")).state, fakes = ids(st.players.w.seen.fake);
			const a = movesOf(st, "b").find((x) => fakes.includes(x.card));
			if (!a) continue;
			const after = applyAction(st, "b", a).state, left = ids(shown(after, "w"));
			assert.ok(!left.includes(a.card));
			assert.deepEqual(left, fakes.filter((x) => x !== a.card).sort(byId));
			done = true;
		}
		assert.ok(done, "no seed spent a card under a fake");
	});

	test("any version of Foresight is cancelled; the whole-hand ones show a fake for every hidden card, later draws too, for as long as that version lasts", () => {
		for (const [key, turns] of [["foresight-rare", 1], ["foresight-epic", 3]]) {
			const s = fresh();
			place(s, IF, "b");
			s.players.b.passive = hand.newCard(s, "t-none");
			s.players.b.moves.pop(); // BLACK'S END-OF-TURN REFILL DRAWS A NEW MOVE CARD
			const id = give(s, key), whole = (st) => ids(hidden(st.players.b)).sort(byId);
			const r = play(s, "w", id);
			assert.deepEqual(ofType(r.events, "card-cancelled").map((e) => e.card.key), [key]);
			assert.ok(!r.state.enchant.some((e) => e.key === "foresight"));
			assert.deepEqual(ids(shown(r.state, "w")), whole(r.state), key);
			let st = r.state, n = 0;
			for (let i = 0; st.players.w.seen && i < 20; i++) {
				const b = applyAction(st, "b", movesOf(st, "b")[(i * 7 + 3) % movesOf(st, "b").length]);
				st = b.state;
				if (i === 0) assert.ok(ofType(b.events, "draw").some((e) => e.player === "b"));
				assert.deepEqual(ids(shown(st, "w")), whole(st), key + ": not a fake per card on turn " + n);
				st = varied(st, "w", i);
				n++;
			}
			assert.equal(n, turns, key);
			assert.equal(st.players.w.seen, null);
		}
	});

	test("not fired by another active or by the owner's own Foresight", () => {
		const s = fresh();
		place(s, IF, "b");
		let r = play(s, "w", give(s, "t-flag"));
		assert.ok(!fired(r.events, IF) && waits(r.state, IF));
		assert.equal(r.state.flag, "w");
		r = play(r.state, "b", give(r.state, "foresight", "b"));
		assert.ok(!fired(r.events, IF) && waits(r.state, IF));
		assert.ok(r.state.players.b.seen.ids.length > 0);
		assert.ok(fired(play(r.state, "w", give(r.state, "foresight")).events, IF), "still waiting for the opponent's Foresight");
	});

	test("the fakes ending keep a later Foresight's sight", () => {
		const s = fresh();
		place(s, IF, "b");
		let st = varied(play(s, "w", give(s, "foresight")).state, "b", 0);
		st = play(st, "w", give(st, "foresight")).state; // THE FAKES END AT THE END OF THIS TURN, THIS FORESIGHT A TURN LATER
		assert.ok(!st.enchant.some((e) => e.key === IF));
		const half = st.enchant.find((e) => e.key === "foresight").data.ids, held = ids(hidden(st.players.b));
		assert.ok(half.length > 0);
		assert.deepEqual(st.players.w.seen, { ids: half, fake: [], all: false });
		assert.deepEqual(ids(shown(st, "w")), half.filter((x) => held.includes(x)).sort(byId));
	});

	test("a Foresight played while the fakes last keeps them, and its end keeps them too", () => {
		const s = fresh();
		place(s, IF, "b");
		let st = varied(play(s, "w", give(s, "foresight-epic")).state, "b", 0); // FAKES FOR 3 OF WHITE'S TURNS
		st = play(st, "w", give(st, "foresight")).state;
		const half = st.enchant.find((e) => e.key === "foresight").data.ids, fakes = ids(st.players.w.seen.fake);
		assert.ok(fakes.length > 0);
		assert.deepEqual(st.players.w.seen.ids, half);
		const v = ids(shown(st, "w"));
		assert.equal(new Set(v).size, v.length, "a card shown twice");
		assert.deepEqual(v, [...new Set([...half, ...fakes])].filter((x) => ids(hidden(st.players.b)).includes(x)).sort(byId));
		st = varied(varied(st, "b", 1), "w", 1); // THE FORESIGHT ENDS HERE, THE FAKES LAST A TURN MORE
		assert.ok(!st.enchant.some((e) => e.key === "foresight"));
		assert.deepEqual(st.players.w.seen.ids, []);
		assert.ok(st.players.w.seen.fake.length > 0);
		assert.deepEqual(ids(shown(st, "w")), ids(st.players.w.seen.fake).sort(byId));
		st = varied(varied(st, "b", 2), "w", 2);
		assert.equal(st.players.w.seen, null);
	});

	test("rare version: the owner also sees a random half (rounded up) of the opponent's hand until the end of the owner's next turn, hidden from the opponent", () => {
		assert.deepEqual([CARDS[IF + "-rare"].name, CARDS[IF + "-rare"].rarity, CARDS[IF + "-rare"].skulls], ["Interdicted Foresight", "rare", 0]);
		const s = fresh();
		place(s, IF + "-rare", "b");
		const id = give(s, "foresight"), pool = ids(hidden(s.players.w)).filter((x) => x !== id);
		const r = play(s, "w", id), bs = r.state.players.b.seen;
		assert.ok(fired(r.events, IF + "-rare"));
		assert.ok(r.state.players.w.seen.fake.length > 0, "no fakes");
		assert.equal(bs.ids.length, Math.ceil(pool.length / 2));
		assert.equal(new Set(bs.ids).size, bs.ids.length);
		assert.ok(bs.ids.every((x) => pool.includes(x)));
		assert.deepEqual(ids(shown(r.state, "b")), [...bs.ids].sort(byId));
		const wv = playerView(r.state, "w");
		assert.ok(!("seen" in wv.players.b));
		for (const e of wv.enchant) assert.ok(!("ids" in e.data), "which cards the owner sees, in the opponent's view");
		const next = applyAction(r.state, "b", movesOf(r.state, "b")[0]);
		assert.equal(next.state.players.b.seen, null);
	});

	test("rare version: its sight ending keeps the owner's own Foresight's whole half", () => {
		let checked = false;
		for (let seed = 1; seed < 10 && !checked; seed++) {
			const s = fresh(seed);
			place(s, IF + "-rare", "b");
			let st = play(s, "w", give(s, "foresight")).state;
			const mine = [...st.players.b.seen.ids];
			st = play(st, "b", give(st, "foresight", "b")).state; // THE RARE SIGHT ENDS AT THE END OF THIS TURN
			const half = st.enchant.find((e) => e.key === "foresight" && e.owner === "b").data.ids;
			if (!half.some((x) => mine.includes(x))) continue; // THE CASE NEEDS AN OVERLAP
			assert.deepEqual(st.players.b.seen, { ids: half, fake: [], all: false });
			checked = true;
		}
		assert.ok(checked);
	});
});

describe("Witness", () => {
	test("the opponent's Foresight (any version) shows the owner their whole hand until the end of the owner's next turn; the Foresight still works", () => {
		for (const key of ["foresight", "foresight-rare", "foresight-epic"]) {
			const s = fresh();
			place(s, "witness", "b");
			const r = play(s, "w", give(s, key));
			assert.ok(fired(r.events, "witness"), key);
			assert.deepEqual(ofType(r.events, "card-cancelled"), []);
			assert.ok(r.state.players.w.seen, "the Foresight was stopped");
			assert.ok(r.state.players.b.seen.all);
			assert.deepEqual(ids(shown(r.state, "b")), ids([...hidden(r.state.players.w), ...r.state.players.w.curses]).sort(byId));
			assert.ok(!("seen" in playerView(r.state, "w").players.b));
			const next = applyAction(r.state, "b", movesOf(r.state, "b")[0]);
			assert.equal(next.state.players.b.seen, null, key);
			assert.deepEqual(shown(next.state, "b"), []);
		}
	});

	test("not fired by another active, the owner's own Foresight, or a Foresight already cancelled", () => {
		const s = fresh();
		place(s, "witness", "b");
		let r = play(s, "w", give(s, "t-flag"));
		assert.ok(!fired(r.events, "witness"));
		r = play(r.state, "b", give(r.state, "foresight", "b"));
		assert.ok(!fired(r.events, "witness") && waits(r.state, "witness"));
		const t = fresh();
		place(t, IF, "b", 0);
		place(t, "witness", "b", 1);
		r = play(t, "w", give(t, "foresight"));
		assert.ok(fired(r.events, IF) && !fired(r.events, "witness") && waits(r.state, "witness"));
		assert.equal(r.state.players.b.seen, null);
	});

	test("its sight ending keeps the owner's own Foresight", () => {
		const s = fresh();
		place(s, "witness", "b");
		let st = play(s, "w", give(s, "foresight")).state;
		st = play(st, "b", give(st, "foresight", "b")).state; // THE WITNESS SIGHT ENDS AT THE END OF THIS TURN
		const half = st.enchant.find((e) => e.key === "foresight" && e.owner === "b").data.ids;
		assert.ok(!st.enchant.some((e) => e.key === "witness"));
		assert.deepEqual(st.players.b.seen, { ids: half, fake: [], all: false });
	});
});

describe("Veto", () => {
	test("cancels the opponent's active, a version too; both cards are gone", () => {
		for (const key of ["t-flag", "t-flag-rare", "foresight-epic"]) {
			const s = fresh();
			place(s, "veto", "b");
			const id = give(s, key), { state, events } = play(s, "w", id);
			assert.deepEqual(ofType(events, "card-cancelled").map((e) => e.card.key), [key]);
			assert.ok(fired(events, "veto") && !waits(state, "veto"), key);
			assert.equal(state.flag, undefined);
			assert.ok(!state.enchant.length && state.players.w.seen === null);
			assert.ok(!hidden(state.players.w).some((c) => c.id === id));
		}
	});

	test("not fired by the owner's own active", () => {
		const s = fresh();
		place(s, "veto", "b");
		const st = varied(s, "w", 0), r = play(st, "b", give(st, "t-flag", "b"));
		assert.equal(r.state.flag, "b");
		assert.ok(waits(r.state, "veto"));
		assert.ok(fired(play(r.state, "w", give(r.state, "t-flag")).events, "veto"), "still waiting for the opponent's active");
	});
});

describe("Echo", () => {
	test("the owner gets a copy of the opponent's active (a version stays that version), with a new id; the original still plays", () => {
		for (const key of ["t-flag", "t-flag-rare"]) {
			const s = fresh();
			place(s, "echo", "b");
			const before = s.players.b.actives.length, id = give(s, key), { state, events } = play(s, "w", id);
			assert.ok(fired(events, "echo") && !waits(state, "echo"));
			assert.equal(state.flag, "w");
			const copy = state.players.b.actives.at(-1);
			assert.equal(state.players.b.actives.length, before + 1);
			assert.equal(copy.key, key);
			assert.notEqual(copy.id, id);
			assert.ok(ofType(events, "draw").some((e) => e.player === "b" && e.card.id === copy.id));
			assert.ok(legalActions(state, "b").some((a) => a.type === "active" && a.card === copy.id));
		}
	});

	test("a copy over the 3-active cap is lost; Echo still fires", () => {
		const s = fresh();
		place(s, "echo", "b");
		s.players.b.actives = ["t-flag", "t-flag", "t-flag"].map((k) => hand.newCard(s, k));
		const { state, events } = play(s, "w", give(s, "t-flag"));
		assert.ok(fired(events, "echo"));
		assert.equal(state.players.b.actives.length, 3);
		assert.ok(ofType(events, "draw").some((e) => e.player === "b" && e.lost));
	});

	test("not fired by the owner's own active", () => {
		const s = fresh();
		place(s, "echo", "b");
		const st = varied(s, "w", 0), r = play(st, "b", give(st, "t-flag", "b"));
		assert.ok(!fired(r.events, "echo") && waits(r.state, "echo"));
		assert.ok(fired(play(r.state, "w", give(r.state, "t-flag")).events, "echo"), "still waiting for the opponent's active");
	});
});

describe("Veto and Echo on the same active", () => {
	test("Veto placed first: the card is cancelled and Echo copies nothing (it keeps waiting)", () => {
		for (const key of ["t-flag", "t-flag-rare"]) {
			const s = fresh();
			place(s, "veto", "b", 0);
			place(s, "echo", "b", 1);
			const before = ids(s.players.b.actives), { state, events } = play(s, "w", give(s, key));
			assert.ok(fired(events, "veto") && !fired(events, "echo") && waits(state, "echo"));
			assert.equal(ofType(events, "card-cancelled").length, 1);
			assert.equal(state.flag, undefined);
			assert.deepEqual(ids(state.players.b.actives), before);
		}
	});

	test("Echo placed first: the owner gets the copy, then Veto cancels the original", () => {
		for (const key of ["t-flag", "t-flag-rare"]) {
			const s = fresh();
			place(s, "echo", "b", 0);
			place(s, "veto", "b", 1);
			const { state, events } = play(s, "w", give(s, key));
			assert.ok(fired(events, "echo") && fired(events, "veto"));
			assert.deepEqual(events.filter((e) => e.type === "passive-fired").map((e) => e.card.key), ["echo", "veto"]);
			assert.equal(ofType(events, "card-cancelled").length, 1);
			assert.equal(state.flag, undefined);
			assert.equal(state.players.b.actives.at(-1).key, key);
		}
	});
});

describe("Interdicted Foresight: counts, events and fake keys", () => {
	test("a cancelled whole-hand Foresight shows a fake for every hidden card for its whole duration, even when the Foresight player's own sight ends first", () => {
		for (const first of ["foresight", "foresight-rare"]) {
			const s = fresh();
			let st = varied(play(s, "w", give(s, first)).state, "b", 0); // A REAL SIGHT, ENDING AT THE END OF WHITE'S NEXT TURN
			place(st, IF, "b");
			const r = play(st, "w", give(st, "foresight-epic"));
			st = r.state;
			assert.ok(fired(r.events, IF));
			assert.ok(!st.enchant.some((e) => e.key === "foresight"), "the real sight ended");
			let n = 0;
			for (let i = 0; st.players.w.seen && i < 20; i++, n++) {
				assert.deepEqual(ids(shown(st, "w")), ids(hidden(st.players.b)).sort(byId), first + ": turn " + i);
				st = varied(varied(st, "b", i), "w", i);
			}
			assert.equal(n, 3);
		}
	});

	test("under whole-hand fakes, the owner's draws reach the Foresight player with the fake card, never the real one", () => {
		let differs = false;
		for (const seed of [1, 2, 3, 4]) {
			const s = fresh(seed);
			place(s, IF, "b");
			s.players.b.moves.pop();
			const st = play(s, "w", give(s, "foresight-rare")).state, b = applyAction(st, "b", movesOf(st, "b")[0]);
			const real = ofType(b.events, "draw").filter((e) => e.player === "b"), told = playerEvents(b.state, b.events, "w").filter((e) => e.type === "draw" && e.player === "b");
			const fakes = b.state.enchant.find((e) => e.key === IF && e.owner === "w").data.fake;
			assert.ok(real.length > 0);
			real.forEach((e, i) => {
				assert.deepEqual(told[i].card, fakes.find((f) => f.id === e.card.id), "seed " + seed);
				if (JSON.stringify(told[i].card) !== JSON.stringify(e.card)) differs = true;
			});
		}
		assert.ok(differs, "a real card reached the Foresight player");
	});

	test("a discard of a card under a fake reaches the Foresight player with the fake card (half and whole-hand); a half's other draws and discards stay hidden", () => {
		for (const key of ["foresight", "foresight-rare"]) {
			const s = fresh();
			place(s, IF, "b");
			const st = play(s, "w", give(s, key)).state, fakes = st.players.w.seen.fake;
			const under = fakes.find((f) => st.players.b.moves.some((c) => c.id === f.id));
			const r = applyAction(st, "b", { type: "discard", card: under.id }), told = playerEvents(r.state, r.events, "w");
			assert.deepEqual(told.find((e) => e.type === "discard").card, under, key);
			if (key !== "foresight") continue;
			assert.ok(told.filter((e) => e.type === "draw" && e.player === "b").every((e) => !e.card), "a new draw under a half");
			const other = st.players.b.moves.find((c) => !fakes.some((f) => f.id === c.id)), o = applyAction(st, "b", { type: "discard", card: other.id });
			assert.deepEqual(playerEvents(o.state, o.events, "w").find((e) => e.type === "discard"), { type: "discard", player: "b" });
		}
	});

	test("fake keys make a hand a player could hold: never Interdicted Foresight itself, no two actives of one card", () => {
		for (let seed = 1; seed <= 30; seed++) {
			const s = fresh(seed);
			place(s, IF, "b");
			s.players.b.actives = ["t-a", "t-b"].map((k) => hand.newCard(s, k));
			s.players.b.passive = hand.newCard(s, "t-none");
			const fakes = play(s, "w", give(s, "foresight-rare")).state.players.w.seen.fake;
			const actives = fakes.filter((f) => f.key !== "move" && CARDS[f.key].kind === "active").map((f) => baseKey(f.key));
			assert.equal(actives.length, 2);
			assert.equal(new Set(actives).size, 2, "seed " + seed + ": " + actives);
			assert.ok(fakes.every((f) => f.key === "move" || baseKey(f.key) !== IF), "seed " + seed);
		}
	});

	test("a fake goes at once when its card is discarded, and at the next turn start when its card left the hand without an event", () => {
		const s = fresh();
		place(s, IF, "b");
		const st = play(s, "w", give(s, "foresight")).state, ctx = makeCtx(st), fakes = () => ids(st.players.w.seen.fake);
		const [a, b] = st.players.w.seen.fake.filter((f) => st.players.b.moves.some((c) => c.id === f.id));
		ctx.emit({ type: "discard", player: "b", card: hand.take(st.players.b, a.id) });
		assert.ok(!fakes().includes(a.id), "after the discard");
		hand.take(st.players.b, b.id); // NO EVENT: A WAY OUT OF THE HAND THE WATCH LIST DOESN'T NAME
		assert.ok(fakes().includes(b.id));
		ctx.emit({ type: "turn-start", player: "w" });
		assert.ok(!fakes().includes(b.id), "after the turn start");
	});

	test("only Foresight, Witness and Interdicted Foresight entries give sight; another card's data named ids, fake or all is left alone, in the view too", () => {
		const s = fresh(), x = s.players.b.moves[0];
		s.enchant.push({ id: "e" + s.nextId++, key: "t-other", owner: "w", pieces: [], left: null, data: { ids: [x.id], fake: [{ id: x.id, key: "move", piece: "q" }], all: true } });
		const st = play(s, "w", give(s, "foresight")).state, f = st.enchant.find((e) => e.key === "foresight");
		assert.deepEqual(st.players.w.seen, { ids: f.data.ids, fake: [], all: false });
		assert.deepEqual(playerView(st, "w").enchant.find((e) => e.key === "t-other").data, st.enchant.find((e) => e.key === "t-other").data);
	});
});

describe("Passives on the same Foresight", () => {
	test("Interdicted Foresight placed first: a later Veto keeps waiting", () => {
		const s = fresh();
		place(s, IF, "b", 0);
		place(s, "veto", "b", 1);
		const { state, events } = play(s, "w", give(s, "foresight"));
		assert.ok(fired(events, IF) && !fired(events, "veto") && waits(state, "veto"));
		assert.equal(ofType(events, "card-cancelled").length, 1);
	});

	test("Witness placed before Interdicted Foresight: the owner sees the whole hand, then the Foresight is cancelled and its player gets fakes", () => {
		const s = fresh();
		place(s, "witness", "b", 0);
		place(s, IF, "b", 1);
		const { state, events } = play(s, "w", give(s, "foresight"));
		assert.deepEqual(events.filter((e) => e.type === "passive-fired").map((e) => e.card.key), ["witness", IF]);
		assert.equal(ofType(events, "card-cancelled").length, 1);
		assert.ok(state.players.b.seen.all);
		assert.ok(state.players.w.seen.fake.length > 0 && !state.players.w.seen.all);
	});
});

/**
 * @description A game on this FEN with empty hands (King cards kept) and the given move cards per colour ({ w: ["p"], b: ["k"] }).
 */
function game(fen, cards = {}) {
	const s = fresh();
	s.board = fromFen(fen);
	for (const c of ["w", "b"]) Object.assign(s.players[c], { moves: (cards[c] || []).map((piece) => hand.newCard(s, "move", { piece })), actives: [], passive: null });
	return s;
}
const moveOf = (s, color, from, to) => legalActions(s, color).find((a) => a.type === "move" && a.from === from && a.to === to);

/**
 * @description key still waits after legalActions for both sides and after a fromView simulation (from either view, a few plies) over s.
 */
function waitsThrough(s, key) {
	legalActions(s, "w");
	legalActions(s, "b");
	assert.ok(waits(s, key), "fired by legalActions");
	for (const viewer of ["w", "b"]) {
		const f = fromView(playerView(s, viewer), 3);
		legalActions(f, f.board.turn);
		assert.ok(waits(f, key), "fired in a fromView state");
	}
}

describe("Peasant Immunity", () => {
	const PAWN_CHECK = "r3k3/8/5P2/8/8/8/8/4K3 w - - 0 1"; // f6-f7 WOULD CHECK THE e8 KING

	test("a pawn move that would check the owner's king gives no check; the opponent's pawn can't take the king; it keeps waiting while that pawn check stands", () => {
		const s = game(PAWN_CHECK, { w: ["p"], b: ["r"] });
		place(s, "peasant-immunity", "b");
		const r = applyAction(s, "w", moveOf(s, "w", "f6", "f7"));
		assert.deepEqual(ofType(r.events, "check"), []);
		assert.ok(!inCheck(r.state, "b") && waits(r.state, "peasant-immunity"));
		assert.ok(moveOf(r.state, "b", "a8", "a7"), "a move that leaves the king where the pawn attacks it");
		const stay = applyAction(r.state, "b", moveOf(r.state, "b", "a8", "a7")).state; // THE KING STAYS ON e8, ATTACKED BY THE f7 PAWN
		assert.ok(waits(stay, "peasant-immunity"));
		assert.ok(!legalActions(stay, "w").some((a) => a.to === "e8"), "the pawn may take the king");
		assert.equal(stay.result, null);
		waitsThrough(stay, "peasant-immunity");
	});

	test("fires once the pawn check it stopped is over, and leaves Board Effects (not a once-per-game card)", () => {
		const s = game(PAWN_CHECK, { w: ["p"], b: ["r"] });
		place(s, "peasant-immunity", "b");
		const st = applyAction(s, "w", moveOf(s, "w", "f6", "f7")).state, r = applyAction(st, "b", moveOf(st, "b", "e8", "d8"));
		assert.ok(fired(r.events, "peasant-immunity") && !waits(r.state, "peasant-immunity"));
		assert.deepEqual(r.state.players.b.used, []);
		assert.ok(!CARDS["peasant-immunity"].oncePerGame);
	});

	test("a check by a pawn that just promoted is a real check (it is no longer a pawn), and the card keeps waiting", () => {
		const s = game("5k2/3P4/8/8/8/8/8/4K3 w - - 0 1", { w: ["p"] });
		place(s, "peasant-immunity", "b");
		const r = applyAction(s, "w", legalActions(s, "w").find((a) => a.from === "d7" && a.promotion === "q"));
		assert.deepEqual(ofType(r.events, "check").map((e) => e.player), ["b"]);
		assert.ok(waits(r.state, "peasant-immunity"));
		assert.equal(CARDS["peasant-immunity"].rules.givesCheck(s, { id: "x", c: "w", t: "p" }, { owner: "b", card: {} }), false, "a pawn's check stopped");
	});

	test("only the owner's king: the owner's pawns still check the opponent", () => {
		const s = game("4k3/8/8/8/8/5p2/8/4K3 b - - 0 1", { b: ["p"] });
		place(s, "peasant-immunity", "b");
		const r = applyAction(s, "b", moveOf(s, "b", "f3", "f2"));
		assert.deepEqual(ofType(r.events, "check").map((e) => e.player), ["w"]);
		assert.equal(CARDS["peasant-immunity"].rules.givesCheck(s, { id: "x", c: "b", t: "p" }, { owner: "b", card: {} }), true);
	});
});

describe("Phalanx", () => {
	const LINE = "4k3/8/8/3p4/2PPP3/8/8/4K3 w - - 0 1"; // WHITE c4 d4 e4 SIDE BY SIDE; BLACK d5 ATTACKS c4 AND e4

	test("an enemy pawn can't capture one of three of the owner's pawns side by side; another piece can, and two side by side aren't enough", () => {
		const s = game(LINE.replace(" w ", " b "), { b: ["p"] });
		place(s, "phalanx", "w");
		assert.ok(!legalActions(s, "b").some((a) => a.from === "d5" && a.to !== "d4"), "a pawn capture listed");
		const two = game("4k3/8/8/3p4/2PP4/8/8/4K3 b - - 0 1", { b: ["p"] });
		place(two, "phalanx", "w");
		assert.ok(moveOf(two, "b", "d5", "c4"));
		const knight = game("4k3/8/1n6/3p4/2PPP3/8/8/4K3 b - - 0 1", { b: ["n"] });
		place(knight, "phalanx", "w");
		assert.ok(moveOf(knight, "b", "b6", "c4"));
	});

	test("a line never runs over the board's edge onto the next rank", () => {
		const h = game("4k3/8/8/6p1/6PP/P7/8/4K3 b - - 0 1", { b: ["p"] }); // g4 h4, AND a3 (THE SQUARE AFTER h4)
		place(h, "phalanx", "w");
		assert.ok(moveOf(h, "b", "g5", "h4"));
		const a4 = game("4k3/8/8/1p5P/PP6/8/8/4K3 b - - 0 1", { b: ["p"] }); // a4 b4, AND h5 (THE SQUARE BEFORE a4)
		place(a4, "phalanx", "w");
		assert.ok(moveOf(a4, "b", "b5", "a4"));
	});

	test("en passant and a promoting capture are pawn captures too", () => {
		const s = game("4k3/8/8/8/1PP1p3/8/3P4/4K3 w - - 0 1", { w: ["p"], b: ["p"] });
		place(s, "phalanx", "w");
		const r = applyAction(s, "w", moveOf(s, "w", "d2", "d4")).state; // b4 c4 d4 SIDE BY SIDE; e4xd3 WOULD TAKE d4 EN PASSANT
		assert.equal(r.board.ep, "d3");
		assert.ok(!moveOf(r, "b", "e4", "d3"), "en passant listed");
		const p = game("1ppp3k/2P5/8/8/8/8/8/4K3 w - - 0 1", { w: ["p"] }); // A BLACK LINE ON b8 c8 d8 (SET BY HAND)
		place(p, "phalanx", "b");
		assert.ok(!legalActions(p, "w").some((a) => a.from === "c7" && a.to !== "c8"), "a promoting capture listed");
	});

	test("fires at the owner's next turn start, after an opponent's turn on which a pawn capture was denied; legalActions and fromView don't fire it", () => {
		const s = game(LINE, { b: ["p"] });
		place(s, "phalanx", "w");
		const st = applyAction(s, "w", moveOf(s, "w", "e1", "f1")).state; // BLACK'S TURN STARTS WITH d5xc4 AND d5xe4 DENIED
		waitsThrough(st, "phalanx");
		const r = applyAction(st, "b", moveOf(st, "b", "e8", "f8"));
		assert.ok(fired(r.events, "phalanx") && !waits(r.state, "phalanx"));
		assert.deepEqual(r.state.players.w.used, []);
	});

	test("not fired by an opponent's move when no capture was denied", () => {
		const s = game("4k3/8/8/8/2PPP3/8/8/4K3 w - - 0 1");
		place(s, "phalanx", "w");
		const st = applyAction(s, "w", moveOf(s, "w", "e1", "f1")).state, r = applyAction(st, "b", moveOf(st, "b", "e8", "f8"));
		assert.ok(!fired(r.events, "phalanx") && waits(r.state, "phalanx"));
		assert.equal(st.effects[0].card.denied, false, "Black's turn start not recorded");
	});
});

describe("Unbroken Line", () => {
	const castle = (s) => moveOf(s, "w", "e1", "g1");

	test("once per game: castle through an attacked square; it fires when the castle is played, not when it is listed", () => {
		const s = game("4kr2/8/8/8/8/8/8/4K2R w K - 0 1"); // f1 ATTACKED BY THE f8 ROOK
		assert.ok(!castle(s));
		place(s, "unbroken-line", "w");
		assert.ok(castle(s));
		waitsThrough(s, "unbroken-line");
		const r = applyAction(s, "w", castle(s));
		assert.equal(r.state.board.sq[62].t, "k");
		assert.ok(fired(r.events, "unbroken-line") && !waits(r.state, "unbroken-line"));
		assert.deepEqual(r.state.players.w.used, ["unbroken-line"]);
	});

	test("only its owner: the opponent still can't castle through an attacked square", () => {
		const s = game("4k2r/8/8/8/8/8/8/4KR2 b k - 0 1"); // f8 ATTACKED BY THE f1 ROOK
		place(s, "unbroken-line", "w");
		assert.ok(!moveOf(s, "b", "e8", "g8"));
		place(s, "unbroken-line", "b");
		assert.ok(moveOf(s, "b", "e8", "g8"));
	});

	test("castle out of check", () => {
		const s = game("k7/8/8/8/4r3/8/8/4K2R w K - 0 1"); // e4 ROOK CHECKS e1
		assert.ok(!castle(s));
		place(s, "unbroken-line", "w");
		const r = applyAction(s, "w", castle(s));
		assert.ok(fired(r.events, "unbroken-line"));
		assert.ok(!inCheck(r.state, "w"));
	});

	test("never into check; a normal castle doesn't fire it; the opponent's castle doesn't either", () => {
		const into = game("4k1r1/8/8/8/8/8/8/4K2R w K - 0 1"); // g1 ATTACKED
		place(into, "unbroken-line", "w");
		assert.ok(!castle(into));
		const s = game("r3k3/8/8/8/8/8/8/4K2R w Kq - 0 1");
		place(s, "unbroken-line", "w");
		const r = applyAction(s, "w", castle(s));
		assert.ok(!fired(r.events, "unbroken-line") && waits(r.state, "unbroken-line"));
		const b = applyAction(r.state, "b", moveOf(r.state, "b", "e8", "c8"));
		assert.ok(waits(b.state, "unbroken-line"));
		assert.ok(CARDS["unbroken-line"].oncePerGame);
	});
});

describe("Pawn Storm", () => {
	test("the owner promotes a pawn: 2 move cards drawn, then it fires", () => {
		const s = game("k7/4P3/8/8/8/8/8/4K3 w - - 0 1", { w: ["p"] });
		place(s, "pawn-storm", "w");
		const { state, events } = applyAction(s, "w", legalActions(s, "w").find((a) => a.from === "e7" && a.promotion === "q"));
		const at = events.findIndex((e) => e.type === "promote"), end = events.findIndex((e) => e.type === "passive-fired");
		assert.ok(at >= 0 && end > at && fired(events, "pawn-storm") && !waits(state, "pawn-storm"));
		assert.deepEqual(events.slice(at + 1, end).filter((e) => e.type === "draw").map((e) => [e.player, e.card.key]), [["w", "move"], ["w", "move"]]);
	});

	test("not for the opponent's promotion, nor a duel upgrade of a piece that wasn't a pawn; a duel upgrade of a pawn counts", () => {
		const s = game("4k3/8/8/8/8/8/3p4/K7 b - - 0 1", { b: ["p"] });
		place(s, "pawn-storm", "w");
		const r = applyAction(s, "b", legalActions(s, "b").find((a) => a.from === "d2" && a.promotion === "q"));
		assert.ok(!fired(r.events, "pawn-storm") && waits(r.state, "pawn-storm"));
		const t = game("4k3/8/8/8/8/8/8/N3K3 w - - 0 1"), knight = t.board.sq[56].id;
		place(t, "pawn-storm", "w");
		t.duel = { player: "w", piece: knight, card: "all-or-nothing", wins: 1, round: 1 };
		const ctx = makeCtx(t);
		ctx.emit({ type: "promote", player: "w", piece: knight, t: "r" });
		assert.ok(waits(t, "pawn-storm"), "a knight's upgrade");
		ctx.emit({ type: "promote", player: "w", piece: knight, t: "b" }); // THE FIRST UPGRADE OF A PAWN: TO A KNIGHT OR A BISHOP
		assert.ok(!waits(t, "pawn-storm"));
	});
});

describe("Segment 2 fix round 1", () => {
	const at = (s, sq) => s.board.sq[sqIndex(sq)];

	test("Peasant Immunity: once it stops a pawn check, only that pawn is exempt; a second pawn's check is real; it leaves when the recorded pawn stops attacking", () => {
		const s = game("k7/8/5p2/3p4/3P4/4K3/8/2R5 w - - 0 1", { b: ["p"] });
		place(s, "peasant-immunity", "w");
		const st = applyAction(s, "w", moveOf(s, "w", "e3", "e4")).state; // d5 ATTACKS e4: STOPPED
		assert.deepEqual(st.effects[0].card.stopping, [at(st, "d5").id]);
		assert.ok(!moveOf(st, "b", "d5", "e4"), "the recorded pawn may take the king");
		const r = applyAction(st, "b", moveOf(st, "b", "f6", "f5")); // f5 ATTACKS e4 TOO
		assert.deepEqual(ofType(r.events, "check").map((e) => e.player), ["w"]);
		assert.ok(inCheck(r.state, "w") && waits(r.state, "peasant-immunity"));
		const out = applyAction(r.state, "w", moveOf(r.state, "w", "e4", "e3"));
		assert.ok(fired(out.events, "peasant-immunity") && !waits(out.state, "peasant-immunity"));
	});

	test("Unbroken Line: a castle legal without it (Peasant Immunity stopped the pawn check) doesn't spend it, whatever the placement order", () => {
		for (const order of [["peasant-immunity", "unbroken-line"], ["unbroken-line", "peasant-immunity"]]) {
			let s = game("k7/8/8/8/8/8/P2p4/4K2R w K - 0 1", { w: ["p"], b: ["k"] });
			order.forEach((k, i) => place(s, k, "w", i));
			s = applyAction(s, "w", moveOf(s, "w", "a2", "a3")).state;
			s = applyAction(s, "b", moveOf(s, "b", "a8", "b8")).state;
			const r = applyAction(s, "w", moveOf(s, "w", "e1", "g1"));
			assert.ok(!fired(r.events, "unbroken-line") && waits(r.state, "unbroken-line"), order.join());
			assert.deepEqual(r.state.players.w.used, [], order.join());
		}
	});

	test("Unbroken Line: the castle it allowed is tagged through on the move event; under the castler's fog the opponent gets neither castle nor through", () => {
		const s = game("4kr2/8/8/8/8/8/8/4K2R w K - 0 1");
		place(s, "unbroken-line", "w");
		const r = applyAction(s, "w", moveOf(s, "w", "e1", "g1")), ev = ofType(r.events, "move")[0];
		assert.equal(ev.through, true);
		r.state.enchant.push({ id: "e990", key: "fog-of-war", owner: "w", pieces: [], left: null, data: {} });
		const told = ofType(playerEvents(r.state, r.events, "b"), "move")[0];
		assert.ok(!("castle" in told) && !("through" in told));
		const plain = game("r3k3/8/8/8/8/8/8/4K2R w Kq - 0 1");
		assert.ok(!("through" in ofType(applyAction(plain, "w", moveOf(plain, "w", "e1", "g1")).events, "move")[0]));
	});

	test("Phalanx covers the opponent's whole turn: a two-move turn can't take a lined-up pawn on its second move; it fires at the owner's next turn start", () => {
		let s = game("4k3/7p/8/3p4/2PPP3/8/8/4K3 w - - 0 1", { b: ["p", "p"] });
		place(s, "phalanx", "w");
		s = applyAction(s, "w", moveOf(s, "w", "e1", "f1")).state;
		s.players.b.actives = [hand.newCard(s, "double-time")];
		s = applyAction(s, "b", { type: "active", card: s.players.b.actives[0].id }).state;
		s = applyAction(s, "b", moveOf(s, "b", "e8", "f8")).state;
		assert.equal(s.board.turn, "b");
		assert.ok(waits(s, "phalanx"));
		assert.ok(!moveOf(s, "b", "d5", "c4") && !moveOf(s, "b", "d5", "e4"), "a lined-up pawn taken on the second move");
		const r = applyAction(s, "b", moveOf(s, "b", "h7", "h6"));
		const start = r.events.findIndex((e) => e.type === "turn-start" && e.player === "w");
		assert.ok(start >= 0 && r.events.findIndex((e) => e.type === "passive-fired" && e.card.key === "phalanx") > start);
	});

	test("Phalanx records a pawn capture it first stops on the second move of a two-move turn, and fires", () => {
		let s = game("4k3/8/3p4/8/2PPP3/8/8/4K3 w - - 0 1", { b: ["p", "p"] }); // d6 ATTACKS NOTHING UNTIL IT STEPS TO d5
		place(s, "phalanx", "w");
		s = applyAction(s, "w", moveOf(s, "w", "e1", "f1")).state;
		assert.equal(s.effects[0].card.denied, false);
		s.players.b.actives = [hand.newCard(s, "double-time")];
		s = applyAction(s, "b", { type: "active", card: s.players.b.actives[0].id }).state;
		const first = applyAction(s, "b", moveOf(s, "b", "d6", "d5"));
		for (const viewer of ["w", "b"]) for (const e of playerEvents(first.state, first.events, viewer)) assert.ok(!e.card || typeof e.card !== "object" || !("denied" in e.card));
		s = first.state;
		assert.ok(!moveOf(s, "b", "d5", "c4"));
		const r = applyAction(s, "b", moveOf(s, "b", "e8", "f8"));
		assert.ok(fired(r.events, "phalanx"), "blocked without firing");
		for (const viewer of ["w", "b"]) for (const e of playerEvents(r.state, r.events, viewer)) assert.ok(!e.card || typeof e.card !== "object" || !("denied" in e.card), "denied in an event");
	});

	test("whole-hand fakes keep one card per held card when the owner's entered Mirage trades ids at a refill", () => {
		for (let seed = 1; seed <= 40; seed++) {
			const s = fresh(seed);
			place(s, IF, "b");
			const gone = s.players.b.moves.pop();
			s.players.b.curses.push({ id: "m99.0", key: "mirage", piece: gone.piece });
			const all = (st) => ids([...hidden(st.players.b), ...st.players.b.curses]).sort(byId);
			let st = play(s, "w", give(s, "foresight-epic")).state;
			assert.deepEqual(ids(shown(st, "w")), all(st), "seed " + seed);
			st = varied(st, "b", seed);
			assert.deepEqual(ids(shown(st, "w")), all(st), "after the refill, seed " + seed);
		}
	});

	test("Phalanx isn't spent on an opponent turn that is skipped: it still waits", () => {
		const s = game("4k3/8/8/3p4/2PPP3/8/8/4K3 w - - 0 1", { b: ["p"] });
		place(s, "phalanx", "w");
		s.players.b.lostTurns = 1;
		const r = applyAction(s, "w", moveOf(s, "w", "e1", "f1"));
		assert.ok(r.events.some((e) => e.type === "turn-skipped" && e.player === "b"));
		assert.ok(waits(r.state, "phalanx"), "spent on a turn the opponent never played");
	});

	test("Phalanx fires at the start of its owner's own lost turn, after a turn it blocked", () => {
		const s = game("4k3/8/8/3p4/2PPP3/8/8/4K3 w - - 0 1", { b: ["p"] });
		place(s, "phalanx", "w");
		const one = applyAction(s, "w", moveOf(s, "w", "e1", "f1")).state;
		one.players.w.lostTurns = 1;
		const r = applyAction(one, "b", moveOf(one, "b", "e8", "d8"));
		assert.ok(r.events.some((e) => e.type === "turn-skipped" && e.player === "w"));
		assert.ok(fired(r.events, "phalanx") && !waits(r.state, "phalanx"));
	});

	test("Phalanx's and Peasant Immunity's bookkeeping reaches only its owner's view, never under the opponent's Fog of War; a state rebuilt from that view plays as the real one", () => {
		const s = game("4k3/8/8/3p4/2PPP3/8/8/4K3 w - - 0 1", { b: ["p"] });
		place(s, "phalanx", "w");
		const a = applyAction(s, "w", moveOf(s, "w", "e1", "f1")).state;
		const p = game("r3k3/8/2P2P2/8/8/8/8/4K3 w - - 0 1", { w: ["p"] });
		place(p, "peasant-immunity", "b");
		const b = applyAction(p, "w", moveOf(p, "w", "f6", "f7")).state; // f7 ATTACKS e8: STOPPED & RECORDED. c6 ATTACKS d7 FOR REAL
		const kept = (e) => "denied" in e.card || "stopping" in e.card;
		assert.equal(a.effects[0].card.denied, true);
		assert.ok(b.effects[0].card.stopping);
		assert.equal(playerView(a, "w").effects[0].card.denied, true); // THE OWNER'S OWN, NO FOG UP: NOTHING IT CAN'T SEE ON THE BOARD
		assert.deepEqual(playerView(b, "b").effects[0].card.stopping, b.effects[0].card.stopping);
		assert.ok(!playerView(a, "b").effects.some(kept) && !playerView(b, "w").effects.some(kept), "in the opponent's view");
		for (const [st, owner] of [[a, "w"], [b, "b"]]) { // UNDER THE OPPONENT'S FOG IT WOULD TELL A HIDDEN PIECE IS A PAWN
			const fog = JSON.parse(JSON.stringify(st));
			fog.enchant.push({ id: "e990", key: "fog-of-war", owner: owner === "w" ? "b" : "w", pieces: [], left: null, data: {} });
			for (const viewer of ["w", "b"]) assert.ok(!playerView(fog, viewer).effects.some(kept), viewer + " under the fog");
		}
		const again = fromView(playerView(a, "w"), 1); // PHALANX STILL FIRES AT ITS OWNER'S NEXT TURN START
		assert.ok(fired(applyAction(a, "b", moveOf(a, "b", "e8", "f8")).events, "phalanx") && fired(applyAction(again, "b", moveOf(again, "b", "e8", "f8")).events, "phalanx"));
		const kings = (st) => movesOf(st, "b").filter((m) => m.from === "e8").map((m) => m.to).sort(); // PEASANT IMMUNITY STILL EXEMPTS ONLY THE PAWN IT STOPPED
		assert.ok(!kings(b).includes("d7"));
		assert.deepEqual(kings(fromView(playerView(b, "b"), 1)), kings(b));
	});

	test("Pawn Storm through a real Conscription (a pawn turned into a piece by a card): 2 move cards", () => {
		const s = game("k7/8/8/8/8/8/4P3/4K3 w - - 0 1");
		s.players.w.captured = ["q"];
		give(s, "conscription");
		place(s, "pawn-storm", "w");
		const { state, events } = applyAction(s, "w", legalActions(s, "w").find((x) => x.type === "active"));
		const from = events.findIndex((e) => e.type === "promote"), end = events.findIndex((e) => e.type === "passive-fired");
		assert.ok(from >= 0 && end > from && !waits(state, "pawn-storm"));
		assert.equal(events.slice(from + 1, end).filter((e) => e.type === "draw" && e.player === "w").length, 2);
	});

	test("Interdicted Foresight: a draw lost to the hand cap under whole-hand fakes still gets a fake, carried by its event", () => {
		const s = fresh();
		place(s, IF, "b");
		const st = play(s, "w", give(s, "foresight-rare")).state;
		while (st.players.b.moves.length < hand.MOVE_CAP) st.players.b.moves.push(hand.newCard(st, "move", { piece: "p" }));
		const ctx = makeCtx(st);
		hand.drawMove(ctx, "b");
		const ev = ctx.events.find((e) => e.type === "draw" && e.player === "b");
		assert.ok(ev.lost);
		assert.ok(st.enchant.find((e) => e.key === IF).data.fake.some((f) => f.id === ev.card.id));
		assert.equal(playerEvents(st, ctx.events, "w").find((e) => e.type === "draw").card.id, ev.card.id);
	});

	test("Interdicted Foresight: a fake card in a returned event is a copy; changing it leaves the state's fake as it was", () => {
		const s = fresh();
		place(s, IF, "b");
		const st = play(s, "w", give(s, "foresight-rare")).state, ctx = makeCtx(st);
		hand.drawMove(ctx, "b");
		const told = playerEvents(st, ctx.events, "w").find((e) => e.type === "draw"), before = JSON.stringify(st.enchant);
		told.card.key = "changed";
		assert.equal(JSON.stringify(st.enchant), before);
	});

	test("Interdicted Foresight: a Foresight another passive cancelled first leaves it waiting, with no fakes", () => {
		const s = fresh();
		place(s, "veto", "b");
		place(s, IF, "b");
		const { state, events } = play(s, "w", give(s, "foresight"));
		assert.ok(fired(events, "veto") && !fired(events, IF) && waits(state, IF));
		assert.equal(state.players.w.seen, null);
	});

	test("Interdicted Foresight: a face-up card gets no fake, at the cancel or when drawn; nor does a drawn card that is no move, active or passive", () => {
		const s = fresh(), up = s.players.b.moves[0];
		place(s, IF, "b");
		up.faceUp = true;
		const st = play(s, "w", give(s, "foresight-rare")).state, fakes = st.enchant.find((e) => e.key === IF).data.fake;
		assert.equal(fakes.length, hidden(st.players.b).length - 1);
		assert.ok(!fakes.some((f) => f.id === up.id));
		const ctx = makeCtx(st), n = fakes.length;
		ctx.emit({ type: "draw", player: "b", card: { id: "c998", key: "move", piece: "p", faceUp: true } });
		ctx.emit({ type: "draw", player: "b", card: { id: "c999", key: "mirage" } });
		assert.equal(st.enchant.find((e) => e.key === IF).data.fake.length, n);
	});
});

/**
 * @description The first move action of color's that spends a real move card (not a Mirage, not the King card) and lands on an empty square (captures nothing).
 */
const quiet = (s, color) => legalActions(s, color).find((a) => a.type === "move" && s.players[color].moves.some((c) => c.id === a.card) && !s.board.sq[sqIndex(a.to)]);
const taking = (s, color) => legalActions(s, color).find((a) => a.type === "move" && s.players[color].moves.some((c) => c.id === a.card) && s.board.sq[sqIndex(a.to)]);
const real = (s, color, from, to) => legalActions(s, color).find((a) => a.type === "move" && a.from === from && a.to === to && s.players[color].moves.some((c) => c.id === a.card));
const sizes = (p) => [hand.moveCards(p).length, p.actives.length];
const cardsOf = (s, pieces) => pieces.map((piece) => hand.newCard(s, "move", { piece }));
const sameRoundTrip = (s, color, a) => assert.deepEqual(applyAction(JSON.parse(JSON.stringify(s)), color, a), applyAction(s, color, a));

/**
 * @description Move the piece on square `from` to `to` (a board edit, no event).
 */
function shift(s, from, to) {
	s.board.sq[sqIndex(to)] = s.board.sq[sqIndex(from)];
	s.board.sq[sqIndex(from)] = null;
}

/**
 * @description A fresh game with Four of a Kind placed for White; White plays a quiet move, then holds exactly these move cards (piece types) and `more` is applied; then Black plays a quiet move, so White's turn starts. Returns { before: the state before Black's move, state, events }.
 */
function atStart(pieces, more = () => {}) {
	const s = fresh();
	place(s, "four-of-a-kind", "w");
	const before = applyAction(s, "w", quiet(s, "w")).state;
	before.players.w.moves = cardsOf(before, pieces);
	more(before);
	return { before, ...applyAction(before, "b", quiet(before, "b")) };
}

/**
 * @description A fresh game where White places Patience as its turn (the placement turn doesn't count). Returns the state, Black to move.
 */
function placed() {
	const s = fresh();
	s.players.w.passive = hand.newCard(s, "patience");
	return applyAction(s, "w", { type: "passive" }).state;
}

/**
 * @description Black then White play quiet moves, n times; `hook(state)` before each White move. Returns the last { state, events }.
 */
function rounds(st, n, hook = () => {}) {
	let r = { state: st, events: [] };
	for (let i = 0; i < n; i++) {
		const b = applyAction(r.state, "b", quiet(r.state, "b")).state;
		hook(b);
		r = applyAction(b, "w", quiet(b, "w"));
	}
	return r;
}

describe("Underdog", () => {
	test("5+ points of material down at the refill: the owner tops up to 7 move cards and 2 actives; it keeps waiting and never fires", () => {
		const s = fresh();
		place(s, "underdog", "w");
		s.board.sq[sqIndex("a1")] = null; // WHITE A ROOK DOWN: 5
		const { state, events } = applyAction(s, "w", quiet(s, "w"));
		assert.deepEqual(sizes(state.players.w), [7, 2]);
		assert.ok(waits(state, "underdog") && !fired(events, "underdog") && !state.players.w.used.includes("underdog"));
		const b = applyAction(state, "b", quiet(state, "b")).state, next = applyAction(b, "w", quiet(b, "w")).state;
		assert.deepEqual(sizes(next.players.w), [7, 2]);
		assert.ok(waits(next, "underdog"));
	});

	test("4 points down, or only the opponent's Underdog: the usual 6 and 1", () => {
		const s = fresh();
		place(s, "underdog", "w");
		s.board.sq[sqIndex("b1")] = null; // KNIGHT 3 + PAWN 1 = 4
		s.board.sq[sqIndex("h2")] = null;
		assert.deepEqual(sizes(applyAction(s, "w", quiet(s, "w")).state.players.w), [6, 1]);
		assert.equal(CARDS.underdog.rules.bigHand(s, "w", { owner: "w" }), false);
		s.board.sq[sqIndex("g2")] = null; // ONE MORE PAWN: 5
		assert.equal(CARDS.underdog.rules.bigHand(s, "w", { owner: "w" }), true);
		const t = fresh();
		place(t, "underdog", "b");
		t.board.sq[sqIndex("a1")] = null; // WHITE 5 DOWN, BUT THE UNDERDOG IS BLACK'S
		assert.deepEqual(sizes(applyAction(t, "w", quiet(t, "w")).state.players.w), [6, 1]);
	});

	test("material counts pieces on the board by type: a queen down (9) counts, the opponent being down doesn't", () => {
		const s = fresh();
		place(s, "underdog", "w");
		s.board.sq[sqIndex("d1")] = null;
		assert.deepEqual(sizes(applyAction(s, "w", quiet(s, "w")).state.players.w), [7, 2]);
		const t = fresh();
		place(t, "underdog", "w");
		t.board.sq[sqIndex("d8")] = null; // BLACK DOWN, NOT THE OWNER
		assert.deepEqual(sizes(applyAction(t, "w", quiet(t, "w")).state.players.w), [6, 1]);
	});

	test("no longer behind: the extra move card and active already held stay, but aren't refilled", () => {
		const s = fresh();
		place(s, "underdog", "w");
		s.board.sq[sqIndex("a1")] = null;
		let st = applyAction(s, "w", quiet(s, "w")).state;
		assert.deepEqual(sizes(st.players.w), [7, 2]);
		st.board.sq[sqIndex("a8")] = null; // BLACK A ROOK DOWN TOO: EVEN
		st = applyAction(st, "b", quiet(st, "b")).state;
		const { state, events } = applyAction(st, "w", quiet(st, "w"));
		assert.deepEqual(sizes(state.players.w), [6, 2]);
		assert.equal(events.filter((e) => e.type === "draw" && e.player === "w").length, 0);
		assert.ok(waits(state, "underdog"));
	});

	test("a held (entered) Mirage counts as a move card toward the 7", () => {
		const s = fresh();
		place(s, "underdog", "w");
		s.board.sq[sqIndex("a1")] = null;
		const w = s.players.w;
		w.moves = w.moves.slice(0, 5);
		w.curses.push({ id: "c900", key: "mirage", piece: "q" }); // ENTERED: 5 REAL + MIRAGE = 6 SEEN (A QUEEN CARD HAS NO MOVE AT THE START)
		const { state, events } = applyAction(s, "w", quiet(s, "w"));
		assert.deepEqual([hand.moveCards(state.players.w).length, state.players.w.moves.length], [7, 6]);
		assert.equal(events.filter((e) => e.type === "draw" && e.player === "w" && e.card.key === "move").length, 2);
	});

	test("the opponent sees only the hand count (nothing face up); the state survives a JSON round trip", () => {
		const s = fresh();
		place(s, "underdog", "w");
		s.board.sq[sqIndex("a1")] = null;
		sameRoundTrip(s, "w", quiet(s, "w"));
		const { state, events } = applyAction(s, "w", quiet(s, "w"));
		const v = playerView(state, "b");
		assert.deepEqual([v.players.w.hand.count, v.players.w.hand.shown], [9, []]);
		assert.ok(playerEvents(state, events, "b").filter((e) => e.type === "draw").every((e) => !("card" in e)));
		assert.ok(!hidden(state.players.w).some((c) => c.faceUp));
	});
	test("behind with no card to play: the automatic redraw draws 7 move cards, 6 without Underdog", () => {
		const after = (card) => {
			const s = fresh(), n = { w: 1, b: 1 };
			s.board = fromFen("3qk3/8/8/7p/7P/1pp5/p7/K5N1 b - - 0 1"); // WHITE 9 DOWN: Ka1 AND h4 CAN'T MOVE, ONLY Ng1 CAN
			s.board.sq.forEach((q) => { if (q) q.id = q.c + n[q.c]++; });
			Object.assign(s.players.w, { moves: cardsOf(s, ["p", "p", "p"]), actives: [] });
			s.players.b.moves = cardsOf(s, ["q"]);
			if (card) place(s, "underdog", "w");
			return applyAction(s, "b", real(s, "b", "d8", "d7"));
		};
		const on = after(true), off = after(false);
		for (const r of [on, off]) assert.ok(ofType(r.events, "redraw").some((e) => e.player === "w") && !r.state.result);
		assert.deepEqual([sizes(on.state.players.w), sizes(off.state.players.w)], [[7, 0], [6, 0]]);
		assert.ok(waits(on.state, "underdog"));
	});
});

describe("Four of a Kind", () => {
	const FK = "four-of-a-kind";

	test("4 move cards of one type at the start of the owner's turn: it fires and starts a two-move turn (same piece allowed); only moves are offered", () => {
		const { state, events } = atStart(["n", "n", "n", "n", "p", "p"]);
		assert.ok(fired(events, FK) && !waits(state, FK) && !state.players.w.used.includes(FK));
		assert.deepEqual(state.multi, { player: "w", left: 2, moved: [], differ: false, draw: 4 });
		assert.ok(legalActions(state, "w").every((a) => a.type === "move"));
		assert.ok(events.findIndex((e) => e.type === "turn-start" && e.player === "w") < events.findIndex((e) => e.type === "passive-fired"));
	});

	test("3 of a type: it doesn't fire and keeps waiting; it isn't checked at the opponent's turn start", () => {
		const { state, events } = atStart(["n", "n", "n", "p", "p", "b"]);
		assert.ok(!fired(events, FK) && waits(state, FK) && state.multi === null);
		assert.ok(fired(atStart(["n", "n", "n", "p", "p", "p", "p"]).events, FK), "4 pawns fire it");
		const s = fresh();
		place(s, FK, "w");
		s.players.w.moves = cardsOf(s, ["p", "n", "n", "n", "n", "n"]);
		const r = applyAction(s, "w", real(s, "w", "a2", "a3")); // BLACK'S TURN STARTS WITH WHITE HOLDING 5 KNIGHTS
		assert.ok(!fired(r.events, FK) && waits(r.state, FK) && r.state.multi === null);
	});

	test("the same knight moves twice; afterwards the owner's move cards are discarded and only 4 drawn (actives refilled as usual)", () => {
		const { state } = atStart(["n", "n", "n", "n", "p", "p"]);
		const one = applyAction(state, "w", real(state, "w", "g1", "f3"));
		assert.equal(one.state.board.turn, "w");
		sameRoundTrip(one.state, "w", real(one.state, "w", "f3", "g5"));
		const left = ids(hand.moveCards(one.state.players.w)).filter((id) => id !== real(one.state, "w", "f3", "g5").card);
		const { state: st, events } = applyAction(one.state, "w", real(one.state, "w", "f3", "g5"));
		assert.equal(st.board.turn, "b");
		assert.deepEqual(events.filter((e) => e.type === "discard" && e.player === "w").map((e) => e.card.id), left);
		const w = st.players.w;
		assert.equal(hand.moveCards(w).length, 4);
		assert.ok(!ids(w.moves).some((id) => left.includes(id)));
		assert.equal(w.actives.length, 1);
		assert.equal(st.multi, null);
		assert.ok(playerEvents(st, events, "b").filter((e) => e.player === "w" && (e.type === "draw" || e.type === "discard")).every((e) => !("card" in e)));
	});

	test("with Underdog also behind, the refill after it is still only 4 move cards", () => {
		const { state } = atStart(["n", "n", "n", "n", "p", "p"], (st) => { place(st, "underdog", "w"); st.board.sq[sqIndex("a1")] = null; });
		const one = applyAction(state, "w", real(state, "w", "g1", "f3")).state;
		const st = applyAction(one, "w", real(one, "w", "f3", "g5")).state;
		assert.deepEqual(sizes(st.players.w), [4, 2]);
	});

	test("on a lost turn it doesn't fire (the turn isn't played) and waits for the next one", () => {
		const { state, events } = atStart(["n", "n", "n", "n", "p", "p"], (st) => { st.players.w.lostTurns = 1; });
		assert.ok(ofType(events, "turn-skipped").length && !fired(events, FK) && waits(state, FK));
		const r = applyAction(state, "b", quiet(state, "b"));
		assert.ok(fired(r.events, FK) && r.state.multi.player === "w");
	});

	test("an entered Mirage of the type counts (its holder sees 4); afterwards it goes out with the move cards and comes back hidden among the 4", () => {
		const { state, events } = atStart(["n", "n", "n", "p", "p"], (st) => { st.players.w.curses.push({ id: "c900", key: "mirage", piece: "n" }); });
		assert.ok(fired(events, FK));
		const one = applyAction(state, "w", real(state, "w", "g1", "f3")).state;
		const { state: st, events: evs } = applyAction(one, "w", real(one, "w", "b1", "c3"));
		const w = st.players.w;
		assert.deepEqual([hand.moveCards(w).length, w.moves.length, hand.mirages(w).length], [4, 3, 1]);
		const seen = playerEvents(st, evs, "w").filter((e) => e.type === "discard");
		assert.equal(seen.length, 4);
		assert.ok(seen.every((e) => e.card.key === "move"));
		assert.deepEqual(playerView(st, "w").players.w.moves.length, 4);
	});
});

describe("Patience", () => {


	test("3 of the owner's turns in a row without capturing (after the placement turn): it fires and the owner draws an active, above the 1-active slot", () => {
		const two = rounds(placed(), 2);
		assert.ok(waits(two.state, "patience") && !fired(two.events, "patience"));
		const b = applyAction(two.state, "b", quiet(two.state, "b")).state;
		sameRoundTrip(b, "w", quiet(b, "w"));
		const { state, events } = applyAction(b, "w", quiet(b, "w"));
		assert.ok(fired(events, "patience") && !waits(state, "patience") && !state.players.w.used.includes("patience"));
		assert.equal(state.players.w.actives.length, 2);
		assert.equal(events.filter((e) => e.type === "draw" && e.player === "w" && e.card.key !== "move").length, 1);
		assert.ok(playerEvents(state, events, "b").filter((e) => e.type === "draw").every((e) => !("card" in e)));
	});

	test("an owner's capture starts the count again; the opponent's capture doesn't", () => {
		let st = rounds(placed(), 1).state;
		shift(st, "b7", "b3"); // A BLACK PAWN WHITE CAN TAKE
		st = applyAction(st, "b", quiet(st, "b")).state;
		st.players.w.moves = cardsOf(st, ["p", "p", "p", "n", "n", "n"]);
		const cap = applyAction(st, "w", taking(st, "w"));
		assert.ok(ofType(cap.events, "capture").length && !fired(cap.events, "patience"));
		const two = rounds(cap.state, 2);
		assert.ok(waits(two.state, "patience"));
		assert.ok(fired(rounds(two.state, 1).events, "patience"));
		let o = rounds(placed(), 1).state; // THE COUNT RUNS (1), SO A RESTART ON THE OPPONENT'S CAPTURE WOULD SHOW
		const wp = o.board.sq.findIndex((q) => q && q.c === "w" && q.t === "p");
		shift(o, "abcdefgh"[wp & 7] + (8 - (wp >> 3)), "b6"); // A WHITE PAWN BLACK CAN TAKE
		o.players.b.moves = cardsOf(o, ["p", "p", "n", "n", "n", "n"]);
		o = applyAction(o, "b", taking(o, "b")).state;
		assert.equal(o.players.w.captured.length, 1);
		const w1 = applyAction(o, "w", quiet(o, "w")).state;
		assert.ok(fired(rounds(w1, 1).events, "patience"));
	});

	test("with 3 actives held the drawn one is lost to the cap, but it still fires", () => {
		const two = rounds(placed(), 2);
		const b = applyAction(two.state, "b", quiet(two.state, "b")).state;
		b.players.w.actives = ["t-a", "t-b", "t-c"].map((k) => hand.newCard(b, k));
		const { state, events } = applyAction(b, "w", quiet(b, "w"));
		assert.ok(fired(events, "patience"));
		assert.equal(state.players.w.actives.length, 3);
		assert.ok(events.some((e) => e.type === "draw" && e.player === "w" && e.lost));
	});
});

describe("Task 11 segment 3 fix round 1", () => {
	test("Four of a Kind fired, then a Debt due at the same turn start discards the two-move turn's only move: the turn goes on as a normal one, never ending a game the hand could save", () => {
		const after = (seed, card) => {
			const s = fresh(seed);
			s.board = fromFen("r3k3/8/8/8/8/8/3N2PP/7K b - - 0 20"); // AFTER Ra1+ ONLY Nd2 CAN BLOCK; SWAP ALSO ANSWERS THE CHECK
			const n = { w: 1, b: 1 };
			s.board.sq.forEach((q) => { if (q) q.id = q.c + n[q.c]++; });
			s.ply = 20;
			s.board.history = [];
			s.players.w.moves = ["q", "q", "q", "q", "n"].map((piece) => hand.newCard(s, "move", { piece }));
			s.players.w.actives = [hand.newCard(s, "swap")];
			s.players.w.curses.push(hand.newCard(s, "debt", { left: 0 })); // DUE AT WHITE'S NEXT TURN START
			if (card) place(s, "four-of-a-kind", "w", 2);
			s.players.b.moves = ["r", "r", "r", "r", "r", "r"].map((piece) => hand.newCard(s, "move", { piece }));
			return applyAction(s, "b", legalActions(s, "b").find((x) => x.type === "move" && x.to === "a1")).state;
		};
		let dropped = 0;
		for (let seed = 1; seed <= 150; seed++) {
			const off = after(seed, false), on = after(seed, true);
			assert.ok(!(on.result && !off.result), "seed " + seed + ": the game ended only because Four of a Kind was placed");
			if (!on.result && !waits(on, "four-of-a-kind") && !on.multi) dropped++;
		}
		assert.ok(dropped > 0, "no seed reached the case");
	});

	test("C1 Four of a Kind: with no move for the two-move turn it keeps waiting, so an active that answers the check (Swap) is still offered", () => {
		const s = fresh(7);
		s.board = fromFen("r3k3/8/8/8/3N4/8/6PP/7K b - - 0 20");
		const n = { w: 1, b: 1 };
		s.board.sq.forEach((p) => { if (p) p.id = p.c + n[p.c]++; });
		s.ply = 20;
		s.board.history = [];
		s.players.w.moves = cardsOf(s, ["n", "n", "n", "n", "n", "n"]);
		s.players.w.actives = [hand.newCard(s, "swap")];
		place(s, "four-of-a-kind", "w", 2);
		s.players.b.moves = cardsOf(s, ["r", "r", "r", "r", "r", "r"]);
		const { state, events } = applyAction(s, "b", legalActions(s, "b").find((a) => a.type === "move" && a.to === "a1"));
		assert.equal(state.result, null);
		assert.ok(!fired(events, "four-of-a-kind") && waits(state, "four-of-a-kind") && state.multi === null);
		assert.ok(legalActions(state, "w").some((a) => a.type === "active"));
	});

	test("M1 Patience: a capture the owner makes outside their own turn restarts the count at 0; their next capture-free turn counts", () => {
		const st = rounds(placed(), 1).state; // ONE COUNTED TURN; BLACK TO MOVE
		const ctx = makeCtx(st);
		ctx.turn = "b";
		ctx.capture("w", st.board.sq[sqIndex("h7")].id);
		assert.equal(st.effects.find((e) => e.card.key === "patience").card.calm, 0);
		const two = rounds(st, 2);
		assert.ok(waits(two.state, "patience"));
		assert.ok(fired(rounds(two.state, 1).events, "patience"));
	});

	test("M2 Four of a Kind under refillLock: the move cards are still thrown out (a discard each); the lock only stops the draw", () => {
		const { state } = atStart(["n", "n", "n", "n", "p", "p"]);
		const one = applyAction(state, "w", real(state, "w", "g1", "f3")).state;
		one.players.w.refillLock = 1;
		const a = real(one, "w", "f3", "g5"), left = ids(hand.moveCards(one.players.w)).filter((id) => id !== a.card);
		const { state: st, events } = applyAction(one, "w", a);
		assert.deepEqual(events.filter((e) => e.type === "discard" && e.player === "w").map((e) => e.card.id), left);
		assert.equal(events.filter((e) => e.type === "draw" && e.player === "w").length, 0);
		assert.deepEqual([st.players.w.moves.length, st.players.w.refillLock], [0, 0]);
	});

	test("M3 Underdog behind: the automatic redraw (no card action) draws up to 7", () => {
		const s = fresh();
		place(s, "underdog", "w");
		s.board.sq[sqIndex("a1")] = null;
		const st = applyAction(s, "w", quiet(s, "w")).state;
		Object.assign(st.players.w, { moves: cardsOf(st, ["q", "q", "q", "q", "q", "q"]), actives: [] }); // NO QUEEN MOVE, NO ACTIVE, NO KING MOVE AT THE START
		const { state, events } = applyAction(st, "b", quiet(st, "b"));
		assert.ok(events.some((e) => e.type === "redraw" && e.player === "w"));
		assert.equal(hand.moveCards(state.players.w).length, 7);
	});
});

describe("Task 11 closing review", () => {
	/**
	 * @description A game on this FEN at ply 20 with piece ids set and these move-card piece types per color.
	 */
	const setup = (seed, fen, w, b) => {
		const s = fresh(seed);
		s.board = fromFen(fen);
		const n = { w: 1, b: 1 };
		s.board.sq.forEach((q) => { if (q) q.id = q.c + n[q.c]++; });
		s.ply = 20;
		s.board.history = [];
		s.players.w.moves = w.map((piece) => hand.newCard(s, "move", { piece }));
		s.players.b.moves = b.map((piece) => hand.newCard(s, "move", { piece }));
		return s;
	};

	test("M1 Four of a Kind fired on a lost turn a king skull would void, then a Debt (Hollow Crown held) discards the King card and the turn is skipped: its debuff is dropped, the usual refill runs", () => {
		let hits = 0;
		for (let seed = 1; seed <= 60; seed++) {
			const s = setup(seed, "r3k3/8/8/8/8/8/3N2PP/7K b - - 0 20", ["q", "q", "q", "q", "n"], ["r", "r", "r", "r", "r", "r"]);
			s.players.w.actives = [];
			s.players.w.curses.push(hand.newCard(s, "hollow-crown"), hand.newCard(s, "debt", { left: 0 }));
			s.players.w.lostTurns = 1;
			place(s, "four-of-a-kind", "w", 2);
			const { state, events } = applyAction(s, "b", legalActions(s, "b").find((a) => a.type === "move" && a.to === "a1"));
			if (!fired(events, "four-of-a-kind") || !ofType(events, "turn-skipped").length) continue;
			hits++;
			assert.equal(hand.moveCards(state.players.w).length, hand.MOVES, "seed " + seed + ": the skipped turn's refill drew only 4");
			assert.equal(ofType(events, "discard").filter((e) => e.player === "w" && e.card.key === "move").length, 1, "seed " + seed + ": move cards thrown out on a skipped turn"); // DEBT'S ONE AT MOST
		}
		assert.ok(hits > 0, "no seed reached the case");
	});

	test("Phalanx: a lost turn voided by a king skull is played, so the blocked capture stays recorded and it fires at the owner's next turn start", () => {
		const s = setup(3, "8/8/8/2p1k3/2P1P3/3P4/8/4K3 w - - 0 20", ["p", "p", "p", "p", "p", "p"], ["p", "p", "p", "p", "p", "p"]);
		place(s, "phalanx", "w", 2);
		Object.assign(s.players.b, { lostTurns: 1, kingSkulls: 1 });
		const one = applyAction(s, "w", legalActions(s, "w").find((a) => a.type === "move" && a.from === "d3" && a.to === "d4")); // CHECK; c4 d4 e4 SIDE BY SIDE, c5xd4 DENIED
		assert.ok(!ofType(one.events, "turn-skipped").length && one.state.board.turn === "b" && one.state.players.b.lostTurns === 0);
		assert.equal(one.state.effects.find((e) => e.card.key === "phalanx").card.denied, true);
		const two = applyAction(one.state, "b", legalActions(one.state, "b").find((a) => a.type === "move" && a.from === "e5"));
		assert.ok(fired(two.events, "phalanx") && !waits(two.state, "phalanx"));
	});
});

describe("a choice asked at the start of a turn (no card does yet: a test card)", () => {
	const ASK = "t-ask", options = [{ type: "choice", option: "x" }, { type: "choice", option: "y" }];
	const withAsk = (run) => { // NOT REGISTERED: NO RANDOM DRAW MAY GIVE IT
		CARDS[ASK] = { key: ASK, kind: "curse", on: { "turn-start": (ctx, owner, ev, src) => { if (ev.player !== owner || src.card.done) return false; src.card.done = true; ctx.ask(owner, "t", ["x", "y"], { card: ASK }); return true; } }, choice: { resolve() {} } };
		try { run(); } finally { delete CARDS[ASK]; }
	};

	for (const first of [false, true]) test("with a Four of a Kind firing at the same turn start (the choice asked " + (first ? "before" : "after") + " it): the choice is answered, then the two moves are played, then its throw-out and draw of 4", () => withAsk(() => {
		const { state, events } = atStart(["p", "p", "p", "p", "n"], (b) => {
			const card = hand.newCard(b, ASK);
			if (first) b.effects.push({ id: card.id, owner: "w", card, placedAt: -1 }); // PLACED BEFORE FOUR OF A KIND: HEARD FIRST
			else b.players.w.curses.push(card); // A CURSE IS HEARD AFTER THE PLACED PASSIVES
		});
		assert.ok(fired(events, "four-of-a-kind") && state.multi && state.multi.left === 2);
		assert.deepEqual(legalActions(state, "w"), options);
		assert.deepEqual(legalActions(state, "b"), []);
		const a = applyAction(state, "w", options[0]).state;
		assert.ok(!a.pending && a.board.turn === "w" && a.multi.left === 2);
		assert.ok(legalActions(a, "w").length && legalActions(a, "w").every((x) => x.type === "move"));
		const m1 = applyAction(a, "w", quiet(a, "w")).state;
		assert.equal(m1.board.turn, "w");
		const m2 = applyAction(m1, "w", quiet(m1, "w"));
		assert.equal(m2.state.board.turn, "b");
		assert.equal(sizes(m2.state.players.w)[0], 4);
		assert.ok(ofType(m2.events, "discard").length >= 3);
	}));

	test("asked at the start of a turn that is then lost: the turn is skipped, the asker answers during the opponent's turn, and play goes on", () => withAsk(() => {
		const s = fresh();
		s.players.b.curses.push(hand.newCard(s, ASK));
		s.players.b.lostTurns = 1;
		const { state, events } = applyAction(s, "w", quiet(s, "w"));
		assert.ok(ofType(events, "turn-skipped").some((e) => e.player === "b"));
		assert.ok(state.board.turn === "w" && state.pending.player === "b" && !state.result);
		assert.deepEqual(legalActions(state, "w"), []);
		assert.deepEqual(legalActions(state, "b"), options);
		const a = applyAction(state, "b", options[1]);
		assert.ok(!a.state.pending && a.state.board.turn === "w" && !a.state.result);
		assert.deepEqual(ofType(a.events, "turn-start"), []);
		assert.equal(applyAction(a.state, "w", quiet(a.state, "w")).state.board.turn, "b");
	}));
});

