/*
 *  routes-play.test.js  --  chess server tests
 *	Chess Cards Routes (/api/chess/cards, server/controllers/cardsController.js): starting a card game, actions applied or refused, older engine versions, the routes a card game refuses, who may act, Home's lists, forfeit and the seed
 *  Real requests to the API, with the tables in memory (data-service/test/helpers/fakeDynamo.js) and the real rules engine (cards-engine/)
 *
 */

require("../../helpers/env.js");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { player, peek, poke, engineCalls, dataServiceWillWait } = require("../../helpers/server.js");
const E = require("../../../../cards-engine/index.js");
const { call, stored, store, version, start, act, load, firstMove, expected, pick } = require("../../helpers/routes.js");

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
	process.env.CARDS_TEST_SEED = "3"; // ENGINE 3: SEED 1 NOW DEALS BOTH SIDES THE SAME ACTIVE, SO CARD GUY HIDES NO KEY OF HIS OWN; SEED 3 DEALS HIM HEAVY CAVALRY
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
