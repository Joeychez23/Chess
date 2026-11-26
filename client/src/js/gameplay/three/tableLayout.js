/* ---- Chess Cards table: where every card of a view lies. Both hands and each player's three places: the active spot, the passive
pile, the discard pile. No three.js and no DOM, so client/test/tableLayout.test.js can run it in node ---- */

import { CARD_SIZE, DECK, GREEN_DECK, CARD_Y } from "./cardLayout.js";
import { handCards } from "../cards/select.js";
import { PILE_AREA } from "./piles.js";

// The player's hand row on the near green (the promotion strip's x, mirrored onto z); Card Guy's lies at -HAND_Z.
// Clear of the board's frame (14.25)
export const HAND_Z = 17.7;
// Hand cards, centre to centre (table UI doc)
const HAND_STEP = 4.6;
// This many hand cards lie side by side; more (up to 2 curses) overlap slightly in the same width
const HAND_FIT = 9;
// Each place lies this far from the decks' edge (a deck spans z -3.36 .. 3 with its slabs' offsets)
const PILE_CLEAR = 3.5;
// An older card of a shut pile peeks out by its name bar; an opened column's cards never overlap more than this
const PEEK_OFFSET = 1.2;
// Between an opened column's whole cards
const COLUMN_GAP = 0.3;
// The newest card's centre (9.5 and -9.86): yours below the decks, Card Guy's above
const PILE_Z = { mine: 3 + PILE_CLEAR + CARD_SIZE.h / 2, his: -3.36 - PILE_CLEAR - CARD_SIZE.h / 2 };
// Card Guy's passive pile (z -22): just beyond the taken pieces (piles.js PILE_AREA, z -18.5 .. -5.5 at the deck's x), which stood
// on it at -9.86. Its column of 3 ends at z -37.6 (the desk ends at -40), 3.95 right of the lamp's foot and 1.8 left of his hand row
const HIS_PASSIVE_Z = PILE_AREA.z0 - 0.5 - CARD_SIZE.h / 2;
// placeAt: a place still counts this far round its card
const PLACE_REACH = 0.5;
// The remembered move card lies turned this much (radians) on the discard pile
export const ASKEW = 0.3;

// The places that open into a column: the passive piles ("mine" where the Board Effects pile was, "his" beyond the taken pieces)
// and the active spots, on the wood left of them. dir: toward the owner; end: where the column stops (the desk is z -40 .. 32).
// Card Guy's active spot is 4.2 farther left than yours, clear of the taken pieces (piles.js PILE_AREA, x -31 .. -23), and its
// column stops short of the lamp's foot (radius 4.4 round x -35, z -25).
// shortcut: 8 or more actives in effect at once for Card Guy run under the lamp's foot (PEEK_OFFSET is the least overlap); turn
// the column if a card ever allows that many
export const PILES = {
	mine: { side: "mine", place: "passive", x: DECK.x, z: PILE_Z.mine, dir: 1, end: 31.5 },
	his: { side: "his", place: "passive", x: DECK.x, z: HIS_PASSIVE_Z, dir: -1, end: -39.5 },
	mineSpot: { side: "mine", place: "spot", x: -29.4, z: PILE_Z.mine, dir: 1, end: 31.5 },
	hisSpot: { side: "his", place: "spot", x: -33.6, z: PILE_Z.his, dir: -1, end: -20 },
};
// On the green deck's outer side, clear of the taken pieces (piles.js PILE_AREA mirrored reaches x 31): 31, plus 0.85 (placeAt's
// reach and a gap), plus half a card (2.15). The card ends at x 36.15; the desk at 48
const DISCARD_X = 34;
// By the green deck, as the owner asked (2026-11-22): yours nearer you, Card Guy's farther. Either opens the discard list, not a column
export const DISCARD = { mine: { x: DISCARD_X, z: PILE_Z.mine }, his: { x: DISCARD_X, z: PILE_Z.his } };
// The opened discard list (view.piled): the newest card's centre, right of the discard piles, then 2 across and 3 down toward the
// player, whole cards, newest first in reading order. It spans x 37.05 .. 45.95 (the desk ends at 48) and z -9.3 .. 9.3.
// It sits 0.6 farther right than a card and a gap, to clear the askew remembered card, whose corner reaches x 36.94
const LOG_LAYOUT = { x: DISCARD_X + CARD_SIZE.w + COLUMN_GAP + 0.6, z: -(CARD_SIZE.h + COLUMN_GAP), across: 2 };

