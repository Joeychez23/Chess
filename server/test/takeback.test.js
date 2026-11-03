/*
 *  takeback.test.js  --  chess server tests
 *	AI Game Takebacks (POST /api/chess/game/:gameId/takeback)
 *  A takeback gives back the game as it was before the player's last move, the AI's reply goes with it
 *
 */

require("./helpers/env.js");
const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { Chess } = require("chess.js");
const { latestOpening } = require("../utils/openings.js");
const testServer = require("./helpers/server.js");
const { call, player, peek, engineWillPlay, engineCalls } = testServer;

const START = new Chess().fen();
const alice = player("alice");

let server;
before(async () => { server = await testServer.start(); });
after(() => server.close());
beforeEach(() => testServer.reset());

/* ---------------------------------------------------------------- */
// Helpers
/* ---------------------------------------------------------------- */

const newGame = async (body = {}) => (await call("POST", "/api/chess/game", { as: alice, body: { start_color: "w", ...body } })).game_id;
const load = (gameId) => call("GET", `/api/chess/game/${gameId}`, { as: alice });
const takeback = (gameId, as = alice) => call("POST", `/api/chess/game/${gameId}/takeback`, { as });

/**
 * @description The player's move, then the AI's reply
 */
async function turn(gameId, move, reply) {
	await call("PUT", `/api/chess/game/${gameId}`, { as: alice, body: { move } });
	engineWillPlay(...reply);
	return call("POST", `/api/chess/game/${gameId}/ai-move`, { as: alice });
}

/* ---------------------------------------------------------------- */
// Takeback
/* ---------------------------------------------------------------- */

describe("takeback", () => {
	test("takes back the AI's reply and the player's move, giving back the game from before them", async () => {
		const gameId = await newGame();
		await turn(gameId, ["e2", "e4"], ["e7", "e5"]);
		const before = await load(gameId);
		await turn(gameId, ["g1", "f3"], ["b8", "c6"]);

		const response = await takeback(gameId);
		assert.equal(response.status, 200, response.message);
		assert.deepEqual(response.moves, ["e4", "e5"]);
		assert.deepEqual(response.prev_move, ["e7", "e5"]);
		for (const field of ["game_board", "player_color", "opponent_color", "w_knight", "b_knight", "w_piece", "b_piece", "state", "ai", "start_params"]) {
			assert.deepEqual(response[field], before[field], field);
		}
		assert.equal((await load(gameId)).game_board, before.game_board);
	});

	test("takes back only the player's move when the AI hasn't replied, and the game plays on", async () => {
		const gameId = await newGame();
		await call("PUT", `/api/chess/game/${gameId}`, { as: alice, body: { move: ["e2", "e4"] } });

		const response = await takeback(gameId);
		assert.equal(response.status, 200, response.message);
		assert.equal(response.game_board, START);
		assert.deepEqual(response.moves, []);
		assert.deepEqual(response.prev_move, []);

		assert.equal((await call("PUT", `/api/chess/game/${gameId}`, { as: alice, body: { move: ["d2", "d4"] } })).status, 200);
	});

	test("a guest takes back their own game", async () => {
		await call("POST", "/api/chess/game", { body: { game_id: "guest1", start_color: "w" } });
		await call("PUT", "/api/chess/game/guest1", { body: { move: ["e2", "e4"] } });
		engineWillPlay("e7", "e5");
		await call("POST", "/api/chess/game/guest1/ai-move");

		const response = await call("POST", "/api/chess/game/guest1/takeback");
		assert.equal(response.status, 200, response.message);
		assert.equal(response.game_board, START);
		assert.equal(response.player_color, "w");
	});

	test("goes back to a set position, not the standard one", async () => {
		const fen = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
		const gameId = await newGame({ start_fen: fen });
		const before = await load(gameId);
		await turn(gameId, ["e1", "g1"], ["e8", "c8"]);

		const response = await takeback(gameId);
		assert.equal(response.status, 200, response.message);
		assert.equal(response.game_board, fen);
		for (const field of ["w_piece", "b_piece", "w_knight", "b_knight"]) { assert.equal(response[field], before[field], field); }
	});

	test("the opening goes back with the moves", async () => {
		const gameId = await newGame();
		await turn(gameId, ["e2", "e4"], ["c7", "c5"]);
		const sicilian = (await load(gameId)).opening;
		assert.equal(sicilian.name, "Sicilian Defense");
		await turn(gameId, ["g1", "f3"], ["d7", "d6"]);
		assert.notDeepEqual((await load(gameId)).opening, sicilian);

		assert.deepEqual((await takeback(gameId)).opening, sicilian);
		assert.deepEqual((await load(gameId)).opening, sicilian);

		const back = await takeback(gameId);
		assert.equal(back.opening, null);
		assert.equal(peek("chess_db", gameId).opening, undefined);
	});

	test("latestOpening keeps the last named position once the moves leave the book", () => {
		assert.equal(latestOpening([]), null);
		assert.equal(latestOpening(["e4", "c5", "a3", "a6", "a4", "a5", "Ra2", "Ra6"]).name, latestOpening(["e4", "c5", "a3"]).name);
	});
});

