// THE STATUS EFFECT FRAME (three/statusFx, TASK 21 S4) ON A STUBBED BOARD: A RESOLVE HOOK SWAPS three/index.js FOR test/helpers/threeStub.mjs (ITS view, center, fileOf, rowOf, requestRender),
// A PIECE IS A PLAIN three Object3D, A BADGE'S CANVAS IS A RECORDING STUB, & THE EFFECT MODULES ARE SWAPPED FOR SPIES THROUGH THE MODULES MAP
const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { registerHooks } = require("node:module");
const { pathToFileURL } = require("node:url");

const media = { matches: false, fns: [], addEventListener(type, fn) { media.fns.push(fn); } }; // REDUCE MOTION (constants.js READS IT AS IT LOADS): A TEST FLIPS matches & CALLS fns
global.window = { matchMedia: () => media };
const reduce = (on) => { media.matches = on; media.fns.forEach((fn) => fn({ matches: on })); };
const drawn = []; // EVERY fillText A BADGE'S CANVAS WAS ASKED FOR
const appended = []; // WHAT WAS PUT IN document.body (THE HOVER BOX)
global.document = {
	createElement: () => ({ width: 0, height: 0, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, remove() {}, getContext: () => new Proxy({ fillText: (t) => drawn.push(String(t)) }, { get: (o, k) => (k in o ? o[k] : () => {}), set: () => true }) }),
	body: { append: (el) => appended.push(el) },
};
const timers = new Set(); // THE FRAME TIMERS RUNNING (statusFx pump)
global.setInterval = (fn, ms) => { const t = { fn, ms }; timers.add(t); return t; };
global.clearInterval = (t) => timers.delete(t);
const STUB = path.join(__dirname, "helpers/threeStub.mjs");
registerHooks({
	resolve: (specifier, context, next) => (context.parentURL && context.parentURL.includes("/three/statusFx/") && specifier === "../index.js"
		? { url: pathToFileURL(STUB).href, shortCircuit: true } : next(specifier, context)),
});
const { Object3D, Group, Sprite } = require("three");
const fx = require("../src/js/gameplay/three/statusFx/index.js");
const { badgeText } = require("../src/js/gameplay/three/statusFx/badges.js");
const board = require(STUB);

const FILES = "abcdefgh", index = (square) => (8 - Number(square[1])) * 8 + FILES.indexOf(square[0]);

// A CARDS VIEW: pieces { e2: "w:p1:p" }, statuses { p1: [{ s, left, by }] }
function cardsView(pieces, statuses, you = "w") {
	const sq = Array(64).fill(null);
	for (const [square, code] of Object.entries(pieces)) { const [c, id, t] = code.split(":"); sq[index(square)] = { id, c, t }; }
	return { you, board: { sq }, statuses };
}

// THE 3D BOARD: A MESH ON EACH SQUARE OF pieces
function meshes(pieces) {
	const v = { pieces: new Map(), scene: new Group(), anims: new Set() };
	board.setView(v);
	for (const square of Object.keys(pieces)) { v.pieces.set(square, mesh()); }
	return v;
}
function mesh() {
	const m = new Object3D();
	m.geometry = { boundingBox: { min: { y: 0 }, max: { y: 0.83 } } };
	return m;
}

// A SPY MODULE: WHAT WAS MADE & ENDED, IN ORDER
let calls, moving, dts, seen; // moving: WHAT A SPY'S animating() SAYS, dts: EVERY dt ITS update GOT, seen: EVERY opts IT WAS MADE WITH
function spy(name) {
	return { create(pieceMesh, opts) { calls.push(["create", name, opts.square]); seen.push(opts); return { update(dt) { dts.push(dt); calls.push(["update", name]); }, burst() { calls.push(["burst", name]); return 0; }, animating: () => moving, dispose() { calls.push(["dispose", name]); } }; } };
}
beforeEach(() => {
	fx.clearStatuses();
	reduce(false);
	calls = [];
	moving = false;
	dts = [];
	seen = [];
	for (const s of Object.keys(fx.MODULES)) { fx.MODULES[s] = spy(s); }
	drawn.length = 0;
});
after(() => fx.clearStatuses()); // NO EFFECT TIMER LEFT RUNNING
const made = () => calls.filter((c) => c[0] !== "update");

