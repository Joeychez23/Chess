/*
 *  dataClient.test.js  --  chess server tests
 *	The Data Service Client (server/dataClient.js)
 *  When the data service is down, slow or refuses the signature, the player gets 503 "Try again in a moment" & nothing was seen saved.
 *  A write that saves but answers too late is read back: the player gets what was saved & the other player is told (#281).
 *  Accepting an invite never costs the player their open game when the invite can't be accepted
 *
 */

require("./helpers/env.js");
const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const testServer = require("./helpers/server.js");
const { call, player, peek, listen, dataServiceWillStall } = testServer;
const { timeouts } = require("../dataClient.js");
const config = require("../config");
const db = require("../../data-service/dynamoDB.js"); // THE DATA SERVICE'S OWN SAVES, TO SET UP A RACE

let server;
before(async () => { server = await testServer.start(); });
after(() => server.close());
beforeEach(() => testServer.reset());

/**
 * @description Runs fn with one config value changed, then puts it back
 */
async function withConfig(name, value, fn) {
	const saved = config[name];
	config[name] = value;
	try { return await fn(); } finally { config[name] = saved; }
}

/**
 * @description Alice's AI game with one move made, the game id
 */
async function aliceGame() {
	const alice = player("alice");
	const made = await call("POST", "/api/chess/game", { as: alice, body: { start_color: "w", ai_level: 3 } });
	return { alice, gameId: made.game_id };
}

/* ---------------------------------------------------------------- */
// Data Service Down
/* ---------------------------------------------------------------- */

describe("when the data service can't answer", () => {
	test("down: 503 Try again in a moment, and the game is as it was", async () => {
		const { alice, gameId } = await aliceGame();
		const before = peek("chess_db", gameId);
		const closed = http.createServer().listen(0, "127.0.0.1"); // A PORT NOTHING ANSWERS ON ONCE IT'S CLOSED
		await new Promise((resolve) => closed.once("listening", resolve));
		const deadUrl = `http://127.0.0.1:${closed.address().port}`;
		await new Promise((resolve) => closed.close(resolve));

		const moved = await withConfig("dataServiceUrl", deadUrl, () => call("PUT", `/api/chess/game/${gameId}`, { as: alice, body: { move: ["e2", "e4"] } }));
		assert.equal(moved.http, 503);
		assert.equal(moved.message, "Try again in a moment");
		assert.deepEqual(peek("chess_db", gameId), before);
		assert.equal((await call("PUT", `/api/chess/game/${gameId}`, { as: alice, body: { move: ["e2", "e4"] } })).status, 200); // BACK UP: THE MOVE GOES THROUGH
	});

	test("slower than 3 seconds counts as down", async () => {
		const { alice } = await aliceGame();
		const slow = http.createServer(() => { }).listen(0, "127.0.0.1"); // NEVER ANSWERS
		await new Promise((resolve) => slow.once("listening", resolve));
		try {
			const started = Date.now();
			const read = await withConfig("dataServiceUrl", `http://127.0.0.1:${slow.address().port}`, () => call("GET", "/api/chess/user/alice", { as: alice }));
			assert.equal(read.http, 503);
			assert.ok(Date.now() - started < 5000);
		} finally {
			slow.closeAllConnections();
			slow.close();
		}
	});

	test("a wrong DATA_SERVICE_SECRET is a setup problem: 503, not a refusal the player sees", async () => {
		const { alice, gameId } = await aliceGame();
		const read = await withConfig("dataServiceSecret", "a-different-secret-0123456789abcdef-xyz", () => call("GET", `/api/chess/game/${gameId}`, { as: alice }));
		assert.equal(read.http, 503);
	});
});

/* ---------------------------------------------------------------- */
// Saved, But Answered Too Late
/* ---------------------------------------------------------------- */

/**
 * @description Runs fn with writes timing out after 300 ms, then puts it back
 */
async function withShortWrites(fn) {
	const saved = timeouts.POST;
	timeouts.POST = 300;
	try { return await fn(); } finally { timeouts.POST = saved; }
}

/**
 * @description Alice (white) & Bob's open friend game, the game id
 */
async function friendGame() {
	const [alice, bob] = ["alice", "bob"].map(player);
	const invite = await call("POST", "/api/chess/invite", { as: alice, body: { opponent_email: bob.email, start_color: "w" } });
	await call("POST", `/api/chess/game/${invite.game_id}/accept`, { as: bob, body: {} });
	return { alice, bob, gameId: invite.game_id };
}

