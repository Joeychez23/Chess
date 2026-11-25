// THE MARKED & HEX EFFECTS (three/statusFx/marked.js, hex.js, TASK 21 S7) ON A PLAIN three Object3D PIECE: NO WebGL, A CANVAS IS A RECORDING STUB. NEITHER MODULE IMPORTS
// three/index.js, SO THE threeStub RESOLVE HOOK ISN'T NEEDED HERE
const { test } = require("node:test");
const assert = require("node:assert/strict");

global.window = { matchMedia: () => ({ matches: false, addEventListener() {} }) }; // constants.js READS IT AS IT LOADS
const drawn = []; // EVERY fillText A CANVAS WAS ASKED FOR
global.document = {
	createElement: () => ({ width: 0, height: 0, getContext: () => new Proxy({ fillText: (t) => drawn.push(String(t)), createRadialGradient: () => ({ addColorStop() {} }) }, { get: (o, k) => (k in o ? o[k] : () => {}), set: () => true }) }),
};
const { Object3D, Group } = require("three");
const marked = require("../src/js/gameplay/three/statusFx/marked.js");
const hex = require("../src/js/gameplay/three/statusFx/hex.js");

function setup(s, left = 2, reduce = false) {
	const mesh = new Object3D();
	mesh.geometry = { boundingBox: { min: { x: -0.34, y: 0, z: -0.34 }, max: { x: 0.34, y: 0.83, z: 0.34 } } };
	mesh.userData.opacity = 1;
	const root = new Group(), squareRoot = new Group();
	mesh.add(root);
	return { s, id: "p1", left, by: "w", square: "e4", mode: "effects", slot: 0, slots: 1, siblings: [], mesh, root, squareRoot, reduce };
}

// EVERY GEOMETRY, MATERIAL & TEXTURE UNDER THE ROOTS, EACH MARKED WHEN ITS dispose() RUNS
function resources(opts) {
	const all = new Set();
	for (const root of [opts.root, opts.squareRoot]) {
		root.traverse((o) => {
			if (o.geometry && o.geometry.dispose && !o.isSprite) { all.add(o.geometry); } // three'S SPRITES SHARE ONE GEOMETRY: NOT OURS TO FREE
			if (o.material) { all.add(o.material); if (o.material.map) { all.add(o.material.map); } }
		});
	}
	const freed = new Set();
	all.forEach((r) => r.addEventListener("dispose", () => freed.add(r)));
	return { all, freed };
}
const near = (a, b) => Math.abs(a - b) < 1e-9;

test("marked: the skull goes over the piece (root), the glow on the view's square (squareRoot); dispose takes both off and frees all", () => {
	const opts = setup("marked", null);
	const fx = marked.create(opts.mesh, opts);
	assert.equal(opts.root.children.length, 1);
	assert.equal(opts.squareRoot.children.length, 1);
	assert.ok(opts.root.children[0].position.y > 0.83, "over the head");
	const { all, freed } = resources(opts);
	assert.ok(all.size >= 5, "skull material + texture, glow geometry + material + texture");
	fx.dispose();
	assert.equal(opts.root.children.length, 0);
	assert.equal(opts.squareRoot.children.length, 0);
	assert.equal(freed.size, all.size);
});

test("marked: the bob and the glow pulse are pure in time, still under reduced motion", () => {
	const at = (t) => marked.markedLook(t, false);
	assert.ok(near(at(0).bob, 0));
	assert.ok(near(at(Math.PI / 4).bob, marked.BOB)); // sin(2t) AT ITS TOP
	assert.ok(near(at(Math.PI).bob, 0));
	assert.ok(near(at(0).glow, marked.GLOW));
	assert.ok(near(at(Math.PI / 5).glow, marked.GLOW + marked.PULSE)); // sin(2.5t) AT ITS TOP
	assert.deepEqual(marked.markedLook(1.3, true), { bob: 0, glow: marked.GLOW });
});