test("diffStatuses: a new status is created, one gone ends, a changed left or square is an update, a mode change swaps", () => {
	const want = new Map([["p1:frozen", { id: "p1", s: "frozen", left: 2, square: "e2", slot: 0, slots: 1 }], ["p2:marked", { id: "p2", s: "marked", left: null, square: "d4", slot: 0, slots: 1 }], ["p3:hexed", { id: "p3", s: "hexed", left: 1, square: "a1", slot: 0, slots: 1 }]]);
	const live = new Map([
		["p1:frozen", { mode: "effects", opts: { left: 3, square: "e2", slot: 0, slots: 1 } }],
		["p2:marked", { mode: "effects", opts: { left: null, square: "d5", slot: 0, slots: 1 } }],
		["p3:hexed", { mode: "badges", opts: { left: 1, square: "a1", slot: 0, slots: 1 } }],
		["p4:shaken", { mode: "effects", opts: { left: 1, square: "h7", slot: 0, slots: 1 } }],
		["p5:warded", { mode: "effects", opts: { left: null, square: "c3", slot: 0, slots: 1 } }],
	]);
	const plan = fx.diffStatuses(live, want, "effects", new Set(["p1", "p2", "p3", "p4"]));
	assert.deepEqual(plan.create, []);
	assert.deepEqual(plan.update, ["p1:frozen", "p2:marked"]);
	assert.deepEqual(plan.swap, ["p3:hexed"]);
	assert.deepEqual(plan.end, [{ key: "p4:shaken", burst: true }, { key: "p5:warded", burst: false }], "p4 is still on the board (its status ended: burst), p5 isn't (taken or fogged: no burst)");
	assert.deepEqual(fx.diffStatuses(new Map(), want, "effects", new Set()).create, ["p1:frozen", "p2:marked", "p3:hexed"]);
});

test("syncStatuses: a new status creates its effect on the piece's mesh, with its opts", () => {
	const pieces = { e2: "w:p1:p" }, v = meshes(pieces);
	fx.syncStatuses(cardsView(pieces, { p1: [{ s: "frozen", left: 2, by: "b" }] }), "effects");
	assert.deepEqual(made(), [["create", "frozen", "e2"]]);
	const [entry] = fx.liveStatuses();
	assert.equal(entry.opts.left, 2);
	assert.equal(entry.opts.by, "b");
	assert.equal(entry.opts.mode, "effects");
	assert.equal(entry.opts.mesh, v.pieces.get("e2"));
	assert.equal(entry.opts.root.parent, v.pieces.get("e2"), "the root follows the piece: a child of its mesh");
	assert.equal(entry.opts.squareRoot.parent, v.scene, "the square root stays on the board");
	assert.equal(entry.opts.squareRoot.position.x, board.center(board.fileOf("e2")));
});

test("syncStatuses: a status that's gone bursts then is disposed; a changed left is an update, not a re-create", () => {
	const pieces = { e2: "w:p1:p" };
	meshes(pieces);
	fx.syncStatuses(cardsView(pieces, { p1: [{ s: "shaken", left: 2, by: "b" }] }), "effects");
	const opts = fx.liveStatuses()[0].opts;
	fx.syncStatuses(cardsView(pieces, { p1: [{ s: "shaken", left: 1, by: "b" }] }), "effects");
	assert.deepEqual(made(), [["create", "shaken", "e2"]], "no re-create");
	assert.equal(fx.liveStatuses()[0].opts, opts, "the same opts, updated in place");
	assert.equal(opts.left, 1);
	fx.syncStatuses(cardsView(pieces, {}), "effects");
	assert.deepEqual(made().slice(1), [["burst", "shaken"], ["dispose", "shaken"]]);
	assert.equal(opts.root.parent, null, "its root is off the piece");
	assert.equal(fx.liveStatuses().length, 0);
});

