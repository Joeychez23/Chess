/*
 *  activeHand-handCards.test.js  --  chess cards engine tests
 *	Actives that act on hands (cards-engine/cards/active/): Mulligan and Pickpocket
 *
 */

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const { legalActions, applyAction, playerView, playerEvents, hand, CARDS, ofType, ids, byId, other, tokens, holding, play, step, notInCheck, sqIndex, moveCard } = require("../../helpers/activeHand.js");

describe("Mulligan", () => {
	test("discards every move card and draws the same number of new ones; the turn goes on", () => {
		const { s, id } = holding("mulligan");
		s.players.w.moves.splice(4); // 4 MOVE CARDS
		const old = ids(s.players.w.moves);
		const r = play(s, "w", id), ev = r.events;
		const discards = ofType(ev, "discard").filter((e) => e.player === "w");
		assert.deepEqual(ids(discards.map((e) => e.card)), old);
		const drawn = ofType(ev, "draw").filter((e) => e.player === "w").map((e) => e.card);
		assert.equal(drawn.length, 4);
		assert.ok(drawn.every((c) => c.key === "move" && !old.includes(c.id)));
		assert.deepEqual(ids(r.state.players.w.moves), ids(drawn));
		assert.ok(ev.indexOf(ofType(ev, "draw")[0]) > ev.indexOf(discards[3]), "draws before the discards ended");
		assert.equal(r.state.board.turn, "w");
		assert.deepEqual(ofType(ev, "turn-start"), []);
	});

	test("then only a move, or the free discard if unused; the move ends the turn", () => {
		const { s, id } = holding("mulligan");
		s.players.w.passive = { id: "x1", key: "t-none" }; // A HELD PASSIVE: PLACEABLE BEFORE, NOT AFTER
		const kinds = (st) => [...new Set(legalActions(st, "w").map((a) => a.type))].sort();
		assert.deepEqual(kinds(s), ["active", "discard", "move", "passive"]);
		let r = play(s, "w", id).state;
		assert.deepEqual(kinds(r), ["discard", "move"]);
		assert.ok(legalActions(r, "w").filter((a) => a.type === "discard").every((a) => r.players.w.moves.some((c) => c.id === a.cards[0]))); // THE ACTIVE SLOT IS EMPTY: MOVE CARDS ONLY
		for (const left of [["discard", "move"], ["move"]]) { // 2 MOVE CARDS A TURN, ONE AT A TIME
			r = applyAction(r, "w", legalActions(r, "w").find((a) => a.type === "discard")).state;
			assert.equal(r.board.turn, "w");
			assert.deepEqual(kinds(r), left);
		}
		r = step(r, "w");
		assert.equal(r.board.turn, "b");
		assert.deepEqual([r.multi, r.discarded], [null, null]);
	});

	test("the free discard first, then Mulligan, then a move", () => {
		const { s, id } = holding("mulligan");
		const moveCard = (st) => legalActions(st, "w").find((a) => a.type === "discard" && st.players.w.moves.some((c) => c.id === a.cards[0]));
		let r = applyAction(s, "w", moveCard(s)).state;
		r = applyAction(r, "w", moveCard(r)).state; // THE TURN'S 2 MOVE CARDS
		assert.ok(legalActions(r, "w").some((a) => a.type === "active" && a.card === id));
		r = play(r, "w", id).state;
		assert.equal(r.board.turn, "w");
		assert.ok(!legalActions(r, "w").some((a) => a.type === "discard"));
		r = step(r, "w");
		assert.equal(r.board.turn, "b");
	});

	test("no move after it: the automatic redraw at once, then stalemate", () => {
		const { s, id } = holding("mulligan", "w", 1, "k7/8/8/8/8/8/PP6/KB6 w - - 0 1"); // KING BOXED IN BY ITS OWN HEXED PIECES
		for (const sq of ["a2", "b2", "b1"]) s.statuses[s.board.sq[sqIndex(sq)].id] = [{ s: "hexed", left: 2, by: "b" }];
		const r = play(s, "w", id);
		assert.equal(ofType(r.events, "redraw").length, 1);
		assert.deepEqual(r.state.result, { winner: null, reason: "stalemate" });
	});

	test("not playable without move cards", () => {
		const { s, id } = holding("mulligan");
		s.players.w.moves = [];
		assert.ok(!legalActions(s, "w").some((a) => a.type === "active" && a.card === id));
	});

	test("not playable in check", () => notInCheck("mulligan", true));
});

