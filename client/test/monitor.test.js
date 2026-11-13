/*
 *  monitor.test.js  --  chess frontend tests
 *	The CRT monitor's state machine (client/src/js/gameplay/three/monitor/monitor.js): the tab row, hit testing, focus, keys, zoom maths & the screen reader text. Run with npm run test:client
 *
 */

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { ORDER, uvToGrid, available, idleChannel, tabButtons, hit, nextFocus, keyAction, zoomDistance, isTap, describe: say, createMonitor } = require("../src/js/gameplay/three/monitor/monitor.js");
const { defaults, CHANNELS } = require("../src/js/gameplay/three/monitor/prefs.js");
const { base, acts } = require("./helpers/monitorData.js");

function box(id, x, y, enabled = true) { return { id, x, y, w: 40, h: 12, label: id.toUpperCase(), enabled }; }
function centre(b) { return [b.x + b.w / 2, b.y + b.h / 2]; }

function make(overrides = {}) { // A MONITOR THAT RECORDS WHAT IT SHOWS, SAYS, WATCHES & SAVES
	const said = [], watched = [], saved = [];
	let shown = 0;
	const m = createMonitor({
		show: () => { shown++; },
		announce: (text) => said.push(text),
		handlers: { hint() {}, takeback() {}, draw() {}, restart() {}, pgn() {}, watchEval: (on) => watched.push(on) },
		loadPrefs: defaults,
		savePrefs: (prefs) => saved.push(prefs),
		reduce: () => false,
		...overrides,
	});
	return Object.assign(m, { said, watched, saved, shown: () => shown });
}

