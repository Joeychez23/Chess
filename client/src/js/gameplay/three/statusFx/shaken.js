// Status effect: Shaken (can't capture). One lightning cage per turn left over the piece's head (one for a permanent Shaken, ruling Q2), steel blue (#b9cde4 bolts over a #2c5a94 glow),
// each cage's core the "Bolt through ring" glyph (art/Glyphs/simple/shaken-core-picks.html, design N1, its brush engine rebuilt here). A bolt strikes about every second; the piece never
// moves & there is no aura. T24: each strike forks (shorter-lived side branches), the bolts glow (a white core, a steel-blue halo, BLOOM_LAYER unless opts.cheap) & the cages read from the opening camera. A turn passing bursts the last cage, as does the status ending (burst). The contract & opts are statusFx/index.js's (see its @description)
import { Group, Sprite, SpriteMaterial, CanvasTexture, SRGBColorSpace, LineSegments, LineBasicMaterial, Points, PointsMaterial, BufferGeometry, Float32BufferAttribute, AdditiveBlending } from "three";
import { CELL_SIZE, BLOOM_LAYER } from "../constants.js";
import { skullMap } from "./marked.js";
import { dotTexture, pointSize } from "./warded.js";
import * as shakenFlash from "./shakenFlash.js"; // A CYCLE (IT IMPORTS OUR CONSTANTS): ONLY USED AT RUN TIME

export const STRIKE = 1; // SECONDS BETWEEN BOLT STRIKES (THE CAGES TAKE TURNS)
export const FLASH = 0.25; // SECONDS A STRIKE'S FLASH TAKES TO FADE
export const BURST = 0.45; // SECONDS A BURSTING CAGE PLAYS: IT SWELLS & FADES
export const CAGE = CELL_SIZE * 0.44; // A CAGE'S HEIGHT ON THE BOARD (WORLD UNITS) AT 1-2 CAGES: ABOUT 32 PX FROM THE CHESS CARDS OPENING CAMERA ON A 1440x900 WINDOW (WAS 0.32, ABOUT 24 PX)
export const GAP = 0.9; // CAGES SIDE BY SIDE, IN CAGE SIZES FROM ONE'S MIDDLE TO THE NEXT'S
export const OVER = 0.1; // HOW FAR OVER THE PIECE'S TOP (PIECE UNITS)
const ROW = CELL_SIZE * 0.95, WIDE = 1.12; // A ROW'S WIDTH AT MOST (RULING T24-R10); A CAGE'S WIDTH IN CAGE SIZES (BARS BOW OUT 0.48 EITHER SIDE, HALO DOTS 0.08 MORE)
const REST = 0.55; // THE BOLTS' OPACITY BETWEEN STRIKES (WAS 0.4: TOO FAINT FROM THE OPENING CAMERA)
const PX = 128; // THE GLYPH'S CANVAS SIDE
const MAX = 3; // CAGES DRAWN AT MOST (RULING R15): A LONGER SHAKEN SHOWS 3, THE HOVER TEXT HAS THE NUMBER
const BARS = 4, STEPS = 5; // A CAGE'S BOLTS & THE JAGGED STEPS IN EACH: 40 LINE VERTICES A CAGE
export const MAIN_VERTS = BARS * STEPS * 2;
export const FORKS = 4, FORK_VERTS = 2 * 2; // SIDE BRANCHES A STRIKE THROWS OFF, 2 JAGGED STEPS EACH: SAME GEOMETRY & DRAW AS THE BARS, SHOWN BY ITS DRAW RANGE
export const FORK_S = 0.12; // SECONDS A STRIKE'S FORKS LAST (UNDER FLASH: THEY FLICKER OUT FIRST)
const FORK_DIM = 0.5; // A FORK'S VERTEX COLOUR AGAINST THE BAR'S 1: LINE WIDTH IS ALWAYS 1 PX IN WebGL, SO "THINNER" IS DIMMER
const CORE = "#eef4ff", HALO = "#3d6fae", HALO_SIZE = 0.16; // A NEAR-WHITE CORE LINE; A STEEL-BLUE HALO OF SOFT DOTS ON ITS JOINTS (CAGE UNITS ACROSS)
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
 * @description How many forks a cage draws t seconds after its strike: all FORKS until FORK_S, half (rounded up) when cheap, then none
 * @param  {[number]} t
 * @param  {[boolean]} cheap [opts.cheap]
 * @return {[number]}
 */
/**
 * @description The cage row's layout for n cages: a cage's size (world units) & cage i's x off the row's middle (world units). CAGE until n cages would pass ROW, then smaller so they fit (ruling T24-R10)
 * @param  {[number]} n
 * @param  {[number]} i
 * @return {[object]} { size, x }
 */
export function cageLayout(n, i = 0) {
	const size = Math.min(CAGE, ROW / (Math.max(0, n - 1) * GAP + WIDE));
	return { size, x: (i - (n - 1) / 2) * GAP * size };
}

