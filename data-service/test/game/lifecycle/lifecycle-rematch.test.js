/*
 *  lifecycle-rematch.test.js  --  data service tests
 *	Ending Games: Rematches (controllers/game/)
 *  Rematches of closed friend games: each only for the player in the request, only on
 *  games they can act on, with only the fields the route names. A refused request makes or changes nothing
 *
 */

require("../../helpers/env.js");
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const service = require("../../helpers/service.js");
const { call, peek } = service;
const db = require("../../../db/index.js");
const { DynamoDB } = require("@aws-sdk/client-dynamodb");
const { alice, bob, carol, mallory, list, friendGame, refused } = require("../../helpers/lifecycle.js");

async function closedFriendGame(gameId, white, black) {
	const created = (await friendGame(gameId, white, black)).game_data;
	await db.closeGame(created, "w", "forfeit");
}

/* ---------------------------------------------------------------- */
// Rematch
/* ---------------------------------------------------------------- */

describe("rematch", () => {
	test("a request stays open for 5 minutes", async () => {
		await closedFriendGame("game1", "alice", "bob");
		const first = await call("POST", "/games/game1/rematch", { as: alice });
		assert.equal(first.expires_in, 5 * 60 * 1000);
		assert.ok(Number(peek("chess_db", "game1").rematch_expires.N) > Date.now() + 4 * 60 * 1000);
	});

	test("cancel takes the request back: the other press waits instead of starting a game", async () => {
		await closedFriendGame("game1", "alice", "bob");
		await call("POST", "/games/game1/rematch", { as: alice });
		const cancelled = await call("POST", "/games/game1/rematch/cancel", { as: alice });
		assert.equal(cancelled.cancelled, true);
		assert.equal(peek("chess_db", "game1").rematch_player_id, undefined);
		assert.equal((await call("POST", "/games/game1/rematch/cancel", { as: alice })).cancelled, true); // SAFE TO REPEAT
		assert.equal((await call("POST", "/games/game1/rematch", { as: bob })).waiting, true);
	});

	test("cancel is too late once the other press started it, and doesn't touch the other player's request", async () => {
		await closedFriendGame("game1", "alice", "bob");
		await call("POST", "/games/game1/rematch", { as: alice });
		assert.equal((await call("POST", "/games/game1/rematch/cancel", { as: bob })).cancelled, true); // BOB HAS NOTHING OPEN
		assert.equal(peek("chess_db", "game1").rematch_player_id.S, "alice");
		await call("POST", "/games/game1/rematch", { as: bob });
		assert.equal((await call("POST", "/games/game1/rematch/cancel", { as: alice })).cancelled, false);
	});

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
		assert.deepEqual(second.dropped_invites.map((invite) => invite.game_id), ["invite1"]);
		assert.equal((await call("POST", "/games/game1/rematch", { as: alice })).new_game_id, second.new_game_id); // PRESSED AGAIN: THE SAME GAME
	});

	for (const failing of ["alice", "bob"]) {
		test(`${failing}'s list save fails: the press answers an error, pressing again puts the game on both lists and cancels both sent invites`, async () => {
			await closedFriendGame("game1", "alice", "bob");
			await friendGame("invite1", "alice", "carol", true);
			await friendGame("invite2", "bob", "carol", true);
			await call("POST", "/games/game1/rematch", { as: alice });
			const updateItem = DynamoDB.prototype.updateItem;
			DynamoDB.prototype.updateItem = async (params) => {
				if (params.Key.user_id?.S == failing) { throw new Error("Save failed"); }
				return updateItem(params);
			};
			try {
				assert.equal((await call("POST", "/games/game1/rematch", { as: bob })).http, 500);
			} finally {
				DynamoDB.prototype.updateItem = updateItem;
			}
			const rematchId = peek("chess_db", "game1").rematch_game_id.S;
			assert.equal(list(failing, "open_games").includes(rematchId), false);

			const again = await call("POST", "/games/game1/rematch", { as: alice });
			assert.equal(again.new_game_id, rematchId);
			assert.equal(again.game_data.game_id, rematchId);
			assert.ok(list("alice", "open_games").includes(rematchId));
			assert.ok(list("bob", "open_games").includes(rematchId));
			assert.equal(peek("chess_db", "invite1"), undefined);
			assert.equal(peek("chess_db", "invite2"), undefined);
			assert.deepEqual(again.dropped_invites.map((invite) => invite.game_id).sort(), ["invite1", "invite2"]);
		});
	}

	async function pressWithGameSaveFailing() { // THE CLAIM SAVES, THE NEW GAME DOESN'T
		await closedFriendGame("game1", "alice", "bob");
		await call("POST", "/games/game1/rematch", { as: alice });
		const putItem = DynamoDB.prototype.putItem;
		DynamoDB.prototype.putItem = async (params) => {
			if (params.Item.game_id) { throw new Error("Save failed"); }
			return putItem(params);
		};
		try {
			assert.equal((await call("POST", "/games/game1/rematch", { as: bob })).http, 500);
		} finally {
			DynamoDB.prototype.putItem = putItem;
		}
		const rematchId = peek("chess_db", "game1").rematch_game_id.S;
		assert.equal(peek("chess_db", rematchId), undefined);
		return rematchId;
	}

	test("the game save fails: pressing again makes it under the saved id", async () => {
		const rematchId = await pressWithGameSaveFailing();
		const again = await call("POST", "/games/game1/rematch", { as: alice });
		assert.equal(again.new_game_id, rematchId);
		assert.equal(peek("chess_db", rematchId).state.S, "OPEN");
		assert.equal(peek("chess_db", rematchId).white_player_id.S, "alice");
		assert.ok(list("alice", "open_games").includes(rematchId));
		assert.ok(list("bob", "open_games").includes(rematchId));
	});

	test("the game save fails and a player starts another friend game: pressing again makes nothing", async () => {
		const rematchId = await pressWithGameSaveFailing();
		await friendGame("game2", "bob", "carol");
		assert.equal((await call("POST", "/games/game1/rematch", { as: alice })).http, 409);
		assert.equal(peek("chess_db", rematchId), undefined);
	});

	test("the other press saves the game first: this press uses it", async () => {
		await closedFriendGame("game1", "alice", "bob");
		await call("POST", "/games/game1/rematch", { as: alice });
		const putItem = DynamoDB.prototype.putItem;
		DynamoDB.prototype.putItem = async (params) => {
			DynamoDB.prototype.putItem = putItem;
			await friendGame(params.Item.game_id.S, "alice", "bob");
			return putItem(params);
		};
		const second = await call("POST", "/games/game1/rematch", { as: bob });
		assert.equal(second.status, 200);
		assert.equal(second.game_data.game_id, second.new_game_id);
	});

	test("a rematch that has ended: pressing again changes nothing", async () => {
		await closedFriendGame("game1", "alice", "bob");
		await call("POST", "/games/game1/rematch", { as: alice });
		const { new_game_id } = await call("POST", "/games/game1/rematch", { as: bob });
		await db.closeGame((await db.retrieveGame(new_game_id, true)).game_data, "w", "forfeit");
		await friendGame("invite1", "alice", "carol", true); // SENT SINCE IT ENDED
		const again = await call("POST", "/games/game1/rematch", { as: alice });
		assert.equal(again.new_game_id, new_game_id);
		assert.equal(again.game_data, undefined);
		assert.ok(peek("chess_db", "invite1"));
		assert.equal(list("alice", "open_games").includes(new_game_id), false);
	});

	async function expiredRematch(claimAge) { // BOTH PRESSED, THEN TTL DELETED THE REMATCH
		await closedFriendGame("game1", "alice", "bob");
		await call("POST", "/games/game1/rematch", { as: alice });
		const { new_game_id } = await call("POST", "/games/game1/rematch", { as: bob });
		await DynamoDB.prototype.deleteItem({ TableName: "chess_db", Key: { game_id: { S: new_game_id } } });
		await DynamoDB.prototype.updateItem({ TableName: "chess_db", Key: { game_id: { S: "game1" } }, UpdateExpression: "SET rematch_expires = :expires", ExpressionAttributeValues: { ":expires": { N: `${Date.now() - claimAge}` } } });
		return new_game_id;
	}

	test("a rematch TTL deleted: a press makes nothing and leaves the other player alone", async () => {
		const rematchId = await expiredRematch(25 * 24 * 60 * 60 * 1000);
		await friendGame("invite1", "bob", "carol", true); // BOB'S SENT INVITE
		const bobBefore = peek("user_db", "bob");
		const again = await call("POST", "/games/game1/rematch", { as: alice });
		assert.equal(again.http, 409);
		assert.equal(again.message, "Rematch ended");
		assert.equal(peek("chess_db", rematchId), undefined);
		assert.ok(peek("chess_db", "invite1"));
		assert.deepEqual(peek("user_db", "bob"), bobBefore);
	});

	test("a rematch TTL deleted: a press doesn't bring back the row of a player who deleted their data", async () => {
		await expiredRematch(25 * 24 * 60 * 60 * 1000);
		await DynamoDB.prototype.deleteItem({ TableName: "user_db", Key: { user_id: { S: "bob" } } });
		assert.equal((await call("POST", "/games/game1/rematch", { as: alice })).http, 409);
		assert.equal(peek("user_db", "bob"), undefined);
	});

	test("the repair window: a missing game is made just inside it and refused just past it", async () => {
		const rematchId = await expiredRematch(59 * 60 * 1000);
		assert.equal((await call("POST", "/games/game1/rematch", { as: alice })).new_game_id, rematchId);
		assert.equal(peek("chess_db", rematchId).state.S, "OPEN");

		service.reset();
		const oldId = await expiredRematch(61 * 60 * 1000);
		assert.equal((await call("POST", "/games/game1/rematch", { as: alice })).http, 409);
		assert.equal(peek("chess_db", oldId), undefined);
	});

	test("a claim with no rematch_expires counts as old", async () => {
		const rematchId = await expiredRematch(0);
		await DynamoDB.prototype.updateItem({ TableName: "chess_db", Key: { game_id: { S: "game1" } }, UpdateExpression: "REMOVE rematch_expires" });
		assert.equal((await call("POST", "/games/game1/rematch", { as: alice })).http, 409);
		assert.equal(peek("chess_db", rematchId), undefined);
	});

	test("this press's own claim is made even when the game it read had a long gone request", async () => {
		await closedFriendGame("game1", "alice", "bob");
		await db.requestRematch("game1", "alice", Date.now() - 2 * 60 * 60 * 1000);
		const updateItem = DynamoDB.prototype.updateItem;
		DynamoDB.prototype.updateItem = async (params) => { // ALICE PRESSES AGAIN AFTER BOB'S PRESS READ THE GAME
			DynamoDB.prototype.updateItem = updateItem;
			await db.requestRematch("game1", "alice", Date.now() + 60 * 1000);
			return updateItem(params);
		};
		const second = await call("POST", "/games/game1/rematch", { as: bob });
		assert.equal(second.status, 200);
		assert.equal(peek("chess_db", second.new_game_id).state.S, "OPEN");
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
		await db.initializeGame("game2", "alice", "CHESS_AI", 3, { start_params: { color: "w" } });
		await db.closeGame((await db.retrieveGame("game2")).game_data, "b", "forfeit");
		await refused([["chess_db", "game2"]], "POST", "/games/game2/rematch", { as: alice }, 409);
		await closedFriendGame("game3", "carol", "dave");
		await refused([["chess_db", "game3"]], "POST", "/games/game3/rematch", { as: mallory }, 403);
		await friendGame("game4", "dave", "erin"); // DAVE IS IN ANOTHER FRIEND GAME
		await refused([["chess_db", "game3"]], "POST", "/games/game3/rematch", { as: carol }, 409);
	});
});
