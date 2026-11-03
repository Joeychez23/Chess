/*
 *  nav.test.js  --  chess server tests
 *	The menu's controller (client/src/js/pages/utils/nav.js), with a stand-in for the page
 *
 */

const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { createNav, startNav } = require("../../client/src/js/pages/utils/nav.js");

function fakeElement() {
	const listeners = {};
	return {
		style: {},
		attributes: {},
		setAttribute(name, value) { this.attributes[name] = String(value); },
		addEventListener(type, listener) { listeners[type] = listener; },
		fire(type, e = {}) { listeners[type]({ preventDefault() { }, stopPropagation() { }, ...e }); },
		contains(target) { return target == this || target?.inside == this; },
	};
}

describe("the menu's controller", () => {
	let optBtn, menu, page;

	beforeEach(() => {
		optBtn = fakeElement();
		menu = fakeElement();
		page = fakeElement();
		global.document = {
			getElementById(id) { return id == "optBtn" ? optBtn : menu; },
			addEventListener(type, listener) { page.addEventListener(type, listener); },
		};
	});

	function isOpen() { return menu.style.display == "flex" && optBtn.attributes["aria-expanded"] == "true"; }
	function isClosed() { return menu.style.display != "flex" && optBtn.attributes["aria-expanded"] == "false"; }

	test("it starts closed & the button opens & closes it", () => {
		startNav();
		assert.ok(isClosed());
		optBtn.fire("click");
		assert.ok(isOpen());
		optBtn.fire("click");
		assert.ok(isClosed());
	});

	test("Escape closes it, other keys don't", () => {
		startNav()(true);
		page.fire("keydown", { key: "a" });
		assert.ok(isOpen());
		page.fire("keydown", { key: "Escape" });
		assert.ok(isClosed());
	});

	test("a click away closes it, a click inside doesn't unless it's a link", () => {
		startNav()(true);
		const inside = { inside: menu, closest() { return null; } };
		page.fire("click", { target: inside });
		menu.fire("click", { target: inside });
		assert.ok(isOpen());
		menu.fire("click", { target: { inside: menu, closest() { return {}; } } });
		assert.ok(isClosed());
		startNav()(true);
		page.fire("click", { target: {} });
		assert.ok(isClosed());
	});

	test("the hooks run & canClose keeps it open from every way of closing", () => {
		let opens = 0;
		let closes = 0;
		let loading = true;
		const nav = createNav({
			onOpen() { opens++; },
			onClose() { closes++; },
			canClose() { return !loading; },
		});
		nav.addListeners();
		nav.toggleNav(true);
		assert.equal(opens, 1);
		optBtn.fire("click");
		page.fire("keydown", { key: "Escape" });
		page.fire("click", { target: {} });
		nav.toggleNav(false);
		assert.ok(isOpen());
		assert.equal(closes, 0);
		loading = false;
		page.fire("keydown", { key: "Escape" });
		assert.ok(isClosed());
		assert.equal(closes, 1);
	});

	test("force closes it while canClose says no", () => {
		const nav = createNav({ canClose() { return false; } });
		nav.toggleNav(true);
		nav.toggleNav(false, true);
		assert.ok(isClosed());
	});

	test("createNav doesn't listen until asked", () => {
		const nav = createNav();
		nav.toggleNav(true);
		assert.throws(() => page.fire("keydown", { key: "Escape" }));
		nav.addListeners();
		page.fire("keydown", { key: "Escape" });
		assert.ok(isClosed());
	});
});
