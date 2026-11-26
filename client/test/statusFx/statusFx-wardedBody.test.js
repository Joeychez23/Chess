// WARDED'S BODY (three/statusFx/warded/warded.js): SHELL, SHIMMER, HALO, SHEEN, BLOOM, FADE & DISPOSE, WITHOUT WebGL: NOTHING IS DRAWN
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Group, Mesh, CylinderGeometry, MeshStandardMaterial } = require("three");
require("../helpers/statusFxWarded.js");
const { BLOOM_LAYER } = require("../../src/js/gameplay/three/constants.js");
const warded = require("../../src/js/gameplay/three/statusFx/warded/warded.js");
const flare = require("../../src/js/gameplay/three/statusFx/warded/wardedFlare.js");
const { FLARE_MS } = flare;

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
