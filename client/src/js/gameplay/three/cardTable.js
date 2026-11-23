/* ---- Chess Cards table: both hands, the green deck & each player's three places (the active spot, the passive pile, the discard pile: tableLayout.js), every card a clone of the room's card at the promotion cards' size & look (cards.js) ---- */

import { CanvasTexture, SRGBColorSpace, MeshBasicMaterial, Mesh, Plane, Vector3, Box3, Ray, Matrix4 } from "three";
import { CARD_SIZE, DECK, CARD_Y } from "./cardLayout.js";
import { findParts, frameGeometry, lerp, CARD_LIGHT, CARD_BACK, HOVER_LIGHT, FOCUS, FRAME_GAP, FRAME_WIDTH, FRAME_DROP, LIFT, LIFT_MS, DEAL_MS, DEAL_STAGGER_MS, STACK_STEP, FACE_W, FACE_H } from "./cards.js";
import { DESK_Y } from "./constants.js";
import { faceOf, drawPlayFace, drawDuelFace, drawBackFace } from "./cardFaces.js";
import { tableSpots, pileCards, columnBox, placeAt, deskPoint, duelLayout, spotHit, PILES, DISCARD, HAND_Z } from "./tableLayout.js";

const LAYER = STACK_STEP + 0.001; // A CARD'S THICKNESS (cards.js STACK_STEP) & A HAIR: AN OVERLAPPING CARD LIES ON THE ONE UNDER IT
const DIM_LIGHT = 0x6E6654; // A HAND CARD WITH NO PLAY BUT A DISCARD THIS TURN (select.js dimmed): ITS FACE UNDER LESS LIGHT
const GREEN_DECK = { x: -DECK.x, z: DECK.z }; // THE MIRROR OF THE RED DECK (BAKED INTO THE ROOM)
const GREEN_DECK_CARDS = 4; // AS MANY SLABS AS THE RED DECK, SQUARED UP: ONE CARD'S FOOTPRINT
const GREEN_BACK = 0x0E3B22;
const GREEN_TOP = DESK_Y + GREEN_DECK_CARDS * STACK_STEP; // A DUEL CARD DEALT FROM (& GOING BACK TO) THE GREEN DECK LIES ON ITS TOP SLAB
const RED_DECK = new Box3(new Vector3(DECK.x - CARD_SIZE.w / 2, DESK_Y, DECK.z - CARD_SIZE.h / 2), new Vector3(DECK.x + CARD_SIZE.w / 2, DECK.y, DECK.z + CARD_SIZE.h / 2)); // THE BAKED RED DECK, IN THE ROOM'S SPACE: A CARD'S FOOTPRINT FROM THE DESK UP TO WHERE THE PROMOTION CARDS LIE ON IT (cards.js)
const FLIP_LIFT = CARD_SIZE.w / 2 + 0.2; // A FLIPPING DUEL CARD TURNS ON ITS LONG AXIS: HALF ITS WIDTH UP, SO ITS EDGE CLEARS THE BAIZE
const PICK_LIFT = 1.1; // A LIFTED (PICKED) CARD FLOATS THIS HIGH, ABOVE A HOVERED ONE. AN ABILITY CARD A CLICK OR TAP PICKED ISN'T LIFTED: flow.js NEVER SAYS IT (select.js liftedCard, TASK 21a)
const PILE_FACE = 0.5; // THE LIFTED CARD'S PREVIEW: THIS FRACTION OF THE FACE TEXTURE'S SIZE
const DRAG_Y = CARD_Y + PICK_LIFT; // A DRAGGED CARD FLOATS AT A LIFTED HAND CARD'S HEIGHT, UNDER THE POINTER
const LANDINGS = { spot: PILES.mineSpot, passive: PILES.mine, discard: DISCARD.mine }; // THE PLAYER'S PLACES A DRAGGED CARD CAN BE LET GO ON
const PILE_NAMES = { mine: "Your passives", his: "Card Guy's passives", mineSpot: "Your actives in effect", hisSpot: "Card Guy's actives in effect", discard: "The last cards on the discard piles" }; // WHAT A SCREEN READER HEARS OF AN OPENED PILE

