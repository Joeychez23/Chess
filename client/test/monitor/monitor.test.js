/*
 *  monitor.test.js  --  chess frontend tests
 *	The Meridian terminal's state machine (client/src/js/gameplay/three/monitor/monitor.js): the zoom states, the fault, the console,
 *	the desktop's windows (open, raise, close, drag, resize, scroll), the pointer, the keys, the handlers & the screen reader.
 *	Run with npm run test:client
 *
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createMonitor, uvToGrid, zoomDistance, isTap } = require("../../src/js/gameplay/three/monitor/monitor.js");
const { FAULT_MS, SPLASH_MS } = require("../../src/js/gameplay/three/monitor/boot.js");
const { INPUT_MAX } = require("../../src/js/gameplay/three/monitor/commands.js");
const { tabButtons, nextFocus, describe } = require("../../src/js/gameplay/three/monitor/controls.js");
const { themeFor } = require("../../src/js/gameplay/three/monitor/themes.js");
const { blank } = require("../../src/js/gameplay/three/monitor/store.js");
const { defaults: defaultWins, raise, DESK } = require("../../src/js/gameplay/three/monitor/windows.js");
const { SCREEN } = require("../../src/js/gameplay/three/monitor/screens/index.js");

/* ---------------------------------------------------------------- */
// Helpers
/* ---------------------------------------------------------------- */

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const T0 = new Date(2026, 10, 27, 14, 5).getTime(); // 14:05 LOCAL
const ALL = ["hint", "takeback", "draw", "restart", "pgn"].map((id) => ({ id, label: id, shown: true, enabled: true }));
const OUTSIDE = ["hint", "takeback", "draw", "declineDraw", "declineTakeback", "restart", "forfeit", "sound", "move"];
const HINT = ["Type help for commands.", "dim"];

// A bot game, the player is White, nothing played yet
function base(over = {}) {
	return {
		gameId: "g1", who: "GUEST", signedIn: false, cards: false, ai: true, over: false, yourTurn: true, playerColor: "w", offline: false,
		thinking: false, saving: false, fen: START, check: false, result: "", material: "even", moves: [], opening: null, opponent: "",
		hint: null, offers: { draw: null, takeback: null }, sound: true, actions: ALL, ...over,
	};
}

// A monitor with fake storage, a settable clock & recording show, announce & handlers. opts.term seeds the kept state
function make(opts = {}) {
	const clock = { t: T0 };
	const terms = [], prefsSaved = [], said = [], calls = [];
	let shown = 0;
	const stored = opts.term ? JSON.parse(JSON.stringify(opts.term)) : null;
	const handlers = {};
	for (const name of opts.handlers || OUTSIDE) {
		handlers[name] = (...args) => { calls.push([name, ...args]); return name === "move" ? { san: "e4" } : undefined; };
	}
	const m = createMonitor({
		boot: opts.boot === true, // THE BOOT LINES ARE OFF IN THESE TESTS UNLESS ONE ASKS FOR THEM
		show: () => { shown++; },
		announce: (text) => said.push(text),
		handlers,
		loadPrefs: () => ({ version: 2, theme: "slateamber" }),
		savePrefs: (p) => prefsSaved.push(p),
		loadTerm: () => (stored ? JSON.parse(JSON.stringify(stored)) : blank()),
		saveTerm: (t) => terms.push(JSON.parse(JSON.stringify(t))),
		reduce: () => Boolean(opts.reduce),
		now: () => clock.t,
		...opts.deps,
	});
	return Object.assign(m, { clock, terms, prefsSaved, said, calls, shown: () => shown, last: () => terms[terms.length - 1] });
}

const kept = (over = {}) => ({ ...blank(), gameId: "g1", ...over });

// Zoomed on a terminal with data
function zoomed(opts = {}, d = base()) {
	const m = make({ ...opts, term: kept(opts.term) });
	m.update(d);
	m.enter();
	m.arrived();
	return m;
}

// The default windows with Mail moved & sized to r (short by default: its two panes show & it scrolls down) & brought to the front
const smallMail = (r = { x: 20, y: 20, w: 280, h: 60 }) => raise(defaultWins().map((w) => (w.id === "mail" ? { ...w, ...r } : w)), "mail");

function type(m, text) { for (const ch of text) { m.key(ch); } }
const texts = (m) => m.view().v.term.lines.map((l) => l[0]);
const centre = (b) => [b.x + b.w / 2, b.y + b.h / 2];
const button = (m, id) => [...m.view().buttons, ...m.view().tabs].find((b) => b.id === id);
function press(m, id) { return m.pointer("press", ...centre(button(m, id))); }
const win = (m, id) => m.view().wins.find((w) => w.id === id);
const frontId = (m) => (m.view().wins.find((w) => w.front) || {}).id;
const ids = (m) => m.view().wins.map((w) => w.id);

// The focus is always null, the console (Session in front), a tab, the front window's boxes or one of its buttons
function valid(m) {
	const view = m.view();
	const f = view.wins.find((w) => w.front);
	const ok = [...view.tabs.map((b) => b.id)];
	if (f) { ok.push("win:close", ...SCREEN[f.id].buttons(f.v).map((b) => b.id)); }
	assert.ok(view.focus === null || ok.includes(view.focus) || (view.focus === "console" && f && f.id === "session"), String(view.focus));
	assert.equal(view.wins.filter((w) => w.front).length, f ? 1 : 0);
}

// Walks the focus by W/A/S/D to id along the shortest key path nextFocus gives (for windows that do not scroll)
function focusTo(m, id) {
	const dirs = { s: "down", d: "right", w: "up", a: "left" };
	const all = [...m.view().buttons, ...m.view().tabs];
	const paths = new Map([[m.view().focus, ""]]);
	for (const [at, keys] of paths) {
		for (const k of Object.keys(dirs)) {
			const to = nextFocus(all, at, dirs[k]);
			if (!paths.has(to)) { paths.set(to, keys + k); }
		}
	}
	assert.ok(paths.has(id), id);
	for (const k of paths.get(id)) { m.key(k); }
	assert.equal(m.view().focus, id);
}

/* ---------------------------------------------------------------- */
// Start, reload & fault
/* ---------------------------------------------------------------- */

test("a fresh terminal has no boot phase & prints the help hint once, also after a reload", () => {
	const m = make();
	assert.equal(m.view().phase, null);
	m.update(base());
	assert.equal(m.view().phase, null);
	assert.deepEqual(m.view().v.term.lines[0], HINT);
	assert.equal(m.view().v.term.lines.filter((l) => l[0] === HINT[0]).length, 1);
	assert.deepEqual(m.view().lines, []); // NO BOOT LINES WHEN THE BOOT IS OFF
	const again = make({ term: m.last() });
	again.update(base());
	assert.equal(again.view().phase, null);
	assert.deepEqual(again.view().v.term.lines, m.view().v.term.lines);
	assert.equal(again.view().v.term.lines.filter((l) => l[0] === HINT[0]).length, 1);
});

test("the start layout: Mail open behind Session, Session in front, the two tabs lit", () => {
	const m = zoomed();
	assert.deepEqual(ids(m), ["mail", "session"]);
	assert.equal(frontId(m), "session");
	assert.deepEqual(m.view().tabs.filter((t) => t.lit).map((t) => t.id), ["tab:session", "tab:mail"]);
	assert.deepEqual(m.view().tabs.filter((t) => t.selected).map((t) => t.id), ["tab:session"]);
	assert.deepEqual(win(m, "session").p.frame, { x: 40, y: 38, w: 252, h: 172 });
	assert.deepEqual(win(m, "mail").p.frame, { x: 20, y: 20, w: 280, h: 194 });
	assert.equal(win(m, "session").title, "SESSION");
	assert.equal(m.view().focus, "console");
	valid(m);
});

