// The status effect frame (Task 21 S4): every status on every piece of a Chess Cards view shown on the 3D board, as effects (one module per status, S5-S7 fill them in)
// or as badges (badges.js), the hover text naming them, & the effects following their piece through the pick, the drag & the drop (children of its mesh)
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
 * @description The effect module of each status, for the "effects" mode. Every module exports create(pieceMesh, opts) -> { update(dt), burst(), animating(), dispose() }:
 * - create: makes the effect. Put what follows the piece in opts.root (a Group, a child of the piece's mesh, in piece units: it lifts, drags, drops & turns with it) & what belongs
 *   to the board square the server's view gives (Marked's glow) in opts.squareRoot (a Group on the board at that square's centre, y 0, world units: a lifted or dragged piece leaves it there).
 *   The frame adds & removes both roots; the module removes nothing of theirs but its own objects.
 * - opts (one object per live status, updated in place: read it in update, never copy it): { s, id (the piece's id), left (turns left, null: permanent), by (the caster's colour,
 *   missing when the server strips it), square (the view's square, "e4"), mode ("effects"), slot & slots (this status's place among the piece's shown statuses: 0..slots-1),
 *   siblings (the names of the piece's other shown statuses, ["marked"]: for looks that share the piece, ruling 09:19's skull in Shaken's cage, Task 22's sigils),
 *   mesh (the piece's mesh now: syncFromBoard can hand the piece another one, the frame then moves opts.root onto it), root, squareRoot,
 *   reduce (true under prefers-reduced-motion: draw a still look, no loop; it can change while live, update(0) follows),
 *   cheap (Task 24: true on a phone or once the frame rate collapses: no BLOOM_LAYER, half the motes/particles/bolts; it can turn on while live, update(0) follows),
 *   fresh (Task 24: true when the status appeared after this mount's first sync on a piece the last sync showed, read it in create only (false after): false on a first sync, a remount,
 *   a mode switch, a mesh swap's re-create, a piece out of the fog or a veil lifting (ruling T24-R14) }
 * - update(dt): on every frame drawn while the effect is live (dt in seconds, at most 0.1; 0 on a change: left, square, slot, by, siblings, mesh or reduce). Animate from it
 * - animating(): true while the effect needs frames to move (a pulse, a spin, a fade in). Asked after each sync & each frame: while one says true (& reduce is off) the frame asks for
 *   frames at about FX_FPS; once all say false the board draws only on demand & update is next called on some other frame (a sync, the camera). A still effect returns false.
 *   Under reduced motion no frames are asked for, whatever it says
 * - burst(): the status ended with its piece still on the board (Shaken's last cage, Frozen's shards). Return how many ms it plays: update runs on frames for that long, then dispose
 *   (0 or nothing: dispose at once). Never called for a mode switch, a taken piece, one the fog hides or under reduced motion: those only dispose
 * - dispose(): free its own geometries, materials & textures, & take its objects off the roots
 * The piece's own setOpacity (a hover fade, a capture's fade) leaves the roots' materials alone; at opacity 0 the mesh is hidden & opts.root with it. Read opts.mesh.userData.opacity to fade along.
 * The frame doesn't sync while a piece is in flight (view.anims) or while an answer's board steps play (holdStatuses): effects never jump between meshes mid-step
 */
export const MODULES = {
	warded, frozen, shaken, marked, hexed: hex,
	// TASK 22: THE ENCHANTMENTS' RINGS (statusList ADDS THEM FROM view.enchant, RINGS BELOW HOLDS THEIR TEXT) & THE TRAPDOOR (A SQUARE'S, NOT A PIECE'S: NO MESH, ALL IN squareRoot,
	// THE SAME IN EITHER MODE). A NEW STATUS STILL NEEDS ITS MODULE HERE, ITS ROW IN STATUSES BELOW (statusList SHOWS NO OTHER) & ITS [FILL, RING] IN badges.js COLORS (ELSE A WHITE BADGE)
	"heavy-cavalry": sigils, "heretical-subjection": sigils, "opposing-finality": sigils, trapdoor,
};

// THE HOVER TEXT: NO CLIENT FILE DESCRIBES A STATUS (THE CATALOG DESCRIBES CARDS), SO A FIXED TABLE FROM THE ENGINE'S RULES (cards-engine/rules.js, turn.js, ctx.js capture)
const STATUSES = {
	warded: ["Warded", "can't be captured."],
	frozen: ["Frozen", "can't move."],
	shaken: ["Shaken", "can't capture."],
	marked: ["Marked", "whoever captures it draws a move card, and its owner discards 2 random cards."],
	hexed: ["Hexed", "no card can move it."],
};
// THE RINGS' HOVER TEXT (T22-3), SHORTENED FROM THE CARDS' TEXT (cards-engine/cards/active/*.js: THE CLIENT DOESN'T LOAD THE CATALOG)
const RINGS = {
	"heavy-cavalry": ["Heavy Cavalry", "the friendly pieces this knight could move to are Warded, except the king."], // ONE KNIGHT, NO PARTNER (THE TWO-KNIGHT CARD WAS REMOVED 2026-11-25): ITS OTHER KNIGHT IS WARDED
	"heretical-subjection": ["Heretical Subjection", "moves without a card, like a bishop or like a king."],
	"opposing-finality": ["Opposing Finality", "if it's captured, the opponent hands its owner a piece one stage below it."],
};
const TEXT = { ...STATUSES, ...RINGS };
const FX_FPS = 30; // FRAMES ASKED FOR WHILE AN EFFECT ANIMATES (THE BOARD ONLY DRAWS ON DEMAND)
const MAX_DT = 0.1; // SECONDS: THE FIRST FRAME AFTER A HIDDEN TAB OR AN IDLE SPELL DOESN'T JUMP AN EFFECT AHEAD
const FIELDS = ["left", "by", "square", "slot", "slots", "siblings", "ringSlot", "ringSlots"]; // A CHANGE TO ONE IS AN UPDATE, NOT A RE-CREATE (COMPARED AS STRINGS: siblings IS A NEW LIST EACH SYNC)

const live = new Map(); // "pieceId:status" -> { fx, opts, mode }
const ending = new Set(); // BURSTING: { fx, opts, until (ms, performance.now's clock) }
let shown = new Map(); // SQUARE -> THE STATUSES SHOWN THERE AT THE LAST SYNC, FOR THE HOVER TEXT
let timer = null, lastNow = null, hoverSquare = null, pickSquare = null, pointSquare = null, focusSquare = null, hoverBox = null; // pointSquare: THE LATEST TAPPED OR KEYBOARD-FOCUSED SQUARE (RULING R-3)
let stale = null, pending = null; // stale: THE VIEW THE BOARD'S STEPS MOVED PAST (holdStatuses), pending: THE LAST SYNC PUT OFF, [cardsView, mode]
let last = null; // THE LAST VIEW SYNCED, FOR A TRAPDOOR'S SPRING (springSquare)
let seen = null; // THE KEYS THE LAST SYNC'S VIEW HAD (BEFORE THE NO-MESH CUT), null: NO SYNC YET THIS MOUNT. A KEY NOT IN IT IS opts.fresh (T24 J4)
let seenOn = null; // THE LAST SYNC'S PIECES: id -> true WHEN ITS VEILED STATUSES WERE HIDDEN (THE VIEWER'S OWN, GAME ON). RULING T24-R14: NO GAIN OUT OF THE FOG OR A LIFTED VEIL
export const SLOW_MS = 50; // A MEDIAN FRAME SLOWER THAN THIS (UNDER 20 FPS WHILE THE FRAME ASKS FOR FX_FPS) IS A COLLAPSE
const WINDOW_MS = 2000; // HOW LONG A COLLAPSE MUST LAST
const MIN_GAPS = 8, MAX_GAP_MS = 1000; // A WINDOW DECIDES FROM AT LEAST 8 GAPS; A GAP OVER 1 s IS A HIDDEN TAB OR A STALL, NOT A FRAME RATE
const gaps = new Float64Array(512); // THE WINDOW'S FRAME GAPS, PREALLOCATED: NO PER-FRAME ALLOCATION
let cheap = null, gapCount = 0, gapStart = null; // cheap: null UNTIL THE FIRST STATUS OF A MOUNT DECIDES IT

const squareName = (i) => "abcdefgh"[i % 8] + (8 - Math.floor(i / 8)); // 0 = a8, THE ENGINE'S ORDER (cards-engine/board.js sqName)
const idOf = (key) => key.slice(0, key.lastIndexOf(":"));
const baseOf = (key) => key.replace(/-epic$/, ""); // A VERSION'S KEY TO ITS CARD'S (cards-engine/cards/index.js baseKey)
const cut = (e) => e.pieces.length !== 1; // A HEAVY CAVALRY THE FOG CUT ITS KNIGHT FROM (view.js scrub): IT HAS NONE (pieces [] WOULD READ AS a8), SO NO RING & NO WARD
const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const knightSquares = (i) => KNIGHT.map(([dr, df]) => [(i >> 3) + dr, (i & 7) + df]).filter(([r, f]) => r >= 0 && r < 8 && f >= 0 && f < 8).map(([r, f]) => r * 8 + f);

/**
 * @description The enchantment rings a view shows (ruling T22-3), by piece id, in view.enchant's order: Heavy Cavalry (either version) on its enchanted knight (pieces[0]), Heretical
 * Subjection on each of its bishops still its owner's bishop (one handed over loses it: the engine stops moving it), Opposing Finality on its piece; only on the view's board (fog)
 * @param  {[object]} cardsView [the server's view: board.sq, enchant]
 * @return {[Map]} pieceId -> [{ s, left }]
 */
export function ringList(cardsView) {
	const rings = new Map(), sq = cardsView.board.sq, at = (id) => sq.find((p) => p && p.id === id);
	const add = (id, s, left) => rings.set(id, [...(rings.get(id) || []), { s, left: left ?? null }]);
	for (const e of cardsView.enchant || []) {
		const s = baseOf(e.key);
		if ((s === "heavy-cavalry" && !cut(e)) || s === "opposing-finality") { if (at(e.pieces[0])) { add(e.pieces[0], s, e.left); } }
		else if (s === "heretical-subjection") { e.pieces.forEach((id) => { const p = at(id); if (p && p.c === e.owner && p.t === "b") { add(id, s, e.left); } }); }
	}
	return rings;
}

/**
 * @description The pieces Heavy Cavalry wards in a view (ruling T22-2, the engine's canCapture rule): the owner's non-king pieces on the squares the enchanted knight could move to,
 * never the partner, while both knights are the owner's, on the board & a knight's move apart (the epic version has no partner)
 * @param  {[object]} cardsView [the server's view: board.sq, enchant]
 * @return {[Set]} piece ids
 */
export function wardIds(cardsView) {
	const ids = new Set(), sq = cardsView.board.sq;
	for (const e of cardsView.enchant || []) {
		if (baseOf(e.key) !== "heavy-cavalry" || cut(e)) { continue; }
		const at = e.pieces.map((id) => sq.findIndex((p) => p && p.id === id));
		if (!at.every((i) => i >= 0 && sq[i].c === e.owner && sq[i].t === "n") || (at.length > 1 && !knightSquares(at[0]).includes(at[1]))) { continue; }
		for (const i of knightSquares(at[0])) { const p = sq[i]; if (p && p.c === e.owner && p.t !== "k" && p.id !== e.pieces[1]) { ids.add(p.id); } }
	}
	return ids;
}

/**
 * @description Where a Trapdoor sprang between two synced views (ruling T22-1), null for none: a trapdoor entry the last view had is gone while the game is on (both views: a finished
 * one shows every trap's square). Its owner knows the square (the old entry's data.square): a spring left an enemy piece Frozen on it (a drop ends the trap too, cards-engine turn.js
 * drop). The other player's trap has no square in the view, so it's the square of the viewer's piece newly Frozen.
 * shortcut: one spring a sync & the first newly Frozen piece; two at once would need the engine's event, fine while a trap is the only thing freezing on a move.
 * A long slide (3+ squares) can outlast Card Guy's 500 ms wait, so two answers merge into one sync (pending keeps the newest): a trap played & sprung inside that window
 * shows no snap (its statuses still do). Upgrade by diffing each view as it arrives & carrying the square in pending, if that's ever seen in play
 * @param  {[object|null]} was [the last view synced]
 * @param  {[object|null]} now [the view syncing]
 * @return {[string|null]} "d5"
 */
export function springSquare(was, now) {
	if (!was || !now || was.result || now.result) { return null; }
	const traps = (v) => (v.enchant || []).filter((e) => baseOf(e.key) === "trapdoor"), still = traps(now).map((e) => e.id), gone = traps(was).filter((e) => !still.includes(e.id));
	const frozen = (v, id) => ((v.statuses || {})[id] || []).some((e) => e.s === "frozen");
	for (const e of gone.filter((e) => e.data && e.data.square)) {
		const p = now.board.sq[rowOf(e.data.square) * 8 + fileOf(e.data.square)];
		if (p && p.c !== e.owner && frozen(now, p.id)) { return e.data.square; }
	}
	if (!gone.some((e) => !(e.data && e.data.square))) { return null; } // ONLY THE OWNER'S OWN TRAPS ENDED, NONE SPRANG: NOT THE OTHER PLAYER'S EITHER
	const i = now.board.sq.findIndex((p) => p && p.c === now.you && frozen(now, p.id) && !frozen(was, p.id));
	return i < 0 ? null : squareName(i);
}

/**
 * @description The statuses a view shows, by "pieceId:status": a known status on a piece on the view's board (fog: a hidden piece isn't there), a veiled one unless the viewer
 * owns its piece while the game is on (ruling R-1: the server strips that case, and sends it in a finished game & to the old owner after a handover), & the ids on the board
 * @param  {[object]} cardsView [the server's view: board.sq, statuses, you, result]
 * @return {[object]} { want: Map key -> { id, s, left, by, square, slot, slots, siblings }, onBoard: Set of piece ids }
 */
export function statusList(cardsView) {
	const want = new Map(), onBoard = new Set(), all = cardsView.statuses || {}, rings = ringList(cardsView), ward = wardIds(cardsView);
	cardsView.board.sq.forEach(function (p, i) {
		if (!p) { return; }
		onBoard.add(p.id);
		const list = (all[p.id] || []).filter((e) => STATUSES[e.s] && !(e.veiled && p.c === cardsView.you && !cardsView.result)); // A BACKUP OF THE SERVER'S STRIP (RULING R-1): IT SENDS THE REST
		if (ward.has(p.id) && !list.some((e) => e.s === "warded")) { list.push({ s: "warded", left: null }); } // HEAVY CAVALRY'S WARD (T22-2): ONE AURA & ONE LINE WITH A REAL warded
		const ring = rings.get(p.id) || [];
		ring.forEach((r, ringSlot) => list.push({ ...r, ringSlot, ringSlots: ring.length })); // T22-5: CONCENTRIC, 0 THE INNER
		list.forEach((e, slot) => want.set(`${p.id}:${e.s}`, { id: p.id, s: e.s, left: e.left ?? null, by: e.by, square: squareName(i), slot, slots: list.length, siblings: list.filter((o) => o !== e).map((o) => o.s), ringSlot: e.ringSlot, ringSlots: e.ringSlots }));
	});
	for (const e of cardsView.enchant || []) { // THE OPEN TRAP: ONLY ITS OWNER'S VIEW (A FINISHED GAME'S TOO) HAS ITS SQUARE
		if (baseOf(e.key) === "trapdoor" && e.data && e.data.square) { want.set(`trapdoor:${e.id}`, { id: "trapdoor", s: "trapdoor", left: null, square: e.data.square }); }
	}
	return { want, onBoard };
}

/**
 * @description What to do to the live statuses for the ones wanted now: create the new, update one whose left, by, square or slot changed, swap one shown in the other mode (no burst),
 * end the rest, with a burst when its piece is still on the board (its status ended) & without when it's gone (taken, or hidden by the fog)
 * @param  {[Map]} was [key -> { mode, opts }]
 * @param  {[Map]} want [statusList's]
 * @param  {[string]} mode ["effects" or "badges"]
 * @param  {[Set]} onBoard [statusList's]
 * @return {[object]} { create: [key], update: [key], swap: [key], end: [{ key, burst }] }
 */
export function diffStatuses(was, want, mode, onBoard) {
	const plan = { create: [], update: [], swap: [], end: [] };
	for (const [key, l] of was) {
		const w = want.get(key);
		if (!w) { plan.end.push({ key, burst: onBoard.has(idOf(key)) }); }
		else if (l.mode !== mode) { plan.swap.push(key); }
		else if (FIELDS.some((f) => String(l.opts[f]) !== String(w[f]))) { plan.update.push(key); }
	}
	for (const key of want.keys()) { if (!was.has(key)) { plan.create.push(key); } }
	return plan;
}

/**
 * @description Whether the effects use their cheap look (Task 24): on the phone profile, or when the median frame of a timed window is slower than SLOW_MS
 * @param  {[object]} o [{ coarse: (pointer: coarse) matches, frameMs: the median frame in ms, null/undefined: not timed }]
 * @return {[boolean]}
 */
export function decideCheap({ coarse, frameMs }) {
	return Boolean(coarse) || (frameMs != null && frameMs > SLOW_MS);
}

// THE SWITCH CHANGED (OR WAS FIRST DECIDED): EVERY STATUS HEARS IT IN PLACE, THE BLOOM FOLLOWS
function setCheap(on) {
	if (on === cheap) { return; }
	cheap = on;
	for (const l of live.values()) { l.opts.cheap = on; l.fx.update(0); }
	for (const e of ending) { e.opts.cheap = on; }
	setBloom(!on);
}

// ONE FRAME GAP WHILE THE EFFECTS ASK FOR FRAMES; A WINDOW OF 2 s & 8 GAPS (OR A FULL BUFFER) DECIDES. ONLY EVER TURNS IT ON: BACK OFF ONLY ON THE NEXT MOUNT (NO FLIP-FLOPPING)
function timeFrame(gap, now) {
	if (cheap) { return; }
	if (gap > MAX_GAP_MS) { gapCount = 0; gapStart = null; return; } // A HIDDEN TAB OR STALL: START A FRESH WINDOW, SO A FEW JANKY FRAMES ON RETURN CAN'T DECIDE IT (RE-REVIEW N1)
	if (gapStart === null) { gapStart = now; }
	gaps[gapCount++] = gap;
	if ((now - gapStart < WINDOW_MS || gapCount < MIN_GAPS) && gapCount < gaps.length) { return; }
	const sorted = gaps.subarray(0, gapCount).sort();
	setCheap(decideCheap({ coarse: false, frameMs: sorted[gapCount >> 1] }));
	gapCount = 0;
	gapStart = null;
}

function atSquare(root, square) { root.position.set(center(fileOf(square)), 0, center(rowOf(square))); }

function onMesh(opts, mesh) {
	opts.mesh = mesh;
	mesh.add(opts.root);
	mesh.userData.disposeStatuses = () => dropMesh(mesh); // pieces.js disposePiece: THE EFFECTS GO WITH THEIR PIECE
}

function make(key, w, mode, fresh = false) {
	const root = new Group(), squareRoot = new Group(), trap = w.s === "trapdoor", mesh = trap ? null : view.pieces.get(w.square);
	root.name = squareRoot.name = "statusFx";
	if (cheap === null) { setCheap(decideCheap({ coarse: window.matchMedia("(pointer: coarse)").matches })); } // ONCE A MOUNT, AS three/index.js mount's phone
	const opts = { ...w, mode, mesh, root, squareRoot, reduce: REDUCE.matches, cheap, fresh };
	if (!trap) { onMesh(opts, mesh); } // THE TRAP IS THE SQUARE'S: NO PIECE, ALL IN squareRoot, THE SAME IN EITHER MODE
	atSquare(squareRoot, w.square);
	view.scene.add(squareRoot);
	live.set(key, { fx: (mode === "badges" && !trap ? badges : MODULES[w.s]).create(mesh, opts), opts, mode });
	opts.fresh = false; // AT create ONLY: NEVER SEEN BY update OR THE ENDING COPY
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
	if (ms > 0) { ending.add({ ...l, until: performance.now() + ms }); } else { free(l); }
}

function dropMesh(mesh) {
	for (const [key, l] of live) { if (l.opts.mesh === mesh) { live.delete(key); free(l); } }
	for (const e of ending) { if (e.opts.mesh === mesh) { ending.delete(e); free(e); } }
	pump();
}

// FRAMES WHILE AN EFFECT ANIMATES OR A BURST PLAYS, NONE UNDER REDUCED MOTION (AS fire.js & clock.js). BADGES ARE STILL: THEY'RE REDRAWN ON A SYNC
function pump() {
	const need = !REDUCE.matches && (ending.size > 0 || [...live.values()].some((l) => l.fx.animating?.()));
	if (need && !timer) { timer = setInterval(requestRender, 1000 / FX_FPS); lastNow = null; } // THE ON-DEMAND IDLE BEFORE IT IS NO FRAME GAP
	else if (!need && timer) { clearInterval(timer); timer = null; lastNow = null; gapCount = 0; gapStart = null; } // THE WINDOW COUNTS ONLY WHILE THE EFFECTS ANIMATE
}

// REDUCED MOTION TURNED ON OR OFF: EVERY EFFECT HEARS IT, A PLAYING BURST ENDS, THE FRAMES FOLLOW
REDUCE.addEventListener("change", function () {
	for (const l of live.values()) { l.opts.reduce = REDUCE.matches; l.fx.update(0); }
	if (REDUCE.matches) { ending.forEach(free); ending.clear(); }
	pump();
	requestRender();
});

/**
 * @description An answer's board step starts (renderer/index.js boardStep3D): the pieces move past this view, so it isn't synced again (the meshes no longer stand as it says,
 * between steps too). The next view (the answer's set) syncs as usual
 * @param  {[object|null]} cardsView [the view on the board as the step starts]
 */
export function holdStatuses(cardsView) {
	stale = cardsView;
}

/**
 * @description Shows a Chess Cards view's statuses on the 3D board in a mode: diffs them against the live ones (diffStatuses) & creates, updates, swaps or ends each, then moves an effect
 * onto its piece's mesh when the board gave the piece another. Call it once the board's pieces stand as the view says (renderer/index.js drawBoard). A status whose square has no mesh
 * (a board step took it) ends without a burst. Put off while a piece is in flight (view.anims: the next frame after the flights end runs the last one put off) & for a view
 * the board's steps moved past (holdStatuses)
 * @param  {[object|null]} cardsView [the server's view, null for none: everything ends]
 * @param  {[string]} mode ["effects" or "badges", anything else is "effects"]
 */
export function syncStatuses(cardsView, mode) {
	if (!view) { return; }
	pending = null;
	if (cardsView && cardsView === stale) { return; } // THE NEXT VIEW SYNCS
	if (view.anims.size) { pending = [cardsView, mode]; return; } // A SLIDE MOVES view.pieces AS IT STARTS: THE MESHES & THE VIEW AGREE AGAIN ONCE IT ENDS
	stale = null;
	mode = mode === "badges" ? "badges" : "effects";
	const { want, onBoard } = cardsView ? statusList(cardsView) : { want: new Map(), onBoard: new Set() };
	const was = seen, wasOn = seenOn, veiled = (w) => ((cardsView.statuses || {})[w.id] || []).some((e) => e.s === w.s && e.veiled);
	const prev = last, wasCut = (e) => (prev.enchant || []).some((o) => o.id === e.id && baseOf(o.key) === "heavy-cavalry" && cut(o));
	const wardSeen = (w) => w.s !== "warded" || ((cardsView.statuses || {})[w.id] || []).some((e) => e.s === "warded") // R16: A WARD ONLY HEAVY CAVALRY GIVES NEEDS AN ENCHANT THE FOG DIDN'T CUT LAST SYNC
		|| (cardsView.enchant || []).some((e) => baseOf(e.key) === "heavy-cavalry" && !wasCut(e) && wardIds({ ...cardsView, enchant: [e] }).has(w.id));
	const fresh = (key, w) => was !== null && !was.has(key) && wasOn.has(w.id) && !(wasOn.get(w.id) && veiled(w)) && wardSeen(w); // R14: ITS PIECE WAS SHOWN, ITS VEIL DIDN'T HIDE IT
	seen = cardsView ? new Set(want.keys()) : null; // A NULL VIEW: THE NEXT VIEW IS A FIRST SYNC AGAIN
	seenOn = cardsView ? new Map(cardsView.board.sq.filter(Boolean).map((p) => [p.id, p.c === cardsView.you && !cardsView.result])) : null;
	for (const [key, w] of want) { if (w.s !== "trapdoor" && !view.pieces.get(w.square)) { want.delete(key); onBoard.delete(w.id); } }
	const sprang = springSquare(last, cardsView);
	last = cardsView;
	const plan = diffStatuses(live, want, mode, onBoard);
	plan.end.forEach(({ key, burst }) => end(key, burst)); // THE OPEN TRAP ENDS WITHOUT ONE ("trapdoor" IS NO PIECE ON THE BOARD)
	if (sprang) { make("sprung", { s: "trapdoor", square: sprang, left: null, sprung: true }, "effects"); end("sprung", true); } // T22-1: BOTH PLAYERS SEE THE SNAP; ONE burst(), THEN stepStatuses PLAYS & FREES IT
	plan.swap.forEach((key) => { free(live.get(key)); live.delete(key); make(key, want.get(key), mode); });
	plan.create.forEach((key) => make(key, want.get(key), mode, fresh(key, want.get(key)))); // A SWAP, A MESH SWAP'S RE-CREATE, A FIRST SYNC, A FOG OR VEIL REVEAL: NOT FRESH
	for (const key of plan.update) {
		const l = live.get(key), moved = l.opts.square !== want.get(key).square;
		Object.assign(l.opts, want.get(key));
		if (moved) { atSquare(l.opts.squareRoot, l.opts.square); }
	}
	for (const [key, l] of live) {
		if (l.opts.s === "trapdoor") { continue; } // A SQUARE'S: A PIECE STANDING THERE ISN'T ITS MESH
		const mesh = view.pieces.get(l.opts.square);
		if (mesh !== l.opts.mesh) { onMesh(l.opts, mesh); plan.update.push(key); }
	}
	new Set(plan.update).forEach((key) => live.get(key).fx.update(0));
	shown = new Map();
	for (const w of want.values()) { if (w.s !== "trapdoor") { shown.set(w.square, [...(shown.get(w.square) || []), w]); } }
	showText();
	pump();
	requestRender();
}

/**
 * @description Each frame (three/index.js frame): steps every live & bursting effect, & frees a burst that has played out
 * @param  {[number]} now [the frame's time, ms]
 */
export function stepStatuses(now) {
	if (pending && !view.anims.size) { syncStatuses(...pending); }
	const dt = lastNow === null ? 0 : Math.min(MAX_DT, Math.max(0, now - lastNow) / 1000);
	if (timer && lastNow !== null) { timeFrame(now - lastNow, now); } // ONLY WHILE THE EFFECTS ASK FOR FRAMES: ON DEMAND, A GAP IS IDLE TIME, NOT A SLOW FRAME
	lastNow = now;
	for (const l of live.values()) { l.fx.update(dt); }
	for (const e of ending) {
		if (now >= e.until) { ending.delete(e); free(e); } else { e.fx.update(dt); }
	}
	pump();
}

/**
 * @description Ends every effect at once, no bursts, & takes the hover text away (three/index.js unmount, a test's start)
 */
export function clearStatuses() {
	for (const l of live.values()) { free(l); }
	for (const e of ending) { free(e); }
	live.clear();
	ending.clear();
	shown = new Map();
	pump();
	hoverSquare = pickSquare = pointSquare = focusSquare = stale = pending = last = cheap = gapStart = seen = seenOn = null; // cheap: THE NEXT MOUNT DECIDES AGAIN
	gapCount = 0;
	if (hoverBox) { hoverBox.remove(); hoverBox = null; }
}

/**
 * @description The live statuses, for the tests: { key, mode, opts }
 * @return {[array]}
 */
export function liveStatuses() {
	return [...live].map(([key, l]) => ({ key, mode: l.mode, opts: l.opts }));
}

/**
 * @description The hover text of a square: each status shown there, its name, its turns left (none for a permanent one, Q2) & what it does, a line each. "" for none
 * @param  {[string|null]} square ["e4"]
 * @return {[string]}
 */
export function statusText(square) {
	return (shown.get(square) || []).map((w) => `${TEXT[w.s][0]}${w.left === null ? "" : ` (${w.left} turn${w.left === 1 ? "" : "s"} left)`}: ${TEXT[w.s][1]}`).join("\n");
}

/**
 * @description The pointer is over this square (three/tileHover.js), null off the board: the status text shows its piece's statuses (showText)
 * @param  {[string|null]} square
 */
export function hoverStatuses(square) {
	hoverSquare = square;
	showText();
}

/**
 * @description The picked piece's square (renderer/index.js holdTablePiece3D: a pick by the keys, a tap or a click), null when none is: the status text shows its statuses
 * while the pointer isn't over a piece with some (ruling R4)
 * @param  {[string|null]} square
 */
export function pickStatuses(square) {
	if (square === pickSquare) { return; }
	pickSquare = square;
	showText();
}

/**
 * @description A finger's tap on a square (three/pointer.js pickTable), any piece's, the opponent's too (ruling R-3: touch has no hover): the status text shows its statuses
 * until the next tap or keyboard focus. An empty square or one with none takes it away
 * @param  {[string|null]} square
 */
export function tapStatuses(square) {
	pointSquare = square;
	showText();
}

/**
 * @description The keyboard's square on the table (three/index.js highlightSquares, on every table refresh), null for none: when it moves, the status text shows its statuses (ruling R-3)
 * @param  {[string|null]} square
 */
export function focusStatuses(square) {
	if (square === focusSquare) { return; } // A REFRESH WITH THE SAME FOCUS LEAVES A LATER TAP'S TEXT
	focusSquare = pointSquare = square;
	showText();
}

// THE STATUS TEXT, IN EITHER MODE: THE HOVERED PIECE'S, ELSE THE TAPPED OR KEYBOARD-FOCUSED ONE'S, ELSE THE PICKED ONE'S, ON THE RIGHT OF THE SCREEN (THE LIFTED CARD'S PREVIEW IS ON THE LEFT), AS A LIVE REGION A SCREEN READER READS OUT
function showText() {
	const text = statusText(hoverSquare) || statusText(pointSquare) || statusText(pickSquare);
	if (!text && !hoverBox) { return; }
	if (!hoverBox) {
		hoverBox = document.createElement("div");
		hoverBox.className = "statusHover"; // board3D.css
		hoverBox.setAttribute("role", "status");
		hoverBox.setAttribute("aria-live", "polite");
		document.body.append(hoverBox);
	}
	if (hoverBox.textContent !== text) { hoverBox.textContent = text; }
	hoverBox.hidden = !text;
}
