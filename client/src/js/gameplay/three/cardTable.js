/* ---- Chess Cards table: both hands, the green deck & both Board Effects piles, every card a clone of the room's card at the promotion cards' size & look (cards.js) ---- */

import { CanvasTexture, SRGBColorSpace, MeshBasicMaterial, Mesh } from "three";
import { CARD_SIZE, DECK, CARD_Y } from "./cardLayout.js";
import { findParts, frameGeometry, lerp, CARD_LIGHT, CARD_BACK, HOVER_LIGHT, FOCUS, FRAME_GAP, FRAME_WIDTH, FRAME_DROP, LIFT, LIFT_MS, DEAL_MS, DEAL_STAGGER_MS, STACK_STEP, FACE_W, FACE_H } from "./cards.js";
import { DESK_Y } from "./constants.js";
import { faceOf, drawPlayFace } from "./cardFaces.js";
import { handCards } from "../cards/select.js";

const HAND_Z = 17.7; // THE PLAYER'S ROW ON THE NEAR GREEN (THE PROMOTION STRIP'S x, MIRRORED ONTO z), CARD GUY'S AT -HAND_Z. CLEAR OF THE BOARD'S FRAME (14.25)
const HAND_STEP = 4.6; // CENTRE TO CENTRE (TABLE UI DOC)
const HAND_FIT = 9; // THIS MANY LIE SIDE BY SIDE; MORE (UP TO 2 CURSES) OVERLAP SLIGHTLY IN THE SAME WIDTH
const LAYER = STACK_STEP + 0.001; // A CARD'S THICKNESS (cards.js STACK_STEP) & A HAIR: AN OVERLAPPING CARD LIES ON THE ONE UNDER IT
const DIM_LIGHT = 0x6E6654; // A HAND CARD WITH NO PLAY BUT A DISCARD THIS TURN (select.js dimmed): ITS FACE UNDER LESS LIGHT
const GREEN_DECK = { x: -DECK.x, z: DECK.z }; // THE MIRROR OF THE RED DECK (BAKED INTO THE ROOM)
const GREEN_DECK_CARDS = 4; // AS MANY SLABS AS THE RED DECK, SQUARED UP: ONE CARD'S FOOTPRINT
const GREEN_BACK = 0x0E3B22;
const PILE_CLEAR = 3.5; // EACH PILE THIS FAR FROM THE RED DECK'S EDGE (THE DECK SPANS z -3.36 .. 3 WITH ITS SLABS' OFFSETS)
const PEEK = 1.2; // AN OLDER BOARD EFFECTS CARD PEEKS OUT BY ITS NAME BAR
const PILE_Z = { mine: 3 + PILE_CLEAR + CARD_SIZE.h / 2, his: -3.36 - PILE_CLEAR - CARD_SIZE.h / 2 }; // THE NEWEST CARD'S CENTRE: YOURS BELOW THE DECK, CARD GUY'S ABOVE
const PICK_LIFT = 1.1; // A LIFTED (PICKED) CARD FLOATS THIS HIGH, ABOVE A HOVERED ONE
const PILE_FACE = 0.5; // THE OPENED PILE'S CARDS: THIS FRACTION OF THE FACE TEXTURE'S SIZE

/**
 * @description Where every card of the view lies: the player's hand, Card Guy's (face down, but the King card & the cards the player may see face up), both Board Effects piles
 * @param {object} view cards.view
 * @returns {Map<string, object>} key -> { card (null: face down), x, y, z, faceDown, barBottom, hand (the player's), pile ("mine" | "his" | null), color (the owner's: the glyph's colour), top (a pile's newest) }
 */
