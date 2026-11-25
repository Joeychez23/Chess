// Owns the 3D board's hover (Task 20e, segment C1): the box on the tile under the pointer, the slight lift of the piece on it & the fade of the pieces whose body covers the pointer. hoverRules.js decides, this draws
import { Mesh, MeshBasicMaterial, RingGeometry } from "three";
import { view, requestRender, squareUnder, raycaster, center, fileOf, rowOf } from "./index.js";
import { hoverBoard, rehover } from "./pointer.js";
import { updateShadow, setOpacity } from "./pieces.js";
import { boardHover } from "./lean.js"; // AUTO LEAN (SEGMENT C2) IS TOLD WHEN THE POINTER COMES ONTO THE TILES & GOES OFF THEM
import { CELL_SIZE, LIFT_HEIGHT, REDUCE } from "./constants.js";
import { REST_MS, FADE_OPACITY, canAct, fadeList, fadeMs } from "./hoverRules.js";
import { hoverStatuses } from "./statusFx/index.js"; // THE HOVERED PIECE'S STATUSES, NAMED (TASK 21)

const HOVER_LIFT = LIFT_HEIGHT * 0.4; // THE HOVERED PIECE'S LIFT: A PICKED PIECE'S (liftHeld), SMALLER
const BOX = [0.42, 0.5]; // THE BOX'S INNER & OUTER EDGE, HALF A SIDE IN SQUARES FROM THE CENTER (THE FOCUS RING'S SHAPE, ON THE TILE'S EDGE)
const BOX_Y = 0.04; // OVER THE HIGHLIGHTS
const TARGETS = ["legal", "capture", "cards"]; // THE MARKS OF A PIECE OR CARD IN HAND: THEIR TILES CAN BE ACTED ON

// THE HOVER OF THIS mount(), MADE THE FIRST TIME THE POINTER MOVES. THE BOX IGNORES DEPTH & DRAWS LAST, SO A PIECE IN FRONT CAN'T HIDE IT (unmount() FREES IT WITH THE SCENE)
function hoverState() {
	if (view.hover) { return view.hover; }
	const [inner, outer] = BOX.map((s) => s * CELL_SIZE * Math.SQRT2); // 4 SEGMENTS FROM 45°: A SQUARE RING, AS THE FOCUS RING (index.js mount)
	const box = new Mesh(new RingGeometry(inner, outer, 4, 1, Math.PI / 4).rotateX(-0.5 * Math.PI), new MeshBasicMaterial({ color: 0xFFFFFF, opacity: 0.9, transparent: true, depthTest: false }));
	box.renderOrder = 10;
	box.visible = false;
	view.scene.add(box);
	view.hover = { box, tile: null, lifted: null, rested: false, timer: null, faded: new Set() }; // lifted: THE MESH THE HOVER LIFTED, rested: THE POINTER HAS STAYED STILL ON tile FOR REST_MS, faded: THE MESHES IT TURNED SEE-THROUGH
	return view.hover;
}

/**
 * @description The mouse is over a board tile, or (null) off the board: the box goes to the tile & the mouse cursor hides there (css .tileHover), the piece on it lifts slightly,
 * & once the pointer has rested the pieces covering it fade (hoverRules.js fadeList). A moving pointer starts the rest again, so a sweep fades nothing
 * @param  {[object|null]} e [an event with clientX & clientY, null when the pointer is off the board (the glass, a card, the desk, off the canvas, a camera gesture)]
 */
export function hoverTile(e) {
	if (!view) { return; }
	const h = hoverState();
	const tile = e ? squareUnder(e) : null; // ALSO AIMS THE RAY AT THE POINTER, FOR fade()
	view.container.classList.toggle("tileHover", Boolean(tile));
	if (tile !== h.tile) {
		if (Boolean(tile) !== Boolean(h.tile)) { boardHover(Boolean(tile)); } // ONLY ON A CHANGE
		setDown(h);
		h.tile = tile;
		hoverStatuses(tile);
		h.rested = false;
		h.box.visible = Boolean(tile);
		if (tile) { h.box.position.set(center(fileOf(tile)), BOX_Y, center(rowOf(tile))); }
		fade(h); // THE LAST TILE'S FADED PIECES COME BACK
		requestRender();
	}
	liftUp(h);
	if (h.rested) { fade(h); return; } // STILL ON ITS TILE: THE PIECES COVERING THE POINTER CHANGE AS IT MOVES INSIDE IT
	clearTimeout(h.timer);
	if (tile) { h.timer = setTimeout(rest, REST_MS, h); }
}

/**
 * @description The squares the player can pick a piece up from right now (gameplay's own list: its turn, its colour, its rules), null while they can't act: off turn,
 * after the game, in a replay. Nothing fades then (hoverRules.js canAct). The fade follows at the pointer's next rest
 * @param  {[string[]|null]} squares
 */
export function setPickable(squares) {
	if (view) { view.pickable = squares || null; }
}

