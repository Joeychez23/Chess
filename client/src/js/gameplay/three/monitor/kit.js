/*
 *  kit.js  --  chess frontend
 *	The Meridian Terminal's Drawing Kit
 *	What every screen shares: the 320 x 240 grid, its layout, pixel text, the wall, the top bar, the footer tabs, windows (the desktop's
 *	chrome drawn from windows.js parts), buttons,
 *	scroll bars, meters, lamps & the pointer. Every part takes the theme T it draws in; nothing reads a global theme
 *	Everything draws on a 2D context handed in, so no DOM & no three.js here: the tests load it in Node (client/test/monitor/kit.test.js)
 *
 */

import { HEIGHT as FONT_HEIGHT, textWidth, textCells, fitText } from "../pixelFont.js";

const W = 320, H = 240; // THE SCREEN'S GRID
const LINE = 9; // THE LINE PITCH
const BAR = { x: 16, y: 4, w: 288, h: 11 }; // THE TOP BAR
const FOOT = { x: 16, y: 219, tabW: 55, pitch: 56, h: 12, brand: { x: 244, y: 219, w: 60, h: 12 } }; // TAB i SITS AT x + i * pitch; THE MAKER'S BLOCK AT THE RIGHT
const LOG_WIN = { x: 20, y: 20, w: 280, h: 194 };
const WIN = { session: { x: 40, y: 38, w: 252, h: 172 }, log: LOG_WIN, mail: { ...LOG_WIN }, systems: { ...LOG_WIN }, diag: { x: 26, y: 26, w: 268, h: 180 } };
const TAB_NAMES = { session: "SESSION", log: "LOG", mail: "MAIL", systems: "SYSTEMS" };
const POINTER = ["XX........", "XoXXX.....", ".XoooXXX..", ".XooooooXX", ".XooooXXX.", "..XooX....", "..XoX.....", "..XoX.....", "...XX.....", "...X......"]; // A DART: X THE THIN WHITE EDGE, o THE BLACK FILL

/* ---------------------------------------------------------------- */
// Pixels & text
/* ---------------------------------------------------------------- */

/**
 * @description A filled rectangle on whole pixels
 * @param  {[CanvasRenderingContext2D]} ctx
 * @param  {[number]} x [grid pixels, rounded]
 * @param  {[number]} y
 * @param  {[number]} w
 * @param  {[number]} h
 * @param  {[string]} color
 */
