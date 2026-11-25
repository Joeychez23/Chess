// TASK 24: SHAKEN'S BRANCHING BOLTS, GLOW, HALO & CAGES (shaken.js) AND ITS STRIKE FLASH (shakenFlash.js), ALONE AND DRIVEN BY SHAKEN'S STRIKES, WITHOUT WebGL
const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");

global.window = { matchMedia: () => ({ matches: false, addEventListener() {} }) }; // constants.js READS IT AS IT LOADS
const ctx = new Proxy({}, { get: () => () => ({ addColorStop() {} }) }); // EVERY 2D CALL IS A NO-OP (createRadialGradient HANDS BACK A GRADIENT)
global.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
const { Object3D, Group, Texture, Vector3 } = require("three");
const shaken = require("../src/js/gameplay/three/statusFx/shaken.js");
const flashFx = require("../src/js/gameplay/three/statusFx/shakenFlash.js");
const { BLOOM_LAYER, FOV, CELL_SIZE } = require("../src/js/gameplay/three/constants.js");
const { openingCamera } = require("../src/js/gameplay/three/openingCamera.js");
const { STRIKE, FLASH, OVER, cageLayout } = shaken;

const alive = new Set();
afterEach(() => { alive.forEach((fx) => fx.dispose()); });
function track(fx) {
	const dispose = fx.dispose;
	fx.dispose = () => { alive.delete(fx); dispose(); };
	alive.add(fx);
	return fx;
}
function shakenOpts(left, extra) {
	const mesh = new Object3D();
	mesh.geometry = { boundingBox: { min: { y: 0 }, max: { y: 0.83 } } };
	mesh.userData.opacity = 1;
	const root = new Group();
	mesh.add(root);
	return { s: "shaken", id: "p1", left, by: "b", square: "e4", mode: "effects", slot: 0, slots: 1, siblings: [], mesh, root, squareRoot: new Group(), reduce: false, ...extra };
}
function setup(left, extra = {}) {
	const opts = shakenOpts(left, extra);
	return { opts, fx: track(shaken.create(opts.mesh, opts)) };
}
function setupScaled(left, extra = {}) { // AS setup, ON A PIECE SCALED 0.5
	const opts = shakenOpts(left, extra);
	opts.mesh.scale.setScalar(0.5);
	return { opts, fx: track(shaken.create(opts.mesh, opts)) };
}
const cage = (opts, i = 0) => opts.root.getObjectByName("shakenCages").children[i];
const MAIN = shaken.MAIN_VERTS;

// THE FLASH ALONE: shaken.js TELLS IT WHEN & WHICH CAGE STRIKES (strike(i, n)); IT ONLY FADES. FREEING IS COUNTED THROUGH three's "dispose" EVENTS
const map = new Texture(); // shaken.js's REFCOUNTED DOT, PASSED IN
const setupFlash = (more = {}) => {
	const mesh = new Object3D();
	mesh.scale.setScalar(0.5);
	return { s: "shaken", left: 2, siblings: [], mesh, root: new Group(), squareRoot: new Group(), reduce: false, ...more };
};
const join = (fx, opts) => { opts.root.add(fx.object); opts.squareRoot.add(fx.ground); return fx; };
const shown = (fx) => fx.object.visible || fx.ground.visible;
const near = (a, b) => Math.abs(a - b) < 1e-9;

// THE FLASH DRIVEN BY SHAKEN FROM ITS OWN STRIKE BRANCH: ONE CLOCK
const burstOf = (opts) => opts.root.getObjectByName("shakenFlash");
const groundOf = (opts) => opts.squareRoot.getObjectByName("shakenFlashGround");
const cages = (opts) => opts.root.getObjectByName("shakenCages").children;
const lit = (opts) => cages(opts).findIndex((c) => c.getObjectByName("bolts").geometry.drawRange.count > shaken.MAIN_VERTS); // THE CAGE SHAKEN STRUCK (ITS FORKS SHOW)
const world = (o) => o.getWorldPosition(new Vector3());

