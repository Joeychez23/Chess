/*
 *  cardsRoutes.test.js  --  chess server tests
 *	Chess Cards Routes (/api/chess/cards, server/controllers/cardsController.js)
 *  Real requests to the API, with the tables in memory (data-service/test/helpers/fakeDynamo.js) and the real rules engine (cards-engine/)
 *
 */

require("./helpers/env.js");
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const testServer = require("./helpers/server.js");
const { call, player, peek, poke, engineCalls, dataServiceWillWait, dataServiceWillStall } = testServer;
const { timeouts } = require("../dataClient.js");
const E = require("../../cards-engine/index.js");
const hand = require("../../cards-engine/hand.js");
const { fromFen, sqIndex } = require("../../cards-engine/board.js");
const { AI_MOVE_LIMITS } = require("../middleware/rateLimit.js");

let server;
before(async () => { server = await testServer.start(); });
after(() => server.close());
beforeEach(() => { testServer.reset(); process.env.CARDS_TEST_SEED = "1"; }); // ONE KNOWN DEAL: A RANDOM ONE NOW AND THEN HAS NO FIRST MOVE, OR A CARD GUY CARD THAT ANSWERS A MATE

const stored = (gameId) => JSON.parse(peek("chess_db", gameId).cards_state.S);
const store = (gameId, state) => poke("chess_db", gameId, { cards_state: { S: JSON.stringify(state) } });
const version = (gameId) => peek("chess_db", gameId).cards_version.N;
const start = (body = {}, options = {}) => call("POST", "/api/chess/cards", { ...options, body: { start_color: "w", ...body } });
const act = (gameId, action, options = {}) => call("POST", `/api/chess/cards/${gameId}/action`, { ...options, body: { action } });
const load = (gameId, options = {}) => call("GET", `/api/chess/cards/${gameId}`, options);
const firstMove = (state, color) => {
	const move = E.legalActions(state, color).find((a) => a.type === "move");
	assert.ok(move, "this deal has no move for " + color); // NEVER undefined: A TEST WOULD SEND NO ACTION
	return move;
};

/**
 * @description What a response must hold for color on this state (the stored game still open)
 */
function expected(state, color, events = []) {
	const cardGuy = color === "w" ? "b" : "w";
	return { mode: "cards", you: color, view: E.playerView(state, color), legal: E.playerLegal(state, color), legal_hidden: state.enchant.some((e) => e.key.startsWith("fog-of-war") && e.owner === cardGuy), events: E.playerEvents(state, events, color), card_guy_due: E.legalActions(state, cardGuy).length > 0, result: state.result };
}

const pick = (response) => ({ mode: response.mode, you: response.you, view: response.view, legal: response.legal, legal_hidden: response.legal_hidden, events: response.events, card_guy_due: response.card_guy_due, result: response.result });

test("a guest starts a card game and gets a view without hidden information", async () => {
	const created = await start();
	assert.equal(created.http, 200);
	assert.equal(created.status, 200);
	assert.equal(created.ai_level, 1300);
	const item = peek("chess_db", created.game_id);
	assert.equal(item.mode.S, "cards");
	assert.equal(item.black_player_id.S, "CHESS_AI");
	const state = stored(created.game_id);
	assert.equal(state.v, E.ENGINE_VERSION);
	assert.equal(item.game_board.S, E.toFen(state));
	assert.deepEqual(pick(created), expected(state, "w"));
	assert.equal(created.view.rng, undefined);
	assert.deepEqual(Object.keys(created.view.players.b.hand), ["count", "shown"]);
	assert.equal(created.view.players.b.actives, undefined); // CARD GUY'S CARDS ARE ONLY A COUNT
	assert.ok(created.legal.length > 0);
	assert.equal(created.card_guy_due, false);

	const again = await load(created.game_id); // THE COOKIE: ONLY THIS BROWSER PLAYS IT
	assert.equal(again.http, 200);
	assert.deepEqual(pick(again), pick(created));

	const black = await start({ start_color: "b", ai_level: 1600 }, { guest: "second" });
	assert.equal(black.you, "b");
	assert.equal(black.ai_level, 1600);
	assert.equal(black.view.cardGuy, "w");
	assert.deepEqual(black.legal, []);
	assert.equal(black.card_guy_due, true); // CARD GUY IS WHITE, IT MOVES FIRST
	assert.equal(stored(black.game_id).level, 1600);
});

