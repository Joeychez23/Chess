/*
 *  monitorChannels.test.js  --  chess frontend tests
 *	The CRT monitor's channels (client/src/js/gameplay/three/monitor/channels) drawn on a recording context. Run with npm run test:client
 *
 */

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { W, H, SAFE, TUBE, TEXT, DIM, body, drawText } = require("../src/js/gameplay/three/monitor/kit.js");
const { CHANNEL, NAMES, SHORT } = require("../src/js/gameplay/three/monitor/channels/index.js");
const { topFor } = require("../src/js/gameplay/three/monitor/channels/moves.js");
const { points } = require("../src/js/gameplay/three/monitor/channels/eval.js");
const { caption } = require("../src/js/gameplay/three/monitor/channels/waiting.js");
const { resultLines } = require("../src/js/gameplay/three/monitor/channels/actions.js");
const { status } = require("../src/js/gameplay/three/monitor/channels/opponent.js");
const { defaults } = require("../src/js/gameplay/three/monitor/prefs.js");
const { base, acts } = require("./helpers/monitorData.js");

function rows(n) { return Array.from({ length: n }, (_, i) => ({ number: i + 1, white: "e4", black: "e5" })); }
const SAFE_BODY = { x: 8, y: 14, w: 144, h: 102 }; // THE ZOOMED BODY THE BEZEL LEAVES VISIBLE
function inside(r, zoomed) { // A RECT (x, y, w, h) INSIDE THE WHOLE GRID ON THE DESK, INSIDE THE SAFE BODY WHEN ZOOMED
	const a = zoomed ? SAFE_BODY : { x: 0, y: 0, w: W, h: H };
	return r.x >= a.x && r.y >= a.y && r.x + r.w <= a.x + a.w && r.y + r.h <= a.y + a.h;
}
function enabled(buttons) { return Object.fromEntries(buttons.map((b) => [b.id, b.enabled])); }

function fakeCtx() { // RECORDS fillRect & drawImage, ENOUGH TO CHECK WHAT WAS DRAWN WHERE
	const calls = [];
	return { calls, fillStyle: "", fillRect(x, y, w, h) { calls.push(["rect", this.fillStyle, x, y, w, h]); }, drawImage(...a) { calls.push(["image", ...a]); }, clearRect() {}, save() {}, restore() {}, beginPath() {}, rect() {}, clip() {} };
}

