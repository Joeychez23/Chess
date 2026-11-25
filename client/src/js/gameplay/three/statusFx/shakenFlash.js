// Shaken's strike flash (Task 24 S4b, joined in J3): when a bolt strikes, a cold white-blue burst at the striking cage over the piece's head & a quick bright flash on its square, both gone by FLASH.
// It has no clock of its own: shaken.js calls strike(i, n) from its strike branch (one clock), update(dt) only fades it. No light: additive sprites. None under reduced motion
import { Sprite, SpriteMaterial, Mesh, MeshBasicMaterial, PlaneGeometry, AdditiveBlending } from "three";
import { CELL_SIZE, BLOOM_LAYER } from "../constants.js";
import { FLASH, OVER, flash, cageLayout } from "./shaken.js"; // A CYCLE (shaken.js IMPORTS THIS): ONLY USED AT RUN TIME, NEVER AS EITHER MODULE LOADS

const BURST_SIZE = 1.6; // THE BURST'S SIZE AT THE STRIKE, IN CAGE SIZES
const SWELL = 0.6; // HOW MUCH BIGGER IT GROWS AS IT FADES
const GROUND = CELL_SIZE * 0.95; // THE SQUARE'S FLASH, WORLD UNITS ACROSS
const LIFT = 0.02; // OVER THE BOARD, NO Z-FIGHT (AS marked.js's GLOW)

// SHARED BY EVERY SHAKEN PIECE (UP TO 16 IN ONE SYNC): MADE ON FIRST NEED, NEVER FREED
let plane = null;
const look = { burst: 0, scale: 0, ground: 0 }; // REUSED EVERY FRAME

/**
 * @description The flash's look `since` seconds after a strike: the burst's opacity & scale (in cage sizes) & the square's flash opacity, all 0 by FLASH
 * @param  {[number]} since [seconds]
 * @param  {[object]} out [written into & returned]
 * @return {[object]} { burst, scale, ground }
 */
export function flashLook(since, out = {}) {
	const f = flash(since);
	out.burst = f;
	out.scale = BURST_SIZE * (1 + SWELL * (1 - f));
	out.ground = 0.7 * f * f; // THE SQUARE DROPS FASTER: A FLICK, NOT A GLOW
	return out;
}

/**
 * @description Shaken's strike flash, a sub-effect: `object` (the burst) goes in opts.root, `ground` (the square's flash) in opts.squareRoot
 * @param  {[Mesh]} pieceMesh [unused: opts.mesh is the current one]
 * @param  {[object]} opts [statusFx/index.js's, plus cheap (T24 S1): updated in place, read each frame]
 * @param  {[Texture]} map [the soft dot: shaken.js's, which it frees]
 * @return {[object]} { object, ground, strike(i, n), update(dt), dispose() }
 */
export function make(pieceMesh, opts, map) {
	if (!plane) { plane = new PlaneGeometry(1, 1); }
	const object = new Sprite(new SpriteMaterial({ map, color: "#dfeaff", transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false })); // fog: SEE wardedMotes.js
	object.name = "shakenFlash";
	const ground = new Mesh(plane, new MeshBasicMaterial({ map, color: "#a9c8f0", transparent: true, depthWrite: false, blending: AdditiveBlending }));
	ground.name = "shakenFlashGround";
	ground.rotation.x = -Math.PI / 2;
	ground.position.y = LIFT;
	ground.scale.setScalar(GROUND);
	object.visible = ground.visible = false;
	let since = FLASH, at = cageLayout(1, 0); // THE STRUCK CAGE'S { size, x }, LAID OUT ONCE PER STRIKE (NOT PER FRAME)

	function draw() {
		const on = !opts.reduce && since < FLASH;
		object.visible = ground.visible = on;
		if (!on) { return; }
		flashLook(since, look);
		const fade = opts.mesh.userData.opacity ?? 1, box = opts.mesh.geometry && opts.mesh.geometry.boundingBox, scale = opts.mesh.scale.y || 1; // THE ROOT IS IN PIECE UNITS
		const s = at.size / scale;
		object.position.set(at.x / scale, (box ? box.max.y : 1) + OVER + s / 2, 0);
		object.scale.setScalar(look.scale * s);
		object.material.opacity = look.burst * fade;
		ground.material.opacity = look.ground * fade;
		if (opts.cheap) { object.layers.disable(BLOOM_LAYER); } else { object.layers.enable(BLOOM_LAYER); }
	}
	return {
		object, ground,
		strike(i, n) { since = 0; at = cageLayout(n, i); draw(); }, // CAGE i OF THE ROW'S n LAID-OUT CAGES (shaken.js's slots)
		update(dt) { since += dt; draw(); },
		dispose() {
			object.removeFromParent();
			ground.removeFromParent();
			object.material.dispose();
			ground.material.dispose();
		},
	};
}
