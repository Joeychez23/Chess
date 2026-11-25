// Status effect: Warded (can't be captured). A radiant aura: a white-gold glow around the piece pulsing gently, a see-through golden sheen in the piece's own shape over it & gold motes rising up it.
// All in opts.root (piece units), so it follows the lift, the drag & the drop. Still under reduced motion; no count (the badge shows the turns left)
// T24: LAYERED — A BRIGHT CORE SHELL (THE PIECE'S SHAPE, A HAIR BIGGER, FRESNEL RIM + A SHIMMER BAND SWEEPING UP, ON BLOOM_LAYER UNLESS opts.cheap), THE WIDE SOFT HALO & A METALLIC GOLD SHEEN OVERLAY
// T24 JOIN: THE MOTES (wardedMotes.js), THE GAIN/LOSE FLARE (wardedFlare.js) & THE WARM LIGHT ON THE SQUARE (wardLight.js), ALL ON warded's RUNNING CLOCK t
import { SphereGeometry, ShaderMaterial, Mesh, DataTexture, MathUtils, LinearFilter, AdditiveBlending, BackSide, Color } from "three";
import { FOV, SMALL_FOV, SMALL_SCREEN, BLOOM_LAYER } from "../constants.js";
import * as wardedMotes from "./wardedMotes.js";
import * as wardedFlare from "./wardedFlare.js";
import * as wardLight from "./wardLight.js";

export const PULSE_S = 2.4; // ONE GENTLE PULSE, SECONDS
export const RISE_S = 2.8; // A MOTE'S CLIMB FROM THE FOOT TO OVER THE TOP, SECONDS
export const BAND_S = 3.2; // ONE SHIMMER SWEEP UP THE PIECE (WITH A GAP BEFORE THE NEXT), SECONDS
export const MOTE_SIZE = 0.06; // PIECE UNITS ACROSS
const SHELL = [1.06, 1.03, 1.06]; // THE CORE SHELL'S SCALE: JUST OFF THE PIECE'S SURFACE, NO CRACKS AT HARD EDGES (A SCALE, NOT A PUSH ALONG NORMALS)

export { FLARE_MS as FADE_MS } from "./wardedFlare.js"; // THE BODY'S FADE ONCE THE WARD BREAKS (burst): AS LONG AS THE LOSE FLARE. A RE-EXPORT, NOT A const: wardedFlare.js IMPORTS THIS FILE
const MARGIN_MS = 100; // burst'S EXTRA: index.js FREES THE ENDING ON WALL TIME WHILE dt IS CAPPED, SO A SLOW FRAME DOESN'T CUT THE FLARE SHORT
// ONE SOURCE FOR EVERY WARDED PIECE, SO three COMPILES ONE PROGRAM PER LAYER. EACH FRAGMENT ENDS ON THE COLOUR SPACE CHUNK (AS fire.js): A ShaderMaterial GETS NO sRGB
// CONVERSION WITHOUT IT, SO WITH BLOOM OFF THE GOLD WOULD DRAW DARKER THAN WITH IT ON (INTO bloom.js'S LINEAR TARGET THE CHUNK IS A NO-OP & OutputPass CONVERTS ONCE). VIEW SPACE NORMAL & VIEW DIRECTION, HEIGHT AS A FRACTION OF THE PIECE
const VERT = `uniform float uTop;
varying vec3 vN; varying vec3 vV; varying float vH;
void main() {
	vec4 mv = modelViewMatrix * vec4(position, 1.0);
	vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vH = position.y / uTop;
	gl_Position = projectionMatrix * mv;
}`;
// THE CORE: BRIGHT AT THE SILHOUETTE (FRESNEL) PLUS THE BAND, SO IT HUGS THE PIECE'S OUTLINE
const SHELL_FRAG = `uniform vec3 uGold; uniform float uOpacity; uniform float uBand;
varying vec3 vN; varying vec3 vV; varying float vH;
void main() {
	float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
	float band = 1.0 - smoothstep(0.0, 0.12, abs(vH - uBand));
	gl_FragColor = vec4(uGold * (f * f + 0.6 * band * (0.3 + f)), uOpacity);
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`;
// THE HALO: A BACK-FACED SPHERE, BRIGHT IN THE MIDDLE & FADING TO NOTHING AT ITS EDGE, SO NO HARD RIM
const AURA_FRAG = `uniform vec3 uGold; uniform float uOpacity;
varying vec3 vN; varying vec3 vV; varying float vH;
void main() {
	float c = abs(dot(normalize(vN), normalize(vV)));
	gl_FragColor = vec4(uGold * c * c, uOpacity);
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`;
// THE SHEEN: METAL READS AS DARK FACING YOU, BRIGHT AT GRAZING ANGLES, WITH A HARD HIGHLIGHT FROM A FIXED KEY LIGHT (NO REAL LIGHT)
const SHEEN_FRAG = `uniform vec3 uGold; uniform float uOpacity;
varying vec3 vN; varying vec3 vV; varying float vH;
void main() {
	vec3 N = normalize(vN), V = normalize(vV);
	float f = 1.0 - max(dot(N, V), 0.0);
	float spec = pow(max(dot(reflect(-V, N), normalize(vec3(-0.4, 0.8, 0.45))), 0.0), 18.0);
	gl_FragColor = vec4(uGold * (0.3 + 0.7 * f * f) + vec3(1.0, 0.93, 0.72) * spec, uOpacity);
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`;
const layer = (frag, color, extra = {}) => new ShaderMaterial({
	vertexShader: VERT, fragmentShader: frag, transparent: true, blending: AdditiveBlending, depthWrite: false, ...extra,
	uniforms: { uGold: { value: new Color(color) }, uOpacity: { value: 1 }, uBand: { value: 0 }, uTop: { value: 1 } },
});
// WITH sizeAttenuation A POINT LOOKS tan(fov/2) TIMES ITS size IN WORLD UNITS (points.glsl.js), SO DIVIDE IT OUT
const tanHalf = () => Math.tan(MathUtils.degToRad((SMALL_SCREEN.matches ? SMALL_FOV : FOV) / 2)); // THE CAMERA'S LENS: A SMALL SCREEN USES THE LONGER ONE

