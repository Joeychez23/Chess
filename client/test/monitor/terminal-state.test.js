/*
 *  terminal-state.test.js  --  chess frontend tests
 *	The terminal's state & input: the kept state, the settings, the windows' geometry, keys & hit tests, the game's data.
 *	One describe per source file, each as it was in its own test file. Run with npm run test:client
 *
 */

const { describe: group } = require("node:test");

// /
group("termStore", () => {
	const { test } = require("node:test");
	const assert = require("node:assert/strict");
	const { KEY, LINES_MAX, LOG_MAX, MAIL_MAX, blank, clean, loadTerm, saveTerm } = require("../../src/js/gameplay/three/monitor/store.js");
	const windows = require("../../src/js/gameplay/three/monitor/windows.js");

	/* ---------------------------------------------------------------- */
	// Helpers
	/* ---------------------------------------------------------------- */

	// A PLAIN OBJECT STANDING IN FOR localStorage
	function fakeStorage(initial = {}) {
		const data = { ...initial };
		return {
			data,
			getItem(key) { return Object.hasOwn(data, key) ? data[key] : null; },
			setItem(key, value) { data[key] = String(value); },
		};
	}

	const throwing = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("full"); } };

	// ALL SIX WINDOWS, MOVED ABOUT: THE LOG OPEN & IN FRONT, SESSION MINIMIZED
	function WINS() {
		return windows.close(windows.open(windows.defaults(), "log"), "session");
	}

	function full() {
		return {
			version: 2, gameId: "g1",
			lines: [["hello", "ink"], ["careful", "hot"]],
			log: [["12:01", "New session opened.", "ink"]],
			mail: [{ kind: "terms", at: "12:02", text: "[UNIT] proposes terms.", read: false }],
			wins: WINS(), flipped: true,
		};
	}

	/* ---------------------------------------------------------------- */
	// Tests
	/* ---------------------------------------------------------------- */

	test("limits and key", () => {
		assert.equal(KEY, "MERIDIAN");
		assert.deepEqual([LINES_MAX, LOG_MAX, MAIL_MAX], [60, 200, 30]);
	});

	test("blank is the empty version 2 state with the windows at their defaults", () => {
		assert.deepEqual(blank(), { version: 2, gameId: null, lines: [], log: [], mail: [], wins: windows.defaults(), flipped: false });
		assert.notEqual(blank().lines, blank().lines); // A FRESH OBJECT EACH CALL
	});

	test("save then load brings back a full state, with the windows back at their defaults", () => {
		const store = fakeStorage();
		assert.equal(saveTerm(full(), store), true);
		assert.notDeepEqual(full().wins, windows.defaults());
		assert.deepEqual(loadTerm(store), { ...full(), wins: windows.defaults() });
	});

	test("clean keeps the last 60 lines, 200 log entries and 30 mails", () => {
		const raw = full();
		raw.lines = Array.from({ length: 70 }, (_, i) => [`l${i}`, "ink"]);
		raw.log = Array.from({ length: 210 }, (_, i) => ["12:00", `e${i}`, "dim"]);
		raw.mail = Array.from({ length: 35 }, (_, i) => ({ kind: "check", at: "12:00", text: `m${i}`, read: true }));
		const t = clean(raw);
		assert.equal(t.lines.length, 60);
		assert.equal(t.lines[0][0], "l10");
		assert.equal(t.lines[59][0], "l69");
		assert.equal(t.log.length, 200);
		assert.equal(t.log[0][1], "e10");
		assert.equal(t.mail.length, 30);
		assert.equal(t.mail[0].text, "m5");
	});

	test("a line or log entry with an unknown tone becomes ink", () => {
		const raw = full();
		raw.lines = [["x", "purple"], ["y"]];
		raw.log = [["12:00", "z", 7]];
		const t = clean(raw);
		assert.deepEqual(t.lines, [["x", "ink"], ["y", "ink"]]);
		assert.deepEqual(t.log, [["12:00", "z", "ink"]]);
	});

	test("the windows are kept as they were left, and junk gives the defaults", () => {
		assert.deepEqual(clean(full()).wins, WINS());
		assert.deepEqual(clean({ ...full(), wins: "nope" }).wins, windows.defaults());
		const far = clean({ ...full(), wins: [{ id: "log", x: 9999, y: -50, w: 5, h: 5, open: true, min: false }] }).wins;
		assert.equal(far.length, 7);
		const log = far.find((w) => w.id === "log");
		assert.ok(log.x + log.w <= 320 && log.y >= 16 && log.w >= 60 && log.h >= 40);
	});

	test("malformed lines, log entries and mails are dropped", () => {
		const raw = full();
		raw.lines = [null, "text", [5, "ink"], ["ok", "dim"], {}];
		raw.log = [["12:00", "ok", "hot"], ["12:00"], [{}, "x", "ink"], "x", null];
		raw.mail = [null, { kind: "spam", at: "1", text: "x", read: false }, { kind: "lost", at: "12:00", text: 4, read: false },
			{ kind: "lost", at: "12:00", text: "Asset lost.", read: "yes" }, { kind: "fault", at: 5, text: "Line fault.", read: true }];
		const t = clean(raw);
		assert.deepEqual(t.lines, [["ok", "dim"]]);
		assert.deepEqual(t.log, [["12:00", "ok", "hot"]]);
		assert.deepEqual(t.mail, [{ kind: "lost", at: "12:00", text: "Asset lost.", read: false }, { kind: "fault", at: 5, text: "Line fault.", read: true }]);
	});

	test("every mail kind is kept", () => {
		const kinds = ["check", "lost", "terms", "reversal", "guidance", "fault"];
		const t = clean({ ...full(), mail: kinds.map((kind) => ({ kind, at: "12:00", text: "t", read: false })) });
		assert.deepEqual(t.mail.map((m) => m.kind), kinds);
	});

	test("fields of the wrong type fall back to blank values", () => {
		const t = clean({ version: 2, gameId: {}, lines: "no", log: 4, mail: {}, wins: 7, flipped: 1 });
		assert.deepEqual(t, blank());
		assert.equal(clean({ ...full(), gameId: 42 }).gameId, 42);
	});

	test("anything that is not a version 2 object gives blank, a version 1 state too", () => {
		for (const raw of [undefined, null, 5, "x", [], { ...full(), version: 1 }, { ...full(), version: "2" }]) {
			assert.deepEqual(clean(raw), blank());
		}
	});

	test("broken JSON, a number, another version and an empty storage load as blank", () => {
		assert.deepEqual(loadTerm(fakeStorage({ MERIDIAN: "{broken" })), blank());
		assert.deepEqual(loadTerm(fakeStorage({ MERIDIAN: "42" })), blank());
		assert.deepEqual(loadTerm(fakeStorage({ MERIDIAN: JSON.stringify({ ...full(), version: 1 }) })), blank());
		assert.deepEqual(loadTerm(fakeStorage()), blank());
	});

	test("a throwing storage loads as blank and saving to it does not throw", () => {
		assert.deepEqual(loadTerm(throwing), blank());
		assert.equal(saveTerm(full(), throwing), false);
	});

	test("with the default storage (none in Node), load and save do not throw", () => {
		assert.doesNotThrow(() => loadTerm());
		assert.doesNotThrow(() => saveTerm(blank()));
		if (globalThis.localStorage === undefined) { assert.deepEqual(loadTerm(), blank()); }
	});

	test("saveTerm writes JSON under MERIDIAN", () => {
		const store = fakeStorage();
		saveTerm(full(), store);
		assert.deepEqual(JSON.parse(store.data.MERIDIAN), full());
	});

	test("saveTerm writes the cleaned state, so the caps hold whoever saves", () => {
		const store = fakeStorage();
		saveTerm({ ...full(), lines: Array.from({ length: 70 }, (_, i) => ["line " + i, "ink"]) }, store);
		const saved = JSON.parse(store.data.MERIDIAN);
		assert.equal(saved.lines.length, 60);
		assert.equal(saved.lines[59][0], "line 69");
	});
});

