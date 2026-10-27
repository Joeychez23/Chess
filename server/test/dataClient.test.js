/*
 *  dataClient.test.js  --  chess server tests
 *	The Data Service Client (server/dataClient.js)
 *  When the data service is down, slow or refuses the signature, the player gets 503 "Try again in a moment" & nothing is half saved.
 *  Accepting an invite never costs the player their open game when the invite can't be accepted
 *
 */

require("./helpers/env.js");
const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const testServer = require("./helpers/server.js");
const { call, player, peek } = testServer;
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
