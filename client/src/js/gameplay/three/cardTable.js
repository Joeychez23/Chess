/* ---- Chess Cards table: both hands, the green deck & each player's three places (the active spot, the passive pile, the discard pile: tableLayout.js), every card a clone of the room's card at the promotion cards' size & look (cards.js) ---- */

import { CanvasTexture, SRGBColorSpace, MeshBasicMaterial, Mesh } from "three";
import { CARD_SIZE, DECK, CARD_Y } from "./cardLayout.js";
import { findParts, frameGeometry, lerp, CARD_LIGHT, CARD_BACK, HOVER_LIGHT, FOCUS, FRAME_GAP, FRAME_WIDTH, FRAME_DROP, LIFT, LIFT_MS, DEAL_MS, DEAL_STAGGER_MS, STACK_STEP, FACE_W, FACE_H } from "./cards.js";
import { DESK_Y } from "./constants.js";
import { faceOf, drawPlayFace } from "./cardFaces.js";
import { tableSpots, pileCards, columnBox, HAND_Z } from "./tableLayout.js";

const LAYER = STACK_STEP + 0.001; // A CARD'S THICKNESS (cards.js STACK_STEP) & A HAIR: AN OVERLAPPING CARD LIES ON THE ONE UNDER IT
const DIM_LIGHT = 0x6E6654; // A HAND CARD WITH NO PLAY BUT A DISCARD THIS TURN (select.js dimmed): ITS FACE UNDER LESS LIGHT
const GREEN_DECK = { x: -DECK.x, z: DECK.z }; // THE MIRROR OF THE RED DECK (BAKED INTO THE ROOM)
const GREEN_DECK_CARDS = 4; // AS MANY SLABS AS THE RED DECK, SQUARED UP: ONE CARD'S FOOTPRINT
const GREEN_BACK = 0x0E3B22;
const PICK_LIFT = 1.1; // A LIFTED (PICKED) CARD FLOATS THIS HIGH, ABOVE A HOVERED ONE
const PILE_FACE = 0.5; // THE LIFTED CARD'S PREVIEW: THIS FRACTION OF THE FACE TEXTURE'S SIZE
const PILE_NAMES = { mine: "Your passives", his: "Card Guy's passives", mineSpot: "Your actives in effect", hisSpot: "Card Guy's actives in effect" }; // WHAT A SCREEN READER HEARS OF AN OPENED PILE

/**
 * @description The Chess Cards table in the room, made from its card template. Children of the room, so they turn with it (Flip Board)
 * @param {{ template: Object3D, room: Group, tweens: object, requestRender: () => void, still?: () => boolean, frame?: (box: object|null) => void }} options as createCards (cards.js), & frame: the camera frames this much of the desk
 * (an opened pile's column, tableLayout.js columnBox), null: it goes back (camera.js framePile)
 * @returns {{ set: Function, lift: Function, hover: Function, hit: Function, togglePile: Function, open: Function, dispose: Function }|null} the table, null when the template can't be used
 */