function layout(view) {
	const want = new Map(), you = view.you, opp = you === "w" ? "b" : "w";
	const row = (n, i) => (i - (n - 1) / 2) * (n > HAND_FIT ? (HAND_STEP * (HAND_FIT - 1)) / (n - 1) : HAND_STEP);
	const mine = handCards(view);
	mine.forEach((card, i) => want.set(`h:${card.id}`, { card, x: row(mine.length, i), y: CARD_Y + i * LAYER, z: HAND_Z, faceDown: false, barBottom: false, hand: true, pile: null, color: you }));
	const o = view.players[opp] || {}, hand = o.hand || { count: 0, shown: [] }, shown = hand.shown || [];
	const his = [...(o.king ? [{ id: "king", key: "king" }] : []), ...shown, ...Array.from({ length: Math.max(0, (hand.count || 0) - shown.length) }, () => null)];
	his.forEach((card, i) => want.set(card ? `o:${card.id}` : `o:#${i}`, { card, x: -row(his.length, i), y: CARD_Y + i * LAYER, z: -HAND_Z, faceDown: !card, barBottom: false, hand: false, pile: null, color: opp })); // HIS CARDS SHOW HIS PIECES
	for (const [pile, owner, dir] of [["mine", you, 1], ["his", opp, -1]]) {
		const list = (view.effects || []).filter((e) => e && e.owner === owner && e.card); // OLDEST FIRST, THE NEWEST ON TOP
		list.forEach((e, i) => want.set(`${pile}:${e.card.id}`, { card: e.card, x: DECK.x, y: DESK_Y + 0.005 + i * LAYER, z: PILE_Z[pile] + dir * (list.length - 1 - i) * PEEK, faceDown: false, barBottom: pile === "mine", hand: false, pile, color: owner, top: i === list.length - 1 }));
	}
	return want;
}

/**
 * @description The Chess Cards table in the room, made from its card template. Children of the room, so they turn with it (Flip Board)
 * @param {{ template: Object3D, room: Group, tweens: object, requestRender: () => void, still?: () => boolean }} options as createCards (cards.js)
 * @returns {{ set: Function, lift: Function, hover: Function, hit: Function, togglePile: Function, dispose: Function }|null} the table, null when the template can't be used
 */
