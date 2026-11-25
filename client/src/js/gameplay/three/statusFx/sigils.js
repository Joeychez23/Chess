// Enchantment rings (Task 22 S1, art/Enchantments/sigils-3d.html option B): a glowing hand-drawn ring round the piece's base in the enchantment's colour, three tiny copies of its
// simple-style glyph set into it, a gentle pulse, & its turns left as a small number beside it (none when opts.left is null). opts.s picks the enchantment: "heavy-cavalry" (bronze, 95
// Linked rings), "heretical-subjection" (violet, N4 Crescent and staff), "opposing-finality" (teal, 87 Ring and slash). All in opts.root, so it follows the lift, the drag & the drop.
// The contract & opts are statusFx/index.js's (see its @description)
import { Sprite, SpriteMaterial, Mesh, PlaneGeometry, MeshBasicMaterial, CanvasTexture, SRGBColorSpace, AdditiveBlending, DoubleSide } from "three";
import { CELL_SIZE } from "../constants.js";
import { badgeText } from "./badges.js";

export const PULSE_S = 3.5; // ONE GENTLE PULSE, SECONDS (THE MOCKUP'S sin(t * 1.8))
const ABOVE = 0.04; // THE RING'S HEIGHT OVER THE BASE (WORLD UNITS): OVER THE BOARD & MARKED'S SQUARE GLOW (0.02), FAR UNDER HEX'S RING (THE PIECE'S MIDDLE)
const NUMBER = 0.22; // THE NUMBER'S SIZE (PIECE UNITS)
const WIDER = 0.14; // RING SLOT 1 (THE SECOND ENCHANTMENT ON A PIECE) IS DRAWN THIS MUCH WIDER, CONCENTRIC, SO BOTH COLOURS SHOW (RULING T22-5)
const PX = 256, NUM_PX = 64; // THE RING'S & THE NUMBER'S CANVAS SIDES
const SPAN = 300; // THE MOCKUP'S RING CANVAS IN GLYPH UNITS: THE PLANE IS ONE SQUARE WIDE, THE GLYPHS' MIDDLES SIT 128 OUT
const PAL = {
	"heavy-cavalry": { halo: "rgba(140,80,20,", body: "rgba(215,140,60,", core: "rgba(255,228,185,", spark: "rgba(255,195,125,", glow: "rgb(230,150,60)" },
	"heretical-subjection": { halo: "rgba(90,40,150,", body: "rgba(165,110,230,", core: "rgba(238,220,255,", spark: "rgba(205,175,255,", glow: "rgb(170,110,240)" },
	"opposing-finality": { halo: "rgba(20,110,110,", body: "rgba(70,200,190,", core: "rgba(212,255,248,", spark: "rgba(150,240,230,", glow: "rgb(70,210,200)" },
};

/**
 * @description The ring's brightness at a time: 0.7 at t 0, up to 1 half a pulse in & back, the mockup's 0.85 + 0.15 sin range (1, still, under reduced motion)
 * @param  {[number]} t [seconds the effect has run]
 * @param  {[boolean]} reduce [prefers-reduced-motion]
 * @return {[number]} opacity, before the piece's fade
 */
export const sigilPulse = (t, reduce) => (reduce ? 1 : 0.7 + 0.3 * (1 - Math.cos((2 * Math.PI * t) / PULSE_S)) / 2);

