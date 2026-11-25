// Status effect: Marked (Task 21 S7, art/Marked option 1): a small glowing red skull floating over the piece's head, bobbing gently, & a faint red glow pulsing on its square.
// While the piece is also Shaken the skull is the core of Shaken's centre cage instead (ruling 09:19, shaken.js), so the floating one isn't drawn; the glow stays.
// The skull follows the piece (opts.root), the glow stays on the server view's square (opts.squareRoot). The contract & opts are statusFx/index.js's (see its @description)
import { Sprite, SpriteMaterial, Mesh, PlaneGeometry, MeshBasicMaterial, CanvasTexture, SRGBColorSpace, AdditiveBlending } from "three";
import { CELL_SIZE } from "../constants.js";

export const BOB = 0.025; // HOW FAR THE SKULL BOBS (PIECE UNITS)
export const GLOW = 0.4; // THE SQUARE GLOW'S MIDDLE OPACITY
export const PULSE = 0.15; // HOW FAR IT PULSES EACH WAY
const SKULL = 0.28; // THE SKULL'S SIZE (PIECE UNITS)
const OVER = 0.25; // ITS MIDDLE OVER THE PIECE'S TOP (PIECE UNITS)
const RISE = 0.15; // HOW FAR IT RISES AS THE BURST FADES IT (PIECE UNITS)
const GLOW_SIZE = CELL_SIZE * 1.05; // THE GLOW'S SIDE (WORLD UNITS): A LITTLE OVER ITS SQUARE, IT FADES OUT BEFORE THE EDGE
const BURST_MS = 400;
const RED = "#d8262b";

/**
 * @description The look at a time: the skull's bob & the glow's opacity (still under reduced motion)
 * @param  {[number]} t [seconds the effect has run]
 * @param  {[boolean]} reduce [prefers-reduced-motion]
 * @return {[object]} { bob (piece units), glow (opacity) }
 */
export function markedLook(t, reduce) {
	if (reduce) { return { bob: 0, glow: GLOW }; }
	return { bob: Math.sin(t * 2) * BOB, glow: GLOW + PULSE * Math.sin(t * 2.5) };
}

/**
 * @description A new texture of the skull (Shaken's centre cage shows it as its core while the piece is also Marked, ruling 09:19). Its user disposes it
 * @return {[CanvasTexture]}
 */
export const skullMap = () => canvasTexture(128, drawSkull);

function canvasTexture(px, draw) {
	const canvas = document.createElement("canvas");
	canvas.width = canvas.height = px;
	draw(canvas.getContext("2d"));
	const texture = new CanvasTexture(canvas);
	texture.colorSpace = SRGBColorSpace;
	return texture;
}

// A SKULL ON A 128 CANVAS: CRANIUM & JAW, EYES, NOSE & TEETH CUT OUT, A RED HALO
function drawSkull(x) {
	x.translate(64, 64);
	x.shadowColor = RED;
	x.shadowBlur = 14;
	x.fillStyle = "#ff5048";
	x.beginPath();
	x.ellipse(0, -10, 40, 38, 0, 0, Math.PI * 2);
	x.fill();
	x.fillRect(-21, 14, 42, 22);
	x.globalCompositeOperation = "destination-out";
	x.beginPath();
	x.ellipse(-15, -7, 10, 11, 0, 0, Math.PI * 2);
	x.ellipse(15, -7, 10, 11, 0, 0, Math.PI * 2);
	x.fill();
	x.beginPath();
	x.moveTo(0, 6);
	x.lineTo(-5, 15);
	x.lineTo(5, 15);
	x.fill();
	for (let k = -1; k <= 1; k++) { x.fillRect(k * 10 - 2, 25, 4, 11); }
}

function drawGlow(x) {
	const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
	g.addColorStop(0, "rgba(255,90,80,0.9)");
	g.addColorStop(0.35, "rgba(220,30,30,0.45)");
	g.addColorStop(1, "rgba(120,0,0,0)");
	x.fillStyle = g;
	x.fillRect(0, 0, 64, 64);
}

/**
 * @description The effect on one piece (statusFx/index.js calls it, never anything else)
 * @param  {[Mesh]} pieceMesh [the piece's mesh when made: read opts.mesh later, the frame may move the effect onto another mesh]
 * @param  {[object]} opts [statusFx/index.js: { s, id, left, by, square, mode, slot, slots, siblings, mesh, root, squareRoot, reduce }, updated in place]
 * @return {[object]} { update(dt), burst(), animating(), dispose() }
 */
export function create(pieceMesh, opts) {
	const skullTexture = skullMap(), glowTexture = canvasTexture(64, drawGlow);
	const skull = new Sprite(new SpriteMaterial({ map: skullTexture, transparent: true, depthWrite: false, blending: AdditiveBlending }));
	skull.scale.setScalar(SKULL);
	const glow = new Mesh(new PlaneGeometry(GLOW_SIZE, GLOW_SIZE), new MeshBasicMaterial({ map: glowTexture, transparent: true, depthWrite: false, blending: AdditiveBlending }));
	glow.rotation.x = -Math.PI / 2;
	glow.position.y = 0.02; // JUST OVER THE BOARD
	opts.root.add(skull);
	opts.squareRoot.add(glow);
	let t = 0, burstAt = null; // burstAt: t WHEN THE BURST STARTED
	function update(dt) {
		t += dt;
		const look = markedLook(t, opts.reduce), k = burstAt === null ? 0 : Math.min(1, (t - burstAt) * 1000 / BURST_MS);
		const fade = (opts.mesh.userData.opacity ?? 1) * (1 - k), box = opts.mesh.geometry && opts.mesh.geometry.boundingBox;
		skull.position.y = (box ? box.max.y : 1) + OVER + look.bob + k * RISE;
		skull.material.opacity = fade;
		skull.visible = !opts.siblings.includes("shaken");
		glow.material.opacity = look.glow * fade;
	}
	update(0);
	return {
		update,
		burst() { burstAt = t; return BURST_MS; },
		animating: () => !opts.reduce,
		dispose() {
			skull.removeFromParent();
			glow.removeFromParent();
			skull.material.dispose();
			glow.geometry.dispose();
			glow.material.dispose();
			skullTexture.dispose();
			glowTexture.dispose();
		},
	};
}
