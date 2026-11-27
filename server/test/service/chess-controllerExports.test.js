/*
 *  chess-controllerExports.test.js  --  chess server tests
 *	The chess controller's folder (controllers/chess/)
 *  The folder answers with the same exports the one chessController.js file had, keeps one copy of the AI turn & analysis maps,
 *  and loadMyGame answers the shared handler opening the same way the handlers did
 *
 */

require("../helpers/env.js");
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

// The data service's answers, by game id. Set before the folder is loaded: its files take retrieveGame when they're required
const dataClient = require("../../dataClient.js");
const answers = new Map();
const reads = [];
dataClient.retrieveGame = async function (gameId, consistent) {
	reads.push({ gameId, consistent });
	return answers.get(gameId);
};

const chess = require("../../controllers/chess/index.js");
const chessGuards = require("../../controllers/chess/chess.guards.js");

const CHESS_FOLDER = path.join(__dirname, "../../controllers/chess");

function fakeResponse() {
	const res = { code: 200, body: null };
	res.status = function (code) { res.code = code; return res; };
	res.json = function (body) { res.body = body; return res; };
	return res;
}

describe("controllers/chess", () => {
	test("chess/index exports the pre-split set", () => {
		const expected = ["acceptGame", "aiLevel", "aiMoveGame", "analysisGame", "cancelRematchGame", "challengeGame", "currentGame", "declineDrawGame",
			"declineGame", "declineTakebackGame", "drawGame", "forfeitGame", "getChallenge", "getGame", "getLevels", "getPgn", "getRatings", "getUserGames",
			"httpStatus", "inviteGame", "isStatusDisplay", "joinGame", "leaveAllGames", "moveGame", "newGame", "notInGame", "notYours", "playerInGame",
			"readSettings", "rematchGame", "reply", "restartGame", "retrieveGame", "takebackGame", "userPlayerId"];
		assert.deepStrictEqual(Object.keys(chess).sort(), expected);
		for (const name of expected) { assert.equal(typeof chess[name], "function", name); }
	});

	test("aiTurns and runningAnalyses live once, in chess.play.js", () => {
		const files = fs.readdirSync(CHESS_FOLDER).filter((file) => file.endsWith(".js"));
		assert.ok(files.includes("chess.play.js"));
		for (const file of files) {
			const source = fs.readFileSync(path.join(CHESS_FOLDER, file), "utf8");
			const declared = source.match(/(const|let|var)\s+(aiTurns|runningAnalyses)\b/g) || [];
			assert.equal(declared.length, file == "chess.play.js" ? 2 : 0, file);
		}
	});

	test("loadMyGame replies 404 and returns null for a missing game", async () => {
		answers.set("gone", { status: 500, message: "Game data not found" });
		const res = fakeResponse();
		const loaded = await chessGuards.loadMyGame({ params: { gameId: "gone" }, user: { user_id: "auth0|alice" } }, res);
		assert.equal(loaded, null);
		assert.equal(res.code, 404); // As moveGame's opening answered it
		assert.deepEqual(res.body, { status: 404, message: "Game data not found" });
	});

	test("loadMyGame returns null after replying for a game the player is not in", async () => {
		answers.set("theirs", { status: 403, message: "Player is not in this game" });
		const signedIn = fakeResponse();
		assert.equal(await chessGuards.loadMyGame({ params: { gameId: "theirs" }, user: { user_id: "auth0|alice" } }, signedIn), null);
		assert.equal(signedIn.code, 403);
		assert.deepEqual(signedIn.body, { status: 403, message: "Player is not in this game" });

		const guest = fakeResponse();
		assert.equal(await chessGuards.loadMyGame({ params: { gameId: "theirs" }, user: null }, guest), null);
		assert.equal(guest.code, 401); // A signed-in player whose token ran out looks like a guest; the client renews the session
		assert.deepEqual(guest.body, { status: 401, message: "NOT SIGNED IN" });
	});

	test("loadMyGame returns the read and passes consistentRead on", async () => {
		const read = { status: 200, game_data: { game_id: "mine" }, message: "Retrieved game id: mine" };
		answers.set("mine", read);
		reads.length = 0;
		const res = fakeResponse();
		assert.equal(await chessGuards.loadMyGame({ params: { gameId: "mine" }, user: { user_id: "auth0|alice" } }, res, { consistentRead: true }), read);
		assert.equal(await chessGuards.loadMyGame({ params: { gameId: "mine" }, user: { user_id: "auth0|alice" } }, res), read);
		assert.deepEqual(reads, [{ gameId: "mine", consistent: true }, { gameId: "mine", consistent: undefined }]);
		assert.equal(res.body, null); // Nothing sent: the handler answers
	});
});
