/*
 *  diagnostics.js  --  chess frontend
 *	The Meridian Terminal's Diagnostics Window
 *	The session's fault codes (F) & status codes (S), read from the screen data v. It lays itself out for its window's width: the two header
 *	plates when wide, one FAULT CODES bar under that, & no header at all in a small window
 *	Drawn in content pixels from (0, 0); the desktop draws the frame, fills the background, clips & scrolls
 *	Pure: no DOM & no three.js; the tests load it in Node (client/test/monitor/screens-diagnostics.test.js)
 *
 */

import { LINE, px, box, drawText, sentence, boxW } from "../kit.js";
import { fitText } from "../../pixelFont.js";

// THE PART A LAYOUT MOVED TO CONTENT PIXELS: ITS { 26, 26, 268, 180 } WINDOW'S INSIDE STARTED AT (27, 39)
const W = 266, HEAD = 21, MARGIN = 6; // HEAD: THE HEADER BAR & ITS GAP, WHERE THE FIRST CODE'S ROW STARTS
const CODE_X = 7, TEXT_X = 45; // THE TEXT STOPS 3 PX SHORT OF THE RIGHT EDGE
const WIDE = 254, SMALL = 120; // UNDER WIDE ONE HEADER BAR, UNDER SMALL NONE
const headOf = (v) => (boxW(v, W) < SMALL ? MARGIN : HEAD);

/* ---------------------------------------------------------------- */
// Codes
/* ---------------------------------------------------------------- */

/**
 * @description The codes to list, faults first
 * @param  {[object]} v [screen data]
 * @return {[Array]} [[code, text]]
 */
function codes(v) {
	const action = (id) => (v.actions || []).find((a) => a.id === id);
	const held = (id) => { const a = action(id); return !!(a && a.shown && !a.enabled); };
	const list = [];
	if (v.offline) list.push(["F02", "LINK_UNSTABLE"]);
	if (held("hint")) list.push(["F03", "GUIDANCE_LIMIT_REACHED"]);
	if (held("takeback")) list.push(["F04", "REVERSAL_NOT_PERMITTED"]);
	if (!list.length) list.push(["S01", "No action required."]);
	list.push(["S02", v.over ? "Session closed." : "Session may continue."]);
	return list;
}

/**
 * @description Where each code's row goes
 * @param  {[object]} v [screen data]
 * @return {[Array]} [{ code, text, y }] [content pixels]
 */
function rows(v) {
	return codes(v).map(([code, text], i) => ({ code, text, y: headOf(v) + i * LINE }));
}

/* ---------------------------------------------------------------- */
// Screen module
/* ---------------------------------------------------------------- */

function size(v) {
	return { w: boxW(v, W), h: headOf(v) + codes(v).length * LINE + MARGIN };
}

/**
 * @description Draws the content: the header for the window's width, then one code per row
 * @param  {[CanvasRenderingContext2D]} ctx
 * @param  {[object]} v [screen data]
 */
function draw(ctx, v) {
	const T = v.T, w = boxW(v, W);
	if (w >= WIDE) {
		box(ctx, 4, 4, 122, 13, T.ink); drawText(ctx, "DIAGNOSTICS", 65, 7, T.ink, 0);
		px(ctx, 128, 4, 122, 13, T.ink); drawText(ctx, "FAULT CODES", 189, 7, T.bg, 0);
		for (const x of [7, 122, 131, 246]) px(ctx, x, 7, 1, 7, x < 128 ? T.ink : T.bg);
	} else if (w >= SMALL) {
		px(ctx, 4, 4, w - 8, 13, T.ink); drawText(ctx, "FAULT CODES", w / 2, 7, T.bg, 0);
	}
	for (const { code, text, y } of rows(v)) {
		const color = code[0] === "F" ? T.hot : T.ink;
		drawText(ctx, code, CODE_X, y, color);
		drawText(ctx, fitText(text, w - 3 - TEXT_X), TEXT_X, y, color);
	}
}

function buttons() {
	return [];
}

function press() {}

function speak(v) {
	return ["Diagnostics.", ...codes(v).map(([, text]) => (text.endsWith(".") ? text : sentence(text.replace(/_/g, " ")) + "."))].join(" "); // A FAULT'S NAME IS READ AS WORDS: "Link unstable."
}

export { size, codes, rows, draw, buttons, press, speak };