// Where the discard list's card i lies; i 0 is the newest
function logSpot(i) {
	return {
		x: LOG_LAYOUT.x + (i % LOG_LAYOUT.across) * (CARD_SIZE.w + COLUMN_GAP),
		z: LOG_LAYOUT.z + Math.floor(i / LOG_LAYOUT.across) * (CARD_SIZE.h + COLUMN_GAP)
	};
}

// The card duel (table UI doc, "All or Nothing card duel"): both hands stacked at their row's left end (yours at the bottom, so
// x -18.4 for both rows: a full row's first card), then the round's 3 cards, then the spades set, 4.6 apart as the hand, with 2.6
// of wood between the groups. The row spans x -20.55 .. 15.95: inside today's full hand (to 20.55), clear of the near taken pieces (x 23)
const STACK_X = -((HAND_FIT - 1) / 2) * HAND_STEP;
// Centre to centre across the gap between two groups
const SET_GAP = 1.5 * HAND_STEP;
export const DUEL_STACK = { mine: { x: STACK_X, z: HAND_Z }, his: { x: STACK_X, z: -HAND_Z } };

/**
 * @description How far apart an opened column's cards lie: whole cards while the column fits, else overlapping in the room there is,
 * by no less than a name bar
 * @param {number} n the cards in the column
 * @param {number} room from the pile's centre to where the column must stop
 * @returns {number} centre to centre
 */
export function columnStep(n, room) {
	const whole = CARD_SIZE.h + COLUMN_GAP;
	return n < 2 || (n - 1) * whole + CARD_SIZE.h / 2 <= room ? whole : Math.max(PEEK_OFFSET, (room - CARD_SIZE.h / 2) / (n - 1));
}

/**
 * @description The cards of a place that opens, oldest first: the passives waiting (view.effects) or the actives in effect (the
 * player's spot); the discard list's newest first (view.piled)
 * @param {object} view cards.view
 * @param {string} pile a key of PILES, or "discard"
 * @returns {object[]} the cards as the view has them; { down: true } is one the view hides
 */
export function pileCards(view, pile) {
	// A view from before the discard list has none
	if (pile === "discard") { return (view.piled || []).map((e) => e.card); }
	const p = PILES[pile];
	const owner = p.side === "mine" ? view.you : view.you === "w" ? "b" : "w";
	if (p.place === "spot") { return ((view.players[owner] || {}).spot || []).filter(Boolean); }
	return (view.effects || []).filter((e) => e && e.owner === owner && e.card).map((e) => e.card);
}

/**
 * @description The desk an opened column of n cards covers, for the camera to frame (room space, unturned); for the discard list's
 * n cards ("discard"), as LOG_LAYOUT lays them
 * @param {string} pile a key of PILES, or "discard"
 * @param {number} n the cards in it
 * @returns {{ x0: number, x1: number, z0: number, z1: number }} its edges
 */
export function columnBox(pile, n) {
	if (pile === "discard") {
		const count = Math.max(n, 1);
		const right = logSpot(Math.min(count, LOG_LAYOUT.across) - 1);
		const last = logSpot(count - 1);
		return {
			x0: LOG_LAYOUT.x - CARD_SIZE.w / 2,
			x1: right.x + CARD_SIZE.w / 2,
			z0: LOG_LAYOUT.z - CARD_SIZE.h / 2,
			z1: last.z + CARD_SIZE.h / 2
		};
	}
	const p = PILES[pile];
	const far = p.z + p.dir * (Math.max(n, 1) - 1) * columnStep(n, Math.abs(p.end - p.z));
	return {
		x0: p.x - CARD_SIZE.w / 2,
		x1: p.x + CARD_SIZE.w / 2,
		z0: Math.min(p.z, far) - CARD_SIZE.h / 2,
		z1: Math.max(p.z, far) + CARD_SIZE.h / 2
	};
}

