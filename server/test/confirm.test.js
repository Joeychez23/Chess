/*
 *  confirm.test.js  --  chess server tests
 *	The menus' two press confirm (client/src/js/pages/utils/confirm.js)
 *
 */

const { test, describe, beforeEach, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const { confirmPress, disarmConfirm } = require("../../client/src/js/pages/utils/confirm.js");

const ASKING = "Are you sure?";

describe("confirmPress", () => {
	beforeEach(() => { mock.timers.enable({ apis: ["setTimeout"] }); });
	afterEach(() => {
		disarmConfirm();
		mock.timers.reset();
	});

	test("the first press asks, the second acts & puts the text back", () => {
		const btn = { textContent: "Forfeit" };
		assert.equal(confirmPress(btn), false);
		assert.equal(btn.textContent, ASKING);
		assert.equal(confirmPress(btn), true);
		assert.equal(btn.textContent, "Forfeit");
	});

	test("the question goes away after 5 seconds", () => {
		const btn = { textContent: "Restart" };
		confirmPress(btn);
		mock.timers.tick(4999);
		assert.equal(btn.textContent, ASKING);
		mock.timers.tick(1);
		assert.equal(btn.textContent, "Restart");
		assert.equal(confirmPress(btn), false);
	});

	test("closing the menu disarms it, a press after reopening only asks", () => {
		const btn = { textContent: "Forfeit" };
		confirmPress(btn);
		disarmConfirm();
		assert.equal(btn.textContent, "Forfeit");
		assert.equal(confirmPress(btn), false);
	});

	test("an old timer doesn't cut a newer question short", () => {
		const btn = { textContent: "Forfeit" };
		confirmPress(btn);
		mock.timers.tick(4000);
		disarmConfirm();
		confirmPress(btn);
		mock.timers.tick(4000);
		assert.equal(btn.textContent, ASKING);
		assert.equal(confirmPress(btn), true);
	});

	test("a timer left from the second press doesn't touch a text set later", () => {
		const btn = { textContent: "Forfeit" };
		confirmPress(btn);
		confirmPress(btn);
		btn.textContent = "Rematch"; // THE GAME ENDED
		mock.timers.tick(5000);
		assert.equal(btn.textContent, "Rematch");
	});

	test("pressing another button moves the question to it", () => {
		const restart = { textContent: "Restart" };
		const logout = { textContent: "Logout" };
		confirmPress(restart);
		assert.equal(confirmPress(logout), false);
		assert.equal(restart.textContent, "Restart");
		assert.equal(logout.textContent, ASKING);
		assert.equal(confirmPress(restart), false); // RESTART HAS TO ASK AGAIN
	});

	test("disarming with nothing waiting changes nothing", () => {
		assert.doesNotThrow(() => disarmConfirm());
	});
});
