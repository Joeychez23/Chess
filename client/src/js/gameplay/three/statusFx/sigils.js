// Enchantment rings (art/Enchantments/sigils-3d.html, option B): a glowing hand-drawn ring round the piece's base in the
// enchantment's colour, three tiny copies of its simple-style glyph set into it, a gentle pulse, and its turns left as a small
// number beside it (none when opts.left is null). opts.s picks the enchantment: "heavy-cavalry" (bronze, 95 Linked rings),
// "heretical-subjection" (violet, N4 Crescent and staff), "opposing-finality" (teal, 87 Ring and slash). All in opts.root,
// so it follows the lift, the drag and the drop. The contract and opts are statusFx/index.js's (see its @description)
import { Sprite, SpriteMaterial, Mesh, PlaneGeometry, MeshBasicMaterial, CanvasTexture, SRGBColorSpace, AdditiveBlending,
	DoubleSide } from "three";
import { CELL_SIZE } from "../constants.js";
import { badgeText } from "./badges.js";

// One gentle pulse, seconds (the mockup's sin(t * 1.8))
export const PULSE_S = 3.5;
// The ring's height over the base (world units): over the board and Marked's square glow (0.02), far under Hex's ring
// (the piece's middle)
const RING_LIFT = 0.04;
// The number's size (piece units)
const NUMBER_SIZE = 0.22;
// Ring slot 1 (the second enchantment on a piece) is drawn this much wider, concentric, so both colours show
const SECOND_RING_EXTRA = 0.14;
// The ring's and the number's canvas sides
const RING_CANVAS_PX = 256;
const NUMBER_CANVAS_PX = 64;
// The mockup's ring canvas in glyph units: the plane is one square wide, the glyphs' middles sit 128 out
const MOCKUP_SPAN = 300;
const RING_COLORS = {
	"heavy-cavalry": {
		halo: "rgba(140,80,20,", body: "rgba(215,140,60,", core: "rgba(255,228,185,", spark: "rgba(255,195,125,", glow: "rgb(230,150,60)",
	},
	"heretical-subjection": {
		halo: "rgba(90,40,150,", body: "rgba(165,110,230,", core: "rgba(238,220,255,", spark: "rgba(205,175,255,", glow: "rgb(170,110,240)",
	},
	"opposing-finality": {
		halo: "rgba(20,110,110,", body: "rgba(70,200,190,", core: "rgba(212,255,248,", spark: "rgba(150,240,230,", glow: "rgb(70,210,200)",
	},
};

/**
 * @description The ring's brightness at a time: 0.7 at t 0, up to 1 half a pulse in and back, the mockup's 0.85 + 0.15 sin range
 * (1, still, under reduced motion)
 * @param  {[number]} t [seconds the effect has run]
 * @param  {[boolean]} reduce [prefers-reduced-motion]
 * @return {[number]} opacity, before the piece's fade
 */
export function sigilPulse(t, reduce) {
	return reduce ? 1 : 0.7 + 0.3 * (1 - Math.cos((2 * Math.PI * t) / PULSE_S)) / 2;
}

/* ---- The brush ---- */
// art/Glyphs/simple/good-glyphs.html's brush, as shaken.js rebuilds it: a filled ribbon in three glow layers on a roughened path

function rnd(a, b) {
	return a + Math.random() * (b - a);
}

function sample(fn, n) {
	return Array.from({ length: n + 1 }, (_, i) => fn(i / n));
}

function arc(cx, cy, r, a0, a1, n) {
	return sample((t) => [cx + Math.cos(a0 + (a1 - a0) * t) * r, cy + Math.sin(a0 + (a1 - a0) * t) * r], n);
}

function seg(ax, ay, bx, by, n) {
	return sample((t) => [ax + (bx - ax) * t, ay + (by - ay) * t], n);
}

// A cubic Bézier from p0 to p3
function bez(p0, p1, p2, p3, n) {
	return sample(function (t) {
		const u = 1 - t;
		return [0, 1].map((axis) => u * u * u * p0[axis] + 3 * u * u * t * p1[axis] + 3 * u * t * t * p2[axis] + t * t * t * p3[axis]);
	}, n);
}

