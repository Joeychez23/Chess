/*
 *  deadline.test.js  --  chess server tests
 *	Daily Games
 *  A friend game can give each move 1, 3 or 7 days. The player to move who runs out of time loses with reason timeout, the first read after the deadline closes the game
 *
 */

require("./helpers/env.js");
const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const testServer = require("./helpers/server.js");
const { timeLeftText } = require("../../client/src/js/pages/utils/timeLeft.js");
const { timeoutWinner } = require("../utils/games.js");
const { call, player, named, peek, poke, listen } = testServer;

const DAY = 24 * 60 * 60;
const alice = player("alice");

let server;
before(async () => { server = await testServer.start(); });
after(() => server.close());
beforeEach(() => testServer.reset());

describe("daily games", () => {
	let bob;
	beforeEach(() => { bob = player("bob"); }); // reset() FORGETS WHO CAN BE FOUND BY EMAIL

	const invite = async (body = {}) => call("POST", "/api/chess/invite", { as: alice, body: { opponent_username: await named(bob), start_color: "w", days_per_move: 1, ...body } });
	async function friendGame(body = {}) { // ALICE IS WHITE
		const sent = await invite(body);
		await call("POST", `/api/chess/game/${sent.game_id}/accept`, { as: bob, body: {} });
		return sent.game_id;
	}
	const move = (gameId, as, ...squares) => call("PUT", `/api/chess/game/${gameId}`, { as, body: { move: squares } });
	const seen = (gameId, as = alice) => call("GET", `/api/chess/game/${gameId}`, { as });
	const home = (as) => call("GET", `/api/chess/user/${as.id}`, { as });
	const deadlineOf = (gameId) => Number(peek("chess_db", gameId).move_deadline?.N);
	const runOut = (gameId) => poke("chess_db", gameId, { move_deadline: { N: String(Math.floor(Date.now() / 1000) - 1) } });
	const nearNow = (deadline, days) => assert.ok(Math.abs(deadline - (Date.now() / 1000 + days * DAY)) < 60, `${deadline} is ${days} days from now`);

	test("the clock starts when the invite is accepted, not when it's sent", async () => {
		const sent = await invite({ days_per_move: 3 });
		assert.equal(peek("chess_db", sent.game_id).move_deadline, undefined);
		await call("POST", `/api/chess/game/${sent.game_id}/accept`, { as: bob, body: {} });
		nearNow(deadlineOf(sent.game_id), 3);
		const game = await seen(sent.game_id);
		assert.equal(game.start_params.days_per_move, 3);
		assert.equal(game.move_deadline, deadlineOf(sent.game_id));
	});

	test("a game without a limit has no deadline", async () => {
		const gameId = await friendGame({ days_per_move: undefined });
		await move(gameId, alice, "e2", "e4");
		assert.equal(peek("chess_db", gameId).move_deadline, undefined);
		assert.equal((await seen(gameId)).move_deadline, null);
		assert.equal((await seen(gameId)).start_params.days_per_move, undefined);
	});

	test("anything but 1, 3 or 7 days is no limit from the chess server", async () => {
		const sent = await invite({ days_per_move: 2 });
		assert.equal((await seen(sent.game_id)).start_params.days_per_move, undefined);
	});

	test("every move gives the next player the full time", async () => {
		const gameId = await friendGame();
		poke("chess_db", gameId, { move_deadline: { N: String(Math.floor(Date.now() / 1000) + 60) } });
		await move(gameId, alice, "e2", "e4");
		nearNow(deadlineOf(gameId), 1);
	});

	test("white not moving for a day: both Homes show white lost with reason timeout", async () => {
		const gameId = await friendGame();
		await move(gameId, alice, "e2", "e4");
		await move(gameId, bob, "e7", "e5");
		runOut(gameId);

		const bobs = await home(bob); // NOBODY OPENED THE GAME
		assert.equal(bobs.friend_game_id, null);
		assert.deepEqual(bobs.open_game_list, []);
		assert.equal(bobs.closed_game_list[0].game_id, gameId);
		assert.equal(bobs.closed_game_list[0].winner, "b");
		assert.equal(bobs.closed_game_list[0].reason, "timeout");
		assert.notEqual(bobs.rating.rated_games, 0); // RATED LIKE ANY OTHER FINISHED GAME

		const alices = await home(alice);
		assert.deepEqual(alices.open_game_list, []);
		assert.equal(alices.closed_game_list[0].winner, "b");
		assert.equal(alices.closed_game_list[0].reason, "timeout");
	});

	test("loading the game closes it, once", async () => {
		const gameId = await friendGame();
		runOut(gameId);
		const game = await seen(gameId, bob);
		assert.equal(game.state, "CLOSED");
		assert.equal(game.winner, "b");
		assert.equal(game.reason, "timeout");
		assert.equal(game.move_deadline, null);
		assert.deepEqual((await seen(gameId)).reason, "timeout");
		assert.equal((await home(bob)).closed_game_list.length, 1);
	});

	test("a late move is refused & closes the game, the other side can't forfeit it away", async () => {
		const gameId = await friendGame();
		runOut(gameId);
		const late = await move(gameId, alice, "e2", "e4");
		assert.equal(late.http, 409);
		assert.equal(late.message, "Game is over");
		assert.equal((await call("POST", `/api/chess/game/${gameId}/forfeit`, { as: bob })).http, 409);
		const game = await seen(gameId);
		assert.equal(game.winner, "b");
		assert.deepEqual(game.moves, []);
	});

	test("the socket's join closes it & tells both boards & both Homes", async () => {
		const gameId = await friendGame();
		const bobTab = await listen(bob);
		const aliceTab = await listen(alice);
		assert.equal((await aliceTab.join(gameId)).state, "OPEN");
		runOut(gameId);
		const joined = await bobTab.join(gameId);
		assert.equal(joined.state, "CLOSED");
		assert.equal(joined.reason, "timeout");
		const over = await aliceTab.heard("game-over");
		assert.equal(over.winner, "b");
		assert.equal(over.reason, "timeout");
		assert.equal((await aliceTab.heard("games")).game_id, gameId);
		bobTab.disconnect();
		aliceTab.disconnect();
	});

	test("a rematch keeps the limit & starts its clock right away", async () => {
		const gameId = await friendGame({ days_per_move: 7 });
		runOut(gameId);
		await seen(gameId);
		await call("POST", `/api/chess/game/${gameId}/rematch`, { as: alice });
		const rematch = await call("POST", `/api/chess/game/${gameId}/rematch`, { as: bob });
		assert.equal((await seen(rematch.new_game_id)).start_params.days_per_move, 7);
		nearNow(deadlineOf(rematch.new_game_id), 7);
	});

	test("a challenge link's clock starts when the seat is taken", async () => {
		const link = await call("POST", "/api/chess/challenge", { as: alice, body: { start_color: "w", days_per_move: 3 } });
		assert.equal(peek("chess_db", link.game_id).move_deadline, undefined);
		await named(bob);
		await call("POST", `/api/chess/game/${link.game_id}/join`, { as: bob, body: {} });
		nearNow(deadlineOf(link.game_id), 3);
	});

	test("Home's rows have the deadline while the game is open", async () => {
		const gameId = await friendGame();
		assert.equal((await home(alice)).open_game_list[0].move_deadline, deadlineOf(gameId));
	});

	test("running out of time when the opponent can't checkmate is a draw", async () => {
		const drawn = await friendGame({ start_fen: "4k2n/8/8/8/8/8/1P6/4K3 w - - 0 1" });
		runOut(drawn); // WHITE TO MOVE, BLACK ONLY HAS A KNIGHT
		const game = await seen(drawn);
		assert.equal(game.winner, "draw");
		assert.equal(game.reason, "timeout");
	});
});

