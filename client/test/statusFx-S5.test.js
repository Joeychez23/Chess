// THE WARDED & FROZEN EFFECTS (three/statusFx/warded.js, frozen.js, TASK 21 S5) ON A PLAIN three Object3D PIECE: WHAT THEY ADD & FREE, THEIR PULSE, MOTES, MIST & SHARD FALL
// AS PURE FUNCTIONS OF TIME, & THE STILL LOOK UNDER REDUCED MOTION. NO WebGL: NOTHING IS DRAWN
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Group, Mesh, CylinderGeometry, MeshBasicMaterial, MathUtils } = require("three");
global.window ??= { matchMedia: () => ({ matches: false, addEventListener() {} }) }; // constants.js READS IT AS IT LOADS
const { FOV } = require("../src/js/gameplay/three/constants.js");
const warded = require("../src/js/gameplay/three/statusFx/warded.js");
const frozen = require("../src/js/gameplay/three/statusFx/frozen.js");

// A PIECE LIKE createPiece()'S: FOOT AT y 0, A BOUNDING BOX, NARROWER AT THE TOP (A PAWN'S NECK)
function piece(top = 0.83, rTop = 0.12, rFoot = 0.34) {
	const g = new CylinderGeometry(rTop, rFoot, top, 12, 8);
	g.translate(0, top / 2, 0);
	g.computeBoundingBox();
	const mesh = new Mesh(g, new MeshBasicMaterial());
	mesh.userData.opacity = 1;
	return mesh;
}

// opts AS statusFx/index.js make() GIVES IT: root A CHILD OF THE MESH, squareRoot APART
function setup(s, extra = {}) {
	const mesh = piece();
	const root = new Group(), squareRoot = new Group();
	mesh.add(root);
	const opts = { s, id: "p1", left: 2, by: "w", square: "e4", mode: "effects", slot: 0, slots: 1, mesh, root, squareRoot, reduce: false, ...extra };
	return { mesh, opts };
}

// EVERY GEOMETRY, MATERIAL & TEXTURE UNDER A ROOT (BUT THE PIECE'S OWN, SHARED GEOMETRY), EACH dispose() COUNTED
function watch(root, shared) {
	const made = new Set();
	root.traverse((o) => {
		if (o.geometry && o.geometry !== shared) { made.add(o.geometry); }
		[].concat(o.material || []).forEach((m) => { made.add(m); if (m.map) { made.add(m.map); } });
	});
	const freed = new Set();
	for (const r of made) { const d = r.dispose.bind(r); r.dispose = () => { freed.add(r); d(); }; }
	return { made, freed };
}

for (const [name, mod] of [["warded", warded], ["frozen", frozen]]) {
	test(`${name}: create adds its objects to opts.root, dispose takes them off & frees every geometry & material`, () => {
		const { opts } = setup(name);
		const fx = mod.create(opts.mesh, opts);
		assert.ok(opts.root.children.length > 0);
		assert.equal(opts.squareRoot.children.length, 0);
		const { made, freed } = watch(opts.root, opts.mesh.geometry);
		assert.ok(made.size > 0);
		let sharedFreed = false;
		opts.mesh.geometry.dispose = () => { sharedFreed = true; };
		fx.dispose();
		assert.equal(opts.root.children.length, 0);
		assert.equal(freed.size, made.size);
		assert.equal(sharedFreed, false, "the piece's geometry is shared: never freed here");
	});

	test(`${name}: a see-through layer in the piece's own shape over it, refit to a new mesh on update(0)`, () => {
		const { opts } = setup(name);
		const fx = mod.create(opts.mesh, opts);
		const layer = opts.root.children.find((o) => o.geometry === opts.mesh.geometry);
		assert.ok(layer, "a child drawing the piece's own geometry");
		assert.equal(layer.material.transparent, true);
		assert.equal(layer.material.depthWrite, false);
		assert.ok(layer.material.opacity > 0 && layer.material.opacity < 1);
		const next = piece(1.2, 0.2, 0.4);
		next.add(opts.root);
		opts.mesh = next;
		fx.update(0);
		assert.equal(layer.geometry, next.geometry, "follows the new mesh");
		fx.dispose();
	});

	test(`${name}: no ring at the foot (Task 22's rings sit there), no bubble & no wireframe`, () => {
		const { opts } = setup(name);
		const fx = mod.create(opts.mesh, opts);
		opts.root.traverse((o) => {
			if (o.geometry) { assert.ok(!["RingGeometry", "IcosahedronGeometry", "SphereGeometry"].includes(o.geometry.type) || o.name === "wardedAura", `${o.name}: ${o.geometry.type}`); }
			if (o.material) { assert.notEqual(o.material.wireframe, true, o.name); }
		});
		fx.dispose();
	});

	test(`${name}: animating only while it moves, still & not animating under opts.reduce (update(0) follows a change to it)`, () => {
		const { opts } = setup(name);
		const fx = mod.create(opts.mesh, opts);
		assert.equal(fx.animating(), name === "warded", "Warded pulses; Frozen is still until its burst");
		opts.reduce = true;
		fx.update(0);
		assert.equal(fx.animating(), false);
		const before = JSON.stringify(opts.root.toJSON());
		fx.update(0.1); fx.update(0.1);
		assert.equal(JSON.stringify(opts.root.toJSON()), before, "no motion under reduce");
		fx.dispose();
	});

	test(`${name}: no count-driven parts, so left 3 & left null (permanent) draw the same objects`, () => {
		const a = setup(name, { left: 3 }), b = setup(name, { left: null });
		const fa = mod.create(a.mesh, a.opts), fb = mod.create(b.mesh, b.opts);
		let na = 0, nb = 0;
		a.opts.root.traverse(() => na++); b.opts.root.traverse(() => nb++);
		assert.equal(na, nb);
		fa.dispose(); fb.dispose();
	});

	test(`${name}: fades with the piece (opts.mesh.userData.opacity)`, () => {
		const { opts } = setup(name);
		const fx = mod.create(opts.mesh, opts);
		const mats = [];
		opts.root.traverse((o) => { if (o.material) { mats.push(o.material); } });
		const full = mats.map((m) => m.opacity);
		opts.mesh.userData.opacity = 0.5;
		fx.update(0);
		mats.forEach((m, i) => assert.ok(Math.abs(m.opacity - full[i] * 0.5) < 1e-9, `material ${i}`));
		fx.dispose();
	});
}

