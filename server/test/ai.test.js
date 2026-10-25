/*
 *  ai.test.js  --  chess server tests
 *	AI Levels & Moves (server/utils/ai.js)
 *
 */

require("./helpers/env.js");
const { test, describe, beforeEach, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const { Chess } = require("chess.js");
const { levelList, readLevel, aiMove } = require("../utils/ai.js");

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
