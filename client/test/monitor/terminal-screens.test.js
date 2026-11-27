/*
 *  terminal-screens.test.js  --  chess frontend tests
 *	The terminal's drawing: the kit, the themes & each window's content.
 *	One describe per source file, each as it was in its own test file. Run with npm run test:client
 *
 */

const { describe: group } = require("node:test");

// /
group("kit", () => {
	const { test, describe } = require("node:test");
	const assert = require("node:assert/strict");
	const kit = require("../../src/js/gameplay/three/monitor/kit.js");
	const { textCells, textWidth, HEIGHT } = require("../../src/js/gameplay/three/pixelFont.js");

	const { W, H, LINE, BAR, FOOT, WIN, TAB_NAMES, px, drawText, box, wall, station, footer, win, closeBox, btn, scroll, meter, lamp, drawPointer, sentence, chrome } = kit;

	// EVERY COLOUR DIFFERENT, SO A TEST CAN TELL WHICH ONE A PART USED
	const T = { id: "t", label: "Test", bg: "#000001", ink: "#000002", dim: "#000003", faint: "#000004", hot: "#000005", bar: "#000006", brand: "#000007", splash: "#000008", glow: false };

	function fake() {
		const calls = [];
		return { calls, fillStyle: "", fillRect(x, y, w, h) { calls.push({ x, y, w, h, color: this.fillStyle }); } };
	}
	const inside = (c, r) => c.x >= r.x && c.y >= r.y && c.x + c.w <= r.x + r.w && c.y + c.h <= r.y + r.h;
	const whole = (c) => [c.x, c.y, c.w, c.h].every(Number.isInteger);
	const overlaps = (c, r) => c.x < r.x + r.w && r.x < c.x + c.w && c.y < r.y + r.h && r.y < c.y + c.h;
	const same = (c, r) => c.x === r.x && c.y === r.y && c.w === r.w && c.h === r.h;

	// A WINDOW'S PARTS, AS windows.js parts() GIVES THEM
	const P = { frame: { x: 40, y: 38, w: 252, h: 172 }, title: { x: 40, y: 38, w: 252, h: 13 }, close: { x: 279, y: 40, w: 10, h: 10 }, view: { x: 41, y: 51, w: 243, h: 151 }, grip: { x: 284, y: 202, w: 7, h: 7 }, vbar: { x: 284, y: 51, w: 7, h: 151 }, hbar: { x: 41, y: 202, w: 243, h: 7 }, vthumb: { x: 284, y: 51, w: 7, h: 40 }, hthumb: { x: 41, y: 202, w: 80, h: 7 } };
	// THE SAME LAYOUT FOR ANY FRAME (THE SMALLEST WINDOW IS 60 x 40)
	function partsOf(x, y, w, h) {
		return { frame: { x, y, w, h }, title: { x, y, w, h: 13 }, close: { x: x + w - 13, y: y + 2, w: 10, h: 10 }, view: { x: x + 1, y: y + 13, w: w - 9, h: h - 21 }, grip: { x: x + w - 8, y: y + h - 8, w: 7, h: 7 }, vbar: { x: x + w - 8, y: y + 13, w: 7, h: h - 21 }, hbar: { x: x + 1, y: y + h - 8, w: w - 9, h: 7 }, vthumb: { x: x + w - 8, y: y + 13, w: 7, h: 8 }, hthumb: { x: x + 1, y: y + h - 8, w: 20, h: 7 } };
	}
	// THE TITLE'S TEXT CELLS: 1 x 1 FILLS IN THE TITLE BAR LEFT OF THE CLOSE BOX, INSIDE THE BORDER
	const titleCells = (ctx, p) => ctx.calls.filter((c) => c.w === 1 && c.h === 1 && inside(c, { x: p.title.x + 1, y: p.title.y + 1, w: p.close.x - p.title.x - 1, h: p.title.h - 2 }));

	describe("drawing kit", () => {
		test("the grid, the line pitch and the layout match the brief", () => {
			assert.deepEqual([W, H, LINE], [320, 240, 9]);
			assert.deepEqual(BAR, { x: 16, y: 4, w: 288, h: 11 });
			assert.deepEqual(FOOT, { x: 16, y: 219, tabW: 55, pitch: 56, h: 12, brand: { x: 244, y: 219, w: 60, h: 12 } });
			assert.deepEqual(WIN.session, { x: 40, y: 38, w: 252, h: 172 });
			for (const id of ["log", "mail", "systems"]) { assert.deepEqual(WIN[id], { x: 20, y: 20, w: 280, h: 194 }); }
			assert.deepEqual(WIN.diag, { x: 26, y: 26, w: 268, h: 180 });
			assert.deepEqual(TAB_NAMES, { session: "SESSION", log: "LOG", mail: "MAIL", systems: "SYSTEMS" });
		});

		test("px rounds to whole pixels and sets the colour", () => {
			const ctx = fake();
			px(ctx, 1.4, 2.6, 3, 1, "#fff");
			assert.deepEqual(ctx.calls, [{ x: 1, y: 3, w: 3, h: 1, color: "#fff" }]);
		});

		test("drawText starts on a whole pixel for every align and size", () => {
			for (const align of [-1, 0, 1]) {
				for (const size of [1, 2, 3]) {
					const ctx = fake();
					drawText(ctx, "Ab/", 10.5, 4.5, "#123456", align, size);
					assert.ok(ctx.calls.length > 0);
					assert.ok(ctx.calls.every(whole), `align ${align} size ${size}`);
					assert.ok(ctx.calls.every((c) => c.color === "#123456"));
				}
			}
		});

		test("drawText lays out the font's cells from x by align", () => {
			const ctx = fake();
			drawText(ctx, "MERIDIAN", 100, 20, "#fff", 1, 2);
			const cells = textCells("MERIDIAN", 2);
			assert.equal(ctx.calls.length, cells.length);
			const minX = Math.min(...ctx.calls.map((c) => c.x)), maxX = Math.max(...ctx.calls.map((c) => c.x + c.w));
			assert.equal(maxX, 100); // align 1 ENDS AT x
			assert.ok(minX >= 100 - textWidth("MERIDIAN") * 2);
			const left = fake(); drawText(left, "A", 7, 3, "#fff");
			assert.equal(Math.min(...left.calls.map((c) => c.x)), 7);
			assert.equal(Math.min(...left.calls.map((c) => c.y)), 3);
		});

		test("box draws a one pixel frame inside its rectangle", () => {
			const ctx = fake();
			box(ctx, 5, 6, 10, 8, "#abc");
			assert.ok(ctx.calls.every((c) => inside(c, { x: 5, y: 6, w: 10, h: 8 }) && c.color === "#abc"));
			const lit = new Set(); for (const c of ctx.calls) { for (let i = 0; i < c.w; i++) { for (let j = 0; j < c.h; j++) { lit.add(`${c.x + i},${c.y + j}`); } } }
			assert.equal(lit.size, 2 * 10 + 2 * 6);
			assert.ok(!lit.has("6,7"));
		});

		test("closeBox sits in a window's top right corner", () => {
			assert.deepEqual(closeBox(WIN.session), { x: 279, y: 40, w: 10, h: 10 });
		});

		test("drawPointer uses only pure white and pure black and stays inside 10 x 10", () => {
			const ctx = fake();
			drawPointer(ctx, 50, 60);
			assert.ok(ctx.calls.length > 0);
			assert.ok(ctx.calls.every((c) => c.color === "#ffffff" || c.color === "#000000"));
			assert.ok(ctx.calls.every((c) => inside(c, { x: 50, y: 60, w: 10, h: 10 })));
			assert.ok(ctx.calls.some((c) => c.color === "#000000"));
		});

		test("footer fills the lit tab with the bar colour and draws MERIDIAN over the brand block", () => {
			const tabs = ["session", "log", "mail", "systems"].map((id, i) => ({ id: `tab:${id}`, x: FOOT.x + i * FOOT.pitch, y: FOOT.y, w: FOOT.tabW, h: FOOT.h, label: TAB_NAMES[id] }));
			const ctx = fake();
			footer(ctx, T, tabs, "tab:log");
			const second = tabs[1], first = tabs[0];
			assert.ok(ctx.calls.some((c) => c.color === T.bar && c.x === second.x && c.y === second.y && c.w === second.w && c.h === second.h));
			assert.ok(!ctx.calls.some((c) => c.color === T.bar && c.x === first.x && c.w === first.w && c.h === first.h));
			assert.ok(ctx.calls.some((c) => c.color === T.bg && c.x === first.x && c.w === first.w && c.h === first.h)); // AN UNLIT TAB IS CLEARED
			const b = FOOT.brand;
			const block = ctx.calls.findIndex((c) => c.color === T.brand && c.x === b.x && c.y === b.y && c.w === b.w && c.h === b.h);
			assert.ok(block >= 0);
			const after = ctx.calls.slice(block + 1).filter((c) => inside(c, b));
			assert.equal(after.length, textCells("MERIDIAN").length);
			assert.ok(after.every((c) => c.color === T.bg));
			const labelOf = (tab) => ctx.calls.filter((c) => c.w === 1 && c.h === 1 && inside(c, { x: tab.x + 5, y: tab.y + 1, w: tab.w - 10, h: tab.h - 2 }));
			assert.ok(labelOf(second).every((c) => c.color === T.bg) && labelOf(second).length === textCells("LOG").length);
			assert.ok(labelOf(first).every((c) => c.color === T.bar) && labelOf(first).length === textCells("SESSION").length);
		});

		test("btn lit fills with the hot colour and writes in the background colour", () => {
			const button = { id: "hint", x: 30, y: 40, w: 50, h: 12, label: "HINT", enabled: true };
			const ctx = fake();
			btn(ctx, T, button, true);
			assert.ok(ctx.calls.some((c) => c.color === T.hot && c.x === 30 && c.y === 40 && c.w === 50 && c.h === 12));
			const text = ctx.calls.filter((c) => c.w === 1 && c.h === 1 && inside(c, { x: 31, y: 41, w: 48, h: 10 }));
			assert.equal(text.length, textCells("HINT").length);
			assert.ok(text.every((c) => c.color === T.bg));
		});

		test("btn not enabled draws its frame and label in the dim colour", () => {
			const ctx = fake();
			btn(ctx, T, { id: "draw", x: 30, y: 40, w: 50, h: 12, label: "DRAW", enabled: false }, false);
			assert.ok(!ctx.calls.some((c) => c.color === T.ink || c.color === T.hot));
			const text = ctx.calls.filter((c) => c.w === 1 && c.h === 1 && inside(c, { x: 31, y: 41, w: 48, h: 10 }));
			assert.ok(text.length === textCells("DRAW").length && text.every((c) => c.color === T.dim));
		});

		test("btn stays inside its rectangle and its shadow one pixel down and right", () => {
			const ctx = fake();
			btn(ctx, T, { id: "pgn", x: 30, y: 40, w: 50, h: 12, label: "A VERY LONG LABEL", enabled: true }, false);
			assert.ok(ctx.calls.every((c) => inside(c, { x: 30, y: 40, w: 51, h: 13 })));
		});

		test("station draws its label in the background colour on the bar colour", () => {
			const ctx = fake();
			station(ctx, T, "TERMINAL 03 - READING ROOM");
			assert.equal(ctx.calls[0].color, T.bar);
			assert.deepEqual([ctx.calls[0].x, ctx.calls[0].y, ctx.calls[0].w, ctx.calls[0].h], [BAR.x, BAR.y, BAR.w, BAR.h]);
			const text = ctx.calls.filter((c) => c.w === 1 && c.h === 1);
			assert.equal(text.length, textCells("TERMINAL 03 - READING ROOM").length);
			assert.ok(text.every((c) => c.color === T.bg && inside(c, BAR)));
		});

		test("win draws its frame, title and close box inside the window and its shadow", () => {
			const ctx = fake();
			const r = WIN.session;
			win(ctx, T, r, "SESSION");
			assert.ok(ctx.calls.every((c) => inside(c, { x: r.x, y: r.y, w: r.w + 3, h: r.h + 3 })));
			assert.ok(ctx.calls.some((c) => c.color === T.bg && c.x === r.x && c.y === r.y && c.w === r.w && c.h === r.h));
			const cb = closeBox(r);
			assert.ok(ctx.calls.filter((c) => c.color === T.ink && inside(c, cb)).length > 10);
			const used = new Set(ctx.calls.map((c) => c.color));
			assert.ok([...used].every((c) => [T.bg, T.ink, T.dim, T.faint].includes(c)));
		});

		test("wall fills the grid with the background and draws only in the faint colour", () => {
			const ctx = fake();
			wall(ctx, T);
			assert.deepEqual(ctx.calls[0], { x: 0, y: 0, w: W, h: H, color: T.bg });
			assert.ok(ctx.calls.slice(1).every((c) => c.color === T.faint && whole(c)));
		});

		test("scroll, meter and lamp draw in the theme's colours", () => {
			const s = fake(); scroll(s, T, 280, 50, 100, 10, 20);
			assert.ok(s.calls.every((c) => [T.ink, T.dim].includes(c.color) && inside(c, { x: 280, y: 50, w: 8, h: 100 })));
			const m = fake(); meter(m, T, 10, 10, 5, 2);
			assert.equal(m.calls.filter((c) => c.color === T.ink).length, 2);
			assert.ok(m.calls.every((c) => [T.ink, T.dim].includes(c.color) && inside(c, { x: 10, y: 10, w: 24, h: 7 })));
			const on = fake(); lamp(on, T, 3, 4, true);
			assert.deepEqual(on.calls, [{ x: 3, y: 4, w: 6, h: 5, color: T.hot }]);
			const off = fake(); lamp(off, T, 3, 4, false);
			assert.ok(off.calls.length > 0 && off.calls.every((c) => c.color === T.dim));
		});

		test("sentence lowers the capitals, raises each sentence's first letter and drops the arrows", () => {
			assert.equal(sentence("WHITE WINS! BY CHECKMATE"), "White wins! By checkmate");
			assert.equal(sentence("◀ MOVES ▶"), "Moves");
			assert.equal(sentence(null), "");
		});

		test("the kit's text is HEIGHT tall", () => {
			const ctx = fake(); drawText(ctx, "A", 0, 0, "#fff");
			assert.equal(Math.max(...ctx.calls.map((c) => c.y + c.h)), HEIGHT);
		});
		test("chrome fills the frame with the background first and borders it in ink", () => {
			const ctx = fake();
			chrome(ctx, T, "SESSION", P, { front: true });
			assert.deepEqual(ctx.calls[0], { ...P.frame, color: T.bg });
			const f = P.frame, ink = ctx.calls.filter((c) => c.color === T.ink);
			for (const edge of [{ x: f.x, y: f.y, w: f.w, h: 1 }, { x: f.x, y: f.y + f.h - 1, w: f.w, h: 1 }, { x: f.x, y: f.y + 1, w: 1, h: f.h - 2 }, { x: f.x + f.w - 1, y: f.y + 1, w: 1, h: f.h - 2 }]) {
				assert.ok(ink.some((c) => same(c, edge)), JSON.stringify(edge));
			}
			assert.ok(ctx.calls.every(whole));
			assert.ok(ctx.calls.every((c) => [T.bg, T.ink, T.dim, T.faint].includes(c.color)));
			assert.equal(ctx.fillStyle, ""); // THE CONTEXT IS LEFT AS IT WAS
		});

		test("chrome writes the front window's title in ink and a window behind in dim", () => {
			const front = fake(); chrome(front, T, "SESSION", P, { front: true });
			const back = fake(); chrome(back, T, "SESSION", P, { front: false });
			const f = titleCells(front, P), b = titleCells(back, P);
			assert.equal(f.length, textCells("SESSION").length);
			assert.equal(b.length, textCells("SESSION").length);
			assert.ok(f.every((c) => c.color === T.ink));
			assert.ok(b.every((c) => c.color === T.dim));
			const stripes = (ctx) => ctx.calls.filter((c) => c.h === 1 && c.w > 1 && c.color === T.ink && inside(c, { x: P.title.x + 1, y: P.title.y + 1, w: P.title.w - 2, h: P.title.h - 2 }));
			assert.ok(stripes(front).length >= 4); // THE FRONT TITLE BAR IS STRIPED
			assert.equal(stripes(back).length, 0); // A WINDOW BEHIND HAS NO STRIPES
			const boxes = (ctx, r) => ctx.calls.filter((c) => inside(c, r) && c.color !== T.bg);
			const old = { x: P.close.x - 12, y: P.close.y, w: 10, h: 10 }; // WHERE THE MINIMIZE BOX WAS: ONLY THE FRONT WINDOW'S STRIPES NOW
			assert.ok(boxes(front, old).every((c) => c.h === 1 && c.w > 1));
			assert.equal(boxes(back, old).length, 0);
			assert.ok(boxes(front, P.close).length > 10 && boxes(front, P.close).every((c) => c.color === T.ink));
			assert.ok(boxes(back, P.close).length > 10 && boxes(back, P.close).every((c) => c.color === T.dim));
		});

		test("chrome draws nothing inside the view but the background fill", () => {
			for (const front of [true, false]) {
				const ctx = fake();
				chrome(ctx, T, "A VERY LONG TITLE THAT WILL NOT FIT IN THE BAR AT ALL", P, { front });
				assert.ok(ctx.calls.slice(1).every((c) => !overlaps(c, P.view)));
			}
		});

		test("chrome fills the scroll tracks faint and the thumbs ink, and draws nothing there without them", () => {
			const ctx = fake(); chrome(ctx, T, "LOG", P, { front: true });
			for (const [bar, thumb] of [[P.vbar, P.vthumb], [P.hbar, P.hthumb]]) {
				const track = ctx.calls.findIndex((c) => same(c, bar) && c.color === T.faint);
				const at = ctx.calls.findIndex((c) => same(c, thumb) && c.color === T.ink);
				assert.ok(track > 0 && at > track);
			}
			const bare = { ...P, vbar: null, hbar: null, vthumb: null, hthumb: null };
			const none = fake(); chrome(none, T, "LOG", bare, { front: true });
			assert.ok(none.calls.slice(1).every((c) => !overlaps(c, P.vbar) && !overlaps(c, P.hbar)));
		});

		test("chrome draws the grip in dim inside its box", () => {
			const ctx = fake(); chrome(ctx, T, "LOG", P, { front: true });
			const grip = ctx.calls.filter((c) => overlaps(c, P.grip) && c.color !== T.bg);
			assert.ok(grip.length >= 6);
			assert.ok(grip.every((c) => inside(c, P.grip) && c.color === T.dim));
		});

		test("the smallest window draws inside its frame and its title stays left of the close box", () => {
			const p = partsOf(100, 90, 60, 40);
			for (const front of [true, false]) {
				const ctx = fake();
				chrome(ctx, T, "SYSTEMS DIAGNOSTICS", p, { front });
				assert.ok(ctx.calls.every((c) => inside(c, p.frame)));
				const cells = titleCells(ctx, p);
				assert.ok(cells.length > 0);
				const room = ctx.calls.filter((c) => c.w === 1 && c.h === 1 && overlaps(c, { x: p.title.x, y: p.title.y, w: p.title.w, h: p.title.h }) && c.color === (front ? T.ink : T.dim) && !inside(c, p.close));
				assert.ok(room.every((c) => c.x + c.w <= p.close.x));
				assert.ok(cells.length < textCells("SYSTEMS DIAGNOSTICS").length); // CUT TO FIT
			}
		});

		test("footer lights every tab that carries lit", () => {
			const tabs = ["session", "log", "mail"].map((id, i) => ({ id: `tab:${id}`, x: FOOT.x + i * FOOT.pitch, y: FOOT.y, w: FOOT.tabW, h: FOOT.h, label: TAB_NAMES[id], lit: id !== "log" }));
			const ctx = fake();
			footer(ctx, T, tabs);
			assert.ok(ctx.calls.some((c) => c.color === T.bar && same(c, tabs[0])));
			assert.ok(ctx.calls.some((c) => c.color === T.bar && same(c, tabs[2])));
			assert.ok(!ctx.calls.some((c) => c.color === T.bar && same(c, tabs[1])));
			assert.equal(ctx.fillStyle, "");
		});

	});
});

