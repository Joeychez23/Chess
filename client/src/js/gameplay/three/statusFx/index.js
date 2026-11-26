// The status effect frame: every status on every piece of a Chess Cards view shown on the 3D board, as effects (one module
// per status) or as badges (badges.js), the hover text naming them, and the effects following their piece through the pick,
// the drag and the drop (children of its mesh)
import { Group } from "three";
import { view, requestRender, center, fileOf, rowOf } from "../index.js";
import * as warded from "./warded/warded.js";
import * as frozen from "./frozen/frozen.js";
import * as shaken from "./shaken/shaken.js";
import * as marked from "./marked.js";
import * as hex from "./hex.js";
import * as badges from "./badges.js";
import * as sigils from "./sigils.js";
import * as trapdoor from "./trapdoor.js";
import * as statusFxLists from "./statusFx.lists.js";
import { REDUCE } from "../constants.js";
import { setBloom } from "../bloom.js";
export { ringList, wardIds, springSquare, statusList, diffStatuses } from "./statusFx.lists.js";

/**
 * @description The effect module of each status, for the "effects" mode. Every module exports
 * create(pieceMesh, opts) -> { update(dt), burst(), animating(), dispose() }:
 * - create: makes the effect. Put what follows the piece in opts.root (a Group, a child of the piece's mesh, in piece units: it lifts,
 *   drags, drops and turns with it) and what belongs to the board square the server's view gives (Marked's glow) in opts.squareRoot
 *   (a Group on the board at that square's centre, y 0, world units: a lifted or dragged piece leaves it there).
 *   The frame adds and removes both roots; the module removes nothing of theirs but its own objects.
 * - opts (one object per live status, updated in place: read it in update, never copy it):
 *   { s, id (the piece's id), left (turns left, null: permanent), by (the caster's colour, missing when the server strips it),
 *   square (the view's square, "e4"), mode ("effects"), slot and slots (this status's place among the piece's shown statuses: 0..slots-1),
 *   siblings (the names of the piece's other shown statuses, ["marked"]: for looks that share the piece, such as Marked's skull in
 *   Shaken's cage and the enchantment rings),
 *   mesh (the piece's mesh now: syncFromBoard can hand the piece another one, the frame then moves opts.root onto it), root, squareRoot,
 *   reduce (true under prefers-reduced-motion: draw a still look, no loop; it can change while live, update(0) follows),
 *   cheap (true on a phone or once the frame rate collapses: no BLOOM_LAYER, half the motes/particles/bolts; it can turn on while live,
 *   update(0) follows),
 *   fresh (true when the status appeared after this mount's first sync on a piece the last sync showed; read it in create only (false
 *   after). False on a first sync, a remount, a mode switch, a mesh swap's re-create, a piece out of the fog or a veil lifting) }
 * - update(dt): on every frame drawn while the effect is live (dt in seconds, at most 0.1; 0 on a change: left, square, slot, by,
 *   siblings, mesh or reduce). Animate from it
 * - animating(): true while the effect needs frames to move (a pulse, a spin, a fade in). Asked after each sync and each frame: while one
 *   says true (and reduce is off) the frame asks for frames at about FX_FPS; once all say false the board draws only on demand and update
 *   is next called on some other frame (a sync, the camera). A still effect returns false.
 *   Under reduced motion no frames are asked for, whatever it says
 * - burst(): the status ended with its piece still on the board (Shaken's last cage, Frozen's shards). Return how many ms it plays:
 *   update runs on frames for that long, then dispose (0 or nothing: dispose at once). Never called for a mode switch, a taken piece,
 *   one the fog hides or under reduced motion: those only dispose
 * - dispose(): free its own geometries, materials and textures, and take its objects off the roots
 * The piece's own setOpacity (a hover fade, a capture's fade) leaves the roots' materials alone; at opacity 0 the mesh is hidden and
 * opts.root with it. Read opts.mesh.userData.opacity to fade along.
 * The frame doesn't sync while a piece is in flight (view.anims) or while an answer's board steps play (holdStatuses): effects never
 * jump between meshes mid-step
 */