test("the view's shape: wins with parts, content & v, the front window's buttons in grid pixels then its close box", () => {
	const m = zoomed();
	const view = m.view();
	for (const k of ["state", "zoomed", "phase", "elapsed", "tabs", "wins", "buttons", "focus", "hover", "pointer", "deskFocus", "input", "v"]) { assert.ok(k in view, k); }
	for (const k of ["screen", "diag"]) { assert.equal(k in view, false, k); }
	const s = view.wins.find((w) => w.id === "session");
	assert.deepEqual(s.content, { w: s.p.view.w, h: s.p.view.h });
	assert.deepEqual(s.v.box, { w: 250, h: 158 });
	assert.equal(s.v.focus, "console");
	assert.equal(view.wins[0].v.focus, null);
	assert.equal(view.v, s.v);
	assert.deepEqual(view.buttons.map((b) => b.id), ["console", "win:close"]);
	assert.deepEqual(view.buttons[0], { id: "console", x: 41, y: 51, w: 250, h: 158, label: "Console", enabled: true });
	assert.deepEqual(view.buttons[1], { id: "win:close", ...s.p.close, label: "Close", enabled: true });
});

test("closing Session leaves Mail in front with its tab lit & selected, & says so", () => {
	const m = zoomed();
	m.said.length = 0;
	press(m, "win:close");
	assert.deepEqual(ids(m), ["mail"]);
	assert.equal(frontId(m), "mail");
	assert.deepEqual(m.view().tabs.filter((t) => t.lit).map((t) => t.id), ["tab:mail"]);
	assert.deepEqual(m.view().tabs.filter((t) => t.selected).map((t) => t.id), ["tab:mail"]);
	assert.equal(m.view().focus, "tab:mail");
	assert.equal(m.said[0], "Session closed.");
	assert.equal(m.last().wins.find((w) => w.id === "session").open, false);
	valid(m);
});

test("the link going down while typing empties the input & lines, faults, logs it, keeps the windows & Escape leaves", () => {
	const m = zoomed();
	m.handlers.screen("log");
	const before = m.view().wins.map((w) => ({ id: w.id, frame: w.p.frame }));
	m.key("ArrowUp"); m.key("1"); // SESSION BACK IN FRONT, TYPING
	type(m, "e2e");
	const order = ids(m);
	m.update(base({ offline: true }));
	const view = m.view();
	assert.equal(view.input, "");
	assert.equal(view.phase, "fault");
	assert.deepEqual(view.buttons, []);
	assert.ok(view.v.term.log.some((e) => e[1] === "Line fault."));
	assert.deepEqual(view.v.term.lines, [HINT]);
	m.clock.t += 3600 * 1000;
	assert.equal(m.view().phase, "fault");
	m.update(base());
	assert.equal(m.view().phase, "splash");
	assert.equal(m.view().elapsed, 0);
	m.clock.t += SPLASH_MS;
	assert.equal(m.view().phase, null);
	assert.deepEqual(ids(m), order);
	assert.deepEqual(m.view().wins.map((w) => ({ id: w.id, frame: w.p.frame })).sort((a, b) => a.id.localeCompare(b.id)), before.sort((a, b) => a.id.localeCompare(b.id)));
	valid(m);
	assert.equal(m.key("Escape"), true);
	assert.equal(m.state, "leaving");
});

test("the help hint is the one line of an emptied console: after a fault & after clear", () => {
	const m = zoomed();
	type(m, "whoami"); m.key("Enter");
	m.update(base({ offline: true }));
	m.update(base());
	m.clock.t += FAULT_MS + SPLASH_MS;
	assert.equal(m.view().phase, null);
	assert.deepEqual(m.view().v.term.lines[0], HINT);
	assert.equal(m.view().v.term.lines.filter((l) => l[0] === HINT[0]).length, 1);
	type(m, "whoami"); m.key("Enter");
	m.handlers.clear();
	assert.deepEqual(m.view().v.term.lines, [HINT]);
});

test("a short drop runs the fault for its full time, then the splash, each clock starting where the last ended", () => {
	const m = zoomed();
	m.update(base({ offline: true }));
	m.clock.t += 1000;
	m.update(base());
	assert.equal(m.view().phase, "fault");
	m.clock.t += FAULT_MS - 1000 + 5;
	assert.equal(m.view().phase, "splash");
	assert.equal(m.view().elapsed, 5);
	m.clock.t += SPLASH_MS;
	assert.equal(m.view().phase, null);
});

test("offline on the first data starts in the fault, & logs & mails the line fault with its time", () => {
	const m = make({ term: kept() });
	m.update(base({ offline: true }));
	assert.equal(m.view().phase, "fault");
	const term = m.view().v.term;
	assert.deepEqual(term.log, [["14:05", "Line fault.", "hot"]]);
	assert.deepEqual(term.mail, [{ kind: "fault", at: "14:05", text: "Line fault.", read: false }]);
	assert.deepEqual(term.lines, [HINT]);
	assert.equal(m.last().log.length, 1);
});

test("a drop during the splash starts the fault again from zero", () => {
	const m = zoomed();
	m.update(base({ offline: true }));
	m.clock.t += FAULT_MS;
	m.update(base());
	assert.equal(m.view().phase, "splash");
	m.clock.t += 10;
	m.update(base({ offline: true }));
	assert.equal(m.view().phase, "fault");
	assert.equal(m.view().elapsed, 0);
	m.clock.t += FAULT_MS;
	m.update(base());
	m.clock.t += SPLASH_MS;
	assert.equal(m.view().phase, null);
	assert.equal(m.key("Escape"), true);
});

test("saves: none for a pointer move, a typed letter or an unchanged update; one for a command & one for several events", () => {
	const m = zoomed();
	let n = m.terms.length;
	m.pointer("move", 100, 100);
	type(m, "whoam");
	m.update(base());
	assert.equal(m.terms.length, n);
	type(m, "i"); m.key("Enter");
	assert.equal(m.terms.length, n + 1);
	n = m.terms.length;
	m.update(base({ moves: [{ number: 1, white: "e4", black: "e5" }], offers: { draw: "incoming", takeback: null }, check: true }));
	assert.ok(m.view().v.term.log.length >= 3);
	assert.equal(m.terms.length, n + 1);
});

test("a corrupt kept state or settings from the loader give a blank terminal", () => {
	for (const bad of [null, {}, { version: 1 }, 7]) {
		const m = make({ deps: { loadTerm: () => bad, loadPrefs: () => bad } });
		assert.deepEqual(m.view().v.term, blank());
		assert.equal(m.view().v.T.id, themeFor().id);
	}
});

test("a command confirmation is dropped by a fault", () => {
	const m = zoomed();
	type(m, "resign"); m.key("Enter");
	m.update(base({ offline: true }));
	m.update(base());
	m.clock.t += 60000;
	m.view();
	type(m, "resign"); m.key("Enter");
	assert.equal(m.calls.filter((c) => c[0] === "forfeit").length, 0);
});

