/*
 *  opponent.js  --  chess frontend
 *	The CRT Monitor's Opponent Channel
 *	The opponent's card: their name & what the game is waiting for (them, the bot, you or the result) over the background the settings chose: the
 *	test card, drifting stars or a growing pipe. While the connection is lost it reads RECONNECTING on the bare tube. No buttons
 *	The stars & the pipe are drawn from data.frame alone, so a frame always looks the same
 *
 */

import { HEIGHT as FONT_HEIGHT, textWidth, fitText } from "../../pixelFont.js";
import { TUBE, TEXT, DIM, HOT, fillCells, drawText, drawBars, sentence, body } from "../kit.js";

const STARS = 28; // HOW MANY STARS
const PIPE_STEP = 4; // ONE PIPE SEGMENT, GRID PIXELS
const PIPE_LEN = 160; // SEGMENTS BEFORE THE PIPE STARTS AGAIN
const TICKS = { stars: 80, pipes: 120 }; // MS BETWEEN FRAMES, A STILL PICTURE HAS NONE
const STILL_PIPE = 90; // REDUCED MOTION: THE PIPE AS IT IS AT THIS FRAME, NOT A LONE SEGMENT
const RECONNECTING = "RECONNECTING"; // WHILE THE CONNECTION IS LOST, ITS DOTS COUNT UP AFTER IT
const DOTS_MS = 500; // MS BETWEEN THE DOTS

// A REPEATABLE NUMBER FROM A SEED, 0 UP TO (BUT NOT) 4294967296
function hash(n) {
	return (Math.imul(n + 1, 2654435761) ^ Math.imul(n + 7, 1597334677)) >>> 0;
}

// THE BACKGROUND THE SETTINGS CHOSE, THE TEST CARD BEFORE THE MONITOR HAS ANY
function background(data) {
	return (data.prefs && data.prefs.idle) || "stars";
}

// WHETHER THE CONNECTION IS LOST MID-GAME
function reconnecting(data) {
	return Boolean(data.offline && !data.over);
}

/* ---------------------------------------------------------------- */
// Backgrounds
/* ---------------------------------------------------------------- */

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

// RECONNECTING ON THE BARE TUBE, ITS 0 TO 3 DOTS COUNTING UP. PLACED AS IF ALL THREE WERE THERE SO THE WORD STAYS STILL. REDUCED MOTION: ALL THREE
function drawReconnecting(ctx, data, area) {
	const dots = ".".repeat(data.reduce ? 3 : data.frame % 4);
	const full = fitText(`${RECONNECTING}...`, area.w - 16);
	const x = Math.round(area.x + (area.w - textWidth(full)) / 2);
	drawText(ctx, RECONNECTING + dots, x, area.y + Math.floor((area.h - FONT_HEIGHT) / 2), TEXT, -1);
}

// A LINE OF TEXT CENTRED ON A DARK PLATE, SO IT READS OVER ANY BACKGROUND
function drawPlate(ctx, area, text, y, color, size = 1) {
	const w = textWidth(text) * size + 8, h = FONT_HEIGHT * size + 6;
	ctx.fillStyle = TUBE;
	ctx.fillRect(Math.round(area.x + (area.w - w) / 2), y - 3, w, h);
	drawText(ctx, text, area.x + area.w / 2, y, color, 0, size);
}

/**
 * @description The card's status line: RECONNECTING while the connection is lost, WAITING FOR OPPONENT on a friend's turn, else the screen's
 * @param  {[object]} data [the channels' data]
 * @return {[string]}
 */
export function status(data) {
	if (reconnecting(data)) { return RECONNECTING; } // NOTHING IS ANYONE'S MOVE UNTIL IT RECONNECTS
	if (!data.ai && !data.yourTurn && !data.over) { return "WAITING FOR OPPONENT"; }
	return (data.screen && data.screen.status) || "";
}

/**
 * @description Draws the channel
 * @param  {[CanvasRenderingContext2D]} ctx
 * @param  {[object]} data [the channels' data]
 */
export function draw(ctx, data) {
	const { screen } = data;
	const area = body(data);
	ctx.save();
	ctx.beginPath();
	ctx.rect(area.x, area.y, area.w, area.h); // NOTHING OVER THE TAB ROW OR UNDER THE BEZEL
	ctx.clip();
	ctx.fillStyle = TUBE;
	ctx.fillRect(area.x, area.y, area.w, area.h);
	if (screen.bars) { drawBars(ctx, area); }
	else if (reconnecting(data)) { drawReconnecting(ctx, data, area); }
	else {
		const kind = background(data);
		if (kind === "stars") { drawStars(ctx, area, data.frame); }
		else if (kind === "pipes") { drawPipes(ctx, area, data.reduce ? STILL_PIPE : data.frame); }
		else { drawBars(ctx, area); }
		const room = area.w - 24;
		const big = textWidth(screen.name) * 2 <= room; // THE NAME, DOUBLE SIZE WHEN IT FITS
		const line = fitText(status(data), room);
		const nameH = FONT_HEIGHT * (big ? 2 : 1);
		const top = area.y + Math.floor((area.h - nameH - (line ? FONT_HEIGHT + 10 : 0)) / 2); // THE NAME & STATUS CENTRED IN THE BODY
		drawPlate(ctx, area, big ? screen.name : fitText(screen.name, room), top, TEXT, big ? 2 : 1);
		if (line) { drawPlate(ctx, area, line, top + nameH + 10, DIM); }
	}
	ctx.restore();
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
 * @description The stars, the pipe & the reconnecting dots animate, the test card & reduced motion stand still
 * @param  {[object]} data [the channels' data]
 * @return {[number|null]} ms [until the next frame, null for a still screen]
 */
export function tick(data) {
	if (data.reduce || (data.screen && data.screen.bars)) { return null; }
	if (reconnecting(data)) { return DOTS_MS; }
	return TICKS[background(data)] || null;
}

/**
 * @description What the screen reader says for the channel
 * @param  {[object]} data [the channels' data]
 * @return {[string]} "<name>, <status>", "Reconnecting" while the connection is lost, "" with no screen
 */
export function speak(data) {
	if (reconnecting(data)) { return sentence(RECONNECTING); }
	if (!data.screen) { return ""; }
	return [data.screen.name, status(data).toLowerCase()].filter(Boolean).join(", ");
}