export const forks = (t, cheap) => (t < FORK_S ? (cheap ? Math.ceil(FORKS / 2) : FORKS) : 0);

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
	// A DARK SOFT DISC BEHIND IT ALL, SO THE BLUE READS ON THE LIGHT SQUARES TOO (THE OPENING CAMERA IS FAR BACK)
	x.globalCompositeOperation = "destination-over";
	x.fillStyle = "rgba(6,12,24,0.13)"; // 6 STACKED DISCS: ABOUT 0.57 DARK AT THE MIDDLE, FADING OUT TO r 120
	for (let r = 120; r >= 45; r -= 15) { x.beginPath(); x.arc(0, 0, r, 0, Math.PI * 2); x.fill(); }
	x.globalCompositeOperation = "source-over";
}

// THE GLYPH TEXTURE & THE HALO'S DOT, ONE EACH FOR EVERY SHAKEN EFFECT (HERETICAL SUBJECTION SHAKES UP TO 16 PIECES IN ONE SYNC): MADE FOR THE FIRST USER, FREED WITH THE LAST
let glyph = null, dot = null, users = 0;
function useGlyph() {
	if (!users++) {
		const canvas = document.createElement("canvas");
		canvas.width = canvas.height = PX;
		drawGlyph(canvas.getContext("2d"), PX);
		glyph = new CanvasTexture(canvas);
		glyph.colorSpace = SRGBColorSpace;
		dot = dotTexture();
	}
	return glyph;
}
function dropGlyph() {
	if (!--users) { glyph.dispose(); dot.dispose(); glyph = dot = null; }
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
	// FORKS: EACH FROM A RANDOM INNER JOINT OF A BAR, OUT & DOWN IN 2 SHORT JAGGED STEPS
	for (let f = 0; f < FORKS; f++) {
		const j = (Math.floor(rnd(0, BARS)) * STEPS + Math.floor(rnd(1, STEPS))) * 6 - 3; // THE END OF A BAR'S STEP 1..STEPS-1
		let prev = [out[j], out[j + 1], out[j + 2]];
		const a = Math.atan2(prev[2], prev[0]) + rnd(-0.6, 0.6);
		for (let i = 0; i < 2; i++) {
			const p = [prev[0] + Math.cos(a) * rnd(0.06, 0.12), prev[1] - rnd(0.04, 0.1), prev[2] + Math.sin(a) * rnd(0.06, 0.12)];
			out.set(prev, o); out.set(p, o + 3); o += 6;
			prev = p;
		}
	}
	return out;
}
const VERTS = MAIN_VERTS + FORKS * FORK_VERTS;
const COLORS = Float32Array.from({ length: VERTS * 3 }, (_, i) => (i < MAIN_VERTS * 3 ? 1 : FORK_DIM)); // COPIED INTO EACH CAGE: THREE MAY HOLD THE ARRAY
// THE HALO'S DOTS, EACH JOINT ONCE (A LineSegments JOINT IS 2 VERTICES & ALL BARS SHARE THE TOP & BOTTOM): THE TOP, EACH BAR'S INNER JOINTS, THE BOTTOM, THEN EACH FORK'S 2 ENDS
const HALO_INDEX = [0];
for (let b = 0; b < BARS; b++) { for (let s = 0; s < STEPS - 1; s++) { HALO_INDEX.push((b * STEPS + s) * 2 + 1); } }
HALO_INDEX.push(STEPS * 2 - 1);
const HALO_MAIN = HALO_INDEX.length;
for (let f = 0; f < FORKS; f++) { HALO_INDEX.push(MAIN_VERTS + f * FORK_VERTS + 1, MAIN_VERTS + f * FORK_VERTS + 3); }