test("the sides the data service picks decide who Card Guy is", async () => {
	const alice = player("alice");
	await start({}, { as: alice }); // ALICE WAS WHITE LAST
	const alternate = await start({ start_color: "alternate", replace_current: true }, { as: alice }); // THE SERVER MADE THE STATE BEFORE THE SIDES WERE PICKED
	assert.equal(alternate.you, "b");
	assert.equal(alternate.view.cardGuy, "w");
	assert.equal(alternate.card_guy_due, true);
	const state = stored(alternate.game_id);
	store(alternate.game_id, { ...state, cardGuy: "b" });
	assert.equal((await load(alternate.game_id, { as: alice })).view.cardGuy, "w");
});

test("a legal action is applied and saved; the response holds the events", async () => {
	const created = await start();
	const before = stored(created.game_id);
	const action = firstMove(before, "w");
	const next = E.applyAction(before, "w", action);

	const moved = await act(created.game_id, action);
	assert.equal(moved.http, 200);
	assert.deepEqual(pick(moved), expected(next.state, "w", next.events));
	assert.ok(moved.events.some((e) => e.type === "move"));
	assert.deepEqual(stored(created.game_id), next.state);
	assert.equal(version(created.game_id), "2");
	assert.equal(peek("chess_db", created.game_id).game_board.S, E.toFen(next.state));
});

test("an action not in legal is refused with 409 and the state is unchanged", async () => {
	const created = await start();
	const before = stored(created.game_id);

	const refused = await act(created.game_id, { type: "move", from: "e2", to: "e5" });
	assert.equal(refused.http, 409);
	assert.equal(refused.message, "That action isn't available");
	assert.deepEqual(pick(refused), expected(before, "w")); // THE FRESH GAME, SO THE CLIENT CAN REDRAW
	for (const action of [undefined, null, "e2e4", ["move"], 7, { type: "x", pad: "y".repeat(3000) }]) { // NOT AN OBJECT, OR TOO BIG
		const bad = await act(created.game_id, action);
		assert.equal(bad.http, 400, JSON.stringify(action)?.slice(0, 40));
		assert.equal(bad.message, "Invalid action");
	}
	assert.deepEqual(stored(created.game_id), before);
	assert.equal(version(created.game_id), "1");
});

test("the same action sent twice: the second gets 409 with stale: true", async () => {
	const created = await start();
	const action = firstMove(stored(created.game_id), "w");

	const hold = dataServiceWillWait(`/games/${created.game_id}/cards`); // THE FIRST REQUEST READ THE GAME, THEN WAITS BEFORE ITS SAVE
	const first = act(created.game_id, action);
	await hold.reached;
	const second = await act(created.game_id, action); // READS THE SAME VERSION & SAVES FIRST
	assert.equal(second.http, 200);
	hold.release();
	const late = await first;
	assert.equal(late.http, 409);
	assert.equal(late.stale, true);
	assert.deepEqual(late.view, second.view); // THE SAVED GAME, READ AGAIN
	assert.deepEqual(late.events, []);
	assert.equal(version(created.game_id), "2");
});

test("a state from an older engine version is refused with 409", async () => {
	const created = await start();
	const before = stored(created.game_id);
	store(created.game_id, { ...before, v: E.ENGINE_VERSION - 1 });

	const refused = await act(created.game_id, firstMove(before, "w"));
	assert.equal(refused.http, 409);
	assert.equal(refused.message, "This game is from an older version");
	assert.equal(refused.view, undefined);
	assert.equal(refused.game_id, created.game_id); // THE PAGE CAN OFFER TO FORFEIT IT
	assert.equal((await load(created.game_id)).http, 409);
	assert.equal(version(created.game_id), "1");
});

test("a card game refuses the normal move, ai-move, takeback, draw, analysis, restart, rematch and pgn routes", async () => {
	const alice = player("alice");
	const created = await start({}, { as: alice });
	const gameId = created.game_id;
	const before = peek("chess_db", gameId);
	const routes = [["PUT", "", { move: ["e2", "e4"] }], ["POST", "/ai-move"], ["POST", "/takeback"], ["POST", "/draw"], ["POST", "/analysis"], ["POST", "/restart"], ["POST", "/rematch"], ["GET", "/pgn"]];
	for (const [method, path, body] of routes) {
		const refused = await call(method, `/api/chess/game/${gameId}${path}`, { as: alice, body });
		assert.equal(refused.http, 400, path);
		assert.equal(refused.message, "Use the Chess Cards routes", path);
	}
	assert.deepEqual(peek("chess_db", gameId), before);
	assert.equal(engineCalls(), 0);

	const game = await call("GET", `/api/chess/game/${gameId}`, { as: alice });
	assert.equal(game.mode, "cards");
	const chess = await call("POST", "/api/chess/game", { body: { start_color: "w" }, guest: "chess" });
	assert.equal((await call("GET", `/api/chess/game/${chess.game_id}`, { guest: "chess" })).mode, "chess");
	const notCards = await load(chess.game_id, { guest: "chess" }); // AND THE OTHER WAY ROUND
	assert.equal(notCards.http, 400);
	assert.equal(notCards.message, "Not a card game");
});

