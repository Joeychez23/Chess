/*
 *  bots.test.js  --  chess frontend tests
 *	The AI's bot & when it speaks (client/src/js/gameplay/bots/index.js). Run with npm run test:client
 *
 */

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { Chess } = require("chess.js");
const { botFor, momentFor, endMomentFor, pickLine } = require("../src/js/gameplay/bots/index.js");

const bot = (level) => ({ level, name: `Bot ${level}`, lines: { start: ["hi", "hello"], capture: ["took", "mine"], check: ["check!", "check?"], win: ["won", "yay"], lose: ["lost", "gg"] } });
const LEVELS = { levels: [bot(600), bot(1300), bot(1600)], default_level: 1300, old_levels: { 3: 1300, 4: 1600 } };

/**
 * @description Plays a move from the position & returns it & the board after it
 */
function play(fen, botMove) {
	const chess = new Chess(fen);
	const move = chess.move(botMove);
	return { move, chess };
}

describe("botFor", () => {
	test("finds the bot of a level, a level sent as a string and an old level (1 - 8)", () => {
		assert.equal(botFor(LEVELS, 1600).name, "Bot 1600");
		assert.equal(botFor(LEVELS, "1600").name, "Bot 1600");
		assert.equal(botFor(LEVELS, 4).name, "Bot 1600");
		assert.equal(botFor(LEVELS, "4").name, "Bot 1600");
	});

	test("no bot for a level that isn't there or when the levels didn't load", () => {
		assert.equal(botFor(LEVELS, 650), null);
		assert.equal(botFor(LEVELS, undefined), null);
		assert.equal(botFor(undefined, 1300), null);
		assert.equal(botFor({ status: 500 }, 1300), null);
	});
});

describe("momentFor", () => {
	test("a capture by the bot", () => {
		const { move, chess } = play("rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2", "exd5");
		assert.equal(momentFor(move, chess, "w"), "capture");
	});

	test("a capture that gives check is a check", () => {
		const { move, chess } = play("3rk3/8/8/8/8/8/8/3RK3 w - - 0 1", "Rxd8+"); // THE KING CAN TAKE BACK, NOT MATE
		assert.ok(move.captured);
		assert.equal(momentFor(move, chess, "w"), "check");
	});

	test("a mating move is a win", () => {
		const { move, chess } = play("rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2", "Qh4#");
		assert.equal(momentFor(move, chess, "b"), "win");
	});

	test("a quiet move and the player's moves say nothing", () => {
		const quiet = play(new Chess().fen(), "e4");
		assert.equal(momentFor(quiet.move, quiet.chess, "w"), null);
		const players = play("rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2", "exd5");
		assert.equal(momentFor(players.move, players.chess, "b"), null); // WHITE TOOK, THE BOT IS BLACK
		assert.equal(momentFor(undefined, quiet.chess, "w"), null);
	});
});

describe("endMomentFor", () => {
	test("the bot won, lost or drew", () => {
		assert.equal(endMomentFor({ winner: "b" }, "b"), "win");
		assert.equal(endMomentFor({ winner: "w" }, "b"), "lose");
		assert.equal(endMomentFor({ winner: "draw" }, "b"), null);
		assert.equal(endMomentFor(undefined, "b"), null);
	});
});

describe("pickLine", () => {
	test("a line for the moment, or none", () => {
		const b = bot(1300);
		assert.equal(pickLine(b, "check", () => 0), "check!");
		assert.equal(pickLine(b, "check", () => 0.99), "check?");
		assert.equal(pickLine(b, "nope"), null);
		assert.equal(pickLine(null, "start"), null);
	});
});
