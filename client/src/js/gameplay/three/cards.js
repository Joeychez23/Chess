/* ---- Promotion cards: four cards on the deck on the desk, dealt into the green strip when a pawn promotes ---- */

import { CanvasTexture, SRGBColorSpace, MeshBasicMaterial, PlaneGeometry, Mesh, Shape, Path, ShapeGeometry } from "three";
import { CARD_ORDER, CARD_SIZE, DECK, CARD_Y, cardSpots, drawCardFace } from "./cardLayout.js";
import { blob } from "./materials.js";

const CARD_LIGHT = 0xCDBE9C; // A CARD'S FACE TINT ON THE BAIZE, TO MATCH THE BAKED DECK UNDER THE LAMP
const CARD_BACK = 0x38080A; // THE BACK, A DEEP RED
const HOVER_LIGHT = 0xFFFFFF; // A HOVERED OR FOCUSED FACE SHOWS ITS DRAWING UNTINTED
const FOCUS = { color: 0xFFC83D, opacity: 1 }; // THE KEYBOARD'S FRAME: HIGHLIGHTS.focus IN three/index.js
const FRAME_GAP = 0.2; // THE GOLD FRAME'S INNER EDGE, THIS FAR OUTSIDE THE CARD...
const FRAME_WIDTH = 0.5; // ...& ITS THICKNESS
const SHADOW_SCALE = 1.1; // THE CONTACT SHADOW IS THIS MUCH BIGGER THAN THE CARD
const SHADOW_OPACITY = 0.5;
const SHADOW_DROP = 0.01; // UNDER THE CARD
const FRAME_DROP = 0.005;
const LIFT = 0.35; // HOW HIGH A HOVERED OR FOCUSED CARD FLOATS
const LIFT_MS = 120;
const DEAL_MS = 250;
const DEAL_STAGGER_MS = 90;
const BACK_MS = 200;
const STACK_STEP = 0.03; // THE CARDS' THICKNESS: HOW THEY LIE ON THE DECK
const FACE_W = 512; // THE FACE TEXTURE'S SIZE, THE CARD'S 4.3 x 6: BIG ENOUGH FOR THE CORNER GLYPH TO READ
const FACE_H = 716;

const lerp = (a, b, k) => a + (b - a) * k;

/**
 * @description A gold rectangular frame lying flat (XZ), centred on the origin.
 * @param {number} w inner width
 * @param {number} h inner depth
 * @param {number} thickness how wide the frame is
 * @returns {ShapeGeometry} the frame, facing up
 */
function frameGeometry(w, h, thickness) {
	const rect = (a, b) => [[-a / 2, -b / 2], [a / 2, -b / 2], [a / 2, b / 2], [-a / 2, b / 2]];
	const outer = new Shape();
	rect(w + thickness * 2, h + thickness * 2).forEach(([x, y], i) => (i ? outer.lineTo(x, y) : outer.moveTo(x, y)));
	const hole = new Path();
	rect(w, h).forEach(([x, y], i) => (i ? hole.lineTo(x, y) : hole.moveTo(x, y)));
	outer.holes.push(hole);
	return new ShapeGeometry(outer).rotateX(-0.5 * Math.PI);
}

/**
 * @description Finds the face & back meshes of a clone of the card template. three.js splits a two material object into one mesh per material, so they are found by material name
 * @param {Object3D} card the cloned template
 * @returns {{ face: Mesh, back: Mesh }|null} the two meshes, null when the template has no cardFace or cardBack
 */
function findParts(card) {
	let face = null, back = null;
	card.traverse(function (o) {
		if (!o.isMesh || !o.material) { return; }
		if (o.material.name === "cardFace") { face = o; }
		else if (o.material.name === "cardBack") { back = o; }
	});
	return face && back ? { face, back } : null;
}

/**
 * @description Four promotion cards, hidden on the deck until dealt. They are children of the room, so they turn with it.
 * @param {{ template: Object3D, room: Group, tweens: object, requestRender: () => void, still?: () => boolean }} options the room's hidden "card" (a Group of a face & a back mesh), the room group, the tween runner (tween.js), the frame request & whether reduced motion is on (a lift is then set at once)
 * @returns {{ deal: Function, putBack: Function, dealt: Function, hit: Function, hover: Function, focus: Function, dispose: Function }|null} the cards, null when the template can't be used
 */
