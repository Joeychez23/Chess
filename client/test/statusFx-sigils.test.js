// THE ENCHANTMENT RINGS (three/statusFx/sigils.js, TASK 22 S1) ON A PLAIN three Object3D PIECE: NO WebGL, A CANVAS IS A STUB THAT RECORDS ITS fillText & fillStyle CALLS
const { test } = require("node:test");
const assert = require("node:assert/strict");

global.window = { matchMedia: () => ({ matches: false, addEventListener() {} }) }; // constants.js READS IT AS IT LOADS
global.document = {
	createElement() {
		const canvas = { width: 0, height: 0, texts: [], fills: [] };
		const ctx = new Proxy({ fillText: (t) => canvas.texts.push(String(t)) }, {
			get: (o, k) => (k in o ? o[k] : () => {}),
			set: (o, k, v) => { if (k === "fillStyle") { canvas.fills.push(String(v)); } return true; },
		});
		canvas.getContext = () => ctx;
		return canvas;
	},
};
const { Object3D, Group } = require("three");
const sigils = require("../src/js/gameplay/three/statusFx/sigils.js");
const hex = require("../src/js/gameplay/three/statusFx/hex.js");
const { CELL_SIZE } = require("../src/js/gameplay/three/constants.js");

const BODY = { "heavy-cavalry": "rgba(215,140,60,", "heretical-subjection": "rgba(165,110,230,", "opposing-finality": "rgba(70,200,190," }; // EACH PALETTE'S BODY COLOUR (art/Enchantments/sigils-3d.html)

function setup(s, left = null, reduce = false) {
	const mesh = new Object3D();
	mesh.geometry = { boundingBox: { min: { x: -0.34, y: 0, z: -0.34 }, max: { x: 0.34, y: 0.83, z: 0.34 } } };
	mesh.scale.setScalar(2.4); // PIECE_SIZE
	mesh.userData.opacity = 1;
	const root = new Group(), squareRoot = new Group();
	mesh.add(root);
	return { s, id: "p1", left, by: "w", square: "e4", mode: "effects", slot: 0, slots: 1, siblings: [], mesh, root, squareRoot, reduce };
}
function resources(opts) {
	const all = new Set();
	opts.root.traverse((o) => {
		if (o.geometry && o.geometry.dispose && !o.isSprite) { all.add(o.geometry); } // three'S SPRITES SHARE ONE GEOMETRY: NOT OURS TO FREE
		if (o.material) { all.add(o.material); if (o.material.map) { all.add(o.material.map); } }
	});
	const freed = new Set();
	all.forEach((r) => r.addEventListener("dispose", () => freed.add(r)));
	return { all, freed };
}
const ringOf = (opts) => opts.root.children.find((o) => !o.isSprite);
const numberOf = (opts) => opts.root.children.find((o) => o.isSprite);
const near = (a, b) => Math.abs(a - b) < 1e-9;

test("sigils: the ring and its number go in opts.root, low at the base and level; dispose takes them off and frees all", () => {
	const opts = setup("heretical-subjection", 3);
	const fx = sigils.create(opts.mesh, opts);
	assert.equal(opts.root.children.length, 2);
	assert.equal(opts.squareRoot.children.length, 0);
	const ring = ringOf(opts);
	assert.ok(near(ring.rotation.x, -Math.PI / 2), "level");
	assert.ok(ring.position.y > 0 && ring.position.y < 0.05, "just over the base, under Hex's middle ring");
	assert.ok(ring.position.y * opts.mesh.scale.y > 0.02, "over Marked's square glow (0.02 world units)");
	assert.ok(near(ring.position.y * opts.mesh.scale.y, 0.04), "0.04 world units over the base");
	assert.ok(near(ring.scale.x * opts.mesh.scale.x, CELL_SIZE), "one square wide in world units");
	const { all, freed } = resources(opts);
	assert.ok(all.size >= 5, "ring geometry + material + glyph texture, number material + texture");
	fx.dispose();
	assert.equal(opts.root.children.length, 0);
	assert.equal(freed.size, all.size);
});

