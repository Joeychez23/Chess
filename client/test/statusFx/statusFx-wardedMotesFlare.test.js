// WARDED'S MOTES & GLINTS (three/statusFx/warded/wardedMotes.js) & ITS GAIN & LOSE FLARE (wardedFlare.js), WITHOUT WebGL: NOTHING IS DRAWN
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Group, Object3D } = require("three");
require("../helpers/statusFxWarded.js");
const { BLOOM_LAYER } = require("../../src/js/gameplay/three/constants.js");
require("../../src/js/gameplay/three/statusFx/warded/warded.js"); // first, as the game loads it: the motes, flare and light files import it back
const wm = require("../../src/js/gameplay/three/statusFx/warded/wardedMotes.js");
const flare = require("../../src/js/gameplay/three/statusFx/warded/wardedFlare.js");

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

// NO FLARE UNDER REDUCE, UNKNOWN KINDS IGNORED, MATERIALS ONLY ONCE A FLARE PLAYS
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
	const f = require("../../src/js/gameplay/three/statusFx/warded/wardedFlare.js").make(m, opts);
	f.play("gain"); f.update(0, opts); f.update(0.1, opts);
	f.dispose();
	assert.doesNotThrow(() => f.update(0.2, opts));
});
