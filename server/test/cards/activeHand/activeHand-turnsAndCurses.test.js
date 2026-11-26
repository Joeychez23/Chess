/*
 *  activeHand-turnsAndCurses.test.js  --  chess cards engine tests
 *	Actives that act on waiting passives, turns and curses (cards-engine/cards/active/): Insidious Nullification, Double Time, Hexcraft and Cleanse
 *
 */

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const { legalActions, applyAction, playerView, hand, CURSE_KEYS, CARDS, baseKey, statuses, ofType, ids, holding, play, step, movesOf, notInCheck, at, moveCard, activeIds, moveFrom } = require("../../helpers/activeHand.js");

describe("Insidious Nullification", () => {
	test("cancels every waiting passive of the opponent's (a passive-cancelled event each, placedAt order), the player's own stays; no forfeit, no pending choice, the turn passes", () => {
		const { s, id } = holding("insidious-nullification");
		const pass = (owner, placedAt) => ({ id: "x" + placedAt, owner, card: hand.newCard(s, "t-pass"), placedAt });
		s.effects = [pass("b", 3), pass("w", 1), pass("b", 2)];
		s.players.w.moves = [moveCard(s, "m"), moveCard(s, "m")];
		s.players.w.refillLock = 1; // NO END-OF-TURN REFILL DRAWS
		s.board.half = 7;
		const r = play(s, "w", id), st = r.state;
		assert.deepEqual(ofType(r.events, "passive-cancelled"), [s.effects[2], s.effects[0]].map((e) => ({ type: "passive-cancelled", player: "b", card: e.card })));
		assert.deepEqual(st.effects, [s.effects[1]]); // THE PLAYER'S OWN STAYS
		assert.ok(!ofType(r.events, "passive-fired").length);
		assert.ok(!ofType(r.events, "capture").length && !ofType(r.events, "choice").length);
		assert.equal(st.pending, null);
		assert.equal(st.board.sq.filter(Boolean).length, 32);
		assert.equal(st.board.half, 8, "nothing taken: the fifty-move counter runs on");
		assert.equal(st.board.turn, "b");
	});

	test("rare, 0 skulls, no version (the common version with its forfeit is gone); playable with no pieces to spare and no move card, but only while the opponent has a passive waiting (the player's own doesn't count)", () => {
		assert.deepEqual([CARDS["insidious-nullification"].rarity, CARDS["insidious-nullification"].skulls, CARDS["insidious-nullification"].versions], ["rare", 0, undefined]);
		assert.equal(CARDS["insidious-nullification-rare"], undefined);
		const { s, id } = holding("insidious-nullification", "w", 1, "4k3/8/8/8/8/8/8/4K3 w - - 0 1"); // THE KING ALONE
		s.players.w.moves = [];
		s.players.w.refillLock = 1;
		assert.equal(activeIds(s, "w", id).length, 0);
		s.effects = [{ id: "x0", owner: "w", card: hand.newCard(s, "t-pass"), placedAt: 1 }];
		assert.equal(activeIds(s, "w", id).length, 0);
		const card = hand.newCard(s, "t-pass");
		s.effects = [{ id: "x1", owner: "b", card, placedAt: 1 }];
		assert.equal(activeIds(s, "w", id).length, 1);
		const r = play(s, "w", id);
		assert.deepEqual(ofType(r.events, "passive-cancelled"), [{ type: "passive-cancelled", player: "b", card }]);
		assert.deepEqual([r.state.effects, r.state.pending, r.state.board.turn], [[], null, "b"]);
		assert.equal(r.state.board.sq.filter(Boolean).length, 2);
	});
});


