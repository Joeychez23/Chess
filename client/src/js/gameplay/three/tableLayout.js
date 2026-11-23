/* ---- Chess Cards table: where every card of a view lies. Both hands & each player's three places: the active spot, the passive pile, the discard pile. No three.js, no DOM (client/test/tableLayout.test.js) ---- */

import { CARD_SIZE, DECK, CARD_Y } from "./cardLayout.js";
import { handCards } from "../cards/select.js";
import { PILE_AREA } from "./piles.js";

export const HAND_Z = 17.7; // THE PLAYER'S ROW ON THE NEAR GREEN (THE PROMOTION STRIP'S x, MIRRORED ONTO z), CARD GUY'S AT -HAND_Z. CLEAR OF THE BOARD'S FRAME (14.25)
const HAND_STEP = 4.6; // CENTRE TO CENTRE (TABLE UI DOC)
const HAND_FIT = 9; // THIS MANY LIE SIDE BY SIDE; MORE (UP TO 2 CURSES) OVERLAP SLIGHTLY IN THE SAME WIDTH
const PILE_CLEAR = 3.5; // EACH PLACE THIS FAR FROM THE DECKS' EDGE (A DECK SPANS z -3.36 .. 3 WITH ITS SLABS' OFFSETS)
const PEEK = 1.2; // AN OLDER CARD OF A SHUT PILE PEEKS OUT BY ITS NAME BAR; AN OPENED COLUMN'S CARDS NEVER OVERLAP MORE
const COLUMN_GAP = 0.3; // BETWEEN AN OPENED COLUMN'S WHOLE CARDS
const PILE_Z = { mine: 3 + PILE_CLEAR + CARD_SIZE.h / 2, his: -3.36 - PILE_CLEAR - CARD_SIZE.h / 2 }; // 9.5 & -9.86. THE NEWEST CARD'S CENTRE: YOURS BELOW THE DECKS, CARD GUY'S ABOVE
const HIS_PASSIVE_Z = PILE_AREA.z0 - 0.5 - CARD_SIZE.h / 2; // -22. CARD GUY'S PASSIVE PILE: JUST BEYOND THE TAKEN PIECES (piles.js PILE_AREA z -18.5 .. -5.5 AT THE DECK'S x), WHICH STOOD ON IT AT -9.86. ITS COLUMN OF 3 ENDS AT z -37.6 (THE DESK AT -40),
// 3.95 RIGHT OF THE LAMP'S FOOT, 1.8 LEFT OF HIS HAND ROW (TASK 20e D FIX ROUND 1, I3)
const PLACE_REACH = 0.5; // placeAt: THIS FAR ROUND A PLACE'S CARD STILL COUNTS
export const ASKEW = 0.3; // THE REMEMBERED MOVE CARD LIES TURNED THIS MUCH (RADIANS) ON THE DISCARD PILE

