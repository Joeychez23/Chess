/*
 *  lifecycle-invites.test.js  --  data service tests
 *	Invites (controllers/game/)
 *  Invites, challenge links, accepts and declines, and accepting with an open friend game: each only for the player in the request, only on
 *  games they can act on, with only the fields the route names. A refused request makes or changes nothing
 *
 */

require("../../helpers/env.js");
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { call, peek } = require("../../helpers/service.js");
const db = require("../../../db/index.js");
const { DynamoDB } = require("@aws-sdk/client-dynamodb");
const { alice, bob, carol, mallory, list, friendGame, refused } = require("../../helpers/lifecycle.js");

/* ---------------------------------------------------------------- */
// Invites
/* ---------------------------------------------------------------- */

describe("invite", () => {
	test("a PENDING game with the requester as the inviter, named by username or screenname", async () => {
		await db.claimUsername("bob", "Bobby");
		const made = (await call("POST", "/games/invite", { as: alice, body: { opponent_id: "bob", opponent_screenname: "Bob S", color: "w" } })).game_data;
		const item = peek("chess_db", made.game_id);
		assert.equal(item.state.S, "PENDING");
		assert.equal(item.inviter_id.S, "alice");
		assert.equal(item.white_player_id.S, "alice");
		assert.equal(item.white_name.S, "Alice"); // THE TOKEN'S SCREENNAME, ALICE HAS NO USERNAME
		assert.equal(item.black_name.S, "Bobby"); // BOB'S USERNAME WINS OVER THE SCREENNAME
		assert.deepEqual(list("alice", "requested_games"), [made.game_id]);
		assert.deepEqual(list("bob", "requested_games"), [made.game_id]);
	});

	test("not by a guest, not to yourself or the AI, and only with the fields it names", async () => {
		const made = [["user_db", "bob"]];
		await refused(made, "POST", "/games/invite", { guest: "game2", body: { opponent_id: "bob" } }, 403);
		await refused(made, "POST", "/games/invite", { as: alice, body: { opponent_id: "alice" } }, 400);
		await refused(made, "POST", "/games/invite", { as: alice, body: { opponent_id: "CHESS_AI" } }, 400);
		await refused(made, "POST", "/games/invite", { as: alice, body: {} }, 400);
		await refused(made, "POST", "/games/invite", { as: alice, body: { opponent_id: "bob", opponent_screenname: "x".repeat(51) } }, 400);
		await refused(made, "POST", "/games/invite", { as: alice, body: { opponent_id: "bob", inviter_id: "mallory" } }, 400);
		await refused(made, "POST", "/games/invite", { as: alice, body: { opponent_id: "bob", start_fen: "not a fen" } }, 400);
	});
});

/* ---------------------------------------------------------------- */
// Challenge Links
/* ---------------------------------------------------------------- */

describe("challenge link", () => {
	const makeLink = async (body = { color: "w" }) => (await call("POST", "/games/challenge", { as: alice, body })).game_data.game_id;

	test("is a pending game with an empty seat, only on the creator's list", async () => {
		const gameId = await makeLink();
		const item = peek("chess_db", gameId);
		assert.equal(item.state.S, "PENDING");
		assert.equal(item.white_player_id.S, "alice");
		assert.equal(item.black_player_id.S, "OPEN_SEAT");
		assert.equal(item.inviter_id.S, "alice");
		assert.deepEqual(list("alice", "requested_games"), [gameId]);
		assert.equal(peek("user_db", "OPEN_SEAT"), undefined);
	});

	test("the first player takes the seat under their name, the game opens for both", async () => {
		const gameId = await makeLink();
		const joined = await call("POST", `/games/${gameId}/join`, { as: bob });
		assert.equal(joined.game_data.state, "OPEN");
		assert.equal(joined.game_data.black_player_id, "bob");
		const item = peek("chess_db", gameId);
		assert.equal(item.state.S, "OPEN");
		assert.equal(item.black_player_id.S, "bob");
		assert.deepEqual(list("alice", "requested_games"), []);
		assert.deepEqual(list("alice", "open_games"), [gameId]);
		assert.deepEqual(list("bob", "open_games"), [gameId]);
		assert.equal(peek("user_db", "bob").last_friend_color.S, "b");

		assert.equal((await refused([["chess_db", gameId]], "POST", `/games/${gameId}/join`, { as: carol }, 409)).message, "Game is taken");
		assert.equal((await call("POST", `/games/${gameId}/join`, { as: bob })).status, 200); // A REPEAT ONLY GETS THE GAME
		assert.deepEqual((await call("GET", `/games/${gameId}/challenge`, { as: carol })).open, false);
	});

	test("not by its creator or a guest, and only on a challenge link", async () => {
		const gameId = await makeLink();
		const link = [["chess_db", gameId], ["user_db", "alice"]];
		await refused(link, "POST", `/games/${gameId}/join`, { as: alice }, 403);
		await refused(link, "POST", `/games/${gameId}/join`, { guest: "game2" }, 403);
		await refused(link, "POST", `/games/${gameId}/join`, { as: bob, body: { seat: "w" } }, 400);

		await friendGame("game1", "carol", "mallory", true); // AN INVITE TO SOMEONE ELSE
		for (const [method, route] of [["POST", "/games/game1/join"], ["GET", "/games/game1/challenge"]]) {
			const missing = await call(method, route, { as: bob });
			assert.deepEqual([missing.http, missing.status, missing.message], [404, 404, "Game data not found"], route);
		}
		assert.equal(peek("chess_db", "game1").black_player_id.S, "mallory");
	});

	test("the seat can't be named as a player", async () => {
		await refused([["user_db", "alice"]], "POST", "/games/invite", { as: alice, body: { opponent_id: "OPEN_SEAT" } }, 400);
	});

	test("an open friend game answers 409 until replace_current, which forfeits it only once the seat is taken", async () => {
		const gameId = await makeLink();
		await friendGame("game1", "carol", "bob");
		const busy = await call("POST", `/games/${gameId}/join`, { as: bob });
		assert.deepEqual([busy.http, busy.status, busy.open], [409, 409, true]);
		assert.equal(busy.game_id, "game1");
		assert.equal(peek("chess_db", gameId).state.S, "PENDING");
		assert.equal(peek("chess_db", "game1").state.S, "OPEN");

		const joined = await call("POST", `/games/${gameId}/join`, { as: bob, body: { replace_current: true } });
		assert.equal(joined.status, 200);
		assert.equal(joined.forfeited.game_id, "game1");
		assert.equal(peek("chess_db", "game1").winner.S, "w"); // CAROL
	});

	test("the creator in another friend game is refused", async () => {
		const gameId = await makeLink();
		await friendGame("game1", "alice", "carol");
		const busy = await refused([["chess_db", gameId]], "POST", `/games/${gameId}/join`, { as: bob }, 409);
		assert.equal(busy.message, "They're in another game now");
		assert.equal(busy.open, undefined); // ONLY THE REQUESTER'S OWN OPEN GAME SAYS open
	});

	test("the creator cancels: the game & its list entry go", async () => {
		const gameId = await makeLink();
		assert.equal((await call("POST", `/games/${gameId}/decline`, { as: alice })).status, 200);
		assert.equal(peek("chess_db", gameId), undefined);
		assert.deepEqual(list("alice", "requested_games"), []);
		assert.equal((await call("POST", `/games/${gameId}/join`, { as: bob })).message, "Game data not found");
	});
});

