/*
 *  menuItem.test.js  --  chess server tests
 *	The menu items' shared states (client/src/js/pages/utils/menuItem.js), with a stand-in for the item
 *
 */

const { test, describe, beforeEach, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const { setUnavailable, setFill, stopFill, isBusy, fillThenGo } = require("../../client/src/js/pages/utils/menuItem.js");

function fakeItem(text = "Home") {
	const classes = new Set();
	const props = {};
	const attributes = {};
	return {
		innerText: text,
		attributes,
		classList: {
			add(name) { classes.add(name); },
			remove(name) { classes.delete(name); },
			contains(name) { return classes.has(name); },
		},
		style: {
			getPropertyValue(name) { return props[name] ?? ""; },
			setProperty(name, value) { props[name] = String(value); },
			removeProperty(name) { delete props[name]; },
		},
		setAttribute(name, value) { attributes[name] = value; },
		removeAttribute(name) { delete attributes[name]; },
	};
}

describe("the menu items' states", () => {
	let item;

	beforeEach(() => {
		item = fakeItem();
		mock.timers.enable({ apis: ["setTimeout"] });
	});

	afterEach(() => {
		mock.timers.reset();
		delete global.window;
	});

	test("unavailable turns aria-disabled on & off", () => {
		setUnavailable(item, true);
		assert.equal(item.attributes["aria-disabled"], "true");
		setUnavailable(item, false);
		assert.equal(item.attributes["aria-disabled"], undefined);
	});

	test("the fill starts from empty, only goes up & comes off", () => {
		setFill(item, 0.5);
		assert.ok(isBusy(item));
		assert.equal(item.style.getPropertyValue("--load"), "");
		mock.timers.tick(50);
		assert.equal(item.style.getPropertyValue("--load"), "0.5");
		setFill(item, 0.2);
		assert.equal(item.style.getPropertyValue("--load"), "0.5");
		setFill(item, 0.9);
		assert.equal(item.style.getPropertyValue("--load"), "0.9");
		stopFill(item);
		assert.ok(!isBusy(item));
		assert.equal(item.style.getPropertyValue("--load"), "");
	});

	test("an answer before the fill is drawn leaves it empty", () => {
		setFill(item);
		stopFill(item);
		mock.timers.tick(50);
		assert.equal(item.style.getPropertyValue("--load"), "");
	});

	test("leaving says Loading, fills up, goes to the page & Back puts it back", () => {
		let pageshow;
		global.window = {
			location: { href: "/here" },
			addEventListener(type, listener) { assert.equal(type, "pageshow"); pageshow = listener; },
		};
		fillThenGo(item, "/settings");
		assert.equal(item.innerText, "Loading");
		mock.timers.tick(50);
		assert.equal(item.style.getPropertyValue("--load"), "1");
		assert.equal(global.window.location.href, "/here");
		mock.timers.tick(200);
		assert.equal(global.window.location.href, "/settings");
		pageshow();
		assert.equal(item.innerText, "Home");
		assert.ok(!isBusy(item));
	});
});
