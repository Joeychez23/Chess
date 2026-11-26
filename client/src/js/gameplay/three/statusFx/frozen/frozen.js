// Status effect: Frozen (the piece can't move). The piece looks frost-crusted: a see-through, pale frost-blue layer in its own shape
// over it, rime specks on its surface, ice shards on its sides and a still, cold haze at its foot.
// When the status ends (burst), the shards crack (split and jolt), then fall to the board as everything fades. It all lives in opts.root
// (piece units), so it follows the lift, the drag and the drop.
// The piece's ice is still until the burst. The frost on its square (frostGround.js, opts.squareRoot) spreads and its mist settles,
// and after that no frames are asked for until the burst.
// Under reduced motion it is all still, and there is no burst. There is no count (the badge shows the turns left).
// The haze at the foot here draws only when cheap: otherwise the ground's mist replaces it.
// The look is physical ice, not magic: a glossy crust (a refractive MeshPhysicalMaterial, or a MeshStandardMaterial stand-in when
// opts.cheap) with a fresnel rim and a shared rime frost texture, and chunky, irregular shards. No bloom, because ice does not glow.
import {
	ConeGeometry, PlaneGeometry, BufferGeometry, Float32BufferAttribute, MeshBasicMaterial, MeshStandardMaterial, MeshPhysicalMaterial,
	PointsMaterial, DataTexture, RepeatWrapping, LinearFilter, Mesh, Points, Group
} from "three";
// The same soft round dot and point size as Warded's motes.
import { dotTexture, pointSize } from "../warded/warded.js";
// The frost and cold mist on the piece's square (opts.squareRoot).
import * as frostGround from "./frostGround.js";

// The whole burst: the crack, then the fall.
export const BURST_MS = 700;
// The shards split and jolt in place this long before they fall.
export const CRACK_MS = 150;
// How far the crack pushes the shards out, as a share of their whole fly-off.
const SPLIT = 0.12;
// One geometry and one material for all the shards, so 16 frozen pieces stay cheap on a phone.
const SHARDS = 6;
// The rime specks (drawn in one Points call), and each speck's size across in piece units.
const RIME = 28, RIME_SIZE = 0.035;
const SHARD_ALPHA = 0.85, CRUST_ALPHA = 0.55, RIME_ALPHA = 0.8, MIST_ALPHA = 0.18;
// Clear pale blue; water ice's index of refraction; how bright the grazing edges go.
const ICE = 0xcfeaff, ICE_IOR = 1.31, RIM = 0.6;
// The frost texture's size, and its lowest value: clear ice still tints, so it is never fully see-through.
const FROST_N = 64, CLEAR = 120;
// Shard shapes per piece, shared by its shards.
const SHAPES = 3;

/**
 * @description How many rime specks & shards draw: half (rounded up) when cheap
 * @param  {[boolean]} cheap [opts.cheap]
 * @return {[object]} { rime, shards }
 */
export function counts(cheap) {
	return cheap ? { rime: Math.ceil(RIME / 2), shards: Math.ceil(SHARDS / 2) } : { rime: RIME, shards: SHARDS };
}

// A hash in 0..1 that is always the same for the same cell.
const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
let frost = null;

/**
 * @description The rime frost texture: clear ice with white frost patches & specks, tiling. Built once & shared by every crust
 * (alphaMap & roughnessMap: rime is whiter & rough, clear ice glossy), so never freed by a crust
 * @return {[DataTexture]}
 */
export function frostTexture() {
	if (frost) { return frost; }
	const n = FROST_N, cell = 8, data = new Uint8Array(n * n * 4);
	// Value noise that wraps at n, so the texture tiles.
	const noise = (x, y) => {
		const gx = x / cell, gy = y / cell, x0 = Math.floor(gx), y0 = Math.floor(gy), fx = gx - x0, fy = gy - y0, m = n / cell;
		const h = (i, j) => hash(((i % m) + m) % m, ((j % m) + m) % m), sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
		return (h(x0, y0) * (1 - sx) + h(x0 + 1, y0) * sx) * (1 - sy) + (h(x0, y0 + 1) * (1 - sx) + h(x0 + 1, y0 + 1) * sx) * sy;
	};
	for (let y = 0; y < n; y++) {
		for (let x = 0; x < n; x++) {
			const patch = Math.max(0, Math.min(1, (noise(x, y) - 0.45) * 4)), speck = hash(x + 0.5, y + 0.5) > 0.93 ? 1 : 0;
			data.fill(Math.round(CLEAR + (255 - CLEAR) * Math.max(patch, speck)), (y * n + x) * 4, (y * n + x) * 4 + 4);
		}
	}
	frost = new DataTexture(data, n, n);
	frost.wrapS = frost.wrapT = RepeatWrapping;
	frost.magFilter = frost.minFilter = LinearFilter;
	frost.needsUpdate = true;
	return frost;
}