test("sigils: each enchantment has its own glyph texture in its own colour; one kind shares one, freed with its last ring", () => {
	const made = Object.keys(BODY).map((s) => { const opts = setup(s); return { s, opts, fx: sigils.create(opts.mesh, opts) }; });
	const maps = made.map(({ opts }) => ringOf(opts).material.map);
	assert.equal(new Set(maps).size, 3);
	made.forEach(({ s }, i) => {
		const fills = maps[i].image.fills.join(" ");
		for (const [k, body] of Object.entries(BODY)) { assert.equal(fills.includes(body), k === s, `${s}'s texture ${k === s ? "has" : "lacks"} ${k}'s colour`); }
	});
	const twin = setup("heavy-cavalry"), fx2 = sigils.create(twin.mesh, twin);
	assert.equal(ringOf(twin).material.map, maps[0], "two Heavy Cavalry rings, one texture");
	let freed = false;
	maps[0].addEventListener("dispose", () => { freed = true; });
	made[0].fx.dispose();
	assert.equal(freed, false, "the twin still uses it");
	fx2.dispose();
	assert.equal(freed, true, "the last ring frees it");
	const again = setup("heavy-cavalry"), fx3 = sigils.create(again.mesh, again);
	assert.notEqual(ringOf(again).material.map, maps[0], "a fresh texture after the last was freed");
	fx3.dispose();
	made.slice(1).forEach(({ fx }) => fx.dispose());
});

test("sigils: the number follows opts.left, none when it is null", () => {
	const opts = setup("heretical-subjection", 3);
	const fx = sigils.create(opts.mesh, opts), number = numberOf(opts), canvas = number.material.map.image;
	assert.equal(number.visible, true);
	assert.equal(canvas.texts.at(-1), "3");
	opts.left = 2;
	fx.update(0);
	assert.equal(canvas.texts.at(-1), "2");
	fx.dispose();
	const none = setup("opposing-finality", null), fx2 = sigils.create(none.mesh, none);
	assert.equal(numberOf(none).visible, false);
	assert.equal(numberOf(none).material.map.image.texts.length, 0);
	fx2.dispose();
});

test("sigils: the pulse at its start, middle and end; still under reduced motion", () => {
	assert.ok(near(sigils.sigilPulse(0, false), 0.7), "the mockup's 0.7..1 (ruling T22-6)");
	assert.ok(near(sigils.sigilPulse(sigils.PULSE_S / 2, false), 1));
	assert.ok(near(sigils.sigilPulse(sigils.PULSE_S, false), 0.7));
	assert.equal(sigils.sigilPulse(1.3, true), 1);
});

test("sigils: update pulses the ring and fades it with the piece; still and not animating under reduced motion; burst ends it at once", () => {
	const opts = setup("opposing-finality");
	const fx = sigils.create(opts.mesh, opts), ring = ringOf(opts);
	assert.equal(fx.animating(), true);
	fx.update(sigils.PULSE_S / 2);
	assert.ok(near(ring.material.opacity, 1));
	opts.mesh.userData.opacity = 0.5;
	fx.update(0);
	assert.ok(near(ring.material.opacity, 0.5));
	assert.ok(near(numberOf(opts).material.opacity, 0.5), "the number fades with the piece");
	fx.update(1000);
	assert.equal(fx.animating(), true, "a ring with no end keeps pulsing (ruling T22-7)");
	opts.reduce = true;
	fx.update(0.3);
	assert.equal(fx.animating(), false);
	const still = ring.material.opacity;
	fx.update(0.4);
	assert.equal(ring.material.opacity, still, "no motion while reduced");
	assert.equal(fx.burst(), 0);
	fx.dispose();
});

test("sigils: a second dispose does nothing, and never frees a twin's shared texture", () => {
	const a = setup("opposing-finality"), b = setup("opposing-finality");
	const fxA = sigils.create(a.mesh, a), fxB = sigils.create(b.mesh, b), map = ringOf(b).material.map;
	let freed = false;
	map.addEventListener("dispose", () => { freed = true; });
	fxA.dispose();
	assert.doesNotThrow(() => fxA.dispose());
	assert.equal(freed, false, "the twin still uses it");
	assert.doesNotThrow(() => fxB.dispose());
	assert.equal(freed, true, "the last ring frees it");
	assert.doesNotThrow(() => fxB.dispose());
});