describe("monitor channels", () => {
	test("names and short names list all seven channels", () => {
		assert.deepEqual(Object.keys(NAMES), ["face", "opponent", "eval", "moves", "waiting", "actions", "setup"]);
		assert.deepEqual(Object.keys(SHORT), Object.keys(NAMES));
	});

	test("face and opponent have no buttons, zoomed or not", () => {
		for (const zoomed of [false, true]) {
			assert.deepEqual(CHANNEL.face.buttons({ ...base, zoomed }), []);
			assert.deepEqual(CHANNEL.opponent.buttons({ ...base, zoomed }), []);
		}
	});

	test("the safe area: the zoomed body is inside the bezel, the desk keeps the whole grid", () => {
		assert.deepEqual(SAFE, { left: 8, right: 8, top: 2, bottom: 4 });
		assert.deepEqual(body({ zoomed: true }), SAFE_BODY);
		assert.deepEqual(body({ zoomed: false }), { x: 0, y: 0, w: W, h: H });
	});

	// DATA WHERE EVERY CHANNEL THAT CAN HAVE BUTTONS HAS THEM: 20 MOVE ROWS, ALL ACTIONS, THE SETTINGS, THE DRAW PROMPT, A FINISHED GAME, THE TEST CARD
	const FULL = [
		{ ...base, moves: rows(20) },
		{ ...base, moves: rows(20), ui: { top: 0 } },
		{ ...base, ui: { confirm: "draw" } },
		{ ...base, over: true, result: "WHITE WINS! BY CHECKMATE", actions: acts({ restart: [true, true], pgn: [true, true] }) },
		{ ...base, over: true, result: "DRAW BY THREEFOLD REPETITION", actions: acts({ restart: [true, true], pgn: [true, true] }) },
		{ ...base, over: true, result: "WHITE FORFEITS", actions: acts({ restart: [true, true], pgn: [true, true] }) },
		{ ...base, screen: { ...base.screen, picture: {} } },
		{ ...base, ai: false, yourTurn: false, opening: { eco: "A30", name: "English Opening: Symmetrical Variation, Hedgehog Defence" } },
		{ ...base, prefs: { ...defaults(), defaultChannel: "eval" } },
		{ ...base, prefs: { ...defaults(), defaultChannel: "moves", idle: "pipes" } },
		{ ...base, screen: { ...base.screen, bars: true } },
		{ ...base, moves: [], eval: { allowed: true, scores: [], failed: true } },
		{ ...base, moves: [], eval: { allowed: true, scores: [], failed: false } },
	];

	test("every draw stays on the grid on the desk, and inside the safe body when zoomed", () => {
		for (const id of Object.keys(CHANNEL)) {
			for (const zoomed of [false, true]) {
				for (const data of FULL) {
					const ctx = fakeCtx();
					CHANNEL[id].draw(ctx, { ...data, zoomed });
					for (const [kind, , x, y, w, h] of ctx.calls.filter((c) => c[0] === "rect")) {
						assert.ok(inside({ x, y, w, h }, zoomed), `${id} ${zoomed} ${kind} ${x},${y},${w},${h}`);
					}
				}
			}
		}
	});

	test("every zoomed button is inside the safe body, 1 px clear of its edges, and none overlap", () => {
		const clear = { x: SAFE_BODY.x + 1, y: SAFE_BODY.y + 1, w: SAFE_BODY.w - 2, h: SAFE_BODY.h - 2 };
		for (const id of Object.keys(CHANNEL)) {
			for (const data of FULL) {
				const buttons = CHANNEL[id].buttons({ ...data, zoomed: true });
				for (const b of buttons) { assert.ok(b.x >= clear.x && b.y >= clear.y && b.x + b.w <= clear.x + clear.w && b.y + b.h <= clear.y + clear.h, `${id} ${b.id} ${b.x},${b.y},${b.w},${b.h}`); }
				for (const a of buttons) { for (const b of buttons) { if (a !== b) { assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${id} ${a.id} over ${b.id}`); } } }
			}
		}
	});

	test("zoomed text never runs into a button", () => {
		for (const id of Object.keys(CHANNEL)) {
			for (const data of FULL) {
				const d = { ...data, zoomed: true };
				const buttons = CHANNEL[id].buttons(d);
				const ctx = fakeCtx();
				CHANNEL[id].draw(ctx, d);
				for (const [, , x, y] of ctx.calls.filter((c) => c[0] === "rect" && c[4] === 1 && c[5] === 1)) { // TEXT IS DRAWN A CELL AT A TIME
					for (const b of buttons) { assert.ok(!(x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h), `${id} text at ${x},${y} inside ${b.id}`); }
				}
			}
		}
	});

	test("the opponent card draws the picture when there is one", () => {
		const ctx = fakeCtx();
		const picture = {};
		CHANNEL.opponent.draw(ctx, { ...base, screen: { ...base.screen, picture } });
		assert.ok(ctx.calls.some((c) => c[0] === "image" && c[1] === picture));
	});

	test("moves: the newest rows show until the player scrolls", () => {
		const data = { ...base, zoomed: true, moves: rows(20), ui: {} };
		assert.equal(topFor(data), 11);
		assert.deepEqual(enabled(CHANNEL.moves.buttons(data)), { up: true, down: false, live: false });
	});

	test("moves: scrolled to the top, up is off and live is on", () => {
		const data = { ...base, zoomed: true, moves: rows(20), ui: { top: 0 } };
		assert.deepEqual(enabled(CHANNEL.moves.buttons(data)), { up: false, down: true, live: true });
	});

	test("moves: a takeback or restart that shortens the game clamps the scroll", () => {
		assert.equal(topFor({ ...base, zoomed: true, moves: rows(3), ui: { top: 15 } }), 0);
	});

	test("moves: up, down and live patch the scroll", () => {
		const patches = [];
		const handlers = { ui: (patch) => patches.push(patch) };
		const data = { ...base, zoomed: true, moves: rows(20), ui: { top: 5 } };
		CHANNEL.moves.press("up", handlers, data);
		CHANNEL.moves.press("down", handlers, data);
		CHANNEL.moves.press("live", handlers, data);
		assert.deepEqual(patches, [{ top: 4 }, { top: 6 }, { top: undefined }]);
	});

	test("moves: no buttons on the desk", () => {
		assert.deepEqual(CHANNEL.moves.buttons({ ...base, zoomed: false }), []);
	});

	test("moves: the buttons share one row along the bottom of the body", () => {
		const buttons = CHANNEL.moves.buttons({ ...base, zoomed: true, moves: rows(20) });
		assert.equal(new Set(buttons.map((b) => b.y)).size, 1);
		for (const b of buttons) { assert.ok(inside(b, true), b.id); }
	});

	test("eval: a move with no score is a gap", () => {
		assert.deepEqual(points([50, null, 100, 0], 40, 21), [{ x: 0, y: 10 }, null, { x: 26, y: 0 }, { x: 39, y: 20 }]);
	});

	test("eval: static only ticks when the request failed and motion is allowed", () => {
		assert.equal(CHANNEL.eval.tick({ ...base, eval: { allowed: true, scores: [], failed: true }, reduce: false }), 120);
		assert.equal(CHANNEL.eval.tick({ ...base, eval: { allowed: true, scores: [], failed: true }, reduce: true }), null);
		assert.equal(CHANNEL.eval.tick(base), null);
	});

	test("eval: no data, no signal and a graph all draw", () => {
		for (const ev of [{ allowed: true, scores: [], failed: false }, { allowed: true, scores: [], failed: true }, base.eval]) {
			const ctx = fakeCtx();
			CHANNEL.eval.draw(ctx, { ...base, eval: ev, zoomed: true });
			assert.ok(ctx.calls.length > 0);
		}
	});

	test("actions: only what the menu shows, in the menu's state", () => {
		const data = { ...base, zoomed: true, actions: acts({ hint: [true, true], takeback: [true, false], draw: [false, false] }), ui: {} };
		assert.deepEqual(CHANNEL.actions.buttons(data).map((b) => [b.id, b.enabled]), [["hint", true], ["takeback", false]]);
	});

	test("actions: one that goes away while the channel is open greys out in place", () => {
		const ui = { slots: ["hint", "takeback", "draw"] };
		const data = { ...base, zoomed: true, actions: acts({ hint: [true, true], takeback: [false, false], draw: [true, true] }), ui };
		assert.deepEqual(CHANNEL.actions.buttons(data).map((b) => [b.id, b.enabled]), [["hint", true], ["takeback", false], ["draw", true]]);
	});

	test("actions: after the game, restart and pgn", () => {
		const data = { ...base, zoomed: true, over: true, result: "DRAW", actions: acts({ restart: [true, true], pgn: [true, true] }), ui: {} };
		assert.deepEqual(CHANNEL.actions.buttons(data).map((b) => b.id), ["restart", "pgn"]);
	});

	test("actions: offer draw asks first, yes offers, no doesn't", () => {
		const calls = [];
		const handlers = { draw: () => calls.push("draw"), ui: (patch) => calls.push(patch) };
		const data = { ...base, zoomed: true, ui: {} };
		CHANNEL.actions.press("draw", handlers, data);
		assert.deepEqual(calls, [{ confirm: "draw" }]);
		const asking = { ...data, ui: { confirm: "draw" } };
		assert.deepEqual(CHANNEL.actions.buttons(asking).map((b) => b.id), ["yes", "no"]);
		CHANNEL.actions.press("no", handlers, asking);
		CHANNEL.actions.press("yes", handlers, asking);
		assert.deepEqual(calls.slice(1), [{ confirm: null }, "draw", { confirm: null }]);
	});

	test("actions: a prompt whose action went away is cancelled", () => {
		const data = { ...base, zoomed: true, actions: acts({ hint: [true, true], draw: [false, false] }), ui: { confirm: "draw", slots: ["hint", "draw"] } };
		assert.deepEqual(CHANNEL.actions.buttons(data).map((b) => b.id), ["hint", "draw"]);
		const calls = [];
		CHANNEL.actions.press("yes", { draw: () => calls.push("draw"), ui: (patch) => calls.push(patch) }, data);
		assert.deepEqual(calls, [{ confirm: null }]); // THE STALE PROMPT IS CLEARED, THE DRAW IS NOT OFFERED
	});

	test("actions: a disabled button doesn't run", () => {
		const calls = [];
		const data = { ...base, zoomed: true, actions: acts({ takeback: [true, false] }), ui: {} };
		CHANNEL.actions.press("takeback", { takeback: () => calls.push("takeback") }, data);
		assert.deepEqual(calls, []);
	});

	test("each action button calls its own handler", () => {
		for (const id of ["hint", "takeback", "restart", "pgn"]) {
			const calls = [];
			const data = { ...base, zoomed: true, over: id === "restart" || id === "pgn", actions: acts({ [id]: [true, true] }), ui: {} };
			CHANNEL.actions.press(id, { [id]: () => calls.push(id) }, data);
			assert.deepEqual(calls, [id]);
		}
	});

	test("actions: no buttons on the desk", () => {
		assert.deepEqual(CHANNEL.actions.buttons({ ...base, zoomed: false }), []);
	});

	test("setup: face and setup can't be turned off, the rest toggle", () => {
		const patches = [];
		const data = { ...base, zoomed: true, prefs: defaults(), ui: {} };
		const buttons = CHANNEL.setup.buttons(data);
		assert.equal(buttons.find((b) => b.id === "toggle:face").enabled, false);
		assert.equal(buttons.find((b) => b.id === "toggle:setup").enabled, false);
		CHANNEL.setup.press("toggle:face", { prefs: (p) => patches.push(p) }, data);
		CHANNEL.setup.press("toggle:moves", { prefs: (p) => patches.push(p) }, data);
		assert.deepEqual(patches, [{ enabled: ["face", "opponent", "eval", "waiting", "actions", "setup"] }]);
	});

	test("setup: default marks one channel, pressing it again clears it", () => {
		const patches = [];
		const handlers = { prefs: (p) => patches.push(p) };
		CHANNEL.setup.press("default:moves", handlers, { ...base, prefs: defaults() });
		CHANNEL.setup.press("default:moves", handlers, { ...base, prefs: { ...defaults(), defaultChannel: "moves" } });
		assert.deepEqual(patches, [{ defaultChannel: "moves" }, { defaultChannel: null }]);
	});

	test("setup: every button fits the body and none overlap", () => {
		const buttons = CHANNEL.setup.buttons({ ...base, zoomed: true, prefs: defaults(), ui: {} });
		for (const b of buttons) { assert.ok(inside(b, true), b.id); }
		for (const a of buttons) { for (const b of buttons) { if (a !== b) { assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${a.id} over ${b.id}`); } } }
	});

	test("setup: the idle buttons and the labels", () => {
		const buttons = CHANNEL.setup.buttons({ ...base, zoomed: true, prefs: defaults(), ui: {} });
		assert.deepEqual(buttons.filter((b) => b.id.startsWith("idle:")).map((b) => b.label), ["CARD", "STARS", "PIPES"]);
		assert.equal(buttons.find((b) => b.id === "toggle:moves").label, "ON");
		assert.equal(buttons.find((b) => b.id === "default:moves").label, "DEF");
	});

	test("waiting: stars and pipes stay on the grid, repeat per frame, and tick", () => {
		for (const idle of ["stars", "pipes"]) {
			for (const zoomed of [false, true]) {
				for (const frame of [0, 1, 7, 159, 160, 161, 399, 100000]) {
					const data = { ...base, zoomed, frame, prefs: { ...defaults(), idle } };
					const a = fakeCtx(), b = fakeCtx();
					CHANNEL.waiting.draw(a, data);
					CHANNEL.waiting.draw(b, data);
					assert.deepEqual(a.calls, b.calls, `${idle} frame ${frame}`);
					for (const [, , x, y, w, h] of a.calls) {
						assert.ok(inside({ x, y, w, h }, zoomed), `${idle} ${zoomed} ${frame} ${x},${y},${w},${h}`);
					}
				}
			}
		}
		assert.equal(CHANNEL.waiting.tick({ ...base, prefs: { ...defaults(), idle: "pipes" } }), 120);
	});

	test("waiting: the caption follows the game, and a still screen doesn't tick", () => {
		assert.equal(caption({ ...base, ai: false, yourTurn: false }), "WAITING FOR OPPONENT");
		assert.equal(caption({ ...base, over: true, result: "DRAW" }), "DRAW");
		assert.equal(CHANNEL.waiting.tick({ ...base, prefs: { ...defaults(), idle: "stars" }, reduce: true }), null);
		assert.equal(CHANNEL.waiting.tick({ ...base, prefs: { ...defaults(), idle: "card" } }), null);
		assert.equal(CHANNEL.waiting.tick({ ...base, prefs: { ...defaults(), idle: "stars" } }), 80);
	});

	test("actions: a long result wraps onto two whole lines at a space, a short one stays on one", () => {
		assert.deepEqual(resultLines("WHITE WINS! BY CHECKMATE", 136), ["WHITE WINS!", "BY CHECKMATE"]);
		assert.deepEqual(resultLines("DRAW BY THREEFOLD REPETITION", 136), ["DRAW BY THREEFOLD", "REPETITION"]);
		assert.deepEqual(resultLines("WHITE FORFEITS", 136), ["WHITE FORFEITS"]);
	});

	test("actions: the draw prompt asks SURE?", () => {
		const data = { ...base, zoomed: true, ui: { confirm: "draw" } };
		const ctx = fakeCtx(), want = fakeCtx();
		CHANNEL.actions.draw(ctx, data);
		const area = body(data);
		drawText(want, "SURE?", area.x + area.w / 2, area.y + 28, TEXT, 0);
		assert.deepEqual(ctx.calls, want.calls);
	});

	test("opponent: zoomed with a picture, the name and status sit on a dark plate along the body's bottom", () => {
		for (const id of ["opponent", "face"]) {
			const ctx = fakeCtx();
			CHANNEL[id].draw(ctx, { ...base, zoomed: true, screen: { ...base.screen, picture: {} } });
			const plate = ctx.calls.find((c) => c[0] === "rect" && c[1] === TUBE && c[2] === SAFE_BODY.x && c[4] === SAFE_BODY.w);
			assert.ok(plate, id);
			assert.equal(plate[3] + plate[5], SAFE_BODY.y + SAFE_BODY.h, id);
			assert.ok(ctx.calls.some((c) => c[0] === "rect" && c[1] === TEXT && c[3] > plate[3]), `${id}: the name`);
		}
	});

	test("opponent: a friend's card reads WAITING FOR OPPONENT on their turn", () => {
		assert.equal(status({ ...base, ai: false, yourTurn: false }), "WAITING FOR OPPONENT");
		assert.equal(status({ ...base, ai: false, yourTurn: true }), "your move");
		assert.equal(status({ ...base, ai: false, yourTurn: false, over: true }), "your move");
		assert.equal(status({ ...base, ai: true, yourTurn: false }), "your move");
	});

	test("waiting: under reduced motion the pipes are a still picture, not an empty screen", () => {
		const ctx = fakeCtx();
		CHANNEL.waiting.draw(ctx, { ...base, zoomed: true, frame: 0, reduce: true, prefs: { ...defaults(), idle: "pipes" } });
		assert.ok(ctx.calls.filter((c) => c[1] === DIM).length >= 20);
	});

	test("moves: DOWN onto the newest row follows new moves again", () => {
		const patches = [];
		CHANNEL.moves.press("down", { ui: (patch) => patches.push(patch) }, { ...base, zoomed: true, moves: rows(20), ui: { top: 10 } });
		assert.deepEqual(patches, [{ top: undefined }]);
	});

	test("moves: W and S scroll from the channel's buttons, W at the top and A/D are left to the monitor", () => {
		const patches = [];
		const handlers = { ui: (patch) => patches.push(patch) };
		const at = (top) => ({ ...base, zoomed: true, moves: rows(20), ui: { top } });
		assert.equal(CHANNEL.moves.keys("up", at(5), handlers), true);
		assert.equal(CHANNEL.moves.keys("down", at(5), handlers), true);
		assert.equal(CHANNEL.moves.keys("up", at(0), handlers), false); // FOCUS GOES UP TO THE TABS
		assert.equal(CHANNEL.moves.keys("down", at(undefined), handlers), true); // THE BOTTOM: NOTHING, BUT HANDLED
		assert.equal(CHANNEL.moves.keys("left", at(5), handlers), false);
		assert.equal(CHANNEL.moves.keys("right", at(5), handlers), false);
		assert.deepEqual(patches, [{ top: 4 }, { top: 6 }]);
	});

	test("every channel speaks its content", () => {
		const z = { ...base, zoomed: true };
		assert.equal(CHANNEL.face.speak(z), "Bob, your move");
		assert.equal(CHANNEL.face.speak({ ...z, screen: undefined }), "");
		assert.equal(CHANNEL.opponent.speak(z), "Bob, your move");
		assert.equal(CHANNEL.opponent.speak({ ...z, ai: false, yourTurn: false }), "Bob, waiting for opponent");
		assert.equal(CHANNEL.eval.speak(z), "White's win chance 61 percent");
		assert.equal(CHANNEL.eval.speak({ ...z, eval: { allowed: true, scores: [null], failed: false } }), "No evaluation yet");
		assert.equal(CHANNEL.eval.speak({ ...z, eval: { allowed: true, scores: [50], failed: true } }), "No signal");
		assert.equal(CHANNEL.moves.speak(z), "C60 Ruy Lopez. Last move 3. Bb5");
		assert.equal(CHANNEL.moves.speak({ ...z, moves: [], opening: null }), "No moves yet");
		assert.equal(CHANNEL.waiting.speak({ ...z, ai: false, yourTurn: false }), "Waiting for opponent");
		assert.equal(CHANNEL.actions.speak({ ...z, actions: acts({ hint: [true, true], takeback: [true, false], draw: [true, true] }) }), "Hint, Offer draw");
		assert.equal(CHANNEL.actions.speak({ ...z, over: true, result: "WHITE WINS! BY CHECKMATE", actions: acts({ restart: [true, true], pgn: [true, true] }) }), "White wins! By checkmate. Restart, Download pgn");
		assert.equal(CHANNEL.setup.speak(z), "Setup");
	});
});
