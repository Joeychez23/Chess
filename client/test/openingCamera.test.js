// TASK 23 S2: A CHESS CARDS GAME'S OPENING CAMERA (three/openingCamera.js): THE WHOLE HAND IN VIEW, THE BOTTOM OF THE SCREEN ON THE DESK AT z 26.6, THE BOARD CLEAR OF THE LIFTED CARD'S PREVIEW
// (board3D.css .cardPreview). THEN camera.js'S WIRING ON A STUBBED BOARD: A RESOLVE HOOK SWAPS ITS index.js, pointer.js, room.js, monitor.js & lean.js FOR test/helpers/cameraStub.mjs
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { registerHooks } = require("node:module");
const { pathToFileURL } = require("node:url");

global.window = { matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {}, devicePixelRatio: 1 }; // constants.js READS ITS MEDIA QUERIES AS IT LOADS
global.getComputedStyle = () => ({ paddingLeft: "0", paddingRight: "0", paddingTop: "0", paddingBottom: "0" });
const STUB = path.join(__dirname, "helpers/cameraStub.mjs");
const SWAPPED = new Set(["./index.js", "./pointer.js", "./room.js", "./monitor/monitor.js", "./lean.js"]);
registerHooks({
	resolve: (specifier, context, next) => (context.parentURL && context.parentURL.endsWith("/three/camera.js") && SWAPPED.has(specifier)
		? { url: pathToFileURL(STUB).href, shortCircuit: true } : next(specifier, context)),
});
const THREE = require("../../node_modules/three/build/three.module.js");
const { openingCamera, OPENING_TILT } = require("../src/js/gameplay/three/openingCamera.js");
const { tableSpots } = require("../src/js/gameplay/three/tableLayout.js");
const { CARD_SIZE } = require("../src/js/gameplay/three/cardLayout.js");
const { BOARD_SIZE, PIECE_TOP, DESK_Y, FOV, SMALL_FOV, FIT_NDC, MAX_DISTANCE } = require("../src/js/gameplay/three/constants.js");
const camera = require("../src/js/gameplay/three/camera.js");
const board = require(STUB);

const BOTTOM_Z = 21.6, TOLERANCE = 0.05; // ON THE LEATHER EDGE, JUST PAST THE GREEN (THE USER'S PICKED VIEW, 2026-11-25; WAS 26.6)
const DESK_EDGE = 32, CEILING = 96, SOUTH_WALL = 115 - 2.6; // RULINGS T23-8 & T23-10. _dep/generator/build_library.py: DESK y0 -32 -> z 32, CEIL 96, ROOM y0 -115 -> z 115 LESS ITS WAINSCOT RAIL (2.6)
// pinned: THE BOTTOM ON THE DESK AT BOTTOM_Z (null: EITHER, BY FOV: A WIDE WINDOW AT FOV 45 HOLDS THE HAND CLOSER THAN THE PIN SINCE THE USER'S PICKED VIEW). NOT AT A PORTRAIT WINDOW: THERE THE PIN WOULD LOOK FAR PAST THE BOARD (RULING T23-5), SO THE CAMERA COMES AS CLOSE AS THE HAND, THE DESK'S EDGE & THE ROOM LET IT (T23-7)
const SIZES = [["desktop 16:10", 1440, 900, null], ["desktop 16:9", 1600, 900, null], ["narrow 4:3", 1024, 768, null], ["portrait 700x1000", 700, 1000, false], ["portrait 650x1000", 650, 1000, false]]; // FINE-POINTER WINDOWS (renderer can3D)
const FOVS = [FOV, SMALL_FOV]; // SMALL_FOV: A SMALL SCREEN'S (camera.js resize), FOR WHEN PHONES GET 3D
const fitsRoom = (spot) => spot.position.y < CEILING && Math.abs(spot.position.z) < SOUTH_WALL; // THE ROOM TURNS WITH THE PLAYER'S SIDE: BLACK'S SOUTH WALL IS AT z -115
const UP = new THREE.Vector3(0, 1, 0);
const move = (id) => ({ id, key: "move", piece: "p" });
// THE KING CARD, 5 MOVE CARDS, 1 ACTIVE, THE PASSIVE & 2 CURSES (10); UNDERDOG: A 6TH MOVE CARD & A SECOND ACTIVE (12)
const hand = (underdog) => ({
	you: "w", effects: [], piled: [],
	players: {
		w: { king: true, moves: Array.from({ length: underdog ? 6 : 5 }, (_, i) => move(`m${i}`)), actives: Array.from({ length: underdog ? 2 : 1 }, (_, i) => ({ id: `a${i}`, key: "stronghold" })), passive: { id: "p", key: "veto" }, curses: [{ id: "x1", key: "shackles" }, { id: "x2", key: "shackles" }], spot: [], pile: { n: 0, top: null }, kept: null },
		b: { king: true, hand: { count: 10, shown: [] }, spot: [], pile: { n: 0, top: null }, kept: null },
	},
});
const handCorners = (underdog) => [...tableSpots(hand(underdog), { base: DESK_Y + 0.005, layer: 0.031 }).values()].filter((s) => s.hand)
	.flatMap((s) => [-1, 1].flatMap((dx) => [-1, 1].flatMap((dz) => [0, 1.1].map((lift) => [s.x + dx * CARD_SIZE.w / 2, s.y + lift, s.z + dz * CARD_SIZE.h / 2])))); // LIFTED (cardTable.js PICK_LIFT) TOO
