// WARDED'S WARM LIGHT ON THE BOARD (three/statusFx/warded/wardLight.js) & warded.js JOINED TO ITS SUB-MODULES, WITHOUT WebGL: NOTHING IS DRAWN
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Group, Mesh, Object3D, CylinderGeometry, MeshBasicMaterial, AdditiveBlending, SRGBColorSpace } = require("three");
require("../helpers/statusFxWarded.js");
const { CELL_SIZE, BLOOM_LAYER } = require("../../src/js/gameplay/three/constants.js");
const warded = require("../../src/js/gameplay/three/statusFx/warded/warded.js");
const { pulse, PULSE_S } = warded;
const wm = require("../../src/js/gameplay/three/statusFx/warded/wardedMotes.js");
const { MOTES, moteCount } = wm;
const flare = require("../../src/js/gameplay/three/statusFx/warded/wardedFlare.js");
const { FLARE_MS } = flare;
const wl = require("../../src/js/gameplay/three/statusFx/warded/wardLight.js");
const { level } = wl;

// THE WARM LIGHT ON THE BOARD (wardLight.js)
const lightPiece = (opacity) => { const m = new Object3D(); if (opacity !== undefined) { m.userData.opacity = opacity; } return m; };
const setupLight = (more = {}) => ({ s: "warded", square: "e4", mesh: lightPiece(), reduce: false, ...more });

test("the level pulses in step with warded.js's pulse: dimmest at t 0, brightest half a period on", () => {
	const o = setupLight();
	assert.equal(wl.level(0, o), wl.LIGHT);
	assert.equal(wl.level(PULSE_S / 2, o), wl.LIGHT + wl.PULSE);
	for (const t of [0.3, 1, 1.7]) { assert.equal(wl.level(t, o), wl.LIGHT + wl.PULSE * pulse(t)); }
});

test("reduced motion: a steady level whatever t is", () => {
	const o = setupLight({ reduce: true });
	assert.equal(wl.level(0, o), wl.level(1.2, o));
	assert.equal(wl.level(0.5, o), wl.LIGHT + wl.PULSE / 2);
});

test("every Warded piece gets the same strength, Heavy Cavalry's ward included", () => {
	assert.equal(wl.level(1, setupLight({ cavalry: true })), wl.level(1, setupLight()));
	assert.equal(wl.CAVALRY, undefined);
});

test("the level fades with the piece (userData.opacity)", () => {
	assert.equal(wl.level(1, setupLight({ mesh: lightPiece(0.5) })), wl.level(1, setupLight()) * 0.5);
	assert.equal(wl.level(1, setupLight({ mesh: lightPiece(0) })), 0);
});

test("the gradient: brightest in the middle, clear at the edge & corners, warm (red >= green > blue)", () => {
	const tex = wl.lightTexture(), { data, width: n } = tex.image, at = (x, y) => data.subarray((y * n + x) * 4, (y * n + x) * 4 + 4);
	const mid = at(n / 2, n / 2), edge = at(0, n / 2), corner = at(0, 0);
	assert.ok(mid[3] > 200);
	assert.equal(edge[3], 0);
	assert.equal(corner[3], 0);
	assert.ok(mid[0] >= mid[1] && mid[1] > mid[2]);
	assert.ok(at(n / 2 + Math.round(n / 6), n / 2)[3] < mid[3], "falls off");
	assert.equal(tex.colorSpace, SRGBColorSpace, "WARM is an sRGB colour, not linear data (else it washes out to cream)");
});

test("make: one flat additive decal on the board, the square & its neighbours, no bloom (the board doesn't glow), shared geometry & texture", () => {
	const a = wl.make(null, setupLight()), b = wl.make(null, setupLight());
	const m = a.object;
	assert.ok(m.isMesh);
	assert.equal(m.material.blending, AdditiveBlending);
	assert.equal(m.material.depthWrite, false);
	assert.ok(m.renderOrder < -1, "draws before the piece shadows (pieces.js renderOrder -1), so the shadow stays on top");
	assert.equal(m.rotation.x, -Math.PI / 2);
	assert.ok(m.position.y > 0 && m.position.y < 0.04, "just over the board, under the sigil rings");
	assert.equal(m.geometry.parameters.width, wl.SIZE);
	assert.ok(wl.SIZE >= CELL_SIZE * 2.5 && wl.SIZE <= CELL_SIZE * 3.5);
	assert.equal(m.layers.isEnabled(BLOOM_LAYER), false);
	assert.equal(a.object.geometry, b.object.geometry, "one geometry for every piece");
	assert.equal(a.object.material.map, b.object.material.map, "one texture for every piece");
	assert.notEqual(a.object.material, b.object.material, "each its own opacity");
	a.dispose(); b.dispose();
});

test("update sets the opacity from level; dispose frees its material only, takes the decal off", () => {
	const o = setupLight(), fx = wl.make(null, o), parent = new Object3D();
	parent.add(fx.object);
	fx.update(PULSE_S / 2, o);
	assert.equal(fx.object.material.opacity, wl.level(PULSE_S / 2, o));
	o.mesh.userData.opacity = 0.5;
	fx.update(PULSE_S / 2, o);
	assert.equal(fx.object.material.opacity, wl.level(PULSE_S / 2, o), "reads opts each frame");
	const freed = new Set();
	for (const r of [fx.object.material, fx.object.geometry, fx.object.material.map]) { r.addEventListener("dispose", () => freed.add(r)); }
	const { material } = fx.object;
	fx.dispose();
	assert.equal(fx.object.parent, null);
	assert.ok(freed.has(material));
	assert.equal(freed.size, 1, "the shared geometry & texture stay");
});