describe("a write that saves but answers too late", () => {
	test("a move: the player gets the saved board and the opponent's board and Home are told", async () => {
		const { alice, bob, gameId } = await friendGame();
		const bobsTab = await listen(bob, gameId);
		dataServiceWillStall(`/games/${gameId}/move`);

		const moved = await withShortWrites(() => call("PUT", `/api/chess/game/${gameId}`, { as: alice, body: { move: ["e2", "e4"] } }));
		assert.equal(moved.http, 200);
		assert.equal(moved.message, "Validation Successful");
		assert.equal(moved.game_board, peek("chess_db", gameId).game_board.S);
		assert.match(moved.game_board, / b /); // BLACK'S TURN
		assert.deepEqual(await bobsTab.heard("move"), { game_id: gameId, player_id: "alice" });
		assert.deepEqual(await bobsTab.heard("games"), { game_id: gameId });
	});

	test("a move that didn't save is still 503", async () => {
		const { alice, gameId } = await friendGame();
		dataServiceWillStall(`/games/${gameId}/move`);
		const moved = await withShortWrites(() => call("PUT", `/api/chess/game/${gameId}`, { as: alice, body: { move: ["e2", "e5"] } })); // NOT LEGAL, NOTHING SAVES
		assert.equal(moved.http, 503);
	});

	test("a forfeit: the opponent's board opens the menu", async () => {
		const { alice, bob, gameId } = await friendGame();
		const bobsTab = await listen(bob, gameId);
		dataServiceWillStall(`/games/${gameId}/forfeit`);

		const forfeited = await withShortWrites(() => call("POST", `/api/chess/game/${gameId}/forfeit`, { as: alice }));
		assert.equal(forfeited.http, 200);
		assert.equal(forfeited.winner, "b");
		assert.equal((await bobsTab.heard("game-over")).winner, "b");
	});

	test("an accept: the player gets the open game and the inviter's Home is told", async () => {
		const [alice, bob] = ["alice", "bob"].map(player);
		const invite = await call("POST", "/api/chess/invite", { as: alice, body: { opponent_email: bob.email, start_color: "w" } });
		const alicesTab = await listen(alice);
		dataServiceWillStall(`/games/${invite.game_id}/accept`);

		const accepted = await withShortWrites(() => call("POST", `/api/chess/game/${invite.game_id}/accept`, { as: bob, body: {} }));
		assert.equal(accepted.http, 200);
		assert.equal(accepted.state, "OPEN");
		assert.deepEqual(await alicesTab.heard("games"), { game_id: invite.game_id });
	});

	test("a rematch: the press that started it gets the new game and the other board loads it", async () => {
		const { alice, bob, gameId } = await friendGame();
		await call("POST", `/api/chess/game/${gameId}/forfeit`, { as: alice });
		const alicesTab = await listen(alice, gameId);
		await call("POST", `/api/chess/game/${gameId}/rematch`, { as: alice });
		dataServiceWillStall(`/games/${gameId}/rematch`);

		const pressed = await withShortWrites(() => call("POST", `/api/chess/game/${gameId}/rematch`, { as: bob }));
		assert.equal(pressed.http, 200);
		assert.equal(pressed.new_game_id, peek("chess_db", gameId).rematch_game_id.S);
		assert.deepEqual(await alicesTab.heard("rematch"), { game_id: gameId, new_game_id: pressed.new_game_id });
	});

	test("a first rematch press: waiting", async () => {
		const { alice, gameId } = await friendGame();
		await call("POST", `/api/chess/game/${gameId}/forfeit`, { as: alice });
		dataServiceWillStall(`/games/${gameId}/rematch`);
		const pressed = await withShortWrites(() => call("POST", `/api/chess/game/${gameId}/rematch`, { as: alice }));
		assert.equal(pressed.http, 200);
		assert.equal(pressed.waiting, true);
	});
});

/* ---------------------------------------------------------------- */
// Accepting An Invite
/* ---------------------------------------------------------------- */

describe("accepting an invite", () => {
	test("an inviter in another friend game: the invite is dropped and the player keeps their own game", async () => {
		const [alice, bob, carol] = ["alice", "bob", "carol"].map(player);
		const invite = await call("POST", "/api/chess/invite", { as: alice, body: { opponent_email: bob.email, start_color: "w" } });
		const bobsGame = await call("POST", "/api/chess/invite", { as: carol, body: { opponent_email: bob.email, start_color: "w" } });
		await call("POST", `/api/chess/game/${bobsGame.game_id}/accept`, { as: bob, body: {} }); // BOB PLAYS CAROL (ALICE'S INVITE WAITS)
		await db.initalizeGame("race1", "alice", "dave", false, { start_params: { color: "w" }, inviter_id: "dave" }); // ALICE STARTED ANOTHER FRIEND GAME A MOMENT AGO (ACCEPTING ONE CANCELS HER INVITE, SO ONLY A RACE GETS HERE)

		const accepted = await call("POST", `/api/chess/game/${invite.game_id}/accept`, { as: bob, body: { replace_current: true } });
		assert.equal(accepted.message, "They're in another game now");
		assert.equal(peek("chess_db", bobsGame.game_id).state.S, "OPEN"); // NOT FORFEITED
		assert.equal(peek("chess_db", invite.game_id), undefined); // THE INVITE IS DROPPED
	});

	test("with replace_current the open friend game is forfeited and the new one starts", async () => {
		const [alice, bob, carol] = ["alice", "bob", "carol"].map(player);
		const invite = await call("POST", "/api/chess/invite", { as: alice, body: { opponent_email: bob.email, start_color: "w" } });
		const bobsGame = await call("POST", "/api/chess/invite", { as: carol, body: { opponent_email: bob.email, start_color: "w" } });
		await call("POST", `/api/chess/game/${bobsGame.game_id}/accept`, { as: bob, body: {} });

		const open = await call("POST", `/api/chess/game/${invite.game_id}/accept`, { as: bob, body: {} });
		assert.equal(open.status, 409);
		assert.equal(open.game_id, bobsGame.game_id);
		const accepted = await call("POST", `/api/chess/game/${invite.game_id}/accept`, { as: bob, body: { replace_current: true } });
		assert.equal(accepted.state, "OPEN");
		assert.equal(peek("chess_db", bobsGame.game_id).winner.S, "w"); // CAROL (WHITE) WINS THE FORFEIT
	});
});
