/*
 *  index.js  --  chess frontend
 *	3D Board
 *	The three.js board. Never imported statically: load.js pulls it in with import() when the player turns 3D on, so webpack
 *	puts it & three.js in their own "three" chunk & 2D players never download them. Named imports only, so the rest of
 *	three.js is tree-shaken out. It knows no chess rules & no socket: it only draws what it's told & reports squares.
 *	The board lies in the XZ plane centered on the origin, a1 bottom-left from White's side (+Z faces the camera)
 *
 */

import { Raycaster, Vector2, Vector3, Spherical, PerspectiveCamera, Mesh, Plane } from "three";

import {
	view, fileOf, rowOf, center, removePiece, shadeOnGround, requestRender
} from "./three.mount.js"; // mount() and unmount(), the room, the frame loop and the card table it brings up
import { startYaw } from "./three.facing.js"; // Which way a piece faces
export {
	view, fileOf, rowOf, center, toCell, removePiece, shadeOnGround, requestRender, mount, whenDrawn, unmount, setCardTable
} from "./three.mount.js";
export { yawToward, yawSide, storedYaw, setYaw, faceTravel, setFacing } from "./three.facing.js";
import { createPiece, updateShadow } from "./board/pieces.js";
import { orientLabels } from "./board/board.js";
import { pileSpots } from "./cardTable/takenPiles.js"; // Where the taken pieces stand on the desk

export { perfLoaded } from "./perf.js"; // load.js gives it the chunk's download time
import "../../../css/board3D.css"; // #board3D, the controls hint and the perf readout: in this chunk, not the play bundle

import { frameDeal, unframeDeal, landTurn, stepZoom } from "./camera/index.js";
import { monitorIdle, rehoverPlaque } from "./pointer/index.js";
import { putDownHeld, finishAnims, animate } from "./board/motion.js";
// A Chess Cards piece's statuses, as effects or badges
import { focusStatuses } from "./statusFx/index.js";
export { syncStatuses, holdStatuses, pickStatuses } from "./statusFx/index.js";
import { tileAt } from "./pointer/hoverRules.js"; // The tile under a point on the board (squareUnder)

export { isCameraGesture, setSide, resetCamera } from "./camera/index.js";
export { setMonitor, enterMonitor, leaveMonitor, monitorState, focusMonitor } from "./pointer/index.js";
export { setPickable } from "./pointer/tileHover.js";
export { setHeld, dropHeld, animateMove, animateUndo, glideHome } from "./board/motion.js";
export { playBoardStep } from "./board/motion.js"; // A Chess Cards answer's board steps (renderer/ boardStep3D)
import { BOARD_SIZE, CELL_SIZE, PIECE_SIZE, DESK_Y, HIGHLIGHTS } from "./constants.js";

export const raycaster = new Raycaster();
export const pointer = new Vector2(); // Normalized device coords (-1..1)
export const offset = new Vector3(); // Camera position minus what it looks at
export const spherical = new Spherical(); // offset as distance, tilt and angle around the board
export const fitCamera = new PerspectiveCamera(); // smallScreenCamera()'s stand-in, the real one stays where the player put it
export const corner = new Vector3();
export const table = new Plane(new Vector3(0, 1, 0), 0); // The board's surface, a dragged piece off the board follows the pointer on it
export const tablePoint = new Vector3();
export const UP = new Vector3(0, 1, 0);
export const glassCentre = new Vector3(); // zoomSpot()'s scratch
export const glassNormal = new Vector3();
export const glassSize = new Vector3();
export const glassScale = new Vector3();
export const forward = new Vector3(); // The camera's view direction, glassHit()'s
export const dealShift = new Vector3(); // framedSpot()'s scratch

// Puts a mesh on a square, both in view.pieces and in the scene
export function place(mesh, square) {
	view.pieces.set(square, mesh);
	mesh.userData.square = square;
	mesh.position.set(center(fileOf(square)), 0, center(rowOf(square)));
	// An unmoved knight faces the middle of its square's row
	if (mesh.userData.type === "n" && mesh.userData.yaw === undefined) { mesh.rotation.y = startYaw(mesh); }
	updateShadow(mesh);
}

