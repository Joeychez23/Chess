/*
 *  cardGuy-cardsAndPassives.test.js  --  chess server tests
 *	Card Guy, the card-game bot (server/utils/card-guy): the card duel, chance outcomes, dead actives and his waiting passives. The engine is stubbed: no test reaches Stockfish.
 *
 */

require("../helpers/env.js");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { engine, newGame, legalActions, applyAction, playerView, actionKey, toFen, hand, cardGuyTurn, scoreTurn, MAX_EVALS, candidates, duelValue, WEIGHTS, opts, owes, fogUp, position, ask } = require("../helpers/cardGuy.js");

test("the card duel's stake is the whole hand: every card held counts against the next hand, with no cap", () => {
	const s = newGame({ cardGuy: "w", level: 2400, seed: 1 }), knight = s.board.sq.find((q) => q && q.c === "w" && q.t === "n").id, card = () => hand.newCard(s, "move", { piece: "p" });
	const value = (n, key = "all-or-nothing") => { Object.assign(s.players.w, { moves: Array.from({ length: n }, card), actives: [], passive: null }); return duelValue(s, "w", key, knight); };
	assert.equal(value(5), 0.5 * (500 - 320) - 0.5 * (5 * -WEIGHTS.cardLost + 320));
	assert.equal(value(6) - value(9), 1.5 * -WEIGHTS.cardLost); // 9 HELD (UNDERDOG, A PASSIVE): 3 MORE AT STAKE THAN 6
	assert.equal(value(9, "all-or-nothing-epic"), value(0, "all-or-nothing-epic")); // THE EPIC VERSION STAKES NO CARD
});

test("Card Guy goes on with a card duel while the next hand is worth its risk", async () => {
	let went = 0;
	for (let seed = 1; seed <= 12; seed++) {
		let s = newGame({ cardGuy: "w", level: 2400, seed });
		Object.assign(s.players.w, { moves: s.players.w.moves.slice(0, 3), actives: [hand.newCard(s, "all-or-nothing-legendary")], passive: null }); // THE PIECE ISN'T AT STAKE, AND ONLY 3 CARDS ARE
		const pawn = s.board.sq.find((q) => q && q.c === "w" && q.t === "p").id;
		s = applyAction(s, "w", { type: "active", card: s.players.w.actives[0].id, target: { piece: pawn } }).state;
		for (let i = 0; i < 60 && s.duel; i++) {
			const c = owes(s), a = c === "w" ? (await ask(s, "w", { seed: seed * 100 + i })).action : legalActions(s, "b")[0];
			if (c === "w" && a.stop !== undefined) {
				assert.ok(duelValue(s, "w", s.duel.card, pawn) > 0);
				assert.equal(a.stop, false, "it stopped with a " + s.board.sq.find((q) => q && q.id === pawn).t); // A KNIGHT, BISHOP OR ROOK HAS A STEP LEFT: HALF ITS GAIN IS MORE THAN HALF OF 3 CARDS
				went++;
			}
			s = applyAction(s, c, a).state;
		}
		assert.equal(s.duel, null);
	}
	assert.ok(went >= 3, went + " decisions");
});

test("a chance outcome is scored by its mean over 8 guessed states", async (t) => {
	const { register } = require("../../../cards-engine/cards/index.js"), statuses = require("../../../cards-engine/statuses.js");
	register({ // A COIN FLIP: HALF THE TIME IT WARDS A PAWN (LAST IN THE FILE: THE CARD STAYS REGISTERED)
		key: "card-guy-test-coin", kind: "active", name: "Coin", skulls: 0, rarity: "common", text: "", targets: () => [null],
		play(ctx, player) { if (ctx.rng.next() < 0.5) statuses.give(ctx, ctx.state.board.sq.find((q) => q && q.c === player && q.t === "p").id, "warded", 3); },
	});
	const s = newGame({ cardGuy: "w", level: 2400, seed: 12 });
	s.players.w.actives = [hand.newCard(s, "card-guy-test-coin")];
	const spy = t.mock.method(engine, "fromView");
	let scored, coin;
	for (let seed = 1; seed <= 12 && !(coin && coin.samples > 1); seed++) { // THE FIRST TWO GUESSES MUST DISAGREE FOR THE REST TO BE ASKED: HALF THE SEEDS
		spy.mock.resetCalls();
		scored = await scoreTurn(playerView(s, "w"), opts({ evaluate: async () => 0, seed }));
		coin = scored.find((c) => c.action.type === "active");
	}
	assert.equal(coin.samples, 8);
	assert.equal(new Set(spy.mock.calls.map((c) => c.arguments[1])).size, 8);
	assert.ok(coin.total > 0 && coin.total < WEIGHTS.warded && coin.total % (WEIGHTS.warded / 8) === 0, "total " + coin.total); // SOME OF THE 8 WARDED, SOME DIDN'T
	assert.ok(scored.filter((c) => c !== coin).every((c) => c.samples === 1));
});

