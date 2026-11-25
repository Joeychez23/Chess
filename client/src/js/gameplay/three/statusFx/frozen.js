// Status effect: Frozen (can't move). Frost-crusted: a see-through pale frost-blue layer in the piece's own shape over it, rime specks on its surface, ice shards on its sides & a still cold haze at its foot.
// When it ends (burst) the shards crack (split & jolt), then fall to the board as everything fades. All in opts.root (piece units), so it follows the lift, the drag & the drop.
// Still until the burst (no frames asked for), still under reduced motion & no burst then; no count (the badge shows the turns left)
import { ConeGeometry, PlaneGeometry, BufferGeometry, Float32BufferAttribute, MeshBasicMaterial, PointsMaterial, Mesh, Points, Group } from "three";
import { dotTexture, pointSize } from "./warded.js"; // THE SAME SOFT ROUND DOT & POINT SIZE AS WARDED'S MOTES

export const BURST_MS = 700; // THE CRACK, THEN THE FALL
export const CRACK_MS = 150; // THE SHARDS SPLIT & JOLT IN PLACE BEFORE THEY FALL
const SPLIT = 0.12; // HOW FAR (OF THE WHOLE FLY-OFF) THE CRACK PUSHES THE SHARDS OUT
const SHARDS = 6; // ONE GEOMETRY & ONE MATERIAL FOR ALL: 16 FROZEN PIECES STAY CHEAP ON A PHONE
const RIME = 28, RIME_SIZE = 0.035; // SPECKS (ONE Points DRAW), PIECE UNITS ACROSS
const SHARD_ALPHA = 0.85, CRUST_ALPHA = 0.4, RIME_ALPHA = 0.8, MIST_ALPHA = 0.18;

/**
 * @description A shard t seconds into the burst. First the crack (CRACK_MS: a small split out & a jolt, nothing falls), then the fall: drop (0 where it was, 1 on the board, speeding up), out (how far it has flown off the piece, 0..1), jolt (a rotation, radians) & its alpha
 * @param  {[number]} t [seconds]
 * @return {[object]} { drop, out, jolt, a }
 */
export function fall(t) {
	const ms = Math.max(0, t * 1000);
	if (ms < CRACK_MS) {
		const k = ms / CRACK_MS;
		return { drop: 0, out: SPLIT * Math.sqrt(k), jolt: 0.3 * Math.sin(3 * Math.PI * k), a: 1 }; // A SNAP OUT, A SHAKE THAT SETTLES BACK TO 0
	}
	const k = Math.min(1, (ms - CRACK_MS) / (BURST_MS - CRACK_MS));
	return { drop: k * k, out: k + SPLIT * (1 - k), jolt: 0, a: 1 - k };
}

/**
 * @description How wide the piece is at a height: the furthest vertex from its axis within band of y (0 when none is)
 * @param  {[BufferAttribute]} pos [the piece geometry's positions, piece units]
 * @param  {[number]} y
 * @param  {[number]} band
 * @return {[number]} radius
 */
export function radiusAt(pos, y, band) {
	let r = 0;
	for (let i = 0; i < pos.count; i++) {
		if (Math.abs(pos.getY(i) - y) <= band) { r = Math.max(r, Math.hypot(pos.getX(i), pos.getZ(i))); }
	}
	return r;
}

/**
 * @description The Frozen crust on one piece (statusFx/index.js calls it)
 * @param  {[Mesh]} pieceMesh [unused: opts.mesh is the current one]
 * @param  {[object]} opts [statusFx/index.js: { s, id, left, by, square, mode, slot, slots, mesh, root, squareRoot, reduce }, updated in place]
 * @return {[object]} { update(dt), burst(), animating(), dispose() }
 */
