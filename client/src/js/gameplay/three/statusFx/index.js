// The status effect frame: every status on every piece of a Chess Cards view shown on the 3D board, as effects (one module
// per status) or as badges (badges.js), the hover text naming them, and the effects following their piece through the pick,
// the drag and the drop (children of its mesh)
import { Group } from "three";
import { view, requestRender, center, fileOf, rowOf } from "../index.js";
import * as warded from "./warded.js";
import * as frozen from "./frozen.js";
import * as shaken from "./shaken.js";
import * as marked from "./marked.js";
import * as hex from "./hex.js";
import * as badges from "./badges.js";
import * as sigils from "./sigils.js";
import * as trapdoor from "./trapdoor.js";
import { REDUCE } from "../constants.js";
import { setBloom } from "../bloom.js";

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
	// STATUSES below (statusList shows no other) and its [fill, ring] in badges.js COLORS (else a white badge)
	"heavy-cavalry": sigils, "heretical-subjection": sigils, "opposing-finality": sigils, trapdoor,
};

// The hover text: no client file describes a status (the catalog describes cards), so a fixed table from the engine's rules
// (cards-engine/rules.js, turn.js, ctx.js capture)
const STATUSES = {
	warded: ["Warded", "can't be captured."],
	frozen: ["Frozen", "can't move."],
	shaken: ["Shaken", "can't capture."],
	marked: ["Marked", "whoever captures it draws a move card, and its owner discards 2 random cards."],
	hexed: ["Hexed", "no card can move it."],
};
// The rings' hover text, shortened from the cards' text (cards-engine/cards/active/*.js: the client doesn't load the catalog)
const RINGS = {
	// One knight, no partner (the two-knight card was removed 2026-11-25): its other knight is Warded
	"heavy-cavalry": ["Heavy Cavalry", "the friendly pieces this knight could move to are Warded, except the king."],
	"heretical-subjection": ["Heretical Subjection", "moves without a card, like a bishop or like a king."],
	"opposing-finality": ["Opposing Finality", "if it's captured, the opponent hands its owner a piece one stage below it."],
};
const STATUS_TEXT = { ...STATUSES, ...RINGS };
// Frames asked for while an effect animates (the board only draws on demand)
const FX_FPS = 30;
// Seconds: the first frame after a hidden tab or an idle spell doesn't jump an effect ahead
const MAX_DT = 0.1;
// A change to one of these is an update, not a re-create (compared as strings: siblings is a new list each sync)
const UPDATE_FIELDS = ["left", "by", "square", "slot", "slots", "siblings", "ringSlot", "ringSlots"];

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

// 0 = a8, the engine's order (cards-engine/board.js sqName)
function squareName(i) {
	return "abcdefgh"[i % 8] + (8 - Math.floor(i / 8));
}

function idOf(key) {
	return key.slice(0, key.lastIndexOf(":"));
}

// A version's key to its card's (cards-engine/cards/index.js baseKey)
function baseOf(key) {
	return key.replace(/-epic$/, "");
}

// A Heavy Cavalry the fog cut its knight from (view.js scrub): it has none (pieces [] would read as a8), so no ring and no ward
function cut(enchant) {
	return enchant.pieces.length !== 1;
}

const KNIGHT_JUMPS = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];

function knightSquares(i) {
	return KNIGHT_JUMPS
		.map(([dr, df]) => [(i >> 3) + dr, (i & 7) + df])
		.filter(([r, f]) => r >= 0 && r < 8 && f >= 0 && f < 8)
		.map(([r, f]) => r * 8 + f);
}

/**
 * @description The enchantment rings a view shows, by piece id, in view.enchant's order: Heavy Cavalry (either version) on its
 * enchanted knight (pieces[0]), Heretical Subjection on each of its bishops still its owner's bishop (one handed over loses it: the
 * engine stops moving it), Opposing Finality on its piece; only on the view's board (fog)
 * @param  {[object]} cardsView [the server's view: board.sq, enchant]
 * @return {[Map]} pieceId -> [{ s, left }]
 */