test("forks: all of them right at a strike, half (rounded up) when cheap, gone before the flash fades", () => {
	assert.ok(shaken.FORKS >= 2);
	assert.equal(shaken.forks(0, false), shaken.FORKS);
	assert.equal(shaken.forks(0, true), Math.ceil(shaken.FORKS / 2));
	assert.ok(shaken.FORK_S < shaken.FLASH, "shorter lived than the main bolt's flash");
	assert.equal(shaken.forks(shaken.FORK_S, false), 0);
	assert.equal(shaken.forks(shaken.FLASH, false), 0);
});

test("a strike draws the forks, then they drop off after FORK_S leaving the main bolts", () => {
	const { opts, fx } = setup(1);
	const bolts = cage(opts).getObjectByName("bolts");
	assert.equal(bolts.geometry.drawRange.count, MAIN, "no forks between strikes");
	fx.update(shaken.STRIKE);
	assert.equal(bolts.geometry.drawRange.count, MAIN + shaken.FORKS * shaken.FORK_VERTS);
	fx.update(shaken.FORK_S);
	assert.equal(bolts.geometry.drawRange.count, MAIN);
});

test("cheap: half the forks", () => {
	const { opts, fx } = setup(1, { cheap: true });
	fx.update(shaken.STRIKE);
	assert.equal(cage(opts).getObjectByName("bolts").geometry.drawRange.count, MAIN + Math.ceil(shaken.FORKS / 2) * shaken.FORK_VERTS);
});

test("each fork starts on a joint of the main bolt and is dimmer (thinner looking) than it", () => {
	const { opts, fx } = setup(1);
	fx.update(shaken.STRIKE);
	const geo = cage(opts).getObjectByName("bolts").geometry, p = geo.attributes.position.array, c = geo.attributes.color.array;
	const joints = [];
	for (let v = 0; v < MAIN; v++) { joints.push(p.slice(v * 3, v * 3 + 3).join()); }
	for (let f = 0; f < shaken.FORKS; f++) {
		const v = MAIN + f * shaken.FORK_VERTS;
		assert.ok(joints.includes(p.slice(v * 3, v * 3 + 3).join()), `fork ${f} branches off the bolt`);
		assert.ok(c[v * 3] < c[0], "dimmer than the main bolt");
	}
});

test("glow: bolts and halo on BLOOM_LAYER (layer 0 kept), off when cheap, switched in place", () => {
	const { opts, fx } = setup(2);
	const glowing = () => [cage(opts).getObjectByName("bolts"), cage(opts).getObjectByName("halo")];
	for (const o of glowing()) { assert.ok(o.layers.isEnabled(BLOOM_LAYER)); assert.ok(o.layers.isEnabled(0)); }
	opts.cheap = true;
	fx.update(0);
	for (const o of glowing()) { assert.ok(!o.layers.isEnabled(BLOOM_LAYER)); assert.ok(o.layers.isEnabled(0)); }
});

test("the halo is one Points draw sharing the bolts' positions, steel blue, and dispose frees what the cage owns", () => {
	const { opts, fx } = setup(1);
	const bolts = cage(opts).getObjectByName("bolts"), halo = cage(opts).getObjectByName("halo");
	assert.ok(halo.isPoints);
	assert.equal(halo.geometry.attributes.position, bolts.geometry.attributes.position, "one position buffer");
	assert.ok(halo.material.color.b > halo.material.color.r, "blue");
	const owned = [bolts.geometry, halo.geometry, bolts.material, halo.material, halo.material.map], freed = new Set();
	owned.forEach((r) => r.addEventListener("dispose", () => freed.add(r)));
	fx.dispose();
	assert.equal(freed.size, owned.length);
});