test("under the player's Fog of War a sampled card is scored on the same guessed board as the plain moves (the first guess), only its card score is averaged", async () => {
	const s = newGame({ cardGuy: "w", level: 2400, seed: 12 }); // THE Coin OF THE TEST ABOVE
	s.players.w.actives = [hand.newCard(s, "card-guy-test-coin")];
	fogUp(s, "b");
	const view = playerView(s, "w");
	assert.ok(view.board.hidden > 0);
	const worth = (fen) => [...fen.split(" ")[0]].reduce((sum, ch, i) => sum + ch.charCodeAt(0) * (i + 1), 0); // EVERY GUESSED PLACING HAS ITS OWN
	let checked = 0;
	for (let seed = 1; seed <= 12; seed++) {
		const seen = [];
		const coin = (await scoreTurn(view, opts({ seed, evaluate: async (fen) => { seen.push(worth(fen)); return worth(fen); } }))).find((c) => c.action.type === "active");
		const now = worth(toFen(engine.fromView(view, seed)));
		if (coin.samples === 1 || !seen.includes(now)) { continue; } // THE FIRST TWO GUESSES AGREED, OR THE GUESSED BOARD IS NO CHESS POSITION
		const card = coin.total - now; // THE COIN MOVES NO PIECE: ITS BOARD IS THE BOARD NOW, ON THE FIRST GUESS
		assert.ok(card >= 0 && card <= WEIGHTS.warded && card % (WEIGHTS.warded / 8) === 0, "seed " + seed + ": card score " + card);
		assert.ok(seen.length <= MAX_EVALS);
		checked++;
	}
	assert.ok(checked > 0, "no seed sampled the coin");
});

test("Card Guy keeps a dead rare, epic or legendary active, and Cleanse; a dead common or uncommon one goes", async () => {
	const s = newGame({ cardGuy: "w", level: 1300, seed: 3 });
	s.players.w.moves = ["p", "m"].map((piece) => hand.newCard(s, "move", { piece })); // BOTH HAVE A MOVE: NO PAIR TO DISCARD
	const turn = async (key) => {
		s.players.w.actives = [hand.newCard(s, key)];
		assert.ok(!legalActions(s, "w").some((a) => a.type === "active"), key + " has a play at the start");
		return (await cardGuyTurn(playerView(s, "w"), 1300, opts())).type;
	};
	for (const key of ["last-stand"]) assert.equal(await turn(key), "discard", key); // UNCOMMON (HEAVY CAVALRY WAS THE OTHER: EPIC NOW; NO OTHER COMMON OR UNCOMMON ACTIVE IS DEAD AT THIS START)
	for (const key of ["cleanse", "cleanse-rare", "conscription"]) assert.notEqual(await turn(key), "discard", key); // CLEANSE (COMMON), RARE, LEGENDARY
	for (const sq of ["b1", "g1"]) s.board.sq[engine.board.sqIndex(sq)] = null; // NO KNIGHT: HEAVY CAVALRY (EPIC) IS DEAD, AND KEPT
	s.players.w.actives = [hand.newCard(s, "heavy-cavalry")];
	assert.ok(!legalActions(s, "w").some((a) => a.type === "active"), "heavy-cavalry has a play with no knight");
	const r = await cardGuyTurn(playerView(s, "w"), 1300, opts());
	assert.ok(r.type !== "discard" || !r.cards.includes(s.players.w.actives[0].id), "heavy-cavalry thrown out: " + JSON.stringify(r)); // A DEAD MOVE CARD MAY GO (THE m CARD, NO KNIGHT NOW), NEVER THE EPIC
});

