// Warded's motes & glints (Task 24 S2b): gold motes of varied size, speed & tint spiralling up around the piece, plus a bright star glinting on its surface every few seconds.
// One Points draw for the motes, one for the glints; the dot & star textures are shared by every piece. Cheap: half the motes, no glints, no bloom. Reduced motion: still motes, no glints
import { BufferGeometry, Float32BufferAttribute, PointsMaterial, Points, Group, DataTexture, LinearFilter, AdditiveBlending } from "three";
import { BLOOM_LAYER } from "../../constants.js";
import { dotTexture, pointSize, MOTE_SIZE, RISE_S } from "./warded.js";

export const MOTES = 14; // FULL COUNT; CHEAP DRAWS THE FIRST HALF
export const GLINTS = 2; // GLINT SLOTS, EACH ON ITS OWN RANDOM SCHEDULE
export const GLINT_EVERY = 4; // A SLOT'S WINDOW, SECONDS: AT MOST ONE FLASH PER WINDOW
export const GLINT_S = 0.35; // ONE FLASH, SECONDS
const GLINT_ODDS = 0.7; // SHARE OF WINDOWS THAT FLASH, SO THE RHYTHM ISN'T A METRONOME
const GLINT_SIZE = 0.2; // PIECE UNITS ACROSS AT ITS PEAK
const TAU = 2 * Math.PI;

/**
 * @description A repeatable pseudo-random number in [0, 1) for (i, k)
 * @param  {[number]} i
 * @param  {[number]} k
 * @return {[number]}
 */
export function seed(i, k) {
	const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
	return x - Math.floor(x);
}

/**
 * @description Mote i's fixed traits: size factor, climb period (s), phase through the climb, start angle, spiral turns & direction, brightness, colour (around gold)
 * @param  {[number]} i
 * @return {[object]} { size, period, phase, angle, turns, dir, bright, color: [r, g, b] }
 */
export function moteParams(i) {
	const tint = seed(i, 5);
	return {
		size: 0.7 + 0.8 * seed(i, 1),
		period: RISE_S * (0.75 + 0.6 * seed(i, 2)),
		phase: (i * 0.618034) % 1, // GOLDEN RATIO: SPREAD EVENLY THROUGH THE CLIMB
		angle: i * 2.399, // THE GOLDEN ANGLE: NO TWO MOTES CLIMB SIDE BY SIDE
		turns: 0.6 + 0.5 * seed(i, 3),
		dir: seed(i, 4) < 0.5 ? -1 : 1,
		bright: 0.65 + 0.35 * seed(i, 6),
		color: [1, 0.78 + 0.14 * tint, 0.32 + 0.3 * seed(i, 7)], // PALE GOLD TO DEEP AMBER
	};
}
let PARAMS = null; // ONCE, SO update ALLOCATES NOTHING; ON FIRST USE, NOT AT LOAD: warded.js IMPORTS THIS FILE & RISE_S ISN'T SET YET WHEN IT LOADS FIRST
const params = () => PARAMS || (PARAMS = Array.from({ length: MOTES }, (_, i) => moteParams(i)));

/**
 * @description How many motes draw
 * @param  {[boolean]} cheap
 * @return {[number]}
 */
export const moteCount = (cheap) => (cheap ? Math.max(1, Math.ceil(MOTES / 2)) : MOTES);

/**
 * @description Mote i at time t, written into out: x, y, z (piece units, foot at 0) & brightness 0..1. A spiral climb that narrows a little towards the top
 * @param  {[number]} t [seconds]
 * @param  {[number]} i
 * @param  {[number]} top [the piece's height]
 * @param  {[number]} half [the piece's half width]
 * @param  {[Float32Array]} out [length 4]
 * @return {[Float32Array]} out
 */
export function moteAt(t, i, top, half, out) {
	const p = params()[i], x = t / p.period + p.phase, h = x - Math.floor(x);
	const angle = p.angle + p.dir * p.turns * TAU * h, r = half * (0.95 - 0.35 * h);
	out[0] = Math.cos(angle) * r; out[1] = h * top * 1.15; out[2] = Math.sin(angle) * r;
	out[3] = Math.sin(Math.PI * h) * p.bright;
	return out;
}

/**
 * @description Glint slot j at time t, written into out: x, y, z on the piece's surface & brightness 0..1 (0 between flashes). Each GLINT_EVERY window flashes once at a random moment & spot, or not at all
 * @param  {[number]} t [seconds]
 * @param  {[number]} j [slot]
 * @param  {[number]} top
 * @param  {[number]} half
 * @param  {[Float32Array]} out [length 4]
 * @return {[Float32Array]} out
 */
export function glintAt(t, j, top, half, out) {
	const shifted = t + (j * GLINT_EVERY) / GLINTS, k = Math.floor(shifted / GLINT_EVERY);
	const u = (shifted - k * GLINT_EVERY - seed(k, 20 + j) * (GLINT_EVERY - GLINT_S)) / GLINT_S;
	const hf = 0.2 + 0.7 * seed(k, 30 + j), angle = seed(k, 40 + j) * TAU, r = half * 0.85 * (1 - 0.35 * hf);
	out[0] = Math.cos(angle) * r; out[1] = hf * top; out[2] = Math.sin(angle) * r;
	out[3] = seed(k, 10 + j) < GLINT_ODDS && u >= 0 && u < 1 ? Math.sin(Math.PI * u) : 0;
	return out;
}

/**
 * @description onBeforeCompile for a PointsMaterial: three's size times a per-point aSize attribute
 * @param  {[object]} shader
 */