// A fresnel rim: the grazing edges go bright and more opaque, as real ice does. It is scaled by opacity, so it fades with the piece.
function rim(shader) {
	shader.fragmentShader = shader.fragmentShader.replace("#include <opaque_fragment>",
		`float rim = pow( 1.0 - abs( dot( normal, normalize( vViewPosition ) ) ), 3.0 );
	outgoingLight += vec3( 0.85, 0.95, 1.0 ) * rim * ${RIM.toFixed(2)};
	diffuseColor.a = min( 1.0, diffuseColor.a + rim * 0.5 * opacity );
	#include <opaque_fragment>`);
}

// The crust's material. It is refractive (which costs a transmission pass) only when not cheap. pieces.js's materials stay as they are.
function crustMaterial(cheap) {
	const base = {
		color: ICE, roughness: 0.12, metalness: 0, alphaMap: frostTexture(), roughnessMap: frostTexture(),
		transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1
	};
	const m = cheap ? new MeshStandardMaterial(base) : new MeshPhysicalMaterial({
		...base, transmission: 0.9, thickness: 0.15, ior: ICE_IOR, specularIntensity: 1
	});
	m.onBeforeCompile = rim;
	return m;
}

// A chunky shard: a 5-sided cone with its corners pushed in and out, differently for each seed. A corner shared by two faces
// moves the same way in both, so no seam opens.
function shardGeometry(seed) {
	// toNonIndexed() returns a plain BufferGeometry. That matters: it is no longer a cone, whose toJSON would rebuild the unbent cone.
	const g = new ConeGeometry(0.075, 0.2, 5, 1).toNonIndexed(), p = g.attributes.position;
	for (let i = 0; i < p.count; i++) {
		const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
		// The tip and the centre of the base stay where they are.
		if (Math.hypot(x, z) < 1e-6) { continue; }
		const k = 0.65 + 0.7 * hash(Math.round(x * 1e4) + seed * 17, Math.round(z * 1e4) - seed * 31);
		p.setXYZ(i, x * k, y, z * (0.75 + 0.5 * hash(seed + 3, Math.round(x * 1e4))) * k);
	}
	g.computeVertexNormals();
	return g;
}

/**
 * @description A shard t seconds into the burst. First the crack (CRACK_MS: a small split out & a jolt, nothing falls), then the fall:
 * drop (0 where it was, 1 on the board, speeding up), out (how far it has flown off the piece, 0..1), jolt (a rotation, radians)
 * & its alpha
 * @param  {[number]} t [seconds]
 * @return {[object]} { drop, out, jolt, a }
 */
