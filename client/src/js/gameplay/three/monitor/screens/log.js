/*
 *  log.js  --  chess frontend
 *	The Meridian Terminal's Log Screen
 *	Every event of the session, numbered from 001, oldest first; it reflows to its window's width & is as tall as its entries (the desktop scrolls it).
 *	A narrow window drops the NO. column, a narrower one the TIME column too
 *	Pure: no DOM & no three.js; the tests load it in Node (client/test/monitor/screens-log.test.js)
 *
 */

import { LINE, px, drawText } from "../kit.js";
import { fitText, HEIGHT } from "../../pixelFont.js";

const HEAD = 11; // THE HEADER BAR'S HEIGHT; THE FIRST ROW'S y
const GAP = 4; // BETWEEN THE LAST ROW & THE COUNT LINE
const W = 278; // THE INSIDE OF THE DEFAULT { 20, 20, 280, 194 } WINDOW
const COL = { no: 9, time: 39, entry: 81 }; // PART A'S x 30, 60 & 102 LESS THE OLD WINDOW'S INSIDE LEFT (21)
const NO_MIN = 200, TIME_MIN = 130; // THE WIDTHS UNDER WHICH THE NO. COLUMN, THEN THE TIME COLUMN, GO

/* ---------------------------------------------------------------- */
// Rows
/* ---------------------------------------------------------------- */

const entries = (v) => (Array.isArray(v?.term?.log) ? v.term.log.filter(Array.isArray) : []); // A BROKEN ENTRY IS SKIPPED, NOT DRAWN
const width = (v) => Math.floor(Number(v?.box?.w) || W);
const countY = (n) => HEAD + Math.max(1, n) * LINE + GAP;

/**
 * @description The columns' x for the window's width; a column that is left out is null
 * @param  {[object]} v
 * @return {[object]} { no, time, entry }
 */
function cols(v) {
	const w = width(v);
	if (w >= NO_MIN) { return { ...COL }; }
	return w >= TIME_MIN ? { no: null, time: COL.no, entry: COL.no + COL.entry - COL.time } : { no: null, time: null, entry: COL.no };
}

/**
 * @description Every row, oldest first (the desktop clips; nothing is culled here)
 * @param  {[object]} v
 * @return {[object[]]} [{ no, time, text, tone, y }] top to bottom
 */
function rows(v) {
	const cut = width(v) - cols(v).entry - 6; // A 6 PX RIGHT MARGIN
	return entries(v).map(([time, text, tone], i) => ({
		no: String((i + 1) % 1000).padStart(3, "0"),
		time: fitText(String(time ?? ""), COL.entry - COL.time - 7),
		text: fitText(String(text ?? ""), cut),
		tone,
		y: HEAD + i * LINE,
	}));
}

/**
 * @description The line under the list
 * @param  {[object]} v
 * @return {[string]} e.g. "1 entry. Recording."
 */
function countLine(v) {
	const n = entries(v).length;
	return `${n} ${n === 1 ? "entry" : "entries"}. Recording.`;
}

/* ---------------------------------------------------------------- */
// Screen module
/* ---------------------------------------------------------------- */

/**
 * @param  {[object]} v
 * @return {[object]} { w, h } the content: the box's width, as tall as the rows & the count line (HEIGHT + 2 = 9)
 */
function size(v) {
	return { w: width(v), h: countY(entries(v).length) + HEIGHT + 2 };
}

/**
 * @description Draws the Log's content in content pixels
 * @param  {[CanvasRenderingContext2D]} ctx
 * @param  {[object]} v [screen data]
 */
function draw(ctx, v) {
	const T = v.T, c = cols(v);
	px(ctx, 0, 0, width(v), HEAD, T.ink);
	if (c.no !== null) { drawText(ctx, "NO.", c.no, 2, T.bg); }
	if (c.time !== null) { drawText(ctx, "TIME", c.time, 2, T.bg); }
	drawText(ctx, "ENTRY", c.entry, 2, T.bg);
	const all = rows(v);
	for (const r of all) {
		if (c.no !== null) { drawText(ctx, r.no, c.no, r.y, T.dim); }
		if (c.time !== null) { drawText(ctx, r.time, c.time, r.y, T.dim); }
		drawText(ctx, r.text, c.entry, r.y, (r.tone === "dim" || r.tone === "hot") ? T[r.tone] : T.ink); // ONLY THE THREE TONES ARE COLOURS
	}
	if (!all.length) { drawText(ctx, "No entries yet.", COL.no, HEAD, T.dim); }
	drawText(ctx, fitText(countLine(v), width(v) - COL.no - 6), COL.no, countY(all.length), T.dim); // CUT IN A NARROW WINDOW, AS THE ENTRIES ARE
}

/**
 * @return {[object[]]} none: the Log has no buttons
 */
function buttons() {
	return [];
}

function press() {}

/**
 * @param  {[object]} v
 * @return {[string]} the count line & the newest entry
 */
function speak(v) {
	const all = entries(v);
	return `${countLine(v)} ${all.length ? String(all[all.length - 1][1] ?? "") : "No entries yet."}`;
}

export { size, draw, buttons, press, speak, rows, cols, countLine };