// WARDED JOINED TO ITS SUB-MODULES
function setupJoined(extra = {}) {
	const g = new CylinderGeometry(0.12, 0.34, 0.83, 12, 8);
	g.translate(0, 0.83 / 2, 0);
	g.computeBoundingBox();
	const mesh = new Mesh(g, new MeshBasicMaterial());
	mesh.userData.opacity = 1;
	const root = new Group();
	mesh.add(root);
	return { s: "warded", id: "p1", left: 2, by: "w", square: "e4", mode: "effects", slot: 0, slots: 1, mesh, root, squareRoot: new Group(), reduce: false, fresh: false, ...extra };
}
const named = (root, name) => { const list = []; root.traverse((o) => { if (o.name === name) { list.push(o); } }); return list; };
const flareOf = (opts) => opts.root.getObjectByName("wardedFlare");

test("FADE_MS is wardedFlare's FLARE_MS (one value, not a copy)", () => {
	assert.equal(warded.FADE_MS, FLARE_MS);
});

test("gain: the flare plays on create only when opts.fresh, never otherwise, never under reduce", () => {
	const fresh = setupJoined({ fresh: true });
	const a = warded.create(fresh.mesh, fresh);
	assert.equal(flareOf(fresh).visible, true, "fresh: the gain flare is playing");
	assert.equal(a.animating(), true);
	const old = setupJoined();
	const b = warded.create(old.mesh, old);
	assert.equal(flareOf(old).visible, false, "not fresh: no flare");
	assert.equal(flareOf(old).children.length, 0, "never played: nothing built");
	const r = setupJoined({ fresh: true, reduce: true });
	const c = warded.create(r.mesh, r);
	assert.equal(flareOf(r).visible, false, "reduce: no flare at all");
	assert.equal(c.animating(), false);
	a.dispose(); b.dispose(); c.dispose();
});

test("the gain flare runs on the running clock and ends after FLARE_MS", () => {
	const opts = setupJoined({ fresh: true });
	const fx = warded.create(opts.mesh, opts);
	for (let i = 0; i < Math.ceil(FLARE_MS / 100) + 1; i++) { fx.update(0.1); }
	assert.equal(flareOf(opts).visible, false, "done");
	fx.dispose();
});

test("burst: plays the lose flare (playing on the same frame) & returns FLARE_MS + 100; 0 under reduce", () => {
	const opts = setupJoined();
	const fx = warded.create(opts.mesh, opts);
	assert.equal(fx.burst(), FLARE_MS + 100);
	assert.equal(flareOf(opts).visible, true, "the lose flare is playing");
	assert.ok(named(opts.root, "wardedFlareShards")[0].visible, "the lose throws shards");
	assert.equal(fx.animating(), true);
	fx.dispose();
	const r = setupJoined({ reduce: true });
	const fr = warded.create(r.mesh, r);
	assert.equal(fr.burst(), 0);
	assert.equal(flareOf(r).visible, false);
	fr.dispose();
});

test("burst fades the motes & the light with the body on wall time", () => {
	const opts = setupJoined();
	const fx = warded.create(opts.mesh, opts);
	const motes = named(opts.root, "wardedMotes")[0], light = opts.squareRoot.getObjectByName("wardLight");
	const real = performance.now, t0 = real.call(performance);
	try {
		performance.now = () => t0;
		fx.burst();
		fx.update(0.016);
		assert.ok(motes.material.opacity > 0.5 && light.material.opacity > 0.2, "full at the break");
		performance.now = () => t0 + FLARE_MS + 1;
		fx.update(0.016);
		assert.equal(motes.material.opacity, 0);
		assert.equal(light.material.opacity, 0);
	} finally { performance.now = real; }
	fx.dispose();
});

test("light: on opts.squareRoot, following warded's running clock t (not dt)", () => {
	const opts = setupJoined();
	const fx = warded.create(opts.mesh, opts);
	const light = opts.squareRoot.getObjectByName("wardLight");
	assert.ok(light, "the light sits on the square");
	assert.equal(named(opts.root, "wardLight").length, 0, "not on the piece");
	fx.update(0.3); fx.update(0.3);
	assert.ok(Math.abs(light.material.opacity - level(0.6, opts)) < 1e-9);
	fx.dispose();
});

test("motes: one cloud (wardedMotes.js's), no own 8 motes; half under cheap, flips in place", () => {
	const opts = setupJoined();
	const fx = warded.create(opts.mesh, opts);
	assert.equal(named(opts.root, "wardedMoteCloud").length, 1);
	const motes = named(opts.root, "wardedMotes");
	assert.equal(motes.length, 1, "only the cloud's motes");
	assert.equal(motes[0].geometry.drawRange.count, MOTES);
	opts.cheap = true;
	fx.update(0.1);
	assert.equal(motes[0].geometry.drawRange.count, moteCount(true));
	assert.ok(moteCount(true) < MOTES);
	fx.dispose();
});

test("dispose frees the motes, the flare & the light and takes them off", () => {
	const opts = setupJoined();
	const fx = warded.create(opts.mesh, opts);
	fx.burst(); // BUILDS THE FLARE
	const owned = [];
	for (const n of ["wardedMotes", "wardedGlints", "wardedFlareShards"]) { const o = named(opts.root, n)[0]; owned.push(o.material, o.geometry); }
	for (const n of ["wardedFlareRing", "wardedFlareGlow"]) { owned.push(named(opts.root, n)[0].material); }
	owned.push(opts.squareRoot.getObjectByName("wardLight").material);
	const freed = new Set();
	owned.forEach((r) => r.addEventListener("dispose", () => freed.add(r)));
	fx.dispose();
	assert.equal(freed.size, owned.length);
	assert.equal(opts.root.children.length, 0);
	assert.equal(opts.squareRoot.children.length, 0);
});
