/*
 *  dropdown.test.js  --  chess server tests
 *	The dropdowns (client/src/js/pages/utils/dropdown.js) of Home, Settings & Guest: the keys of an open list
 *
 */

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { stepOption, listAction } = require("../../client/src/js/pages/utils/dropdown.js");

describe("an open dropdown's keys", () => {
	test("Up, Down, W & S move one option & loop at the ends", () => {
		assert.equal(stepOption(5, 2, "ArrowDown"), 3);
		assert.equal(stepOption(5, 2, "ArrowUp"), 1);
		assert.equal(stepOption(5, 2, "s"), 3);
		assert.equal(stepOption(5, 2, "W"), 1);
		assert.equal(stepOption(5, 4, "ArrowDown"), 0); // THE LAST GOES TO THE FIRST
		assert.equal(stepOption(5, 0, "w"), 4); // THE FIRST GOES TO THE LAST
		assert.equal(stepOption(5, 4, "s"), 0);
		assert.equal(stepOption(5, 0, "ArrowUp"), 4);
		assert.equal(stepOption(1, 0, "S"), 0);
	});

	test("Home & End go to the first & last option", () => {
		assert.equal(stepOption(5, 3, "Home"), 0);
		assert.equal(stepOption(5, 1, "End"), 4);
	});

	test("Enter & Space pick, Escape, Backspace & Delete close, Tab & other keys do nothing", () => {
		for (const key of ["ArrowUp", "ArrowDown", "w", "s", "W", "S", "Home", "End"]) { assert.equal(listAction(key), "move", key); }
		assert.equal(listAction("Enter"), "pick");
		assert.equal(listAction(" "), "pick");
		assert.equal(listAction("Escape"), "close");
		assert.equal(listAction("Backspace"), "close");
		assert.equal(listAction("Delete"), "close");
		for (const key of ["Tab", "a", "d", "ArrowLeft", "ArrowRight"]) { assert.equal(listAction(key), null, key); }
	});
});