const boardCorners = [-1, 1].flatMap((x) => [-1, 1].flatMap((z) => [0, PIECE_TOP].map((y) => [x * BOARD_SIZE / 2, y, z * BOARD_SIZE / 2])));

function lens(spot, w, h, fov = FOV) { // A three.js CAMERA AT THE SPOT
	const c = new THREE.PerspectiveCamera(fov, w / h, 0.1, 1000);
	c.position.set(spot.position.x, spot.position.y, spot.position.z);
	c.lookAt(spot.target.x, spot.target.y, spot.target.z);
	c.updateMatrixWorld();
	return c;
}
const ndc = (c, [x, y, z], angle) => new THREE.Vector3(x, y, z).applyAxisAngle(UP, angle).project(c); // ROOM SPACE, TURNED WITH THE PLAYER'S SIDE (room.js turnRoom)
function bottomZ(c) { // WHERE THE MIDDLE OF THE SCREEN'S BOTTOM EDGE MEETS THE DESK
	const r = new THREE.Raycaster();
	r.setFromCamera(new THREE.Vector2(0, -1), c);
	return r.ray.origin.z + r.ray.direction.z * (DESK_Y - r.ray.origin.y) / r.ray.direction.y;
}

// EVERY CARD OF BOTH HANDS, THE BOARD IN VIEW & CLEAR OF THE PREVIEW, THE CAMERA IN THE ROOM & THE BOTTOM NO FURTHER OUT THAN THE DESK'S EDGE. WHAT ELSE THE TESTS NEED
function checkSpot(spot, w, h, fov, angle) {
	assert.ok(spot, "a spot");
	assert.ok(fitsRoom(spot), `the camera at y ${spot.position.y.toFixed(1)}, z ${spot.position.z.toFixed(1)}: inside the room (T23-10)`);
	const c = lens(spot, w, h, fov);
	let widest = 0, tallest = 0;
	for (const underdog of [false, true]) {
		for (const p of handCorners(underdog)) {
			const q = ndc(c, p, angle);
			assert.ok(q.z < 1 && Math.abs(q.x) <= 1 && Math.abs(q.y) <= 1, `${underdog ? 12 : 10} cards: ${p} at ${q.x.toFixed(3)}, ${q.y.toFixed(3)}`);
			widest = Math.max(widest, Math.abs(q.x));
			tallest = Math.max(tallest, Math.abs(q.y));
		}
	}
	const pts = boardCorners.map((p) => ndc(c, p, angle));
	for (const q of pts) { assert.ok(q.z < 1 && Math.abs(q.x) <= 1 && Math.abs(q.y) <= 1, "the board & its edge pieces' tops"); }
	const pw = Math.min(200, 0.3 * w), right = -1 + 2 * (16 + pw) / w, band = pw * (CARD_SIZE.h / CARD_SIZE.w) / h; // board3D.css: LEFT 16px, min(200px, 30vw) WIDE, CENTRED UP & DOWN
	const left = Math.min(...pts.map((q) => q.x)), low = Math.min(...pts.map((q) => q.y)), high = Math.max(...pts.map((q) => q.y));
	assert.ok(left >= right - 1e-6 || low > band || high < -band, `the board (left ${left.toFixed(3)}) clear of the preview (right ${right.toFixed(3)})`);
	const bottom = angle ? -bottomZ(c) : bottomZ(c);
	assert.ok(bottom <= DESK_EDGE + TOLERANCE, `the bottom at z ${bottom.toFixed(2)}: no further out than the desk's edge (T23-8)`);
	return { widest, tallest, bottom, tz: angle ? -spot.target.z : spot.target.z, left, right, high, band };
}

