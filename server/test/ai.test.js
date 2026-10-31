/*
 *  ai.test.js  --  chess server tests
 *	AI Levels & Moves (server/utils/ai.js)
 *
 */

require("./helpers/env.js");
const { test, describe, before, after, beforeEach, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const { Chess } = require("chess.js");
const { levelList, readLevel, aiMove } = require("../utils/ai.js");
const testServer = require("./helpers/server.js");
const { call, peek, engineWillPlay, engineCalls } = testServer;

const START = new Chess().fen();
const realFetch = globalThis.fetch;

/**
 * @description Makes the engine API answer with this body (or fail when it's an Error)
 */
function engineAnswers(answer) {
	globalThis.fetch = mock.fn(async () => {
		if (answer instanceof Error) { throw answer; }
		return new Response(JSON.stringify(answer), { status: 200, headers: { "Content-Type": "application/json" } });
	});
}

const isLegal = (fen, move) => new Chess(fen).moves({ verbose: true }).some((legal) => legal.from == move.from && legal.to == move.to);

describe("levels", () => {
	test("there are 8 levels and the default is 3", () => {
		const { levels, default_level } = levelList();
		assert.equal(levels.length, 8);
		assert.deepEqual(levels.map((level) => level.level), [1, 2, 3, 4, 5, 6, 7, 8]);
		assert.equal(default_level, 3);
	});

	test("readLevel keeps real levels and turns anything else into the default", () => {
		assert.equal(readLevel(7), 7);
		assert.equal(readLevel("2"), 2);
		assert.equal(readLevel(9), 3);
		assert.equal(readLevel("hard"), 3);
		assert.equal(readLevel(undefined), 3);
	});
});

describe("aiMove", () => {
	beforeEach(() => mock.method(Math, "random", () => 0.99)); // NEVER THE LOW LEVELS' RANDOM MOVE
	afterEach(() => { globalThis.fetch = realFetch; mock.restoreAll(); });

	test("plays the engine's move", async () => {
		engineAnswers({ type: "bestmove", from: "e2", to: "e4" });
		assert.deepEqual(await aiMove(START, 5), { from: "e2", to: "e4", promotion: undefined });
	});

	test("sends the level's settings to the engine", async () => {
		engineAnswers({ type: "bestmove", from: "e2", to: "e4" });
		await aiMove(START, 4);
		const body = JSON.parse(globalThis.fetch.mock.calls[0].arguments[1].body);
		assert.equal(body.fen, START);
		assert.equal(body.elo, 1600);
		assert.equal(body.depth, 3);
	});

	test("falls back to js-chess-engine when the engine is down", async () => {
		engineAnswers(new Error("connection refused"));
		const move = await aiMove(START, 8);
		assert.ok(isLegal(START, move), `${move.from}-${move.to} is legal`);
	});

	test("falls back to js-chess-engine when the engine answers with an error", async () => {
		engineAnswers({ type: "info", text: "Server busy, try again shortly." });
		const move = await aiMove(START, 6);
		assert.ok(isLegal(START, move));
	});

	test("the fallback promotes a pawn that reaches the last rank to a queen", async () => {
		engineAnswers(new Error("connection refused"));
		const fen = "k7/4P3/8/8/8/8/2q5/K7 w - - 0 1"; // THE WHITE KING CAN'T MOVE, SO e7-e8 IS THE ONLY MOVE
		const move = await aiMove(fen, 3);
		assert.deepEqual(move, { from: "e7", to: "e8", promotion: "q" });
	});

	test("level 1 sometimes plays a random legal move without asking the engine", async () => {
		mock.method(Math, "random", () => 0); // ALWAYS THE RANDOM MOVE
		engineAnswers({ type: "bestmove", from: "e2", to: "e4" });
		const move = await aiMove(START, 1);
		assert.ok(isLegal(START, move));
		assert.equal(globalThis.fetch.mock.callCount(), 0);
	});
});

describe("parallel /ai-move requests on one game (#296)", () => { // AFTER "aiMove": ITS afterEach PUTS BACK THE REAL fetch, start() SETS THE STAND-IN
	let server;
	before(async () => { server = await testServer.start(); });
	after(() => server.close());
	beforeEach(() => testServer.reset());

	test("20 at once ask the engine once, and all get the same move", async () => {
		await call("POST", "/api/chess/game", { body: { game_id: "guest1", start_color: "w" } });
		await call("PUT", "/api/chess/game/guest1", { body: { move: ["e2", "e4"] } });

		let answer;
		engineWillPlay("e7", "e5", undefined, new Promise((resolve) => { answer = resolve; })); // THE ENGINE THINKS UNTIL EVERY REQUEST HAS ARRIVED
		const requests = Array.from({ length: 20 }, () => call("POST", "/api/chess/game/guest1/ai-move"));
		await new Promise((resolve) => setTimeout(resolve, 300));
		answer();
		const responses = await Promise.all(requests);

		assert.equal(engineCalls(), 1);
		for (const response of responses) {
			assert.equal(response.status, 200);
			assert.deepEqual(response.ai_move, { from: "e7", to: "e5" });
		}
		assert.deepEqual(JSON.parse(peek("chess_db", "guest1").moves.S), ["e4", "e5"]); // ONE AI MOVE SAVED
	});

	test("after the AI's move, its next turn asks the engine again", async () => {
		await call("POST", "/api/chess/game", { body: { game_id: "guest1", start_color: "w" } });
		await call("PUT", "/api/chess/game/guest1", { body: { move: ["e2", "e4"] } });
		engineWillPlay("e7", "e5");
		await call("POST", "/api/chess/game/guest1/ai-move");
		await call("PUT", "/api/chess/game/guest1", { body: { move: ["g1", "f3"] } });
		engineWillPlay("b8", "c6");
		assert.deepEqual((await call("POST", "/api/chess/game/guest1/ai-move")).ai_move, { from: "b8", to: "c6" });
		assert.equal(engineCalls(), 2);
	});
});
