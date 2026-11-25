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
const { player, peek, poke, engineCalls, dataServiceWillWait, dataServiceWillStall, dataServiceWillAnswer } = testServer;
const { timeouts } = require("../dataClient.js");
const E = require("../../cards-engine/index.js");
const hand = require("../../cards-engine/hand.js");
const { fromFen, sqIndex } = require("../../cards-engine/board.js");
const { AI_MOVE_LIMITS } = require("../middleware/rateLimit.js");

let server, me;
before(async () => { server = await testServer.start(); });
after(() => server.close());
beforeEach(() => { testServer.reset(); process.env.CARDS_TEST_SEED = "1"; me = player("me"); }); // ONE KNOWN DEAL: A RANDOM ONE NOW AND THEN HAS NO FIRST MOVE, OR A CARD GUY CARD THAT ANSWERS A MATE

const call = (method, path, options = {}) => testServer.call(method, path, options.as || options.guest || options.cookie ? options : { ...options, as: me }); // SIGNED IN AS me UNLESS TOLD: GUESTS CAN'T PLAY CHESS CARDS (#491)

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

test("a signed in player starts a card game and gets a view without hidden information", async () => {
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

	const again = await load(created.game_id);
	assert.equal(again.http, 200);
	assert.deepEqual(pick(again), pick(created));

	const black = await start({ start_color: "b", ai_level: 1600 }, { as: player("second") });
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

for (const old of [E.ENGINE_VERSION - 1, 1]) test("a state from an older engine version (" + old + ") is refused with 409", async () => { // 1: THE FIRST RELEASE'S GAMES, DIRECTLY (D10)
	const created = await start();
	const before = stored(created.game_id);
	store(created.game_id, { ...before, v: old });

	const refused = await act(created.game_id, firstMove(before, "w"));
	assert.equal(refused.http, 409);
	assert.equal(refused.message, "This game is from an older version");
	assert.equal(refused.view, undefined);
	assert.equal(refused.game_id, created.game_id); // THE PAGE CAN OFFER TO FORFEIT IT
	assert.equal((await load(created.game_id)).http, 409);
	assert.equal((await call("POST", `/api/chess/cards/${created.game_id}/card-guy`)).http, 409);
	assert.equal(version(created.game_id), "1");
});

for (const old of [E.ENGINE_VERSION - 1, 1]) test("a FINISHED game from an older engine version (" + old + ") opens read-only: its result and stored board, no view; action and card-guy still 409 (RE-I1, ruling C1)", async () => {
	const created = await start();
	const before = stored(created.game_id), action = firstMove(before, "w");
	assert.equal((await call("POST", `/api/chess/game/${created.game_id}/forfeit`)).http, 200);
	store(created.game_id, { ...before, v: old, board: "NOT A BOARD THIS ENGINE READS" }); // THE ENGINE'S VIEW MUST NOT RUN ON IT
	const fen = peek("chess_db", created.game_id).game_board.S;

	const { http, retry_after, ...body } = await load(created.game_id);
	assert.equal(http, 200);
	assert.deepEqual(body, { status: 200, game_id: created.game_id, older: true, you: "w", fen, result: { winner: "b", reason: "forfeit" }, message: "This game is from an older version" });
	const refused = await act(created.game_id, action);
	assert.deepEqual([refused.http, refused.message, refused.view], [409, "This game is from an older version", undefined]);
	assert.equal((await call("POST", `/api/chess/cards/${created.game_id}/card-guy`)).http, 409);

	poke("chess_db", created.game_id, { winner: { S: "draw" }, reason: { S: "fifty" } }); // THE DATA SERVICE'S DRAW IS "draw", A RESPONSE'S IS null
	assert.deepEqual((await load(created.game_id)).result, { winner: null, reason: "fifty" });
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
	process.env.CARDS_TEST_SEED = "3"; // ENGINE 3 (TASK 25b): SEED 1 NOW DEALS BOTH SIDES THE SAME ACTIVE, SO CARD GUY HIDES NO KEY OF HIS OWN; SEED 3 DEALS HIM HEAVY CAVALRY
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
	bodies.forEach(function (body, i) {
		const text = JSON.stringify(body);
		assert.equal(body.http, 200, text.slice(0, 80));
		assert.ok(!text.includes("cards_state"));
		assert.ok(!text.includes('"rng"'));
		assert.ok(!text.includes(state.rng.key.join(",")));
		if (i < 6) { for (const key of hidden) { assert.ok(!text.includes(`"${key}"`), key); } } // THE LAST: THE FORFEITED GAME, WHICH SHOWS CARD GUY'S HAND (USER RULING 2026-11-21 03:12)
	});
	const over = JSON.stringify(bodies[6]);
	for (const key of hidden) { assert.ok(over.includes(`"${key}"`), "a finished game shows " + key); }
});

test("the seed is random hex, an integer only from CARDS_TEST_SEED, never from the request", async () => {
	delete process.env.CARDS_TEST_SEED;
	const random = await start({ seed: 5 });
	assert.notDeepEqual(stored(random.game_id).rng.key.slice(1), [0, 0, 0, 0, 0, 0, 0]); // A HEX SEED FILLS EVERY WORD
	process.env.CARDS_TEST_SEED = "7";
	const fixed = await start({ seed: 5 }, { as: player("second") });
	assert.deepEqual(stored(fixed.game_id), E.newGame({ cardGuy: "b", level: 1300, seed: 7 })); // THE SAME GAME AS THE ENGINE MAKES FROM 7
});

test("CARDS_TEST_SEED deals one known game anywhere but production (a dev server too, and an unset NODE_ENV)", async () => {
	const opening = (state) => ["w", "b"].map((c) => ({ king: state.players[c].king, moves: state.players[c].moves, actives: state.players[c].actives }));
	const seven = opening(E.newGame({ cardGuy: "b", level: 1300, seed: 7 }));
	assert.deepEqual(seven.map((p) => [p.king, p.moves.length, p.actives.length]), [[true, 5, 1], [true, 5, 1]]); // THE KING CARD, 5 MOVE CARDS, 1 ACTIVE
	process.env.CARDS_TEST_SEED = "7";
	try {
		for (const env of ["test", "development", undefined]) {
			if (env === undefined) { delete process.env.NODE_ENV; } else { process.env.NODE_ENV = env; }
			const first = await start({}, { as: player(env + "-1") }), second = await start({}, { as: player(env + "-2") });
			assert.deepEqual(opening(stored(first.game_id)), seven, String(env));
			assert.deepEqual(opening(stored(second.game_id)), seven, String(env));
		}
		process.env.NODE_ENV = "production";
		const live = await start({}, { as: player("live") });
		assert.equal(live.http, 200);
		assert.notDeepEqual(opening(stored(live.game_id)), seven);
	} finally { process.env.NODE_ENV = "test"; }
});

test("CARDS_TEST_SEED is ignored in production, and when it isn't a whole number", async () => {
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
		const odd = await start({}, { as: player("odd" + i) });
		assert.equal(odd.http, 200, bad); // NOT A 500 FROM A SEED THE ENGINE REFUSES
		assert.notDeepEqual(stored(odd.game_id).rng.key.slice(1), [0, 0, 0, 0, 0, 0, 0]);
	}
});

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

test("a finished game's answer shows Card Guy's whole hand, a hidden Trapdoor and the last action's events in full, by mate and by forfeit; a game still on shows none of them (user ruling 2026-11-21)", async () => {
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

test("the catalog names only registered card keys: a string like \"constructor\" in the view is not one (M6)", async () => {
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
	const C = require("../../cards-engine/cards/index.js").CARDS;
	const face = (k) => ({ name: C[C[k].base || k].name, kind: C[k].kind, text: C[k].text, skulls: C[k].skulls, rarity: C[k].rarity });
	assert.deepEqual(r.catalog, { "fog-of-war-rare": face("fog-of-war-rare"), veto: face("veto") });
	assert.equal(r.catalog["fog-of-war-rare"].name, "Fog of War"); // A VERSION SHOWS ITS BASE CARD'S NAME, IN ITS OWN RARITY
	assert.equal(r.catalog["fog-of-war-rare"].rarity, "rare");
	const played = await act(gameId, { type: "active", card: state.players.w.actives[0].id });
	assert.ok(played.catalog["fog-of-war-rare"], "the played card, now only in the events and the enchantment");
	assert.ok(Object.keys(played.catalog).every((k) => JSON.stringify([played.view, played.events]).includes(`"${k}"`)));
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
	await Promise.all(Array.from({ length: AI_MOVE_LIMITS.aiMoveSession.burst }, () => call("POST", `/api/chess/cards/${created.game_id}/card-guy`))); // AT ONCE: A SIGNED IN REQUEST IS SLOWER, ONE BY ONE THE BUCKET REFILLS A TOKEN
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


test("a guest can't start a card game: 401, nothing created, no cookie, their other game untouched (B1, #491)", async () => {
	const chess = await call("POST", "/api/chess/game", { body: { start_color: "w" }, guest: "mixed" });
	assert.equal(chess.http, 200);
	dataServiceWillAnswer("/games/cards", 400, "a create reached the data service"); // LEFT FOR THE NEXT CREATE IF THE GUEST'S NEVER ASKED
	const { http, retry_after, ...body } = await start({}, { guest: "mixed" });
	assert.equal(http, 401);
	assert.deepEqual(body, { status: 401, message: "Sign in to play Chess Cards" });
	assert.equal(peek("chess_db", chess.game_id).state.S, "OPEN");
	assert.equal((await call("GET", `/api/chess/game/${chess.game_id}`, { guest: "mixed" })).http, 200); // THE COOKIE STILL NAMES IT: NONE WAS SET
	const bare = await testServer.send("POST", "/api/chess/cards", {}, { headers: { Origin: new URL(require("../config.js").clientUrl).origin, "Content-Type": "application/json" }, body: "{}" });
	assert.deepEqual([bare.http, bare.cookies.guest_game], [401, undefined]);
	assert.equal((await start()).message, "a create reached the data service"); // THE QUEUED ANSWER WAS STILL WAITING: NO GUEST CREATE ASKED
});

test("replace_current whose forfeit fails answers 503 and creates nothing; a forfeit refused because the game was already over goes on (RD-M5, ruling C7)", async () => {
	const old = await start();
	dataServiceWillAnswer(`/games/${old.game_id}/forfeit`, 503, "Service unavailable"); // THE FORFEIT FAILS ONCE, THE GAME STAYS OPEN
	dataServiceWillAnswer("/games/cards", 400, "a create reached the data service");
	const { http, retry_after, ...body } = await start({ replace_current: true });
	assert.equal(http, 503);
	assert.deepEqual(body, { status: 503, message: "Your other game couldn't be closed. Try again." });
	assert.equal(peek("chess_db", old.game_id).state.S, "OPEN");
	const home = await call("GET", "/api/chess/user/me");
	assert.deepEqual(home.open_game_list.map((g) => g.game_id), [old.game_id]); // STILL THE ONE OPEN AI GAME
	assert.equal((await start({}, { as: player("other") })).message, "a create reached the data service"); // NO CREATE WAS ASKED

	dataServiceWillAnswer(`/games/${old.game_id}/forfeit`, 403, "Player is not in this game"); // A REFUSAL THAT ISN'T "ALREADY OVER": THE RE-READ SHOWS IT OPEN
	assert.equal((await start({ replace_current: true })).http, 503);
	assert.equal(peek("chess_db", old.game_id).state.S, "OPEN");

	dataServiceWillAnswer(`/games/${old.game_id}/forfeit`, 503, "Service unavailable"); // F5-M1: THE FORFEIT FAILS & THE RE-READ SHOWS NO GAME AT ALL (REFUSED): NOT KNOWN CLOSED, SO NOTHING IS MADE
	dataServiceWillAnswer(`/games/${old.game_id}`, 403, "Player is not in this game");
	assert.equal((await start({ replace_current: true })).http, 503);
	assert.equal(peek("chess_db", old.game_id).state.S, "OPEN");
	assert.equal((await call("GET", "/api/chess/user/me")).ai_game_id, old.game_id); // F5-M3: THE PLAYER'S OPEN AI GAME IS STILL THE OLD ONE

	dataServiceWillAnswer(`/games/${old.game_id}/forfeit`, 503, "Service unavailable"); // F5-M2: THE RE-READ IS DOWN TOO: STILL THIS ROUTE'S OWN LINE, NOTHING MADE
	dataServiceWillAnswer(`/games/${old.game_id}`, 503, "Service unavailable");
	const down = await start({ replace_current: true });
	assert.deepEqual([down.http, down.message], [503, "Your other game couldn't be closed. Try again."]);
	assert.equal(peek("chess_db", old.game_id).state.S, "OPEN");

	dataServiceWillStall(`/games/${old.game_id}/forfeit`); // THE FORFEIT LANDS, ITS ANSWER TIMES OUT: THE RE-READ SHOWS IT CLOSED, NOT A FAILURE
	const saved = timeouts.POST;
	timeouts.POST = 300;
	let fresh;
	try { fresh = await start({ replace_current: true }); } finally { timeouts.POST = saved; }
	assert.equal(fresh.http, 200);
	assert.notEqual(fresh.game_id, old.game_id);
	assert.equal(peek("chess_db", old.game_id).reason.S, "forfeit");
});

test("a stored state that can't be read answers 500 with the server's own message, and nothing of the state", async (t) => {
	const logged = t.mock.method(console, "error", () => {});
	const created = await start();
	poke("chess_db", created.game_id, { cards_state: { S: "{\"board\":" } });
	const broken = await load(created.game_id);
	assert.equal(broken.http, 500);
	assert.equal(broken.error, "Something went wrong on our side.");
	assert.ok(!JSON.stringify(broken).includes("board") && !("view" in broken));
	assert.ok(logged.mock.calls.some((c) => c.arguments[0] instanceof Error)); // serverError.js LOGS THE ERROR ITSELF (logServerErrors LOGS THE 500 TOO, AS TEXT: RE-M1)
	assert.equal((await act(created.game_id, { type: "discard", cards: ["c1", "c2"] })).http, 500);
});

test("Play AI over an open card game whose forfeit fails answers 503 and creates nothing (RD-M5's other direction, user ruling 2026-11-25)", async () => {
	const old = await start();
	dataServiceWillAnswer(`/games/${old.game_id}/forfeit`, 503, "Service unavailable");
	const { http, retry_after, ...body } = await call("POST", "/api/chess/game", { body: { start_color: "w", replace_current: true } });
	assert.equal(http, 503);
	assert.deepEqual(body, { status: 503, message: "Your other game couldn't be closed. Try again." });
	assert.equal(peek("chess_db", old.game_id).state.S, "OPEN");
	assert.equal((await call("GET", "/api/chess/user/me")).ai_game_id, old.game_id);
	const next = await call("POST", "/api/chess/game", { body: { start_color: "w", replace_current: true } }); // THE FORFEIT WORKS NOW
	assert.equal(next.http, 200);
	assert.equal(peek("chess_db", old.game_id).state.S, "CLOSED");
});

test("Restart of an open Play AI game whose forfeit fails answers 503 and creates nothing (closing M2, RD-M5 again)", async () => {
	const old = await call("POST", "/api/chess/game", { body: { start_color: "w", ai_level: 4 } });
	dataServiceWillAnswer(`/games/${old.game_id}/forfeit`, 503, "Service unavailable");
	const { http, retry_after, ...body } = await call("POST", `/api/chess/game/${old.game_id}/restart`);
	assert.equal(http, 503);
	assert.deepEqual(body, { status: 503, message: "This game couldn't be closed. Try again." });
	assert.equal(peek("chess_db", old.game_id).state.S, "OPEN");
	assert.equal((await call("GET", "/api/chess/user/me")).ai_game_id, old.game_id);
	const next = await call("POST", `/api/chess/game/${old.game_id}/restart`); // THE FORFEIT WORKS NOW
	assert.equal(next.http, 200);
	assert.notEqual(next.game_id, old.game_id);
	assert.equal(peek("chess_db", old.game_id).state.S, "CLOSED");
});
