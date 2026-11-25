// Frozen's ground (Task 24 S3b, art/Frozen for style): frost spreading over the piece's square from its foot (a decal: pale hoarfrost round the foot & white rime cracks
// radiating out) & a low cold mist drifting over the square. A sub-effect of frozen.js: its object goes in opts.squareRoot (the square's centre, y 0, world units).
// Cheap (opts.cheap): the decal only, no mist. Reduced motion (opts.reduce): the full frost at once & a still mist. Ice doesn't glow: nothing on BLOOM_LAYER
import { Group, Mesh, Points, PlaneGeometry, BufferGeometry, Float32BufferAttribute, MeshBasicMaterial, PointsMaterial, DataTexture, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace } from "three";
import { CELL_SIZE } from "../constants.js";
import { pointSize } from "./warded.js";

export const SPREAD_S = 1.2; // SECONDS FOR THE FROST TO GROW FROM THE FOOT TO THE WHOLE SQUARE
export const MIST = 10; // PUFFS, ONE Points DRAW
export const SETTLE_S = 3; // SECONDS AFTER THE SPREAD FOR THE MIST TO EASE TO REST (T24-R6: THEN NO FRAMES ARE ASKED FOR)
const START = 0.3; // THE FROST'S SIZE (OF ITS FULL) AS IT STARTS: ALREADY ROUND THE FOOT
const FROST_SIZE = CELL_SIZE * 1.1; // THE DECAL'S SIDE (WORLD UNITS): IT FADES OUT INSIDE ITS CIRCLE, SO ONLY THE CRACK TIPS TOUCH THE NEIGHBOURS
const FROST_ALPHA = 0.85, MIST_ALPHA = 0.16;
const MIST_SIZE = CELL_SIZE * 0.45; // A PUFF'S SIZE (WORLD UNITS)
const DRIFT = 0.18; // RADIANS A SECOND A PUFF CIRCLES THE PIECE
const LIFT = 0.012; // OVER THE GRID (0.01), UNDER MARKED'S GLOW (0.02) & THE TILE HIGHLIGHTS: THEY ALL SKIP DEPTH, SO HEIGHT DECIDES
const PX = 128; // THE FROST TEXTURE'S SIDE

/**
 * @description The frost decal's pixels (RGBA, n x n): pale blue hoarfrost speckled round the foot, fading out by 0.6 of the radius, & white rime cracks from the foot
 * forking out to near the edge. Seeded, so the same every time. Nothing at the edge or the corners (no square seam)
 * @param  {[number]} n [the side, pixels]
 * @return {[Uint8Array]} n * n * 4
 */
export function frostPattern(n = PX) {
	let seed = 0x5eed;
	const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; // A FIXED LCG: THE SAME FROST ON EVERY SQUARE & EVERY LOAD
	const data = new Uint8Array(n * n * 4), half = n / 2;
	for (let y = 0; y < n; y++) {
		for (let x = 0; x < n; x++) {
			const i = (y * n + x) * 4, r = Math.hypot(x + 0.5 - half, y + 0.5 - half) / half;
			data[i] = 210; data[i + 1] = 232; data[i + 2] = 255;
			data[i + 3] = 255 * Math.max(0, Math.min(1, 1 - (r - 0.15) / 0.45)) * (0.55 + 0.45 * rand()); // SPECKLED: HOARFROST, NOT PAINT
		}
	}
	function stamp(px, py, a) {
		const x = Math.round(px), y = Math.round(py);
		if (x < 0 || y < 0 || x >= n || y >= n || Math.hypot(x + 0.5 - half, y + 0.5 - half) >= half - 1) { return; }
		const i = (y * n + x) * 4;
		data[i] = data[i + 1] = data[i + 2] = 255;
		data[i + 3] = Math.max(data[i + 3], a);
	}
	// A CRACK WALKS OUT FROM r0 WITH A WANDERING ANGLE, SOMETIMES FORKING A SHORTER, FAINTER ONE
	function crack(r0, ang, end, a, depth) {
		let x = half + Math.cos(ang) * r0 * half, y = half + Math.sin(ang) * r0 * half;
		const steps = Math.ceil(n / 64), len = 0.8 * n / 64 / steps; // A STEP IS THE SAME SHARE OF ANY SIZE, STAMPED UNDER A PIXEL APART: A LINE, NOT DOTS
		while (Math.hypot(x - half, y - half) / half < end) {
			ang += (rand() - 0.5) * 0.5;
			for (let s = 0; s < steps; s++) {
				stamp(x, y, a);
				if (depth === 0) { stamp(x + 1, y, a * 0.5); stamp(x, y + 1, a * 0.5); } // THE MAIN CRACKS A PIXEL THICKER
				x += Math.cos(ang) * len; y += Math.sin(ang) * len;
			}
			if (depth < 2 && rand() < 0.07) { crack(Math.hypot(x - half, y - half) / half, ang + (rand() < 0.5 ? -0.7 : 0.7), Math.min(end, Math.hypot(x - half, y - half) / half + 0.25), a * 0.8, depth + 1); }
		}
	}
	const CRACKS = 9;
	for (let k = 0; k < CRACKS; k++) { crack(0.15, (k / CRACKS) * 2 * Math.PI + rand() * 0.5, 0.82 + rand() * 0.14, 235, 0); }
	return data;
}

