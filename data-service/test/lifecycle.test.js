/*
 *  lifecycle.test.js  --  data service tests
 *	Starting & Ending Games (controllers/gameController.js)
 *  New AI games, guest games, invites, accepts, declines & rematches: each only for the player in the request, only on
 *  games they can act on, with only the fields the route names. A refused request makes or changes nothing
 *
 */

require("./helpers/env.js");
const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const service = require("./helpers/service.js");
const { call, player, peek } = service;
const db = require("../dynamoDB.js");

let server;
before(async () => { server = await service.start(); });
after(() => server.close());
beforeEach(() => service.reset());

const alice = player("alice");
const bob = player("bob");
const carol = player("carol");
const mallory = player("mallory");

/* ---------------------------------------------------------------- */
// Helpers
/* ---------------------------------------------------------------- */

const SET_POSITION = "4k3/8/8/8/8/8/8/R3K3 w - - 0 1";
const list = (userId, name) => JSON.parse(peek("user_db", userId)?.[name]?.S || "[]");
const friendGame = (gameId, white, black, pending) => db.initalizeGame(gameId, white, black, false, { names: { w: white, b: black }, pending, start_params: { color: "w" }, inviter_id: white });

async function closedFriendGame(gameId, white, black) {
	const created = (await friendGame(gameId, white, black)).game_data;
	await db.closeGame(created, "w", "forfeit");
}

/**
 * @description Makes a request that must be refused & checks the items named didn't change (or weren't made)
 * @param  {[array]} items [[table, key], ...]
 * @return {[object]} response
 */
async function refused(items, method, path, options, http) {
	if (options?.as) { service.signIn(options.as.id); } // THE LOGIN THAT MADE THEIR ROW CAME BEFORE, ONLY THIS REQUEST MUST CHANGE NOTHING
	const before = items.map(([table, key]) => peek(table, key));
	const response = await call(method, path, options);
	assert.equal(response.http, http, response.message);
	assert.deepEqual(items.map(([table, key]) => peek(table, key)), before, "a stored item changed");
	return response;
}

/* ---------------------------------------------------------------- */
// New AI Games
/* ---------------------------------------------------------------- */

describe("new AI game", () => {
	test("the requester plays the AI at their level, color and set position", async () => {
		const made = await call("POST", "/games/ai", { as: alice, body: { color: "b", level: 5, start_fen: SET_POSITION } });
		assert.equal(made.http, 200);
		const gameId = made.game_data.game_id.S;
		const item = peek("chess_db", gameId);
		assert.equal(item.white_player_id.S, "CHESS_AI");
		assert.equal(item.black_player_id.S, "alice");
		assert.equal(item.ai_level.N, "5");
		assert.equal(item.game_board.S, SET_POSITION);
		assert.deepEqual(JSON.parse(item.start_params.S), { color: "b", fen: SET_POSITION });
		assert.deepEqual(list("alice", "open_games"), [gameId]);
	});

	test("random draws a side here, the level defaults to 3", async () => {
		const made = (await call("POST", "/games/ai", { as: alice, body: { color: "random" } })).game_data;
		assert.deepEqual([made.white_player_id.S, made.black_player_id.S].sort(), ["CHESS_AI", "alice"]);
		assert.equal(made.ai_level.N, "3");
	});

	test("only for a signed in player, with a real level, a playable position and a new id", async () => {
		await db.initalizeGame("game1", "bob", "CHESS_AI", 3, { start_params: { color: "w" } });
		const made = [["chess_db", "game2"], ["user_db", "alice"]];
		await refused(made, "POST", "/games/ai", { body: { game_id: "game2" } }, 401);
		await refused(made, "POST", "/games/ai", { guest: "game2", body: { game_id: "game2" } }, 403);
		await refused(made, "POST", "/games/ai", { as: alice, body: { game_id: "game2", level: 9 } }, 400);
		await refused(made, "POST", "/games/ai", { as: alice, body: { game_id: "game2", level: "3" } }, 400);
		await refused(made, "POST", "/games/ai", { as: alice, body: { game_id: "game2", start_fen: "P3k3/8/8/8/8/8/8/4K3 w - - 0 1" } }, 400);
		await refused(made, "POST", "/games/ai", { as: alice, body: { game_id: "game2", start_fen: 7 } }, 400);
		await refused(made, "POST", "/games/ai", { as: alice, body: { game_id: "game2", white_player_id: "bob" } }, 400);
		await refused([["chess_db", "CHESS_AI"]], "POST", "/games/ai", { as: alice, body: { game_id: "CHESS_AI" } }, 400);
		await refused([["chess_db", "game1"]], "POST", "/games/ai", { as: alice, body: { game_id: "game1" } }, 409); // BOB'S GAME ISN'T RESET
	});
});