for (const fov of FOVS) {
	for (const [name, w, h, pinned] of SIZES) {
		for (const angle of [0, Math.PI]) {
			const pin = pinned === null ? fov === SMALL_FOV : pinned; // T25-M3: THE DESKTOP & NARROW ROWS ARE PINNED AT FOV 30 & NOT AT FOV 45 (THE HAND IS HELD CLOSER), EACH BRANCH NOW REQUIRED
			const where = pinned === null ? "pinned where the hand allows, else the camera as close as it can come" : pinned ? `the bottom on the desk at z ${BOTTOM_Z} ± ${TOLERANCE}` : "the camera as close as the hand, the desk's edge & the room allow";
			test(`opening camera, fov ${fov}, ${name}, ${angle ? "black" : "white"}: every card of a 10 & a 12 card hand in view, ${where}, the board in view & clear of the preview`, () => {
				const spot = openingCamera({ fov, width: w, height: h, angle });
				const { widest, tallest, bottom } = checkSpot(spot, w, h, fov, angle); // AT FOV 30 THESE TWO PORTRAIT SIZES TAKE A SHALLOWER TILT (T23-11): 40 DEGREES WOULD NEED A CAMERA PAST THE CEILING
				if (pin) { assert.ok(Math.abs(bottom - BOTTOM_Z) <= TOLERANCE, `bottom at ${bottom}`); assert.equal(spot.tilt, OPENING_TILT, "at OPENING_TILT"); return; }
				// RULING T23-7: THE PIN DROPPED, THE CAMERA AS CLOSE AS IT CAN COME: THE HAND'S OUTER CORNER AT THE FIT'S SIDE, ITS NEAR EDGE AT THE FIT'S BOTTOM OR THE VIEW'S BOTTOM AT THE DESK'S EDGE (ANY CLOSER BREAKS ONE)
				assert.ok(widest >= FIT_NDC - 0.01 || tallest >= FIT_NDC - 0.01 || bottom >= DESK_EDGE - 0.1, `the hand's outer corner at ${widest.toFixed(3)}, its near edge at ${tallest.toFixed(3)}, the bottom at ${bottom.toFixed(2)}: the camera could come closer`);
				assert.ok(Math.abs(bottom - BOTTOM_Z) > TOLERANCE, "the pin let go");
			});
		}
	}
}

// RULING T23-11 (WITH T23-7, T23-8 & T23-10): WHERE NO CAMERA INSIDE THE ROOM HOLDS THE HAND AT 40 DEGREES, THE FIRST SHALLOWER TILT THAT DOES, IN 1 DEGREE STEPS: EVERY STEEPER ONE FROM 40 GIVES
// null. AT IT THE BIGGEST BOARD: THE CAMERA AS CLOSE AS THE HAND LETS IT (ITS OUTER CORNER AT FIT_NDC), THE TARGET PAST THE BOARD AS FAR AS THAT NEEDS
const DEG = Math.PI / 180;
test("390x844, 520x1000 & 540x1000 at fov 45 open at the first tilt past 40 degrees that holds the whole hand inside the room, the bottom inside the desk, the camera as close as it can come", () => {
	for (const [w, h] of [[390, 844], [520, 1000], [540, 1000]]) {
		for (const angle of [0, Math.PI]) {
			const spot = openingCamera({ fov: FOV, width: w, height: h, angle });
			const { widest, tz } = checkSpot(spot, w, h, FOV, angle);
			assert.ok(spot.tilt > OPENING_TILT + DEG / 2, `${w}x${h}: tilt ${(spot.tilt / DEG).toFixed(1)}, shallower than 40`);
			for (let deg = 40; deg < Math.round(spot.tilt / DEG); deg++) { assert.equal(openingCamera({ fov: FOV, width: w, height: h, angle, tilt: deg * DEG }), null, `${w}x${h}: ${deg} degrees fits, steeper than ${(spot.tilt / DEG).toFixed(1)}`); }
			assert.ok(widest >= FIT_NDC - 0.01, `${w}x${h}: the hand's outer corner at ${widest.toFixed(3)}: the camera could come closer`);
			assert.ok(tz < -BOARD_SIZE / 2, `${w}x${h}: the target at z ${tz.toFixed(2)}, past the board`);
		}
	}
});

// RULING T23-12: WHERE NO TILT FROM 40 TO MAX_TILT HOLDS THE HAND INSIDE THE ROOM (ASPECT ABOUT 0.41 OR NARROWER AT FOV 45, ABOUT 0.63 AT FOV 30): null, & camera.js KEEPS THE LIBRARY'S VIEW (BELOW).
// AT THE OPENING TILT ITSELF THE ROOM STILL CAPS THE CAMERA (T23-10): THE NARROW PORTRAIT SIZES GIVE null THERE, NOT A CAMERA PAST THE CEILING OR THE SOUTH WALL
test("300x1000, 250x1000 & 150x1000 at both fovs & 390x844 & 540x1000 at fov 30 give null; at 40 degrees 540, 520 & 390 wide give null at both fovs", () => {
	for (const fov of FOVS) {
		for (const [w, h] of [[300, 1000], [250, 1000], [150, 1000]]) { assert.equal(openingCamera({ fov, width: w, height: h }), null, `${w}x${h} fov ${fov}`); }
		for (const [w, h] of [[540, 1000], [520, 1000], [390, 844]]) { assert.equal(openingCamera({ fov, width: w, height: h, tilt: OPENING_TILT }), null, `${w}x${h} fov ${fov} at 40 degrees`); }
	}
	for (const [w, h] of [[390, 844], [540, 1000]]) { assert.equal(openingCamera({ fov: SMALL_FOV, width: w, height: h }), null, `${w}x${h} fov ${SMALL_FOV}`); }
});