/* ---------------------------------------------------------------- */
// Refused
/* ---------------------------------------------------------------- */

describe("a refused takeback", () => {
	test("with nothing of the player's to take back", async () => {
		const gameId = await newGame();
		assert.equal((await takeback(gameId)).status, 409);

		const black = await call("POST", "/api/chess/game", { as: alice, body: { start_color: "b", replace_current: true } });
		engineWillPlay("e2", "e4");
		await call("POST", `/api/chess/game/${black.game_id}/ai-move`, { as: alice });
		assert.equal((await takeback(black.game_id)).status, 409);
		assert.deepEqual((await load(black.game_id)).moves, ["e4"]);
	});

	test("while the AI's move is being picked, which then lands", async () => {
		const gameId = await newGame();
		await call("PUT", `/api/chess/game/${gameId}`, { as: alice, body: { move: ["e2", "e4"] } });

		let answer;
		engineWillPlay("e7", "e5", undefined, new Promise((resolve) => { answer = resolve; }));
		const calls = engineCalls();
		const thinking = call("POST", `/api/chess/game/${gameId}/ai-move`, { as: alice });
		while (engineCalls() == calls) { await new Promise((resolve) => setTimeout(resolve, 5)); }

		const response = await takeback(gameId);
		assert.equal(response.status, 409);
		answer();
		assert.equal((await thinking).status, 200);
		assert.deepEqual((await load(gameId)).moves, ["e4", "e5"]);
	});

	test("for someone not in the game, a friend game or a closed game", async () => {
		const gameId = await newGame();
		await turn(gameId, ["e2", "e4"], ["e7", "e5"]);
		assert.equal((await takeback(gameId, player("mallory"))).status, 403);
		assert.equal((await call("POST", `/api/chess/game/${gameId}/takeback`)).status, 401); // NO SESSION OR GUEST COOKIE
		assert.deepEqual((await load(gameId)).moves, ["e4", "e5"]);

		const bob = player("bob");
		const invite = await call("POST", "/api/chess/invite", { as: alice, body: { opponent_email: bob.email, start_color: "w" } });
		await call("POST", `/api/chess/game/${invite.game_id}/accept`, { as: bob, body: {} });
		await call("PUT", `/api/chess/game/${invite.game_id}`, { as: alice, body: { move: ["e2", "e4"] } });
		assert.equal((await takeback(invite.game_id)).status, 500);
		assert.deepEqual((await load(invite.game_id)).moves, ["e4"]);

		await newGame({ replace_current: true });
		assert.equal((await load(gameId)).state, "CLOSED"); // THE NEW GAME FORFEITED IT
		assert.equal((await takeback(gameId)).status, 500);
		assert.deepEqual((await load(gameId)).moves, ["e4", "e5"]);
	});
});