// ---- THE BRUSH (art/Glyphs/simple/good-glyphs.html'S, AS shaken.js REBUILDS IT): A FILLED RIBBON IN THREE GLOW LAYERS ON A ROUGHENED PATH ----
const rnd = (a, b) => a + Math.random() * (b - a);
const sample = (fn, n) => Array.from({ length: n + 1 }, (_, i) => fn(i / n));
const arc = (cx, cy, r, a0, a1, n) => sample((t) => [cx + Math.cos(a0 + (a1 - a0) * t) * r, cy + Math.sin(a0 + (a1 - a0) * t) * r], n);
const seg = (ax, ay, bx, by, n) => sample((t) => [ax + (bx - ax) * t, ay + (by - ay) * t], n);
const bez = (p0, p1, p2, p3, n) => sample((t) => { const u = 1 - t; return [0, 1].map((k) => u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k]); }, n);
function normal(pts, i) {
	const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
	return [-dy / l, dx / l];
}
// A HAND'S WOBBLE: A SLOW DRIFT ALONG THE NORMAL & A LITTLE JITTER
function rough(pts, amt) {
	const f1 = rnd(0, 6), f2 = rnd(0, 6), k1 = rnd(2, 4), k2 = rnd(5, 9);
	return pts.map(([x, y], i) => {
		const t = i / pts.length, d = amt * (0.7 * Math.sin(t * k1 * Math.PI + f1) + 0.3 * Math.sin(t * k2 * Math.PI + f2)), [nx, ny] = normal(pts, i);
		return [x + nx * d + rnd(-0.4, 0.4), y + ny * d + rnd(-0.4, 0.4)];
	});
}
function ribbon(x, pts, w, taper) {
	const L = [], R = [], n = pts.length;
	pts.forEach((p, i) => {
		const t = i / (n - 1), swell = taper ? Math.pow(Math.sin(Math.PI * t), 0.55) : 1, ww = w * (0.35 + 0.65 * swell) * (0.85 + 0.3 * Math.sin(t * 9 + w)), [nx, ny] = normal(pts, i);
		L.push([p[0] + nx * ww, p[1] + ny * ww]);
		R.push([p[0] - nx * ww, p[1] - ny * ww]);
	});
	x.beginPath();
	x.moveTo(...L[0]);
	L.forEach((p) => x.lineTo(...p));
	R.reverse().forEach((p) => x.lineTo(...p));
	x.closePath();
	x.fill();
}
let pal = null; // THE PALETTE BEING PAINTED (drawRing SETS IT)
const k = PX / 512; // shadowBlur IGNORES THE TRANSFORM: THE MOCKUP'S BLURS ARE PX ON ITS 512 CANVAS
// ONE STROKE: A WIDE HALO, THE BODY, A HOT CORE, AN ENGRAVED LINE ON A HEAVY ONE, EMBER SPARKS
function stroke(x, pts, w, hair, taper = !hair) { // hair: A HAIRLINE (NO TAPER, NO ENGRAVING); taper: false FOR A CLOSED LOOP
	x.save();
	x.globalCompositeOperation = "lighter";
	x.shadowColor = pal.halo + "1)"; x.shadowBlur = 34 * k; x.fillStyle = pal.halo + "0.35)"; ribbon(x, pts, w * 2.6, taper);
	x.shadowBlur = 14 * k; x.fillStyle = pal.body + "0.85)"; ribbon(x, pts, w, taper);
	x.shadowBlur = 6 * k; x.shadowColor = pal.core + "1)"; x.fillStyle = pal.core + "0.95)"; ribbon(x, pts, w * 0.38, taper);
	x.restore();
	if (!hair && w > 4) {
		x.save();
		x.globalCompositeOperation = "destination-out";
		x.lineWidth = 1.1;
		x.strokeStyle = "rgba(0,0,0,0.55)";
		const off = pts.map((p, i) => { const [nx, ny] = normal(pts, i); return [p[0] + nx * w * 0.55, p[1] + ny * w * 0.55]; });
		x.beginPath();
		x.moveTo(...off[2]);
		off.slice(3, -3).forEach((p) => x.lineTo(...p));
		x.stroke();
		x.restore();
	}
	dots(x, pts, pts.length / 5, w * 2, 0.6, 2.2);
}
function dots(x, pts, n, spread, r0, r1) {
	x.save();
	x.globalCompositeOperation = "lighter";
	for (let i = 0; i < n; i++) {
		const p = pts[Math.floor(rnd(0, pts.length))];
		x.fillStyle = pal.spark + rnd(0.3, 0.9) + ")";
		x.beginPath();
		x.arc(p[0] + rnd(-spread, spread), p[1] + rnd(-spread, spread), rnd(r0, r1), 0, Math.PI * 2);
		x.fill();
	}
	x.restore();
}
// OVER/UNDER: CUT A GAP IN WHAT'S DRAWN WHERE A STRAND PASSES OVER IT, THEN DRAW THE STRAND
function over(x, pts, w) {
	x.save(); x.globalCompositeOperation = "destination-out"; x.lineWidth = w * 1.4 * 3.2; x.strokeStyle = "rgba(0,0,0,1)";
	x.beginPath(); x.moveTo(...pts[0]); pts.forEach((p) => x.lineTo(...p)); x.stroke(); x.restore();
	stroke(x, pts, w, true);
}
// SMALL BITES OUT OF THE EDGES SO IT FEELS CARVED & WORN
function chip(x, n) {
	x.save();
	x.globalCompositeOperation = "destination-out";
	for (let i = 0; i < n; i++) { x.fillStyle = `rgba(0,0,0,${rnd(0.2, 0.7)})`; x.beginPath(); x.arc(rnd(-150, 150), rnd(-150, 150), rnd(0.6, 2.6), 0, Math.PI * 2); x.fill(); }
	x.restore();
}