/**
 * @description The place under a point of the desk (room space, unturned), holding a card or not: where a dragged card would be dropped
 * @param {number} x
 * @param {number} z
 * @returns {{ side: "mine"|"his", place: "spot"|"passive"|"discard" }|null}
 */
export function placeAt(x, z) {
	function on(p) {
		return Math.abs(x - p.x) <= CARD_SIZE.w / 2 + PLACE_REACH && Math.abs(z - p.z) <= CARD_SIZE.h / 2 + PLACE_REACH;
	}
	const all = [...Object.values(PILES), ...Object.entries(DISCARD).map(([side, p]) => ({ side, place: "discard", ...p }))];
	// The active spot and the passive pile are 0.6 apart: the nearer one wins
	const hit = all.filter(on).sort((a, b) => Math.abs(x - a.x) - Math.abs(x - b.x))[0];
	return hit ? { side: hit.side, place: hit.place } : null;
}

/**
 * @description What a tap or press on the card lying at a spot of tableSpots reaches (cardTable.js hit)
 * @param {string} key the spot's key
 * @param {object} spot the spot
 * @returns {{ kind: "hand", id: string }|{ kind: "pile", pile: string, id: string|null }|null} pile: a key of PILES, or "discard" for
 * either discard pile's cards and the opened list's (id null: it opens, nothing is dragged off it); null: nothing (Card Guy's hand)
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
 * @description Every duel card of a view's duel: the round's 3 per player, and the spades deal's beside them while it is up
 * @param {object} duel view.duel (not null)
 * @param {string} you the player's colour
 * @param {object} [view] the view the duel is of: its Grace bar (view.barred, on the player whose turn it is) leaves the barred pick
 * out while another remains, as cards-engine/turn.js legalActions
 * @returns {{ key: string, side: "mine"|"his", set: "round"|"spades", index: number, card: { r: number, s: string }|null, won: boolean,
 * pickable: boolean, x: number, z: number }[]} card: null while face down;
 * won: in step "decide", the duel's player's last flipped card of the current set (that round was won), or all 3 of their round
 * cards when the suit score won it;
 * pickable: the player may pick it now, as the engine allows (cards-engine/duel.js actions): theirs, of the current set, face down,
 * in step "pick", not picked yet, and the player not a pick ahead of the other
 */
export function duelLayout(duel, you, view = null) {
	const out = [];
	function other(c) {
		return c === "w" ? "b" : "w";
	}
	const opp = other(duel.player);
	for (const [set, deal] of [["round", duel], ["spades", duel.spades]]) {
		if (!deal) { continue; }
		const current = !duel.spades || set === "spades";
		const decided = current && duel.step === "decide";
		const mine = deal.picked[you];
		// All 3 picks tied: the suit score won, so all 3 cards did
		const suit = decided
			&& deal.picked[duel.player].length === 3
			&& deal.hands[duel.player][deal.picked[duel.player][2]].r === deal.hands[opp][deal.picked[opp][2]].r;
		// Waiting for the other player's pick
		const ahead = mine.length > deal.picked[other(you)].length;
		for (const side of ["mine", "his"]) {
			const owner = side === "mine" ? you : other(you);
			const last = deal.picked[owner][deal.picked[owner].length - 1];
			deal.hands[owner].forEach((card, index) => out.push({
				key: `${side}:${set}:${index}`, side, set, index, card: card || null,
				won: Boolean(card) && decided && owner === duel.player && (suit || index === last),
				// Face down then too: a card shows once both players have picked at its depth
				pickable: side === "mine" && current && duel.step === "pick" && !ahead && !mine.includes(index),
				...duelSpot(side, set, index),
			}));
		}
	}
	let bar = null;
	try {
		bar = view && typeof view.barred === "string" && view.board && view.board.turn === you ? JSON.parse(view.barred) : null;
	} catch {
		bar = null;
	}
	const picks = out.filter((d) => d.pickable);
	// Grace took this pick back: not again while another remains
	if (bar && bar.type === "duel" && picks.length > 1) {
		picks.filter((d) => d.index === bar.pick).forEach((d) => { d.pickable = false; });
	}
	return out;
}

