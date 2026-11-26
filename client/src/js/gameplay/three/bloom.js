/*
 *  bloom.js  --  chess frontend
 *	3D Board
 *	Selective bloom (Task 24): only what's on BLOOM_LAYER glows (the status effects' cores, shells & bolts), never the room, board or pieces.
 *	A bloom composer draws that layer alone on black (depth-tested against the scene's depth, so what hides a glow hides its halo) & blurs it,
 *	a final composer draws the scene as usual & adds the blur on top.
 *	Built on the first frame that needs it, freed after IDLE_MS without glow; off (setBloom(false)) or nothing glowing draws straight with the renderer, at no extra cost
 *
 */

import { Color, Layers, ShaderMaterial, Vector2, WebGLRenderTarget, HalfFloatType } from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { Pass } from "three/examples/jsm/postprocessing/Pass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { BLOOM_LAYER } from "./constants.js";

const STRENGTH = 0.6; // MODEST: GOLD READS AS GLOWING IN THE DARK WARM ROOM, NOT WHITE
const RADIUS = 0.4;
const THRESHOLD = 0; // ONLY THE BLOOM LAYER IS IN THE BLUR'S PICTURE, SO ALL OF IT GLOWS
const SAMPLES = 4; // THE FINAL PICTURE KEEPS THE RENDERER'S ANTIALIASING (WebGL2 MSAA)
const IDLE_MS = 30000; // NOTHING HAS GLOWED THIS LONG: FREE THE COMPOSERS' TARGETS (A LATER GLOW REBUILDS THEM)

const BLACK = new Color(0);
const glowLayer = new Layers();
glowLayer.set(BLOOM_LAYER);
const size = new Vector2();
const oldClear = new Color();

let enabled = true;
let built = null; // { renderer, bloomComposer, finalComposer, passes, last: { w, h, pr } } ONCE A FRAME HAS BLOOMED
let glowedAt = 0; // Date.now() OF THE LAST BLOOMED FRAME

/**
 * @description Which way a frame is drawn: "bloom" only when bloom is on & something glows, else "plain"
 * @param  {[boolean]} on [setBloom's switch]
 * @param  {[boolean]} glow [hasGlow(scene)]
 * @return {[string]} ["bloom" or "plain"]
 */
export function route(on, glow) {
	return on && glow ? "bloom" : "plain";
}

/**
 * @description Whether a visible drawable (mesh, points, line or sprite) under object is on BLOOM_LAYER. A hidden parent hides its children. Allocates nothing
 * @param  {[Object3D]} object [the scene]
 * @return {[boolean]}
 */
export function hasGlow(object) {
	if (!object.visible) { return false; }
	if ((object.isMesh || object.isPoints || object.isLine || object.isSprite) && object.layers.test(glowLayer)) { return true; }
	const children = object.children;
	for (let i = 0; i < children.length; i++) {
		if (hasGlow(children[i])) { return true; }
	}
	return false;
}

/**
 * @description Whether the renderer's size or pixel ratio moved since the composers were last sized
 * @param  {[object|null]} last [{ w, h, pr } or null: never sized]
 * @return {[boolean]}
 */
export function sizeChanged(last, w, h, pr) {
	return !last || last.w !== w || last.h !== h || last.pr !== pr;
}

/**
 * @description Turns bloom on or off (statusFx/index.js's cheap switch). Off keeps any built composers for IDLE_MS, in case it comes back on
 * @param  {[boolean]} on
 */
export function setBloom(on) {
	enabled = Boolean(on);
}

/**
 * @description Draws one frame of view ({ renderer, scene, camera }), with bloom when it's on & something glows
 * @param  {[object]} view [three/index.js's view]
 */
export function renderFrame(view) {
	const { renderer, scene, camera } = view;
	if (route(enabled, enabled && hasGlow(scene)) === "plain") { // OFF: NO SCENE WALK EITHER
		if (built && Date.now() - glowedAt > IDLE_MS) { disposeBloom(); } // shortcut: ONLY CHECKED ON A DRAWN FRAME, SO AN IDLE BOARD (NO FRAMES) KEEPS THEM UNTIL ITS NEXT ONE
		renderer.render(scene, camera);
		return;
	}
	glowedAt = Date.now();
	if (built && built.renderer !== renderer) { disposeBloom(); } // A NEW mount(): THE OLD COMPOSERS BELONG TO A RENDERER THAT'S GONE
	if (!built) { built = build(renderer, scene, camera); }
	const { bloomComposer, finalComposer, passes } = built;
	passes.scene.scene = passes.glow.scene = scene; // THE SAME VIEW, BUT FOLLOW IT IF IT CHANGED
	passes.scene.camera = passes.glow.camera = camera;
	renderer.getSize(size);
	const pr = renderer.getPixelRatio();
	if (sizeChanged(built.last, size.x, size.y, pr)) { // camera/index.js resize() SETS THE RENDERER'S SIZE: FOLLOW IT HERE, NOT THERE
		bloomComposer.setPixelRatio(pr);
		finalComposer.setPixelRatio(pr);
		bloomComposer.setSize(size.x, size.y);
		finalComposer.setSize(size.x, size.y);
		built.last = { w: size.x, h: size.y, pr };
	}
	const info = renderer.info; // EVERY renderer.render RESETS ITS COUNTS: KEPT OVER THE WHOLE FRAME HERE, OR perf.js WOULD READ THE LAST PASS'S ONE TRIANGLE (T24 M2)
	info.autoReset = false;
	info.reset();
	try {
		bloomComposer.render(0);
		finalComposer.render(0);
	} finally { info.autoReset = true; }
}

