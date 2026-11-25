// TASK 24 FROZEN: PHYSICAL ICE ON THE PIECE (statusFx/frozen.js), FROST & MIST ON ITS SQUARE (statusFx/frostGround.js) & HOW frozen.js WIRES THEM. NO WebGL: NOTHING IS DRAWN
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Group, Object3D, Mesh, CylinderGeometry, MeshBasicMaterial, ShaderChunk, LinearMipmapLinearFilter } = require("three");
global.window ??= { matchMedia: () => ({ matches: false, addEventListener() {} }) }; // constants.js READS IT AS IT LOADS
const { CELL_SIZE, BLOOM_LAYER } = require("../src/js/gameplay/three/constants.js");
const frozen = require("../src/js/gameplay/three/statusFx/frozen.js");
const frost = require("../src/js/gameplay/three/statusFx/frostGround.js");
const { SPREAD_S, SETTLE_S, spread } = frost;

function piece(top = 0.83, rTop = 0.12, rFoot = 0.34) {
	const g = new CylinderGeometry(rTop, rFoot, top, 12, 8);
	g.translate(0, top / 2, 0);
	g.computeBoundingBox();
	const mesh = new Mesh(g, new MeshBasicMaterial());
	mesh.userData.opacity = 1;
	return mesh;
}

// frozen.js ALONE: RETURNS { mesh, opts }
function setup(extra = {}) {
	const mesh = piece();
	const root = new Group(), squareRoot = new Group();
	mesh.add(root);
	const opts = { s: "frozen", id: "p1", left: 2, by: "w", square: "e4", mode: "effects", slot: 0, slots: 1, mesh, root, squareRoot, reduce: false, ...extra };
	return { mesh, opts };
}

// frostGround.js ALONE: THE SQUARE IS A PLAIN three Group, FREEING IS COUNTED THROUGH three's "dispose" EVENTS
const setupGround = (more = {}) => { const mesh = new Object3D(); mesh.userData.opacity = 1; return { s: "frozen", square: "e4", mesh, root: new Group(), squareRoot: new Group(), reduce: false, ...more }; };

// frozen.js WITH ITS GROUND: RETURNS opts
function setupWired(extra = {}) {
	const mesh = piece();
	const root = new Group(), squareRoot = new Group();
	mesh.add(root);
	return { s: "frozen", id: "p1", left: 2, by: "w", square: "e4", mode: "effects", slot: 0, slots: 1, mesh, root, squareRoot, reduce: false, cheap: false, ...extra };
}

const crustOf = (opts) => opts.root.getObjectByName("frozenCrust");
const shardsOf = (opts) => opts.root.getObjectByName("frozenShards").children;
const find = (fx, type) => { const list = []; fx.object.traverse((o) => { if (o[type]) { list.push(o); } }); return list; };
const decalOf = (opts) => opts.squareRoot.getObjectByName("frostDecal");
const run = (fx, s) => { for (let t = 0; t < s; t += 0.1) { fx.update(0.1); } };

// ICE ON THE PIECE: A GLOSSY CRUST (TRANSMISSION ONLY WHEN NOT CHEAP), CHUNKY IRREGULAR SHARDS, A SHARED RIME FROST TEXTURE, HALF THE SPECKS & SHARDS WHEN CHEAP, NO BLOOM

test("counts: full 28 specks & 6 shards; cheap halves them (round up)", () => {
	assert.deepEqual(frozen.counts(false), { rime: 28, shards: 6 });
	assert.deepEqual(frozen.counts(true), { rime: 14, shards: 3 });
	assert.deepEqual(frozen.counts(undefined), frozen.counts(false), "undefined cheap is full");
});