/**
 * @description A point's size so it draws units piece units across on this mesh
 * @param  {[number]} units [piece units]
 * @param  {[Mesh]} mesh [the piece: its scale is world units per piece unit]
 * @return {[number]} PointsMaterial size
 */
export const pointSize = (units, mesh) => (units * (mesh.scale.y || 1)) / tanHalf();

/**
 * @description A soft round white dot (16x16, alpha falling off to clear at the edge), so points draw round, not square (wardedMotes.js, frozen.js & others). The caller disposes it
 * @return {[DataTexture]}
 */
export function dotTexture() {
	const n = 16, data = new Uint8Array(n * n * 4).fill(255);
	for (let y = 0; y < n; y++) {
		for (let x = 0; x < n; x++) { data[(y * n + x) * 4 + 3] = 255 * Math.max(0, 1 - Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2)) ** 0.7; }
	}
	const texture = new DataTexture(data, n, n);
	texture.magFilter = texture.minFilter = LinearFilter; // SMOOTH WHEN A DOT DRAWS BIG (THE HAZE), NOT STAIR-STEPPED
	texture.needsUpdate = true;
	return texture;
}

/**
 * @description The pulse, 0 (at t 0) up to 1 (half a period) & back
 * @param  {[number]} t [seconds]
 * @return {[number]} 0..1
 */
export const pulse = (t) => (1 - Math.cos((2 * Math.PI * t) / PULSE_S)) / 2;

/**
 * @description Mote i of n at time t: how far up its climb (0 the foot, 1 the top) & how bright (in & out over the climb). The motes are spread evenly through the climb & loop
 * @param  {[number]} t [seconds]
 * @param  {[number]} i
 * @param  {[number]} n
 * @return {[object]} { h, a }
 */
export function mote(t, i, n) {
	const h = (t / RISE_S + i / n) % 1;
	return { h, a: Math.sin(Math.PI * h) };
}

/**
 * @description The shimmer band's height at time t, as a fraction of the piece (0 the foot, 1 the top): from under the foot up past the top over BAND_S, then again
 * @param  {[number]} t [seconds]
 * @return {[number]} -0.3..1.3
 */
export const bandY = (t) => -0.3 + 1.6 * ((t % BAND_S) / BAND_S);

/**
 * @description The Warded aura on one piece (statusFx/index.js calls it)
 * @param  {[Mesh]} pieceMesh [unused: opts.mesh is the current one]
 * @param  {[object]} opts [statusFx/index.js: { s, id, left, by, square, mode, slot, slots, mesh, root, squareRoot, reduce, cheap, fresh (read in create only: a real gain plays the flare) }, updated in place]
 * @return {[object]} { update(dt), burst(), animating(), dispose() }
 */