test("marked: update bobs the skull and pulses the glow, follows the piece's fade, and stands still under reduced motion", () => {
	const opts = setup("marked", null);
	const fx = marked.create(opts.mesh, opts);
	const skull = opts.root.children[0], glow = opts.squareRoot.children[0], y0 = skull.position.y;
	assert.equal(fx.animating(), true);
	fx.update(Math.PI / 4);
	assert.ok(near(skull.position.y, y0 + marked.BOB));
	opts.mesh.userData.opacity = 0.5;
	fx.update(0);
	assert.ok(near(glow.material.opacity, 0.5 * marked.markedLook(Math.PI / 4, false).glow));
	opts.reduce = true;
	fx.update(0);
	assert.equal(fx.animating(), false);
	assert.ok(near(skull.position.y, y0));
	fx.update(0.1);
	assert.ok(near(skull.position.y, y0), "no motion while reduced");
	fx.dispose();
});

test("marked: burst plays a short fade, then everything is gone to the eye", () => {
	const opts = setup("marked", null);
	const fx = marked.create(opts.mesh, opts);
	const ms = fx.burst();
	assert.ok(ms > 0);
	const skull = opts.root.children[0];
	fx.update(ms / 2000);
	assert.ok(skull.material.opacity > 0 && skull.material.opacity < 1);
	fx.update(ms / 1000);
	assert.equal(skull.material.opacity, 0);
	assert.equal(opts.squareRoot.children[0].material.opacity, 0);
	fx.dispose();
});

test("hex: a level ring round the piece's middle and its turns left beside it; dispose takes both off and frees all", () => {
	const opts = setup("hexed", 2);
	const fx = hex.create(opts.mesh, opts);
	assert.equal(opts.root.children.length, 2);
	const [ring] = opts.root.children;
	assert.ok(near(ring.rotation.x, -Math.PI / 2), "level");
	assert.ok(near(ring.position.y, 0.83 / 2), "the middle");
	assert.equal(opts.squareRoot.children.length, 0);
	const { all, freed } = resources(opts);
	fx.dispose();
	assert.equal(opts.root.children.length, 0);
	assert.equal(freed.size, all.size);
});

test("hex: the turn and the pulse are pure in time, still under reduced motion", () => {
	const at = (t) => hex.hexLook(t, false);
	assert.deepEqual(at(0), { spin: 0, pulse: 0.75 });
	assert.ok(near(at(Math.PI / 4.8).pulse, 1)); // sin(2.4t) AT ITS TOP
	assert.ok(near(at(10).spin, 10 * hex.SPIN));
	assert.deepEqual(hex.hexLook(3, true), { spin: 0, pulse: 1 });
});

test("hex: the number follows left, none when the status is permanent", () => {
	drawn.length = 0;
	const opts = setup("hexed", 2);
	const fx = hex.create(opts.mesh, opts);
	const number = opts.root.children[1];
	assert.equal(drawn.at(-1), "2");
	assert.equal(number.visible, true);
	opts.left = 1;
	fx.update(0);
	assert.equal(drawn.at(-1), "1");
	opts.left = null;
	fx.update(0);
	assert.equal(number.visible, false);
	fx.dispose();

	drawn.length = 0;
	const still = setup("hexed", null);
	const fx2 = hex.create(still.mesh, still);
	assert.equal(drawn.length, 0, "a permanent hex prints no number");
	assert.equal(still.root.children[1].visible, false);
	fx2.dispose();
});

test("hex: update turns and pulses the ring, stands still under reduced motion, and the burst fades it out", () => {
	const opts = setup("hexed", 2);
	const fx = hex.create(opts.mesh, opts);
	const ring = opts.root.children[0];
	assert.equal(fx.animating(), true);
	fx.update(0.1);
	assert.ok(near(ring.rotation.z, 0.1 * hex.SPIN));
	opts.reduce = true;
	fx.update(0);
	assert.equal(fx.animating(), false);
	assert.equal(ring.rotation.z, 0);
	assert.equal(ring.material.opacity, 1);
	opts.reduce = false;
	const ms = fx.burst();
	assert.ok(ms > 0);
	fx.update(ms / 1000);
	assert.equal(ring.material.opacity, 0);
	assert.equal(opts.root.children[1].material.opacity, 0);
	fx.dispose();
});