test("crust: refractive MeshPhysicalMaterial (transmission, ice ior) when full, a MeshStandardMaterial fake when cheap", () => {
	const a = setup(), b = setup({ cheap: true });
	const fa = frozen.create(a.mesh, a.opts), fb = frozen.create(b.mesh, b.opts);
	const ma = crustOf(a.opts).material, mb = crustOf(b.opts).material;
	assert.equal(ma.isMeshPhysicalMaterial, true);
	assert.ok(ma.transmission > 0);
	assert.ok(Math.abs(ma.ior - 1.31) < 1e-6, "ice");
	assert.ok(ma.roughness < 0.3, "glossy");
	assert.equal(mb.isMeshStandardMaterial, true);
	assert.notEqual(mb.isMeshPhysicalMaterial, true, "no transmission pass when cheap");
	for (const m of [ma, mb]) { assert.equal(m.transparent, true); assert.equal(m.depthWrite, false); }
	fa.dispose(); fb.dispose();
});

test("crust: a fresnel rim is injected into the lit shader (faded by opacity), on both materials", () => {
	assert.ok(ShaderChunk.opaque_fragment, "three still has the chunk the rim hooks before");
	for (const cheap of [false, true]) {
		const { opts } = setup({ cheap });
		const fx = frozen.create(opts.mesh, opts);
		const { ShaderLib } = require("three"); // THE REAL LIT SHADER, SO A MISSED HOOK FAILS HERE (REVIEW M5)
		const m = crustOf(opts).material, shader = { uniforms: {}, fragmentShader: ShaderLib[cheap ? "standard" : "physical"].fragmentShader };
		m.onBeforeCompile(shader);
		assert.match(shader.fragmentShader, /rim/);
		assert.match(shader.fragmentShader, /opacity/);
		assert.ok(shader.fragmentShader.indexOf("rim") < shader.fragmentShader.indexOf("#include <opaque_fragment>"));
		fx.dispose();
	}
});

test("cheap flips live: update(0) swaps the crust material (freeing the old), halves specks & shards, and back", () => {
	const { opts } = setup();
	const fx = frozen.create(opts.mesh, opts);
	const crust = crustOf(opts), old = crust.material, rime = opts.root.getObjectByName("frozenRime");
	let freed = false;
	old.dispose = () => { freed = true; };
	assert.equal(rime.geometry.drawRange.count, 28);
	assert.equal(shardsOf(opts).filter((s) => s.visible).length, 6);
	opts.cheap = true;
	fx.update(0);
	assert.notEqual(crust.material, old);
	assert.equal(freed, true);
	assert.notEqual(crust.material.isMeshPhysicalMaterial, true);
	assert.equal(rime.geometry.drawRange.count, 14);
	assert.equal(shardsOf(opts).filter((s) => s.visible).length, 3);
	assert.ok(crust.material.opacity > 0 && crust.material.opacity < 1, "the new material keeps the fade");
	opts.cheap = false;
	fx.update(0);
	assert.equal(crust.material.isMeshPhysicalMaterial, true);
	assert.equal(rime.geometry.drawRange.count, 28);
	assert.equal(shardsOf(opts).filter((s) => s.visible).length, 6);
	fx.dispose();
});

test("no bloom: nothing is on BLOOM_LAYER, cheap or not (ice does not glow)", () => {
	for (const cheap of [false, true]) {
		const { opts } = setup({ cheap });
		const fx = frozen.create(opts.mesh, opts);
		opts.root.traverse((o) => assert.equal(o.layers.isEnabled(BLOOM_LAYER), false, o.name));
		fx.dispose();
	}
});

test("rime frost texture: one shared module texture on every crust (alpha & roughness), never freed by dispose", () => {
	const a = setup(), b = setup({ cheap: true });
	const fa = frozen.create(a.mesh, a.opts), fb = frozen.create(b.mesh, b.opts);
	const t = frozen.frostTexture();
	assert.equal(t, frozen.frostTexture(), "built once");
	for (const m of [crustOf(a.opts).material, crustOf(b.opts).material]) { assert.equal(m.alphaMap, t); assert.equal(m.roughnessMap, t); }
	const g = t.image.data;
	let lo = 255, hi = 0;
	for (let i = 1; i < g.length; i += 4) { lo = Math.min(lo, g[i]); hi = Math.max(hi, g[i]); }
	assert.ok(lo > 0, "clear ice still tints (never fully see-through)");
	assert.ok(hi - lo > 80, "rime patches stand out from clear ice");
	let freed = false;
	t.dispose = () => { freed = true; };
	fa.dispose(); fb.dispose();
	assert.equal(freed, false);
});

