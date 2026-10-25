/*
 *  games.test.js  --  chess server tests
 *	Game Routes (/api/chess, server/controllers/chessController.js)
 *  Real requests to the API, with the tables in memory (helpers/fakeDynamo.js) and a stand-in Auth0 & engine (helpers/server.js)
 *
 */

require("./helpers/env.js");
const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const testServer = require("./helpers/server.js");
const { call, player, engineWillPlay, peek } = testServer;

let server;
before(async () => { server = await testServer.start(); });
after(() => server.close());
beforeEach(() => testServer.reset());

const list = (item, name) => JSON.parse(item[name].S);

/* ---------------------------------------------------------------- */
// Levels
/* ---------------------------------------------------------------- */

test("GET /levels lists the 8 AI levels", async () => {
	const response = await call("GET", "/api/chess/levels");
	assert.equal(response.status, 200);
	assert.equal(response.levels.length, 8);
	assert.equal(response.default_level, 3);
});

/* ---------------------------------------------------------------- */
// Guest AI Games
/* ---------------------------------------------------------------- */

describe("a guest's AI game", () => {
	test("is created with the color and level picked, and plays moves in turn", async () => {
		const created = await call("POST", "/api/chess/game", { body: { game_id: "guest1", start_color: "w", ai_level: 4 } });
		assert.equal(created.status, 200);
		assert.equal(created.game_id, "guest1");
		assert.equal(created.ai, true);
		assert.equal(created.ai_level, 4);

		const loaded = await call("GET", "/api/chess/game/guest1");
		assert.equal(loaded.player_color, "w");
		assert.equal(loaded.state, "OPEN");

		const moved = await call("PUT", "/api/chess/game/guest1", { body: { move: ["e2", "e4"] } });
		assert.equal(moved.status, 200);
		assert.match(moved.game_board, /4P3/);

		const outOfTurn = await call("PUT", "/api/chess/game/guest1", { body: { move: ["d2", "d4"] } });
		assert.equal(outOfTurn.status, 500); // THE AI'S TURN
	});

	test("the server picks the AI's move, and asking again returns the same move", async () => {
		await call("POST", "/api/chess/game", { body: { game_id: "guest1", start_color: "w" } });
		await call("PUT", "/api/chess/game/guest1", { body: { move: ["e2", "e4"] } });

		engineWillPlay("e7", "e5");
		const aiMove = await call("POST", "/api/chess/game/guest1/ai-move");
		assert.equal(aiMove.status, 200);
		assert.deepEqual(aiMove.ai_move, { from: "e7", to: "e5" });

		const again = await call("POST", "/api/chess/game/guest1/ai-move");
		assert.deepEqual(again.ai_move, { from: "e7", to: "e5" });
		assert.equal(again.message, "AI already moved");
		assert.deepEqual(list(peek("chess_db", "guest1"), "moves"), ["e4", "e5"]); // ONE AI MOVE SAVED, NOT TWO
	});

	test("checkmate closes the game with the winner and the reason", async () => {
		await call("POST", "/api/chess/game", { body: { game_id: "guest1", start_color: "b" } }); // THE AI IS WHITE
		engineWillPlay("f2", "f3");
		await call("POST", "/api/chess/game/guest1/ai-move");
		await call("PUT", "/api/chess/game/guest1", { body: { move: ["e7", "e5"] } });
		engineWillPlay("g2", "g4");
		await call("POST", "/api/chess/game/guest1/ai-move");

		const mate = await call("PUT", "/api/chess/game/guest1", { body: { move: ["d8", "h4"] } });
		assert.equal(mate.state, "CLOSED");
		assert.equal(mate.winner, "b");
		assert.equal(mate.reason, "checkmate");

		const afterMate = await call("PUT", "/api/chess/game/guest1", { body: { move: ["a7", "a6"] } });
		assert.equal(afterMate.message, "Game is over");
	});

	test("the move that repeats a position a third time draws the game, the player's or the AI's", async () => {
		await call("POST", "/api/chess/game", { body: { game_id: "guest1", start_color: "b" } }); // THE AI IS WHITE
		const aiPlays = async (from, to) => { engineWillPlay(from, to); return call("POST", "/api/chess/game/guest1/ai-move"); };
		for (let i = 0; i < 2; i++) {
			await aiPlays("g1", "f3");
			await call("PUT", "/api/chess/game/guest1", { body: { move: ["g8", "f6"] } });
			await aiPlays("f3", "g1");
			const back = await call("PUT", "/api/chess/game/guest1", { body: { move: ["f6", "g8"] } }); // THE START POSITION AGAIN
			assert.equal(back.state, i == 0 ? "OPEN" : "CLOSED");
		}
		const draw = await call("GET", "/api/chess/game/guest1");
		assert.equal(draw.winner, "draw");
		assert.equal(draw.reason, "threefold repetition");

		await call("POST", "/api/chess/game", { body: { game_id: "guest2", start_color: "w" } }); // THE PLAYER IS WHITE, THE AI REPEATS IT
		const moves = [["g1", "f3"], ["g8", "f6"], ["f3", "g1"], ["f6", "g8"]];
		let last;
		for (let i = 0; i < 8; i++) {
			const [from, to] = moves[i % 4];
			if (i % 2 == 0) { await call("PUT", "/api/chess/game/guest2", { body: { move: [from, to] } }); }
			else { engineWillPlay(from, to); last = await call("POST", "/api/chess/game/guest2/ai-move"); }
		}
		assert.equal(last.state, "CLOSED");
		assert.equal(last.reason, "threefold repetition");
	});

	test("a move without two squares is refused", async () => {
		await call("POST", "/api/chess/game", { body: { game_id: "guest1", start_color: "w" } });
		const response = await call("PUT", "/api/chess/game/guest1", { body: { move: "e2e4" } });
		assert.equal(response.message, "Invalid piece movement");
	});
});