test("another guest's action on the game is refused and the state is unchanged", async () => {
	const created = await start();
	const before = stored(created.game_id);
	const action = firstMove(before, "w");

	const guest = await act(created.game_id, action, { guest: "other" }); // NO COOKIE FOR THIS GAME
	assert.equal(guest.http, 401);
	assert.equal((await load(created.game_id, { guest: "other" })).http, 401);
	const bob = player("bob");
	const signedIn = await act(created.game_id, action, { as: bob });
	assert.equal(signedIn.http, 403);
	assert.equal(signedIn.message, "Player is not in this game");
	assert.equal((await load(created.game_id, { as: bob })).http, 403);
	assert.equal((await call("POST", `/api/chess/cards/${created.game_id}/card-guy`, { guest: "other" })).http, 401);
	assert.equal((await load("no-such-game")).http, 404);
	assert.deepEqual(stored(created.game_id), before);
	assert.equal(version(created.game_id), "1");
});

test("Home's game lists say which games are card games, open and finished", async () => {
	const alice = player("alice");
	const chess = await call("POST", "/api/chess/game", { as: alice, body: { start_color: "w", ai_level: 4 } });
	assert.equal((await call("POST", `/api/chess/game/${chess.game_id}/forfeit`, { as: alice })).http, 200);
	const created = await start({}, { as: alice });
	const modes = (list) => list.map((game) => [game.game_id, game.mode]);

	let home = await call("GET", "/api/chess/user/alice", { as: alice });
	assert.deepEqual(modes(home.open_game_list), [[created.game_id, "cards"]]);
	assert.deepEqual(modes(home.closed_game_list), [[chess.game_id, "chess"]]);

	assert.equal((await call("POST", `/api/chess/game/${created.game_id}/forfeit`, { as: alice })).http, 200);
	home = await call("GET", "/api/chess/user/alice", { as: alice });
	assert.deepEqual(modes(home.open_game_list), []);
	assert.deepEqual(modes(home.closed_game_list).sort(), [[chess.game_id, "chess"], [created.game_id, "cards"]].sort());
});

test("forfeit closes a card game; the next GET has result forfeit and no legal actions; an action gets 409", async () => {
	const created = await start();
	const action = firstMove(stored(created.game_id), "w");
	assert.equal((await call("POST", `/api/chess/game/${created.game_id}/forfeit`)).http, 200);

	const closed = await load(created.game_id);
	assert.deepEqual(closed.result, { winner: "b", reason: "forfeit" });
	assert.deepEqual(closed.legal, []);
	assert.equal(closed.card_guy_due, false);
	const refused = await act(created.game_id, action);
	assert.equal(refused.http, 409);
	assert.equal(refused.message, "Game is already over");
	assert.deepEqual(refused.result, { winner: "b", reason: "forfeit" });
	assert.equal(version(created.game_id), "1");
});

test("no response body contains the seed, cards_state or a hidden Card Guy card key", async () => {
	const alice = player("alice");
	const created = await start({}, { as: alice });
	const gameId = created.game_id;
	const state = stored(gameId);
	const bodies = [created, await load(gameId, { as: alice }), await act(gameId, firstMove(state, "w"), { as: alice }),
		await call("GET", `/api/chess/game/${gameId}`, { as: alice }), await call("GET", `/api/chess/user/alice`, { as: alice }),
		await call("POST", `/api/chess/game/${gameId}/forfeit`, { as: alice }), await load(gameId, { as: alice })];
	const cardGuy = state.players.b, mine = state.players.w;
	const myKeys = new Set([...mine.moves, ...mine.actives, ...mine.curses].map((c) => c.key));
	const hidden = [...cardGuy.actives, ...cardGuy.curses, ...(cardGuy.passive ? [cardGuy.passive] : [])].filter((c) => !c.faceUp && !myKeys.has(c.key)).map((c) => c.key);
	assert.ok(hidden.length > 0); // CARD GUY IS DEALT AN ACTIVE
	for (const body of bodies) {
		const text = JSON.stringify(body);
		assert.equal(body.http, 200, text.slice(0, 80));
		assert.ok(!text.includes("cards_state"));
		assert.ok(!text.includes('"rng"'));
		assert.ok(!text.includes(state.rng.key.join(",")));
		for (const key of hidden) { assert.ok(!text.includes(`"${key}"`), key); }
	}
});