export const MODULES = {
	warded, frozen, shaken, marked, hexed: hex,
	// The enchantments' rings (statusList adds them from view.enchant, RINGS below holds their text) and the trapdoor (a square's,
	// not a piece's: no mesh, all in squareRoot, the same in either mode). A new status still needs its module here, its row in
	// STATUSES in statusFx.lists.js (statusList shows no other) and its [fill, ring] in badges.js COLORS (else a white badge)
	"heavy-cavalry": sigils, "heretical-subjection": sigils, "opposing-finality": sigils, trapdoor,
};

// The rings' hover text, shortened from the cards' text (cards-engine/cards/active/*.js: the client doesn't load the catalog)
const RINGS = {
	// One knight, no partner (the two-knight card was removed 2026-11-25): its other knight is Warded
	"heavy-cavalry": ["Heavy Cavalry", "the friendly pieces this knight could move to are Warded, except the king."],
	"heretical-subjection": ["Heretical Subjection", "moves without a card, like a bishop or like a king."],
	"opposing-finality": ["Opposing Finality", "if it's captured, the opponent hands its owner a piece one stage below it."],
};
const STATUS_TEXT = { ...statusFxLists.STATUSES, ...RINGS };
// Frames asked for while an effect animates (the board only draws on demand)
const FX_FPS = 30;
// Seconds: the first frame after a hidden tab or an idle spell doesn't jump an effect ahead
const MAX_DT = 0.1;

// "pieceId:status" -> { fx, opts, mode }
const live = new Map();
// Bursting: { fx, opts, until (ms, performance.now's clock) }
const ending = new Set();
// Square -> the statuses shown there at the last sync, for the hover text
let shown = new Map();
let timer = null;
let lastNow = null;
let hoverSquare = null;
let pickSquare = null;
// The latest tapped or keyboard-focused square
let pointSquare = null;
let focusSquare = null;
let hoverBox = null;
// The view the board's steps moved past (holdStatuses)
let stale = null;
// The last sync put off: [cardsView, mode]
let pending = null;
// The last view synced, for a trapdoor's spring (springSquare)
let last = null;
// The keys the last sync's view had (before the no-mesh cut), null: no sync yet this mount. A key not in it is opts.fresh
let seen = null;
// The last sync's pieces: id -> true when its veiled statuses were hidden (the viewer's own, game on). A status coming out of the
// fog or from under a lifted veil is not a fresh gain
let seenOn = null;
// A median frame slower than this (under 20 fps while the frame asks for FX_FPS) is a collapse
export const SLOW_MS = 50;
// How long a collapse must last
const WINDOW_MS = 2000;
// A window decides from at least 8 gaps; a gap over 1 s is a hidden tab or a stall, not a frame rate
const MIN_GAPS = 8;
const MAX_GAP_MS = 1000;
// The window's frame gaps, preallocated: no per-frame allocation
const gaps = new Float64Array(512);
// null until the first status of a mount decides it
let cheap = null;
let gapCount = 0;
let gapStart = null;

/**
 * @description Whether the effects use their cheap look: on the phone profile, or when the median frame of a timed window is slower
 * than SLOW_MS
 * @param  {[object]} o [{ coarse: (pointer: coarse) matches, frameMs: the median frame in ms, null/undefined: not timed }]
 * @return {[boolean]}
 */
export function decideCheap({ coarse, frameMs }) {
	return Boolean(coarse) || (frameMs != null && frameMs > SLOW_MS);
}

// The switch changed (or was first decided): every status hears it in place, the bloom follows
function setCheap(on) {
	if (on === cheap) { return; }
	cheap = on;
	for (const l of live.values()) {
		l.opts.cheap = on;
		l.fx.update(0);
	}
	for (const e of ending) { e.opts.cheap = on; }
	setBloom(!on);
}

// One frame gap while the effects ask for frames; a window of 2 s and 8 gaps (or a full buffer) decides. It only ever turns cheap on:
// it backs off only on the next mount (no flip-flopping)
function timeFrame(gap, now) {
	if (cheap) { return; }
	// A hidden tab or a stall: start a fresh window, so a few janky frames on return can't decide it
	if (gap > MAX_GAP_MS) {
		gapCount = 0;
		gapStart = null;
		return;
	}
	if (gapStart === null) { gapStart = now; }
	gaps[gapCount++] = gap;
	if ((now - gapStart < WINDOW_MS || gapCount < MIN_GAPS) && gapCount < gaps.length) { return; }
	const sorted = gaps.subarray(0, gapCount).sort();
	setCheap(decideCheap({ coarse: false, frameMs: sorted[gapCount >> 1] }));
	gapCount = 0;
	gapStart = null;
}

