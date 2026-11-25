// SELECTIVE BLOOM (three/bloom.js, TASK 24 S1b) WITHOUT WebGL: THE PURE PARTS (WHICH ROUTE A FRAME TAKES, THE GLOW SEARCH, THE SIZE CHECK)
// & renderFrame'S PLAIN ROUTE WITH A FAKE RENDERER. THE COMPOSERS NEED A REAL GL CONTEXT, SO THE BLOOM ROUTE IS NOT DRAWN HERE
const { test } = require("node:test");
const assert = require("node:assert/strict");

global.window = { matchMedia: () => ({ matches: false, addEventListener() {} }) }; // constants.js READS IT AS IT LOADS
const { Group, Mesh, BoxGeometry, MeshBasicMaterial, Scene } = require("three");
const { BLOOM_LAYER } = require("../src/js/gameplay/three/constants.js");
const bloom = require("../src/js/gameplay/three/bloom.js");

const glowing = () => { const m = new Mesh(new BoxGeometry(), new MeshBasicMaterial()); m.layers.enable(BLOOM_LAYER); return m; };

test("route: plain when bloom is off or nothing glows, bloom only when both", () => {
	assert.equal(bloom.route(false, false), "plain");
	assert.equal(bloom.route(false, true), "plain");
	assert.equal(bloom.route(true, false), "plain");
	assert.equal(bloom.route(true, true), "bloom");
});

test("hasGlow: finds a visible mesh on the bloom layer, deep in the tree", () => {
	const scene = new Scene();
	const group = new Group();
	scene.add(group, new Mesh(new BoxGeometry(), new MeshBasicMaterial()));
	assert.equal(bloom.hasGlow(scene), false);
	const g = glowing();
	group.add(new Group().add(g));
	assert.equal(bloom.hasGlow(scene), true);
});

test("hasGlow: a hidden glow, or a hidden parent, does not count; a group on the layer alone does not either", () => {
	const scene = new Scene();
	const g = glowing();
	g.visible = false;
	scene.add(g);
	assert.equal(bloom.hasGlow(scene), false);
	g.visible = true;
	const parent = new Group();
	parent.visible = false;
	scene.remove(g);
	parent.add(g);
	scene.add(parent);
	assert.equal(bloom.hasGlow(scene), false);
	const empty = new Group();
	empty.layers.enable(BLOOM_LAYER);
	scene.add(empty);
	assert.equal(bloom.hasGlow(scene), false);
});

test("sizeChanged: only when width, height or pixel ratio differ", () => {
	const last = { w: 800, h: 600, pr: 2 };
	assert.equal(bloom.sizeChanged(last, 800, 600, 2), false);
	assert.equal(bloom.sizeChanged(last, 801, 600, 2), true);
	assert.equal(bloom.sizeChanged(last, 800, 599, 2), true);
	assert.equal(bloom.sizeChanged(last, 800, 600, 1.5), true);
	assert.equal(bloom.sizeChanged(null, 800, 600, 2), true);
});

// A RENDERER THAT ONLY COUNTS ITS DRAWS: THE PLAIN ROUTE NEVER BUILDS A COMPOSER (ONE WOULD THROW ON THIS FAKE)
function fakeView(scene) {
	const calls = [];
	return { calls, view: { scene, camera: {}, renderer: { render: (s, c) => calls.push([s, c]) } } };
}

test("renderFrame: bloom off draws straight with the renderer, even with glow on screen", () => {
	const scene = new Scene();
	scene.add(glowing());
	const { calls, view } = fakeView(scene);
	bloom.setBloom(false);
	bloom.renderFrame(view);
	assert.equal(calls.length, 1);
	assert.equal(calls[0][0], scene);
	assert.equal(calls[0][1], view.camera);
	bloom.setBloom(true);
});

test("renderFrame: bloom on with nothing glowing draws straight too (no composer cost)", () => {
	const scene = new Scene();
	scene.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()));
	const { calls, view } = fakeView(scene);
	bloom.setBloom(true);
	bloom.renderFrame(view);
	assert.equal(calls.length, 1);
});

test("disposeBloom with nothing built is safe", () => {
	bloom.disposeBloom();
	bloom.disposeBloom();
});

// THE BLOOM ROUTE ON A FAKE RENDERER: THE REAL COMPOSERS & PASSES RUN (THEY ONLY NEED A RENDERER'S METHODS UNTIL A REAL DRAW), EACH DRAW IS LOGGED
// WITH ITS MATERIAL (A FULL-SCREEN QUAD SWAPS ITS MESH'S), THE TARGET IT WENT TO, THE CAMERA'S LAYERS, THE COLOUR MASK & THE SCENE'S BACKGROUND/FOG AT THAT MOMENT
const { Color, Fog, PerspectiveCamera, SRGBColorSpace, NoToneMapping } = require("three");
const { mock } = require("node:test");