test("a monitor made from the saved state has the same windows, sizes & order", () => {
	const m = zoomed();
	m.pointer("down", 100, 44);
	m.pointer("drag", 90, 50);
	m.pointer("up", 90, 50);
	m.pointer("down", 277, 211); // THE GRIP OF THE MOVED WINDOW
	m.pointer("drag", 267, 201);
	m.pointer("up", 267, 201);
	press(m, "tab:log");
	press(m, "tab:mail");
	press(m, "tab:mail"); // MAIL CLOSED
	const again = make({ term: m.last() });
	again.update(base());
	again.enter(); again.arrived();
	assert.deepEqual(again.view().wins.map((w) => [w.id, w.p.frame]), m.view().wins.map((w) => [w.id, w.p.frame]));
	assert.deepEqual(again.view().tabs.map((t) => [t.id, t.lit]), m.view().tabs.map((t) => [t.id, t.lit]));
	assert.deepEqual(win(again, "session").p.frame, { x: 30, y: 44, w: 242, h: 162 });
	valid(again);
});

/* ---------------------------------------------------------------- */
// Console
/* ---------------------------------------------------------------- */

test("typing board then Enter prints the echo & 9 lines; a held Enter runs nothing", () => {
	const m = zoomed();
	const before = m.view().v.term.lines.length;
	type(m, "board");
	assert.equal(m.key("Enter"), true);
	const lines = m.view().v.term.lines;
	assert.deepEqual(lines[before], ["> board", "dim"]);
	assert.equal(lines.length - before, 10);
	assert.equal(m.view().input, "");
	assert.ok(m.last().lines.some((l) => l[0] === "> board"));
	type(m, "board");
	m.key("Enter", true);
	assert.equal(m.view().v.term.lines.length - before, 10);
	assert.equal(m.view().input, "board");
});

test("Enter on an empty input prints nothing", () => {
	const m = zoomed();
	const before = m.view().v.term.lines.length;
	m.key("Enter");
	assert.equal(m.view().v.term.lines.length, before);
});

test("digits typed in the console are typed, not taken as tabs", () => {
	const m = zoomed();
	type(m, "1234");
	assert.equal(m.view().input, "1234");
	assert.equal(frontId(m), "session");
	valid(m);
});

test("a letter past INPUT_MAX is not added & a letter the font lacks is refused", () => {
	const m = zoomed();
	type(m, "a".repeat(INPUT_MAX + 1));
	assert.equal(m.view().input.length, INPUT_MAX);
	m.key("Backspace");
	assert.equal(m.view().input.length, INPUT_MAX - 1);
	assert.equal(m.key("é"), false);
	assert.equal(m.view().input.length, INPUT_MAX - 1);
});

test("a command's reply is announced as one line, & nothing for an empty reply", () => {
	const m = zoomed();
	m.said.length = 0;
	type(m, "whoami"); m.key("Enter");
	assert.deepEqual(m.said, ["GUEST [clearance: none]"]);
	type(m, "clear"); m.key("Enter");
	assert.deepEqual(m.said, ["GUEST [clearance: none]"]);
	assert.deepEqual(m.view().v.term.lines, [HINT]);
});

test("flip saves the flipped board in the kept state", () => {
	const m = zoomed();
	type(m, "flip"); m.key("Enter");
	assert.equal(m.last().flipped, true);
	const again = make({ term: m.last() });
	again.update(base());
	again.enter(); again.arrived();
	type(again, "flip"); again.key("Enter");
	assert.equal(again.last().flipped, false);
});

test("the up arrow leaves the console for Session's tab", () => {
	const m = zoomed();
	m.said.length = 0;
	assert.equal(m.key("ArrowUp"), true);
	assert.equal(m.view().focus, "tab:session");
	assert.equal(m.said[0], "Session, tab, 1 of 4, selected");
	m.key("w");
	assert.equal(m.view().input, ""); // NOT TYPING NOW
	valid(m);
});

/* ---------------------------------------------------------------- */
// Updates
/* ---------------------------------------------------------------- */

test("a new ply prints a line stamped HH:MM, logs it & is announced while zoomed", () => {
	const m = zoomed();
	m.said.length = 0;
	m.update(base({ moves: [{ number: 1, white: "e4", black: "" }] }));
	const v = m.view().v;
	assert.deepEqual(v.term.lines[v.term.lines.length - 1], ["14:05 [GUEST] e4", "ink"]);
	assert.deepEqual(v.term.log[v.term.log.length - 1], ["14:05", "[GUEST] e4", "ink"]);
	assert.deepEqual(m.said, ["[GUEST] e4"]);
	assert.equal(m.last().log.length, v.term.log.length);
});

test("the first data with a new game id logs & prints a new session & stores the id; the same id logs nothing", () => {
	const m = make({ term: kept({ gameId: "old" }) });
	m.update(base());
	assert.deepEqual(m.view().v.term.log, [["14:05", "New session opened.", "ink"]]);
	assert.deepEqual(texts(m), [HINT[0], "14:05 New session opened."]);
	assert.equal(m.last().gameId, "g1");
	const same = make({ term: kept() });
	same.update(base());
	assert.deepEqual(same.view().v.term.log, []);
});

test("a game id change between snapshots stores the id & drops a command confirmation", () => {
	const m = zoomed();
	type(m, "draw"); m.key("Enter");
	m.update(base({ gameId: "g2" }));
	assert.equal(m.last().gameId, "g2");
	type(m, "draw"); m.key("Enter");
	assert.equal(m.calls.filter((c) => c[0] === "draw").length, 0);
});

test("an event with a mail kind adds an unread mail, & read(i) marks it read", () => {
	const m = zoomed();
	m.update(base({ offers: { draw: "incoming", takeback: null } }));
	const mail = m.view().v.term.mail;
	assert.deepEqual(mail, [{ kind: "terms", at: "14:05", text: "[UNIT] proposes terms.", read: false }]);
	m.handlers.read(0);
	assert.equal(m.last().mail[0].read, true);
	m.handlers.read(5); // NO SUCH MAIL
});

test("movedAt is set at the first data & again when the plies change; startedAt is when the monitor was made", () => {
	const m = make({ term: kept() });
	const made = m.clock.t;
	assert.equal(m.view().v.startedAt, made);
	m.clock.t += 1000;
	m.update(base());
	assert.equal(m.view().v.movedAt, made + 1000);
	m.clock.t += 1000;
	m.update(base({ sound: false }));
	assert.equal(m.view().v.movedAt, made + 1000);
	m.update(base({ moves: [{ number: 1, white: "e4", black: "" }] }));
	assert.equal(m.view().v.movedAt, made + 2000);
});

test("update never changes the data it is given", () => {
	const m = zoomed();
	const d = base({ offline: true });
	const copy = JSON.parse(JSON.stringify(d));
	m.update(d);
	assert.deepEqual(d, copy);
});

/* ---------------------------------------------------------------- */
// Windows: open, raise, close
/* ---------------------------------------------------------------- */

test("the close box closes Session; 1 reopens it in front with the focus on the console, where 4 types a 4", () => {
	const m = zoomed();
	press(m, "win:close");
	assert.equal(frontId(m), "mail");
	m.key("1");
	assert.equal(frontId(m), "session");
	assert.equal(m.view().focus, "console");
	m.key("4");
	assert.equal(m.view().input, "4");
	assert.equal(frontId(m), "session");
	valid(m);
});