export function createCards({ template, room, tweens, requestRender, still = () => false }) {
	if (!findParts(template)) { return null; } // AN OLD OR ODD library.glb: THE FLAT PICKER STAYS. BEFORE ANYTHING IS MADE, SO THERE IS NOTHING TO DISPOSE
	const spots = cardSpots();
	const backMaterial = new MeshBasicMaterial({ color: CARD_BACK });
	const shadowGeometry = new PlaneGeometry(CARD_SIZE.w * SHADOW_SCALE, CARD_SIZE.h * SHADOW_SCALE).rotateX(-0.5 * Math.PI);
	const frameMaterial = new MeshBasicMaterial({ color: FOCUS.color, opacity: FOCUS.opacity, transparent: FOCUS.opacity < 1, depthWrite: false });
	const frame = new Mesh(frameGeometry(CARD_SIZE.w + FRAME_GAP * 2, CARD_SIZE.h + FRAME_GAP * 2, FRAME_WIDTH), frameMaterial);
	frame.visible = false;
	const cards = [];
	for (let i = 0; i < CARD_ORDER.length; i++) {
		const root = template.clone(true);
		const parts = findParts(root); // THE CLONE HAS THE TEMPLATE'S PARTS (CHECKED ABOVE)
		const canvas = document.createElement("canvas");
		canvas.width = FACE_W;
		canvas.height = FACE_H;
		const texture = new CanvasTexture(canvas);
		texture.colorSpace = SRGBColorSpace;
		texture.flipY = false; // THE FACE QUAD'S UVs RUN FROM THE CARD'S TOP EDGE AT v = 0, LIKE glTF READS THEM
		const faceMaterial = new MeshBasicMaterial({ map: texture, color: CARD_LIGHT });
		parts.face.material = faceMaterial;
		parts.back.material = backMaterial;
		root.visible = false;
		const shadow = new Mesh(shadowGeometry, new MeshBasicMaterial({ map: blob, transparent: true, opacity: SHADOW_OPACITY, depthWrite: false }));
		shadow.visible = false;
		shadow.position.set(spots[i].x, CARD_Y - SHADOW_DROP, spots[i].z);
		room.add(root, shadow);
		cards.push({ root, face: parts.face, faceMaterial, canvas, texture, shadow, p: 0, lift: 0, liftTo: 0, slideToken: 0, liftToken: 0, landed: false });
	}
	room.add(frame);
	let isDealt = false;
	let hovered = null;
	let focused = null;
	const faceMeshes = cards.map((c) => c.face);

	const stackY = (i) => DECK.y + (CARD_ORDER.length - 1 - i) * STACK_STEP; // THE QUEEN ON TOP

	// PUTS CARD i WHERE ITS PROGRESS (0 DECK, 1 ITS SPOT) & LIFT SAY
	function place(i) {
		const c = cards[i];
		c.root.position.set(lerp(DECK.x, spots[i].x, c.p), lerp(stackY(i), CARD_Y, c.p) + c.lift, lerp(DECK.z, spots[i].z, c.p));
	}

	// THE FRAME GOES ROUND THE FOCUSED CARD, ONCE IT'S ON THE BAIZE
	function placeFrame() {
		const on = isDealt && focused !== null && cards[focused].landed;
		frame.visible = on;
		if (on) { frame.position.set(spots[focused].x, CARD_Y - FRAME_DROP, spots[focused].z); }
	}

	// EACH CARD'S LIFT & LIGHT FROM WHAT IS HOVERED OR FOCUSED
	function refreshLift() {
		cards.forEach(function (c, i) {
			const up = isDealt && (i === hovered || i === focused);
			c.faceMaterial.color.setHex(up ? HOVER_LIGHT : CARD_LIGHT);
			const target = up ? LIFT : 0;
			if (target === c.liftTo) { return; }
			c.liftTo = target;
			const token = ++c.liftToken;
			const from = c.lift;
			if (still()) { c.lift = target; place(i); return; } // REDUCED MOTION: NO EASE
			tweens.add({
				duration: LIFT_MS,
				update(k) { if (token !== c.liftToken) { return; } c.lift = lerp(from, target, k); place(i); },
			});
		});
		placeFrame();
		requestRender();
	}

	// DRAWS THE FOUR FACES FOR color
	function paint(color) {
		cards.forEach(function (c, i) {
			const ctx = c.canvas.getContext("2d");
			ctx.clearRect(0, 0, FACE_W, FACE_H);
			drawCardFace(ctx, CARD_ORDER[i], color, FACE_W, FACE_H);
			c.texture.needsUpdate = true;
		});
	}

	// MOVES CARD i TO PROGRESS target ON ITS OWN, animate FALSE JUMPS. onEnd RUNS WHEN IT ARRIVES (OR AT ONCE)
	function slide(i, target, animate, duration, delay, onEnd) {
		const c = cards[i];
		const token = ++c.slideToken;
		const from = c.p;
		if (!animate) { c.p = target; place(i); onEnd(); return; }
		tweens.add({
			duration, delay,
			update(k) { if (token !== c.slideToken) { return; } c.p = lerp(from, target, k); place(i); },
			onEnd() { if (token === c.slideToken) { onEnd(); } },
		});
	}

	return {
		/**
		 * @description Deals the four cards from the deck to the strip, queen first. The faces are drawn for color.
		 * @param {string} color "w" (outlined symbols) or "b" (solid), the player's colour
		 * @param {boolean} animate false sets them in place at once
		 */
		deal(color, animate) {
			paint(color);
			isDealt = true;
			cards.forEach(function (c, i) {
				c.root.visible = true;
				c.landed = false;
				c.shadow.visible = false;
				slide(i, 1, animate, DEAL_MS, i * DEAL_STAGGER_MS, function () {
					c.landed = true;
					c.shadow.visible = true;
					placeFrame();
					requestRender();
				});
			});
			refreshLift();
		},
		/**
		 * @description Slides the cards back to the deck & hides them there.
		 * @param {boolean} animate false hides them at once
		 */
		putBack(animate) {
			isDealt = false;
			cards.forEach(function (c, i) {
				c.landed = false;
				c.shadow.visible = false;
				slide(i, 0, animate, BACK_MS, 0, function () { c.root.visible = false; requestRender(); });
			});
			refreshLift();
		},
		/**
		 * @description Whether the cards are out, or on their way (the pointer can pick them).
		 * @returns {boolean} true from deal() until putBack()
		 */
		dealt() {
			return isDealt;
		},
		/**
		 * @description The card under a ray.
		 * @param {Raycaster} raycaster already set from the camera & pointer
		 * @returns {number|null} the card's index in CARD_ORDER, null for none or when the cards aren't out
		 */
		hit(raycaster) {
			if (!isDealt) { return null; }
			const first = raycaster.intersectObjects(faceMeshes.filter((m, i) => cards[i].root.visible), false)[0];
			return first ? faceMeshes.indexOf(first.object) : null;
		},
		/**
		 * @description Lifts the card under the pointer (& lights its face), the others go back down.
		 * @param {number|null} index the card, null for none
		 */
		hover(index) {
			if (index === hovered) { return; }
			hovered = index;
			refreshLift();
		},
		/**
		 * @description Lifts the keyboard's card & frames it in gold on the baize.
		 * @param {number|null} index the card, null for none
		 */
		focus(index) {
			if (index === focused) { return; }
			focused = index;
			refreshLift();
		},
		/**
		 * @description Takes the cards, their shadows & the frame out of the room & frees what they own. The template's geometry is the room's to free.
		 */
		dispose() {
			cards.forEach(function (c) {
				c.slideToken++;
				c.liftToken++;
				room.remove(c.root, c.shadow);
				c.texture.dispose();
				c.faceMaterial.dispose();
				c.shadow.material.dispose();
			});
			room.remove(frame);
			backMaterial.dispose();
			shadowGeometry.dispose();
			frame.geometry.dispose();
			frameMaterial.dispose();
		},
	};
}
