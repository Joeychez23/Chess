/*
 *  boardHelpers.test.js  --  chess server tests
 *	The board helpers (client/src/js/gameplay/user/index.js & utils/index.js), on the same chess.js as the game
 *
 */

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { Chess } = require("chess.js");
const { playerMove } = require("../../client/src/js/gameplay/user/index.js");
const { materialDiff, lastMoveBy, tileToSquare, toggleAnnotation } = require("../../client/src/js/gameplay/utils/index.js");

const PROMOTES_WHITE = "8/P6k/8/8/8/8/8/K7 w - - 0 1"; // THE a PAWN PROMOTES ON a8
const PROMOTES_BLACK = "4k3/8/8/8/8/8/p7/1N2K3 b - - 0 1"; // THE a PAWN PROMOTES ON a1, OR BY TAKING ON b1
const CASTLE = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
const BLACK_FIRST = "4k3/8/8/8/8/8/4P3/4K3 b - - 0 1";

describe("playerMove", () => {
	// x & y ARE THE SCREEN COLUMN & ROW THE PIECE WAS DROPPED ON, SO THEY DEPEND ON THE VIEW, THE MOVE DOESN'T
	const moves = [
		{ name: "white pawn up two, white's view", player: "w", view: "w", tile: { x: 4, y: 4, square: "e2", type: "p" }, move: { from: "e2", to: "e4" } },
		{ name: "white pawn up two, black's view", player: "w", view: "b", tile: { x: 3, y: 3, square: "e2", type: "p" }, move: { from: "e2", to: "e4" } },
		{ name: "black pawn down two, black's view", player: "b", view: "b", tile: { x: 3, y: 4, square: "e7", type: "p" }, move: { from: "e7", to: "e5" } },
		{ name: "black pawn down two, white's view", player: "b", view: "w", tile: { x: 4, y: 3, square: "e7", type: "p" }, move: { from: "e7", to: "e5" } },
		{ name: "white knight, white's view", player: "w", view: "w", tile: { x: 5, y: 5, square: "g1", type: "n" }, move: { from: "g1", to: "f3" } },
		{ name: "white knight, black's view", player: "w", view: "b", tile: { x: 2, y: 2, square: "g1", type: "n" }, move: { from: "g1", to: "f3" } },
		{ name: "black knight, black's view", player: "b", view: "b", tile: { x: 2, y: 5, square: "g8", type: "n" }, move: { from: "g8", to: "f6" } },
		{ name: "black knight, white's view", player: "b", view: "w", tile: { x: 5, y: 2, square: "g8", type: "n" }, move: { from: "g8", to: "f6" } }
	];

	for (const { name, player, view, tile, move } of moves) {
		test(name, () => {
			assert.deepEqual(playerMove(player, view, tile), move);
		});
	}

	// 'n' IS A STAND-IN: IT OPENS THE PROMOTION PICKER, THE PIECE PICKED REPLACES IT BEFORE THE MOVE IS SENT
	const promotions = [
		{ name: "white straight on, white's view", player: "w", view: "w", tile: { x: 4, y: 0, square: "e7", type: "p" }, to: "e8" },
		{ name: "white straight on, black's view", player: "w", view: "b", tile: { x: 3, y: 7, square: "e7", type: "p" }, to: "e8" },
		{ name: "black straight on, black's view", player: "b", view: "b", tile: { x: 3, y: 0, square: "e2", type: "p" }, to: "e1" },
		{ name: "black straight on, white's view", player: "b", view: "w", tile: { x: 4, y: 7, square: "e2", type: "p" }, to: "e1" },
		{ name: "white taking, white's view", player: "w", view: "w", tile: { x: 3, y: 0, square: "e7", type: "p" }, to: "d8" },
		{ name: "white taking, black's view", player: "w", view: "b", tile: { x: 4, y: 7, square: "e7", type: "p" }, to: "d8" },
		{ name: "black taking, black's view", player: "b", view: "b", tile: { x: 2, y: 0, square: "e2", type: "p" }, to: "f1" },
		{ name: "black taking, white's view", player: "b", view: "w", tile: { x: 5, y: 7, square: "e2", type: "p" }, to: "f1" }
	];

	for (const { name, player, view, tile, to } of promotions) {
		test(`promotes: ${name}`, () => {
			assert.deepEqual(playerMove(player, view, tile), { from: tile.square, to, promotion: "n" });
		});
	}

	test("a pawn one rank short of the last doesn't promote", () => {
		assert.deepEqual(playerMove("w", "w", { x: 4, y: 1, square: "e6", type: "p" }), { from: "e6", to: "e7" });
		assert.deepEqual(playerMove("b", "b", { x: 3, y: 1, square: "e3", type: "p" }), { from: "e3", to: "e2" });
	});

	test("other pieces going to the last rank don't promote", () => {
		assert.deepEqual(playerMove("w", "w", { x: 4, y: 0, square: "e7", type: "r" }), { from: "e7", to: "e8" });
		assert.deepEqual(playerMove("b", "b", { x: 3, y: 0, square: "e2", type: "q" }), { from: "e2", to: "e1" });
	});

	test("a move toward the player's own side doesn't promote", () => {
		assert.deepEqual(playerMove("w", "w", { x: 4, y: 7, square: "e2", type: "p" }), { from: "e2", to: "e1" });
		assert.deepEqual(playerMove("b", "b", { x: 3, y: 7, square: "e7", type: "p" }), { from: "e7", to: "e8" });
	});

	test("every screen position sends the square tileToSquare shows there", () => {
		for (const view of ["w", "b"]) {
			for (let x = 0; x < 8; x++) {
				for (let y = 0; y < 8; y++) {
					assert.equal(playerMove("w", view, { x, y, square: "e4", type: "n" }).to, tileToSquare(x, y, view));
				}
			}
		}
	});
});