test("shards: chunky & irregular (not a plain cone), a few shapes, flat-shaded glossy ice", () => {
	const { opts } = setup();
	const fx = frozen.create(opts.mesh, opts);
	const shards = shardsOf(opts), geos = new Set(shards.map((s) => s.geometry));
	assert.ok(geos.size >= 2, "more than one shape");
	for (const g of geos) {
		assert.notEqual(g.type, "ConeGeometry");
		const p = g.attributes.position, radii = new Set();
		g.computeBoundingBox();
		for (let i = 0; i < p.count; i++) { if (p.getY(i) < g.boundingBox.min.y + 1e-6) { radii.add(Math.hypot(p.getX(i), p.getZ(i)).toFixed(4)); } }
		assert.ok(radii.size > 2, "base corners sit at different radii");
		const w = g.boundingBox.max.x - g.boundingBox.min.x, h = g.boundingBox.max.y - g.boundingBox.min.y;
		assert.ok(w / h > 0.4, `chunky: ${(w / h).toFixed(2)}`);
	}
	const m = shards[0].material;
	assert.equal(m.flatShading, true);
	assert.ok(m.roughness < 0.3);
	assert.equal(shards.every((s) => s.material === m), true, "one material for all shards");
	fx.dispose();
});

// FROST ON THE SQUARE (frostGround.js)

test("frostPattern: frost round the foot, clear at the square's edge & corners, cracks reaching out, the same every time", () => {
	const n = 64, a = frost.frostPattern(n), b = frost.frostPattern(n);
	assert.equal(a.length, n * n * 4);
	assert.deepEqual(a, b);
	const alpha = (x, y) => a[(y * n + x) * 4 + 3];
	assert.equal(alpha(0, 0), 0);
	assert.equal(alpha(n - 1, n - 1), 0);
	assert.equal(alpha(n / 2, 0), 0, "faded out before the edge: no square seam");
	// AROUND THE FOOT (A QUARTER OUT) MOST PIXELS CARRY FROST
	let ring = 0, total = 0;
	for (let k = 0; k < 64; k++) { const ang = (k / 64) * 2 * Math.PI, x = Math.round(n / 2 + Math.cos(ang) * n * 0.15), y = Math.round(n / 2 + Math.sin(ang) * n * 0.15); total++; if (alpha(x, y) > 40) { ring++; } }
	assert.ok(ring / total > 0.8, `${ring}/${total} frosted by the foot`);
	// FAR OUT (0.8 OF THE RADIUS) ONLY THE CRACKS: SOME BRIGHT PIXELS, MOST CLEAR
	let bright = 0, far = 0;
	for (let k = 0; k < 360; k++) { const ang = (k / 360) * 2 * Math.PI, x = Math.round(n / 2 + Math.cos(ang) * n * 0.4 * 0.8), y = Math.round(n / 2 + Math.sin(ang) * n * 0.4 * 0.8); far++; if (alpha(x, y) > 150) { bright++; } }
	assert.ok(bright > 5, `${bright} crack pixels far out`);
	assert.ok(bright < far / 2, "mostly clear between the cracks");
});

test("spread: grows from the foot to the full square over SPREAD_S, eased; full at once under reduced motion", () => {
	assert.ok(frost.spread(0, false) < 0.4);
	assert.ok(frost.spread(frost.SPREAD_S / 2, false) > frost.spread(0, false));
	assert.equal(frost.spread(frost.SPREAD_S, false), 1);
	assert.equal(frost.spread(frost.SPREAD_S * 5, false), 1);
	assert.equal(frost.spread(0, true), 1);
	for (let t = 0; t < frost.SPREAD_S; t += 0.05) { assert.ok(frost.spread(t + 0.05, false) >= frost.spread(t, false)); }
});