/**
 * @description Each frame, before it's drawn (three/index.js frame): while the camera moves by itself (Auto Lean's glide, a framed deal or pile, a Flip Board turn, or gliding on by damping after an orbit or zoom is let go) the box follows
 * the tile under the still pointer, so a click always lands on the tile the box shows. The mouse cursor is hidden there: the box is the only pointer
 * @param  {boolean} gliding the camera controls moved the camera this frame (damping)
 */
export function followCamera(gliding) {
	if (!view.hover || !view.hover.tile || !(view.dealEase || view.cameraTurn || gliding)) { return; }
	view.camera.updateMatrixWorld(); // THE RAY IS CAST FROM IT, & IT'S ONLY BROUGHT UP TO DATE AS THE FRAME IS DRAWN
	rehover();
}

// REST_MS WITHOUT A MOVE: THE POINTER RESTS. ASKED AGAIN EVERY REST_MS WHILE IT'S ON A TILE, SINCE THE BOARD CAN MOVE UNDER A STILL POINTER (AUTO LEAN, A FLIP, A MOVE PLAYED)
function rest(h) {
	if (!view || view.hover !== h || !h.tile) { return; }
	const was = h.tile;
	hoverBoard({ clientX: view.pointerAt.x, clientY: view.pointerAt.y }); // ANOTHER TILE IS UNDER IT NOW: THE BOX FOLLOWS & THE REST STARTS AGAIN (hoverTile). A RESTED ONE FADES WHAT COVERS IT NOW
	if (!h.tile) { return; }
	if (h.tile === was && !h.rested) { // hoverTile() LEFT THE RAY AIMED AT THE POINTER
		h.rested = true;
		fade(h);
	}
	clearTimeout(h.timer);
	h.timer = setTimeout(rest, REST_MS, h);
}

// THE PIECE STANDING ON THE HOVERED TILE LIFTS. NOT ONE IN HAND, MOVING OR DROPPED ELSEWHERE (dropHeld): THOSE AREN'T STANDING ON THEIR SQUARE
function liftUp(h) {
	const mesh = h.tile && view.pieces.get(h.tile);
	if (!mesh || mesh.position.y !== 0 || mesh.position.x !== center(fileOf(h.tile)) || mesh.position.z !== center(rowOf(h.tile))) { return; }
	setDown(h);
	mesh.position.y = HOVER_LIFT;
	updateShadow(mesh);
	h.lifted = mesh;
	requestRender();
}

// THE LIFTED PIECE GOES BACK DOWN, UNLESS SOMETHING ELSE MOVED IT SINCE (PICKED UP, SLIDING, SYNCED)
function setDown(h) {
	const mesh = h.lifted;
	h.lifted = null;
	if (!mesh || mesh.position.y !== HOVER_LIFT) { return; }
	mesh.position.y = 0;
	updateShadow(mesh);
	requestRender();
}

// FADES THE PIECES hoverRules.js fadeList NAMES & BRINGS BACK THE REST. THE RAY IS AIMED AT THE POINTER (squareUnder)
function fade(h) {
	const tile = h.tile, piece = tile ? view.pieces.get(tile) : null;
	const marked = Boolean(tile) && TARGETS.some((kind) => view.marks[kind].meshes.get(tile)?.visible);
	const actionable = Boolean(tile) && canAct({ acting: Boolean(view.pickable), marked, pickable: Boolean(piece) && Boolean(view.pickable) && view.pickable.includes(tile) });
	const bodies = h.rested && actionable ? raycaster.intersectObjects([...view.pieces.values()], false).map((hit) => hit.object.userData.square) : []; // ONLY A RESTED POINTER PAYS FOR THE PIECES' RAYCAST
	const want = new Set(fadeList({ tile, rested: h.rested, actionable, bodies, held: view.held ? view.held.mesh.userData.square : null }));
	for (const mesh of [...h.faded]) {
		if (want.has(mesh.userData.square) && view.pieces.get(mesh.userData.square) === mesh) { continue; }
		h.faded.delete(mesh);
		fadeTo(mesh, 1);
	}
	for (const square of want) {
		const mesh = view.pieces.get(square);
		if (h.faded.has(mesh)) { continue; }
		h.faded.add(mesh);
		fadeTo(mesh, FADE_OPACITY);
	}
}

// EASES A PIECE'S OPACITY FROM WHAT IT IS NOW (view.tweens, STEPPED BY THE FRAME). A LATER fadeTo() OF THE SAME PIECE TAKES OVER, & ONE THAT LEFT THE BOARD (TAKEN, REMOVED) IS LEFT ALONE
function fadeTo(mesh, to) {
	const from = mesh.userData.opacity ?? 1, id = mesh.userData.fadeId = (mesh.userData.fadeId || 0) + 1;
	view.tweens.add({ duration: fadeMs(from, to, REDUCE.matches), update(k) {
		if (view && mesh.userData.fadeId === id && view.pieces.get(mesh.userData.square) === mesh) { setOpacity(mesh, from + (to - from) * k); }
	} });
}