function normal(pts, i) {
	const a = pts[Math.max(0, i - 1)];
	const b = pts[Math.min(pts.length - 1, i + 1)];
	const dx = b[0] - a[0];
	const dy = b[1] - a[1];
	const length = Math.hypot(dx, dy) || 1;
	return [-dy / length, dx / length];
}

// A hand's wobble: a slow drift along the normal and a little jitter
function rough(pts, amount) {
	const phase1 = rnd(0, 6);
	const phase2 = rnd(0, 6);
	const waves1 = rnd(2, 4);
	const waves2 = rnd(5, 9);
	return pts.map(([x, y], i) => {
		const t = i / pts.length;
		const drift = amount * (0.7 * Math.sin(t * waves1 * Math.PI + phase1) + 0.3 * Math.sin(t * waves2 * Math.PI + phase2));
		const [nx, ny] = normal(pts, i);
		return [x + nx * drift + rnd(-0.4, 0.4), y + ny * drift + rnd(-0.4, 0.4)];
	});
}

function ribbon(ctx, pts, width, taper) {
	const left = [];
	const right = [];
	const n = pts.length;
	pts.forEach((p, i) => {
		const t = i / (n - 1);
		const swell = taper ? Math.pow(Math.sin(Math.PI * t), 0.55) : 1;
		const halfWidth = width * (0.35 + 0.65 * swell) * (0.85 + 0.3 * Math.sin(t * 9 + width));
		const [nx, ny] = normal(pts, i);
		left.push([p[0] + nx * halfWidth, p[1] + ny * halfWidth]);
		right.push([p[0] - nx * halfWidth, p[1] - ny * halfWidth]);
	});
	ctx.beginPath();
	ctx.moveTo(...left[0]);
	left.forEach((p) => ctx.lineTo(...p));
	right.reverse().forEach((p) => ctx.lineTo(...p));
	ctx.closePath();
	ctx.fill();
}

// The palette being painted (drawRing sets it)
let colors = null;
// shadowBlur ignores the transform: the mockup's blurs are px on its 512 canvas
const MOCKUP_SCALE = RING_CANVAS_PX / 512;

// One stroke: a wide halo, the body, a hot core, an engraved line on a heavy one, ember sparks.
// hair: a hairline (no taper, no engraving); taper: false for a closed loop
function stroke(ctx, pts, width, hair, taper = !hair) {
	ctx.save();
	ctx.globalCompositeOperation = "lighter";
	ctx.shadowColor = colors.halo + "1)";
	ctx.shadowBlur = 34 * MOCKUP_SCALE;
	ctx.fillStyle = colors.halo + "0.35)";
	ribbon(ctx, pts, width * 2.6, taper);
	ctx.shadowBlur = 14 * MOCKUP_SCALE;
	ctx.fillStyle = colors.body + "0.85)";
	ribbon(ctx, pts, width, taper);
	ctx.shadowBlur = 6 * MOCKUP_SCALE;
	ctx.shadowColor = colors.core + "1)";
	ctx.fillStyle = colors.core + "0.95)";
	ribbon(ctx, pts, width * 0.38, taper);
	ctx.restore();
	if (!hair && width > 4) {
		ctx.save();
		ctx.globalCompositeOperation = "destination-out";
		ctx.lineWidth = 1.1;
		ctx.strokeStyle = "rgba(0,0,0,0.55)";
		const offset = pts.map((p, i) => {
			const [nx, ny] = normal(pts, i);
			return [p[0] + nx * width * 0.55, p[1] + ny * width * 0.55];
		});
		ctx.beginPath();
		ctx.moveTo(...offset[2]);
		offset.slice(3, -3).forEach((p) => ctx.lineTo(...p));
		ctx.stroke();
		ctx.restore();
	}
	dots(ctx, pts, pts.length / 5, width * 2, 0.6, 2.2);
}

function dots(ctx, pts, n, spread, r0, r1) {
	ctx.save();
	ctx.globalCompositeOperation = "lighter";
	for (let i = 0; i < n; i++) {
		const p = pts[Math.floor(rnd(0, pts.length))];
		ctx.fillStyle = colors.spark + rnd(0.3, 0.9) + ")";
		ctx.beginPath();
		ctx.arc(p[0] + rnd(-spread, spread), p[1] + rnd(-spread, spread), rnd(r0, r1), 0, Math.PI * 2);
		ctx.fill();
	}
	ctx.restore();
}