export function addPiece(type, color) {
	const mesh = createPiece(type, color, PIECE_SIZE);
	view.scene.add(mesh);
	return mesh;
}

/* ---------------------------------------------------------------- */
// Piles
/* ---------------------------------------------------------------- */

// The baize table's height when the room isn't in
function pileY() {
	return (view.room ? DESK_Y : view.surroundings.userData.table.position.y);
}

// How createPiece turns a piece on its square
export function homeYaw(type, color) {
	return (color === "w" ? Math.PI : 0) - (type === "n" ? Math.PI / 2 : 0);
}

// Puts a mesh where its pile spot says, on the desk (or the table)
function settle(mesh, spot) {
	view.taken.set(spot.key, mesh);
	mesh.userData.spot = spot.key;
	mesh.userData.ground = pileY();
	mesh.userData.yaw = undefined;
	mesh.position.set(spot.x, mesh.userData.ground, spot.z);
	mesh.rotation.y = spot.yaw;
	updateShadow(mesh);
	shadeOnGround(mesh);
}

// The order of the piles' slots: far0, far1, ..., near0, ...
export function slotOf(key) {
	return Number(key.replace(/\D/g, ""));
}

// Turns the a-h / 1-8 labels to read from color's side, as the 2D board's do
export function setLabels(color) {
	if (view.labelSide === color) { return; }
	view.labelSide = color;
	orientLabels(view.surroundings, color);
}

/* ---------------------------------------------------------------- */
// Pieces
/* ---------------------------------------------------------------- */

/**
 * @description Places the pieces to match the position, reusing meshes already right or moving spare ones. After load,
 * takebacks & restarts
 * @param  {[Chess]} chessInst [the chess.js instance, only its board() is read]
 */
export function syncFromBoard(chessInst) {
	if (!view) { return; }
	finishAnims();
	putDownHeld(); // On its square before the meshes are sorted, setHeld() lifts it again if it's still held
	const want = new Map(); // Square -> { type, color } still to place
	for (const row of chessInst.board()) {
		for (const piece of row) {
			if (piece) { want.set(piece.square, piece); }
		}
	}
	const spare = []; // Meshes on a square that changed
	for (const [square, mesh] of view.pieces) {
		const piece = want.get(square);
		if (piece && piece.type === mesh.userData.type && piece.color === mesh.userData.color) {
			want.delete(square);
			continue;
		}
		view.pieces.delete(square);
		spare.push(mesh);
	}
	for (const [square, piece] of want) {
		const index = spare.findIndex((mesh) => mesh.userData.type === piece.type && mesh.userData.color === piece.color);
		place(index >= 0 ? spare.splice(index, 1)[0] : addPiece(piece.type, piece.color), square);
	}
	spare.forEach(removePiece);
	view.arriving.forEach(removePiece); // A taken piece setTaken() never claimed
	view.arriving.clear();
	requestRender();
}

/**
 * @description Which tile a pointer event is over. The board is picked by tile, never through a piece's body: a tall
 * piece in front doesn't take the tile behind it
 * @param  {[PointerEvent|MouseEvent]} e [any event with clientX & clientY]
 * @return {[string|null]} ["e4", or null when it's off the board or nothing is mounted]
 */
export function squareUnder(e) {
	if (!view || !monitorIdle()) { return null; } // At the monitor the board takes no input
	const rect = view.renderer.domElement.getBoundingClientRect();
	pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
	raycaster.setFromCamera(pointer, view.camera);
	const hit = raycaster.intersectObject(view.plane, false)[0];
	return hit ? tileAt(hit.point.x, hit.point.z, BOARD_SIZE) : null;
}

/**
 * @description Lands every moving piece, a Flip Board turn & a zoom to or from the monitor in progress at once (reduce
 * motion turned on mid-move)
 */
export function stopMotion() {
	if (!view) { return; }
	finishAnims();
	view.animations.finish();
	landTurn();
	if (view.zoom) { stepZoom(Infinity); }
	requestRender();
}

/**
 * @description Marks squares in one style, replacing that style's last marks. highlight([], kind) clears it
 * @param  {[string[]]} squares [["e4", ...]]
 * @param  {[string]} kind ["legal", "capture", "last" (last move), "check", "hint" or "focus" (the keyboard's square, a
 * ring)]
 */