describe("one create per game id", () => {
	test("two new AI games with one id at once: one is made, the other is refused", async () => {
		const results = await Promise.all([
			call("POST", "/games/ai", { as: alice, body: { game_id: "game1", color: "w", level: 3 } }),
			call("POST", "/games/ai", { as: bob, body: { game_id: "game1", color: "w", level: 5 } }),
		]);
		assert.deepEqual(results.map((result) => result.http).sort(), [200, 409]);
		const winner = results.find((result) => result.http == 200).game_data;
		assert.deepEqual(peek("chess_db", "game1").white_player_id, winner.white_player_id);
		const loser = winner.white_player_id.S == "alice" ? "bob" : "alice";
		assert.deepEqual(list(loser, "open_games"), []);
	});

	test("two invites with one id at once: one is made, the other is refused", async () => {
		const results = await Promise.all([
			call("POST", "/games/invite", { as: alice, body: { opponent_id: "bob", color: "w", game_id: "game1" } }),
			call("POST", "/games/invite", { as: carol, body: { opponent_id: "bob", color: "w", game_id: "game1" } }),
		]);
		assert.deepEqual(results.map((result) => result.http).sort(), [200, 409]);
		assert.deepEqual(list("bob", "requested_games"), ["game1"]);
	});

	test("two new guests with one id at once each get a game, neither is overwritten", async () => {
		const results = await Promise.all([
			call("POST", "/games/guest", { body: { game_id: "guest1", color: "w", level: 2 } }),
			call("POST", "/games/guest", { body: { game_id: "guest1", color: "w", level: 7 } }),
		]);
		const ids = results.map((result) => result.game_data.game_id.S);
		assert.notEqual(ids[0], ids[1]);
		for (const result of results) {
			const stored = peek("chess_db", result.game_data.game_id.S);
			assert.equal(stored.ai_level.N, result.game_data.ai_level.N);
			assert.equal(stored.white_player_id.S, result.game_data.game_id.S);
		}
	});
});

/* ---------------------------------------------------------------- */
// Guest Games
/* ---------------------------------------------------------------- */

describe("guest game", () => {
	test("a new guest's game is theirs vs the AI, at level 3 unless they pick one", async () => {
		const made = (await call("POST", "/games/guest", { body: { game_id: "guest1", color: "w" } })).game_data;
		assert.equal(made.game_id.S, "guest1");
		assert.equal(made.white_player_id.S, "guest1"); // A GUEST'S PLAYER ID IS THEIR GAME ID
		assert.equal(made.black_player_id.S, "CHESS_AI");
		assert.equal(made.ai_level.N, "3");
		assert.equal(peek("user_db", "guest1"), undefined); // GUESTS HAVE NO ROW
	});

	test("a guest resets their own game, keeping its level", async () => {
		await call("POST", "/games/guest", { body: { game_id: "guest1", color: "w", level: 6 } });
		await call("POST", "/games/guest1/move", { guest: "guest1", body: { from: "e2", to: "e4" } });
		const reset = (await call("POST", "/games/guest", { guest: "guest1", body: { game_id: "guest1", color: "w" } })).game_data;
		assert.equal(reset.game_id.S, "guest1");
		assert.deepEqual(reset.moves.S, []);
		assert.equal(reset.ai_level.N, "6");
	});

	test("an id that isn't the guest's own gets a new game, and that game isn't touched", async () => {
		await call("POST", "/games/guest", { body: { game_id: "guest1", color: "w" } });
		await db.initalizeGame("game1", "alice", "CHESS_AI", 3, { start_params: { color: "w" } });
		for (const [gameId, options] of [["guest1", { guest: "other" }], ["guest1", {}], ["game1", {}], ["game1", { guest: "alice" }]]) {
			const before = peek("chess_db", gameId);
			const made = (await call("POST", "/games/guest", { ...options, body: { game_id: gameId, color: "w" } })).game_data;
			assert.notEqual(made.game_id.S, gameId);
			assert.equal(made.white_player_id.S, made.game_id.S);
			assert.deepEqual(peek("chess_db", gameId), before);
		}
	});

	test("CHESS_AI or no id gets a new id, a signed in player or a bad body is refused", async () => {
		const made = (await call("POST", "/games/guest", { body: { game_id: "CHESS_AI", color: "w" } })).game_data;
		assert.notEqual(made.game_id.S, "CHESS_AI");
		assert.equal(peek("chess_db", "CHESS_AI"), undefined);
		assert.ok((await call("POST", "/games/guest", { body: { color: "b" } })).game_data.game_id.S);
		await refused([["chess_db", "guest2"]], "POST", "/games/guest", { as: alice, body: { game_id: "guest2" } }, 403);
		await refused([["chess_db", "guest2"]], "POST", "/games/guest", { body: { game_id: "guest2", level: 0 } }, 400);
		await refused([["chess_db", "guest2"]], "POST", "/games/guest", { body: { game_id: ["guest2"] } }, 400);
		await refused([["chess_db", "guest2"]], "POST", "/games/guest", { body: { game_id: "guest2", black_player_id: "alice" } }, 400);
	});
});

