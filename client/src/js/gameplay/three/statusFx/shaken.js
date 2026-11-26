// Status effect: Shaken (can't capture). One lightning cage per turn left over the piece's head (one for a permanent
// Shaken), steel blue (#b9cde4 bolts over a #2c5a94 glow). Each cage's core is the "Bolt through ring" glyph
// (art/Glyphs/simple/shaken-core-picks.html, design N1, its brush engine rebuilt here). A bolt strikes about every second;
// the piece never moves and there is no aura. Each strike forks into shorter-lived side branches, the bolts glow (a white
// core, a steel-blue halo, on BLOOM_LAYER unless opts.cheap) and the cages read from the opening camera. A turn passing
// bursts the last cage, as does the status ending (burst). The contract and opts are statusFx/index.js's (see its @description)
import { Group, Sprite, SpriteMaterial, CanvasTexture, SRGBColorSpace, LineSegments, LineBasicMaterial, Points, PointsMaterial,
	BufferGeometry, Float32BufferAttribute, AdditiveBlending } from "three";
import { CELL_SIZE, BLOOM_LAYER } from "../constants.js";
import { skullMap } from "./marked.js";
import { dotTexture, pointSize } from "./warded.js";
// An import cycle (shakenFlash.js imports our constants): only used at run time, never while either module loads
import * as shakenFlash from "./shakenFlash.js";

// Seconds between bolt strikes (the cages take turns)
export const STRIKE_SECONDS = 1;
// Seconds a strike's flash takes to fade
export const FLASH_SECONDS = 0.25;
// Seconds a bursting cage plays: it swells and fades
export const BURST_SECONDS = 0.45;
// A cage's height on the board (world units) at 1-2 cages: about 32 px from the Chess Cards opening camera on a
// 1440x900 window (it was 0.32, about 24 px)
export const CAGE_HEIGHT = CELL_SIZE * 0.44;
// Cages side by side, in cage sizes from one's middle to the next's
export const CAGE_SPACING = 0.9;
// How far over the piece's top the cages float (piece units)
export const CAGE_LIFT = 0.1;
// A row of cages is never wider than this, so the row stays over its own square
const ROW_MAX_WIDTH = CELL_SIZE * 0.95;
// A cage's width in cage sizes: the bolts bow out 0.48 either side, the halo dots 0.08 more
const CAGE_WIDTH = 1.12;
// The bolts' opacity between strikes (it was 0.4: too faint from the opening camera)
const BOLT_REST_OPACITY = 0.55;
// The glyph's canvas side
const GLYPH_CANVAS_PX = 128;
// Cages drawn at most: a longer Shaken still shows 3, the hover text has the number
const MAX_CAGES = 3;
// A cage's bolts and the jagged steps in each: 40 line vertices a cage
const CAGE_BOLTS = 4;
const BOLT_STEPS = 5;
export const MAIN_VERTS = CAGE_BOLTS * BOLT_STEPS * 2;
// Side branches a strike throws off, 2 jagged steps each: the same geometry and draw call as the bolts, shown by its draw range
export const STRIKE_FORKS = 4;
export const FORK_VERTS = 2 * 2;
// Seconds a strike's forks last (under FLASH_SECONDS: they flicker out first)
export const FORK_S = 0.12;
// A fork's vertex colour against the bolt's 1: line width is always 1 px in WebGL, so "thinner" means dimmer
const FORK_DIM = 0.5;
// A near-white core line, and a steel-blue halo of soft dots on its joints (HALO_SIZE: cage units across)
const CORE_COLOR = "#eef4ff";
const HALO_COLOR = "#3d6fae";
const HALO_SIZE = 0.16;
// The glyph's brush colours: a #2c5a94 glow, a #b9cde4 core
const GLOW_COLORS = { halo: "rgba(44,90,148,", body: "rgba(95,135,195,", core: "rgba(185,205,228,", spark: "rgba(200,220,245," };

/**
 * @description How many cages Shaken shows: one per turn left, up to MAX_CAGES, and one for a permanent status (left null)
 * @param  {[number|null]} left
 * @return {[number]}
 */
