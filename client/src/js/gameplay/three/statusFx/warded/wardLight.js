// Warded's warm light (Task 24 S2d): a soft gold glow on the piece's square & its neighbours, pulsing with warded.js's pulse. Not a real light (one per piece kills phones):
// an additive radial-gradient decal on the board. Sits in opts.squareRoot (world units, the board at the square's centre), as marked.js's glow does
import { PlaneGeometry, MeshBasicMaterial, Mesh, DataTexture, LinearFilter, AdditiveBlending, SRGBColorSpace } from "three";
import { CELL_SIZE } from "../../constants.js";
import { pulse } from "./warded.js";

export const SIZE = CELL_SIZE * 3; // THE SQUARE & ITS NEIGHBOURS, FADING OUT BEFORE THE DECAL'S EDGE
export const LIGHT = 0.32; // THE DIMMEST OPACITY (THE PULSE'S LOW)
export const PULSE = 0.18; // HOW MUCH THE PULSE ADDS AT ITS HIGH
const ABOVE = 0.015; // JUST OVER THE BOARD, UNDER MARKED'S GLOW (0.02) & THE SIGIL RINGS (0.04)
const WARM = [255, 196, 96]; // THE GRADIENT'S GOLD

/**
 * @description The decal's opacity at a time: warded.js's pulse between LIGHT & LIGHT + PULSE, steady at the middle under reduced motion, faded with the piece. The same for every Warded piece, Heavy Cavalry's included (ruling T24-R4)
 * @param  {[number]} t [seconds, the parent's clock]
 * @param  {[object]} opts [the live status's: reduce, mesh]
 * @return {[number]} opacity
 */
export function level(t, opts) {
	const p = opts.reduce ? 0.5 : pulse(t);
	return (LIGHT + PULSE * p) * (opts.mesh?.userData.opacity ?? 1);
}

/**
 * @description A warm radial gradient (32x32, bright gold in the middle falling off to clear at the rim), built without a canvas. The caller disposes it
 * @return {[DataTexture]}
 */
export function lightTexture() {
	const n = 32, data = new Uint8Array(n * n * 4);
	for (let y = 0; y < n; y++) {
		for (let x = 0; x < n; x++) {
			const r = Math.min(1, Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2 - 1)), a = (1 - r) ** 2; // SQUARED: A BRIGHT CORE ON THE PIECE'S SQUARE, A LONG SOFT FALLOFF ON THE NEIGHBOURS
			data.set([WARM[0], WARM[1], WARM[2], Math.round(255 * a)], (y * n + x) * 4);
		}
	}
	const texture = new DataTexture(data, n, n);
	texture.magFilter = texture.minFilter = LinearFilter;
	texture.colorSpace = SRGBColorSpace; // WARM IS AN sRGB GOLD; AS LINEAR DATA IT WASHES OUT TO CREAM
	texture.needsUpdate = true;
	return texture;
}

// SHARED BY EVERY WARDED PIECE (16 AT ONCE STAY CHEAP), MADE ON FIRST USE & NEVER FREED (TINY)
let shared = null;
const parts = () => shared || (shared = { geometry: new PlaneGeometry(SIZE, SIZE), map: lightTexture() });

/**
 * @description The warm light under one Warded piece. The parent adds object to opts.squareRoot & calls update each frame. No bloom: it's light on the board, not a glowing thing
 * @param  {[Mesh]} pieceMesh [unused: opts.mesh is read for the fade]
 * @param  {[object]} opts [the live status's]
 * @return {[object]} { object, update(t, opts), dispose() }
 */
export function make(pieceMesh, opts) {
	const { geometry, map } = parts();
	const object = new Mesh(geometry, new MeshBasicMaterial({ map, transparent: true, depthWrite: false, blending: AdditiveBlending }));
	object.name = "wardLight";
	object.rotation.x = -Math.PI / 2;
	object.position.y = ABOVE;
	object.renderOrder = -2; // BEFORE THE PIECE SHADOWS (pieces.js, -1, SAME HEIGHT) SO THE SHADOW ALWAYS SITS ON THE GOLD, & UNDER THE OTHER EFFECTS
	function update(t, o = opts) { object.material.opacity = level(t, o); }
	update(0, opts);
	return {
		object,
		update,
		dispose() { object.removeFromParent(); object.material.dispose(); },
	};
}
