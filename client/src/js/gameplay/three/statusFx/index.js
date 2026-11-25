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
import { REDUCE } from "../constants.js";

/**
 * @description The effect module of each status, for the "effects" mode. Every module exports create(pieceMesh, opts) -> { update(dt), burst(), animating(), dispose() }:
 * - create: makes the effect. Put what follows the piece in opts.root (a Group, a child of the piece's mesh, in piece units: it lifts, drags, drops & turns with it) & what belongs
 *   to the board square the server's view gives (Marked's glow) in opts.squareRoot (a Group on the board at that square's centre, y 0, world units: a lifted or dragged piece leaves it there).
 *   The frame adds & removes both roots; the module removes nothing of theirs but its own objects.
 * - opts (one object per live status, updated in place: read it in update, never copy it): { s, id (the piece's id), left (turns left, null: permanent), by (the caster's colour,
 *   missing when the server strips it), square (the view's square, "e4"), mode ("effects"), slot & slots (this status's place among the piece's shown statuses: 0..slots-1),
 *   siblings (the names of the piece's other shown statuses, ["marked"]: for looks that share the piece, ruling 09:19's skull in Shaken's cage, Task 22's sigils),
 *   mesh (the piece's mesh now: syncFromBoard can hand the piece another one, the frame then moves opts.root onto it), root, squareRoot,
 *   reduce (true under prefers-reduced-motion: draw a still look, no loop; it can change while live, update(0) follows) }
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
	// TASK 22, A NEW STATUS NEEDS ALL THREE: ITS MODULE HERE (sigils, trapdoor: EACH IMPORTED FROM ITS OWN FILE ABOVE), ITS ROW IN STATUSES BELOW (statusList SHOWS NO OTHER) & ITS
	// [FILL, RING] IN badges.js COLORS (ELSE A WHITE BADGE). TRAPDOOR IS A SQUARE'S, NOT A PIECE'S: statusList ONLY READS view.statuses OF PIECES, SO IT NEEDS ITS OWN ENTRY (squareRoot, NO PIECE)
};

// THE HOVER TEXT: NO CLIENT FILE DESCRIBES A STATUS (THE CATALOG DESCRIBES CARDS), SO A FIXED TABLE FROM THE ENGINE'S RULES (cards-engine/rules.js, turn.js, ctx.js capture)
const STATUSES = {
	warded: ["Warded", "can't be captured."],
	frozen: ["Frozen", "can't move."],
	shaken: ["Shaken", "can't capture."],
	marked: ["Marked", "whoever captures it draws a move card, and its owner discards 2 random cards."],
	hexed: ["Hexed", "no card can move it."],
};
const FX_FPS = 30; // FRAMES ASKED FOR WHILE AN EFFECT ANIMATES (THE BOARD ONLY DRAWS ON DEMAND)
const MAX_DT = 0.1; // SECONDS: THE FIRST FRAME AFTER A HIDDEN TAB OR AN IDLE SPELL DOESN'T JUMP AN EFFECT AHEAD
const FIELDS = ["left", "by", "square", "slot", "slots", "siblings"]; // A CHANGE TO ONE IS AN UPDATE, NOT A RE-CREATE (COMPARED AS STRINGS: siblings IS A NEW LIST EACH SYNC)

const live = new Map(); // "pieceId:status" -> { fx, opts, mode }
const ending = new Set(); // BURSTING: { fx, opts, until (ms, performance.now's clock) }
let shown = new Map(); // SQUARE -> THE STATUSES SHOWN THERE AT THE LAST SYNC, FOR THE HOVER TEXT
let timer = null, lastNow = null, hoverSquare = null, pickSquare = null, pointSquare = null, focusSquare = null, hoverBox = null; // pointSquare: THE LATEST TAPPED OR KEYBOARD-FOCUSED SQUARE (RULING R-3)
let stale = null, pending = null; // stale: THE VIEW THE BOARD'S STEPS MOVED PAST (holdStatuses), pending: THE LAST SYNC PUT OFF, [cardsView, mode]

const squareName = (i) => "abcdefgh"[i % 8] + (8 - Math.floor(i / 8)); // 0 = a8, THE ENGINE'S ORDER (cards-engine/board.js sqName)
const idOf = (key) => key.slice(0, key.lastIndexOf(":"));

/**
 * @description The statuses a view shows, by "pieceId:status": a known status on a piece on the view's board (fog: a hidden piece isn't there), a veiled one unless the viewer
 * owns its piece while the game is on (ruling R-1: the server strips that case, and sends it in a finished game & to the old owner after a handover), & the ids on the board
 * @param  {[object]} cardsView [the server's view: board.sq, statuses, you, result]
 * @return {[object]} { want: Map key -> { id, s, left, by, square, slot, slots, siblings }, onBoard: Set of piece ids }
 */