/**
 * @description Where a ray meets a level plane: the desk under the pointer, where a dragged card is dropped (the card itself floats
 * higher, so nearer the camera)
 * @param {{ x: number, y: number, z: number }} origin the ray's start
 * @param {{ x: number, y: number, z: number }} dir its direction
 * @param {number} y the plane's height
 * @returns {{ x: number, z: number }|null} null when the ray never comes down (or up) to it
 */
export function deskPoint(origin, dir, y) {
	const t = (y - origin.y) / dir.y;
	return dir.y && t > 0 ? { x: origin.x + dir.x * t, z: origin.z + dir.z * t } : null;
}

/* ---- The brass plaque buttons on the baize (table UI doc, "3D buttons on the table"; cardTable.js showButtons) ---- */
// The board's frame (board.js: BOARD_SIZE / 2 plus a border of 0.75 squares of 3). Written out here because constants.js imports
// three and this file must not
const FRAME_EDGE = 14.25;
export const BOARD_RECT = { x0: -FRAME_EDGE, x1: FRAME_EDGE, z0: -FRAME_EDGE, z1: FRAME_EDGE };
// The engraving's font size (its em; Georgia's capitals are about 0.69 of it, so about 0.41 tall), on every plaque, one line or two
export const PLAQUE_TEXT = 0.6;
// A line of text, centre to centre
export const PLAQUE_LINE = 0.85;
// A capital's width and its letter spacing.
// shortcut: an estimate for Georgia bold capitals, not measured; measure the text if a label ever overruns its plaque
const PLAQUE_CHAR = 0.48;
// Brass round the text, on each side
const PLAQUE_PAD = { x: 0.55, z: 0.4 };
// The narrowest plaque (the mockup's min-width)
const PLAQUE_MIN = 3.6;
// A longer label goes to two lines on a wider plaque, never to smaller text
const PLAQUE_MAX_CHARS = 12;
// Between two plaques
const PLAQUE_GAP = 0.4;
// Between a plaque and what it must not cover
const PLAQUE_CLEAR = 0.3;
// A covered row moves this far at a time along its side, as far as the desk goes; also the grid of the nearest-spot search
const PLAQUE_SHIFT = 0.25;
// The asked side stands if its clear spot is this close to the anchor (its nearest plaque edge); farther, the plaques go to the
// nearest clear spot anywhere
const PLAQUE_NEAR = 6;
// Where a plaque may lie: build_library.py DESK (x -48 .. 48, y -32 .. 40; z = -y) less its edge's 0.35 bevel and a little
const DESK_TOP = { x0: -47.6, x1: 47.6, z0: -39.6, z1: 31.6 };

// A baked deck: a card's footprint and its slabs' turns and offsets (build_library.py build_cards)
function deckRect(d) {
	return { x0: d.x - 2.36, x1: d.x + 2.36, z0: d.z - 3.36, z1: d.z + 3.36 };
}

// The three books stacked askew round (35, y 21) (build_library.py build_props): the biggest, 16 x 11 turned 0.1 rad, reaches 8.51
// and 6.27 from that point
const BOOKS_BOUNDS = { x0: 26.4, x1: 43.6, z0: -27.3, z1: -14.7 };
// What else stands on the desk beside the baize (room space, unturned): the taken pieces' two piles (piles.js PILE_AREA and its 180°
// turn: whichever side plays, one pile is in each), both decks and the books, and, since the nearest-spot search reaches them, the
// monitor (MON_W 17 wide, its front at MON_Y 22.5, 13.6 deep) and the lamp's foot (radius 4.4 at LAMP (-35, 25)).
// The jack plate, plugs and cables have left the room, so they are not listed.
// The monitor's z0 is the desk's back; its tilted cabinet reaches about -37.3
const MONITOR = { x0: -8.5, x1: 8.5, z0: -39.6, z1: -22.5 };
const LAMP_FOOT = { x0: -39.4, x1: -30.6, z0: -29.4, z1: -20.6 };
export const DESK_AVOID = [
	PILE_AREA,
	{ x0: -PILE_AREA.x1, x1: -PILE_AREA.x0, z0: -PILE_AREA.z1, z1: -PILE_AREA.z0 },
	deckRect(DECK),
	deckRect(GREEN_DECK),
	BOOKS_BOUNDS,
	MONITOR,
	LAMP_FOOT
];

