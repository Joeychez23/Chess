// Status effect: Frozen (can't move). Frost-crusted: a see-through pale frost-blue layer in the piece's own shape over it, rime specks on its surface, ice shards on its sides & a still cold haze at its foot.
// When it ends (burst) the shards crack (split & jolt), then fall to the board as everything fades. All in opts.root (piece units), so it follows the lift, the drag & the drop.
// The piece's ice is still until the burst; the frost on its square (frostGround.js, opts.squareRoot) spreads & its mist settles, then no frames are asked for until the burst.
// Still under reduced motion & no burst then; no count (the badge shows the turns left). The foot haze here draws only when cheap (T24-R13: the ground's mist replaces it)
// T24: physical ice, not magic. A glossy crust (refractive MeshPhysicalMaterial, or a MeshStandardMaterial fake when opts.cheap) with a fresnel rim & a shared rime frost texture, chunky irregular shards. No bloom: ice does not glow
import { ConeGeometry, PlaneGeometry, BufferGeometry, Float32BufferAttribute, MeshBasicMaterial, MeshStandardMaterial, MeshPhysicalMaterial, PointsMaterial, DataTexture, RepeatWrapping, LinearFilter, Mesh, Points, Group } from "three";
import { dotTexture, pointSize } from "./warded.js"; // THE SAME SOFT ROUND DOT & POINT SIZE AS WARDED'S MOTES
import * as frostGround from "./frostGround.js"; // T24 S3b: THE FROST & COLD MIST ON THE SQUARE (opts.squareRoot)

export const BURST_MS = 700; // THE CRACK, THEN THE FALL
export const CRACK_MS = 150; // THE SHARDS SPLIT & JOLT IN PLACE BEFORE THEY FALL
const SPLIT = 0.12; // HOW FAR (OF THE WHOLE FLY-OFF) THE CRACK PUSHES THE SHARDS OUT
const SHARDS = 6; // ONE GEOMETRY & ONE MATERIAL FOR ALL: 16 FROZEN PIECES STAY CHEAP ON A PHONE
const RIME = 28, RIME_SIZE = 0.035; // SPECKS (ONE Points DRAW), PIECE UNITS ACROSS
const SHARD_ALPHA = 0.85, CRUST_ALPHA = 0.55, RIME_ALPHA = 0.8, MIST_ALPHA = 0.18;
const ICE = 0xcfeaff, ICE_IOR = 1.31, RIM = 0.6; // CLEAR PALE BLUE, WATER ICE'S INDEX, HOW BRIGHT THE GRAZING EDGES GO
const FROST_N = 64, CLEAR = 120; // FROST TEXTURE SIZE; ITS LOWEST VALUE (CLEAR ICE STILL TINTS, NEVER FULLY SEE-THROUGH)
const SHAPES = 3; // SHARD SHAPES PER PIECE, SHARED BY ITS SHARDS

/**
 * @description How many rime specks & shards draw: half (rounded up) when cheap
 * @param  {[boolean]} cheap [opts.cheap]
 * @return {[object]} { rime, shards }
 */
export function counts(cheap) {
	return cheap ? { rime: Math.ceil(RIME / 2), shards: Math.ceil(SHARDS / 2) } : { rime: RIME, shards: SHARDS };
}

const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }; // 0..1, THE SAME FOR THE SAME CELL
let frost = null;

/**
 * @description The rime frost texture: clear ice with white frost patches & specks, tiling. Built once & shared by every crust (alphaMap & roughnessMap: rime is whiter & rough, clear ice glossy), so never freed by a crust
 * @return {[DataTexture]}
 */
