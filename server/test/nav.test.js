/*
 *  nav.test.js  --  chess server tests
 *	The menu's controller (client/src/js/pages/utils/nav.js), with a stand-in for the page
 *
 */

const { test, describe, beforeEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const { createNav, startNav, menuItems, itemForKey, wrapTab, nextStop, canLeave, sideItem, arrowKey, placeBefore, scrollsPage, typedIn, isMoving, deleteAsEscape } = require("../../client/src/js/pages/utils/nav.js");

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

function linkTarget(href) { // A CLICK ON A LINK IN THE MENU
	const classes = new Set();
	const props = {};
	const link = {
		href,
		innerText: "Settings",
		getAttribute() { return href; },
		classList: {
			add(name) { classes.add(name); },
			contains(name) { return classes.has(name); },
			remove(name) { classes.delete(name); },
		},
		style: {
			getPropertyValue(name) { return props[name] ?? ""; },
			setProperty(name, value) { props[name] = String(value); },
			removeProperty(name) { delete props[name]; },
		},
	};
	return { link, closest() { return link; } };
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
		page.fire("keydown", { key: "x" }); // NOT W, A, S OR D: THOSE ARE THE ARROWS
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
		menu.fire("click", { target: linkTarget("#games") });
		assert.ok(isClosed());
		startNav()(true);
		page.fire("click", { target: {} });
		assert.ok(isClosed());
	});

	test("a link that leaves the page stays open & fills up, one press", () => {
		const timers = mock.timers;
		timers.enable({ apis: ["setTimeout"] });
		global.window = { location: { href: "/" }, addEventListener() { } };
		startNav()(true);
		const target = linkTarget("/settings");
		let prevented = 0;
		menu.fire("click", { target, preventDefault() { prevented++; } });
		assert.ok(isOpen());
		assert.equal(prevented, 1);
		assert.equal(target.link.innerText, "Loading");
		assert.ok(target.link.classList.contains("loading"));
		target.link.innerText = "Pressed again";
		menu.fire("click", { target });
		assert.equal(target.link.innerText, "Pressed again");
		timers.tick(250);
		assert.equal(global.window.location.href, "/settings");
		timers.reset();
		delete global.window;
	});

	test("a press that opens a new tab closes it without the fill", () => {
		startNav()(true);
		const target = linkTarget("/settings");
		let prevented = 0;
		menu.fire("click", { target, metaKey: true, preventDefault() { prevented++; } });
		assert.ok(isClosed());
		assert.equal(prevented, 0);
		assert.ok(!target.link.classList.contains("loading"));
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

	describe("the keyboard", () => {
		let items;

		function item(hidden, disabled, onMonitor) {
			const el = {
				...fakeElement(),
				inside: menu,
				disabled,
				closest(selector) { return hidden || (onMonitor && selector.includes("[data-on-monitor]")) ? {} : null; }, // onMonitor: INSIDE WHAT THE 3D ROOM'S MONITOR SHOWS INSTEAD
				focus() { global.document.activeElement = el; },
			};
			return el;
		}

		beforeEach(() => {
			items = [item(), item(true), item(), item()];
			menu.querySelectorAll = (selector) => {
				assert.match(selector, /:not\(\[disabled\]\)/);
				return items;
			};
			optBtn.focus = () => { global.document.activeElement = optBtn; };
			global.document.body = {};
			global.document.activeElement = global.document.body;
		});

		test("the list skips hidden items & reads the page each time", () => {
			assert.deepEqual(menuItems(), [items[0], items[2], items[3]]);
			items = [items[0]];
			assert.deepEqual(menuItems(), [items[0]]);
		});

		test("the list skips items the 3D room's monitor shows instead, like hidden ones", () => {
			items = [item(), item(false, false, true), item()];
			assert.deepEqual(menuItems(), [items[0], items[2]]);
		});

		test("a key on the button focuses the first item, a mouse doesn't", () => {
			startNav();
			optBtn.fire("click", { detail: 0 });
			assert.ok(isOpen());
			assert.equal(global.document.activeElement, items[0]);
			optBtn.fire("click", { detail: 0 });
			global.document.activeElement = global.document.body;
			optBtn.fire("click", { detail: 1 });
			assert.ok(isOpen());
			assert.equal(global.document.activeElement, global.document.body);
		});

		test("closing gives focus back to the button only if it was in the menu", () => {
			const toggleNav = startNav();
			toggleNav(true);
			items[2].focus();
			page.fire("keydown", { key: "Escape" });
			assert.ok(isClosed());
			assert.equal(global.document.activeElement, optBtn);
			const input = {};
			toggleNav(true);
			global.document.activeElement = input;
			toggleNav(false);
			assert.equal(global.document.activeElement, input);
		});

		test("Tab goes around the items while it's open", () => {
			const toggleNav = startNav();
			toggleNav(true);
			const press = (shiftKey) => { let prevented = 0; page.fire("keydown", { key: "Tab", shiftKey, preventDefault() { prevented++; } }); assert.equal(prevented, 1); };
			press(false);
			assert.equal(global.document.activeElement, items[0]);
			press(true);
			assert.equal(global.document.activeElement, items[3]);
			press(false);
			assert.equal(global.document.activeElement, items[0]);
			assert.ok(isOpen());
		});

		test("Delete & Backspace close it, a text box keeps them", () => {
			const toggleNav = startNav();
			for (const key of ["Delete", "Backspace"]) {
				toggleNav(true);
				items[0].focus();
				page.fire("keydown", { key });
				assert.ok(isClosed());
				assert.equal(global.document.activeElement, optBtn);
			}
			toggleNav(true);
			global.document.activeElement = { tagName: "INPUT", type: "text" };
			page.fire("keydown", { key: "Backspace" });
			assert.ok(isOpen());
		});

		test("Left & Right stay in the items while it's open & move between the stops while it's closed", () => {
			const shown = () => [1];
			const stops = [{ getClientRects: shown, focus() { global.document.activeElement = stops[0]; } }, { getClientRects: () => [], focus() { assert.fail("not on screen"); } }, { getClientRects: shown, focus() { global.document.activeElement = stops[2]; } }];
			const nav = createNav({ arrowStops: () => stops });
			nav.addListeners();
			nav.toggleNav(true);
			items.forEach((el) => { el.getBoundingClientRect = () => ({ left: 0, right: 10, top: 0 }); });
			items[0].focus();
			page.fire("keydown", { key: "ArrowRight" });
			assert.equal(global.document.activeElement, items[2]); // ONE COLUMN: DOWN THE LIST, THE HIDDEN ITEM IS SKIPPED
			page.fire("keydown", { key: "ArrowLeft" });
			assert.equal(global.document.activeElement, items[0]);
			nav.toggleNav(false);
			global.document.activeElement = stops[0];
			page.fire("keydown", { key: "ArrowRight" });
			assert.equal(global.document.activeElement, stops[2]);
			page.fire("keydown", { key: "ArrowRight" });
			assert.equal(global.document.activeElement, stops[0]);
			page.fire("keydown", { key: "ArrowLeft" });
			assert.equal(global.document.activeElement, stops[2]);
		});

		test("Up, Down, Home & End move through the shown items & stop at the ends", () => {
			startNav()(true);
			const press = (key) => page.fire("keydown", { key });
			press("ArrowDown");
			assert.equal(global.document.activeElement, items[0]);
			press("ArrowDown");
			assert.equal(global.document.activeElement, items[2]);
			press("End");
			assert.equal(global.document.activeElement, items[3]);
			press("ArrowDown");
			assert.equal(global.document.activeElement, items[3]);
			press("Home");
			assert.equal(global.document.activeElement, items[0]);
			press("ArrowUp");
			assert.equal(global.document.activeElement, items[0]);
		});

		test("the arrows leave a text box on the page & a closed menu alone", () => {
			const toggleNav = startNav();
			const input = {};
			let prevented = 0;
			global.document.activeElement = global.document.body;
			page.fire("keydown", { key: "ArrowDown", preventDefault() { prevented++; } });
			assert.equal(prevented, 0);
			toggleNav(true);
			global.document.activeElement = input;
			page.fire("keydown", { key: "ArrowDown", preventDefault() { prevented++; } });
			assert.equal(prevented, 0);
			assert.equal(global.document.activeElement, input);
		});

		test("from outside the list Down starts at the top & Up at the bottom", () => {
			const list = [items[0], items[2]];
			assert.equal(itemForKey(list, optBtn, "ArrowDown"), list[0]);
			assert.equal(itemForKey(list, optBtn, "ArrowUp"), list[1]);
		});

		test("W, A, S & D are the arrows, but a letter where one is typed or with a shortcut key", () => {
			assert.equal(arrowKey({ key: "w" }), "ArrowUp");
			assert.equal(arrowKey({ key: "A" }), "ArrowLeft"); // CAPS LOCK
			assert.equal(arrowKey({ key: "s" }), "ArrowDown");
			assert.equal(arrowKey({ key: "d" }), "ArrowRight");
			assert.equal(arrowKey({ key: "ArrowDown" }), "ArrowDown");
			assert.equal(arrowKey({ key: "x" }), "x");
			for (const held of ["altKey", "ctrlKey", "metaKey"]) { assert.equal(arrowKey({ key: "w", [held]: true }), "w"); }
			global.document.activeElement = { tagName: "INPUT", type: "text" };
			assert.equal(arrowKey({ key: "a" }), "a");
			global.document.activeElement = { tagName: "TEXTAREA" };
			assert.equal(arrowKey({ key: "s" }), "s");
			global.document.activeElement = { tagName: "SELECT" };
			assert.equal(arrowKey({ key: "d" }), "d");
			global.document.activeElement = { tagName: "INPUT", type: "checkbox" };
			assert.equal(arrowKey({ key: "d" }), "ArrowRight");
		});

		test("W, A, S & D move like the arrows, open & closed", () => {
			const shown = () => [1];
			const stops = [0, 1].map((i) => ({ getClientRects: shown, focus() { global.document.activeElement = stops[i]; } }));
			const nav = createNav({ arrowStops: () => stops });
			nav.addListeners();
			nav.toggleNav(true);
			items[0].focus();
			page.fire("keydown", { key: "s" });
			assert.equal(global.document.activeElement, items[2]); // THE HIDDEN ITEM IS SKIPPED
			page.fire("keydown", { key: "w" });
			assert.equal(global.document.activeElement, items[0]);
			nav.toggleNav(false);
			global.document.activeElement = stops[0];
			page.fire("keydown", { key: "d" });
			assert.equal(global.document.activeElement, stops[1]);
			page.fire("keydown", { key: "a" });
			assert.equal(global.document.activeElement, stops[0]);
		});

		test("Enter with nothing focused goes to the menu button without opening it", () => {
			startNav();
			let stopped = false;
			page.fire("keydown", { key: "Enter", preventDefault() { stopped = true; } });
			assert.equal(global.document.activeElement, optBtn);
			assert.ok(stopped);
			assert.ok(isClosed());
			const other = {};
			global.document.activeElement = other;
			page.fire("keydown", { key: "Enter" });
			assert.equal(global.document.activeElement, other); // A FOCUSED BUTTON KEEPS ITS ENTER
		});

		describe("boxKeys", () => {
			const keyPress = (key) => { let prevented = 0; page.fire("keydown", { key, preventDefault() { prevented++; } }); return prevented; };

			test("it gets the keys with the menu closed & a true answer skips the menu's own", () => {
				const seen = [];
				const nav = createNav({ boxKeys(e, key) { seen.push([e.key, key]); return true; } });
				nav.addListeners();
				global.document.activeElement = global.document.body;
				for (const key of ["ArrowLeft", "d", "Enter", "Escape"]) { page.fire("keydown", { key }); }
				assert.deepEqual(seen, [["ArrowLeft", "ArrowLeft"], ["d", "ArrowRight"], ["Enter", "Enter"], ["Escape", "Escape"]]);
				assert.notEqual(global.document.activeElement, optBtn); // THE OLD ENTER RULE DID NOT RUN
			});

			test("the open menu keeps its keys before boxKeys", () => {
				let called = 0;
				const nav = createNav({ boxKeys() { called++; return true; } });
				nav.addListeners();
				nav.toggleNav(true);
				page.fire("keydown", { key: "ArrowDown" });
				assert.equal(called, 0);
				assert.equal(global.document.activeElement, items[0]);
			});

			test("answering false leaves the menu's own handling", () => {
				const nav = createNav({ boxKeys() { return false; } });
				nav.addListeners();
				global.document.activeElement = global.document.body;
				page.fire("keydown", { key: "Enter" });
				assert.equal(global.document.activeElement, optBtn);
			});

			test("with it the browser's keyboard scrolling stays off, without it the browser scrolls", () => {
				for (const boxKeys of [() => false, undefined]) {
					createNav({ boxKeys }).addListeners();
					global.document.activeElement = global.document.body;
					for (const key of ["ArrowDown", "PageDown", "End", " "]) { assert.equal(keyPress(key), boxKeys ? 1 : 0, key); }
				}
			});

			test("a moving field is not typed in & W, A, S & D move from it", () => {
				const field = (tagName, moving) => ({ tagName, type: "text", dataset: moving ? { moving: "" } : {} });
				assert.equal(typedIn(field("INPUT", true)), false);
				assert.equal(typedIn(field("INPUT", false)), true);
				assert.equal(isMoving(field("INPUT", true)), true);
				assert.equal(isMoving(field("INPUT", false)), false);
				assert.equal(isMoving({}), false);
				assert.equal(isMoving(null), false);
				global.document.activeElement = field("INPUT", true);
				assert.equal(arrowKey({ key: "w" }), "ArrowUp");
				global.document.activeElement = field("SELECT", true);
				assert.equal(arrowKey({ key: "w" }), "ArrowUp");
				global.document.activeElement = field("SELECT", false);
				assert.equal(arrowKey({ key: "w" }), "w");
			});
		});
	});

	test("Tab only goes around at the ends of the page", () => {
		const element = (place) => ({ place, compareDocumentPosition(other) { return other.place > place ? 4 : other.place < place ? 2 : 0; } });
		const elements = [element(1), element(2), element(3)];
		assert.equal(wrapTab(elements, elements[1], false), null);
		assert.equal(wrapTab(elements, elements[2], false), elements[0]);
		assert.equal(wrapTab(elements, elements[0], true), elements[2]);
		assert.equal(wrapTab(elements, elements[0], false), null);
		assert.equal(wrapTab(elements, element(4), false), elements[0]); // A MOVE'S ROW, THE TAB KEY SKIPS THOSE
	});

	test("Left & Right go around the stops, from outside them Right starts at the first", () => {
		const stops = ["button", "box", "moves"];
		assert.equal(nextStop(stops, "button", "ArrowRight"), "box");
		assert.equal(nextStop(stops, "button", "ArrowLeft"), "moves");
		assert.equal(nextStop(stops, "moves", "ArrowRight"), "button");
		assert.equal(nextStop(stops, "page", "ArrowRight"), "button");
		assert.equal(nextStop(stops, "page", "ArrowLeft"), "moves");
	});

	test("a stop is put directly before another, or left out when either is missing", () => {
		assert.deepEqual(placeBefore(["a", "menu", "b"], "screen", "menu"), ["a", "screen", "menu", "b"]);
		assert.deepEqual(placeBefore(["a", "b"], "screen", "menu"), ["a", "b"]);
		assert.deepEqual(placeBefore(["a", "menu"], null, "menu"), ["a", "menu"]);
	});

	test("a text box lets go of Left & Right with the cursor at that end, a dropdown doesn't", () => {
		const box = (selectionStart, selectionEnd, value) => ({ tagName: "INPUT", type: "text", selectionStart, selectionEnd, value });
		assert.equal(canLeave(box(0, 0, ""), "ArrowLeft"), true);
		assert.equal(canLeave(box(0, 0, "e4"), "ArrowLeft"), true);
		assert.equal(canLeave(box(0, 0, "e4"), "ArrowRight"), false);
		assert.equal(canLeave(box(2, 2, "e4"), "ArrowRight"), true);
		assert.equal(canLeave(box(0, 2, "e4"), "ArrowRight"), false);
		assert.equal(canLeave(box(null, null, "a@b"), "ArrowLeft"), false);
		assert.equal(canLeave({ tagName: "SELECT" }, "ArrowLeft"), false);
		assert.equal(canLeave({ tagName: "BUTTON" }, "ArrowLeft"), true);
		assert.equal(canLeave({}, "ArrowLeft"), true);
	});

	test("in columns Left & Right go to the closest item in the next column & stop at the edge", () => {
		const at = (column, row) => ({ left: column * 100, right: column * 100 + 90, top: row * 50 });
		const rects = [at(0, 0), at(0, 1), at(0, 2), at(1, 0), at(1, 1), at(2, 0)];
		const items = ["a", "b", "c", "d", "e", "f"];
		assert.equal(sideItem(items, rects, "b", "ArrowRight"), "e");
		assert.equal(sideItem(items, rects, "c", "ArrowRight"), "e");
		assert.equal(sideItem(items, rects, "e", "ArrowLeft"), "b");
		assert.equal(sideItem(items, rects, "e", "ArrowRight"), "f");
		assert.equal(sideItem(items, rects, "f", "ArrowRight"), undefined);
		assert.equal(sideItem(items, rects, "a", "ArrowLeft"), undefined);
	});

	test("in one column Right goes down the list, Left goes up & they stop at the ends", () => {
		const rects = [0, 1, 2].map((row) => ({ left: 0, right: 90, top: row * 50 }));
		const items = ["a", "b", "c"];
		assert.equal(sideItem(items, rects, "a", "ArrowRight"), "b");
		assert.equal(sideItem(items, rects, "b", "ArrowLeft"), "a");
		assert.equal(sideItem(items, rects, "c", "ArrowRight"), undefined);
		assert.equal(sideItem(items, rects, "page", "ArrowRight"), "a");
		assert.equal(sideItem(items, rects, "page", "ArrowLeft"), "c");
	});
});