export function ringList(cardsView) {
	const rings = new Map();
	const sq = cardsView.board.sq;
	function at(id) {
		return sq.find((p) => p && p.id === id);
	}
	function add(id, s, left) {
		return rings.set(id, [...(rings.get(id) || []), { s, left: left ?? null }]);
	}
	for (const e of cardsView.enchant || []) {
		const s = baseOf(e.key);
		if ((s === "heavy-cavalry" && !cut(e)) || s === "opposing-finality") {
			if (at(e.pieces[0])) { add(e.pieces[0], s, e.left); }
		} else if (s === "heretical-subjection") {
			e.pieces.forEach((id) => {
				const p = at(id);
				if (p && p.c === e.owner && p.t === "b") { add(id, s, e.left); }
			});
		}
	}
	return rings;
}

/**
 * @description The pieces Heavy Cavalry wards in a view (the engine's canCapture rule): the owner's non-king pieces on the squares the
 * enchanted knight could move to, never the partner, while both knights are the owner's, on the board and a knight's move apart (the
 * epic version has no partner)
 * @param  {[object]} cardsView [the server's view: board.sq, enchant]
 * @return {[Set]} piece ids
 */
export function wardIds(cardsView) {
	const ids = new Set();
	const sq = cardsView.board.sq;
	for (const e of cardsView.enchant || []) {
		if (baseOf(e.key) !== "heavy-cavalry" || cut(e)) { continue; }
		const at = e.pieces.map((id) => sq.findIndex((p) => p && p.id === id));
		const knightsStand = at.every((i) => i >= 0 && sq[i].c === e.owner && sq[i].t === "n");
		if (!knightsStand || (at.length > 1 && !knightSquares(at[0]).includes(at[1]))) { continue; }
		for (const i of knightSquares(at[0])) {
			const p = sq[i];
			if (p && p.c === e.owner && p.t !== "k" && p.id !== e.pieces[1]) { ids.add(p.id); }
		}
	}
	return ids;
}

/**
 * @description Where a Trapdoor sprang between two synced views, null for none: a trapdoor entry the last view had is gone while the
 * game is on (both views: a finished one shows every trap's square). Its owner knows the square (the old entry's data.square): a spring
 * left an enemy piece Frozen on it (a drop ends the trap too, cards-engine turn.js drop). The other player's trap has no square in the
 * view, so it's the square of the viewer's piece newly Frozen.
 * shortcut: one spring a sync and the first newly Frozen piece; two at once would need the engine's event, fine while a trap is the only
 * thing freezing on a move. A long slide (3+ squares) can outlast Card Guy's 500 ms wait, so two answers merge into one sync (pending
 * keeps the newest): a trap played and sprung inside that window shows no snap (its statuses still do). Upgrade by diffing each view as
 * it arrives and carrying the square in pending, if that's ever seen in play
 * @param  {[object|null]} was [the last view synced]
 * @param  {[object|null]} now [the view syncing]
 * @return {[string|null]} "d5"
 */
export function springSquare(was, now) {
	if (!was || !now || was.result || now.result) { return null; }
	function traps(v) {
		return (v.enchant || []).filter((e) => baseOf(e.key) === "trapdoor");
	}
	const still = traps(now).map((e) => e.id);
	const gone = traps(was).filter((e) => !still.includes(e.id));
	function isFrozen(v, id) {
		return ((v.statuses || {})[id] || []).some((e) => e.s === "frozen");
	}
	for (const e of gone.filter((e) => e.data && e.data.square)) {
		const p = now.board.sq[rowOf(e.data.square) * 8 + fileOf(e.data.square)];
		if (p && p.c !== e.owner && isFrozen(now, p.id)) { return e.data.square; }
	}
	// Only the owner's own traps ended, none sprang: not the other player's either
	if (!gone.some((e) => !(e.data && e.data.square))) { return null; }
	const i = now.board.sq.findIndex((p) => p && p.c === now.you && isFrozen(now, p.id) && !isFrozen(was, p.id));
	return i < 0 ? null : squareName(i);
}

/**
 * @description The statuses a view shows, by "pieceId:status": a known status on a piece on the view's board (fog: a hidden piece isn't
 * there), a veiled one unless the viewer owns its piece while the game is on (the server strips that case, and sends it in a finished
 * game and to the old owner after a handover), and the ids on the board
 * @param  {[object]} cardsView [the server's view: board.sq, statuses, you, result]
 * @return {[object]} { want: Map key -> { id, s, left, by, square, slot, slots, siblings }, onBoard: Set of piece ids }
 */
