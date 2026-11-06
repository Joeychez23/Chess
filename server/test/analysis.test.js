/*
 *  analysis.test.js  --  chess server tests
 *	Hints & The Evaluation Bar (POST /api/chess/game/:gameId/analysis)
 *  The engine's best move & evaluation of a game's saved board. AI games & finished games only, cached by FEN, one request at a time per game
 *
 */

require("./helpers/env.js");
const { test, describe, before, after, beforeEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const { Chess } = require("chess.js");
const { analyzePosition, clearAnalyses } = require("../utils/ai.js");
const { ANALYSIS_LIMITS } = require("../middleware/rateLimit.js");
const testServer = require("./helpers/server.js");
const { call, player, named, engineWillPlay, engineWillScore, engineCalls } = testServer;

const START = new Chess().fen();
const STALEMATE = "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1";
const alice = player("alice");

let server;
before(async () => { server = await testServer.start(); });
after(() => server.close());
beforeEach(() => { testServer.reset(); clearAnalyses(); });

/* ---------------------------------------------------------------- */
// Helpers
/* ---------------------------------------------------------------- */

const newGame = async (as = alice) => (await call("POST", "/api/chess/game", { as, body: { start_color: "w" } })).game_id;
const analyze = (gameId, as = alice) => call("POST", `/api/chess/game/${gameId}/analysis`, { as });
const move = (gameId, squares, as = alice) => call("PUT", `/api/chess/game/${gameId}`, { as, body: { move: squares } });

/**
 * @description An answer the engine holds back until release() is called
 */
function heldAnswer() {
	let release;
	const wait = new Promise((resolve) => { release = resolve; });
	return { wait, release };
}

/**
 * @description Waits until the engine has been asked this many times
 */
async function engineAsked(count) {
	while (engineCalls() < count) { await new Promise((resolve) => setTimeout(resolve, 5)); }
}

/* ---------------------------------------------------------------- */
// Analysis
/* ---------------------------------------------------------------- */

describe("analysis", () => {
	test("answers with the engine's move & evaluation, and saves nothing", async () => {
		const gameId = await newGame();
		engineWillScore(54.5, { from: "d2", to: "d4", eval: 0.3, mate: null });

		const response = await analyze(gameId);
		assert.equal(response.status, 200, response.message);
		assert.equal(response.game_board, START);
		assert.equal(response.from, "d2");
		assert.equal(response.to, "d4");
		assert.equal(response.eval, 0.3);
		assert.equal(response.mate, null);
		assert.equal(response.winChance, 54.5);

		const game = await call("GET", `/api/chess/game/${gameId}`, { as: alice });
		assert.equal(game.game_board, START);
		assert.deepEqual(game.moves, []);
	});

	test("a guest analyzes their own game", async () => {
		await call("POST", "/api/chess/game", { body: { game_id: "guest1", start_color: "w" } });
		engineWillScore(50);
		assert.equal((await call("POST", "/api/chess/game/guest1/analysis")).status, 200);
	});

	test("a player who isn't in the game is refused without asking the engine", async () => {
		const gameId = await newGame();
		assert.equal((await analyze(gameId, player("carol"))).status, 403);
		assert.equal(engineCalls(), 0);
	});

	test("asks the engine at the low fixed depth, whatever the game's level", async () => {
		const realFetch = globalThis.fetch;
		globalThis.fetch = mock.fn(async () => new Response(JSON.stringify({ type: "bestmove", from: "e2", to: "e4", winChance: 50 }), { status: 200, headers: { "Content-Type": "application/json" } }));
		try {
			await analyzePosition(START);
			const body = JSON.parse(globalThis.fetch.mock.calls[0].arguments[1].body);
			assert.equal(body.fen, START);
			assert.equal(body.depth, 12);
			assert.equal(body.maxThinkingTime, 800);
			assert.equal(body.skillLevel, undefined);
			assert.equal(body.elo, undefined);
		} finally { globalThis.fetch = realFetch; }
	});
});

/* ---------------------------------------------------------------- */
// Friend Games
/* ---------------------------------------------------------------- */

describe("friend games", () => {
	let bob;
	beforeEach(() => { bob = player("bob"); }); // reset() FORGETS WHO CAN BE FOUND BY EMAIL

	const invite = async () => (await call("POST", "/api/chess/invite", { as: alice, body: { opponent_username: await named(bob), start_color: "w" } })).game_id;
	const friendGame = async () => {
		const gameId = await invite();
		await call("POST", `/api/chess/game/${gameId}/accept`, { as: bob, body: {} });
		return gameId;
	};

	test("a game that's going is refused for both players without asking the engine", async () => {
		const gameId = await friendGame();
		for (const as of [alice, bob]) {
			const response = await analyze(gameId, as);
			assert.equal(response.status, 403);
			assert.equal(response.from, undefined);
			assert.equal(response.winChance, undefined);
		}
		assert.equal(engineCalls(), 0);
	});

	test("an invite that wasn't accepted yet is refused", async () => {
		const gameId = await invite();
		assert.equal((await analyze(gameId)).status, 403);
		assert.equal(engineCalls(), 0);
	});

	test("a finished game can be analyzed", async () => {
		const gameId = await friendGame();
		await call("POST", `/api/chess/game/${gameId}/forfeit`, { as: alice });
		engineWillScore(50);
		assert.equal((await analyze(gameId, bob)).status, 200);
	});
});

/* ---------------------------------------------------------------- */
// Engine Time
/* ---------------------------------------------------------------- */

describe("engine time", () => {
	test("the same position only asks the engine once, in any game", async () => {
		const first = await newGame();
		engineWillScore(52);
		assert.equal((await analyze(first)).winChance, 52);
		assert.equal((await analyze(first)).winChance, 52);

		const second = await newGame(player("carol"));
		assert.equal((await analyze(second, player("carol"))).winChance, 52);
		assert.equal(engineCalls(), 1);
	});

	test("two requests for the same board share one engine request", async () => {
		const gameId = await newGame();
		const held = heldAnswer();
		engineWillScore(52, { wait: held.wait });

		const requests = [analyze(gameId), analyze(gameId)];
		await engineAsked(1);
		held.release();
		const answers = await Promise.all(requests);
		assert.deepEqual(answers.map((answer) => answer.status), [200, 200]);
		assert.equal(engineCalls(), 1);
	});

	test("another board of the game is refused until the running request is done", async () => {
		const gameId = await newGame();
		const held = heldAnswer();
		engineWillScore(52, { wait: held.wait });
		const running = analyze(gameId);
		await engineAsked(1);

		assert.equal((await move(gameId, ["e2", "e4"])).status, 200);
		assert.equal((await analyze(gameId)).status, 409);
		assert.equal(engineCalls(), 1);

		held.release();
		assert.equal((await running).status, 200);
		engineWillScore(55, { from: "e7", to: "e5" });
		const next = await analyze(gameId);
		assert.equal(next.status, 200);
		assert.equal(next.winChance, 55);
	});

	test("an analysis doesn't hold up the AI's move", async () => {
		const gameId = await newGame();
		assert.equal((await move(gameId, ["e2", "e4"])).status, 200);
		const held = heldAnswer();
		engineWillScore(55, { from: "e7", to: "e5", wait: held.wait });
		const running = analyze(gameId);
		await engineAsked(1);

		engineWillPlay("c7", "c5");
		const aiMove = await call("POST", `/api/chess/game/${gameId}/ai-move`, { as: alice });
		assert.equal(aiMove.status, 200, aiMove.message);
		held.release();
		assert.equal((await running).status, 200);
	});
});

/* ---------------------------------------------------------------- */
// Boards Without A Move
/* ---------------------------------------------------------------- */

describe("boards without a move", () => {
	test("a checkmate has no move, the winner's chance is 100% & the engine isn't asked", async () => {
		const gameId = await newGame();
		await move(gameId, ["f2", "f3"]);
		engineWillPlay("e7", "e5");
		await call("POST", `/api/chess/game/${gameId}/ai-move`, { as: alice });
		await move(gameId, ["g2", "g4"]);
		engineWillPlay("d8", "h4");
		assert.equal((await call("POST", `/api/chess/game/${gameId}/ai-move`, { as: alice })).state, "CLOSED");
		const asked = engineCalls();

		const response = await analyze(gameId);
		assert.equal(response.status, 200, response.message);
		assert.equal(response.from, null);
		assert.equal(response.to, null);
		assert.equal(response.mate, 0);
		assert.equal(response.eval, -100);
		assert.equal(response.winChance, 0); // WHITE WAS MATED
		assert.equal(engineCalls(), asked);
	});

	test("a stalemate has no move and is even", async () => {
		assert.deepEqual(await analyzePosition(STALEMATE), { from: null, to: null, eval: 0, mate: null, winChance: 50 });
		assert.equal(engineCalls(), 0);
	});
});

/* ---------------------------------------------------------------- */
// Engine Failures
/* ---------------------------------------------------------------- */

describe("engine failures", () => {
	test("the engine down answers 503 & isn't cached, the next request asks again", async () => {
		const gameId = await newGame();
		assert.equal((await analyze(gameId)).status, 503);

		engineWillScore(52);
		const response = await analyze(gameId);
		assert.equal(response.status, 200);
		assert.equal(response.winChance, 52);
	});

	test("an illegal move from the engine is never given as a hint", async () => {
		const gameId = await newGame();
		engineWillScore(52, { from: "e2", to: "e5" });
		const response = await analyze(gameId);
		assert.equal(response.status, 503);
		assert.equal(response.from, undefined);
	});

	test("an answer without a win chance is refused", async () => {
		const gameId = await newGame();
		engineWillPlay("e2", "e4");
		assert.equal((await analyze(gameId)).status, 503);
	});
});

/* ---------------------------------------------------------------- */
// Limits
/* ---------------------------------------------------------------- */

describe("analysis limits", () => {
	test("asking in a loop is cut off with a 429, and the AI still moves", async () => {
		await call("POST", "/api/chess/game", { body: { game_id: "guest1", start_color: "w" } });
		engineWillScore(52);
		for (let i = 0; i < ANALYSIS_LIMITS.analysisSession.burst; i++) { assert.equal((await call("POST", "/api/chess/game/guest1/analysis")).status, 200, `request ${i}`); }

		const limited = await call("POST", "/api/chess/game/guest1/analysis");
		assert.equal(limited.http, 429);
		assert.match(limited.message, /^Too many hint requests, try again in \d+ seconds?$/);

		await call("PUT", "/api/chess/game/guest1", { body: { move: ["e2", "e4"] } });
		engineWillPlay("e7", "e5");
		assert.equal((await call("POST", "/api/chess/game/guest1/ai-move")).status, 200);
	});
});