test("warded: pulse goes 0 at t 0, 1 at half a period, 0 again at a period", () => {
	assert.equal(warded.pulse(0), 0);
	assert.ok(Math.abs(warded.pulse(warded.PULSE_S / 2) - 1) < 1e-9);
	assert.ok(Math.abs(warded.pulse(warded.PULSE_S)) < 1e-9);
});

test("warded: a mote rises from the foot (0) to the top (1) over its rise, fading in & out, & loops", () => {
	assert.deepEqual(warded.mote(0, 0, 4), { h: 0, a: 0 });
	const mid = warded.mote(warded.RISE_S / 2, 0, 4);
	assert.ok(Math.abs(mid.h - 0.5) < 1e-9 && Math.abs(mid.a - 1) < 1e-9);
	assert.ok(Math.abs(warded.mote(warded.RISE_S, 0, 4).h) < 1e-9, "loops back to the foot");
	assert.ok(Math.abs(warded.mote(0, 2, 4).h - 0.5) < 1e-9, "motes are spread through the rise");
});

test("warded: the aura fits the piece's size, & refits to a new mesh on update(0)", () => {
	const { opts } = setup("warded");
	const fx = warded.create(opts.mesh, opts);
	const aura = opts.root.getObjectByName("wardedAura");
	assert.ok(Math.abs(aura.position.y - 0.83 / 2) < 1e-6); // GEOMETRY IS FLOAT32
	const next = piece(1.2, 0.2, 0.4);
	next.add(opts.root);
	opts.mesh = next;
	fx.update(0);
	assert.ok(Math.abs(aura.position.y - 0.6) < 1e-6);
	assert.ok(Math.abs(aura.scale.x - 0.4 * 1.35) < 1e-6);
	fx.dispose();
});

test("warded: with reduce off it moves, & a mote climbs between two updates", () => {
	const { opts } = setup("warded");
	const fx = warded.create(opts.mesh, opts);
	const pos = opts.root.getObjectByName("wardedMotes").geometry.attributes.position;
	const before = JSON.stringify(opts.root.toJSON()), y0 = pos.getY(0);
	fx.update(0.1);
	assert.notEqual(JSON.stringify(opts.root.toJSON()), before);
	assert.ok(pos.getY(0) > y0, "mote 0 rises");
	fx.dispose();
});

test("warded: motes are round (a soft dot map, clear at the corner) & drawn at MOTE_SIZE piece units across", () => {
	const { opts } = setup("warded");
	opts.mesh.scale.setScalar(0.5);
	const fx = warded.create(opts.mesh, opts);
	const m = opts.root.getObjectByName("wardedMotes").material;
	assert.ok(m.map, "a round map, not a square");
	const { data, width } = m.map.image;
	assert.equal(data[3], 0, "the corner is clear");
	assert.ok(data[((width / 2) * width + width / 2) * 4 + 3] > 200, "the middle is solid");
	// WITH sizeAttenuation A POINT LOOKS tan(fov/2) TIMES ITS size IN WORLD UNITS
	assert.ok(Math.abs(m.size - (warded.MOTE_SIZE * 0.5) / Math.tan(MathUtils.degToRad(FOV / 2))) < 1e-9);
	fx.dispose();
});

