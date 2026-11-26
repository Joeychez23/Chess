/* ---- Chess Cards table: the card duel's deck, its way to and from the rows, its faces, and its deal, flips and end
(createCardTable, index.js) ---- */

import { CanvasTexture, SRGBColorSpace, MeshBasicMaterial, Mesh } from "three";
import { CARD_SIZE, GREEN_DECK, CARD_Y } from "../cardLayout.js";
import { lerp, CARD_LIGHT, FRAME_DROP, DEAL_MS, DEAL_STAGGER_MS, STACK_STEP, FACE_W, FACE_H } from "./promotionCards.js";
import { drawDuelFace } from "./cardFaces.js";
import { duelLayout, HAND_Z } from "./tableLayout.js";

// The duel cards' backs, as the baked green deck's
export const GREEN_BACK = 0x0E3B22;
// A duel card dealt from (and going back to) the green deck lies on its top, as the promotion cards do on the red one's (promotionCards.js)
const GREEN_TOP = GREEN_DECK.y;

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

// A card's own face: its canvas, texture and material. A face-down duel card gets one only when it flips (paintDuel), not 12
// blank ones per deal
export function giveFace(c) {
	c.canvas = document.createElement("canvas");
	c.canvas.width = FACE_W;
	c.canvas.height = FACE_H;
	c.texture = new CanvasTexture(c.canvas);
	c.texture.colorSpace = SRGBColorSpace;
	// As in promotionCards.js: the face quad's UVs run from the card's top edge at v = 0
	c.texture.flipY = false;
	c.faceMaterial = new MeshBasicMaterial({ map: c.texture, color: CARD_LIGHT });
	c.face.material = c.faceMaterial;
}

function paintDuel(c) {
	// Dealt face down: its face is made now
	if (!c.canvas) { giveFace(c); }
	const ctx = c.canvas.getContext("2d");
	ctx.clearRect(0, 0, FACE_W, FACE_H);
	drawDuelFace(ctx, c.duel.card, FACE_W, FACE_H);
	c.texture.needsUpdate = true;
}

/**
 * @description The card duel on the table: what createCardTable's table (index.js) gets from this part
 * @param {object} table createCardTable's shared fields
 * @returns {object} the part's functions
 */