test("a tab press opens a closed window in front, raises one behind, closes the front one; the number keys do the same", () => {
	for (const by of ["press", "key"]) {
		const m = zoomed();
		m.key("ArrowUp"); // OFF THE CONSOLE
		const tab = (id) => (by === "press" ? press(m, `tab:${id}`) : m.key(String(["session", "log", "mail", "systems"].indexOf(id) + 1)));
		tab("log");
		assert.deepEqual(ids(m), ["mail", "session", "log"]);
		assert.equal(frontId(m), "log");
		valid(m);
		tab("mail");
		assert.deepEqual(ids(m), ["session", "log", "mail"]);
		valid(m);
		m.said.length = 0;
		tab("mail");
		assert.deepEqual(ids(m), ["session", "log"]);
		const t = m.view().tabs.find((x) => x.id === "tab:mail");
		assert.equal(t.lit, false);
		assert.equal(t.min, undefined); // NOTHING MINIMIZES
		assert.equal(m.said[0], "Mail closed.");
		assert.equal(m.last().wins.find((w) => w.id === "mail").open, false);
		assert.equal(m.view().focus, "tab:log");
		valid(m);
		tab("mail");
		assert.equal(frontId(m), "mail");
		assert.equal(m.view().tabs.find((x) => x.id === "tab:mail").lit, true);
		valid(m);
	}
});

test("a window has no minimize box; close keeps where it is & its size & resets its scroll", () => {
	const m = zoomed({ term: { wins: smallMail() } });
	m.pointer("wheel", 50, 50, { dx: 0, dy: 30 });
	assert.equal(win(m, "mail").p.scroll.y, 30);
	assert.equal(button(m, "win:min"), undefined);
	assert.equal(win(m, "mail").p.min, undefined);
	const frame = win(m, "mail").p.frame;
	press(m, "win:close");
	assert.equal(win(m, "mail"), undefined);
	m.said.length = 0;
	m.handlers.screen("mail");
	assert.deepEqual(win(m, "mail").p.frame, frame);
	assert.equal(win(m, "mail").p.scroll.y, 0);
	assert.ok(m.said[0].startsWith("Mail window. "));
	valid(m);
});

test("handlers.screen(\"diag\") twice gives one Diagnostics window in front with the focus on its close box", () => {
	const m = zoomed();
	m.handlers.screen("diag");
	m.handlers.screen("diag");
	assert.equal(ids(m).filter((id) => id === "diag").length, 1);
	assert.equal(frontId(m), "diag");
	assert.equal(m.view().focus, "win:close");
	m.handlers.screen("nope");
	assert.equal(frontId(m), "diag");
	valid(m);
});

test("a press on Systems' diag opens Diagnostics; Enter on its close box closes it back to Systems", () => {
	const m = zoomed();
	m.handlers.screen("systems");
	press(m, "diag");
	assert.equal(frontId(m), "diag");
	assert.equal(m.view().focus, "win:close");
	m.key("Enter");
	assert.equal(frontId(m), "systems");
	assert.equal(m.view().focus, "tab:systems");
	valid(m);
});

test("Systems' theme button opens Theme; a press on theme:paper saves the prefs & the next view has its colours", () => {
	const m = zoomed();
	m.handlers.screen("systems");
	press(m, "theme");
	assert.equal(frontId(m), "theme");
	assert.equal(m.view().focus, "theme:slateamber");
	press(m, "theme:paper");
	assert.deepEqual(m.prefsSaved[m.prefsSaved.length - 1], { version: 2, theme: "paper" });
	assert.equal(m.view().v.T.id, "paper");
	assert.deepEqual(m.view().v.T, themeFor("paper"));
	valid(m);
});

test("log typed in the console opens the Log window in front & says so", () => {
	const log = Array.from({ length: 20 }, (_, i) => ["14:00", `entry ${i}`, "ink"]);
	const m = zoomed({ term: { log } });
	m.said.length = 0;
	type(m, "log"); m.key("Enter");
	assert.equal(frontId(m), "log");
	assert.equal(m.view().focus, "tab:log");
	assert.ok(m.said[0].startsWith("Log window. "));
	m.key("d"); // RIGHT MOVES ALONG THE TABS
	assert.equal(m.view().focus, "tab:mail");
	valid(m);
});

test("each window keeps its own ui, & ui({ typing: true }) moves the focus to the console without storing it", () => {
	const m = zoomed();
	m.key("ArrowUp");
	m.handlers.ui({ typing: true, a: 1 });
	assert.equal(m.view().focus, "console");
	assert.deepEqual(m.view().v.ui, { a: 1 });
	m.handlers.screen("log");
	assert.deepEqual(m.view().v.ui, {});
	m.handlers.screen("session");
	assert.deepEqual(m.view().v.ui, { a: 1 });
});

test("bringing a window to the front announces its name & what it shows, & saves it", () => {
	const m = zoomed();
	m.key("ArrowUp");
	m.said.length = 0;
	m.key("3");
	assert.equal(frontId(m), "mail");
	assert.equal(m.view().focus, "req:hint"); // ITS FIRST BUTTON
	assert.deepEqual(m.said, ["Mail window. No mail."]);
	assert.equal(m.last().wins[m.last().wins.length - 1].id, "mail");
});

test("a focused Mail button that goes away moves the focus to the Mail tab", () => {
	const m = zoomed();
	m.update(base({ offers: { draw: "incoming", takeback: null } }));
	m.handlers.screen("mail");
	focusTo(m, "accept");
	m.said.length = 0;
	m.update(base({ offers: { draw: null, takeback: null } }));
	assert.ok(!m.view().buttons.some((b) => b.id === "accept"));
	assert.equal(m.view().focus, "tab:mail");
	assert.ok(m.said.includes("Mail, tab, 3 of 4, selected"));
});

test("ui({ typing: true }) keeps the focus off the console when Session is not in front", () => {
	const m = zoomed();
	press(m, "win:close");
	m.handlers.ui({ typing: true });
	assert.equal(m.view().focus, "tab:mail");
	m.key("x");
	assert.equal(m.view().input, "");
	m.handlers.screen("log");
	m.handlers.ui({ typing: true });
	assert.equal(m.view().focus, "tab:log");
	valid(m);
});

test("the front window's tab is marked selected, none when no window shows", () => {
	const m = zoomed();
	m.handlers.screen("mail");
	assert.deepEqual(m.view().tabs.filter((b) => b.selected).map((b) => b.id), ["tab:mail"]);
	press(m, "win:close");
	press(m, "win:close");
	assert.deepEqual(m.view().wins, []);
	assert.deepEqual(m.view().buttons, []);
	assert.deepEqual(m.view().tabs.filter((b) => b.selected), []);
	assert.equal(m.view().focus, "tab:session");
	for (const k of ["T", "term", "input"]) { assert.ok(k in m.view().v, k); }
	valid(m);
});

test("a press on a mail marks it read & saves once", () => {
	const m = zoomed({}, base({ offers: { draw: "incoming", takeback: null } }));
	m.update(base({ offers: { draw: null, takeback: null } }));
	m.update(base({ offers: { draw: "incoming", takeback: null } }));
	m.handlers.screen("mail");
	const n = m.terms.length;
	press(m, "msg:0");
	assert.equal(m.view().v.term.mail.filter((x) => x.read).length, 1);
	assert.equal(m.terms.length, n + 1);
});

