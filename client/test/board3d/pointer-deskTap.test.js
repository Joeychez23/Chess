// TASK 25 A4 (ISSUE #485): A CHESS CARDS GAME'S TAP THAT MISSES THE DEALT PROMOTION CARDS, A SQUARE & THE TABLE CANCELS THE PROMOTION (onTable({ kind: "desk" })),
// EXCEPT IN A SMALL DEAD ZONE ROUND THE CARDS (A NEAR MISS SWALLOWED). THE PURE HIT TEST, THEN pointer/index.js onClick / onTouchTap ON A STUBBED BOARD: A RESOLVE HOOK SWAPS
// THE pointer/ FILES' index.js, camera/index.js, motion.js, tileHover.js, hint.js, screen.js & statusFx/index.js FOR data: MODULES (NO WebGL)
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { registerHooks } = require("node:module");
const { pathToFileURL } = require("node:url");

global.window = { matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {}, devicePixelRatio: 1 }; // constants.js READS ITS MEDIA QUERIES AS IT LOADS
const THREE_URL = pathToFileURL(path.join(__dirname, "../../../node_modules/three/build/three.module.js")).href;
const STUBS = {
	"../index.js": `import { Raycaster, Vector2, Vector3 } from "${THREE_URL}";
		export const view = globalThis.__T25A4_VIEW = {};
		export const raycaster = new Raycaster(), pointer = new Vector2(), forward = new Vector3(), offset = new Vector3();
		export function squareUnder() { return view.squareAt || null; }
		export function setLabels() {}
		export function requestRender() {}`,
	"../camera/index.js": "export function setRoomSide() {} export function zoomTo() {} export function setCameraAt() {} export function zoomSpot() {} export function landHome() {} export function landTurn() {} export function landDealEase() {}",
	"../board/motion.js": "export function liftHeld() {}",
	"./tileHover.js": "export function hoverTile(e) { globalThis.__T25A4_HOVER = e; }",
	"../hint.js": "export function dismissHint() {}",
	"../monitor/screen.js": "export function redrawScreen() {}",
	"../statusFx/index.js": "export function tapStatuses() {}",
};
registerHooks({
	resolve: (specifier, context, next) => (context.parentURL && /\/three\/pointer\/(index|pointer\.cards|pointer\.monitor)\.js$/.test(context.parentURL) && STUBS[specifier]
		? { url: "data:text/javascript," + encodeURIComponent(STUBS[specifier]), shortCircuit: true } : next(specifier, context)),
});
const THREE = require("../../../node_modules/three/build/three.module.js");
const { CARD_SIZE, CARD_Y, cardSpots } = require("../../src/js/gameplay/three/cardLayout.js");
const { hoverBoard, inPromotionDeadZone, PROMOTION_DEAD_ZONE, onClick, onTouchTap } = require("../../src/js/gameplay/three/pointer/index.js");
const view = global.__T25A4_VIEW;

const SPOTS = cardSpots(), MARGIN = PROMOTION_DEAD_ZONE * CARD_SIZE.w;
const Q = SPOTS[0], N = SPOTS[3];

/* ---- the pure hit test, in the room's own units on the baize ---- */

test("the dead zone is a small margin, under half a card width", () => {
	assert.ok(PROMOTION_DEAD_ZONE > 0 && PROMOTION_DEAD_ZONE < 0.5);
});

test("a point on a dealt card, or within the margin round it, is in the dead zone", () => {
	for (const s of SPOTS) { assert.equal(inPromotionDeadZone({ x: s.x, z: s.z }), true); }
	assert.equal(inPromotionDeadZone({ x: Q.x + CARD_SIZE.w / 2 + MARGIN * 0.9, z: Q.z }), true); // JUST PAST THE QUEEN'S LONG EDGE
	assert.equal(inPromotionDeadZone({ x: Q.x, z: Q.z - CARD_SIZE.h / 2 - MARGIN * 0.9 }), true); // JUST PAST THE QUEEN'S TOP
	assert.equal(inPromotionDeadZone({ x: N.x - CARD_SIZE.w / 2 - MARGIN * 0.9, z: N.z + CARD_SIZE.h / 2 + MARGIN * 0.9 }), true); // THE KNIGHT'S FAR CORNER
	assert.equal(inPromotionDeadZone({ x: Q.x, z: (SPOTS[1].z + SPOTS[2].z) / 2 }), true); // THE GAP BETWEEN TWO CARDS
});

test("a point past the margin, the board, the far desk or no point at all is outside it", () => {
	assert.equal(inPromotionDeadZone({ x: Q.x + CARD_SIZE.w / 2 + MARGIN * 1.1, z: Q.z }), false);
	assert.equal(inPromotionDeadZone({ x: Q.x, z: Q.z - CARD_SIZE.h / 2 - MARGIN * 1.1 }), false);
	assert.equal(inPromotionDeadZone({ x: 0, z: 0 }), false); // THE BOARD'S CENTRE
	assert.equal(inPromotionDeadZone({ x: 17.7, z: 0 }), false); // THE OTHER SIDE OF THE BOARD
	assert.equal(inPromotionDeadZone(null), false); // THE RAY MISSED THE BAIZE'S PLANE
});