export function fall(t) {
	const ms = Math.max(0, t * 1000);
	if (ms < CRACK_MS) {
		const k = ms / CRACK_MS;
		// A snap outwards, and a shake that settles back to 0.
		return { drop: 0, out: SPLIT * Math.sqrt(k), jolt: 0.3 * Math.sin(3 * Math.PI * k), a: 1 };
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
 * @param  {[object]} opts [statusFx/index.js: { s, id, left, by, square, mode, slot, slots, mesh, root, squareRoot, reduce, cheap, fresh },
 * updated in place (update(0) follows a change to cheap)]
 * @return {[object]} { update(dt), burst(), animating(), dispose() }
 */
export function create(pieceMesh, opts) {
	// The crust is the piece's own geometry in clear ice, pulled a hair towards the camera (the material's polygon offset) so it coats
	// the wood. That geometry is shared, so it is never freed here.
	let cheap = !!opts.cheap;
	const crust = new Mesh(opts.mesh.geometry, crustMaterial(cheap));
	const dot = dotTexture();
	const specks = new BufferGeometry();
	specks.setAttribute("position", new Float32BufferAttribute(new Float32Array(RIME * 3), 3));
	const rime = new Points(specks, new PointsMaterial({ map: dot, color: 0xffffff, transparent: true, depthWrite: false }));
	// Its bounds would need a recompute on every refit.
	rime.frustumCulled = false;
	const mist = new Mesh(new PlaneGeometry(2, 2), new MeshBasicMaterial({
		map: dot, color: 0xdff4ff, transparent: true, depthWrite: false
	}));
	mist.rotation.x = -Math.PI / 2;
	const shardGeos = Array.from({ length: SHAPES }, (_, i) => shardGeometry(i));
	// Faceted and glossy, so the key light glints off its faces.
	const shardMat = new MeshStandardMaterial({
		color: ICE, roughness: 0.1, metalness: 0, flatShading: true, transparent: true, depthWrite: false
	});
	const shards = new Group();
	for (let i = 0; i < SHARDS; i++) { shards.add(new Mesh(shardGeos[i % SHAPES], shardMat)); }
	crust.name = "frozenCrust";
	rime.name = "frozenRime";
	mist.name = "frozenMist";
	shards.name = "frozenShards";
	opts.root.add(crust, rime, mist, shards);
	const ground = frostGround.make(pieceMesh, opts);
	opts.squareRoot.add(ground.object);
	const SETTLED = frostGround.SPREAD_S + frostGround.SETTLE_S;
	// The ground's running clock: the sum of every dt so far, never one frame's dt. Only a real freeze spreads the frost; after a load,
	// a reconnect or a mode switch it starts already settled.
	let groundT = opts.fresh ? 0 : SETTLED;
	let burstT = null, yLo = 0.2, yHi = 0.55, rLo = 0.35, rHi = 0.35;

	// Fits everything to the piece's shape and size: the crust's geometry, the rime on its surface and the shards at the piece's width
	// where they sit. A new mesh comes with update(0).
	function fit() {
		const geo = opts.mesh.geometry, box = geo.boundingBox, pos = geo.attributes.position;
		const top = box ? box.max.y : 1, half = box ? (box.max.x - box.min.x) / 2 : 0.35;
		crust.geometry = geo;
		yLo = top * 0.2;
		yHi = top * 0.55;
		rLo = radiusAt(pos, yLo, top * 0.08) || half;
		rHi = radiusAt(pos, yHi, top * 0.08) || half;
		const out = specks.attributes.position;
		for (let i = 0; i < RIME; i++) {
			// A prime stride through the vertices, so the specks spread over the piece instead of lining up in one row.
			const v = (i * 7919) % pos.count;
			// Just off the surface.
			out.setXYZ(i, pos.getX(v) * 1.02, pos.getY(v), pos.getZ(v) * 1.02);
		}
		out.needsUpdate = true;
		rime.material.size = pointSize(RIME_SIZE, opts.mesh);
		mist.scale.setScalar(half * 1.8);
		mist.position.y = 0.02;
	}

	// opts.cheap changed: swap the crust's material (freeing the old one), and halve or restore the specks and shards.
	function setCheap() {
		cheap = !!opts.cheap;
		crust.material.dispose();
		crust.material = crustMaterial(cheap);
		showCounts();
	}

	function showCounts() {
		const n = counts(cheap);
		specks.setDrawRange(0, n.rime);
		shards.children.forEach((s, i) => { s.visible = i < n.shards; });
		// The ground's mist replaces this haze, but the ground has no mist when cheap, so the haze shows only then.
		mist.visible = cheap;
	}

	function update(dt) {
		if (dt === 0) { fit(); }
		if (!!opts.cheap !== cheap) { setCheap(); }
		if (burstT !== null && !opts.reduce) { burstT += dt; }
		// Reduced motion holds the settled look, so turning it off later never replays the spread.
		groundT = opts.reduce ? Math.max(groundT, SETTLED) : groundT + dt;
		const fade = opts.mesh.userData.opacity ?? 1, f = fall(burstT ?? 0);
		if (burstT === null) { ground.update(groundT, opts); } else { ground.update(groundT, opts, f.a); }
		crust.material.opacity = CRUST_ALPHA * f.a * fade;
		rime.material.opacity = RIME_ALPHA * f.a * fade;
		mist.material.opacity = MIST_ALPHA * f.a * fade;
		shardMat.opacity = SHARD_ALPHA * f.a * fade;
		// A plain loop rather than a forEach, so no closure is made each frame.
		for (let i = 0; i < shards.children.length; i++) {
			const s = shards.children[i], up = i % 2, angle = (i / SHARDS) * 2 * Math.PI + 0.4,
				r = (up ? rHi : rLo) * 1.02 * (1 + 0.6 * f.out), y = (up ? yHi : yLo) * (1 - f.drop), j = up ? f.jolt : -f.jolt;
			s.position.set(Math.cos(angle) * r, y, Math.sin(angle) * r);
			// Pointing out and up from the crust, jolting as it cracks and tumbling as it falls.
			s.rotation.set(j, -angle, -0.9 - 1.6 * f.out + j);
		}
	}
	update(0);
	showCounts();

	return {
		update,
		burst() {
			if (opts.reduce) { return 0; }
			burstT = 0;
			return BURST_MS;
		},
		animating: () => (burstT !== null && !opts.reduce) || ground.animating(),
		// Also the burst's end: index.js disposes the effect once its BURST_MS have played.
		dispose() {
			ground.dispose();
			for (const o of [crust, rime, mist, shards]) { o.removeFromParent(); }
			for (const r of [crust.material, specks, rime.material, mist.geometry, mist.material, ...shardGeos, shardMat, dot]) {
				r.dispose();
			}
		},
	};
}
