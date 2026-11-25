// THE TRAPDOOR'S BEAR TRAP (three/statusFx/trapdoor.js, TASK 22 S2) WITHOUT WebGL: A SQUARE IS A PLAIN three Group, dispose's FREEING IS COUNTED THROUGH three's "dispose" EVENTS.
// THE MODULE DOESN'T IMPORT three/index.js, SO THE threeStub RESOLVE HOOK ISN'T NEEDED HERE
const { test } = require("node:test");
const assert = require("node:assert/strict");

global.window = { matchMedia: () => ({ matches: false, addEventListener() {} }) }; // constants.js READS IT AS IT LOADS
const { Group } = require("three");
const { PIECE_SIZE } = require("../src/js/gameplay/three/constants.js");
const trapdoor = require("../src/js/gameplay/three/statusFx/trapdoor.js");

const setup = (more = {}) => ({ s: "trapdoor", square: "e4", mode: "effects", root: new Group(), squareRoot: new Group(), reduce: false, ...more });

// EVERY GEOMETRY & MATERIAL UNDER THE SQUARE, EACH MARKED WHEN ITS dispose() RUNS
function resources(root) {
	const all = new Set();
	root.traverse((o) => { if (o.geometry) { all.add(o.geometry); } if (o.material) { all.add(o.material); } });
	const freed = new Set();
	all.forEach((r) => r.addEventListener("dispose", () => freed.add(r)));
	return { all, freed };
}
const meshes = (root) => { const list = []; root.traverse((o) => { if (o.isMesh) { list.push(o); } }); return list; };
const shown = (root) => { const list = []; root.traverseVisible((o) => { if (o.isMesh) { list.push(o); } }); return list; };

test("create puts the trap on the square (squareRoot) only, cheap; dispose takes it off & frees every geometry & material", () => {
	const opts = setup();
	const fx = trapdoor.create(null, opts);
	assert.equal(opts.root.children.length, 0);
	assert.ok(opts.squareRoot.children.length > 0);
	assert.ok(shown(opts.squareRoot).length > 0, "the open trap shows");
	const triangles = meshes(opts.squareRoot).reduce((n, m) => n + (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3, 0);
	assert.ok(triangles < 600, `${triangles} triangles`);
	const { all, freed } = resources(opts.squareRoot);
	assert.ok(all.size >= 4);
	fx.dispose();
	assert.equal(opts.squareRoot.children.length, 0);
	assert.equal(freed.size, all.size);
});

test("the open trap is half-transparent & still", () => {
	const opts = setup();
	const fx = trapdoor.create(null, opts);
	fx.update(0.1);
	meshes(opts.squareRoot).forEach((m) => assert.equal(m.material.opacity, trapdoor.OPEN_OPACITY));
	assert.equal(fx.animating(), false);
	fx.dispose();
});

test("sprung: nothing shows before the burst; the burst's first frame has the jaws open", () => {
	const opts = setup({ sprung: true });
	const fx = trapdoor.create(null, opts);
	assert.equal(shown(opts.squareRoot).length, 0);
	assert.equal(fx.burst(), trapdoor.BURST_MS);
	fx.update(0);
	assert.ok(shown(opts.squareRoot).length > 0);
	assert.equal(fx.animating(), true);
	fx.dispose();
});

test("trapLook: open at 0, shut by the snap (under 150 ms), faded out at the end", () => {
	assert.deepEqual(trapdoor.trapLook(null), { angle: 0, opacity: trapdoor.OPEN_OPACITY });
	assert.equal(trapdoor.trapLook(0).angle, 0);
	assert.ok(trapdoor.SNAP_MS < 150);
	assert.ok(trapdoor.trapLook(trapdoor.SNAP_MS / 2).angle > 0);
	assert.ok(trapdoor.trapLook(trapdoor.SNAP_MS / 2).angle < trapdoor.SHUT);
	assert.equal(trapdoor.trapLook(trapdoor.SNAP_MS).angle, trapdoor.SHUT);
	assert.equal(trapdoor.trapLook(trapdoor.SNAP_MS).opacity, 1, "both players see the snap");
	assert.ok(trapdoor.trapLook(trapdoor.BURST_MS - 150).opacity > 0);
	assert.equal(trapdoor.trapLook(trapdoor.BURST_MS - 100).opacity, 0, "faded a little before the frame frees it (a frame hitch can't cut it off visible)");
	assert.equal(trapdoor.trapLook(trapdoor.BURST_MS).opacity, 0);
	assert.equal(trapdoor.trapLook(trapdoor.BURST_MS + 500).opacity, 0);
	assert.ok(Math.abs(trapdoor.BURST_MS - 1000) <= 200);
});

test("the shut jaws swing up & close around a piece's foot, not through it (the .glb king: 0.42 piece units wide at the tooth tips' height)", () => {
	assert.ok(trapdoor.JAW < PIECE_SIZE / 0.8 / 2, "the open trap stays on its square");
	const opts = setup();
	const fx = trapdoor.create(null, opts);
	const teeth = meshes(opts.squareRoot).filter((m) => m.geometry.type === "ConeGeometry");
	const at = () => teeth.map((m) => { opts.squareRoot.updateMatrixWorld(true); return m.getWorldPosition(new (require("three").Vector3)()); });
	const open = at();
	fx.burst();
	fx.update(trapdoor.SNAP_MS / 1000);
	at().forEach((p, i) => {
		assert.ok(p.y > open[i].y, `tooth ${i} rises as it shuts`);
		assert.ok(Math.hypot(p.x, p.z) >= 0.42 * PIECE_SIZE, `tooth ${i} stays outside the king's foot: ${Math.hypot(p.x, p.z)}`);
	});
	fx.dispose();
});

test("the trap lies over the board's marks: the grid, Marked's glow & every tile highlight (0.02 + i * 0.002, up to 0.034)", () => {
	const opts = setup();
	const fx = trapdoor.create(null, opts);
	assert.ok(opts.squareRoot.children[0].position.y > 0.034);
	fx.dispose();
});

test("the burst snaps the jaws & fades the trap through update, then stops animating", () => {
	const opts = setup();
	const fx = trapdoor.create(null, opts);
	fx.burst();
	fx.update(trapdoor.SNAP_MS / 1000);
	meshes(opts.squareRoot).forEach((m) => assert.equal(m.material.opacity, 1));
	assert.equal(fx.animating(), true);
	for (let i = 0; i < 20; i++) { fx.update(0.1); }
	assert.equal(fx.animating(), false);
	assert.equal(shown(opts.squareRoot).length, 0);
	fx.dispose();
});

test("under reduced motion the burst is 0 ms & nothing animates", () => {
	const opts = setup({ reduce: true });
	const fx = trapdoor.create(null, opts);
	assert.equal(fx.burst(), 0);
	assert.equal(fx.animating(), false);
	fx.dispose();
});
