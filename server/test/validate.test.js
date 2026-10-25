/*
 *  validate.test.js  --  chess server tests
 *	Move Rules & Piece Facing (server/utils/validate.js), and the chess.js version both sides run
 *
 */

require("./helpers/env.js");
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { Chess } = require("chess.js");
const { validateMove, gameResult } = require("../utils/validate.js");
const serverPackage = require("../package.json");
const clientPackage = require("../../package.json");

/* ---------------------------------------------------------------- */
// Helpers
/* ---------------------------------------------------------------- */

const START_W_KNIGHT = [{ from: null, to: "b1" }, { from: null, to: "g1" }];
const START_B_KNIGHT = [{ from: null, to: "b8" }, { from: null, to: "g8" }];
const START_W_PIECE = ["a1", "c1", "d1", "e1", "f1", "h1"].map((to) => ({ from: null, to }));
const START_B_PIECE = ["a8", "c8", "d8", "e8", "f8", "h8"].map((to) => ({ from: null, to }));

/**
 * @description A game item shaped like retrieveGame() returns it (moves & prev_move already parsed)
 */
function game(fen = new Chess().fen(), facing = {}) {
	return {
		game_id: { S: "game1" },
		game_board: { S: fen },
		white_player_id: { S: "white" },
		black_player_id: { S: "black" },
		moves: { S: [] },
		prev_move: { S: [] },
		w_knight: { S: JSON.stringify(facing.w_knight || START_W_KNIGHT) },
		b_knight: { S: JSON.stringify(facing.b_knight || START_B_KNIGHT) },
		w_piece: { S: JSON.stringify(facing.w_piece || START_W_PIECE) },
		b_piece: { S: JSON.stringify(facing.b_piece || START_B_PIECE) },
	};
}

async function play(gameData, playerId, from, to, promotion) {
	return validateMove({ game_id: "game1", player_id: playerId, move: [from, to], promotion }, gameData);
}

/**
 * @description Plays SAN moves through validateMove, as the player whose turn it is
 */
async function playAll(gameData, ...sans) {
	for (const san of sans) {
		const move = new Chess(gameData.game_board.S).move(san);
		assert.equal((await play(gameData, move.color == "w" ? "white" : "black", move.from, move.to, move.promotion)).status, 200, `${san} should be legal`);
	}
	return gameData;
}

const list = (gameData, name) => JSON.parse(gameData[name].S);

/* ---------------------------------------------------------------- */
// validateMove
/* ---------------------------------------------------------------- */

describe("validateMove", () => {
	test("a legal move updates the board, the move list and prev_move", async () => {
		const response = await play(game(), "white", "e2", "e4");
		const expected = new Chess();
		expected.move("e4");
		assert.equal(response.status, 200);
		assert.equal(response.game_data.game_board.S, expected.fen());
		assert.deepEqual(response.game_data.moves.S, ["e4"]);
		assert.deepEqual(response.game_data.prev_move.S, ["e2", "e4"]);
	});

	test("refuses a move out of turn", async () => {
		const response = await play(game(), "black", "e7", "e5");
		assert.equal(response.status, 500);
	});

	test("refuses moving the other side's piece", async () => {
		const response = await play(game(), "white", "e7", "e5");
		assert.equal(response.status, 500);
	});

	test("refuses a move from an empty square", async () => {
		const response = await play(game(), "white", "e4", "e5");
		assert.equal(response.status, 500);
		assert.equal(response.message, "Invalid piece movement");
	});

	test("refuses an illegal move", async () => {
		const response = await play(game(), "white", "e2", "e5");
		assert.equal(response.status, 500);
		assert.equal(response.message, "Invalid piece movement");
	});

	test("refuses a player who isn't in the game", async () => {
		const response = await play(game(), "someone-else", "e2", "e4");
		assert.equal(response.status, 500);
	});

	test("refuses a board that isn't a valid FEN", async () => {
		const response = await play(game("not a board"), "white", "e2", "e4");
		assert.equal(response.message, "Invalid board, corrupted data");
	});

	test("black's moves are saved the same way", async () => {
		const gameData = game();
		await play(gameData, "white", "e2", "e4");
		const response = await play(gameData, "black", "c7", "c5");
		assert.equal(response.status, 200);
		assert.deepEqual(response.game_data.moves.S, ["e4", "c5"]);
	});
});