describe("lastMoveBy", () => {
	test("each side's latest move, not its first", () => {
		assert.deepEqual(lastMoveBy(new Chess(), ["e4", "e5", "Nf3"], "w"), ["g1", "f3"]);
		assert.deepEqual(lastMoveBy(new Chess(), ["e4", "e5", "Nf3"], "b"), ["e7", "e5"]);
	});

	test("null when no moves were played", () => {
		assert.equal(lastMoveBy(new Chess(), [], "w"), null);
	});

	test("black going first: null for white until white has moved", () => {
		assert.equal(lastMoveBy(new Chess(BLACK_FIRST), ["Kd7"], "w"), null);
		assert.deepEqual(lastMoveBy(new Chess(BLACK_FIRST), ["Kd7"], "b"), ["e8", "d7"]);
	});

	test("black going first keeps each move with the right side", () => {
		assert.deepEqual(lastMoveBy(new Chess(BLACK_FIRST), ["Kd7", "e4"], "w"), ["e2", "e4"]);
		assert.deepEqual(lastMoveBy(new Chess(BLACK_FIRST), ["Kd7", "e4"], "b"), ["e8", "d7"]);
	});

	test("castling is the king's move", () => {
		assert.deepEqual(lastMoveBy(new Chess(CASTLE), ["O-O", "O-O-O"], "w"), ["e1", "g1"]);
		assert.deepEqual(lastMoveBy(new Chess(CASTLE), ["O-O", "O-O-O"], "b"), ["e8", "c8"]);
	});

	test("a promotion is the pawn's move", () => {
		assert.deepEqual(lastMoveBy(new Chess(PROMOTES_WHITE), ["a8=Q"], "w"), ["a7", "a8"]);
		assert.deepEqual(lastMoveBy(new Chess(PROMOTES_BLACK), ["axb1=N"], "b"), ["a2", "b1"]);
	});

	test("an illegal saved move throws, at the start or later on", () => {
		assert.throws(() => lastMoveBy(new Chess(), ["e5"], "w"));
		assert.throws(() => lastMoveBy(new Chess(), ["e4", "e5", "e4"], "w"));
	});
});

describe("materialDiff", () => {
	const diffOf = (fen) => materialDiff(new Chess(fen).board());

	test("the start of a game is level", () => {
		assert.equal(materialDiff(new Chess().board()), 0);
	});

	test("above 0 when white is ahead, below 0 when black is", () => {
		assert.equal(diffOf("rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"), 9);
		assert.equal(diffOf("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNB1KBNR w KQkq - 0 1"), -9);
	});

	test("each piece's value, kings count for nothing", () => {
		assert.equal(diffOf("4k3/8/8/8/8/8/8/4K3 w - - 0 1"), 0);
		assert.equal(diffOf("4k3/8/8/8/8/8/P7/4K3 w - - 0 1"), 1);
		assert.equal(diffOf("4k3/8/8/8/8/8/8/N3K3 w - - 0 1"), 3);
		assert.equal(diffOf("4k3/8/8/8/8/8/8/B3K3 w - - 0 1"), 3);
		assert.equal(diffOf("4k3/8/8/8/8/8/8/R3K3 w - - 0 1"), 5);
		assert.equal(diffOf("4k3/8/8/8/8/8/8/Q3K3 w - - 0 1"), 9);
	});

	test("a promotion swaps the pawn's value for the new piece's", () => {
		const queen = new Chess(PROMOTES_WHITE);
		assert.equal(materialDiff(queen.board()), 1);
		queen.move("a8=Q");
		assert.equal(materialDiff(queen.board()), 9);

		const knight = new Chess(PROMOTES_WHITE);
		knight.move("a8=N");
		assert.equal(materialDiff(knight.board()), 3);
	});

	test("a black promotion counts the taken piece too", () => {
		const chess = new Chess(PROMOTES_BLACK);
		assert.equal(materialDiff(chess.board()), 2); // WHITE'S KNIGHT, BLACK'S PAWN
		chess.move("axb1=N");
		assert.equal(materialDiff(chess.board()), -3);
	});

	test("a set position with two queens on one side", () => {
		assert.equal(diffOf("q3k2q/8/8/8/8/8/8/4K3 w - - 0 1"), -18);
	});

	test("a flipped board gives the same answer", () => {
		const board = new Chess("rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1").board();
		const flipped = board.slice().reverse().map((row) => row.slice().reverse());
		assert.equal(materialDiff(flipped), 9);
	});
});