test("the seed is random hex, an integer only from CARDS_TEST_SEED, never from the request", async () => {
	delete process.env.CARDS_TEST_SEED;
	const random = await start({ seed: 5 });
	assert.notDeepEqual(stored(random.game_id).rng.key.slice(1), [0, 0, 0, 0, 0, 0, 0]); // A HEX SEED FILLS EVERY WORD
	process.env.CARDS_TEST_SEED = "7";
	const fixed = await start({ seed: 5 }, { guest: "second" });
	assert.deepEqual(stored(fixed.game_id), E.newGame({ cardGuy: "b", level: 1300, seed: 7 })); // THE SAME GAME AS THE ENGINE MAKES FROM 7
});

test("CARDS_TEST_SEED is ignored outside tests, and when it isn't a whole number", async () => {
	const seven = JSON.stringify(E.newGame({ cardGuy: "b", level: 1300, seed: 7 }));
	process.env.CARDS_TEST_SEED = "7";
	process.env.NODE_ENV = "production";
	try {
		const live = await start();
		assert.equal(live.http, 200);
		assert.notEqual(JSON.stringify(stored(live.game_id)), seven);
	} finally { process.env.NODE_ENV = "test"; }
	for (const [i, bad] of ["seven", "4294967296", "1.5"].entries()) { // NOT A WHOLE NUMBER THE ENGINE TAKES (0 .. 2^32 - 1)
		process.env.CARDS_TEST_SEED = bad;
		const odd = await start({}, { guest: "odd" + i });
		assert.equal(odd.http, 200, bad); // NOT A 500 FROM A SEED THE ENGINE REFUSES
		assert.notDeepEqual(stored(odd.game_id).rng.key.slice(1), [0, 0, 0, 0, 0, 0, 0]);
	}
});

/**
 * @description A stored card game on this FEN (pieces numbered in board order), White holding these move cards; returns { gameId, state }
 */
async function position(fen, pieces, change = () => {}) {
	const created = await start(), state = stored(created.game_id), n = { w: 1, b: 1 };
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
});

