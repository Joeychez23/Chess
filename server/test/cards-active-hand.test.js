/*
 *  cards-active-hand.test.js  --  chess cards engine tests
 *	Actives that act on hands and information (cards-engine/cards/active/): Foresight, Fog of War, Mulligan, Pickpocket, Insidious Nullification, Double Time, Hexcraft, Cleanse
 *
 */

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const { newGame, legalActions, applyAction, playerView, playerEvents } = require("../../cards-engine/index.js");
const { fromView } = require("../../cards-engine/view.js");
const { fromFen } = require("../../cards-engine/board.js");
const hand = require("../../cards-engine/hand.js");
const { register, reset, CURSE_KEYS, CARDS, baseKey } = require("../../cards-engine/cards/index.js");
const statuses = require("../../cards-engine/statuses.js");

reset();
for (const k of ["foresight", "fog-of-war", "mulligan", "pickpocket", "insidious-nullification", "double-time", "hexcraft", "cleanse", "stronghold", "heretical-subjection"]) register(require("../../cards-engine/cards/active/" + k + ".js"));

const fresh = (seed = 1) => newGame({ cardGuy: "b", level: 1300, seed });
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

/**
 * @description color's legal move actions; varied applies the i-th (mod their number), so a long run doesn't repeat a position.
 */
const movesOf = (s, color) => legalActions(s, color).filter((a) => a.type === "move");
const varied = (s, color, i) => applyAction(s, color, movesOf(s, color)[(i * 7 + 3) % movesOf(s, color).length]).state;