test("a button that is not enabled is not pressed by Enter", () => {
	const m = zoomed();
	m.handlers.screen("mail");
	press(m, "req:hint");
	assert.equal(m.calls.filter((c) => c[0] === "hint").length, 1);
	assert.equal(m.view().focus, "req:hint");
	m.update(base({ actions: ALL.map((a) => (a.id === "hint" ? { ...a, enabled: false } : a)) }));
	m.key("Enter");
	assert.equal(m.calls.filter((c) => c[0] === "hint").length, 1);
});

test("W/A/S/D move the focus over the front window's buttons, its boxes & the tabs & say the button", () => {
	const m = zoomed();
	m.handlers.screen("systems");
	assert.equal(m.view().focus, "sound"); // ITS FIRST BUTTON
	m.said.length = 0;
	const all = [...m.view().buttons, ...m.view().tabs];
	m.key("w");
	const to = nextFocus(all, "sound", "up");
	assert.equal(m.view().focus, to);
	assert.deepEqual(m.said, [describe(all.find((b) => b.id === to), all)]);
	m.key("d");
	assert.equal(m.view().focus, nextFocus(all, to, "right"));
	focusTo(m, "win:close");
	m.key("Enter");
	assert.equal(win(m, "systems"), undefined);
	assert.equal(m.view().tabs.find((t) => t.id === "tab:systems").lit, false);
	valid(m);
});

/* ---------------------------------------------------------------- */
// Dragging & scrolling
/* ---------------------------------------------------------------- */

test("a title-bar drag moves the window & stops at the desk's edges, with one save at up & none during the drag", () => {
	const m = zoomed();
	const n = m.terms.length, s = m.shown();
	m.pointer("down", 100, 44);
	m.pointer("drag", -100, -56);
	assert.deepEqual(win(m, "session").p.frame, { x: 8, y: 16, w: 252, h: 172 });
	m.pointer("drag", 300, 244);
	const right = DESK.x + DESK.w - 252;
	assert.equal(right, 60);
	assert.deepEqual(win(m, "session").p.frame, { x: right, y: 46, w: 252, h: 172 });
	assert.equal(m.terms.length, n);
	assert.ok(m.shown() >= s + 2);
	m.pointer("up", 300, 244);
	assert.equal(m.terms.length, n + 1);
	assert.deepEqual(m.last().wins.find((w) => w.id === "session"), { id: "session", x: right, y: 46, w: 252, h: 172, open: true, min: false });
	m.pointer("drag", 0, 0); // NO DRAG AFTER UP
	assert.equal(win(m, "session").p.frame.x, right);
	valid(m);
});

test("a grip drag resizes down to 60 x 40 & no further; a drag from the close box starts nothing", () => {
	const m = zoomed();
	m.pointer("down", 287, 205);
	m.pointer("drag", 0, 0);
	m.pointer("up", 0, 0);
	assert.deepEqual(win(m, "session").p.frame, { x: 40, y: 38, w: 60, h: 40 });
	const n = m.terms.length;
	const c = win(m, "session").p.close;
	m.pointer("down", c.x + 2, c.y + 2);
	m.pointer("drag", 0, 100);
	m.pointer("up", 0, 100);
	assert.deepEqual(win(m, "session").p.frame, { x: 40, y: 38, w: 60, h: 40 });
	assert.equal(m.terms.length, n);
});

test("a down on a window behind brings it to the front", () => {
	const m = zoomed();
	m.pointer("down", 25, 100);
	assert.equal(frontId(m), "mail");
	valid(m);
});

test("a short Mail window shows a bar; the wheel, a thumb drag, a track press & PageDown scroll it", () => {
	const m = zoomed({ term: { wins: smallMail() } });
	const p = () => win(m, "mail").p;
	assert.ok(p().vbar && !p().hbar);
	assert.deepEqual(p().view, { x: 21, y: 33, w: 271, h: 46 });
	assert.deepEqual(win(m, "mail").content, { w: 271, h: 180 }); // AS WIDE AS ITS VIEW: IT NEVER SCROLLS SIDEWAYS
	m.pointer("wheel", 50, 50, { dx: 0, dy: 20 });
	assert.equal(p().scroll.y, 20);
	m.pointer("wheel", 50, 50, { dx: 0, dy: -500 });
	assert.equal(p().scroll.y, 0);
	m.pointer("wheel", 5, 100, { dx: 0, dy: 20 }); // NO WINDOW THERE
	assert.equal(p().scroll.y, 0);
	const n = m.terms.length;
	const t = p().vthumb;
	m.pointer("down", t.x + 3, t.y + 2);
	m.pointer("drag", t.x + 3, t.y + 12);
	m.pointer("up", t.x + 3, t.y + 12);
	assert.equal(p().vthumb.y, t.y + 10);
	assert.ok(p().scroll.y > 0);
	assert.equal(m.terms.length, n); // A SCROLL IS NOT SAVED
	m.pointer("wheel", 50, 50, { dx: 0, dy: -500 });
	m.pointer("press", p().vbar.x + 3, p().vbar.y + p().vbar.h - 2);
	assert.equal(p().scroll.y, 46);
	assert.equal(m.key("PageDown"), true);
	assert.equal(p().scroll.y, 92);
	m.key("PageUp");
	assert.equal(p().scroll.y, 46);
	valid(m);
});

test("PageDown does nothing when the front window has no vertical bar", () => {
	const m = zoomed();
	assert.equal(m.key("PageDown"), false);
	assert.equal(win(m, "session").p.scroll.y, 0);
});

test("a press inside a scrolled window presses the button drawn there; one on its bar presses none", () => {
	const m = zoomed({ term: { wins: smallMail() } });
	m.pointer("wheel", 50, 50, { dx: 0, dy: 120 });
	assert.equal(win(m, "mail").p.scroll.y, 120);
	m.pointer("press", 30, 45); // REQ:HINT AT CONTENT y 127 IS DRAWN AT GRID y 40
	assert.deepEqual(m.calls.map((c) => c[0]), ["hint"]);
	assert.equal(m.view().focus, "req:hint");
	assert.equal(m.view().keys, false); // THE POINTER'S FOCUS DOES NOT SHOW
	const vb = win(m, "mail").p.vbar;
	m.pointer("press", vb.x + 3, vb.y + 2); // THE TRACK
	assert.deepEqual(m.calls.map((c) => c[0]), ["hint"]);
	valid(m);
});

test("a content button the focus moves to is scrolled into view", () => {
	const mail = ["a", "b"].map((text) => ({ kind: "check", at: "00:01", text, read: false })); // LISTED AT THE TOP, THE REQUESTS AT THE BOTTOM
	const m = zoomed({ term: { wins: smallMail(), mail } });
	assert.equal(frontId(m), "mail");
	for (const k of ["w", "w", "w", "s", "s", "a", "w", "w"]) {
		m.key(k);
		const b = m.view().buttons.find((x) => x.id === m.view().focus);
		if (b && !b.id.startsWith("win:")) { assert.equal(b.hidden, undefined, b.id); }
		valid(m);
	}
	assert.ok(m.view().buttons.some((b) => b.hidden));
});

test("a press on a window behind raises it & presses its button", () => {
	const m = zoomed();
	m.pointer("press", 30, 165); // MAIL'S REQ:HINT, LEFT OF SESSION
	assert.equal(frontId(m), "mail");
	assert.deepEqual(m.calls.map((c) => c[0]), ["hint"]);
	assert.equal(m.view().focus, "req:hint");
	valid(m);
});