test("mistPuff: low, on the square, drifting with time; still under reduced motion", () => {
	for (let i = 0; i < frost.MIST; i++) {
		for (const t of [0, 1.3, 7, 40]) {
			const p = frost.mistPuff(t, i, frost.MIST, false);
			assert.ok(Math.hypot(p.x, p.z) <= CELL_SIZE * 0.45, "stays over the square");
			assert.ok(p.y > 0 && p.y < CELL_SIZE * 0.2, "hugs the board");
			assert.ok(p.a > 0 && p.a <= 1);
		}
		const a = frost.mistPuff(0, i, frost.MIST, false), b = frost.mistPuff(3, i, frost.MIST, false);
		assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 0.001, "it drifts");
		assert.deepEqual(frost.mistPuff(0, i, frost.MIST, true), frost.mistPuff(9, i, frost.MIST, true), "still");
	}
});

test("make: one decal & one Points draw of MIST puffs, nothing on the bloom layer; cheap hides the mist", () => {
	const opts = setupGround();
	const fx = frost.make(opts.mesh, opts);
	const meshes = find(fx, "isMesh"), points = find(fx, "isPoints");
	assert.equal(meshes.length, 1);
	assert.equal(points.length, 1);
	assert.equal(points[0].geometry.attributes.position.count, frost.MIST);
	fx.object.traverse((o) => assert.equal(o.layers.isEnabled(BLOOM_LAYER), false, "ice doesn't glow"));
	fx.update(1, opts);
	assert.equal(points[0].visible, true);
	opts.cheap = true;
	fx.update(1.1, opts);
	assert.equal(points[0].visible, false, "cheap: decal only");
	assert.equal(meshes[0].visible, true);
	fx.dispose();
});

test("update: the decal spreads & fades in with time & along the piece's opacity; the mist moves; animating while it has anything to move", () => {
	const opts = setupGround();
	const fx = frost.make(opts.mesh, opts);
	const decal = find(fx, "isMesh")[0], mist = find(fx, "isPoints")[0], pos = mist.geometry.attributes.position;
	fx.update(0, opts);
	const s0 = decal.scale.x, a0 = decal.material.opacity, x0 = pos.getX(0);
	assert.equal(fx.animating(), true);
	fx.update(frost.SPREAD_S, opts);
	assert.ok(decal.scale.x > s0);
	assert.ok(decal.material.opacity > a0);
	assert.notEqual(pos.getX(0), x0);
	const sFull = decal.scale.x;
	opts.mesh.userData.opacity = 0.5;
	const full = decal.material.opacity;
	fx.update(frost.SPREAD_S, opts);
	assert.ok(Math.abs(decal.material.opacity - full / 2) < 1e-9);
	opts.cheap = true;
	fx.update(frost.SPREAD_S + 1, opts);
	assert.equal(fx.animating(), false, "spread done, no mist: still");
	opts.cheap = false; opts.reduce = true;
	fx.update(0, opts);
	assert.equal(fx.animating(), false, "reduced motion: still");
	assert.equal(decal.scale.x, sFull, "the full frost at once");
	fx.dispose();
});

test("dispose takes the object off its parent & frees the instance's geometry & materials, not the shared decal geometry or textures", () => {
	const opts = setupGround();
	const fx = frost.make(opts.mesh, opts);
	opts.squareRoot.add(fx.object);
	const decal = find(fx, "isMesh")[0], mist = find(fx, "isPoints")[0];
	const owned = [mist.geometry, mist.material, decal.material], shared = [decal.geometry, decal.material.map, mist.material.map];
	const freed = new Set();
	[...owned, ...shared].forEach((r) => r.addEventListener("dispose", () => freed.add(r)));
	fx.dispose();
	assert.equal(opts.squareRoot.children.length, 0);
	owned.forEach((r) => assert.ok(freed.has(r)));
	shared.forEach((r) => assert.ok(!freed.has(r), "shared across the 16 frozen pieces"));
	// A SECOND INSTANCE SHARES THE SAME TEXTURES & DECAL GEOMETRY
	const other = frost.make(opts.mesh, setupGround());
	assert.equal(find(other, "isMesh")[0].geometry, decal.geometry);
	assert.equal(find(other, "isMesh")[0].material.map, decal.material.map);
	other.dispose();
});

