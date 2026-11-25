// TASK 25 (RB-I1, CONTRACT b): AUTO LEAN & THE PLAYER'S OWN CAMERA GESTURES. pointer.js SETS view.leanMoved (F7), camera.js READS & CLEARS IT (F8).
// TWO TEST GROUPS MERGED BY FEATURE, EACH IN ITS OWN SCOPE WITH ITS OWN STUBS; THE TESTS & THEIR NAMES ARE UNCHANGED

/* ================================================================ */
// F7: pointer.js SETS THE FLAG
/* ================================================================ */
(() => {
// TASK 25 F7 (CONTRACT b, RB-I1'S SETTER SIDE): pointer.js SETS view.leanMoved ONLY WHEN THE PLAYER REALLY MOVES THE CAMERA: A DRAG PAST DRAG_PX, ANY TWO-FINGER TOUCH,
// A WHEEL OR TRACKPAD ZOOM. createControls ON THE REAL OrbitControls OVER A FAKE CANVAS; A RESOLVE HOOK SWAPS pointer.js'S IMPORTS FOR data: MODULES (NO WebGL), AS pointer-T25-A4
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { registerHooks } = require("node:module");
const { pathToFileURL } = require("node:url");

global.window = { matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {}, devicePixelRatio: 1 }; // constants.js READS ITS MEDIA QUERIES AS IT LOADS
const THREE_URL = pathToFileURL(path.join(__dirname, "../../node_modules/three/build/three.module.js")).href;
const STUBS = {
	"./index.js": `import { Raycaster, Vector2, Vector3 } from "${THREE_URL}";
		export const view = globalThis.__T25F7_VIEW = {};
		export const raycaster = new Raycaster(), pointer = new Vector2(), forward = new Vector3(), offset = new Vector3();
		export function squareUnder() { return null; }
		export function setLabels() {}
		export function requestRender() {}`,
	"./camera.js": "export function setRoomSide() {} export function zoomTo() {} export function setCameraAt() {} export function zoomSpot() {} export function landHome() {} export function landTurn() {} export function landDealEase() {}",
	"./motion.js": "export function liftHeld() {}",
	"./tileHover.js": "export function hoverTile() {}",
	"./hint.js": "export function dismissHint() {}",
	"./screen.js": "export function redrawScreen() {}",
	"./statusFx/index.js": "export function tapStatuses() {}",
};
registerHooks({
	resolve: (specifier, context, next) => (context.parentURL && context.parentURL.endsWith("/three/pointer.js") && STUBS[specifier]
		? { url: "data:text/javascript," + encodeURIComponent(STUBS[specifier]), shortCircuit: true } : next(specifier, context)),
});
const THREE = require("../../node_modules/three/build/three.module.js");
const { DRAG_PX } = require("../src/js/gameplay/three/constants.js");
const { createControls } = require("../src/js/gameplay/three/pointer.js");
const view = global.__T25F7_VIEW;

// A FAKE CANVAS THAT KEEPS ITS LISTENERS, SO A TEST FIRES THE CONTROLS' OWN WHEEL HANDLER
function fakeCanvas() {
	const on = {}, add = (type, fn) => { (on[type] = on[type] || []).push(fn); };
	return { on, style: {}, addEventListener: add, removeEventListener() {}, ownerDocument: { addEventListener() {}, removeEventListener() {} }, getRootNode() { return { addEventListener() {}, removeEventListener() {} }; },
		getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }), clientWidth: 800, clientHeight: 600, setPointerCapture() {}, releasePointerCapture() {} };
}
function setup() {
	for (const k of Object.keys(view)) { delete view[k]; }
	const camera = new THREE.PerspectiveCamera(50, 4 / 3, 0.1, 500);
	camera.position.set(0, 40, 30);
	const canvas = fakeCanvas();
	Object.assign(view, { side: "w", pointerType: "mouse", press: { x: 100, y: 100, time: 0 }, pointerAt: { x: 100, y: 100 }, controlsActive: false, cameraGesture: false });
	const controls = createControls(camera, canvas);
	view.controls = controls;
	return { controls, canvas };
}
const wheel = (canvas) => { for (const fn of canvas.on.wheel) { fn({ deltaY: 100, deltaMode: 0, clientX: 400, clientY: 300, ctrlKey: false, preventDefault() {} }); } };