// I1, T23-8 & T23-10 OVER A FUZZ: NO THROW; A SPOT HOLDS THE WHOLE HAND & THE BOARD, INSIDE THE ROOM, THE BOTTOM INSIDE THE DESK; null ONLY ON A PORTRAIT WINDOW
test("opening camera: every size from a fuzz either fits the whole hand, the camera in the room & the bottom inside the desk's edge, or is null (portrait only)", () => {
	let seed = 7;
	const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
	for (let i = 0; i < 300; i++) {
		const fov = FOVS[i % 2], w = Math.round(100 + rand() * 2500), h = Math.round(300 + rand() * 1400), angle = i % 4 < 2 ? 0 : Math.PI, spot = openingCamera({ fov, width: w, height: h, angle });
		if (!spot) { assert.ok(w / h < 1, `${w}x${h} fov ${fov}: null on a landscape window`); continue; }
		checkSpot(spot, w, h, fov, angle);
		if (spot.tilt !== OPENING_TILT) { assert.equal(openingCamera({ fov, width: w, height: h, angle, tilt: spot.tilt - DEG }), null, `${w}x${h} fov ${fov}: a degree steeper fits too (T23-11)`); }
	}
});

test("opening camera: steeper than today's angle, so the board is bigger on screen than at today's tilt with the same hand & bottom", () => {
	const today = Math.atan2(30.5 + 6.5, 24.5); // constants.js ROOM_CAMERA_*: 56.5 DEGREES FROM STRAIGHT DOWN
	const tall = (spot) => { const c = lens(spot, 1440, 900), ys = boardCorners.filter((p) => p[1] === 0).map((p) => ndc(c, p, 0).y); return Math.max(...ys) - Math.min(...ys); };
	const spot = openingCamera({ fov: FOV, width: 1440, height: 900 });
	assert.ok(spot.tilt < today);
	assert.ok(tall(spot) > tall(openingCamera({ fov: FOV, width: 1440, height: 900, tilt: today })));
});

// camera.js ON A STUBBED BOARD AT w x h, A CHESS CARDS GAME WHEN cards
function mounted(w, h, cards) {
	const cam = new THREE.PerspectiveCamera(FOV, 1, 0.1, 1000);
	const controls = { target: new THREE.Vector3(), maxDistance: MAX_DISTANCE, maxTargetRadius: BOARD_SIZE / 2, minDistance: 12, update() { cam.lookAt(this.target); } };
	const v = { camera: cam, controls, container: { clientWidth: w, clientHeight: h }, renderer: { setPixelRatio() {}, setSize() {} }, small: null, phone: false, side: "w", tableArgs: cards ? [hand(false), [], {}] : null, table: cards ? {} : null, cards: null, dealHome: null, pileBox: null, animations: { add() {} }, leaving: [] };
	board.setView(v);
	camera.resize();
	camera.placeCamera(0);
	return v;
}
const at = (vec) => [vec.x, vec.y, vec.z].map((n) => Math.round(n * 1000) / 1000 + 0); // + 0: NO -0

test("a Chess Cards game's window drag keeps the last opening spot's limits & solves the new size once it settles", async () => {
	const v = mounted(1440, 900, true), wide = v.controls.maxDistance;
	v.container = { clientWidth: 540, clientHeight: 1000 };
	camera.resize([]); // THE ResizeObserver'S CALL, MID-DRAG
	assert.equal(v.controls.maxDistance, wide, "no search mid-drag");
	await new Promise((done) => setTimeout(done, camera.CARD_SETTLE_MS + 50));
	assert.equal(v.controls.maxDistance, Math.max(MAX_DISTANCE, openingCamera({ fov: FOV, width: 540, height: 1000 }).distance), "solved once the drag stops");
});

test("a game without cards opens exactly where it did: the library's view, the same limits", () => {
	const v = mounted(1440, 900, false);
	assert.deepEqual(at(v.camera.position), [0, 24.5, 30.5]);
	assert.deepEqual(at(v.controls.target), [0, 0, -6.5]);
	assert.equal(v.controls.maxDistance, MAX_DISTANCE);
	assert.equal(v.controls.maxTargetRadius, BOARD_SIZE / 2);
});