test("R6: the mist eases to rest SETTLE_S after the spread, then animating() is false & a still mist remains", () => {
	const opts = setupGround();
	const fx = frost.make(opts.mesh, opts);
	const mist = find(fx, "isPoints")[0], pos = mist.geometry.attributes.position;
	const end = frost.SPREAD_S + frost.SETTLE_S;
	fx.update(end - 1, opts);
	assert.equal(fx.animating(), true, "still settling");
	fx.update(end, opts);
	const at = [pos.getX(0), pos.getZ(0)], a = mist.material.opacity;
	assert.equal(fx.animating(), false, "settled: no frames asked for");
	fx.update(end + 30, opts);
	assert.deepEqual([pos.getX(0), pos.getZ(0)], at, "at rest");
	assert.equal(mist.material.opacity, a);
	assert.ok(mist.visible && a > 0, "a still mist remains");
	// EASES: THE DRIFT SLOWS AS IT SETTLES
	const step = (t) => { const p = frost.mistPuff(t, 0, frost.MIST, false), q = frost.mistPuff(t + 0.1, 0, frost.MIST, false); return Math.hypot(q.x - p.x, q.z - p.z); };
	assert.ok(step(end - 0.2) < step(frost.SPREAD_S) / 4, "slows to rest, no stop with a jolt");
	fx.dispose();
});

test("I2: update's fade multiplies into both opacities; M3: the mist's opacity follows the piece's", () => {
	const opts = setupGround();
	const fx = frost.make(opts.mesh, opts);
	const decal = find(fx, "isMesh")[0], mist = find(fx, "isPoints")[0];
	fx.update(frost.SPREAD_S, opts);
	const d = decal.material.opacity, m = mist.material.opacity;
	fx.update(frost.SPREAD_S, opts, 0.25);
	assert.ok(Math.abs(decal.material.opacity - d / 4) < 1e-9);
	assert.ok(Math.abs(mist.material.opacity - m / 4) < 1e-9);
	fx.update(frost.SPREAD_S, opts, 0);
	assert.equal(decal.material.opacity, 0);
	assert.equal(mist.material.opacity, 0);
	opts.mesh.userData.opacity = 0.5;
	fx.update(frost.SPREAD_S, opts);
	assert.ok(Math.abs(mist.material.opacity - m / 2) < 1e-9, "mist fades with the piece");
	fx.dispose();
});

test("M3: cheap mode asks for frames while the frost spreads, then stops", () => {
	const opts = setupGround({ cheap: true });
	const fx = frost.make(opts.mesh, opts);
	assert.equal(fx.animating(), true, "spreading at t=0");
	fx.update(frost.SPREAD_S / 2, opts);
	assert.equal(fx.animating(), true);
	fx.update(frost.SPREAD_S, opts);
	assert.equal(fx.animating(), false);
	fx.dispose();
});

test("M1: mistPuff writes into a reused out object", () => {
	const out = {};
	const p = frost.mistPuff(1, 2, frost.MIST, false, out);
	assert.equal(p, out);
	assert.deepEqual({ ...out }, frost.mistPuff(1, 2, frost.MIST, false));
});

test("M4: the frost texture is mipmapped (no shimmer from far away)", () => {
	const opts = setupGround();
	const fx = frost.make(opts.mesh, opts);
	const map = find(fx, "isMesh")[0].material.map;
	assert.equal(map.generateMipmaps, true);
	assert.equal(map.minFilter, LinearMipmapLinearFilter);
	fx.dispose();
});

// frozen.js WIRES frostGround.js: ITS OBJECT ON opts.squareRoot, THE RUNNING CLOCK, THE BURST FADE, animating() & dispose; RULING T24-R13 (THE FOOT HAZE ONLY WHEN CHEAP)