function atSquare(root, square) {
	root.position.set(center(fileOf(square)), 0, center(rowOf(square)));
}

function onMesh(opts, mesh) {
	opts.mesh = mesh;
	mesh.add(opts.root);
	// pieces.js disposePiece calls it: the effects go with their piece
	mesh.userData.disposeStatuses = () => dropMesh(mesh);
}

function make(key, w, mode, fresh = false) {
	const root = new Group();
	const squareRoot = new Group();
	const trap = w.s === "trapdoor";
	const mesh = trap ? null : view.pieces.get(w.square);
	root.name = squareRoot.name = "statusFx";
	// Once a mount, as three/index.js mount decides the phone
	if (cheap === null) { setCheap(decideCheap({ coarse: window.matchMedia("(pointer: coarse)").matches })); }
	const opts = { ...w, mode, mesh, root, squareRoot, reduce: REDUCE.matches, cheap, fresh };
	// The trap is the square's: no piece, all in squareRoot, the same in either mode
	if (!trap) { onMesh(opts, mesh); }
	atSquare(squareRoot, w.square);
	view.scene.add(squareRoot);
	live.set(key, { fx: (mode === "badges" && !trap ? badges : MODULES[w.s]).create(mesh, opts), opts, mode });
	// Read at create only: never seen by update or the ending copy
	opts.fresh = false;
}

function free(l) {
	l.fx.dispose();
	l.opts.root.removeFromParent();
	l.opts.squareRoot.removeFromParent();
}

function end(key, burst) {
	const l = live.get(key);
	live.delete(key);
	const ms = burst && !REDUCE.matches ? Number(l.fx.burst()) || 0 : 0;
	if (ms > 0) {
		ending.add({ ...l, until: performance.now() + ms });
	} else {
		free(l);
	}
}

function dropMesh(mesh) {
	for (const [key, l] of live) {
		if (l.opts.mesh === mesh) {
			live.delete(key);
			free(l);
		}
	}
	for (const e of ending) {
		if (e.opts.mesh === mesh) {
			ending.delete(e);
			free(e);
		}
	}
	pump();
}

// Frames while an effect animates or a burst plays, none under reduced motion (as fire.js and clock.js). Badges are still: they're
// redrawn on a sync
function pump() {
	const need = !REDUCE.matches && (ending.size > 0 || [...live.values()].some((l) => l.fx.animating?.()));
	if (need && !timer) {
		timer = setInterval(requestRender, 1000 / FX_FPS);
		// The on-demand idle before it is no frame gap
		lastNow = null;
	} else if (!need && timer) {
		clearInterval(timer);
		timer = null;
		lastNow = null;
		// The window counts only while the effects animate
		gapCount = 0;
		gapStart = null;
	}
}

// Reduced motion turned on or off: every effect hears it, a playing burst ends, the frames follow
REDUCE.addEventListener("change", function () {
	for (const l of live.values()) {
		l.opts.reduce = REDUCE.matches;
		l.fx.update(0);
	}
	if (REDUCE.matches) {
		ending.forEach(free);
		ending.clear();
	}
	pump();
	requestRender();
});

/**
 * @description An answer's board step starts (renderer/index.js boardStep3D): the pieces move past this view, so it isn't synced again
 * (the meshes no longer stand as it says, between steps too). The next view (the answer's set) syncs as usual
 * @param  {[object|null]} cardsView [the view on the board as the step starts]
 */
export function holdStatuses(cardsView) {
	stale = cardsView;
}

/**
 * @description Shows a Chess Cards view's statuses on the 3D board in a mode: diffs them against the live ones (diffStatuses) and
 * creates, updates, swaps or ends each, then moves an effect onto its piece's mesh when the board gave the piece another. Call it once
 * the board's pieces stand as the view says (renderer/index.js drawBoard). A status whose square has no mesh (a board step took it) ends
 * without a burst. Put off while a piece is in flight (view.anims: the next frame after the flights end runs the last one put off) and
 * for a view the board's steps moved past (holdStatuses)
 * @param  {[object|null]} cardsView [the server's view, null for none: everything ends]
 * @param  {[string]} mode ["effects" or "badges", anything else is "effects"]
 */
