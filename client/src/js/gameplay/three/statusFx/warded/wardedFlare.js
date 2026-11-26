// Warded's flare (Task 24 S2c): a short one-off when the ward comes or goes. play("gain"): a gold ring rising & widening from the foot with a brief bright pulse;
// play("lose"): the glow breaking outward in gold shards & fading. Idle it is hidden & update returns at once. Under reduced motion no flare at all (T24-R3). In piece units (opts.root)
import { Group, RingGeometry, SphereGeometry, BufferGeometry, Float32BufferAttribute, MeshBasicMaterial, PointsMaterial, Mesh, Points, AdditiveBlending, BackSide, DoubleSide } from "three";
import { BLOOM_LAYER } from "../../constants.js";
import { dotTexture, pointSize } from "./warded.js";

export const FLARE_MS = 600; // HOW LONG ONE FLARE PLAYS
export const SHARDS = 12; // ONE Points DRAW
const SHARD_SIZE = 0.07; // PIECE UNITS ACROSS
// SHARED BY EVERY PIECE'S FLARE, NEVER FREED (LIKE THE BOARD'S OWN)
let ring, glow, dot, dirs;
function shared() {
	if (ring) { return; }
	ring = new RingGeometry(0.8, 1, 40).rotateX(-Math.PI / 2); // FLAT ON THE BOARD
	glow = new SphereGeometry(1, 12, 8);
	dot = dotTexture();
	dirs = new Float32Array(SHARDS * 3);
	for (let i = 0; i < SHARDS; i++) { const a = i * 2.399, up = 0.25 + 0.5 * ((i * 0.618) % 1); dirs.set([Math.cos(a), up, Math.sin(a)], i * 3); } // GOLDEN ANGLE: SPREAD ALL ROUND, SOME HIGHER
}

/**
 * @description How many shards a lose draws
 * @param  {[boolean]} cheap [opts.cheap]
 * @return {[number]} all of them, or half (rounded up, at least 1) when cheap
 */
export const shardCount = (cheap) => (cheap ? Math.max(1, Math.ceil(SHARDS / 2)) : SHARDS);

const easeOut = (p) => 1 - (1 - p) ** 2;

/**
 * @description The flare's look at progress p. Sizes & heights are fractions of the piece (ringY of its top, ringScale & shardR of its half width, glowScale of the aura's size)
 * @param  {[string]} kind ["gain" | "lose"]
 * @param  {[number]} p [0..1 through FLARE_MS]
 * @param  {[object]} out [optional: filled & returned, so a frame allocates nothing]
 * @return {[object]} { ringY, ringScale, ringA, glowA, glowScale, shardR, shardA }
 */
export function flareLook(kind, p, out = {}) {
	const q = 1 - p;
	out.ringY = 0; out.ringScale = 1; out.ringA = 0; out.glowScale = 1; out.shardR = 0; out.shardA = 0;
	if (kind === "gain") {
		out.ringY = 0.9 * easeOut(p); out.ringScale = 1 + 1.6 * p; out.ringA = q * Math.min(1, p * 8);
		out.glowA = 0.9 * Math.exp(-(((p - 0.2) / 0.12) ** 2)) * q; out.glowScale = 1 + 0.3 * p; // THE BRIEF BRIGHT PULSE
	} else {
		out.ringY = 0.4; out.ringScale = 1 + 2.5 * p; out.ringA = 0.7 * q * q;
		out.glowA = 0.6 * q * q; out.glowScale = 1 + 1.2 * p; out.shardR = 0.5 + 2.5 * easeOut(p); out.shardA = q;
	}
	return out;
}

/**
 * @description Warded's flare on one piece (warded.js adds object to opts.root & calls play when the ward comes or goes)
 * @param  {[Mesh]} pieceMesh [unused: opts.mesh is the current one]
 * @param  {[object]} opts [the live status's opts: mesh, reduce, cheap]
 * @return {[object]} { object, play(kind), update(t, opts), dispose() }
 */
