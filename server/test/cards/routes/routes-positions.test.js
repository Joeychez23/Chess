/*
 *  routes-positions.test.js  --  chess server tests
 *	Chess Cards Routes (/api/chess/cards, server/controllers/cardsController.js): games on a set position ending by mate, draw or forfeit, Card Guy's Fog of War and game_board, the catalog, a duel reloaded and redacted events
 *  Real requests to the API, with the tables in memory (data-service/test/helpers/fakeDynamo.js) and the real rules engine (cards-engine/)
 *
 */

require("../../helpers/env.js");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { player, peek } = require("../../helpers/server.js");
const E = require("../../../../cards-engine/index.js");
const hand = require("../../../../cards-engine/hand.js");
const { fromFen, sqIndex } = require("../../../../cards-engine/board.js");
const { call, stored, store, version, start, act, load, firstMove } = require("../../helpers/routes.js");

/**
 * @description A stored card game on this FEN (pieces numbered in board order), White holding these move cards; returns { gameId, state }
 */
async function position(fen, pieces, change = () => {}) {
	const created = await start({ replace_current: true }), state = stored(created.game_id), n = { w: 1, b: 1 }; // A TEST MAY SET UP SEVERAL: me HAS ONE OPEN AT A TIME
	state.board = fromFen(fen);
	state.board.sq.forEach((q) => { if (q) q.id = q.c + n[q.c]++; });
	Object.assign(state.players.w, { moves: pieces.map((piece) => hand.newCard(state, "move", { piece })), actives: [], passive: null });
	Object.assign(state.players.b, { actives: [], passive: null, curses: [] }); // NO CARD GUY CARD ANSWERS A CHECK
	change(state);
	store(created.game_id, state);
	return { gameId: created.game_id, state };
}

test("an action that mates closes the game for the player: winner and reason saved, no legal actions, nothing owed by Card Guy", async () => {
	const { gameId, state } = await position("3rkr2/3p1p2/8/8/8/8/8/R5K1 w - - 0 1", ["r"]); // Ra1-e1 MATES
	const mated = await act(gameId, { type: "move", card: state.players.w.moves[0].id, from: "a1", to: "e1" });
	assert.equal(mated.http, 200);
	assert.deepEqual(mated.result, { winner: "w", reason: "checkmate" });
	assert.deepEqual([mated.legal, mated.card_guy_due], [[], false]);
	const item = peek("chess_db", gameId);
	assert.deepEqual([item.state.S, item.winner.S, item.reason.S], ["CLOSED", "w", "checkmate"]);
	assert.deepEqual((await load(gameId)).result, { winner: "w", reason: "checkmate" });
	assert.equal((await act(gameId, { type: "move", card: "king", from: "g1", to: "g2" })).message, "Game is already over");
});

test("an action that ends the game in a draw closes it as a draw", async () => {
	const { gameId, state } = await position("4k3/8/8/8/8/8/8/R3K3 w - - 99 80", ["r"], (s) => { s.board.history = []; }); // THE 100TH HALF-MOVE WITH NO CAPTURE OR PAWN MOVE
	const drawn = await act(gameId, { type: "move", card: state.players.w.moves[0].id, from: "a1", to: "a2" });
	assert.equal(drawn.http, 200);
	assert.deepEqual(drawn.result, { winner: null, reason: "fifty" });
	assert.deepEqual([drawn.legal, drawn.card_guy_due], [[], false]);
	const item = peek("chess_db", gameId);
	assert.deepEqual([item.state.S, item.winner.S, item.reason.S], ["CLOSED", "draw", "fifty"]);
	assert.deepEqual((await load(gameId)).result, { winner: null, reason: "fifty" });
});