test("a press on nothing does nothing", () => {
	const m = zoomed();
	const n = m.terms.length;
	m.pointer("press", 5, 100);
	assert.equal(frontId(m), "session");
	assert.equal(m.view().focus, "console");
	assert.equal(m.terms.length, n);
	assert.deepEqual(m.calls, []);
});

test("the Log stays at the bottom as entries arrive, & stops following after a scroll up until it is back at the bottom", () => {
	const log = Array.from({ length: 30 }, (_, i) => ["14:00", `entry ${i}`, "ink"]);
	const m = zoomed({ term: { log } });
	m.handlers.screen("log");
	const p = () => win(m, "log").p;
	assert.ok(p().max.y > 0);
	assert.equal(p().scroll.y, p().max.y);
	const max0 = p().max.y;
	m.update(base({ moves: [{ number: 1, white: "e4", black: "" }] }));
	assert.ok(p().max.y > max0);
	assert.equal(p().scroll.y, p().max.y);
	m.pointer("wheel", 100, 100, { dx: 0, dy: -20 });
	const held = p().scroll.y;
	assert.equal(held, p().max.y - 20);
	m.update(base({ moves: [{ number: 1, white: "e4", black: "e5" }] }));
	assert.equal(p().scroll.y, held);
	m.pointer("wheel", 100, 100, { dx: 0, dy: 1000 });
	m.update(base({ moves: [{ number: 1, white: "e4", black: "e5" }, { number: 2, white: "d4", black: "" }] }));
	assert.equal(p().scroll.y, p().max.y);
	assert.equal(win(m, "log").v.box.w, p().view.w);
});

// The Log with n entries, open, sized & in front
const logTerm = (n, r = {}) => ({
	log: Array.from({ length: n }, (_, i) => ["14:00", `entry ${i}`, "ink"]),
	wins: raise(defaultWins().map((w) => (w.id === "log" ? { ...w, ...r, open: true } : w)), "log"),
});

test("a Log at the bottom before a resize is still at the bottom after it & keeps following new entries", () => {
	const m = zoomed({ term: logTerm(60) });
	const p = () => win(m, "log").p;
	const g = () => centre(p().grip);
	m.pointer("down", ...g()); m.pointer("drag", g()[0], g()[1] - 100); m.pointer("up");
	assert.equal(p().scroll.y, p().max.y);
	m.pointer("wheel", ...centre(p().view), { dx: 0, dy: -5 });
	assert.equal(p().scroll.y, p().max.y - 5);
	m.pointer("down", ...g()); m.pointer("drag", g()[0], g()[1] + 100); m.pointer("up");
	assert.equal(p().scroll.y, p().max.y);
	for (let i = 0; i < 16; i++) {
		m.update(base({ gameId: i % 2 ? "g1" : "g2" }));
		assert.equal(p().scroll.y, p().max.y, `entry ${i}`);
	}
});

test("a Log's box is the size of its view, also with a vertical bar", () => {
	const m = zoomed({ term: logTerm(5, { x: 20, y: 20, w: 280, h: 40 }) });
	const l = win(m, "log");
	assert.ok(l.p.vbar);
	assert.deepEqual(l.v.box, { w: l.p.view.w, h: l.p.view.h });
});

test("a tap on a window's grip or title bar presses nothing in it, & the grip hovers nothing", () => {
	const m = zoomed();
	m.handlers.screen("theme");
	const g = win(m, "theme").p.grip, t = win(m, "theme").p.title;
	const saved = m.prefsSaved.length;
	m.pointer("move", g.x + 1, g.y + 1);
	assert.equal(m.view().hover, null);
	m.pointer("down", g.x + 1, g.y + 1); m.pointer("up"); m.pointer("press", g.x + 1, g.y + 1);
	m.pointer("press", t.x + 10, t.y + t.h - 1);
	assert.equal(m.prefsSaved.length, saved);
	assert.equal(m.view().v.T.id, "slateamber");
	assert.equal(frontId(m), "theme");
	valid(m);
});

test("a press near a button scrolled out of view presses nothing", () => {
	const m = zoomed({ term: { wins: smallMail() } }, base({ actions: ALL.filter((a) => a.id === "hint") }));
	m.pointer("wheel", 50, 50, { dx: 0, dy: 80 }); // THE VIEW SHOWS CONTENT y 80 .. 125; REQ:HINT STARTS AT 127
	assert.deepEqual(win(m, "mail").p.scroll, { x: 0, y: 80 });
	m.pointer("press", 30, 78); // CONTENT y 125, 2 px ABOVE IT
	assert.deepEqual(m.calls, []);
	m.pointer("wheel", 50, 50, { dx: 0, dy: 4 });
	m.pointer("press", 30, 78);
	assert.deepEqual(m.calls.map((c) => c[0]), ["hint"]);
});

test("a focused button wider than the view is scrolled to show its left end", () => {
	const m = zoomed();
	m.handlers.screen("theme");
	const g = win(m, "theme").p.grip;
	m.pointer("down", g.x + 1, g.y + 1); m.pointer("drag", 0, 0); m.pointer("up");
	const p = () => win(m, "theme").p;
	assert.deepEqual([p().frame.w, p().frame.h], [60, 40]);
	focusTo(m, "win:close");
	for (let i = 0; i < 6; i++) {
		m.key("s");
		const b = m.view().buttons.find((x) => x.id === m.view().focus);
		if (!b || !b.id.startsWith("theme:")) { continue; }
		assert.ok(b.x >= p().view.x && b.x < p().view.x + p().view.w, b.id);
	}
});

test("a drag of a window behind saves once, at up; a down & up on it with no drag saves once, at up", () => {
	const m = zoomed();
	let n = m.terms.length;
	const t = win(m, "mail").p.title;
	m.pointer("down", t.x + 5, t.y + 5);
	assert.equal(frontId(m), "mail");
	assert.equal(m.terms.length, n);
	m.pointer("drag", t.x + 15, t.y + 15);
	m.pointer("up", t.x + 15, t.y + 15);
	assert.equal(m.terms.length, n + 1);
	assert.equal(m.last().wins[m.last().wins.length - 1].id, "mail");
	assert.equal(m.last().wins.find((w) => w.id === "mail").x, t.x + 10);
	const o = zoomed();
	n = o.terms.length;
	o.pointer("down", 25, 100); // MAIL'S BODY, LEFT OF SESSION
	assert.equal(frontId(o), "mail");
	assert.equal(o.terms.length, n);
	o.pointer("up", 25, 100);
	assert.equal(o.terms.length, n + 1);
	assert.equal(o.last().wins[o.last().wins.length - 1].id, "mail");
});

test("Escape in a drag ends it where it left the window with one save, & a drag after coming back moves nothing", () => {
	const m = zoomed();
	const t = win(m, "session").p.title;
	const n = m.terms.length;
	m.pointer("down", t.x + 5, t.y + 5);
	m.pointer("drag", t.x - 25, t.y + 35);
	const at = { ...m.view().v.term.wins.find((w) => w.id === "session") };
	m.key("Escape");
	m.left();
	m.pointer("up");
	assert.deepEqual(m.view().v.term.wins.find((w) => w.id === "session"), at);
	assert.equal(m.terms.length, n + 1);
	assert.deepEqual(m.last().wins.find((w) => w.id === "session"), at);
	m.enter(); m.arrived();
	m.pointer("drag", t.x + 100, t.y + 100);
	m.pointer("up");
	assert.deepEqual(m.view().v.term.wins.find((w) => w.id === "session"), at);
	assert.equal(m.terms.length, n + 1);
});