/* ---- pointer/index.js on a stubbed board: a camera straight down over the cards ---- */

const W = 1000, H = 1000;
function setup({ dealt = true, at = null, open = false, zoomed = false, turned = false, idle = true } = {}) {
	const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 500);
	camera.position.set(-8, 70, 0);
	camera.lookAt(-8, CARD_Y, 0);
	camera.updateMatrixWorld();
	const room = new THREE.Group();
	if (turned) { room.rotation.y = Math.PI; } // BLACK'S SIDE: THE ROOM TURNS, THE CARDS WITH IT
	room.updateMatrixWorld();
	const calls = [], toggled = [];
	for (const k of Object.keys(view)) { delete view[k]; }
	Object.assign(view, {
		camera, room, pointerType: "mouse", cameraGesture: false, monitor: idle ? null : { state: "zoomed" }, glass: null, squareAt: null,
		renderer: { domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }) } },
		cards: { dealt: () => dealt, hit: () => null },
		table: { open: () => open, zoomed: () => zoomed, hit: () => at, togglePile: (p) => toggled.push(p), zoom() {} },
		tableArgs: [{}],
		cardOptions: { tableOn: () => true, onTable: (a) => { calls.push(a); return false; }, onPick() {} },
		container: { style: { cursor: "" } },
	});
	return { calls, toggled, room };
}
// A CLICK AT THE SCREEN POINT OF A POINT IN THE ROOM'S OWN UNITS ON THE BAIZE, PRESSED WHERE IT'S LET GO (A TAP)
function tapAt(x, z, type = "mouse") {
	const p = view.room.localToWorld(new THREE.Vector3(x, CARD_Y, z)).project(view.camera);
	const e = { clientX: (p.x + 1) / 2 * W, clientY: (1 - p.y) / 2 * H, pointerType: type, pointerId: 1, stopped: false, stopPropagation() { this.stopped = true; } };
	view.press = { x: e.clientX, y: e.clientY, time: 0 };
	view.pointerType = type;
	return e;
}
const desk = (calls) => calls.filter((c) => c.kind === "desk");

test("cards out, a click on the bare desk sends onTable({ kind: \"desk\" }) once, with no other fields, & stops the click", () => {
	const { calls } = setup();
	const e = tapAt(Q.x + CARD_SIZE.w / 2 + MARGIN + 2, Q.z);
	onClick(e);
	assert.deepEqual(calls, [{ kind: "desk" }]);
	assert.equal(e.stopped, true);
});

test("cards out, a click just off a card (inside the dead zone) is swallowed: no call, stopped", () => {
	const { calls } = setup();
	const e = tapAt(Q.x + CARD_SIZE.w / 2 + MARGIN / 2, Q.z);
	onClick(e);
	assert.deepEqual(calls, []);
	assert.equal(e.stopped, true);
});

test("the dead zone turns with the room (Black's side)", () => {
	const { calls } = setup({ turned: true });
	onClick(tapAt(N.x - CARD_SIZE.w / 2 - MARGIN / 2, N.z));
	assert.deepEqual(calls, []);
	onClick(tapAt(N.x - CARD_SIZE.w / 2 - MARGIN - 2, N.z));
	assert.deepEqual(desk(calls), [{ kind: "desk" }]);
});

test("a finger's tap on the bare desk cancels too, not stopped (the camera controls need their pointerup)", () => {
	const { calls } = setup();
	view.touches = new Set([1]);
	view.multiTouch = false;
	const e = tapAt(Q.x + CARD_SIZE.w / 2 + MARGIN + 2, Q.z, "touch");
	onTouchTap(e);
	assert.deepEqual(calls, [{ kind: "desk" }]);
	assert.equal(e.stopped, false);
});

test("cards not out, a click on the bare desk is unchanged: no call, not stopped", () => {
	const { calls } = setup({ dealt: false });
	const e = tapAt(Q.x + CARD_SIZE.w / 2 + MARGIN + 2, Q.z);
	onClick(e);
	assert.deepEqual(calls, []);
	assert.equal(e.stopped, false);
});

test("cards out, a square, a pile, a plaque, an open pile & a zoom keep their own answer (no desk)", () => {
	let { calls } = setup();
	view.squareAt = "e4";
	onClick(tapAt(0, 0));
	assert.deepEqual(calls, [{ kind: "square", square: "e4", touch: false }]);

	({ calls } = setup({ at: { kind: "pile", pile: "effects", id: null } }));
	onClick(tapAt(10, 10));
	assert.equal(desk(calls).length, 0);
	assert.equal(calls[0].kind, "pile");

	({ calls } = setup({ at: { kind: "button", id: "cancel" } }));
	onClick(tapAt(10, 10));
	assert.deepEqual(calls, [{ kind: "button", id: "cancel" }]);

	({ calls } = setup({ open: true }));
	onClick(tapAt(10, 10));
	assert.equal(desk(calls).length, 0);

	({ calls } = setup({ zoomed: true }));
	const e = tapAt(10, 10);
	onClick(e);
	assert.deepEqual(calls, []);
	assert.equal(e.stopped, true);
});

