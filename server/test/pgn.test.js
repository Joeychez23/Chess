/*
 *  pgn.test.js  --  chess server tests
 *	PGN Export (GET /api/chess/game/:gameId/pgn, server/utils/pgn.js)
 *  Real requests to the API, with the tables in memory (data-service/test/helpers/fakeDynamo.js). Each file is read back with chess.js
 *
 */

require("./helpers/env.js");
const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { Chess } = require("chess.js");
const config = require("../config.js");
const { buildPgn } = require("../utils/pgn.js");
const testServer = require("./helpers/server.js");
const { call, player, engineWillPlay } = testServer;

let server;
before(async () => { server = await testServer.start(); });
after(() => server.close());
beforeEach(() => testServer.reset());

const SET_POSITION = "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1";
const TODAY = () => new Date().toISOString().slice(0, 10).replace(/-/g, ".");

function readPgn(pgn) {
	const chess = new Chess();
	chess.loadPgn(pgn); // THROWS WHEN A READER COULDN'T OPEN THE FILE
	return { headers: chess.getHeaders(), moves: chess.history(), fen: chess.fen() };
}

async function friendGame(moves) {
	const alice = player("alice");
	const bob = player("bob");
	const invite = await call("POST", "/api/chess/invite", { as: alice, body: { opponent_email: bob.email, start_color: "w" } });
	await call("POST", `/api/chess/game/${invite.game_id}/accept`, { as: bob, body: {} });
	for (let i = 0; i < moves.length; i++) { await call("PUT", `/api/chess/game/${invite.game_id}`, { as: i % 2 == 0 ? alice : bob, body: { move: moves[i] } }); }
	return { gameId: invite.game_id, alice, bob };
}

describe("GET /game/:gameId/pgn", () => {
	test("a friend game still going: both names, the moves, today's date & no result yet", async () => {
		const { gameId, alice } = await friendGame([["e2", "e4"], ["e7", "e5"]]);
		const response = await call("GET", `/api/chess/game/${gameId}/pgn`, { as: alice });
		assert.equal(response.status, 200);
		assert.equal(response.filename, "Alice-vs-Bob.pgn");

		const { headers, moves } = readPgn(response.pgn);
		assert.deepEqual(moves, ["e4", "e5"]);
		assert.equal(headers.Event, "Friend Game");
		assert.equal(headers.Site, config.clientUrl);
		assert.equal(headers.Date, TODAY());
		assert.deepEqual([headers.White, headers.Black, headers.Result, headers.Termination], ["Alice", "Bob", "*", "unterminated"]);
	});

	test("a forfeit: the winner's result & the reason, the same file for both players", async () => {
		const { gameId, alice, bob } = await friendGame([["e2", "e4"], ["e7", "e5"]]);
		await call("POST", `/api/chess/game/${gameId}/forfeit`, { as: bob });

		const forAlice = await call("GET", `/api/chess/game/${gameId}/pgn`, { as: alice });
		const { headers } = readPgn(forAlice.pgn);
		assert.deepEqual([headers.Result, headers.Termination], ["1-0", "forfeit"]);
		assert.match(forAlice.pgn, /1\. e4 e5 1-0$/);
		assert.equal((await call("GET", `/api/chess/game/${gameId}/pgn`, { as: bob })).pgn, forAlice.pgn);
	});

	test("a guest's AI game: Stockfish at the game's level & the guest", async () => {
		await call("POST", "/api/chess/game", { body: { game_id: "guest1", start_color: "w", ai_level: 4 } });
		await call("PUT", "/api/chess/game/guest1", { body: { move: ["e2", "e4"] } });
		engineWillPlay("e7", "e5");
		await call("POST", "/api/chess/game/guest1/ai-move");

		const response = await call("GET", "/api/chess/game/guest1/pgn");
		assert.equal(response.filename, "Guest-vs-Stockfish_level_4.pgn");
		const { headers, moves } = readPgn(response.pgn);
		assert.deepEqual([headers.Event, headers.White, headers.Black], ["AI Game", "Guest", "Stockfish level 4"]);
		assert.deepEqual(moves, ["e4", "e5"]);
	});

	test("a signed in player's AI game uses their screenname, on the side they play", async () => {
		const alice = player("alice");
		const created = await call("POST", "/api/chess/game", { as: alice, body: { start_color: "b", ai_level: 2 } });
		const { headers } = readPgn((await call("GET", `/api/chess/game/${created.game_id}/pgn`, { as: alice })).pgn);
		assert.deepEqual([headers.White, headers.Black], ["Stockfish level 2", "Alice"]);
	});

	test("a set position replays from its FEN & says so in the headers", async () => {
		await call("POST", "/api/chess/game", { body: { game_id: "guest1", start_color: "w", start_fen: SET_POSITION } });
		await call("PUT", "/api/chess/game/guest1", { body: { move: ["e2", "e4"] } });

		const { headers, moves } = readPgn((await call("GET", "/api/chess/game/guest1/pgn")).pgn);
		assert.equal(headers.SetUp, "1");
		assert.equal(headers.FEN, SET_POSITION);
		assert.deepEqual(moves, ["e4"]);
	});

	test("only a player in the game gets it", async () => {
		const { gameId } = await friendGame([]);
		assert.equal((await call("GET", `/api/chess/game/${gameId}/pgn`, { as: player("carol") })).http, 403);
		assert.equal((await call("GET", `/api/chess/game/${gameId}/pgn`)).http, 401);
	});

	test("a game that doesn't exist has no file", async () => {
		const response = await call("GET", "/api/chess/game/nope/pgn", { as: player("alice") });
		assert.equal(response.pgn, undefined);
		assert.notEqual(response.status, 200);
	});
});

describe("buildPgn", () => {
	const friendData = (fields) => ({
		game_id: { S: "game1" },
		white_player_id: { S: "alice" },
		black_player_id: { S: "bob" },
		moves: { S: [] },
		...fields,
	});
	const build = (fields) => buildPgn(friendData(fields), { site: "https://chess.test/" });

	test("a saved move that can't be replayed throws, instead of writing a broken file", () => {
		assert.throws(() => build({ moves: { S: ["e4", "Ke5"] } }));
	});

	test("an older game has no date", () => {
		assert.equal(readPgn(build({}).pgn).headers.Date, "????.??.??");
		assert.equal(readPgn(build({ created_at: { S: "2026-03-09T23:59:59.000Z" } }).pgn).headers.Date, "2026.03.09");
	});

	test("every result", () => {
		const result = (winner) => readPgn(build({ state: { S: "CLOSED" }, winner: { S: winner }, reason: { S: "stalemate" } }).pgn).headers.Result;
		assert.deepEqual([result("w"), result("b"), result("draw")], ["1-0", "0-1", "1/2-1/2"]);
	});

	test("a name can't break the file, its header or the file name", () => {
		const { pgn, filename } = build({ white_name: { S: 'Al "the\\ace"\n[Result "1-0"]' }, black_name: { S: "../../Bób" } });
		const { headers } = readPgn(pgn);
		assert.equal(headers.White, "Al 'theace' [Result '1-0']");
		assert.equal(headers.Result, "*");
		assert.equal(filename, "Al_theace_Result_1-0-vs-Bób.pgn");
	});

	test("a friend game with no saved names is unknown, the file is named for the colors", () => {
		const { pgn, filename } = build({});
		const { headers } = readPgn(pgn);
		assert.deepEqual([headers.White, headers.Black], ["?", "?"]);
		assert.equal(filename, "white-vs-black.pgn");
	});
});
