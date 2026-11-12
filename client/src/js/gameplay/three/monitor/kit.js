/*
 *  kit.js  --  chess frontend
 *	The CRT Monitor's Drawing Kit
 *	What the screen & every channel share: the 160 x 120 grid's size & colours, pixel text, the test card, buttons & where a channel's body is.
 *	Everything draws on a 2D context handed in, so no DOM & no three.js here: the tests load it in Node (client/test/monitorChannels.test.js)
 *
 */

import { HEIGHT as FONT_HEIGHT, textWidth, textCells } from "../pixelFont.js";

const W = 160, H = 120; // THE SCREEN'S GRID
const TAB_H = 12; // THE TAB ROW ALONG THE TOP WHEN ZOOMED
const SAFE = { left: 8, right: 8, top: 2, bottom: 4 }; // ZOOMED, THE MONITOR'S BEZEL & ROUNDED CORNERS HIDE THIS MUCH OF THE GRID, SO THE TABS, BUTTONS & TEXT STAY INSIDE IT
const STRIP_H = 24; // THE NAME & STATUS STRIP ALONG THE BOTTOM, IN GRID PIXELS
const TUBE = "#050806"; // AN UNLIT TUBE, NEVER PURE BLACK
const TEXT = "#d8f0e0";
const DIM = "#7fa890";
const HOT = "#ffe08a"; // FOCUS & THE BANNER
const NAMES = { face: "Face", opponent: "Opponent", eval: "Evaluation", moves: "Moves", waiting: "Waiting", actions: "Actions", setup: "Setup" }; // THE CHANNELS' NAMES, FOR THE SETTINGS LIST
const SHORT = { face: "FAC", opponent: "OPP", eval: "EVL", moves: "MOV", waiting: "WAI", actions: "ACT", setup: "SET" }; // THE THREE LETTERS ON A TAB
const BARS = ["#c0c0c0", "#c0c000", "#00c0c0", "#00c000", "#c000c0", "#c00000", "#0000c0"]; // THE IDLE TEST CARD

/* ---------------------------------------------------------------- */
// Drawing
/* ---------------------------------------------------------------- */

/**
 * @description Fills a set of cells
 * @param  {[CanvasRenderingContext2D]} ctx
 * @param  {[number[][]]} cells [[x, y] in cell units]
 * @param  {[number]} x [the top left, in grid pixels]
 * @param  {[number]} y
 * @param  {[number]} size [one cell in grid pixels]
 * @param  {[string]} color
 */
function fillCells(ctx, cells, x, y, size, color) {
	ctx.fillStyle = color;
	for (const [cx, cy] of cells) { ctx.fillRect(x + cx * size, y + cy * size, size, size); }
}

/**
 * @description A line of pixel text
 * @param  {[CanvasRenderingContext2D]} ctx
 * @param  {[string]} text
 * @param  {[number]} x
 * @param  {[number]} y
 * @param  {[string]} color
 * @param  {[number]} align [-1 from x rightward, 0 centered on x, 1 ending at x]
 * @param  {[number]} size [font pixels' size in grid pixels]
 */
function drawText(ctx, text, x, y, color, align = -1, size = 1) {
	const width = textWidth(text) * size;
	fillCells(ctx, textCells(text), Math.round(align < 0 ? x : align > 0 ? x - width : x - width / 2), y, size, color);
}

/**
 * @description The idle test card, filling an area (the whole grid by default)
 * @param  {[CanvasRenderingContext2D]} ctx
 * @param  {[object]} area [{ x, y, w, h }, in grid pixels]
 */
function drawBars(ctx, area = { x: 0, y: 0, w: W, h: H }) {
	const { x, y, w, h } = area;
	const tall = Math.round(h * 2 / 3), band = Math.round(h / 12); // 80 & 10 OF THE GRID'S 120
	const cell = (i, n) => [x + Math.round(i * w / n), x + Math.round((i + 1) * w / n)]; // WHOLE PIXELS THAT TILE THE WIDTH EXACTLY
	BARS.forEach(function (color, i) {
		const [left, right] = cell(i, BARS.length);
		ctx.fillStyle = color;
		ctx.fillRect(left, y, right - left, tall);
		ctx.fillStyle = BARS[BARS.length - 1 - i]; // THE NARROW BAND UNDER THEM, THE COLOURS THE OTHER WAY ROUND
		ctx.fillRect(left, y + tall, right - left, band);
	});
	["#101010", "#f0f0f0", "#202060", "#101010", "#303030"].forEach(function (color, i) {
		const [left, right] = cell(i, 5);
		ctx.fillStyle = color;
		ctx.fillRect(left, y + tall + band, right - left, h - tall - band);
	});
}

/**
 * @description A button: a 1 px box & its label, dim when it can't be pressed, filled when it has the focus
 * @param  {[CanvasRenderingContext2D]} ctx
 * @param  {[object]} button [{ id, x, y, w, h, label, enabled }, in grid pixels]
 * @param  {[boolean]} focused
 */
function drawButton(ctx, button, focused) {
	const { x, y, w, h, label, enabled } = button;
	const color = enabled ? TEXT : DIM;
	if (focused) {
		ctx.fillStyle = HOT;
		ctx.fillRect(x, y, w, h);
	} else {
		ctx.fillStyle = color;
		ctx.fillRect(x, y, w, 1);
		ctx.fillRect(x, y + h - 1, w, 1);
		ctx.fillRect(x, y + 1, 1, h - 2);
		ctx.fillRect(x + w - 1, y + 1, 1, h - 2);
	}
	drawText(ctx, label, x + w / 2, y + Math.floor((h - FONT_HEIGHT) / 2), focused ? TUBE : color, 0);
}

/**
 * @description A tab: its label, no box (seven boxed tabs leave no room between a label & its border in the safe area), filled when lit
 * @param  {[CanvasRenderingContext2D]} ctx
 * @param  {[object]} tab [{ x, y, w, h, label }, in grid pixels]
 * @param  {[boolean]} lit [the showing channel's tab, or the focused one]
 */
function drawTab(ctx, tab, lit) {
	const { x, y, w, h, label } = tab;
	if (lit) {
		ctx.fillStyle = HOT;
		ctx.fillRect(x, y, w, h - 1); // THE ROW'S RULE STAYS UNDER IT
	}
	drawText(ctx, label, x + w / 2, y + Math.floor((h - 1 - FONT_HEIGHT) / 2), lit ? TUBE : TEXT, 0);
}

/* ---------------------------------------------------------------- */
// Layout
/* ---------------------------------------------------------------- */

/**
 * @description Where the zoomed tab row goes: inside the safe area, along its top
 * @return {[object]} row [{ x, y, w, h }, in grid pixels]
 */
function tabRow() {
	return { x: SAFE.left, y: SAFE.top, w: W - SAFE.left - SAFE.right, h: TAB_H };
}

/**
 * @description Where a channel draws: the whole grid on the desk; zoomed, the safe area under the tab row
 * @param  {[object]} data [the channels' data, zoomed]
 * @return {[object]} body [{ x, y, w, h }, in grid pixels]
 */
function body(data) {
	if (!data.zoomed) { return { x: 0, y: 0, w: W, h: H }; }
	const row = tabRow();
	return { x: row.x, y: row.y + row.h, w: row.w, h: H - row.y - row.h - SAFE.bottom };
}

export { SAFE, tabRow, W, H, TAB_H, STRIP_H, TUBE, TEXT, DIM, HOT, NAMES, SHORT, BARS, fillCells, drawText, drawBars, drawButton, drawTab, body };