export function cageCount(left) {
	return left === null || left === undefined ? 1 : Math.min(MAX_CAGES, Math.max(0, left));
}

/**
 * @description A bolt strike's flash, t seconds after it: 1 at the strike, down to 0 at FLASH_SECONDS, a straight fade
 * @param  {[number]} t
 * @return {[number]} 0..1
 */
export function flash(t) {
	return Math.max(0, 1 - t / FLASH_SECONDS);
}

/**
 * @description The cage row's layout for n cages: a cage's size (world units) and cage i's x off the row's middle (world units).
 * CAGE_HEIGHT until n cages would be wider than ROW_MAX_WIDTH, then smaller so they fit
 * @param  {[number]} n
 * @param  {[number]} i
 * @return {[object]} { size, x }
 */
export function cageLayout(n, i = 0) {
	const size = Math.min(CAGE_HEIGHT, ROW_MAX_WIDTH / (Math.max(0, n - 1) * CAGE_SPACING + CAGE_WIDTH));
	return { size, x: (i - (n - 1) / 2) * CAGE_SPACING * size };
}

/**
 * @description How many forks a cage draws t seconds after its strike: all STRIKE_FORKS until FORK_S (half, rounded up, when cheap), then none
 * @param  {[number]} t
 * @param  {[boolean]} cheap [opts.cheap]
 * @return {[number]}
 */
export function forks(t, cheap) {
	return t < FORK_S ? (cheap ? Math.ceil(STRIKE_FORKS / 2) : STRIKE_FORKS) : 0;
}

/**
 * @description A bursting cage's look t seconds in: it swells to 1.8 times its size and fades out by BURST_SECONDS
 * @param  {[number]} t
 * @return {[object]} { scale, opacity }
 */
export function burstLook(t) {
	const progress = Math.min(1, t / BURST_SECONDS);
	return { scale: 1 + 0.8 * progress, opacity: 1 - progress };
}

/* ---- The glyph: design N1's brush (a filled ribbon in three glow layers) on a roughened path, drawn once to a canvas ---- */

function rnd(a, b) {
	return a + Math.random() * (b - a);
}

function sample(fn, n) {
	return Array.from({ length: n + 1 }, (_, i) => fn(i / n));
}