export function statusList(cardsView) {
	const want = new Map(), onBoard = new Set(), all = cardsView.statuses || {};
	cardsView.board.sq.forEach(function (p, i) {
		if (!p) { return; }
		onBoard.add(p.id);
		const list = (all[p.id] || []).filter((e) => STATUSES[e.s] && !(e.veiled && p.c === cardsView.you && !cardsView.result)); // A BACKUP OF THE SERVER'S STRIP (RULING R-1): IT SENDS THE REST
		list.forEach((e, slot) => want.set(`${p.id}:${e.s}`, { id: p.id, s: e.s, left: e.left ?? null, by: e.by, square: squareName(i), slot, slots: list.length, siblings: list.filter((o) => o !== e).map((o) => o.s) }));
	});
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

function atSquare(root, square) { root.position.set(center(fileOf(square)), 0, center(rowOf(square))); }

function onMesh(opts, mesh) {
	opts.mesh = mesh;
	mesh.add(opts.root);
	mesh.userData.disposeStatuses = () => dropMesh(mesh); // pieces.js disposePiece: THE EFFECTS GO WITH THEIR PIECE
}

function make(key, w, mode, mesh) {
	const root = new Group(), squareRoot = new Group();
	root.name = squareRoot.name = "statusFx";
	const opts = { ...w, mode, mesh, root, squareRoot, reduce: REDUCE.matches };
	onMesh(opts, mesh);
	atSquare(squareRoot, w.square);
	view.scene.add(squareRoot);
	live.set(key, { fx: (mode === "badges" ? badges : MODULES[w.s]).create(mesh, opts), opts, mode });
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
	if (need && !timer) { timer = setInterval(requestRender, 1000 / FX_FPS); }
	else if (!need && timer) { clearInterval(timer); timer = null; lastNow = null; }
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
	for (const [key, w] of want) { if (!view.pieces.get(w.square)) { want.delete(key); onBoard.delete(w.id); } }
	const plan = diffStatuses(live, want, mode, onBoard);
	plan.end.forEach(({ key, burst }) => end(key, burst));
	plan.swap.forEach((key) => { free(live.get(key)); live.delete(key); make(key, want.get(key), mode, view.pieces.get(want.get(key).square)); });
	plan.create.forEach((key) => make(key, want.get(key), mode, view.pieces.get(want.get(key).square)));
	for (const key of plan.update) {
		const l = live.get(key), moved = l.opts.square !== want.get(key).square;
		Object.assign(l.opts, want.get(key));
		if (moved) { atSquare(l.opts.squareRoot, l.opts.square); }
	}
	for (const [key, l] of live) {
		const mesh = view.pieces.get(l.opts.square);
		if (mesh !== l.opts.mesh) { onMesh(l.opts, mesh); plan.update.push(key); }
	}
	new Set(plan.update).forEach((key) => live.get(key).fx.update(0));
	shown = new Map();
	for (const w of want.values()) { shown.set(w.square, [...(shown.get(w.square) || []), w]); }
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
	hoverSquare = pickSquare = pointSquare = focusSquare = stale = pending = null;
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
	return (shown.get(square) || []).map((w) => `${STATUSES[w.s][0]}${w.left === null ? "" : ` (${w.left} turn${w.left === 1 ? "" : "s"} left)`}: ${STATUSES[w.s][1]}`).join("\n");
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