/**
 * @description How far the frost has spread (its size, of the full): from START round the foot to 1, easing out over SPREAD_S. Under reduced motion, 1 at once
 * @param  {[number]} t [seconds since the effect began]
 * @param  {[boolean]} reduce
 * @return {[number]} START..1
 */
export function spread(t, reduce) {
	if (reduce) { return 1; }
	const k = Math.min(1, Math.max(0, t / SPREAD_S));
	return START + (1 - START) * (1 - (1 - k) ** 3);
}

// THE MIST'S OWN CLOCK: t UNTIL THE SPREAD ENDS, THEN ITS SPEED FALLS LINEARLY TO 0 OVER SETTLE_S (THE INTEGRAL OF 1 - d / SETTLE_S), THEN IT STOPS
function mistClock(t) {
	const d = Math.min(SETTLE_S, Math.max(0, t - SPREAD_S));
	return Math.min(t, SPREAD_S) + d - (d * d) / (2 * SETTLE_S);
}

/**
 * @description Mist puff i of n at time t: circling the piece slowly (every other one the other way), its distance breathing, low over the board, its alpha breathing too.
 * It eases to rest over SETTLE_S after the spread and stays there: a still mist pooled on the square
 * @param  {[number]} t [seconds since the effect began; reduced motion: a still mist]
 * @param  {[number]} i
 * @param  {[number]} n
 * @param  {[boolean]} reduce
 * @param  {[object]} out [optional: written into & returned, so update() allocates nothing per frame]
 * @return {[object]} { x, y, z (world units from the square's centre), a (of MIST_ALPHA, 0..1) }
 */
export function mistPuff(t, i, n, reduce, out = {}) {
	const s = reduce ? 0 : mistClock(t), u = (i * 0.618) % 1;
	const ang = (i / n) * 2 * Math.PI + (i % 2 ? -1 : 1) * DRIFT * (0.7 + 0.6 * u) * s;
	const r = CELL_SIZE * (0.18 + 0.15 * u + 0.05 * Math.sin(s * 0.5 + i));
	out.x = Math.cos(ang) * r; out.y = CELL_SIZE * (0.03 + 0.05 * ((i * 0.31) % 1)); out.z = Math.sin(ang) * r; out.a = 0.7 + 0.3 * Math.sin(s * 0.7 + i * 1.7);
	return out;
}