describe("piece facing", () => {
	test("a knight's entry records where it came from", async () => {
		const response = await play(game(), "white", "g1", "f3");
		assert.deepEqual(list(response.game_data, "w_knight")[1], { from: "g1", to: "f3" });
	});

	test("a black knight's entry is updated too", async () => {
		const gameData = game();
		await play(gameData, "white", "e2", "e4");
		const response = await play(gameData, "black", "b8", "c6");
		assert.deepEqual(list(response.game_data, "b_knight")[0], { from: "b8", to: "c6" });
	});

	test("capturing a knight clears its entry", async () => {
		const gameData = game("4k3/8/8/3n4/4P3/8/8/4K3 w - - 0 1", { b_knight: [{ from: "b8", to: "d5" }] });
		const response = await play(gameData, "white", "e4", "d5");
		assert.deepEqual(list(response.game_data, "b_knight")[0], { from: null, to: null });
	});

	test("a promotion that captures a knight clears the knight and adds the new piece", async () => {
		const gameData = game("1n2k3/P7/8/8/8/8/8/4K3 w - - 0 1", { b_knight: [{ from: null, to: "b8" }], w_piece: [{ from: null, to: "e1" }] });
		const response = await play(gameData, "white", "a7", "b8", "q");
		assert.equal(response.status, 200);
		assert.deepEqual(list(response.game_data, "b_knight")[0], { from: null, to: null });
		assert.deepEqual(list(response.game_data, "w_piece").at(-1), { from: "a7", to: "b8" });
	});

	test("promoting to a knight adds a knight entry", async () => {
		const gameData = game("4k3/P7/8/8/8/8/8/4K3 w - - 0 1", { w_knight: [] });
		const response = await play(gameData, "white", "a7", "a8", "n");
		assert.deepEqual(list(response.game_data, "w_knight"), [{ from: "a7", to: "a8" }]);
	});

	test("a promotion sent with a move that isn't one is ignored (no new entry, the piece that moved is updated)", async () => {
		const gameData = game();
		const response = await play(gameData, "white", "g1", "f3", "q");
		assert.equal(response.status, 200);
		assert.deepEqual(list(gameData, "w_knight"), [{ from: null, to: "b1" }, { from: "g1", to: "f3" }]);
		assert.deepEqual(list(gameData, "w_piece"), START_W_PIECE);
	});

	test("castling king side moves the rook's entry from h1 to f1", async () => {
		const gameData = game("4k3/8/8/8/8/8/8/4K2R w K - 0 1", { w_piece: [{ from: null, to: "e1" }, { from: null, to: "h1" }] });
		const response = await play(gameData, "white", "e1", "g1");
		assert.equal(response.status, 200);
		assert.deepEqual(list(response.game_data, "w_piece"), [{ from: null, to: "g1" }, { from: null, to: "f1" }]);
	});

	test("castling queen side moves the rook's entry from a1 to d1", async () => {
		const gameData = game("4k3/8/8/8/8/8/8/R3K3 w Q - 0 1", { w_piece: [{ from: null, to: "a1" }, { from: null, to: "e1" }] });
		const response = await play(gameData, "white", "e1", "c1");
		assert.deepEqual(list(response.game_data, "w_piece"), [{ from: null, to: "d1" }, { from: null, to: "c1" }]);
	});

	test("a sideways move keeps the way a piece faces, an up or down move changes it", async () => {
		const gameData = game("4k3/8/8/8/R7/8/8/4K3 w - - 0 1", { w_piece: [{ from: "a1", to: "a4" }, { from: null, to: "e1" }] });
		await play(gameData, "white", "a4", "h4");
		assert.deepEqual(list(gameData, "w_piece")[0], { from: "a1", to: "h4" });

		await play(gameData, "black", "e8", "d8");
		await play(gameData, "white", "h4", "h6");
		assert.deepEqual(list(gameData, "w_piece")[0], { from: "h4", to: "h6" });
	});

	test("capturing a rook clears its entry", async () => {
		const gameData = game("4k3/8/8/8/8/8/1r6/R3K3 w - - 0 1", { b_piece: [{ from: "b8", to: "b2" }], w_piece: [{ from: null, to: "a1" }] });
		await play(gameData, "white", "a1", "a2");
		await play(gameData, "black", "b2", "a2");
		assert.deepEqual(list(gameData, "w_piece")[0], { from: null, to: null });
	});

	test("en passant is allowed and saved", async () => {
		const gameData = game("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1");
		const response = await play(gameData, "white", "e5", "d6");
		const board = new Chess(response.game_data.game_board.S);
		assert.equal(response.status, 200);
		assert.equal(board.get("d5"), undefined, "the captured pawn is gone"); // chess.js GIVES undefined FOR AN EMPTY SQUARE
		assert.deepEqual(board.get("d6"), { type: "p", color: "w" });
	});
});

