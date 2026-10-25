/*
 *  startPosition.test.js  --  chess server tests
 *	Play From A Set Position (#74)
 *  checkStartFen & startPieces (server/utils/validate.js), then start_fen on the game routes: new games, Restart, invites & Rematch
 *
 */

require("./helpers/env.js");
const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { Chess } = require("chess.js");
const { checkStartFen, startPieces } = require("../utils/validate.js");
const testServer = require("./helpers/server.js");
const { call, player, engineWillPlay, peek } = testServer;

let server;
before(async () => { server = await testServer.start(); });
after(() => server.close());
beforeEach(() => testServer.reset());

const list = (item, name) => JSON.parse(item[name].S);
const unmoved = (squares) => squares.map((to) => ({ from: null, to }));

const ROOK_ENDING = "4k3/8/8/8/8/2N5/8/R3K2R w KQ - 0 1"; // WHITE: KING, 2 ROOKS & A KNIGHT ON c3, BLACK: A BARE KING
const BLACK_TO_MOVE = "4k3/8/8/8/8/8/8/R3K3 b Q - 0 1";

/* ---------------------------------------------------------------- */
// checkStartFen
/* ---------------------------------------------------------------- */

describe("checkStartFen", () => {
	test("blank or the standard position is no set position", () => {
		assert.deepEqual(checkStartFen(undefined), { fen: false });
		assert.deepEqual(checkStartFen("   "), { fen: false });
		assert.deepEqual(checkStartFen(new Chess().fen()), { fen: false });
	});

	test("a playable position comes back cleaned up, short FENs get the default fields", () => {
		assert.deepEqual(checkStartFen(`  ${ROOK_ENDING}  `), { fen: ROOK_ENDING });
		assert.deepEqual(checkStartFen("4k3/8/8/8/8/8/8/R3K3   w"), { fen: "4k3/8/8/8/8/8/8/R3K3 w - - 0 1" });
	});

	test("turns down broken FENs and positions chess.js lets through", () => {
		assert.match(checkStartFen("not a fen").message, /^Invalid FEN/);
		assert.match(checkStartFen("4k3/8/8/8/8/8/8/8 w - - 0 1").message, /^Invalid FEN/); // NO WHITE KING
		assert.match(checkStartFen("P3k3/8/8/8/8/8/8/4K3 w - - 0 1").message, /pawns/);
		assert.match(checkStartFen("4k3/8/8/8/8/8/8/4R1K1 w - - 0 1").message, /isn't moving is in check/); // WHITE COULD TAKE THE KING
	});

	test("turns down positions that are already over", () => {
		assert.match(checkStartFen("7k/6Q1/6K1/8/8/8/8/8 b - - 0 1").message, /already over/); // CHECKMATE
		assert.match(checkStartFen("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1").message, /already over/); // STALEMATE
		assert.match(checkStartFen("8/8/8/4k3/8/8/4K3/8 w - - 0 1").message, /already over/); // TWO BARE KINGS
	});
});

/* ---------------------------------------------------------------- */
// startPieces
/* ---------------------------------------------------------------- */

describe("startPieces", () => {
	test("the standard position gives the lists games always started with", () => {
		assert.deepEqual(startPieces(new Chess().fen()), {
			w_knight: unmoved(["b1", "g1"]),
			b_knight: unmoved(["b8", "g8"]),
			w_piece: unmoved(["a1", "c1", "d1", "e1", "f1", "h1"]),
			b_piece: unmoved(["a8", "c8", "d8", "e8", "f8", "h8"]),
		});
	});

	test("a set position lists the pieces where they stand", () => {
		assert.deepEqual(startPieces(ROOK_ENDING), {
			w_knight: unmoved(["c3"]),
			b_knight: [],
			w_piece: unmoved(["a1", "e1", "h1"]),
			b_piece: unmoved(["e8"]),
		});
	});
});

/* ---------------------------------------------------------------- */
// AI Games
/* ---------------------------------------------------------------- */

describe("AI games from a set position", () => {
	test("a guest's game starts from it, with the facing lists from the position", async () => {
		const created = await call("POST", "/api/chess/game", { body: { game_id: "guest1", start_color: "w", start_fen: ROOK_ENDING } });
		assert.equal(created.status, 200);
		assert.equal(created.game_board, ROOK_ENDING);

		const item = peek("chess_db", "guest1");
		assert.deepEqual(list(item, "w_knight"), unmoved(["c3"]));
		assert.deepEqual(list(item, "w_piece"), unmoved(["a1", "e1", "h1"]));

		const loaded = await call("GET", "/api/chess/game/guest1");
		assert.deepEqual(loaded.start_params, { color: "w", fen: ROOK_ENDING });

		const castled = await call("PUT", "/api/chess/game/guest1", { body: { move: ["e1", "g1"] } }); // THE CASTLING RIGHTS CAME FROM THE FEN
		assert.equal(castled.status, 200);
		assert.deepEqual(JSON.parse(castled.w_piece), [{ from: null, to: "a1" }, { from: null, to: "g1" }, { from: null, to: "f1" }]);
	});

	test("a position that can't be played is refused before anything is saved or forfeited", async () => {
		const alice = player("alice");
		const open = await call("POST", "/api/chess/game", { as: alice, body: { start_color: "w" } });

		const refused = await call("POST", "/api/chess/game", { as: alice, body: { start_color: "w", start_fen: "7k/6Q1/6K1/8/8/8/8/8 b - - 0 1", replace_current: true } });
		assert.equal(refused.http, 400);
		assert.equal(refused.status, 400);
		assert.match(refused.message, /already over/);
		assert.equal((await call("GET", `/api/chess/game/${open.game_id}`, { as: alice })).state, "OPEN"); // NOT FORFEITED

		const guest = await call("POST", "/api/chess/game", { body: { game_id: "guest1", start_color: "w", start_fen: "nonsense" } });
		assert.equal(guest.http, 400);
		assert.equal(peek("chess_db", "guest1"), undefined);
	});

	test("Restart starts the next game from the same position", async () => {
		const alice = player("alice");
		const game = await call("POST", "/api/chess/game", { as: alice, body: { start_color: "w", ai_level: 5, start_fen: ROOK_ENDING } });
		await call("PUT", `/api/chess/game/${game.game_id}`, { as: alice, body: { move: ["a1", "a8"] } });

		const restarted = await call("POST", `/api/chess/game/${game.game_id}/restart`, { as: alice });
		assert.equal(restarted.game_board, ROOK_ENDING);
		assert.equal(restarted.ai_level, 5);
		const loaded = await call("GET", `/api/chess/game/${restarted.game_id}`, { as: alice });
		assert.deepEqual(loaded.start_params, { color: "w", fen: ROOK_ENDING });
	});

	test("when the AI is to move in the position, it moves first", async () => {
		await call("POST", "/api/chess/game", { body: { game_id: "guest1", start_color: "w", start_fen: BLACK_TO_MOVE } });
		const loaded = await call("GET", "/api/chess/game/guest1");
		assert.equal(loaded.player_color, "w");
		assert.equal(new Chess(loaded.game_board).turn(), "b");

		engineWillPlay("e8", "d7");
		const aiMove = await call("POST", "/api/chess/game/guest1/ai-move");
		assert.deepEqual(aiMove.ai_move, { from: "e8", to: "d7" });
		assert.deepEqual(list(peek("chess_db", "guest1"), "b_piece"), [{ from: "e8", to: "d7" }]);
	});
});

/* ---------------------------------------------------------------- */
// Friend Games
/* ---------------------------------------------------------------- */

describe("friend games from a set position", () => {
	test("the invite shows it, and the game & its rematch start from it", async () => {
		const alice = player("alice");
		const bob = player("bob");

		const refused = await call("POST", "/api/chess/invite", { as: alice, body: { opponent_email: bob.email, start_fen: "P3k3/8/8/8/8/8/8/4K3 w - - 0 1" } });
		assert.equal(refused.http, 400);
		assert.equal(refused.status, 400);

		const invite = await call("POST", "/api/chess/invite", { as: alice, body: { opponent_email: bob.email, start_color: "w", start_fen: ROOK_ENDING } });
		const bobsHome = await call("GET", "/api/chess/user/bob", { as: bob });
		assert.deepEqual(bobsHome.received_invites[0].start_params, { color: "w", fen: ROOK_ENDING });

		const accepted = await call("POST", `/api/chess/game/${invite.game_id}/accept`, { as: bob, body: {} });
		assert.equal(accepted.game_board, ROOK_ENDING);

		await call("POST", `/api/chess/game/${invite.game_id}/forfeit`, { as: bob });
		await call("POST", `/api/chess/game/${invite.game_id}/rematch`, { as: alice });
		const rematch = await call("POST", `/api/chess/game/${invite.game_id}/rematch`, { as: bob });
		const next = await call("GET", `/api/chess/game/${rematch.new_game_id}`, { as: alice });
		assert.equal(next.game_board, ROOK_ENDING);
		assert.deepEqual(next.start_params, { color: "w", fen: ROOK_ENDING });
		assert.deepEqual(JSON.parse(next.w_knight), unmoved(["c3"]));
	});
});