export function createCardTable({ template, room, tweens, requestRender, still = () => false, frame: frameBox = () => {} }) {
	if (!findParts(template)) { return null; }
	const backMaterial = new MeshBasicMaterial({ color: CARD_BACK });
	const greenMaterial = new MeshBasicMaterial({ color: GREEN_BACK });
	const frameMaterial = new MeshBasicMaterial({ color: FOCUS.color, opacity: FOCUS.opacity, transparent: FOCUS.opacity < 1, depthWrite: false });
	const frame = new Mesh(frameGeometry(CARD_SIZE.w + FRAME_GAP * 2, CARD_SIZE.h + FRAME_GAP * 2, FRAME_WIDTH), frameMaterial);
	frame.visible = false;
	room.add(frame);
	const cards = new Map(); // KEY (tableLayout.js tableSpots: THE OWNER & THE CARD'S ID) -> { root, face, faceMaterial, canvas, texture, faceKey, scaleY, spot, at, lift, liftTo, moveToken, liftToken, landed }
	let current = { view: null, catalog: {}, focus: null, focusPile: null, dim: [] };
	let lifted = null, hovered = null, openPile = null, boxKey = "null", laid = false; // openPile: THE PILE OPENED INTO A COLUMN, boxKey: WHAT THE CAMERA WAS LAST TOLD TO FRAME, laid: THE FIRST LAYOUT IS DONE

	// A CLONE OF THE TEMPLATE: FACE UP WITH ITS OWN CANVAS, OR FACE DOWN IN back'S COLOUR (ITS FACE UNDERNEATH, NEVER SEEN)
	function make(faceDown, back = backMaterial) {
		const root = template.clone(true), parts = findParts(root);
		root.visible = true; // THE TEMPLATE IS HIDDEN (room.js), ITS CLONE WITH IT
		parts.back.material = back;
		const c = { root, face: parts.face, faceMaterial: null, canvas: null, texture: null, faceKey: null, scaleY: root.scale.y, spot: null, at: null, lift: 0, liftTo: 0, moveToken: 0, liftToken: 0, landed: false };
		if (faceDown) { parts.face.material = back; root.rotation.z = Math.PI; } // TURNED OVER: THE BACK ON TOP
		else {
			c.canvas = document.createElement("canvas");
			c.canvas.width = FACE_W;
			c.canvas.height = FACE_H;
			c.texture = new CanvasTexture(c.canvas);
			c.texture.colorSpace = SRGBColorSpace;
			c.texture.flipY = false; // AS cards.js: THE FACE QUAD'S UVs RUN FROM THE CARD'S TOP EDGE AT v = 0
			c.faceMaterial = new MeshBasicMaterial({ map: c.texture, color: CARD_LIGHT });
			parts.face.material = c.faceMaterial;
		}
		room.add(root);
		return c;
	}

	function free(c) {
		c.moveToken++;
		c.liftToken++;
		room.remove(c.root);
		if (c.texture) { c.texture.dispose(); c.faceMaterial.dispose(); }
	}

	// THE GREEN DECK: A NEW PROP, FACE DOWN, SQUARED UP SO ITS FOOTPRINT IS ONE CARD'S
	const green = Array.from({ length: GREEN_DECK_CARDS }, function (_, i) {
		const c = make(true, greenMaterial);
		c.root.position.set(GREEN_DECK.x, DESK_Y + STACK_STEP + i * STACK_STEP, GREEN_DECK.z);
		return c;
	});

	// PUTS A CARD WHERE ITS PLACE ON THE WAY (at) & ITS LIFT SAY. FACE DOWN IT'S TURNED OVER, SO IT SITS A CARD'S THICKNESS HIGHER (A DISCARD PILE'S BLOCK: ITS WHOLE THICKNESS)
	function place(c) {
		c.root.position.set(c.at.x, c.at.y + c.lift + (c.spot.faceDown ? STACK_STEP * (c.spot.thick || 1) : 0), c.at.z);
		c.root.rotation.y = c.at.yaw;
		if (frame.visible && c === focusedCard()) { frame.position.set(c.at.x, frameY(c), c.at.z); }
	}

	// THE FRAME'S HEIGHT: A HAND CARD'S JUST UNDER IT, A PILE CARD'S AT ITS OWN HEIGHT (UNDER IT IS THE DESK TOP, WHICH HIDES IT)
	const frameY = (c) => c.spot.y - (c.spot.pile ? 0 : FRAME_DROP);

	// SLIDES A CARD TO ITS SPOT (FROM THE DECK WHEN IT'S NEW), AS THE PROMOTION CARDS ARE DEALT
	function moveTo(c, delay) {
		const token = ++c.moveToken, from = { ...c.at }, to = { x: c.spot.x, y: c.spot.y, z: c.spot.z, yaw: c.spot.yaw || 0 };
		if (still() || (from.x === to.x && from.y === to.y && from.z === to.z && from.yaw === to.yaw)) { c.at = to; c.landed = true; place(c); return; }
		c.landed = false;
		tweens.add({
			duration: DEAL_MS, delay,
			update(k) { if (token !== c.moveToken) { return; } c.at = { x: lerp(from.x, to.x, k), y: lerp(from.y, to.y, k), z: lerp(from.z, to.z, k), yaw: lerp(from.yaw, to.yaw, k) }; place(c); },
			onEnd() { if (token === c.moveToken) { c.landed = true; placeFrame(); requestRender(); } },
		});
	}

	// THE KEYBOARD'S CARD: A HAND CARD, OR A PILE'S NEWEST
	const focusedCard = () => (current.focus ? cards.get(`${current.view.you}:${current.focus}`) || null : current.focusPile ? [...cards.values()].find((c) => c.spot.pile === current.focusPile && c.spot.top) || null : null);

	// THE GOLD FRAME GOES ROUND THE KEYBOARD'S CARD ONCE IT HAS LANDED, AS ON THE PROMOTION CARDS
	function placeFrame() {
		const c = focusedCard(), on = Boolean(c && c.landed);
		frame.visible = on;
		if (on) { frame.position.set(c.at.x, frameY(c), c.at.z); }
	}

	// EACH HAND CARD'S LIFT & LIGHT: LIFTED (PICKED) HIGHEST, HOVERED OR FOCUSED A LITTLE
	function refreshLift() {
		for (const [key, c] of cards) {
			if (!c.spot.hand) { continue; }
			const id = key.slice(2), up = id === lifted ? PICK_LIFT : id === hovered || id === current.focus ? LIFT : 0;
			if (c.faceMaterial) { c.faceMaterial.color.setHex(current.dim.includes(id) ? DIM_LIGHT : up ? HOVER_LIGHT : CARD_LIGHT); }
			if (up === c.liftTo) { continue; }
			c.liftTo = up;
			const token = ++c.liftToken, from = c.lift;
			if (still()) { c.lift = up; place(c); continue; }
			tweens.add({ duration: LIFT_MS, update(k) { if (token !== c.liftToken) { return; } c.lift = lerp(from, up, k); place(c); } });
		}
		placeFrame();
		requestRender();
	}

	// DRAWS A FACE-UP CARD'S FACE WHEN WHAT IT SHOWS CHANGED
	function paint(c) {
		const face = faceOf(c.spot.card, current.catalog), key = JSON.stringify([face, c.spot.color, c.spot.barBottom]);
		if (key === c.faceKey) { return; }
		c.faceKey = key;
		const ctx = c.canvas.getContext("2d");
		ctx.clearRect(0, 0, FACE_W, FACE_H);
		drawPlayFace(ctx, face, c.spot.color, FACE_W, FACE_H, c.spot.barBottom);
		c.texture.needsUpdate = true;
	}

	/* ---- The opened pile: its cards in a column on the desk (tableLayout.js), the camera framing it. Nothing over the screen: a hidden live region says the cards for a screen reader ---- */
	const reader = document.createElement("p");
	reader.className = "cardPileText";
	reader.setAttribute("role", "status");
	document.body.append(reader);
	function say(card) {
		if (card.down) { return "a face-down card"; }
		const face = faceOf(card, current.catalog);
		return `${face.name}, ${face.type}${face.text ? `: ${face.text}` : ""}`;
	}
	// THE CAMERA FRAMES THE OPENED PILE'S COLUMN, AGAIN WHEN IT GROWS OR SHRINKS, & GOES BACK WHEN NONE IS OPEN. A REFRESH THAT CHANGES NOTHING LEAVES THE CAMERA ALONE
	function frameOpen() {
		const list = openPile ? pileCards(current.view, openPile) : [], box = openPile ? columnBox(openPile, list.length) : null, key = JSON.stringify(box);
		const text = openPile ? `${PILE_NAMES[openPile]}, newest first: ${list.slice().reverse().map(say).join("; ")}` : "";
		if (reader.textContent !== text) { reader.textContent = text; }
		if (key === boxKey) { return; }
		boxKey = key;
		frameBox(box);
	}

	// LAYS THE TABLE OUT FOR current: NEW CARDS SLIDE IN (FROM THE RED DECK, OR FROM CARD GUY'S HAND TO HIS PLACES), MOVED ONES SLIDE TO THEIR NEW SPOT (ONE THERE OR ON ITS WAY ALREADY IS LEFT ALONE), GONE ONES ARE TAKEN AWAY
	function lay() {
		if (openPile && !pileCards(current.view, openPile).length) { openPile = null; } // ITS LAST CARD LEFT
		const want = tableSpots(current.view, { open: openPile, base: DESK_Y + 0.005, layer: LAYER });
		for (const [key, c] of [...cards]) {
			const w = want.get(key);
			if (w && w.faceDown === c.spot.faceDown) { continue; }
			free(c);
			cards.delete(key);
		}
		let dealt = 0;
		for (const [key, spot] of want) {
			let c = cards.get(key);
			if (!c) {
				c = make(spot.faceDown);
				const from = spot.from === "deck" ? DECK : spot.from === "hand" && laid ? { x: 0, y: CARD_Y, z: -HAND_Z } : spot; // THE FIRST LAYOUT (A GAME LOADED): THE PLACES' CARDS LIE THERE ALREADY
				c.at = { x: from.x, y: from.y, z: from.z, yaw: spot.yaw || 0 };
				cards.set(key, c);
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
			if (was.x !== spot.x || was.y !== spot.y || was.z !== spot.z || (was.yaw || 0) !== (spot.yaw || 0)) { moveTo(c, 0); } // THE SAME SPOT: A SLIDE ON ITS WAY THERE (OR ITS DEAL'S STAGGER) GOES ON
			else if (was.thick !== spot.thick) { place(c); }
		}
		laid = true;
		frameOpen();
		refreshLift();
		showPreview(); // THE LIFTED CARD LEFT THE HAND, OR THE CATALOG CAME
	}

	/* ---- The lifted card's preview: a hand card with rules text (an active, the held passive, a curse), big enough to read, beside the board while it's lifted (user ruling 2026-11-22) ---- */
	let preview = null, previewKey = null;
	function showPreview() {
		const c = lifted && current.view ? cards.get(`${current.view.you}:${lifted}`) : null, face = c && c.spot.card ? faceOf(c.spot.card, current.catalog) : null;
		const key = face && face.text ? JSON.stringify(face) : null;
		if (key === previewKey) { return; }
		previewKey = key;
		if (preview) { preview.remove(); preview = null; }
		if (!key) { return; }
		preview = document.createElement("canvas");
		preview.className = "cardPreview"; // NO POINTER EVENTS (board3D.css): THE BOARD UNDER IT STILL TAKES THE CARD'S TARGETS
		preview.width = Math.round(FACE_W * PILE_FACE);
		preview.height = Math.round(FACE_H * PILE_FACE);
		preview.setAttribute("role", "img");
		preview.setAttribute("aria-label", `${face.name}, ${face.type}: ${face.text}`);
		drawPlayFace(preview.getContext("2d"), face, c.spot.color, preview.width, preview.height, false);
		document.body.append(preview);
	}

	return {
		/**
		 * @description Lays the table out for a view (lay)
		 * @param {object} view cards.view
		 * @param {object} opts { catalog: cards.catalog, focus: the keyboard's hand card id | null, focusPile: the keyboard's pile (a key of tableLayout.js PILES) | null, dim: the hand card ids drawn dimmer }
		 */
		set(view, opts = {}) {
			current = { view, catalog: opts.catalog || {}, focus: opts.focus || null, focusPile: opts.focusPile || null, dim: opts.dim || [] };
			lay();
		},
		/**
		 * @description Lifts the picked hand card high, the others go back down
		 * @param {string|null} id the card's id, null for none
		 */
		lift(id) {
			if (id === lifted) { return; }
			lifted = id;
			refreshLift();
			showPreview();
		},
		/**
		 * @description Lifts the hand card under the pointer a little & lights it
		 * @param {string|null} id
		 */
		hover(id) {
			if (id === hovered) { return; }
			hovered = id;
			refreshLift();
		},
		/**
		 * @description What a ray hits first: one of the player's hand cards, or a card of a passive pile or an active spot (shut or opened into its column). Never a discard pile: it isn't opened
		 * @param {Raycaster} raycaster already set from the camera & pointer
		 * @returns {{ kind: "hand", id: string }|{ kind: "pile", pile: string, id: string|null }|null} pile: a key of tableLayout.js PILES, id: the card hit (null: face down)
		 */
		hit(raycaster) {
			const picks = [...cards].filter(([, c]) => c.spot.hand || c.spot.pile);
			const first = raycaster.intersectObjects(picks.map(([, c]) => c.face), false)[0];
			if (!first) { return null; }
			const [key, c] = picks.find(([, x]) => x.face === first.object);
			return c.spot.hand ? { kind: "hand", id: key.slice(2) } : { kind: "pile", pile: c.spot.pile, id: c.spot.card ? c.spot.card.id : null };
		},
		/**
		 * @description Opens a passive pile or an active spot into its column on the desk & frames it, or closes the one open (the camera goes back)
		 * @param {string|null} pile a key of tableLayout.js PILES; the one open, or null, closes it
		 */
		togglePile(pile) {
			if (!current.view) { return; }
			openPile = pile && pile !== openPile ? pile : null;
			lay();
		},
		/**
		 * @description The pile that is open
		 * @returns {string|null} a key of tableLayout.js PILES
		 */
		open() {
			return openPile;
		},
		/**
		 * @description Takes every card & the frame out of the room & frees what they own. The template's geometry is the room's to free
		 */
		dispose() {
			if (openPile) { frameBox(null); }
			reader.remove();
			lifted = null;
			showPreview();
			for (const c of [...cards.values(), ...green]) { free(c); }
			cards.clear();
			room.remove(frame);
			backMaterial.dispose();
			greenMaterial.dispose();
			frame.geometry.dispose();
			frameMaterial.dispose();
		},
	};
}