describe("monitor", () => {
	test("glass UV to grid pixel to button", () => {
		assert.deepEqual(uvToGrid(0, 0), { x: 0, y: 0 });
		assert.deepEqual(uvToGrid(0.5, 0.5), { x: 80, y: 60 });
		assert.deepEqual(uvToGrid(1, 1), { x: 159, y: 119 });
		assert.deepEqual(uvToGrid(-0.1, 1.2), { x: 0, y: 119 });
		const tabs = tabButtons(["face", "moves", "setup"]);
		const moves = tabs.find((b) => b.id === "tab:moves");
		const at = uvToGrid((moves.x + 1) / 160, (moves.y + 1) / 120);
		assert.equal(hit(tabs, at.x, at.y).id, "tab:moves");
	});
	test("the tab row fits inside the bezel's safe area for every set of channels", () => {
		for (let mask = 0; mask < 128; mask++) {
			const tabs = tabButtons(ORDER.filter((id, i) => mask & (1 << i)));
			for (const b of tabs) { assert.ok(b.x >= 8 && b.y >= 2 && b.x + b.w <= 152 && b.y + b.h <= 14, `${mask}: ${b.id} ${b.x},${b.y},${b.w},${b.h}`); }
			tabs.forEach((a, i) => { if (i) { assert.ok(tabs[i - 1].x + tabs[i - 1].w <= a.x, `${mask}: ${a.id} overlaps`); } });
		}
		assert.equal(tabButtons(["face", "setup"])[0].label, "◀ BACK");
		assert.equal(tabButtons(ORDER)[0].label, "◀");
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
	test("the arrow keys only work in TV mode", () => {
		assert.equal(keyAction("w", false), "up");
		assert.equal(keyAction("D", false), "right");
		assert.equal(keyAction("ArrowUp", false), null);
		assert.equal(keyAction("ArrowUp", true), "up");
		assert.equal(keyAction("Enter", false), "press");
		assert.equal(keyAction(" ", false), "press");
		assert.equal(keyAction("Escape", true), "leave");
		assert.equal(keyAction("x", false), null);
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
	test("channels a game doesn't have are never offered", () => {
		const friend = { ...base, ai: false, eval: { allowed: false, scores: [], failed: false } };
		assert.deepEqual(available(friend, defaults()), ["opponent", "moves", "waiting", "actions", "setup"]);
		assert.equal(idleChannel(friend, { ...defaults(), defaultChannel: "face" }), "opponent");
		assert.equal(idleChannel({ ...friend, yourTurn: false }, defaults()), "waiting");
		assert.deepEqual(available(friend, { ...defaults(), enabled: ["face", "setup"] }), ["setup"]);
		assert.equal(idleChannel(friend, { ...defaults(), enabled: ["face", "setup"] }), "setup");
		assert.equal(idleChannel(base, defaults()), "face");
	});
	test("the life of a zoom", () => {
		const m = make();
		m.update(base);
		assert.equal(m.pointer("press", 80, 60), "zoom");
		m.enter();
		assert.equal(m.state, "zooming");
		assert.equal(m.key("d"), false); // KEYS ONLY WHILE ZOOMED, BUT ESCAPE
		m.arrived();
		assert.equal(m.state, "zoomed");
		assert.equal(m.focus, "tab:face");
		assert.equal(m.key("d"), true);
		assert.equal(m.channel, "opponent");
		m.key("d");
		assert.equal(m.channel, "eval");
		assert.deepEqual(m.watched, [true]);
		m.key("Escape");
		assert.equal(m.state, "leaving");
		m.left();
		assert.equal(m.state, "idle");
		assert.equal(m.channel, "face");
		assert.deepEqual(m.watched, [true, false]);
	});
	test("reduced motion cuts both ways", () => {
		const m = make({ reduce: () => true });
		m.update(base);
		m.enter();
		assert.equal(m.state, "zoomed");
		assert.equal(m.view().burst, false);
		m.leave();
		assert.equal(m.state, "idle");
	});
	test("the screen reader hears the focused item, the channel and the banner", () => {
		const m = make();
		m.update({ ...base, yourTurn: false });
		m.enter(); m.arrived();
		m.key("d"); m.key("d");
		m.update({ ...base, yourTurn: true });
		assert.ok(m.said.includes("Evaluation channel. White's win chance 61 percent"));
		assert.ok(m.said.some((text) => /^Evaluation, tab, 3 of 7, selected$/.test(text)));
		assert.ok(m.said.includes("Your move"));
		assert.equal(m.view().banner, "▶ YOUR MOVE");
		m.update({ ...base, yourTurn: true, moves: [...base.moves.slice(0, 2), { number: 3, white: "Bb5", black: "a6" }] });
		assert.equal(m.said.filter((text) => text === "Your move").length, 1); // ONCE, NOT ON EVERY UPDATE
	});
	test("arriving says the channel and what it shows", () => {
		const m = make();
		m.update(base);
		m.enter(); m.arrived();
		assert.ok(m.said.includes("Face channel. Bob, your move"));
		assert.equal(m.said.at(-1), "Face, tab, 1 of 7, selected");
	});
	test("a change to what the showing channel says is announced once per change", () => {
		const m = make();
		m.update(base);
		m.enter(); m.arrived();
		m.handlers.tab("moves");
		assert.ok(m.said.includes("Moves channel. C60 Ruy Lopez. Last move 3. Bb5"));
		const before = m.said.length;
		const next = { ...base, moves: [...base.moves.slice(0, 2), { number: 3, white: "Bb5", black: "a6" }] };
		m.update(next);
		assert.deepEqual(m.said.slice(before), ["C60 Ruy Lopez. Last move 3. a6"]);
		m.update({ ...next });
		assert.equal(m.said.length, before + 1); // THE SAME DATA AGAIN SAYS NOTHING
	});
	test("Escape while zooming in goes back", () => {
		const m = make();
		m.update(base);
		m.enter();
		assert.equal(m.key("w"), false);
		assert.equal(m.key("Escape"), true);
		assert.equal(m.state, "leaving");
	});
	test("moves: W and S scroll from its buttons, W at the top goes to the tabs, S at the bottom does nothing", () => {
		const m = make();
		const many = Array.from({ length: 12 }, (_, i) => ({ number: i + 1, white: "e4", black: "e5" }));
		m.update({ ...base, moves: many });
		m.enter(); m.arrived();
		m.handlers.tab("moves");
		m.key("s");
		assert.ok(["up", "down", "live"].includes(m.focus)); // INTO THE BUTTONS AS ON ANY CHANNEL
		const focus = m.focus;
		const top = () => m.view().data.ui.top;
		m.key("s");
		assert.equal(top(), undefined); // THE BOTTOM ALREADY
		assert.equal(m.focus, focus);
		m.key("w"); m.key("w"); m.key("w");
		assert.equal(top(), 0);
		assert.equal(m.focus, focus);
		m.key("s");
		assert.equal(top(), 1);
		m.key("w"); m.key("w");
		assert.equal(m.focus, "tab:moves");
		m.key("d");
		assert.equal(m.channel, "waiting"); // A/D ON THE TABS STILL CHANGE CHANNEL
	});
	test("an action that goes away greys out and cancels its prompt, a lost context goes back to idle", () => {
		const m = make();
		m.update(base);
		m.enter(); m.arrived();
		m.pointer("press", ...centre(m.view().tabs.find((b) => b.id === "tab:actions")));
		m.pointer("press", ...centre(m.view().buttons.find((b) => b.id === "draw")));
		assert.deepEqual(m.view().buttons.map((b) => b.id), ["yes", "no"]);
		m.update({ ...base, actions: acts({ hint: [true, true], takeback: [true, true], draw: [false, false] }) });
		assert.deepEqual(m.view().buttons.map((b) => [b.id, b.enabled]), [["hint", true], ["takeback", true], ["draw", false]]);
		m.reset();
		assert.equal(m.state, "idle");
	});
	test("the game ending while zoomed shows the result", () => {
		const m = make();
		m.update(base);
		m.enter(); m.arrived();
		m.update({ ...base, over: true, result: "WHITE WINS! BY CHECKMATE", actions: acts({ restart: [true, true], pgn: [true, true] }) });
		assert.equal(m.channel, "actions"); // THE RESULT, RESTART & DOWNLOAD PGN
		assert.equal(m.view().banner, null);
		assert.equal(m.state, "zoomed");
		assert.equal(m.focus, "restart");
		assert.ok(m.said.some((text) => text.includes("White wins! By checkmate")));
	});
	test("a game that ends during the zoom-in lands on the actions channel", () => {
		const m = make();
		m.update(base);
		m.enter();
		m.update({ ...base, over: true, result: "WHITE WINS! BY CHECKMATE", actions: acts({ restart: [true, true], pgn: [true, true] }) });
		assert.equal(m.state, "zooming");
		m.arrived();
		assert.equal(m.channel, "actions"); // THE SAME AS ENDING WHILE ZOOMED
		assert.equal(m.focus, "restart");
		assert.ok(m.said.some((text) => text.includes("White wins! By checkmate")));
	});
	test("a zoom-in that turns back forgets the game that ended during it", () => {
		const m = make();
		m.update(base);
		m.enter();
		m.update({ ...base, over: true, result: "DRAW", actions: acts({ restart: [true, true], pgn: [true, true] }) });
		m.leave(); m.left();
		m.enter(); m.arrived();
		assert.notEqual(m.focus, "restart"); // ALREADY OVER WHEN ZOOMING IN: THE DEFAULT CHANNEL, AS BEFORE
	});
	test("the game ending with the actions channel off stays put and says the result", () => {
		const m = make({ loadPrefs: () => ({ ...defaults(), enabled: CHANNELS.filter((id) => id !== "actions") }) });
		m.update(base);
		m.enter(); m.arrived();
		m.update({ ...base, over: true, result: "DRAW BY STALEMATE", actions: acts({ restart: [true, true], pgn: [true, true] }) });
		assert.equal(m.channel, "face");
		assert.equal(m.view().banner, null);
		assert.equal(m.said.at(-1), "Draw by stalemate");
	});
	test("turning the showing channel off in setup lands on setup", () => {
		const m = make();
		m.update(base);
		m.enter(); m.arrived();
		m.handlers.tab("moves");
		m.handlers.prefs({ enabled: ["face", "setup"] });
		assert.equal(m.channel, "setup");
		assert.deepEqual(m.saved.at(-1).enabled, ["face", "setup"]);
	});
	test("buttons are spoken with their place and state", () => {
		const own = [box("hint", 0, 20), { ...box("takeback", 0, 40), label: "TAKEBACK" }, box("draw", 0, 60, false), box("x", 0, 80)];
		assert.equal(say(own[1], own), "Takeback, button, 2 of 4");
		assert.equal(say(own[2], own), "Draw, button, 3 of 4, unavailable");
		const tabs = tabButtons(["face", "opponent", "moves", "setup"], "moves");
		assert.equal(say(tabs[0], tabs), "Back, button");
		assert.equal(say(tabs[3], [...tabs, ...own]), "Moves, tab, 3 of 4, selected");
	});
	test("a switch bursts for one draw, BACK leaves, and every change is shown", () => {
		const m = make();
		m.update(base);
		m.enter(); m.arrived();
		const before = m.shown();
		m.key("d");
		assert.ok(m.shown() > before);
		assert.equal(m.view().burst, true);
		assert.equal(m.view().burst, false);
		assert.equal(m.pointer("press", ...centre(m.view().tabs[0])), "leave");
		assert.equal(m.state, "leaving");
		assert.equal(m.view().banner, null);
	});
	test("from BACK, D lands on the showing tab and says so", () => {
		const m = make();
		m.update(base);
		m.enter(); m.arrived();
		m.key("a");
		assert.equal(m.focus, "back");
		assert.equal(m.said.at(-1), "Back, button");
		m.key("d");
		assert.equal(m.focus, "tab:face");
		assert.equal(m.channel, "face");
		assert.equal(m.said.at(-1), "Face, tab, 1 of 7, selected");
	});
	test("on the desk the hover is the pointer's third of the glass, shown only when it changes", () => {
		const m = make();
		m.update(base);
		let before = m.shown();
		m.pointer("move", 10, 40);
		assert.deepEqual(m.hover, { x: 27, y: 60 });
		assert.equal(m.shown(), before + 1);
		before = m.shown();
		m.pointer("move", 20, 90);
		assert.deepEqual(m.hover, { x: 27, y: 60 });
		assert.equal(m.shown(), before); // SAME THIRD, NO REDRAW
		m.pointer("move", 90, 10);
		assert.deepEqual(m.hover, { x: 80, y: 60 });
		m.pointer("move", 150, 110);
		assert.deepEqual(m.hover, { x: 133, y: 60 });
		assert.deepEqual(m.view().hover, { x: 133, y: 60 });
		before = m.shown();
		m.pointer("out");
		assert.equal(m.hover, null);
		assert.equal(m.shown(), before + 1);
	});
	test("ORDER is a copy of the settings' channel list", () => {
		assert.deepEqual(ORDER, CHANNELS);
		assert.notEqual(ORDER, CHANNELS);
	});
});
