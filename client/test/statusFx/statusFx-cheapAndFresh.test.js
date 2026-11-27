// TASK 24: three/statusFx/index.js's shared cheap switch (decideCheap, opts.cheap, setBloom) and opts.fresh (true only for a status gained after the mount's first sync); three/index.js is test/helpers/threeStub.mjs, ../bloom.js a recording data: module, the effect modules spies
const { describe, test, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { registerHooks } = require("node:module");
const { pathToFileURL } = require("node:url");

const reduceMedia = { matches: false, addEventListener() {} };
let coarse = false; // THE PHONE PROFILE: (pointer: coarse)
global.window = { matchMedia: (q) => (q === "(pointer: coarse)" ? { matches: coarse } : reduceMedia) };
const ctx = new Proxy({}, { get: (o, k) => (k === "measureText" ? (t) => ({ width: String(t).length }) : k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
global.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx, setAttribute() {}, remove() {} }), body: { append() {} } }; // badges.js DRAWS ON A CANVAS
global.setInterval = () => ({});
global.clearInterval = () => {};
globalThis.__bloom = []; // EVERY setBloom(on)
const STUB = path.join(__dirname, "../helpers/threeStub.mjs");
const BLOOM = "data:text/javascript,export function setBloom(on) { globalThis.__bloom.push(on); } export function renderFrame() {}";
registerHooks({
	resolve(specifier, context, next) {
		if (context.parentURL && context.parentURL.includes("/three/statusFx/")) {
			if (specifier === "../index.js") { return { url: pathToFileURL(STUB).href, shortCircuit: true }; }
			if (specifier === "../bloom.js") { return { url: BLOOM, shortCircuit: true }; }
		}
		return next(specifier, context);
	},
});
const { Object3D, Group } = require("three");
const fx = require("../../src/js/gameplay/three/statusFx/index.js");
const board = require(STUB);

after(() => fx.clearStatuses());

describe("cheap switch", () => {
	let dts, moving;
	function spy() {
		return { create: () => ({ update(dt) { dts.push(dt); }, burst: () => 0, animating: () => moving, dispose() {} }) };
	}
	function setup() {
		const v = { pieces: new Map([["e2", new Object3D()], ["d4", new Object3D()]]), scene: new Group(), anims: new Set() };
		board.setView(v);
		const sq = Array(64).fill(null);
		sq[52] = { id: "p1", c: "w", t: "p" }; // e2
		sq[35] = { id: "p2", c: "w", t: "p" }; // d4
		return { you: "w", board: { sq }, statuses: { p1: [{ s: "warded", left: null }], p2: [{ s: "frozen", left: 2 }] } };
	}
	// FRAMES gap ms APART FOR ms MILLISECONDS FROM start
	function frames(start, gap, ms) {
		let t = start;
		for (; t <= start + ms; t += gap) { fx.stepStatuses(t); }
		return t;
	}
	const cheaps = () => fx.liveStatuses().map((l) => l.opts.cheap);

	beforeEach(() => {
		fx.clearStatuses();
		coarse = false;
		moving = true;
		dts = [];
		globalThis.__bloom.length = 0;
		for (const s of Object.keys(fx.MODULES)) { fx.MODULES[s] = spy(); }
	});

	test("decideCheap: on for the phone profile or a slow median frame, off otherwise", () => {
		assert.equal(fx.decideCheap({ coarse: true }), true);
		assert.equal(fx.decideCheap({ coarse: false }), false);
		assert.equal(fx.decideCheap({ coarse: false, frameMs: null }), false);
		assert.equal(fx.decideCheap({ coarse: false, frameMs: 34 }), false); // THE 30 FPS THE FRAME ASKS FOR
		assert.equal(fx.decideCheap({ coarse: false, frameMs: fx.SLOW_MS }), false); // THE BOUNDARY: SLOWER THAN, NOT AS SLOW AS
		assert.equal(fx.decideCheap({ coarse: false, frameMs: fx.SLOW_MS + 1 }), true);
		assert.equal(fx.decideCheap({ coarse: true, frameMs: 16 }), true);
	});

	test("desktop: every live status gets cheap false, bloom on once", () => {
		fx.syncStatuses(setup(), "effects");
		assert.deepEqual(cheaps(), [false, false]);
		assert.deepEqual(globalThis.__bloom, [true]);
	});

	test("phone: every live status gets cheap true, bloom off once, a later status too", () => {
		coarse = true;
		const v = setup();
		fx.syncStatuses({ ...v, statuses: { p1: v.statuses.p1 } }, "effects");
		fx.syncStatuses(v, "effects");
		assert.deepEqual(cheaps(), [true, true]);
		assert.deepEqual(globalThis.__bloom, [false]);
	});

	test("a burst still playing (an ending effect) hears the switch too: its opts.cheap turns true in place", () => {
		for (const s of Object.keys(fx.MODULES)) { fx.MODULES[s] = { create: () => ({ update() {}, burst: () => 20000, animating: () => true, dispose() {} }) }; }
		const v = setup();
		fx.syncStatuses(v, "effects");
		const gone = fx.liveStatuses().find((l) => l.opts.id === "p2").opts;
		fx.syncStatuses({ ...v, statuses: { p1: v.statuses.p1 } }, "effects"); // p2'S FROZEN ENDS: ITS BURST PLAYS ON
		assert.equal(fx.liveStatuses().length, 1);
		assert.equal(gone.cheap, false);
		frames(frames(0, 33, 3000), 80, 4500);
		assert.deepEqual(cheaps(), [true]);
		assert.equal(gone.cheap, true);
	});

	test("fast frames keep it off; a frame rate collapse over 2 s turns it on in place, with update(0), once", () => {
		fx.syncStatuses(setup(), "effects");
		const before = fx.liveStatuses().map((l) => l.opts);
		let t = frames(0, 33, 3000);
		assert.deepEqual(cheaps(), [false, false]);
		dts.length = 0;
		t = frames(t, 80, 4500); // A WINDOW THAT STRADDLES THE CHANGE MAY STILL READ FAST: THE NEXT FULL ONE DOESN'T
		assert.deepEqual(cheaps(), [true, true]);
		assert.deepEqual(fx.liveStatuses().map((l) => l.opts), before); // THE SAME opts OBJECTS
		assert.ok(dts.filter((d) => d === 0).length >= 2); // EACH LIVE EFFECT HEARD IT
		assert.deepEqual(globalThis.__bloom, [true, false]);
		frames(t, 16, 3000); // FAST AGAIN: ONCE CHEAP, CHEAP UNTIL THE NEXT MOUNT
		assert.deepEqual(cheaps(), [true, true]);
		assert.deepEqual(globalThis.__bloom, [true, false]);
	});

	test("frames while no effect animates are not timed (the board draws on demand)", () => {
		moving = false;
		fx.syncStatuses(setup(), "effects");
		frames(0, 500, 5000);
		assert.deepEqual(cheaps(), [false, false]);
	});

	test("clearStatuses (unmount) resets: the next mount decides again", () => {
		fx.syncStatuses(setup(), "effects");
		frames(0, 80, 2500);
		assert.deepEqual(cheaps(), [true, true]);
		fx.clearStatuses();
		globalThis.__bloom.length = 0;
		fx.syncStatuses(setup(), "effects");
		assert.deepEqual(cheaps(), [false, false]);
		assert.deepEqual(globalThis.__bloom, [true]);
	});

	test("a hidden tab's one long gap is not a frame rate (a stall over 1 s is skipped)", () => {
		fx.syncStatuses(setup(), "effects");
		fx.stepStatuses(0);
		fx.stepStatuses(33);
		const t = frames(60033, 33, 4000); // THE TAB WAS HIDDEN FOR A MINUTE, THEN 30 FPS
		assert.deepEqual(cheaps(), [false, false]);
		assert.deepEqual(globalThis.__bloom, [true]);
		frames(t, 80, 4500); // A REAL COLLAPSE STILL TURNS IT ON
		assert.deepEqual(cheaps(), [true, true]);
	});

	test("a hide restarts the window, so 4 janky frames right after the return don't decide it", () => {
		fx.syncStatuses(setup(), "effects");
		fx.stepStatuses(0); fx.stepStatuses(33); fx.stepStatuses(66); fx.stepStatuses(99);
		let t = 60099; fx.stepStatuses(t); // HIDDEN 60 s
		for (let k = 0; k < 4; k++) { t += 200; fx.stepStatuses(t); } // 4 JANK FRAMES
		frames(t + 33, 33, 4000);
		assert.deepEqual(cheaps(), [false, false]);
	});

	test("the idle time before the effects ask for frames again is not timed", () => {
		const v = setup();
		fx.syncStatuses(v, "effects");
		fx.stepStatuses(0);
		moving = false;
		fx.stepStatuses(33); // ONE TIMED FRAME, THE WINDOW OPEN, THEN THE TIMER STOPS
		fx.stepStatuses(5000); // ON-DEMAND FRAMES WHILE IDLE
		moving = true;
		fx.syncStatuses({ ...v, statuses: { p1: v.statuses.p1 } }, "effects"); // A NEW EFFECT STARTS THE TIMER 55 S LATER
		frames(60000, 33, 4000);
		assert.deepEqual(cheaps(), [false]);
		assert.deepEqual(globalThis.__bloom, [true]);
	});

	test("a full gap buffer does not jam the window (very fast frames, then a collapse)", () => {
		fx.syncStatuses(setup(), "effects");
		const t = frames(0, 2, 1200); // 600 FRAMES 2 ms APART: MORE THAN THE BUFFER HOLDS
		assert.deepEqual(cheaps(), [false, false]);
		frames(t, 100, 6000); // 10 FPS FOR 6 s
		assert.deepEqual(cheaps(), [true, true]);
	});

	test("a window decides from at least 8 gaps: two stalls under 1 s in a near-empty window are not a collapse", () => {
		fx.syncStatuses(setup(), "effects");
		fx.stepStatuses(0);
		fx.stepStatuses(33);
		fx.stepStatuses(1023);
		fx.stepStatuses(2013); // [33, 990, 990] OVER 2 s
		frames(2046, 33, 4000);
		assert.deepEqual(cheaps(), [false, false]);
		assert.deepEqual(globalThis.__bloom, [true]);
	});
});

describe("opts.fresh", () => {
	let made; // [key "id:s", fresh] AT EACH create
	const spyFresh = () => ({ create: (mesh, opts) => { made.push([`${opts.id}:${opts.s}`, opts.fresh]); return { update() {}, burst: () => 0, animating: () => false, dispose() {} }; } });
	let v;
	function view(statuses) {
		const sq = Array(64).fill(null);
		sq[52] = { id: "p1", c: "w", t: "p" }; // e2
		sq[35] = { id: "p2", c: "w", t: "p" }; // d4
		return { you: "w", board: { sq }, statuses };
	}

	beforeEach(() => {
		fx.clearStatuses();
		coarse = false;
		made = [];
		for (const s of Object.keys(fx.MODULES)) { fx.MODULES[s] = spyFresh(); }
		v = { pieces: new Map([["e2", new Object3D()], ["d4", new Object3D()]]), scene: new Group(), anims: new Set() };
		board.setView(v);
	});

	test("first sync: every status is not fresh", () => {
		fx.syncStatuses(view({ p1: [{ s: "warded" }], p2: [{ s: "frozen", left: 2 }] }), "effects");
		assert.deepEqual(made, [["p2:frozen", false], ["p1:warded", false]]);
	});

	test("a later sync: only the new status is fresh, the kept one isn't re-created", () => {
		fx.syncStatuses(view({ p1: [{ s: "warded" }] }), "effects");
		made = [];
		fx.syncStatuses(view({ p1: [{ s: "warded" }], p2: [{ s: "frozen", left: 2 }] }), "effects");
		assert.deepEqual(made, [["p2:frozen", true]]);
	});

	test("a status that ended & comes back later is fresh again", () => {
		fx.syncStatuses(view({ p1: [{ s: "warded" }] }), "effects");
		fx.syncStatuses(view({}), "effects");
		made = [];
		fx.syncStatuses(view({ p1: [{ s: "warded" }] }), "effects");
		assert.deepEqual(made, [["p1:warded", true]]);
	});

	test("badges -> effects switch: not fresh", () => {
		fx.syncStatuses(view({ p1: [{ s: "warded" }] }), "badges"); // THE REAL badges.js: NOTHING IN made
		fx.syncStatuses(view({ p1: [{ s: "warded" }] }), "effects");
		assert.deepEqual(made, [["p1:warded", false]]);
	});

	test("mesh swap (syncFromBoard disposes the old mesh): the re-create isn't fresh", () => {
		fx.syncStatuses(view({ p1: [{ s: "warded" }] }), "effects");
		v.pieces.get("e2").userData.disposeStatuses(); // pieces.js disposePiece
		v.pieces.set("e2", new Object3D());
		made = [];
		fx.syncStatuses(view({ p1: [{ s: "warded" }] }), "effects");
		assert.deepEqual(made, [["p1:warded", false]]);
	});

	test("a status whose piece had no mesh for a sync isn't fresh when the mesh is back", () => {
		fx.syncStatuses(view({ p1: [{ s: "warded" }] }), "effects");
		const mesh = v.pieces.get("e2");
		v.pieces.delete("e2");
		fx.syncStatuses(view({ p1: [{ s: "warded" }] }), "effects");
		v.pieces.set("e2", mesh);
		made = [];
		fx.syncStatuses(view({ p1: [{ s: "warded" }] }), "effects");
		assert.deepEqual(made, [["p1:warded", false]]);
	});

	test("remount (clearStatuses) or a null view: the next sync is a first sync again", () => {
		fx.syncStatuses(view({ p1: [{ s: "warded" }] }), "effects");
		fx.clearStatuses();
		made = [];
		fx.syncStatuses(view({ p1: [{ s: "warded" }], p2: [{ s: "frozen", left: 2 }] }), "effects");
		assert.deepEqual(made, [["p2:frozen", false], ["p1:warded", false]]);
		fx.syncStatuses(null, "effects");
		made = [];
		fx.syncStatuses(view({ p1: [{ s: "warded" }] }), "effects");
		assert.deepEqual(made, [["p1:warded", false]]);
	});

	test("a sync put off while a piece is in flight doesn't count; it runs later with fresh as usual", () => {
		v.anims.add({});
		fx.syncStatuses(view({ p1: [{ s: "warded" }] }), "effects"); // PUT OFF: NOT THE FIRST SYNC
		v.anims.clear();
		fx.stepStatuses(0);
		assert.deepEqual(made, [["p1:warded", false]]);
		made = [];
		fx.syncStatuses(view({ p1: [{ s: "warded" }], p2: [{ s: "frozen", left: 2 }] }), "effects");
		assert.deepEqual(made, [["p2:frozen", true]]);
	});

	// REVIEW I1, RULING T24-R14: FRESH ONLY WHEN THE STATUS'S PIECE WAS ON THE BOARD IN THE LAST SYNCED VIEW, & A VEIL LIFTING IS NO GAIN
	function fogView(statuses, showP2) { const v2 = view(statuses); if (!showP2) { v2.board.sq[35] = null; } return v2; }

	test("a status revealed by the fog isn't fresh; a gain on a piece that was shown is", () => {
		fx.syncStatuses(fogView({}, false), "effects");
		fx.syncStatuses(fogView({}, false), "effects");
		made = [];
		fx.syncStatuses(fogView({ p2: [{ s: "warded" }] }, true), "effects");
		assert.deepEqual(made, [["p2:warded", false]]);
		made = [];
		fx.syncStatuses(fogView({ p1: [{ s: "warded" }], p2: [{ s: "warded" }] }, true), "effects");
		assert.deepEqual(made, [["p1:warded", true]]);
	});

	test("a veil lifting (finished game, or a handover) isn't fresh; the caster's veiled cast is", () => {
		const veiled = (more) => ({ ...view({ p1: [{ s: "frozen", left: 2, veiled: true }] }), ...more });
		fx.syncStatuses(view({}), "effects");
		fx.syncStatuses(view({}), "effects"); // THE OWNER'S LIVE VIEW: THE SERVER STRIPS THE VEILED Frozen
		made = [];
		fx.syncStatuses(veiled({ result: "1-0" }), "effects");
		assert.deepEqual(made, [["p1:frozen", false]]);
		fx.clearStatuses();
		fx.syncStatuses({ ...view({}), you: "b" }, "effects");
		made = [];
		fx.syncStatuses(veiled({ you: "b" }), "effects"); // THE CASTER (BLACK) SEES ITS OWN VEILED CAST ON A WHITE PIECE
		assert.deepEqual(made, [["p1:frozen", true]]);
		fx.clearStatuses();
		fx.syncStatuses(view({}), "effects");
		made = [];
		const handed = veiled({}); handed.board.sq[52] = { id: "p1", c: "b", t: "p" }; // HANDED OVER: THE OLD OWNER NOW SEES IT
		fx.syncStatuses(handed, "effects");
		assert.deepEqual(made, [["p1:frozen", false]]);
	});

	test("opts.fresh is set back to false once create ran: updates & the ending copy never see true", () => {
		let o;
		for (const s of Object.keys(fx.MODULES)) { fx.MODULES[s] = { create: (m, opts) => { o = opts; made.push(opts.fresh); return { update() { made.push(o.fresh); }, burst: () => 500, animating: () => false, dispose() {} }; } }; }
		fx.syncStatuses(view({}), "effects");
		fx.syncStatuses(view({ p1: [{ s: "frozen", left: 2 }] }), "effects");
		fx.syncStatuses(view({ p1: [{ s: "frozen", left: 1 }] }), "effects");
		fx.syncStatuses(view({}), "effects"); // ENDS WITH A BURST: THE ENDING COPY
		assert.deepEqual(made, [true, false]);
		assert.equal(o.fresh, false);
	});

	// RE-REVIEW 1, RULING T24-R16: A WARD THAT COMES ONLY FROM HEAVY CAVALRY IS FRESH ONLY IF ITS ENCHANT WASN'T CUT (FOG) IN THE LAST SYNCED VIEW
	const C3 = 42, A1 = 56; // c3 WARDS e2; a1 DOESN'T
	function hcView({ c = "w", you = "w", knightAt = C3, show = true, key = "heavy-cavalry", enchant = true, result } = {}) {
		const sq = Array(64).fill(null);
		sq[52] = { id: "p1", c, t: "p" }; // e2, SHOWN THROUGHOUT
		if (show) { sq[knightAt] = { id: "k1", c, t: "n" }; }
		return { you, board: { sq }, statuses: {}, result, enchant: enchant ? [{ id: "e1", key, owner: c, pieces: show ? ["k1"] : [] }] : [] };
	}
	function meshes() { v.pieces.set("c3", new Object3D()); v.pieces.set("a1", new Object3D()); }

	test("a fogged Heavy Cavalry knight stepping into view: no flare on the piece it wards", () => {
		meshes();
		fx.syncStatuses(hcView({ c: "b", show: false }), "effects");
		fx.syncStatuses(hcView({ c: "b", show: false }), "effects");
		made = [];
		fx.syncStatuses(hcView({ c: "b" }), "effects");
		assert.deepEqual(made, [["k1:heavy-cavalry", false], ["p1:warded", false]]);
	});

	test("the fog ending (a finished game) shows a Heavy Cavalry ward: no flare", () => {
		meshes();
		fx.syncStatuses(hcView({ c: "b", show: false }), "effects");
		fx.syncStatuses(hcView({ c: "b", show: false }), "effects");
		made = [];
		fx.syncStatuses(hcView({ c: "b", result: "1-0" }), "effects");
		assert.deepEqual(made.filter(([k]) => k === "p1:warded"), [["p1:warded", false]]);
	});

	test("a new Heavy Cavalry cast in plain sight flares its ward", () => {
		meshes();
		fx.syncStatuses(hcView({ enchant: false }), "effects");
		made = [];
		fx.syncStatuses(hcView(), "effects");
		assert.deepEqual(made, [["k1:heavy-cavalry", true], ["p1:warded", true]]);
	});

	test("a Heavy Cavalry knight moving in plain sight to ward a new piece flares it", () => {
		meshes();
		fx.syncStatuses(hcView({ knightAt: A1 }), "effects");
		made = [];
		fx.syncStatuses(hcView(), "effects");
		assert.deepEqual(made, [["p1:warded", true]]);
	});
});
