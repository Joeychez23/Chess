/* ---- Promotion cards: where they lie, how the keys walk them, how a face is drawn ---- */

export const CARD_ORDER = ["q", "r", "b", "n"];
export const CARD_SIZE = { w: 4.3, h: 6 };
export const DECK = { x: -24.5, z: 0, y: 0.44 };
export const CARD_Y = -0.61; // BAIZE TOP + 0.02

const SPOT_X = -17.7;
const SPOT_STEP = 6.5;

export const GLYPHS = { q: "♛", r: "♜", b: "♝", n: "♞", k: "♚", p: "♟" }; // THE KING & PAWN: THE CHESS CARDS' MOVE CARDS (cardFaces.js)
export const CREAM = "#F3E9D2";
export const GOLD = "#C9A227";
export const INK = "#1B1B1B";
export const FONT = "'Georgia', 'Times New Roman', 'Noto Serif', serif";

/**
 * @description The four card spots in the green strip, queen at the top.
 * @returns {{ type: string, x: number, z: number }[]} one spot per card
 */
export function cardSpots() {
	return CARD_ORDER.map(function (type, i) {
		return { type, x: SPOT_X, z: (i - 1.5) * SPOT_STEP };
	});
}

/**
 * @description The card an arrow key moves to.
 * @param {number|null} index the current card, or null for none
 * @param {string} key a `KeyboardEvent.key`
 * @returns {number} the new index, clamped to the cards; `index` itself for other keys
 */
export function nextCard(index, key) {
	const back = key === "ArrowUp" || key === "ArrowLeft";
	const on = key === "ArrowDown" || key === "ArrowRight";
	if (!back && !on) return index;
	if (index === null) return 0;
	return Math.min(CARD_ORDER.length - 1, Math.max(0, index + (on ? 1 : -1)));
}

/**
 * @description Draws one glyph solid (Black) or as a cream fill with an ink outline (White).
 * @param {CanvasRenderingContext2D} ctx the context
 * @param {string} glyph the text to draw
 * @param {string} color "w" or "b", the player's colour
 * @param {number} x centre x
 * @param {number} y centre y
 * @param {number} line outline thickness for White
 */
export function paintGlyph(ctx, glyph, color, x, y, line) {
	if (color === "b") {
		ctx.fillStyle = INK;
		ctx.fillText(glyph, x, y);
		return;
	}
	ctx.fillStyle = CREAM;
	ctx.fillText(glyph, x, y);
	ctx.strokeStyle = INK;
	ctx.lineWidth = line;
	ctx.strokeText(glyph, x, y);
}

/**
 * @description Draws the face of a promotion card.
 * @param {CanvasRenderingContext2D} ctx the 2D context to draw on
 * @param {string} type "q", "r", "b" or "n"
 * @param {string} color the player's colour, "w" or "b"
 * @param {number} w canvas width
 * @param {number} h canvas height
 */
export function drawCardFace(ctx, type, color, w, h) {
	const inset = w * 0.04;
	ctx.fillStyle = CREAM;
	ctx.fillRect(0, 0, w, h);
	ctx.strokeStyle = GOLD;
	ctx.lineWidth = w * 0.02;
	ctx.strokeRect(inset, inset, w - inset * 2, h - inset * 2);

	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.font = "bold " + Math.round(h * 0.45) + "px " + FONT;
	paintGlyph(ctx, GLYPHS[type], color, w / 2, h / 2, w * 0.02);

	/**
	 * @description Draws the corner index at the top left: the letter solid ink, the small glyph in the player's colour.
	 */
	const corner = function () {
		ctx.fillStyle = INK;
		ctx.font = "bold " + Math.round(h * 0.075) + "px " + FONT;
		ctx.fillText(type.toUpperCase(), w * 0.15, h * 0.095);
		const glyph = Math.round(h * 0.11); // BIG ENOUGH TO READ AT THE DEALT SIZE, THE OUTLINE THIN ENOUGH TO LEAVE ITS INSIDE OPEN
		ctx.font = glyph + "px " + FONT;
		paintGlyph(ctx, GLYPHS[type], color, w * 0.15, h * 0.2, glyph * 0.035);
	};
	corner(); // TOP LEFT
	ctx.save();
	ctx.translate(w, h);
	ctx.rotate(Math.PI); // BOTTOM RIGHT, TURNED 180 DEGREES
	corner();
	ctx.restore();
}