test("reduced motion: no strikes, so no forks", () => {
	const { opts, fx } = setup(2, { reduce: true });
	fx.update(shaken.STRIKE * 3);
	assert.equal(cage(opts).getObjectByName("bolts").geometry.drawRange.count, MAIN);
});

const px = (world) => { const view = openingCamera({ fov: FOV, width: 1440, height: 900 }); return (world / (2 * view.distance * Math.tan((FOV * Math.PI) / 360))) * 900; };
test("legible from the Chess Cards opening camera on a 1440x900 window: one or two cages at least 30 px tall, a full row of 3 at least 23 px (T24-R10, R11)", () => {
	for (const n of [1, 2]) { assert.equal(shaken.cageLayout(n).size, shaken.CAGE, `${n} cage(s) keep the full size`); }
	assert.ok(px(shaken.CAGE) >= 30, `${px(shaken.CAGE).toFixed(1)} px`);
	assert.ok(px(shaken.cageLayout(3).size) >= 23, `${px(shaken.cageLayout(3).size).toFixed(1)} px`);
});

test("T24-R10: a cage row of any count fits within 0.95 cell, and the drawn row matches cageLayout", () => {
	for (let n = 1; n <= 3; n++) {
		const { size } = shaken.cageLayout(n), first = shaken.cageLayout(n, 0).x, last = shaken.cageLayout(n, n - 1).x;
		assert.ok(last - first + 1.12 * size <= CELL_SIZE * 0.95 + 1e-9, `${n} cages: ${((last - first + 1.12 * size) / CELL_SIZE).toFixed(2)} cell`); // 1.12: BOLTS TO 0.48 EITHER SIDE, HALO DOTS 0.08 MORE
		const { opts } = setup(n), r = opts.root.getObjectByName("shakenCages");
		assert.ok(Math.abs(r.scale.x - size) < 1e-9);
		for (let i = 0; i < n; i++) { assert.ok(Math.abs(r.children[i].position.x * size - shaken.cageLayout(n, i).x) < 1e-9); }
	}
	const { opts, fx } = setup(1);
	for (let k = 0; k < 50; k++) {
		fx.update(shaken.STRIKE);
		const p = cage(opts).getObjectByName("bolts").geometry.attributes.position.array;
		for (let v = 0; v < MAIN; v++) { assert.ok(Math.abs(p[v * 3]) <= 0.48 + 1e-6, "a bar bows out 0.48 at most"); }
	}
});

test("T24-R9: the halo is hidden under cheap and back when cheap clears", () => {
	const { opts, fx } = setup(2);
	const halos = () => [0, 1].map((i) => cage(opts, i).getObjectByName("halo"));
	assert.ok(halos().every((h) => h.visible));
	opts.cheap = true;
	fx.update(0);
	assert.ok(halos().every((h) => !h.visible));
	opts.cheap = false;
	fx.update(0);
	assert.ok(halos().every((h) => h.visible));
});

test("M2: the halo draws each joint once (no doubled interior joints), forks' dots only while the forks show", () => {
	const { opts, fx } = setup(1);
	fx.update(shaken.STRIKE);
	const halo = cage(opts).getObjectByName("halo"), g = halo.geometry, p = g.attributes.position.array, idx = g.index.array;
	const key = (v) => Array.from(p.slice(v * 3, v * 3 + 3), (x) => Math.round(x * 1e5) || 0).join(); // sin(PI) ISN'T QUITE 0: THE BARS' BOTTOM TIPS DIFFER BY ~1e-17 (|| 0: NO -0)
	const drawn = Array.from(idx.slice(0, g.drawRange.count), key);
	assert.equal(new Set(drawn).size, drawn.length, "no joint drawn twice");
	const joints = new Set();
	for (let v = 0; v < MAIN; v++) { joints.add(key(v)); }
	assert.equal(drawn.filter((k) => joints.has(k)).length, joints.size, "every bolt joint has its dot");
	fx.update(shaken.FORK_S);
	assert.equal(g.drawRange.count, joints.size, "forks gone: main joints only");
});

