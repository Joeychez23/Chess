/*
 *  boxNav.test.js  --  chess server tests
 *	The box navigation (client/src/js/pages/utils/boxNav.js) for Home, Login, Signup & Settings: the row helpers
 *
 */

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { rowsOf, rowStep, sideStep, menuRow } = require("../../client/src/js/pages/utils/boxNav.js");

const at = (left, top, w = 100, h = 100) => ({ left, top, right: left + w, bottom: top + h });

describe("row helpers", () => {
	test("rowsOf groups elements into rows by position", () => {
		const cases = [
			[{ a: at(0, 0), b: at(0, 120), c: at(0, 240) }, [["a"], ["b"], ["c"]]], // ONE COLUMN
			[{ d: at(110, 120), a: at(0, 0), c: at(0, 120), b: at(110, 0) }, [["a", "b"], ["c", "d"]]], // TWO COLUMNS, OUT OF ORDER
			[{ a: at(0, 0), b: at(110, 0), c: at(0, 120) }, [["a", "b"], ["c"]]], // ODD LAST ROW
			[{ a: at(0, 0, 100, 300), b: at(110, 0, 100, 80) }, [["a", "b"]]], // UNEQUAL HEIGHTS IN ONE GRID ROW
			[{ input: at(0, 0, 200, 40), show: at(210, 8, 40, 24) }, [["input", "show"]]], // A SHORT ITEM BESIDE A TALLER ONE
			[{ x: at(0, 0, 200, 40), y: at(0, 50, 200, 40) }, [["x"], ["y"]]], // STACKED ITEMS
		];
		for (const [rects, expected] of cases) {
			assert.deepEqual(rowsOf(Object.keys(rects), (el) => rects[el]), expected);
		}
	});

	test("rowStep goes to the same share of the next row and loops", () => {
		const rows = [["h"], ["a", "b"], ["c", "d", "e"]];
		const steps = [
			["h", "ArrowDown", "a"], ["a", "ArrowDown", "c"], ["b", "ArrowDown", "d"], // 2 -> 3: 2ND -> MIDDLE
			["c", "ArrowUp", "a"], ["d", "ArrowUp", "a"], ["e", "ArrowUp", "b"], // 3 -> 2
			["e", "ArrowDown", "h"], ["c", "ArrowDown", "h"], // LOOP TO THE TOP
			["h", "ArrowUp", "c"], // LOOP TO THE BOTTOM-LEFT
		];
		for (const [from, key, to] of steps) { assert.equal(rowStep(rows, from, key), to, `${key} from ${from}`); }
		assert.equal(rowStep([["a", "b"]], "b", "ArrowDown"), "b");
		assert.equal(rowStep(rows, "zz", "ArrowDown"), undefined);
	});

	test("rowStep with the menu as a row's last item", () => {
		const rows = [["a", "b", "menu"], ["c", "d"]];
		assert.equal(rowStep(rows, "menu", "ArrowDown"), "d");
		assert.equal(rowStep(rows, "d", "ArrowUp"), "b");
	});

	test("sideStep loops the row", () => {
		assert.equal(sideStep(["a", "b", "c"], "a", "ArrowLeft"), "c");
		assert.equal(sideStep(["a", "b", "c"], "c", "ArrowRight"), "a");
		assert.equal(sideStep(["a", "b", "c"], "c", "ArrowLeft"), "b");
		assert.equal(sideStep(["a"], "a", "ArrowRight"), "a");
	});

	test("menuRow picks the row beside the menu button, not the biggest one", () => {
		const button = at(900, 10, 40, 40); // MIDDLE AT 30
		const rows = [["h"], ["a", "b"]];
		const rects = { h: at(0, 0, 1000, 500), a: at(0, 520, 490, 600), b: at(510, 520, 490, 600) };
		assert.equal(menuRow(rows, (el) => rects[el], button, 800), 0);
		const small = { games: at(510, -250, 490, 300), friends: at(510, 70, 490, 900) }; // 50PX OF games IN VIEW BESIDE THE BUTTON, friends FILLS THE REST
		assert.equal(menuRow([["games"], ["friends"]], (el) => small[el], button, 800), 0);
		const below = { a: at(0, -300, 1000, 280), b: at(0, 100, 1000, 300) }; // a IS CLOSER BUT SCROLLED OUT OF VIEW
		assert.equal(menuRow([["a"], ["b"]], (el) => below[el], button, 800), 1);
		const tie = { a: at(0, 0, 100, 10), b: at(0, 50, 100, 10) }; // BOTH 20PX AWAY
		assert.equal(menuRow([["a"], ["b"]], (el) => tie[el], button, 800), 0); // A TIE PICKS THE TOP-MOST ROW
		const away = { a: at(0, -500, 100, 100), b: at(0, 900, 100, 100) };
		assert.equal(menuRow([["a"], ["b"]], (el) => away[el], button, 800), 0); // NOTHING IN VIEW: THE FIRST ROW
		assert.equal(menuRow([], (el) => el, button, 800), -1);
	});
});