export function create(pieceMesh, opts) {
	// THE CRUST: THE PIECE'S OWN (SHARED, SO NEVER FREED HERE) GEOMETRY IN SEE-THROUGH FROST-BLUE, PULLED A HAIR TOWARDS THE CAMERA SO IT TINTS THE WOOD. pieces.js'S MATERIALS STAY AS THEY ARE
	const crust = new Mesh(opts.mesh.geometry, new MeshBasicMaterial({ color: 0xcfe8ff, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
	const dot = dotTexture();
	const specks = new BufferGeometry();
	specks.setAttribute("position", new Float32BufferAttribute(new Float32Array(RIME * 3), 3));
	const rime = new Points(specks, new PointsMaterial({ map: dot, color: 0xffffff, transparent: true, depthWrite: false }));
	rime.frustumCulled = false; // ITS BOUNDS WOULD NEED A RECOMPUTE ON EVERY REFIT
	const mist = new Mesh(new PlaneGeometry(2, 2), new MeshBasicMaterial({ map: dot, color: 0xdff4ff, transparent: true, depthWrite: false }));
	mist.rotation.x = -Math.PI / 2;
	const shardGeo = new ConeGeometry(0.05, 0.22, 4), shardMat = new MeshBasicMaterial({ color: 0xbfe8ff, transparent: true, depthWrite: false });
	const shards = new Group();
	for (let i = 0; i < SHARDS; i++) { shards.add(new Mesh(shardGeo, shardMat)); }
	crust.name = "frozenCrust"; rime.name = "frozenRime"; mist.name = "frozenMist"; shards.name = "frozenShards";
	opts.root.add(crust, rime, mist, shards);
	let burstT = null, yLo = 0.2, yHi = 0.55, rLo = 0.35, rHi = 0.35;

	// THE PIECE'S SHAPE & SIZE: THE CRUST'S GEOMETRY, THE RIME ON ITS SURFACE & THE SHARDS AT ITS WIDTH WHERE THEY SIT (A NEW MESH COMES WITH update(0))
	function fit() {
		const geo = opts.mesh.geometry, box = geo.boundingBox, pos = geo.attributes.position;
		const top = box ? box.max.y : 1, half = box ? (box.max.x - box.min.x) / 2 : 0.35;
		crust.geometry = geo;
		yLo = top * 0.2; yHi = top * 0.55;
		rLo = radiusAt(pos, yLo, top * 0.08) || half;
		rHi = radiusAt(pos, yHi, top * 0.08) || half;
		const out = specks.attributes.position;
		for (let i = 0; i < RIME; i++) {
			const v = (i * 7919) % pos.count; // A PRIME STRIDE: THE SPECKS SPREAD OVER THE PIECE, NOT IN ONE ROW
			out.setXYZ(i, pos.getX(v) * 1.02, pos.getY(v), pos.getZ(v) * 1.02); // JUST OFF THE SURFACE
		}
		out.needsUpdate = true;
		rime.material.size = pointSize(RIME_SIZE, opts.mesh);
		mist.scale.setScalar(half * 1.8);
		mist.position.y = 0.02;
	}

	function update(dt) {
		if (dt === 0) { fit(); }
		if (burstT !== null && !opts.reduce) { burstT += dt; }
		const fade = opts.mesh.userData.opacity ?? 1, f = fall(burstT ?? 0);
		crust.material.opacity = CRUST_ALPHA * f.a * fade;
		rime.material.opacity = RIME_ALPHA * f.a * fade;
		mist.material.opacity = MIST_ALPHA * f.a * fade;
		shardMat.opacity = SHARD_ALPHA * f.a * fade;
		shards.children.forEach(function (s, i) {
			const up = i % 2, angle = (i / SHARDS) * 2 * Math.PI + 0.4, r = (up ? rHi : rLo) * 1.02 * (1 + 0.6 * f.out), y = (up ? yHi : yLo) * (1 - f.drop), j = up ? f.jolt : -f.jolt;
			s.position.set(Math.cos(angle) * r, y, Math.sin(angle) * r);
			s.rotation.set(j, -angle, -0.9 - 1.6 * f.out + j); // POINTING OUT & UP FROM THE CRUST, JOLTING AS IT CRACKS, TUMBLING AS IT FALLS
		});
	}
	update(0);

	return {
		update,
		burst() {
			if (opts.reduce) { return 0; }
			burstT = 0;
			return BURST_MS;
		},
		animating: () => burstT !== null && !opts.reduce,
		dispose() {
			for (const o of [crust, rime, mist, shards]) { o.removeFromParent(); }
			for (const r of [crust.material, specks, rime.material, mist.geometry, mist.material, shardGeo, shardMat, dot]) { r.dispose(); }
		},
	};
}