test("an active that can pay Leech or Shackles isn't dead: Card Guy doesn't throw it out for nothing", async () => {
	for (const key of ["shackles", "leech"]) {
		const s = newGame({ cardGuy: "w", level: 1300, seed: 3 });
		s.players.w.moves = ["p", "m"].map((piece) => hand.newCard(s, "move", { piece }));
		s.players.w.actives = [hand.newCard(s, "last-stand")]; // NO PLAY AT THE START
		s.players.w.curses = [hand.newCard(s, key)];
		const active = s.players.w.actives[0].id;
		assert.ok(legalActions(s, "w").some((a) => a.type === "clear" && a.discard === active));
		assert.notEqual((await cardGuyTurn(playerView(s, "w"), 1300, opts())).type, "discard", key);
	}
});

test("a refused free discard with nothing else to do on Card Guy's guess: no other discard is offered, it says it has no action", async () => {
	const s = position("k7/8/8/8/8/8/PP6/KB6 w - - 0 1"); // WHITE'S KING BOXED IN BY ITS OWN HEXED PIECES: 5 DEAD MOVE CARDS, 10 PAIRS
	for (const sq of ["a2", "b2", "b1"]) s.statuses[s.board.sq[engine.board.sqIndex(sq)].id] = [{ s: "hexed", left: 2, by: "b" }];
	Object.assign(s.players.w, { moves: ["p", "m", "p", "m", "p"].map((piece) => hand.newCard(s, "move", { piece })), actives: [], passive: null });
	fogUp(s, "b");
	const view = playerView(s, "w"), refused = [];
	let discards = 0, error = null;
	while (!error && refused.length <= 8) { // AS cardsController AND balance.js ASK: AGAIN WITH EACH REFUSED KEY, 8 TIMES
		try {
			const a = await cardGuyTurn(view, 2400, opts({ refused }));
			assert.equal(a.type, "discard");
			discards++;
			refused.push(actionKey(a));
		} catch (err) { error = err; }
	}
	assert.equal(discards, 1, discards + " free discards offered after the first was refused");
	assert.match(error.message, /no action/);
});

/* ---------------------------------------------------------------- */
// The waiting passives
/* ---------------------------------------------------------------- */
/**
 * @description A new game, White (Card Guy) to move, with White's waiting passives [key, placedAt] pushed in the order given and held in its hand. Returns { s, ids: the waiting cards' ids in that order }
 */
function waiting(list, held, { level = 2400, fen } = {}) {
	const s = fen ? position(fen, { cardGuy: "w", level, seed: 3 }) : newGame({ cardGuy: "w", level, seed: 3 });
	const ids = list.map(([key, placedAt]) => { const card = hand.newCard(s, key); s.effects.push({ id: card.id, owner: "w", card, placedAt }); return card.id; });
	s.players.w.passive = held ? hand.newCard(s, held) : null;
	return { s, ids };
}

test("Card Guy with 3 passives waiting and a rarer one in hand drops the weakest, the oldest of a tie, then places the new one", async () => {
	for (const level of [600, 1300, 2400]) {
		const { s, ids } = waiting([["witness", 2], ["hex", 0], ["patience", 1]], "underdog", { level }); // COMMON, UNCOMMON, COMMON; A RARE IN HAND. THE OLDER COMMON IS PATIENCE
		const held = s.players.w.passive.id, turn = (st) => cardGuyTurn(playerView(st, "w"), level, opts({ legal: engine.playerLegal(st, "w") }));
		const drop = await turn(s);
		assert.deepEqual(drop, { type: "drop", card: ids[2] }, level + ": the older common");
		const dropped = applyAction(s, "w", drop).state;
		assert.equal(dropped.board.turn, "w"); // FREE
		const placed = await turn(dropped);
		assert.deepEqual(placed, { type: "passive" }, level + ": then the new one");
		const after = applyAction(dropped, "w", placed);
		assert.deepEqual(after.state.effects.filter((e) => e.owner === "w").map((e) => e.id).sort(), [ids[0], ids[1], held].sort());
		assert.ok(!after.events.some((e) => e.type === "card-dropped")); // NOTHING REPLACED
	}
	const { s, ids } = waiting([["underdog", 0], ["patience", 1], ["veto", 2]], "hex"); // RARE, COMMON, RARE; AN UNCOMMON IN HAND: RARER THAN THE WEAKEST IS ENOUGH
	assert.deepEqual(await cardGuyTurn(playerView(s, "w"), 2400, opts()), { type: "drop", card: ids[1] });
});