describe("Double Time", () => {
	test("two moves with two different pieces, each spending its own card; then the player's next turn is skipped", () => {
		const { s, id } = holding("double-time");
		s.players.w.moves = [moveCard(s, "p"), moveCard(s, "m"), moveCard(s, "p")];
		const r = play(s, "w", id);
		assert.deepEqual(r.state.multi, { player: "w", left: 2, moved: [], differ: true });
		assert.equal(r.state.board.turn, "w");
		assert.ok(legalActions(r.state, "w").every((a) => a.type === "move"));
		const pawn = at(s, "e2").id, a1 = moveFrom(r.state, "w", "e2", "e4");
		const one = applyAction(r.state, "w", a1).state;
		assert.equal(one.board.turn, "w");
		assert.deepEqual(one.multi.moved, [pawn]);
		assert.ok(!moveFrom(one, "w", "e4"), "the first piece moves again");
		assert.ok(moveFrom(one, "w", "d2") && moveFrom(one, "w", "g1"));
		const two = applyAction(one, "w", moveFrom(one, "w", "g1", "f3"));
		const st = two.state;
		assert.equal(st.board.turn, "b");
		assert.equal(st.multi, null);
		assert.equal(st.players.w.lostTurns, 1);
		const spent = ofType(two.events, "move").map((e) => e.card.id), first = ofType(applyAction(r.state, "w", a1).events, "move")[0].card.id;
		assert.deepEqual([first, ...spent], [a1.card, ids(s.players.w.moves)[1]]); // A CARD EACH: THE PAWN'S, THEN THE KNIGHT'S
		assert.ok(![first, ...spent].some((c) => ids(st.players.w.moves).includes(c)));
		const next = applyAction(st, "b", legalActions(st, "b").find((a) => a.type === "move"));
		assert.deepEqual(ofType(next.events, "turn-skipped"), [{ type: "turn-skipped", player: "w" }]);
		assert.equal(next.state.board.turn, "b");
		assert.equal(next.state.players.w.lostTurns, 0);
	});

	test("the second move must also leave the king safe", () => {
		const { s, id } = holding("double-time", "w", 1, "4r1k1/8/8/8/8/4B3/4R3/4K3 w - - 0 1"); // TWO BLOCKERS: NEITHER PINNED
		s.players.w.moves = [moveCard(s, "m"), moveCard(s, "r")];
		const r = play(s, "w", id);
		assert.ok(legalActions(r.state, "w").some((a) => a.from === "e2" && a.to[0] !== "e"), "the rook can't leave the file before");
		const one = applyAction(r.state, "w", moveFrom(r.state, "w", "e3", "d4")).state; // NOW THE ROOK IS PINNED
		const rook = legalActions(one, "w").filter((a) => a.from === "e2");
		assert.ok(rook.length > 0);
		assert.ok(rook.every((a) => a.to[0] === "e"), "the second move exposes the king");
		assert.ok(!moveFrom(one, "w", "d4"));
	});

	test("the turn ends early when no second move is legal", () => {
		const { s, id } = holding("double-time", "w", 1, "7k/8/8/8/8/2n5/PP6/K7 w - - 0 1"); // THE KNIGHT GUARDS a2 AND b1
		s.players.w.moves = [moveCard(s, "p")];
		const r = play(s, "w", id);
		assert.equal(r.state.board.turn, "w");
		const one = applyAction(r.state, "w", moveFrom(r.state, "w", "a2", "a3"));
		assert.equal(one.state.board.turn, "b");
		assert.equal(one.state.multi, null);
		assert.equal(one.state.players.w.lostTurns, 1);
		assert.ok(!ofType(one.events, "king-skull").length);
	});

	test("a first move that gives check ends the two-move turn (the checked player spends a King skull)", () => {
		const { s, id } = holding("double-time", "w", 1, "4k3/8/8/8/8/8/8/R3K3 w - - 0 1");
		s.players.w.moves = [moveCard(s, "r")];
		const r = play(s, "w", id);
		const one = applyAction(r.state, "w", moveFrom(r.state, "w", "a1", "a8"));
		assert.deepEqual(ofType(one.events, "king-skull").map((e) => [e.player, e.why]), [["b", "double-move"]]);
		assert.equal(one.state.board.turn, "b");
		assert.equal(one.state.players.w.lostTurns, 1);
	});

	test("not playable without a legal move", () => {
		const { s, id } = holding("double-time", "w", 1, "7k/8/8/8/8/2n5/PP6/K7 w - - 0 1"); // THE KING IS BOXED IN
		s.players.w.moves = [];
		assert.equal(activeIds(s, "w", id).length, 0);
		s.players.w.moves = [moveCard(s, "p")];
		assert.equal(activeIds(s, "w", id).length, 1);
	});

	test("a choice pending at the start of the turn doesn't count as a move: the redraw still happens", () => {
		const { s } = holding("double-time", "w", 1, "7k/8/8/8/8/2n5/PP6/K7 b - - 0 1"); // WHITE'S KING IS BOXED IN
		s.players.w.moves = [];
		s.players.w.curses = [hand.newCard(s, "t-ask", { ask: true })];
		s.players.b.moves = [];
		const r = applyAction(s, "b", moveFrom(s, "b", "h8"));
		assert.equal(r.state.pending.player, "w");
		assert.equal(ofType(r.events, "redraw").length, 1, "Double Time read the pending choice as a legal move");
	});

	test("cardless moves count (Heretical Subjection): two different bishops, the first barred, the next turn lost", () => {
		const { s, id } = holding("double-time", "w", 1, "4k3/8/8/8/8/8/8/2B1KB2 w - - 0 1");
		Object.assign(s.players.w, { moves: [], king: false });
		s.enchant.push({ id: "e900", key: "heretical-subjection", owner: "w", pieces: [at(s, "c1").id, at(s, "f1").id], left: 3, data: {} });
		assert.equal(activeIds(s, "w", id).length, 1);
		const r = play(s, "w", id), a1 = moveFrom(r.state, "w", "c1");
		const one = applyAction(r.state, "w", a1).state;
		assert.ok(!moveFrom(one, "w", a1.to) && moveFrom(one, "w", "f1"));
		const two = applyAction(one, "w", moveFrom(one, "w", "f1")).state;
		assert.equal(two.players.w.lostTurns, 1);
		assert.equal(two.board.turn, "b");
	});

	test("legendary version: two moves with two different pieces and no skipped turn", () => {
		const { s, id } = holding("double-time-legendary");
		s.players.w.moves = [moveCard(s, "p"), moveCard(s, "m")];
		const r = play(s, "w", id);
		assert.deepEqual(r.state.multi, { player: "w", left: 2, moved: [], differ: true });
		const one = applyAction(r.state, "w", moveFrom(r.state, "w", "e2", "e4")).state;
		assert.equal(one.board.turn, "w");
		const two = applyAction(one, "w", moveFrom(one, "w", "g1", "f3")).state;
		assert.equal(two.board.turn, "b");
		assert.equal(two.players.w.lostTurns, 0);
		const next = applyAction(two, "b", movesOf(two, "b")[0]);
		assert.ok(!ofType(next.events, "turn-skipped").length);
		assert.equal(next.state.board.turn, "w");
		assert.deepEqual([CARDS["double-time-legendary"].name, CARDS["double-time-legendary"].rarity, CARDS["double-time-legendary"].skulls], ["Double Time", "legendary", 0]);
	});

	test("not playable in check", () => notInCheck("double-time", false));
});

