/*
 *  moves.js  --  chess frontend
 *	The CRT Monitor's Moves Channel
 *	The opening's line, then the game's move list as `N. WHITE BLACK`. On the desk the newest 12 rows & no buttons; zoomed 9 rows, scrolled by UP, DOWN & LIVE (back to the newest)
 *
 */

import { HEIGHT as FONT_HEIGHT, fitText } from "../../pixelFont.js";
import { TEXT, DIM, HOT, drawText, body } from "../kit.js";

const ROWS = 9; // ROWS SHOWN WHEN ZOOMED, LEAVING ROOM FOR THE BUTTON ROW
const DESK_ROWS = 12; // ROWS SHOWN ON THE DESK
const STEP = 8; // ONE ROW'S HEIGHT IN GRID PIXELS
const BTN = { w: 46, h: 13, xs: [1, 49, 97], bottom: 1 }; // THE BUTTON ROW ALONG THE BOTTOM OF THE BODY, 1 px CLEAR OF ITS EDGES
const COLS = { number: 4, white: 32, black: 92, move: 52 }; // FROM THE BODY'S LEFT EDGE

// HOW MANY ROWS THE VIEW SHOWS
function visible(data) {
	return data.zoomed ? ROWS : DESK_ROWS;
}

// THE LARGEST VALUE topFor CAN RETURN: THE VIEW ENDING ON THE NEWEST ROW
function last(data) {
	return Math.max(0, data.moves.length - visible(data));
}

/* ---------------------------------------------------------------- */
// Scrolling
/* ---------------------------------------------------------------- */

/**
 * @description The first visible row: the scroll clamped to the list, the newest rows when it is unset or on the desk
 * @param  {[object]} data [the channels' data]
 * @return {[number]} top
 */
export function topFor(data) {
	const max = last(data);
	const top = data.zoomed ? data.ui.top : undefined; // THE DESK NEVER SCROLLS
	return top === undefined ? max : Math.min(Math.max(0, top), max);
}

/* ---------------------------------------------------------------- */
// Channel
/* ---------------------------------------------------------------- */

/**
 * @description Draws the channel
 * @param  {[CanvasRenderingContext2D]} ctx
 * @param  {[object]} data [the channels' data]
 */
export function draw(ctx, data) {
	const { moves, opening } = data;
	const area = body(data);
	const y0 = area.y + (data.zoomed ? 2 : 4);
	const x = (col) => area.x + COLS[col];
	const opener = opening ? `${opening.eco} ${opening.name}` : "NO OPENING YET";
	drawText(ctx, fitText(opener, area.w - 8), x("number"), y0, opening ? HOT : DIM);
	const top = topFor(data);
	moves.slice(top, top + visible(data)).forEach(function (move, i) {
		const y = y0 + FONT_HEIGHT + 3 + i * STEP;
		drawText(ctx, `${move.number}.`, x("number"), y, DIM);
		drawText(ctx, fitText(move.white, COLS.move), x("white"), y, TEXT);
		if (move.black) { drawText(ctx, fitText(move.black, Math.min(COLS.move, area.w - COLS.black - 1)), x("black"), y, TEXT); }
	});
	if (!moves.length) { drawText(ctx, "NO MOVES YET", area.x + area.w / 2, y0 + 30, DIM, 0); }
}

/**
 * @description The channel's buttons: UP, DOWN & LIVE in one row along the bottom when zoomed, none on the desk
 * @param  {[object]} data [the channels' data]
 * @return {[object[]]} buttons
 */
export function buttons(data) {
	if (!data.zoomed) { return []; }
	const top = topFor(data);
	const atEnd = top >= last(data);
	const area = body(data);
	const y = area.y + area.h - BTN.bottom - BTN.h;
	return [["up", "UP", top > 0], ["down", "DOWN", !atEnd], ["live", "LIVE", !atEnd]].map(function ([id, label, enabled], i) {
		return { id, x: area.x + BTN.xs[i], y, w: BTN.w, h: BTN.h, label, enabled };
	});
}

/**
 * @description Scrolls one row, or back to the newest
 * @param  {[string]} id [up, down or live]
 * @param  {[object]} handlers [ui(patch)]
 * @param  {[object]} data [the channels' data]
 */
export function press(id, handlers, data) {
	const top = topFor(data);
	if (id === "up") { handlers.ui({ top: Math.max(0, top - 1) }); }
	else if (id === "down") { handlers.ui({ top: Math.min(last(data), top + 1) }); }
	else if (id === "live") { handlers.ui({ top: undefined }); }
}

export { ROWS };