test("cards out but the monitor isn't on the desk: no desk call (the monitor's tap)", () => {
	const { calls } = setup({ idle: false });
	view.monitor = { state: "zoomed", pointer() {}, leave() {} };
	view.leaving = [];
	onClick(tapAt(10, 10));
	assert.equal(desk(calls).length, 0);
});

/* ---- T25-M5: the A4 reviewer's probes (scratch-t25-A4-review/probe2.test.cjs P2 to P5) ---- */

test("a camera gesture under way: no desk call", () => {
	const { calls } = setup();
	view.cameraGesture = true;
	onClick(tapAt(10, 10));
	assert.deepEqual(calls, []);
});

test("a drag (let go far from the press): no desk call", () => {
	const { calls } = setup();
	const e = tapAt(10, 10);
	view.press = { x: e.clientX - 200, y: e.clientY, time: 0 };
	onClick(e);
	assert.deepEqual(calls, []);
});

test("a tap on a promotion card picks it, no desk call", () => {
	const { calls } = setup();
	const picks = [];
	view.cards.hit = () => 2;
	view.cardOptions.onPick = (t) => picks.push(t);
	onClick(tapAt(Q.x, Q.z));
	assert.deepEqual(picks, ["b"]);
	assert.deepEqual(calls, []);
});

/* ---- T25 F7 (B3): a finger's or pen's dead zone is wider, 0.5 card widths; the mouse's stays 0.25 ---- */

const { PROMOTION_DEAD_ZONE_TOUCH } = require("../../src/js/gameplay/three/pointer/index.js");
const TOUCH_MARGIN = 0.5 * CARD_SIZE.w;

test("the mouse's dead zone is 0.25 card widths, a finger's or pen's 0.5", () => {
	assert.equal(PROMOTION_DEAD_ZONE, 0.25);
	assert.equal(PROMOTION_DEAD_ZONE_TOUCH, 0.5);
});

test("inPromotionDeadZone takes the margin in card widths, the mouse's by default", () => {
	const between = { x: Q.x + CARD_SIZE.w / 2 + (MARGIN + TOUCH_MARGIN) / 2, z: Q.z }; // PAST THE MOUSE'S MARGIN, INSIDE A FINGER'S
	assert.equal(inPromotionDeadZone(between), false);
	assert.equal(inPromotionDeadZone(between, PROMOTION_DEAD_ZONE), false);
	assert.equal(inPromotionDeadZone(between, PROMOTION_DEAD_ZONE_TOUCH), true);
	assert.equal(inPromotionDeadZone({ x: Q.x + CARD_SIZE.w / 2 + TOUCH_MARGIN * 1.1, z: Q.z }, PROMOTION_DEAD_ZONE_TOUCH), false);
	assert.equal(inPromotionDeadZone(null, PROMOTION_DEAD_ZONE_TOUCH), false);
});

test("between the two margins a click cancels, a finger's or a pen's tap is swallowed", () => {
	const x = Q.x + CARD_SIZE.w / 2 + (MARGIN + TOUCH_MARGIN) / 2;
	let { calls } = setup();
	onClick(tapAt(x, Q.z));
	assert.deepEqual(calls, [{ kind: "desk" }]);
	for (const type of ["touch", "pen"]) {
		({ calls } = setup());
		view.touches = new Set([1]);
		view.multiTouch = false;
		onTouchTap(tapAt(x, Q.z, type));
		assert.deepEqual(calls, [], type);
	}
	({ calls } = setup());
	view.touches = new Set([1]);
	view.multiTouch = false;
	onTouchTap(tapAt(Q.x + CARD_SIZE.w / 2 + TOUCH_MARGIN + 2, Q.z, "touch")); // PAST A FINGER'S MARGIN: CANCELS
	assert.deepEqual(calls, [{ kind: "desk" }]);
});

test("a normal game (no card table): no call, not stopped", () => {
	setup();
	const calls = [];
	view.table = null;
	view.cardOptions.onTable = (a) => calls.push(a);
	const e = tapAt(10, 10);
	onClick(e);
	assert.deepEqual(calls, []);
	assert.equal(e.stopped, false);
});

test("the board has no hover while the card game's menu is open (cardOptions.tableOn false), as a click there isn't the board's; it has it again once the menu shuts", () => {
	setup();
	const e = tapAt(0, 0);
	hoverBoard(e);
	assert.equal(global.__T25A4_HOVER, e);
	view.cardOptions.tableOn = () => false;
	hoverBoard(e);
	assert.equal(global.__T25A4_HOVER, null);
	view.cardOptions.tableOn = () => true;
	hoverBoard(e);
	assert.equal(global.__T25A4_HOVER, e);
});
