/* ---- Chess Cards table: both hands, the card duel dealt from the room's baked green deck and each player's three places (the
active spot, the passive pile, the discard pile: tableLayout.js), every card a clone of the room's card at the promotion cards'
size and look (cards.js) ---- */

import {
	CanvasTexture, SRGBColorSpace, MeshBasicMaterial, MeshStandardMaterial, Mesh, Plane, Vector3, Box3, Ray, Matrix4, Shape, ExtrudeGeometry
} from "three";
import { CARD_SIZE, DECK, GREEN_DECK, CARD_Y, FONT } from "./cardLayout.js";
import {
	findParts, frameGeometry, lerp, CARD_LIGHT, CARD_BACK, HOVER_LIGHT, FOCUS, FRAME_GAP, FRAME_WIDTH, FRAME_DROP, LIFT, LIFT_MS,
	DEAL_MS, DEAL_STAGGER_MS, STACK_STEP, FACE_W, FACE_H
} from "./cards.js";
import { DESK_Y } from "./constants.js";
import { faceOf, drawPlayFace, drawDuelFace, drawBackFace } from "./cardFaces.js";
import {
	tableSpots, pileCards, columnBox, placeAt, deskPoint, duelLayout, spotHit, buttonLayout, PILES, DISCARD, HAND_Z, BOARD_RECT,
	DESK_AVOID, PLAQUE_TEXT, PLAQUE_LINE
} from "./tableLayout.js";

// A card's thickness (cards.js STACK_STEP) and a hair, so an overlapping card lies on the one under it
const CARD_LAYER = STACK_STEP + 0.001;
// A lying card's base: just above the desk top
const PILE_BASE_LIFT = 0.005;
// A hand card with no play but a discard this turn (select.js dimmed): its face under less light
const DIM_LIGHT = 0x6E6654;
// The duel cards' backs, as the baked green deck's
const GREEN_BACK = 0x0E3B22;
// A duel card dealt from (and going back to) the green deck lies on its top, as the promotion cards do on the red one's (cards.js)
const GREEN_TOP = GREEN_DECK.y;

// A baked deck, in the room's space: a card's footprint from the desk up to its top
function deckBox(d) {
	return new Box3(
		new Vector3(d.x - CARD_SIZE.w / 2, DESK_Y, d.z - CARD_SIZE.h / 2),
		new Vector3(d.x + CARD_SIZE.w / 2, d.y, d.z + CARD_SIZE.h / 2)
	);
}
const DECK_BOXES = [deckBox(DECK), deckBox(GREEN_DECK)];

// A duel card goes to and from the green deck by two points, so it passes neither straight under the board's corner nor through
// the near taken pieces (x 24.4 and up, z 6.7 .. 17.1): out of the deck along its z (0) to DUEL_OUT, then across to DUEL_WAYPOINT
// on its row's z (mirrored for Card Guy's row), then along the row. Its x lies between the board's frame (14.25 plus half a card's
// width) and the pile (x 24, less a piece and half a width), a little above the deck's top. Tune on screen
export const DUEL_OUT = { x: 18.6, y: GREEN_TOP + 1, z: GREEN_DECK.z };
export const DUEL_WAYPOINT = { x: 18.6, y: GREEN_TOP + 1, z: HAND_Z };
// Each card flying back together goes this much higher than the one before, so they don't meet at one height at the waypoints
const RETURN_RISE = 0.06;

/**
 * @description Where a duel card is, k of the way between from and to: deck, DUEL_OUT, DUEL_WAYPOINT, row (dealt), or the other way
 * (sent back), each leg an equal share of k. Sent back, it skips the points it hadn't reached yet, so a card still on its way out
 * goes straight back. The waypoint's z takes the side (sign) of the end that isn't the deck
 * @param {{ x: number, y: number, z: number, yaw: number }} from
 * @param {{ x: number, y: number, z: number, yaw: number }} to
 * @param {number} k 0..1
 * @param {number} [rise] added to the waypoints' height (not the ends')
 * @returns {{ x: number, y: number, z: number, yaw: number }}
 */
export function duelPath(from, to, k, rise = 0) {
	const out = { x: DUEL_OUT.x, y: DUEL_OUT.y + rise, z: DUEL_OUT.z };
	// The deck lies at z 0, so the sum has the row's sign
	const w = { x: DUEL_WAYPOINT.x, y: DUEL_WAYPOINT.y + rise, z: (Math.sign(from.z + to.z) || 1) * DUEL_WAYPOINT.z };
	// The points between p and the deck
	function behind(p) {
		return Math.abs(p.z) >= DUEL_WAYPOINT.z - 1e-6 ? [w, out] : Math.abs(p.z - DUEL_OUT.z) > 1e-6 ? [out] : [];
	}
	const pts = [from, ...(Math.abs(to.z) > Math.abs(from.z) ? behind(to).reverse() : behind(from)), to];
	const n = pts.length - 1;
	const i = Math.min(n - 1, Math.floor(k * n));
	const j = k * n - i;
	const [a, b] = [pts[i], pts[i + 1]];
	return { x: lerp(a.x, b.x, j), y: lerp(a.y, b.y, j), z: lerp(a.z, b.z, j), yaw: lerp(from.yaw, to.yaw, k) };
}