test("a game that ends under Card Guy's Fog of War saves the real board: a finished game hides nothing", async () => {
	const { gameId, state } = await position("3rkr2/3p1p2/8/8/8/8/8/R5K1 w - - 0 1", ["r"], (s) => { s.enchant.push({ id: "e1", key: "fog-of-war", owner: "b", pieces: [], left: 3, data: {} }); });
	const mated = await act(gameId, { type: "move", card: state.players.w.moves[0].id, from: "a1", to: "e1" });
	assert.equal(mated.result.reason, "checkmate");
	assert.equal(peek("chess_db", gameId).game_board.S, E.toFen(stored(gameId)));
	assert.equal(E.toFen({ board: mated.view.board }), E.toFen(stored(gameId))); // THE TABLE DRAWS THE WHOLE BOARD
	assert.ok(!("hidden" in mated.view.board));
	const { gameId: lost, state: before } = await position("3rkr2/3p1p2/8/8/8/8/8/R5K1 w - - 0 1", ["r"], (s) => { s.enchant.push({ id: "e1", key: "fog-of-war", owner: "b", pieces: [], left: 3, data: {} }); });
	assert.equal((await call("POST", `/api/chess/game/${lost}/forfeit`)).http, 200);
	const over = await load(lost);
	assert.equal(E.toFen({ board: over.view.board }), E.toFen(before)); // FORFEITED UNDER FOG: THE WHOLE BOARD TOO
	assert.ok(!("hidden" in over.view.board));
});

test("a finished game's answer shows Card Guy's whole hand, a hidden Trapdoor and the last action's events in full, by mate and by forfeit; a game still on shows none of them", async () => {
	const fen = "3rkr2/3p1p2/8/8/R3n3/8/8/6K1 w - - 0 1"; // Ra4xe4 MATES, TAKING A KNIGHT
	const setup = (s) => { s.enchant.push({ id: "e1", key: "fog-of-war-rare", owner: "b", pieces: [], left: 3, data: {} }, { id: "e2", key: "trapdoor", owner: "b", pieces: [], left: null, data: { square: "h3" } }); };
	const handIds = (s) => [...s.players.b.moves, ...s.players.b.actives, ...(s.players.b.passive ? [s.players.b.passive] : []), ...s.players.b.curses].map((c) => c.id).sort();
	const trapdoor = (r) => r.view.enchant.find((e) => e.key === "trapdoor").data;
	const { gameId, state } = await position(fen, ["r"], setup), knight = state.board.sq.find((p) => p && p.t === "n").id;
	const on = await load(gameId);
	assert.deepEqual(on.view.players.b.hand.shown, []);
	assert.ok(!("square" in trapdoor(on)));
	const mated = await act(gameId, { type: "move", card: state.players.w.moves[0].id, from: "a4", to: "e4" });
	assert.equal(mated.result.reason, "checkmate");
	assert.deepEqual(mated.view.players.b.hand.shown.map((c) => c.id).sort(), handIds(stored(gameId)));
	assert.equal(trapdoor(mated).square, "h3");
	assert.deepEqual(mated.events.filter((e) => e.type === "capture").map((e) => [e.piece, e.t]), [[knight, "n"]]); // UNDER FOG WHILE ON: NO ID, "?"
	const { gameId: lost, state: before } = await position(fen, ["r"], setup);
	assert.equal((await call("POST", `/api/chess/game/${lost}/forfeit`)).http, 200);
	const over = await load(lost);
	assert.deepEqual(over.view.players.b.hand.shown.map((c) => c.id).sort(), handIds(before));
	assert.equal(trapdoor(over).square, "h3");
});

test("the catalog names only registered card keys: a string like \"constructor\" in the view is not one", async () => {
	const { gameId } = await position("4k3/8/8/8/8/8/8/R3K3 w - - 0 1", ["r"], (s) => { s.barred = "constructor"; }); // THE VIEW CARRIES barred AS IT IS
	const r = await load(gameId);
	assert.equal(r.view.barred, "constructor");
	assert.ok(!Object.hasOwn(r.catalog, "constructor"));
});