test("syncStatuses: a piece that moved squares keeps its effect (the square follows); a captured one is disposed without a burst", () => {
	let pieces = { e2: "w:p1:p", d7: "b:p9:p" };
	const v = meshes(pieces);
	fx.syncStatuses(cardsView(pieces, { p1: [{ s: "marked", left: null, by: "b" }], p9: [{ s: "warded", left: 3, by: "b" }] }), "effects");
	const pawn = v.pieces.get("e2");
	v.pieces.delete("e2");
	v.pieces.set("e4", pawn); // THE SLIDE MOVED THE SAME MESH
	pieces = { e4: "w:p1:p", d7: "b:p9:p" };
	fx.syncStatuses(cardsView(pieces, { p1: [{ s: "marked", left: null, by: "b" }], p9: [{ s: "warded", left: 3, by: "b" }] }), "effects");
	assert.deepEqual(made(), [["create", "warded", "d7"], ["create", "marked", "e2"]], "kept, not re-created (board order: rank 8 first)");
	const marked = fx.liveStatuses().find((e) => e.key === "p1:marked").opts;
	assert.equal(marked.square, "e4");
	assert.equal(marked.squareRoot.position.x, board.center(board.fileOf("e4")), "the square root moved to the view's square");
	const other = mesh(); // syncFromBoard GAVE THE PIECE ANOTHER MESH
	v.pieces.set("e4", other);
	fx.syncStatuses(cardsView(pieces, { p1: [{ s: "marked", left: null, by: "b" }], p9: [{ s: "warded", left: 3, by: "b" }] }), "effects");
	assert.equal(marked.root.parent, other, "the root moved onto the new mesh");
	assert.equal(marked.mesh, other);
	v.pieces.delete("d7"); // TAKEN
	fx.syncStatuses(cardsView({ e4: "w:p1:p" }, { p1: [{ s: "marked", left: null, by: "b" }] }), "effects");
	assert.deepEqual(made().slice(2), [["dispose", "warded"]]);
});

test("a piece's mesh disposed (removePiece) disposes its effects with it", () => {
	const pieces = { e2: "w:p1:p" }, v = meshes(pieces);
	fx.syncStatuses(cardsView(pieces, { p1: [{ s: "hexed", left: 2, by: "b" }] }), "effects");
	v.pieces.get("e2").userData.disposeStatuses();
	assert.deepEqual(made(), [["create", "hexed", "e2"], ["dispose", "hexed"]]);
	assert.equal(fx.liveStatuses().length, 0);
});

test("veil: a veiled Frozen is not drawn for its owner, and is drawn for its caster", () => {
	const pieces = { e2: "w:p1:p" };
	meshes(pieces);
	fx.syncStatuses(cardsView(pieces, { p1: [{ s: "frozen", left: 3, veiled: true }] }, "w"), "effects"); // THE OWNER'S VIEW: NO by (S2b STRIPS IT)
	assert.deepEqual(made(), []);
	fx.syncStatuses(cardsView(pieces, { p1: [{ s: "frozen", left: 3, by: "b", veiled: true }] }, "w"), "effects");
	assert.deepEqual(made(), [], "the owner (w) never sees another's veiled Frozen");
	fx.syncStatuses(cardsView(pieces, { p1: [{ s: "frozen", left: 3, by: "b", veiled: true }] }, "b"), "effects");
	assert.deepEqual(made(), [["create", "frozen", "e2"]], "its caster (b) sees it");
});