export function syncStatuses(cardsView, mode) {
	if (!view) { return; }
	pending = null;
	// The next view syncs
	if (cardsView && cardsView === stale) { return; }
	// A slide moves view.pieces as it starts: the meshes and the view agree again once it ends
	if (view.anims.size) {
		pending = [cardsView, mode];
		return;
	}
	stale = null;
	mode = mode === "badges" ? "badges" : "effects";
	const { want, onBoard } = cardsView ? statusFxLists.statusList(cardsView) : { want: new Map(), onBoard: new Set() };
	const was = seen;
	const wasOn = seenOn;
	function veiled(w) {
		return ((cardsView.statuses || {})[w.id] || []).some((e) => e.s === w.s && e.veiled);
	}
	const prev = last;
	function wasCut(e) {
		return (prev.enchant || []).some((o) => o.id === e.id && statusFxLists.baseOf(o.key) === "heavy-cavalry" && statusFxLists.cut(o));
	}
	// A ward only Heavy Cavalry gives counts as fresh only from an enchant the fog didn't cut at the last sync
	function wardSeen(w) {
		return w.s !== "warded" || ((cardsView.statuses || {})[w.id] || []).some((e) => e.s === "warded")
			|| (cardsView.enchant || []).some((e) => statusFxLists.baseOf(e.key) === "heavy-cavalry" && !wasCut(e)
				&& statusFxLists.wardIds({ ...cardsView, enchant: [e] }).has(w.id));
	}
	// Fresh: its piece was shown at the last sync and its veil didn't hide it
	function fresh(key, w) {
		return was !== null && !was.has(key) && wasOn.has(w.id) && !(wasOn.get(w.id) && veiled(w)) && wardSeen(w);
	}
	// A null view: the next view is a first sync again
	seen = cardsView ? new Set(want.keys()) : null;
	seenOn = cardsView ? new Map(cardsView.board.sq.filter(Boolean).map((p) => [p.id, p.c === cardsView.you && !cardsView.result])) : null;
	for (const [key, w] of want) {
		if (w.s !== "trapdoor" && !view.pieces.get(w.square)) {
			want.delete(key);
			onBoard.delete(w.id);
		}
	}
	const sprang = statusFxLists.springSquare(last, cardsView);
	last = cardsView;
	const plan = statusFxLists.diffStatuses(live, want, mode, onBoard);
	// The open trap ends without a burst ("trapdoor" is no piece on the board)
	plan.end.forEach(({ key, burst }) => end(key, burst));
	// Both players see the trap snap: one burst(), then stepStatuses plays and frees it
	if (sprang) {
		make("sprung", { s: "trapdoor", square: sprang, left: null, sprung: true }, "effects");
		end("sprung", true);
	}
	plan.swap.forEach((key) => {
		free(live.get(key));
		live.delete(key);
		make(key, want.get(key), mode);
	});
	// A swap, a mesh swap's re-create, a first sync, a fog or veil reveal: not fresh
	plan.create.forEach((key) => make(key, want.get(key), mode, fresh(key, want.get(key))));
	for (const key of plan.update) {
		const l = live.get(key);
		const moved = l.opts.square !== want.get(key).square;
		Object.assign(l.opts, want.get(key));
		if (moved) { atSquare(l.opts.squareRoot, l.opts.square); }
	}
	for (const [key, l] of live) {
		// A square's: a piece standing there isn't its mesh
		if (l.opts.s === "trapdoor") { continue; }
		const mesh = view.pieces.get(l.opts.square);
		if (mesh !== l.opts.mesh) {
			onMesh(l.opts, mesh);
			plan.update.push(key);
		}
	}
	new Set(plan.update).forEach((key) => live.get(key).fx.update(0));
	shown = new Map();
	for (const w of want.values()) {
		if (w.s !== "trapdoor") { shown.set(w.square, [...(shown.get(w.square) || []), w]); }
	}
	showText();
	pump();
	requestRender();
}