function px(ctx, x, y, w, h, color) {
	ctx.fillStyle = color;
	ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/**
 * @description A line of pixel text, on whole pixels for every align & size
 * @param  {[CanvasRenderingContext2D]} ctx
 * @param  {[string]} text
 * @param  {[number]} x [grid pixels]
 * @param  {[number]} y [the text's top]
 * @param  {[string]} color
 * @param  {[number]} align [-1 from x rightward, 0 centred on x, 1 ending at x]
 * @param  {[number]} size [a whole number; the font's pixels stay one grid pixel, the extra ones smooth the steps]
 */
function drawText(ctx, text, x, y, color, align = -1, size = 1) {
	const width = textWidth(text) * size;
	const ox = Math.round(align < 0 ? x : align > 0 ? x - width : x - width / 2), oy = Math.round(y);
	ctx.fillStyle = color;
	for (const [cx, cy] of textCells(text, size)) { ctx.fillRect(ox + cx, oy + cy, 1, 1); }
}

/**
 * @description A one pixel frame inside a rectangle
 * @param  {[CanvasRenderingContext2D]} ctx
 * @param  {[number]} x
 * @param  {[number]} y
 * @param  {[number]} w
 * @param  {[number]} h
 * @param  {[string]} color
 */
function box(ctx, x, y, w, h, color) {
	px(ctx, x, y, w, 1, color);
	px(ctx, x, y + h - 1, w, 1, color);
	px(ctx, x, y + 1, 1, h - 2, color);
	px(ctx, x + w - 1, y + 1, 1, h - 2, color);
}

/* ---------------------------------------------------------------- */
// The frame: wall, top bar & footer
/* ---------------------------------------------------------------- */

/**
 * @description The wall behind the windows: the background, a faint dot grid & a few big faint arcs
 * @param  {[CanvasRenderingContext2D]} ctx
 * @param  {[object]} T [the theme]
 */
function wall(ctx, T) {
	px(ctx, 0, 0, W, H, T.bg);
	for (let y = 12; y < H; y += 16) { for (let x = 8; x < W; x += 16) { px(ctx, x, y, 1, 1, T.faint); } }
	for (const r of [50, 85, 120, 155, 190]) {
		for (let a = 0; a < 6.3; a += 0.006) {
			const x = Math.round(262 + Math.cos(a) * r), y = Math.round(196 + Math.sin(a) * r);
			if (x >= 0 && x < W && y >= 0 && y < H) { px(ctx, x, y, 1, 1, T.faint); } // ONLY WHAT LANDS ON THE GRID
		}
	}
}

/**
 * @description The top bar: T.bar, a notch near each end & the label centred in T.bg
 * @param  {[CanvasRenderingContext2D]} ctx
 * @param  {[object]} T
 * @param  {[string]} label ["TERMINAL 03 - READING ROOM"]
 */
function station(ctx, T, label) {
	const { x, y, w, h } = BAR;
	px(ctx, x, y, w, h, T.bar);
	px(ctx, x + 5, y + 3, 10, 5, T.bg);
	px(ctx, x + w - 15, y + 3, 10, 5, T.bg);
	drawText(ctx, fitText(label, w - 40), x + w / 2, y + 2, T.bg, 0);
}

/**
 * @description The footer: each tab boxed in T.bar with a tick at both ends, the lit ones filled; the maker's block at the right. Leaves fillStyle as it found it
 * @param  {[CanvasRenderingContext2D]} ctx
 * @param  {[object]} T
 * @param  {[object[]]} tabs [{ id: "tab:<screen>", x, y, w, h, label, lit }, in grid pixels; lit optional]
 * @param  {[string]} litId [optional, the old way: "tab:<screen>", a tab to light as well]
 */
function footer(ctx, T, tabs, litId) {
	const was = ctx.fillStyle;
	for (const { id, x, y, w, h, label, lit: on } of tabs) {
		const lit = (on === true || (litId !== undefined && id === litId)), mark = lit ? T.bg : T.bar;
		px(ctx, x, y, w, h, lit ? T.bar : T.bg);
		box(ctx, x, y, w, h, T.bar);
		px(ctx, x + 3, y + 3, 1, h - 6, mark);
		px(ctx, x + w - 4, y + 3, 1, h - 6, mark);
		drawText(ctx, fitText(label, w - 10), x + (w - 1) / 2, y + Math.floor((h - FONT_HEIGHT) / 2), mark, 0);
	}
	const b = FOOT.brand;
	px(ctx, b.x, b.y, b.w, b.h, T.brand);
	drawText(ctx, "MERIDIAN", b.x + b.w / 2, b.y + Math.floor((b.h - FONT_HEIGHT) / 2), T.bg, 0);
	ctx.fillStyle = was;
}

/* ---------------------------------------------------------------- */
// Windows & controls
/* ---------------------------------------------------------------- */

/**
 * @description Where a window's close box is
 * @param  {[object]} rect [{ x, y, w, h }, the window]
 * @return {[object]} box [{ x, y, w, h }, in grid pixels]
 */
function closeBox(rect) {
	return { x: rect.x + rect.w - 13, y: rect.y + 2, w: 10, h: 10 };
}

/**
 * @description A window: a T.faint shadow 3 px down & right, a T.bg body, a T.ink frame & a T.dim inner frame, a lined title bar with the
 * title in a gap, a shrink box & a close box (closeBox(rect)) with its cross
 * @param  {[CanvasRenderingContext2D]} ctx
 * @param  {[object]} T
 * @param  {[object]} rect [{ x, y, w, h }, in grid pixels]
 * @param  {[string]} title
 */
function win(ctx, T, rect, title) {
	const { x, y, w, h } = rect;
	px(ctx, x + 3, y + 3, w, h, T.faint);
	px(ctx, x, y, w, h, T.bg);
	box(ctx, x, y, w, h, T.ink);
	box(ctx, x + 2, y + 14, w - 4, h - 16, T.dim);
	for (let r = 3; r < 12; r += 2) { px(ctx, x + 3, y + r, w - 29, 1, T.ink); }
	const name = fitText(title, w - 44), t = textWidth(name);
	px(ctx, x + Math.round((w - 26 - t) / 2) - 2, y + 2, t + 8, 10, T.bg);
	drawText(ctx, name, x + (w - 26) / 2 + 2, y + 3, T.ink, 0);
	box(ctx, x + w - 24, y + 2, 10, 10, T.ink);
	px(ctx, x + w - 22, y + 9, 6, 1, T.ink);
	crossBox(ctx, closeBox(rect), T.ink);
}

/**
 * @description An X in a box: a 1 px frame & a cross corner to corner inside it, 2 px in from the frame
 * @param  {[CanvasRenderingContext2D]} ctx
 * @param  {[object]} r [{ x, y, w, h }]
 * @param  {[string]} color
 */
function crossBox(ctx, r, color) {
	box(ctx, r.x, r.y, r.w, r.h, color);
	for (let d = 0; d < Math.min(r.w, r.h) - 4; d++) { px(ctx, r.x + 2 + d, r.y + 2 + d, 1, 1, color); px(ctx, r.x + r.w - 3 - d, r.y + 2 + d, 1, 1, color); }
}

/**
 * @description One desktop window from its parts: the frame filled T.bg (it covers what is under it) & bordered T.ink, the title bar (front:
 * striped, the title on a plain plate in T.ink; behind: no stripes, the title in T.dim) with a T.ink line under it, the close
 * box, the scroll tracks (T.faint) & thumbs (T.ink) that are not null & the grip (T.dim). Nothing inside p.view but the fill.
 * Leaves fillStyle as it found it
 * @param  {[CanvasRenderingContext2D]} ctx
 * @param  {[object]} T
 * @param  {[string]} title
 * @param  {[object]} p [windows.js parts(): { frame, title, close, view, grip, vbar, hbar, vthumb, hthumb }, each { x, y, w, h } or null]
 * @param  {[object]} opts [{ front }, true for the window in front]
 */
function chrome(ctx, T, title, p, { front } = {}) {
	const was = ctx.fillStyle, f = p.frame, t = p.title, line = front ? T.ink : T.dim;
	px(ctx, f.x, f.y, f.w, f.h, T.bg);
	box(ctx, f.x, f.y, f.w, f.h, T.ink);
	px(ctx, f.x + 1, t.y + t.h - 1, f.w - 2, 1, T.ink); // THE LINE UNDER THE TITLE BAR
	const sx = t.x + 3, sw = p.close.x - 2 - sx; // THE ROOM LEFT OF THE CLOSE BOX
	if (front) { for (let r = 3; r < t.h - 1; r += 2) { px(ctx, sx, t.y + r, sw, 1, T.ink); } }
	const name = fitText(title, sw - 8), tw = textWidth(name), cx = sx + sw / 2;
	if (front) { px(ctx, Math.round(cx - tw / 2) - 4, t.y + 2, tw + 8, t.h - 3, T.bg); }
	drawText(ctx, name, cx, t.y + Math.floor((t.h - FONT_HEIGHT) / 2), line, 0);
	crossBox(ctx, p.close, line);
	for (const [bar, thumb] of [[p.vbar, p.vthumb], [p.hbar, p.hthumb]]) {
		if (bar) { px(ctx, bar.x, bar.y, bar.w, bar.h, T.faint); }
		if (thumb) { px(ctx, thumb.x, thumb.y, thumb.w, thumb.h, T.ink); }
	}
	grip(ctx, T, p.grip);
	ctx.fillStyle = was;
}

/**
 * @description A window's resize grip: three short diagonals of dots toward its bottom right corner, in T.dim. chrome() draws it; with no
 * scroll bar the grip sits over the content's corner, so the desktop draws it once more after the content (screen.js)
 * @param  {[CanvasRenderingContext2D]} ctx
 * @param  {[object]} T [the theme]
 * @param  {[object]} g [{ x, y, w, h }]
 */
function grip(ctx, T, g) {
	const n = Math.min(g.w, g.h);
	for (const s of [2 * n - 3, 2 * n - 5, 2 * n - 7]) {
		for (let i = Math.max(0, s - n + 1); i <= Math.min(n - 1, s); i++) { px(ctx, g.x + g.w - n + i, g.y + g.h - n + s - i, 1, 1, T.dim); }
	}
}

/**
 * @description A button: a T.dim shadow 1 px down & right, a frame & its label centred. Lit: filled T.hot, the label in T.bg (lit wins
 * over not enabled). Not lit: T.bg inside, frame & label T.ink, or T.dim when not enabled. A button that is switched on or picked keeps
 * these colours: it says so with a 6 x 5 box at its right end, solid when button.on is true, an outline when false, none when undefined
 * @param  {[CanvasRenderingContext2D]} ctx
 * @param  {[object]} T
 * @param  {[object]} button [{ id, x, y, w, h, label, enabled, on }, in grid pixels]
 * @param  {[boolean]} lit [hovered or focused by the keyboard]
 */
function btn(ctx, T, button, lit) {
	const { x, y, w, h, label, enabled, on } = button;
	const line = lit ? T.hot : enabled ? T.ink : T.dim, mark = lit ? T.bg : line;
	px(ctx, x + 1, y + 1, w, h, T.dim);
	px(ctx, x, y, w, h, lit ? T.hot : T.bg);
	box(ctx, x, y, w, h, line);
	drawText(ctx, fitText(label, w - (on === undefined ? 4 : 24)), x + w / 2, y + Math.round((h - FONT_HEIGHT) / 2), mark, 0); // THE BOX'S ROOM IS LEFT ON BOTH SIDES: THE LABEL STAYS CENTRED
	const bx = x + w - 10, by = y + Math.floor((h - 5) / 2);
	if (on === true) { px(ctx, bx, by, 6, 5, mark); } else if (on === false) { box(ctx, bx, by, 6, 5, mark); }
}

/**
 * @description The width a window's content lays itself out for: its view's, never under `min`; `def` with no view
 * @param  {[object]} v [screen data, v.box the view]
 * @param  {[number]} def
 * @param  {[number]} min
 * @return {[number]} grid pixels
 */
function boxW(v, def, min = 58) {
	return Math.max(min, Math.floor(Number(v && v.box && v.box.w) || def));
}

/**
 * @description A scroll bar 8 px wide: a T.dim frame, T.ink arrows at both ends & a T.ink thumb, kept inside the track
 * @param  {[CanvasRenderingContext2D]} ctx
 * @param  {[object]} T
 * @param  {[number]} x
 * @param  {[number]} y
 * @param  {[number]} h [the bar's height]
 * @param  {[number]} pos [the thumb's offset down the track, grid pixels; the track is h - 14 long, starting at y + 7]
 * @param  {[number]} size [the thumb's length, grid pixels]
 */
function scroll(ctx, T, x, y, h, pos, size) {
	const track = Math.max(0, h - 14), len = Math.min(size, track), at = Math.max(0, Math.min(pos, track - len));
	box(ctx, x, y, 8, h, T.dim);
	px(ctx, x + 3, y + 2, 2, 1, T.ink);
	px(ctx, x + 2, y + 3, 4, 1, T.ink);
	px(ctx, x + 2, y + h - 4, 4, 1, T.ink);
	px(ctx, x + 3, y + h - 3, 2, 1, T.ink);
	if (len > 0) { px(ctx, x + 2, y + 7 + at, 4, len, T.ink); }
}

/**
 * @description A meter: n cells 4 x 7, 5 px apart; the first `filled` solid T.ink, the rest boxed in T.dim
 * @param  {[CanvasRenderingContext2D]} ctx
 * @param  {[object]} T
 * @param  {[number]} x
 * @param  {[number]} y
 * @param  {[number]} n
 * @param  {[number]} filled
 */
function meter(ctx, T, x, y, n, filled) {
	for (let i = 0; i < n; i++) {
		if (i < filled) { px(ctx, x + i * 5, y, 4, 7, T.ink); } else { box(ctx, x + i * 5, y, 4, 7, T.dim); }
	}
}

/**
 * @description A lamp 6 x 5: solid T.hot when on, a T.dim box when off
 * @param  {[CanvasRenderingContext2D]} ctx
 * @param  {[object]} T
 * @param  {[number]} x
 * @param  {[number]} y
 * @param  {[boolean]} on
 */
function lamp(ctx, T, x, y, on) {
	if (on) { px(ctx, x, y, 6, 5, T.hot); } else { box(ctx, x, y, 6, 5, T.dim); }
}

/**
 * @description The pointer: a 10 x 10 dart, its tip at (x, y), its own pure white edge & black fill in every theme
 * @param  {[CanvasRenderingContext2D]} ctx
 * @param  {[number]} x
 * @param  {[number]} y
 */
function drawPointer(ctx, x, y) {
	POINTER.forEach(function (row, j) {
		[...row].forEach(function (ch, i) { if (ch !== ".") { px(ctx, x + i, y + j, 1, 1, ch === "X" ? "#ffffff" : "#000000"); } });
	});
}

/* ---------------------------------------------------------------- */
// Speech
/* ---------------------------------------------------------------- */

/**
 * @description Text in sentence case for the screen reader: the pixel font's capitals lowered, each sentence's first letter raised & the arrows dropped
 * @param  {[string]} text ["WHITE WINS! BY CHECKMATE"]
 * @return {[string]} ["White wins! By checkmate"]
 */
function sentence(text) {
	return String(text || "").replace(/[◀▶]/g, "").trim().toLowerCase().replace(/(^|[.!?]\s+)([a-z])/g, (_, gap, letter) => gap + letter.toUpperCase());
}

export { W, H, LINE, BAR, FOOT, WIN, TAB_NAMES, px, drawText, box, wall, station, footer, win, closeBox, chrome, grip, btn, boxW, scroll, meter, lamp, drawPointer, sentence };
