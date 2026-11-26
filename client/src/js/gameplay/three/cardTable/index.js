/* ---- Chess Cards table: both hands, the card duel dealt from the room's baked green deck and each player's three places (the
active spot, the passive pile, the discard pile: tableLayout.js), every card a clone of the room's card at the promotion cards'
size and look (promotionCards.js) ---- */

import { MeshBasicMaterial, MeshStandardMaterial, Mesh, Ray, Matrix4 } from "three";
import { CARD_SIZE } from "../cardLayout.js";
import { findParts, frameGeometry, CARD_BACK, FOCUS, FRAME_GAP, FRAME_WIDTH } from "./promotionCards.js";
import { DESK_Y } from "../constants.js";
import { spotHit } from "./tableLayout.js";
import { DECK_BOXES, LANDINGS, pilesPart } from "./cardTable.piles.js";
import { handPart } from "./cardTable.hand.js";
import { GREEN_BACK, DUEL_OUT, DUEL_WAYPOINT, duelPath, duelPart } from "./cardTable.duel.js";
import { BRASS_MATERIAL, PLAQUE_FOCUS, deskInView, buttonsPart } from "./cardTable.buttons.js";

export { DUEL_OUT, DUEL_WAYPOINT, duelPath, deskInView };

/**
 * @description The Chess Cards table in the room, made from its card template. Its cards are children of the room, so they turn
 * with it (Flip Board)
 * @param {{ template: Object3D, room: Group, animations: object, requestRender: () => void, still?: () => boolean,
 * frame?: (box: object|null, zoom?: string|null) => void }} options as createCards (promotionCards.js), and
 * frame: the camera frames this much of the desk (an opened pile's column, tableLayout.js columnBox, or the zoomed hand card's
 * footprint), null: it goes back (camera/index.js framePile); zoom: the hand card zoomed in on, null (or none) for none;
 * inView: the desk the camera shows now (deskInView), null for the whole desk: the plaques lie inside it;
 * camera: the live camera, null for none: plaques laid where any corner would be off screen aren't laid, and the prompt keeps its
 * 2D buttons
 * @returns {{ set: Function, lift: Function, hover: Function, hit: Function, covers: Function, togglePile: Function, open: Function,
 * zoom: Function, zoomed: Function, grab: Function, follow: Function, release: Function, settle: Function, dealDuel: Function,
 * flipDuel: Function, endDuel: Function, showButtons: Function, relayButtons: Function, buttonCount: Function, focusButton: Function,
 * hoverButton: Function, pressButton: Function, dispose: Function }|null} the table, null when the template can't be used
 */
