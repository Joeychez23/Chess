/* ---- Chess Cards table: the cards on it (made, placed, slid, freed), the layout, the hand cards' lift, light and preview, and the
drag (createCardTable, index.js) ---- */

import { Plane, Vector3 } from "three";
import { CARD_SIZE, CARD_Y, DECK } from "../cardLayout.js";
import {
	findParts, lerp, CARD_LIGHT, CARD_BACK, HOVER_LIGHT, FRAME_DROP, LIFT, LIFT_MS, DEAL_MS, DEAL_STAGGER_MS, STACK_STEP, FACE_W,
	FACE_H
} from "./promotionCards.js";
import { DESK_Y } from "../constants.js";
import { faceOf, drawPlayFace, drawBackFace } from "./cardFaces.js";
import { tableSpots, pileCards, columnBox, placeAt, deskPoint, PILES, DISCARD, HAND_Z } from "./tableLayout.js";
import { CARD_LAYER, PILE_BASE_LIFT } from "./cardTable.piles.js";
import { duelPath, giveFace } from "./cardTable.duel.js";

// A hand card with no play but a discard this turn (select.js dimmed): its face under less light
const DIM_LIGHT = 0x6E6654;
// A lifted (picked) card floats this high, above a hovered one. An ability card picked by a click or tap isn't lifted: flow.js
// never asks for it (select.js liftedCard)
const PICK_LIFT = 1.1;
// The lifted card's preview: this fraction of the face texture's size
const PILE_FACE = 0.5;
// A dragged card floats at a lifted hand card's height, under the pointer
const DRAG_Y = CARD_Y + PICK_LIFT;

// The frame's height: a hand card's just under it, a pile card's at its own height (under it is the desk top, which hides it)
function frameY(c) {
	return c.spot.y - (c.spot.pile || c.spot.discard ? 0 : FRAME_DROP);
}

/**
 * @description The table's cards and hand: what createCardTable's table (index.js) gets from this part
 * @param {object} table createCardTable's shared fields
 * @returns {object} the part's functions
 */