test("up ends a drag in any state, & Backspace or Delete during a drag leave it going", () => {
	const m = zoomed();
	const t = win(m, "session").p.title;
	m.pointer("down", t.x + 5, t.y + 5);
	m.pointer("drag", t.x - 5, t.y + 5);
	m.key("Backspace"); m.key("Delete");
	m.pointer("drag", t.x - 25, t.y - 5);
	assert.deepEqual([win(m, "session").p.frame.x, win(m, "session").p.frame.y], [t.x - 30, t.y - 10]);
	m.update(base({ offline: true })); // A FAULT ENDS IT, SAVED BY THAT UPDATE
	assert.equal(m.last().wins.find((w) => w.id === "session").x, t.x - 30);
	m.pointer("drag", t.x + 50, t.y + 50);
	assert.equal(m.view().v.term.wins.find((w) => w.id === "session").x, t.x - 30);
	const i = zoomed();
	i.pointer("down", t.x + 5, t.y + 5);
	i.pointer("drag", t.x - 25, t.y + 25);
	i.reset(); // STRAIGHT TO IDLE, SAVED
	assert.equal(i.last().wins.find((w) => w.id === "session").x, t.x - 30);
	const n = i.terms.length;
	i.pointer("up");
	assert.equal(i.terms.length, n);
});

test("a drag cut short by Escape or a second down is saved", () => {
	for (const cut of [(m) => m.key("Escape"), (m, t) => m.pointer("down", t.x - 25, t.y + 35)]) {
		const m = zoomed();
		const t = win(m, "session").p.title;
		m.pointer("down", t.x + 5, t.y + 5);
		m.pointer("drag", t.x - 25, t.y + 35);
		const x = m.view().v.term.wins.find((w) => w.id === "session").x;
		cut(m, t);
		m.pointer("up");
		assert.equal(m.last().wins.find((w) => w.id === "session").x, x);
	}
});

/* ---------------------------------------------------------------- */
// Pointer
/* ---------------------------------------------------------------- */

test("on the desk a press returns zoom & the view has no pointer", () => {
	const m = make({ term: kept() });
	m.update(base());
	m.pointer("move", 100, 100);
	assert.equal(m.pointer("press", 100, 100), "zoom");
	assert.equal(m.view().pointer, null);
	assert.equal(m.view().hover, null);
	m.pointer("down", 100, 44);
	m.pointer("drag", 0, 0);
	assert.deepEqual(m.view().wins.find((w) => w.id === "session").p.frame.x, 40);
	assert.equal(make().pointer("press", 1, 1), null); // NO DATA YET
});

test("zoomed, a move stores the point & the hovered id, redrawing only on a change; out clears both", () => {
	const m = zoomed();
	const tab = button(m, "tab:log");
	const [x, y] = centre(tab);
	const n = m.shown();
	m.pointer("move", x, y);
	assert.deepEqual(m.view().pointer, { x, y });
	assert.equal(m.view().hover, "tab:log");
	assert.equal(m.shown(), n + 1);
	m.pointer("move", x, y);
	assert.equal(m.shown(), n + 1);
	m.pointer("move", ...centre(button(m, "win:close")));
	assert.equal(m.view().hover, "win:close");
	m.pointer("move", 150, 120);
	assert.equal(m.view().hover, "console");
	assert.equal(win(m, "session").v.hover, "console");
	m.pointer("move", 25, 165); // MAIL'S REQ:HINT, BEHIND
	assert.equal(m.view().hover, null);
	m.pointer("out");
	assert.equal(m.view().pointer, null);
	assert.equal(m.view().hover, null);
	m.pointer("move", x, y);
	m.leave();
	assert.equal(m.view().pointer, null);
	assert.equal(m.view().hover, null);
});

test("a press on a button moves the focus to it; a press in the console types", () => {
	const m = zoomed();
	press(m, "tab:systems");
	assert.equal(frontId(m), "systems");
	press(m, "sound");
	assert.equal(m.view().focus, "sound");
	assert.equal(m.calls.filter((c) => c[0] === "sound").length, 1);
	m.handlers.screen("session");
	m.key("ArrowUp");
	m.pointer("press", 150, 120);
	assert.equal(m.view().focus, "console");
	valid(m);
});

test("during a phase presses, drags & the wheel do nothing & the view has no buttons", () => {
	const m = zoomed();
	m.update(base({ offline: true }));
	assert.deepEqual(m.view().buttons, []);
	assert.equal(m.pointer("press", ...centre(tabButtons()[1])), null);
	assert.deepEqual(ids(m), ["mail", "session"]);
	m.pointer("down", 100, 44);
	m.pointer("drag", 0, 0);
	m.pointer("up", 0, 0);
	assert.equal(win(m, "session").p.frame.x, 40);
	assert.equal(m.key("1"), false);
	valid(m);
});

/* ---------------------------------------------------------------- */
// States, arriving & the screen reader
/* ---------------------------------------------------------------- */

test("arriving puts the focus on the console when Session is in front, else the front window's tab, & announces the window", () => {
	const m = zoomed();
	assert.equal(m.view().focus, "console");
	assert.ok(m.said.includes(`Session window. ${HINT[0]}`));
	const l = zoomed({ term: { wins: raise(raise(defaultWins(), "log"), "log").map((w) => (w.id === "log" ? { ...w, open: true } : w)) } });
	assert.equal(frontId(l), "log");
	assert.equal(l.view().focus, "tab:log");
	assert.ok(l.said[l.said.length - 1].startsWith("Log window. "));
	const c = zoomed({ term: { wins: defaultWins().map((w) => ({ ...w, open: false })) } });
	assert.deepEqual(c.view().wins, []);
	assert.equal(c.view().focus, "tab:session");
	valid(c);
});

test("nothing is announced on the desk", () => {
	const m = make({ term: kept() });
	m.update(base());
	m.update(base({ moves: [{ number: 1, white: "e4", black: "" }] }));
	m.handlers.screen("log");
	assert.deepEqual(m.said, []);
});

test("enter, arrived, leave & left walk idle, zooming, zoomed, leaving, idle; Escape leaves while zooming", () => {
	const m = make({ term: kept() });
	m.enter();
	assert.equal(m.state, "idle"); // NO DATA YET
	m.update(base());
	m.enter();
	assert.equal(m.state, "zooming");
	assert.equal(m.key("a"), false);
	assert.equal(m.key("Escape"), true);
	assert.equal(m.state, "leaving");
	m.left();
	assert.equal(m.state, "idle");
	m.enter(); m.arrived();
	assert.equal(m.view().zoomed, true);
	m.reset();
	assert.equal(m.state, "idle");
	assert.equal(m.view().focus, null);
});

test("under reduce, enter goes straight to zoomed & leave straight to idle", () => {
	const m = make({ term: kept(), reduce: true });
	m.update(base());
	m.enter();
	assert.equal(m.state, "zoomed");
	m.leave();
	assert.equal(m.state, "idle");
});

test("leaving & coming back keeps the windows as they were", () => {
	const m = zoomed();
	m.handlers.screen("diag");
	m.leave(); m.left();
	m.enter(); m.arrived();
	assert.equal(frontId(m), "diag");
	assert.equal(m.view().focus, "win:close");
	valid(m);
});