// THE GLOW PASS, INTO THE BLOOM COMPOSER'S TARGET: FIRST THE SCENE'S DEPTH (THE CAMERA'S OWN LAYERS, COLOUR WRITES LOCKED OFF), THEN THE BLOOM LAYER
// ALONE ON BLACK, DEPTH-TESTED, SO A GLOW BEHIND A PIECE, A CARD OR ITS OWN PIECE STAYS HIDDEN IN THE BLUR AS IN THE SCENE. THE DEPTH DRAW USES EACH
// OBJECT'S OWN MATERIAL, NOT AN overrideMaterial: TRANSPARENT ONES (depthWrite: false: SHADOWS, SHELLS, MOTES) WRITE NO DEPTH, AS IN THE SCENE, & SPRITES,
// ALPHA-TESTED & SHADER-PATCHED PIECES KEEP THEIR SHAPES. ONLY THE GLOW DRAW DROPS THE FOG (IT WOULD TINT & BLOOM THE FAR GLOWS IN THE BAIZE COLOUR);
// THE DEPTH DRAW KEEPS IT, OR EVERY LIT MATERIAL WOULD RE-ACQUIRE ITS PROGRAM EACH FRAME
class GlowPass extends Pass {
	constructor(scene, camera) {
		super();
		this.scene = scene;
		this.camera = camera;
		this.needsSwap = false;
	}

	render(renderer, writeBuffer, readBuffer) {
		const { scene, camera } = this;
		const { background, fog } = scene;
		const mask = camera.layers.mask;
		const autoClear = renderer.autoClear;
		const color = renderer.state.buffers.color;
		renderer.getClearColor(oldClear);
		const oldAlpha = renderer.getClearAlpha();
		renderer.setRenderTarget(readBuffer);
		renderer.setClearColor(BLACK, 1);
		renderer.clear();
		renderer.autoClear = false;
		scene.background = null;
		try {
			color.setMask(false);
			color.setLocked(true);
			renderer.render(scene, camera);
			color.setLocked(false);
			color.setMask(true);
			scene.fog = null;
			camera.layers.set(BLOOM_LAYER);
			renderer.render(scene, camera);
		} finally {
			color.setLocked(false);
			color.setMask(true); // A THROW IN THE DEPTH DRAW MUST NOT LEAVE COLOUR WRITES OFF (RE-REVIEW N2)
			camera.layers.mask = mask;
			scene.background = background;
			scene.fog = fog;
			renderer.autoClear = autoClear;
			renderer.setClearColor(oldClear, oldAlpha);
		}
	}
}

// THE TWO COMPOSERS. THE FINAL ONE ENDS ON OutputPass, WHICH APPLIES THE RENDERER'S toneMapping & outputColorSpace AS A PLAIN render() DOES,
// SO THE SCENE'S COLOURS DON'T SHIFT WHEN BLOOM COMES ON
function build(renderer, scene, camera) {
	renderer.getSize(size);
	const pr = renderer.getPixelRatio();
	const glow = new GlowPass(scene, camera);
	const blur = new UnrealBloomPass(new Vector2(size.x, size.y), STRENGTH, RADIUS, THRESHOLD);
	const bloomComposer = new EffectComposer(renderer);
	bloomComposer.renderToScreen = false;
	bloomComposer.addPass(glow);
	bloomComposer.addPass(blur);
	const target = new WebGLRenderTarget(size.x * pr, size.y * pr, { type: HalfFloatType, samples: SAMPLES });
	const finalComposer = new EffectComposer(renderer, target);
	const scenePass = new RenderPass(scene, camera);
	const mix = new ShaderPass(new ShaderMaterial({
		uniforms: { baseTexture: { value: null }, bloomTexture: { value: blur.renderTargetsHorizontal[0].texture } }, // THE BLUR ALONE (UnrealBloomPass'S COMPOSITE): THE SHARP CORES ARE IN THE SCENE ALREADY
		vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
		fragmentShader: "uniform sampler2D baseTexture; uniform sampler2D bloomTexture; varying vec2 vUv; void main() { gl_FragColor = texture2D(baseTexture, vUv) + vec4(1.0) * texture2D(bloomTexture, vUv); }"
	}), "baseTexture");
	const output = new OutputPass();
	finalComposer.addPass(scenePass);
	finalComposer.addPass(mix);
	finalComposer.addPass(output);
	return { renderer, bloomComposer, finalComposer, passes: { glow, blur, scene: scenePass, mix, output }, last: null };
}

/**
 * @description Frees the composers' render targets & passes. Safe to call with nothing built. renderFrame also calls it when it meets a new renderer
 */
export function disposeBloom() {
	if (!built) { return; }
	const { bloomComposer, finalComposer, passes } = built;
	Object.values(passes).forEach((p) => p.dispose());
	bloomComposer.dispose();
	finalComposer.dispose();
	built = null;
}