describe("tileToSquare", () => {
	test("white's view has a8 at the top left", () => {
		assert.equal(tileToSquare(0, 0, "w"), "a8");
		assert.equal(tileToSquare(7, 0, "w"), "h8");
		assert.equal(tileToSquare(0, 7, "w"), "a1");
		assert.equal(tileToSquare(7, 7, "w"), "h1");
		assert.equal(tileToSquare(4, 4, "w"), "e4");
	});

	test("black's view is flipped, h1 at the top left", () => {
		assert.equal(tileToSquare(0, 0, "b"), "h1");
		assert.equal(tileToSquare(7, 0, "b"), "a1");
		assert.equal(tileToSquare(0, 7, "b"), "h8");
		assert.equal(tileToSquare(7, 7, "b"), "a8");
		assert.equal(tileToSquare(3, 3, "b"), "e4");
	});

	test("off the board is null in both views", () => {
		for (const view of ["w", "b"]) {
			for (const [x, y] of [[-1, 0], [0, -1], [8, 0], [0, 8], [-1, -1], [8, 8]]) {
				assert.equal(tileToSquare(x, y, view), null, `${x},${y} from ${view}`);
			}
		}
	});

	test("the two views put every square on the opposite side of the screen", () => {
		for (let x = 0; x < 8; x++) {
			for (let y = 0; y < 8; y++) {
				assert.equal(tileToSquare(x, y, "w"), tileToSquare(7 - x, 7 - y, "b"));
			}
		}
	});

	test("each view reaches all 64 squares once", () => {
		for (const view of ["w", "b"]) {
			const squares = new Set();
			for (let x = 0; x < 8; x++) {
				for (let y = 0; y < 8; y++) { squares.add(tileToSquare(x, y, view)); }
			}
			assert.equal(squares.size, 64);
		}
	});
});

describe("toggleAnnotation", () => {
	test("adds an arrow", () => {
		assert.deepEqual(toggleAnnotation([], "e2", "e4"), [{ from: "e2", to: "e4" }]);
	});

	test("adds a mark, the same square at both ends", () => {
		assert.deepEqual(toggleAnnotation([], "e4", "e4"), [{ from: "e4", to: "e4" }]);
	});

	test("adds to the end, keeping the others", () => {
		assert.deepEqual(toggleAnnotation([{ from: "a1", to: "a2" }], "e2", "e4"), [{ from: "a1", to: "a2" }, { from: "e2", to: "e4" }]);
	});

	test("the same arrow again removes only that one", () => {
		const annotations = [{ from: "a1", to: "a2" }, { from: "e2", to: "e4" }, { from: "d4", to: "d4" }];
		assert.deepEqual(toggleAnnotation(annotations, "e2", "e4"), [{ from: "a1", to: "a2" }, { from: "d4", to: "d4" }]);
	});

	test("arrows in opposite directions stay separate", () => {
		const both = toggleAnnotation(toggleAnnotation([], "e2", "e4"), "e4", "e2");
		assert.deepEqual(both, [{ from: "e2", to: "e4" }, { from: "e4", to: "e2" }]);
		assert.deepEqual(toggleAnnotation(both, "e2", "e4"), [{ from: "e4", to: "e2" }]);
	});

	test("an arrow & a mark sharing a square stay separate", () => {
		const both = toggleAnnotation([{ from: "e2", to: "e4" }], "e2", "e2");
		assert.deepEqual(both, [{ from: "e2", to: "e4" }, { from: "e2", to: "e2" }]);
	});

	test("leaves the list it was given alone", () => {
		const annotations = [{ from: "e2", to: "e4" }];
		toggleAnnotation(annotations, "a1", "a2");
		toggleAnnotation(annotations, "e2", "e4");
		assert.deepEqual(annotations, [{ from: "e2", to: "e4" }]);
	});
});