test("F7 (b): a wheel zoom over the canvas sets view.leanMoved", () => {
	const { canvas } = setup();
	assert.equal(Boolean(view.leanMoved), false);
	wheel(canvas);
	assert.equal(view.leanMoved, true);
});

test("F7 (b): a trackpad pinch (a ctrl wheel) sets view.leanMoved", () => {
	const { canvas } = setup();
	for (const fn of canvas.on.wheel) { fn({ deltaY: 3, deltaMode: 0, clientX: 400, clientY: 300, ctrlKey: true, preventDefault() {} }); }
	assert.equal(view.leanMoved, true);
});

test("F7 (b): a wheel while the controls are off (zoomed on the monitor) sets nothing", () => {
	const { canvas, controls } = setup();
	controls.enabled = false;
	wheel(canvas);
	assert.equal(Boolean(view.leanMoved), false);
});

test("F7 (b): a mouse press whose camera moves 1 px (a wobbling click-to-move) leaves view.leanMoved unset", () => {
	const { controls } = setup();
	controls.state = 2; // _STATE.PAN: A LEFT PRESS THE CONTROLS TOOK
	controls.dispatchEvent({ type: "start" });
	view.pointerAt = { x: 101, y: 100 };
	controls.dispatchEvent({ type: "change" });
	controls.dispatchEvent({ type: "end" });
	assert.equal(Boolean(view.leanMoved), false);
	assert.equal(view.cameraGesture, false);
});

test("F7 (b): a mouse drag past DRAG_PX sets view.leanMoved, with cameraGesture", () => {
	const { controls } = setup();
	controls.state = 2;
	controls.dispatchEvent({ type: "start" });
	assert.equal(Boolean(view.leanMoved), false);
	view.pointerAt = { x: 100 + DRAG_PX + 1, y: 100 };
	controls.dispatchEvent({ type: "change" });
	assert.equal(view.cameraGesture, true);
	assert.equal(view.leanMoved, true);
});

test("F7 (b): a two-finger touch sets view.leanMoved as it starts", () => {
	const { controls } = setup();
	view.pointerType = "touch";
	controls.state = 6; // _STATE.TOUCH_DOLLY_ROTATE
	controls.dispatchEvent({ type: "start" });
	assert.equal(view.cameraGesture, true);
	assert.equal(view.leanMoved, true);
});

test("F7 (b): pointer.js never clears the flag (camera.js's leanIn does)", () => {
	const { controls } = setup();
	view.leanMoved = true;
	controls.state = 2;
	controls.dispatchEvent({ type: "start" });
	controls.dispatchEvent({ type: "change" });
	controls.dispatchEvent({ type: "end" });
	assert.equal(view.leanMoved, true);
});
})();

