/*
 *  takeback.test.js  --  chess server tests
 *	Takebacks (POST /api/chess/game/:gameId/takeback)
 *  A takeback gives back the game as it was before the player's last move, the reply goes with it. AI games right away, friend games with the opponent's OK
 *
 */

require("./helpers/env.js");
const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { Chess } = require("chess.js");
const { latestOpening } = require("../utils/openings.js");
const testServer = require("./helpers/server.js");
const { call, player, named, peek, engineWillPlay, engineCalls, listen } = testServer;

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

	test("for someone not in the game or a closed game", async () => {
		const gameId = await newGame();
		await turn(gameId, ["e2", "e4"], ["e7", "e5"]);
		assert.equal((await takeback(gameId, player("mallory"))).status, 403);
		assert.equal((await call("POST", `/api/chess/game/${gameId}/takeback`)).status, 401); // NO SESSION OR GUEST COOKIE
		assert.deepEqual((await load(gameId)).moves, ["e4", "e5"]);

		await newGame({ replace_current: true });
		assert.equal((await load(gameId)).state, "CLOSED"); // THE NEW GAME FORFEITED IT
		assert.equal((await takeback(gameId)).status, 500);
		assert.deepEqual((await load(gameId)).moves, ["e4", "e5"]);
	});
});

/* ---------------------------------------------------------------- */
// Friend Games
/* ---------------------------------------------------------------- */

