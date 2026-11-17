/*
 *  cards-active-hand.test.js  --  chess cards engine tests
 *	Actives that act on hands and information (cards-engine/cards/active/): Foresight, Fog of War, Mulligan, Pickpocket, Insidious Nullification, Double Time, Hexcraft, Cleanse
 *
 */

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const { newGame, legalActions, applyAction, playerView, playerEvents } = require("../../cards-engine/index.js");
const { fromFen } = require("../../cards-engine/board.js");
const hand = require("../../cards-engine/hand.js");
const { register, reset, CURSE_KEYS } = require("../../cards-engine/cards/index.js");
const statuses = require("../../cards-engine/statuses.js");

reset();
for (const k of ["foresight", "fog-of-war", "mulligan", "pickpocket", "insidious-nullification", "double-time", "hexcraft", "cleanse", "stronghold", "heretical-subjection"]) register(require("../../cards-engine/cards/active/" + k + ".js"));

const fresh = (seed = 1) => newGame({ vesper: "b", level: 1300, seed });
const ofType = (events, type) => events.filter((e) => e.type === type);
const ids = (cards) => cards.map((c) => c.id);
const byId = (a, b) => Number(a.slice(1)) - Number(b.slice(1));
const other = (c) => (c === "w" ? "b" : "w");
const tokens = (k) => Array.from({ length: k }, (_, i) => "?" + (i + 1));
const CHECK = "4k3/8/8/8/8/8/4r3/4K3 w - - 0 1", QUIET = "4k3/8/8/8/8/8/3r4/4K3 w - - 0 1"; // e2 CHECKS THE KING ON e1; d2 DOESN'T

/**
 * @description A fresh game (or one on fen) where color holds exactly one active, of this key; returns { s, id }.
 */
function holding(key, color = "w", seed = 1, fen) {
	const s = fresh(seed);
	if (fen) s.board = fromFen(fen);
	const c = hand.newCard(s, key);
	s.players[color].actives = [c];
	return { s, id: c.id };
}

/**
 * @description Play color's active with this id (no target).
 */
const play = (s, color, id) => applyAction(s, color, { type: "active", card: id });

/**
 * @description Apply color's first legal move action.
 */
const step = (s, color) => applyAction(s, color, legalActions(s, color).find((a) => a.type === "move")).state;

// TEST-ONLY CURSE: WHEN ITS HOLDER PLAYS AN ACTIVE IT TAKES THE ROOK ON e2, SO ANY ACTIVE WOULD END THE CHECK
register({ key: "t-rescue", kind: "curse", name: "t-rescue", text: "", on: {
	"card-played"(ctx, owner, ev) {
		const r = ctx.state.board.sq.find((p) => p && p.t === "r" && p.c !== owner);
		return ev.player === owner && !!r && ctx.capture(owner, r.id);
	},
} });

/**
 * @description key is not playable in check on its own (it can't end a check) and is playable on the same position out of check. With t-rescue held (playing any active ends the check), a card with a random outcome is still not playable in check (turn.js activeActions: no active playable in check may have a random outcome); one without (Fog of War) is.
 */
function notInCheck(key, random) {
	for (const [fen, n, rescue] of [[CHECK, 0, false], [QUIET, 1, false], [CHECK, random ? 0 : 1, true]]) {
		const { s, id } = holding(key, "w", 1, fen);
		if (rescue) s.players.w.curses = [hand.newCard(s, "t-rescue")];
		assert.equal(legalActions(s, "w").filter((a) => a.type === "active" && a.card === id).length, n, fen + (rescue ? " with t-rescue" : ""));
	}
}