// Over and under: cut a gap in what is drawn where a strand passes over it, then draw the strand
function over(ctx, pts, width) {
	ctx.save();
	ctx.globalCompositeOperation = "destination-out";
	ctx.lineWidth = width * 1.4 * 3.2;
	ctx.strokeStyle = "rgba(0,0,0,1)";
	ctx.beginPath();
	ctx.moveTo(...pts[0]);
	pts.forEach((p) => ctx.lineTo(...p));
	ctx.stroke();
	ctx.restore();
	stroke(ctx, pts, width, true);
}

// Small bites out of the edges so it feels carved and worn
function chip(ctx, n) {
	ctx.save();
	ctx.globalCompositeOperation = "destination-out";
	for (let i = 0; i < n; i++) {
		ctx.fillStyle = `rgba(0,0,0,${rnd(0.2, 0.7)})`;
		ctx.beginPath();
		ctx.arc(rnd(-150, 150), rnd(-150, 150), rnd(0.6, 2.6), 0, Math.PI * 2);
		ctx.fill();
	}
	ctx.restore();
}

// The glyphs in the mockup's units (a 232 square, centred): the code of good-glyphs.html 95 and 87 and shaken-core-picks.html N4
const GLYPHS = {
	"heavy-cavalry": function (ctx) {
		const ringA = rough(arc(-26, 6, 58, 0, 6.3, 100), 1.5);
		const ringB = rough(arc(34, -8, 58, 0, 6.3, 100), 1.2);
		stroke(ctx, ringB.slice(0, 50), 2.2, true);
		stroke(ctx, ringA, 7.5, false, false);
		over(ctx, ringB.slice(48), 2.2);
		dots(ctx, ringB, 26, 6, 0.4, 1.8);
	},
	"heretical-subjection": function (ctx) {
		const staff = rough(seg(-30, 112, 34, -112, 60), 1);
		stroke(ctx, staff.slice(0, 30), 2.2, true);
		stroke(ctx, rough(arc(0, 0, 72, 0.95, 5.0, 80), 2), 8.5, false);
		over(ctx, staff.slice(29), 2.2);
	},
	"opposing-finality": function (ctx) {
		stroke(ctx, rough(arc(0, 0, 76, 0, 6.3, 100), 1.5), 2.2, true);
		stroke(ctx, rough(bez([-90, 104], [-30, 30], [30, -30], [96, -110], 50), 3), 9.5, false);
	},
};

// The ring on a RING_CANVAS_PX canvas: one rough circle and three tiny glyphs on it, a third of a turn apart
function drawRing(ctx, s) {
	colors = RING_COLORS[s];
	ctx.translate(RING_CANVAS_PX / 2, RING_CANVAS_PX / 2);
	ctx.scale(RING_CANVAS_PX / MOCKUP_SPAN, RING_CANVAS_PX / MOCKUP_SPAN);
	ctx.lineCap = ctx.lineJoin = "round";
	stroke(ctx, rough(arc(0, 0, 112, 0, 6.3, 160), 1.5), 5, false, false);
	for (let i = 0; i < 3; i++) {
		ctx.save();
		ctx.rotate(i * Math.PI * 2 / 3 - Math.PI / 2);
		ctx.translate(0, -128);
		ctx.scale(0.17, 0.17);
		GLYPHS[s](ctx);
		ctx.restore();
	}
	chip(ctx, 60);
}

// One ring texture per enchantment, shared by every ring of it (Heretical Subjection rings every bishop):
// painted for the first user, freed with the last
const shared = {}; // s -> { texture, users }

function useRing(s) {
	if (!shared[s]) {
		const canvas = document.createElement("canvas");
		canvas.width = canvas.height = RING_CANVAS_PX;
		drawRing(canvas.getContext("2d"), s);
		const texture = new CanvasTexture(canvas);
		texture.colorSpace = SRGBColorSpace;
		shared[s] = { texture, users: 0 };
	}
	shared[s].users++;
	return shared[s].texture;
}

function dropRing(s) {
	if (!--shared[s].users) {
		shared[s].texture.dispose();
		delete shared[s];
	}
}