describe("friend game takebacks", () => {
	let bob;
	beforeEach(() => { bob = player("bob"); }); // reset() FORGETS WHO CAN BE FOUND BY EMAIL

	/**
	 * @description An open friend game, Alice is white
	 */
	async function friendGame(body = {}) {
		const invite = await call("POST", "/api/chess/invite", { as: alice, body: { opponent_username: await named(bob), start_color: "w", ...body } });
		await call("POST", `/api/chess/game/${invite.game_id}/accept`, { as: bob, body: {} });
		return invite.game_id;
	}
	const move = (gameId, as, ...squares) => call("PUT", `/api/chess/game/${gameId}`, { as, body: { move: squares } });
	const seen = (gameId, as = alice) => call("GET", `/api/chess/game/${gameId}`, { as });

	test("the opponent accepts: only the requester's move goes back when they just moved, both boards are told", async () => {
		const gameId = await friendGame();
		const alicesTab = await listen(alice, gameId);
		const bobsTab = await listen(bob, gameId);
		const start = await seen(gameId);
		await move(gameId, alice, "e2", "e4");

		const asked = await takeback(gameId);
		assert.equal(asked.status, 200, asked.message);
		assert.equal(asked.requested, true);
		assert.equal(asked.opponent_name, "Bob");
		assert.deepEqual(await bobsTab.heard("takeback"), { game_id: gameId, player_id: "alice", state: "requested" });
		assert.deepEqual((await seen(gameId, bob)).moves, ["e4"]);
		assert.equal((await seen(gameId, bob)).takeback_request, "w");

		const accepted = await takeback(gameId, bob);
		assert.equal(accepted.status, 200, accepted.message);
		assert.equal(accepted.player_color, "b");
		assert.deepEqual(accepted.moves, []);
		assert.equal(accepted.takeback_request, null);
		assert.equal(accepted.takebacks_left, 2);
		for (const field of ["game_board", "w_knight", "b_knight", "w_piece", "b_piece", "prev_move"]) {
			assert.deepEqual((await seen(gameId))[field], start[field], field);
		}
		const told = await alicesTab.heard("takeback");
		assert.equal(told.state == "requested" || told.state == "accepted", true);
		await new Promise((resolve) => setTimeout(resolve, 50));
		assert.deepEqual(alicesTab.events.filter(({ event }) => event == "takeback").at(-1).data, { game_id: gameId, player_id: "bob", state: "accepted", game_board: start.game_board });
	});

	test("two moves go back when the opponent already replied, and the opening goes with them", async () => {
		const gameId = await friendGame();
		await move(gameId, alice, "e2", "e4");
		await move(gameId, bob, "e7", "e5");
		const before = await seen(gameId);
		await move(gameId, alice, "g1", "f3");
		await move(gameId, bob, "b8", "c6");

		assert.equal((await takeback(gameId)).requested, true);
		const accepted = await takeback(gameId, bob);
		assert.deepEqual(accepted.moves, ["e4", "e5"]);
		assert.equal(accepted.game_board, before.game_board);
		assert.deepEqual(accepted.opening, before.opening);
		assert.equal(new Chess(accepted.game_board).turn(), "w"); // THE REQUESTER'S TURN AGAIN
	});

	test("once per move: a declined request can't be asked again until the next move", async () => {
		const gameId = await friendGame();
		const alicesTab = await listen(alice, gameId);
		await move(gameId, alice, "e2", "e4");
		await takeback(gameId);

		assert.equal((await takeback(gameId)).requested, true); // A REPEATED PRESS CHANGES NOTHING
		const declined = await call("POST", `/api/chess/game/${gameId}/takeback/decline`, { as: bob });
		assert.equal(declined.declined, true);
		await new Promise((resolve) => setTimeout(resolve, 50));
		assert.equal(alicesTab.events.filter(({ event }) => event == "takeback").at(-1).data.state, "declined");
		assert.equal((await seen(gameId)).takeback_request, null);
		assert.deepEqual((await seen(gameId)).moves, ["e4"]);

		const again = await takeback(gameId);
		assert.equal(again.status, 409);
		assert.equal(again.message, "A takeback was already asked for this move");

		await move(gameId, bob, "e7", "e5");
		assert.equal((await takeback(gameId)).requested, true);
	});

	test("a new move cancels the request, and a later press isn't an accept", async () => {
		const gameId = await friendGame();
		await move(gameId, alice, "e2", "e4");
		await takeback(gameId);
		const moved = await move(gameId, bob, "e7", "e5");
		assert.equal(moved.status, 200, moved.message);
		assert.equal(moved.takeback_request, null);
		assert.equal(peek("chess_db", gameId).takeback_player_id, undefined);

		assert.equal((await call("POST", `/api/chess/game/${gameId}/takeback/decline`, { as: bob })).status, 409);
		assert.equal((await takeback(gameId, bob)).requested, true); // BOB'S OWN REQUEST
		assert.deepEqual((await seen(gameId)).moves, ["e4", "e5"]);
	});

	test("nothing to take back: before the player's first move", async () => {
		const gameId = await friendGame();
		assert.equal((await takeback(gameId)).status, 409);
		await move(gameId, alice, "e2", "e4");
		assert.equal((await takeback(gameId, bob)).message, "No moves to take back");
		assert.equal(peek("chess_db", gameId).takeback_player_id, undefined);
	});

	test("the requester can't accept their own, and only the asked player can decline", async () => {
		const gameId = await friendGame();
		await move(gameId, alice, "e2", "e4");
		await takeback(gameId);
		assert.equal((await call("POST", `/api/chess/game/${gameId}/takeback/decline`, { as: alice })).status, 409);
		assert.equal((await takeback(gameId, player("mallory"))).status, 403);
		assert.deepEqual((await seen(gameId)).moves, ["e4"]);
		assert.equal((await seen(gameId)).takeback_request, "w");
	});

	test("up to 3 per game, between both players", async () => {
		const gameId = await friendGame();
		for (let i = 0; i < 3; i++) {
			await move(gameId, alice, "e2", "e4");
			assert.equal((await takeback(gameId)).requested, true);
			const accepted = await takeback(gameId, bob);
			assert.equal(accepted.status, 200, accepted.message);
			assert.equal(accepted.takebacks_left, 2 - i);
		}
		await move(gameId, alice, "e2", "e4");
		const refused = await takeback(gameId);
		assert.equal(refused.status, 409);
		assert.equal(refused.message, "No takebacks left in this game");
		assert.deepEqual((await seen(gameId)).moves, ["e4"]);
	});

	test("the invite can turn them off, the invite shows it and a rematch keeps it", async () => {
		const gameId = await friendGame({ takebacks: 0 });
		const game = await seen(gameId);
		assert.equal(game.start_params.takebacks, 0);
		assert.equal(game.takebacks_left, 0);
		await move(gameId, alice, "e2", "e4");
		const refused = await takeback(gameId);
		assert.equal(refused.status, 409);
		assert.equal(refused.message, "Takebacks are off in this game");

		await call("POST", `/api/chess/game/${gameId}/forfeit`, { as: bob });
		await call("POST", `/api/chess/game/${gameId}/rematch`, { as: alice });
		const rematch = await call("POST", `/api/chess/game/${gameId}/rematch`, { as: bob });
		assert.equal((await seen(rematch.new_game_id)).start_params.takebacks, 0);
	});

	test("a closed game drops the request", async () => {
		const gameId = await friendGame();
		await move(gameId, alice, "e2", "e4");
		await takeback(gameId);
		await call("POST", `/api/chess/game/${gameId}/forfeit`, { as: bob });
		assert.equal((await seen(gameId)).takeback_request, null);
		assert.equal((await takeback(gameId, bob)).status, 500);
	});
});
