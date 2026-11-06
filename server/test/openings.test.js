/*
 *  openings.test.js  --  chess server tests
 *	Opening Names (server/utils/openings.js, the opening saved after each move)
 *  Real requests to the API, with the tables in memory (data-service/test/helpers/fakeDynamo.js)
 *
 */

require("./helpers/env.js");
const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { Chess } = require("chess.js");
const { findOpening } = require("../utils/openings.js");
const testServer = require("./helpers/server.js");
const { call, player, named, engineWillPlay, dataServiceWillAnswer, peek } = testServer;

let server;
before(async () => { server = await testServer.start(); });
after(() => server.close());
beforeEach(() => testServer.reset());

const NAJDORF = { eco: "B90", name: "Sicilian Defense: Najdorf Variation" };
const NAJDORF_MOVES = [["e2", "e4"], ["c7", "c5"], ["g1", "f3"], ["d7", "d6"], ["d2", "d4"], ["c5", "d4"], ["f3", "d4"], ["g8", "f6"], ["b1", "c3"], ["a7", "a6"]];
const LEFT_THE_BOOK = [["a1", "b1"], ["h8", "g8"], ["b1", "a1"], ["g8", "h8"], ["a1", "b1"], ["h8", "g8"], ["b1", "a1"], ["g8", "h8"], ["a2", "a3"], ["h7", "h6"], ["a3", "a4"], ["h6", "h5"], ["a4", "a5"], ["h5", "h4"], ["c1", "e3"], ["c8", "d7"], ["f1", "e2"], ["d7", "c6"], ["e1", "g1"], ["e7", "e6"]];

/**
 * @description The position after some moves, written by chess.js like a saved board
 */
function fenAfter(moves) {
	const chess = new Chess();
	moves.forEach((san) => chess.move(san));
	return chess.fen();
}

async function friendGame() {
	const alice = player("alice");
	const bob = player("bob");
	const invite = await call("POST", "/api/chess/invite", { as: alice, body: { opponent_username: await named(bob), start_color: "w" } });
	await call("POST", `/api/chess/game/${invite.game_id}/accept`, { as: bob, body: {} });
	const play = async (moves, first = 0) => {
		let response;
		for (let i = 0; i < moves.length; i++) { response = await call("PUT", `/api/chess/game/${invite.game_id}`, { as: (first + i) % 2 == 0 ? alice : bob, body: { move: moves[i] } }); assert.equal(response.status, 200, response.message); }
		return response;
	};
	return { gameId: invite.game_id, alice, bob, play };
}

describe("findOpening", () => {
	test("finds a position by its moves, with any move counters", () => {
		const fen = fenAfter(["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "a6"]);
		assert.deepEqual(findOpening(fen), NAJDORF);
		assert.deepEqual(findOpening(fen.replace(/ \d+ \d+$/, " 40 90")), NAJDORF);
	});

	test("the same position from another move order matches", () => {
		const moved = findOpening(fenAfter(["Nf3", "c5", "e4", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "a6"]));
		assert.deepEqual(moved, NAJDORF);
	});

	test("the side to move, castling rights & en passant are part of the position", () => {
		const fen = fenAfter(["e4", "c5"]);
		assert.ok(findOpening(fen));
		assert.equal(findOpening(fen.replace(" w ", " b ")), null);
		assert.equal(findOpening(fen.replace(" KQkq ", " Qkq ")), null);
		assert.equal(findOpening(fen.replace(" - ", " c6 ")), null);
	});

	test("a position outside the data set has no opening", () => {
		assert.equal(findOpening("4k3/8/8/8/8/8/4P3/4K3 w - - 0 1"), null);
	});
});

describe("the opening saved on a game", () => {
	test("gets more specific, shows Najdorf after 5...a6 & stays at move 15", async () => {
		const { gameId, alice, bob, play } = await friendGame();
		assert.equal((await call("GET", `/api/chess/game/${gameId}`, { as: alice })).opening, null);

		const first = await play(NAJDORF_MOVES.slice(0, 1));
		assert.equal(first.opening.eco, "B00");
		assert.deepEqual((await play(NAJDORF_MOVES.slice(1), 1)).opening, NAJDORF);

		const later = await play(LEFT_THE_BOOK);
		assert.deepEqual(later.opening, NAJDORF);
		const game = await call("GET", `/api/chess/game/${gameId}`, { as: bob });
		assert.equal(game.moves.length, 30); // MOVE 15
		assert.deepEqual(game.opening, NAJDORF);
	});

	test("the AI's move saves it too, & a repeat /ai-move returns it", async () => {
		await call("POST", "/api/chess/game", { body: { game_id: "guest1", start_color: "w" } });
		await call("PUT", "/api/chess/game/guest1", { body: { move: ["e2", "e4"] } });
		engineWillPlay("c7", "c5");
		const moved = await call("POST", "/api/chess/game/guest1/ai-move");
		assert.equal(moved.status, 200);
		assert.equal(moved.opening.name, "Sicilian Defense");
		assert.equal((await call("POST", "/api/chess/game/guest1/ai-move")).opening.name, "Sicilian Defense");
		assert.equal((await call("GET", "/api/chess/game/guest1")).opening.name, "Sicilian Defense");
	});

	test("a move that ends the game on a named position saves it", async () => {
		const { gameId, alice, play } = await friendGame();
		const mate = await play([["f2", "f3"], ["e7", "e5"], ["g2", "g4"], ["d8", "h4"]]);
		assert.equal(mate.state, "CLOSED");
		assert.equal(mate.opening.name, "Barnes Opening: Fool's Mate");
		assert.equal((await call("GET", `/api/chess/game/${gameId}`, { as: alice })).opening.name, "Barnes Opening: Fool's Mate");
	});

	test("the move still saves when the opening can't", async () => {
		const { gameId, alice, play } = await friendGame();
		dataServiceWillAnswer(`/games/${gameId}/opening`, 503, "down");
		const moved = await play([["e2", "e4"]]);
		assert.equal(moved.opening, null);
		assert.equal(JSON.parse(peek("chess_db", gameId).moves.S).length, 1);
		assert.equal((await call("GET", `/api/chess/game/${gameId}`, { as: alice })).moves.length, 1);
	});

	test("a guest's reset starts without the old opening", async () => {
		await call("POST", "/api/chess/game", { body: { game_id: "guest1", start_color: "w" } });
		assert.ok((await call("PUT", "/api/chess/game/guest1", { body: { move: ["e2", "e4"] } })).opening);
		const reset = await call("POST", "/api/chess/game", { body: { game_id: "guest1", start_color: "w" } });
		assert.equal(reset.opening, null);
		assert.equal((await call("GET", "/api/chess/game/guest1")).opening, null);
	});

	test("Home's game rows have it", async () => {
		const { alice, play } = await friendGame();
		await play(NAJDORF_MOVES);
		const home = await call("GET", `/api/chess/user/alice`, { as: alice });
		assert.deepEqual(home.open_game_list[0].opening, NAJDORF);
	});
});