// A label in capitals: one line, or two split at the space nearest its middle
function plaqueLines(label) {
	const text = String(label).toUpperCase();
	const spaces = [...text].map((ch, i) => (ch === " " ? i : -1)).filter((i) => i > 0);
	if (text.length <= PLAQUE_MAX_CHARS || !spaces.length) { return [text]; }
	const at = spaces.sort((a, b) => Math.abs(a - text.length / 2) - Math.abs(b - text.length / 2))[0];
	return [text.slice(0, at), text.slice(at + 1)];
}

/**
 * @description Where the plaque buttons lie: in order, in a column beside the anchor ("left" | "right") or a row under it toward the
 * player ("below"), each sized to its label. A row that would cover anything in avoid (a card, the board, DESK_AVOID) moves on along
 * its side, a little at a time, until it covers nothing, never off the desk. If that spot is more than PLAQUE_NEAR from the anchor,
 * or there is none, the same row or column lies at the clear spot on the desk nearest the anchor. If there is none anywhere, it lies
 * at the asked side's last try on the desk, and the array is marked blocked.
 * Given within (the desk the camera shows), the desk is only that much of it: a row or column slides along itself to lie inside it,
 * and one longer than it wraps into more rows (columns), as many plaques to each as fit, down to one each
 * @param {{ id: string, label: string }[]} list the buttons
 * @param {{ x: number, z: number, side: "left"|"right"|"below" }} anchor a desk point (room space, unturned) and the side the plaques go on
 * @param {{ x0: number, x1: number, z0: number, z1: number }[]} avoid what no plaque may cover: BOARD_RECT, DESK_AVOID and the
 * cards' footprints
 * @param {{ x0: number, x1: number, z0: number, z1: number }|null} [within] the part of the desk on screen (cardTable.js deskInView),
 * room space; null: the whole desk
 * @returns {{ id: string, label: string, lines: string[], x: number, z: number, w: number, d: number }[]} each plaque's centre, width (x)
 * and depth (z); blocked: true on the array when they cover something
 */
