// Status effect: Warded (can't be captured). A radiant aura: a white-gold glow around the piece pulsing gently, a see-through golden sheen in the piece's own shape over it & gold motes rising up it.
// All in opts.root (piece units), so it follows the lift, the drag & the drop. Still under reduced motion; no count (the badge shows the turns left)
import { SphereGeometry, BufferGeometry, Float32BufferAttribute, MeshBasicMaterial, PointsMaterial, Mesh, Points, DataTexture, MathUtils, LinearFilter, AdditiveBlending, BackSide } from "three";
import { FOV, SMALL_FOV, SMALL_SCREEN } from "../constants.js";

export const PULSE_S = 2.4; // ONE GENTLE PULSE, SECONDS
export const RISE_S = 2.8; // A MOTE'S CLIMB FROM THE FOOT TO OVER THE TOP, SECONDS
const MOTES = 8; // ONE Points DRAW: 16 WARDED PIECES STAY CHEAP ON A PHONE
const GOLD = [1, 0.86, 0.45]; // A MOTE'S COLOUR AT FULL STRENGTH
export const MOTE_SIZE = 0.06; // PIECE UNITS ACROSS
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
 * @description A soft round white dot (16x16, alpha falling off to clear at the edge), so points draw round, not square. The caller disposes it
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
 * @description The Warded aura on one piece (statusFx/index.js calls it)
 * @param  {[Mesh]} pieceMesh [unused: opts.mesh is the current one]
 * @param  {[object]} opts [statusFx/index.js: { s, id, left, by, square, mode, slot, slots, mesh, root, squareRoot, reduce }, updated in place]
 * @return {[object]} { update(dt), burst(), animating(), dispose() }
 */
export function create(pieceMesh, opts) {
	const aura = new Mesh(new SphereGeometry(1, 12, 8), new MeshBasicMaterial({ color: 0xfff0b8, transparent: true, blending: AdditiveBlending, depthWrite: false, side: BackSide }));
	// THE SHEEN: THE PIECE'S OWN (SHARED, SO NEVER FREED HERE) GEOMETRY IN ADDITIVE GOLD, PULLED A HAIR TOWARDS THE CAMERA SO IT DRAWS OVER THE WOOD. pieces.js'S MATERIALS STAY AS THEY ARE
	const sheen = new Mesh(opts.mesh.geometry, new MeshBasicMaterial({ color: 0xe8c04a, transparent: true, blending: AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
	const dot = dotTexture();
	const dots = new BufferGeometry();
	dots.setAttribute("position", new Float32BufferAttribute(new Float32Array(MOTES * 3), 3));
	dots.setAttribute("color", new Float32BufferAttribute(new Float32Array(MOTES * 3), 3));
	const motes = new Points(dots, new PointsMaterial({ map: dot, vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false }));
	motes.frustumCulled = false; // ITS BOUNDS WOULD NEED A RECOMPUTE EVERY FRAME
	aura.name = "wardedAura"; sheen.name = "wardedSheen"; motes.name = "wardedMotes";
	opts.root.add(aura, sheen, motes);
	let t = 0, top = 1, half = 0.35;

	// THE PIECE'S SIZE (A NEW MESH COMES WITH update(0))
	function fit() {
		const box = opts.mesh.geometry && opts.mesh.geometry.boundingBox;
		top = box ? box.max.y : 1;
		half = box ? (box.max.x - box.min.x) / 2 : 0.35;
		aura.scale.set(half * 1.35, top * 0.62, half * 1.35);
		aura.position.y = top / 2;
		sheen.geometry = opts.mesh.geometry;
		motes.material.size = pointSize(MOTE_SIZE, opts.mesh);
	}

	function update(dt) {
		if (dt === 0) { fit(); }
		if (!opts.reduce) { t += dt; }
		const p = pulse(t), fade = opts.mesh.userData.opacity ?? 1;
		aura.material.opacity = (0.16 + 0.12 * p) * fade;
		sheen.material.opacity = (0.22 + 0.14 * p) * fade;
		motes.material.opacity = 0.9 * fade;
		const pos = dots.attributes.position, col = dots.attributes.color;
		for (let i = 0; i < MOTES; i++) {
			const { h, a } = mote(t, i, MOTES), angle = i * 2.399; // THE GOLDEN ANGLE: NO TWO MOTES CLIMB SIDE BY SIDE
			pos.setXYZ(i, Math.cos(angle) * half * 0.9, h * top * 1.1, Math.sin(angle) * half * 0.9);
			col.setXYZ(i, GOLD[0] * a, GOLD[1] * a, GOLD[2] * a); // ADDITIVE: A DARKER COLOUR IS A FAINTER MOTE
		}
		pos.needsUpdate = col.needsUpdate = true;
	}
	update(0);

	return {
		update,
		burst() { return 0; },
		animating: () => !opts.reduce,
		dispose() {
			for (const o of [aura, sheen, motes]) { o.removeFromParent(); o.material.dispose(); }
			aura.geometry.dispose(); dots.dispose(); dot.dispose();
		},
	};
}