// /
group("themes", () => {
	const { test } = require("node:test");
	const assert = require("node:assert/strict");
	const { THEME_IDS, DEFAULT_THEME, themeFor } = require("../../src/js/gameplay/three/monitor/themes.js");

	const COLOURS = ["bg", "ink", "dim", "faint", "hot", "bar", "brand", "splash"];

	test("the five theme ids come in order, slate / amber first and the default", () => {
		assert.deepEqual(THEME_IDS, ["slateamber", "base", "paper", "contrast", "contrastgreen"]);
		assert.equal(DEFAULT_THEME, "slateamber");
	});

	test("each id gives its own theme with a label and a glow flag", () => {
		for (const id of THEME_IDS) {
			const T = themeFor(id);
			assert.equal(T.id, id);
			assert.equal(typeof T.label, "string");
			assert.equal(typeof T.glow, "boolean");
		}
		assert.equal(themeFor("paper").glow, false);
		assert.equal(themeFor("base").glow, true);
	});

	test("an unknown or missing id gives the default theme", () => {
		assert.equal(themeFor("nope").id, "slateamber");
		assert.equal(themeFor(undefined).id, "slateamber");
		assert.equal(themeFor("toString").id, "slateamber");
	});

	test("every dark theme has the same near-black background", () => {
		for (const id of THEME_IDS.filter((id) => id !== "paper")) assert.equal(themeFor(id).bg, "#0d0d0d");
		assert.equal(themeFor("paper").bg, "#ecebe4");
	});

	test("slate / amber has a slate bar and an amber brand and splash", () => {
		const T = themeFor("slateamber");
		assert.equal(T.bar, "#8fb2c4");
		assert.equal(T.brand, "#ffb648");
		assert.equal(T.splash, "#ffb648");
	});

	test("the other themes draw the bar, brand and splash in their own ink", () => {
		for (const id of THEME_IDS.slice(1)) {
			const T = themeFor(id);
			assert.equal(T.bar, T.ink);
			assert.equal(T.brand, T.ink);
			assert.equal(T.splash, T.ink);
		}
		assert.equal(themeFor("contrast").ink, "#ffe600");
		assert.equal(themeFor("contrastgreen").ink, "#00ff41");
	});

	test("every colour is a six-digit lower-case hex", () => {
		for (const id of THEME_IDS) for (const key of COLOURS) assert.match(themeFor(id)[key], /^#[0-9a-f]{6}$/, `${id}.${key}`);
	});
});

// /
group("screens-session", () => {
	const { test, describe } = require("node:test");
	const assert = require("node:assert/strict");
	const session = require("../../src/js/gameplay/three/monitor/screens/session.js");
	const { INPUT_MAX } = require("../../src/js/gameplay/three/monitor/commands.js");

	const { size, rows, draw, buttons, press, speak, tick } = session;

	// EVERY COLOUR DIFFERENT, SO A TEST CAN TELL WHICH ONE A PART USED
	const T = { id: "t", label: "Test", bg: "#000001", ink: "#000002", dim: "#000003", faint: "#000004", hot: "#000005", bar: "#000006", brand: "#000007", splash: "#000008", glow: false };

	function fake() {
		const calls = [];
		return { calls, fillStyle: "", fillRect(x, y, w, h) { calls.push({ x, y, w, h, color: this.fillStyle }); } };
	}
	const lines = (n) => Array.from({ length: n }, (_, i) => [`line ${i}`, ["ink", "dim", "hot"][i % 3]]);
	const BOX = { w: 250, h: 158 };
	const base = (over = {}) => ({ T, term: { lines: lines(3) }, ui: {}, input: "", cursorOn: false, focus: "console", zoomed: true, reduce: false, now: 0, box: BOX, ...over });
	const textRows = (ctx, color) => new Set(ctx.calls.filter((c) => c.color === color && c.w === 1 && c.h === 1).map((c) => c.y));

	describe("session screen", () => {
		test("a 250 x 158 box with 30 lines shows the last 15 in their tones and the prompt", () => {
			const r = rows(base({ term: { lines: lines(30) } }));
			assert.equal(r.length, 16);
			assert.deepEqual(r.slice(0, 15).map((x) => x.text), lines(30).slice(-15).map(([t]) => t));
			r.slice(0, 15).forEach((x, i) => { assert.equal(x.y, 6 + i * 9); assert.equal(x.x, 6); assert.equal(x.color, T[lines(30)[15 + i][1]]); });
			assert.deepEqual(r[15], { text: "> ", x: 6, y: 6 + 15 * 9, color: T.hot });
		});

		test("a 250 x 60 box shows 4 lines and the prompt", () => {
			const r = rows(base({ term: { lines: lines(30) }, box: { w: 250, h: 60 } }));
			assert.equal(r.length, 5);
			assert.deepEqual(r.slice(0, 4).map((x) => x.text), ["line 26", "line 27", "line 28", "line 29"]);
			assert.equal(r[4].text, "> ");
		});

		test("a 250 x 20 box shows only the prompt", () => {
			assert.deepEqual(rows(base({ term: { lines: lines(30) }, box: { w: 250, h: 20 } })), [{ text: "> ", x: 6, y: 6, color: T.hot }]);
		});

		test("a 250 x 8 box draws nothing and does not throw", () => {
			const v = base({ term: { lines: lines(30) }, box: { w: 250, h: 8 }, cursorOn: true });
			assert.deepEqual(rows(v), []);
			const ctx = fake();
			assert.doesNotThrow(() => draw(ctx, v));
			assert.equal(ctx.calls.length, 0);
		});

		test("the prompt row follows the last line, not the bottom", () => {
			const r = rows(base({ input: "move e4" }));
			assert.deepEqual(r[r.length - 1], { text: "> move e4", x: 6, y: 6 + 3 * 9, color: T.hot });
		});

		test("a 100 px wide box draws nothing at x >= 100 or below its height", () => {
			const box = { w: 100, h: 60 };
			const ctx = fake();
			draw(ctx, base({ box, term: { lines: [["x".repeat(60), "ink"], ...lines(10)] }, input: "W".repeat(INPUT_MAX), cursorOn: true }));
			assert.ok(ctx.calls.length > 0);
			for (const c of ctx.calls) { assert.ok(c.x + c.w <= 100 && c.y + c.h <= 60, `fill at ${c.x},${c.y} ${c.w}x${c.h}`); }
		});

		test("a 60-letter line and a full input of W stay inside a 250 box", () => {
			const ctx = fake();
			draw(ctx, base({ term: { lines: [["x".repeat(60), "ink"]] }, input: "W".repeat(INPUT_MAX), cursorOn: true }));
			for (const c of ctx.calls) { assert.ok(c.x + c.w <= 250 - 6, `fill at ${c.x} + ${c.w}`); }
		});

		test("nothing is drawn at a negative x or y", () => {
			const ctx = fake();
			draw(ctx, base({ term: { lines: lines(30) }, cursorOn: true }));
			for (const c of ctx.calls) { assert.ok(c.x >= 0 && c.y >= 0, `fill at ${c.x},${c.y}`); }
		});

		test("no cursor without focus on the console, a 5 x 7 cursor in hot with it", () => {
			const block = (ctx) => ctx.calls.filter((c) => c.w === 5 && c.h === 7 && c.color === T.hot);
			const off = fake(); draw(off, base({ input: "ab" }));
			assert.equal(block(off).length, 0);
			const on = fake(); draw(on, base({ input: "ab", cursorOn: true }));
			assert.deepEqual(block(on).map(({ x, y }) => ({ x, y })), [{ x: 6 + 4 * 6, y: 6 + 3 * 9 }]);
			const away = fake(); draw(away, base({ input: "ab", cursorOn: true, focus: "mail" }));
			assert.equal(block(away).length, 0);
		});

		test("draws lines in their tones and the prompt in hot, an unknown tone in ink", () => {
			const ctx = fake();
			draw(ctx, base());
			assert.ok(textRows(ctx, T.ink).has(6));
			assert.ok(textRows(ctx, T.dim).has(15));
			assert.ok(textRows(ctx, T.hot).has(24));
			assert.ok(textRows(ctx, T.hot).has(33));
			assert.equal(rows(base({ term: { lines: [["a", "faint"]] } }))[0].color, T.ink);
		});

		test("size is the box itself, or 250 x 158 without one", () => {
			assert.deepEqual(size(base({ box: { w: 120, h: 70 } })), { w: 120, h: 70 });
			assert.deepEqual(size({ T }), { w: 250, h: 158 });
		});

		test("buttons is the one console button covering the box", () => {
			assert.deepEqual(buttons(base({ box: { w: 120, h: 70 } })), [{ id: "console", x: 0, y: 0, w: 120, h: 70, label: "Console", enabled: true }]);
		});

		test("press: console starts typing, anything else does nothing", () => {
			const got = [];
			const handlers = { ui: (p) => got.push(["ui", p]), screen: (id) => got.push(["screen", id]) };
			press("console", handlers, base());
			press("close", handlers, base());
			press("nope", handlers, base());
			assert.deepEqual(got, [["ui", { typing: true }]]);
		});

		test("tick is 500 when zoomed, null under reduce or away from the monitor", () => {
			assert.equal(tick(base()), 500);
			assert.equal(tick(base({ reduce: true })), null);
			assert.equal(tick(base({ zoomed: false })), null);
		});

		test("speak is the last printed line, or says there is none", () => {
			assert.equal(speak(base()), "line 2");
			assert.equal(speak(base({ term: { lines: [] } })), "No output yet.");
		});

		test("a sparse v draws the prompt at the default size and never throws", () => {
			const v = { T };
			assert.doesNotThrow(() => draw(fake(), v));
			assert.deepEqual(rows(v), [{ text: "> ", x: 6, y: 6, color: T.hot }]);
			assert.equal(rows({ T, term: { lines: lines(30) } }).length, 16);
			assert.equal(speak(v), "No output yet.");
			assert.deepEqual(buttons(v), [{ id: "console", x: 0, y: 0, w: 250, h: 158, label: "Console", enabled: true }]);
			assert.equal(tick(v), null);
		});
	});
});

// /
group("screens-log", () => {
	const { test, describe } = require("node:test");
	const assert = require("node:assert/strict");
	const log = require("../../src/js/gameplay/three/monitor/screens/log.js");

	// EVERY COLOUR DIFFERENT, SO A TEST CAN TELL WHICH ONE A PART USED
	const T = { id: "t", label: "Test", bg: "#000001", ink: "#000002", dim: "#000003", faint: "#000004", hot: "#000005", bar: "#000006", brand: "#000007", splash: "#000008", glow: false };

	function fake() {
		const calls = [];
		return { calls, fillStyle: "", fillRect(x, y, w, h) { calls.push({ x, y, w, h, color: this.fillStyle }); } };
	}
	const entries = (n, text = "Entry") => Array.from({ length: n }, (_, i) => ["14:" + String(i % 60).padStart(2, "0"), `${text} ${i + 1}`, "ink"]);
	const base = (n = 0, extra = {}) => ({ T, term: { log: entries(n) }, ui: {}, now: 0, box: { w: 278, h: 160 }, ...extra });
	const spy = () => { const got = []; return { got, ui: (p) => got.push(p), screen: (id) => got.push({ screen: id }) }; };
	const pixelsIn = (calls, y) => calls.filter((c) => c.w === 1 && c.h === 1 && c.y >= y && c.y < y + 7); // ONE TEXT ROW'S DOTS

	describe("log screen rows", () => {
		test("3 entries number 001 to 003 at y 11, 20 and 29", () => {
			const r = log.rows(base(3));
			assert.deepEqual(r.map((x) => x.no), ["001", "002", "003"]);
			assert.deepEqual(r.map((x) => x.y), [11, 20, 29]);
			assert.equal(r[2].text, "Entry 3");
		});

		test("40 entries give all 40 rows, oldest first", () => {
			const r = log.rows(base(40));
			assert.equal(r.length, 40);
			assert.equal(r[0].no, "001");
			assert.equal(r[39].no, "040");
			assert.equal(r[39].y, 11 + 39 * 9);
		});

		test("past 999 the number shows its last three digits", () => {
			const r = log.rows(base(1001));
			assert.equal(r[1000].no, "001");
			assert.equal(r[999].no, "000");
		});

		test("a wider box shows more of a long entry and the time is drawn as given", () => {
			const v = (w) => { const x = base(0, { box: { w, h: 100 } }); x.term.log = [[1402, "x".repeat(60), "hot"]]; return x; };
			const [narrow] = log.rows(v(160)), [wide] = log.rows(v(278));
			assert.ok([...wide.text].length > [...narrow.text].length);
			assert.equal(narrow.time, "1402");
			assert.equal(narrow.tone, "hot");
		});

		test("the count line for 0, 1 and 2 entries", () => {
			assert.equal(log.countLine(base(0)), "0 entries. Recording.");
			assert.equal(log.countLine(base(1)), "1 entry. Recording.");
			assert.equal(log.countLine(base(2)), "2 entries. Recording.");
		});
	});

	describe("log screen size", () => {
		test("40 entries are 11 + 360 + 13 tall at the box's width", () => {
			assert.deepEqual(log.size(base(40)), { w: 278, h: 11 + 360 + 13 });
		});

		test("no entries size for one row", () => {
			assert.deepEqual(log.size(base(0)), { w: 278, h: 11 + 9 + 13 });
		});

		test("with no box the width is 278", () => {
			assert.equal(log.size({ T, term: { log: entries(2) } }).w, 278);
			assert.equal(log.size({ T }).h, 11 + 9 + 13);
		});
	});

	describe("log screen drawing", () => {
		test("3 entries draw their rows and the count line under them in dim", () => {
			const ctx = fake();
			log.draw(ctx, base(3));
			for (const y of [11, 20, 29]) { assert.ok(pixelsIn(ctx.calls, y).length > 0, `row at ${y}`); }
			const count = pixelsIn(ctx.calls, 11 + 27 + 4);
			assert.ok(count.length > 0);
			assert.ok(count.every((c) => c.color === T.dim));
			assert.equal(ctx.calls.some((c) => c.y >= 11 + 27 + 4 + 9), false);
		});

		test("40 entries all draw, the last row and the count line too", () => {
			const ctx = fake();
			log.draw(ctx, base(40));
			assert.ok(pixelsIn(ctx.calls, 11 + 39 * 9).length > 0);
			assert.ok(pixelsIn(ctx.calls, 11 + 360 + 4).length > 0);
		});

		test("the header bar spans the content's width at y 0, 11 tall", () => {
			const ctx = fake();
			log.draw(ctx, base(3, { box: { w: 200, h: 100 } }));
			assert.ok(ctx.calls.some((c) => c.x === 0 && c.y === 0 && c.w === 200 && c.h === 11 && c.color === T.ink));
		});

		test("no entries draw No entries yet. in dim on the first row", () => {
			const ctx = fake();
			log.draw(ctx, base(0));
			const row = pixelsIn(ctx.calls, 11);
			assert.ok(row.length > 0);
			assert.ok(row.every((c) => c.color === T.dim));
			assert.ok(pixelsIn(ctx.calls, 11 + 9 + 4).length > 0);
		});

		test("with a 120 px wide box nothing is drawn at x 120 or past it", () => {
			const v = base(0, { box: { w: 120, h: 80 } }); v.term.log = entries(5, "W".repeat(80));
			const ctx = fake();
			log.draw(ctx, v);
			assert.ok(ctx.calls.every((c) => c.x + c.w <= 120));
		});

		test("with a 278 box a 60-letter entry stays inside 278", () => {
			const v = base(0); v.term.log = [["14:02", "W".repeat(60), "ink"]];
			const ctx = fake();
			log.draw(ctx, v);
			assert.ok(pixelsIn(ctx.calls, 11).length > 0);
			assert.ok(ctx.calls.every((c) => c.x >= 0 && c.y >= 0 && c.x + c.w <= 278));
			assert.ok(ctx.calls.every((c) => [c.x, c.y, c.w, c.h].every(Number.isInteger)));
		});

		test("an entry draws in its tone's colour", () => {
			const v = base(0); v.term.log = [["14:02", "Hot", "hot"]];
			const ctx = fake();
			log.draw(ctx, v);
			assert.ok(pixelsIn(ctx.calls, 11).some((c) => c.color === T.hot));
		});

		test("a sparse v with no term or box draws without throwing", () => {
			assert.doesNotThrow(() => log.draw(fake(), { T }));
			assert.equal(log.speak({ T }), "0 entries. Recording. No entries yet.");
		});
	});

	describe("log screen input", () => {
		test("buttons is empty and press does nothing", () => {
			assert.deepEqual(log.buttons(base(3)), []);
			const h = spy();
			log.press("close", h, base(3));
			assert.deepEqual(h.got, []);
		});

		test("there is no keys export and no tick", () => {
			assert.equal(log.keys, undefined);
			assert.equal(log.tick, undefined);
		});

		test("speak gives the count line and the newest entry", () => {
			assert.equal(log.speak(base(3)), "3 entries. Recording. Entry 3");
		});
	});

	test("a malformed log entry is skipped instead of drawn", () => {
		const v = { T, term: { log: [null, 5, {}, ["14:02", "New session opened.", "ink"]] } };
		assert.equal(log.countLine(v), "1 entry. Recording.");
		assert.equal(log.rows(v).length, 1);
		assert.equal(log.rows(v)[0].no, "001");
		assert.equal(log.size(v).h, 11 + 9 + 13);
		assert.doesNotThrow(() => log.speak(v));
		assert.doesNotThrow(() => log.draw(fake(), v));
	});
});

// /
group("screens-mail", () => {
	const { test, describe } = require("node:test");
	const assert = require("node:assert/strict");
	const mail = require("../../src/js/gameplay/three/monitor/screens/mail.js");

	const { size, draw, buttons, press, speak, SUBJECT, bodyOf } = mail;

	// EVERY COLOUR DIFFERENT, SO A TEST CAN TELL WHICH ONE A PART USED
	const T = { id: "t", label: "Test", bg: "#000001", ink: "#000002", dim: "#000003", faint: "#000004", hot: "#000005", bar: "#000006", brand: "#000007", splash: "#000008", glow: false };

	function fake() {
		const calls = [];
		return { calls, fillStyle: "", fillRect(x, y, w, h) { calls.push({ x, y, w, h, color: this.fillStyle }); } };
	}
	const m = (kind, text, read = false) => ({ kind, at: "00:01", text, read });
	const ACTIONS = [
		{ id: "hint", label: "Hint", shown: true, enabled: true },
		{ id: "takeback", label: "Takeback", shown: true, enabled: true },
		{ id: "draw", label: "Draw", shown: true, enabled: true },
	];
	function base(extra = {}) {
		return { T, ai: true, who: "GUEST", term: { mail: [] }, ui: {}, actions: ACTIONS, offers: { draw: null, takeback: null }, now: 0, ...extra };
	}
	function spy() {
		const calls = [];
		const h = {};
		for (const name of ["hint", "takeback", "draw", "declineDraw", "declineTakeback", "screen", "ui", "read"]) { h[name] = (...args) => calls.push([name, ...args]); }
		return { h, calls };
	}
	const ids = (v) => buttons(v).map((b) => b.id);
	const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

	describe("mail screen", () => {
		test("with no mail it says No mail. and offers no accept", () => {
			const v = base();
			assert.equal(speak(v), "No mail.");
			assert.ok(!ids(v).includes("accept"));
			assert.ok(!ids(v).some((id) => id.startsWith("msg:")));
		});

		test("a terms mail with an incoming draw offer has accept and decline", () => {
			const v = base({ term: { mail: [m("terms", "[UNIT] proposes terms.")] }, offers: { draw: "incoming", takeback: null } });
			assert.ok(ids(v).includes("accept"));
			assert.ok(ids(v).includes("decline"));
		});

		test("a terms mail whose offer is gone has neither accept nor decline", () => {
			const v = base({ term: { mail: [m("terms", "[UNIT] proposes terms.")] } });
			assert.ok(!ids(v).includes("accept"));
			assert.ok(!ids(v).includes("decline"));
		});

		test("accept on terms calls draw, decline on a reversal calls declineTakeback", () => {
			const t = base({ term: { mail: [m("terms", "x")] }, offers: { draw: "incoming" } });
			const s1 = spy();
			press("accept", s1.h, t);
			assert.deepEqual(s1.calls, [["draw"]]);
			const r = base({ term: { mail: [m("reversal", "x")] }, offers: { takeback: "incoming" } });
			const s2 = spy();
			press("decline", s2.h, r);
			assert.deepEqual(s2.calls, [["declineTakeback"]]);
			const s3 = spy();
			press("accept", s3.h, r);
			assert.deepEqual(s3.calls, [["takeback"]]);
		});

		test("req:hint is missing when not shown and disabled when not enabled", () => {
			const hidden = base({ actions: [{ id: "hint", shown: false, enabled: true }, ...ACTIONS.slice(1)] });
			assert.ok(!ids(hidden).includes("req:hint"));
			const off = base({ actions: [{ id: "hint", shown: true, enabled: false }, ...ACTIONS.slice(1)] });
			const b = buttons(off).find((x) => x.id === "req:hint");
			assert.equal(b.enabled, false);
			assert.equal(b.label, "Guidance");
			const s = spy();
			press("req:hint", s.h, off);
			assert.deepEqual(s.calls, []);
		});

		test("Guidance & Reversal call their handlers; Terms opens the player's terms as a mail that Accept sends & Decline drops", () => {
			const s = spy();
			for (const id of ["req:hint", "req:takeback", "req:draw"]) { press(id, s.h, base()); }
			assert.deepEqual(s.calls, [["hint"], ["takeback"], ["ui", { draft: "terms" }]]);
			const v = base({ ui: { draft: "terms" }, term: { mail: [m("check", "a")] } });
			assert.deepEqual(buttons(v).slice(-2).map((b) => b.id), ["accept", "decline"]);
			assert.match(speak(v), /^Your terms/);
			const yes = spy(), no = spy();
			press("accept", yes.h, v);
			assert.deepEqual(yes.calls, [["ui", { draft: null, selected: null }], ["draw"]]);
			press("decline", no.h, v);
			assert.deepEqual(no.calls, [["ui", { draft: null, selected: null }]]);
			// NO DRAFT ONCE THE OFFER CAN'T BE SENT
			const off = base({ ui: { draft: "terms" }, actions: ACTIONS.map((a) => (a.id === "draw" ? { ...a, enabled: false } : a)) });
			assert.ok(!buttons(off).some((b) => b.id === "accept"));
			// THE DRAFT'S ROWS: FROM THE PLAYER, TO THE OTHER SIDE; NO LISTED MAIL IS DRAWN AS THE ONE SHOWN
			const c = fake();
			draw(c, v);
			assert.ok(!c.calls.some((r) => r.x === 5 && r.y === 7 && r.w === 74 && r.h === 11 && r.color === T.ink));
			assert.equal(mail.fromOf({ draft: true }, base({ who: "ZOE" })), "[ZOE]");
		});

		test("an unread mail is marked hot and msg:0 selects and reads it", () => {
			const v = base({ term: { mail: [m("check", "Notice: check."), m("lost", "Asset lost.", true)] }, ui: { selected: 1 } });
			const c = fake();
			draw(c, v);
			// newest on top: mail 1 in row 0 (y 7), mail 0 in row 1 (y 20); the mark sits at (8, y + 4)
			assert.ok(c.calls.some((r) => r.x === 8 && r.y === 24 && r.w === 6 && r.h === 3 && r.color === T.hot));
			assert.ok(!c.calls.some((r) => r.x === 8 && r.y === 11 && r.color === T.hot));
			const s = spy();
			press("msg:0", s.h, v);
			assert.deepEqual(s.calls, [["ui", { selected: 0, draft: null }], ["read", 0]]);
		});

		test("the list shows the last 6, newest on top, ids by index in term.mail", () => {
			const list = Array.from({ length: 9 }, (_, i) => m("check", `n${i}`));
			const b = buttons(base({ term: { mail: list } })).filter((x) => x.id.startsWith("msg:"));
			assert.deepEqual(b.map((x) => x.id), ["msg:8", "msg:7", "msg:6", "msg:5", "msg:4", "msg:3"]);
			assert.ok(b[0].y < b[1].y);
			assert.equal(b[0].label, "Check");
		});

		test("the selected mail is drawn inverted; out of range selects the newest", () => {
			const v = base({ term: { mail: [m("check", "a"), m("lost", "b")] }, ui: { selected: 7 } });
			const c = fake();
			draw(c, v);
			assert.ok(c.calls.some((r) => r.x === 5 && r.y === 7 && r.w === 74 && r.h === 11 && r.color === T.ink));
			assert.ok(c.calls.some((r) => r.x === 5 && r.y === 20 && r.w === 74 && r.h === 11 && r.color === T.faint));
			assert.match(speak(v), /^2 messages, 2 unread\. Asset lost\.$/);
		});

		test("button order is messages, requests, accept, decline; no close; all inside size(v) and none overlap", () => {
			const v = base({ term: { mail: Array.from({ length: 5 }, () => m("check", "a")).concat([m("terms", "b")]) }, offers: { draw: "incoming" } });
			const b = buttons(v);
			assert.deepEqual(b.map((x) => x.id), ["msg:5", "msg:4", "msg:3", "msg:2", "msg:1", "msg:0", "req:hint", "req:takeback", "req:draw", "accept", "decline"]);
			const { w, h } = size(v);
			for (const x of b) { assert.ok(x.x >= 0 && x.y >= 0 && x.x + x.w <= w && x.y + x.h <= h, x.id); }
			for (let i = 0; i < b.length; i++) { for (let j = i + 1; j < b.length; j++) { assert.ok(!overlap(b[i], b[j]), `${b[i].id} overlaps ${b[j].id}`); } }
			const s = spy();
			press("close", s.h, v);
			assert.deepEqual(s.calls, []);
		});

		test("in the default window the content is 278 x 180 and the buttons sit at their content-pixel rects", () => {
			assert.deepEqual(size(base()), { w: 278, h: 180 });
			const v = base({ term: { mail: [m("check", "a"), m("terms", "b")] }, offers: { draw: "incoming" } });
			const rect = (id) => { const x = buttons(v).find((b) => b.id === id); return [x.x, x.y, x.w, x.h]; };
			assert.deepEqual(rect("msg:1"), [5, 7, 74, 11]);
			assert.deepEqual(rect("msg:0"), [5, 20, 74, 11]);
			assert.deepEqual(rect("req:hint"), [5, 127, 74, 12]);
			assert.deepEqual(rect("req:takeback"), [5, 142, 74, 12]);
			assert.deepEqual(rect("req:draw"), [5, 157, 74, 12]);
			assert.deepEqual(rect("accept"), [103, 157, 70, 12]);
			assert.deepEqual(rect("decline"), [179, 157, 70, 12]);
		});

		test("the content follows its window's width: the pane narrows, & under 200 px only the mail & its answers show", () => {
			const v = base({ term: { mail: [m("check", "a"), m("terms", "b")] }, offers: { draw: "incoming" }, focus: "accept" });
			for (const w of [58, 100, 199, 200, 240, 278, 300]) {
				const at = { ...v, box: { w, h: 60 } }, s = size(at), c = fake();
				assert.equal(s.w, w);
				draw(c, at);
				for (const r of c.calls) { assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= s.w && r.y + r.h <= s.h, `${w}: ${JSON.stringify(r)}`); }
				const b = buttons(at);
				for (const x of b) { assert.ok(x.x >= 0 && x.x + x.w <= s.w && x.y + x.h <= s.h, `${w}: ${x.id}`); }
				assert.deepEqual(b.map((x) => x.id), w < 200 ? ["accept", "decline"] : ["msg:1", "msg:0", "req:hint", "req:takeback", "req:draw", "accept", "decline"]);
			}
			assert.equal(size({ T, box: { w: 20, h: 20 } }).w, 58); // NEVER NARROWER THAN THE SMALLEST WINDOW'S INSIDE
		});

		test("bodyOf keeps to 6 lines of 26 letters and says whether terms are open", () => {
			const open = bodyOf(m("terms", "[UNIT] proposes terms."), base({ offers: { draw: "incoming" } }));
			assert.ok(open.includes("Awaiting your answer."));
			const shut = bodyOf(m("terms", "[UNIT] proposes terms."), base());
			assert.ok(shut.includes("No longer open."));
			const long = bodyOf(m("fault", "word ".repeat(60) + "Averyveryverylongwordthatneverstopsatall"), base());
			assert.ok(long.length <= 6);
			for (const l of long) { assert.ok([...l].length <= 26, l); }
			assert.ok(bodyOf(m("fault", "Line fault."), base()).includes("The session was kept."));
			assert.ok(bodyOf(m("guidance", "Guidance: e2e4"), base()).some((l) => l.includes("e2") && l.includes("e4")));
			for (const kind of Object.keys(SUBJECT)) {
				for (const l of bodyOf(m(kind, "x"), base())) { assert.ok(!/operator|card|curse|!/i.test(l), l); }
			}
		});

		test("SUBJECT has no key or value containing card", () => {
			assert.deepEqual(SUBJECT, { check: "Check", lost: "Asset lost", terms: "Terms", reversal: "Reversal", guidance: "Guidance", fault: "Line fault", answer: "Terms" });
			for (const [k, val] of Object.entries(SUBJECT)) { assert.ok(!/card/i.test(k) && !/card/i.test(val)); }
		});

		test("nothing is drawn at a negative x or y or beyond size(v), a 20-letter name keeps to the pane, a sparse v never throws", () => {
			const v = base({ who: "ABCDEFGHIJKLMNOPQRST", term: { mail: Array.from({ length: 8 }, () => m("terms", "y".repeat(200))) }, offers: { draw: "incoming" }, hover: "decline" });
			const c = fake();
			draw(c, v);
			const { w, h } = size(v);
			for (const x of c.calls) { assert.ok(x.x >= 0 && x.y >= 0 && x.x + x.w <= w && x.y + x.h <= h, JSON.stringify(x)); }
			// the right pane's text, below its header bar, ends at the pane's right edge (100 + 155)
			assert.ok(!c.calls.some((x) => x.y > 16 && x.x > 95 && x.x + x.w > 256));
			const sparse = { T };
			assert.doesNotThrow(() => { draw(fake(), sparse); buttons(sparse); speak(sparse); press("accept", spy().h, sparse); press("req:hint", {}, sparse); });
			assert.equal(speak(sparse), "No mail.");
		});

		test("From names the other side for game mail and MERIDIAN for the terminal's own", () => {
			assert.equal(mail.fromOf(m("terms", "x"), base({ ai: true })), "[UNIT]");
			assert.equal(mail.fromOf(m("check", "x"), base({ ai: false })), "[REMOTE]");
			assert.equal(mail.fromOf(m("fault", "x"), base()), "MERIDIAN");
			assert.equal(mail.fromOf(m("guidance", "x"), base()), "MERIDIAN");
		});
	});

	test("only the newest terms mail can be answered, and decline on terms calls declineDraw", () => {
		const mail = require("../../src/js/gameplay/three/monitor/screens/mail.js");
		const list = [{ kind: "terms", at: "14:01", text: "old", read: true }, { kind: "terms", at: "14:05", text: "new", read: false }];
		const v = (selected) => ({ T: {}, ai: true, who: "GUEST", term: { mail: list }, ui: { selected }, actions: [], offers: { draw: "incoming", takeback: null }, now: 0 });
		const ids = (x) => mail.buttons(x).map((b) => b.id);
		assert.ok(!ids(v(0)).includes("accept"));
		assert.ok(ids(v(1)).includes("accept"));
		const calls = [];
		mail.press("decline", { declineDraw: () => calls.push("declineDraw"), declineTakeback: () => calls.push("declineTakeback") }, v(1));
		assert.deepEqual(calls, ["declineDraw"]);
		assert.doesNotThrow(() => mail.speak({ T: {}, term: { mail: [null, list[1]] } }));
	});
});

