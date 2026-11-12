/*
 *  opponent.js  --  chess frontend
 *	The CRT Monitor's Opponent Channel
 *	The opponent's card: the test card, else their picture, else their name & status as text. The name & status strip over the picture is
 *	screen.js's own (it goes on after the scanlines so none cross the text). No buttons
 *
 */

import { textWidth, fitText } from "../../pixelFont.js";
import { TEXT, DIM, drawText, drawBars, body } from "../kit.js";

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
	if (screen.bars) { drawBars(ctx, area); }
	else if (screen.picture) { ctx.drawImage(screen.picture, 0, 0); } // THE CLIP KEEPS IT IN THE BODY
	else {
		const mid = area.x + area.w / 2, room = area.w - 12;
		const big = textWidth(screen.name) * 2 <= room; // THE NAME, DOUBLE SIZE WHEN IT FITS
		const top = area.y + (data.zoomed ? 20 : 34); // ZOOMED: THE NAME & STATUS CENTRED IN THE SHORTER BODY
		drawText(ctx, big ? screen.name : fitText(screen.name, room), mid, big ? top : top + 6, TEXT, 0, big ? 2 : 1);
		if (screen.status) { drawText(ctx, fitText(screen.status, room), mid, top + 28, DIM, 0); }
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
