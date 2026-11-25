// Status effect: Shaken (can't capture). One lightning cage per turn left over the piece's head (one for a permanent Shaken, ruling Q2), steel blue (#b9cde4 bolts over a #2c5a94 glow),
// each cage's core the "Bolt through ring" glyph (art/Glyphs/simple/shaken-core-picks.html, design N1, its brush engine rebuilt here). A bolt strikes about every second; the piece never
// moves & there is no aura. A turn passing bursts the last cage, as does the status ending (burst). The contract & opts are statusFx/index.js's (see its @description)
import { Group, Sprite, SpriteMaterial, CanvasTexture, SRGBColorSpace, LineSegments, LineBasicMaterial, BufferGeometry, Float32BufferAttribute, AdditiveBlending } from "three";
import { CELL_SIZE } from "../constants.js";
import { skullMap } from "./marked.js";

export const STRIKE = 1; // SECONDS BETWEEN BOLT STRIKES (THE CAGES TAKE TURNS)
export const FLASH = 0.25; // SECONDS A STRIKE'S FLASH TAKES TO FADE
export const BURST = 0.45; // SECONDS A BURSTING CAGE PLAYS: IT SWELLS & FADES
const CAGE = CELL_SIZE * 0.32; // A CAGE'S HEIGHT ON THE BOARD (WORLD UNITS)
const GAP = 1.05; // CAGES SIDE BY SIDE, IN CAGE SIZES FROM ONE'S MIDDLE TO THE NEXT'S
const OVER = 0.1; // HOW FAR OVER THE PIECE'S TOP (PIECE UNITS)
const REST = 0.4; // THE BOLTS' OPACITY BETWEEN STRIKES
const PX = 128; // THE GLYPH'S CANVAS SIDE
const MAX = 3; // CAGES DRAWN AT MOST (RULING R15): A LONGER SHAKEN SHOWS 3, THE HOVER TEXT HAS THE NUMBER
const BARS = 4, STEPS = 5; // A CAGE'S BOLTS & THE JAGGED STEPS IN EACH: 40 LINE VERTICES A CAGE
const PAL = { halo: "rgba(44,90,148,", body: "rgba(95,135,195,", core: "rgba(185,205,228,", spark: "rgba(200,220,245," }; // #2c5a94 GLOW, #b9cde4 CORE

/**
 * @description How many cages Shaken shows: one per turn left up to MAX (ruling R15), one for a permanent status (left null, ruling Q2)
 * @param  {[number|null]} left
 * @return {[number]}
 */
export const cageCount = (left) => (left === null || left === undefined ? 1 : Math.min(MAX, Math.max(0, left)));

/**
 * @description A bolt strike's flash, t seconds after it: 1 at the strike, down to 0 at FLASH, a straight fade
 * @param  {[number]} t
 * @return {[number]} 0..1
 */
export const flash = (t) => Math.max(0, 1 - t / FLASH);

/**
 * @description A bursting cage's look t seconds in: it swells to 1.8 times its size & fades out by BURST
 * @param  {[number]} t
 * @return {[object]} { scale, opacity }
 */
export function burstLook(t) {
	const k = Math.min(1, t / BURST);
	return { scale: 1 + 0.8 * k, opacity: 1 - k };
}

