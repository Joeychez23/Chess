/* ---- Chess Cards table: the piles, the decks, the opened pile's column and the discard list read out, and the zoom
(createCardTable, index.js) ---- */

import { Vector3, Box3 } from "three";
import { CARD_SIZE, DECK, GREEN_DECK } from "../cardLayout.js";
import { STACK_STEP } from "./promotionCards.js";
import { DESK_Y } from "../constants.js";
import { faceOf } from "./cardFaces.js";
import { pileCards, columnBox, PILES, DISCARD } from "./tableLayout.js";

// A card's thickness (cards.js STACK_STEP) and a hair, so an overlapping card lies on the one under it
export const CARD_LAYER = STACK_STEP + 0.001;
// A lying card's base: just above the desk top
export const PILE_BASE_LIFT = 0.005;

// A baked deck, in the room's space: a card's footprint from the desk up to its top
function deckBox(d) {
	return new Box3(
		new Vector3(d.x - CARD_SIZE.w / 2, DESK_Y, d.z - CARD_SIZE.h / 2),
		new Vector3(d.x + CARD_SIZE.w / 2, d.y, d.z + CARD_SIZE.h / 2)
	);
}
export const DECK_BOXES = [deckBox(DECK), deckBox(GREEN_DECK)];
// The player's places a dragged card can be let go on
export const LANDINGS = { spot: PILES.mineSpot, passive: PILES.mine, discard: DISCARD.mine };
// What a screen reader hears of an opened pile
const PILE_NAMES = {
	mine: "Your passives",
	his: "Card Guy's passives",
	mineSpot: "Your actives in effect",
	hisSpot: "Card Guy's actives in effect",
	discard: "The last cards on the discard piles"
};

/**
 * @description The opened pile, the discard list and the zoom: what createCardTable's table (index.js) gets from this part
 * @param {object} table createCardTable's shared fields
 * @returns {object} the part's functions
 */
export function pilesPart(table) {
	// A pile's newest card. The discard list's keyboard stop is your discard pile's top card while it has one, else Card Guy's
	function pileTop(pile) {
		const tops = [...table.cards.values()].filter((c) => (c.spot.discard ? "discard" : c.spot.pile) === pile && c.spot.top);
		return tops.find((c) => c.spot.discard === "mine") || tops[0] || null;
	}

	function say(card) {
		if (card.down) { return "a face-down card"; }
		const face = faceOf(card, table.current.catalog);
		return `${face.name}, ${face.type}${face.text ? `: ${face.text}` : ""}`;
	}
	// The camera frames the opened pile's column (again when it grows or shrinks) or the zoomed hand card, and goes back when it is
	// neither. A refresh that changes nothing leaves the camera alone
	function frameOpen() {
		const z = table.zoomId && table.cards.get(`${table.current.view.you}:${table.zoomId}`);
		const list = table.openPile ? pileCards(table.current.view, table.openPile) : [];
		const box = table.openPile
			? columnBox(table.openPile, list.length)
			: z
				? { x0: z.spot.x - CARD_SIZE.w / 2, x1: z.spot.x + CARD_SIZE.w / 2, z0: z.spot.z - CARD_SIZE.h / 2, z1: z.spot.z + CARD_SIZE.h / 2 }
				: null;
		const key = JSON.stringify(box);
		// The discard list is newest first already, and says whose each card was
		const said = table.openPile === "discard"
			? list.map((card, i) => `${table.current.view.piled[i].player === table.current.view.you ? "yours" : "Card Guy's"}, ${say(card)}`)
			: list.slice().reverse().map(say);
		const text = table.openPile ? `${PILE_NAMES[table.openPile]}, newest first: ${said.join("; ")}` : "";
		if (table.reader.textContent !== text) { table.reader.textContent = text; }
		// While a placed card is dragged, the camera shows the way to the discard pile (follow)
		if (key === table.boxKey || (table.drag && table.drag.moved && table.drag.from === "pile")) { return; }
		table.boxKey = key;
		// zoomId: what is zoomed in on goes to flow.js too (three/index.js), where Escape and a play end it
		table.frameBox(box, table.zoomId);
	}

	return {
		pileTop, frameOpen,
		/**
		 * @description Opens a passive pile or an active spot into its column on the desk, or the discard list ("discard") beside the
		 * discard piles, and frames it, or closes the one open (the camera goes back). Either ends a zoom
		 * @param {string|null} pile a key of tableLayout.js PILES or "discard"; the one open, or null, closes it
		 */
		togglePile(pile) {
			if (!table.current.view) { return; }
			table.openPile = pile && pile !== table.openPile ? pile : null;
			table.zoomId = null;
			table.lay();
		},
		/**
		 * @description The camera glides in to frame one of the player's hand cards as it frames an opened pile (camera/index.js framePile),
		 * or back exactly where it was. It ends by itself when the card leaves the hand, a pile opens or closes, a duel is dealt or the
		 * card is dragged
		 * @param {string|null} id the hand card's id, null: the zoom ends
		 */
		zoom(id) {
			if (!table.current.view || table.openPile) { return; }
			table.zoomId = id;
			// Not one of the player's hand cards (or a duel is laid): lay ends it at once
			table.lay();
		},
		/**
		 * @description The hand card zoomed in on
		 * @returns {string|null}
		 */
		zoomed() {
			return table.zoomId;
		},
		/**
		 * @description The pile that is open
		 * @returns {string|null} a key of tableLayout.js PILES, or "discard"
		 */
		open() {
			return table.openPile;
		},
	};
}
