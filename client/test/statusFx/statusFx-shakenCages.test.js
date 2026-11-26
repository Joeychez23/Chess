// SHAKEN'S EFFECT (three/statusFx/shaken/shaken.js, TASK 21 S6) WITHOUT WebGL: A PIECE IS A PLAIN three Object3D, THE GLYPH'S CANVAS IS A NO-OP STUB, & dispose's FREEING IS COUNTED THROUGH three's "dispose" EVENTS
const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");

global.window = { matchMedia: () => ({ matches: false, addEventListener() {} }) }; // constants.js READS IT AS IT LOADS
const blurs = []; // EVERY shadowBlur A CANVAS WAS SET TO (THE GLYPH'S GLOW)
const ctx = new Proxy({}, { get: () => () => {}, set: (o, k, v) => { if (k === "shadowBlur") { blurs.push(v); } return true; } }); // EVERY 2D CALL IS A NO-OP
global.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
const { Object3D, Group } = require("three");
const shaken = require("../../src/js/gameplay/three/statusFx/shaken/shaken.js");

const alive = new Set(); // EFFECTS NOT YET DISPOSED: THE SHARED GLYPH TEXTURE IS FREED ONLY WHEN THE LAST GOES, SO EACH TEST STARTS WITH NONE
afterEach(() => { alive.forEach((fx) => fx.dispose()); });
function setup(left, extra = {}) {
	const mesh = new Object3D();
	mesh.geometry = { boundingBox: { min: { y: 0 }, max: { y: 0.83 } } };
	mesh.userData.opacity = 1;
	const root = new Group();
	mesh.add(root);
	const opts = { s: "shaken", id: "p1", left, by: "b", square: "e4", mode: "effects", slot: 0, slots: 1, siblings: [], mesh, root, squareRoot: new Group(), reduce: false, ...extra };
	const fx = shaken.create(mesh, opts), dispose = fx.dispose;
	fx.dispose = () => { alive.delete(fx); dispose(); };
	alive.add(fx);
	return { opts, fx };
}

// EVERY GEOMETRY, MATERIAL & TEXTURE UNDER root, & A COUNT OF THOSE THAT FIRED "dispose"
function resources(root) {
	const out = new Set();
	root.traverse((o) => {
		if (o.geometry && !o.isSprite) { out.add(o.geometry); } // EVERY SPRITE SHARES three's ONE GEOMETRY: NOT THE EFFECT'S TO FREE
		if (o.material) { out.add(o.material); if (o.material.map) { out.add(o.material.map); } }
	});
	return [...out];
}
function watch(list) {
	const freed = new Set();
	list.forEach((r) => r.addEventListener("dispose", () => freed.add(r)));
	return freed;
}
const cages = (opts) => opts.root.getObjectByName("shakenCages").children.length;

test("create adds its cages to root, dispose takes them off & frees every geometry, material & texture", () => {
	const { opts, fx } = setup(2);
	const made = resources(opts.root);
	assert.ok(made.some((r) => r.isTexture), "the glyph texture");
	assert.ok(made.some((r) => r.isBufferGeometry), "the bolts");
	const freed = watch(made);
	fx.dispose();
	assert.equal(opts.root.children.length, 0);
	assert.equal(freed.size, made.length);
});

test("one cage per turn left, one for a permanent Shaken, none at 0", () => {
	assert.equal(shaken.cageCount(3), 3);
	assert.equal(shaken.cageCount(1), 1);
	assert.equal(shaken.cageCount(null), 1);
	assert.equal(shaken.cageCount(0), 0);
	assert.equal(cages(setup(2).opts), 2);
	assert.equal(cages(setup(null).opts), 1);
});

