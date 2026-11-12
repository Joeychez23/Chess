/*
 *  monitorData.test.js  --  chess frontend tests
 *	What the game gives the 3D room's monitor (client/src/js/gameplay/monitor/data.js): its actions from the menu's items, the result line
 *	& the eval scores by ply. Run with npm run test:client
 *
 */

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { actionsFrom, resultText, trimScores, plyOf, startPlyFor } = require("../src/js/gameplay/monitor/data.js");

describe("the monitor's data", () => {
	test("an action is enabled exactly when its menu item isn't hidden or unavailable", () => {
		const items = { hint: { hidden: false, unavailable: false, text: "Hint" }, takeback: { hidden: false, unavailable: true, text: "Takeback Asked" }, draw: { hidden: true, unavailable: false, text: "Offer Draw" }, restart: { hidden: false, unavailable: false, text: "Forfeit" }, pgn: { hidden: true, unavailable: false, text: "Download PGN" } };
		assert.deepEqual(actionsFrom(items), [
			{ id: "hint", label: "HINT", shown: true, enabled: true },
			{ id: "takeback", label: "TAKEBACK ASKED", shown: true, enabled: false },
			{ id: "draw", label: "OFFER DRAW", shown: false, enabled: false },
			{ id: "restart", label: "FORFEIT", shown: true, enabled: true },
			{ id: "pgn", label: "DOWNLOAD PGN", shown: false, enabled: false },
		]);
	});
	test("the result reads as the menu's title and reason", () => {
		assert.equal(resultText("White Wins!", "by Checkmate"), "WHITE WINS! BY CHECKMATE");
		assert.equal(resultText("Draw", ""), "DRAW");
	});
	test("scores past the last ply are dropped, missing ones are null", () => {
		assert.deepEqual(trimScores([50, 54, 61, 70], 2), [50, 54, 61]);
		assert.deepEqual(trimScores([50], 3), [50, null, null, null]);
	});
	test("a missing menu item is a hidden action", () => {
		assert.deepEqual(actionsFrom({}).map((a) => [a.id, a.shown, a.enabled]), [["hint", false, false], ["takeback", false, false], ["draw", false, false], ["restart", false, false], ["pgn", false, false]]);
	});
	test("a board's ply counts the moves from the standard start", () => {
		assert.equal(plyOf("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"), 0);
		assert.equal(plyOf("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"), 1);
		assert.equal(plyOf("r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3"), 4);
		assert.equal(plyOf(""), 0);
	});
	test("the start ply comes only from a game with start_params, a move's answer keeps it", () => {
		const setUp = { start_params: { fen: "8/8/8/8/8/8/4k3/4K2R w K - 0 10" } };
		assert.equal(startPlyFor(0, setUp), 18);
		assert.equal(startPlyFor(18, { game_board: "8/8/8/8/8/8/4k3/4K1R1 b - - 1 10" }), 18);
		assert.equal(startPlyFor(18, { start_params: {} }), 0);
		assert.equal(startPlyFor(5, null), 5);
	});
});