test("J2: the frost ground goes on opts.squareRoot, & dispose takes it off & frees its own materials", () => {
	const opts = setupWired();
	const fx = frozen.create(opts.mesh, opts);
	assert.equal(opts.squareRoot.children.length, 1);
	const decal = decalOf(opts), mist = opts.squareRoot.getObjectByName("frostMist");
	assert.ok(decal && mist);
	const freed = new Set();
	for (const r of [decal.material, mist.material, mist.geometry]) { const d = r.dispose.bind(r); r.dispose = () => { freed.add(r); d(); }; }
	fx.dispose();
	assert.equal(opts.squareRoot.children.length, 0);
	assert.equal(freed.size, 3);
});

test("J2: the ground runs on frozen's summed clock (dt adds up), so the frost spreads to full", () => {
	const opts = setupWired({ fresh: true });
	const fx = frozen.create(opts.mesh, opts);
	assert.ok(Math.abs(decalOf(opts).scale.x - spread(0)) < 1e-9);
	fx.update(0.1); fx.update(0.1);
	assert.ok(Math.abs(decalOf(opts).scale.x - spread(0.2)) < 1e-6, "t is the total, not the frame's dt");
	run(fx, SPREAD_S + 0.2);
	assert.equal(decalOf(opts).scale.x, 1);
	fx.dispose();
});

test("T24-R15: a status that isn't a real gain (load, reconnect, mode switch) starts settled: full frost, no frames", () => {
	const opts = setupWired({ fresh: false });
	const fx = frozen.create(opts.mesh, opts);
	assert.equal(decalOf(opts).scale.x, 1);
	assert.equal(fx.animating(), false);
	fx.dispose();
});

test("J2 review M1: reduce on at create then off never replays the spread", () => {
	const opts = setupWired({ fresh: true, reduce: true });
	const fx = frozen.create(opts.mesh, opts);
	fx.update(0);
	opts.reduce = false; fx.update(0); fx.update(0.1);
	assert.equal(decalOf(opts).scale.x, 1);
	assert.equal(fx.animating(), false);
	fx.dispose();
});

test("J2: animating() ORs the ground's: true while the frost spreads & the mist settles, then still until the burst", () => {
	const opts = setupWired({ fresh: true });
	const fx = frozen.create(opts.mesh, opts);
	assert.equal(fx.animating(), true);
	run(fx, SPREAD_S + SETTLE_S + 0.3);
	assert.equal(fx.animating(), false);
	fx.burst();
	assert.equal(fx.animating(), true);
	fx.dispose();
	const r = setupWired({ reduce: true });
	const fr = frozen.create(r.mesh, r);
	assert.equal(fr.animating(), false, "reduced motion: the full frost at once, no frames");
	assert.equal(decalOf(r).scale.x, 1);
	fr.dispose();
});

test("J2: the burst fades the frost with the shards (fall(burstT).a), down to 0", () => {
	const opts = setupWired();
	const fx = frozen.create(opts.mesh, opts);
	run(fx, SPREAD_S + 0.2);
	const full = decalOf(opts).material.opacity;
	assert.ok(full > 0);
	fx.burst();
	fx.update(0.4);
	const a = frozen.fall(0.4).a;
	assert.ok(Math.abs(decalOf(opts).material.opacity - full * a) < 1e-6, "faded by fall().a");
	fx.update(0.1); fx.update(0.1); fx.update(0.1);
	assert.equal(decalOf(opts).material.opacity, 0);
	fx.dispose();
});

test("T24-R13: frozen's own foot haze draws only when cheap (the ground's mist replaces it otherwise), & follows a switch", () => {
	const opts = setupWired();
	const fx = frozen.create(opts.mesh, opts);
	assert.equal(opts.root.getObjectByName("frozenMist").visible, false);
	assert.equal(opts.squareRoot.getObjectByName("frostMist").visible, true);
	opts.cheap = true;
	fx.update(0);
	assert.equal(opts.root.getObjectByName("frozenMist").visible, true);
	assert.equal(opts.squareRoot.getObjectByName("frostMist").visible, false);
	opts.cheap = false;
	fx.update(0);
	assert.equal(opts.root.getObjectByName("frozenMist").visible, false);
	fx.dispose();
	const c = setupWired({ cheap: true });
	const fc = frozen.create(c.mesh, c);
	assert.equal(c.root.getObjectByName("frozenMist").visible, true);
	fc.dispose();
});
