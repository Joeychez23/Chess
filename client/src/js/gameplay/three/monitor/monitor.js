/*
 *  monitor.js  --  chess frontend
 *	The Meridian Terminal's State Machine
 *	The monitor on the desk: idle, zooming in, zoomed (the terminal takes the keys & the pointer) & leaving. It keeps the terminal's state
 *	(the kept term & its windows, the input, the focus, each window's ui & scroll, the fault's phases) & builds what screen.js draws, view().
 *	It is fed pointer hits in grid pixels & keys by ../pointer. The pure helpers are in controls.js (hit testing, focus, keys) & windows.js (geometry).
 *	No DOM, no three.js & no timers here (time only through deps.now()), so the tests load it in Node (client/test/monitor/monitor.test.js)
 *
 */

import { themeFor } from "./themes.js";
import { clean as cleanPrefs, defaults, loadPrefs as loadStoredPrefs, savePrefs as saveStoredPrefs } from "./prefs.js";
import { blank, clean as cleanTerm, loadTerm as loadStoredTerm, saveTerm as saveStoredTerm, LINES_MAX, LOG_MAX, MAIL_MAX } from "./store.js";
import { eventsFrom, plies } from "./events.js";
import { INPUT_MAX, run } from "./commands.js";
import { nextPhase, bootLines, FAULT_MS, SPLASH_MS, LINE_MS } from "./boot.js";
import { tabButtons, hit, nextFocus, keyAction, describe } from "./controls.js";
import { IDS, TABBED, TITLES, open as openWin, close as closeWin, shown, front, at as winAt, move, resize, parts, thumbTo, page } from "./windows.js";
import { SCREEN, NAMES } from "./screens/index.js";
export { uvToGrid, zoomDistance, isTap } from "./controls.js"; // FOR THE CALLERS THAT IMPORTED THEM FROM HERE

const OUTSIDE = ["hint", "takeback", "draw", "declineDraw", "declineTakeback", "restart", "forfeit", "sound", "move"];
const HINT = ["Type help for commands.", "dim"]; // THE ONE LINE OF A BLANK OR EMPTIED CONSOLE

// A storage read that falls back when the storage throws
function attempt(fn, fallback) {
	try { return fn(); } catch { return fallback(); }
}

const inside = (r, x, y) => Boolean(r) && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
// The scroll along one axis that shows [pos, pos + len) in a view of size at scroll s, moving as little as it can
// (one longer than the view shows its start)
const showing = (pos, len, s, size) => (pos < s || len > size ? pos : pos + len > s + size ? pos + len - size : s);

/* ---------------------------------------------------------------- */
// Monitor
/* ---------------------------------------------------------------- */

/**
 * @description Makes the monitor's state machine
 * @param  {[object]} deps [show() when view() changed, announce(text) for the screen reader, handlers (the game's: hint, takeback, draw,
 *                          declineDraw, declineTakeback, restart, forfeit, sound, move), loadPrefs() & savePrefs(prefs) (prefs.js's),
 *                          loadTerm() & saveTerm(term) (store.js's), reduce() whether motion is reduced, now() ms (Date.now)]
 * @return {[object]} monitor: state, handlers, update, enter, arrived, leave, left, reset, pointer, deskFocus, key, view
 */