function fakeRenderer() {
	const log = [];
	const noop = () => {};
	const any = new Proxy({}, { get: () => noop });
	const color = { mask: true, locked: false, setMask(m) { if (!this.locked) { this.mask = m; } }, setLocked(l) { this.locked = l; }, setClear: noop, reset: noop };
	let target = null;
	const renderer = {
		log, autoClear: true, info: { autoReset: true, resets: 0, reset() { this.resets++; } }, outputColorSpace: SRGBColorSpace, toneMapping: NoToneMapping, toneMappingExposure: 1,
		state: { buffers: { color, depth: any, stencil: any } },
		getSize: (v) => v.set(800, 600), getPixelRatio: () => 1,
		getClearColor: (c) => c.set(0), getClearAlpha: () => 1, setClearColor: noop, setClearAlpha: noop,
		getRenderTarget: () => target, setRenderTarget: (t) => { target = t; }, clear: noop,
		render: (scene, camera) => log.push({ scene, material: scene.material, target, autoReset: renderer.info.autoReset, mask: camera.layers.mask, colorMask: color.mask, background: scene.background, fog: scene.fog })
	};
	return new Proxy(renderer, { get: (o, k) => (k in o ? o[k] : noop) });
}

function bloomView() {
	const scene = new Scene();
	scene.background = new Color(0x123456);
	scene.fog = new Fog(0x123456, 50, 150);
	scene.add(glowing(), new Mesh(new BoxGeometry(), new MeshBasicMaterial()));
	const camera = new PerspectiveCamera();
	return { scene, camera, renderer: fakeRenderer() };
}

const mixDraw = (log) => log.find((d) => d.material && d.material.uniforms && "bloomTexture" in d.material.uniforms);

test("bloom route: the scene's depth first (own layers, colour off, fog kept), then the glow alone on black with no fog, then the scene as usual; all restored", () => {
	bloom.disposeBloom();
	bloom.setBloom(true);
	const view = bloomView();
	const { scene, camera, renderer } = view;
	const { background, fog } = scene;
	bloom.renderFrame(view);
	const draws = renderer.log.filter((d) => d.scene === scene);
	assert.equal(draws.length, 3);
	const [depth, glow, final] = draws;
	assert.deepEqual([depth.mask, depth.colorMask, depth.background, depth.fog], [1, false, null, fog]);
	assert.deepEqual([glow.mask, glow.colorMask, glow.background, glow.fog], [1 << BLOOM_LAYER, true, null, null]);
	assert.equal(glow.target, depth.target); // THE GLOW IS DEPTH-TESTED AGAINST THE SCENE'S DEPTH IN THE SAME TARGET
	assert.deepEqual([final.mask, final.colorMask, final.background, final.fog], [1, true, background, fog]);
	assert.equal(camera.layers.mask, 1);
	assert.equal(scene.background, background);
	assert.equal(scene.fog, fog);
	assert.equal(renderer.state.buffers.color.locked, false);
	assert.equal(renderer.autoClear, true);
	assert.deepEqual([renderer.log.every((d) => d.autoReset === false), renderer.info.resets, renderer.info.autoReset], [true, 1, true]); // T24 M2: THE DRAW COUNTS RUN OVER THE WHOLE FRAME (perf.js READS THEM), RESET ONCE AT ITS START
	bloom.disposeBloom();
});

test("bloom route: the mix adds only the blur (the cores are already in the scene), not the sharp glow picture", () => {
	bloom.disposeBloom();
	const view = bloomView();
	bloom.renderFrame(view);
	const composite = view.renderer.log.find((d) => d.material && d.material.uniforms && "bloomStrength" in d.material.uniforms);
	const mix = mixDraw(view.renderer.log);
	assert.ok(composite && mix);
	assert.equal(mix.material.uniforms.bloomTexture.value, composite.target.texture);
	bloom.disposeBloom();
});

test("bloom route: a new renderer frees the old composers", () => {
	bloom.disposeBloom();
	const a = bloomView();
	bloom.renderFrame(a);
	let freed = 0;
	mixDraw(a.renderer.log).material.addEventListener("dispose", () => freed++);
	bloom.renderFrame(a);
	assert.equal(freed, 0);
	bloom.renderFrame(bloomView());
	assert.equal(freed, 1);
	bloom.disposeBloom();
});

test("bloom route: the composers are freed once nothing has glowed for a while, kept before that", () => {
	bloom.disposeBloom();
	mock.timers.enable({ apis: ["Date"], now: 1000 });
	try {
		const view = bloomView();
		bloom.renderFrame(view);
		let freed = 0;
		mixDraw(view.renderer.log).material.addEventListener("dispose", () => freed++);
		view.scene.children[0].visible = false; // THE GLOW ENDS
		mock.timers.tick(1000);
		bloom.renderFrame(view);
		assert.equal(freed, 0);
		mock.timers.tick(60000);
		bloom.renderFrame(view);
		assert.equal(freed, 1);
	} finally {
		mock.timers.reset();
		bloom.disposeBloom();
	}
});