/**
 * @description Each frame (three/index.js frame): steps every live and bursting effect, and frees a burst that has played out
 * @param  {[number]} now [the frame's time, ms]
 */
export function stepStatuses(now) {
	if (pending && !view.anims.size) { syncStatuses(...pending); }
	const dt = lastNow === null ? 0 : Math.min(MAX_DT, Math.max(0, now - lastNow) / 1000);
	// Only while the effects ask for frames: on demand, a gap is idle time, not a slow frame
	if (timer && lastNow !== null) { timeFrame(now - lastNow, now); }
	lastNow = now;
	for (const l of live.values()) { l.fx.update(dt); }
	for (const e of ending) {
		if (now >= e.until) {
			ending.delete(e);
			free(e);
		} else {
			e.fx.update(dt);
		}
	}
	pump();
}

/**
 * @description Ends every effect at once, no bursts, and takes the hover text away (three/index.js unmount, a test's start)
 */
export function clearStatuses() {
	for (const l of live.values()) { free(l); }
	for (const e of ending) { free(e); }
	live.clear();
	ending.clear();
	shown = new Map();
	pump();
	hoverSquare = pickSquare = pointSquare = focusSquare = null;
	stale = pending = last = seen = seenOn = null;
	// The next mount decides cheap again
	cheap = gapStart = null;
	gapCount = 0;
	if (hoverBox) {
		hoverBox.remove();
		hoverBox = null;
	}
}

/**
 * @description The live statuses, for the tests: { key, mode, opts }
 * @return {[array]}
 */
export function liveStatuses() {
	return [...live].map(([key, l]) => ({ key, mode: l.mode, opts: l.opts }));
}

/**
 * @description The hover text of a square: each status shown there, its name, its turns left (none for a permanent one) and what it
 * does, a line each. "" for none
 * @param  {[string|null]} square ["e4"]
 * @return {[string]}
 */
export function statusText(square) {
	return (shown.get(square) || [])
		.map((w) => `${STATUS_TEXT[w.s][0]}${w.left === null ? "" : ` (${w.left} turn${w.left === 1 ? "" : "s"} left)`}: ${STATUS_TEXT[w.s][1]}`)
		.join("\n");
}

/**
 * @description The pointer is over this square (three/pointer/tileHover.js), null off the board: the status text shows its piece's statuses
 * (showText)
 * @param  {[string|null]} square
 */
export function hoverStatuses(square) {
	hoverSquare = square;
	showText();
}

/**
 * @description The picked piece's square (renderer/index.js holdTablePiece3D: a pick by the keys, a tap or a click), null when none
 * is: the status text shows its statuses while the pointer isn't over a piece with some
 * @param  {[string|null]} square
 */
export function pickStatuses(square) {
	if (square === pickSquare) { return; }
	pickSquare = square;
	showText();
}

/**
 * @description A finger's tap on a square (three/pointer/index.js pickTable), any piece's, the opponent's too (touch has no hover): the
 * status text shows its statuses until the next tap or keyboard focus. An empty square or one with none takes it away
 * @param  {[string|null]} square
 */
export function tapStatuses(square) {
	pointSquare = square;
	showText();
}

/**
 * @description The keyboard's square on the table (three/index.js highlightSquares, on every table refresh), null for none: when it
 * moves, the status text shows its statuses
 * @param  {[string|null]} square
 */
export function focusStatuses(square) {
	// A refresh with the same focus leaves a later tap's text
	if (square === focusSquare) { return; }
	focusSquare = pointSquare = square;
	showText();
}

// The status text, in either mode: the hovered piece's, else the tapped or keyboard-focused one's, else the picked one's. On the right
// of the screen (the lifted card's preview is on the left), as a live region a screen reader reads out
function showText() {
	const text = statusText(hoverSquare) || statusText(pointSquare) || statusText(pickSquare);
	if (!text && !hoverBox) { return; }
	if (!hoverBox) {
		hoverBox = document.createElement("div");
		// Styled in board3D.css
		hoverBox.className = "statusHover";
		hoverBox.setAttribute("role", "status");
		hoverBox.setAttribute("aria-live", "polite");
		document.body.append(hoverBox);
	}
	if (hoverBox.textContent !== text) { hoverBox.textContent = text; }
	hoverBox.hidden = !text;
}