/* ---------------------------------------------------------------- */
// Signed-in AI Games
/* ---------------------------------------------------------------- */

describe("a signed-in player's AI games", () => {
	test("only one is open at a time, and replacing it forfeits the old one", async () => {
		const alice = player("alice");
		const first = await call("POST", "/api/chess/game", { as: alice, body: { start_color: "w" } });
		assert.equal(first.status, 200);

		const blocked = await call("POST", "/api/chess/game", { as: alice, body: { start_color: "w" } });
		assert.equal(blocked.status, 409);
		assert.equal(blocked.game_id, first.game_id);

		const second = await call("POST", "/api/chess/game", { as: alice, body: { start_color: "w", replace_current: true } });
		assert.equal(second.status, 200);
		assert.notEqual(second.game_id, first.game_id);

		const old = await call("GET", `/api/chess/game/${first.game_id}`, { as: alice });
		assert.equal(old.state, "CLOSED");
		assert.equal(old.winner, "b"); // ALICE WAS WHITE, SO BLACK WINS THE FORFEIT
		assert.equal(old.reason, "forfeit");

		const home = await call("GET", "/api/chess/user/alice", { as: alice });
		assert.equal(home.ai_game_id, second.game_id);
		assert.deepEqual(home.open_game_list.map((game) => game.game_id), [second.game_id]);
		assert.ok(home.closed_games.includes(first.game_id));
	});

	test("restarting mid-game forfeits it and starts a new game at the same level", async () => {
		const alice = player("alice");
		const game = await call("POST", "/api/chess/game", { as: alice, body: { start_color: "w", ai_level: 6 } });
		await call("PUT", `/api/chess/game/${game.game_id}`, { as: alice, body: { move: ["e2", "e4"] } });

		const restarted = await call("POST", `/api/chess/game/${game.game_id}/restart`, { as: alice });
		assert.equal(restarted.status, 200);
		assert.notEqual(restarted.game_id, game.game_id);
		assert.equal(restarted.ai_level, 6);

		const old = await call("GET", `/api/chess/game/${game.game_id}`, { as: alice });
		assert.equal(old.reason, "forfeit");
	});

	test("a guest can't open a signed-in player's game", async () => {
		const alice = player("alice");
		const game = await call("POST", "/api/chess/game", { as: alice, body: { start_color: "w" } });
		const response = await call("GET", `/api/chess/game/${game.game_id}`);
		assert.equal(response.http, 401);
	});
});

/* ---------------------------------------------------------------- */
// Friend Games
/* ---------------------------------------------------------------- */