test("the response's catalog gives the name, kind, text, skulls and rarity of every card key in its view and events, and of no other", async () => {
	const { gameId, state } = await position("4k3/8/8/8/8/8/8/R3K3 w - - 0 1", ["r"], (s) => {
		s.players.w.actives = [hand.newCard(s, "fog-of-war-rare")];
		s.players.w.passive = hand.newCard(s, "veto");
	});
	const r = await load(gameId);
	const C = require("../../../../cards-engine/cards/index.js").CARDS;
	const face = (k) => ({ name: C[C[k].base || k].name, kind: C[k].kind, text: C[k].text, skulls: C[k].skulls, rarity: C[k].rarity });
	assert.deepEqual(r.catalog, { "fog-of-war-rare": face("fog-of-war-rare"), veto: face("veto") });
	assert.equal(r.catalog["fog-of-war-rare"].name, "Fog of War"); // A VERSION SHOWS ITS BASE CARD'S NAME, IN ITS OWN RARITY
	assert.equal(r.catalog["fog-of-war-rare"].rarity, "rare");
	const played = await act(gameId, { type: "active", card: state.players.w.actives[0].id });
	assert.ok(played.catalog["fog-of-war-rare"], "the played card, now only in the events and the enchantment");
	assert.ok(Object.keys(played.catalog).every((k) => JSON.stringify([played.view, played.events]).includes(`"${k}"`)));
});

test("game_board keeps its last value while Card Guy's Fog of War is up", async () => {
	const created = await start();
	const state = stored(created.game_id);
	state.enchant.push({ id: "e1", key: "fog-of-war", owner: "b", pieces: [], left: 3, data: {} });
	store(created.game_id, state);
	const board = peek("chess_db", created.game_id).game_board.S;
	const action = firstMove(state, "w");
	const next = E.applyAction(state, "w", action).state;
	assert.ok(next.enchant.some((e) => e.key === "fog-of-war" && e.owner === "b")); // STILL UP AFTER THE ACTION

	assert.equal((await act(created.game_id, action)).http, 200);
	assert.equal(version(created.game_id), "2");
	assert.deepEqual(stored(created.game_id), next);
	assert.equal(peek("chess_db", created.game_id).game_board.S, board);
	assert.equal((await call("GET", `/api/chess/game/${created.game_id}`)).game_board, board);
});

test("reloading mid-duel returns the duel exactly as it was", async () => {
	const created = await start();
	const state = E.newGame({ cardGuy: "b", level: 1300, seed: 1 });
	state.board = fromFen("4k3/8/8/8/4P3/8/8/4K3 w - - 0 1");
	const card = hand.newCard(state, "all-or-nothing");
	state.players.w.actives = [card];
	store(created.game_id, state);

	const opened = await act(created.game_id, { type: "active", card: card.id, target: { piece: state.board.sq[sqIndex("e4")].id } });
	assert.equal(opened.http, 200);
	assert.ok(opened.view.duel);
	assert.ok(opened.legal.length > 0);
	assert.equal(opened.card_guy_due, true); // BOTH PICK
	const reloaded = await load(created.game_id);
	assert.deepEqual(reloaded.view, opened.view);
	assert.deepEqual(reloaded.legal, opened.legal);
	assert.equal(reloaded.card_guy_due, true);
	assert.deepEqual(reloaded.events, []);
});

test("the events of an action reach the player redacted: Card Guy's hidden discards carry no card", async () => {
	const created = await start();
	const state = stored(created.game_id);
	state.players.b.curses.push(hand.newCard(state, "debt", { left: 0 })); // DUE AT CARD GUY'S NEXT TURN START: IT DISCARDS 2 OF ITS CARDS
	store(created.game_id, state);
	const action = firstMove(state, "w"), next = E.applyAction(state, "w", action);
	const gone = next.events.filter((e) => e.type === "discard" && e.player === "b").map((e) => e.card.id);
	assert.equal(gone.length, 2);

	const moved = await act(created.game_id, action);
	assert.equal(moved.http, 200);
	assert.deepEqual(moved.events, E.playerEvents(next.state, next.events, "w"));
	assert.notDeepEqual(moved.events, JSON.parse(JSON.stringify(next.events))); // THE RAW EVENTS NAME THE DISCARDED CARDS
	for (const id of gone) { assert.ok(!JSON.stringify(moved).includes(`"${id}"`), id); }
});