export function create(pieceMesh, opts) {
	const aura = new Mesh(new SphereGeometry(1, 12, 8), layer(AURA_FRAG, 0xfff0b8, { side: BackSide }));
	// THE CORE & THE SHEEN DRAW THE PIECE'S OWN (SHARED, SO NEVER FREED HERE) GEOMETRY; pieces.js'S MATERIALS STAY AS THEY ARE
	const shell = new Mesh(opts.mesh.geometry, layer(SHELL_FRAG, 0xffe08a));
	shell.scale.set(...SHELL);
	// THE SHEEN IS PULLED A HAIR TOWARDS THE CAMERA SO IT DRAWS OVER THE WOOD
	const sheen = new Mesh(opts.mesh.geometry, layer(SHEEN_FRAG, 0xe8c04a, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
	const motes = wardedMotes.make(opts.mesh, opts), flare = wardedFlare.make(opts.mesh, opts), light = wardLight.make(opts.mesh, opts);
	aura.name = "wardedAura"; shell.name = "wardedShell"; sheen.name = "wardedSheen";
	opts.root.add(aura, shell, sheen, motes.object, flare.object);
	opts.squareRoot.add(light.object);
	let t = 0, top = 1, half = 0.35, bloomed = null, broke = null; // bloomed: THE BLOOM LAYER AS LAST SET; broke: performance.now() AT burst
	const layers = [aura.material, shell.material, sheen.material];
	const faded = [...motes.object.children, light.object]; // THE SUB-MODULES SET THEIR OWN OPACITY EACH update; THE BREAK SCALES IT AFTER

	// THE PIECE'S SIZE (A NEW MESH COMES WITH update(0))
	function fit() {
		const box = opts.mesh.geometry && opts.mesh.geometry.boundingBox;
		top = box ? box.max.y : 1;
		half = box ? (box.max.x - box.min.x) / 2 : 0.35;
		aura.scale.set(half * 1.35, top * 0.62, half * 1.35);
		aura.position.y = top / 2;
		shell.geometry = sheen.geometry = opts.mesh.geometry;
		shell.material.uniforms.uTop.value = sheen.material.uniforms.uTop.value = top || 1;
	}

	function update(dt) {
		if (dt === 0) { fit(); }
		if (!opts.reduce) { t += dt; }
		// A BROKEN WARD FADES ON WALL TIME, AS statusFx/index.js FREES THE ENDING ON WALL TIME (dt IS CAPPED)
		const out = broke === null ? 1 : Math.max(0, 1 - (performance.now() - broke) / wardedFlare.FLARE_MS); // FADE_MS
		const p = pulse(t), fade = (opts.mesh.userData.opacity ?? 1) * out;
		aura.material.opacity = (0.16 + 0.12 * p) * fade;
		shell.material.opacity = (0.5 + 0.2 * p) * fade; // THE CORE: ALWAYS OVER THE HALO
		sheen.material.opacity = (0.22 + 0.14 * p) * fade;
		for (const m of layers) { m.uniforms.uOpacity.value = m.opacity; }
		shell.material.uniforms.uBand.value = bandY(t);
		// opts.cheap CAN FLIP IN PLACE (statusFx/index.js): NO BLOOM WHILE IT IS ON (THE MOTES HALVE THEMSELVES)
		if (!opts.cheap !== bloomed) { bloomed = !opts.cheap; shell.layers[bloomed ? "enable" : "disable"](BLOOM_LAYER); }
		motes.update(t, opts); light.update(t, opts); flare.update(t, opts);
		if (out < 1) { for (const o of faded) { o.material.opacity *= out; } }
	}
	if (opts.fresh) { flare.play("gain"); } // T24-R2: A REAL GAIN ONLY (index.js SETS fresh), NEVER A LOAD, RECONNECT, MODE SWITCH OR MESH SWAP
	update(0); // ALSO STARTS A JUST-PLAYED FLARE, SO IT IS VISIBLE (animating) AT ONCE

	return {
		update,
		// THE WARD BROKE: THE LOSE FLARE PLAYS & THE BODY FADES OVER FADE_MS (= FLARE_MS); index.js KEEPS IT UPDATING FOR THE RETURNED ms. REDUCE: NO FLARE, FREED AT ONCE
		burst() {
			broke = performance.now();
			if (opts.reduce) { return 0; }
			flare.play("lose");
			flare.update(t, opts); // STARTS IT ON THIS FRAME
			return wardedFlare.FLARE_MS + MARGIN_MS;
		},
		animating: () => !opts.reduce || flare.object.visible,
		dispose() {
			for (const o of [aura, shell, sheen]) { o.removeFromParent(); o.material.dispose(); }
			aura.geometry.dispose();
			motes.dispose(); flare.dispose(); light.dispose();
		},
	};
}
