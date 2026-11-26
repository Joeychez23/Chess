/*
 *  passiveOther-reactions.test.js  --  chess cards engine tests
 *	The passives that answer the opponent's plays: Interdicted Foresight, Witness, Veto and Echo, alone and together.
 *
 */

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const { legalActions, applyAction, playerView, playerEvents } = require("../../../../cards-engine/index.js");
const { fromView } = require("../../../../cards-engine/view.js");
const hand = require("../../../../cards-engine/hand.js");
const { CARDS, baseKey } = require("../../../../cards-engine/cards/index.js");
const { makeCtx } = require("../../../../cards-engine/ctx.js");
const { fromFen } = require("../../../../cards-engine/board.js");
const { IF, fresh, ofType, ids, byId, hidden, fired, waits, shown, movesOf, varied, play, place, give } = require("../../helpers/passiveOther.js");

describe("Interdicted Foresight", () => {
	test("a move-card fake is a card type a hand could hold: a knight or a bishop on the board gives the Knight / Bishop card, never a Knight or a Bishop card", () => {
		const types = new Set();
		for (let seed = 1; seed <= 12; seed++) {
			const s = fresh(seed);
			s.board = fromFen("1nb1k3/8/8/8/8/8/PPPP4/4K3 w - - 0 1"); // BLACK: A KNIGHT AND A BISHOP ONLY
			place(s, IF, "b");
			for (const f of play(s, "w", give(s, "foresight")).state.players.w.seen.fake) if (f.key === "move") types.add(f.piece);
		}
		assert.deepEqual([...types], ["m"]);
	});

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
			st.players.b.kept = { id: "t0", key: "move", piece: "p" }; // A MOVE CARD REMEMBERED: THE NEXT ONE DISCARDED DRAWS 1 BACK (ONE CARD AT A TIME)
			const one = (keep) => legalActions(st, "b").find((a) => a.type === "discard" && st.players.b.moves.some((c) => c.id === a.cards[0]) && keep(a.cards[0])); // THE FREE DISCARD: A MOVE CARD
			const a = one((id) => id === under.id), r = applyAction(st, "b", a), told = playerEvents(r.state, r.events, "w");
			assert.deepEqual(told.filter((e) => e.type === "discard")[0].card, under, key);
			if (key !== "foresight") continue;
			assert.ok(told.filter((e) => e.type === "draw" && e.player === "b").every((e) => !e.card), "a new draw under a half");
			const o = applyAction(st, "b", one((id) => !fakes.some((f) => f.id === id))); // NOT UNDER A FAKE
			assert.deepEqual(playerEvents(o.state, o.events, "w").filter((e) => e.type === "discard"), [{ type: "discard", player: "b" }]);
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
