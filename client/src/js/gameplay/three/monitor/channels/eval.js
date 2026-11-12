/*
 *  eval.js  --  chess frontend
 *	The CRT Monitor's Evaluation Channel
 *	White's win chance as a number, a bar & a graph by move (gaps where a move has no score). A failed request is "NO SIGNAL" over static, no scores "NO DATA". No buttons
 *
 */

import { TUBE, TEXT, DIM, HOT, fillCells, drawText, body } from "../kit.js";

const STATIC_PX = 4; // ONE SPECK OF STATIC ON THE GRID
const STATIC_SHADES = ["#101510", "#2a3a30", "#4a6a58", "#7fa890"];
const TICK = 120; // MS BETWEEN STATIC FRAMES

/* ---------------------------------------------------------------- */
// Graph
/* ---------------------------------------------------------------- */

/**
 * @description Where each ply's score lands on a w x h graph: evenly spaced across, 100 at the top
 * @param  {[(number|null)[]]} scores [White's win chance by ply, null where there is none]
 * @param  {[number]} w
 * @param  {[number]} h
 * @return {[object[]]} points [{ x, y } or null for a missing score, one per ply]
 */
export function points(scores, w, h) {
	const n = scores.length;
	return scores.map(function (score, i) {
		if (score === null || score === undefined) { return null; }
		return { x: n > 1 ? Math.round(i * (w - 1) / (n - 1)) : 0, y: Math.round((100 - score) * (h - 1) / 100) };
	});
}

// THE GRAPH AS PIXELS, JOINING NEIGHBOURS THAT BOTH HAVE A SCORE
function plot(ctx, pts, x0, y0) {
	const cells = [];
	pts.forEach(function (p, i) {
		if (!p) { return; }
		cells.push([p.x, p.y]);
		const q = pts[i + 1];
		if (!q) { return; }
		for (let x = p.x + 1; x < q.x; x++) { cells.push([x, Math.round(p.y + (q.y - p.y) * (x - p.x) / (q.x - p.x))]); }
	});
	fillCells(ctx, cells, x0, y0, 1, HOT);
}

// STATIC SEEDED BY THE FRAME, SO A FRAME ALWAYS LOOKS THE SAME
function drawStatic(ctx, area, frame) {
	let seed = (frame + 1) * 2654435761 % 4294967296;
	for (let y = area.y; y + STATIC_PX <= area.y + area.h; y += STATIC_PX) {
		for (let x = area.x; x + STATIC_PX <= area.x + area.w; x += STATIC_PX) {
			seed = (seed * 1664525 + 1013904223) % 4294967296; // A SMALL LINEAR GENERATOR, NO Math.random SO IT IS REPEATABLE
			fillCells(ctx, [[0, 0]], x, y, STATIC_PX, STATIC_SHADES[seed >>> 30]);
		}
	}
}

// TEXT ON A DARK PLATE, CENTRED IN THE AREA
function drawLabel(ctx, text, area, y) {
	const w = text.length * 6 + 8;
	ctx.fillStyle = TUBE;
	ctx.fillRect(Math.round(area.x + (area.w - w) / 2), y - 4, w, 15);
	drawText(ctx, text, area.x + area.w / 2, y, TEXT, 0);
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
	const { scores, failed } = data.eval;
	const area = body(data);
	if (failed) {
		drawStatic(ctx, area, data.frame);
		drawLabel(ctx, "NO SIGNAL", area, area.y + Math.floor(area.h / 2) - 4);
		return;
	}
	if (!scores.length) {
		drawText(ctx, "NO DATA", area.x + area.w / 2, area.y + Math.floor(area.h / 2) - 4, DIM, 0);
		return;
	}
	const now = scores.filter((s) => s !== null && s !== undefined).pop(); // THE LATEST SCORE
	const x0 = area.x + 4;
	const barW = area.w - 8;
	const barY = area.y + 16;
	drawText(ctx, now === undefined ? "--%" : `${now}%`, x0, area.y + 4, TEXT);
	drawText(ctx, "WHITE'S CHANCE", x0 + barW, area.y + 4, DIM, 1);
	ctx.fillStyle = DIM;
	ctx.fillRect(x0, barY, barW, 6);
	ctx.fillStyle = TUBE;
	ctx.fillRect(x0 + 1, barY + 1, barW - 2, 4);
	ctx.fillStyle = TEXT;
	ctx.fillRect(x0 + 1, barY + 1, Math.round((barW - 2) * (now || 0) / 100), 4);
	const gy = barY + 12;
	const gh = area.y + area.h - 6 - gy;
	ctx.fillStyle = DIM;
	ctx.fillRect(x0, gy + Math.floor(gh / 2), barW, 1); // THE EVEN LINE, 50%
	plot(ctx, points(scores, barW, gh), x0, gy);
}

/**
 * @description The channel's buttons: none
 * @return {[object[]]} buttons
 */
export function buttons() {
	return [];
}

/**
 * @description Nothing to press
 */
export function press() {}

/**
 * @description The static animates, only when it is showing & motion is allowed
 * @param  {[object]} data [the channels' data]
 * @return {[number|null]} ms [until the next frame, null for a still screen]
 */
export function tick(data) {
	return data.eval.failed && !data.reduce ? TICK : null;
}