/* ---------------------------------------------------------------- */
// Invites
/* ---------------------------------------------------------------- */

describe("invite", () => {
	test("a PENDING game with the requester as the inviter, named by username or screenname", async () => {
		await db.claimUsername("bob", "Bobby");
		const made = (await call("POST", "/games/invite", { as: alice, body: { opponent_id: "bob", opponent_screenname: "Bob S", color: "w" } })).game_data;
		const item = peek("chess_db", made.game_id.S);
		assert.equal(item.state.S, "PENDING");
		assert.equal(item.inviter_id.S, "alice");
		assert.equal(item.white_player_id.S, "alice");
		assert.equal(item.white_name.S, "Alice"); // THE TOKEN'S SCREENNAME, ALICE HAS NO USERNAME
		assert.equal(item.black_name.S, "Bobby"); // BOB'S USERNAME WINS OVER THE SCREENNAME
		assert.deepEqual(list("alice", "requested_games"), [made.game_id.S]);
		assert.deepEqual(list("bob", "requested_games"), [made.game_id.S]);
	});

	test("not by a guest, not to yourself or the AI, and only with the fields it names", async () => {
		await friendGame("game1", "carol", "dave");
		const made = [["chess_db", "game2"], ["user_db", "bob"]];
		await refused(made, "POST", "/games/invite", { guest: "game2", body: { opponent_id: "bob", game_id: "game2" } }, 403);
		await refused(made, "POST", "/games/invite", { as: alice, body: { opponent_id: "alice", game_id: "game2" } }, 400);
		await refused(made, "POST", "/games/invite", { as: alice, body: { opponent_id: "CHESS_AI", game_id: "game2" } }, 400);
		await refused(made, "POST", "/games/invite", { as: alice, body: { game_id: "game2" } }, 400);
		await refused(made, "POST", "/games/invite", { as: alice, body: { opponent_id: "bob", opponent_screenname: "x".repeat(51), game_id: "game2" } }, 400);
		await refused(made, "POST", "/games/invite", { as: alice, body: { opponent_id: "bob", inviter_id: "mallory", game_id: "game2" } }, 400);
		await refused(made, "POST", "/games/invite", { as: alice, body: { opponent_id: "bob", start_fen: "not a fen", game_id: "game2" } }, 400);
		await refused([["chess_db", "game1"]], "POST", "/games/invite", { as: alice, body: { opponent_id: "bob", game_id: "game1" } }, 409);
	});
});

/* ---------------------------------------------------------------- */
// Accept & Decline
/* ---------------------------------------------------------------- */

