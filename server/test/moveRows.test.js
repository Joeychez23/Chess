/*
 *  moveRows.test.js  --  chess server tests
 *	The move list's numbered rows (client/src/js/gameplay/movelist/rows.js) & the ply of each move, which the replay highlights & jumps to (#102)
 *
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { moveRows } = require("../../client/src/js/gameplay/movelist/rows.js");

test("rows carry the ply of each move", () => {
	assert.deepEqual(moveRows(["e4", "e5", "Nf3"]), [
		{ number: 1, white: "e4", black: "e5", whitePly: 1, blackPly: 2 },
		{ number: 2, white: "Nf3", black: "", whitePly: 3, blackPly: null },
	]);
	assert.deepEqual(moveRows(["Kd7", "O-O", "Ke6"], "r3k3/8/8/8/8/8/8/4K2R b Kq - 0 7"), [
		{ number: 7, white: "…", black: "Kd7", whitePly: null, blackPly: 1 },
		{ number: 8, white: "O-O", black: "Ke6", whitePly: 2, blackPly: 3 },
	]);
	assert.deepEqual(moveRows([]), []);
});