// THE PLACES THAT OPEN INTO A COLUMN: THE PASSIVE PILES ("mine": WHERE THE BOARD EFFECTS PILE WAS, "his": BEYOND THE TAKEN PIECES) & THE ACTIVE SPOTS, ON THE WOOD LEFT OF THEM. dir: TOWARD THE OWNER, end: WHERE THE COLUMN STOPS (THE DESK IS z -40 .. 32).
// CARD GUY'S ACTIVE SPOT IS 4.2 FARTHER LEFT THAN YOURS, CLEAR OF THE TAKEN PIECES (piles.js PILE_AREA x -31 .. -23), & ITS COLUMN STOPS SHORT OF THE LAMP'S FOOT (RADIUS 4.4 ROUND x -35, z -25).
// shortcut: 8 OR MORE ACTIVES IN EFFECT AT ONCE FOR CARD GUY RUN UNDER THE LAMP'S FOOT (PEEK IS THE LEAST OVERLAP), TURN THE COLUMN IF A CARD EVER ALLOWS THAT MANY
export const PILES = {
	mine: { side: "mine", place: "passive", x: DECK.x, z: PILE_Z.mine, dir: 1, end: 31.5 },
	his: { side: "his", place: "passive", x: DECK.x, z: HIS_PASSIVE_Z, dir: -1, end: -39.5 },
	mineSpot: { side: "mine", place: "spot", x: -29.4, z: PILE_Z.mine, dir: 1, end: 31.5 },
	hisSpot: { side: "his", place: "spot", x: -33.6, z: PILE_Z.his, dir: -1, end: -20 },
};
const DISCARD_X = 34; // ON THE GREEN DECK'S OUTER SIDE, CLEAR OF THE TAKEN PIECES (piles.js PILE_AREA MIRRORED: THEY REACH x 31): 31 + 0.85 (placeAt'S REACH & A GAP) + HALF A CARD (2.15). THE CARD ENDS AT x 36.15, THE DESK AT 48
export const DISCARD = { mine: { x: DISCARD_X, z: PILE_Z.mine }, his: { x: DISCARD_X, z: PILE_Z.his } }; // BY THE GREEN DECK (USER RULING 2026-11-22): YOURS NEARER YOU, CARD GUY'S FARTHER. EITHER OPENS THE DISCARD LIST (LOG), NOT A COLUMN
// THE OPENED DISCARD LIST (view.piled, TASK 21a): THE NEWEST CARD'S CENTRE, RIGHT OF THE DISCARD PILES, THEN 2 ACROSS & 3 DOWN TOWARD THE PLAYER, WHOLE CARDS, NEWEST FIRST IN READING ORDER. x 37.05 .. 45.95 (THE DESK AT 48), z -9.3 .. 9.3
// 0.6 FARTHER RIGHT THAN A CARD & A GAP: CLEAR OF THE ASKEW REMEMBERED CARD, WHOSE CORNER REACHES x 36.94 (FIX ROUND 1, M2)
const LOG = { x: DISCARD_X + CARD_SIZE.w + COLUMN_GAP + 0.6, z: -(CARD_SIZE.h + COLUMN_GAP), across: 2 };
const logSpot = (i) => ({ x: LOG.x + (i % LOG.across) * (CARD_SIZE.w + COLUMN_GAP), z: LOG.z + Math.floor(i / LOG.across) * (CARD_SIZE.h + COLUMN_GAP) }); // i 0: THE NEWEST
// THE CARD DUEL (TABLE UI DOC, "All or Nothing card duel"): BOTH HANDS STACKED AT THEIR ROW'S LEFT END (YOU AT THE BOTTOM, SO x -18.4 FOR BOTH ROWS: A FULL ROW'S FIRST CARD), THEN THE ROUND'S 3 CARDS,
// THEN THE SPADES SET, 4.6 APART AS THE HAND, 2.6 OF WOOD BETWEEN THE GROUPS. THE ROW SPANS x -20.55 .. 15.95: INSIDE TODAY'S FULL HAND (TO 20.55), CLEAR OF THE NEAR TAKEN PIECES (x 23)
const STACK_X = -((HAND_FIT - 1) / 2) * HAND_STEP;
const SET_GAP = 1.5 * HAND_STEP; // CENTRE TO CENTRE ACROSS THE GAP BETWEEN TWO GROUPS
export const DUEL_STACK = { mine: { x: STACK_X, z: HAND_Z }, his: { x: STACK_X, z: -HAND_Z } };

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
 * @description The cards of a place that opens, oldest first: the passives waiting (view.effects) or the actives in effect (the player's spot); the discard list's newest first (view.piled)
 * @param {object} view cards.view
 * @param {string} pile a key of PILES, or "discard"
 * @returns {object[]} the cards as the view has them; { down: true } is one the view hides
 */
export function pileCards(view, pile) {
	if (pile === "discard") { return (view.piled || []).map((e) => e.card); } // A VIEW FROM BEFORE THE LIST: NONE
	const p = PILES[pile], owner = p.side === "mine" ? view.you : view.you === "w" ? "b" : "w";
	if (p.place === "spot") { return ((view.players[owner] || {}).spot || []).filter(Boolean); }
	return (view.effects || []).filter((e) => e && e.owner === owner && e.card).map((e) => e.card);
}

/**
 * @description The desk an opened column of n cards covers, for the camera to frame (room space, unturned); the discard list's n cards ("discard") as LOG lays them
 * @param {string} pile a key of PILES, or "discard"
 * @param {number} n the cards in it
 * @returns {{ x0: number, x1: number, z0: number, z1: number }} its edges
 */
export function columnBox(pile, n) {
	if (pile === "discard") { const m = Math.max(n, 1), right = logSpot(Math.min(m, LOG.across) - 1), last = logSpot(m - 1); return { x0: LOG.x - CARD_SIZE.w / 2, x1: right.x + CARD_SIZE.w / 2, z0: LOG.z - CARD_SIZE.h / 2, z1: last.z + CARD_SIZE.h / 2 }; }
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
 * @description What a tap or press on the card lying at a spot of tableSpots reaches (cardTable.js hit)
 * @param {string} key the spot's key
 * @param {object} spot the spot
 * @returns {{ kind: "hand", id: string }|{ kind: "pile", pile: string, id: string|null }|null} pile: a key of PILES, or "discard" for either discard pile's cards & the opened list's (id null: it opens, nothing is dragged off it); null: nothing (Card Guy's hand)
 */
export function spotHit(key, spot) {
	if (spot.hand) { return { kind: "hand", id: key.slice(2) }; }
	if (spot.pile) { return { kind: "pile", pile: spot.pile, id: spot.card ? spot.card.id : null }; }
	return spot.discard || spot.log ? { kind: "pile", pile: "discard", id: null } : null;
}

/**
 * @description Where a duel card lies in its row (room space, unturned)
 * @param {"mine"|"his"} side the player's row or Card Guy's
 * @param {"round"|"spades"} set the round's deal or the spades deal beside it
 * @param {number} index 0..2, as the view's hands
 * @returns {{ x: number, z: number }}
 */
export function duelSpot(side, set, index) {
	return { x: STACK_X + SET_GAP + (set === "spades" ? 2 * HAND_STEP + SET_GAP : 0) + index * HAND_STEP, z: DUEL_STACK[side].z };
}

/**
 * @description Every duel card of a view's duel: the round's 3 per player, & the spades deal's beside them while it is up
 * @param {object} duel view.duel (not null)
 * @param {string} you the player's colour
 * @param {object} [view] the view the duel is of: its Grace bar (view.barred, on the player whose turn it is) leaves the barred pick out while another remains, as cards-engine/turn.js legalActions
 * @returns {{ key: string, side: "mine"|"his", set: "round"|"spades", index: number, card: { r: number, s: string }|null, won: boolean, pickable: boolean, x: number, z: number }[]} card: null while face down;
 * won: in step "decide", the duel's player's last flipped card of the current set (that round was won), or all 3 of their round cards when the suit score won it;
 * pickable: the player may pick it now, as the engine allows (cards-engine/duel.js actions): theirs, of the current set, face down, in step "pick", not picked yet, & the player not a pick ahead of the other
 */
export function duelLayout(duel, you, view = null) {
	const out = [], other = (c) => (c === "w" ? "b" : "w"), opp = other(duel.player);
	for (const [set, d] of [["round", duel], ["spades", duel.spades]]) {
		if (!d) { continue; }
		const current = !duel.spades || set === "spades", decided = current && duel.step === "decide", mine = d.picked[you];
		const suit = decided && d.picked[duel.player].length === 3 && d.hands[duel.player][d.picked[duel.player][2]].r === d.hands[opp][d.picked[opp][2]].r; // ALL 3 PICKS TIED: THE SUIT SCORE WON, SO ALL 3 CARDS DID (RULING M1)
		const ahead = mine.length > d.picked[other(you)].length; // WAITING FOR THE OTHER PICK
		for (const side of ["mine", "his"]) {
			const owner = side === "mine" ? you : other(you), last = d.picked[owner][d.picked[owner].length - 1];
			d.hands[owner].forEach((card, index) => out.push({
				key: `${side}:${set}:${index}`, side, set, index, card: card || null,
				won: Boolean(card) && decided && owner === duel.player && (suit || index === last),
				pickable: side === "mine" && current && duel.step === "pick" && !ahead && !mine.includes(index), // FACE DOWN THEN TOO: A CARD SHOWS ONCE BOTH HAVE PICKED AT ITS DEPTH
				...duelSpot(side, set, index),
			}));
		}
	}
	let bar = null;
	try { bar = view && typeof view.barred === "string" && view.board && view.board.turn === you ? JSON.parse(view.barred) : null; } catch { bar = null; }
	const picks = out.filter((d) => d.pickable);
	if (bar && bar.type === "duel" && picks.length > 1) { picks.filter((d) => d.index === bar.pick).forEach((d) => { d.pickable = false; }); } // GRACE TOOK THIS PICK BACK: NOT AGAIN WHILE ANOTHER REMAINS
	return out;
}

/**
 * @description Where a ray meets a level plane: the desk under the pointer, where a dragged card is dropped (the card itself floats higher, so nearer the camera)
 * @param {{ x: number, y: number, z: number }} origin the ray's start
 * @param {{ x: number, y: number, z: number }} dir its direction
 * @param {number} y the plane's height
 * @returns {{ x: number, z: number }|null} null when the ray never comes down (or up) to it
 */
export function deskPoint(origin, dir, y) {
	const t = (y - origin.y) / dir.y;
	return dir.y && t > 0 ? { x: origin.x + dir.x * t, z: origin.z + dir.z * t } : null;
}

/**
 * @description Where every card of the view lies: the player's hand, Card Guy's (face down, but the King card & the cards the player may see face up), & both players' active spot, passive pile & discard pile.
 * A card is keyed by its owner & id wherever it lies, so a played card is the same card on its way to its place; one the view hides has its place's key
 * @param {object} view cards.view
 * @param {{ open?: string|null, base: number, layer: number, stage?: object|null }} opts open: the opened pile (a key of PILES, or "discard": the discard list, view.piled, laid out at LOG), base: the desk's height for a lying card, layer: a card's thickness,
 * stage: { id, from: "hand" | "pile", place: "spot" | "passive" | "discard" }: the player's card that was dragged from there & let go on that place of theirs lies on it (staged: true), until the view moves it,
 * stacked: a card duel is laid, both hands lie stacked at DUEL_STACK
 * @returns {Map<string, object>} key -> { card (null: face down), x, y, z, yaw?, faceDown, barBottom, hand (the player's), pile (a key of PILES | null), discard ("mine" | "his", a discard pile's), color (the owner's: the glyph's colour),
 * top (a pile's newest, a discard pile's top card), thick (a discard pile's block: this many cards), log (a card of the opened discard list, keyed "log:<index>", color & barBottom: whose it was, card null: a back, painted face up), from (a new card slides in from: "deck", Card Guy's "hand", null: it's put there) }
 */
export function tableSpots(view, { open = null, base, layer, stage = null, stacked = false }) {
	const want = new Map(), you = view.you, opp = you === "w" ? "b" : "w";
	const key = (owner, card, place) => `${owner}:${card && !card.down && card.id !== undefined ? card.id : place}`;
	const row = (n, i) => (i - (n - 1) / 2) * (n > HAND_FIT ? (HAND_STEP * (HAND_FIT - 1)) / (n - 1) : HAND_STEP);
	const mine = handCards(view);
	mine.forEach((card, i) => want.set(key(you, card), { card, x: stacked ? STACK_X : row(mine.length, i), y: CARD_Y + i * layer, z: HAND_Z, faceDown: false, barBottom: false, hand: true, pile: null, color: you, from: "deck" }));
	const o = view.players[opp] || {}, hand = o.hand || { count: 0, shown: [] }, shown = hand.shown || [];
	const his = [...(o.king ? [{ id: "king", key: "king" }] : []), ...shown, ...Array.from({ length: Math.max(0, (hand.count || 0) - shown.length) }, () => null)];
	his.forEach((card, i) => want.set(key(opp, card, `#${i}`), { card, x: stacked ? STACK_X : -row(his.length, i), y: CARD_Y + i * layer, z: -HAND_Z, faceDown: !card, barBottom: false, hand: false, pile: null, color: opp, from: "deck" })); // HIS CARDS SHOW HIS PIECES
	for (const [pile, p] of Object.entries(PILES)) { // OLDEST FIRST, THE NEWEST ON TOP AT THE PLACE; THE OLDER ONES TOWARD THE OWNER, PEEKING OUT OR (OPENED) WHOLE
		const owner = p.side === "mine" ? you : opp, list = pileCards(view, pile), step = pile === open ? columnStep(list.length, Math.abs(p.end - p.z)) : PEEK;
		list.forEach((card, i) => want.set(key(owner, card, `${pile}${i}`), { card: card.down ? null : card, x: p.x, y: base + i * layer, z: p.z + p.dir * (list.length - 1 - i) * step, faceDown: Boolean(card.down), barBottom: p.side === "mine", hand: false, pile, color: owner, top: i === list.length - 1, from: p.side === "his" ? "hand" : null }));
	}
	for (const [side, d] of Object.entries(DISCARD)) {
		const owner = side === "mine" ? you : opp, pl = view.players[owner] || {}, top = (pl.pile && pl.pile.top) || null, n = (pl.pile && pl.pile.n) || 0;
		const under = top ? Math.max(n - 1, 0) : n, from = side === "his" ? "hand" : null;
		const lie = (card, y, more) => ({ card: card.down ? null : card, x: d.x, y, z: d.z, faceDown: Boolean(card.down), barBottom: false, hand: false, pile: null, discard: side, color: owner, from, ...more });
		if (under) { want.set(`${owner}:#under`, lie({ down: true }, base, { thick: under, from: null })); } // HOW THICK THE PILE IS: ONE BLOCK, THE CARDS UNDER THE TOP ONE
		if (top) { want.set(key(owner, top, `#top${n}`), lie(top, base + under * layer, { top: true })); } // A FACE-DOWN TOP IS KEYED BY THE COUNT: THE NEXT ONE IS A NEW CARD THAT SLIDES IN
		if (pl.kept) { want.set(key(owner, pl.kept, "#kept"), lie(pl.kept, base + (under + (top ? 1 : 0)) * layer, { yaw: ASKEW })); }
	}
	if (open === "discard") { pileCards(view, open).forEach((card, i) => want.set(`log:${i}`, { card: card.down ? null : card, ...logSpot(i), y: base, faceDown: false, barBottom: view.piled[i].player === you, hand: false, pile: null, log: true, color: view.piled[i].player, from: null })); } // A COPY OF EACH, KEYED BY ITS PLACE IN THE LIST: THE PILES' OWN CARDS STAY PUT.
	// ITS NAME BAR SAYS WHOSE IT WAS, AS ON THE PILES; A HIDDEN ONE (card null) LIES FACE UP, ITS FACE PAINTED AS ITS BACK WITH THAT BAR (cardTable.js paint): A TURNED-OVER CARD'S BACK HAS NONE (FIX ROUND 1, I1)
	const s = stage && want.get(`${you}:${stage.id}`);
	if (s && (stage.from === "hand" ? s.hand : Boolean(s.pile))) { // STILL WHERE IT WAS DRAGGED FROM: ONCE THE ANSWER MOVES IT, IT GOES TO ITS OWN PLACE
		const pile = stage.place === "spot" ? "mineSpot" : "mine", p = stage.place === "discard" ? DISCARD.mine : PILES[pile];
		const under = stage.place === "discard" ? (((view.players[you] || {}).pile || {}).n || 0) + 2 : pileCards(view, pile).length; // ON TOP OF WHAT LIES THERE (THE DISCARD PILE: ITS REMEMBERED CARD TOO)
		Object.assign(s, { x: p.x, y: base + under * layer, z: p.z, staged: true });
	}
	return want;
}