test("flashLook: bright at the strike, gone by FLASH; the burst swells as it fades; it writes into the object it's given", () => {
	const a = { ...flashFx.flashLook(0) }, b = { ...flashFx.flashLook(FLASH / 2) }, c = flashFx.flashLook(FLASH);
	assert.equal(a.burst, 1);
	assert.ok(a.ground > 0.5);
	assert.ok(b.burst > 0 && b.burst < 1);
	assert.ok(b.scale > a.scale);
	assert.equal(c.burst, 0);
	assert.equal(c.ground, 0);
	const out = {};
	assert.equal(flashFx.flashLook(0, out), out, "no new object per frame");
});

test("it has no clock of its own: idle stays idle however long; a strike shows it until FLASH", () => {
	const opts = setupFlash();
	const fx = join(flashFx.make(opts.mesh, opts, map), opts);
	fx.update(0, opts);
	for (let i = 0; i < 5; i++) { fx.update(STRIKE, opts); }
	assert.equal(shown(fx), false, "no strike from shaken: no flash");
	fx.strike(0, 2);
	assert.ok(fx.object.visible && fx.ground.visible, "the strike flashes at once");
	fx.update(FLASH / 2, opts);
	assert.ok(shown(fx));
	fx.update(FLASH / 2, opts);
	assert.equal(shown(fx), false, "gone by FLASH");
	fx.dispose();
});

test("the burst sits on cage i of n (cageLayout / the piece's scale), just over the head, faded with the piece", () => {
	const opts = setupFlash();
	opts.mesh.geometry = { boundingBox: { max: { y: 0.83 } } };
	opts.mesh.userData.opacity = 0.5;
	const fx = join(flashFx.make(opts.mesh, opts, map), opts);
	for (const [i, n] of [[0, 1], [0, 2], [1, 2], [0, 3], [1, 3], [2, 3]]) {
		fx.strike(i, n);
		const { size, x } = cageLayout(n, i), s = size / 0.5;
		assert.ok(near(fx.object.position.x, x / 0.5), `x of cage ${i} of ${n}`);
		assert.ok(near(fx.object.position.y, 0.83 + OVER + s / 2), `y of cage ${i} of ${n}`);
		assert.ok(near(fx.object.material.opacity, 0.5));
		assert.ok(fx.ground.material.opacity > 0 && fx.ground.material.opacity <= 0.5);
	}
	fx.dispose();
});

test("the square's flash sits 0.02 over the board, like Marked's glow", () => {
	const opts = setupFlash();
	const fx = flashFx.make(opts.mesh, opts, map);
	assert.equal(fx.ground.position.y, 0.02);
	fx.dispose();
});

test("the flash alone: reduced motion: no flash", () => {
	const opts = setupFlash({ reduce: true });
	const fx = join(flashFx.make(opts.mesh, opts, map), opts);
	fx.strike(0, 2);
	fx.update(0, opts);
	assert.equal(shown(fx), false);
	fx.dispose();
});

test("bloom layer on the burst unless cheap; it follows opts.cheap live", () => {
	const opts = setupFlash();
	const fx = join(flashFx.make(opts.mesh, opts, map), opts);
	fx.strike(0, 1);
	assert.ok(fx.object.layers.isEnabled(BLOOM_LAYER));
	opts.cheap = true;
	fx.update(0, opts);
	assert.equal(fx.object.layers.isEnabled(BLOOM_LAYER), false);
	assert.equal(fx.ground.layers.isEnabled(BLOOM_LAYER), false);
	fx.dispose();
});