/* ---------------------------------------------------------------- */
// gameResult
/* ---------------------------------------------------------------- */

describe("gameResult", () => {
	test("a game in progress has no result", () => {
		assert.equal(gameResult(game()), null);
	});

	test("checkmate: the side that delivered it wins", () => {
		assert.deepEqual(gameResult(game("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3")), { winner: "b", reason: "checkmate" });
	});

	test("stalemate is a draw", () => {
		assert.deepEqual(gameResult(game("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1")), { winner: "draw", reason: "stalemate" });
	});

	test("two bare kings is a draw by insufficient material", () => {
		assert.deepEqual(gameResult(game("8/8/8/8/8/8/8/K6k w - - 0 1")), { winner: "draw", reason: "insufficient material" });
	});

	test("100 half moves without a capture or pawn move is a draw by the fifty-move rule", () => {
		assert.deepEqual(gameResult(game("8/8/8/8/8/8/R7/K6k w - - 100 80")), { winner: "draw", reason: "fifty-move rule" });
	});

	test("a position that comes up a third time is a draw by threefold repetition", async () => {
		const gameData = await playAll(game(), "Nf3", "Nf6", "Ng1", "Ng8"); // THE START POSITION A SECOND TIME
		assert.equal(gameResult(gameData), null);
		await playAll(gameData, "Nf3", "Nf6", "Ng1");
		assert.equal(gameResult(gameData), null);
		await playAll(gameData, "Ng8"); // A THIRD TIME
		assert.deepEqual(gameResult(gameData), { winner: "draw", reason: "threefold repetition" });
	});

	test("a position with other castling rights isn't the same position", async () => {
		const start = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
		const gameData = await playAll(game(start), "Ke2", "Ke7", "Ke1", "Ke8", "Ke2", "Ke7", "Ke1", "Ke8"); // THE SAME SQUARES 3 TIMES, BUT THE KINGS CAN'T CASTLE NOW
		gameData.start_params = { S: JSON.stringify({ color: "w", fen: start }) };
		assert.equal(gameResult(gameData), null);
		await playAll(gameData, "Ke2", "Ke7", "Ke1", "Ke8");
		assert.deepEqual(gameResult(gameData), { winner: "draw", reason: "threefold repetition" });
	});

	test("a game from a set position counts from its start", async () => {
		const start = "4k3/8/8/8/8/8/8/R3K3 w - - 0 1";
		const gameData = await playAll(game(start), "Ra2", "Kd8", "Ra1", "Ke8", "Ra2", "Kd8", "Ra1", "Ke8");
		gameData.start_params = { S: JSON.stringify({ color: "w", fen: start }) };
		assert.deepEqual(gameResult(gameData), { winner: "draw", reason: "threefold repetition" });
		delete gameData.start_params; // REPLAYED FROM THE STANDARD POSITION THE MOVES DON'T WORK, SO IT ISN'T COUNTED
		assert.equal(gameResult(gameData), null);
	});

	test("saved moves that don't lead to the board don't end the game", async () => {
		const gameData = await playAll(game(), "Nf3", "Nf6", "Ng1", "Ng8", "Nf3", "Nf6", "Ng1", "Ng8");
		gameData.game_board.S = "rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R b KQkq - 8 5"; // THE MOVES REPEAT 3 TIMES, BUT THE BOARD IS ANOTHER POSITION
		assert.equal(gameResult(gameData), null);
		gameData.game_board.S = new Chess().fen().replace(" 0 1", " 8 5");
		gameData.moves.S[7] = "Ke2"; // BLACK CAN'T PLAY THIS
		assert.equal(gameResult(gameData), null);
	});
});

/* ---------------------------------------------------------------- */
// chess.js Version
/* ---------------------------------------------------------------- */

describe("chess.js version", () => {
	test("the client and the server pin the same exact version, so they agree on what's legal", () => {
		const serverVersion = serverPackage.dependencies["chess.js"];
		assert.match(serverVersion, /^\d+\.\d+\.\d+$/, "server/package.json pins an exact version (no ^ or ~)");
		assert.equal(clientPackage.dependencies["chess.js"], serverVersion, "package.json pins the same version as server/package.json");
	});

	test("the server runs the version it pins", () => {
		assert.equal(require("chess.js/package.json").version, serverPackage.dependencies["chess.js"]);
	});
});