/* ---------------------------------------------------------------- */
// The page's keys
/* ---------------------------------------------------------------- */

const { boxKeys, watchMoving } = require("../../client/src/js/pages/utils/boxNav.js");

describe("the page's keys", () => {
	// A PAGE OF FAKE ELEMENTS: boxes is [[name, rect, classes, items]], an item is [name, tag, rect]
	function page(boxes, { reduced = false } = {}) {
		const body = { tagName: "BODY" };
		const doc = { activeElement: body, body };
		const made = {};
		function make(name, tag, rect, classes = [], extra = {}) {
			const fake = {
				name, tagName: tag, type: "text", dataset: {}, blurred: 0, scrolled: null, hidden: false,
				classList: { contains: (c) => classes.includes(c) },
				getBoundingClientRect: () => ({ ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top }),
				getClientRects: () => (fake.hidden ? [] : [rect]),
				closest: () => null,
				focus() { doc.activeElement = fake; },
				blur() { fake.blurred++; if (doc.activeElement == fake) { doc.activeElement = body; } },
				scrollIntoView(options) { fake.scrolled = options; },
				...extra,
			};
			made[name] = fake;
			return fake;
		}
		const tops = boxes.map(([name, rect, classes, items = []]) => {
			const box = make(name, "DIV", rect, classes);
			const inside = items.map(([n, tag, r, type]) => make(n, tag, r, [], type ? { type } : {}));
			box.querySelectorAll = () => inside;
			box.contains = (el) => el == box || inside.includes(el);
			return box;
		});
		doc.querySelectorAll = () => tops;
		const optBtn = make("optBtn", "BUTTON", at(900, 10, 40, 40));
		global.document = doc;
		global.window = { innerWidth: 1000, innerHeight: 800, scrolledTo: null, scrollTo(o) { this.scrolledTo = o; }, matchMedia: () => ({ matches: reduced }) };
		return { doc, made, optBtn, body };
	}

	function press(p, key, extra = {}) {
		const e = { key, prevented: false, preventDefault() { this.prevented = true; }, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...extra };
		e.result = boxKeys(e, key, p.optBtn);
		return e;
	}

	const HERO = ["hero", at(0, 0, 1000, 500), ["hero"]];
	const A = ["a", at(0, 520, 490, 300), ["box"]];
	const B = ["b", at(510, 520, 490, 300), ["box"]];

	test("a key with nothing focused goes to the menu button", () => {
		for (const key of ["ArrowDown", "ArrowRight", "Enter"]) {
			const p = page([HERO, A]);
			const e = press(p, key);
			assert.equal(e.result, true, key);
			assert.equal(e.prevented, true, key);
			assert.equal(p.doc.activeElement, p.optBtn, key);
		}
		const p = page([HERO, A]);
		assert.equal(press(p, "Escape").result, false);
		assert.equal(p.doc.activeElement, p.body);
	});

	test("focus dropped to the body (the focused item disappeared) is the same as nothing focused", () => {
		const p = page([HERO, A, ["c", at(0, 900, 490, 100), ["box"], [["x", "BUTTON", at(10, 910, 50, 30)]]]]);
		p.made.x.focus();
		p.made.x.blur(); // THE FOCUSED BUTTON WAS REMOVED
		assert.equal(press(p, "ArrowUp").result, true);
		assert.equal(p.doc.activeElement, p.optBtn);
	});

	test("Down from the menu button goes to the row below, Left loops the menu's row", () => {
		const p = page([HERO, A, B]);
		p.optBtn.focus();
		assert.equal(press(p, "ArrowDown").result, true);
		assert.equal(p.doc.activeElement, p.made.b);
		p.optBtn.focus();
		press(p, "ArrowLeft");
		assert.equal(p.doc.activeElement, p.made.hero);
		const e = press(p, "ArrowLeft");
		assert.equal(e.prevented, true);
		assert.equal(p.doc.activeElement, p.optBtn);
	});

	test("a hidden box is skipped, and the rows are read again on every key", () => {
		const p = page([HERO, A, B]);
		p.made.b.hidden = true;
		p.made.a.focus();
		press(p, "ArrowRight");
		assert.equal(p.doc.activeElement, p.made.a); // ALONE IN ITS ROW
		press(p, "ArrowDown");
		assert.equal(p.doc.activeElement, p.made.hero); // LOOPS
		p.made.b.hidden = false; // IT APPEARS LATER
		p.made.a.focus();
		press(p, "ArrowRight");
		assert.equal(p.doc.activeElement, p.made.b);
	});

	test("Enter goes into a box, Escape comes back, Escape again drops the focus", () => {
		const p = page([HERO, ["a", at(0, 520, 490, 300), ["box"], [["input", "INPUT", at(10, 530, 400, 40)], ["btn", "BUTTON", at(10, 600, 100, 40)]]]]);
		p.made.a.focus();
		const e = press(p, "Enter");
		assert.equal(e.result, true);
		assert.equal(e.prevented, true);
		assert.equal(p.doc.activeElement, p.made.input);
		assert.equal(p.made.input.dataset.moving, "");
		press(p, "ArrowDown"); // A BUTTON IS NOT A FIELD
		assert.equal(p.doc.activeElement, p.made.btn);
		assert.equal(press(p, "Enter").result, false); // NATIVE PRESS
		assert.equal(press(p, " ").result, false);
		assert.equal(press(p, "Escape").result, true);
		assert.equal(p.doc.activeElement, p.made.a);
		assert.equal(press(p, "Escape").result, true);
		assert.equal(p.made.a.blurred, 1);
	});

	test("Enter on an empty box or the top info box keeps the focus", () => {
		const p = page([HERO, A]);
		for (const name of ["a", "hero"]) {
			p.made[name].focus();
			const e = press(p, "Enter");
			assert.equal(e.result, true);
			assert.equal(e.prevented, true);
			assert.equal(p.doc.activeElement, p.made[name]);
		}
	});

	test("Enter on a hero with a link (Guest's Sign in) goes to it, Escape comes back to the hero", () => {
		const p = page([["hero", at(0, 0, 1000, 500), ["hero"], [["signIn", "A", at(10, 300, 120, 40)]]], A]);
		p.made.hero.focus();
		assert.equal(press(p, "Enter").result, true);
		assert.equal(p.doc.activeElement, p.made.signIn);
		assert.equal(press(p, "Enter").result, false); // NATIVE PRESS FOLLOWS THE LINK
		assert.equal(press(p, "Escape").result, true);
		assert.equal(p.doc.activeElement, p.made.hero);
	});

	test("Enter on the menu button is left to the button", () => {
		const p = page([HERO, A]);
		p.optBtn.focus();
		assert.equal(press(p, "Enter").result, false);
	});

	test("Enter on a moving text box switches to using without submitting", () => {
		const p = page([HERO, ["a", at(0, 520, 490, 300), ["box"], [["input", "INPUT", at(10, 530, 400, 40)]]]]);
		p.made.a.focus();
		press(p, "Enter");
		const e = press(p, "Enter");
		assert.equal(e.result, true);
		assert.equal(e.prevented, true);
		assert.equal(p.made.input.dataset.moving, undefined);
		assert.equal(press(p, "Enter").result, false); // USING: THE FORM SUBMITS
		assert.equal(press(p, "Escape").result, true); // USING -> MOVING
		assert.equal(p.made.input.dataset.moving, "");
	});

	test("a moving text box blocks typing", () => {
		const p = page([HERO, ["a", at(0, 520, 490, 300), ["box"], [["input", "INPUT", at(10, 530, 400, 40)]]]]);
		p.made.input.focus();
		p.made.input.dataset.moving = "";
		for (const [key, extra] of [["x", {}], ["X", { shiftKey: true }], ["Backspace", {}], ["Delete", {}], [" ", {}]]) {
			const e = press(p, key, extra);
			assert.equal(e.result, true, key);
			assert.equal(e.prevented, true, key);
		}
		delete p.made.input.dataset.moving;
		for (const key of ["x", "Backspace", "Delete"]) { assert.equal(press(p, key).result, false, key); }
	});

	test("a moving text box blocks what would edit or submit it with a modifier down", () => {
		const p = page([HERO, ["a", at(0, 520, 490, 300), ["box"], [["input", "INPUT", at(10, 530, 400, 40)]]]]);
		p.made.input.focus();
		p.made.input.dataset.moving = "";
		const blocked = [["Enter", { shiftKey: true }], ["Backspace", { shiftKey: true }], ["Backspace", { altKey: true }], ["Delete", { metaKey: true }], ["e", { altKey: true }], ["v", { metaKey: true }], ["V", { ctrlKey: true }], ["x", { metaKey: true }]];
		for (const [key, extra] of blocked) {
			const e = press(p, key, extra);
			assert.equal(e.result, true, key);
			assert.equal(e.prevented, true, key);
			assert.equal(p.made.input.dataset.moving, "", key); // STILL MOVING
		}
		for (const [key, extra] of [["r", { metaKey: true }], ["c", { metaKey: true }], ["a", { ctrlKey: true }]]) {
			const e = press(p, key, extra);
			assert.equal(e.result, false, key);
			assert.equal(e.prevented, false, key);
		}
	});

	test("a using text box leaves with the arrow keys, not W, A, S & D", () => {
		const items = [["input", "INPUT", at(10, 530, 400, 40)], ["btn", "BUTTON", at(10, 580, 400, 40)], ["link", "A", at(10, 630, 400, 40)]];
		const p = page([HERO, ["a", at(0, 520, 490, 300), ["box"], items]]);
		const input = p.made.input;
		Object.assign(input, { value: "abc", selectionStart: 1, selectionEnd: 1 }); // THE CURSOR IN THE MIDDLE
		for (const key of ["w", "a", "s", "d"]) {
			input.focus();
			assert.equal(press(p, key).result, false, key); // TYPES
			assert.equal(p.doc.activeElement, input, key);
		}
		for (const key of ["ArrowLeft", "ArrowRight"]) {
			assert.equal(press(p, key).result, false, key); // MOVES THE CURSOR
			assert.equal(p.doc.activeElement, input, key);
		}
		let e = press(p, "ArrowDown");
		assert.equal(e.result, true);
		assert.equal(e.prevented, true);
		assert.equal(p.doc.activeElement, p.made.btn);
		input.focus();
		press(p, "ArrowUp");
		assert.equal(p.doc.activeElement, p.made.link); // LOOPS TO THE LAST ROW
		input.focus();
		input.selectionStart = input.selectionEnd = 0;
		assert.equal(press(p, "ArrowLeft").result, true); // THE CURSOR AT THE START LETS LEFT GO
		assert.equal(p.doc.activeElement, input); // ALONE IN ITS ROW: STAYS
		assert.equal(input.dataset.moving, undefined); // & STAYS USING
		assert.equal(press(p, "ArrowRight").result, false); // BUT NOT RIGHT
		input.selectionStart = input.selectionEnd = 3;
		assert.equal(press(p, "ArrowRight").result, true); // AT THE END
	});

	test("Shift+Enter on a using text box is left alone", () => {
		const p = page([HERO, ["a", at(0, 520, 490, 300), ["box"], [["input", "INPUT", at(10, 530, 400, 40)]]]]);
		p.made.input.focus();
		assert.equal(press(p, "Enter", { shiftKey: true }).result, false);
	});

	test("a moving text box moves inside its box with the arrows and Escape goes to the box", () => {
		const p = page([HERO, ["a", at(0, 520, 490, 300), ["box"], [["one", "INPUT", at(10, 530, 400, 40)], ["two", "INPUT", at(10, 600, 400, 40)]]]]);
		p.made.one.focus();
		p.made.one.dataset.moving = "";
		assert.equal(press(p, "ArrowDown").result, true);
		assert.equal(p.doc.activeElement, p.made.two);
		assert.equal(p.made.two.dataset.moving, "");
		assert.equal(press(p, "Escape").result, true);
		assert.equal(p.doc.activeElement, p.made.a);
	});

	test("a using dropdown keeps its arrows, Enter or Escape go back to moving", () => {
		const p = page([HERO, ["a", at(0, 520, 490, 300), ["box"], [["pick", "SELECT", at(10, 530, 400, 40)]]]]);
		p.made.pick.focus();
		assert.equal(press(p, "ArrowDown").result, false);
		const e = press(p, "Enter");
		assert.equal(e.result, true);
		assert.equal(e.prevented, true);
		assert.equal(p.made.pick.dataset.moving, "");
	});

	test("Escape on the menu button or a top stop drops the focus", () => {
		const p = page([HERO, A]);
		p.optBtn.focus();
		assert.equal(press(p, "Escape").result, true);
		assert.equal(p.optBtn.blurred, 1);
		p.made.hero.focus();
		press(p, "Escape");
		assert.equal(p.made.hero.blurred, 1);
	});

	test("keys with Alt, Ctrl or Cmd, and other focus, are left alone", () => {
		const p = page([HERO, A]);
		p.optBtn.focus();
		for (const extra of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
			assert.equal(press(p, "ArrowDown", extra).result, false);
		}
		const outside = { tagName: "A", dataset: {}, closest: () => null };
		p.doc.activeElement = outside;
		assert.equal(press(p, "ArrowDown").result, false);
	});

	test("a box taller than the screen scrolls to its top, a short one to nearest", () => {
		const tall = ["tall", at(0, 520, 490, 900), ["box"]];
		const p = page([HERO, tall, B]);
		p.made.hero.focus();
		press(p, "ArrowDown");
		assert.equal(p.doc.activeElement, p.made.tall);
		assert.deepEqual(p.made.tall.scrolled, { block: "start", behavior: "smooth" });
		p.made.tall.focus();
		press(p, "ArrowRight");
		assert.deepEqual(p.made.b.scrolled, { block: "nearest", behavior: "smooth" });
		press(p, "ArrowLeft");
		press(p, "ArrowUp");
		assert.deepEqual(global.window.scrolledTo, { top: 0, behavior: "smooth" });
	});

	test("reduced motion scrolls without animation", () => {
		const p = page([HERO, A, B], { reduced: true });
		p.made.a.focus();
		press(p, "ArrowRight");
		assert.deepEqual(p.made.b.scrolled, { block: "nearest", behavior: "auto" });
	});

	test("a moving dropdown takes Home, End and Page keys, Tab still leaves", () => {
		const p = page([HERO, ["a", at(0, 520, 490, 300), ["box"], [["pick", "SELECT", at(10, 530, 400, 40)]]]]);
		p.made.pick.focus();
		p.made.pick.dataset.moving = "";
		for (const key of ["Home", "End", "PageDown", "PageUp"]) {
			const e = press(p, key);
			assert.equal(e.result, true, key);
			assert.equal(e.prevented, true, key);
		}
		assert.equal(press(p, "Home", { shiftKey: true }).result, true);
		assert.equal(press(p, "Tab").result, false);
		assert.equal(press(p, "Tab", { shiftKey: true }).result, false);
	});

	test("a focused item that isn't tabbable still finds its box", () => {
		const p = page([HERO, ["a", at(0, 520, 490, 300), ["box"], [["one", "BUTTON", at(10, 530, 100, 40)], ["two", "BUTTON", at(10, 600, 100, 40)]]]]);
		p.made.one.focus();
		p.made.one.getClientRects = () => []; // DISABLED MID-REQUEST, pageElements() DROPS IT
		assert.equal(press(p, "Escape").result, true);
		assert.equal(p.doc.activeElement, p.made.a);
	});

	describe("watching the moving state", () => {
		function watched() {
			const p = page([HERO, A]);
			const listeners = {};
			p.doc.addEventListener = (type, fn) => { listeners[type] = fn; };
			watchMoving();
			const field = { dataset: { moving: "" }, contains: (t) => t == field, closest: () => null };
			const label = { closest: (sel) => (sel == "label" ? label : null), control: field };
			p.doc.activeElement = field;
			return { p, listeners, field, label };
		}

		test("a click on the focused field or its label switches it to using", () => {
			for (const target of ["field", "label", "other"]) {
				const { listeners, field, label } = watched();
				const t = { field, label, other: { closest: () => null } }[target];
				listeners.pointerdown({ target: t });
				assert.equal(field.dataset.moving, target == "other" ? "" : undefined, target);
			}
		});

		test("leaving the field ends moving, the window losing focus doesn't", () => {
			const { p, listeners, field } = watched();
			listeners.focusout({ target: field }); // THE WINDOW BLURRED: THE FIELD IS STILL THE ACTIVE ELEMENT
			assert.equal(field.dataset.moving, "");
			p.doc.activeElement = p.body;
			listeners.focusout({ target: field });
			assert.equal(field.dataset.moving, undefined);
		});

		test("text can't get into a moving field some other way", () => {
			const { listeners, field } = watched();
			const moving = { target: field, prevented: false, preventDefault() { this.prevented = true; } };
			listeners.beforeinput(moving);
			assert.equal(moving.prevented, true);
			const using = { target: { dataset: {} }, prevented: false, preventDefault() { this.prevented = true; } };
			listeners.beforeinput(using);
			assert.equal(using.prevented, false);
		});
	});
});