export function buttonLayout(list, anchor, avoid, within = null) {
	const sized = list.map(({ id, label }) => {
		const lines = plaqueLines(label);
		return {
			id, label, lines,
			w: Math.max(PLAQUE_MIN, Math.max(...lines.map((l) => l.length)) * PLAQUE_CHAR + 2 * PLAQUE_PAD.x),
			d: lines.length * PLAQUE_LINE + 2 * PLAQUE_PAD.z
		};
	});
	const seen = within && {
		x0: Math.max(DESK_TOP.x0, within.x0),
		x1: Math.min(DESK_TOP.x1, within.x1),
		z0: Math.max(DESK_TOP.z0, within.z0),
		z1: Math.min(DESK_TOP.z1, within.z1)
	};
	// A view off the desk (looking at the monitor) gets the whole desk
	const area = seen && seen.x0 < seen.x1 && seen.z0 < seen.z1 ? seen : DESK_TOP;

	// The plaques laid on a side, pushed this far along it
	function lay(side, push) {
		const across = side === "below";
		const dir = side === "left" ? -1 : 1;
		const [k, lo, hi] = across ? ["w", area.x0, area.x1] : ["d", area.z0, area.z1];
		// Each row: its plaques and length. Only one row, unless within is a view narrower than it
		const rows = [];
		for (const p of sized) {
			const row = rows[rows.length - 1];
			if (row && (area === DESK_TOP || row.len + PLAQUE_GAP + p[k] <= hi - lo)) {
				row.items.push(p);
				row.len += PLAQUE_GAP + p[k];
			} else {
				rows.push({ items: [p], len: p[k] });
			}
		}
		// From the anchor to this row's near edge
		let out = PLAQUE_CLEAR + push;
		return rows.flatMap(({ items, len }) => {
			const thick = Math.max(...items.map((p) => (across ? p.d : p.w)));
			const mid = out + thick / 2;
			let at = (across ? anchor.x : anchor.z) - len / 2;
			// Slid inside the view
			if (area !== DESK_TOP) { at = Math.max(lo, Math.min(at, hi - len)); }
			out += thick + PLAQUE_GAP;
			return items.map((p) => {
				const size = p[k];
				const centre = at + size / 2;
				at += size + PLAQUE_GAP;
				return across ? { ...p, x: centre, z: anchor.z + mid } : { ...p, x: anchor.x + dir * mid, z: centre };
			});
		});
	}
	// Whether plaque p, moved by dx and dz, covers anything in avoid
	function covers(p, dx = 0, dz = 0) {
		return avoid.some((r) => p.x + dx - p.w / 2 - PLAQUE_CLEAR < r.x1
			&& r.x0 < p.x + dx + p.w / 2 + PLAQUE_CLEAR
			&& p.z + dz - p.d / 2 - PLAQUE_CLEAR < r.z1
			&& r.z0 < p.z + dz + p.d / 2 + PLAQUE_CLEAR);
	}
	function onDesk(laid) {
		return laid.every((p) => area.x0 <= p.x - p.w / 2 && p.x + p.w / 2 <= area.x1 && area.z0 <= p.z - p.d / 2 && p.z + p.d / 2 <= area.z1);
	}
	// From the anchor to the nearest plaque's edge, with laid moved by dx and dz
	function gap(laid, dx = 0, dz = 0) {
		return Math.sqrt(laid.reduce((m, p) => Math.min(
			m,
			Math.max(Math.abs(p.x + dx - anchor.x) - p.w / 2, 0) ** 2 + Math.max(Math.abs(p.z + dz - anchor.z) - p.d / 2, 0) ** 2
		), Infinity));
	}

	let last = lay(anchor.side, 0);
	// Once pushed off the desk, a row never comes back onto it
	for (let i = 0, laid; onDesk((laid = lay(anchor.side, i * PLAQUE_SHIFT))); i++) {
		if (!laid.some((p) => covers(p))) {
			if (gap(laid) <= PLAQUE_NEAR) { return laid; }
			break;
		}
		last = laid;
	}
	// Else the asked shape slides on the desk in both axes, searching a PLAQUE_SHIFT grid outward in square rings: the clear spot
	// nearest the anchor wins, ties going to the least slid. Ring r is at least r * PLAQUE_SHIFT - reach from the anchor, so the
	// search stops once that passes the best gap.
	// shortcut: grid-exact, not continuous (a spot up to 0.25 nearer can be missed), and about 2 ms a layout, up to 10 for 4 long
	// plaques mid-board (node, warm); showButtons lays out only when its ask changes (cardTable.js buttonsAsked)
	const base = lay(anchor.side, 0);
	function span(k, lo, hi) {
		return [
			Math.ceil((area[k + "0"] - Math.min(...base.map(lo))) / PLAQUE_SHIFT),
			Math.floor((area[k + "1"] - Math.max(...base.map(hi))) / PLAQUE_SHIFT)
		];
	}
	const [i0, i1] = span("x", (p) => p.x - p.w / 2, (p) => p.x + p.w / 2);
	const [j0, j1] = span("z", (p) => p.z - p.d / 2, (p) => p.z + p.d / 2);
	const reach = Math.max(...base.map((p) => Math.max(Math.abs(p.x - anchor.x) + p.w / 2, Math.abs(p.z - anchor.z) + p.d / 2)));
	const rings = Math.max(-i0, i1, -j0, j1);
	let best = null;
	for (let r = 0; r <= rings && !(best && r * PLAQUE_SHIFT - reach > best.g); r++) {
		for (let i = Math.max(-r, i0); i <= Math.min(r, i1); i++) {
			// The ring's cells: all of its left and right edges, and the top and bottom ones between
			for (let j = -r; j <= r; j += Math.abs(i) === r ? 1 : 2 * r) {
				if (j < j0 || j > j1) { continue; }
				const dx = i * PLAQUE_SHIFT;
				const dz = j * PLAQUE_SHIFT;
				const g = gap(base, dx, dz);
				const slid = Math.abs(i) + Math.abs(j);
				if (best && (g > best.g + 1e-9 || (g > best.g - 1e-9 && slid >= best.slid))) { continue; }
				if (!base.some((p) => covers(p, dx, dz))) { best = { g, slid, dx, dz }; }
			}
		}
	}
	if (best) { return base.map((p) => ({ ...p, x: p.x + best.dx, z: p.z + best.dz })); }
	// No clear place on the desk: the asked side's last try, and showButtons says so once
	return Object.assign(last, { blocked: true });
}