export function handPart(table) {
	const dragPlane = new Plane(new Vector3(0, 1, 0), -DRAG_Y);
	const dragPoint = new Vector3();
	const deskAt = new Vector3();
	let hovered = null;
	// The first layout is done
	let laid = false;

	// A clone of the template: face up with its own canvas, or face down in back's colour (its face underneath, never seen)
	function make(faceDown, back = table.backMaterial) {
		const root = table.template.clone(true);
		const parts = findParts(root);
		// The template is hidden (room.js), and its clone with it
		root.visible = true;
		parts.back.material = back;
		const c = {
			root, face: parts.face, back: parts.back, faceMaterial: null, canvas: null, texture: null, faceKey: null,
			scaleY: root.scale.y, spot: null, at: null, lift: 0, liftTo: 0, moveToken: 0, liftToken: 0, landed: false
		};
		if (faceDown) {
			// Turned over: the back on top
			parts.face.material = back;
			root.rotation.z = Math.PI;
		} else {
			giveFace(c);
		}
		table.room.add(root);
		return c;
	}

	function free(c) {
		c.moveToken++;
		c.liftToken++;
		table.room.remove(c.root);
		if (c.texture) {
			c.texture.dispose();
			c.faceMaterial.dispose();
		}
	}

	// Puts a card where its place on the way (at) and its lift say. Face down it's turned over, so it sits a card's thickness higher
	// (a discard pile's block: its whole thickness)
	function place(c) {
		c.root.position.set(c.at.x, c.at.y + c.lift + (c.spot.faceDown ? STACK_STEP * (c.spot.thick || 1) : 0), c.at.z);
		c.root.rotation.y = c.at.yaw;
		if (table.frame.visible && c === focusedCard()) { table.frame.position.set(c.at.x, frameY(c), c.at.z); }
	}

	// Slides a card to its spot (from the deck when it's new), as the promotion cards are dealt. done runs once it lands, unless
	// another slide or free() came first. via: false, or the height the duel waypoints are raised by (duelPath's rise)
	function moveTo(c, delay, done = () => {}, via = false) {
		const token = ++c.moveToken;
		const from = { ...c.at };
		const to = { x: c.spot.x, y: c.spot.y, z: c.spot.z, yaw: c.spot.yaw || 0 };
		if (table.still() || (from.x === to.x && from.y === to.y && from.z === to.z && from.yaw === to.yaw)) {
			c.at = to;
			c.landed = true;
			place(c);
			done();
			return;
		}
		c.landed = false;
		table.animations.add({
			duration: DEAL_MS, delay,
			update(k) {
				if (token !== c.moveToken) { return; }
				c.at = via !== false
					? duelPath(from, to, k, via)
					: { x: lerp(from.x, to.x, k), y: lerp(from.y, to.y, k), z: lerp(from.z, to.z, k), yaw: lerp(from.yaw, to.yaw, k) };
				place(c);
			},
			onEnd() {
				if (token === c.moveToken) {
					c.landed = true;
					placeFrame();
					table.requestRender();
					done();
				}
			},
		});
	}

	// The keyboard's card: a hand card, a pile's newest, or one of the player's duel cards of the current set
	function focusedCard() {
		return table.current.focus
			? table.cards.get(`${table.current.view.you}:${table.current.focus}`) || null
			: table.current.focusPile
				? table.pileTop(table.current.focusPile)
				: table.current.focusDuel !== null && table.duelDeal
					? table.duelCards.get(`mine:${table.duelDeal.spades ? "spades" : "round"}:${table.current.focusDuel}`) || null
					: null;
	}

	// The gold frame goes round the keyboard's card once it has landed, as on the promotion cards
	function placeFrame() {
		const c = focusedCard();
		const on = Boolean(c && c.landed);
		table.frame.visible = on;
		if (on) { table.frame.position.set(c.at.x, frameY(c), c.at.z); }
	}

	// Each hand card's lift and light: lifted (picked) highest, hovered or focused a little
	function refreshLift() {
		for (const [key, c] of table.cards) {
			if (!c.spot.hand || (table.drag && table.drag.c === c && table.drag.moved)) { continue; }
			const id = key.slice(2);
			const up = c.spot.staged ? 0 : id === table.lifted ? PICK_LIFT : id === hovered || id === table.current.focus ? LIFT : 0;
			if (c.faceMaterial) { c.faceMaterial.color.setHex(table.current.dim.includes(id) ? DIM_LIGHT : up ? HOVER_LIGHT : CARD_LIGHT); }
			if (up === c.liftTo) { continue; }
			c.liftTo = up;
			const token = ++c.liftToken;
			const from = c.lift;
			if (table.still()) {
				c.lift = up;
				place(c);
				continue;
			}
			table.animations.add({
				duration: LIFT_MS,
				update(k) {
					if (token !== c.liftToken) { return; }
					c.lift = lerp(from, up, k);
					place(c);
				}
			});
		}
		placeFrame();
		table.requestRender();
	}

	// Draws a face-up card's face when what it shows has changed. A hidden card of the discard list (card null) shows its back with
	// its owner's name bar, untinted as backMaterial
	function paint(c) {
		const face = c.spot.card ? faceOf(c.spot.card, table.current.catalog) : null;
		const key = JSON.stringify([face, c.spot.color, c.spot.barBottom]);
		if (key === c.faceKey) { return; }
		c.faceKey = key;
		const ctx = c.canvas.getContext("2d");
		ctx.clearRect(0, 0, FACE_W, FACE_H);
		if (face) {
			drawPlayFace(ctx, face, c.spot.color, FACE_W, FACE_H, c.spot.barBottom);
		} else {
			drawBackFace(ctx, `#${CARD_BACK.toString(16).padStart(6, "0")}`, FACE_W, FACE_H, c.spot.barBottom);
		}
		// A list card is never a hand card, whose light refreshLift sets; a hidden one is untinted (white)
		if (c.spot.log) { c.faceMaterial.color.setHex(face ? CARD_LIGHT : 0xFFFFFF); }
		c.texture.needsUpdate = true;
	}

	// Lays the table out for current: new cards slide in (from the red deck, or from Card Guy's hand to his places), moved ones
	// slide to their new spot (one there or on its way already is left alone), and gone ones are taken away
	function lay() {
		// Its last card left
		if (table.openPile && !pileCards(table.current.view, table.openPile).length) { table.openPile = null; }
		const want = tableSpots(table.current.view, {
			open: table.openPile, base: DESK_Y + PILE_BASE_LIFT, layer: CARD_LAYER, stage: table.stage, stacked: Boolean(table.duelDeal)
		});
		// Its card left the hand (or was never in it), or the hands lie stacked for a duel
		if (table.zoomId && (table.duelDeal || !(want.get(`${table.current.view.you}:${table.zoomId}`) || {}).hand)) { table.zoomId = null; }
		for (const [key, c] of [...table.cards]) {
			const w = want.get(key);
			if (w && w.faceDown === c.spot.faceDown) { continue; }
			// The dragged card left the table
			if (table.drag && table.drag.c === c) {
				table.drag = null;
				showLands([]);
			}
			free(c);
			table.cards.delete(key);
		}
		let dealt = 0;
		for (const [key, spot] of want) {
			let c = table.cards.get(key);
			if (!c) {
				c = make(spot.faceDown);
				// On the first layout (a game loaded) the places' cards lie there already
				const from = spot.from === "deck" ? DECK : spot.from === "hand" && laid ? { x: 0, y: CARD_Y, z: -HAND_Z } : spot;
				c.at = { x: from.x, y: from.y, z: from.z, yaw: spot.yaw || 0 };
				table.cards.set(key, c);
				c.spot = spot;
				c.root.scale.y = c.scaleY * (spot.thick || 1);
				if (!spot.faceDown) { paint(c); }
				moveTo(c, spot.from === "deck" ? (dealt++) * DEAL_STAGGER_MS : 0);
				continue;
			}
			const was = c.spot;
			c.spot = spot;
			c.root.scale.y = c.scaleY * (spot.thick || 1);
			if (!spot.faceDown) { paint(c); }
			// Under the pointer
			if (table.drag && table.drag.c === c && table.drag.moved) { continue; }
			if (c.adrift) {
				// Let go: it slides from there to where it lies now
				c.adrift = false;
				moveTo(c, 0);
			} else if (was.x !== spot.x || was.y !== spot.y || was.z !== spot.z || (was.yaw || 0) !== (spot.yaw || 0)) {
				// The same spot: a slide on its way there (or its deal's stagger) goes on
				moveTo(c, 0);
			} else if (was.thick !== spot.thick) {
				place(c);
			}
		}
		laid = true;
		table.frameOpen();
		refreshLift();
		// The lifted card left the hand, or the catalog came
		showPreview();
	}

	function showLands(places) {
		for (const m of table.lands) { m.visible = places.includes(m.userData.place); }
		table.requestRender();
	}

	/* ---- The lifted card's preview: a hand card with rules text (an active, the held passive, a curse), big enough to read, beside
	the board while it's lifted, as the owner asked (2026-11-22). The card the keys pick and the drop's target pick both show it ---- */
	let preview = null;
	let previewKey = null;
	function showPreview() {
		const c = table.lifted && table.current.view ? table.cards.get(`${table.current.view.you}:${table.lifted}`) : null;
		const face = c && c.spot.card ? faceOf(c.spot.card, table.current.catalog) : null;
		const key = face && face.text ? JSON.stringify(face) : null;
		if (key === previewKey) { return; }
		previewKey = key;
		if (preview) {
			preview.remove();
			preview = null;
		}
		if (!key) { return; }
		preview = document.createElement("canvas");
		// No pointer events (board3D.css): the board under it still takes the card's targets
		preview.className = "cardPreview";
		preview.width = Math.round(FACE_W * PILE_FACE);
		preview.height = Math.round(FACE_H * PILE_FACE);
		preview.setAttribute("role", "img");
		preview.setAttribute("aria-label", `${face.name}, ${face.type}: ${face.text}`);
		drawPlayFace(preview.getContext("2d"), face, c.spot.color, preview.width, preview.height, false);
		document.body.append(preview);
	}

	return {
		make, free, place, moveTo, placeFrame, lay, showPreview,
		/**
		 * @description Lays the table out for a view (lay)
		 * @param {object} view cards.view
		 * @param {object} opts { catalog: cards.catalog, focus: the keyboard's hand card id | null, focusPile: the keyboard's pile (a
		 * key of tableLayout.js PILES) | null, focusDuel: the keyboard's duel card, an index 0..2 of the player's current set | null,
		 * dim: the hand card ids drawn dimmer }
		 */
		set(view, opts = {}) {
			table.current = {
				view,
				catalog: opts.catalog || {},
				focus: opts.focus || null,
				focusPile: opts.focusPile || null,
				focusDuel: Number.isInteger(opts.focusDuel) ? opts.focusDuel : null,
				dim: opts.dim || []
			};
			lay();
		},
		/**
		 * @description Lifts the picked hand card high and shows a readable copy of one with rules text beside the board (showPreview);
		 * the others go back down
		 * @param {string|null} id the card's id, null for none
		 */
		lift(id) {
			if (id === table.lifted) { return; }
			table.lifted = id;
			// The card let go on a place is no longer the one played: it goes where the view has it
			if (table.stage && table.stage.id !== id) {
				table.stage = null;
				if (table.current.view) { lay(); }
			}
			refreshLift();
			showPreview();
		},
		/**
		 * @description Lifts the hand card under the pointer a little and lights it
		 * @param {string|null} id
		 */
		hover(id) {
			if (id === hovered) { return; }
			hovered = id;
			refreshLift();
		},
		/**
		 * @description The mouse went down on a card: one of the player's hand cards, or a face-up card of their own opened pile, is
		 * held. It moves once the pointer does (follow)
		 * @param {{ id: string|null }} hit what hit() gave
		 * @param {string[]|null} places the player's places it can be let go on ("spot", "passive", "discard": framed while it's
		 * dragged), null: it isn't held
		 * @returns {boolean} held
		 */
		grab(hit, places) {
			const c = table.current.view && hit.id && places ? table.cards.get(`${table.current.view.you}:${hit.id}`) : null;
			if (!c || !(c.spot.hand || (c.spot.pile && c.spot.pile === table.openPile && PILES[table.openPile].side === "mine"))) { return false; }
			table.drag = { c, id: hit.id, from: c.spot.hand ? "hand" : "pile", places, moved: false, desk: null };
			return true;
		},
		/**
		 * @description The held card goes under the pointer, floating. The first time, its landing places are framed, and for a placed
		 * card the camera shows its column and the discard pile
		 * @param {Raycaster} raycaster already set from the camera and pointer
		 */
		follow(raycaster) {
			if (!table.drag || !raycaster.ray.intersectPlane(dragPlane, dragPoint)) { return; }
			// Flip Board turns the room
			table.room.worldToLocal(dragPoint);
			const c = table.drag.c;
			if (!table.drag.moved) {
				table.drag.moved = true;
				c.moveToken++;
				c.liftToken++;
				c.lift = c.liftTo = 0;
				c.landed = false;
				showLands(table.drag.places);
				// The camera goes back, so the places are in view
				if (table.zoomId) {
					table.zoomId = null;
					table.frameOpen();
				}
				if (table.drag.from === "pile") {
					const b = columnBox(c.spot.pile, pileCards(table.current.view, c.spot.pile).length);
					const d = DISCARD.mine;
					table.boxKey = "drag";
					table.frameBox({
						x0: Math.min(b.x0, d.x - CARD_SIZE.w / 2),
						x1: Math.max(b.x1, d.x + CARD_SIZE.w / 2),
						z0: Math.min(b.z0, d.z - CARD_SIZE.h / 2),
						z1: Math.max(b.z1, d.z + CARD_SIZE.h / 2)
					});
				}
			}
			c.at = { x: dragPoint.x, y: DRAG_Y, z: dragPoint.z, yaw: 0 };
			// The place it's dropped on is the desk under the pointer, not under the card floating nearer the camera
			const desk = deskPoint(raycaster.ray.origin, raycaster.ray.direction, DESK_Y);
			if (desk) { table.room.worldToLocal(deskAt.set(desk.x, DESK_Y, desk.z)); }
			table.drag.desk = desk ? { x: deskAt.x, z: deskAt.z } : null;
			place(c);
			table.requestRender();
		},
		/**
		 * @description The mouse let go of the held card. It stays where it is until settle()
		 * @returns {{ kind: "drop", from: "hand"|"pile", id: string, place: object|null }|null} what was dragged and the place under it
		 * (tableLayout.js placeAt), null when no card was dragged (a press that never moved: its click follows)
		 */
		release() {
			const d = table.drag;
			table.drag = null;
			if (!d || !d.moved) { return null; }
			showLands([]);
			const at = d.desk ? placeAt(d.desk.x, d.desk.z) : null;
			d.c.adrift = true;
			table.stage = at && at.side === "mine" ? { id: d.id, from: d.from, place: at.place } : null;
			return { kind: "drop", from: d.from, id: d.id, place: at };
		},
		/**
		 * @description After release(): the card lies on the place it was let go on while it's the lifted card (its play is on its
		 * way, or its targets are picked), or slides back to where it was. The camera goes back to the opened pile
		 * @param {boolean} held the drop was taken
		 */
		settle(held) {
			if (!held) { table.stage = null; }
			if (table.current.view) { lay(); }
		},
	};
}
