/*
 *  waiting.js  --  chess frontend
 *	The CRT Monitor's Waiting Channel
 *	What the game is waiting for (the result, the opponent, the bot or you) over the idle picture the settings chose: the test card, drifting stars or a growing pipe. No buttons
 *	The stars & the pipe are drawn from data.frame alone, so a frame always looks the same
 *
 */

import { TUBE, TEXT, DIM, HOT, BARS, fillCells, drawText, sentence, body } from "../kit.js";
import { HEIGHT as FONT_HEIGHT, fitText } from "../../pixelFont.js";

const STARS = 28; // HOW MANY STARS
const PIPE_STEP = 4; // ONE PIPE SEGMENT, GRID PIXELS
const PIPE_LEN = 160; // SEGMENTS BEFORE THE PIPE STARTS AGAIN
const TICKS = { stars: 80, pipes: 120 }; // MS BETWEEN FRAMES, A STILL PICTURE HAS NONE
const STILL_PIPE = 90; // REDUCED MOTION: THE PIPE AS IT IS AT THIS FRAME, NOT A LONE SEGMENT

// A REPEATABLE NUMBER FROM A SEED, 0 UP TO (BUT NOT) 4294967296
function hash(n) {
	return (Math.imul(n + 1, 2654435761) ^ Math.imul(n + 7, 1597334677)) >>> 0;
}

/* ---------------------------------------------------------------- */
// Idle pictures
/* ---------------------------------------------------------------- */

// A TEST CARD'S COLOUR BARS, SQUEEZED INTO THE BODY SO THEY NEVER REACH THE TAB ROW OR THE BEZEL
function drawCard(ctx, area) {
	const bh = Math.floor(area.h * 0.7);
	BARS.forEach(function (color, i) {
		const left = area.x + Math.round(i * area.w / BARS.length), right = area.x + Math.round((i + 1) * area.w / BARS.length);
		ctx.fillStyle = color;
		ctx.fillRect(left, area.y, right - left, bh);
		ctx.fillStyle = BARS[BARS.length - 1 - i];
		ctx.fillRect(left, area.y + bh, right - left, 8);
	});
}

// STARS DRIFTING LEFT, THE NEAR ONES (BIGGER, BRIGHTER) FASTER
function drawStars(ctx, area, frame) {
	for (let i = 0; i < STARS; i++) {
		const h = hash(i);
		const speed = 1 + (h >>> 28) % 3; // 1 TO 3 PIXELS A FRAME
		const size = speed > 2 ? 2 : 1;
		const x = area.x + Math.min(((h % area.w) - frame * speed % area.w + area.w) % area.w, area.w - size); // CLAMPED SO A BIG STAR NEVER CROSSES THE EDGE
		const y = Math.min(area.y + (h >>> 8) % area.h, area.y + area.h - size);
		fillCells(ctx, [[0, 0]], x, y, size, speed > 2 ? TEXT : DIM);
	}
}

// ONE PIPE GROWING ACROSS THE SCREEN, TURNING NOW & THEN, FROM THE SAME SEED EVERY TIME
function drawPipes(ctx, area, frame) {
	const cols = Math.floor(area.w / PIPE_STEP), rows = Math.floor(area.h / PIPE_STEP);
	let x = Math.floor(cols / 2), y = Math.floor(rows / 2), dir = 0;
	const cells = [[x, y]];
	for (let n = 0; n < frame % PIPE_LEN; n++) {
		if (n % 6 === 0) { dir = (dir + (hash(n) % 2 ? 1 : 3)) % 4; } // TURN LEFT OR RIGHT EVERY 6 SEGMENTS
		x = (x + [1, 0, -1, 0][dir] + cols) % cols;
		y = (y + [0, 1, 0, -1][dir] + rows) % rows;
		cells.push([x, y]);
	}
	fillCells(ctx, cells, area.x, area.y, PIPE_STEP, DIM);
	fillCells(ctx, cells.slice(-1), area.x, area.y, PIPE_STEP, HOT); // THE GROWING TIP
}

/* ---------------------------------------------------------------- */
// Channel
/* ---------------------------------------------------------------- */

/**
 * @description What the game is waiting for
 * @param  {[object]} data [the channels' data]
 * @return {[string]} caption
 */
export function caption(data) {
	if (data.over) { return data.result; }
	if (!data.yourTurn) { return data.ai ? "THINKING" : "WAITING FOR OPPONENT"; }
	return "YOUR MOVE";
}

/**
 * @description Draws the channel
 * @param  {[CanvasRenderingContext2D]} ctx
 * @param  {[object]} data [the channels' data]
 */
export function draw(ctx, data) {
	const area = body(data);
	ctx.fillStyle = TUBE;
	ctx.fillRect(area.x, area.y, area.w, area.h);
	const idle = data.prefs.idle;
	if (idle === "stars") { drawStars(ctx, area, data.frame); }
	else if (idle === "pipes") { drawPipes(ctx, area, data.reduce ? STILL_PIPE : data.frame); }
	else { drawCard(ctx, area); }
	const text = fitText(caption(data), area.w - 16);
	const w = text.length * 6 + 8;
	const y = area.y + Math.floor((area.h - FONT_HEIGHT) / 2);
	ctx.fillStyle = TUBE;
	ctx.fillRect(Math.round(area.x + (area.w - w) / 2), y - 4, w, FONT_HEIGHT + 8); // A DARK PLATE SO THE TEXT READS OVER ANY PICTURE
	drawText(ctx, text, area.x + area.w / 2, y, TEXT, 0);
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
 * @description The stars & the pipe animate, the test card & reduced motion stand still
 * @param  {[object]} data [the channels' data]
 * @return {[number|null]} ms [until the next frame, null for a still screen]
 */
export function tick(data) {
	return data.reduce ? null : TICKS[data.prefs.idle] || null;
}

/**
 * @description What the screen reader says for the channel
 * @param  {[object]} data [the channels' data]
 * @return {[string]} the caption in sentence case
 */
export function speak(data) {
	return sentence(caption(data));
}