export function statusList(cardsView) {
	const want = new Map();
	const onBoard = new Set();
	const all = cardsView.statuses || {};
	const rings = ringList(cardsView);
	const ward = wardIds(cardsView);
	cardsView.board.sq.forEach(function (p, i) {
		if (!p) { return; }
		onBoard.add(p.id);
		// A backup of the server's strip of the viewer's own veiled statuses: it sends the rest
		const list = (all[p.id] || []).filter((e) => STATUSES[e.s] && !(e.veiled && p.c === cardsView.you && !cardsView.result));
		// Heavy Cavalry's ward: one aura and one line with a real warded
		if (ward.has(p.id) && !list.some((e) => e.s === "warded")) { list.push({ s: "warded", left: null }); }
		const ring = rings.get(p.id) || [];
		// Concentric rings, 0 the inner
		ring.forEach((r, ringSlot) => list.push({ ...r, ringSlot, ringSlots: ring.length }));
		list.forEach((e, slot) => want.set(`${p.id}:${e.s}`, {
			id: p.id, s: e.s, left: e.left ?? null, by: e.by, square: squareName(i), slot, slots: list.length,
			siblings: list.filter((o) => o !== e).map((o) => o.s), ringSlot: e.ringSlot, ringSlots: e.ringSlots,
		}));
	});
	// The open trap: only its owner's view (a finished game's too) has its square
	for (const e of cardsView.enchant || []) {
		if (baseOf(e.key) === "trapdoor" && e.data && e.data.square) {
			want.set(`trapdoor:${e.id}`, { id: "trapdoor", s: "trapdoor", left: null, square: e.data.square });
		}
	}
	return { want, onBoard };
}

/**
 * @description What to do to the live statuses for the ones wanted now: create the new, update one whose left, by, square or slot
 * changed, swap one shown in the other mode (no burst), end the rest, with a burst when its piece is still on the board (its status
 * ended) and without when it's gone (taken, or hidden by the fog)
 * @param  {[Map]} was [key -> { mode, opts }]
 * @param  {[Map]} want [statusList's]
 * @param  {[string]} mode ["effects" or "badges"]
 * @param  {[Set]} onBoard [statusList's]
 * @return {[object]} { create: [key], update: [key], swap: [key], end: [{ key, burst }] }
 */
export function diffStatuses(was, want, mode, onBoard) {
	const plan = { create: [], update: [], swap: [], end: [] };
	for (const [key, liveStatus] of was) {
		const wanted = want.get(key);
		if (!wanted) {
			plan.end.push({ key, burst: onBoard.has(idOf(key)) });
		} else if (liveStatus.mode !== mode) {
			plan.swap.push(key);
		} else if (UPDATE_FIELDS.some((field) => String(liveStatus.opts[field]) !== String(wanted[field]))) {
			plan.update.push(key);
		}
	}
	for (const key of want.keys()) {
		if (!was.has(key)) { plan.create.push(key); }
	}
	return plan;
}

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
	const { want, onBoard } = cardsView ? statusList(cardsView) : { want: new Map(), onBoard: new Set() };
	const was = seen;
	const wasOn = seenOn;
	function veiled(w) {
		return ((cardsView.statuses || {})[w.id] || []).some((e) => e.s === w.s && e.veiled);
	}
	const prev = last;
	function wasCut(e) {
		return (prev.enchant || []).some((o) => o.id === e.id && baseOf(o.key) === "heavy-cavalry" && cut(o));
	}
	// A ward only Heavy Cavalry gives counts as fresh only from an enchant the fog didn't cut at the last sync
	function wardSeen(w) {
		return w.s !== "warded" || ((cardsView.statuses || {})[w.id] || []).some((e) => e.s === "warded")
			|| (cardsView.enchant || []).some((e) => baseOf(e.key) === "heavy-cavalry" && !wasCut(e)
				&& wardIds({ ...cardsView, enchant: [e] }).has(w.id));
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
	const sprang = springSquare(last, cardsView);
	last = cardsView;
	const plan = diffStatuses(live, want, mode, onBoard);
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
 * @description The pointer is over this square (three/tileHover.js), null off the board: the status text shows its piece's statuses
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
 * @description A finger's tap on a square (three/pointer.js pickTable), any piece's, the opponent's too (touch has no hover): the
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