test("under Card Guy's Fog of War the response has no hidden piece and no move list, a legal move sent blind is taken and an illegal one refused", async () => {
	const fog = (s) => { s.enchant.push({ id: "e1", key: "fog-of-war-rare", owner: "b", pieces: [], left: 3, data: {} }); };
	const { gameId, state } = await position("3rkr2/3p1p2/8/8/8/8/8/R5K1 w - - 0 1", ["r", "r"], fog);
	const loaded = await call("GET", `/api/chess/cards/${gameId}`);
	assert.equal(loaded.legal_hidden, true);
	assert.ok(loaded.legal.length > 0 && loaded.legal.every((a) => a.type !== "move")); // DISCARDS STAY: THEY SHOW NOTHING
	assert.ok(loaded.view.board.sq.filter(Boolean).every((p) => p.c === "w"));
	assert.equal(loaded.view.board.hidden, 5);
	for (const p of state.board.sq.filter((q) => q && q.c === "b")) assert.ok(!JSON.stringify(loaded).replace(/"(square|from|to|ep|sq)":"[a-h][1-8]"/g, "").includes(`"${p.id}"`), p.id);
	const card = state.players.w.moves[0].id;
	const blocked = await act(gameId, { type: "move", card, from: "a1", to: "h1" }); // THROUGH ITS OWN KING: NOT LEGAL
	assert.equal(blocked.http, 409);
	assert.equal(blocked.message, "That action isn't available");
	const blind = await act(gameId, { type: "move", card, from: "a1", to: "a8" }); // LEGAL ON THE TRUE BOARD, NEVER LISTED
	assert.equal(blind.http, 200);
	assert.equal(stored(gameId).board.sq[0].t, "r");
	const open = await position("3rkr2/3p1p2/8/8/8/8/8/R5K1 w - - 0 1", ["r"]);
	const plain = await call("GET", `/api/chess/cards/${open.gameId}`);
	assert.equal(plain.legal_hidden, false);
	const { gameId: lost } = await position("3rkr2/3p1p2/8/8/8/8/8/R5K1 w - - 0 1", ["r"], fog);
	assert.equal((await call("POST", `/api/chess/game/${lost}/forfeit`)).http, 200);
	const over = await call("GET", `/api/chess/cards/${lost}`);
	assert.deepEqual([over.legal, over.legal_hidden], [[], false]); // OVER: NO LIST TO HIDE
	assert.deepEqual(plain.legal, E.legalActions(open.state, "w"));
	assert.ok(plain.legal.some((a) => a.type === "move"));
});

test("only Card Guy's Fog of War, in any version, holds game_board: the player's own fog doesn't", async () => {
	const run = async (key, owner, name) => {
		const guest = player(name), created = await start({}, { as: guest });
		const state = stored(created.game_id);
		state.enchant.push({ id: "e1", key, owner, pieces: [], left: 3, data: {} });
		store(created.game_id, state);
		const board = peek("chess_db", created.game_id).game_board.S;
		assert.equal((await act(created.game_id, firstMove(state, "w"), { as: guest })).http, 200);
		const now = peek("chess_db", created.game_id).game_board.S;
		assert.notEqual(E.toFen(stored(created.game_id)), board); // THE MOVE CHANGED THE BOARD
		return now === board;
	};
	assert.equal(await run("fog-of-war-rare", "b", "one"), true);
	assert.equal(await run("fog-of-war-epic", "b", "two"), true);
	assert.equal(await run("fog-of-war", "w", "three"), false);
});
