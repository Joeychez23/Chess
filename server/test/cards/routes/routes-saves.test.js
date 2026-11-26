/*
 *  routes-saves.test.js  --  chess server tests
 *	Chess Cards Routes (/api/chess/cards, server/controllers/cardsController.js): saves that answer late, time out or race, a second open game and replace_current, the AI move limits, guests refused, forfeits that fail and a stored state that can't be read
 *  Real requests to the API, with the tables in memory (data-service/test/helpers/fakeDynamo.js) and the real rules engine (cards-engine/)
 *
 */

require("../../helpers/env.js");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const testServer = require("../../helpers/server.js");
const { player, peek, poke, dataServiceWillWait, dataServiceWillStall, dataServiceWillAnswer } = testServer;
const { timeouts } = require("../../../dataClient.js");
const E = require("../../../../cards-engine/index.js");
const { AI_MOVE_LIMITS } = require("../../../middleware/rateLimit.js");
const { call, stored, store, version, start, act, load, firstMove, expected, pick } = require("../../helpers/routes.js");

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

test("a guest can't start a card game: 401, nothing created, no cookie, their other game untouched", async () => {
	const chess = await call("POST", "/api/chess/game", { body: { start_color: "w" }, guest: "mixed" });
	assert.equal(chess.http, 200);
	dataServiceWillAnswer("/games/cards", 400, "a create reached the data service"); // LEFT FOR THE NEXT CREATE IF THE GUEST'S NEVER ASKED
	const { http, retry_after, ...body } = await start({}, { guest: "mixed" });
	assert.equal(http, 401);
	assert.deepEqual(body, { status: 401, message: "Sign in to play Chess Cards" });
	assert.equal(peek("chess_db", chess.game_id).state.S, "OPEN");
	assert.equal((await call("GET", `/api/chess/game/${chess.game_id}`, { guest: "mixed" })).http, 200); // THE COOKIE STILL NAMES IT: NONE WAS SET
	const bare = await testServer.send("POST", "/api/chess/cards", {}, { headers: { Origin: new URL(require("../../../config.js").clientUrl).origin, "Content-Type": "application/json" }, body: "{}" });
	assert.deepEqual([bare.http, bare.cookies.guest_game], [401, undefined]);
	assert.equal((await start()).message, "a create reached the data service"); // THE QUEUED ANSWER WAS STILL WAITING: NO GUEST CREATE ASKED
});

test("replace_current whose forfeit fails answers 503 and creates nothing; a forfeit refused because the game was already over goes on", async () => {
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

	dataServiceWillAnswer(`/games/${old.game_id}/forfeit`, 503, "Service unavailable"); // THE FORFEIT FAILS & THE RE-READ SHOWS NO GAME AT ALL (REFUSED): NOT KNOWN CLOSED, SO NOTHING IS MADE
	dataServiceWillAnswer(`/games/${old.game_id}`, 403, "Player is not in this game");
	assert.equal((await start({ replace_current: true })).http, 503);
	assert.equal(peek("chess_db", old.game_id).state.S, "OPEN");
	assert.equal((await call("GET", "/api/chess/user/me")).ai_game_id, old.game_id); // THE PLAYER'S OPEN AI GAME IS STILL THE OLD ONE

	dataServiceWillAnswer(`/games/${old.game_id}/forfeit`, 503, "Service unavailable"); // THE RE-READ IS DOWN TOO: STILL THIS ROUTE'S OWN LINE, NOTHING MADE
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
	assert.ok(logged.mock.calls.some((c) => c.arguments[0] instanceof Error)); // serverError.js LOGS THE ERROR ITSELF (logServerErrors LOGS THE 500 TOO, AS TEXT)
	assert.equal((await act(created.game_id, { type: "discard", cards: ["c1", "c2"] })).http, 500);
});

test("Play AI over an open card game whose forfeit fails answers 503 and creates nothing", async () => {
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

test("Restart of an open Play AI game whose forfeit fails answers 503 and creates nothing", async () => {
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
