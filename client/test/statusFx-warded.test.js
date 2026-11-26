// TASK 24: WARDED (three/statusFx/warded.js & ITS SUB-MODULES wardedMotes.js, wardedFlare.js, wardLight.js) WITHOUT WebGL: NOTHING IS DRAWN
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Group, Mesh, Object3D, CylinderGeometry, MeshStandardMaterial, MeshBasicMaterial, AdditiveBlending, SRGBColorSpace } = require("three");
global.window ??= { matchMedia: () => ({ matches: false, addEventListener() {} }) }; // constants.js READS IT AS IT LOADS
const { CELL_SIZE, BLOOM_LAYER } = require("../src/js/gameplay/three/constants.js");
const warded = require("../src/js/gameplay/three/statusFx/warded.js");
const { pulse, PULSE_S } = warded;
const wm = require("../src/js/gameplay/three/statusFx/wardedMotes.js");
const { MOTES, moteCount } = wm;
const flare = require("../src/js/gameplay/three/statusFx/wardedFlare.js");
const { FLARE_MS } = flare;
const wl = require("../src/js/gameplay/three/statusFx/wardLight.js");
const { level } = wl;

// THE WARDED BODY (warded.js): CORE SHELL & SHIMMER, HALO, SHEEN, BLOOM UNLESS cheap, THE PIECE'S MATERIAL LEFT ALONE
function setup(extra = {}) {
	const g = new CylinderGeometry(0.12, 0.34, 0.83, 12, 8);
	g.translate(0, 0.83 / 2, 0);
	g.computeBoundingBox();
	const mesh = new Mesh(g, new MeshStandardMaterial({ color: 0x8a5a2b }));
	mesh.userData.opacity = 1;
	const root = new Group();
	mesh.add(root);
	const opts = { s: "warded", id: "p1", left: 2, by: "w", square: "e4", mode: "effects", slot: 0, slots: 1, mesh, root, squareRoot: new Group(), reduce: false, ...extra };
	return { mesh, opts };
}
const bloom = (o) => o.layers.isEnabled(BLOOM_LAYER);

test("bandY: the shimmer sweeps up from under the foot to over the top, then loops", () => {
	assert.ok(warded.bandY(0) < 0, "starts under the foot");
	let last = -Infinity;
	for (let t = 0; t < warded.BAND_S - 1e-6; t += warded.BAND_S / 20) { const y = warded.bandY(t); assert.ok(y > last, `rises at ${t}`); last = y; }
	assert.ok(last > 1, "ends over the top: a gap before the next sweep");
	assert.ok(Math.abs(warded.bandY(warded.BAND_S) - warded.bandY(0)) < 1e-9, "loops");
});

test("layered glow: a core shell in the piece's shape, a little bigger than it, brighter than the wide halo", () => {
	const { opts } = setup();
	const fx = warded.create(opts.mesh, opts);
	const shell = opts.root.getObjectByName("wardedShell"), aura = opts.root.getObjectByName("wardedAura");
	assert.equal(shell.geometry, opts.mesh.geometry);
	assert.ok(shell.scale.x > 1 && shell.scale.z > 1, "a slightly scaled shell");
	assert.equal(shell.material.depthWrite, false);
	for (const t of [0, 0.3, 0.9, 1.7]) {
		fx.update(t === 0 ? 0 : 0.3);
		assert.ok(shell.material.opacity > aura.material.opacity, `core over halo at ${t}`);
	}
	fx.dispose();
});

test("the shimmer band moves with time, & stands still under reduce", () => {
	const { opts } = setup();
	const fx = warded.create(opts.mesh, opts);
	const u = opts.root.getObjectByName("wardedShell").material.uniforms;
	const b0 = u.uBand.value;
	fx.update(0.2);
	assert.notEqual(u.uBand.value, b0);
	opts.reduce = true;
	fx.update(0);
	const b1 = u.uBand.value;
	fx.update(0.2); fx.update(0.2);
	assert.equal(u.uBand.value, b1);
	fx.dispose();
});

