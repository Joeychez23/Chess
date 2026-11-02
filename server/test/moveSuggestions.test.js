/*
 *  moveSuggestions.test.js  --  chess server tests
 *	The type move box's suggestions (client/src/js/gameplay/movebox/suggestions.js), on the same chess.js as the game
 *
 */

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { Chess } = require("chess.js");
const { moveBlockReason, suggestMoves, exampleMoves, stepHighlight, countMessage } = require("../../client/src/js/gameplay/movebox/suggestions.js");

const PROMOTION = "8/4P3/8/8/8/8/k7/7K w - - 0 1"; // THE e PAWN PROMOTES ON e8
const TWO_PROMOTIONS = "3n4/4P3/8/8/8/8/k7/7K w - - 0 1"; // ON e8, OR BY TAKING ON d8
const CASTLE = "4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1";
const CAN_MOVE = { gameOver: false, currSlide: false, currPromotion: false, opposingMove: false, boardReset: false, playerColor: "w" };

describe("exampleMoves", () => {
	test("the start of a game shows three moves spread across the legal ones", () => {
		assert.deepEqual(exampleMoves(new Chess()), ["Na3", "b3", "e4"]);
	});

	test("every example is legal in the position", () => {
		const chess = new Chess();
		chess.move("e4");
		const legal = chess.moves();
		const examples = exampleMoves(chess);
		assert.equal(examples.length, 3);
		assert.ok(examples.every((move) => legal.includes(move)));
	});

	test("few legal moves shows them all, none shows nothing", () => {
		assert.deepEqual(exampleMoves(new Chess("7k/8/8/8/8/8/8/K7 w - - 0 1")), ["Ka2", "Kb1", "Kb2"]);
		assert.deepEqual(exampleMoves(new Chess("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3")), []);
	});
});

describe("suggestMoves", () => {
	test("N at the start of a game lists the four knight moves", () => {
		assert.deepEqual(suggestMoves(new Chess(), "N"), ["Na3", "Nc3", "Nf3", "Nh3"]);
	});

	test("the list narrows as the player types", () => {
		assert.deepEqual(suggestMoves(new Chess(), "Nf"), ["Nf3"]);
		assert.deepEqual(suggestMoves(new Chess(), " e "), ["e3", "e4"]);
	});

	test("nothing typed or nothing that fits lists nothing", () => {
		assert.deepEqual(suggestMoves(new Chess(), ""), []);
		assert.deepEqual(suggestMoves(new Chess(), "   "), []);
		assert.deepEqual(suggestMoves(new Chess(), "Qd"), []);
	});

	test("a promotion lists each piece, queen first", () => {
		assert.deepEqual(suggestMoves(new Chess(PROMOTION), "e"), ["e8=Q", "e8=R", "e8=B", "e8=N"]);
		assert.deepEqual(suggestMoves(new Chess(PROMOTION), "e8=R"), ["e8=R"]);
	});

	test("two promoting moves stay in their own groups", () => {
		assert.deepEqual(suggestMoves(new Chess(TWO_PROMOTIONS), "e"), ["e8=Q", "e8=R", "e8=B", "e8=N", "exd8=Q", "exd8=R", "exd8=B", "exd8=N"]);
	});

	test("capitals count: b is the pawn, B the bishop", () => {
		const open = new Chess("rnbqkbnr/pppppppp/8/8/8/4P3/PPPP1PPP/RNBQKBNR w KQkq - 0 1");
		assert.ok(suggestMoves(open, "b").every((move) => move.startsWith("b")));
		assert.ok(suggestMoves(open, "B").length > 0);
		assert.ok(suggestMoves(open, "B").every((move) => move.startsWith("B")));
	});

	test("castling is found with O or 0", () => {
		assert.deepEqual(suggestMoves(new Chess(CASTLE), "O"), ["O-O", "O-O-O"]);
		assert.deepEqual(suggestMoves(new Chess(CASTLE), "0-0"), ["O-O", "O-O-O"]);
	});

	test("every suggestion is a move the box would play", () => {
		for (const fen of [new Chess().fen(), PROMOTION, TWO_PROMOTIONS, CASTLE]) {
			for (const typed of ["N", "e", "O", "K", "R", "a"]) {
				for (const move of suggestMoves(new Chess(fen), typed)) {
					assert.equal(new Chess(fen).move(move).san, move);
				}
			}
		}
	});

	test("a finished game lists nothing", () => {
		const mate = new Chess("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3");
		assert.deepEqual(suggestMoves(mate, "K"), []);
	});
});

describe("moveBlockReason", () => {
	test("the player can move on their own turn", () => {
		assert.equal(moveBlockReason(CAN_MOVE, "w"), undefined);
	});

	test("the opponent's turn, a slide, a new board or the game's end blocks it", () => {
		assert.equal(moveBlockReason(CAN_MOVE, "b"), "Not your turn");
		assert.equal(moveBlockReason({ ...CAN_MOVE, opposingMove: true }, "w"), "Not your turn");
		assert.equal(moveBlockReason({ ...CAN_MOVE, currSlide: true }, "w"), "Not your turn");
		assert.equal(moveBlockReason({ ...CAN_MOVE, boardReset: true }, "w"), "Not your turn");
		assert.equal(moveBlockReason({ ...CAN_MOVE, gameOver: true }, "w"), "The game is over");
	});

	test("an open promotion picker doesn't block it, a typed move replaces the picker", () => {
		assert.equal(moveBlockReason({ ...CAN_MOVE, currSlide: true, currPromotion: true }, "w"), undefined);
	});
});

describe("stepHighlight", () => {
	test("from nothing, Down goes to the first and Up to the last", () => {
		assert.equal(stepHighlight(-1, 4, 1), 0);
		assert.equal(stepHighlight(-1, 4, -1), 3);
	});

	test("it wraps around both ends", () => {
		assert.equal(stepHighlight(3, 4, 1), 0);
		assert.equal(stepHighlight(0, 4, -1), 3);
		assert.equal(stepHighlight(1, 4, 1), 2);
	});

	test("an empty list has no highlight", () => {
		assert.equal(stepHighlight(-1, 0, 1), -1);
	});
});

test("countMessage says how many suggestions there are", () => {
	assert.equal(countMessage(0), "No suggestions");
	assert.equal(countMessage(1), "1 suggestion");
	assert.equal(countMessage(4), "4 suggestions");
});