test("a Chess Cards game opens at openingCamera for its size, its limits let the camera stay there, & a framed deal's end restores them", () => {
	for (const [w, h] of [...SIZES.map(([, w, h]) => [w, h]), [390, 844], [540, 1000]]) { // THE LAST TWO AT A SHALLOWER TILT (T23-11)
		const v = mounted(w, h, true), spot = openingCamera({ fov: FOV, width: w, height: h, angle: 0 });
		assert.deepEqual(at(v.camera.position), at(spot.position));
		assert.deepEqual(at(v.controls.target), at(spot.target));
		assert.ok(v.controls.maxPolarAngle >= spot.tilt - 1e-9, "the tilt limit allows it");
		assert.ok(v.controls.maxDistance >= spot.distance - 1e-9, "the zoom limit allows it");
		assert.ok(v.controls.maxTargetRadius >= Math.hypot(spot.target.x, spot.target.z) - 1e-9, "the pan limit allows it");
		v.controls.maxTargetRadius = Infinity; // AN OPENED PILE LIFTED IT (framePile)
		v.dealHome = { position: v.camera.position.clone(), target: v.controls.target.clone(), maxDistance: v.controls.maxDistance, back: false };
		camera.unframeDeal(false);
		assert.ok(v.controls.maxTargetRadius >= Math.hypot(spot.target.x, spot.target.z) - 1e-9, "back to the card game's pan limit, not the board's");
		assert.deepEqual(at(v.controls.target), at(spot.target));
	}
});

test("a Chess Cards game on a canvas too narrow for the hand in the room at any tilt (150x1000, 300x1000) doesn't throw in resize or placeCamera: the library's view & limits", () => {
	for (const [w, h] of [[150, 1000], [300, 1000]]) {
		const v = mounted(w, h, true);
		assert.deepEqual(at(v.camera.position), [0, 24.5, 30.5]);
		assert.equal(v.controls.maxDistance, MAX_DISTANCE);
		assert.equal(v.controls.maxTargetRadius, BOARD_SIZE / 2);
	}
});

test("the card state before the room's table (the baize stage, fogged far off) keeps the library's view: the hand's view comes with the table", () => {
	const v = mounted(1024, 768, true);
	v.table = null;
	camera.openCardCamera();
	assert.deepEqual(at(v.camera.position), [0, 24.5, 30.5]);
	assert.equal(v.controls.maxDistance, MAX_DISTANCE);
	v.table = {};
	camera.openCardCamera();
	assert.deepEqual(at(v.camera.position), at(openingCamera({ fov: FOV, width: 1024, height: 768 }).position));
});

test("the card state arriving at the monitor makes the hand's view the spot the camera comes back to, & leaving the monitor lands there", () => {
	const v = mounted(1440, 900, false), spot = openingCamera({ fov: FOV, width: 1440, height: 900, angle: 0 });
	v.monitor = { state: "zooming", reset() { throw new Error("pulled off the monitor"); } };
	v.camera.position.set(1, 2, 3);
	v.home = { position: new THREE.Vector3(4, 5, 6), target: new THREE.Vector3(0, 0, -1) }; // WHERE THE DESK CAMERA WAS (pointer.js leaveDesk)
	v.tableArgs = [hand(false), [], {}];
	v.table = {};
	board.setIdle(false);
	try { camera.openCardCamera(); } finally { board.setIdle(true); }
	assert.deepEqual(at(v.camera.position), [1, 2, 3], "at the monitor: the camera stays");
	assert.deepEqual(at(v.home.position), at(spot.position), "home is the hand's view");
	assert.deepEqual(at(v.home.target), at(spot.target));
	camera.landHome();
	assert.deepEqual(at(v.camera.position), at(spot.position), "back at the desk: the hand's view");
	assert.deepEqual(at(v.controls.target), at(spot.target));
});

test("the card state arriving on a mounted board opens the hand's view only when the camera isn't at the monitor", () => {
	const v = mounted(1440, 900, false), spot = openingCamera({ fov: FOV, width: 1440, height: 900, angle: 0 });
	v.monitor = { state: "zooming", reset() { throw new Error("pulled off the monitor"); } }; // NOT "zoomed": resize WOULD REFIT THE GLASS (refitZoom), NOT WHAT THIS TESTS
	v.camera.position.set(1, 2, 3);
	v.tableArgs = [hand(false), [], {}];
	v.table = {};
	board.setIdle(false);
	try { camera.openCardCamera(); } finally { board.setIdle(true); }
	assert.deepEqual(at(v.camera.position), [1, 2, 3], "at the monitor: the camera stays");
	assert.ok(v.controls.maxDistance >= spot.distance - 1e-9, "the limits are the card game's, for when it comes back");
	camera.openCardCamera();
	assert.deepEqual(at(v.camera.position), at(spot.position), "at the desk: the hand's view");
	assert.deepEqual(at(v.controls.target), at(spot.target));
});

