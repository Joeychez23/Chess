// The Chess Cards picks of 3D input: the promotion card, the table card or any card under a pointer event, a tap on a
// promotion card, a pile opened or closed, the promotion cards' dead zone and the baize point under a tap
import { view, pointer, raycaster } from "../index.js";
import { Matrix4, Plane, Ray, Vector3 } from "three";
import { isTap } from "../monitor/monitor.js";
import { CARD_ORDER, CARD_SIZE, CARD_Y, cardSpots } from "../cardLayout.js";
import { monitorIdle } from "./pointer.monitor.js";

/**
 * @description The dead zone round the dealt promotion cards, in card widths past each card's edge: a tap there is
 * swallowed, one past it cancels the promotion
 */
// About 1 unit, a mouse's wobble at the opening camera. The gaps between the cards (0.5) are inside it
export const PROMOTION_DEAD_ZONE = 0.25;
/**
 * @description The dead zone round the dealt promotion cards for a finger or a pen, in card widths: a fingertip lands
 * less precisely than a mouse
 */
export const PROMOTION_DEAD_ZONE_TOUCH = 0.5;
const PROMOTION_SPOTS = cardSpots();
// The cards' plane in the room's own units, and the scratch objects baizePoint casts onto it with
const CARD_PLANE = new Plane(new Vector3(0, 1, 0), -CARD_Y);
const roomRay = new Ray();
const roomInverse = new Matrix4();
const roomPoint = new Vector3();

// The promotion card under a pointer event (its index in CARD_ORDER), null for none, while the cards are out and the
// monitor is on the desk
export function cardAt(e) {
	if (!view.cards || !view.cards.dealt() || !monitorIdle()) { return null; }
	const rect = view.renderer.domElement.getBoundingClientRect();
	pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
	raycaster.setFromCamera(pointer, view.camera);
	return view.cards.hit(raycaster);
}

// The Chess Cards table under a pointer event (cardTable/index.js hit): one of the player's hand cards, a board effects pile,
// an active spot, a discard pile ("discard": the discard list) or a duel card. null for none, while the monitor is on
// the desk. Not a pile while a card duel is on: the piles don't open then
export function tableAt(e) {
	if (!view.table || !monitorIdle()) { return null; }
	const rect = view.renderer.domElement.getBoundingClientRect();
	pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
	raycaster.setFromCamera(pointer, view.camera);
	const hit = view.table.hit(raycaster);
	return hit && hit.kind === "pile" && view.tableArgs && view.tableArgs[0].duel ? null : hit;
}

// Any card of the Chess Cards table under a pointer event (cardTable/index.js covers): also the ones tableAt leaves out (Card
// Guy's hand, the piles and hands during a duel, his duel cards), both decks, and while the menu is open (tableOn)
export function tableCovers(e) {
	if (!view.table) { return false; }
	const rect = view.renderer.domElement.getBoundingClientRect();
	pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
	raycaster.setFromCamera(pointer, view.camera);
	return view.table.covers(raycaster);
}

// A tap (a click or a lifted finger) on a card picks it. Stops the event when stop is true (a click: the board must not
// see it)
export function pickCard(e, stop) {
	if (view.cameraGesture || !isTap(view.press, { x: e.clientX, y: e.clientY }, view.pointerType)) { return false; }
	const index = cardAt(e);
	if (index === null) { return false; }
	if (stop) { e.stopPropagation(); }
	view.cardOptions.onPick(CARD_ORDER[index]);
	return true;
}

// A tap opens or closes a pile. flow.js hears of it (id: null): the drop buttons of the pile that was open go
export function togglePile(pile) {
	view.table.togglePile(pile);
	view.cardOptions.onTable({ kind: "pile", pile: view.table.open(), id: null });
}

/**
 * @description Whether a point on the baize is on a dealt promotion card or within the dead zone of one (the cards lie
 * at cardSpots(), CARD_SIZE.w along x)
 * @param  {[object|null]} point [{ x, z } in the room's own units, null when the tap's ray missed the baize's plane]
 * @param  {[number]} zone [the dead zone in card widths: PROMOTION_DEAD_ZONE (the mouse's, the default) or
 * PROMOTION_DEAD_ZONE_TOUCH]
 * @return {[boolean]}
 */
export function inPromotionDeadZone(point, zone = PROMOTION_DEAD_ZONE) {
	if (!point) { return false; }
	const margin = zone * CARD_SIZE.w;
	return PROMOTION_SPOTS.some((spot) => Math.abs(point.x - spot.x) <= CARD_SIZE.w / 2 + margin
		&& Math.abs(point.z - spot.z) <= CARD_SIZE.h / 2 + margin);
}

// The point on the baize under a pointer event, in the room's own units: the cards turn with it. null off the plane
export function baizePoint(e) {
	const rect = view.renderer.domElement.getBoundingClientRect();
	pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
	raycaster.setFromCamera(pointer, view.camera);
	roomInverse.copy(view.room.matrixWorld).invert();
	return roomRay.copy(raycaster.ray).applyMatrix4(roomInverse).intersectPlane(CARD_PLANE, roomPoint);
}