test("a turn passing: the last cage bursts, then is freed", () => {
	const { opts, fx } = setup(2);
	const before = resources(opts.root), freed = watch(before);
	opts.left = 1;
	fx.update(0);
	assert.equal(cages(opts), 2, "the bursting cage is still drawn");
	assert.equal(fx.animating(), true);
	fx.update(shaken.BURST_SECONDS);
	assert.equal(cages(opts), 1);
	assert.ok(freed.size > 0, "the burst cage's own material & bolts are freed");
	assert.ok(![...freed].some((r) => r.isTexture), "the shared glyph texture stays");
});

test("under reduced motion a lower left drops the cage at once, nothing animates, burst returns 0", () => {
	const { opts, fx } = setup(2, { reduce: true });
	assert.equal(fx.animating(), false);
	opts.left = 1;
	fx.update(0);
	assert.equal(cages(opts), 1);
	assert.equal(fx.burst(), 0);
	assert.equal(fx.animating(), false);
});

test("burst plays the last cage out over BURST_SECONDS seconds and asks for frames", () => {
	const { opts, fx } = setup(1);
	const ms = fx.burst();
	assert.equal(ms, shaken.BURST_SECONDS * 1000);
	assert.equal(fx.animating(), true);
	fx.update(shaken.BURST_SECONDS / 2);
	assert.equal(cages(opts), 1);
	fx.update(shaken.BURST_SECONDS / 2);
	assert.equal(cages(opts), 0);
});

test("flash: full at the strike, half way down mid-fade, gone at the end and after", () => {
	assert.equal(shaken.flash(0), 1);
	assert.ok(Math.abs(shaken.flash(shaken.FLASH_SECONDS / 2) - 0.5) < 1e-9);
	assert.equal(shaken.flash(shaken.FLASH_SECONDS), 0);
	assert.equal(shaken.flash(5), 0);
});

test("burstLook: whole at 0, growing and fading mid, gone at the end", () => {
	assert.deepEqual(shaken.burstLook(0), { scale: 1, opacity: 1 });
	const mid = shaken.burstLook(shaken.BURST_SECONDS / 2);
	assert.ok(mid.scale > 1 && mid.opacity > 0 && mid.opacity < 1);
	assert.equal(shaken.burstLook(shaken.BURST_SECONDS).opacity, 0);
});

test("a bolt strikes about every second, and fades with the piece", () => {
	const { opts, fx } = setup(1);
	const bolt = opts.root.getObjectByName("shakenCages").children[0].getObjectByName("bolts");
	fx.update(0);
	const rest = bolt.material.opacity;
	fx.update(shaken.STRIKE_SECONDS);
	assert.ok(bolt.material.opacity > rest, "the strike flashes");
	fx.update(shaken.FLASH_SECONDS);
	assert.equal(bolt.material.opacity, rest);
	opts.mesh.userData.opacity = 0.5;
	fx.update(0);
	assert.equal(bolt.material.opacity, rest * 0.5);
});

// FIX ROUND 1 (task-21-S6-review.md I1, M1-M5, task-21-S7-review.md I1; RULINGS 09:19 & R15)
const row = (opts) => opts.root.getObjectByName("shakenCages");
const coreMap = (opts, i) => row(opts).children[i].children[0].material.map;

test("at most 3 cages; more turns left still show 3", () => {
	assert.equal(shaken.cageCount(4), 3);
	assert.equal(shaken.cageCount(9), 3);
	const { opts, fx } = setup(5);
	assert.equal(cages(opts), 3);
	opts.left = 4;
	fx.update(0);
	assert.equal(cages(opts), 3, "no burst above 3");
	assert.equal(fx.animating(), true);
});