export function highlight(squares, kind) {
	if (!HIGHLIGHTS[kind]) { throw new Error(`Bad highlight kind: ${kind}`); }
	if (!view) { return; }
	const { geometry, material, y, meshes } = view.marks[kind];
	for (const [square, mesh] of meshes) { mesh.visible = squares.includes(square); }
	for (const square of squares) {
		if (meshes.has(square)) { continue; }
		const mesh = new Mesh(geometry, material); // One per square, made the first time it's marked
		mesh.position.set(center(fileOf(square)), y, center(rowOf(square)));
		view.scene.add(mesh);
		meshes.set(square, mesh);
	}
	requestRender();
}

/**
 * @description Whether the room's promotion cards are in, so they can be the picker. False before the room loads, with
 * an old library.glb or no room
 * @return {[boolean]}
 */
export function hasCards() {
	return Boolean(view && view.cards);
}

/**
 * @description A promotion is asked for (the cards slide from the deck into the strip) or over (they slide back). Kept
 * until the room has loaded. A camera that can't see the strip frames the board & the cards meanwhile (frameDeal), then
 * goes back where it was
 * @param  {[string|null]} color ["w" or "b", the player's colour, null for none]
 * @param  {[boolean]} animate [false sets the cards at once (reduce motion)]
 */
export function setPromotion(color, animate) {
	if (!view) { return; }
	view.promotion = color ? { color } : null;
	if (!view.cards) { return; }
	if (color) {
		view.cards.deal(color, animate);
		frameDeal(animate); // A camera that can't see the cards moves to
	} else {
		view.cards.putBack(animate);
		unframeDeal(animate); // And back
	}
}

/**
 * @description The keyboard's card: lifted, in a gold frame
 * @param  {[number|null]} index [its place in queen, rook, bishop, knight order, null for none]
 */
export function focusCard(index) {
	if (view && view.cards) { view.cards.focus(index); }
}

/**
 * @description Stands the taken pieces in their piles on the desk (the baize table without the room). A piece
 * animateMove() just took off the board flies to its spot, a new one appears in place, one already in a right spot
 * stays. The rest are removed
 * @param  {[object[]]} captures [{ type, color }, in capture order, color is the taken piece's (gameplay/captures)]
 * @param  {[string|null]} playerColor ["w" or "b", the side the room is turned to, null counts as White]
 */
export function setTaken(captures, playerColor) {
	if (!view) { return; }
	const spots = pileSpots(captures, playerColor);
	const wanted = new Map(spots.map((spot) => [spot.key, spot]));
	for (const [key, mesh] of [...view.taken]) {
		const spot = wanted.get(key);
		if (spot && spot.type === mesh.userData.type && spot.color === mesh.userData.color) { continue; }
		view.taken.delete(key);
		// A flight to a spot that's gone
		for (const anim of [...view.anims]) {
			if (anim.mesh === mesh) {
				view.anims.delete(anim);
				anim.done();
			}
		}
		removePiece(mesh);
	}
	for (const spot of spots) {
		if (view.taken.has(spot.key)) { continue; }
		const arrived = [...view.arriving].find((mesh) => mesh.userData.type === spot.type && mesh.userData.color === spot.color);
		if (!arrived) {
			settle(addPiece(spot.type, spot.color), spot);
			continue;
		}
		view.arriving.delete(arrived);
		const { delay, duration } = arrived.userData.flight;
		view.taken.set(spot.key, arrived);
		arrived.userData.spot = spot.key;
		arrived.userData.yaw = undefined;
		arrived.rotation.y = spot.yaw;
		animate(arrived, spot.x, spot.z, { y1: pileY(), arc: CELL_SIZE * 1.5, delay, duration, onEnd: () => settle(arrived, spot) });
	}
	view.arriving.forEach(removePiece); // Not taken any more
	view.arriving.clear();
	requestRender();
}

/* ---------------------------------------------------------------- */
// Chess Cards Table
/* ---------------------------------------------------------------- */

/**
 * @description Deals a card duel on the table, or brings the one laid to the view (cardTable.duel.js dealDuel). Kept until
 * the room has loaded
 * @param  {[object]} duel [view.duel, of the view the table was last set to]
 */
