/* ---- Chess Cards table: where every card of a view lies. Both hands & each player's three places: the active spot, the passive pile, the discard pile. No three.js, no DOM (client/test/tableLayout.test.js) ---- */

import { CARD_SIZE, DECK, CARD_Y } from "./cardLayout.js";
import { handCards } from "../cards/select.js";

export const HAND_Z = 17.7; // THE PLAYER'S ROW ON THE NEAR GREEN (THE PROMOTION STRIP'S x, MIRRORED ONTO z), CARD GUY'S AT -HAND_Z. CLEAR OF THE BOARD'S FRAME (14.25)
const HAND_STEP = 4.6; // CENTRE TO CENTRE (TABLE UI DOC)
const HAND_FIT = 9; // THIS MANY LIE SIDE BY SIDE; MORE (UP TO 2 CURSES) OVERLAP SLIGHTLY IN THE SAME WIDTH
const PILE_CLEAR = 3.5; // EACH PLACE THIS FAR FROM THE DECKS' EDGE (A DECK SPANS z -3.36 .. 3 WITH ITS SLABS' OFFSETS)
const PEEK = 1.2; // AN OLDER CARD OF A SHUT PILE PEEKS OUT BY ITS NAME BAR; AN OPENED COLUMN'S CARDS NEVER OVERLAP MORE
const COLUMN_GAP = 0.3; // BETWEEN AN OPENED COLUMN'S WHOLE CARDS
const PILE_Z = { mine: 3 + PILE_CLEAR + CARD_SIZE.h / 2, his: -3.36 - PILE_CLEAR - CARD_SIZE.h / 2 }; // 9.5 & -9.86. THE NEWEST CARD'S CENTRE: YOURS BELOW THE DECKS, CARD GUY'S ABOVE
const PLACE_REACH = 0.5; // placeAt: THIS FAR ROUND A PLACE'S CARD STILL COUNTS
export const ASKEW = 0.3; // THE REMEMBERED MOVE CARD LIES TURNED THIS MUCH (RADIANS) ON THE DISCARD PILE

// THE PLACES THAT OPEN INTO A COLUMN: THE PASSIVE PILES ("mine", "his": WHERE THE BOARD EFFECTS PILES WERE) & THE ACTIVE SPOTS, ON THE WOOD LEFT OF THEM. dir: TOWARD THE OWNER, end: WHERE THE COLUMN STOPS (THE DESK IS z -40 .. 32).
// CARD GUY'S ACTIVE SPOT IS 4.2 FARTHER LEFT THAN YOURS, CLEAR OF THE TAKEN PIECES (piles.js PILE_AREA x -31 .. -23), & ITS COLUMN STOPS SHORT OF THE LAMP'S FOOT (RADIUS 4.4 ROUND x -35, z -25).
// shortcut: 8 OR MORE ACTIVES IN EFFECT AT ONCE FOR CARD GUY RUN UNDER THE LAMP'S FOOT (PEEK IS THE LEAST OVERLAP), TURN THE COLUMN IF A CARD EVER ALLOWS THAT MANY
export const PILES = {
	mine: { side: "mine", place: "passive", x: DECK.x, z: PILE_Z.mine, dir: 1, end: 31.5 },
	his: { side: "his", place: "passive", x: DECK.x, z: PILE_Z.his, dir: -1, end: -39.5 },
	mineSpot: { side: "mine", place: "spot", x: -29.4, z: PILE_Z.mine, dir: 1, end: 31.5 },
	hisSpot: { side: "his", place: "spot", x: -33.6, z: PILE_Z.his, dir: -1, end: -20 },
};
export const DISCARD = { mine: { x: -DECK.x, z: PILE_Z.mine }, his: { x: -DECK.x, z: PILE_Z.his } }; // BY THE GREEN DECK (USER RULING 2026-11-22). NEVER OPENED

/**
 * @description How far apart an opened column's cards lie: whole cards while the column fits, else overlapping in the room there is, by no less than a name bar
 * @param {number} n the cards in the column
 * @param {number} room from the pile's centre to where the column must stop
 * @returns {number} centre to centre
 */
export function columnStep(n, room) {
	const whole = CARD_SIZE.h + COLUMN_GAP;
	return n < 2 || (n - 1) * whole + CARD_SIZE.h / 2 <= room ? whole : Math.max(PEEK, (room - CARD_SIZE.h / 2) / (n - 1));
}

/**
 * @description The cards of a place that opens, oldest first: the passives waiting (view.effects) or the actives in effect (the player's spot)
 * @param {object} view cards.view
 * @param {string} pile a key of PILES
 * @returns {object[]} the cards as the view has them; { down: true } is one the view hides
 */
export function pileCards(view, pile) {
	const p = PILES[pile], owner = p.side === "mine" ? view.you : view.you === "w" ? "b" : "w";
	if (p.place === "spot") { return ((view.players[owner] || {}).spot || []).filter(Boolean); }
	return (view.effects || []).filter((e) => e && e.owner === owner && e.card).map((e) => e.card);
}

/**
 * @description The desk an opened column of n cards covers, for the camera to frame (room space, unturned)
 * @param {string} pile a key of PILES
 * @param {number} n the cards in it
 * @returns {{ x0: number, x1: number, z0: number, z1: number }} its edges
 */