/* ================================================================ */
// F8: camera.js READS & CLEARS IT
/* ================================================================ */
(() => {
// TASK 25 F8 (RB-I1, CONTRACT b): AUTO LEAN'S WAY BACK IS FORGOTTEN ONLY WHEN THE PLAYER REALLY MOVED THE CAMERA (view.leanMoved, SET BY pointer.js),
// NOT WHEN A CLICK'S 1 px WOBBLE PANNED IT. camera.js ON A STUBBED BOARD: index.js, pointer.js, room.js & monitor.js GO TO test/helpers/cameraStub.mjs,
// lean.js TO A VIRTUAL MODULE THAT HANDS THE TEST camera.js'S lean & back CALLBACKS
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { registerHooks } = require("node:module");
const { pathToFileURL } = require("node:url");

global.window = { matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {}, devicePixelRatio: 1 }; // constants.js READS ITS MEDIA QUERIES AS IT LOADS
global.getComputedStyle = () => ({ paddingLeft: "0", paddingRight: "0", paddingTop: "0", paddingBottom: "0" });
const STUB = path.join(__dirname, "helpers/cameraStub.mjs");
const LEAN = "virtual:lean-T25-F8";
const SWAPPED = new Set(["./index.js", "./pointer.js", "./room.js", "./monitor/monitor.js"]);
registerHooks({
	resolve(specifier, context, next) {
		if (context.parentURL && context.parentURL.endsWith("/three/camera.js")) {
			if (specifier === "./lean.js") { return { url: LEAN, shortCircuit: true }; }
			if (SWAPPED.has(specifier)) { return { url: pathToFileURL(STUB).href, shortCircuit: true }; }
		}
		return next(specifier, context);
	},
	load: (url, context, next) => (url === LEAN ? { format: "module", shortCircuit: true, source: `
		export function setLeanCamera(c) { globalThis.leanCameraF8 = c; }
		export const leanSpot = ({ home }) => globalThis.leanSpotF8(home);
		export function retryLean() {}
	` } : next(url, context)),
});
const THREE = require("../../node_modules/three/build/three.module.js");
require("../src/js/gameplay/three/camera.js");
const board = require(STUB);

const HOME = new THREE.Vector3(0, 40, 30), LEANED = new THREE.Vector3(0, 20, 15);
globalThis.leanSpotF8 = () => ({ position: LEANED.clone(), target: new THREE.Vector3(0, 0, 0) });
const lean = () => globalThis.leanCameraF8;
let tweens, view;

beforeEach(() => {
	tweens = [];
	const camera = new THREE.PerspectiveCamera(45, 1.6, 0.1, 1000);
	camera.position.copy(HOME);
	view = { camera, controls: { target: new THREE.Vector3(0, 0, 0), minDistance: 5, maxDistance: 200 }, tweens: { add: (t) => tweens.push(t) } };
	board.setView(view);
	board.setIdle(true);
});
const land = () => tweens.splice(0).forEach((t) => t.update(1)); // EVERY GLIDE LANDS
function leanedIn() {
	lean().lean();
	land();
	assert.ok(view.camera.position.distanceTo(LEANED) < 1e-9, "leaned in");
}
const wobble = () => { view.camera.position.x += 0.05; }; // ABOUT 2 px OF PAN AT 1280x720 (RB-I1: 1 px IS 0.024 TO 0.043)

test("T25-F8 RB-I1: a click's tiny pan with leanMoved false still goes back to where the player had it", () => {
	leanedIn();
	wobble();
	lean().back();
	land();
	assert.ok(view.camera.position.distanceTo(HOME) < 1e-9, "back home");
	assert.equal(view.leanHome, null);
});

test("T25-F8 RB-I1: leanMoved undefined counts as false", () => {
	leanedIn();
	delete view.leanMoved;
	wobble();
	lean().back();
	land();
	assert.ok(view.camera.position.distanceTo(HOME) < 1e-9, "back home");
});

test("T25-F8 RB-I1: with leanMoved true the home is forgotten and the camera stays where the player put it", () => {
	leanedIn();
	view.leanMoved = true;
	wobble();
	const there = view.camera.position.clone();
	lean().back();
	land();
	assert.equal(view.leanHome, null);
	assert.ok(view.camera.position.distanceTo(there) < 1e-9, "stays put");
});

test("T25-F8 RB-I1: a new lean clears the flag", () => {
	view.leanMoved = true;
	lean().lean();
	assert.equal(view.leanMoved, false);
	land();
	lean().back();
	land();
	assert.ok(view.camera.position.distanceTo(HOME) < 1e-9, "back home");
});

test("T25-F8: the player taking the camera mid lean still keeps it there", () => {
	lean().lean();
	view.cameraGesture = true;
	tweens[0].update(0.5);
	assert.equal(view.leanHome, null);
	assert.equal(view.dealEase, null);
});

test("T25-F8 M1: a wheel zoom mid lean (leanMoved, no cameraGesture) takes the camera too: the glide stops there, no home is kept", () => {
	lean().lean();
	tweens[0].update(0.5);
	view.leanMoved = true; // pointer.js: THE CONTROLS TOOK A WHEEL
	view.camera.position.y -= 3; // THE ZOOM
	const there = view.camera.position.clone();
	tweens[0].update(0.6);
	assert.equal(view.leanHome, null);
	assert.equal(view.dealEase, null);
	assert.ok(view.camera.position.distanceTo(there) < 1e-9, "stays where the zoom put it");
});

test("T25-F8: the way back asked mid glide in goes home whatever the flag says (the dealEase guard)", () => {
	lean().lean();
	tweens[0].update(0.5);
	lean().back();
	land();
	assert.ok(view.camera.position.distanceTo(HOME) < 1e-9, "back home");
});
})();