describe("Foresight", () => {
	test("shows a random half (rounded up) of the opponent's hidden hand, drawn from state.rng", () => {
		for (const seed of [1, 2, 3, 4, 5]) {
			const { s, id } = holding("foresight", "w", seed);
			s.players.b.passive = hand.newCard(s, "t-none");
			s.players.b.curses = [hand.newCard(s, "t-curse")]; // SHOWN ANYWAY: NOT PART OF THE HALF
			s.players.b.moves.pop();
			const hidden = ids([...s.players.b.moves, ...s.players.b.actives, s.players.b.passive]); // 5 + 1 + 1 = 7: ROUNDED UP TO 4
			const r = play(s, "w", id), seen = r.state.players.w.seen;
			assert.equal(seen.ids.length, 4);
			assert.equal(new Set(seen.ids).size, 4);
			for (const x of seen.ids) assert.ok(hidden.includes(x), "seen id not a hidden card: " + x);
			assert.deepEqual(seen.fake, []);
			assert.deepEqual(play(s, "w", id).state.players.w.seen, seen); // SAME STATE, SAME RNG, SAME PICK
			const v = playerView(r.state, "w");
			assert.deepEqual(ids(v.players.b.hand.shown), [...seen.ids, ...ids(s.players.b.curses)].sort(byId));
			assert.ok(!("seen" in v.players.w));
			assert.ok(!("rng" in v));
		}
		const picks = new Set();
		for (let seed = 1; seed <= 20; seed++) { const { s, id } = holding("foresight", "w", seed); picks.add(play(s, "w", id).state.players.w.seen.ids.join()); }
		assert.ok(picks.size > 1, "the half is not random");
	});

	test("lasts until the end of the player's next turn", () => {
		const { s, id } = holding("foresight");
		const r = play(s, "w", id);
		assert.ok(r.state.players.w.seen);
		assert.deepEqual(ofType(r.events, "enchant").map((e) => e.key), ["foresight"]);
		let t = step(r.state, "b"); // BLACK'S TURN
		assert.ok(t.players.w.seen, "gone on the opponent's turn");
		assert.equal(t.board.turn, "w");
		const last = applyAction(t, "w", legalActions(t, "w").find((a) => a.type === "move")); // WHITE'S NEXT TURN ENDS
		assert.equal(last.state.players.w.seen, null);
		assert.ok(!last.state.enchant.some((e) => e.key === "foresight"));
		assert.equal(ofType(last.events, "enchant-ended").length, 1);
		assert.equal(playerView(last.state, "w").players.b.hand.shown.length, 0);
	});

	test("not playable in check", () => notInCheck("foresight", true));
});

describe("Fog of War", () => {
	test("puts a fog-of-war enchantment up: the opponent sees the player's pieces as '?' and the player's whole hand", () => {
		const { s, id } = holding("fog-of-war");
		const r = play(s, "w", id);
		const fog = r.state.enchant.filter((e) => e.key === "fog-of-war");
		assert.equal(fog.length, 1);
		const { fresh: f, ...entry } = fog[0];
		assert.deepEqual(entry, { id: entry.id, key: "fog-of-war", owner: "w", pieces: [], left: 1, data: {} });
		assert.deepEqual(ofType(r.events, "enchant").map((e) => [e.player, e.key]), [["w", "fog-of-war"]]);
		const v = playerView(r.state, "b");
		for (const p of v.board.sq.filter(Boolean)) assert.equal(p.t === "?", p.c === "w");
		assert.deepEqual(v.board.history, []);
		assert.equal(v.board.half, 0);
		const w = r.state.players.w, all = ids([...w.moves, ...w.actives, ...(w.passive ? [w.passive] : []), ...w.curses]).sort(byId);
		assert.deepEqual(ids(v.players.w.hand.shown), all);
		const own = playerView(r.state, "w");
		assert.ok(own.board.sq.filter(Boolean).every((p) => p.t !== "?"));
	});

	test("lasts through the opponent's next turn and ends at the end of the player's next turn", () => {
		const { s, id } = holding("fog-of-war");
		const r = play(s, "w", id);
		assert.equal(r.state.board.turn, "b");
		assert.ok(playerView(r.state, "b").board.sq.some((p) => p && p.t === "?"), "no fog on the opponent's turn");
		const evs = playerEvents(r.state, r.events, "b");
		assert.ok(evs.every((e) => !(e.type === "draw" && e.player === "w") || e.card), "the fogged player's draws show their card to the opponent");
		const t = step(r.state, "b");
		assert.ok(t.enchant.some((e) => e.key === "fog-of-war"), "fog ended before the player's next turn");
		const last = applyAction(t, "w", legalActions(t, "w").find((a) => a.type === "move"));
		assert.ok(!last.state.enchant.some((e) => e.key === "fog-of-war"));
		assert.deepEqual(ofType(last.events, "enchant-ended").map((e) => e.key), ["fog-of-war"]);
		assert.ok(playerView(last.state, "b").board.sq.every((p) => !p || p.t !== "?"));
	});

	test("not playable in check", () => notInCheck("fog-of-war", false));
});