const PUFF = {}; // mistPuff's out: ONE FOR THE MODULE, update() RUNS ONE AT A TIME
// SHARED BY EVERY FROZEN PIECE (MADE ON FIRST USE, NEVER FREED): THE FROST TEXTURE, THE DECAL'S PLANE & THE PUFF'S SOFT DOT
let shared = null;
function texture(data, n) {
	const tex = new DataTexture(data, n, n);
	tex.magFilter = LinearFilter;
	tex.minFilter = LinearMipmapLinearFilter; // MIPMAPPED (n IS A POWER OF TWO): FROM THE OPENING CAMERA A SQUARE IS FAR UNDER 128 px, SO THE SPECKLE & 1 px CRACKS WOULD SHIMMER
	tex.generateMipmaps = true;
	tex.colorSpace = SRGBColorSpace;
	tex.needsUpdate = true;
	return tex;
}
function puffData(n) {
	const data = new Uint8Array(n * n * 4).fill(255);
	for (let y = 0; y < n; y++) {
		for (let x = 0; x < n; x++) { data[(y * n + x) * 4 + 3] = 255 * Math.exp(-4 * (Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2)) ** 2); } // A GAUSSIAN: A PUFF, NO RIM
	}
	return data;
}
function sharedParts() {
	if (!shared) {
		const plane = new PlaneGeometry(FROST_SIZE, FROST_SIZE);
		plane.rotateX(-Math.PI / 2);
		shared = { plane, frost: texture(frostPattern(PX), PX), puff: texture(puffData(32), 32) };
	}
	return shared;
}

/**
 * @description Frozen's frost & mist on the piece's square (frozen.js adds object to opts.squareRoot)
 * @param  {[Mesh]} pieceMesh [unused: opts.mesh is the current one]
 * @param  {[object]} opts [frozen.js's opts (statusFx/index.js): reads cheap, reduce & mesh.userData.opacity, live]
 * @return {[object]} { object, update(t, opts, fade = 1), animating(), dispose() }.
 * update's t is the parent's running clock (T24-R1): seconds since the effect began, NOT a frame's dt; the parent sums its dt & passes the total.
 * fade (0..1) multiplies into every opacity on top of the piece's: frozen.js passes fall(burstT).a while the shards fall, 1 (or nothing) otherwise.
 * animating() is true while the frost spreads (SPREAD_S) and, with the mist, while it settles (SETTLE_S more); then false (no constant redraws, T24-R6)
 */
export function make(pieceMesh, opts) {
	const { plane, frost, puff } = sharedParts();
	const decal = new Mesh(plane, new MeshBasicMaterial({ map: frost, transparent: true, depthWrite: false }));
	decal.position.y = LIFT;
	const puffs = new BufferGeometry();
	puffs.setAttribute("position", new Float32BufferAttribute(new Float32Array(MIST * 3), 3));
	const mist = new Points(puffs, new PointsMaterial({ map: puff, color: 0xdff0ff, transparent: true, depthWrite: false, size: pointSize(MIST_SIZE, { scale: { y: 1 } }) })); // THE SQUARE'S ROOT IS WORLD UNITS, SCALE 1
	mist.frustumCulled = false; // ITS BOUNDS WOULD NEED A RECOMPUTE AS IT DRIFTS
	decal.name = "frostDecal"; mist.name = "frostMist";
	const object = new Group();
	object.add(decal, mist);
	let lastT = 0, live = opts;

	function update(t, o = live, burst = 1) {
		live = o; lastT = t;
		const fade = ((o.mesh && o.mesh.userData.opacity) ?? 1) * burst, k = spread(t, o.reduce);
		decal.scale.set(k, 1, k);
		decal.material.opacity = FROST_ALPHA * Math.min(1, k / 0.6) * fade; // FADES IN AS IT FIRST SPREADS
		mist.visible = !o.cheap;
		if (o.cheap) { return; }
		const pos = puffs.attributes.position;
		let a = 0;
		for (let i = 0; i < MIST; i++) {
			const p = mistPuff(t, i, MIST, o.reduce, PUFF);
			pos.setXYZ(i, p.x, p.y, p.z);
			a += p.a;
		}
		pos.needsUpdate = true;
		mist.material.opacity = MIST_ALPHA * (a / MIST) * fade * k; // ONE MATERIAL FOR ALL PUFFS: THEIR MEAN BREATH
	}
	update(0, opts);

	return {
		object,
		update,
		animating: () => !live.reduce && lastT < SPREAD_S + (live.cheap ? 0 : SETTLE_S),
		dispose() {
			object.removeFromParent();
			for (const r of [decal.material, puffs, mist.material]) { r.dispose(); }
		},
	};
}