test("bloom: the core shell & the motes (wardedMotes.js) are on BLOOM_LAYER unless opts.cheap (changed in place), the halo & sheen never", () => {
	const { opts } = setup();
	const fx = warded.create(opts.mesh, opts);
	const shell = opts.root.getObjectByName("wardedShell"), motes = opts.root.getObjectByName("wardedMotes");
	assert.ok(bloom(shell) && bloom(motes));
	assert.ok(shell.layers.isEnabled(0), "still draws normally");
	for (const n of ["wardedAura", "wardedSheen"]) { assert.equal(bloom(opts.root.getObjectByName(n)), false, n); }
	opts.cheap = true;
	fx.update(0.1);
	assert.equal(bloom(shell), false);
	assert.equal(bloom(motes), false);
	opts.cheap = false;
	fx.update(0.1);
	assert.ok(bloom(shell) && bloom(motes));
	fx.dispose();
	const c = setup({ cheap: true });
	const fc = warded.create(c.mesh, c.opts);
	assert.equal(bloom(c.opts.root.getObjectByName("wardedShell")), false);
	assert.equal(bloom(c.opts.root.getObjectByName("wardedMotes")), false);
	fc.dispose();
});

test("cheap: half the motes drawn (rounded up)", () => {
	const { opts } = setup({ cheap: true });
	const fx = warded.create(opts.mesh, opts);
	const dots = opts.root.getObjectByName("wardedMotes").geometry;
	assert.equal(dots.drawRange.count, Math.ceil(dots.attributes.position.count / 2));
	opts.cheap = false;
	fx.update(0.1);
	assert.ok(dots.drawRange.count >= dots.attributes.position.count);
	fx.dispose();
});

test("metallic sheen: an overlay in the piece's shape; the piece's own material is never touched", () => {
	const { opts } = setup();
	const mat = opts.mesh.material, before = JSON.stringify(mat.toJSON());
	const fx = warded.create(opts.mesh, opts);
	const sheen = opts.root.getObjectByName("wardedSheen");
	assert.equal(sheen.geometry, opts.mesh.geometry);
	assert.ok(sheen.material.uniforms && sheen.material.uniforms.uGold, "a gold sheen shader");
	fx.update(0.4);
	fx.dispose();
	assert.equal(opts.mesh.material, mat);
	assert.equal(JSON.stringify(mat.toJSON()), before);
});

test("16 Warded pieces share their shader source (one program)", () => {
	const fxs = [], shells = [];
	for (let i = 0; i < 16; i++) { const { opts } = setup(); fxs.push(warded.create(opts.mesh, opts)); shells.push(opts.root.getObjectByName("wardedShell").material); }
	assert.equal(new Set(shells.map((m) => m.fragmentShader)).size, 1);
	fxs.forEach((f) => f.dispose());
});

const LAYERS = ["wardedAura", "wardedShell", "wardedSheen"];