// /
group("monitorPrefs", () => {
	const { test } = require("node:test");
	const assert = require("node:assert/strict");
	const { KEY, defaults, clean, loadPrefs, savePrefs } = require("../../src/js/gameplay/three/monitor/prefs.js");

	/* ---------------------------------------------------------------- */
	// Helpers
	/* ---------------------------------------------------------------- */

	// A PLAIN OBJECT STANDING IN FOR localStorage
	function fakeStorage(initial = {}) {
		const data = { ...initial };
		return {
			getItem(key) { return Object.hasOwn(data, key) ? data[key] : null; },
			setItem(key, value) { data[key] = String(value); },
		};
	}

	/* ---------------------------------------------------------------- */
	// Tests
	/* ---------------------------------------------------------------- */

	test("the settings are kept under MONITOR and start on the slateamber theme", () => {
		assert.equal(KEY, "MONITOR");
		assert.deepEqual(defaults(), { version: 2, theme: "slateamber" });
	});
	test("saved settings load back the same", () => {
		const store = fakeStorage();
		assert.equal(savePrefs({ version: 2, theme: "paper" }, store), true);
		assert.deepEqual(loadPrefs(store), { version: 2, theme: "paper" });
	});
	test("broken JSON, null, a version 1 object and an unknown theme load as defaults", () => {
		const old = JSON.stringify({ version: 1, defaultChannel: null, enabled: ["face", "setup"], idle: "stars" });
		for (const raw of ["{", "null", "[]", old, JSON.stringify({ version: 2, theme: "neon" })]) {
			assert.deepEqual(loadPrefs(fakeStorage({ MONITOR: raw })), defaults());
		}
		assert.deepEqual(loadPrefs(fakeStorage()), defaults());
	});
	test("clean keeps the theme and drops unknown fields", () => {
		assert.deepEqual(clean({ version: 2, theme: "contrast", enabled: ["face"], extra: 1 }), { version: 2, theme: "contrast" });
	});
	test("a storage whose getItem or setItem throws does not throw", () => {
		const bad = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
		assert.deepEqual(loadPrefs(bad), defaults());
		assert.equal(savePrefs(defaults(), bad), false);
	});
	test("a throwing localStorage accessor does not throw", () => {
		Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("denied"); } });
		try {
			assert.deepEqual(loadPrefs(), defaults());
			assert.equal(savePrefs(defaults()), false);
		} finally {
			delete globalThis.localStorage;
		}
	});
});