describe("the browser's keyboard scrolling", () => {
	const button = { tagName: "BUTTON", closest(selector) { return selector.includes("button") ? this : null; } };
	const page = { closest() { return null; } }; // document.body
	const text = { tagName: "INPUT", type: "text" };

	function pressOn(focused, e) {
		global.document = { activeElement: focused };
		return scrollsPage(e);
	}

	test("the arrows, Page Up & Down, Home & End scroll from the page or a button", () => {
		for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End"]) {
			assert.equal(pressOn(page, { key }), true, key);
			assert.equal(pressOn(button, { key }), true, key);
		}
		assert.equal(pressOn(page, { key: "x" }), false);
	});

	test("Space scrolls from the page, not from a button it presses", () => {
		assert.equal(pressOn(page, { key: " " }), true);
		assert.equal(pressOn(button, { key: " " }), false);
	});

	test("a text box, dropdown, radio button & slider keep their keys", () => {
		for (const focused of [text, { tagName: "TEXTAREA" }, { tagName: "SELECT" }, { tagName: "INPUT", type: "radio" }, { tagName: "INPUT", type: "range" }]) {
			assert.equal(pressOn(focused, { key: "ArrowDown" }), false);
			assert.equal(pressOn(focused, { key: " " }), false);
		}
	});

	test("Alt, Ctrl & Cmd stay the browser's shortcuts", () => {
		assert.equal(pressOn(page, { key: "ArrowDown", metaKey: true }), false);
		assert.equal(pressOn(page, { key: "Home", ctrlKey: true }), false);
		assert.equal(pressOn(page, { key: "ArrowLeft", altKey: true }), false);
	});
});