// The turns left, drawn as hex.js draws them (copied: its drawNumber is private and green) in the enchantment's glow
function drawNumber(ctx, text, glow) {
	ctx.clearRect(0, 0, NUMBER_CANVAS_PX, NUMBER_CANVAS_PX);
	ctx.font = "bold 42px Georgia, serif";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.shadowColor = glow;
	ctx.shadowBlur = 8;
	ctx.fillStyle = "#fff";
	ctx.fillText(text, NUMBER_CANVAS_PX / 2, NUMBER_CANVAS_PX / 2 + 2);
}

/**
 * @description One enchantment's ring on one piece (statusFx/index.js calls it, never anything else)
 * @param  {[Mesh]} pieceMesh [unused: opts.mesh is the current one]
 * @param  {[object]} opts [statusFx/index.js: { s (the enchantment's base key), left, siblings, ringSlot (0 inner, 1 outer; missing = 0),
 * ringSlots, mesh, root, reduce, ... }, updated in place]
 * @return {[object]} { update(dt), burst(), animating(), dispose() }
 */
export function create(pieceMesh, opts) {
	const s = opts.s;
	const map = useRing(s);
	// DoubleSide: a lifted piece can show its underside
	const ring = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({
		map, transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide,
	}));
	ring.rotation.x = -Math.PI / 2;
	const canvas = document.createElement("canvas");
	canvas.width = canvas.height = NUMBER_CANVAS_PX;
	const numberCtx = canvas.getContext("2d");
	const numberMap = new CanvasTexture(canvas);
	numberMap.colorSpace = SRGBColorSpace;
	const number = new Sprite(new SpriteMaterial({ map: numberMap, transparent: true, depthWrite: false }));
	number.scale.setScalar(NUMBER_SIZE);
	opts.root.add(ring, number);
	let t = 0;
	// The number drawn
	let text = null;
	// Disposed
	let gone = false;

	function update(dt) {
		if (!opts.reduce) { t += dt; }
		// The root is in piece units
		const box = opts.mesh.geometry && opts.mesh.geometry.boundingBox;
		const base = box ? box.min.y : 0;
		const scale = opts.mesh.scale.y || 1;
		const slot = opts.ringSlot || 0;
		const side = (CELL_SIZE / scale) * (1 + SECOND_RING_EXTRA * slot);
		const fade = opts.mesh.userData.opacity ?? 1;
		const shift = (side * 128 / MOCKUP_SPAN + NUMBER_SIZE * 0.4) / NUMBER_SIZE;
		// Hex's number sits right of the piece (hex.js), so ours goes left when the piece is Hexed too
		const left = (opts.siblings || []).includes("hexed");
		ring.scale.setScalar(side);
		// Ring slot 1 is turned 60 degrees: its three glyphs land between slot 0's instead of over them
		ring.rotation.z = slot * Math.PI / 3;
		ring.position.y = base + RING_LIFT / scale;
		ring.material.opacity = sigilPulse(t, opts.reduce) * fade;
		number.position.y = base + RING_LIFT / scale + NUMBER_SIZE / 2;
		// A screen-space shift (as hex.js does): beside the ring however the piece or camera turns. Ring slot 1's number sits
		// one higher, clear of slot 0's
		number.center.set(left ? 0.5 + shift : 0.5 - shift, 0.5 - slot);
		number.material.opacity = fade;
		const next = badgeText(opts.left);
		if (next !== text) {
			text = next;
			if (text) {
				drawNumber(numberCtx, text, RING_COLORS[s].glow);
				numberMap.needsUpdate = true;
			}
			number.visible = text !== "";
		}
	}

	update(0);
	return {
		update,
		// An ending enchantment just goes
		burst() {
			return 0;
		},
		// Always, even for a ring with no end (Heavy Cavalry, Opposing Finality): it keeps pulsing as Warded and Hex do
		animating() {
			return !opts.reduce;
		},
		dispose() {
			// A second dispose must not drop a twin's share of the texture
			if (gone) { return; }
			gone = true;
			ring.removeFromParent();
			number.removeFromParent();
			ring.geometry.dispose();
			ring.material.dispose();
			number.material.dispose();
			numberMap.dispose();
			dropRing(s);
		},
	};
}