// FIX ROUND 1 (task-21-S7-review.md I1, M1-M3; RULINGS 09:19 & R19)

test("09:19: with Shaken on the piece Marked's floating skull isn't drawn (Shaken's centre cage shows it), the square glow stays; it returns when Shaken ends", () => {
	const opts = setup("marked", null);
	opts.siblings = ["shaken"];
	const fx = marked.create(opts.mesh, opts);
	const skull = opts.root.children[0], glow = opts.squareRoot.children[0];
	assert.equal(skull.visible, false);
	assert.ok(glow.visible && glow.material.opacity > 0, "the glow stays");
	opts.siblings = ["hexed"];
	fx.update(0);
	assert.equal(skull.visible, true, "Shaken ended: the skull floats again");
	opts.siblings = ["shaken", "hexed"];
	fx.update(0);
	assert.equal(skull.visible, false);
	fx.dispose();
});

test("M1: Marked's skull fades with the piece's opacity", () => {
	const opts = setup("marked", null);
	const fx = marked.create(opts.mesh, opts);
	opts.mesh.userData.opacity = 0.5;
	fx.update(0);
	assert.ok(near(opts.root.children[0].material.opacity, 0.5));
	fx.dispose();
});

test("M1: Hex's ring and number fade with the piece's opacity", () => {
	const opts = setup("hexed", 2);
	const fx = hex.create(opts.mesh, opts);
	const [ring, number] = opts.root.children;
	opts.mesh.userData.opacity = 0.5;
	fx.update(0.3);
	assert.ok(near(ring.material.opacity, 0.5 * hex.hexLook(0.3, false).pulse));
	assert.ok(near(number.material.opacity, 0.5));
	fx.dispose();
});

test("M2: Hex's burst half way: the ring is part faded and wider than at rest", () => {
	const opts = setup("hexed", 2);
	const fx = hex.create(opts.mesh, opts);
	const ring = opts.root.children[0], base = ring.scale.x;
	const ms = fx.burst();
	fx.update(ms / 2000);
	const pulse = hex.hexLook(ms / 2000, false).pulse;
	assert.ok(ring.material.opacity > 0 && ring.material.opacity < pulse, `opacity ${ring.material.opacity}`);
	assert.ok(ring.scale.x > base, "it widens");
	fx.dispose();
});

test("M3: Hex's middle is half way up the box from its foot, wherever the foot sits", () => {
	const opts = setup("hexed", 2);
	opts.mesh.geometry.boundingBox.min.y = -0.1;
	const fx = hex.create(opts.mesh, opts);
	assert.ok(near(opts.root.children[0].position.y, (0.83 - 0.1) / 2));
	fx.dispose();
});

test("R19: Hex's turns left sit low at the front-right of the foot, clear of it", () => {
	const opts = setup("hexed", 2);
	opts.mesh.geometry.boundingBox.min.y = -0.1;
	const fx = hex.create(opts.mesh, opts);
	const [ring, number] = opts.root.children, box = opts.mesh.geometry.boundingBox;
	assert.ok(number.position.y > box.min.y && number.position.y < box.min.y + 0.25 * (box.max.y - box.min.y), `low: y ${number.position.y}`);
	assert.ok(number.position.y < ring.position.y);
	const right = (0.5 - number.center.x) * number.scale.x; // A SPRITE'S center SHIFTS IT ON SCREEN: (0.5 - center.x) * scale TO THE RIGHT
	assert.ok(right - number.scale.x / 2 > 0.2 * (box.max.x - box.min.x) && right < (box.max.x - box.min.x), `right of the foot: ${right}`);
	assert.ok(number.center.y >= 0.5, "not raised above its point");
	fx.dispose();
});
