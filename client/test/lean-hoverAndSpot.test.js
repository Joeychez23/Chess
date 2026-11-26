const { test } = require("node:test");
const assert = require("node:assert/strict");
const { boardHover, leftBoard, setAutoLean, setLeanCamera, retryLean, leanSpot, LEAN_TILT, LEAN_BACK_MS } = require("../src/js/gameplay/three/lean.js");

const calls = [];
let dragging = false; // camera.js'S back() ANSWERS false WHILE A PIECE IS DRAGGED
setLeanCamera({ lean: () => calls.push("lean"), back: () => (dragging ? false : calls.push("back")) });
const fresh = function (t) {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	calls.length = 0;
};

test("off by default: the pointer on the board never moves the camera", (t) => {
	fresh(t);
	boardHover(true);
	boardHover(false);
	t.mock.timers.tick(LEAN_BACK_MS * 3);
	assert.deepEqual(calls, []);
});

test("on: leans as the pointer goes onto the board, back about 0.4 s after it left", (t) => {
	fresh(t);
	setAutoLean(true);
	assert.deepEqual(calls, []); // TURNING IT ON MOVES NOTHING BY ITSELF
	boardHover(true);
	assert.deepEqual(calls, ["lean"]);
	boardHover(false);
	t.mock.timers.tick(LEAN_BACK_MS - 1);
	assert.deepEqual(calls, ["lean"]);
	t.mock.timers.tick(1);
	assert.deepEqual(calls, ["lean", "back"]);
});

test("on: back on the board inside the wait keeps the lean", (t) => {
	fresh(t);
	boardHover(true);
	boardHover(false);
	t.mock.timers.tick(LEAN_BACK_MS - 50);
	boardHover(true);
	t.mock.timers.tick(LEAN_BACK_MS * 3);
	assert.deepEqual(calls, ["lean", "lean"]); // THE CAMERA'S lean() IGNORES THE SECOND WHEN IT IS ALREADY THERE
});

test("turned off: goes back at once, a waiting way back is dropped, later hovers do nothing", (t) => {
	fresh(t);
	boardHover(true);
	boardHover(false);
	setAutoLean(false);
	assert.deepEqual(calls, ["lean", "back"]);
	t.mock.timers.tick(LEAN_BACK_MS * 3);
	boardHover(true);
	assert.deepEqual(calls, ["lean", "back"]);
});

// WHERE A BOARD POINT LANDS ON THE SCREEN (NDC, 1 IS THE EDGE) FOR A CAMERA AT position LOOKING AT THE ORIGIN, y UP
function project(position, point, fov, aspect) {
	const len = Math.hypot(position.x, position.y, position.z);
	const f = { x: -position.x / len, y: -position.y / len, z: -position.z / len }; // FORWARD
	const rl = Math.hypot(f.z, f.x);
	const r = { x: -f.z / rl, y: 0, z: f.x / rl }; // RIGHT = FORWARD x UP
	const u = { x: r.y * f.z - r.z * f.y, y: r.z * f.x - r.x * f.z, z: r.x * f.y - r.y * f.x }; // UP = RIGHT x FORWARD
	const d = { x: point.x - position.x, y: point.y - position.y, z: point.z - position.z };
	const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
	const tan = Math.tan(fov * Math.PI / 360);
	return { x: dot(d, r) / (dot(d, f) * tan * aspect), y: dot(d, u) / (dot(d, f) * tan) };
}

test("the lean spot: 30 degrees from straight down, over the centre, the board filling the screen's height", () => {
	const home = { position: { x: 0, y: 24.5, z: 30.5 }, target: { x: 0, y: 0, z: -6.5 } }; // THE OPENING VIEW
	const spot = leanSpot({ home, fov: 45, aspect: 16 / 9, board: 24, min: 12, max: 70 });
	assert.deepEqual(spot.target, { x: 0, y: 0, z: 0 });
	const { x, y, z } = spot.position;
	assert.ok(Math.abs(Math.atan2(Math.hypot(x, z), y) - LEAN_TILT) < 1e-9);
	assert.ok(Math.abs(LEAN_TILT - Math.PI / 6) < 1e-9);
	assert.ok(Math.abs(x) < 1e-9 && z > 0); // STILL ON THE PLAYER'S SIDE
	const near = project(spot.position, { x: 12, y: 0, z: 12 }, 45, 16 / 9), far = project(spot.position, { x: 12, y: 0, z: -12 }, 45, 16 / 9);
	assert.ok(Math.abs(near.y + 1) < 1e-6, `near edge at the bottom of the screen, got ${near.y}`);
	assert.ok(far.y > 0 && far.y < 1 && Math.abs(near.x) < 1);
});