function makeCage(texture) {
	const group = new Group();
	const core = new Sprite(new SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
	core.scale.setScalar(0.8);
	const geometry = new BufferGeometry();
	geometry.setAttribute("position", new Float32BufferAttribute(boltPoints(new Float32Array(VERTS * 3)), 3));
	geometry.setAttribute("color", new Float32BufferAttribute(COLORS.slice(), 3));
	geometry.setDrawRange(0, MAIN_VERTS);
	const bolts = new LineSegments(geometry, new LineBasicMaterial({ color: CORE, vertexColors: true, transparent: true, opacity: REST, depthWrite: false, blending: AdditiveBlending }));
	bolts.name = "bolts";
	const dots = new BufferGeometry(); // ITS OWN INDEX (COPIED PER CAGE, FREED WITH IT) OVER THE BOLTS' POSITIONS
	dots.setAttribute("position", geometry.attributes.position);
	dots.setIndex(HALO_INDEX.slice());
	dots.setDrawRange(0, HALO_MAIN);
	const halo = new Points(dots, new PointsMaterial({ color: HALO, map: dot, transparent: true, opacity: REST, depthWrite: false, blending: AdditiveBlending }));
	halo.name = "halo";
	group.add(core, halo, bolts);
	return { group, core, bolts, halo, t: 0 };
}
const glowOn = (o, on) => (on ? o.layers.enable(BLOOM_LAYER) : o.layers.disable(BLOOM_LAYER)); // LAYER 0 STAYS: IT STILL DRAWS NORMALLY
function freeCage(c) { c.group.removeFromParent(); c.core.material.dispose(); c.bolts.geometry.dispose(); c.halo.geometry.dispose(); c.bolts.material.dispose(); c.halo.material.dispose(); }

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
	let fl = shakenFlash.make(pieceMesh, opts, dot); // THE STRIKE FLASH: STRUCK FROM OUR STRIKE BRANCH BELOW (ONE CLOCK), GONE ON burst()
	opts.root.add(fl.object);
	opts.squareRoot.add(fl.ground);
	let clock = 0, since = FLASH, striking = 0, ended = false, skull = null, slots = 0, dotSize = 0; // ended: burst() WAS CALLED, opts.left STAYS AT ITS LAST VALUE. skull: MADE ON FIRST NEED. slots: THE ROW'S LAID-OUT COUNT
	function glow(c) { // HOISTED, NOT A CLOSURE PER FRAME. UNDER CHEAP THE HALO IS HIDDEN (RULING T24-R9)
		glowOn(c.bolts, !opts.cheap);
		glowOn(c.halo, !opts.cheap);
		c.halo.visible = !opts.cheap;
		c.halo.material.size = dotSize;
	}

	function lose(c) {
		if (opts.reduce) { freeCage(c); } else { c.t = 0; dying.push(c); }
	}
	function update(dt) {
		const n = ended ? 0 : cageCount(opts.left);
		let grew = false;
		while (cages.length > n) { lose(cages.pop()); }
		while (cages.length < n) { const c = makeCage(texture); row.add(c.group); cages.push(c); grew = true; }
		for (let k = dying.length - 1; k >= 0; k--) {
			const c = dying[k];
			c.t += dt;
			if (opts.reduce || c.t >= BURST) { dying.splice(k, 1); freeCage(c); }
		}
		if (grew || !dying.length) { // THE ROW CLOSES UP (& RESIZES) ONCE A LOST CAGE HAS BURST
			slots = cages.length;
			for (let i = 0; i < slots; i++) { cages[i].group.position.set((i - (slots - 1) / 2) * GAP, 0, 0); }
		}
		const box = opts.mesh.geometry && opts.mesh.geometry.boundingBox, size = cageLayout(slots).size / (opts.mesh.scale.y || 1); // THE ROOT IS IN PIECE UNITS
		dotSize = pointSize(HALO_SIZE * size, opts.mesh);
		row.scale.setScalar(size);
		row.position.set(0, (box ? box.max.y : 1) + OVER + size / 2, 0);
		if (fl) { fl.update(dt); }
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
				if (fl) { fl.strike(striking, slots); } // THE CAGE AS THE ROW LAYS IT OUT (slots, NOT cages.length, WHILE A LOST CAGE BURSTS)
			}
		}
		const fade = opts.mesh.userData.opacity ?? 1, f = opts.reduce ? 0 : flash(since);
		const marked = opts.siblings.includes("marked"), centre = cages[Math.floor((cages.length - 1) / 2)];
		if (marked && !skull) { skull = skullMap(); }
		const forked = opts.reduce ? 0 : forks(since, opts.cheap);
		for (let i = 0; i < cages.length; i++) {
			const c = cages[i], lit = i === striking % cages.length ? f : 0, shown = lit ? forked : 0;
			glow(c);
			c.bolts.geometry.setDrawRange(0, MAIN_VERTS + shown * FORK_VERTS);
			c.halo.geometry.setDrawRange(0, HALO_MAIN + shown * 2);
			c.bolts.material.opacity = c.halo.material.opacity = (REST + (1 - REST) * lit) * fade;
			c.core.material.opacity = (0.85 + 0.15 * lit) * fade;
			c.core.material.map = marked && c === centre ? skull : texture;
		}
		for (const c of dying) {
			glow(c);
			const look = burstLook(c.t);
			c.group.scale.setScalar(look.scale);
			c.bolts.geometry.setDrawRange(0, MAIN_VERTS);
			c.halo.geometry.setDrawRange(0, HALO_MAIN);
			c.bolts.material.opacity = c.halo.material.opacity = look.opacity * fade;
			c.core.material.opacity = look.opacity * fade;
			c.core.material.map = texture; // A BURSTING CAGE IS SHAKEN'S OWN: MARKED'S SKULL FLOATS AGAIN ONCE SHAKEN ENDS
		}
	}
	update(0);
	return {
		update,
		burst() {
			ended = true;
			if (fl) { fl.dispose(); fl = null; } // NO FLASH OVER BURSTING CAGES
			if (opts.reduce) { return 0; }
			while (cages.length) { lose(cages.pop()); }
			return BURST * 1000;
		},
		animating: () => !opts.reduce && (cages.length > 0 || dying.length > 0),
		dispose() {
			[...cages, ...dying].forEach(freeCage);
			cages.length = dying.length = 0;
			row.removeFromParent();
			if (fl) { fl.dispose(); fl = null; }
			dropGlyph();
			if (skull) { skull.dispose(); }
		},
	};
}