export function sizePatch(shader) {
	shader.vertexShader = shader.vertexShader.replace("uniform float size;", "uniform float size;\nattribute float aSize;").replace("gl_PointSize = size;", "gl_PointSize = size * aSize;");
}

// A FOUR-POINTED WHITE STAR (32x32): THIN BRIGHT ARMS & A SOFT CORE
function starTexture() {
	const n = 32, data = new Uint8Array(n * n * 4).fill(255);
	for (let y = 0; y < n; y++) {
		for (let x = 0; x < n; x++) {
			const dx = Math.abs(x + 0.5 - n / 2) / (n / 2), dy = Math.abs(y + 0.5 - n / 2) / (n / 2);
			const arms = Math.max(Math.max(0, 1 - dx) * Math.max(0, 1 - dy * 9), Math.max(0, 1 - dy) * Math.max(0, 1 - dx * 9));
			const core = Math.max(0, 1 - Math.hypot(dx, dy) * 2.5);
			data[(y * n + x) * 4 + 3] = 255 * Math.min(1, arms ** 1.5 + core);
		}
	}
	const texture = new DataTexture(data, n, n);
	texture.magFilter = texture.minFilter = LinearFilter;
	texture.needsUpdate = true;
	return texture;
}
let dot = null, star = null; // SHARED BY EVERY PIECE, NEVER FREED (TWO TINY TEXTURES)

function cloud(count, map, sizes) {
	const geometry = new BufferGeometry();
	geometry.setAttribute("position", new Float32BufferAttribute(new Float32Array(count * 3), 3));
	geometry.setAttribute("color", new Float32BufferAttribute(new Float32Array(count * 3), 3));
	geometry.setAttribute("aSize", new Float32BufferAttribute(sizes, 1));
	const material = new PointsMaterial({ map, vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false, fog: false }); // fog: false ON EVERY GLOW MATERIAL: bloom.js DRAWS THE GLOWS WITH scene.fog OFF, A FOGGED ONE WOULD RE-ACQUIRE ITS PROGRAM TWICE A FRAME (T24 M1)
	material.onBeforeCompile = sizePatch; // ONE FUNCTION, SO EVERY PIECE SHARES ONE PROGRAM
	const points = new Points(geometry, material);
	points.frustumCulled = false; // ITS BOUNDS WOULD NEED A RECOMPUTE EVERY FRAME
	return points;
}

/**
 * @description Warded's motes & glints on one piece (warded.js adds object to opts.root)
 * @param  {[Mesh]} pieceMesh [the piece; opts.mesh wins when set, as it is the current one]
 * @param  {[object]} opts [statusFx/index.js's opts: { mesh, reduce, cheap, ... }, updated in place]
 * @return {[object]} { object, update(t, opts), dispose() }
 */
export function make(pieceMesh, opts) {
	dot = dot || dotTexture();
	star = star || starTexture();
	const motes = cloud(MOTES, dot, Float32Array.from(params(), (p) => p.size));
	const glints = cloud(GLINTS, star, new Float32Array(GLINTS));
	motes.name = "wardedMotes"; glints.name = "wardedGlints";
	const object = new Group();
	object.name = "wardedMoteCloud";
	object.add(motes, glints);
	const out = new Float32Array(4), both = [motes, glints]; // ONE ARRAY, NOT ONE PER FRAME

	function update(t, o = opts) {
		const mesh = o.mesh || pieceMesh, box = mesh.geometry && mesh.geometry.boundingBox;
		const top = box ? box.max.y : 1, half = box ? (box.max.x - box.min.x) / 2 : 0.35;
		const cheap = !!o.cheap, fade = mesh.userData.opacity ?? 1, n = moteCount(cheap);
		if (o.reduce) { t = 0; } // A STEADY LOOK: THE MOTES HOLD THEIR PLACES
		for (const p of both) { if (cheap) { p.layers.disable(BLOOM_LAYER); } else { p.layers.enable(BLOOM_LAYER); } }
		motes.material.size = pointSize(MOTE_SIZE, mesh);
		motes.material.opacity = 0.9 * fade;
		motes.geometry.setDrawRange(0, n);
		let pos = motes.geometry.attributes.position, col = motes.geometry.attributes.color;
		for (let i = 0; i < n; i++) {
			moteAt(t, i, top, half, out);
			const c = params()[i].color;
			pos.setXYZ(i, out[0], out[1], out[2]);
			col.setXYZ(i, c[0] * out[3], c[1] * out[3], c[2] * out[3]); // ADDITIVE: A DARKER COLOUR IS A FAINTER MOTE
		}
		pos.needsUpdate = col.needsUpdate = true;
		glints.visible = !cheap && !o.reduce;
		if (!glints.visible) { return; }
		glints.material.size = pointSize(GLINT_SIZE, mesh);
		glints.material.opacity = fade;
		pos = glints.geometry.attributes.position; col = glints.geometry.attributes.color;
		const size = glints.geometry.attributes.aSize;
		for (let j = 0; j < GLINTS; j++) {
			glintAt(t, j, top, half, out);
			pos.setXYZ(j, out[0], out[1], out[2]);
			col.setXYZ(j, out[3], out[3] * 0.95, out[3] * 0.8); // WARM WHITE
			size.setX(j, 0.3 + 0.7 * out[3]); // THE STAR GROWS & SHRINKS WITH ITS FLASH
		}
		pos.needsUpdate = col.needsUpdate = size.needsUpdate = true;
	}
	update(0);

	return {
		object,
		update,
		dispose() {
			object.removeFromParent();
			for (const p of [motes, glints]) { p.geometry.dispose(); p.material.dispose(); }
		},
	};
}
