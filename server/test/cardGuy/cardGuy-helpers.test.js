/*
 *  cardGuy-helpers.test.js  --  chess server tests
 *	Card Guy's small shared helpers (server/utils/card-guy/index.js)
 *
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { otherColor } = require("../../utils/card-guy/index.js");

test("otherColor flips w and b", () => {
	assert.equal(otherColor("w"), "b");
	assert.equal(otherColor("b"), "w");
});