// ---- THE GLYPH: N1'S BRUSH (A FILLED RIBBON IN THREE GLOW LAYERS) ON A ROUGHENED PATH, DRAWN ONCE TO A CANVAS ----
const rnd = (a, b) => a + Math.random() * (b - a);
const sample = (fn, n) => Array.from({ length: n + 1 }, (_, i) => fn(i / n));
const seg = (ax, ay, bx, by, n) => sample((t) => [ax + (bx - ax) * t, ay + (by - ay) * t], n);
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
// A ZIGZAG FROM a TO b IN k LEGS, amp OUT TO EITHER SIDE
function jag(ax, ay, bx, by, k, amp) {
	const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy), nx = -dy / len, ny = dx / len, corners = [[ax, ay]];
	for (let i = 1; i < k; i++) { const s = (i % 2 ? 1 : -1) * amp * rnd(0.5, 1.2); corners.push([ax + dx * i / k + nx * s, ay + dy * i / k + ny * s]); }
	corners.push([bx, by]);
	return corners.slice(1).flatMap((c, i) => seg(...corners[i], ...c, 6));
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
// ONE STROKE: A WIDE HALO, THE BODY, A HOT CORE (shadowBlur IGNORES THE TRANSFORM, SO IT'S SCALED BY k: THE CANVAS OVER THE MOCKUP'S 560 PX), AN ENGRAVED LINE ON A HEAVY ONE, EMBER SPARKS
function stroke(x, k, pts, w, hair) {
	x.save();
	x.globalCompositeOperation = "lighter";
	x.shadowColor = PAL.halo + "1)"; x.shadowBlur = 34 * k; x.fillStyle = PAL.halo + "0.35)"; ribbon(x, pts, w * 2.6, !hair);
	x.shadowBlur = 14 * k; x.fillStyle = PAL.body + "0.85)"; ribbon(x, pts, w, !hair);
	x.shadowBlur = 6 * k; x.shadowColor = PAL.core + "1)"; x.fillStyle = PAL.core + "0.95)"; ribbon(x, pts, w * 0.38, !hair);
	x.restore();
	if (!hair) {
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
	dots(x, pts, Math.floor(pts.length / 5), w * 2, 0.6, 2.2);
}
function dots(x, pts, n, spread, r0, r1) {
	x.save();
	x.globalCompositeOperation = "lighter";
	for (let i = 0; i < n; i++) {
		const p = pts[Math.floor(rnd(0, pts.length))];
		x.fillStyle = PAL.spark + rnd(0.3, 0.9) + ")";
		x.beginPath();
		x.arc(p[0] + rnd(-spread, spread), p[1] + rnd(-spread, spread), rnd(r0, r1), 0, Math.PI * 2);
		x.fill();
	}
	x.restore();
}
// KNOCK A LINE OR SMALL BITES OUT OF WHAT'S DRAWN: THE RING PASSING OVER THE BOLT, THE WORN EDGES
function cut(x, draw) { x.save(); x.globalCompositeOperation = "destination-out"; x.fillStyle = x.strokeStyle = "rgba(0,0,0,1)"; draw(); x.restore(); }

/**
 * @description Draws design N1, "Bolt through ring", on a 2D context S px square: a hairline ring, a heavy jagged bolt through it (behind the ring at the top, in front at the bottom),
 * dust on the ring's front & worn chips. Coordinates are the mockup's (a 280 unit square)
 * @param  {[CanvasRenderingContext2D]} x
 * @param  {[number]} S
 */
function drawGlyph(x, S) {
	const k = S / 280, ring = rough(sample((t) => [Math.cos(t * 6.3) * 70, Math.sin(t * 6.3) * 70], 140), 1.5), back = ring.slice(70), front = ring.slice(0, 71);
	x.clearRect(0, 0, S, S);
	x.translate(S / 2, S / 2);
	x.scale(k, k);
	x.lineCap = x.lineJoin = "round";
	stroke(x, S / 560, back, 2.2, true); // THE MOCKUP'S BLURS ARE PX ON ITS 560 PX CANVAS, NOT GLYPH UNITS
	stroke(x, S / 560, rough(jag(-55, -100, 50, 100, 5, 20), 1), 8, false);
	cut(x, () => { x.lineWidth = 2.2 * 1.4 * 3.2; x.beginPath(); x.moveTo(...front[0]); front.forEach((p) => x.lineTo(...p)); x.stroke(); });
	stroke(x, S / 560, front, 2.2, true);
	dots(x, front, 18, 6, 0.4, 1.8);
	cut(x, () => { for (let i = 0; i < 90; i++) { x.globalAlpha = rnd(0.2, 0.7); x.beginPath(); x.arc(rnd(-120, 120), rnd(-120, 120), rnd(0.6, 2.6), 0, Math.PI * 2); x.fill(); } });
}

// THE GLYPH TEXTURE, ONE FOR EVERY SHAKEN EFFECT (HERETICAL SUBJECTION SHAKES UP TO 16 PIECES IN ONE SYNC): PAINTED FOR THE FIRST USER, FREED WITH THE LAST
let glyph = null, users = 0;
function useGlyph() {
	if (!users++) {
		const canvas = document.createElement("canvas");
		canvas.width = canvas.height = PX;
		drawGlyph(canvas.getContext("2d"), PX);
		glyph = new CanvasTexture(canvas);
		glyph.colorSpace = SRGBColorSpace;
	}
	return glyph;
}
function dropGlyph() {
	if (!--users) { glyph.dispose(); glyph = null; }
}

// A CAGE'S BOLTS: BARS JAGGED STRANDS FROM ITS TOP TO ITS BOTTOM, BOWED OUT ROUND THE CORE (CAGE UNITS: 1 HIGH, CENTRED). REDRAWN ON EACH STRIKE SO THE LIGHTNING MOVES
function boltPoints(out) {
	let o = 0;
	for (let b = 0; b < BARS; b++) {
		const a0 = (b / BARS) * Math.PI * 2 + rnd(-0.3, 0.3);
		let prev = [0, 0.5, 0];
		for (let i = 1; i <= STEPS; i++) {
			const t = i / STEPS, r = Math.sin(Math.PI * t) * 0.42 + (i < STEPS ? rnd(-0.06, 0.06) : 0), a = a0 + (i < STEPS ? rnd(-0.25, 0.25) : 0);
			const p = [Math.cos(a) * r, 0.5 - t, Math.sin(a) * r];
			out.set(prev, o); out.set(p, o + 3); o += 6;
			prev = p;
		}
	}
	return out;
}

function makeCage(texture) {
	const group = new Group();
	const core = new Sprite(new SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
	core.scale.setScalar(0.8);
	const geometry = new BufferGeometry();
	geometry.setAttribute("position", new Float32BufferAttribute(boltPoints(new Float32Array(BARS * STEPS * 6)), 3));
	const bolts = new LineSegments(geometry, new LineBasicMaterial({ color: "#b9cde4", transparent: true, opacity: REST, depthWrite: false, blending: AdditiveBlending }));
	bolts.name = "bolts";
	group.add(core, bolts);
	return { group, core, bolts, t: 0 };
}
function freeCage(c) { c.group.removeFromParent(); c.core.material.dispose(); c.bolts.geometry.dispose(); c.bolts.material.dispose(); }

/**
 * @description Shaken's cages, in a row in opts.root over the piece's head (they follow its lift, drag & drop). The row follows opts.left; a cage it loses bursts (none under opts.reduce),
 * the others keep their places until it's gone. While the piece is also Marked (opts.siblings), the centre cage's core is Marked's skull (ruling 09:19; of two, the left one)
 * @param  {[Mesh]} pieceMesh [unused: opts.mesh is the current one]
 * @param  {[object]} opts [statusFx/index.js's: { s, id, left, by, square, mode, slot, slots, mesh, root, squareRoot, reduce }, updated in place]
 * @return {[object]} { update(dt), burst(), animating(), dispose() }
 */
export function create(pieceMesh, opts) {
	const texture = useGlyph();
	const row = new Group();
	row.name = "shakenCages";
	opts.root.add(row);
	const cages = [], dying = [];
	let clock = 0, since = FLASH, striking = 0, ended = false, skull = null; // ended: burst() WAS CALLED, opts.left STAYS AT ITS LAST VALUE. skull: MADE ON FIRST NEED

	function lose(c) {
		if (opts.reduce) { freeCage(c); } else { c.t = 0; dying.push(c); }
	}
	function update(dt) {
		const n = ended ? 0 : cageCount(opts.left);
		let grew = false;
		while (cages.length > n) { lose(cages.pop()); }
		while (cages.length < n) { const c = makeCage(texture); row.add(c.group); cages.push(c); grew = true; }
		for (const c of [...dying]) {
			c.t += dt;
			if (opts.reduce || c.t >= BURST) { dying.splice(dying.indexOf(c), 1); freeCage(c); }
		}
		const box = opts.mesh.geometry && opts.mesh.geometry.boundingBox, size = CAGE / (opts.mesh.scale.y || 1); // THE ROOT IS IN PIECE UNITS
		row.scale.setScalar(size);
		row.position.set(0, (box ? box.max.y : 1) + OVER + size / 2, 0);
		if (grew || !dying.length) { cages.forEach((c, i) => c.group.position.set((i - (cages.length - 1) / 2) * GAP, 0, 0)); } // THE ROW CLOSES UP ONCE A LOST CAGE HAS BURST
		if (!opts.reduce && cages.length) {
			clock += dt;
			since += dt;
			if (clock >= STRIKE) {
				clock %= STRIKE;
				since = 0;
				striking = (striking + 1) % cages.length;
				const pos = cages[striking].bolts.geometry.attributes.position;
				boltPoints(pos.array);
				pos.needsUpdate = true;
			}
		}
		const fade = opts.mesh.userData.opacity ?? 1, f = opts.reduce ? 0 : flash(since);
		const marked = opts.siblings.includes("marked"), centre = cages[Math.floor((cages.length - 1) / 2)];
		if (marked && !skull) { skull = skullMap(); }
		cages.forEach((c, i) => {
			const lit = i === striking % cages.length ? f : 0;
			c.bolts.material.opacity = (REST + (1 - REST) * lit) * fade;
			c.core.material.opacity = (0.85 + 0.15 * lit) * fade;
			c.core.material.map = marked && c === centre ? skull : texture;
		});
		for (const c of dying) {
			const look = burstLook(c.t);
			c.group.scale.setScalar(look.scale);
			c.bolts.material.opacity = look.opacity * fade;
			c.core.material.opacity = look.opacity * fade;
			c.core.material.map = texture; // A BURSTING CAGE IS SHAKEN'S OWN: MARKED'S SKULL FLOATS AGAIN ONCE SHAKEN ENDS
		}
	}
	update(0);
	return {
		update,
		burst() {
			ended = true;
			if (opts.reduce) { return 0; }
			while (cages.length) { lose(cages.pop()); }
			return BURST * 1000;
		},
		animating: () => !opts.reduce && (cages.length > 0 || dying.length > 0),
		dispose() {
			[...cages, ...dying].forEach(freeCage);
			cages.length = dying.length = 0;
			row.removeFromParent();
			dropGlyph();
			if (skull) { skull.dispose(); }
		},
	};
}