describe("accept and decline", () => {
	test("the invited player accepts: the game opens for both", async () => {
		await friendGame("game1", "alice", "bob", true);
		const accepted = await call("POST", "/games/game1/accept", { as: bob });
		assert.equal(accepted.game_data.state.S, "OPEN");
		assert.deepEqual(list("alice", "open_games"), ["game1"]);
		assert.deepEqual(list("bob", "open_games"), ["game1"]);
		await refused([["chess_db", "game1"]], "POST", "/games/game1/accept", { as: bob }, 409); // ALREADY ANSWERED
	});

	test("not by the inviter, not by someone else, not while the inviter is in another friend game", async () => {
		await friendGame("game1", "alice", "bob", true);
		const invite = [["chess_db", "game1"], ["user_db", "alice"], ["user_db", "bob"]];
		await refused(invite, "POST", "/games/game1/accept", { as: alice }, 403);
		await refused(invite, "POST", "/games/game1/accept", { as: mallory }, 403);
		await refused(invite, "POST", "/games/game1/decline", { as: mallory }, 403);
		await friendGame("game2", "alice", "carol"); // ALICE STARTED ANOTHER FRIEND GAME SINCE
		const busy = await refused([["chess_db", "game1"]], "POST", "/games/game1/accept", { as: bob }, 409);
		assert.equal(busy.message, "They're in another game now");
	});

	test("either player deletes the invite, an open game isn't deleted", async () => {
		await friendGame("game1", "alice", "bob", true);
		const declined = await call("POST", "/games/game1/decline", { as: bob });
		assert.equal(declined.status, 200);
		assert.equal(declined.game_data.game_id.S, "game1"); // FOR BOTH HOMES
		assert.equal(peek("chess_db", "game1"), undefined);
		assert.deepEqual(list("alice", "requested_games"), []);

		await friendGame("game2", "alice", "bob", true);
		assert.equal((await call("POST", "/games/game2/decline", { as: alice })).status, 200); // THE INVITER CANCELS
		await friendGame("game3", "alice", "bob");
		await refused([["chess_db", "game3"]], "POST", "/games/game3/decline", { as: bob }, 409);
	});
});

/* ---------------------------------------------------------------- */
// Rematch
/* ---------------------------------------------------------------- */

describe("rematch", () => {
	test("the first press waits, the second makes the game with the inviter's pick and cancels both sent invites", async () => {
		await closedFriendGame("game1", "alice", "bob");
		await friendGame("invite1", "alice", "carol", true); // ALICE'S SENT INVITE
		const first = await call("POST", "/games/game1/rematch", { as: alice });
		assert.equal(first.waiting, true);
		const second = await call("POST", "/games/game1/rematch", { as: bob });
		assert.equal(second.status, 200);
		const item = peek("chess_db", second.new_game_id);
		assert.equal(item.state.S, "OPEN");
		assert.equal(item.white_player_id.S, "alice"); // THE INVITER PICKED WHITE
		assert.equal(item.inviter_id.S, "alice");
		assert.equal(peek("chess_db", "game1").rematch_game_id.S, second.new_game_id);
		assert.equal(peek("chess_db", "invite1"), undefined);
		assert.deepEqual(second.dropped_invites.map((invite) => invite.game_id.S), ["invite1"]);
		assert.equal((await call("POST", "/games/game1/rematch", { as: alice })).new_game_id, second.new_game_id); // PRESSED AGAIN: THE SAME GAME
	});

	test("a press after the other player's minute ran out waits again", async () => {
		await closedFriendGame("game1", "alice", "bob");
		await db.requestRematch("game1", "alice", Date.now() - 1000);
		assert.equal((await call("POST", "/games/game1/rematch", { as: bob })).waiting, true);
		assert.equal(peek("chess_db", "game1").rematch_player_id.S, "bob");
	});

	test("not for an open game, an AI game, someone else, or a player in another friend game", async () => {
		await friendGame("game1", "alice", "bob");
		await refused([["chess_db", "game1"]], "POST", "/games/game1/rematch", { as: alice }, 409);
		await db.initalizeGame("game2", "alice", "CHESS_AI", 3, { start_params: { color: "w" } });
		await db.closeGame((await db.retrieveGame("game2")).game_data, "b", "forfeit");
		await refused([["chess_db", "game2"]], "POST", "/games/game2/rematch", { as: alice }, 409);
		await closedFriendGame("game3", "carol", "dave");
		await refused([["chess_db", "game3"]], "POST", "/games/game3/rematch", { as: mallory }, 403);
		await friendGame("game4", "dave", "erin"); // DAVE IS IN ANOTHER FRIEND GAME
		await refused([["chess_db", "game3"]], "POST", "/games/game3/rematch", { as: carol }, 409);
	});
});

