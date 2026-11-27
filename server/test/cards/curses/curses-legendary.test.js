/*
 *  curses-legendary.test.js  --  chess cards engine tests
 *	Hunger, Leech, Hollow Crown, Hexcraft's legendary version and Bad Omen's epic version.
 *
 */

const { describe, test, before } = require("node:test");
const assert = require("node:assert/strict");
const { legalActions, applyAction, playerView, playerEvents } = require("../../../../cards-engine/index.js");
const { fromFen } = require("../../../../cards-engine/board.js");
const { makeCtx } = require("../../../../cards-engine/ctx.js");
const hand = require("../../../../cards-engine/hand.js");
const { CARDS } = require("../../../../cards-engine/cards/index.js");
const { fresh, game, ofType, at, curse, moveCard, firstMove, clears, untilTurn, seg3, place } = require("../../helpers/curses.js");

describe("Hunger", () => {
	before(seg3);

	test("is rare; turns 1 and 2 of its holder's are played, the 3rd is lost (turn-skipped, the hand refilled as on any lost turn), it stays, turns 4 and 5 are played, the 6th is lost; no pawn is removed, no capture comes from it (user ruling 2026-11-25)", () => {
		assert.equal(CARDS.hunger.rarity, "rare");
		const s = fresh(2), h = makeCtx(s).giveCurse("b", "hunger", "w"); // SEED 2: SEED 1'S HANDS REACH A TURN WITH NO MOVE CARD TO PLAY (THE DRAW'S WEIGHTS OF 2026-11-22)
		assert.equal(h.left, 2);
		const lost = (r) => ofType(r.events, "turn-skipped").filter((e) => e.player === "b").length;
		const step = (r) => { const n = untilTurn(r.state, "b", 1); assert.ok(!ofType(n.events, "capture").some((e) => e.player === "b" && e.c === "b")); return n; }; // NO REMOVAL BY ITS OWN SIDE (WHITE'S FIRST MOVES MAY TAKE A PAWN)
		let r = step({ state: s, events: [] });
		assert.equal(lost(r), 0);
		r = step(r);
		assert.deepEqual([lost(r), ofType(r.events, "curse-fired").length, r.state.board.turn], [0, 0, "b"]); // TURN 2 PLAYED
		r.state.players.b.moves = r.state.players.b.moves.slice(0, 2); // A SHORT HAND: THE LOST TURN'S endTurn REFILLS IT
		r = step(r);
		assert.deepEqual([lost(r), r.state.board.turn, r.state.players.b.lostTurns], [1, "w", 0]); // TURN 3 LOST
		assert.deepEqual(ofType(r.events, "curse-fired").map((e) => e.card.key), ["hunger"]);
		assert.equal(r.state.players.b.moves.length, hand.HAND_MOVES + hand.big(r.state, "b"));
		assert.deepEqual(r.state.players.b.curses.map((c) => [c.id, c.left]), [[h.id, 2]]); // IT STAYS, DUE AGAIN ON THE 3RD TURN FROM HERE
		for (const n of [4, 5]) {
			r = step(r);
			assert.deepEqual([lost(r), r.state.board.turn], [0, "b"], "turn " + n + " played");
		}
		r = step(r);
		assert.deepEqual([lost(r), r.state.board.turn], [1, "w"]); // TURN 6 LOST
		assert.deepEqual(r.state.players.b.curses.map((c) => [c.id, c.left]), [[h.id, 2]]);
	});

	test("in check with a King skull the lost turn is void: the skull is spent and the turn played; it is due again on the 3rd turn after", () => {
		const s = game("4k3/8/8/8/8/8/8/R3K3 w - - 0 1");
		s.players.w.moves = [moveCard(s, "r")];
		s.players.b.moves = [];
		const h = curse(s, "b", "hunger", { left: 0 });
		const r = applyAction(s, "w", { type: "move", card: s.players.w.moves[0].id, from: "a1", to: "a8" });
		assert.deepEqual(ofType(r.events, "turn-skipped"), []);
		assert.deepEqual(ofType(r.events, "king-skull"), [{ type: "king-skull", player: "b", left: s.players.b.kingSkulls - 1, why: "lost-turn" }]);
		assert.deepEqual(ofType(r.events, "curse-fired").map((e) => e.card.key), ["hunger"]);
		assert.deepEqual([r.state.board.turn, r.state.players.b.lostTurns, r.state.players.b.curses.map((c) => [c.id, c.left])], ["b", 0, [[h.id, 2]]]);
	});

	test("in check with no King skull left, or with the King card gone, it takes no turn (the king would be taken): nothing fires, the turn is played, it is due again on the 3rd turn after", () => {
		for (const gone of [{ kingSkulls: 0 }, { king: false }]) {
			const s = game("4k3/1r6/8/8/8/8/8/R3K3 w - - 0 1");
			s.players.w.moves = [moveCard(s, "r")];
			s.players.b.moves = [moveCard(s, "r")]; // Rb8 ANSWERS THE CHECK (NO KING CARD, NO KING MOVE)
			Object.assign(s.players.b, gone);
			const h = curse(s, "b", "hunger", { left: 0 });
			const r = applyAction(s, "w", { type: "move", card: s.players.w.moves[0].id, from: "a1", to: "a8" });
			assert.deepEqual([ofType(r.events, "turn-skipped"), ofType(r.events, "king-skull"), ofType(r.events, "curse-fired")], [[], [], []], JSON.stringify(gone));
			assert.deepEqual([r.state.result, r.state.board.turn, r.state.players.b.lostTurns, r.state.players.b.curses.map((c) => [c.id, c.left])], [null, "b", 0, [[h.id, 2]]]);
		}
	});

	test("with Double Time's own lost turn also owed, both are lost (lostTurns adds)", () => {
		const s = game("4k3/p7/P7/8/8/8/8/4K3 w - - 0 1"); // BLOCKED PAWNS: ONLY THE KINGS MOVE, NO CHECK, NO CAPTURE
		Object.assign(s.players.w, { moves: [], actives: [], passive: null });
		Object.assign(s.players.b, { moves: [], actives: [], passive: null });
		curse(s, "b", "hunger", { left: 0 });
		makeCtx(s).skipTurn("b", 1); // DOUBLE TIME'S DEBUFF (double-time.js play)
		let r = applyAction(s, "w", firstMove(s, "w"));
		assert.deepEqual([ofType(r.events, "turn-skipped").length, r.state.board.turn, r.state.players.b.lostTurns], [1, "w", 1]);
		r = applyAction(r.state, "w", firstMove(r.state, "w"));
		assert.deepEqual([ofType(r.events, "turn-skipped").length, r.state.board.turn, r.state.players.b.lostTurns], [1, "w", 0]); // THE SECOND ONE
		r = applyAction(r.state, "w", firstMove(r.state, "w"));
		assert.deepEqual([ofType(r.events, "turn-skipped").length, r.state.board.turn], [0, "b"]); // HUNGER'S COUNT RAN ON BOTH LOST TURNS: 2 → 1 → 0, THIS ONE IS PLAYED
	});

	test("cleared when its holder captures, before and after a lost turn; not by the opponent capturing, not by a removal; with no pawn left the turn is still lost and nothing is removed", () => {
		const s = game("4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1");
		s.players.w.moves = [moveCard(s, "p")];
		const h = curse(s, "w", "hunger", { left: 2 });
		const r = applyAction(s, "w", { type: "move", card: s.players.w.moves[0].id, from: "e4", to: "d5" });
		assert.deepEqual(r.state.players.w.curses, []);
		assert.deepEqual(ofType(r.events, "curse-cleared"), [{ type: "curse-cleared", player: "w", card: h }]);
		const t = game("4k3/8/8/3p4/4P3/8/8/4K3 b - - 0 1");
		t.players.b.moves = [moveCard(t, "p")];
		curse(t, "w", "hunger", { left: 2 });
		assert.equal(applyAction(t, "b", { type: "move", card: t.players.b.moves[0].id, from: "d5", to: "e4" }).state.players.w.curses.length, 1);
		const u = game("4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1"), ctx = makeCtx(u);
		curse(u, "w", "hunger", { left: 2 });
		ctx.capture("w", at(u, "e4").id);
		assert.equal(u.players.w.curses.length, 1);
		assert.deepEqual(clears(game("4k3/8/8/8/8/8/8/4K3 w - - 0 1"), "w"), []); // NO CLEAR ACTION: ONLY A CAPTURE PAYS IT
		// AFTER A LOST TURN: STILL PAID BY THE NEXT CAPTURE
		const a = game("4k3/8/8/3p4/4P3/8/8/4K3 b - - 0 1");
		Object.assign(a.players.b, { moves: [], actives: [], passive: null }); // KING MOVES ONLY: d5 STAYS TO BE TAKEN
		const ha = curse(a, "w", "hunger", { left: 0 });
		let l = applyAction(a, "b", firstMove(a, "b"));
		assert.deepEqual([ofType(l.events, "turn-skipped").map((e) => e.player), l.state.board.turn], [["w"], "b"]);
		l.state.players.b.moves = [];
		l = applyAction(l.state, "b", firstMove(l.state, "b"));
		assert.deepEqual([ofType(l.events, "turn-skipped"), l.state.board.turn], [[], "w"]);
		l.state.players.w.moves = [moveCard(l.state, "p")];
		const paid = applyAction(l.state, "w", { type: "move", card: l.state.players.w.moves[0].id, from: "e4", to: "d5" });
		assert.deepEqual([paid.state.players.w.curses, ofType(paid.events, "curse-cleared").map((e) => e.card.id)], [[], [ha.id]]);
		// NO PAWN: THE TURN IS LOST ALL THE SAME, NOTHING REMOVED
		const v = game("4k3/8/8/8/8/8/8/R3K3 b - - 0 1");
		v.players.b.moves = [];
		curse(v, "w", "hunger", { left: 0 });
		const q = applyAction(v, "b", firstMove(v, "b"));
		assert.equal(at(q.state, "a1").t, "r");
		assert.ok(!ofType(q.events, "capture").length);
		assert.deepEqual(ofType(q.events, "turn-skipped").map((e) => e.player), ["w"]);
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
		assert.equal(r.state.players.w.moves.length, 6);
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

	test("Pickpocket by a thief who holds nothing else, the stolen King card lost: no take-back is asked and the game goes on", () => {
		const { s } = crowned("4k3/8/8/8/8/8/8/4K3 b - - 0 1"), pp = hand.newCard(s, "pickpocket");
		Object.assign(s.players.w, { moves: [], actives: [] });
		Object.assign(s.players.b, { moves: [], actives: [pp], passive: null, curses: [] });
		const r = applyAction(s, "b", { type: "active", card: pp.id });
		assert.equal(r.state.pending, null);
		assert.equal(ofType(r.events, "choice").length, 0);
		assert.ok(r.state.result || legalActions(r.state, r.state.board.turn).length); // NOT STUCK
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
		assert.ok(acts.some((a) => a.type === "drop")); // ITS OWN PLACED ESCAPE ARTIST CAN BE DROPPED, IN CHECK TOO
		assert.ok(acts.filter((a) => a.type !== "drop").every((a) => a.card === null && a.from === "e1"));
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
		const { fromView } = require("../../../../cards-engine/index.js");
		const rebuilt = fromView(vw, 5);
		assert.equal(rebuilt.players.b.curses.length, s.players.b.curses.length);
		assert.ok(legalActions(rebuilt, "w").length);
	});
});
