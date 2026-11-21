/* ---- Chess Cards faces: the promotion card's look (cardLayout.js drawCardFace) with a play card's name bar, type, rarity frame, rule text & skulls ---- */

import { GLYPHS, CREAM, GOLD, INK, FONT, paintGlyph } from "./cardLayout.js";
import { PIECE_NAMES } from "../cards/select.js";

export const RARITY_COLORS = { common: "#7D7F86", uncommon: "#2E8B57", rare: "#2F6FD0", epic: "#8E44AD", legendary: "#D4741C" }; // THE FRAME, NAME BAR & PROMPT BORDER OF EACH TIER. MOVE CARDS & THE KING CARD KEEP THE PROMOTION CARDS' GOLD
const TYPE_LABELS = { king: "Move", move: "Move", active: "Active", passive: "Passive", curse: "Curse" }; // ANYTHING ELSE IS AN "Effect"
const SKULL = "☠";
const MAX_SKULLS = 3;

/**
 * @description The colour of a rarity's frame
 * @param {string|null|undefined} rarity "common" ... "legendary"
 * @returns {string} a CSS colour, the promotion cards' gold for none
 */
export function rarityColor(rarity) {
	return RARITY_COLORS[rarity] || GOLD;
}

/**
 * @description What a card's face shows. A card the catalog doesn't know (an older answer) shows its key as an Effect; fields it doesn't know (denied, stopping) are never read
 * @param {object} card a hand or Board Effects card as the view has it: { id, key, piece? }, or the King card { id: "king" }
 * @param {object} catalog cards.catalog: { [key]: { name, kind, text, skulls, rarity } }
 * @returns {{ name: string, type: string, text: string, skulls: number|null, rarity: string|null, glyph: string|null }} the face
 */
export function faceOf(card, catalog = {}) {
	if (card.id === "king" || card.key === "king") { return { name: "King", type: "Move", text: "", skulls: null, rarity: null, glyph: "k" }; }
	if (card.key === "move") { return { name: PIECE_NAMES[card.piece] || "Move", type: "Move", text: "", skulls: null, rarity: null, glyph: GLYPHS[card.piece] ? card.piece : null }; }
	const info = catalog[card.key];
	if (!info) { return { name: String(card.key || "Card"), type: "Effect", text: "", skulls: null, rarity: null, glyph: null }; }
	const skulls = info.kind === "active" || info.kind === "passive" ? Number(info.skulls) || 0 : null;
	return { name: String(info.name), type: TYPE_LABELS[info.kind] || "Effect", text: String(info.text || ""), skulls, rarity: info.rarity || null, glyph: null };
}

// THE LARGEST FONT SIZE FROM size DOWN TO min AT WHICH text FITS width
function fitFont(ctx, text, width, size, min, weight = "") {
	let px = size;
	for (; px > min; px -= 1) {
		ctx.font = `${weight}${px}px ${FONT}`;
		if (ctx.measureText(text).width <= width) { break; }
	}
	ctx.font = `${weight}${px}px ${FONT}`;
	return px;
}

// text BROKEN INTO LINES NO WIDER THAN width AT THE CURRENT FONT (A WORD LONGER THAN A LINE STANDS ALONE)
function wrap(ctx, text, width) {
	const lines = [];
	let line = "";
	for (const word of text.split(/\s+/).filter(Boolean)) {
		const next = line ? `${line} ${word}` : word;
		if (line && ctx.measureText(next).width > width) { lines.push(line); line = word; }
		else { line = next; }
	}
	if (line) { lines.push(line); }
	return lines;
}

/**
 * @description Draws a play card's face: cream like a promotion card, framed in its rarity's colour (a double line for legendary), a name bar in that colour,
 * the type & rarity, then the piece (move cards, the King card) or the rule text, & 0-3 skulls on actives & passives
 * @param {CanvasRenderingContext2D} ctx the 2D context to draw on
 * @param {object} face faceOf()'s
 * @param {string} color the player's colour, "w" or "b" (the piece's fill, as on the promotion cards)
 * @param {number} w canvas width
 * @param {number} h canvas height
 * @param {boolean} barBottom the name bar along the bottom edge: the edge that peeks out of the player's Board Effects pile
 */
export function drawPlayFace(ctx, face, color, w, h, barBottom = false) {
	const inset = w * 0.04, line = w * 0.02, frame = face.rarity ? rarityColor(face.rarity) : GOLD;
	ctx.fillStyle = CREAM;
	ctx.fillRect(0, 0, w, h);
	ctx.strokeStyle = frame;
	ctx.lineWidth = line;
	ctx.strokeRect(inset, inset, w - inset * 2, h - inset * 2);
	if (face.rarity === "legendary") {
		ctx.lineWidth = line * 0.4;
		ctx.strokeRect(inset * 1.9, inset * 1.9, w - inset * 3.8, h - inset * 3.8);
	}

	const left = inset + line, right = w - inset - line, barH = h * 0.12;
	const barY = barBottom ? h - inset - line - barH : inset + line;
	ctx.fillStyle = frame;
	ctx.fillRect(left, barY, right - left, barH);
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillStyle = CREAM;
	fitFont(ctx, face.name, (right - left) * 0.9, Math.round(h * 0.065), 12, "bold ");
	ctx.fillText(face.name, w / 2, barY + barH / 2);

	const top = barBottom ? inset + line : barY + barH, bottom = barBottom ? barY : h - inset - line;
	ctx.fillStyle = INK;
	ctx.font = `${Math.round(h * 0.04)}px ${FONT}`;
	const typeY = top + h * 0.045;
	ctx.fillText(face.rarity ? `${face.type} · ${face.rarity[0].toUpperCase()}${face.rarity.slice(1)}` : face.type, w / 2, typeY);

	const skullH = face.skulls === null ? 0 : h * 0.09;
	if (face.glyph) {
		ctx.font = `bold ${Math.round(h * 0.4)}px ${FONT}`;
		paintGlyph(ctx, GLYPHS[face.glyph], color, w / 2, (typeY + bottom) / 2 + h * 0.02, w * 0.02);
	} else if (face.text) {
		const boxW = (right - left) * 0.88, boxTop = typeY + h * 0.05, boxH = bottom - skullH - boxTop - h * 0.02;
		let px = Math.round(h * 0.048), lines = [];
		for (; px >= 9; px -= 1) { // THE LARGEST SIZE THE WHOLE TEXT FITS AT
			ctx.font = `${px}px ${FONT}`;
			lines = wrap(ctx, face.text, boxW);
			if (lines.length * px * 1.2 <= boxH) { break; }
		}
		const lead = px * 1.2, startY = boxTop + Math.max(0, (boxH - lines.length * lead) / 2) + lead / 2;
		lines.forEach((l, i) => ctx.fillText(l, w / 2, startY + i * lead));
	}
	if (skullH) {
		ctx.font = `${Math.round(skullH * 0.8)}px ${FONT}`;
		const y = bottom - skullH / 2 - h * 0.01, gap = w * 0.13;
		for (let i = 0; i < MAX_SKULLS; i++) {
			ctx.globalAlpha = i < face.skulls ? 1 : 0.18; // THE SKULLS IT HAS, THE REST FAINT: 0-3 READS AT A GLANCE
			ctx.fillText(SKULL, w / 2 + (i - 1) * gap, y);
		}
		ctx.globalAlpha = 1;
	}
}