describe("timeoutWinner", () => {
	const winner = (fen) => timeoutWinner({ game_board: { S: fen } });
	test("the other side wins with mating material", () => {
		assert.equal(winner("4k3/8/8/8/8/8/1P6/4K3 b - - 0 1"), "w");
		assert.equal(winner("4k3/p7/8/8/8/8/8/4K3 w - - 0 1"), "b");
		assert.equal(winner("3qk3/8/8/8/8/8/P7/4K3 w - - 0 1"), "b");
		assert.equal(winner("2nnk3/8/8/8/8/8/P7/4K3 w - - 0 1"), "b");
	});
	test("a lone king or a king & one minor piece can't checkmate", () => {
		assert.equal(winner("4k3/8/8/8/8/8/P7/4K3 w - - 0 1"), "draw");
		assert.equal(winner("3bk3/8/8/8/8/8/P7/4K3 w - - 0 1"), "draw");
		assert.equal(winner("4k3/p7/8/8/8/8/8/4K2N b - - 0 1"), "draw");
	});
});

describe("timeLeftText", () => {
	const now = 1000 * 1000000;
	const left = (seconds) => timeLeftText(1000000 + seconds, now);
	test("reads in its two largest units", () => {
		assert.equal(left(2 * DAY + 3 * 3600 + 5), "2d 3h left");
		assert.equal(left(5 * 3600 + 10 * 60), "5h 10m left");
		assert.equal(left(12 * 60), "12m left");
		assert.equal(left(30), "Under a minute left");
		assert.equal(left(0), "Out of time");
		assert.equal(left(-5), "Out of time");
	});
});