test("veil: a veiled Frozen the server sends is drawn in a finished game and after a handover, hidden only from its owner while the game is on", () => {
	const veiled = { p1: [{ s: "frozen", left: 3, by: "b", veiled: true }] };
	const list = (pieces, statuses, you, result) => fx.statusList({ ...cardsView(pieces, statuses, you), result }).want.has("p1:frozen");
	assert.equal(list({ e2: "w:p1:p" }, veiled, "w"), false, "live game, the owner: hidden");
	assert.equal(list({ e2: "w:p1:p" }, veiled, "w", { winner: "b", reason: "checkmate" }), true, "finished game (ruling M1): the owner sees it");
	assert.equal(list({ a6: "b:p1:p" }, { p1: [{ s: "frozen", left: 3, veiled: true }] }, "w"), true, "after a handover (ruling M2): the old owner, by stripped, sees it");
	assert.equal(list({ a6: "b:p1:p" }, veiled, "b"), false, "after a handover: the new owner, live game, hidden");
});

test("mode switch: effects to badges swaps the effect for a badge sprite, and back", () => {
	const pieces = { e2: "w:p1:p" };
	meshes(pieces);
	const cv = cardsView(pieces, { p1: [{ s: "warded", left: 2, by: "w" }, { s: "marked", left: null, by: "b" }] });
	fx.syncStatuses(cv, "effects");
	fx.syncStatuses(cv, "badges");
	assert.deepEqual(made(), [["create", "warded", "e2"], ["create", "marked", "e2"], ["dispose", "warded"], ["dispose", "marked"]], "no burst: the status didn't end");
	const live = fx.liveStatuses();
	assert.deepEqual(live.map((e) => e.mode), ["badges", "badges"]);
	assert.ok(live.every((e) => e.opts.root.children.some((c) => c instanceof Sprite)), "one badge sprite per status");
	assert.deepEqual(live.map((e) => [e.opts.slot, e.opts.slots]), [[0, 2], [1, 2]]);
	fx.syncStatuses(cv, "effects");
	assert.deepEqual(made().slice(4), [["create", "warded", "e2"], ["create", "marked", "e2"]]);
	assert.ok(fx.liveStatuses().every((e) => e.opts.root.children.length === 0), "the badges are gone");
});

test("permanent: a badge for left: null draws no count, a timed one draws its turns left", () => {
	assert.equal(badgeText(null), "");
	assert.equal(badgeText(2), "2");
	const pieces = { e2: "w:p1:p" };
	meshes(pieces);
	fx.syncStatuses(cardsView(pieces, { p1: [{ s: "warded", left: null, by: "w" }] }), "badges");
	assert.deepEqual(drawn, []);
	fx.syncStatuses(cardsView(pieces, { p1: [{ s: "warded", left: null, by: "w" }, { s: "hexed", left: 3, by: "b" }] }), "badges");
	fx.stepStatuses(0);
	assert.ok(drawn.includes("3") && drawn.length === 1, `only Hex's count: ${drawn}`);
});

test("hover text: each status's name, its turns and what it does; nothing for a square without", () => {
	const pieces = { e2: "w:p1:p", d2: "w:p2:p" };
	meshes(pieces);
	fx.syncStatuses(cardsView(pieces, { p1: [{ s: "frozen", left: 2, by: "b" }, { s: "marked", left: null, by: "b" }] }), "badges");
	const text = fx.statusText("e2");
	assert.match(text, /^Frozen \(2 turns left\): .+\.\nMarked: .+\.$/);
	assert.equal(fx.statusText("d2"), "");
	assert.equal(fx.statusText(null), "");
});

// FIX ROUND 1 (task-21-S4-review.md I1, I2, M1, M5, RULING R4)