describe("Mulligan", () => {
	test("discards every move card and draws the same number of new ones", () => {
		const { s, id } = holding("mulligan");
		s.players.w.moves.splice(4); // 4 MOVE CARDS
		s.players.w.refillLock = 1; // NO END-OF-TURN REFILL: THE HAND AFTER THE TURN IS WHAT MULLIGAN DREW
		const old = ids(s.players.w.moves);
		const r = play(s, "w", id), ev = r.events;
		const discards = ofType(ev, "discard").filter((e) => e.player === "w");
		assert.deepEqual(ids(discards.map((e) => e.card)), old);
		const firstTurn = ev.slice(0, ev.findIndex((e) => e.type === "turn-start"));
		const drawn = ofType(firstTurn, "draw").filter((e) => e.player === "w").map((e) => e.card);
		assert.equal(drawn.length, 4);
		assert.ok(drawn.every((c) => c.key === "move" && !old.includes(c.id)));
		assert.deepEqual(ids(r.state.players.w.moves), ids(drawn));
		const at = firstTurn.indexOf(discards[3]);
		assert.ok(firstTurn.indexOf(ofType(firstTurn, "draw")[0]) > at, "draws before the discards ended");
		assert.ok(!r.state.players.w.moves.some((c) => old.includes(c.id)));
		assert.equal(r.state.players.w.skips, 0);
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

	test("not playable in check", () => notInCheck("pickpocket", true));
});

const { sqIndex } = require("../../cards-engine/board.js");
const at = (s, sq) => s.board.sq[sqIndex(sq)];
const moveCard = (s, piece) => hand.newCard(s, "move", { piece });
const activeIds = (s, color, id) => legalActions(s, color).filter((a) => a.type === "active" && a.card === id);
const moveFrom = (s, color, from, to) => legalActions(s, color).find((a) => a.type === "move" && a.from === from && (!to || a.to === to));
for (const k of ["t-hex-a", "t-hex-b", "t-hex-c"]) register({ key: k, kind: "curse", name: k, text: "" }); // TEST-ONLY CURSES WITH NO EFFECT
// TEST-ONLY CURSE: A CARD MADE WITH { ask: true } ASKS ITS HOLDER AT THE START OF THEIR TURN (ONE HEXCRAFT GIVES NEVER DOES)
register({ key: "t-ask", kind: "curse", name: "t-ask", text: "", on: {
	"turn-start"(ctx, owner, ev, src) {
		if (ev.player !== owner || !src.card.ask) return false;
		ctx.ask(owner, "t-ask", ["x", "y"], { card: "t-ask" });
		return true;
	},
}, choice: { resolve() {} } });

describe("Insidious Nullification", () => {
	test("cancels every waiting passive of the opponent's (a passive-cancelled event each), then the player forfeits a piece of a type in their hand, their choice", () => {
		const { s, id } = holding("insidious-nullification");
		assert.equal(activeIds(s, "w", id).length, 1, "not playable with no opponent passive waiting");
		const pass = (owner, placedAt) => ({ id: "x" + placedAt, owner, card: hand.newCard(s, "t-pass"), placedAt });
		s.effects = [pass("b", 3), pass("w", 1), pass("b", 2)];
		s.players.w.moves = [moveCard(s, "n"), moveCard(s, "n")];
		s.board.half = 7;
		const r = play(s, "w", id), st = r.state;
		assert.deepEqual(ofType(r.events, "passive-cancelled"), [s.effects[2], s.effects[0]].map((e) => ({ type: "passive-cancelled", player: "b", card: e.card })));
		assert.deepEqual(st.effects, [s.effects[1]]); // THE PLAYER'S OWN STAYS
		assert.ok(!ofType(r.events, "passive-fired").length);
		const knights = [at(s, "b1").id, at(s, "g1").id];
		assert.deepEqual({ player: st.pending.player, kind: st.pending.kind, options: st.pending.options }, { player: "w", kind: "insidious-nullification", options: knights });
		assert.equal(st.board.turn, "w"); // THE TURN WAITS FOR THE CHOICE
		const saved = JSON.parse(JSON.stringify(st));
		assert.throws(() => applyAction(saved, "b", { type: "choice", option: knights[1] }), /isn't available/);
		const back = applyAction(saved, "w", { type: "choice", option: knights[1] }), end = back.state;
		assert.deepEqual(ofType(back.events, "capture"), [{ type: "capture", player: "w", piece: knights[1], t: "n", c: "w", by: null, sq: "g1" }]);
		assert.equal(at(end, "g1"), null);
		assert.ok(at(end, "b1"));
		assert.equal(end.board.half, 0, "a forfeit is a capture: the fifty-move counter resets");
		assert.equal(end.board.turn, "b");
		assert.equal(end.pending, null);
	});

	test("offers only pieces whose loss leaves the king safe, never the king; not playable when no piece can be forfeited", () => {
		const fen = "4r1k1/8/8/8/8/8/4B3/N3K3 w - - 0 1"; // THE BISHOP ON e2 IS PINNED
		const { s, id } = holding("insidious-nullification", "w", 1, fen);
		s.players.w.moves = [moveCard(s, "b"), moveCard(s, "n"), moveCard(s, "k")];
		assert.equal(activeIds(s, "w", id).length, 1);
		assert.deepEqual(play(s, "w", id).state.pending.options, [at(s, "a1").id]);
		s.players.w.moves = [moveCard(s, "b"), moveCard(s, "k")];
		assert.equal(activeIds(s, "w", id).length, 0, "playable with only the pinned bishop to forfeit");
		s.players.w.moves = [];
		assert.equal(activeIds(s, "w", id).length, 0, "playable with no move card");
	});

	test("a held Mirage counts as a card of its fake type (its holder can't tell it from a real one)", () => {
		const { s, id } = holding("insidious-nullification");
		s.players.w.moves = [];
		s.players.w.curses = [hand.newCard(s, "mirage", { piece: "n" })];
		assert.equal(activeIds(s, "w", id).length, 1);
		assert.deepEqual(play(s, "w", id).state.pending.options, [at(s, "b1").id, at(s, "g1").id]);
	});

	test("a forfeit is a removal, not a capture by anyone: a forfeited Marked piece makes no one draw or discard", () => {
		const { s, id } = holding("insidious-nullification");
		s.players.w.moves = [moveCard(s, "n")];
		s.players.w.refillLock = 1; // NO END-OF-TURN REFILL DRAWS
		const n = at(s, "b1").id;
		s.statuses[n] = [{ s: "marked", left: 2, by: "b" }];
		const back = applyAction(play(s, "w", id).state, "w", { type: "choice", option: n });
		assert.equal(ofType(back.events, "capture").length, 1);
		assert.deepEqual(back.events.filter((e) => e.type === "draw" || e.type === "discard"), []);
		assert.equal(at(back.state, "b1"), null);
		assert.equal(back.state.board.half, 0);
	});
});

describe("Double Time", () => {
	test("two moves with two different pieces, each spending its own card; then the player's next turn is skipped", () => {
		const { s, id } = holding("double-time");
		s.players.w.moves = [moveCard(s, "p"), moveCard(s, "n"), moveCard(s, "p")];
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
		assert.equal(next.state.players.w.skips, 0); // NOT A DISCARD SKIP
		assert.equal(next.state.players.w.lostTurns, 0);
	});

	test("the second move must also leave the king safe", () => {
		const { s, id } = holding("double-time", "w", 1, "4r1k1/8/8/8/8/4B3/4R3/4K3 w - - 0 1"); // TWO BLOCKERS: NEITHER PINNED
		s.players.w.moves = [moveCard(s, "b"), moveCard(s, "r")];
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
	test("targets each curse and status on the player's side (never the opponent's) and removes the chosen one, using the whole turn", () => {
		const { s, id } = holding("cleanse");
		const [c1, c2] = s.players.w.curses = [hand.newCard(s, "t-hex-a"), hand.newCard(s, "t-hex-b")];
		const wp = at(s, "e2").id, bp = at(s, "e7").id;
		s.statuses[wp] = [{ s: "frozen", left: 2, by: "b" }];
		s.statuses[bp] = [{ s: "shaken", left: 2, by: "w" }];
		s.players.b.curses = [hand.newCard(s, "t-hex-c")];
		const targets = activeIds(s, "w", id).map((a) => a.target);
		assert.deepEqual(targets, [{ curse: c1.id }, { curse: c2.id }, { piece: wp, s: "frozen" }]);
		const r = applyAction(s, "w", { type: "active", card: id, target: { curse: c1.id } });
		assert.deepEqual(ofType(r.events, "curse-cleared"), [{ type: "curse-cleared", player: "w", card: c1 }]);
		assert.deepEqual(r.state.players.w.curses, [c2]);
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
		const mirage = hand.newCard(s, "mirage", { piece: "n" });
		s.players.w.curses = [mirage];
		assert.equal(activeIds(s, "w", id).length, 0, "Cleanse shows a Mirage");
		const c = hand.newCard(s, "t-hex-a");
		s.players.w.curses = [mirage, c];
		assert.deepEqual(activeIds(s, "w", id).map((a) => a.target), [{ curse: c.id }]);
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
});