// FINAL RE-REVIEW 1, N1: A WINDOW DRAG FROM NARROW TO WIDE. camera.js's SETTLE (resize(true), CARD_SETTLE_MS AFTER THE LAST EVENT) SETS THE WIDE SIZE'S LIMITS & THE CONTROLS PULL THE CAMERA IN
// (AS OrbitControls' update, three 0.187: THE OFFSET'S TILT & DISTANCE CLAMPED, THE TARGET WITHIN maxTargetRadius). THE PLAQUES ARE LAID AGAIN ONLY ONCE IT HAS: ON SCREEN, OR NONE UP (THE 2D BUTTONS)
test("a narrow-to-wide resize lays the plaques again after the settle moves the camera: on screen, or none up", async (t) => {
	t.mock.method(console, "warn", () => {});
	global.document = { createElement: (tag) => (tag === "canvas" ? { width: 0, height: 0, getContext: () => new Proxy({}, { get: (o, k) => (k === "measureText" ? (x) => ({ width: String(x).length }) : k in o ? o[k] : () => {}), set: (o, k, val) => { o[k] = val; return true; } }) } : { setAttribute() {}, remove() {}, textContent: "" }), body: { append() {} } }; // AS cardButtons.test.js's
	const { createCardTable, deskInView } = require("../src/js/gameplay/three/cardTable.js");
	const { createAnimations } = require("../src/js/gameplay/three/animations.js");
	const { plaqueAnchor } = require("../src/js/gameplay/three/tableLayout.js");
	const S = require("../src/js/gameplay/cards/select.js");
	const { fromFen } = require("../../cards-engine/board.js");
	const CATALOG = { veto: { name: "Veto", rarity: "rare" }, foresight: { name: "Foresight", rarity: "common" }, "all-or-nothing": { name: "All or Nothing", rarity: "epic" }, shackles: { name: "Shackles", rarity: "common" } };
	const game = (more = {}) => ({ you: "w", board: fromFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"), effects: [],
		players: { w: { king: true, kingSkulls: 2, moves: Array.from({ length: 5 }, (_, i) => ({ id: `m${i}`, key: "move", piece: "pnbrq"[i] })), actives: [{ id: "a1", key: "foresight" }], passive: { id: "p1", key: "veto" }, curses: [{ id: "k1", key: "shackles" }], spot: [], pile: { n: 0, top: null }, kept: null },
			b: { king: true, hand: { count: 9, shown: [] }, spot: [], pile: { n: 0, top: null }, kept: null } }, ...more });
	const duel = game({ duel: { round: 1, player: "w", piece: "w12", card: "all-or-nothing", step: "decide", hands: { w: [{ r: 9, s: "h" }, { r: 4, s: "d" }, null], b: [{ r: 3, s: "c" }, null, null] }, picked: { w: [0], b: [0] }, spades: null } });
	const PROMPTS = [["duel", duel, { duel: true }, { pick: [{ type: "duel", stop: true }, { type: "duel", stop: false }], choosing: true }], ["passive", game(), { card: "p1" }, { pick: [{ type: "passive" }, { type: "discard", cards: ["p1"] }] }],
		["active", game(), { card: "a1" }, { pick: [{ type: "discard", cards: ["a1"] }] }], ["pair", game(), { card: "m0" }, { pick: [{ type: "discard", cards: ["m0", "m1"] }, { type: "discard", cards: ["m0"] }] }]];
	const template = () => { const g = new THREE.Group(); const face = new THREE.Mesh(new THREE.PlaneGeometry(4.3, 6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ name: "cardFace" })); face.position.y = 0.03; g.add(face, new THREE.Mesh(new THREE.PlaneGeometry(4.3, 6).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ name: "cardBack" }))); return g; };
	let upBefore = 0, moved = 0;
	for (const [[w0, h0], [w1, h1]] of [[[540, 1000], [1440, 900]], [[600, 1100], [1600, 900]], [[700, 1000], [1920, 1080]], [[650, 1250], [2200, 800]]]) {
		for (const [what, v, at, ask] of PROMPTS) {
			const s = mounted(w0, h0, true), cam = s.camera, room = new THREE.Group();
			s.controls.update = function () {
				const sph = new THREE.Spherical().setFromVector3(cam.position.clone().sub(this.target));
				sph.phi = Math.min(sph.phi, this.maxPolarAngle);
				sph.radius = Math.max(this.minDistance, Math.min(this.maxDistance, sph.radius));
				this.target.clampLength(0, this.maxTargetRadius);
				cam.position.copy(this.target).add(new THREE.Vector3().setFromSpherical(sph));
				cam.lookAt(this.target);
			};
			const table = createCardTable({ template: template(), room, animations: createAnimations(() => {}), requestRender() {}, inView: () => deskInView(cam, room), camera: cam });
			s.table = table;
			s.cardSpotFor = table; // camera.js resize: THE OPENING SPOT IS THIS TABLE'S (openCardCamera)
			let relays = 0;
			board.setRelay(() => { relays++; table.relayButtons(); }); // index.js relayPlaques
			table.set(v, { catalog: CATALOG });
			if (table.showButtons(S.promptButtons(ask, v, CATALOG).map(({ id, label }) => ({ id, label })), plaqueAnchor(at, v, false))) { upBefore++; }
			const from = cam.position.clone(), where = `${what} ${w0}x${h0} -> ${w1}x${h1}`;
			s.container = { clientWidth: w1, clientHeight: h1 };
			camera.resize([]); // THE ResizeObserver'S CALL
			await new Promise((done) => setTimeout(done, camera.CARD_SETTLE_MS + 50));
			if (cam.position.distanceTo(from) > 1e-6) { moved++; }
			assert.ok(relays > 0, `${where}: laid again`);
			room.updateMatrixWorld(true);
			for (const m of room.children.filter((o) => o.userData.button !== undefined)) {
				m.geometry.computeBoundingBox();
				const b = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld); // THE PLAQUE, BEVEL INCLUDED (NOT ITS HIDDEN FOCUS FRAME: REVIEW N4)
				for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
					const q = new THREE.Vector3(x, y, z).project(cam);
					assert.ok(Math.abs(q.x) <= 1 + 1e-6 && Math.abs(q.y) <= 1 + 1e-6, `${where}: ${m.userData.button} off screen at ndc (${q.x.toFixed(2)}, ${q.y.toFixed(2)})`);
				}
			}
			board.setRelay(() => {});
			table.dispose();
		}
	}
	assert.ok(upBefore >= 4 && moved >= 8, `plaques up before ${upBefore}, camera moved by the settle ${moved}`);
});