test("colour space: every shader layer ends on three's tone mapping & colour space chunks (same colour with bloom on or off)", () => {
	const { opts } = setup();
	const fx = warded.create(opts.mesh, opts);
	for (const n of LAYERS) {
		assert.match(opts.root.getObjectByName(n).material.fragmentShader, /#include <tonemapping_fragment>\s*#include <colorspace_fragment>\s*}\s*$/, n);
	}
	fx.dispose();
});

test("a new mesh: update(0) re-points the shell & sheen at its geometry & its height", () => {
	const { opts } = setup();
	const fx = warded.create(opts.mesh, opts);
	const g = new CylinderGeometry(0.1, 0.3, 1.2, 12, 8);
	g.translate(0, 0.6, 0);
	g.computeBoundingBox();
	const mesh = new Mesh(g, new MeshStandardMaterial());
	mesh.userData.opacity = 1;
	mesh.add(opts.root);
	opts.mesh = mesh;
	fx.update(0);
	for (const n of ["wardedShell", "wardedSheen"]) {
		const o = opts.root.getObjectByName(n);
		assert.equal(o.geometry, g, n);
		assert.ok(Math.abs(o.material.uniforms.uTop.value - g.boundingBox.max.y) < 1e-9, n);
	}
	fx.dispose();
});

test("fades along: the shaders' uOpacity follows the piece's userData.opacity", () => {
	const { opts } = setup({ reduce: true });
	const fx = warded.create(opts.mesh, opts);
	const full = LAYERS.map((n) => opts.root.getObjectByName(n).material.uniforms.uOpacity.value);
	opts.mesh.userData.opacity = 0.25;
	fx.update(0);
	LAYERS.forEach((n, i) => {
		const v = opts.root.getObjectByName(n).material.uniforms.uOpacity.value;
		assert.ok(full[i] > 0 && Math.abs(v - 0.25 * full[i]) < 1e-9, `${n}: ${v} vs ${full[i]}`);
	});
	fx.dispose();
});

test("dispose frees each one's own geometry & materials, never the piece's shared geometry nor the motes' shared dot texture", () => {
	const { opts } = setup();
	const fx = warded.create(opts.mesh, opts);
	const objs = [...LAYERS, "wardedMotes"].map((n) => opts.root.getObjectByName(n));
	const freed = new Set();
	const spy = (o) => { o.dispose = () => freed.add(o); };
	const own = [objs[0].geometry, objs[3].geometry, ...objs.map((o) => o.material)];
	own.forEach(spy);
	spy(opts.mesh.geometry); spy(objs[3].material.map);
	fx.dispose();
	own.forEach((o, i) => assert.ok(freed.has(o), `own #${i} freed`));
	assert.equal(freed.has(opts.mesh.geometry), false, "the piece's geometry stays");
	assert.equal(freed.has(objs[3].material.map), false, "the dot texture is shared by every Warded piece (wardedMotes.js)");
	assert.equal(opts.root.children.length, 0);
});

test("cheap: the bloom layer is only switched when cheap changes, not every frame", () => {
	const { opts } = setup();
	const fx = warded.create(opts.mesh, opts);
	const layers = opts.root.getObjectByName("wardedShell").layers;
	let calls = 0;
	for (const k of ["enable", "disable"]) { const f = layers[k].bind(layers); layers[k] = (...a) => { calls++; return f(...a); }; }
	for (let i = 0; i < 5; i++) { fx.update(0.05); }
	assert.equal(calls, 0);
	opts.cheap = true;
	fx.update(0.05); fx.update(0.05);
	assert.equal(calls, 1);
	assert.equal(bloom(opts.root.getObjectByName("wardedShell")), false);
	fx.dispose();
});

test("burst: the body (halo, shell, sheen, motes) fades out over FADE_MS of wall time, not held then popped", (t) => {
	let now = 1000;
	t.mock.method(performance, "now", () => now);
	const { opts } = setup();
	const fx = warded.create(opts.mesh, opts);
	const objs = [...LAYERS, "wardedMotes"].map((n) => opts.root.getObjectByName(n));
	const level = () => objs.map((o) => (o.material.uniforms ? o.material.uniforms.uOpacity.value : o.material.opacity));
	fx.update(0);
	const full = level();
	assert.equal(fx.burst(), FLARE_MS + 100, "the lose flare's length plus a frame's margin");
	fx.update(0);
	level().forEach((v, i) => assert.ok(Math.abs(v - full[i]) < 1e-9, `starts full #${i}`));
	now += warded.FADE_MS / 2;
	fx.update(0);
	level().forEach((v, i) => assert.ok(Math.abs(v - full[i] / 2) < 1e-9, `half way #${i}: ${v} vs ${full[i]}`));
	now += warded.FADE_MS;
	fx.update(0.1);
	level().forEach((v, i) => assert.equal(v, 0, `gone #${i}`));
	fx.dispose();
});

// MOTES & GLINTS (wardedMotes.js)
function motesPiece() {
	const m = new Object3D();
	m.geometry = { boundingBox: { min: { x: -0.3, y: 0 }, max: { x: 0.3, y: 0.83 } } };
	return m;
}
const setupMotes = (more = {}) => { const mesh = motesPiece(); return { s: "warded", mesh, root: new Group(), reduce: false, ...more }; };
const points = (fx) => { const list = []; fx.object.traverse((o) => { if (o.isPoints) { list.push(o); } }); return list; };
const byName = (fx, name) => points(fx).find((p) => p.name === name);

test("moteCount: full is MOTES, cheap halves it (round up, at least 1)", () => {
	assert.equal(wm.moteCount(false), wm.MOTES);
	assert.equal(wm.moteCount(true), Math.max(1, Math.ceil(wm.MOTES / 2)));
	assert.ok(wm.MOTES >= 10, "more motes than Task 22's 8");
});

test("moteAt: each mote climbs foot to top, fades in & out, and spirals (its angle turns as it rises)", () => {
	const out = new Float32Array(4), top = 1, half = 0.3;
	for (let i = 0; i < wm.MOTES; i++) {
		const p = wm.moteParams(i), period = p.period;
		const ys = [], as = [], angles = [];
		for (let k = 0; k < 20; k++) {
			wm.moteAt((k / 20) * period - p.phase * period + 1e-6, i, top, half, out);
			ys.push(out[1]); as.push(out[3]); angles.push(Math.atan2(out[2], out[0]));
		}
		for (let k = 1; k < 20; k++) { assert.ok(ys[k] > ys[k - 1], `mote ${i} rises`); }
		assert.ok(as[0] < 0.05 && Math.max(...as) > 0.5, `mote ${i} fades in from nothing`);
		assert.ok(new Set(angles.map((a) => a.toFixed(2))).size > 10, `mote ${i} circles the piece`);
	}
});

test("motes vary: sizes, speeds, colours around gold", () => {
	const ps = Array.from({ length: wm.MOTES }, (_, i) => wm.moteParams(i));
	const spread = (k) => Math.max(...ps.map((p) => p[k])) - Math.min(...ps.map((p) => p[k]));
	assert.ok(spread("size") > 0.4 && spread("period") > 0.5, "sizes & speeds differ");
	for (const p of ps) {
		const [r, g, b] = p.color;
		assert.ok(r >= g && g > b && r > 0.9 && b < 0.7, `gold-ish ${p.color}`);
	}
	assert.ok(spread("phase") > 0.5, "spread through the climb");
	assert.deepEqual(wm.moteParams(3), wm.moteParams(3), "deterministic");
});

test("glintAt: dark most of the time, a few brief flashes every few seconds", () => {
	const out = new Float32Array(4), step = 0.01, span = 60;
	let lit = 0, flashes = 0, longest = 0;
	const was = [], run = [];
	for (let t = 0; t < span; t += step) {
		let on = false;
		for (let j = 0; j < wm.GLINTS; j++) {
			wm.glintAt(t, j, 1, 0.3, out);
			const s = out[3] > 0;
			if (s) { on = true; assert.ok(out[3] <= 1); run[j] = (run[j] || 0) + 1; longest = Math.max(longest, run[j]); if (!was[j]) { flashes++; } } else { run[j] = 0; }
			was[j] = s;
		}
		if (on) { lit++; }
	}
	assert.ok(lit * step < span * 0.3, "dark most of the time");
	assert.ok(flashes >= span / 8 && flashes <= span / 1, `a flash every few seconds (${flashes} in ${span} s)`);
	assert.ok(longest * step <= wm.GLINT_S + 0.02, "each flash is brief");
});

test("make: one Points draw for motes, one for glints; full is on BLOOM_LAYER & shows glints", () => {
	const opts = setupMotes();
	const fx = wm.make(opts.mesh, opts);
	opts.root.add(fx.object);
	fx.update(1.3, opts);
	assert.equal(points(fx).length, 2);
	const motes = byName(fx, "wardedMotes"), glints = byName(fx, "wardedGlints");
	assert.equal(motes.geometry.drawRange.count, wm.MOTES);
	assert.ok(glints.visible);
	assert.ok(motes.layers.isEnabled(BLOOM_LAYER) && glints.layers.isEnabled(BLOOM_LAYER));
	assert.ok(motes.layers.isEnabled(0), "still draws normally");
	assert.notEqual(glints.material.map, motes.material.map, "glints use their own star, not the dot");
	assert.ok(motes.geometry.attributes.aSize, "per-mote sizes");
});

test("cheap: half the motes, no glints, no bloom; flips back when cheap clears", () => {
	const opts = setupMotes({ cheap: true });
	const fx = wm.make(opts.mesh, opts);
	fx.update(2, opts);
	const motes = byName(fx, "wardedMotes"), glints = byName(fx, "wardedGlints");
	assert.equal(motes.geometry.drawRange.count, wm.moteCount(true));
	assert.equal(glints.visible, false);
	assert.ok(!motes.layers.isEnabled(BLOOM_LAYER) && !glints.layers.isEnabled(BLOOM_LAYER));
	opts.cheap = false;
	fx.update(2.1, opts);
	assert.equal(motes.geometry.drawRange.count, wm.MOTES);
	assert.ok(motes.layers.isEnabled(BLOOM_LAYER));
});

test("reduce: no glints and the motes hold still", () => {
	const opts = setupMotes({ reduce: true });
	const fx = wm.make(opts.mesh, opts);
	const motes = byName(fx, "wardedMotes");
	fx.update(1, opts);
	const a = Array.from(motes.geometry.attributes.position.array);
	fx.update(4, opts);
	assert.deepEqual(Array.from(motes.geometry.attributes.position.array), a);
	assert.equal(byName(fx, "wardedGlints").visible, false);
});

test("the piece's fade dims both draws; sizes follow the piece's scale", () => {
	const opts = setupMotes();
	const fx = wm.make(opts.mesh, opts);
	fx.update(1, opts);
	const motes = byName(fx, "wardedMotes"), size = motes.material.size;
	opts.mesh.userData.opacity = 0.5;
	opts.mesh.scale.setScalar(2);
	fx.update(1.1, opts);
	assert.ok(Math.abs(motes.material.opacity - 0.45) < 1e-6);
	assert.ok(Math.abs(motes.material.size - 2 * size) < 1e-6);
});

test("the size patch multiplies three's point size by the per-point aSize", () => {
	const shader = { vertexShader: "uniform float size;\nvoid main() {\n\tgl_PointSize = size;\n}" };
	wm.sizePatch(shader);
	assert.match(shader.vertexShader, /attribute float aSize;/);
	assert.match(shader.vertexShader, /gl_PointSize = size \* aSize;/);
});

test("the size patch still matches three's real points shader (a miss would draw every mote one size)", () => {
	const { ShaderLib } = require("three");
	const shader = { vertexShader: ShaderLib.points.vertexShader };
	wm.sizePatch(shader);
	assert.match(shader.vertexShader, /attribute float aSize;/);
	assert.match(shader.vertexShader, /gl_PointSize = size \* aSize;/);
});

test("dispose frees its geometries & materials, not the shared textures, and detaches", () => {
	const opts = setupMotes();
	const fx = wm.make(opts.mesh, opts);
	opts.root.add(fx.object);
	const owned = new Set(), freed = new Set(), shared = new Set();
	for (const p of points(fx)) { owned.add(p.geometry); owned.add(p.material); shared.add(p.material.map); }
	[...owned, ...shared].forEach((r) => r.addEventListener("dispose", () => freed.add(r)));
	fx.dispose();
	for (const r of owned) { assert.ok(freed.has(r)); }
	for (const r of shared) { assert.ok(!freed.has(r), "a shared texture stays"); }
	assert.equal(opts.root.children.length, 0);
	const again = wm.make(opts.mesh, opts);
	assert.equal(byName(again, "wardedMotes").material.map, byName(fx, "wardedMotes").material.map, "textures are module-level, shared across pieces");
});

// THE GAIN & LOSE FLARE (wardedFlare.js)
function flarePiece() {
	const m = new Object3D();
	m.geometry = { boundingBox: { min: { x: -0.3, y: 0 }, max: { x: 0.3, y: 0.83 } } };
	m.userData = {};
	return m;
}
const optsFor = (extra = {}) => { const mesh = flarePiece(); return { mesh, root: new Group(), reduce: false, ...extra }; };
const meshes = (fx) => { const out = []; fx.object.traverse((o) => { if (o.material) { out.push(o); } }); return out; };
const bloomOn = (fx) => meshes(fx).some((o) => o.layers.isEnabled(BLOOM_LAYER));

test("FLARE_MS is about 600", () => {
	assert.ok(flare.FLARE_MS >= 450 && flare.FLARE_MS <= 750);
});

test("gain: the ring rises & widens from the foot, with a brief bright pulse early", () => {
	const a = flare.flareLook("gain", 0), m = flare.flareLook("gain", 0.5), z = flare.flareLook("gain", 1);
	assert.equal(a.ringY, 0);
	assert.ok(m.ringY > a.ringY && z.ringY > m.ringY, "rises");
	assert.ok(m.ringScale > a.ringScale && z.ringScale > m.ringScale, "widens");
	const peak = flare.flareLook("gain", 0.2).glowA;
	assert.ok(peak > 0.6 && peak > m.glowA && peak > a.glowA, "pulse early");
	assert.equal(z.ringA, 0);
	assert.ok(z.glowA < 0.01);
	assert.equal(m.shardA, 0, "no shards on a gain");
});

test("lose: the glow breaks outward (shards fly out) & fades to nothing", () => {
	const a = flare.flareLook("lose", 0), m = flare.flareLook("lose", 0.5), z = flare.flareLook("lose", 1);
	assert.ok(a.glowA > m.glowA && m.glowA > z.glowA);
	assert.ok(m.shardR > a.shardR && z.shardR > m.shardR, "shards fly out");
	assert.ok(m.glowScale > a.glowScale);
	assert.equal(z.glowA, 0); assert.equal(z.ringA, 0); assert.equal(z.shardA, 0);
});

test("shardCount: full, & cheap halves it rounding up (min 1)", () => {
	assert.equal(flare.shardCount(false), flare.SHARDS);
	assert.equal(flare.shardCount(true), Math.max(1, Math.ceil(flare.SHARDS / 2)));
});

test("idle is invisible & update does nothing; play shows it, then it hides after FLARE_MS", () => {
	const opts = optsFor(), fx = flare.make(opts.mesh, opts);
	assert.equal(typeof fx.play, "function");
	assert.equal(fx.object.visible, false);
	fx.update(1, opts);
	assert.equal(fx.object.visible, false);
	fx.play("gain");
	fx.update(2, opts);
	assert.equal(fx.object.visible, true);
	fx.update(2 + flare.FLARE_MS / 2000, opts);
	assert.equal(fx.object.visible, true);
	fx.update(2 + flare.FLARE_MS / 1000 + 0.01, opts);
	assert.equal(fx.object.visible, false);
	fx.dispose();
});

test("bloom layer while playing unless cheap; cheap draws half the shards", () => {
	const opts = optsFor(), fx = flare.make(opts.mesh, opts);
	fx.play("lose"); fx.update(0, opts); fx.update(0.1, opts);
	assert.ok(bloomOn(fx));
	const shards = fx.object.getObjectByName("wardedFlareShards");
	assert.equal(shards.geometry.drawRange.count, flare.SHARDS);
	opts.cheap = true; fx.update(0.2, opts);
	assert.equal(bloomOn(fx), false);
	assert.equal(shards.geometry.drawRange.count, flare.shardCount(true));
	fx.dispose();
});

test("dispose frees its own materials & geometry, not the shared ones, & leaves its parent", () => {
	const opts = optsFor(), fx = flare.make(opts.mesh, opts);
	opts.root.add(fx.object);
	fx.play("lose");
	const freed = new Set();
	fx.object.traverse((o) => {
		if (o.material) { o.material.addEventListener("dispose", () => freed.add(o.material)); }
		if (o.geometry) { o.geometry.addEventListener("dispose", () => freed.add(o.geometry)); }
	});
	fx.dispose();
	const own = [], shared = [];
	for (const o of meshes(fx)) { own.push(o.material); (o.name === "wardedFlareShards" ? own : shared).push(o.geometry); }
	assert.equal(own.length, 4, "3 materials + the shard geometry");
	for (const x of own) { assert.ok(freed.has(x), "own freed"); }
	for (const x of shared) { assert.equal(freed.has(x), false, "shared kept"); }
	assert.equal(fx.object.parent, null);
});

// FIX ROUND 1 (S2c I1/M3/M4, rulings T24-R1/R3): NO FLARE UNDER REDUCE, UNKNOWN KINDS IGNORED, MATERIALS ONLY ONCE A FLARE PLAYS
test("reduce on, play does nothing visible, even over many frames at a frozen clock", () => {
	const opts = optsFor({ reduce: true }), fx = flare.make(opts.mesh, opts);
	fx.play("gain");
	assert.equal(fx.object.visible, false);
	for (let i = 0; i < 100; i++) { fx.update(5, opts); }
	assert.equal(fx.object.visible, false);
	fx.dispose();
});

test("reduce turned on mid-flare hides it at once, & it stays hidden when reduce goes off", () => {
	const opts = optsFor(), fx = flare.make(opts.mesh, opts);
	fx.play("gain"); fx.update(0, opts); fx.update(0.3, opts);
	assert.equal(fx.object.visible, true);
	opts.reduce = true; fx.update(0.3, opts);
	assert.equal(fx.object.visible, false);
	opts.reduce = false; fx.update(0.35, opts);
	assert.equal(fx.object.visible, false, "the flare was dropped, not paused");
	fx.dispose();
});

test("an unknown kind is ignored and does not cut a playing flare", () => {
	const opts = optsFor(), fx = flare.make(opts.mesh, opts);
	fx.play("foo"); fx.update(0, opts); fx.update(0.1, opts);
	assert.equal(fx.object.visible, false, "foo plays nothing");
	fx.play("gain"); fx.update(1, opts);
	fx.play("bogus"); fx.update(1.1, opts);
	assert.equal(fx.object.visible, true, "the gain keeps playing");
	fx.update(1 + flare.FLARE_MS / 1000 + 0.01, opts);
	assert.equal(fx.object.visible, false, "and ends on its own clock");
	fx.dispose();
});

test("no materials until the first play; dispose of a never-played flare is harmless", () => {
	const opts = optsFor(), fx = flare.make(opts.mesh, opts);
	assert.equal(meshes(fx).length, 0);
	fx.dispose(); fx.dispose();
	const fx2 = flare.make(opts.mesh, opts);
	fx2.play("lose");
	assert.equal(meshes(fx2).length, 3);
	fx2.play("gain");
	assert.equal(meshes(fx2).length, 3, "a replay builds nothing new");
	fx2.dispose();
});

test("an update after dispose on a playing flare does nothing", () => {
	const { Object3D } = require("three");
	const m = new Object3D();
	m.geometry = { boundingBox: { min: { x: -0.3, y: 0 }, max: { x: 0.3, y: 0.83 } } };
	m.userData = {};
	const opts = { mesh: m, cheap: false, reduce: false };
	const f = require("../src/js/gameplay/three/statusFx/wardedFlare.js").make(m, opts);
	f.play("gain"); f.update(0, opts); f.update(0.1, opts);
	f.dispose();
	assert.doesNotThrow(() => f.update(0.2, opts));
});

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