// A flipping duel card turns on its long axis: it rises half its width, so its edge clears the baize
const FLIP_LIFT = CARD_SIZE.w / 2 + 0.2;
// A lifted (picked) card floats this high, above a hovered one. An ability card picked by a click or tap isn't lifted: flow.js
// never asks for it (select.js liftedCard)
const PICK_LIFT = 1.1;
// The lifted card's preview: this fraction of the face texture's size
const PILE_FACE = 0.5;
// A dragged card floats at a lifted hand card's height, under the pointer
const DRAG_Y = CARD_Y + PICK_LIFT;
// The player's places a dragged card can be let go on
const LANDINGS = { spot: PILES.mineSpot, passive: PILES.mine, discard: DISCARD.mine };
// What a screen reader hears of an opened pile
const PILE_NAMES = {
	mine: "Your passives",
	his: "Card Guy's passives",
	mineSpot: "Your actives in effect",
	hisSpot: "Card Guy's actives in effect",
	discard: "The last cards on the discard piles"
};
// A plaque button: a low brass bar lying on the baize or the desk
const PLAQUE_H = 0.25;
// build_library.py: the baize (±21.2, its top at Z0 + 0.13) on its leather edge (±22, its top at Z0 + 0.1) on the desk (Z0, DESK_Y)
const BAIZE_BOUNDS = { edge: 21.2, top: CARD_Y - 0.02 };
const MAT_BOUNDS = { edge: 22, top: DESK_Y + 0.1 };
// deskInView: the screen's edges this far in (NDC). 0.98 (FIT_NDC) leaves 0.03 too little desk under the hand for two rows of
// two-line plaques in the pinned opening view
const VIEW_EDGE = 0.99;
// Where a screen corner's ray that never meets the desk (it looks past the horizon) is taken instead: this far along it
const HORIZON_REACH = 1e4;

// The highest surface under a plaque's footprint: the plaque lies on that
function restOn(p) {
	function reach(e) {
		return Math.abs(p.x) - p.w / 2 < e && Math.abs(p.z) - p.d / 2 < e;
	}
	return reach(BAIZE_BOUNDS.edge) ? BAIZE_BOUNDS.top : reach(MAT_BOUNDS.edge) ? MAT_BOUNDS.top : DESK_Y;
}

// A press sinks the plaque about its own height, and it rises again
const PLAQUE_SINK = PLAQUE_H * 0.8;
const PRESS_MS = 2 * LIFT_MS;
// The plaque top's texture, pixels per unit
const PLAQUE_PX = 64;
// Its edges: a real bevel all round, so they catch the room's light
const PLAQUE_BEVEL = { size: 0.08, thickness: 0.06 };
// Its brass. The red deck's frame is build_library.py's plastic:brass, baked (diffuse, roughness 0.85) into the room's light map,
// and reads #B18133 in the bake's game render (bake-out/library/game-opening.png). A plaque moves, so it can't be baked: it's lit
// by the scene's hemisphere and key light as the pieces are (three/index.js), which give a top face about 0.95, so this albedo
// reads about the same
const BRASS_MATERIAL = { color: 0xB58638, roughness: 0.85, metalness: 0 };
// A hovered plaque's top: this much brighter brass (as a hovered hand card's face goes from CARD_LIGHT to HOVER_LIGHT)
const PLAQUE_HOVER = 1.35;
// The keyboard's frame round a plaque: thin, white-gold
const PLAQUE_FOCUS = { color: 0xFFF3C4, gap: 0.12, width: 0.12 };

/**
 * @description The part of the desk the camera shows, for the plaques (tableLayout.js buttonLayout's within): where the screen's
 * corners, VIEW_EDGE in from its edges, meet the desk and the top of a plaque on the baize, in the room's space (unturned); on each,
 * the rectangle inside that footprint (a trapezoid, narrowest at the screen's bottom), and the part both share. A corner looking
 * past the horizon reaches far off: buttonLayout clips the rectangle to the desk.
 * shortcut: each axis takes the footprint's two middle corners, exact while the camera looks along the room's z (the opening view,
 * either side); orbited toward a corner, the rectangle can poke past the screen's sides near its corners, and then createCardTable's
 * screen check lays no plaques. Take the footprint's true inscribed rectangle if those prompts should keep plaques
 * @param {PerspectiveCamera} camera
 * @param {Object3D} room the table's parent (turned with the player's side)
 * @returns {{ x0: number, x1: number, z0: number, z1: number }}
 */
export function deskInView(camera, room) {
	camera.updateMatrixWorld();
	room.updateWorldMatrix(true, false);
	const toRoom = new Matrix4().copy(room.matrixWorld).invert();
	const ray = new Ray();
	const at = new Vector3();
	const inside = [DESK_Y, BAIZE_BOUNDS.top + PLAQUE_H].map((y) => {
		const plane = new Plane(new Vector3(0, 1, 0), -y).applyMatrix4(room.matrixWorld);
		const xs = [];
		const zs = [];
		for (const [nx, ny] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
			ray.origin.setFromMatrixPosition(camera.matrixWorld);
			ray.direction.set(nx * VIEW_EDGE, ny * VIEW_EDGE, 0.5).unproject(camera).sub(ray.origin).normalize();
			if (!ray.intersectPlane(plane, at)) { ray.at(HORIZON_REACH, at); }
			at.applyMatrix4(toRoom);
			xs.push(at.x);
			zs.push(at.z);
		}
		xs.sort((a, b) => a - b);
		zs.sort((a, b) => a - b);
		return { x0: xs[1], x1: xs[2], z0: zs[1], z1: zs[2] };
	});
	return {
		x0: Math.max(...inside.map((r) => r.x0)),
		x1: Math.min(...inside.map((r) => r.x1)),
		z0: Math.max(...inside.map((r) => r.z0)),
		z1: Math.min(...inside.map((r) => r.z1))
	};
}