describe("Pickpocket", () => {
	test("takes a random move or active card from the opponent, then asks the opponent which of the player's cards to take back", () => {
		const taken = new Set();
		for (let seed = 1; seed <= 12; seed++) {
			const { s, id } = holding("pickpocket", "w", seed);
			s.players.b.passive = hand.newCard(s, "t-none");
			s.players.b.curses = [hand.newCard(s, "t-curse")];
			const before = ids([...s.players.b.moves, ...s.players.b.actives]);
			const r = play(s, "w", id), st = r.state, ev = ofType(r.events, "card-taken");
			assert.equal(ev.length, 1);
			const c = ev[0].card;
			assert.deepEqual({ ...ev[0], card: null }, { type: "card-taken", player: "w", from: "b", card: null });
			assert.ok(before.includes(c.id));
			assert.ok(![...st.players.b.moves, ...st.players.b.actives].some((x) => x.id === c.id));
			assert.ok([...st.players.w.moves, ...st.players.w.actives].some((x) => x.id === c.id));
			assert.ok(st.players.b.passive && st.players.b.curses.length === 1 && st.players.b.king, "took the passive, a curse or the King card");
			taken.add(c.id);
			const p = st.pending;
			assert.equal(p.player, "b");
			assert.equal(p.kind, "pickpocket");
			assert.deepEqual(p.options, [c.id, ...tokens(playerView(st, "b").players.w.hand.count - 1)]); // THE STOLEN CARD, THE REST BLIND
			assert.deepEqual(legalActions(st, "w"), []);
			assert.deepEqual(legalActions(st, "b").map((a) => a.option), p.options);
			assert.deepEqual(playerView(st, "w").pending, { player: "b", kind: "pickpocket" });
			assert.equal(st.board.turn, "w"); // THE TURN WAITS FOR THE CHOICE
		}
		assert.ok(taken.size > 1, "the steal is not random");
	});

	test("never takes the King card, a passive or a curse: not playable when the opponent has only those; an active alone is taken", () => {
		const { s, id } = holding("pickpocket");
		Object.assign(s.players.b, { moves: [], actives: [], passive: hand.newCard(s, "t-none"), curses: [hand.newCard(s, "t-curse")] });
		assert.ok(!legalActions(s, "w").some((a) => a.type === "active" && a.card === id));
		const spare = hand.newCard(s, "mulligan");
		s.players.b.actives = [spare]; // AN ACTIVE ALONE IS ENOUGH, AND IS WHAT IT TAKES
		const r = play(s, "w", id);
		assert.deepEqual(ofType(r.events, "card-taken")[0].card, spare);
		assert.ok(r.state.players.w.actives.some((c) => c.id === spare.id));
		assert.deepEqual(r.state.players.b.actives, []);
	});

	test("the victim's options name only the player's cards it already knows; the rest are blind tokens, so ids and the count tell no kind and no passive", () => {
		const { s, id } = holding("pickpocket", "w", 7);
		s.players.w.actives.push(hand.newCard(s, "mulligan")); // AN ACTIVE WHOSE ID ORDER WOULD TELL ITS KIND
		const seenId = s.players.w.moves[2].id;
		s.players.b.seen = { ids: [seenId], fake: [] }; // A CARD THE VICTIM'S FORESIGHT SHOWS
		const withPassive = JSON.parse(JSON.stringify(s)), withMove = JSON.parse(JSON.stringify(s));
		withPassive.players.w.passive = hand.newCard(withPassive, "t-none");
		withMove.players.w.moves.push(hand.newCard(withMove, "move", { piece: "p" })); // SAME HAND COUNT, NO PASSIVE
		const a = play(withPassive, "w", id).state, b = play(withMove, "w", id).state;
		const stolen = a.players.w.moves.concat(a.players.w.actives).find((c) => !s.players.w.moves.concat(s.players.w.actives).some((x) => x.id === c.id) && c.key !== "t-none");
		const v = playerView(a, "b");
		assert.equal(v.players.w.hand.count, playerView(b, "b").players.w.hand.count);
		assert.deepEqual(a.pending.options, b.pending.options, "the options tell a passive from a move card");
		assert.deepEqual(a.pending.options, [stolen.id, seenId].sort(byId).concat(tokens(v.players.w.hand.count - 2)));
		const hidden = [...a.players.w.moves, ...a.players.w.actives, a.players.w.passive].map((c) => c.id).filter((x) => x !== stolen.id && x !== seenId);
		const json = JSON.stringify([v.pending, v.players.w]);
		for (const x of hidden) assert.ok(!json.includes('"' + x + '"'), "hidden id in the victim's view: " + x);
	});

	test("the take-back choice survives a state JSON round trip and resolves for the opponent", () => {
		const { s, id } = holding("pickpocket", "w", 3);
		const r = play(s, "w", id);
		const stolen = ofType(r.events, "card-taken")[0].card;
		const saved = JSON.parse(JSON.stringify(r.state));
		assert.deepEqual(saved, r.state);
		assert.deepEqual(legalActions(saved, "b").map((a) => a.option), saved.pending.options);
		const back = applyAction(saved, "b", { type: "choice", option: stolen.id }), st = back.state;
		const ev = ofType(back.events, "card-taken");
		assert.deepEqual(ev, [{ type: "card-taken", player: "b", from: "w", card: stolen }]);
		assert.ok(st.players.b[stolen.key === "move" ? "moves" : "actives"].some((c) => c.id === stolen.id));
		assert.ok(![...st.players.w.moves, ...st.players.w.actives].some((c) => c.id === stolen.id));
		assert.equal(st.pending, null);
		assert.equal(st.board.turn, "b"); // THE PLAYER'S TURN ENDED AFTER THE CHOICE
		assert.equal(ofType(back.events, "turn-start").at(-1).player, "b");
		assert.ok(legalActions(st, "b").length > 0);
		assert.throws(() => applyAction(saved, "w", { type: "choice", option: stolen.id }), /isn't available/);
	});

	test("a blind token takes back a random card the victim didn't know, through a JSON round trip, for the victim only; both sides' events show the card and nothing else", () => {
		const picks = new Set();
		for (let seed = 1; seed <= 8; seed++) {
			const { s, id } = holding("pickpocket", "w", seed);
			const r = play(s, "w", id), stolen = ofType(r.events, "card-taken")[0].card;
			assert.deepEqual(playerEvents(r.state, r.events, "b").filter((e) => e.type === "card-taken"), [{ type: "card-taken", player: "w", from: "b", card: stolen }]);
			const saved = JSON.parse(JSON.stringify(r.state));
			assert.throws(() => applyAction(saved, "w", { type: "choice", option: "?1" }), /isn't available/);
			const back = applyAction(saved, "b", { type: "choice", option: "?1" }), st = back.state;
			const [ev] = ofType(back.events, "card-taken");
			assert.equal(ofType(back.events, "card-taken").length, 1);
			assert.ok(ev.card.id !== stolen.id && r.state.players.w.moves.concat(r.state.players.w.actives).some((c) => c.id === ev.card.id));
			assert.ok(st.players.b[ev.card.key === "move" ? "moves" : "actives"].some((c) => c.id === ev.card.id));
			assert.equal(st.pending, null);
			assert.equal(st.board.turn, "b");
			picks.add(ev.card.id);
			for (const viewer of ["w", "b"]) {
				const seen = playerEvents(st, back.events, viewer);
				assert.deepEqual(seen.filter((e) => e.type === "card-taken"), [ev]);
				const hidden = [...st.players[other(viewer)].moves, ...st.players[other(viewer)].actives].map((c) => c.id).filter((x) => x !== ev.card.id); // THE TAKEN CARD: BOTH KNOW IT
				const json = JSON.stringify(seen);
				for (const x of hidden) assert.ok(!json.includes('"' + x + '"'), viewer + " sees a hidden id in the events: " + x);
			}
		}
		assert.ok(picks.size > 1, "the token's card is not random");
	});

	test("a token with no unknown card gives the stolen card back", () => {
		const { s, id } = holding("pickpocket", "w", 2);
		s.enchant.push({ id: "e99", key: "fog-of-war", owner: "w", pieces: [], left: 1, data: {} }); // THE VICTIM SEES THE WHOLE HAND
		s.players.w.curses = [hand.newCard(s, "t-curse")];
		const r = play(s, "w", id), stolen = ofType(r.events, "card-taken")[0].card, w = r.state.players.w;
		assert.deepEqual(r.state.pending.options, ids([...w.moves, ...w.actives]).sort(byId).concat(tokens(1)));
		const back = applyAction(r.state, "b", { type: "choice", option: "?1" });
		assert.deepEqual(ofType(back.events, "card-taken"), [{ type: "card-taken", player: "b", from: "w", card: stolen }]);
	});

	test("a steal respects the hand caps: a card that doesn't fit is lost", () => {
		const { s, id } = holding("pickpocket", "w", 4);
		while (s.players.w.moves.length < hand.MOVE_CAP) s.players.w.moves.push(hand.newCard(s, "move", { piece: "p" }));
		s.players.b.actives = [];
		const r = play(s, "w", id), [ev] = ofType(r.events, "card-taken");
		assert.equal(ev.lost, true);
		assert.equal(r.state.players.w.moves.length, hand.MOVE_CAP);
		assert.ok(![...r.state.players.w.moves, ...r.state.players.b.moves].some((c) => c.id === ev.card.id));
		assert.deepEqual(r.state.pending.options, tokens(playerView(r.state, "b").players.w.hand.count)); // NOTHING KNOWN LEFT TO NAME
	});

	test("uncommon version: the taker picks from the opponent's move and active cards (shown to the taker for that choice only), then the opponent takes one of the taker's cards back at random", () => {
		const back = new Set();
		for (let seed = 1; seed <= 8; seed++) {
			const { s, id } = holding("pickpocket-uncommon", "w", seed);
			s.players.b.passive = hand.newCard(s, "t-none");
			s.players.b.curses = [hand.newCard(s, "t-curse")];
			const b = s.players.b, options = ids([...b.moves, ...b.actives]).sort(byId);
			const r = play(s, "w", id), st = r.state;
			assert.ok(!ofType(r.events, "card-taken").length);
			assert.deepEqual({ player: st.pending.player, kind: st.pending.kind, options: st.pending.options }, { player: "w", kind: "pick", options });
			assert.deepEqual(ids(playerView(st, "w").players.b.hand.shown), [...options, ...ids(b.curses)].sort(byId)); // NEVER THE PASSIVE
			assert.deepEqual(playerView(st, "b").pending, { player: "w", kind: "pick" });
			assert.equal(st.board.turn, "w");
			const saved = JSON.parse(JSON.stringify(st));
			assert.throws(() => applyAction(saved, "b", { type: "choice", option: options[1] }), /isn't available/);
			const pick = b.moves.concat(b.actives).find((c) => c.id === options[seed % options.length]);
			const res = applyAction(saved, "w", { type: "choice", option: pick.id }), end = res.state, ev = ofType(res.events, "card-taken");
			assert.equal(ev.length, 2);
			assert.deepEqual(ev[0], { type: "card-taken", player: "w", from: "b", card: pick });
			assert.deepEqual([ev[1].player, ev[1].from], ["b", "w"]);
			const held = [...st.players.w.moves, ...st.players.w.actives, pick];
			assert.ok(held.some((c) => c.id === ev[1].card.id));
			assert.ok(end.players.b[ev[1].card.key === "move" ? "moves" : "actives"].some((c) => c.id === ev[1].card.id));
			back.add(ev[1].card.id);
			assert.equal(end.pending, null);
			assert.equal(end.board.turn, "b");
			assert.deepEqual(ids(playerView(end, "w").players.b.hand.shown), ids(end.players.b.curses), "the opponent's cards still shown after the choice");
			assert.ok(end.players.b.passive && end.players.b.king);
		}
		assert.ok(back.size > 1, "the card taken back is not random");
		assert.deepEqual([CARDS["pickpocket-uncommon"].name, CARDS["pickpocket-uncommon"].rarity, CARDS["pickpocket-uncommon"].skulls], ["Pickpocket", "uncommon", 1]);
	});

	test("epic version: the taker picks and nothing is taken back; a picked card that doesn't fit the hand cap is lost", () => {
		const { s, id } = holding("pickpocket-epic", "w", 2);
		const pick = s.players.b.moves[3];
		const r = play(s, "w", id);
		assert.equal(r.state.pending.kind, "pick");
		const res = applyAction(r.state, "w", { type: "choice", option: pick.id });
		assert.deepEqual(ofType(res.events, "card-taken"), [{ type: "card-taken", player: "w", from: "b", card: pick }]);
		assert.ok(res.state.players.w.moves.some((c) => c.id === pick.id));
		assert.equal(res.state.board.turn, "b");
		const full = holding("pickpocket-epic", "w", 4);
		while (full.s.players.w.moves.length < hand.MOVE_CAP) full.s.players.w.moves.push(moveCard(full.s, "p"));
		const lost = full.s.players.b.moves[0];
		const l = applyAction(play(full.s, "w", full.id).state, "w", { type: "choice", option: lost.id });
		assert.deepEqual(ofType(l.events, "card-taken"), [{ type: "card-taken", player: "w", from: "b", card: lost, lost: true }]);
		assert.ok(![...l.state.players.w.moves, ...l.state.players.b.moves].some((c) => c.id === lost.id));
		assert.deepEqual([CARDS["pickpocket-epic"].rarity, CARDS["pickpocket-epic"].skulls], ["epic", 0]);
	});

	test("not playable in check", () => { notInCheck("pickpocket", true); notInCheck("pickpocket-uncommon", true); });
});