test("with Marked on the piece the centre cage's core is the skull, the cage count is unchanged, and the glyph returns when Marked ends", () => {
	const glyph = coreMap(setup(1).opts, 0);
	for (const [left, centre] of [[null, 0], [1, 0], [2, 0], [3, 1]]) {
		const { opts, fx } = setup(left, { siblings: ["marked"] });
		const n = shaken.cageCount(left);
		assert.equal(cages(opts), n);
		for (let i = 0; i < n; i++) {
			if (i === centre) { assert.ok(coreMap(opts, i).isTexture && coreMap(opts, i) !== glyph, `left ${left}: the skull in cage ${i}`); }
			else { assert.equal(coreMap(opts, i), glyph, `left ${left}: cage ${i} keeps the glyph`); }
		}
		const skull = coreMap(opts, centre), freed = watch([skull]);
		opts.siblings = [];
		fx.update(0);
		for (let i = 0; i < n; i++) { assert.equal(coreMap(opts, i), glyph, "Marked ended: every core is the glyph again"); }
		opts.siblings = ["marked"];
		fx.update(0);
		assert.equal(coreMap(opts, centre), skull, "back again");
		fx.dispose();
		assert.equal(freed.size, 1, "dispose frees the skull texture");
	}
});

test("Shaken ending with Marked on: the bursting cage shows its own glyph (Marked's skull floats again)", () => {
	const glyph = coreMap(setup(1).opts, 0);
	const { opts, fx } = setup(1, { siblings: ["marked"] });
	fx.burst();
	fx.update(0.1);
	assert.equal(coreMap(opts, 0), glyph);
});

test("a turn passing, the cages left keep their places while the lost one bursts, then close up", () => {
	const { opts, fx } = setup(2);
	const keep = row(opts).children[0], x0 = keep.position.x;
	assert.ok(x0 < 0);
	opts.left = 1;
	fx.update(0);
	fx.update(shaken.BURST_SECONDS / 2);
	assert.equal(keep.position.x, x0, "no jump mid-burst");
	fx.update(shaken.BURST_SECONDS);
	assert.equal(keep.position.x, 0, "centred once the burst is over");
});

test("one glyph texture for every Shaken effect, painted once, freed only when the last effect goes", () => {
	const a = setup(1);
	const painted = blurs.length, b = setup(2);
	assert.equal(blurs.length, painted, "the second effect paints nothing");
	const map = coreMap(a.opts, 0), freed = watch([map]);
	assert.equal(coreMap(b.opts, 1), map);
	a.fx.dispose();
	assert.equal(freed.size, 0, "b still uses it");
	b.fx.dispose();
	assert.equal(freed.size, 1);
	const c = setup(1);
	assert.notEqual(coreMap(c.opts, 0), map, "a new one once the old is freed");
	assert.ok(blurs.length > painted, "and painted again");
});

test("the glyph's glow is as wide against the glyph as the mockup's (its 560 px canvas, blurs 34/14/6 px)", () => {
	blurs.length = 0;
	setup(1);
	assert.ok(blurs.length > 0);
	assert.ok(Math.abs(Math.max(...blurs) - 34 * 128 / 560) < 1e-9, `max blur ${Math.max(...blurs)}`); // 128: shaken.js PX
});

test("dispose during a turn's burst frees the bursting cage too", () => {
	const { opts, fx } = setup(2);
	const made = resources(opts.root), freed = watch(made);
	opts.left = 1;
	fx.update(0);
	fx.update(0.1);
	fx.dispose();
	assert.equal(opts.root.children.length, 0);
	assert.equal(freed.size, made.length);
});

test("under reduced motion nothing strikes: the bolts and opacities stay put", () => {
	const { opts, fx } = setup(2, { reduce: true });
	const snap = () => row(opts).children.map((g) => [[...g.getObjectByName("bolts").geometry.attributes.position.array], g.children.map((o) => o.material.opacity)]);
	const before = snap();
	fx.update(shaken.STRIKE_SECONDS * 3);
	assert.deepEqual(snap(), before);
});

test("reduced motion turned on mid-burst drops the bursting cage at once", () => {
	const { opts, fx } = setup(2);
	opts.left = 1;
	fx.update(0);
	assert.equal(cages(opts), 2);
	opts.reduce = true;
	fx.update(0);
	assert.equal(cages(opts), 1);
	assert.equal(fx.animating(), false);
});