export function createCardTable({ template, room, tweens, requestRender, still = () => false }) {
	if (!findParts(template)) { return null; }
	const backMaterial = new MeshBasicMaterial({ color: CARD_BACK });
	const greenMaterial = new MeshBasicMaterial({ color: GREEN_BACK });
	const frameMaterial = new MeshBasicMaterial({ color: FOCUS.color, opacity: FOCUS.opacity, transparent: FOCUS.opacity < 1, depthWrite: false });
	const frame = new Mesh(frameGeometry(CARD_SIZE.w + FRAME_GAP * 2, CARD_SIZE.h + FRAME_GAP * 2, FRAME_WIDTH), frameMaterial);
	frame.visible = false;
	room.add(frame);
	const cards = new Map(); // KEY -> { root, face, faceMaterial, canvas, texture, faceKey, spot, at, lift, liftTo, moveToken, liftToken, landed }
	let current = { view: null, catalog: {}, focus: null, focusPile: null, dim: [] };
	let lifted = null, hovered = null, openPile = null, overlay = null, pileKey = null, pileBack = null; // pileKey: WHAT THE OPENED PILE SHOWS, pileBack: WHAT HAD THE FOCUS BEFORE IT OPENED

	// A CLONE OF THE TEMPLATE: FACE UP WITH ITS OWN CANVAS, OR FACE DOWN IN back'S COLOUR (ITS FACE UNDERNEATH, NEVER SEEN)
	function make(faceDown, back = backMaterial) {
		const root = template.clone(true), parts = findParts(root);
		root.visible = true; // THE TEMPLATE IS HIDDEN (room.js), ITS CLONE WITH IT
		parts.back.material = back;
		const c = { root, face: parts.face, faceMaterial: null, canvas: null, texture: null, faceKey: null, spot: null, at: null, lift: 0, liftTo: 0, moveToken: 0, liftToken: 0, landed: false };
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

	// PUTS A CARD WHERE ITS PLACE ON THE WAY (at) & ITS LIFT SAY. FACE DOWN IT'S TURNED OVER, SO IT SITS A CARD'S THICKNESS HIGHER
	function place(c) {
		c.root.position.set(c.at.x, c.at.y + c.lift + (c.spot.faceDown ? STACK_STEP : 0), c.at.z);
		if (frame.visible && c === focusedCard()) { frame.position.set(c.at.x, frameY(c), c.at.z); }
	}

	// THE FRAME'S HEIGHT: A HAND CARD'S JUST UNDER IT, A PILE CARD'S AT ITS OWN HEIGHT (UNDER IT IS THE DESK TOP, WHICH HIDES IT)
	const frameY = (c) => c.spot.y - (c.spot.pile ? 0 : FRAME_DROP);

	// SLIDES A CARD TO ITS SPOT (FROM THE DECK WHEN IT'S NEW), AS THE PROMOTION CARDS ARE DEALT
	function moveTo(c, delay) {
		const token = ++c.moveToken, from = { ...c.at }, to = { x: c.spot.x, y: c.spot.y, z: c.spot.z };
		if (still() || (from.x === to.x && from.y === to.y && from.z === to.z)) { c.at = to; c.landed = true; place(c); return; }
		c.landed = false;
		tweens.add({
			duration: DEAL_MS, delay,
			update(k) { if (token !== c.moveToken) { return; } c.at = { x: lerp(from.x, to.x, k), y: lerp(from.y, to.y, k), z: lerp(from.z, to.z, k) }; place(c); },
			onEnd() { if (token === c.moveToken) { c.landed = true; placeFrame(); requestRender(); } },
		});
	}

	// THE KEYBOARD'S CARD: A HAND CARD, OR A PILE'S NEWEST
	const focusedCard = () => (current.focus ? cards.get(`h:${current.focus}`) || null : current.focusPile ? [...cards.values()].find((c) => c.spot.pile === current.focusPile && c.spot.top) || null : null);

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

	/* ---- The opened pile: every card of it, big enough to read, in a layer over the board ---- */
	function closePile() {
		openPile = null;
		pileKey = null;
		if (overlay) { overlay.remove(); overlay = null; }
		window.removeEventListener("keydown", onPileKey, true);
		if (pileBack && pileBack.isConnected && pileBack.focus) { pileBack.focus(); } // THE FOCUS GOES BACK WHERE IT WAS
		pileBack = null;
	}
	// THE OPENED PILE HAS THE KEYS (THE HAND'S STAND DOWN, gameplay/input handleHandKey): ESCAPE OR ENTER CLOSES IT, THE ARROWS SCROLL ITS ROW
	function onPileKey(e) {
		const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
		if (e.key !== "Escape" && e.key !== "Enter" && !step) { return; }
		e.preventDefault();
		e.stopPropagation();
		if (step) { overlay.querySelector(".cardPileRow").scrollBy({ left: step * FACE_W * PILE_FACE }); }
		else { closePile(); }
	}
	const pileOf = (view, pile) => (view.effects || []).filter((e) => e && e.owner === (pile === "mine" ? view.you : view.you === "w" ? "b" : "w") && e.card);
	function showPile(pile) {
		const view = current.view, owner = pile === "mine" ? view.you : view.you === "w" ? "b" : "w";
		const list = pileOf(view, pile), scroll = overlay ? overlay.querySelector(".cardPileRow").scrollLeft : 0;
		if (overlay) { overlay.remove(); }
		else { pileBack = document.activeElement; }
		openPile = pile;
		pileKey = JSON.stringify([pile, list, current.catalog]);
		overlay = document.createElement("div");
		overlay.className = "cardPile";
		overlay.tabIndex = -1; // IT TAKES THE FOCUS (A SCREEN READER IS IN THE DIALOG)
		overlay.setAttribute("role", "dialog");
		overlay.setAttribute("aria-label", pile === "mine" ? "Your Board Effects" : "Card Guy's Board Effects");
		const title = document.createElement("p");
		title.textContent = `${pile === "mine" ? "Your" : "Card Guy's"} Board Effects: oldest on the left, newest on the right. Click to close.`;
		const row = document.createElement("div");
		row.className = "cardPileRow";
		for (const e of list) {
			const face = faceOf(e.card, current.catalog), canvas = document.createElement("canvas");
			canvas.width = Math.round(FACE_W * PILE_FACE);
			canvas.height = Math.round(FACE_H * PILE_FACE);
			canvas.setAttribute("role", "img");
			canvas.setAttribute("aria-label", `${face.name}, ${face.type}${face.text ? `: ${face.text}` : ""}`);
			drawPlayFace(canvas.getContext("2d"), face, owner, canvas.width, canvas.height, false);
			row.append(canvas);
		}
		overlay.append(title, row);
		overlay.addEventListener("click", closePile);
		document.body.append(overlay);
		row.scrollLeft = scroll; // A REFRESH WHILE IT'S OPEN KEEPS ITS PLACE
		overlay.focus();
		window.addEventListener("keydown", onPileKey, true);
	}

	return {
		/**
		 * @description Lays the table out for a view: new cards slide in from the red deck, moved ones slide to their new spot (one there or on its way already is left alone), gone ones are taken away
		 * @param {object} view cards.view
		 * @param {object} opts { catalog: cards.catalog, focus: the keyboard's hand card id | null, focusPile: the keyboard's pile ("mine" | "his") | null, dim: the hand card ids drawn dimmer }
		 */
		set(view, opts = {}) {
			current = { view, catalog: opts.catalog || {}, focus: opts.focus || null, focusPile: opts.focusPile || null, dim: opts.dim || [] };
			const want = layout(view);
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
					c.at = { x: DECK.x, y: DECK.y, z: DECK.z };
					cards.set(key, c);
					c.spot = spot;
					if (!spot.faceDown) { paint(c); }
					moveTo(c, (dealt++) * DEAL_STAGGER_MS);
					continue;
				}
				const was = c.spot;
				c.spot = spot;
				if (!spot.faceDown) { paint(c); }
				if (was.x !== spot.x || was.y !== spot.y || was.z !== spot.z) { moveTo(c, 0); } // THE SAME SPOT: A SLIDE ON ITS WAY THERE (OR ITS DEAL'S STAGGER) GOES ON
			}
			if (openPile && JSON.stringify([openPile, pileOf(view, openPile), current.catalog]) !== pileKey) { showPile(openPile); } // A PASSIVE FIRED OR WAS PLACED WHILE IT WAS OPEN
			refreshLift();
		},
		/**
		 * @description Lifts the picked hand card high, the others go back down
		 * @param {string|null} id the card's id, null for none
		 */
		lift(id) {
			if (id === lifted) { return; }
			lifted = id;
			refreshLift();
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
		 * @description What a ray hits first: one of the player's hand cards or a Board Effects pile
		 * @param {Raycaster} raycaster already set from the camera & pointer
		 * @returns {{ kind: "hand", id: string }|{ kind: "pile", pile: "mine" | "his" }|null}
		 */
		hit(raycaster) {
			const picks = [...cards].filter(([, c]) => c.spot.hand || c.spot.pile);
			const first = raycaster.intersectObjects(picks.map(([, c]) => c.face), false)[0];
			if (!first) { return null; }
			const [key, c] = picks.find(([, x]) => x.face === first.object);
			return c.spot.hand ? { kind: "hand", id: key.slice(2) } : { kind: "pile", pile: c.spot.pile };
		},
		/**
		 * @description Opens a Board Effects pile so every card can be read, or closes it when it's the one open
		 * @param {string} pile "mine" or "his"
		 */
		togglePile(pile) {
			if (openPile === pile) { closePile(); }
			else { showPile(pile); }
		},
		/**
		 * @description Takes every card & the frame out of the room & frees what they own. The template's geometry is the room's to free
		 */
		dispose() {
			closePile();
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