describe("Delete & Backspace are Escape outside a text box", () => {
	function press(key, target, extra = {}) {
		const e = { key, target, repeat: false, prevented: false, stopped: false, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...extra,
			preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
		e.swapped = deleteAsEscape(e);
		return e;
	}
	function element(tagName, extra = {}) {
		const fake = { tagName, type: "text", dataset: {}, sent: [], dispatchEvent(event) { fake.sent.push(event); return true; }, ...extra };
		return fake;
	}
	global.KeyboardEvent = class { constructor(type, init) { Object.assign(this, { type }, init); } };

	test("on a button, the page or a moving text box the key is swapped for an Escape there", () => {
		for (const [name, target] of [["button", element("BUTTON")], ["body", element("BODY")], ["moving", element("INPUT", { dataset: { moving: "" } })]]) {
			for (const key of ["Delete", "Backspace"]) {
				target.sent = [];
				const e = press(key, target);
				assert.equal(e.swapped, true, `${name} ${key}`);
				assert.equal(e.prevented && e.stopped, true, `${name} ${key}`);
				assert.equal(target.sent.length, 1);
				assert.equal(target.sent[0].type, "keydown");
				assert.equal(target.sent[0].key, "Escape");
				assert.equal(target.sent[0].bubbles, true);
			}
		}
	});

	test("a text box in use keeps its Delete & Backspace, a modifier or another key is left alone", () => {
		for (const target of [element("INPUT"), element("TEXTAREA"), element("DIV", { isContentEditable: true })]) {
			const e = press("Backspace", target);
			assert.equal(e.swapped, false);
			assert.equal(e.prevented, false);
			assert.equal(target.sent.length, 0);
		}
		const button = element("BUTTON");
		for (const extra of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }, { shiftKey: true }]) { assert.equal(press("Backspace", button, extra).swapped, false); }
		assert.equal(press("Escape", button).swapped, false);
		assert.equal(press("x", button).swapped, false);
		assert.equal(button.sent.length, 0);
	});
});