export function columnBox(pile, n) {
	const p = PILES[pile], far = p.z + p.dir * (Math.max(n, 1) - 1) * columnStep(n, Math.abs(p.end - p.z));
	return { x0: p.x - CARD_SIZE.w / 2, x1: p.x + CARD_SIZE.w / 2, z0: Math.min(p.z, far) - CARD_SIZE.h / 2, z1: Math.max(p.z, far) + CARD_SIZE.h / 2 };
}

/**
 * @description The place under a point of the desk (room space, unturned), holding a card or not: where a dragged card would be dropped
 * @param {number} x
 * @param {number} z
 * @returns {{ side: "mine"|"his", place: "spot"|"passive"|"discard" }|null}
 */
export function placeAt(x, z) {
	const on = (p) => Math.abs(x - p.x) <= CARD_SIZE.w / 2 + PLACE_REACH && Math.abs(z - p.z) <= CARD_SIZE.h / 2 + PLACE_REACH;
	const all = [...Object.values(PILES), ...Object.entries(DISCARD).map(([side, p]) => ({ side, place: "discard", ...p }))];
	const hit = all.filter(on).sort((a, b) => Math.abs(x - a.x) - Math.abs(x - b.x))[0]; // THE SPOT & THE PASSIVE PILE ARE 0.6 APART: THE NEARER ONE
	return hit ? { side: hit.side, place: hit.place } : null;
}

/**
 * @description Where every card of the view lies: the player's hand, Card Guy's (face down, but the King card & the cards the player may see face up), & both players' active spot, passive pile & discard pile.
 * A card is keyed by its owner & id wherever it lies, so a played card is the same card on its way to its place; one the view hides has its place's key
 * @param {object} view cards.view
 * @param {{ open?: string|null, base: number, layer: number }} opts open: the opened pile (a key of PILES), base: the desk's height for a lying card, layer: a card's thickness
 * @returns {Map<string, object>} key -> { card (null: face down), x, y, z, yaw?, faceDown, barBottom, hand (the player's), pile (a key of PILES | null), discard ("mine" | "his", a discard pile's), color (the owner's: the glyph's colour),
 * top (a pile's newest), thick (a discard pile's block: this many cards), from (a new card slides in from: "deck", Card Guy's "hand", null: it's put there) }
 */
export function tableSpots(view, { open = null, base, layer }) {
	const want = new Map(), you = view.you, opp = you === "w" ? "b" : "w";
	const key = (owner, card, place) => `${owner}:${card && !card.down && card.id !== undefined ? card.id : place}`;
	const row = (n, i) => (i - (n - 1) / 2) * (n > HAND_FIT ? (HAND_STEP * (HAND_FIT - 1)) / (n - 1) : HAND_STEP);
	const mine = handCards(view);
	mine.forEach((card, i) => want.set(key(you, card), { card, x: row(mine.length, i), y: CARD_Y + i * layer, z: HAND_Z, faceDown: false, barBottom: false, hand: true, pile: null, color: you, from: "deck" }));
	const o = view.players[opp] || {}, hand = o.hand || { count: 0, shown: [] }, shown = hand.shown || [];
	const his = [...(o.king ? [{ id: "king", key: "king" }] : []), ...shown, ...Array.from({ length: Math.max(0, (hand.count || 0) - shown.length) }, () => null)];
	his.forEach((card, i) => want.set(key(opp, card, `#${i}`), { card, x: -row(his.length, i), y: CARD_Y + i * layer, z: -HAND_Z, faceDown: !card, barBottom: false, hand: false, pile: null, color: opp, from: "deck" })); // HIS CARDS SHOW HIS PIECES
	for (const [pile, p] of Object.entries(PILES)) { // OLDEST FIRST, THE NEWEST ON TOP AT THE PLACE; THE OLDER ONES TOWARD THE OWNER, PEEKING OUT OR (OPENED) WHOLE
		const owner = p.side === "mine" ? you : opp, list = pileCards(view, pile), step = pile === open ? columnStep(list.length, Math.abs(p.end - p.z)) : PEEK;
		list.forEach((card, i) => want.set(key(owner, card, `${pile}${i}`), { card: card.down ? null : card, x: p.x, y: base + i * layer, z: p.z + p.dir * (list.length - 1 - i) * step, faceDown: Boolean(card.down), barBottom: p.side === "mine", hand: false, pile, color: owner, top: i === list.length - 1, from: p.side === "his" ? "hand" : null }));
	}
	for (const [side, d] of Object.entries(DISCARD)) {
		const owner = side === "mine" ? you : opp, pl = view.players[owner] || {}, top = (pl.pile && pl.pile.top) || null, n = (pl.pile && pl.pile.n) || 0;
		const under = top ? Math.max(n - 1, 0) : n, from = side === "his" ? "hand" : null;
		const lie = (card, y, more) => ({ card: card.down ? null : card, x: d.x, y, z: d.z, faceDown: Boolean(card.down), barBottom: false, hand: false, pile: null, discard: side, color: owner, from, ...more });
		if (under) { want.set(`${owner}:#under`, lie({ down: true }, base, { thick: under, from: null })); } // HOW THICK THE PILE IS: ONE BLOCK, THE CARDS UNDER THE TOP ONE
		if (top) { want.set(key(owner, top, `#top${n}`), lie(top, base + under * layer)); } // A FACE-DOWN TOP IS KEYED BY THE COUNT: THE NEXT ONE IS A NEW CARD THAT SLIDES IN
		if (pl.kept) { want.set(key(owner, pl.kept, "#kept"), lie(pl.kept, base + (under + (top ? 1 : 0)) * layer, { yaw: ASKEW })); }
	}
	return want;
}