export function duelPart(table) {
	/* ---- The card duel: its cards dealt from the green deck into the rows (tableLayout.js duelLayout), each face up once flipped,
	the won one framed in gold ---- */
	function outline(c) {
		if (c.outline) { return; }
		c.outline = new Mesh(table.frame.geometry, table.frameMaterial);
		c.outline.position.set(c.spot.x, c.spot.y - FRAME_DROP, c.spot.z);
		// Its card still on its way: the outline shows when the card lands (dealDuel)
		c.outline.visible = c.landed;
		table.room.add(c.outline);
	}

	function unoutline(c) {
		if (c.outline) {
			table.room.remove(c.outline);
			c.outline = null;
		}
	}

	// Turns a duel card over where it lies, on its long axis, rising so its edge clears the baize: face up, or face down again (a take-back)
	function turn(c, up) {
		c.spot.faceDown = !up;
		const token = ++c.liftToken;
		// place() lifts a face-down card by STACK_STEP: the turn starts at the height it lies at
		const sink = up ? STACK_STEP : -STACK_STEP;
		if (table.still()) {
			c.root.rotation.z = up ? 0 : Math.PI;
			c.lift = 0;
			table.place(c);
			return;
		}
		table.animations.add({
			duration: DEAL_MS,
			update(k) {
				if (token !== c.liftToken) { return; }
				c.root.rotation.z = up ? lerp(Math.PI, 0, k) : lerp(0, Math.PI, k);
				c.lift = sink * (1 - k) + FLIP_LIFT * Math.sin(Math.PI * k);
				table.place(c);
			},
			onEnd() { table.requestRender(); },
		});
	}

	// A duel card slides back to the green deck and is taken away there
	function sendBack(c) {
		unoutline(c);
		table.leaving.add(c);
		c.spot = { ...c.spot, x: GREEN_DECK.x, y: GREEN_TOP, z: GREEN_DECK.z };
		// leaving.size: this card's place among those flying back now
		table.moveTo(c, 0, () => {
			table.leaving.delete(c);
			table.free(c);
			table.requestRender();
		}, table.leaving.size * RETURN_RISE);
	}

	return {
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
			if (!table.current.view || !duel) { return; }
			const spades = Boolean(duel.spades);
			const redeal = Boolean(table.duelDeal && (table.duelDeal.round !== duel.round || table.duelDeal.player !== duel.player || table.duelDeal.piece !== duel.piece));
			if (redeal) {
				for (const c of table.duelCards.values()) { sendBack(c); }
				table.duelCards.clear();
			}
			const first = !table.duelDeal;
			const want = duelLayout(duel, table.current.view.you, table.current.view);
			const keys = new Set(want.map((d) => d.key));
			// flips: the set a flipDuel turns. A spades deal with no pick yet came in the same answer as the round's last flips, so those
			// still go to the round (one pick per answer: a spades flip comes after a view with a spades pick)
			table.duelDeal = {
				round: duel.round, player: duel.player, piece: duel.piece, spades,
				flips: spades && duel.spades.picked.w.length + duel.spades.picked.b.length ? "spades" : "round"
			};
			// The hands slide into their stacks
			if (first) { table.lay(); }
			for (const [key, c] of table.duelCards) {
				if (!keys.has(key)) {
					sendBack(c);
					table.duelCards.delete(key);
				}
			}
			let dealt = 0;
			for (const d of want) {
				let c = table.duelCards.get(d.key);
				if (c) {
					// Laid already: brought to what the view shows
					const was = c.duel.card;
					c.duel = d;
					if (d.card && !(was && was.r === d.card.r && was.s === d.card.s)) { paintDuel(c); }
					if (Boolean(d.card) !== Boolean(was)) { turn(c, Boolean(d.card)); }
				} else {
					// Face down: turned over, its green back on top, no face of its own yet
					c = table.make(!d.card, table.greenMaterial);
					Object.assign(c, {
						duel: d, outline: null, spot: { x: d.x, y: CARD_Y, z: d.z, faceDown: !d.card },
						at: { x: GREEN_DECK.x, y: GREEN_TOP, z: GREEN_DECK.z, yaw: 0 }
					});
					if (d.card) { paintDuel(c); }
					table.duelCards.set(d.key, c);
					// A new round's cards leave the deck once the old ones are back
					table.moveTo(c, (redeal ? DEAL_MS : 0) + (dealt++) * DEAL_STAGGER_MS, () => {
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
			table.placeFrame();
			table.requestRender();
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
			if (!table.duelDeal || !table.current.view) { return; }
			const side = player === table.current.view.you ? "mine" : "his";
			const set = table.duelDeal.flips;
			const row = [...table.duelCards.values()].filter((x) => x.duel.side === side && x.duel.set === set);
			const c = index === null || index === undefined
				? row.find((x) => x.duel.card && x.duel.card.r === card.r && x.duel.card.s === card.s) || row.find((x) => !x.duel.card)
				: table.duelCards.get(`${side}:${set}:${index}`);
			if (!c) { return; }
			// No longer pickable, before the answer's view says so
			if (!c.duel.card) {
				Object.assign(c.duel, { card, pickable: false });
				paintDuel(c);
				turn(c, true);
			}
			if (won) { outline(c); }
			table.placeFrame();
			table.requestRender();
		},
		/**
		 * @description The duel is over: its cards slide back to the green deck and go, and the hands slide back into their rows
		 */
		endDuel() {
			if (!table.duelDeal) { return; }
			for (const c of table.duelCards.values()) { sendBack(c); }
			table.duelCards.clear();
			table.duelDeal = null;
			if (table.current.view) { table.lay(); }
		},
	};
}