// TEST-ONLY CURSE: WHEN ITS HOLDER PLAYS AN ACTIVE IT TAKES THE ROOK ON e2, SO ANY ACTIVE WOULD END THE CHECK
register({ key: "t-rescue", kind: "curse", name: "t-rescue", rarity: "common", text: "", on: {
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

	test("rare and epic versions: the opponent's whole hand, live (a card drawn later shows too), until the end of the player's next turn (rare) or for 3 of the player's turns (epic)", () => {
		for (const [key, turns] of [["foresight-rare", 1], ["foresight-epic", 3]]) {
			const { s, id } = holding(key);
			s.players.b.passive = hand.newCard(s, "t-none");
			s.players.b.moves.pop(); // BLACK'S END-OF-TURN REFILL DRAWS A NEW MOVE CARD
			const whole = (st) => ids([...st.players.b.moves, ...st.players.b.actives, st.players.b.passive, ...st.players.b.curses]).sort(byId);
			const r = play(s, "w", id);
			assert.deepEqual(ofType(r.events, "enchant").map((e) => e.key), ["foresight"]);
			assert.deepEqual(ids(playerView(r.state, "w").players.b.hand.shown), whole(r.state), key);
			let st = r.state, n = 0;
			for (let i = 0; st.players.w.seen && i < 20; i++) {
				const b = applyAction(st, "b", movesOf(st, "b")[(i * 7 + 3) % movesOf(st, "b").length]);
				st = b.state;
				const drawn = ofType(b.events, "draw").filter((e) => e.player === "b");
				if (i === 0) assert.ok(drawn.length > 0);
				assert.deepEqual(ids(playerView(st, "w").players.b.hand.shown), whole(st), key + ": not the whole hand on turn " + n);
				assert.ok(playerEvents(st, b.events, "w").filter((e) => e.type === "draw" && e.player === "b").every((e) => e.card), key + ": a draw hidden");
				st = varied(st, "w", i);
				n++;
			}
			assert.equal(st.result, null);
			assert.equal(n, turns, key);
			assert.equal(st.players.w.seen, null);
			assert.equal(playerView(st, "w").players.b.hand.shown.length, 0);
		}
		assert.deepEqual(["foresight-rare", "foresight-epic"].map((k) => [CARDS[k].name, CARDS[k].rarity, CARDS[k].skulls]), [["Foresight", "rare", 0], ["Foresight", "epic", 0]]);
	});

	test("not playable in check", () => notInCheck("foresight", true));

	test("a rare Foresight ending while a later base one lasts leaves only the base card's half", () => {
		const { s, id } = holding("foresight-rare");
		let st = varied(play(s, "w", id).state, "b", 0);
		const base = hand.newCard(st, "foresight");
		st.players.w.actives = [base];
		st = play(st, "w", base.id).state; // THE RARE ENTRY ENDS AT THE END OF THIS TURN, THE BASE ONE A TURN LATER
		assert.deepEqual(st.enchant.filter((e) => e.key === "foresight").map((e) => !!(e.data && e.data.all)), [false]);
		assert.equal(st.players.w.seen.all, false);
		const half = st.players.w.seen.ids;
		assert.ok(half.length > 0 && half.length < st.players.b.moves.length + st.players.b.actives.length);
		assert.deepEqual(ids(playerView(st, "w").players.b.hand.shown).sort(byId), half.filter((x) => [...st.players.b.moves, ...st.players.b.actives].some((c) => c.id === x)).sort(byId));
	});

	test("a base Foresight played while the epic one lasts keeps the whole-hand sight for the epic's turns", () => {
		const { s, id } = holding("foresight-epic");
		const whole = (st) => ids([...st.players.b.moves, ...st.players.b.actives, ...(st.players.b.passive ? [st.players.b.passive] : []), ...st.players.b.curses]).sort(byId);
		let st = varied(play(s, "w", id).state, "b", 0);
		const base = hand.newCard(st, "foresight");
		st.players.w.actives = [base];
		st = play(st, "w", base.id).state;
		assert.deepEqual(st.enchant.filter((e) => e.key === "foresight").map((e) => e.left).sort(), [1, 2]);
		for (let i = 1; st.enchant.some((e) => e.key === "foresight" && e.data && e.data.all); i++) {
			assert.deepEqual(ids(playerView(st, "w").players.b.hand.shown).sort(byId), whole(st), "turn " + i);
			st = varied(st, "b", i);
			if (st.enchant.some((e) => e.key === "foresight")) assert.deepEqual(ids(playerView(st, "w").players.b.hand.shown).sort(byId), whole(st), "after Black's move " + i);
			st = varied(st, "w", i);
		}
		assert.equal(st.players.w.seen, null);
	});
});

describe("Fog of War", () => {
	const FOGS = { "fog-of-war": { turns: 3, hand: true }, "fog-of-war-rare": { turns: 3, hand: false }, "fog-of-war-epic": { turns: 5, hand: false } };
	const fogUp = (s) => s.enchant.some((e) => e.owner === "w" && baseKey(e.key) === "fog-of-war");

	test("puts a fog-of-war enchantment up: the opponent sees none of the player's pieces on the player's half; the hand shows for the base card only", () => {
		for (const [key, { turns, hand: open }] of Object.entries(FOGS)) {
			const { s, id } = holding(key);
			s.players.w.moves.pop(); // THE END-OF-TURN REFILL DRAWS A MOVE CARD
			const r = play(s, "w", id);
			const fog = r.state.enchant.filter((e) => baseKey(e.key) === "fog-of-war");
			assert.equal(fog.length, 1);
			const { fresh: f, ...entry } = fog[0];
			assert.deepEqual(entry, { id: entry.id, key, owner: "w", pieces: [], left: turns, data: {} });
			assert.deepEqual(ofType(r.events, "enchant").map((e) => [e.player, e.key]), [["w", key]]);
			const v = playerView(r.state, "b");
			assert.ok(v.board.sq.filter(Boolean).every((p) => p.c === "b"), key); // EVERY WHITE PIECE STARTS ON WHITE'S HALF: NONE IN THE VIEW
			assert.equal(v.board.hidden, 16, key);
			assert.deepEqual(v.board.history, []);
			assert.equal(v.board.half, 0);
			const w = r.state.players.w, all = ids([...w.moves, ...w.actives, ...(w.passive ? [w.passive] : []), ...w.curses]).sort(byId);
			assert.deepEqual(ids(v.players.w.hand.shown), open ? all : [], key);
			const draws = playerEvents(r.state, r.events, "b").filter((e) => e.type === "draw" && e.player === "w");
			assert.ok(draws.length > 0);
			assert.ok(draws.every((e) => !!e.card === open), key + ": the fogged player's draws");
			assert.equal(playerView(r.state, "w").board.sq.filter(Boolean).length, 32);
			assert.ok(!("hidden" in playerView(r.state, "w").board));
		}
		assert.deepEqual(["fog-of-war", "fog-of-war-rare", "fog-of-war-epic"].map((k) => [CARDS[k].name, CARDS[k].rarity, CARDS[k].skulls]),
			[["Fog of War", "uncommon", 2], ["Fog of War", "rare", 0], ["Fog of War", "epic", 0]]);
		assert.equal(CARDS["fog-of-war"].text, "For 3 turns the opponent can't see your pieces on your half of the board and isn't shown their legal moves. Debuff: your hand is visible to the opponent while the fog lasts.");
	});

	test("lasts 3 of the player's turns (the epic version 5), the hand open (base card) or hidden (versions) throughout", () => {
		for (const [key, { turns, hand: open }] of Object.entries(FOGS)) {
			const { s, id } = holding(key);
			let st = play(s, "w", id).state, n = 0;
			for (let i = 0; fogUp(st) && i < 20; i++) {
				st = varied(st, "b", i);
				assert.ok(fogUp(st), key + ": fog ended before the player's turn");
				assert.ok(playerView(st, "b").board.hidden > 0, key);
				assert.equal(playerView(st, "b").players.w.hand.shown.length > 0, open, key);
				const r = applyAction(st, "w", movesOf(st, "w")[i % movesOf(st, "w").length]);
				st = r.state;
				n++;
				if (!fogUp(st)) assert.deepEqual(ofType(r.events, "enchant-ended").map((e) => e.key), [key]);
			}
			assert.equal(st.result, null);
			assert.equal(n, turns, key);
			assert.ok(!("hidden" in playerView(st, "b").board));
			assert.deepEqual(playerView(st, "b").board, st.board);
			assert.equal(playerView(st, "b").players.w.hand.shown.length, 0);
		}
	});

	test("a piece that leaves the player's half is shown, one that comes back is hidden; the opponent's events never name a hidden type", () => {
		const { s, id } = holding("fog-of-war", "w", 1, "4k3/8/8/8/R7/8/8/4K3 w - - 0 1"); // THE ROOK ON a4 STANDS ON WHITE'S HALF
		const rook = at(s, "a4").id;
		s.players.w.moves = [moveCard(s, "r"), moveCard(s, "r")];
		const r = play(s, "w", id), seen = (st, sq) => playerView(st, "b").board.sq[sqIndex(sq)];
		assert.equal(seen(r.state, "a4"), null);
		assert.equal(seen(r.state, "e1"), null);
		assert.ok(!JSON.stringify(playerView(r.state, "b")).includes("\"" + rook + "\""));
		const up = applyAction(step(r.state, "b"), "w", moveFrom(step(r.state, "b"), "w", "a4", "a5"));
		assert.deepEqual(seen(up.state, "a5"), { id: rook, c: "w", t: "r" }); // ON BLACK'S HALF: SHOWN
		assert.equal(seen(up.state, "e1"), null);
		assert.deepEqual(playerEvents(up.state, up.events, "b").filter((e) => e.type === "move"), [{ type: "move", player: "w", piece: rook, to: "a5" }]); // WHERE IT STOOD IN THE FOG ISN'T TOLD
		const t = step(up.state, "b"), back = applyAction(t, "w", moveFrom(t, "w", "a5", "a4"));
		assert.ok(fogUp(back.state));
		assert.equal(seen(back.state, "a4"), null); // BACK ON WHITE'S HALF: HIDDEN
		assert.deepEqual(playerEvents(back.state, back.events, "b").filter((e) => e.type === "move"), [{ type: "move", player: "w" }]); // A HIDDEN PIECE'S MOVE: NO PIECE, NO SQUARES
		assert.ok(!JSON.stringify(playerEvents(back.state, back.events, "b")).includes("\"" + rook + "\""));
		const v = playerView(back.state, "b");
		assert.deepEqual([v.board.history, v.board.half, v.board.castling, v.players.w.captured], [[], 0, "-", []]);
		const cap = [{ type: "capture", player: "b", piece: rook, t: "r", c: "w", by: "b5", sq: "a4" }];
		const gone = JSON.parse(JSON.stringify(back.state));
		gone.board.sq[sqIndex("a4")] = null; // TAKEN: OFF THE BOARD
		assert.deepEqual(playerEvents(gone, cap, "b"), [{ type: "capture", player: "b", t: "?", c: "w", by: "b5", sq: "a4" }]); // NEITHER ITS TYPE NOR ITS ID
	});

	test("a visible king on the opponent's half: fromView gives the fogged side no second king", () => {
		const s = fresh(5);
		s.board = fromFen("8/8/4k3/1K6/8/8/PPPP4/RNBQ4 b - - 0 1"); // WHITE'S KING ON b5: BLACK'S HALF, SO SHOWN
		s.enchant.push({ id: "e1", key: "fog-of-war", owner: "w", pieces: [], left: 3, data: {} });
		const v = playerView(s, "b");
		assert.equal(v.board.sq[sqIndex("b5")].t, "k");
		for (let seed = 1; seed <= 20; seed++) {
			const f = fromView(v, seed);
			assert.equal(f.board.sq.filter((p) => p && p.c === "w" && p.t === "k").length, 1, "seed " + seed);
			assert.ok(f.board.sq.every((p) => !p || "pnbrqk".includes(p.t)));
		}
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

const { sqIndex } = require("../../cards-engine/board.js");
const at = (s, sq) => s.board.sq[sqIndex(sq)];
const moveCard = (s, piece) => hand.newCard(s, "move", { piece });
const activeIds = (s, color, id) => legalActions(s, color).filter((a) => a.type === "active" && a.card === id);
const moveFrom = (s, color, from, to) => legalActions(s, color).find((a) => a.type === "move" && a.from === from && (!to || a.to === to));
for (const k of ["t-hex-a", "t-hex-b", "t-hex-c"]) register({ key: k, kind: "curse", name: k, rarity: "common", text: "" }); // TEST-ONLY CURSES WITH NO EFFECT
// TEST-ONLY CURSE: A CARD MADE WITH { ask: true } ASKS ITS HOLDER AT THE START OF THEIR TURN (ONE HEXCRAFT GIVES NEVER DOES)
register({ key: "t-ask", kind: "curse", name: "t-ask", rarity: "common", text: "", on: {
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

describe("Insidious Nullification, rare version", () => {
	test("cancels the opponent's waiting passives with no forfeit, and is playable with no forfeitable piece", () => {
		const { s, id } = holding("insidious-nullification-rare");
		s.players.w.moves = [];
		s.players.w.refillLock = 1;
		const card = hand.newCard(s, "t-pass");
		s.effects = [{ id: "x1", owner: "b", card, placedAt: 1 }];
		assert.equal(activeIds(s, "w", id).length, 1);
		const r = play(s, "w", id);
		assert.deepEqual(ofType(r.events, "passive-cancelled"), [{ type: "passive-cancelled", player: "b", card }]);
		assert.deepEqual(r.state.effects, []);
		assert.equal(r.state.pending, null);
		assert.ok(!ofType(r.events, "capture").length && !ofType(r.events, "choice").length);
		assert.equal(r.state.board.sq.filter(Boolean).length, 32);
		assert.equal(r.state.board.turn, "b");
		assert.deepEqual([CARDS["insidious-nullification-rare"].rarity, CARDS["insidious-nullification-rare"].skulls], ["rare", 0]);
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

	test("legendary version: two moves with two different pieces and no skipped turn", () => {
		const { s, id } = holding("double-time-legendary");
		s.players.w.moves = [moveCard(s, "p"), moveCard(s, "n")];
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
		const mirage = hand.newCard(s, "mirage", { piece: "n" });
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