test("the lean spot keeps the side the player turned the camera to, fits a narrow screen by width, & stays inside the zoom limits", () => {
	const black = leanSpot({ home: { position: { x: 3, y: 20, z: -27 }, target: { x: 3, y: 0, z: 3 } }, fov: 45, aspect: 16 / 9, board: 24, min: 12, max: 70 });
	assert.ok(Math.abs(black.position.x) < 1e-9 && black.position.z < 0);
	const narrow = leanSpot({ home: { position: { x: 0, y: 24.5, z: 30.5 }, target: { x: 0, y: 0, z: 0 } }, fov: 45, aspect: 0.5, board: 24, min: 12, max: 200 });
	assert.ok(Math.abs(project(narrow.position, { x: 12, y: 0, z: 12 }, 45, 0.5).x - 1) < 1e-6);
	const capped = leanSpot({ home: { position: { x: 0, y: 24.5, z: 30.5 }, target: { x: 0, y: 0, z: 0 } }, fov: 45, aspect: 0.5, board: 24, min: 12, max: 20 });
	assert.ok(Math.abs(Math.hypot(capped.position.x, capped.position.y, capped.position.z) - 20) < 1e-9);
});

test("a lean that was blocked is asked for again when the block ends, only while the pointer is still on the board", (t) => {
	fresh(t);
	setAutoLean(true);
	boardHover(true); // camera.js REFUSES THIS ONE (FLIP BOARD TURNING, THE PROMOTION CARDS, THE MONITOR, A FRAMED PILE)
	retryLean();
	assert.deepEqual(calls, ["lean"]); // NOT INSIDE THE CAMERA CODE THAT ENDED THE BLOCK
	t.mock.timers.tick(0);
	assert.deepEqual(calls, ["lean", "lean"]);
	boardHover(false);
	retryLean();
	t.mock.timers.tick(0);
	assert.deepEqual(calls, ["lean", "lean"]);
	t.mock.timers.tick(LEAN_BACK_MS);
	assert.deepEqual(calls, ["lean", "lean", "back"]);
	setAutoLean(false);
	calls.length = 0;
	boardHover(true);
	retryLean();
	t.mock.timers.tick(0);
	assert.deepEqual(calls, []); // THE OPTION OFF: NEVER
});

test("a piece dragged off the board holds the way back until it is dropped", (t) => {
	fresh(t);
	setAutoLean(true);
	boardHover(true);
	boardHover(false);
	dragging = true;
	t.mock.timers.tick(LEAN_BACK_MS * 3);
	assert.deepEqual(calls, ["lean"]);
	dragging = false;
	t.mock.timers.tick(LEAN_BACK_MS);
	assert.deepEqual(calls, ["lean", "back"]);
	setAutoLean(false);
});

test("the lean spot from a turned camera keeps its angle & backs off just enough to keep the whole board on screen", () => {
	for (const [aspect, turn] of [[16 / 9, 45], [16 / 9, 30], [4 / 3, 135], [0.6, 45], [21 / 9, -60]]) {
		const a = turn * Math.PI / 180;
		const home = { position: { x: 40 * Math.sin(a), y: 25, z: 40 * Math.cos(a) }, target: { x: 0, y: 0, z: 0 } };
		const spot = leanSpot({ home, fov: 45, aspect, board: 24, min: 12, max: 400 });
		assert.ok(Math.abs(Math.atan2(spot.position.x, spot.position.z) - a) < 1e-9, `angle kept at ${turn}`);
		const corners = [[12, 12], [12, -12], [-12, 12], [-12, -12]].map(([x, z]) => project(spot.position, { x, y: 0, z }, 45, aspect));
		const edge = Math.max(...corners.flatMap((c) => [Math.abs(c.x), Math.abs(c.y)]));
		assert.ok(Math.abs(edge - 1) < 1e-6, `at ${turn} degrees, ${aspect}: the outermost corner is on the screen's edge, got ${edge}`);
	}
});

test("the board unmounted (leftBoard) forgets the pointer was on it: a later retryLean doesn't lean, & no way back is asked of the old camera", (t) => {
	fresh(t);
	setAutoLean(true);
	boardHover(true);
	boardHover(false); // A WAY BACK IS WAITING
	boardHover(true);
	calls.length = 0;
	leftBoard();
	retryLean();
	t.mock.timers.tick(LEAN_BACK_MS * 3);
	assert.deepEqual(calls, []);
	boardHover(true); // THE NEW BOARD'S FIRST HOVER LEANS AS EVER
	assert.deepEqual(calls, ["lean"]);
	boardHover(false);
	t.mock.timers.tick(LEAN_BACK_MS);
});