describe("Hexcraft", () => {
	test("draws 2 random curses (state.rng); the player chooses which the opponent gets; the player's most advanced piece is Marked", () => {
		const drawn = new Set();
		for (let seed = 1; seed <= 10; seed++) {
			const { s, id } = holding("hexcraft", "w", seed, "4k3/8/8/3P4/8/8/PPPP4/4K3 w - - 0 1");
			const r = play(s, "w", id), st = r.state, p = st.pending;
			assert.equal(p.player, "w");
			assert.equal(p.kind, "hexcraft");
			assert.equal(p.options.length, 2);
			assert.equal(new Set(p.options).size, 2);
			assert.ok(p.options.every((k) => CURSE_KEYS.includes(k)));
			drawn.add(p.options.join());
			assert.deepEqual(playerView(st, "b").pending, { player: "w", kind: "hexcraft" });
			assert.ok(statuses.has(st, at(s, "d5").id, "marked"));
			assert.deepEqual(Object.keys(st.statuses), [at(s, "d5").id]);
			const saved = JSON.parse(JSON.stringify(st));
			assert.throws(() => applyAction(saved, "b", { type: "choice", option: p.options[1] }), /isn't available/);
			const back = applyAction(saved, "w", { type: "choice", option: p.options[1] }), end = back.state;
			assert.deepEqual(end.players.b.curses.map((c) => c.key), [p.options[1]]);
			assert.deepEqual(ofType(back.events, "curse-given"), [{ type: "curse-given", player: "w", card: end.players.b.curses[0] }]);
			assert.equal(end.players.w.curseWait, 5);
			assert.equal(end.board.turn, "b");
		}
		assert.ok(drawn.size > 1, "the curses drawn are not random");
		const { s, id } = holding("hexcraft", "b", 1, "4k3/pppp4/8/8/3p4/8/8/4K3 b - - 0 1");
		assert.ok(statuses.has(play(s, "b", id).state, at(s, "d4").id, "marked"), "Black's most advanced piece is the one nearest rank 1");
	});

	test("blocked by the curse limit: nothing is given and nothing asked; the piece is still Marked", () => {
		for (const block of ["held", "wait"]) {
			const { s, id } = holding("hexcraft", "w", 1, "4k3/8/8/3P4/8/8/PPPP4/4K3 w - - 0 1");
			if (block === "held") s.players.b.curses = [hand.newCard(s, "t-hex-a"), hand.newCard(s, "t-hex-b")];
			else s.players.w.curseWait = 3;
			const r = play(s, "w", id);
			assert.equal(r.state.pending, null, block);
			assert.ok(!ofType(r.events, "curse-given").length && !ofType(r.events, "choice").length, block);
			assert.equal(r.state.players.b.curses.length, block === "held" ? 2 : 0);
			assert.equal(r.state.board.turn, "b");
			assert.ok(statuses.has(r.state, at(s, "d5").id, "marked"));
		}
	});

	test("not playable in check", () => notInCheck("hexcraft", true));
});

describe("Cleanse", () => {
	test("targets all of the player's curses (one target) and each status on the player's side (never the opponent's) and removes the chosen, using the whole turn", () => {
		const { s, id } = holding("cleanse");
		const [c1, c2] = s.players.w.curses = [hand.newCard(s, "t-hex-a"), hand.newCard(s, "t-hex-b")];
		const wp = at(s, "e2").id, bp = at(s, "e7").id;
		s.statuses[wp] = [{ s: "frozen", left: 2, by: "b" }];
		s.statuses[bp] = [{ s: "shaken", left: 2, by: "w" }];
		s.players.b.curses = [hand.newCard(s, "t-hex-c")];
		const targets = activeIds(s, "w", id).map((a) => a.target);
		assert.deepEqual(targets, [{ curses: "all" }, { piece: wp, s: "frozen" }]);
		const r = applyAction(s, "w", { type: "active", card: id, target: { curses: "all" } });
		assert.deepEqual(ofType(r.events, "curse-cleared"), [c1, c2].map((card) => ({ type: "curse-cleared", player: "w", card })));
		assert.deepEqual(r.state.players.w.curses, []);
		assert.equal(r.state.players.b.curses.length, 1);
		assert.equal(r.state.board.turn, "b");
		assert.ok(!ofType(r.events, "move").length);
		const f = applyAction(s, "w", { type: "active", card: id, target: { piece: wp, s: "frozen" } });
		assert.deepEqual(ofType(f.events, "status-ended"), [{ type: "status-ended", player: "w", piece: wp, s: "frozen" }]);
		assert.ok(!statuses.has(f.state, wp, "frozen"));
		assert.ok(statuses.has(f.state, bp, "shaken"));
		assert.equal(f.state.players.w.curses.length, 2);
	});

	test("never names a Mirage (its holder sees it as a move card); not playable with nothing to cleanse", () => {
		const { s, id } = holding("cleanse");
		assert.equal(activeIds(s, "w", id).length, 0);
		const mirage = hand.newCard(s, "mirage", { piece: "m" });
		s.players.w.curses = [mirage];
		assert.equal(activeIds(s, "w", id).length, 0, "Cleanse shows a Mirage");
		const c = hand.newCard(s, "t-hex-a");
		s.players.w.curses = [mirage, c];
		assert.deepEqual(activeIds(s, "w", id).map((a) => a.target), [{ curses: "all" }]);
	});

	test("removes Stronghold: its piece's Warded ends and the Stronghold with it", () => {
		const { s, id } = holding("stronghold");
		const cleanse = hand.newCard(s, "cleanse");
		s.players.w.actives.push(cleanse);
		const n = at(s, "g1").id;
		const t = step(applyAction(s, "w", { type: "active", card: id, target: { piece: n } }).state, "b");
		assert.ok(t.enchant.some((e) => e.key === "stronghold") && statuses.has(t, n, "warded"));
		assert.ok(activeIds(t, "w", cleanse.id).some((a) => a.target.piece === n && a.target.s === "warded"));
		const r = applyAction(t, "w", { type: "active", card: cleanse.id, target: { piece: n, s: "warded" } });
		assert.ok(!statuses.has(r.state, n, "warded"));
		assert.ok(!r.state.enchant.some((e) => e.key === "stronghold"));
		assert.deepEqual(ofType(r.events, "enchant-ended").map((e) => e.key), ["stronghold"]);
	});

	test("rare version: clears every status on the player's side, never a curse or the opponent's; Stronghold ends with its Warded; needs a status", () => {
		const { s, id } = holding("cleanse-rare");
		const curse = hand.newCard(s, "t-hex-a");
		s.players.w.curses = [curse];
		assert.equal(activeIds(s, "w", id).length, 0, "playable with only a curse");
		const wp = at(s, "e2").id, wn = at(s, "b1").id, bp = at(s, "e7").id;
		s.statuses[wp] = [{ s: "frozen", left: 2, by: "b" }, { s: "shaken", left: 1, by: "b" }];
		s.statuses[wn] = [{ s: "marked", left: 2, by: "b" }];
		s.statuses[bp] = [{ s: "shaken", left: 2, by: "w" }];
		assert.equal(activeIds(s, "w", id).length, 1);
		const r = play(s, "w", id);
		assert.deepEqual(ofType(r.events, "status-ended").map((e) => [e.piece, e.s]), [[wp, "frozen"], [wp, "shaken"], [wn, "marked"]]);
		assert.deepEqual(Object.keys(r.state.statuses), [bp]);
		assert.deepEqual(r.state.players.w.curses, [curse]);
		assert.equal(r.state.board.turn, "b");
		const g = holding("stronghold");
		const cl = hand.newCard(g.s, "cleanse-rare");
		g.s.players.w.actives.push(cl);
		const n = at(g.s, "g1").id;
		const t = step(applyAction(g.s, "w", { type: "active", card: g.id, target: { piece: n } }).state, "b");
		assert.ok(t.enchant.some((e) => baseKey(e.key) === "stronghold"));
		const e = play(t, "w", cl.id);
		assert.ok(!statuses.has(e.state, n, "warded"));
		assert.ok(!e.state.enchant.some((x) => baseKey(x.key) === "stronghold"));
		assert.deepEqual(ofType(e.events, "enchant-ended").map((x) => baseKey(x.key)), ["stronghold"]);
		assert.deepEqual([CARDS["cleanse-rare"].name, CARDS["cleanse-rare"].rarity], ["Cleanse", "rare"]);
	});
});
