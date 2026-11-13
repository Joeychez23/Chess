/*
 *  ai.test.js  --  chess server tests
 *	AI Levels & Moves (server/utils/ai.js)
 *
 */

require("./helpers/env.js");
const { test, describe, before, after, beforeEach, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const { Chess } = require("chess.js");
const { levelList, readLevel, levelSettings, aiMove } = require("../utils/ai.js");
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
	test("there's a level every 100 Elo from 600 to 3200, and the default is 1300", () => {
		const { levels, default_level } = levelList();
		assert.equal(levels.length, 27);
		assert.deepEqual(levels.map((level) => level.level), Array.from({ length: 27 }, (_, i) => 600 + 100 * i));
		assert.deepEqual([levels[0].elo, levels[7].elo, levels[26].elo], ["≈600", "≈1300", "3200+"]);
		assert.equal(default_level, 1300);
	});

	test("every level is a bot with a name, bio, avatar and lines for each moment", () => {
		const { levels } = levelList();
		const moments = ["start", "capture", "check", "win", "lose"];
		for (const bot of levels) {
			assert.ok(bot.name.trim() && bot.bio.trim(), `${bot.level} has a name and bio`);
			assert.ok(bot.bio.length <= 120, `${bot.level}'s bio is short`);
			assert.equal(bot.avatar, `images/bots/${bot.level}.webp`);
			assert.deepEqual(Object.keys(bot.lines).sort(), [...moments].sort());
			assert.ok(moments.every((m) => bot.lines[m].length >= 2 && bot.lines[m].every((line) => line.trim() && line.length <= 80)), `${bot.level} has 2+ lines a moment`);
		}
		assert.equal(new Set(levels.map((bot) => bot.name)).size, 27); // NO TWO BOTS SHARE A NAME
	});

	test("the old levels go to the client so it shows their bot", () => {
		assert.deepEqual(levelList().old_levels, { 1: 800, 2: 1100, 3: 1300, 4: 1600, 5: 1900, 6: 2200, 7: 2600, 8: 3200 });
	});

	test("readLevel keeps real levels and turns anything else into the default", () => {
		assert.equal(readLevel(700), 700);
		assert.equal(readLevel("2400"), 2400);
		assert.equal(readLevel(3300), 1300);
		assert.equal(readLevel(650), 1300);
		assert.equal(readLevel("hard"), 1300);
		assert.equal(readLevel(undefined), 1300);
	});

	test("the 8 levels from before become the closest of today's", () => {
		assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map(readLevel), [800, 1100, 1300, 1600, 1900, 2200, 2600, 3200]);
		assert.equal(readLevel("4"), 1600); // A GAME ITEM'S NUMBER COMES AS A STRING
	});

	test("each level is set up for its Elo: overlooking moves under 1300, UCI_Elo from there, full strength at 3200", () => {
		const settings = levelList().levels.map(({ level }) => levelSettings(level));
		const low = settings.filter(({ level }) => level < 1300);
		assert.ok(low.every(({ notice, uci_elo }) => notice > 0 && notice < 1 && !uci_elo));
		assert.deepEqual(low.map(({ notice }) => notice), low.map(({ notice }) => notice).sort((a, b) => a - b)); // A STRONGER LEVEL SEES MORE

		const rated = settings.filter(({ level }) => level >= 1300 && level < 3200);
		assert.equal(rated.length, 19);
		assert.deepEqual([rated[0].uci_elo, rated[0].depth, rated[18].uci_elo], [1320, 1, 3190]); // STOCKFISH'S LOWEST & HIGHEST
		assert.deepEqual(rated.map(({ uci_elo }) => uci_elo), [...new Set(rated.map(({ uci_elo }) => uci_elo))].sort((a, b) => a - b)); // THE UCI_Elo THAT MEASURED AT THE LEVEL, EACH ONE HIGHER
		assert.deepEqual([1600, 2000, 2600].map((level) => [levelSettings(level).uci_elo, Math.round(levelSettings(level).depth * 10) / 10]), [[1550, 2.4], [2115, 5.1], [2823, 11.1]]); // DEPTH: STOCKFISH'S SKILL LEVEL FOR THAT UCI_Elo + 0.5
		assert.deepEqual(rated.map(({ depth }) => depth), rated.map(({ depth }) => depth).sort((a, b) => a - b)); // A STRONGER LEVEL LOOKS FURTHER
		assert.deepEqual(levelSettings(3200), { level: 3200, elo: "3200+", depth: 20, time: 2000 });
	});
});