test("dispose takes both off & frees its own materials, never the shared plane or the dot it was given", () => {
	const opts = setupFlash();
	const fx = join(flashFx.make(opts.mesh, opts, map), opts);
	const freed = new Set(), mats = [fx.object.material, fx.ground.material], shared = [fx.ground.geometry, map];
	assert.equal(fx.object.material.map, map);
	[...mats, ...shared].forEach((r) => r.addEventListener("dispose", () => freed.add(r)));
	fx.dispose();
	assert.equal(opts.root.children.length, 0);
	assert.equal(opts.squareRoot.children.length, 0);
	mats.forEach((m) => assert.ok(freed.has(m)));
	shared.forEach((r) => assert.equal(freed.has(r), false));
	const again = setupFlash(), fx2 = flashFx.make(again.mesh, again, map);
	assert.equal(fx2.ground.geometry, shared[0], "16 pieces share one plane");
	fx2.dispose();
});

test("the flash's burst sits on opts.root, its ground on opts.squareRoot", () => {
	const { opts } = setupScaled(2);
	assert.equal(burstOf(opts).parent, opts.root);
	assert.equal(groundOf(opts).parent, opts.squareRoot);
});

for (const n of [1, 2, 3]) {
	test(`${n} cage(s): the flash fires exactly when shaken strikes, at the cage shaken drew`, () => {
		const { opts, fx } = setupScaled(n);
		const step = shaken.STRIKE / 4;
		let strikes = 0;
		for (let f = 0; f < 4 * 7; f++) {
			fx.update(step);
			const i = lit(opts), on = burstOf(opts).visible, strikeFrame = f % 4 === 3;
			assert.equal(i >= 0, strikeFrame, `shaken strikes on frame ${f}?`);
			assert.equal(on, strikeFrame, `flash on frame ${f}`); // FLASH = STRIKE / 4: GONE BY THE NEXT FRAME
			if (strikeFrame) {
				strikes++;
				assert.ok(groundOf(opts).visible, `ground on at strike ${strikes}`);
				assert.equal(burstOf(opts).material.opacity, 1);
				const c = world(cages(opts)[i]), b = world(burstOf(opts));
				assert.ok(Math.abs(c.x - b.x) < 1e-9 && Math.abs(c.y - b.y) < 1e-9, `strike ${strikes}: cage ${i} at ${c.x},${c.y}, flash at ${b.x},${b.y}`);
			}
		}
		assert.equal(strikes, 7);
	});
}

test("no flash between strikes, and it fades by FLASH", () => {
	const { opts, fx } = setupScaled(2);
	fx.update(shaken.STRIKE / 2);
	assert.equal(burstOf(opts).visible, false);
	fx.update(shaken.STRIKE / 2);
	assert.equal(burstOf(opts).visible, true);
	fx.update(shaken.FLASH / 2);
	assert.ok(burstOf(opts).material.opacity > 0 && burstOf(opts).material.opacity < 1);
	fx.update(shaken.FLASH / 2);
	assert.equal(burstOf(opts).visible, false);
	assert.equal(groundOf(opts).visible, false);
});

test("driven by shaken: reduced motion: no flash", () => {
	const { opts, fx } = setupScaled(2, { reduce: true });
	for (let i = 0; i < 4; i++) { fx.update(shaken.STRIKE); }
	assert.ok(!burstOf(opts) || !burstOf(opts).visible);
	assert.ok(!groundOf(opts) || !groundOf(opts).visible);
});

test("burst() and dispose() take the flash off and free its materials", () => {
	for (const end of ["burst", "dispose"]) {
		const { opts, fx } = setupScaled(2);
		fx.update(shaken.STRIKE);
		const mats = [burstOf(opts).material, groundOf(opts).material], freed = new Set();
		mats.forEach((m) => m.addEventListener("dispose", () => freed.add(m)));
		fx[end]();
		assert.equal(burstOf(opts), undefined, end);
		assert.equal(opts.squareRoot.children.length, 0, end);
		assert.equal(freed.size, 2, end);
		if (end === "burst") { fx.update(shaken.STRIKE); fx.update(0.1); } // BURSTING ON WITHOUT THE FLASH: NOTHING THROWS
	}
});
