/*
 *  undo.test.js  --  chess server tests
 *	Taking Back Moves (server/utils/validate.js undoMoves)
 *  Each undo has to give back exactly the board, moves, prev_move & facing lists from before the undone moves
 *
 */

require("./helpers/env.js");
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { Chess } = require("chess.js");
const { validateMove, undoMoves, startPieces } = require("../utils/validate.js");

/* ---------------------------------------------------------------- */
// Helpers
/* ---------------------------------------------------------------- */

const CASTLING = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";

/**
 * @description An open game item shaped like retrieveGame() returns it, starting from fen (a set position) or the standard position
 */
function game(fen) {
	const board = fen || new Chess().fen();
	const pieces = startPieces(board);
	return {
		game_id: { S: "game1" },
		state: { S: "OPEN" },
		game_board: { S: board },
		white_player_id: { S: "white" },
		black_player_id: { S: "black" },
		moves: { S: [] },
		prev_move: { S: [] },
		w_knight: { S: JSON.stringify(pieces.w_knight) },
		b_knight: { S: JSON.stringify(pieces.b_knight) },
		w_piece: { S: JSON.stringify(pieces.w_piece) },
		b_piece: { S: JSON.stringify(pieces.b_piece) },
		start_params: { S: JSON.stringify(fen ? { color: "w", fen } : { color: "w" }) },
	};
}

/**
 * @description Plays SAN moves through validateMove, as the player whose turn it is
 */
async function play(gameData, ...sans) {
	for (const san of sans) {
		const move = new Chess(gameData.game_board.S).move(san);
		const response = await validateMove({ game_id: "game1", player_id: move.color == "w" ? "white" : "black", move: [move.from, move.to], promotion: move.promotion }, gameData);
		assert.equal(response.status, 200, `${san} should be legal`);
	}
	return gameData;
}

/**
 * @description What an undo has to give back, with the facing lists parsed so a failure shows which entry is wrong
 */
function view(gameData) {
	return {
		game_board: gameData.game_board.S,
		moves: [...gameData.moves.S],
		prev_move: [...gameData.prev_move.S],
		w_knight: JSON.parse(gameData.w_knight.S),
		b_knight: JSON.parse(gameData.b_knight.S),
		w_piece: JSON.parse(gameData.w_piece.S),
		b_piece: JSON.parse(gameData.b_piece.S),
	};
}

/**
 * @description Plays before, then undone, takes undone back & expects the game exactly as it was after before
 */
async function checkUndo(fen, before, undone) {
	const gameData = await play(game(fen), ...before);
	const expected = view(gameData);
	await play(gameData, ...undone);
	assert.notDeepEqual(view(gameData), expected); // THE UNDONE MOVES CHANGED SOMETHING

	const response = undoMoves(gameData, undone.length);
	assert.equal(response.status, 200, response.message);
	assert.deepEqual(view(response.game_data), expected);
}

/* ---------------------------------------------------------------- */
// Undoing One Kind Of Move
/* ---------------------------------------------------------------- */

describe("undoing a move gives back the board and facing from before it", () => {
	test("a knight move", async () => {
		await checkUndo(null, ["e4", "e5"], ["Nf3"]);
	});

	test("capturing a knight", async () => {
		await checkUndo(null, ["e4", "Nf6", "Nc3", "Nxe4"], ["Nxe4"]);
	});

	test("capturing a rook", async () => {
		await checkUndo("4k3/8/8/8/8/8/1r6/R3K3 w - - 0 1", ["Ra2"], ["Rxa2"]);
	});

	test("a promotion", async () => {
		await checkUndo("4k3/1P6/8/8/8/8/8/4K3 w - - 0 1", [], ["b8=Q+"]);
	});

	test("a promotion that captures a knight", async () => {
		await checkUndo("1n2k3/P7/8/8/8/8/8/4K3 w - - 0 1", [], ["axb8=Q+"]);
	});

	test("a promotion to a knight", async () => {
		await checkUndo("4k3/1P6/8/8/8/8/8/4K3 w - - 0 1", [], ["b8=N"]);
	});

	test("castling on both sides, for white and black (the rook moves too)", async () => {
		await checkUndo(CASTLING, [], ["O-O"]);
		await checkUndo(CASTLING, [], ["O-O-O"]);
		await checkUndo(CASTLING, ["O-O"], ["O-O-O"]);
		await checkUndo(CASTLING, ["O-O-O"], ["O-O"]);
	});

	test("en passant", async () => {
		await checkUndo("4k3/8/8/8/3p4/8/4P3/4K3 w - - 0 1", ["e4"], ["dxe3"]);
	});

	test("a sideways rook move, which keeps its from", async () => {
		await checkUndo("4k3/8/8/8/8/8/8/R3K3 w - - 0 1", ["Ra4", "Kd7"], ["Rh4"]);
	});
});