test("frozen: still outside its burst, even with reduce off", () => {
	const { opts } = setup("frozen");
	const fx = frozen.create(opts.mesh, opts);
	assert.equal(fx.animating(), false);
	const before = JSON.stringify(opts.root.toJSON());
	fx.update(0.1); fx.update(0.1); fx.update(0.1);
	assert.equal(JSON.stringify(opts.root.toJSON()), before, "the mist is a still haze");
	fx.burst();
	assert.equal(fx.animating(), true);
	fx.dispose();
});

test("frozen: the burst cracks first (split & jolt, nothing falls), then falls & fades, BURST_MS in all", () => {
	assert.equal(frozen.BURST_MS, 700);
	assert.equal(frozen.CRACK_MS, 150);
	const at = (ms) => frozen.fall(ms / 1000);
	assert.deepEqual(at(0), { drop: 0, out: 0, jolt: 0, a: 1 });
	const crack = at(frozen.CRACK_MS / 2);
	assert.equal(crack.drop, 0);
	assert.equal(crack.a, 1);
	assert.ok(crack.out > 0, "split");
	assert.ok(Math.abs(crack.jolt) > 0.05, "jolt");
	assert.equal(at(frozen.CRACK_MS).drop, 0, "nothing falls until the crack is done");
	const mid = at((frozen.CRACK_MS + frozen.BURST_MS) / 2);
	assert.ok(mid.drop > 0 && mid.drop < 1 && mid.a > 0 && mid.a < 1 && mid.jolt === 0);
	assert.deepEqual(at(frozen.BURST_MS), { drop: 1, out: 1, jolt: 0, a: 0 });
	assert.deepEqual(at(99000), { drop: 1, out: 1, jolt: 0, a: 0 });
});

test("frozen: radiusAt is the piece's width at a height, so a neck is narrower than the foot", () => {
	const pos = piece().geometry.attributes.position;
	const foot = frozen.radiusAt(pos, 0.1, 0.12), neck = frozen.radiusAt(pos, 0.6, 0.12);
	assert.ok(neck < foot);
	assert.ok(neck < 0.25 && neck > 0.14, `neck ${neck}`);
});

test("frozen: shards sit on the piece's sides at their height, not out at the foot's width", () => {
	const { opts } = setup("frozen");
	const fx = frozen.create(opts.mesh, opts);
	const shards = opts.root.getObjectByName("frozenShards").children;
	for (const s of shards) {
		const r = Math.hypot(s.position.x, s.position.z), side = 0.34 - (0.34 - 0.12) * (s.position.y / 0.83);
		assert.ok(r < side * 1.25 && r > side * 0.8, `shard at y ${s.position.y.toFixed(2)}: r ${r.toFixed(3)} vs side ${side.toFixed(3)}`);
	}
	fx.dispose();
});

test("frozen: rime specks are round points on the piece", () => {
	const { opts } = setup("frozen");
	const fx = frozen.create(opts.mesh, opts);
	const rime = opts.root.getObjectByName("frozenRime");
	assert.equal(rime.type, "Points");
	assert.ok(rime.material.map);
	const p = rime.geometry.attributes.position;
	for (let i = 0; i < p.count; i++) {
		const y = p.getY(i), side = 0.34 - (0.34 - 0.12) * (y / 0.83), r = Math.hypot(p.getX(i), p.getZ(i));
		assert.ok(y >= 0 && y <= 0.84 && r <= side * 1.1 + 1e-6, `speck ${i} off the piece`);
	}
	fx.dispose();
});

test("frozen: burst returns its ms & the shards drop & fade on update; 0 under reduce", () => {
	const { opts } = setup("frozen");
	const fx = frozen.create(opts.mesh, opts);
	const shards = opts.root.getObjectByName("frozenShards");
	const y0 = shards.children.map((c) => c.position.y);
	assert.equal(fx.burst(), frozen.BURST_MS);
	assert.equal(fx.animating(), true);
	fx.update(frozen.BURST_MS / 2000);
	shards.children.forEach((c, i) => assert.ok(c.position.y < y0[i]));
	fx.update(0.1); fx.update(0.1); fx.update(0.1); fx.update(0.1); fx.update(0.1);
	assert.equal(shards.children[0].material.opacity, 0);
	fx.dispose();
	const r = setup("frozen", { reduce: true });
	assert.equal(frozen.create(r.mesh, r.opts).burst(), 0);
});

test("warded: burst plays nothing (the plan gives Warded no ending)", () => {
	const { opts } = setup("warded");
	assert.equal(warded.create(opts.mesh, opts).burst(), 0);
});