test("no sync while a piece is in flight (view.anims): the old view against a moved mesh disposes & re-parents nothing; the sync lands once the flight ends", () => {
	const pieces = { e2: "w:p1:p", e4: "b:p9:p" }, v = meshes(pieces);
	const old = cardsView(pieces, { p1: [{ s: "warded", left: 2, by: "w" }], p9: [{ s: "shaken", left: 2, by: "w" }] });
	fx.syncStatuses(old, "effects");
	const p1 = v.pieces.get("e2"), p9 = v.pieces.get("e4"), [w, s] = ["p1:warded", "p9:shaken"].map((k) => fx.liveStatuses().find((e) => e.key === k).opts);
	v.pieces.delete("e2"); // THE STEP SLIDES p1 ONTO e4 (motion.js slide: THE MAP CHANGES AS IT STARTS), p9 IS ON ITS WAY TO THE PILE
	v.pieces.set("e4", p1);
	v.anims.add({ mesh: p1 });
	fx.syncStatuses(old, "effects"); // A RESIZE, A MODE CHANGE, endPromotion... DURING THE SLIDE
	assert.deepEqual(made().slice(2), [], "nothing ended or made mid-flight");
	assert.equal(w.root.parent, p1);
	assert.equal(s.root.parent, p9, "the victim's effect stays on the victim, not on the capturer");
	const now = cardsView({ e4: "w:p1:p" }, { p1: [{ s: "warded", left: 2, by: "w" }] });
	fx.syncStatuses(now, "effects"); // THE ANSWER'S set DURING ANOTHER FLIGHT: KEPT FOR LATER
	assert.deepEqual(made().slice(2), []);
	v.anims.clear();
	fx.stepStatuses(16); // THE FRAME THE FLIGHT ENDS
	assert.deepEqual(made().slice(2), [["dispose", "shaken"]], "the latest view lands: p9 was taken (no burst), p1's Warded is kept");
	assert.equal(w.square, "e4");
	assert.equal(w.root.parent, p1);
});

test("no sync of a view the board's steps have moved past (holdStatuses), between steps too; the next view lands", () => {
	const pieces = { e2: "w:p1:p", e4: "b:p9:p" }, v = meshes(pieces);
	const old = cardsView(pieces, { p1: [{ s: "warded", left: 2, by: "w" }], p9: [{ s: "shaken", left: 2, by: "w" }] });
	fx.syncStatuses(old, "effects");
	const p1 = v.pieces.get("e2"), p9 = v.pieces.get("e4"), s = fx.liveStatuses().find((e) => e.key === "p9:shaken").opts;
	fx.holdStatuses(old); // renderer boardStep3D: A STEP STARTS
	v.pieces.delete("e2");
	v.pieces.set("e4", p1); // THE STEP ENDED (view.anims EMPTY), ITS ANSWER'S set NOT YET
	fx.syncStatuses(old, "badges");
	fx.stepStatuses(16);
	assert.deepEqual(made().slice(2), [], "nothing ended, swapped or made");
	assert.equal(s.root.parent, p9);
	fx.syncStatuses(cardsView({ e4: "w:p1:p" }, { p1: [{ s: "warded", left: 2, by: "w" }] }), "effects"); // THE set: ITS OWN VIEW
	assert.deepEqual(made().slice(2), [["dispose", "shaken"]]);
	assert.equal(fx.liveStatuses()[0].opts.root.parent, p1);
});

test("the frame timer runs only while an effect says it animates, or a burst plays", () => {
	const pieces = { e2: "w:p1:p" };
	meshes(pieces);
	const cv = cardsView(pieces, { p1: [{ s: "frozen", left: 2, by: "b" }] });
	fx.syncStatuses(cv, "effects");
	assert.equal(timers.size, 0, "a still effect (the stubs) asks for no frames");
	moving = true;
	fx.syncStatuses(cardsView(pieces, { p1: [{ s: "frozen", left: 1, by: "b" }] }), "effects");
	assert.equal(timers.size, 1, "one that animates does");
	moving = false;
	fx.stepStatuses(16);
	assert.equal(timers.size, 0, "it stops once the effect is still");
	fx.syncStatuses(cv, "badges");
	assert.equal(timers.size, 0, "badges are still");
});

