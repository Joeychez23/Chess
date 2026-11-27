/*
 *  exports.test.js  --  data service tests
 *	The data service folders keep their exports: db/ (dynamoDB.js moved into it) and controllers/game/ (the game routes split into it)
 *	Two groups, each in its own describe with its own requires and stubs
 *
 */

const { describe } = require("node:test");

/*
 *  db/: its index.js must export the same functions by the same names (a route whose database call went missing only throws
 *  when a request reaches it), the folder must keep one DynamoDB client, and updateOrConflict must answer a lost conditional
 *  write the way the old try/catch blocks did
 */
describe("db/", () => {
	require("../helpers/env.js");
	const { test, afterEach } = require("node:test");
	const assert = require("node:assert/strict");
	const fs = require("fs");
	const path = require("path");
	const { DynamoDB } = require("@aws-sdk/client-dynamodb");

	// The export list taken before the split (t26-exports.json, dynamoDB.after: initalize* renamed to initialize*)
	const EXPECTED_EXPORTS = [
		"acceptInvite", "acceptRematch", "anonymizeFriendGames", "cancelRematch", "changeFriends", "checkTables", "claimUsername",
		"closeGame", "deleteInvite", "deleteUser", "endDrawOffer", "endSession", "endTakeback", "expireFinishedAiGames", "findUsername",
		"finishClosedGame", "initializeGame", "initializeUser", "leaveFriends", "movePlayersGame", "offerDraw", "pruneClosedGames",
		"pruneInvites", "pruneOpenGames", "rateGame", "requestRematch", "requestTakeback", "retrieveFriends", "retrieveGame",
		"retrieveRatings", "retrieveUser", "saveCardsState", "saveLastColor", "saveOpening", "searchUsernames", "startSession",
		"takeOpenSeat", "updateGame", "updateUser", "updateUserSettings",
	];

	const DB_FOLDER = path.join(__dirname, "..", "..", "db");
	const realUpdateItem = DynamoDB.prototype.updateItem;

	afterEach(() => { DynamoDB.prototype.updateItem = realUpdateItem; });

	test("db/index exports the pre-split set", () => {
		const exported = require("../../db/index.js");
		assert.deepStrictEqual(Object.keys(exported).sort(), EXPECTED_EXPORTS);
		for (const name of EXPECTED_EXPORTS) {
			assert.equal(typeof exported[name], "function", `${name} is a function`);
		}
	});

	test("one DynamoDB client", () => {
		const files = fs.readdirSync(DB_FOLDER).filter((file) => /^db\..+\.js$/.test(file));
		assert.ok(files.includes("db.client.js"));
		for (const file of files) {
			const source = fs.readFileSync(path.join(DB_FOLDER, file), "utf8");
			const clients = (source.match(/new DynamoDB(Client)?\b/g) || []).length;
			if (file == "db.client.js") {
				assert.equal(clients, 1, "db.client.js makes the one client");
				continue;
			}
			assert.equal(clients, 0, `${file} makes no client of its own`);
			assert.match(source, /require\("\.\/db\.client\.js"\)/, `${file} uses db.client.js`);
		}
		const index = fs.readFileSync(path.join(DB_FOLDER, "index.js"), "utf8");
		assert.doesNotMatch(index, /new DynamoDB(Client)?\b/);
	});

	test("updateOrConflict turns a conditional-check failure into the caller's reply", async () => {
		const { updateOrConflict } = require("../../db/db.client.js");
		const params = { TableName: "chess_db", Key: { game_id: { S: "game1" } }, UpdateExpression: "SET a = :a" };

		DynamoDB.prototype.updateItem = async () => { throw Object.assign(new Error("lost"), { name: "ConditionalCheckFailedException" }); };
		assert.deepStrictEqual(await updateOrConflict(params, "Board changed before the move saved: game1"),
			{ status: 409, message: "Board changed before the move saved: game1" });

		let sent;
		DynamoDB.prototype.updateItem = async (request) => {
			sent = request;
			return { Attributes: { game_id: { S: "game1" } } };
		};
		const saved = await updateOrConflict(params, "unused");
		assert.equal(saved.status, 200);
		assert.deepStrictEqual(saved.response, { Attributes: { game_id: { S: "game1" } } });
		assert.equal(sent, params, "the params go to DynamoDB as given");
	});

	test("updateOrConflict rethrows any other error", async () => {
		const { updateOrConflict } = require("../../db/db.client.js");
		const throttled = Object.assign(new Error("slow down"), { name: "ProvisionedThroughputExceededException" });
		DynamoDB.prototype.updateItem = async () => { throw throttled; };
		await assert.rejects(updateOrConflict({ TableName: "chess_db" }, "unused"), (err) => err === throttled);
	});
});

/*
 *  controllers/game/: its index.js must export the same handlers by the same names: a route whose handler went missing only
 *  throws when a request reaches it
 */
describe("controllers/game/", () => {
	require("../helpers/env.js");
	const { test } = require("node:test");
	const assert = require("node:assert/strict");

	// The export list taken before the split (t26-exports.json, gameController.after)
	const EXPECTED_EXPORTS = [
		"acceptGame", "aiDrawGame", "aiMoveGame", "cancelRematchGame", "challengeGame", "currentGame", "declineDrawGame", "declineGame",
		"declineTakebackGame", "drawGame", "forfeitGame", "getChallenge", "getGame", "getRatings", "inviteGame", "joinGame", "moveGame",
		"newAiGame", "newCardsGame", "newGuestGame", "openingGame", "rematchGame", "saveCardsGame", "takebackGame",
	];

	test("controllers/game/index.js exports the pre-split set", () => {
		const exported = require("../../controllers/game/index.js");
		assert.deepStrictEqual(Object.keys(exported).sort(), EXPECTED_EXPORTS);
		for (const name of EXPECTED_EXPORTS) {
			assert.equal(typeof exported[name], "function", `${name} is a function`);
		}
	});
});