// THE NUMBER'S BOX IN SCREEN SPACE, IN PIECE UNITS ROUND ITS ANCHOR (A SPRITE'S center SHIFTS IT): x LEFT TO RIGHT, y UP
const box = (n) => ({ x0: -n.center.x * n.scale.x, x1: (1 - n.center.x) * n.scale.x, y0: -n.center.y * n.scale.y, y1: (1 - n.center.y) * n.scale.y });
const apart = (p, q) => p.x1 <= q.x0 || q.x1 <= p.x0 || p.y1 <= q.y0 || q.y1 <= p.y0;

test("sigils: on a Hexed piece the number goes left, Hex's stays right; it moves on update(0) when siblings change", () => {
	const opts = setup("heretical-subjection", 3);
	const fx = sigils.create(opts.mesh, opts), number = numberOf(opts);
	assert.ok(box(number).x0 >= 0, "no Hex: right of the piece");
	const hexOpts = { ...opts, s: "hexed", left: 2 }, hexFx = hex.create(opts.mesh, hexOpts);
	const hexNumber = opts.root.children.filter((o) => o.isSprite).find((o) => o !== number);
	opts.siblings = ["hexed"];
	fx.update(0);
	assert.ok(box(number).x1 <= 0, "Hexed: left of the piece");
	assert.ok(box(hexNumber).x0 >= 0, "Hex's number right of the piece");
	opts.siblings = [];
	fx.update(0);
	assert.ok(box(number).x0 >= 0, "Hex gone: back on the right");
	hexFx.dispose();
	fx.dispose();
});

test("sigils: two rings on one piece are concentric, ringSlot 1 a little wider; it re-sizes on update(0); their numbers never overlap", () => {
	const inner = setup("heretical-subjection", 3), outer = { ...setup("opposing-finality", 2), mesh: inner.mesh, root: inner.root };
	delete inner.ringSlot;
	outer.ringSlot = 1; outer.ringSlots = 2;
	const fxIn = sigils.create(inner.mesh, inner), ringIn = ringOf(inner);
	const fxOut = sigils.create(outer.mesh, outer), ringOut = inner.root.children.filter((o) => !o.isSprite).find((o) => o !== ringIn);
	const numIn = inner.root.children.filter((o) => o.isSprite)[0], numOut = inner.root.children.filter((o) => o.isSprite)[1];
	assert.ok(near(ringIn.scale.x * inner.mesh.scale.x, CELL_SIZE), "no ringSlot: the inner ring, one square wide");
	const k = ringOut.scale.x / ringIn.scale.x;
	assert.ok(k > 1.05 && k <= 1.2, `the outer ring a little wider (${k})`);
	assert.ok(near(ringOut.position.y, ringIn.position.y) && ringOut.position.x === ringIn.position.x && ringOut.position.z === ringIn.position.z, "concentric, level");
	assert.ok(apart(box(numIn), box(numOut)), "both numbers clear of each other");
	assert.ok(near(ringOut.rotation.z - ringIn.rotation.z, Math.PI / 3), "the outer ring turned 60 deg: its glyphs land between the inner ring's (re-review N1)");
	inner.siblings = ["hexed", "opposing-finality"]; outer.siblings = ["hexed", "heretical-subjection"];
	fxIn.update(0); fxOut.update(0);
	assert.ok(apart(box(numIn), box(numOut)), "clear of each other on the left too");
	assert.ok(box(numIn).x1 <= 0 && box(numOut).x1 <= 0, "both left of a Hexed piece");
	outer.ringSlot = 0;
	fxOut.update(0);
	assert.ok(near(ringOut.scale.x, ringIn.scale.x), "re-sized on update(0)");
	fxIn.dispose();
	fxOut.dispose();
});