// THE GLYPHS IN THE MOCKUP'S UNITS (A 232 SQUARE, CENTRED): THE CODE OF good-glyphs.html 95 & 87 & shaken-core-picks.html N4
const GLYPHS = {
	"heavy-cavalry": (x) => {
		const A = rough(arc(-26, 6, 58, 0, 6.3, 100), 1.5), B = rough(arc(34, -8, 58, 0, 6.3, 100), 1.2);
		stroke(x, B.slice(0, 50), 2.2, true); stroke(x, A, 7.5, false, false); over(x, B.slice(48), 2.2); dots(x, B, 26, 6, 0.4, 1.8);
	},
	"heretical-subjection": (x) => {
		const s = rough(seg(-30, 112, 34, -112, 60), 1);
		stroke(x, s.slice(0, 30), 2.2, true); stroke(x, rough(arc(0, 0, 72, 0.95, 5.0, 80), 2), 8.5, false); over(x, s.slice(29), 2.2);
	},
	"opposing-finality": (x) => {
		stroke(x, rough(arc(0, 0, 76, 0, 6.3, 100), 1.5), 2.2, true); stroke(x, rough(bez([-90, 104], [-30, 30], [30, -30], [96, -110], 50), 3), 9.5, false);
	},
};

// THE RING ON A PX CANVAS: ONE ROUGH CIRCLE & THREE TINY GLYPHS ON IT, A THIRD OF A TURN APART
function drawRing(x, s) {
	pal = PAL[s];
	x.translate(PX / 2, PX / 2);
	x.scale(PX / SPAN, PX / SPAN);
	x.lineCap = x.lineJoin = "round";
	stroke(x, rough(arc(0, 0, 112, 0, 6.3, 160), 1.5), 5, false, false);
	for (let k = 0; k < 3; k++) { x.save(); x.rotate(k * Math.PI * 2 / 3 - Math.PI / 2); x.translate(0, -128); x.scale(0.17, 0.17); GLYPHS[s](x); x.restore(); }
	chip(x, 60);
}

// ONE RING TEXTURE PER ENCHANTMENT, SHARED BY EVERY RING OF IT (HERETICAL SUBJECTION RINGS EVERY BISHOP): PAINTED FOR THE FIRST USER, FREED WITH THE LAST
const shared = {}; // s -> { texture, users }
function useRing(s) {
	if (!shared[s]) {
		const canvas = document.createElement("canvas");
		canvas.width = canvas.height = PX;
		drawRing(canvas.getContext("2d"), s);
		const texture = new CanvasTexture(canvas);
		texture.colorSpace = SRGBColorSpace;
		shared[s] = { texture, users: 0 };
	}
	shared[s].users++;
	return shared[s].texture;
}
function dropRing(s) {
	if (!--shared[s].users) { shared[s].texture.dispose(); delete shared[s]; }
}