test("under reduced motion no timer runs, no burst plays, and opts.reduce reaches each effect (also when it changes)", () => {
	const pieces = { e2: "w:p1:p" };
	meshes(pieces);
	reduce(true);
	moving = true;
	fx.syncStatuses(cardsView(pieces, { p1: [{ s: "shaken", left: 2, by: "b" }] }), "effects");
	assert.equal(seen[0].reduce, true);
	assert.equal(timers.size, 0, "no continuous redraw");
	reduce(false);
	assert.equal(seen[0].reduce, false, "the change reaches it");
	assert.equal(timers.size, 1);
	reduce(true);
	assert.equal(timers.size, 0, "it stops as reduced motion comes on");
	fx.syncStatuses(cardsView(pieces, {}), "effects");
	assert.deepEqual(made(), [["create", "shaken", "e2"], ["dispose", "shaken"]], "ended without a burst");
});

test("dt is clamped after a long gap (a hidden tab)", () => {
	const pieces = { e2: "w:p1:p" };
	meshes(pieces);
	moving = true;
	fx.syncStatuses(cardsView(pieces, { p1: [{ s: "hexed", left: 2, by: "b" }] }), "effects");
	fx.stepStatuses(1000);
	fx.stepStatuses(61000);
	assert.ok(Math.max(...dts) <= 0.1, `dts: ${dts}`);
});

test("the status text shows for the picked piece (keys, tap or click) as for the hovered one, in the one live region", () => {
	const pieces = { e2: "w:p1:p", d2: "w:p2:p" };
	meshes(pieces);
	appended.length = 0;
	fx.syncStatuses(cardsView(pieces, { p1: [{ s: "frozen", left: 2, by: "b" }] }), "effects");
	fx.pickStatuses("e2");
	assert.equal(appended.length, 1);
	const box = appended[0];
	assert.match(box.textContent, /^Frozen \(2 turns left\)/);
	assert.equal(box.hidden, false);
	assert.deepEqual(box.attrs, { role: "status", "aria-live": "polite" });
	fx.hoverStatuses("d2"); // THE POINTER OVER A PIECE WITHOUT: THE PICKED ONE'S STAYS
	assert.match(box.textContent, /^Frozen/);
	fx.pickStatuses(null);
	assert.equal(box.hidden, true);
	assert.equal(appended.length, 1, "the same element");
});

test("a tap or the keyboard's focus on any piece, an enemy's too, shows its status text in the same live region; the latest of the two wins", () => {
	const pieces = { e2: "w:p1:p", d7: "b:p9:p", d2: "w:p2:p" };
	meshes(pieces);
	appended.length = 0;
	fx.syncStatuses(cardsView(pieces, { p1: [{ s: "frozen", left: 2, by: "b" }], p9: [{ s: "warded", left: 3, by: "b" }] }), "effects");
	fx.tapStatuses("d7"); // THE ENEMY'S PIECE
	const box = appended[0];
	assert.match(box.textContent, /^Warded \(3 turns left\)/);
	assert.deepEqual(box.attrs, { role: "status", "aria-live": "polite" });
	fx.hoverStatuses("d2"); // NOTHING THERE: THE TAPPED ONE'S STAYS
	assert.match(box.textContent, /^Warded/);
	fx.tapStatuses("e5"); // AN EMPTY SQUARE
	assert.equal(box.hidden, true);
	fx.focusStatuses("e2");
	assert.match(box.textContent, /^Frozen/);
	fx.tapStatuses("d7");
	fx.focusStatuses("e2"); // THE SAME FOCUS AGAIN (A TABLE REFRESH): THE LATER TAP STAYS
	assert.match(box.textContent, /^Warded/);
	fx.focusStatuses(null);
	assert.equal(box.hidden, true);
	fx.pickStatuses("e2"); // A PICK STILL SHOWS UNDER NO TAP OR FOCUS
	assert.match(box.textContent, /^Frozen/);
	assert.equal(appended.length, 1, "the same element");
});