// /
group("screens-systems", () => {
	const { test, describe } = require("node:test");
	const assert = require("node:assert/strict");
	const systems = require("../../src/js/gameplay/three/monitor/screens/systems.js");
	const { themeFor } = require("../../src/js/gameplay/three/monitor/themes.js");
	const { textWidth } = require("../../src/js/gameplay/three/pixelFont.js");

	const { size, draw, buttons, press, speak, tick, readout, plan, evalSteps } = systems;

	const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
	// EVERY COLOUR DIFFERENT, SO A TEST CAN TELL WHICH ONE A PART USED
	const T = { id: "slateamber", label: "Slate / Amber", bg: "#000001", ink: "#000002", dim: "#000003", faint: "#000004", hot: "#000005", bar: "#000006", brand: "#000007", splash: "#000008", glow: false };

	function base(over = {}) {
		return {
			who: "GUEST", ai: true, cards: false, playerColor: "w", offline: false, thinking: false, saving: false, check: false,
			fen: START, material: "", sound: true, moves: [{ number: 1, white: "e4", black: "e5" }, { number: 2, white: "Nf3", black: null }],
			actions: [{ id: "hint", label: "Hint", shown: true, enabled: true }, { id: "takeback", label: "Takeback", shown: true, enabled: false }],
			T, term: {}, ui: {}, focus: null, hover: null, reduce: false, now: 100000, startedAt: 100000, movedAt: 100000, ...over,
		};
	}
	function fake() {
		const calls = [];
		return { calls, fillStyle: "", fillRect(x, y, w, h) { calls.push({ x, y, w, h, color: this.fillStyle }); } };
	}
	const inside = (c, r) => c.x >= 0 && c.y >= 0 && c.x + c.w <= r.w && c.y + c.h <= r.h; // CONTENT PIXELS: (0, 0) TO size(v)
	const whole = (c) => [c.x, c.y, c.w, c.h].every(Number.isInteger);
	const row = (v, label) => readout(v).find(([l]) => l === label);
	const spy = () => { const calls = []; const h = new Proxy({}, { get: (_, name) => (...args) => { calls.push([name, ...args]); } }); return { h, calls }; };

	describe("systems screen readout", () => {
		test("a normal game has exactly Session, Moves, the two Lost rows, Material, Link and Record", () => {
			assert.deepEqual(readout(base()).map(([l]) => l), ["Session", "Moves", "Lost: GUEST", "Lost: unit", "Material", "Link", "Record"]);
			assert.deepEqual(readout(base({ ai: false })).map(([l]) => l)[3], "Lost: remote");
		});

		test("no label, value or spoken text holds a card word, with cards false and true", () => {
			for (const cards of [false, true]) {
				const v = base({ cards });
				const words = [...readout(v).flat(), ...buttons(v).map((b) => b.label), speak(v)].join(" ").toLowerCase();
				assert.ok(!words.includes("card") && !words.includes("curse"), words);
			}
		});

		test("Lost counts from a FEN with a missing queen, for each side", () => {
			const fen = "rnb1kbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBN1 w Qkq - 0 1";
			assert.equal(row(base({ fen }), "Lost: GUEST")[1], "1");
			assert.equal(row(base({ fen }), "Lost: unit")[1], "1");
			const asBlack = base({ fen: "rnb1kbnr/pppppppp/8/8/8/8/PPPPPPP1/RNBQKBN1 w Qkq - 0 1", playerColor: "b" });
			assert.equal(row(asBlack, "Lost: GUEST")[1], "1");
			assert.equal(row(asBlack, "Lost: unit")[1], "2");
		});

		test("a missing or bad FEN gives 0 lost", () => {
			for (const fen of [undefined, "", "garbage", "8/8 w"]) {
				assert.equal(row(base({ fen }), "Lost: GUEST")[1], "0");
				assert.equal(row(base({ fen }), "Lost: unit")[1], "0");
			}
		});

		test("Link is down and hot when offline, else stable in ink", () => {
			assert.deepEqual(row(base(), "Link"), ["Link", "stable", "ink"]);
			assert.deepEqual(row(base({ offline: true }), "Link"), ["Link", "down", "hot"]);
		});

		test("Moves counts plies, Material reads even when empty, Record follows saving", () => {
			assert.equal(row(base(), "Moves")[1], "3");
			assert.equal(row(base({ moves: undefined }), "Moves")[1], "0");
			assert.equal(row(base(), "Material")[1], "even");
			assert.equal(row(base({ material: "WHITE +3" }), "Material")[1], "WHITE +3");
			assert.equal(row(base(), "Record")[1], "idle");
			assert.equal(row(base({ saving: true }), "Record")[1], "saving");
		});

		test("Session reads m:ss, then h:mm:ss past an hour", () => {
			assert.equal(row(base({ startedAt: 100000 - 75000 }), "Session")[1], "1:15");
			assert.equal(row(base({ startedAt: 100000 - 3723000 }), "Session")[1], "1:02:03");
			assert.equal(row(base({ startedAt: undefined }), "Session")[1], "0:00");
		});

		test("a 20-letter who in Lost: <who> is cut where it is drawn, never past the READOUT; a missing who is GUEST", () => {
			assert.equal(readout(base({ who: undefined }))[2][0], "Lost: GUEST");
			const v = base({ who: "ABCDEFGHIJKLMNOPQRST" }), ctx = fake();
			draw(ctx, v);
			for (const c of ctx.calls) { assert.ok(inside(c, size(v)), JSON.stringify(c)); }
		});
	});

	describe("systems screen buttons and presses", () => {
		test("the content follows its window's width: two columns from 278, one under it, & under 140 no READOUT, graph or lamps", () => {
			assert.deepEqual(size(base()), { w: 278, h: 180 });
			assert.deepEqual(size({}), { w: 278, h: 180 });
			assert.deepEqual(size(base({ box: { w: 300, h: 60 } })), { w: 300, h: 180 });
			assert.deepEqual(size(base({ box: { w: 200, h: 60 } })), { w: 200, h: 282 });
			assert.deepEqual(size(base({ box: { w: 100, h: 60 } })), { w: 100, h: 119 });
			assert.equal(plan(base({ box: { w: 100, h: 60 } })).readout, null);
			assert.ok(plan(base({ box: { w: 200, h: 60 } })).graph);
			for (const w of [58, 100, 139, 140, 200, 277, 278, 300]) {
				const v = base({ box: { w, h: 60 }, who: "ABCDEFGHIJKLMNOPQRST", thinking: true, eval: { allowed: true, scores: [50, 70, null, 20], failed: false } }), ctx = fake();
				draw(ctx, v);
				for (const c of ctx.calls) { assert.ok(inside(c, size(v)), `${w}: ${JSON.stringify(c)}`); }
				for (const b of buttons(v)) { assert.ok(inside(b, size(v)), `${w}: ${b.id}`); }
			}
		});

		test("buttons are sound, theme, admin, diag in that order with no close, none overlapping, inside size(v)", () => {
			const v = base(), bs = buttons(v);
			assert.deepEqual(bs.map((b) => b.id), ["sound", "theme", "admin", "diag"]);
			for (const b of bs) { assert.ok(inside(b, size(v)), b.id); }
			for (let i = 0; i < bs.length; i++) {
				for (let j = i + 1; j < bs.length; j++) {
					const a = bs[i], b = bs[j];
					assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${a.id} overlaps ${b.id}`);
				}
			}
			assert.deepEqual(bs.map(({ x, y, w, h }) => [x, y, w, h]), [[6, 60, 119, 12], [6, 75, 119, 12], [6, 90, 119, 12], [6, 162, 84, 12]]);
			assert.deepEqual(bs.map((b) => b.label), ["Sound", "Theme", "Administration", "Diagnostics"]);
			assert.deepEqual(bs.map((b) => b.on), [true, undefined, undefined, undefined]); // ONLY SOUND IS A SWITCH
			assert.equal(buttons(base({ sound: false }))[0].on, false);
			const s = spy();
			press("admin", s.h, v);
			assert.deepEqual(s.calls, [["screen", "admin"]]);
		});

		test("press(theme) opens the Theme window once and sets no prefs", () => {
			const s = spy();
			press("theme", s.h, base());
			assert.deepEqual(s.calls, [["screen", "theme"]]);
		});

		test("press(diag) opens the Diagnostics window once and calls no ui", () => {
			const s = spy();
			press("diag", s.h, base());
			assert.deepEqual(s.calls, [["screen", "diag"]]);
		});

		test("press(sound) calls sound", () => {
			const s = spy();
			press("sound", s.h, base());
			assert.deepEqual(s.calls, [["sound"]]);
		});
	});

	describe("systems screen timing and speech", () => {
		test("tick is null under reduce, 250 while thinking or saving, else 1000", () => {
			assert.equal(tick(base({ reduce: true, thinking: true })), null);
			assert.equal(tick(base({ thinking: true })), 250);
			assert.equal(tick(base({ saving: true })), 250);
			assert.equal(tick(base()), 1000);
		});

		test("speak names the Link, Moves and Material readings in one sentence", () => {
			const said = speak(base({ material: "WHITE +3" }));
			assert.match(said, /stable/i);
			assert.match(said, /3/);
			assert.match(said, /white \+3/i);
			assert.equal(said.split(/[.!?](\s|$)/).filter((p) => p && p.trim()).length, 1, said);
		});
	});

	describe("systems screen drawing", () => {
		const at = (ctx, x, y) => ctx.calls.filter((c) => c.x === x && c.y === y);

		test("draws on whole pixels inside size(v), never at a negative x or y, and a sparse v draws without throwing", () => {
			for (const v of [base(), { T, now: 0 }, base({ who: "ABCDEFGHIJKLMNOPQRST", offline: true, saving: true, check: true })]) {
				const ctx = fake();
				draw(ctx, v);
				assert.ok(ctx.calls.length > 0);
				for (const c of ctx.calls) { assert.ok(whole(c), JSON.stringify(c)); assert.ok(inside(c, size(v)), JSON.stringify(c)); }
				buttons(v); speak(v); tick(v); readout(v);
			}
		});

		test("Sound keeps the plain button colours & says on or off with its box; no row for guidance, reversal or motion", () => {
			const [sound] = buttons(base());
			const mark = (ctx, color) => ctx.calls.filter((c) => c.x === sound.x + sound.w - 10 && c.y === sound.y + 3 && c.color === color);
			let ctx = fake();
			draw(ctx, base());
			assert.ok(at(ctx, sound.x, sound.y).some((c) => c.w === sound.w && c.h === sound.h && c.color === T.bg)); // NOT FILLED
			assert.ok(mark(ctx, T.ink).some((c) => c.w === 6 && c.h === 5)); // ON: A SOLID BOX
			ctx = fake();
			draw(ctx, base({ sound: false }));
			assert.ok(!mark(ctx, T.ink).some((c) => c.w === 6 && c.h === 5)); // OFF: ONLY ITS OUTLINE
			assert.ok(mark(ctx, T.ink).some((c) => c.w === 6 && c.h === 1));
			ctx = fake();
			draw(ctx, base({ hover: "sound" }));
			assert.ok(at(ctx, sound.x, sound.y).some((c) => c.w === sound.w && c.h === sound.h && c.color === T.hot)); // HOVERED: LIT, THE BOX INVERTED
			assert.ok(mark(ctx, T.bg).some((c) => c.w === 6 && c.h === 5));
		});

		test("the Evaluation graph draws the player's chance by ply, & says why when there is none", () => {
			assert.deepEqual(evalSteps(base({ eval: { scores: [50, 100, null, 25] } }), 10), [0, 1, null, -0.5]);
			assert.deepEqual(evalSteps(base({ playerColor: "b", eval: { scores: [50, 100, null, 25] } }), 2), [null, 0.5]); // BLACK'S SIDE, THE LAST 2
			assert.deepEqual(evalSteps(base(), 10), []);
			// THE GRAPH'S BOX IS AT (151, 108); ITS MIDDLE LINE AT y 133; EACH STEP 5 px WIDE FROM x 157
			let ctx = fake();
			draw(ctx, base({ eval: { allowed: true, scores: [50, 100], failed: false } }));
			assert.ok(at(ctx, 157, 133).some((c) => c.w === 5 && c.h === 1 && c.color === T.ink));
			assert.ok(at(ctx, 162, 122).some((c) => c.w === 5 && c.h === 1 && c.color === T.ink));
			const steps = (c) => c.calls.filter((r) => r.w === 5 && r.h === 1 && r.x >= 157 && r.y > 118 && r.y < 150 && r.color === T.ink).length;
			for (const e of [undefined, { allowed: false, scores: [50] }, { allowed: true, scores: [null], failed: true }, { allowed: true, scores: [] }]) {
				ctx = fake();
				draw(ctx, base({ eval: e }));
				assert.equal(steps(ctx), 0, JSON.stringify(e));
			}
		});

		test("the bottom lamps: LINK when online, REC while saving, CHECK in check", () => {
			const on = (ctx, i) => at(ctx, 147 + i * 42, 166).some((c) => c.w === 6 && c.h === 5 && c.color === T.hot);
			let ctx = fake();
			draw(ctx, base());
			assert.deepEqual([0, 1, 2].map((i) => on(ctx, i)), [true, false, false]);
			ctx = fake();
			draw(ctx, base({ offline: true, saving: true, check: true, reduce: true }));
			assert.deepEqual([0, 1, 2].map((i) => on(ctx, i)), [false, true, true]);
			// REC BLINKS WITH now UNLESS reduce
			const recs = [0, 500].map((now) => { const c = fake(); draw(c, base({ saving: true, now, startedAt: 0, movedAt: 0 })); return on(c, 1); });
			assert.notEqual(recs[0], recs[1]);
		});

		test("Core load fills 2 cells idle, moves while busy and is still under reduce; Move time fills 1 cell per 2.5 s up to 24", () => {
			// METERS AT (6, 15) AND (6, 37): CELL k AT x 6 + 5k, SOLID ink WHEN FILLED
			const filled = (ctx, y) => ctx.calls.filter((c) => c.y === y && c.w === 4 && c.h === 7 && c.color === T.ink).length;
			const core = (over) => { const c = fake(); draw(c, base(over)); return filled(c, 15); };
			assert.equal(core({}), 2);
			const busy = [0, 250, 500, 750, 1000, 1250].map((now) => core({ thinking: true, now }));
			assert.ok(new Set(busy).size > 1, String(busy));
			const still = [0, 250, 500, 750].map((now) => core({ saving: true, reduce: true, now }));
			assert.equal(new Set(still).size, 1);
			assert.ok(still[0] > 2);
			const move = (ms) => { const c = fake(); draw(c, base({ now: 100000 + ms })); return filled(c, 37); };
			assert.deepEqual([0, 2400, 2500, 10000, 600000].map(move), [0, 0, 1, 4, 24]);
			const c = fake(); draw(c, base({ movedAt: undefined })); assert.equal(filled(c, 37), 0);
		});
	});
});

// /
group("screens-diagnostics", () => {
	const { test, describe } = require("node:test");
	const assert = require("node:assert/strict");
	const diag = require("../../src/js/gameplay/three/monitor/screens/diagnostics.js");

	const T = { id: "t", label: "Test", bg: "#000001", ink: "#000002", dim: "#000003", faint: "#000004", hot: "#000005", bar: "#000006", brand: "#000007", splash: "#000008", glow: false };

	function fake() {
		const calls = [];
		return { calls, fillStyle: "", fillRect(x, y, w, h) { calls.push({ x, y, w, h, color: this.fillStyle }); } };
	}
	const act = (id, shown, enabled) => ({ id, label: id, shown, enabled });
	const base = (more = {}) => ({ T, ui: {}, now: 0, offline: false, over: false, actions: [act("hint", true, true), act("takeback", true, true)], ...more });

	describe("diagnostics window", () => {
		test("a healthy session lists only the S codes", () => {
			assert.deepEqual(diag.codes(base()), [["S01", "No action required."], ["S02", "Session may continue."]]);
		});

		test("every fault is listed in order and S01 drops out", () => {
			const v = base({ offline: true, actions: [act("takeback", true, false), act("hint", true, false)] });
			assert.deepEqual(diag.codes(v), [["F02", "LINK_UNSTABLE"], ["F03", "GUIDANCE_LIMIT_REACHED"], ["F04", "REVERSAL_NOT_PERMITTED"], ["S02", "Session may continue."]]);
		});

		test("a hidden or missing action gives no fault", () => {
			assert.deepEqual(diag.codes(base({ actions: [act("hint", false, false)] })).map((c) => c[0]), ["S01", "S02"]);
			assert.deepEqual(diag.codes({ T }).map((c) => c[0]), ["S01", "S02"]);
		});

		test("a finished game reads Session closed", () => {
			assert.deepEqual(diag.codes(base({ over: true })).at(-1), ["S02", "Session closed."]);
		});

		test("no code or text names cards, whatever the game", () => {
			for (const cards of [true, false, undefined]) {
				const v = base({ cards, offline: true, actions: [act("hint", true, false), act("takeback", true, false)] });
				for (const [code, text] of diag.codes(v)) assert.doesNotMatch(code + text, /card|curse/i);
				assert.doesNotMatch(diag.speak(v), /card|curse/i);
			}
		});

		test("draw stays inside size(v) on whole pixels and draws no window background", () => {
			for (const v of [base(), base({ offline: true, actions: [act("hint", true, false), act("takeback", true, false)] })]) {
				const ctx = fake();
				diag.draw(ctx, v);
				const s = diag.size(v);
				assert.ok(ctx.calls.length > 0);
				for (const c of ctx.calls) {
					assert.ok([c.x, c.y, c.w, c.h].every(Number.isInteger));
					assert.ok(c.x >= 0 && c.y >= 0 && c.x + c.w <= s.w && c.y + c.h <= s.h, JSON.stringify(c));
				}
				assert.ok(!ctx.calls.some((c) => c.x === 0 && c.y === 0 && c.w === s.w && c.h === s.h), "no background fill");
			}
		});

		test("size is 266 wide and 27 plus 9 per code tall", () => {
			assert.deepEqual(diag.size(base()), { w: 266, h: 27 + 2 * 9 });
			const v = base({ offline: true, actions: [act("hint", true, false), act("takeback", true, false)] });
			assert.deepEqual(diag.size(v), { w: 266, h: 27 + 4 * 9 });
			assert.deepEqual(diag.size({ T }), { w: 266, h: 45 });
		});

		test("each extra code makes the content 9 taller", () => {
			const one = diag.size(base({ offline: true })).h; // F02, S02
			const two = diag.size(base({ offline: true, actions: [act("hint", true, false)] })).h; // F02, F03, S02
			assert.equal(two - one, 9);
		});

		test("the header sits at the content's top left: boxed DIAGNOSTICS, filled FAULT CODES", () => {
			const ctx = fake();
			diag.draw(ctx, base());
			assert.ok(ctx.calls.some((c) => c.x === 128 && c.y === 4 && c.w === 122 && c.h === 13 && c.color === T.ink));
			assert.ok(ctx.calls.some((c) => c.x === 4 && c.y === 4 && c.w === 122 && c.color === T.ink));
		});

		test("F code rows draw hot and S code rows draw ink, one row per code at pitch 9", () => {
			const ctx = fake();
			const v = base({ offline: true });
			diag.draw(ctx, v);
			const list = diag.codes(v);
			const rows = diag.rows(v);
			assert.deepEqual(rows, list.map((c, i) => ({ code: c[0], text: c[1], y: 21 + i * 9 })));
			rows.forEach(({ code, y }, i) => {
				const row = ctx.calls.filter((c) => c.y >= y && c.y < y + 7 && c.w === 1 && c.h === 1);
				assert.ok(row.length > 0, `row ${i} drew`);
				const want = code[0] === "F" ? T.hot : T.ink;
				for (const c of row) assert.equal(c.color, want);
			});
		});

		test("the content follows its window's width: one header bar under 254 px, none under 120", () => {
			for (const w of [58, 119, 120, 253, 254, 266, 300]) {
				const v = base({ offline: true, box: { w, h: 60 } }), ctx = fake(), s = diag.size(v);
				assert.equal(s.w, w);
				diag.draw(ctx, v);
				for (const c of ctx.calls) { assert.ok(c.x >= 0 && c.y >= 0 && c.x + c.w <= s.w && c.y + c.h <= s.h, `${w}: ${JSON.stringify(c)}`); }
				assert.equal(diag.rows(v)[0].y, w < 120 ? 6 : 21);
				assert.equal(ctx.calls.some((c) => c.h === 13 && c.y === 4), w >= 120);
			}
		});

		test("draw is safe on a sparse v", () => {
			assert.doesNotThrow(() => diag.draw(fake(), { T }));
			assert.doesNotThrow(() => diag.buttons({ T }));
			assert.doesNotThrow(() => diag.size({ T }));
			assert.doesNotThrow(() => diag.speak({ T }));
		});

		test("no buttons, and press does nothing", () => {
			assert.deepEqual(diag.buttons(base()), []);
			let called = false;
			const handlers = { ui: () => { called = true; }, screen: () => { called = true; } };
			for (const id of ["close", "tab:log", "nope"]) diag.press(id, handlers, base());
			assert.doesNotThrow(() => diag.press("close", {}, base()));
			assert.equal(called, false);
		});

		test("exports size, codes, rows, draw, buttons, press and speak, and no inside or ROW_Y", () => {
			for (const k of ["size", "codes", "rows", "draw", "buttons", "press", "speak"]) assert.equal(typeof diag[k], "function", k);
			assert.equal(diag.inside, undefined);
			assert.equal(diag.ROW_Y, undefined);
		});

		test("speak names the window then each code's text", () => {
			assert.equal(diag.speak(base({ over: true })), "Diagnostics. No action required. Session closed.");
			assert.equal(diag.speak(base({ offline: true })), "Diagnostics. Link unstable. Session may continue.");
		});
	});
});

// /
group("screens-theme", () => {
	const { test, describe } = require("node:test");
	const assert = require("node:assert/strict");
	const theme = require("../../src/js/gameplay/three/monitor/screens/theme.js");
	const { THEME_IDS, themeFor } = require("../../src/js/gameplay/three/monitor/themes.js");

	const T = { id: "paper", label: "Black on white", bg: "#000001", ink: "#000002", dim: "#000003", faint: "#000004", hot: "#000005", bar: "#000006", brand: "#000007", splash: "#000008", glow: false };

	function fake() {
		const calls = [];
		return { calls, fillStyle: "", fillRect(x, y, w, h) { calls.push({ x, y, w, h, color: this.fillStyle }); } };
	}
	const filled = (ctx, b) => ctx.calls.some((c) => c.x === b.x && c.y === b.y && c.w === b.w && c.h === b.h && c.color === T.hot);

	describe("theme window", () => {
		test("five buttons, one per theme in order, with their ids, rects and labels; only the current one is on", () => {
			assert.deepEqual(theme.buttons({ T }), THEME_IDS.map((id, i) => ({ id: "theme:" + id, x: 6, y: 6 + i * 15, w: 146, h: 13, label: themeFor(id).label, enabled: true, ...(id === "paper" ? { on: true } : {}) })));
			assert.deepEqual(theme.buttons({ T }).map((b) => b.label), ["Slate / Amber", "Base", "Black on white", "Contrast: yellow", "Contrast: green"]);
		});

		test("size is 158 wide and holds the fifth button", () => {
			const s = theme.size({ T });
			assert.deepEqual(s, { w: 158, h: 85 });
			const last = theme.buttons({ T }).at(-1);
			assert.ok(last.y + last.h + 1 <= s.h && last.x + last.w + 1 <= s.w);
		});

		test("press on a theme asks for that theme once, also for the current one", () => {
			const got = [];
			const handlers = { prefs: (p) => got.push(p) };
			theme.press("theme:paper", handlers, { T });
			assert.deepEqual(got, [{ theme: "paper" }]);
		});

		test("press on an unknown theme or close does nothing", () => {
			const got = [];
			const handlers = { prefs: (p) => got.push(p), screen: (p) => got.push(p), ui: (p) => got.push(p) };
			theme.press("theme:nope", handlers, { T });
			theme.press("close", handlers, { T });
			theme.press("theme:", handlers, { T });
			assert.deepEqual(got, []);
		});

		test("no button is filled when nothing is focused or hovered, the current theme's neither", () => {
			const ctx = fake();
			theme.draw(ctx, { T });
			for (const b of theme.buttons({ T })) assert.equal(filled(ctx, b), false, b.id);
		});

		test("the current theme carries a box at its right end that others lack: ink on a plain button, inverted on a lit one", () => {
			const inside = (ctx, b, color) => ctx.calls.some((c) => c.color === color && c.w === 6 && c.h === 5 && c.x > b.x && c.x + c.w < b.x + b.w && c.y > b.y && c.y + c.h < b.y + b.h);
			const [, base, paper] = theme.buttons({ T });
			let ctx = fake();
			theme.draw(ctx, { T, focus: "theme:base" });
			assert.equal(inside(ctx, paper, T.ink), true);
			assert.equal(inside(ctx, base, T.ink) || inside(ctx, base, T.bg), false);
			ctx = fake();
			theme.draw(ctx, { T, hover: "theme:paper" });
			assert.equal(filled(ctx, paper), true);
			assert.equal(inside(ctx, paper, T.bg), true);
		});

		test("only a focused or hovered button is lit", () => {
			for (const key of ["focus", "hover"]) {
				const ctx = fake();
				theme.draw(ctx, { T, [key]: "theme:contrast" });
				const b = theme.buttons({ T });
				assert.equal(filled(ctx, b[3]), true, key);
				assert.equal(filled(ctx, b[2]), false, key);
				assert.equal(filled(ctx, b[0]), false, key);
			}
		});

		test("nothing is drawn off whole pixels, at a negative x or y, or past size", () => {
			const ctx = fake();
			theme.draw(ctx, { T, focus: "theme:contrastgreen" });
			const s = theme.size({ T });
			assert.ok(ctx.calls.length > 0);
			for (const c of ctx.calls) {
				assert.ok([c.x, c.y, c.w, c.h].every(Number.isInteger));
				assert.ok(c.x >= 0 && c.y >= 0 && c.x + c.w <= s.w && c.y + c.h <= s.h, JSON.stringify(c));
			}
		});

		test("the buttons are as wide as the window", () => {
			for (const w of [58, 100, 158, 240]) {
				const v = { T, box: { w, h: 60 } }, s = theme.size(v), ctx = fake();
				assert.equal(s.w, w);
				theme.draw(ctx, v);
				for (const b of theme.buttons(v)) { assert.equal(b.w, w - 12); }
				for (const c of ctx.calls) { assert.ok(c.x >= 0 && c.x + c.w <= s.w && c.y + c.h <= s.h, `${w}: ${JSON.stringify(c)}`); }
			}
		});

		test("speak names the current theme's label", () => {
			assert.equal(theme.speak({ T }), "Theme. Current: Black on white.");
			assert.equal(theme.speak({ T: themeFor("contrast") }), "Theme. Current: Contrast: yellow.");
		});

		test("safe on a sparse v, and no card or curse word", () => {
			assert.doesNotThrow(() => theme.draw(fake(), {}));
			assert.doesNotThrow(() => theme.buttons({}));
			assert.doesNotThrow(() => theme.size({}));
			assert.equal(theme.speak({}), "Theme. Current: Slate / Amber.");
			assert.equal(theme.tick, undefined);
			for (const text of [theme.speak({ T }), ...theme.buttons({ T }).map((b) => b.label)]) assert.doesNotMatch(text, /card|curse/i);
		});
	});
});

// /
group("screens-admin", () => {
	const { test } = require("node:test");
	const assert = require("node:assert/strict");
	const admin = require("../../src/js/gameplay/three/monitor/screens/admin.js");
	const T = { id: "t", label: "Test", bg: "#000001", ink: "#000002", dim: "#000003", faint: "#000004", hot: "#000005", bar: "#000006", brand: "#000007", splash: "#000008", glow: false };
	const fake = () => { const calls = []; return { calls, fillStyle: "", fillRect(x, y, w, h) { calls.push({ x, y, w, h, color: this.fillStyle }); } }; };
	const base = (over = {}) => ({ T, over: false, offers: {}, actions: [{ id: "takeback", shown: true, enabled: true }], term: { log: [] }, ui: {}, now: 0, ...over });

	test("REQUEST says what stands with the reversal & is pressable only when one can be asked", () => {
		assert.deepEqual(admin.request(base()), { line: "Reversal - press to request", enabled: true, granted: false });
		assert.deepEqual(admin.request(base({ actions: [] })), { line: "Reversal - not permitted", enabled: false, granted: false });
		assert.deepEqual(admin.request(base({ offers: { takeback: "sent" } })), { line: "Reversal - under review", enabled: false, granted: false });
		assert.equal(admin.request(base({ offers: { takeback: "incoming" } })).enabled, false);
		assert.equal(admin.request(base({ term: { log: [["00:01", "Reversal granted. Noted.", "ink"]] } })).granted, true);
		const calls = [];
		admin.press("request", { takeback: () => calls.push("takeback") }, base({ actions: [] }));
		assert.deepEqual(calls, []);
		admin.press("request", { takeback: () => calls.push("takeback") }, base());
		assert.deepEqual(calls, ["takeback"]);
	});

	test("OVERRIDE asks first, forfeits on the second press & is off once the session closed", () => {
		const calls = [], h = { ui: (p) => calls.push(["ui", p]), forfeit: () => calls.push(["forfeit"]) };
		admin.press("override", h, base());
		assert.deepEqual(calls, [["ui", { confirm: true }]]);
		admin.press("override", h, base({ ui: { confirm: true } }));
		assert.deepEqual(calls.slice(1), [["ui", { confirm: false }], ["forfeit"]]);
		assert.equal(admin.override(base({ ui: { confirm: true } })).line, "End session - confirm?");
		assert.deepEqual(admin.override(base({ over: true, ui: { confirm: true } })), { line: "Session closed.", enabled: false, asking: false });
		admin.press("override", h, base({ over: true }));
		assert.equal(calls.length, 3);
		assert.equal(admin.tick(base({ ui: { confirm: true } })), 700);
		assert.equal(admin.tick(base({ ui: { confirm: true }, reduce: true })), null);
		assert.equal(admin.tick(base()), null);
	});

	test("the two panels are as wide as the window & nothing is drawn outside size(v); a sparse v never throws", () => {
		for (const w of [58, 119, 120, 206, 300]) {
			const v = base({ box: { w, h: 60 }, hover: "request", ui: { confirm: true } }), s = admin.size(v), ctx = fake();
			assert.deepEqual(s, { w, h: 92 });
			admin.draw(ctx, v);
			assert.deepEqual(admin.buttons(v).map((b) => [b.id, b.w]), [["request", w - 12], ["override", w - 12]]);
			for (const c of ctx.calls) { assert.ok(c.x >= 0 && c.y >= 0 && c.x + c.w <= s.w && c.y + c.h <= s.h, `${w}: ${JSON.stringify(c)}`); }
		}
		assert.doesNotThrow(() => { admin.draw(fake(), { T }); admin.buttons({ T }); admin.speak({ T }); admin.press("override", {}, { T, over: true }); });
		assert.doesNotMatch(admin.speak(base()), /card|operator/i);
	});
});