test("a save that answers too late: the player still gets the action's events, the game saved once", async () => {
	const created = await start();
	const before = stored(created.game_id), action = firstMove(before, "w"), next = E.applyAction(before, "w", action);
	dataServiceWillStall(`/games/${created.game_id}/cards`);
	const saved = timeouts.PUT;
	timeouts.PUT = 300;
	try {
		const moved = await act(created.game_id, action);
		assert.equal(moved.http, 200);
		assert.deepEqual(pick(moved), expected(next.state, "w", next.events));
	} finally { timeouts.PUT = saved; }
	assert.equal(version(created.game_id), "2");
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

test("a second open AI or card game follows the existing 409 / replace_current rules", async () => {
	const alice = player("alice");
	const chess = await call("POST", "/api/chess/game", { as: alice, body: { start_color: "w" } });
	const refused = await start({}, { as: alice });
	assert.equal(refused.http, 409);
	assert.equal(refused.game_id, chess.game_id);
	assert.equal(refused.message, "AI game already open");

	const cards = await start({ replace_current: true }, { as: alice });
	assert.equal(cards.http, 200);
	assert.equal(peek("chess_db", chess.game_id).state.S, "CLOSED");
	assert.equal(peek("chess_db", chess.game_id).reason.S, "forfeit");

	const again = await call("POST", "/api/chess/game", { as: alice, body: { start_color: "w" } });
	assert.equal(again.http, 409);
	assert.equal(again.game_id, cards.game_id);
	const second = await start({}, { as: alice });
	assert.equal(second.http, 409);
	assert.equal(second.game_id, cards.game_id);
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

test("card actions & Card Guy's turns take from the AI move limits", async () => {
	const created = await start();
	const action = firstMove(stored(created.game_id), "w");
	for (let i = 0; i < AI_MOVE_LIMITS.aiMoveSession.burst; i++) { await call("POST", `/api/chess/cards/${created.game_id}/card-guy`); }
	const limited = await act(created.game_id, action);
	assert.equal(limited.http, 429);
	assert.ok(limited.retry_after);
	assert.equal(version(created.game_id), "1");
});

test("GET /card-guy is its own route, not a game id", async () => {
	const answer = await call("GET", "/api/chess/cards/card-guy");
	assert.equal(answer.http, 200);
	assert.equal(answer.name, "Card Guy");
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

test("a second action on the same game saves on the version the first one made", async () => {
	const created = await start();
	const before = stored(created.game_id), action = firstMove(before, "w");
	assert.equal((await act(created.game_id, action)).http, 200);
	store(created.game_id, before); // THE PLAYER'S TURN AGAIN (THE STORED VERSION STAYS 2)
	assert.equal((await act(created.game_id, action)).http, 200);
	assert.equal(version(created.game_id), "3");
});

test("a forfeited game owes nothing from Card Guy, also when it was Card Guy's turn", async () => {
	const created = await start({ start_color: "b" });
	assert.equal(created.card_guy_due, true);
	assert.equal((await call("POST", `/api/chess/game/${created.game_id}/forfeit`)).http, 200);
	const closed = await load(created.game_id);
	assert.deepEqual([closed.card_guy_due, closed.legal, closed.result], [false, [], { winner: "w", reason: "forfeit" }]);
});

test("a save that timed out and didn't land answers 503, not the action's events", async () => {
	const created = await start();
	const action = firstMove(stored(created.game_id), "w");
	const hold = dataServiceWillWait(`/games/${created.game_id}/cards`); // THE SAVE NEVER REACHES THE DATA SERVICE IN TIME
	const saved = timeouts.PUT;
	timeouts.PUT = 200;
	try {
		const lost = act(created.game_id, action);
		await hold.reached;
		await new Promise((resolve) => setTimeout(resolve, 300)); // PAST THE TIMEOUT
		hold.release();
		const answer = await lost;
		assert.equal(answer.http, 503);
		assert.equal(answer.events, undefined);
	} finally { timeouts.PUT = saved; }
	assert.equal(version(created.game_id), "1");
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
	const run = async (key, owner, guest) => {
		const created = await start({}, { guest });
		const state = stored(created.game_id);
		state.enchant.push({ id: "e1", key, owner, pieces: [], left: 3, data: {} });
		store(created.game_id, state);
		const board = peek("chess_db", created.game_id).game_board.S;
		assert.equal((await act(created.game_id, firstMove(state, "w"), { guest })).http, 200);
		const now = peek("chess_db", created.game_id).game_board.S;
		assert.notEqual(E.toFen(stored(created.game_id)), board); // THE MOVE CHANGED THE BOARD
		return now === board;
	};
	assert.equal(await run("fog-of-war-rare", "b", "one"), true);
	assert.equal(await run("fog-of-war-epic", "b", "two"), true);
	assert.equal(await run("fog-of-war", "w", "three"), false);
});


test("a guest's new card game forfeits the game their cookie named (card or normal), an earlier one already over is left as it ended", async () => {
	const first = await start({}, { guest: "again" });
	const second = await start({}, { guest: "again" });
	assert.equal(second.http, 200);
	assert.notEqual(second.game_id, first.game_id);
	assert.equal(peek("chess_db", first.game_id).reason.S, "forfeit"); // NOT LEFT OPEN UNTIL ITS TTL
	assert.equal(peek("chess_db", first.game_id).winner.S, first.you == "w" ? "b" : "w");
	assert.equal(peek("chess_db", second.game_id).reason, undefined);
	assert.equal((await load(second.game_id, { guest: "again" })).http, 200);
	assert.equal((await call("POST", `/api/chess/game/${second.game_id}/forfeit`, { guest: "again" })).http, 200);
	const third = await start({}, { guest: "again" }); // THE COOKIE'S GAME IS OVER ALREADY: THE REFUSED FORFEIT STOPS NOTHING
	assert.equal(third.http, 200);
	assert.equal(peek("chess_db", third.game_id).reason, undefined);
	const chess = await call("POST", "/api/chess/game", { body: { start_color: "w" }, guest: "mixed" });
	assert.equal((await start({}, { guest: "mixed" })).http, 200);
	assert.equal(peek("chess_db", chess.game_id).reason.S, "forfeit");
});

test("a stored state that can't be read answers 500 with the server's own message, and nothing of the state", async (t) => {
	const logged = t.mock.method(console, "error", () => {});
	const created = await start();
	poke("chess_db", created.game_id, { cards_state: { S: "{\"board\":" } });
	const broken = await load(created.game_id);
	assert.equal(broken.http, 500);
	assert.equal(broken.error, "Something went wrong on our side.");
	assert.ok(!JSON.stringify(broken).includes("board") && !("view" in broken));
	assert.ok(logged.mock.callCount() >= 1); // THE HANDLER LOGS THE ERROR (logServerErrors LOGS THE 500 TOO)
	assert.equal((await act(created.game_id, { type: "discard", card: "c1" })).http, 500);
});
