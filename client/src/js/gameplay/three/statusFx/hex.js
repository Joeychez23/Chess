// Status effect: Hexed, no card moves it (Task 21 S7, art/Hex option 2): a thin poison-green rune ring floating level round the piece's middle, turning slowly & pulsing,
// & its turns left low at the front-right of its foot (ruling R19; none when permanent, ruling Q2). Both follow the piece (opts.root). The contract & opts are statusFx/index.js's (see its @description)
import { Sprite, SpriteMaterial, Mesh, PlaneGeometry, MeshBasicMaterial, CanvasTexture, SRGBColorSpace, AdditiveBlending, DoubleSide } from "three";
import { badgeText } from "./badges.js";

export const SPIN = 0.4; // THE RING'S TURN (RADIANS A SECOND)
const RING = 1.2; // THE RING PLANE'S SIDE, IN PIECE FOOT WIDTHS (THE DRAWN CIRCLE IS 0.78 OF IT)
const FOOT = 0.68; // A FOOT'S WIDTH (PIECE UNITS) WHEN THE MESH HAS NO BOX
const NUMBER = 0.2; // THE NUMBER'S SIZE (PIECE UNITS)
const LOW = 0.2; // THE NUMBER'S HEIGHT OVER THE FOOT, IN FOOT WIDTHS (THE MOCKUP'S 0.45 ON A 2.2 FOOT)
const GROW = 0.4; // HOW MUCH WIDER THE RING GETS AS THE BURST FADES IT
const BURST_MS = 400;
const GREEN = "#7ee05a";
const PX = 64; // THE NUMBER'S CANVAS SIDE

/**
 * @description The look at a time: the ring's turn & its opacity (still under reduced motion)
 * @param  {[number]} t [seconds the effect has run]
 * @param  {[boolean]} reduce [prefers-reduced-motion]
 * @return {[object]} { spin (radians), pulse (opacity) }
 */
export function hexLook(t, reduce) {
	if (reduce) { return { spin: 0, pulse: 1 }; }
	return { spin: t * SPIN, pulse: 0.75 + 0.25 * Math.sin(t * 2.4) };
}

function canvasTexture(px, draw) {
	const canvas = document.createElement("canvas");
	canvas.width = canvas.height = px;
	const ctx = canvas.getContext("2d");
	if (draw) { draw(ctx); }
	const texture = new CanvasTexture(canvas);
	texture.colorSpace = SRGBColorSpace;
	return { ctx, texture };
}

// THE RING ON A 256 CANVAS: ONE THIN CIRCLE & SIX ARROW RUNES ON ITS OUTSIDE, A GREEN HALO
function drawRing(x) {
	x.translate(128, 128);
	x.strokeStyle = "#a6ff86";
	x.shadowColor = GREEN;
	x.shadowBlur = 9;
	x.lineCap = "round";
	x.lineWidth = 3;
	x.beginPath();
	x.arc(0, 0, 100, 0, Math.PI * 2);
	x.stroke();
	x.lineWidth = 2;
	for (let k = 0; k < 6; k++) {
		x.save();
		x.rotate(k * Math.PI / 3);
		x.beginPath();
		x.moveTo(-7, -116);
		x.lineTo(0, -107);
		x.lineTo(7, -116);
		x.moveTo(0, -122);
		x.lineTo(0, -107);
		x.stroke();
		x.restore();
	}
}

function drawNumber(x, text) {
	x.clearRect(0, 0, PX, PX);
	x.font = "bold 42px Georgia, serif";
	x.textAlign = "center";
	x.textBaseline = "middle";
	x.shadowColor = GREEN;
	x.shadowBlur = 8;
	x.fillStyle = "#fff";
	x.fillText(text, PX / 2, PX / 2 + 2);
}

/**
 * @description The effect on one piece (statusFx/index.js calls it, never anything else)
 * @param  {[Mesh]} pieceMesh [the piece's mesh when made: read opts.mesh later, the frame may move the effect onto another mesh]
 * @param  {[object]} opts [statusFx/index.js: { s, id, left, by, square, mode, slot, slots, mesh, root, squareRoot, reduce }, updated in place]
 * @return {[object]} { update(dt), burst(), animating(), dispose() }
 */
export function create(pieceMesh, opts) {
	const ringMap = canvasTexture(256, drawRing).texture, num = canvasTexture(PX);
	const ring = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: ringMap, transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide })); // A LIFTED PIECE CAN SHOW ITS UNDERSIDE
	ring.rotation.x = -Math.PI / 2;
	const number = new Sprite(new SpriteMaterial({ map: num.texture, transparent: true, depthWrite: false }));
	number.scale.setScalar(NUMBER);
	opts.root.add(ring, number);
	let t = 0, burstAt = null, text = null; // burstAt: t WHEN THE BURST STARTED, text: THE NUMBER DRAWN
	function update(dt) {
		t += dt;
		const look = hexLook(t, opts.reduce), k = burstAt === null ? 0 : Math.min(1, (t - burstAt) * 1000 / BURST_MS);
		const fade = (opts.mesh.userData.opacity ?? 1) * (1 - k), box = opts.mesh.geometry && opts.mesh.geometry.boundingBox;
		const foot = box ? box.max.x - box.min.x : FOOT, base = box ? box.min.y : 0;
		ring.scale.setScalar(foot * RING * (1 + k * GROW));
		ring.position.y = (base + (box ? box.max.y : 1)) / 2;
		number.position.y = base + foot * LOW;
		ring.rotation.z = look.spin;
		ring.material.opacity = look.pulse * fade;
		number.material.opacity = fade;
		number.center.set(0.5 - (foot / 2 + NUMBER * 0.4) / NUMBER, 0.5); // A SCREEN-SPACE SHIFT: THE NUMBER SITS RIGHT OF THE FOOT, CLEAR OF IT, HOWEVER THE PIECE OR CAMERA TURNS
		const next = badgeText(opts.left);
		if (next !== text) {
			text = next;
			if (text) { drawNumber(num.ctx, text); num.texture.needsUpdate = true; }
			number.visible = text !== "";
		}
	}
	update(0);
	return {
		update,
		burst() { burstAt = t; return BURST_MS; },
		animating: () => !opts.reduce,
		dispose() {
			ring.removeFromParent();
			number.removeFromParent();
			ring.geometry.dispose();
			ring.material.dispose();
			number.material.dispose();
			ringMap.dispose();
			num.texture.dispose();
		},
	};
}