test("Card Guy keeps his waiting passives otherwise: no rarer one in hand, fewer than 3 waiting, in check; and never places a fourth over the oldest", async () => {
	const never = async (s, why) => {
		for (const level of [600, 2400]) for (const seed of [1, 2, 3, 4]) {
			let st = s;
			for (let n = 0; n < 4 && st.board.turn === "w" && !st.result; n++) { // THE WHOLE TURN, ITS FREE DISCARDS TOO
				const a = await cardGuyTurn(playerView(st, "w"), level, opts({ seed }));
				assert.notEqual(a.type, "drop", why);
				if (st.effects.filter((e) => e.owner === "w").length >= 3) assert.notEqual(a.type, "passive", why);
				st = applyAction(st, "w", a).state;
			}
		}
	};
	const same = waiting([["witness", 0], ["hex", 1], ["patience", 2]], "spite"); // A COMMON IN HAND, THE WEAKEST WAITING IS COMMON
	assert.ok(legalActions(same.s, "w").some((a) => a.type === "passive") && legalActions(same.s, "w").some((a) => a.type === "drop"));
	assert.ok(!candidates(engine.fromView(playerView(same.s, "w"), 1), "w").some((a) => a.type === "passive" || a.type === "drop"));
	await never(same.s, "no rarer one in hand");
	await never(waiting([["hex", 0], ["underdog", 1], ["veto", 2]], "patience").s, "a weaker one in hand");
	await never(waiting([["witness", 0], ["patience", 1], ["spite", 2]], null).s, "none in hand");
	const two = waiting([["witness", 0], ["patience", 1]], "underdog");
	await never(two.s, "2 waiting");
	assert.ok(candidates(engine.fromView(playerView(two.s, "w"), 1), "w").some((a) => a.type === "passive")); // WITH ROOM IT IS STILL SCORED
	const checked = waiting([["witness", 0], ["hex", 1], ["patience", 2]], "underdog", { fen: "4k3/8/8/8/8/8/4r3/4K3 w - - 0 1" }); // IN CHECK NO PASSIVE IS PLACED: NO DROP FOR ONE
	assert.ok(legalActions(checked.s, "w").some((a) => a.type === "drop") && !legalActions(checked.s, "w").some((a) => a.type === "passive"));
	await never(checked.s, "in check");
});

test("Card Guy skips the swap on a turn where his search's move mates or wins material: he plays it and keeps his passives", async () => {
	for (const [fen, why] of [["6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1", "a mate in one"], ["q5k1/8/8/8/8/8/8/R3K3 w - - 0 1", "a free queen"]]) {
		const { s } = waiting([["witness", 2], ["hex", 0], ["patience", 1]], "underdog", { fen });
		Object.assign(s.players.w, { moves: [hand.newCard(s, "move", { piece: "r" })], actives: [] });
		assert.ok(legalActions(s, "w").some((a) => a.type === "passive") && legalActions(s, "w").some((a) => a.type === "drop"));
		const a = await cardGuyTurn(playerView(s, "w"), 2400, opts({ legal: engine.playerLegal(s, "w") }));
		assert.deepEqual([a.type, a.from, a.to], ["move", "a1", "a8"], why);
		assert.equal(applyAction(s, "w", a).state.effects.filter((e) => e.owner === "w").length, 3, why);
	}
});

test("Card Guy drops for the swap only when the list he is told holds the placing: checked by a fogged piece he keeps his passives", async () => {
	const { s } = waiting([["witness", 0], ["hex", 1], ["patience", 2]], "underdog", { fen: "k7/8/4r3/8/8/8/8/4K3 w - - 0 1" });
	fogUp(s, "b");
	const legal = engine.playerLegal(s, "w");
	assert.ok(legal.some((a) => a.type === "drop") && !legal.some((a) => a.type === "passive"));
	const { action } = await ask(s, "w", {});
	assert.notEqual(action.type, "drop");
});