/* ---------------------------------------------------------------- */
// Accepting With An Open Friend Game
/* ---------------------------------------------------------------- */

describe("accept with an open friend game", () => {
	test("without replace_current: 409 with the open game, nothing changes", async () => {
		await friendGame("invite1", "alice", "bob", true);
		await friendGame("game1", "bob", "carol");
		const open = await refused([["chess_db", "invite1"], ["chess_db", "game1"]], "POST", "/games/invite1/accept", { as: bob }, 200); // A NORMAL ANSWER, NOT A REFUSAL
		assert.equal(open.status, 409);
		assert.equal(open.game_id, "game1");
	});

	test("with replace_current: the open game is forfeited, the sent invite cancelled, the invite accepted", async () => {
		await friendGame("invite1", "alice", "bob", true);
		await friendGame("game1", "bob", "carol");
		await friendGame("invite2", "bob", "dave", true); // BOB'S SENT INVITE
		const accepted = await call("POST", "/games/invite1/accept", { as: bob, body: { replace_current: true } });
		assert.equal(accepted.game_data.state.S, "OPEN");
		assert.equal(accepted.forfeited.game_id.S, "game1");
		assert.equal(peek("chess_db", "game1").winner.S, "b"); // CAROL WINS
		assert.deepEqual(accepted.dropped_invites.map((invite) => invite.game_id.S), ["invite2"]);
		assert.equal(peek("chess_db", "invite2"), undefined);
	});

	test("an invite cancelled between the checks and the accept leaves the open game open & unrated", async () => {
		await friendGame("invite1", "alice", "bob", true);
		await friendGame("game1", "bob", "carol");
		await friendGame("invite2", "bob", "dave", true); // BOB'S SENT INVITE
		const { DynamoDB } = require("@aws-sdk/client-dynamodb");
		const update = DynamoDB.prototype.updateItem;
		DynamoDB.prototype.updateItem = async (params) => { // ALICE CANCELS JUST BEFORE BOB'S ACCEPT LANDS
			if (params.Key.game_id?.S == "invite1" && params.ExpressionAttributeValues?.[":open"]) {
				DynamoDB.prototype.updateItem = update;
				await db.deleteInvite((await db.retrieveGame("invite1", true)).game_data);
			}
			return update(params);
		};
		const kept = () => [peek("chess_db", "game1"), peek("chess_db", "invite2"), peek("user_db", "carol"), list("bob", "open_games"), list("bob", "closed_games")]; // THE CANCEL ITSELF DROPS invite1 FROM BOB'S requested_games
		const before = kept();
		try {
			const lost = await call("POST", "/games/invite1/accept", { as: bob, body: { replace_current: true } });
			assert.match(lost.message, /Invite was already answered/);
		} finally { DynamoDB.prototype.updateItem = update; }
		assert.deepEqual(kept(), before);
		assert.equal(peek("chess_db", "game1").state.S, "OPEN");
		assert.equal(peek("chess_db", "game1").winner, undefined);
	});

	test("a busy inviter is refused before the requester's own game is forfeited", async () => {
		await friendGame("invite1", "alice", "bob", true);
		await friendGame("game1", "bob", "carol");
		await friendGame("game2", "alice", "erin"); // ALICE IS BUSY
		const busy = await refused([["chess_db", "invite1"], ["chess_db", "game1"]], "POST", "/games/invite1/accept", { as: bob, body: { replace_current: true } }, 409);
		assert.equal(busy.message, "They're in another game now");
	});
});

/* ---------------------------------------------------------------- */
// A Guest's Side
/* ---------------------------------------------------------------- */

describe("guest game side", () => {
	test("side fixes this game's side, color is what restarts use", async () => {
		const made = (await call("POST", "/games/guest", { body: { game_id: "guest1", color: "random", side: "w" } })).game_data;
		assert.equal(made.white_player_id.S, "guest1");
		assert.deepEqual(JSON.parse(made.start_params.S), { color: "random" });
		await refused([["chess_db", "guest2"]], "POST", "/games/guest", { body: { game_id: "guest2", side: "random" } }, 400);
	});
});