/**
 * @description The Chess Cards table in the room, made from its card template. Children of the room, so they turn with it (Flip Board)
 * @param {{ template: Object3D, room: Group, tweens: object, requestRender: () => void, still?: () => boolean, frame?: (box: object|null, zoom?: string|null) => void }} options as createCards (cards.js), & frame: the camera frames this much of the desk
 * (an opened pile's column, tableLayout.js columnBox, or the zoomed hand card's footprint), null: it goes back (camera.js framePile); zoom: the hand card zoomed in on, null (or none) for none
 * @returns {{ set: Function, lift: Function, hover: Function, hit: Function, covers: Function, togglePile: Function, open: Function, zoom: Function, zoomed: Function, grab: Function, follow: Function, release: Function, settle: Function, dealDuel: Function, flipDuel: Function, endDuel: Function, dispose: Function }|null} the table, null when the template can't be used
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
	let current = { view: null, catalog: {}, focus: null, focusPile: null, focusDuel: null, dim: [] };
	const duelCards = new Map(), leaving = new Set(); // duelCards: tableLayout.js duelLayout's KEY -> A CARD AS cards' WITH duel (ITS duelLayout ENTRY, card SET AS IT FLIPS) & outline (THE WON CARD'S GOLD FRAME); leaving: GOING BACK TO THE GREEN DECK
	let duelDeal = null; // THE DUEL LAID: { round, player, piece, spades, flips: the set flipDuel turns }; WHILE SET THE HANDS LIE STACKED
	const lands = Object.entries(LANDINGS).map(function ([place, p]) { // A GOLD FRAME ROUND EACH PLACE THE DRAGGED CARD CAN BE LET GO ON (AN EMPTY PLACE DRAWS NOTHING ELSE)
		const m = new Mesh(frame.geometry, frameMaterial);
		m.position.set(p.x, DESK_Y + 0.02, p.z);
		m.visible = false;
		m.userData.place = place;
		room.add(m);
		return m;
	});
	const dragPlane = new Plane(new Vector3(0, 1, 0), -DRAG_Y), dragPoint = new Vector3(), deskAt = new Vector3(), roomRay = new Ray(), roomInverse = new Matrix4(); // roomRay: covers' RAY IN THE ROOM'S SPACE, WHERE RED_DECK IS
	let drag = null, stage = null; // drag: THE CARD THE MOUSE HOLDS { c, id, from: "hand" | "pile", places, moved, desk: THE DESK UNDER THE POINTER { x, z } | null }, stage: THE CARD LET GO ON A PLACE, LYING THERE WHILE IT IS THE LIFTED ONE (tableLayout.js tableSpots)
	let lifted = null, hovered = null, openPile = null, zoomId = null, boxKey = "null", laid = false; // openPile: THE PILE OPENED INTO A COLUMN, zoomId: THE HAND CARD THE CAMERA FRAMES (zoom), boxKey: WHAT THE CAMERA WAS LAST TOLD TO FRAME, laid: THE FIRST LAYOUT IS DONE

	// A CLONE OF THE TEMPLATE: FACE UP WITH ITS OWN CANVAS, OR FACE DOWN IN back'S COLOUR (ITS FACE UNDERNEATH, NEVER SEEN)
	function make(faceDown, back = backMaterial) {
		const root = template.clone(true), parts = findParts(root);
		root.visible = true; // THE TEMPLATE IS HIDDEN (room.js), ITS CLONE WITH IT
		parts.back.material = back;
		const c = { root, face: parts.face, back: parts.back, faceMaterial: null, canvas: null, texture: null, faceKey: null, scaleY: root.scale.y, spot: null, at: null, lift: 0, liftTo: 0, moveToken: 0, liftToken: 0, landed: false };
		if (faceDown) { parts.face.material = back; root.rotation.z = Math.PI; } // TURNED OVER: THE BACK ON TOP
		else { giveFace(c); }
		room.add(root);
		return c;
	}

	// A CARD'S OWN FACE: ITS CANVAS, TEXTURE & MATERIAL. A FACE-DOWN DUEL CARD GETS IT ONLY WHEN IT FLIPS (paintDuel), NOT 12 BLANK ONES PER DEAL
	function giveFace(c) {
		c.canvas = document.createElement("canvas");
		c.canvas.width = FACE_W;
		c.canvas.height = FACE_H;
		c.texture = new CanvasTexture(c.canvas);
		c.texture.colorSpace = SRGBColorSpace;
		c.texture.flipY = false; // AS cards.js: THE FACE QUAD'S UVs RUN FROM THE CARD'S TOP EDGE AT v = 0
		c.faceMaterial = new MeshBasicMaterial({ map: c.texture, color: CARD_LIGHT });
		c.face.material = c.faceMaterial;
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
	const frameY = (c) => c.spot.y - (c.spot.pile || c.spot.discard ? 0 : FRAME_DROP);

	// SLIDES A CARD TO ITS SPOT (FROM THE DECK WHEN IT'S NEW), AS THE PROMOTION CARDS ARE DEALT. done: RUNS ONCE IT LANDS, UNLESS ANOTHER SLIDE OR free() CAME FIRST
	function moveTo(c, delay, done = () => {}) {
		const token = ++c.moveToken, from = { ...c.at }, to = { x: c.spot.x, y: c.spot.y, z: c.spot.z, yaw: c.spot.yaw || 0 };
		if (still() || (from.x === to.x && from.y === to.y && from.z === to.z && from.yaw === to.yaw)) { c.at = to; c.landed = true; place(c); done(); return; }
		c.landed = false;
		tweens.add({
			duration: DEAL_MS, delay,
			update(k) { if (token !== c.moveToken) { return; } c.at = { x: lerp(from.x, to.x, k), y: lerp(from.y, to.y, k), z: lerp(from.z, to.z, k), yaw: lerp(from.yaw, to.yaw, k) }; place(c); },
			onEnd() { if (token === c.moveToken) { c.landed = true; placeFrame(); requestRender(); done(); } },
		});
	}

	// THE KEYBOARD'S CARD: A HAND CARD, A PILE'S NEWEST (THE DISCARD LIST'S STOP: YOUR DISCARD PILE'S TOP CARD WHILE IT HAS ONE, ELSE CARD GUY'S: FIX ROUND 1, M3), OR ONE OF THE PLAYER'S DUEL CARDS OF THE CURRENT SET
	const pileTop = (pile) => { const tops = [...cards.values()].filter((c) => (c.spot.discard ? "discard" : c.spot.pile) === pile && c.spot.top); return tops.find((c) => c.spot.discard === "mine") || tops[0] || null; };
	const focusedCard = () => (current.focus ? cards.get(`${current.view.you}:${current.focus}`) || null : current.focusPile ? pileTop(current.focusPile)
		: current.focusDuel !== null && duelDeal ? duelCards.get(`mine:${duelDeal.spades ? "spades" : "round"}:${current.focusDuel}`) || null : null);

	// THE GOLD FRAME GOES ROUND THE KEYBOARD'S CARD ONCE IT HAS LANDED, AS ON THE PROMOTION CARDS
	function placeFrame() {
		const c = focusedCard(), on = Boolean(c && c.landed);
		frame.visible = on;
		if (on) { frame.position.set(c.at.x, frameY(c), c.at.z); }
	}

	// EACH HAND CARD'S LIFT & LIGHT: LIFTED (PICKED) HIGHEST, HOVERED OR FOCUSED A LITTLE
	function refreshLift() {
		for (const [key, c] of cards) {
			if (!c.spot.hand || (drag && drag.c === c && drag.moved)) { continue; }
			const id = key.slice(2), up = c.spot.staged ? 0 : id === lifted ? PICK_LIFT : id === hovered || id === current.focus ? LIFT : 0;
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

	// DRAWS A FACE-UP CARD'S FACE WHEN WHAT IT SHOWS CHANGED. A HIDDEN CARD OF THE DISCARD LIST (card null): ITS BACK WITH ITS OWNER'S NAME BAR, UNTINTED AS backMaterial
	function paint(c) {
		const face = c.spot.card ? faceOf(c.spot.card, current.catalog) : null, key = JSON.stringify([face, c.spot.color, c.spot.barBottom]);
		if (key === c.faceKey) { return; }
		c.faceKey = key;
		const ctx = c.canvas.getContext("2d");
		ctx.clearRect(0, 0, FACE_W, FACE_H);
		if (face) { drawPlayFace(ctx, face, c.spot.color, FACE_W, FACE_H, c.spot.barBottom); }
		else { drawBackFace(ctx, `#${CARD_BACK.toString(16).padStart(6, "0")}`, FACE_W, FACE_H, c.spot.barBottom); }
		if (c.spot.log) { c.faceMaterial.color.setHex(face ? CARD_LIGHT : 0xFFFFFF); } // A LIST CARD IS NEVER A HAND CARD, WHOSE LIGHT refreshLift SETS
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
	// THE CAMERA FRAMES THE OPENED PILE'S COLUMN, AGAIN WHEN IT GROWS OR SHRINKS, OR THE ZOOMED HAND CARD, & GOES BACK WHEN NEITHER IS. A REFRESH THAT CHANGES NOTHING LEAVES THE CAMERA ALONE
	function frameOpen() {
		const z = zoomId && cards.get(`${current.view.you}:${zoomId}`), list = openPile ? pileCards(current.view, openPile) : [];
		const box = openPile ? columnBox(openPile, list.length) : z ? { x0: z.spot.x - CARD_SIZE.w / 2, x1: z.spot.x + CARD_SIZE.w / 2, z0: z.spot.z - CARD_SIZE.h / 2, z1: z.spot.z + CARD_SIZE.h / 2 } : null, key = JSON.stringify(box);
		const said = openPile === "discard" ? list.map((card, i) => `${current.view.piled[i].player === current.view.you ? "yours" : "Card Guy's"}, ${say(card)}`) : list.slice().reverse().map(say); // THE DISCARD LIST: NEWEST FIRST ALREADY, & WHOSE EACH WAS
		const text = openPile ? `${PILE_NAMES[openPile]}, newest first: ${said.join("; ")}` : "";
		if (reader.textContent !== text) { reader.textContent = text; }
		if (key === boxKey || (drag && drag.moved && drag.from === "pile")) { return; } // A PLACED CARD DRAGGED: THE CAMERA SHOWS THE WAY TO THE DISCARD PILE (follow)
		boxKey = key;
		frameBox(box, zoomId); // zoomId: WHAT IS ZOOMED IN ON GOES TO flow.js TOO (three/index.js), WHERE ESCAPE & A PLAY END IT
	}

	// LAYS THE TABLE OUT FOR current: NEW CARDS SLIDE IN (FROM THE RED DECK, OR FROM CARD GUY'S HAND TO HIS PLACES), MOVED ONES SLIDE TO THEIR NEW SPOT (ONE THERE OR ON ITS WAY ALREADY IS LEFT ALONE), GONE ONES ARE TAKEN AWAY
	function lay() {
		if (openPile && !pileCards(current.view, openPile).length) { openPile = null; } // ITS LAST CARD LEFT
		const want = tableSpots(current.view, { open: openPile, base: DESK_Y + 0.005, layer: LAYER, stage, stacked: Boolean(duelDeal) });
		if (zoomId && (duelDeal || !(want.get(`${current.view.you}:${zoomId}`) || {}).hand)) { zoomId = null; } // ITS CARD LEFT THE HAND (OR WAS NEVER IN IT), OR THE HANDS LIE STACKED FOR A DUEL
		for (const [key, c] of [...cards]) {
			const w = want.get(key);
			if (w && w.faceDown === c.spot.faceDown) { continue; }
			if (drag && drag.c === c) { drag = null; showLands([]); } // THE DRAGGED CARD LEFT THE TABLE
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
			if (drag && drag.c === c && drag.moved) { continue; } // UNDER THE POINTER
			if (c.adrift) { c.adrift = false; moveTo(c, 0); } // LET GO: IT SLIDES FROM THERE TO WHERE IT LIES NOW
			else if (was.x !== spot.x || was.y !== spot.y || was.z !== spot.z || (was.yaw || 0) !== (spot.yaw || 0)) { moveTo(c, 0); } // THE SAME SPOT: A SLIDE ON ITS WAY THERE (OR ITS DEAL'S STAGGER) GOES ON
			else if (was.thick !== spot.thick) { place(c); }
		}
		laid = true;
		frameOpen();
		refreshLift();
		showPreview(); // THE LIFTED CARD LEFT THE HAND, OR THE CATALOG CAME
	}

	function showLands(places) {
		for (const m of lands) { m.visible = places.includes(m.userData.place); }
		requestRender();
	}

	/* ---- The card duel: its cards dealt from the green deck into the rows (tableLayout.js duelLayout), each face up once flipped, the won one framed in gold ---- */
	function paintDuel(c) {
		if (!c.canvas) { giveFace(c); } // DEALT FACE DOWN: ITS FACE IS MADE NOW
		const ctx = c.canvas.getContext("2d");
		ctx.clearRect(0, 0, FACE_W, FACE_H);
		drawDuelFace(ctx, c.duel.card, FACE_W, FACE_H);
		c.texture.needsUpdate = true;
	}

	function outline(c) {
		if (c.outline) { return; }
		c.outline = new Mesh(frame.geometry, frameMaterial);
		c.outline.position.set(c.spot.x, c.spot.y - FRAME_DROP, c.spot.z);
		c.outline.visible = c.landed; // ITS CARD STILL ON ITS WAY: IT SHOWS WHEN THE CARD LANDS (dealDuel)
		room.add(c.outline);
	}

	function unoutline(c) {
		if (c.outline) { room.remove(c.outline); c.outline = null; }
	}

	// TURNS A DUEL CARD OVER WHERE IT LIES, ON ITS LONG AXIS, RISING SO ITS EDGE CLEARS THE BAIZE: FACE UP, OR FACE DOWN AGAIN (A TAKE-BACK)
	function turn(c, up) {
		c.spot.faceDown = !up;
		const token = ++c.liftToken, sink = up ? STACK_STEP : -STACK_STEP; // place() LIFTS A FACE-DOWN CARD STACK_STEP: THE TURN STARTS AT THE HEIGHT IT LIES AT
		if (still()) { c.root.rotation.z = up ? 0 : Math.PI; c.lift = 0; place(c); return; }
		tweens.add({
			duration: DEAL_MS,
			update(k) { if (token !== c.liftToken) { return; } c.root.rotation.z = up ? lerp(Math.PI, 0, k) : lerp(0, Math.PI, k); c.lift = sink * (1 - k) + FLIP_LIFT * Math.sin(Math.PI * k); place(c); },
			onEnd() { requestRender(); },
		});
	}

	// A DUEL CARD SLIDES BACK TO THE GREEN DECK & IS TAKEN AWAY THERE
	function sendBack(c) {
		unoutline(c);
		leaving.add(c);
		c.spot = { ...c.spot, x: GREEN_DECK.x, y: GREEN_TOP, z: GREEN_DECK.z };
		moveTo(c, 0, () => { leaving.delete(c); free(c); requestRender(); });
	}

	/* ---- The lifted card's preview: a hand card with rules text (an active, the held passive, a curse), big enough to read, beside the board while it's lifted (user ruling 2026-11-22): the keys' pick & the drop's target pick (user ruling R1, Task 21a) ---- */
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
		 * @param {object} opts { catalog: cards.catalog, focus: the keyboard's hand card id | null, focusPile: the keyboard's pile (a key of tableLayout.js PILES) | null,
		 * focusDuel: the keyboard's duel card, an index 0..2 of the player's current set | null, dim: the hand card ids drawn dimmer }
		 */
		set(view, opts = {}) {
			current = { view, catalog: opts.catalog || {}, focus: opts.focus || null, focusPile: opts.focusPile || null, focusDuel: Number.isInteger(opts.focusDuel) ? opts.focusDuel : null, dim: opts.dim || [] };
			lay();
		},
		/**
		 * @description Lifts the picked hand card high & shows a readable copy of one with rules text beside the board (showPreview), the others go back down
		 * @param {string|null} id the card's id, null for none
		 */
		lift(id) {
			if (id === lifted) { return; }
			lifted = id;
			if (stage && stage.id !== id) { stage = null; if (current.view) { lay(); } } // THE CARD LET GO ON A PLACE IS NO LONGER THE ONE PLAYED: IT GOES WHERE THE VIEW HAS IT
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
		 * @description What a ray hits first: one of the player's hand cards (none while a duel is laid: the hands are stacked), a card of a passive pile or an active spot (shut or opened into its column),
		 * a card of either discard pile or of the opened discard list (its pile: "discard", face down too), or a duel card the player may pick now (tableLayout.js duelLayout's pickable, as of the last dealDuel)
		 * @param {Raycaster} raycaster already set from the camera & pointer
		 * @returns {{ kind: "hand", id: string }|{ kind: "pile", pile: string, id: string|null }|{ kind: "duel", index: number }|null} as tableLayout.js spotHit, or index: 0..2 in the view's duel hands
		 */
		hit(raycaster) {
			const picks = [...cards].filter(([key, c]) => spotHit(key, c.spot) && !(c.spot.hand && duelDeal));
			const duels = [...duelCards.values()].filter((c) => c.duel.pickable);
			const meshes = ([, c]) => (c.spot.hand || c.spot.pile ? [c.face] : [c.face, c.back]); // A DISCARD PILE'S CARDS & THE LIST'S: A FACE-DOWN ONE TOO
			const first = raycaster.intersectObjects([...picks.flatMap(meshes), ...duels.flatMap((c) => [c.face, c.back])], false)[0]; // A TURNED CARD'S FACE LOOKS DOWN: A RAY FROM ABOVE MEETS ONLY ITS BACK (FRONT FACES ONLY)
			if (!first) { return null; }
			const duel = duels.find((x) => x.face === first.object || x.back === first.object);
			if (duel) { return { kind: "duel", index: duel.duel.index }; }
			const [key, c] = picks.find(([, x]) => x.face === first.object || x.back === first.object);
			return spotHit(key, c.spot);
		},
		/**
		 * @description Whether a ray meets any card on the table, also the ones hit() leaves out: Card Guy's hand, the hands stacked for a duel, every pile & place during a duel, a duel card the player can't pick
		 * (pointer.js: a left mouse press there never moves the camera), & both decks, the green one & the red one baked into the room (user ruling R5, Task 21a)
		 * @param {Raycaster} raycaster already set from the camera & pointer
		 * @returns {boolean}
		 */
		covers(raycaster) {
			return raycaster.intersectObjects([...cards.values(), ...duelCards.values(), ...leaving, ...green].flatMap((c) => [c.face, c.back]), false).length > 0
				|| roomRay.copy(raycaster.ray).applyMatrix4(roomInverse.copy(room.matrixWorld).invert()).intersectsBox(RED_DECK); // FLIP BOARD TURNS THE ROOM
		},
		/**
		 * @description Opens a passive pile or an active spot into its column on the desk, or the discard list ("discard") beside the discard piles, & frames it, or closes the one open (the camera goes back). Either ends a zoom
		 * @param {string|null} pile a key of tableLayout.js PILES or "discard"; the one open, or null, closes it
		 */
		togglePile(pile) {
			if (!current.view) { return; }
			openPile = pile && pile !== openPile ? pile : null;
			zoomId = null;
			lay();
		},
		/**
		 * @description The camera glides in to frame one of the player's hand cards as it frames an opened pile (camera.js framePile), or back exactly where it was. It ends by itself when the card
		 * leaves the hand, a pile opens or closes, a duel is dealt or the card is dragged
		 * @param {string|null} id the hand card's id, null: the zoom ends
		 */
		zoom(id) {
			if (!current.view || openPile) { return; }
			zoomId = id;
			lay(); // NOT ONE OF THE PLAYER'S HAND CARDS (OR A DUEL IS LAID): lay ENDS IT AT ONCE
		},
		/**
		 * @description The hand card zoomed in on
		 * @returns {string|null}
		 */
		zoomed() {
			return zoomId;
		},
		/**
		 * @description The pile that is open
		 * @returns {string|null} a key of tableLayout.js PILES, or "discard"
		 */
		open() {
			return openPile;
		},
		/**
		 * @description The mouse went down on a card: one of the player's hand cards, or a face-up card of their own opened pile, is held. It moves once the pointer does (follow)
		 * @param {{ id: string|null }} hit what hit() gave
		 * @param {string[]|null} places the player's places it can be let go on ("spot", "passive", "discard": framed while it's dragged), null: it isn't held
		 * @returns {boolean} held
		 */
		grab(hit, places) {
			const c = current.view && hit.id && places ? cards.get(`${current.view.you}:${hit.id}`) : null;
			if (!c || !(c.spot.hand || (c.spot.pile && c.spot.pile === openPile && PILES[openPile].side === "mine"))) { return false; }
			drag = { c, id: hit.id, from: c.spot.hand ? "hand" : "pile", places, moved: false, desk: null };
			return true;
		},
		/**
		 * @description The held card goes under the pointer, floating. The first time: its landing places are framed, & for a placed card the camera shows its column & the discard pile
		 * @param {Raycaster} raycaster already set from the camera & pointer
		 */
		follow(raycaster) {
			if (!drag || !raycaster.ray.intersectPlane(dragPlane, dragPoint)) { return; }
			room.worldToLocal(dragPoint); // FLIP BOARD TURNS THE ROOM
			const c = drag.c;
			if (!drag.moved) {
				drag.moved = true;
				c.moveToken++;
				c.liftToken++;
				c.lift = c.liftTo = 0;
				c.landed = false;
				showLands(drag.places);
				if (zoomId) { zoomId = null; frameOpen(); } // THE CAMERA GOES BACK, SO THE PLACES ARE IN VIEW
				if (drag.from === "pile") {
					const b = columnBox(c.spot.pile, pileCards(current.view, c.spot.pile).length), d = DISCARD.mine;
					boxKey = "drag";
					frameBox({ x0: Math.min(b.x0, d.x - CARD_SIZE.w / 2), x1: Math.max(b.x1, d.x + CARD_SIZE.w / 2), z0: Math.min(b.z0, d.z - CARD_SIZE.h / 2), z1: Math.max(b.z1, d.z + CARD_SIZE.h / 2) });
				}
			}
			c.at = { x: dragPoint.x, y: DRAG_Y, z: dragPoint.z, yaw: 0 };
			const desk = deskPoint(raycaster.ray.origin, raycaster.ray.direction, DESK_Y); // THE PLACE IT'S DROPPED ON IS THE DESK UNDER THE POINTER, NOT UNDER THE CARD FLOATING NEARER THE CAMERA (REVIEW I2)
			if (desk) { room.worldToLocal(deskAt.set(desk.x, DESK_Y, desk.z)); }
			drag.desk = desk ? { x: deskAt.x, z: deskAt.z } : null;
			place(c);
			requestRender();
		},
		/**
		 * @description The mouse let go of the held card. It stays where it is until settle()
		 * @returns {{ kind: "drop", from: "hand"|"pile", id: string, place: object|null }|null} what was dragged & the place under it (tableLayout.js placeAt), null when no card was dragged (a press that never moved: its click follows)
		 */
		release() {
			const d = drag;
			drag = null;
			if (!d || !d.moved) { return null; }
			showLands([]);
			const at = d.desk ? placeAt(d.desk.x, d.desk.z) : null;
			d.c.adrift = true;
			stage = at && at.side === "mine" ? { id: d.id, from: d.from, place: at.place } : null;
			return { kind: "drop", from: d.from, id: d.id, place: at };
		},
		/**
		 * @description After release(): the card lies on the place it was let go on while it's the lifted card (its play is on its way, or its targets are picked), or slides back to where it was. The camera goes back to the opened pile
		 * @param {boolean} held the drop was taken
		 */
		settle(held) {
			if (!held) { stage = null; }
			if (current.view) { lay(); }
		},
		/**
		 * @description Lays a card duel out as the view shows it (after set(); call it on every answer with a view.duel, before or after that answer's flipDuel calls: the table ends the same). The first time both hands
		 * slide into stacks at their rows' left end & every duel card of the view is dealt from the green deck, face up if already flipped. A new round, or another duel (another player or piece), sends the old duel
		 * cards back & deals 3 new ones each; a spades deal adds its set beside the round's, which stay. Every card already laid is brought to the view: turned up & painted when it shows, turned back down when it no
		 * longer does (a take-back), the gold outline on exactly the view's won cards, pickable as the view allows; one the view no longer has (a taken-back spades deal) goes back to the green deck
		 * @param {object} duel view.duel (not null)
		 */
		dealDuel(duel) {
			if (!current.view || !duel) { return; }
			const spades = Boolean(duel.spades), redeal = Boolean(duelDeal && (duelDeal.round !== duel.round || duelDeal.player !== duel.player || duelDeal.piece !== duel.piece));
			if (redeal) { for (const c of duelCards.values()) { sendBack(c); } duelCards.clear(); }
			const first = !duelDeal, want = duelLayout(duel, current.view.you, current.view), keys = new Set(want.map((d) => d.key));
			// flips: THE SET A flipDuel TURNS. A SPADES DEAL WITH NO PICK YET CAME IN THE SAME ANSWER AS THE ROUND'S LAST FLIPS, SO THOSE STILL GO TO THE ROUND (ONE PICK PER ANSWER: A SPADES FLIP COMES AFTER A VIEW WITH A SPADES PICK)
			duelDeal = { round: duel.round, player: duel.player, piece: duel.piece, spades, flips: spades && duel.spades.picked.w.length + duel.spades.picked.b.length ? "spades" : "round" };
			if (first) { lay(); } // THE HANDS SLIDE INTO THEIR STACKS
			for (const [key, c] of duelCards) { if (!keys.has(key)) { sendBack(c); duelCards.delete(key); } }
			let dealt = 0;
			for (const d of want) {
				let c = duelCards.get(d.key);
				if (c) { // LAID ALREADY: BROUGHT TO WHAT THE VIEW SHOWS
					const was = c.duel.card;
					c.duel = d;
					if (d.card && !(was && was.r === d.card.r && was.s === d.card.s)) { paintDuel(c); }
					if (Boolean(d.card) !== Boolean(was)) { turn(c, Boolean(d.card)); }
				} else {
					c = make(!d.card, greenMaterial); // FACE DOWN: TURNED OVER, ITS GREEN BACK ON TOP, NO FACE OF ITS OWN YET
					Object.assign(c, { duel: d, outline: null, spot: { x: d.x, y: CARD_Y, z: d.z, faceDown: !d.card }, at: { x: GREEN_DECK.x, y: GREEN_TOP, z: GREEN_DECK.z, yaw: 0 } });
					if (d.card) { paintDuel(c); }
					duelCards.set(d.key, c);
					moveTo(c, (redeal ? DEAL_MS : 0) + (dealt++) * DEAL_STAGGER_MS, () => { if (c.outline) { c.outline.visible = true; } }); // A NEW ROUND'S CARDS LEAVE THE DECK ONCE THE OLD ONES ARE BACK
				}
				if (d.won) { outline(c); } else { unoutline(c); }
			}
			placeFrame(); // THE KEYS' FRAME ON A DUEL CARD: UNDER REDUCED MOTION NO SLIDE ENDS TO PLACE IT (A REMOUNT, A ROOM LOADED LATE)
			requestRender();
		},
		/**
		 * @description Flips one of a player's duel cards face up where it lies, & frames it in gold when won. A card already face up (dealDuel showed the answer's view first) only takes the frame.
		 * The set: the round's, until the last dealDuel's view had a spades pick, then the spades deal's (so the round's last tied flips land on the round whether dealDuel laid the spades deal before them or after)
		 * @param {string} player "w" | "b" (the duel-flip event's player)
		 * @param {number|null} index 0..2 in the view's duel hands; null (a pick the view no longer shows): the card of that set already showing card, else the first face-down one (face down they all look alike)
		 * @param {{ r: number, s: string }} card the duel-flip event's card
		 * @param {boolean} won the gold frame
		 */
		flipDuel(player, index, card, won = false) {
			if (!duelDeal || !current.view) { return; }
			const side = player === current.view.you ? "mine" : "his", set = duelDeal.flips;
			const row = [...duelCards.values()].filter((x) => x.duel.side === side && x.duel.set === set);
			const c = index === null || index === undefined ? row.find((x) => x.duel.card && x.duel.card.r === card.r && x.duel.card.s === card.s) || row.find((x) => !x.duel.card) : duelCards.get(`${side}:${set}:${index}`);
			if (!c) { return; }
			if (!c.duel.card) { Object.assign(c.duel, { card, pickable: false }); paintDuel(c); turn(c, true); } // NO LONGER PICKED, BEFORE THE ANSWER'S VIEW SAYS SO
			if (won) { outline(c); }
			placeFrame();
			requestRender();
		},
		/**
		 * @description The duel is over: its cards slide back to the green deck & go, the hands slide back into their rows
		 */
		endDuel() {
			if (!duelDeal) { return; }
			for (const c of duelCards.values()) { sendBack(c); }
			duelCards.clear();
			duelDeal = null;
			if (current.view) { lay(); }
		},
		/**
		 * @description Takes every card & the frame out of the room & frees what they own. The template's geometry is the room's to free
		 */
		dispose() {
			if (openPile || zoomId) { frameBox(null); }
			reader.remove();
			lifted = null;
			showPreview();
			for (const c of [...cards.values(), ...green, ...duelCards.values(), ...leaving]) { if (c.outline) { room.remove(c.outline); } free(c); }
			cards.clear();
			duelCards.clear();
			leaving.clear();
			duelDeal = null;
			drag = stage = null;
			for (const m of lands) { room.remove(m); }
			room.remove(frame);
			backMaterial.dispose();
			greenMaterial.dispose();
			frame.geometry.dispose();
			frameMaterial.dispose();
		},
	};
}