/* ---------------------------------------------------------------- */
// Undoing Several Moves
/* ---------------------------------------------------------------- */

describe("undoing several moves", () => {
	test("2 moves takes back the last move of each side", async () => {
		await checkUndo(null, ["e4", "e5"], ["Nf3", "Nc6"]);
	});

	test("every move gives back the new game", async () => {
		const expected = view(game());
		const gameData = await play(game(), "e4", "d5", "exd5", "Qxd5", "Nc3", "Qa5");
		const response = undoMoves(gameData, 6);
		assert.equal(response.status, 200);
		assert.deepEqual(view(response.game_data), expected);
		assert.deepEqual(response.game_data.prev_move.S, []);
	});

	test("a game from a set position replays from that position", async () => {
		await checkUndo("4k3/8/8/8/8/2N5/8/R3K2R w KQ - 0 1", ["Nd5"], ["Kd7", "O-O"]);
	});

	test("a game from before start_params replays from the standard position", async () => {
		const gameData = await play(game(), "d4", "Nf6");
		delete gameData.start_params;
		const expected = view(gameData);
		await play(gameData, "c4");
		assert.deepEqual(view(undoMoves(gameData, 1).game_data), expected);
	});

	test("a random game: undoing any number of moves gives back the game as it was then", async () => {
		let seed = 6; // A GAME WITH CAPTURES, CASTLING ON BOTH SIDES, PROMOTIONS & EN PASSANT
		const random = () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

		const gameData = game("r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1");
		const snapshots = [view(gameData)];
		const flags = new Set();
		for (let i = 0; i < 80; i++) {
			const legal = new Chess(gameData.game_board.S).moves({ verbose: true });
			if (!legal.length) { break; }
			const special = legal.filter((move) => /[pkqecb]/.test(move.flags)); // PROMOTIONS, CASTLING, EN PASSANT, CAPTURES & 2 SQUARE PAWN MOVES
			const move = special.length && random() < 0.7 ? special[Math.floor(random() * special.length)] : legal[Math.floor(random() * legal.length)];
			for (const flag of move.flags) { flags.add(flag); }
			await play(gameData, move.san);
			snapshots.push(view(gameData));
		}
		for (const flag of ["c", "k", "q", "p", "e"]) { assert.ok(flags.has(flag), `the game has a move with flag ${flag}`); }

		const count = gameData.moves.S.length;
		for (let undone = 1; undone <= count; undone++) {
			const response = undoMoves(structuredClone(gameData), undone);
			assert.equal(response.status, 200, response.message);
			assert.deepEqual(view(response.game_data), snapshots[count - undone], `undoing ${undone} moves`);
		}
	});
});

/* ---------------------------------------------------------------- */
// Refused
/* ---------------------------------------------------------------- */

describe("an undo that can't happen changes nothing", () => {
	test("taking back nothing, or past the start", async () => {
		const gameData = await play(game(), "e4", "e5");
		const before = view(gameData);
		for (const count of [0, -1, 1.5, "1", undefined]) { assert.equal(undoMoves(gameData, count).message, "Nothing to take back"); }
		assert.equal(undoMoves(gameData, 3).message, "Can't take back past the start");
		assert.equal(undoMoves(game(), 1).message, "Can't take back past the start");
		assert.deepEqual(view(gameData), before);
	});

	test("a game that isn't open", async () => {
		const gameData = await play(game(), "e4", "e5");
		gameData.state = { S: "CLOSED" };
		assert.equal(undoMoves(gameData, 1).status, 500);
		gameData.state = { S: "PENDING" };
		assert.equal(undoMoves(gameData, 1).message, "Game isn't open");
		delete gameData.state; // GAMES FROM BEFORE state ARE OPEN
		assert.equal(undoMoves(gameData, 1).status, 200);
	});

	test("saved moves that don't match the board, or can't be played", async () => {
		const gameData = await play(game(), "e4", "e5");
		const before = view(gameData);
		gameData.game_board.S = new Chess().fen();
		assert.equal(undoMoves(gameData, 1).message, "Saved moves don't match the board");

		const broken = await play(game(), "e4", "e5");
		broken.moves.S[1] = "Qh5"; // BLACK CAN'T PLAY THIS
		assert.equal(undoMoves(broken, 1).message, "Saved moves can't be replayed");
		assert.deepEqual(broken.moves.S, ["e4", "Qh5"]);
		gameData.game_board.S = before.game_board;
		assert.deepEqual(view(gameData), before);
	});
});