// /
group("windows", () => {
	const { test, describe } = require("node:test");
	const assert = require("node:assert/strict");
	const w = require("../../src/js/gameplay/three/monitor/windows.js");

	const { IDS, TABBED, TITLES, DESK, MIN_W, MIN_H, TITLE_H, BAR, GRIP } = w;

	const inside = (c, r) => c.x >= r.x && c.y >= r.y && c.x + c.w <= r.x + r.w && c.y + c.h <= r.y + r.h;
	const whole = (c) => [c.x, c.y, c.w, c.h].every(Number.isInteger);
	const onDesk = (r) => inside(r, DESK);
	const ids = (wins) => wins.map((x) => x.id);
	const WIN = { id: "log", x: 20, y: 20, w: 280, h: 194, open: true, min: false };
	const RECTS = ["frame", "title", "close", "view", "grip", "vbar", "hbar", "vthumb", "hthumb"];

	describe("window constants", () => {
		test("ids, tabbed ids, titles and sizes match the brief", () => {
			assert.deepEqual(IDS, ["session", "log", "mail", "systems", "diag", "theme", "admin"]);
			assert.deepEqual(TABBED, ["session", "log", "mail", "systems"]);
			assert.deepEqual(TITLES, { session: "SESSION", log: "LOG", mail: "MAIL", systems: "SYSTEMS", diag: "DIAGNOSTICS", theme: "THEME", admin: "ADMIN CONTROL" });
			assert.deepEqual(DESK, { x: 8, y: 16, w: 304, h: 202 });
			assert.deepEqual([MIN_W, MIN_H, TITLE_H, BAR, GRIP], [60, 40, 13, 7, 7]);
		});
	});

	describe("defaults", () => {
		test("every window lies inside the desk", () => {
			assert.ok(w.defaults().every(onDesk));
		});
		test("all seven back to front with mail and session open", () => {
			assert.deepEqual(w.defaults(), [
				{ id: "admin", x: 56, y: 62, w: 208, h: 106, open: false, min: false },
				{ id: "systems", x: 20, y: 20, w: 280, h: 194, open: false, min: false },
				{ id: "log", x: 20, y: 20, w: 280, h: 194, open: false, min: false },
				{ id: "diag", x: 26, y: 70, w: 268, h: 80, open: false, min: false },
				{ id: "theme", x: 80, y: 60, w: 160, h: 100, open: false, min: false },
				{ id: "mail", x: 20, y: 20, w: 280, h: 194, open: true, min: false },
				{ id: "session", x: 40, y: 38, w: 252, h: 172, open: true, min: false },
			]);
		});
		test("a fresh list and fresh objects each call", () => {
			const a = w.defaults(), b = w.defaults();
			assert.notEqual(a, b);
			a.forEach((x, i) => assert.notEqual(x, b[i]));
			a[0].x = 99;
			assert.equal(w.defaults()[0].x, 56);
		});
		test("every default lies on the desk", () => w.defaults().forEach((x) => assert.ok(onDesk(x), x.id)));
	});

	describe("clamp", () => {
		test("a window on the desk is unchanged and not mutated", () => {
			const win = { ...WIN };
			const out = w.clamp(win);
			assert.deepEqual(out, WIN);
			assert.notEqual(out, win);
		});
		test("sizes stop at the minimum and the desk, then the position fits", () => {
			assert.deepEqual(w.clamp({ ...WIN, w: 10, h: 5 }), { ...WIN, w: MIN_W, h: MIN_H });
			assert.deepEqual(w.clamp({ ...WIN, x: 50, y: 50, w: 999, h: 999 }), { ...WIN, ...DESK });
		});
		test("rounds to whole numbers", () => {
			assert.deepEqual(w.clamp({ ...WIN, x: 20.4, y: 19.6, w: 100.5, h: 80.2 }), { ...WIN, x: 20, y: 20, w: 101, h: 80 });
		});
		test("non-finite numbers fall back to that id's default", () => {
			assert.deepEqual(w.clamp({ ...WIN, id: "theme", x: NaN, y: Infinity, w: "50", h: undefined }), { ...WIN, id: "theme", x: 80, y: 60, w: 160, h: 100 });
		});
	});

	describe("move", () => {
		test("moves by the given amount without mutating", () => {
			const win = { ...WIN, w: 100, h: 100 };
			assert.deepEqual(w.move(win, 10, -3), { ...win, x: 30, y: 17 });
			assert.equal(win.x, 20);
		});
		test("dragged past each of the four edges it stays on the desk", () => {
			const win = { ...WIN, w: 100, h: 100 };
			assert.deepEqual(w.move(win, -500, 0), { ...win, x: DESK.x });
			assert.deepEqual(w.move(win, 500, 0), { ...win, x: DESK.x + DESK.w - win.w });
			assert.deepEqual(w.move(win, 0, -500), { ...win, y: DESK.y });
			assert.deepEqual(w.move(win, 0, 500), { ...win, y: DESK.y + DESK.h - win.h });
			assert.equal(w.move(win, -500, 0).x, 8);
			assert.equal(w.move(win, 500, 0).x + win.w, 312);
			for (const [dx, dy] of [[-999, -999], [999, 999], [-999, 999], [999, -999]]) assert.ok(onDesk(w.move(win, dx, dy)));
		});
	});

	describe("resize", () => {
		test("grows right and down, keeping x and y", () => {
			const win = { ...WIN, w: 100, h: 100 };
			assert.deepEqual(w.resize(win, 20, 10), { ...win, w: 120, h: 110 });
			assert.equal(win.w, 100);
		});
		test("below the minimum it stops at the minimum", () => {
			assert.deepEqual(w.resize({ ...WIN, w: 100, h: 100 }, -500, -500), { ...WIN, w: MIN_W, h: MIN_H });
		});
		test("past the desk it stops at the desk's right and bottom edges", () => {
			const win = { ...WIN, x: 50, y: 60, w: 100, h: 100 };
			assert.deepEqual(w.resize(win, 500, 500), { ...win, w: DESK.x + DESK.w - win.x, h: DESK.y + DESK.h - win.y });
		});
	});

	describe("stacking", () => {
		const start = () => w.defaults();
		test("open brings it to the front, open, others in order", () => {
			const wins = start();
			const before = JSON.stringify(wins);
			const out = w.open(wins, "log");
			assert.equal(JSON.stringify(wins), before);
			assert.deepEqual(ids(out), ["admin", "systems", "diag", "theme", "mail", "session", "log"]);
			assert.deepEqual(out[6], { ...start()[2], open: true, min: false });
		});
		test("raise moves it to the front and changes nothing else", () => {
			const wins = start();
			const before = JSON.stringify(wins);
			const out = w.raise(wins, "mail");
			assert.equal(JSON.stringify(wins), before);
			assert.deepEqual(ids(out), ["admin", "systems", "log", "diag", "theme", "session", "mail"]);
			assert.deepEqual(out[6], wins[5]);
			assert.notEqual(out[6], wins[5]);
		});
		test("close shuts it and clears min, order kept", () => {
			const wins = start();
			const before = JSON.stringify(wins);
			const out = w.close(wins, "mail");
			assert.equal(JSON.stringify(wins), before);
			assert.deepEqual(ids(out), ids(wins));
			assert.deepEqual(out[5], { ...wins[5], open: false, min: false });
		});
		test("an unknown id returns an equal list", () => {
			for (const f of [w.open, w.raise, w.close]) assert.deepEqual(f(start(), "nope"), start());
		});
	});

	describe("shown, front and at", () => {
		test("shown lists the open ones back to front", () => {
			let wins = w.open(w.defaults(), "theme");
			wins = w.close(wins, "mail");
			assert.deepEqual(ids(w.shown(wins)), ["session", "theme"]);
		});
		test("front is the last shown one, or null", () => {
			assert.equal(w.front(w.defaults()).id, "session");
			const none = w.close(w.close(w.defaults(), "mail"), "session");
			assert.equal(w.front(none), null);
		});
		test("at picks the topmost of two overlapping windows", () => {
			assert.equal(w.at(w.defaults(), 50, 50).id, "session");
			assert.equal(w.at(w.defaults(), 25, 25).id, "mail");
			assert.equal(w.at(w.raise(w.defaults(), "mail"), 50, 50).id, "mail");
			assert.equal(w.at(w.defaults(), 5, 5), null);
		});
		test("at skips closed windows", () => {
			assert.equal(w.at(w.close(w.defaults(), "session"), 50, 50).id, "mail");
			assert.equal(w.at(w.close(w.defaults(), "session"), 50, 50).id, "mail");
			assert.equal(w.at(w.close(w.close(w.defaults(), "session"), "mail"), 50, 50), null);
		});
		test("the frame's right and bottom edges are outside it", () => {
			const wins = w.close(w.defaults(), "mail"); // session 40,38,252,172
			assert.equal(w.at(wins, 40, 38).id, "session");
			assert.equal(w.at(wins, 291, 209).id, "session");
			assert.equal(w.at(wins, 292, 100), null);
			assert.equal(w.at(wins, 100, 210), null);
		});
	});

	describe("clean", () => {
		test("null, a string or a number gives the defaults", () => {
			for (const raw of [null, undefined, "wins", 3, {}, []]) assert.deepEqual(w.clean(raw), w.defaults());
		});
		test("duplicates keep the first, unknown ids and non-objects are dropped, order kept", () => {
			const raw = [null, "log", { id: "log", x: 30, y: 30, w: 100, h: 100, open: true, min: false }, { id: "zap" }, { id: "log", x: 1 }, ...w.defaults().filter((x) => x.id !== "log")];
			const out = w.clean(raw);
			assert.deepEqual(ids(out), ["log", "admin", "systems", "diag", "theme", "mail", "session"]);
			assert.deepEqual(out[0], { id: "log", x: 30, y: 30, w: 100, h: 100, open: true, min: false });
		});
		test("a missing id is added at the back at its default", () => {
			const out = w.clean(w.defaults().filter((x) => x.id !== "mail"));
			assert.deepEqual(ids(out), ["mail", "admin", "systems", "log", "diag", "theme", "session"]);
			assert.deepEqual(out[0], w.defaults()[5]);
		});
		test("NaN or strings for numbers fall back, records are clamped, flags strictly boolean", () => {
			const raw = [{ id: "theme", x: NaN, y: "5", w: 9999, h: 10, open: "yes", min: 1 }, { id: "diag", x: 500, y: -5, w: 100.6, h: 50, open: true, min: true }, { id: "log", open: false, min: true }];
			const out = w.clean(raw);
			assert.deepEqual(out.slice(4), [
				{ id: "theme", x: DESK.x, y: 60, w: DESK.w, h: 40, open: false, min: false },
				{ id: "diag", x: DESK.x + DESK.w - 101, y: DESK.y, w: 101, h: 50, open: true, min: false }, // A KEPT min IS DROPPED: NOTHING MINIMIZES
				{ id: "log", x: 20, y: 20, w: 280, h: 194, open: false, min: false },
			]);
		});
		test("never throws and does not mutate", () => {
			const raw = [{ id: "log", x: 999, get y() { throw new Error("x"); } }];
			assert.doesNotThrow(() => w.clean(raw));
			const ok = [{ id: "log", x: 999, y: 20, w: 280, h: 194, open: true, min: false }];
			w.clean(ok);
			assert.equal(ok[0].x, 999);
		});
		test("every cleaned record is whole and on the desk", () => {
			const out = w.clean([{ id: "session", x: -3.7, y: 400, w: 1e9, h: -1 }]);
			out.forEach((x) => { assert.ok(whole(x)); assert.ok(onDesk(x)); });
		});
	});

	describe("parts", () => {
		// LOG AT 20,20,280,194: THE INSIDE IS 21,33,278,180
		test("no bars when the content fits", () => {
			const p = w.parts(WIN, { w: 278, h: 180 });
			assert.deepEqual(p.frame, { x: 20, y: 20, w: 280, h: 194 });
			assert.deepEqual(p.title, { x: 20, y: 20, w: 280, h: TITLE_H });
			assert.deepEqual(p.close, { x: 287, y: 22, w: 10, h: 10 });
			assert.deepEqual(p.view, { x: 21, y: 33, w: 278, h: 180 });
			assert.deepEqual(p.grip, { x: 292, y: 206, w: GRIP, h: GRIP });
			assert.deepEqual([p.vbar, p.hbar, p.vthumb, p.hthumb], [null, null, null, null]);
			assert.deepEqual(p.max, { x: 0, y: 0 });
			assert.deepEqual(p.scroll, { x: 0, y: 0 });
		});
		test("a missing or bad content counts as the view's own size", () => {
			for (const c of [undefined, null, "big", { w: NaN, h: "9" }]) {
				const p = w.parts(WIN, c);
				assert.deepEqual(p.view, { x: 21, y: 33, w: 278, h: 180 });
				assert.equal(p.vbar, null);
				assert.equal(p.hbar, null);
			}
		});
		test("a vertical bar only", () => {
			const p = w.parts(WIN, { w: 271, h: 400 });
			assert.deepEqual(p.view, { x: 21, y: 33, w: 271, h: 180 });
			assert.deepEqual(p.vbar, { x: 292, y: 33, w: BAR, h: 173 }); // A LONE BAR STOPS SHORT OF THE GRIP'S CORNER
			assert.equal(p.vbar.y + p.vbar.h, p.grip.y);
			assert.equal(p.hbar, null);
			assert.deepEqual(p.max, { x: 0, y: 220 });
		});
		test("a horizontal bar only", () => {
			const p = w.parts(WIN, { w: 500, h: 173 });
			assert.deepEqual(p.view, { x: 21, y: 33, w: 278, h: 173 });
			assert.deepEqual(p.hbar, { x: 21, y: 206, w: 271, h: BAR });
			assert.equal(p.hbar.x + p.hbar.w, p.grip.x);
			assert.equal(p.vbar, null);
			assert.deepEqual(p.max, { x: 222, y: 0 });
		});
		test("both bars, the horizontal one caused by the vertical one", () => {
			const p = w.parts(WIN, { w: 275, h: 400 }); // FITS 278 BUT NOT 271
			assert.deepEqual(p.view, { x: 21, y: 33, w: 271, h: 173 });
			assert.deepEqual(p.vbar, { x: 292, y: 33, w: BAR, h: 173 });
			assert.deepEqual(p.hbar, { x: 21, y: 206, w: 271, h: BAR });
			assert.deepEqual(p.grip, { x: 292, y: 206, w: GRIP, h: GRIP });
			assert.deepEqual(p.max, { x: 4, y: 227 });
		});
		test("both bars, the vertical one caused by the horizontal one", () => {
			const p = w.parts(WIN, { w: 500, h: 177 });
			assert.ok(p.vbar && p.hbar);
			assert.equal(p.view.h, 173);
		});
		test("the scroll is clamped to 0 .. max", () => {
			assert.deepEqual(w.parts(WIN, { w: 500, h: 400 }, { x: -5, y: 9999 }).scroll, { x: 0, y: 227 });
			assert.deepEqual(w.parts(WIN, { w: 500, h: 400 }, { x: NaN }).scroll, { x: 0, y: 0 });
			assert.deepEqual(w.parts(WIN, { w: 10, h: 10 }, { x: 50, y: 50 }).scroll, { x: 0, y: 0 });
		});
		test("the thumb at 0, halfway and at max", () => {
			const c = { w: 271, h: 360 }; // VIEW 180 OF 360: THE THUMB IS HALF OF THE 173 BAR
			assert.deepEqual(w.parts(WIN, c, { y: 0 }).vthumb, { x: 292, y: 33, w: BAR, h: 87 });
			assert.deepEqual(w.parts(WIN, c, { y: 90 }).vthumb, { x: 292, y: 76, w: BAR, h: 87 });
			assert.deepEqual(w.parts(WIN, c, { y: 180 }).vthumb, { x: 292, y: 119, w: BAR, h: 87 });
			const h = w.parts(WIN, { w: 556, h: 10 }, { x: 278 }).hthumb; // 278 OF 556, AT MAX
			assert.deepEqual(h, { x: 156, y: 206, w: 136, h: BAR });
		});
		test("a thumb is at least 6 px long", () => {
			assert.equal(w.parts(WIN, { w: 10, h: 1e6 }).vthumb.h, 6);
			assert.equal(w.parts(WIN, { w: 1e6, h: 10 }).hthumb.w, 6);
		});
		test("every rect is whole and inside the frame, any window and content", () => {
			const wins = [WIN, { ...WIN, x: 0, y: 16, w: MIN_W, h: MIN_H }, { ...WIN, x: 33, y: 40, w: 151, h: 97 }];
			const cs = [{ w: 1, h: 1 }, { w: 1000, h: 1 }, { w: 1, h: 1000 }, { w: 1000, h: 1000 }, { w: 150, h: 84 }, { w: 333.3, h: 777.7 }];
			for (const win of wins) for (const c of cs) for (const s of [{ x: 0, y: 0 }, { x: 37.5, y: 61.2 }, { x: 1e9, y: 1e9 }]) {
				const p = w.parts(win, c, s);
				for (const k of RECTS) if (p[k]) { assert.ok(whole(p[k]), k); assert.ok(inside(p[k], p.frame), k); }
				if (p.vthumb) assert.ok(inside(p.vthumb, p.vbar));
				if (p.hthumb) assert.ok(inside(p.hthumb, p.hbar));
				assert.ok(p.view.w > 0 && p.view.h > 0);
			}
		});
	});

	describe("scrollMax, thumbTo and page", () => {
		test("scrollMax is parts' max", () => {
			assert.deepEqual(w.scrollMax(WIN, { w: 275, h: 400 }), { x: 4, y: 227 });
			assert.deepEqual(w.scrollMax(WIN, { w: 1, h: 1 }), { x: 0, y: 0 });
		});
		test("thumbTo round-trips with parts to within a pixel", () => {
			for (const c of [{ w: 271, h: 360 }, { w: 1000, h: 777 }, { w: 300, h: 2000 }]) for (const axis of ["x", "y"]) {
				const max = w.scrollMax(WIN, c)[axis];
				for (let s = 0; s <= max; s += 7) {
					const p = w.parts(WIN, c, { [axis]: s });
					const th = axis === "x" ? p.hthumb : p.vthumb;
					if (!th) continue;
					const back = w.thumbTo(WIN, c, axis, th[axis]);
					const again = w.parts(WIN, c, { [axis]: back });
					assert.ok(Math.abs((axis === "x" ? again.hthumb : again.vthumb)[axis] - th[axis]) <= 1, `${axis} ${s}`);
				}
			}
		});
		test("thumbTo clamps and is 0 with no bar", () => {
			const c = { w: 271, h: 360 };
			assert.equal(w.thumbTo(WIN, c, "y", -100), 0);
			assert.equal(w.thumbTo(WIN, c, "y", 9999), 180);
			assert.equal(w.thumbTo(WIN, c, "y", 76), 90);
			assert.equal(w.thumbTo(WIN, c, "x", 100), 0);
		});
		test("page moves one view length and clamps", () => {
			const c = { w: 271, h: 1000 }; // VIEW 180, MAX 820
			assert.equal(w.page(WIN, c, { y: 0 }, "y", 1), 180);
			assert.equal(w.page(WIN, c, { y: 700 }, "y", 1), 820);
			assert.equal(w.page(WIN, c, { y: 100 }, "y", -1), 0);
			assert.equal(w.page(WIN, c, { x: 0 }, "x", 1), 0);
		});
	});
});