/**
 * @description A prompt's plaques' anchor (for showButtons), from what select.js plaquePrompt says they are by: a square's row on the
 * board frame's nearer side edge (the plaques can't lie on the board), the right end of the player's duel cards, or under the near
 * edge of the player's hand card
 * @param {{ square: string }|{ duel: true }|{ card: string }} at plaquePrompt's
 * @param {object} view cards.view
 * @param {boolean} turned the room is turned half round: the player looks from Black's side (camera.js sideAngle)
 * @returns {{ x: number, z: number, side: "left"|"right"|"below" }} room space, unturned
 */
export function plaqueAnchor(at, view, turned) {
	if (at.square) {
		// As three/index.js center(fileOf) and center(rowOf): 8 squares of 3 round the origin
		const sign = turned ? -1 : 1;
		const x = sign * (-12 + 3 * ("abcdefgh".indexOf(at.square[0]) + 0.5));
		const z = sign * (-12 + 3 * (8 - Number(at.square[1]) + 0.5));
		return { x: x < 0 ? BOARD_RECT.x0 : BOARD_RECT.x1, z, side: x < 0 ? "left" : "right" };
	}
	if (at.duel) {
		const mine = view.duel ? duelLayout(view.duel, view.you, view).filter((d) => d.side === "mine") : [];
		return { x: Math.max(STACK_X, ...mine.map((d) => d.x)) + CARD_SIZE.w / 2, z: DUEL_STACK.mine.z, side: "right" };
	}
	const spot = tableSpots(view, { base: 0, layer: 0 }).get(`${view.you}:${at.card}`) || { x: 0, z: HAND_Z };
	return { x: spot.x, z: spot.z + CARD_SIZE.h / 2, side: "below" };
}

/**
 * @description Where every card of the view lies: the player's hand, Card Guy's (face down, except the King card and the cards the
 * player may see, face up), and both players' active spot, passive pile and discard pile.
 * A card is keyed by its owner and id wherever it lies, so a played card is the same card on its way to its place; one the view
 * hides has its place's key
 * @param {object} view cards.view
 * @param {{ open?: string|null, base: number, layer: number, stage?: object|null }} opts open: the opened pile (a key of PILES, or
 * "discard": the discard list, view.piled, laid out at LOG_LAYOUT), base: the desk's height for a lying card, layer: a card's thickness,
 * stage: { id, from: "hand" | "pile", place: "spot" | "passive" | "discard" }: the player's card that was dragged from there and let
 * go on that place of theirs lies on it (staged: true), until the view moves it,
 * stacked: a card duel is laid, so both hands lie stacked at DUEL_STACK
 * @returns {Map<string, object>} key -> { card (null: face down), x, y, z, yaw?, faceDown, barBottom, hand (the player's), pile (a key
 * of PILES | null), discard ("mine" | "his", a discard pile's), color (the owner's: the glyph's colour), top (a pile's newest, a
 * discard pile's top card), thick (a discard pile's block: this many cards), log (a card of the opened discard list, keyed
 * "log:<index>", color and barBottom: whose it was, card null: a back, painted face up), from (a new card slides in from: "deck",
 * Card Guy's "hand", null: it's put there) }
 */