describe("friend games", () => {
	test("invite, accept, play, forfeit and rematch", async () => {
		const alice = player("alice");
		const bob = player("bob");

		const invite = await call("POST", "/api/chess/invite", { as: alice, body: { opponent_email: bob.email, start_color: "w" } });
		assert.equal(invite.status, 200);
		assert.equal(invite.state, "PENDING");
		const gameId = invite.game_id;

		const bobsHome = await call("GET", "/api/chess/user/bob", { as: bob });
		assert.deepEqual(bobsHome.received_invites, [{ game_id: gameId, name: "Alice", player_color: "b", start_params: { color: "w" } }]);

		const tooEarly = await call("PUT", `/api/chess/game/${gameId}`, { as: alice, body: { move: ["e2", "e4"] } });
		assert.equal(tooEarly.message, "Invite not accepted yet");

		const accepted = await call("POST", `/api/chess/game/${gameId}/accept`, { as: bob, body: {} });
		assert.equal(accepted.state, "OPEN");

		assert.equal((await call("PUT", `/api/chess/game/${gameId}`, { as: alice, body: { move: ["e2", "e4"] } })).status, 200);
		assert.equal((await call("PUT", `/api/chess/game/${gameId}`, { as: bob, body: { move: ["e7", "e5"] } })).status, 200);

		const forfeit = await call("POST", `/api/chess/game/${gameId}/forfeit`, { as: bob });
		assert.equal(forfeit.state, "CLOSED");
		assert.equal(forfeit.winner, "w");
		assert.equal(forfeit.reason, "forfeit");
		assert.equal(peek("chess_db", gameId).expireAt, undefined); // FINISHED FRIEND GAMES ARE KEPT

		const first = await call("POST", `/api/chess/game/${gameId}/rematch`, { as: alice });
		assert.equal(first.waiting, true);
		const second = await call("POST", `/api/chess/game/${gameId}/rematch`, { as: bob });
		assert.ok(second.new_game_id);
		const again = await call("POST", `/api/chess/game/${gameId}/rematch`, { as: alice });
		assert.equal(again.new_game_id, second.new_game_id);

		const rematch = await call("GET", `/api/chess/game/${second.new_game_id}`, { as: alice });
		assert.equal(rematch.state, "OPEN");
		assert.equal(rematch.player_color, "w"); // ALICE INVITED AS WHITE, THE REMATCH KEEPS IT
	});

	test("declining an invite deletes it", async () => {
		const carol = player("carol");
		const bob = player("bob");
		const invite = await call("POST", "/api/chess/invite", { as: carol, body: { opponent_email: bob.email } });

		const declined = await call("POST", `/api/chess/game/${invite.game_id}/decline`, { as: bob });
		assert.equal(declined.status, 200);
		assert.equal(peek("chess_db", invite.game_id), undefined);
		assert.deepEqual((await call("GET", "/api/chess/user/bob", { as: bob })).received_invites, []);
	});

	test("an invite is refused for your own email, an unknown email, or a friend who already invited you", async () => {
		const alice = player("alice");
		const bob = player("bob");
		assert.equal((await call("POST", "/api/chess/invite", { as: alice, body: { opponent_email: alice.email } })).message, "That's your email");
		assert.equal((await call("POST", "/api/chess/invite", { as: alice, body: { opponent_email: "nobody@test" } })).message, "Opponent not found");

		await call("POST", "/api/chess/invite", { as: bob, body: { opponent_email: alice.email } });
		assert.equal((await call("POST", "/api/chess/invite", { as: alice, body: { opponent_email: bob.email } })).message, "They already invited you");
	});

	test("a friend game has no AI move", async () => {
		const alice = player("alice");
		const bob = player("bob");
		const invite = await call("POST", "/api/chess/invite", { as: alice, body: { opponent_email: bob.email } });
		await call("POST", `/api/chess/game/${invite.game_id}/accept`, { as: bob, body: {} });
		assert.equal((await call("POST", `/api/chess/game/${invite.game_id}/ai-move`, { as: alice })).message, "Friend games have no AI");
	});

	test("the user_db lists follow the game: requested, then open, then closed", async () => {
		const alice = player("alice");
		const bob = player("bob");
		const invite = await call("POST", "/api/chess/invite", { as: alice, body: { opponent_email: bob.email } });
		assert.deepEqual(list(peek("user_db", "bob"), "requested_games"), [invite.game_id]);

		await call("POST", `/api/chess/game/${invite.game_id}/accept`, { as: bob, body: {} });
		assert.deepEqual(list(peek("user_db", "bob"), "requested_games"), []);
		assert.deepEqual(list(peek("user_db", "bob"), "open_games"), [invite.game_id]);

		await call("POST", `/api/chess/game/${invite.game_id}/forfeit`, { as: alice });
		assert.deepEqual(list(peek("user_db", "alice"), "open_games"), []);
		assert.deepEqual(list(peek("user_db", "alice"), "closed_games"), [invite.game_id]);
	});
});

/* ---------------------------------------------------------------- */
// Who Can Do What
/* ---------------------------------------------------------------- */

describe("sign-in checks", () => {
	test("a player can't read someone else's game list", async () => {
		const response = await call("GET", "/api/chess/user/alice", { as: player("bob") });
		assert.equal(response.http, 403);
	});

	test("a player can't open a friend game they're not in", async () => {
		const alice = player("alice");
		const bob = player("bob");
		const invite = await call("POST", "/api/chess/invite", { as: alice, body: { opponent_email: bob.email } });
		const response = await call("GET", `/api/chess/game/${invite.game_id}`, { as: player("carol") });
		assert.equal(response.http, 403);
	});

	test("an invalid or expired session gets a 401 so the client re-ups it", async () => {
		const response = await call("GET", "/api/chess/game/guest1", { cookie: "access_token=not-a-token" });
		assert.equal(response.http, 401);
		assert.equal(response.message, "SESSION EXPIRED");
	});

	test("routes for signed-in players turn guests away", async () => {
		const response = await call("POST", "/api/chess/invite", { body: { opponent_email: "bob@test" } });
		assert.equal(response.http, 401);
		assert.equal(response.message, "NOT SIGNED IN");
	});
});