// FINAL RE-REVIEW 2, R2-1 (CALL T23-30): FLIP BOARD WITH A SQUARE-ANCHORED PROMPT UP. flow.js LAYS IT ON THE NEW SIDE AS THE TURN BEGINS (renderer drawBoard: setSide, THEN tableUp),
// AGAINST THE CAMERA BEFORE THE TURN. FROM AN ORBITED CAMERA THE TURN LANDS ELSEWHERE, SO THE PLAQUES ARE LAID AGAIN ONCE IT LANDS (stepCamera'S END, OR landTurn): ON SCREEN, OR NONE UP & THE 2D BUTTONS SHOWN.
// THE CASES ARE THE REVIEW'S fuzz3.cjs FAILURES, EACH ALSO FLIPPED STRAIGHT
test("a Flip Board turn from an orbited camera lays the plaques again where it lands: on screen, or none up & the 2D buttons shown; a straight flip keeps them", (t) => {
	t.mock.method(console, "warn", () => {});
	global.document = { createElement: (tag) => (tag === "canvas" ? { width: 0, height: 0, getContext: () => new Proxy({}, { get: (o, k) => (k === "measureText" ? (x) => ({ width: String(x).length }) : k in o ? o[k] : () => {}), set: (o, k, val) => { o[k] = val; return true; } }) } : { setAttribute() {}, remove() {}, textContent: "" }), body: { append() {} } }; // AS cardButtons.test.js's
	const { createCardTable, deskInView } = require("../src/js/gameplay/three/cardTable.js");
	const { createAnimations } = require("../src/js/gameplay/three/animations.js");
	const { plaqueAnchor } = require("../src/js/gameplay/three/tableLayout.js");
	const { FLIP_MS } = require("../src/js/gameplay/three/constants.js");
	const S = require("../src/js/gameplay/cards/select.js");
	const { fromFen } = require("../../cards-engine/board.js");
	const CATALOG = { veto: { name: "Veto", rarity: "rare" }, foresight: { name: "Foresight", rarity: "common" }, shackles: { name: "Shackles", rarity: "common" } };
	const v = { you: "w", board: fromFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"), effects: [],
		players: { w: { king: true, kingSkulls: 2, moves: Array.from({ length: 5 }, (_, i) => ({ id: `m${i}`, key: "move", piece: "pnbrq"[i] })), actives: [{ id: "a1", key: "foresight" }], passive: { id: "p1", key: "veto" }, curses: [{ id: "k1", key: "shackles" }], spot: [], pile: { n: 0, top: null }, kept: null },
			b: { king: true, hand: { count: 9, shown: [] }, spot: [], pile: { n: 0, top: null }, kept: null } } };
	const prompt = (kind, sq) => (kind === "skull" ? [{ square: sq }, { skull: { type: "move", card: "king", from: sq, to: sq } }]
		: [S.plaquePrompt({ pick: [{ type: "move", card: "m0", from: sq, to: "e4" }, { type: "move", card: null, from: sq, to: "e4" }], hidden: true }), { pick: [{ type: "move", card: "m0", from: sq, to: "e4" }, { type: "move", card: null, from: sq, to: "e4" }] }]);
	const template = () => { const g = new THREE.Group(); const face = new THREE.Mesh(new THREE.PlaneGeometry(4.3, 6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ name: "cardFace" })); face.position.y = 0.03; g.add(face, new THREE.Mesh(new THREE.PlaneGeometry(4.3, 6).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ name: "cardBack" }))); return g; };
	const CASES = [["skull", "d2", 2577, 863, "b", 60], ["skull", "c5", 2592, 694, "b", 60], ["fog", "a6", 1955, 733, "w", -45], ["skull", "c2", 604, 1226, "b", 60], ["skull", "f7", 1831, 711, "w", 60], ["fog", "f7", 445, 1165, "b", 30], ["fog", "c4", 3093, 818, "b", 60], ["skull", "f1", 376, 1223, "w", -30]];
	let straightUp = 0;
	for (const [kind, sq, w, h, from, deg] of CASES) {
		for (const az of [deg, 0]) {
			for (const land of ["stepped", "landTurn"]) {
				const s = mounted(w, h, true), cam = s.camera, room = new THREE.Group(), to = from === "b" ? "w" : "b";
				s.controls.maxPolarAngle = Math.PI;
				s.room = room;
				s.side = from;
				const table = createCardTable({ template: template(), room, animations: createAnimations(() => {}), requestRender() {}, inView: () => deskInView(cam, room), camera: cam });
				s.table = table;
				s.cardSpotFor = table;
				camera.resize(true);
				camera.placeCamera(from === "b" ? Math.PI : 0);
				camera.setRoomSide(from);
				cam.position.sub(s.controls.target).applyAxisAngle(UP, az * Math.PI / 180).add(s.controls.target); // ORBITED ABOUT ITS TARGET
				cam.lookAt(s.controls.target);
				const [at, ask] = prompt(kind, sq), list = S.promptButtons({ skull: ask.skull || null, pick: ask.pick || [], choosing: false }, v, CATALOG).map(({ id, label }) => ({ id, label }));
				table.set(v, { catalog: CATALOG });
				table.showButtons(list, plaqueAnchor(at, v, from === "b"));
				let shown2D = null;
				board.setRelay(() => { const due = s.relayDue; s.relayDue = false; if (!due) { return; } const was = table.buttonCount() > 0, now = table.relayButtons(); if (now !== was) { shown2D = !now; } }); // index.js relayPlaques: onTable -> flow.js LAYS THE PROMPT AGAIN
				camera.setSide(to, true); // renderer drawBoard: setSide(viewColor, animate) ...
				shown2D = !table.showButtons(list, plaqueAnchor(at, v, to === "b")); // ... THEN tableUp: flow.js showPrompt, BEFORE THE FIRST FRAME
				camera.stepCamera(0);
				if (land === "stepped") { camera.stepCamera(FLIP_MS + 1); } else { camera.landTurn(); }
				const where = `${kind} ${sq} ${w}x${h} ${from}->${to} az ${az} ${land}`, up = room.children.filter((o) => o.userData.button !== undefined);
				assert.equal(s.cameraTurn, null, `${where}: landed`);
				assert.equal(shown2D, up.length === 0, `${where}: the 2D buttons show exactly when no plaque is up (${up.length} up)`);
				room.updateMatrixWorld(true);
				for (const m of up) {
					m.geometry.computeBoundingBox();
					const b = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld);
					for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
						const q = new THREE.Vector3(x, y, z).project(cam);
						assert.ok(Math.abs(q.x) <= 1 + 1e-6 && Math.abs(q.y) <= 1 + 1e-6, `${where}: ${m.userData.button} off screen at ndc (${q.x.toFixed(2)}, ${q.y.toFixed(2)})`);
					}
				}
				if (!az && up.length) { straightUp++; }
				board.setRelay(() => {});
				table.dispose();
			}
		}
	}
	assert.ok(straightUp >= 12, `straight flips with plaques up where they land: ${straightUp} of 16`);
});