/**
 * @description The Chess Cards table in the room, made from its card template. Its cards are children of the room, so they turn
 * with it (Flip Board)
 * @param {{ template: Object3D, room: Group, animations: object, requestRender: () => void, still?: () => boolean,
 * frame?: (box: object|null, zoom?: string|null) => void }} options as createCards (cards.js), and
 * frame: the camera frames this much of the desk (an opened pile's column, tableLayout.js columnBox, or the zoomed hand card's
 * footprint), null: it goes back (camera.js framePile); zoom: the hand card zoomed in on, null (or none) for none;
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
	// Key (tableLayout.js tableSpots: the owner and the card's id) -> { root, face, faceMaterial, canvas, texture, faceKey, scaleY,
	// spot, at, lift, liftTo, moveToken, liftToken, landed }
	const cards = new Map();
	let current = { view: null, catalog: {}, focus: null, focusPile: null, focusDuel: null, dim: [] };
	// tableLayout.js duelLayout's key -> a card as in cards, with duel (its duelLayout entry, card set as it flips) and outline (the
	// won card's gold frame)
	const duelCards = new Map();
	// Duel cards going back to the green deck
	const leaving = new Set();
	// The duel laid: { round, player, piece, spades, flips: the set flipDuel turns }. While it's set, the hands lie stacked
	let duelDeal = null;
	// A gold frame round each place the dragged card can be let go on (an empty place draws nothing else)
	const lands = Object.entries(LANDINGS).map(function ([place, p]) {
		const m = new Mesh(frame.geometry, frameMaterial);
		m.position.set(p.x, DESK_Y + 0.02, p.z);
		m.visible = false;
		m.userData.place = place;
		room.add(m);
		return m;
	});
	const dragPlane = new Plane(new Vector3(0, 1, 0), -DRAG_Y);
	const dragPoint = new Vector3();
	const deskAt = new Vector3();
	// covers' ray in the room's space, where the decks are
	const roomRay = new Ray();
	const roomInverse = new Matrix4();
	// The card the mouse holds: { c, id, from: "hand" | "pile", places, moved, desk: the desk under the pointer { x, z } | null }
	let drag = null;
	// The card let go on a place, lying there while it's the lifted one (tableLayout.js tableSpots)
	let stage = null;
	let lifted = null;
	let hovered = null;
	// The pile opened into a column
	let openPile = null;
	// The hand card the camera frames (zoom)
	let zoomId = null;
	// What the camera was last told to frame
	let boxKey = "null";
	// The first layout is done
	let laid = false;

	// A clone of the template: face up with its own canvas, or face down in back's colour (its face underneath, never seen)
	function make(faceDown, back = backMaterial) {
		const root = template.clone(true);
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
		room.add(root);
		return c;
	}

	// A card's own face: its canvas, texture and material. A face-down duel card gets one only when it flips (paintDuel), not 12
	// blank ones per deal
	function giveFace(c) {
		c.canvas = document.createElement("canvas");
		c.canvas.width = FACE_W;
		c.canvas.height = FACE_H;
		c.texture = new CanvasTexture(c.canvas);
		c.texture.colorSpace = SRGBColorSpace;
		// As in cards.js: the face quad's UVs run from the card's top edge at v = 0
		c.texture.flipY = false;
		c.faceMaterial = new MeshBasicMaterial({ map: c.texture, color: CARD_LIGHT });
		c.face.material = c.faceMaterial;
	}

	function free(c) {
		c.moveToken++;
		c.liftToken++;
		room.remove(c.root);
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
		if (frame.visible && c === focusedCard()) { frame.position.set(c.at.x, frameY(c), c.at.z); }
	}

	// The frame's height: a hand card's just under it, a pile card's at its own height (under it is the desk top, which hides it)
	function frameY(c) {
		return c.spot.y - (c.spot.pile || c.spot.discard ? 0 : FRAME_DROP);
	}

	// Slides a card to its spot (from the deck when it's new), as the promotion cards are dealt. done runs once it lands, unless
	// another slide or free() came first. via: false, or the height the duel waypoints are raised by (duelPath's rise)
	function moveTo(c, delay, done = () => {}, via = false) {
		const token = ++c.moveToken;
		const from = { ...c.at };
		const to = { x: c.spot.x, y: c.spot.y, z: c.spot.z, yaw: c.spot.yaw || 0 };
		if (still() || (from.x === to.x && from.y === to.y && from.z === to.z && from.yaw === to.yaw)) {
			c.at = to;
			c.landed = true;
			place(c);
			done();
			return;
		}
		c.landed = false;
		animations.add({
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
					requestRender();
					done();
				}
			},
		});
	}

	// A pile's newest card. The discard list's keyboard stop is your discard pile's top card while it has one, else Card Guy's
	function pileTop(pile) {
		const tops = [...cards.values()].filter((c) => (c.spot.discard ? "discard" : c.spot.pile) === pile && c.spot.top);
		return tops.find((c) => c.spot.discard === "mine") || tops[0] || null;
	}
	// The keyboard's card: a hand card, a pile's newest, or one of the player's duel cards of the current set
	function focusedCard() {
		return current.focus
			? cards.get(`${current.view.you}:${current.focus}`) || null
			: current.focusPile
				? pileTop(current.focusPile)
				: current.focusDuel !== null && duelDeal
					? duelCards.get(`mine:${duelDeal.spades ? "spades" : "round"}:${current.focusDuel}`) || null
					: null;
	}

	// The gold frame goes round the keyboard's card once it has landed, as on the promotion cards
	function placeFrame() {
		const c = focusedCard();
		const on = Boolean(c && c.landed);
		frame.visible = on;
		if (on) { frame.position.set(c.at.x, frameY(c), c.at.z); }
	}

	// Each hand card's lift and light: lifted (picked) highest, hovered or focused a little
	function refreshLift() {
		for (const [key, c] of cards) {
			if (!c.spot.hand || (drag && drag.c === c && drag.moved)) { continue; }
			const id = key.slice(2);
			const up = c.spot.staged ? 0 : id === lifted ? PICK_LIFT : id === hovered || id === current.focus ? LIFT : 0;
			if (c.faceMaterial) { c.faceMaterial.color.setHex(current.dim.includes(id) ? DIM_LIGHT : up ? HOVER_LIGHT : CARD_LIGHT); }
			if (up === c.liftTo) { continue; }
			c.liftTo = up;
			const token = ++c.liftToken;
			const from = c.lift;
			if (still()) {
				c.lift = up;
				place(c);
				continue;
			}
			animations.add({
				duration: LIFT_MS,
				update(k) {
					if (token !== c.liftToken) { return; }
					c.lift = lerp(from, up, k);
					place(c);
				}
			});
		}
		placeFrame();
		requestRender();
	}

	// Draws a face-up card's face when what it shows has changed. A hidden card of the discard list (card null) shows its back with
	// its owner's name bar, untinted as backMaterial
	function paint(c) {
		const face = c.spot.card ? faceOf(c.spot.card, current.catalog) : null;
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

	/* ---- The opened pile: its cards in a column on the desk (tableLayout.js), the camera framing it. Nothing is drawn over the
	screen: a hidden live region reads the cards out for a screen reader ---- */
	const reader = document.createElement("p");
	reader.className = "cardPileText";
	reader.setAttribute("role", "status");
	document.body.append(reader);
	function say(card) {
		if (card.down) { return "a face-down card"; }
		const face = faceOf(card, current.catalog);
		return `${face.name}, ${face.type}${face.text ? `: ${face.text}` : ""}`;
	}
	// The camera frames the opened pile's column (again when it grows or shrinks) or the zoomed hand card, and goes back when it is
	// neither. A refresh that changes nothing leaves the camera alone
	function frameOpen() {
		const z = zoomId && cards.get(`${current.view.you}:${zoomId}`);
		const list = openPile ? pileCards(current.view, openPile) : [];
		const box = openPile
			? columnBox(openPile, list.length)
			: z
				? { x0: z.spot.x - CARD_SIZE.w / 2, x1: z.spot.x + CARD_SIZE.w / 2, z0: z.spot.z - CARD_SIZE.h / 2, z1: z.spot.z + CARD_SIZE.h / 2 }
				: null;
		const key = JSON.stringify(box);
		// The discard list is newest first already, and says whose each card was
		const said = openPile === "discard"
			? list.map((card, i) => `${current.view.piled[i].player === current.view.you ? "yours" : "Card Guy's"}, ${say(card)}`)
			: list.slice().reverse().map(say);
		const text = openPile ? `${PILE_NAMES[openPile]}, newest first: ${said.join("; ")}` : "";
		if (reader.textContent !== text) { reader.textContent = text; }
		// While a placed card is dragged, the camera shows the way to the discard pile (follow)
		if (key === boxKey || (drag && drag.moved && drag.from === "pile")) { return; }
		boxKey = key;
		// zoomId: what is zoomed in on goes to flow.js too (three/index.js), where Escape and a play end it
		frameBox(box, zoomId);
	}

	// Lays the table out for current: new cards slide in (from the red deck, or from Card Guy's hand to his places), moved ones
	// slide to their new spot (one there or on its way already is left alone), and gone ones are taken away
	function lay() {
		// Its last card left
		if (openPile && !pileCards(current.view, openPile).length) { openPile = null; }
		const want = tableSpots(current.view, {
			open: openPile, base: DESK_Y + PILE_BASE_LIFT, layer: CARD_LAYER, stage, stacked: Boolean(duelDeal)
		});
		// Its card left the hand (or was never in it), or the hands lie stacked for a duel
		if (zoomId && (duelDeal || !(want.get(`${current.view.you}:${zoomId}`) || {}).hand)) { zoomId = null; }
		for (const [key, c] of [...cards]) {
			const w = want.get(key);
			if (w && w.faceDown === c.spot.faceDown) { continue; }
			// The dragged card left the table
			if (drag && drag.c === c) {
				drag = null;
				showLands([]);
			}
			free(c);
			cards.delete(key);
		}
		let dealt = 0;
		for (const [key, spot] of want) {
			let c = cards.get(key);
			if (!c) {
				c = make(spot.faceDown);
				// On the first layout (a game loaded) the places' cards lie there already
				const from = spot.from === "deck" ? DECK : spot.from === "hand" && laid ? { x: 0, y: CARD_Y, z: -HAND_Z } : spot;
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
			// Under the pointer
			if (drag && drag.c === c && drag.moved) { continue; }
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
		frameOpen();
		refreshLift();
		// The lifted card left the hand, or the catalog came
		showPreview();
	}

	function showLands(places) {
		for (const m of lands) { m.visible = places.includes(m.userData.place); }
		requestRender();
	}

	/* ---- The card duel: its cards dealt from the green deck into the rows (tableLayout.js duelLayout), each face up once flipped,
	the won one framed in gold ---- */
	function paintDuel(c) {
		// Dealt face down: its face is made now
		if (!c.canvas) { giveFace(c); }
		const ctx = c.canvas.getContext("2d");
		ctx.clearRect(0, 0, FACE_W, FACE_H);
		drawDuelFace(ctx, c.duel.card, FACE_W, FACE_H);
		c.texture.needsUpdate = true;
	}

	function outline(c) {
		if (c.outline) { return; }
		c.outline = new Mesh(frame.geometry, frameMaterial);
		c.outline.position.set(c.spot.x, c.spot.y - FRAME_DROP, c.spot.z);
		// Its card still on its way: the outline shows when the card lands (dealDuel)
		c.outline.visible = c.landed;
		room.add(c.outline);
	}

	function unoutline(c) {
		if (c.outline) {
			room.remove(c.outline);
			c.outline = null;
		}
	}

	// Turns a duel card over where it lies, on its long axis, rising so its edge clears the baize: face up, or face down again (a take-back)
	function turn(c, up) {
		c.spot.faceDown = !up;
		const token = ++c.liftToken;
		// place() lifts a face-down card by STACK_STEP: the turn starts at the height it lies at
		const sink = up ? STACK_STEP : -STACK_STEP;
		if (still()) {
			c.root.rotation.z = up ? 0 : Math.PI;
			c.lift = 0;
			place(c);
			return;
		}
		animations.add({
			duration: DEAL_MS,
			update(k) {
				if (token !== c.liftToken) { return; }
				c.root.rotation.z = up ? lerp(Math.PI, 0, k) : lerp(0, Math.PI, k);
				c.lift = sink * (1 - k) + FLIP_LIFT * Math.sin(Math.PI * k);
				place(c);
			},
			onEnd() { requestRender(); },
		});
	}

	// A duel card slides back to the green deck and is taken away there
	function sendBack(c) {
		unoutline(c);
		leaving.add(c);
		c.spot = { ...c.spot, x: GREEN_DECK.x, y: GREEN_TOP, z: GREEN_DECK.z };
		// leaving.size: this card's place among those flying back now
		moveTo(c, 0, () => {
			leaving.delete(c);
			free(c);
			requestRender();
		}, leaving.size * RETURN_RISE);
	}

	/* ---- The lifted card's preview: a hand card with rules text (an active, the held passive, a curse), big enough to read, beside
	the board while it's lifted, as the owner asked (2026-11-22). The card the keys pick and the drop's target pick both show it ---- */
	let preview = null;
	let previewKey = null;
	function showPreview() {
		const c = lifted && current.view ? cards.get(`${current.view.you}:${lifted}`) : null;
		const face = c && c.spot.card ? faceOf(c.spot.card, current.catalog) : null;
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

	/* ---- The brass plaque buttons (table UI doc, "3D buttons on the table"): bevelled bars of the red deck's brass lit by the room,
	engraved capitals on each plaque's top, brighter when hovered, a white-gold frame round the keyboard's (tableLayout.js
	buttonLayout) ---- */
	// The bevel and sides, shared
	const plaqueBrass = new MeshStandardMaterial(BRASS_MATERIAL);
	const plaqueFocus = new MeshBasicMaterial({ color: PLAQUE_FOCUS.color });
	// In order: { id, mesh, top (its top's material), texture, ring (the focus frame, a child of mesh), token }
	let buttons = [];
	let buttonsKey = "[]";
	// The ids and labels of the list laid, so a rebuild of the same list keeps its hover
	let buttonsLabels = "[]";
	// The last showButtons' list, anchor, cards under and view (a repeat lays nothing out)
	let buttonsAsked = null;
	// The hovered plaque's id (hoverButton), kept over a rebuild of the same list
	let hoveredButton = null;
	// The view the prompt withinFor (its list and anchor) came up in: kept until another prompt or relayButtons, so the plaques
	// don't chase the camera
	let buttonsWithin = null;
	let withinFor = null;
	// The last showButtons' arguments
	let buttonsArgs = null;
	// The focus frame: on the surface round its plaque
	const RING_Y = 0.01 - PLAQUE_H / 2;
	function drawPlaque(canvas, lines) {
		const ctx = canvas.getContext("2d");
		const w = canvas.width;
		const h = canvas.height;
		// The map is multiplied by the brass: white is plain brass
		ctx.fillStyle = "#FFFFFF";
		ctx.fillRect(0, 0, w, h);
		// Every plaque's text is the same height: a long label takes two lines (buttonLayout)
		ctx.font = `bold ${Math.round(PLAQUE_TEXT * PLAQUE_PX)}px ${FONT}`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		lines.forEach(function (line, i) {
			// Engraved: multiplied by the brass, a dark brown cut
			ctx.fillStyle = "#3C3C3C";
			ctx.fillText(line, w / 2, h / 2 + (i - (lines.length - 1) / 2) * PLAQUE_LINE * PLAQUE_PX);
		});
	}
	function makePlaque(p) {
		// Its flat top; the bevel reaches out to p.w x p.d
		const w = p.w - 2 * PLAQUE_BEVEL.size;
		const d = p.d - 2 * PLAQUE_BEVEL.size;
		const depth = PLAQUE_H - 2 * PLAQUE_BEVEL.thickness;
		const canvas = document.createElement("canvas");
		canvas.width = Math.round(w * PLAQUE_PX);
		canvas.height = Math.round(d * PLAQUE_PX);
		drawPlaque(canvas, p.lines);
		const texture = new CanvasTexture(canvas);
		texture.colorSpace = SRGBColorSpace;
		// The top's UVs are the shape's x and y (ExtrudeGeometry), mapped onto 0 .. 1. flipY stays the default: the canvas's top lies
		// away from the player
		texture.repeat.set(1 / w, 1 / d);
		texture.offset.set(0.5, 0.5);
		const top = new MeshStandardMaterial({ ...BRASS_MATERIAL, map: texture });
		const shape = new Shape().moveTo(-w / 2, -d / 2).lineTo(w / 2, -d / 2).lineTo(w / 2, d / 2).lineTo(-w / 2, d / 2);
		// Lying flat, the shape's y away from the player
		const geometry = new ExtrudeGeometry(shape, {
			depth, bevelEnabled: true, bevelThickness: PLAQUE_BEVEL.thickness, bevelSize: PLAQUE_BEVEL.size, bevelSegments: 2
		}).translate(0, 0, -depth / 2).rotateX(-Math.PI / 2);
		// ExtrudeGeometry's groups: the top and bottom faces, then the sides and bevel
		const mesh = new Mesh(geometry, [top, plaqueBrass]);
		// Its centre
		const y = restOn(p) + PLAQUE_H / 2;
		mesh.position.set(p.x, y, p.z);
		mesh.userData.button = p.id;
		const ring = new Mesh(frameGeometry(p.w + PLAQUE_FOCUS.gap * 2, p.d + PLAQUE_FOCUS.gap * 2, PLAQUE_FOCUS.width), plaqueFocus);
		ring.position.y = RING_Y;
		ring.visible = false;
		mesh.add(ring);
		room.add(mesh);
		return { id: p.id, mesh, top, texture, ring, y, token: 0 };
	}
	function freeButtons() {
		for (const b of buttons) {
			b.token++;
			room.remove(b.mesh);
			b.mesh.geometry.dispose();
			b.ring.geometry.dispose();
			b.texture.dispose();
			b.top.dispose();
		}
		buttons = [];
	}
	// Every corner of every plaque (makePlaque: its bevel reaches p.w x p.d, from restOn(p) up to PLAQUE_H) projects inside the
	// screen, in front of the camera.
	// shortcut: not its focus frame, which can poke about 4 px past the screen's edge. Counting it here would take the plaques from
	// about 9% of opening-view prompts (every two-pair one at 1920x1080). Add PLAQUE_FOCUS's reach if the owner asks for it
	function onScreen(laid) {
		camera.updateMatrixWorld();
		room.updateWorldMatrix(true, false);
		const at = new Vector3();
		return laid.every((p) => [-1, 1].every((sx) => [-1, 1].every((sz) => [0, PLAQUE_H].every((dy) => {
			at.set(p.x + sx * p.w / 2, restOn(p) + dy, p.z + sz * p.d / 2).applyMatrix4(room.matrixWorld).project(camera);
			return Math.abs(at.x) <= 1 && Math.abs(at.y) <= 1 && Math.abs(at.z) <= 1;
		}))));
	}
	function layButtons(list, anchor) {
		const under = [...cards.values(), ...duelCards.values()].map((c) => ({
			x0: c.spot.x - CARD_SIZE.w / 2, x1: c.spot.x + CARD_SIZE.w / 2, z0: c.spot.z - CARD_SIZE.h / 2, z1: c.spot.z + CARD_SIZE.h / 2
		}));
		// A prompt: its list at its anchor
		const labels = JSON.stringify([list.map((b) => [b.id, b.label]), list.length ? [anchor.x, anchor.z, anchor.side] : null]);
		buttonsArgs = [list, anchor];
		// A new prompt takes the view as it is now
		if (labels !== withinFor) {
			withinFor = labels;
			buttonsWithin = list.length ? inView() : null;
		}
		const asked = JSON.stringify([list, list.length ? anchor : null, under, buttonsWithin]);
		// The same ask: no search (a blocked desk's takes tens of ms)
		if (asked === buttonsAsked) { return; }
		buttonsAsked = asked;
		let laid = list.length ? buttonLayout(list, anchor, [BOARD_RECT, ...DESK_AVOID, ...under], buttonsWithin) : [];
		// Whatever the camera (deskInView's shortcut, an orbited view), never a plaque off screen
		const off = camera !== null && !laid.blocked && !onScreen(laid);
		const blocked = Boolean(laid.blocked) || off;
		const hidden = off || (blocked && Boolean(buttonsWithin));
		// No clear place in the view: no plaques, and the prompt keeps its 2D buttons
		if (hidden) { laid = []; }
		// Keyed by what's laid, not by what was asked, so a card moving elsewhere rebuilds nothing
		const key = JSON.stringify(laid.map((p) => [p.id, p.lines, p.x, p.z, p.w, p.d])) + (blocked ? " blocked" : "");
		if (key === buttonsKey) { return; }
		// Warned once a rebuild, not once a call
		if (blocked) {
			console.warn(`Chess Cards: no clear place ${off ? "on screen" : "on the desk"} for the buttons by (${anchor.x}, ${anchor.z}); ${hidden ? "the prompt keeps its 2D buttons" : "they cover something"}`);
		}
		// Another prompt comes up unfocused, so a held Enter can't press its first plaque
		const focused = labels === buttonsLabels ? buttons.find((b) => b.ring.visible)?.id : undefined;
		buttonsKey = key;
		freeButtons();
		// Another list or anchor (or none) comes up unlit, whatever its ids; the same one laid again keeps its hover
		if (labels !== buttonsLabels) { hoveredButton = null; }
		buttonsLabels = labels;
		buttons = laid.map(makePlaque);
		// The same ids keep their focus and hover
		for (const b of buttons) {
			b.ring.visible = b.id === focused;
			b.top.color.multiplyScalar(b.id === hoveredButton ? PLAQUE_HOVER : 1);
		}
		requestRender();
	}

	return {
		/**
		 * @description Lays the table out for a view (lay)
		 * @param {object} view cards.view
		 * @param {object} opts { catalog: cards.catalog, focus: the keyboard's hand card id | null, focusPile: the keyboard's pile (a
		 * key of tableLayout.js PILES) | null, focusDuel: the keyboard's duel card, an index 0..2 of the player's current set | null,
		 * dim: the hand card ids drawn dimmer }
		 */
		set(view, opts = {}) {
			current = {
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
			if (id === lifted) { return; }
			lifted = id;
			// The card let go on a place is no longer the one played: it goes where the view has it
			if (stage && stage.id !== id) {
				stage = null;
				if (current.view) { lay(); }
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
			const plaque = raycaster.intersectObjects(buttons.map((b) => b.mesh), false)[0];
			if (plaque) { return { kind: "button", id: plaque.object.userData.button }; }
			const picks = [...cards].filter(([key, c]) => spotHit(key, c.spot) && !(c.spot.hand && duelDeal));
			const duels = [...duelCards.values()].filter((c) => c.duel.pickable);
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
		 * for a duel, every pile and place during a duel, a duel card the player can't pick (pointer.js: a left mouse press there never
		 * moves the camera), and both decks, the green one and the red one baked into the room, as the owner asked
		 * @param {Raycaster} raycaster already set from the camera and pointer
		 * @returns {boolean}
		 */
		covers(raycaster) {
			if (raycaster.intersectObjects(
				[...cards.values(), ...duelCards.values(), ...leaving].flatMap((c) => [c.face, c.back]).concat(buttons.map((b) => b.mesh)),
				false
			).length > 0) {
				return true;
			}
			// Flip Board turns the room
			roomRay.copy(raycaster.ray).applyMatrix4(roomInverse.copy(room.matrixWorld).invert());
			return DECK_BOXES.some((box) => roomRay.intersectsBox(box));
		},
		/**
		 * @description Opens a passive pile or an active spot into its column on the desk, or the discard list ("discard") beside the
		 * discard piles, and frames it, or closes the one open (the camera goes back). Either ends a zoom
		 * @param {string|null} pile a key of tableLayout.js PILES or "discard"; the one open, or null, closes it
		 */
		togglePile(pile) {
			if (!current.view) { return; }
			openPile = pile && pile !== openPile ? pile : null;
			zoomId = null;
			lay();
		},
		/**
		 * @description The camera glides in to frame one of the player's hand cards as it frames an opened pile (camera.js framePile),
		 * or back exactly where it was. It ends by itself when the card leaves the hand, a pile opens or closes, a duel is dealt or the
		 * card is dragged
		 * @param {string|null} id the hand card's id, null: the zoom ends
		 */
		zoom(id) {
			if (!current.view || openPile) { return; }
			zoomId = id;
			// Not one of the player's hand cards (or a duel is laid): lay ends it at once
			lay();
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
		 * @description The mouse went down on a card: one of the player's hand cards, or a face-up card of their own opened pile, is
		 * held. It moves once the pointer does (follow)
		 * @param {{ id: string|null }} hit what hit() gave
		 * @param {string[]|null} places the player's places it can be let go on ("spot", "passive", "discard": framed while it's
		 * dragged), null: it isn't held
		 * @returns {boolean} held
		 */
		grab(hit, places) {
			const c = current.view && hit.id && places ? cards.get(`${current.view.you}:${hit.id}`) : null;
			if (!c || !(c.spot.hand || (c.spot.pile && c.spot.pile === openPile && PILES[openPile].side === "mine"))) { return false; }
			drag = { c, id: hit.id, from: c.spot.hand ? "hand" : "pile", places, moved: false, desk: null };
			return true;
		},
		/**
		 * @description The held card goes under the pointer, floating. The first time, its landing places are framed, and for a placed
		 * card the camera shows its column and the discard pile
		 * @param {Raycaster} raycaster already set from the camera and pointer
		 */
		follow(raycaster) {
			if (!drag || !raycaster.ray.intersectPlane(dragPlane, dragPoint)) { return; }
			// Flip Board turns the room
			room.worldToLocal(dragPoint);
			const c = drag.c;
			if (!drag.moved) {
				drag.moved = true;
				c.moveToken++;
				c.liftToken++;
				c.lift = c.liftTo = 0;
				c.landed = false;
				showLands(drag.places);
				// The camera goes back, so the places are in view
				if (zoomId) {
					zoomId = null;
					frameOpen();
				}
				if (drag.from === "pile") {
					const b = columnBox(c.spot.pile, pileCards(current.view, c.spot.pile).length);
					const d = DISCARD.mine;
					boxKey = "drag";
					frameBox({
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
			if (desk) { room.worldToLocal(deskAt.set(desk.x, DESK_Y, desk.z)); }
			drag.desk = desk ? { x: deskAt.x, z: deskAt.z } : null;
			place(c);
			requestRender();
		},
		/**
		 * @description The mouse let go of the held card. It stays where it is until settle()
		 * @returns {{ kind: "drop", from: "hand"|"pile", id: string, place: object|null }|null} what was dragged and the place under it
		 * (tableLayout.js placeAt), null when no card was dragged (a press that never moved: its click follows)
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
		 * @description After release(): the card lies on the place it was let go on while it's the lifted card (its play is on its
		 * way, or its targets are picked), or slides back to where it was. The camera goes back to the opened pile
		 * @param {boolean} held the drop was taken
		 */
		settle(held) {
			if (!held) { stage = null; }
			if (current.view) { lay(); }
		},
		/**
		 * @description Lays a card duel out as the view shows it (after set(); call it on every answer with a view.duel, before or after
		 * that answer's flipDuel calls: the table ends the same). The first time, both hands slide into stacks at their rows' left end
		 * and every duel card of the view is dealt from the green deck, face up if already flipped. A new round, or another duel
		 * (another player or piece), sends the old duel cards back and deals 3 new ones each; a spades deal adds its set beside the
		 * round's, which stay. Every card already laid is brought to the view: turned up and painted when it shows, turned back down
		 * when it no longer does (a take-back), the gold outline on exactly the view's won cards, pickable as the view allows; one the
		 * view no longer has (a taken-back spades deal) goes back to the green deck
		 * @param {object} duel view.duel (not null)
		 */
		dealDuel(duel) {
			if (!current.view || !duel) { return; }
			const spades = Boolean(duel.spades);
			const redeal = Boolean(duelDeal && (duelDeal.round !== duel.round || duelDeal.player !== duel.player || duelDeal.piece !== duel.piece));
			if (redeal) {
				for (const c of duelCards.values()) { sendBack(c); }
				duelCards.clear();
			}
			const first = !duelDeal;
			const want = duelLayout(duel, current.view.you, current.view);
			const keys = new Set(want.map((d) => d.key));
			// flips: the set a flipDuel turns. A spades deal with no pick yet came in the same answer as the round's last flips, so those
			// still go to the round (one pick per answer: a spades flip comes after a view with a spades pick)
			duelDeal = {
				round: duel.round, player: duel.player, piece: duel.piece, spades,
				flips: spades && duel.spades.picked.w.length + duel.spades.picked.b.length ? "spades" : "round"
			};
			// The hands slide into their stacks
			if (first) { lay(); }
			for (const [key, c] of duelCards) {
				if (!keys.has(key)) {
					sendBack(c);
					duelCards.delete(key);
				}
			}
			let dealt = 0;
			for (const d of want) {
				let c = duelCards.get(d.key);
				if (c) {
					// Laid already: brought to what the view shows
					const was = c.duel.card;
					c.duel = d;
					if (d.card && !(was && was.r === d.card.r && was.s === d.card.s)) { paintDuel(c); }
					if (Boolean(d.card) !== Boolean(was)) { turn(c, Boolean(d.card)); }
				} else {
					// Face down: turned over, its green back on top, no face of its own yet
					c = make(!d.card, greenMaterial);
					Object.assign(c, {
						duel: d, outline: null, spot: { x: d.x, y: CARD_Y, z: d.z, faceDown: !d.card },
						at: { x: GREEN_DECK.x, y: GREEN_TOP, z: GREEN_DECK.z, yaw: 0 }
					});
					if (d.card) { paintDuel(c); }
					duelCards.set(d.key, c);
					// A new round's cards leave the deck once the old ones are back
					moveTo(c, (redeal ? DEAL_MS : 0) + (dealt++) * DEAL_STAGGER_MS, () => {
						if (c.outline) { c.outline.visible = true; }
					}, 0);
				}
				if (d.won) {
					outline(c);
				} else {
					unoutline(c);
				}
			}
			// The keys' frame on a duel card: under reduced motion no slide ends to place it (a remount, a room loaded late)
			placeFrame();
			requestRender();
		},
		/**
		 * @description Flips one of a player's duel cards face up where it lies, and frames it in gold when won. A card already face up
		 * (dealDuel showed the answer's view first) only takes the frame.
		 * The set: the round's, until the last dealDuel's view had a spades pick, then the spades deal's (so the round's last tied
		 * flips land on the round whether dealDuel laid the spades deal before them or after)
		 * @param {string} player "w" | "b" (the duel-flip event's player)
		 * @param {number|null} index 0..2 in the view's duel hands; null (a pick the view no longer shows): the card of that set already
		 * showing card, else the first face-down one (face down they all look alike)
		 * @param {{ r: number, s: string }} card the duel-flip event's card
		 * @param {boolean} won the gold frame
		 */
		flipDuel(player, index, card, won = false) {
			if (!duelDeal || !current.view) { return; }
			const side = player === current.view.you ? "mine" : "his";
			const set = duelDeal.flips;
			const row = [...duelCards.values()].filter((x) => x.duel.side === side && x.duel.set === set);
			const c = index === null || index === undefined
				? row.find((x) => x.duel.card && x.duel.card.r === card.r && x.duel.card.s === card.s) || row.find((x) => !x.duel.card)
				: duelCards.get(`${side}:${set}:${index}`);
			if (!c) { return; }
			// No longer pickable, before the answer's view says so
			if (!c.duel.card) {
				Object.assign(c.duel, { card, pickable: false });
				paintDuel(c);
				turn(c, true);
			}
			if (won) { outline(c); }
			placeFrame();
			requestRender();
		},
		/**
		 * @description The duel is over: its cards slide back to the green deck and go, and the hands slide back into their rows
		 */
		endDuel() {
			if (!duelDeal) { return; }
			for (const c of duelCards.values()) { sendBack(c); }
			duelCards.clear();
			duelDeal = null;
			if (current.view) { lay(); }
		},
		/**
		 * @description Lays brass plaque buttons on the baize beside a desk point, clear of every card and the board and inside the desk
		 * the camera showed when this prompt came up (tableLayout.js buttonLayout, inView), or takes them away. When they'd lie as they
		 * do, nothing changes; another list, anchor, or cards coming under them replace them (the old ones freed), with the focused and
		 * hovered ids still focused and hovered
		 * @param {{ id: string, label: string }[]} list in order (the last usually Cancel); the label as the 2D button's, drawn in
		 * capitals; [] takes them away
		 * @param {{ x: number, z: number, side: "left"|"right"|"below" }} anchor a desk point (room space, unturned) and the side the
		 * plaques go on; any value with []
		 * @returns {boolean} plaques are up: false with [] and when they'd cover something inside the view, so the prompt keeps its 2D buttons
		 */
		showButtons(list, anchor) {
			layButtons(list, anchor);
			return buttons.length > 0;
		},
		/**
		 * @description Lays the plaques out again inside the desk the camera shows now (inView): the window was resized. Otherwise they
		 * keep the view their prompt came up in
		 * @returns {boolean} plaques are up (showButtons)
		 */
		relayButtons() {
			withinFor = null;
			if (buttonsArgs) { layButtons(...buttonsArgs); }
			return buttons.length > 0;
		},
		/**
		 * @description How many plaque buttons are up (showButtons)
		 * @returns {number}
		 */
		buttonCount() {
			return buttons.length;
		},
		/**
		 * @description The thin white-gold frame round one plaque, the keyboard's
		 * @param {number|null} index in showButtons' list, null for none
		 */
		focusButton(index) {
			buttons.forEach((b, i) => { b.ring.visible = i === index; });
			requestRender();
		},
		/**
		 * @description Brightens the brass of the plaque under the pointer, as a hovered hand card's face (hover)
		 * @param {string|null} id the button's id, null for none
		 */
		hoverButton(id) {
			hoveredButton = id;
			for (const b of buttons) { b.top.color.setHex(BRASS_MATERIAL.color).multiplyScalar(b.id === id ? PLAQUE_HOVER : 1); }
			requestRender();
		},
		/**
		 * @description A plaque pressed: it sinks about its own height and rises again (not under reduced motion)
		 * @param {string} id the button's id
		 */
		pressButton(id) {
			const b = buttons.find((x) => x.id === id);
			if (!b || still()) { return; }
			const token = ++b.token;
			animations.add({
				duration: PRESS_MS,
				update(k) {
					if (token === b.token) {
						const sink = PLAQUE_SINK * Math.sin(Math.PI * k);
						b.mesh.position.y = b.y - sink;
						// Its frame stays on the surface
						b.ring.position.y = RING_Y + sink;
					}
				},
				onEnd() {
					if (token === b.token) {
						b.mesh.position.y = b.y;
						b.ring.position.y = RING_Y;
					}
					requestRender();
				},
			});
		},
		/**
		 * @description Takes every card, plaque and the frame out of the room and frees what they own. The template's geometry is the
		 * room's to free
		 */
		dispose() {
			freeButtons();
			buttonsKey = "[]";
			buttonsAsked = withinFor = buttonsWithin = buttonsArgs = null;
			plaqueBrass.dispose();
			plaqueFocus.dispose();
			if (openPile || zoomId) { frameBox(null); }
			reader.remove();
			lifted = null;
			showPreview();
			for (const c of [...cards.values(), ...duelCards.values(), ...leaving]) {
				if (c.outline) { room.remove(c.outline); }
				free(c);
			}
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