// /
group("controls", () => {
	const { test, describe } = require("node:test");
	const assert = require("node:assert/strict");
	const controls = require("../../src/js/gameplay/three/monitor/controls.js");
	const { uvToGrid, tabButtons, hit, nextFocus, keyAction, zoomDistance, isTap, describe: say } = controls;

	function box(id, x, y, enabled = true) { return { id, x, y, w: 40, h: 12, label: id.toUpperCase(), enabled }; }

	describe("controls", () => {
		test("glass UV maps to the 320 x 240 grid, clamped, and lands on the tab under it", () => {
			assert.deepEqual(uvToGrid(0, 0), { x: 0, y: 0 });
			assert.deepEqual(uvToGrid(0.5, 0.5), { x: 160, y: 120 });
			assert.deepEqual(uvToGrid(1, 1), { x: 319, y: 239 });
			assert.deepEqual(uvToGrid(-0.1, 1.2), { x: 0, y: 239 });
			const tabs = tabButtons("session");
			const mail = tabs.find((b) => b.id === "tab:mail");
			const at = uvToGrid((mail.x + 1) / 320, (mail.y + 1) / 240);
			assert.equal(hit(tabs, at.x, at.y).id, "tab:mail");
		});
		test("the four footer tabs sit at x 16 + i * 56, y 219, 55 by 12, in order with the kit's names", () => {
			assert.deepEqual(tabButtons("log"), [
				{ id: "tab:session", x: 16, y: 219, w: 55, h: 12, label: "SESSION", enabled: true },
				{ id: "tab:log", x: 72, y: 219, w: 55, h: 12, label: "LOG", enabled: true },
				{ id: "tab:mail", x: 128, y: 219, w: 55, h: 12, label: "MAIL", enabled: true },
				{ id: "tab:systems", x: 184, y: 219, w: 55, h: 12, label: "SYSTEMS", enabled: true },
			]);
		});
		test("a press in the 1 px gap between two tabs goes to the nearer one", () => {
			const tabs = tabButtons();
			// x 71 is 0 from SESSION's right edge (distance counts x - (x + w)) and 1 from LOG: SESSION wins
			assert.equal(hit(tabs, 71, 224).id, "tab:session");
		});
		test("the removed channel exports are gone", () => {
			for (const name of ["ORDER", "YOUR_MOVE", "available", "idleChannel", "litTab"]) { assert.equal(controls[name], undefined, name); }
		});
		test("a near miss presses the only button in reach, never a disabled one, never a guess between two", () => {
			const one = [{ id: "a", x: 10, y: 20, w: 20, h: 10, enabled: true }];
			assert.equal(hit(one, 8, 18).id, "a");
			assert.equal(hit(one, 4, 18), null);
			assert.equal(hit([{ ...one[0], enabled: false }], 12, 22), null);
			const two = [...one, { id: "b", x: 34, y: 20, w: 20, h: 10, enabled: true }];
			assert.equal(hit(two, 32, 25), null);
		});
		test("W/A/S/D go to the nearest button that way and never get stuck", () => {
			const grid = [box("a", 0, 20), box("b", 60, 20), box("c", 0, 60), box("d", 60, 60, false)];
			assert.equal(nextFocus(grid, "a", "right"), "b");
			assert.equal(nextFocus(grid, "a", "down"), "c");
			assert.equal(nextFocus(grid, "c", "right"), "b"); // d IS DISABLED
			assert.equal(nextFocus(grid, "b", "right"), "a"); // WRAPS
			assert.equal(nextFocus(grid, "gone", "up"), "a");
			for (const dir of ["up", "down", "left", "right"]) {
				for (const from of ["a", "b", "c"]) { assert.ok(["a", "b", "c"].includes(nextFocus(grid, from, dir))); }
			}
			assert.equal(nextFocus([box("only", 5, 5)], "only", "left"), "only");
		});
		test("focus walks the footer tabs left and right, wrapping", () => {
			const tabs = tabButtons();
			assert.equal(nextFocus(tabs, "tab:session", "right"), "tab:log");
			assert.equal(nextFocus(tabs, "tab:systems", "right"), "tab:session");
			assert.equal(nextFocus(tabs, "tab:session", "left"), "tab:systems");
		});
		test("the glass fills 80% of the view", () => {
			const d = zoomDistance(13.6, 10.2, 45, 16 / 9);
			assert.ok(Math.abs(10.2 / (2 * d * Math.tan(Math.PI / 8)) - 0.8) < 1e-9); // HEIGHT IS THE TIGHTER SIDE ON A WIDE VIEW
			const tall = zoomDistance(13.6, 10.2, 30, 9 / 16);
			assert.ok(Math.abs(13.6 / (2 * tall * Math.tan(Math.PI / 12) * 9 / 16) - 0.8) < 1e-9); // WIDTH ON A PHONE HELD UPRIGHT
		});
		test("a shaky click is a tap, a drag isn't", () => {
			assert.equal(isTap({ x: 10, y: 10 }, { x: 12, y: 11 }, "mouse"), true);
			assert.equal(isTap({ x: 10, y: 10 }, { x: 16, y: 10 }, "mouse"), false);
			assert.equal(isTap({ x: 10, y: 10 }, { x: 16, y: 10 }, "touch"), true);
		});
		test("Escape leaves whether or not the player is typing", () => {
			assert.deepEqual(keyAction("Escape", true), { type: "leave" });
			assert.deepEqual(keyAction("Escape", false), { type: "leave" });
		});
		test("while typing: Enter runs, Backspace erases, the up & down arrows and Tab move, a drawable letter or a space is typed", () => {
			assert.deepEqual(keyAction("Enter", true), { type: "run" });
			assert.deepEqual(keyAction("Backspace", true), { type: "erase" });
			assert.deepEqual(keyAction("ArrowUp", true), { type: "move", dir: "up" });
			assert.deepEqual(keyAction("ArrowDown", true), { type: "move", dir: "down" });
			assert.deepEqual(keyAction("Tab", true), { type: "move", dir: "down" });
			assert.deepEqual(keyAction("w", true), { type: "char", char: "w" });
			assert.deepEqual(keyAction("E", true), { type: "char", char: "E" });
			assert.deepEqual(keyAction("4", true), { type: "char", char: "4" });
			assert.deepEqual(keyAction(" ", true), { type: "char", char: " " });
		});
		test("while typing: side arrows, undrawable letters and named keys do nothing", () => {
			for (const key of ["ArrowLeft", "ArrowRight", "é", "😀", "Dead", "Shift", "F5", "Delete", "", undefined, null, 5]) {
				assert.equal(keyAction(key, true), null, String(key));
			}
		});
		test("not typing: W/A/S/D and the arrows move, Enter & Space press, 1 to 4 pick a tab", () => {
			const moves = { w: "up", W: "up", ArrowUp: "up", s: "down", S: "down", ArrowDown: "down", a: "left", A: "left", ArrowLeft: "left", d: "right", D: "right", ArrowRight: "right" };
			for (const [key, dir] of Object.entries(moves)) { assert.deepEqual(keyAction(key, false), { type: "move", dir }, key); }
			assert.deepEqual(keyAction("Enter", false), { type: "press" });
			assert.deepEqual(keyAction(" ", false), { type: "press" });
			assert.deepEqual(keyAction("1", false), { type: "tab", id: "session" });
			assert.deepEqual(keyAction("2", false), { type: "tab", id: "log" });
			assert.deepEqual(keyAction("3", false), { type: "tab", id: "mail" });
			assert.deepEqual(keyAction("4", false), { type: "tab", id: "systems" });
		});
		test("not typing: Tab, other letters, other digits and named keys do nothing", () => {
			for (const key of ["Tab", "x", "5", "0", "Backspace", "Dead", "Shift", "F5", "", undefined, null, 5]) {
				assert.equal(keyAction(key, false), null, String(key));
			}
		});
		test("buttons are spoken with their place and state", () => {
			const own = [box("hint", 0, 20), { ...box("takeback", 0, 40), label: "TAKEBACK" }, box("draw", 0, 60, false), box("x", 0, 80)];
			assert.equal(say(own[1], own), "Takeback, button, 2 of 4");
			assert.equal(say(own[2], own), "Draw, button, 3 of 4, unavailable");
			const tabs = tabButtons("mail");
			assert.equal(say(tabs[2], [...tabs, ...own]), "Mail, tab, 3 of 4");
			assert.equal(say({ ...tabs[2], selected: true }, tabs), "Mail, tab, 3 of 4, selected");
			assert.equal(say(own[0], [...tabs, ...own]), "Hint, button, 1 of 4"); // TABS ARE NOT COUNTED AMONG A SCREEN'S BUTTONS
		});
	});
});

