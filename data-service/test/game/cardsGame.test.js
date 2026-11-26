/*
 *  cardsGame.test.js  --  data service tests
 *	Chess Cards Games (controllers/game/ newCardsGame & saveCardsGame)
 *  The data service stores a card game's engine state as an opaque JSON string & never runs the engine. Each save names the
 *  version it was made on, so only one save per version lands. A refused request leaves the stored game exactly as it was
 *
 */

require("../helpers/env.js");
const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const service = require("../helpers/service.js");
const { call, player, peek } = service;
const db = require("../../db/index.js");
const { poke } = require("../helpers/fakeDynamo.js");

let server;
before(async () => { server = await service.start(); });
after(() => server.close());
beforeEach(() => service.reset());

const alice = player("alice");
const mallory = player("mallory");

/* ---------------------------------------------------------------- */
// Helpers
/* ---------------------------------------------------------------- */

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";
const STATE = JSON.stringify({ v: 1, ply: 0, board: START });
const list = (userId, name) => JSON.parse(peek("user_db", userId)?.[name]?.S || "[]");

/**
 * @description Alice's new card game vs the AI, as white
 * @return {[string]} gameId
 */
async function cardsGame() {
	const made = await call("POST", "/games/cards", { as: alice, body: { color: "w", level: 1300, state: STATE, fen: START } });
	assert.equal(made.http, 200, made.message);
	return made.game_data.game_id.S;
}

/**
 * @description A save that must be refused, the stored game doesn't change
 * @return {[object]} response
 */
async function refused(gameId, options, http) {
	if (options?.as) { service.signIn(options.as.id); }
	const before = peek("chess_db", gameId);
	const response = await call("PUT", `/games/${gameId}/cards`, options);
	assert.equal(response.http, http, response.message);
	assert.deepEqual(peek("chess_db", gameId), before, "the stored game changed");
	return response;
}

/* ---------------------------------------------------------------- */
// New Card Game
/* ---------------------------------------------------------------- */

describe("new card game", () => {
	test("a signed in player's game starts at version 1 with the state as sent", async () => {
		const made = await call("POST", "/games/cards", { as: alice, body: { color: "w", level: 1300, state: STATE, fen: START } });
		assert.equal(made.http, 200, made.message);
		assert.equal(made.game_data.cards_version.N, "1");
		assert.equal(made.game_data.cards_state.S, STATE);
		const gameId = made.game_data.game_id.S;
		const item = peek("chess_db", gameId);
		assert.equal(item.mode.S, "cards");
		assert.equal(item.cards_version.N, "1");
		assert.equal(item.cards_state.S, STATE);
		assert.equal(item.game_board.S, START);
		assert.equal(item.state.S, "OPEN");
		assert.equal(item.white_player_id.S, "alice");
		assert.equal(item.black_player_id.S, "CHESS_AI");
		assert.equal(item.ai_level.N, "1300");
		assert.deepEqual(list("alice", "open_games"), [gameId]);
	});

	test("a guest gets a new game & its guest token", async () => {
		const made = await call("POST", "/games/cards", { body: { color: "b", state: STATE, fen: START } });
		assert.equal(made.http, 200, made.message);
		const gameId = made.game_data.game_id.S;
		assert.ok(made.guest_token);
		const item = peek("chess_db", gameId);
		assert.equal(item.white_player_id.S, "CHESS_AI");
		assert.equal(item.black_player_id.S, gameId); // A GUEST'S PLAYER ID IS THEIR GAME ID
		assert.equal(item.ai_level.N, "1300");
		assert.equal(item.cards_version.N, "1");
		assert.equal((await call("GET", `/games/${gameId}`, { cookie: made.guest_token })).http, 200); // THE TOKEN IT ANSWERED WITH IS THE GUEST'S COOKIE
	});

	test("only the fields it names, a JSON state, a FEN & a real level", async () => {
		const bad = [
			{ color: "w", state: STATE, fen: START, start_fen: START },
			{ color: "w", state: STATE, fen: START, mode: "chess" },
			{ color: "w", state: "{ not json", fen: START },
			{ color: "w", state: { v: 1 }, fen: START },
			{ color: "w", state: STATE },
			{ color: "w", state: STATE, fen: 7 },
			{ color: "w", state: STATE, fen: "not a fen" },
			{ color: "w", level: 9, state: STATE, fen: START }
		];
		for (const body of bad) {
			const response = await call("POST", "/games/cards", { as: alice, body });
			assert.equal(response.http, 400, JSON.stringify(body));
		}
		assert.deepEqual(list("alice", "open_games"), []);
	});

	test("a normal AI game is not a card game", async () => {
		const made = await call("POST", "/games/ai", { as: alice, body: { color: "w" } });
		const item = peek("chess_db", made.game_data.game_id.S);
		assert.equal(item.mode, undefined);
		assert.equal(item.cards_state, undefined);
		assert.equal(item.cards_version, undefined);
	});
});