describe("aiMove", () => {
	afterEach(() => { globalThis.fetch = realFetch; mock.restoreAll(); });

	test("plays the engine's move", async () => {
		engineAnswers({ type: "bestmove", from: "e2", to: "e4" });
		assert.deepEqual(await aiMove(START, 1900), { from: "e2", to: "e4", promotion: undefined });
	});

	test("sends the level's settings to the engine", async () => {
		mock.method(Math, "random", () => 0.5);
		engineAnswers({ type: "bestmove", from: "e2", to: "e4" });
		await aiMove(START, 1600);
		const body = JSON.parse(globalThis.fetch.mock.calls[0].arguments[1].body);
		assert.equal(body.fen, START);
		assert.equal(body.elo, 1550); // THE UCI_Elo THAT PLAYS AT 1600
		assert.equal(body.depth, 2);
		assert.equal(body.searchmoves, undefined);
	});

	test("a level's depth between two whole ones is the higher one for that share of its moves", async () => {
		engineAnswers({ type: "bestmove", from: "e2", to: "e4" });
		const rolls = [0.1, 0.36, 0.4, 0.99]; // LEVEL 1600 IS DEPTH 2.38
		mock.method(Math, "random", () => rolls.shift());
		for (let i = 0; i < 4; i++) { await aiMove(START, 1600); }
		assert.deepEqual(globalThis.fetch.mock.calls.map((call) => JSON.parse(call.arguments[1].body).depth), [3, 3, 2, 2]);
	});

	test("full strength sends no Elo", async () => {
		engineAnswers({ type: "bestmove", from: "e2", to: "e4" });
		await aiMove(START, 3200);
		const body = JSON.parse(globalThis.fetch.mock.calls[0].arguments[1].body);
		assert.deepEqual([body.elo, body.skillLevel, body.depth, body.maxThinkingTime], [undefined, undefined, 20, 2000]);
	});

	test("falls back to js-chess-engine when the engine is down", async () => {
		engineAnswers(new Error("connection refused"));
		const move = await aiMove(START, 3200);
		assert.ok(isLegal(START, move), `${move.from}-${move.to} is legal`);
	});

	test("falls back to js-chess-engine when the engine answers with an error", async () => {
		engineAnswers({ type: "info", text: "Server busy, try again shortly." });
		const move = await aiMove(START, 2200);
		assert.ok(isLegal(START, move));
	});

	test("the fallback promotes a pawn that reaches the last rank to a queen", async () => {
		engineAnswers(new Error("connection refused"));
		const fen = "k7/4P3/8/8/8/8/2q5/K7 w - - 0 1"; // THE WHITE KING CAN'T MOVE, SO e7-e8 IS THE ONLY MOVE
		const move = await aiMove(fen, 1300);
		assert.deepEqual(move, { from: "e7", to: "e8", promotion: "q" });
	});
});

describe("the levels under 1300 overlook moves", () => {
	const TAKES = "4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1"; // 7 MOVES, exd5 IS THE ONLY CAPTURE
	afterEach(() => { globalThis.fetch = realFetch; mock.restoreAll(); });

	test("the engine only searches the moves the level saw, at full skill", async () => {
		const seen = [0, 0.9, 0, 0.9, 0.9, 0, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9]; // ONE ROLL PER LEGAL MOVE, UNDER THE CHANCE = SEEN
		mock.method(Math, "random", () => seen.shift());
		engineAnswers({ type: "bestmove", from: "b1", to: "c3" });
		const legal = new Chess(START).moves({ verbose: true });

		assert.deepEqual(await aiMove(START, 600), { from: "b1", to: "c3", promotion: undefined });
		const body = JSON.parse(globalThis.fetch.mock.calls[0].arguments[1].body);
		assert.equal(body.searchmoves, [legal[0], legal[2], legal[5]].map((move) => move.lan).join(" "));
		assert.deepEqual([body.depth, body.elo, body.skillLevel], [1, undefined, undefined]);
	});

	test("with one move seen it's played without asking the engine", async () => {
		const seen = [0.9, 0.9, 0];
		mock.method(Math, "random", () => seen.shift() ?? 0.9);
		engineAnswers({ type: "bestmove", from: "e2", to: "e4" });
		const third = new Chess(START).moves({ verbose: true })[2];

		assert.deepEqual(await aiMove(START, 900), { from: third.from, to: third.to, promotion: undefined });
		assert.equal(globalThis.fetch.mock.callCount(), 0);
	});

	test("with nothing seen it still plays a legal move", async () => {
		mock.method(Math, "random", () => 0.99);
		engineAnswers({ type: "bestmove", from: "e2", to: "e4" });
		assert.ok(isLegal(START, await aiMove(START, 600)));
		assert.equal(globalThis.fetch.mock.callCount(), 0);
	});

	test("a capture stands out: it's seen on a roll that misses a quiet move", async () => {
		const roll = levelSettings(1000).notice * 2; // OVER THE LEVEL'S CHANCE, UNDER 3 TIMES IT
		mock.method(Math, "random", () => roll);
		engineAnswers({ type: "bestmove", from: "e2", to: "e4" });
		assert.deepEqual(await aiMove(TAKES, 1000), { from: "e4", to: "d5", promotion: undefined });
		assert.equal(globalThis.fetch.mock.callCount(), 0); // THE ONLY MOVE SEEN
	});

	test("every low level plays legal moves through a whole game when the engine picks from what it was sent", async () => {
		for (const level of [600, 900, 1200]) {
			const board = new Chess();
			globalThis.fetch = mock.fn(async (url, options) => { // STAND-IN ENGINE: THE FIRST MOVE IT WAS TOLD TO SEARCH
				const lan = JSON.parse(options.body).searchmoves.split(" ")[0];
				return new Response(JSON.stringify({ type: "bestmove", from: lan.slice(0, 2), to: lan.slice(2, 4), promotion: lan[4] }), { status: 200 });
			});
			for (let ply = 0; ply < 80 && !board.isGameOver(); ply++) {
				const move = await aiMove(board.fen(), level);
				assert.ok(isLegal(board.fen(), move), `level ${level}: ${move.from}-${move.to} is legal`);
				board.move(move);
			}
		}
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
