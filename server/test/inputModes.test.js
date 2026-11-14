/*
 *  inputModes.test.js  --  chess server tests
 *	Which of the game's listeners go on (client/src/js/gameplay/input/modes.js): a live game with the mouse, remote-only mode & the read-only board (#100)
 *
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { listenersFor } = require("../../client/src/js/gameplay/input/modes.js");

const LIVE = { pointer: true, remoteKeys: false, menu: true, prompts: true, gameActions: true, moveBox: true, moveList: true, pgn: true };
const READ_ONLY = { pointer: false, remoteKeys: false, menu: true, prompts: false, gameActions: false, moveBox: false, moveList: true, pgn: true };

test("a live game keeps today's listeners", () => {
	assert.deepEqual(listenersFor({ readOnly: false, remoteOnly: false, override: false }), LIVE);
	assert.deepEqual(listenersFor({ readOnly: false, remoteOnly: true, override: false }), { pointer: false, remoteKeys: true, menu: false, prompts: false, gameActions: true, moveBox: true, moveList: false, pgn: false });
	assert.deepEqual(listenersFor({ readOnly: false, remoteOnly: true, override: true }), { ...LIVE, remoteKeys: true });
});

test("read-only can't pick up a piece in any input mode", () => {
	for (const remoteOnly of [false, true]) {
		for (const override of [false, true]) {
			assert.deepEqual(listenersFor({ readOnly: true, remoteOnly, override }), READ_ONLY);
		}
	}
});