export function make(pieceMesh, opts) {
	const object = new Group();
	object.name = "wardedFlare";
	object.visible = false;
	const look = {};
	let kind = null, start = null, ringMesh, glowMesh, shards, pts, parts;

	function build() { // ON THE FIRST play: MOST WARDED PIECES NEVER FLARE
		shared();
		const add = { transparent: true, blending: AdditiveBlending, depthWrite: false, fog: false }; // fog: SEE wardedMotes.js
		ringMesh = new Mesh(ring, new MeshBasicMaterial({ color: 0xffd76a, side: DoubleSide, ...add }));
		glowMesh = new Mesh(glow, new MeshBasicMaterial({ color: 0xfff0b8, side: BackSide, ...add }));
		pts = new BufferGeometry();
		pts.setAttribute("position", new Float32BufferAttribute(new Float32Array(SHARDS * 3), 3));
		shards = new Points(pts, new PointsMaterial({ map: dot, color: 0xffe08a, ...add }));
		shards.frustumCulled = false; // ITS BOUNDS WOULD NEED A RECOMPUTE EVERY FRAME
		ringMesh.name = "wardedFlareRing"; glowMesh.name = "wardedFlareGlow"; shards.name = "wardedFlareShards";
		parts = [ringMesh, glowMesh, shards];
		object.add(...parts);
	}
	const stop = () => { kind = null; object.visible = false; };

	function update(t, o = opts) {
		if (!kind) { return; } // IDLE: NOTHING TO DO
		if (o.reduce) { stop(); return; } // T24-R3: REDUCE DROPS THE FLARE AT ONCE
		if (start === null) { start = t; }
		const p = ((t - start) * 1000) / FLARE_MS;
		if (p >= 1) { stop(); return; }
		const box = o.mesh.geometry && o.mesh.geometry.boundingBox;
		const top = box ? box.max.y : 1, half = box ? (box.max.x - box.min.x) / 2 : 0.35, fade = o.mesh.userData.opacity ?? 1;
		flareLook(kind, Math.max(0, p), look);
		object.visible = true;
		ringMesh.position.y = look.ringY * top;
		ringMesh.scale.setScalar(look.ringScale * half);
		ringMesh.material.opacity = look.ringA * fade;
		ringMesh.visible = look.ringA > 0;
		glowMesh.position.y = top / 2;
		glowMesh.scale.set(half * 1.35 * look.glowScale, top * 0.62 * look.glowScale, half * 1.35 * look.glowScale);
		glowMesh.material.opacity = look.glowA * fade;
		shards.visible = look.shardA > 0;
		shards.material.opacity = look.shardA * fade;
		shards.material.size = pointSize(SHARD_SIZE, o.mesh);
		const n = shardCount(o.cheap), pos = pts.attributes.position;
		pts.setDrawRange(0, n);
		for (let i = 0; i < n; i++) { pos.setXYZ(i, dirs[i * 3] * look.shardR * half, top * 0.5 + dirs[i * 3 + 1] * look.shardR * half, dirs[i * 3 + 2] * look.shardR * half); }
		pos.needsUpdate = true;
		for (const m of parts) { if (o.cheap) { m.layers.disable(BLOOM_LAYER); } else { m.layers.enable(BLOOM_LAYER); } }
	}

	return {
		object,
		/** @param {[string]} k ["gain" | "lose"]: starts on the next update, a replay restarts it; anything else, or reduce on, does nothing */
		play(k) {
			if ((k !== "gain" && k !== "lose") || opts.reduce) { return; }
			if (!parts) { build(); }
			kind = k; start = null;
		},
		update,
		dispose() {
			object.removeFromParent();
			stop(); // A LATE update AFTER dispose IS THEN A NO-OP (RE-REVIEW N1)
			if (!parts) { return; }
			for (const m of parts) { m.material.dispose(); }
			pts.dispose();
			parts = null;
		},
	};
}