export function tableSpots(view, { open = null, base, layer, stage = null, stacked = false }) {
	const want = new Map();
	const you = view.you;
	const opp = you === "w" ? "b" : "w";
	function key(owner, card, place) {
		return `${owner}:${card && !card.down && card.id !== undefined ? card.id : place}`;
	}
	// Card i of a row of n, centred; more than HAND_FIT squeeze into the same width
	function row(n, i) {
		return (i - (n - 1) / 2) * (n > HAND_FIT ? (HAND_STEP * (HAND_FIT - 1)) / (n - 1) : HAND_STEP);
	}
	const mine = handCards(view);
	mine.forEach((card, i) => want.set(key(you, card), {
		card, x: stacked ? STACK_X : row(mine.length, i), y: CARD_Y + i * layer, z: HAND_Z,
		faceDown: false, barBottom: false, hand: true, pile: null, color: you, from: "deck"
	}));
	const opponent = view.players[opp] || {};
	const hand = opponent.hand || { count: 0, shown: [] };
	const shown = hand.shown || [];
	const his = [
		...(opponent.king ? [{ id: "king", key: "king" }] : []),
		...shown,
		...Array.from({ length: Math.max(0, (hand.count || 0) - shown.length) }, () => null)
	];
	// His cards show his pieces
	his.forEach((card, i) => want.set(key(opp, card, `#${i}`), {
		card, x: stacked ? STACK_X : -row(his.length, i), y: CARD_Y + i * layer, z: -HAND_Z,
		faceDown: !card, barBottom: false, hand: false, pile: null, color: opp, from: "deck"
	}));
	// Oldest first, the newest on top at the place; the older ones toward the owner, peeking out or (opened) whole
	for (const [pile, p] of Object.entries(PILES)) {
		const owner = p.side === "mine" ? you : opp;
		const list = pileCards(view, pile);
		const step = pile === open ? columnStep(list.length, Math.abs(p.end - p.z)) : PEEK_OFFSET;
		list.forEach((card, i) => want.set(key(owner, card, `${pile}${i}`), {
			card: card.down ? null : card, x: p.x, y: base + i * layer, z: p.z + p.dir * (list.length - 1 - i) * step,
			faceDown: Boolean(card.down), barBottom: p.side === "mine", hand: false, pile, color: owner,
			top: i === list.length - 1, from: p.side === "his" ? "hand" : null
		}));
	}
	for (const [side, d] of Object.entries(DISCARD)) {
		const owner = side === "mine" ? you : opp;
		const player = view.players[owner] || {};
		const top = (player.pile && player.pile.top) || null;
		const n = (player.pile && player.pile.n) || 0;
		const under = top ? Math.max(n - 1, 0) : n;
		const from = side === "his" ? "hand" : null;
		function lie(card, y, more) {
			return {
				card: card.down ? null : card, x: d.x, y, z: d.z, faceDown: Boolean(card.down), barBottom: false,
				hand: false, pile: null, discard: side, color: owner, from, ...more
			};
		}
		// How thick the pile is: one block for the cards under the top one
		if (under) { want.set(`${owner}:#under`, lie({ down: true }, base, { thick: under, from: null })); }
		// A face-down top is keyed by the count, so the next one is a new card that slides in
		if (top) { want.set(key(owner, top, `#top${n}`), lie(top, base + under * layer, { top: true })); }
		if (player.kept) { want.set(key(owner, player.kept, "#kept"), lie(player.kept, base + (under + (top ? 1 : 0)) * layer, { yaw: ASKEW })); }
	}
	// The opened discard list: a copy of each card, keyed by its place in the list, so the piles' own cards stay put. Its name bar
	// says whose it was, as on the piles. A hidden one (card null) lies face up, its face painted as its back with that bar
	// (cardTable.js paint), since a turned-over card's back has no bar
	if (open === "discard") {
		pileCards(view, open).forEach((card, i) => want.set(`log:${i}`, {
			card: card.down ? null : card, ...logSpot(i), y: base, faceDown: false, barBottom: view.piled[i].player === you,
			hand: false, pile: null, log: true, color: view.piled[i].player, from: null
		}));
	}
	const staged = stage && want.get(`${you}:${stage.id}`);
	// Still where it was dragged from: once the answer moves it, it goes to its own place
	if (staged && (stage.from === "hand" ? staged.hand : Boolean(staged.pile))) {
		const pile = stage.place === "spot" ? "mineSpot" : "mine";
		const p = stage.place === "discard" ? DISCARD.mine : PILES[pile];
		// On top of what lies there (on the discard pile, its remembered card too)
		const under = stage.place === "discard" ? (((view.players[you] || {}).pile || {}).n || 0) + 2 : pileCards(view, pile).length;
		Object.assign(staged, { x: p.x, y: base + under * layer, z: p.z, staged: true });
	}
	return want;
}