export function createMonitor(deps) {
	const reduce = deps.reduce || (() => false);
	const now = deps.now || Date.now;
	const outside = deps.handlers || {};
	const storePrefs = deps.savePrefs || saveStoredPrefs;
	const storeTerm = deps.saveTerm || saveStoredTerm;
	let prefs = cleanPrefs(attempt(deps.loadPrefs || loadStoredPrefs, defaults));
	const term = cleanTerm(attempt(deps.loadTerm || loadStoredTerm, blank));
	// What the commands keep between lines: the board's side & a confirmation waiting for its second word.
	const cmd = { flipped: term.flipped, confirm: null };
	// Per window, in memory only: its screen's state & its scroll; the Log follows its bottom until scrolled away from it.
	const ui = Object.fromEntries(IDS.map((id) => [id, {}]));
	const scroll = Object.fromEntries(IDS.map((id) => [id, { x: 0, y: 0 }]));
	let follow = true;
	let data = null;
	let input = "";
	let focus = null, hover = null, at = null;
	let keyFocus = false;
	let keys = true; // THE FOCUS SHOWS: IT WAS LAST MOVED BY THE KEYBOARD. A POINTER PRESS LEAVES NO BUTTON LIT ONCE THE POINTER IS OFF IT
	const seen = () => (keys || focus === "console" ? focus : null); // THE CONSOLE'S FOCUS IS ITS CURSOR: IT ALWAYS SHOWS
	let drag = null; // { kind: move | resize | thumb, id, x, y (where it started), win (the record then), axis, off }
	let raised = false; // a "down" brought a window to the front: saved when the press ends
	// The fault & the maker's screen
	// THE MAKER'S SCREEN, THEN THE BOOT LINES, PLAY EACH TIME THE TERMINAL STARTS (EVERY PAGE LOAD), FROM THE FIRST DATA; NOT UNDER REDUCED MOTION, & NOT WHEN deps.boot IS false
	const booting = () => deps.boot !== false && !reduce();
	const bootCount = () => (booting() ? bootLines(data).length : 0);
	let phase = booting() ? "splash" : null;
	let phaseAt = null;
	let onlineAt = -Infinity;
	const startedAt = now();
	let movedAt = null;

	const monitor = { state: "idle" };

	const save = () => attempt(() => storeTerm(term), () => false);
	const zoomedNow = () => monitor.state === "zoomed";
	// The screen reader hears nothing on the desk.
	const say = (text) => { if (text && zoomedNow()) { deps.announce(text); } };
	const winOf = (id) => term.wins.find((w) => w.id === id);
	const frontId = () => (front(term.wins) || {}).id || null;
	const stamp = () => {
		const t = new Date(now());
		return `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
	};

	/* ---------------- Layout ---------------- */

	// The data every screen gets
	function baseData() {
		return { ...data, T: themeFor(prefs.theme), term, input, zoomed: zoomedNow(), reduce: Boolean(reduce()), now: now(), startedAt, movedAt };
	}

	// A window laid out: its screen data sized to the view its bars leave, its content's size & its parts (with the clamped scroll)
	function layout(win, d = baseData()) {
		const mod = SCREEN[win.id];
		const isFront = frontId() === win.id;
		const dataFor = (view) => ({ ...d, ui: ui[win.id], focus: isFront ? seen() : null, hover: isFront ? hover : null, box: { w: view.w, h: view.h } });
		let v = dataFor(parts(win, null).view);
		let content = mod.size(v);
		let p = parts(win, content, scroll[win.id]);
		// A bar narrows the view & a reflowing screen sizes to its box: ask again until they agree (a bar can come & go once each)
		for (let i = 0; i < 2 && (p.view.w !== v.box.w || p.view.h !== v.box.h); i++) {
			v = dataFor(p.view);
			content = mod.size(v);
			p = parts(win, content, scroll[win.id]);
		}
		// The kept scroll clamped to this size, so a resize leaves no stale scroll; the Log follows again when that puts it at its bottom
		if (win.id === "log") {
			follow = follow || p.scroll.y >= p.max.y;
			if (follow && p.scroll.y !== p.max.y) { p = parts(win, content, { ...p.scroll, y: p.max.y }); }
		}
		scroll[win.id] = p.scroll;
		return { id: win.id, title: TITLES[win.id], front: isFront, p, content, v };
	}

	// A laid-out window's buttons in grid pixels, those not wholly inside its view marked hidden, then its close box
	function winButtons(L) {
		const { view, scroll: s } = L.p;
		const own = SCREEN[L.id].buttons(L.v).map(function (b) {
			const x = view.x + b.x - s.x, y = view.y + b.y - s.y;
			return inside(view, x, y) && inside(view, x + b.w - 1, y + b.h - 1) ? { ...b, x, y } : { ...b, x, y, hidden: true };
		});
		return [...own, { id: "win:close", ...L.p.close, label: "Close", enabled: true }];
	}

	const frontLayout = () => (front(term.wins) ? layout(front(term.wins)) : null);
	const frontButtons = () => { const L = frontLayout(); return L ? winButtons(L) : []; };

	// The footer tabs: lit while their window is open, selected for the front window
	const tabs = () => tabButtons().map(function (b) {
		const w = winOf(b.id.slice(4));
		return { ...b, lit: w.open, selected: b.id === `tab:${frontId()}` };
	});
	const allButtons = () => [...frontButtons(), ...tabs()];

	/* ---------------- Focus & scroll ---------------- */

	// Scrolls a window, clamped; the Log follows its bottom again once scrolled back to it. Whether the scroll changed
	function scrollTo(id, s) {
		const L = layout(winOf(id));
		const next = parts(winOf(id), L.content, s).scroll;
		scroll[id] = next;
		if (id === "log") { follow = next.y >= L.p.max.y; }
		return next.x !== L.p.scroll.x || next.y !== L.p.scroll.y;
	}

	// Scrolls the front window just enough to show its focused content button
	function reveal() {
		const L = frontLayout();
		const b = L && SCREEN[L.id].buttons(L.v).find((x) => x.id === focus);
		if (!b) { return; }
		const { view, scroll: s } = L.p;
		scrollTo(L.id, { x: showing(b.x, b.w, s.x, view.w), y: showing(b.y, b.h, s.y, view.h) });
	}

	// Moves the focus to a button & says it
	function focusOn(id) {
		focus = id;
		reveal();
		const all = allButtons();
		const b = all.find((x) => x.id === id);
		if (b) { say(describe(b, all)); }
	}

	// Where the focus rests on the front window: the console on Session, its tab, or its close box (Diagnostics, Theme);
	// with no window showing, the tab of `fallback` (else Session's)
	function home(fallback) {
		const id = frontId();
		if (!id) { return `tab:${TABBED.includes(fallback) ? fallback : "session"}`; }
		if (id === "session") { return "console"; }
		return TABBED.includes(id) ? `tab:${id}` : "win:close";
	}

	// Keeps the focus & the hover on what exists: a focus on a button that is gone goes home
	function repair() {
		const ids = allButtons().map((b) => b.id);
		if (hover !== null && (phase || !ids.includes(hover))) { hover = null; }
		if (focus === null || ids.includes(focus)) { return; }
		focusOn(home());
	}

	// Every redraw goes through the repair, so no stale focus reaches the view
	const show = () => { repair(); deps.show(); };

	/* ---------------- Windows ---------------- */

	// Opens a window or brings it to the front, focused & announced; one already in front stays as it is
	function bring(id, later = false) {
		if (!SCREEN[id] || frontId() === id) { return; }
		term.wins = openWin(term.wins, id);
		if (later) { raised = true; } else { save(); }
		const L = layout(winOf(id));
		// Its first button in view
		const first = winButtons(L).find((b) => b.enabled && !b.hidden && !b.id.startsWith("win:"));
		focus = id === "session" ? "console" : first ? first.id : home();
		say(`${NAMES[id]} window. ${SCREEN[id].speak(L.v)}`);
	}

	// Closes a window: where it is & its size are kept, its ui & scroll reset; the focus goes to the new front window
	function hide(id) {
		term.wins = closeWin(term.wins, id);
		ui[id] = {};
		scroll[id] = { x: 0, y: 0 };
		if (id === "log") { follow = true; }
		say(`${NAMES[id]} closed.`);
		save();
		focusOn(home(id));
	}

	// A footer tab: closed opens in front, behind comes to the front, in front closes
	function tabPress(id) {
		if (frontId() === id) { hide(id); } else { bring(id); }
	}

	// Runs a focused or pressed id: a tab, the front window's boxes or one of its content buttons
	function activate(id) {
		if (id.startsWith("tab:")) { tabPress(id.slice(4)); return; }
		const L = frontLayout();
		if (!L) { return; }
		if (id === "win:close") { hide(L.id); }
		else { SCREEN[L.id].press(id, handlers, L.v); }
	}

	/* ---------------- Pointer ---------------- */

	// The tab under a point: the footer is below the desk, so no window covers it
	const tabAt = (x, y) => (winAt(term.wins, x, y) ? null : hit(tabs(), x, y));

	// The content button of a laid-out window drawn under a grid point: the point in its view (not on the grip), never a button scrolled out of it
	function contentAt(L, x, y) {
		const { view, scroll: s } = L.p;
		if (!inside(view, x, y) || inside(L.p.grip, x, y)) { return null; } // THE GRIP CAN LIE IN A VIEW WITH NO BARS
		const seen = SCREEN[L.id].buttons(L.v).filter((b) => b.x < s.x + view.w && b.x + b.w > s.x && b.y < s.y + view.h && b.y + b.h > s.y);
		return hit(seen, x - view.x + s.x, y - view.y + s.y);
	}

	// What the pointer hovers: a tab, the front window's boxes or one of its buttons (other windows' buttons do not hover)
	function hoverAt(x, y) {
		if (phase) { return null; }
		const t = tabAt(x, y);
		if (t) { return t.id; }
		const w = winAt(term.wins, x, y);
		if (!w || w.id !== frontId()) { return null; }
		const L = layout(winOf(w.id));
		if (inside(L.p.close, x, y)) { return "win:close"; }
		const b = contentAt(L, x, y);
		return b ? b.id : null;
	}

	// The topmost window under a point brought to the front, laid out; null when there is none
	function grab(x, y, later = false) {
		const w = winAt(term.wins, x, y);
		if (!w) { return null; }
		bring(w.id, later);
		return layout(winOf(w.id));
	}

	// A tap: a tab, else by the part of the window under it
	function pressAt(x, y) {
		const t = tabAt(x, y);
		if (t) { focus = t.id; tabPress(t.id.slice(4)); return; }
		const L = grab(x, y);
		if (!L) { return; }
		const { p } = L;
		if (inside(p.close, x, y)) { hide(L.id); return; }
		for (const [axis, bar, th] of [["y", p.vbar, p.vthumb], ["x", p.hbar, p.hthumb]]) {
			if (!inside(bar, x, y)) { continue; }
			if (!inside(th, x, y)) { // THE TRACK PAGES TOWARDS THE POINT
				const dir = (axis === "y" ? y < th.y : x < th.x) ? -1 : 1;
				scrollTo(L.id, { ...p.scroll, [axis]: page(winOf(L.id), L.content, p.scroll, axis, dir) });
			}
			return;
		}
		const b = contentAt(L, x, y);
		if (!b) { return; }
		focus = b.id;
		reveal();
		activate(b.id);
	}

	// A press held down: the window comes to the front & a drag starts on its title bar, its grip or a thumb
	// shortcut: there is no keyboard way to move or resize a window; everything in one is still reached by keys because it scrolls
	function down(x, y) {
		up();
		const L = grab(x, y, true);
		if (!L || inside(L.p.close, x, y)) { return; }
		const { p } = L, start = { id: L.id, x, y, win: winOf(L.id) };
		if (inside(p.grip, x, y)) { drag = { ...start, kind: "resize" }; } // FIRST ONLY AS A SAFEGUARD: NO BAR OR THUMB REACHES THE GRIP
		else if (inside(p.title, x, y)) { drag = { ...start, kind: "move" }; }
		else if (inside(p.vthumb, x, y)) { drag = { ...start, kind: "thumb", axis: "y", off: y - p.vthumb.y }; }
		else if (inside(p.hthumb, x, y)) { drag = { ...start, kind: "thumb", axis: "x", off: x - p.hthumb.x }; }
	}

	// The drag carried on: the window moved or resized by the distance from where it started (so the grabbed point stays under
	// the pointer after it met an edge), or the thumb kept under the point where it was grabbed
	function dragTo(x, y) {
		const w = winOf(drag.id);
		if (!w.open || w.min) { drag = null; return; }
		if (drag.kind === "thumb") {
			const L = layout(w), pos = (drag.axis === "y" ? y : x) - drag.off;
			scrollTo(drag.id, { ...L.p.scroll, [drag.axis]: thumbTo(w, L.content, drag.axis, pos) });
			return;
		}
		const next = (drag.kind === "move" ? move : resize)(drag.win, x - drag.x, y - drag.y);
		term.wins = term.wins.map((r) => (r.id === drag.id ? next : r));
	}

	// The press ends (or is cut short); a window raised, moved or resized is saved once, here
	function up() {
		const w = drag && drag.kind !== "thumb" && winOf(drag.id);
		if (raised || (w && ["x", "y", "w", "h"].some((k) => w[k] !== drag.win[k]))) { save(); }
		drag = null;
		raised = false;
	}

	/* ---------------- Terminal ---------------- */

	// Prints a line, logs it & mails it when it has a kind; all capped
	function record(text, tone, kind) {
		const time = stamp();
		term.lines = [...term.lines, [`${time} ${text}`, tone]].slice(-LINES_MAX);
		term.log = [...term.log, [time, text, tone]].slice(-LOG_MAX);
		if (kind) { term.mail = [...term.mail, { kind, at: time, text, read: false }].slice(-MAIL_MAX); }
	}

	// When a phase ends, from its start
	function endOf(p, from) {
		if (p === "boot") { return from + bootCount() * LINE_MS; }
		return p === "fault" ? Math.max(from + FAULT_MS, onlineAt) : from + SPLASH_MS;
	}

	// Runs the phases on to now: fault, splash, the boot lines, then the desktop
	function advance() {
		while (phase && phaseAt !== null) {
			const next = nextPhase(phase, now() - phaseAt, { offline: Boolean(data && data.offline), lines: bootCount() });
			if (next === phase) { return; }
			phaseAt = endOf(phase, phaseAt);
			phase = next;
		}
	}

	const handlers = {
		screen(id) {
			bring(id);
			show();
		},
		ui(patch) {
			const { typing, ...rest } = patch || {};
			if (typing) { focus = "console"; }
			const id = frontId();
			if (id) { ui[id] = { ...ui[id], ...rest }; }
			show();
		},
		clear() {
			term.lines = [HINT];
			save();
			show();
		},
		exit() {
			monitor.leave();
			show();
		},
		prefs(patch) {
			prefs = cleanPrefs({ ...prefs, ...patch });
			attempt(() => storePrefs(prefs), () => false);
			show();
		},
		read(i) {
			if (term.mail[i]) {
				term.mail[i].read = true;
				save();
			}
			show();
		},
	};
	for (const name of new Set([...OUTSIDE, ...Object.keys(outside)])) {
		if (handlers[name]) { continue; }
		handlers[name] = (...args) => {
			const out = typeof outside[name] === "function" ? outside[name](...args) : undefined;
			show();
			return out;
		};
	}

	// Straight back to the desk.
	function toIdle() {
		monitor.state = "idle";
		up();
		focus = hover = at = null;
		cmd.confirm = null;
		show();
	}

	// Runs the typed line
	function runInput() {
		if (!input) { return; }
		const line = input;
		input = "";
		term.lines = [...term.lines, ["> " + line, "dim"]];
		const reply = run(line, { data: data || {}, handlers, term: cmd });
		term.lines = [...term.lines, ...reply].slice(-LINES_MAX);
		term.flipped = cmd.flipped;
		save();
		say(reply.map((l) => l[0]).join(" "));
	}

	// A key while typing in the console
	function typingKey(action) {
		if (action.type === "char") { if (input.length < INPUT_MAX) { input += action.char; } }
		else if (action.type === "erase") { input = input.slice(0, -1); }
		else if (action.type === "cancel") { // CONTROL + C: THE LINE IS DROPPED & A QUESTION WAITING FOR ITS ANSWER WITH IT. WHAT WAS TYPED STAYS IN THE CONSOLE AS A LINE (NO ^C), KEPT UNTIL CLEARED
			if (input) {
				term.lines = [...term.lines, ["> " + input, "dim"]].slice(-LINES_MAX);
				save();
			}
			input = "";
			cmd.confirm = null;
			say("Cancelled.");
		}
		else if (action.type === "move") { focusOn("tab:session"); }
		else { runInput(); }
		show();
		return true;
	}

	return Object.assign(monitor, {
		handlers,

		/**
		 * @description Takes new game data (never changed here)
		 * @param  {[object]} next [the game data d]
		 */
		update(next) {
			const prev = data;
			const d = next || {};
			data = d;
			let changed = false;
			if (!prev) {
				if (phase) { phaseAt = now(); } // THE START'S CLOCK RUNS FROM THE FIRST DATA
				if (!term.lines.length) {
					term.lines = [HINT];
					changed = true;
				}
				if ((term.gameId ?? null) !== (d.gameId ?? null)) {
					record("New session opened.", "ink", null);
					term.gameId = d.gameId ?? null;
					changed = true;
				}
				movedAt = now();
			} else {
				for (const e of eventsFrom(prev, d)) {
					record(e.text, e.tone, e.mail);
					say(e.text);
					changed = true;
				}
				if (prev.gameId !== d.gameId) {
					term.gameId = d.gameId ?? null;
					cmd.confirm = null;
					changed = true;
				}
				if (plies(prev).length !== plies(d).length) { movedAt = now(); }
				if (prev.offline && !d.offline) { onlineAt = now(); }
			}
			if (d.offline && !(prev && prev.offline)) {
				if (!prev) { record("Line fault.", "hot", "fault"); } // LATER DROPS COME THROUGH eventsFrom
				term.lines = [HINT];
				input = "";
				cmd.confirm = null;
				drag = null; // THIS UPDATE'S SAVE KEEPS THE DRAG SO FAR
				raised = false;
				phase = "fault";
				phaseAt = now();
				changed = true;
			}
			if (changed) { save(); }
			show();
		},

		/**
		 * @description Starts zooming in from the desk
		 */
		enter() {
			if (monitor.state !== "idle" || !data) { return; }
			monitor.state = "zooming";
			if (reduce()) { monitor.arrived(); return; }
			show();
		},

		/**
		 * @description The camera reached the glass
		 */
		arrived() {
			if (monitor.state !== "zooming") { return; }
			advance();
			monitor.state = "zoomed";
			const L = frontLayout();
			if (L) {
				focus = home();
				say(`${NAMES[L.id]} window. ${SCREEN[L.id].speak(L.v)}`);
			} else { focusOn(home()); }
			show();
		},

		/**
		 * @description Starts going back to the desk; harmless when already leaving or idle
		 */
		leave() {
			if (monitor.state !== "zoomed" && monitor.state !== "zooming") { return; }
			if (reduce()) { toIdle(); return; }
			monitor.state = "leaving";
			up();
			focus = hover = at = null;
			cmd.confirm = null;
			show();
		},

		/**
		 * @description The camera is back at the desk
		 */
		left() {
			if (monitor.state === "leaving") { toIdle(); }
		},

		/**
		 * @description Straight to idle, e.g. when the GL context is lost
		 */
		reset() { toIdle(); },

		/**
		 * @description A pointer on the glass
		 * @param  {[string]} kind [move, out, press (a tap), down, drag, up or wheel]
		 * @param  {[number]} x [grid pixels]
		 * @param  {[number]} y
		 * @param  {[object]} [extra] [wheel: { dx, dy } in grid pixels]
		 * @return {[string|null]} zoom when the caller should zoom in (it calls enter()), leave when the press made the monitor leave
		 * (leave() already ran), else null
		 */
		pointer(kind, x, y, extra) {
			advance();
			repair();
			if (kind === "out") {
				if (hover !== null || at !== null) { hover = at = null; show(); }
				return null;
			}
			if (kind === "up") { up(); return null; } // IN ANY STATE OR PHASE, SO NO DRAG OUTLIVES ITS PRESS
			if (monitor.state === "idle") { return kind === "press" && data ? "zoom" : null; }
			if (!zoomedNow()) { return null; }
			if (kind === "move") {
				const id = hoverAt(x, y);
				if (at && at.x === x && at.y === y && id === hover) { return null; }
				keys = false;
				at = { x, y };
				hover = id;
				show();
				return null;
			}
			if (phase) { up(); return null; }
			if (kind === "down" || kind === "press") { keys = false; }
			if (kind === "down") { down(x, y); show(); return null; }
			if (kind === "drag") { if (drag) { dragTo(x, y); show(); } return null; }
			if (kind === "wheel") {
				const w = winAt(term.wins, x, y), e = extra || {};
				if (w) {
					const { p } = layout(winOf(w.id));
					if (scrollTo(w.id, { x: p.scroll.x + (Number(e.dx) || 0), y: p.scroll.y + (Number(e.dy) || 0) })) { show(); }
				}
				return null;
			}
			if (kind !== "press") { return null; }
			pressAt(x, y);
			show();
			return zoomedNow() ? null : "leave";
		},

		/**
		 * @description The keyboard's focus came to the screen or left it (the page's stop for the monitor). On the desk the glass
		 * shows it, view().deskFocus
		 * @param  {[boolean]} on
		 */
		deskFocus(on) {
			if (keyFocus === Boolean(on)) { return; }
			keyFocus = Boolean(on);
			show();
		},

		/**
		 * @description A key while zoomed, or Escape while zooming in
		 * @param  {[string]} key [KeyboardEvent.key]
		 * @param  {[boolean]} repeat [a held key; a held Enter runs nothing]
		 * @return {[boolean]} whether the monitor used it
		 */
		key(key, repeat = false) {
			advance();
			if (!zoomedNow() && monitor.state !== "zooming") { return false; }
			repair();
			if (key === "PageUp" || key === "PageDown") { // THE FRONT WINDOW, ONE PAGE, WHEN IT HAS A VERTICAL BAR
				const L = zoomedNow() && !phase ? frontLayout() : null;
				if (!L || !L.p.vbar) { return false; }
				scrollTo(L.id, { ...L.p.scroll, y: page(winOf(L.id), L.content, L.p.scroll, "y", key === "PageUp" ? -1 : 1) });
				show();
				return true;
			}
			const typing = focus === "console" && frontId() === "session";
			const action = keyAction(key, typing);
			if (!action) { return false; }
			if (action.type === "leave") { monitor.leave(); return true; }
			if (!zoomedNow() || phase) { return false; }
			keys = true;
			if (typing) { return action.type === "run" && repeat ? true : typingKey(action); }
			const all = allButtons();
			if (action.type === "move") {
				const to = nextFocus(all, focus, action.dir);
				if (to && to !== focus) { focusOn(to); show(); }
			} else if (action.type === "press") {
				const b = all.find((x) => x.id === focus);
				if (b && b.enabled) { activate(b.id); show(); }
			} else if (action.type === "tab") {
				tabPress(action.id);
				show();
			}
			return true;
		},

		/**
		 * @description What screen.js draws
		 * @return {[object]} { state, zoomed, phase ("fault", "splash" or null), elapsed (ms into the phase), tabs ({ ...tab, lit,
		 * selected }), wins (the shown windows back to front: { id, title, front, p (windows.js parts, with scroll & max), content, v }),
		 * buttons (the front window's, grid pixels, then win:close; none during a phase), focus, keys (the focus shows), hover, pointer ({ x, y } or
		 * null), deskFocus, input, v (the front window's screen data, else the base data) }
		 */
		view() {
			advance();
			repair();
			const zoomed = zoomedNow();
			const d = baseData();
			const wins = shown(term.wins).map((w) => layout(w, d));
			const f = wins.find((w) => w.front);
			return {
				state: monitor.state,
				zoomed,
				phase,
				elapsed: phase && phaseAt !== null ? now() - phaseAt : 0,
				lines: phase === "boot" ? bootLines(data) : [],
				tabs: tabs(),
				wins,
				buttons: f && !phase ? winButtons(f) : [],
				focus,
				keys, // WHETHER THE FOCUS SHOWS: A POINTER PRESS MOVES IT WITHOUT LIGHTING ANYTHING
				hover: zoomed ? hover : null,
				pointer: zoomed ? at : null,
				deskFocus: keyFocus && monitor.state === "idle",
				input,
				v: f ? f.v : d,
			};
		},
	});
}
