/*
 *  plainItems.test.js  --  chess server tests
 *	Shared Checks On Plain Items
 *  utils/plainItems.js: the shared game checks & rating read give the same answers on the plain items the data service hands the server
 *
 */

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const plain = require("../../utils/plainItems.js");

describe("toItem", () => {
	test("puts each plain value back in the shape the shared files read", () => {
		assert.deepEqual(plain.toItem({ game_id: "g1", moves: ["e4"], takeback_count: 2, open: true, gone: null }), {
			game_id: { S: "g1" }, moves: { S: ["e4"] }, takeback_count: { N: "2" }, open: { BOOL: true }, gone: { NULL: true }
		});
		assert.equal(plain.toItem(null), null);
		assert.equal(plain.toItem(undefined), undefined);
	});
});

describe("the shared checks on plain items", () => {
	test("gameOpen & gamePending read a plain state", () => {
		assert.equal(plain.gameOpen({ state: "OPEN" }), true);
		assert.equal(plain.gameOpen({}), true); // GAMES FROM BEFORE state ARE OPEN
		assert.equal(plain.gameOpen({ state: "CLOSED" }), false);
		assert.equal(plain.gamePending({ state: "PENDING" }), true);
		assert.equal(plain.gamePending({ state: "OPEN" }), false);
	});

	test("isAiGame, playerName & inviterId read plain player fields", () => {
		const game = { white_player_id: "alice", black_player_id: "CHESS_AI", white_name: "Alice" };
		assert.equal(plain.isAiGame(game), true);
		assert.equal(plain.isAiGame({ white_player_id: "alice", black_player_id: "bob" }), false);
		assert.equal(plain.playerName(game, "w"), "Alice");
		assert.equal(plain.playerName(game, "b"), null);
		assert.equal(plain.inviterId(game), "alice");
		assert.equal(plain.inviterId({ ...game, inviter_id: "bob" }), "bob");
	});

	test("startParams & takebacksLeft read plain JSON text & numbers", () => {
		assert.equal(plain.startParams({ start_params: JSON.stringify({ color: "b" }) }).color, "b");
		assert.equal(plain.takebacksLeft({ takeback_count: 1 }) + 1, plain.takebacksLeft({}));
	});

	test("readRating reads plain numbers", () => {
		assert.deepEqual(plain.readRating({ rating: 1620, rated_games: 7 }), { rating: 1620, rated_games: 7 });
		assert.deepEqual(plain.readRating(null), plain.readRating({}));
	});
});

describe("server code reads items through plainItems.js", () => {
	test("no server file takes an item check straight from games.js or rating.js", () => {
		// THE SHARED FILES READ DynamoDB ITEMS: ON A PLAIN ITEM gameOpen({ state: "CLOSED" }) ANSWERS true WITH NO ERROR
		const fs = require("node:fs");
		const path = require("node:path");
		const root = path.join(__dirname, "../..");
		const wrapped = Object.keys(plain).filter((name) => name != "toItem");
		const skip = ["node_modules", "test", "games.js", "rating.js", "validate.js", "plainItems.js"];
		const files = fs.readdirSync(root, { recursive: true }).filter((file) => file.endsWith(".js") && !file.split(path.sep).some((part) => skip.includes(part)));
		assert.ok(files.length > 20);
		const taken = [];
		for (const file of files) {
			const source = fs.readFileSync(path.join(root, file), "utf8");
			for (const [, names] of source.matchAll(/\{([^}]*)\}\s*=\s*require\([^)]*(?:games|rating)\.js/g)) {
				for (const name of wrapped) { if (new RegExp(`\\b${name}\\b`).test(names)) { taken.push(`${file}: ${name}`); } }
			}
		}
		assert.deepEqual(taken, []);
	});
});