export function createCardTable({
	template, room, animations, requestRender, still = () => false, frame: frameBox = () => {}, inView = () => null, camera = null
}) {
	if (!findParts(template)) { return null; }
	const backMaterial = new MeshBasicMaterial({ color: CARD_BACK });
	const greenMaterial = new MeshBasicMaterial({ color: GREEN_BACK });
	const frameMaterial = new MeshBasicMaterial({
		color: FOCUS.color, opacity: FOCUS.opacity, transparent: FOCUS.opacity < 1, depthWrite: false
	});
	const frame = new Mesh(frameGeometry(CARD_SIZE.w + FRAME_GAP * 2, CARD_SIZE.h + FRAME_GAP * 2, FRAME_WIDTH), frameMaterial);
	frame.visible = false;
	room.add(frame);
	// A gold frame round each place the dragged card can be let go on (an empty place draws nothing else)
	const lands = Object.entries(LANDINGS).map(function ([place, p]) {
		const m = new Mesh(frame.geometry, frameMaterial);
		m.position.set(p.x, DESK_Y + 0.02, p.z);
		m.visible = false;
		m.userData.place = place;
		room.add(m);
		return m;
	});
	// covers' ray in the room's space, where the decks are
	const roomRay = new Ray();
	const roomInverse = new Matrix4();
	/* ---- The opened pile: its cards in a column on the desk (tableLayout.js), the camera framing it. Nothing is drawn over the
	screen: a hidden live region reads the cards out for a screen reader ---- */
	const reader = document.createElement("p");
	reader.className = "cardPileText";
	reader.setAttribute("role", "status");
	document.body.append(reader);
	/* ---- The brass plaque buttons (table UI doc, "3D buttons on the table"): bevelled bars of the red deck's brass lit by the room,
	engraved capitals on each plaque's top, brighter when hovered, a white-gold frame round the keyboard's (tableLayout.js
	buttonLayout) ---- */
	// The bevel and sides, shared
	const plaqueBrass = new MeshStandardMaterial(BRASS_MATERIAL);
	const plaqueFocus = new MeshBasicMaterial({ color: PLAQUE_FOCUS.color });
	// What more than one part reads or writes (cardTable.hand.js, .piles.js, .duel.js, .buttons.js), one per table; the parts' own
	// functions are added to it below
	const table = {
		template, room, animations, requestRender, still, frameBox, inView, camera, backMaterial, greenMaterial, frameMaterial, frame,
		// Key (tableLayout.js tableSpots: the owner and the card's id) -> { root, face, faceMaterial, canvas, texture, faceKey, scaleY,
		// spot, at, lift, liftTo, moveToken, liftToken, landed }
		cards: new Map(),
		current: { view: null, catalog: {}, focus: null, focusPile: null, focusDuel: null, dim: [] },
		// tableLayout.js duelLayout's key -> a card as in cards, with duel (its duelLayout entry, card set as it flips) and outline (the
		// won card's gold frame)
		duelCards: new Map(),
		// Duel cards going back to the green deck
		leaving: new Set(),
		// The duel laid: { round, player, piece, spades, flips: the set flipDuel turns }. While it's set, the hands lie stacked
		duelDeal: null,
		lands,
		// The card the mouse holds: { c, id, from: "hand" | "pile", places, moved, desk: the desk under the pointer { x, z } | null }
		drag: null,
		// The card let go on a place, lying there while it's the lifted one (tableLayout.js tableSpots)
		stage: null,
		lifted: null,
		// The pile opened into a column
		openPile: null,
		// The hand card the camera frames (zoom)
		zoomId: null,
		// What the camera was last told to frame
		boxKey: "null",
		reader, plaqueBrass, plaqueFocus,
		// In order: { id, mesh, top (its top's material), texture, ring (the focus frame, a child of mesh), token }
		buttons: [],
		buttonsKey: "[]",
		// The last showButtons' list, anchor, cards under and view (a repeat lays nothing out)
		buttonsAsked: null,
		// The view the prompt withinFor (its list and anchor) came up in: kept until another prompt or relayButtons, so the plaques
		// don't chase the camera
		buttonsWithin: null,
		withinFor: null,
		// The last showButtons' arguments
		buttonsArgs: null,
	};
	Object.assign(table, handPart(table), pilesPart(table), duelPart(table), buttonsPart(table));

	return {
		set: table.set,
		lift: table.lift,
		hover: table.hover,
		/**
		 * @description What a ray hits first: one of the player's hand cards (none while a duel is laid: the hands are stacked), a card
		 * of a passive pile or an active spot (shut or opened into its column), a card of either discard pile or of the opened discard
		 * list (its pile: "discard", face down too), or a duel card the player may pick now (tableLayout.js duelLayout's pickable, as of
		 * the last dealDuel)
		 * @param {Raycaster} raycaster already set from the camera and pointer
		 * @returns {{ kind: "hand", id: string }|{ kind: "pile", pile: string, id: string|null }|{ kind: "duel", index: number }|null} as
		 * tableLayout.js spotHit, or index: 0..2 in the view's duel hands
		 */
		hit(raycaster) {
			// A plaque never covers a card (buttonLayout), but a card may come under one laid first: the plaque wins
			const plaque = raycaster.intersectObjects(table.buttons.map((b) => b.mesh), false)[0];
			if (plaque) { return { kind: "button", id: plaque.object.userData.button }; }
			const picks = [...table.cards].filter(([key, c]) => spotHit(key, c.spot) && !(c.spot.hand && table.duelDeal));
			const duels = [...table.duelCards.values()].filter((c) => c.duel.pickable);
			// A discard pile's cards and the list's take a face-down one too
			function meshes([, c]) {
				return c.spot.hand || c.spot.pile ? [c.face] : [c.face, c.back];
			}
			// A turned card's face looks down: a ray from above meets only its back (front faces only)
			const first = raycaster.intersectObjects([...picks.flatMap(meshes), ...duels.flatMap((c) => [c.face, c.back])], false)[0];
			if (!first) { return null; }
			const duel = duels.find((x) => x.face === first.object || x.back === first.object);
			if (duel) { return { kind: "duel", index: duel.duel.index }; }
			const [key, c] = picks.find(([, x]) => x.face === first.object || x.back === first.object);
			return spotHit(key, c.spot);
		},
		/**
		 * @description Whether a ray meets any card on the table, also the ones hit() leaves out: Card Guy's hand, the hands stacked
		 * for a duel, every pile and place during a duel, a duel card the player can't pick (pointer/index.js: a left mouse press there never
		 * moves the camera), and both decks, the green one and the red one baked into the room, as the owner asked
		 * @param {Raycaster} raycaster already set from the camera and pointer
		 * @returns {boolean}
		 */
		covers(raycaster) {
			if (raycaster.intersectObjects(
				[...table.cards.values(), ...table.duelCards.values(), ...table.leaving].flatMap((c) => [c.face, c.back]).concat(table.buttons.map((b) => b.mesh)),
				false
			).length > 0) {
				return true;
			}
			// Flip Board turns the room
			roomRay.copy(raycaster.ray).applyMatrix4(roomInverse.copy(room.matrixWorld).invert());
			return DECK_BOXES.some((box) => roomRay.intersectsBox(box));
		},
		togglePile: table.togglePile,
		zoom: table.zoom,
		zoomed: table.zoomed,
		open: table.open,
		grab: table.grab,
		follow: table.follow,
		release: table.release,
		settle: table.settle,
		dealDuel: table.dealDuel,
		flipDuel: table.flipDuel,
		endDuel: table.endDuel,
		showButtons: table.showButtons,
		relayButtons: table.relayButtons,
		buttonCount: table.buttonCount,
		focusButton: table.focusButton,
		hoverButton: table.hoverButton,
		pressButton: table.pressButton,
		/**
		 * @description Takes every card, plaque and the frame out of the room and frees what they own. The template's geometry is the
		 * room's to free
		 */
		dispose() {
			table.freeButtons();
			table.buttonsKey = "[]";
			table.buttonsAsked = table.withinFor = table.buttonsWithin = table.buttonsArgs = null;
			plaqueBrass.dispose();
			plaqueFocus.dispose();
			if (table.openPile || table.zoomId) { frameBox(null); }
			reader.remove();
			table.lifted = null;
			table.showPreview();
			for (const c of [...table.cards.values(), ...table.duelCards.values(), ...table.leaving]) {
				if (c.outline) { room.remove(c.outline); }
				table.free(c);
			}
			table.cards.clear();
			table.duelCards.clear();
			table.leaving.clear();
			table.duelDeal = null;
			table.drag = table.stage = null;
			for (const m of lands) { room.remove(m); }
			room.remove(frame);
			backMaterial.dispose();
			greenMaterial.dispose();
			frame.geometry.dispose();
			frameMaterial.dispose();
		},
	};
}