test("wiring: a finger's tap on a square (pointer.js pickTable) & the keyboard's square (three/index.js highlightSquares) reach the status text", () => {
	const fs = require("node:fs"), src = (f) => fs.readFileSync(path.join(__dirname, "../src/js/gameplay/three", f), "utf8");
	const pick = /function pickTable\(e, stop\) \{[\s\S]*?\n\}/.exec(src("pointer.js"))[0];
	assert.match(pick, /if \(hit\.kind === "square" && view\.pointerType !== "mouse"\) \{ tapStatuses\(hit\.square\); \}/);
	assert.ok(pick.indexOf("tapStatuses") < pick.indexOf("view.cardOptions.onTable({ ...hit"), "before the pick: it can't stop a pick");
	assert.match(src("pointer.js"), /import \{ tapStatuses \} from "\.\/statusFx\/index\.js";/);
	const hl = /export function highlightSquares\(squares, focus = null\) \{[\s\S]*?\n\}/.exec(src("index.js"))[0];
	assert.match(hl, /focusStatuses\(focus\);/);
	assert.match(src("index.js"), /import \{ stepStatuses, clearStatuses, focusStatuses \} from "\.\/statusFx\/index\.js";/);
});

test("wiring: renderer/index.js syncs the statuses to the table's view after the pieces stand, shows a pick's status text & clears it at the drop, & holds them while the board's steps play", () => {
	const src = require("node:fs").readFileSync(path.join(__dirname, "../src/js/gameplay/renderer/index.js"), "utf8");
	assert.match(src, /if \(table && game\.cardGame\) \{ board3D\.syncStatuses\(table\.view, statusPref\.current\(\)\); \}/);
	assert.match(src, /board3D\.setHeld\(square \|\| null, Boolean\(dragging\)\); board3D\.pickStatuses\(square \|\| null\);/);
	assert.match(src, /board3D\.dropHeld\(square\); board3D\.pickStatuses\(null\);/);
	assert.match(src, /if \(table\) \{ board3D\.holdStatuses\(table\.view\); \}/);
});

test("siblings: each effect is told its piece's other shown statuses; a change is an update with update(0), an unchanged sync isn't", () => {
	const pieces = { e2: "w:p1:p", d2: "w:p2:p" };
	meshes(pieces);
	fx.syncStatuses(cardsView(pieces, { p1: [{ s: "shaken", left: 2, by: "b" }, { s: "marked", left: null, by: "b" }], p2: [{ s: "hexed", left: 1, by: "b" }] }), "effects");
	const opts = (k) => fx.liveStatuses().find((e) => e.key === k).opts, m = opts("p1:marked");
	assert.deepEqual(opts("p1:shaken").siblings, ["marked"]);
	assert.deepEqual(m.siblings, ["shaken"]);
	assert.deepEqual(opts("p2:hexed").siblings, [], "alone");
	calls = [];
	dts = [];
	fx.syncStatuses(cardsView(pieces, { p1: [{ s: "shaken", left: 2, by: "b" }, { s: "marked", left: null, by: "b" }], p2: [{ s: "hexed", left: 1, by: "b" }] }), "effects");
	assert.deepEqual(calls, [], "the same statuses: no update");
	fx.syncStatuses(cardsView(pieces, { p1: [{ s: "hexed", left: 1, by: "b" }, { s: "marked", left: null, by: "b" }], p2: [{ s: "hexed", left: 1, by: "b" }] }), "effects"); // SHAKEN ENDS & HEX COMES IN ITS SLOT: ONLY MARKED'S siblings CHANGE
	assert.deepEqual(m.siblings, ["hexed"]);
	assert.ok(calls.some((c) => c[0] === "update" && c[1] === "marked") && dts.includes(0), "marked hears it at update(0)");
	assert.deepEqual(opts("p1:hexed").siblings, ["marked"]);
});

test("a badge is depth tested, so cards, the duel and the monitor in front of it hide it", () => {
	const pieces = { e2: "w:p1:p" };
	meshes(pieces);
	fx.syncStatuses(cardsView(pieces, { p1: [{ s: "warded", left: 2, by: "w" }] }), "badges");
	const sprite = fx.liveStatuses()[0].opts.root.children.find((c) => c instanceof Sprite);
	assert.notEqual(sprite.material.depthTest, false);
	assert.ok(sprite.position.y > 0.83, "over the piece's top: its own piece doesn't hide it");
});