test("deskFocus shows on the desk only, & redraws only on a change", () => {
	const m = make({ term: kept() });
	m.update(base());
	const n = m.shown();
	m.deskFocus(true);
	m.deskFocus(true);
	assert.equal(m.shown(), n + 1);
	assert.equal(m.view().deskFocus, true);
	m.enter();
	assert.equal(m.view().deskFocus, false);
});

/* ---------------------------------------------------------------- */
// Handlers & robustness
/* ---------------------------------------------------------------- */

test("the game's handlers pass through, a missing one is a no-op, & every handler redraws", () => {
	const m = zoomed({ handlers: ["hint"] });
	let n = m.shown();
	m.handlers.hint();
	assert.deepEqual(m.calls, [["hint"]]);
	assert.ok(m.shown() > n);
	n = m.shown();
	for (const name of OUTSIDE) { m.handlers[name]("x"); }
	assert.ok(m.shown() >= n + OUTSIDE.length);
	const full = zoomed();
	assert.deepEqual(full.handlers.move("e4"), { san: "e4" });
	full.handlers.clear();
	assert.deepEqual(full.view().v.term.lines, [HINT]);
	full.handlers.exit();
	assert.equal(full.state, "leaving");
});

test("the view before any data still has the screen data, the windows & the tabs", () => {
	const m = make();
	const view = m.view();
	assert.equal(view.phase, null);
	assert.deepEqual(view.wins.map((w) => w.id), ["mail", "session"]);
	assert.deepEqual(view.tabs.map((t) => t.id), tabButtons().map((b) => b.id));
	for (const k of ["T", "term", "ui", "input", "focus", "hover", "zoomed", "reduce", "now", "box"]) { assert.ok(k in view.v, k); }
	assert.equal(view.v.now, T0);
	assert.deepEqual(view.v.T, themeFor("slateamber"));
});

test("nothing throws on sparse data, keys, drags & presses before data, or storage that fails", () => {
	const fail = () => { throw new Error("blocked"); };
	const m = make({ deps: { loadTerm: fail, saveTerm: fail, loadPrefs: fail, savePrefs: fail } });
	m.key("a");
	m.pointer("press", 10, 10);
	m.pointer("move", 10, 10);
	m.pointer("down", 10, 10);
	m.pointer("drag", 20, 20);
	m.pointer("up", 20, 20);
	m.pointer("wheel", 10, 10);
	m.update({});
	m.update({ moves: [{ number: 1, white: "e4" }] });
	m.enter(); m.arrived();
	m.clock.t += 60000;
	m.view();
	type(m, "status"); m.key("Enter");
	m.handlers.prefs({ theme: "paper" });
	for (const id of ["systems", "mail", "log", "diag", "theme", "session"]) { m.handlers.screen(id); m.view(); }
	m.pointer("wheel", 100, 100, {});
	m.pointer("down", 100, 25);
	m.pointer("drag", 120, 40);
	m.pointer("up", 120, 40);
	m.key("PageDown");
	valid(m);
});

test("the zoom helpers stay importable from monitor.js for its callers", () => {
	assert.deepEqual(uvToGrid(0, 0), { x: 0, y: 0 });
	assert.equal(typeof zoomDistance, "function");
	assert.equal(typeof isTap, "function");
});

test("the maker's screen, then the boot lines, play on every start, from the first data, then the desktop comes up; nothing is added to the console", () => {
	const first = make({ boot: true });
	assert.equal(first.view().phase, "splash");
	assert.equal(first.view().elapsed, 0); // THE CLOCK WAITS FOR THE FIRST DATA
	first.update(base());
	first.clock.t += SPLASH_MS - 1;
	assert.equal(first.view().phase, "splash");
	first.clock.t += 1;
	assert.equal(first.view().phase, "boot");
	const lines = first.view().lines;
	assert.ok(lines.length >= 8 && lines.includes("Type help for commands."));
	first.enter();
	first.arrived();
	assert.equal(first.key("h"), false); // NO TYPING DURING THE BOOT
	first.clock.t += lines.length * 400 - 1;
	assert.equal(first.view().phase, "boot");
	first.clock.t += 1;
	assert.equal(first.view().phase, null);
	assert.deepEqual(first.view().lines, []);
	const kept = first.terms[first.terms.length - 1];
	assert.ok(!kept.lines.some((l) => l[0] === "Connecting to terminal 03."));
	const again = make({ boot: true, term: kept }); // A RELOAD: IT PLAYS AGAIN
	assert.equal(again.view().phase, "splash");
});

test("no boot lines under reduced motion", () => {
	const r = make({ boot: true, reduce: true });
	assert.equal(r.view().phase, null);
});

test("the focus shows after a key & not after a pointer press, so a pressed button is not left lit", () => {
	const m = zoomed();
	m.handlers.screen("systems");
	m.key("s");
	assert.equal(m.view().keys, true);
	assert.equal(win(m, "systems").v.focus, m.view().focus);
	press(m, "sound");
	assert.equal(m.view().focus, "sound");
	assert.equal(m.view().keys, false);
	assert.equal(win(m, "systems").v.focus, null); // THE SCREEN DRAWS NO FOCUS
	m.key("s");
	assert.equal(m.view().keys, true);
	m.pointer("move", 5, 100);
	assert.equal(m.view().keys, false);
});

test("Systems opens Administrative control; its override asks once, then forfeits; closing it drops the question", () => {
	const m = zoomed();
	m.handlers.screen("systems");
	press(m, "admin");
	assert.equal(frontId(m), "admin");
	press(m, "request");
	assert.deepEqual(m.calls.map((c) => c[0]), ["takeback"]);
	press(m, "override");
	assert.deepEqual(m.calls.map((c) => c[0]), ["takeback"]);
	assert.equal(win(m, "admin").v.ui.confirm, true);
	press(m, "win:close");
	m.handlers.screen("admin");
	assert.equal(win(m, "admin").v.ui.confirm, undefined);
	press(m, "override");
	press(m, "override");
	assert.deepEqual(m.calls.map((c) => c[0]), ["takeback", "forfeit"]);
	valid(m);
});

test("terms the player sent are logged & mailed with the bot's answer", () => {
	const m = zoomed();
	m.update(base({ offers: { draw: "sent", takeback: null } }));
	const kept = m.last();
	assert.equal(kept.mail.at(-1).kind, "answer");
	assert.equal(kept.mail.at(-1).text, "Terms sent. [UNIT] declines.");
	assert.equal(kept.log.at(-1)[1], "Terms sent. [UNIT] declines.");
});

test("Control + C drops the typed line, keeps it in the console without ^C & forgets a waiting confirmation; off the console it does nothing", () => {
	const m = zoomed();
	type(m, "resign");
	m.key("Enter");
	type(m, "ye");
	assert.equal(m.key("Cancel"), true);
	assert.equal(m.view().input, "");
	assert.equal(texts(m).at(-1), "> ye");
	assert.equal(m.last().lines.at(-1)[0], "> ye"); // KEPT
	const before = texts(m);
	m.key("Cancel"); // NOTHING TYPED: NO LINE
	assert.deepEqual(texts(m), before);
	type(m, "yes");
	m.key("Enter");
	assert.deepEqual(m.calls.filter((c) => c[0] === "forfeit"), []); // THE QUESTION WAS DROPPED
	m.key("ArrowUp"); // OFF THE CONSOLE
	assert.equal(m.key("Cancel"), false);
});