// THE TURNS LEFT, AS hex.js DRAWS THEM (COPIED: ITS drawNumber IS PRIVATE & GREEN) IN THE ENCHANTMENT'S GLOW
function drawNumber(x, text, glow) {
	x.clearRect(0, 0, NUM_PX, NUM_PX);
	x.font = "bold 42px Georgia, serif";
	x.textAlign = "center";
	x.textBaseline = "middle";
	x.shadowColor = glow;
	x.shadowBlur = 8;
	x.fillStyle = "#fff";
	x.fillText(text, NUM_PX / 2, NUM_PX / 2 + 2);
}

/**
 * @description One enchantment's ring on one piece (statusFx/index.js calls it, never anything else)
 * @param  {[Mesh]} pieceMesh [unused: opts.mesh is the current one]
 * @param  {[object]} opts [statusFx/index.js: { s (the enchantment's base key), left, siblings, ringSlot (0 inner, 1 outer; missing = 0), ringSlots, mesh, root, reduce, ... }, updated in place]
 * @return {[object]} { update(dt), burst(), animating(), dispose() }
 */
export function create(pieceMesh, opts) {
	const s = opts.s, map = useRing(s);
	const ring = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map, transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide })); // A LIFTED PIECE CAN SHOW ITS UNDERSIDE
	ring.rotation.x = -Math.PI / 2;
	const canvas = document.createElement("canvas");
	canvas.width = canvas.height = NUM_PX;
	const numCtx = canvas.getContext("2d"), numMap = new CanvasTexture(canvas);
	numMap.colorSpace = SRGBColorSpace;
	const number = new Sprite(new SpriteMaterial({ map: numMap, transparent: true, depthWrite: false }));
	number.scale.setScalar(NUMBER);
	opts.root.add(ring, number);
	let t = 0, text = null, gone = false; // text: THE NUMBER DRAWN, gone: DISPOSED
	function update(dt) {
		if (!opts.reduce) { t += dt; }
		const box = opts.mesh.geometry && opts.mesh.geometry.boundingBox, base = box ? box.min.y : 0, scale = opts.mesh.scale.y || 1; // THE ROOT IS IN PIECE UNITS
		const slot = opts.ringSlot || 0, side = (CELL_SIZE / scale) * (1 + WIDER * slot), fade = opts.mesh.userData.opacity ?? 1;
		const shift = (side * 128 / SPAN + NUMBER * 0.4) / NUMBER, left = (opts.siblings || []).includes("hexed"); // HEX'S NUMBER SITS RIGHT OF THE PIECE (hex.js): OURS GOES LEFT (RULING T22-4)
		ring.scale.setScalar(side);
		ring.rotation.z = slot * Math.PI / 3; // RING SLOT 1 TURNED 60 DEG: ITS THREE GLYPHS LAND BETWEEN SLOT 0'S INSTEAD OF OVER THEM
		ring.position.y = base + ABOVE / scale;
		ring.material.opacity = sigilPulse(t, opts.reduce) * fade;
		number.position.y = base + ABOVE / scale + NUMBER / 2;
		number.center.set(left ? 0.5 + shift : 0.5 - shift, 0.5 - slot); // A SCREEN-SPACE SHIFT (AS hex.js): BESIDE THE RING HOWEVER THE PIECE OR CAMERA TURNS; RING SLOT 1'S ONE NUMBER HIGHER, CLEAR OF SLOT 0'S
		number.material.opacity = fade;
		const next = badgeText(opts.left);
		if (next !== text) {
			text = next;
			if (text) { drawNumber(numCtx, text, PAL[s].glow); numMap.needsUpdate = true; }
			number.visible = text !== "";
		}
	}
	update(0);
	return {
		update,
		burst: () => 0, // AN ENDING ENCHANTMENT JUST GOES
		animating: () => !opts.reduce, // ALWAYS, EVEN FOR A RING WITH NO END (HEAVY CAVALRY, OPPOSING FINALITY): IT KEEPS PULSING AS WARDED & HEX DO (RULING T22-7)
		dispose() {
			if (gone) { return; } // A SECOND DISPOSE MUST NOT DROP A TWIN'S SHARE OF THE TEXTURE
			gone = true;
			ring.removeFromParent();
			number.removeFromParent();
			ring.geometry.dispose();
			ring.material.dispose();
			number.material.dispose();
			numMap.dispose();
			dropRing(s);
		},
	};
}