export function dealDuel(duel) {
	if (!view) { return; }
	view.tableDuel = duel;
	if (view.table) { view.table.dealDuel(duel); }
}

/**
 * @description Turns a duel card face up, framed in gold when won (cardTable.duel.js flipDuel)
 * @param  {[string]} player ["w" | "b", the duel-flip event's player]
 * @param  {[number|null]} index [0..2 in the view's duel hands, null: a pick the view no longer shows]
 * @param  {[object]} card [{ r, s }, the duel-flip event's card]
 * @param  {[boolean]} won [true: its gold outline]
 */
export function flipDuel(player, index, card, won = false) {
	if (view && view.table) { view.table.flipDuel(player, index, card, won); }
}

/**
 * @description The card duel is over: its cards go back to the green deck, the hands back into their rows (cardTable.duel.js
 * endDuel)
 */
export function endDuel() {
	if (!view) { return; }
	view.tableDuel = null;
	if (view.table) { view.table.endDuel(); }
}

/**
 * @description Lifts the hand card being played, high above the others
 * @param  {[string]} id [the card's id, "king" for the King card]
 */
export function liftCard(id) {
	if (!view) { return; }
	view.tableLifted = id;
	if (view.table) { view.table.lift(id); }
}

/**
 * @description Puts the lifted hand card back down
 */
export function dropCard() {
	liftCard(null);
}

/**
 * @description Opens a passive pile or an active spot into its column, or closes it when it's the one open (the
 * keyboard's way to what a click on the pile does)
 * @param  {[string]} pile [a key of tableLayout.js PILES]
 */
export function toggleCardPile(pile) {
	if (view && view.table) { view.table.togglePile(pile); }
}

/**
 * @description The pile that is open
 * @return {[string|null]} [a key of tableLayout.js PILES, null for none]
 */
export function openCardPile() {
	return view && view.table ? view.table.open() : null;
}

/**
 * @description The window was resized & the camera has settled (camera/index.js resize, after a drag's settle): a new size
 * lays the table's plaques again inside the desk now in view
 */
export function relayPlaques() {
	const due = view.relayDue;
	view.relayDue = false;
	if (!due || !view.table) { return; }
	const up = view.table.buttonCount() > 0;
	// The plaques came back or went: flow.js lays the prompt again, so its 2D buttons hide or show
	if (view.table.relayButtons() !== up) { view.cardOptions.onTable({ kind: "table" }); }
}

/**
 * @description A prompt's brass plaque buttons on the table, or none (cardTable.buttons.js showButtons). Not kept for a room
 * still loading, nor laid when they'd cover something in view: that prompt keeps its 2D buttons
 * @param  {[array]} list [[{ id, label }], [] takes them away]
 * @param  {[object|null]} anchor [{ x, z, side } (tableLayout.js plaqueAnchor)]
 * @return {[boolean]} [plaques are up]
 */
export function showTableButtons(list, anchor) {
	if (!view || !view.table) { return false; }
	const up = view.table.showButtons(list, anchor);
	rehoverPlaque(); // Another list comes up unlit: the one under a still mouse lights
	return up;
}

/**
 * @description The keyboard's plaque (cardTable.buttons.js focusButton): its 2D button has the focus
 * @param  {[number|null]} index [in showTableButtons' list, null for none]
 */
export function focusTableButton(index) {
	if (view && view.table) { view.table.focusButton(index); }
}

/**
 * @description A plaque pressed sinks & rises (cardTable.buttons.js pressButton)
 * @param  {[string]} id
 */
export function pressTableButton(id) {
	if (view && view.table) { view.table.pressButton(id); }
}

/**
 * @description The squares a card play can go to next glow (their own highlight, so the 2D marks never clear them), &
 * the keyboard's one gets a ring
 * @param  {[string[]]} squares [["e4", ...], [] for none]
 * @param  {[string|null]} focus [the keyboard's square]
 */
export function highlightSquares(squares, focus = null) {
	highlight(squares, "cards");
	highlight(focus ? [focus] : [], "cardFocus");
	focusStatuses(focus); // Its piece's statuses, named before Enter picks it
}