export function frostTexture() {
	if (frost) { return frost; }
	const n = FROST_N, cell = 8, data = new Uint8Array(n * n * 4);
	const noise = (x, y) => { // VALUE NOISE THAT WRAPS AT n, SO THE TEXTURE TILES
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

// A FRESNEL RIM: GRAZING EDGES GO BRIGHT & MORE OPAQUE, AS REAL ICE DOES (FADED BY opacity, SO IT FADES WITH THE PIECE)
function rim(shader) {
	shader.fragmentShader = shader.fragmentShader.replace("#include <opaque_fragment>", `float rim = pow( 1.0 - abs( dot( normal, normalize( vViewPosition ) ) ), 3.0 );
	outgoingLight += vec3( 0.85, 0.95, 1.0 ) * rim * ${RIM.toFixed(2)};
	diffuseColor.a = min( 1.0, diffuseColor.a + rim * 0.5 * opacity );
	#include <opaque_fragment>`);
}

// THE CRUST'S MATERIAL: REFRACTIVE (A TRANSMISSION PASS) ONLY WHEN NOT CHEAP. pieces.js'S MATERIALS STAY AS THEY ARE
function crustMaterial(cheap) {
	const base = { color: ICE, roughness: 0.12, metalness: 0, alphaMap: frostTexture(), roughnessMap: frostTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 };
	const m = cheap ? new MeshStandardMaterial(base) : new MeshPhysicalMaterial({ ...base, transmission: 0.9, thickness: 0.15, ior: ICE_IOR, specularIntensity: 1 });
	m.onBeforeCompile = rim;
	return m;
}

// A CHUNKY SHARD: A 5-SIDED CONE, ITS CORNERS PUSHED IN & OUT (THE SAME FOR THE SAME CORNER, SO NO SEAM OPENS), DIFFERENT FOR EACH seed
function shardGeometry(seed) {
	const g = new ConeGeometry(0.075, 0.2, 5, 1).toNonIndexed(), p = g.attributes.position; // A PLAIN BufferGeometry: NOT A CONE ANY MORE (ITS toJSON WOULD REBUILD THE PLAIN CONE)
	for (let i = 0; i < p.count; i++) {
		const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
		if (Math.hypot(x, z) < 1e-6) { continue; } // THE TIP & THE BASE CENTRE STAY
		const k = 0.65 + 0.7 * hash(Math.round(x * 1e4) + seed * 17, Math.round(z * 1e4) - seed * 31);
		p.setXYZ(i, x * k, y, z * (0.75 + 0.5 * hash(seed + 3, Math.round(x * 1e4))) * k);
	}
	g.computeVertexNormals();
	return g;
}

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
 * @param  {[object]} opts [statusFx/index.js: { s, id, left, by, square, mode, slot, slots, mesh, root, squareRoot, reduce, cheap, fresh }, updated in place (update(0) follows a change to cheap)]
 * @return {[object]} { update(dt), burst(), animating(), dispose() }
 */
export function create(pieceMesh, opts) {
	// THE CRUST: THE PIECE'S OWN (SHARED, SO NEVER FREED HERE) GEOMETRY IN CLEAR ICE, PULLED A HAIR TOWARDS THE CAMERA SO IT COATS THE WOOD
	let cheap = !!opts.cheap;
	const crust = new Mesh(opts.mesh.geometry, crustMaterial(cheap));
	const dot = dotTexture();
	const specks = new BufferGeometry();
	specks.setAttribute("position", new Float32BufferAttribute(new Float32Array(RIME * 3), 3));
	const rime = new Points(specks, new PointsMaterial({ map: dot, color: 0xffffff, transparent: true, depthWrite: false }));
	rime.frustumCulled = false; // ITS BOUNDS WOULD NEED A RECOMPUTE ON EVERY REFIT
	const mist = new Mesh(new PlaneGeometry(2, 2), new MeshBasicMaterial({ map: dot, color: 0xdff4ff, transparent: true, depthWrite: false }));
	mist.rotation.x = -Math.PI / 2;
	const shardGeos = Array.from({ length: SHAPES }, (_, i) => shardGeometry(i));
	const shardMat = new MeshStandardMaterial({ color: ICE, roughness: 0.1, metalness: 0, flatShading: true, transparent: true, depthWrite: false }); // FACETED, GLOSSY: THE KEY LIGHT GLINTS OFF ITS FACES
	const shards = new Group();
	for (let i = 0; i < SHARDS; i++) { shards.add(new Mesh(shardGeos[i % SHAPES], shardMat)); }
	crust.name = "frozenCrust"; rime.name = "frozenRime"; mist.name = "frozenMist"; shards.name = "frozenShards";
	opts.root.add(crust, rime, mist, shards);
	const ground = frostGround.make(pieceMesh, opts);
	opts.squareRoot.add(ground.object);
	const SETTLED = frostGround.SPREAD_S + frostGround.SETTLE_S;
	let groundT = opts.fresh ? 0 : SETTLED; // THE GROUND'S RUNNING CLOCK (T24-R1): THE SUM OF dt, NEVER A FRAME'S dt. ONLY A REAL FREEZE SPREADS; A LOAD, RECONNECT OR MODE SWITCH STARTS SETTLED (T24-R15)
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

	// opts.cheap CHANGED: SWAP THE CRUST'S MATERIAL (FREEING THE OLD), HALVE OR RESTORE THE SPECKS & SHARDS
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
		mist.visible = cheap; // T24-R13: THE GROUND'S MIST REPLACES THIS HAZE, BUT IT HAS NONE WHEN CHEAP
	}

	function update(dt) {
		if (dt === 0) { fit(); }
		if (!!opts.cheap !== cheap) { setCheap(); }
		if (burstT !== null && !opts.reduce) { burstT += dt; }
		groundT = opts.reduce ? Math.max(groundT, SETTLED) : groundT + dt; // REDUCE HOLDS THE SETTLED LOOK, SO TURNING IT OFF NEVER REPLAYS THE SPREAD (J2 REVIEW M1)
		const fade = opts.mesh.userData.opacity ?? 1, f = fall(burstT ?? 0);
		if (burstT === null) { ground.update(groundT, opts); } else { ground.update(groundT, opts, f.a); }
		crust.material.opacity = CRUST_ALPHA * f.a * fade;
		rime.material.opacity = RIME_ALPHA * f.a * fade;
		mist.material.opacity = MIST_ALPHA * f.a * fade;
		shardMat.opacity = SHARD_ALPHA * f.a * fade;
		for (let i = 0; i < shards.children.length; i++) { // A LOOP, NOT A CLOSURE A FRAME (T24 M4)
			const s = shards.children[i], up = i % 2, angle = (i / SHARDS) * 2 * Math.PI + 0.4, r = (up ? rHi : rLo) * 1.02 * (1 + 0.6 * f.out), y = (up ? yHi : yLo) * (1 - f.drop), j = up ? f.jolt : -f.jolt;
			s.position.set(Math.cos(angle) * r, y, Math.sin(angle) * r);
			s.rotation.set(j, -angle, -0.9 - 1.6 * f.out + j); // POINTING OUT & UP FROM THE CRUST, JOLTING AS IT CRACKS, TUMBLING AS IT FALLS
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
		dispose() { // ALSO THE BURST'S END: index.js DISPOSES ONCE ITS BURST_MS HAVE PLAYED
			ground.dispose();
			for (const o of [crust, rime, mist, shards]) { o.removeFromParent(); }
			for (const r of [crust.material, specks, rime.material, mist.geometry, mist.material, ...shardGeos, shardMat, dot]) { r.dispose(); }
		},
	};
}