/* ---------------------------------------------------------------- */
// Accept & Decline
/* ---------------------------------------------------------------- */

describe("accept and decline", () => {
	for (const failing of ["alice", "bob"]) {
		test(`${failing}'s list save fails: the invite answers an error, and trying again makes one invite both players see`, async () => {
			const body = { opponent_id: "bob", color: "w" };
			const updateItem = DynamoDB.prototype.updateItem;
			DynamoDB.prototype.updateItem = async (params) => {
				if (params.Key.user_id?.S == failing) { throw Object.assign(new Error("The conditional request failed"), { name: "ConditionalCheckFailedException" }); }
				return updateItem(params);
			};
			let response;
			try {
				response = await call("POST", "/games/invite", { as: alice, body });
			} finally {
				DynamoDB.prototype.updateItem = updateItem;
			}
			assert.equal(response.http, 500);
			assert.equal(response.game_data, undefined);

			const retry = await call("POST", "/games/invite", { as: alice, body });
			assert.equal(retry.status, 200);
			const invites = async (id) => db.pruneInvites((await db.retrieveUser(id, true)).user_data);
			assert.equal((await invites("alice")).sent_invite.game_id, retry.game_data.game_id);
			assert.deepEqual((await invites("bob")).received_invites.map((invite) => invite.game_id), [retry.game_data.game_id]);
		});
	}

	test("the invited player accepts: the game opens for both", async () => {
		await friendGame("game1", "alice", "bob", true);
		const accepted = await call("POST", "/games/game1/accept", { as: bob });
		assert.equal(accepted.game_data.state, "OPEN");
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
		assert.equal(declined.game_data.game_id, "game1"); // FOR BOTH HOMES
		assert.equal(peek("chess_db", "game1"), undefined);
		assert.deepEqual(list("alice", "requested_games"), []);

		await friendGame("game2", "alice", "bob", true);
		assert.equal((await call("POST", "/games/game2/decline", { as: alice })).status, 200); // THE INVITER CANCELS
		await friendGame("game3", "alice", "bob");
		await refused([["chess_db", "game3"]], "POST", "/games/game3/decline", { as: bob }, 409);
	});
});

/* ---------------------------------------------------------------- */
// Accepting With An Open Friend Game
/* ---------------------------------------------------------------- */

describe("accept with an open friend game", () => {
	test("without replace_current: 409 with the open game, nothing changes", async () => {
		await friendGame("invite1", "alice", "bob", true);
		await friendGame("game1", "bob", "carol");
		const open = await refused([["chess_db", "invite1"], ["chess_db", "game1"]], "POST", "/games/invite1/accept", { as: bob }, 409);
		assert.equal(open.status, 409);
		assert.equal(open.open, true);
		assert.equal(open.game_id, "game1");
	});

	test("with replace_current: the open game is forfeited, the sent invite cancelled, the invite accepted", async () => {
		await friendGame("invite1", "alice", "bob", true);
		await friendGame("game1", "bob", "carol");
		await friendGame("invite2", "bob", "dave", true); // BOB'S SENT INVITE
		const accepted = await call("POST", "/games/invite1/accept", { as: bob, body: { replace_current: true } });
		assert.equal(accepted.game_data.state, "OPEN");
		assert.equal(accepted.forfeited.game_id, "game1");
		assert.equal(peek("chess_db", "game1").winner.S, "b"); // CAROL WINS
		assert.deepEqual(accepted.dropped_invites.map((invite) => invite.game_id), ["invite2"]);
		assert.equal(peek("chess_db", "invite2"), undefined);
	});

	test("an invite cancelled between the checks and the accept leaves the open game open & unrated", async () => {
		await friendGame("invite1", "alice", "bob", true);
		await friendGame("game1", "bob", "carol");
		await friendGame("invite2", "bob", "dave", true); // BOB'S SENT INVITE
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