/* ---------------------------------------------------------------- */
// Save Card Game
/* ---------------------------------------------------------------- */

describe("save card game", () => {
	test("a save on the stored version lands & bumps it", async () => {
		const gameId = await cardsGame();
		const next = JSON.stringify({ v: 1, ply: 1, board: AFTER_E4 });
		const saved = await call("PUT", `/games/${gameId}/cards`, { as: alice, body: { version: 1, state: next, fen: AFTER_E4 } });
		assert.equal(saved.http, 200, saved.message);
		assert.equal(saved.game_data.cards_version.N, "2");
		const item = peek("chess_db", gameId);
		assert.equal(item.cards_version.N, "2");
		assert.equal(item.cards_state.S, next);
		assert.equal(item.game_board.S, AFTER_E4);
		assert.equal(item.state.S, "OPEN");
		assert.equal((await call("PUT", `/games/${gameId}/cards`, { as: alice, body: { version: 2, state: STATE, fen: START } })).game_data.cards_version.N, "3");
	});

	test("a save on a stale version is refused (409) & nothing changes", async () => {
		const gameId = await cardsGame();
		await call("PUT", `/games/${gameId}/cards`, { as: alice, body: { version: 1, state: STATE, fen: AFTER_E4 } });
		const response = await refused(gameId, { as: alice, body: { version: 1, state: STATE, fen: START } }, 409);
		assert.equal(response.message, "Board changed before the move saved");
		await refused(gameId, { as: alice, body: { version: 3, state: STATE, fen: START } }, 409);
	});

	test("a save with a winner closes the game, then no more saves", async () => {
		const gameId = await cardsGame();
		const saved = await call("PUT", `/games/${gameId}/cards`, { as: alice, body: { version: 1, state: STATE, fen: AFTER_E4, winner: "w", reason: "checkmate" } });
		assert.equal(saved.http, 200, saved.message);
		const item = peek("chess_db", gameId);
		assert.equal(item.state.S, "CLOSED");
		assert.equal(item.winner.S, "w");
		assert.equal(item.reason.S, "checkmate");
		assert.equal(item.cards_version.N, "2");
		assert.equal(item.expireAt, undefined); // A SIGNED IN PLAYER'S FINISHED GAME IS KEPT
		assert.deepEqual(list("alice", "open_games"), []);
		assert.deepEqual(list("alice", "closed_games"), [gameId]);
		assert.equal((await refused(gameId, { as: alice, body: { version: 2, state: STATE, fen: START } }, 409)).message, "Game is over");
	});

	test("every result reason is taken, a king capture too", async () => {
		for (const reason of ["checkmate", "stalemate", "repetition", "fifty", "material", "skips", "king"]) {
			service.reset();
			const gameId = await cardsGame();
			const winner = reason == "checkmate" || reason == "king" || reason == "skips" ? "b" : "draw";
			const saved = await call("PUT", `/games/${gameId}/cards`, { as: alice, body: { version: 1, state: STATE, fen: START, winner, reason } });
			assert.equal(saved.http, 200, `${reason}: ${saved.message}`);
			assert.equal(peek("chess_db", gameId).reason.S, reason);
			assert.equal(peek("chess_db", gameId).winner.S, winner);
		}
	});

	test("a guest saves their own card game", async () => {
		const made = await call("POST", "/games/cards", { body: { color: "w", state: STATE, fen: START } });
		const gameId = made.game_data.game_id.S;
		const saved = await call("PUT", `/games/${gameId}/cards`, { cookie: made.guest_token, body: { version: 1, state: STATE, fen: AFTER_E4 } });
		assert.equal(saved.http, 200, saved.message);
		assert.equal(peek("chess_db", gameId).cards_version.N, "2");
	});

	test("unknown fields, a bad version, state, FEN, winner or reason are refused (400)", async () => {
		const gameId = await cardsGame();
		const bad = [
			{ version: 1, state: STATE, fen: START, cards_version: 5 },
			{ version: 1, state: STATE, fen: START, state_override: "x" },
			{ version: 0, state: STATE, fen: START },
			{ version: -1, state: STATE, fen: START },
			{ version: 1.5, state: STATE, fen: START },
			{ version: "1", state: STATE, fen: START },
			{ state: STATE, fen: START },
			{ version: 1, state: "{ not json", fen: START },
			{ version: 1, state: { v: 1 }, fen: START },
			{ version: 1, fen: START },
			{ version: 1, state: STATE, fen: 7 },
			{ version: 1, state: STATE },
			{ version: 1, state: STATE, fen: START, winner: "white", reason: "checkmate" },
			{ version: 1, state: STATE, fen: START, winner: "w", reason: "resign" },
			{ version: 1, state: STATE, fen: START, winner: "w" },
			{ version: 1, state: STATE, fen: START, reason: "checkmate" },
			{ version: 1, state: STATE, fen: " " },
			{ version: 1, state: STATE, fen: "<script>alert(1)</script>" },
			{ version: 1, state: STATE, fen: `${START} ${"x".repeat(100)}` },
			{ version: 1, state: STATE, fen: START, winner: "draw", reason: "king" }, // A WIN REASON NEEDS A COLOR
			{ version: 1, state: STATE, fen: START, winner: "draw", reason: "checkmate" },
			{ version: 1, state: STATE, fen: START, winner: "w", reason: "stalemate" }, // A DRAW REASON NEEDS "draw"
			{ version: 1, state: STATE, fen: START, winner: "w", reason: "constructor" }
		];
		for (const body of bad) { await refused(gameId, { as: alice, body }, 400); }
	});

	test("a state between 16 KB & 300 000 characters is taken, on create & save", async () => {
		const big = JSON.stringify({ pad: "x".repeat(200000) });
		const made = await call("POST", "/games/cards", { as: alice, body: { color: "w", state: big, fen: START } });
		assert.equal(made.http, 200, made.message);
		const gameId = made.game_data.game_id.S;
		const saved = await call("PUT", `/games/${gameId}/cards`, { as: alice, body: { version: 1, state: big, fen: AFTER_E4 } });
		assert.equal(saved.http, 200, saved.message);
		assert.equal(peek("chess_db", gameId).cards_state.S, big);
	});

	test("a state over 300 000 bytes is refused (400) by the route, a body over 640 KB by the parser (413)", async () => {
		const gameId = await cardsGame();
		const over = JSON.stringify({ pad: "x".repeat(300000) }); // 300 012 BYTES, UNDER THE CARD ROUTES' 640 KB BODY LIMIT
		await refused(gameId, { as: alice, body: { version: 1, state: over, fen: START } }, 400);
		assert.equal((await call("POST", "/games/cards", { as: alice, body: { color: "w", state: over, fen: START } })).http, 400);
		await refused(gameId, { as: alice, body: { version: 1, state: JSON.stringify({ pad: "\u20ac".repeat(120000) }), fen: START } }, 400); // 120 012 CHARACTERS BUT 360 012 BYTES
		await refused(gameId, { as: alice, body: { version: 1, state: JSON.stringify({ pad: "x".repeat(650 * 1024) }), fen: START } }, 413);
	});

	test("a state full of quotes still fits: the body limit covers its escaped size", async () => {
		const gameId = await cardsGame();
		const quoted = JSON.stringify(Array(59000).fill("")); // 177 001 BYTES, 118 000 OF THEM QUOTES
		const full = JSON.stringify(Array(99999).fill("")); // 299 998 BYTES, ABOUT 500 KB ONCE ESCAPED IN THE BODY
		assert.equal((await call("PUT", `/games/${gameId}/cards`, { as: alice, body: { version: 1, state: quoted, fen: START } })).http, 200);
		assert.equal((await call("PUT", `/games/${gameId}/cards`, { as: alice, body: { version: 2, state: full, fen: START } })).http, 200);
		assert.equal(peek("chess_db", gameId).cards_state.S, full);
	});

	test("a board with a king gone is still a board (a king capture)", async () => {
		const gameId = await cardsGame();
		const saved = await call("PUT", `/games/${gameId}/cards`, { as: alice, body: { version: 1, state: STATE, fen: "rnbq1bnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQ - 0 1", winner: "w", reason: "king" } });
		assert.equal(saved.http, 200, saved.message);
	});

	test("a save ends a draw offer & a takeback request, a closing save too", async () => {
		const gameId = await cardsGame();
		const offers = { draw_offer_player_id: { S: "alice" }, draw_offered_w: { BOOL: true }, takeback_player_id: { S: "alice" } };
		poke("chess_db", gameId, offers);
		await call("PUT", `/games/${gameId}/cards`, { as: alice, body: { version: 1, state: STATE, fen: AFTER_E4 } });
		for (const name of Object.keys(offers)) { assert.equal(peek("chess_db", gameId)[name], undefined, name); }
		poke("chess_db", gameId, offers);
		await call("PUT", `/games/${gameId}/cards`, { as: alice, body: { version: 2, state: STATE, fen: START, winner: "draw", reason: "stalemate" } });
		for (const name of Object.keys(offers)) { assert.equal(peek("chess_db", gameId)[name], undefined, name); }
		assert.equal(peek("chess_db", gameId).state.S, "CLOSED");
	});

	test("the write itself refuses a closed game & a stale version, whatever the controller checked", async () => {
		const gameId = await cardsGame();
		await call("PUT", `/games/${gameId}/cards`, { as: alice, body: { version: 1, state: STATE, fen: AFTER_E4, winner: "b", reason: "skips" } });
		const closed = peek("chess_db", gameId);
		const game = (await db.retrieveGame(gameId, true)).game_data;
		assert.equal((await db.saveCardsState(game, 2, STATE, START)).status, 500); // THE RIGHT VERSION, BUT CLOSED
		assert.equal((await db.saveCardsState(game, 1, STATE, START)).status, 500);
		assert.deepEqual(peek("chess_db", gameId), closed);
	});

	test("every other route keeps the 16 KB body limit", async () => {
		const gameId = await cardsGame();
		const pad = "x".repeat(17 * 1024);
		const before = peek("chess_db", gameId);
		assert.equal((await call("POST", `/games/${gameId}/move`, { as: alice, body: { from: "e2", to: "e4", pad } })).http, 413);
		assert.equal((await call("POST", "/games/guest", { body: { color: "w", pad } })).http, 413);
		assert.equal((await call("POST", "/games/ai", { as: alice, body: { color: "w", pad } })).http, 413);
		assert.deepEqual(peek("chess_db", gameId), before);
	});

	test("only a player in the game, & only on a card game", async () => {
		const gameId = await cardsGame();
		await refused(gameId, { body: { version: 1, state: STATE, fen: START } }, 401);
		await refused(gameId, { as: mallory, body: { version: 1, state: STATE, fen: START } }, 403);
		await db.initializeGame("chess1", "alice", "CHESS_AI", 1300, { start_params: { color: "w" } });
		assert.equal((await refused("chess1", { as: alice, body: { version: 1, state: STATE, fen: START } }, 409)).message, "Not a card game");
	});
});