// /
group("monitorData", () => {
	const { test, describe } = require("node:test");
	const assert = require("node:assert/strict");
	const { actionsFrom, resultText, materialText, trimScores, plyOf, startPlyFor, whoFrom, offerFrom } = require("../../src/js/gameplay/monitor/data.js");

	describe("the monitor's data", () => {
		test("the material lead reads WHITE +3 / BLACK +2, nothing when even", () => {
			assert.equal(materialText(3), "WHITE +3");
			assert.equal(materialText(-2), "BLACK +2");
			assert.equal(materialText(0), "");
		});
		test("an action is enabled exactly when its menu item isn't hidden or unavailable", () => {
			const items = { hint: { hidden: false, unavailable: false, text: "Hint" }, takeback: { hidden: false, unavailable: true, text: "Takeback Asked" }, draw: { hidden: true, unavailable: false, text: "Offer Draw" }, restart: { hidden: false, unavailable: false, text: "Forfeit" }, pgn: { hidden: true, unavailable: false, text: "Download PGN" } };
			assert.deepEqual(actionsFrom(items), [
				{ id: "hint", label: "HINT", shown: true, enabled: true },
				{ id: "takeback", label: "TAKEBACK ASKED", shown: true, enabled: false },
				{ id: "draw", label: "OFFER DRAW", shown: false, enabled: false },
				{ id: "restart", label: "FORFEIT", shown: true, enabled: true },
				{ id: "pgn", label: "DOWNLOAD PGN", shown: false, enabled: false },
			]);
		});
		test("the result reads as the menu's title and reason", () => {
			assert.equal(resultText("White Wins!", "by Checkmate"), "WHITE WINS! BY CHECKMATE");
			assert.equal(resultText("Draw", ""), "DRAW");
		});
		test("scores past the last ply are dropped, missing ones are null", () => {
			assert.deepEqual(trimScores([50, 54, 61, 70], 2), [50, 54, 61]);
			assert.deepEqual(trimScores([50], 3), [50, null, null, null]);
		});
		test("a missing menu item is a hidden action", () => {
			assert.deepEqual(actionsFrom({}).map((a) => [a.id, a.shown, a.enabled]), [["hint", false, false], ["takeback", false, false], ["draw", false, false], ["restart", false, false], ["pgn", false, false]]);
		});
		test("a board's ply counts the moves from the standard start", () => {
			assert.equal(plyOf("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"), 0);
			assert.equal(plyOf("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"), 1);
			assert.equal(plyOf("r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3"), 4);
			assert.equal(plyOf(""), 0);
		});
		test("the start ply comes only from a game with start_params, a move's answer keeps it", () => {
			const setUp = { start_params: { fen: "8/8/8/8/8/8/4k3/4K2R w K - 0 10" } };
			assert.equal(startPlyFor(0, setUp), 18);
			assert.equal(startPlyFor(18, { game_board: "8/8/8/8/8/8/4k3/4K1R1 b - - 1 10" }), 18);
			assert.equal(startPlyFor(18, { start_params: {} }), 0);
			assert.equal(startPlyFor(5, null), 5);
		});
		test("no username reads GUEST", () => {
			assert.equal(whoFrom(null), "GUEST");
			assert.equal(whoFrom(""), "GUEST");
			assert.equal(whoFrom(undefined), "GUEST");
			assert.equal(whoFrom(42), "GUEST");
		});
		test("a username the font draws is kept as it is, case and all", () => {
			assert.equal(whoFrom("joe_s-1"), "joe_s-1");
			assert.equal(whoFrom("abcdefghijklmnopqrst"), "abcdefghijklmnopqrst"); // 20 LETTERS, NOT CUT HERE
			assert.equal(whoFrom("\u25C0joe\u2026"), "joe"); // THE SCREEN'S ARROWS & ELLIPSIS ARE NOT A NAME'S
			assert.equal(whoFrom("Joe"), "Joe");
		});
		test("a username's accents are dropped, its letters kept", () => {
			assert.equal(whoFrom("Zoë"), "Zoe");
			assert.equal(whoFrom("Ångström"), "Angstrom");
		});
		test("letters the font cannot draw are removed, and a name left empty reads GUEST", () => {
			assert.equal(whoFrom("joe😀"), "joe");
			assert.equal(whoFrom("  ann@home  "), "annhome");
			assert.equal(whoFrom("😀😀"), "GUEST");
			assert.equal(whoFrom("   "), "GUEST");
		});
		test("an incoming offer outranks a sent one", () => {
			assert.equal(offerFrom(false, true), "incoming");
			assert.equal(offerFrom(true, false), "sent");
			assert.equal(offerFrom(true, true), "incoming");
			assert.equal(offerFrom(false, false), null);
		});
	});
});