function seg(ax, ay, bx, by, n) {
	return sample((t) => [ax + (bx - ax) * t, ay + (by - ay) * t], n);
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

// A zigzag from a to b in `legs` legs, amp out to either side
function jag(ax, ay, bx, by, legs, amp) {
	const dx = bx - ax;
	const dy = by - ay;
	const length = Math.hypot(dx, dy);
	const nx = -dy / length;
	const ny = dx / length;
	const corners = [[ax, ay]];
	for (let i = 1; i < legs; i++) {
		const side = (i % 2 ? 1 : -1) * amp * rnd(0.5, 1.2);
		corners.push([ax + dx * i / legs + nx * side, ay + dy * i / legs + ny * side]);
	}
	corners.push([bx, by]);
	return corners.slice(1).flatMap((c, i) => seg(...corners[i], ...c, 6));
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

// One stroke: a wide halo, the body, a hot core, an engraved line on a heavy one, ember sparks.
// shadowBlur ignores the transform, so it is scaled by blurScale: the canvas over the mockup's 560 px
function stroke(ctx, blurScale, pts, width, hair) {
	ctx.save();
	ctx.globalCompositeOperation = "lighter";
	ctx.shadowColor = GLOW_COLORS.halo + "1)";
	ctx.shadowBlur = 34 * blurScale;
	ctx.fillStyle = GLOW_COLORS.halo + "0.35)";
	ribbon(ctx, pts, width * 2.6, !hair);
	ctx.shadowBlur = 14 * blurScale;
	ctx.fillStyle = GLOW_COLORS.body + "0.85)";
	ribbon(ctx, pts, width, !hair);
	ctx.shadowBlur = 6 * blurScale;
	ctx.shadowColor = GLOW_COLORS.core + "1)";
	ctx.fillStyle = GLOW_COLORS.core + "0.95)";
	ribbon(ctx, pts, width * 0.38, !hair);
	ctx.restore();
	if (!hair) {
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
	dots(ctx, pts, Math.floor(pts.length / 5), width * 2, 0.6, 2.2);
}

function dots(ctx, pts, n, spread, r0, r1) {
	ctx.save();
	ctx.globalCompositeOperation = "lighter";
	for (let i = 0; i < n; i++) {
		const p = pts[Math.floor(rnd(0, pts.length))];
		ctx.fillStyle = GLOW_COLORS.spark + rnd(0.3, 0.9) + ")";
		ctx.beginPath();
		ctx.arc(p[0] + rnd(-spread, spread), p[1] + rnd(-spread, spread), rnd(r0, r1), 0, Math.PI * 2);
		ctx.fill();
	}
	ctx.restore();
}

// Knock a line or small bites out of what is drawn: the ring passing over the bolt, the worn edges
function cut(ctx, draw) {
	ctx.save();
	ctx.globalCompositeOperation = "destination-out";
	ctx.fillStyle = ctx.strokeStyle = "rgba(0,0,0,1)";
	draw();
	ctx.restore();
}

/**
 * @description Draws design N1, "Bolt through ring", on a 2D context `size` px square: a hairline ring, a heavy jagged bolt through it
 * (behind the ring at the top, in front at the bottom), dust on the ring's front and worn chips. Coordinates are the mockup's
 * (a 280 unit square)
 * @param  {[CanvasRenderingContext2D]} ctx
 * @param  {[number]} size
 */
function drawGlyph(ctx, size) {
	const scale = size / 280;
	const ring = rough(sample((t) => [Math.cos(t * 6.3) * 70, Math.sin(t * 6.3) * 70], 140), 1.5);
	const back = ring.slice(70);
	const front = ring.slice(0, 71);
	ctx.clearRect(0, 0, size, size);
	ctx.translate(size / 2, size / 2);
	ctx.scale(scale, scale);
	ctx.lineCap = ctx.lineJoin = "round";
	// The mockup's blurs are px on its 560 px canvas, not glyph units
	stroke(ctx, size / 560, back, 2.2, true);
	stroke(ctx, size / 560, rough(jag(-55, -100, 50, 100, 5, 20), 1), 8, false);
	cut(ctx, function () {
		ctx.lineWidth = 2.2 * 1.4 * 3.2;
		ctx.beginPath();
		ctx.moveTo(...front[0]);
		front.forEach((p) => ctx.lineTo(...p));
		ctx.stroke();
	});
	stroke(ctx, size / 560, front, 2.2, true);
	dots(ctx, front, 18, 6, 0.4, 1.8);
	cut(ctx, function () {
		for (let i = 0; i < 90; i++) {
			ctx.globalAlpha = rnd(0.2, 0.7);
			ctx.beginPath();
			ctx.arc(rnd(-120, 120), rnd(-120, 120), rnd(0.6, 2.6), 0, Math.PI * 2);
			ctx.fill();
		}
	});
	// A dark soft disc behind it all, so the blue reads on the light squares too (the opening camera is far back)
	ctx.globalCompositeOperation = "destination-over";
	// 6 stacked discs: about 0.57 dark at the middle, fading out to radius 120
	ctx.fillStyle = "rgba(6,12,24,0.13)";
	for (let r = 120; r >= 45; r -= 15) {
		ctx.beginPath();
		ctx.arc(0, 0, r, 0, Math.PI * 2);
		ctx.fill();
	}
	ctx.globalCompositeOperation = "source-over";
}

// The glyph texture and the halo's dot, one each for every Shaken effect (Heretical Subjection shakes up to 16 pieces in one sync):
// made for the first user, freed with the last
let glyph = null;
let dot = null;
let users = 0;

function useGlyph() {
	if (!users++) {
		const canvas = document.createElement("canvas");
		canvas.width = canvas.height = GLYPH_CANVAS_PX;
		drawGlyph(canvas.getContext("2d"), GLYPH_CANVAS_PX);
		glyph = new CanvasTexture(canvas);
		glyph.colorSpace = SRGBColorSpace;
		dot = dotTexture();
	}
	return glyph;
}

function dropGlyph() {
	if (!--users) {
		glyph.dispose();
		dot.dispose();
		glyph = dot = null;
	}
}

// A cage's bolts: CAGE_BOLTS jagged strands from its top to its bottom, bowed out round the core (cage units: 1 high, centred).
// Redrawn on each strike so the lightning moves
function boltPoints(out) {
	let offset = 0;
	for (let bolt = 0; bolt < CAGE_BOLTS; bolt++) {
		const angle0 = (bolt / CAGE_BOLTS) * Math.PI * 2 + rnd(-0.3, 0.3);
		let prev = [0, 0.5, 0];
		for (let i = 1; i <= BOLT_STEPS; i++) {
			const t = i / BOLT_STEPS;
			const r = Math.sin(Math.PI * t) * 0.42 + (i < BOLT_STEPS ? rnd(-0.06, 0.06) : 0);
			const a = angle0 + (i < BOLT_STEPS ? rnd(-0.25, 0.25) : 0);
			const p = [Math.cos(a) * r, 0.5 - t, Math.sin(a) * r];
			out.set(prev, offset);
			out.set(p, offset + 3);
			offset += 6;
			prev = p;
		}
	}
	// Forks: each from a random inner joint of a bolt, out and down in 2 short jagged steps
	for (let fork = 0; fork < STRIKE_FORKS; fork++) {
		// The end of a bolt's step 1..BOLT_STEPS-1
		const joint = (Math.floor(rnd(0, CAGE_BOLTS)) * BOLT_STEPS + Math.floor(rnd(1, BOLT_STEPS))) * 6 - 3;
		let prev = [out[joint], out[joint + 1], out[joint + 2]];
		const a = Math.atan2(prev[2], prev[0]) + rnd(-0.6, 0.6);
		for (let i = 0; i < 2; i++) {
			const p = [prev[0] + Math.cos(a) * rnd(0.06, 0.12), prev[1] - rnd(0.04, 0.1), prev[2] + Math.sin(a) * rnd(0.06, 0.12)];
			out.set(prev, offset);
			out.set(p, offset + 3);
			offset += 6;
			prev = p;
		}
	}
	return out;
}

const CAGE_VERTS = MAIN_VERTS + STRIKE_FORKS * FORK_VERTS;
// Copied into each cage: three may hold on to the array
const VERTEX_COLORS = Float32Array.from({ length: CAGE_VERTS * 3 }, (_, i) => (i < MAIN_VERTS * 3 ? 1 : FORK_DIM));
// The halo's dots, each joint once (a LineSegments joint is 2 vertices and all bolts share the top and bottom):
// the top, each bolt's inner joints, the bottom, then each fork's 2 ends
const HALO_INDEX = [0];
for (let bolt = 0; bolt < CAGE_BOLTS; bolt++) {
	for (let step = 0; step < BOLT_STEPS - 1; step++) {
		HALO_INDEX.push((bolt * BOLT_STEPS + step) * 2 + 1);
	}
}
HALO_INDEX.push(BOLT_STEPS * 2 - 1);
const HALO_MAIN = HALO_INDEX.length;
for (let fork = 0; fork < STRIKE_FORKS; fork++) {
	HALO_INDEX.push(MAIN_VERTS + fork * FORK_VERTS + 1, MAIN_VERTS + fork * FORK_VERTS + 3);
}

function makeCage(texture) {
	const group = new Group();
	const core = new Sprite(new SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
	core.scale.setScalar(0.8);
	const geometry = new BufferGeometry();
	geometry.setAttribute("position", new Float32BufferAttribute(boltPoints(new Float32Array(CAGE_VERTS * 3)), 3));
	geometry.setAttribute("color", new Float32BufferAttribute(VERTEX_COLORS.slice(), 3));
	geometry.setDrawRange(0, MAIN_VERTS);
	// fog: false, see wardedMotes.js
	const bolts = new LineSegments(geometry, new LineBasicMaterial({
		color: CORE_COLOR, vertexColors: true, transparent: true, opacity: BOLT_REST_OPACITY, depthWrite: false,
		blending: AdditiveBlending, fog: false,
	}));
	bolts.name = "bolts";
	// Its own index (copied per cage, freed with it) over the bolts' positions
	const haloGeometry = new BufferGeometry();
	haloGeometry.setAttribute("position", geometry.attributes.position);
	haloGeometry.setIndex(HALO_INDEX.slice());
	haloGeometry.setDrawRange(0, HALO_MAIN);
	const halo = new Points(haloGeometry, new PointsMaterial({
		color: HALO_COLOR, map: dot, transparent: true, opacity: BOLT_REST_OPACITY, depthWrite: false,
		blending: AdditiveBlending, fog: false,
	}));
	halo.name = "halo";
	group.add(core, halo, bolts);
	return { group, core, bolts, halo, t: 0 };
}

// Layer 0 stays on: the object still draws normally, the bloom pass adds its glow
function glowOn(object, on) {
	return on ? object.layers.enable(BLOOM_LAYER) : object.layers.disable(BLOOM_LAYER);
}

function freeCage(cage) {
	cage.group.removeFromParent();
	cage.core.material.dispose();
	cage.bolts.geometry.dispose();
	cage.halo.geometry.dispose();
	cage.bolts.material.dispose();
	cage.halo.material.dispose();
}

/**
 * @description Shaken's cages, in a row in opts.root over the piece's head (they follow its lift, drag and drop). The row follows
 * opts.left; a cage it loses bursts (none under opts.reduce), the others keep their places until it's gone. While the piece is also Marked
 * (opts.siblings), the centre cage's core is Marked's skull (of two, the left one)
 * @param  {[Mesh]} pieceMesh [unused: opts.mesh is the current one]
 * @param  {[object]} opts [statusFx/index.js's: { s, id, left, by, square, mode, slot, slots, mesh, root, squareRoot, reduce, cheap,
 * fresh }, updated in place]
 * @return {[object]} { update(dt), burst(), animating(), dispose() }
 */
export function create(pieceMesh, opts) {
	const texture = useGlyph();
	const row = new Group();
	row.name = "shakenCages";
	opts.root.add(row);
	const cages = [];
	const dying = [];
	// The strike flash: struck from our strike branch below (one clock), gone on burst()
	let strikeFlash = shakenFlash.make(pieceMesh, opts, dot);
	opts.root.add(strikeFlash.object);
	opts.squareRoot.add(strikeFlash.ground);
	let clock = 0;
	let since = FLASH_SECONDS;
	let striking = 0;
	// burst() was called: opts.left stays at its last value
	let ended = false;
	// Marked's skull, made on first need
	let skull = null;
	// The row's laid-out cage count
	let slots = 0;
	let dotSize = 0;

	// A declaration, not a closure made each frame. Under cheap the halo is hidden
	function glow(cage) {
		glowOn(cage.bolts, !opts.cheap);
		glowOn(cage.halo, !opts.cheap);
		cage.halo.visible = !opts.cheap;
		cage.halo.material.size = dotSize;
	}

	function lose(cage) {
		if (opts.reduce) {
			freeCage(cage);
		} else {
			cage.t = 0;
			dying.push(cage);
		}
	}

	// The cage count the row was last laid out for, and its cage size
	let laid = -1;
	let laidSize = 0;

	function update(dt) {
		const count = ended ? 0 : cageCount(opts.left);
		let grew = false;
		while (cages.length > count) { lose(cages.pop()); }
		while (cages.length < count) {
			const cage = makeCage(texture);
			row.add(cage.group);
			cages.push(cage);
			grew = true;
		}
		for (let i = dying.length - 1; i >= 0; i--) {
			const cage = dying[i];
			cage.t += dt;
			if (opts.reduce || cage.t >= BURST_SECONDS) {
				dying.splice(i, 1);
				freeCage(cage);
			}
		}
		// The row closes up (and resizes) once a lost cage has burst
		if (grew || !dying.length) {
			slots = cages.length;
			for (let i = 0; i < slots; i++) { cages[i].group.position.set((i - (slots - 1) / 2) * CAGE_SPACING, 0, 0); }
		}
		// The root is in piece units. The layout is worked out only when the row's cage count changes, not as an object a frame
		const box = opts.mesh.geometry && opts.mesh.geometry.boundingBox;
		const size = (slots === laid ? laidSize : (laidSize = cageLayout(laid = slots).size)) / (opts.mesh.scale.y || 1);
		dotSize = pointSize(HALO_SIZE * size, opts.mesh);
		row.scale.setScalar(size);
		row.position.set(0, (box ? box.max.y : 1) + CAGE_LIFT + size / 2, 0);
		if (strikeFlash) { strikeFlash.update(dt); }
		if (!opts.reduce && cages.length) {
			clock += dt;
			since += dt;
			if (clock >= STRIKE_SECONDS) {
				clock %= STRIKE_SECONDS;
				since = 0;
				striking = (striking + 1) % cages.length;
				const position = cages[striking].bolts.geometry.attributes.position;
				boltPoints(position.array);
				position.needsUpdate = true;
				// The cage as the row lays it out (slots, not cages.length, while a lost cage bursts)
				if (strikeFlash) { strikeFlash.strike(striking, slots); }
			}
		}
		const fade = opts.mesh.userData.opacity ?? 1;
		const flashLevel = opts.reduce ? 0 : flash(since);
		const marked = opts.siblings.includes("marked");
		const centre = cages[Math.floor((cages.length - 1) / 2)];
		if (marked && !skull) { skull = skullMap(); }
		const forked = opts.reduce ? 0 : forks(since, opts.cheap);
		for (let i = 0; i < cages.length; i++) {
			const cage = cages[i];
			const lit = i === striking % cages.length ? flashLevel : 0;
			const shown = lit ? forked : 0;
			glow(cage);
			cage.bolts.geometry.setDrawRange(0, MAIN_VERTS + shown * FORK_VERTS);
			cage.halo.geometry.setDrawRange(0, HALO_MAIN + shown * 2);
			cage.bolts.material.opacity = cage.halo.material.opacity = (BOLT_REST_OPACITY + (1 - BOLT_REST_OPACITY) * lit) * fade;
			cage.core.material.opacity = (0.85 + 0.15 * lit) * fade;
			cage.core.material.map = marked && cage === centre ? skull : texture;
		}
		for (const cage of dying) {
			glow(cage);
			const look = burstLook(cage.t);
			cage.group.scale.setScalar(look.scale);
			cage.bolts.geometry.setDrawRange(0, MAIN_VERTS);
			cage.halo.geometry.setDrawRange(0, HALO_MAIN);
			cage.bolts.material.opacity = cage.halo.material.opacity = look.opacity * fade;
			cage.core.material.opacity = look.opacity * fade;
			// A bursting cage is Shaken's own: Marked's skull floats again once Shaken ends
			cage.core.material.map = texture;
		}
	}

	update(0);
	return {
		update,
		burst() {
			ended = true;
			// No flash over bursting cages
			if (strikeFlash) {
				strikeFlash.dispose();
				strikeFlash = null;
			}
			if (opts.reduce) { return 0; }
			while (cages.length) { lose(cages.pop()); }
			return BURST_SECONDS * 1000;
		},
		animating() {
			return !opts.reduce && (cages.length > 0 || dying.length > 0);
		},
		dispose() {
			[...cages, ...dying].forEach(freeCage);
			cages.length = dying.length = 0;
			row.removeFromParent();
			if (strikeFlash) {
				strikeFlash.dispose();
				strikeFlash = null;
			}
			dropGlyph();
			if (skull) { skull.dispose(); }
		},
	};
}
